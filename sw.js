// ═══════════════════════════════════════════════════════
//  Barro Industries — Service Worker (PWA)
//  Enables "Add to Home Screen" on mobile devices
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'bi-ops-v2';

// Files to cache for offline shell
const SHELL_FILES = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/firebase-config.js',
  '/js/app.js',
  '/manifest.json'
];

// Install: cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for Firebase/CDN, cache-first for app shell
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network-first for Firebase and CDN calls
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Cache-first for app shell files
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
