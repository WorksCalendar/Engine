/**
 * Pure availability evaluator — issue #214.
 *
 * Answers: "is this (resource, window) open given its AvailabilityRule[]?"
 *
 * Semantics:
 *   - If the rule set contains no `open` rules, the resource is treated
 *     as always open (use `outside-business-hours` rule + `businessHours`
 *     for the primary gate).
 *   - Otherwise the window must be entirely within the union of `open`
 *     rules for every calendar day it touches (in the resource's zone).
 *   - Any overlap with a `blackout` rule is a violation, regardless of
 *     open rules.
 *
 * The evaluator is zone-aware: open rules are evaluated in the
 * resource's IANA timezone (defaulting to UTC). Blackouts are
 * absolute-time ranges, zone-independent.
 */
import { parseHoursString } from '../engine/time/dateMath.js'
import { partsInTimezone, wallClockToUtc } from '../engine/time/timezone.js'
import type { AvailabilityRule, BlackoutRule, WeeklyOpenRule } from './availabilityRule.js'

// ─── Types ────────────────────────────────────────────────────────────────

export interface AvailabilityWindow {
  readonly start: Date | string | number
  readonly end: Date | string | number
}

export type AvailabilityReasonCode =
  | 'closed-day'
  | 'outside-open-hours'
  | 'blackout'

export interface AvailabilityFailure {
  readonly ok: false
  readonly reason: AvailabilityReasonCode
  readonly ruleId?: string
  readonly message: string
}

export interface AvailabilitySuccess {
  readonly ok: true
}

export type AvailabilityResult = AvailabilitySuccess | AvailabilityFailure

export interface EvaluateAvailabilityInput {
  readonly window: AvailabilityWindow
  readonly rules: readonly AvailabilityRule[]
  /** Resource's IANA timezone. Defaults to UTC. */
  readonly timezone?: string | undefined
  readonly resourceName?: string | undefined
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function toDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v)
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

interface DaySegment {
  readonly dow: number
  /** Hour-of-day (0..24) at the start of this segment in tz. */
  readonly startH: number
  /** Hour-of-day (0..24) at the end of this segment in tz. */
  readonly endH: number
}

/**
 * Split `[ws, we)` into one segment per calendar day it touches in `tz`.
 * The first segment starts at the window's start-of-day hour and runs
 * to the tz midnight (or `weMs`, whichever is sooner). Middle segments
 * span 0–24. The last segment runs from 0 to the window's end-of-day
 * hour. This is what the availability-violation conflict rule needs so
 * multi-day bookings are validated against every touched day's open
 * rules, not just the start day's.
 */
function daySegmentsInZone(ws: Date, we: Date, tz: string): DaySegment[] {
  const segments: DaySegment[] = []
  const endMs = we.getTime()
  let cursorMs = ws.getTime()
  let isFirst = true

  // Hard upper bound on iterations as a belt-and-suspenders guard. A month-
  // long window has ~31 segments; we cap at 400 to leave headroom for any
  // weird timezone math without risking an infinite loop.
  const MAX_SEGMENTS = 400

  while (cursorMs < endMs && segments.length < MAX_SEGMENTS) {
    const cursor = new Date(cursorMs)
    const p = partsInTimezone(cursor, tz)
    const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()

    // Compute the next midnight in tz. DST-at-midnight zones (e.g.
    // Asia/Gaza around 2026-03-27) can make `p.day + 1` at 00:00 land at
    // or before `cursorMs`, which would stall the loop. Bump forward one
    // extra day at a time until we strictly progress, then fall back to
    // a 24h step if the zone keeps playing tricks.
    let dayOffset = 1
    let nextMidnightMs = wallClockToUtc(p.year, p.month, p.day + dayOffset, 0, 0, 0, tz).getTime()
    while (nextMidnightMs <= cursorMs && dayOffset < 4) {
      dayOffset++
      nextMidnightMs = wallClockToUtc(p.year, p.month, p.day + dayOffset, 0, 0, 0, tz).getTime()
    }
    if (nextMidnightMs <= cursorMs) {
      nextMidnightMs = cursorMs + 24 * 60 * 60 * 1000
    }

    const startH = isFirst ? p.hour + p.minute / 60 + p.second / 3600 : 0
    const segEndMs = Math.min(endMs, nextMidnightMs)

    let endH: number
    if (segEndMs === nextMidnightMs) {
      endH = 24
    } else {
      const ep = partsInTimezone(new Date(segEndMs), tz)
      endH = ep.hour + ep.minute / 60 + ep.second / 3600
    }

    segments.push({ dow, startH, endH })
    cursorMs = nextMidnightMs
    isFirst = false
  }

  return segments
}

// ─── Public API ───────────────────────────────────────────────────────────

export function evaluateAvailability(input: EvaluateAvailabilityInput): AvailabilityResult {
  const tz = input.timezone ?? 'UTC'
  const ws = toDate(input.window.start)
  const we = toDate(input.window.end)
  const wsMs = ws.getTime()
  const weMs = we.getTime()

  // Blackouts take priority — any overlap kills the window.
  for (const rule of input.rules) {
    if (rule.kind !== 'blackout') continue
    const bs = toDate(rule.start).getTime()
    const be = toDate(rule.end).getTime()
    if (overlaps(wsMs, weMs, bs, be)) {
      return {
        ok: false,
        reason: 'blackout',
        ruleId: rule.id,
        message: rule.reason
          ? `Blackout: ${rule.reason}.`
          : `Resource is on a blackout window (${rule.start} – ${rule.end}).`,
      }
    }
  }

  const openRules = input.rules.filter((r): r is WeeklyOpenRule => r.kind === 'open')
  if (openRules.length === 0) return { ok: true }

  // Every calendar day the window touches in the resource's tz must be
  // covered by an open rule for that segment. Single-day windows reduce
  // to exactly one segment; multi-day windows walk the gap day-by-day.
  for (const seg of daySegmentsInZone(ws, we, tz)) {
    const anyDow = openRules.some(r => r.days.includes(seg.dow))
    if (!anyDow) {
      return {
        ok: false,
        reason: 'closed-day',
        message: `Resource is closed on day ${seg.dow}.`,
      }
    }
    if (findCoveringOpenRule(openRules, seg.dow, seg.startH, seg.endH)) continue
    if (isCoveredByUnion(openRules, seg.dow, seg.startH, seg.endH)) continue
    return {
      ok: false,
      reason: 'outside-open-hours',
      message: `Window is outside the resource's open hours on day ${seg.dow}.`,
    }
  }

  return { ok: true }
}

function findCoveringOpenRule(
  rules: readonly WeeklyOpenRule[],
  dow: number,
  startH: number,
  endH: number,
): WeeklyOpenRule | null {
  for (const r of rules) {
    if (!r.days.includes(dow)) continue
    const rs = parseHoursString(r.start)
    const re = parseHoursString(r.end)
    if (startH >= rs && endH <= re) return r
  }
  return null
}

function isCoveredByUnion(
  rules: readonly WeeklyOpenRule[],
  dow: number,
  startH: number,
  endH: number,
): boolean {
  // Merge all open intervals on this dow, then check coverage.
  const intervals: Array<[number, number]> = []
  for (const r of rules) {
    if (!r.days.includes(dow)) continue
    intervals.push([parseHoursString(r.start), parseHoursString(r.end)])
  }
  if (intervals.length === 0) return false
  intervals.sort((a, b) => a[0] - b[0])
  const first = intervals[0]
  if (first === undefined) return false
  const merged: Array<[number, number]> = [first]
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1]
    const cur = intervals[i]
    if (last === undefined || cur === undefined) continue
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1])
    } else {
      merged.push(cur)
    }
  }
  for (const [ms, me] of merged) {
    if (startH >= ms && endH <= me) return true
  }
  return false
}

/** Convenience helper for callers that only have blackout rules. */
export function findBlockingBlackout(
  window: AvailabilityWindow,
  rules: readonly AvailabilityRule[],
): BlackoutRule | null {
  const wsMs = toDate(window.start).getTime()
  const weMs = toDate(window.end).getTime()
  for (const r of rules) {
    if (r.kind !== 'blackout') continue
    const bs = toDate(r.start).getTime()
    const be = toDate(r.end).getTime()
    if (overlaps(wsMs, weMs, bs, be)) return r
  }
  return null
}
