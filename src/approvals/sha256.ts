/**
 * Pure, sync SHA-256 + HMAC-SHA256 — issue #215.
 *
 * Implements FIPS 180-4 (SHA-256) and FIPS 198-1 / RFC 2104 (HMAC) on plain
 * JS. Sync by design so the transition reducer and `verifyAuditChain` can
 * remain synchronous and usable from validators/selectors that must return
 * results in one tick. No Node `crypto` import and no WebCrypto dependency,
 * so it runs identically in Node, browsers, workers, and edge runtimes under
 * a strict CSP. Not meant to outrun WebCrypto on megabyte inputs — audit
 * entries are a few hundred bytes each.
 */

const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

const SHA256_BLOCK_BYTES = 64
const SHA256_DIGEST_BYTES = 32

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? utf8Bytes(input) : input
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0')
  return out
}

/** Raw SHA-256 digest of a byte sequence (32 bytes). */
function sha256Digest(msg: Uint8Array): Uint8Array {
  const byteLen = msg.length
  const bitLen = byteLen * 8

  // Padding: 1-bit, then zeros, then 64-bit big-endian length.
  const padded = new Uint8Array(
    ((byteLen + 9 + 63) >>> 6) << 6, // next multiple of 64 that fits byteLen + 9 bytes
  )
  padded.set(msg, 0)
  padded[byteLen] = 0x80
  // Length in bits — JS numbers are safe up to 2^53, so split hi/lo.
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  const tail = padded.length - 8
  padded[tail    ] = (hi >>> 24) & 0xff
  padded[tail + 1] = (hi >>> 16) & 0xff
  padded[tail + 2] = (hi >>>  8) & 0xff
  padded[tail + 3] =  hi         & 0xff
  padded[tail + 4] = (lo >>> 24) & 0xff
  padded[tail + 5] = (lo >>> 16) & 0xff
  padded[tail + 6] = (lo >>>  8) & 0xff
  padded[tail + 7] =  lo         & 0xff

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19

  const W = new Uint32Array(64)
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      const j = chunk + (i << 2)
      W[i] = ((padded[j]! << 24) | (padded[j + 1]! << 16) | (padded[j + 2]! << 8) | padded[j + 3]!) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15]!
      const w2  = W[i - 2]!
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0
    }

    let a = h0, b = h1, c = h2, d = h3
    let e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i]! + W[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const mj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + mj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  const out = new Uint8Array(SHA256_DIGEST_BYTES)
  const words = [h0, h1, h2, h3, h4, h5, h6, h7]
  for (let i = 0; i < 8; i++) {
    const w = words[i]!
    out[i * 4    ] = (w >>> 24) & 0xff
    out[i * 4 + 1] = (w >>> 16) & 0xff
    out[i * 4 + 2] = (w >>>  8) & 0xff
    out[i * 4 + 3] =  w         & 0xff
  }
  return out
}

/** Hex-encoded SHA-256 of a UTF-8 string. */
export function sha256Hex(message: string): string {
  return bytesToHex(sha256Digest(utf8Bytes(message)))
}

/**
 * Hex-encoded HMAC-SHA256 (FIPS 198-1 / RFC 2104).
 *
 * Authenticated keyed digest: only a holder of `key` can produce a value
 * that verifies, which is what upgrades the audit chain from tamper-
 * *evident* (anyone can recompute an unkeyed SHA-256 cascade) to tamper-
 * *resistant* (an attacker who rewrites the whole history cannot forge the
 * MACs without the secret). Hold the key server-side.
 *
 * `key` and `message` accept a UTF-8 string or raw bytes.
 */
export function hmacSha256Hex(key: string | Uint8Array, message: string | Uint8Array): string {
  let k = toBytes(key)
  // Keys longer than the block are first hashed down (RFC 2104 §2).
  if (k.length > SHA256_BLOCK_BYTES) k = sha256Digest(k)

  const ipadKey = new Uint8Array(SHA256_BLOCK_BYTES) // zero-padded to block size
  ipadKey.set(k)
  const opadKey = ipadKey.slice()
  for (let i = 0; i < SHA256_BLOCK_BYTES; i++) {
    ipadKey[i]! ^= 0x36
    opadKey[i]! ^= 0x5c
  }

  const msg = toBytes(message)
  const inner = new Uint8Array(SHA256_BLOCK_BYTES + msg.length)
  inner.set(ipadKey, 0)
  inner.set(msg, SHA256_BLOCK_BYTES)
  const innerDigest = sha256Digest(inner)

  const outer = new Uint8Array(SHA256_BLOCK_BYTES + SHA256_DIGEST_BYTES)
  outer.set(opadKey, 0)
  outer.set(innerDigest, SHA256_BLOCK_BYTES)
  return bytesToHex(sha256Digest(outer))
}
