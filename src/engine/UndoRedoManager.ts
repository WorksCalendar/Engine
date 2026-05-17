/**
 * CalendarEngine — UndoRedoManager
 *
 * Maintains an undo/redo history for full engine structural state
 * (events + assignments + dependencies + resourceCalendars).
 *
 * Usage:
 *   const manager = new UndoRedoManager(engine, { maxSize: 50 });
 *
 *   // Before a mutation that should be undoable:
 *   manager.push('move');
 *   engine.applyMutation(...);
 *
 *   // User hits Ctrl+Z:
 *   manager.undo();   // engine state restored, subscribers notified
 *
 *   // User hits Ctrl+Y:
 *   manager.redo();
 */

import type { CalendarEngine } from './CalendarEngine.js';
import type { EngineEvent }    from './schema/eventSchema.js';
import type { Assignment }     from './schema/assignmentSchema.js';
import type { Dependency }     from './schema/dependencySchema.js';
import type { ResourceCalendar } from './schema/resourceCalendarSchema.js';
import type { ResourcePool }   from '../pools/resourcePoolSchema.js';

// ─── Snapshot type ────────────────────────────────────────────────────────────

/** Full structural snapshot of engine state (excludes view/cursor/filter). */
export interface EngineSnapshot {
  readonly events:            ReadonlyMap<string, EngineEvent>;
  readonly assignments:       ReadonlyMap<string, Assignment>;
  readonly dependencies:      ReadonlyMap<string, Dependency>;
  readonly resourceCalendars: ReadonlyMap<string, ResourceCalendar>;
  /**
   * Resource pools (#212). Included so undo of a pool-resolved booking
   * also reverts any round-robin cursor advance — otherwise the pool
   * drifts and the next booking skips the member the undone booking
   * was assigned to.
   */
  readonly pools:             ReadonlyMap<string, ResourcePool>;
}

export interface HistoryEntry {
  readonly label?: string | undefined;
  readonly snapshot: EngineSnapshot;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface UndoRedoOptions {
  /** Maximum number of undo steps to keep (default: 50). */
  readonly maxSize?: number;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

export class UndoRedoManager {
  private _undo: HistoryEntry[] = [];
  private _redo: HistoryEntry[] = [];
  private readonly _maxSize: number;

  constructor(
    private readonly _engine: CalendarEngine,
    options: UndoRedoOptions = {},
  ) {
    this._maxSize = options.maxSize ?? 50;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get canUndo(): boolean { return this._undo.length > 0; }
  get canRedo(): boolean { return this._redo.length > 0; }

  /** Labels of the undo/redo stacks, most-recent first (for UI display). */
  get undoLabels(): readonly string[] {
    return [...this._undo].reverse().map(e => e.label ?? 'action');
  }
  get redoLabels(): readonly string[] {
    return [...this._redo].reverse().map(e => e.label ?? 'action');
  }

  /**
   * Capture the CURRENT engine state as an undoable checkpoint.
   *
   * Call this BEFORE applying a mutation so that undo restores the
   * pre-mutation state.
   *
   * @param label  Human-readable description used for debugging / UI hints.
   */
  push(label?: string): void {
    this.record(this._capture(), label);
  }

  /**
   * Return a snapshot of the current engine state WITHOUT pushing it onto
   * the undo stack.  Use when you need to pre-capture state before a
   * mutation but only push it to history once you know the mutation
   * succeeded (to avoid polluting the stack with rejected operations).
   *
   * Pair with record():
   *   const snap = manager.captureSnapshot();
   *   const result = engine.applyMutation(...);
   *   if (result.status === 'accepted') manager.record(snap, 'move');
   */
  captureSnapshot(): EngineSnapshot {
    return this._capture();
  }

  /**
   * Push an explicitly pre-captured snapshot onto the undo stack.
   * Clears the redo stack (a new recorded action voids the redo history).
   */
  record(snapshot: EngineSnapshot, label?: string): void {
    this._undo.push({ label, snapshot });
    if (this._undo.length > this._maxSize) this._undo.shift();
    // Any new recorded action clears the redo branch.
    this._redo = [];
  }

  /**
   * Restore the previous checkpoint.
   * @returns true if an undo was performed; false when the stack is empty.
   */
  undo(): boolean {
    const entry = this._undo.pop();
    if (!entry) return false;
    // Save current state on the redo stack before overwriting it.
    this._redo.push({ label: entry.label, snapshot: this._capture() });
    this._restore(entry.snapshot);
    return true;
  }

  /**
   * Re-apply the last undone change.
   * @returns true if a redo was performed; false when the stack is empty.
   */
  redo(): boolean {
    const entry = this._redo.pop();
    if (!entry) return false;
    this._undo.push({ label: entry.label, snapshot: this._capture() });
    this._restore(entry.snapshot);
    return true;
  }

  /**
   * Clear all history (call after a full data reload to avoid stale entries).
   */
  clear(): void {
    this._undo = [];
    this._redo = [];
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  private _capture(): EngineSnapshot {
    const s = this._engine.state;
    return {
      events:            new Map(s.events),
      assignments:       new Map(s.assignments),
      dependencies:      new Map(s.dependencies),
      resourceCalendars: new Map(s.resourceCalendars),
      pools:             new Map(s.pools),
    };
  }

  private _restore(snapshot: EngineSnapshot): void {
    this._engine.restoreState(snapshot);
  }
}
