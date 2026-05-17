/**
 * ResourceQuery — typed DSL for v2 resource pools (issue #386).
 *
 * Pools today are static lists of `memberIds`. v2 pools can additionally
 * (or exclusively) describe "what kind of resource I need" as a query
 * the resolver evaluates against the live `EngineResource` registry.
 *
 * The DSL is intentionally narrow and structural — no string parsing,
 * no expression language. Hosts compose plain objects; the evaluator
 * walks them. The `path` field accepts:
 *
 *   - top-level `EngineResource` keys: `id`, `name`, `tenantId`,
 *     `capacity`, `color`, `timezone`,
 *   - `meta.<dot.path>` for arbitrary host-defined attributes.
 *
 * Filterable types: string, number, boolean, null. The `within`
 * op layers on great-circle distance against `{ lat, lon }` data —
 * see `geo.ts` for the math and `evaluateQuery.ts` for the optional
 * `context.proposedLocation` hook used by `from: { kind: 'proposed' }`.
 */

export type ResourceQueryValue = string | number | boolean | null

/**
 * Reference for the "from" point of a `within` distance clause.
 *  - `point`     literal coordinates baked into the query
 *  - `proposed`  resolves to the proposed event's location at
 *                evaluation time (passed via `context.proposedLocation`).
 *                Useful for "within 50 miles of the load's origin"
 *                without re-building the query per submit.
 */
export type DistanceFrom =
  | { readonly kind: 'point';    readonly lat: number; readonly lon: number }
  | { readonly kind: 'proposed' }

/**
 * Distance / units configuration for `within`.
 * Exactly one of `miles` / `km` must be set.
 */
export interface WithinDistance {
  readonly miles?: number
  readonly km?: number
}

export type ResourceQuery =
  /** Strict equality after path resolution. Missing path → false. */
  | { readonly op: 'eq';     readonly path: string; readonly value: ResourceQueryValue }
  /** Strict inequality. Missing path is treated as "not equal". */
  | { readonly op: 'neq';    readonly path: string; readonly value: ResourceQueryValue }
  /** Path resolves to one of the listed values. Missing path → false. */
  | { readonly op: 'in';     readonly path: string; readonly values: readonly ResourceQueryValue[] }
  /** Numeric `>`. Path must resolve to a finite number; otherwise false. */
  | { readonly op: 'gt';     readonly path: string; readonly value: number }
  /** Numeric `>=`. Path must resolve to a finite number; otherwise false. */
  | { readonly op: 'gte';    readonly path: string; readonly value: number }
  /** Numeric `<`. Path must resolve to a finite number; otherwise false. */
  | { readonly op: 'lt';     readonly path: string; readonly value: number }
  /** Numeric `<=`. Path must resolve to a finite number; otherwise false. */
  | { readonly op: 'lte';    readonly path: string; readonly value: number }
  /** Path resolves to anything other than `undefined`. */
  | { readonly op: 'exists'; readonly path: string }
  /**
   * Great-circle distance filter. `path` resolves to `{ lat, lon }`
   * on the resource (typically `meta.location` by convention but any
   * meta path works). `from` supplies the reference point — either a
   * literal or `{ kind: 'proposed' }` to defer to context. Resources
   * with a missing or malformed coordinate fail the clause.
   */
  | { readonly op: 'within'; readonly path: string; readonly from: DistanceFrom; readonly miles?: number; readonly km?: number }
  /** Logical AND. Empty clauses → true (vacuously). */
  | { readonly op: 'and';    readonly clauses: readonly ResourceQuery[] }
  /** Logical OR. Empty clauses → false. */
  | { readonly op: 'or';     readonly clauses: readonly ResourceQuery[] }
  /** Logical NOT. */
  | { readonly op: 'not';    readonly clause: ResourceQuery }
