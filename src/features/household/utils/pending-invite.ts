// Remembers an invite link the visitor has opened, so that a later visit to the plain /login screen can offer
// "join the household you were invited to" instead of (accidentally) creating a second, empty household.
// Browser-only, best effort: every access is wrapped (private mode / blocked storage must never break sign-in).

const KEY = "mylife.pendingInvite";
export const PENDING_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // invites live 7 days
const CODE = /^[A-Za-z0-9_-]{16,512}$/;

type Stored = { code: string; at: number };

export function rememberInvite(code: string, now = Date.now()): void {
  if (!CODE.test(code)) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ code, at: now } satisfies Stored));
  } catch {
    /* storage unavailable */
  }
}

/** The remembered code, or null when none / malformed / older than 7 days (stale entries are dropped). */
export function readPendingInvite(now = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.code === "string" && typeof v.at === "number" && CODE.test(v.code) && now - v.at >= 0 && now - v.at <= PENDING_INVITE_TTL_MS) return v.code;
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return null;
}

export function clearPendingInvite(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
