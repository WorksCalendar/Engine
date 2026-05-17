/**
 * CalendarEngine — working calendar schema.
 *
 * A WorkingCalendar defines the time rules for a calendar context:
 * business hours, blocked windows, and timezone.
 *
 * There may be multiple working calendars (per resource, per project, etc.)
 * The engine merges them during validation.
 */

export interface BlockedWindow {
  readonly start: Date;
  readonly end: Date;
  readonly reason?: string;
  /** Scope to a specific resource; null/undefined = applies to all. */
  readonly resourceId?: string | null;
}

export interface BusinessHours {
  /** Day indices that are working days (0=Sun … 6=Sat). Default: [1,2,3,4,5] */
  readonly days: readonly number[];
  /** Decimal hours start, e.g. 9 = 9:00 AM.  Alternatively "09:00" string. */
  readonly start: number | string;
  /** Decimal hours end, e.g. 17 = 5:00 PM. */
  readonly end: number | string;
}

export interface WorkingCalendar {
  readonly id: string;
  readonly name: string;
  readonly timezone: string | null;
  readonly businessHours: BusinessHours | null;
  readonly blockedWindows: readonly BlockedWindow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse a BusinessHours start/end value to decimal hours (0–24). */
export function parseHours(value: number | string): number {
  if (typeof value === 'number') return value;
  const [h, m = '0'] = value.split(':');
  return parseInt(h ?? '0', 10) + parseInt(m, 10) / 60;
}

/** Build the default business-hours working calendar. */
export function defaultWorkingCalendar(
  overrides: Partial<WorkingCalendar> = {},
): WorkingCalendar {
  return {
    id: 'default',
    name: 'Default',
    timezone: null,
    businessHours: {
      days: [1, 2, 3, 4, 5],
      start: 9,
      end: 17,
    },
    blockedWindows: [],
    ...overrides,
  };
}
