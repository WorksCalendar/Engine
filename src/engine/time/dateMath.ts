/**
 * CalendarEngine — pure date arithmetic helpers.
 *
 * All functions take and return plain Date objects.
 * No timezone-awareness — that lives in time/timezone.ts.
 */

// ─── Clamping / snapping ──────────────────────────────────────────────────────

export function clampDate(d: Date, min: Date, max: Date): Date {
  const t = d.getTime();
  if (t < min.getTime()) return new Date(min);
  if (t > max.getTime()) return new Date(max);
  return new Date(t);
}

/** Round a date to the nearest interval boundary. */
export function snapToMinutes(d: Date, intervalMinutes: number): Date {
  const ms = d.getTime();
  const interval = intervalMinutes * 60_000;
  return new Date(Math.round(ms / interval) * interval);
}

/** Floor a date to the nearest interval boundary. */
export function floorToMinutes(d: Date, intervalMinutes: number): Date {
  const ms = d.getTime();
  const interval = intervalMinutes * 60_000;
  return new Date(Math.floor(ms / interval) * interval);
}

// ─── Duration ─────────────────────────────────────────────────────────────────

export function durationMs(start: Date, end: Date): number {
  return end.getTime() - start.getTime();
}

export function durationMinutes(start: Date, end: Date): number {
  return durationMs(start, end) / 60_000;
}

export function durationHours(start: Date, end: Date): number {
  return durationMs(start, end) / 3_600_000;
}

// ─── Arithmetic ───────────────────────────────────────────────────────────────

export function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function addHoursTo(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 3_600_000);
}

// ─── Day boundary (local time) ────────────────────────────────────────────────

export function startOfDayLocal(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function endOfDayLocal(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/** Midnight on the next calendar day (exclusive end for all-day events). */
export function startOfNextDayLocal(d: Date): Date {
  const out = startOfDayLocal(d);
  out.setDate(out.getDate() + 1);
  return out;
}

// ─── Comparisons ─────────────────────────────────────────────────────────────

export function isSameDayLocal(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isBeforeDay(a: Date, b: Date): boolean {
  return startOfDayLocal(a) < startOfDayLocal(b);
}

export function isAfterDay(a: Date, b: Date): boolean {
  return startOfDayLocal(a) > startOfDayLocal(b);
}

/** Return the fractional hours component of a Date (0..24). */
export function hoursDecimal(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/** Parse a "HH:MM" string into decimal hours. */
export function parseHoursString(s: string): number {
  const [h = '0', m = '0'] = s.split(':');
  return parseInt(h, 10) + parseInt(m, 10) / 60;
}
