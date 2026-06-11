// ═══════════════════════════════════════════════════════
//  Barro Industries — Service Worker (PWA)
//  Network-first: always fetches fresh content
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'bi-ops-v3';

// Install — skip waiting so new SW activates immediately
self.addEventListener('install', event => {
  self.skipWaiting();
});

// Activate — clear all old caches, claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — always network first, cache only as offline fallback
self.addEventListener('fetch', event => {
  // Only handle GET requests for same-origin or app assets
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache a copy for offline fallback (only successful responses)
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline fallback — serve from cache
        return caches.match(event.request);
      })
  );
});
