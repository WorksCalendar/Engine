/**
 * validatePools — admin-time integrity check (issue #386 item #12).
 *
 * Surfaces (poolId, memberId) pairs whose member is not in the
 * resource registry, so hosts can warn before the resolver silently
 * commits a typo'd id as the winning resource.
 */
import { describe, it, expect } from 'vitest'
import { validatePools } from '../validatePools.js'
import type { ResourcePool } from '../resourcePoolSchema.js'
import type { EngineResource } from '../../engine/schema/resourceSchema.js'

const knownArr: EngineResource[] = [
  { id: 'r1', label: 'R1' } as unknown as EngineResource,
  { id: 'r2', label: 'R2' } as unknown as EngineResource,
]
const knownMap = new Map(knownArr.map(r => [r.id, r]))

const pool = (patch: Partial<ResourcePool> & Pick<ResourcePool, 'id' | 'memberIds'>): ResourcePool => ({
  name:     patch.id.toUpperCase(),
  strategy: 'first-available',
  ...patch,
})

describe('validatePools', () => {
  it('reports ok when every member is known', () => {
    const report = validatePools([pool({ id: 'p', memberIds: ['r1', 'r2'] })], knownMap)
    expect(report.ok).toBe(true)
    expect(report.cleanPoolIds).toEqual(['p'])
    expect(report.issues).toEqual([])
  })

  it('flags unknown member ids in declared order', () => {
    const pools = [
      pool({ id: 'fleet', memberIds: ['r1', 'ghost', 'r2', 'also-gone'] }),
      pool({ id: 'clean', memberIds: ['r2'] }),
    ]
    const report = validatePools(pools, knownMap)
    expect(report.ok).toBe(false)
    expect(report.cleanPoolIds).toEqual(['clean'])
    expect(report.issues).toEqual([
      { poolId: 'fleet', memberId: 'ghost' },
      { poolId: 'fleet', memberId: 'also-gone' },
    ])
  })

  it('still reports disabled pools so admins can clean them before re-enabling', () => {
    const pools = [pool({ id: 'retired', memberIds: ['gone'], disabled: true })]
    const report = validatePools(pools, knownMap)
    expect(report.ok).toBe(false)
    expect(report.issues).toEqual([{ poolId: 'retired', memberId: 'gone' }])
  })

  it('accepts a Map of pools and an array of resources interchangeably', () => {
    const map = new Map<string, ResourcePool>([
      ['p', pool({ id: 'p', memberIds: ['r1', 'ghost'] })],
    ])
    const report = validatePools(map, knownArr)
    expect(report.issues).toEqual([{ poolId: 'p', memberId: 'ghost' }])
  })

  it('reports clean and ok=true when given empty inputs', () => {
    const report = validatePools([], knownMap)
    expect(report).toEqual({ ok: true, cleanPoolIds: [], issues: [] })
  })
})
