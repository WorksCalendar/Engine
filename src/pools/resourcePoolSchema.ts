/**
 * Resource pool schema — issue #212.
 *
 * A `ResourcePool` is a virtual grouping of concrete resources ("any
 * available driver", "any meeting room ≥ 8 seats"). Bookings target the
 * pool id; at submit time the resolver picks one concrete member using
 * the configured strategy.
 *
 * Three pool types (#386 v2):
 *   - `manual`  — static `memberIds` list (default; v1 behavior).
 *   - `query`   — candidates are computed at resolve-time by evaluating
 *                 `query` against the live `EngineResource` registry.
 *                 `memberIds` is ignored.
 *   - `hybrid`  — intersection: the candidate set is `memberIds` filtered
 *                 by `query`. Useful for "any of these specific assets,
 *                 but only the ones currently certified for cold-chain".
 *
 * Only the schema lives here. The resolver — which reads conflicts /
 * assignments to pick a member — lives in `resolvePool.ts`. The query
 * evaluator lives in `evaluateQuery.ts`.
 */

import type { ResourceQuery } from './poolQuerySchema.js'

export type PoolStrategy =
  | 'first-available'
  | 'least-loaded'
  | 'round-robin'
  /**
   * Picks the candidate with the smallest great-circle distance to
   * `ResolvePoolInput.proposedLocation`. Throws when the input lacks a
   * `proposedLocation` — the strategy has no meaning without one.
   * Resources without a usable `meta.location` (or whatever path the
   * pool's query targeted) sort to the back so they're tried last.
   */
  | 'closest'

export type PoolType = 'manual' | 'query' | 'hybrid'

export interface ResourcePool {
  readonly id: string
  readonly name: string
  /**
   * Pool type. Defaults to `manual` when omitted, preserving v1
   * behavior for existing pools.
   */
  readonly type?: PoolType
  /**
   * Ordered ids of concrete `EngineResource`s in the pool. For
   * `manual` pools, drives `first-available` and `round-robin`;
   * `least-loaded` re-sorts by workload. For `hybrid` pools, the
   * starting set that `query` filters. Ignored for `query` pools.
   */
  readonly memberIds: readonly string[]
  /**
   * Resource query evaluated against the live registry at resolve
   * time. Required for `type: 'query'` and `type: 'hybrid'`; ignored
   * for `manual`.
   */
  readonly query?: ResourceQuery
  readonly strategy: PoolStrategy
  /**
   * Optional cursor persisted by the host for round-robin. Monotonic;
   * the resolver returns an updated cursor on each resolve so the host
   * can persist it back.
   */
  readonly rrCursor?: number
  /** Disabled pools stay in history but can't be selected for new bookings. */
  readonly disabled?: boolean
}
