import { describe, expect, it } from 'vitest';
import { expandOccurrences } from '../recurrence/expandOccurrences.js';
import { makeEvent } from '../schema/eventSchema.js';

function d(y: number, mo: number, day: number, h = 9, m = 0): Date {
  return new Date(y, mo - 1, day, h, m, 0, 0);
}

describe('recurring expansion baseline (phase 0)', () => {
  it('builds deterministic occurrence ids for the same range query', () => {
    const master = makeEvent('series-phase0', {
      title: 'Phase 0 standup',
      start: d(2026, 1, 5, 9),
      end: d(2026, 1, 5, 9, 30),
      rrule: 'FREQ=DAILY;COUNT=5',
      seriesId: 'series-phase0',
    });

    const rangeStart = d(2026, 1, 5, 0);
    const rangeEnd = d(2026, 1, 12, 0);

    const first = expandOccurrences([master], rangeStart, rangeEnd);
    const second = expandOccurrences([master], rangeStart, rangeEnd);

    expect(first.map(o => o.occurrenceId)).toEqual(second.map(o => o.occurrenceId));
    expect(first.map(o => o.occurrenceIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('suppresses exdates from expanded recurring occurrences', () => {
    const skipDate = d(2026, 1, 7, 9);
    const master = makeEvent('series-exdate', {
      title: 'Training',
      start: d(2026, 1, 5, 9),
      end: d(2026, 1, 5, 10),
      rrule: 'FREQ=DAILY;COUNT=5',
      exdates: [skipDate],
      seriesId: 'series-exdate',
    });

    const expanded = expandOccurrences(
      [master],
      d(2026, 1, 5, 0),
      d(2026, 1, 12, 0),
    );

    expect(expanded).toHaveLength(5);
    expect(expanded.some(o => o.start.getTime() === skipDate.getTime())).toBe(false);
  });

  it('enforces maxPerSeries cap when expanding large series', () => {
    const master = makeEvent('series-capped', {
      title: 'Capped series',
      start: d(2026, 1, 1, 8),
      end: d(2026, 1, 1, 8, 15),
      rrule: 'FREQ=DAILY;COUNT=50',
      seriesId: 'series-capped',
    });

    const expanded = expandOccurrences(
      [master],
      d(2026, 1, 1, 0),
      d(2026, 2, 28, 0),
      { maxPerSeries: 10 },
    );

    expect(expanded).toHaveLength(10);
    expect(expanded[0]!.occurrenceIndex).toBe(0);
    expect(expanded[9]!.occurrenceIndex).toBe(9);
  });
});
