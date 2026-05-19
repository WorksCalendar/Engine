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

## Date input shape

`start` and `end` accept either a `Date` instance or an ISO-8601 string
(`'2026-06-01T08:00'`, with or without a timezone offset). Strings without
an offset are interpreted as local wall-clock time, then normalized to a
`Date` internally. If you want predictable cross-timezone behavior, pass
either a UTC `Date` or an ISO string with an explicit offset.

## Security & embeddability

This package is designed to run inside third-party pages, sandboxed
iframes, web workers, and edge runtimes. It commits to the following:

- **No `eval`, no `new Function()`, no dynamic code generation.** Safe
  under a strict Content Security Policy that omits `unsafe-eval` and
  `unsafe-inline`.
- **No DOM access.** The engine doesn't touch `window`, `document`,
  `localStorage`, or any browser-only global. It runs identically in
  Node, browser main thread, web workers, service workers, Cloudflare
  Workers, and Vercel Edge.
- **No network calls.** No `fetch`, no `XMLHttpRequest`, no telemetry,
  no remote configuration. The only I/O is whatever you wire into the
  `onError` hook on `EventBus` / `CalendarEngine`.
- **No prototype pollution surface.** Inputs are validated against
  schemas before mutation; the engine never assigns into
  `Object.prototype` or accepts `__proto__` as a key.
- **Crypto uses Web Crypto (`globalThis.crypto`) only.** `createId`
  prefers `crypto.randomUUID()` and falls back to `getRandomValues()`;
  it throws rather than silently using `Math.random()` if neither is
  available. The audit-chain `sha256Hex` is a pure synchronous JS
  implementation — no Node `crypto` import.
- **No runtime dependencies except `date-fns`** (peer dep,
  `^3.6.0 || ^4.0.0`). `date-fns` itself has no transitive runtime
  deps.
- **`sideEffects: false`** — bundlers tree-shake the engine down to
  only the symbols you actually import.
- **Ships ESM + CJS + sourcemaps.** Works under Vite, Webpack 5,
  Rollup, esbuild, Parcel, and bare Node (`import` or `require`).

If you're embedding via `<script type="module">` directly from a CDN,
`esm.sh/works-calendar-engine` is the supported path:

```html
<script type="module">
  import { evaluateConflicts } from 'https://esm.sh/works-calendar-engine';
  // ...
</script>
```

## Status

`0.1.x` — public API surface (191 exports) is stable enough to build
against. Minor versions may add exports; breaking changes to existing
exports will bump to `0.2.0` and be listed in the CHANGELOG. The path
to `1.0.0` is feature completeness on the recurrence subset (full
RFC 5545 `BYHOUR`/`BYMINUTE`/`BYSETPOS`) and a frozen public surface.
See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT
