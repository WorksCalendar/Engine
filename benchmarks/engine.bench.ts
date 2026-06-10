/**
 * Capacity benchmark for works-calendar-engine.
 *
 * Measures the two hot paths the engine actually spends time in:
 *   1. evaluateConflicts — one proposed event vs. N existing events
 *   2. expandRRule       — recurring-series fan-out into concrete dates
 *
 * The point is to answer "how much data can this process?" with measured
 * numbers on *your* hardware instead of estimates — and to give a baseline
 * to compare any future Rust/Wasm port against.
 *
 *   npx tsx benchmarks/engine.bench.ts
 *   npx tsx benchmarks/engine.bench.ts --json   # machine-readable output
 *
 * Pure TS, no engine internals touched — imports only the public source.
 */

import { evaluateConflicts, type ConflictEvent, type ConflictRule } from '../src/conflictEngine.js'
import { expandRRule } from '../src/engine/recurrence/expandRRule.js'
import { evaluateAvailability } from '../src/availability/evaluateAvailability.js'
import type { AvailabilityRule } from '../src/availability/availabilityRule.js'

// ─── Tiny timing helpers ──────────────────────────────────────────────────────

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

/** Run `fn` enough times to span ~`minMs`, return ns-per-op + ops/sec. */
function timeit(fn: () => void, opts: { warmupMs?: number; minMs?: number } = {}) {
  const warmupMs = opts.warmupMs ?? 150
  const minMs = opts.minMs ?? 600

  // Warmup so the JIT settles before we measure.
  let wEnd = now() + warmupMs
  while (now() < wEnd) fn()

  // Measure in batches, growing until we've spent at least minMs.
  let iters = 0
  const start = now()
  let elapsed = 0
  let batch = 1
  do {
    for (let i = 0; i < batch; i++) fn()
    iters += batch
    elapsed = now() - start
    batch = Math.min(batch * 2, 4096)
  } while (elapsed < minMs)

  const nsPerOp = (elapsed * 1e6) / iters
  return { iters, elapsedMs: elapsed, nsPerOp, opsPerSec: 1e9 / nsPerOp }
}

const fmt = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B`
  : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K`
  : n >= 1 ? n.toFixed(0)
  : n.toFixed(2)

const ms = (n: number): string =>
  n >= 60_000 ? `${(n / 60_000).toFixed(1)}min`
  : n >= 1000 ? `${(n / 1000).toFixed(2)}s`
  : n < 1 ? `${(n * 1000).toFixed(0)}µs`
  : `${n.toFixed(n < 10 ? 2 : 1)}ms`

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RESOURCES = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi']
const CATEGORIES = ['shift', 'on-call', 'meeting', 'maintenance']
const DAY = 86_400_000

/**
 * Build N events spread across `resourceCount` resources over a year.
 * Deterministic (seeded) so runs are comparable.
 */
function makeEvents(count: number, resourceCount: number): ConflictEvent[] {
  const base = Date.UTC(2026, 0, 1)
  const events: ConflictEvent[] = new Array(count)
  let seed = 0x9e3779b9
  const rand = () => {
    // xorshift — cheap, deterministic
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return ((seed >>> 0) / 0xffffffff)
  }
  for (let i = 0; i < count; i++) {
    const startMs = base + Math.floor(rand() * 365) * DAY + Math.floor(rand() * 16) * 3_600_000
    events[i] = {
      id: `evt-${i}`,
      start: new Date(startMs),
      end: new Date(startMs + (1 + Math.floor(rand() * 8)) * 3_600_000),
      resource: RESOURCES[i % resourceCount],
      category: CATEGORIES[i % CATEGORIES.length],
    }
  }
  return events
}

// Three pairwise rules — the realistic "is this booking legal?" rule set.
const RULES: ConflictRule[] = [
  { id: 'no-overlap', type: 'resource-overlap', severity: 'hard' },
  { id: 'mutex', type: 'category-mutex', severity: 'hard', categories: ['shift', 'on-call'] },
  { id: 'rest', type: 'min-rest', severity: 'soft', minutes: 660 },
]

// ─── Benchmark 1: evaluateConflicts ───────────────────────────────────────────

interface Row {
  label: string
  scale: number
  unit: string
  perCallMs: number
  callsPerSec: number
  itemsPerSec: number
}

function benchConflicts(): Row[] {
  const sizes = [100, 1_000, 10_000, 100_000]
  const resourceCount = RESOURCES.length
  const rows: Row[] = []

  for (const n of sizes) {
    const events = makeEvents(n, resourceCount)
    // Proposed event lands mid-year on a real resource so the bucket is non-empty.
    const proposed: ConflictEvent = {
      id: '',
      start: new Date(Date.UTC(2026, 5, 15, 9)),
      end: new Date(Date.UTC(2026, 5, 15, 17)),
      resource: 'alice',
      category: 'shift',
    }
    const r = timeit(() => {
      evaluateConflicts({ proposed, events, rules: RULES })
    })
    rows.push({
      label: `conflict check vs ${fmt(n)} events`,
      scale: n,
      unit: 'events',
      perCallMs: r.nsPerOp / 1e6,
      callsPerSec: r.opsPerSec,
      itemsPerSec: r.opsPerSec * n, // events scanned per second
    })
  }
  return rows
}

// ─── Benchmark 2: expandRRule fan-out ─────────────────────────────────────────

function benchRRule(): Row[] {
  const cases: { label: string; rrule: string; rangeDays: number }[] = [
    { label: 'DAILY × 1 year', rrule: 'FREQ=DAILY;COUNT=365', rangeDays: 366 },
    { label: 'WEEKLY MWF × 2 years', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=312', rangeDays: 730 },
    { label: 'HOURLY × 30 days', rrule: 'FREQ=HOURLY;COUNT=720', rangeDays: 31 },
  ]
  const dtstart = new Date(Date.UTC(2026, 0, 1, 9))
  const rows: Row[] = []

  for (const c of cases) {
    const rangeStart = dtstart
    const rangeEnd = new Date(dtstart.getTime() + c.rangeDays * DAY)
    // Measure produced-occurrence count once.
    const produced = expandRRule(dtstart, c.rrule, null, rangeStart, rangeEnd).length
    const r = timeit(() => {
      expandRRule(dtstart, c.rrule, null, rangeStart, rangeEnd)
    })
    rows.push({
      label: `${c.label} (${fmt(produced)} occ)`,
      scale: produced,
      unit: 'occurrences',
      perCallMs: r.nsPerOp / 1e6,
      callsPerSec: r.opsPerSec,
      itemsPerSec: r.opsPerSec * produced, // occurrences generated per second
    })
  }
  return rows
}

// ─── Benchmark 3: availability-matrix matching ────────────────────────────────

// A handful of IANA zones so the zone-aware evaluator exercises its real path
// (resources rarely all share UTC).
const ZONES = ['UTC', 'America/Denver', 'America/New_York', 'Europe/Berlin', 'Asia/Tokyo']

/** One resource's rule set: a weekday open window, a weekend window, one blackout. */
function makeResourceRules(i: number): { rules: AvailabilityRule[]; timezone: string } {
  return {
    timezone: ZONES[i % ZONES.length]!,
    rules: [
      { id: `open-wd-${i}`, kind: 'open', days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' },
      { id: `open-we-${i}`, kind: 'open', days: [6], start: '10:00', end: '14:00' },
      {
        id: `bo-${i}`,
        kind: 'blackout',
        start: new Date(Date.UTC(2026, 0, 8)).toISOString(),
        end: new Date(Date.UTC(2026, 0, 9)).toISOString(),
        reason: 'maintenance',
      },
    ],
  }
}

/**
 * Sweep an M-resource × T-slot availability matrix: for every (resource, slot)
 * cell, ask "is this resource open for this slot?". This is the multi-resource
 * matching workload — the one case where a Rust/Wasm SIMD bitset-intersection
 * port would meaningfully beat JS, so it gets the most attention here.
 */
function sweepMatrix(
  resources: { rules: AvailabilityRule[]; timezone: string }[],
  slots: { start: Date; end: Date }[],
): number {
  let open = 0
  for (const res of resources) {
    for (const slot of slots) {
      const r = evaluateAvailability({ window: slot, rules: res.rules, timezone: res.timezone })
      if (r.ok) open++
    }
  }
  return open
}

/**
 * Measure per-cell throughput on a modest real sweep, then *project* the large
 * target matrices from it.
 *
 * Why projected rather than literally swept: a single availability cell costs
 * ~0.5ms today because `partsInTimezone` builds a fresh `Intl.DateTimeFormat`
 * on every call (and `wallClockToUtc` invokes it several times). At that rate a
 * literal 4.3M-cell sweep runs for tens of minutes — impractical for a bench
 * that should finish in seconds. Measuring per-cell cost and multiplying is
 * both faster and more honest about where the time goes.
 */
function benchMatrix(): { rows: Row[]; cellsPerSec: number } {
  const slotMin = 30
  const slotMs = slotMin * 60_000
  const slotsPerDay = (24 * 60) / slotMin
  const base = Date.UTC(2026, 0, 5) // a Monday

  // Real measurement: a small mixed-zone sweep, sized to a stable sample.
  const sampleResources = 20
  const sampleDays = 3
  const resources = Array.from({ length: sampleResources }, (_, i) => makeResourceRules(i))
  const sampleSlots = Array.from({ length: sampleDays * slotsPerDay }, (_, s) => {
    const startMs = base + s * slotMs
    return { start: new Date(startMs), end: new Date(startMs + slotMs) }
  })
  const sampleCells = sampleResources * sampleSlots.length

  const r = timeit(() => { sweepMatrix(resources, sampleSlots) }, { warmupMs: 100, minMs: 500 })
  const cellsPerSec = (sampleCells * r.opsPerSec)

  // Projected target matrices.
  const targets = [
    { label: '50 res × 7d', resources: 50, days: 7 },
    { label: '200 res × 30d', resources: 200, days: 30 },
    { label: '500 res × 90d', resources: 500, days: 90 },
  ]
  const rows: Row[] = targets.map((t) => {
    const cells = t.resources * t.days * slotsPerDay
    const sweepMs = (cells / cellsPerSec) * 1000
    return {
      label: `${t.label} = ${fmt(cells)} cells`,
      scale: cells,
      unit: 'cells',
      perCallMs: sweepMs, // projected wall time for the full sweep
      callsPerSec: 1000 / sweepMs, // projected matrices/sec
      itemsPerSec: cellsPerSec, // measured, constant
    }
  })
  return { rows, cellsPerSec }
}

// ─── Output ───────────────────────────────────────────────────────────────────

function printTable(title: string, rows: Row[], callsHeader = 'calls/sec', perHeader = 'per call') {
  console.log(`\n${title}`)
  console.log('─'.repeat(title.length))
  const head = ['workload', perHeader, callsHeader, `${rows[0]?.unit}/sec`]
  const widths = [42, 12, 14, 14]
  const pad = (s: string, w: number) => s.length >= w ? s : s + ' '.repeat(w - s.length)
  console.log(head.map((h, i) => pad(h, widths[i]!)).join(''))
  for (const row of rows) {
    console.log(
      [
        pad(row.label, widths[0]!),
        pad(ms(row.perCallMs), widths[1]!),
        pad(fmt(row.callsPerSec), widths[2]!),
        pad(fmt(row.itemsPerSec), widths[3]!),
      ].join(''),
    )
  }
}

function main() {
  const json = process.argv.includes('--json')
  const t0 = now()
  const conflicts = benchConflicts()
  const rrule = benchRRule()
  const matrix = benchMatrix()
  const wallSec = (now() - t0) / 1000

  if (json) {
    console.log(JSON.stringify(
      { node: process.version, conflicts, rrule, matrix: matrix.rows, matrixCellsPerSec: matrix.cellsPerSec, wallSec },
      null, 2,
    ))
    return
  }

  console.log(`works-calendar-engine — capacity benchmark`)
  console.log(`node ${process.version} · ${new Date().toISOString()}`)
  printTable('1. evaluateConflicts (proposed event vs. existing events)', conflicts)
  printTable('2. expandRRule (recurring-series fan-out)', rrule)
  printTable('3. availability-matrix matching (M resources × T slots, projected)', matrix.rows, 'matrices/sec', 'sweep time')
  console.log(`\nbenchmark wall time: ${wallSec.toFixed(1)}s`)
  console.log(
    `\nNotes:\n` +
    `• #1/#2 columns are measured directly; #3 is measured per-cell, then the\n` +
    `  full matrices are projected (a literal multi-million-cell sweep runs for minutes).\n` +
    `• The matrix path is ~${fmt(matrix.cellsPerSec)} cells/sec — bottlenecked by a fresh\n` +
    `  Intl.DateTimeFormat built per availability check, NOT by arithmetic.\n` +
    `  A Rust/Wasm port (own tz tables, SIMD bitset intersection) is the large\n` +
    `  win here — but memoizing the JS formatter would also recover most of it.\n` +
    `• Use these as the baseline to compare any Rust/Wasm port against.`,
  )
}

main()
