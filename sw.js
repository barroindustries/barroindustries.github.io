// ═══════════════════════════════════════════════════════
//  Barro Industries Operating System — Service Worker
//  Strategy:
//    • Install → pre-cache core app shell
//    • Local JS/CSS → Network-first (so a CACHE_VER bump applies on the next load, not two loads later)
//    • Images/fonts → Cache-first, update in background
//    • CDN scripts → Cache-first (versioned URLs never change)
//    • HTML / API → Network-first, cache as offline fallback
// ═══════════════════════════════════════════════════════

const CACHE_VER   = 'bi-ops-v12.0.117';
const STATIC      = `${CACHE_VER}-static`;
const RUNTIME     = `${CACHE_VER}-runtime`;

// Core app shell — pre-cached on install so first load is instant after SW installs
const PRECACHE = [
  '/',
  '/index.html',
  '/track.html',
  '/t/',
  '/t/index.html',
  '/css/styles.css',
  '/manifest.json',
  '/js/firebase-config.js',
  '/js/errlog.js',
  '/js/config.js',
  '/js/ui-states.js',
  '/js/ui-status-meta.js',
  '/js/gestures.js',
  '/js/qrcode.js',
  '/js/statutory-tables.js',
  '/js/letterhead.js',
  '/js/print-docs.js',
  '/js/bir.js',
  '/js/finance-ledger.js',
  '/js/drive.js',
  '/js/notifications.js',
  '/js/svc-approvals.js',
  '/js/ui-crud-table.js',
  '/js/departments.js',
  '/js/migrations.js',
  '/js/app.js',
  '/js/modules.js',
  '/js/chat.js',
  '/icons/bi-logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.svg',
  '/favicon.png',
  '/v/',
  '/v/index.html'
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
    )
  );
});

// ── Message: let the page decide when to activate a waiting SW ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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

  // Local same-origin static assets
  if (url.includes(self.location.origin)) {
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    // JS/CSS → Network-first so a CACHE_VER bump takes effect on the next load (not two loads later)
    if (['js','css'].includes(ext)) {
      event.respondWith(networkFirst(event.request, STATIC));
      return;
    }
    // Images/fonts → Cache-first, refresh in background
    if (['png','jpg','jpeg','svg','webp','woff','woff2','ico'].includes(ext)) {
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
