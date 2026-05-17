import { expandOccurrences, type ExpandOptions } from './expandOccurrences.js';
import type { EngineEvent } from '../schema/eventSchema.js';
import type { EngineOccurrence } from '../schema/occurrenceSchema.js';
import type { OnError, StructuredCalendarError } from '../errors/onError.js';
import { toStructuredError } from '../errors/onError.js';

const DEFAULT_MAX_TOTAL = 10_000;
const DEFAULT_MAX_PER_SERIES = 500;

// ─── Per-series telemetry (#257) ──────────────────────────────────────────────

/**
 * Per-series outcome of one `expandRecurrenceSafe` call. Hosts can
 * walk `result.diagnostics` to wire telemetry, surface "this feed
 * had problems" hints in the UI, or audit which series got capped
 * by the safety bounds.
 *
 *   - `ok`     — clean expansion; `occurrenceCount` is the series's
 *                contribution to `result.occurrences`.
 *   - `error`  — the event was rejected (malformed shape) or the
 *                expansion threw. `error` carries the structured
 *                reason; `occurrenceCount` is 0.
 *   - `capped` — expansion produced exactly `maxPerSeries` occurrences,
 *                so the series may have been clipped. False positives
 *                are possible for series that legitimately produce
 *                exactly the cap; the signal still surfaces "you're
 *                at the limit, consider raising it" without changing
 *                the output count.
 */
export interface SeriesDiagnostic {
  readonly eventId: string;
  readonly status: 'ok' | 'error' | 'capped';
  readonly occurrenceCount: number;
  readonly error?: StructuredCalendarError;
  readonly durationMs?: number;
}

export interface ExpandRecurrenceSafeResult {
  readonly occurrences: EngineOccurrence[];
  readonly diagnostics: readonly SeriesDiagnostic[];
}

export interface ExpandRecurrenceSafeOptions extends ExpandOptions {
  readonly onError?: OnError;
  /** Hard cap across all series for one expansion call. */
  readonly maxTotalOccurrences?: number;
  /**
   * Fired once per input series after expansion (success, failure,
   * or skip). Use to wire engine expansion to host telemetry
   * (Datadog / Sentry / OTel) without coupling the engine to any
   * specific provider.
   */
  readonly onSeriesExpanded?: (diagnostic: SeriesDiagnostic) => void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Guarded recurrence expansion with malformed-input and bounds protection.
 *
 * Returns `{ occurrences, diagnostics }`:
 *   - `occurrences` is the merged stream all callers used to receive
 *     directly. Source-isolated: each input series expands in its own
 *     try/catch, so one bad event records an `error` diagnostic and
 *     contributes zero occurrences without poisoning the others.
 *   - `diagnostics` is per-series telemetry (#257). One entry per
 *     input event in the same order as the input.
 */
export function expandRecurrenceSafe(
  events: readonly EngineEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  opts: ExpandRecurrenceSafeOptions = {},
): ExpandRecurrenceSafeResult {
  const maxTotal = opts.maxTotalOccurrences ?? DEFAULT_MAX_TOTAL;
  const maxPerSeries = opts.maxPerSeries ?? DEFAULT_MAX_PER_SERIES;

  if (!(rangeStart instanceof Date) || Number.isNaN(rangeStart.getTime())
   || !(rangeEnd instanceof Date) || Number.isNaN(rangeEnd.getTime())
   || rangeEnd <= rangeStart) {
    opts.onError?.(
      toStructuredError({
        code: 'RECURRENCE_INVALID_RANGE',
        message: 'expandRecurrenceSafe received an invalid range.',
        domain: 'recurrence',
        severity: 'error',
        recoverable: true,
        context: { rangeStart, rangeEnd },
      }),
      { phase: 'expand' },
    );
    return { occurrences: [], diagnostics: [] };
  }

  const occurrences: EngineOccurrence[] = [];
  const diagnostics: SeriesDiagnostic[] = [];

  for (const ev of events) {
    const t0 = nowMs();
    let diagnostic: SeriesDiagnostic;

    if (!(ev.start instanceof Date) || !(ev.end instanceof Date) || ev.end <= ev.start) {
      const err = toStructuredError({
        code: 'RECURRENCE_MALFORMED_EVENT',
        message: 'Skipping malformed event during recurrence expansion.',
        domain: 'recurrence',
        severity: 'warning',
        recoverable: true,
        context: { eventId: ev.id },
      });
      opts.onError?.(err, { eventId: ev.id, phase: 'expand' });
      diagnostic = {
        eventId: ev.id,
        status: 'error',
        occurrenceCount: 0,
        error: err,
        durationMs: nowMs() - t0,
      };
    } else {
      try {
        const seriesOccurrences = expandOccurrences([ev], rangeStart, rangeEnd, opts);
        // Source isolation: append immediately so one malformed
        // sibling later in the list can't drop already-good data.
        for (const occ of seriesOccurrences) occurrences.push(occ);
        // Treat hitting the per-series cap as a soft "capped" signal.
        // It's a heuristic — series whose true count equals the cap
        // exactly will surface as capped too. The signal is still
        // useful ("you're at the limit; raise maxPerSeries or trim
        // your range").
        const status: SeriesDiagnostic['status'] =
          seriesOccurrences.length >= maxPerSeries ? 'capped' : 'ok';
        diagnostic = {
          eventId: ev.id,
          status,
          occurrenceCount: seriesOccurrences.length,
          durationMs: nowMs() - t0,
        };
      } catch (cause) {
        const err = toStructuredError({
          code: 'RECURRENCE_EXPANSION_FAILED',
          message: 'Unhandled recurrence expansion failure.',
          domain: 'recurrence',
          severity: 'error',
          recoverable: true,
          cause,
          context: { eventId: ev.id },
        });
        opts.onError?.(err, { eventId: ev.id, phase: 'expand' });
        diagnostic = {
          eventId: ev.id,
          status: 'error',
          occurrenceCount: 0,
          error: err,
          durationMs: nowMs() - t0,
        };
      }
    }

    diagnostics.push(diagnostic);
    // Guard the telemetry hook so a misbehaving host callback can't
    // poison the rest of the expansion (Codex P1 on #257). Failures
    // surface to onError but never propagate up.
    if (opts.onSeriesExpanded) {
      try {
        opts.onSeriesExpanded(diagnostic);
      } catch (cause) {
        opts.onError?.(
          toStructuredError({
            code: 'RECURRENCE_TELEMETRY_FAILED',
            message: 'onSeriesExpanded callback threw; expansion continued.',
            domain: 'recurrence',
            severity: 'warning',
            recoverable: true,
            cause,
            context: { eventId: ev.id },
          }),
          { eventId: ev.id, phase: 'expand' },
        );
      }
    }
  }

  if (occurrences.length > maxTotal) {
    opts.onError?.(
      toStructuredError({
        code: 'RECURRENCE_MAX_TOTAL_EXCEEDED',
        message: 'Occurrence expansion exceeded maxTotalOccurrences cap.',
        domain: 'recurrence',
        severity: 'warning',
        recoverable: true,
        context: { maxTotal, actual: occurrences.length },
      }),
      { phase: 'expand' },
    );
    return { occurrences: occurrences.slice(0, maxTotal), diagnostics };
  }

  return { occurrences, diagnostics };
}

// ─── Internals ────────────────────────────────────────────────────────────────

function nowMs(): number {
  // Prefer monotonic timing where available so series durations
  // aren't perturbed by wall-clock corrections during expansion.
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
