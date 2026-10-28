// tests/lazy-script-versioning.test.mjs — lazy page scripts are cache-busted per release (2026-10-29).
//
// After the v14.0.345 deploy a reloaded tab ran the NEW app shell with the OLD js/screens/family-pricing.js, js/qr-families.js and
// js/pricing-core.js: js/config.js's ensureScript injected them as bare URLs, GitHub Pages sends max-age=600, so the browser served the
// previous release's copies from its HTTP cache for up to 10 minutes. The fix: every local lazy src carries ?v=APP_VERSION.
//
// WHAT IT PINS
//   1. LOADER     js/config.js evaluated in a vm with a recording document: window.ensurePage(page) for EVERY PAGE_SCRIPTS key injects each file
//                 as <file>?v=<APP_VERSION>; a second call reuses the bare-path promise (no second tag); absolute and already-queried URLs are
//                 left untouched.
//   2. SW         sw.js's JS/CSS route opts into the ignoreSearch fallback (so a versioned lazy request still finds its bare PRECACHE copy
//                 offline), and every install-time precache fetch revalidates (cache: 'no-cache') instead of reading the browser's HTTP cache.
//   3. PRECACHE   every PAGE_SCRIPTS file is still in sw.js PRECACHE as its bare '/path' (what the ignoreSearch fallback matches).
//   4. APP KIT    every local <script> in index.html's app-kit carries ?v=<APP_VERSION> and is precached under that exact URL; the pre-commit hook
//                 rewrites js/*.js?v= in index.html and sw.js; sw.js's deploy-diff compares entries by bare path (so a per-release ?v= does not
//                 re-download every unchanged kit file) and reads the old response back under its exact old key.
//   5. BUILDER    js/app.js opens the quote builder as quote-builder-v2.html?v=APP_VERSION (&co=BS…); the builder's one-line loader writes its six
//                 local scripts, in the old order, with that ?v= (bare when opened without one, and never with a non-version value); sw.js's
//                 HTML route has the same ignoreSearch fallback across caches, so the versioned iframe URL still opens offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadConfig() {
  const injected = [];
  const document = {
    createElement: () => ({}),
    head: { appendChild(s) { injected.push(s.src); Promise.resolve().then(() => s.onload && s.onload()); } },
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node' },
    location: { search: '', hash: '', href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
    addEventListener() {},
  };
  sandbox.window = sandbox; sandbox.sessionStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  vm.runInContext(read('js/config.js'), sandbox, { filename: 'js/config.js' });
  return { win: sandbox.window, injected };
}

describe('js/config.js ensureScript — lazy page scripts carry ?v=APP_VERSION', () => {
  it('every PAGE_SCRIPTS file of every page is requested as <file>?v=<APP_VERSION>', async () => {
    const { win, injected } = loadConfig();
    assert.match(win.APP_VERSION, /^\d+\.\d+\.\d+$/);
    const want = new Set();
    for (const [page, files] of Object.entries(win.PAGE_SCRIPTS)) {
      await win.ensurePage(page);
      for (const f of files) want.add(`${f}?v=${win.APP_VERSION}`);
    }
    assert.ok(want.size > 10, 'PAGE_SCRIPTS looks empty');
    assert.deepEqual([...injected].sort(), [...want].sort(), 'a lazy script was injected without the version query (or injected twice)');
    for (const f of ['js/screens/family-pricing.js', 'js/qr-families.js', 'js/pricing-core.js']) {
      assert.ok(injected.includes(`${f}?v=${win.APP_VERSION}`), `${f} (the 2026-10-29 stale file) is not versioned`);
    }
  });
  it('a repeat call shares the bare-path promise; absolute and already-queried URLs are untouched', async () => {
    const { win, injected } = loadConfig();
    const p = win.ensureScript('js/qrcode.js');
    assert.equal(win.ensureScript('js/qrcode.js'), p);
    await p;
    assert.deepEqual(injected, [`js/qrcode.js?v=${win.APP_VERSION}`]);
    assert.equal(win.versionedSrc('https://cdn.example/x.js'), 'https://cdn.example/x.js');
    assert.equal(win.versionedSrc('//cdn.example/x.js'), '//cdn.example/x.js');
    assert.equal(win.versionedSrc('js/x.js?v=1'), 'js/x.js?v=1');
  });
});

describe('sw.js agrees with versioned lazy scripts', () => {
  const sw = read('sw.js');
  it('the JS/CSS route falls back to the bare precached copy (ignoreSearch) and precache fetches revalidate', () => {
    assert.match(sw, /\['js','css'\]\.includes\(ext\)\)\s*\{\s*event\.respondWith\(networkFirstTimeout\(event\.request, STATIC, \d+, true\)\)/);
    assert.match(sw, /async function networkFirstTimeout\(request, cacheName, timeoutMs, ignoreSearch\)/);
    assert.match(sw, /ignoreSearch \? await caches\.match\(request, \{ ignoreSearch: true \}\)/);
    assert.match(sw, /new Request\(path, \{ cache: 'no-cache' \}\)/);
    assert.ok(!/\.addAll\(PRECACHE\)\.catch/.test(sw), 'a precache addAll reads the HTTP cache again');
    assert.ok(/await fetch\(freshRequest\(path\)\)/.test(sw) && !/await fetch\(path\)/.test(sw), 'the deploy-diff precache fetch reads the HTTP cache again');
  });
  it('every PAGE_SCRIPTS file is precached under its bare path', () => {
    const { win } = loadConfig();
    const precache = new Set([...sw.slice(sw.indexOf('const PRECACHE = ['), sw.indexOf('\n];', sw.indexOf('const PRECACHE = ['))).matchAll(/'(\/[^']*)'/g)].map((m) => m[1]));
    for (const files of Object.values(win.PAGE_SCRIPTS)) for (const f of files) assert.ok(precache.has('/' + f), `/${f} is not in sw.js PRECACHE`);
  });
});

describe('index.html app-kit scripts carry ?v=APP_VERSION (2026-10-29)', () => {
  const html = read('index.html');
  const kit = html.slice(html.indexOf('<template id="app-kit">'), html.indexOf('</template>'));
  const local = [...kit.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script defer src="(js\/[^"]+)"><\/script>/g)].map((m) => m[1]);
  it('every local kit script is versioned with the current APP_VERSION and precached under that exact URL', () => {
    const { win } = loadConfig();
    const sw = read('sw.js');
    assert.ok(local.length >= 20, 'kit scripts not found');
    for (const src of local) {
      assert.equal(src, `${src.split('?')[0]}?v=${win.APP_VERSION}`, `${src} is not versioned with APP_VERSION ${win.APP_VERSION}`);
      assert.ok(sw.includes(`'/${src}'`), `/${src} is not in sw.js PRECACHE with the same ?v=`);
    }
  });
  it('the pre-commit hook rewrites js/*.js?v= in index.html and sw.js', () => {
    const hook = read('.githooks/pre-commit');
    assert.ok(hook.includes('for _jsfile in "$INDEX" "$SW"; do'), 'the JS cache-bust loop is gone');
    assert.ok(hook.includes('s#(js/[A-Za-z0-9_./-]+\\.js)\\?v=[0-9][0-9.]*#\\1?v=${NEW_VERSION}#g'), 'the JS cache-bust sed changed');
  });
  it("sw.js's deploy-diff compares by bare path and copies forward under the exact old key", () => {
    const sw = read('sw.js');
    assert.match(sw, /const oldKey = prevKeyByBare\[bare\(path\)\];/);
    assert.match(sw, /const oldHash = oldKey && prevManifest\.files\[oldKey\];/);
    assert.match(sw, /await prevCache\.match\(oldKey\)/);
  });
});

describe('the quote builder loads its scripts with the app version (2026-10-29)', () => {
  const qb = read('quote-builder-v2.html');
  const loader = (qb.match(/<script>(\(function\(\)\{var v=new URLSearchParams[^\n]*?)<\/script>\n/) || [])[1];
  const run = (search) => {
    const written = [];
    vm.runInNewContext(loader, { location: { search }, URLSearchParams, document: { write: (h) => written.push(h) } });
    return written;
  };
  const FILES = ['js/firebase-config.js', 'js/letterhead.js', 'js/pricing-core.js', 'js/qr-families.js', 'js/product-families.js', 'js/qb-configured.js'];
  it('the loader writes the six local scripts in order with ?v=, bare without one, and refuses a non-version value', () => {
    assert.ok(loader, 'the builder\'s script loader is gone');
    assert.deepEqual(run('?v=14.0.999&co=BS'), FILES.map((f) => `<script defer src="${f}?v=14.0.999"></script>`));
    assert.deepEqual(run(''), FILES.map((f) => `<script defer src="${f}"></script>`));
    assert.deepEqual(run('?v=%22%3E%3Cimg'), FILES.map((f) => `<script defer src="${f}"></script>`));
    assert.ok(!/<script defer src="js\//.test(qb), 'a local script tag is back outside the loader (it would load unversioned)');
    assert.ok(qb.indexOf(loader) < qb.indexOf('<script>\n'), 'the loader must come before the builder\'s main inline script');
  });
  it('js/app.js opens the builder with ?v=APP_VERSION and appends its other params with &', () => {
    const app = read('js/app.js');
    assert.ok(app.includes("let qbSrc = 'quote-builder-v2.html?v=' + encodeURIComponent(window.APP_VERSION);"));
    assert.ok(app.includes("if (window.currentPage === 'bs-quote-builder') qbSrc += '&co=BS';"));
  });
  it("sw.js's HTML route has the ignoreSearch fallback, looking across caches (the shell is precached in STATIC)", () => {
    const sw = read('sw.js');
    assert.match(sw, /networkFirstTimeout\(event\.request, RUNTIME, 3000, true\)/);
    assert.match(sw, /ignoreSearch \? await caches\.match\(request, \{ ignoreSearch: true \}\)/);
  });
});
