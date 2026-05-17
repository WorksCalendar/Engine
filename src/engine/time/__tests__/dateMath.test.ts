/**
 * Unit tests for src/core/engine/time/dateMath.ts
 *
 * Pure date arithmetic — no React, no side effects.
 */

import { describe, it, expect } from 'vitest';
import {
  clampDate,
  snapToMinutes,
  floorToMinutes,
  durationMs,
  durationMinutes,
  durationHours,
  addMs,
  addMinutes,
  addHoursTo,
  startOfDayLocal,
  endOfDayLocal,
  startOfNextDayLocal,
  isSameDayLocal,
  isBeforeDay,
  isAfterDay,
  hoursDecimal,
  parseHoursString,
} from '../dateMath.js';

// ─── clampDate ────────────────────────────────────────────────────────────────

describe('clampDate', () => {
  const min = new Date(2026, 0, 1);
  const max = new Date(2026, 11, 31);

  it('returns the date unchanged when within bounds', () => {
    const d = new Date(2026, 5, 15);
    expect(clampDate(d, min, max).getTime()).toBe(d.getTime());
  });

  it('clamps to min when below', () => {
    const d = new Date(2025, 0, 1);
    expect(clampDate(d, min, max).getTime()).toBe(min.getTime());
  });

  it('clamps to max when above', () => {
    const d = new Date(2027, 0, 1);
    expect(clampDate(d, min, max).getTime()).toBe(max.getTime());
  });

  it('returns a new Date instance (not the same reference)', () => {
    const d = new Date(2026, 5, 15);
    expect(clampDate(d, min, max)).not.toBe(d);
  });
});

// ─── snapToMinutes ────────────────────────────────────────────────────────────

describe('snapToMinutes', () => {
  it('rounds to nearest 15-min interval (forward)', () => {
    const d = new Date(2026, 0, 5, 9, 8, 0); // 09:08 → rounds to 09:15
    const snapped = snapToMinutes(d, 15);
    expect(snapped.getHours()).toBe(9);
    expect(snapped.getMinutes()).toBe(15);
  });

  it('rounds to nearest 15-min interval (backward)', () => {
    const d = new Date(2026, 0, 5, 9, 7, 0); // 09:07 → rounds to 09:00
    const snapped = snapToMinutes(d, 15);
    expect(snapped.getHours()).toBe(9);
    expect(snapped.getMinutes()).toBe(0);
  });

  it('handles 30-min interval', () => {
    const d = new Date(2026, 0, 5, 9, 16); // 09:16 → rounds to 09:30
    const snapped = snapToMinutes(d, 30);
    expect(snapped.getMinutes()).toBe(30);
  });

  it('already on boundary → returns same time', () => {
    const d = new Date(2026, 0, 5, 9, 0, 0, 0);
    expect(snapToMinutes(d, 15).getTime()).toBe(d.getTime());
  });
});

// ─── floorToMinutes ───────────────────────────────────────────────────────────

describe('floorToMinutes', () => {
  it('floors to the start of the interval', () => {
    const d = new Date(2026, 0, 5, 9, 14, 59); // 09:14:59 → floor to 09:00
    const floored = floorToMinutes(d, 15);
    expect(floored.getHours()).toBe(9);
    expect(floored.getMinutes()).toBe(0);
  });

  it('already on boundary → unchanged', () => {
    const d = new Date(2026, 0, 5, 9, 15, 0, 0);
    expect(floorToMinutes(d, 15).getTime()).toBe(d.getTime());
  });

  it('floors 09:29 to 09:00 with 30-min interval', () => {
    const d = new Date(2026, 0, 5, 9, 29);
    const floored = floorToMinutes(d, 30);
    expect(floored.getMinutes()).toBe(0);
  });
});

// ─── Duration helpers ─────────────────────────────────────────────────────────

describe('durationMs', () => {
  it('returns positive ms for start < end', () => {
    const s = new Date(2026, 0, 5, 9, 0);
    const e = new Date(2026, 0, 5, 10, 30);
    expect(durationMs(s, e)).toBe(90 * 60_000);
  });

  it('returns 0 when start equals end', () => {
    const s = new Date(2026, 0, 5, 9);
    expect(durationMs(s, s)).toBe(0);
  });

  it('returns negative for start > end', () => {
    const s = new Date(2026, 0, 5, 10);
    const e = new Date(2026, 0, 5, 9);
    expect(durationMs(s, e)).toBeLessThan(0);
  });
});

describe('durationMinutes', () => {
  it('returns minutes between two dates', () => {
    const s = new Date(2026, 0, 5, 9);
    const e = new Date(2026, 0, 5, 10, 30);
    expect(durationMinutes(s, e)).toBe(90);
  });
});

describe('durationHours', () => {
  it('returns hours between two dates', () => {
    const s = new Date(2026, 0, 5, 9);
    const e = new Date(2026, 0, 5, 11, 30);
    expect(durationHours(s, e)).toBe(2.5);
  });
});

// ─── Arithmetic helpers ───────────────────────────────────────────────────────

describe('addMs', () => {
  it('adds milliseconds to a date', () => {
    const d    = new Date(2026, 0, 5, 9, 0, 0, 0);
    const next = addMs(d, 5_000);
    expect(next.getSeconds()).toBe(5);
  });

  it('does not mutate the input', () => {
    const d = new Date(2026, 0, 5, 9);
    const orig = d.getTime();
    addMs(d, 1000);
    expect(d.getTime()).toBe(orig);
  });
});

describe('addMinutes', () => {
  it('adds minutes to a date', () => {
    const d    = new Date(2026, 0, 5, 9, 0);
    const next = addMinutes(d, 75);
    expect(next.getHours()).toBe(10);
    expect(next.getMinutes()).toBe(15);
  });
});

describe('addHoursTo', () => {
  it('adds fractional hours to a date', () => {
    const d    = new Date(2026, 0, 5, 9, 0);
    const next = addHoursTo(d, 1.5);
    expect(next.getHours()).toBe(10);
    expect(next.getMinutes()).toBe(30);
  });
});

// ─── Day boundary helpers ─────────────────────────────────────────────────────

describe('startOfDayLocal', () => {
  it('returns midnight on the same day', () => {
    const d    = new Date(2026, 0, 5, 14, 30, 45, 999);
    const sod  = startOfDayLocal(d);
    expect(sod.getHours()).toBe(0);
    expect(sod.getMinutes()).toBe(0);
    expect(sod.getSeconds()).toBe(0);
    expect(sod.getMilliseconds()).toBe(0);
    expect(sod.getDate()).toBe(5);
  });

  it('does not mutate the input', () => {
    const d = new Date(2026, 0, 5, 14, 30);
    const h = d.getHours();
    startOfDayLocal(d);
    expect(d.getHours()).toBe(h);
  });
});

describe('endOfDayLocal', () => {
  it('returns 23:59:59.999 on the same day', () => {
    const d   = new Date(2026, 0, 5, 9);
    const eod = endOfDayLocal(d);
    expect(eod.getHours()).toBe(23);
    expect(eod.getMinutes()).toBe(59);
    expect(eod.getSeconds()).toBe(59);
    expect(eod.getMilliseconds()).toBe(999);
    expect(eod.getDate()).toBe(5);
  });
});

describe('startOfNextDayLocal', () => {
  it('returns midnight on the next day', () => {
    const d    = new Date(2026, 0, 5, 23, 59);
    const next = startOfNextDayLocal(d);
    expect(next.getDate()).toBe(6);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
  });

  it('crosses month boundary correctly', () => {
    const d    = new Date(2026, 0, 31); // Jan 31
    const next = startOfNextDayLocal(d);
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(1);
  });
});

// ─── Comparison helpers ───────────────────────────────────────────────────────

describe('isSameDayLocal', () => {
  it('returns true for two dates on the same calendar day', () => {
    const a = new Date(2026, 0, 5, 9);
    const b = new Date(2026, 0, 5, 23);
    expect(isSameDayLocal(a, b)).toBe(true);
  });

  it('returns false for dates on different days', () => {
    const a = new Date(2026, 0, 5);
    const b = new Date(2026, 0, 6);
    expect(isSameDayLocal(a, b)).toBe(false);
  });

  it('returns false across months', () => {
    const a = new Date(2026, 0, 31);
    const b = new Date(2026, 1, 1);
    expect(isSameDayLocal(a, b)).toBe(false);
  });
});

describe('isBeforeDay', () => {
  it('returns true when a is an earlier calendar day', () => {
    expect(isBeforeDay(new Date(2026, 0, 4), new Date(2026, 0, 5))).toBe(true);
  });

  it('returns false for same day', () => {
    const d = new Date(2026, 0, 5, 9);
    expect(isBeforeDay(d, new Date(2026, 0, 5, 22))).toBe(false);
  });

  it('returns false when a is later', () => {
    expect(isBeforeDay(new Date(2026, 0, 6), new Date(2026, 0, 5))).toBe(false);
  });
});

describe('isAfterDay', () => {
  it('returns true when a is a later calendar day', () => {
    expect(isAfterDay(new Date(2026, 0, 6), new Date(2026, 0, 5))).toBe(true);
  });

  it('returns false for same day', () => {
    const d = new Date(2026, 0, 5, 9);
    expect(isAfterDay(d, new Date(2026, 0, 5, 22))).toBe(false);
  });
});

// ─── Decimal / string helpers ─────────────────────────────────────────────────

describe('hoursDecimal', () => {
  it('returns fractional hours', () => {
    const d = new Date(2026, 0, 5, 9, 30, 0); // 09:30
    expect(hoursDecimal(d)).toBeCloseTo(9.5, 5);
  });

  it('handles midnight (0)', () => {
    const d = new Date(2026, 0, 5, 0, 0, 0);
    expect(hoursDecimal(d)).toBe(0);
  });

  it('handles 23:59', () => {
    const d = new Date(2026, 0, 5, 23, 59, 0);
    expect(hoursDecimal(d)).toBeCloseTo(23 + 59 / 60, 5);
  });
});

describe('parseHoursString', () => {
  it('parses "09:00" to 9', () => {
    expect(parseHoursString('09:00')).toBe(9);
  });

  it('parses "09:30" to 9.5', () => {
    expect(parseHoursString('09:30')).toBeCloseTo(9.5, 5);
  });

  it('parses "17:00" to 17', () => {
    expect(parseHoursString('17:00')).toBe(17);
  });

  it('parses "00:00" to 0', () => {
    expect(parseHoursString('00:00')).toBe(0);
  });

  it('handles "0" (no colon)', () => {
    expect(parseHoursString('0')).toBe(0);
  });
});
