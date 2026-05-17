/**
 * CalendarEngine — resolve the scope of a recurring event edit.
 *
 * When the user edits a recurring occurrence, they choose a scope:
 *   single    — detach only this occurrence, add an EXDATE to the series
 *   following — split the series; modify from this occurrence onward
 *   series    — update the series master (affects all future occurrences)
 *
 * Each scope returns a list of EventChanges that the engine should apply.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import type { EventChange } from '../operations/operationResult.js';
import type { RecurringEditScope } from '../schema/operationSchema.js';
import { makeEvent } from '../schema/eventSchema.js';
import { addExdate, setRRuleUntil, buildOccurrenceDateKey, eventDurationMs } from './recurrenceMath.js';
import { nextEngineId } from '../adapters/normalizeInputEvent.js';

// ─── Shared patch type ────────────────────────────────────────────────────────

export interface RecurringEditPatch {
  readonly newStart?: Date;
  readonly newEnd?: Date;
  readonly title?: string;
  readonly category?: string | null;
  readonly resourceId?: string | null;
  readonly resourcePoolId?: string | null;
  readonly color?: string | null;
  readonly status?: EngineEvent['status'];
  [key: string]: unknown;
}

// ─── Scope dispatcher ────────────────────────────────────────────────────────

/**
 * Resolve a recurring edit into a set of EventChanges.
 *
 * @param master       The series master EngineEvent
 * @param occurrenceStart  The start of the specific occurrence being edited
 * @param patch        The changes to apply
 * @param scope        How broadly to apply the change
 */
export function resolveRecurringEdit(
  master: EngineEvent,
  occurrenceStart: Date,
  patch: RecurringEditPatch,
  scope: RecurringEditScope,
): EventChange[] {
  switch (scope) {
    case 'single':    return resolveSingleEdit(master, occurrenceStart, patch);
    case 'following': return resolveFollowingEdit(master, occurrenceStart, patch);
    case 'series':    return resolveSeriesEdit(master, patch);
  }
}

// ─── Single occurrence edit ───────────────────────────────────────────────────

/**
 * Detach one occurrence:
 *   1. Add the occurrence date to master's EXDATE list
 *   2. Create a new standalone EngineEvent for this occurrence
 */
function resolveSingleEdit(
  master: EngineEvent,
  occurrenceStart: Date,
  patch: RecurringEditPatch,
): EventChange[] {
  const durationMs = eventDurationMs(master.start, master.end);
  const newStart   = patch.newStart ?? occurrenceStart;
  const newEnd     = patch.newEnd   ?? new Date(occurrenceStart.getTime() + durationMs);

  // Update series master: add EXDATE for this occurrence
  const updatedMaster: EngineEvent = {
    ...master,
    exdates: addExdate(master.exdates, occurrenceStart),
  };

  // Create detached occurrence
  const detachedId = nextEngineId();
  const detached   = makeEvent(detachedId, {
    title:        patch.title       ?? master.title,
    start:        newStart,
    end:          newEnd,
    timezone:     master.timezone,
    allDay:       master.allDay,
    category:     patch.category    ?? master.category,
    resourceId:   patch.resourceId  ?? master.resourceId,
    resourcePoolId: patch.resourcePoolId ?? master.resourcePoolId,
    status:       patch.status      ?? master.status,
    color:        patch.color       ?? master.color,
    rrule:        null,
    exdates:      [],
    meta:         master.meta,
    seriesId:     master.id,
    occurrenceId: buildOccurrenceDateKey(occurrenceStart),
    detachedFrom: master.id,
  });

  return [
    { type: 'updated', id: master.id, before: master, after: updatedMaster },
    { type: 'created', event: detached },
  ];
}

// ─── This and following edit ─────────────────────────────────────────────────

/**
 * Split the series at the given occurrence:
 *   1. Terminate the original series with UNTIL = (occurrence - 1 day)
 *   2. Create a new series starting at this occurrence with the same RRULE
 */
function resolveFollowingEdit(
  master: EngineEvent,
  occurrenceStart: Date,
  patch: RecurringEditPatch,
): EventChange[] {
  // Terminate original series one millisecond before this occurrence
  const untilDate  = new Date(occurrenceStart.getTime() - 1);
  const newRrule   = setRRuleUntil(master.rrule!, untilDate);
  const updatedMaster: EngineEvent = { ...master, rrule: newRrule };

  // New series starts at this occurrence (adjusted by patch)
  const durationMs = eventDurationMs(master.start, master.end);
  const newStart   = patch.newStart ?? occurrenceStart;
  const newEnd     = patch.newEnd   ?? new Date(occurrenceStart.getTime() + durationMs);

  const newSeriesId = nextEngineId();
  const newSeries   = makeEvent(newSeriesId, {
    title:      patch.title      ?? master.title,
    start:      newStart,
    end:        newEnd,
    timezone:   master.timezone,
    allDay:     master.allDay,
    category:   patch.category   ?? master.category,
    resourceId: patch.resourceId ?? master.resourceId,
    resourcePoolId: patch.resourcePoolId ?? master.resourcePoolId,
    status:     patch.status     ?? master.status,
    color:      patch.color      ?? master.color,
    rrule:      master.rrule,   // same rule, new start anchor
    exdates:    [],
    meta:       master.meta,
    seriesId:   newSeriesId,    // this IS the new series master
    occurrenceId: null,
    detachedFrom: null,
  });

  return [
    { type: 'updated', id: master.id, before: master, after: updatedMaster },
    { type: 'created', event: newSeries },
  ];
}

// ─── Recurring delete ─────────────────────────────────────────────────────────

/**
 * Resolve a recurring DELETE into a set of EventChanges.
 *
 * Unlike edit resolution, delete never creates new events — it only
 * trims the series:
 *
 *   single    — add the occurrence to master's EXDATE list (excludes it
 *               from expansion).  No detached event is created.
 *   following — set UNTIL on master to the ms before this occurrence
 *               (terminates the series at that point).  No new series
 *               is created.
 *
 * For scope='series' the caller should delete the master directly.
 */
export function resolveRecurringDelete(
  master: EngineEvent,
  occurrenceStart: Date,
  scope: 'single' | 'following',
): EventChange[] {
  switch (scope) {
    case 'single':    return resolveSingleDelete(master, occurrenceStart);
    case 'following': return resolveFollowingDelete(master, occurrenceStart);
  }
}

function resolveSingleDelete(
  master: EngineEvent,
  occurrenceStart: Date,
): EventChange[] {
  // Exclude this occurrence via EXDATE — no detached event.
  const updated: EngineEvent = {
    ...master,
    exdates: addExdate(master.exdates, occurrenceStart),
  };
  return [{ type: 'updated', id: master.id, before: master, after: updated }];
}

function resolveFollowingDelete(
  master: EngineEvent,
  occurrenceStart: Date,
): EventChange[] {
  // Terminate the series 1 ms before this occurrence — no new series.
  const untilDate = new Date(occurrenceStart.getTime() - 1);
  const newRrule  = setRRuleUntil(master.rrule!, untilDate);
  const updated: EngineEvent = { ...master, rrule: newRrule };
  return [{ type: 'updated', id: master.id, before: master, after: updated }];
}

/**
 * Update the series master in-place.
 * All future occurrences are affected (expanded fresh on next getOccurrences call).
 */
function resolveSeriesEdit(
  master: EngineEvent,
  patch: RecurringEditPatch,
): EventChange[] {
  const updated: EngineEvent = {
    ...master,
    ...(patch.title      !== undefined && { title:      patch.title }),
    ...(patch.category   !== undefined && { category:   patch.category }),
    ...(patch.resourceId     !== undefined && { resourceId:     patch.resourceId }),
    ...(patch.resourcePoolId !== undefined && { resourcePoolId: patch.resourcePoolId }),
    ...(patch.color          !== undefined && { color:          patch.color }),
    ...(patch.status     !== undefined && { status:     patch.status }),
    // For series edits, time changes adjust the master start/end
    // (keeping duration) which shifts all unexpanded occurrences.
    ...(patch.newStart   !== undefined && { start: patch.newStart }),
    ...(patch.newEnd     !== undefined && { end:   patch.newEnd }),
  };

  return [{ type: 'updated', id: master.id, before: master, after: updated }];
}
