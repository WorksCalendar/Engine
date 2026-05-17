/**
 * Unit tests for validateDependencies.ts
 *
 * Covers validateDependencies and validateNoCycle — both are pure functions
 * that return a Violation or null, with no side effects.
 * No mocking is required.
 */
import { describe, it, expect } from 'vitest';
import {
  validateDependencies,
  validateNoCycle,
} from '../validateDependencies.js';
import type { ChangeShape, OperationContext } from '../validationTypes.js';
import type { Dependency, DependencyType } from '../../schema/dependencySchema.js';
import type { EngineEvent } from '../../schema/eventSchema.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Build a minimal EngineEvent for tests. */
function makeEv(id: string, start: Date, end: Date, title = `Event-${id}`): EngineEvent {
  return {
    id,
    seriesId:       null,
    occurrenceId:   null,
    detachedFrom:   null,
    start,
    end,
    timezone:       null,
    allDay:         false,
    title,
    category:       null,
    resourceId:     null,
    resourcePoolId: null,
    status:         'confirmed',
    color:          null,
    rrule:          null,
    exdates:        [],
    constraints:    [],
    meta:           {},
  };
}

/** Build a minimal Dependency for tests. */
function makeDep(
  id: string,
  from: string,
  to: string,
  type: DependencyType = 'finish-to-start',
  lagMs = 0,
): Dependency {
  return { id, fromEventId: from, toEventId: to, type, lagMs };
}

/** Wrap Dependency objects into the ReadonlyMap the context expects. */
function depsMap(...deps: Dependency[]): ReadonlyMap<string, Dependency> {
  return new Map(deps.map(d => [d.id, d]));
}

// ─── Date fixtures (Mon 5 Jan 2026) ──────────────────────────────────────────

const T = {
  h8:  new Date(2026, 0, 5,  8, 0),
  h9:  new Date(2026, 0, 5,  9, 0),
  h10: new Date(2026, 0, 5, 10, 0),
  h11: new Date(2026, 0, 5, 11, 0),
  h12: new Date(2026, 0, 5, 12, 0),
  h13: new Date(2026, 0, 5, 13, 0),
};

// ─── validateDependencies ─────────────────────────────────────────────────────

describe('validateDependencies', () => {

  // ── early-exit guards ────────────────────────────────────────────────────

  it('returns null when ctx.dependencies is undefined', () => {
    const change: ChangeShape = {
      newStart: T.h10,
      newEnd:   T.h11,
      event:    makeEv('ev-1', T.h10, T.h11),
    };
    const ctx: OperationContext = {};
    expect(validateDependencies(change, ctx)).toBeNull();
  });

  it('returns null when ctx.dependencies is an empty map', () => {
    const change: ChangeShape = {
      newStart: T.h10,
      newEnd:   T.h11,
      event:    makeEv('ev-1', T.h10, T.h11),
    };
    const ctx: OperationContext = { dependencies: new Map() };
    expect(validateDependencies(change, ctx)).toBeNull();
  });

  it('returns null when change.event is undefined (no selfId)', () => {
    const dep = makeDep('d1', 'pred', 'ev-1');
    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [makeEv('pred', T.h9, T.h10)],
    };
    // No event property on the change
    const change: ChangeShape = { newStart: T.h10, newEnd: T.h11 };
    expect(validateDependencies(change, ctx)).toBeNull();
  });

  it('returns null when change.event is null (no selfId)', () => {
    const dep = makeDep('d1', 'pred', 'ev-1');
    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [makeEv('pred', T.h9, T.h10)],
    };
    const change: ChangeShape = { newStart: T.h10, newEnd: T.h11, event: null };
    expect(validateDependencies(change, ctx)).toBeNull();
  });

  it('returns null when change.event.id is empty string (falsy selfId)', () => {
    const dep = makeDep('d1', 'pred', 'ev-1');
    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [makeEv('pred', T.h9, T.h10)],
    };
    const noId = { ...makeEv('ev-1', T.h10, T.h11), id: '' };
    const change: ChangeShape = { newStart: T.h10, newEnd: T.h11, event: noId };
    expect(validateDependencies(change, ctx)).toBeNull();
  });

  // ── predecessor check (this event is the SUCCESSOR) ─────────────────────

  it('returns hard dependency-predecessor violation when FS link is violated', () => {
    // Predecessor ends at 10:00; successor must start >= 10:00
    const pred = makeEv('pred', T.h9, T.h10, 'Predecessor');
    const self = makeEv('self', T.h9, T.h10, 'Self');
    const dep  = makeDep('d1', 'pred', 'self', 'finish-to-start', 0);

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [pred, self],
    };
    // Proposed move: self starts at 09:00 (before predecessor ends at 10:00)
    const change: ChangeShape = { newStart: T.h9, newEnd: T.h10, event: self };

    const result = validateDependencies(change, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('dependency-predecessor');
    expect(result!.severity).toBe('hard');
  });

  it('returns null when predecessor FS link is exactly satisfied (start === anchor)', () => {
    const pred = makeEv('pred', T.h9, T.h10, 'Predecessor');
    const self = makeEv('self', T.h10, T.h11, 'Self');
    const dep  = makeDep('d1', 'pred', 'self', 'finish-to-start', 0);

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [pred, self],
    };
    // Proposed: self starts at 10:00 (exactly when predecessor ends) → not violated
    const change: ChangeShape = { newStart: T.h10, newEnd: T.h11, event: self };

    expect(validateDependencies(change, ctx)).toBeNull();
  });

  it('returns null when predecessor event is not found in ctx.events (skip)', () => {
    const self = makeEv('self', T.h9, T.h10);
    const dep  = makeDep('d1', 'missing-pred', 'self');

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [self],  // missing-pred is absent
    };
    const change: ChangeShape = { newStart: T.h9, newEnd: T.h10, event: self };
    expect(validateDependencies(change, ctx)).toBeNull();
  });

  it('returns hard violation for start-to-start predecessor link when violated', () => {
    // pred starts at 10:00; self cannot start before 10:00
    const pred = makeEv('pred', T.h10, T.h11, 'Predecessor');
    const self = makeEv('self', T.h9,  T.h10, 'Self');
    const dep  = makeDep('d1', 'pred', 'self', 'start-to-start', 0);

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [pred, self],
    };
    // self wants to start at 09:00 — before predecessor start of 10:00 → violated
    const change: ChangeShape = { newStart: T.h9, newEnd: T.h10, event: self };

    const result = validateDependencies(change, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('dependency-predecessor');
    expect(result!.severity).toBe('hard');
  });

  it('conflictingEventId on predecessor violation equals the predecessor id', () => {
    const pred = makeEv('pred-007', T.h9, T.h10);
    const self = makeEv('self',     T.h9, T.h10);
    const dep  = makeDep('d1', 'pred-007', 'self');

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [pred, self],
    };
    const change: ChangeShape = { newStart: T.h9, newEnd: T.h10, event: self };

    const result = validateDependencies(change, ctx);
    expect(result!.conflictingEventId).toBe('pred-007');
  });

  it('violation message includes the dependency type', () => {
    const pred = makeEv('pred', T.h9, T.h10, 'Alpha');
    const self = makeEv('self', T.h9, T.h10, 'Self');
    const dep  = makeDep('d1', 'pred', 'self', 'finish-to-start', 0);

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [pred, self],
    };
    const change: ChangeShape = { newStart: T.h9, newEnd: T.h10, event: self };

    const result = validateDependencies(change, ctx);
    expect(result!.message).toContain('finish-to-start');
  });

  it('violation message includes the predecessor title', () => {
    const pred = makeEv('pred', T.h9, T.h10, 'My Predecessor');
    const self = makeEv('self', T.h9, T.h10, 'Self');
    const dep  = makeDep('d1', 'pred', 'self', 'finish-to-start', 0);

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [pred, self],
    };
    const change: ChangeShape = { newStart: T.h9, newEnd: T.h10, event: self };

    const result = validateDependencies(change, ctx);
    expect(result!.message).toContain('My Predecessor');
  });

  it('violation details include dependencyId, dependencyType, and lagMs', () => {
    const pred = makeEv('pred', T.h9, T.h10);
    const self = makeEv('self', T.h9, T.h10);
    const dep  = makeDep('dep-99', 'pred', 'self', 'finish-to-start', 1_800_000);

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [pred, self],
    };
    const change: ChangeShape = { newStart: T.h9, newEnd: T.h10, event: self };

    const result = validateDependencies(change, ctx);
    expect(result!.details).toMatchObject({
      dependencyId:   'dep-99',
      dependencyType: 'finish-to-start',
      lagMs:          1_800_000,
    });
  });

  it('processes multiple predecessors and returns on the first violation encountered', () => {
    // dep1: pred1 FS self — pred1 ends 09:00, self at 10:00 → ok
    // dep2: pred2 FS self — pred2 ends 11:00, self at 10:00 → violated
    const pred1 = makeEv('pred1', T.h8,  T.h9,  'First');
    const pred2 = makeEv('pred2', T.h9,  T.h11, 'Second');
    const self  = makeEv('self',  T.h10, T.h11, 'Self');

    const dep1 = makeDep('d1', 'pred1', 'self', 'finish-to-start', 0);
    const dep2 = makeDep('d2', 'pred2', 'self', 'finish-to-start', 0);

    const ctx: OperationContext = {
      dependencies: depsMap(dep1, dep2),
      events: [pred1, pred2, self],
    };
    const change: ChangeShape = { newStart: T.h10, newEnd: T.h11, event: self };

    const result = validateDependencies(change, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('dependency-predecessor');
    expect(result!.conflictingEventId).toBe('pred2');
  });

  // ── successor warning (this event is the PREDECESSOR) ───────────────────

  it('returns soft dependency-successor violation when moving this event strands a successor', () => {
    // self is being moved to 12:00–13:00; successor starts at 11:00 (stranded)
    const succ = makeEv('succ', T.h11, T.h12, 'Successor');
    const self = makeEv('self', T.h10, T.h11, 'Self');
    const dep  = makeDep('d1', 'self', 'succ', 'finish-to-start', 0);

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [self, succ],
    };
    // Proposed: self → 12:00–13:00; anchor = 13:00; succ.start = 11:00 < 13:00 → violated
    const change: ChangeShape = { newStart: T.h12, newEnd: T.h13, event: self };

    const result = validateDependencies(change, ctx);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('dependency-successor');
    expect(result!.severity).toBe('soft');
  });

  it('returns null when no successors are violated after moving this event earlier', () => {
    // self moves earlier to 08:00–09:00; anchor = 09:00; succ at 10:00 → ok
    const succ = makeEv('succ', T.h10, T.h11, 'Successor');
    const self = makeEv('self', T.h9,  T.h10, 'Self');
    const dep  = makeDep('d1', 'self', 'succ', 'finish-to-start', 0);

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [self, succ],
    };
    const change: ChangeShape = { newStart: T.h8, newEnd: T.h9, event: self };

    expect(validateDependencies(change, ctx)).toBeNull();
  });

  it('returns null when successor is not found in ctx.events (skip)', () => {
    const self = makeEv('self', T.h9, T.h10, 'Self');
    const dep  = makeDep('d1', 'self', 'missing-succ');

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [self],  // missing-succ is absent
    };
    const change: ChangeShape = { newStart: T.h12, newEnd: T.h13, event: self };
    expect(validateDependencies(change, ctx)).toBeNull();
  });

  it('successor violation conflictingEventId equals the successor id', () => {
    const succ = makeEv('succ-42', T.h11, T.h12, 'NextEvent');
    const self = makeEv('self',    T.h9,  T.h10, 'Self');
    const dep  = makeDep('d1', 'self', 'succ-42', 'finish-to-start', 0);

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [self, succ],
    };
    const change: ChangeShape = { newStart: T.h12, newEnd: T.h13, event: self };

    const result = validateDependencies(change, ctx);
    expect(result!.conflictingEventId).toBe('succ-42');
  });

  it('successor violation message includes the successor title', () => {
    const succ = makeEv('succ', T.h11, T.h12, 'NextEvent');
    const self = makeEv('self', T.h9,  T.h10, 'Self');
    const dep  = makeDep('d1', 'self', 'succ', 'finish-to-start', 0);

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      events: [self, succ],
    };
    const change: ChangeShape = { newStart: T.h12, newEnd: T.h13, event: self };

    const result = validateDependencies(change, ctx);
    expect(result!.message).toContain('NextEvent');
  });

  it('predecessor check fires before successor check when both would be violated', () => {
    // self is simultaneously a successor of pred (violated) and a predecessor of succ (violated)
    const pred = makeEv('pred', T.h10, T.h11, 'Pred');
    const succ = makeEv('succ', T.h9,  T.h10, 'Succ');
    const self = makeEv('self', T.h9,  T.h10, 'Self');

    const depPred = makeDep('d1', 'pred', 'self', 'finish-to-start', 0); // violated: self<10
    const depSucc = makeDep('d2', 'self', 'succ', 'finish-to-start', 0); // also violated

    const ctx: OperationContext = {
      dependencies: depsMap(depPred, depSucc),
      events: [pred, succ, self],
    };
    // self proposed at 09:00–10:00 (before pred ends at 11:00)
    const change: ChangeShape = { newStart: T.h9, newEnd: T.h10, event: self };

    const result = validateDependencies(change, ctx);
    expect(result!.rule).toBe('dependency-predecessor');
  });

  it('returns null when ctx.events is undefined (events defaults to []) so predecessors skip', () => {
    const self = makeEv('self', T.h9, T.h10);
    const dep  = makeDep('d1', 'pred', 'self');

    const ctx: OperationContext = {
      dependencies: depsMap(dep),
      // events is omitted → defaults to []
    };
    const change: ChangeShape = { newStart: T.h9, newEnd: T.h10, event: self };
    expect(validateDependencies(change, ctx)).toBeNull();
  });
});

// ─── validateNoCycle ──────────────────────────────────────────────────────────

describe('validateNoCycle', () => {
  it('returns null immediately when existingDeps is undefined', () => {
    expect(validateNoCycle('a', 'b', undefined)).toBeNull();
  });

  it('returns null immediately when existingDeps is null', () => {
    expect(validateNoCycle('a', 'b', null as Record<string, unknown>)).toBeNull();
  });

  it('returns null when no cycle would be created', () => {
    // a→b, b→c already. Adding c→d creates no cycle.
    const deps = depsMap(
      makeDep('d1', 'a', 'b'),
      makeDep('d2', 'b', 'c'),
    );
    expect(validateNoCycle('c', 'd', deps)).toBeNull();
  });

  it('returns a hard dependency-cycle violation when adding would create a cycle', () => {
    // a→b, b→c already. Adding c→a would close the loop (a→b→c→a).
    const deps = depsMap(
      makeDep('d1', 'a', 'b'),
      makeDep('d2', 'b', 'c'),
    );
    const result = validateNoCycle('c', 'a', deps);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('dependency-cycle');
    expect(result!.severity).toBe('hard');
  });
});
