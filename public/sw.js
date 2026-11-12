/* FakeSpotter Arena service worker.
   - Pre-caches the app shell and post images so the game plays offline.
   - API calls (/api/*) always go to the network and are never cached. */
const CACHE = "fakespotter-v3";
const PRECACHE = [
  "/",
  "/game.html",
  "/shim.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/img/ararat.jpg",
  "/img/cafe.jpg",
  "/img/cascade.jpg",
  "/img/flood.jpg",
  "/img/mall.jpg",
  "/img/opera-original.jpg",
  "/img/opera.jpg",
  "/img/sevan.jpg",
  "/img/pairs/lights-ai.jpg",
  "/img/pairs/lights-real.jpg",
  "/img/pairs/hills-ai.jpg",
  "/img/pairs/hills-real.jpg",
  "/img/pairs/butterfly-ai.jpg",
  "/img/pairs/butterfly-real.jpg",
  "/img/pairs/ducks-ai.jpg",
  "/img/pairs/ducks-real.jpg",
  "/img/pairs/vine-ai.jpg",
  "/img/pairs/vine-real.jpg",
  "/img/pairs/tower-ai.jpg",
  "/img/pairs/tower-real.jpg",
  "/img/pairs/mirror-ai.jpg",
  "/img/pairs/mirror-real.jpg",
  "/img/pairs/bee-ai.jpg",
  "/img/pairs/bee-real.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // live detectors: always network

  // App pages: try the network first so updates land, fall back to cache offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("/game.html")))
    );
    return;
  }

  // Static assets: cache first, then network (and back-fill the cache).
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
