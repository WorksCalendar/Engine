/**
 * CalendarEngine — adapter: legacy event shape → EngineEvent.
 *
 * "Legacy" is the current normalizeEvent() output from core/eventModel.js:
 *   { id, title, start, end, allDay, category, color, resource,
 *     status, rrule, exdates, meta, _raw, _recurring?, _seriesId? }
 *
 * Use this to convert existing events into the engine schema without
 * changing the host-app's data model.
 */

import type { EngineEvent, EventStatus } from '../schema/eventSchema.js';
import { isVisualPriority } from '../../types/view.js';

// ─── Legacy shape (from normalizeEvent output) ────────────────────────────────

export interface LegacyEvent {
  id: unknown;
  title?: string;
  start: Date | string;
  end: Date | string;
  allDay?: boolean;
  category?: string | null;
  color?: string | null;
  /** Old resource field — becomes resourceId in EngineEvent. */
  resource?: string | null;
  /** Virtual pool ref (#212). Passthrough when present on migrated payloads. */
  resourcePoolId?: string | null;
  status?: string;
  rrule?: string | null;
  exdates?: Array<Date | string>;
  meta?: Record<string, unknown>;
  /** Set by useOccurrences for expanded recurring occurrences. */
  _recurring?: boolean;
  /** Set by useOccurrences — ID of the series master event. */
  _seriesId?: unknown;
  [key: string]: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDate(v: Date | string | unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string') return new Date(v);
  return new Date();
}

function toExdates(v: unknown): readonly Date[] {
  if (!Array.isArray(v)) return [];
  return v.map((d: unknown) => d instanceof Date ? d : new Date(String(d)));
}

const STATUS_MAP: Record<string, EventStatus> = {
  confirmed: 'confirmed',
  tentative: 'tentative',
  cancelled: 'cancelled',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a single legacy event into an EngineEvent.
 *
 * Key transformations:
 *   - resource       → resourceId
 *   - _seriesId      → seriesId
 *   - rrule present  → seriesId = id (series master)
 *   - _recurring     → used to set isPartOfSeries flag
 */
export function fromLegacyEvent(raw: LegacyEvent): EngineEvent {
  const id = String(raw.id ?? '');
  const hasRrule = typeof raw.rrule === 'string' && raw.rrule.length > 0;

  // Determine seriesId:
  //   - If the event has a _seriesId, it was expanded by useOccurrences
  //   - If it has an rrule, it is a series master → seriesId === id
  //   - Otherwise null
  const seriesId =
    raw._seriesId != null ? String(raw._seriesId) :
    hasRrule              ? id :
    null;

  const metaBase: Record<string, unknown> = { ...(raw.meta ?? {}) };
  if (isVisualPriority(raw['visualPriority'])) metaBase['_visualPriority'] = raw['visualPriority'];

  return {
    id,
    seriesId,
    occurrenceId:  null,       // detached occurrences not in legacy model
    detachedFrom:  null,
    start:         toDate(raw.start),
    end:           toDate(raw.end),
    timezone:      typeof raw['timezone'] === 'string' ? raw['timezone'] : null,
    allDay:        raw.allDay === true,
    title:         raw.title ?? '(untitled)',
    category:      raw.category ?? null,
    resourceId:    raw.resource ?? null,
    resourcePoolId: raw.resourcePoolId ?? null,
    status:        STATUS_MAP[raw.status ?? ''] ?? 'confirmed',
    color:         raw.color ?? null,
    rrule:         hasRrule ? raw.rrule! : null,
    exdates:       toExdates(raw.exdates),
    constraints:   [],
    meta:          metaBase,
  };
}

/** Convert an array of legacy events, preserving order. */
export function fromLegacyEvents(raws: LegacyEvent[]): EngineEvent[] {
  return raws.map(fromLegacyEvent);
}
