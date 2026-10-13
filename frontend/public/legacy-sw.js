// Served at the old /backgammon/sw.js URL without redirecting the worker script.
// Retire only the legacy game worker. The new /6b/ worker owns a separate scope.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("backgammon-app-") && name !== "backgammon-app-v5")
      .map((name) => caches.delete(name)));
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
