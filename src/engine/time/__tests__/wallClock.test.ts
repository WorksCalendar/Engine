import { describe, it, expect } from 'vitest';
import {
  extractWallClockAnchor,
  applyWallClockAnchor,
  computeOccurrenceEnd,
  eventStartHour,
} from '../wallClock.js';

// ─── extractWallClockAnchor ───────────────────────────────────────────────────

describe('extractWallClockAnchor', () => {
  it('extracts hour/minute/second from a UTC date in UTC timezone', () => {
    const d = new Date('2026-06-15T14:30:45Z');
    const anchor = extractWallClockAnchor(d, 'UTC');
    expect(anchor.hour).toBe(14);
    expect(anchor.minute).toBe(30);
    expect(anchor.second).toBe(45);
    expect(anchor.timezone).toBe('UTC');
  });

  it('adjusts for a non-UTC timezone', () => {
    // CDT = UTC-5 in June; 14:00 UTC = 09:00 CDT
    const d = new Date('2026-06-15T14:00:00Z');
    const anchor = extractWallClockAnchor(d, 'America/Chicago');
    expect(anchor.hour).toBe(9);
    expect(anchor.minute).toBe(0);
    expect(anchor.timezone).toBe('America/Chicago');
  });
});

// ─── applyWallClockAnchor ─────────────────────────────────────────────────────

describe('applyWallClockAnchor', () => {
  it('returns a UTC Date for UTC anchor', () => {
    const anchor = { hour: 9, minute: 30, second: 0, timezone: 'UTC' };
    const result = applyWallClockAnchor(2026, 6, 15, anchor);
    expect(result.getUTCHours()).toBe(9);
    expect(result.getUTCMinutes()).toBe(30);
    expect(result).toBeInstanceOf(Date);
  });

  it('converts a non-UTC wall-clock time to UTC', () => {
    // 9:00 AM in America/Chicago (CDT = UTC-5 in June) = 14:00 UTC
    const anchor = { hour: 9, minute: 0, second: 0, timezone: 'America/Chicago' };
    const result = applyWallClockAnchor(2026, 6, 15, anchor);
    expect(result.getUTCHours()).toBe(14);
  });
});

// ─── computeOccurrenceEnd ─────────────────────────────────────────────────────

describe('computeOccurrenceEnd', () => {
  it('adds durationMs directly when tz is null (floating event)', () => {
    const start = new Date('2026-06-15T09:00:00Z');
    const end = computeOccurrenceEnd(start, 3_600_000, null); // 1h
    expect(end.getTime()).toBe(start.getTime() + 3_600_000);
  });

  it('adds durationMs directly when tz is undefined', () => {
    const start = new Date('2026-06-15T09:00:00Z');
    const end = computeOccurrenceEnd(start, 1_800_000); // 30m
    expect(end.getTime()).toBe(start.getTime() + 1_800_000);
  });

  it('preserves wall-clock duration in a given timezone (UTC)', () => {
    const start = new Date('2026-06-15T09:00:00Z');
    const end = computeOccurrenceEnd(start, 2 * 3_600_000, 'UTC'); // 2h
    // UTC end should be 11:00 UTC
    expect(end.getUTCHours()).toBe(11);
    expect(end.getUTCMinutes()).toBe(0);
  });

  it('returns a Date instance regardless of tz', () => {
    const start = new Date('2026-06-15T09:00:00Z');
    expect(computeOccurrenceEnd(start, 3_600_000)).toBeInstanceOf(Date);
    expect(computeOccurrenceEnd(start, 3_600_000, 'UTC')).toBeInstanceOf(Date);
    expect(computeOccurrenceEnd(start, 3_600_000, null)).toBeInstanceOf(Date);
  });

  it('handles sub-second precision (ms residue)', () => {
    const start = new Date('2026-06-15T09:00:00.500Z');
    const end = computeOccurrenceEnd(start, 3_600_000, 'UTC');
    expect(end.getMilliseconds()).toBe(500);
  });
});

// ─── eventStartHour ───────────────────────────────────────────────────────────

describe('eventStartHour', () => {
  it('uses local getHours/getMinutes when tz is null', () => {
    // Create a date at 9:30 AM in local time
    const d = new Date(2026, 5, 15, 9, 30, 0); // local time
    const result = eventStartHour(d, null);
    expect(result).toBe(9.5); // 9 + 30/60 = 9.5
  });

  it('returns fractional hours in the given timezone', () => {
    // 14:00 UTC = 9:00 CDT (UTC-5 in June)
    const d = new Date('2026-06-15T14:00:00Z');
    const result = eventStartHour(d, 'America/Chicago');
    expect(result).toBe(9); // 9:00 CDT
  });

  it('returns 12.0 for UTC noon', () => {
    const d = new Date('2026-06-15T12:00:00Z');
    expect(eventStartHour(d, 'UTC')).toBe(12);
  });
});
