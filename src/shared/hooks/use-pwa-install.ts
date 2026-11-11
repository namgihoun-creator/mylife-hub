"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Chromium's non-standard install event (not in lib.dom). */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

export type PwaInstallState = {
  /** false on the server and during hydration — render nothing until true (keeps SSR and client markup identical). */
  ready: boolean;
  /** Already running as an installed app (display-mode: standalone, or iOS `navigator.standalone`). */
  standalone: boolean;
  /** `appinstalled` fired in this session. */
  installed: boolean;
  /** iPhone / iPad (incl. iPadOS in desktop mode): no native prompt exists, only the manual "Add to Home Screen" flow. */
  isIOS: boolean;
  /** A captured `beforeinstallprompt` is ready to be shown (Android / desktop Chrome & Edge). */
  canPrompt: boolean;
};

const SERVER_STATE: PwaInstallState = { ready: false, standalone: false, installed: false, isIOS: false, canPrompt: false };

// ---- module-level store: `beforeinstallprompt` often fires BEFORE any component mounts (and only once per page load),
// so the listener is attached as soon as this module is evaluated in the browser (providers.tsx calls initPwaInstallCapture).
let state: PwaInstallState = SERVER_STATE;
let deferred: BeforeInstallPromptEvent | null = null;
let initialised = false;
const listeners = new Set<() => void>();

function commit(patch: Partial<PwaInstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function detectIOS(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1; // iPadOS 13+ reports itself as a Mac
}

export function detectStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function initPwaInstallCapture() {
  if (initialised || typeof window === "undefined") return;
  initialised = true;

  state = {
    ready: true,
    standalone: detectStandalone(),
    installed: false,
    isIOS: detectIOS(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0),
    canPrompt: false,
  };

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // suppress the browser's own mini-infobar; our header button replaces it
    deferred = e as BeforeInstallPromptEvent;
    commit({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    commit({ installed: true, canPrompt: false });
  });
  const mql = window.matchMedia("(display-mode: standalone)");
  mql.addEventListener?.("change", () => commit({ standalone: detectStandalone() }));
}

const subscribe = (cb: () => void) => {
  initPwaInstallCapture(); // safety net if nobody called it earlier
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => state;
const getServerSnapshot = () => SERVER_STATE;

export type PwaInstall = PwaInstallState & {
  /** Show the native install dialog. Resolves with the user's choice (`null` when no prompt is available). */
  promptInstall: () => Promise<"accepted" | "dismissed" | null>;
  /** Whether the header button should exist at all. */
  visible: boolean;
};

export function usePwaInstall(): PwaInstall {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const promptInstall = useCallback(async () => {
    const event = deferred;
    if (!event) return null;
    deferred = null; // a deferred prompt can be used once
    commit({ canPrompt: false });
    try {
      await event.prompt();
      return (await event.userChoice).outcome;
    } catch {
      return null;
    }
  }, []);

  // Never in the installed app; otherwise only where an install path exists (native prompt, or iOS manual flow).
  const visible = s.ready && !s.standalone && !s.installed && (s.canPrompt || s.isIOS);
  return { ...s, promptInstall, visible };
}
