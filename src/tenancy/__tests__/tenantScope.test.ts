/**
 * tenantScope — unit specs (issue #218).
 *
 * Pins the read-path filtering + write-path guard contracts so hosts
 * can rely on the "unset tenantId = global" semantics.
 */
import { describe, it, expect } from 'vitest'
import {
  filterByTenant,
  filterMapByTenant,
  isVisibleToTenant,
  assertSameTenant,
  inheritTenantId,
} from '../tenantScope.js'

describe('filterByTenant', () => {
  const items = [
    { id: 'a', tenantId: 'red' },
    { id: 'b', tenantId: 'blue' },
    { id: 'c' }, // global/legacy
    { id: 'd', tenantId: 'red' },
  ]

  it('keeps red items + global when tenant=red', () => {
    const out = filterByTenant(items, 'red').map(i => i.id)
    expect(out).toEqual(['a', 'c', 'd'])
  })

  it('keeps only global items when tenant has no matches', () => {
    const out = filterByTenant(items, 'green').map(i => i.id)
    expect(out).toEqual(['c'])
  })

  it('treats tenantId=null as global (JSON-serialized unset)', () => {
    const withNullUnset = [
      { id: 'a', tenantId: 'red' },
      { id: 'b', tenantId: null },
      { id: 'c', tenantId: 'blue' },
    ]
    const out = filterByTenant(withNullUnset, 'red').map(i => i.id)
    expect(out).toEqual(['a', 'b'])
  })

  it('returns every item when currentTenantId is null', () => {
    const out = filterByTenant(items, null).map(i => i.id)
    expect(out).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns a fresh array (does not mutate input)', () => {
    const out = filterByTenant(items, 'red')
    expect(out).not.toBe(items)
  })
})

describe('filterMapByTenant', () => {
  const map = new Map<string, { id: string; tenantId?: string }>([
    ['a', { id: 'a', tenantId: 'red' }],
    ['b', { id: 'b', tenantId: 'blue' }],
    ['c', { id: 'c' }],
  ])

  it('returns a Map of visible entries', () => {
    const out = filterMapByTenant(map, 'red')
    expect([...out.keys()]).toEqual(['a', 'c'])
  })

  it('returns a full copy when currentTenantId is null', () => {
    const out = filterMapByTenant(map, null)
    expect(out.size).toBe(3)
    expect(out).not.toBe(map)
  })
})

describe('isVisibleToTenant', () => {
  it('is true when tenant matches', () => {
    expect(isVisibleToTenant({ tenantId: 'red' }, 'red')).toBe(true)
  })

  it('is true for global items regardless of tenant', () => {
    expect(isVisibleToTenant({}, 'red')).toBe(true)
  })

  it('is false for cross-tenant items', () => {
    expect(isVisibleToTenant({ tenantId: 'red' }, 'blue')).toBe(false)
  })

  it('is true for everything when currentTenantId is null', () => {
    expect(isVisibleToTenant({ tenantId: 'red' }, null)).toBe(true)
  })

  it('treats an item with tenantId=null as global', () => {
    expect(isVisibleToTenant({ tenantId: null }, 'red')).toBe(true)
  })
})

describe('assertSameTenant', () => {
  it('returns null when both sides match', () => {
    expect(assertSameTenant({ tenantId: 'red' }, { tenantId: 'red' })).toBeNull()
  })

  it('returns null when either side is global', () => {
    expect(assertSameTenant({ tenantId: 'red' }, {})).toBeNull()
    expect(assertSameTenant({}, { tenantId: 'red' })).toBeNull()
    expect(assertSameTenant({}, {})).toBeNull()
  })

  it('treats tenantId=null as global on either side', () => {
    expect(assertSameTenant({ tenantId: 'red' }, { tenantId: null })).toBeNull()
    expect(assertSameTenant({ tenantId: null }, { tenantId: 'red' })).toBeNull()
  })

  it('returns a TENANT_MISMATCH error when the tenants differ', () => {
    const err = assertSameTenant({ tenantId: 'red' }, { tenantId: 'blue' })
    expect(err).toMatchObject({
      code: 'TENANT_MISMATCH',
      expected: 'red',
      got: 'blue',
    })
    expect(err?.message).toContain('red')
    expect(err?.message).toContain('blue')
  })
})

describe('inheritTenantId', () => {
  type Patch = { id: string; tenantId?: string | null }

  it('stamps currentTenantId when patch has none', () => {
    const out = inheritTenantId<Patch>({ id: 'x' }, 'red')
    expect(out).toMatchObject({ id: 'x', tenantId: 'red' })
  })

  it('stamps currentTenantId when patch has tenantId=null', () => {
    const out = inheritTenantId<Patch>({ id: 'x', tenantId: null }, 'red')
    expect(out.tenantId).toBe('red')
  })

  it('leaves patch untouched when tenantId is already set', () => {
    const out = inheritTenantId<Patch>({ id: 'x', tenantId: 'blue' }, 'red')
    expect(out.tenantId).toBe('blue')
  })

  it('is a no-op when currentTenantId is null', () => {
    const input: Patch = { id: 'x' }
    const out = inheritTenantId(input, null)
    expect(out).toBe(input)
  })

  it('does not mutate the input object', () => {
    const input: Patch = { id: 'x' }
    inheritTenantId(input, 'red')
    expect(input.tenantId).toBeUndefined()
  })
})
