/**
 * CalendarEngine — pure recurrence math utilities.
 *
 * Low-level helpers used by expandOccurrences and resolveRecurringEdit.
 * No imports from the engine schema — these are pure functions over dates/strings.
 */

// ─── RRULE helpers ────────────────────────────────────────────────────────────

/** Parse a RRULE string (without "RRULE:" prefix) into a key→value map. */
export function parseRRule(rrule: string): Record<string, string> {
  const parts = rrule.split(';');
  const result: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq > 0) result[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return result;
}

/** Serialize a parsed RRULE map back to a string. */
export function serializeRRule(rule: Record<string, string>): string {
  return Object.entries(rule)
    .map(([k, v]) => `${k}=${v}`)
    .join(';');
}

// ─── UNTIL / COUNT helpers ────────────────────────────────────────────────────

/**
 * Return the UNTIL date from a RRULE string, or null if not set.
 * UNTIL is in ICS format: YYYYMMDD or YYYYMMDDTHHmmssZ
 */
export function getRRuleUntil(rrule: string): Date | null {
  const parsed = parseRRule(rrule);
  const until = parsed['UNTIL'];
  if (!until) return null;
  return parseICSDateStr(until);
}

/** Return the COUNT from a RRULE string, or null if not set. */
export function getRRuleCount(rrule: string): number | null {
  const parsed = parseRRule(rrule);
  const count = parsed['COUNT'];
  if (!count) return null;
  return parseInt(count, 10);
}

/**
 * Set an UNTIL date on a RRULE string (removing COUNT if present).
 * Returns the modified RRULE string.
 */
export function setRRuleUntil(rrule: string, until: Date): string {
  const parsed = parseRRule(rrule);
  delete parsed['COUNT'];
  parsed['UNTIL'] = formatICSDateStr(until);
  return serializeRRule(parsed);
}

/**
 * Remove the UNTIL clause from a RRULE (making it infinite or COUNT-bounded).
 */
export function removeRRuleUntil(rrule: string): string {
  const parsed = parseRRule(rrule);
  delete parsed['UNTIL'];
  return serializeRRule(parsed);
}

// ─── Duration helpers ─────────────────────────────────────────────────────────

/** Return the event duration in ms. */
export function eventDurationMs(start: Date, end: Date): number {
  return end.getTime() - start.getTime();
}

/** Apply the same duration to a new start date. */
export function applyDuration(newStart: Date, durationMs: number): Date {
  return new Date(newStart.getTime() + durationMs);
}

// ─── EXDATE helpers ───────────────────────────────────────────────────────────

/** Add a new exdate to an array (deduplicating by day). */
export function addExdate(exdates: readonly Date[], date: Date): Date[] {
  const key = dayKey(date);
  const filtered = exdates.filter(d => dayKey(d) !== key);
  return [...filtered, date];
}

/** Remove an exdate from an array (matching by day). */
export function removeExdate(exdates: readonly Date[], date: Date): Date[] {
  const key = dayKey(date);
  return exdates.filter(d => dayKey(d) !== key);
}

// ─── Occurrence identity ──────────────────────────────────────────────────────

/**
 * Build the occurrence id for the nth occurrence of a series.
 * idx=0 → the event id itself (first occurrence)
 * idx>0 → "{eventId}-r{idx}"
 */
export function buildOccurrenceId(eventId: string, idx: number): string {
  return idx === 0 ? eventId : `${eventId}-r${idx}`;
}

/**
 * Build the occurrenceDate key used to identify a specific occurrence by
 * its original start date (ISO string, truncated to the minute).
 */
export function buildOccurrenceDateKey(start: Date): string {
  return start.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function parseICSDateStr(s: string): Date {
  if (s.length === 8) {
    return new Date(
      parseInt(s.slice(0, 4), 10),
      parseInt(s.slice(4, 6), 10) - 1,
      parseInt(s.slice(6, 8), 10),
    );
  }
  const y  = parseInt(s.slice(0, 4), 10);
  const mo = parseInt(s.slice(4, 6), 10) - 1;
  const d  = parseInt(s.slice(6, 8), 10);
  const h  = parseInt(s.slice(9, 11), 10);
  const mi = parseInt(s.slice(11, 13), 10);
  const sc = parseInt(s.slice(13, 15), 10) || 0;
  return s.endsWith('Z')
    ? new Date(Date.UTC(y, mo, d, h, mi, sc))
    : new Date(y, mo, d, h, mi, sc);
}

function formatICSDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}
