/**
 * Prototype-pollution invariant lock (README "Security & embeddability":
 * "the engine never assigns into Object.prototype or accepts __proto__ as
 * a key").
 *
 * The engine is safe by *construction* — normalizers build events from
 * allowlisted object literals, and every merge uses object spread (which
 * creates own properties, never walks the prototype setter). These tests
 * pin that invariant so a future refactor to Object.assign / bracket
 * assignment from attacker-controlled keys is caught immediately.
 *
 * Attack vector modelled: untrusted JSON. `JSON.parse` is the one common
 * path that produces an *own enumerable* "__proto__" key, unlike an object
 * literal `{ __proto__: ... }` (which sets the prototype at parse time).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { normalizeInputEvent, normalizeInputEvents } from '../engine/adapters/normalizeInputEvent.js'
import { applyOperation } from '../engine/operations/applyOperation.js'
import { evaluateConflicts } from '../conflictEngine.js'
import { appendAuditEntry, verifyAuditChain } from '../approvals/auditChain.js'
import { CalendarEngine } from '../engine/CalendarEngine.js'
import type { EngineOperation } from '../engine/schema/operationSchema.js'

/** An object carrying an OWN enumerable "__proto__" key (the JSON vector). */
function pollutingPayload(): Record<string, unknown> {
  return JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}')
}

function assertClean(): void {
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  expect(Object.prototype).not.toHaveProperty('polluted')
}

afterEach(() => {
  // Defensive: if any test *did* pollute, scrub it so we don't cascade.
  delete (Object.prototype as Record<string, unknown>).polluted
})

describe('prototype pollution — normalizeInputEvent', () => {
  it('does not pollute from malicious top-level keys', () => {
    normalizeInputEvent({
      ...pollutingPayload(),
      title: 'x',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T01:00:00Z',
    })
    assertClean()
  })

  it('does not pollute from a malicious meta blob', () => {
    normalizeInputEvent({ title: 'x', meta: pollutingPayload() })
    assertClean()
  })

  it('does not pollute through the array path', () => {
    normalizeInputEvents([pollutingPayload(), { title: 'ok' }])
    assertClean()
  })
})

describe('prototype pollution — applyOperation merge paths', () => {
  const base = new Map([[
    'e1',
    normalizeInputEvent({ id: 'e1', title: 'x', start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z' }),
  ]])

  it('update patch cannot pollute', () => {
    const op = { type: 'update', id: 'e1', patch: pollutingPayload() } as unknown as EngineOperation
    applyOperation(op, base)
    assertClean()
  })

  it('group-change patch cannot pollute', () => {
    const op = { type: 'group-change', id: 'e1', patch: pollutingPayload() } as unknown as EngineOperation
    applyOperation(op, base)
    assertClean()
  })

  it('create event meta cannot pollute', () => {
    const op = {
      type: 'create',
      event: { title: 'x', start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-01T01:00:00Z'), meta: pollutingPayload() },
    } as unknown as EngineOperation
    applyOperation(op, base)
    assertClean()
  })
})

describe('prototype pollution — evaluateConflicts', () => {
  it('malicious event meta cannot pollute', () => {
    evaluateConflicts({
      proposed: { id: 'p', start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', resource: 'r', meta: pollutingPayload() },
      events: [{ id: 'e', start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', resource: 'r', meta: pollutingPayload() }],
      rules: [{ id: 'o', type: 'resource-overlap', severity: 'hard' }],
    })
    assertClean()
  })
})

describe('prototype pollution — audit chain', () => {
  it('a __proto__-bearing entry neither pollutes nor silently drops from the hash', () => {
    const malicious = JSON.parse('{"action":"approve","at":"2026-01-01T00:00:00Z","__proto__":{"polluted":"yes"}}')
    const history = appendAuditEntry([], malicious)
    assertClean()
    // The null-prototype canonicalizer keeps the chain verifiable...
    expect(verifyAuditChain(history).ok).toBe(true)
    // ...and the entry is intact (hash + anchor present).
    expect(history[0]?.hash).toBeTruthy()
    expect(history[0]?.prevHash).toBe('')
  })
})

describe('prototype pollution — CalendarEngine mutation', () => {
  it('a create mutation with malicious meta cannot pollute', () => {
    const engine = new CalendarEngine()
    const op = {
      type: 'create',
      event: { title: 'x', start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-01T01:00:00Z'), meta: pollutingPayload() },
    } as unknown as EngineOperation
    engine.applyMutation(op)
    assertClean()
  })
})
