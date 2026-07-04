/* ── Roberto's FOH — service worker ──────────────────────────────────────
   PURPOSE: keep the app working offline and let always-on wall screens
   self-update the instant a new version is deployed — mirroring the kitchen
   app's service worker.

   DESIGN = NETWORK-FIRST (this is the safety property that matters):
   every online load fetches fresh code from the server first, and only falls
   back to the cache when the network is genuinely unavailable. So a bad cache
   can NEVER strand a device on stale/broken code while it's online — the next
   load simply re-downloads. The cache exists purely as an offline safety net.

   UPDATES: on install the new worker calls skipWaiting(), and on activate it
   deletes every old cache and claims all open pages (clients.claim). Combined
   with the registration logic in index.html (reg.update() heartbeat +
   controllerchange reload), a fresh deploy reaches every screen with no manual
   tap. To force a clean cache rebuild, bump the CACHE version string below. */

const CACHE = 'robertos-foh-v20260704r';

// Best-effort warm cache. The bare paths are precached on install; the real
// runtime requests (some carry a ?v= cache-buster) are cached on the fly by the
// network-first handler, and the offline fallback uses ignoreSearch so a cached
// "common.js" still answers a request for "common.js?v=123".
const ASSETS = [
  './',
  './index.html',
  './common.js',
  './foh-events.js',
  './foh-revenue.js',
  './foh-closing.js',
  './foh-ops.js',
  './stock-take.js',
  './site.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './robertos-logo-burgundy.svg',
  './robertos-logo-white.svg'
];

// Install: precache assets, then activate immediately (don't wait for old tabs).
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      // Tolerate a single missing/renamed asset instead of failing the whole install.
      Promise.all(ASSETS.map(a =>
        cache.add(a).catch(() => {})
      ))
    )
  );
});

// Activate: delete every other cache version, then take control of open pages.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first for same-origin GETs; fall back to cache only when offline.
// Cross-origin requests (Supabase API on supabase.co, the supabase-js CDN on
// jsdelivr, Google Fonts) are left completely untouched — never intercepted,
// never cached — so live data and auth always go straight to the network.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // same-origin only

  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(res => {
        // Fresh copy from the server — refresh the cache and return it.
        const clone = res.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, clone)).catch(() => {});
        return res;
      })
      .catch(() => {
        // Offline — serve the cached copy. ignoreSearch lets a cached bare file
        // answer a versioned (?v=) request; navigations fall back to index.html.
        return caches.match(e.request, { ignoreSearch: true }).then(hit =>
          hit || (e.request.mode === 'navigate'
            ? caches.match('./index.html', { ignoreSearch: true })
            : undefined)
        );
      })
  );
});

// Let the page tell a freshly-installed worker to activate without waiting.
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
