# Benchmarks

Capacity benchmark for the engine's two hot paths. Answers "how much data can
this process?" with measured numbers on your hardware — and gives a baseline to
compare any future Rust/Wasm port against.

```bash
npm run bench           # human-readable tables
npm run bench -- --json # machine-readable
```

## What it measures

1. **`evaluateConflicts`** — one proposed event validated against a calendar of
   100 / 1K / 10K / 100K existing events, using a realistic 3-rule set
   (`resource-overlap` + `category-mutex` + `min-rest`).
2. **`expandRRule`** — recurring-series fan-out into concrete dates
   (daily, weekly-BYDAY, hourly).
3. **availability-matrix matching** — sweep an M-resource × T-slot grid via
   `evaluateAvailability`, the multi-resource "find common free slots"
   workload. Per-cell cost is measured on a small mixed-timezone sweep, then
   the large target matrices are *projected* (a literal multi-million-cell
   sweep runs for minutes — see below).

Each measured case warms up the JIT, then runs in growing batches until it has
spent enough wall time to give a stable per-op figure.

## How to read it

- **calls/sec** is what a host page actually experiences per booking
  validation — the number that matters for UX.
- **events/sec** is raw scan throughput. It stays roughly flat across calendar
  sizes, which confirms conflict evaluation is `O(events)` (a same-resource
  bucket filter), not `O(events²)`.

## Indicative results (Node 22, single core)

Numbers vary by machine; treat the *shape* as the takeaway.

| Path | Throughput | Feel |
|---|---|---|
| Conflict check | ~9–11M events/sec | 10K-event calendar validates in ~1ms; 100K in ~9ms |
| RRULE expansion | ~0.9–1.1M occurrences/sec | a year of daily events in well under 1ms |
| Availability matrix | **~2K cells/sec** | a 2.16M-cell sweep would take **~17 min** |

## The availability-matrix finding

The matrix path is ~3–4 orders of magnitude slower per item than the other
two — but **not because the math is slow.** `partsInTimezone`
(`src/engine/time/timezone.ts`) constructs a fresh `Intl.DateTimeFormat` on
every call, and `wallClockToUtc` invokes it several times per availability
check. Formatter construction — not arithmetic — dominates, costing ~0.5ms per
cell.

This reframes the "should we port to Rust/Wasm?" question:

- **Conflict detection** is already linear-scan bound and effectively instant
  for any realistic embedded calendar — a Wasm rewrite buys little there once
  you account for JS↔Wasm marshalling.
- **RRULE expansion** is comparatively string-parse bound — a more defensible
  offload candidate.
- **Availability matrix** is the one workload with a large headroom, and a
  Rust/Wasm port (its own timezone tables + SIMD bitset intersection) would
  win big. *But* memoizing the `Intl.DateTimeFormat` per `(timezone)` in plain
  JS would recover most of that headroom for a fraction of the effort — worth
  trying first.
