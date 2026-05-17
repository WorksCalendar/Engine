/**
 * Resource pool resolver — issue #212.
 *
 * Picks a concrete resource from a `ResourcePool` given a proposed
 * (window, event) and current engine state. Pure function — no side
 * effects, deterministic given identical input — so the submit-flow can
 * call it before holding or writing.
 *
 * Resolution is driven by the pool's `strategy`:
 *   - `first-available`: first member with no hard conflict on the window.
 *   - `least-loaded`: member with the smallest total assigned units in
 *     the window. Ties broken by member order (stable).
 *   - `round-robin`: cycles through members starting at `rrCursor + 1`,
 *     skipping any member that would produce a hard conflict. Returns
 *     an updated cursor so the host can persist it.
 *
 * Every strategy excludes members already in hard conflict — a pool
 * never resolves to a resource that would reject the booking anyway.
 * Soft conflicts (holds, min-rest warnings) do not disqualify.
 */
import type { Assignment } from '../engine/schema/assignmentSchema.js'
import type { ConflictEvent, ConflictRule } from '../conflictEngine.js'
import { evaluateConflicts } from '../conflictEngine.js'
import type { EngineResource } from '../engine/schema/resourceSchema.js'
import type { ResourcePool } from './resourcePoolSchema.js'
import { evaluateQuery, type QueryExclusion } from './evaluateQuery.js'
import { haversineKm, isLatLon, type LatLon } from './geo.js'

// ─── Types ────────────────────────────────────────────────────────────────

export interface ResolvePoolInput {
  readonly pool: ResourcePool
  /**
   * Proposed event shape (no resource set — the resolver fills it in).
   * The resolver tries the pool's members in strategy order and assigns
   * the first that doesn't produce a hard conflict.
   */
  readonly proposed: Omit<ConflictEvent, 'resource'>
  /** Currently-visible events to consult for conflict checks. */
  readonly events: readonly ConflictEvent[]
  /** Active rules — only hard-severity violations disqualify a candidate. */
  readonly rules: readonly ConflictRule[]
  readonly resources?: ReadonlyMap<string, EngineResource>
  readonly assignments?: ReadonlyMap<string, Assignment>
  /**
   * Strategy `least-loaded` only — extends the workload window past
   * `proposed.end` by this many milliseconds when scoring candidates.
   * The conflict check still uses the proposed window; `lookaheadMs`
   * only widens the load tally so a member that is free *now* but
   * already slammed an hour later can be deprioritized for fleet-style
   * dispatch.
   *
   * Defaults to `0` — the original window-local behavior.
   */
  readonly lookaheadMs?: number
  /**
   * When true, member ids that aren't present in `resources` are
   * filtered out of the candidate set before any scoring or conflict
   * check. Off by default to match the historical behavior — see
   * `validatePools` for the admin-time variant.
   *
   * `evaluated` reflects the post-filter list, so a typo'd id never
   * appears in audit trails. When the filter empties the candidate
   * list, the resolver returns `POOL_EMPTY`.
   *
   * Requires `resources` — `resolvePool` throws when `strictMembers`
   * is true and no registry is provided, so the strict contract can't
   * be silently disabled by a missing argument.
   */
  readonly strictMembers?: boolean
  /**
   * Reference point for the `closest` strategy and for any `within`
   * clause that uses `from: { kind: 'proposed' }`. Typically the
   * proposed event's pickup / origin location. Without this, the
   * `closest` strategy throws (no meaningful order) and proposed-mode
   * `within` clauses fail-closed.
   */
  readonly proposedLocation?: LatLon
  /**
   * Path on each resource that `closest` should read for coordinates.
   * Defaults to `meta.location` — the convention shipped with the
   * `asset-tracker` bridge. Override if your registry stores
   * coordinates elsewhere (e.g. `meta.depot`).
   */
  readonly locationPath?: string
}

export type ResolvePoolErrorCode =
  | 'POOL_DISABLED'
  | 'POOL_EMPTY'
  | 'NO_AVAILABLE_MEMBER'

export interface ResolvePoolError {
  readonly code: ResolvePoolErrorCode
  readonly message: string
  readonly poolId: string
  /**
   * Members that were tried, in the order the strategy attempted them,
   * before the resolver gave up. Empty for `POOL_DISABLED` and
   * `POOL_EMPTY` (no member is ever attempted). Populated for
   * `NO_AVAILABLE_MEMBER` so callers can surface "tried A, B; both
   * conflicted" instead of a bare "no member available".
   */
  readonly evaluated: readonly string[]
}

export interface ResolvePoolSuccess {
  readonly ok: true
  readonly resourceId: string
  readonly strategy: ResourcePool['strategy']
  /** Updated round-robin cursor — undefined for non-rr strategies. */
  readonly rrCursor?: number
  /**
   * Members evaluated before the winner, in order. Useful for audit and
   * for surfacing "tried X, Y, then Z" in the conflict drawer.
   */
  readonly evaluated: readonly string[]
  /**
   * For `query` and `hybrid` pools: the explainability trail from the
   * query evaluator — which resources were filtered out and why.
   * Always populated for `query`/`hybrid`; `undefined` for `manual`.
   */
  readonly queryExcluded?: readonly QueryExclusion[]
}

export type ResolvePoolResult =
  | ResolvePoolSuccess
  | {
      readonly ok: false
      readonly error: ResolvePoolError
      /** Mirror of the success-side trail — present for `query`/`hybrid`. */
      readonly queryExcluded?: readonly QueryExclusion[]
    }

// ─── Helpers ──────────────────────────────────────────────────────────────

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'id', 'name', 'tenantId', 'capacity', 'color', 'timezone',
])

/**
 * Same path-resolution rules as `evaluateQuery.readPath` — kept in
 * sync deliberately so a `closest` strategy that uses the same path
 * the host's `within` clause uses reads the same coordinate.
 */
function readPath(r: EngineResource | undefined, path: string): unknown {
  if (!r) return undefined
  if (TOP_LEVEL_KEYS.has(path)) {
    return (r as unknown as Record<string, unknown>)[path]
  }
  const segments = path.startsWith('meta.')
    ? path.slice(5).split('.')
    : path.split('.')
  let cursor: unknown = r.meta
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[seg]
  }
  return cursor
}

function hasHardConflict(
  proposed: ConflictEvent,
  input: ResolvePoolInput,
): boolean {
  const result = evaluateConflicts({
    proposed,
    events: input.events,
    rules: input.rules,
    resources: input.resources,
    assignments: input.assignments,
  })
  return !result.allowed
}

/** Half-open interval overlap — matches conflictEngine semantics. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

function toTime(v: Date | string | number): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime()
}

function workloadFor(
  resourceId: string,
  windowStart: number,
  windowEnd: number,
  events: readonly ConflictEvent[],
  assignments: ReadonlyMap<string, Assignment> | undefined,
  lookaheadMs: number = 0,
): number {
  // Map from eventId → units contributed to this resource. When
  // assignments is provided we read explicit units; otherwise each
  // same-resource event counts as 100.
  const eventUnits = new Map<string, number>()
  if (assignments) {
    for (const a of assignments.values()) {
      if (a.resourceId !== resourceId) continue
      eventUnits.set(a.eventId, (eventUnits.get(a.eventId) ?? 0) + a.units)
    }
  }
  const tallyEnd = windowEnd + Math.max(0, lookaheadMs)
  let total = 0
  for (const ev of events) {
    const evResource = ev.resource ?? ''
    if (evResource !== resourceId) continue
    const es = toTime(ev.start)
    const ee = toTime(ev.end)
    if (!overlaps(es, ee, windowStart, tallyEnd)) continue
    total += assignments ? (eventUnits.get(ev.id) ?? 100) : 100
  }
  return total
}

// ─── Public API ──────────────────────────────────────────────────────────

export function resolvePool(input: ResolvePoolInput): ResolvePoolResult {
  const { pool } = input
  if (input.strictMembers && !input.resources) {
    // Programmer error — silently falling back to "all members ok"
    // would defeat the whole point of strict mode and reintroduce
    // the ghost-assignment risk it's supposed to prevent.
    throw new Error('resolvePool: strictMembers requires a `resources` registry')
  }

  // ── v2: query / hybrid pool types ──────────────────────────────────────
  // `manual` (default) keeps v1 behavior — `memberIds` is the candidate
  // set. `query` ignores `memberIds` and runs `pool.query` against the
  // live registry. `hybrid` intersects the two: only ids in `memberIds`
  // *and* matching `query` survive. The evaluator's `excluded` trail
  // is surfaced on every result so hosts can render readiness
  // explanations ("1 too far · 1 capacity too low").
  const poolType = pool.type ?? 'manual'
  if ((poolType === 'query' || poolType === 'hybrid') && !pool.query) {
    throw new Error(`resolvePool: pool "${pool.id}" has type "${poolType}" but no query`)
  }
  if ((poolType === 'query' || poolType === 'hybrid') && !input.resources) {
    throw new Error(`resolvePool: pool "${pool.id}" has type "${poolType}" but no \`resources\` registry to evaluate against`)
  }

  // Pass proposedLocation into the evaluator so `within` clauses
  // with `from: { kind: 'proposed' }` resolve against the live
  // submit context instead of needing a literal point in the query.
  const queryContext = input.proposedLocation
    ? { proposedLocation: input.proposedLocation }
    : {}
  let queryExcluded: readonly QueryExclusion[] | undefined
  let baseMembers: readonly string[]
  if (poolType === 'query') {
    const result = evaluateQuery(pool.query!, input.resources!, queryContext)
    queryExcluded = result.excluded
    baseMembers = result.matched
  } else if (poolType === 'hybrid') {
    const result = evaluateQuery(pool.query!, input.resources!, queryContext)
    const allowed = new Set(result.matched)
    queryExcluded = result.excluded
    baseMembers = pool.memberIds.filter(id => allowed.has(id))
  } else {
    baseMembers = pool.memberIds
  }

  if (pool.disabled) {
    return {
      ok: false,
      error: { code: 'POOL_DISABLED', message: `Pool "${pool.id}" is disabled.`, poolId: pool.id, evaluated: [] },
      ...(queryExcluded ? { queryExcluded } : {}),
    }
  }
  // For `manual` pools, the input was the source of truth. For `query`
  // pools, an empty match set is "no member matched the constraints"
  // — semantically `POOL_EMPTY` from the resolver's perspective.
  if (baseMembers.length === 0) {
    return {
      ok: false,
      error: { code: 'POOL_EMPTY', message: `Pool "${pool.id}" has no members.`, poolId: pool.id, evaluated: [] },
      ...(queryExcluded ? { queryExcluded } : {}),
    }
  }

  // Optional integrity filter: drop ids that aren't in the resource
  // registry before any scoring runs. Without this, the resolver was
  // happy to commit a typo'd or removed id as the winning resource,
  // which docs claimed wasn't possible. Query-derived ids already
  // came from the registry, so the filter is a no-op there — but
  // hybrid pools may carry stale `memberIds`.
  const validMembers = input.strictMembers && input.resources
    ? baseMembers.filter(id => input.resources!.has(id))
    : baseMembers
  if (validMembers.length === 0) {
    return {
      ok: false,
      error: { code: 'POOL_EMPTY', message: `Pool "${pool.id}" has no members.`, poolId: pool.id, evaluated: [] },
      ...(queryExcluded ? { queryExcluded } : {}),
    }
  }

  const winStart    = toTime(input.proposed.start)
  const winEnd      = toTime(input.proposed.end)
  const lookaheadMs = input.lookaheadMs ?? 0
  const evaluated: string[] = []

  // Round-robin needs a stable rotation anchor. For `manual` and
  // `hybrid` pools, the host-controlled `pool.memberIds` is the
  // source of truth; the cursor points into it. For `query` pools
  // there is no host-curated list, so we anchor to the live query
  // result (`baseMembers`) — order mirrors the resource registry's
  // iteration order, which is stable.
  const cursorAnchor: readonly string[] = poolType === 'query'
    ? baseMembers
    : pool.memberIds

  // Build the candidate order per strategy.
  let candidates: readonly string[]
  switch (pool.strategy) {
    case 'first-available':
      candidates = validMembers
      break
    case 'least-loaded': {
      const loaded = validMembers.map((id, i) => ({
        id,
        index: i,
        load: workloadFor(id, winStart, winEnd, input.events, input.assignments, lookaheadMs),
      }))
      loaded.sort((a, b) => a.load - b.load || a.index - b.index)
      candidates = loaded.map(m => m.id)
      break
    }
    case 'round-robin': {
      // Cursor anchors as described above. The query/strict-member
      // filter is applied as a final pass so disqualified ids drop
      // from the rotation without disturbing the anchor's index.
      const anchor = cursorAnchor.length > 0 ? cursorAnchor : validMembers
      const startAt = ((pool.rrCursor ?? -1) + 1) % anchor.length
      const ordered = [
        ...anchor.slice(startAt),
        ...anchor.slice(0, startAt),
      ]
      const allowed = new Set(validMembers)
      candidates = ordered.filter(id => allowed.has(id))
      break
    }
    case 'closest': {
      // Sort by great-circle distance to the proposed location.
      // Resources missing a usable coordinate sort to the back so
      // they're tried last — never silently disqualified, since a
      // well-located member with a stale lat/lon is still better
      // than no booking at all if it's the only available option.
      if (!input.proposedLocation) {
        throw new Error(`resolvePool: pool "${pool.id}" uses strategy "closest" but no \`proposedLocation\` was supplied`)
      }
      const path = input.locationPath ?? 'meta.location'
      const from = input.proposedLocation
      const ranked = validMembers.map((id, i) => {
        const here = input.resources ? readPath(input.resources.get(id), path) : null
        const km = isLatLon(here) ? haversineKm(here, from) : Number.POSITIVE_INFINITY
        return { id, index: i, km }
      })
      ranked.sort((a, b) => a.km - b.km || a.index - b.index)
      candidates = ranked.map(r => r.id)
      break
    }
  }

  for (const candidate of candidates) {
    evaluated.push(candidate)
    const proposed: ConflictEvent = { ...input.proposed, resource: candidate }
    if (hasHardConflict(proposed, input)) continue
    const result: ResolvePoolSuccess = {
      ok: true,
      resourceId: candidate,
      strategy: pool.strategy,
      evaluated,
      ...(queryExcluded ? { queryExcluded } : {}),
    }
    if (pool.strategy === 'round-robin') {
      const nextCursor = cursorAnchor.indexOf(candidate)
      // Invariant: every candidate originates from `cursorAnchor`, so
      // indexOf cannot return -1 on the current code path. Assert anyway
      // so a future refactor that projects candidates through a
      // transform fails loudly instead of persisting `rrCursor: -1`.
      if (nextCursor < 0) {
        throw new Error(`resolvePool: round-robin candidate "${candidate}" is not in pool "${pool.id}" cursor anchor`)
      }
      return { ...result, rrCursor: nextCursor }
    }
    return result
  }

  return {
    ok: false,
    error: {
      code: 'NO_AVAILABLE_MEMBER',
      message: `Pool "${pool.id}" has no available member for the requested window.`,
      poolId: pool.id,
      evaluated,
    },
    ...(queryExcluded ? { queryExcluded } : {}),
  }
}
