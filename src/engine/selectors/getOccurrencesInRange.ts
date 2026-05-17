/**
 * CalendarEngine — main view selector: getOccurrencesInRange.
 *
 * This is the canonical read path for views.  It:
 *   1. Filters the event map (optional)
 *   2. Expands recurrence
 *   3. Returns EngineOccurrence[] sorted by start
 *
 * Views should not call expandOccurrences directly.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import type { EngineOccurrence } from '../schema/occurrenceSchema.js';
import type { FilterState } from '../types.js';
import type { Assignment } from '../schema/assignmentSchema.js';
import { resourceIdsForEvent } from '../schema/assignmentSchema.js';
import { expandOccurrences, type ExpandOptions } from '../recurrence/expandOccurrences.js';

// ─── Options ──────────────────────────────────────────────────────────────────

export interface GetOccurrencesOptions extends ExpandOptions {
  /** If provided, only return occurrences matching these filters. */
  filter?: FilterState;
  /** Whether to sort results by start time (default: true). */
  sort?: boolean;
  /**
   * Assignments map for multi-resource support.
   * When provided, each occurrence's resourceIds field is populated from
   * this map rather than the legacy event.resourceId field.
   */
  assignments?: ReadonlyMap<string, Assignment>;
}

// ─── Main selector ────────────────────────────────────────────────────────────

/**
 * Return all EngineOccurrences overlapping [rangeStart, rangeEnd),
 * optionally filtered and sorted.
 */
export function getOccurrencesInRange(
  events: ReadonlyMap<string, EngineEvent> | readonly EngineEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  opts: GetOccurrencesOptions = {},
): EngineOccurrence[] {
  const eventList: EngineEvent[] =
    events instanceof Map
      ? Array.from(events.values())
      : Array.from(events as readonly EngineEvent[]);

  const filtered = opts.filter
    ? applyFilter(eventList, opts.filter)
    : eventList;

  const occurrences = expandOccurrences(filtered, rangeStart, rangeEnd, opts);

  // Join assignments: override each occurrence's resourceIds when the
  // caller has provided an assignments map.
  const withAssignments = opts.assignments
    ? occurrences.map(occ => ({
        ...occ,
        resourceIds: resourceIdsForEvent(opts.assignments!, occ.eventId, occ.resourceId),
      }))
    : occurrences;

  if (opts.sort !== false) {
    withAssignments.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return withAssignments;
}

// ─── Filter helper ────────────────────────────────────────────────────────────

function applyFilter(events: EngineEvent[], filter: FilterState): EngineEvent[] {
  const needle = filter.search.trim().toLowerCase();

  return events.filter(ev => {
    if (needle && !ev.title.toLowerCase().includes(needle)) return false;
    if (filter.categories.size > 0 && (!ev.category || !filter.categories.has(ev.category))) return false;
    if (filter.resources.size > 0 && (!ev.resourceId || !filter.resources.has(ev.resourceId))) return false;
    return true;
  });
}
