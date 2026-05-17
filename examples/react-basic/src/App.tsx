/**
 * react-basic — month grid + conflict badges.
 *
 * ~50 lines of consumer code. Renders 7×N day cells, drops each event in
 * its day, and asks the engine which events conflict on the same resource.
 * A red ring on the day = at least one conflict that day.
 */
import { useMemo } from 'react';
import { addDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay, format } from 'date-fns';
import { evaluateConflicts, type ConflictEvent, type ConflictRule } from 'works-calendar-engine';

const EVENTS: ConflictEvent[] = [
  { id: 'a', start: new Date(2026, 5, 3, 9, 0),  end: new Date(2026, 5, 3, 17, 0), resource: 'alice' },
  { id: 'b', start: new Date(2026, 5, 3, 14, 0), end: new Date(2026, 5, 3, 18, 0), resource: 'alice' }, // overlaps a
  { id: 'c', start: new Date(2026, 5, 5, 8, 0),  end: new Date(2026, 5, 5, 16, 0), resource: 'bob' },
  { id: 'd', start: new Date(2026, 5, 12, 9, 0), end: new Date(2026, 5, 12, 17, 0), resource: 'alice' },
];

const RULES: ConflictRule[] = [
  { id: 'no-overlap', type: 'resource-overlap', severity: 'hard' },
];

function eventHasConflict(ev: ConflictEvent): boolean {
  const r = evaluateConflicts({ proposed: ev, events: EVENTS, rules: RULES });
  return !r.allowed;
}

export default function App() {
  const month = new Date(2026, 5, 1);
  const days = useMemo(() => {
    const from = startOfWeek(startOfMonth(month));
    const to = endOfWeek(endOfMonth(month));
    const out: Date[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1>{format(month, 'MMMM yyyy')}</h1>
      <p>Red ring = day has at least one rule violation.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {['S','M','T','W','T','F','S'].map((d) => <div key={d} style={{ textAlign: 'center', fontWeight: 600 }}>{d}</div>)}
        {days.map((day) => {
          const evs = EVENTS.filter((e) => isSameDay(e.start as Date, day));
          const conflicted = evs.some(eventHasConflict);
          return (
            <div
              key={day.toISOString()}
              style={{
                minHeight: 80,
                padding: 4,
                border: conflicted ? '2px solid #c0392b' : '1px solid #ddd',
                borderRadius: 4,
                background: day.getMonth() === month.getMonth() ? 'white' : '#f5f5f5',
              }}
            >
              <div style={{ fontSize: 12, color: '#666' }}>{format(day, 'd')}</div>
              {evs.map((e) => (
                <div key={e.id} style={{ fontSize: 11, padding: 2, marginTop: 2, background: '#eef', borderRadius: 2 }}>
                  {e.resource}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </main>
  );
}
