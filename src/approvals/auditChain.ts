/**
 * Tamper-evident audit chain for ApprovalStage.history — issue #215.
 *
 * Each appended entry carries a `prevHash` (the previous entry's hash,
 * or `''` to seed the chain) and a `hash` computed as
 * `sha256(canonicalize(entry without hash))`. Any edit to a prior entry
 * cascades into a chain break detected by `verifyAuditChain`.
 *
 * Canonicalization: keys sorted alphabetically, plain JSON.stringify.
 * Undefined fields are dropped (JSON semantics); empty string is
 * preserved. This keeps the hash stable across engines that serialize
 * with different key orders.
 *
 * SECURITY NOTE — unkeyed vs. keyed:
 * The default (no options) chain uses an unkeyed SHA-256 cascade. It is
 * tamper-*evident* — `verifyAuditChain` detects edits after the fact — but
 * NOT tamper-*resistant*: a user with DevTools can rewrite the whole
 * history and recompute every hash, producing a chain that verifies.
 *
 * For true tamper-evidence, pass `AuditChainOptions.key` to switch to an
 * HMAC-SHA256 chain and hold that secret server-side. Only a key-holder can
 * produce hashes that verify, so the client can no longer forge or truncate
 * the chain. Run `verifyAuditChain(history, { key })` on the server (or any
 * trusted key-holder) — this is the "persist + cross-check server-side"
 * path. The same options must be used to append and to verify.
 */
import type { ApprovalHistoryEntry } from '../types/assets.js'
import { sha256Hex, hmacSha256Hex } from './sha256.js'

// ─── Chain crypto options ───────────────────────────────────────────────────

/**
 * Selects how chain hashes are computed. Backward compatible: with no
 * options, the chain uses an unkeyed SHA-256 cascade (tamper-*evident* —
 * anyone can recompute it, so a client with DevTools can rewrite the whole
 * history and still verify).
 *
 * Supplying `key` upgrades the chain to HMAC-SHA256 (tamper-*resistant*):
 * only a holder of the secret can produce hashes that verify, so forging or
 * truncating the chain is infeasible without it. Hold the key server-side
 * and run `verifyAuditChain` there — this is the "persist + cross-check
 * server-side" path the module security note calls for.
 *
 * `mac` overrides the built-in entirely (e.g. to delegate to a native
 * binding or an alternative algorithm). When both are given, `mac` wins —
 * you own the keying. The same options MUST be passed to `appendAuditEntry`
 * and `verifyAuditChain`; mixing modes fails verification by design, which
 * prevents silently downgrading a keyed chain to an unkeyed one.
 */
export interface AuditChainOptions {
  readonly key?: string | Uint8Array
  readonly mac?: (canonicalEntry: string) => string
}

function resolveHashFn(opts: AuditChainOptions | undefined): (message: string) => string {
  if (opts?.mac) return opts.mac
  if (opts?.key !== undefined) {
    const key = opts.key
    return (message) => hmacSha256Hex(key, message)
  }
  return sha256Hex
}

// ─── Canonicalization ─────────────────────────────────────────────────────

type EntryWithoutHash = Omit<ApprovalHistoryEntry, 'hash'>

function canonicalize(entry: EntryWithoutHash): string {
  const keys = Object.keys(entry).sort()
  // Null-prototype accumulator: a `__proto__` key in the entry becomes a
  // real own (and therefore serialized + hashed) property here rather than
  // silently mutating the accumulator's prototype and dropping out of the
  // canonical form — which would let that field be tampered with for free.
  const out: Record<string, unknown> = Object.create(null)
  for (const k of keys) {
    const v = (entry as Record<string, unknown>)[k]
    if (v !== undefined) out[k] = v
  }
  return JSON.stringify(out)
}

function hashOf(entry: EntryWithoutHash, hashFn: (message: string) => string): string {
  return hashFn(canonicalize(entry))
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Append `entry` to `history`, computing the chain fields. The `entry`
 * argument must NOT already carry `hash` or `prevHash` — they are
 * assigned here from the chain state.
 *
 * Pass `opts.key` (or `opts.mac`) to produce an authenticated HMAC chain;
 * omit for the legacy unkeyed SHA-256 cascade. The same `opts` must be used
 * when verifying.
 */
export function appendAuditEntry(
  history: readonly ApprovalHistoryEntry[],
  entry: Omit<ApprovalHistoryEntry, 'hash' | 'prevHash'>,
  opts?: AuditChainOptions,
): ApprovalHistoryEntry[] {
  const hashFn = resolveHashFn(opts)
  const prev = history.length > 0 ? history[history.length - 1] : undefined
  const prevHash = prev?.hash ?? ''
  const withPrev: EntryWithoutHash = { ...entry, prevHash }
  const hash = hashOf(withPrev, hashFn)
  return [...history, { ...withPrev, hash }]
}

export type VerifyFailureReason =
  | 'MISSING_HASH_AFTER_CHAIN_STARTED'
  | 'PREV_HASH_MISMATCH'
  | 'HASH_MISMATCH'
  | 'INVALID_HEAD_PREV_HASH'

export type VerifyAuditResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly failedIndex: number
      readonly reason: VerifyFailureReason
    }

/**
 * Verify the hash chain across a history array.
 *
 * Rules:
 *   - An empty history is ok.
 *   - An entry without `hash` is skipped *before* the chain starts.
 *   - Once any entry has `hash`, every subsequent entry must also have
 *     one — a gap after chain start is a failure.
 *   - The **first** hashed entry MUST declare `prevHash === ''`. This
 *     anchor is what makes truncation of the chain head detectable —
 *     if a leading hashed entry is dropped, the new head carries a
 *     non-empty `prevHash` and the chain fails to verify.
 *   - Each subsequent entry's `prevHash` must equal the prior entry's
 *     `hash`.
 *   - Each entry's `hash` must equal `sha256(canonicalize(entry-no-hash))`.
 */
export function verifyAuditChain(
  history: readonly ApprovalHistoryEntry[],
  opts?: AuditChainOptions,
): VerifyAuditResult {
  const hashFn = resolveHashFn(opts)
  let expectedPrev: string | null = null

  for (let i = 0; i < history.length; i++) {
    const e = history[i]
    if (e === undefined) continue
    if (e.hash === undefined) {
      if (expectedPrev !== null) {
        return { ok: false, failedIndex: i, reason: 'MISSING_HASH_AFTER_CHAIN_STARTED' }
      }
      continue
    }

    const thisPrev = e.prevHash ?? ''
    if (expectedPrev === null) {
      // First hashed entry must anchor with the empty prevHash. Any
      // other value means a leading entry was dropped or the chain
      // was forged — reject so truncation is always detectable.
      if (thisPrev !== '') {
        return { ok: false, failedIndex: i, reason: 'INVALID_HEAD_PREV_HASH' }
      }
      expectedPrev = ''
    }
    if (thisPrev !== expectedPrev) {
      return { ok: false, failedIndex: i, reason: 'PREV_HASH_MISMATCH' }
    }

    const { hash, ...rest } = e
    const computed = hashOf(rest as EntryWithoutHash, hashFn)
    if (computed !== hash) {
      return { ok: false, failedIndex: i, reason: 'HASH_MISMATCH' }
    }
    expectedPrev = hash
  }

  return { ok: true }
}

/**
 * True iff the chain is intact (or empty / pre-chain). Pass the same `opts`
 * used to build the chain (see `AuditChainOptions`).
 */
export function isAuditChainValid(
  history: readonly ApprovalHistoryEntry[],
  opts?: AuditChainOptions,
): boolean {
  return verifyAuditChain(history, opts).ok
}
