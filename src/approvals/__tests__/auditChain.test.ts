/**
 * auditChain — hash-chain specs (issue #215).
 *
 * Covers canonicalization stability, append → verify, tamper detection,
 * and the legacy-entry migration rule (entries without `hash` are
 * skipped before the chain starts; gaps after it are failures).
 */
import { describe, it, expect } from 'vitest'
import { appendAuditEntry, verifyAuditChain, isAuditChainValid } from '../auditChain.js'
import type { ApprovalHistoryEntry } from '../../types/assets.js'

const submit = (at: string, actor = 'alice'): Omit<ApprovalHistoryEntry, 'hash' | 'prevHash'> => ({
  action: 'submit', at, actor,
})
const approve = (at: string, actor = 'bob', tier = 1): Omit<ApprovalHistoryEntry, 'hash' | 'prevHash'> => ({
  action: 'approve', at, actor, tier,
})

describe('appendAuditEntry', () => {
  it('seeds the first entry with empty prevHash and a non-empty hash', () => {
    const out = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    expect(out).toHaveLength(1)
    expect(out[0]!.prevHash).toBe('')
    expect(out[0]!.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('links subsequent entries via prevHash = previous.hash', () => {
    const h1 = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    const h2 = appendAuditEntry(h1, approve('2026-04-20T10:05:00Z'))
    expect(h2[1]!.prevHash).toBe(h1[0]!.hash)
    expect(h2[1]!.hash).not.toBe(h1[0]!.hash)
  })

  it('produces the same hash for semantically identical entries', () => {
    const a = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    const b = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    expect(a[0]!.hash).toBe(b[0]!.hash)
  })

  it('produces different hashes when actor differs', () => {
    const a = appendAuditEntry([], submit('2026-04-20T10:00:00Z', 'alice'))
    const b = appendAuditEntry([], submit('2026-04-20T10:00:00Z', 'eve'))
    expect(a[0]!.hash).not.toBe(b[0]!.hash)
  })

  it('does not mutate the input history array', () => {
    const base: ApprovalHistoryEntry[] = []
    appendAuditEntry(base, submit('2026-04-20T10:00:00Z'))
    expect(base).toHaveLength(0)
  })
})

describe('verifyAuditChain', () => {
  it('returns ok for an empty history', () => {
    expect(verifyAuditChain([])).toEqual({ ok: true })
  })

  it('returns ok for a valid 3-entry chain', () => {
    let h = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    h = appendAuditEntry(h, approve('2026-04-20T10:05:00Z'))
    h = appendAuditEntry(h, { action: 'finalize', at: '2026-04-20T10:10:00Z', actor: 'carol' })
    expect(verifyAuditChain(h)).toEqual({ ok: true })
    expect(isAuditChainValid(h)).toBe(true)
  })

  it('detects an edited field on the first entry (HASH_MISMATCH)', () => {
    let h = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    h = appendAuditEntry(h, approve('2026-04-20T10:05:00Z'))
    const tampered: ApprovalHistoryEntry[] = [{ ...h[0], actor: 'eve' }, h[1]]
    expect(verifyAuditChain(tampered)).toMatchObject({
      ok: false, failedIndex: 0, reason: 'HASH_MISMATCH',
    })
  })

  it('detects a dropped entry (PREV_HASH_MISMATCH on successor)', () => {
    let h = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    h = appendAuditEntry(h, approve('2026-04-20T10:05:00Z'))
    h = appendAuditEntry(h, { action: 'finalize', at: '2026-04-20T10:10:00Z' })
    const dropped: ApprovalHistoryEntry[] = [h[0], h[2]]
    expect(verifyAuditChain(dropped)).toMatchObject({
      ok: false, failedIndex: 1, reason: 'PREV_HASH_MISMATCH',
    })
  })

  it('detects a reordered chain', () => {
    let h = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    h = appendAuditEntry(h, approve('2026-04-20T10:05:00Z'))
    const swapped: ApprovalHistoryEntry[] = [h[1], h[0]]
    expect(verifyAuditChain(swapped).ok).toBe(false)
  })

  it('detects a dropped leading hashed entry (INVALID_HEAD_PREV_HASH)', () => {
    let h = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    h = appendAuditEntry(h, approve('2026-04-20T10:05:00Z'))
    h = appendAuditEntry(h, { action: 'finalize', at: '2026-04-20T10:10:00Z' })
    // Drop the first entry — the new head still carries its original
    // non-empty prevHash, so the chain anchor is broken.
    const truncated: ApprovalHistoryEntry[] = [h[1], h[2]]
    expect(verifyAuditChain(truncated)).toMatchObject({
      ok: false, failedIndex: 0, reason: 'INVALID_HEAD_PREV_HASH',
    })
  })

  it('skips pre-chain legacy entries at the start', () => {
    const legacy: ApprovalHistoryEntry = { action: 'submit', at: '2026-04-20T09:00:00Z' }
    const mixed = appendAuditEntry([legacy], approve('2026-04-20T10:00:00Z'))
    expect(mixed[0]!.hash).toBeUndefined()
    expect(mixed[1]!.prevHash).toBe('')
    expect(verifyAuditChain(mixed)).toEqual({ ok: true })
  })

  it('flags a legacy-entry gap AFTER the chain started', () => {
    const h = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    const broken: ApprovalHistoryEntry[] = [
      ...h,
      { action: 'approve', at: '2026-04-20T10:05:00Z' }, // no hash
    ]
    expect(verifyAuditChain(broken)).toMatchObject({
      ok: false, failedIndex: 1, reason: 'MISSING_HASH_AFTER_CHAIN_STARTED',
    })
  })

  it('skips undefined holes in the history array', () => {
    const h = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    const sparse: ApprovalHistoryEntry[] = [undefined as Record<string, unknown>, ...h]
    expect(verifyAuditChain(sparse)).toEqual({ ok: true })
  })

  it('uses empty string for prevHash when entry.prevHash is absent', () => {
    const entryNoPrev: ApprovalHistoryEntry = { action: 'submit', at: '2026-04-20T10:00:00Z', hash: 'fake-hash' } as Record<string, unknown>
    const result = verifyAuditChain([entryNoPrev])
    expect(result.ok).toBe(false)
    expect((result as Record<string, unknown>).reason).toBe('HASH_MISMATCH')
  })
})

describe('appendAuditEntry — canonicalize skips undefined fields', () => {
  it('produces the same hash whether an optional field is absent or explicitly undefined', () => {
    const base = appendAuditEntry([], submit('2026-04-20T10:00:00Z'))
    const withUndef = appendAuditEntry([], { ...submit('2026-04-20T10:00:00Z'), tier: undefined } as Record<string, unknown>)
    expect(base[0]!.hash).toBe(withUndef[0]!.hash)
  })
})
