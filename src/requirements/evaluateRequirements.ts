/**
 * `evaluateRequirements` — runtime consumer for the
 * `CalendarConfig.requirements` templates (issue #386 wizard slice).
 *
 * Pure / sync. Given an event, a requirements template list, and the
 * usual registry + assignment + pool maps, returns whether the event
 * is fully staffed plus a `missing` trail when it isn't.
 *
 * Match key is `event.category` (the engine's existing
 * "what kind of event is this?" field). The wizard / config layer
 * uses `eventType` as the same concept; the trip from one to the
 * other is a string match.
 *
 * Slot semantics:
 *   - `{ role, count }` — at least `count` assignments to this event
 *     must reference resources whose `meta.roles` includes `role`.
 *   - `{ pool, count }` — at least `count` assignments to this event
 *     must reference resources in the pool's effective member set
 *     (manual: memberIds; query: evaluateQuery; hybrid: intersection).
 *
 * Slots are independent — a single assignment can satisfy multiple
 * slots if its resource is tagged with the right role and is also
 * in the named pool. That matches the natural reading of "this
 * event needs a driver and a truck"; an Alice tagged as both is
 * still one body filling both.
 */
import type { EngineEvent } from '../engine/schema/eventSchema.js'
import type { EngineResource } from '../engine/schema/resourceSchema.js'
import type { Assignment } from '../engine/schema/assignmentSchema.js'
import type { ResourcePool } from '../pools/resourcePoolSchema.js'
import type { LatLon } from '../pools/geo.js'
import type {
  ConfigRequirement, ConfigRequirementSlot, ConfigRequirementSeverity,
} from './requirementTypes.js'
import { evaluateQuery } from '../pools/evaluateQuery.js'

export interface EvaluateRequirementsInput {
  /**
   * Minimal event shape — we only need the id (to match assignments)
   * and the category (to match a requirement template). Pass an
   * EngineEvent or a lighter fixture; both work.
   */
  readonly event: Pick<EngineEvent, 'id' | 'category'>
  readonly requirements: readonly ConfigRequirement[]
  readonly resources: ReadonlyMap<string, EngineResource>
  readonly assignments: ReadonlyMap<string, Assignment>
  readonly pools?: ReadonlyMap<string, ResourcePool>
  /**
   * Reference point for query/hybrid pools that use
   * `from: { kind: 'proposed' }`. Typically the event's pickup /
   * origin location. Passing it lets distance-based pools resolve
   * their member set against the event's actual position.
   */
  readonly proposedLocation?: LatLon
}

export type RequirementShortfall =
  | {
      readonly kind: 'role'
      readonly role: string
      readonly required: number
      readonly assigned: number
      readonly missing: number
      /**
       * Mirrors `ConfigRequirementSlot.severity` — defaults to
       * `'hard'` when the slot didn't specify one. Only `hard`
       * shortfalls flip `RequirementsEvaluation.satisfied` to false;
       * `soft` shortfalls stay in `missing[]` for hosts to render
       * as warnings.
       */
      readonly severity: ConfigRequirementSeverity
    }
  | {
      readonly kind: 'pool'
      readonly pool: string
      readonly required: number
      readonly assigned: number
      readonly missing: number
      readonly severity: ConfigRequirementSeverity
      /**
       * `true` when the slot pointed at a pool id that isn't in the
       * `pools` map. The shortfall surfaces with `assigned: 0` so
       * the host can render "pool unknown — fix your config" without
       * special-casing missing keys.
       */
      readonly poolUnknown?: boolean
    }

export interface RequirementsEvaluation {
  readonly satisfied: boolean
  /** Per-slot shortfalls in input order. Empty when satisfied. */
  readonly missing: readonly RequirementShortfall[]
  /**
   * True when no requirement template matched `event.category`.
   * The evaluation reports `satisfied: true` in that case (no
   * template = no requirement to fail), but hosts that want to
   * enforce strict templating use this flag to flag it.
   */
  readonly noTemplate: boolean
}

const SATISFIED_NO_TEMPLATE: RequirementsEvaluation = {
  satisfied: true, missing: [], noTemplate: true,
}

export function evaluateRequirements(
  input: EvaluateRequirementsInput,
): RequirementsEvaluation {
  const { event, requirements, resources, assignments } = input
  const eventType = event.category
  if (eventType == null) return SATISFIED_NO_TEMPLATE

  const template = requirements.find(r => r.eventType === eventType)
  if (!template) return SATISFIED_NO_TEMPLATE

  // Pre-compute the assignments for this event — slot evaluators
  // walk the same set repeatedly so doing it once is the obvious
  // optimization at zero cost.
  const eventAssignments: readonly Assignment[] = (() => {
    const out: Assignment[] = []
    for (const a of assignments.values()) {
      if (a.eventId === event.id) out.push(a)
    }
    return out
  })()

  // Memoize each pool's effective member set — a single requirement
  // may name the same pool twice (e.g. "2 trucks"); evaluating its
  // query each time would be wasteful.
  const poolMemberCache = new Map<string, ReadonlySet<string> | null>()

  const missing: RequirementShortfall[] = []
  for (const slot of template.requires) {
    const shortfall = checkSlot(slot, {
      eventAssignments, resources, pools: input.pools,
      proposedLocation: input.proposedLocation,
      poolMemberCache,
    })
    if (shortfall) missing.push(shortfall)
  }

  // `satisfied` reflects only HARD shortfalls. Soft shortfalls
  // surface in `missing[]` with their severity tag so hosts can
  // render warnings, but they don't fail the evaluation. The empty
  // hard set short-circuits to `true` even when soft shortfalls
  // exist — that's exactly what soft means.
  const satisfied = !missing.some(s => s.severity === 'hard')
  return { satisfied, missing, noTemplate: false }
}

// ─── Internals ──────────────────────────────────────────────────────────────

interface SlotContext {
  readonly eventAssignments: readonly Assignment[]
  readonly resources: ReadonlyMap<string, EngineResource>
  readonly pools?: ReadonlyMap<string, ResourcePool> | undefined
  readonly proposedLocation?: LatLon | undefined
  readonly poolMemberCache: Map<string, ReadonlySet<string> | null>
}

function checkSlot(slot: ConfigRequirementSlot, ctx: SlotContext): RequirementShortfall | null {
  const severity: ConfigRequirementSeverity = slot.severity ?? 'hard'
  if ('role' in slot) {
    const assigned = countRoleAssignments(slot.role, ctx)
    if (assigned >= slot.count) return null
    return {
      kind: 'role', role: slot.role,
      required: slot.count, assigned,
      missing: slot.count - assigned,
      severity,
    }
  }
  // pool slot
  const members = poolMembers(slot.pool, ctx)
  if (members === null) {
    return {
      kind: 'pool', pool: slot.pool,
      required: slot.count, assigned: 0,
      missing: slot.count, severity, poolUnknown: true,
    }
  }
  const assigned = countPoolAssignments(members, ctx)
  if (assigned >= slot.count) return null
  return {
    kind: 'pool', pool: slot.pool,
    required: slot.count, assigned,
    missing: slot.count - assigned,
    severity,
  }
}

function countRoleAssignments(roleId: string, ctx: SlotContext): number {
  let count = 0
  for (const a of ctx.eventAssignments) {
    // Per-assignment "acting as" override wins (#449). When the host
    // pinned the role on this specific assignment, ignore the
    // resource's static meta.roles for slot matching.
    if (a.roleId !== undefined) {
      // Phantom guard: a stale assignment (resource deleted, assignment
      // retained) must not satisfy a slot just because roleId matches.
      // Mirrors the same check in countPoolAssignments.
      if (!ctx.resources.has(a.resourceId)) continue
      if (a.roleId === roleId) count++
      continue
    }
    const r = ctx.resources.get(a.resourceId)
    const roles = (r?.meta?.['roles'] ?? null) as readonly string[] | null
    if (Array.isArray(roles) && roles.includes(roleId)) count++
  }
  return count
}

function countPoolAssignments(members: ReadonlySet<string>, ctx: SlotContext): number {
  let count = 0
  for (const a of ctx.eventAssignments) {
    // Phantom guard: a manual pool's `memberIds` can carry stale ids
    // that point at deleted resources. Without checking the registry,
    // an assignment to a non-existent resource would still match
    // `members.has(...)` (the id is in the pool list) and falsely
    // satisfy a slot. The role path is already safe — it reads the
    // resource's `meta.roles`, which is `undefined` when the resource
    // is gone — but pool counts need an explicit registry check.
    if (!ctx.resources.has(a.resourceId)) continue
    if (members.has(a.resourceId)) count++
  }
  return count
}

function poolMembers(poolId: string, ctx: SlotContext): ReadonlySet<string> | null {
  const cached = ctx.poolMemberCache.get(poolId)
  if (cached !== undefined) return cached
  const pool = ctx.pools?.get(poolId) ?? null
  if (!pool) {
    ctx.poolMemberCache.set(poolId, null)
    return null
  }
  const members = computePoolMembers(pool, ctx)
  ctx.poolMemberCache.set(poolId, members)
  return members
}

function computePoolMembers(pool: ResourcePool, ctx: SlotContext): ReadonlySet<string> {
  const type = pool.type ?? 'manual'
  if (type === 'manual') return new Set(pool.memberIds)
  if (!pool.query) {
    // Misconfigured query/hybrid pool — defensive: treat it as
    // having zero members rather than throwing inside the
    // requirements evaluator. parseConfig drops these at load
    // time; this guard handles directly-passed runtime pools.
    return new Set()
  }
  const queryContext = ctx.proposedLocation
    ? { proposedLocation: ctx.proposedLocation }
    : {}
  // Catch any throw from evaluateQuery — a malformed query (e.g. an
  // empty object that passed parseConfig's loose object check)
  // breaks the documented "never throws" contract otherwise. The
  // safe default is "zero effective members"; the slot will surface
  // as a shortfall, which mirrors how the rest of the evaluator
  // handles broken pools.
  let result
  try {
    result = evaluateQuery(pool.query, ctx.resources, queryContext)
  } catch {
    return new Set()
  }
  if (type === 'query') return new Set(result.matched)
  // hybrid — intersection of memberIds and query result
  const allowed = new Set(result.matched)
  return new Set(pool.memberIds.filter(id => allowed.has(id)))
}
