/**
 * CalendarEngine — engine-level operation schema.
 *
 * EngineOperation is the authoritative mutation type for the engine layer.
 * It works with the new EngineEvent schema (resourceId, seriesId, etc.).
 *
 * The higher-level Operation type in types.ts covers navigation/filter
 * dispatching.  EngineOperation covers the mutable calendar data path only.
 */

import type { EngineEvent } from './eventSchema.js';

// ─── Scope for recurring edits ────────────────────────────────────────────────

/**
 * When modifying an occurrence of a recurring series, the scope controls
 * which occurrences are affected:
 *
 *   single    — only this one occurrence (detaches it from the series)
 *   following — this and all following occurrences (splits the series)
 *   series    — all occurrences (updates the series master)
 */
export type RecurringEditScope = 'single' | 'following' | 'series';

// ─── Operation source ─────────────────────────────────────────────────────────

/**
 * Where the operation originated.
 * Used for validation policy (e.g. drag moves may bypass certain checks)
 * and future audit/event-sourcing.
 */
export type OperationSource = 'drag' | 'resize' | 'form' | 'import' | 'api' | 'undo' | 'redo';

// ─── EngineOperation ─────────────────────────────────────────────────────────

export type EngineOperation =
  | {
      /** Create a new event.  id is auto-assigned if omitted. */
      readonly type: 'create';
      readonly event: Omit<Partial<EngineEvent>, 'id'> & {
        readonly title: string;
        readonly start: Date;
        readonly end: Date;
      };
      readonly source?: OperationSource | undefined;
    }
  | {
      /** Update arbitrary fields on an existing event. */
      readonly type: 'update';
      readonly id: string;
      readonly patch: Partial<Omit<EngineEvent, 'id'>>;
      readonly scope?: RecurringEditScope | undefined;
      /** Original occurrence start (needed for single/following scope). */
      readonly occurrenceDate?: Date | undefined;
      readonly source?: OperationSource | undefined;
    }
  | {
      /** Delete an event (or scope of a recurring series). */
      readonly type: 'delete';
      readonly id: string;
      readonly scope?: RecurringEditScope | undefined;
      readonly occurrenceDate?: Date | undefined;
      readonly source?: OperationSource | undefined;
    }
  | {
      /**
       * Move an event (or occurrence) to a new time slot.
       * Preserves duration unless newStart/newEnd explicitly change it.
       */
      readonly type: 'move';
      readonly id: string;
      readonly newStart: Date;
      readonly newEnd: Date;
      readonly scope?: RecurringEditScope | undefined;
      readonly occurrenceDate?: Date | undefined;
      readonly source?: OperationSource | undefined;
    }
  | {
      /**
       * Resize an event (or occurrence) by changing one or both boundaries.
       * Distinguished from move so validation can apply different rules
       * (e.g. minimum duration check).
       */
      readonly type: 'resize';
      readonly id: string;
      readonly newStart: Date;
      readonly newEnd: Date;
      readonly scope?: RecurringEditScope | undefined;
      readonly occurrenceDate?: Date | undefined;
      readonly source?: OperationSource | undefined;
    }
  | {
      /**
       * Change one or more grouping fields on an existing event (e.g. drop
       * an event into a different employee row, category bucket, etc.).
       *
       * Distinguished from 'update' so domain validators can reject invalid
       * reassignments (e.g. role-based access rules) via the dedicated
       * group-change validation hook.
       */
      readonly type: 'group-change';
      readonly id: string;
      readonly patch: Partial<Omit<EngineEvent, 'id' | 'start' | 'end'>>;
      readonly scope?: RecurringEditScope | undefined;
      readonly occurrenceDate?: Date | undefined;
      readonly source?: OperationSource | undefined;
    };

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function operationChangesTime(
  op: EngineOperation,
): op is Extract<EngineOperation, { type: 'move' | 'resize' | 'create' }> {
  return op.type === 'move' || op.type === 'resize' || op.type === 'create';
}
