/**
 * CalendarEngine — validation domain types.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import type { EngineRuntimeConfig } from '../engineConfig.js';
import type { Assignment } from '../schema/assignmentSchema.js';
import type { Dependency } from '../schema/dependencySchema.js';
import type { ResourceCalendar } from '../schema/resourceCalendarSchema.js';

// ─── Violation ───────────────────────────────────────────────────────────────

export type ViolationSeverity = 'soft' | 'hard';

export interface Violation {
  /** Machine-readable rule identifier, e.g. "overlap", "outside-business-hours". */
  readonly rule: string;
  readonly severity: ViolationSeverity;
  /** Human-readable message for the UI. */
  readonly message: string;
  /** ID of another event involved in the violation (e.g. the conflicting event). */
  readonly conflictingEventId?: string;
  /** Arbitrary extra context for the rule author. */
  readonly details?: Readonly<Record<string, unknown>>;
}

// ─── Result ──────────────────────────────────────────────────────────────────

export interface ValidationResult {
  /** True when no hard violations exist (soft violations are allowed). */
  readonly allowed: boolean;
  /** Worst severity across all violations. */
  readonly severity: 'none' | 'soft' | 'hard';
  readonly violations: readonly Violation[];
  /**
   * If a rule can compute a safe alternative (e.g. snap to business hours),
   * it puts it here.  Null when no suggestion is available.
   */
  readonly suggestedPatch?: Readonly<{ start?: Date; end?: Date }> | null;
}

export const VALID_RESULT: ValidationResult = {
  allowed: true,
  severity: 'none',
  violations: [],
  suggestedPatch: null,
};

// ─── Context ─────────────────────────────────────────────────────────────────

/**
 * Context passed to every validation rule.
 * All fields are optional to make partial context easy to construct in tests.
 */
/**
 * Change shape for group-field mutations.  Consumers plug rules into
 * OperationContext.groupChangeValidators to reject invalid reassignments.
 */
export interface GroupChangeShape {
  readonly event: EngineEvent;
  readonly patch: Readonly<Record<string, unknown>>;
}

export type GroupChangeRule = (
  change: GroupChangeShape,
  ctx: OperationContext,
) => Violation | null;

export interface OperationContext {
  /** All current events (used for overlap and dependency checks). */
  readonly events?: readonly EngineEvent[];
  /**
   * Optional rules applied to 'group-change' operations.  Each rule sees
   * the target event and the proposed patch and may return a Violation to
   * reject (hard) or warn (soft) the reassignment.
   */
  readonly groupChangeValidators?: readonly GroupChangeRule[];
  readonly businessHours?: {
    /** Day indices that are working days (0=Sun … 6=Sat). */
    readonly days: readonly number[];
    /** Decimal hours start (0–24). */
    readonly start: number;
    /** Decimal hours end (0–24). */
    readonly end: number;
  } | null;
  readonly blockedWindows?: readonly {
    readonly start: Date;
    readonly end: Date;
    readonly resourceId?: string | null;
    readonly reason?: string;
  }[];
  readonly config?: Partial<EngineRuntimeConfig>;
  /**
   * Assignments map for multi-resource overlap checking.
   * When provided, overlap validation checks all resources the event is
   * assigned to, not just the single event.resourceId field.
   */
  readonly assignments?: ReadonlyMap<string, Assignment>;
  /**
   * Dependency graph.  When provided, move/resize validation checks
   * predecessor and successor links against the proposed new times.
   */
  readonly dependencies?: ReadonlyMap<string, Dependency>;
  /**
   * Per-resource working-time calendars.  When provided, move/resize
   * validation warns when a proposed time falls in a non-working window
   * for any of the event's assigned resources.
   */
  readonly resourceCalendars?: ReadonlyMap<string, ResourceCalendar>;
}

// ─── Rule type ────────────────────────────────────────────────────────────────

export type ValidationRule<TChange = ChangeShape> = (
  change: TChange,
  ctx: OperationContext,
) => Violation | null;

/** Minimal shape a rule needs from the operation. */
export interface ChangeShape {
  readonly newStart: Date;
  readonly newEnd: Date;
  readonly event?: EngineEvent | null;
  readonly resourceId?: string | null;
}
