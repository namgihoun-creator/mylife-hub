import "server-only";

/**
 * In-memory sliding-window rate limiter.
 *
 * Limits: state lives in this server process only. On serverless / multi-instance deployments each
 * instance counts separately, so treat it as a first line of defense (token entropy is the real one);
 * move to a shared store (e.g. a Postgres counter) if the app is ever scaled out.
 */
type Hit = number[];

const store = new Map<string, Hit>();
let lastSweep = 0;

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  // Opportunistic cleanup so the map cannot grow without bound.
  if (now - lastSweep > windowMs) {
    lastSweep = now;
    for (const [k, hits] of store) {
      if (hits.length === 0 || now - hits[hits.length - 1] > windowMs) store.delete(k);
    }
  }

  const windowStart = now - windowMs;
  const hits = (store.get(key) ?? []).filter((t) => t > windowStart);

  if (hits.length >= limit) {
    store.set(key, hits);
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) };
  }

  hits.push(now);
  store.set(key, hits);
  return { allowed: true, remaining: limit - hits.length, retryAfterSec: 0 };
}

/**
 * Client IP for rate limiting. Behind a trusted proxy (Vercel, nginx) the forwarded headers are set
 * by the proxy; when the app is exposed directly they are client-controlled and can be rotated.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return headers.get("x-real-ip")?.trim() || forwarded || "unknown";
}
