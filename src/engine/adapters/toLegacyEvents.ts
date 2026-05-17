/**
 * CalendarEngine — adapter: EngineEvent → legacy event shape.
 *
 * Produces the shape consumed by the existing WorksCalendar views.
 * Use this when passing engine events to components that haven't been
 * migrated to the engine API yet.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import type { EngineOccurrence } from '../schema/occurrenceSchema.js';
import { isVisualPriority } from '../../types/view.js';

// ─── Legacy shape ─────────────────────────────────────────────────────────────

export interface LegacyEventOut {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  category: string | null;
  color: string | null;
  resource: string | null;
  status: string;
  rrule: string | null;
  exdates: Date[];
  meta: Record<string, unknown>;
  /** Importance signal threaded through the engine via meta._visualPriority. */
  visualPriority?: 'muted' | 'high' | undefined;
  /** Back-compat: _seriesId if this event is part of a series. */
  _seriesId: string | null;
  /** Back-compat: true if this is an expanded recurrence occurrence. */
  _recurring: boolean;
  /**
   * The source EngineEvent id.
   * For non-recurring events this equals id.
   * For recurring occurrences, id is the occurrenceId ("{eventId}-r{n}") while
   * _eventId is the series master's id — pass _eventId when building mutations.
   */
  _eventId?: string | undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a single EngineEvent to the legacy shape expected by views.
 *
 * Key transformations:
 *   - resourceId     → resource
 *   - seriesId       → _seriesId
 *   - isPartOfSeries → _recurring
 */
export function toLegacyEvent(ev: EngineEvent): LegacyEventOut {
  const isRecurring = ev.seriesId !== null && ev.seriesId !== ev.id;
  const vp = ev.meta['_visualPriority'];
  return {
    id:            ev.id,
    title:         ev.title,
    start:         ev.start,
    end:           ev.end,
    allDay:        ev.allDay,
    category:      ev.category,
    color:         ev.color,
    resource:      ev.resourceId,
    status:        ev.status,
    rrule:         ev.rrule,
    exdates:       Array.from(ev.exdates),
    meta:          { ...ev.meta },
    visualPriority: isVisualPriority(vp) ? vp : undefined,
    _seriesId:     ev.seriesId,
    _recurring:    isRecurring,
  };
}

/** Convert an array of EngineEvents to the legacy shape. */
export function toLegacyEvents(events: EngineEvent[]): LegacyEventOut[] {
  return events.map(toLegacyEvent);
}

/**
 * Convert a single EngineOccurrence (ephemeral, render-time) to the legacy
 * shape consumed by views.
 *
 * Key differences from toLegacyEvent:
 *   - id          = occurrenceId  (unique per rendered instance, e.g. "evt-1-r2")
 *   - _eventId    = eventId       (source EngineEvent id — use this for mutations)
 *   - rrule/exdates are null/[] (occurrences are already expanded)
 */
export function occurrenceToLegacy(occ: EngineOccurrence): LegacyEventOut {
  const vp = occ.meta['_visualPriority'];
  return {
    id:            occ.occurrenceId,
    title:         occ.title,
    start:         occ.start,
    end:           occ.end,
    allDay:        occ.allDay,
    category:      occ.category,
    color:         occ.color,
    resource:      occ.resourceId,
    status:        occ.status,
    rrule:         null,
    exdates:       [],
    meta:          { ...occ.meta },
    visualPriority: vp === 'muted' || vp === 'high' ? vp : undefined,
    _seriesId:     occ.seriesId,
    _recurring:    occ.isRecurring,
    _eventId:      occ.eventId,
  };
}
