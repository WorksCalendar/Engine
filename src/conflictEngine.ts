/**
 * conflictEngine — owner-configurable conflict detection (ticket #134-13).
 *
 * Runs before an event write (create / edit / group-change) to surface
 * violations produced by the owner's rule set. Rules are *data*, not code:
 * they live in `config.conflicts.rules` so owners can add / tune them from
 * ConfigPanel without touching host-app JS. Host callbacks remain the
 * escape hatch for custom checks via the existing `CalendarEngine`
 * validator pipeline (`src/core/engine/validation/*`); this engine is the
 * default path.
 *
 * The module is deliberately tiny: a single `evaluateConflicts()` entry
 * point + a registry of pure rule evaluators. Every evaluator returns
 * `Violation | null`; the engine aggregates violations and computes an
 * overall severity.
 */
import type { Violation } from './engine/validation/validationTypes.js'
import type { EngineResource } from './engine/schema/resourceSchema.js'
import type { Assignment } from './engine/schema/assignmentSchema.js'
import type { CategoryDef } from './types/assets.js'
import { findBlockingHold, type Hold } from './holds/holdRegistry.js'
import { evaluateAvailability } from './availability/evaluateAvailability.js'
import { parseHoursString } from './engine/time/dateMath.js'
import { partsInTimezone } from './engine/time/timezone.js'

// ─── Types ──────────────────────────────────────────────────────────────────

/** Minimum shape we need from an event to run conflict rules. */
export interface ConflictEvent {
  readonly id: string
  readonly start: Date | string | number
  readonly end: Date | string | number
  readonly resource?: string | null | undefined
  readonly category?: string | null | undefined
  readonly meta?: Readonly<Record<string, unknown>> | undefined
}

/** Data-driven rule configuration persisted to `config.conflicts.rules`. */
export type ConflictRule =
  | ResourceOverlapRule
  | CategoryMutexRule
  | MinRestRule
  | CapacityOverflowRule
  | OutsideBusinessHoursRule
  | PolicyViolationRule
  | HoldConflictRule
  | AvailabilityViolationRule

export interface ResourceOverlapRule {
  readonly id: string
  readonly type: 'resource-overlap'
  readonly severity?: 'soft' | 'hard'
  /** Skip when the proposed event's category matches any of these. */
  readonly ignoreCategories?: readonly string[]
}

export interface CategoryMutexRule {
  readonly id: string
  readonly type: 'category-mutex'
  readonly severity?: 'soft' | 'hard'
  /** Categories that MUST NOT coexist for the same resource in an overlapping window. */
  readonly categories: readonly string[]
}

export interface MinRestRule {
  readonly id: string
  readonly type: 'min-rest'
  readonly severity?: 'soft' | 'hard'
  /** Required gap (in minutes) between consecutive events on the same resource. */
  readonly minutes: number
}

export interface CapacityOverflowRule {
  readonly id: string
  readonly type: 'capacity-overflow'
  /** Defaults to 'hard' — capacity is a physical constraint, not a hint. */
  readonly severity?: 'soft' | 'hard'
  /** Skip when the proposed event's category matches any of these. */
  readonly ignoreCategories?: readonly string[]
}

export interface OutsideBusinessHoursRule {
  readonly id: string
  readonly type: 'outside-business-hours'
  /** Defaults to 'soft' — users often book outside hours intentionally. */
  readonly severity?: 'soft' | 'hard'
  /** Skip when the proposed event's category matches any of these. */
  readonly ignoreCategories?: readonly string[]
}

export interface AvailabilityViolationRule {
  readonly id: string
  readonly type: 'availability-violation'
  /**
   * Defaults to 'hard' — availability rules (maintenance windows,
   * holidays) are typically real physical constraints. Owners can
   * relax to 'soft' for advisory-only checks.
   */
  readonly severity?: 'soft' | 'hard'
  /** Skip when the proposed event's category matches any of these. */
  readonly ignoreCategories?: readonly string[]
}

export interface HoldConflictRule {
  readonly id: string
  readonly type: 'hold-conflict'
  /**
   * Defaults to 'soft' — a hold is a short-lived advisory lock, not a
   * persistent constraint. Owners can escalate to 'hard' to block
   * submits against a held slot.
   */
  readonly severity?: 'soft' | 'hard'
}

export interface PolicyViolationRule {
  readonly id: string
  readonly type: 'policy-violation'
  /**
   * Defaults to 'hard' — policies are owner-set constraints on bookings.
   * Owners can relax to 'soft' to surface a warning only.
   */
  readonly severity?: 'soft' | 'hard'
  /**
   * Which policy sub-checks to run. Defaults to all four when omitted.
   * Allows owners to tune a single rule per sub-check if they want
   * independent severities (e.g., blackouts=hard, lead-time=soft).
   */
  readonly checks?: readonly ('min-lead-time' | 'max-duration' | 'max-advance' | 'blackout-dates')[]
}

export interface ConflictEvaluationResult {
  readonly violations: readonly Violation[]
  readonly severity: 'none' | 'soft' | 'hard'
  /** True when there are no hard violations — caller may proceed (with warnings). */
  readonly allowed: boolean
}

export interface EvaluateConflictsInput {
  /** The event the user is trying to write. `id` may be empty for a create. */
  readonly proposed: ConflictEvent
  /** All currently-visible events. The proposed event is removed by id. */
  readonly events: readonly ConflictEvent[]
  /** Active rule set (owner-configured). */
  readonly rules: readonly ConflictRule[]
  /** Master switch — when false, returns `VALID` without running any rule. */
  readonly enabled?: boolean | undefined
  /**
   * Resource records keyed by id. Required for `capacity-overflow` and
   * `outside-business-hours` rules; other rules ignore this map. When the
   * proposed event's resource is not in the map, capacity/hours rules skip
   * silently (unknown capacity / hours ⇒ cannot evaluate ⇒ no violation).
   */
  readonly resources?: ReadonlyMap<string, EngineResource> | undefined
  /**
   * Assignment records keyed by assignment id. When provided, the
   * capacity-overflow rule sums `units` per overlapping same-resource
   * assignment; when absent, each overlapping event is assumed to occupy
   * 100 units (one full slot).
   */
  readonly assignments?: ReadonlyMap<string, Assignment> | undefined
  /**
   * Category definitions keyed by category id. Required for the
   * `policy-violation` rule (#213); ignored by every other rule. When
   * the proposed event's category is not in the map or has no `policy`
   * block, the rule skips silently.
   */
  readonly categories?: ReadonlyMap<string, CategoryDef> | undefined
  /**
   * "Now" reference for time-based policy checks (min-lead-time,
   * max-advance). Defaults to `Date.now()`. Overridable for
   * deterministic tests.
   */
  readonly now?: Date | string | number
  /**
   * Active holds to consult for the `hold-conflict` rule (#211). When
   * the rule is present and the proposed event's resource + window
   * overlaps a live hold owned by a different holder, a soft violation
   * is emitted. Ignored by every other rule.
   */
  readonly holds?: readonly Hold[]
  /**
   * Identifies the caller's session/user for the `hold-conflict` rule —
   * the proposed event's own holds are excluded. When omitted, every
   * matching hold is treated as "someone else's".
   */
  readonly holderId?: string
}

const VALID: ConflictEvaluationResult = {
  violations: [],
  severity: 'none',
  allowed: true,
}

const NO_EVENTS: readonly ConflictEvent[] = []

// ─── Helpers ────────────────────────────────────────────────────────────────

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value)
}

/** Half-open interval overlap — touching endpoints are NOT a conflict. */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd
}

function sameResource(a: ConflictEvent, b: ConflictEvent): boolean {
  const ra = a.resource ?? ''
  const rb = b.resource ?? ''
  return ra !== '' && ra === rb
}

/** Rules that compare the proposed event against one other event at a time. */
type PairwiseRule = ResourceOverlapRule | CategoryMutexRule | MinRestRule

function isPairwiseRule(rule: ConflictRule): rule is PairwiseRule {
  return (
    rule.type === 'resource-overlap' ||
    rule.type === 'category-mutex' ||
    rule.type === 'min-rest'
  )
}

/**
 * The proposed event's resource bucket — `events` that share its resource,
 * with the proposed event itself removed (same self-skip rule the old
 * pairwise loop used). Returns the shared empty array when the proposed
 * event is unscoped or no rule needs the bucket, so callers never pay the
 * O(events) filter for nothing.
 *
 * Every pairwise rule (resource-overlap / category-mutex / min-rest) and
 * the capacity-overflow rule require `sameResource(proposed, other)`, so
 * scanning this bucket — rather than the full event list, once per rule —
 * is what lets the engine stay responsive past 1000 events.
 */
function sameResourceBucket(
  proposed: ConflictEvent,
  events: readonly ConflictEvent[],
  needed: boolean,
): readonly ConflictEvent[] {
  const key = proposed.resource ?? ''
  if (key === '' || !needed) return NO_EVENTS
  return events.filter(
    (e) => (e.resource ?? '') === key && !(e.id && proposed.id && e.id === proposed.id),
  )
}

// ─── Built-in rule evaluators ───────────────────────────────────────────────

function evalResourceOverlap(
  rule: ResourceOverlapRule,
  proposed: ConflictEvent,
  other: ConflictEvent,
): Violation | null {
  const ignore = new Set(rule.ignoreCategories ?? [])
  if (proposed.category && ignore.has(proposed.category)) return null
  if (!sameResource(proposed, other)) return null

  const ps = toDate(proposed.start)
  const pe = toDate(proposed.end)
  const os = toDate(other.start)
  const oe = toDate(other.end)
  if (!overlaps(ps, pe, os, oe)) return null

  return {
    rule: rule.id,
    severity: rule.severity ?? 'hard',
    message: `Conflicts with "${(other as { title?: string }).title ?? other.id}" on the same resource.`,
    conflictingEventId: other.id,
    details: { type: 'resource-overlap' },
  }
}

function evalCategoryMutex(
  rule: CategoryMutexRule,
  proposed: ConflictEvent,
  other: ConflictEvent,
): Violation | null {
  const mutex = new Set(rule.categories)
  if (mutex.size < 2) return null
  if (!proposed.category || !other.category) return null
  if (!mutex.has(proposed.category) || !mutex.has(other.category)) return null
  if (proposed.category === other.category) return null
  if (!sameResource(proposed, other)) return null

  const ps = toDate(proposed.start)
  const pe = toDate(proposed.end)
  const os = toDate(other.start)
  const oe = toDate(other.end)
  if (!overlaps(ps, pe, os, oe)) return null

  return {
    rule: rule.id,
    severity: rule.severity ?? 'hard',
    message: `Categories "${proposed.category}" and "${other.category}" cannot overlap on the same resource.`,
    conflictingEventId: other.id,
    details: { type: 'category-mutex' },
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Build `eventId → summed units` for a single resource in one pass over
 * the assignment map. Events absent from the returned map fall back to
 * 100 units (one full slot) — matching the legacy per-event scan that
 * returned 100 on no match. Returns `null` when no assignment map was
 * provided (every event is then assumed to occupy 100 units).
 *
 * Replaces the old per-event `unitsFor()` which scanned every assignment
 * for every event — an O(events × assignments) hot loop inside
 * `evalCapacityOverflow`.
 */
function buildUnitsIndex(
  resourceId: string,
  assignments: ReadonlyMap<string, Assignment> | undefined,
): Map<string, number> | null {
  if (!assignments) return null
  const index = new Map<string, number>()
  for (const a of assignments.values()) {
    if (a.resourceId !== resourceId) continue
    index.set(a.eventId, (index.get(a.eventId) ?? 0) + a.units)
  }
  return index
}

function unitsFromIndex(eventId: string, index: Map<string, number> | null): number {
  if (!index) return 100
  const units = index.get(eventId)
  return units === undefined ? 100 : units
}

function evalCapacityOverflow(
  rule: CapacityOverflowRule,
  proposed: ConflictEvent,
  /** Pre-filtered: events on the proposed resource, self already removed. */
  sameResourceEvents: readonly ConflictEvent[],
  resources: ReadonlyMap<string, EngineResource> | undefined,
  assignments: ReadonlyMap<string, Assignment> | undefined,
): Violation | null {
  if (!resources) return null
  const ignore = new Set(rule.ignoreCategories ?? [])
  if (proposed.category && ignore.has(proposed.category)) return null

  const resourceId = proposed.resource ?? ''
  if (!resourceId) return null
  const resource = resources.get(resourceId)
  // Unknown capacity (missing resource or null capacity) ⇒ unlimited ⇒ skip.
  if (!resource || resource.capacity == null) return null
  const capacityUnits = resource.capacity * 100

  const ps = toDate(proposed.start)
  const pe = toDate(proposed.end)

  const unitsIndex = buildUnitsIndex(resourceId, assignments)
  let totalUnits = unitsFromIndex(proposed.id, unitsIndex)
  for (const other of sameResourceEvents) {
    const os = toDate(other.start)
    const oe = toDate(other.end)
    if (!overlaps(ps, pe, os, oe)) continue
    totalUnits += unitsFromIndex(other.id, unitsIndex)
  }

  if (totalUnits <= capacityUnits) return null
  return {
    rule: rule.id,
    severity: rule.severity ?? 'hard',
    message: `Resource "${resource.name}" over capacity (${totalUnits / 100} of ${resource.capacity}).`,
    details: { type: 'capacity-overflow', totalUnits, capacityUnits },
  }
}

function evalOutsideBusinessHours(
  rule: OutsideBusinessHoursRule,
  proposed: ConflictEvent,
  resources: ReadonlyMap<string, EngineResource> | undefined,
): Violation | null {
  if (!resources) return null
  const ignore = new Set(rule.ignoreCategories ?? [])
  if (proposed.category && ignore.has(proposed.category)) return null

  const resourceId = proposed.resource ?? ''
  if (!resourceId) return null
  const resource = resources.get(resourceId)
  if (!resource?.businessHours) return null

  const ps = toDate(proposed.start)
  const pe = toDate(proposed.end)

  // Skip multi-day spans — "outside hours" isn't meaningful for them.
  if (pe.getTime() - ps.getTime() >= DAY_MS) return null

  const tz = resource.timezone ?? 'UTC'
  const startParts = partsInTimezone(ps, tz)
  // Day-of-week is computed by treating the wall-clock date as UTC and
  // reading getUTCDay() — avoids double timezone shift from local Date.
  const startDow = new Date(Date.UTC(
    startParts.year, startParts.month - 1, startParts.day,
  )).getUTCDay()

  const bizDays = resource.businessHours.days
  if (!bizDays.includes(startDow)) {
    return {
      rule: rule.id,
      severity: rule.severity ?? 'soft',
      message: `"${resource.name}" is closed on this day.`,
      details: { type: 'outside-business-hours', reason: 'closed-day', dayOfWeek: startDow },
    }
  }

  const endParts = partsInTimezone(pe, tz)
  const bizStart = parseHoursString(resource.businessHours.start)
  const bizEnd   = parseHoursString(resource.businessHours.end)
  const evStartH = startParts.hour + startParts.minute / 60
  const evEndHRaw = endParts.hour + endParts.minute / 60
  // Midnight end (00:00) means "runs to end of day" — treat as 24.
  const evEndH = evEndHRaw === 0 ? 24 : evEndHRaw

  if (evStartH < bizStart || evEndH > bizEnd) {
    return {
      rule: rule.id,
      severity: rule.severity ?? 'soft',
      message: `"${resource.name}" is only open ${resource.businessHours.start}–${resource.businessHours.end}.`,
      details: {
        type: 'outside-business-hours',
        reason: 'outside-hours',
        proposedStartHour: evStartH,
        proposedEndHour: evEndH,
      },
    }
  }

  return null
}

/** Format a Date as `YYYY-MM-DD` in the given IANA zone (UTC when unset). */
function dateKey(d: Date, tz: string | undefined): string {
  if (!tz || tz === 'UTC') {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const parts = partsInTimezone(d, tz)
  const m = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${parts.year}-${m}-${day}`
}

function evalPolicyViolation(
  rule: PolicyViolationRule,
  proposed: ConflictEvent,
  categories: ReadonlyMap<string, CategoryDef> | undefined,
  resources: ReadonlyMap<string, EngineResource> | undefined,
  nowMs: number,
): Violation[] {
  if (!categories) return []
  const categoryId = proposed.category ?? ''
  if (!categoryId) return []
  const category = categories.get(categoryId)
  const policy = category?.policy
  if (!policy) return []

  const active = new Set(rule.checks ?? ['min-lead-time', 'max-duration', 'max-advance', 'blackout-dates'])
  const severity = rule.severity ?? 'hard'
  const ps = toDate(proposed.start)
  const pe = toDate(proposed.end)
  const out: Violation[] = []

  if (active.has('min-lead-time') && typeof policy.minLeadTimeMinutes === 'number' && policy.minLeadTimeMinutes > 0) {
    const leadMs = ps.getTime() - nowMs
    const requiredMs = policy.minLeadTimeMinutes * 60_000
    if (leadMs < requiredMs) {
      out.push({
        rule: rule.id,
        severity,
        message: `Category "${category?.label ?? categoryId}" requires ≥${policy.minLeadTimeMinutes} min lead time.`,
        details: {
          type: 'policy-violation',
          check: 'min-lead-time',
          leadMinutes: Math.max(0, leadMs / 60_000),
          requiredMinutes: policy.minLeadTimeMinutes,
        },
      })
    }
  }

  if (active.has('max-duration') && typeof policy.maxDurationMinutes === 'number' && policy.maxDurationMinutes > 0) {
    const durMinutes = (pe.getTime() - ps.getTime()) / 60_000
    if (durMinutes > policy.maxDurationMinutes) {
      out.push({
        rule: rule.id,
        severity,
        message: `Category "${category?.label ?? categoryId}" caps duration at ${policy.maxDurationMinutes} min.`,
        details: {
          type: 'policy-violation',
          check: 'max-duration',
          durationMinutes: durMinutes,
          maxMinutes: policy.maxDurationMinutes,
        },
      })
    }
  }

  if (active.has('max-advance') && typeof policy.maxAdvanceDays === 'number' && policy.maxAdvanceDays >= 0) {
    const advanceMs = ps.getTime() - nowMs
    const maxMs = policy.maxAdvanceDays * DAY_MS
    if (advanceMs > maxMs) {
      out.push({
        rule: rule.id,
        severity,
        message: `Category "${category?.label ?? categoryId}" cannot be booked more than ${policy.maxAdvanceDays} day(s) in advance.`,
        details: {
          type: 'policy-violation',
          check: 'max-advance',
          advanceDays: advanceMs / DAY_MS,
          maxDays: policy.maxAdvanceDays,
        },
      })
    }
  }

  if (active.has('blackout-dates') && policy.blackoutDates && policy.blackoutDates.length > 0) {
    const tz = proposed.resource
      ? resources?.get(proposed.resource)?.timezone
      : undefined
    const blackoutSet = new Set(policy.blackoutDates)
    // Check every calendar date the event touches (in the resource's zone).
    const endInclusive = new Date(pe.getTime() - 1)
    const startKey = dateKey(ps, tz)
    const endKey = dateKey(endInclusive, tz)
    let hit: string | null = null
    if (blackoutSet.has(startKey)) hit = startKey
    else if (startKey !== endKey && blackoutSet.has(endKey)) hit = endKey
    else if (startKey !== endKey) {
      // Multi-day: walk each calendar day between start + end, inclusive.
      const cursor = new Date(ps.getTime())
      while (cursor <= endInclusive) {
        const k = dateKey(cursor, tz)
        if (blackoutSet.has(k)) { hit = k; break }
        cursor.setUTCDate(cursor.getUTCDate() + 1)
      }
    }
    if (hit) {
      out.push({
        rule: rule.id,
        severity,
        message: `Category "${category?.label ?? categoryId}" is blacked out on ${hit}.`,
        details: {
          type: 'policy-violation',
          check: 'blackout-dates',
          blackoutDate: hit,
        },
      })
    }
  }

  return out
}

function evalAvailabilityViolation(
  rule: AvailabilityViolationRule,
  proposed: ConflictEvent,
  resources: ReadonlyMap<string, EngineResource> | undefined,
): Violation | null {
  if (!resources) return null
  const ignore = new Set(rule.ignoreCategories ?? [])
  if (proposed.category && ignore.has(proposed.category)) return null

  const resourceId = proposed.resource ?? ''
  if (!resourceId) return null
  const resource = resources.get(resourceId)
  if (!resource?.availability || resource.availability.length === 0) return null

  const result = evaluateAvailability({
    window: { start: toDate(proposed.start), end: toDate(proposed.end) },
    rules: resource.availability,
    timezone: resource.timezone,
    resourceName: resource.name,
  })
  if (result.ok === true) return null

  return {
    rule: rule.id,
    severity: rule.severity ?? 'hard',
    message: `"${resource.name}": ${result.message}`,
    details: {
      type: 'availability-violation',
      reason: result.reason,
      availabilityRuleId: result.ruleId,
    },
  }
}

function evalHoldConflict(
  rule: HoldConflictRule,
  proposed: ConflictEvent,
  holds: readonly Hold[] | undefined,
  holderId: string | undefined,
  nowMs: number,
): Violation | null {
  if (!holds || holds.length === 0) return null
  const ps = toDate(proposed.start)
  const pe = toDate(proposed.end)
  const blocker = findBlockingHold(
    {
      resourceId: proposed.resource ?? null,
      window: { start: ps, end: pe },
      holderId: holderId ?? null,
    },
    holds,
    nowMs,
  )
  if (!blocker) return null
  return {
    rule: rule.id,
    severity: rule.severity ?? 'soft',
    message: `Another session is holding this slot until ${blocker.expiresAt}.`,
    details: {
      type: 'hold-conflict',
      holdId: blocker.id,
      holderId: blocker.holderId,
      expiresAt: blocker.expiresAt,
    },
  }
}

function evalMinRest(
  rule: MinRestRule,
  proposed: ConflictEvent,
  other: ConflictEvent,
): Violation | null {
  if (!(rule.minutes > 0)) return null
  if (!sameResource(proposed, other)) return null

  const ps = toDate(proposed.start)
  const pe = toDate(proposed.end)
  const os = toDate(other.start)
  const oe = toDate(other.end)

  // Gap = time between the two intervals (if non-overlapping).
  if (overlaps(ps, pe, os, oe)) return null

  const gapMs = ps >= oe ? ps.getTime() - oe.getTime() : os.getTime() - pe.getTime()
  const requiredMs = rule.minutes * 60_000
  if (gapMs >= requiredMs) return null

  return {
    rule: rule.id,
    severity: rule.severity ?? 'soft',
    message: `Only ${Math.round(gapMs / 60_000)} min between shifts; rule requires ≥${rule.minutes}.`,
    conflictingEventId: other.id,
    details: { type: 'min-rest', gapMinutes: gapMs / 60_000 },
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run every rule against the proposed event and return aggregated violations.
 *
 * Cost is O(events + assignments) for index building plus
 * O(bucket × pairwiseRules) for the pairwise checks, where `bucket` is the
 * subset of events sharing the proposed event's resource. The old
 * implementation re-scanned the full event list once per rule (and, for
 * capacity-overflow, re-scanned every assignment once per event), which
 * degraded sharply past ~1000 events; this path stays flat. Rules are
 * pure and side-effect-free so the result is fully memoisable by caller.
 */
export function evaluateConflicts(input: EvaluateConflictsInput): ConflictEvaluationResult {
  const { proposed, events, rules, enabled = true, resources, assignments, categories, now, holds, holderId } = input
  if (!enabled || rules.length === 0) return VALID

  const nowMs = now !== undefined ? toDate(now).getTime() : Date.now()
  const violations: Violation[] = []

  const pairwiseRules = rules.filter(isPairwiseRule)
  const hasCapacityRule = rules.some((r) => r.type === 'capacity-overflow')

  // Resolve the proposed event's resource bucket once: every rule below that
  // walks the event list cares only about same-resource events.
  const sameResourceEvents = sameResourceBucket(
    proposed,
    events,
    pairwiseRules.length > 0 || hasCapacityRule,
  )

  // Single-pass (non-pairwise) rules — evaluated once per rule.
  for (const rule of rules) {
    let v: Violation | null = null
    switch (rule.type) {
      case 'capacity-overflow':
        v = evalCapacityOverflow(rule, proposed, sameResourceEvents, resources, assignments)
        break
      case 'outside-business-hours':
        v = evalOutsideBusinessHours(rule, proposed, resources)
        break
      case 'policy-violation':
        violations.push(...evalPolicyViolation(rule, proposed, categories, resources, nowMs))
        break
      case 'hold-conflict':
        v = evalHoldConflict(rule, proposed, holds, holderId, nowMs)
        break
      case 'availability-violation':
        v = evalAvailabilityViolation(rule, proposed, resources)
        break
      default:
        break
    }
    if (v) violations.push(v)
  }

  // Pairwise rules — evaluated for every (same-resource event, rule) combo.
  if (pairwiseRules.length > 0) {
    for (const other of sameResourceEvents) {
      for (const rule of pairwiseRules) {
        let v: Violation | null = null
        switch (rule.type) {
          case 'resource-overlap': v = evalResourceOverlap(rule, proposed, other); break
          case 'category-mutex':   v = evalCategoryMutex(rule, proposed, other);   break
          case 'min-rest':         v = evalMinRest(rule, proposed, other);         break
          default: break
        }
        if (v) violations.push(v)
      }
    }
  }

  if (violations.length === 0) return VALID
  const hasHard = violations.some(v => v.severity === 'hard')
  return {
    violations,
    severity: hasHard ? 'hard' : 'soft',
    allowed: !hasHard,
  }
}

export const CONFLICT_RULE_TYPES: readonly ConflictRule['type'][] = [
  'resource-overlap',
  'category-mutex',
  'min-rest',
  'capacity-overflow',
  'outside-business-hours',
  'policy-violation',
  'hold-conflict',
  'availability-violation',
] as const
