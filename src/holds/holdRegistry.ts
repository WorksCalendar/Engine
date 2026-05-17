/**
 * Booking holds — issue #211.
 *
 * Short-lived soft locks on a (resource, window) pair. While a hold is
 * active, the `hold-conflict` conflict rule flags every OTHER user's
 * attempt to book the same window as a soft violation — preventing
 * the classic "two users click submit simultaneously, second one
 * discovers the conflict only on save" race.
 *
 * Holds are *in-memory*, not persisted in the engine state map. Hosts
 * that operate in a multi-process deployment implement the optional
 * adapter `acquireHold / releaseHold` methods (see #211 plan) to
 * broadcast the hold to sibling nodes; in single-process embeds the
 * local registry is sufficient.
 *
 * Design invariants:
 *   - Pure registry: every mutation is a new call, no `Date.now()`
 *     captured inside the module (tests inject a clock).
 *   - Expiry is lazy: a hold that has passed `expiresAt` is treated as
 *     gone on every read; `prune()` is a caller-initiated GC helper.
 *   - Re-acquisition by the same holder on the same window extends the
 *     TTL instead of failing — the common case where a user leaves the
 *     form open and submits right before expiry.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface HoldWindow {
  /** ISO timestamp or epoch-ms. Half-open: end is exclusive. */
  readonly start: Date | string | number
  readonly end: Date | string | number
}

export interface Hold {
  readonly id: string
  readonly resourceId: string
  readonly window: HoldWindow
  /** ISO timestamp of expiry. The hold is ignored once now ≥ this. */
  readonly expiresAt: string
  /** Stable per-session id of the user who owns the hold. */
  readonly holderId: string
}

export interface AcquireHoldInput {
  readonly resourceId: string
  readonly window: HoldWindow
  readonly holderId: string
  /** TTL in ms. Defaults to 5 minutes (300_000 ms). */
  readonly ttlMs?: number
  /** Optional stable id; auto-generated when omitted. */
  readonly id?: string
}

export type AcquireHoldErrorCode =
  | 'CONFLICTING_HOLD'
  | 'INVALID_WINDOW'

export interface AcquireHoldError {
  readonly code: AcquireHoldErrorCode
  readonly message: string
  readonly conflictingHoldId?: string
}

export type AcquireHoldResult =
  | { readonly ok: true; readonly hold: Hold }
  | { readonly ok: false; readonly error: AcquireHoldError }

export interface HoldRegistry {
  /**
   * Acquire a hold. If another holder already owns an overlapping hold on
   * the same resource and that hold is still live, returns
   * `CONFLICTING_HOLD`. If the SAME holder re-acquires on an overlapping
   * window, the existing hold is replaced (TTL refresh + window merge
   * TBD — current behavior: window is replaced wholesale).
   */
  acquire(input: AcquireHoldInput): AcquireHoldResult

  /** Remove a hold by id. Idempotent — missing ids are ignored. */
  release(holdId: string): void

  /**
   * All holds live at `now` (default `Date.now()`). Expired holds are
   * filtered out without mutating the registry — use `prune()` to free
   * memory.
   */
  active(now?: Date | string | number): readonly Hold[]

  /** Drop every expired hold. Returns the number pruned. */
  prune(now?: Date | string | number): number

  /** Test helper — number of holds currently tracked (incl. expired). */
  readonly size: number
}

export interface CreateHoldRegistryOptions {
  /**
   * Deterministic clock for tests. Called on every mutation to stamp
   * `expiresAt`. Defaults to `() => new Date()`.
   */
  readonly now?: () => Date
  /**
   * ID factory. Defaults to a local counter + random suffix — adapters
   * that need UUIDs can override.
   */
  readonly generateId?: () => string
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 5 * 60 * 1000

function toTime(v: Date | string | number): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime()
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

function isLive(hold: Hold, nowMs: number): boolean {
  return toTime(hold.expiresAt) > nowMs
}

// ─── Factory ──────────────────────────────────────────────────────────────

export function createHoldRegistry(options: CreateHoldRegistryOptions = {}): HoldRegistry {
  const now = options.now ?? (() => new Date())
  let seq = 0
  const generateId = options.generateId ?? (() =>
    `hold_${Date.now().toString(36)}_${(++seq).toString(36)}`
  )

  const byId = new Map<string, Hold>()

  function resolveNow(arg: Date | string | number | undefined): number {
    return arg !== undefined ? toTime(arg) : now().getTime()
  }

  function acquire(input: AcquireHoldInput): AcquireHoldResult {
    const startMs = toTime(input.window.start)
    const endMs   = toTime(input.window.end)
    if (!(endMs > startMs) || Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return {
        ok: false,
        error: { code: 'INVALID_WINDOW', message: 'Hold window end must be strictly after start.' },
      }
    }

    const nowMs = now().getTime()

    // Check for conflicts with OTHER holders' live holds on the same resource.
    for (const h of byId.values()) {
      if (h.resourceId !== input.resourceId) continue
      if (!isLive(h, nowMs)) continue
      if (h.holderId === input.holderId) continue
      const hs = toTime(h.window.start)
      const he = toTime(h.window.end)
      if (overlaps(startMs, endMs, hs, he)) {
        return {
          ok: false,
          error: {
            code: 'CONFLICTING_HOLD',
            message: `Resource "${input.resourceId}" is held by another session until ${h.expiresAt}.`,
            conflictingHoldId: h.id,
          },
        }
      }
    }

    // Same-holder overlap: replace in place (TTL refresh + window swap).
    for (const [id, h] of byId) {
      if (h.resourceId !== input.resourceId) continue
      if (h.holderId !== input.holderId) continue
      if (!isLive(h, nowMs)) continue
      const hs = toTime(h.window.start)
      const he = toTime(h.window.end)
      if (overlaps(startMs, endMs, hs, he)) {
        byId.delete(id)
      }
    }

    const ttl = input.ttlMs ?? DEFAULT_TTL_MS
    const id = input.id ?? generateId()
    const hold: Hold = {
      id,
      resourceId: input.resourceId,
      window: { start: input.window.start, end: input.window.end },
      expiresAt: new Date(nowMs + ttl).toISOString(),
      holderId: input.holderId,
    }
    byId.set(id, hold)
    return { ok: true, hold }
  }

  function release(holdId: string): void {
    byId.delete(holdId)
  }

  function active(nowArg?: Date | string | number): readonly Hold[] {
    const nowMs = resolveNow(nowArg)
    const out: Hold[] = []
    for (const h of byId.values()) if (isLive(h, nowMs)) out.push(h)
    return out
  }

  function prune(nowArg?: Date | string | number): number {
    const nowMs = resolveNow(nowArg)
    let dropped = 0
    for (const [id, h] of byId) {
      if (!isLive(h, nowMs)) { byId.delete(id); dropped++ }
    }
    return dropped
  }

  return {
    acquire,
    release,
    active,
    prune,
    get size() { return byId.size },
  }
}

// ─── Conflict-engine integration helper ──────────────────────────────────

/**
 * Given the proposed event's (resource, window, holderId) and a snapshot
 * of active holds, return the first hold held by a DIFFERENT user that
 * overlaps the proposed window. The `hold-conflict` rule (wired into
 * `conflictEngine.ts`) uses this to emit a soft violation.
 */
export function findBlockingHold(
  proposed: {
    readonly resourceId: string | null | undefined
    readonly window: HoldWindow
    readonly holderId: string | null | undefined
  },
  holds: readonly Hold[],
  nowMs: number,
): Hold | null {
  if (!proposed.resourceId) return null
  const ps = toTime(proposed.window.start)
  const pe = toTime(proposed.window.end)
  for (const h of holds) {
    if (h.resourceId !== proposed.resourceId) continue
    if (proposed.holderId && h.holderId === proposed.holderId) continue
    if (!isLive(h, nowMs)) continue
    const hs = toTime(h.window.start)
    const he = toTime(h.window.end)
    if (overlaps(ps, pe, hs, he)) return h
  }
  return null
}
