/**
 * holdRegistry — unit specs (issue #211).
 *
 * Short-lived soft locks on (resource, window). Pins acquire/release
 * semantics, TTL expiry, same-holder refresh, and the
 * `findBlockingHold` helper the conflict rule dispatches into.
 */
import { describe, it, expect } from 'vitest'
import {
  createHoldRegistry,
  findBlockingHold,
  type Hold,
} from '../holdRegistry.js'

const T0 = new Date('2026-04-20T09:00:00.000Z')
const ms = (iso: string) => new Date(iso).getTime()

function mkClock(start: Date): { now: () => Date; advance: (deltaMs: number) => void } {
  let t = start.getTime()
  return {
    now: () => new Date(t),
    advance: (delta: number) => { t += delta },
  }
}

describe('createHoldRegistry — acquire + release', () => {
  it('acquires a hold with a default 5-min TTL', () => {
    const clock = mkClock(T0)
    const reg = createHoldRegistry({ now: clock.now })
    const result = reg.acquire({
      resourceId: 'room-a',
      window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
      holderId: 'alice',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.hold.expiresAt).toBe('2026-04-20T09:05:00.000Z')
    expect(reg.size).toBe(1)
  })

  it('respects a custom ttlMs', () => {
    const clock = mkClock(T0)
    const reg = createHoldRegistry({ now: clock.now })
    const result = reg.acquire({
      resourceId: 'room-a',
      window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
      holderId: 'alice',
      ttlMs: 60_000,
    })
    expect(result.ok && result.hold.expiresAt).toBe('2026-04-20T09:01:00.000Z')
  })

  it('release() drops the hold and is idempotent on unknown ids', () => {
    const reg = createHoldRegistry({ now: () => T0 })
    const r = reg.acquire({
      resourceId: 'r', holderId: 'a',
      window: { start: T0, end: new Date(T0.getTime() + 60_000) },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    reg.release(r.hold.id)
    expect(reg.size).toBe(0)
    expect(() => reg.release('nope')).not.toThrow()
  })

  it('rejects windows where end <= start', () => {
    const reg = createHoldRegistry({ now: () => T0 })
    const result = reg.acquire({
      resourceId: 'r', holderId: 'a',
      window: { start: T0, end: T0 },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_WINDOW' } })
  })
})

describe('createHoldRegistry — conflict detection across holders', () => {
  it('rejects a second holder acquiring an overlapping window', () => {
    const reg = createHoldRegistry({ now: () => T0 })
    reg.acquire({
      resourceId: 'r', holderId: 'alice',
      window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
    })
    const second = reg.acquire({
      resourceId: 'r', holderId: 'bob',
      window: { start: '2026-04-20T10:30:00.000Z', end: '2026-04-20T11:30:00.000Z' },
    })
    expect(second).toMatchObject({ ok: false, error: { code: 'CONFLICTING_HOLD' } })
  })

  it('allows a second holder on a non-overlapping window', () => {
    const reg = createHoldRegistry({ now: () => T0 })
    reg.acquire({
      resourceId: 'r', holderId: 'alice',
      window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
    })
    const second = reg.acquire({
      resourceId: 'r', holderId: 'bob',
      window: { start: '2026-04-20T11:00:00.000Z', end: '2026-04-20T12:00:00.000Z' },
    })
    expect(second.ok).toBe(true)
  })

  it('allows the same window to be held on a different resource', () => {
    const reg = createHoldRegistry({ now: () => T0 })
    reg.acquire({
      resourceId: 'room-a', holderId: 'alice',
      window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
    })
    const second = reg.acquire({
      resourceId: 'room-b', holderId: 'bob',
      window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
    })
    expect(second.ok).toBe(true)
  })

  it('treats half-open overlap correctly (touching endpoints are NOT a conflict)', () => {
    const reg = createHoldRegistry({ now: () => T0 })
    reg.acquire({
      resourceId: 'r', holderId: 'alice',
      window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
    })
    const second = reg.acquire({
      resourceId: 'r', holderId: 'bob',
      window: { start: '2026-04-20T11:00:00.000Z', end: '2026-04-20T12:00:00.000Z' },
    })
    expect(second.ok).toBe(true)
  })
})

describe('createHoldRegistry — same-holder re-acquire', () => {
  it('replaces the existing hold when the same holder re-acquires on an overlapping window', () => {
    const clock = mkClock(T0)
    const reg = createHoldRegistry({ now: clock.now })
    const first = reg.acquire({
      resourceId: 'r', holderId: 'alice',
      window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
    })
    expect(first.ok).toBe(true)
    clock.advance(60_000)
    const second = reg.acquire({
      resourceId: 'r', holderId: 'alice',
      window: { start: '2026-04-20T10:30:00.000Z', end: '2026-04-20T11:30:00.000Z' },
    })
    expect(second.ok).toBe(true)
    expect(reg.size).toBe(1)
    if (!second.ok) return
    // New expiry is relative to the advanced clock, not the original acquire time.
    expect(ms(second.hold.expiresAt)).toBe(ms('2026-04-20T09:01:00.000Z') + 5 * 60_000)
  })
})

describe('createHoldRegistry — TTL expiry + prune', () => {
  it('active() excludes expired holds without mutating the registry', () => {
    const clock = mkClock(T0)
    const reg = createHoldRegistry({ now: clock.now })
    reg.acquire({
      resourceId: 'r', holderId: 'a',
      window: { start: T0, end: new Date(T0.getTime() + 60_000) },
      ttlMs: 30_000,
    })
    expect(reg.active()).toHaveLength(1)
    clock.advance(60_000)
    expect(reg.active()).toHaveLength(0)
    expect(reg.size).toBe(1) // not pruned, just hidden
  })

  it('allows a new holder to re-acquire once the old hold expires', () => {
    const clock = mkClock(T0)
    const reg = createHoldRegistry({ now: clock.now })
    reg.acquire({
      resourceId: 'r', holderId: 'alice',
      window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
      ttlMs: 30_000,
    })
    clock.advance(60_000)
    const second = reg.acquire({
      resourceId: 'r', holderId: 'bob',
      window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
    })
    expect(second.ok).toBe(true)
  })

  it('prune() drops expired holds and returns the count', () => {
    const clock = mkClock(T0)
    const reg = createHoldRegistry({ now: clock.now })
    reg.acquire({
      resourceId: 'r', holderId: 'a',
      window: { start: T0, end: new Date(T0.getTime() + 60_000) },
      ttlMs: 30_000,
    })
    reg.acquire({
      resourceId: 'r2', holderId: 'b',
      window: { start: T0, end: new Date(T0.getTime() + 60_000) },
      ttlMs: 5 * 60_000,
    })
    clock.advance(60_000)
    expect(reg.prune()).toBe(1)
    expect(reg.size).toBe(1)
  })
})

describe('findBlockingHold', () => {
  const base: Hold = {
    id: 'h1', resourceId: 'r', holderId: 'alice',
    window: { start: '2026-04-20T10:00:00.000Z', end: '2026-04-20T11:00:00.000Z' },
    expiresAt: '2026-04-20T09:10:00.000Z',
  }
  const nowMs = ms('2026-04-20T09:00:00.000Z')

  it('returns null when the proposed event has no resource', () => {
    const result = findBlockingHold(
      { resourceId: null, holderId: 'bob', window: base.window },
      [base], nowMs,
    )
    expect(result).toBeNull()
  })

  it('returns the overlapping hold from a different holder', () => {
    const result = findBlockingHold(
      { resourceId: 'r', holderId: 'bob', window: base.window },
      [base], nowMs,
    )
    expect(result?.id).toBe('h1')
  })

  it('ignores the proposer\'s own hold', () => {
    const result = findBlockingHold(
      { resourceId: 'r', holderId: 'alice', window: base.window },
      [base], nowMs,
    )
    expect(result).toBeNull()
  })

  it('ignores expired holds', () => {
    const result = findBlockingHold(
      { resourceId: 'r', holderId: 'bob', window: base.window },
      [base],
      ms('2026-04-20T09:20:00.000Z'),
    )
    expect(result).toBeNull()
  })

  it('ignores holds on a different resource', () => {
    const result = findBlockingHold(
      { resourceId: 'other', holderId: 'bob', window: base.window },
      [base], nowMs,
    )
    expect(result).toBeNull()
  })
})
