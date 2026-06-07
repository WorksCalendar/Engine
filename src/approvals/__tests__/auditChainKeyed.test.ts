/**
 * Authenticated (HMAC) audit chain.
 *
 * The unkeyed SHA-256 cascade is tamper-*evident* but forgeable: an
 * attacker who rewrites the whole history can recompute every hash and
 * produce a chain that verifies. Keying the chain with a server-held
 * secret closes that — these tests pin the guarantee, including the
 * downgrade/forgery cases that motivate it.
 */
import { describe, it, expect } from 'vitest'
import { appendAuditEntry, verifyAuditChain, isAuditChainValid } from '../auditChain.js'
import { sha256Hex } from '../sha256.js'
import type { ApprovalHistoryEntry } from '../../types/assets.js'

const KEY = 'server-side-secret'
const seed = (action: string, at: string): Omit<ApprovalHistoryEntry, 'hash' | 'prevHash'> =>
  ({ action: action as ApprovalHistoryEntry['action'], at })

function buildKeyedChain(opts = { key: KEY }) {
  let history: ApprovalHistoryEntry[] = []
  history = appendAuditEntry(history, seed('submit', '2026-01-01T00:00:00Z'), opts)
  history = appendAuditEntry(history, seed('approve', '2026-01-02T00:00:00Z'), opts)
  history = appendAuditEntry(history, seed('finalize', '2026-01-03T00:00:00Z'), opts)
  return history
}

describe('keyed audit chain — happy path', () => {
  it('verifies with the same key', () => {
    const history = buildKeyedChain()
    expect(verifyAuditChain(history, { key: KEY }).ok).toBe(true)
    expect(isAuditChainValid(history, { key: KEY })).toBe(true)
  })

  it('still anchors the head with an empty prevHash', () => {
    const history = buildKeyedChain()
    expect(history[0]?.prevHash).toBe('')
  })
})

describe('keyed audit chain — authentication', () => {
  it('fails verification under the wrong key', () => {
    const history = buildKeyedChain()
    const result = verifyAuditChain(history, { key: 'attacker-guess' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('HASH_MISMATCH')
  })

  it('cannot be downgraded: a keyed chain fails an UNKEYED verify', () => {
    const history = buildKeyedChain()
    expect(verifyAuditChain(history).ok).toBe(false)
  })

  it('cannot be upgraded blindly: an unkeyed chain fails a KEYED verify', () => {
    const unkeyed = appendAuditEntry([], seed('submit', '2026-01-01T00:00:00Z'))
    expect(verifyAuditChain(unkeyed, { key: KEY }).ok).toBe(false)
  })

  it('detects tampering with a committed entry', () => {
    const history = buildKeyedChain()
    const tampered = history.map((e, i) => (i === 1 ? { ...e, action: 'deny' as ApprovalHistoryEntry['action'] } : e))
    const result = verifyAuditChain(tampered, { key: KEY })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failedIndex).toBe(1)
  })

  it('resists full-chain forgery without the key (the core upgrade)', () => {
    // Attacker rewrites the history and re-seals it with the only tool they
    // have without the secret — the public unkeyed SHA-256 cascade.
    const opts = { key: KEY }
    const forged: ApprovalHistoryEntry[] = []
    const e1 = { action: 'submit' as const, at: '2026-01-01T00:00:00Z', prevHash: '' }
    forged.push({ ...e1, hash: sha256Hex(JSON.stringify({ action: e1.action, at: e1.at, prevHash: '' })) })
    // A server holding KEY rejects the forgery.
    expect(verifyAuditChain(forged, opts).ok).toBe(false)
  })
})

describe('keyed audit chain — pluggable mac', () => {
  it('round-trips with a custom mac and rejects a mismatched one', () => {
    const mac = (m: string) => `v1:${sha256Hex(m)}`
    let history: ApprovalHistoryEntry[] = []
    history = appendAuditEntry(history, seed('submit', '2026-01-01T00:00:00Z'), { mac })
    expect(history[0]?.hash?.startsWith('v1:')).toBe(true)
    expect(verifyAuditChain(history, { mac }).ok).toBe(true)
    expect(verifyAuditChain(history, { mac: (m) => `v2:${sha256Hex(m)}` }).ok).toBe(false)
  })
})
