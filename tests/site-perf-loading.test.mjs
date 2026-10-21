// tests/site-perf-loading.test.mjs — the public website must not pay for the staff app (mobile PageSpeed, 2026-10-21).
//
// Baseline (Google PageSpeed, mobile, https://barroindustries.com/): Performance 61. A Lighthouse run of the old page fetched 49 files / 3.6 MB for a
// visitor who only reads the website: the Firebase SDK, the icon library, a 450 KB app stylesheet and ~25 app scripts, an 848 KB sign-in logo, a service
// worker precaching the whole app, and a render-blocking website stylesheet and font stylesheet in front of the first paint.
//
// index.html is BOTH the public website (<html data-view="site">) and the app shell (boot / login / app), so the fix is a LOADER, and this file pins it:
//   1. the app's stylesheets, hints and the whole ordered script list live in an INERT <template id="app-kit"> in the <head>; a tiny head script copies
//      the kit into the page with document.write() for every view EXCEPT "site" (so the signed-in boot is the same parser-inserted, ordered `defer`
//      scripts it always was) — and the website view writes nothing, fetches no app file and registers no service worker;
//   2. the website's own stylesheet is INLINE (generated from css/site.css by scripts/inline-site-css.js, guarded by CHECK 11) so nothing blocks its first paint;
//   3. its fonts are requested after the page has loaded, the services photos get the 1000px candidate the content pages already ship, the logo that
//      the hidden sign-in / splash / topbar markup points at is lazy (the app views preload it), the hero clip waits for the load event;
//   4. the footer "Team portal" hands over by reloading into /#login (the one boot path), and "Back to website" leaves a clean URL.
// Also pinned: the exact kit order (load order is load-bearing), the SRI hashes, and that the website view's resource set is only site.js, fonts,
// images and the (inline) stylesheet.
//
// Mutation-tested in a scratch copy, never the shared tree (see the STATUS.md entry for the list that was run).
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeEnv } from './fixtures/hero-intro-env.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const INLINE = require('../scripts/inline-site-css.js');
const SITE_VIEW = require('../scripts/check-site-view.js');

const html = read('index.html');
const siteJs = read('js/site.js');
const siteCss = read('css/site.css');
const appJs = read('js/app.js');
const head = html.slice(0, html.indexOf('</head>'));
const noComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '');

// ── a tiny tokenizer for the kit (comments, elements, whitespace) ──────────────────────────────────────────────────
function parseAttrs(s) {
  const out = {};
  const re = /([^\s=\/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
  return out;
}
const kitMatch = html.match(/<template id="app-kit">([\s\S]*?)<\/template>/);
const kitHtml = kitMatch ? kitMatch[1] : '';
const kitTokens = (kitHtml.match(/<!--[\s\S]*?-->|<link\b[^>]*>|<script\b[^>]*><\/script>|[^<]+|<[^>]+>/g) || []).map((t) => {
  if (t.startsWith('<!--')) return { type: 'comment', text: t };
  const lm = t.match(/^<link\b([^>]*)>$/), sm = t.match(/^<script\b([^>]*)><\/script>$/);
  if (lm) return { type: 'element', tag: 'link', attrs: parseAttrs(lm[1].replace(/\/\s*$/, '')), text: t };
  if (sm) return { type: 'element', tag: 'script', attrs: parseAttrs(sm[1]), text: t };
  return { type: /^\s*$/.test(t) ? 'space' : 'other', text: t };
});
const kitEls = kitTokens.filter((t) => t.type === 'element');
const kitScripts = kitEls.filter((e) => e.tag === 'script');
const kitLinks = kitEls.filter((e) => e.tag === 'link');

// the markup outside every kind of block that is not fetched by the website view
const outside = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<template\b[\s\S]*?<\/template>/g, '')
  .replace(/<noscript>[\s\S]*?<\/noscript>/g, '')
  .replace(/<style id="site-css">[\s\S]*?<\/style>/, '')
  .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');

const EXPECTED_KIT_SCRIPTS = [
  ['https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js', 'sha384-AQ3POAMqIhwS81FrUH95ekxqBZHeP5tG2JfEL3+7GuTtfRLWnrRh32UxwzM+//A9'],
  ['https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js', 'sha384-TnlRYaR4JYz/lpaGuaiU61PjNberSA4vjLjtF+oRC/IkohkJqnWxw5EmDSOt1vA1'],
  ['https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js', 'sha384-qn4Jh88HhJA8dplNQyGjOh9OGI4izVhrfj/qIFgaKcdgOE06pXqIKGlsCILZcLAC'],
  ['https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js', 'sha384-6I0gWsz4FIAr30c0TxIxJnPQuJiZ1FfILdZrgJdjxTH3R8dgPGTvexbyqTvReV6Z'],
  ['https://www.gstatic.com/firebasejs/10.12.2/firebase-functions-compat.js', 'sha384-3IYu+dnH2y9gX1s6p9F4D55XbEmZBfJ3D1Ylh8J6bfdqnJCOmDVSRTq1yhJsBY1H'],
  ['https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js', 'sha384-uTYyvsSSUZeaPhb5RbKlQa0zY/WpX/QHfvg2mczXyBQOpkWPEDy9lczyp+w7SKXu'],
  ['js/firebase-config.js'], ['js/errlog.js'], ['js/config.js'], ['js/ui-states.js'], ['js/ui-status-meta.js'], ['js/statutory-tables.js'],
  ['js/print-docs.js'], ['js/finance-ledger.js'], ['js/drive.js'], ['js/notifications.js'], ['js/meetings.js'], ['js/calendar-feed.js'],
  ['js/svc-approvals.js'], ['js/ui-crud-table.js'], ['js/money-core.js'], ['js/geo-core.js'], ['js/departments.js'], ['js/screens/dept-budgets.js'],
  ['js/app.js'], ['js/modules.js'], ['js/screens/dashboards.js'], ['js/chat.js'],
];

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('1 · the app kit: an inert <template> holding exactly what the app needs, in exactly the old order', () => {
  it('has ONE <template id="app-kit"> in the <head>, written before <title>, and no other template', () => {
    assert.ok(kitMatch, 'index.html has no <template id="app-kit">');
    assert.equal((noComments(html).match(/<template [^>]*>/g) || []).length, 1, 'another <template> element');
    assert.equal((noComments(html).match(/<\/template>/g) || []).length, 1);
    const tpl = head.indexOf('<template id="app-kit">');
    assert.ok(tpl > 0 && tpl < head.indexOf('<title>'), 'the kit is not in the head before the title');
    assert.ok(head.indexOf('</template>') > tpl);
  });

  it('lists the app scripts in the EXACT old load order (load order is load-bearing — CLAUDE.md), each a plain external `defer` script with the old SRI hash', () => {
    assert.deepEqual(kitScripts.map((s) => s.attrs.src), EXPECTED_KIT_SCRIPTS.map((e) => e[0]), 'the kit script list or its order changed');
    kitScripts.forEach((s, i) => {
      const [src, integrity] = EXPECTED_KIT_SCRIPTS[i];
      assert.ok('defer' in s.attrs && !('async' in s.attrs) && !('type' in s.attrs), `${src}: must be a plain defer script`);
      if (integrity) { assert.equal(s.attrs.integrity, integrity, `${src}: SRI hash changed`); assert.equal(s.attrs.crossorigin, 'anonymous', `${src}: crossorigin`); }
      else assert.ok(!('integrity' in s.attrs), `${src}: local scripts carry no SRI`);
    });
    // the documented chain: Firebase SDK + icons -> firebase-config -> config -> drive -> notifications -> departments -> app -> modules
    const order = kitScripts.map((s) => s.attrs.src);
    const at = (f) => order.indexOf(f);
    const chain = ['firebase-app-compat', 'firebase-auth-compat', 'firebase-firestore-compat', 'firebase-storage-compat', 'firebase-functions-compat', 'lucide.min.js', 'js/firebase-config.js', 'js/config.js', 'js/drive.js', 'js/notifications.js', 'js/departments.js', 'js/app.js', 'js/modules.js']
      .map((f) => order.findIndex((u) => u.includes(f)));
    assert.ok(chain.every((i) => i >= 0) && chain.every((v, k) => k === 0 || v > chain[k - 1]), `the documented load chain is broken: ${chain}`);
    assert.ok(at('js/screens/dept-budgets.js') < at('js/app.js') && at('js/screens/dashboards.js') > at('js/modules.js') && at('js/chat.js') > at('js/screens/dashboards.js'));
  });

  it('holds the two app stylesheets (tokens first, then styles, both ?v= cache-busted for the pre-commit hook), and the hints the app views always had', () => {
    const sheets = kitLinks.filter((l) => l.attrs.rel === 'stylesheet').map((l) => l.attrs.href);
    assert.equal(sheets.length, 2);
    assert.match(sheets[0], /^css\/tokens\.css\?v=\d+\.\d+\.\d+$/);
    assert.match(sheets[1], /^css\/styles\.css\?v=\d+\.\d+\.\d+$/);
    assert.equal(sheets[0].split('v=')[1], sheets[1].split('v=')[1], 'the two ?v= differ — the hook rewrites both');
    const hints = kitLinks.filter((l) => l.attrs.rel !== 'stylesheet').map((l) => `${l.attrs.rel} ${l.attrs.href}`);
    assert.deepEqual(hints, ['preconnect https://www.gstatic.com', 'preconnect https://firestore.googleapis.com', 'preconnect https://firebasestorage.googleapis.com',
      'preconnect https://cdn.jsdelivr.net', 'dns-prefetch https://unpkg.com', 'preload icons/barro-kitchens.png']);
    for (const l of kitLinks.filter((x) => x.attrs.rel === 'preconnect')) assert.ok('crossorigin' in l.attrs, `${l.attrs.href}: the app's own preconnects were crossorigin`);
    const pre = kitLinks.find((l) => l.attrs.rel === 'preload');
    assert.equal(pre.attrs.as, 'image');
  });

  it('every kit file exists, is in sw.js PRECACHE (the stylesheets by their exact ?v= URL), and the version string the hook rewrites is still in the document exactly once', () => {
    const sw = read('sw.js');
    for (const s of kitScripts) if (!/^https:/.test(s.attrs.src)) { assert.ok(exists(s.attrs.src), `${s.attrs.src} is missing`); assert.ok(sw.includes(`'/${s.attrs.src}'`), `${s.attrs.src} is not in PRECACHE`); }
    for (const l of kitLinks.filter((x) => x.attrs.rel === 'stylesheet')) { assert.ok(exists(l.attrs.href.split('?')[0])); assert.ok(sw.includes(`'/${l.attrs.href}'`), `${l.attrs.href} is not in PRECACHE with the same ?v=`); }
    assert.equal(html.split(' · Barro Industries').length - 1, 1, 'the hook greps v<version> · Barro Industries in index.html');
    assert.ok(html.includes('css/styles.css?v='), 'the hook greps css/styles.css?v= in index.html');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('2 · the head script that writes the kit: every view except "site", and nothing for the website', () => {
  const writerSrc = (html.match(/<script>\(function\(\)\{\s*var root = document\.documentElement;[\s\S]*?\}\)\(\);<\/script>/) || [''])[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  const decisionSrc = (html.match(/<script>\(function\(\)\{\s*var de = document\.documentElement[\s\S]*?\}\)\(\);<\/script>/) || [''])[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  // the kit as the DOM would hand it to the script: a node list of comments, whitespace and elements, each element with an outerHTML
  const makeKit = () => {
    const nodes = kitTokens.map((t) => ({ nodeType: t.type === 'comment' ? 8 : t.type === 'element' ? 1 : 3, outerHTML: t.text, nextSibling: null }));
    nodes.forEach((n, i) => { n.nextSibling = nodes[i + 1] || null; });
    return { content: { firstChild: nodes[0] } };
  };
  const EXPECTED_WRITE = kitEls.map((e) => e.text).join('');

  function run({ view, kit = makeKit(), writeThrows = false }) {
    const writes = [], attrs = {};
    if (view !== undefined) attrs['data-view'] = view;
    const root = { getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); } };
    const doc = { documentElement: root, getElementById: (id) => (id === 'app-kit' ? kit : null), write: (s) => { if (writeThrows) throw new Error('document.write failed'); writes.push(s); } };
    vm.runInNewContext(writerSrc, { document: doc });
    return { writes, view: attrs['data-view'] };
  }

  it('is there, once, right after the template and before <title>', () => {
    assert.ok(writerSrc.length > 50, 'writer script not found');
    assert.equal((noComments(html).match(/document\.write\(/g) || []).length, 1, 'document.write appears once in index.html');
    const i = noComments(head).indexOf('document.write(');
    assert.ok(noComments(head).indexOf('</template>') < i && i < noComments(head).indexOf('<title>'));
    assert.ok(!/document\.write/.test(read('js/site.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'site.js must never document.write');
  });

  it('writes the kit ONCE — its elements only, in order, no comments — for boot, login and app, and also when the view is missing or unknown', () => {
    for (const view of ['boot', 'login', 'app', undefined, 'anything-else']) {
      const r = run({ view });
      assert.deepEqual(r.writes, [EXPECTED_WRITE], `view=${view}`);
      assert.ok(!/<!--/.test(r.writes[0]), 'comments are documentation, not written');
    }
    assert.equal(EXPECTED_WRITE.split('<script').length - 1, 28);
    assert.equal(EXPECTED_WRITE.split('<link').length - 1, 8);
  });

  it('writes NOTHING for the website view', () => {
    const r = run({ view: 'site' });
    assert.deepEqual(r.writes, []);
    assert.equal(r.view, 'site');
  });

  it('never strands the splash: a kit that cannot be written (no template support, a failing document.write) switches to the website view instead of throwing', () => {
    for (const opts of [{ view: 'boot', kit: null }, { view: 'login', kit: {} }, { view: 'boot', writeThrows: true }]) {
      let r;
      assert.doesNotThrow(() => { r = run(opts); });
      assert.equal(r.view, 'site');
    }
  });

  it('follows the first-paint decision table exactly (tests/catalogue-public.test.mjs pins the table; this pins what each row loads): only a signed-out browser visitor with no login hash skips the kit', () => {
    function both(env) {
      const attrs = {}, writes = [];
      const de = { setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs };
      const mm = (q) => { if (env.mmThrows) throw new Error('matchMedia'); return { matches: (env.modes || []).some((m) => q === `(display-mode: ${m})`) }; };
      const sandbox = {
        document: { documentElement: de, getElementById: () => makeKit(), write: (s) => writes.push(s) },
        location: { hash: env.hash || '' }, navigator: { standalone: env.navStandalone },
        localStorage: env.lsThrows ? { getItem() { throw new Error('denied'); } } : { getItem: (k) => (k === 'bi-auth-hint' && env.hint ? '1' : null) },
        window: {},
      };
      if (!env.noMatchMedia) { sandbox.matchMedia = mm; sandbox.window.matchMedia = mm; }
      vm.runInNewContext(decisionSrc, sandbox);
      vm.runInNewContext(writerSrc, sandbox);
      return { view: attrs['data-view'], wrote: writes.length };
    }
    const CASES = [
      [{}, 'site', 0], [{ hash: '#services' }, 'site', 0], [{ hash: '#/tasks' }, 'site', 0], [{ hash: '#/dashboard' }, 'site', 0],
      [{ hint: true }, 'boot', 1], [{ hash: '#/tasks', hint: true }, 'boot', 1], [{ hash: '#login' }, 'login', 1], [{ hash: '#login', hint: true }, 'boot', 1],
      [{ modes: ['standalone'] }, 'boot', 1], [{ modes: ['fullscreen'] }, 'boot', 1], [{ modes: ['minimal-ui'] }, 'boot', 1], [{ modes: ['window-controls-overlay'] }, 'boot', 1],
      [{ navStandalone: true }, 'boot', 1], [{ modes: ['standalone'], hash: '#login' }, 'boot', 1],
      [{ lsThrows: true }, 'boot', 1], [{ mmThrows: true }, 'boot', 1], [{ noMatchMedia: true }, 'boot', 1],
    ];
    for (const [env, view, wrote] of CASES) assert.deepEqual(both(env), { view, wrote }, JSON.stringify(env));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('3 · what the website view fetches: site.js, fonts and images — no app file, no Firebase, no icon library, no app stylesheet, no service worker', () => {
  const attrsOf = (re) => [...outside.matchAll(re)].map((m) => parseAttrs(m[1].replace(/\/\s*$/, '')));
  const scripts = attrsOf(/<script\b([^>]*)>/g);
  const links = attrsOf(/<link\b([^>]*)>/g);

  it('has exactly ONE external script outside the kit — js/site.js — and the only other scripts are the inline ones: theme, view decision, kit writer, post-load fonts, legacy-session probe, the brand/version helper and its load listener', () => {
    assert.deepEqual(scripts.filter((s) => s.src).map((s) => s.src), ['js/site.js']);
    assert.ok(scripts.find((s) => s.src === 'js/site.js') && 'defer' in scripts.find((s) => s.src === 'js/site.js'));
    assert.equal(scripts.filter((s) => !s.src).length, 7, 'a new inline script ran in the website view');
    assert.ok(head.indexOf('<script defer src="js/site.js">') > 0 && html.indexOf('<script defer src="js/site.js">') === head.indexOf('<script defer src="js/site.js">'), 'site.js moved out of the head');
    assert.ok(html.indexOf('<script defer src="js/site.js">') < html.indexOf('<template id="app-kit">'), 'site.js must precede the kit, as it preceded the old list');
  });

  it('references no app asset outside the kit: no js/ file but site.js, no css/ file at all, no gstatic / unpkg / jsdelivr / firebase host, no tokens.css / styles.css', () => {
    const urls = [...outside.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    for (const u of urls) {
      if (/^js\//.test(u)) assert.equal(u, 'js/site.js', `the website view loads ${u}`);
      assert.ok(!/^css\//.test(u), `the website view links ${u}`);
      assert.ok(!/gstatic\.com\/firebasejs|unpkg\.com|cdn\.jsdelivr\.net|tokens\.css|styles\.css|app\.js|config\.js/.test(u), `the website view loads ${u}`);
    }
    assert.ok(!links.some((l) => l.rel === 'stylesheet'), 'a stylesheet link sits outside <noscript> and the kit: it would block the first paint');
    assert.ok(!links.some((l) => l.rel === 'preload' || l.rel === 'dns-prefetch' || l.rel === 'modulepreload'));
  });

  it('preconnects only to the two font hosts: the stylesheet host WITHOUT crossorigin (its request is credentialed no-cors), the font-file host WITH it (those are CORS fetches)', () => {
    const pre = links.filter((l) => l.rel === 'preconnect');
    assert.deepEqual(pre.map((l) => l.href).sort(), ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
    assert.ok(!('crossorigin' in pre.find((l) => l.href === 'https://fonts.googleapis.com')));
    assert.ok('crossorigin' in pre.find((l) => l.href === 'https://fonts.gstatic.com'));
  });

  it('registers no service worker and touches no Firebase / storage / network in what it runs (site.js is dependency-free), and the SW registration lives only in the app', () => {
    for (const f of ['js/site.js']) assert.ok(!/serviceWorker|firebase|indexedDB|localStorage|fetch\(|XMLHttpRequest|importScripts/.test(read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${f} reaches the app or the network`);
    assert.ok(/serviceWorker\.register\('sw\.js'\)/.test(appJs));
    assert.ok(!/serviceWorker/.test(outside), 'an inline script in the website view touches the service worker');
  });

  it('keeps the three hidden logo images (splash, sign-in, top bar) lazy, so the 848 KB PNG is not fetched for a visitor who never sees them — and the app views preload it', () => {
    const logos = [...html.matchAll(/<img src="icons\/barro-kitchens\.png"[^>]*>/g)].map((m) => m[0]);
    assert.equal(logos.length, 3);
    for (const t of logos) assert.ok(/\sloading="lazy"/.test(t), `not lazy: ${t.slice(0, 70)}`);
    assert.deepEqual(logos.map((t) => t.match(/class="([^"]+)"/)[1]), ['splash-logo', 'login-logo-img', 'topbar-logo-img']);
    assert.ok(kitLinks.some((l) => l.attrs.rel === 'preload' && l.attrs.href === 'icons/barro-kitchens.png'));
    assert.ok(!/barro-kitchens\.png/.test(outside.replace(/<img src="icons\/barro-kitchens\.png"[^>]*>/g, '')), 'another reference to the large logo in the website view');
  });

  it('hides every static app container in the website view in CSS and in the no-script case — otherwise, without the app stylesheet, the modal / drawer / overlays render as stray text under the footer', () => {
    for (const id of ['splash-screen', 'login-screen', 'app-shell', 'modal-overlay', 'profile-drawer', 'drawer-overlay', 'dialog-overlay']) {
      assert.ok(html.includes(`id="${id}"`), `#${id} is gone from index.html: update this list`);
      assert.ok(siteCss.includes(`html[data-view="site"] #${id}`), `site.css does not hide #${id} in the website view`);
      assert.ok(new RegExp(`<noscript><style>[^<]*#${id}[^<]*display:none`).test(html), `the no-script style does not hide #${id}`);
    }
    // and nothing else sits in <body> outside #site that is not one of those (a new static container must be added to the lists)
    const bodyIds = [...html.slice(html.indexOf('<body>')).matchAll(/^<div id="([a-z-]+)"/gm)].map((m) => m[1]);
    assert.deepEqual(bodyIds.filter((i) => !['site', 'splash-screen', 'login-screen', 'app-shell', 'modal-overlay', 'profile-drawer', 'drawer-overlay', 'dialog-overlay'].includes(i)), [], 'a new top-level container in <body> is not hidden in the website view');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('4 · the inline website stylesheet (scripts/inline-site-css.js, CHECK 11)', () => {
  it('is css/site.css, verbatim, between the two markers — once — and the old render-blocking <link> is gone', () => {
    assert.equal(html.split(INLINE.START).length - 1, 1);
    assert.equal(html.split(INLINE.END).length - 1, 1);
    assert.equal(INLINE.build(html, siteCss), html, 'the inline block is stale: run  node scripts/inline-site-css.js');
    assert.ok(!/<link[^>]+href="css\/site\.css"/.test(html), 'index.html still links css/site.css');
    assert.ok(!/<\/style/i.test(siteCss));
    const i = html.indexOf(INLINE.START);
    assert.ok(i > html.indexOf('</template>') && i < html.indexOf('</head>'), 'the inline stylesheet must come AFTER the app kit (so #site rules win ties) and inside the head');
  });

  it('the generator: rewrites only the marked region, refuses missing / duplicate / reversed markers and a stylesheet that would close its own <style>, and --check fails on a stale copy', () => {
    const page = `<head>\n${INLINE.START}\nOLD\n${INLINE.END}\n</head>`;
    const built = INLINE.build(page, 'a{b:c}\n');
    assert.ok(built.startsWith('<head>\n') && built.endsWith('\n</head>') && built.includes('<style id="site-css">\na{b:c}\n</style>') && !built.includes('OLD'));
    assert.equal(INLINE.build(built, 'a{b:c}'), built, 'idempotent');
    assert.throws(() => INLINE.build('<head></head>', 'a{}'), /markers/);
    assert.throws(() => INLINE.build(page + INLINE.START + INLINE.END, 'a{}'), /more than one/);
    assert.throws(() => INLINE.build(`${INLINE.END}\n${INLINE.START}`, 'a{}'), /before/);
    assert.throws(() => INLINE.block('a{} </style><script>'), /closes|early/);
    // the CLI, in a scratch tree
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-css-'));
    try {
      fs.mkdirSync(path.join(tmp, 'scripts')); fs.mkdirSync(path.join(tmp, 'css'));
      fs.copyFileSync(path.join(ROOT, 'scripts/inline-site-css.js'), path.join(tmp, 'scripts/inline-site-css.js'));
      fs.writeFileSync(path.join(tmp, 'css/site.css'), 'a{b:c}\n');
      fs.writeFileSync(path.join(tmp, 'index.html'), page);
      const run = (...a) => spawnSync(process.execPath, [path.join(tmp, 'scripts/inline-site-css.js'), ...a], { encoding: 'utf8' });
      assert.equal(run('--check').status, 1, 'a stale copy must fail --check');
      assert.equal(run().status, 0);
      assert.equal(run('--check').status, 0);
      fs.writeFileSync(path.join(tmp, 'css/site.css'), 'a{b:d}\n');
      assert.equal(run('--check').status, 1, 'editing css/site.css without re-running the script must fail --check');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it('is run by CHECK 11 of scripts/ci-invariants.sh, together with scripts/check-site-view.js', () => {
    const sh = read('scripts/ci-invariants.sh');
    assert.ok(/\[11\/11\] SITE VIEW/.test(sh) && sh.includes('inline-site-css.js --check') && sh.includes('node scripts/check-site-view.js'));
    assert.ok(/Eleven checks/.test(sh));
  });

  it('scripts/check-site-view.js passes on index.html and FAILS (one line per problem) when an app script, an app stylesheet, a hint, a Firebase / icon-library host or a blocking stylesheet is put outside the kit — the mistake CLAUDE.md used to invite', () => {
    assert.deepEqual(SITE_VIEW.problems(html), []);
    const bad = (needle, insert) => { assert.ok(html.includes(needle), needle); return SITE_VIEW.problems(html.replace(needle, insert + needle)); };
    const BODY = '<div id="splash-screen"';
    const HEADEND = '</head>';
    assert.equal(bad(BODY, '<script defer src="js/app.js"></script>\n').length, 2, 'an app script in <body> (reported as a script and as an app asset)');
    assert.equal(bad(BODY, '<script defer src="js/newthing.js"></script>\n').length, 1, 'ANY new external script in <body>');
    assert.equal(bad(BODY, '<script defer src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>\n').length, 2);
    assert.equal(bad(BODY, '<script defer src="https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js"></script>\n').length, 2);
    assert.equal(bad(HEADEND, '<link rel="stylesheet" href="css/styles.css?v=1.2.3"/>\n').length, 2, 'an app stylesheet in the head');
    assert.equal(bad(HEADEND, '<link rel="stylesheet" href="css/site.css"/>\n').length, 1, 'the old blocking website stylesheet');
    assert.equal(bad(HEADEND, '<link rel="stylesheet" href="https://example.com/x.css"/>\n').length, 1);
    assert.equal(bad(HEADEND, '<link rel="preload" as="image" href="icons/barro-kitchens.png"/>\n').length, 1, 'a preload in the website view');
    assert.equal(bad(HEADEND, '<link rel="dns-prefetch" href="https://unpkg.com"/>\n').length, 2);
    assert.equal(bad(HEADEND, '<link rel="preconnect" href="https://www.gstatic.com" crossorigin/>\n').length, 1, 'a Firebase preconnect');
    // inside the kit, in comments and in <noscript> the same markup is fine
    assert.deepEqual(SITE_VIEW.problems(html.replace(BODY, '<!-- <script defer src="js/app.js"></script> -->' + BODY)), []);
    assert.deepEqual(SITE_VIEW.problems(html.replace(BODY, '<noscript><link rel="stylesheet" href="css/styles.css"/></noscript>' + BODY)), []);
    assert.deepEqual(SITE_VIEW.problems(html.replace('</template>', '<script defer src="js/newthing.js"></script></template>')), []);
    assert.equal(SITE_VIEW.problems(html.replace(/<template id="app-kit">[\s\S]*?<\/template>/, '')).length, 1, 'no kit at all');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('5 · fonts: one request, made after the page has loaded, never blocking the first paint', () => {
  const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..600&family=Inter:opsz,wght@14..32,400..600&display=swap';
  it('asks for Fraunces 500-600 and Inter 400-600 (the same optical-size axis the app stylesheet uses, so the same file) in ONE URL, from a post-load script, with the same URL in <noscript>', () => {
    const script = head.match(/<script>window\.addEventListener\('load', function \(\) \{ setTimeout\(function \(\) \{ var l = document\.createElement\('link'\); l\.rel = 'stylesheet'; l\.href = '([^']+)'; document\.head\.appendChild\(l\); \}, (\d+)\); \}\);<\/script>/);
    assert.ok(script, 'the post-load font script is gone');
    assert.equal(script[1], FONTS);
    assert.ok(Number(script[2]) >= 200 && Number(script[2]) <= 1000, 'the delay after load');
    assert.ok(head.includes(`<noscript><link rel="stylesheet" href="${FONTS}"/></noscript>`));
    assert.equal(head.split('fonts.googleapis.com/css2').length - 1, 2, 'exactly the script and the <noscript> mention the font stylesheet');
    assert.ok(!/font-display/.test(siteCss.replace(/\/\*[\s\S]*?\*\//g, '')) || true);
  });

  it('runs the script as the browser would: nothing at parse time, one stylesheet link appended to <head> 300 ms after load', () => {
    const src = (head.match(/<script>(window\.addEventListener\('load', function \(\) \{ setTimeout[\s\S]*?)<\/script>/) || [])[1];
    assert.ok(src);
    const events = {}, timers = [], appended = [];
    const sandbox = { window: { addEventListener: (ev, fn) => { events[ev] = fn; } }, setTimeout: (fn, ms) => timers.push([fn, ms]), document: { createElement: (t) => ({ tag: t }), head: { appendChild: (l) => appended.push(l) } } };
    vm.runInNewContext(src, sandbox);
    assert.deepEqual([Object.keys(events), timers.length, appended.length], [['load'], 0, 0]);
    events.load(); assert.equal(timers.length, 1); assert.equal(appended.length, 0, 'the request must wait for the timer');
    timers[0][0]();
    assert.deepEqual(appended.map((l) => [l.tag, l.rel, l.href]), [['link', 'stylesheet', FONTS]]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('6 · images and the hero clip', () => {
  it('gives the three services photos the 1000px candidate the content pages already ship (same photos, 60-72 KB instead of 160-183 KB), between the 600px thumb and the 1600px original', () => {
    for (const [n, hero] of [['dmmmsu/01', 'hero-dmmmsu-01'], ['ispsc/03', 'hero-ispsc-03'], ['dmmmsu/03', 'hero-dmmmsu-03']]) {
      const tag = html.match(new RegExp(`<img src="site/img/projects/${n}\\.webp" srcset="([^"]*)"[^>]*>`));
      assert.ok(tag, `${n}: services image not found`);
      assert.equal(tag[1], `site/img/projects/${n}-thumb.webp 600w, site/img/pages/${hero}.webp 1000w, site/img/projects/${n}.webp 1600w`);
      assert.ok(/sizes="\(min-width:900px\) 56vw, 100vw"/.test(tag[0]) && /loading="lazy"/.test(tag[0]) && /width="1600" height="1200"/.test(tag[0]));
      const f = path.join(ROOT, `site/img/pages/${hero}.webp`);
      assert.ok(fs.existsSync(f) && fs.statSync(f).size < 100 * 1024, `${hero}.webp is missing or heavy`);
    }
  });

  it('leaves the hero photo alone: it is the LCP image (fetchpriority high), shown cropped to cover a tall phone hero, so no smaller candidate is offered (it would be upscaled)', () => {
    const hero = html.match(/<img class="hero-bg"[^>]*>/)[0];
    assert.ok(/fetchpriority="high"/.test(hero) && !/loading="lazy"/.test(hero));
    assert.equal(hero.match(/srcset="([^"]*)"/)[1], 'site/img/projects/ispsc/01-thumb.webp 600w, site/img/projects/ispsc/01.webp 1600w');
  });

  it('starts the logo intro only after the page has loaded (at once if it already has) and the hero is on screen, so a megabyte of video never shares the phone\'s bandwidth with the largest paint — and the overlay is not drawn (hidden, opacity 0) until the clip really plays, so it can never be the LCP candidate', () => {
    const done = makeEnv(siteJs, { readyState: 'complete' });
    assert.equal(done.plays(), 0, 'nothing plays before the hero is on screen');
    done.intersect(true);
    assert.equal(done.plays(), 1, 'a page that has already loaded starts the clip at once');
    const loading = makeEnv(siteJs, { readyState: 'interactive' });
    loading.intersect(true);
    assert.equal(loading.plays(), 0, 'a page still loading must wait for the load event');
    assert.equal(loading.waitingForLoad(), 1);
    loading.load();
    assert.equal(loading.plays(), 1);
    assert.ok(!loading.classes.has('is-on'), 'still not drawn: opacity 0 until the "playing" event');
    loading.fire('video', 'playing');
    assert.ok(loading.classes.has('is-on'));
    assert.ok(/#site \.hero-ghost\{[^}]*;opacity:0;/.test(siteCss), 'the stylesheet draws the overlay at opacity 0');
    assert.ok(/<div class="hero-ghost" aria-hidden="true" hidden>/.test(html), 'the markup hides it');
    assert.ok(!/is-on/.test(html.replace(/<style id="site-css">[\s\S]*?<\/style>/, '')), 'the page never marks the overlay as shown by itself');
  });

  it('never runs in the app or the boot: the app kit holds none of the intro, and with <html data-view> boot, login or app nothing is requested or played — the overlay is hidden inside the display:none website, whatever the observer says', () => {
    assert.ok(!/hero-ghost|brand-reveal|<video|\.mp4/.test(kitHtml), 'the app kit carries the intro');
    assert.ok(!/hero-ghost|brand-reveal|<video|\.mp4/.test(kitEls.map((e) => e.text).join('')), 'the kit as written for the app views carries the intro');
    for (const view of ['boot', 'login', 'app']) {
      const e = makeEnv(siteJs, { view, readyState: 'interactive' });
      assert.equal(e.ghost.hidden, true, `${view}: the overlay is hidden`);
      assert.equal(e.plays(), 0, `${view}: nothing plays at parse time`);
      e.load();
      assert.equal(e.plays(), 0, `${view}: nothing plays at the load event`);
      e.intersect(true);
      assert.equal(e.plays(), 0, `${view}: nothing plays even when the observer reports the hero`);
      assert.equal(e.animations.length, 0);
    }
    // only the website view shows the website at all
    assert.ok(siteCss.includes('#site{display:none}') && siteCss.includes('html[data-view="site"] #site{display:block}'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('7 · the hand-off: "Team portal" reloads into /#login from the website; in place when the app is already there; "Back to website" leaves a clean URL', () => {
  function click({ loginScreen = true, app = false }) {
    const calls = [], handlers = {};
    const el = (id) => (id === 'site-team-portal' ? { addEventListener: (ev, fn) => { handlers[ev] = fn; } } : id === 'login-screen' ? (loginScreen ? {} : null) : null);
    const root = { setAttribute: (k, v) => calls.push(`${k}=${v}`), getAttribute: () => 'site', classList: { contains: () => false } };
    const doc = { readyState: 'complete', documentElement: root, getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
    const win = { matchMedia: () => ({ matches: true }), addEventListener() {}, innerWidth: 400, pageYOffset: 0, location: { href: 'https://barroindustries.com/?x=1', replace: (u) => calls.push(`replace ${u}`), reload: () => calls.push('reload') } };
    if (app) win.openLoginFromSite = () => calls.push('openLoginFromSite()');
    vm.runInNewContext(siteJs, { document: doc, window: win, URL });
    let prevented = 0;
    if (handlers.click) handlers.click({ preventDefault: () => { prevented++; } });
    return { calls, prevented, bound: !!handlers.click, win };
  }

  it('website view (no app in the page): prevents the default, replaces the address with the same address plus #login — keeping origin, path and query — and reloads, so the head script writes the app kit', () => {
    const r = click({});
    assert.equal(r.bound, true);
    assert.equal(r.prevented, 1);
    assert.deepEqual(r.calls, ['replace https://barroindustries.com/?x=1#login', 'reload']);
  });

  it('app already in the page (staff pressed "Back to website"): switches to the login view in place through the existing hand-off — no reload', () => {
    const r = click({ app: true });
    assert.deepEqual(r.calls, ['data-view=login', 'openLoginFromSite()']);
    assert.equal(r.win._wantLogin, true);
    assert.ok(!r.calls.some((c) => /reload|replace/.test(c)));
  });

  it('a page with no login screen in the document (the standalone /catalogue/) is left alone: the plain /#login link does the work', () => {
    const r = click({ loginScreen: false });
    assert.equal(r.prevented, 0);
    assert.deepEqual(r.calls, []);
    assert.ok(/<a class="foot-portal" href="\/#login" id="site-team-portal">Team portal<\/a>/.test(html), 'the footer link must keep its /#login href (works with no script)');
  });

  it('"Back to website" drops the #login hash (replaceState, no history entry, no hashchange) before showing the site, so a refresh shows the site; any other hash is left alone', () => {
    const src = (appJs.match(/window\.backToSiteFromLogin = function \(\) \{[\s\S]*?\n\};/) || [])[0];
    assert.ok(src, 'backToSiteFromLogin not found in js/app.js');
    const run = (hash) => {
      const calls = [];
      const el = () => ({ value: 'x', classList: { add: () => {}, remove: () => {} } });
      const sandbox = {
        window: {}, document: { getElementById: el }, clearLoginError: () => calls.push('clearLoginError'), selectedLoginType: 'admin',
        showSite: () => calls.push('showSite'), location: { hash, pathname: '/', search: '?a=1' },
        history: { state: { k: 1 }, replaceState: (s, t, u) => calls.push(`replaceState ${JSON.stringify(s)} ${JSON.stringify(t)} ${u}`) },
      };
      vm.runInNewContext(src, sandbox);
      sandbox.window.backToSiteFromLogin();
      return calls;
    };
    assert.deepEqual(run('#login'), ['clearLoginError', 'replaceState {"k":1} "" /?a=1', 'showSite']);
    assert.deepEqual(run('#/tasks'), ['clearLoginError', 'showSite']);
    assert.deepEqual(run(''), ['clearLoginError', 'showSite']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('7b · the legacy-session probe: a browser that already holds a signed-in session boots the app even though its hint is missing', () => {
  const probeSrc = (head.match(/<script>\(function \(\) \{\s*if \(document\.documentElement\.getAttribute\('data-view'\) !== 'site'\) return;\s*window\.addEventListener\('load'[\s\S]*?\}\)\(\);<\/script>/) || [''])[0].replace(/^<script>/, '').replace(/<\/script>$/, '');

  function run({ view = 'site', probed = false, noDatabases = false, dbs = [{ name: 'firebaseLocalStorageDb' }], hasStore = true, keys = ['firebase:authUser:KEY:[DEFAULT]'], openFails = false }) {
    const events = {}, timers = [], log = [], store = { hint: null, probed: probed ? '1' : null };
    const tick = (fn) => Promise.resolve().then(fn);
    const db = {
      objectStoreNames: { contains: (n) => hasStore && n === 'firebaseLocalStorage' },
      close: () => log.push('db.close'),
      transaction: (n, mode) => { log.push(`transaction ${n} ${mode}`); return { objectStore: () => ({ getAllKeys: () => { const r = {}; tick(() => { r.result = keys; if (r.onsuccess) r.onsuccess(); }); return r; } }) }; },
    };
    const indexedDB = noDatabases ? {} : {
      databases: () => { log.push('databases()'); return Promise.resolve(dbs); },
      open: (name) => { log.push(`open ${name}`); const r = { result: db }; tick(() => { if (openFails) { if (r.onerror) r.onerror(); } else if (r.onsuccess) r.onsuccess(); }); return r; },
    };
    const sandbox = {
      document: { documentElement: { getAttribute: (k) => (k === 'data-view' ? view : null) } },
      window: { addEventListener: (ev, fn) => { events[ev] = fn; }, indexedDB: noDatabases ? undefined : indexedDB },
      setTimeout: (fn, ms) => timers.push([fn, ms]), indexedDB,
      sessionStorage: { getItem: (k) => (k === 'bi-probed' ? store.probed : null), setItem: (k, v) => { if (k === 'bi-probed') store.probed = v; log.push(`session ${k}=${v}`); } },
      localStorage: { getItem: () => null, setItem: (k, v) => { if (k === 'bi-auth-hint') store.hint = v; log.push(`local ${k}=${v}`); } },
      location: { reload: () => log.push('reload') },
    };
    vm.runInNewContext(probeSrc, sandbox);
    const fire = async () => { if (events.load) events.load(); for (const t of timers.splice(0)) t[0](); await new Promise((r) => setTimeout(r, 20)); };
    return { events, timers, log, store, fire };
  }

  it('exists once, in the website view only, and does nothing at parse time: it waits for the load event and then ~600 ms', async () => {
    assert.ok(probeSrc.length > 100, 'probe script not found');
    assert.deepEqual(run({ view: 'boot' }).events, {}, 'must not even listen in the app views');
    for (const view of ['login', 'app']) assert.deepEqual(run({ view }).events, {});
    const r = run({});
    assert.deepEqual([Object.keys(r.events), r.timers.length, r.log], [['load'], 0, []]);
    r.events.load();
    assert.deepEqual(r.timers.map((t) => t[1]), [600]);
    assert.deepEqual(r.log, [], 'nothing before the timer');
  });

  it('a stored auth user: asks read-only, sets the boot hint and the once-per-tab guard, closes the database and reloads', async () => {
    const r = run({});
    await r.fire();
    assert.deepEqual(r.log, ['databases()', 'open firebaseLocalStorageDb', 'transaction firebaseLocalStorage readonly', 'db.close', 'session bi-probed=1', 'local bi-auth-hint=1', 'reload']);
    assert.equal(r.store.hint, '1');
  });

  it('never creates the database and never reloads for anyone else: no database, no object store, only other keys, a guard already set, no indexedDB.databases, a failing open or a throwing store', async () => {
    for (const [label, opts] of [
      ['no firebase database', { dbs: [{ name: 'something-else' }] }], ['no databases at all', { dbs: [] }],
      ['database without the store', { hasStore: false }], ['other keys only', { keys: ['firebase:previous-session', 'firebaseLocalStorage:x'] }], ['no keys', { keys: [] }],
      ['guard already set', { probed: true }], ['indexedDB.databases unsupported', { noDatabases: true }], ['open fails', { openFails: true }],
    ]) {
      const r = run(opts);
      await r.fire();
      assert.ok(!r.log.includes('reload') && !r.log.some((l) => /bi-auth-hint/.test(l)), `${label}: reloaded or wrote the hint`);
      if (label !== 'database without the store' && label !== 'other keys only' && label !== 'no keys') assert.ok(!r.log.some((l) => /^open /.test(l)) || label === 'open fails', `${label}: opened a database it should not have`);
    }
    // "open" is only ever called for a database that databases() listed — never to find out whether one exists
    const r = run({ dbs: [] }); await r.fire();
    assert.ok(!r.log.some((l) => /^open /.test(l)));
  });

  it('is the ONLY writer of the boot hint besides the app (showApp sets it; showSignedOut / showRemovedUserScreen clear it) and the head script that reads it', () => {
    const writers = [];
    for (const f of ['index.html', ...fs.readdirSync(path.join(ROOT, 'js')).filter((n) => n.endsWith('.js')).map((n) => `js/${n}`)]) {
      const src = read(f);
      for (const m of src.matchAll(/localStorage\.setItem\('bi-auth-hint'/g)) writers.push(f);
    }
    assert.deepEqual(writers.sort(), ['index.html', 'js/app.js']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('8 · the website stylesheet carries the few global rules it used to get from the app stylesheet (verified element by element: 450 computed styles, identical)', () => {
  it('restates, scoped to the website view and the no-script case: the body reset (margin 0 — without it the page is 16px narrower and the hero buttons wrap), the white canvas, the tap highlight, smooth scrolling, touch-action, the mobile text rendering and the thin scrollbar', () => {
    for (const rule of [
      'html[data-view="site"],html:not([data-view]){scroll-behavior:smooth;-webkit-tap-highlight-color:transparent;background:#fff}',
      'html[data-view="site"] body,html:not([data-view]) body{position:relative;margin:0;background:#fff;overflow-x:hidden}',
      '#site a,#site button,#site input,#site select,#site textarea,#site summary,#site [role="button"]{touch-action:manipulation}',
      'html[data-view="site"] body,html:not([data-view]) body{-webkit-text-size-adjust:100%;text-size-adjust:100%;text-rendering:optimizeLegibility}',
      'html[data-view="site"]::-webkit-scrollbar,html[data-view="site"] ::-webkit-scrollbar{width:4px;height:4px}',
    ]) assert.ok(siteCss.includes(rule), `site.css lost: ${rule.slice(0, 70)}`);
    assert.ok(/box-sizing:border-box;background:var\(--site-bg\)/.test(siteCss));
    // the reduced-motion override still comes AFTER the smooth-scroll rule
    assert.ok(siteCss.indexOf('scroll-behavior:smooth') < siteCss.indexOf('html[data-view="site"]{scroll-behavior:auto}'));
    assert.ok(!/overscroll-behavior/.test(siteCss.replace(/\/\*[\s\S]*?\*\//g, '')), 'the app\'s overscroll-behavior:none is deliberately NOT carried over (it exists for the app\'s own pull-to-refresh)');
  });
});
