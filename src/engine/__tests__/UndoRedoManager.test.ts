import { describe, it, expect, vi } from 'vitest';
import { UndoRedoManager } from '../UndoRedoManager.js';
import type { CalendarEngine } from '../CalendarEngine.js';
import type { EngineSnapshot } from '../UndoRedoManager.js';

// ─── Minimal CalendarEngine mock ──────────────────────────────────────────────

function makeEngine(initialSnapshot: Partial<EngineSnapshot> = {}): {
  engine: CalendarEngine;
  getRestoredSnapshot: () => EngineSnapshot | null;
} {
  let state: EngineSnapshot = {
    events:            new Map(),
    assignments:       new Map(),
    dependencies:      new Map(),
    resourceCalendars: new Map(),
    pools:             new Map(),
    ...initialSnapshot,
  };
  let restoredSnapshot: EngineSnapshot | null = null;

  const engine = {
    get state() {
      return { ...state, filter: { search: '', categories: new Set(), resources: new Set() }, view: 'month', cursor: new Date(), config: {}, selection: new Set() };
    },
    restoreState(snap: EngineSnapshot) {
      state = snap;
      restoredSnapshot = snap;
    },
  } as unknown as CalendarEngine;

  return { engine, getRestoredSnapshot: () => restoredSnapshot };
}

// ─── canUndo / canRedo ────────────────────────────────────────────────────────

describe('UndoRedoManager — initial state', () => {
  it('canUndo is false initially', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    expect(m.canUndo).toBe(false);
  });

  it('canRedo is false initially', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    expect(m.canRedo).toBe(false);
  });

  it('undoLabels is empty initially', () => {
    const { engine } = makeEngine();
    expect(new UndoRedoManager(engine).undoLabels).toEqual([]);
  });

  it('redoLabels is empty initially', () => {
    const { engine } = makeEngine();
    expect(new UndoRedoManager(engine).redoLabels).toEqual([]);
  });
});

// ─── push / canUndo ──────────────────────────────────────────────────────────

describe('push', () => {
  it('canUndo becomes true after push', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('move');
    expect(m.canUndo).toBe(true);
  });

  it('undoLabels contains the pushed label (most-recent first)', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('first');
    m.push('second');
    expect(m.undoLabels[0]).toBe('second');
    expect(m.undoLabels[1]).toBe('first');
  });

  it('push with no label defaults to "action" in labels', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push();
    expect(m.undoLabels[0]).toBe('action');
  });

  it('push clears the redo stack', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('first');
    m.undo();
    expect(m.canRedo).toBe(true);
    m.push('new-action');
    expect(m.canRedo).toBe(false);
  });
});

// ─── undo ─────────────────────────────────────────────────────────────────────

describe('undo', () => {
  it('returns false when nothing to undo', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    expect(m.undo()).toBe(false);
  });

  it('returns true when undo succeeds', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('move');
    expect(m.undo()).toBe(true);
  });

  it('calls restoreState with the pushed snapshot', () => {
    const { engine, getRestoredSnapshot } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('move');
    m.undo();
    expect(getRestoredSnapshot()).not.toBeNull();
  });

  it('canUndo becomes false after undoing the only entry', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('move');
    m.undo();
    expect(m.canUndo).toBe(false);
  });

  it('canRedo becomes true after undo', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('move');
    m.undo();
    expect(m.canRedo).toBe(true);
  });
});

// ─── redo ─────────────────────────────────────────────────────────────────────

describe('redo', () => {
  it('returns false when nothing to redo', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    expect(m.redo()).toBe(false);
  });

  it('returns true when redo succeeds', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('move');
    m.undo();
    expect(m.redo()).toBe(true);
  });

  it('canRedo becomes false after redoing the only entry', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('move');
    m.undo();
    m.redo();
    expect(m.canRedo).toBe(false);
  });

  it('canUndo is true after redo', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('move');
    m.undo();
    m.redo();
    expect(m.canUndo).toBe(true);
  });

  it('multiple undo then redo restores forward state', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('a');
    m.push('b');
    m.push('c');
    m.undo();
    m.undo();
    m.redo();
    expect(m.redoLabels.length).toBe(1);
    expect(m.undoLabels.length).toBe(2);
  });
});

// ─── captureSnapshot / record ─────────────────────────────────────────────────

describe('captureSnapshot / record', () => {
  it('captureSnapshot returns a snapshot without pushing to undo stack', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    const snap = m.captureSnapshot();
    expect(snap).toBeDefined();
    expect(m.canUndo).toBe(false);
  });

  it('record pushes snapshot to undo stack', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    const snap = m.captureSnapshot();
    m.record(snap, 'manual');
    expect(m.canUndo).toBe(true);
    expect(m.undoLabels[0]).toBe('manual');
  });

  it('record clears redo stack', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('a');
    m.undo();
    expect(m.canRedo).toBe(true);
    m.record(m.captureSnapshot(), 'b');
    expect(m.canRedo).toBe(false);
  });
});

// ─── clear ────────────────────────────────────────────────────────────────────

describe('clear', () => {
  it('clears undo and redo stacks', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine);
    m.push('a');
    m.push('b');
    m.undo();
    m.clear();
    expect(m.canUndo).toBe(false);
    expect(m.canRedo).toBe(false);
  });
});

// ─── maxSize ──────────────────────────────────────────────────────────────────

describe('maxSize', () => {
  it('truncates undo stack when maxSize is exceeded', () => {
    const { engine } = makeEngine();
    const m = new UndoRedoManager(engine, { maxSize: 3 });
    m.push('a');
    m.push('b');
    m.push('c');
    m.push('d'); // should evict 'a'
    expect(m.undoLabels).toHaveLength(3);
    // Most-recent is 'd', oldest kept is 'b'
    expect(m.undoLabels[0]).toBe('d');
    expect(m.undoLabels[2]).toBe('b');
  });
});
