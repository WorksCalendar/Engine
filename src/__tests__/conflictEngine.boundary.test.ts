/**
 * Boundary / fail-closed hardening for evaluateConflicts.
 *
 * The half-open overlap test (`aStart < bEnd && bStart < aEnd`) silently
 * returns false for any NaN date. Before hardening, a malformed proposed
 * `start`/`end` therefore reported the event as conflict-free and let the
 * booking through — a fail-*open* security bug for a conflict detector.
 * These tests lock the fail-*closed* contract.
 */
import { describe, it, expect, vi } from 'vitest'
import { evaluateConflicts, type ConflictEvent, type ConflictRule } from '../conflictEngine.js'

const OVERLAP_RULE: ConflictRule = { id: 'no-overlap', type: 'resource-overlap', severity: 'hard' }

const valid = (over: Partial<ConflictEvent> = {}): ConflictEvent => ({
  id: 'p1',
  start: '2026-06-01T08:00:00Z',
  end: '2026-06-01T16:00:00Z',
  resource: 'alice',
  ...over,
})

describe('evaluateConflicts — invalid proposed window (fail-closed)', () => {
  it('blocks a proposed event with a non-parseable start, even with no other events', () => {
    const result = evaluateConflicts({
      proposed: valid({ start: 'not-a-date' }),
      events: [],
      rules: [OVERLAP_RULE],
    })
    expect(result.allowed).toBe(false)
    expect(result.severity).toBe('hard')
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]?.rule).toBe('invalid-window')
  })

  it('blocks a proposed event with an invalid end', () => {
    const result = evaluateConflicts({
      proposed: valid({ end: '' }),
      events: [],
      rules: [OVERLAP_RULE],
    })
    expect(result.allowed).toBe(false)
  })

  it('does not silently allow when a real overlap exists but the proposed window is invalid', () => {
    // Pre-hardening this returned allowed:true (overlap test is false for NaN).
    const overlapping = valid({ id: 'existing' })
    const result = evaluateConflicts({
      proposed: valid({ id: 'p1', start: NaN as unknown as number }),
      events: [overlapping],
      rules: [OVERLAP_RULE],
    })
    expect(result.allowed).toBe(false)
    expect(result.violations[0]?.rule).toBe('invalid-window')
  })

  it('reports the invalid window through onError with a stable code', () => {
    const onError = vi.fn()
    evaluateConflicts({
      proposed: valid({ start: 'garbage' }),
      events: [],
      rules: [OVERLAP_RULE],
      onError,
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      code: 'CONFLICT_INVALID_PROPOSED_WINDOW',
      domain: 'validation',
      recoverable: false,
    })
  })
})

describe('evaluateConflicts — malformed stored events', () => {
  it('signals (via onError) but does not let a corrupt stored event mask a real conflict', () => {
    const onError = vi.fn()
    const corrupt = valid({ id: 'corrupt', start: 'broken' })
    const realConflict = valid({ id: 'real' })
    const result = evaluateConflicts({
      proposed: valid({ id: 'p1' }),
      events: [corrupt, realConflict],
      rules: [OVERLAP_RULE],
      onError,
    })
    // The real overlap is still detected.
    expect(result.allowed).toBe(false)
    expect(result.violations.some((v) => v.conflictingEventId === 'real')).toBe(true)
    // The corrupt row was reported.
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CONFLICT_MALFORMED_EVENT_SKIPPED' }),
      expect.objectContaining({ eventId: 'corrupt' }),
    )
  })

  it('stays on the zero-cost fast path when no onError is supplied', () => {
    // A corrupt stored event must not throw or change the verdict when the
    // caller hasn't opted into signalling.
    const result = evaluateConflicts({
      proposed: valid({ id: 'p1' }),
      events: [valid({ id: 'corrupt', start: 'broken' })],
      rules: [OVERLAP_RULE],
    })
    expect(result.allowed).toBe(true)
  })
})

describe('evaluateConflicts — valid input regression', () => {
  it('still detects a genuine same-resource overlap', () => {
    const result = evaluateConflicts({
      proposed: valid({ id: 'p1' }),
      events: [valid({ id: 'existing' })],
      rules: [OVERLAP_RULE],
    })
    expect(result.allowed).toBe(false)
    expect(result.violations[0]?.rule).toBe('no-overlap')
  })

  it('still allows a clean booking', () => {
    const result = evaluateConflicts({
      proposed: valid({ id: 'p1', start: '2026-06-02T08:00:00Z', end: '2026-06-02T16:00:00Z' }),
      events: [valid({ id: 'existing' })],
      rules: [OVERLAP_RULE],
    })
    expect(result.allowed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })
})
