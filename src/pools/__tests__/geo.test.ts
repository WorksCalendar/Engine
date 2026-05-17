/**
 * Geo helpers — pinned distances for canonical city pairs (issue #386).
 *
 * Spot-checks the haversine math against published values so a future
 * refactor that switches Earth radii / units doesn't quietly drift.
 * Tolerance is 0.5% — well under any realistic dispatch threshold.
 */
import { describe, it, expect } from 'vitest'
import { haversineKm, haversineMiles, isLatLon } from '../geo.js'

const SLC = { lat: 40.7608, lon: -111.8910 }
const DEN = { lat: 39.7392, lon: -104.9903 }
const SFO = { lat: 37.6189, lon: -122.3750 }
const LAX = { lat: 33.9425, lon: -118.4081 }

const within = (actual: number, expected: number, tolPct = 0.005) =>
  Math.abs(actual - expected) <= expected * tolPct

describe('haversine', () => {
  it('SLC ↔ DEN ≈ 599 km / 372 mi', () => {
    expect(within(haversineKm(SLC, DEN),    599)).toBe(true)
    expect(within(haversineMiles(SLC, DEN), 372)).toBe(true)
  })

  it('SFO ↔ LAX ≈ 543 km / 337 mi', () => {
    expect(within(haversineKm(SFO, LAX),    543)).toBe(true)
    expect(within(haversineMiles(SFO, LAX), 337)).toBe(true)
  })

  it('returns 0 for identical points', () => {
    expect(haversineKm(SLC, SLC)).toBe(0)
    expect(haversineMiles(SLC, SLC)).toBe(0)
  })

  it('is symmetric', () => {
    expect(haversineKm(SLC, DEN)).toBe(haversineKm(DEN, SLC))
  })
})

describe('isLatLon', () => {
  it('accepts well-formed coordinate objects', () => {
    expect(isLatLon({ lat: 40.76, lon: -111.89 })).toBe(true)
    // Extra fields are fine.
    expect(isLatLon({ lat: 0, lon: 0, altitude: 100 })).toBe(true)
  })

  it('rejects malformed shapes (the fail-closed contract for `within`)', () => {
    expect(isLatLon(null)).toBe(false)
    expect(isLatLon(undefined)).toBe(false)
    expect(isLatLon('40.76,-111.89')).toBe(false)
    expect(isLatLon({ lat: '40.76', lon: '-111.89' })).toBe(false)
    expect(isLatLon({ lat: 40.76 })).toBe(false)
    expect(isLatLon({ lat: NaN, lon: 0 })).toBe(false)
    expect(isLatLon({ lat: Infinity, lon: 0 })).toBe(false)
  })
})
