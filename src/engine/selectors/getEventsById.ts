/**
 * CalendarEngine — fast event lookup helpers.
 */

import type { EngineEvent } from '../schema/eventSchema.js';

/**
 * Build an id → EngineEvent lookup map.
 * O(n) to build, O(1) to query.
 */
export function buildEventMap(events: readonly EngineEvent[]): Map<string, EngineEvent> {
  const map = new Map<string, EngineEvent>();
  for (const ev of events) {
    map.set(ev.id, ev);
  }
  return map;
}

/** Return a single event by id, or undefined. */
export function getEventById(
  events: readonly EngineEvent[],
  id: string,
): EngineEvent | undefined {
  return events.find(ev => ev.id === id);
}

/** Return events whose ids are in the given set. */
export function getEventsByIds(
  events: readonly EngineEvent[],
  ids: ReadonlySet<string> | string[],
): EngineEvent[] {
  const set = ids instanceof Set ? ids : new Set(ids);
  return events.filter(ev => set.has(ev.id));
}
