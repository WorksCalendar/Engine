/**
 * `evaluateRequirements` — runtime consumer for the
 * `CalendarConfig.requirements` templates (#386).
 */
import { describe, it, expect } from 'vitest'
import { evaluateRequirements } from '../evaluateRequirements.js'
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

describe('evaluateRequirements — no template / no category', () => {
  it('reports satisfied + noTemplate when event.category is null', () => {
    const out = evaluateRequirements({
      event: event('e1', null),
      requirements: [],
      resources: new Map(),
      assignments: new Map(),
    })
    expect(out).toEqual({ satisfied: true, missing: [], noTemplate: true })
  })

  it('reports satisfied + noTemplate when no template matches the category', () => {
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'maintenance', requires: [{ role: 'tech', count: 1 }] }],
      resources: new Map(),
      assignments: new Map(),
    })
    expect(out).toEqual({ satisfied: true, missing: [], noTemplate: true })
  })
})

describe('evaluateRequirements — role slots', () => {
  const requirements: ConfigRequirement[] = [
    { eventType: 'load', requires: [{ role: 'driver', count: 2 }] },
  ]
  const resources = mapBy([
    r('alice', { roles: ['driver'] }),
    r('bob',   { roles: ['driver', 'dispatcher'] }),
    r('carol', { roles: ['dispatcher'] }),
    r('truck', { /* no roles meta */ }),
  ])

  it('counts assignments whose resource is tagged with the required role', () => {
    const assignments = mapBy([a('a1', 'e1', 'alice'), a('a2', 'e1', 'bob')])
    const out = evaluateRequirements({ event: event('e1', 'load'), requirements, resources, assignments })
    expect(out.satisfied).toBe(true)
    expect(out.missing).toEqual([])
  })

  it('reports a role shortfall with the correct missing count', () => {
    const assignments = mapBy([a('a1', 'e1', 'alice')])
    const out = evaluateRequirements({ event: event('e1', 'load'), requirements, resources, assignments })
    expect(out.satisfied).toBe(false)
    expect(out.missing).toEqual([{ kind: 'role', role: 'driver', required: 2, assigned: 1, missing: 1, severity: 'hard' }])
  })

  it('ignores assignments to other events', () => {
    const assignments = mapBy([
      a('a1', 'e1', 'alice'),
      a('a2', 'e2', 'bob'),     // different event
    ])
    const out = evaluateRequirements({ event: event('e1', 'load'), requirements, resources, assignments })
    expect(out.satisfied).toBe(false)
    expect(out.missing[0]?.assigned).toBe(1)
  })

  it('ignores resources without a roles tag (driver requires the meta)', () => {
    const assignments = mapBy([a('a1', 'e1', 'truck')])  // no roles meta
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ role: 'driver', count: 1 }] }],
      resources, assignments,
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing[0]?.assigned).toBe(0)
  })

  it('counts resources tagged with multiple roles toward each matching slot', () => {
    // Bob is both driver + dispatcher. The event needs 1 of each;
    // a single Bob assignment satisfies both slots.
    const assignments = mapBy([a('a1', 'e1', 'bob')])
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{
        eventType: 'load',
        requires: [
          { role: 'driver', count: 1 },
          { role: 'dispatcher', count: 1 },
        ],
      }],
      resources, assignments,
    })
    expect(out.satisfied).toBe(true)
  })
})

describe('evaluateRequirements — per-assignment roleId (#449)', () => {
  // Resources tagged with static meta.roles to verify the override
  // takes precedence; same fixture as the role-slots block.
  const resources = mapBy([
    r('alice',   { roles: ['driver'] }),
    r('bob',     { roles: ['driver', 'dispatcher'] }),
    r('untagged', {}),
  ])

  it('an assignment with roleId counts toward that role even when the resource lacks the tag', () => {
    // 'untagged' has no meta.roles, but the assignment pins it as a
    // dispatcher for this specific event — should satisfy a 1-dispatcher
    // requirement.
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ role: 'dispatcher', count: 1 }] }],
      resources,
      assignments: mapBy([
        { id: 'a1', eventId: 'e1', resourceId: 'untagged', units: 100, roleId: 'dispatcher' },
      ]),
    })
    expect(out.satisfied).toBe(true)
  })

  it('roleId overrides static meta.roles for the slot match', () => {
    // Bob is statically tagged as both driver + dispatcher. The
    // assignment pins him as dispatcher this time — he should NOT
    // count toward a driver requirement, even though meta.roles
    // includes 'driver'.
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ role: 'driver', count: 1 }] }],
      resources,
      assignments: mapBy([
        { id: 'a1', eventId: 'e1', resourceId: 'bob', units: 100, roleId: 'dispatcher' },
      ]),
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing[0]?.assigned).toBe(0)
  })

  it('falls back to static meta.roles when roleId is omitted (v1 contract)', () => {
    // Alice has no roleId on her assignment, so the resource's
    // meta.roles drives the count. Should still work like before.
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ role: 'driver', count: 1 }] }],
      resources,
      assignments: mapBy([a('a1', 'e1', 'alice')]),
    })
    expect(out.satisfied).toBe(true)
  })

  it('stale assignment with roleId does not satisfy a slot when the resource is missing', () => {
    // The resource was deleted but the assignment record was retained.
    // Even though roleId matches, the phantom resource must not count.
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ role: 'dispatcher', count: 1 }] }],
      resources,  // 'ghost' is not in this map
      assignments: mapBy([
        { id: 'a1', eventId: 'e1', resourceId: 'ghost', units: 100, roleId: 'dispatcher' },
      ]),
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing[0]?.assigned).toBe(0)
  })

  it('mixed assignments — some with roleId, some without — count correctly', () => {
    // Need 2 drivers. Alice (static) + bob acting-as driver = 2.
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ role: 'driver', count: 2 }] }],
      resources,
      assignments: mapBy([
        a('a1', 'e1', 'alice'),                                                                // static driver
        { id: 'a2', eventId: 'e1', resourceId: 'untagged', units: 100, roleId: 'driver' },   // acting-as
      ]),
    })
    expect(out.satisfied).toBe(true)
  })
})

describe('evaluateRequirements — pool slots', () => {
  const truck = (id: string, refrigerated = false) =>
    r(id, { type: 'vehicle', capabilities: { refrigerated } })

  const resources = mapBy([
    truck('t1'),
    truck('t2'),
    truck('reefer-1', true),
    truck('reefer-2', true),
  ])

  const fleetPool: ResourcePool = {
    id: 'fleet', name: 'Fleet',
    memberIds: ['t1', 't2'],
    strategy: 'first-available',
  }
  const reeferPool: ResourcePool = {
    id: 'reefers', name: 'Reefers',
    type: 'query', memberIds: [],
    query: { op: 'eq', path: 'meta.capabilities.refrigerated', value: true },
    strategy: 'first-available',
  }

  it('counts assignments whose resource is in the manual pool', () => {
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'fleet', count: 1 }] }],
      resources,
      pools: mapBy([fleetPool]),
      assignments: mapBy([a('a1', 'e1', 't1')]),
    })
    expect(out.satisfied).toBe(true)
  })

  it('reports a shortfall with required / assigned / missing counts', () => {
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'fleet', count: 2 }] }],
      resources,
      pools: mapBy([fleetPool]),
      assignments: mapBy([a('a1', 'e1', 't1')]),
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing).toEqual([{ kind: 'pool', pool: 'fleet', required: 2, assigned: 1, missing: 1, severity: 'hard' }])
  })

  it('runs the query for query pools', () => {
    // Two reefer assignments → query pool requirement of 2 is met
    // even though `memberIds: []` would say "no members" if we only
    // looked there.
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'reefers', count: 2 }] }],
      resources,
      pools: mapBy([reeferPool]),
      assignments: mapBy([
        a('a1', 'e1', 'reefer-1'),
        a('a2', 'e1', 'reefer-2'),
      ]),
    })
    expect(out.satisfied).toBe(true)
  })

  it('intersects memberIds with the query for hybrid pools', () => {
    const hybrid: ResourcePool = {
      id: 'curated-reefers', name: 'Curated Reefers',
      type: 'hybrid', memberIds: ['reefer-1'],     // only one curated
      query: { op: 'eq', path: 'meta.capabilities.refrigerated', value: true },
      strategy: 'first-available',
    }
    // reefer-2 matches the query but isn't in memberIds → doesn't
    // count toward the hybrid pool slot.
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'curated-reefers', count: 1 }] }],
      resources,
      pools: mapBy([hybrid]),
      assignments: mapBy([a('a1', 'e1', 'reefer-2')]),
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing[0]?.assigned).toBe(0)
  })

  it('flags poolUnknown when the slot references a pool not in the map', () => {
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'ghost', count: 1 }] }],
      resources,
      pools: mapBy([fleetPool]),
      assignments: new Map(),
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing[0]).toMatchObject({ kind: 'pool', pool: 'ghost', poolUnknown: true, assigned: 0 })
  })

  it('ignores assignments to resources not in the registry (#386 P1)', () => {
    // Manual pool's memberIds include a stale id whose resource was
    // deleted. An assignment still references the deleted id — without
    // the registry check, that phantom assignment would falsely
    // satisfy the slot.
    const stalePool: ResourcePool = {
      id: 'fleet', name: 'Fleet',
      memberIds: ['t1', 'gone'],   // 'gone' isn't in resources
      strategy: 'first-available',
    }
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'fleet', count: 1 }] }],
      resources,                                          // does NOT include 'gone'
      pools: mapBy([stalePool]),
      assignments: mapBy([a('a1', 'e1', 'gone')]),        // assignment to deleted resource
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing[0]?.assigned).toBe(0)
  })

  it('treats a malformed query as zero members instead of throwing (#386 P2)', () => {
    // A pool's `query` field is loosely validated by parseConfig as
    // "any object" — a malformed `{}` can survive parsing and would
    // crash evaluateQuery (path.startsWith on undefined). The
    // evaluator's documented "never throws" contract requires a
    // graceful zero-members fallback.
    const broken: ResourcePool = {
      id: 'broken', name: 'Broken',
      type: 'query', memberIds: [],
      query: {} as never,                     // malformed by design
      strategy: 'first-available',
    }
    expect(() => evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'broken', count: 1 }] }],
      resources,
      pools: mapBy([broken]),
      assignments: mapBy([a('a1', 'e1', 't1')]),
    })).not.toThrow()
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'broken', count: 1 }] }],
      resources,
      pools: mapBy([broken]),
      assignments: mapBy([a('a1', 'e1', 't1')]),
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing[0]?.assigned).toBe(0)
  })

  it('treats a query/hybrid pool with no query as zero members (defensive)', () => {
    const broken: ResourcePool = {
      id: 'broken', name: 'Broken',
      type: 'query', memberIds: [],
      strategy: 'first-available',
      // no query — parseConfig drops these at load time, but a host
      // that constructs runtime pools directly might still hand one in.
    }
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'broken', count: 1 }] }],
      resources,
      pools: mapBy([broken]),
      assignments: mapBy([a('a1', 'e1', 't1')]),  // assignment exists, but pool has no members
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing[0]?.assigned).toBe(0)
  })
})

describe('evaluateRequirements — soft requirements (#450)', () => {
  const resources = mapBy([
    r('alice', { roles: ['driver'] }),
  ])

  it('a slot defaults to severity:hard when omitted', () => {
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ role: 'note-taker', count: 1 }] }],
      resources,
      assignments: new Map(),
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing[0]?.severity).toBe('hard')
  })

  it('soft shortfalls surface in missing[] but do NOT flip satisfied', () => {
    // Need a driver (hard, satisfied) + note-taker (soft, unmet).
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{
        eventType: 'load',
        requires: [
          { role: 'driver',     count: 1, severity: 'hard' },
          { role: 'note-taker', count: 1, severity: 'soft' },
        ],
      }],
      resources,
      assignments: mapBy([a('a1', 'e1', 'alice')]),
    })
    expect(out.satisfied).toBe(true)             // hard requirement met
    expect(out.missing.length).toBe(1)           // soft shortfall surfaced
    expect(out.missing[0]?.severity).toBe('soft')
    expect(out.missing[0]).toMatchObject({ kind: 'role', role: 'note-taker', missing: 1 })
  })

  it('hard + soft both unmet → satisfied is false (hard drives the gate)', () => {
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{
        eventType: 'load',
        requires: [
          { role: 'driver',     count: 1, severity: 'hard' },
          { role: 'note-taker', count: 1, severity: 'soft' },
        ],
      }],
      resources,
      assignments: new Map(),
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing.map(m => m.severity)).toEqual(['hard', 'soft'])
  })

  it('only-soft requirements never block — satisfied:true even when fully unmet', () => {
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{
        eventType: 'load',
        requires: [{ role: 'note-taker', count: 2, severity: 'soft' }],
      }],
      resources,
      assignments: new Map(),
    })
    expect(out.satisfied).toBe(true)
    expect(out.missing[0]?.severity).toBe('soft')
  })
})

describe('evaluateRequirements — mixed slots', () => {
  it('reports every shortfall in input order', () => {
    const resources = mapBy([
      r('alice', { roles: ['driver'] }),
      r('truck', {}),
    ])
    const pool: ResourcePool = {
      id: 'fleet', name: 'Fleet', memberIds: ['truck'], strategy: 'first-available',
    }
    const out = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{
        eventType: 'load',
        requires: [
          { role: 'driver', count: 2 },
          { pool: 'fleet',  count: 2 },
        ],
      }],
      resources,
      pools: mapBy([pool]),
      assignments: mapBy([a('a1', 'e1', 'alice'), a('a2', 'e1', 'truck')]),
    })
    expect(out.satisfied).toBe(false)
    expect(out.missing).toEqual([
      { kind: 'role', role: 'driver', required: 2, assigned: 1, missing: 1, severity: 'hard' },
      { kind: 'pool', pool: 'fleet',  required: 2, assigned: 1, missing: 1, severity: 'hard' },
    ])
  })
})

describe('evaluateRequirements — proposedLocation passthrough', () => {
  it('feeds proposedLocation into evaluateQuery so distance pools resolve', () => {
    const SLC = { lat: 40.7608, lon: -111.8910 }
    const reefer = (id: string, lat: number, lon: number) =>
      r(id, { capabilities: { refrigerated: true }, location: { lat, lon } })
    const resources = mapBy([
      reefer('near', SLC.lat, SLC.lon),
      reefer('far',  37.6189, -122.3750),  // SFO — ~600 mi away
    ])
    const pool: ResourcePool = {
      id: 'nearby', name: 'Nearby Reefers', type: 'query', memberIds: [],
      query: {
        op: 'and',
        clauses: [
          { op: 'eq',     path: 'meta.capabilities.refrigerated', value: true },
          { op: 'within', path: 'meta.location', from: { kind: 'proposed' }, miles: 50 },
        ],
      },
      strategy: 'first-available',
    }
    // Without proposedLocation, the within(proposed) clause fails-closed
    // and no resource matches → assigning 'near' doesn't satisfy the slot.
    const withoutLoc = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'nearby', count: 1 }] }],
      resources,
      pools: mapBy([pool]),
      assignments: mapBy([a('a1', 'e1', 'near')]),
    })
    expect(withoutLoc.satisfied).toBe(false)
    // With proposedLocation, the same data resolves correctly.
    const withLoc = evaluateRequirements({
      event: event('e1', 'load'),
      requirements: [{ eventType: 'load', requires: [{ pool: 'nearby', count: 1 }] }],
      resources,
      pools: mapBy([pool]),
      assignments: mapBy([a('a1', 'e1', 'near')]),
      proposedLocation: SLC,
    })
    expect(withLoc.satisfied).toBe(true)
  })
})
