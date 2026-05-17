/**
 * resourceCalendarSchema — pure-function branch coverage.
 *
 * Tests calendarForResource, isNonWorkingTime, overlapsNonWorking, and the
 * internal yearly-entry helpers (exercised via the public functions).
 */
import { describe, it, expect } from 'vitest';
import {
  makeCalendarEntry,
  makeResourceCalendar,
  calendarForResource,
  isNonWorkingTime,
  overlapsNonWorking,
} from '../resourceCalendarSchema.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function d(year: number, month: number, day: number, hour = 0, min = 0): Date {
  return new Date(year, month - 1, day, hour, min, 0, 0);
}

// ─── calendarForResource ─────────────────────────────────────────────────────

describe('calendarForResource', () => {
  it('returns the matching calendar', () => {
    const cal = makeResourceCalendar('c1', 'r1');
    const map = new Map([['c1', cal]]);
    expect(calendarForResource(map, 'r1')).toBe(cal);
  });

  it('returns null when no calendars match', () => {
    const cal = makeResourceCalendar('c1', 'r1');
    const map = new Map([['c1', cal]]);
    // r2 is not in any calendar — loop runs but condition is always false
    expect(calendarForResource(map, 'r2')).toBeNull();
  });

  it('returns null when map is empty', () => {
    expect(calendarForResource(new Map(), 'r1')).toBeNull();
  });
});

// ─── isNonWorkingTime ────────────────────────────────────────────────────────

describe('isNonWorkingTime', () => {
  it('returns true for a point inside a non-working entry', () => {
    const holiday = makeCalendarEntry('h1', {
      type: 'non-working',
      start: d(2026, 12, 25, 0, 0),
      end:   d(2026, 12, 26, 0, 0),
    });
    const cal = makeResourceCalendar('c1', 'r1', [holiday]);
    expect(isNonWorkingTime(cal, d(2026, 12, 25, 12, 0))).toBe(true);
  });

  it('returns false for a point outside any non-working entry', () => {
    const holiday = makeCalendarEntry('h1', {
      type: 'non-working',
      start: d(2026, 12, 25, 0, 0),
      end:   d(2026, 12, 26, 0, 0),
    });
    const cal = makeResourceCalendar('c1', 'r1', [holiday]);
    expect(isNonWorkingTime(cal, d(2026, 12, 24, 12, 0))).toBe(false);
  });

  it('returns false when a working override covers the non-working period', () => {
    const holiday = makeCalendarEntry('h1', {
      type: 'non-working',
      start: d(2026, 12, 25, 0, 0),
      end:   d(2026, 12, 26, 0, 0),
    });
    const specialDay = makeCalendarEntry('w1', {
      type: 'working',
      start: d(2026, 12, 25, 9, 0),
      end:   d(2026, 12, 25, 17, 0),
    });
    const cal = makeResourceCalendar('c1', 'r1', [holiday, specialDay]);
    // 10:00 on Dec 25 is covered by both; working override wins → false
    expect(isNonWorkingTime(cal, d(2026, 12, 25, 10, 0))).toBe(false);
  });

  it('returns false when there are no entries at all', () => {
    const cal = makeResourceCalendar('c1', 'r1', []);
    expect(isNonWorkingTime(cal, d(2026, 6, 15, 12, 0))).toBe(false);
  });

  it('handles a yearly non-working entry (Christmas every year)', () => {
    const xmas = {
      ...makeCalendarEntry('h1', {
        type: 'non-working',
        start: d(2000, 12, 25, 0, 0),  // year 2000, but yearly=true
        end:   d(2000, 12, 26, 0, 0),
      }),
      yearly: true,
    };
    const cal = makeResourceCalendar('c1', 'r1', [xmas]);
    // Should fire in 2026 even though entry uses year 2000
    expect(isNonWorkingTime(cal, d(2026, 12, 25, 8, 0))).toBe(true);
    expect(isNonWorkingTime(cal, d(2027, 12, 25, 8, 0))).toBe(true);
    expect(isNonWorkingTime(cal, d(2026, 12, 24, 8, 0))).toBe(false);
  });
});

// ─── overlapsNonWorking ───────────────────────────────────────────────────────

describe('overlapsNonWorking', () => {
  it('returns true when the range fully overlaps a non-working entry', () => {
    const holiday = makeCalendarEntry('h1', {
      type: 'non-working',
      start: d(2026, 12, 25, 0, 0),
      end:   d(2026, 12, 26, 0, 0),
    });
    const cal = makeResourceCalendar('c1', 'r1', [holiday]);
    expect(overlapsNonWorking(cal, d(2026, 12, 24, 23, 0), d(2026, 12, 25, 1, 0))).toBe(true);
  });

  it('returns false when the range does not overlap any non-working entry', () => {
    const holiday = makeCalendarEntry('h1', {
      type: 'non-working',
      start: d(2026, 12, 25, 0, 0),
      end:   d(2026, 12, 26, 0, 0),
    });
    const cal = makeResourceCalendar('c1', 'r1', [holiday]);
    expect(overlapsNonWorking(cal, d(2026, 12, 23, 9, 0), d(2026, 12, 23, 17, 0))).toBe(false);
  });

  it('returns false when a working override rescues the entire overlap', () => {
    const holiday = makeCalendarEntry('h1', {
      type: 'non-working',
      start: d(2026, 12, 25, 0, 0),
      end:   d(2026, 12, 26, 0, 0),
    });
    const override = makeCalendarEntry('w1', {
      type: 'working',
      start: d(2026, 12, 25, 0, 0),
      end:   d(2026, 12, 26, 0, 0),
    });
    const cal = makeResourceCalendar('c1', 'r1', [holiday, override]);
    expect(overlapsNonWorking(cal, d(2026, 12, 25, 9, 0), d(2026, 12, 25, 17, 0))).toBe(false);
  });

  it('handles yearly entries in overlapsNonWorking', () => {
    const xmas = {
      ...makeCalendarEntry('h1', {
        type: 'non-working',
        start: d(2000, 12, 25, 0, 0),
        end:   d(2000, 12, 26, 0, 0),
      }),
      yearly: true,
    };
    const cal = makeResourceCalendar('c1', 'r1', [xmas]);
    // Range spanning Dec 25 2026 midnight
    expect(overlapsNonWorking(cal, d(2026, 12, 24, 20, 0), d(2026, 12, 25, 4, 0))).toBe(true);
  });
});
