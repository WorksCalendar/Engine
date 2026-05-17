/**
 * Requirement template types — minimal shape needed by `evaluateRequirements`.
 *
 * In the monolith these live alongside the broader `CalendarConfig` (which
 * stays a host concern). The engine only needs the requirement slot/severity
 * shape, so the relevant types are inlined here.
 */

export type ConfigRequirementSeverity = 'hard' | 'soft';

export type ConfigRequirementSlot =
  | { readonly role: string; readonly count: number; readonly severity?: ConfigRequirementSeverity }
  | { readonly pool: string; readonly count: number; readonly severity?: ConfigRequirementSeverity };

export interface ConfigRequirement {
  readonly eventType: string;
  readonly requires: readonly ConfigRequirementSlot[];
}
