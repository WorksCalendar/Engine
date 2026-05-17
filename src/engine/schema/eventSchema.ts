/**
 * CalendarEngine — persistent event schema.
 *
 * EngineEvent is the stored record.  It is NOT the same as an occurrence —
 * a recurring series has ONE EngineEvent that expands into many occurrences
 * via expandOccurrences().
 */

import type { EventConstraint } from './constraintSchema.js';

// ─── Status ───────────────────────────────────────────────────────────────────

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';

// ─── Core event record ────────────────────────────────────────────────────────

export interface EngineEvent {
  // ── Stable identity ─────────────────────────────────────────────────────
  /** Stable string id. Numeric ids from the host app are stringified. */
  readonly id: string;

  /**
   * Non-null when this event belongs to a recurring series.
   * For a series master: seriesId === id.
   * For a detached occurrence: seriesId is the detached-from master's id.
   */
  readonly seriesId: string | null;

  /**
   * Non-null only for detached occurrence records.
   * Identifies which specific occurrence in the series this detachment covers
   * (ISO string of the original start date/time of that occurrence).
   */
  readonly occurrenceId: string | null;

  /**
   * When this record was split off from a series, detachedFrom holds the
   * original seriesId.  Used to trace ancestry and to prevent accidental
   * re-absorption into the series.
   */
  readonly detachedFrom: string | null;

  // ── Time ────────────────────────────────────────────────────────────────
  readonly start: Date;
  readonly end: Date;

  /**
   * IANA timezone identifier, e.g. "America/Denver".
   * null means the event is floating (display in local time).
   */
  readonly timezone: string | null;

  /**
   * When true, start/end times carry no meaning.
   * The end date is exclusive (iCal convention: all-day event on Mon has
   * end = Tue 00:00).
   */
  readonly allDay: boolean;

  // ── Display ─────────────────────────────────────────────────────────────
  readonly title: string;
  readonly category: string | null;
  readonly resourceId: string | null;
  /**
   * Virtual-pool reference (issue #212). When set and `resourceId` is null,
   * the engine resolves a concrete member at submit time and rewrites
   * `resourceId` on the stored record. Retained on `meta.resolvedFromPoolId`
   * for audit once resolved.
   */
  readonly resourcePoolId: string | null;
  readonly status: EventStatus;
  readonly color: string | null;

  // ── Recurrence ──────────────────────────────────────────────────────────
  /**
   * iCal RRULE string WITHOUT the "RRULE:" prefix.
   * Example: "FREQ=WEEKLY;BYDAY=MO,WE,FR"
   */
  readonly rrule: string | null;
  /** Dates excluded from the recurrence rule (EXDATE). */
  readonly exdates: readonly Date[];

  // ── Scheduling constraints ──────────────────────────────────────────────
  /**
   * Scheduling constraints on this event's start/end times.
   * Empty array = no constraints (as-soon-as-possible by default).
   * Evaluated during move/resize validation.
   */
  readonly constraints: readonly EventConstraint[];

  // ── Tenancy (issue #218) ────────────────────────────────────────────────
  /**
   * Opaque tenant/workspace identifier. Optional; unset = global or
   * legacy event. Hosts wire tenant enforcement via `src/core/tenancy`.
   */
  readonly tenantId?: string;

  // ── Arbitrary payload ───────────────────────────────────────────────────
  readonly meta: Readonly<Record<string, unknown>>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True if this event is the master record of a recurring series. */
export function isRecurringSeries(ev: EngineEvent): boolean {
  return ev.rrule !== null;
}

/** True if this event is a detached occurrence (edited independently). */
export function isDetachedOccurrence(ev: EngineEvent): boolean {
  return ev.detachedFrom !== null;
}

/** True if this event is any part of a series (master or detached). */
export function isPartOfSeries(ev: EngineEvent): boolean {
  return ev.seriesId !== null;
}

/**
 * Build a minimal valid EngineEvent from partial data.
 * Useful in tests and adapters.
 */
export function makeEvent(
  id: string,
  patch: Partial<Omit<EngineEvent, 'id'>> & { title: string; start: Date; end: Date },
): EngineEvent {
  return {
    id,
    seriesId:    null,
    occurrenceId: null,
    detachedFrom: null,
    timezone:    null,
    allDay:      false,
    category:    null,
    resourceId:  null,
    resourcePoolId: null,
    status:      'confirmed',
    color:       null,
    rrule:       null,
    exdates:     [],
    constraints: [],
    meta:        {},
    ...patch,
  };
}

// Re-export constraint type so callers can import from one place.
export type { EventConstraint } from './constraintSchema.js';
