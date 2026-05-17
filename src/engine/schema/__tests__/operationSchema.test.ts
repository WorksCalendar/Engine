import { describe, it, expect } from 'vitest';
import { operationChangesTime } from '../operationSchema.js';
import type { EngineOperation } from '../operationSchema.js';

const base = { id: 'ev1' };
const time = { newStart: new Date(2026, 0, 5, 9), newEnd: new Date(2026, 0, 5, 10) };

describe('operationChangesTime', () => {
  it('returns true for move operations', () => {
    const op: EngineOperation = { type: 'move', ...base, ...time };
    expect(operationChangesTime(op)).toBe(true);
  });

  it('returns true for resize operations', () => {
    const op: EngineOperation = { type: 'resize', ...base, ...time };
    expect(operationChangesTime(op)).toBe(true);
  });

  it('returns true for create operations', () => {
    const op: EngineOperation = {
      type: 'create',
      event: { title: 'New', start: new Date(), end: new Date() },
    };
    expect(operationChangesTime(op)).toBe(true);
  });

  it('returns false for update operations', () => {
    const op: EngineOperation = { type: 'update', id: 'ev1', patch: { title: 'X' } };
    expect(operationChangesTime(op)).toBe(false);
  });

  it('returns false for delete operations', () => {
    const op: EngineOperation = { type: 'delete', id: 'ev1' };
    expect(operationChangesTime(op)).toBe(false);
  });

  it('returns false for group-change operations', () => {
    const op: EngineOperation = { type: 'group-change', id: 'ev1', patch: { resourceId: 'r2' } };
    expect(operationChangesTime(op)).toBe(false);
  });
});
