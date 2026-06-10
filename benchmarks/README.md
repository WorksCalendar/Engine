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

Each case warms up the JIT, then runs in growing batches until it has spent
enough wall time to give a stable per-op figure.

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
| Conflict check | ~9M events/sec | 10K-event calendar validates in ~1ms; 100K in ~15ms |
| RRULE expansion | ~0.8–1M occurrences/sec | a year of daily events in well under 1ms |

**Implication for a Rust/Wasm port:** conflict detection is already
memory-bandwidth/linear-scan bound and effectively instant for any realistic
embedded calendar — a Wasm rewrite buys little there once you account for the
JS↔Wasm marshalling cost. The RRULE path is comparatively string-parse bound
and is the more defensible candidate to offload, alongside large
availability-matrix matching (not yet covered here).
