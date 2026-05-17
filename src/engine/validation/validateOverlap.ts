/**
 * CalendarEngine — overlap validation rule.
 *
 * Checks whether a proposed event time conflicts with an existing event
 * that shares the same resource.
 *
 * Multi-assignment aware:
 *   When ctx.assignments is provided, ALL resources assigned to the event
 *   are checked.  Otherwise falls back to the legacy event.resourceId field.
 *
 * Policy:
 *   - Unscoped events (no resourceId and no assignments) → never flagged
 *   - Resource-scoped events → soft violation on conflict, unless
 *     conflictPolicy is 'block' (hard) or 'allow' (skip).
 */

import type { Violation, OperationContext, ChangeShape } from './validationTypes.js';
import { assignmentsForEvent } from '../schema/assignmentSchema.js';

export function validateOverlap(
  change: ChangeShape,
  ctx: OperationContext,
): Violation | null {
  const events         = ctx.events ?? [];
  const conflictPolicy = ctx.config?.conflictPolicy ?? 'warn';
  if (conflictPolicy === 'allow') return null;

  const selfId = change.event?.id ?? null;

  // Collect all resource IDs for the event being validated.
  let resourceIds: string[] = [];
  if (ctx.assignments && selfId) {
    resourceIds = assignmentsForEvent(ctx.assignments, selfId).map(a => a.resourceId);
  }
  if (resourceIds.length === 0) {
    const rid = change.resourceId ?? change.event?.resourceId ?? null;
    if (rid) resourceIds = [rid];
  }
  if (resourceIds.length === 0) return null; // unscoped — skip

  const severity = conflictPolicy === 'block' ? 'hard' : 'soft';

  for (const resourceId of resourceIds) {
    // Find conflicts: another event that overlaps AND shares this resource.
    const conflict = events.find(ev => {
      if (selfId && ev.id === selfId) return false; // skip self
      if (ev.allDay)                  return false; // all-day events don't block time slots
      // Does ev share this resourceId (via assignments or legacy field)?
      const evResources: string[] = [];
      if (ctx.assignments && ev.id) {
        evResources.push(...assignmentsForEvent(ctx.assignments, ev.id).map(a => a.resourceId));
      }
      if (evResources.length === 0 && ev.resourceId) evResources.push(ev.resourceId);
      if (!evResources.includes(resourceId)) return false;
      // Overlap check
      return change.newStart < ev.end && change.newEnd > ev.start;
    });

    if (conflict) {
      return {
        rule:               'overlap',
        severity,
        message:            `${resourceId} has a conflict with "${conflict.title}".`,
        conflictingEventId: conflict.id,
        details:            { resourceId },
      };
    }
  }

  return null;
}
