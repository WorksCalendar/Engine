/**
 * CalendarEngine — test fixtures for timezone-aware events.
 *
 * These fixtures cover multi-timezone scenarios:
 *   - events stored with explicit IANA timezones
 *   - overlapping events in different zones
 *   - events that cross midnight in one zone but not another
 */

import { makeEvent } from '../schema/eventSchema.js';
import type { EngineEvent } from '../schema/eventSchema.js';

// ─── NYC morning standup (EST = UTC-5) ────────────────────────────────────────

export const nycStandup: EngineEvent = makeEvent('nyc-standup', {
  title: 'NYC morning standup',
  // 9:00 AM EST = 14:00 UTC
  start:    new Date('2026-01-05T14:00:00Z'),
  end:      new Date('2026-01-05T14:30:00Z'),
  timezone: 'America/New_York',
  category: 'work',
  resourceId: 'team-east',
});

// ─── Denver afternoon call (MST = UTC-7) ─────────────────────────────────────

export const denverCall: EngineEvent = makeEvent('denver-call', {
  title: 'Denver afternoon call',
  // 2:00 PM MST = 21:00 UTC
  start:    new Date('2026-01-05T21:00:00Z'),
  end:      new Date('2026-01-05T22:00:00Z'),
  timezone: 'America/Denver',
  category: 'work',
  resourceId: 'team-west',
});

// ─── London morning meeting (GMT = UTC+0 in winter) ──────────────────────────

export const londonMeeting: EngineEvent = makeEvent('london-meeting', {
  title: 'London morning meeting',
  // 9:00 AM GMT = 09:00 UTC
  start:    new Date('2026-01-05T09:00:00Z'),
  end:      new Date('2026-01-05T10:00:00Z'),
  timezone: 'Europe/London',
  category: 'work',
});

// ─── Tokyo morning review (JST = UTC+9) ──────────────────────────────────────

export const tokyoReview: EngineEvent = makeEvent('tokyo-review', {
  title: 'Tokyo morning review',
  // 9:00 AM JST = 00:00 UTC
  start:    new Date('2026-01-05T00:00:00Z'),
  end:      new Date('2026-01-05T01:00:00Z'),
  timezone: 'Asia/Tokyo',
  category: 'work',
});

// ─── Cross-midnight event (Sydney → previous UTC day) ────────────────────────

export const sydneyLateNight: EngineEvent = makeEvent('sydney-late', {
  title: 'Sydney end-of-day sync',
  // 11:00 PM AEDT (UTC+11) = 12:00 UTC same day
  start:    new Date('2026-01-05T12:00:00Z'),
  end:      new Date('2026-01-05T13:00:00Z'),
  timezone: 'Australia/Sydney',
  category: 'work',
});

// ─── Floating event (no timezone) ────────────────────────────────────────────

export const floatingEvent: EngineEvent = makeEvent('floating-1', {
  title: 'Local reminder',
  start:    new Date(2026, 0, 5, 15, 0, 0),  // local time, no UTC offset
  end:      new Date(2026, 0, 5, 15, 30, 0),
  timezone: null,                              // floating
  category: 'personal',
});

// ─── Collections ─────────────────────────────────────────────────────────────

export const TIMEZONE_FIXTURES: EngineEvent[] = [
  nycStandup,
  denverCall,
  londonMeeting,
  tokyoReview,
  sydneyLateNight,
  floatingEvent,
];
