/**
 * Regression tests for recurring-event move and resize mutations.
 *
 * Covers all scope × operation combinations:
 *   move   × single / following / series
 *   resize × single / following / series
 *
 * Also verifies undo/redo stability across these operations.
 *
 * All tests operate at the engine layer — no React, no rendering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyOperation } from '../operations/applyOperation.js';
import { CalendarEngine } from '../CalendarEngine.js';
import { UndoRedoManager } from '../UndoRedoManager.js';
import { makeEvent } from '../schema/eventSchema.js';
import type { EngineEvent } from '../schema/eventSchema.js';

// ─── Shared fixture ───────────────────────────────────────────────────────────

function d(y: number, mo: number, day: number, h = 9, m = 0): Date {
  return new Date(y, mo - 1, day, h, m, 0, 0);
}

/** Weekly Monday standup 09:00–09:30, anchored 2026-01-05 */
function makeWeeklyStandup(): EngineEvent {
  return makeEvent('standup', {
    title:    'Weekly standup',
    start:    d(2026, 1, 5, 9, 0),   // Mon Jan 5
    end:      d(2026, 1, 5, 9, 30),
    rrule:    'FREQ=WEEKLY;BYDAY=MO',
    seriesId: 'standup',
  });
}

function makeEvents(ev: EngineEvent): Map<string, EngineEvent> {
  return new Map([[ev.id, ev]]);
}

// ─── move — single occurrence ─────────────────────────────────────────────────

describe('move — single occurrence', () => {
  it('adds an EXDATE to the master and creates a detached event at the new time', () => {
    const master = makeWeeklyStandup();
    const events = makeEvents(master);

    // Move Jan 12 occurrence to Jan 12 at 10:00–10:30
    const occurrenceDate = d(2026, 1, 12, 9, 0);

    const result = applyOperation(
      {
        type:  'move',
        id:    'standup',
        scope: 'single',
        occurrenceDate,
        newStart: d(2026, 1, 12, 10, 0),
        newEnd:   d(2026, 1, 12, 10, 30),
      },
      events,
    );

    expect(result.status).toBe('accepted');

    // Exactly two changes: master updated (EXDATE) + detached created
    expect(result.changes).toHaveLength(2);

    const updated = result.changes.find(c => c.type === 'updated');
    const created = result.changes.find(c => c.type === 'created');
    expect(updated).toBeDefined();
    expect(created).toBeDefined();
    if (!updated || updated.type !== 'updated') return;
    if (!created || created.type !== 'created') return;

    // Master gets the EXDATE for the original occurrence
    expect(updated.after.exdates).toHaveLength(1);
    expect(updated.after.exdates[0].getTime!()).toBe(occurrenceDate.getTime());
    // Master rrule is unchanged
    expect(updated.after.rrule).toBe(master.rrule);

    // Detached event is at the new time
    expect(created.event.start.getTime()).toBe(d(2026, 1, 12, 10, 0).getTime());
    expect(created.event.end.getTime()).toBe(d(2026, 1, 12, 10, 30).getTime());

    // Detached event is traceable to the original series
    expect(created.event.seriesId).toBe(master.id);
    expect(created.event.detachedFrom).toBe(master.id);
    // It does NOT inherit the rrule — it is a one-off
    expect(created.event.rrule).toBeNull();
  });

  it('preserves master start/end anchors after a single-occurrence move', () => {
    const master = makeWeeklyStandup();
    const result = applyOperation(
      {
        type:  'move',
        id:    'standup',
        scope: 'single',
        occurrenceDate: d(2026, 1, 12, 9, 0),
        newStart: d(2026, 1, 12, 11, 0),
        newEnd:   d(2026, 1, 12, 11, 30),
      },
      makeEvents(master),
    );

    const updated = result.changes.find(c => c.type === 'updated');
    if (!updated || updated.type !== 'updated') return;

    // Master's original anchor is untouched
    expect(updated.after.start.getTime()).toBe(master.start.getTime());
    expect(updated.after.end.getTime()).toBe(master.end.getTime());
  });
});

// ─── move — following (this and future) ──────────────────────────────────────

describe('move — following occurrence', () => {
  it('terminates original series with UNTIL and creates a new shifted series', () => {
    const master = makeWeeklyStandup();
    const events = makeEvents(master);

    // Move Jan 19 and all following by 1 hour
    const occurrenceDate = d(2026, 1, 19, 9, 0);

    const result = applyOperation(
      {
        type:  'move',
        id:    'standup',
        scope: 'following',
        occurrenceDate,
        newStart: d(2026, 1, 19, 10, 0),
        newEnd:   d(2026, 1, 19, 10, 30),
      },
      events,
    );

    expect(result.status).toBe('accepted');
    expect(result.changes).toHaveLength(2);

    const updated = result.changes.find(c => c.type === 'updated');
    const created = result.changes.find(c => c.type === 'created');
    if (!updated || updated.type !== 'updated') return;
    if (!created || created.type !== 'created') return;

    // Original series is terminated before this occurrence
    expect(updated.after.rrule).toMatch(/UNTIL=/i);
    // No EXDATEs should be added (UNTIL handles termination)
    expect(updated.after.exdates).toHaveLength(0);

    // New series starts at the shifted time
    expect(created.event.start.getTime()).toBe(d(2026, 1, 19, 10, 0).getTime());
    expect(created.event.end.getTime()).toBe(d(2026, 1, 19, 10, 30).getTime());

    // New series inherits the same RRULE (frequency/byday) but NOT UNTIL
    expect(created.event.rrule).toBe(master.rrule);
    expect(created.event.seriesId).toBe(created.event.id); // self-referencing new series
  });

  it('original master start/end are preserved after following-split', () => {
    const master = makeWeeklyStandup();
    const result = applyOperation(
      {
        type: 'move', id: 'standup', scope: 'following',
        occurrenceDate: d(2026, 1, 19, 9, 0),
        newStart: d(2026, 1, 19, 10, 0),
        newEnd:   d(2026, 1, 19, 10, 30),
      },
      makeEvents(master),
    );

    const updated = result.changes.find(c => c.type === 'updated');
    if (!updated || updated.type !== 'updated') return;
    expect(updated.after.start.getTime()).toBe(master.start.getTime());
    expect(updated.after.end.getTime()).toBe(master.end.getTime());
  });

  it('does NOT delete the master event', () => {
    const master = makeWeeklyStandup();
    const result = applyOperation(
      {
        type: 'move', id: 'standup', scope: 'following',
        occurrenceDate: d(2026, 1, 19, 9, 0),
        newStart: d(2026, 1, 19, 10, 0),
        newEnd:   d(2026, 1, 19, 10, 30),
      },
      makeEvents(master),
    );
    expect(result.changes.filter(c => c.type === 'deleted')).toHaveLength(0);
  });
});

// ─── move — series-wide ───────────────────────────────────────────────────────

describe('move — series-wide', () => {
  it('updates master start/end directly (shifts all occurrences)', () => {
    const master = makeWeeklyStandup();

    // Move entire series to 10:00–10:30 (no scope or scope=series)
    const result = applyOperation(
      {
        type:     'move',
        id:       'standup',
        newStart: d(2026, 1, 5, 10, 0),
        newEnd:   d(2026, 1, 5, 10, 30),
      },
      makeEvents(master),
    );

    expect(result.status).toBe('accepted');
    expect(result.changes).toHaveLength(1);

    const change = result.changes[0];
    expect(change!.type).toBe('updated');
    if (change!.type !== 'updated') return;

    expect(change!.after.start.getTime()).toBe(d(2026, 1, 5, 10, 0).getTime());
    expect(change!.after.end.getTime()).toBe(d(2026, 1, 5, 10, 30).getTime());
    // rrule is unchanged
    expect(change!.after.rrule).toBe(master.rrule);
    // No new events
    expect(result.changes.filter(c => c.type === 'created')).toHaveLength(0);
  });

  it('scope=series also updates master directly', () => {
    const master = makeWeeklyStandup();

    const result = applyOperation(
      {
        type:  'move',
        id:    'standup',
        scope: 'series',
        occurrenceDate: d(2026, 1, 12, 9, 0),
        newStart: d(2026, 1, 5, 10, 0),
        newEnd:   d(2026, 1, 5, 10, 30),
      },
      makeEvents(master),
    );

    const change = result.changes[0];
    expect(change!.type).toBe('updated');
    if (change!.type !== 'updated') return;
    expect(change!.after.start.getTime()).toBe(d(2026, 1, 5, 10, 0).getTime());
    expect(result.changes).toHaveLength(1);
  });
});

// ─── resize — single occurrence ──────────────────────────────────────────────

describe('resize — single occurrence', () => {
  it('detaches the occurrence and extends its end time', () => {
    const master = makeWeeklyStandup();

    const occurrenceDate = d(2026, 1, 5, 9, 0); // First occurrence = master anchor

    const result = applyOperation(
      {
        type:  'resize',
        id:    'standup',
        scope: 'single',
        occurrenceDate,
        // Extend from 09:30 to 10:00 (same start)
        newStart: d(2026, 1, 5, 9, 0),
        newEnd:   d(2026, 1, 5, 10, 0),
      },
      makeEvents(master),
    );

    expect(result.status).toBe('accepted');
    // Same structure as move: EXDATE on master + detached event
    expect(result.changes).toHaveLength(2);

    const created = result.changes.find(c => c.type === 'created');
    if (!created || created.type !== 'created') return;
    expect(created.event.end.getTime()).toBe(d(2026, 1, 5, 10, 0).getTime());
    expect(created.event.rrule).toBeNull();
  });

  it('master rrule is unchanged after single-occurrence resize', () => {
    const master = makeWeeklyStandup();
    const result = applyOperation(
      {
        type:  'resize', id: 'standup', scope: 'single',
        occurrenceDate: d(2026, 1, 5, 9, 0),
        newStart: d(2026, 1, 5, 9, 0),
        newEnd:   d(2026, 1, 5, 10, 0),
      },
      makeEvents(master),
    );
    const updated = result.changes.find(c => c.type === 'updated');
    if (!updated || updated.type !== 'updated') return;
    expect(updated.after.rrule).toBe(master.rrule);
  });
});

// ─── resize — following ───────────────────────────────────────────────────────

describe('resize — following', () => {
  it('terminates original series and creates a new series with extended duration', () => {
    const master = makeWeeklyStandup();

    const occurrenceDate = d(2026, 2, 2, 9, 0); // Feb 2

    const result = applyOperation(
      {
        type:  'resize',
        id:    'standup',
        scope: 'following',
        occurrenceDate,
        // Extend to 10:00 from here onward
        newStart: d(2026, 2, 2, 9, 0),
        newEnd:   d(2026, 2, 2, 10, 0),
      },
      makeEvents(master),
    );

    expect(result.status).toBe('accepted');
    expect(result.changes).toHaveLength(2);

    const updated = result.changes.find(c => c.type === 'updated');
    const created = result.changes.find(c => c.type === 'created');
    if (!updated || updated.type !== 'updated') return;
    if (!created || created.type !== 'created') return;

    // Original terminates before Feb 2
    expect(updated.after.rrule).toMatch(/UNTIL=/i);

    // New series has the extended duration
    expect(created.event.end.getTime()).toBe(d(2026, 2, 2, 10, 0).getTime());
    expect(created.event.rrule).toBe(master.rrule); // same recurrence
  });
});

// ─── resize — series-wide ────────────────────────────────────────────────────

describe('resize — series-wide', () => {
  it('updates master end directly', () => {
    const master = makeWeeklyStandup();

    const result = applyOperation(
      {
        type:     'resize',
        id:       'standup',
        newStart: d(2026, 1, 5, 9, 0),
        newEnd:   d(2026, 1, 5, 11, 0),
      },
      makeEvents(master),
    );

    expect(result.status).toBe('accepted');
    expect(result.changes).toHaveLength(1);

    const change = result.changes[0];
    if (change!.type !== 'updated') return;
    expect(change!.after.end.getTime()).toBe(d(2026, 1, 5, 11, 0).getTime());
    // rrule unchanged
    expect(change!.after.rrule).toBe(master.rrule);
  });
});

// ─── Anchor-shift regression ──────────────────────────────────────────────────

describe('anchor-shift regression', () => {
  // Regression: operating on a later occurrence must NOT shift the master
  // anchor to that occurrence's date when scope=following or scope=single.

  it('move(following) from a later occurrence does not shift master start', () => {
    const master = makeWeeklyStandup(); // anchored Jan 5
    const events = makeEvents(master);

    // Move from Oct 5 occurrence forward
    const lateOccurrence = d(2026, 10, 5, 9, 0);

    const result = applyOperation(
      {
        type:  'move', id: 'standup', scope: 'following',
        occurrenceDate: lateOccurrence,
        newStart: d(2026, 10, 5, 10, 0),
        newEnd:   d(2026, 10, 5, 10, 30),
      },
      events,
    );

    const updated = result.changes.find(c => c.type === 'updated');
    if (!updated || updated.type !== 'updated') return;

    // Master anchor stays at Jan 5 — NOT shifted to Oct 5
    expect(updated.after.start.getTime()).toBe(master.start.getTime());
  });

  it('resize(single) from a later occurrence does not shift master start', () => {
    const master = makeWeeklyStandup();

    const lateOccurrence = d(2026, 6, 15, 9, 0);

    const result = applyOperation(
      {
        type:  'resize', id: 'standup', scope: 'single',
        occurrenceDate: lateOccurrence,
        newStart: d(2026, 6, 15, 9, 0),
        newEnd:   d(2026, 6, 15, 10, 0),
      },
      makeEvents(master),
    );

    const updated = result.changes.find(c => c.type === 'updated');
    if (!updated || updated.type !== 'updated') return;
    expect(updated.after.start.getTime()).toBe(master.start.getTime());
  });
});

// ─── Undo/redo for move + resize ─────────────────────────────────────────────

describe('undo/redo — move single occurrence', () => {
  let engine: CalendarEngine;
  let undoMgr: UndoRedoManager;
  let master: EngineEvent;

  beforeEach(() => {
    master = makeWeeklyStandup();
    engine = new CalendarEngine({ events: [master] });
    undoMgr = new UndoRedoManager(engine);
  });

  it('undoes a single-occurrence move (restores EXDATE removal + destroys detached)', () => {
    const preSnap = undoMgr.captureSnapshot();
    engine.applyMutation({
      type: 'move', id: 'standup', scope: 'single',
      occurrenceDate: d(2026, 1, 12, 9, 0),
      newStart: d(2026, 1, 12, 10, 0),
      newEnd:   d(2026, 1, 12, 10, 30),
    });
    undoMgr.record(preSnap, 'move-single');

    // Verify detached event was created
    expect(engine.state.events.size).toBe(2);
    const standup = engine.state.events.get('standup')!;
    expect(standup.exdates).toHaveLength(1);

    // Undo
    undoMgr.undo();

    // Back to only the master, no EXDATE
    expect(engine.state.events.size).toBe(1);
    const restoredMaster = engine.state.events.get('standup')!;
    expect(restoredMaster.exdates).toHaveLength(0);
    expect(restoredMaster.rrule).toBe(master.rrule);
  });

  it('redoes a single-occurrence move after undo', () => {
    const preSnap = undoMgr.captureSnapshot();
    engine.applyMutation({
      type: 'move', id: 'standup', scope: 'single',
      occurrenceDate: d(2026, 1, 12, 9, 0),
      newStart: d(2026, 1, 12, 10, 0),
      newEnd:   d(2026, 1, 12, 10, 30),
    });
    undoMgr.record(preSnap, 'move-single');

    undoMgr.undo();
    expect(engine.state.events.size).toBe(1);

    undoMgr.redo();
    expect(engine.state.events.size).toBe(2);
    const standup = engine.state.events.get('standup')!;
    expect(standup.exdates).toHaveLength(1);
  });
});

describe('undo/redo — move following', () => {
  let engine: CalendarEngine;
  let undoMgr: UndoRedoManager;
  let master: EngineEvent;

  beforeEach(() => {
    master = makeWeeklyStandup();
    engine = new CalendarEngine({ events: [master] });
    undoMgr = new UndoRedoManager(engine);
  });

  it('undoes a following-scope move (restores UNTIL removal + destroys new series)', () => {
    const preSnap = undoMgr.captureSnapshot();
    engine.applyMutation({
      type: 'move', id: 'standup', scope: 'following',
      occurrenceDate: d(2026, 1, 19, 9, 0),
      newStart: d(2026, 1, 19, 10, 0),
      newEnd:   d(2026, 1, 19, 10, 30),
    });
    undoMgr.record(preSnap, 'move-following');

    // Two events after: original (with UNTIL) + new series
    expect(engine.state.events.size).toBe(2);
    const original = engine.state.events.get('standup')!;
    expect(original.rrule).toMatch(/UNTIL=/i);

    undoMgr.undo();

    // Restored to single series with no UNTIL
    expect(engine.state.events.size).toBe(1);
    const restored = engine.state.events.get('standup')!;
    expect(restored.rrule).toBe(master.rrule);
    expect(restored.rrule).not.toMatch(/UNTIL=/i);
  });
});

describe('undo/redo — series-wide resize', () => {
  let engine: CalendarEngine;
  let undoMgr: UndoRedoManager;
  let master: EngineEvent;

  beforeEach(() => {
    master = makeWeeklyStandup();
    engine = new CalendarEngine({ events: [master] });
    undoMgr = new UndoRedoManager(engine);
  });

  it('undoes a series-wide resize (restores original end time)', () => {
    const preSnap = undoMgr.captureSnapshot();
    engine.applyMutation({
      type:     'resize',
      id:       'standup',
      newStart: d(2026, 1, 5, 9, 0),
      newEnd:   d(2026, 1, 5, 11, 0),
    });
    undoMgr.record(preSnap, 'resize-series');

    const resized = engine.state.events.get('standup')!;
    expect(resized.end.getTime()).toBe(d(2026, 1, 5, 11, 0).getTime());

    undoMgr.undo();

    const restored = engine.state.events.get('standup')!;
    expect(restored.end.getTime()).toBe(master.end.getTime());
  });
});
