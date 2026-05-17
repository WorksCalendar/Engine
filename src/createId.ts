/**
 * Create durable client-side IDs.
 *
 * Prefers crypto.randomUUID() when available and falls back to
 * crypto.getRandomValues() for environments that do not expose randomUUID.
 */
export function createId(prefix = 'id'): string {
  const scopedPrefix = prefix ? `${prefix}-` : '';

  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${scopedPrefix}${globalThis.crypto.randomUUID()}`;
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);

    // RFC 4122 version 4 formatting bits.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return `${scopedPrefix}${uuid}`;
  }

  throw new Error('Secure ID generation requires Web Crypto support.');
}
