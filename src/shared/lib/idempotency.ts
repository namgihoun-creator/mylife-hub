/** Idempotency key via the Web Crypto API (UUID v4; hex fallback for non-secure contexts). 36/32 chars, within the DB's 8..128 check. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
