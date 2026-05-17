/**
 * node-server — Express POST /bookings that validates against the engine
 * before writing to the DB.
 *
 * The point: the engine doesn't need a browser, a calendar UI, or any of
 * the rest. You can put it behind your API and reject bad bookings at
 * the boundary.
 *
 * Run:
 *   npm install
 *   npm start
 *
 *   # then in another shell:
 *   curl -X POST http://localhost:3000/bookings \
 *     -H 'content-type: application/json' \
 *     -d '{"id":"x","start":"2026-06-01T09:00","end":"2026-06-01T17:00","resource":"alice"}'
 */
import express from 'express';
import {
  evaluateConflicts,
  type ConflictEvent,
  type ConflictRule,
} from 'works-calendar-engine';

const RULES: ConflictRule[] = [
  { id: 'no-overlap', type: 'resource-overlap', severity: 'hard' },
];

// Stand-in for a real DB. In a real app this is a Postgres / Supabase /
// whatever query that returns the relevant existing bookings.
const bookings: ConflictEvent[] = [
  { id: 'seed-1', start: '2026-06-01T08:00', end: '2026-06-01T12:00', resource: 'alice' },
];

const app = express();
app.use(express.json());

app.get('/bookings', (_req, res) => {
  res.json(bookings);
});

app.post('/bookings', (req, res) => {
  const proposed = req.body as ConflictEvent;

  if (!proposed.id || !proposed.start || !proposed.end) {
    return res.status(400).json({ error: 'id, start, end required' });
  }

  const result = evaluateConflicts({
    proposed,
    events: bookings,
    rules: RULES,
  });

  if (!result.allowed) {
    return res.status(409).json({
      error: 'booking rejected',
      violations: result.violations,
    });
  }

  bookings.push(proposed);
  res.status(201).json(proposed);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`booking validator listening on :${port}`);
});
