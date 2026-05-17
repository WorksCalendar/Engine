/**
 * Engine op type: 'group-change'.
 *
 * Group-field mutations (dragging an event between groups, reassigning to a
 * different employee row, etc.) go through a dedicated op type so custom
 * validators can reject invalid reassignments with the standard accept /
 * soft-warn / hard-reject protocol.
 */

import { describe, it, expect } from 'vitest';
import { applyOperation } from '../operations/applyOperation.js';
import { makeEvent } from '../schema/eventSchema.js';
import type { EngineEvent } from '../schema/eventSchema.js';
import type { GroupChangeRule } from '../validation/validationTypes.js';

function d(y: number, mo: number, day: number, h = 9): Date {
  return new Date(y, mo - 1, day, h, 0, 0, 0);
}

function makeEvt(): EngineEvent {
  return makeEvent('e1', {
    title:      'Shift',
    start:      d(2026, 4, 1, 9),
    end:        d(2026, 4, 1, 17),
    category:   'Work',
    resourceId: 'alice',
  });
}

describe('group-change op', () => {
  it('accepts a patch and emits a single "updated" change', () => {
    const ev = makeEvt();
    const events = new Map([[ev.id, ev]]);

    const result = applyOperation(
      { type: 'group-change', id: 'e1', patch: { resourceId: 'bob' } },
      events,
    );

    expect(result.status).toBe('accepted');
    expect(result.changes).toHaveLength(1);
    const ch = result.changes[0];
    expect(ch!.type).toBe('updated');
    if (ch!.type === 'updated') {
      expect(ch!.before.resourceId).toBe('alice');
      expect(ch!.after.resourceId).toBe('bob');
      // Time fields are untouched by a group-change.
      expect(ch!.after.start).toEqual(ch!.before.start);
      expect(ch!.after.end).toEqual(ch!.before.end);
    }
  });

  it('supports multi-field patches (e.g. category + resource)', () => {
    const ev = makeEvt();
    const events = new Map([[ev.id, ev]]);

    const result = applyOperation(
      { type: 'group-change', id: 'e1', patch: { category: 'Exercise', resourceId: 'bob' } },
      events,
    );

    expect(result.status).toBe('accepted');
    const ch = result.changes[0];
    if (ch!.type === 'updated') {
      expect(ch!.after.category).toBe('Exercise');
      expect(ch!.after.resourceId).toBe('bob');
    }
  });

  it('no-ops (empty changes) when the id does not exist', () => {
    const result = applyOperation(
      { type: 'group-change', id: 'missing', patch: { resourceId: 'bob' } },
      new Map(),
    );
    // No existing event → nothing to change.  applyOperation returns
    // accepted with an empty change set (same as other ops' miss path).
    expect(result.status).toBe('accepted');
    expect(result.changes).toHaveLength(0);
  });

  it('is rejected when a custom validator returns a hard violation', () => {
    const ev = makeEvt();
    const events = new Map([[ev.id, ev]]);

    // Example rule: "only Alice can own the on-call shift."
    const rule: GroupChangeRule = ({ patch }) => {
      if ('resourceId' in patch && patch['resourceId'] !== 'alice') {
        return {
          rule: 'on-call-owner',
          severity: 'hard',
          message: 'Only Alice can own this shift.',
        };
      }
      return null;
    };

    const result = applyOperation(
      { type: 'group-change', id: 'e1', patch: { resourceId: 'bob' } },
      events,
      { groupChangeValidators: [rule] },
    );

    expect(result.status).toBe('rejected');
    expect(result.validation.severity).toBe('hard');
    expect(result.validation.violations[0].rule!).toBe('on-call-owner');
    expect(result.changes).toEqual([]);
  });

  it('returns pending-confirmation on a soft violation', () => {
    const ev = makeEvt();
    const events = new Map([[ev.id, ev]]);

    const rule: GroupChangeRule = () => ({
      rule: 'role-mismatch',
      severity: 'soft',
      message: 'This role normally does not take this shift.',
    });

    const result = applyOperation(
      { type: 'group-change', id: 'e1', patch: { resourceId: 'bob' } },
      events,
      { groupChangeValidators: [rule] },
    );

    expect(result.status).toBe('pending-confirmation');
    // Changes are not computed until confirmed.
    expect(result.changes).toEqual([]);
  });

  it('applies the change when the user confirms a soft violation', () => {
    const ev = makeEvt();
    const events = new Map([[ev.id, ev]]);

    const rule: GroupChangeRule = () => ({
      rule: 'role-mismatch',
      severity: 'soft',
      message: 'Soft warning.',
    });

    const result = applyOperation(
      { type: 'group-change', id: 'e1', patch: { resourceId: 'bob' } },
      events,
      { groupChangeValidators: [rule] },
      { overrideSoftViolations: true },
    );

    expect(result.status).toBe('accepted-with-warnings');
    expect(result.changes).toHaveLength(1);
  });

  it('runs with no validators by default (accept)', () => {
    const ev = makeEvt();
    const events = new Map([[ev.id, ev]]);
    const result = applyOperation(
      { type: 'group-change', id: 'e1', patch: { resourceId: 'bob' } },
      events,
    );
    expect(result.status).toBe('accepted');
  });
});
