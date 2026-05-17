/**
 * Unit tests for validateConstraints.ts
 *
 * Covers validateDuration and validateBlockedWindow — both are pure functions
 * that return a Violation or null, with no side effects.
 */
import { describe, it, expect } from 'vitest';
import {
  validateDuration,
  validateBlockedWindow,
} from '../validateConstraints.js';
import type { ChangeShape, OperationContext } from '../validationTypes.js';
import { makeEvent } from '../../schema/eventSchema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal ChangeShape for time-only tests. */
function makeChange(
  startISO: string,
  endISO: string,
  overrides: Partial<ChangeShape> = {},
): ChangeShape {
  return {
    newStart: new Date(startISO),
    newEnd: new Date(endISO),
    ...overrides,
  };
}

/** Empty OperationContext (no config, no blocked windows). */
const emptyCtx: OperationContext = {};

// ─── validateDuration ─────────────────────────────────────────────────────────

describe('validateDuration', () => {
  // ── valid durations ──────────────────────────────────────────────────────

  it('returns null for a 1-hour event (valid duration)', () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z');
    expect(validateDuration(change, emptyCtx)).toBeNull();
  });

  it('returns null for exactly the minimum default duration (1 minute)', () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T09:01:00Z');
    expect(validateDuration(change, emptyCtx)).toBeNull();
  });

  it('returns null for a multi-day event', () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-07T09:00:00Z');
    expect(validateDuration(change, emptyCtx)).toBeNull();
  });

  it('returns null for a 30-minute event when minEventDurationMinutes is 30', () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T09:30:00Z');
    const ctx: OperationContext = { config: { minEventDurationMinutes: 30 } };
    expect(validateDuration(change, ctx)).toBeNull();
  });

  it('returns null when duration equals a custom minimum exactly', () => {
    const change = makeChange('2026-01-05T14:00:00Z', '2026-01-05T14:15:00Z');
    const ctx: OperationContext = { config: { minEventDurationMinutes: 15 } };
    expect(validateDuration(change, ctx)).toBeNull();
  });

  // ── invalid-duration: end <= start ──────────────────────────────────────

  it("returns 'invalid-duration' hard violation when end equals start", () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T09:00:00Z');
    const result = validateDuration(change, emptyCtx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('invalid-duration');
    expect(result!.severity).toBe('hard');
  });

  it("returns 'invalid-duration' hard violation when end is before start", () => {
    const change = makeChange('2026-01-05T10:00:00Z', '2026-01-05T09:00:00Z');
    const result = validateDuration(change, emptyCtx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('invalid-duration');
    expect(result!.severity).toBe('hard');
  });

  it("'invalid-duration' message says end must be after start", () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T08:00:00Z');
    const result = validateDuration(change, emptyCtx);
    expect(result!.message).toMatch(/after start/i);
  });

  // ── min-duration: duration too short but positive ────────────────────────

  it("returns 'min-duration' hard violation when event is shorter than 1 minute (default)", () => {
    // 59 seconds — shorter than the 1-minute default
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T09:00:59Z');
    const result = validateDuration(change, emptyCtx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('min-duration');
    expect(result!.severity).toBe('hard');
  });

  it("returns 'min-duration' when event is 29 minutes and minimum is 30", () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T09:29:00Z');
    const ctx: OperationContext = { config: { minEventDurationMinutes: 30 } };
    const result = validateDuration(change, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('min-duration');
    expect(result!.severity).toBe('hard');
  });

  it("'min-duration' message includes the configured minimum minutes", () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T09:00:30Z');
    const ctx: OperationContext = { config: { minEventDurationMinutes: 5 } };
    const result = validateDuration(change, ctx);
    expect(result!.message).toContain('5');
  });

  it("'min-duration' message uses singular 'minute' when minimum is 1", () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T09:00:30Z');
    const result = validateDuration(change, emptyCtx);
    expect(result!.message).toMatch(/1 minute[^s]/);
  });

  it("'min-duration' message uses plural 'minutes' when minimum is > 1", () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T09:00:30Z');
    const ctx: OperationContext = { config: { minEventDurationMinutes: 2 } };
    const result = validateDuration(change, ctx);
    expect(result!.message).toMatch(/2 minutes/);
  });

  it('uses the default minimum of 1 minute when config is absent', () => {
    // 30 seconds is below the default 1-minute minimum
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T09:00:30Z');
    const result = validateDuration(change, {});
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('min-duration');
  });

  it('uses the default minimum when config.minEventDurationMinutes is undefined', () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T09:00:30Z');
    const ctx: OperationContext = { config: {} };
    const result = validateDuration(change, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('min-duration');
  });

  // ── invalid-duration takes priority over min-duration ───────────────────

  it('returns invalid-duration (not min-duration) when end <= start even with large minDuration', () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T08:00:00Z');
    const ctx: OperationContext = { config: { minEventDurationMinutes: 60 } };
    const result = validateDuration(change, ctx);
    expect(result!.rule).toBe('invalid-duration');
  });
});

// ─── validateBlockedWindow ────────────────────────────────────────────────────

describe('validateBlockedWindow', () => {
  // ── no blocked windows ───────────────────────────────────────────────────

  it('returns null when no blockedWindows are in context', () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z');
    expect(validateBlockedWindow(change, emptyCtx)).toBeNull();
  });

  it('returns null when blockedWindows is an empty array', () => {
    const change = makeChange('2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z');
    const ctx: OperationContext = { blockedWindows: [] };
    expect(validateBlockedWindow(change, ctx)).toBeNull();
  });

  // ── non-overlapping windows ──────────────────────────────────────────────

  it('returns null when event is entirely before the blocked window', () => {
    const change = makeChange('2026-01-05T07:00:00Z', '2026-01-05T08:00:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        { start: new Date('2026-01-05T09:00:00Z'), end: new Date('2026-01-05T10:00:00Z') },
      ],
    };
    expect(validateBlockedWindow(change, ctx)).toBeNull();
  });

  it('returns null when event is entirely after the blocked window', () => {
    const change = makeChange('2026-01-05T11:00:00Z', '2026-01-05T12:00:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        { start: new Date('2026-01-05T09:00:00Z'), end: new Date('2026-01-05T10:00:00Z') },
      ],
    };
    expect(validateBlockedWindow(change, ctx)).toBeNull();
  });

  it('returns null when event ends exactly when the blocked window starts (no overlap)', () => {
    const change = makeChange('2026-01-05T08:00:00Z', '2026-01-05T09:00:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        { start: new Date('2026-01-05T09:00:00Z'), end: new Date('2026-01-05T10:00:00Z') },
      ],
    };
    expect(validateBlockedWindow(change, ctx)).toBeNull();
  });

  it('returns null when event starts exactly when the blocked window ends (no overlap)', () => {
    const change = makeChange('2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        { start: new Date('2026-01-05T09:00:00Z'), end: new Date('2026-01-05T10:00:00Z') },
      ],
    };
    expect(validateBlockedWindow(change, ctx)).toBeNull();
  });

  // ── overlapping windows ──────────────────────────────────────────────────

  it("returns 'blocked-window' hard violation when event overlaps the blocked window", () => {
    const change = makeChange('2026-01-05T09:30:00Z', '2026-01-05T10:30:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        { start: new Date('2026-01-05T09:00:00Z'), end: new Date('2026-01-05T10:00:00Z') },
      ],
    };
    const result = validateBlockedWindow(change, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('blocked-window');
    expect(result!.severity).toBe('hard');
  });

  it('detects overlap when event starts before and ends inside the blocked window', () => {
    const change = makeChange('2026-01-05T08:30:00Z', '2026-01-05T09:30:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        { start: new Date('2026-01-05T09:00:00Z'), end: new Date('2026-01-05T10:00:00Z') },
      ],
    };
    expect(validateBlockedWindow(change, ctx)).not.toBeNull();
  });

  it('detects overlap when event is entirely within the blocked window', () => {
    const change = makeChange('2026-01-05T09:15:00Z', '2026-01-05T09:45:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        { start: new Date('2026-01-05T09:00:00Z'), end: new Date('2026-01-05T10:00:00Z') },
      ],
    };
    expect(validateBlockedWindow(change, ctx)).not.toBeNull();
  });

  it('detects overlap when event spans the entire blocked window', () => {
    const change = makeChange('2026-01-05T08:00:00Z', '2026-01-05T11:00:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        { start: new Date('2026-01-05T09:00:00Z'), end: new Date('2026-01-05T10:00:00Z') },
      ],
    };
    expect(validateBlockedWindow(change, ctx)).not.toBeNull();
  });

  // ── message content ──────────────────────────────────────────────────────

  it("uses w.reason in the message when reason is provided", () => {
    const change = makeChange('2026-01-05T09:30:00Z', '2026-01-05T10:30:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        {
          start: new Date('2026-01-05T09:00:00Z'),
          end: new Date('2026-01-05T10:00:00Z'),
          reason: 'Company holiday',
        },
      ],
    };
    const result = validateBlockedWindow(change, ctx);
    expect(result!.message).toContain('Company holiday');
  });

  it("uses resourceId in the message when no reason but resourceId is set on the change", () => {
    const change: ChangeShape = {
      newStart: new Date('2026-01-05T09:30:00Z'),
      newEnd: new Date('2026-01-05T10:30:00Z'),
      resourceId: 'room-101',
    };
    const ctx: OperationContext = {
      blockedWindows: [
        {
          start: new Date('2026-01-05T09:00:00Z'),
          end: new Date('2026-01-05T10:00:00Z'),
        },
      ],
    };
    const result = validateBlockedWindow(change, ctx);
    expect(result!.message).toContain('room-101');
  });

  it("falls back to 'This time slot is blocked.' when no reason and no resourceId", () => {
    const change = makeChange('2026-01-05T09:30:00Z', '2026-01-05T10:30:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        { start: new Date('2026-01-05T09:00:00Z'), end: new Date('2026-01-05T10:00:00Z') },
      ],
    };
    const result = validateBlockedWindow(change, ctx);
    expect(result!.message).toBe('This time slot is blocked.');
  });

  it("reason takes priority over resourceId in the message", () => {
    const change: ChangeShape = {
      newStart: new Date('2026-01-05T09:30:00Z'),
      newEnd: new Date('2026-01-05T10:30:00Z'),
      resourceId: 'room-101',
    };
    const ctx: OperationContext = {
      blockedWindows: [
        {
          start: new Date('2026-01-05T09:00:00Z'),
          end: new Date('2026-01-05T10:00:00Z'),
          reason: 'Maintenance window',
        },
      ],
    };
    const result = validateBlockedWindow(change, ctx);
    expect(result!.message).toContain('Maintenance window');
    expect(result!.message).not.toContain('room-101');
  });

  // ── details payload ──────────────────────────────────────────────────────

  it('includes blockedStart and blockedEnd in the violation details', () => {
    const wStart = new Date('2026-01-05T09:00:00Z');
    const wEnd   = new Date('2026-01-05T10:00:00Z');
    const change = makeChange('2026-01-05T09:30:00Z', '2026-01-05T10:30:00Z');
    const ctx: OperationContext = {
      blockedWindows: [{ start: wStart, end: wEnd }],
    };
    const result = validateBlockedWindow(change, ctx);
    expect(result!.details).toBeDefined();
    expect((result!.details as { blockedStart: Date }).blockedStart).toEqual(wStart);
    expect((result!.details as { blockedEnd: Date }).blockedEnd).toEqual(wEnd);
  });

  // ── resource scoping ─────────────────────────────────────────────────────

  it('returns null when window is scoped to a different resource', () => {
    const change: ChangeShape = {
      newStart: new Date('2026-01-05T09:30:00Z'),
      newEnd: new Date('2026-01-05T10:30:00Z'),
      resourceId: 'room-101',
    };
    const ctx: OperationContext = {
      blockedWindows: [
        {
          start: new Date('2026-01-05T09:00:00Z'),
          end: new Date('2026-01-05T10:00:00Z'),
          resourceId: 'room-202', // different resource
        },
      ],
    };
    expect(validateBlockedWindow(change, ctx)).toBeNull();
  });

  it('applies the window when the resourceId matches the change resourceId', () => {
    const change: ChangeShape = {
      newStart: new Date('2026-01-05T09:30:00Z'),
      newEnd: new Date('2026-01-05T10:30:00Z'),
      resourceId: 'room-101',
    };
    const ctx: OperationContext = {
      blockedWindows: [
        {
          start: new Date('2026-01-05T09:00:00Z'),
          end: new Date('2026-01-05T10:00:00Z'),
          resourceId: 'room-101',
        },
      ],
    };
    const result = validateBlockedWindow(change, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('blocked-window');
  });

  it('applies an unscoped window (no resourceId) to events on any resource', () => {
    const change: ChangeShape = {
      newStart: new Date('2026-01-05T09:30:00Z'),
      newEnd: new Date('2026-01-05T10:30:00Z'),
      resourceId: 'room-999',
    };
    const ctx: OperationContext = {
      blockedWindows: [
        {
          start: new Date('2026-01-05T09:00:00Z'),
          end: new Date('2026-01-05T10:00:00Z'),
          // no resourceId — applies globally
        },
      ],
    };
    expect(validateBlockedWindow(change, ctx)).not.toBeNull();
  });

  it('falls through a mismatched-resource window and applies the matching one', () => {
    const change: ChangeShape = {
      newStart: new Date('2026-01-05T09:30:00Z'),
      newEnd: new Date('2026-01-05T10:30:00Z'),
      resourceId: 'room-101',
    };
    const ctx: OperationContext = {
      blockedWindows: [
        {
          start: new Date('2026-01-05T09:00:00Z'),
          end: new Date('2026-01-05T10:00:00Z'),
          resourceId: 'room-202', // skipped
        },
        {
          start: new Date('2026-01-05T09:00:00Z'),
          end: new Date('2026-01-05T10:00:00Z'),
          resourceId: 'room-101', // matched
        },
      ],
    };
    expect(validateBlockedWindow(change, ctx)).not.toBeNull();
  });

  it('resolves resourceId from event.resourceId when change.resourceId is not set', () => {
    const change: ChangeShape = {
      newStart: new Date('2026-01-05T09:30:00Z'),
      newEnd: new Date('2026-01-05T10:30:00Z'),
      // no direct resourceId on change
      event: makeEvent('evt-1', {
        title: 'Test Event',
        start: new Date('2026-01-05T09:30:00Z'),
        end: new Date('2026-01-05T10:30:00Z'),
        resourceId: 'room-101',
      }),
    };
    const ctx: OperationContext = {
      blockedWindows: [
        {
          start: new Date('2026-01-05T09:00:00Z'),
          end: new Date('2026-01-05T10:00:00Z'),
          resourceId: 'room-101',
        },
      ],
    };
    const result = validateBlockedWindow(change, ctx);
    expect(result).not.toBeNull();
  });

  // ── multiple windows ─────────────────────────────────────────────────────

  it('returns the first violation found when multiple windows overlap', () => {
    const change = makeChange('2026-01-05T09:30:00Z', '2026-01-05T11:30:00Z');
    const ctx: OperationContext = {
      blockedWindows: [
        {
          start: new Date('2026-01-05T09:00:00Z'),
          end: new Date('2026-01-05T10:00:00Z'),
          reason: 'First block',
        },
        {
          start: new Date('2026-01-05T11:00:00Z'),
          end: new Date('2026-01-05T12:00:00Z'),
          reason: 'Second block',
        },
      ],
    };
    const result = validateBlockedWindow(change, ctx);
    // Returns the first matching violation
    expect(result!.message).toContain('First block');
  });
});
