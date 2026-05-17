/**
 * CalendarEngine — business-hours validation rule.
 *
 * Warns when a timed event falls outside the configured business hours.
 *
 * Skipped for:
 *   - all-day events
 *   - events spanning ≥ 24 hours
 *   - when no businessHours config is provided
 */

import type { Violation, OperationContext, ChangeShape } from './validationTypes.js';
import { hoursDecimal, parseHoursString } from '../time/dateMath.js';

export function validateWorkingHours(
  change: ChangeShape,
  ctx: OperationContext,
): Violation | null {
  const bh = ctx.businessHours;
  if (!bh) return null;

  // Skip all-day events
  if (change.event?.allDay) return null;

  // Skip multi-day events
  const durationMs = change.newEnd.getTime() - change.newStart.getTime();
  if (durationMs >= 24 * 60 * 60 * 1000) return null;

  // ── Day check ────────────────────────────────────────────────────────────
  const bizDays = bh.days ?? [1, 2, 3, 4, 5];
  if (!bizDays.includes(change.newStart.getDay())) {
    return {
      rule:     'outside-business-hours',
      severity: 'soft',
      message:  'This day is outside business hours.',
    };
  }

  // ── Time check ───────────────────────────────────────────────────────────
  const bizStart = typeof bh.start === 'string' ? parseHoursString(bh.start) : bh.start;
  const bizEnd   = typeof bh.end   === 'string' ? parseHoursString(bh.end)   : bh.end;

  const evStartH = hoursDecimal(change.newStart);
  const evEndH   = change.newEnd.getHours() + change.newEnd.getMinutes() / 60;
  // Midnight end (00:00) means the event runs to end of day → treat as 24
  const evEndHCmp = evEndH === 0 ? 24 : evEndH;

  if (evStartH < bizStart || evEndHCmp > bizEnd) {
    return {
      rule:     'outside-business-hours',
      severity: 'soft',
      message:  'This time is outside business hours.',
    };
  }

  return null;
}
