/**
 * CalendarEngine — normalize raw/partial input into a full EngineEvent.
 *
 * This is the single gate for all inbound event data:
 *   - form saves
 *   - drag-create
 *   - import / paste
 *   - API payloads
 *
 * It assigns missing IDs, coerces dates, defaults nullables, and ensures
 * the durable recurrence fields are properly initialized.
 */

import { parseISO, isValid, addHours } from 'date-fns';
import type { EngineEvent, EventStatus } from '../schema/eventSchema.js';
import type { EventConstraint, ConstraintType } from '../schema/constraintSchema.js';

// ─── Internal ID counter ──────────────────────────────────────────────────────

let _counter = 0;

export function nextEngineId(): string {
  return `eng-${++_counter}-${Date.now()}`;
}

// ─── Date coercion ────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isValid(v) ? v : null;
  if (typeof v === 'number') {
    const d = new Date(v);
    return isValid(d) ? d : null;
  }
  if (typeof v === 'string') {
    const d = parseISO(v);
    return isValid(d) ? d : null;
  }
  return null;
}

function toDateArray(v: unknown): Date[] {
  if (!Array.isArray(v)) return [];
  return v.map(toDate).filter((d): d is Date => d !== null);
}

// ─── Constraint coercion ──────────────────────────────────────────────────────

const VALID_CONSTRAINT_TYPES: ConstraintType[] = [
  'asap', 'alap', 'must-start-on', 'must-end-on',
  'snet', 'snlt', 'enet', 'enlt',
];

function toConstraints(v: unknown): readonly EventConstraint[] {
  if (!Array.isArray(v)) return [];
  const result: EventConstraint[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (!VALID_CONSTRAINT_TYPES.includes(c['type'] as ConstraintType)) continue;
    const d = c['date'] ? toDate(c['date']) : null;
    result.push({
      type: c['type'] as ConstraintType,
      ...(d !== null && { date: d }),
    });
  }
  return result;
}

// ─── Status coercion ──────────────────────────────────────────────────────────

const VALID_STATUSES: EventStatus[] = ['confirmed', 'tentative', 'cancelled'];

function toStatus(v: unknown): EventStatus {
  if (typeof v === 'string' && VALID_STATUSES.includes(v as EventStatus)) {
    return v as EventStatus;
  }
  return 'confirmed';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Any shape that might come in from the outside world. */
export type RawInputEvent = Record<string, unknown>;

/**
 * Normalize an arbitrary object into a complete, valid EngineEvent.
 *
 * Safe to call with any partial or poorly-typed input.
 * Returns a fully-populated EngineEvent with no undefined fields.
 */
export function normalizeInputEvent(raw: RawInputEvent): EngineEvent {
  const rawId = raw['id'] != null ? String(raw['id']) : null;
  const id    = rawId ?? nextEngineId();

  const start = toDate(raw['start']) ?? new Date();
  const end   = toDate(raw['end']) ?? addHours(start, 1);

  // Handle seriesId: if the event has rrule, it IS a series master → seriesId === id
  const hasRrule = typeof raw['rrule'] === 'string' && raw['rrule'].length > 0;
  const seriesId =
    raw['seriesId'] != null ? String(raw['seriesId']) :
    hasRrule             ? id :
    null;

  return {
    id,
    seriesId,
    occurrenceId:  raw['occurrenceId']  != null ? String(raw['occurrenceId'])  : null,
    detachedFrom:  raw['detachedFrom']  != null ? String(raw['detachedFrom'])  : null,
    start,
    end,
    timezone:      typeof raw['timezone'] === 'string' && raw['timezone'] ? raw['timezone'] : null,
    allDay:        raw['allDay'] === true,
    title:         typeof raw['title'] === 'string' && raw['title'] ? raw['title'] : '(untitled)',
    category:      typeof raw['category'] === 'string' ? raw['category'] : null,
    resourceId:    raw['resourceId'] != null ? String(raw['resourceId'])
                   : raw['resource'] != null ? String(raw['resource'])   // legacy field
                   : null,
    resourcePoolId: raw['resourcePoolId'] != null ? String(raw['resourcePoolId']) : null,
    status:        toStatus(raw['status']),
    color:         typeof raw['color'] === 'string' ? raw['color'] : null,
    rrule:         hasRrule ? String(raw['rrule']) : null,
    exdates:       toDateArray(raw['exdates']),
    constraints:   toConstraints(raw['constraints']),
    meta:          raw['meta'] != null && typeof raw['meta'] === 'object' && !Array.isArray(raw['meta'])
                   ? raw['meta'] as Record<string, unknown>
                   : {},
  };
}

/** Normalize an array of raw events, silently dropping any that throw. */
export function normalizeInputEvents(raws: unknown[]): EngineEvent[] {
  if (!Array.isArray(raws)) return [];
  const result: EngineEvent[] = [];
  for (const raw of raws) {
    try {
      result.push(normalizeInputEvent(raw as RawInputEvent));
    } catch {
      // skip malformed
    }
  }
  return result;
}
