/**
 * CalendarEngine — master type re-export.
 *
 * Import engine types from here rather than individual schema files.
 * This is the public surface for consumers of the engine layer.
 */

// ── Schema ────────────────────────────────────────────────────────────────────
export type {
  EngineEvent,
  EventStatus,
} from './schema/eventSchema.js';

export {
  isRecurringSeries,
  isDetachedOccurrence,
  isPartOfSeries,
  makeEvent,
} from './schema/eventSchema.js';

export type { EngineOccurrence } from './schema/occurrenceSchema.js';

export type {
  EngineOperation,
  RecurringEditScope,
  OperationSource,
} from './schema/operationSchema.js';

export { operationChangesTime } from './schema/operationSchema.js';

export type { EngineResource, ResourceBusinessHours } from './schema/resourceSchema.js';

export type {
  BlockedWindow,
  BusinessHours,
  WorkingCalendar,
} from './schema/calendarSchema.js';

export { parseHours, defaultWorkingCalendar } from './schema/calendarSchema.js';

// ── Config ────────────────────────────────────────────────────────────────────
export type {
  EngineFeatureFlags,
  EngineRuntimeConfig,
} from './engineConfig.js';

export {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_RUNTIME_CONFIG,
  mergeRuntimeConfig,
} from './engineConfig.js';

// ── Error contracts ───────────────────────────────────────────────────────────
export type {
  CalendarErrorDomain,
  CalendarErrorSeverity,
  StructuredCalendarError,
  OnErrorMeta,
  OnError,
} from './errors/onError.js';

export { toStructuredError } from './errors/onError.js';

// ── Validation types ──────────────────────────────────────────────────────────
export type {
  Violation,
  ViolationSeverity,
  ValidationResult,
  OperationContext,
  ValidationRule,
  ChangeShape,
} from './validation/validationTypes.js';

export { VALID_RESULT } from './validation/validationTypes.js';

export type {
  ValidationMode,
  EventValidationCode,
  EventValidationIssue,
  EventValidationResult,
  EventIssueAction,
  EventIssueSeverity,
  ValidateEventOptions,
} from './validation/validateEvent.js';

export { validateEvent } from './validation/validateEvent.js';

// ── Operation result ──────────────────────────────────────────────────────────
export type {
  OperationResult,
  OperationStatus,
  EventChange,
} from './operations/operationResult.js';

export {
  isAccepted,
  makeRejectedResult,
  makePendingResult,
} from './operations/operationResult.js';

export type {
  SafeMutateOptions,
  SafeMutateResult,
} from './operations/safeMutate.js';

export { safeMutate } from './operations/safeMutate.js';

// ── Recurrence guards ────────────────────────────────────────────────────────
export type {
  ExpandRecurrenceSafeOptions,
  ExpandRecurrenceSafeResult,
  SeriesDiagnostic,
} from './recurrence/expandRecurrenceSafe.js';
export { expandRecurrenceSafe } from './recurrence/expandRecurrenceSafe.js';

// ── Time utilities ─────────────────────────────────────────────────────────────
export type { DateRange } from './time/rangeMath.js';

export {
  rangesOverlap,
  rangeContains,
  pointInRange,
  rangeIntersection,
  rangeUnion,
  expandRangeByDays,
  filterOverlapping,
} from './time/rangeMath.js';

export {
  clampDate,
  snapToMinutes,
  durationMs,
  durationMinutes,
  isSameDayLocal,
  hoursDecimal,
  parseHoursString,
  startOfDayLocal,
  endOfDayLocal,
} from './time/dateMath.js';

// ── Legacy types (from types.ts shell) ───────────────────────────────────────
// Keep exporting these so existing imports still work.
export type {
  CalendarView,
  FilterState,
  CalendarState,
  Operation,
  StateListener,
  Unsubscribe,
  CalendarEngineInit,
} from './types.js';
