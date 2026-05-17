# works-calendar-engine

Framework-agnostic scheduling state machine with rule-based conflict detection.

```ts
import { CalendarEngine, evaluateConflicts } from 'works-calendar-engine';

const result = evaluateConflicts({
  proposed: { id: 'shift-1', start: '2026-06-01T08:00', end: '2026-06-01T16:00', resource: 'alice' },
  events: existingShifts,
  rules: [{ id: 'no-overlap', type: 'resource-overlap', severity: 'hard' }],
});

if (!result.allowed) {
  console.log(result.violations); // → [{ rule, severity, message, ... }]
}
```

Pure TypeScript. Runs in Node, browsers, workers, edge. Only runtime dep is `date-fns`.

## Why this exists

Most calendar libraries draw pixels. None of them validate. FullCalendar renders.
React Big Calendar renders. Schedule-X renders. When you need to enforce
"no double-booking" or "minimum 11 hours of rest between shifts" or
"facility capacity = 6 docks," you write it yourself.

This is that piece, extracted.

## What it does

- **Conflict detection** — 8 built-in rule types (resource overlap, category
  mutex, min rest, capacity overflow, outside business hours, availability
  violation, hold conflict, policy violation). Add your own.
- **Schedule kinds** — domain model for shift, on-call, open shift, covering.
  Normalizes messy real-world category strings.
- **Recurrence** — RFC 5545 RRULE expansion (FREQ, INTERVAL, COUNT, UNTIL,
  BYDAY, BYMONTHDAY, BYMONTH, EXDATE).
- **State machine** — typed mutations, begin/commit/rollback transactions,
  pub/sub subscriptions, undo/redo with full snapshots.
- **Approvals** — pure-function state-machine reducer for the
  requested → approved → finalized → denied lifecycle, with a
  hash-chained audit log.
- **Resource pools** — query DSL for "all resources where role=driver and
  within 50mi of pickup."

## What it isn't

- Not a renderer. Bring your own UI (React, Vue, Svelte, vanilla — works
  with any).
- Not a backend. It's framework-agnostic logic; persist however you want.
- Not a workflow engine. Approval reducer is in scope; multi-step DAG
  automation isn't (separate concern).

## Install

```bash
npm install works-calendar-engine date-fns
```

`date-fns` is a peer dep (engine accepts `^3.6.0 || ^4.0.0`).

## Examples

- [`examples/react-basic`](./examples/react-basic) — month grid + conflict
  badges, ~50 lines of consumer code.
- [`examples/node-server`](./examples/node-server) — Express POST
  `/bookings` validates against the engine before writing to the DB.
- [`examples/fullcalendar-bridge`](./examples/fullcalendar-bridge) — drop
  the engine *underneath* FullCalendar. Intercept `eventChange`, run the
  diff through `evaluateConflicts`, reject on violation. You don't have
  to replace your calendar — just add intelligence underneath it.

## API surface

The full public surface lives in [`src/index.ts`](./src/index.ts). Highlights:

| Symbol | Purpose |
|---|---|
| `CalendarEngine` | State container with typed mutations + transactions |
| `EventBus` | Lifecycle pub/sub (`booking.requested`, `.approved`, ...) |
| `UndoRedoManager` | Full-snapshot undo/redo |
| `buildOperation.*` | Operation factories (`fromDragMove`, `fromFormSave`, ...) |
| `evaluateConflicts` | Run a candidate event through a rule set |
| `evaluateAvailability` | Check against availability windows |
| `evaluateRequirements` | "This shift needs 1 driver + 1 co-driver" |
| `resolvePool` | Expand a virtual pool to concrete resource IDs |
| `findBlockingHold` | Pre-booking hold checks |
| `expandOccurrences` / `expandRRule` | RRULE → concrete dates |
| `transitionApproval` / `appendAuditEntry` | Approval state machine + audit |
| `normalizeEvent` | Loose `WorksCalendarEvent` → strict `EngineEvent` |

## Status

`0.1.0` — initial public release. API is stable enough to build against,
but minor versions may iterate on shape until `1.0`. See
[CHANGELOG.md](./CHANGELOG.md).

## License

MIT
