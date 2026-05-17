import {
  isCoveringEvent,
  isCoveredShift,
  isOpenShiftEvent,
  isShiftOrOnCallEvent,
  SCHEDULE_KINDS,
} from './scheduleModel.js';
import { createId } from './createId.js';

/**
 * scheduleOverlap.js — utilities for detecting shift / on-call conflicts
 * when an employee submits a PTO or Unavailable request.
 *
 * All functions are pure and have no side effects.
 */

// ─── Interval helpers ─────────────────────────────────────────────────────────

/**
 * Returns true when two half-open intervals [aStart, aEnd) and [bStart, bEnd)
 * overlap.  "Touching" (aEnd === bStart) is NOT considered an overlap.
 *
 * @param {Date} aStart
 * @param {Date} aEnd
 * @param {Date} bStart
 * @param {Date} bEnd
 * @returns {boolean}
 */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

type OverlapEventLike = {
  id?: string;
  // `| undefined` so NormalizedEvent (whose `_eventId?: string | undefined`) assigns under exactOptionalPropertyTypes.
  _eventId?: string | undefined;
  resource?: unknown;
  employeeId?: unknown;
  start?: unknown;
  end?: unknown;
  title?: string;
  meta?: Record<string, unknown>;
  category?: unknown;
  kind?: unknown;
};

// ─── Core detection ───────────────────────────────────────────────────────────

/**
 * Find all shift / on-call events for `employeeId` that overlap
 * [requestStart, requestEnd).
 *
 * @param {object} params
 * @param {string}   params.employeeId       — the employee requesting time off
 * @param {Date}     params.requestStart     — start of the PTO/unavailable window
 * @param {Date}     params.requestEnd       — end   of the PTO/unavailable window
 * @param {object[]} params.allEvents        — all expanded calendar events
 * @param {string}   [params.onCallCategory] — category name for on-call shifts (default 'on-call')
 * @returns {{ conflictingEvents: object[], hasConflict: boolean }}
 */
export function detectShiftConflicts({
  employeeId,
  requestStart,
  requestEnd,
  allEvents,
  onCallCategory = 'on-call',
}: {
  employeeId: string;
  requestStart: Date | null | undefined;
  requestEnd: Date | null | undefined;
  allEvents: OverlapEventLike[];
  onCallCategory?: string;
}): { conflictingEvents: OverlapEventLike[]; hasConflict: boolean } {
  if (!employeeId || !requestStart || !requestEnd || !Array.isArray(allEvents)) {
    return { conflictingEvents: [], hasConflict: false };
  }

  const empId = String(employeeId);
  const seenShiftIds = new Set();

  const conflictingEvents = allEvents.filter(ev => {
    const eventId = String(ev._eventId ?? ev.id ?? '');
    if (!eventId || seenShiftIds.has(eventId)) return false;

    // Must belong to this employee
    if (String(ev.resource ?? ev.employeeId ?? '') !== empId) return false;

    // Must be a real shift/on-call event, not an open-shift or mirror event.
    if (!isShiftOrOnCallEvent(ev, onCallCategory)) return false;
    if (isOpenShiftEvent(ev) || isCoveringEvent(ev)) return false;

    // Conflict generation should be idempotent: already-covered shifts
    // should not keep regenerating open-shift work.
    if (isCoveredShift(ev)) return false;

    const evStart = ev.start instanceof Date ? ev.start : new Date(ev.start as string | number);
    const evEnd   = ev.end   instanceof Date ? ev.end   : new Date(ev.end   as string | number);
    if (Number.isNaN(evStart.getTime()) || Number.isNaN(evEnd.getTime())) return false;

    const overlaps = intervalsOverlap(requestStart, requestEnd, evStart, evEnd);
    if (overlaps) seenShiftIds.add(eventId);
    return overlaps;
  });

  return {
    conflictingEvents,
    hasConflict: conflictingEvents.length > 0,
  };
}

/**
 * Build the open-shift event that should be created when a shift is left
 * uncovered by a PTO or Unavailable request.
 *
 * The returned object is a plain event shape ready to pass to applyEngineOp.
 *
 * @param {object} params
 * @param {object} params.shiftEvent          — the original shift/on-call event
 * @param {string} params.reason              — 'pto' | 'unavailable'
 * @param {string} [params.openShiftCategory] — category for open-shift events (default 'open-shift')
 * @returns {object} openShiftEvent
 */
export function buildOpenShiftEvent({
  shiftEvent,
  reason,
  openShiftCategory = 'open-shift',
}: {
  shiftEvent: OverlapEventLike;
  reason: string;
  openShiftCategory?: string;
}): Record<string, unknown> {
  const sourceShiftId = String(shiftEvent._eventId ?? shiftEvent.id ?? 'shift');
  const id = createId(`open-${sourceShiftId}`);
  return {
    id,
    title:    `Open: ${shiftEvent.title ?? 'Shift'}`,
    start:    shiftEvent.start instanceof Date ? shiftEvent.start : new Date(shiftEvent.start as string | number),
    end:      shiftEvent.end   instanceof Date ? shiftEvent.end   : new Date(shiftEvent.end   as string | number),
    category: openShiftCategory,
    resource: null,    // unassigned — no covering employee yet
    color:    '#f59e0b', // amber — visually distinct "needs coverage" colour
    meta: {
      kind:               SCHEDULE_KINDS.OPEN_SHIFT,
      sourceShiftId,
      originalEmployeeId: String(shiftEvent.resource ?? shiftEvent.employeeId ?? ''),
      reason,
      coveredBy:          null,
      status:             'open',
    },
  };
}
