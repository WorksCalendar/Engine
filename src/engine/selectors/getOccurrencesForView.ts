/**
 * CalendarEngine — view-adapted occurrence selectors.
 *
 * These are thin helpers that call getOccurrencesInRange with view-specific
 * range logic.  Views should use these rather than computing their own ranges.
 */

import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays } from 'date-fns';
import type { EngineEvent } from '../schema/eventSchema.js';
import type { EngineOccurrence } from '../schema/occurrenceSchema.js';
import type { GetOccurrencesOptions } from './getOccurrencesInRange.js';
import { getOccurrencesInRange } from './getOccurrencesInRange.js';

type EventSource = ReadonlyMap<string, EngineEvent> | readonly EngineEvent[];
type WeekStartDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ─── Day view ─────────────────────────────────────────────────────────────────

export function getOccurrencesForDay(
  events: EventSource,
  day: Date,
  opts: GetOccurrencesOptions = {},
): EngineOccurrence[] {
  return getOccurrencesInRange(events, startOfDay(day), endOfDay(day), opts);
}

// ─── Week view ────────────────────────────────────────────────────────────────

export function getOccurrencesForWeek(
  events: EventSource,
  anchor: Date,
  weekStartsOn: WeekStartDay = 0,
  opts: GetOccurrencesOptions = {},
): EngineOccurrence[] {
  const start = startOfWeek(anchor, { weekStartsOn });
  const end   = endOfWeek(anchor,   { weekStartsOn });
  return getOccurrencesInRange(events, start, end, opts);
}

// ─── Month view ───────────────────────────────────────────────────────────────

/**
 * Return occurrences for the calendar grid of the given month.
 * The grid may span up to 6 weeks to fill the display.
 */
export function getOccurrencesForMonth(
  events: EventSource,
  anchor: Date,
  weekStartsOn: WeekStartDay = 0,
  opts: GetOccurrencesOptions = {},
): EngineOccurrence[] {
  const monthStart = startOfMonth(anchor);
  const monthEnd   = endOfMonth(anchor);

  // Expand to full grid rows
  const gridStart = startOfWeek(monthStart, { weekStartsOn });
  const gridEnd   = addDays(startOfWeek(monthEnd, { weekStartsOn }), 41); // 6 weeks

  return getOccurrencesInRange(events, gridStart, gridEnd, opts);
}

// ─── Schedule view ────────────────────────────────────────────────────────────

/**
 * Return occurrences for a schedule view starting at `from` and spanning
 * `days` days (default: 42 = 6 weeks).
 */
export function getOccurrencesForSchedule(
  events: EventSource,
  from: Date,
  days = 42,
  opts: GetOccurrencesOptions = {},
): EngineOccurrence[] {
  const start = startOfDay(from);
  const end   = addDays(start, days);
  return getOccurrencesInRange(events, start, end, opts);
}
