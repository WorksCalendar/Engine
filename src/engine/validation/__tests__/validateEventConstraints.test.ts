import { describe, it, expect } from 'vitest';
import { validateEventConstraints } from '../validateEventConstraints.js';
import type { ChangeShape, OperationContext } from '../validationTypes.js';
import type { EngineEvent } from '../../schema/eventSchema.js';
import type { EventConstraint } from '../../schema/constraintSchema.js';

const start = new Date(2026, 0, 10, 9, 0, 0);
const end   = new Date(2026, 0, 10, 10, 0, 0);
const base: ChangeShape = { newStart: start, newEnd: end };

function makeEvent(id: string, constraints?: EventConstraint[]): EngineEvent {
  return {
    id,
    title: 'Test',
    start,
    end,
    allDay: false,
    constraints,
  } as unknown as EngineEvent;
}

describe('validateEventConstraints', () => {
  it('returns null when no event in change', () => {
    const ctx: OperationContext = {};
    expect(validateEventConstraints({ ...base, event: null }, ctx)).toBeNull();
  });

  it('returns null when event has no constraints', () => {
    const ev = makeEvent('ev1');
    const ctx: OperationContext = { events: [ev] };
    expect(validateEventConstraints({ ...base, event: ev }, ctx)).toBeNull();
  });

  it('returns null when constraints array is empty', () => {
    const ev = makeEvent('ev1', []);
    const ctx: OperationContext = { events: [ev] };
    expect(validateEventConstraints({ ...base, event: ev }, ctx)).toBeNull();
  });

  it('skips asap constraints (scheduling hint only)', () => {
    const ev = makeEvent('ev1', [{ type: 'asap' }]);
    const ctx: OperationContext = { events: [ev] };
    expect(validateEventConstraints({ ...base, event: ev }, ctx)).toBeNull();
  });

  it('skips alap constraints (scheduling hint only)', () => {
    const ev = makeEvent('ev1', [{ type: 'alap' }]);
    const ctx: OperationContext = { events: [ev] };
    expect(validateEventConstraints({ ...base, event: ev }, ctx)).toBeNull();
  });

  it('returns hard violation for must-start-on when start does not match', () => {
    const pinDate = new Date(2026, 0, 11, 9, 0, 0); // different date
    const ev = makeEvent('ev1', [{ type: 'must-start-on', date: pinDate }]);
    const ctx: OperationContext = { events: [ev] };
    const result = validateEventConstraints({ ...base, event: ev }, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('event-constraint');
    expect(result!.severity).toBe('hard');
    expect(result!.message).toMatch(/Event constraint violated/i);
    expect(result!.details?.['constraintType']).toBe('must-start-on');
  });

  it('returns null for must-start-on when start matches exactly', () => {
    const ev = makeEvent('ev1', [{ type: 'must-start-on', date: start }]);
    const ctx: OperationContext = { events: [ev] };
    expect(validateEventConstraints({ ...base, event: ev }, ctx)).toBeNull();
  });

  it('returns soft violation for snet when start is too early', () => {
    const pinDate = new Date(2026, 0, 11, 9, 0, 0); // after start
    const ev = makeEvent('ev1', [{ type: 'snet', date: pinDate }]);
    const ctx: OperationContext = { events: [ev] };
    const result = validateEventConstraints({ ...base, event: ev }, ctx);
    expect(result!.severity).toBe('soft');
    expect(result!.details?.['constraintType']).toBe('snet');
  });

  it('looks up event from ctx.events using event id (canonical)', () => {
    const canonical = makeEvent('ev1', [{ type: 'must-start-on', date: new Date(2026, 0, 11, 9, 0, 0) }]);
    const staleEv   = makeEvent('ev1'); // no constraints
    const ctx: OperationContext = { events: [canonical] };
    // staleEv is passed as change.event but canonical (from ctx.events) has constraints
    const result = validateEventConstraints({ ...base, event: staleEv }, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('event-constraint');
  });

  it('falls back to change.event when event not found in ctx.events', () => {
    const ev = makeEvent('ev99', [{ type: 'must-start-on', date: new Date(2026, 0, 11, 9, 0, 0) }]);
    const ctx: OperationContext = { events: [] };
    const result = validateEventConstraints({ ...base, event: ev }, ctx);
    expect(result).not.toBeNull();
  });

  it('returns first violation when multiple constraints exist', () => {
    const pinDate = new Date(2026, 0, 11, 9, 0, 0);
    const ev = makeEvent('ev1', [
      { type: 'snet', date: pinDate }, // violated
      { type: 'enlt', date: end },     // satisfied
    ]);
    const ctx: OperationContext = { events: [ev] };
    const result = validateEventConstraints({ ...base, event: ev }, ctx);
    expect(result!.details?.['constraintType']).toBe('snet');
  });
});
