/**
 * Unit tests for dependencySchema.ts
 *
 * Covers makeDependency, constrainedAnchor, isDependencyViolated,
 * successorsOf, predecessorsOf, hasCycle, and wouldCreateCycle.
 * All functions are pure — no mocking required.
 */
import { describe, it, expect } from 'vitest';
import {
  makeDependency,
  constrainedAnchor,
  isDependencyViolated,
  successorsOf,
  predecessorsOf,
  hasCycle,
  wouldCreateCycle,
} from '../dependencySchema.js';
import type { Dependency, DependencyType } from '../dependencySchema.js';

// ─── Shared fixture helpers ───────────────────────────────────────────────────

function dep(
  id: string,
  from: string,
  to: string,
  type: DependencyType = 'finish-to-start',
  lagMs = 0,
): Dependency {
  return { id, fromEventId: from, toEventId: to, type, lagMs };
}

function depsMap(...deps: Dependency[]): ReadonlyMap<string, Dependency> {
  return new Map(deps.map(d => [d.id, d]));
}

// Dates used across multiple tests (Monday 5 Jan 2026)
const T = {
  h8:  new Date(2026, 0, 5,  8,  0),   // 08:00
  h9:  new Date(2026, 0, 5,  9,  0),   // 09:00
  h10: new Date(2026, 0, 5, 10,  0),   // 10:00
  h11: new Date(2026, 0, 5, 11,  0),   // 11:00
  h12: new Date(2026, 0, 5, 12,  0),   // 12:00
};

// ─── makeDependency ───────────────────────────────────────────────────────────

describe('makeDependency', () => {
  it('applies default type finish-to-start when patch omits type', () => {
    const d = makeDependency('d1', { fromEventId: 'A', toEventId: 'B' });
    expect(d.type).toBe('finish-to-start');
  });

  it('applies default lagMs of 0 when patch omits lagMs', () => {
    const d = makeDependency('d1', { fromEventId: 'A', toEventId: 'B' });
    expect(d.lagMs).toBe(0);
  });

  it('preserves the supplied id', () => {
    const d = makeDependency('my-dep', { fromEventId: 'A', toEventId: 'B' });
    expect(d.id).toBe('my-dep');
  });

  it('uses supplied fromEventId and toEventId', () => {
    const d = makeDependency('d1', { fromEventId: 'ev-1', toEventId: 'ev-2' });
    expect(d.fromEventId).toBe('ev-1');
    expect(d.toEventId).toBe('ev-2');
  });

  it('patch can override type to start-to-start', () => {
    const d = makeDependency('d1', {
      fromEventId: 'A',
      toEventId: 'B',
      type: 'start-to-start',
    });
    expect(d.type).toBe('start-to-start');
  });

  it('patch can override type to finish-to-finish', () => {
    const d = makeDependency('d1', {
      fromEventId: 'A',
      toEventId: 'B',
      type: 'finish-to-finish',
    });
    expect(d.type).toBe('finish-to-finish');
  });

  it('patch can override type to start-to-finish', () => {
    const d = makeDependency('d1', {
      fromEventId: 'A',
      toEventId: 'B',
      type: 'start-to-finish',
    });
    expect(d.type).toBe('start-to-finish');
  });

  it('patch can override lagMs to a positive value', () => {
    const d = makeDependency('d1', {
      fromEventId: 'A',
      toEventId: 'B',
      lagMs: 3_600_000,
    });
    expect(d.lagMs).toBe(3_600_000);
  });

  it('patch can override lagMs to a negative value (lead)', () => {
    const d = makeDependency('d1', {
      fromEventId: 'A',
      toEventId: 'B',
      lagMs: -1_800_000,
    });
    expect(d.lagMs).toBe(-1_800_000);
  });

  it('patch overrides both type and lagMs simultaneously', () => {
    const d = makeDependency('d1', {
      fromEventId: 'A',
      toEventId: 'B',
      type: 'finish-to-finish',
      lagMs: 900_000,
    });
    expect(d.type).toBe('finish-to-finish');
    expect(d.lagMs).toBe(900_000);
  });
});

// ─── constrainedAnchor ────────────────────────────────────────────────────────

describe('constrainedAnchor', () => {
  // All four types with zero lag

  it('finish-to-start: returns fromEnd + 0 (= fromEnd) with zero lag', () => {
    const d = dep('d', 'A', 'B', 'finish-to-start', 0);
    expect(constrainedAnchor(d, T.h9, T.h10)).toEqual(T.h10);
  });

  it('start-to-start: returns fromStart + 0 (= fromStart) with zero lag', () => {
    const d = dep('d', 'A', 'B', 'start-to-start', 0);
    expect(constrainedAnchor(d, T.h9, T.h10)).toEqual(T.h9);
  });

  it('finish-to-finish: returns fromEnd + 0 (= fromEnd) with zero lag', () => {
    const d = dep('d', 'A', 'B', 'finish-to-finish', 0);
    expect(constrainedAnchor(d, T.h9, T.h10)).toEqual(T.h10);
  });

  it('start-to-finish: returns fromStart + 0 (= fromStart) with zero lag', () => {
    const d = dep('d', 'A', 'B', 'start-to-finish', 0);
    expect(constrainedAnchor(d, T.h9, T.h10)).toEqual(T.h9);
  });

  // Non-zero positive lag (1 hour = 3 600 000 ms)

  it('finish-to-start: adds positive lag to fromEnd', () => {
    const lag = 3_600_000; // +1 h
    const d = dep('d', 'A', 'B', 'finish-to-start', lag);
    const expected = new Date(T.h10.getTime() + lag); // 11:00
    expect(constrainedAnchor(d, T.h9, T.h10)).toEqual(expected);
  });

  it('start-to-start: adds positive lag to fromStart', () => {
    const lag = 3_600_000;
    const d = dep('d', 'A', 'B', 'start-to-start', lag);
    const expected = new Date(T.h9.getTime() + lag); // 10:00
    expect(constrainedAnchor(d, T.h9, T.h10)).toEqual(expected);
  });

  it('finish-to-finish: adds positive lag to fromEnd', () => {
    const lag = 3_600_000;
    const d = dep('d', 'A', 'B', 'finish-to-finish', lag);
    const expected = new Date(T.h10.getTime() + lag); // 11:00
    expect(constrainedAnchor(d, T.h9, T.h10)).toEqual(expected);
  });

  it('start-to-finish: adds positive lag to fromStart', () => {
    const lag = 3_600_000;
    const d = dep('d', 'A', 'B', 'start-to-finish', lag);
    const expected = new Date(T.h9.getTime() + lag); // 10:00
    expect(constrainedAnchor(d, T.h9, T.h10)).toEqual(expected);
  });

  // Negative lag (lead — successor may overlap predecessor)

  it('finish-to-start: subtracts lead from fromEnd (negative lagMs)', () => {
    const lead = -1_800_000; // -30 min
    const d = dep('d', 'A', 'B', 'finish-to-start', lead);
    const expected = new Date(T.h10.getTime() - 1_800_000); // 09:30
    expect(constrainedAnchor(d, T.h9, T.h10)).toEqual(expected);
  });

  it('start-to-start: subtracts lead from fromStart (negative lagMs)', () => {
    const lead = -1_800_000;
    const d = dep('d', 'A', 'B', 'start-to-start', lead);
    const expected = new Date(T.h9.getTime() - 1_800_000); // 08:30
    expect(constrainedAnchor(d, T.h9, T.h10)).toEqual(expected);
  });

  it('returns a new Date object (not the same reference as base)', () => {
    const d = dep('d', 'A', 'B', 'finish-to-start', 0);
    const result = constrainedAnchor(d, T.h9, T.h10);
    expect(result).not.toBe(T.h10);
    expect(result).toEqual(T.h10);
  });
});

// ─── isDependencyViolated ─────────────────────────────────────────────────────

describe('isDependencyViolated', () => {
  // finish-to-start (FS) — successor.start must be >= fromEnd + lag

  describe('finish-to-start', () => {
    const fsDep = dep('d', 'A', 'B', 'finish-to-start', 0);

    it('not violated: successor starts exactly when predecessor ends', () => {
      // fromEnd = 10:00, toStart = 10:00 → toStart === anchor → not violated
      expect(isDependencyViolated(fsDep, T.h9, T.h10, T.h10, T.h11)).toBe(false);
    });

    it('not violated: successor starts after predecessor ends', () => {
      expect(isDependencyViolated(fsDep, T.h9, T.h10, T.h11, T.h12)).toBe(false);
    });

    it('violated: successor starts before predecessor ends', () => {
      // toStart = 09:00 < anchor 10:00
      expect(isDependencyViolated(fsDep, T.h9, T.h10, T.h9, T.h11)).toBe(true);
    });

    it('violated: positive lag pushes anchor ahead', () => {
      const fsLag = dep('d', 'A', 'B', 'finish-to-start', 3_600_000); // +1 h
      // anchor = 10:00 + 1h = 11:00, toStart = 10:30 < 11:00 → violated
      const toStart = new Date(2026, 0, 5, 10, 30);
      expect(isDependencyViolated(fsLag, T.h9, T.h10, toStart, T.h12)).toBe(true);
    });

    it('not violated: negative lag (lead) allows earlier start', () => {
      const fsLead = dep('d', 'A', 'B', 'finish-to-start', -3_600_000); // -1 h
      // anchor = 10:00 - 1h = 09:00, toStart = 09:00 === anchor → not violated
      expect(isDependencyViolated(fsLead, T.h9, T.h10, T.h9, T.h11)).toBe(false);
    });
  });

  // start-to-start (SS) — successor.start must be >= fromStart + lag

  describe('start-to-start', () => {
    const ssDep = dep('d', 'A', 'B', 'start-to-start', 0);

    it('not violated: successor starts exactly when predecessor starts', () => {
      expect(isDependencyViolated(ssDep, T.h9, T.h10, T.h9, T.h11)).toBe(false);
    });

    it('not violated: successor starts after predecessor starts', () => {
      expect(isDependencyViolated(ssDep, T.h9, T.h10, T.h10, T.h11)).toBe(false);
    });

    it('violated: successor starts before predecessor starts', () => {
      expect(isDependencyViolated(ssDep, T.h9, T.h10, T.h8, T.h11)).toBe(true);
    });
  });

  // finish-to-finish (FF) — successor.end must be >= fromEnd + lag

  describe('finish-to-finish', () => {
    const ffDep = dep('d', 'A', 'B', 'finish-to-finish', 0);

    it('not violated: successor ends exactly when predecessor ends', () => {
      // fromEnd = 10:00, toEnd = 10:00 → toEnd === anchor → not violated
      expect(isDependencyViolated(ffDep, T.h9, T.h10, T.h9, T.h10)).toBe(false);
    });

    it('not violated: successor ends after predecessor ends', () => {
      expect(isDependencyViolated(ffDep, T.h9, T.h10, T.h9, T.h11)).toBe(false);
    });

    it('violated: successor ends before predecessor ends', () => {
      // toEnd = 09:30 < anchor 10:00
      const toEnd = new Date(2026, 0, 5, 9, 30);
      expect(isDependencyViolated(ffDep, T.h9, T.h10, T.h8, toEnd)).toBe(true);
    });
  });

  // start-to-finish (SF) — successor.end must be >= fromStart + lag

  describe('start-to-finish', () => {
    const sfDep = dep('d', 'A', 'B', 'start-to-finish', 0);

    it('not violated: successor ends exactly when predecessor starts', () => {
      // fromStart = 09:00, toEnd = 09:00 → toEnd === anchor → not violated
      expect(isDependencyViolated(sfDep, T.h9, T.h10, T.h8, T.h9)).toBe(false);
    });

    it('not violated: successor ends after predecessor starts', () => {
      expect(isDependencyViolated(sfDep, T.h9, T.h10, T.h8, T.h10)).toBe(false);
    });

    it('violated: successor ends before predecessor starts', () => {
      // toEnd = 08:00 < anchor 09:00
      expect(isDependencyViolated(sfDep, T.h9, T.h10, T.h8, T.h8)).toBe(true);
    });
  });
});

// ─── successorsOf ─────────────────────────────────────────────────────────────

describe('successorsOf', () => {
  it('returns empty array for empty deps map', () => {
    expect(successorsOf(new Map(), 'A')).toEqual([]);
  });

  it('returns empty array when no dep has this eventId as fromEventId', () => {
    const deps = depsMap(dep('d1', 'B', 'C'));
    expect(successorsOf(deps, 'A')).toEqual([]);
  });

  it('returns the single matching dependency', () => {
    const d1 = dep('d1', 'A', 'B');
    const deps = depsMap(d1, dep('d2', 'B', 'C'));
    expect(successorsOf(deps, 'A')).toEqual([d1]);
  });

  it('returns multiple matching dependencies', () => {
    const d1 = dep('d1', 'A', 'B');
    const d2 = dep('d2', 'A', 'C');
    const d3 = dep('d3', 'X', 'Y');
    const deps = depsMap(d1, d2, d3);
    const result = successorsOf(deps, 'A');
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(d1);
    expect(result).toContainEqual(d2);
  });

  it('does not include deps where eventId is only the toEventId', () => {
    const deps = depsMap(dep('d1', 'X', 'A')); // A is to, not from
    expect(successorsOf(deps, 'A')).toEqual([]);
  });
});

// ─── predecessorsOf ───────────────────────────────────────────────────────────

describe('predecessorsOf', () => {
  it('returns empty array for empty deps map', () => {
    expect(predecessorsOf(new Map(), 'B')).toEqual([]);
  });

  it('returns empty array when no dep has this eventId as toEventId', () => {
    const deps = depsMap(dep('d1', 'A', 'C'));
    expect(predecessorsOf(deps, 'B')).toEqual([]);
  });

  it('returns the single matching dependency', () => {
    const d1 = dep('d1', 'A', 'B');
    const deps = depsMap(d1, dep('d2', 'B', 'C'));
    expect(predecessorsOf(deps, 'B')).toEqual([d1]);
  });

  it('returns multiple matching dependencies', () => {
    const d1 = dep('d1', 'A', 'C');
    const d2 = dep('d2', 'B', 'C');
    const d3 = dep('d3', 'X', 'Y');
    const deps = depsMap(d1, d2, d3);
    const result = predecessorsOf(deps, 'C');
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(d1);
    expect(result).toContainEqual(d2);
  });

  it('does not include deps where eventId is only the fromEventId', () => {
    const deps = depsMap(dep('d1', 'B', 'X')); // B is from, not to
    expect(predecessorsOf(deps, 'B')).toEqual([]);
  });
});

// ─── hasCycle ─────────────────────────────────────────────────────────────────

describe('hasCycle', () => {
  it('returns false for an empty deps map', () => {
    expect(hasCycle(new Map())).toBe(false);
  });

  it('returns false for a single dependency (A→B)', () => {
    expect(hasCycle(depsMap(dep('d1', 'A', 'B')))).toBe(false);
  });

  it('returns false for a linear chain A→B→C', () => {
    const deps = depsMap(dep('d1', 'A', 'B'), dep('d2', 'B', 'C'));
    expect(hasCycle(deps)).toBe(false);
  });

  it('returns false for two separate chains (A→B and X→Y)', () => {
    const deps = depsMap(dep('d1', 'A', 'B'), dep('d2', 'X', 'Y'));
    expect(hasCycle(deps)).toBe(false);
  });

  it('returns false for a diamond (A→B, A→C, B→D, C→D — no cycle)', () => {
    const deps = depsMap(
      dep('d1', 'A', 'B'),
      dep('d2', 'A', 'C'),
      dep('d3', 'B', 'D'),
      dep('d4', 'C', 'D'),
    );
    expect(hasCycle(deps)).toBe(false);
  });

  it('returns true for a direct cycle A→B→A', () => {
    const deps = depsMap(dep('d1', 'A', 'B'), dep('d2', 'B', 'A'));
    expect(hasCycle(deps)).toBe(true);
  });

  it('returns true for a triangle cycle A→B, B→C, C→A', () => {
    const deps = depsMap(
      dep('d1', 'A', 'B'),
      dep('d2', 'B', 'C'),
      dep('d3', 'C', 'A'),
    );
    expect(hasCycle(deps)).toBe(true);
  });

  it('returns true for a cycle in one branch of a larger graph', () => {
    // X→Y is clean, but A→B→C→A is cyclic
    const deps = depsMap(
      dep('d1', 'X', 'Y'),
      dep('d2', 'A', 'B'),
      dep('d3', 'B', 'C'),
      dep('d4', 'C', 'A'),
    );
    expect(hasCycle(deps)).toBe(true);
  });

  it('returns true for a self-loop A→A (if added directly)', () => {
    // Build the map manually — makeDependency doesn't prevent self-loops
    const selfLoop = new Map<string, Dependency>([
      ['d1', { id: 'd1', fromEventId: 'A', toEventId: 'A', type: 'finish-to-start', lagMs: 0 }],
    ]);
    expect(hasCycle(selfLoop)).toBe(true);
  });
});

// ─── wouldCreateCycle ─────────────────────────────────────────────────────────

describe('wouldCreateCycle', () => {
  it('returns false for an empty existing-deps map (any edge is safe)', () => {
    expect(wouldCreateCycle(new Map(), 'A', 'B')).toBe(false);
  });

  it('returns false when adding an unrelated edge to a DAG', () => {
    const existing = depsMap(dep('d1', 'A', 'B'), dep('d2', 'B', 'C'));
    expect(wouldCreateCycle(existing, 'X', 'Y')).toBe(false);
  });

  it('returns false when extending the chain forward (C→D on A→B→C)', () => {
    const existing = depsMap(dep('d1', 'A', 'B'), dep('d2', 'B', 'C'));
    expect(wouldCreateCycle(existing, 'C', 'D')).toBe(false);
  });

  it('returns true when adding B→A to existing A→B (direct cycle)', () => {
    const existing = depsMap(dep('d1', 'A', 'B'));
    expect(wouldCreateCycle(existing, 'B', 'A')).toBe(true);
  });

  it('returns true when adding C→A to existing A→B→C (triangle)', () => {
    const existing = depsMap(dep('d1', 'A', 'B'), dep('d2', 'B', 'C'));
    expect(wouldCreateCycle(existing, 'C', 'A')).toBe(true);
  });

  it('returns true when adding D→A to existing A→B→C→D (long chain)', () => {
    const existing = depsMap(
      dep('d1', 'A', 'B'),
      dep('d2', 'B', 'C'),
      dep('d3', 'C', 'D'),
    );
    expect(wouldCreateCycle(existing, 'D', 'A')).toBe(true);
  });

  it('returns true for a self-loop (fromEventId === toEventId)', () => {
    // Can reach 'A' from 'A' immediately — stack starts with [toEventId='A'],
    // pops 'A', compares against fromEventId='A' → true
    expect(wouldCreateCycle(new Map(), 'A', 'A')).toBe(true);
  });

  it('does not confuse separate chains (adding X→Y does not cycle A→B)', () => {
    const existing = depsMap(dep('d1', 'A', 'B'));
    expect(wouldCreateCycle(existing, 'X', 'Y')).toBe(false);
  });

  it('returns false when adding an edge that is already in the map (no new cycle)', () => {
    // A→B already exists; adding another A→B again makes no new cycle
    const existing = depsMap(dep('d1', 'A', 'B'), dep('d2', 'B', 'C'));
    expect(wouldCreateCycle(existing, 'A', 'B')).toBe(false);
  });
});
