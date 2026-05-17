/**
 * viewScope — single source of truth for "which events belong in which tab".
 *
 * Every calendar view (month, week, day, agenda, schedule, base, assets)
 * declares its predicate here. `useTabScopedEvents` and the FilterBar option
 * builders both consult this registry so they can never drift apart. Adding a
 * new view = one entry in VIEW_SCOPES.
 */
import { isScheduleWorkflowEvent, SCHEDULE_TAB_CATEGORY_SEEDS } from './scheduleModel.js';

export type ViewId = 'month' | 'week' | 'day' | 'agenda' | 'schedule' | 'base' | 'assets' | 'dispatch' | 'requests' | 'map';

export type ViewScopeContext = {
  employees: Array<{ id: string; base?: string | null }>;
  assets:    Array<{ id: string; meta?: { base?: string | null } | null }>;
  bases:     Array<{ id: string; name: string }>;
  selectedBaseIds: string[];
};

/**
 * Saved-view fields owned by an individual view. Each view declares which of
 * these it contributes to a saved view; `captureSavedViewFields` picks only
 * those keys off a context object at save time.
 */
export type SavedViewCaptureField =
  | 'groupBy'
  | 'sort'
  | 'showAllGroups'
  | 'zoomLevel'
  | 'collapsedGroups'
  | 'selectedBaseIds';

export type SavedViewCaptureCtx = Partial<Record<SavedViewCaptureField, unknown>>;

/**
 * Generic helper return type: preserves the caller's exact value types so the
 * captured fields can be spread into `saveView`/`resaveView` without widening
 * to `unknown`.
 */
type CapturedFields<T extends SavedViewCaptureCtx> = Partial<Pick<T, SavedViewCaptureField & keyof T>>;

export interface ViewScope {
  id: ViewId;
  includes(ev: unknown, ctx: ViewScopeContext): boolean;
  seedCategoryOptions?: readonly string[];
  /**
   * Which saved-view fields this view owns. `captureSavedViewFields` reads
   * these keys off a live-state ctx at save time. Omit (or leave empty) for
   * views that only contribute `filters` + `view`. Sanitization still runs
   * inside `useSavedViews`, so this is a pass-through whitelist, not a
   * validator.
   */
  persistedFields?: readonly SavedViewCaptureField[];
}

function includesForBase(ev: unknown, ctx: ViewScopeContext): boolean {
  const baseIds = ctx.selectedBaseIds.length > 0
    ? ctx.selectedBaseIds.map(String)
    : ctx.bases.map(b => String(b.id));
  if (baseIds.length === 0) return false;

  const rec = (ev != null && typeof ev === 'object') ? (ev as Record<string, unknown>) : {};
  const meta = (rec['meta'] != null && typeof rec['meta'] === 'object') ? (rec['meta'] as Record<string, unknown>) : {};
  const metaBase = meta['base'];
  if (metaBase != null && baseIds.includes(String(metaBase))) return true;

  if (rec['resource'] == null) return false;
  const resource = String(rec['resource']);

  for (const id of baseIds) {
    const emp = ctx.employees.find(e => String(e.base ?? '') === id && String(e.id) === resource);
    if (emp) return true;
    const asset = ctx.assets.find(a => String(a?.meta?.base ?? '') === id && String(a.id) === resource);
    if (asset) return true;
  }
  return false;
}

type ScheduleLike = Parameters<typeof isScheduleWorkflowEvent>[0];

export const VIEW_SCOPES: Record<ViewId, ViewScope> = Object.freeze({
  month:    { id: 'month',    includes: ev => !isScheduleWorkflowEvent(ev as ScheduleLike) },
  week:     { id: 'week',     includes: ev => !isScheduleWorkflowEvent(ev as ScheduleLike) },
  day:      { id: 'day',      includes: ev => !isScheduleWorkflowEvent(ev as ScheduleLike) },
  agenda: {
    id: 'agenda',
    includes: ev => !isScheduleWorkflowEvent(ev as ScheduleLike),
    persistedFields: ['groupBy', 'sort', 'showAllGroups'],
  },
  schedule: {
    id: 'schedule',
    includes: ev => isScheduleWorkflowEvent(ev as ScheduleLike),
    seedCategoryOptions: SCHEDULE_TAB_CATEGORY_SEEDS,
    persistedFields: ['groupBy', 'sort'],
  },
  base: {
    id: 'base',
    includes: includesForBase,
    persistedFields: ['selectedBaseIds'],
  },
  assets: {
    id: 'assets',
    includes: () => true,
    persistedFields: ['groupBy', 'sort', 'zoomLevel', 'collapsedGroups'],
  },
  // Dispatch reads the full event pool to compute per-asset readiness at a
  // user-chosen as-of time, so we accept everything here. Filters still
  // apply via the host pipeline; this just makes scoping a no-op.
  dispatch: { id: 'dispatch', includes: () => true },
  // Requests view shows every event with an approval stage so the queue
  // is independent of the calendar's currentDate filter; the view itself
  // applies the stage filter strip on top of the loaded set.
  requests: { id: 'requests', includes: () => true },
  map:      { id: 'map',      includes: () => true },
});

export function getViewScope(view: string): ViewScope {
  return (VIEW_SCOPES as Record<string, ViewScope>)[view] ?? VIEW_SCOPES.month;
}

/**
 * Pick only the saved-view fields the active view owns out of `ctx`.
 * Undefined entries are dropped; everything else is passed through verbatim
 * for `useSavedViews` to sanitize. Safe to spread into `saveView`/`resaveView`.
 *
 * Generic over the input ctx so callers' precise value types survive into the
 * returned object — spreading the result into a typed options bag won't widen
 * the captured fields to `unknown`.
 */
export function captureSavedViewFields<T extends SavedViewCaptureCtx>(
  view: string,
  ctx: T,
): CapturedFields<T> {
  const fields = getViewScope(view).persistedFields;
  if (!fields || fields.length === 0) return {} as CapturedFields<T>;
  const out: Partial<T> = {};
  for (const f of fields) {
    if (ctx[f] !== undefined) out[f as keyof T] = ctx[f as keyof T];
  }
  return out as CapturedFields<T>;
}
