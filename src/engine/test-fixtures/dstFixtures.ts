/**
 * CalendarEngine — test fixtures for DST edge cases.
 *
 * These fixtures cover the two DST transitions in the US Eastern timezone:
 *   Spring forward: 2026-03-08 02:00 → 03:00 (clocks skip 1 hour)
 *   Fall back:      2026-11-01 02:00 → 01:00 (clocks repeat 1 hour)
 *
 * Used to test recurrence expansion, drag move, and validation near transitions.
 */

import { makeEvent } from '../schema/eventSchema.js';
import type { EngineEvent } from '../schema/eventSchema.js';

// ─── Spring forward (2026-03-08 in US/Eastern) ────────────────────────────────

/** Event that straddles the spring-forward gap: 1:30 AM → 3:30 AM (duration 1h in UTC) */
export const springForwardEvent: EngineEvent = makeEvent('dst-spring-1', {
  title:    'Straddles spring-forward gap',
  // 1:30 AM EST (UTC-5) = 06:30 UTC
  start:    new Date('2026-03-08T06:30:00Z'),
  // 3:30 AM EDT (UTC-4) = 07:30 UTC — only 1 h in UTC but spans the transition
  end:      new Date('2026-03-08T07:30:00Z'),
  timezone: 'America/New_York',
  category: 'test-dst',
});

/** Recurring weekly event that will cross the spring-forward transition */
export const weeklyAcrossSpringForward: EngineEvent = makeEvent('dst-spring-recur', {
  title:    'Weekly across spring-forward',
  // 9:00 AM EST on Feb 9 = 14:00 UTC
  start:    new Date('2026-02-09T14:00:00Z'),
  end:      new Date('2026-02-09T15:00:00Z'),
  timezone: 'America/New_York',
  rrule:    'FREQ=WEEKLY;BYDAY=MO',
  seriesId: 'dst-spring-recur',
  category: 'test-dst',
});

// ─── Fall back (2026-11-01 in US/Eastern) ─────────────────────────────────────

/** Event during the ambiguous fall-back hour (1:30 AM occurs twice) */
export const fallBackAmbiguousEvent: EngineEvent = makeEvent('dst-fall-1', {
  title:    'In the fall-back ambiguous hour',
  // First 1:30 AM EDT (UTC-4) = 05:30 UTC
  start:    new Date('2026-11-01T05:30:00Z'),
  // Second 1:30 AM EST (UTC-5) = 06:30 UTC — same wall clock, different UTC
  end:      new Date('2026-11-01T06:30:00Z'),
  timezone: 'America/New_York',
  category: 'test-dst',
});

/** Recurring weekly event that will cross the fall-back transition */
export const weeklyAcrossFallBack: EngineEvent = makeEvent('dst-fall-recur', {
  title:    'Weekly across fall-back',
  // 9:00 AM EDT on Oct 5 = 13:00 UTC
  start:    new Date('2026-10-05T13:00:00Z'),
  end:      new Date('2026-10-05T14:00:00Z'),
  timezone: 'America/New_York',
  rrule:    'FREQ=WEEKLY;BYDAY=MO',
  seriesId: 'dst-fall-recur',
  category: 'test-dst',
});

// ─── All-day events near DST boundaries ──────────────────────────────────────

/** All-day event on the spring-forward date — end is exclusive midnight */
export const allDaySpringForward: EngineEvent = makeEvent('dst-allday-spring', {
  title:    'All-day on spring-forward day',
  start:    new Date(2026, 2, 8),   // Mar 8
  end:      new Date(2026, 2, 9),   // Mar 9 (exclusive)
  allDay:   true,
  category: 'test-dst',
});

/** All-day event spanning the fall-back transition */
export const allDayFallBack: EngineEvent = makeEvent('dst-allday-fall', {
  title:    'All-day on fall-back day',
  start:    new Date(2026, 10, 1),  // Nov 1
  end:      new Date(2026, 10, 2),  // Nov 2 (exclusive)
  allDay:   true,
  category: 'test-dst',
});

// ─── Collections ─────────────────────────────────────────────────────────────

export const DST_FIXTURES: EngineEvent[] = [
  springForwardEvent,
  weeklyAcrossSpringForward,
  fallBackAmbiguousEvent,
  weeklyAcrossFallBack,
  allDaySpringForward,
  allDayFallBack,
];

export const SPRING_FORWARD_RANGE = {
  start: new Date('2026-03-01T00:00:00Z'),
  end:   new Date('2026-03-31T23:59:59Z'),
};

export const FALL_BACK_RANGE = {
  start: new Date('2026-10-26T00:00:00Z'),
  end:   new Date('2026-11-07T23:59:59Z'),
};
