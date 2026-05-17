/**
 * CalendarEngine — operation result type.
 *
 * Returned by applyOperation() after the full validate + mutate pipeline.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import type { EngineOperation } from '../schema/operationSchema.js';
import type { ValidationResult } from '../validation/validationTypes.js';

// ─── Status ───────────────────────────────────────────────────────────────────

export type OperationStatus =
  | 'accepted'               // applied, no issues
  | 'accepted-with-warnings' // applied despite soft violations
  | 'rejected'               // hard violation, not applied
  | 'pending-confirmation';  // soft violation, waiting for user decision

// ─── Event change record ─────────────────────────────────────────────────────

export type EventChange =
  | { readonly type: 'created';  readonly event: EngineEvent }
  | { readonly type: 'updated';  readonly id: string; readonly before: EngineEvent; readonly after: EngineEvent }
  | { readonly type: 'deleted';  readonly id: string; readonly event: EngineEvent };

// ─── Operation result ────────────────────────────────────────────────────────

export interface OperationResult {
  readonly status: OperationStatus;
  readonly operation: EngineOperation;
  readonly validation: ValidationResult;
  /**
   * The event records that were created / updated / deleted.
   * Empty array when status === 'rejected'.
   */
  readonly changes: readonly EventChange[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isAccepted(result: OperationResult): boolean {
  return result.status === 'accepted' || result.status === 'accepted-with-warnings';
}

export function makeRejectedResult(
  operation: EngineOperation,
  validation: ValidationResult,
): OperationResult {
  return { status: 'rejected', operation, validation, changes: [] };
}

export function makePendingResult(
  operation: EngineOperation,
  validation: ValidationResult,
): OperationResult {
  return { status: 'pending-confirmation', operation, validation, changes: [] };
}
