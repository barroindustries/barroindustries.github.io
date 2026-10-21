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
//   4. The brand is swappable. The primary public name is "Barro Industries"; "Barro Kitchens" is a brand that may be
//      renamed, so every visible mention is wrapped in <span data-brand> (CSS-neutral), the brand is never in a
//      <title>, and the exact inventory of places it appears is pinned: renaming it is a find-and-replace of that list.
//   5. scripts/build-catalogue.js generates the ItemList (names + #cat-… anchors only) from the same walk as the cards.
//   6. The hero's logo-reveal animation: a muted <video> that plays once and holds its final frame (the poster), the 480px file under 900px and the
//      720px file above, stopped under prefers-reduced-motion, never precached, no audio track, feathered into the hero by a mask.
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
    assert.ok(/window\.openLoginFromSite\)\s*window\.openLoginFromSite\(\);/.test(siteJs) && siteJs.includes("if (!$('login-screen')) return;"));
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
  it('gives each page its own keyword-rich title: the exact titles, distinct, short enough, not stuffed', () => {
    assert.equal(home.title, 'Barro Industries — Premium Stainless-Steel Commercial Kitchens, Metro Manila');
    assert.equal(catalogue.title, 'Commercial Kitchen Equipment Catalogue | Barro Industries');
    assert.notEqual(home.title, catalogue.title);
    for (const p of [home, catalogue]) {
      assert.ok(p.title.length >= 30 && p.title.length <= 80, `${p.file}: title length ${p.title.length}`);
      assert.equal(p.S.texts.filter((t) => inHead(t.chain) && t.chain[t.chain.length - 1].tag === 'title').length, 1);
      assert.equal(maxRepeat(p.title), 1, `${p.file}: a word is repeated in the title`);
      assert.ok(/Barro Industries/.test(p.title), 'the primary public name is in the title');
    }
    assert.ok(/Metro Manila/.test(home.title) && /Stainless-Steel/.test(home.title) && /Commercial Kitchens/.test(home.title));
    assert.ok(/Commercial Kitchen Equipment/.test(catalogue.title));
  });

  it('keeps the homepage <title> byte-identical to SITE_TITLE in js/app.js (the view switch restores it), the brand out of it, and the login-view title untouched', () => {
    assert.equal(home.title, siteTitleInApp);
    assert.ok(!siteTitleInApp.includes('Barro Kitchens'));
  });

  it('gives each page its own meta description: distinct, 100-200 characters, naming what the page is about, not stuffed', () => {
    const hd = home.meta('description'), cd = catalogue.meta('description');
    assert.ok(hd && cd && hd !== cd, 'the two descriptions must be distinct');
    for (const [p, d] of [[home, hd], [catalogue, cd]]) {
      assert.equal(p.metaCount('description'), 1);
      assert.ok(d.length >= 100 && d.length <= 220, `${p.file}: description length ${d.length}`);
      assert.ok(maxRepeat(d) <= 2, `${p.file}: a word is repeated in the description`);
      assert.ok(/\.$/.test(d), 'the description is a finished sentence');
    }
    assert.ok(/^Premium stainless-steel commercial kitchens, built to order in Metro Manila: food-grade SS304 and laboratory-grade SS316 equipment, exhaust and fresh-air systems, gas lines and fire suppression\./.test(hd));
    assert.ok(/^Browse premium commercial kitchen equipment in SS304 or SS316 stainless steel for preparation, washing, cooking, storage and refrigeration/.test(cd));
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
    assert.equal(locs.length, 14, 'the home page, the catalogue and the 12 content pages (services, work, areas-we-serve, faq)');
    assert.equal(new Set(locs).size, 14);
    for (const u of locs.slice(2)) assert.ok(exists(u.replace('https://barroindustries.com/', '') + 'index.html'), `${u} is in the sitemap but has no page`);
    const mods = [...sm.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    assert.equal(mods.length, 14);
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

  it('on "/": a LocalBusiness named "Barro Industries" (legal name Barro Industries OPC, alternate name and brand Barro Kitchens) with sameAs = Facebook + the Google Maps place, and a minimal WebSite node', () => {
    assert.equal(home.ld.length, 2);
    const [lb, ws] = home.ld;
    assert.equal(lb['@type'], 'LocalBusiness');
    assert.equal(lb.name, 'Barro Industries');
    assert.equal(lb.legalName, 'Barro Industries OPC');
    assert.equal(lb.alternateName, 'Barro Kitchens');
    assert.deepEqual(lb.brand, { '@type': 'Brand', name: 'Barro Kitchens' });
    assert.deepEqual(lb.sameAs, ['https://www.facebook.com/barrokitchens', lb.hasMap]);
    assert.ok(lb.hasMap.startsWith('https://www.google.com/maps/place/'));
    assert.equal(lb.url, home.url);
    assert.deepEqual(ws, { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Barro Industries', url: 'https://barroindustries.com/' });
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
    assert.equal(expected.length, 32, 'the page shows 32 products');
    assert.equal(list.numberOfItems, 32);
    assert.deepEqual(list.itemListElement.map((i) => ({ name: i.name, url: i.url })), expected);
    list.itemListElement.forEach((item, i) => {
      assert.deepEqual(Object.keys(item), ['@type', 'position', 'name', 'url']);
      assert.equal(item['@type'], 'ListItem');
      assert.equal(item.position, i + 1);
      assert.ok(catalogue.html.includes(`id="${item.url.split('#')[1]}"`), `${item.url} has no anchor on the page`);
    });
    assert.deepEqual([...allKeys(list)].sort(), ['@context', '@type', 'itemListElement', 'name', 'numberOfItems', 'position', 'url']);
    assert.deepEqual(sections.map((s) => s.id), ['preparation', 'washing', 'cooking', 'storage', 'refrigeration']);
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
describe('4 · the brand is swappable: "Barro Industries" is the public name, "Barro Kitchens" a brand that may be renamed', () => {
  const BRAND = 'Barro Kitchens';
  const count = (text) => text.split(BRAND).length - 1;

  it('wraps every VISIBLE mention in <span data-brand> that holds exactly the name (homepage: header sub-line + footer; catalogue page: header sub-line + eyebrow + footer)', () => {
    for (const [p, n] of [[home, 2], [catalogue, 3]]) {
      const visible = p.S.texts.filter((t) => t.text.includes(BRAND));
      assert.equal(visible.length, n, `${p.file}: visible mentions of the brand`);
      for (const t of visible) {
        const parent = t.chain[t.chain.length - 1];
        assert.equal(parent.tag, 'span', `${p.file}: a mention is not wrapped`);
        assert.deepEqual(parent.attrs, { 'data-brand': '' }, `${p.file}: the wrapper must be a bare <span data-brand>`);
        assert.equal(t.text, BRAND, `${p.file}: the span holds more than the name`);
      }
      assert.equal(p.S.elements.filter((e) => e.tag === 'span' && 'data-brand' in e.attrs).length, n, `${p.file}: a data-brand span holds no brand name`);
      assert.ok(p.html.includes('<span class="site-brand-sub"><span data-brand>Barro Kitchens</span>™</span>'), `${p.file}: the header sub-line`);
    }
    assert.ok(home.footer.includes('<span data-brand>Barro Kitchens</span> is a brand of Barro Industries OPC.'));
    assert.ok(catalogue.footer.includes('<span data-brand>Barro Kitchens</span> is a brand of Barro Industries OPC.'));
    assert.ok(catalogue.html.includes('<p class="eyebrow"><span data-brand>Barro Kitchens</span></p>'));
    // the one other data-brand element: the hero's logo animation (a brand-specific ASSET, labelled with the name); the catalogue page has none
    assert.deepEqual(home.S.elements.filter((e) => e.tag !== 'span' && 'data-brand' in e.attrs).map((e) => e.tag), ['video']);
    assert.deepEqual(catalogue.S.elements.filter((e) => e.tag !== 'span' && 'data-brand' in e.attrs), []);
  });

  it('is CSS-neutral: no stylesheet or script selects or reads [data-brand]', () => {
    for (const f of ['css/site.css', 'css/catalogue.css', 'css/quote-request.css', 'css/styles.css', 'js/site.js', 'js/catalogue.js', 'js/quote-request.js']) assert.ok(!/data-brand/.test(read(f)), `${f} touches data-brand`);
  });

  it('pins the exact inventory of places the brand name appears, so a rename is a find-and-replace of this list', () => {
    // index.html — public parts: 2 visible spans (above), 1 logo alt, 1 label on the hero's logo animation, 2 JSON-LD fields (LocalBusiness.alternateName, LocalBusiness.brand.name)
    const homeAlt = home.S.attrs.filter((a) => a.value.includes(BRAND));
    assert.deepEqual(homeAlt.map((a) => `${a.tag}[${a.name}]=${a.value}`), ['img[alt]=Barro Kitchens logo', 'video[aria-label]=Barro Kitchens logo animation']);
    const ldHits = [];
    (function walk(v, p) { if (typeof v === 'string') { if (v.includes(BRAND)) ldHits.push(p); } else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], p ? `${p}.${k}` : k); })(home.ld, '');
    assert.deepEqual(ldHits, ['0.alternateName', '0.brand.name']);
    assert.equal(home.S.comments.filter((c) => c.text.includes(BRAND)).length + home.S.scripts.filter((s) => s.attrs.type !== 'application/ld+json' && s.body.includes(BRAND)).length, 0, 'a comment or script names the brand');
    // catalogue/index.html: 3 visible spans (above), 1 logo alt, nothing in the head, the ItemList or the data island
    assert.deepEqual(catalogue.S.attrs.filter((a) => a.value.includes(BRAND)).map((a) => `${a.tag}[${a.name}]=${a.value}`), ['img[alt]=Barro Kitchens logo']);
    assert.equal(catalogue.S.scripts.filter((s) => s.body.includes(BRAND)).length, 0);
    assert.equal(count(catalogue.head), 0);
    // the places outside the two pages: the intake's privacy notice (and its byte-identical mirror in functions/) and the generator's one constant
    assert.equal(count(read('js/qr-def.js')), 1);
    assert.equal(read('functions/qr-def.js'), read('js/qr-def.js'));
    assert.ok(/trading as Barro Kitchens\./.test(read('js/qr-def.js')));
    assert.equal(B.SITE_BRAND_NAME, BRAND);
    assert.equal((read('scripts/build-catalogue.js').match(/'Barro Kitchens'/g) || []).length, 1, 'the generator holds the brand in exactly one constant');
    // so: renaming = on "/" 2 wrapped spans + 1 logo alt + 1 animation label + 2 JSON-LD fields; on /catalogue/ 3 wrapped spans + 1 logo alt; the privacy notice;
    // the generator's constant — 12 places in all, each listed above (and the animation's FILES, which are brand artwork, not text)
    const total = count(home.html) + count(catalogue.html) + count(read('js/qr-def.js')) + 1;
    assert.equal(home.S.elements.filter((e) => e.tag === 'script' && e.attrs.type === 'application/ld+json').length, 2);
    assert.equal(total, 6 + 4 + 1 + 1, 'the brand appears somewhere new: wrap it in <span data-brand> (or list it here) so a rename still finds every place');
  });

  it('keeps the brand out of every <title>, og:title and twitter:title, and out of SITE_TITLE (the public name is Barro Industries)', () => {
    for (const p of [home, catalogue]) {
      for (const v of [p.title, p.meta('og:title'), p.meta('twitter:title')]) assert.ok(!v.includes(BRAND), `${p.file}: the brand is in a title`);
    }
    assert.ok(!siteTitleInApp.includes(BRAND));
    // ... nor in the descriptions or the other social tags (fewer places to change)
    for (const p of [home, catalogue]) for (const k of ['description', 'og:description', 'twitter:description', 'og:site_name', 'og:image:alt']) assert.ok(!p.meta(k).includes(BRAND), `${p.file}: ${k}`);
  });

  it('keeps "Barro Industries" as the primary public name: the header name, og:site_name, the WebSite name and the LocalBusiness name', () => {
    for (const p of [home, catalogue]) assert.ok(p.header.includes('<span class="site-brand-name">Barro Industries</span>'));
    assert.equal(home.meta('og:site_name'), 'Barro Industries');
    assert.equal(home.ld[0].name, 'Barro Industries');
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

  it('lists every product in page order (the five public categories as ruled), each with its name and its category anchor only', () => {
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
describe('6 · the hero logo animation: a muted video that plays once, holds its last frame and costs the page nothing', () => {
  const video = home.S.elements.filter((e) => e.tag === 'video');
  const sources = home.S.elements.filter((e) => e.tag === 'source' && e.chain.some((c) => c.tag === 'video'));
  const hero = home.html.match(/<section id="hero">[\s\S]*?<\/section>/)[0];
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

  it('puts ONE <video> in the hero, after the headline in reading order, inside .hero-mark, with the poster, muted, playsinline, preload none, no loop, no controls, not focusable — started by js/site.js, never by an autoplay attribute', () => {
    assert.equal(video.length, 1);
    assert.equal(catalogue.S.elements.filter((e) => e.tag === 'video').length, 0);
    const v = video[0].attrs;
    assert.ok(hero.includes('<video'), 'the video is not in #hero');
    assert.deepEqual(video[0].chain.slice(-2).map((e) => e.attrs.class), ['site-wrap hero-in', 'hero-mark']);
    assert.ok(hero.indexOf('<h1>') < hero.indexOf('<video'), 'the headline must come first (reading order); CSS puts the clip above it on a phone');
    for (const a of ['muted', 'playsinline', 'data-brand', 'disablepictureinpicture', 'disableremoteplayback']) assert.ok(a in v, `video lacks ${a}`);
    // preload="none" + a script-started play(), NOT autoplay + metadata: this index.html is also the installed app and the team sign-in, #site is display:none
    // there, and an autoplay video in a hidden page still downloads its whole file on every launch (measured: 0.8-1.3 MB per app start)
    assert.equal(v.preload, 'none');
    assert.ok(!('autoplay' in v), 'an autoplay attribute would download the clip in the hidden app / login view');
    assert.ok(!/<script/.test(hero), 'no script belongs inside the hero');
    assert.equal(v.poster, 'site/img/brand/brand-reveal-poster.webp');
    assert.equal(v['aria-label'], 'Barro Kitchens logo animation');
    assert.equal(v.width, '720'); assert.equal(v.height, '720');
    for (const a of ['loop', 'controls', 'tabindex', 'src', 'controlslist', 'autoplay']) assert.ok(!(a in v), `video must not carry ${a}`);
    assert.ok(!/<(audio|track)\b/.test(hero));
  });

  it('offers both files as sources — the 480px one first, under 900px; the 720px one otherwise — each gated on prefers-reduced-motion: no-preference, so a visitor who asked for less motion downloads no video', () => {
    assert.deepEqual(sources.map((s) => [s.attrs.src, s.attrs.type, s.attrs.media]), [
      ['site/img/brand/brand-reveal-480.mp4', 'video/mp4', '(max-width:899px) and (prefers-reduced-motion:no-preference)'],
      ['site/img/brand/brand-reveal-720.mp4', 'video/mp4', '(prefers-reduced-motion:no-preference)'],
    ]);
    for (const s of sources) assert.ok(exists(s.attrs.src), `${s.attrs.src} is missing`);
    assert.ok(exists('site/img/brand/brand-reveal-poster.webp') && exists('site/img/brand/brand-reveal-poster.jpg'));
    // the 900px threshold is the same one the layout flips at (the clip becomes the right column), so the file matches the size on screen
    assert.ok(/@media \(min-width:900px\)\{\s*#site \.hero-in\{display:grid;/.test(siteCss));
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

  it('ships the files the owner supplied, as is: 720x720 and 480x480, 10.0 s, H.264 video only — NO audio track — and light enough (1.5 MB / 1 MB, poster 40 KB)', () => {
    for (const [rel, w, maxBytes] of [['site/img/brand/brand-reveal-720.mp4', 720, 1.5e6], ['site/img/brand/brand-reveal-480.mp4', 480, 1.0e6]]) {
      const buf = mp4(rel), info = mp4Info(buf);
      assert.deepEqual(info.handlers, ['vide'], `${rel}: tracks ${info.handlers.join()} (an audio track would break "muted, silent")`);
      assert.deepEqual(info.size, { w, h: w }, rel);
      assert.ok(Math.abs(info.duration - 10) < 0.1, `${rel}: ${info.duration}s`);
      assert.ok(buf.length < maxBytes, `${rel}: ${buf.length} bytes`);
      assert.ok(buf.includes(Buffer.from('avc1')), `${rel} is not H.264`);
    }
    assert.ok(mp4('site/img/brand/brand-reveal-poster.webp').length < 40000);
    assert.deepEqual(B.webpSize(mp4('site/img/brand/brand-reveal-poster.webp')), { width: 720, height: 720 });
  });

  it('never plays with sound: muted in the markup, no script unmutes it or sets a volume, and only js/site.js ever starts the clip', () => {
    for (const f of ['js/site.js', 'js/catalogue.js', 'js/quote-request.js']) assert.ok(!/\.muted\s*=\s*false|\.volume\s*=|unmute/i.test(read(f)), `${f} touches the video's sound`);
    for (const f of ['js/catalogue.js', 'js/quote-request.js', 'js/app.js']) assert.ok(!/#hero video|vid\.play|video\.play\(/.test(read(f)), `${f} starts the clip`);
    assert.ok('muted' in video[0].attrs && !('autoplay' in video[0].attrs));
    assert.ok(!/\.muted\s*=/.test(read('js/site.js').replace(/\/\*[\s\S]*?\*\//g, '')));
  });

  it('keeps the hero PHOTO the LCP image (fetchpriority high, eager) and the clip off the critical path: preload none, a 20 KB poster, no preload link, no fetchpriority on the video', () => {
    const bg = home.S.elements.find((e) => e.tag === 'img' && /hero-bg/.test(e.attrs.class || ''));
    assert.equal(bg.attrs.fetchpriority, 'high');
    assert.ok(!('loading' in bg.attrs && bg.attrs.loading === 'lazy'));
    assert.ok(!home.S.elements.some((e) => e.tag === 'link' && /brand-reveal/.test(e.attrs.href || '')), 'a <link rel=preload> would put the clip on the critical path');
    assert.ok(!('fetchpriority' in video[0].attrs));
  });

  it('is NEVER precached: not site/img/brand/, no video file, in sw.js PRECACHE or precache-manifest.json — and CHECK 9 guards it by name', () => {
    for (const f of ['sw.js', 'precache-manifest.json']) assert.ok(!/site\/img\/brand|brand-reveal|\.(mp4|webm|mov|m4v)/i.test(read(f)), `${f} lists the logo animation`);
    const sh = read('scripts/ci-invariants.sh');
    assert.ok(sh.includes("'/site/img/brand/|") && sh.includes('mp4|webm|mov|m4v'), 'CHECK 9 has no guard for the brand folder / video files');
    assert.ok(/FAIL: sw\.js PRECACHE lists the hero logo animation/.test(sh));
    assert.ok(!/brand-reveal|site\/img\/brand/.test(read('js/config.js')), 'config.js PAGE_SCRIPTS lists it');
  });

  it('starts the clip from js/site.js only when the hero is ON SCREEN (IntersectionObserver) and motion is allowed — never in a hidden page (installed app, team sign-in: #site is display:none), never under prefers-reduced-motion — and swallows a refused play(), so the poster stays', () => {
    const run = ({ reduced = false, io = true, visible = true, view = 'site', rejectPlay = false }) => {
      const calls = [];
      const vid = { play: () => { calls.push('play()'); return rejectPlay ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(); } };
      class FakeIO { constructor(cb) { this.cb = cb; calls.push('observer'); } observe(el) { assert.equal(el, vid); calls.push('observe'); if (visible) this.cb([{ isIntersecting: false }, { isIntersecting: true }]); } disconnect() { calls.push('disconnect'); } }
      const doc = { readyState: 'complete', documentElement: { scrollTop: 0, getAttribute: (k) => (k === 'data-view' ? view : null) }, getElementById: () => null, querySelector: (sel) => (sel === '#hero video' ? vid : null), querySelectorAll: () => [], addEventListener() {} };
      const win = { matchMedia: (q) => ({ matches: reduced && /prefers-reduced-motion: reduce/.test(q) }), addEventListener() {}, innerWidth: 1440, pageYOffset: 0 };
      const sandbox = { document: doc, window: win };
      if (io) { win.IntersectionObserver = FakeIO; sandbox.IntersectionObserver = FakeIO; }
      vm.runInNewContext(siteJs, sandbox);
      return calls;
    };
    assert.deepEqual(run({}), ['observer', 'observe', 'disconnect', 'play()'], 'visible hero, motion allowed: observe, then play once');
    assert.deepEqual(run({ visible: false }), ['observer', 'observe'], 'a hidden or scrolled-away hero never starts the clip');
    assert.deepEqual(run({ reduced: true }), [], 'prefers-reduced-motion: no observer, no play()');
    assert.deepEqual(run({ io: false, view: 'site' }), ['play()'], 'no IntersectionObserver: start only if the website is the current view');
    for (const view of ['boot', 'login', 'app']) assert.deepEqual(run({ io: false, view }), [], `no IntersectionObserver, data-view=${view}`);
    assert.deepEqual(run({ rejectPlay: true }), ['observer', 'observe', 'disconnect', 'play()'], 'a rejected play() (blocked autoplay) must not throw');
  });

  it('feathers the clip into the hero with a radial mask (and the -webkit- prefix) that is fully opaque over the whole logo and zero at the edges of the square, over a soft pool — and never takes a click, a focus or a 4-digit z-index', () => {
    const rule = siteCss.match(/#site \.hero-mark video\{([^}]*)\}/)[1];
    for (const prop of ['-webkit-mask-image', 'mask-image']) {
      const m = rule.match(new RegExp(`(?:^|;)${prop}:radial-gradient\\(closest-side,#000 (\\d+)%,transparent 100%\\)`));
      assert.ok(m, `${prop} is not a closest-side radial gradient ending transparent at 100%`);
      // the logo, measured over all 10 s of the clip, reaches 88% of the radius (the cube while it is forged); the opaque stop must hold it, and a stop
      // near 100% would leave no fade at all
      assert.ok(Number(m[1]) >= 84 && Number(m[1]) <= 92, `${prop}: opaque stop ${m[1]}%`);
    }
    assert.ok(/pointer-events:none/.test(rule) && /aspect-ratio:1\/1/.test(rule));
    assert.ok(/#site \.hero-mark::before\{[^}]*z-index:-1[^}]*radial-gradient\(closest-side/.test(siteCss), 'the soft pool behind the clip is gone');
    assert.ok(!/z-index:\s*-?\d{4}/.test(siteCss), 'a 4-digit z-index (CHECK 1) — the pool sits at z-index:-1 inside the hero\'s own stacking context');
  });

  it('sizes it as owner asked: 220-260px centred above the headline on a phone, the right column (300-460px, about 380-460 on a laptop) from 900px, and the hero does not balloon', () => {
    assert.ok(siteCss.includes('#site .hero-mark{position:relative;order:-1;flex:none;width:clamp(220px,60vw,260px);margin:0 auto -16px}'));
    assert.ok(siteCss.includes('#site .hero-in{display:grid;grid-template-columns:minmax(0,1fr) clamp(300px,32vw,460px);'));
    assert.ok(/#site \.hero-mark\{order:0;width:100%;margin:0\}/.test(siteCss));
    // spacing trimmed on a phone so the extra height stays near the clip's own
    assert.ok(/@media \(max-width:899px\)\{\s*#site \.hero-years\{margin-bottom:16px\}\s*#site \.hero-cta\{margin-top:24px\}/.test(siteCss));
    assert.ok(siteCss.includes('padding-top:calc(var(--site-head) - 6px);padding-bottom:calc(clamp(32px,5vh,96px) + var(--proof-lift))}'));
  });

  it('plays under the page\'s own CSP with no media-src change: the files are same-origin relative paths and default-src is \'self\'', () => {
    const csp = home.html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
    const dir = Object.fromEntries(csp.split(';').map((x) => x.trim()).filter(Boolean).map((x) => [x.split(/\s+/)[0], x.split(/\s+/).slice(1)]));
    assert.ok(dir['default-src'].includes("'self'"));
    assert.ok(!('media-src' in dir) || dir['media-src'].includes("'self'"));
    assert.ok(dir['img-src'].includes("'self'"));
    for (const u of [video[0].attrs.poster, ...sources.map((x) => x.attrs.src)]) assert.ok(/^site\/img\/brand\//.test(u), `${u} is not a same-origin path`);
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
    assert.equal(materialRows.length, 6, 'one Material row per configurable card');
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

  it('adds NO grade or finish option to the configurators or the quote flow yet (pricing is undecided): no group, option, label or script mentions SS316, grade, mirror or satin', () => {
    const fams = JSON.parse(read('scripts/public-families.json'));
    const text = JSON.stringify(Object.values(fams.families).map((f) => [f.groups, f.dims, f.specMap]));
    assert.ok(!/316|grade|mirror|satin|brushed|finish|material/i.test(text), 'a family group offers a grade or finish');
    for (const f of ['js/qr-families.js', 'js/qr-def.js', 'js/quote-request.js', 'js/qr-preview.js', 'js/product-families.js', 'functions/qr-families.js', 'functions/qr-def.js']) assert.ok(!/SS ?316|316L|satin|mirror finish|laboratory/i.test(read(f)), `${f} offers SS316 or a finish`);
    assert.ok(!/SS ?316|satin|mirror/i.test(JSON.stringify(read('functions/qr-published.json'))));
  });

  it('leaves the master\'s own product notes alone: every fixed card still carries exactly the note the generator takes from the master (the "(local only)" fresh-build test in catalogue-public.test.mjs), and the generator\'s display overrides name no grade', () => {
    for (const [id, v] of Object.entries(B.NOTE_OVERRIDES)) assert.ok(!/SS ?316|satin|mirror/i.test(JSON.stringify(v)), `NOTE_OVERRIDES ${id}`);
    for (const [id, v] of Object.entries(B.TEXT_FIXES)) assert.ok(!/SS ?316|satin|mirror/i.test(JSON.stringify(v)), `TEXT_FIXES ${id}`);
    assert.equal(B.FAMILY_MATERIAL, 'SS304 food-grade (standard) or SS316 laboratory-grade · brushed, mirror or satin finish');
  });
});
