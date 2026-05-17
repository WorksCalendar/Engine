/**
 * CalendarEngine — rollback a transaction.
 *
 * Restores the events map (and, when the handle carries one, the pools
 * map) to the snapshot captured by beginTransaction.
 * Pure function — returns fresh copies of the snapshotted maps.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import type { ResourcePool } from '../../pools/resourcePoolSchema.js';
import type { TransactionHandle } from './beginTransaction.js';

export interface RollbackResult {
  readonly events: ReadonlyMap<string, EngineEvent>;
  /**
   * Only present when the handle was opened with a pools snapshot
   * (#212). Callers that predate pool support will receive undefined
   * here and should leave their pools map untouched.
   */
  readonly pools?: ReadonlyMap<string, ResourcePool>;
}

/**
 * Discard any changes made since the transaction was opened and return
 * the snapshotted maps.
 *
 * @param tx  The transaction handle returned by beginTransaction
 * @returns   The original maps (fresh copies)
 */
export function rollbackTransaction(tx: TransactionHandle): RollbackResult {
  return {
    events: new Map(tx.snapshot),
    ...(tx.poolsSnapshot ? { pools: new Map(tx.poolsSnapshot) } : {}),
  };
}
