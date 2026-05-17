/**
 * CalendarEngine — Dependency schema.
 *
 * A Dependency models a scheduling link between two events:
 * the predecessor (fromEvent) must respect a timing constraint relative
 * to the successor (toEvent).
 *
 * Standard CPM (Critical Path Method) link types:
 *
 *   FS  finish-to-start   — successor starts after predecessor ends (default)
 *   SS  start-to-start    — successor starts after predecessor starts
 *   FF  finish-to-finish  — successor ends after predecessor ends
 *   SF  start-to-finish   — successor ends after predecessor starts (rare)
 *
 * Positive lagMs = delay between predecessor and successor.
 * Negative lagMs = lead (the successor may start before the predecessor ends).
 */

export type DependencyType =
  | 'finish-to-start'
  | 'start-to-start'
  | 'finish-to-finish'
  | 'start-to-finish';

export interface Dependency {
  readonly id: string;
  readonly fromEventId: string;
  readonly toEventId: string;
  /** Defaults to 'finish-to-start'. */
  readonly type: DependencyType;
  /**
   * Lag in milliseconds.
   * Positive = mandatory delay after the anchor point.
   * Negative = lead (overlap allowed).
   * Default 0.
   */
  readonly lagMs: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function makeDependency(
  id: string,
  patch: Pick<Dependency, 'fromEventId' | 'toEventId'> & Partial<Omit<Dependency, 'id'>>,
): Dependency {
  return {
    id,
    type: 'finish-to-start',
    lagMs: 0,
    ...patch,
  };
}

/**
 * Compute the earliest allowed start (or end) time for the successor side
 * of a dependency, given the predecessor's current start and end.
 *
 * Returns the anchor time + lag.  The caller is responsible for comparing
 * against the successor's actual start/end.
 */
export function constrainedAnchor(
  dep: Dependency,
  fromStart: Date,
  fromEnd: Date,
): Date {
  let base: Date;
  switch (dep.type) {
    case 'finish-to-start':  base = fromEnd;   break;
    case 'start-to-start':   base = fromStart; break;
    case 'finish-to-finish': base = fromEnd;   break;
    case 'start-to-finish':  base = fromStart; break;
  }
  return new Date(base.getTime() + dep.lagMs);
}

/**
 * Return true if moving/resizing the predecessor would put the successor
 * in violation of the link (successor's current start is before anchor + lag).
 *
 * toStart is the current (or proposed) start of the successor event.
 * toEnd   is the current (or proposed) end   of the successor event.
 */
export function isDependencyViolated(
  dep: Dependency,
  fromStart: Date,
  fromEnd: Date,
  toStart: Date,
  toEnd: Date,
): boolean {
  const anchor = constrainedAnchor(dep, fromStart, fromEnd);
  switch (dep.type) {
    case 'finish-to-start':  return toStart.getTime() < anchor.getTime();
    case 'start-to-start':   return toStart.getTime() < anchor.getTime();
    case 'finish-to-finish': return toEnd.getTime()   < anchor.getTime();
    case 'start-to-finish':  return toEnd.getTime()   < anchor.getTime();
  }
}

/** All dependencies where eventId is the predecessor (fromEventId). */
export function successorsOf(
  deps: ReadonlyMap<string, Dependency>,
  eventId: string,
): Dependency[] {
  const result: Dependency[] = [];
  for (const d of deps.values()) {
    if (d.fromEventId === eventId) result.push(d);
  }
  return result;
}

/** All dependencies where eventId is the successor (toEventId). */
export function predecessorsOf(
  deps: ReadonlyMap<string, Dependency>,
  eventId: string,
): Dependency[] {
  const result: Dependency[] = [];
  for (const d of deps.values()) {
    if (d.toEventId === eventId) result.push(d);
  }
  return result;
}

/**
 * Detect cycles in the dependency graph using iterative DFS.
 * Returns true if a cycle exists (the dependency graph is not a DAG).
 */
export function hasCycle(deps: ReadonlyMap<string, Dependency>): boolean {
  // Build adjacency list: eventId → [successorEventIds]
  const adj = new Map<string, string[]>();
  for (const d of deps.values()) {
    if (!adj.has(d.fromEventId)) adj.set(d.fromEventId, []);
    adj.get(d.fromEventId)!.push(d.toEventId);
  }

  const visited  = new Set<string>();
  const inStack  = new Set<string>();

  function dfs(node: string): boolean {
    if (inStack.has(node)) return true;  // back-edge → cycle
    if (visited.has(node)) return false; // already fully processed
    visited.add(node);
    inStack.add(node);
    for (const neighbour of adj.get(node) ?? []) {
      if (dfs(neighbour)) return true;
    }
    inStack.delete(node);
    return false;
  }

  for (const node of adj.keys()) {
    if (!visited.has(node) && dfs(node)) return true;
  }
  return false;
}

/**
 * Detect whether adding a new edge fromEventId → toEventId would create a cycle.
 * More efficient than hasCycle when you only need to check one proposed edge.
 */
export function wouldCreateCycle(
  existing: ReadonlyMap<string, Dependency>,
  fromEventId: string,
  toEventId: string,
): boolean {
  // Can we reach fromEventId starting from toEventId?
  // If yes, adding from→to would close a cycle.
  const visited = new Set<string>();
  const stack   = [toEventId];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === fromEventId) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const d of existing.values()) {
      if (d.fromEventId === node) stack.push(d.toEventId);
    }
  }
  return false;
}
