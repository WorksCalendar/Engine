/**
 * Unit tests for calendarSchema.ts
 *
 * Covers parseHours and defaultWorkingCalendar — pure functions with no side
 * effects.
 */
import { describe, it, expect } from 'vitest';
import {
  parseHours,
  defaultWorkingCalendar,
} from '../calendarSchema.js';
import type { WorkingCalendar } from '../calendarSchema.js';

// ─── parseHours ───────────────────────────────────────────────────────────────

describe('parseHours', () => {
  // ── number passthrough ───────────────────────────────────────────────────

  it('returns the number unchanged when given a whole number (9)', () => {
    expect(parseHours(9)).toBe(9);
  });

  it('returns 0 when given 0', () => {
    expect(parseHours(0)).toBe(0);
  });

  it('returns 17 when given 17', () => {
    expect(parseHours(17)).toBe(17);
  });

  it('returns 24 when given 24', () => {
    expect(parseHours(24)).toBe(24);
  });

  it('returns a fractional number unchanged (8.5)', () => {
    expect(parseHours(8.5)).toBe(8.5);
  });

  it('returns a fractional number unchanged (9.75)', () => {
    expect(parseHours(9.75)).toBe(9.75);
  });

  // ── string parsing: "HH:MM" → decimal hours ─────────────────────────────

  it("parses '09:00' as 9", () => {
    expect(parseHours('09:00')).toBe(9);
  });

  it("parses '09:30' as 9.5", () => {
    expect(parseHours('09:30')).toBe(9.5);
  });

  it("parses '17:00' as 17", () => {
    expect(parseHours('17:00')).toBe(17);
  });

  it("parses '00:00' as 0", () => {
    expect(parseHours('00:00')).toBe(0);
  });

  it("parses '12:00' as 12", () => {
    expect(parseHours('12:00')).toBe(12);
  });

  it("parses '08:30' as 8.5", () => {
    expect(parseHours('08:30')).toBe(8.5);
  });

  it("parses '17:30' as 17.5", () => {
    expect(parseHours('17:30')).toBe(17.5);
  });

  it("parses '9:00' (no leading zero) as 9", () => {
    expect(parseHours('9:00')).toBe(9);
  });

  it("parses '9:30' (no leading zero) as 9.5", () => {
    expect(parseHours('9:30')).toBe(9.5);
  });

  it("parses '0:15' as 0.25", () => {
    expect(parseHours('0:15')).toBe(0.25);
  });

  it("parses '0:45' as 0.75", () => {
    expect(parseHours('0:45')).toBe(0.75);
  });

  it("parses '23:59' correctly", () => {
    // 23 + 59/60 ≈ 23.9833...
    expect(parseHours('23:59')).toBeCloseTo(23 + 59 / 60);
  });

  it("parses '10:00' as 10", () => {
    expect(parseHours('10:00')).toBe(10);
  });

  it("parses '16:30' as 16.5", () => {
    expect(parseHours('16:30')).toBe(16.5);
  });

  it("handles a string with no colon by treating missing minutes as 0", () => {
    // split(':') with no ':' gives ['9'], m defaults to '0'
    expect(parseHours('9')).toBe(9);
  });
});

// ─── defaultWorkingCalendar ───────────────────────────────────────────────────

describe('defaultWorkingCalendar', () => {
  // ── default shape ────────────────────────────────────────────────────────

  it("has id 'default' when called with no arguments", () => {
    expect(defaultWorkingCalendar().id).toBe('default');
  });

  it("has name 'Default'", () => {
    expect(defaultWorkingCalendar().name).toBe('Default');
  });

  it('has timezone null', () => {
    expect(defaultWorkingCalendar().timezone).toBeNull();
  });

  it('has an empty blockedWindows array', () => {
    expect(defaultWorkingCalendar().blockedWindows).toEqual([]);
  });

  it('has businessHours with days [1,2,3,4,5]', () => {
    const cal = defaultWorkingCalendar();
    expect(cal.businessHours).not.toBeNull();
    expect(cal.businessHours!.days).toEqual([1, 2, 3, 4, 5]);
  });

  it('has businessHours.start of 9', () => {
    expect(defaultWorkingCalendar().businessHours!.start).toBe(9);
  });

  it('has businessHours.end of 17', () => {
    expect(defaultWorkingCalendar().businessHours!.end).toBe(17);
  });

  it('matches the exact expected default shape', () => {
    expect(defaultWorkingCalendar()).toMatchObject({
      id: 'default',
      businessHours: {
        days: [1, 2, 3, 4, 5],
        start: 9,
        end: 17,
      },
      blockedWindows: [],
    });
  });

  // ── override application ─────────────────────────────────────────────────

  it('applies a custom id override', () => {
    const cal = defaultWorkingCalendar({ id: 'custom' });
    expect(cal.id).toBe('custom');
  });

  it('applies a timezone override', () => {
    const cal = defaultWorkingCalendar({ timezone: 'UTC' });
    expect(cal.timezone).toBe('UTC');
  });

  it('applies both id and timezone overrides together', () => {
    const cal = defaultWorkingCalendar({ id: 'custom', timezone: 'UTC' });
    expect(cal.id).toBe('custom');
    expect(cal.timezone).toBe('UTC');
  });

  it('overriding id does not change businessHours', () => {
    const cal = defaultWorkingCalendar({ id: 'custom' });
    expect(cal.businessHours).toMatchObject({ days: [1, 2, 3, 4, 5], start: 9, end: 17 });
  });

  it('applies a custom name override', () => {
    const cal = defaultWorkingCalendar({ name: 'My Calendar' });
    expect(cal.name).toBe('My Calendar');
  });

  it('allows overriding businessHours entirely', () => {
    const customBH = { days: [0, 6], start: 8, end: 20 };
    const cal = defaultWorkingCalendar({ businessHours: customBH });
    expect(cal.businessHours).toEqual(customBH);
  });

  it('allows setting businessHours to null', () => {
    const cal = defaultWorkingCalendar({ businessHours: null });
    expect(cal.businessHours).toBeNull();
  });

  it('allows overriding blockedWindows', () => {
    const window = {
      start: new Date('2026-12-25T00:00:00Z'),
      end: new Date('2026-12-26T00:00:00Z'),
      reason: 'Christmas',
    };
    const cal = defaultWorkingCalendar({ blockedWindows: [window] });
    expect(cal.blockedWindows).toHaveLength(1);
    expect(cal.blockedWindows[0]).toEqual(window);
  });

  it('returns a new object each time (not a singleton)', () => {
    const a = defaultWorkingCalendar();
    const b = defaultWorkingCalendar();
    expect(a).not.toBe(b);
  });

  it('does not mutate previously created calendars when a new one is made with overrides', () => {
    const original = defaultWorkingCalendar();
    defaultWorkingCalendar({ id: 'other', timezone: 'America/New_York' });
    // original should be unchanged
    expect(original.id).toBe('default');
    expect(original.timezone).toBeNull();
  });

  it('satisfies the WorkingCalendar interface shape', () => {
    const cal = defaultWorkingCalendar();
    // TypeScript ensures structural correctness at compile time;
    // this runtime check confirms the key fields are present.
    const keys: (keyof WorkingCalendar)[] = [
      'id', 'name', 'timezone', 'businessHours', 'blockedWindows',
    ];
    for (const key of keys) {
      expect(cal).toHaveProperty(key);
    }
  });
});
