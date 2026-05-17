import type { EngineEvent } from '../schema/eventSchema.js';
import type { OnError } from '../errors/onError.js';
import { toStructuredError } from '../errors/onError.js';
import { isValidTimezone } from '../time/timezone.js';

export type ValidationMode = 'strict' | 'prod';

export type EventValidationCode =
  | 'INVALID_EVENT'
  | 'INVALID_ID'
  | 'INVALID_TITLE'
  | 'INVALID_START'
  | 'INVALID_END'
  | 'INVALID_RANGE'
  | 'INVALID_EXDATES'
  | 'INVALID_RRULE'
  | 'INVALID_TIMEZONE'
  | 'INVALID_RESOURCE_ID'
  | 'INVALID_COLOR';

/**
 * Per-source policy override for an issue code. Used in prod mode
 * (#259) so a single misbehaving feed can downgrade or ignore a
 * specific class of issue without blocking the rest of the data.
 *
 *   - 'error'  — surface as an error (default, blocks `ok`)
 *   - 'warn'   — surface but don't block `ok`
 *   - 'ignore' — drop the issue entirely
 */
export type EventIssueAction = 'error' | 'warn' | 'ignore';
export type EventIssueSeverity = 'error' | 'warn';

export interface EventValidationIssue {
  readonly code: EventValidationCode;
  readonly field: keyof EngineEvent | 'event';
  readonly message: string;
  readonly severity: EventIssueSeverity;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface EventValidationResult {
  /** True when no `error`-severity issues remain after policy. */
  readonly ok: boolean;
  readonly issues: readonly EventValidationIssue[];
}

export interface ValidateEventOptions {
  /**
   * strict: every check is enforced; empty titles, unknown timezones,
   *         malformed colors, and unparseable RRULEs all surface as
   *         hard errors.
   * prod:   best-effort; titles may be empty without an error,
   *         color is not checked (presentation is the host's concern),
   *         and `sourcePolicy` can downgrade individual codes.
   */
  readonly mode?: ValidationMode;
  /**
   * In prod mode, override how specific codes are handled. Codes
   * not listed keep their default severity. Hosts use this when a
   * single feed has known dirty data that shouldn't block render.
   */
  readonly sourcePolicy?: Partial<Record<EventValidationCode, EventIssueAction>>;
  /**
   * When provided, called once per `error`-severity issue with a
   * structured error and `{ phase: 'validate', sourceId?, eventId? }`
   * meta. Mirrors the contract used by `expandRecurrenceSafe`.
   */
  readonly onError?: OnError;
  /** Optional source identifier — passed through to `onError` meta. */
  readonly sourceId?: string;
}

/**
 * Schema-driven event validator (#259).
 *
 * Walks the entire `EngineEvent` shape rather than just the few fields
 * checked by the original skeleton: shapes for id / title / start /
 * end / range / exdates plus best-effort schema checks for rrule,
 * timezone, resourceId, and color (color is strict-only).
 *
 * No external runtime deps — the existing `EventValidationCode` union
 * is the schema.
 *
 * Returns `{ ok, issues }`. `ok` reflects only `error`-severity
 * issues; `warn`-severity issues stay in `issues` but don't fail.
 */
export function validateEvent(
  input: unknown,
  opts: ValidateEventOptions = {},
): EventValidationResult {
  const mode = opts.mode ?? 'strict';
  const collected: EventValidationIssue[] = [];
  const collect = (
    code: EventValidationCode,
    field: EventValidationIssue['field'],
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ): boolean => {
    const action = resolveAction(code, mode, opts.sourcePolicy);
    if (action === 'ignore') return false;
    const issue: EventValidationIssue = details === undefined
      ? { code, field, message, severity: actionToSeverity(action) }
      : { code, field, message, severity: actionToSeverity(action), details };
    collected.push(issue);
    return true;
  };

  // Non-object payload — route through the same policy machinery so
  // `sourcePolicy: { INVALID_EVENT: 'warn' | 'ignore' }` is honored
  // (Codex P2 on #259). Bail before touching `ev.<field>` accessors.
  if (!input || typeof input !== 'object') {
    collect('INVALID_EVENT', 'event', 'Event must be an object.');
    for (const issue of collected) {
      if (issue.severity === 'error') emit(issue, undefined, opts);
    }
    return {
      ok: !collected.some(i => i.severity === 'error'),
      issues: collected,
    };
  }

  const ev = input as Partial<EngineEvent>;

  // ── id ────────────────────────────────────────────────────────────────────
  if (typeof ev.id !== 'string' || ev.id.trim().length === 0) {
    collect('INVALID_ID', 'id', 'Event id must be a non-empty string.');
  }

  // ── title ────────────────────────────────────────────────────────────────
  if (typeof ev.title !== 'string') {
    collect('INVALID_TITLE', 'title', 'Event title must be a string.');
  } else if (ev.title.trim().length === 0 && mode === 'strict') {
    collect('INVALID_TITLE', 'title', 'Event title must be non-empty in strict mode.');
  }

  // ── start ────────────────────────────────────────────────────────────────
  if (!isFiniteDate(ev.start)) {
    collect('INVALID_START', 'start', 'Event start must be a finite Date.');
  }

  // ── end + range ──────────────────────────────────────────────────────────
  if (!isFiniteDate(ev.end)) {
    collect('INVALID_END', 'end', 'Event end must be a finite Date.');
  } else if (isFiniteDate(ev.start) && (ev.end as Date) <= (ev.start as Date)) {
    collect(
      'INVALID_RANGE', 'end', 'Event end must be after start.',
      { start: (ev.start as Date).toISOString(), end: (ev.end as Date).toISOString() },
    );
  }

  // ── exdates ──────────────────────────────────────────────────────────────
  if (ev.exdates !== undefined) {
    if (!Array.isArray(ev.exdates)) {
      collect('INVALID_EXDATES', 'exdates', 'exdates must be an array of Date values.');
    } else {
      const badIndex = ev.exdates.findIndex(d => !isFiniteDate(d));
      if (badIndex !== -1) {
        collect(
          'INVALID_EXDATES', 'exdates',
          `exdates[${badIndex}] is not a valid Date.`,
          { index: badIndex },
        );
      }
    }
  }

  // ── rrule ────────────────────────────────────────────────────────────────
  if (ev.rrule !== undefined && ev.rrule !== null) {
    if (typeof ev.rrule !== 'string' || !looksLikeRrule(ev.rrule)) {
      collect('INVALID_RRULE', 'rrule', 'rrule must be a parseable RRULE string.');
    }
  }

  // ── timezone ─────────────────────────────────────────────────────────────
  if (ev.timezone !== undefined && ev.timezone !== null) {
    if (typeof ev.timezone !== 'string' || !isValidTimezone(ev.timezone)) {
      collect(
        'INVALID_TIMEZONE', 'timezone',
        `timezone "${String(ev.timezone)}" is not a recognised IANA identifier.`,
      );
    }
  }

  // ── resourceId ───────────────────────────────────────────────────────────
  if (ev.resourceId !== undefined && ev.resourceId !== null) {
    if (typeof ev.resourceId !== 'string') {
      collect('INVALID_RESOURCE_ID', 'resourceId', 'resourceId must be a string when present.');
    }
  }

  // ── color (strict-only) ──────────────────────────────────────────────────
  if (mode === 'strict' && ev.color !== undefined && ev.color !== null) {
    if (typeof ev.color !== 'string' || !looksLikeCssColor(ev.color)) {
      collect('INVALID_COLOR', 'color', `color "${String(ev.color)}" is not a recognised CSS color.`);
    }
  }

  // Fan out errors to onError. Soft / warn-severity issues stay in
  // the result for callers but don't ping telemetry.
  const eventId = typeof ev.id === 'string' ? ev.id : undefined;
  for (const issue of collected) {
    if (issue.severity === 'error') emit(issue, eventId, opts);
  }

  return {
    ok: !collected.some(i => i.severity === 'error'),
    issues: collected,
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime());
}

function actionToSeverity(action: Exclude<EventIssueAction, 'ignore'>): EventIssueSeverity {
  return action;
}

function resolveAction(
  code: EventValidationCode,
  mode: ValidationMode,
  policy: ValidateEventOptions['sourcePolicy'],
): EventIssueAction {
  // Strict mode ignores sourcePolicy — every issue is an error.
  if (mode === 'strict') return 'error';
  return policy?.[code] ?? 'error';
}

function emit(
  issue: EventValidationIssue,
  eventId: string | undefined,
  opts: ValidateEventOptions,
): void {
  if (!opts.onError) return;
  const meta: { phase: 'validate'; sourceId?: string; eventId?: string } = { phase: 'validate' };
  if (opts.sourceId !== undefined) meta.sourceId = opts.sourceId;
  if (eventId !== undefined) meta.eventId = eventId;
  opts.onError(
    toStructuredError({
      code: issue.code,
      message: issue.message,
      domain: 'validation',
      severity: 'error',
      recoverable: true,
      ...(issue.details !== undefined ? { context: issue.details } : {}),
    }),
    meta,
  );
}

/**
 * Permissive RRULE shape check. We don't fully parse the rule —
 * `expandRRule` does that lazily and survives malformed input — but
 * we do require at least one `KEY=VALUE` pair and a recognised FREQ
 * so blatantly broken strings (e.g. "rrule"") don't pass validation.
 */
function looksLikeRrule(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  // Strip the optional "RRULE:" prefix that some feeds include.
  const body = trimmed.replace(/^RRULE:/i, '');
  const parts = body.split(';').filter(Boolean);
  if (parts.length === 0) return false;
  let freq: string | null = null;
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq <= 0) return false;
    const key = p.slice(0, eq).toUpperCase();
    const value = p.slice(eq + 1);
    if (value.length === 0) return false;
    if (key === 'FREQ') freq = value.toUpperCase();
  }
  if (freq === null) return false;
  return ['SECONDLY', 'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq);
}

/**
 * Approximate CSS color check. Covers the cases hosts actually use
 * (hex, named colors, rgb()/rgba()/hsl()/hsla()/oklch()/color())
 * without pulling in a full CSS parser. False positives are rare and
 * non-fatal — color is purely presentational.
 */
function looksLikeCssColor(s: string): boolean {
  const v = s.trim();
  if (v.length === 0) return false;
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
  if (/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(.+\)$/i.test(v)) return true;
  // Named colors — accept any plain ASCII identifier; the browser
  // does the final resolution.
  if (/^[a-z]+$/i.test(v)) return true;
  return false;
}
