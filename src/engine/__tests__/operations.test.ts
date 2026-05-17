/**
 * Unit tests for the CalendarEngine pure reducer (operations.ts).
 *
 * Every test is framework-free: plain objects in → plain objects out.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyOperation } from '../operations.js';
import type { CalendarState, CalendarView, FilterState } from '../types.js';
import { makeEvent } from '../schema/eventSchema.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function d(y: number, mo: number, day: number, h = 9, m = 0): Date {
  return new Date(y, mo - 1, day, h, m, 0, 0);
}

function emptyFilter(): FilterState {
  return { search: '', categories: new Set(), resources: new Set() };
}

function makeState(overrides: Partial<CalendarState> = {}): CalendarState {
  return {
    events:            new Map(),
    assignments:       new Map(),
    dependencies:      new Map(),
    resourceCalendars: new Map(),
    pools:             new Map(),
    selection:         new Set(),
    cursor:            d(2026, 1, 5),
    view:              'month' as CalendarView,
    filter:            emptyFilter(),
    config:            {},
    ...overrides,
  };
}

function makeStateWithEvent(id = 'e1') {
  const ev = makeEvent(id, {
    title: 'Test event',
    start: d(2026, 1, 5, 9),
    end:   d(2026, 1, 5, 10),
  });
  const state = makeState({ events: new Map([[id, ev]]) });
  return { state, ev };
}

// ─── Event CRUD ───────────────────────────────────────────────────────────────

describe('CREATE_EVENT', () => {
  it('adds a new event with the given id', () => {
    const state = makeState();
    const next = applyOperation(state, {
      type:  'CREATE_EVENT',
      event: makeEvent('new1', { title: 'New', start: d(2026, 1, 5, 9), end: d(2026, 1, 5, 10) }),
    });
    expect(next.events.has('new1')).toBe(true);
    expect(next.events.get('new1')?.title).toBe('New');
  });

  it('auto-generates an id when event.id is null', () => {
    const state = makeState();
    const ev = makeEvent('__will_be_replaced__', { title: 'Auto', start: d(2026, 1, 5, 9), end: d(2026, 1, 5, 10) });
    const evWithNullId = { ...ev, id: null } as unknown as typeof ev;
    const next = applyOperation(state, { type: 'CREATE_EVENT', event: evWithNullId });
    expect(next.events.size).toBe(1);
    const [id] = [...next.events.keys()];
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('does not mutate the original state', () => {
    const state = makeState();
    applyOperation(state, {
      type:  'CREATE_EVENT',
      event: makeEvent('e1', { title: 'T', start: d(2026, 1, 5, 9), end: d(2026, 1, 5, 10) }),
    });
    expect(state.events.size).toBe(0);
  });
});

describe('UPDATE_EVENT', () => {
  it('merges patch into existing event', () => {
    const { state } = makeStateWithEvent('e1');
    const next = applyOperation(state, { type: 'UPDATE_EVENT', id: 'e1', patch: { title: 'Updated' } });
    expect(next.events.get('e1')?.title).toBe('Updated');
  });

  it('preserves other fields not in patch', () => {
    const { state, ev } = makeStateWithEvent('e1');
    const next = applyOperation(state, { type: 'UPDATE_EVENT', id: 'e1', patch: { title: 'Changed' } });
    expect(next.events.get('e1')?.start).toEqual(ev.start);
  });

  it('is a no-op when event does not exist', () => {
    const state = makeState();
    const next = applyOperation(state, { type: 'UPDATE_EVENT', id: 'missing', patch: { title: 'X' } });
    expect(next).toBe(state);
  });

  it('always preserves the original id', () => {
    const { state } = makeStateWithEvent('e1');
    const next = applyOperation(state, { type: 'UPDATE_EVENT', id: 'e1', patch: { id: 'hacked' } as never });
    expect(next.events.get('e1')?.id).toBe('e1');
  });
});

describe('DELETE_EVENT', () => {
  it('removes the event from the map', () => {
    const { state } = makeStateWithEvent('e1');
    const next = applyOperation(state, { type: 'DELETE_EVENT', id: 'e1' });
    expect(next.events.has('e1')).toBe(false);
  });

  it('removes the id from selection', () => {
    const { state } = makeStateWithEvent('e1');
    const withSelection = { ...state, selection: new Set(['e1']) };
    const next = applyOperation(withSelection, { type: 'DELETE_EVENT', id: 'e1' });
    expect(next.selection.has('e1')).toBe(false);
  });

  it('is a no-op when event does not exist', () => {
    const state = makeState();
    const next = applyOperation(state, { type: 'DELETE_EVENT', id: 'gone' });
    expect(next).toBe(state);
  });
});

describe('MOVE_EVENT', () => {
  it('updates start and end', () => {
    const { state } = makeStateWithEvent('e1');
    const newStart = d(2026, 1, 10, 9);
    const newEnd   = d(2026, 1, 10, 10);
    const next = applyOperation(state, { type: 'MOVE_EVENT', id: 'e1', newStart, newEnd });
    expect(next.events.get('e1')?.start).toEqual(newStart);
    expect(next.events.get('e1')?.end).toEqual(newEnd);
  });

  it('is a no-op when event does not exist', () => {
    const state = makeState();
    const next = applyOperation(state, { type: 'MOVE_EVENT', id: 'x', newStart: d(2026,1,1), newEnd: d(2026,1,1,1) });
    expect(next).toBe(state);
  });
});

describe('RESIZE_EVENT', () => {
  it('updates start and end (delegates to moveEvent)', () => {
    const { state } = makeStateWithEvent('e1');
    const newStart = d(2026, 1, 5, 8);
    const newEnd   = d(2026, 1, 5, 11);
    const next = applyOperation(state, { type: 'RESIZE_EVENT', id: 'e1', newStart, newEnd });
    expect(next.events.get('e1')?.start).toEqual(newStart);
    expect(next.events.get('e1')?.end).toEqual(newEnd);
  });
});

// ─── Selection ────────────────────────────────────────────────────────────────

describe('SELECT_EVENT', () => {
  it('adds id to selection', () => {
    const state = makeState();
    const next = applyOperation(state, { type: 'SELECT_EVENT', id: 'e1' });
    expect(next.selection.has('e1')).toBe(true);
  });

  it('selecting an already-selected id is idempotent (set semantics)', () => {
    const state = makeState({ selection: new Set(['e1']) });
    const next = applyOperation(state, { type: 'SELECT_EVENT', id: 'e1' });
    expect(next.selection.size).toBe(1);
  });
});

describe('DESELECT_EVENT', () => {
  it('removes id from selection', () => {
    const state = makeState({ selection: new Set(['e1', 'e2']) });
    const next = applyOperation(state, { type: 'DESELECT_EVENT', id: 'e1' });
    expect(next.selection.has('e1')).toBe(false);
    expect(next.selection.has('e2')).toBe(true);
  });
});

describe('CLEAR_SELECTION', () => {
  it('empties the selection set', () => {
    const state = makeState({ selection: new Set(['a', 'b', 'c']) });
    const next = applyOperation(state, { type: 'CLEAR_SELECTION' });
    expect(next.selection.size).toBe(0);
  });
});

// ─── Navigation ───────────────────────────────────────────────────────────────

describe('NAVIGATE_NEXT', () => {
  it('advances by one month in month view', () => {
    const state = makeState({ view: 'month', cursor: new Date(2026, 0, 1) });
    const next = applyOperation(state, { type: 'NAVIGATE_NEXT' });
    expect(next.cursor.getMonth()).toBe(1); // February
  });

  it('advances by one week in week view', () => {
    const state = makeState({ view: 'week', cursor: new Date(2026, 0, 5) }); // Mon Jan 5
    const next = applyOperation(state, { type: 'NAVIGATE_NEXT' });
    expect(next.cursor.getDate()).toBe(12); // Mon Jan 12
  });

  it('advances by one day in day view', () => {
    const state = makeState({ view: 'day', cursor: new Date(2026, 0, 5) });
    const next = applyOperation(state, { type: 'NAVIGATE_NEXT' });
    expect(next.cursor.getDate()).toBe(6);
  });

  it('advances by one month for schedule view', () => {
    const state = makeState({ view: 'schedule', cursor: new Date(2026, 0, 1) });
    const next = applyOperation(state, { type: 'NAVIGATE_NEXT' });
    expect(next.cursor.getMonth()).toBe(1);
  });

  it('advances by one month for agenda view', () => {
    const state = makeState({ view: 'agenda', cursor: new Date(2026, 0, 1) });
    const next = applyOperation(state, { type: 'NAVIGATE_NEXT' });
    expect(next.cursor.getMonth()).toBe(1);
  });
});

describe('NAVIGATE_PREV', () => {
  it('goes back one month in month view', () => {
    const state = makeState({ view: 'month', cursor: new Date(2026, 1, 1) }); // Feb
    const next = applyOperation(state, { type: 'NAVIGATE_PREV' });
    expect(next.cursor.getMonth()).toBe(0); // January
  });

  it('goes back one week in week view', () => {
    const state = makeState({ view: 'week', cursor: new Date(2026, 0, 12) });
    const next = applyOperation(state, { type: 'NAVIGATE_PREV' });
    expect(next.cursor.getDate()).toBe(5);
  });

  it('goes back one day in day view', () => {
    const state = makeState({ view: 'day', cursor: new Date(2026, 0, 6) });
    const next = applyOperation(state, { type: 'NAVIGATE_PREV' });
    expect(next.cursor.getDate()).toBe(5);
  });
});

describe('NAVIGATE_TODAY', () => {
  it('sets cursor to approximately now', () => {
    const before = Date.now();
    const state = makeState({ cursor: new Date(2020, 0, 1) });
    const next = applyOperation(state, { type: 'NAVIGATE_TODAY' });
    const after = Date.now();
    expect(next.cursor.getTime()).toBeGreaterThanOrEqual(before);
    expect(next.cursor.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('NAVIGATE_TO', () => {
  it('sets cursor to the given date', () => {
    const target = new Date(2027, 5, 15);
    const state  = makeState();
    const next   = applyOperation(state, { type: 'NAVIGATE_TO', date: target });
    expect(next.cursor).toEqual(target);
  });
});

describe('SET_VIEW', () => {
  it('changes the active view', () => {
    const state = makeState({ view: 'month' });
    const next  = applyOperation(state, { type: 'SET_VIEW', view: 'week' });
    expect(next.view).toBe('week');
  });
});

// ─── Filters ──────────────────────────────────────────────────────────────────

describe('SET_SEARCH', () => {
  it('updates the search string', () => {
    const state = makeState();
    const next  = applyOperation(state, { type: 'SET_SEARCH', search: 'standup' });
    expect(next.filter.search).toBe('standup');
  });
});

describe('TOGGLE_CATEGORY', () => {
  it('adds a category when not present', () => {
    const state = makeState();
    const next  = applyOperation(state, { type: 'TOGGLE_CATEGORY', category: 'meeting' });
    expect(next.filter.categories.has('meeting')).toBe(true);
  });

  it('removes a category when already present', () => {
    const state = makeState({ filter: { ...emptyFilter(), categories: new Set(['meeting']) } });
    const next  = applyOperation(state, { type: 'TOGGLE_CATEGORY', category: 'meeting' });
    expect(next.filter.categories.has('meeting')).toBe(false);
  });
});

describe('TOGGLE_RESOURCE', () => {
  it('adds a resource when not present', () => {
    const state = makeState();
    const next  = applyOperation(state, { type: 'TOGGLE_RESOURCE', resource: 'alice' });
    expect(next.filter.resources.has('alice')).toBe(true);
  });

  it('removes a resource when already present', () => {
    const state = makeState({ filter: { ...emptyFilter(), resources: new Set(['alice']) } });
    const next  = applyOperation(state, { type: 'TOGGLE_RESOURCE', resource: 'alice' });
    expect(next.filter.resources.has('alice')).toBe(false);
  });
});

describe('CLEAR_FILTERS', () => {
  it('resets search, categories, and resources to empty', () => {
    const state = makeState({
      filter: { search: 'foo', categories: new Set(['a']), resources: new Set(['b']) },
    });
    const next = applyOperation(state, { type: 'CLEAR_FILTERS' });
    expect(next.filter.search).toBe('');
    expect(next.filter.categories.size).toBe(0);
    expect(next.filter.resources.size).toBe(0);
  });
});

// ─── Config ───────────────────────────────────────────────────────────────────

describe('SET_CONFIG', () => {
  it('merges config patch', () => {
    const state = makeState({ config: { weekStartsOn: 0 } });
    const next  = applyOperation(state, { type: 'SET_CONFIG', config: { weekStartsOn: 1 } });
    expect(next.config.weekStartsOn).toBe(1);
  });

  it('preserves existing config keys not in patch', () => {
    const state = makeState({ config: { weekStartsOn: 1 } });
    const next  = applyOperation(state, { type: 'SET_CONFIG', config: {} });
    expect(next.config.weekStartsOn).toBe(1);
  });
});

// ─── Immutability ─────────────────────────────────────────────────────────────

describe('state immutability', () => {
  it('NAVIGATE_NEXT does not mutate original cursor', () => {
    const cursor = new Date(2026, 0, 1);
    const original = cursor.getTime();
    const state  = makeState({ view: 'month', cursor });
    applyOperation(state, { type: 'NAVIGATE_NEXT' });
    expect(cursor.getTime()).toBe(original);
  });

  it('TOGGLE_CATEGORY does not mutate original categories set', () => {
    const categories = new Set(['a']);
    const state = makeState({ filter: { ...emptyFilter(), categories } });
    applyOperation(state, { type: 'TOGGLE_CATEGORY', category: 'b' });
    expect(categories.has('b')).toBe(false);
  });
});
