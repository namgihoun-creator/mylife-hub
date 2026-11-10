/**
 * Push endpoints are URLs that THIS SERVER will later POST to. Accepting arbitrary ones would turn the
 * subscribe action into an SSRF primitive, so only the real browser push services are allowed.
 * Dev only: PUSH_ENDPOINT_ALLOWLIST_EXTRA (comma-separated hostnames) — ignored in production.
 */
const ALLOWED_SUFFIXES = [
  "fcm.googleapis.com", // Chrome, Edge, Opera, Brave, Samsung Internet
  "push.services.mozilla.com", // Firefox (updates.push.services.mozilla.com)
  "push.apple.com", // Safari (web.push.apple.com)
  "notify.windows.com", // legacy Edge / WNS
];

function extraHosts(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  return (process.env.PUSH_ENDPOINT_ALLOWLIST_EXTRA ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return (
    ALLOWED_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`)) || extraHosts().includes(host)
  );
}
