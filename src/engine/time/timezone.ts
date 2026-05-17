/**
 * CalendarEngine — timezone utilities.
 *
 * Wraps the Intl API for timezone-aware date operations.
 * All functions are pure (no side effects).
 *
 * Strategy: store and transmit dates as UTC (JS Date objects).
 * Convert to/from the display timezone only at the view boundary.
 */
import { format } from 'date-fns';

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Return the IANA timezone identifier for the current browser/runtime.
 * Falls back to "UTC" if detection fails.
 */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** True if the given IANA timezone identifier is valid. */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ─── Display formatting ───────────────────────────────────────────────────────

/**
 * Format a Date in a specific IANA timezone.
 * Returns a plain object with numeric date/time parts.
 */
export function partsInTimezone(
  d: Date,
  tz: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false,
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(d).map(p => [p.type, p.value]),
  );

  return {
    year:   parseInt(parts['year']   ?? '0', 10),
    month:  parseInt(parts['month']  ?? '0', 10),
    day:    parseInt(parts['day']    ?? '0', 10),
    hour:   parseInt(parts['hour']   ?? '0', 10) % 24, // hour12=false can give 24
    minute: parseInt(parts['minute'] ?? '0', 10),
    second: parseInt(parts['second'] ?? '0', 10),
  };
}

/**
 * Get the UTC offset (in minutes) of a timezone at a specific instant.
 * Positive = east of UTC (e.g. +60 = UTC+1), negative = west.
 */
export function utcOffsetMinutes(d: Date, tz: string): number {
  const parts = partsInTimezone(d, tz);
  // Build the wall-clock time as if it were UTC, then compute difference
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetMs  = wallAsUtc - d.getTime();
  // Round to nearest minute to avoid sub-minute DST quirks
  return Math.round(offsetMs / 60_000);
}

// ─── Conversion ───────────────────────────────────────────────────────────────

/**
 * Convert a "wall clock" date (year/month/day/hour/minute in a timezone)
 * to a UTC Date object.
 *
 * Example: 9:00 AM in America/Denver → UTC Date
 *
 * DST-aware (#258): collects up to four candidate UTC instants
 * (the offset-1 anchor, the offset-2 anchor for non-trivial fixups,
 * and ±1h fold siblings) and returns the one whose `partsInTimezone`
 * round-trips back to the requested wall-clock target.
 *
 *   - Outside DST transitions: candidate1 round-trips and is returned.
 *   - Spring-forward gap (a wall-clock time that doesn't exist):
 *     none of the candidates round-trip. Default to the offset-2
 *     anchor when available, otherwise candidate1 — both represent
 *     the "snap forward" mapping in the common case.
 *   - Fall-back fold (an ambiguous wall-clock time that repeats):
 *     two candidates round-trip. By default the earlier (DST-active)
 *     instance wins. Callers can pin a side via `preferOffsetMinutes`
 *     — typically the offset of a known anchor (e.g. start time) —
 *     to keep duration math monotonic across the fold.
 */
export function wallClockToUtc(
  year: number,
  month: number, // 1-based
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
  preferOffsetMinutes?: number,
): Date {
  const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const target = { year, month, day, hour, minute, second };

  const offset1 = utcOffsetMinutes(approxUtc, tz);
  const candidate1 = new Date(approxUtc.getTime() - offset1 * 60_000);

  // Build candidate set: the naive anchor, the re-anchored variant
  // when offsets disagree (handles spring-forward where offset1 reads
  // the pre-DST side but the target lives on the post-DST side), and
  // ±1h fold siblings (handles fall-back ambiguity, where the same
  // wall-clock minute exists in both the DST-active and standard
  // periods).
  const candidates: Date[] = [candidate1];
  const offset2 = utcOffsetMinutes(candidate1, tz);
  if (offset2 !== offset1) {
    candidates.push(new Date(approxUtc.getTime() - offset2 * 60_000));
  }
  candidates.push(new Date(candidate1.getTime() + 3_600_000));
  candidates.push(new Date(candidate1.getTime() - 3_600_000));

  const matches = candidates.filter(d => matchesWallClock(d, tz, target));
  if (matches.length === 0) {
    // Spring-forward gap — `candidate1` is the snap-forward result
    // (the wall-clock time interpreted with the offset that was in
    // force just before the transition, which lands one missing
    // hour past the requested time on the post-DST side).
    return candidate1;
  }

  if (preferOffsetMinutes !== undefined) {
    const hinted = matches.find(d => utcOffsetMinutes(d, tz) === preferOffsetMinutes);
    if (hinted) return hinted;
  }
  return matches[0]!;
}

function matchesWallClock(
  d: Date,
  tz: string,
  target: { year: number; month: number; day: number; hour: number; minute: number; second: number },
): boolean {
  const p = partsInTimezone(d, tz);
  return p.year === target.year && p.month === target.month && p.day === target.day
      && p.hour === target.hour && p.minute === target.minute && p.second === target.second;
}

/**
 * Return the "local" hours decimal (0..24) for a date in the given timezone.
 * Useful for positioning events on a time grid.
 */
export function hoursInTimezone(d: Date, tz: string): number {
  const p = partsInTimezone(d, tz);
  return p.hour + p.minute / 60 + p.second / 3600;
}

// ─── Display formatting ───────────────────────────────────────────────────────

/**
 * Format a Date using a date-fns format string, interpreted in the given
 * IANA timezone. When no timezone is provided, delegates to plain `format`.
 *
 * Works by projecting the UTC instant to the target timezone wall-clock time,
 * constructing an equivalent "fake local" Date, then formatting with date-fns.
 */
export function formatInTimezone(d: Date, formatStr: string, tz?: string | null): string {
  if (!tz) return format(d, formatStr);
  const p = partsInTimezone(d, tz);
  const wallDate = new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return format(wallDate, formatStr);
}

/**
 * Return a short UTC-offset label for the given timezone at a given instant.
 * e.g. "UTC-5" or "UTC+5:30"
 */
export function tzOffsetLabel(d: Date, tz: string): string {
  const offsetMin = utcOffsetMinutes(d, tz);
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const h = Math.floor(absMin / 60);
  const m = absMin % 60;
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
}

// ─── Event timezone handling ──────────────────────────────────────────────────

/**
 * Normalize an event's start/end from its stored timezone to the display
 * timezone.
 *
 * For floating events (timezone === null), start/end are already in local time
 * and are returned unchanged.
 */
export function convertEventToDisplayZone(
  start: Date,
  end: Date,
  eventTz: string | null,
  displayTz: string | null,
): { start: Date; end: Date } {
  // If either timezone is null (floating), no conversion needed
  if (!eventTz || !displayTz || eventTz === displayTz) {
    return { start, end };
  }

  // JS Date is always UTC internally; Intl handles display conversion.
  // No data transformation needed — the same Date object displays
  // differently depending on the timezone used for formatting.
  return { start, end };
}
