/**
 * expandOccurrences branch coverage — issue #215.
 *
 * Covers the single-event path (overlap check true/false), resourceId
 * propagation into resourceIds[], and isRecurring derivation for detached
 * occurrences (seriesId set, rrule null).
 */
import { describe, it, expect } from 'vitest'
import { expandOccurrences } from '../expandOccurrences.js'
import { makeEvent } from '../../schema/eventSchema.js'

const rangeStart = new Date('2026-06-10T00:00:00Z')
const rangeEnd   = new Date('2026-06-11T00:00:00Z')

function singleEv(overrides: Partial<Parameters<typeof makeEvent>[1]> = {}) {
  return makeEvent('ev-test', {
    title: 'Test event',
    start: new Date('2026-06-10T09:00:00Z'),
    end:   new Date('2026-06-10T10:00:00Z'),
    ...overrides,
  })
}

describe('expandOccurrences — single events', () => {
  it('includes a single event that overlaps the range', () => {
    const ev = singleEv()
    const result = expandOccurrences([ev], rangeStart, rangeEnd)
    expect(result).toHaveLength(1)
    expect(result[0]!.eventId).toBe('ev-test')
  })

  it('excludes a single event entirely before the range', () => {
    const ev = singleEv({
      start: new Date('2026-06-09T08:00:00Z'),
      end:   new Date('2026-06-09T09:00:00Z'),
    })
    const result = expandOccurrences([ev], rangeStart, rangeEnd)
    expect(result).toHaveLength(0)
  })

  it('excludes a single event entirely after the range', () => {
    const ev = singleEv({
      start: new Date('2026-06-11T08:00:00Z'),
      end:   new Date('2026-06-11T09:00:00Z'),
    })
    const result = expandOccurrences([ev], rangeStart, rangeEnd)
    expect(result).toHaveLength(0)
  })
})

describe('expandOccurrences — resourceIds propagation', () => {
  it('populates resourceIds with [resourceId] when resourceId is set', () => {
    const ev = singleEv({ resourceId: 'room-101' } as Record<string, unknown>)
    const result = expandOccurrences([ev], rangeStart, rangeEnd)
    expect(result[0]!.resourceIds).toEqual(['room-101'])
  })

  it('populates resourceIds with [] when resourceId is null', () => {
    const ev = singleEv()
    const result = expandOccurrences([ev], rangeStart, rangeEnd)
    expect(result[0]!.resourceIds).toEqual([])
  })
})

describe('expandOccurrences — isRecurring derivation', () => {
  it('marks isRecurring true when seriesId is set even without rrule', () => {
    const ev = singleEv({ seriesId: 'master-id' } as Record<string, unknown>)
    const result = expandOccurrences([ev], rangeStart, rangeEnd)
    expect(result[0]!.isRecurring).toBe(true)
  })

  it('marks isRecurring false when both rrule and seriesId are null', () => {
    const ev = singleEv()
    const result = expandOccurrences([ev], rangeStart, rangeEnd)
    expect(result[0]!.isRecurring).toBe(false)
  })
})

describe('expandOccurrences — options', () => {
  it('accepts custom rangePadDays (non-default left side of ??)', () => {
    const ev = singleEv()
    const result = expandOccurrences([ev], rangeStart, rangeEnd, { rangePadDays: 0 })
    expect(result).toHaveLength(1)
  })

  it('returns empty array for empty event list', () => {
    expect(expandOccurrences([], rangeStart, rangeEnd)).toEqual([])
  })
})
