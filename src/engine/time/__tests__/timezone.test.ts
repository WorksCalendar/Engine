import { describe, it, expect } from 'vitest';
import {
  localTimezone,
  isValidTimezone,
  partsInTimezone,
  utcOffsetMinutes,
  wallClockToUtc,
  hoursInTimezone,
  convertEventToDisplayZone,
} from '../timezone.js';

// ─── localTimezone ────────────────────────────────────────────────────────────

describe('localTimezone', () => {
  it('returns a non-empty string', () => {
    expect(typeof localTimezone()).toBe('string');
    expect(localTimezone().length).toBeGreaterThan(0);
  });
});

// ─── isValidTimezone ──────────────────────────────────────────────────────────

describe('isValidTimezone', () => {
  it('returns true for "UTC"', () => {
    expect(isValidTimezone('UTC')).toBe(true);
  });

  it('returns true for a real IANA zone', () => {
    expect(isValidTimezone('America/Chicago')).toBe(true);
  });

  it('returns false for an invalid zone', () => {
    expect(isValidTimezone('Not/A/Zone')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidTimezone('')).toBe(false);
  });
});

// ─── partsInTimezone ──────────────────────────────────────────────────────────

describe('partsInTimezone', () => {
  const utcNoon = new Date('2026-06-15T12:00:00Z');

  it('returns numeric parts for UTC', () => {
    const p = partsInTimezone(utcNoon, 'UTC');
    expect(p.year).toBe(2026);
    expect(p.month).toBe(6);
    expect(p.day).toBe(15);
    expect(p.hour).toBe(12);
    expect(p.minute).toBe(0);
    expect(p.second).toBe(0);
  });

  it('adjusts hour for a westward timezone', () => {
    // America/Chicago is UTC-5 (CDT) in June
    const p = partsInTimezone(utcNoon, 'America/Chicago');
    expect(p.hour).toBe(7); // 12 - 5 = 7 CDT
  });

  it('adjusts date when crossing midnight', () => {
    // UTC 01:00 = previous day in America/Los_Angeles (UTC-7/PDT in summer)
    const earlyUtc = new Date('2026-06-15T01:00:00Z');
    const p = partsInTimezone(earlyUtc, 'America/Los_Angeles');
    expect(p.day).toBe(14); // crosses to previous day
  });
});

// ─── utcOffsetMinutes ─────────────────────────────────────────────────────────

describe('utcOffsetMinutes', () => {
  it('returns 0 for UTC', () => {
    const d = new Date('2026-01-15T12:00:00Z');
    expect(utcOffsetMinutes(d, 'UTC')).toBe(0);
  });

  it('returns negative minutes for a westward zone', () => {
    // America/New_York in January is UTC-5 (EST)
    const d = new Date('2026-01-15T12:00:00Z');
    expect(utcOffsetMinutes(d, 'America/New_York')).toBe(-300); // -5h
  });

  it('returns positive minutes for an eastward zone', () => {
    // Asia/Kolkata is UTC+5:30
    const d = new Date('2026-01-15T12:00:00Z');
    expect(utcOffsetMinutes(d, 'Asia/Kolkata')).toBe(330); // +5h30m
  });
});

// ─── wallClockToUtc ───────────────────────────────────────────────────────────

describe('wallClockToUtc', () => {
  it('converts a UTC wall clock time correctly', () => {
    const result = wallClockToUtc(2026, 6, 15, 12, 0, 0, 'UTC');
    expect(result.toISOString()).toBe('2026-06-15T12:00:00.000Z');
  });

  it('converts a wall clock time in America/Chicago', () => {
    // CDT = UTC-5 in June
    const result = wallClockToUtc(2026, 6, 15, 9, 0, 0, 'America/Chicago');
    // 9:00 CDT = 14:00 UTC
    expect(result.getUTCHours()).toBe(14);
  });

  it('round-trips through partsInTimezone', () => {
    const tz = 'America/New_York';
    const result = wallClockToUtc(2026, 3, 10, 8, 30, 0, tz);
    const parts = partsInTimezone(result, tz);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(3);
    expect(parts.day).toBe(10);
    expect(parts.hour).toBe(8);
    expect(parts.minute).toBe(30);
    expect(parts.second).toBe(0);
  });

  it('returns a Date instance', () => {
    const result = wallClockToUtc(2026, 1, 1, 0, 0, 0, 'UTC');
    expect(result).toBeInstanceOf(Date);
  });
});

// ─── hoursInTimezone ──────────────────────────────────────────────────────────

describe('hoursInTimezone', () => {
  it('returns 12.0 for UTC noon in UTC', () => {
    const d = new Date('2026-06-15T12:00:00Z');
    expect(hoursInTimezone(d, 'UTC')).toBe(12);
  });

  it('returns 12.5 for 12:30 UTC in UTC', () => {
    const d = new Date('2026-06-15T12:30:00Z');
    expect(hoursInTimezone(d, 'UTC')).toBeCloseTo(12.5, 5);
  });

  it('returns offset-adjusted hour for a non-UTC zone', () => {
    // CDT = UTC-5 in June, so 12:00 UTC = 7:00 CDT
    const d = new Date('2026-06-15T12:00:00Z');
    expect(hoursInTimezone(d, 'America/Chicago')).toBe(7);
  });
});

// ─── convertEventToDisplayZone ────────────────────────────────────────────────

describe('convertEventToDisplayZone', () => {
  const s = new Date('2026-06-15T09:00:00Z');
  const e = new Date('2026-06-15T10:00:00Z');

  it('returns start/end unchanged when eventTz is null (floating)', () => {
    const result = convertEventToDisplayZone(s, e, null, 'America/Chicago');
    expect(result.start).toBe(s);
    expect(result.end).toBe(e);
  });

  it('returns start/end unchanged when displayTz is null', () => {
    const result = convertEventToDisplayZone(s, e, 'America/Chicago', null);
    expect(result.start).toBe(s);
    expect(result.end).toBe(e);
  });

  it('returns start/end unchanged when eventTz equals displayTz', () => {
    const result = convertEventToDisplayZone(s, e, 'America/Chicago', 'America/Chicago');
    expect(result.start).toBe(s);
    expect(result.end).toBe(e);
  });

  it('returns same Date objects even when zones differ (JS Date is always UTC)', () => {
    const result = convertEventToDisplayZone(s, e, 'America/Chicago', 'America/New_York');
    expect(result.start).toBe(s);
    expect(result.end).toBe(e);
  });
});
