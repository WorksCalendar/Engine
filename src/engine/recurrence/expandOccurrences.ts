/**
 * CalendarEngine — expand EngineEvents into EngineOccurrences for a range.
 *
 * This is the canonical path for rendering.  Views should call
 * getOccurrencesInRange() (which calls this), not the useOccurrences hook
 * directly, once migrated.
 *
 * Recurring events are fully expanded; single events pass through.
 * Expansion range is padded by 7 days on each side to catch events
 * that visually bleed into the range from outside it.
 */

import { addDays } from 'date-fns';
import { expandRRule } from './expandRRule.js';
import type { EngineEvent } from '../schema/eventSchema.js';
import type { EngineOccurrence } from '../schema/occurrenceSchema.js';
import { buildOccurrenceId, eventDurationMs } from './recurrenceMath.js';

// ─── Options ──────────────────────────────────────────────────────────────────

export interface ExpandOptions {
  /**
   * Extra days to expand the query range on each side.
   * Default: 7 (ensures events starting before/ending after the range are included).
   */
  rangePadDays?: number;
  /** Maximum occurrences per series. Default: 500. */
  maxPerSeries?: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Expand a list of EngineEvents into EngineOccurrences that overlap
 * [rangeStart, rangeEnd).
 *
 * Single events: passed through if they overlap the range.
 * Recurring series: expanded via RRULE; each occurrence is a separate object.
 */
export function expandOccurrences(
  events: readonly EngineEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  opts: ExpandOptions = {},
): EngineOccurrence[] {
  const padDays    = opts.rangePadDays ?? 7;
  const maxPerSeries = opts.maxPerSeries ?? 500;

  const expStart = addDays(rangeStart, -padDays);
  const expEnd   = addDays(rangeEnd,    padDays);

  const result: EngineOccurrence[] = [];

  for (const ev of events) {
    if (ev.rrule) {
      expandRecurring(ev, rangeStart, rangeEnd, expStart, expEnd, maxPerSeries, result);
    } else {
      // Single event — include if it overlaps the (unpadded) range
      if (ev.start < rangeEnd && ev.end > rangeStart) {
        result.push(makeOccurrence(ev, ev.start, ev.end, 0));
      }
    }
  }

  return result;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function expandRecurring(
  ev: EngineEvent,
  rangeStart: Date,
  rangeEnd: Date,
  expStart: Date,
  expEnd: Date,
  maxCount: number,
  out: EngineOccurrence[],
): void {
  const durationMillis = eventDurationMs(ev.start, ev.end);
  const exdates = Array.from(ev.exdates ?? []);

  // expandRRule returns occurrence start dates within [expStart, expEnd]
  const starts: Date[] = expandRRule(ev.start, ev.rrule!, exdates, expStart, expEnd);

  let occIdx = 0;
  for (let i = 0; i < starts.length && occIdx < maxCount; i++) {
    const start = starts[i];
    if (start === undefined) continue;
    const end   = new Date(start.getTime() + durationMillis);

    // Only emit if this occurrence overlaps the requested range (not the padded range)
    if (start < rangeEnd && end > rangeStart) {
      out.push(makeOccurrence(ev, start, end, occIdx));
    }
    occIdx++;
  }
}

function makeOccurrence(
  ev: EngineEvent,
  start: Date,
  end: Date,
  idx: number,
): EngineOccurrence {
  return {
    occurrenceId:    buildOccurrenceId(ev.id, idx),
    eventId:         ev.id,
    seriesId:        ev.seriesId,
    detachedFrom:    ev.detachedFrom,
    start,
    end,
    timezone:        ev.timezone,
    allDay:          ev.allDay,
    title:           ev.title,
    category:        ev.category,
    resourceId:      ev.resourceId,
    status:          ev.status,
    color:           ev.color,
    // Default resourceIds from the legacy single-resource field.
    // getOccurrencesInRange overrides this when an assignments map is provided.
    resourceIds:     ev.resourceId ? [ev.resourceId] : [],
    isRecurring:     ev.rrule !== null || ev.seriesId !== null,
    occurrenceIndex: idx,
    constraints:     ev.constraints ?? [],
    meta:            ev.meta,
  };
}
