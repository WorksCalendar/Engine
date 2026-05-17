import { describe, it, expect } from 'vitest';
import {
  fromDragMove,
  fromDragResize,
  fromDragCreate,
  fromFormSave,
  fromFormDelete,
  fromImport,
  fromImportBatch,
} from '../buildOperation.js';
import { makeEvent } from '../../schema/eventSchema.js';

const d = (h: number) => new Date(2026, 0, 10, h, 0, 0);

const baseEv = makeEvent('ev1', { title: 'Meeting', start: d(9), end: d(10) });

// ─── fromDragMove ─────────────────────────────────────────────────────────────

describe('fromDragMove', () => {
  it('builds a move operation with type="move" and source="drag"', () => {
    const op = fromDragMove(baseEv, d(11), d(12));
    expect(op.type).toBe('move');
    expect(op.source).toBe('drag');
  });

  it('carries event id', () => {
    const op = fromDragMove(baseEv, d(11), d(12));
    expect((op as Record<string, unknown>).id).toBe('ev1');
  });

  it('carries newStart/newEnd', () => {
    const op = fromDragMove(baseEv, d(11), d(12)) as Record<string, unknown>;
    expect(op.newStart).toEqual(d(11));
    expect(op.newEnd).toEqual(d(12));
  });

  it('carries optional scope and occurrenceDate', () => {
    const occ = d(9);
    const op = fromDragMove(baseEv, d(11), d(12), 'single', occ) as Record<string, unknown>;
    expect(op.scope).toBe('single');
    expect(op.occurrenceDate).toEqual(occ);
  });

  it('scope and occurrenceDate are undefined when not provided', () => {
    const op = fromDragMove(baseEv, d(11), d(12)) as Record<string, unknown>;
    expect(op.scope).toBeUndefined();
    expect(op.occurrenceDate).toBeUndefined();
  });
});

// ─── fromDragResize ───────────────────────────────────────────────────────────

describe('fromDragResize', () => {
  it('builds a resize operation with type="resize" and source="resize"', () => {
    const op = fromDragResize(baseEv, d(9), d(12));
    expect(op.type).toBe('resize');
    expect(op.source).toBe('resize');
  });

  it('carries event id and new times', () => {
    const op = fromDragResize(baseEv, d(9), d(12)) as Record<string, unknown>;
    expect(op.id).toBe('ev1');
    expect(op.newStart).toEqual(d(9));
    expect(op.newEnd).toEqual(d(12));
  });

  it('carries optional scope and occurrenceDate', () => {
    const occ = d(9);
    const op = fromDragResize(baseEv, d(9), d(12), 'following', occ) as Record<string, unknown>;
    expect(op.scope).toBe('following');
    expect(op.occurrenceDate).toEqual(occ);
  });
});

// ─── fromDragCreate ───────────────────────────────────────────────────────────

describe('fromDragCreate', () => {
  it('builds a create operation with type="create" and source="drag"', () => {
    const op = fromDragCreate(d(9), d(10));
    expect(op.type).toBe('create');
    expect(op.source).toBe('drag');
  });

  it('defaults title to "(untitled)" when no overrides', () => {
    const op = fromDragCreate(d(9), d(10)) as Record<string, unknown>;
    expect(op.event.title).toBe('(untitled)');
  });

  it('carries start/end', () => {
    const op = fromDragCreate(d(9), d(10)) as Record<string, unknown>;
    expect(op.event.start).toEqual(d(9));
    expect(op.event.end).toEqual(d(10));
  });

  it('applies overrides', () => {
    const op = fromDragCreate(d(9), d(10), {
      title: 'Custom',
      category: 'PTO',
      resourceId: 'r1',
      color: '#ff0000',
    }) as Record<string, unknown>;
    expect(op.event.title).toBe('Custom');
    expect(op.event.category).toBe('PTO');
    expect(op.event.resourceId).toBe('r1');
    expect(op.event.color).toBe('#ff0000');
  });

  it('defaults optional overrides to null', () => {
    const op = fromDragCreate(d(9), d(10)) as Record<string, unknown>;
    expect(op.event.category).toBeNull();
    expect(op.event.resourceId).toBeNull();
    expect(op.event.color).toBeNull();
  });
});

// ─── fromFormSave ─────────────────────────────────────────────────────────────

describe('fromFormSave', () => {
  it('returns a create operation when no id is provided', () => {
    const op = fromFormSave({ title: 'New', start: d(9), end: d(10) });
    expect(op.type).toBe('create');
    expect(op.source).toBe('form');
  });

  it('returns an update operation when id is provided', () => {
    const op = fromFormSave({ id: 'ev1', title: 'Updated', start: d(9), end: d(10) });
    expect(op.type).toBe('update');
    expect(op.source).toBe('form');
  });

  it('update includes id and patch', () => {
    const op = fromFormSave({ id: 'ev1', title: 'Updated', start: d(9), end: d(10) }) as Record<string, unknown>;
    expect(op.id).toBe('ev1');
    expect(op.patch.title).toBe('Updated');
    expect(op.patch.id).toBeUndefined();
  });

  it('carries scope and occurrenceDate for update', () => {
    const occ = d(9);
    const op = fromFormSave(
      { id: 'ev1', title: 'T', start: d(9), end: d(10) },
      'single',
      occ,
    ) as Record<string, unknown>;
    expect(op.scope).toBe('single');
    expect(op.occurrenceDate).toEqual(occ);
  });

  it('create event contains the data', () => {
    const op = fromFormSave({ title: 'Event', start: d(9), end: d(10) }) as Record<string, unknown>;
    expect(op.event.title).toBe('Event');
  });
});

// ─── fromFormDelete ───────────────────────────────────────────────────────────

describe('fromFormDelete', () => {
  it('builds a delete operation with source="form"', () => {
    const op = fromFormDelete(baseEv);
    expect(op.type).toBe('delete');
    expect(op.source).toBe('form');
  });

  it('carries event id', () => {
    const op = fromFormDelete(baseEv) as Record<string, unknown>;
    expect(op.id).toBe('ev1');
  });

  it('carries optional scope and occurrenceDate', () => {
    const occ = d(9);
    const op = fromFormDelete(baseEv, 'single', occ) as Record<string, unknown>;
    expect(op.scope).toBe('single');
    expect(op.occurrenceDate).toEqual(occ);
  });
});

// ─── fromImport ───────────────────────────────────────────────────────────────

describe('fromImport', () => {
  it('builds a create operation with source="import"', () => {
    const op = fromImport({ title: 'Imported', start: d(9), end: d(10) });
    expect(op.type).toBe('create');
    expect(op.source).toBe('import');
  });

  it('carries the event data', () => {
    const op = fromImport({ title: 'Imported', start: d(9), end: d(10) }) as Record<string, unknown>;
    expect(op.event.title).toBe('Imported');
  });
});

// ─── fromImportBatch ──────────────────────────────────────────────────────────

describe('fromImportBatch', () => {
  it('converts an array of events to create operations', () => {
    const ops = fromImportBatch([
      { title: 'A', start: d(9), end: d(10) },
      { title: 'B', start: d(11), end: d(12) },
    ]);
    expect(ops).toHaveLength(2);
    expect(ops.every(op => op.type === 'create')).toBe(true);
    expect(ops.every(op => op.source === 'import')).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(fromImportBatch([])).toEqual([]);
  });
});
