/**
 * transitions — unit specs (issue #209).
 *
 * Pins the legal-transition matrix for the 5-state approval workflow and the
 * reducer's purity / history-append contract. The Workflow DSL interpreter
 * (#219) depends on this being deterministic + side-effect-free.
 */
import { describe, it, expect } from 'vitest'
import type { ApprovalStage } from '../../types/assets.js'
import {
  LEGAL_TRANSITIONS,
  legalActionsFrom,
  transitionApproval,
} from '../transitions.js'

const AT = '2026-04-20T09:00:00.000Z'

function stage(
  s: ApprovalStage['stage'],
  counts?: ApprovalStage['counts'],
): ApprovalStage {
  return {
    stage: s,
    updatedAt: AT,
    history: [],
    ...(counts ? { counts } : {}),
  }
}

describe('transitionApproval — legal paths', () => {
  it.each(LEGAL_TRANSITIONS.filter(t => t.from !== null))(
    'allows %s --%s--> %s',
    (t) => {
      const current = stage(t.from as ApprovalStage['stage'])
      const result = transitionApproval(current, {
        action: t.action,
        at: AT,
        ...(t.action === 'deny' ? { reason: 'test' } : {}),
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.stage.stage).toBe(t.to)
    },
  )

  it('allows submit from null/undefined into `requested`', () => {
    const fromNull = transitionApproval(null, { action: 'submit', at: AT })
    const fromUndef = transitionApproval(undefined, { action: 'submit', at: AT })
    expect(fromNull.ok && fromNull.stage.stage).toBe('requested')
    expect(fromUndef.ok && fromUndef.stage.stage).toBe('requested')
  })
})

describe('transitionApproval — illegal paths', () => {
  it('rejects finalized → requested (only `revoke` can reopen)', () => {
    const result = transitionApproval(stage('finalized'), { action: 'approve', at: AT })
    expect(result).toMatchObject({ ok: false, error: { code: 'ILLEGAL_TRANSITION' } })
  })

  it('rejects denied → approved', () => {
    const result = transitionApproval(stage('denied'), { action: 'approve', at: AT })
    expect(result.ok).toBe(false)
  })

  it('rejects double-submit (requested → requested)', () => {
    const result = transitionApproval(stage('requested'), { action: 'submit', at: AT })
    expect(result.ok).toBe(false)
  })

  it('rejects finalize from requested (must pass through approved first)', () => {
    const result = transitionApproval(stage('requested'), { action: 'finalize', at: AT })
    expect(result.ok).toBe(false)
  })

  it('rejects revoke on pre-approval stages', () => {
    for (const s of ['requested', 'pending_higher'] as const) {
      const result = transitionApproval(stage(s), { action: 'revoke', at: AT })
      expect(result.ok).toBe(false)
    }
  })

  it('allows revoke from `approved` (matches default config allow: [finalize, revoke])', () => {
    const result = transitionApproval(stage('approved'), { action: 'revoke', at: AT })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.stage.stage).toBe('requested')
  })

  it('rejects unknown stages with INVALID_STAGE', () => {
    const bogus = { stage: 'bogus', updatedAt: AT, history: [] } as unknown as ApprovalStage
    const result = transitionApproval(bogus, { action: 'approve', at: AT })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_STAGE' } })
  })
})

describe('transitionApproval — deny guard', () => {
  it('requires a non-empty reason on deny', () => {
    const result = transitionApproval(stage('requested'), { action: 'deny', at: AT })
    expect(result).toMatchObject({ ok: false, error: { code: 'DENY_REQUIRES_REASON' } })
  })

  it('accepts deny when a reason is provided', () => {
    const result = transitionApproval(
      stage('requested'),
      { action: 'deny', reason: 'duplicate booking', at: AT },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.stage.stage).toBe('denied')
  })

  it('rejects deny with whitespace-only reason', () => {
    const result = transitionApproval(
      stage('requested'),
      { action: 'deny', reason: '   ', at: AT },
    )
    expect(result.ok).toBe(false)
  })
})

describe('transitionApproval — history + purity', () => {
  it('appends a history entry with actor, tier, and reason', () => {
    const result = transitionApproval(stage('requested'), {
      action: 'approve',
      actor: 'alice',
      tier: 1,
      at: AT,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stage.history).toHaveLength(1)
    expect(result.stage.history[0]).toMatchObject({
      action: 'approve',
      actor: 'alice',
      tier: 1,
      at: AT,
    })
  })

  it('does not mutate the input stage', () => {
    const current = stage('requested')
    const snapshot = JSON.stringify(current)
    transitionApproval(current, { action: 'approve', at: AT })
    expect(JSON.stringify(current)).toBe(snapshot)
  })

  it('preserves prior history in order', () => {
    const prior: ApprovalStage = {
      stage: 'requested',
      updatedAt: AT,
      history: [{ action: 'submit', at: '2026-04-19T08:00:00.000Z', actor: 'bob' }],
    }
    const result = transitionApproval(prior, { action: 'approve', actor: 'alice', at: AT })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stage.history.map(h => h.action)).toEqual(['submit', 'approve'])
  })

  it('derives updatedAt from input.at', () => {
    const result = transitionApproval(stage('requested'), { action: 'approve', at: AT })
    expect(result.ok && result.stage.updatedAt).toBe(AT)
  })
})

describe('transitionApproval — counts + single-tier shortcut', () => {
  it('increments approvals on approve and denials on deny', () => {
    const counts = { approvals: 0, denials: 0, requiredApprovals: 2 }
    const afterApprove = transitionApproval(stage('requested', counts), { action: 'approve', at: AT })
    expect(afterApprove.ok && afterApprove.stage.counts?.approvals).toBe(1)
  })

  it('single-tier (requiredApprovals=1) finalizes directly from requested on approve', () => {
    const counts = { approvals: 0, denials: 0, requiredApprovals: 1 }
    const result = transitionApproval(stage('requested', counts), { action: 'approve', at: AT })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.stage.stage).toBe('finalized')
  })

  it('multi-tier (requiredApprovals=2) still lands on `approved` first', () => {
    const counts = { approvals: 0, denials: 0, requiredApprovals: 2 }
    const result = transitionApproval(stage('requested', counts), { action: 'approve', at: AT })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.stage.stage).toBe('approved')
  })

  it('revoke resets approvals + denials to 0 while reopening to requested', () => {
    const counts = { approvals: 1, denials: 0, requiredApprovals: 2 }
    const result = transitionApproval(
      stage('finalized', counts),
      { action: 'revoke', at: AT },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stage.stage).toBe('requested')
    expect(result.stage.counts).toEqual({ approvals: 0, denials: 0, requiredApprovals: 2 })
  })
})

describe('transitionApproval — additional branch coverage', () => {
  it('uses current timestamp when at is not supplied', () => {
    // Covers the `input.at ?? new Date().toISOString()` fallback (line 225).
    const r = transitionApproval(null, { action: 'submit' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(typeof r.stage.updatedAt).toBe('string')
    expect(r.stage.updatedAt.length).toBeGreaterThan(10)
  })

  it('emits ILLEGAL_TRANSITION with "null" when from-stage is absent (null)', () => {
    // Covers the `from ?? 'null'` branch when current is null and the action
    // is not 'submit' — no valid transition exists from null for approve.
    const r = transitionApproval(null, { action: 'approve', at: AT })
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'ILLEGAL_TRANSITION', message: expect.stringContaining('"null"') },
    })
  })
})

describe('legalActionsFrom', () => {
  it('returns the entry action for null (submit only)', () => {
    expect(legalActionsFrom(null)).toEqual(['submit'])
  })

  it('returns all configured actions for requested', () => {
    const actions = legalActionsFrom('requested')
    expect(actions).toContain('approve')
    expect(actions).toContain('deny')
    expect(actions).toContain('downgrade')
    expect(actions).not.toContain('revoke')
  })

  it('returns only revoke for terminal stages', () => {
    expect(legalActionsFrom('finalized')).toEqual(['revoke'])
    expect(legalActionsFrom('denied')).toEqual(['revoke'])
  })
})
