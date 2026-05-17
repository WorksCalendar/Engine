/**
 * `gateEventRequirements` — engine-shaped gate over evaluateRequirements (#448).
 */
import { describe, it, expect } from 'vitest'
import { gateEventRequirements } from '../gateEventRequirements.js'
import type { ConfigRequirement } from '../requirementTypes.js'
import type { Assignment } from '../../engine/schema/assignmentSchema.js'
import type { EngineEvent } from '../../engine/schema/eventSchema.js'
import type { EngineResource } from '../../engine/schema/resourceSchema.js'
import type { ResourcePool } from '../../pools/resourcePoolSchema.js'

const r = (id: string, meta: Record<string, unknown> = {}): EngineResource =>
  ({ id, name: id.toUpperCase(), meta } as EngineResource)

const a = (id: string, eventId: string, resourceId: string): Assignment =>
  ({ id, eventId, resourceId, units: 100 })

const mapBy = <T extends { id: string }>(items: readonly T[]): ReadonlyMap<string, T> =>
  new Map(items.map(x => [x.id, x] as const))

const event = (id: string, category: string | null): Pick<EngineEvent, 'id' | 'category'> => ({ id, category })

describe('gateEventRequirements — no template', () => {
  it('returns the engine VALID shape when there is no matching template', () => {
    const out = gateEventRequirements({
      event: event('e1', 'unknown'),
      requirements: [{ eventType: 'load', requires: [{ role: 'driver', count: 1 }] }],
      resources: new Map(),
      assignments: new Map(),
    })
    expect(out).toEqual({
      allowed: true, severity: 'none', violations: [], suggestedPatch: null,
    })
  })

  it('returns the engine VALID shape when the event has no category', () => {
    const out = gateEventRequirements({
      event: event('e1', null),
      requirements: [{ eventType: 'load', requires: [{ role: 'driver', count: 1 }] }],
      resources: new Map(),
      assignments: new Map(),
    })
    expect(out.allowed).toBe(true)
    expect(out.violations).toEqual([])
  })
})

describe('gateEventRequirements — role shortfalls', () => {
  const requirements: ConfigRequirement[] = [
    { eventType: 'load', requires: [{ role: 'driver', count: 2 }] },
  ]
  const resources = mapBy([
    r('alice', { roles: ['driver'] }),
    r('bob',   { roles: ['dispatcher'] }),
  ])

  it('emits a hard violation when a hard role slot is unmet (default severity)', () => {
    const out = gateEventRequirements({
      event: event('e1', 'load'),
      requirements,
      resources,
      assignments: mapBy([a('a1', 'e1', 'alice')]),
    })
    expect(out.allowed).toBe(false)
    expect(out.severity).toBe('hard')
    expect(out.violations).toEqual([{
      rule: 'requirements.role',
      severity: 'hard',
      message: 'Missing 1 assignment for role "driver" (have 1 of 2).',
      details: { kind: 'role', role: 'driver', required: 2, assigned: 1, missing: 1 },
    }])
  })

  it('pluralises the message when missing >1', () => {
    const out = gateEventRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ role: 'driver', count: 3 }] }],
      resources,
      assignments: new Map(),
    })
    expect(out.violations[0]?.message).toBe('Missing 3 assignments for role "driver" (have 0 of 3).')
  })
})

describe('gateEventRequirements — soft severity stays warn-only', () => {
  it('soft shortfall → soft violation, allowed stays true', () => {
    const out = gateEventRequirements({
      event: event('e1', 'load'),
      requirements: [{
        eventType: 'load',
        requires: [{ role: 'driver', count: 1, severity: 'soft' }],
      }],
      resources: new Map(),
      assignments: new Map(),
    })
    expect(out.allowed).toBe(true)
    expect(out.severity).toBe('soft')
    expect(out.violations[0]?.severity).toBe('soft')
  })

  it('mixed hard + soft shortfalls — allowed=false, both surface', () => {
    const out = gateEventRequirements({
      event: event('e1', 'load'),
      requirements: [{
        eventType: 'load',
        requires: [
          { role: 'driver', count: 1 },                    // hard
          { role: 'helper', count: 1, severity: 'soft' },  // soft
        ],
      }],
      resources: new Map(),
      assignments: new Map(),
    })
    expect(out.allowed).toBe(false)
    expect(out.severity).toBe('hard')
    expect(out.violations.length).toBe(2)
    expect(out.violations.find(v => v.rule === 'requirements.role' && v.details?.['role'] === 'driver')?.severity).toBe('hard')
    expect(out.violations.find(v => v.rule === 'requirements.role' && v.details?.['role'] === 'helper')?.severity).toBe('soft')
  })
})

describe('gateEventRequirements — pool slots', () => {
  const trucksPool: ResourcePool = {
    id: 'trucks', name: 'Trucks', type: 'manual',
    strategy: 'first-available', memberIds: ['t1', 't2'],
  }
  const requirements: ConfigRequirement[] = [
    { eventType: 'load', requires: [{ pool: 'trucks', count: 1 }] },
  ]
  const resources = mapBy([r('t1'), r('t2')])

  it('hard pool slot unmet → hard violation', () => {
    const out = gateEventRequirements({
      event: event('e1', 'load'),
      requirements,
      resources,
      assignments: new Map(),
      pools: mapBy([trucksPool]),
    })
    expect(out.allowed).toBe(false)
    expect(out.violations[0]).toEqual({
      rule: 'requirements.pool',
      severity: 'hard',
      message: 'Missing 1 assignment from pool "trucks" (have 0 of 1).',
      details: { kind: 'pool', pool: 'trucks', required: 1, assigned: 0, missing: 1 },
    })
  })

  it('unknown pool reference → distinct rule id + poolUnknown detail', () => {
    const out = gateEventRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'ghosts', count: 1 }] }],
      resources,
      assignments: new Map(),
      pools: mapBy([trucksPool]),
    })
    expect(out.violations[0]?.rule).toBe('requirements.pool-unknown')
    expect(out.violations[0]?.details?.['poolUnknown']).toBe(true)
  })

  it('satisfied pool slot → no violation', () => {
    const out = gateEventRequirements({
      event: event('e1', 'load'),
      requirements,
      resources,
      assignments: mapBy([a('a1', 'e1', 't1')]),
      pools: mapBy([trucksPool]),
    })
    expect(out.allowed).toBe(true)
    expect(out.violations).toEqual([])
  })
})
