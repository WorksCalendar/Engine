/**
 * Truncation signalling for the raw read path (expandOccurrences).
 *
 * expandOccurrences caps each series at maxPerSeries (default 500) as a DoS
 * guardrail, but previously truncated *silently* — a long daily series would
 * just stop, producing a calendar missing occurrences with no signal. The
 * onSeriesTruncated hook makes that data loss observable without changing
 * the returned array (so it stays non-breaking).
 */
import { describe, it, expect, vi } from 'vitest'
import { expandOccurrences } from '../expandOccurrences.js'
import { makeEvent } from '../../schema/eventSchema.js'

const rangeStart = new Date('2026-06-01T00:00:00Z')
const rangeEnd   = new Date('2026-06-30T00:00:00Z')

function dailySeries() {
  return makeEvent('series-1', {
    title: 'Daily standup',
    start: new Date('2026-06-01T09:00:00Z'),
    end:   new Date('2026-06-01T09:15:00Z'),
    rrule: 'FREQ=DAILY',
  })
}

describe('expandOccurrences — truncation signal', () => {
  it('fires onSeriesTruncated when a series is clipped by maxPerSeries', () => {
    const onSeriesTruncated = vi.fn()
    const out = expandOccurrences([dailySeries()], rangeStart, rangeEnd, {
      maxPerSeries: 3,
      onSeriesTruncated,
    })
    expect(out.length).toBeLessThanOrEqual(3)
    expect(onSeriesTruncated).toHaveBeenCalledTimes(1)
    expect(onSeriesTruncated).toHaveBeenCalledWith({ eventId: 'series-1', maxPerSeries: 3 })
  })

  it('does not fire when the series fits under the cap', () => {
    const onSeriesTruncated = vi.fn()
    expandOccurrences([dailySeries()], rangeStart, rangeEnd, {
      maxPerSeries: 1000,
      onSeriesTruncated,
    })
    expect(onSeriesTruncated).not.toHaveBeenCalled()
  })

  it('preserves capped occurrences even when onSeriesTruncated throws', () => {
    // Side-effect-only contract: a buggy host telemetry callback must not
    // discard the validly-capped series (regression guard — otherwise
    // expandRecurrenceSafe would catch this and drop the occurrences).
    const out = expandOccurrences([dailySeries()], rangeStart, rangeEnd, {
      maxPerSeries: 3,
      onSeriesTruncated: () => { throw new Error('telemetry boom') },
    })
    expect(out.length).toBeLessThanOrEqual(3)
    expect(out.length).toBeGreaterThan(0)
  })

  it('truncation output is identical whether or not the hook is supplied', () => {
    const withHook = expandOccurrences([dailySeries()], rangeStart, rangeEnd, {
      maxPerSeries: 3,
      onSeriesTruncated: vi.fn(),
    })
    const without = expandOccurrences([dailySeries()], rangeStart, rangeEnd, { maxPerSeries: 3 })
    expect(withHook.length).toBe(without.length)
  })
})
