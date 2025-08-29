const CACHE_VERSION = 'v1.0.0';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon-180.png',
  '/data.json',
].filter(Boolean);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k===CACHE_VERSION ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

// Strategy:
// - For navigations: Network first, fallback to cached index.html for offline
// - For data.json: Network first, fallback to cache
// - For others: Cache first, fallback to network
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        return net;
      } catch (e) {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // same-origin only
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/data.json')) {
      // network-first for freshness
      event.respondWith((async () => {
        try {
          const net = await fetch(req);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, net.clone());
          return net;
        } catch (e) {
          const cache = await caches.open(CACHE_VERSION);
          const cached = await cache.match(req);
          return cached || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        }
      })());
      return;
    }

    // cache-first for static assets
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req);
        cache.put(req, net.clone());
        return net;
      } catch (e) {
        return Response.error();
      }
    })());
  }
});