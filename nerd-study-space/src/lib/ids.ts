/** Random RFC 4122 v4 UUID (client-generated ids make retries idempotent). */
export function uuid(): string {
  // randomUUID only exists in secure contexts (https / localhost), so keep a fallback
  // for e.g. opening the dev server from a phone over plain http on the local network.
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Deterministic UUID-shaped id from a string. Used when importing data that has
 * no ids (e.g. a legacy backup) so importing the same file twice cannot create
 * duplicates.
 */
export function stableId(namespace: string, key: string): string {
  const s = `${namespace}|${key}`;
  const parts: number[] = [];
  for (let seed = 0; seed < 4; seed++) {
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b1);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    parts.push(h >>> 0);
  }
  const hex = parts.map((p) => p.toString(16).padStart(8, '0')).join('');
  const v = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${v}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const isUuid = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
