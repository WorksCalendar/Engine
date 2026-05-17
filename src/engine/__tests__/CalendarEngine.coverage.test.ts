/**
 * CalendarEngine — branch-coverage supplement.
 *
 * Targets branches that the other engine test files leave unexercised:
 *   - createInitialState with init.filter provided
 *   - dispatch returning same state (no notify)
 *   - applyMutation 'accepted-with-warnings' path
 *   - dependency CRUD: upsert (existing), remove, getSuccessorsOf / getPredecessorsOf
 *   - resource-calendar CRUD: removeResourceCalendar (not found), getCalendarForResource (found / missing)
 *   - workloadForResource when no ids registered
 *   - private index cleanup empty-set pruning (_removeFromAssignmentIndex, _removeFromDependencyIndex)
 *   - _emitBookingLifecycle: actor/reason spreads on created/deleted, afterStage=null skip,
 *     channel=null skip, reason/actor on updated
 *   - _emitBooking when bus is null
 */
import { describe, it, expect, vi } from 'vitest';
import { CalendarEngine, createInitialState } from '../CalendarEngine.js';
import { makeEvent }        from '../schema/eventSchema.js';
import { makeAssignment }   from '../schema/assignmentSchema.js';
import { makeDependency }   from '../schema/dependencySchema.js';
import { makeResourceCalendar } from '../schema/resourceCalendarSchema.js';
import { EventBus }         from '../eventBus.js';
import type { EngineEvent } from '../schema/eventSchema.js';
import type { ApprovalStage } from '../../types/assets.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function ev(id: string, overrides: Partial<EngineEvent> = {}): EngineEvent {
  return makeEvent(id, {
    title: 'Event ' + id,
    start: new Date(2026, 3, 20, 10, 0),
    end:   new Date(2026, 3, 20, 11, 0),
    ...overrides,
  });
}

function a(id: string, eventId: string, resourceId: string, units = 100) {
  return makeAssignment(id, { eventId, resourceId, units });
}

function dep(id: string, from: string, to: string) {
  return makeDependency(id, { fromEventId: from, toEventId: to });
}

function rc(id: string, resourceId: string) {
  return makeResourceCalendar(id, resourceId);
}

const flush = () => Promise.resolve();

// ─── createInitialState ───────────────────────────────────────────────────────

describe('createInitialState — init.filter branch', () => {
  it('uses provided filter over the blank default', () => {
    const state = createInitialState({
      filter: {
        search: 'hello',
        categories: new Set(['cat-a']),
        resources: new Set(['r-1']),
      },
    });
    expect(state.filter.search).toBe('hello');
    expect(state.filter.categories.has('cat-a')).toBe(true);
    expect(state.filter.resources.has('r-1')).toBe(true);
  });

  it('falls back to empty strings/sets when filter fields are absent', () => {
    const state = createInitialState({ filter: {} });
    expect(state.filter.search).toBe('');
    expect(state.filter.categories.size).toBe(0);
    expect(state.filter.resources.size).toBe(0);
  });
});

// ─── createInitialState / setEvents — malformed event ids ────────────────────

describe('CalendarEngine — ingestion drops events with bad ids instead of corrupting the map', () => {
  it('createInitialState skips events whose id is missing / not a string', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = createInitialState({
      events: [
        ev('ok-1'),
        { id: undefined } as unknown as EngineEvent,
        { id: null } as unknown as EngineEvent,
        { id: '' } as unknown as EngineEvent,
        { id: 42 } as unknown as EngineEvent,
        ev('ok-2'),
      ],
    });
    expect([...state.events.keys()].sort()).toEqual(['ok-1', 'ok-2']);
    expect(state.events.has('undefined')).toBe(false);
    expect(state.events.has('')).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not throw when constructed with malformed events', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => new CalendarEngine({ events: [{ id: undefined } as unknown as EngineEvent, ev('ok')] })).not.toThrow();
    warn.mockRestore();
  });

  it('setEvents applies the same id guard', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = new CalendarEngine();
    engine.setEvents([ev('keep'), { id: '' } as unknown as EngineEvent, { id: undefined } as unknown as EngineEvent]);
    expect([...engine.state.events.keys()]).toEqual(['keep']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ─── dispatch — no-change branch ─────────────────────────────────────────────

describe('CalendarEngine.dispatch — same-state no-notify', () => {
  it('does NOT call listeners when applyOperation returns the same state reference', () => {
    const engine = new CalendarEngine();
    const listener = vi.fn();
    engine.subscribe(listener);
    // An unknown operation type falls through to the default case in applyOperation,
    // which returns the original state reference unchanged — so dispatch skips _notify().
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    engine.dispatch({ type: 'UNKNOWN_NO_OP' } as unknown as Parameters<typeof engine.dispatch>[0]);
    consoleSpy.mockRestore();
    expect(listener).not.toHaveBeenCalled();
  });

  it('DOES call listeners when state actually changes', () => {
    const engine = new CalendarEngine();
    const listener = vi.fn();
    engine.subscribe(listener);
    engine.dispatch({ type: 'SET_VIEW', view: 'week' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ─── applyMutation — accepted-with-warnings ───────────────────────────────────

describe('CalendarEngine.applyMutation — accepted-with-warnings', () => {
  it('returns accepted-with-warnings when soft violation is overridden (outside biz hours)', () => {
    // Saturday = day 6 → outside default Mon-Fri business hours → soft violation
    const engine = new CalendarEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    const ctx = {
      businessHours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
    };
    // 2026-04-18 is a Saturday
    const result = engine.applyMutation(
      {
        type: 'create',
        event: {
          title: 'Weekend event',
          start: new Date(2026, 3, 18, 10, 0),  // Saturday
          end:   new Date(2026, 3, 18, 11, 0),
        } as Omit<EngineEvent, 'id'>,
      },
      ctx,
      { overrideSoftViolations: true },
    );
    expect(result.status).toBe('accepted-with-warnings');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ─── Dependency CRUD ─────────────────────────────────────────────────────────

describe('CalendarEngine — dependency CRUD', () => {
  it('upsertDependency adds a new dep to the index', () => {
    const engine = new CalendarEngine();
    engine.upsertDependency(dep('d1', 'e1', 'e2'));
    expect(engine.getSuccessorsOf('e1')).toHaveLength(1);
    expect(engine.getPredecessorsOf('e2')).toHaveLength(1);
  });

  it('upsertDependency replaces an existing dep (existing branch)', () => {
    const engine = new CalendarEngine({
      dependencies: [dep('d1', 'e1', 'e2')],
    });
    // Replace with updated lagMs
    engine.upsertDependency({ ...dep('d1', 'e1', 'e2'), lagMs: 5000 });
    const succs = engine.getSuccessorsOf('e1');
    expect(succs).toHaveLength(1);
    expect(succs[0]!.lagMs).toBe(5000);
  });

  it('removeDependency removes an existing dep from index', () => {
    const engine = new CalendarEngine({
      dependencies: [dep('d1', 'e1', 'e2')],
    });
    engine.removeDependency('d1');
    expect(engine.getSuccessorsOf('e1')).toHaveLength(0);
    expect(engine.getPredecessorsOf('e2')).toHaveLength(0);
    expect(engine.state.dependencies.size).toBe(0);
  });

  it('removeDependency is a no-op for an unknown id', () => {
    const engine = new CalendarEngine({
      dependencies: [dep('d1', 'e1', 'e2')],
    });
    engine.removeDependency('ghost');
    expect(engine.state.dependencies.size).toBe(1);
  });

  it('getSuccessorsOf returns empty when eventId has no index entry', () => {
    const engine = new CalendarEngine();
    expect(engine.getSuccessorsOf('no-such-event')).toEqual([]);
  });

  it('getPredecessorsOf returns empty when eventId has no index entry', () => {
    const engine = new CalendarEngine();
    expect(engine.getPredecessorsOf('no-such-event')).toEqual([]);
  });

  it('setDependencies rebuilds the index wholesale', () => {
    const engine = new CalendarEngine({
      dependencies: [dep('d1', 'e1', 'e2')],
    });
    engine.setDependencies([dep('d2', 'e3', 'e4')]);
    expect(engine.getSuccessorsOf('e1')).toEqual([]);
    expect(engine.getSuccessorsOf('e3')).toHaveLength(1);
  });

  it('_addToDependencyIndex reuses existing bucket when fromEventId appears twice', () => {
    // Adds two deps with the same fromEventId so the second hits the "byFrom exists" branch
    const engine = new CalendarEngine({
      dependencies: [dep('d1', 'e1', 'e2'), dep('d2', 'e1', 'e3')],
    });
    const succs = engine.getSuccessorsOf('e1');
    expect(succs).toHaveLength(2);
  });

  it('_addToDependencyIndex reuses existing bucket when toEventId appears twice', () => {
    // Two deps pointing to the same toEventId
    const engine = new CalendarEngine({
      dependencies: [dep('d1', 'e1', 'e3'), dep('d2', 'e2', 'e3')],
    });
    const preds = engine.getPredecessorsOf('e3');
    expect(preds).toHaveLength(2);
  });

  it('_removeFromDependencyIndex does not prune bucket when other deps remain', () => {
    // Two deps share fromEventId; removing one should leave the bucket intact
    const engine = new CalendarEngine({
      dependencies: [dep('d1', 'e1', 'e2'), dep('d2', 'e1', 'e3')],
    });
    engine.removeDependency('d1');
    // d2 still exists → fromEvent bucket for e1 should have 1 entry
    expect(engine.getSuccessorsOf('e1')).toHaveLength(1);
  });

  it('_removeFromDependencyIndex does not prune toEvent bucket when other deps remain', () => {
    const engine = new CalendarEngine({
      dependencies: [dep('d1', 'e1', 'e3'), dep('d2', 'e2', 'e3')],
    });
    engine.removeDependency('d1');
    // d2 still targets e3 → toEvent bucket for e3 should have 1 entry
    expect(engine.getPredecessorsOf('e3')).toHaveLength(1);
  });
});

// ─── Resource calendar CRUD ──────────────────────────────────────────────────

describe('CalendarEngine — resource calendar CRUD', () => {
  it('getCalendarForResource returns the matching calendar', () => {
    const engine = new CalendarEngine({
      resourceCalendars: [rc('cal-1', 'r-1')],
    });
    const found = engine.getCalendarForResource('r-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('cal-1');
  });

  it('getCalendarForResource returns null when not found (no calendars)', () => {
    const engine = new CalendarEngine();
    expect(engine.getCalendarForResource('ghost')).toBeNull();
  });

  it('getCalendarForResource returns null when a calendar exists but resourceId does not match', () => {
    const engine = new CalendarEngine({
      resourceCalendars: [rc('cal-1', 'r-1')],
    });
    // r-2 is not attached to any calendar — loop runs but condition is always false
    expect(engine.getCalendarForResource('r-2')).toBeNull();
  });

  it('removeResourceCalendar removes an existing entry', () => {
    const engine = new CalendarEngine({
      resourceCalendars: [rc('cal-1', 'r-1')],
    });
    engine.removeResourceCalendar('cal-1');
    expect(engine.state.resourceCalendars.size).toBe(0);
  });

  it('removeResourceCalendar is a no-op when id not found', () => {
    const engine = new CalendarEngine({
      resourceCalendars: [rc('cal-1', 'r-1')],
    });
    engine.removeResourceCalendar('ghost');
    expect(engine.state.resourceCalendars.size).toBe(1);
  });
});

// ─── rollbackTo — no-pools branch ────────────────────────────────────────────

describe('CalendarEngine.rollbackTo — pools falsy branch', () => {
  it('restores state without overwriting pools when snapshot has no pools', () => {
    const startEvent = ev('snap-e1');
    const engine = new CalendarEngine({ events: [startEvent] });

    // Create a handle via the public snapshot() which calls beginTransaction with pools.
    // But if pools map is empty, restored.pools is still a Map (truthy).
    // To hit the falsy branch we need a handle with no poolsSnapshot.
    // We use the TransactionHandle type directly with only snapshot/openedAt.
    const handle = {
      snapshot: new Map(engine.state.events),
      openedAt: new Date().toISOString(),
      // no poolsSnapshot — causes restored.pools to be undefined
    };

    // Add an event, then roll back — state should revert
    engine.applyMutation({
      type: 'create',
      event: {
        title: 'Should disappear',
        start: new Date(2026, 3, 25, 10, 0),
        end:   new Date(2026, 3, 25, 11, 0),
      } as Omit<EngineEvent, 'id'>,
    });
    expect(engine.state.events.size).toBe(2);

    engine.rollbackTo(handle);
    expect(engine.state.events.size).toBe(1);
  });
});

// ─── workloadForResource ─────────────────────────────────────────────────────

describe('CalendarEngine.workloadForResource', () => {
  it('returns 0 for an unknown resource', () => {
    const engine = new CalendarEngine({ assignments: [a('A1', 'e1', 'r1', 80)] });
    expect(engine.workloadForResource('nobody')).toBe(0);
  });

  it('returns the sum of units across indexed assignments', () => {
    const engine = new CalendarEngine({
      assignments: [a('A1', 'e1', 'r1', 50), a('A2', 'e2', 'r1', 30)],
    });
    expect(engine.workloadForResource('r1')).toBe(80);
  });
});

// ─── Private index cleanup — empty-set pruning ───────────────────────────────

describe('CalendarEngine — _removeFromAssignmentIndex empty-set pruning', () => {
  it('prunes the resource bucket when last assignment removed', () => {
    const engine = new CalendarEngine({ assignments: [a('A1', 'e1', 'r1')] });
    engine.removeAssignment('A1');
    // If the Set was not pruned, getAssignmentsForResource would still hit the key.
    // Verify by re-adding: the index is clean if length is exactly 1.
    engine.upsertAssignment(a('A2', 'e2', 'r1'));
    expect(engine.getAssignmentsForResource('r1')).toHaveLength(1);
  });

  it('prunes the event bucket when last assignment removed', () => {
    const engine = new CalendarEngine({ assignments: [a('A1', 'e1', 'r1')] });
    engine.removeAssignment('A1');
    engine.upsertAssignment(a('A2', 'e1', 'r2'));
    expect(engine.getAssignmentsForEvent('e1')).toHaveLength(1);
  });
});

describe('CalendarEngine — _removeFromDependencyIndex empty-set pruning', () => {
  it('prunes the from-event bucket when last dep removed', () => {
    const engine = new CalendarEngine({ dependencies: [dep('d1', 'e1', 'e2')] });
    engine.removeDependency('d1');
    // Re-adding: index should be clean
    engine.upsertDependency(dep('d2', 'e1', 'e3'));
    expect(engine.getSuccessorsOf('e1')).toHaveLength(1);
  });

  it('prunes the to-event bucket when last dep removed', () => {
    const engine = new CalendarEngine({ dependencies: [dep('d1', 'e1', 'e2')] });
    engine.removeDependency('d1');
    engine.upsertDependency(dep('d2', 'e3', 'e2'));
    expect(engine.getPredecessorsOf('e2')).toHaveLength(1);
  });
});

// ─── _emitBookingLifecycle branches ──────────────────────────────────────────

describe('CalendarEngine._emitBookingLifecycle — actor / reason on create/delete', () => {
  it('emits booking.requested with actor from approvalStage history on create', async () => {
    const bus = new EventBus();
    const engine = new CalendarEngine({ bus });
    const handler = vi.fn();
    bus.subscribe('booking.requested', handler);

    const stage: ApprovalStage = {
      stage: 'requested',
      updatedAt: new Date().toISOString(),
      history: [{ action: 'submit', at: new Date().toISOString(), actor: 'alice' }],
    };

    engine.applyMutation({
      type: 'create',
      event: {
        title: 'With actor',
        start: new Date(2026, 3, 21, 9, 0),
        end:   new Date(2026, 3, 21, 10, 0),
        meta: { approvalStage: stage },
      } as unknown as Omit<EngineEvent, 'id'>,
    });

    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].actor).toBe('alice');
  });

  it('emits booking.requested without actor when history has no actor', async () => {
    const bus = new EventBus();
    const engine = new CalendarEngine({ bus });
    const handler = vi.fn();
    bus.subscribe('booking.requested', handler);

    engine.applyMutation({
      type: 'create',
      event: {
        title: 'No actor',
        start: new Date(2026, 3, 21, 9, 0),
        end:   new Date(2026, 3, 21, 10, 0),
      } as Omit<EngineEvent, 'id'>,
    });

    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].actor).toBeUndefined();
  });

  it('emits booking.cancelled with actor on delete', async () => {
    const bus = new EventBus();
    const stage: ApprovalStage = {
      stage: 'approved',
      updatedAt: new Date().toISOString(),
      history: [{ action: 'approve', at: new Date().toISOString(), actor: 'bob' }],
    };
    const event = ev('del-1', { meta: { approvalStage: stage } });
    const engine = new CalendarEngine({ events: [event], bus });
    const handler = vi.fn();
    bus.subscribe('booking.cancelled', handler);

    engine.applyMutation({ type: 'delete', id: 'del-1' });

    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].actor).toBe('bob');
  });

  it('skips updated change when afterStage is null (no approvalStage in meta)', async () => {
    const bus = new EventBus();
    const event = ev('upd-1');
    const engine = new CalendarEngine({ events: [event], bus });
    const approved = vi.fn();
    bus.subscribe('booking.approved', approved);

    engine.applyMutation({
      type: 'update',
      id: 'upd-1',
      patch: { title: 'Updated no stage' },
    });

    await flush();
    expect(approved).not.toHaveBeenCalled();
  });

  it('skips updated change when channel is null (same stage approved→approved)', async () => {
    const bus = new EventBus();
    const stage: ApprovalStage = {
      stage: 'approved',
      updatedAt: new Date().toISOString(),
      history: [],
    };
    const event = ev('upd-2', { meta: { approvalStage: stage } });
    const engine = new CalendarEngine({ events: [event], bus });
    const approved = vi.fn();
    bus.subscribe('booking.approved', approved);

    // approved→approved → channelForApprovalTransition returns null → skip
    engine.applyMutation({
      type: 'update',
      id: 'upd-2',
      patch: {
        title: 'No transition',
        meta: { approvalStage: { ...stage } },
      },
    });

    await flush();
    expect(approved).not.toHaveBeenCalled();
  });

  it('skips updated change when channel is null (pending_higher → no channel)', async () => {
    const bus = new EventBus();
    const before: ApprovalStage = {
      stage: 'requested',
      updatedAt: new Date().toISOString(),
      history: [],
    };
    const event = ev('upd-ph', { meta: { approvalStage: before } });
    const engine = new CalendarEngine({ events: [event], bus });
    const handler = vi.fn();
    bus.subscribe('booking.approved', handler);
    bus.subscribe('booking.requested', handler);

    const after: ApprovalStage = {
      stage: 'pending_higher' as ApprovalStage['stage'],
      updatedAt: new Date().toISOString(),
      history: [],
    };
    engine.applyMutation({
      type: 'update',
      id: 'upd-ph',
      patch: { meta: { approvalStage: after } },
    });

    await flush();
    // pending_higher is a default case → null channel → no emission
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses null for beforeStage when update adds an approvalStage for the first time', async () => {
    // Exercises the `beforeStage?.stage ?? null` → null path (82[1]).
    // event has no approvalStage initially → beforeStage = null
    // update adds stage='requested' → channelForApprovalTransition(null, 'requested') → 'booking.requested'
    const bus = new EventBus();
    const event = ev('add-stage-1');  // no meta.approvalStage
    const engine = new CalendarEngine({ events: [event], bus });
    const requested = vi.fn();
    bus.subscribe('booking.requested', requested);

    const after: ApprovalStage = {
      stage: 'requested',
      updatedAt: new Date().toISOString(),
      history: [],
    };
    engine.applyMutation({
      type: 'update',
      id: 'add-stage-1',
      patch: { meta: { approvalStage: after } },
    });

    await flush();
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it('includes reason and actor in booking.approved payload', async () => {
    const bus = new EventBus();
    const before: ApprovalStage = {
      stage: 'requested',
      updatedAt: new Date().toISOString(),
      history: [],
    };
    const event = ev('upd-3', { meta: { approvalStage: before } });
    const engine = new CalendarEngine({ events: [event], bus });
    const handler = vi.fn();
    bus.subscribe('booking.approved', handler);

    const after: ApprovalStage = {
      stage: 'approved',
      updatedAt: new Date().toISOString(),
      history: [{ action: 'approve', at: new Date().toISOString(), actor: 'carol', reason: 'Looks good' }],
    };
    engine.applyMutation({
      type: 'update',
      id: 'upd-3',
      patch: { meta: { approvalStage: after } },
    });

    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].actor).toBe('carol');
    expect(handler.mock.calls[0][0].reason).toBe('Looks good');
  });
});

// ─── readApprovalStage branches ─────────────────────────────────────────────

describe('CalendarEngine — readApprovalStage edge cases', () => {
  it('does not emit when approvalStage is not an object', async () => {
    const bus = new EventBus();
    const event = ev('meta-1', { meta: { approvalStage: 'requested' as unknown as ApprovalStage } });
    const engine = new CalendarEngine({ events: [event], bus });
    const handler = vi.fn();
    bus.subscribe('booking.approved', handler);

    engine.applyMutation({
      type: 'update',
      id: 'meta-1',
      patch: { title: 'Patched' },
    });

    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not emit when approvalStage.stage is not a string', async () => {
    const bus = new EventBus();
    const event = ev('meta-2', { meta: { approvalStage: { stage: 42, updatedAt: '' } as unknown as ApprovalStage } });
    const engine = new CalendarEngine({ events: [event], bus });
    const handler = vi.fn();
    bus.subscribe('booking.approved', handler);

    engine.applyMutation({
      type: 'update',
      id: 'meta-2',
      patch: { title: 'Patched 2' },
    });

    await flush();
    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── upsertAssignment — bus emit only for new assignments ────────────────────

describe('CalendarEngine.upsertAssignment — bus.emit', () => {
  it('emits assignment.created only for new assignments (not replacements)', async () => {
    const bus = new EventBus();
    const engine = new CalendarEngine({ bus });
    const handler = vi.fn();
    bus.subscribe('assignment.created', handler);

    engine.upsertAssignment(a('A1', 'e1', 'r1'));
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);

    handler.mockClear();
    engine.upsertAssignment(a('A1', 'e1', 'r2'));   // replace existing
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not throw when no bus is set (bus=null)', () => {
    const engine = new CalendarEngine();  // no bus
    expect(() => engine.upsertAssignment(a('A1', 'e1', 'r1'))).not.toThrow();
  });
});
