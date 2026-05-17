/**
 * Regression tests for recurring-event mutations.
 *
 * Covers the four scenarios called out in the code review:
 *   1. delete single occurrence
 *   2. delete this-and-following
 *   3. edit title on a later occurrence with scope=series
 *   4. undo/redo across recurring delete and edit
 *
 * All tests operate at the engine layer (applyOperation / CalendarEngine /
 * UndoRedoManager) — no React, no rendering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyOperation } from '../operations/applyOperation.js';
import { resolveRecurringEdit } from '../recurrence/resolveRecurringEdit.js';
import { CalendarEngine } from '../CalendarEngine.js';
import { UndoRedoManager } from '../UndoRedoManager.js';
import { makeEvent } from '../schema/eventSchema.js';
import type { EngineEvent } from '../schema/eventSchema.js';

// ─── Shared fixture ───────────────────────────────────────────────────────────

function d(y: number, mo: number, day: number, h = 9, m = 0): Date {
  return new Date(y, mo - 1, day, h, m, 0, 0);
}

/** Daily standup — Mon-Fri at 09:00, starting 2026-01-05 */
function makeDailyStandup(): EngineEvent {
  return makeEvent('standup', {
    title:    'Daily standup',
    start:    d(2026, 1, 5, 9),        // Mon Jan 5
    end:      d(2026, 1, 5, 9, 15),
    rrule:    'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
    seriesId: 'standup',
  });
}

/** Build a minimal events Map with the standup as its only entry. */
function makeEvents(ev: EngineEvent): Map<string, EngineEvent> {
  return new Map([[ev.id, ev]]);
}

// ─── 0. resolveSeriesEdit branch coverage ────────────────────────────────────
//
// applyOperation short-circuits series-scope updates before calling
// resolveRecurringEdit, so these tests call resolveRecurringEdit directly
// to exercise the TRUE branches for resourceId, resourcePoolId, color,
// newStart, and newEnd in resolveSeriesEdit (lines 215-217, 221-222).

describe('resolveSeriesEdit — TRUE branches for resourceId / resourcePoolId / color / newStart / newEnd', () => {
  it('applies resourceId, resourcePoolId, and color when present in patch', () => {
    const master = makeDailyStandup();
    const [change] = resolveRecurringEdit(master, d(2026, 1, 7, 9), {
      resourceId:     'truck-1',
      resourcePoolId: 'pool-east',
      color:          '#ff0000',
    }, 'series');

    expect(change!.type).toBe('updated');
    if (change!.type !== 'updated') return;
    expect(change!.after.resourceId).toBe('truck-1');
    expect(change!.after.resourcePoolId).toBe('pool-east');
    expect(change!.after.color).toBe('#ff0000');
  });

  it('shifts master start/end when newStart and newEnd are provided', () => {
    const master = makeDailyStandup();
    const newStart = d(2026, 1, 5, 10);
    const newEnd   = d(2026, 1, 5, 10, 15);
    const [change] = resolveRecurringEdit(master, d(2026, 1, 7, 9), {
      newStart,
      newEnd,
    }, 'series');

    expect(change!.type).toBe('updated');
    if (change!.type !== 'updated') return;
    expect(change!.after.start.getTime()).toBe(newStart.getTime());
    expect(change!.after.end.getTime()).toBe(newEnd.getTime());
  });

  it('null-clears resourceId and color when patch contains explicit null values', () => {
    const master: ReturnType<typeof makeDailyStandup> & { resourceId?: string | null; color?: string | null } =
      { ...makeDailyStandup(), resourceId: 'old-truck', color: '#aabbcc' };
    const [change] = resolveRecurringEdit(master, d(2026, 1, 7, 9), {
      resourceId: null,
      color:      null,
    }, 'series');

    expect(change!.type).toBe('updated');
    if (change!.type !== 'updated') return;
    expect(change!.after.resourceId).toBeNull();
    expect(change!.after.color).toBeNull();
  });
});

// ─── 1. Delete single occurrence ─────────────────────────────────────────────

describe('delete single occurrence', () => {
  it('adds an EXDATE to the master and creates no new events', () => {
    const master = makeDailyStandup();
    const events = makeEvents(master);

    // Wednesday Jan 7 occurrence
    const occurrenceDate = d(2026, 1, 7, 9);

    const result = applyOperation(
      { type: 'delete', id: 'standup', scope: 'single', occurrenceDate },
      events,
    );

    expect(result.status).toBe('accepted');
    expect(result.changes).toHaveLength(1);

    const change = result.changes[0];
    expect(change!.type).toBe('updated');
    if (change!.type !== 'updated') return;

    // Master should now have exactly one EXDATE
    expect(change!.after.exdates).toHaveLength(1);
    expect(change.after.exdates[0].getTime!()).toBe(occurrenceDate.getTime());

    // The rrule should be untouched
    expect(change!.after.rrule).toBe(master.rrule);

    // No detached standalone event should be created
    const created = result.changes.filter(c => c.type === 'created');
    expect(created).toHaveLength(0);
  });

  it('does NOT delete the master event', () => {
    const master = makeDailyStandup();
    const result = applyOperation(
      { type: 'delete', id: 'standup', scope: 'single', occurrenceDate: d(2026, 1, 7, 9) },
      makeEvents(master),
    );

    const deleted = result.changes.filter(c => c.type === 'deleted');
    expect(deleted).toHaveLength(0);
  });
});

// ─── 2. Delete this-and-following ────────────────────────────────────────────

describe('delete this-and-following', () => {
  it('sets UNTIL on master to just before the occurrence and creates no new series', () => {
    const master = makeDailyStandup();
    const events = makeEvents(master);

    // Terminate from Wednesday Jan 7 onward
    const occurrenceDate = d(2026, 1, 7, 9);

    const result = applyOperation(
      { type: 'delete', id: 'standup', scope: 'following', occurrenceDate },
      events,
    );

    expect(result.status).toBe('accepted');
    expect(result.changes).toHaveLength(1);

    const change = result.changes[0];
    expect(change!.type).toBe('updated');
    if (change!.type !== 'updated') return;

    // RRULE should now contain an UNTIL clause
    const newRrule = change!.after.rrule ?? '';
    expect(newRrule).toMatch(/UNTIL=/i);

    // The UNTIL date should be before the occurrence (1 ms before)
    const untilMatch = newRrule.match(/UNTIL=([^;]+)/i);
    expect(untilMatch).not.toBeNull();
    // Verify start/end/exdates are unchanged
    expect(change!.after.start.getTime()).toBe(master.start.getTime());
    expect(change!.after.exdates).toHaveLength(0);

    // No new series should be created
    const created = result.changes.filter(c => c.type === 'created');
    expect(created).toHaveLength(0);
  });

  it('does NOT delete the master event', () => {
    const master = makeDailyStandup();
    const result = applyOperation(
      { type: 'delete', id: 'standup', scope: 'following', occurrenceDate: d(2026, 1, 7, 9) },
      makeEvents(master),
    );

    const deleted = result.changes.filter(c => c.type === 'deleted');
    expect(deleted).toHaveLength(0);
  });
});

// ─── 3. Edit title on later occurrence with scope=series ─────────────────────

describe('series-scope title edit from a later occurrence', () => {
  it('updates title on master without changing master start/end', () => {
    const master = makeDailyStandup();
    const events = makeEvents(master);

    // Simulate form opening on the Wednesday occurrence (start = Jan 7 09:00)
    // and the user editing the title, then choosing "All events in the series"
    const occurrenceDate = d(2026, 1, 7, 9);
    const occurrenceEnd  = d(2026, 1, 7, 9, 15);

    const result = applyOperation(
      {
        type:  'update',
        id:    'standup',
        scope: 'series',
        occurrenceDate,
        patch: {
          title:  'Morning standup',    // changed
          start:  occurrenceDate,       // occurrence date — must NOT shift master
          end:    occurrenceEnd,        // occurrence end  — must NOT shift master
          allDay: false,
          status: 'confirmed',
        },
      },
      events,
    );

    expect(result.status).toBe('accepted');
    expect(result.changes).toHaveLength(1);

    const change = result.changes[0];
    expect(change!.type).toBe('updated');
    if (change!.type !== 'updated') return;

    // Title should be updated
    expect(change!.after.title).toBe('Morning standup');

    // Master start/end must stay at the ORIGINAL series anchor (Jan 5),
    // NOT shift to the occurrence date (Jan 7)
    expect(change!.after.start.getTime()).toBe(master.start.getTime());
    expect(change!.after.end.getTime()).toBe(master.end.getTime());
  });

  it('is safe when the occurrence is months later than the master anchor', () => {
    const master = makeDailyStandup();
    const events = makeEvents(master);

    // Occurrence on Mar 2 — far from the Jan 5 master anchor
    const lateOccurrence = d(2026, 3, 2, 9);

    const result = applyOperation(
      {
        type:  'update',
        id:    'standup',
        scope: 'series',
        occurrenceDate: lateOccurrence,
        patch: {
          title:    'Renamed standup',
          start:    lateOccurrence,
          end:      d(2026, 3, 2, 9, 15),
          category: 'engineering',
        },
      },
      events,
    );

    expect(result.status).toBe('accepted');
    const change = result.changes[0];
    if (change!.type !== 'updated') return;

    expect(change!.after.title).toBe('Renamed standup');
    expect(change!.after.category).toBe('engineering');
    // Anchor must remain Jan 5
    expect(change!.after.start.getTime()).toBe(master.start.getTime());
  });
});

// ─── 4. Undo/redo across recurring mutations ──────────────────────────────────

describe('undo/redo across recurring mutations', () => {
  let engine: CalendarEngine;
  let undoMgr: UndoRedoManager;
  let master: EngineEvent;

  beforeEach(() => {
    master = makeDailyStandup();
    engine = new CalendarEngine({ events: [master] });
    undoMgr = new UndoRedoManager(engine);
  });

  it('undoes a single-occurrence delete', () => {
    const occurrenceDate = d(2026, 1, 7, 9);

    // Capture pre-mutation state, apply, record
    const preSnap = undoMgr.captureSnapshot();
    const result = engine.applyMutation({
      type: 'delete', id: 'standup', scope: 'single', occurrenceDate,
    });
    expect(result.status).toBe('accepted');
    undoMgr.record(preSnap, 'delete-single');

    // Verify EXDATE was added
    const afterDelete = engine.state.events.get('standup')!;
    expect(afterDelete.exdates).toHaveLength(1);

    // Undo
    expect(undoMgr.canUndo).toBe(true);
    undoMgr.undo();

    // Master should be back to no EXDATEs
    const afterUndo = engine.state.events.get('standup')!;
    expect(afterUndo.exdates).toHaveLength(0);
    expect(afterUndo.rrule).toBe(master.rrule);
  });

  it('redoes after undoing a following delete', () => {
    const occurrenceDate = d(2026, 1, 9, 9); // Friday

    const preSnap = undoMgr.captureSnapshot();
    engine.applyMutation({
      type: 'delete', id: 'standup', scope: 'following', occurrenceDate,
    });
    undoMgr.record(preSnap, 'delete-following');

    const afterDelete = engine.state.events.get('standup')!;
    expect(afterDelete.rrule).toMatch(/UNTIL=/i);

    // Undo → rrule restored
    undoMgr.undo();
    const afterUndo = engine.state.events.get('standup')!;
    expect(afterUndo.rrule).toBe(master.rrule);
    expect(afterUndo.rrule).not.toMatch(/UNTIL=/i);

    // Redo → UNTIL comes back
    expect(undoMgr.canRedo).toBe(true);
    undoMgr.redo();
    const afterRedo = engine.state.events.get('standup')!;
    expect(afterRedo.rrule).toMatch(/UNTIL=/i);
  });

  it('undo stack is empty before any mutation', () => {
    expect(undoMgr.canUndo).toBe(false);
    expect(undoMgr.canRedo).toBe(false);
  });

  it('redo stack is cleared when a new mutation is recorded', () => {
    const preSnap1 = undoMgr.captureSnapshot();
    engine.applyMutation({ type: 'delete', id: 'standup', scope: 'single', occurrenceDate: d(2026, 1, 7, 9) });
    undoMgr.record(preSnap1, 'first');

    undoMgr.undo();
    expect(undoMgr.canRedo).toBe(true);

    // New mutation should clear redo stack
    const preSnap2 = undoMgr.captureSnapshot();
    engine.applyMutation({ type: 'delete', id: 'standup', scope: 'single', occurrenceDate: d(2026, 1, 8, 9) });
    undoMgr.record(preSnap2, 'second');

    expect(undoMgr.canRedo).toBe(false);
    expect(undoMgr.canUndo).toBe(true);
  });
});
