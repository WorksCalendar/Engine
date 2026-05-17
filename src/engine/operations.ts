/**
 * CalendarEngine — pure state-transition functions.
 *
 * Every function is a pure reducer: (CalendarState, Operation) → CalendarState.
 * No side effects, no React, no I/O.
 */

import { addDays, addWeeks, addMonths } from 'date-fns';
import type {
  CalendarState,
  EngineEvent,
  FilterState,
  Operation,
} from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _autoId = 0;
function nextId(): string {
  return `_engine_${++_autoId}_${Date.now()}`;
}

function withEvents(
  state: CalendarState,
  updater: (map: Map<string, EngineEvent>) => Map<string, EngineEvent>,
): CalendarState {
  return { ...state, events: updater(new Map(state.events)) };
}

function withFilter(
  state: CalendarState,
  updater: (f: FilterState) => FilterState,
): CalendarState {
  return { ...state, filter: updater(state.filter) };
}

// ─── Event CRUD ───────────────────────────────────────────────────────────────

function createEvent(state: CalendarState, op: Extract<Operation, { type: 'CREATE_EVENT' }>): CalendarState {
  const id = (op.event.id != null ? String(op.event.id) : null) ?? nextId();
  const event: EngineEvent = { ...op.event, id };
  return withEvents(state, m => { m.set(id, event); return m; });
}

function updateEvent(state: CalendarState, op: Extract<Operation, { type: 'UPDATE_EVENT' }>): CalendarState {
  const existing = state.events.get(op.id);
  if (!existing) return state;
  const updated: EngineEvent = { ...existing, ...op.patch, id: op.id };
  return withEvents(state, m => { m.set(op.id, updated); return m; });
}

function deleteEvent(state: CalendarState, op: Extract<Operation, { type: 'DELETE_EVENT' }>): CalendarState {
  if (!state.events.has(op.id)) return state;
  const nextSelection = new Set(state.selection);
  nextSelection.delete(op.id);
  return {
    ...withEvents(state, m => { m.delete(op.id); return m; }),
    selection: nextSelection,
  };
}

function moveEvent(state: CalendarState, op: Extract<Operation, { type: 'MOVE_EVENT' }>): CalendarState {
  const existing = state.events.get(op.id);
  if (!existing) return state;
  const updated: EngineEvent = { ...existing, start: op.newStart, end: op.newEnd };
  return withEvents(state, m => { m.set(op.id, updated); return m; });
}

function resizeEvent(state: CalendarState, op: Extract<Operation, { type: 'RESIZE_EVENT' }>): CalendarState {
  // Same shape as moveEvent — distinguished at dispatch level for validation.
  return moveEvent(state, { type: 'MOVE_EVENT', id: op.id, newStart: op.newStart, newEnd: op.newEnd });
}

// ─── Selection ────────────────────────────────────────────────────────────────

function selectEvent(state: CalendarState, op: Extract<Operation, { type: 'SELECT_EVENT' }>): CalendarState {
  const next = new Set(state.selection);
  next.add(op.id);
  return { ...state, selection: next };
}

function deselectEvent(state: CalendarState, op: Extract<Operation, { type: 'DESELECT_EVENT' }>): CalendarState {
  const next = new Set(state.selection);
  next.delete(op.id);
  return { ...state, selection: next };
}

function clearSelection(state: CalendarState): CalendarState {
  return { ...state, selection: new Set() };
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function navigationStep(view: string): 'month' | 'week' | 'day' {
  if (view === 'week')  return 'week';
  if (view === 'day')   return 'day';
  // month, schedule, agenda, base, assets, dispatch, requests, map → monthly step
  return 'month';
}

function navigateNext(state: CalendarState): CalendarState {
  const { view, cursor } = state;
  const step = navigationStep(view);
  const next = step === 'month' ? addMonths(cursor, 1)
             : step === 'week'  ? addWeeks(cursor, 1)
             :                    addDays(cursor, 1);
  return { ...state, cursor: next };
}

function navigatePrev(state: CalendarState): CalendarState {
  const { view, cursor } = state;
  const step = navigationStep(view);
  const next = step === 'month' ? addMonths(cursor, -1)
             : step === 'week'  ? addWeeks(cursor, -1)
             :                    addDays(cursor, -1);
  return { ...state, cursor: next };
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function toggleSet(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function toggleCategory(state: CalendarState, op: Extract<Operation, { type: 'TOGGLE_CATEGORY' }>): CalendarState {
  return withFilter(state, f => ({ ...f, categories: toggleSet(f.categories, op.category) }));
}

function toggleResource(state: CalendarState, op: Extract<Operation, { type: 'TOGGLE_RESOURCE' }>): CalendarState {
  return withFilter(state, f => ({ ...f, resources: toggleSet(f.resources, op.resource) }));
}

function clearFilters(state: CalendarState): CalendarState {
  return withFilter(state, f => ({ ...f, search: '', categories: new Set(), resources: new Set() }));
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export function applyOperation(state: CalendarState, op: Operation): CalendarState {
  switch (op.type) {
    // Event CRUD
    case 'CREATE_EVENT':    return createEvent(state, op);
    case 'UPDATE_EVENT':    return updateEvent(state, op);
    case 'DELETE_EVENT':    return deleteEvent(state, op);
    case 'MOVE_EVENT':      return moveEvent(state, op);
    case 'RESIZE_EVENT':    return resizeEvent(state, op);

    // Selection
    case 'SELECT_EVENT':    return selectEvent(state, op);
    case 'DESELECT_EVENT':  return deselectEvent(state, op);
    case 'CLEAR_SELECTION': return clearSelection(state);

    // Navigation
    case 'NAVIGATE_NEXT':   return navigateNext(state);
    case 'NAVIGATE_PREV':   return navigatePrev(state);
    case 'NAVIGATE_TODAY':  return { ...state, cursor: new Date() };
    case 'NAVIGATE_TO':     return { ...state, cursor: op.date };
    case 'SET_VIEW':        return { ...state, view: op.view };

    // Filters
    case 'SET_SEARCH':      return withFilter(state, f => ({ ...f, search: op.search }));
    case 'TOGGLE_CATEGORY': return toggleCategory(state, op);
    case 'TOGGLE_RESOURCE': return toggleResource(state, op);
    case 'CLEAR_FILTERS':   return clearFilters(state);

    // Config
    case 'SET_CONFIG':      return { ...state, config: { ...state.config, ...op.config } };

    default: {
      const _exhaustive: never = op;
      console.warn('[CalendarEngine] Unknown operation:', (_exhaustive as Operation).type);
      return state;
    }
  }
}
