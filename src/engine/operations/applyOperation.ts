/**
 * CalendarEngine — the central operation pipeline.
 *
 * Flow for every mutation:
 *   1. Validate (run all rules from validation/)
 *   2. If hard violation → reject (return OperationResult with status='rejected')
 *   3. If soft violation → return pending-confirmation (caller decides to confirm)
 *   4. If clean (or confirmed override) → apply the state change, return accepted
 *
 * The apply step is pure: given a Map<id, EngineEvent> and an op, it returns
 * the minimal set of EventChanges required to transition to the new state.
 *
 * Callers: CalendarEngine.dispatch() wraps this with state management.
 */

import type { EngineEvent } from '../schema/eventSchema.js';
import { makeEvent } from '../schema/eventSchema.js';
import type { EngineOperation } from '../schema/operationSchema.js';
import type { OperationContext } from '../validation/validationTypes.js';
import type {
  OperationResult,
  EventChange,
} from './operationResult.js';
import {
  makeRejectedResult,
  makePendingResult,
} from './operationResult.js';
import { validateOperation } from '../validation/validateOperation.js';
import { resolveOperationScope } from './resolveOperationScope.js';
import { resolveRecurringDelete } from '../recurrence/resolveRecurringEdit.js';
import { nextEngineId } from '../adapters/normalizeInputEvent.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ApplyOptions {
  /**
   * When true, soft violations are treated as accepted-with-warnings rather
   * than pending-confirmation.  Use when the user has already confirmed.
   */
  overrideSoftViolations?: boolean;
}

/**
 * Validate and (if allowed) apply an operation to the events map.
 *
 * @param op       The operation to apply
 * @param events   Current event map (id → EngineEvent)
 * @param ctx      Validation context (businessHours, blockedWindows, config)
 * @param opts     Behavioral overrides
 */
export function applyOperation(
  op: EngineOperation,
  events: ReadonlyMap<string, EngineEvent>,
  ctx: OperationContext = {},
  opts: ApplyOptions = {},
): OperationResult {
  const eventList = Array.from(events.values());

  // 1. Validate
  const validation = validateOperation(op, ctx, eventList);

  // 2. Hard violation → reject
  if (!validation.allowed) {
    return makeRejectedResult(op, validation);
  }

  // 3. Soft violation + not confirmed → pending
  if (validation.severity === 'soft' && !opts.overrideSoftViolations) {
    return makePendingResult(op, validation);
  }

  // 4. Apply
  const changes = computeChanges(op, events, eventList);
  const status  = validation.severity === 'soft' ? 'accepted-with-warnings' : 'accepted';

  return { status, operation: op, validation, changes };
}

// ─── Change computation ───────────────────────────────────────────────────────

function computeChanges(
  op: EngineOperation,
  events: ReadonlyMap<string, EngineEvent>,
  eventList: EngineEvent[],
): EventChange[] {
  switch (op.type) {
    case 'create':  return applyCreate(op, events);
    case 'update':  return applyUpdate(op, events, eventList);
    case 'delete':  return applyDelete(op, events, eventList);
    case 'move':    return applyMove(op, events, eventList);
    case 'resize':  return applyResize(op, events, eventList);
    case 'group-change': return applyGroupChange(op, events);
    default: {
      const _x: never = op;
      return [];
    }
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

function applyCreate(
  op: Extract<EngineOperation, { type: 'create' }>,
  _events: ReadonlyMap<string, EngineEvent>,
): EventChange[] {
  const id = nextEngineId();
  const raw = op.event;
  const hasRrule = typeof raw.rrule === 'string' && raw.rrule.length > 0;

  const event = makeEvent(id, {
    title:        raw.title,
    start:        raw.start,
    end:          raw.end,
    timezone:     raw.timezone     ?? null,
    allDay:       raw.allDay       ?? false,
    category:     raw.category     ?? null,
    resourceId:   raw.resourceId   ?? null,
    resourcePoolId: raw.resourcePoolId ?? null,
    status:       raw.status       ?? 'confirmed',
    color:        raw.color        ?? null,
    rrule:        raw.rrule        ?? null,
    exdates:      raw.exdates      ?? [],
    meta:         raw.meta         ?? {},
    seriesId:     hasRrule ? id : null,
    occurrenceId: null,
    detachedFrom: null,
  });

  return [{ type: 'created', event }];
}

// ─── Update ───────────────────────────────────────────────────────────────────

function applyUpdate(
  op: Extract<EngineOperation, { type: 'update' }>,
  events: ReadonlyMap<string, EngineEvent>,
  eventList: EngineEvent[],
): EventChange[] {
  const existing = events.get(op.id);
  if (!existing) return [];

  // Handle single/following recurring scope via resolveOperationScope.
  if (op.scope && op.scope !== 'series' && op.occurrenceDate) {
    const resolved = resolveOperationScope(op, existing, eventList);
    if (resolved.needsRecurringResolution) return resolved.changes ?? [];
  }

  // For series-scope updates that originated from an occurrence (occurrenceDate
  // is set), strip start/end from the patch before applying to the master.
  //
  // Why: the EventForm always sends the occurrence's current start/end in the
  // patch even when the user didn't change them.  Spreading these onto the
  // master would anchor the series to the occurrence date, shifting all future
  // occurrences.  Non-time fields (title, color, category, etc.) are safe to
  // copy as-is.  Explicit time changes to the whole series must come from a
  // move/resize op (which uses newStart/newEnd), not from a form update.
  if (op.scope === 'series' && op.occurrenceDate && existing.rrule) {
     
    const { start: _s, end: _e, ...safePatch } = op.patch as Record<string, unknown>;
    const after: EngineEvent = { ...existing, ...safePatch, id: op.id };
    return [{ type: 'updated', id: op.id, before: existing, after }];
  }

  const after: EngineEvent = { ...existing, ...op.patch, id: op.id };
  return [{ type: 'updated', id: op.id, before: existing, after }];
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function applyDelete(
  op: Extract<EngineOperation, { type: 'delete' }>,
  events: ReadonlyMap<string, EngineEvent>,
  _eventList: EngineEvent[],
): EventChange[] {
  const existing = events.get(op.id);
  if (!existing) return [];

  // Recurring scoped delete: never use edit resolution (which would recreate
  // the occurrence as a detached event).  Instead use delete-specific logic:
  //   single    → add EXDATE to master (excludes this occurrence, nothing created)
  //   following → set UNTIL on master (terminates series, nothing created)
  //   series    → fall through to delete the whole master below
  if (op.scope && op.scope !== 'series' && op.occurrenceDate && existing.rrule) {
    return resolveRecurringDelete(existing, op.occurrenceDate, op.scope);
  }

  return [{ type: 'deleted', id: op.id, event: existing }];
}

// ─── Move ─────────────────────────────────────────────────────────────────────

function applyMove(
  op: Extract<EngineOperation, { type: 'move' }>,
  events: ReadonlyMap<string, EngineEvent>,
  eventList: EngineEvent[],
): EventChange[] {
  const existing = events.get(op.id);
  if (!existing) return [];

  // Handle recurring scope
  if (op.scope && op.scope !== 'series' && op.occurrenceDate) {
    const resolved = resolveOperationScope(op, existing, eventList);
    if (resolved.needsRecurringResolution) return resolved.changes ?? [];
  }

  const after: EngineEvent = { ...existing, start: op.newStart, end: op.newEnd };
  return [{ type: 'updated', id: op.id, before: existing, after }];
}

// ─── Group-change ─────────────────────────────────────────────────────────────

function applyGroupChange(
  op: Extract<EngineOperation, { type: 'group-change' }>,
  events: ReadonlyMap<string, EngineEvent>,
): EventChange[] {
  const existing = events.get(op.id);
  if (!existing) return [];
  // Patch shape forbids id/start/end at the type level, so spreading is safe.
  const after: EngineEvent = { ...existing, ...op.patch, id: op.id };
  return [{ type: 'updated', id: op.id, before: existing, after }];
}

// ─── Resize ───────────────────────────────────────────────────────────────────

function applyResize(
  op: Extract<EngineOperation, { type: 'resize' }>,
  events: ReadonlyMap<string, EngineEvent>,
  eventList: EngineEvent[],
): EventChange[] {
  // Resize shares the same state transition as move
  const moveOp: Extract<EngineOperation, { type: 'move' }> = { ...op, type: 'move' };
  return applyMove(moveOp, events, eventList);
}
