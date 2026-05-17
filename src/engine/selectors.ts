/**
 * CalendarEngine — pure derived-data selectors.
 *
 * All selectors are pure functions over CalendarState.
 * They are safe to memoize with useMemo / reselect.
 */

import { startOfDay, endOfDay } from 'date-fns';
import type { CalendarState, EngineEvent } from './types.js';

// ─── Basic event accessors ────────────────────────────────────────────────────

export function selectAllEvents(state: CalendarState): EngineEvent[] {
  return Array.from(state.events.values());
}

export function selectEventById(state: CalendarState, id: string): EngineEvent | undefined {
  return state.events.get(id);
}

/**
 * Returns events that overlap [rangeStart, rangeEnd] (inclusive on both ends).
 * An event overlaps if it starts before rangeEnd AND ends after rangeStart.
 */
export function selectEventsInRange(
  state: CalendarState,
  rangeStart: Date,
  rangeEnd: Date,
): EngineEvent[] {
  return selectAllEvents(state).filter(ev =>
    ev.start < rangeEnd && ev.end > rangeStart,
  );
}

/**
 * Returns events that fall on the given day (any overlap with the day boundary).
 */
export function selectEventsForDay(state: CalendarState, day: Date): EngineEvent[] {
  const start = startOfDay(day);
  const end = endOfDay(day);
  return selectEventsInRange(state, start, end);
}

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

/** Sorted list of all unique category strings across all events. */
export function selectCategories(state: CalendarState): string[] {
  const cats = new Set<string>();
  for (const ev of state.events.values()) {
    if (ev.category) cats.add(ev.category);
  }
  return Array.from(cats).sort();
}

/** Sorted list of all unique resource keys across all events. */
export function selectResources(state: CalendarState): string[] {
  const res = new Set<string>();
  for (const ev of state.events.values()) {
    if (ev.resourceId) res.add(ev.resourceId);
  }
  return Array.from(res).sort();
}

/** Sorted list of event ids currently selected. */
export function selectSelectedIds(state: CalendarState): string[] {
  return Array.from(state.selection).sort();
}

/** Selected event objects (ids that no longer exist are silently omitted). */
export function selectSelectedEvents(state: CalendarState): EngineEvent[] {
  return Array.from(state.selection)
    .map(id => state.events.get(id))
    .filter((ev): ev is EngineEvent => ev != null);
}

// ─── Filtered events ──────────────────────────────────────────────────────────

/**
 * Returns all events that pass the current filter state.
 *
 * Rules:
 * - search: case-insensitive substring match on title (empty = pass all)
 * - categories: event must have one of the active categories (empty set = pass all)
 * - resources: event must have one of the active resources (empty set = pass all)
 */
export function selectFilteredEvents(state: CalendarState): EngineEvent[] {
  const { search, categories, resources } = state.filter;
  const needle = search.trim().toLowerCase();

  return selectAllEvents(state).filter(ev => {
    if (needle && !ev.title.toLowerCase().includes(needle)) return false;
    if (categories.size > 0 && (!ev.category || !categories.has(ev.category))) return false;
    if (resources.size > 0 && (!ev.resourceId || !resources.has(ev.resourceId))) return false;
    return true;
  });
}

/**
 * Filtered events within a date range — composition of the two selectors above.
 */
export function selectFilteredEventsInRange(
  state: CalendarState,
  rangeStart: Date,
  rangeEnd: Date,
): EngineEvent[] {
  return selectFilteredEvents(state).filter(
    ev => ev.start < rangeEnd && ev.end > rangeStart,
  );
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

/**
 * Returns [start, end] Date pair representing the visible range for the
 * current view + cursor combination.  Used by consumers to know which
 * events to fetch / pass in.
 */
export function selectVisibleRange(state: CalendarState): [Date, Date] {
  const { view, cursor, config } = state;
  const weekStartsOn = config.weekStartsOn ?? 0;

  if (view === 'day') {
    return [startOfDay(cursor), endOfDay(cursor)];
  }

  if (view === 'week') {
    // Find start of week
    const dow = cursor.getDay();
    const diff = (dow - weekStartsOn + 7) % 7;
    const weekStart = startOfDay(new Date(cursor));
    weekStart.setDate(weekStart.getDate() - diff);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return [weekStart, endOfDay(weekEnd)];
  }

  if (view === 'schedule') {
    const start = startOfDay(cursor);
    const end = new Date(start);
    end.setDate(end.getDate() + 41); // 6 weeks
    return [start, end];
  }

  // month — show entire calendar grid (up to 6 weeks)
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const _monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const dow = monthStart.getDay();
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - ((dow - weekStartsOn + 7) % 7));
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 41);
  return [gridStart, endOfDay(gridEnd)];
}
