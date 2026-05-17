/**
 * CalendarEngine — test fixtures for recurring events.
 *
 * Use these in unit tests for expandOccurrences, resolveRecurringEdit,
 * splitSeries, detachOccurrence, and validateOperation.
 */

import { makeEvent } from '../schema/eventSchema.js';
import type { EngineEvent } from '../schema/eventSchema.js';

// ─── Base dates ───────────────────────────────────────────────────────────────
// Use a fixed date so tests are deterministic.

const _BASE = new Date('2026-01-05T09:00:00'); // Monday

function d(y: number, mo: number, day: number, h = 9, m = 0): Date {
  return new Date(y, mo - 1, day, h, m, 0, 0);
}

// ─── Single events ────────────────────────────────────────────────────────────

export const singleEvent: EngineEvent = makeEvent('single-1', {
  title: 'One-off meeting',
  start: d(2026, 1, 5, 10),
  end:   d(2026, 1, 5, 11),
  category: 'work',
  resourceId: 'room-a',
});

export const allDayEvent: EngineEvent = makeEvent('allday-1', {
  title: 'Company holiday',
  start: d(2026, 1, 5),
  end:   d(2026, 1, 6), // exclusive end (iCal convention)
  allDay: true,
  category: 'holiday',
});

// ─── Recurring series ─────────────────────────────────────────────────────────

/** Daily standup — every weekday at 9 AM */
export const dailyStandup: EngineEvent = makeEvent('daily-standup', {
  title: 'Daily standup',
  start: d(2026, 1, 5, 9),
  end:   d(2026, 1, 5, 9, 15),
  rrule: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
  seriesId: 'daily-standup',
  category: 'work',
  resourceId: 'conf-a',
});

/** Weekly team meeting — every Monday at 2 PM */
export const weeklyTeamMeeting: EngineEvent = makeEvent('weekly-meeting', {
  title: 'Team meeting',
  start: d(2026, 1, 5, 14),
  end:   d(2026, 1, 5, 15),
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  seriesId: 'weekly-meeting',
  category: 'work',
});

/** Monthly 1-on-1 — first Monday of each month at 10 AM */
export const monthlyOneOnOne: EngineEvent = makeEvent('monthly-1on1', {
  title: '1-on-1',
  start: d(2026, 1, 5, 10),
  end:   d(2026, 1, 5, 11),
  rrule: 'FREQ=MONTHLY;BYDAY=1MO',
  seriesId: 'monthly-1on1',
  category: 'work',
});

/** Bi-weekly with COUNT — every other Friday, 5 occurrences */
export const biWeeklyCount: EngineEvent = makeEvent('biweekly-count', {
  title: 'Sprint review',
  start: d(2026, 1, 9, 15),    // Friday
  end:   d(2026, 1, 9, 16),
  rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;COUNT=5',
  seriesId: 'biweekly-count',
});

/** Recurring with EXDATE — weekly on Wednesday but skipping Jan 21 */
export const weeklyWithExdate: EngineEvent = makeEvent('weekly-exdate', {
  title: 'Wednesday workshop',
  start: d(2026, 1, 7, 14),   // first Wednesday
  end:   d(2026, 1, 7, 16),
  rrule: 'FREQ=WEEKLY;BYDAY=WE',
  exdates: [d(2026, 1, 21)],
  seriesId: 'weekly-exdate',
});

// ─── Detached occurrence ──────────────────────────────────────────────────────

/** A detached occurrence of dailyStandup — moved to 9:30 on Jan 7 */
export const detachedOccurrence: EngineEvent = makeEvent('daily-standup-detach-1', {
  title: 'Daily standup (rescheduled)',
  start: d(2026, 1, 7, 9, 30),
  end:   d(2026, 1, 7, 9, 45),
  seriesId: 'daily-standup',
  occurrenceId: '2026-01-07T09:00',
  detachedFrom: 'daily-standup',
  category: 'work',
  resourceId: 'conf-a',
});

// ─── Collections ─────────────────────────────────────────────────────────────

export const ALL_FIXTURES: EngineEvent[] = [
  singleEvent,
  allDayEvent,
  dailyStandup,
  weeklyTeamMeeting,
  monthlyOneOnOne,
  biWeeklyCount,
  weeklyWithExdate,
  detachedOccurrence,
];

export const RECURRING_FIXTURES: EngineEvent[] = [
  dailyStandup,
  weeklyTeamMeeting,
  monthlyOneOnOne,
  biWeeklyCount,
  weeklyWithExdate,
];
