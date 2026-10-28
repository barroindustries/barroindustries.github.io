// tests/site-public-surface.test.mjs — what the PUBLIC sees and what search engines read of barroindustries.com
// ("/" and "/catalogue/"), pinned after the owner's 2026-10-21 report: Google still showed the company's central
// system — its login, sign-up and app-shell text — as the description of the home page.
//
//   1. The system is not advertised. index.html still carries the app's static screens (splash, login, sign-up,
//      app shell, modal, profile drawer); every one of them is a data-nosnippet <div>, so Google never quotes it, the
//      removed-user screen (built by app.js at run time) is marked too, and the public site (#site) is outside every
//      one of them. No text, attribute, comment, JSON-LD or data island that is NOT inside such a container may name
//      the system ("Operating System", "central system", "Apply for Access", "Sign Up / Apply" ...). The app itself is
//      NOT renamed (owner: "it can still be seen, it should just not be public"): the login screen, the app's own
//      titles and manifest.json keep their wording, so none of those is pinned here, either way.
//   2. Header: "Get a quote" top right on both pages, no Login in the header or the phone menu. Footer: a discreet
//      "Team portal" link to /#login (the only way into the sign-in from the website).
//   3. SEO: distinct titles and descriptions (the home title byte-identical to SITE_TITLE in js/app.js), canonical,
//      indexable, Open Graph + Twitter large card with the hero project photo as an absolute URL, icons, sitemap and
//      robots, JSON-LD (LocalBusiness + WebSite on "/", an ItemList of the 32 products on /catalogue/) — and no
//      price or offer key in any of it.
//   4. The brand. The primary public name is "Barro Industries"; "Barro Kitchens" is BOTH the current brand a rename SWAPS (every visible
//      mention in a bare <span data-brand>, CSS-neutral) AND, by the owner's ruling of 2026-10-22, a PERMANENT historic name a rename KEEPS: it is
//      REQUIRED in the "/" and /catalogue/ titles ("Barro Kitchens by Barro Industries"), SITE_TITLE, the meta descriptions, the JSON-LD
//      alternateName array and the About line marked data-brand-legacy. The two markers are distinct and the exact inventory of places the name
//      appears is pinned, so a rename is a find-and-replace of that list that knows which entries to swap and which to keep.
//   5. scripts/build-catalogue.js generates the ItemList (names + #cat-… anchors only) from the same walk as the cards.
//   6. The hero's logo INTRO (2026-10-22): the muted clip plays once, translucent and large behind the headline (a hidden, aria-hidden overlay,
//      opacity 0 until the clip plays), then flies to the header logo (#site-brand img, FLIP by transform + opacity) and is removed — and a
//      visitor with no script, reduced motion, a data-saver request, a hidden tab, a refused autoplay, the app / boot views, or a page scrolled
//      away sees none of it. Pinned as markup, stylesheet and BEHAVIOUR (js/site.js run in tests/fixtures/hero-intro-env.mjs, a small fake
//      browser). The 480px file under 900px and the 720px file above, never precached, no audio track, no poster.
//   7. The material: two stainless grades (SS304 food-grade as the standard, SS316 laboratory-grade) and three finishes (brushed, mirror, satin) are
//      stated on the homepage and the catalogue; no past project is credited with a grade; no configurator or quote-flow option exists for either yet.
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
import { fileURLToPath } from 'node:url';
import { makeEnv, parseTransform } from './fixtures/hero-intro-env.mjs';

const require = createRequire(import.meta.url);
const B = require('../scripts/build-catalogue.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const decode = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const stripTags = (html) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
const visibleText = (html) => decode(stripTags(html)).replace(/\s+/g, ' ').trim();

// ── a small HTML scanner (no dependency) ──────────────────────────────────────────────────────────────────────
// Walks the markup once and returns the elements (each with the chain of its ancestors), the text nodes, the
// attributes, the comments and the <script> bodies, plus every structural problem it met: a closing tag with no
// opener, a closing tag that skips an unclosed element, an element still open at the end. Google only honours
// data-nosnippet on a WELL-FORMED section, so "no problems" is itself a pin.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
function parseAttrs(s) {
  const out = {};
  const re = /([^\s=\/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
  return out;
}
function scan(html) {
  const out = { texts: [], attrs: [], comments: [], scripts: [], elements: [], problems: [] };
  const stack = [];
  const lower = html.toLowerCase();
  const re = /<!--([\s\S]*?)-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  let last = 0, m;
  const addText = (t) => { if (t.trim()) out.texts.push({ text: t, chain: stack.slice() }); };
  while ((m = re.exec(html))) {
    addText(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) { out.comments.push({ text: m[1], chain: stack.slice() }); continue; }
    if (m[3] === undefined) continue;                                           // <!DOCTYPE html>
    const closing = m[2] === '/', tag = m[3].toLowerCase(), rawAttrs = m[4];
    if (closing) {
      let i = stack.length - 1;
      while (i >= 0 && stack[i].tag !== tag) i--;
      if (i < 0) { out.problems.push(`stray </${tag}> at ${m.index}`); continue; }
      if (i !== stack.length - 1) out.problems.push(`</${tag}> closes over unclosed <${stack.slice(i + 1).map((e) => e.tag).join('>, <')}> at ${m.index}`);
      stack.length = i;
      continue;
    }
    const attrs = parseAttrs(rawAttrs);
    const el = { tag, attrs };
    out.elements.push({ tag, attrs, chain: stack.slice() });
    for (const [k, v] of Object.entries(attrs)) out.attrs.push({ name: k, value: v, tag, chain: stack.slice() });
    if (tag === 'script' || tag === 'style') {                              // raw text up to the matching close tag
      const close = lower.indexOf('</' + tag, re.lastIndex);
      if (tag === 'script') out.scripts.push({ attrs, body: html.slice(re.lastIndex, close), chain: stack.slice() });
      stack.push(el);
      re.lastIndex = close; last = close;
      continue;
    }
    if (VOID.has(tag) || /\/\s*$/.test(rawAttrs)) continue;
    stack.push(el);
  }
  addText(html.slice(last));
  if (stack.length) out.problems.push(`still open at the end: <${stack.map((e) => e.tag).join('>, <')}>`);
  return out;
}
const noSnippet = (chain) => chain.some((e) => 'data-nosnippet' in e.attrs);
const inSite = (chain) => chain.some((e) => e.attrs.id === 'site');
const inBody = (chain) => chain.some((e) => e.tag === 'body');
const inHead = (chain) => chain.some((e) => e.tag === 'head');

// Every string a visitor, a crawler or a snippet can read, EXCEPT what sits inside a data-nosnippet container:
// text nodes, attribute values, comments and script bodies (JSON-LD and the JSON data island are data a crawler reads;
// JavaScript source is reported separately by the caller).
function publicStrings(S) {
  const out = [];
  for (const t of S.texts) if (!noSnippet(t.chain)) out.push({ kind: 'text', value: decode(t.text) });
  for (const a of S.attrs) if (!noSnippet(a.chain)) out.push({ kind: `<${a.tag} ${a.name}>`, value: decode(a.value) });
  for (const c of S.comments) if (!noSnippet(c.chain)) out.push({ kind: 'comment', value: c.text });
  for (const s of S.scripts) if (!noSnippet(s.chain)) out.push({ kind: `script ${s.attrs.type || '(javascript)'}`, value: s.body, script: s });
  return out;
}

// What the owner saw quoted by Google: "Barro Industries Operating System — the company's central system. Sign Up / Apply
// Apply for Access Submit your details for review. Application submitted!"
const SYSTEM_WORDING = /operating\s+system|central\s+system|ops\s+system|apply\s+for\s+access|sign\s*up\s*\/\s*apply|submit\s+your\s+details|application\s+submitted/i;

const PAGES = {
  home: { name: 'the homepage (index.html)', file: 'index.html', url: 'https://barroindustries.com/' },
  catalogue: { name: 'the catalogue page', file: 'catalogue/index.html', url: 'https://barroindustries.com/catalogue/' },
};
for (const p of Object.values(PAGES)) {
  p.html = read(p.file);
  p.S = scan(p.html);
  p.head = p.html.slice(0, p.html.indexOf('</head>'));
  p.header = p.html.match(/<header id="site-header">[\s\S]*?<\/header>/)[0];
  p.footer = p.html.match(/<footer id="site-footer">[\s\S]*?<\/footer>/)[0];
  const headEls = p.S.elements.filter((e) => inHead(e.chain));
  p.meta = (key) => { const e = headEls.find((x) => x.tag === 'meta' && (x.attrs.name === key || x.attrs.property === key)); return e ? decode(e.attrs.content || '') : null; };
  p.metaCount = (key) => headEls.filter((x) => x.tag === 'meta' && (x.attrs.name === key || x.attrs.property === key)).length;
  p.links = (rel) => headEls.filter((x) => x.tag === 'link' && (x.attrs.rel || '').split(/\s+/).includes(rel)).map((x) => x.attrs);
  p.title = decode(p.S.texts.find((t) => inHead(t.chain) && t.chain[t.chain.length - 1].tag === 'title').text);
  p.ld = p.S.scripts.filter((s) => s.attrs.type === 'application/ld+json').map((s) => JSON.parse(s.body));
}
const { home, catalogue } = PAGES;
const siteTitleInApp = read('js/app.js').match(/const SITE_TITLE = '([^']*)';/)[1];
const siteCss = read('css/site.css');
const siteJs = read('js/site.js');

// every key anywhere inside a parsed JSON value
const allKeys = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) { out.add(k); allKeys(v[k], out); }
  return out;
};
const wordsOf = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 4);
const maxRepeat = (s) => { const n = {}; for (const w of wordsOf(s)) n[w] = (n[w] || 0) + 1; return Math.max(0, ...Object.values(n)); };
const pngSize = (buf) => (buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null);
const fileOf = (href) => href.replace(/^https:\/\/barroindustries\.com/, '').replace(/^\//, '');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the scanner these tests rely on', () => {
  const fixture = `<!DOCTYPE html><html><head><title>T</title><meta name="description" content="Operating System"></head><body>
    <div id="site"><p>Operating System</p><img alt="central system"></div>
    <div id="login-screen" data-nosnippet><p>Operating System</p><input placeholder="Apply for Access"><!-- Sign Up / Apply --></div>
    <script>var s = 'Operating System';</script></body></html>`;

  it('flags a phrase in public text, an attribute or a meta tag, and ignores the same phrase inside a data-nosnippet container (so the real checks are not vacuous)', () => {
    const S = scan(fixture);
    assert.deepEqual(S.problems, []);
    const hits = publicStrings(S).filter((x) => SYSTEM_WORDING.test(x.value) && x.kind !== 'script (javascript)').map((x) => x.kind);
    assert.deepEqual(hits.sort(), ['<img alt>', '<meta content>', 'text'].sort());
    assert.ok(publicStrings(S).some((x) => x.kind === 'script (javascript)' && SYSTEM_WORDING.test(x.value)), 'a script body is reported separately');
    assert.ok(S.texts.find((t) => /Operating/.test(t.text) && noSnippet(t.chain)), 'the container text is still seen, just marked');
  });

  it('reports malformed nesting, so a data-nosnippet container Google would not honour is caught', () => {
    assert.ok(scan('<div data-nosnippet><p>a</div>').problems.length > 0);
    assert.ok(scan('<div>a</div></div>').problems.length > 0);
    assert.ok(scan('<div data-nosnippet>a').problems.length > 0);
    assert.deepEqual(scan('<div data-nosnippet><p>a</p><img src="x"><br/></div>').problems, []);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('1 · the system is not advertised: app-only markup is data-nosnippet, the public site is not', () => {
  const APP_ONLY = ['splash-screen', 'login-screen', 'signup-form-wrap', 'app-shell', 'modal-overlay', 'profile-drawer'];

  it('marks every app-only container in index.html with data-nosnippet, and only on the elements Google honours (div, span, section)', () => {
    for (const id of APP_ONLY) {
      const el = home.S.elements.find((e) => e.attrs.id === id);
      assert.ok(el, `#${id} is missing from index.html`);
      assert.equal(el.tag, 'div', `#${id} must be a div`);
      assert.ok('data-nosnippet' in el.attrs, `#${id} is not data-nosnippet`);
    }
    for (const p of Object.values(PAGES)) for (const e of p.S.elements.filter((x) => 'data-nosnippet' in x.attrs)) assert.ok(['div', 'span', 'section'].includes(e.tag), `${p.file}: data-nosnippet on <${e.tag}> is ignored by Google`);
  });

  it('leaves NO text in index.html outside #site that is not inside a data-nosnippet container (a new static app screen must be marked too)', () => {
    const stray = home.S.texts.filter((t) => inBody(t.chain) && !inSite(t.chain) && !noSnippet(t.chain)).map((t) => t.text.trim().slice(0, 60));
    assert.deepEqual(stray, [], 'static app text that Google could quote');
    const strayAttrs = home.S.attrs.filter((a) => inBody(a.chain) && !inSite(a.chain) && !noSnippet(a.chain) && ['alt', 'title', 'aria-label', 'placeholder'].includes(a.name)).map((a) => `${a.tag}[${a.name}]=${a.value.slice(0, 40)}`);
    assert.deepEqual(strayAttrs, [], 'static app attribute text that Google could quote');
  });

  it('keeps the public site OUT of every nosnippet container: #site is not inside one, holds none, and neither does the <head> or either page\'s <body>/<html>', () => {
    const siteEl = home.S.elements.find((e) => e.attrs.id === 'site');
    assert.ok(siteEl && !('data-nosnippet' in siteEl.attrs) && !noSnippet(siteEl.chain), '#site is nosnippet');
    assert.deepEqual(home.S.elements.filter((e) => inSite(e.chain) && 'data-nosnippet' in e.attrs).map((e) => e.tag), [], 'a nosnippet container sits inside #site');
    assert.deepEqual(home.S.elements.filter((e) => inHead(e.chain) && 'data-nosnippet' in e.attrs), []);
    for (const tag of ['html', 'body']) for (const p of Object.values(PAGES)) assert.ok(!('data-nosnippet' in p.S.elements.find((e) => e.tag === tag).attrs), `${p.file}: <${tag}> is nosnippet`);
    // the standalone catalogue page has no app markup at all, so nothing on it is nosnippet and all of its text is in #site
    assert.equal(catalogue.S.elements.filter((e) => 'data-nosnippet' in e.attrs).length, 0);
    assert.deepEqual(catalogue.S.texts.filter((t) => inBody(t.chain) && !inSite(t.chain)).map((t) => t.text.trim().slice(0, 40)), []);
  });

  it('is well-formed (every tag closed in order), so Google honours each data-nosnippet section', () => {
    for (const p of Object.values(PAGES)) assert.deepEqual(p.S.problems, [], `${p.file} is not well-formed`);
  });

  it('marks the removed-user screen, which app.js builds at run time, as data-nosnippet too', () => {
    const app = read('js/app.js');
    const fn = app.slice(app.indexOf('function showRemovedUserScreen()'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.ok(/el\.id = 'removed-user-screen';[\s\S]*el\.setAttribute\('data-nosnippet', ''\)/.test(body), 'showRemovedUserScreen() does not mark the screen it creates');
  });

  for (const key of ['home', 'catalogue']) {
    it(`never names the system in anything public on ${PAGES[key].name}: text, attributes, meta tags, JSON-LD, comments and the data island — only inside nosnippet containers`, () => {
      const hits = publicStrings(PAGES[key].S).filter((x) => !x.script || x.script.attrs.type || !/^\s*$/.test(x.value)).filter((x) => !(x.kind === 'script (javascript)') && SYSTEM_WORDING.test(x.value));
      assert.deepEqual(hits.map((h) => `${h.kind}: ${h.value.trim().slice(0, 60)}`), [], 'public text names the system');
      // JavaScript source is not rendered text, so the one inline script that carries the app\'s fallback label is the ONLY allowed exception
      const js = publicStrings(PAGES[key].S).filter((x) => x.kind === 'script (javascript)' && SYSTEM_WORDING.test(x.value));
      assert.equal(js.length, key === 'home' ? 1 : 0, 'an unexpected script names the system');
      if (js.length) assert.ok(js[0].value.includes('window._applyBrandVersion'), 'the exception is the brand/version helper, nothing else');
    });
  }

  it('keeps the page titles and descriptions the app sets for the PUBLIC view free of the system\'s name (SITE_TITLE, showSite)', () => {
    assert.ok(!SYSTEM_WORDING.test(siteTitleInApp));
    const app = read('js/app.js');
    const showSite = app.slice(app.indexOf('function showSite()'), app.indexOf('function showSignedOut()'));
    assert.ok(/document\.title = SITE_TITLE;/.test(showSite), 'showSite() no longer restores the public title');
    assert.ok(!SYSTEM_WORDING.test(showSite.replace(/\/\/.*$/gm, '')));
  });

  it('keeps the other public files free of the system\'s name too: robots.txt, sitemap.xml and the public css / js (manifest.json and the app are deliberately not pinned: owner, "it can still be seen, it should just not be public")', () => {
    for (const f of ['robots.txt', 'sitemap.xml', 'css/site.css', 'css/catalogue.css', 'css/quote-request.css', 'js/site.js', 'js/catalogue.js', 'js/quote-request.js', 'js/qr-def.js', 'js/product-families.js', 'js/qr-families.js', 'js/qr-preview.js']) {
      assert.ok(!SYSTEM_WORDING.test(read(f)), `${f} names the system`);
    }
  });

  it('keeps the two other static pages that describe the system out of search results (noindex): the BI Ops company-info sheet in the repo root and /ventures/', () => {
    for (const f of ['Barro Industries - BI Ops Company Info.html', 'ventures/index.html']) {
      const html = read(f);
      assert.ok(/<meta name="robots" content="[^"]*noindex/i.test(html.slice(0, html.indexOf('</head>'))), `${f} can be indexed`);
    }
    assert.ok(/^Disallow: \/ventures\/$/m.test(read('robots.txt')));
    for (const p of Object.values(PAGES)) assert.ok(!/BI Ops Company Info|ventures\//.test(p.html.replace(/<!--[\s\S]*?-->/g, '')), `${p.file} links to a page that is not public`);
  });

  it('keeps the public pages\' search-engine tags indexable: no noindex / nofollow, the catalogue included', () => {
    for (const p of Object.values(PAGES)) {
      assert.equal(p.metaCount('robots'), 1);
      assert.equal(p.meta('robots'), 'index,follow', `${p.file}`);
      assert.ok(!/noindex|nofollow|none/i.test(p.meta('robots')));
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('2 · header: "Get a quote" top right, no Login · footer: a discreet "Team portal"', () => {
  const CTA = '<a class="site-btn site-btn-primary site-btn-sm site-head-cta" href="/catalogue/?quote=1" data-qr-start>Get a quote</a>';

  for (const key of ['home', 'catalogue']) {
    const p = PAGES[key];

    it(`${p.name}: the header's top-right slot is the primary "Get a quote" button to the quote flow, between the nav and the menu button`, () => {
      assert.equal(p.header.split(CTA).length - 1, 1, 'the header must carry the Get a quote button exactly once');
      assert.ok(p.header.indexOf('id="site-nav"') < p.header.indexOf(CTA) && p.header.indexOf(CTA) < p.header.indexOf('id="site-menu-btn"'), 'the button sits after the nav and before the menu button');
      assert.equal((p.header.match(/data-qr-start/g) || []).length, 1);
      assert.equal(p.header.match(/<(a|button)\b[^>]*class="[^"]*site-btn[^"]*"/g).length, 1, 'the header has one button besides the menu button');
    });

    it(`${p.name}: there is no Login in the header or in the phone menu (the nav) — no word, no #login link, no old id`, () => {
      const nav = p.header.match(/<nav id="site-nav"[\s\S]*?<\/nav>/)[0];
      const text = decode(p.header.replace(/<[^>]+>/g, ' '));
      assert.ok(!/log\s?in|sign\s?in|staff|team portal|portal/i.test(text), 'the header text mentions a login');
      assert.ok(!/#login|login/i.test(nav) && !/#login/.test(p.header), 'the header or the menu links to the login');
      assert.ok(!/site-login/.test(p.header));
    });

    it(`${p.name}: the footer's "Team portal" is the one link to /#login, the last of the footer links, and "Staff login" is gone`, () => {
      const links = [...p.footer.matchAll(/<a\b[^>]*href="\/#login"[^>]*>([^<]*)<\/a>/g)];
      assert.equal(links.length, 1, 'exactly one footer link to /#login');
      assert.equal(links[0][1], 'Team portal');
      assert.equal((p.html.match(/href="\/#login"/g) || []).length, 1, 'no other link to /#login on the page');
      assert.ok(/<a class="foot-portal" href="\/#login"/.test(p.footer));
      const anchors = [...p.footer.match(/<p class="foot-links">[\s\S]*?<\/p>/)[0].matchAll(/<a\b[^>]*>[^<]*<\/a>/g)].map((m) => m[0]);
      assert.ok(anchors[anchors.length - 1].includes('Team portal'), 'Team portal is the last footer link');
      assert.ok(!/Staff login|staff login|>Login</.test(p.html), 'the old wording is back');
      assert.ok(!SYSTEM_WORDING.test(decode(p.footer.replace(/<[^>]+>/g, ' '))), 'the footer names the system');
    });
  }

  it('wires the homepage footer link to the login view through the existing hand-off (id site-team-portal in index.html, bound by js/site.js to openLoginFromSite), and leaves the catalogue link a plain link', () => {
    assert.ok(home.footer.includes('<a class="foot-portal" href="/#login" id="site-team-portal">Team portal</a>'));
    assert.ok(!catalogue.html.includes('id="site-team-portal"'), 'the catalogue page has no login screen for site.js to open');
    assert.ok(/on\(\$\('site-team-portal'\), 'click', openLogin\);/.test(siteJs));
    // the app already in the page (staff pressed "Back to website"): the in-place switch through the hand-off; the website view loads no app, so it reloads into /#login (tests/site-perf-loading.test.mjs pins that half)
    assert.ok(/if \(window\.openLoginFromSite\) \{[^}]*window\.openLoginFromSite\(\);[^}]*return;\s*\}/.test(siteJs) && siteJs.includes("if (!$('login-screen')) return;"));
    assert.ok(/window\.openLoginFromSite = function \(\) \{ window\._wantLogin = true; showLogin\(\); \};/.test(read('js/app.js')), 'app.js no longer defines the hand-off');
    assert.ok(read('js/app.js').includes("document.getElementById('login-site-back')?.addEventListener('click', window.backToSiteFromLogin);"), 'the login screen lost its Back to website link');
    assert.ok(home.S.elements.some((e) => e.attrs.id === 'login-site-back'));
  });

  it('retires the old Login ids everywhere (index.html, the catalogue page, css/site.css, js/site.js, js/app.js)', () => {
    for (const f of ['index.html', 'catalogue/index.html', 'css/site.css', 'js/site.js', 'js/app.js']) assert.ok(!/site-login-btn|site-login-link|site-footer-login/.test(read(f)), `${f} still mentions an old Login id`);
  });

  it('draws the Team portal link quietly: muted colour, regular weight, 13px, below the weight of the other footer links', () => {
    const m = siteCss.match(/#site #site-footer a\.foot-portal\{([^}]*)\}/);
    assert.ok(m, 'no .foot-portal rule');
    assert.ok(/color:var\(--site-muted\)/.test(m[1]) && /font-weight:400/.test(m[1]) && /font-size:13px/.test(m[1]));
    assert.ok(/#site #site-footer a\{color:var\(--site-navy\);font-weight:500/.test(siteCss), 'the other footer links are navy / 500');
  });

  it('keeps the phone header fitting: the button and the menu button never shrink (flex:none) while the brand does, and the 360 / 320px rules are in place', () => {
    assert.ok(siteCss.includes('#site .site-head-cta,#site #site-menu-btn{flex:none}'), 'the button and the menu button can be squeezed');
    assert.ok(siteCss.includes('#site .site-head-cta{white-space:nowrap}'));
    assert.ok(/#site #site-brand\{display:flex;flex:1 1 auto;align-items:center;gap:11px;min-width:0/.test(siteCss), 'the brand must be the part that shrinks');
    assert.ok(/@media \(max-width:369px\)\{\s*#site \.site-brand-name\{font-size:16px\}/.test(siteCss), 'the 360px rule is gone');
    assert.ok(/@media \(max-width:359px\)\{[^}]*#site \.site-header-in,#site #site-brand\{gap:6px\}[\s\S]*?#site \.site-brand-name\{[^}]*white-space:normal[^}]*\}[\s\S]*?#site \.site-btn-sm\{padding:0 10px;font-size:12\.5px\}/.test(siteCss), 'the 320px rule is gone');
  });

  it('keeps the button visible over the photo hero (white until the header goes solid) and for visitors with JavaScript off (navy)', () => {
    assert.ok(siteCss.includes('#site.is-home #site-header:not(.is-solid):not(.is-menu-open) .site-head-cta{background:#fff;border-color:#fff;color:var(--site-navy)}'));
    assert.ok(siteCss.includes('#site.is-home #site-header:not(.is-solid):not(.is-menu-open) .site-head-cta:hover{background:var(--site-paper);border-color:var(--site-paper)}'));
    const noscript = home.html.match(/<noscript><style>([^<]*)<\/style><\/noscript>/)[1];
    assert.ok(noscript.includes('#site-header .site-head-cta{background:#0B1B3F !important;border-color:#0B1B3F !important;color:#fff !important}'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('3 · SEO: titles, descriptions, canonical, social cards, icons, sitemap, robots', () => {
  it('gives each page its own keyword-rich title: the exact titles, distinct, short enough, not stuffed — and both carry "Barro Kitchens by Barro Industries" (owner ruling 2026-10-22: Barro Kitchens is a permanent, historic name of the business)', () => {
    assert.equal(home.title, 'Stainless Steel Kitchen Equipment | Barro Kitchens by Barro Industries');   // owner ruling 2026-10-28: the search words lead, the permanent name follows (Google shows ~60 characters)
    assert.equal(catalogue.title, 'Commercial Kitchen Equipment Catalogue | Barro Kitchens by Barro Industries');
    assert.notEqual(home.title, catalogue.title);
    for (const p of [home, catalogue]) {
      assert.ok(p.title.length >= 30 && p.title.length <= 90, `${p.file}: title length ${p.title.length}`);
      assert.equal(p.S.texts.filter((t) => inHead(t.chain) && t.chain[t.chain.length - 1].tag === 'title').length, 1);
      // the only word repeated in a title is the one the ruling itself repeats: "Barro" (the brand's and the company's); nothing else is stuffed
      const seen = {}; for (const w of wordsOf(p.title)) seen[w] = (seen[w] || 0) + 1;
      assert.deepEqual(Object.entries(seen).filter(([, n]) => n > 1), [['barro', 2]], `${p.file}: a word is repeated in the title`);
      assert.ok(p.title.includes('Barro Kitchens by Barro Industries'), 'the permanent name and the primary public name are in the title');
    }
    assert.ok(/^Stainless Steel Kitchen Equipment/.test(home.title));
    assert.ok(/Commercial Kitchen Equipment/.test(catalogue.title));
  });

  it('keeps the homepage <title> byte-identical to SITE_TITLE in js/app.js (the view switch restores it), the permanent name in it, and the login-view title untouched', () => {
    assert.equal(home.title, siteTitleInApp);
    assert.ok(siteTitleInApp.includes('Barro Kitchens by Barro Industries'));
  });

  it('gives each page its own meta description: distinct, 100-200 characters, naming what the page is about, not stuffed', () => {
    const hd = home.meta('description'), cd = catalogue.meta('description');
    assert.ok(hd && cd && hd !== cd, 'the two descriptions must be distinct');
    for (const [p, d] of [[home, hd], [catalogue, cd]]) {
      assert.equal(p.metaCount('description'), 1);
      assert.ok(d.length >= 100 && d.length <= 260, `${p.file}: description length ${d.length}`);   // 260: the homepage's now names the fabrication too (SEO build 2026-10-22); Google shows the first ~155 characters
      assert.ok(maxRepeat(d) <= 2, `${p.file}: a word is repeated in the description`);
      assert.ok(/\.$/.test(d), 'the description is a finished sentence');
    }
    assert.ok(/^Premium commercial kitchen equipment and stainless steel fabrication in SS304 or SS316, built to order in Quezon City by Barro Kitchens by Barro Industries\.$/.test(hd));   // owner ruling 2026-10-28: 156 characters, so Google shows all of it
    assert.ok(hd.includes('stainless steel fabrication'), 'the homepage description names the fabrication (SEO build 2026-10-22)');
    assert.ok(/^Browse premium commercial kitchen equipment from Barro Kitchens in SS304 or SS316 stainless steel for preparation, washing, cooking, ventilation, storage and refrigeration, for restaurants, hotels and bakeries\. Request a quote\.$/.test(cd));   // the six public categories (Ventilation added 2026-10-28)
    // the permanent name, once, in each (owner ruling 2026-10-22)
    for (const d of [hd, cd]) assert.equal((d.match(/Barro Kitchens/g) || []).length, 1);
  });

  it('declares one absolute canonical URL per page, equal to the page\'s own address', () => {
    for (const p of [home, catalogue]) {
      const c = p.links('canonical');
      assert.equal(c.length, 1);
      assert.equal(c[0].href, p.url);
    }
  });

  it('carries Open Graph and Twitter tags on both pages: title and description mirror the page, the card is large, the image is the hero project photo as an absolute URL that exists', () => {
    const IMG = 'https://barroindustries.com/site/img/projects/ispsc/01.webp';
    const size = B.webpSize(fs.readFileSync(path.join(ROOT, fileOf(IMG))));
    assert.deepEqual(size, { width: 1600, height: 1200 });
    for (const p of [home, catalogue]) {
      assert.equal(p.meta('og:type'), 'website');
      assert.equal(p.meta('og:site_name'), 'Barro Industries');
      assert.equal(p.meta('og:locale'), 'en_PH');
      assert.equal(p.meta('og:title'), p.title);
      assert.equal(p.meta('og:description'), p.meta('description'));
      assert.equal(p.meta('og:url'), p.url);
      assert.equal(p.meta('og:image'), IMG);
      assert.equal(p.meta('og:image:width'), String(size.width));
      assert.equal(p.meta('og:image:height'), String(size.height));
      assert.ok((p.meta('og:image:alt') || '').length > 20);
      assert.equal(p.meta('twitter:card'), 'summary_large_image');
      assert.equal(p.meta('twitter:title'), p.title);
      assert.equal(p.meta('twitter:description'), p.meta('description'));
      assert.equal(p.meta('twitter:image'), IMG);
      assert.equal(p.meta('twitter:image:alt'), p.meta('og:image:alt'));
      for (const k of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:title', 'twitter:image']) assert.equal(p.metaCount(k), 1, `${p.file}: ${k} appears ${p.metaCount(k)} times`);
    }
    assert.ok(exists(fileOf(IMG)));
  });

  it('has a favicon and an apple-touch-icon on both pages, every file present, a 192px icon for Google (a multiple of 48px) with its true size declared', () => {
    for (const p of [home, catalogue]) {
      const icons = p.links('icon'), touch = p.links('apple-touch-icon');
      assert.ok(icons.length >= 2 && touch.length >= 1, `${p.file}: icon links`);
      for (const l of [...icons, ...touch]) {
        const f = l.href.replace(/^\//, '');
        assert.ok(exists(f), `${p.file}: ${l.href} does not exist`);
        if (l.sizes) { const s = pngSize(fs.readFileSync(path.join(ROOT, f))); assert.ok(s, `${f} is not a PNG`); assert.equal(`${s.w}x${s.h}`, l.sizes, `${f} is not ${l.sizes}`); }
      }
      assert.ok(icons.some((l) => l.sizes === '192x192'), `${p.file}: no 192x192 icon`);
      assert.ok(icons.some((l) => !l.sizes && /favicon\.png$/.test(l.href)), `${p.file}: the favicon.png link is gone`);
    }
  });

  it('lists "/", "/catalogue/" and the 12 public content pages in sitemap.xml (the first two equal to the canonical URLs), each with a valid, not-future lastmod, and points robots.txt at it', () => {
    const sm = read('sitemap.xml');
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(locs.slice(0, 2), [home.url, catalogue.url]);
    // the home page, the catalogue and the 12 content pages (services, work, areas-we-serve, faq), plus the product pages and the fresh-air page (tests/seo-products.test.mjs) and any later page
    assert.ok(locs.length >= 14, `only ${locs.length} URLs`);
    assert.equal(new Set(locs).size, locs.length, 'a URL is listed twice');
    for (const u of locs.slice(2)) assert.ok(exists(u.replace('https://barroindustries.com/', '') + 'index.html'), `${u} is in the sitemap but has no page`);
    const mods = [...sm.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    assert.equal(mods.length, locs.length);
    for (const d of mods) {
      assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(!Number.isNaN(Date.parse(d)) && Date.parse(d) <= Date.now() + 36e5 * 36, `lastmod ${d} is not a date or is in the future`);
      assert.ok(d >= '2026-10-21', `lastmod ${d} predates this change`);
    }
    const robots = read('robots.txt');
    assert.ok(/^User-agent: \*$/m.test(robots) && /^Allow: \/$/m.test(robots));
    assert.ok(robots.includes('Sitemap: https://barroindustries.com/sitemap.xml'));
    const disallowed = robots.split('\n').filter((l) => /^Disallow:/i.test(l)).map((l) => l.replace(/^Disallow:\s*/i, '').trim()).filter(Boolean);
    for (const url of ['/', '/catalogue/']) assert.deepEqual(disallowed.filter((d) => url.startsWith(d)), [], `robots.txt disallows ${url}`);
    for (const a of ['/css/', '/js/', '/site/']) assert.deepEqual(disallowed.filter((d) => a.startsWith(d)), [], `robots.txt blocks ${a}, which Google needs to render the pages`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('3b · structured data (JSON-LD): LocalBusiness + WebSite on "/", the product ItemList on /catalogue/ — and no price or offer key anywhere', () => {
  const FORBIDDEN_KEYS = /^(price|pricecurrency|pricerange|pricespecification|offers?|lowprice|highprice|aggregateoffer|availability|itemcondition|pricevaliduntil|aggregaterating|review|ratingvalue|sku|gtin\d*|mpn)$/i;

  it('parses every JSON-LD block, and none carries a price, offer, rating or availability key, an Offer type, or a money amount', () => {
    for (const p of [home, catalogue]) {
      assert.ok(p.ld.length >= 1);
      for (const block of p.ld) {
        const keys = [...allKeys(block)];
        assert.deepEqual(keys.filter((k) => FORBIDDEN_KEYS.test(k)), [], `${p.file}: a price / offer key`);
        assert.ok(!/"@type":"(Offer|AggregateOffer|Product|Review|AggregateRating)"/.test(JSON.stringify(block)), `${p.file}: a type that implies a price`);
        assert.ok(!B.MONEY_RE.test(JSON.stringify(block)) && !B.FORMULA_RE.test(JSON.stringify(block)), `${p.file}: a money token`);
        assert.ok(!B.BRAND_RE.test(JSON.stringify(block)), `${p.file}: the partner company is named`);
      }
    }
  });

  it('on "/": a LocalBusiness named "Barro Industries" (legal name Barro Industries OPC, alternate names [Barro Kitchens, Barro Kitchens by Barro Industries], brand Barro Kitchens) with sameAs = Facebook + the Google Maps place, and a WebSite node with the same alternate names', () => {
    assert.equal(home.ld.length, 3);   // LocalBusiness, WebSite, and (owner 2026-10-22) the copyright block: the homepage's photographs as ImageObjects
    const [lb, ws, imgs] = home.ld;
    assert.equal(lb['@type'], 'LocalBusiness');
    assert.equal(lb.name, 'Barro Industries');
    assert.equal(lb.legalName, 'Barro Industries OPC');
    assert.deepEqual(lb.alternateName, ['Barro Kitchens', 'Barro Kitchens by Barro Industries'], 'PERMANENT: kept as an alternate name even after a rebrand');
    assert.deepEqual(lb.brand, { '@type': 'Brand', name: 'Barro Kitchens' });
    assert.deepEqual(lb.sameAs, ['https://www.facebook.com/barrokitchens', lb.hasMap]);
    assert.ok(lb.hasMap.startsWith('https://www.google.com/maps/place/'));
    assert.equal(lb.url, home.url);
    assert.deepEqual(ws, { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Barro Industries', alternateName: ['Barro Kitchens', 'Barro Kitchens by Barro Industries'], url: 'https://barroindustries.com/', copyrightHolder: { '@id': 'https://barroindustries.com/#business' }, copyrightYear: 2026 });
    // the copyright block: every project photograph the page shows, each an ImageObject with its creator, credit, notice, holder and the usage-terms page (#copyright = the footer notice)
    assert.equal(imgs['@context'], 'https://schema.org');
    assert.ok(imgs['@graph'].length >= 13, 'the 13 project photographs');
    for (const n of imgs['@graph']) {
      assert.deepEqual(Object.keys(n), ['@type', 'contentUrl', 'creator', 'creditText', 'copyrightNotice', 'copyrightHolder', 'license', 'acquireLicensePage']);
      assert.equal(n['@type'], 'ImageObject');
      assert.match(n.contentUrl, /^https:\/\/barroindustries\.com\/site\/img\/projects\/(ispsc|dmmmsu)\/\d\d\.webp$/);
      assert.deepEqual([n.creator, n.creditText, n.copyrightNotice, n.copyrightHolder, n.license, n.acquireLicensePage], [{ '@type': 'Organization', name: 'Barro Industries OPC' }, 'Barro Industries OPC', '© 2026 Barro Industries OPC', { '@id': 'https://barroindustries.com/#business' }, 'https://barroindustries.com/#copyright', 'https://barroindustries.com/#copyright']);
    }
    assert.equal(new Set(imgs['@graph'].map((n) => n.contentUrl)).size, imgs['@graph'].length);
    assert.ok(home.html.includes('<p class="foot-legal" id="copyright">'), 'the usage-terms page the markup points at: the homepage footer notice, #copyright');
  });

  it('on /catalogue/: one ItemList with a ListItem per card, in page order — name and the #cat-… anchor of its category, no other key', () => {
    assert.equal(catalogue.ld.length, 1);
    const list = catalogue.ld[0];
    assert.equal(list['@type'], 'ItemList');
    assert.equal(list.url, catalogue.url);
    assert.equal(list.name, 'Commercial kitchen equipment catalogue');
    const sections = catalogue.html.split('<section class="cat-group" id="cat-').slice(1).map((g) => ({
      id: g.match(/^([a-z_]+)"/)[1],
      names: [...g.matchAll(/<li class="cat-card[^"]*"[^>]*>[\s\S]*?<h3>([^<]*)<\/h3>/g)].map((m) => decode(m[1])),
    }));
    const expected = sections.flatMap((s) => s.names.map((name) => ({ name, url: `${catalogue.url}#cat-${s.id}` })));
    assert.equal(expected.length, 25, 'the page shows 25 products: the eleven configurable families first in their categories, then the 14 fixed items');
    assert.equal(list.numberOfItems, 25);
    assert.deepEqual(list.itemListElement.map((i) => ({ name: i.name, url: i.url })), expected);
    list.itemListElement.forEach((item, i) => {
      assert.deepEqual(Object.keys(item), ['@type', 'position', 'name', 'url']);
      assert.equal(item['@type'], 'ListItem');
      assert.equal(item.position, i + 1);
      assert.ok(catalogue.html.includes(`id="${item.url.split('#')[1]}"`), `${item.url} has no anchor on the page`);
    });
    assert.deepEqual([...allKeys(list)].sort(), ['@context', '@type', 'itemListElement', 'name', 'numberOfItems', 'position', 'url']);
    assert.deepEqual(sections.map((s) => s.id), ['preparation', 'washing', 'cooking', 'ventilation', 'storage', 'refrigeration']);
  });

  it('(local only) is exactly what a fresh build produces from the private master', { skip: (() => { try { return resolveMaster() ? false : 'the private master (products-database.json) is not present'; } catch (_) { return 'no master'; } })() }, () => {
    const master = JSON.parse(B.stripJsonComments(fs.readFileSync(resolveMaster(), 'utf8').replace(/^﻿/, '')));
    const ids = master.products.map((p) => p.id);
    const pub = B.loadPublicCategories({ ids });
    const published = B.publishedProductIds(master, pub);
    const photoMap = B.loadPhotoMap({ ids, skipIds: ids.filter((id) => !published.has(id)) });
    const fams = B.loadPublicFamilies({ published, master });
    const fresh = B.renderItemListLd(master, { photos: photoMap.photos, publicCategories: pub, families: fams });
    const committed = catalogue.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.equal(committed, fresh, 'the ItemList in catalogue/index.html is stale — run: node scripts/build-catalogue.js');
  });
});

function resolveMaster() {
  for (const p of [path.join(ROOT, 'products-database.json'), path.join(os.homedir(), 'Desktop', 'barro-private', 'products-database.json')]) if (fs.existsSync(p)) return p;
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('4 · the brand: "Barro Industries" is the primary public name; "Barro Kitchens" is the current brand a rename SWAPS (data-brand) and a PERMANENT historic name a rename KEEPS (title, descriptions, alternateName, the About line: data-brand-legacy)', () => {
  const BRAND = 'Barro Kitchens';
  const PHRASE = 'Barro Kitchens by Barro Industries';
  const count = (text) => text.split(BRAND).length - 1;
  const ALT = ['Barro Kitchens', 'Barro Kitchens by Barro Industries'];
  const ldHits = (ld) => { const out = []; (function walk(v, p) { if (typeof v === 'string') { if (v.includes(BRAND)) out.push(p); } else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], p ? `${p}.${k}` : k); })(ld, ''); return out; };

  it('wraps every VISIBLE mention in the body either in a bare <span data-brand> that holds exactly the name — SWAPPABLE: homepage header sub-line + footer, catalogue header sub-line + eyebrow + footer — or inside a data-brand-legacy element — PERMANENT: the homepage About line; the two markers are distinct and never on one element', () => {
    for (const [p, nSwap, nLegacy] of [[home, 2, 2], [catalogue, 3, 1]]) {   // the permanent mentions: the About line (homepage only) and the footer's copyright notice (both pages)
      const visible = p.S.texts.filter((t) => inBody(t.chain) && t.text.includes(BRAND));
      const swap = visible.filter((t) => 'data-brand' in t.chain[t.chain.length - 1].attrs);
      const legacy = visible.filter((t) => t.chain.some((e) => 'data-brand-legacy' in e.attrs));
      assert.equal(swap.length, nSwap, `${p.file}: swappable mentions`);
      assert.equal(legacy.length, nLegacy, `${p.file}: permanent mentions`);
      assert.equal(visible.length, nSwap + nLegacy, `${p.file}: a visible mention is neither swappable nor permanent`);
      for (const t of swap) {
        const parent = t.chain[t.chain.length - 1];
        assert.equal(parent.tag, 'span', `${p.file}: a mention is not wrapped`);
        assert.deepEqual(parent.attrs, { 'data-brand': '' }, `${p.file}: the wrapper must be a bare <span data-brand>`);
        assert.equal(t.text, BRAND, `${p.file}: the span holds more than the name`);
      }
      assert.equal(p.S.elements.filter((e) => e.tag === 'span' && 'data-brand' in e.attrs).length, nSwap, `${p.file}: a data-brand span holds no brand name`);
      assert.equal(p.S.elements.filter((e) => 'data-brand-legacy' in e.attrs).length, nLegacy, `${p.file}: data-brand-legacy elements`);
      assert.ok(!p.S.elements.some((e) => 'data-brand' in e.attrs && 'data-brand-legacy' in e.attrs), `${p.file}: one element carries both markers`);
      assert.ok(!p.S.elements.some((e) => 'data-brand' in e.attrs && e.chain.some((c) => 'data-brand-legacy' in c.attrs)) && !legacy.some((t) => t.chain.some((e) => 'data-brand' in e.attrs)), `${p.file}: the markers are nested`);
      assert.ok(p.html.includes('<span class="site-brand-sub"><span data-brand>Barro Kitchens</span>™</span>'), `${p.file}: the header sub-line`);
    }
    assert.ok(home.footer.includes('<span data-brand>Barro Kitchens</span> is a brand of Barro Industries OPC.'));
    for (const p of [home, catalogue]) assert.ok(p.footer.includes('Barro Industries OPC (<span data-brand-legacy>Barro Kitchens</span>). All photos, designs and content on this site are our own work and may not be copied or reused without written permission.'), `${p.file}: the copyright notice in the footer`);
    assert.ok(catalogue.footer.includes('<span data-brand>Barro Kitchens</span> is a brand of Barro Industries OPC.'));
    assert.ok(catalogue.html.includes('<p class="eyebrow"><span data-brand>Barro Kitchens</span></p>'));
    // the permanent line: ONE grammatical sentence in the About copy, right after the family-business line, marked data-brand-legacy
    assert.ok(home.html.includes('<p class="about-note">The company began as a family business in Baguio City and La Union.</p>\n      <p class="about-note" data-brand-legacy>Our kitchens have long been known as Barro Kitchens.</p>'));
    // the other data-brand elements: the hero's logo animation (a brand-specific ASSET, labelled with the name; the catalogue page has none) and the Messenger
    // "Message us" links, whose URL carries the brand's handle (https://m.me/barrokitchens; owner 2026-10-22): the homepage has two (contact + footer), the catalogue two
    // (call to action + footer). tests/seo-pages.test.mjs pins where each one sits.
    const others = (p) => p.S.elements.filter((e) => e.tag !== 'span' && 'data-brand' in e.attrs).map((e) => (e.tag === 'a' ? `a ${e.attrs.href}` : e.tag));
    assert.deepEqual(others(home), ['video', 'a https://m.me/barrokitchens', 'a https://m.me/barrokitchens']);
    assert.deepEqual(others(catalogue), ['a https://m.me/barrokitchens', 'a https://m.me/barrokitchens']);
  });

  it('is CSS-neutral: no stylesheet or script selects or reads [data-brand] or [data-brand-legacy]', () => {
    for (const f of ['css/site.css', 'css/catalogue.css', 'css/quote-request.css', 'css/styles.css', 'js/site.js', 'js/catalogue.js', 'js/quote-request.js']) assert.ok(!/data-brand/.test(read(f)), `${f} touches data-brand`);
  });

  it('REQUIRES the name in the search results (owner ruling 2026-10-22: Barro Kitchens is well known, so searching it must show Barro Industries, now and after any rebrand): "Barro Kitchens by Barro Industries" in the <title>, og:title and twitter:title of "/" and /catalogue/ and in SITE_TITLE, and "Barro Kitchens" once in each meta description', () => {
    for (const p of [home, catalogue]) {
      for (const v of [p.title, p.meta('og:title'), p.meta('twitter:title')]) assert.ok(v.includes(PHRASE), `${p.file}: the title lacks "${PHRASE}"`);
      for (const k of ['description', 'og:description', 'twitter:description']) assert.equal(count(p.meta(k)), 1, `${p.file}: ${k} names the brand ${count(p.meta(k))} times`);
      assert.equal(p.meta('og:site_name'), 'Barro Industries', 'og:site_name stays the company');
      for (const k of ['og:site_name', 'og:image:alt', 'twitter:image:alt']) assert.ok(!p.meta(k).includes(BRAND), `${p.file}: ${k}`);
    }
    assert.ok(home.title.endsWith(' | ' + PHRASE), 'the home title ends with the permanent name, after the search words (owner ruling 2026-10-28)');
    assert.ok(catalogue.title.endsWith(' | ' + PHRASE), 'the catalogue title ends with it, as the content pages end with "| Barro Industries"');
    assert.ok(siteTitleInApp.includes(PHRASE));
  });

  it('pins the exact inventory of places the brand name appears, so a rename is a find-and-replace of this list — what it SWAPS (data-brand) and what it KEEPS (permanent)', () => {
    // index.html, 20 in all. KEEPS (permanent): <title>, og:title, twitter:title (3), description, og:description, twitter:description (3), the PERMANENT note (a comment, 3 mentions),
    //   JSON-LD LocalBusiness.alternateName x2 and WebSite.alternateName x2 (4), the About line (1), the footer's copyright notice (1; data-brand-legacy). SWAPS or is brand artwork: the header sub-line and the footer line (2 spans),
    //   LocalBusiness.brand.name (1), the header logo's alt (1) and the animation's aria-label (1).
    const metaNames = home.S.elements.filter((e) => e.tag === 'meta' && count(e.attrs.content || '')).map((e) => e.attrs.name || e.attrs.property).sort();
    assert.deepEqual(metaNames, ['description', 'og:description', 'og:title', 'twitter:description', 'twitter:title']);
    const homeAlt = home.S.attrs.filter((a) => a.tag !== 'meta' && a.value.includes(BRAND));
    assert.deepEqual(homeAlt.map((a) => `${a.tag}[${a.name}]=${a.value}`), ['img[alt]=Barro Kitchens logo', 'video[aria-label]=Barro Kitchens logo animation']);
    assert.deepEqual(ldHits(home.ld), ['0.alternateName.0', '0.alternateName.1', '0.brand.name', '1.alternateName.0', '1.alternateName.1']);
    assert.deepEqual(home.ld[0].alternateName, ALT);
    assert.deepEqual(home.ld[1].alternateName, ALT);
    const homeNotes = home.S.comments.filter((c) => c.text.includes(BRAND));
    assert.equal(homeNotes.length, 1, 'only the PERMANENT note names the brand in a comment');
    assert.equal(count(homeNotes[0].text), 3);
    assert.match(homeNotes[0].text, /^ PERMANENT \(owner ruling, 2026-10-22\)/);
    assert.equal(home.S.scripts.filter((s) => s.attrs.type !== 'application/ld+json' && s.body.includes(BRAND)).length, 0, 'a script names the brand');
    assert.equal(count(home.html), 20);
    // catalogue/index.html, 12: <title>, og:title, twitter:title, 3 descriptions, the PERMANENT note (1), 3 visible spans, the footer's copyright notice (1), 1 logo alt; nothing in the ItemList or the data island
    assert.deepEqual(catalogue.S.attrs.filter((a) => a.tag !== 'meta' && a.value.includes(BRAND)).map((a) => `${a.tag}[${a.name}]=${a.value}`), ['img[alt]=Barro Kitchens logo']);
    assert.equal(catalogue.S.elements.filter((e) => e.tag === 'meta' && count(e.attrs.content || '')).length, 5);
    assert.equal(catalogue.S.comments.filter((c) => c.text.includes(BRAND)).length, 1);
    assert.equal(catalogue.S.scripts.filter((s) => s.body.includes(BRAND)).length, 0);
    assert.equal(count(catalogue.head), 7);
    assert.equal(count(catalogue.html), 12);
    // the places outside the two pages: the intake's privacy notice (and its byte-identical mirror in functions/) and the generator's one constant
    assert.equal(count(read('js/qr-def.js')), 1);
    assert.equal(read('functions/qr-def.js'), read('js/qr-def.js'));
    assert.ok(/trading as Barro Kitchens\./.test(read('js/qr-def.js')));
    assert.equal(B.SITE_BRAND_NAME, BRAND);
    assert.equal((read('scripts/build-catalogue.js').match(/'Barro Kitchens'/g) || []).length, 1, 'the generator holds the brand in exactly one constant');
    const total = count(home.html) + count(catalogue.html) + count(read('js/qr-def.js')) + 1;
    assert.equal(home.S.elements.filter((e) => e.tag === 'script' && e.attrs.type === 'application/ld+json').length, 3);
    assert.equal(total, 20 + 12 + 1 + 1, 'the brand appears somewhere new: wrap it in <span data-brand> (swappable) or data-brand-legacy (permanent), or list it here, so a rename still finds every place');
  });

  it('writes the PERMANENT rule down where the permanent name lives — the homepage head and the catalogue head — in a comment: if the brand is renamed, the new brand is ADDED and "Barro Kitchens" STAYS as alternateName ("formerly Barro Kitchens"), and data-brand marks what a rename swaps, data-brand-legacy what it keeps', () => {
    const note = home.S.comments.find((c) => /PERMANENT/.test(c.text));
    assert.ok(note && inHead(note.chain));
    for (const w of ['ADDED', 'STAYS', 'alternateName', 'formerly Barro Kitchens', 'data-brand-legacy', 'data-brand marks what a rename SWAPS']) assert.ok(note.text.includes(w), `the note lacks "${w}"`);
    const cat = catalogue.S.comments.find((c) => /PERMANENT/.test(c.text));
    assert.ok(cat && inHead(cat.chain) && /permanent, historic name/.test(cat.text));
  });

  it('keeps "Barro Industries" as the primary public name: the header name, og:site_name, the WebSite name, the LocalBusiness name and legal name', () => {
    for (const p of [home, catalogue]) assert.ok(p.header.includes('<span class="site-brand-name">Barro Industries</span>'));
    assert.equal(home.meta('og:site_name'), 'Barro Industries');
    assert.equal(home.ld[0].name, 'Barro Industries');
    assert.equal(home.ld[0].legalName, 'Barro Industries OPC');
    assert.equal(home.ld[1].name, 'Barro Industries');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('5 · scripts/build-catalogue.js generates the ItemList (names + category anchors, nothing else) and the brand span', () => {
  const CATS = [{ id: 'cooking_line', label: 'Cooking Line', code: 'CE', color: '#E74C3C', icon: 'x' }, { id: 'prep_washing', label: 'Preparation & Washing', code: 'PW', color: '#3498DB', icon: 'y' }];
  const PUBMAP = { cooking_line: 'cooking', prep_washing: 'preparation' };
  const prod = (over) => ({ id: 'T-100', category: 'cooking_line', name: 'Plain Table', unit: 'pc', specs: [], notes: 'SS304', basePrice: 18000, formula: { baseLengthMm: 600 }, leadTime: '10 days', laborHours: { fabrication: 8 }, ...over });
  const db = (products) => ({ categories: CATS, products });
  const pubOf = (products) => ({ products: Object.fromEntries(products.map((p) => [p.id, PUBMAP[p.category]])), excludedProducts: {} });
  const list = (products, extra) => JSON.parse(B.renderItemListLd(db(products), { publicCategories: pubOf(products), ...(extra || {}) }));
  const products = [prod({ id: 'T-001', name: 'Stove <b>One</b>' }), prod({ id: 'T-002', category: 'prep_washing', name: 'Sink & Table' }), prod({ id: 'T-003', name: 'Griddle' }), prod({ id: 'T-004', name: "Fryer $& $' $` $$" })];

  it('lists every product in page order (the public categories as ruled), each with its name and its category anchor only', () => {
    const l = list(products);
    assert.equal(l['@type'], 'ItemList');
    assert.equal(l.numberOfItems, 4);
    assert.deepEqual(l.itemListElement.map((i) => [i.position, i.name, i.url]), [
      [1, 'Sink & Table', 'https://barroindustries.com/catalogue/#cat-preparation'],
      [2, 'Stove <b>One</b>', 'https://barroindustries.com/catalogue/#cat-cooking'],
      [3, 'Griddle', 'https://barroindustries.com/catalogue/#cat-cooking'],
      [4, "Fryer $& $' $` $$", 'https://barroindustries.com/catalogue/#cat-cooking'],
    ]);
    for (const i of l.itemListElement) assert.deepEqual(Object.keys(i), ['@type', 'position', 'name', 'url']);
  });

  it('is price-free by construction: no price, formula, labour or lead-time field of the master reaches it', () => {
    const json = B.renderItemListLd(db(products), { publicCategories: pubOf(products) });
    for (const secret of ['basePrice', '18000', 'formula', 'baseLengthMm', 'leadTime', 'laborHours', 'fabrication']) assert.ok(!json.includes(secret), `${secret} reached the item list`);
    assert.ok(![...allKeys(JSON.parse(json))].some((k) => /price|offer|sku|image|description/i.test(k)));
  });

  it('refuses the whole build when a name carries a money token or the partner company (the same single walk as the cards)', () => {
    for (const name of ['Table ₱1,500', 'Table with volume pricing']) assert.throws(() => B.renderItemListLd(db([prod({ name })]), { publicCategories: pubOf([prod({ name })]) }), (e) => e instanceof B.CatalogueGuardError);
    // the last-line scan of the finished JSON (the list's own name is the one string the walk does not see)
    assert.throws(() => B.renderItemListLd(db(products), { publicCategories: pubOf(products), listName: 'Price list ₱1,500' }), (e) => e instanceof B.CatalogueGuardError);
    assert.throws(() => B.renderItemListLd(db(products), { publicCategories: pubOf(products), listName: 'Brilliant' + ' Steel catalogue' }), (e) => e instanceof B.CatalogueGuardError);
    const partner = 'Brilliant' + ' Steel';
    assert.throws(() => B.renderItemListLd(db([prod({ name: `${partner} range` })]), { publicCategories: pubOf([prod({ name: `${partner} range` })]) }), (e) => e instanceof B.CatalogueGuardError);
  });

  it('can never close its <script> element or open a comment: "<" is written as \\u003c', () => {
    const json = B.renderItemListLd(db(products), { publicCategories: pubOf(products) });
    assert.ok(!json.includes('<'), 'a raw < is in the JSON-LD');
    assert.ok(json.includes('Stove \\u003cb>One\\u003c/b>'));
    assert.equal(JSON.parse(json).itemListElement[1].name, 'Stove <b>One</b>');
  });

  it('is injected between the LD:ITEMLIST markers of the <head> only, idempotently, leaving every other byte alone, and a shell without the markers is refused', () => {
    const shell = `<head>\n<title>x</title>\n${B.LD_START_MARKER}\nOLD\n${B.LD_END_MARKER}\n</head><body>$& $' $\` keep</body>`;
    const json = B.renderItemListLd(db(products), { publicCategories: pubOf(products) });
    const once = B.injectItemList(shell, json);
    assert.equal(B.injectItemList(once, json), once, 'not idempotent');
    // the names carry $& $' $` $$ (String.replace patterns): they must land verbatim, never splice the page into the JSON
    assert.ok(once.includes(`${B.LD_START_MARKER}\n<script type="application/ld+json">${json}</script>\n${B.LD_END_MARKER}`));
    assert.equal(JSON.parse(once.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]).itemListElement[3].name, "Fryer $& $' $` $$");
    assert.ok(once.startsWith('<head>\n<title>x</title>\n') && once.endsWith('</head><body>$& $\' $` keep</body>'));
    assert.ok(!once.includes('OLD'));
    assert.throws(() => B.injectItemList('<head></head>', json), /LD:ITEMLIST:START and LD:ITEMLIST:END markers exactly once/);
    assert.throws(() => B.injectItemList(shell + B.LD_END_MARKER, json), /exactly once/);
    const swapped = shell.replace(B.LD_START_MARKER, '\u0001').replace(B.LD_END_MARKER, B.LD_START_MARKER).replace('\u0001', B.LD_END_MARKER);
    assert.throws(() => B.injectItemList(swapped, json), /LD:ITEMLIST:END appears before LD:ITEMLIST:START/);
    // the committed page carries the markers exactly once, inside the <head>
    for (const m of [B.LD_START_MARKER, B.LD_END_MARKER]) { assert.equal(catalogue.html.split(m).length - 1, 1); assert.ok(catalogue.html.indexOf(m) < catalogue.html.indexOf('</head>')); }
  });

  it('writes the catalogue eyebrow through the SITE_BRAND_NAME constant, inside <span data-brand>', () => {
    const html = B.renderCatalogue(db(products), { publicCategories: pubOf(products) });
    assert.ok(html.includes(`<p class="eyebrow"><span data-brand>${B.SITE_BRAND_NAME}</span></p>`));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('6 · the hero logo intro: a translucent clip behind the headline that flies to the header logo, and leaves nothing behind', () => {
  const video = home.S.elements.filter((e) => e.tag === 'video');
  const sources = home.S.elements.filter((e) => e.tag === 'source' && e.chain.some((c) => c.tag === 'video'));
  const hero = home.html.match(/<section id="hero">[\s\S]*?<\/section>/)[0];
  const ghosts = home.S.elements.filter((e) => /(^|\s)hero-ghost(\s|$)/.test(e.attrs.class || ''));
  const mp4 = (rel) => fs.readFileSync(path.join(ROOT, rel));
  // a minimal MP4 box reader: the handler type of every track ('vide' / 'soun'), the movie duration and the first video track's size
  function mp4Info(buf) {
    const handlers = []; let duration = null, size = null;
    (function walk(a, z, path_) {
      let i = a;
      while (i + 8 <= z) {
        let n = buf.readUInt32BE(i), hdr = 8; const type = buf.toString('latin1', i + 4, i + 8);
        if (n === 1) { n = Number(buf.readBigUInt64BE(i + 8)); hdr = 16; } else if (n === 0) n = z - i;
        if (n < hdr || i + n > z) break;
        if (['moov', 'trak', 'mdia'].includes(type)) walk(i + hdr, i + n, path_.concat(type));
        else if (type === 'hdlr' && path_.includes('mdia')) handlers.push(buf.toString('latin1', i + hdr + 8, i + hdr + 12));
        else if (type === 'mvhd') { const v = buf[i + hdr]; const o = i + hdr + (v === 1 ? 20 : 12); duration = v === 1 ? Number(buf.readBigUInt64BE(o + 4)) / buf.readUInt32BE(o) : buf.readUInt32BE(o + 4) / buf.readUInt32BE(o); }
        else if (type === 'tkhd' && !size) { const v = buf[i + hdr]; const o = i + hdr + (v === 1 ? 88 : 76); const w = buf.readUInt32BE(o) / 65536, h = buf.readUInt32BE(o + 4) / 65536; if (w) size = { w, h }; }
        i += n;
      }
    })(0, buf.length, []);
    return { handlers, duration, size };
  }

  // ── the markup ─────────────────────────────────────────────────────────────────────────────────────────────
  it('puts ONE overlay in the hero — a hidden, aria-hidden .hero-ghost, a direct child of #hero after the photo and the scrim and before the text — holding ONE <video>: muted, playsinline, preload none, no autoplay / loop / controls / poster / src / tabindex', () => {
    assert.equal(video.length, 1);
    assert.equal(catalogue.S.elements.filter((e) => e.tag === 'video').length, 0);
    assert.equal(ghosts.length, 1);
    const g = ghosts[0];
    assert.equal(g.tag, 'div');
    assert.deepEqual(g.attrs, { class: 'hero-ghost', 'aria-hidden': 'true', hidden: '' }, 'the overlay carries exactly a class, aria-hidden and hidden');
    assert.equal(g.chain[g.chain.length - 1].attrs.id, 'hero', 'the overlay is not a direct child of #hero');
    const at = (s) => hero.indexOf(s);
    assert.ok(at('class="hero-bg"') >= 0 && at('class="hero-bg"') < at('class="hero-scrim"') && at('class="hero-scrim"') < at('class="hero-ghost"') && at('class="hero-ghost"') < at('class="site-wrap hero-in"'), 'order in the hero: photo, scrim, overlay, text');
    // the video is the overlay's only content, and nothing else in the hero is media
    assert.equal(video[0].chain[video[0].chain.length - 1].attrs.class, 'hero-ghost');
    const v = video[0].attrs;
    for (const a of ['muted', 'playsinline', 'data-brand', 'disablepictureinpicture', 'disableremoteplayback']) assert.ok(a in v, `video lacks ${a}`);
    // preload="none" + a script-started play(), NOT autoplay + metadata: this index.html is also the installed app and the team sign-in, #site is display:none
    // there, and an autoplay video in a hidden page still downloads its whole file on every launch (measured: 0.8-1.3 MB per app start)
    assert.equal(v.preload, 'none');
    for (const a of ['autoplay', 'loop', 'controls', 'poster', 'src', 'tabindex', 'controlslist', 'fetchpriority']) assert.ok(!(a in v), `video must not carry ${a}`);
    assert.equal(v['aria-label'], 'Barro Kitchens logo animation');
    assert.equal(v.width, '720'); assert.equal(v.height, '720');
    assert.ok(!/<script/.test(hero), 'no script belongs inside the hero');
    assert.ok(!/<(audio|track)\b/.test(hero));
    assert.ok(!hero.includes('brand-reveal-poster'), 'there is no poster: nothing can linger as a big ghost when play() is refused');
  });

  it('leaves nothing of the old small mark in the hero: no .hero-mark anywhere, the text column\'s own spacing is back (48px under the header, 24px under the 23, 32px above the buttons, no phone-only trims), and the desktop scrim still opens up on the right so the photo shows', () => {
    for (const [label, text] of [['index.html', home.html], ['css/site.css', siteCss], ['js/site.js', siteJs]]) assert.ok(!/hero-mark/.test(text), `${label} still mentions .hero-mark`);
    const heroIn = home.S.elements.filter((e) => e.chain.length && e.chain[e.chain.length - 1].attrs.class === 'site-wrap hero-in').map((e) => e.attrs.class);
    assert.deepEqual(heroIn, ['hero-copy'], 'the text column holds only the copy');
    assert.ok(siteCss.includes('#site .hero-in{width:100%;padding-top:calc(var(--site-head) + 48px);padding-bottom:calc(clamp(48px,9vh,104px) + var(--proof-lift))}'));
    assert.ok(siteCss.includes('#site .hero-years{display:flex;align-items:flex-end;gap:16px;margin-bottom:24px}'));
    assert.ok(siteCss.includes('#site .hero-cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px}'));
    assert.ok(!/@media \(max-width:899px\)\{\s*#site \.hero-years/.test(siteCss), 'the phone-only spacing trims that made room for the mark are back');
    assert.ok(!/#site \.hero-in\{[^}]*display:flex/.test(siteCss), 'the text column is no longer a flex column that orders a mark above the copy');
    assert.ok(siteCss.includes('rgba(11,27,63,.18) 80%,rgba(11,27,63,.06) 100%)'), 'the desktop scrim must open up on the right so the hero photo is visible');
    assert.ok(/#hero\{position:relative;isolation:isolate;display:flex;align-items:flex-end;/.test(siteCss));
  });

  it('offers both files as sources — the 480px one first, under 900px; the 720px one otherwise — each gated on prefers-reduced-motion: no-preference, so a visitor who asked for less motion downloads no video', () => {
    assert.deepEqual(sources.map((s) => [s.attrs.src, s.attrs.type, s.attrs.media]), [
      ['site/img/brand/brand-reveal-480.mp4', 'video/mp4', '(max-width:899px) and (prefers-reduced-motion:no-preference)'],
      ['site/img/brand/brand-reveal-720.mp4', 'video/mp4', '(prefers-reduced-motion:no-preference)'],
    ]);
    for (const s of sources) assert.ok(exists(s.attrs.src), `${s.attrs.src} is missing`);
    assert.ok(exists('site/img/brand/brand-reveal-poster.webp') && exists('site/img/brand/brand-reveal-poster.jpg'), 'the poster artwork stays in the brand folder (unused by the page: the intro has no poster)');
    // the 900px threshold is the same one the layout flips at (the overlay moves to the open photo on the right), so the file matches the size on screen
    assert.ok(/@media \(min-width:900px\)\{\s*#site #hero h1\{[^}]*\}[\s\S]*?#site \.hero-ghost\{top:calc\(43vh - 18vw\);top:calc\(43svh - min\(27vmin,18vw\)\);left:auto;/.test(siteCss));
  });

  it('(the MP4 reader behind the next test) sees an audio track when there is one, and reads size and duration from the boxes', () => {
    const box = (type, ...kids) => { const body = Buffer.concat(kids); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
    const hdlr = (t) => { const b = Buffer.alloc(12 + 8); b.write(t, 8, 'latin1'); return box('hdlr', b); };
    const mvhd = (() => { const b = Buffer.alloc(100); b.writeUInt32BE(1000, 12); b.writeUInt32BE(10000, 16); return box('mvhd', b); })();
    const tkhd = (() => { const b = Buffer.alloc(84); b.writeUInt32BE(480 * 65536, 76); b.writeUInt32BE(480 * 65536, 80); return box('tkhd', b); })();
    const silent = box('moov', mvhd, box('trak', tkhd, box('mdia', hdlr('vide'))));
    const withAudio = box('moov', mvhd, box('trak', tkhd, box('mdia', hdlr('vide'))), box('trak', box('mdia', hdlr('soun'))));
    assert.deepEqual(mp4Info(silent), { handlers: ['vide'], duration: 10, size: { w: 480, h: 480 } });
    assert.deepEqual(mp4Info(withAudio).handlers, ['vide', 'soun']);
  });

  it('ships the files the owner supplied, as is: 720x720 and 480x480, 10.0 s, H.264 video only — NO audio track — and light enough (1.5 MB / 1 MB)', () => {
    for (const [rel, w, maxBytes] of [['site/img/brand/brand-reveal-720.mp4', 720, 1.5e6], ['site/img/brand/brand-reveal-480.mp4', 480, 1.0e6]]) {
      const buf = mp4(rel), info = mp4Info(buf);
      assert.deepEqual(info.handlers, ['vide'], `${rel}: tracks ${info.handlers.join()} (an audio track would break "muted, silent")`);
      assert.deepEqual(info.size, { w, h: w }, rel);
      assert.ok(Math.abs(info.duration - 10) < 0.1, `${rel}: ${info.duration}s`);
      assert.ok(buf.length < maxBytes, `${rel}: ${buf.length} bytes`);
      assert.ok(buf.includes(Buffer.from('avc1')), `${rel} is not H.264`);
    }
    // "fast start": the movie box precedes the media data, so a play() on a preload="none" clip can begin after the first range request
    for (const rel of ['site/img/brand/brand-reveal-720.mp4', 'site/img/brand/brand-reveal-480.mp4']) { const b = mp4(rel); assert.ok(b.indexOf(Buffer.from('moov')) > 0 && b.indexOf(Buffer.from('moov')) < b.indexOf(Buffer.from('mdat')), `${rel}: moov after mdat`); }
    assert.ok(mp4('site/img/brand/brand-reveal-poster.webp').length < 40000);
    assert.deepEqual(B.webpSize(mp4('site/img/brand/brand-reveal-poster.webp')), { width: 720, height: 720 });
  });

  it('never plays with sound: muted in the markup, no script unmutes it or sets a volume, and only js/site.js ever starts the clip', () => {
    for (const f of ['js/site.js', 'js/catalogue.js', 'js/quote-request.js']) assert.ok(!/\.muted\s*=\s*false|\.volume\s*=|unmute/i.test(read(f)), `${f} touches the video's sound`);
    for (const f of ['js/catalogue.js', 'js/quote-request.js', 'js/app.js']) assert.ok(!/hero-ghost|#hero video|vid\.play|video\.play\(/.test(read(f)), `${f} starts the clip`);
    assert.ok('muted' in video[0].attrs && !('autoplay' in video[0].attrs));
    assert.ok(!/\.muted\s*=/.test(siteJs.replace(/\/\*[\s\S]*?\*\//g, '')));
    // started by play() and nothing else: no script switches autoplay on either
    assert.ok(!/\.autoplay\s*=|setAttribute\(\s*['"]autoplay/.test(siteJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'js/site.js turns autoplay on');
  });

  it('keeps the hero PHOTO the LCP image (fetchpriority high, eager) and the overlay off the critical path: no poster, preload none, hidden and at opacity 0 until the clip plays — a <video> that is not drawn can never be the largest paint — no preload link, no fetchpriority on the video', () => {
    const bg = home.S.elements.find((e) => e.tag === 'img' && /hero-bg/.test(e.attrs.class || ''));
    assert.equal(bg.attrs.fetchpriority, 'high');
    assert.ok(!('loading' in bg.attrs && bg.attrs.loading === 'lazy'));
    assert.ok(!home.S.elements.some((e) => e.tag === 'link' && /brand-reveal/.test(e.attrs.href || '')), 'a <link rel=preload> would put the clip on the critical path');
    assert.ok(!('fetchpriority' in video[0].attrs));
    // nothing of the overlay is drawn at first paint: hidden in the markup, opacity 0 in the stylesheet, and the stylesheet never shows it by itself
    assert.ok('hidden' in ghosts[0].attrs);
    assert.ok(/#site \.hero-ghost\{[^}]*;opacity:0;/.test(siteCss));
    assert.equal([...siteCss.matchAll(/#site \.hero-ghost\.is-on\{/g)].length, 2, 'only the .is-on state (set by js/site.js once the clip plays) gives it any opacity');
  });

  it('is NEVER precached: not site/img/brand/, no video file, in sw.js PRECACHE or precache-manifest.json — and CHECK 9 guards it by name', () => {
    for (const f of ['sw.js', 'precache-manifest.json']) assert.ok(!/site\/img\/brand|brand-reveal|\.(mp4|webm|mov|m4v)/i.test(read(f)), `${f} lists the logo animation`);
    const sh = read('scripts/ci-invariants.sh');
    assert.ok(sh.includes("'/site/img/brand/|") && sh.includes('mp4|webm|mov|m4v'), 'CHECK 9 has no guard for the brand folder / video files');
    assert.ok(/FAIL: sw\.js PRECACHE lists the hero logo animation/.test(sh));
    assert.ok(!/brand-reveal|site\/img\/brand/.test(read('js/config.js')), 'config.js PAGE_SCRIPTS lists it');
  });

  // ── the stylesheet ─────────────────────────────────────────────────────────────────────────────────────────
  it('draws the overlay big and translucent, centred across the hero and in the middle of its first screen, feathered by a circular mask and never taking a click: absolute, z-index -1 (above the photo and the scrim, below every line of text), opacity 0 until the clip plays', () => {
    const base = siteCss.match(/#site \.hero-ghost\{([^}]*)\}/)[1].split(';');
    for (const decl of ['position:absolute', 'z-index:-1', 'right:0', 'bottom:auto', 'left:0', 'margin:0 auto', 'opacity:0', 'pointer-events:none']) assert.ok(base.includes(decl), `.hero-ghost lacks ${decl}`);
    // the vertical position is a constant of the VIEWPORT (the middle of the hero's first screen), never a percentage of the hero: the hero grows by tens of px when the web fonts
    // swap in after load, and a box centred in it would move with it — a measured layout shift (CLS 0.021 -> 0.026). A plain vh fallback comes before the svh version.
    assert.ok(base.includes('top:calc(46svh - min(35vw,45svh))') && base.includes('top:calc(46vh - 35vw)') && base.indexOf('top:calc(46vh - 35vw)') < base.indexOf('top:calc(46svh - min(35vw,45svh))'));
    assert.ok(!base.some((d) => /^(top|bottom):\d+(\.\d+)?%$/.test(d)) && !base.includes('margin:auto') && !base.includes('bottom:0') && !base.includes('top:0'), 'positioned from the hero\'s own height: it would move when the fonts swap');
    assert.ok(base.includes('width:min(70vw,90svh)') && base.includes('height:min(70vw,90svh)'), 'about 70vw across on a phone (never taller than the viewport)');
    // a browser that does not know svh drops the min() declaration: the plain-vw one before it keeps the box 70vw across instead of stretching it over the whole hero
    assert.ok(base.includes('width:70vw') && base.includes('height:70vw') && base.indexOf('width:70vw') < base.indexOf('width:min(70vw,90svh)') && base.indexOf('height:70vw') < base.indexOf('height:min(70vw,90svh)'));
    assert.ok(base.some((d) => /^transition:opacity \.7s ease-out$/.test(d)), 'the fade-in is a .7 s opacity transition');
    // a circular, feathered mask (and the -webkit- prefix): fully opaque over the cube and its flame, zero at the middle of every edge of the clip's square, so no square edge shows
    for (const prop of ['-webkit-mask-image', 'mask-image']) {
      const m = base.join(';').match(new RegExp(`(?:^|;)${prop}:radial-gradient\\(closest-side,#000 (\\d+)%,transparent 100%\\)`));
      assert.ok(m, `${prop} is not a closest-side radial gradient ending transparent at 100%`);
      assert.ok(Number(m[1]) >= 55 && Number(m[1]) <= 70, `${prop}: opaque stop ${m[1]}% (the cube and its flame sit inside 62% of the radius)`);
    }
    assert.ok(/#site \.hero-ghost video\{[^}]*pointer-events:none[^}]*\}/.test(siteCss));
    assert.ok(/#site \.hero-ghost\.is-off\{opacity:0;transition-duration:\.22s\}/.test(siteCss), 'the quick fade (scrolled away, no fly)');
    assert.ok(!/z-index:\s*-?\d{4}/.test(siteCss), 'a 4-digit z-index (CHECK 1)');
    // above the scrim and the photo, below the text: negative z-index inside the hero's own stacking context (isolation:isolate); the sticky header (z-index 2) is above all of it
    assert.ok(/#site \.hero-bg\{[^}]*z-index:-2/.test(siteCss) && /#site \.hero-scrim\{[^}]*z-index:-1/.test(siteCss));
    assert.ok(/#hero\{[^}]*isolation:isolate/.test(siteCss));
    assert.ok(/#site-header\{position:sticky;top:0;z-index:2;/.test(siteCss), 'the header must stay above the overlay');
    assert.ok(!/mix-blend-mode/.test(siteCss.replace(/\/\*[\s\S]*?\*\//g, '')), 'plain alpha: screen blending was tried and erases the dark navy face of the cube');
  });

  it('keeps it translucent but readable: opacity .25 behind the text on a phone, .35 over the open photo from 900px — both inside the owner\'s 0.25-0.35 — and from 900px sits in that open part, clear of the text, about 54vmin across (the owner\'s 46-60) and never wider than 36vw', () => {
    const states = [...siteCss.matchAll(/#site \.hero-ghost\.is-on\{opacity:([.\d]+)\}/g)].map((m) => Number(m[1]));
    assert.deepEqual(states, [0.25, 0.35]);
    for (const o of states) assert.ok(o >= 0.25 && o <= 0.35);
    const desktop = siteCss.match(/@media \(min-width:900px\)\{\s*#site #hero h1\{[^}]*\}[\s\S]*?(#site \.hero-ghost\{[^}]*\})[\s\S]*?(#site \.hero-ghost\.is-on\{opacity:\.35\})/);
    assert.ok(desktop, 'the 900px rules for the overlay are gone');
    const m = desktop[1].match(/top:calc\(43vh - 18vw\);top:calc\(43svh - min\((\d+)vmin,18vw\)\);left:auto;right:clamp\(16px,2vw,40px\);width:36vw;height:36vw;width:min\((\d+)vmin,36vw\);height:min\(\2vmin,36vw\);margin:0/);
    assert.ok(m, 'from 900px: right-hand, clear of the text, vertically a constant of the viewport');
    assert.equal(Number(m[1]) * 2, Number(m[2]), 'the top offset is half the size (the box is centred on 43svh)');
    m.splice(1, 1);
    assert.ok(Number(m[1]) >= 46 && Number(m[1]) <= 60, `${m[1]}vmin is outside the owner's 46-60`);
    // the finished-hero layout: the text is the same width as before, the overlay never changes it (absolute, no flow)
    assert.ok(!/#site \.hero-ghost\{[^}]*position:(relative|static)/.test(siteCss));
  });

  it('shows nothing without script and nothing under reduced motion: hidden in the markup (and #site [hidden] beats every rule), hidden again by the stylesheet under prefers-reduced-motion, and its sources carry the same media gate; the no-script style sheet never shows it', () => {
    assert.ok('hidden' in ghosts[0].attrs);
    assert.ok(siteCss.includes('#site [hidden]{display:none !important}'));
    const rm = siteCss.match(/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/)[1];
    assert.ok(/#site \.hero-ghost\{display:none !important\}/.test(rm), 'reduced motion does not hide the overlay');
    assert.ok(!/<noscript>[\s\S]*?hero-ghost[\s\S]*?<\/noscript>/.test(home.html), 'the no-script block mentions the overlay');
    for (const s of sources) assert.ok(/prefers-reduced-motion:no-preference/.test(s.attrs.media), `${s.attrs.src}: no reduced-motion gate`);
    // js/site.js agrees: reduced motion or a data-saver request starts nothing (the behaviour is run below)
    assert.ok(/reducedMotion\(\) \|\| dataSaver\(\)/.test(siteJs));
  });

  it('is absent from the app: #site is display:none in every view but "site" (so the boot, sign-in and app views never draw it), the app kit holds none of it, and the clip is named in no app file', () => {
    assert.ok(siteCss.includes('#site{display:none}') && siteCss.includes('html[data-view="site"] #site{display:block}'));
    const kit = home.html.match(/<template id="app-kit">([\s\S]*?)<\/template>/)[1];
    assert.ok(!/hero-ghost|brand-reveal|<video|\.mp4/.test(kit), 'the app kit carries the intro');
    for (const f of ['js/app.js', 'js/config.js', 'sw.js', 'css/styles.css', 'css/tokens.css']) assert.ok(!/hero-ghost|brand-reveal/.test(read(f)), `${f} knows the intro`);
    assert.ok(ghosts[0].chain.some((e) => e.attrs.id === 'hero') && home.S.elements.find((e) => e.attrs.id === 'hero').chain.some((e) => e.attrs.id === 'site'), 'the overlay is inside #site');
  });

  it('plays under the page\'s own CSP with no media-src change: the files are same-origin relative paths and default-src is \'self\'', () => {
    const csp = home.html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
    const dir = Object.fromEntries(csp.split(';').map((x) => x.trim()).filter(Boolean).map((x) => [x.split(/\s+/)[0], x.split(/\s+/).slice(1)]));
    assert.ok(dir['default-src'].includes("'self'"));
    assert.ok(!('media-src' in dir) || dir['media-src'].includes("'self'"));
    for (const u of sources.map((x) => x.attrs.src)) assert.ok(/^site\/img\/brand\//.test(u), `${u} is not a same-origin path`);
  });

  // ── the behaviour (js/site.js run in a fake browser: tests/fixtures/hero-intro-env.mjs) ──────────────────────────────────
  describe('behaviour', () => {
    const E = (o) => makeEnv(siteJs, o);
    const cap = 6500;

    it('starts only after the page has loaded — at once if it already has, on the load event otherwise — and only when the HERO is on screen (the overlay itself is hidden until it plays)', () => {
      const done = E({ readyState: 'complete' });
      assert.deepEqual(done.log.filter((l) => /^(observer|observe|disconnect|play)/.test(l)), ['observer', 'observe hero'], 'the observer watches the hero, not the hidden overlay');
      assert.equal(done.plays(), 0, 'nothing plays until the hero is on screen');
      done.intersect(false); assert.equal(done.plays(), 0, 'a hero that is not on screen never starts it');
      done.intersect(true); assert.equal(done.plays(), 1);
      assert.equal(done.ghost.hidden, false);
      assert.ok(!done.classes.has('is-on'), 'the overlay stays at opacity 0 until the clip is really playing');
      const loading = E({ readyState: 'interactive' });
      loading.intersect(true);
      assert.equal(loading.plays(), 0, 'a page that is still loading must wait for the load event');
      assert.equal(loading.waitingForLoad(), 1);
      loading.load();
      assert.equal(loading.plays(), 1);
      assert.equal(loading.waitingForLoad(), 0);
    });

    it('fades in only when the clip is really playing, flies after about six and a half seconds (measured from that moment) or when the clip ends, whichever is first, and plays ONCE', () => {
      const e = E({});
      e.intersect(true); e.tick(10000);
      assert.equal(e.flights().length, 0, 'no fly while the clip has not started to play');
      const g = E({});
      g.intersect(true); g.fire('video', 'playing');
      assert.ok(g.classes.has('is-on'));
      g.tick(cap - 1); assert.equal(g.flights().length, 0, 'not before the cap');
      g.tick(1); assert.equal(g.flights().length, 1, 'the fly starts at the cap');
      assert.equal(g.plays(), 1);
      // a second "playing" (the clip resumes after buffering) changes nothing
      g.fire('video', 'playing'); assert.equal(g.flights().length, 1);
      // the clip ends before the cap: the fly starts at once
      const ended = E({});
      ended.intersect(true); ended.fire('video', 'playing'); ended.tick(3000);
      ended.fire('video', 'ended'); assert.equal(ended.flights().length, 1);
      ended.tick(cap * 2); assert.equal(ended.flights().length, 1, 'one fly only');
      // the cap is 6-7 s (the owner: "about 6-7 s"; a 10 s watermark is too long)
      assert.ok(cap >= 6000 && cap <= 7000);
      assert.ok(/max: 6500,/.test(siteJs));
    });

    it('flies to the header logo, #site-brand img: its exact position and size, measured with getBoundingClientRect when the fly starts, by transform and opacity only, 700-900 ms, ease-in-out, fading out as it lands — and lights that logo for ~400 ms', () => {
      const ghostRect = { left: 896, top: 144, width: 486, height: 486 }, logoRect = { left: 146, top: 18, width: 36, height: 36 };
      const e = E({ ghostRect, logoRect, opacity: 0.35 });
      e.intersect(true); e.fire('video', 'playing'); e.tick(cap);
      assert.ok(e.log.includes('qs #site-brand img'), 'the target is #site-brand img');
      assert.ok(!e.log.some((l) => /^qs /.test(l) && !['qs #hero .hero-ghost', 'qs #site-brand img'].includes(l)), 'no other lookup');
      const [flight] = e.flights();
      const { keyframes, options } = flight;
      // FLIP: the last frame puts the overlay's box exactly on the logo's box (centre and size)
      const last = keyframes[keyframes.length - 1], first = keyframes[0];
      const { dx, dy, s } = parseTransform(last.transform);
      assert.ok(Math.abs(ghostRect.left + ghostRect.width / 2 + dx - (logoRect.left + logoRect.width / 2)) < 1e-9);
      assert.ok(Math.abs(ghostRect.top + ghostRect.height / 2 + dy - (logoRect.top + logoRect.height / 2)) < 1e-9);
      assert.ok(Math.abs(ghostRect.width * s - logoRect.width) < 1e-9);
      assert.deepEqual(parseTransform(first.transform), { dx: 0, dy: 0, s: 1 });
      // only transform and opacity are animated; the fade ends at 0 and starts from the overlay's own opacity
      for (const kf of keyframes) assert.ok(Object.keys(kf).every((k) => ['transform', 'opacity', 'offset'].includes(k)), `animated ${Object.keys(kf)}`);
      assert.equal(first.opacity, 0.35); assert.equal(last.opacity, 0);
      assert.ok(keyframes.every((k, i) => i === 0 || k.opacity <= keyframes[i - 1].opacity), 'it only fades out');
      assert.ok(options.duration >= 700 && options.duration <= 900, `fly of ${options.duration} ms`);
      assert.equal(options.easing, 'cubic-bezier(.65, 0, .35, 1)');
      assert.equal(options.fill, 'forwards');
      // the header logo glows as it lands: a ~400 ms scale + box-shadow pulse that starts before the overlay arrives
      const [pulse] = e.pulses();
      assert.ok(pulse && pulse.options.duration >= 350 && pulse.options.duration <= 450, 'the pulse is about 400 ms');
      assert.ok(pulse.options.delay > 0 && pulse.options.delay < options.duration);
      for (const kf of pulse.keyframes) assert.ok(Object.keys(kf).every((k) => ['transform', 'boxShadow', 'offset'].includes(k)));
      // landed: nothing of the intro stays — no listener, no timer, no source (the download stops), the overlay is out of the page
      assert.ok(!e.removed(), 'still in the page while it flies');
      flight.finish();
      assert.ok(e.removed());
      assert.equal(e.listening(), 0);
      assert.deepEqual(e.video.children, []);
      assert.ok(e.log.includes('pause()'));
      e.tick(60000); assert.equal(e.flights().length, 1, 'nothing runs after the landing');
      // the safety timer removes it even if the animation never reports its end
      const stuck = E({});
      stuck.intersect(true); stuck.fire('video', 'playing'); stuck.tick(cap); stuck.tick(849); assert.ok(!stuck.removed()); stuck.tick(400); assert.ok(stuck.removed());
    });

    it('uses the geometry at the moment of the fly, not at the start: the overlay and the logo are measured again after the clip has run', () => {
      const e = E({ ghostRect: { left: 896, top: 144, width: 486, height: 486 } });
      e.intersect(true); e.fire('video', 'playing'); e.tick(2000);
      // the fonts load and the hero is taller: the overlay (centred) and the logo have moved by the time of the fly
      let calls = 0;
      const moved = { left: 900, top: 150, width: 480, height: 480 };
      e.ghost.getBoundingClientRect = () => { calls++; return { ...moved, right: moved.left + moved.width, bottom: moved.top + moved.height }; };
      e.tick(cap - 2000);
      const { dx, dy, s } = parseTransform(e.flights()[0].keyframes.at(-1).transform);
      assert.ok(calls >= 1);
      assert.ok(Math.abs(moved.left + moved.width / 2 + dx - 164) < 1e-9 && Math.abs(moved.top + moved.height / 2 + dy - 36) < 1e-9 && Math.abs(moved.width * s - 36) < 1e-9);
    });

    it('skips the intro — no play(), the overlay removed at once — for a reduced-motion visitor, a data-saver visitor and a hidden tab; and removes it the moment the tab is hidden while it runs', () => {
      for (const o of [{ reduced: true }, { saveData: true }]) {
        const e = E(o);
        assert.ok(e.removed(), JSON.stringify(o));
        assert.ok(!e.log.includes('observer'), 'no observer is even created');
        assert.equal(e.plays(), 0);
        assert.equal(e.animations.length, 0);
      }
      assert.ok(!E({ saveData: false }).removed(), 'saveData:false is not a data-saver request');
      const hiddenAtStart = E({ visibility: 'hidden' });
      hiddenAtStart.intersect(true);
      assert.equal(hiddenAtStart.plays(), 0, 'a hidden tab never plays');
      assert.ok(hiddenAtStart.removed());
      const mid = E({});
      mid.intersect(true); mid.fire('video', 'playing'); mid.tick(2000);
      mid.hide();
      assert.ok(mid.removed(), 'hidden mid-play: gone at once');
      assert.equal(mid.flights().length, 0);
      assert.equal(mid.listening(), 0);
      mid.tick(60000); assert.equal(mid.flights().length, 0);
    });

    it('skips the intro when autoplay is refused or play() throws: the overlay is removed, it never fades in and nothing lingers — there is no poster to show', async () => {
      for (const play of ['reject', 'throw']) {
        const e = E({ play });
        e.intersect(true);
        await e.flush();
        assert.equal(e.plays(), 1, play);
        assert.ok(e.removed(), `${play}: the overlay must be gone`);
        assert.ok(!e.classes.has('is-on'), `${play}: it must never have been shown`);
        assert.equal(e.animations.length, 0);
        assert.equal(e.listening(), 0);
      }
    });

    it('gives up quietly when the clip does not start within 5 s (a slow connection): no late ghost, the download is dropped', () => {
      const e = E({});
      e.intersect(true);
      e.tick(4999); assert.ok(!e.removed());
      e.tick(1); assert.ok(e.removed());
      assert.ok(!e.classes.has('is-on'));
      assert.deepEqual(e.video.children, []);
      assert.equal(e.listening(), 0);
    });

    it('ends with a quick fade — no fly — when the visitor scrolls away before the end, and when the clip errors or is paused by the browser; a nudge of the page (within the header\'s 24px) does not end it', () => {
      const e = E({});
      e.intersect(true); e.fire('video', 'playing'); e.tick(1000);
      e.scrollTo(10); assert.ok(!e.classes.has('is-off'), 'a small scroll is ignored');
      e.scrollTo(300);
      assert.ok(e.classes.has('is-off'), 'scrolled away: quick fade');
      assert.equal(e.flights().length, 0, 'no fly');
      assert.ok(!e.removed(), 'the fade runs first');
      assert.equal(e.listening(), 0, 'it stops listening at once');
      e.tick(299); assert.ok(!e.removed());
      e.tick(1); assert.ok(e.removed());
      e.tick(60000); assert.equal(e.flights().length, 0);
      for (const ev of ['error', 'pause']) {
        const x = E({});
        x.intersect(true); x.fire('video', 'playing'); x.fire('video', ev);
        assert.ok(x.classes.has('is-off'), ev);
        assert.equal(x.flights().length, 0);
      }
      // a pause at the very end of the clip is the clip ending, not an interruption
      const atEnd = E({});
      atEnd.intersect(true); atEnd.fire('video', 'playing'); atEnd.video.ended = true; atEnd.fire('video', 'pause');
      assert.ok(!atEnd.classes.has('is-off'));
    });

    it('does not fly when it cannot land: the header has gone solid (scrolled past 24px at the cap), there is no #site-brand img, no Element.animate, or the logo is outside the hero — a quick fade instead', () => {
      const cases = [['scrolled past 24px at the cap', { y: 0 }, (e) => { e.win.pageYOffset = 40; e.doc.documentElement.scrollTop = 40; }],
        ['no header logo', { logo: false }, () => {}], ['no Element.animate', { animate: false }, () => {}],
        ['logo outside the hero', { logoRect: { left: 146, top: -300, width: 36, height: 36 } }, () => {}]];
      for (const [label, o, prep] of cases) {
        const e = E(o);
        e.intersect(true); e.fire('video', 'playing'); e.tick(1000); prep(e); e.tick(cap - 1000);
        assert.equal(e.flights().length, 0, label);
        assert.ok(e.classes.has('is-off'), `${label}: quick fade`);
        e.tick(400); assert.ok(e.removed(), label);
      }
    });

    it('stops at once, with nothing left behind, if the page is scrolled while the overlay is flying (its target would have moved)', () => {
      const e = E({});
      e.intersect(true); e.fire('video', 'playing'); e.tick(cap);
      const [flight] = e.flights();
      assert.ok(!e.removed());
      e.scrollTo(200);
      assert.ok(e.removed());
      assert.ok(flight.cancelled);
      assert.equal(e.listening(), 0);
    });

    it('never starts in the app: with data-view boot, login or app the overlay is removed at the load event and nothing plays (with or without IntersectionObserver), even if the observer reports the hero as visible', () => {
      for (const view of ['boot', 'login', 'app']) {
        const e = E({ view, readyState: 'interactive' });
        assert.equal(e.plays(), 0);
        e.load(); e.intersect(true);                  // hypothetically visible: the website view check still refuses
        assert.equal(e.plays(), 0, view);
        assert.ok(e.removed(), view);
        const noIO = E({ view, io: false });
        noIO.load(); noIO.tick(60000);
        assert.equal(noIO.plays(), 0, `${view} without IntersectionObserver`);
        // ... and the app does no work for it at all: no load listener waits for the website view, the overlay is left alone (hidden, costing nothing)
        const early = E({ view, io: false, readyState: 'interactive' });
        assert.equal(early.waitingForLoad(), 0, `${view} without IntersectionObserver: nothing waits for the load event`);
        assert.ok(!early.removed() && early.ghost.hidden === true, `${view}: the overlay is untouched`);
      }
      // the website view without IntersectionObserver: it starts after load, because the website is the current view
      const site = E({ io: false, readyState: 'interactive' });
      assert.equal(site.plays(), 0); site.load(); assert.equal(site.plays(), 1);
      // and a hero that is never on screen (the app's #site is display:none, so the observer never fires) never plays or downloads anything
      const hidden = E({ view: 'login' });
      assert.equal(hidden.plays(), 0);
      assert.ok(!hidden.removed(), 'it stays hidden in the document, costing nothing');
      assert.equal(hidden.ghost.hidden, true);
    });

    it('plays once per visit — after the landing nothing starts it again — and the intro never reads storage, the network or the service worker', () => {
      assert.ok(!/serviceWorker|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(siteJs.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
      const e = E({});
      e.intersect(true); e.fire('video', 'playing'); e.tick(cap); e.flights()[0].finish();
      assert.ok(e.removed());
      e.intersect(true); e.load();
      assert.equal(e.plays(), 1, 'one play per visit');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('7 · the material: SS304 food-grade (standard) and SS316 laboratory-grade, brushed, mirror or satin', () => {
  const homeText = visibleText(home.html.slice(home.html.indexOf('<div id="site"'), home.html.indexOf('<!-- /#site -->')));
  const proofSub = visibleText(home.html.match(/<ul class="proof-bar"[\s\S]*?<\/ul>/)[0].match(/<li><span class="proof-val">SS304[\s\S]*?<\/li>/)[0]);
  const catText = visibleText(catalogue.html.slice(catalogue.html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/g, ''));
  const materialRows = [...catalogue.html.matchAll(/<dt>Material<\/dt><dd>([^<]*)<\/dd>/g)].map((m) => decode(m[1]));

  it('states both grades on the homepage — hero lead, proof bar ("SS304 / SS316", two lines at most), meta / social descriptions — and on the catalogue — lede, every configurable card, the descriptions — SS304 first, as the standard', () => {
    assert.ok(homeText.includes('in food-grade SS304 and laboratory-grade SS316 stainless steel, including exhaust and fresh-air systems'));
    const proof = home.html.match(/<ul class="proof-bar"[\s\S]*?<\/ul>/)[0];
    assert.ok(proof.includes('<span class="proof-val">SS304 / SS316</span>'));
    assert.ok(/food-grade/.test(proofSub) && /laboratory-grade/.test(proofSub));
    assert.ok(proofSub.replace('SS304 / SS316', '').trim().length <= 56, `the proof-bar sub-line is ${proofSub.length} characters: it would run to three lines`);
    for (const k of ['description', 'og:description', 'twitter:description']) for (const p of [home, catalogue]) assert.ok(/SS304/.test(p.meta(k)) && /SS316/.test(p.meta(k)) && p.meta(k).indexOf('SS304') < p.meta(k).indexOf('SS316'), `${p.file}: ${k}`);
    assert.ok(catText.includes('Premium stainless-steel equipment in food-grade SS304 as standard, or laboratory-grade SS316, built to your specifications.'));
    assert.equal(materialRows.length, 11, 'one Material row per configurable card (eleven families)');
    for (const r of materialRows) assert.equal(r, 'SS304 food-grade (standard) or SS316 laboratory-grade · brushed, mirror or satin finish');
    for (const t of [homeText, catText]) { assert.ok(t.includes('SS304') && t.includes('SS316')); assert.ok(t.indexOf('SS304') < t.indexOf('SS316'), 'SS304 must come first'); }
  });

  it('names all three finishes — brushed, mirror and satin — on the homepage (the Fabrication step) and on every configurable card, and no longer calls "No.4 brushed" THE finish', () => {
    const fab = visibleText(home.html.match(/<h3>Fabrication<\/h3>\s*<p>([\s\S]*?)<\/p>/)[1]);
    assert.equal(fab, 'Built to order in SS304 or SS316, finished brushed, mirror or satin, with seams welded and ground smooth.');
    for (const f of ['brushed', 'mirror', 'satin']) { assert.ok(homeText.includes(f), `the homepage lacks "${f}"`); assert.ok(materialRows.every((r) => r.includes(f)), `a card lacks "${f}"`); }
    assert.ok(!/No\.?4/.test(homeText), 'the homepage still says No.4');
    assert.ok(!materialRows.some((r) => /No\.?4/.test(r)));
    assert.ok(!/No\.?4/.test(read('index.html').match(/<meta name="description"[^>]*>/)[0]));
  });

  it('credits no past project with a grade or finish: the projects, About, warranty and Luzon sections never say SS304, SS316, grade, mirror or satin', () => {
    const sec = (id) => home.html.match(new RegExp(`<section id="${id}"[\\s\\S]*?</section>`))[0];
    for (const id of ['projects', 'about', 'warranty', 'luzon', 'contact']) assert.ok(!/SS ?3(04|16)|grade|mirror|satin|brushed/i.test(visibleText(sec(id))), `#${id} states a grade or finish`);
    // and nowhere does a sentence tie SS316 to a named client or a delivered job
    for (const t of [homeText, catText]) for (const sentence of t.split(/(?<=[.!?])\s+/)) if (/SS ?316/.test(sentence)) assert.ok(!/ISPSC|DMMMSU|Don Mariano|Ilocos|completed|delivered to|installed (at|in|for)|our (previous|past) /i.test(sentence), `SS316 is tied to a project: ${sentence.slice(0, 80)}`);
  });

  it('adds NO grade or finish option to the WEBSITE configurators or the quote flow (the steel grade is a staff-only Quote Builder choice since 2026-10-28): no PUBLIC group, option or label mentions SS316, grade, mirror, satin or a material, and no public script names SS316 or a finish', () => {
    const FAMS = require('../js/qr-families.js');
    const PFX = require('../js/product-families.js');
    const WORDS = /316|grade|mirror|satin|brushed|finish|material/i;
    // (a) what the website offers is PF.publicGroups of each family: none of them (key, label, options, hints) carries such a word, nor do the sizes or the old-option map
    for (const id of FAMS.order) {
      const f = FAMS.families[id];
      for (const g of PFX.publicGroups(f)) assert.ok(!WORDS.test(JSON.stringify(g)), `${id}.${g.key}: a public group offers a grade or finish`);
      assert.ok(!WORDS.test(JSON.stringify([f.dims, f.specMap])), `${id}: its sizes or old-option map offer a grade or finish`);
    }
    // ... and the source agrees: the only group with such a word is the staff-only grade group
    const fams = JSON.parse(read('scripts/public-families.json'));
    for (const [id, f] of Object.entries(fams.families)) for (const g of f.groups) {
      if (WORDS.test(JSON.stringify(g))) assert.ok(g.key === 'grade' && g.staffOnly === true, `${id}.${g.key}: a grade or finish outside the staff-only grade group`);
    }
    // (b) the public scripts never name SS316 or a finish (js/qr-families.js and its mirror carry the staff-only group, exactly as they carry the 1.2 mm top plate: they are not in this list)
    for (const f of ['js/qr-def.js', 'js/quote-request.js', 'js/qr-preview.js', 'js/product-families.js', 'functions/qr-def.js']) assert.ok(!/SS ?316|316L|satin|mirror finish|laboratory/i.test(read(f)), `${f} offers SS316 or a finish`);
    assert.ok(!/SS ?316|satin|mirror/i.test(JSON.stringify(read('functions/qr-published.json'))));
  });

  it('standard construction (owner ruling 2026-10-28): the website configurator offers the PUBLIC groups only (js/quote-request.js walks publicGroups(), never fam.groups) and adds a read-only Construction line; the staff-only top plate and steel grade are defined once, flagged, and named on no public surface', () => {
    const js = read('js/quote-request.js');
    const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(/publicGroups\(/.test(code), 'js/quote-request.js must iterate PF.publicGroups(fam)');
    assert.ok(!/\bfam\.groups\b/.test(code), 'js/quote-request.js must never walk fam.groups: a staff-only group would get a control');
    assert.ok(/qr-hint qr-construction/.test(code) && /PF\.constructionLine\(/.test(code), 'the read-only Construction line');
    assert.ok(!/\{ ?staff: ?true/.test(code) && !/staffOnly/.test(code), 'the website never validates in staff mode');
    const fams = JSON.parse(read('scripts/public-families.json'));
    const flagged = Object.entries(fams.families).flatMap(([id, f]) => f.groups.filter((g) => g.staffOnly).map((g) => `${id}.${g.key}`));
    assert.deepEqual(flagged, ['prep_table.grade', 'prep_table.top', 'sink.grade', 'sink.top', 'dish_table.grade', 'dish_table.top', 'stove.grade', 'stove.top', 'wok_range.grade', 'wok_range.top', 'cooking_line.grade', 'deck_oven.grade', 'hood.grade', 'cabinet.grade', 'wall_shelf.grade', 'rack.grade'],
      'exactly the eleven steel grades and the five top plates are staff-only (the hood, the griddle / griller / fryer and the deck oven have a grade but no top plate)');
    // no public surface offers or names the lighter top plate: the catalogue cards, the product pages, the FAQ and llms.txt say only the standard
    for (const f of ['catalogue/index.html', 'products/index.html', 'faq/index.html', 'llms.txt', ...fs.readdirSync(path.join(ROOT, 'products'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `products/${e.name}/index.html`)]) {
      const t = read(f).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
      assert.ok(!/Top plate|\blighter\b|1\.2 mm top/.test(t), `${f} offers or names the lighter top plate`);
      // ... nor the exact labels of the staff-only steel grade (the owner's own "SS304 food-grade" / "SS316 laboratory-grade" marketing wording there is different text and stays)
      assert.ok(!/Stainless Steel 316 Laboratory Grade|Stainless Steel 304 Food Grade/.test(t), `${f} carries the staff-only grade's labels`);
    }
  });

  it('conditional options (CONFIGURATOR-FAMILIES-2-SPEC §4): the website configurator hides a conditional group until PF.groupApplies says it applies, puts it back to its standard value when it stops applying, follows a forced size limit — and still offers public groups only, in the public mode', () => {
    const js = read('js/quote-request.js');
    const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(/PF\.publicGroups\(fam\)\.forEach\(function \(g\) \{\n\s+var node = /.test(code), 'the sheet walks the PUBLIC groups');
    assert.ok(/if \(g\.when\) syncers\.push\(function \(\) \{ node\.hidden = !PF\.groupApplies\(fam, g, st\.config\); \}\);/.test(code), 'a conditional group is hidden until it applies');
    assert.ok(/var v = PF\.validateConfiguration\(fam, st\.config\);\n\s+PF\.publicGroups\(fam\)\.forEach\(function \(g\) \{ if \(g\.when\) st\.config\[g\.key\] = v\.config\[g\.key\]; \}\);/.test(code), 'a group that stopped applying goes back to its standard value, and only the conditional groups are written back');
    assert.ok(/function changed\(\) \{[^\n]*snapGated\(\); applyUsualLength\(\); syncAll\(\);/.test(code), 'every change snaps, then follows the options, then shows and hides');
    assert.ok(/PF\.forcedMaxes\(fam, st\.config\)/.test(code), 'a forced maximum is honoured');
    assert.ok(!/\{ ?staff: ?true/.test(code) && !/staffOnly/.test(code), 'still the public mode, never a staff-only group');
    // the data the sheet reads: a conditional group names an EARLIER public choice (so there is no cycle and the gate is always shown first), and is never itself staff-only
    const fams = JSON.parse(read('scripts/public-families.json'));
    let gated = 0;
    for (const [id, f] of Object.entries(fams.families)) f.groups.forEach((g, i) => {
      if (!g.when) return;
      gated++;
      assert.ok(!g.staffOnly && g.type !== 'slots', `${id}.${g.key}: a conditional group is a public choice or add-on`);
      for (const [k, vals] of Object.entries(g.when)) {
        const j = f.groups.findIndex((x) => x.key === k);
        assert.ok(j >= 0 && j < i && f.groups[j].type === 'choice' && !f.groups[j].staffOnly, `${id}.${g.key}: "when" must name an earlier public choice (${k})`);
        assert.ok(Array.isArray(vals) && vals.length > 0 && vals.every((x) => f.groups[j].options.some((o) => o.v === x)), `${id}.${g.key}: "when" lists options of ${k}`);
      }
    });
    assert.equal(gated, 3, 'fry baskets, burners and the pre-rinse sink are the only conditional groups');
    // the sheet's own words about a forced limit carry no price word
    assert.ok(!/price|cost|₱|\bPHP\b/i.test((code.match(/With these options the[^\n]*/g) || []).join(' ')), 'the size hint is price-free');
  });

  it('leaves the master\'s own product notes alone: every fixed card still carries exactly the note the generator takes from the master (the "(local only)" fresh-build test in catalogue-public.test.mjs), and the generator\'s display overrides name no grade', () => {
    for (const [id, v] of Object.entries(B.NOTE_OVERRIDES)) assert.ok(!/SS ?316|satin|mirror/i.test(JSON.stringify(v)), `NOTE_OVERRIDES ${id}`);
    for (const [id, v] of Object.entries(B.TEXT_FIXES)) assert.ok(!/SS ?316|satin|mirror/i.test(JSON.stringify(v)), `TEXT_FIXES ${id}`);
    assert.equal(B.FAMILY_MATERIAL, 'SS304 food-grade (standard) or SS316 laboratory-grade · brushed, mirror or satin finish');
  });
});
