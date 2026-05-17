/**
 * CalendarEngine — dependency validation rule.
 *
 * When moving or resizing an event that has predecessors or successors,
 * checks that the proposed new times don't violate those dependency links.
 *
 * Predecessor check (this event is the SUCCESSOR):
 *   A predecessor's link constrains when THIS event may start/end.
 *   e.g. finish-to-start: this event must start after predecessor ends + lag.
 *
 * Successor check (this event is the PREDECESSOR):
 *   A successor's link constrains the successor — moving THIS event earlier/later
 *   might drag the successor into violation.  We emit a soft warning to let the
 *   scheduler know the successor needs to be rescheduled.
 */

import type { Violation, OperationContext, ChangeShape } from './validationTypes.js';
import {
  isDependencyViolated,
  successorsOf,
  predecessorsOf,
  wouldCreateCycle,
} from '../schema/dependencySchema.js';

export function validateDependencies(
  change: ChangeShape,
  ctx: OperationContext,
): Violation | null {
  const deps    = ctx.dependencies;
  const events  = ctx.events ?? [];
  if (!deps || deps.size === 0) return null;

  const selfId = change.event?.id;
  if (!selfId) return null;

  // ── Predecessor constraints on THIS event ─────────────────────────────────
  // If any predecessor requires this event to start/end no earlier than X,
  // and our proposed [newStart, newEnd] violates that, it's a hard violation
  // (you'd be breaking the schedule's logic).
  for (const dep of predecessorsOf(deps, selfId)) {
    const predecessor = events.find(e => e.id === dep.fromEventId);
    if (!predecessor) continue;

    const violated = isDependencyViolated(
      dep,
      predecessor.start,
      predecessor.end,
      change.newStart,
      change.newEnd,
    );
    if (violated) {
      return {
        rule:               'dependency-predecessor',
        severity:           'hard',
        message:            `This event must respect the "${dep.type}" link from "${predecessor.title}".`,
        conflictingEventId: predecessor.id,
        details:            { dependencyId: dep.id, dependencyType: dep.type, lagMs: dep.lagMs },
      };
    }
  }

  // ── Successor warnings ────────────────────────────────────────────────────
  // Moving this event (as a predecessor) may strand its successors.
  // Soft warning so the user knows to check the linked events.
  for (const dep of successorsOf(deps, selfId)) {
    const successor = events.find(e => e.id === dep.toEventId);
    if (!successor) continue;

    const violated = isDependencyViolated(
      dep,
      change.newStart,
      change.newEnd,
      successor.start,
      successor.end,
    );
    if (violated) {
      return {
        rule:               'dependency-successor',
        severity:           'soft',
        message:            `Moving this event may break the "${dep.type}" link to "${successor.title}". Reschedule that event too.`,
        conflictingEventId: successor.id,
        details:            { dependencyId: dep.id, dependencyType: dep.type, lagMs: dep.lagMs },
      };
    }
  }

  return null;
}

/**
 * Validate that adding a new dependency would not create a cycle.
 * Returns a hard Violation if a cycle is detected, null otherwise.
 */
export function validateNoCycle(
  fromEventId: string,
  toEventId: string,
  existingDeps: OperationContext['dependencies'],
): Violation | null {
  if (!existingDeps) return null;
  if (wouldCreateCycle(existingDeps, fromEventId, toEventId)) {
    return {
      rule:     'dependency-cycle',
      severity: 'hard',
      message:  'Adding this dependency would create a circular chain.',
    };
  }
  return null;
}
