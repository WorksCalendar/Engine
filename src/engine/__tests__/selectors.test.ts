import { describe, it, expect } from 'vitest';
import {
  selectAllEvents,
  selectEventById,
  selectEventsInRange,
  selectEventsForDay,
  selectCategories,
  selectResources,
  selectSelectedIds,
  selectSelectedEvents,
  selectFilteredEvents,
  selectFilteredEventsInRange,
  selectVisibleRange,
} from '../selectors.js';
import { makeEvent } from '../schema/eventSchema.js';
import type { CalendarState } from '../types.js';

const d = (y: number, mo: number, day: number, h = 0) => new Date(y, mo - 1, day, h, 0, 0);

function makeState(overrides: Partial<CalendarState> = {}): CalendarState {
  return {
    events:           new Map(),
    assignments:      new Map(),
    dependencies:     new Map(),
    resourceCalendars: new Map(),
    pools:            new Map(),
    view:             'month',
    cursor:           d(2026, 3, 15),
    filter:           { search: '', categories: new Set(), resources: new Set() },
    config:           {},
    selection:        new Set(),
    ...overrides,
  };
}

function ev(id: string, start: Date, end: Date, extras: object = {}) {
  return makeEvent(id, { title: id, start, end, ...extras });
}

function stateWithEvents(...events: ReturnType<typeof makeEvent>[]): CalendarState {
  return makeState({ events: new Map(events.map(e => [e.id, e])) });
}

// ─── selectAllEvents ──────────────────────────────────────────────────────────

describe('selectAllEvents', () => {
  it('returns all events as an array', () => {
    const state = stateWithEvents(
      ev('a', d(2026, 1, 10, 9), d(2026, 1, 10, 10)),
      ev('b', d(2026, 1, 11, 9), d(2026, 1, 11, 10)),
    );
    expect(selectAllEvents(state)).toHaveLength(2);
  });

  it('returns empty array when no events', () => {
    expect(selectAllEvents(makeState())).toEqual([]);
  });
});

// ─── selectEventById ─────────────────────────────────────────────────────────

describe('selectEventById', () => {
  it('returns the event when found', () => {
    const e = ev('e1', d(2026, 1, 10, 9), d(2026, 1, 10, 10));
    const state = stateWithEvents(e);
    expect(selectEventById(state, 'e1')).toBe(e);
  });

  it('returns undefined when not found', () => {
    expect(selectEventById(makeState(), 'missing')).toBeUndefined();
  });
});

// ─── selectEventsInRange ──────────────────────────────────────────────────────

describe('selectEventsInRange', () => {
  const e1 = ev('e1', d(2026, 1, 10, 9), d(2026, 1, 10, 10));
  const e2 = ev('e2', d(2026, 1, 11, 9), d(2026, 1, 11, 10));
  const state = stateWithEvents(e1, e2);

  it('returns events that overlap the range', () => {
    const result = selectEventsInRange(state, d(2026, 1, 10, 0), d(2026, 1, 10, 23));
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('e1');
  });

  it('returns empty array when no overlap', () => {
    const result = selectEventsInRange(state, d(2026, 1, 15, 0), d(2026, 1, 16, 0));
    expect(result).toHaveLength(0);
  });

  it('event touching rangeEnd boundary is excluded (strict <)', () => {
    const touching = ev('t', d(2026, 1, 11, 0), d(2026, 1, 11, 9));
    const s = stateWithEvents(touching);
    // rangeEnd = 09:00, event ends = 09:00 → ev.end > rangeStart is true but ev.start < rangeEnd is false
    const result = selectEventsInRange(s, d(2026, 1, 10, 0), d(2026, 1, 11, 0));
    expect(result).toHaveLength(0);
  });

  it('returns both events when range spans multiple days', () => {
    const result = selectEventsInRange(state, d(2026, 1, 9, 0), d(2026, 1, 12, 0));
    expect(result).toHaveLength(2);
  });
});

// ─── selectEventsForDay ───────────────────────────────────────────────────────

describe('selectEventsForDay', () => {
  it('returns events on the specified day', () => {
    const e = ev('e1', d(2026, 1, 10, 9), d(2026, 1, 10, 10));
    const state = stateWithEvents(e);
    const result = selectEventsForDay(state, d(2026, 1, 10));
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('e1');
  });

  it('excludes events on a different day', () => {
    const e = ev('e1', d(2026, 1, 11, 9), d(2026, 1, 11, 10));
    const state = stateWithEvents(e);
    expect(selectEventsForDay(state, d(2026, 1, 10))).toHaveLength(0);
  });
});

// ─── selectCategories ────────────────────────────────────────────────────────

describe('selectCategories', () => {
  it('returns sorted unique categories', () => {
    const state = stateWithEvents(
      makeEvent('a', { title: 'A', start: d(2026, 1, 10, 9), end: d(2026, 1, 10, 10), category: 'PTO' }),
      makeEvent('b', { title: 'B', start: d(2026, 1, 10, 9), end: d(2026, 1, 10, 10), category: 'Meeting' }),
      makeEvent('c', { title: 'C', start: d(2026, 1, 10, 9), end: d(2026, 1, 10, 10), category: 'PTO' }),
    );
    expect(selectCategories(state)).toEqual(['Meeting', 'PTO']);
  });

  it('excludes null categories', () => {
    const state = stateWithEvents(ev('a', d(2026, 1, 10, 9), d(2026, 1, 10, 10)));
    expect(selectCategories(state)).toEqual([]);
  });
});

// ─── selectResources ─────────────────────────────────────────────────────────

describe('selectResources', () => {
  it('returns sorted unique resourceIds', () => {
    const state = stateWithEvents(
      makeEvent('a', { title: 'A', start: d(2026, 1, 10, 9), end: d(2026, 1, 10, 10), resourceId: 'r2' }),
      makeEvent('b', { title: 'B', start: d(2026, 1, 10, 9), end: d(2026, 1, 10, 10), resourceId: 'r1' }),
    );
    expect(selectResources(state)).toEqual(['r1', 'r2']);
  });

  it('excludes null resourceIds', () => {
    expect(selectResources(makeState())).toEqual([]);
  });
});

// ─── selectSelectedIds / selectSelectedEvents ─────────────────────────────────

describe('selectSelectedIds', () => {
  it('returns sorted selected ids', () => {
    const state = makeState({ selection: new Set(['c', 'a', 'b']) });
    expect(selectSelectedIds(state)).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array when no selection', () => {
    expect(selectSelectedIds(makeState())).toEqual([]);
  });
});

describe('selectSelectedEvents', () => {
  it('returns selected event objects', () => {
    const e = ev('e1', d(2026, 1, 10, 9), d(2026, 1, 10, 10));
    const state = makeState({
      events: new Map([['e1', e]]),
      selection: new Set(['e1']),
    });
    expect(selectSelectedEvents(state)).toHaveLength(1);
    expect(selectSelectedEvents(state)[0]).toBe(e);
  });

  it('silently omits ids that no longer exist', () => {
    const state = makeState({ selection: new Set(['gone']) });
    expect(selectSelectedEvents(state)).toHaveLength(0);
  });
});

// ─── selectFilteredEvents ────────────────────────────────────────────────────

describe('selectFilteredEvents', () => {
  const evA = makeEvent('a', { title: 'Standup', start: d(2026, 1, 10, 9), end: d(2026, 1, 10, 10), category: 'Meeting', resourceId: 'r1' });
  const evB = makeEvent('b', { title: 'PTO day',  start: d(2026, 1, 11, 9), end: d(2026, 1, 11, 10), category: 'PTO',     resourceId: 'r2' });

  it('returns all when filter is empty', () => {
    const state = stateWithEvents(evA, evB);
    expect(selectFilteredEvents(state)).toHaveLength(2);
  });

  it('filters by search (case-insensitive)', () => {
    const state = makeState({
      events: new Map([['a', evA], ['b', evB]]),
      filter: { search: 'STANDUP', categories: new Set(), resources: new Set() },
    });
    const result = selectFilteredEvents(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('a');
  });

  it('filters by category', () => {
    const state = makeState({
      events: new Map([['a', evA], ['b', evB]]),
      filter: { search: '', categories: new Set(['Meeting']), resources: new Set() },
    });
    const result = selectFilteredEvents(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('a');
  });

  it('filters by resource', () => {
    const state = makeState({
      events: new Map([['a', evA], ['b', evB]]),
      filter: { search: '', categories: new Set(), resources: new Set(['r2']) },
    });
    const result = selectFilteredEvents(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('b');
  });

  it('excludes events without category when categories filter is active', () => {
    const noCategory = makeEvent('c', { title: 'C', start: d(2026, 1, 12, 9), end: d(2026, 1, 12, 10) });
    const state = makeState({
      events: new Map([['c', noCategory]]),
      filter: { search: '', categories: new Set(['Meeting']), resources: new Set() },
    });
    expect(selectFilteredEvents(state)).toHaveLength(0);
  });
});

// ─── selectFilteredEventsInRange ──────────────────────────────────────────────

describe('selectFilteredEventsInRange', () => {
  it('combines filter and range', () => {
    const e1 = makeEvent('a', { title: 'A', start: d(2026, 1, 10, 9), end: d(2026, 1, 10, 10), category: 'Meeting' });
    const e2 = makeEvent('b', { title: 'B', start: d(2026, 1, 15, 9), end: d(2026, 1, 15, 10), category: 'Meeting' });
    const state = makeState({
      events: new Map([['a', e1], ['b', e2]]),
      filter: { search: '', categories: new Set(['Meeting']), resources: new Set() },
    });
    const result = selectFilteredEventsInRange(state, d(2026, 1, 10, 0), d(2026, 1, 11, 0));
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('a');
  });
});

// ─── selectVisibleRange ───────────────────────────────────────────────────────

describe('selectVisibleRange', () => {
  it('day view: returns start/end of the cursor day', () => {
    const state = makeState({ view: 'day', cursor: d(2026, 3, 15, 12) });
    const [start, end] = selectVisibleRange(state);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(start.getDate()).toBe(15);
    expect(end.getDate()).toBe(15);
  });

  it('week view: returns Mon–Sun for a Wednesday cursor (weekStartsOn=1)', () => {
    // March 18 2026 is a Wednesday
    const state = makeState({
      view: 'week',
      cursor: d(2026, 3, 18),
      config: { weekStartsOn: 1 },
    });
    const [start, end] = selectVisibleRange(state);
    expect(start.getDate()).toBe(16); // Monday Mar 16
    expect(end.getDate()).toBe(22);   // Sunday Mar 22
  });

  it('week view: returns Sun–Sat for a Wednesday cursor (weekStartsOn=0)', () => {
    const state = makeState({
      view: 'week',
      cursor: d(2026, 3, 18),
      config: { weekStartsOn: 0 },
    });
    const [start] = selectVisibleRange(state);
    expect(start.getDay()).toBe(0); // Sunday
  });

  it('schedule view: returns 42-day range from cursor', () => {
    const state = makeState({ view: 'schedule', cursor: d(2026, 3, 15) });
    const [start, end] = selectVisibleRange(state);
    expect(start.getDate()).toBe(15);
    const diffDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(41);
  });

  it('month view: returns a 6-week grid anchored to the month', () => {
    // March 2026: starts on Sunday (day 0), so grid starts on March 1 (weekStartsOn=0)
    const state = makeState({ view: 'month', cursor: d(2026, 3, 15), config: { weekStartsOn: 0 } });
    const [start, end] = selectVisibleRange(state);
    expect(start.getDay()).toBe(0); // grid starts on a Sunday
    const diffDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(42); // endOfDay adds ~24h to the 41-day offset
  });
});
