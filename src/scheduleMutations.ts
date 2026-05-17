import { isCoveringEvent, isOpenShiftEvent } from './scheduleModel.js';

type MutableMeta = Record<string, unknown>;

type ShiftEventLike = {
  id?: string;
  // `| undefined` so NormalizedEvent (whose `_eventId?: string | undefined`) assigns under exactOptionalPropertyTypes.
  _eventId?: string | undefined;
  title?: string;
  start?: unknown;
  end?: unknown;
  resource?: unknown;
  employeeId?: unknown;
  meta?: MutableMeta;
  category?: unknown;
  kind?: unknown;
} | null | undefined;

type ShiftEventRecord = Exclude<ShiftEventLike, null | undefined>;

export function resolveEventId(ev: ShiftEventLike): string {
  return String(ev?._eventId ?? ev?.id ?? '');
}

export function findLinkedOpenShifts(events: ShiftEventLike[], shiftEvent: ShiftEventLike): ShiftEventRecord[] {
  const shiftId = resolveEventId(shiftEvent);
  if (!shiftId) return [];
  return events.filter((candidate): candidate is ShiftEventRecord => {
    if (!candidate) return false;
    if (!isOpenShiftEvent(candidate)) return false;
    const candidateId = resolveEventId(candidate);
    const linkedById = Boolean(shiftEvent?.meta?.['openShiftId'])
      && candidateId === String(shiftEvent?.meta?.['openShiftId']);
    const linkedBySource = String(candidate?.meta?.['sourceShiftId'] ?? '') === shiftId;
    return linkedById || linkedBySource;
  });
}

export function findLinkedMirroredCoverage(events: ShiftEventLike[], shiftEvent: ShiftEventLike): ShiftEventRecord[] {
  const shiftId = resolveEventId(shiftEvent);
  if (!shiftId) return [];
  return events.filter(
    (candidate): candidate is ShiftEventRecord => Boolean(candidate)
      && isCoveringEvent(candidate)
      && String(candidate?.meta?.['sourceShiftId'] ?? '') === shiftId,
  );
}

export function buildShiftStatusMeta(
  shiftEvent: ShiftEventLike,
  { status, openShiftId }: { status?: unknown; openShiftId?: unknown },
): MutableMeta {
  const nextMeta: MutableMeta = { ...(shiftEvent?.meta ?? {}) };
  if (status) {
    nextMeta['shiftStatus'] = status;
    if (openShiftId) nextMeta['openShiftId'] = String(openShiftId);
  } else {
    delete nextMeta['shiftStatus'];
    delete nextMeta['coveredBy'];
    delete nextMeta['openShiftId'];
  }
  return nextMeta;
}

export function buildCoverageMeta(
  shiftEvent: ShiftEventLike,
  coveringEmployeeId: unknown,
  openShiftId: unknown,
): MutableMeta {
  return {
    ...(shiftEvent?.meta ?? {}),
    coveredBy: String(coveringEmployeeId),
    openShiftId: openShiftId ? String(openShiftId) : shiftEvent?.meta?.['openShiftId'],
  };
}

export function buildOpenShiftPatch(
  existingOpenShift: ShiftEventLike,
  shiftEvent: ShiftEventLike,
  reason: string,
): {
  title: string;
  start: Date;
  end: Date;
  resource: null;
  meta: MutableMeta;
} {
  const shiftId = resolveEventId(shiftEvent);
  return {
    title: `Open: ${shiftEvent?.title ?? 'Shift'}`,
    start: shiftEvent?.start instanceof Date ? shiftEvent.start : new Date(shiftEvent?.start as string | number),
    end: shiftEvent?.end instanceof Date ? shiftEvent.end : new Date(shiftEvent?.end as string | number),
    resource: null,
    meta: {
      ...(existingOpenShift?.meta ?? {}),
      kind: 'open-shift',
      sourceShiftId: shiftId,
      originalEmployeeId: String(shiftEvent?.resource ?? shiftEvent?.employeeId ?? ''),
      reason,
      coveredBy: null,
      status: 'open',
    },
  };
}
