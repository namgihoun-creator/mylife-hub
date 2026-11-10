/* MyLife Hub service worker — Web Push only.
 * No fetch handler and no caching on purpose: offline support is out of scope; this worker exists to
 * receive pushes while the app is closed and to route notification clicks. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = typeof data.title === "string" && data.title ? data.title : "MyLife Hub";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    data: { url: typeof data.url === "string" ? data.url : "/timeline" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/** Same-origin only: a push payload must never be able to send the user to another site. */
function safeUrl(raw) {
  try {
    const url = new URL(raw || "/timeline", self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + "/timeline";
  } catch (_) {
    return self.location.origin + "/timeline";
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeUrl(event.notification.data && event.notification.data.url);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const win of windows) {
        if (new URL(win.url).origin !== self.location.origin) continue;
        try {
          await win.focus();
          if ("navigate" in win) await win.navigate(target);
        } catch (_) {
          // focus/navigate can be refused (e.g. uncontrolled client): fall through to a new window
          await self.clients.openWindow(target);
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
