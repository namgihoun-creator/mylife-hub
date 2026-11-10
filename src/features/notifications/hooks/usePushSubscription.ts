"use client";

import { useCallback, useEffect, useState } from "react";
import { hasPushSubscription, removePushSubscription, savePushSubscription } from "../server/push.actions";

export type PushStatus =
  | "loading"
  | "unsupported" // no Service Worker / Push API (or key not configured)
  | "denied" // the user blocked notifications in the browser
  | "off"
  | "on";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window &&
  !!VAPID_PUBLIC_KEY;

/**
 * Browser push subscription lifecycle: permission -> Service Worker (/sw.js) -> PushManager subscription ->
 * saved through a Server Action. `status === "on"` means this browser is subscribed AND the server knows it
 * for the current account.
 */
export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported()) return setStatus("unsupported");
    if (Notification.permission === "denied") return setStatus("denied");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setStatus(sub && (await hasPushSubscription(sub.endpoint)) ? "on" : "off");
    } catch {
      setStatus("off");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!supported() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        setError(permission === "denied" ? "브라우저에서 알림이 차단되어 있어요. 사이트 설정에서 허용해 주세요." : null);
        return;
      }

      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
        }));

      const res = await savePushSubscription(sub.toJSON(), navigator.userAgent);
      if (!res.ok) {
        // Do not leave a browser subscription the server does not know about.
        await sub.unsubscribe().catch(() => undefined);
        setError(res.error);
        setStatus("off");
        return;
      }
      setStatus("on");
    } catch {
      setError("푸시 알림을 켜지 못했어요. 이 브라우저에서 지원되지 않을 수 있어요.");
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const disable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const res = await removePushSubscription(sub.endpoint);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch {
      setError("푸시 알림을 끄지 못했어요.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return { status, busy, error, enable, disable };
}
