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

const CACHE = 'robertos-foh-v20260721b';

// Best-effort warm cache. The bare paths are precached on install; the real
// runtime requests (some carry a ?v= cache-buster) are cached on the fly by the
// network-first handler, and the offline fallback uses ignoreSearch so a cached
// "common.js" still answers a request for "common.js?v=123".
const ASSETS = [
  './',
  './index.html',
  // index.html used to carry the whole app inline, so precaching it was enough.
  // It is now a ~47KB shell: without these two the offline app is a blank page.
  // Any future extraction out of index.html MUST be added here as well.
  './foh-core.js',
  './foh-styles.css',
  './common.js',
  // Read by index.html and by BOTH link-only feedback pages (the questionnaire
  // and the status page). Those pages are deliberately bypassed below — they must
  // never open inside the installed app — but this is an ordinary subresource:
  // network-first like everything else, so it can go stale only while genuinely
  // offline, where those pages never worked anyway (they are not cached at all).
  './foh-rounds.js',
  './foh-events.js',
  // Pre-existing gap, unrelated to the split: the largest module (365KB) was
  // never precached, so the events desk was already offline-broken.
  './foh-privateevents.js',
  './foh-revenue.js',
  './foh-closing.js',
  './foh-ops.js',
  './stock-take.js',
  './foh-reviews.js',
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

  // The link-only pages are NOT the app and must never be touched by it.
  // Cloudflare Pages 308-redirects "/client-menus.html?…" to "/client-menus?…",
  // and that redirect trips the offline fallback below — which answers any
  // unmatched navigation with index.html. The result: on a staff device that has
  // the app installed, a link we sent a guest opens the APP instead of their
  // menu. Left to the network, these pages always resolve correctly, and there
  // is nothing to gain by caching them — the link is opened once.
  // Matches both "/client-menus.html" and the redirected "/client-menus".
  //
  // foh-feedback.html is the same shape of thing and hits the same trap HARDER:
  // we send it to staff, whose phones definitely DO have the app installed, so
  // without this the feedback link opens the app and the round dies silently.
  //
  // The suffix group matters: this used to be a bare "foh-feedback", which does
  // NOT match foh-feedback-status.html — the page the team open to check on us.
  // It would have been swallowed by the app exactly like the round was, and just
  // as silently. Any NEW foh-feedback-* page is covered automatically now; any
  // other link-only page must still be added here by hand.
  if (/\/(client-[a-z0-9-]+|foh-feedback(-[a-z0-9-]+)?)(\.html)?$/i.test(url.pathname)) return;

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
