/**
 * CalendarEngine — render-time occurrence schema.
 *
 * EngineOccurrence objects are NOT stored.  They are derived from EngineEvent
 * records by expandOccurrences() and consumed by views.
 *
 * Key distinction:
 *   - EngineEvent = 1 record per event/series (stored, persisted)
 *   - EngineOccurrence = 1 record per rendered instance (ephemeral, per range)
 */

import type { EventStatus } from './eventSchema.js';
import type { EventConstraint } from './constraintSchema.js';

export interface EngineOccurrence {
  // ── Identity ────────────────────────────────────────────────────────────
  /**
   * Unique occurrence key.
   * Format: "{eventId}" for the first/only occurrence, "{eventId}-r{n}" for
   * subsequent recurrences (where n is the 1-based index within the series).
   */
  readonly occurrenceId: string;
  /** ID of the source EngineEvent. */
  readonly eventId: string;
  /** null for non-recurring events. */
  readonly seriesId: string | null;
  /** Set when this occurrence came from a detached record. */
  readonly detachedFrom: string | null;

  // ── Time ────────────────────────────────────────────────────────────────
  /** Fully resolved start — already converted from RRULE expansion. */
  readonly start: Date;
  /** Fully resolved end. */
  readonly end: Date;
  readonly timezone: string | null;
  readonly allDay: boolean;

  // ── Display ─────────────────────────────────────────────────────────────
  readonly title: string;
  readonly category: string | null;
  readonly resourceId: string | null;
  readonly status: EventStatus;
  readonly color: string | null;

  // ── Multi-assignment ─────────────────────────────────────────────────────
  /**
   * All resource IDs assigned to this occurrence.
   * Populated from the assignments map when available; falls back to
   * [resourceId] when only the legacy single-resource field is set.
   * Empty array for unassigned events.
   */
  readonly resourceIds: readonly string[];

  // ── Recurrence metadata ─────────────────────────────────────────────────
  readonly isRecurring: boolean;
  /**
   * 0 = first (or only) occurrence in range.
   * 1+ = subsequent occurrences of the same series.
   * NOTE: this index is range-relative, not series-global.
   */
  readonly occurrenceIndex: number;

  // ── Scheduling constraints ───────────────────────────────────────────────
  /** Inherited from the source EngineEvent.constraints. */
  readonly constraints: readonly EventConstraint[];

  // ── Payload ─────────────────────────────────────────────────────────────
  readonly meta: Readonly<Record<string, unknown>>;
}
