/**
 * CalendarEngine — core domain types
 *
 * All types are framework-agnostic (no React imports).
 * Dates are plain JS Date objects throughout the engine layer.
 */

// ─── Event ────────────────────────────────────────────────────────────────────

// Canonical EngineEvent lives in ./schema/eventSchema. Re-exported here so
// existing callers that import from engine/types.ts keep working while all
// engine code agrees on a single event shape.
export type { EngineEvent } from './schema/eventSchema.js';
import type { EngineEvent } from './schema/eventSchema.js';

// ─── Filter / View state ──────────────────────────────────────────────────────

export type CalendarView =
  | 'month' | 'week' | 'day' | 'schedule'
  | 'agenda' | 'base' | 'assets' | 'dispatch' | 'requests' | 'map';

export interface FilterState {
  readonly search: string;
  /** Empty set = show all categories. */
  readonly categories: ReadonlySet<string>;
  /** Empty set = show all resources. */
  readonly resources: ReadonlySet<string>;
}

export interface BusinessHours {
  /** 0 = Sunday … 6 = Saturday */
  readonly days: ReadonlyArray<number>;
  /** "HH:MM" e.g. "09:00" */
  readonly start: string;
  /** "HH:MM" e.g. "17:00" */
  readonly end: string;
}

export interface BlockedWindow {
  readonly start: Date;
  readonly end: Date;
  readonly reason?: string;
}

export interface EngineConfig {
  readonly businessHours?: BusinessHours;
  readonly blockedWindows?: ReadonlyArray<BlockedWindow>;
  /** ISO week start day: 0 = Sunday, 1 = Monday (default 0). */
  readonly weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

// ─── Engine state ─────────────────────────────────────────────────────────────

export interface CalendarState {
  readonly events:           ReadonlyMap<string, EngineEvent>;
  /** Many-to-many join between events and resources. */
  readonly assignments:      ReadonlyMap<string, import('./schema/assignmentSchema.js').Assignment>;
  /** Scheduling dependency links between events. */
  readonly dependencies:     ReadonlyMap<string, import('./schema/dependencySchema.js').Dependency>;
  /** Per-resource working-time exception calendars. */
  readonly resourceCalendars: ReadonlyMap<string, import('./schema/resourceCalendarSchema.js').ResourceCalendar>;
  /** Virtual resource pools (#212). Resolved to concrete members at submit time. */
  readonly pools: ReadonlyMap<string, import('../pools/resourcePoolSchema.js').ResourcePool>;
  readonly view:    CalendarView;
  /** The "anchor" date — used to compute the visible range for the current view. */
  readonly cursor:  Date;
  readonly filter:  FilterState;
  readonly config:  EngineConfig;
  /** Set of event ids currently selected. */
  readonly selection: ReadonlySet<string>;
}

// ─── Operations (discriminated union) ─────────────────────────────────────────

// Event CRUD
export interface OpCreateEvent   { readonly type: 'CREATE_EVENT';  readonly event: Omit<EngineEvent, 'id'> & { id?: string }; }
export interface OpUpdateEvent   { readonly type: 'UPDATE_EVENT';  readonly id: string; readonly patch: Partial<Omit<EngineEvent, 'id'>>; }
export interface OpDeleteEvent   { readonly type: 'DELETE_EVENT';  readonly id: string; }
export interface OpMoveEvent     { readonly type: 'MOVE_EVENT';    readonly id: string; readonly newStart: Date; readonly newEnd: Date; }
export interface OpResizeEvent   { readonly type: 'RESIZE_EVENT';  readonly id: string; readonly newStart: Date; readonly newEnd: Date; }

// Selection
export interface OpSelectEvent   { readonly type: 'SELECT_EVENT';  readonly id: string; }
export interface OpDeselectEvent { readonly type: 'DESELECT_EVENT'; readonly id: string; }
export interface OpClearSelection { readonly type: 'CLEAR_SELECTION'; }

// Navigation
export interface OpSetView       { readonly type: 'SET_VIEW';      readonly view: CalendarView; }
export interface OpNavigateNext  { readonly type: 'NAVIGATE_NEXT'; }
export interface OpNavigatePrev  { readonly type: 'NAVIGATE_PREV'; }
export interface OpNavigateToday { readonly type: 'NAVIGATE_TODAY'; }
export interface OpNavigateTo    { readonly type: 'NAVIGATE_TO';   readonly date: Date; }

// Filters
export interface OpSetSearch     { readonly type: 'SET_SEARCH';    readonly search: string; }
export interface OpToggleCategory { readonly type: 'TOGGLE_CATEGORY'; readonly category: string; }
export interface OpToggleResource { readonly type: 'TOGGLE_RESOURCE'; readonly resource: string; }
export interface OpClearFilters  { readonly type: 'CLEAR_FILTERS'; }

// Config
export interface OpSetConfig     { readonly type: 'SET_CONFIG';    readonly config: Partial<EngineConfig>; }

export type Operation =
  | OpCreateEvent
  | OpUpdateEvent
  | OpDeleteEvent
  | OpMoveEvent
  | OpResizeEvent
  | OpSelectEvent
  | OpDeselectEvent
  | OpClearSelection
  | OpSetView
  | OpNavigateNext
  | OpNavigatePrev
  | OpNavigateToday
  | OpNavigateTo
  | OpSetSearch
  | OpToggleCategory
  | OpToggleResource
  | OpClearFilters
  | OpSetConfig;

// ─── Subscribers ──────────────────────────────────────────────────────────────

export type StateListener = (state: CalendarState) => void;
export type Unsubscribe = () => void;

// ─── Engine init ──────────────────────────────────────────────────────────────

export interface CalendarEngineInit {
  readonly events?:            ReadonlyArray<EngineEvent>;
  readonly assignments?:       ReadonlyArray<import('./schema/assignmentSchema.js').Assignment>;
  readonly dependencies?:      ReadonlyArray<import('./schema/dependencySchema.js').Dependency>;
  readonly resourceCalendars?: ReadonlyArray<import('./schema/resourceCalendarSchema.js').ResourceCalendar>;
  readonly pools?:             ReadonlyArray<import('../pools/resourcePoolSchema.js').ResourcePool>;
  readonly view?:   CalendarView;
  /** Defaults to today. */
  readonly cursor?: Date;
  readonly filter?: Partial<FilterState>;
  readonly config?: EngineConfig;
  /**
   * Optional lifecycle bus (issue #216). When supplied, the engine emits
   * booking.requested/approved/denied/cancelled/completed and assignment
   * lifecycle events as mutations land. Host code subscribes adapters to
   * fan out to Slack, webhooks, billing, etc.
   */
  readonly bus?: import('./eventBus.js').EventBus;
}
