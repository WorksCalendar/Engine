/**
 * Unit tests for safeMutate.
 *
 * Verifies transaction wrapping: commit on accepted/accepted-with-warnings,
 * rollback on rejected or thrown errors, and onError callback behaviour.
 */

import { describe, it, expect, vi } from 'vitest';
import { safeMutate } from '../safeMutate.js';
import { makeEvent } from '../../schema/eventSchema.js';
import type { EngineEvent } from '../../schema/eventSchema.js';
import type { OperationResult, EventChange } from '../operationResult.js';
import type { EngineOperation } from '../../schema/operationSchema.js';
import type { ValidationResult } from '../../validation/validationTypes.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const START = new Date(2026, 0, 5, 9, 0, 0);
const END   = new Date(2026, 0, 5, 10, 0, 0);

/** Minimal no-violation validation result. */
const VALID: ValidationResult = {
  allowed: true,
  severity: 'none',
  violations: [],
  suggestedPatch: null,
};

/** Minimal stub EngineOperation for building OperationResult objects. */
const STUB_OP: EngineOperation = {
  type: 'update',
  id: 'e1',
  patch: {},
};

/** Build an OperationResult with the given status and changes. */
function makeResult(
  status: OperationResult['status'],
  changes: EventChange[] = [],
): OperationResult {
  return { status, operation: STUB_OP, validation: VALID, changes };
}

/** Build an initial events map from an array of events. */
function makeMap(...evts: EngineEvent[]): ReadonlyMap<string, EngineEvent> {
  return new Map(evts.map(e => [e.id, e]));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEvt(id: string, title = 'Meeting'): EngineEvent {
  return makeEvent(id, { title, start: START, end: END });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('safeMutate', () => {

  // ── 1. accepted result ──────────────────────────────────────────────────────

  describe('accepted result', () => {
    it('returns rolledBack=false', () => {
      const events = makeMap(makeEvt('e1'));
      const result = makeResult('accepted');

      const out = safeMutate(events, () => result);

      expect(out.rolledBack).toBe(false);
    });

    it('returns the OperationResult from run()', () => {
      const events = makeMap(makeEvt('e1'));
      const result = makeResult('accepted');

      const out = safeMutate(events, () => result);

      expect(out.result).toBe(result);
    });

    it('commits a created change so the new event appears in the returned map', () => {
      const events = makeMap(makeEvt('e1'));
      const newEvt = makeEvt('e2', 'New Event');
      const change: EventChange = { type: 'created', event: newEvt };
      const result = makeResult('accepted', [change]);

      const out = safeMutate(events, () => result);

      expect(out.events.has('e2')).toBe(true);
      expect(out.events.get('e2')).toEqual(newEvt);
    });

    it('commits an updated change so the event fields are replaced', () => {
      const original = makeEvt('e1', 'Original');
      const updated  = makeEvent('e1', { title: 'Updated', start: START, end: END });
      const events   = makeMap(original);
      const change: EventChange = {
        type: 'updated',
        id: 'e1',
        before: original,
        after: updated,
      };
      const result = makeResult('accepted', [change]);

      const out = safeMutate(events, () => result);

      expect(out.events.get('e1')?.title).toBe('Updated');
    });

    it('commits a deleted change so the event is absent from the returned map', () => {
      const evt    = makeEvt('e1');
      const events = makeMap(evt);
      const change: EventChange = { type: 'deleted', id: 'e1', event: evt };
      const result = makeResult('accepted', [change]);

      const out = safeMutate(events, () => result);

      expect(out.events.has('e1')).toBe(false);
    });

    it('does not mutate the original events map', () => {
      const original = makeEvt('e1');
      const events   = makeMap(original);
      const newEvt   = makeEvt('e2');
      const change: EventChange = { type: 'created', event: newEvt };
      const result   = makeResult('accepted', [change]);

      safeMutate(events, () => result);

      expect(events.has('e2')).toBe(false);
    });
  });

  // ── 2. accepted-with-warnings result ────────────────────────────────────────

  describe('accepted-with-warnings result', () => {
    it('returns rolledBack=false', () => {
      const events = makeMap(makeEvt('e1'));
      const result = makeResult('accepted-with-warnings');

      const out = safeMutate(events, () => result);

      expect(out.rolledBack).toBe(false);
    });

    it('applies changes the same way as accepted', () => {
      const newEvt = makeEvt('e2', 'Warned Event');
      const change: EventChange = { type: 'created', event: newEvt };
      const result = makeResult('accepted-with-warnings', [change]);

      const out = safeMutate(new Map(), () => result);

      expect(out.events.has('e2')).toBe(true);
      expect(out.events.get('e2')?.title).toBe('Warned Event');
    });
  });

  // ── 3. rejected result (default rollbackOnError=true) ────────────────────────

  describe('rejected result with default rollbackOnError', () => {
    it('returns rolledBack=true', () => {
      const events = makeMap(makeEvt('e1'));
      const result = makeResult('rejected');

      const out = safeMutate(events, () => result);

      expect(out.rolledBack).toBe(true);
    });

    it('returns the original events map unchanged', () => {
      const evt    = makeEvt('e1');
      const events = makeMap(evt);
      const result = makeResult('rejected');

      const out = safeMutate(events, () => result);

      expect(out.events).toBe(events);
    });

    it('still returns the rejected OperationResult', () => {
      const events = makeMap(makeEvt('e1'));
      const result = makeResult('rejected');

      const out = safeMutate(events, () => result);

      expect(out.result).toBe(result);
    });

    it('treats pending-confirmation the same as rejected', () => {
      const events = makeMap(makeEvt('e1'));
      const result = makeResult('pending-confirmation');

      const out = safeMutate(events, () => result);

      expect(out.rolledBack).toBe(true);
      expect(out.events).toBe(events);
    });
  });

  // ── 4. rejected with rollbackOnError=false ────────────────────────────────────

  describe('rejected result with rollbackOnError=false', () => {
    it('returns rolledBack=false', () => {
      const events = makeMap(makeEvt('e1'));
      const result = makeResult('rejected');

      const out = safeMutate(events, () => result, { rollbackOnError: false });

      expect(out.rolledBack).toBe(false);
    });

    it('returns the original events map unchanged (no changes were committed)', () => {
      const events = makeMap(makeEvt('e1'));
      const result = makeResult('rejected');

      const out = safeMutate(events, () => result, { rollbackOnError: false });

      expect(out.events).toBe(events);
    });
  });

  // ── 5. run() throws (default rollbackOnError=true) ────────────────────────────

  describe('when run() throws with default rollbackOnError', () => {
    it('returns rolledBack=true', () => {
      const events = makeMap(makeEvt('e1'));

      const out = safeMutate(events, () => { throw new Error('boom'); });

      expect(out.rolledBack).toBe(true);
    });

    it('returns result=null', () => {
      const events = makeMap(makeEvt('e1'));

      const out = safeMutate(events, () => { throw new Error('boom'); });

      expect(out.result).toBeNull();
    });

    it('returns the original events map', () => {
      const events = makeMap(makeEvt('e1'));

      const out = safeMutate(events, () => { throw new Error('boom'); });

      expect(out.events).toBe(events);
    });

    it('calls onError with a structured error carrying code MUTATION_SAFE_ROLLBACK', () => {
      const events  = makeMap(makeEvt('e1'));
      const onError = vi.fn();

      safeMutate(events, () => { throw new Error('boom'); }, { onError });

      expect(onError).toHaveBeenCalledOnce();
      const [structuredError, meta] = onError.mock.calls[0] as [unknown, unknown];
      expect((structuredError as { code: string }).code).toBe('MUTATION_SAFE_ROLLBACK');
      expect((structuredError as { domain: string }).domain).toBe('mutation');
      expect((structuredError as { severity: string }).severity).toBe('error');
      expect((structuredError as { recoverable: boolean }).recoverable).toBe(true);
      expect((meta as { phase: string }).phase).toBe('mutate');
    });

    it('passes the original thrown value as cause on the structured error', () => {
      const events = makeMap(makeEvt('e1'));
      const onError = vi.fn();
      const cause = new TypeError('original cause');

      safeMutate(events, () => { throw cause; }, { onError });

      const [structuredError] = onError.mock.calls[0] as [{ cause: unknown }];
      expect(structuredError.cause).toBe(cause);
    });

    it('does not call onError when no onError option is provided', () => {
      const events = makeMap(makeEvt('e1'));

      // Should not throw even if onError is absent.
      expect(() => safeMutate(events, () => { throw new Error('silent'); })).not.toThrow();
    });
  });

  // ── 6. run() throws with rollbackOnError=false ────────────────────────────────

  describe('when run() throws with rollbackOnError=false', () => {
    it('returns rolledBack=false', () => {
      const events = makeMap(makeEvt('e1'));

      const out = safeMutate(
        events,
        () => { throw new Error('boom'); },
        { rollbackOnError: false },
      );

      expect(out.rolledBack).toBe(false);
    });

    it('still calls onError', () => {
      const events  = makeMap(makeEvt('e1'));
      const onError = vi.fn();

      safeMutate(
        events,
        () => { throw new Error('boom'); },
        { onError, rollbackOnError: false },
      );

      expect(onError).toHaveBeenCalledOnce();
    });

    it('still returns result=null', () => {
      const events = makeMap(makeEvt('e1'));

      const out = safeMutate(
        events,
        () => { throw new Error('boom'); },
        { rollbackOnError: false },
      );

      expect(out.result).toBeNull();
    });
  });

  // ── 7. created change ─────────────────────────────────────────────────────────

  describe('created change', () => {
    it('inserts the new event into the returned map', () => {
      const newEvt = makeEvent('created-1', {
        title: 'Brand New',
        start: new Date(2026, 0, 5, 9, 0, 0),
        end:   new Date(2026, 0, 5, 10, 0, 0),
      });
      const change: EventChange = { type: 'created', event: newEvt };
      const result = makeResult('accepted', [change]);

      const out = safeMutate(new Map(), () => result);

      expect(out.events.size).toBe(1);
      expect(out.events.get('created-1')).toEqual(newEvt);
    });

    it('does not affect pre-existing events', () => {
      const existing = makeEvt('existing');
      const newEvt   = makeEvt('fresh');
      const events   = makeMap(existing);
      const change: EventChange = { type: 'created', event: newEvt };
      const result   = makeResult('accepted', [change]);

      const out = safeMutate(events, () => result);

      expect(out.events.get('existing')).toEqual(existing);
    });
  });

  // ── 8. updated change ─────────────────────────────────────────────────────────

  describe('updated change', () => {
    it('replaces the event in the map with the after version', () => {
      const before  = makeEvent('u1', { title: 'Before', start: START, end: END });
      const after   = makeEvent('u1', {
        title: 'After',
        start: new Date(2026, 0, 5, 11, 0, 0),
        end:   new Date(2026, 0, 5, 12, 0, 0),
      });
      const events  = makeMap(before);
      const change: EventChange = { type: 'updated', id: 'u1', before, after };
      const result  = makeResult('accepted', [change]);

      const out = safeMutate(events, () => result);

      const stored = out.events.get('u1');
      expect(stored?.title).toBe('After');
      expect(stored?.start).toEqual(new Date(2026, 0, 5, 11, 0, 0));
    });

    it('skips the update when the id does not exist in the map', () => {
      const before = makeEvt('ghost');
      const after  = makeEvt('ghost');
      const change: EventChange = { type: 'updated', id: 'ghost', before, after };
      const result = makeResult('accepted', [change]);

      // Empty map — 'ghost' is not present.
      const out = safeMutate(new Map(), () => result);

      expect(out.events.has('ghost')).toBe(false);
    });
  });

  // ── 9. deleted change ─────────────────────────────────────────────────────────

  describe('deleted change', () => {
    it('removes the event from the returned map', () => {
      const evt    = makeEvt('del-1');
      const events = makeMap(evt);
      const change: EventChange = { type: 'deleted', id: 'del-1', event: evt };
      const result = makeResult('accepted', [change]);

      const out = safeMutate(events, () => result);

      expect(out.events.has('del-1')).toBe(false);
    });

    it('leaves other events intact', () => {
      const keep = makeEvt('keep');
      const drop = makeEvt('drop');
      const events = makeMap(keep, drop);
      const change: EventChange = { type: 'deleted', id: 'drop', event: drop };
      const result = makeResult('accepted', [change]);

      const out = safeMutate(events, () => result);

      expect(out.events.has('keep')).toBe(true);
      expect(out.events.has('drop')).toBe(false);
    });

    it('skips silently when the id does not exist in the map', () => {
      const change: EventChange = {
        type: 'deleted',
        id: 'nonexistent',
        event: makeEvt('nonexistent'),
      };
      const result = makeResult('accepted', [change]);

      const out = safeMutate(new Map(), () => result);

      expect(out.events.size).toBe(0);
    });
  });

  // ── Multiple changes in a single accepted result ───────────────────────────────

  describe('multiple changes in one accepted result', () => {
    it('applies all changes in order', () => {
      const existing = makeEvt('e1', 'Old Title');
      const events   = makeMap(existing);

      const created  = makeEvt('e2', 'Created');
      const updated  = makeEvent('e1', { title: 'Updated', start: START, end: END });

      const changes: EventChange[] = [
        { type: 'created', event: created },
        { type: 'updated', id: 'e1', before: existing, after: updated },
      ];
      const result = makeResult('accepted', changes);

      const out = safeMutate(events, () => result);

      expect(out.events.get('e1')?.title).toBe('Updated');
      expect(out.events.get('e2')?.title).toBe('Created');
    });
  });
});
