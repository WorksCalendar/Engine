/**
 * hmacSha256Hex — known-answer tests (RFC 4231 / RFC 2104 vectors).
 *
 * Correctness of the keyed primitive is load-bearing for the authenticated
 * audit chain, so pin it against published vectors rather than only
 * round-tripping our own output.
 */
import { describe, it, expect } from 'vitest'
import { hmacSha256Hex, sha256Hex } from '../sha256.js'

describe('hmacSha256Hex — published vectors', () => {
  it('empty key, empty message', () => {
    expect(hmacSha256Hex('', '')).toBe(
      'b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad',
    )
  })

  it('classic "key" / quick-brown-fox vector', () => {
    expect(hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    )
  })

  it('RFC 4231 test case 2 (key "Jefe")', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
  })

  it('RFC 4231 test case 6 (key longer than the 64-byte block)', () => {
    const key = new Uint8Array(131).fill(0xaa)
    expect(hmacSha256Hex(key, 'Test Using Larger Than Block-Size Key - Hash Key First')).toBe(
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    )
  })

  it('accepts raw byte inputs and matches the string form', () => {
    const enc = new TextEncoder()
    expect(hmacSha256Hex(enc.encode('key'), enc.encode('msg'))).toBe(hmacSha256Hex('key', 'msg'))
  })

  it('a different key yields a different digest', () => {
    expect(hmacSha256Hex('k1', 'msg')).not.toBe(hmacSha256Hex('k2', 'msg'))
  })

  it('is not equal to the unkeyed hash of the message', () => {
    expect(hmacSha256Hex('key', 'msg')).not.toBe(sha256Hex('msg'))
  })
})
