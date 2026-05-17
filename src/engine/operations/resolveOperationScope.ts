/**
 * CalendarEngine — resolve the scope of a recurring operation.
 *
 * When an operation targets a recurring event, we need to know whether
 * to apply it to a single occurrence, this + following, or the entire series.
 *
 * This module bridges the EngineOperation (with an optional RecurringEditScope)
 * to the resolveRecurringEdit function.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import type { EngineOperation, RecurringEditScope } from '../schema/operationSchema.js';
import type { EventChange } from './operationResult.js';
import { isRecurringSeries } from '../schema/eventSchema.js';
import {
  resolveRecurringEdit,
  type RecurringEditPatch,
} from '../recurrence/resolveRecurringEdit.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ScopeResolutionResult {
  /** If true, the caller should apply these changes instead of a direct patch. */
  readonly needsRecurringResolution: boolean;
  /** The changes to apply (only set when needsRecurringResolution is true). */
  readonly changes?: EventChange[];
}

/**
 * Determine whether an operation on a recurring event needs scope resolution.
 * If it does, return the resolved EventChanges.
 *
 * Returns { needsRecurringResolution: false } for:
 *   - non-recurring events
 *   - operations without a scope
 *   - series-wide operations (caller applies patch directly to master)
 */
export function resolveOperationScope(
  op: Extract<EngineOperation, { scope?: RecurringEditScope | undefined; occurrenceDate?: Date | undefined }>,
  master: EngineEvent,
  _allEvents: readonly EngineEvent[],
): ScopeResolutionResult {
  // Not a recurring series → no scope resolution needed
  if (!isRecurringSeries(master)) {
    return { needsRecurringResolution: false };
  }

  const scope         = op.scope ?? 'series';
  const occurrenceDate = op.occurrenceDate;

  // Series-wide edit → caller applies the patch directly to the master
  if (scope === 'series') {
    return { needsRecurringResolution: false };
  }

  // Single or following: we need a concrete occurrence date
  if (!occurrenceDate) {
    console.warn('[resolveOperationScope] scope=%s but no occurrenceDate — falling back to series', scope);
    return { needsRecurringResolution: false };
  }

  // Build the patch from the operation
  const patch = buildPatchFromOp(op);

  const changes = resolveRecurringEdit(master, occurrenceDate, patch, scope);
  return { needsRecurringResolution: true, changes };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildPatchFromOp(
  op: Extract<EngineOperation, { scope?: RecurringEditScope | undefined }>,
): RecurringEditPatch {
  if (op.type === 'move' || op.type === 'resize') {
    return { newStart: op.newStart, newEnd: op.newEnd };
  }
  if (op.type === 'update') {
    const p = op.patch;
    return {
      ...(p.title      !== undefined && { title:      p.title }),
      ...(p.category   !== undefined && { category:   p.category   as string | null }),
      ...(p.resourceId !== undefined && { resourceId: p.resourceId as string | null }),
      ...(p.color      !== undefined && { color:      p.color      as string | null }),
      ...(p.status     !== undefined && { status:     p.status     as EngineEvent['status'] }),
      ...(p.start      !== undefined && { newStart:   p.start      as Date }),
      ...(p.end        !== undefined && { newEnd:     p.end        as Date }),
    };
  }
  return {};
}
