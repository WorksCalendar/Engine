import { describe, it, expect } from 'vitest';
import { normalizeInputEvent, normalizeInputEvents, nextEngineId } from '../normalizeInputEvent.js';

// ─── nextEngineId ─────────────────────────────────────────────────────────────

describe('nextEngineId', () => {
  it('returns a string', () => {
    expect(typeof nextEngineId()).toBe('string');
  });

  it('generates unique ids on successive calls', () => {
    const a = nextEngineId();
    const b = nextEngineId();
    expect(a).not.toBe(b);
  });

  it('starts with "eng-"', () => {
    expect(nextEngineId()).toMatch(/^eng-/);
  });
});

// ─── normalizeInputEvent ──────────────────────────────────────────────────────

describe('normalizeInputEvent', () => {
  const base = () => ({
    title: 'Meeting',
    start: new Date(2026, 0, 10, 9, 0, 0),
    end:   new Date(2026, 0, 10, 10, 0, 0),
  });

  // ── Identity fields ──────────────────────────────────────────────────────

  it('preserves a provided id', () => {
    const ev = normalizeInputEvent({ ...base(), id: 'my-id' });
    expect(ev.id).toBe('my-id');
  });

  it('generates an id when absent', () => {
    const ev = normalizeInputEvent({ ...base() });
    expect(typeof ev.id).toBe('string');
    expect(ev.id.length).toBeGreaterThan(0);
  });

  it('coerces numeric id to string', () => {
    const ev = normalizeInputEvent({ ...base(), id: 42 });
    expect(ev.id).toBe('42');
  });

  // ── Date coercion ────────────────────────────────────────────────────────

  it('preserves a Date start', () => {
    const d = new Date(2026, 0, 10, 9, 0, 0);
    const ev = normalizeInputEvent({ title: 'T', start: d });
    expect(ev.start).toEqual(d);
  });

  it('parses an ISO string start', () => {
    const ev = normalizeInputEvent({ title: 'T', start: '2026-01-10T09:00:00.000Z' });
    expect(ev.start).toBeInstanceOf(Date);
    expect(Number.isNaN(ev.start.getTime())).toBe(false);
  });

  it('parses a numeric timestamp for start', () => {
    const ts = new Date(2026, 0, 10, 9).getTime();
    const ev = normalizeInputEvent({ title: 'T', start: ts });
    expect(ev.start).toBeInstanceOf(Date);
    expect(ev.start.getTime()).toBe(ts);
  });

  it('defaults start to now when missing', () => {
    const before = Date.now();
    const ev = normalizeInputEvent({ title: 'T' });
    const after = Date.now();
    expect(ev.start.getTime()).toBeGreaterThanOrEqual(before);
    expect(ev.start.getTime()).toBeLessThanOrEqual(after);
  });

  it('preserves a Date end', () => {
    const end = new Date(2026, 0, 10, 11, 0, 0);
    const ev = normalizeInputEvent({ ...base(), end });
    expect(ev.end).toEqual(end);
  });

  it('defaults end to start + 1h when missing', () => {
    const start = new Date(2026, 0, 10, 9, 0, 0);
    const ev = normalizeInputEvent({ title: 'T', start });
    expect(ev.end.getTime() - ev.start.getTime()).toBe(60 * 60 * 1000);
  });

  it('returns null for an invalid Date start and uses now', () => {
    const ev = normalizeInputEvent({ title: 'T', start: 'not-a-date' });
    // Should fall back to now (not throw)
    expect(ev.start).toBeInstanceOf(Date);
    expect(Number.isNaN(ev.start.getTime())).toBe(false);
  });

  // ── Title ────────────────────────────────────────────────────────────────

  it('preserves the title', () => {
    const ev = normalizeInputEvent({ title: 'Stand-up', start: new Date() });
    expect(ev.title).toBe('Stand-up');
  });

  it('defaults title to "(untitled)" when absent', () => {
    const ev = normalizeInputEvent({ start: new Date() });
    expect(ev.title).toBe('(untitled)');
  });

  it('defaults title to "(untitled)" when empty string', () => {
    const ev = normalizeInputEvent({ title: '', start: new Date() });
    expect(ev.title).toBe('(untitled)');
  });

  // ── allDay ───────────────────────────────────────────────────────────────

  it('defaults allDay to false', () => {
    expect(normalizeInputEvent(base()).allDay).toBe(false);
  });

  it('preserves allDay=true', () => {
    expect(normalizeInputEvent({ ...base(), allDay: true }).allDay).toBe(true);
  });

  // ── Status ───────────────────────────────────────────────────────────────

  it('defaults status to "confirmed"', () => {
    expect(normalizeInputEvent(base()).status).toBe('confirmed');
  });

  it('preserves "tentative" status', () => {
    expect(normalizeInputEvent({ ...base(), status: 'tentative' }).status).toBe('tentative');
  });

  it('preserves "cancelled" status', () => {
    expect(normalizeInputEvent({ ...base(), status: 'cancelled' }).status).toBe('cancelled');
  });

  it('resets invalid status to "confirmed"', () => {
    expect(normalizeInputEvent({ ...base(), status: 'bogus' }).status).toBe('confirmed');
  });

  // ── resourceId ───────────────────────────────────────────────────────────

  it('defaults resourceId to null', () => {
    expect(normalizeInputEvent(base()).resourceId).toBeNull();
  });

  it('preserves resourceId', () => {
    expect(normalizeInputEvent({ ...base(), resourceId: 'r1' }).resourceId).toBe('r1');
  });

  it('falls back to legacy "resource" field', () => {
    expect(normalizeInputEvent({ ...base(), resource: 'r2' }).resourceId).toBe('r2');
  });

  it('prefers resourceId over resource when both present', () => {
    const ev = normalizeInputEvent({ ...base(), resourceId: 'r1', resource: 'r2' });
    expect(ev.resourceId).toBe('r1');
  });

  // ── category / color ─────────────────────────────────────────────────────

  it('defaults category to null', () => {
    expect(normalizeInputEvent(base()).category).toBeNull();
  });

  it('preserves category', () => {
    expect(normalizeInputEvent({ ...base(), category: 'PTO' }).category).toBe('PTO');
  });

  it('defaults color to null', () => {
    expect(normalizeInputEvent(base()).color).toBeNull();
  });

  it('preserves color', () => {
    expect(normalizeInputEvent({ ...base(), color: '#ff0000' }).color).toBe('#ff0000');
  });

  // ── timezone ─────────────────────────────────────────────────────────────

  it('defaults timezone to null', () => {
    expect(normalizeInputEvent(base()).timezone).toBeNull();
  });

  it('preserves timezone', () => {
    expect(normalizeInputEvent({ ...base(), timezone: 'America/Denver' }).timezone).toBe('America/Denver');
  });

  it('sets timezone to null for empty string', () => {
    expect(normalizeInputEvent({ ...base(), timezone: '' }).timezone).toBeNull();
  });

  // ── rrule / seriesId ─────────────────────────────────────────────────────

  it('defaults rrule to null', () => {
    expect(normalizeInputEvent(base()).rrule).toBeNull();
  });

  it('preserves rrule', () => {
    const ev = normalizeInputEvent({ ...base(), rrule: 'FREQ=WEEKLY' });
    expect(ev.rrule).toBe('FREQ=WEEKLY');
  });

  it('sets seriesId === id when rrule is present and seriesId absent', () => {
    const ev = normalizeInputEvent({ ...base(), id: 'master', rrule: 'FREQ=WEEKLY' });
    expect(ev.seriesId).toBe('master');
  });

  it('defaults seriesId to null for non-recurring event', () => {
    const ev = normalizeInputEvent(base());
    expect(ev.seriesId).toBeNull();
  });

  it('preserves explicit seriesId', () => {
    const ev = normalizeInputEvent({ ...base(), seriesId: 'ser-1' });
    expect(ev.seriesId).toBe('ser-1');
  });

  // ── exdates / constraints ────────────────────────────────────────────────

  it('defaults exdates to empty array', () => {
    expect(normalizeInputEvent(base()).exdates).toEqual([]);
  });

  it('parses ISO string exdates', () => {
    const ev = normalizeInputEvent({ ...base(), exdates: ['2026-01-15T09:00:00.000Z'] });
    expect(ev.exdates).toHaveLength(1);
    expect(ev.exdates[0]).toBeInstanceOf(Date);
  });

  it('drops invalid exdates silently', () => {
    const ev = normalizeInputEvent({ ...base(), exdates: ['not-a-date', '2026-01-20T09:00:00.000Z'] });
    expect(ev.exdates).toHaveLength(1);
  });

  it('defaults constraints to empty array', () => {
    expect(normalizeInputEvent(base()).constraints).toEqual([]);
  });

  it('parses valid constraint types', () => {
    const ev = normalizeInputEvent({
      ...base(),
      constraints: [{ type: 'asap' }, { type: 'must-start-on', date: '2026-01-10T09:00:00.000Z' }],
    });
    expect(ev.constraints).toHaveLength(2);
    expect(ev.constraints[0]!.type).toBe('asap');
    expect(ev.constraints[1]!.type).toBe('must-start-on');
  });

  it('drops invalid constraint types', () => {
    const ev = normalizeInputEvent({ ...base(), constraints: [{ type: 'not-a-type' }] });
    expect(ev.constraints).toHaveLength(0);
  });

  it('drops non-object constraint entries', () => {
    const ev = normalizeInputEvent({ ...base(), constraints: [null, 'asap', { type: 'alap' }] });
    expect(ev.constraints).toHaveLength(1);
    expect(ev.constraints[0]!.type).toBe('alap');
  });

  // ── meta ─────────────────────────────────────────────────────────────────

  it('defaults meta to empty object', () => {
    expect(normalizeInputEvent(base()).meta).toEqual({});
  });

  it('preserves meta object', () => {
    const ev = normalizeInputEvent({ ...base(), meta: { foo: 'bar' } });
    expect(ev.meta).toEqual({ foo: 'bar' });
  });

  it('ignores array meta', () => {
    const ev = normalizeInputEvent({ ...base(), meta: ['a', 'b'] });
    expect(ev.meta).toEqual({});
  });

  // ── occurrence fields ─────────────────────────────────────────────────────

  it('defaults occurrenceId to null', () => {
    expect(normalizeInputEvent(base()).occurrenceId).toBeNull();
  });

  it('preserves occurrenceId', () => {
    const ev = normalizeInputEvent({ ...base(), occurrenceId: 'occ-1' });
    expect(ev.occurrenceId).toBe('occ-1');
  });

  it('defaults detachedFrom to null', () => {
    expect(normalizeInputEvent(base()).detachedFrom).toBeNull();
  });

  it('preserves detachedFrom', () => {
    const ev = normalizeInputEvent({ ...base(), detachedFrom: 'master-1' });
    expect(ev.detachedFrom).toBe('master-1');
  });
});

// ─── normalizeInputEvents ─────────────────────────────────────────────────────

describe('normalizeInputEvents', () => {
  const raw = () => ({ title: 'T', start: new Date(2026, 0, 10) });

  it('normalizes an array of raw events', () => {
    const evs = normalizeInputEvents([raw(), raw()]);
    expect(evs).toHaveLength(2);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeInputEvents(null as unknown as unknown[])).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(normalizeInputEvents([])).toEqual([]);
  });

  it('silently skips entries that throw', () => {
    // A deeply broken value that the cast + normalizeInputEvent won't handle
    const broken = Object.defineProperty({}, 'start', {
      get() { throw new Error('boom'); },
    });
    const evs = normalizeInputEvents([broken, raw()]);
    expect(evs).toHaveLength(1);
  });
});
