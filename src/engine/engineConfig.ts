/**
 * CalendarEngine — runtime configuration and feature flags.
 *
 * Defaults live here.  Consumers override via CalendarEngineInit.config.
 */

import type { CalendarView } from './types.js';

// ─── Feature flags ────────────────────────────────────────────────────────────

export interface EngineFeatureFlags {
  /** Run validateOperation before committing move operations. */
  readonly validateOnMove: boolean;
  /** Run validateOperation before committing create operations. */
  readonly validateOnCreate: boolean;
  /** Run validateOperation before committing resize operations. */
  readonly validateOnResize: boolean;
  /** Run validateOperation before committing form-save operations. */
  readonly validateOnFormSave: boolean;
  /** Allow the user to override soft violations ("Save anyway"). */
  readonly allowSoftOverride: boolean;
  /** Enable the beginTransaction / commitTransaction / rollbackTransaction API. */
  readonly enableTransactions: boolean;
  /** Expand recurrence when calling getOccurrencesInRange. */
  readonly expandRecurrence: boolean;
}

export const DEFAULT_FEATURE_FLAGS: Readonly<EngineFeatureFlags> = {
  validateOnMove: true,
  validateOnCreate: true,
  validateOnResize: true,
  validateOnFormSave: true,
  allowSoftOverride: true,
  enableTransactions: false,
  expandRecurrence: true,
};

// ─── Runtime config ───────────────────────────────────────────────────────────

export interface EngineRuntimeConfig {
  /**
   * IANA timezone used for new events when no timezone is supplied.
   * null = floating / local time.
   */
  readonly defaultTimezone: string | null;
  /** ISO week start day: 0 = Sunday (default), 1 = Monday. */
  readonly weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly defaultView: CalendarView;
  /** Maximum recurrence occurrences expanded per series (safety cap). */
  readonly maxRecurrenceExpansions: number;
  /** Minimum allowed event duration in minutes. */
  readonly minEventDurationMinutes: number;
  /** Duration applied when creating events from a slot click (no end given). */
  readonly defaultEventDurationMinutes: number;
  /**
   * What to do when an overlap conflict is detected:
   *  - 'block' — hard violation, commit blocked
   *  - 'warn'  — soft violation, user can override
   *  - 'allow' — skip the overlap check entirely
   */
  readonly conflictPolicy: 'block' | 'warn' | 'allow';
  readonly features: Readonly<EngineFeatureFlags>;
}

export const DEFAULT_RUNTIME_CONFIG: Readonly<EngineRuntimeConfig> = {
  defaultTimezone: null,
  weekStartsOn: 0,
  defaultView: 'month',
  maxRecurrenceExpansions: 500,
  minEventDurationMinutes: 1,
  defaultEventDurationMinutes: 60,
  conflictPolicy: 'warn',
  features: DEFAULT_FEATURE_FLAGS,
};

/**
 * Merge a partial config override onto the defaults. `features` may itself
 * be partial — supplied flags are layered onto {@link DEFAULT_FEATURE_FLAGS}.
 */
export function mergeRuntimeConfig(
  override: Partial<Omit<EngineRuntimeConfig, 'features'>> & {
    readonly features?: Partial<EngineFeatureFlags>;
  } = {},
): EngineRuntimeConfig {
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...override,
    features: {
      ...DEFAULT_FEATURE_FLAGS,
      ...(override.features ?? {}),
    },
  };
}
