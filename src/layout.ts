/**
 * layout.js — shared event layout algorithms.
 *
 *   layoutOverlaps  — column-pack timed events that share the same time slot
 *   layoutSpans     — lane-pack multi-day events for month/all-day row rendering
 */
import { differenceInCalendarDays, addDays, startOfDay } from 'date-fns';

type LayoutEvent = {
  start: Date;
  end: Date;
  allDay?: boolean | undefined;
};

// ─── Timed event overlap layout (week / day view) ──────────────────────────

/**
 * Assign non-overlapping horizontal columns to a set of timed events.
 *
 * @param {LayoutEvent[]} events
 * @returns {Array<LayoutEvent & { _col: number; _numCols: number }>}
 */
export function layoutOverlaps<T extends LayoutEvent>(
  events: T[],
): Array<T & { _col: number; _numCols: number }> {
  if (!events.length) return [];

  // Sort by start time, then longer events first for visual stability
  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
      || (b.end.getTime() - b.start.getTime()) - (a.end.getTime() - a.start.getTime()),
  );

  const colEnds: Date[] = []; // colEnds[i] = end time of the last event placed in column i

  const withCols = sorted.map(ev => {
    const col = colEnds.findIndex(end => end <= ev.start);
    const assigned = col === -1 ? colEnds.length : col;
    colEnds[assigned] = ev.end;
    return { ...ev, _col: assigned };
  });

  const numCols = colEnds.length;
  return withCols.map(ev => ({ ...ev, _numCols: numCols }));
}

// ─── Multi-day event span layout (month view / all-day row) ───────────────

/**
 * Return the start of the UTC calendar day that contains `d`.
 * Using UTC avoids local-timezone shifts that would cause `startOfDay` from
 * date-fns (which respects local time) to return the wrong calendar day when
 * the host machine is not in UTC.
 */
function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The "display end day" of an event — the last calendar day the event
 * occupies (inclusive), accounting for exclusive all-day ends.
 *
 * Strategy:
 * - All-day events: use LOCAL calendar days (the calendar cells are labeled by
 *   local date). iCal DTEND is a local-midnight exclusive end, so we subtract
 *   one local day.
 * - Timed events: use UTC calendar days (timed events with explicit UTC times
 *   are placed in UTC-based day cells). A timed event ending exactly at UTC
 *   midnight should not occupy the boundary day.
 *
 * Returns a UTC-midnight Date for timed events and a local-midnight Date for
 * all-day events (matching the day-cell coordinates used in each case).
 */
export function displayEndDay(ev: LayoutEvent): Date {
  const end = ev.end;

  if (ev.allDay) {
    // All-day events use iCal's exclusive DTEND convention in LOCAL time:
    // DTEND=Jan4 (local midnight) means the event covers Jan1–Jan3.
    const localDay = startOfDay(end);
    const atLocalMidnight = end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0;
    return atLocalMidnight ? addDays(localDay, -1) : localDay;
  }

  // Timed events: use UTC days.
  const day = startOfUTCDay(end);
  const atMidnightUTC = end.getUTCHours() === 0 && end.getUTCMinutes() === 0 && end.getUTCSeconds() === 0;
  // Timed events that end exactly at UTC midnight and started on an earlier UTC
  // day should not "occupy" the boundary day in month-span lane packing.
  // This prevents adjacent back-to-back rotations from double-stacking.
  const startUTCDay = startOfUTCDay(ev.start);
  if (atMidnightUTC && startUTCDay.getTime() !== day.getTime()) return addDays(day, -1);
  // Otherwise, timed events use their real UTC end day.
  return day;
}

/**
 * Pack multi-day (spanning) events into non-overlapping lanes for one week row.
 *
 * @param {LayoutEvent[]} events   — already filtered to multi-day events
 * @param {Date}              weekStart — first day (Monday/Sunday) of the week row
 * @param {Date}              weekEnd   — last day of the week row
 * @returns {Array<{
 *   ev: LayoutEvent;
 *   startCol: number;      // 0–6, clipped to week
 *   endCol: number;        // 0–6, clipped to week (inclusive)
 *   lane: number;
 *   continuesBefore: boolean;
 *   continuesAfter: boolean;
 * }>}
 */
export type LayoutSpanItem<T extends LayoutEvent = LayoutEvent> = {
  ev: T;
  evStartDay: Date;
  evEndDay: Date;
  startCol: number;
  endCol: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
};

export function layoutSpans<T extends LayoutEvent>(
  events: T[],
  weekStart: Date,
  weekEnd: Date,
): LayoutSpanItem<T>[] {
  // Normalise all day boundaries to UTC midnight so comparisons are consistent
  // regardless of whether weekStart/weekEnd are local-midnight or UTC-midnight.
  const weekStartUTC = startOfUTCDay(weekStart);
  const weekEndUTC   = startOfUTCDay(weekEnd);

  const items = events
    .map(ev => {
      const evStartDay = startOfUTCDay(ev.start);
      // displayEndDay returns UTC-midnight for timed events, local-midnight for
      // all-day events. Normalise to UTC so the comparisons below are uniform.
      const evEndDay   = startOfUTCDay(displayEndDay(ev));
      return {
        ev,
        evStartDay,
        evEndDay,
        startCol: Math.max(0, differenceInCalendarDays(evStartDay, weekStartUTC)),
        endCol:   Math.min(6, differenceInCalendarDays(evEndDay,   weekStartUTC)),
        continuesBefore: evStartDay < weekStartUTC,
        continuesAfter:  evEndDay   > weekEndUTC,
      };
    })
    // Must actually overlap this week
    .filter(item => item.evStartDay <= weekEndUTC && item.evEndDay >= weekStartUTC)
    // Sort by visual start position, then longer spans first
    .sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));

  const laneEnds: number[] = []; // laneEnds[i] = last endCol placed in lane i

  return items.map(item => {
    let lane = laneEnds.findIndex(end => end < item.startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.endCol;
    return { ...item, lane };
  });
}
