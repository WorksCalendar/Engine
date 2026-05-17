/**
 * CalendarEngine — DST edge case helpers.
 *
 * Handles the two DST transitions:
 *   - Spring forward: local clocks skip from 2:00 → 3:00 (missing hour)
 *   - Fall back:      local clocks repeat from 2:00 → 1:00 (ambiguous hour)
 *
 * These are important for drag operations that cross DST boundaries, and
 * for recurrence expansion near DST transitions.
 */

import { utcOffsetMinutes } from './timezone.js';

// ─── Transition detection ─────────────────────────────────────────────────────

/**
 * True if the two dates fall on different UTC offset sides of a DST transition.
 * Useful for detecting when a drag crosses a DST boundary.
 */
export function crossesDSTBoundary(start: Date, end: Date, tz: string): boolean {
  const offsetStart = utcOffsetMinutes(start, tz);
  const offsetEnd   = utcOffsetMinutes(end,   tz);
  return offsetStart !== offsetEnd;
}

/**
 * Return the amount (in minutes) that the UTC offset changes between two dates.
 * Positive = offset increased (e.g. clocks went back → gained an hour).
 * Negative = offset decreased (e.g. clocks went forward → lost an hour).
 * Zero = no DST transition between the two dates.
 */
export function dstShiftMinutes(start: Date, end: Date, tz: string): number {
  return utcOffsetMinutes(end, tz) - utcOffsetMinutes(start, tz);
}

// ─── Wall-clock preservation ──────────────────────────────────────────────────

/**
 * When moving a recurring event across a DST boundary, you typically want
 * to preserve the WALL CLOCK time (e.g. "always at 9 AM") rather than the
 * UTC instant.
 *
 * This function adjusts a UTC Date so that it represents the same wall-clock
 * time after a DST transition, given the change in offset.
 *
 * Example:
 *   Before spring-forward: 9:00 AM EST = 14:00 UTC (offset -300 min)
 *   After  spring-forward: 9:00 AM EDT = 13:00 UTC (offset -240 min)
 *   dstShift = -60 min → subtract 60 min from UTC
 */
export function preserveWallClockAfterDST(
  d: Date,
  dstShiftMinutes: number,
): Date {
  if (dstShiftMinutes === 0) return d;
  return new Date(d.getTime() - dstShiftMinutes * 60_000);
}

// ─── Missing/ambiguous hour detection ────────────────────────────────────────

/**
 * True if the given date falls in the "spring forward" gap (missing hour).
 * In a spring-forward transition, wall-clock times like 2:30 AM don't exist.
 *
 * NOTE: This is an approximation.  For exact production use, a full timezone
 * library (date-fns-tz or Temporal) is recommended.
 */
export function isInSpringForwardGap(d: Date, tz: string): boolean {
  // Check one minute before and one minute after.  In a spring-forward
  // transition the UTC offset INCREASES going forward in time
  // (e.g. EST -300 → EDT -240, or GMT 0 → BST +60).
  const before = new Date(d.getTime() - 60_000);
  const after  = new Date(d.getTime() + 60_000);
  const offBefore = utcOffsetMinutes(before, tz);
  const offAfter  = utcOffsetMinutes(after,  tz);
  return offBefore < offAfter; // offset increased = clocks went forward (spring)
}

/**
 * True if the given date falls in the "fall back" repeat zone (ambiguous hour).
 * In a fall-back transition, wall-clock times like 1:30 AM occur twice.
 */
export function isInFallBackRepeat(d: Date, tz: string): boolean {
  // In a fall-back transition the UTC offset DECREASES going forward in time
  // (e.g. EDT -240 → EST -300, or BST +60 → GMT 0).
  const before = new Date(d.getTime() - 60_000);
  const after  = new Date(d.getTime() + 60_000);
  const offBefore = utcOffsetMinutes(before, tz);
  const offAfter  = utcOffsetMinutes(after,  tz);
  return offBefore > offAfter; // offset decreased = clocks went back (fall)
}
