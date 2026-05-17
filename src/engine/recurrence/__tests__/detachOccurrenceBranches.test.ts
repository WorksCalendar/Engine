/**
 * detachOccurrence — branch coverage supplement.
 *
 * The resourcePoolIdPassthrough tests cover the happy path with an rrule master.
 * This file covers the remaining two branches:
 *   1. throw when master has neither rrule nor seriesId
 *   2. short-circuit-false path when master has no rrule but HAS a seriesId
 *      (detached occurrences are allowed to be re-detached by this guard)
 */
import { describe, it, expect } from 'vitest';
import { detachOccurrence } from '../detachOccurrence.js';
import { makeEvent } from '../../schema/eventSchema.js';

describe('detachOccurrence — throw branch', () => {
  it('throws when master is a plain (non-recurring) event with no seriesId', () => {
    const plain = makeEvent('plain-1', {
      title: 'Plain event',
      start: new Date(2026, 3, 20, 10, 0),
      end:   new Date(2026, 3, 20, 11, 0),
      // rrule is null (default), seriesId is null (default)
    });

    expect(() => detachOccurrence(plain, new Date(2026, 3, 20, 10, 0))).toThrow(
      'detachOccurrence called on a non-recurring event',
    );
  });

  it('does NOT throw when master has no rrule but has a seriesId (detached occurrence)', () => {
    // A detached occurrence has seriesId=masterEventId but no rrule.
    // The guard !master.rrule && !master.seriesId evaluates to true && false = false → no throw.
    const detached = makeEvent('detached-1', {
      title: 'Detached occurrence',
      start: new Date(2026, 3, 27, 10, 0),
      end:   new Date(2026, 3, 27, 11, 0),
      seriesId: 'master-event-id',
      detachedFrom: 'master-event-id',
      // rrule remains null
    });

    expect(() => detachOccurrence(detached, new Date(2026, 3, 27, 10, 0))).not.toThrow();
  });
});

describe('detachOccurrence — patch.start / patch.end provided', () => {
  it('uses patch.start when provided instead of occurrenceStart', () => {
    const master = makeEvent('master-1', {
      title: 'Weekly meeting',
      start: new Date(2026, 3, 20, 9, 0),
      end:   new Date(2026, 3, 20, 10, 0),
      rrule: 'FREQ=WEEKLY',
      seriesId: 'master-1',
    });

    const customStart = new Date(2026, 3, 27, 11, 0);
    const { detached } = detachOccurrence(
      master,
      new Date(2026, 3, 27, 9, 0),
      { start: customStart },
    );

    expect(detached.start).toEqual(customStart);
  });

  it('uses patch.end when provided instead of computed end', () => {
    const master = makeEvent('master-2', {
      title: 'Weekly meeting',
      start: new Date(2026, 3, 20, 9, 0),
      end:   new Date(2026, 3, 20, 10, 0),
      rrule: 'FREQ=WEEKLY',
      seriesId: 'master-2',
    });

    const customEnd = new Date(2026, 3, 27, 12, 0);
    const { detached } = detachOccurrence(
      master,
      new Date(2026, 3, 27, 9, 0),
      { end: customEnd },
    );

    expect(detached.end).toEqual(customEnd);
  });
});
