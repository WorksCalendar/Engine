/**
 * Canonical schedule model helpers.
 *
 * Normalized kinds:
 * - shift
 * - on-call
 * - open-shift
 * - covering
 */

export const SCHEDULE_KINDS = Object.freeze({
  SHIFT: 'shift',
  ON_CALL: 'on-call',
  OPEN_SHIFT: 'open-shift',
  COVERING: 'covering',
});

const KIND_ALIASES: Record<string, string> = Object.freeze({
  oncall: SCHEDULE_KINDS.ON_CALL,
  'on_call': SCHEDULE_KINDS.ON_CALL,
  openshift: SCHEDULE_KINDS.OPEN_SHIFT,
  'open_shift': SCHEDULE_KINDS.OPEN_SHIFT,
  'covering-shift': SCHEDULE_KINDS.COVERING,
});

type ScheduleEventLike = {
  kind?: unknown;
  category?: unknown;
  meta?: {
    kind?: unknown;
    onCall?: unknown;
    coveredBy?: unknown;
    status?: unknown;
    shiftStatus?: unknown;
  };
} | null | undefined;

export function normalizeScheduleKind(rawKind: unknown): string {
  const normalized = String(rawKind ?? '').trim().toLowerCase();
  if (!normalized) return '';
  return KIND_ALIASES[normalized] ?? normalized;
}

export function isOpenShiftEvent(ev: ScheduleEventLike): boolean {
  const kind = normalizeScheduleKind(ev?.meta?.kind ?? ev?.kind);
  const category = String(ev?.category ?? '').toLowerCase();
  return kind === SCHEDULE_KINDS.OPEN_SHIFT || category === SCHEDULE_KINDS.OPEN_SHIFT;
}

export function isCoveringEvent(ev: ScheduleEventLike): boolean {
  const kind = normalizeScheduleKind(ev?.meta?.kind ?? ev?.kind);
  return kind === SCHEDULE_KINDS.COVERING;
}

export function isShiftOrOnCallEvent(ev: ScheduleEventLike, onCallCategory: string = 'on-call'): boolean {
  const kind = normalizeScheduleKind(ev?.meta?.kind ?? ev?.kind);
  const category = String(ev?.category ?? '').toLowerCase();
  return kind === SCHEDULE_KINDS.SHIFT
    || kind === SCHEDULE_KINDS.ON_CALL
    || ev?.meta?.onCall === true
    || category === String(onCallCategory).toLowerCase();
}

export function isCoveredShift(ev: ScheduleEventLike): boolean {
  return !!ev?.meta?.coveredBy
    || ev?.meta?.status === 'covered'
    || ev?.meta?.shiftStatus === 'covered';
}

export const SCHEDULE_WORKFLOW_CATEGORIES = Object.freeze(new Set([
  'shift', 'on-call', 'open-shift', 'covering', 'base',
  'pto', 'PTO', 'availability', 'Availability', 'unavailable', 'Unavailable',
]));

const SCHEDULE_WORKFLOW_KINDS = new Set<string>([
  SCHEDULE_KINDS.SHIFT, SCHEDULE_KINDS.ON_CALL,
  SCHEDULE_KINDS.OPEN_SHIFT, SCHEDULE_KINDS.COVERING,
]);

export function isScheduleWorkflowEvent(ev: ScheduleEventLike): boolean {
  if (!ev) return false;
  const kind = normalizeScheduleKind(ev?.meta?.kind ?? ev?.kind);
  if (kind && SCHEDULE_WORKFLOW_KINDS.has(kind)) return true;
  if (ev?.meta?.onCall === true) return true;
  const cat = String(ev?.category ?? '');
  return SCHEDULE_WORKFLOW_CATEGORIES.has(cat)
      || SCHEDULE_WORKFLOW_CATEGORIES.has(cat.toLowerCase());
}

export const SCHEDULE_TAB_CATEGORY_SEEDS = Object.freeze([
  'base', 'on-call', 'shift', 'PTO', 'availability',
]);
