// ═══════════════════════════════════════════════════════
//  Barro Industries Operating System — Service Worker
//  Strategy:
//    • Install → pre-cache core app shell
//    • Local JS/CSS → Network-first with a 400ms timeout (fresh code wins on any
//      usable connection; slow networks get the versioned cache instantly and a
//      background refresh). NOT stale-while-revalidate — see the long comment on
//      networkFirstTimeout() for why SWR was reverted. A CACHE_VER bump applies on
//      the next load regardless: install() re-fetches the whole PRECACHE list into a
//      brand-new cache name, and app.js reloads once the new SW activates at the next
//      login-screen visit, independent of this runtime strategy.
//    • Images/fonts → Cache-first, update in background
//    • CDN scripts → Cache-first (versioned URLs never change)
//    • HTML → Network-first with a 3000ms timeout, cache as offline fallback
//    • Everything else → Network-first (unbounded), cache as offline fallback
// ═══════════════════════════════════════════════════════

// CACHE_VER is derived from js/config.js's APP_VERSION by .githooks/pre-commit
// (only when `git config core.hooksPath .githooks` has been run for this
// clone — see CLAUDE.md). scripts/ci-invariants.sh's CACHE_VER check now
// fails CI loudly if the two ever drift apart, so this is enforced, not just
// documented convention.
const CACHE_VER = 'bi-ops-v14.0.136';
const STATIC      = `${CACHE_VER}-static`;
const RUNTIME     = `${CACHE_VER}-runtime`;

// Core app shell — pre-cached on install so first load is instant after SW installs
const PRECACHE = [
  '/',
  '/index.html',
  '/track.html',
  '/t/',
  '/t/index.html',
  '/css/tokens.css',
  '/css/styles.css',
  '/manifest.json',
  '/quote-builder-v2.html',
  '/products-database.json',
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
  '/js/meetings.js',
  '/js/svc-approvals.js',
  '/js/ui-crud-table.js',
  '/js/money-core.js',
  '/js/geo-core.js',
  '/js/departments.js',
  '/js/screens/design.js',
  '/js/screens/tasks.js',
  '/js/screens/sales.js',
  '/js/screens/crm.js',
  '/js/screens/ventures.js',
  '/js/screens/hr.js',
  '/js/screens/employee-profile.js',
  // Weekly pay run — engine then screen, matching index.html's order. Both are
  // statically referenced there, so ci-invariants.sh CHECK 2 requires both here.
  '/js/payroll-weekly.js',
  '/js/screens/payroll-weekly-ui.js',
  // PAYSLIP-OVERHAUL-SPEC.md §4 — lazy-loaded (NOT in index.html's static
  // script list — see hr.js's _ensureHtml2Canvas/_ensurePdfLite), but still
  // precached so Save-as-JPEG/Print-Save-PDF work offline once cached.
  '/js/vendor/html2canvas.min.js',
  '/js/pdf-lite.js',
  '/js/screens/production.js',
  '/js/screens/finance.js',
  '/js/screens/approvals.js',
  '/js/screens/govit.js',
  '/js/screens/partners.js',
  '/js/migrations.js',
  '/js/app.js',
  '/js/modules.js',
  '/js/screens/people.js',
  '/js/screens/dashboards.js',
  '/js/chat.js',
  '/js/screens/worker.js',
  '/icons/bi-logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/favicon.svg',
  '/favicon.png',
  '/v/',
  '/v/index.html'
];

// External CDN scripts — cache aggressively (versioned URLs never change)
// fonts.googleapis.com/fonts.gstatic.com: confirmed actually loaded (the Inter
// font via css/styles.css's @import) and permitted by index.html's CSP
// (style-src includes fonts.googleapis.com, font-src includes fonts.gstatic.com)
// — not a dead preconnect, so it's worth the same cache-first treatment as
// every other versioned static CDN asset here.
const CDN_CACHE_PATTERNS = [
  'gstatic.com/firebasejs',
  'cdn.jsdelivr.net/npm/chart.js',
  'unpkg.com/lucide@',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
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
    // JS/CSS → network-first-with-timeout (see networkFirstTimeout below).
    // 900ms → 400ms (v14 smoothness pass). The ~37 JS/CSS requests a cold load
    // fires race the network IN PARALLEL, so the worst case this ceiling costs
    // is ONE timeout (~900ms), not 37 of them — which is why the fix is halving
    // the ceiling rather than rewriting the strategy. 400ms still comfortably
    // exceeds a normal 4G fetch of an asset this size, so on any usable
    // connection the network still wins the race and you get the FRESH file:
    // the freshness guarantee documented on networkFirstTimeout survives intact.
    // Only genuinely bad connections fall through to the versioned cache, and
    // they now do so in 400ms of blank instead of 900ms.
    if (['js','css'].includes(ext)) {
      event.respondWith(networkFirstTimeout(event.request, STATIC, 400));
      return;
    }
    // Images/fonts → Cache-first (static, versioned — no per-load network)
    if (['png','jpg','jpeg','svg','webp','woff','woff2','ico'].includes(ext)) {
      event.respondWith(cacheFirst(event.request, STATIC));
      return;
    }
    // HTML → Network-first WITH A TIMEOUT, fallback to cache.
    // Previously plain networkFirst(), which awaits fetch() with no ceiling at
    // all: on a connection that is reachable-but-stalled (the phone's usual
    // failure mode — not offline, so fetch never rejects, just never settles)
    // the navigation hung indefinitely with a cached copy sitting right there.
    // 3000ms — deliberately much looser than the 400ms above, because a
    // navigation document is the one request where serving stale is genuinely
    // costly (it is what pins the app version for the whole session), so we
    // give the network a long time to win before falling back.
    if (ext === 'html' || url.endsWith('/') || !url.includes('.')) {
      event.respondWith(networkFirstTimeout(event.request, RUNTIME, 3000));
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

// v14 perf pass (adjusted): local JS/CSS use network-first-with-timeout rather
// than pure stale-while-revalidate. SWR served cached code instantly but a real
// code change only appeared ONE reload later — which breaks the owner's
// force-reopen-to-verify workflow and the "updates apply on next load, not two
// loads later" guarantee the original network-first deliberately chose. This
// races the network against a short timeout: on a normal connection you get the
// FRESH file (updates apply immediately); only when the network is slower than
// TIMEOUT do we serve the versioned cache instantly (the speed win on bad
// connections), refreshing the cache in the background for next time.
async function networkFirstTimeout(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  const net = fetch(request).then(r => { if (r && r.ok) cache.put(request, r.clone()); return r; }).catch(() => null);
  // Look in the named cache first, then fall back to a cross-cache lookup.
  // THIS SECOND LOOKUP IS LOAD-BEARING for the HTML route: navigations are
  // written to RUNTIME, but the app shell ('/', '/index.html', '/track.html',
  // '/t/', '/v/') is pre-cached into STATIC by install(). A RUNTIME-only match
  // would therefore MISS the pre-cached shell and hand back the 503 below on
  // the first offline load after an install — exactly the load the precache
  // exists to serve. networkFirst() has always used the cross-cache
  // caches.match(); matching that here is what makes HTML safe to move onto
  // this strategy. Harmless for the JS/CSS route, which passes STATIC and so
  // already hits on the first lookup.
  const cached = (await cache.match(request)) || (await caches.match(request));
  if (!cached) {
    // Same offline body/headers networkFirst() has always returned, so the
    // no-cache-no-network case is unchanged for callers migrating onto this.
    return (await net) || new Response('Offline — content not available', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
  // race: whichever of {fresh network, timeout} wins
  const winner = await Promise.race([
    net,
    new Promise(res => setTimeout(() => res('__timeout__'), timeoutMs)),
  ]);
  if (winner && winner !== '__timeout__') return winner;   // network was fast → fresh
  return cached;                                            // slow network → instant cache (net still refreshes in bg)
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
