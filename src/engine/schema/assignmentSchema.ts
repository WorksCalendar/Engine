/**
 * CalendarEngine — Assignment schema.
 *
 * An Assignment joins one Event to one Resource.
 * A single event may have many assignments (multi-resource scheduling).
 * A resource may appear in many assignments.
 *
 * This is the same many-to-many join entity used by Bryntum Scheduler Pro
 * and the iCal ATTENDEE model.
 *
 * Backward-compat note: EngineEvent.resourceId is still supported for
 * single-resource use.  When assignments exist for an event they take
 * precedence over resourceId for display and conflict checking.
 */

export interface Assignment {
  /** Stable unique identifier. */
  readonly id: string;
  readonly eventId: string;
  readonly resourceId: string;
  /**
   * Allocation percentage, 0–100.  Defaults to 100 (fully assigned).
   * Used for workload / over-allocation computation.
   * 50 = half-time, 200 = double-booked on this resource.
   */
  readonly units: number;
  /**
   * Opaque tenant/workspace identifier (issue #218). Optional; unset =
   * inherits the tenant of the joined event/resource.
   */
  readonly tenantId?: string;
  /**
   * "Acting as" role override for this specific event (#449).
   *
   * When set, the requirements engine uses this id as the role the
   * assignment fulfills, ignoring the resource's static
   * `meta.roles` for the slot match. Lets a person who's both a
   * driver and a dispatcher be booked as one role on Monday and
   * the other on Tuesday without re-tagging the underlying
   * resource.
   *
   * When unset, role membership falls back to the resource's
   * static `meta.roles: string[]` — the v1 contract — so existing
   * assignments behave exactly as before.
   */
  readonly roleId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal valid Assignment. */
export function makeAssignment(
  id: string,
  patch: Pick<Assignment, 'eventId' | 'resourceId'> & Partial<Omit<Assignment, 'id'>>,
): Assignment {
  return {
    id,
    units: 100,
    ...patch,
  };
}

/**
 * Return all assignments for a given event from an assignments map.
 * Returns [] when the event has no explicit assignments.
 */
export function assignmentsForEvent(
  assignments: ReadonlyMap<string, Assignment>,
  eventId: string,
): Assignment[] {
  const result: Assignment[] = [];
  for (const a of assignments.values()) {
    if (a.eventId === eventId) result.push(a);
  }
  return result;
}

/**
 * Return all resource IDs assigned to an event.
 * Falls back to [resourceId] when the event has no explicit assignments
 * and resourceId is provided (backward-compat path).
 */
export function resourceIdsForEvent(
  assignments: ReadonlyMap<string, Assignment>,
  eventId: string,
  fallbackResourceId?: string | null,
): readonly string[] {
  const direct = assignmentsForEvent(assignments, eventId).map(a => a.resourceId);
  if (direct.length > 0) return direct;
  return fallbackResourceId ? [fallbackResourceId] : [];
}

/** Total allocated units for a resource across all events in a time window. */
export function workloadForResource(
  assignments: ReadonlyMap<string, Assignment>,
  resourceId: string,
): number {
  let total = 0;
  for (const a of assignments.values()) {
    if (a.resourceId === resourceId) total += a.units;
  }
  return total;
}
