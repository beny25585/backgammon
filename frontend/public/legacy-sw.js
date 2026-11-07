// Served at the old /backgammon/sw.js URL without redirecting the worker script.
// Retire only the legacy game worker. The new /6b/ worker owns a separate scope.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Caches are shared by all worker scopes on this origin. Leave them for
    // the current game worker and for older game tabs still using hashed assets.
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
