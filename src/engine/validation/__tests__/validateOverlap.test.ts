import { describe, it, expect } from 'vitest';
import { validateOverlap } from '../validateOverlap.js';
import type { ChangeShape, OperationContext } from '../validationTypes.js';
import type { EngineEvent } from '../../schema/eventSchema.js';
import type { Assignment } from '../../schema/assignmentSchema.js';

const t = (h: number) => new Date(2026, 0, 5, h, 0, 0);

function makeEv(id: string, start: Date, end: Date, resourceId: string | null = 'r1'): EngineEvent {
  return { id, title: id, start, end, allDay: false, resourceId } as unknown as EngineEvent;
}

// Base change: a 9–10 block for resource r1 (different event)
const baseChange: ChangeShape = {
  newStart:   t(9),
  newEnd:     t(10),
  event:      makeEv('new', t(9), t(10), 'r1'),
  resourceId: 'r1',
};

describe('validateOverlap', () => {
  it('returns null when conflictPolicy is "allow"', () => {
    const ctx: OperationContext = {
      config: { conflictPolicy: 'allow' },
      events: [makeEv('existing', t(9), t(10), 'r1')],
    };
    expect(validateOverlap(baseChange, ctx)).toBeNull();
  });

  it('returns null when event has no resourceId (unscoped)', () => {
    const change: ChangeShape = { newStart: t(9), newEnd: t(10) }; // no event, no resourceId
    const ctx: OperationContext = { events: [makeEv('existing', t(9), t(10), 'r1')] };
    expect(validateOverlap(change, ctx)).toBeNull();
  });

  it('returns null when no events overlap', () => {
    const ctx: OperationContext = { events: [makeEv('existing', t(11), t(12), 'r1')] };
    expect(validateOverlap(baseChange, ctx)).toBeNull();
  });

  it('returns null when adjacent (touching) events do not overlap', () => {
    // existing ends at 9, new starts at 9 — half-open, no overlap
    const ctx: OperationContext = { events: [makeEv('existing', t(8), t(9), 'r1')] };
    expect(validateOverlap(baseChange, ctx)).toBeNull();
  });

  it('returns soft violation by default when overlap detected', () => {
    const ctx: OperationContext = { events: [makeEv('existing', t(8), t(10), 'r1')] };
    const result = validateOverlap(baseChange, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('overlap');
    expect(result!.severity).toBe('soft');
    expect(result!.conflictingEventId).toBe('existing');
  });

  it('returns hard violation when conflictPolicy is "block"', () => {
    const ctx: OperationContext = {
      config: { conflictPolicy: 'block' },
      events: [makeEv('existing', t(8), t(10), 'r1')],
    };
    const result = validateOverlap(baseChange, ctx);
    expect(result!.severity).toBe('hard');
  });

  it('skips self when checking overlaps (event id matches)', () => {
    const self = makeEv('self', t(9), t(10), 'r1');
    const change: ChangeShape = { newStart: t(9), newEnd: t(10), event: self, resourceId: 'r1' };
    const ctx: OperationContext = { events: [self] };
    expect(validateOverlap(change, ctx)).toBeNull();
  });

  it('skips all-day events (they do not block time slots)', () => {
    const allDay = { ...makeEv('all', t(9), t(10), 'r1'), allDay: true } as unknown as EngineEvent;
    const ctx: OperationContext = { events: [allDay] };
    expect(validateOverlap(baseChange, ctx)).toBeNull();
  });

  it('skips events with different resourceId', () => {
    const ctx: OperationContext = { events: [makeEv('other', t(9), t(10), 'r2')] };
    expect(validateOverlap(baseChange, ctx)).toBeNull();
  });

  it('uses resourceId from change.resourceId when event.resourceId is absent', () => {
    const noEvChange: ChangeShape = { newStart: t(9), newEnd: t(10), resourceId: 'r1' };
    const ctx: OperationContext = { events: [makeEv('existing', t(8), t(10), 'r1')] };
    const result = validateOverlap(noEvChange, ctx);
    expect(result!.rule).toBe('overlap');
  });

  it('uses resourceId from change.event.resourceId when change.resourceId is absent', () => {
    const ev = makeEv('new', t(9), t(10), 'r1');
    const change: ChangeShape = { newStart: t(9), newEnd: t(10), event: ev };
    const ctx: OperationContext = { events: [makeEv('existing', t(8), t(10), 'r1')] };
    const result = validateOverlap(change, ctx);
    expect(result!.rule).toBe('overlap');
  });

  it('violation message includes resourceId and conflicting event title', () => {
    const ctx: OperationContext = { events: [makeEv('ev2', t(8), t(10), 'r1')] };
    const result = validateOverlap(baseChange, ctx);
    expect(result!.message).toContain('r1');
    expect(result!.message).toContain('ev2');
  });

  it('returns null when events array is empty', () => {
    const ctx: OperationContext = { events: [] };
    expect(validateOverlap(baseChange, ctx)).toBeNull();
  });

  it('returns null when events is undefined', () => {
    const ctx: OperationContext = {};
    expect(validateOverlap(baseChange, ctx)).toBeNull();
  });
})

// ─── ctx.assignments — multi-assignment aware paths ───────────────────────────

function makeAssignment(id: string, eventId: string, resourceId: string): Assignment {
  return { id, eventId, resourceId, units: 100 };
}

function assignmentsMap(...as: Assignment[]): ReadonlyMap<string, Assignment> {
  return new Map(as.map(a => [a.id, a]));
}

describe('validateOverlap — assignments-based resource detection', () => {
  it('collects resourceIds via ctx.assignments for the proposed event (line-32 TRUE)', () => {
    // The proposed event ("new") has no resourceId field; it is linked to r1 via assignments.
    const self = makeEv('new', t(9), t(10), null);
    const existing = makeEv('existing', t(8), t(10), 'r1');
    const change: ChangeShape = { newStart: t(9), newEnd: t(10), event: self };
    const ctx: OperationContext = {
      events: [existing],
      assignments: assignmentsMap(makeAssignment('a1', 'new', 'r1')),
    };
    const result = validateOverlap(change, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('overlap');
  });

  it('collects resourceIds via ctx.assignments for existing events (line-50 TRUE)', () => {
    // Existing event "existing" has no resourceId field; linked to r1 via assignments.
    const existing = makeEv('existing', t(8), t(10), null);
    const ctx: OperationContext = {
      events: [existing],
      assignments: assignmentsMap(makeAssignment('a2', 'existing', 'r1')),
    };
    // baseChange has resourceId: 'r1' and event.id='new' (not in assignments)
    const result = validateOverlap(baseChange, ctx);
    expect(result).not.toBeNull();
    expect(result!.conflictingEventId).toBe('existing');
  });

  it('evResources from assignments skips legacy resourceId field (line-53 FALSE)', () => {
    // When evResources is populated via assignments (non-empty), the legacy
    // `ev.resourceId` push at line 53 is skipped (the condition is FALSE).
    const existing = makeEv('existing', t(8), t(10), 'r2'); // legacy field r2, but assigned r1
    const ctx: OperationContext = {
      events: [existing],
      assignments: assignmentsMap(makeAssignment('a3', 'existing', 'r1')),
    };
    const result = validateOverlap(baseChange, ctx);
    // Overlap via assignment r1 should be detected
    expect(result).not.toBeNull();
    expect(result!.conflictingEventId).toBe('existing');
  });

  it('returns null when assignments exist but proposed event has no assignment (unscoped)', () => {
    // No assignment for "new" → resourceIds stays empty → fallback to change.resourceId/event.resourceId
    const change: ChangeShape = {
      newStart: t(9), newEnd: t(10),
      event: makeEv('new', t(9), t(10), null), // null resourceId, no assignment
    };
    const ctx: OperationContext = {
      events: [makeEv('existing', t(8), t(10), 'r1')],
      assignments: assignmentsMap(), // empty — no assignments for 'new'
    };
    expect(validateOverlap(change, ctx)).toBeNull();
  });
});
