/**
 * Event types at the engine boundary.
 *
 * `WorksCalendarEvent` is the loose, host-facing shape used by consumers.
 * `NormalizedEvent` is the engine-internal shape with guaranteed fields.
 * `normalizeEvent` (in ../eventModel.ts) bridges the two.
 */

import type { EventVisualPriority } from './view.js';
import { isVisualPriority } from './view.js';

export type { EventVisualPriority };
export { isVisualPriority };

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';

export type EventLifecycleState =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'scheduled'
  | 'completed';

export const EVENT_LIFECYCLE_STATES: readonly EventLifecycleState[] = [
  'draft',
  'pending',
  'approved',
  'scheduled',
  'completed',
];

export function isLifecycleState(v: unknown): v is EventLifecycleState {
  return typeof v === 'string'
    && (EVENT_LIFECYCLE_STATES as readonly string[]).includes(v);
}

export interface EventComment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export interface ReminderDef {
  minutesBefore: number;
  method: 'browser' | 'callback';
}

export interface WorksCalendarEvent {
  id?: string | undefined;
  title: string;
  start: Date | string;
  end?: Date | string | undefined;
  allDay?: boolean | undefined;
  comments?: EventComment[] | undefined;
  reminders?: ReminderDef[] | undefined;
  category?: string | undefined;
  color?: string | undefined;
  resource?: string | undefined;
  status?: EventStatus | undefined;
  lifecycle?: EventLifecycleState | undefined;
  visualPriority?: EventVisualPriority | undefined;
  meta?: Record<string, unknown> | undefined;
  rrule?: string | undefined;
  exdates?: Array<Date | string> | undefined;
}

export interface NormalizedEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  category: string | null;
  color: string;
  resource: string | null;
  status: EventStatus;
  lifecycle: EventLifecycleState | null;
  visualPriority?: EventVisualPriority | null | undefined;
  meta: Record<string, unknown>;
  reminders: ReminderDef[];
  rrule: string | null;
  exdates: Array<Date | string>;
  _raw: WorksCalendarEvent;
  _recurring?: boolean | undefined;
  _eventId?: string | undefined;
  _seriesId?: string | undefined;
  _feedLabel?: string | undefined;
  _col?: number | undefined;
  _numCols?: number | undefined;
}
