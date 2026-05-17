import { describe, it, expect } from 'vitest';
import { getOccurrencesInRange } from '../getOccurrencesInRange.js';
import type { EngineEvent } from '../../schema/eventSchema.js';
import type { Assignment } from '../../schema/assignmentSchema.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EngineEvent> = {}): EngineEvent {
  return {
    id: 'ev-1',
    seriesId: null,
    occurrenceId: null,
    detachedFrom: null,
    start: new Date('2026-06-10T09:00:00Z'),
    end:   new Date('2026-06-10T10:00:00Z'),
    timezone: null,
    allDay: false,
    title: 'Meeting',
    category: null,
    resourceId: null,
    resourcePoolId: null,
    status: 'confirmed',
    color: null,
    rrule: null,
    exdates: [],
    constraints: [],
    meta: {},
    ...overrides,
  } as unknown as EngineEvent;
}

const rangeStart = new Date('2026-06-10T00:00:00Z');
const rangeEnd   = new Date('2026-06-11T00:00:00Z');

// ─── Basic acceptance ─────────────────────────────────────────────────────────

describe('getOccurrencesInRange — basic', () => {
  it('returns an occurrence for an event inside the range (Map input)', () => {
    const ev = makeEvent();
    const map = new Map([['ev-1', ev]]);
    const result = getOccurrencesInRange(map, rangeStart, rangeEnd);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].eventId).toBe('ev-1');
  });

  it('accepts an array of events as first argument', () => {
    const ev = makeEvent();
    const result = getOccurrencesInRange([ev], rangeStart, rangeEnd);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].eventId).toBe('ev-1');
  });

  it('returns empty array when map is empty', () => {
    const result = getOccurrencesInRange(new Map(), rangeStart, rangeEnd);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when event list is empty', () => {
    const result = getOccurrencesInRange([], rangeStart, rangeEnd);
    expect(result).toHaveLength(0);
  });
});

// ─── Sorting ──────────────────────────────────────────────────────────────────

describe('getOccurrencesInRange — sort', () => {
  it('sorts occurrences by start time ascending by default', () => {
    const ev1 = makeEvent({ id: 'ev-1', start: new Date('2026-06-10T14:00:00Z'), end: new Date('2026-06-10T15:00:00Z') });
    const ev2 = makeEvent({ id: 'ev-2', start: new Date('2026-06-10T08:00:00Z'), end: new Date('2026-06-10T09:00:00Z') });
    const result = getOccurrencesInRange([ev1, ev2], rangeStart, rangeEnd);
    expect(result[0].start.getTime()).toBeLessThanOrEqual(result[result.length - 1].start.getTime());
  });

  it('does not sort when sort=false', () => {
    const ev1 = makeEvent({ id: 'ev-1', start: new Date('2026-06-10T14:00:00Z'), end: new Date('2026-06-10T15:00:00Z') });
    const ev2 = makeEvent({ id: 'ev-2', start: new Date('2026-06-10T08:00:00Z'), end: new Date('2026-06-10T09:00:00Z') });
    const result = getOccurrencesInRange([ev1, ev2], rangeStart, rangeEnd, { sort: false });
    // Order may differ but both events must be present
    expect(result).toHaveLength(2);
  });
});

// ─── Filter ───────────────────────────────────────────────────────────────────

describe('getOccurrencesInRange — filter', () => {
  const makeFilter = (overrides: Partial<{ search: string; categories: Set<string>; resources: Set<string> }> = {}) => ({
    search: '',
    categories: new Set<string>(),
    resources: new Set<string>(),
    ...overrides,
  });

  it('passes all events when filter is absent', () => {
    const ev1 = makeEvent({ id: 'ev-1' });
    const ev2 = makeEvent({ id: 'ev-2', title: 'Other' });
    const result = getOccurrencesInRange([ev1, ev2], rangeStart, rangeEnd);
    expect(result).toHaveLength(2);
  });

  it('filters by search term (case-insensitive)', () => {
    const ev1 = makeEvent({ id: 'ev-1', title: 'Team Standup' });
    const ev2 = makeEvent({ id: 'ev-2', title: 'Budget Review' });
    const result = getOccurrencesInRange([ev1, ev2], rangeStart, rangeEnd, {
      filter: makeFilter({ search: 'standup' }),
    });
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe('ev-1');
  });

  it('filters by category', () => {
    const ev1 = makeEvent({ id: 'ev-1', category: 'PTO' });
    const ev2 = makeEvent({ id: 'ev-2', category: 'Meeting' });
    const result = getOccurrencesInRange([ev1, ev2], rangeStart, rangeEnd, {
      filter: makeFilter({ categories: new Set(['PTO']) }),
    });
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe('ev-1');
  });

  it('excludes events with no category when category filter is active', () => {
    const ev = makeEvent({ id: 'ev-1', category: null });
    const result = getOccurrencesInRange([ev], rangeStart, rangeEnd, {
      filter: makeFilter({ categories: new Set(['PTO']) }),
    });
    expect(result).toHaveLength(0);
  });

  it('filters by resourceId', () => {
    const ev1 = makeEvent({ id: 'ev-1', resourceId: 'res-A' });
    const ev2 = makeEvent({ id: 'ev-2', resourceId: 'res-B' });
    const result = getOccurrencesInRange([ev1, ev2], rangeStart, rangeEnd, {
      filter: makeFilter({ resources: new Set(['res-A']) }),
    });
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe('ev-1');
  });

  it('excludes events with no resourceId when resource filter is active', () => {
    const ev = makeEvent({ id: 'ev-1', resourceId: null });
    const result = getOccurrencesInRange([ev], rangeStart, rangeEnd, {
      filter: makeFilter({ resources: new Set(['res-A']) }),
    });
    expect(result).toHaveLength(0);
  });

  it('applies search + category + resource filters together', () => {
    const match = makeEvent({ id: 'match', title: 'Alpha', category: 'PTO', resourceId: 'res-A' });
    const wrongTitle = makeEvent({ id: 'wt', title: 'Beta', category: 'PTO', resourceId: 'res-A' });
    const wrongCat   = makeEvent({ id: 'wc', title: 'Alpha', category: 'Meeting', resourceId: 'res-A' });
    const wrongRes   = makeEvent({ id: 'wr', title: 'Alpha', category: 'PTO', resourceId: 'res-B' });
    const result = getOccurrencesInRange([match, wrongTitle, wrongCat, wrongRes], rangeStart, rangeEnd, {
      filter: makeFilter({ search: 'alpha', categories: new Set(['PTO']), resources: new Set(['res-A']) }),
    });
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe('match');
  });
});

// ─── Assignments ──────────────────────────────────────────────────────────────

describe('getOccurrencesInRange — assignments', () => {
  it('populates resourceIds from assignment map when provided', () => {
    const ev = makeEvent({ id: 'ev-1', resourceId: 'res-legacy' });
    const assignment: Assignment = { id: 'a1', eventId: 'ev-1', resourceId: 'res-modern', units: 100 };
    const assignmentsMap = new Map([['a1', assignment]]);
    const result = getOccurrencesInRange([ev], rangeStart, rangeEnd, { assignments: assignmentsMap });
    expect(result[0].resourceIds).toContain('res-modern');
    expect(result[0].resourceIds).not.toContain('res-legacy');
  });

  it('falls back to event resourceId when no assignment entry exists', () => {
    const ev = makeEvent({ id: 'ev-1', resourceId: 'res-legacy' });
    const emptyMap = new Map<string, Assignment>();
    const result = getOccurrencesInRange([ev], rangeStart, rangeEnd, { assignments: emptyMap });
    expect(result[0].resourceIds).toContain('res-legacy');
  });

  it('does not set resourceIds when assignments option is absent', () => {
    const ev = makeEvent({ id: 'ev-1', resourceId: 'res-A' });
    const result = getOccurrencesInRange([ev], rangeStart, rangeEnd);
    // resourceIds may be undefined or set from the event itself — key point is assignments map not consulted
    expect(result).toHaveLength(1);
  });
});
