/**
 * sha256 — known-answer tests (FIPS 180-4 / RFC 6234 vectors).
 */
import { describe, it, expect } from 'vitest'
import { sha256Hex } from '../sha256.js'

describe('sha256Hex', () => {
  it('matches the empty-string vector', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches "abc" vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('matches 56-byte boundary vector (just under one block)', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('matches a 64-byte-aligned vector (exact one block before pad)', () => {
    // 64 'a' characters — forces padding into a second block.
    const s = 'a'.repeat(64)
    expect(sha256Hex(s)).toBe(
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    )
  })

  it('handles multi-byte UTF-8 input', () => {
    // "🙂" is 4-byte UTF-8 — ensures we count bytes, not code units.
    expect(sha256Hex('🙂')).toBe(
      'd06f1525f791397809f9bc98682b5c13318eca4c3123433467fd4dffda44fd14',
    )
  })

  it('is deterministic across invocations', () => {
    const a = sha256Hex('deterministic-check-123')
    const b = sha256Hex('deterministic-check-123')
    expect(a).toBe(b)
  })

  it('produces distinct digests for near-duplicate inputs', () => {
    expect(sha256Hex('hello')).not.toBe(sha256Hex('Hello'))
  })
})
