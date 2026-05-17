/**
 * CalendarEngine — commit a transaction.
 *
 * Applies a set of EventChanges to the current events map,
 * producing a new immutable map.
 *
 * If validation or persistence fails after calling commit, use
 * rollbackTransaction to restore the snapshot.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import type { EventChange } from '../operations/operationResult.js';
import type { TransactionHandle } from './beginTransaction.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CommitResult {
  readonly events:    ReadonlyMap<string, EngineEvent>;
  readonly applied:   EventChange[];
  readonly skipped:   EventChange[];
}

/**
 * Apply a batch of EventChanges to the events map.
 *
 * Changes are applied in order:
 *   1. created  → insert (silently skip if id already exists)
 *   2. updated  → replace (silently skip if id not found)
 *   3. deleted  → remove (silently skip if id not found)
 *
 * The original snapshot in the TransactionHandle is NOT mutated.
 * Returns a new Map with the changes applied.
 */
export function commitTransaction(
  _tx: TransactionHandle,
  currentEvents: ReadonlyMap<string, EngineEvent>,
  changes: readonly EventChange[],
): CommitResult {
  const next    = new Map(currentEvents);
  const applied: EventChange[] = [];
  const skipped: EventChange[] = [];

  for (const change of changes) {
    switch (change.type) {
      case 'created':
        // Overwrite if id already exists (upsert semantics)
        next.set(change.event.id, change.event);
        applied.push(change);
        break;

      case 'updated':
        if (!next.has(change.id)) {
          skipped.push(change);
        } else {
          next.set(change.id, change.after);
          applied.push(change);
        }
        break;

      case 'deleted':
        if (!next.has(change.id)) {
          skipped.push(change);
        } else {
          next.delete(change.id);
          applied.push(change);
        }
        break;
    }
  }

  return { events: next, applied, skipped };
}
