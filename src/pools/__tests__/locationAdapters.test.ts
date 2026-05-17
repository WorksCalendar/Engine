/**
 * ResourceLocationAdapter contract + baseline adapters (issue #386).
 */
import { describe, it, expect } from 'vitest'
import {
  attachLocations,
  createStaticLocationAdapter,
  createMetaPathLocationAdapter,
  type ResourceLocationAdapter,
} from '../locationAdapters.js'
import type { EngineResource } from '../../engine/schema/resourceSchema.js'

const r = (id: string, meta: Record<string, unknown> = {}): EngineResource => ({
  id, name: id.toUpperCase(), meta,
} as EngineResource)

describe('attachLocations', () => {
  it('writes meta.location for resources whose adapter resolves a coordinate', () => {
    const resources = [r('a'), r('b')]
    const adapter: ResourceLocationAdapter = {
      id: 'test',
      resolve: (res) => res.id === 'a' ? { lat: 40, lon: -111 } : null,
    }
    const result = attachLocations(resources, [adapter])
    expect((result[0]!.meta as Record<string, unknown>).location).toEqual({ lat: 40, lon: -111 })
    expect((result[1]!.meta as Record<string, unknown>).location).toBeUndefined()
  })

  it('preserves existing meta.location — manual config wins over automated sources', () => {
    const resources = [r('a', { location: { lat: 99, lon: 99 } })]
    const adapter: ResourceLocationAdapter = {
      id: 'overwrite',
      resolve: () => ({ lat: 0, lon: 0 }),
    }
    const result = attachLocations(resources, [adapter])
    expect((result[0]!.meta as Record<string, unknown>).location).toEqual({ lat: 99, lon: 99 })
  })

  it('uses the first adapter that resolves a non-null coordinate', () => {
    const adapterA: ResourceLocationAdapter = { id: 'A', resolve: () => null }
    const adapterB: ResourceLocationAdapter = { id: 'B', resolve: () => ({ lat: 1, lon: 1 }) }
    const adapterC: ResourceLocationAdapter = { id: 'C', resolve: () => ({ lat: 2, lon: 2 }) }
    const result = attachLocations([r('x')], [adapterA, adapterB, adapterC])
    expect((result[0]!.meta as Record<string, unknown>).location).toEqual({ lat: 1, lon: 1 })
  })

  it('returns the input untouched when no adapters are passed', () => {
    const resources = [r('a'), r('b')]
    expect(attachLocations(resources, [])).toBe(resources)
  })

  it('does not mutate the input resources', () => {
    const resources = [r('a')]
    const before = JSON.parse(JSON.stringify(resources))
    attachLocations(resources, [createStaticLocationAdapter({ a: { lat: 1, lon: 2 } })])
    expect(resources).toEqual(before)
  })
})

describe('createStaticLocationAdapter', () => {
  it('resolves coordinates from a host-provided id table', () => {
    const adapter = createStaticLocationAdapter({
      'truck-1': { lat: 40, lon: -111 },
    })
    const resolved = adapter.resolve(r('truck-1'))
    expect(resolved).toEqual({ lat: 40, lon: -111 })
  })

  it('returns null for ids absent from the table', () => {
    const adapter = createStaticLocationAdapter({})
    expect(adapter.resolve(r('truck-1'))).toBeNull()
  })

  it('passes through extra fields (altitude, heading, etc.)', () => {
    const adapter = createStaticLocationAdapter({
      'plane-1': { lat: 40, lon: -111, altitude: 35000, heading: 280 } as Record<string, unknown>,
    })
    const resolved = adapter.resolve(r('plane-1'))
    expect(resolved).toMatchObject({ lat: 40, lon: -111, altitude: 35000, heading: 280 })
  })
})

describe('attachLocations — resource with no meta property', () => {
  it('attaches location when resource.meta is undefined', () => {
    const bare = { id: 'x', name: 'X' } as unknown as import('../../engine/schema/resourceSchema.js').EngineResource
    const adapter: ResourceLocationAdapter = { id: 'static', resolve: () => ({ lat: 10, lon: 20 }) }
    const result = attachLocations([bare], [adapter])
    expect((result[0]!.meta as Record<string, unknown>).location).toEqual({ lat: 10, lon: 20 })
  })
})

describe('createMetaPathLocationAdapter', () => {
  it('reads coordinates from a path that does not start with meta.', () => {
    const adapter = createMetaPathLocationAdapter('depot')
    const resolved = adapter.resolve(r('truck-1', { depot: { lat: 40, lon: -111 } }))
    expect(resolved).toEqual({ lat: 40, lon: -111 })
  })

  it('reads coordinates from a non-default meta path', () => {
    const adapter = createMetaPathLocationAdapter('meta.depot')
    const resolved = adapter.resolve(r('truck-1', { depot: { lat: 40, lon: -111 } }))
    expect(resolved).toEqual({ lat: 40, lon: -111 })
  })

  it('returns null when the path is missing or malformed', () => {
    const adapter = createMetaPathLocationAdapter('meta.depot')
    expect(adapter.resolve(r('a'))).toBeNull()
    expect(adapter.resolve(r('a', { depot: 'string' }))).toBeNull()
    expect(adapter.resolve(r('a', { depot: { lat: 'x' } }))).toBeNull()
  })

  it('walks nested paths', () => {
    const adapter = createMetaPathLocationAdapter('meta.fleet.homeBase')
    const resolved = adapter.resolve(
      r('truck-1', { fleet: { homeBase: { lat: 40, lon: -111 } } })
    )
    expect(resolved).toEqual({ lat: 40, lon: -111 })
  })
})
