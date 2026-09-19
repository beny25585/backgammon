// Clean up old PWA workers before loading any application dependencies in dev.
// A real entry file also avoids Vite's inline HTML-proxy module URLs on deep links.
async function bootstrap() {
  let reloadRequired = false;
  if (import.meta.env.DEV && "serviceWorker" in navigator) {
    const isGameWorker = (url?: string) =>
      Boolean(url && new URL(url).pathname === "/backgammon/sw.js");
    reloadRequired = isGameWorker(navigator.serviceWorker.controller?.scriptURL);
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter(registration =>
      isGameWorker(registration.active?.scriptURL) ||
      isGameWorker(registration.waiting?.scriptURL) ||
      isGameWorker(registration.installing?.scriptURL)
    ).map(registration => registration.unregister()));
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("backgammon-app-")).map(name => caches.delete(name)));
  }
  if (reloadRequired) {
    // Keep the handoff fragment and saved game URL intact.
    window.location.reload();
    return;
  }
  await import("./main");
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/backgammon/sw.js", { scope: "/backgammon/" });
  }
}

void bootstrap();
