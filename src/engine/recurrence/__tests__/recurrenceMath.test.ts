/**
 * Unit tests for recurrenceMath.ts — pure RRULE / duration / exdate helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  parseRRule,
  serializeRRule,
  getRRuleUntil,
  getRRuleCount,
  setRRuleUntil,
  removeRRuleUntil,
  eventDurationMs,
  applyDuration,
  addExdate,
  removeExdate,
  buildOccurrenceId,
  buildOccurrenceDateKey,
} from '../recurrenceMath.js';

// ─── parseRRule ────────────────────────────────────────────────────────────────

describe('parseRRule', () => {
  it('parses a simple FREQ=DAILY rule into a key→value map', () => {
    expect(parseRRule('FREQ=DAILY')).toEqual({ FREQ: 'DAILY' });
  });

  it('parses a multi-part rule', () => {
    expect(parseRRule('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5')).toEqual({
      FREQ:  'WEEKLY',
      BYDAY: 'MO,WE',
      COUNT: '5',
    });
  });

  it('upper-cases keys that arrive in mixed case', () => {
    const result = parseRRule('freq=daily;count=3');
    expect(result['FREQ']).toBe('daily');
    expect(result['COUNT']).toBe('3');
  });

  it('preserves the full value including commas', () => {
    const result = parseRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(result['BYDAY']).toBe('MO,TU,WE,TH,FR');
  });

  it('ignores a part that has no "=" character', () => {
    const result = parseRRule('FREQ=DAILY;ORPHAN;COUNT=2');
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['FREQ']).toBe('DAILY');
    expect(result['COUNT']).toBe('2');
  });

  it('returns an empty object for an empty string', () => {
    expect(parseRRule('')).toEqual({});
  });

  it('handles UNTIL with a full datetime string value', () => {
    const result = parseRRule('FREQ=DAILY;UNTIL=20260115T090000Z');
    expect(result['UNTIL']).toBe('20260115T090000Z');
  });
});

// ─── serializeRRule ───────────────────────────────────────────────────────────

describe('serializeRRule', () => {
  it('serializes a single-entry map', () => {
    expect(serializeRRule({ FREQ: 'DAILY' })).toBe('FREQ=DAILY');
  });

  it('joins multiple entries with ";"', () => {
    const result = serializeRRule({ FREQ: 'WEEKLY', BYDAY: 'MO,WE' });
    expect(result).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('round-trips through parseRRule', () => {
    const original = 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5';
    const parsed = parseRRule(original);
    const reserialized = serializeRRule(parsed);
    // Order may differ — compare the re-parsed result
    expect(parseRRule(reserialized)).toEqual(parseRRule(original));
  });

  it('round-trips a rule with UNTIL', () => {
    const original = 'FREQ=DAILY;UNTIL=20260115T090000Z';
    expect(parseRRule(serializeRRule(parseRRule(original)))).toEqual(
      parseRRule(original),
    );
  });
});

// ─── getRRuleUntil ────────────────────────────────────────────────────────────

describe('getRRuleUntil', () => {
  it('returns null when no UNTIL is present', () => {
    expect(getRRuleUntil('FREQ=DAILY;COUNT=5')).toBeNull();
  });

  it('returns null for an empty rule', () => {
    expect(getRRuleUntil('')).toBeNull();
  });

  it('parses a date-only UNTIL (8 chars: YYYYMMDD) as local Date', () => {
    const result = getRRuleUntil('FREQ=WEEKLY;UNTIL=20260115');
    expect(result).not.toBeNull();
    // The internal parseICSDateStr builds: new Date(2026, 0, 15)
    expect(result!.getFullYear()).toBe(2026);
    expect(result!.getMonth()).toBe(0);   // January
    expect(result!.getDate()).toBe(15);
  });

  it('parses a datetime+Z UNTIL (YYYYMMDDTHHmmssZ) as UTC Date', () => {
    const result = getRRuleUntil('FREQ=DAILY;UNTIL=20260115T090000Z');
    expect(result).not.toBeNull();
    // UTC-interpreted: getUTC* methods should reflect exactly those values
    expect(result!.getUTCFullYear()).toBe(2026);
    expect(result!.getUTCMonth()).toBe(0);
    expect(result!.getUTCDate()).toBe(15);
    expect(result!.getUTCHours()).toBe(9);
    expect(result!.getUTCMinutes()).toBe(0);
    expect(result!.getUTCSeconds()).toBe(0);
  });

  it('parses a datetime+Z UNTIL with non-zero minutes and seconds', () => {
    const result = getRRuleUntil('FREQ=DAILY;UNTIL=20260115T093045Z');
    expect(result).not.toBeNull();
    expect(result!.getUTCHours()).toBe(9);
    expect(result!.getUTCMinutes()).toBe(30);
    expect(result!.getUTCSeconds()).toBe(45);
  });

  it('handles a rule with FREQ, BYDAY, and UNTIL together', () => {
    const result = getRRuleUntil('FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T000000Z');
    expect(result).not.toBeNull();
    expect(result!.getUTCFullYear()).toBe(2026);
    expect(result!.getUTCMonth()).toBe(11); // December
    expect(result!.getUTCDate()).toBe(31);
  });
});

// ─── getRRuleCount ────────────────────────────────────────────────────────────

describe('getRRuleCount', () => {
  it('returns the numeric COUNT when present', () => {
    expect(getRRuleCount('FREQ=DAILY;COUNT=3')).toBe(3);
  });

  it('returns null when COUNT is absent', () => {
    expect(getRRuleCount('FREQ=WEEKLY;BYDAY=MO')).toBeNull();
  });

  it('returns null for an empty rule string', () => {
    expect(getRRuleCount('')).toBeNull();
  });

  it('parses COUNT=1 correctly', () => {
    expect(getRRuleCount('FREQ=DAILY;COUNT=1')).toBe(1);
  });

  it('parses a large COUNT value', () => {
    expect(getRRuleCount('FREQ=DAILY;COUNT=365')).toBe(365);
  });

  it('does not confuse COUNT with UNTIL', () => {
    expect(getRRuleCount('FREQ=DAILY;UNTIL=20261231T000000Z')).toBeNull();
  });
});

// ─── setRRuleUntil ────────────────────────────────────────────────────────────

describe('setRRuleUntil', () => {
  it('adds UNTIL to a rule that has neither UNTIL nor COUNT', () => {
    const until = new Date(Date.UTC(2026, 5, 30, 12, 0, 0));
    const result = setRRuleUntil('FREQ=DAILY', until);
    const parsed = parseRRule(result);
    expect(parsed['UNTIL']).toBeDefined();
    expect(parsed['FREQ']).toBe('DAILY');
  });

  it('removes COUNT when setting UNTIL', () => {
    const until = new Date(Date.UTC(2026, 5, 30, 0, 0, 0));
    const result = setRRuleUntil('FREQ=DAILY;COUNT=10', until);
    const parsed = parseRRule(result);
    expect(parsed['COUNT']).toBeUndefined();
    expect(parsed['UNTIL']).toBeDefined();
  });

  it('replaces an existing UNTIL', () => {
    const newUntil = new Date(Date.UTC(2027, 0, 1, 0, 0, 0));
    const result = setRRuleUntil('FREQ=DAILY;UNTIL=20260101T000000Z', newUntil);
    const parsed = parseRRule(result);
    expect(parsed['UNTIL']).toContain('20270101');
  });

  it('formats UNTIL as UTC datetime string ending in Z', () => {
    const until = new Date(Date.UTC(2026, 11, 31, 23, 59, 59));
    const result = setRRuleUntil('FREQ=WEEKLY', until);
    const parsed = parseRRule(result);
    expect(parsed['UNTIL']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(parsed['UNTIL']).toBe('20261231T235959Z');
  });

  it('the round-trip: setRRuleUntil → getRRuleUntil yields the same UTC ms', () => {
    const until = new Date(Date.UTC(2026, 3, 15, 8, 30, 0));
    const result = setRRuleUntil('FREQ=DAILY', until);
    const recovered = getRRuleUntil(result);
    expect(recovered).not.toBeNull();
    expect(recovered!.getTime()).toBe(until.getTime());
  });

  it('preserves all other RRULE parts unchanged', () => {
    const until = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const result = setRRuleUntil('FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2', until);
    const parsed = parseRRule(result);
    expect(parsed['FREQ']).toBe('WEEKLY');
    expect(parsed['BYDAY']).toBe('MO,WE');
    expect(parsed['INTERVAL']).toBe('2');
  });
});

// ─── removeRRuleUntil ─────────────────────────────────────────────────────────

describe('removeRRuleUntil', () => {
  it('removes UNTIL from the rule', () => {
    const result = removeRRuleUntil('FREQ=DAILY;UNTIL=20260115T090000Z');
    const parsed = parseRRule(result);
    expect(parsed['UNTIL']).toBeUndefined();
  });

  it('is a no-op when UNTIL is not present', () => {
    const result = removeRRuleUntil('FREQ=DAILY;COUNT=5');
    const parsed = parseRRule(result);
    expect(parsed['FREQ']).toBe('DAILY');
    expect(parsed['COUNT']).toBe('5');
  });

  it('preserves remaining keys after removing UNTIL', () => {
    const result = removeRRuleUntil('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T000000Z');
    const parsed = parseRRule(result);
    expect(parsed['FREQ']).toBe('WEEKLY');
    expect(parsed['BYDAY']).toBe('MO');
    expect(parsed['UNTIL']).toBeUndefined();
  });

  it('getRRuleUntil returns null after removeRRuleUntil', () => {
    const modified = removeRRuleUntil('FREQ=DAILY;UNTIL=20261231T000000Z');
    expect(getRRuleUntil(modified)).toBeNull();
  });
});

// ─── eventDurationMs ─────────────────────────────────────────────────────────

describe('eventDurationMs', () => {
  it('returns the difference in milliseconds between end and start', () => {
    const start = new Date('2026-01-01T09:00:00Z');
    const end   = new Date('2026-01-01T10:00:00Z');
    expect(eventDurationMs(start, end)).toBe(60 * 60 * 1000);
  });

  it('returns 0 for a zero-length event (same start and end)', () => {
    const d = new Date('2026-01-01T09:00:00Z');
    expect(eventDurationMs(d, d)).toBe(0);
  });

  it('returns negative when end is before start', () => {
    const start = new Date('2026-01-01T10:00:00Z');
    const end   = new Date('2026-01-01T09:00:00Z');
    expect(eventDurationMs(start, end)).toBeLessThan(0);
  });

  it('handles a multi-day duration correctly', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end   = new Date('2026-01-04T00:00:00Z');
    expect(eventDurationMs(start, end)).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('handles a 30-minute event', () => {
    const start = new Date('2026-06-15T14:00:00Z');
    const end   = new Date('2026-06-15T14:30:00Z');
    expect(eventDurationMs(start, end)).toBe(30 * 60 * 1000);
  });
});

// ─── applyDuration ────────────────────────────────────────────────────────────

describe('applyDuration', () => {
  it('shifts start by the given number of milliseconds', () => {
    const newStart = new Date('2026-01-05T09:00:00Z');
    const durationMs = 60 * 60 * 1000; // 1 hour
    const result = applyDuration(newStart, durationMs);
    expect(result.getTime()).toBe(new Date('2026-01-05T10:00:00Z').getTime());
  });

  it('applying 0 ms returns a Date equal to the start', () => {
    const newStart = new Date('2026-01-05T09:00:00Z');
    const result = applyDuration(newStart, 0);
    expect(result.getTime()).toBe(newStart.getTime());
  });

  it('applying a 30-minute duration', () => {
    const newStart = new Date('2026-03-10T14:00:00Z');
    const result = applyDuration(newStart, 30 * 60 * 1000);
    expect(result.getTime()).toBe(new Date('2026-03-10T14:30:00Z').getTime());
  });

  it('preserves the original start date (returns a new Date)', () => {
    const newStart = new Date('2026-01-05T09:00:00Z');
    const result = applyDuration(newStart, 3600_000);
    expect(result).not.toBe(newStart);
    expect(newStart.getTime()).toBe(new Date('2026-01-05T09:00:00Z').getTime());
  });

  it('round-trips with eventDurationMs', () => {
    const start = new Date('2026-04-01T08:00:00Z');
    const end   = new Date('2026-04-01T09:45:00Z');
    const dur   = eventDurationMs(start, end);
    const newStart = new Date('2026-04-02T08:00:00Z');
    const newEnd   = applyDuration(newStart, dur);
    expect(eventDurationMs(newStart, newEnd)).toBe(dur);
  });
});

// ─── addExdate ────────────────────────────────────────────────────────────────

describe('addExdate', () => {
  it('adds a date to an empty exdates array', () => {
    const date = new Date('2026-01-10T09:00:00Z');
    const result = addExdate([], date);
    expect(result).toHaveLength(1);
  });

  it('adds a new date to a non-empty array', () => {
    const existing = [new Date('2026-01-05T09:00:00Z')];
    const newDate  = new Date('2026-01-10T09:00:00Z');
    const result = addExdate(existing, newDate);
    expect(result).toHaveLength(2);
  });

  it('deduplicates by calendar day: same day, different time → one entry', () => {
    const morning   = new Date(2026, 0, 15, 9, 0, 0);
    const afternoon = new Date(2026, 0, 15, 15, 30, 0);
    const result = addExdate([morning], afternoon);
    expect(result).toHaveLength(1);
    // The new date replaces the old one for that day
    expect(result[0]!.getTime()).toBe(afternoon.getTime());
  });

  it('does not merge dates from different calendar days', () => {
    const day1 = new Date(2026, 0, 15, 9, 0, 0);
    const day2 = new Date(2026, 0, 16, 9, 0, 0);
    const result = addExdate([day1], day2);
    expect(result).toHaveLength(2);
  });

  it('keeps existing entries that are on different days', () => {
    const existing = [
      new Date(2026, 0, 10, 9, 0, 0),
      new Date(2026, 0, 20, 9, 0, 0),
    ];
    const newDate = new Date(2026, 0, 15, 9, 0, 0);
    const result = addExdate(existing, newDate);
    expect(result).toHaveLength(3);
  });

  it('does not mutate the original exdates array', () => {
    const original: Date[] = [new Date(2026, 0, 5, 9, 0, 0)];
    const copy = [...original];
    addExdate(original, new Date(2026, 0, 10, 9, 0, 0));
    expect(original).toEqual(copy);
  });

  it('uses local-time year/month/date for the day key (matching dayKey internals)', () => {
    // Create two dates that share the same local year/month/date but may differ in UTC
    const dateA = new Date(2026, 2, 20, 0, 0, 0);  // local midnight
    const dateB = new Date(2026, 2, 20, 23, 59, 0); // local end of same day
    const result = addExdate([dateA], dateB);
    // Same local day → deduplicated
    expect(result).toHaveLength(1);
  });
});

// ─── removeExdate ─────────────────────────────────────────────────────────────

describe('removeExdate', () => {
  it('removes a date matching the same calendar day', () => {
    const exdates = [new Date(2026, 0, 10, 9, 0, 0)];
    const result = removeExdate(exdates, new Date(2026, 0, 10, 12, 0, 0));
    expect(result).toHaveLength(0);
  });

  it('is a no-op when the day is not in the array', () => {
    const exdates = [new Date(2026, 0, 10, 9, 0, 0)];
    const result = removeExdate(exdates, new Date(2026, 0, 11, 9, 0, 0));
    expect(result).toHaveLength(1);
  });

  it('removes only the matching day and keeps others', () => {
    const exdates = [
      new Date(2026, 0, 10, 9, 0, 0),
      new Date(2026, 0, 15, 9, 0, 0),
      new Date(2026, 0, 20, 9, 0, 0),
    ];
    const result = removeExdate(exdates, new Date(2026, 0, 15, 14, 0, 0));
    expect(result).toHaveLength(2);
    expect(result.some(d => d.getDate() === 15)).toBe(false);
    expect(result.some(d => d.getDate() === 10)).toBe(true);
    expect(result.some(d => d.getDate() === 20)).toBe(true);
  });

  it('does not mutate the original array', () => {
    const original = [new Date(2026, 0, 10, 9, 0, 0)];
    const copy = [...original];
    removeExdate(original, new Date(2026, 0, 10, 9, 0, 0));
    expect(original).toEqual(copy);
  });

  it('handles an empty exdates array', () => {
    const result = removeExdate([], new Date(2026, 0, 10, 9, 0, 0));
    expect(result).toHaveLength(0);
  });
});

// ─── buildOccurrenceId ────────────────────────────────────────────────────────

describe('buildOccurrenceId', () => {
  it('returns the event id itself when idx is 0 (first occurrence)', () => {
    expect(buildOccurrenceId('event-abc', 0)).toBe('event-abc');
  });

  it('appends -r{idx} for idx > 0', () => {
    expect(buildOccurrenceId('event-abc', 1)).toBe('event-abc-r1');
    expect(buildOccurrenceId('event-abc', 2)).toBe('event-abc-r2');
    expect(buildOccurrenceId('event-abc', 99)).toBe('event-abc-r99');
  });

  it('works with numeric-string event ids', () => {
    expect(buildOccurrenceId('42', 0)).toBe('42');
    expect(buildOccurrenceId('42', 3)).toBe('42-r3');
  });

  it('works with uuid-style event ids', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(buildOccurrenceId(id, 0)).toBe(id);
    expect(buildOccurrenceId(id, 5)).toBe(`${id}-r5`);
  });
});

// ─── buildOccurrenceDateKey ───────────────────────────────────────────────────

describe('buildOccurrenceDateKey', () => {
  it('produces a "YYYY-MM-DDTHH:MM" formatted string', () => {
    const start = new Date('2026-01-05T09:00:00.000Z');
    const result = buildOccurrenceDateKey(start);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('is exactly 16 characters long', () => {
    const start = new Date('2026-01-05T09:00:00.000Z');
    expect(buildOccurrenceDateKey(start)).toHaveLength(16);
  });

  it('truncates seconds and milliseconds', () => {
    const start = new Date('2026-01-05T09:00:59.999Z');
    const result = buildOccurrenceDateKey(start);
    // Should end at HH:MM, not HH:MM:SS
    expect(result).toBe('2026-01-05T09:00');
  });

  it('preserves the UTC date and time from the Date object', () => {
    const start = new Date('2026-06-15T14:30:00.000Z');
    expect(buildOccurrenceDateKey(start)).toBe('2026-06-15T14:30');
  });

  it('handles midnight correctly', () => {
    const start = new Date('2026-12-31T00:00:00.000Z');
    expect(buildOccurrenceDateKey(start)).toBe('2026-12-31T00:00');
  });
});
