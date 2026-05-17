/**
 * Geo helpers for v2 resource pools (issue #386).
 *
 * Single source of truth for the lat/lon convention and distance
 * math. Resources expose coordinates at any meta path the host
 * configures; the default convention is `meta.location: { lat, lon }`.
 *
 * Pure: no network, no globals. Map_Idea (or any other coordinate
 * source) is wired in via `ResourceLocationAdapter` (see
 * `locationAdapters.ts`); this module is just the math.
 */

export interface LatLon {
  readonly lat: number
  readonly lon: number
}

const EARTH_RADIUS_KM    = 6371.0088
const EARTH_RADIUS_MILES = 3958.7613

/**
 * Great-circle distance via the haversine formula. Inputs in
 * decimal degrees. Returns kilometers; helpers below convert to
 * miles. Handles the antimeridian implicitly because we only ever
 * compare distances, not directions.
 */
export function haversineKm(a: LatLon, b: LatLon): number {
  const φ1 = toRadians(a.lat)
  const φ2 = toRadians(b.lat)
  const dφ = toRadians(b.lat - a.lat)
  const dλ = toRadians(b.lon - a.lon)
  const h  = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function haversineMiles(a: LatLon, b: LatLon): number {
  return haversineKm(a, b) * (EARTH_RADIUS_MILES / EARTH_RADIUS_KM)
}

/**
 * Type guard for "is this value a usable coordinate object?". Lets
 * the evaluator and resolver share the same fail-closed semantics
 * for malformed data.
 */
export function isLatLon(value: unknown): value is LatLon {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Number.isFinite(v['lat']) && Number.isFinite(v['lon'])
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}
