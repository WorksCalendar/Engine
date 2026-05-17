/**
 * EventBus × CalendarEngine integration — issue #216.
 *
 * Verifies that engine mutations emit the right lifecycle channels exactly
 * once per transition, and that approval-stage updates on `event.meta` map
 * to booking.approved / denied / completed.
 */
import { describe, it, expect, vi } from 'vitest'
import { CalendarEngine } from '../CalendarEngine.js'
import { EventBus } from '../eventBus.js'
import { makeEvent } from '../schema/eventSchema.js'
import type { EngineEvent } from '../schema/eventSchema.js'
import type { ApprovalStage } from '../../types/assets.js'

const AT = new Date(2026, 3, 20, 10, 0)

const flush = () => Promise.resolve()

function eventWithStage(id: string, stage: ApprovalStage['stage'], extra: Partial<ApprovalStage> = {}): EngineEvent {
  return makeEvent(id, {
    title: 'Booking',
    start: new Date(2026, 3, 20, 10, 0),
    end: new Date(2026, 3, 20, 11, 0),
    meta: {
      approvalStage: {
        stage,
        updatedAt: AT.toISOString(),
        history: [],
        ...extra,
      } as ApprovalStage,
    },
  })
}

describe('CalendarEngine → EventBus — create / delete', () => {
  it('emits booking.requested on create', async () => {
    const bus = new EventBus()
    const engine = new CalendarEngine({ bus })
    const handler = vi.fn()
    bus.subscribe('booking.requested', handler)

    const result = engine.applyMutation({
      type: 'create',
      event: {
        title: 'Team offsite',
        start: new Date(2026, 3, 21, 9, 0),
        end: new Date(2026, 3, 21, 10, 0),
      } as Omit<EngineEvent, 'id'>,
    })

    expect(result.status).toBe('accepted')
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]!).toMatchObject({
      sourceActionId: 'op:create',
    })
    expect(handler.mock.calls[0][0].eventSnapshot!?.title).toBe('Team offsite')
  })

  it('emits booking.cancelled on delete', async () => {
    const bus = new EventBus()
    const ev = makeEvent('x1', {
      title: 'X',
      start: new Date(2026, 3, 20, 10, 0),
      end: new Date(2026, 3, 20, 11, 0),
    })
    const engine = new CalendarEngine({ events: [ev], bus })
    const handler = vi.fn()
    bus.subscribe('booking.cancelled', handler)

    engine.applyMutation({ type: 'delete', id: 'x1' })
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].eventId!).toBe('x1')
  })
})

describe('CalendarEngine → EventBus — approval stage transitions', () => {
  it('emits booking.approved when stage flips requested → approved', async () => {
    const bus = new EventBus()
    const before = eventWithStage('ev', 'requested')
    const engine = new CalendarEngine({ events: [before], bus })
    const approved = vi.fn()
    const requested = vi.fn()
    bus.subscribe('booking.approved', approved)
    bus.subscribe('booking.requested', requested)

    const nextStage: ApprovalStage = {
      stage: 'approved',
      updatedAt: AT.toISOString(),
      history: [{ action: 'approve', at: AT.toISOString(), actor: 'alice' }],
    }
    engine.applyMutation({
      type: 'update',
      id: 'ev',
      patch: { meta: { approvalStage: nextStage } },
    })

    await flush()
    expect(approved).toHaveBeenCalledTimes(1)
    expect(approved.mock.calls[0][0]!).toMatchObject({
      eventId: 'ev',
      actor: 'alice',
      sourceActionId: 'op:update',
    })
    expect(requested).not.toHaveBeenCalled()
  })

  it('emits booking.completed on * → finalized', async () => {
    const bus = new EventBus()
    const before = eventWithStage('ev', 'approved')
    const engine = new CalendarEngine({ events: [before], bus })
    const completed = vi.fn()
    bus.subscribe('booking.completed', completed)

    engine.applyMutation({
      type: 'update',
      id: 'ev',
      patch: {
        meta: {
          approvalStage: {
            stage: 'finalized',
            updatedAt: AT.toISOString(),
            history: [{ action: 'finalize', at: AT.toISOString() }],
          } as ApprovalStage,
        },
      },
    })
    await flush()
    expect(completed).toHaveBeenCalledTimes(1)
  })

  it('emits booking.denied with the latest reason', async () => {
    const bus = new EventBus()
    const before = eventWithStage('ev', 'requested')
    const engine = new CalendarEngine({ events: [before], bus })
    const denied = vi.fn()
    bus.subscribe('booking.denied', denied)

    engine.applyMutation({
      type: 'update',
      id: 'ev',
      patch: {
        meta: {
          approvalStage: {
            stage: 'denied',
            updatedAt: AT.toISOString(),
            history: [{ action: 'deny', at: AT.toISOString(), reason: 'budget' }],
          } as ApprovalStage,
        },
      },
    })
    await flush()
    expect(denied).toHaveBeenCalledTimes(1)
    expect(denied.mock.calls[0][0].reason!).toBe('budget')
  })

  it('does not emit when an unrelated field changes', async () => {
    const bus = new EventBus()
    const before = eventWithStage('ev', 'approved')
    const engine = new CalendarEngine({ events: [before], bus })
    const sink = vi.fn()
    bus.subscribe('booking.approved', sink)
    bus.subscribe('booking.requested', sink)
    bus.subscribe('booking.completed', sink)
    bus.subscribe('booking.denied', sink)
    bus.subscribe('booking.cancelled', sink)

    engine.applyMutation({
      type: 'update',
      id: 'ev',
      patch: { title: 'Renamed' },
    })
    await flush()
    expect(sink).not.toHaveBeenCalled()
  })

  it('does not emit on pending_higher — the transition is internal', async () => {
    const bus = new EventBus()
    const before = eventWithStage('ev', 'requested')
    const engine = new CalendarEngine({ events: [before], bus })
    const sink = vi.fn()
    bus.subscribe('booking.approved', sink)

    engine.applyMutation({
      type: 'update',
      id: 'ev',
      patch: {
        meta: {
          approvalStage: {
            stage: 'pending_higher',
            updatedAt: AT.toISOString(),
            history: [],
          } as ApprovalStage,
        },
      },
    })
    await flush()
    expect(sink).not.toHaveBeenCalled()
  })
})

describe('CalendarEngine → EventBus — assignments', () => {
  it('emits assignment.created on upsert of a new join', async () => {
    const bus = new EventBus()
    const engine = new CalendarEngine({ bus })
    const handler = vi.fn()
    bus.subscribe('assignment.created', handler)

    engine.upsertAssignment({ id: 'a1', eventId: 'ev-1', resourceId: 'r-1', units: 50 })
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].assignment.id!).toBe('a1')
  })

  it('does not re-emit assignment.created when replacing an existing assignment', async () => {
    const bus = new EventBus()
    const engine = new CalendarEngine({
      assignments: [{ id: 'a1', eventId: 'ev', resourceId: 'r', units: 50 }],
      bus,
    })
    const handler = vi.fn()
    bus.subscribe('assignment.created', handler)
    engine.upsertAssignment({ id: 'a1', eventId: 'ev', resourceId: 'r', units: 75 })
    await flush()
    expect(handler).not.toHaveBeenCalled()
  })

  it('emits assignment.removed on remove', async () => {
    const bus = new EventBus()
    const engine = new CalendarEngine({
      assignments: [{ id: 'a1', eventId: 'ev', resourceId: 'r', units: 50 }],
      bus,
    })
    const handler = vi.fn()
    bus.subscribe('assignment.removed', handler)
    engine.removeAssignment('a1')
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].assignment.id!).toBe('a1')
  })

  it('no-op remove does not emit', async () => {
    const bus = new EventBus()
    const engine = new CalendarEngine({ bus })
    const handler = vi.fn()
    bus.subscribe('assignment.removed', handler)
    engine.removeAssignment('does-not-exist')
    await flush()
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('CalendarEngine → EventBus — no bus configured', () => {
  it('is a silent no-op when the engine has no bus', () => {
    const engine = new CalendarEngine()
    expect(() => {
      engine.applyMutation({
        type: 'create',
        event: {
          title: 'T',
          start: new Date(2026, 3, 20, 10, 0),
          end: new Date(2026, 3, 20, 11, 0),
        } as Omit<EngineEvent, 'id'>,
      })
    }).not.toThrow()
    expect(engine.bus).toBeNull()
  })
})
