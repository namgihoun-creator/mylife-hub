import "server-only";

const encoder = new TextEncoder();

/** SHA-256 hex of the UTF-8 bytes — identical to the RPCs' encode(sha256(convert_to(x,'UTF8')),'hex'). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cryptographically random bytes (Web Crypto) as an unpadded base64url string. 64 bytes -> 86 chars. */
export function generateRawToken(byteLength = 64): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** Cheap shape check before touching the DB (magic tokens / invite codes). */
export function isPlausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,512}$/.test(token);
}
