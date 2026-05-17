/**
 * CalendarEngine — build EngineOperations from UI actions.
 *
 * Views should call these factories instead of constructing raw operation
 * objects, so the shape stays consistent and source tagging is automatic.
 */

import type { EngineOperation, RecurringEditScope } from '../schema/operationSchema.js';
import type { EngineEvent } from '../schema/eventSchema.js';

// ─── Drag / resize / create ───────────────────────────────────────────────────

/**
 * Build a MOVE operation from a drag-end result.
 */
export function fromDragMove(
  event: EngineEvent,
  newStart: Date,
  newEnd: Date,
  scope?: RecurringEditScope,
  occurrenceDate?: Date,
): EngineOperation {
  return {
    type:           'move',
    id:             event.id,
    newStart,
    newEnd,
    scope,
    occurrenceDate,
    source:         'drag',
  };
}

/**
 * Build a RESIZE operation from a resize-handle drag.
 */
export function fromDragResize(
  event: EngineEvent,
  newStart: Date,
  newEnd: Date,
  scope?: RecurringEditScope,
  occurrenceDate?: Date,
): EngineOperation {
  return {
    type:           'resize',
    id:             event.id,
    newStart,
    newEnd,
    scope,
    occurrenceDate,
    source:         'resize',
  };
}

/**
 * Build a CREATE operation from a drag-create slot selection.
 */
export function fromDragCreate(
  start: Date,
  end: Date,
  overrides: Partial<Pick<EngineEvent, 'title' | 'category' | 'resourceId' | 'color'>> = {},
): EngineOperation {
  return {
    type: 'create',
    event: {
      title:      overrides.title      ?? '(untitled)',
      start,
      end,
      category:   overrides.category   ?? null,
      resourceId: overrides.resourceId ?? null,
      color:      overrides.color      ?? null,
    },
    source: 'drag',
  };
}

// ─── Form saves ───────────────────────────────────────────────────────────────

/**
 * Build a CREATE or UPDATE operation from a form submission.
 * If `id` is provided (editing), returns UPDATE; otherwise returns CREATE.
 */
export function fromFormSave(
  data: Partial<EngineEvent> & { title: string; start: Date; end: Date },
  scope?: RecurringEditScope,
  occurrenceDate?: Date,
): EngineOperation {
  if (data.id) {
    const { id, ...patch } = data;
    return {
      type:           'update',
      id,
      patch,
      scope,
      occurrenceDate,
      source:         'form',
    };
  }

  return {
    type:   'create',
    event:  data,
    source: 'form',
  };
}

/**
 * Build a DELETE operation.
 */
export function fromFormDelete(
  event: EngineEvent,
  scope?: RecurringEditScope,
  occurrenceDate?: Date,
): EngineOperation {
  return {
    type:           'delete',
    id:             event.id,
    scope,
    occurrenceDate,
    source:         'form',
  };
}

// ─── Import / API ────────────────────────────────────────────────────────────

/**
 * Build a CREATE operation from an imported or API-provided event.
 */
export function fromImport(
  event: Omit<Partial<EngineEvent>, 'id'> & { title: string; start: Date; end: Date },
): EngineOperation {
  return { type: 'create', event, source: 'import' };
}

/**
 * Build a batch of CREATE operations from an imported list.
 */
export function fromImportBatch(
  events: Array<Omit<Partial<EngineEvent>, 'id'> & { title: string; start: Date; end: Date }>,
): EngineOperation[] {
  return events.map(fromImport);
}
