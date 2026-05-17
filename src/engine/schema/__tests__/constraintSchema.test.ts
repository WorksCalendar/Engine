import { describe, it, expect } from 'vitest';
import {
  satisfiesConstraint,
  constraintSeverity,
  describeConstraint,
} from '../constraintSchema.js';
import type { EventConstraint } from '../constraintSchema.js';

const date = new Date(2026, 0, 10, 9, 0, 0); // Jan 10, 09:00
const before = new Date(2026, 0, 9, 9, 0, 0);  // Jan 9
const after  = new Date(2026, 0, 11, 9, 0, 0); // Jan 11

function c(type: EventConstraint['type'], d?: Date): EventConstraint {
  return d ? { type, date: d } : { type };
}

// ─── satisfiesConstraint ──────────────────────────────────────────────────────

describe('satisfiesConstraint', () => {
  it('asap always returns true', () => {
    expect(satisfiesConstraint(c('asap'), before, after)).toBe(true);
    expect(satisfiesConstraint(c('asap'), after, after)).toBe(true);
  });

  it('alap always returns true', () => {
    expect(satisfiesConstraint(c('alap'), before, after)).toBe(true);
  });

  it('must-start-on: true when start exactly equals date', () => {
    expect(satisfiesConstraint(c('must-start-on', date), date, after)).toBe(true);
  });

  it('must-start-on: false when start differs', () => {
    expect(satisfiesConstraint(c('must-start-on', date), before, after)).toBe(false);
    expect(satisfiesConstraint(c('must-start-on', date), after, after)).toBe(false);
  });

  it('must-start-on: false when no date provided', () => {
    expect(satisfiesConstraint(c('must-start-on'), date, after)).toBe(false);
  });

  it('must-end-on: true when end exactly equals date', () => {
    expect(satisfiesConstraint(c('must-end-on', date), before, date)).toBe(true);
  });

  it('must-end-on: false when end differs', () => {
    expect(satisfiesConstraint(c('must-end-on', date), before, after)).toBe(false);
  });

  it('snet (Start No Earlier Than): true when start >= date', () => {
    expect(satisfiesConstraint(c('snet', date), date, after)).toBe(true);
    expect(satisfiesConstraint(c('snet', date), after, after)).toBe(true);
  });

  it('snet: false when start < date', () => {
    expect(satisfiesConstraint(c('snet', date), before, after)).toBe(false);
  });

  it('snlt (Start No Later Than): true when start <= date', () => {
    expect(satisfiesConstraint(c('snlt', date), before, after)).toBe(true);
    expect(satisfiesConstraint(c('snlt', date), date, after)).toBe(true);
  });

  it('snlt: false when start > date', () => {
    expect(satisfiesConstraint(c('snlt', date), after, after)).toBe(false);
  });

  it('enet (End No Earlier Than): true when end >= date', () => {
    expect(satisfiesConstraint(c('enet', date), before, date)).toBe(true);
    expect(satisfiesConstraint(c('enet', date), before, after)).toBe(true);
  });

  it('enet: false when end < date', () => {
    expect(satisfiesConstraint(c('enet', date), before, before)).toBe(false);
  });

  it('enlt (End No Later Than): true when end <= date', () => {
    expect(satisfiesConstraint(c('enlt', date), before, date)).toBe(true);
    expect(satisfiesConstraint(c('enlt', date), before, before)).toBe(true);
  });

  it('enlt: false when end > date', () => {
    expect(satisfiesConstraint(c('enlt', date), before, after)).toBe(false);
  });
});

// ─── constraintSeverity ───────────────────────────────────────────────────────

describe('constraintSeverity', () => {
  it('returns hard for must-start-on', () => {
    expect(constraintSeverity(c('must-start-on', date))).toBe('hard');
  });

  it('returns hard for must-end-on', () => {
    expect(constraintSeverity(c('must-end-on', date))).toBe('hard');
  });

  it('returns soft for asap', () => {
    expect(constraintSeverity(c('asap'))).toBe('soft');
  });

  it('returns soft for alap', () => {
    expect(constraintSeverity(c('alap'))).toBe('soft');
  });

  it('returns soft for snet', () => {
    expect(constraintSeverity(c('snet', date))).toBe('soft');
  });

  it('returns soft for snlt', () => {
    expect(constraintSeverity(c('snlt', date))).toBe('soft');
  });

  it('returns soft for enet', () => {
    expect(constraintSeverity(c('enet', date))).toBe('soft');
  });

  it('returns soft for enlt', () => {
    expect(constraintSeverity(c('enlt', date))).toBe('soft');
  });
});

// ─── describeConstraint ───────────────────────────────────────────────────────

describe('describeConstraint', () => {
  it('asap returns readable string', () => {
    expect(describeConstraint(c('asap'))).toBe('As Soon As Possible');
  });

  it('alap returns readable string', () => {
    expect(describeConstraint(c('alap'))).toBe('As Late As Possible');
  });

  it('must-start-on includes formatted date', () => {
    const desc = describeConstraint(c('must-start-on', date));
    expect(desc).toMatch(/Must start on/);
  });

  it('must-end-on includes formatted date', () => {
    const desc = describeConstraint(c('must-end-on', date));
    expect(desc).toMatch(/Must end on/);
  });

  it('snet includes date', () => {
    const desc = describeConstraint(c('snet', date));
    expect(desc).toMatch(/Start no earlier than/);
  });

  it('snlt includes date', () => {
    const desc = describeConstraint(c('snlt', date));
    expect(desc).toMatch(/Start no later than/);
  });

  it('enet includes date', () => {
    const desc = describeConstraint(c('enet', date));
    expect(desc).toMatch(/End no earlier than/);
  });

  it('enlt includes date', () => {
    const desc = describeConstraint(c('enlt', date));
    expect(desc).toMatch(/End no later than/);
  });

  it('returns empty date string when no date is set', () => {
    const desc = describeConstraint(c('must-start-on'));
    expect(desc).toBe('Must start on ');
  });
});
