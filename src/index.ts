/**
 * works-calendar-engine — public API
 *
 * Framework-agnostic scheduling state machine with rule-based conflict
 * detection. Pure TypeScript; only runtime dep is date-fns.
 */

// ── State machine ────────────────────────────────────────────────────────────
export { CalendarEngine, createInitialState } from './engine/CalendarEngine.js';

export * from './engine/eventBus.js';

export { UndoRedoManager } from './engine/UndoRedoManager.js';

// ── Operations ───────────────────────────────────────────────────────────────
import * as buildOperation from './engine/operations/buildOperation.js';
export { buildOperation };
export * from './engine/operations/operationResult.js';
export * from './engine/operations/safeMutate.js';
export * from './engine/operations/resolveOperationScope.js';
export * from './engine/operations/applyOperation.js';
export * from './engine/adapters/normalizeInputEvent.js';
export * from './engine/adapters/fromLegacyEvents.js';
export * from './engine/adapters/toLegacyEvents.js';

// ── Schema ───────────────────────────────────────────────────────────────────
export * from './engine/schema/eventSchema.js';
export * from './engine/schema/occurrenceSchema.js';
export * from './engine/schema/resourceSchema.js';
export * from './engine/schema/assignmentSchema.js';
export * from './engine/schema/dependencySchema.js';
export * from './engine/schema/constraintSchema.js';
export * from './engine/schema/operationSchema.js';
// engine/schema/resourcePoolSchema is a re-export shim of pools/resourcePoolSchema —
// only export the canonical one (below) to avoid duplicate-export ambiguity.
export * from './engine/schema/resourceCalendarSchema.js';
export * from './engine/schema/calendarSchema.js';

// ── Engine domain types (CalendarView, CalendarState, FilterState) ───────────
export type {
  CalendarView,
  CalendarState,
  FilterState,
} from './engine/types.js';
export * from './engine/engineConfig.js';
export * from './engine/engineTypes.js';

// ── Time utilities ───────────────────────────────────────────────────────────
export * from './engine/time/dateMath.js';
export * from './engine/time/timezone.js';
export * from './engine/time/wallClock.js';
export * from './engine/time/rangeMath.js';
export * from './engine/time/dst.js';

// ── Validation ───────────────────────────────────────────────────────────────
export * from './engine/validation/validationTypes.js';
export * from './engine/validation/validateOperation.js';

// ── Conflict detection ───────────────────────────────────────────────────────
export * from './conflictEngine.js';
export * from './conflicts/geoConflictRules.js';

// ── Availability / requirements / holds ──────────────────────────────────────
export * from './availability/evaluateAvailability.js';
export * from './availability/availabilityRule.js';

export * from './requirements/evaluateRequirements.js';
export * from './requirements/gateEventRequirements.js';
export * from './requirements/requirementTypes.js';

export * from './holds/holdRegistry.js';

// ── Resource pools (query DSL + resolution) ──────────────────────────────────
export * from './pools/resolvePool.js';
export * from './pools/evaluateQuery.js';
export * from './pools/poolQuerySchema.js';
export * from './pools/resourcePoolSchema.js';
export * from './pools/locationAdapters.js';
export * from './pools/validatePools.js';
export * from './pools/geo.js';

// ── Schedule kinds + overlap math ────────────────────────────────────────────
export * from './scheduleModel.js';
export * from './scheduleOverlap.js';
export * from './scheduleMutations.js';

// ── Recurrence ───────────────────────────────────────────────────────────────
export * from './engine/recurrence/expandOccurrences.js';
export * from './engine/recurrence/expandRecurrenceSafe.js';
export * from './engine/recurrence/expandRRule.js';
export * from './engine/recurrence/recurrenceMath.js';
export * from './engine/recurrence/resolveRecurringEdit.js';
export * from './engine/recurrence/detachOccurrence.js';
export * from './engine/recurrence/splitSeries.js';
export * from './engine/recurrence/templates.js';

// ── Selectors (read paths) ───────────────────────────────────────────────────
export * from './engine/selectors/getOccurrencesInRange.js';
export * from './engine/selectors/getOccurrencesForView.js';
export * from './engine/selectors/getEventsById.js';
export * from './engine/selectors/getSeriesById.js';

// ── Transactions ─────────────────────────────────────────────────────────────
export * from './engine/transactions/beginTransaction.js';
export * from './engine/transactions/commitTransaction.js';
export * from './engine/transactions/rollbackTransaction.js';

// ── Approval state machine (lightweight — no workflow DSL) ───────────────────
export * from './approvals/transitions.js';
export * from './approvals/auditChain.js';
export * from './approvals/lifecycleFromApprovalStage.js';
export * from './approvals/sha256.js';

// ── Boundary helpers ─────────────────────────────────────────────────────────
export * from './eventModel.js';
export { createId } from './createId.js';

// ── Geo (haversine, position guards, tracking meta) ──────────────────────────
export * from './geo/geoTypes.js';
export * from './geo/haversine.js';
export * from './geo/positionGuards.js';
export * from './geo/positionToResourceMeta.js';

// ── Tenancy ──────────────────────────────────────────────────────────────────
export * from './tenancy/tenantScope.js';

// ── Host-facing types (consumers need these to talk to the engine) ───────────
// types/events.js re-exports EventStatus which collides with the schema's;
// the schema is canonical, so we cherry-pick the host-facing additions here
// (the loose WorksCalendarEvent shape + lifecycle helpers).
export type {
  EventLifecycleState,
  EventComment,
  ReminderDef,
  WorksCalendarEvent,
  NormalizedEvent,
  EventVisualPriority,
} from './types/events.js';
export { isLifecycleState, EVENT_LIFECYCLE_STATES, isVisualPriority } from './types/events.js';
export * from './types/view.js';
export * from './types/grouping.js';
export * from './types/assets.js';
