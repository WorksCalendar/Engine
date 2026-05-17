/**
 * CalendarEngine — begin a transaction.
 *
 * A transaction is a snapshot of the current event map that can be
 * either committed (applying a batch of changes atomically) or rolled back
 * (restoring the snapshot).
 *
 * This is useful for:
 *   - Optimistic UI (apply changes immediately, roll back on server error)
 *   - Undo/redo (snapshot before each operation)
 *   - Multi-step wizards (accumulate changes before finalizing)
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import type { ResourcePool } from '../../pools/resourcePoolSchema.js';

// ─── Transaction handle ───────────────────────────────────────────────────────

export interface TransactionHandle {
  /** Snapshot of the events map at the time the transaction began. */
  readonly snapshot: ReadonlyMap<string, EngineEvent>;
  /**
   * Snapshot of the pools map (#212). Included so rollback reverts any
   * round-robin cursor advance produced by a mutation — without this,
   * a rolled-back booking would still leave the pool skipped forward.
   * Absent on handles built by callers that predate pool support.
   */
  readonly poolsSnapshot?: ReadonlyMap<string, ResourcePool>;
  /** ISO timestamp when the transaction was opened. */
  readonly openedAt: string;
  /** Optional label for debugging. */
  readonly label?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a transaction handle from the current events map (and pools).
 *
 * @param events  The current events map to snapshot
 * @param labelOrPools  Either the legacy label (string) or an options object
 *                      with pools + label. Overloaded to keep the 2-arg
 *                      callsites compiling without a sweep.
 */
export function beginTransaction(
  events: ReadonlyMap<string, EngineEvent>,
  labelOrPools?: string | { pools?: ReadonlyMap<string, ResourcePool> | undefined; label?: string | undefined },
): TransactionHandle {
  const opts = typeof labelOrPools === 'string'
    ? { label: labelOrPools }
    : labelOrPools ?? {};
  return {
    snapshot:  new Map(events),
    ...(opts.pools ? { poolsSnapshot: new Map(opts.pools) } : {}),
    openedAt:  new Date().toISOString(),
    ...(opts.label !== undefined ? { label: opts.label } : {}),
  };
}
