/**
 * CalendarEngine — split a recurring series at a given occurrence.
 *
 * Returns the two EngineEvent records that result from the split:
 *   - head: original series, terminated before the split point
 *   - tail: new series starting at the split point, with the same RRULE
 *
 * The caller is responsible for persisting both records.
 * This is a pure function — no side effects.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import { makeEvent } from '../schema/eventSchema.js';
import { setRRuleUntil } from './recurrenceMath.js';
import { nextEngineId } from '../adapters/normalizeInputEvent.js';

export interface SeriesSplitResult {
  /** The head series (original master with UNTIL set). */
  readonly head: EngineEvent;
  /** The new tail series starting at splitStart. */
  readonly tail: EngineEvent;
}

/**
 * Split a recurring series at `splitStart`.
 *
 * @param master      The original series master EngineEvent
 * @param splitStart  The start of the first occurrence that belongs to the new series
 * @param tailPatch   Optional overrides for the tail series (e.g. new title, color)
 */
export function splitSeries(
  master: EngineEvent,
  splitStart: Date,
  tailPatch: Partial<Omit<EngineEvent, 'id' | 'seriesId' | 'occurrenceId' | 'detachedFrom'>> = {},
): SeriesSplitResult {
  if (!master.rrule) {
    throw new Error('splitSeries called on a non-recurring event');
  }

  // Terminate the head one millisecond before the split point
  const untilDate  = new Date(splitStart.getTime() - 1);
  const headRrule  = setRRuleUntil(master.rrule, untilDate);
  const head: EngineEvent = { ...master, rrule: headRrule };

  // New series starts at splitStart
  const tailId = nextEngineId();
  const tail: EngineEvent = makeEvent(tailId, {
    ...master,                    // inherit everything from master
    ...tailPatch,                 // then apply any overrides
    start:        splitStart,
    end:          new Date(splitStart.getTime() + (master.end.getTime() - master.start.getTime())),
    rrule:        master.rrule,   // same recurrence rule, new anchor
    exdates:      [],             // clear exdates — fresh series
    seriesId:     tailId,         // IS the new series master
    occurrenceId: null,
    detachedFrom: null,
  });

  return { head, tail };
}
