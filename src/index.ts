/**
 * works-calendar-engine — public API
 *
 * Framework-agnostic scheduling state machine with rule-based conflict
 * detection. Pure TypeScript; only runtime dep is date-fns.
 */

// State machine
export { CalendarEngine, createInitialState } from './engine/CalendarEngine.js';
export { EventBus, channelForApprovalTransition } from './engine/eventBus.js';
export { UndoRedoManager } from './engine/UndoRedoManager.js';

// Operations
import * as buildOperation from './engine/operations/buildOperation.js';
export { buildOperation };
export type { OperationResult } from './engine/operations/operationResult.js';
export type { EngineOperation } from './engine/schema/operationSchema.js';

// Schema types
export type { EngineEvent } from './engine/schema/eventSchema.js';
export type { EngineOccurrence } from './engine/schema/occurrenceSchema.js';
export type { EngineResource } from './engine/schema/resourceSchema.js';
export type { Assignment } from './engine/schema/assignmentSchema.js';
export type { Dependency } from './engine/schema/dependencySchema.js';
export type { EventConstraint } from './engine/schema/constraintSchema.js';
export type { ResourcePool, PoolStrategy } from './engine/schema/resourcePoolSchema.js';

// Engine domain types
export type {
  CalendarView,
  CalendarState,
  FilterState,
} from './engine/types.js';

// Conflict detection
export {
  evaluateConflicts,
  CONFLICT_RULE_TYPES,
} from './conflictEngine.js';
export type {
  ConflictEvent,
  ConflictRule,
  ResourceOverlapRule,
  CategoryMutexRule,
  MinRestRule,
  CapacityOverflowRule,
  OutsideBusinessHoursRule,
  AvailabilityViolationRule,
  HoldConflictRule,
  PolicyViolationRule,
} from './conflictEngine.js';

// Availability / requirements / holds / pools
export { evaluateAvailability } from './availability/evaluateAvailability.js';
export type {
  AvailabilityWindow,
  AvailabilityResult,
  AvailabilityFailure,
  AvailabilitySuccess,
  AvailabilityReasonCode,
} from './availability/evaluateAvailability.js';

export { evaluateRequirements } from './requirements/evaluateRequirements.js';
export type {
  RequirementShortfall,
  RequirementsEvaluation,
} from './requirements/evaluateRequirements.js';

export { createHoldRegistry, findBlockingHold } from './holds/holdRegistry.js';
export type { Hold, HoldWindow } from './holds/holdRegistry.js';

export { resolvePool } from './pools/resolvePool.js';
export type {
  ResolvePoolResult,
  ResolvePoolSuccess,
  ResolvePoolError,
  ResolvePoolErrorCode,
} from './pools/resolvePool.js';

// Schedule kinds + overlap math
export {
  SCHEDULE_KINDS,
  normalizeScheduleKind,
  isOpenShiftEvent,
  isCoveringEvent,
  isShiftOrOnCallEvent,
  isCoveredShift,
  isScheduleWorkflowEvent,
  SCHEDULE_WORKFLOW_CATEGORIES,
} from './scheduleModel.js';

export {
  intervalsOverlap,
  detectShiftConflicts,
  buildOpenShiftEvent,
} from './scheduleOverlap.js';

// Recurrence
export { expandOccurrences } from './engine/recurrence/expandOccurrences.js';
export { expandRRule } from './engine/recurrence/expandRRule.js';

// Approval state machine (lightweight — no workflow DSL)
export {
  transitionApproval,
  legalActionsFrom,
  LEGAL_TRANSITIONS,
} from './approvals/transitions.js';
export {
  appendAuditEntry,
  verifyAuditChain,
  isAuditChainValid,
} from './approvals/auditChain.js';
export { lifecycleFromApprovalStage } from './approvals/lifecycleFromApprovalStage.js';

// Boundary helpers
export { normalizeEvent, normalizeEvents } from './eventModel.js';
export { createId } from './createId.js';

// Host-facing types (consumers need these to talk to the engine)
export type {
  EventStatus,
  EventLifecycleState,
  EventComment,
  ReminderDef,
  WorksCalendarEvent,
  NormalizedEvent,
  EventVisualPriority,
} from './types/events.js';
export { isLifecycleState, EVENT_LIFECYCLE_STATES, isVisualPriority } from './types/events.js';
export type {
  ApprovalStage,
  ApprovalStageId,
  ApprovalActionId,
  ApprovalHistoryActionId,
  ApprovalHistoryEntry,
  CategoryDef,
  BookingPolicy,
} from './types/assets.js';
