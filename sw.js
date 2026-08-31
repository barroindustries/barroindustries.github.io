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
const CACHE_VER = 'bi-ops-v14.0.228';
const STATIC      = `${CACHE_VER}-static`;
const RUNTIME     = `${CACHE_VER}-runtime`;

// Core app shell — pre-cached on install so first load is instant after SW installs
// FORMAT CONTRACT: keep every entry a single-quoted string literal, one per line.
// .githooks/pre-commit parses this array with sed+grep to generate
// precache-manifest.json — double quotes, concatenation, or computed entries
// would silently break manifest generation (the hook exits loudly on zero
// entries, but partial matches could under-extract).
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
  '/js/calendar-feed.js',
  '/js/svc-approvals.js',
  '/js/ui-crud-table.js',
  '/js/money-core.js',
  '/js/pay-policy.js',
  '/js/statutory-status.js',
  '/js/geo-core.js',
  '/js/departments.js',
  '/js/screens/design.js',
  '/js/screens/tasks.js',
  '/js/screens/sales.js',
  '/js/screens/crm.js',
  '/js/screens/ventures.js',
  '/js/screens/hr.js',
  '/js/screens/employee-profile.js',
  // Weekly pay run engine — matching index.html's order. Statically
  // referenced there, so ci-invariants.sh CHECK 2 requires it here.
  // PAYROLL-LIVE-SPEC-2026-08-11 §8 (2026-08-12) — its screen,
  // js/screens/payroll-weekly-ui.js, is retired (superseded by
  // js/screens/payroll.js) and removed from here and from index.html.
  '/js/payroll-weekly.js',
  // UNIFIED PAYROLL (PAYROLL-REDESIGN-BRIEF.md) — engine, screen, backfill.
  // Statically referenced by index.html in this order, right after the weekly
  // pair above, so ci-invariants.sh CHECK 2 requires all three here.
  '/js/payroll.js',
  '/js/screens/payroll.js',
  '/js/screens/payroll-backfill.js',
  // PAYSLIP-OVERHAUL-SPEC.md §4 — lazy-loaded (NOT in index.html's static
  // script list — see hr.js's _ensureHtml2Canvas/_ensurePdfLite), but still
  // precached so Save-as-JPEG/Print-Save-PDF work offline once cached.
  '/js/vendor/html2canvas.min.js',
  '/js/pdf-lite.js',
  '/js/screens/production.js',
  '/js/screens/inventory.js',
  '/js/screens/finance.js',
  '/js/screens/dept-budgets.js',
  '/js/screens/statutory-rates.js',
  '/js/screens/approvals.js',
  '/js/screens/govit.js',
  '/js/screens/partners.js',
  '/js/migrations.js',
  '/js/app.js',
  '/js/modules.js',
  '/js/screens/people.js',
  '/js/screens/notes.js',
  '/js/screens/dashboards.js',
  '/js/screens/layoff.js',
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
// Deploy-diff precache (PERF-WAVE1 WP2): a deploy that changes 3 files should
// cost users ~those 3 files, not the whole ~1.6 MB gz PRECACHE list.
// .githooks/pre-commit generates precache-manifest.json — one sha1 per
// PRECACHE path — after every version bump. On install we diff THIS
// install's manifest against the PREVIOUS install's manifest (stashed inside
// the outgoing STATIC cache under PRECACHE_MANIFEST_CACHE_KEY) and, for any
// entry whose hash is unchanged, copy the Response straight from the old
// cache into the new one — zero network. Only genuinely changed files, plus
// the app-shell documents (which pin the running app version and must never
// be served stale), hit the network. Any problem with the current manifest
// (fetch/parse failure) degrades to the pre-WP2 behavior: a plain
// cache.addAll(PRECACHE).
const PRECACHE_MANIFEST_URL = '/precache-manifest.json';
const PRECACHE_MANIFEST_CACHE_KEY = '/__precache-manifest__';
// Documents pin the app version (index.html carries the vX.Y.Z footer string
// and decides which SW registers next) — always fetch these fresh even when
// their hash is unchanged, so a deploy's HTML is never served from a
// copy-forwarded cache entry.
const PRECACHE_ALWAYS_FRESH = ['/', '/index.html', '/t/', '/t/index.html', '/v/', '/v/index.html'];

self.addEventListener('install', event => {
  event.waitUntil(
    precacheDeployDiff().catch(err => {
      console.warn('[SW] Deploy-diff precache failed, falling back to wholesale cache.addAll:', err);
      return caches.open(STATIC).then(cache =>
        cache.addAll(PRECACHE).catch(err2 => console.warn('[SW] Pre-cache partial fail:', err2))
      );
    })
  );
});

// Locate the newest previous bi-ops-*-static cache. There's realistically at
// most one lying around — activate() prunes down to exactly {STATIC,
// RUNTIME} after every install/activate cycle — but pick the highest version
// defensively (e.g. a prior activate() never completed because the tab
// closed mid-cycle).
async function findPrevStaticCache() {
  const names = (await caches.keys()).filter(n => n.endsWith('-static') && n !== STATIC);
  if (!names.length) return null;
  names.sort((a, b) => {
    const va = (a.match(/bi-ops-v(\d+)\.(\d+)\.(\d+)-static$/) || []).slice(1).map(Number);
    const vb = (b.match(/bi-ops-v(\d+)\.(\d+)\.(\d+)-static$/) || []).slice(1).map(Number);
    if (va.length !== 3 || vb.length !== 3) return a < b ? -1 : 1; // unrecognized name shape → best-effort lexical
    for (let i = 0; i < 3; i++) { if (va[i] !== vb[i]) return va[i] - vb[i]; }
    return 0;
  });
  return names[names.length - 1];
}

async function precacheDeployDiff() {
  // no-store: this must reflect what's actually on the server for THIS
  // deploy, never an HTTP-cached or SW-cached copy of an older manifest.
  const manifestRes = await fetch(PRECACHE_MANIFEST_URL, { cache: 'no-store' });
  if (!manifestRes || !manifestRes.ok) {
    throw new Error('precache-manifest.json fetch failed: ' + (manifestRes && manifestRes.status));
  }
  const manifest = await manifestRes.json();
  if (!manifest || typeof manifest.files !== 'object' || manifest.files === null) {
    throw new Error('precache-manifest.json malformed: missing .files object');
  }

  const newCache = await caches.open(STATIC);

  const prevStaticName = await findPrevStaticCache();
  const prevCache = prevStaticName ? await caches.open(prevStaticName) : null;
  const prevManifestRes = prevCache ? await prevCache.match(PRECACHE_MANIFEST_CACHE_KEY) : null;
  const prevManifest = prevManifestRes ? await prevManifestRes.json().catch(() => null) : null;

  if (!prevCache || !prevManifest || typeof prevManifest.files !== 'object') {
    // No previous manifest to diff against — either this is the first
    // install to ship this feature, or the prior cache was already pruned.
    // Nothing to copy forward, so fetch the whole PRECACHE list wholesale —
    // identical to pre-WP2 behavior, including the partial-failure tolerance.
    await newCache.addAll(PRECACHE).catch(err => console.warn('[SW] Pre-cache partial fail:', err));
  } else {
    // Every path handles its own failure and the aggregate NEVER rejects.
    // A bare Promise.all here would fail fast on one bad fetch, triggering
    // install()'s wholesale-addAll fallback while this loop's still-running
    // siblings keep writing into the same cache unsupervised — install could
    // then report success with an unpredictable subset cached. Per-path
    // try/catch keeps the outcome deterministic: good entries land, bad ones
    // are warned and skipped (the runtime network-first strategy still serves
    // them while online), and no fallback ever races this loop.
    const results = await Promise.all(PRECACHE.map(async path => {
      try {
        const newHash = manifest.files[path];
        const oldHash = prevManifest.files[path];
        const canCopyForward = !!newHash && !!oldHash && newHash === oldHash && !PRECACHE_ALWAYS_FRESH.includes(path);
        if (canCopyForward) {
          const oldResponse = await prevCache.match(path);
          if (oldResponse) {
            await newCache.put(path, oldResponse.clone());
            return true;
          }
          // Hash matched but the old cache didn't actually have the response
          // (e.g. a partial previous install) — fall through to a fresh fetch.
        }
        const res = await fetch(path);
        if (res && res.ok) {
          await newCache.put(path, res.clone());
          return true;
        }
        console.warn('[SW] Precache fetch failed for', path, res && res.status);
        return false;
      } catch (err) {
        console.warn('[SW] Precache entry failed for', path, err);
        return false;
      }
    }));
    const missing = results.filter(ok => !ok).length;
    if (missing) console.warn('[SW] Deploy-diff precache completed with', missing, 'missing entries (will self-heal via runtime caching / next install)');
  }

  // Stash THIS install's manifest so the NEXT install can diff against it.
  await newCache.put(
    PRECACHE_MANIFEST_CACHE_KEY,
    new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } })
  );
}

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
