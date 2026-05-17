/**
 * CalendarEngine — Resource calendar schema.
 *
 * A ResourceCalendar attaches working-time exceptions to a specific resource:
 * holidays, special working days, on-call windows, and other overrides of the
 * default business-hours schedule.
 *
 * The engine uses this when:
 *   1. Validating whether a proposed time falls within the resource's
 *      working schedule (extends the global businessHours check).
 *   2. Rendering non-working bands in timeline/scheduler views.
 *   3. (Future) auto-scheduling: find next available slot per resource.
 *
 * Entry resolution:
 *   – 'non-working' entries BLOCK scheduling during that window.
 *   – 'working'  entries ALLOW scheduling (overrides non-working periods,
 *     e.g. "this Saturday we are open despite being a weekend").
 *   – More-specific entries take precedence over less-specific ones.
 */

export type CalendarEntryType = 'working' | 'non-working';

export interface CalendarEntry {
  readonly id: string;
  /** Display label, e.g. "Christmas Day", "On-call window". */
  readonly name?: string;
  readonly type: CalendarEntryType;
  readonly start: Date;
  readonly end: Date;
  /**
   * When true the entry repeats on the same month+day every calendar year.
   * The year component of start/end is ignored during matching.
   * Useful for fixed-date holidays.
   */
  readonly yearly: boolean;
}

export interface ResourceCalendar {
  readonly id: string;
  /** The resource this calendar governs. */
  readonly resourceId: string;
  /** Optional display name, e.g. "Alice's Schedule". */
  readonly name?: string | undefined;
  readonly entries: readonly CalendarEntry[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function makeCalendarEntry(
  id: string,
  patch: Pick<CalendarEntry, 'type' | 'start' | 'end'> & Partial<Omit<CalendarEntry, 'id'>>,
): CalendarEntry {
  return { id, yearly: false, ...patch };
}

export function makeResourceCalendar(
  id: string,
  resourceId: string,
  entries: CalendarEntry[] = [],
  name?: string,
): ResourceCalendar {
  return { id, resourceId, name, entries };
}

/** Return the calendar for a given resource, or null if none is registered. */
export function calendarForResource(
  calendars: ReadonlyMap<string, ResourceCalendar>,
  resourceId: string,
): ResourceCalendar | null {
  for (const cal of calendars.values()) {
    if (cal.resourceId === resourceId) return cal;
  }
  return null;
}

/**
 * Return true if the given point in time falls inside a non-working entry for
 * this calendar (respecting yearly repetition).
 */
export function isNonWorkingTime(
  calendar: ResourceCalendar,
  point: Date,
): boolean {
  const nonWorking = calendar.entries.filter(e => e.type === 'non-working');
  const working    = calendar.entries.filter(e => e.type === 'working');

  // Check 'working' overrides first (higher specificity wins)
  if (matchesAny(working, point))    return false;
  if (matchesAny(nonWorking, point)) return true;
  return false;
}

/**
 * Return true if [start, end) overlaps any non-working period in the calendar,
 * without being rescued by a 'working' override.
 */
export function overlapsNonWorking(
  calendar: ResourceCalendar,
  start: Date,
  end: Date,
): boolean {
  // Iterate millisecond-free: check start and every boundary point inside the range.
  // For practical purposes, check the start of the window and every entry boundary.
  const checkPoints: Date[] = [start];

  for (const e of calendar.entries) {
    if (matchesRange(e, start, end)) {
      checkPoints.push(resolveEntryStart(e, start));
    }
  }

  return checkPoints.some(p => isNonWorkingTime(calendar, p) && p >= start && p < end);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function matchesAny(entries: CalendarEntry[], point: Date): boolean {
  return entries.some(e => isPointInEntry(e, point));
}

function isPointInEntry(e: CalendarEntry, point: Date): boolean {
  if (e.yearly) {
    const s = resolveEntryStart(e, point);
    const end = new Date(s.getTime() + (e.end.getTime() - e.start.getTime()));
    return point >= s && point < end;
  }
  return point >= e.start && point < e.end;
}

function matchesRange(e: CalendarEntry, start: Date, end: Date): boolean {
  if (e.yearly) {
    const s = resolveEntryStart(e, start);
    const eEnd = new Date(s.getTime() + (e.end.getTime() - e.start.getTime()));
    return s < end && eEnd > start;
  }
  return e.start < end && e.end > start;
}

function resolveEntryStart(e: CalendarEntry, nearDate: Date): Date {
  const s = new Date(e.start);
  s.setFullYear(nearDate.getFullYear());
  return s;
}
