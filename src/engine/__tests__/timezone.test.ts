// @vitest-environment node
/**
 * Regression tests for timezone and DST utilities.
 *
 * Covers:
 *   - partsInTimezone, utcOffsetMinutes, hoursInTimezone, wallClockToUtc
 *   - crossesDSTBoundary, dstShiftMinutes, preserveWallClockAfterDST
 *   - isInSpringForwardGap, isInFallBackRepeat
 *   - Integration: fixture events display at correct local times
 *   - Wall-clock preservation across spring-forward and fall-back
 */

import { describe, it, expect } from 'vitest';
import {
  partsInTimezone,
  utcOffsetMinutes,
  hoursInTimezone,
  wallClockToUtc,
  isValidTimezone,
  localTimezone,
} from '../time/timezone.js';
import {
  crossesDSTBoundary,
  dstShiftMinutes,
  preserveWallClockAfterDST,
  isInSpringForwardGap,
  isInFallBackRepeat,
} from '../time/dst.js';
import {
  nycStandup,
  denverCall,
  londonMeeting,
  tokyoReview,
  floatingEvent,
} from '../test-fixtures/timezoneFixtures.js';
import {
  springForwardEvent,
  weeklyAcrossSpringForward,
  fallBackAmbiguousEvent,
  weeklyAcrossFallBack,
} from '../test-fixtures/dstFixtures.js';

// ─── partsInTimezone ──────────────────────────────────────────────────────────

describe('partsInTimezone', () => {
  it('returns 9:00 AM for NYC standup in America/New_York', () => {
    // nycStandup.start = 2026-01-05T14:00:00Z = 9:00 AM EST
    const parts = partsInTimezone(nycStandup.start, 'America/New_York');
    expect(parts.hour).toBe(9);
    expect(parts.minute).toBe(0);
  });

  it('returns 2:00 PM for Denver call in America/Denver', () => {
    // denverCall.start = 2026-01-05T21:00:00Z = 2:00 PM MST
    const parts = partsInTimezone(denverCall.start, 'America/Denver');
    expect(parts.hour).toBe(14);
    expect(parts.minute).toBe(0);
  });

  it('returns 9:00 AM for London meeting in Europe/London', () => {
    // londonMeeting.start = 2026-01-05T09:00:00Z = 9:00 AM GMT
    const parts = partsInTimezone(londonMeeting.start, 'Europe/London');
    expect(parts.hour).toBe(9);
    expect(parts.minute).toBe(0);
  });

  it('returns 9:00 AM for Tokyo review in Asia/Tokyo', () => {
    // tokyoReview.start = 2026-01-05T00:00:00Z = 9:00 AM JST
    const parts = partsInTimezone(tokyoReview.start, 'Asia/Tokyo');
    expect(parts.hour).toBe(9);
    expect(parts.minute).toBe(0);
  });

  it('returns the correct date when event crosses midnight in one timezone', () => {
    // 2026-01-05T23:00:00Z = Jan 5 in UTC = Jan 6 8:00 AM JST
    const d = new Date('2026-01-05T23:00:00Z');
    const parts = partsInTimezone(d, 'Asia/Tokyo');
    expect(parts.day).toBe(6);
    expect(parts.hour).toBe(8);
  });
});

// ─── utcOffsetMinutes ─────────────────────────────────────────────────────────

describe('utcOffsetMinutes', () => {
  it('returns -300 for EST (UTC-5)', () => {
    // January = EST, not EDT
    expect(utcOffsetMinutes(nycStandup.start, 'America/New_York')).toBe(-300);
  });

  it('returns -420 for MST (UTC-7)', () => {
    // January = MST, not MDT
    expect(utcOffsetMinutes(denverCall.start, 'America/Denver')).toBe(-420);
  });

  it('returns 0 for GMT (UTC+0)', () => {
    expect(utcOffsetMinutes(londonMeeting.start, 'Europe/London')).toBe(0);
  });

  it('returns +540 for JST (UTC+9)', () => {
    expect(utcOffsetMinutes(tokyoReview.start, 'Asia/Tokyo')).toBe(540);
  });

  it('returns -240 for EDT (UTC-4, after spring-forward)', () => {
    // After spring-forward in 2026 (Mar 8), EDT applies
    const edtDate = new Date('2026-06-15T12:00:00Z'); // summer = EDT
    expect(utcOffsetMinutes(edtDate, 'America/New_York')).toBe(-240);
  });
});

// ─── hoursInTimezone ──────────────────────────────────────────────────────────

describe('hoursInTimezone', () => {
  it('returns 9.0 for nycStandup in America/New_York', () => {
    expect(hoursInTimezone(nycStandup.start, 'America/New_York')).toBeCloseTo(9.0, 5);
  });

  it('returns 14.0 for denverCall in America/Denver', () => {
    expect(hoursInTimezone(denverCall.start, 'America/Denver')).toBeCloseTo(14.0, 5);
  });

  it('returns 9.0 for tokyoReview in Asia/Tokyo', () => {
    expect(hoursInTimezone(tokyoReview.start, 'Asia/Tokyo')).toBeCloseTo(9.0, 5);
  });

  it('returns decimal hours for 30-minute offsets', () => {
    // 30-min mark: 9:30 AM = 9.5
    const halfHour = new Date('2026-01-05T14:30:00Z'); // 9:30 AM EST
    expect(hoursInTimezone(halfHour, 'America/New_York')).toBeCloseTo(9.5, 5);
  });

  it('converts same UTC to different local hours across zones', () => {
    const utcNoon = new Date('2026-01-05T12:00:00Z');
    // UTC+0 → 12:00; UTC-5 → 7:00; UTC+9 → 21:00
    expect(hoursInTimezone(utcNoon, 'Europe/London')).toBeCloseTo(12.0, 5);
    expect(hoursInTimezone(utcNoon, 'America/New_York')).toBeCloseTo(7.0, 5);
    expect(hoursInTimezone(utcNoon, 'Asia/Tokyo')).toBeCloseTo(21.0, 5);
  });
});

// ─── wallClockToUtc ───────────────────────────────────────────────────────────

describe('wallClockToUtc', () => {
  it('converts 9:00 AM EST to 14:00 UTC', () => {
    const result = wallClockToUtc(2026, 1, 5, 9, 0, 0, 'America/New_York');
    expect(result.toISOString()).toBe('2026-01-05T14:00:00.000Z');
  });

  it('converts 2:00 PM MST to 21:00 UTC', () => {
    const result = wallClockToUtc(2026, 1, 5, 14, 0, 0, 'America/Denver');
    expect(result.toISOString()).toBe('2026-01-05T21:00:00.000Z');
  });

  it('converts 9:00 AM GMT to 09:00 UTC', () => {
    const result = wallClockToUtc(2026, 1, 5, 9, 0, 0, 'Europe/London');
    expect(result.toISOString()).toBe('2026-01-05T09:00:00.000Z');
  });

  it('converts 9:00 AM JST to 00:00 UTC', () => {
    const result = wallClockToUtc(2026, 1, 5, 9, 0, 0, 'Asia/Tokyo');
    expect(result.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });

  it('converts 9:00 AM EDT (summer) to 13:00 UTC', () => {
    // EDT = UTC-4
    const result = wallClockToUtc(2026, 6, 15, 9, 0, 0, 'America/New_York');
    expect(result.toISOString()).toBe('2026-06-15T13:00:00.000Z');
  });
});

// ─── isValidTimezone ──────────────────────────────────────────────────────────

describe('isValidTimezone', () => {
  it('returns true for well-known IANA timezone identifiers', () => {
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('Asia/Tokyo')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
  });

  it('returns false for invalid timezone strings', () => {
    expect(isValidTimezone('Invalid/Zone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('NotARealZone/Nowhere')).toBe(false);
  });
});

// ─── localTimezone ────────────────────────────────────────────────────────────

describe('localTimezone', () => {
  it('returns a non-empty string', () => {
    const tz = localTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });
});

// ─── crossesDSTBoundary ───────────────────────────────────────────────────────

describe('crossesDSTBoundary', () => {
  it('returns true for springForwardEvent (1:30 AM EST → 3:30 AM EDT)', () => {
    expect(
      crossesDSTBoundary(springForwardEvent.start, springForwardEvent.end, 'America/New_York'),
    ).toBe(true);
  });

  it('returns false for nycStandup (both in EST)', () => {
    expect(
      crossesDSTBoundary(nycStandup.start, nycStandup.end, 'America/New_York'),
    ).toBe(false);
  });

  it('returns true for fallBackAmbiguousEvent (EDT → EST within same wall-clock hour)', () => {
    expect(
      crossesDSTBoundary(fallBackAmbiguousEvent.start, fallBackAmbiguousEvent.end, 'America/New_York'),
    ).toBe(true);
  });

  it('returns false for an event entirely within EDT (summer)', () => {
    const edtStart = new Date('2026-06-15T13:00:00Z'); // 9:00 AM EDT
    const edtEnd   = new Date('2026-06-15T14:00:00Z'); // 10:00 AM EDT
    expect(crossesDSTBoundary(edtStart, edtEnd, 'America/New_York')).toBe(false);
  });

  it('returns true for two dates spanning the spring-forward transition (Mar 7 → Mar 9)', () => {
    const before = new Date('2026-03-07T14:00:00Z'); // in EST
    const after  = new Date('2026-03-09T14:00:00Z'); // in EDT
    expect(crossesDSTBoundary(before, after, 'America/New_York')).toBe(true);
  });
});

// ─── dstShiftMinutes ─────────────────────────────────────────────────────────

describe('dstShiftMinutes', () => {
  it('returns +60 across spring-forward (EST → EDT, offset -300 → -240)', () => {
    const before = new Date('2026-03-07T14:00:00Z'); // EST = -300
    const after  = new Date('2026-03-09T14:00:00Z'); // EDT = -240
    // utcOffset(after) - utcOffset(before) = -240 - (-300) = +60
    expect(dstShiftMinutes(before, after, 'America/New_York')).toBe(60);
  });

  it('returns -60 across fall-back (EDT → EST, offset -240 → -300)', () => {
    const before = new Date('2026-10-31T12:00:00Z'); // EDT = -240
    const after  = new Date('2026-11-02T12:00:00Z'); // EST = -300
    // utcOffset(after) - utcOffset(before) = -300 - (-240) = -60
    expect(dstShiftMinutes(before, after, 'America/New_York')).toBe(-60);
  });

  it('returns 0 for two dates in the same timezone offset', () => {
    const d1 = new Date('2026-01-05T14:00:00Z'); // EST
    const d2 = new Date('2026-02-10T14:00:00Z'); // still EST
    expect(dstShiftMinutes(d1, d2, 'America/New_York')).toBe(0);
  });

  it('returns 0 for Asia/Tokyo (no DST)', () => {
    const d1 = new Date('2026-03-07T00:00:00Z');
    const d2 = new Date('2026-03-10T00:00:00Z');
    expect(dstShiftMinutes(d1, d2, 'Asia/Tokyo')).toBe(0);
  });
});

// ─── preserveWallClockAfterDST ───────────────────────────────────────────────

describe('preserveWallClockAfterDST', () => {
  it('adjusts UTC so that 9:00 AM EST stays 9:00 AM EDT after spring-forward', () => {
    // Original occurrence: 14:00 UTC (9:00 AM EST)
    // Naive next occurrence on Mar 9: still at 14:00 UTC = 10:00 AM EDT (wrong)
    const naiveNextOccurrence = new Date('2026-03-09T14:00:00Z');

    // EDT is UTC-4, so 9:00 AM EDT = 13:00 UTC
    const shift = dstShiftMinutes(
      new Date('2026-03-07T14:00:00Z'), // before transition (EST)
      naiveNextOccurrence,              // after transition (EDT)
      'America/New_York',
    );
    expect(shift).toBe(60); // +60 for spring forward

    const preserved = preserveWallClockAfterDST(naiveNextOccurrence, shift);
    // 14:00 UTC - 60 min = 13:00 UTC = 9:00 AM EDT
    expect(preserved.toISOString()).toBe('2026-03-09T13:00:00.000Z');
    expect(hoursInTimezone(preserved, 'America/New_York')).toBeCloseTo(9.0, 5);
  });

  it('adjusts UTC so that 9:00 AM EDT stays 9:00 AM EST after fall-back', () => {
    // Original occurrence before fall back: 13:00 UTC (9:00 AM EDT)
    // Naive next occurrence after fall back: still at 13:00 UTC = 8:00 AM EST (wrong)
    const naiveNextOccurrence = new Date('2026-11-02T13:00:00Z');

    const shift = dstShiftMinutes(
      new Date('2026-10-31T13:00:00Z'), // EDT = -240
      naiveNextOccurrence,              // EST = -300
      'America/New_York',
    );
    expect(shift).toBe(-60); // -60 for fall back

    const preserved = preserveWallClockAfterDST(naiveNextOccurrence, shift);
    // 13:00 UTC - (-60 min) = 13:00 + 60 min = 14:00 UTC = 9:00 AM EST
    expect(preserved.toISOString()).toBe('2026-11-02T14:00:00.000Z');
    expect(hoursInTimezone(preserved, 'America/New_York')).toBeCloseTo(9.0, 5);
  });

  it('returns the original date unchanged when shift is 0', () => {
    const d = new Date('2026-01-05T14:00:00Z');
    expect(preserveWallClockAfterDST(d, 0)).toBe(d); // same reference
  });
});

// ─── isInSpringForwardGap ─────────────────────────────────────────────────────

describe('isInSpringForwardGap', () => {
  // The spring-forward transition in US/Eastern 2026 occurs at 2026-03-08 07:00 UTC
  // (2:00 AM EST → 3:00 AM EDT).  The function detects the UTC instant where
  // the UTC offset increases (offBefore < offAfter).

  it('returns true at the exact spring-forward transition instant (07:00 UTC)', () => {
    // At 06:59 UTC the offset is -300 (EST); at 07:01 UTC it is -240 (EDT)
    const atTransition = new Date('2026-03-08T07:00:00Z');
    expect(isInSpringForwardGap(atTransition, 'America/New_York')).toBe(true);
  });

  it('returns false 30 minutes before the transition (1:30 AM EST)', () => {
    // 06:30 UTC: both before and after are still EST (-300)
    const beforeGap = new Date('2026-03-08T06:30:00Z');
    expect(isInSpringForwardGap(beforeGap, 'America/New_York')).toBe(false);
  });

  it('returns false 30 minutes after the transition (3:30 AM EDT)', () => {
    // 07:30 UTC: both before and after are EDT (-240)
    const afterGap = new Date('2026-03-08T07:30:00Z');
    expect(isInSpringForwardGap(afterGap, 'America/New_York')).toBe(false);
  });

  it('returns false in a timezone with no DST (Asia/Tokyo)', () => {
    const d = new Date('2026-03-08T07:00:00Z');
    expect(isInSpringForwardGap(d, 'Asia/Tokyo')).toBe(false);
  });

  it('returns false at the fall-back transition instant (not spring forward)', () => {
    // 2026-11-01 06:00 UTC is the fall-back transition — must NOT be detected here
    const fallBackTransition = new Date('2026-11-01T06:00:00Z');
    expect(isInSpringForwardGap(fallBackTransition, 'America/New_York')).toBe(false);
  });
});

// ─── isInFallBackRepeat ───────────────────────────────────────────────────────

describe('isInFallBackRepeat', () => {
  // The fall-back transition in US/Eastern 2026 occurs at 2026-11-01 06:00 UTC
  // (2:00 AM EDT → 1:00 AM EST).  The function detects the UTC instant where
  // the UTC offset decreases (offBefore > offAfter).

  it('returns true at the exact fall-back transition instant (06:00 UTC)', () => {
    // At 05:59 UTC the offset is -240 (EDT); at 06:01 UTC it is -300 (EST)
    const atTransition = new Date('2026-11-01T06:00:00Z');
    expect(isInFallBackRepeat(atTransition, 'America/New_York')).toBe(true);
  });

  it('returns false 30 minutes before the transition (1:30 AM EDT)', () => {
    // 05:30 UTC: both before and after are EDT (-240)
    const before = new Date('2026-11-01T05:30:00Z');
    expect(isInFallBackRepeat(before, 'America/New_York')).toBe(false);
  });

  it('returns false 30 minutes after the transition (1:30 AM EST)', () => {
    // 06:30 UTC: both before and after are EST (-300)
    const after = new Date('2026-11-01T06:30:00Z');
    expect(isInFallBackRepeat(after, 'America/New_York')).toBe(false);
  });

  it('returns false in a timezone with no DST (Asia/Tokyo)', () => {
    const d = new Date('2026-11-01T06:00:00Z');
    expect(isInFallBackRepeat(d, 'Asia/Tokyo')).toBe(false);
  });

  it('returns false at the spring-forward transition instant (not fall back)', () => {
    // 2026-03-08 07:00 UTC is the spring-forward transition — must NOT be detected here
    const springForwardTransition = new Date('2026-03-08T07:00:00Z');
    expect(isInFallBackRepeat(springForwardTransition, 'America/New_York')).toBe(false);
  });
});

// ─── Integration: fixture events at correct local times ───────────────────────

describe('timezone fixture events — local display hours', () => {
  it('nycStandup displays at 9:00 AM in America/New_York', () => {
    const hours = hoursInTimezone(nycStandup.start, 'America/New_York');
    expect(hours).toBeCloseTo(9.0, 5);
  });

  it('denverCall displays at 2:00 PM in America/Denver', () => {
    const hours = hoursInTimezone(denverCall.start, 'America/Denver');
    expect(hours).toBeCloseTo(14.0, 5);
  });

  it('londonMeeting displays at 9:00 AM in Europe/London', () => {
    const hours = hoursInTimezone(londonMeeting.start, 'Europe/London');
    expect(hours).toBeCloseTo(9.0, 5);
  });

  it('tokyoReview displays at 9:00 AM in Asia/Tokyo', () => {
    const hours = hoursInTimezone(tokyoReview.start, 'Asia/Tokyo');
    expect(hours).toBeCloseTo(9.0, 5);
  });

  it('nycStandup appears at 2:00 PM in Europe/London (the UTC equivalent)', () => {
    const hours = hoursInTimezone(nycStandup.start, 'Europe/London');
    expect(hours).toBeCloseTo(14.0, 5);
  });

  it('tokyoReview appears at midnight UTC in Europe/London', () => {
    const hours = hoursInTimezone(tokyoReview.start, 'Europe/London');
    expect(hours).toBeCloseTo(0.0, 5);
  });

  it('springForwardEvent crosses DST boundary in America/New_York', () => {
    expect(
      crossesDSTBoundary(springForwardEvent.start, springForwardEvent.end, 'America/New_York'),
    ).toBe(true);
  });

  it('fallBackAmbiguousEvent crosses DST boundary in America/New_York', () => {
    expect(
      crossesDSTBoundary(fallBackAmbiguousEvent.start, fallBackAmbiguousEvent.end, 'America/New_York'),
    ).toBe(true);
  });
});

// ─── Integration: wall-clock preservation across DST transitions ──────────────

describe('wall-clock preservation — weekly recurrence across spring-forward', () => {
  // weeklyAcrossSpringForward: Mon Feb 9 at 9:00 AM EST = 14:00 UTC
  // Spring forward 2026-03-08 (Sun): next Monday is Mar 9
  // Without preservation: still at 14:00 UTC = 10:00 AM EDT (wrong)
  // With preservation: should be 13:00 UTC = 9:00 AM EDT (correct)

  it('naive occurrence (14:00 UTC) displays at 10:00 AM EDT — wrong', () => {
    const naiveOccurrence = new Date('2026-03-09T14:00:00Z');
    const displayHours = hoursInTimezone(naiveOccurrence, 'America/New_York');
    expect(displayHours).toBeCloseTo(10.0, 5); // 14:00 UTC in EDT = 10:00 AM
  });

  it('preserved occurrence (13:00 UTC) displays at 9:00 AM EDT — correct', () => {
    const naiveOccurrence = new Date('2026-03-09T14:00:00Z');

    // Compute DST shift between a pre-transition date and the occurrence
    const preTransition = new Date('2026-03-07T14:00:00Z'); // EST
    const shift = dstShiftMinutes(preTransition, naiveOccurrence, 'America/New_York');

    // shift = +60 (utcOffset went from -300 to -240)
    expect(shift).toBe(60);

    const preserved = preserveWallClockAfterDST(naiveOccurrence, shift);
    expect(preserved.toISOString()).toBe('2026-03-09T13:00:00.000Z');

    const displayHours = hoursInTimezone(preserved, 'America/New_York');
    expect(displayHours).toBeCloseTo(9.0, 5);
  });

  it('weeklyAcrossSpringForward anchor is at 9:00 AM EST', () => {
    const hours = hoursInTimezone(
      weeklyAcrossSpringForward.start,
      'America/New_York',
    );
    expect(hours).toBeCloseTo(9.0, 5);
  });
});

describe('wall-clock preservation — weekly recurrence across fall-back', () => {
  // weeklyAcrossFallBack: Mon Oct 5 at 9:00 AM EDT = 13:00 UTC
  // Fall back 2026-11-01 (Sun): next Monday is Nov 2
  // Without preservation: still at 13:00 UTC = 8:00 AM EST (wrong)
  // With preservation: should be 14:00 UTC = 9:00 AM EST (correct)

  it('naive occurrence (13:00 UTC after fall-back) displays at 8:00 AM EST — wrong', () => {
    const naiveOccurrence = new Date('2026-11-02T13:00:00Z');
    const displayHours = hoursInTimezone(naiveOccurrence, 'America/New_York');
    expect(displayHours).toBeCloseTo(8.0, 5); // 13:00 UTC in EST = 8:00 AM
  });

  it('preserved occurrence (14:00 UTC) displays at 9:00 AM EST — correct', () => {
    const naiveOccurrence = new Date('2026-11-02T13:00:00Z');

    const preTransition = new Date('2026-10-31T13:00:00Z'); // EDT
    const shift = dstShiftMinutes(preTransition, naiveOccurrence, 'America/New_York');

    // shift = -60 (utcOffset went from -240 to -300)
    expect(shift).toBe(-60);

    const preserved = preserveWallClockAfterDST(naiveOccurrence, shift);
    // 13:00 UTC - (-60 min) = 14:00 UTC = 9:00 AM EST
    expect(preserved.toISOString()).toBe('2026-11-02T14:00:00.000Z');

    const displayHours = hoursInTimezone(preserved, 'America/New_York');
    expect(displayHours).toBeCloseTo(9.0, 5);
  });

  it('weeklyAcrossFallBack anchor is at 9:00 AM EDT', () => {
    const hours = hoursInTimezone(
      weeklyAcrossFallBack.start,
      'America/New_York',
    );
    expect(hours).toBeCloseTo(9.0, 5);
  });
});
