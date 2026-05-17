/**
 * Multi-tenancy primitives — issue #218.
 *
 * CalendarEngine itself is tenant-blind: operations succeed regardless of
 * `tenantId`. These pure helpers let hosts enforce tenant scoping around
 * the engine without the engine having to know about tenants directly.
 *
 * Model:
 *   - `EngineEvent.tenantId`, `EngineResource.tenantId`, `Assignment.tenantId`
 *     are all optional. An unset `tenantId` — whether `undefined` or `null`
 *     (as JSON-serialized DB rows often deliver it) — is interpreted as
 *     "global / shared / legacy" and is therefore visible to every tenant.
 *   - `filterByTenant` keeps items whose `tenantId` is null/undefined OR
 *     equal to the `currentTenantId`. Pass `null` for `currentTenantId` to
 *     disable filtering entirely (pre-tenancy behavior).
 *   - `assertSameTenant` is the write-path guard: if both sides carry a
 *     `tenantId` and they differ, the call is rejected.
 *   - `inheritTenantId` stamps `currentTenantId` onto a patch that did
 *     not supply one — cheap default-on-write.
 *
 * All helpers are pure. No engine state is read or mutated.
 */

export interface HasTenantId {
  readonly tenantId?: string | null
}

// ─── Read-path filtering ──────────────────────────────────────────────────

/**
 * Filter an iterable to items visible to `currentTenantId`.
 *
 * Rules:
 *   - `currentTenantId === null` → disable filtering; return every item.
 *   - Item with no `tenantId` (null or undefined) → always visible (global/shared).
 *   - Item with `tenantId === currentTenantId` → visible.
 *   - Otherwise → hidden.
 */
export function filterByTenant<T extends HasTenantId>(
  items: Iterable<T>,
  currentTenantId: string | null,
): T[] {
  if (currentTenantId === null) return Array.from(items)
  const out: T[] = []
  for (const item of items) {
    if (item.tenantId == null) out.push(item)
    else if (item.tenantId === currentTenantId) out.push(item)
  }
  return out
}

/** Map variant: keeps entries whose value is visible to `currentTenantId`. */
export function filterMapByTenant<K, V extends HasTenantId>(
  items: ReadonlyMap<K, V>,
  currentTenantId: string | null,
): Map<K, V> {
  const out = new Map<K, V>()
  if (currentTenantId === null) {
    for (const [k, v] of items) out.set(k, v)
    return out
  }
  for (const [k, v] of items) {
    if (v.tenantId == null || v.tenantId === currentTenantId) out.set(k, v)
  }
  return out
}

/** Single-item visibility check — handy for event-handlers / selectors. */
export function isVisibleToTenant(
  item: HasTenantId,
  currentTenantId: string | null,
): boolean {
  if (currentTenantId === null) return true
  if (item.tenantId == null) return true
  return item.tenantId === currentTenantId
}

// ─── Write-path guards ────────────────────────────────────────────────────

export type TenantMismatchError = {
  readonly code: 'TENANT_MISMATCH'
  readonly message: string
  readonly expected: string
  readonly got: string
}

/**
 * Given two tenant-bearing entities (e.g. event + resource being
 * assigned together), verify they belong to the same tenant or at least
 * one side is global. Returns null when ok, otherwise an error record.
 *
 * Either side's `tenantId` being null/undefined is acceptable — global
 * items cross tenant boundaries by design.
 */
export function assertSameTenant(
  a: HasTenantId,
  b: HasTenantId,
): TenantMismatchError | null {
  if (a.tenantId == null || b.tenantId == null) return null
  if (a.tenantId === b.tenantId) return null
  return {
    code: 'TENANT_MISMATCH',
    message: `Tenant mismatch: ${a.tenantId} vs ${b.tenantId}.`,
    expected: a.tenantId,
    got: b.tenantId,
  }
}

/**
 * Stamp `currentTenantId` onto a patch when the patch doesn't already
 * specify one (null and undefined are both treated as unset, matching the
 * JSON shapes that DB layers commonly emit). `currentTenantId === null`
 * is a no-op (untenanted write).
 */
export function inheritTenantId<T extends HasTenantId>(
  patch: T,
  currentTenantId: string | null,
): T {
  if (currentTenantId === null) return patch
  if (patch.tenantId != null) return patch
  return { ...patch, tenantId: currentTenantId }
}
