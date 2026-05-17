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
 * SECURITY NOTE — client-only limitation:
 * The chain runs entirely in the browser. A user with DevTools access can
 * modify or delete localStorage entries. `verifyAuditChain` detects
 * tampering after the fact but cannot prevent it in a client-only
 * environment. For true tamper-evidence, persist chain hashes server-side
 * and cross-check them on load.
 */
import type { ApprovalHistoryEntry } from '../types/assets.js'
import { sha256Hex } from './sha256.js'

// ─── Canonicalization ─────────────────────────────────────────────────────

type EntryWithoutHash = Omit<ApprovalHistoryEntry, 'hash'>

function canonicalize(entry: EntryWithoutHash): string {
  const keys = Object.keys(entry).sort()
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const v = (entry as Record<string, unknown>)[k]
    if (v !== undefined) out[k] = v
  }
  return JSON.stringify(out)
}

function hashOf(entry: EntryWithoutHash): string {
  return sha256Hex(canonicalize(entry))
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Append `entry` to `history`, computing the chain fields. The `entry`
 * argument must NOT already carry `hash` or `prevHash` — they are
 * assigned here from the chain state.
 */
export function appendAuditEntry(
  history: readonly ApprovalHistoryEntry[],
  entry: Omit<ApprovalHistoryEntry, 'hash' | 'prevHash'>,
): ApprovalHistoryEntry[] {
  const prev = history.length > 0 ? history[history.length - 1] : undefined
  const prevHash = prev?.hash ?? ''
  const withPrev: EntryWithoutHash = { ...entry, prevHash }
  const hash = hashOf(withPrev)
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
): VerifyAuditResult {
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
    const computed = hashOf(rest as EntryWithoutHash)
    if (computed !== hash) {
      return { ok: false, failedIndex: i, reason: 'HASH_MISMATCH' }
    }
    expectedPrev = hash
  }

  return { ok: true }
}

/**
 * True iff the chain is intact (or empty / pre-chain).
 */
export function isAuditChainValid(history: readonly ApprovalHistoryEntry[]): boolean {
  return verifyAuditChain(history).ok
}
