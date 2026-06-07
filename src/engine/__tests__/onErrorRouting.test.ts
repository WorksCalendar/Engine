/**
 * CalendarEngine routes its internal diagnostics through the injectable
 * onError sink instead of hard-coding console.* — so console-less and
 * structured-logging hosts don't silently lose them. When no onError is
 * wired, the previous console behavior is preserved (no regression).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CalendarEngine } from '../CalendarEngine.js'
import { makeEvent } from '../schema/eventSchema.js'
import type { EngineEvent } from '../schema/eventSchema.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const badIdEvent = (): EngineEvent =>
  // A malformed event whose id is missing — indexEventsById drops it.
  ({ ...makeEvent('placeholder', { title: 'x', start: new Date(), end: new Date() }), id: '' } as EngineEvent)

describe('CalendarEngine onError routing', () => {
  it('reports a dropped malformed-id event through onError with a stable code', () => {
    const onError = vi.fn()
    new CalendarEngine({ events: [badIdEvent()], onError })
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ENGINE_INVALID_EVENT_ID', domain: 'validation' }),
    )
  })

  it('reports a throwing state listener through onError instead of console', () => {
    const onError = vi.fn()
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const engine = new CalendarEngine({ onError })
    engine.subscribe(() => { throw new Error('listener boom') })

    engine.applyMutation({
      type: 'create',
      event: { title: 'x', start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-01T01:00:00Z') },
    } as never)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ENGINE_LISTENER_THREW', domain: 'render' }),
    )
    expect(consoleErr).not.toHaveBeenCalled()
  })

  it('falls back to console when no onError is wired (no regression)', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new CalendarEngine({ events: [badIdEvent()] })
    expect(consoleWarn).toHaveBeenCalledTimes(1)
  })
})
