const CACHE_NAME = "backgammon-app-v5";
const APP_ENTRY = "/6b/backgammon/";
const APP_SHELL = [
  APP_ENTRY,
  "/6b/backgammon/pwa-icon-192.png",
  "/6b/backgammon/pwa-icon-512.png",
];
const FINGERPRINTED_ASSET = /^\/6b\/backgammon\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(APP_SHELL.map((path) => new Request(path, { cache: "no-cache" }))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("backgammon-app-") && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Development source and Vite runtime URLs must always come from the server.
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return;
  // Chrome must see the current shared installation scope, not an old app-shell copy.
  if (url.pathname.endsWith("/manifest.webmanifest")) return;
  if (
    url.pathname.startsWith("/backgammon/api/") ||
    url.pathname.startsWith("/backgammon/ws/")
  ) {
    return;
  }

  const isNavigation = request.mode === "navigate";
  const isAsset = url.pathname.startsWith("/6b/backgammon/assets/");
  if (!isNavigation && !isAsset && !APP_SHELL.includes(url.pathname)) return;

  // Revalidate HTML and fixed-name assets. Keep their cached copies for offline use.
  if (isNavigation || !FINGERPRINTED_ASSET.test(url.pathname)) {
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)),
            );
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          if (!isNavigation) return Response.error();
          return (
            (await caches.match(APP_ENTRY)) ||
            new Response("The app is unavailable while offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
    return;
  }

  // Vite changes the URL when the content of a fingerprinted asset changes.
  event.respondWith(
    caches.match(request).then((cached) => {
      // Older deployments could cache the SPA fallback under a missing asset URL.
      const isStaleFallback =
        cached?.headers.get("Content-Type")?.startsWith("text/html") &&
        !/\.html?$/i.test(url.pathname);
      if (cached && !isStaleFallback) return cached;

      return fetch(request, isStaleFallback ? { cache: "reload" } : undefined).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)),
          );
        }
        return response;
      });
    }),
  );
});
