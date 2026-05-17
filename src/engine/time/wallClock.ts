/**
 * CalendarEngine — wall-clock time semantics.
 *
 * "Wall clock" means the time as displayed on a clock in a specific timezone,
 * e.g. "9:00 AM in Denver".
 *
 * This matters for recurring events: "every Monday at 9 AM" should stay at
 * 9 AM local time, even when DST transitions change the UTC offset.
 *
 * Key concept: wall-clock events are stored with their IANA timezone so the
 * engine can always recover the correct UTC instant for any given date.
 */

import { wallClockToUtc, hoursInTimezone, partsInTimezone, utcOffsetMinutes } from './timezone.js';

// ─── Wall-clock anchor ────────────────────────────────────────────────────────

/**
 * A timezone-aware wall-clock time anchor.
 * Represents "HH:MM in <tz>" without binding to a specific date.
 */
export interface WallClockAnchor {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly timezone: string;
}

/**
 * Extract the wall-clock anchor from a Date in the given timezone.
 */
export function extractWallClockAnchor(d: Date, tz: string): WallClockAnchor {
  const parts = partsInTimezone(d, tz);
  return { hour: parts.hour, minute: parts.minute, second: parts.second, timezone: tz };
}

/**
 * Apply a wall-clock anchor to a specific date (year/month/day) in the
 * anchor's timezone.  Returns the UTC Date.
 *
 * Use this when expanding recurring events: take the series master's
 * wall-clock time and project it onto each occurrence date.
 */
export function applyWallClockAnchor(
  year: number,
  month: number, // 1-based
  day: number,
  anchor: WallClockAnchor,
): Date {
  return wallClockToUtc(year, month, day, anchor.hour, anchor.minute, anchor.second, anchor.timezone);
}

// ─── Duration preservation ────────────────────────────────────────────────────

/**
 * Compute the end time for an occurrence given:
 *   - the occurrence start (UTC)
 *   - the original event duration in ms
 *   - the event's timezone (for DST-aware duration)
 *
 * When `tz` is null/undefined, this is `start + durationMs` — the
 * UTC delta is preserved. That matches the "floating event" model
 * and is the right call when no timezone is known.
 *
 * When `tz` is a valid IANA zone, this preserves the **wall-clock**
 * duration instead. That matters across DST transitions: a 2h
 * meeting that starts at 1:00 AM the night clocks spring forward
 * should end at 3:00 AM (wall-clock), not 4:00 AM. UTC-only math
 * skips an hour by silently keeping a 2h UTC delta even though the
 * clock itself jumped.
 *
 * Algorithm:
 *   1. Project `start` to wall-clock parts in `tz`.
 *   2. Add `durationMs` worth of wall-clock time, carrying minutes
 *      → hours → days the same way regardless of DST (i.e. clock
 *      arithmetic, not UTC arithmetic).
 *   3. Convert the new wall-clock parts back to UTC at `tz`. If
 *      the end lands inside a spring-forward gap (a non-existent
 *      time), `wallClockToUtc` snaps it to the post-DST equivalent.
 */
export function computeOccurrenceEnd(
  start: Date,
  durationMs: number,
  tz?: string | null,
): Date {
  if (!tz) return new Date(start.getTime() + durationMs);

  const startParts = partsInTimezone(start, tz);
  // Carry the start's offset as a fold-side hint so a fall-back
  // ambiguous end stays on the same side of the transition as the
  // start (Codex P1 on #258). Without this, an event whose start is
  // the second instance of the repeated hour and whose end is still
  // inside that hour gets re-anchored to the first instance — moving
  // end *before* start.
  const startOffsetMinutes = utcOffsetMinutes(start, tz);
  // Sub-second precision lives outside `partsInTimezone` (integer
  // seconds only) and outside `wallClockToUtc` (no ms argument), so
  // we shuttle the millisecond residue through the wall-clock
  // arithmetic by hand (Codex P2 on #258).
  const startMsResidue = start.getTime() - Math.floor(start.getTime() / 1000) * 1000;

  // Treat the wall-clock parts as if they were UTC and add the
  // residue + duration there. This is "clock arithmetic" — the
  // carry rules (60s = 1m, 60m = 1h, etc.) match what a wall clock
  // does, and the result is independent of the source/target offsets.
  const wallStartAsUtc = Date.UTC(
    startParts.year,
    startParts.month - 1,
    startParts.day,
    startParts.hour,
    startParts.minute,
    startParts.second,
  );
  const wallEndAsUtc = new Date(wallStartAsUtc + startMsResidue + durationMs);
  const wallEndMsResidue = wallEndAsUtc.getTime() - Math.floor(wallEndAsUtc.getTime() / 1000) * 1000;

  // Read the post-add wall-clock parts back out of the throwaway UTC
  // moment and re-anchor in the real timezone, preferring the start's
  // DST offset when ambiguous.
  const baseEnd = wallClockToUtc(
    wallEndAsUtc.getUTCFullYear(),
    wallEndAsUtc.getUTCMonth() + 1,
    wallEndAsUtc.getUTCDate(),
    wallEndAsUtc.getUTCHours(),
    wallEndAsUtc.getUTCMinutes(),
    wallEndAsUtc.getUTCSeconds(),
    tz,
    startOffsetMinutes,
  );
  return new Date(baseEnd.getTime() + wallEndMsResidue);
}

// ─── Display helpers ──────────────────────────────────────────────────────────

/**
 * Return the fractional hour position (0..24) for a date in the given
 * timezone.  Used by time-grid views to position events.
 */
export function eventStartHour(d: Date, tz: string | null): number {
  if (!tz) return d.getHours() + d.getMinutes() / 60;
  return hoursInTimezone(d, tz);
}
