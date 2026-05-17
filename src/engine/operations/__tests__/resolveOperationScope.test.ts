import { describe, it, expect } from 'vitest';
import { resolveOperationScope } from '../resolveOperationScope.js';
import { makeEvent } from '../../schema/eventSchema.js';
import type { EngineOperation } from '../../schema/operationSchema.js';

const t = (h: number) => new Date(2026, 0, 5, h, 0, 0);

function makeMaster(rrule: string | null = 'FREQ=WEEKLY;BYDAY=MO') {
  return makeEvent('master-1', {
    title: 'Weekly',
    start: t(9),
    end: t(10),
    seriesId: 'master-1',
    rrule,
  });
}

function makeNonRecurring() {
  return makeEvent('single-1', {
    title: 'Single',
    start: t(9),
    end: t(10),
  });
}

describe('resolveOperationScope', () => {
  // ── Non-recurring event ───────────────────────────────────────────────────

  it('returns needsRecurringResolution:false for non-recurring event', () => {
    const op = { type: 'update', id: 'single-1', patch: { title: 'New' } } as Extract<
      EngineOperation,
      { scope?: unknown }
    >;
    const result = resolveOperationScope(op, makeNonRecurring(), []);
    expect(result.needsRecurringResolution).toBe(false);
    expect(result.changes).toBeUndefined();
  });

  // ── Series scope (default) ────────────────────────────────────────────────

  it('returns needsRecurringResolution:false when scope is "series"', () => {
    const op = {
      type: 'update',
      id: 'master-1',
      patch: { title: 'New Title' },
      scope: 'series',
    } as Extract<EngineOperation, { scope?: unknown }>;
    const result = resolveOperationScope(op, makeMaster(), []);
    expect(result.needsRecurringResolution).toBe(false);
  });

  it('defaults to "series" scope when scope is absent', () => {
    const op = {
      type: 'update',
      id: 'master-1',
      patch: { title: 'New' },
    } as Extract<EngineOperation, { scope?: unknown }>;
    const result = resolveOperationScope(op, makeMaster(), []);
    expect(result.needsRecurringResolution).toBe(false);
  });

  // ── Single scope ──────────────────────────────────────────────────────────

  it('returns needsRecurringResolution:false when scope is "single" but no occurrenceDate', () => {
    const op = {
      type: 'update',
      id: 'master-1',
      patch: { title: 'New' },
      scope: 'single',
    } as Extract<EngineOperation, { scope?: unknown }>;
    const result = resolveOperationScope(op, makeMaster(), []);
    expect(result.needsRecurringResolution).toBe(false);
  });

  it('returns changes when scope is "single" with occurrenceDate', () => {
    const occurrenceDate = new Date(2026, 0, 5, 9, 0, 0); // Monday
    const op = {
      type: 'update',
      id: 'master-1',
      patch: { title: 'Changed' },
      scope: 'single',
      occurrenceDate,
    } as Extract<EngineOperation, { scope?: unknown }>;
    const result = resolveOperationScope(op, makeMaster(), []);
    expect(result.needsRecurringResolution).toBe(true);
    expect(Array.isArray(result.changes)).toBe(true);
    expect(result.changes!.length).toBeGreaterThan(0);
  });

  // ── Following scope ───────────────────────────────────────────────────────

  it('returns needsRecurringResolution:false when scope is "following" but no occurrenceDate', () => {
    const op = {
      type: 'update',
      id: 'master-1',
      patch: { title: 'New' },
      scope: 'following',
    } as Extract<EngineOperation, { scope?: unknown }>;
    const result = resolveOperationScope(op, makeMaster(), []);
    expect(result.needsRecurringResolution).toBe(false);
  });

  it('returns changes when scope is "following" with occurrenceDate', () => {
    const occurrenceDate = new Date(2026, 0, 5, 9, 0, 0);
    const op = {
      type: 'update',
      id: 'master-1',
      patch: { title: 'Changed' },
      scope: 'following',
      occurrenceDate,
    } as Extract<EngineOperation, { scope?: unknown }>;
    const result = resolveOperationScope(op, makeMaster(), []);
    expect(result.needsRecurringResolution).toBe(true);
    expect(Array.isArray(result.changes)).toBe(true);
    expect(result.changes!.length).toBeGreaterThan(0);
  });

  // ── Move op patch ─────────────────────────────────────────────────────────

  it('builds patch from move operation for single scope', () => {
    const occurrenceDate = new Date(2026, 0, 5, 9, 0, 0);
    const op = {
      type: 'move',
      id: 'master-1',
      newStart: t(10),
      newEnd: t(11),
      scope: 'single',
      occurrenceDate,
    } as Extract<EngineOperation, { scope?: unknown }>;
    const result = resolveOperationScope(op, makeMaster(), []);
    expect(result.needsRecurringResolution).toBe(true);
    expect(result.changes!.length).toBeGreaterThan(0);
  });

  // ── Resize op patch ───────────────────────────────────────────────────────

  it('builds patch from resize operation for single scope', () => {
    const occurrenceDate = new Date(2026, 0, 5, 9, 0, 0);
    const op = {
      type: 'resize',
      id: 'master-1',
      newStart: t(9),
      newEnd: t(12),
      scope: 'single',
      occurrenceDate,
    } as Extract<EngineOperation, { scope?: unknown }>;
    const result = resolveOperationScope(op, makeMaster(), []);
    expect(result.needsRecurringResolution).toBe(true);
    expect(result.changes!.length).toBeGreaterThan(0);
  });

  // ── Update with selective patch fields ───────────────────────────────────

  it('builds patch with only defined fields from update operation', () => {
    const occurrenceDate = new Date(2026, 0, 5, 9, 0, 0);
    const op = {
      type: 'update',
      id: 'master-1',
      patch: { title: 'New', category: 'PTO', resourceId: 'r1', color: '#ff0', status: 'tentative' },
      scope: 'single',
      occurrenceDate,
    } as Extract<EngineOperation, { scope?: unknown }>;
    const result = resolveOperationScope(op, makeMaster(), []);
    expect(result.needsRecurringResolution).toBe(true);
  });
});
