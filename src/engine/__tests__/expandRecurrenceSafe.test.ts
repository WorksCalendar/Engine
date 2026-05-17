import { describe, expect, it, vi } from 'vitest';
import { makeEvent } from '../schema/eventSchema.js';
import {
  expandRecurrenceSafe,
  type SeriesDiagnostic,
} from '../recurrence/expandRecurrenceSafe.js';

describe('expandRecurrenceSafe — invalid range', () => {
  it('returns empty result and emits onError for invalid ranges', () => {
    const onError = vi.fn();
    const event = makeEvent('e1', {
      title: 'Bad range check',
      start: new Date('2026-01-01T10:00:00Z'),
      end: new Date('2026-01-01T11:00:00Z'),
    });

    const result = expandRecurrenceSafe(
      [event],
      new Date('invalid'),
      new Date('2026-01-02T00:00:00Z'),
      { onError },
    );

    expect(result.occurrences).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('expandRecurrenceSafe — source isolation (#257)', () => {
  it('skips malformed events and continues partial expansion', () => {
    const onError = vi.fn();

    const good = makeEvent('good', {
      title: 'Valid',
      start: new Date('2026-03-01T10:00:00Z'),
      end: new Date('2026-03-01T11:00:00Z'),
    });

    const malformed = {
      ...good,
      id: 'bad',
      end: new Date('2026-03-01T09:59:00Z'),
    };

    const result = expandRecurrenceSafe(
      [good, malformed],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-02T00:00:00Z'),
      { onError },
    );

    expect(result.occurrences.some(occ => occ.eventId === 'good')).toBe(true);
    expect(result.occurrences.some(occ => occ.eventId === 'bad')).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a bad series later in the list does not drop earlier good occurrences', () => {
    const a = makeEvent('a', {
      title: 'A', start: new Date('2026-03-01T10:00:00Z'), end: new Date('2026-03-01T11:00:00Z'),
    });
    const b = makeEvent('b', {
      title: 'B', start: new Date('2026-03-01T12:00:00Z'), end: new Date('2026-03-01T13:00:00Z'),
    });
    const malformed = { ...a, id: 'bad', end: new Date('2026-03-01T09:00:00Z') };

    const result = expandRecurrenceSafe(
      [a, malformed, b],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-02T00:00:00Z'),
    );

    const ids = result.occurrences.map(o => o.eventId);
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('expandRecurrenceSafe — diagnostics (#257)', () => {
  it('emits an `ok` diagnostic per clean series with the correct occurrence count', () => {
    const a = makeEvent('a', {
      title: 'A', start: new Date('2026-03-01T10:00:00Z'), end: new Date('2026-03-01T11:00:00Z'),
    });
    const b = makeEvent('b', {
      title: 'B', start: new Date('2026-03-01T12:00:00Z'), end: new Date('2026-03-01T13:00:00Z'),
    });

    const result = expandRecurrenceSafe(
      [a, b],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-02T00:00:00Z'),
    );

    expect(result.diagnostics.length).toBe(2);
    expect(result.diagnostics[0]?.eventId).toBe('a');
    expect(result.diagnostics[0]?.status).toBe('ok');
    expect(result.diagnostics[0]?.occurrenceCount).toBe(1);
    expect(result.diagnostics[1]?.eventId).toBe('b');
    expect(result.diagnostics[1]?.status).toBe('ok');
    expect(result.diagnostics[1]?.occurrenceCount).toBe(1);
  });

  it('emits an `error` diagnostic carrying the structured error for malformed input', () => {
    const good = makeEvent('good', {
      title: 'V', start: new Date('2026-03-01T10:00:00Z'), end: new Date('2026-03-01T11:00:00Z'),
    });
    const malformed = { ...good, id: 'bad', end: new Date('2026-03-01T09:00:00Z') };

    const result = expandRecurrenceSafe(
      [good, malformed],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-02T00:00:00Z'),
    );

    const badDiag = result.diagnostics.find(d => d.eventId === 'bad');
    expect(badDiag?.status).toBe('error');
    expect(badDiag?.occurrenceCount).toBe(0);
    expect(badDiag?.error?.code).toBe('RECURRENCE_MALFORMED_EVENT');
  });

  it('emits a `capped` diagnostic when a series fills the per-series cap', () => {
    // Daily series across a full year capped at 5 ⇒ the call clips
    // to 5 and the diagnostic reports `capped`.
    const daily = makeEvent('daily', {
      title: 'Daily',
      start: new Date('2026-01-01T10:00:00Z'),
      end: new Date('2026-01-01T11:00:00Z'),
      rrule: 'FREQ=DAILY',
    });

    const result = expandRecurrenceSafe(
      [daily],
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-12-31T00:00:00Z'),
      { maxPerSeries: 5 },
    );

    expect(result.diagnostics[0]?.status).toBe('capped');
    expect(result.diagnostics[0]?.occurrenceCount).toBe(5);
  });

  it('records a duration in milliseconds for every series', () => {
    const ev = makeEvent('e', {
      title: 'E', start: new Date('2026-03-01T10:00:00Z'), end: new Date('2026-03-01T11:00:00Z'),
    });

    const result = expandRecurrenceSafe(
      [ev],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-02T00:00:00Z'),
    );

    expect(typeof result.diagnostics[0]?.durationMs).toBe('number');
    expect(result.diagnostics[0]!.durationMs!).toBeGreaterThanOrEqual(0);
  });
});

describe('expandRecurrenceSafe — onSeriesExpanded callback (#257)', () => {
  it('fires once per input series in input order', () => {
    const calls: string[] = [];
    const onSeriesExpanded = (d: SeriesDiagnostic) => { calls.push(d.eventId); };

    const a = makeEvent('a', {
      title: 'A', start: new Date('2026-03-01T10:00:00Z'), end: new Date('2026-03-01T11:00:00Z'),
    });
    const b = makeEvent('b', {
      title: 'B', start: new Date('2026-03-01T12:00:00Z'), end: new Date('2026-03-01T13:00:00Z'),
    });

    expandRecurrenceSafe(
      [a, b],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-02T00:00:00Z'),
      { onSeriesExpanded },
    );

    expect(calls).toEqual(['a', 'b']);
  });

  it('fires for malformed events too (status: error)', () => {
    const onSeriesExpanded = vi.fn();

    const good = makeEvent('good', {
      title: 'G', start: new Date('2026-03-01T10:00:00Z'), end: new Date('2026-03-01T11:00:00Z'),
    });
    const malformed = { ...good, id: 'bad', end: new Date('2026-03-01T09:00:00Z') };

    expandRecurrenceSafe(
      [good, malformed],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-02T00:00:00Z'),
      { onSeriesExpanded },
    );

    expect(onSeriesExpanded).toHaveBeenCalledTimes(2);
    const lastCall = onSeriesExpanded.mock.calls[1]![0] as SeriesDiagnostic;
    expect(lastCall.eventId).toBe('bad');
    expect(lastCall.status).toBe('error');
  });

  it('a throwing onSeriesExpanded callback does not break the rest of the batch (Codex P1)', () => {
    const onError = vi.fn();
    let calls = 0;
    const onSeriesExpanded = (_d: SeriesDiagnostic) => {
      calls++;
      if (calls === 1) throw new Error('telemetry blew up');
    };

    const a = makeEvent('a', {
      title: 'A', start: new Date('2026-03-01T10:00:00Z'), end: new Date('2026-03-01T11:00:00Z'),
    });
    const b = makeEvent('b', {
      title: 'B', start: new Date('2026-03-01T12:00:00Z'), end: new Date('2026-03-01T13:00:00Z'),
    });

    const result = expandRecurrenceSafe(
      [a, b],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-02T00:00:00Z'),
      { onSeriesExpanded, onError },
    );

    // Both series still expanded — the failing callback didn't poison the loop.
    expect(result.occurrences.map(o => o.eventId)).toEqual(['a', 'b']);
    expect(result.diagnostics.length).toBe(2);
    // Callback failure surfaces to onError as a warning.
    const telemetryError = onError.mock.calls.find(
      (c: unknown[]) => (c[0] as { code?: string })?.code === 'RECURRENCE_TELEMETRY_FAILED',
    );
    expect(telemetryError).toBeDefined();
    expect((telemetryError![1] as { eventId?: string })?.eventId).toBe('a');
  });
});

describe('expandRecurrenceSafe — global cap', () => {
  it('clips total occurrences and still returns full diagnostics list', () => {
    const onError = vi.fn();
    const daily = makeEvent('daily', {
      title: 'Daily',
      start: new Date('2026-01-01T10:00:00Z'),
      end: new Date('2026-01-01T11:00:00Z'),
      rrule: 'FREQ=DAILY',
    });

    const result = expandRecurrenceSafe(
      [daily],
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-12-31T00:00:00Z'),
      { maxTotalOccurrences: 3, maxPerSeries: 100, onError },
    );

    expect(result.occurrences.length).toBe(3);
    // Diagnostic still reports the pre-cap series count (the per-
    // series count, not the post-global-cap clip).
    expect(result.diagnostics.length).toBe(1);
    expect(onError).toHaveBeenCalled();
  });
});
