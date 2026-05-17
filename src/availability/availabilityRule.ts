/**
 * Resource availability rules — issue #214.
 *
 * Layers on top of `EngineResource.businessHours` (a single weekly
 * schedule) to support:
 *   - multiple overlapping weekly open windows per resource
 *   - explicit date-range blackouts (holidays, maintenance)
 *
 * This initial shape deliberately does NOT take a full iCal RRULE
 * string — that's a follow-up once we wire `expandRecurrenceSafe` into
 * the evaluator. For now:
 *   - `kind: 'open'` = weekly recurring open window (dow + HH:MM range)
 *   - `kind: 'blackout'` = absolute start/end ISO range
 *
 * Blackouts always win over open windows. Multiple opens union.
 */

export interface WeeklyOpenRule {
  readonly id: string
  readonly kind: 'open'
  /** Day indices that are working days (0=Sun … 6=Sat). */
  readonly days: readonly number[]
  /** "HH:MM" open time. */
  readonly start: string
  /** "HH:MM" close time; use "24:00" for end-of-day. */
  readonly end: string
}

export interface BlackoutRule {
  readonly id: string
  readonly kind: 'blackout'
  /** Inclusive ISO start. */
  readonly start: string
  /** Exclusive ISO end (iCal convention). */
  readonly end: string
  readonly reason?: string
}

export type AvailabilityRule = WeeklyOpenRule | BlackoutRule
