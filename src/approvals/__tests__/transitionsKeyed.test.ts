/**
 * transitionApproval threads audit-chain crypto options through to the
 * appended history entry, so an authenticated chain can be produced through
 * the normal reducer path (not only by calling appendAuditEntry directly).
 */
import { describe, it, expect } from 'vitest'
import { transitionApproval } from '../transitions.js'
import { verifyAuditChain } from '../auditChain.js'

const KEY = 'reducer-secret'

describe('transitionApproval — authenticated audit chain', () => {
  it('produces a chain that verifies under the key and fails without it', () => {
    const submit = transitionApproval(null, { action: 'submit', at: '2026-01-01T00:00:00Z', audit: { key: KEY } })
    expect(submit.ok).toBe(true)
    if (!submit.ok) return

    const approve = transitionApproval(submit.stage, { action: 'approve', at: '2026-01-02T00:00:00Z', audit: { key: KEY } })
    expect(approve.ok).toBe(true)
    if (!approve.ok) return

    expect(approve.stage.history).toHaveLength(2)
    expect(verifyAuditChain(approve.stage.history, { key: KEY }).ok).toBe(true)
    expect(verifyAuditChain(approve.stage.history).ok).toBe(false)
  })

  it('defaults to the unkeyed chain when no audit option is given', () => {
    const submit = transitionApproval(null, { action: 'submit', at: '2026-01-01T00:00:00Z' })
    expect(submit.ok).toBe(true)
    if (!submit.ok) return
    expect(verifyAuditChain(submit.stage.history).ok).toBe(true)
  })
})
