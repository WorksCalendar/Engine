/**
 * CalendarEngine — Scheduling constraint schema.
 *
 * Constraints pin an event's start or end to an absolute date, independently
 * of dependency propagation.  They model user intent ("this MUST start on
 * Monday") and are stored directly on the event record.
 *
 * Type map (mirrors MS Project / Bryntum / Primavera P6 conventions):
 *
 *   asap            — As Soon As Possible (no pin; default; no date required)
 *   alap            — As Late As Possible (no pin; no date required)
 *   must-start-on   — start === date  (hard pin)
 *   must-end-on     — end   === date  (hard pin)
 *   snet            — Start No Earlier Than date
 *   snlt            — Start No Later Than date
 *   enet            — End No Earlier Than date
 *   enlt            — End No Later Than date
 *
 * 'asap'/'alap' produce soft violations when violated.
 * must-start-on/must-end-on produce hard violations.
 * snet/snlt/enet/enlt produce soft violations by default (configurable).
 */

export type ConstraintType =
  | 'asap'
  | 'alap'
  | 'must-start-on'
  | 'must-end-on'
  | 'snet'   // Start No Earlier Than
  | 'snlt'   // Start No Later Than
  | 'enet'   // End No Earlier Than
  | 'enlt';  // End No Later Than

export interface EventConstraint {
  readonly type: ConstraintType;
  /**
   * Required for all types except 'asap' and 'alap'.
   * Ignored (and harmless) when type is 'asap' or 'alap'.
   */
  readonly date?: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return true when a proposed [start, end] satisfies the constraint.
 * Time-only comparison: millisecond precision.
 */
export function satisfiesConstraint(
  c: EventConstraint,
  start: Date,
  end: Date,
): boolean {
  const d = c.date?.getTime();
  switch (c.type) {
    case 'asap':
    case 'alap':
      return true;
    case 'must-start-on':
      return d !== undefined && start.getTime() === d;
    case 'must-end-on':
      return d !== undefined && end.getTime()   === d;
    case 'snet':
      return d !== undefined && start.getTime() >= d;
    case 'snlt':
      return d !== undefined && start.getTime() <= d;
    case 'enet':
      return d !== undefined && end.getTime()   >= d;
    case 'enlt':
      return d !== undefined && end.getTime()   <= d;
  }
}

/**
 * Whether violating this constraint is a hard error (blocks commit) or
 * a soft warning (requires confirmation).
 */
export function constraintSeverity(c: EventConstraint): 'hard' | 'soft' {
  return c.type === 'must-start-on' || c.type === 'must-end-on' ? 'hard' : 'soft';
}

/** Human-readable description for UI display. */
export function describeConstraint(c: EventConstraint): string {
  const d = c.date ? c.date.toLocaleDateString() : '';
  switch (c.type) {
    case 'asap':           return 'As Soon As Possible';
    case 'alap':           return 'As Late As Possible';
    case 'must-start-on':  return `Must start on ${d}`;
    case 'must-end-on':    return `Must end on ${d}`;
    case 'snet':           return `Start no earlier than ${d}`;
    case 'snlt':           return `Start no later than ${d}`;
    case 'enet':           return `End no earlier than ${d}`;
    case 'enlt':           return `End no later than ${d}`;
  }
}
