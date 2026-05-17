/**
 * Geographic conflict rules.
 *
 * Operates at the host level — these rules aren't part of the main
 * `ConflictRule` union because they require coordinate metadata the
 * core engine doesn't otherwise inspect. Hosts that want geo checks
 * call `evaluateGeoConflicts` and merge its violations with whatever
 * `evaluateConflicts` returns.
 *
 * The first rule shipped is **travel feasibility**: given two events
 * on the same resource at different coordinates, the time gap between
 * them must be ≥ (great-circle distance / max speed). When the gap is
 * too short, the schedule is physically impossible — a pilot can't be
 * in two places at once.
 *
 * Pure / sync. No side effects, no I/O, no engine dependency.
 */
import type { GeoPoint } from '../geo/geoTypes.js'
import { haversineDistanceKm } from '../geo/haversine.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface GeoTravelFeasibilityRule {
  readonly id: string
  /** Type discriminator so hosts can fan out to multiple geo rules later. */
  readonly type: 'geo-travel-feasibility'
  /**
   * Defaults to `'soft'` — geo metadata is often imprecise (airport
   * centroids, lat/lon truncated to two decimals), so a hard block on
   * raw distance produces too many false positives. Bump to `'hard'`
   * when your coordinates are accurate enough to bet a booking on.
   */
  readonly severity?: 'soft' | 'hard'
  /**
   * Maximum sustained transit speed in km/h. The rule treats the
   * straight-line distance as a lower bound on actual travel — real
   * routes are longer, so callers should pick a speed at or below the
   * resource's true cruise. Defaults to 800 km/h (typical jet cruise).
   */
  readonly maxSpeedKph?: number
  /**
   * Minimum gap to enforce regardless of distance, in minutes. Useful
   * to bake in turnaround / handoff time even for co-located events.
   * Defaults to 0.
   */
  readonly minGapMinutes?: number
  /**
   * Skip the rule when the proposed event's category matches any of
   * these. Mirrors the convention used by every rule in the main
   * `ConflictRule` union.
   */
  readonly ignoreCategories?: readonly string[]
}

export type GeoConflictRule = GeoTravelFeasibilityRule

export interface GeoEventInput {
  readonly id: string
  readonly start: Date | string | number
  readonly end: Date | string | number
  readonly resource?: string | null | undefined
  readonly category?: string | null | undefined
  /** Coordinates resolved via `meta.coords` (`{ lat, lon }`), per LocationData. */
  readonly meta?: Readonly<Record<string, unknown>> | undefined
}

export interface GeoConflictViolation {
  readonly rule: string
  readonly severity: 'soft' | 'hard'
  readonly message: string
  readonly conflictingEventId: string
  readonly details: {
    readonly type: 'geo-travel-feasibility'
    readonly distanceKm: number
    readonly requiredGapMinutes: number
    readonly actualGapMinutes: number
  }
}

// ─── Evaluation ────────────────────────────────────────────────────────────

const DEFAULT_MAX_KPH = 800

export function evaluateGeoConflicts(
  rules: readonly GeoConflictRule[],
  proposed: GeoEventInput,
  others: readonly GeoEventInput[],
): readonly GeoConflictViolation[] {
  if (rules.length === 0) return []
  const proposedCoords = readCoords(proposed)
  if (!proposedCoords) return []

  const violations: GeoConflictViolation[] = []
  for (const rule of rules) {
    if (rule.ignoreCategories && proposed.category && rule.ignoreCategories.includes(proposed.category)) {
      continue
    }
    if (rule.type === 'geo-travel-feasibility') {
      for (const other of others) {
        if (other.id === proposed.id) continue
        if (other.resource == null || proposed.resource == null) continue
        if (other.resource !== proposed.resource) continue
        const v = evaluateTravelFeasibility(rule, proposed, proposedCoords, other)
        if (v) violations.push(v)
      }
    }
  }
  return violations
}

function evaluateTravelFeasibility(
  rule: GeoTravelFeasibilityRule,
  proposed: GeoEventInput,
  proposedCoords: GeoPoint,
  other: GeoEventInput,
): GeoConflictViolation | null {
  const otherCoords = readCoords(other)
  if (!otherCoords) return null

  const distanceKm = haversineDistanceKm(proposedCoords, otherCoords)
  const maxSpeedKph = rule.maxSpeedKph ?? DEFAULT_MAX_KPH
  const minGapMinutes = rule.minGapMinutes ?? 0
  const travelMinutes = maxSpeedKph > 0 ? (distanceKm / maxSpeedKph) * 60 : Infinity
  const requiredGapMinutes = Math.max(travelMinutes, minGapMinutes)
  if (requiredGapMinutes <= 0) return null

  const gapMinutes = signedGapMinutes(proposed, other)
  if (gapMinutes === null) return null
  // Negative gap = events overlap in time; that's the territory of
  // `resource-overlap`. Geo feasibility only fires when there *is* a
  // gap, but it's too short for the distance.
  if (gapMinutes < 0) return null
  if (gapMinutes >= requiredGapMinutes) return null

  return {
    rule: rule.id,
    severity: rule.severity ?? 'soft',
    message:
      `Travel infeasible: ${distanceKm.toFixed(0)} km in ${gapMinutes.toFixed(0)} min ` +
      `(needs ≥${requiredGapMinutes.toFixed(0)} min at ${maxSpeedKph} km/h).`,
    conflictingEventId: other.id,
    details: {
      type: 'geo-travel-feasibility',
      distanceKm,
      requiredGapMinutes,
      actualGapMinutes: gapMinutes,
    },
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Returns the gap between the two events in minutes — positive when
 * disjoint, negative (or zero) when they overlap. `null` if any
 * timestamp fails to parse.
 */
function signedGapMinutes(a: GeoEventInput, b: GeoEventInput): number | null {
  const aStart = toEpochMs(a.start)
  const aEnd = toEpochMs(a.end)
  const bStart = toEpochMs(b.start)
  const bEnd = toEpochMs(b.end)
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return null
  if (aEnd <= bStart) return (bStart - aEnd) / 60_000
  if (bEnd <= aStart) return (aStart - bEnd) / 60_000
  return -(Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 60_000
}

function toEpochMs(value: Date | string | number): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

function readCoords(ev: GeoEventInput): GeoPoint | null {
  const meta = ev.meta
  if (!meta) return null
  const direct = meta['coords']
  if (direct && typeof direct === 'object') {
    const c = direct as Record<string, unknown>
    const lat = c['lat']
    const lon = c['lon'] ?? c['lng']
    if (typeof lat === 'number' && typeof lon === 'number' && finitePair(lat, lon)) return { lat, lon }
  }
  const lat = meta['lat']
  const lon = meta['lon'] ?? meta['lng']
  if (typeof lat === 'number' && typeof lon === 'number' && finitePair(lat, lon)) return { lat, lon }
  return null
}

function finitePair(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b)
}

// Public default so hosts can spread `[...geoConflictRules, myRule]`
// without an explicit empty literal. Empty until a host opts in to the
// shipped rule.
export const geoConflictRules: readonly GeoConflictRule[] = []
