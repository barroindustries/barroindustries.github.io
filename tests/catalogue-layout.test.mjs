// tests/catalogue-layout.test.mjs — how /catalogue/ LOOKS and what every card SAYS.
//
// OWNER RULINGS 2026-11-19 (they REPLACE rulings 1-4 and 6-7 below, which pinned the photo / spec-row / "notes in full" cards of 2026-10-21 and 2026-10-28):
//   A. A card is PLAIN TEXT: its name, one line of description, three to five short feature bullets, ONE price line and its button. No photo, no drawing,
//      no placeholder tile, no specification table, no notes block, no product code on view. The words are scripts/catalogue-cards.js's.
//   B. The grid is compact: one column on a phone, two or three where the width allows (cards at least 250px wide), no horizontal scroll, every row of
//      cards one height with the price line and the button at the bottom.
//   C. The page is grouped by the eight configurators of the 17-18 Nov call (tests/catalogue-public.test.mjs pins the groups, the prices and the guards).
// Rulings 5 (SEARCH) and 8 (the CONFIGURE deep link) are unchanged and pinned below against the real js/catalogue.js.
//
// ── the older text, kept for history ──
//
//   1. FEATURED CARDS. A configurable product is the wide featured card (photo left, tag / serif name / description / labelled Specifications /
//      "Configure & add" right); on a phone it is the normal stacked full-width card; where a category holds several (Storage) they sit side by
//      side as a row of cards, and narrower than that the wide cards take over.
//   (withdrawn 2026-11-19) 2. NO DEAD SPACE. A fixed item is a compact "spec row" (well | code, name, size | Notes | button) from 720px and a compact card on a phone:
//      no giant placeholder letter (a small category line-icon, or no well at all on a phone), one column instead of the old three, rows as
//      tall as their own content, and "Add to quote" directly under / beside the notes.
//   3. NOTES ARE VERY IMPORTANT. Every card shows its note WHOLE (nothing clamps, truncates, hides or shrinks it), at 14px or more, in a near-black
//      that passes 7:1 on both grounds, under a "Notes" label (the material rows under "Specifications"); a card with no note shows no label
//      and no placeholder. The configurable cards add a Material row — the owner's own homepage wording, pinned to the proof bar.
//   4. TIGHTER SPACING between sections and inside cards (upper bounds, so it cannot quietly creep back).
//   5. SEARCH still finds every card — the featured ones included — by running the REAL js/catalogue.js against the REAL generated page in a
//      small fake DOM.
//   6. STANDARD CONSTRUCTION (owner ruling 2026-10-28): a configurable card lists its PUBLIC options, then Size, then a Construction row (how the
//      made-to-order piece is built, at the family defaults), then Material last — and never the staff-only top plate or the word "staff".
//   7. CONDITIONAL OPTIONS (CONFIGURATOR-FAMILIES-2-SPEC §4.1, 2026-10-28): a row for an option that applies only for some values of an earlier choice ends
//      with its condition — "Fry baskets: 1 / 2 / 3 (Type is Fryer)" — and a gated group is still ONE row.
//   8. THE CONFIGURE DEEP LINK (2026-10-28): /catalogue/?configure=<family>#cat-… — the Configure button of a product page — makes the REAL js/catalogue.js
//      press that family card's own "Configure & add" button (the one js/quote-request.js adds) once every deferred script has run, takes the
//      parameter out of the address, and does nothing for a missing, unknown or malformed value. The sheet itself is quote-request.js's, not a copy.
//
// Mutation-tested (scratch copies, never the shared tree): a line-clamp on the notes, the notes at 13px, a paler notes colour, a card with a
// fixed height, the "Notes" label dropped from the generator, the Material row changed, .cat-lead removed from the search haystack, the multi
// grid class dropped, the old 3-column grid restored, a letter tile restored — each must fail here. 2026-10-28: the card listing the staff-only
// group, the Construction row dropped or moved below Material — each must fail here too. 2026-10-28 (cf2-ws1-mut/): the card row losing its condition suffix, Ventilation
// after Storage, the hood card without its "Learn more" link — each must fail here too. 2026-10-28 (the Configure deep link, 28 mutants of js/catalogue.js, all killed): the card
// matched by data-id, an unknown family falling back to the sink, no immediate try / no DOMContentLoaded / no load registration, the address never cleaned / cleaned of every
// parameter or of the #cat- anchor, no decoding, a malformed escape that throws, a button pressed twice or never, any .qr-add pressed, the parameter read from the fragment or
// from "xconfigure=", the focus never given back / given back after the visitor acted / to a control that left / over another control / on any focusout / with no focusout, first-frame
// or load check, quote-request.js's button class renamed, catalogue.js loaded after it, a copy of the configurator code — each must fail here.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const B = require('../scripts/build-catalogue.js');
const FAMS = require('../js/qr-families.js');
const PF = require('../js/product-families.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const page = read('catalogue/index.html');
const block = page.slice(page.indexOf(B.START_MARKER) + B.START_MARKER.length, page.indexOf(B.END_MARKER));
const home = read('index.html');
const css = read('css/catalogue.css');
const qrCss = read('css/quote-request.css');
const catJs = read('js/catalogue.js');

const visible = (html) => stripTags(html);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const stripTags = (html) => decode(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// ── a small CSS reader: [{ media, selector, decls }] — enough to pin real declarations instead of strings ─────────────────────────────────
function parseCss(text, media = null, out = []) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    let depth = 0, j = open;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) break; } }
    const body = src.slice(open + 1, j);
    if (prelude.startsWith('@media')) parseCss(body, prelude.replace(/^@media\s*/, '').replace(/\s+/g, ' '), out);
    else if (!prelude.startsWith('@')) {
      const decls = {};
      for (const d of body.split(';')) { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
      for (const sel of prelude.split(/,(?![^(]*\))/)) out.push({ media: media || null, selector: sel.trim().replace(/\s+/g, ' '), decls });
    }
    i = j + 1;
  }
  return out;
}
const RULES = parseCss(css);
const MIN720 = '(min-width:720px)';
const MULTI = '(min-width:820px) and (max-width:1023px),(min-width:1100px)';
// every declaration that applies to a selector inside one media context, later rules winning (the cascade for one context)
const merged = (selector, media = null) => Object.assign({}, ...RULES.filter((r) => r.selector === selector && r.media === media).map((r) => r.decls));
const px = (v) => parseFloat(String(v).replace('px', ''));
const lum = (hex) => { const c = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// ── synthetic products for the generator ──────────────────────────────────────────────────────────────────────────────────────────────────
const CATS = [{ id: 'cooking_line', label: 'Cooking Line', code: 'CE' }];
const prod = (over) => ({ id: 'T-100', category: 'cooking_line', name: 'Plain Table', unit: 'pc', specs: [], notes: 'SS304', ...over });
const render = (products, opts) => B.renderCatalogue({ categories: CATS, products }, { publicCategories: { products: Object.fromEntries(products.map((p) => [p.id, 'cooking'])), excludedProducts: {} }, ...(opts || {}) });
const cardOf = (html, id) => html.split('<li class="cat-card').slice(1).find((c) => c.includes(`data-id="${id}"`));

const CARDS = require('../scripts/catalogue-cards.js');
const cardsOnPage = block.split('<li class="cat-card').slice(1).map((c) => c.split('</li>\n')[0] + '</li>');

describe('every card is text plus (when mapped) its product photo: photo, a name, one line, three to five feature bullets, one price line (owner rulings 2026-11-19)', () => {
  it('each card on the real page is  head (tag?, name, one line)  then  feature list  then (configurable cards) a "Learn more" link  then the price line — in that order, and nothing else', () => {
    assert.equal(cardsOnPage.length, 30);
    for (const c of cardsOnPage) {
      const key = (c.match(/data-(?:family|id|ask)="([^"]+)"/) || [])[1];
      const i = [c.indexOf('<div class="cat-head">'), c.indexOf('<ul class="cat-feat">'), c.indexOf('<p class="cat-from')];
      assert.ok(i[0] > 0 && i[0] < i[1] && i[1] < i[2], `${key}: head, features, price line must come in that order`);
      const learn = c.indexOf('<p class="cat-learn">');
      if (learn >= 0) assert.ok(i[1] < learn && learn < i[2], `${key}: "Learn more" belongs between the features and the price`);
      // the product photo (owner 2026-11-19 later: photos back) may only be the exact captioned figure, first in the card; otherwise only these elements
      const fig = c.match(/<figure class="cat-photo">[\s\S]*?<\/figure>/);
      if (fig) {
        assert.match(fig[0], /^<figure class="cat-photo"><img src="\/site\/img\/products\/[a-z0-9-]+-thumb\.webp" [^>]*alt="[^"]+" loading="lazy" decoding="async"><figcaption>Representative image<\/figcaption><\/figure>$/, `${key}: the photo is not the captioned product figure`);
        assert.ok(c.indexOf(fig[0]) < i[0], `${key}: the photo must come before the head`);
      }
      const tags = new Set([...c.replace(fig ? fig[0] : '', '').matchAll(/<([a-z0-9]+)\b/g)].map((m) => m[1]));
      for (const t of tags) assert.ok(['div', 'p', 'h3', 'ul', 'li', 'a', 'data', 'span'].includes(t), `${key}: unexpected <${t}> in a card`);
    }
  });

  it('a configurable card has the "Configurable" tag and a link to its own product page; a fixed card has neither a tag nor a code on view (the code is searchable only)', () => {
    for (const c of cardsOnPage.filter((x) => /data-family="/.test(x))) {
      assert.ok(c.includes('<p class="cat-tag">Configurable</p>'));
      assert.ok(/<p class="cat-learn"><a class="link-arrow" href="\/products\/[a-z-]+\/">Learn more about [^<]+<\/a><\/p>/.test(c), 'no Learn more link');
    }
    for (const c of cardsOnPage.filter((x) => /^" data-id="/.test(x))) {
      assert.ok(!c.includes('cat-tag') && !c.includes('cat-code'));
      const id = c.match(/data-id="([^"]+)"/)[1];
      assert.ok(!stripTags(c.slice(c.indexOf('<div class="cat-head">'))).includes(id), `the code ${id} is on view`);
      assert.ok(c.includes(`data-kw="${id}"`), 'the code is not a search keyword');
    }
  });

  it('every word on a card comes from scripts/catalogue-cards.js: one line of description (not a paragraph), three to five bullets of at most 70 characters, no price word, no staff-only text', () => {
    const entries = [...Object.entries(CARDS.CARD_COPY), ...CARDS.PROJECT_CARDS.map((p) => [p.id, p])];
    assert.equal(entries.length, 30);
    for (const [id, c] of entries) {
      assert.ok(c.desc && c.desc.length <= 90 && !/[.!?]\s+\S/.test(c.desc), `${id}: the description is not one short line`);
      assert.ok(c.features.length >= 3 && c.features.length <= 5, `${id}: ${c.features.length} bullets`);
      for (const t of c.features) assert.ok(t.length <= 70 && !/\.$/.test(t), `${id}: "${t}" is not a short bullet`);
      const all = [c.desc, ...c.features].join(' ');
      assert.ok(!B.MONEY_RE.test(all) && !B.FORMULA_RE.test(all) && !B.BRAND_RE.test(all) && !/\bstaff\b|top plate|1\.2 mm top/i.test(all), `${id}: a guarded word`);
      assert.ok(block.includes(`<li>${B.esc(c.features[0])}</li>`), `${id}: its first bullet is not on the page`);
    }
    // each configurable card says only what its configurator really offers
    assert.deepEqual(Object.keys(CARDS.CARD_COPY).filter((k) => FAMS.order.includes(k)).sort(), [...FAMS.order].sort(), 'a family has no wording');
  });

  it('the configurable cards state the standard material the homepage states, and nothing the homepage does not claim', () => {
    const prep = cardsOnPage.find((c) => c.includes('data-family="prep_table"'));
    assert.ok(prep.includes('Food-grade SS304, SS316 on request'));
    assert.ok(visible(home).includes('SS304') && /SS316/.test(visible(home)), 'the homepage no longer names both grades');
    for (const c of cardsOnPage) assert.ok(!/NSF|ISO ?\d|certified|warranty|guarantee/i.test(stripTags(c)), 'an unverifiable claim sits on a card');
  });

  it('the live search placeholder, status and counts count the cards of the page (30 in 8 groups)', () => {
    assert.ok(block.includes('placeholder="Search 30 products"') && block.includes('>30 products in 8 categories</p>'));
  });
});

describe('css/catalogue.css — compact text cards that never overflow', () => {
  const MIN = 'minmax(min(250px,100%),1fr)';

  it('the grid is one auto-fitting grid: cards at least 250px wide (one column on a phone, two or three on a desktop), a gap of 16px at most, nothing wider than its column', () => {
    const g = merged('#site .cat-grid');
    assert.equal(g.display, 'grid');
    assert.equal(g['grid-template-columns'], `repeat(auto-fill,${MIN})`);
    assert.ok(px(g.gap) <= 16 && px(g.gap) >= 8);
    const c = merged('#site .cat-card');
    assert.equal(c.display, 'flex');
    assert.equal(c['flex-direction'], 'column');
    assert.equal(c['min-width'], '0');
    assert.equal(c['overflow-wrap'], 'break-word');
    assert.ok(!/repeat\(3,/.test(css) && !/overflow-x\s*:\s*scroll/.test(css.replace(/\.cat-nav[^}]*}/g, '')), 'a fixed three-column grid or a scrolling card');
  });

  it('the price line and the button sit at the bottom of every card (the price line takes the free space above it), so a row of cards lines up', () => {
    assert.equal(merged('#site .cat-from')['margin'], 'auto 0 0');
    const btn = Object.assign({}, ...parseCss(qrCss).filter((r) => r.selector === '#site .cat-card .qr-add' && !r.media).map((r) => r.decls));
    assert.equal(btn.width, '100%');
    assert.ok(px(btn['min-height']) >= 44, 'the button is smaller than a 44px tap target');
    assert.ok(px(merged('#site .cat-ask')['min-height']) >= 44);
    assert.equal(merged('#site .cat-ask').width, '100%');
  });

  it('the price figure is the largest thing on the card after its name: the amount in 20px or more, "From" and "+ VAT" in 14px or more, "Priced per project" in 15px', () => {
    assert.ok(px(merged('#site .cat-from data').font.match(/(\d+)px/)[1]) >= 20);
    assert.ok(px(merged('#site .cat-from')['font-size']) >= 14 && px(merged('#site .cat-vat')['font-size']) >= 14);
    assert.equal(merged('#site .cat-from-ask')['font-size'], '15px');
    assert.ok(px(merged('#site .cat-card h3').font.match(/(\d+)px/)[1]) >= 16);
  });

  it('all card text is 14px or more and in a near-black that passes 7:1 (AAA) on the white card; no text is clipped (no line-clamp, no ellipsis, no height, no hiding)', () => {
    for (const sel of ['#site .cat-lead', '#site .cat-feat', '#site .cat-learn']) {
      const sizes = RULES.filter((r) => r.selector === sel && 'font-size' in r.decls).map((r) => px(r.decls['font-size']));
      assert.ok(sizes.length > 0 && sizes.every((n) => n >= 14), `${sel}: ${sizes}`);
    }
    const ink = (css.match(/--cat-ink:(#[0-9A-Fa-f]{6})/) || [])[1];
    assert.ok(ink && contrast(ink, '#FFFFFF') >= 7, `ink ${ink}`);
    assert.equal(merged('#site .cat-lead').color, 'var(--cat-ink)');
    assert.equal(merged('#site .cat-feat').color, 'var(--cat-ink)');
    for (const bad of ['line-clamp', 'text-overflow', 'box-orient', 'mask-image']) assert.ok(!css.includes(bad), `the stylesheet uses ${bad}`);
    for (const r of RULES) {
      const target = r.selector.split(/\s*[> ]\s*/).pop();
      if (!/\.cat-(?:card|head|lead|feat|from|learn|tag)\b|^h3$/.test(target)) continue;
      assert.ok(!('height' in r.decls) && !('max-height' in r.decls), `${r.selector} has a height`);
      if (r.decls.display === 'none') assert.ok(/\.is-hidden/.test(r.selector), `${r.selector}{display:none} hides content`);
    }
  });

  it('the pieces of the old cards are gone from the stylesheets: tile, spec list, notes, labels, code, featured and side-by-side layouts (the photo is back, full-bleed on top)', () => {
    assert.match(css, /#site \.cat-photo\{[^}]*aspect-ratio:4\/3/);
    for (const gone of ['.cat-tile', '.cat-ic', '.cat-specs', '.cat-notes', '.cat-label', '.cat-meta', '.cat-code', '.cat-body', '.cat-card-feature', '.cat-grid-multi', '.has-photo', '--cat-well'])
      assert.ok(!css.includes(gone) && !qrCss.includes(gone), `the stylesheets still mention ${gone}`);
  });

  it('the "In your quote" badge sits on the card\'s top edge, never over its text; the project card\'s "Request a quote" link looks like the other buttons', () => {
    assert.match(qrCss, /#site \.cat-card\[data-qr-count\]::after\{[^}]*top:-11px/);
    assert.match(qrCss, /#site \.cat-card\{position:relative\}/);
    assert.equal(merged('#site .cat-ask').border, '1px solid var(--site-navy)');
  });

  it('keeps the spacing between sections and the page padding modest (upper bounds, so dead space cannot creep back)', () => {
    const clampMax = (v) => parseFloat(String(v).match(/clamp\([^,]+,[^,]+,\s*([\d.]+)px\)/)[1]);
    assert.ok(clampMax(merged('#site .cat-group+.cat-group')['margin-top']) <= 48);
    const h2 = merged('#site .cat-group h2');
    assert.ok(px(h2['padding-bottom']) <= 12 && /^\d+px 0 \d+px$/.test(h2.margin) && px(h2.margin.split(' ')[2]) <= 16);
    assert.ok(clampMax(merged('#site .cat-layout')['padding-bottom']) <= 64);
    assert.ok(px(merged('#site .cat-card').padding.split(' ')[0]) <= 20, 'the card padding grew');
  });
});

// ── SEARCH: the REAL js/catalogue.js over the REAL generated page, in a tiny fake DOM ─────────────────────────────────────────────────────
function parseHtml(html) {
  const mk = (tag, attrs) => {
    const el = {
      tag, attrs, children: [], parent: null, text: '', hidden: false, value: '', _h: {},
      getAttribute(k) { return k in attrs ? attrs[k] : null; }, setAttribute(k, v) { attrs[k] = String(v); }, removeAttribute(k) { delete attrs[k]; }, hasAttribute(k) { return k in attrs; },
      get className() { return attrs.class || ''; },
      classList: {
        contains: (c) => (attrs.class || '').split(/\s+/).includes(c),
        add: (c) => { const s = new Set((attrs.class || '').split(/\s+/).filter(Boolean)); s.add(c); attrs.class = [...s].join(' '); },
        remove: (c) => { attrs.class = (attrs.class || '').split(/\s+/).filter((x) => x && x !== c).join(' '); },
        toggle: (c, force) => { const has = (attrs.class || '').split(/\s+/).includes(c); const want = force === undefined ? !has : !!force; if (want && !has) el.classList.add(c); if (!want && has) el.classList.remove(c); return want; },
      },
      get textContent() { return el.children.length ? el.children.map((c) => c.textContent).join('') : el.text; },
      set textContent(v) { el.children = []; el.text = String(v); },
      get parentNode() { return el.parent; },
      matches(sel) { return sel.split(',').some((s) => { s = s.trim(); return s.startsWith('.') ? el.classList.contains(s.slice(1)) : s === tag; }); },
      querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); walk(el); return out; },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
      addEventListener(ev, fn) { (el._h[ev] = el._h[ev] || []).push(fn); },
      getBoundingClientRect() { return { top: 0, height: 0, left: 0, width: 0 }; },
      focus() {}, blur() {}, select() {}, scrollTo() {}, scrollIntoView() {},
    };
    return el;
  };
  const root = mk('#root', {});
  let cur = root;
  const VOID = new Set(['img', 'input', 'br', 'path', 'circle']);
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { cur = cur.parent || root; }
    else if (m[2]) {
      const attrs = {};
      for (const a of (m[3] || '').matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : decode(a[2]);
      const el = mk(m[2].toLowerCase(), attrs); el.parent = cur; cur.children.push(el);
      if (!(m[4] || VOID.has(el.tag))) cur = el;
    } else if (m[5] && m[5].trim()) { const t = mk('#text', {}); t.text = decode(m[5]); t.parent = cur; cur.children.push(t); }
  }
  return root;
}

// opts (all optional; the defaults are what the search tests have always run with): readyState ('interactive' is what a DEFERRED script such as the real one sees), search
// ('?configure=sink'), hash ('#cat-washing'), noHistory (a browser with no history.replaceState), noRaf (a page whose animation frames never come), buttonsFirst (quote-request.js has already run). The result also carries what the Configure deep link needs: addButtons() is
// js/quote-request.js running (a "Configure & add" button in every family card, an "Add to quote" button in every fixed card — each press is recorded in `clicks`), fire() is the
// browser dispatching DOMContentLoaded and then load (fireReady() / fireLoad() one at a time), and `replaced` holds every history.replaceState call. A press also does what the sheet does: it focuses its first control
// (`control`, which becomes document.activeElement); clearFocus() is the browser clearing that focus the way Chrome does for a page opened at a #fragment (a focusout to nothing, the
// active element back on <body>); interact(event) is the visitor touching the page (keydown, mousedown, wheel, touchstart); flush() runs the timers the script has set.
function runCatalogueScript(opts = {}) {
  const tree = parseHtml(block);
  const byId = {};
  const index = (n) => { if (n.attrs && n.attrs.id) byId[n.attrs.id] = n; n.children.forEach(index); };
  index(tree);
  const timers = [], clicks = [], replaced = [], onReady = [], onLoad = [], onFocusOut = [], winHandlers = {};
  const win = {
    innerWidth: 1440, innerHeight: 900, pageYOffset: 0,
    matchMedia: () => ({ matches: false }), requestAnimationFrame: (fn) => { if (!opts.noRaf) fn(); }, getComputedStyle: () => ({ position: 'static', scrollMarginTop: '0' }),
    addEventListener(ev, fn) { if (ev === 'load') onLoad.push(fn); (winHandlers[ev] = winHandlers[ev] || []).push(fn); }, scrollTo() {}, setInterval: () => 0, clearInterval() {},
    history: opts.noHistory ? undefined : { replaceState: (...args) => { replaced.push(args); } },
  };
  const body = { tag: 'body' };
  const control = { tag: 'input', isConnected: true, focusCalls: 0, focus() { this.focusCalls++; doc.activeElement = this; } };
  const doc = { readyState: opts.readyState || 'complete', body, activeElement: body, getElementById: (id) => byId[id] || null, addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') onReady.push(fn); if (ev === 'focusout') onFocusOut.push(fn); }, fonts: null };
  const sandbox = { window: win, document: doc, location: { hash: opts.hash || '', search: opts.search || '', pathname: '/catalogue/' }, Date, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: (id) => { timers[id - 1] = null; }, setInterval: () => 0, clearInterval() {} };
  const input = byId['cat-search'];
  const cards = tree.querySelectorAll('.cat-card');
  const idOf = (c) => c.getAttribute('data-id') || c.getAttribute('data-family') || c.getAttribute('data-ask');
  const search = (q) => {
    input.value = q;
    for (const h of input._h.input || []) h();
    for (let i = 0; i < timers.length; i++) if (timers[i]) { const f = timers[i]; timers[i] = null; f(); }
    return cards.filter((c) => !c.classList.contains('is-hidden')).map(idOf);
  };
  const addButtons = (only) => {
    for (const c of cards) {
      const fam = c.getAttribute('data-family'), id = fam || c.getAttribute('data-id');
      if (!id) continue;                                                                      // a project card has a plain link, not a button added by quote-request.js
      if (only && !only.includes(id)) continue;
      const btn = parseHtml(fam ? `<button type="button" class="qr-add qr-add-config" data-family="${fam}">Configure &amp; add</button>` : `<button type="button" class="qr-add" data-id="${id}">Add to quote</button>`).children[0];
      btn.click = () => { clicks.push((fam ? 'family:' : 'item:') + id); doc.activeElement = control; };
      btn.parent = c; c.children.push(btn);
    }
  };
  if (opts.buttonsFirst) addButtons();                       // js/quote-request.js ran BEFORE catalogue.js (not the page's order, but a page that is already complete)
  vm.runInNewContext(catJs, sandbox);
  const fireReady = () => { for (const f of onReady) f(); };
  const fireLoad = () => { for (const f of onLoad) f(); };
  const fire = () => { fireReady(); fireLoad(); };
  const focusOutOf = (target, to = null) => { for (const f of onFocusOut) f({ target, relatedTarget: to }); };
  const clearFocus = (to = null) => { const was = doc.activeElement; doc.activeElement = to || body; focusOutOf(was, to); };
  const interact = (ev = 'keydown') => { for (const f of winHandlers[ev] || []) f({}); };
  const flush = () => { for (let i = 0; i < timers.length; i++) if (timers[i]) { const f = timers[i]; timers[i] = null; f(); } };
  return { search, byId, tree, idOf, cards, clicks, replaced, addButtons, fire, fireReady, fireLoad, doc, body, control, clearFocus, focusOutOf, interact, flush };
}

describe('search finds every card — the configurable ones included — by running the real js/catalogue.js on the real page', () => {
  const env = runCatalogueScript();
  const ALL = env.cards.map(env.idOf);

  it('starts with every card shown, and a blank query restores them all', () => {
    assert.equal(ALL.length, 30);
    assert.deepEqual(env.search(''), ALL);
  });

  it('finds a configurable card by its name, its one-line description, its feature bullets and the codes and names of the products it replaced', () => {
    assert.ok(env.search('stove').includes('stove'));
    assert.ok(env.search('burner position').includes('stove'), 'the bullets are searched');
    assert.ok(env.search('griller').includes('stove'), 'the bullets are searched');
    assert.deepEqual(env.search('wheels'), ['rack', 'trolley'], 'the rack and the trolley card are the two that name wheels');
    assert.deepEqual(env.search('pw-006'), ['sink'], 'the absorbed SKU code finds the family that replaced it');
    assert.deepEqual(env.search('double sink'), ['sink']);
    assert.ok(env.search('ss304').includes('prep_table'), 'a bullet naming SS304 is searched');
    assert.deepEqual(env.search('worktable'), ['prep_table']);
    assert.ok(env.search('lamp').includes('hood'));
  });

  it('still finds fixed cards by code, name, description and bullets — and not by the tag, the price line or the button', () => {
    assert.deepEqual(env.search('ce-016'), ['deck_oven'], 'the code of an absorbed SKU finds the family that replaced it');
    assert.deepEqual(env.search('ba-011'), ['BA-011']);
    assert.ok(env.search('griddle').includes('cooking_line'));
    assert.ok(env.search('humidity tray').includes('BA-006'), 'a bullet is searched');
    assert.ok(env.search('retard').includes('BA-011'));
    assert.ok(env.search('grinder').includes('MS-015'));
    assert.deepEqual(env.search('representative'), [], 'there is no photo caption any more');
    assert.deepEqual(env.search('configurable'), [], 'the tag is not searchable text');
    assert.deepEqual(env.search('+ vat'), [], 'the price line is not searchable text');
    assert.deepEqual(env.search('priced per project'), [], 'the price line is not searchable text');
    assert.deepEqual(env.search('request a quote'), [], 'the button is not searchable text');
  });

  it('a project card (no SKU) is found by its name and bullets, and carries no code', () => {
    assert.deepEqual(env.search('multi-purpose'), ['station']);
    assert.ok(env.search('ducting').includes('exhaust'));
    assert.ok(env.search('trolley').includes('trolley'));
  });

  it('hides the cards that do not match, empties a group with no match, updates the counts and shows the empty state — and a card reappears when the search is cleared', () => {
    const one = env.search('rack');
    assert.ok(one.includes('rack') && !one.includes('stove') && !one.includes('BA-006'));
    const storage = env.byId['cat-storage'];
    env.search('zzzz-no-such-product');
    for (const g of ['cat-preparation', 'cat-station', 'cat-washing', 'cat-ventilation', 'cat-exhaust', 'cat-cooking', 'cat-storage', 'cat-refrigeration']) assert.ok(env.byId[g].classList.contains('is-empty'), g);
    assert.equal(env.byId['cat-empty'].hidden, false);
    assert.equal(env.byId['cat-empty-q'].textContent, 'zzzz-no-such-product');
    assert.match(env.byId['cat-status'].textContent, /^No results for/);
    env.search('cabinet');
    assert.equal(storage.classList.contains('is-empty'), false);
    assert.equal(env.byId['cat-preparation'].classList.contains('is-empty'), true);
    assert.deepEqual(env.search(''), ALL);
    assert.equal(env.byId['cat-empty'].hidden, true);
  });

  it('js/catalogue.js reads the name, the one line and the bullets (its haystack selector) and the page keeps the data-cat / data-id / data-family hooks it and js/quote-request.js use', () => {
    assert.match(catJs, /querySelectorAll\('h3, \.cat-lead, \.cat-feat'\)/);
    assert.equal((block.match(/<li class="cat-card[^"]*" data-(?:id|family|ask)="/g) || []).length, 30);
    assert.equal((block.match(/data-kw="/g) || []).length, 30);
    assert.ok(/cards\[i\]\.parentNode\.parentNode\.getAttribute\('data-cat'\)/.test(catJs), 'the card -> grid -> section hop catalogue.js counts by');
    assert.ok(!/<li class="cat-card[^>]*><(?!div class="cat-head"|figure class="cat-photo")/.test(block), 'a card starts with something other than its photo or its head');
    assert.equal((block.match(/<figure class="cat-photo">/g) || []).length, 12, 'the 12 cards with a mapped photo (7 configurable, 3 fixed, trolleys, exhaust)');
  });
});

// ── THE CONFIGURE DEEP LINK (2026-10-28): /catalogue/?configure=<family>#cat-… — the Configure button of a product page ───────────────────
// js/catalogue.js presses the family card's OWN "Configure & add" button (the one js/quote-request.js adds), so the configurator is the visitor's
// own code path, not a copy. 'interactive' is the readyState a DEFERRED script sees: quote-request.js, a later deferred script, has not run yet.
describe('?configure=<family> opens that family\'s configurator by pressing its card\'s own "Configure & add" button, once — the real js/catalogue.js on the real page', () => {
  const run = (search, extra = {}) => runCatalogueScript({ readyState: 'interactive', search, hash: '#cat-washing', ...extra });

  it('waits for js/quote-request.js (a later deferred script), then presses the button when every deferred script has run — once, however many of DOMContentLoaded and load follow', () => {
    const env = run('?configure=sink');
    assert.deepEqual(env.clicks, [], 'there is nothing to press before quote-request.js has run');
    assert.deepEqual(env.replaced, [], 'the address was changed before the sheet was opened');
    env.addButtons();
    env.fire();
    assert.deepEqual(env.clicks, ['family:sink']);
    env.fire();
    assert.deepEqual(env.clicks, ['family:sink'], 'the button was pressed again');
  });

  it('presses at DOMContentLoaded — not at load, not later — and a button that only arrives after it is still pressed at load', () => {
    const early = run('?configure=sink');
    early.addButtons();
    early.fireReady();                                       // every deferred script has run: the sheet opens now, without waiting for the images
    assert.deepEqual(early.clicks, ['family:sink'], 'the button was not pressed at DOMContentLoaded');
    early.fireLoad();
    assert.deepEqual(early.clicks, ['family:sink']);
    const late = run('?configure=sink');
    late.fireReady();                                        // nothing to press yet
    assert.deepEqual(late.clicks, []);
    late.addButtons();                                       // quote-request.js was slow: its button arrives before load
    late.fireLoad();
    assert.deepEqual(late.clicks, ['family:sink'], 'a button added after DOMContentLoaded was never pressed');
  });

  it('presses it at once, in the script itself, when quote-request.js has already added the button (a page that is already complete)', () => {
    const env = runCatalogueScript({ readyState: 'complete', search: '?configure=stove', hash: '#cat-cooking', buttonsFirst: true });
    assert.deepEqual(env.clicks, ['family:stove'], 'the button was not pressed when the script ran');
    assert.deepEqual(env.replaced, [[null, '', '/catalogue/#cat-cooking']]);
    env.fire();
    assert.deepEqual(env.clicks, ['family:stove'], 'pressed again');
  });

  it('opens each of the eleven families by its own id — that family\'s button and no other — and the ids are the ones on the cards', () => {
    assert.equal(FAMS.order.length, 11);
    for (const id of FAMS.order) {
      const env = run('?configure=' + id);
      env.addButtons(); env.fire();
      assert.deepEqual(env.clicks, ['family:' + id], id);
      assert.ok(env.cards.some((c) => c.getAttribute('data-family') === id), `${id} has no card`);
    }
  });

  it('does nothing — presses no button of any card and leaves the address alone — for no value, an empty one, an unknown family, a fixed product\'s code, another case, a stray space, a malformed escape or another parameter', () => {
    const ignored = ['', '?', '?configure', '?configure=', '?configure=nope', '?configure=BA-006', '?configure=ba-006', '?configure=Sink', '?configure=sink%20', '?configure=%E0%A4%A', '?configure=%',
      '?configure[]=sink', '?configures=sink', '?xconfigure=sink', '?quote=1', '?mock=1&sim=ok'];
    for (const search of ignored) {
      const env = run(search);
      env.addButtons(); env.fire();                          // every card has its button, as it would on the live page
      assert.deepEqual(env.clicks, [], `"${search}" pressed a button`);
      assert.deepEqual(env.replaced, [], `"${search}" changed the address`);
    }
    for (const hash of ['#cat-washing?configure=sink', '#cat-washing&configure=sink', '#configure=sink']) {   // a fragment is never a query
      const env = run('', { hash });
      env.addButtons(); env.fire();
      assert.deepEqual(env.clicks, [], `"${hash}" pressed a button`);
    }
  });

  it('finds the value among other parameters and decodes it — and takes ONLY it out of the address when the sheet opens (the rest of the query and the #cat- anchor stay), so a reload does not open it again', () => {
    const env = run('?mock=1&configure=%68ood&x=2', { hash: '#cat-ventilation' });
    env.addButtons(); env.fire();
    assert.deepEqual(env.clicks, ['family:hood']);
    assert.deepEqual(env.replaced, [[null, '', '/catalogue/?mock=1&x=2#cat-ventilation']]);
    const alone = run('?configure=rack', { hash: '#cat-storage' });
    alone.addButtons(); alone.fire();
    assert.deepEqual(alone.replaced, [[null, '', '/catalogue/#cat-storage']]);
    const first = run('?configure=cabinet&mock=1', { hash: '' });
    first.addButtons(); first.fire();
    assert.deepEqual(first.replaced, [[null, '', '/catalogue/?mock=1']]);
  });

  it('waits, and leaves the address alone, when the family card has no button (quote-request.js did not load); the visitor stays on the category the #cat- anchor names', () => {
    const env = run('?configure=sink');
    env.fire();                                              // no quote-request.js: no button anywhere
    assert.deepEqual(env.clicks, []);
    assert.deepEqual(env.replaced, []);
    env.addButtons(['sink']); env.fire();                    // a button arriving later (the load event) is still pressed
    assert.deepEqual(env.clicks, ['family:sink']);
  });

  it('presses only the Configure & add button of the family card: a card of another family, or a fixed product\'s "Add to quote", is never pressed', () => {
    const env = run('?configure=wok_range');
    env.addButtons(); env.fire();
    assert.deepEqual(env.clicks, ['family:wok_range']);
    assert.ok(env.clicks.every((c) => c.startsWith('family:')));
  });

  it('still opens the sheet in a browser with no history.replaceState (the address then keeps the query)', () => {
    const env = run('?configure=dish_table', { noHistory: true });
    env.addButtons(); env.fire();
    assert.deepEqual(env.clicks, ['family:dish_table']);
  });

  it('puts the keyboard focus back into the sheet when the browser clears it a moment after the sheet opened (Chrome does, for a page opened at a #fragment, measured in Chrome 2026-10-28) — each time it happens, until the visitor touches the page', () => {
    const env = run('?configure=sink');
    env.addButtons(); env.fire();
    env.flush();                                             // the checks after the first frame and at load have run: nothing was cleared yet
    assert.equal(env.doc.activeElement, env.control, 'the sheet focused its first control');
    assert.equal(env.control.focusCalls, 0);
    env.clearFocus();                                        // the browser's #fragment handling: a focusout to nothing, the active element back on <body>
    assert.equal(env.doc.activeElement, env.body);
    env.flush();
    assert.equal(env.doc.activeElement, env.control, 'the focus was not given back to the sheet');
    assert.equal(env.control.focusCalls, 1);
    env.clearFocus(); env.flush();                           // a page shown late (a background tab) is cleared late
    assert.equal(env.doc.activeElement, env.control, 'a second clearing was not answered');
    assert.equal(env.control.focusCalls, 2);
  });

  it('also checks after the first frame and at load, for a page that has no system focus to report the clearing (a background tab fires no focusout): the focus is given back there too', () => {
    const frame = run('?configure=sink');
    frame.addButtons(); frame.fireReady();                   // the press: the check after the first frame is scheduled, load has not come yet
    frame.doc.activeElement = frame.body;                    // cleared silently: no focusout
    frame.flush();
    assert.equal(frame.doc.activeElement, frame.control, 'the check after the first frame did not give the focus back');
    const loaded = run('?configure=sink', { noRaf: true });  // no frame ever comes (a hidden tab): only the load event is left to check
    loaded.addButtons(); loaded.fireReady();
    loaded.fireLoad();
    loaded.doc.activeElement = loaded.body;
    loaded.flush();
    assert.equal(loaded.doc.activeElement, loaded.control, 'the check at load did not give the focus back');
  });

  it('never fights the visitor for the focus: nothing is given back after a key, a click, a scroll or a touch, when focus went to another control, when it is another element that lost it, or when the sheet is gone', () => {
    for (const ev of ['keydown', 'mousedown', 'wheel', 'touchstart']) {
      const env = run('?configure=sink');
      env.addButtons(); env.fire();
      env.interact(ev);
      env.clearFocus(); env.flush();
      assert.equal(env.doc.activeElement, env.body, `${ev}: the focus was given back after the visitor had acted`);
    }
    const late = run('?configure=sink');                     // the visitor clicks between the clearing and the restore
    late.addButtons(); late.fire();
    late.clearFocus(); late.interact('mousedown'); late.flush();
    assert.equal(late.doc.activeElement, late.body, 'the focus came back after the visitor had clicked');
    const other = run('?configure=sink');                    // the focus went to another control: not cleared, moved
    other.addButtons(); other.fire();
    const elsewhere = { tag: 'button', isConnected: true, focus() { other.doc.activeElement = this; } };
    other.clearFocus(elsewhere); other.flush();
    assert.equal(other.doc.activeElement, elsewhere, 'the focus was taken from a control the visitor chose');
    const gone = run('?configure=sink');                     // the sheet was closed: its control left the page
    gone.addButtons(); gone.fire();
    gone.control.isConnected = false;
    gone.clearFocus(); gone.flush();
    assert.equal(gone.doc.activeElement, gone.body);
    assert.equal(gone.control.focusCalls, 0);
    const stray = run('?configure=sink');                    // some OTHER element lost its focus: not the control the sheet focused
    stray.addButtons(); stray.fire();
    stray.flush();                                           // the checks after the first frame and at load have run, with the focus where it belongs
    stray.doc.activeElement = stray.body;
    stray.focusOutOf({ tag: 'a' }); stray.flush();
    assert.equal(stray.doc.activeElement, stray.body);
    assert.equal(stray.control.focusCalls, 0);
  });

  it('uses the visitor\'s own code path, not a copy of it: catalogue.js presses the .qr-add-config button that js/quote-request.js adds to each family card and answers with its configurator, and holds no configurator code itself', () => {
    assert.match(catJs, /querySelector\('\.qr-add-config'\)/);
    assert.match(catJs, /btn\.click\(\)/);
    const qr = read('js/quote-request.js');
    assert.ok(qr.includes("class: 'qr-add qr-add-config'"), 'the button quote-request.js adds to a family card');
    assert.ok(/var add = t\.closest\('\.qr-add'\);\s*if \(add\) \{ e\.preventDefault\(\); if \(add\.getAttribute\('data-family'\)\) openConfigurator\(add\.getAttribute\('data-family'\), add\);/.test(qr), 'quote-request.js no longer opens a configurator when that button is pressed');
    const code = catJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    assert.ok(!/QR_FAMILIES|ProductFamilies|openConfigurator|openSheet|publicGroups|localStorage|sessionStorage/.test(code), 'catalogue.js holds configurator or storage code');
  });

  it('depends on the real script order: the page loads catalogue.js BEFORE quote-request.js, both deferred, so the button is pressed at DOMContentLoaded and not earlier', () => {
    const a = page.indexOf('<script defer src="/js/catalogue.js">'), b = page.indexOf('<script defer src="/js/quote-request.js">');
    assert.ok(a > 0 && b > a, 'catalogue.js must come before quote-request.js, both defer');
    assert.match(catJs, /on\(d, 'DOMContentLoaded', pressConfigure\);\s*on\(window, 'load', pressConfigure\);/);
  });
});
