/**
 * CalendarEngine — series grouping selectors.
 */

import type { EngineEvent } from '../schema/eventSchema.js';

/**
 * Group events by their seriesId.
 * Events with no seriesId (non-recurring) are excluded.
 */
export function groupBySeries(
  events: readonly EngineEvent[],
): Map<string, EngineEvent[]> {
  const map = new Map<string, EngineEvent[]>();
  for (const ev of events) {
    if (!ev.seriesId) continue;
    const group = map.get(ev.seriesId) ?? [];
    group.push(ev);
    map.set(ev.seriesId, group);
  }
  return map;
}

/**
 * Return the series master for a given seriesId.
 * The master is the event whose id === seriesId.
 */
export function getSeriesMaster(
  events: readonly EngineEvent[],
  seriesId: string,
): EngineEvent | undefined {
  return events.find(ev => ev.id === seriesId && ev.seriesId === seriesId);
}

/**
 * Return all detached occurrences (modified single occurrences) for a series.
 * These are EngineEvents whose detachedFrom === seriesId.
 */
export function getDetachedOccurrences(
  events: readonly EngineEvent[],
  seriesId: string,
): EngineEvent[] {
  return events.filter(ev => ev.detachedFrom === seriesId);
}
