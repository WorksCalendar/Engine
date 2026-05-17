# node-server

Express POST `/bookings` that calls `evaluateConflicts` before writing.
Engine runs server-side — no DOM, no React, no peer chain.

## Run

```bash
# from the engine package root:
npm install && npm run build
cd examples/node-server
npm install
npm start
```

```bash
# Try one that conflicts with the seeded booking:
curl -i -X POST http://localhost:3000/bookings \
  -H 'content-type: application/json' \
  -d '{"id":"x","start":"2026-06-01T09:00","end":"2026-06-01T17:00","resource":"alice"}'
# → 409 with engine violations in the body

# And one that doesn't:
curl -i -X POST http://localhost:3000/bookings \
  -H 'content-type: application/json' \
  -d '{"id":"y","start":"2026-06-02T09:00","end":"2026-06-02T17:00","resource":"alice"}'
# → 201
```
