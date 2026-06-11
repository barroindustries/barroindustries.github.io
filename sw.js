// ═══════════════════════════════════════════════════════
//  Barro Industries — Service Worker v4
//  Strategy:
//    • Install → pre-cache core app shell
//    • Static assets (JS/CSS/icons) → Cache-first, update in background
//    • HTML / API → Network-first, cache as offline fallback
// ═══════════════════════════════════════════════════════

const CACHE_VER   = 'bi-ops-v4';
const STATIC      = `${CACHE_VER}-static`;
const RUNTIME     = `${CACHE_VER}-runtime`;

// Core app shell — pre-cached on install so first load is instant after SW installs
const PRECACHE = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/manifest.json',
  '/js/firebase-config.js',
  '/js/config.js',
  '/js/drive.js',
  '/js/notifications.js',
  '/js/departments.js',
  '/js/app.js',
  '/js/modules.js',
  '/icons/barro-logo.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.svg'
];

// External CDN scripts — cache aggressively (versioned URLs never change)
const CDN_CACHE_PATTERNS = [
  'gstatic.com/firebasejs',
  'cdn.jsdelivr.net/npm/chart.js',
  'unpkg.com/lucide@'
];

// ── Install: pre-cache app shell ─────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC).then(cache =>
      cache.addAll(PRECACHE).catch(err => console.warn('[SW] Pre-cache partial fail:', err))
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: prune old caches ───────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC && k !== RUNTIME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ──────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Skip non-http(s), chrome-extension, Firebase SDK internals
  if (!url.startsWith('http')) return;
  if (url.includes('firestore.googleapis.com')) return;
  if (url.includes('identitytoolkit.googleapis.com')) return;
  if (url.includes('securetoken.googleapis.com')) return;

  // CDN scripts → Cache-first (they're versioned, never change)
  if (CDN_CACHE_PATTERNS.some(p => url.includes(p))) {
    event.respondWith(cacheFirst(event.request, STATIC));
    return;
  }

  // Local static assets (JS, CSS, fonts, images, icons) → Stale-while-revalidate
  if (url.includes(self.location.origin)) {
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    if (['js','css','png','jpg','jpeg','svg','webp','woff','woff2','ico'].includes(ext)) {
      event.respondWith(staleWhileRevalidate(event.request, STATIC));
      return;
    }
    // HTML → Network-first, fallback to cache
    if (ext === 'html' || url.endsWith('/') || !url.includes('.')) {
      event.respondWith(networkFirst(event.request, RUNTIME));
      return;
    }
  }

  // Everything else → Network-first
  event.respondWith(networkFirst(event.request, RUNTIME));
});

// ── Strategies ───────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache   = await caches.open(cacheName);
  const cached  = await cache.match(request);
  // Fetch fresh copy in background regardless
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  // Return cached immediately if available, otherwise wait for network
  return cached || fetchPromise;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline — content not available', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
