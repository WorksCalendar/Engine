/**
 * Resource query evaluator (issue #386 v2 pools).
 *
 * Pure function — given a `ResourceQuery` and a set of resources,
 * returns the matching ids plus an `excluded` trail with the first
 * failed clause path per resource. The exclusion trail is the
 * "readiness explainability" hook the issue calls out: hosts can
 * render "1 too far · 1 capacity too low · 2 available" without
 * re-running the query themselves.
 *
 * Path resolution (`path` field of every leaf clause):
 *   - top-level `EngineResource` keys: `id`, `name`, `tenantId`,
 *     `capacity`, `color`, `timezone`,
 *   - anything else: read from `meta` via dot-path
 *     (e.g. `capabilities.refrigerated` reads
 *     `resource.meta.capabilities.refrigerated`).
 *
 * Comparators on a missing path always return false. `exists` is the
 * only clause that surfaces presence; everything else is "value
 * matches".
 */
import type { EngineResource } from '../engine/schema/resourceSchema.js'
import type { ResourceQuery, ResourceQueryValue } from './poolQuerySchema.js'
import type { LatLon } from './geo.js'
import { haversineKm, haversineMiles, isLatLon } from './geo.js'

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'id', 'name', 'tenantId', 'capacity', 'color', 'timezone',
])

/**
 * Optional evaluation context. Currently used only by `within` clauses
 * with `from: { kind: 'proposed' }` — the resolver passes through the
 * proposed event's location so a single saved query can match against
 * "wherever this event is happening" rather than baking in a literal.
 */
export interface QueryContext {
  readonly proposedLocation?: LatLon
}

export interface QueryExclusion {
  readonly id: string
  /**
   * The first leaf clause that failed for this resource, expressed
   * as `op(path)` — e.g. `gte(capabilities.capacity_lbs)`. For
   * boolean composites, the failing inner clause is reported.
   */
  readonly reason: string
}

export interface QueryEvaluation {
  /** Resource ids that satisfy the entire query, in input order. */
  readonly matched: readonly string[]
  /** Per-resource exclusion trail. Order mirrors input. */
  readonly excluded: readonly QueryExclusion[]
}

export function evaluateQuery(
  query: ResourceQuery,
  resources:
    | readonly EngineResource[]
    | ReadonlyMap<string, EngineResource>,
  context: QueryContext = {},
): QueryEvaluation {
  const list: readonly EngineResource[] = resources instanceof Map
    ? Array.from(resources.values())
    : (resources as readonly EngineResource[])

  const matched: string[] = []
  const excluded: QueryExclusion[] = []

  for (const r of list) {
    const reason = firstFailingPath(query, r, context)
    if (reason === null) matched.push(r.id)
    else excluded.push({ id: r.id, reason })
  }

  return { matched, excluded }
}

// ─── Internals ────────────────────────────────────────────────────────────

/**
 * Walks the query tree against one resource. Returns `null` when the
 * resource matches; otherwise returns a short descriptor of the first
 * leaf clause that failed (used as the `reason` field in the excluded
 * trail).
 */
function firstFailingPath(query: ResourceQuery, r: EngineResource, ctx: QueryContext): string | null {
  switch (query.op) {
    case 'and': {
      for (const c of query.clauses) {
        const f = firstFailingPath(c, r, ctx)
        if (f !== null) return f
      }
      return null
    }
    case 'or': {
      if (query.clauses.length === 0) return 'or()'
      let lastReason: string | null = null
      for (const c of query.clauses) {
        const f = firstFailingPath(c, r, ctx)
        if (f === null) return null
        lastReason = f
      }
      return lastReason
    }
    case 'not': {
      const f = firstFailingPath(query.clause, r, ctx)
      return f === null ? `not(${describe(query.clause)})` : null
    }
    default: {
      return matchLeaf(query, r, ctx) ? null : describe(query)
    }
  }
}

function matchLeaf(q: Exclude<ResourceQuery, { op: 'and' | 'or' | 'not' }>, r: EngineResource, ctx: QueryContext): boolean {
  if (q.op === 'within') return matchWithin(q, r, ctx)
  const v = readPath(r, q.path)
  switch (q.op) {
    case 'exists': return v !== undefined
    case 'eq':     return sameValue(v, q.value)
    case 'neq':    return !sameValue(v, q.value)
    case 'in':     return q.values.some(x => sameValue(v, x))
    case 'gt':     return typeof v === 'number' && Number.isFinite(v) && v >  q.value
    case 'gte':    return typeof v === 'number' && Number.isFinite(v) && v >= q.value
    case 'lt':     return typeof v === 'number' && Number.isFinite(v) && v <  q.value
    case 'lte':    return typeof v === 'number' && Number.isFinite(v) && v <= q.value
  }
}

function matchWithin(
  q: Extract<ResourceQuery, { op: 'within' }>,
  r: EngineResource,
  ctx: QueryContext,
): boolean {
  // Resolve the reference point first so a misconfigured query
  // ("from: proposed" without a context) fails-closed instead of
  // throwing in the middle of a per-resource loop.
  const from: LatLon | null = q.from.kind === 'point'
    ? q.from
    : ctx.proposedLocation ?? null
  if (!from) return false
  const here = readPath(r, q.path)
  if (!isLatLon(here)) return false
  // Exactly one of miles / km drives the comparison. If both / neither
  // are set the query is malformed; fail-closed.
  if ((q.miles == null) === (q.km == null)) return false
  if (q.miles != null) return haversineMiles(here, from) <= q.miles
  if (q.km    != null) return haversineKm(here, from)    <= q.km
  return false
}

function sameValue(actual: unknown, expected: ResourceQueryValue): boolean {
  if (expected === null) return actual === null
  return actual === expected
}

function readPath(r: EngineResource, path: string): unknown {
  if (TOP_LEVEL_KEYS.has(path)) {
    return (r as unknown as Record<string, unknown>)[path]
  }
  // Walk `meta.foo.bar.baz`. The leading `meta.` is optional; bare
  // `capabilities.x` is interpreted as `meta.capabilities.x`.
  const segments = path.startsWith('meta.')
    ? path.slice(5).split('.')
    : path.split('.')
  let cursor: unknown = r.meta
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[seg]
  }
  return cursor
}

function describe(q: ResourceQuery): string {
  switch (q.op) {
    case 'and':    return 'and(...)'
    case 'or':     return 'or(...)'
    case 'not':    return `not(${describe(q.clause)})`
    case 'exists': return `exists(${q.path})`
    case 'in':     return `in(${q.path})`
    case 'within': {
      const unit = q.miles != null ? `${q.miles}mi` : q.km != null ? `${q.km}km` : '?'
      return `within(${q.path}, ${unit})`
    }
    default:       return `${q.op}(${q.path})`
  }
}
