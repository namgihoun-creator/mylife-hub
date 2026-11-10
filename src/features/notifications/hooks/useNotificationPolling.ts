"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getUnreadNotificationCount } from "../server/notification.actions";

/**
 * Keeps the unread count fresh without websockets: refetches every `intervalMs` (only while the tab is
 * visible) and immediately when the window regains focus / the tab becomes visible again.
 * `setCount` lets the UI apply optimistic changes; the next poll reconciles with the server.
 */
export function useNotificationPolling(initialCount: number, intervalMs = 60_000) {
  const [count, setCount] = useState(initialCount);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      setCount(await getUnreadNotificationCount());
    } catch {
      // keep the last known count; the next tick retries
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, intervalMs);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh, intervalMs]);

  return { count, setCount, refresh };
}
