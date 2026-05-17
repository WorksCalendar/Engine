/**
 * EventBus unit specs — issue #216.
 *
 * Pins the pub-sub contract independent of CalendarEngine so hosts using
 * the bus for their own pipelines have a stable API guarantee.
 */
import { describe, it, expect, vi } from 'vitest'
import { EventBus, channelForApprovalTransition } from '../eventBus.js'
import type {
  BookingLifecyclePayload,
  AssignmentLifecyclePayload,
} from '../eventBus.js'

const makeBooking = (over: Partial<BookingLifecyclePayload> = {}): BookingLifecyclePayload => ({
  eventId: 'ev-1',
  eventSnapshot: null,
  at: '2026-04-20T10:00:00.000Z',
  ...over,
})

const makeAssignment = (over: Partial<AssignmentLifecyclePayload> = {}): AssignmentLifecyclePayload => ({
  assignment: { id: 'a-1', eventId: 'ev-1', resourceId: 'r-1', units: 50 },
  at: '2026-04-20T10:00:00.000Z',
  ...over,
})

// Small helper: drain microtasks so queueMicrotask dispatches settle.
const flushMicrotasks = () => Promise.resolve()

describe('EventBus — subscribe + emit basics', () => {
  it('routes a payload to a subscribed channel handler', async () => {
    const bus = new EventBus()
    const handler = vi.fn()
    bus.subscribe('booking.requested', handler)
    bus.emit('booking.requested', makeBooking({ eventId: 'a' }))
    expect(handler).not.toHaveBeenCalled() // async
    await flushMicrotasks()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]!).toMatchObject({ eventId: 'a' })
  })

  it('does not cross channels', async () => {
    const bus = new EventBus()
    const approved = vi.fn()
    const denied = vi.fn()
    bus.subscribe('booking.approved', approved)
    bus.subscribe('booking.denied', denied)
    bus.emit('booking.approved', makeBooking())
    await flushMicrotasks()
    expect(approved).toHaveBeenCalledTimes(1)
    expect(denied).not.toHaveBeenCalled()
  })

  it('fans out to multiple subscribers on the same channel', async () => {
    const bus = new EventBus()
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn()
    bus.subscribe('booking.completed', a)
    bus.subscribe('booking.completed', b)
    bus.subscribe('booking.completed', c)
    bus.emit('booking.completed', makeBooking())
    await flushMicrotasks()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    expect(c).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops future deliveries but not in-flight ones', async () => {
    const bus = new EventBus()
    const h = vi.fn()
    const unsub = bus.subscribe('booking.approved', h)
    bus.emit('booking.approved', makeBooking())
    unsub()
    bus.emit('booking.approved', makeBooking())
    await flushMicrotasks()
    // First emit was snapshotted before unsubscribe so it delivers once.
    expect(h).toHaveBeenCalledTimes(1)
  })

  it('unsubscribeAll clears every channel', async () => {
    const bus = new EventBus()
    const h = vi.fn()
    bus.subscribe('booking.approved', h)
    bus.subscribe('assignment.created', h)
    bus.unsubscribeAll()
    bus.emit('booking.approved', makeBooking())
    bus.emit('assignment.created', makeAssignment())
    await flushMicrotasks()
    expect(h).not.toHaveBeenCalled()
    expect(bus.handlerCount('booking.approved')).toBe(0)
  })
})

describe('EventBus — async + error isolation', () => {
  it('async handlers propagate rejections to onError but do not break siblings', async () => {
    const onError = vi.fn()
    const bus = new EventBus({ onError })
    const bad = vi.fn().mockRejectedValue(new Error('boom'))
    const good = vi.fn()
    bus.subscribe('booking.denied', bad)
    bus.subscribe('booking.denied', good)
    bus.emit('booking.denied', makeBooking())
    await flushMicrotasks()
    await flushMicrotasks()
    expect(bad).toHaveBeenCalledTimes(1)
    expect(good).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]!).toBe('booking.denied')
  })

  it('synchronous throws are caught and reported, siblings still fire', async () => {
    const onError = vi.fn()
    const bus = new EventBus({ onError })
    const bad = vi.fn(() => { throw new Error('sync-boom') })
    const good = vi.fn()
    bus.subscribe('booking.cancelled', bad)
    bus.subscribe('booking.cancelled', good)
    bus.emit('booking.cancelled', makeBooking())
    await flushMicrotasks()
    expect(good).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('emit is async — caller stack unwinds before handlers run', async () => {
    const bus = new EventBus()
    const order: string[] = []
    bus.subscribe('booking.requested', () => { order.push('handler') })
    order.push('before-emit')
    bus.emit('booking.requested', makeBooking())
    order.push('after-emit')
    await flushMicrotasks()
    expect(order).toEqual(['before-emit', 'after-emit', 'handler'])
  })
})

describe('EventBus — mid-dispatch mutation safety', () => {
  it('snapshots handlers so an unsubscribe during dispatch does not skip siblings', async () => {
    const bus = new EventBus()
    const calls: string[] = []
    const unsubB = bus.subscribe('booking.approved', () => { calls.push('a'); unsubB() })
    bus.subscribe('booking.approved', () => { calls.push('b') })
    bus.emit('booking.approved', makeBooking())
    await flushMicrotasks()
    expect(calls).toEqual(['a', 'b'])
  })

  it('a subscribe during dispatch does not receive the in-flight emit', async () => {
    const bus = new EventBus()
    const late = vi.fn()
    bus.subscribe('booking.approved', () => { bus.subscribe('booking.approved', late) })
    bus.emit('booking.approved', makeBooking())
    await flushMicrotasks()
    expect(late).not.toHaveBeenCalled()
    // but the next emit does reach the late handler
    bus.emit('booking.approved', makeBooking())
    await flushMicrotasks()
    expect(late).toHaveBeenCalledTimes(1)
  })
})

describe('channelForApprovalTransition', () => {
  it('new → requested is booking.requested', () => {
    expect(channelForApprovalTransition(null, 'requested')).toBe('booking.requested')
    expect(channelForApprovalTransition(undefined, 'requested')).toBe('booking.requested')
  })

  it('* → approved is booking.approved', () => {
    expect(channelForApprovalTransition('requested', 'approved')).toBe('booking.approved')
    expect(channelForApprovalTransition('pending_higher', 'approved')).toBe('booking.approved')
  })

  it('* → finalized is booking.completed', () => {
    expect(channelForApprovalTransition('approved', 'finalized')).toBe('booking.completed')
  })

  it('* → denied is booking.denied', () => {
    expect(channelForApprovalTransition('requested', 'denied')).toBe('booking.denied')
  })

  it('same-stage self-loops do not fire', () => {
    expect(channelForApprovalTransition('approved', 'approved')).toBeNull()
  })

  it('pending_higher and unknown stages do not fan out', () => {
    expect(channelForApprovalTransition('requested', 'pending_higher')).toBeNull()
    expect(channelForApprovalTransition('approved', 'weird_stage')).toBeNull()
  })

  it('non-null from stage → requested returns null (already in-flight)', () => {
    expect(channelForApprovalTransition('pending_higher', 'requested')).toBeNull()
  })
})

describe('EventBus — unsubscribe edge cases', () => {
  it('calling unsubscribe twice is safe (second call is a no-op)', async () => {
    const bus = new EventBus()
    const handler = vi.fn()
    const unsub = bus.subscribe('booking.requested', handler)
    unsub()
    expect(() => unsub()).not.toThrow()
    bus.emit('booking.requested', makeBooking())
    await flushMicrotasks()
    expect(handler).not.toHaveBeenCalled()
  })

  it('default onError handler fires via console.error when no onError option given', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bus = new EventBus()
    bus.subscribe('booking.requested', () => { throw new Error('boom') })
    bus.emit('booking.requested', makeBooking())
    await flushMicrotasks()
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('booking.requested'),
      expect.any(Error),
    )
    spy.mockRestore()
  })
})
