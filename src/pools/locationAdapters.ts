/**
 * Resource location adapters (issue #386 v2 distance).
 *
 * A small plugin contract for getting a `{ lat, lon }` onto each
 * `EngineResource` before the resolver runs. Hosts compose adapters
 * for whatever data sources they have — manual config, a static
 * lookup table, an external position registry like the
 * [`asset-tracker`](https://github.com/natehorst240-sketch/Map_Idea)
 * library — and call `attachLocations(resources, adapters)` at
 * registry-build time.
 *
 * The contract is intentionally minimal: a single `resolve` method
 * returning lat/lon (or null when not known). Adapters that have
 * extra signal — heading, altitude, speed, timestamp — return it via
 * `meta` and `attachLocations` writes the merged record into
 * `resource.meta.location`. The convention preserves Map_Idea's flat
 * schema so a one-line bridge works both ways.
 */
import type { EngineResource } from '../engine/schema/resourceSchema.js'
import type { LatLon } from './geo.js'

/**
 * The shape `attachLocations` writes into `resource.meta.location`.
 * Required `lat` / `lon`; everything else is optional and forwarded
 * untouched. A host that uses only manual config will see just
 * `{ lat, lon }`; one wired into `asset-tracker` will see the full
 * normalized position record.
 */
export interface ResourceLocation extends LatLon {
  readonly altitude?: number | null
  readonly heading?: number | null
  readonly speed?: number | null
  readonly timestamp?: number
  readonly source?: string
  readonly meta?: Readonly<Record<string, unknown>>
}

export interface ResourceLocationAdapter {
  /** Stable id used in logs / debugging. */
  readonly id: string
  /**
   * Return a coordinate for the given resource, or `null` when the
   * adapter has no opinion. Pure / sync — adapters that require a
   * fetch should be primed (e.g. by polling the upstream registry)
   * before being passed to `attachLocations`.
   */
  resolve(resource: EngineResource): ResourceLocation | null
}

/**
 * Walk every resource and pin the first non-null `resolve` result
 * onto `meta.location`. Adapters earlier in the array win. Resources
 * that already carry `meta.location` are left untouched so a manual
 * override always wins over an automated source.
 *
 * Pure: returns a new array; the input is unchanged.
 */
export function attachLocations(
  resources: readonly EngineResource[],
  adapters: readonly ResourceLocationAdapter[],
): readonly EngineResource[] {
  if (adapters.length === 0) return resources
  return resources.map(r => {
    const existing = (r.meta as Record<string, unknown> | undefined)?.['location']
    if (existing) return r
    for (const adapter of adapters) {
      const loc = adapter.resolve(r)
      if (loc) {
        return {
          ...r,
          meta: { ...(r.meta ?? {}), location: loc },
        }
      }
    }
    return r
  })
}

// ─── Built-in adapters ────────────────────────────────────────────────────

/**
 * Static id → coordinates map, useful for fixtures, demos, and hosts
 * whose lat/lon comes from a config file rather than a live feed.
 *
 *   const adapter = createStaticLocationAdapter({
 *     'truck-101': { lat: 40.76, lon: -111.89 },
 *     'truck-202': { lat: 39.74, lon: -104.99 },
 *   });
 */
export function createStaticLocationAdapter(
  table: Readonly<Record<string, ResourceLocation | LatLon>>,
  id = 'static',
): ResourceLocationAdapter {
  return {
    id,
    resolve(r) {
      const hit = table[r.id]
      return hit ? toResourceLocation(hit) : null
    },
  }
}

/**
 * Reads coordinates from a non-default meta path on the resource —
 * useful when your registry stores them at e.g. `meta.depot` or
 * `meta.homeBase` and you don't want to duplicate them under
 * `meta.location`.
 */
export function createMetaPathLocationAdapter(
  path: string,
  id = `meta:${path}`,
): ResourceLocationAdapter {
  const segments = path.startsWith('meta.')
    ? path.slice(5).split('.')
    : path.split('.')
  return {
    id,
    resolve(r) {
      let cursor: unknown = r.meta
      for (const seg of segments) {
        if (cursor == null || typeof cursor !== 'object') return null
        cursor = (cursor as Record<string, unknown>)[seg]
      }
      return isCandidateLocation(cursor) ? toResourceLocation(cursor) : null
    },
  }
}

// ─── Internals ────────────────────────────────────────────────────────────

function isCandidateLocation(v: unknown): v is ResourceLocation | LatLon {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return Number.isFinite(o['lat']) && Number.isFinite(o['lon'])
}

function toResourceLocation(v: ResourceLocation | LatLon): ResourceLocation {
  // Both shapes are accepted — narrow to the richer ResourceLocation
  // by spreading; missing optionals stay undefined.
  return { ...(v as ResourceLocation) }
}
