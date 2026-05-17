/**
 * CalendarEngine — constraint validation rules.
 *
 * Hard rules that block commits entirely:
 *   - invalid-duration: end must be strictly after start
 *   - min-duration:     duration must meet the configured minimum
 *   - blocked-window:   event must not overlap a declared blocked window
 */

import type { Violation, OperationContext, ChangeShape } from './validationTypes.js';

// ─── Duration rules ───────────────────────────────────────────────────────────

export function validateDuration(
  change: ChangeShape,
  ctx: OperationContext,
): Violation | null {
  const durationMs = change.newEnd.getTime() - change.newStart.getTime();

  if (durationMs <= 0) {
    return {
      rule:     'invalid-duration',
      severity: 'hard',
      message:  'End time must be after start time.',
    };
  }

  const minMinutes = ctx.config?.minEventDurationMinutes ?? 1;
  if (durationMs < minMinutes * 60_000) {
    return {
      rule:     'min-duration',
      severity: 'hard',
      message:  `Events must be at least ${minMinutes} minute${minMinutes === 1 ? '' : 's'} long.`,
    };
  }

  return null;
}

// ─── Blocked window rule ──────────────────────────────────────────────────────

export function validateBlockedWindow(
  change: ChangeShape,
  ctx: OperationContext,
): Violation | null {
  const windows = ctx.blockedWindows ?? [];
  if (!windows.length) return null;

  const resourceId = change.resourceId ?? change.event?.resourceId ?? null;

  for (const w of windows) {
    // Resource-scoped windows only apply to matching resources
    if (w.resourceId && w.resourceId !== resourceId) continue;

    const wStart = w.start instanceof Date ? w.start : new Date(w.start as string);
    const wEnd   = w.end   instanceof Date ? w.end   : new Date(w.end   as string);

    if (change.newStart < wEnd && change.newEnd > wStart) {
      return {
        rule:     'blocked-window',
        severity: 'hard',
        message:  w.reason
          ? `Blocked: ${w.reason}`
          : resourceId
          ? `${resourceId} is unavailable during this period.`
          : 'This time slot is blocked.',
        details: { blockedStart: wStart, blockedEnd: wEnd },
      };
    }
  }

  return null;
}
