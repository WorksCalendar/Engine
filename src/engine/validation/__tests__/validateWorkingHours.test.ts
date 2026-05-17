/**
 * Unit tests for validateWorkingHours.ts
 *
 * Covers all branches of validateWorkingHours — a pure function that returns
 * a soft Violation or null, with no side effects.
 */
import { describe, it, expect } from 'vitest';
import { validateWorkingHours } from '../validateWorkingHours.js';
import type { ChangeShape, OperationContext } from '../validationTypes.js';
import { makeEvent } from '../../schema/eventSchema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Default business hours: Mon-Fri, 09:00–17:00. */
const defaultBH: NonNullable<OperationContext['businessHours']> = {
  days: [1, 2, 3, 4, 5],
  start: 9,
  end: 17,
};

/** Build an OperationContext with the given businessHours. */
function ctxWith(
  bh: OperationContext['businessHours'],
  extra: Partial<OperationContext> = {},
): OperationContext {
  const ctx: OperationContext = { ...extra };
  // Assign via index access to satisfy exactOptionalPropertyTypes
  (ctx as Record<string, unknown>)['businessHours'] = bh;
  return ctx;
}

/**
 * Build a ChangeShape for a timed event on a given ISO date range.
 * The dates MUST be local-time aware for the day-of-week check.
 */
function makeChange(
  start: Date,
  end: Date,
  overrides: Partial<ChangeShape> = {},
): ChangeShape {
  return { newStart: start, newEnd: end, ...overrides };
}

// Monday 2026-01-05, local times
const MON_09_00 = new Date(2026, 0, 5, 9, 0, 0);   // Mon 09:00
const MON_10_00 = new Date(2026, 0, 5, 10, 0, 0);  // Mon 10:00
const MON_17_00 = new Date(2026, 0, 5, 17, 0, 0);  // Mon 17:00
const MON_08_00 = new Date(2026, 0, 5, 8, 0, 0);   // Mon 08:00
const MON_17_30 = new Date(2026, 0, 5, 17, 30, 0); // Mon 17:30

// Saturday 2026-01-10
const SAT_10_00 = new Date(2026, 0, 10, 10, 0, 0); // Sat 10:00
const SAT_11_00 = new Date(2026, 0, 10, 11, 0, 0); // Sat 11:00

// Sunday 2026-01-11
const SUN_10_00 = new Date(2026, 0, 11, 10, 0, 0); // Sun 10:00
const SUN_11_00 = new Date(2026, 0, 11, 11, 0, 0); // Sun 11:00

// ─── No businessHours in context ─────────────────────────────────────────────

describe('validateWorkingHours — no businessHours', () => {
  it('returns null when ctx has no businessHours', () => {
    const change = makeChange(MON_09_00, MON_10_00);
    expect(validateWorkingHours(change, {})).toBeNull();
  });

  it('returns null when ctx.businessHours is null', () => {
    const change = makeChange(MON_09_00, MON_10_00);
    expect(validateWorkingHours(change, ctxWith(null))).toBeNull();
  });
});

// ─── All-day events ───────────────────────────────────────────────────────────

describe('validateWorkingHours — all-day events', () => {
  it('returns null for an all-day event (change.event.allDay === true)', () => {
    const allDayEvent = makeEvent('evt-allday', {
      title: 'Holiday',
      start: new Date(2026, 0, 10),
      end: new Date(2026, 0, 11),
      allDay: true,
    });
    const change: ChangeShape = {
      newStart: SAT_10_00,
      newEnd: SAT_11_00,
      event: allDayEvent,
    };
    expect(validateWorkingHours(change, ctxWith(defaultBH))).toBeNull();
  });

  it('does not skip when event is present but allDay is false', () => {
    const timedEvent = makeEvent('evt-timed', {
      title: 'Meeting',
      start: SAT_10_00,
      end: SAT_11_00,
      allDay: false,
    });
    const change: ChangeShape = {
      newStart: SAT_10_00,
      newEnd: SAT_11_00,
      event: timedEvent,
    };
    // Saturday is outside default business days → should produce a violation
    expect(validateWorkingHours(change, ctxWith(defaultBH))).not.toBeNull();
  });
});

// ─── Multi-day events (≥ 24 hours) ───────────────────────────────────────────

describe('validateWorkingHours — multi-day events skipped', () => {
  it('returns null for an event spanning exactly 24 hours', () => {
    const start = MON_09_00;
    const end   = new Date(2026, 0, 6, 9, 0, 0); // Tue 09:00 — exactly 24h later
    expect(validateWorkingHours(makeChange(start, end), ctxWith(defaultBH))).toBeNull();
  });

  it('returns null for a 2-day event', () => {
    const start = MON_09_00;
    const end   = new Date(2026, 0, 7, 9, 0, 0); // Wed 09:00 — 48h later
    expect(validateWorkingHours(makeChange(start, end), ctxWith(defaultBH))).toBeNull();
  });

  it('does NOT skip an event of 23h 59m (just below the 24h threshold)', () => {
    const start = MON_09_00;
    const end   = new Date(2026, 0, 6, 8, 59, 0); // just under 24h
    // Mon is a valid day and 09:00–08:59 is within hours... but actually
    // evEndHCmp would be 8.983... < bizEnd 17, evStartH 9 >= bizStart 9 → null
    // The key thing here is that the skip is NOT triggered (< 24h)
    // Mon 09:00 → Tue 08:59 — valid hours and valid day for MON start
    expect(validateWorkingHours(makeChange(start, end), ctxWith(defaultBH))).toBeNull();
  });

  it('does NOT skip an event that is exactly 23h 59m even if on a bad day', () => {
    // Saturday start — would normally be a violation, but we verify the
    // 24h guard is NOT triggered so the day check fires
    const start = SAT_10_00;
    const end   = new Date(2026, 0, 11, 9, 59, 0); // ~23h59m later
    const result = validateWorkingHours(makeChange(start, end), ctxWith(defaultBH));
    // Saturday (6) is not in [1,2,3,4,5] → violation expected
    expect(result).not.toBeNull();
  });
});

// ─── Day-of-week check ────────────────────────────────────────────────────────

describe('validateWorkingHours — day-of-week', () => {
  it("returns soft 'outside-business-hours' when event starts on Saturday", () => {
    const result = validateWorkingHours(makeChange(SAT_10_00, SAT_11_00), ctxWith(defaultBH));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
    expect(result!.severity).toBe('soft');
  });

  it("returns soft 'outside-business-hours' when event starts on Sunday", () => {
    const result = validateWorkingHours(makeChange(SUN_10_00, SUN_11_00), ctxWith(defaultBH));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
    expect(result!.severity).toBe('soft');
  });

  it('returns null when event starts on a valid weekday (Monday)', () => {
    const result = validateWorkingHours(makeChange(MON_09_00, MON_10_00), ctxWith(defaultBH));
    expect(result).toBeNull();
  });

  it('returns null for each weekday in the custom days list', () => {
    // Custom: only Mon (1) and Wed (3) are working days
    const bh = { days: [1, 3], start: 9, end: 17 };
    // Monday — valid
    expect(validateWorkingHours(makeChange(MON_09_00, MON_10_00), ctxWith(bh))).toBeNull();
    // Wednesday 2026-01-07
    const wed = new Date(2026, 0, 7, 9, 0, 0);
    const wedEnd = new Date(2026, 0, 7, 10, 0, 0);
    expect(validateWorkingHours(makeChange(wed, wedEnd), ctxWith(bh))).toBeNull();
  });

  it("returns violation on Tuesday when only Mon/Wed are working days", () => {
    const bh = { days: [1, 3], start: 9, end: 17 };
    const tue = new Date(2026, 0, 6, 9, 0, 0);
    const tueEnd = new Date(2026, 0, 6, 10, 0, 0);
    const result = validateWorkingHours(makeChange(tue, tueEnd), ctxWith(bh));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
  });

  it("violation message says 'outside business hours' for a bad day", () => {
    const result = validateWorkingHours(makeChange(SAT_10_00, SAT_11_00), ctxWith(defaultBH));
    expect(result!.message).toMatch(/outside business hours/i);
  });

  it('treats Sunday (day index 0) correctly when included in bizDays', () => {
    const bh = { days: [0, 6], start: 9, end: 17 }; // only Sun & Sat
    // Sunday should be valid
    expect(validateWorkingHours(makeChange(SUN_10_00, SUN_11_00), ctxWith(bh))).toBeNull();
    // Monday (day 1) is NOT in the list → violation
    const result = validateWorkingHours(makeChange(MON_09_00, MON_10_00), ctxWith(bh));
    expect(result).not.toBeNull();
  });
});

// ─── Time-of-day check ────────────────────────────────────────────────────────

describe('validateWorkingHours — time-of-day', () => {
  it('returns null for an event exactly fitting within business hours (09:00–17:00)', () => {
    expect(validateWorkingHours(makeChange(MON_09_00, MON_17_00), ctxWith(defaultBH))).toBeNull();
  });

  it('returns null for an event strictly inside business hours (10:00–15:00)', () => {
    const s = new Date(2026, 0, 5, 10, 0, 0);
    const e = new Date(2026, 0, 5, 15, 0, 0);
    expect(validateWorkingHours(makeChange(s, e), ctxWith(defaultBH))).toBeNull();
  });

  it("returns soft violation when event starts before bizStart (08:00 < 09:00)", () => {
    const result = validateWorkingHours(makeChange(MON_08_00, MON_10_00), ctxWith(defaultBH));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
    expect(result!.severity).toBe('soft');
  });

  it("returns soft violation when event ends after bizEnd (17:30 > 17:00)", () => {
    const result = validateWorkingHours(makeChange(MON_09_00, MON_17_30), ctxWith(defaultBH));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
    expect(result!.severity).toBe('soft');
  });

  it("returns violation when event starts exactly at bizStart but ends after bizEnd", () => {
    const result = validateWorkingHours(makeChange(MON_09_00, MON_17_30), ctxWith(defaultBH));
    expect(result).not.toBeNull();
  });

  it("returns violation when event starts before bizStart even with valid end", () => {
    const result = validateWorkingHours(makeChange(MON_08_00, MON_17_00), ctxWith(defaultBH));
    expect(result).not.toBeNull();
  });

  it('handles a 30-minute event starting at 08:30 (before 09:00)', () => {
    const s = new Date(2026, 0, 5, 8, 30, 0);
    const e = new Date(2026, 0, 5, 9, 0, 0);
    const result = validateWorkingHours(makeChange(s, e), ctxWith(defaultBH));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
  });

  it("time violation message says 'outside business hours'", () => {
    const result = validateWorkingHours(makeChange(MON_08_00, MON_10_00), ctxWith(defaultBH));
    expect(result!.message).toMatch(/outside business hours/i);
  });
});

// ─── Midnight-end special case ────────────────────────────────────────────────

describe('validateWorkingHours — midnight end treated as 24', () => {
  it('treats an end of 00:00 as 24h (past bizEnd of 17:00) → violation', () => {
    // An event from 09:00 to midnight (00:00 next day) — but NOT ≥ 24h since
    // it's only 15 hours. evEndHCmp = 24 because getHours() === 0.
    const s = new Date(2026, 0, 5, 9, 0, 0);
    const e = new Date(2026, 0, 6, 0, 0, 0); // midnight — next day 00:00
    // Duration = 15h, less than 24h, so not skipped
    const result = validateWorkingHours(makeChange(s, e), ctxWith(defaultBH));
    // evEndHCmp = 24 > bizEnd 17 → violation
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
  });

  it('does not trigger for a bizEnd of 24 when event ends at midnight (00:00)', () => {
    const bh = { days: [1, 2, 3, 4, 5], start: 0, end: 24 };
    const s = new Date(2026, 0, 5, 0, 0, 0);
    const e = new Date(2026, 0, 6, 0, 0, 0); // midnight end — 24h later — SKIPPED (≥ 24h)
    // This hits the 24h skip guard first
    expect(validateWorkingHours(makeChange(s, e), ctxWith(bh))).toBeNull();
  });

  it('midnight end on a 23-hour event triggers the end-check against bizEnd 22', () => {
    // Event: 01:00 → next-day 00:00 = 23h (not skipped), evEndHCmp = 24 > 22
    const bh = { days: [1, 2, 3, 4, 5], start: 0, end: 22 };
    const s = new Date(2026, 0, 5, 1, 0, 0);
    const e = new Date(2026, 0, 6, 0, 0, 0);
    const result = validateWorkingHours(makeChange(s, e), ctxWith(bh));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
  });

  it('a non-midnight end that is exactly at bizEnd does not trigger a violation', () => {
    // Event ends at 17:00 exactly — evEndHCmp = 17, not > 17
    const result = validateWorkingHours(makeChange(MON_09_00, MON_17_00), ctxWith(defaultBH));
    expect(result).toBeNull();
  });
});

// ─── String bizStart / bizEnd (parseHoursString path) ────────────────────────

describe('validateWorkingHours — string hours format', () => {
  it("accepts '09:00' as bizStart string, event at 09:00 is valid", () => {
    // OperationContext.businessHours uses number types, but the actual
    // validateWorkingHours reads ctx.businessHours which has numeric start/end.
    // The string path (parseHoursString) is in the function itself for the bh.start/end.
    // We cast to any to simulate string values being passed (matching the runtime reality).
    const bh = { days: [1, 2, 3, 4, 5], start: '09:00' as unknown as number, end: '17:00' as unknown as number };
    const result = validateWorkingHours(makeChange(MON_09_00, MON_17_00), ctxWith(bh));
    expect(result).toBeNull();
  });

  it("accepts '09:30' as bizStart, event at 09:00 is before → violation", () => {
    const bh = { days: [1, 2, 3, 4, 5], start: '09:30' as unknown as number, end: '17:00' as unknown as number };
    const result = validateWorkingHours(makeChange(MON_09_00, MON_17_00), ctxWith(bh));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
  });

  it("accepts '09:00' – '17:30' strings, event ending at 17:00 is valid", () => {
    const bh = { days: [1, 2, 3, 4, 5], start: '09:00' as unknown as number, end: '17:30' as unknown as number };
    const result = validateWorkingHours(makeChange(MON_09_00, MON_17_00), ctxWith(bh));
    expect(result).toBeNull();
  });

  it("accepts '09:00' – '17:00' strings, event ending at 17:30 is violation", () => {
    const bh = { days: [1, 2, 3, 4, 5], start: '09:00' as unknown as number, end: '17:00' as unknown as number };
    const result = validateWorkingHours(makeChange(MON_09_00, MON_17_30), ctxWith(bh));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
  });

  it("parses '08:30' as 8.5 decimal hours for bizStart comparison", () => {
    const bh = { days: [1, 2, 3, 4, 5], start: '08:30' as unknown as number, end: '17:00' as unknown as number };
    // MON_08_00 = 8.0 < 8.5 → violation
    const result = validateWorkingHours(makeChange(MON_08_00, MON_10_00), ctxWith(bh));
    expect(result).not.toBeNull();
    // 8.0 < 8.5 → violation
    expect(result!.rule).toBe('outside-business-hours');
  });

  it("accepts '08:00' as bizStart, event at 08:00 is valid", () => {
    const bh = { days: [1, 2, 3, 4, 5], start: '08:00' as unknown as number, end: '17:00' as unknown as number };
    const result = validateWorkingHours(makeChange(MON_08_00, MON_10_00), ctxWith(bh));
    expect(result).toBeNull();
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('validateWorkingHours — edge cases', () => {
  it('returns null when no event is on the change (event field absent)', () => {
    // Without an event, allDay check is skipped; time check still runs
    const change: ChangeShape = { newStart: MON_09_00, newEnd: MON_10_00 };
    expect(validateWorkingHours(change, ctxWith(defaultBH))).toBeNull();
  });

  it('returns null when change.event is null', () => {
    const change: ChangeShape = { newStart: MON_09_00, newEnd: MON_10_00, event: null };
    expect(validateWorkingHours(change, ctxWith(defaultBH))).toBeNull();
  });

  it('uses default days [1,2,3,4,5] when bh.days is not provided', () => {
    // Cast to bypass readonly constraint — simulates a loose partial config
    const bh = { days: undefined as unknown as readonly number[], start: 9, end: 17 };
    const ctx: OperationContext = { businessHours: bh };
    // Saturday (6) should fail with the fallback [1,2,3,4,5]
    const result = validateWorkingHours(makeChange(SAT_10_00, SAT_11_00), ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('outside-business-hours');
  });

  it('handles fractional bizStart (9.5 = 09:30) correctly', () => {
    const bh = { days: [1, 2, 3, 4, 5], start: 9.5, end: 17 };
    // Event from 09:00 — before 09:30 → violation
    const result = validateWorkingHours(makeChange(MON_09_00, MON_10_00), ctxWith(bh));
    expect(result).not.toBeNull();
    // Event from 09:30 — exactly at start → valid
    const s = new Date(2026, 0, 5, 9, 30, 0);
    const e = new Date(2026, 0, 5, 10, 0, 0);
    expect(validateWorkingHours(makeChange(s, e), ctxWith(bh))).toBeNull();
  });
});
