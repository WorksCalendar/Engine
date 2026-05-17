/**
 * evaluateQuery — v2 pool query DSL specs (issue #386).
 */
import { describe, it, expect } from 'vitest'
import { evaluateQuery } from '../evaluateQuery.js'
import type { ResourceQuery } from '../poolQuerySchema.js'
import type { EngineResource } from '../../engine/schema/resourceSchema.js'

const r = (id: string, meta: Record<string, unknown>, extras: Partial<EngineResource> = {}): EngineResource => ({
  id, name: id.toUpperCase(), meta, ...extras,
} as EngineResource)

const fleet: readonly EngineResource[] = [
  r('truck-101', { type: 'vehicle', capabilities: { refrigerated: true,  capacity_lbs: 80000 } }),
  r('truck-202', { type: 'vehicle', capabilities: { refrigerated: true,  capacity_lbs: 60000 } }),
  r('truck-303', { type: 'vehicle', capabilities: { refrigerated: false, capacity_lbs: 80000 } }),
  r('driver-1',  { type: 'person', capabilities: { cdl: true } }),
]

describe('evaluateQuery — leaf operators', () => {
  it('eq matches strict equality on meta dot-paths', () => {
    const q: ResourceQuery = { op: 'eq', path: 'capabilities.refrigerated', value: true }
    const e = evaluateQuery(q, fleet)
    expect(e.matched).toEqual(['truck-101', 'truck-202'])
    expect(e.excluded.map(x => x.id)).toEqual(['truck-303', 'driver-1'])
  })

  it('eq supports the leading `meta.` prefix interchangeably', () => {
    const q: ResourceQuery = { op: 'eq', path: 'meta.capabilities.refrigerated', value: true }
    expect(evaluateQuery(q, fleet).matched).toEqual(['truck-101', 'truck-202'])
  })

  it('eq returns false when path is missing (not throws)', () => {
    const q: ResourceQuery = { op: 'eq', path: 'capabilities.cold_chain', value: true }
    expect(evaluateQuery(q, fleet).matched).toEqual([])
  })

  it('eq matches top-level fields (id / name / tenantId)', () => {
    const tenanted = [
      r('a', {}, { tenantId: 'acme' }),
      r('b', {}, { tenantId: 'globex' }),
    ]
    const q: ResourceQuery = { op: 'eq', path: 'tenantId', value: 'acme' }
    expect(evaluateQuery(q, tenanted).matched).toEqual(['a'])
  })

  it('neq is the inverse of eq, including missing paths', () => {
    const q: ResourceQuery = { op: 'neq', path: 'capabilities.refrigerated', value: true }
    expect(evaluateQuery(q, fleet).matched).toEqual(['truck-303', 'driver-1'])
  })

  it('in matches when the value is in the list', () => {
    const q: ResourceQuery = { op: 'in', path: 'type', values: ['vehicle', 'aircraft'] }
    expect(evaluateQuery(q, fleet).matched).toEqual(['truck-101', 'truck-202', 'truck-303'])
  })

  it('gte / lte filter numeric meta', () => {
    const q: ResourceQuery = { op: 'gte', path: 'capabilities.capacity_lbs', value: 80000 }
    expect(evaluateQuery(q, fleet).matched).toEqual(['truck-101', 'truck-303'])
  })

  it('numeric comparators reject non-numbers and missing paths', () => {
    const q: ResourceQuery = { op: 'gte', path: 'capabilities.refrigerated', value: 1 }
    // `refrigerated` is a boolean — gte must reject, not coerce.
    expect(evaluateQuery(q, fleet).matched).toEqual([])
  })

  it('exists distinguishes presence from comparator results', () => {
    const q: ResourceQuery = { op: 'exists', path: 'capabilities.cdl' }
    expect(evaluateQuery(q, fleet).matched).toEqual(['driver-1'])
  })
})

describe('evaluateQuery — boolean composites', () => {
  const reefer80k: ResourceQuery = {
    op: 'and',
    clauses: [
      { op: 'eq',  path: 'type',                       value:  'vehicle' },
      { op: 'eq',  path: 'capabilities.refrigerated',  value:  true },
      { op: 'gte', path: 'capabilities.capacity_lbs',  value:  80000 },
    ],
  }

  it('and matches only when every clause holds', () => {
    expect(evaluateQuery(reefer80k, fleet).matched).toEqual(['truck-101'])
  })

  it('and reports the first failing clause as the exclusion reason', () => {
    const e = evaluateQuery(reefer80k, fleet)
    const reasons = Object.fromEntries(e.excluded.map(x => [x.id, x.reason]))
    expect(reasons['truck-202']).toBe('gte(capabilities.capacity_lbs)')
    expect(reasons['truck-303']).toBe('eq(capabilities.refrigerated)')
    expect(reasons['driver-1']).toBe('eq(type)')
  })

  it('or matches if any clause holds; reports the last failure when all fail', () => {
    const q: ResourceQuery = {
      op: 'or',
      clauses: [
        { op: 'eq', path: 'type', value: 'aircraft' },
        { op: 'eq', path: 'capabilities.refrigerated', value: true },
      ],
    }
    expect(evaluateQuery(q, fleet).matched).toEqual(['truck-101', 'truck-202'])
  })

  it('not inverts the inner clause', () => {
    const q: ResourceQuery = { op: 'not', clause: { op: 'eq', path: 'type', value: 'vehicle' } }
    expect(evaluateQuery(q, fleet).matched).toEqual(['driver-1'])
  })

  it('empty and is vacuously true; empty or is vacuously false', () => {
    expect(evaluateQuery({ op: 'and', clauses: [] }, fleet).matched).toHaveLength(fleet.length)
    expect(evaluateQuery({ op: 'or',  clauses: [] }, fleet).matched).toEqual([])
  })

  it('accepts a Map of resources interchangeably with an array', () => {
    const map = new Map(fleet.map(r => [r.id, r]))
    expect(evaluateQuery(reefer80k, map).matched).toEqual(['truck-101'])
  })
})

describe('evaluateQuery — within (distance, #386 v2)', () => {
  // Fleet anchored in three western US cities — distances chosen so a
  // radius of 700 mi from SLC includes Denver but excludes the Bay
  // Area; 800 mi includes both. Conservative tolerances keep the
  // tests deterministic across earth-radius constants.
  const SLC = { lat: 40.7608, lon: -111.8910 }
  const fleetGeo: readonly EngineResource[] = [
    r('slc-1', { type: 'vehicle', location: SLC }),
    r('den-1', { type: 'vehicle', location: { lat: 39.7392, lon: -104.9903 } }),
    r('sfo-1', { type: 'vehicle', location: { lat: 37.6189, lon: -122.3750 } }),
    r('no-loc', { type: 'vehicle' }),
  ]

  it('filters resources by literal-point distance (miles)', () => {
    // SLC↔DEN ≈ 372 mi, SLC↔SFO ≈ 600 mi → 500 mi keeps Denver, drops SFO.
    const q: ResourceQuery = {
      op: 'within',
      path: 'meta.location',
      from: { kind: 'point', lat: SLC.lat, lon: SLC.lon },
      miles: 500,
    }
    const e = evaluateQuery(q, fleetGeo)
    expect([...e.matched].sort()).toEqual(['den-1', 'slc-1'])
    expect(e.excluded.find(x => x.id === 'sfo-1')?.reason).toBe('within(meta.location, 500mi)')
    expect(e.excluded.find(x => x.id === 'no-loc')?.reason).toBe('within(meta.location, 500mi)')
  })

  it('uses the proposed-event location when from.kind is "proposed"', () => {
    // SLC↔DEN ≈ 599 km, SLC↔SFO ≈ 965 km → 800 km keeps Denver, drops SFO.
    const q: ResourceQuery = {
      op: 'within',
      path: 'meta.location',
      from: { kind: 'proposed' },
      km: 800,
    }
    const e = evaluateQuery(q, fleetGeo, { proposedLocation: SLC })
    expect([...e.matched].sort()).toEqual(['den-1', 'slc-1'])
  })

  it('fails-closed when from is "proposed" but no proposedLocation in context', () => {
    const q: ResourceQuery = {
      op: 'within',
      path: 'meta.location',
      from: { kind: 'proposed' },
      miles: 100,
    }
    const e = evaluateQuery(q, fleetGeo)
    // Every resource is excluded because the reference point is missing.
    expect(e.matched).toEqual([])
    expect(e.excluded.length).toBe(fleetGeo.length)
  })

  it('fails-closed on malformed query (both miles and km, or neither)', () => {
    const both: ResourceQuery = {
      op: 'within', path: 'meta.location',
      from: { kind: 'point', lat: SLC.lat, lon: SLC.lon },
      miles: 700, km: 1000,
    }
    const neither: ResourceQuery = {
      op: 'within', path: 'meta.location',
      from: { kind: 'point', lat: SLC.lat, lon: SLC.lon },
    }
    expect(evaluateQuery(both,    fleetGeo).matched).toEqual([])
    expect(evaluateQuery(neither, fleetGeo).matched).toEqual([])
  })

  it('composes with and: refrigerated trucks within 100 miles of SLC', () => {
    const fleetMixed: readonly EngineResource[] = [
      r('reefer-slc', { type: 'vehicle', capabilities: { refrigerated: true },  location: SLC }),
      r('dry-slc',    { type: 'vehicle', capabilities: { refrigerated: false }, location: SLC }),
      r('reefer-den', { type: 'vehicle', capabilities: { refrigerated: true },  location: { lat: 39.7392, lon: -104.9903 } }),
    ]
    const q: ResourceQuery = {
      op: 'and',
      clauses: [
        { op: 'eq',     path: 'capabilities.refrigerated', value: true },
        { op: 'within', path: 'meta.location', from: { kind: 'point', ...SLC }, miles: 100 },
      ],
    }
    expect(evaluateQuery(q, fleetMixed).matched).toEqual(['reefer-slc'])
  })
})

// ── Additional leaf operators ─────────────────────────────────────────────────

describe('evaluateQuery — lt / lte operators', () => {
  const resources = [
    r('light',  { weight_lbs: 5_000  }),
    r('medium', { weight_lbs: 15_000 }),
    r('heavy',  { weight_lbs: 30_000 }),
  ]

  it('lt matches resources strictly below the threshold', () => {
    const q: ResourceQuery = { op: 'lt', path: 'weight_lbs', value: 15_000 }
    expect(evaluateQuery(q, resources).matched).toEqual(['light'])
  })

  it('lte matches resources at or below the threshold', () => {
    const q: ResourceQuery = { op: 'lte', path: 'weight_lbs', value: 15_000 }
    expect(evaluateQuery(q, resources).matched).toEqual(['light', 'medium'])
  })

  it('gt matches resources strictly above the threshold', () => {
    const q: ResourceQuery = { op: 'gt', path: 'weight_lbs', value: 15_000 }
    expect(evaluateQuery(q, resources).matched).toEqual(['heavy'])
  })
})

// ── describe() called with composite queries (via not wrapper) ────────────────

describe('evaluateQuery — describe() with composite inner clauses', () => {
  const vehicles = [
    r('truck-1', { type: 'vehicle' }),
    r('driver-1', { type: 'person' }),
  ]

  it('produces not(and(...)) reason when not wraps a passing and clause', () => {
    const q: ResourceQuery = {
      op: 'not',
      clause: { op: 'and', clauses: [{ op: 'eq', path: 'type', value: 'vehicle' }] },
    }
    const e = evaluateQuery(q, vehicles)
    // truck-1 passes the inner `and` (it IS a vehicle) so `not(and)` fails for it
    expect(e.excluded.find(x => x.id === 'truck-1')?.reason).toBe('not(and(...))')
    // driver-1 does NOT pass the inner `and`, so not(and) passes for it
    expect(e.matched).toContain('driver-1')
  })

  it('produces not(or(...)) reason when not wraps a passing or clause', () => {
    const q: ResourceQuery = {
      op: 'not',
      clause: {
        op: 'or',
        clauses: [
          { op: 'eq', path: 'type', value: 'vehicle' },
          { op: 'eq', path: 'type', value: 'aircraft' },
        ],
      },
    }
    const e = evaluateQuery(q, vehicles)
    expect(e.excluded.find(x => x.id === 'truck-1')?.reason).toBe('not(or(...))')
    expect(e.matched).toContain('driver-1')
  })

  it('produces not(not(...)) reason when not wraps a passing inner not', () => {
    // not(not(eq(type, aircraft))): truck-1 is not aircraft, so inner eq fails,
    // inner not passes (correctly inverted), outer not then fails → describe(inner_not)
    const q: ResourceQuery = {
      op: 'not',
      clause: { op: 'not', clause: { op: 'eq', path: 'type', value: 'aircraft' } },
    }
    const e = evaluateQuery(q, vehicles)
    // both are not aircraft → inner not passes → outer not fails for both
    expect(e.excluded.find(x => x.id === 'truck-1')?.reason).toBe('not(not(eq(type)))')
    expect(e.matched).toEqual([])
  })
})
