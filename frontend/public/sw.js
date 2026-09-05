/* Service worker for browser Web Push alarms. No secrets here. */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch (e) {
      data = { body: event.data ? event.data.text() : "" };
    }
    await self.registration.showNotification(data.title || "Feed withdrawal alarm", {
      body: data.body || "A withdrawal step is due now.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "alarm",
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 200, 400, 200, 400],
      data: { url: data.url || "/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const existing = wins.find((w) => "focus" in w);
      return existing ? existing.focus() : self.clients.openWindow(target);
    })
  );
});
