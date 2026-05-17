/**
 * validateChange — shared validation pipeline for every create / move / resize.
 *
 * Change shape:
 *   { type: 'create'|'move'|'resize', event: NormalizedEvent|null,
 *     newStart: Date, newEnd: Date, resource?: string }
 *
 * Context shape:
 *   { events?: NormalizedEvent[], businessHours?: BusinessHours,
 *     blockedWindows?: BlockedWindow[] }
 *
 * Returns:
 *   { allowed: boolean, severity: 'none'|'soft'|'hard',
 *     violations: Violation[], suggestedChange: null }
 *
 * Violation shape:
 *   { rule: string, severity: 'soft'|'hard', message: string,
 *     conflictingEvent?: NormalizedEvent }
 *
 * Severity semantics:
 *   hard  — block the commit entirely (e.g. zero duration, blocked window)
 *   soft  — warn and let the user confirm (e.g. overlap, outside biz hours)
 *   none  — clean, commit immediately
 */

// ─── Individual rules ──────────────────────────────────────────────────────────

type ValidatorEvent = {
  id?: string;
  title?: string;
  resource?: unknown;
  allDay?: boolean;
  start?: Date;
  end?: Date;
} | null | undefined;

type Change = {
  type?: string;
  event?: ValidatorEvent;
  newStart: Date;
  newEnd: Date;
  resource?: unknown;
};

type BlockedWindow = {
  resource?: unknown;
  start: Date | string | number;
  end: Date | string | number;
  reason?: string;
};

type BusinessHours = {
  days?: number[];
  start: number;
  end: number;
};

type ValidatorContext = {
  events?: Array<NonNullable<ValidatorEvent> & { end: Date; start: Date }>;
  businessHours?: BusinessHours;
  blockedWindows?: BlockedWindow[];
};

type Violation = {
  rule: string;
  severity: 'soft' | 'hard';
  message: string;
  conflictingEvent?: unknown;
};

/** Duration must be positive. */
function checkInvalidDuration({ newStart, newEnd }: Change, _ctx: ValidatorContext): Violation | null {
  if (newEnd.getTime() <= newStart.getTime()) {
    return {
      rule:     'invalid-duration',
      severity: 'hard',
      message:  'End time must be after start time.',
    };
  }
  return null;
}

/** Event must not overlap a declared blocked window. */
function checkBlockedWindow(
  { event, newStart, newEnd, resource: changeResource }: Change,
  { blockedWindows = [] }: ValidatorContext,
): Violation | null {
  if (!blockedWindows.length) return null;
  const resource = event?.resource ?? changeResource ?? null;

  for (const w of blockedWindows) {
    if (w.resource && w.resource !== resource) continue;
    const wStart = w.start instanceof Date ? w.start : new Date(w.start);
    const wEnd   = w.end   instanceof Date ? w.end   : new Date(w.end);
    if (newStart < wEnd && newEnd > wStart) {
      return {
        rule:     'blocked-window',
        severity: 'hard',
        message:  w.reason
          ? `Blocked: ${w.reason}`
          : resource
            ? `${resource} is unavailable during this period.`
            : 'This time slot is blocked.',
      };
    }
  }
  return null;
}

/**
 * Resource-scoped overlap: warn when two timed events for the same resource
 * overlap.  Skipped when no resource is set (unscoped events may freely overlap).
 */
function checkOverlap(
  { event, newStart, newEnd, resource: changeResource }: Change,
  { events = [] }: ValidatorContext,
): Violation | null {
  const resource = event?.resource ?? changeResource ?? null;
  if (!resource) return null;

  const conflict = events.find(existing => {
    if (event?.id && existing.id === event.id) return false; // skip self
    if (existing.resource !== resource) return false;
    if (existing.allDay) return false;
    return newStart < existing.end && newEnd > existing.start;
  });

  if (!conflict) return null;
  return {
    rule:             'overlap',
    severity:         'soft',
    message:          `${resource} has a conflict with "${conflict.title}".`,
    conflictingEvent: conflict,
  };
}

/**
 * Warn when a timed event falls outside the configured business hours.
 * All-day events and events spanning ≥24 h are skipped.
 */
function checkBusinessHours(
  { event, newStart, newEnd }: Change,
  { businessHours }: ValidatorContext,
): Violation | null {
  if (!businessHours) return null;
  if (event?.allDay) return null;
  if (newEnd.getTime() - newStart.getTime() >= 24 * 60 * 60 * 1000) return null; // multi-day

  const bizDays = businessHours.days ?? [1, 2, 3, 4, 5];
  if (!bizDays.includes(newStart.getDay())) {
    return {
      rule:     'outside-business-hours',
      severity: 'soft',
      message:  'This day is outside business hours.',
    };
  }

  const startH = newStart.getHours() + newStart.getMinutes() / 60;
  const endH   = newEnd.getHours()   + newEnd.getMinutes()   / 60;
  // endH === 0 means midnight — treat as 24 for comparison
  const endHCmp = endH === 0 ? 24 : endH;

  if (startH < businessHours.start || endHCmp > businessHours.end) {
    return {
      rule:     'outside-business-hours',
      severity: 'soft',
      message:  'This time is outside business hours.',
    };
  }
  return null;
}

// ─── Pipeline ──────────────────────────────────────────────────────────────────

const RULES = [
  checkInvalidDuration,
  checkBlockedWindow,
  checkOverlap,
  checkBusinessHours,
];

/**
 * Run all rules and return a combined result.
 *
 * @param {{ type: string, event: object|null, newStart: Date, newEnd: Date, resource?: string }} change
 * @param {{ events?: object[], businessHours?: object, blockedWindows?: object[] }} context
 * @returns {{ allowed: boolean, severity: 'none'|'soft'|'hard', violations: object[], suggestedChange: null }}
 */
export function validateChange(
  change: Change,
  context: ValidatorContext = {},
): {
  allowed: boolean;
  severity: 'none' | 'soft' | 'hard';
  violations: Violation[];
  suggestedChange: null;
} {
  const violations = RULES.map(r => r(change, context)).filter((v): v is Violation => v !== null);
  const hasHard    = violations.some(v => v.severity === 'hard');
  const hasSoft    = violations.some(v => v.severity === 'soft');
  return {
    allowed:        !hasHard,
    severity:       hasHard ? 'hard' : hasSoft ? 'soft' : 'none',
    violations,
    suggestedChange: null,
  };
}
