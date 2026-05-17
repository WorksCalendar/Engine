/**
 * fullcalendar-bridge — drop the engine UNDERNEATH a FullCalendar UI.
 *
 * FullCalendar handles all rendering, drag, drop, resize, navigation —
 * the parts it does well. The engine handles the "is this move allowed?"
 * decision. We intercept eventDrop / eventResize, ask
 * evaluateConflicts, and roll the change back if a rule fires.
 *
 * The pitch: "you don't have to replace your calendar — just add
 * intelligence underneath it."
 */
import { useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventDropArg, EventResizeDoneArg } from '@fullcalendar/core';
import {
  evaluateConflicts,
  type ConflictEvent,
  type ConflictRule,
} from 'works-calendar-engine';

const INITIAL_EVENTS = [
  { id: 'a', title: 'Alice — morning', start: '2026-06-01T08:00', end: '2026-06-01T12:00', resourceId: 'alice', extendedProps: { resource: 'alice' } },
  { id: 'b', title: 'Alice — afternoon', start: '2026-06-01T14:00', end: '2026-06-01T18:00', resourceId: 'alice', extendedProps: { resource: 'alice' } },
  { id: 'c', title: 'Bob — all day', start: '2026-06-02T09:00', end: '2026-06-02T17:00', resourceId: 'bob', extendedProps: { resource: 'bob' } },
];

const RULES: ConflictRule[] = [
  { id: 'no-overlap', type: 'resource-overlap', severity: 'hard' },
];

type FCEvent = (typeof INITIAL_EVENTS)[number];

function toConflictEvent(e: FCEvent): ConflictEvent {
  return {
    id: e.id,
    start: new Date(e.start),
    end: new Date(e.end),
    resource: e.extendedProps.resource,
  };
}

export default function App() {
  const calRef = useRef<FullCalendar>(null);
  const [events, setEvents] = useState<FCEvent[]>(INITIAL_EVENTS);
  const [lastRejection, setLastRejection] = useState<string | null>(null);

  function gateChange(eventId: string, newStart: Date, newEnd: Date): boolean {
    const others = events.filter((e) => e.id !== eventId).map(toConflictEvent);
    const target = events.find((e) => e.id === eventId)!;
    const proposed: ConflictEvent = {
      id: eventId,
      start: newStart,
      end: newEnd,
      resource: target.extendedProps.resource,
    };
    const result = evaluateConflicts({ proposed, events: others, rules: RULES });
    if (!result.allowed) {
      setLastRejection(result.violations.map((v) => v.message).join('; '));
      return false;
    }
    setLastRejection(null);
    return true;
  }

  function commit(eventId: string, newStart: Date, newEnd: Date) {
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, start: newStart.toISOString(), end: newEnd.toISOString() } : e)),
    );
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1>FullCalendar + works-calendar-engine</h1>
      <p>Drag any event so it overlaps another on the same resource — the engine vetoes the change.</p>
      {lastRejection && (
        <div style={{ padding: 8, marginBottom: 12, background: '#fee', border: '1px solid #c0392b', borderRadius: 4, color: '#c0392b' }}>
          ⛔ {lastRejection}
        </div>
      )}
      <FullCalendar
        ref={calRef}
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        initialDate="2026-06-01"
        editable
        events={events}
        eventDrop={(arg: EventDropArg) => {
          const ok = gateChange(arg.event.id, arg.event.start!, arg.event.end!);
          if (!ok) arg.revert();
          else commit(arg.event.id, arg.event.start!, arg.event.end!);
        }}
        eventResize={(arg: EventResizeDoneArg) => {
          const ok = gateChange(arg.event.id, arg.event.start!, arg.event.end!);
          if (!ok) arg.revert();
          else commit(arg.event.id, arg.event.start!, arg.event.end!);
        }}
        height={600}
      />
    </main>
  );
}
