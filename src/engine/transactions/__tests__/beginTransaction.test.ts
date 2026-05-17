import { describe, it, expect } from 'vitest'
import { beginTransaction } from '../beginTransaction.js'
import type { EngineEvent } from '../../schema/eventSchema.js'

const emptyMap = new Map<string, EngineEvent>()

describe('beginTransaction', () => {
  it('creates a snapshot with no options', () => {
    const h = beginTransaction(emptyMap)
    expect(h.snapshot).toBeInstanceOf(Map)
    expect(h.openedAt).toMatch(/^\d{4}-/)
    expect(h.label).toBeUndefined()
    expect(h.poolsSnapshot).toBeUndefined()
  })

  it('accepts a legacy string label (covers string branch)', () => {
    const h = beginTransaction(emptyMap, 'my-tx')
    expect(h.label).toBe('my-tx')
    expect(h.poolsSnapshot).toBeUndefined()
  })

  it('accepts an options object with label', () => {
    const h = beginTransaction(emptyMap, { label: 'opts-tx' })
    expect(h.label).toBe('opts-tx')
  })

  it('accepts an options object with pools', () => {
    const pools = new Map()
    const h = beginTransaction(emptyMap, { pools })
    expect(h.poolsSnapshot).toBeInstanceOf(Map)
    expect(h.label).toBeUndefined()
  })

  it('snapshots the events map so later mutations do not affect it', () => {
    const events = new Map<string, EngineEvent>()
    const h = beginTransaction(events)
    events.set('ev-1', {} as EngineEvent)
    expect(h.snapshot.has('ev-1')).toBe(false)
  })

  it('omits label when opts object has no label property', () => {
    const h = beginTransaction(emptyMap, {})
    expect(h.label).toBeUndefined()
  })
})
