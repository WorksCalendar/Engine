/**
 * CalendarEngine — detach a single occurrence from a recurring series.
 *
 * Detaching creates a standalone EngineEvent for one specific occurrence,
 * while adding an EXDATE to the series master so the occurrence is no longer
 * generated from the RRULE.
 *
 * This is equivalent to "edit this event only" in Google Calendar.
 * Pure function — no side effects.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import { makeEvent } from '../schema/eventSchema.js';
import { addExdate, buildOccurrenceDateKey, eventDurationMs } from './recurrenceMath.js';
import { nextEngineId } from '../adapters/normalizeInputEvent.js';

export interface DetachResult {
  /** Series master with the occurrence's start date added to exdates. */
  readonly updatedMaster: EngineEvent;
  /** The new standalone event for this occurrence. */
  readonly detached: EngineEvent;
}

/**
 * Detach a single occurrence from a recurring series.
 *
 * @param master          The series master EngineEvent
 * @param occurrenceStart The start of the occurrence to detach
 * @param patch           Overrides for the detached record (e.g. new title, new times)
 */
export function detachOccurrence(
  master: EngineEvent,
  occurrenceStart: Date,
  patch: Partial<Omit<EngineEvent, 'id' | 'seriesId' | 'occurrenceId' | 'detachedFrom' | 'rrule'>> = {},
): DetachResult {
  if (!master.rrule && !master.seriesId) {
    throw new Error('detachOccurrence called on a non-recurring event');
  }

  const durationMillis = eventDurationMs(master.start, master.end);

  // 1. Update master: add EXDATE for this occurrence
  const updatedMaster: EngineEvent = {
    ...master,
    exdates: addExdate(master.exdates, occurrenceStart),
  };

  // 2. Create detached record
  const detachedId = nextEngineId();
  const detachedStart = patch.start ?? occurrenceStart;
  const detachedEnd   = patch.end   ?? new Date(occurrenceStart.getTime() + durationMillis);

  const detached: EngineEvent = makeEvent(detachedId, {
    // Inherit from series master
    timezone:   master.timezone,
    allDay:     master.allDay,
    category:   master.category,
    resourceId: master.resourceId,
    resourcePoolId: master.resourcePoolId,
    status:     master.status,
    color:      master.color,
    meta:       master.meta,
    title:      master.title,

    // Apply caller overrides
    ...patch,

    // Lock in resolved start/end
    start: detachedStart,
    end:   detachedEnd,

    // Not recurring
    rrule:   null,
    exdates: [],

    // Durable recurrence identity
    seriesId:     master.id,
    occurrenceId: buildOccurrenceDateKey(occurrenceStart),
    detachedFrom: master.id,
  });

  return { updatedMaster, detached };
}
