/** Pure WebXR helpers (no React, no path aliases: unit-tested with node:test). */

export type WebXrArSupport = "checking" | "supported" | "unsupported";

export type Vec3 = { x: number; y: number; z: number };

type XrLike = { isSessionSupported?: (mode: string) => Promise<boolean> };

/**
 * Can this browser run an `immersive-ar` session (Android Chrome + ARCore, https)? Anything else — iOS Safari, desktop, in-app
 * browsers (KakaoTalk, Naver), plain http, a throwing or missing `navigator.xr` — answers `'unsupported'`, never throws.
 */
export async function checkWebXrArSupport(): Promise<Exclude<WebXrArSupport, "checking">> {
  try {
    if (typeof navigator === "undefined" || !("xr" in navigator)) return "unsupported";
    const xr = (navigator as unknown as { xr?: XrLike | null }).xr;
    if (!xr || typeof xr.isSessionSupported !== "function") return "unsupported";
    return (await xr.isSessionSupported("immersive-ar")) === true ? "supported" : "unsupported";
  } catch {
    return "unsupported";
  }
}

/** Straight-line distance between two 3D points (metres, as WebXR reports them) rounded to whole centimetres. */
export function calculate3dDistanceCm(p1: Vec3, p2: Vec3): number {
  return Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z) * 100);
}
