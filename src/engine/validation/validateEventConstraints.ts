/**
 * CalendarEngine — event scheduling constraint validation rule.
 *
 * Checks that the proposed new [start, end] satisfies all constraints
 * attached to the event (EngineEvent.constraints[]).
 *
 * Severity per constraint type:
 *   must-start-on / must-end-on → hard (blocks commit)
 *   snet / snlt / enet / enlt   → soft (warning, user may override)
 *   asap / alap                 → not validated here (scheduler hints only)
 */

import type { Violation, OperationContext, ChangeShape } from './validationTypes.js';
import {
  satisfiesConstraint,
  constraintSeverity,
  describeConstraint,
} from '../schema/constraintSchema.js';

export function validateEventConstraints(
  change: ChangeShape,
  ctx: OperationContext,
): Violation | null {
  const ev = change.event;
  if (!ev) return null;

  // Constraints live on the EngineEvent — look them up from the event list
  // (change.event may be the old state; constraints don't change during move/resize).
  const events    = ctx.events ?? [];
  const canonical = events.find(e => e.id === ev.id) ?? ev;
  const constraints = (canonical as { constraints?: readonly import('../schema/constraintSchema.js').EventConstraint[] }).constraints;

  if (!constraints || constraints.length === 0) return null;

  for (const c of constraints) {
    if (c.type === 'asap' || c.type === 'alap') continue; // scheduling hints, not hard rules
    if (!satisfiesConstraint(c, change.newStart, change.newEnd)) {
      return {
        rule:     'event-constraint',
        severity: constraintSeverity(c),
        message:  `Event constraint violated: ${describeConstraint(c)}.`,
        details:  { constraintType: c.type, constraintDate: c.date?.toISOString() },
      };
    }
  }

  return null;
}
