const CACHE = "classdesk-shell-v4";
const SHELL = ["/login", "/manifest.webmanifest", "/icon.svg"];
const CACHEABLE_APP_SHELLS = new Set(["/", "/records", "/notes", "/announcements", "/assistant", "/catch-up", "/courses", "/lectures", "/assignments", "/attendance", "/concerns", "/settings", "/coverage", "/calendar"]);
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (event) => {
  if (event.data === "clear-cache") event.waitUntil(caches.delete(CACHE));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Never cache API responses. They can contain private academic or student data.
  // Cache only static Next assets and page shells; user data is loaded from APIs/IndexedDB.
  if (url.pathname.startsWith("/_next/static/") || ["/manifest.webmanifest", "/icon.svg"].includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
    return;
  }

  if (request.mode === "navigate" && CACHEABLE_APP_SHELLS.has(url.pathname)) {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok && !response.redirected) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match("/login")) || new Response("You are offline. Reconnect to open ClassDesk.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
  }
});
