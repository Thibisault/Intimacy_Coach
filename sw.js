// --- sw.js (replace all) ---
const CACHE = 'ic-v5-2025-08-31';

const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './data.json',
  './app.js',
  './i18n.js',
  './util.js',
  './storage.js',
  './audio.js',
  './tts.js',
  './wake-lock.js',
  './planner.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './favicon.ico',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first pour HTML + JS cœur d'app, sinon cache-first
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  const coreJS = ['app.js','i18n.js','planner.js','util.js','storage.js'].some(p => url.pathname.endsWith('/' + p));

  if (isHTML || coreJS) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return caches.match(req);
      }
    })());
    return;
  }

  event.respondWith(caches.match(req).then(res => res || fetch(req)));
});
