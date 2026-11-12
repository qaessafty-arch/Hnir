/* Darwaza service worker.
 * Caches ONLY the public app shell (HTML, JS, CSS, fonts, logo) for fast, reliable start-up.
 * Never caches /api/* — grades and student records are confidential and must not persist on devices. */
const VERSION = 'darwaza-v1';
const SHELL = ['/offline.html', '/offline.css', '/manifest.webmanifest',
  '/brand/darwaza-logo-256.png', '/brand/darwaza-logo-256.webp', '/brand/icon-192.png', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // network only, never cached

  // Page navigations: always from the network (latest version); a clear bilingual offline page otherwise.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Hashed build assets, fonts and brand images never change: cache-first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/brand/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});

// Signing out clears the shell cache too (sent by the app).
self.addEventListener('message', (event) => {
  if (event.data === 'clear-cache') event.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
});
