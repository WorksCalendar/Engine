/**
 * Unit tests for src/core/engine/time/rangeMath.ts
 *
 * Pure date-range predicates and set operations — no React, no side effects.
 */

import { describe, it, expect } from 'vitest';
import {
  rangesOverlap,
  rangeContains,
  pointInRange,
  rangeIntersection,
  rangeUnion,
  expandRangeByDays,
  rangeDurationMs,
  filterOverlapping,
  type DateRange,
} from '../rangeMath.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function r(startHour: number, endHour: number, day = 5): DateRange {
  return {
    start: new Date(2026, 0, day, startHour, 0, 0),
    end:   new Date(2026, 0, day, endHour,   0, 0),
  };
}

function rDay(startDay: number, endDay: number): DateRange {
  return {
    start: new Date(2026, 0, startDay),
    end:   new Date(2026, 0, endDay),
  };
}

// ─── rangesOverlap ────────────────────────────────────────────────────────────

describe('rangesOverlap', () => {
  it('returns true when a starts inside b', () => {
    // a: [10, 12), b: [9, 11) → overlap at [10, 11)
    expect(rangesOverlap(r(10, 12), r(9, 11))).toBe(true);
  });

  it('returns true when b starts inside a', () => {
    expect(rangesOverlap(r(9, 12), r(10, 14))).toBe(true);
  });

  it('returns true when one range is fully inside the other', () => {
    expect(rangesOverlap(r(9, 17), r(10, 11))).toBe(true);
  });

  it('returns false when they are adjacent (touching end-to-start)', () => {
    // [9, 10) and [10, 11) — half-open so no overlap
    expect(rangesOverlap(r(9, 10), r(10, 11))).toBe(false);
  });

  it('returns false when a is entirely before b', () => {
    expect(rangesOverlap(r(8, 9), r(10, 11))).toBe(false);
  });

  it('returns false when b is entirely before a', () => {
    expect(rangesOverlap(r(12, 14), r(9, 11))).toBe(false);
  });
});

// ─── rangeContains ────────────────────────────────────────────────────────────

describe('rangeContains', () => {
  it('returns true when inner fits exactly inside outer', () => {
    expect(rangeContains(r(9, 17), r(10, 16))).toBe(true);
  });

  it('returns true when ranges are equal', () => {
    expect(rangeContains(r(9, 17), r(9, 17))).toBe(true);
  });

  it('returns false when inner starts before outer', () => {
    expect(rangeContains(r(10, 17), r(9, 16))).toBe(false);
  });

  it('returns false when inner ends after outer', () => {
    expect(rangeContains(r(9, 16), r(10, 17))).toBe(false);
  });

  it('returns false when inner is entirely outside outer', () => {
    expect(rangeContains(r(9, 11), r(12, 14))).toBe(false);
  });
});

// ─── pointInRange ─────────────────────────────────────────────────────────────

describe('pointInRange', () => {
  const range = r(9, 17);

  it('returns true for a point strictly inside', () => {
    expect(pointInRange(new Date(2026, 0, 5, 12), range)).toBe(true);
  });

  it('returns true at exactly range.start (inclusive)', () => {
    expect(pointInRange(range.start, range)).toBe(true);
  });

  it('returns false at exactly range.end (exclusive)', () => {
    expect(pointInRange(range.end, range)).toBe(false);
  });

  it('returns false for a point before range.start', () => {
    expect(pointInRange(new Date(2026, 0, 5, 8), range)).toBe(false);
  });

  it('returns false for a point after range.end', () => {
    expect(pointInRange(new Date(2026, 0, 5, 18), range)).toBe(false);
  });
});

// ─── rangeIntersection ────────────────────────────────────────────────────────

describe('rangeIntersection', () => {
  it('returns the overlapping portion', () => {
    const a = r(9, 12);
    const b = r(10, 14);
    const i = rangeIntersection(a, b);
    expect(i).not.toBeNull();
    expect(i!.start.getHours()).toBe(10);
    expect(i!.end.getHours()).toBe(12);
  });

  it('returns null when ranges do not overlap', () => {
    expect(rangeIntersection(r(9, 10), r(10, 11))).toBeNull();
  });

  it('returns null for disjoint ranges', () => {
    expect(rangeIntersection(r(9, 10), r(12, 14))).toBeNull();
  });

  it('returns the smaller range when one is contained in the other', () => {
    const i = rangeIntersection(r(9, 17), r(11, 13));
    expect(i!.start.getHours()).toBe(11);
    expect(i!.end.getHours()).toBe(13);
  });

  it('returns new Date objects, not the originals', () => {
    const a = r(9, 12);
    const b = r(10, 14);
    const i = rangeIntersection(a, b)!;
    expect(i.start).not.toBe(a.start);
    expect(i.start).not.toBe(b.start);
  });
});

// ─── rangeUnion ───────────────────────────────────────────────────────────────

describe('rangeUnion', () => {
  it('returns the smallest enclosing range for overlapping ranges', () => {
    const u = rangeUnion(r(9, 12), r(10, 15));
    expect(u.start.getHours()).toBe(9);
    expect(u.end.getHours()).toBe(15);
  });

  it('returns the smallest enclosing range for disjoint ranges', () => {
    const u = rangeUnion(r(9, 10), r(14, 17));
    expect(u.start.getHours()).toBe(9);
    expect(u.end.getHours()).toBe(17);
  });

  it('returns the range itself when both sides are equal', () => {
    const a = r(9, 17);
    const u = rangeUnion(a, a);
    expect(u.start.getTime()).toBe(a.start.getTime());
    expect(u.end.getTime()).toBe(a.end.getTime());
  });
});

// ─── expandRangeByDays ────────────────────────────────────────────────────────

describe('expandRangeByDays', () => {
  it('expands both ends by the given number of days', () => {
    const range = rDay(5, 10); // Jan 5 → Jan 10
    const exp   = expandRangeByDays(range, 2);
    expect(exp.start.getDate()).toBe(3); // Jan 3
    expect(exp.end.getDate()).toBe(12);  // Jan 12
  });

  it('expanding by 0 days returns the same times', () => {
    const range = rDay(5, 10);
    const exp   = expandRangeByDays(range, 0);
    expect(exp.start.getTime()).toBe(range.start.getTime());
    expect(exp.end.getTime()).toBe(range.end.getTime());
  });

  it('does not mutate the original range', () => {
    const range = rDay(5, 10);
    const orig = range.start.getDate();
    expandRangeByDays(range, 3);
    expect(range.start.getDate()).toBe(orig);
  });
});

// ─── rangeDurationMs ──────────────────────────────────────────────────────────

describe('rangeDurationMs', () => {
  it('returns the duration in milliseconds', () => {
    const range = r(9, 11); // 2 hours
    expect(rangeDurationMs(range)).toBe(2 * 3_600_000);
  });

  it('returns 0 for a zero-length range', () => {
    const d = new Date(2026, 0, 5, 9);
    expect(rangeDurationMs({ start: d, end: d })).toBe(0);
  });
});

// ─── filterOverlapping ────────────────────────────────────────────────────────

describe('filterOverlapping', () => {
  const events: DateRange[] = [
    r(8,  9),   // before window
    r(9,  11),  // starts at window start
    r(10, 12),  // overlaps window
    r(11, 13),  // overlaps window
    r(13, 15),  // after window
  ];

  it('returns only events that overlap [rangeStart, rangeEnd)', () => {
    const result = filterOverlapping(events, new Date(2026, 0, 5, 9), new Date(2026, 0, 5, 13));
    // r(8,9) ends at 9 = rangeStart, not strictly > → excluded
    // r(9,11) starts at rangeStart → start < rangeEnd (13) ✓ and end > rangeStart (9) ✓ → included
    // r(10,12) → included
    // r(11,13) → included
    // r(13,15) → starts at rangeEnd → not strictly < rangeEnd → excluded
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(events[1]);
    expect(result[1]).toBe(events[2]);
    expect(result[2]).toBe(events[3]);
  });

  it('returns empty array when nothing overlaps', () => {
    const result = filterOverlapping(events, new Date(2026, 0, 5, 20), new Date(2026, 0, 5, 22));
    expect(result).toHaveLength(0);
  });

  it('returns all items when the range covers everything', () => {
    const result = filterOverlapping(events, new Date(2026, 0, 5, 0), new Date(2026, 0, 5, 23));
    expect(result).toHaveLength(events.length);
  });

  it('preserves original object references', () => {
    const result = filterOverlapping(events, new Date(2026, 0, 5, 9), new Date(2026, 0, 5, 13));
    expect(result[0]).toBe(events[1]);
  });

  it('works with an empty input array', () => {
    expect(filterOverlapping([], new Date(), new Date())).toHaveLength(0);
  });
});
