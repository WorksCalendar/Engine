/**
 * evaluateAvailability — unit specs (issue #214).
 *
 * Pure function that decides whether a (resource, window) pair is open
 * given the resource's `availability` rule set. Pins semantics for:
 *   - empty rule set → always open
 *   - weekly open-window coverage (single + union)
 *   - blackouts winning over opens
 *   - timezone awareness
 */
import { describe, it, expect } from 'vitest'
import {
  evaluateAvailability,
  findBlockingBlackout,
  type AvailabilityWindow,
} from '../evaluateAvailability.js'
import type { AvailabilityRule } from '../availabilityRule.js'

const win = (s: string, e: string): AvailabilityWindow => ({ start: s, end: e })

describe('evaluateAvailability — empty / no-open rule sets', () => {
  it('returns ok for an empty rule set', () => {
    const result = evaluateAvailability({
      window: win('2026-04-20T10:00:00Z', '2026-04-20T11:00:00Z'),
      rules: [],
    })
    expect(result.ok).toBe(true)
  })

  it('blackout-only rules do NOT implicitly close the day', () => {
    const rules: AvailabilityRule[] = [
      { id: 'b', kind: 'blackout', start: '2026-12-25T00:00:00Z', end: '2026-12-26T00:00:00Z', reason: 'Christmas' },
    ]
    const result = evaluateAvailability({
      window: win('2026-04-20T10:00:00Z', '2026-04-20T11:00:00Z'),
      rules,
    })
    expect(result.ok).toBe(true)
  })
})

describe('evaluateAvailability — weekly open rules', () => {
  const weekday9to5: AvailabilityRule = {
    id: 'biz', kind: 'open', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00',
  }

  it('accepts a window entirely inside an open weekday', () => {
    // 2026-04-20 is a Monday.
    const result = evaluateAvailability({
      window: win('2026-04-20T10:00:00Z', '2026-04-20T11:00:00Z'),
      rules: [weekday9to5],
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a window on a closed day with closed-day reason', () => {
    // 2026-04-19 is a Sunday.
    const result = evaluateAvailability({
      window: win('2026-04-19T10:00:00Z', '2026-04-19T11:00:00Z'),
      rules: [weekday9to5],
    })
    expect(result).toMatchObject({ ok: false, reason: 'closed-day' })
  })

  it('rejects a window that starts before open hours', () => {
    const result = evaluateAvailability({
      window: win('2026-04-20T08:00:00Z', '2026-04-20T10:00:00Z'),
      rules: [weekday9to5],
    })
    expect(result).toMatchObject({ ok: false, reason: 'outside-open-hours' })
  })

  it('rejects a window that ends after close', () => {
    const result = evaluateAvailability({
      window: win('2026-04-20T16:00:00Z', '2026-04-20T18:00:00Z'),
      rules: [weekday9to5],
    })
    expect(result).toMatchObject({ ok: false, reason: 'outside-open-hours' })
  })

  it('accepts a window covered by the union of two split open rules', () => {
    // 09:00–12:00 + 13:00–17:00 — window 10:00–14:00 spans the gap, NOT covered.
    // But window 09:00–12:00 IS covered.
    const split: AvailabilityRule[] = [
      { id: 'am', kind: 'open', days: [1], start: '09:00', end: '12:00' },
      { id: 'pm', kind: 'open', days: [1], start: '13:00', end: '17:00' },
    ]
    const inAm = evaluateAvailability({
      window: win('2026-04-20T09:00:00Z', '2026-04-20T12:00:00Z'),
      rules: split,
    })
    const acrossGap = evaluateAvailability({
      window: win('2026-04-20T12:00:00Z', '2026-04-20T13:00:00Z'),
      rules: split,
    })
    expect(inAm.ok).toBe(true)
    expect(acrossGap.ok).toBe(false)
  })

  it('merges overlapping same-day open rules', () => {
    // 09:00–13:00 + 12:00–17:00 merge → 09:00–17:00.
    const rules: AvailabilityRule[] = [
      { id: 'r1', kind: 'open', days: [1], start: '09:00', end: '13:00' },
      { id: 'r2', kind: 'open', days: [1], start: '12:00', end: '17:00' },
    ]
    const result = evaluateAvailability({
      window: win('2026-04-20T10:00:00Z', '2026-04-20T16:00:00Z'),
      rules,
    })
    expect(result.ok).toBe(true)
  })
})

describe('evaluateAvailability — blackouts', () => {
  const weekday9to5: AvailabilityRule = {
    id: 'biz', kind: 'open', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00',
  }

  it('blocks an otherwise-open window that overlaps a blackout', () => {
    const rules: AvailabilityRule[] = [
      weekday9to5,
      { id: 'maint', kind: 'blackout', start: '2026-04-20T10:00:00Z', end: '2026-04-20T12:00:00Z', reason: 'Patch' },
    ]
    const result = evaluateAvailability({
      window: win('2026-04-20T10:30:00Z', '2026-04-20T11:00:00Z'),
      rules,
    })
    expect(result).toMatchObject({
      ok: false,
      reason: 'blackout',
      ruleId: 'maint',
    })
    expect((result as { message?: string }).message).toContain('Patch')
  })

  it('allows an open window that ends exactly at the blackout start (half-open)', () => {
    const rules: AvailabilityRule[] = [
      weekday9to5,
      { id: 'maint', kind: 'blackout', start: '2026-04-20T11:00:00Z', end: '2026-04-20T12:00:00Z' },
    ]
    const result = evaluateAvailability({
      window: win('2026-04-20T10:00:00Z', '2026-04-20T11:00:00Z'),
      rules,
    })
    expect(result.ok).toBe(true)
  })

  it('findBlockingBlackout returns the first overlapping blackout', () => {
    const rules: AvailabilityRule[] = [
      { id: 'b1', kind: 'blackout', start: '2026-04-20T10:00:00Z', end: '2026-04-20T11:00:00Z' },
      { id: 'b2', kind: 'blackout', start: '2026-04-20T14:00:00Z', end: '2026-04-20T15:00:00Z' },
    ]
    const hit = findBlockingBlackout(
      win('2026-04-20T10:30:00Z', '2026-04-20T10:45:00Z'),
      rules,
    )
    expect(hit?.id).toBe('b1')
  })

  it('findBlockingBlackout returns null when no overlap', () => {
    const rules: AvailabilityRule[] = [
      { id: 'b1', kind: 'blackout', start: '2026-04-20T10:00:00Z', end: '2026-04-20T11:00:00Z' },
    ]
    expect(findBlockingBlackout(
      win('2026-04-20T11:00:00Z', '2026-04-20T12:00:00Z'),
      rules,
    )).toBeNull()
  })
})

describe('evaluateAvailability — multi-day windows', () => {
  const weekday9to5: AvailabilityRule = {
    id: 'biz', kind: 'open', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00',
  }

  it('rejects a window that spans a closed day', () => {
    // 2026-04-20 Mon 10:00 → 2026-04-21 Tue 10:00 UTC.
    // Rule says weekdays 09:00–17:00. Mon segment 10–24 exceeds 17:00,
    // so the chain must fail. This is the regression test for the bug
    // where only the start day's hours were checked.
    const result = evaluateAvailability({
      window: win('2026-04-20T10:00:00Z', '2026-04-21T10:00:00Z'),
      rules: [weekday9to5],
    })
    expect(result).toMatchObject({ ok: false, reason: 'outside-open-hours' })
  })

  it('rejects a window that spans a weekend closed day', () => {
    // 2026-04-25 Sat 10:00 → 2026-04-26 Sun 12:00 UTC. Both days are
    // absent from the weekday rule — the first segment already trips
    // the closed-day branch.
    const result = evaluateAvailability({
      window: win('2026-04-25T10:00:00Z', '2026-04-26T12:00:00Z'),
      rules: [weekday9to5],
    })
    expect(result).toMatchObject({ ok: false, reason: 'closed-day' })
  })

  it('accepts a two-day window when every touched day is 24/7 open', () => {
    const allDay: AvailabilityRule = {
      id: '24x7', kind: 'open', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '24:00',
    }
    const result = evaluateAvailability({
      window: win('2026-04-20T10:00:00Z', '2026-04-22T10:00:00Z'),
      rules: [allDay],
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a window that ends exactly at midnight on the same day', () => {
    // Window Mon 10:00 → Tue 00:00 UTC: collapses to a single Mon segment
    // 10:00–24:00. A rule 09:00–24:00 covers it.
    const until24: AvailabilityRule = {
      id: 'late', kind: 'open', days: [1], start: '09:00', end: '24:00',
    }
    const result = evaluateAvailability({
      window: win('2026-04-20T10:00:00Z', '2026-04-21T00:00:00Z'),
      rules: [until24],
    })
    expect(result.ok).toBe(true)
  })

  it('terminates on DST-at-midnight zones without stalling', () => {
    // Regression: some zones (e.g. Asia/Gaza around 2026-03-27) shift the
    // local clock forward AT midnight, so `wallClockToUtc(day+1, 00:00)`
    // can return a timestamp <= the cursor. The walker must still make
    // forward progress and either return a finite segment list or pass.
    const allDay: AvailabilityRule = {
      id: '24x7', kind: 'open', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '24:00',
    }
    const started = Date.now()
    const result = evaluateAvailability({
      window: win('2026-03-26T00:00:00Z', '2026-03-29T00:00:00Z'),
      rules: [allDay],
      timezone: 'Asia/Gaza',
    })
    expect(Date.now() - started).toBeLessThan(2000) // sanity: not hanging
    expect(result.ok).toBe(true)
  })
})

describe('evaluateAvailability — timezone awareness', () => {
  // 2026-04-19 23:30 UTC is 2026-04-20 08:30 in Tokyo (UTC+9) — a Monday morning.
  it('evaluates day-of-week in the resource timezone', () => {
    const rule: AvailabilityRule = {
      id: 'tok', kind: 'open', days: [1], start: '08:00', end: '18:00',
    }
    const utcSundayLate = evaluateAvailability({
      window: win('2026-04-19T23:30:00Z', '2026-04-19T23:45:00Z'),
      rules: [rule],
      timezone: 'Asia/Tokyo',
    })
    expect(utcSundayLate.ok).toBe(true)
  })

  it('defaults to UTC when no timezone is provided', () => {
    const rule: AvailabilityRule = {
      id: 'utc', kind: 'open', days: [0], start: '23:00', end: '24:00',
    }
    const result = evaluateAvailability({
      window: win('2026-04-19T23:30:00Z', '2026-04-19T23:45:00Z'),
      rules: [rule],
    })
    expect(result.ok).toBe(true)
  })
})
