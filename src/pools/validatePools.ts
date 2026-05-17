/**
 * Pool integrity check (issue #386).
 *
 * The resolver is happy to iterate a pool whose `memberIds` list points
 * at a typo or a since-removed resource — those entries simply produce
 * no overlap, so a `first-available` pool can return a "ghost" id as
 * the winning resource. Hosts that want to surface the drift at admin
 * time (rather than debugging "why does first-available always pick
 * the second member?") run their pools through this helper.
 *
 * Pure and stateless: pass a snapshot, get a report. The resolver also
 * accepts a `strictMembers` flag for the runtime variant — see
 * `resolvePool.ts`.
 */
import type { EngineResource } from '../engine/schema/resourceSchema.js'
import type { ResourcePool } from './resourcePoolSchema.js'

export interface PoolIntegrityIssue {
  /** Pool the issue is rooted in. */
  readonly poolId: string
  /** Member id that is not present in the resource registry. */
  readonly memberId: string
}

export interface PoolIntegrityReport {
  /** True iff every member of every pool is present in `resources`. */
  readonly ok: boolean
  /**
   * Pool ids whose membership is fully recognized. Useful for hosts
   * that want to render a green check next to clean pools.
   */
  readonly cleanPoolIds: readonly string[]
  /**
   * One entry per (pool, unknown member) pair. A pool with two unknown
   * members yields two issues, in declared member order. Disabled
   * pools are still reported so admins can fix them before re-enabling.
   */
  readonly issues: readonly PoolIntegrityIssue[]
}

export function validatePools(
  pools: ReadonlyMap<string, ResourcePool> | readonly ResourcePool[],
  resources: ReadonlyMap<string, EngineResource> | readonly EngineResource[],
): PoolIntegrityReport {
  const knownIds: ReadonlySet<string> = resources instanceof Map
    ? new Set(resources.keys())
    : new Set((resources as readonly EngineResource[]).map(r => r.id))

  const poolList: readonly ResourcePool[] = pools instanceof Map
    ? Array.from((pools as ReadonlyMap<string, ResourcePool>).values())
    : (pools as readonly ResourcePool[])

  const issues: PoolIntegrityIssue[] = []
  const cleanPoolIds: string[] = []

  for (const pool of poolList) {
    let dirty = false
    for (const memberId of pool.memberIds) {
      if (!knownIds.has(memberId)) {
        issues.push({ poolId: pool.id, memberId })
        dirty = true
      }
    }
    if (!dirty) cleanPoolIds.push(pool.id)
  }

  return { ok: issues.length === 0, cleanPoolIds, issues }
}
