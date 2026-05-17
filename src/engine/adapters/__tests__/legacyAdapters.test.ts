import { describe, it, expect } from 'vitest';
import { fromLegacyEvent, fromLegacyEvents } from '../fromLegacyEvents.js';
import { toLegacyEvent, toLegacyEvents, occurrenceToLegacy } from '../toLegacyEvents.js';
import { makeEvent } from '../../schema/eventSchema.js';
import type { EngineOccurrence } from '../../schema/occurrenceSchema.js';

const d = (h: number) => new Date(2026, 0, 10, h, 0, 0);

// ─── fromLegacyEvent ──────────────────────────────────────────────────────────

describe('fromLegacyEvent', () => {
  const base = () => ({
    id: 'ev1',
    title: 'Stand-up',
    start: d(9),
    end: d(10),
  });

  it('preserves id as string', () => {
    expect(fromLegacyEvent({ ...base(), id: 42 }).id).toBe('42');
  });

  it('preserves string id', () => {
    expect(fromLegacyEvent(base()).id).toBe('ev1');
  });

  it('preserves Date start/end', () => {
    const ev = fromLegacyEvent(base());
    expect(ev.start).toEqual(d(9));
    expect(ev.end).toEqual(d(10));
  });

  it('parses ISO string start/end', () => {
    const ev = fromLegacyEvent({ ...base(), start: '2026-01-10T09:00:00', end: '2026-01-10T10:00:00' });
    expect(ev.start).toBeInstanceOf(Date);
    expect(ev.end).toBeInstanceOf(Date);
  });

  it('defaults title to "(untitled)" when absent', () => {
    const ev = fromLegacyEvent({ id: 'x', start: d(9), end: d(10) });
    expect(ev.title).toBe('(untitled)');
  });

  it('defaults allDay to false', () => {
    expect(fromLegacyEvent(base()).allDay).toBe(false);
  });

  it('preserves allDay=true', () => {
    expect(fromLegacyEvent({ ...base(), allDay: true }).allDay).toBe(true);
  });

  it('maps resource → resourceId', () => {
    const ev = fromLegacyEvent({ ...base(), resource: 'r1' });
    expect(ev.resourceId).toBe('r1');
  });

  it('defaults resourceId to null when resource absent', () => {
    expect(fromLegacyEvent(base()).resourceId).toBeNull();
  });

  it('preserves resourcePoolId', () => {
    const ev = fromLegacyEvent({ ...base(), resourcePoolId: 'pool-1' });
    expect(ev.resourcePoolId).toBe('pool-1');
  });

  it('maps status "tentative"', () => {
    expect(fromLegacyEvent({ ...base(), status: 'tentative' }).status).toBe('tentative');
  });

  it('defaults unknown status to "confirmed"', () => {
    expect(fromLegacyEvent({ ...base(), status: 'unknown' }).status).toBe('confirmed');
  });

  it('defaults status to "confirmed" when absent', () => {
    expect(fromLegacyEvent(base()).status).toBe('confirmed');
  });

  it('sets seriesId to id when rrule present', () => {
    const ev = fromLegacyEvent({ ...base(), rrule: 'FREQ=WEEKLY' });
    expect(ev.seriesId).toBe('ev1');
    expect(ev.rrule).toBe('FREQ=WEEKLY');
  });

  it('sets seriesId from _seriesId when present', () => {
    const ev = fromLegacyEvent({ ...base(), _seriesId: 'master-1' });
    expect(ev.seriesId).toBe('master-1');
  });

  it('sets seriesId to null for non-recurring event', () => {
    expect(fromLegacyEvent(base()).seriesId).toBeNull();
  });

  it('defaults rrule to null when absent', () => {
    expect(fromLegacyEvent(base()).rrule).toBeNull();
  });

  it('parses exdates array', () => {
    const exd = new Date(2026, 1, 1);
    const ev = fromLegacyEvent({ ...base(), exdates: [exd] });
    expect(ev.exdates).toHaveLength(1);
    expect(ev.exdates[0]).toEqual(exd);
  });

  it('parses string exdates', () => {
    const ev = fromLegacyEvent({ ...base(), exdates: ['2026-02-01T00:00:00'] });
    expect(ev.exdates[0]).toBeInstanceOf(Date);
  });

  it('defaults exdates to empty array', () => {
    expect(fromLegacyEvent(base()).exdates).toEqual([]);
  });

  it('preserves meta', () => {
    const ev = fromLegacyEvent({ ...base(), meta: { foo: 'bar' } });
    expect(ev.meta['foo']).toBe('bar');
  });

  it('threads visualPriority into meta._visualPriority', () => {
    const ev = fromLegacyEvent({ ...base(), visualPriority: 'high' });
    expect(ev.meta['_visualPriority']).toBe('high');
  });

  it('ignores invalid visualPriority', () => {
    const ev = fromLegacyEvent({ ...base(), visualPriority: 'extreme' });
    expect(ev.meta['_visualPriority']).toBeUndefined();
  });

  it('preserves timezone', () => {
    const ev = fromLegacyEvent({ ...base(), timezone: 'America/Denver' });
    expect(ev.timezone).toBe('America/Denver');
  });

  it('defaults timezone to null', () => {
    expect(fromLegacyEvent(base()).timezone).toBeNull();
  });

  it('always sets constraints to empty array', () => {
    expect(fromLegacyEvent(base()).constraints).toEqual([]);
  });

  it('always sets occurrenceId and detachedFrom to null', () => {
    const ev = fromLegacyEvent(base());
    expect(ev.occurrenceId).toBeNull();
    expect(ev.detachedFrom).toBeNull();
  });
});

describe('fromLegacyEvents', () => {
  it('converts an array of events', () => {
    const evs = fromLegacyEvents([
      { id: 'a', title: 'A', start: d(9), end: d(10) },
      { id: 'b', title: 'B', start: d(11), end: d(12) },
    ]);
    expect(evs).toHaveLength(2);
    expect(evs[0]!.id).toBe('a');
    expect(evs[1]!.id).toBe('b');
  });

  it('preserves order', () => {
    const ids = ['z', 'a', 'm'];
    const evs = fromLegacyEvents(ids.map(id => ({ id, title: id, start: d(9), end: d(10) })));
    expect(evs.map(e => e.id)).toEqual(ids);
  });
});

// ─── toLegacyEvent ────────────────────────────────────────────────────────────

describe('toLegacyEvent', () => {
  const base = () => makeEvent('ev1', { title: 'Meeting', start: d(9), end: d(10) });

  it('preserves id, title, start, end, allDay, category, color, status', () => {
    const out = toLegacyEvent(base());
    expect(out.id).toBe('ev1');
    expect(out.title).toBe('Meeting');
    expect(out.start).toEqual(d(9));
    expect(out.end).toEqual(d(10));
    expect(out.allDay).toBe(false);
    expect(out.category).toBeNull();
    expect(out.color).toBeNull();
    expect(out.status).toBe('confirmed');
  });

  it('maps resourceId → resource', () => {
    const out = toLegacyEvent(makeEvent('ev1', { title: 'T', start: d(9), end: d(10), resourceId: 'r1' }));
    expect(out.resource).toBe('r1');
  });

  it('maps seriesId → _seriesId', () => {
    const ev = makeEvent('ev1', { title: 'T', start: d(9), end: d(10), seriesId: 'master-1' });
    expect(toLegacyEvent(ev)._seriesId).toBe('master-1');
  });

  it('sets _recurring=false for non-recurring events', () => {
    expect(toLegacyEvent(base())._recurring).toBe(false);
  });

  it('sets _recurring=true when seriesId differs from id', () => {
    const ev = makeEvent('occ-1', { title: 'T', start: d(9), end: d(10), seriesId: 'master-1' });
    expect(toLegacyEvent(ev)._recurring).toBe(true);
  });

  it('sets _recurring=false when seriesId equals id (series master)', () => {
    const ev = makeEvent('master-1', { title: 'T', start: d(9), end: d(10), seriesId: 'master-1' });
    expect(toLegacyEvent(ev)._recurring).toBe(false);
  });

  it('extracts visualPriority from meta._visualPriority', () => {
    const ev = makeEvent('ev1', { title: 'T', start: d(9), end: d(10), meta: { _visualPriority: 'high' } });
    expect(toLegacyEvent(ev).visualPriority).toBe('high');
  });

  it('omits visualPriority when not set', () => {
    expect(toLegacyEvent(base()).visualPriority).toBeUndefined();
  });

  it('omits visualPriority for invalid value', () => {
    const ev = makeEvent('ev1', { title: 'T', start: d(9), end: d(10), meta: { _visualPriority: 'extreme' } });
    expect(toLegacyEvent(ev).visualPriority).toBeUndefined();
  });

  it('copies exdates as mutable array', () => {
    const exd = new Date(2026, 1, 1);
    const ev = makeEvent('ev1', { title: 'T', start: d(9), end: d(10), exdates: [exd] });
    const out = toLegacyEvent(ev);
    expect(out.exdates).toHaveLength(1);
    expect(out.exdates[0]).toEqual(exd);
    expect(Array.isArray(out.exdates)).toBe(true);
  });

  it('copies meta as shallow clone', () => {
    const ev = makeEvent('ev1', { title: 'T', start: d(9), end: d(10), meta: { foo: 'bar' } });
    const out = toLegacyEvent(ev);
    expect(out.meta['foo']).toBe('bar');
  });
});

describe('toLegacyEvents', () => {
  it('maps an array of EngineEvents', () => {
    const evs = [
      makeEvent('a', { title: 'A', start: d(9), end: d(10) }),
      makeEvent('b', { title: 'B', start: d(11), end: d(12) }),
    ];
    const out = toLegacyEvents(evs);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe('a');
  });
});

// ─── occurrenceToLegacy ───────────────────────────────────────────────────────

describe('occurrenceToLegacy', () => {
  const makeOcc = (overrides: Partial<EngineOccurrence> = {}): EngineOccurrence => ({
    occurrenceId:   'ev1-r1',
    eventId:        'ev1',
    seriesId:       'ev1',
    detachedFrom:   null,
    start:          d(9),
    end:            d(10),
    timezone:       null,
    allDay:         false,
    title:          'Weekly',
    category:       null,
    resourceId:     null,
    resourceIds:    [],
    status:         'confirmed',
    color:          null,
    isRecurring:    true,
    occurrenceIndex: 1,
    constraints:    [],
    meta:           {},
    ...overrides,
  });

  it('uses occurrenceId as id', () => {
    expect(occurrenceToLegacy(makeOcc()).id).toBe('ev1-r1');
  });

  it('sets _eventId to eventId', () => {
    expect(occurrenceToLegacy(makeOcc())._eventId).toBe('ev1');
  });

  it('maps resourceId → resource', () => {
    expect(occurrenceToLegacy(makeOcc({ resourceId: 'r1' })).resource).toBe('r1');
  });

  it('sets _recurring from isRecurring', () => {
    expect(occurrenceToLegacy(makeOcc({ isRecurring: true }))._recurring).toBe(true);
    expect(occurrenceToLegacy(makeOcc({ isRecurring: false }))._recurring).toBe(false);
  });

  it('sets rrule to null and exdates to empty', () => {
    const out = occurrenceToLegacy(makeOcc());
    expect(out.rrule).toBeNull();
    expect(out.exdates).toEqual([]);
  });

  it('threads visualPriority from meta._visualPriority', () => {
    const occ = makeOcc({ meta: { _visualPriority: 'muted' } });
    expect(occurrenceToLegacy(occ).visualPriority).toBe('muted');
  });

  it('omits visualPriority when invalid', () => {
    const occ = makeOcc({ meta: { _visualPriority: 'extreme' } });
    expect(occurrenceToLegacy(occ).visualPriority).toBeUndefined();
  });
});
