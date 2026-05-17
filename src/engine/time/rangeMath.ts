/**
 * CalendarEngine — date range utilities.
 *
 * All operations are on [start, end) half-open intervals unless noted.
 */

export interface DateRange {
  readonly start: Date;
  readonly end: Date;
}

// ─── Predicates ───────────────────────────────────────────────────────────────

/** True when ranges [a.start, a.end) and [b.start, b.end) overlap. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start < b.end && a.end > b.start;
}

/** True when outer fully contains inner (inclusive on both ends). */
export function rangeContains(outer: DateRange, inner: DateRange): boolean {
  return outer.start <= inner.start && outer.end >= inner.end;
}

/** True when the point falls within [range.start, range.end). */
export function pointInRange(d: Date, range: DateRange): boolean {
  return d >= range.start && d < range.end;
}

// ─── Set operations ───────────────────────────────────────────────────────────

/** Return the overlap of two ranges, or null if they don't overlap. */
export function rangeIntersection(a: DateRange, b: DateRange): DateRange | null {
  const start = new Date(Math.max(a.start.getTime(), b.start.getTime()));
  const end   = new Date(Math.min(a.end.getTime(),   b.end.getTime()));
  if (start >= end) return null;
  return { start, end };
}

/** Return the smallest range that covers both a and b. */
export function rangeUnion(a: DateRange, b: DateRange): DateRange {
  return {
    start: new Date(Math.min(a.start.getTime(), b.start.getTime())),
    end:   new Date(Math.max(a.end.getTime(),   b.end.getTime())),
  };
}

// ─── Expansion ────────────────────────────────────────────────────────────────

/** Expand a range by `days` on each side. */
export function expandRangeByDays(r: DateRange, days: number): DateRange {
  const ms = days * 86_400_000;
  return {
    start: new Date(r.start.getTime() - ms),
    end:   new Date(r.end.getTime()   + ms),
  };
}

/** Duration of the range in milliseconds. */
export function rangeDurationMs(r: DateRange): number {
  return r.end.getTime() - r.start.getTime();
}

// ─── Multi-range helpers ─────────────────────────────────────────────────────

/** Filter an array of ranges/events to those overlapping [start, end). */
export function filterOverlapping<T extends DateRange>(
  items: readonly T[],
  rangeStart: Date,
  rangeEnd: Date,
): T[] {
  return items.filter(item => item.start < rangeEnd && item.end > rangeStart);
}
