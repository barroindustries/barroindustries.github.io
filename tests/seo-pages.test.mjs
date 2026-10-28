// tests/seo-pages.test.mjs — the public content pages that exist to be found on Google (2026-10-21):
//
//   /services/                                   hub
//   /services/commercial-kitchen-fit-out/        one page per service (6)
//   /services/stainless-steel-fabrication/
//   /services/exhaust-and-fresh-air-systems/
//   /services/lpg-gas-line-installation/
//   /services/kitchen-fire-suppression/
//   /services/institutional-and-government-supply/
//   /work/                                       hub (NOT /projects/: that path is a private client portal)
//   /work/ispsc-2026/  /work/dmmmsu-2022-2023/   one page per completed project (2)
//   /areas-we-serve/                             Luzon coverage: the homepage's map and the 13 places
//   /faq/                                        FAQPage built only from confirmed facts
//
// What is pinned here, for every page:
//   · the head: a unique <title> (45-65 characters, ending "| Barro Industries"), a unique description (130-165), the canonical,
//     Open Graph + Twitter large card with an absolute photo URL whose file exists at the stated size, and a CSP with no
//     'unsafe-inline' (no inline style, no inline script apart from the JSON-LD data block);
//   · exactly one <h1>, a logical heading order, unique ids, well-formed markup, every image with alt text, width and height that
//     match the file, one high-priority hero image and everything else lazy;
//   · JSON-LD: LocalBusiness (the single place that names the brand), BreadcrumbList = the visible breadcrumb, Service / CreativeWork /
//     ItemList / FAQPage as the page needs, FAQPage = the visible Q&A word for word, and NO price, offer, rating, review, opening-hours
//     or credential key anywhere;
//   · the owner's content rules: no prices or peso amounts, never the partner company, one phone / one email / one address, no project
//     counts, only DMMMSU and ISPSC as clients (names only, no logos), no best / leading / certified / accredited / licensed claims,
//     British spelling, never the system or the app, the homepage's own wording and dates for the projects, the warranty, the process;
//   · the owner's answers of 2026-10-21: the ISPSC scope is work tables, sinks, gas ranges and exhaust hoods (one sentence, the same on the
//     homepage and every page), and DMMMSU is in La Union — said in the project description wherever the project is shown, on the /work/ and
//     /areas-we-serve/ pages and in the map section, never in a header, footer, call to action, contact detail or the JSON-LD address;
//   · the brand: "Barro Kitchens" is wrapped in <span data-brand> exactly once per page (the header lockup: what a rename SWAPS) and is, by the
//     owner's ruling of 2026-10-22, a PERMANENT name in each page's meta description and in the business JSON-LD (alternateName x2, brand.name,
//     the page node's description: what a rename KEEPS) — 8 mentions per page, pinned — and never in a <title> (these 12 pages keep their own
//     titles); the primary name everywhere is "Barro Industries";
//   · "Message us" (2026-10-22): the Messenger chat link (https://m.me/barrokitchens) is in every public footer, the homepage contact section and
//     the catalogue / FAQ call-to-action bands, written one way, with an inline icon and no Facebook / Meta asset, script or CSP change;
//   · internal links resolve, the hubs link to every child, every page links home, to the catalogue and to the quote flow;
//   · no app script, only the shared /js/site.js; nothing is in the service worker's PRECACHE.
//
// Mutation-tested in a scratch copy, never the shared tree (see the report that came with this file for the list that was run).
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const BASE = 'https://barroindustries.com';

// ── the pages ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SERVICE_SLUGS = ['commercial-kitchen-fit-out', 'stainless-steel-fabrication', 'exhaust-and-fresh-air-systems', 'lpg-gas-line-installation', 'kitchen-fire-suppression', 'institutional-and-government-supply'];
const WORK_SLUGS = ['ispsc-2026', 'dmmmsu-2022-2023'];
const PAGE_PATHS = ['/services/', ...SERVICE_SLUGS.map((s) => `/services/${s}/`), '/work/', ...WORK_SLUGS.map((w) => `/work/${w}/`), '/areas-we-serve/', '/faq/'];
const kindOf = (p) => (p === '/services/' ? 'hub-services' : p === '/work/' ? 'hub-work' : p.startsWith('/services/') ? 'service' : p.startsWith('/work/') ? 'work' : p === '/areas-we-serve/' ? 'areas' : 'faq');

// ── a small HTML scanner (no dependency): elements with their ancestors, text nodes, attributes, comments, script bodies, and every
// structural problem met (a stray closing tag, a closing tag that skips an unclosed element, an element still open at the end) ──────────
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
    if (m[3] === undefined) continue;
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
    if (tag === 'script' || tag === 'style') {
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
const decode = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const stripTags = (html, sep = ' ') => html.replace(/<!--[\s\S]*?-->/g, sep).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, sep).replace(/<[^>]+>/g, sep);
const visibleText = (html) => decode(stripTags(html)).replace(/\s+/g, ' ').trim();
const inBody = (chain) => chain.some((e) => e.tag === 'body');
const inHead = (chain) => chain.some((e) => e.tag === 'head');
const inId = (chain, id) => chain.some((e) => e.attrs.id === id);

// the size of a WebP file, from its header (lossy VP8, lossless VP8L or extended VP8X)
function webpSize(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  assert.ok(b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP', `${file} is not a WebP`);
  const f = b.toString('ascii', 12, 16);
  if (f === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (f === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  if (f === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  throw new Error(`${file}: unknown WebP chunk ${f}`);
}

// ── load every page once ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PAGES = PAGE_PATHS.map((p) => {
  const file = p.slice(1) + 'index.html';
  const html = exists(file) ? read(file) : '';
  const S = html ? scan(html) : null;
  const o = { path: p, file, kind: kindOf(p), url: BASE + p, html, S };
  if (!html) return o;
  o.head = html.slice(0, html.indexOf('</head>'));
  o.bodyHtml = html.slice(html.indexOf('<body'));
  const headEls = S.elements.filter((e) => inHead(e.chain));
  o.meta = (key) => { const e = headEls.find((x) => x.tag === 'meta' && (x.attrs.name === key || x.attrs.property === key)); return e ? decode(e.attrs.content || '') : null; };
  o.metaCount = (key) => headEls.filter((x) => x.tag === 'meta' && (x.attrs.name === key || x.attrs.property === key)).length;
  o.links = (rel) => headEls.filter((x) => x.tag === 'link' && (x.attrs.rel || '').split(/\s+/).includes(rel)).map((x) => x.attrs);
  const titles = S.texts.filter((t) => inHead(t.chain) && t.chain[t.chain.length - 1].tag === 'title');
  o.titleCount = headEls.filter((x) => x.tag === 'title').length;
  o.title = titles.length ? decode(titles[0].text) : '';
  o.ldScripts = S.scripts.filter((s) => s.attrs.type === 'application/ld+json');
  o.ld = o.ldScripts.map((s) => JSON.parse(s.body));
  o.graph = o.ld[0] && o.ld[0]['@graph'] ? o.ld[0]['@graph'] : [];
  o.node = (type) => o.graph.filter((n) => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).includes(type));
  o.body = S.texts.filter((t) => inBody(t.chain)).map((t) => decode(t.text)).join(' ').replace(/\s+/g, ' ').trim();
  o.header = (html.match(/<header id="site-header">[\s\S]*?<\/header>/) || [''])[0];
  o.footer = (html.match(/<footer id="site-footer">[\s\S]*?<\/footer>/) || [''])[0];
  o.main = (html.match(/<main\b[\s\S]*?<\/main>/) || [''])[0];
  o.imgs = S.elements.filter((e) => e.tag === 'img');
  o.headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({ level: +m[1], text: visibleText(m[2]) }));
  return o;
});
const byPath = (p) => PAGES.find((x) => x.path === p);
const each = (fn) => { for (const p of PAGES) fn(p); };

// strings a visitor, a crawler or a snippet can read (everything except the page's own scripts' code)
function publicStrings(p) {
  const out = [{ kind: 'title', value: p.title }];
  for (const t of p.S.texts) if (inBody(t.chain)) out.push({ kind: 'text', value: decode(t.text) });
  for (const a of p.S.attrs) if (['alt', 'title', 'aria-label', 'content', 'placeholder'].includes(a.name)) out.push({ kind: `<${a.tag} ${a.name}>`, value: decode(a.value) });
  for (const c of p.S.comments) out.push({ kind: 'comment', value: c.text });
  // the copyright markup (2026-10-22) is schema.org vocabulary, not copy: the key "license" and the type "Organization" are not claims or a US spelling
  for (const s of p.S.scripts) if (s.attrs.type === 'application/ld+json') out.push({ kind: 'json-ld', value: s.body.replace(/"license":\s*"https:\/\/barroindustries\.com\/#copyright"/g, '""').replace(/"@type":\s*"Organization"/g, '"@type": ""') });
  return out;
}
const firstHit = (p, re) => { const hit = publicStrings(p).find((s) => re.test(s.value)); return hit ? `${hit.kind}: "${(hit.value.match(re) || [])[0]}"` : null; };
const noHit = (re, label) => each((p) => assert.equal(firstHit(p, re), null, `${p.path}: ${label}`));
const allKeys = (v, out = new Set()) => { if (Array.isArray(v)) v.forEach((x) => allKeys(x, out)); else if (v && typeof v === 'object') for (const k of Object.keys(v)) { out.add(k); allKeys(v[k], out); } return out; };
const allStrings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out)); return out; };

// ── facts copied from the homepage and the catalogue: the pages must keep saying exactly this ─────────────────────────────────────────
const home = read('index.html');
const homeSite = home.slice(home.indexOf('<div id="site"'), home.indexOf('<!-- /#site -->'));
const catalogue = read('catalogue/index.html');
const siteJs = read('js/site.js');
const pagesCss = read('css/pages.css');
const PLACE_URL = 'https://www.google.com/maps/place/Barro+Industries/@14.6852336,121.0376564,17z/data=!3m1!4b1!4m6!3m5!1s0x3397b7e5c5101e17:0x43c0f9fffeef237!8m2!3d14.6852336!4d121.0376564!16s%2Fg%2F11p24zhgfq';
const FB = 'https://www.facebook.com/barrokitchens';
const ALT_NAMES = ['Barro Kitchens', 'Barro Kitchens by Barro Industries'];   // PERMANENT (owner ruling 2026-10-22): a historic name of the business, kept even after a rebrand
const MSGR = 'https://m.me/barrokitchens';   // the Messenger chat (owner 2026-10-22): "Message us"
// the link exactly as it is written everywhere: an inline chat-bubble icon (one <path>, no image, no external file), target + rel, data-brand (the handle is the brand's)
const MSG_ICON = '<svg class="msg-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
const msgLink = (cls, text) => `<a ${cls ? `class="${cls}" ` : ''}href="${MSGR}" rel="noopener" target="_blank" data-brand>${MSG_ICON}${text}</a>`;
const ADDRESS ='21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila, Philippines';
const PLACES = ['Ilocos Sur', 'La Union', 'Baguio', 'La Trinidad', 'Tarlac', 'Pampanga', 'Bulacan', 'Iba, Zambales', 'Subic', 'Manila', 'Cavite', 'Laguna', 'Batangas'];
const GROUPS = [['North Luzon', ['ilocos-sur', 'la-union', 'baguio', 'la-trinidad']], ['Central Luzon', ['tarlac', 'pampanga', 'bulacan', 'iba-zambales', 'subic']], ['Metro Manila & South', ['manila', 'cavite', 'laguna', 'batangas']]];
const BADGES = ['PhilGEPS-registered', 'SEC-registered', 'VAT-registered'];
const STEP3_NEW = 'Built to order in SS304 or SS316, finished brushed, mirror or satin, with seams welded and ground smooth.';
const REG_ICON = '<svg class="regs-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5.2c0 4.3 2.9 7.7 7 9.8 4.1-2.1 7-5.5 7-9.8V6l-7-3Z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>';

describe('the 12 pages exist, and nothing else lives in their folders', () => {
  it('has an index.html for every page the owner asked for', () => {
    for (const p of PAGES) assert.ok(p.html.length > 5000, `${p.file} is missing or empty`);
    assert.equal(PAGES.length, 12);
  });

  it('keeps the four folders to exactly those pages (no stray file, no per-town page) and adds nothing to the private /projects/ portal', () => {
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) (e.isDirectory() ? walk(`${d}/${e.name}`) : files.push(`${d}/${e.name}`)); };
    for (const d of ['services', 'work', 'areas-we-serve', 'faq']) walk(d);
    // (the fresh-air page, added 2026-10-22 beside these, is pinned by tests/seo-products.test.mjs)
    assert.deepEqual(files.sort(), [...PAGE_PATHS.map((p) => p.slice(1) + 'index.html'), 'services/fresh-air-systems/index.html'].sort());
    assert.ok(!PAGE_PATHS.some((p) => p.startsWith('/projects/')));
  });
});

describe('<head>: title, description, canonical, Open Graph, Twitter, CSP, fonts', () => {
  it('has one title of 45-75 characters ending "| Barro Industries", and every title is different', () => {
    each((p) => {
      assert.equal(p.titleCount, 1, `${p.path}: title count`);
      assert.ok(p.title.length >= 45 && p.title.length <= 75, `${p.path}: title is ${p.title.length} characters`);   // 75: the fabrication page's names both places people search (SEO build 2026-10-22)
      assert.ok(p.title.endsWith(' | Barro Industries'), `${p.path}: title does not end "| Barro Industries"`);
      assert.ok(!/\s{2,}/.test(p.title));
    });
    assert.equal(new Set(PAGES.map((p) => p.title)).size, PAGES.length, 'two pages share a title');
  });

  it('has one description of 130-165 characters (a sentence, ending in a full stop), and every description is different', () => {
    each((p) => {
      assert.equal(p.metaCount('description'), 1, `${p.path}: description count`);
      const d = p.meta('description');
      assert.ok(d.length >= 130 && d.length <= 165, `${p.path}: description is ${d.length} characters`);
      assert.ok(/[.]$/.test(d), `${p.path}: description does not end with a full stop`);
      assert.ok(!/\s{2,}/.test(d));
    });
    assert.equal(new Set(PAGES.map((p) => p.meta('description'))).size, PAGES.length, 'two pages share a description');
  });

  it('has one canonical, equal to the page\'s own https://barroindustries.com URL with a trailing slash, and every canonical is different', () => {
    each((p) => {
      const c = p.links('canonical');
      assert.equal(c.length, 1, `${p.path}: canonical count`);
      assert.equal(c[0].href, BASE + p.path);
      assert.match(c[0].href, /^https:\/\/barroindustries\.com\/[a-z0-9\-/]+\/$/);
    });
    assert.equal(new Set(PAGES.map((p) => p.links('canonical')[0].href)).size, PAGES.length);
  });

  it('is indexable, English, standard viewport, with the site\'s icons', () => {
    each((p) => {
      assert.match(p.html, /^<!DOCTYPE html>\s*<html lang="en" data-view="site">/);
      assert.match(p.meta('robots'), /^index,follow(,max-image-preview:large)?$/, `${p.path}: robots`);
      assert.ok(!/noindex|nofollow/i.test(p.meta('robots')));
      assert.equal(p.meta('viewport'), 'width=device-width, initial-scale=1.0, viewport-fit=cover');
      assert.equal(p.meta('theme-color'), '#FFFFFF');
      assert.ok(p.html.includes('<meta charset="UTF-8">'));
      assert.ok(p.html.includes('<link rel="icon" type="image/png" href="/favicon.png">'));
      assert.ok(p.html.includes('<link rel="apple-touch-icon" href="/icons/icon-192.png">'));
    });
  });

  it('has Open Graph and Twitter large-card tags that agree with the title and the description, and a real photo at an absolute URL', () => {
    each((p) => {
      assert.equal(p.meta('og:type'), 'website');
      assert.equal(p.meta('og:site_name'), 'Barro Industries');
      assert.equal(p.meta('og:locale'), 'en_PH');
      assert.equal(p.meta('og:title'), p.title);
      assert.equal(p.meta('og:description'), p.meta('description'));
      assert.equal(p.meta('og:url'), p.url);
      assert.equal(p.meta('twitter:card'), 'summary_large_image');
      assert.equal(p.meta('twitter:title'), p.title);
      assert.equal(p.meta('twitter:description'), p.meta('description'));
      const img = p.meta('og:image');
      assert.match(img, /^https:\/\/barroindustries\.com\/site\/img\/pages\/og-[a-z-]+\.webp$/, `${p.path}: og:image`);
      assert.equal(p.meta('twitter:image'), img);
      const file = img.replace(BASE + '/', '');
      assert.ok(exists(file), `${p.path}: ${file} does not exist`);
      const { w, h } = webpSize(file);
      assert.equal(String(w), p.meta('og:image:width'), `${p.path}: og:image:width`);
      assert.equal(String(h), p.meta('og:image:height'), `${p.path}: og:image:height`);
      assert.deepEqual([w, h], [1200, 630]);
      assert.ok(p.meta('og:image:alt').length > 20 && p.meta('og:image:alt') === p.meta('twitter:image:alt'));
      for (const k of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type', 'og:site_name', 'twitter:card']) assert.equal(p.metaCount(k), 1, `${p.path}: ${k} appears ${p.metaCount(k)} times`);
    });
    assert.equal(new Set(PAGES.map((p) => p.meta('og:image'))).size, PAGES.length, 'two pages share a social image');
  });

  it('keeps the new images in their own folder, site/img/pages/: the 12 social images and the 1000px lead-photo candidates the pages use, nothing else, each light — and none in the project-photo folder', () => {
    const dir = fs.readdirSync(path.join(ROOT, 'site/img/pages')).sort();
    const og = PAGES.map((p) => p.meta('og:image').split('/').pop());
    const heroes = [...new Set(PAGES.flatMap((p) => p.imgs.filter((e) => e.attrs.srcset).flatMap((e) => e.attrs.srcset.split(',').map((c) => c.trim().split(/\s+/)[0]).filter((u) => u.startsWith('/site/img/pages/')))))].map((u) => u.split('/').pop());
    assert.ok(heroes.length >= 8 && heroes.every((h) => /^hero-(ispsc|dmmmsu)-\d\d\.webp$/.test(h)), `hero candidates: ${heroes}`);
    assert.deepEqual(dir, [...og, ...heroes].sort(), 'site/img/pages holds a file no page uses, or a page uses a file that is not there');
    for (const f of dir) assert.ok(fs.statSync(path.join(ROOT, 'site/img/pages', f)).size < 160 * 1024, `${f} is heavy`);
    for (const h of heroes) assert.deepEqual(Object.values(webpSize(`site/img/pages/${h}`)), [1000, 750], `${h} is not 1000x750`);
    const count = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name)) : count.push(e.name)); })(path.join(ROOT, 'site/img/projects'));
    assert.equal(count.length, 26, 'the 13 project photos and their thumbs are the only files in site/img/projects');
  });

  it('has a CSP that allows the site\'s own files and the two font hosts, and nothing else (no inline style, no unsafe-*, no connections)', () => {
    each((p) => {
      assert.equal(p.html.match(/<meta http-equiv="Content-Security-Policy"/g).length, 1);
      const csp = p.html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)[1];
      const dir = Object.fromEntries(csp.split(';').map((x) => x.trim()).filter(Boolean).map((x) => [x.split(/\s+/)[0], x.split(/\s+/).slice(1)]));
      assert.deepEqual(dir['default-src'], ["'self'"]);
      assert.deepEqual(dir['script-src'], ["'self'"]);
      assert.deepEqual(dir['style-src'], ["'self'", 'https://fonts.googleapis.com']);
      assert.deepEqual(dir['font-src'], ['https://fonts.gstatic.com']);
      assert.deepEqual(dir['img-src'], ["'self'", 'data:']);
      assert.deepEqual(dir['frame-src'], ["'none'"]);
      assert.deepEqual(dir['object-src'], ["'none'"]);
      assert.deepEqual(Object.keys(dir).sort(), ['base-uri', 'default-src', 'font-src', 'form-action', 'frame-src', 'img-src', 'object-src', 'script-src', 'style-src']);
      assert.ok(!/unsafe-inline|unsafe-eval|\*|connect-src/.test(csp));
    });
  });

  it('loads site.css then pages.css, and the same two Google Fonts (Fraunces + Inter, display=swap) as the other public pages — nothing else', () => {
    each((p) => {
      const sheets = p.S.elements.filter((e) => e.tag === 'link' && e.attrs.rel === 'stylesheet').map((e) => e.attrs.href);
      assert.deepEqual(sheets, ['https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..600&family=Inter:wght@400;500;600&display=swap', '/css/site.css', '/css/pages.css']);
      assert.ok(p.html.includes('<link rel="preconnect" href="https://fonts.googleapis.com">') && p.html.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'));
    });
    assert.ok(catalogue.includes('family=Fraunces:opsz,wght@9..144,500..600&family=Inter:wght@400;500;600&display=swap'), 'the catalogue page loads different fonts');
  });
});

describe('markup: one H1, a logical heading order, unique ids, every image sized, described and lazy where it can be', () => {
  it('is well-formed: no stray, skipped or unclosed element', () => {
    each((p) => assert.deepEqual(p.S.problems, [], p.path));
  });

  it('has exactly one <h1>, one <main id="site-main">, one header, one footer, and a skip link first', () => {
    each((p) => {
      assert.equal(p.headings.filter((h) => h.level === 1).length, 1, `${p.path}: <h1> count`);
      assert.equal(p.S.elements.filter((e) => e.tag === 'main').length, 1);
      assert.ok(/<main id="site-main" tabindex="-1">/.test(p.html));
      assert.equal(p.S.elements.filter((e) => e.tag === 'header' && e.attrs.id === 'site-header').length, 1);
      assert.equal(p.S.elements.filter((e) => e.tag === 'footer' && e.attrs.id === 'site-footer').length, 1);
      assert.ok(p.bodyHtml.replace(/\s+/g, ' ').indexOf('<div id="site" class="pg"> <a class="skip-link" href="#site-main">Skip to the content</a>') >= 0, `${p.path}: skip link`);
      assert.ok(p.html.includes('<div id="site" class="pg">') && p.html.includes('</div><!-- /#site -->'));
    });
    assert.equal(new Set(PAGES.map((p) => p.headings.find((h) => h.level === 1).text)).size, PAGES.length, 'two pages share an H1');
  });

  it('never skips a heading level, and has no empty heading', () => {
    each((p) => {
      let prev = 0;
      for (const h of p.headings) {
        assert.ok(h.text.length > 2, `${p.path}: an empty heading`);
        assert.ok(h.level <= prev + 1, `${p.path}: "${h.text}" jumps from h${prev} to h${h.level}`);
        prev = h.level;
      }
      assert.ok(p.headings.length >= 4, `${p.path}: only ${p.headings.length} headings`);
    });
  });

  it('has unique ids, every aria-labelledby and in-page link points at an id that exists', () => {
    each((p) => {
      const ids = p.S.elements.map((e) => e.attrs.id).filter(Boolean);
      assert.equal(new Set(ids).size, ids.length, `${p.path}: duplicate id ${ids.find((x, i) => ids.indexOf(x) !== i)}`);
      for (const a of p.S.attrs.filter((x) => x.name === 'aria-labelledby' || x.name === 'aria-controls')) for (const id of a.value.split(/\s+/)) assert.ok(ids.includes(id), `${p.path}: ${a.name}="${id}" has no target`);
      for (const a of p.S.attrs.filter((x) => x.tag === 'a' && x.name === 'href' && x.value.startsWith('#'))) assert.ok(ids.includes(a.value.slice(1)), `${p.path}: ${a.value} has no target`);
    });
  });

  it('gives every image alt text, width and height equal to its file, existing files, one high-priority hero and lazy everything else', () => {
    each((p) => {
      const imgs = p.imgs.filter((e) => e.attrs.id !== 'site-lightbox-img');
      assert.ok(imgs.length >= 1);
      let high = 0;
      for (const { attrs: a } of imgs) {
        assert.ok(a.alt && a.alt.trim().length >= 10, `${p.path}: an image has no alt text (${a.src})`);
        assert.match(a.src, /^\/site\/img\/(barro-kitchens-96\.webp|projects\/(ispsc|dmmmsu)\/\d\d(-thumb)?\.webp|products\/[a-z0-9-]+\.webp)$/, `${p.path}: unexpected image ${a.src}`);
        assert.ok(exists(a.src.slice(1)), `${p.path}: ${a.src} does not exist`);
        const { w, h } = webpSize(a.src.slice(1));
        if (a.src === '/site/img/barro-kitchens-96.webp') assert.deepEqual([a.width, a.height, w, h], ['36', '36', 96, 96], `${p.path}: the logo is shown at 36px from the 96px file`);
        else { assert.equal(a.width, String(w), `${p.path}: ${a.src} width`); assert.equal(a.height, String(h), `${p.path}: ${a.src} height`); }
        if (a.srcset) for (const cand of a.srcset.split(',').map((s) => s.trim())) {
          const [u, d] = cand.split(/\s+/);
          assert.ok(exists(u.slice(1)), `${p.path}: srcset ${u} does not exist`);
          assert.equal(d, `${webpSize(u.slice(1)).w}w`, `${p.path}: srcset descriptor of ${u}`);
        }
        if (a.fetchpriority === 'high') { high++; assert.ok(!a.loading, `${p.path}: the hero is lazy`); }
        else if (a.src === '/site/img/barro-kitchens-96.webp') assert.deepEqual([a.width, a.height], ['36', '36']);       // the 36px logo in the header is the one small eager image
        else { assert.equal(a.loading, 'lazy', `${p.path}: ${a.src} is not lazy`); assert.equal(a.decoding, 'async'); }
      }
      const hasHeroPhoto = !['areas', 'faq'].includes(p.kind);
      assert.equal(high, hasHeroPhoto ? 1 : 0, `${p.path}: fetchpriority="high" count`);
    });
  });

  it('uses, for every project photo, an alt text the homepage already uses for that same file (no new claim in an alt)', () => {
    const homeAlts = {};
    for (const m of home.matchAll(/<img\b[^>]*?\bsrc="(site\/img\/projects\/(?:ispsc|dmmmsu)\/\d\d)(?:-thumb)?\.webp"[^>]*?\balt="([^"]*)"/g)) (homeAlts[m[1]] ||= new Set()).add(decode(m[2]));
    for (const m of home.matchAll(/<img\b[^>]*?\balt="([^"]*)"[^>]*?\bsrc="(site\/img\/projects\/(?:ispsc|dmmmsu)\/\d\d)(?:-thumb)?\.webp"/g)) (homeAlts[m[2]] ||= new Set()).add(decode(m[1]));
    assert.ok(Object.keys(homeAlts).length >= 13, 'the homepage alt texts could not be read');
    each((p) => {
      for (const { attrs: a } of p.imgs) {
        const m = (a.src || '').match(/^\/(site\/img\/projects\/(?:ispsc|dmmmsu)\/\d\d)(?:-thumb)?\.webp$/);
        if (!m) continue;
        assert.ok(homeAlts[m[1]] && [...homeAlts[m[1]]].some((x) => x === decode(a.alt)), `${p.path}: the alt of ${a.src} is not one the homepage uses: "${a.alt}"`);
      }
    });
  });
});

describe('JSON-LD: LocalBusiness, BreadcrumbList, Service / CreativeWork / ItemList / FAQPage — and nothing that is a price, an offer, a rating or a credential', () => {
  const BAD_KEYS = ['price', 'priceRange', 'priceCurrency', 'lowPrice', 'highPrice', 'offers', 'offer', 'makesOffer', 'hasOfferCatalog', 'availability', 'aggregateRating', 'ratingValue', 'ratingCount', 'reviewCount', 'bestRating', 'review', 'reviews', 'rating', 'openingHours', 'openingHoursSpecification', 'award', 'awards', 'hasCredential', 'vatID', 'taxID', 'slogan', 'paymentAccepted', 'currenciesAccepted', 'isicV4', 'naics', 'duns', 'leiCode'];

  it('has exactly one JSON-LD block that parses, is schema.org, and is one @graph', () => {
    each((p) => {
      assert.equal(p.ldScripts.length, 1, `${p.path}: JSON-LD block count`);
      assert.equal(p.ld[0]['@context'], 'https://schema.org');
      assert.ok(Array.isArray(p.graph) && p.graph.length >= 3);
      const ids = p.graph.map((n) => n['@id']).filter(Boolean);
      assert.equal(new Set(ids).size, ids.length, `${p.path}: duplicate @id`);
    });
  });

  it('carries no price, offer, rating, review, opening-hours or credential key anywhere, and no money in any string', () => {
    each((p) => {
      const keys = allKeys(p.ld);
      for (const k of BAD_KEYS) assert.ok(!keys.has(k), `${p.path}: JSON-LD has a "${k}" key`);
      for (const s of allStrings(p.ld)) assert.ok(!/₱|\bPHP ?\d|\b\d{1,3}(,\d{3})+\b|\bpric(e|es|ed|ing)\b|\bcosts?\b|\bfree\b|\bdiscount/i.test(s), `${p.path}: money in JSON-LD: ${s.slice(0, 60)}`);
    });
  });

  it('has the one LocalBusiness: "Barro Industries", legal name "Barro Industries OPC", the alternate names ["Barro Kitchens", "Barro Kitchens by Barro Industries"], the verified address, phone, email, Maps place, Facebook, the brand and the 13 places', () => {
    each((p) => {
      const lb = p.node('LocalBusiness');
      assert.equal(lb.length, 1, `${p.path}: LocalBusiness count`);
      const b = lb[0];
      assert.deepEqual(Object.keys(b).sort(), ['@id', '@type', 'address', 'alternateName', 'areaServed', 'brand', 'email', 'geo', 'hasMap', 'image', 'legalName', 'logo', 'name', 'sameAs', 'telephone', 'url']);
      assert.equal(b['@id'], BASE + '/#business');
      assert.equal(b.name, 'Barro Industries');
      assert.equal(b.legalName, 'Barro Industries OPC');
      assert.deepEqual(b.alternateName, ALT_NAMES, `${p.path}: the permanent alternate names`);
      assert.equal(b.url, BASE + '/');
      assert.equal(b.telephone, '+63 927 683 6300');
      assert.equal(b.email, 'hello@barroindustries.com');
      assert.deepEqual(b.address, { '@type': 'PostalAddress', streetAddress: '21 Capricorn St., Tandang Sora', addressLocality: 'Quezon City', postalCode: '1116', addressRegion: 'Metro Manila', addressCountry: 'PH' });
      assert.deepEqual(b.geo, { '@type': 'GeoCoordinates', latitude: 14.6852336, longitude: 121.0376564 });
      assert.equal(b.hasMap, PLACE_URL);
      assert.deepEqual(b.sameAs, [FB, PLACE_URL]);
      assert.deepEqual(b.brand, { '@type': 'Brand', name: 'Barro Kitchens' });
      assert.deepEqual(b.areaServed, PLACES.map((name) => ({ '@type': 'Place', name })));
      assert.ok(exists(b.logo.replace(BASE + '/', '')) && exists(b.image.replace(BASE + '/', '')));
    });
  });

  it('has a BreadcrumbList that is the visible breadcrumb: the same names, the same links, the page itself last', () => {
    each((p) => {
      const bc = p.node('BreadcrumbList');
      assert.equal(bc.length, 1);
      const items = bc[0].itemListElement;
      const visible = [...p.html.match(/<nav class="crumbs" aria-label="Breadcrumb"><ol>([\s\S]*?)<\/ol><\/nav>/)[1].matchAll(/<li>(?:<a href="([^"]+)">)?(?:<span aria-current="page">)?([^<]+)/g)].map((m) => [decode(m[2]), m[1] || null]);
      assert.equal(items.length, visible.length, `${p.path}: breadcrumb length`);
      items.forEach((it, i) => {
        assert.equal(it['@type'], 'ListItem');
        assert.equal(it.position, i + 1);
        assert.equal(it.name, visible[i][0], `${p.path}: breadcrumb ${i + 1} name`);
        assert.equal(it.item, BASE + (visible[i][1] || p.path), `${p.path}: breadcrumb ${i + 1} link`);
      });
      assert.equal(items[0].item, BASE + '/');
      assert.equal(items[items.length - 1].item, p.url);
      assert.equal(items.length, p.path.split('/').filter(Boolean).length + 1);
      assert.equal(bc[0]['@id'], p.url + '#breadcrumb');
    });
  });

  it('has a page node of the right kind that points at the breadcrumb, the page URL and the social photo', () => {
    each((p) => {
      const type = p.kind === 'faq' ? 'FAQPage' : p.kind.startsWith('hub') ? 'CollectionPage' : 'WebPage';
      const n = p.node(type);
      assert.equal(n.length, 1, `${p.path}: ${type} count`);
      assert.equal(n[0]['@id'], p.url + '#webpage');
      assert.equal(n[0].url, p.url);
      assert.equal(n[0].name, p.headings.find((h) => h.level === 1).text);
      assert.equal(n[0].description, p.meta('description'));
      assert.equal(n[0].inLanguage, 'en-PH');
      assert.deepEqual(n[0].breadcrumb, { '@id': p.url + '#breadcrumb' });
      assert.equal(n[0].primaryImageOfPage.url, p.meta('og:image'));
      assert.deepEqual([n[0].primaryImageOfPage.width, n[0].primaryImageOfPage.height], [1200, 630]);
    });
  });

  it('gives every service page a Service whose provider is the LocalBusiness, with the 13 places, the page URL and a description', () => {
    for (const p of PAGES.filter((x) => x.kind === 'service')) {
      const s = p.node('Service');
      assert.equal(s.length, 1, `${p.path}: Service count`);
      assert.equal(s[0]['@id'], p.url + '#service');
      assert.deepEqual(s[0].provider, { '@id': BASE + '/#business' });
      assert.ok(p.graph.some((n) => n['@id'] === s[0].provider['@id'] && n['@type'] === 'LocalBusiness'), 'the provider reference does not resolve');
      assert.deepEqual(s[0].areaServed, PLACES.map((name) => ({ '@type': 'Place', name })));
      assert.equal(s[0].url, p.url);
      assert.ok(s[0].name.length > 10 && s[0].serviceType.length > 10 && s[0].description.length > 80);
      assert.equal(s[0].image, p.meta('og:image'));
      assert.deepEqual(p.node('WebPage')[0].mainEntity, { '@id': p.url + '#service' });
      assert.ok(!s[0].description.match(/₱|\d,\d{3}/));
    }
    assert.equal(PAGES.filter((p) => p.kind !== 'service' && p.node('Service').length).length, 0, 'only service pages have a Service node');
  });

  it('gives each project page an honest CreativeWork (the project, its photos, the business as creator) — no review, no rating', () => {
    for (const p of PAGES.filter((x) => x.kind === 'work')) {
      const w = p.node('CreativeWork');
      assert.equal(w.length, 1);
      assert.deepEqual(w[0].creator, { '@id': BASE + '/#business' });
      const gallery = [...p.html.matchAll(/<a href="(\/site\/img\/projects\/[a-z]+\/\d\d\.webp)" data-lightbox>/g)].map((m) => BASE + m[1]);
      assert.deepEqual(w[0].image.map((i) => i.contentUrl), gallery, `${p.path}: JSON-LD images are not the gallery`);
      for (const i of w[0].image) assert.ok(exists(i.contentUrl.replace(BASE + '/', '')) && i.caption.length > 15);
      assert.deepEqual(p.node('WebPage')[0].mainEntity, { '@id': p.url + '#project' });
    }
  });

  it('gives each hub an ItemList of exactly its children, in page order', () => {
    const svc = byPath('/services/'), work = byPath('/work/');
    const ls = svc.node('CollectionPage')[0].mainEntity;
    assert.equal(ls['@type'], 'ItemList');
    assert.deepEqual(ls.itemListElement.map((i) => i.url), SERVICE_SLUGS.map((s) => `${BASE}/services/${s}/`));
    assert.deepEqual(ls.itemListElement.map((i) => i.position), [1, 2, 3, 4, 5, 6]);
    const lw = work.node('CollectionPage')[0].mainEntity;
    assert.deepEqual(lw.itemListElement.map((i) => i.url), WORK_SLUGS.map((s) => `${BASE}/work/${s}/`));
    for (const [hub, list] of [[svc, ls], [work, lw]]) for (const i of list.itemListElement) assert.ok(hub.html.includes(`href="${i.url.replace(BASE, '')}"`), `${hub.path} does not link to ${i.url}`);
  });

  it('names the brand in the JSON-LD in exactly four places: LocalBusiness.alternateName (two names), LocalBusiness.brand.name and the description of the page node (which is the meta description)', () => {
    each((p) => {
      const hits = [];
      (function walk(v, at) { if (typeof v === 'string') { if (/Barro\s+Kitchens/i.test(v)) hits.push(at); } else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], at ? `${at}.${k}` : k); })(p.graph, '');
      assert.equal(hits.length, 4, `${p.path}: ${hits.join(', ')}`);
      assert.deepEqual(hits.map((h) => h.replace(/^\d+\./, '')), ['alternateName.0', 'alternateName.1', 'brand.name', 'description'], `${p.path}: ${hits.join(', ')}`);
      assert.deepEqual(p.node('LocalBusiness')[0].brand, { '@type': 'Brand', name: 'Barro Kitchens' });
    });
  });
});

describe('the FAQ: the owner\'s questions, answered only with confirmed facts, and FAQPage = the visible Q&A word for word', () => {
  const faq = byPath('/faq/');
  const visible = [...faq.html.matchAll(/<div class="faq-item">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g)].map((m) => [visibleText(m[1]), visibleText(m[2])]);
  const REQUIRED = [
    ['What material do you use?', ['Food-grade SS304 stainless steel as standard, and laboratory-grade SS316 on request, in a brushed, mirror or satin finish.']],
    ['Can you build to custom sizes?', ['Yes', 'made to order', 'exact dimensions']],
    ['What warranty do you give?', ['6-month service warranty', '12 months', 'preventive maintenance service (PMS)', 'KitchenShield™']],
    ['Do you supply government agencies and schools?', ['PhilGEPS-registered', 'Don Mariano Marcos Memorial State University (DMMMSU)', 'Ilocos Sur Polytechnic State College (ISPSC)', 'procurement rules']],
    ['How do I get a quote?', ['online', 'estimated range', 'final quotation', 'No account is needed']],
    ['Do you install?', ['design, fabricate, deliver and install']],
    ['Which areas do you serve?', ['across Luzon', 'Ilocos Sur', 'Batangas', 'Quezon City']],
    ['Are you VAT- and SEC-registered?', ['Yes', 'SEC-registered', 'VAT-registered']],
    ['Where are you located?', [ADDRESS]],
  ];

  it('has every question the owner listed, each answered with the facts the owner confirmed', () => {
    for (const [q, needles] of REQUIRED) {
      const hit = visible.find((v) => v[0] === q);
      assert.ok(hit, `the FAQ lacks "${q}"`);
      for (const n of needles) assert.ok(hit[1].includes(n), `"${q}" no longer says "${n}"`);
    }
  });

  it('mirrors the visible Q&A exactly in FAQPage JSON-LD: the same questions, the same answers, the same order', () => {
    const f = faq.node('FAQPage');
    assert.equal(f.length, 1);
    const q = f[0].mainEntity;
    assert.equal(q.length, visible.length, 'the number of questions differs');
    q.forEach((item, i) => {
      assert.equal(item['@type'], 'Question');
      assert.equal(item.acceptedAnswer['@type'], 'Answer');
      assert.equal(item.name, visible[i][0], `question ${i + 1}`);
      assert.equal(item.acceptedAnswer.text, visible[i][1], `answer ${i + 1}`);
      assert.deepEqual(Object.keys(item).sort(), ['@type', 'acceptedAnswer', 'name']);
    });
    assert.equal(new Set(q.map((x) => x.name)).size, q.length, 'a question is asked twice');
    assert.ok(visible.length >= 9 && visible.length <= 14);
  });

  it('says nothing about lead times, payment terms, delivery fees, discounts or prices — the only durations are the warranty\'s 6 and 12 months and the 23 years in business', () => {
    const WARRANTY = 'What warranty do you give?';
    for (const [q, a] of visible) {
      const text = `${q} ${a}`;
      assert.ok(!/\b(lead[- ]?times?|turnaround|within \d+|deposits?|down[- ]?payments?|installments?|payments?|delivery fees?|shipping|freight|free delivery|discounts?|prices?|pricing|cost|costs|₱|PHP)\b/i.test(text), `a lead time, payment term, fee or price is in "${q}"`);
      assert.ok(!/\b\d+\s*(?:%|percent)/.test(text), q);
      const durations = [...text.matchAll(/\b(\d+)[ -]?(minutes?|hours?|days?|weeks?|months?|years?)\b/gi)].map((m) => `${m[1]} ${m[2].replace(/s$/, '')}`);
      if (q === WARRANTY) assert.deepEqual(durations, ['6 month', '12 month'], q);
      else if (q === 'How long has Barro Industries been in business?') assert.deepEqual(durations, ['23 year'], q);
      else assert.deepEqual(durations, [], `a duration in "${q}"`);
    }
  });

  it('puts the questions in sentence case, each ending with a question mark, in headings under four group headings', () => {
    for (const [q] of visible) { assert.match(q, /^[A-Z][^?]*\?$/, q); assert.ok(!/\b[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+/.test(q), `a Title Case question: ${q}`); }
    assert.deepEqual(faq.headings.filter((h) => h.level === 2).map((h) => h.text).slice(0, 4), ['Our equipment', 'Quotes, installation and warranty', 'Who we work with', 'About the company']);
  });
});

describe('the owner\'s content rules (every page: text, alt text, meta, JSON-LD, comments)', () => {
  it('shows no price, no peso sign, no thousands-separated number and none of the pricing words — and keeps CHECK 9\'s token list out of the whole file', () => {
    const TOKENS = /basePrice|priceAdder|pricePer|rateW100|rateD100|rateH100|laborHours|ratePerDay|\bmarkup\b|₱|PHP ?[0-9]/i;
    each((p) => {
      assert.ok(!TOKENS.test(p.head), `${p.path}: a price token in the head`);
      assert.ok(!TOKENS.test(p.bodyHtml) && !/\b[0-9]{1,3}(,[0-9]{3})+\b/.test(p.bodyHtml), `${p.path}: a price token in the body`);
    });
    noHit(/₱|\bPHP\b|\bpesos?\b|\b\d{1,3}(,\d{3})+\b|\bpric(e|es|ed|ing)\b|\bcost(s|ing)?\b|\bcheap(er|est)?\b|\baffordabl|\bdiscounts?\b|\bpromos?\b|\bfree\b|\boffers?\b|\boffered\b|\bbudget\b|\bbargain/i, 'a price, an amount or a pricing word');
  });

  it('never names the partner company (in any spelling, slug or comment)', () => {
    const BRAND_RE = /brilliant[\s]*steel/i;
    each((p) => assert.ok(!BRAND_RE.test(p.html.replace(/[\s\-_./]+/g, ' ')), `${p.path}: the partner company is named`));
    assert.ok(!/brilliant[\s\-_.]*steel/i.test(pagesCss));
  });

  it('uses the one phone number, the one email address and the one Quezon City address — never Gmail, 0960, La Union or San Fernando as an address', () => {
    each((p) => {
      const digits = [...p.html.matchAll(/(?:\+?63[\s-]?|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/g)].map((m) => m[0].replace(/\D/g, '').replace(/^63/, '0'));
      assert.ok(digits.length >= 1 && digits.every((d) => d === '09276836300'), `${p.path}: phone numbers ${digits}`);
      assert.ok(!/0960/.test(p.html));
      const emails = [...new Set([...p.html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)].map((m) => m[0].toLowerCase()))];
      assert.deepEqual(emails, ['hello@barroindustries.com'], `${p.path}: email addresses`);
      assert.ok(!/gmail/i.test(p.html));
      assert.ok(!/San\s*Fernando|purok|carlatan/i.test(p.html), `${p.path}: an old address`);
      assert.equal((p.body.match(/Capricorn/g) || []).length, p.kind === 'areas' || p.kind === 'faq' ? 2 : 1, `${p.path}: the street address appears the expected number of times`);
      assert.ok(p.footer.includes(`<p>${ADDRESS}</p>`), `${p.path}: the footer address`);
      assert.ok(!/\b(Barangay|Brgy|Poblacion|Sampaloc|Makati|Pasig|Taguig|Mandaluyong|Cebu|Davao)\b/.test(p.body), `${p.path}: another address`);
    });
  });

  it('keeps La Union where the owner allowed it (2026-10-21): the map section, areaServed, the DMMMSU project wherever it is described, and the /work/ and /areas-we-serve/ pages — never the header, footer, call to action, contact details or the JSON-LD address', () => {
    const LU = /La\s*Union/i;
    const inTag = (chain, tag) => chain.some((e) => e.tag === tag);
    const chrome = (chain) => inTag(chain, 'header') || inTag(chain, 'footer') || inId(chain, 'get-a-quote');
    const inCard = (chain) => chain.some((e) => /(^|\s)pg-card(\s|$)/.test(e.attrs.class || ''));
    const isWork = (p) => p.path.startsWith('/work/') || p.path === '/areas-we-serve/';
    const showsProjectCards = (p) => p.path === '/services/' || p.path === '/services/institutional-and-government-supply/';
    const metaKeys = new Set(['description', 'og:description', 'twitter:description', 'og:title', 'twitter:title']);
    each((p) => {
      const bad = [];
      for (const t of p.S.texts) {
        if (!LU.test(t.text)) continue;
        if (inHead(t.chain)) { if (!(isWork(p) && t.chain[t.chain.length - 1].tag === 'title')) bad.push('head text'); continue; }
        // Owner 2026-10-22: the FAQ's history answer says the family business began in Baguio City and La Union.
        const faqOrigin = p.path === '/faq/' && !chrome(t.chain) && /began as a family business in Baguio City and La Union\./.test(t.text);
        if (!(inId(t.chain, 'luzon') || (isWork(p) && !chrome(t.chain)) || (showsProjectCards(p) && inCard(t.chain)) || faqOrigin)) bad.push(t.text.trim().slice(0, 60));
      }
      for (const e of p.S.elements) {
        if (e.tag === 'meta') { if (LU.test(e.attrs.content || '') && !(isWork(p) && metaKeys.has(e.attrs.name || e.attrs.property))) bad.push(`meta ${e.attrs.name || e.attrs.property}`); continue; }
        for (const [k, v] of Object.entries(e.attrs)) if (LU.test(v) && !(inId(e.chain, 'luzon') || (isWork(p) && !chrome(e.chain)))) bad.push(`${e.tag}[${k}]`);
      }
      for (const c of p.S.comments) if (LU.test(c.text)) bad.push('comment');
      assert.deepEqual(bad, [], `${p.path}: La Union outside the places the owner allowed`);
      // the JSON-LD: the business address and everything that is not a project description stays free of it; areaServed lists it
      for (const n of p.graph) {
        const type = [].concat(n['@type']).join();
        const { areaServed, ...rest } = n;
        if (type === 'LocalBusiness') assert.ok(!LU.test(JSON.stringify(n.address)) && !LU.test(JSON.stringify(rest)), `${p.path}: La Union in the business address`);
        else if (!isWork(p) && !(p.path === '/faq/' && type === 'FAQPage')) assert.ok(!LU.test(JSON.stringify(rest)), `${p.path}: La Union in the ${type} JSON-LD`);
      }
      assert.ok(publicStrings(p).filter((s) => s.kind !== 'json-ld').length > 5);
    });
    const areas = byPath('/areas-we-serve/');
    assert.ok(/La Union/.test(areas.body));
  });

  it('states no number of projects, clients or customers (the owner withdrew "500+": it cannot be documented)', () => {
    noHit(/\b\d[\d,]*\+?\s+(projects|clients|customers|kitchens installed|installations|installed kitchens)\b|\b(hundreds|dozens|numerous|countless)\s+of\b|\b500\+|\bover \d+ (projects|clients)\b/i, 'a project-count claim');
  });

  it('names only DMMMSU and ISPSC as clients — their full names, no logos, no other institution, company or agency', () => {
    const ALLOWED = new Set(['Don Mariano Marcos Memorial State University', 'Ilocos Sur Polytechnic State College']);
    each((p) => {
      for (const t of p.S.texts.filter((x) => inBody(x.chain))) for (const m of decode(t.text).replace(/\bCompany profile \(PDF\)/g, '').matchAll(/\b((?:[A-Z][A-Za-z.'’&-]*\s+){0,7}(?:University|College|Institute|Hospital|Corporation|Company|Academy|Foundation|Hotel|Mall|Bank))\b/g)) assert.ok(ALLOWED.has(m[1]), `${p.path}: another institution is named: ${m[1]}`);
    });
    noHit(/\b(Lorma|ITRMC|Bethany|Casa Carmelo|Cosmos|Chibab|Aboy|Florante|Vhia|Plaza Premium|Jollibee|Starbucks|Mcdonald|Marriott|Hilton|Shangri)\b/i, 'a client other than DMMMSU and ISPSC');
    // images: only the brand mark, the project photos and the catalogue's representative pictures; nothing that is an agency logo or a seal
    each((p) => {
      for (const { attrs: a } of p.imgs.filter((e) => e.attrs.src)) assert.ok(!/\b(sec|dti|philgeps|bir|bureau|seal|certificate|accreditation|iso|badge|partner|client)\b/i.test(a.src.replace(/\.webp$/, '').replace(/[-/]/g, ' ') + ' ' + (a.alt || '').replace(/Barro Industries logo/, '')), `${p.path}: an agency-style image ${a.src}`);
      assert.ok(!/<(object|embed|iframe|picture|canvas|video|audio)\b/i.test(p.html));
    });
  });

  it('claims no "best / leading / world-class / award / certified / accredited / licensed", no standard, no compliance, no guarantee, no superlative', () => {
    noHit(/\b(best|leading|world[- ]class|award(?:s|[- ]winning)?|certified|certification|certif\w*|iso ?\d{3,}|lifetime|guarantee[ds]?|unrivall?ed|unmatched|unbeatable|number one|top[- ]rated|premier|foremost|finest|safest|flawless|perfect|accredit\w*|licen[cs]\w*|authori[sz]ed|approved by|endorse\w*|recogni[sz]ed by|government[- ]approved|official(?:ly)?)\b|#1/i, 'an unverifiable claim');
    noHit(/\b(corros\w*|chemical[- ]resist\w*|acids?|alkal\w*|chlorides?|saline|marine|pharmaceutical|surgical|autoclav\w*|sanitis\w*|sanitiz\w*|steril\w*|antibacterial|anti-?microbial|non-?reactive)\b/i, 'a chemical-resistance, hygiene or sterility claim beyond "laboratory grade"');
    noHit(/\b(compl(?:y|ies|iance|iant)|BFP|NFPA|PNS|ASTM|UL ?\d+|building codes?|safety codes?|regulations?|standards|(?:industry|international|national|safety|quality) standard)\b/i, 'a compliance or standards claim');
  });

  it('never mentions the system, the app, a login or the staff — the one way in is the footer "Team portal" link', () => {
    noHit(/operat(?:ing|ions?)\s+system|central\s+system|ops\s+system|apply\s+for\s+access|sign\s*up|firebase|\bPWA\b|\bweb\s?app\b|\bthe app\b|\bapp shell\b|\bBI Ops\b|\blog[- ]?in\b|\bsign[- ]?in\b|\bstaff\b|\bemployees?\b|\badmin\b|\bdashboard\b|\bsplash\b/i, 'the system, the app or a login');
    each((p) => {
      assert.ok(!/id="site-login|id="site-footer-login|site-login-btn|Staff login|>Login</.test(p.html), `${p.path}: a Login control`);
      assert.deepEqual([...p.html.matchAll(/<a[^>]*href="\/#login"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]), ['Team portal'], `${p.path}: the only /#login link is the footer "Team portal"`);
      assert.ok(p.footer.includes('<a class="foot-portal" href="/#login">Team portal</a>') && !p.header.includes('#login'));
      assert.ok(!/\bportal\b/i.test(p.body.replace('Team portal', '')), `${p.path}: "portal" outside the footer link`);
    });
  });

  it('is written in British English, with no doubled space, no hyphen used as a dash, and the ™ only on the brand lockup and KitchenShield', () => {
    noHit(/\b(catalog(?!ue)|colors?|centers?|meters?|labor|fiber(?:glass)?|galvaniz\w*|steriliz\w*|pasteuriz\w*|organiz\w*|customiz\w*|optimiz\w*|specializ\w*|standardiz\w*|centraliz\w*|minimiz\w*|maximiz\w*|utiliz\w*|recogniz\w*|summariz\w*|gray|aluminum|analyze[ds]?|defense|favor\w*|neighbor\w*|program(?!me))\b/i, 'a US spelling');
    each((p) => {
      const segments = stripTags(p.bodyHtml, '\u0001').split('\u0001').map((s) => s.trim()).filter(Boolean);
      for (const s of segments) assert.ok(!/\S {2,}\S/.test(s), `${p.path}: doubled space in "${s.slice(0, 50)}"`);
      assert.ok(!/ -- |\s-\s(?=[A-Za-z])/.test(p.body), `${p.path}: a hyphen used as a dash`);
      assert.ok(!/KitchenShield(?!™)/.test(p.body), `${p.path}: KitchenShield without its mark`);
      assert.equal((p.body.replace(/KitchenShield™/g, 'KitchenShield').match(/™/g) || []).length, 1, `${p.path}: ™ count outside KitchenShield`);
      assert.ok(p.body.replace(/\s/g, '').length > 600);
    });
  });

  it('keeps the tone: 23 years and high-quality on the services hub and every service page (proof bar), 23 years on the work hub and the FAQ, and "premium" where the owner\'s homepage uses it', () => {
    for (const p of PAGES.filter((x) => ['hub-services', 'service'].includes(x.kind))) {
      assert.ok(p.html.includes('<span class="proof-num">23</span> years'), `${p.path}: the 23 years proof item`);
      assert.ok(/High-quality/.test(p.body), `${p.path}: high-quality`);
    }
    assert.ok(byPath('/work/').body.includes('23 years'));
    const premium = PAGES.filter((p) => /\bpremium\b/i.test(`${p.meta('description')} ${p.body}`)).map((p) => p.path);
    assert.ok(premium.includes('/services/') && premium.includes('/services/commercial-kitchen-fit-out/') && premium.includes('/services/stainless-steel-fabrication/'), `"premium" is on ${premium}`);
    assert.ok(byPath('/faq/').body.includes('23 years'));
  });

  it('writes the verbs of a sentence in step (the owner caught "We design, fabricate, delivers and installs")', () => {
    noHit(/\bWe (design|fabricate|deliver|install)[^.]{0,80}\b(delivers|installs|fabricates|designs)\b|delivers and install\b|designs, fabricate\b/, 'verbs out of step');
  });

  it('registers PhilGEPS, SEC and VAT exactly as the owner stated, as plain text badges: no agency logo, no registration number, no other registration', () => {
    each((p) => {
      assert.ok(p.footer.includes(`<ul class="regs regs-foot" aria-label="Registrations">\n        <li>${REG_ICON}PhilGEPS-registered</li>\n        <li>${REG_ICON}SEC-registered</li>\n        <li>${REG_ICON}VAT-registered</li>\n      </ul>`), `${p.path}: the footer badges`);
      for (const ul of p.html.matchAll(/<ul class="(regs[^"]*)"[^>]*>([\s\S]*?)<\/ul>/g)) {
        assert.deepEqual([...ul[2].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => visibleText(m[1])), BADGES, `${p.path}: ${ul[1]}`);
        assert.ok(!/<(img|picture|a|use|image)\b|href=|src=|\d/.test(ul[2].replace(REG_ICON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), '').replace(/<svg[\s\S]*?<\/svg>/g, '')), `${p.path}: a badge holds more than text`);
      }
      assert.ok(!/\bPhilGEPS\b(?!-registered)/.test(p.body), `${p.path}: PhilGEPS outside the badge words`);
      assert.ok(!/\b(DTI|BIR|CIDG|PCAB|PEZA|BOI|Platinum)\b/.test(p.body) && !/\bISO ?\d{3,}/i.test(p.body));
      assert.ok(!/\b(?!PhilGEPS|SEC|VAT)[A-Za-z]+-registered\b/.test(p.body), `${p.path}: another "-registered" claim`);
      assert.ok(!/\b(TIN|PhilGEPS|SEC|VAT|DTI|BIR)\b[^|]{0,24}(?:no\.?|number|reg\.? ?no|#|id)\b\s*[:.]?\s*\d/i.test(p.body));
    });
  });
});

describe('materials and finishes (owner, 2026-10-21): SS304 food grade as standard, SS316 laboratory grade on request, in a brushed, mirror or satin finish', () => {
  const SENTENCE = 'Food-grade SS304 stainless steel as standard, and laboratory-grade SS316 on request, in a brushed, mirror or satin finish.';
  const faq = byPath('/faq/');
  const fab = byPath('/services/stainless-steel-fabrication/');
  const inst = byPath('/services/institutional-and-government-supply/');
  const fit = byPath('/services/commercial-kitchen-fit-out/');

  it('answers "What material do you use?" with both grades and all three finishes, and mirrors that answer exactly in the FAQPage JSON-LD', () => {
    const q = [...faq.html.matchAll(/<div class="faq-item">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g)].map((m) => [visibleText(m[1]), visibleText(m[2])]).find((x) => x[0] === 'What material do you use?');
    assert.ok(q, 'the material question is missing');
    assert.ok(q[1].startsWith(SENTENCE), q[1]);
    for (const w of ['SS304', 'SS316', 'food-grade', 'laboratory-grade', 'as standard', 'on request', 'brushed', 'mirror', 'satin']) assert.ok(q[1].toLowerCase().includes(w.toLowerCase()), `the answer lacks "${w}"`);
    const ld = faq.node('FAQPage')[0].mainEntity.find((x) => x.name === 'What material do you use?');
    assert.equal(ld.acceptedAnswer.text, q[1]);
    assert.ok(ld.acceptedAnswer.text.startsWith(SENTENCE));
  });

  it('shows both grades and all three finishes on the stainless-steel fabrication page: the lead, a "Two grades, three finishes" section with a card per grade and a pill per finish, and the options lead', () => {
    const t = visibleText(fab.main);
    for (const w of ['SS304', 'SS316', 'food-grade', 'laboratory-grade', 'brushed', 'mirror', 'satin', 'as standard', 'on request']) assert.ok(new RegExp(w, 'i').test(t), `the fabrication page lacks "${w}"`);
    assert.ok(t.includes('We work in two grades, food-grade SS304 as standard and laboratory-grade SS316 on request, in a brushed, mirror or satin finish.'));
    const grades = fab.html.match(/<section id="grades"[\s\S]*?<\/section>/)[0];
    assert.ok(grades.includes('<h2 id="grades-h">Two grades, three finishes</h2>'));
    assert.deepEqual([...grades.matchAll(/<article class="pg-card">[\s\S]*?<p class="pg-card-tag">([^<]+)<\/p>\s*<h3>([^<]+)<\/h3>\s*<p>([^<]+)<\/p>/g)].map((m) => [m[1], m[2]]), [['Standard', 'SS304 food grade'], ['On request', 'SS316 laboratory grade']]);
    assert.deepEqual([...grades.match(/<ul class="pg-tags"[\s\S]*?<\/ul>/)[0].matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]), ['Brushed', 'Mirror', 'Satin']);
    const opts = visibleText(fab.html.match(/<section id="options"[\s\S]*?<\/section>/)[0]);
    assert.ok(opts.includes('food-grade SS304 stainless steel as standard') && opts.includes('laboratory-grade SS316 on request') && opts.includes('brushed, mirror or satin finish'));
    assert.ok(fab.meta('description').includes('SS304') && fab.meta('description').includes('SS316'));
    assert.ok(/SS316/.test(fab.node('Service')[0].description) && /satin/.test(fab.node('Service')[0].description));
  });

  it('says on the institutional and government supply page that SS304 is the standard and SS316 laboratory grade is on request, for laboratories and school science rooms', () => {
    const t = visibleText(inst.main);
    assert.ok(t.includes('Food-grade SS304 stainless steel as standard, and laboratory-grade SS316 on request for laboratories and school science rooms, in a brushed, mirror or satin finish.'));
    assert.ok(/SS316/.test(inst.node('Service')[0].description));
  });

  it('says on the kitchen fit-out page that SS304 food grade is the standard', () => {
    assert.ok(visibleText(fit.main).includes('built to order in food-grade SS304 stainless steel as standard'));
  });

  it('never states a grade or a finish for a past project: no SS304, SS316, grade, brushed, mirror or satin anywhere under /work/', () => {
    for (const p of PAGES.filter((x) => x.path.startsWith('/work/'))) {
      const hit = firstHit(p, /\bSS3(04|16)\b|\bgrades?\b|\bbrushed\b|\bmirror\b|\bsatin\b|\bNo\.4\b/i);
      assert.equal(hit, null, `${p.path}: ${hit}`);
    }
  });

  it('no longer states "No.4 brushed finish" as the only finish: not on any page', () => {
    noHit(/\bNo\.4\b|\bonly\s+(?:a\s+)?(?:brushed|mirror|satin)\b/i, 'No.4 brushed finish stated as the only finish');
  });

  it('keeps the proof bar the same on every page that has one (hub, six services): 23 years, SS304 / SS316 (food-grade and laboratory-grade), made to order, end-to-end — and none on /work/', () => {
    const bars = PAGES.filter((p) => p.html.includes('<ul class="proof-bar"')).map((p) => ({ p: p.path, bar: p.html.match(/<ul class="proof-bar"[\s\S]*?<\/ul>/)[0] }));
    assert.equal(bars.length, 7);
    assert.equal(new Set(bars.map((b) => b.bar)).size, 1, 'the proof bars differ');
    assert.equal(visibleText(bars[0].bar), '23 years in business SS304 / SS316 High-quality, food-grade and laboratory-grade Made to order Built to your exact dimensions End-to-end Design · fabricate · deliver · install');
    assert.ok(!bars.some((b) => b.p.startsWith('/work/')));
  });
});

describe('the brand: "Barro Kitchens" is one swappable <span data-brand> per page (the header lockup) and a PERMANENT name in the meta description and the business JSON-LD (owner ruling 2026-10-22) — never in a title', () => {
  const BRAND = 'Barro Kitchens';
  const count = (s) => (s.match(/Barro\s+Kitchens/gi) || []).length;

  it('wraps the first visible mention in a bare <span data-brand> that holds exactly the name, inside the header\'s brand lockup, with the ™ after it — the swap point of a rename — and the second, in the footer\'s copyright notice, in a bare <span data-brand-legacy> (what a rename KEEPS)', () => {
    each((p) => {
      const visible = p.S.texts.filter((t) => count(t.text));
      assert.equal(visible.length, 2, `${p.path}: visible mentions`);
      const legacy = visible[1].chain[visible[1].chain.length - 1];
      assert.deepEqual(legacy.attrs, { 'data-brand-legacy': '' }, `${p.path}: the notice's mention must be a bare <span data-brand-legacy>`);
      assert.equal(visible[1].text, BRAND);
      assert.ok(visible[1].chain.some((e) => e.tag === 'p' && e.attrs.class === 'foot-legal'), `${p.path}: the second mention is not in the footer's legal line`);
      const parent = visible[0].chain[visible[0].chain.length - 1];
      assert.deepEqual(parent.attrs, { 'data-brand': '' }, `${p.path}: the wrapper must be a bare <span data-brand>`);
      assert.equal(visible[0].text, BRAND);
      assert.ok(p.header.includes('<span class="site-brand-sub"><span data-brand>Barro Kitchens</span>™</span>'), `${p.path}: the header lockup`);
      assert.equal(p.S.elements.filter((e) => e.tag === 'span' && 'data-brand' in e.attrs).length, 1);
      // the only OTHER data-brand elements are the Messenger "Message us" links: their URL carries the brand's handle (m.me/barrokitchens), so a rename must find them
      // too (owner 2026-10-22; the full list of where they sit is pinned in the "Message us" block below)
      for (const e of p.S.elements.filter((x) => x.tag !== 'span' && 'data-brand' in x.attrs)) assert.deepEqual([e.tag, e.attrs.href], ['a', MSGR], `${p.path}: a data-brand element that is not the brand span or the Messenger link`);
      // data-brand-legacy (what a rename KEEPS): on these pages only the footer's copyright notice carries it ("Barro Industries OPC (Barro Kitchens)": the rights holder's trading name stays)
      assert.equal(p.S.elements.filter((e) => 'data-brand-legacy' in e.attrs).length, 1, `${p.path}: data-brand-legacy`);
    });
  });

  it('has the brand in exactly the places the ruling allows — the meta description (description, og:description, twitter:description: once each), the business JSON-LD and the header span — and nowhere else: no title, no og:site_name, no image alt, no aria-label, no comment, no script', () => {
    each((p) => {
      for (const v of [p.title, p.meta('og:title'), p.meta('twitter:title')]) assert.ok(!count(v), `${p.path}: the brand is in a title (the 12 pages keep their own titles)`);
      for (const k of ['description', 'og:description', 'twitter:description']) assert.equal(count(p.meta(k)), 1, `${p.path}: ${k} names the brand ${count(p.meta(k))} times`);
      for (const k of ['og:site_name', 'og:image:alt', 'twitter:image:alt']) assert.ok(!count(p.meta(k)), `${p.path}: ${k}`);
      // the only attributes that carry it are those three descriptions (every other attribute, alt and aria-label included, is free of it)
      assert.deepEqual(p.S.attrs.filter((a) => count(a.value)).map((a) => `${a.tag}[${a.name}]`), ['meta[content]', 'meta[content]', 'meta[content]'], `${p.path}: an attribute names the brand`);
      assert.equal(p.S.comments.filter((c) => count(c.text)).length, 0);
      assert.equal(p.S.scripts.filter((s) => s.attrs.type !== 'application/ld+json' && count(s.body)).length, 0);
      assert.ok(p.html.includes('alt="Barro Industries logo"'));
    });
  });

  it('keeps the whole inventory to 9 per page (1 visible span + 1 in the footer notice + 3 in the meta description + 4 in the JSON-LD) = 108 in all, so a rename is a find-and-replace of a known list; the hyphenated names are file paths and the Facebook and Messenger addresses only', () => {
    let total = 0;
    each((p) => {
      assert.equal(count(p.html), 9, `${p.path}: brand occurrences`);
      total += count(p.html);
      assert.equal(count(p.head), 7, `${p.path}: in the head: 3 descriptions + 4 in the JSON-LD`);
      const slugs = [...p.html.matchAll(/[A-Za-z0-9/._:-]*barro-?kitchens[A-Za-z0-9/._-]*/gi)].map((m) => m[0]).sort();
      assert.deepEqual(slugs.filter((s) => !/^https:\/\/(www\.facebook\.com|m\.me)\/barrokitchens$/.test(s)), ['/site/img/barro-kitchens-96.webp', 'https://barroindustries.com/icons/barro-kitchens.png'].sort(), `${p.path}: the hyphenated brand names`);
    });
    assert.equal(total, 108);
  });

  it('carries the same permanent alternate names on every page as on the homepage — ["Barro Kitchens", "Barro Kitchens by Barro Industries"] — and the homepage says in a comment that they STAY when the brand is renamed', () => {
    const homeLd = JSON.parse(home.match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"LocalBusiness"[\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(homeLd.alternateName, ALT_NAMES);
    each((p) => assert.deepEqual(p.node('LocalBusiness')[0].alternateName, homeLd.alternateName, `${p.path}: alternateName differs from the homepage`));
    const note = home.match(/<!-- PERMANENT \(owner ruling, 2026-10-22\)[\s\S]*?-->/);
    assert.ok(note, 'the PERMANENT comment is gone from the homepage head');
    assert.ok(/formerly Barro Kitchens/.test(note[0]) && /STAYS/.test(note[0]) && /ADDED/.test(note[0]) && /data-brand-legacy/.test(note[0]) && /alternateName/.test(note[0]));
  });

  it('is CSS-neutral and script-neutral: no stylesheet or script selects or reads [data-brand] or [data-brand-legacy]', () => {
    assert.ok(!/data-brand/.test(pagesCss));
    for (const f of ['css/site.css', 'js/site.js']) assert.ok(!/data-brand/.test(read(f)), `${f} touches data-brand`);
  });

  it('puts the primary name, "Barro Industries", first everywhere: og:site_name, the JSON-LD name, the footer name, the title ending', () => {
    each((p) => {
      assert.equal(p.meta('og:site_name'), 'Barro Industries');
      assert.ok(p.footer.includes('<p class="foot-name">Barro Industries OPC</p>'));
      assert.ok(p.header.includes('<span class="site-brand-name">Barro Industries</span>'));
      assert.ok(p.footer.includes('© <span id="site-year">2026</span> Barro Industries OPC (<span data-brand-legacy>Barro Kitchens</span>). All photos, designs and content on this site are our own work and may not be copied or reused without written permission.</p>'));
    });
  });
});

describe('header and footer: the same on every page, "Get a quote" top right and no Login, the site\'s sections in the footer', () => {
  const norm = (s) => s.replace(/ aria-current="[^"]*"/g, '');

  it('has one header and one footer for all 12 pages (aria-current aside)', () => {
    const h = new Set(PAGES.map((p) => norm(p.header))), f = new Set(PAGES.map((p) => norm(p.footer)));
    assert.equal(h.size, 1, 'the headers differ');
    assert.equal(f.size, 1, 'the footers differ');
  });

  it('has the brand link home, the seven nav links, "Get a quote" to the intake as the button at the top right, then the menu button — and no Login anywhere in the header', () => {
    each((p) => {
      assert.ok(p.header.includes('<a href="/" id="site-brand">'));
      assert.deepEqual([...p.header.matchAll(/<nav id="site-nav" aria-label="Main">([\s\S]*?)<\/nav>/g)][0][1].match(/<a [^>]*>[^<]*<\/a>/g).map((a) => a.replace(/ aria-current="[^"]*"/, '')), [
        '<a href="/services/">Services</a>', '<a href="/products/">Products</a>', '<a href="/work/">Our work</a>', '<a href="/areas-we-serve/">Areas we serve</a>', '<a href="/catalogue/">Catalogue</a>', '<a href="/faq/">FAQ</a>', '<a href="/#contact">Contact</a>']);
      assert.ok(p.header.includes('<a class="site-btn site-btn-primary site-btn-sm site-head-cta" href="/catalogue/?quote=1">Get a quote</a>'));
      assert.ok(p.header.indexOf('id="site-nav"') < p.header.indexOf('site-head-cta') && p.header.indexOf('site-head-cta') < p.header.indexOf('id="site-menu-btn"'));
      assert.ok(p.header.includes('<button type="button" id="site-menu-btn" aria-expanded="false" aria-controls="site-nav" aria-label="Menu">'));
      assert.ok(!/login/i.test(p.header));
    });
  });

  it('marks the section the visitor is in (aria-current="page" on a hub, "true" on a child)', () => {
    const cur = (p) => [...p.header.matchAll(/<a href="([^"]+)" aria-current="([^"]+)">/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(cur(byPath('/services/')), [['/services/', 'page']]);
    assert.deepEqual(cur(byPath('/services/kitchen-fire-suppression/')), [['/services/', 'true']]);
    assert.deepEqual(cur(byPath('/work/')), [['/work/', 'page']]);
    assert.deepEqual(cur(byPath('/work/ispsc-2026/')), [['/work/', 'true']]);
    assert.deepEqual(cur(byPath('/areas-we-serve/')), [['/areas-we-serve/', 'page']]);
    assert.deepEqual(cur(byPath('/faq/')), [['/faq/', 'page']]);
  });

  it('has the footer links to Home, the hubs, the FAQ, the catalogue, Facebook, "Message us" (Messenger), "Get a quote" and the discreet "Team portal"', () => {
    const f = byPath('/faq/').footer;
    assert.ok(f.includes(`<p class="foot-links"><a href="/">Home</a><a href="/services/">Services</a><a href="/products/">Products</a><a href="/work/">Our work</a><a href="/areas-we-serve/">Areas we serve</a><a href="/faq/">FAQ</a><a href="/guides/">Guides</a><a href="/catalogue/">Catalogue</a><a href="https://www.facebook.com/barrokitchens" rel="noopener" target="_blank">Facebook</a>${msgLink('', 'Message us')}<a href="/catalogue/?quote=1">Get a quote</a><a class="foot-portal" href="/#login">Team portal</a></p>`));
  });
});

describe('the owner\'s answers of 2026-10-21: Barro supplied the ISPSC hoods and ranges too, and DMMMSU is in La Union', () => {
  const ISPSC_SCOPE = 'Stainless-steel laboratory and kitchen work tables, sinks, gas ranges and exhaust hoods, fabricated and installed in a school room (March 2026).';
  const DMMMSU_SCOPE = 'Stainless-steel equipment delivered and installed on campus in La Union (March 2023 – December 2025).';
  const projectText = (id) => visibleText(home.match(new RegExp(`<article class="proj[^"]*" id="${id}">[\\s\\S]*?</article>`))[0].match(/<div class="proj-head">[\s\S]*?<p>([\s\S]*?)<\/p>\s*<\/div>/)[1]);

  it('describes the ISPSC scope as work tables, sinks, gas ranges and exhaust hoods — the owner\'s wording, in one sentence, on the homepage and on every page that shows the project — and states no material grade', () => {
    assert.equal(projectText('proj-ispsc-2026'), ISPSC_SCOPE);
    for (const slug of ['/work/', '/work/ispsc-2026/', '/work/dmmmsu-2022-2023/', '/services/', '/services/institutional-and-government-supply/']) assert.ok(byPath(slug).body.includes(ISPSC_SCOPE), `${slug}: the ISPSC description`);
    assert.ok(!/SS\s?3\d\d|grade/i.test(ISPSC_SCOPE));
    const stale = /laboratory and kitchen work tables and sinks|work tables and sinks, fabricated and installed in a school room/;
    each((p) => assert.ok(!stale.test(p.body) && !stale.test(p.head), `${p.path}: the old ISPSC description`));
  });

  it('carries the fuller ISPSC scope through the project page: title, description, facts, photo paragraph and caption; and the supply page names it as a bullet', () => {
    const p = byPath('/work/ispsc-2026/');
    assert.ok(/Kitchen and Laboratory Equipment/.test(p.title) && !/Work Tables/.test(p.title));
    for (const key of ['description', 'og:description', 'twitter:description']) assert.ok(/work tables, sinks, gas ranges and exhaust hoods/.test(p.meta(key)), key);
    assert.ok(p.html.includes('<div><dt>Work</dt><dd>Stainless-steel laboratory and kitchen work tables, sinks, gas ranges and exhaust hoods</dd></div>'));
    assert.ok(/cooking stations with gas ranges, sinks and overhead exhaust hoods/.test(p.body));
    assert.ok(p.html.includes('<figcaption>A wide view of the cooking stations with gas ranges, sinks and overhead exhaust hoods.</figcaption>'));
    assert.equal(p.node('CreativeWork')[0].description, ISPSC_SCOPE);
    const inst = byPath('/services/institutional-and-government-supply/');
    assert.ok(inst.html.includes('<h3>Tables, sinks, ranges and hoods</h3>') && inst.html.includes('<p>Stainless-steel laboratory and kitchen work tables, sinks, gas ranges and exhaust hoods, fabricated and installed in a school room.</p>'));
  });

  it('says on the exhaust and LPG pages that the ISPSC hoods and ranges were supplied and installed — the photo captions claim nothing beyond the hoods and the range', () => {
    const exhaust = byPath('/services/exhaust-and-fresh-air-systems/'), lpg = byPath('/services/lpg-gas-line-installation/');
    assert.ok(exhaust.html.includes('<figcaption>Cooking stations with gas ranges, sinks and overhead exhaust hoods, supplied and installed at ISPSC (March 2026). <a href="/work/ispsc-2026/">View the project</a>.</figcaption>'));
    assert.ok(lpg.html.includes('<figcaption>A gas range with an overhead shelf, supplied and installed at ISPSC (March 2026). <a href="/work/ispsc-2026/">View the project</a>.</figcaption>'));
    for (const p of [exhaust, lpg]) assert.ok(!/ISPSC[^.]{0,80}\b(gas line|ducting|fan|ventilation|fresh-air|fresh air|suppression)/i.test(visibleText(p.html.match(/<figcaption>[\s\S]*?<\/figcaption>/)[0])), `${p.path}: the caption claims more than the hoods and the range`);
  });

  it('says DMMMSU is in La Union: in the description on the homepage and on every page that shows the project, and on the project page in its title, descriptions, lead and facts (the h1 keeps the university\'s name)', () => {
    assert.equal(projectText('proj-dmmmsu-2022-2023'), DMMMSU_SCOPE);
    for (const slug of ['/work/', '/work/dmmmsu-2022-2023/', '/work/ispsc-2026/', '/services/', '/services/institutional-and-government-supply/']) assert.ok(byPath(slug).body.includes(DMMMSU_SCOPE), `${slug}: the DMMMSU description`);
    const p = byPath('/work/dmmmsu-2022-2023/');
    assert.ok(/La Union/.test(p.title) && p.title === 'DMMMSU Stainless-Steel Equipment, La Union | Barro Industries');
    for (const key of ['description', 'og:description', 'twitter:description']) assert.ok(/\(DMMMSU\) in La Union, March 2023 to December 2025\.$/.test(p.meta(key)), key);
    assert.ok(p.html.includes('<div><dt>Location</dt><dd>La Union</dd></div>'));
    assert.equal(visibleText(p.html.match(/<h1>([\s\S]*?)<\/h1>/)[1]), 'Don Mariano Marcos Memorial State University (DMMMSU)');
    assert.equal(p.node('CreativeWork')[0].description, DMMMSU_SCOPE);
    assert.ok(/La Union/.test(byPath('/work/').meta('description')) && /in La Union\.$/.test(visibleText(byPath('/work/').html.match(/<p class="site-lead">([\s\S]*?)<\/p>/)[1].replace(/Barro Industries has been in business[^<]*/, ''))));
  });

  it('ties DMMMSU to La Union on the areas page (a link to the project in the North Luzon paragraph), where La Union is already listed', () => {
    const areas = byPath('/areas-we-serve/');
    assert.ok(areas.html.includes('In La Union, we delivered and installed stainless-steel equipment on the campus of <a href="/work/dmmmsu-2022-2023/">Don Mariano Marcos Memorial State University (DMMMSU)</a>.'));
  });

  it('keeps La Union out of every header, footer, call to action, address, phone line and the business JSON-LD address (and never San Fernando, a street or a barangay in La Union)', () => {
    each((p) => {
      assert.ok(!/La\s*Union|San\s*Fernando/i.test(p.header + p.footer), `${p.path}: La Union in the header or footer`);
      const cta = (p.html.match(/<section class="pg-cta"[\s\S]*?<\/section>/) || [''])[0];
      assert.ok(!/La\s*Union/i.test(cta), `${p.path}: La Union in the call to action`);
      assert.ok(!/La\s*Union/i.test(JSON.stringify(p.node('LocalBusiness')[0].address)), `${p.path}: La Union in the JSON-LD address`);
    });
    assert.ok(!/San\s*Fernando|purok|carlatan/i.test(PAGES.map((p) => p.html).join('\n')));
  });
});

describe('the homepage and the catalogue are wired to the 12 pages (the pages link back through their own header, footer and breadcrumbs)', () => {
  const homeHtml = home;
  const nav = (html) => html.match(/<nav id="site-nav"[\s\S]*?<\/nav>/)[0];
  const footLinks = (html) => html.match(/<p class="foot-links">[\s\S]*?<\/p>/)[0];
  const hrefsIn = (html) => [...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((m) => m[1]);
  const NAV = [['/services/', 'Services'], ['/products/', 'Products'], ['/work/', 'Our work'], ['/areas-we-serve/', 'Areas we serve'], ['/catalogue/', 'Catalogue'], ['/faq/', 'FAQ']];

  it('has the same seven header links on the homepage, the catalogue and the 12 pages: Services, Products, Our work, Areas we serve, Catalogue, FAQ, Contact (an in-page anchor on the homepage, /#contact elsewhere), and "Get a quote" before the menu button', () => {
    const labels = (html) => [...nav(html).matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(labels(homeHtml), [...NAV, ['#contact', 'Contact']].map((x) => x));
    assert.deepEqual(labels(catalogue), [...NAV, ['/#contact', 'Contact']]);
    for (const p of PAGES) assert.deepEqual(labels(p.html), [...NAV, ['/#contact', 'Contact']], p.path);
    for (const html of [homeHtml, catalogue, ...PAGES.map((p) => p.html)]) {
      const header = html.match(/<header id="site-header">[\s\S]*?<\/header>/)[0];
      assert.ok(header.indexOf('id="site-nav"') < header.indexOf('site-head-cta') && header.indexOf('site-head-cta') < header.indexOf('id="site-menu-btn"'));
      assert.ok(header.includes('href="/catalogue/?quote=1"'));
    }
  });

  it('has one footer link row on the catalogue and the 12 pages (Home, Services, Products, Our work, Areas we serve, FAQ, Catalogue, Facebook, Message us, Get a quote, Team portal) and the homepage\'s without Home — "Team portal" last everywhere', () => {
    // the Message us link carries an inline icon: take the <svg> out so the row reads as its words
    const rows = (html) => [...footLinks(html).replace(/<svg[\s\S]*?<\/svg>/g, '').matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    const FULL = [['/', 'Home'], ['/services/', 'Services'], ['/products/', 'Products'], ['/work/', 'Our work'], ['/areas-we-serve/', 'Areas we serve'], ['/faq/', 'FAQ'], ['/guides/', 'Guides'], ['/catalogue/', 'Catalogue'], [FB, 'Facebook'], [MSGR, 'Message us'], ['/catalogue/?quote=1', 'Get a quote'], ['/#login', 'Team portal']];
    assert.deepEqual(rows(catalogue), FULL);
    assert.deepEqual(rows(homeHtml), FULL.slice(1));
    for (const p of PAGES) assert.deepEqual(rows(p.html), FULL, p.path);
    for (const html of [homeHtml, catalogue, ...PAGES.map((p) => p.html)]) assert.ok(footLinks(html).endsWith('Team portal</a></p>'));
  });

  it('links from the homepage body to the hubs and to every service and project page (visible copy unchanged: the links sit beside the existing sentences)', () => {
    const site = homeHtml.slice(homeHtml.indexOf('<div id="site"'), homeHtml.indexOf('<!-- /#site -->'));
    const h = new Set(hrefsIn(site));
    for (const u of ['/services/', '/work/', '/areas-we-serve/', '/faq/', ...SERVICE_SLUGS.map((x) => `/services/${x}/`), ...WORK_SLUGS.map((x) => `/work/${x}/`)]) assert.ok(h.has(u), `the homepage does not link to ${u}`);
    assert.ok(site.includes('<p class="svc-also">Also: <a href="/services/exhaust-and-fresh-air-systems/">exhaust and fresh-air systems</a>, <a href="/services/lpg-gas-line-installation/">LPG gas line installation</a> and <a href="/services/kitchen-fire-suppression/">kitchen fire suppression</a>.</p>'));
    assert.ok(site.includes('<p class="sec-link"><a class="link-arrow" href="/areas-we-serve/">Areas we serve</a></p>'));
    assert.ok(site.includes('<li><span class="contact-label">Questions</span><a href="/faq/">Read the FAQ</a></li>'));
  });

  it('links from the catalogue call to action to the services and the FAQ', () => {
    assert.ok(catalogue.includes('<p class="link-row"><a class="link-arrow" href="/services/">Our services</a><a class="link-arrow" href="/faq/">Frequently asked questions</a></p>'));
  });

  it('is one business entity: the homepage LocalBusiness has the @id the pages\' Service.provider points at, and every field the pages repeat equals the homepage\'s', () => {
    const homeLd = JSON.parse(home.match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"LocalBusiness"[\s\S]*?)<\/script>/)[1]);
    assert.equal(homeLd['@id'], BASE + '/#business');
    for (const p of PAGES) {
      const mine = p.node('LocalBusiness')[0];
      for (const [k, v] of Object.entries(mine)) assert.deepEqual(homeLd[k], v, `${p.path}: LocalBusiness.${k} differs from the homepage`);
    }
    assert.equal(homeLd.brand.name, 'Barro Kitchens');
  });

  it('keeps the quote flow working from the pages: the homepage and the catalogue still open the intake with data-qr-start, these pages link to /catalogue/?quote=1 (which the catalogue script opens)', () => {
    assert.ok(/data-qr-start/.test(homeHtml) && /data-qr-start/.test(catalogue));
    assert.ok(read('js/catalogue.js').includes('quote') || read('js/quote-request.js').includes('quote'), 'no script reads ?quote=1');
  });
});

describe('links: every internal link resolves, the hubs list every child, every page leads home, to the catalogue and into the quote flow', () => {
  const hrefs = (p) => p.S.attrs.filter((a) => a.name === 'href' && a.tag === 'a').map((a) => a.value);
  const target = (u) => {
    const [pathPart, hash] = u.split('#');
    const clean = pathPart.split('?')[0];
    const file = clean.endsWith('/') ? clean.slice(1) + 'index.html' : clean.slice(1);
    return { file, hash };
  };

  it('resolves every root-relative link to a file that exists, and every #fragment on /catalogue/ and / to an id that exists', () => {
    const catIds = new Set([...catalogue.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const homeIds = new Set([...home.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    each((p) => {
      for (const u of hrefs(p)) {
        if (u.startsWith('#') || /^(https?:|tel:|mailto:)/.test(u)) continue;
        assert.ok(u.startsWith('/'), `${p.path}: a relative link ${u}`);
        const { file, hash } = target(u);
        assert.ok(exists(file), `${p.path}: ${u} -> ${file} does not exist`);
        if (hash && file === 'catalogue/index.html') assert.ok(catIds.has(hash), `${p.path}: ${u} has no target in the catalogue`);
        if (hash && file === 'index.html' && hash !== 'login') assert.ok(homeIds.has(hash), `${p.path}: ${u} has no target on the homepage`);
      }
    });
  });

  it('links only to the site, the verified Google Maps place, the Facebook page, the Messenger chat, one phone number and one email — external links open with rel="noopener"', () => {
    each((p) => {
      for (const a of p.S.elements.filter((e) => e.tag === 'a' && /^https?:/.test(e.attrs.href || ''))) {
        assert.ok([FB, MSGR, PLACE_URL].includes(a.attrs.href), `${p.path}: an external link ${a.attrs.href}`);
        assert.equal(a.attrs.rel, 'noopener');
        assert.equal(a.attrs.target, '_blank');
      }
      for (const u of hrefs(p).filter((x) => /^(tel:|mailto:)/.test(x))) assert.ok(['tel:+639276836300', 'mailto:hello@barroindustries.com'].includes(u), `${p.path}: ${u}`);
      for (const u of hrefs(p)) assert.ok(!/^\/(projects|q|t|v|partners|parterns|ventures|track\.html|quote-builder|docs|specs|private)/.test(u), `${p.path}: links to ${u}`);
      assert.ok(hrefs(p).filter((u) => u.startsWith('/sales/')).every((u) => u === '/sales/clientinformationrequest/'));
    });
  });

  it('leads home, to the catalogue and into the quote flow from every page', () => {
    each((p) => {
      const h = hrefs(p);
      assert.ok(h.includes('/') && h.includes('/catalogue/'), `${p.path}: home / catalogue`);
      assert.ok(h.filter((u) => u === '/catalogue/?quote=1').length >= 3, `${p.path}: quote links ${h.filter((u) => u === '/catalogue/?quote=1').length}`);
      assert.ok(h.includes('tel:+639276836300') && h.includes('mailto:hello@barroindustries.com'));
      assert.ok(h.includes('/sales/clientinformationrequest/'));
      assert.ok(!/data-qr-start/.test(p.html), 'the quote-request script is not on these pages');
    });
  });

  it('has the services hub link to all six services and the work hub to both projects', () => {
    for (const s of SERVICE_SLUGS) assert.ok(hrefs(byPath('/services/')).filter((u) => u === `/services/${s}/`).length >= 1, `/services/ does not link to ${s}`);
    for (const w of WORK_SLUGS) assert.ok(hrefs(byPath('/work/')).filter((u) => u === `/work/${w}/`).length >= 1, `/work/ does not link to ${w}`);
  });

  it('links every child back to its hub and across to two or three related pages', () => {
    for (const p of PAGES.filter((x) => x.kind === 'service')) {
      const h = hrefs(p);
      assert.ok(h.includes('/services/'), `${p.path}: no link to the hub`);
      const others = [...new Set(h.filter((u) => /^\/services\/[a-z-]+\/$/.test(u) && u !== p.path))];
      assert.ok(others.length >= 3 && others.length <= 7, `${p.path}: related service links ${others.length}`);
      assert.ok(h.some((u) => /^\/work\/(ispsc|dmmmsu)/.test(u)), `${p.path}: no link to a project`);
      assert.ok(h.some((u) => /^\/catalogue\/#cat-/.test(u)), `${p.path}: no link to a catalogue category`);
    }
    for (const p of PAGES.filter((x) => x.kind === 'work')) {
      const h = hrefs(p);
      assert.ok(h.includes('/work/'));
      assert.ok(h.filter((u) => /^\/services\/[a-z-]+\/$/.test(u)).length >= 3);
      assert.ok(h.filter((u) => /^\/work\/[a-z0-9-]+\/$/.test(u) && u !== p.path).length === 1, `${p.path}: link to the other project`);
      assert.ok(h.includes('/areas-we-serve/'));
    }
    assert.ok(hrefs(byPath('/areas-we-serve/')).includes('/work/') && hrefs(byPath('/areas-we-serve/')).includes('/services/') && hrefs(byPath('/areas-we-serve/')).includes('/faq/'));
    assert.ok(hrefs(byPath('/faq/')).includes('/services/') && hrefs(byPath('/faq/')).includes('/areas-we-serve/') && hrefs(byPath('/faq/')).includes('/work/'));
  });

  it('points the category links only at categories the catalogue has (preparation, washing, cooking, ventilation, storage, refrigeration)', () => {
    const ok = new Set(['cat-preparation', 'cat-washing', 'cat-cooking', 'cat-ventilation', 'cat-storage', 'cat-refrigeration']);
    each((p) => { for (const u of hrefs(p).filter((x) => x.startsWith('/catalogue/#'))) assert.ok(ok.has(u.split('#')[1]), `${p.path}: ${u}`); });
  });
});

describe('scripts and styles: only the shared /js/site.js, no inline script or style, nothing in the service worker\'s PRECACHE', () => {
  it('has one data block of JSON-LD and one deferred /js/site.js — no app script, no third-party script, no inline script, style or handler', () => {
    each((p) => {
      assert.deepEqual(p.S.scripts.map((s) => (s.attrs.src ? `src:${s.attrs.src}${'defer' in s.attrs ? ' defer' : ''}` : `type:${s.attrs.type}`)), ['type:application/ld+json', 'src:/js/site.js defer']);
      assert.ok(!/<style\b/i.test(p.html) && !/\sstyle=/i.test(p.html) && !/\son[a-z]+=/i.test(p.html), `${p.path}: inline style or handler`);
      assert.ok(!/<noscript|<form|<input|<button(?![^>]*id="site-(menu-btn|lightbox-close)")/i.test(p.html));
      for (const s of p.S.scripts.filter((x) => x.attrs.src)) assert.ok(!/app\.js|config\.js|firebase|gstatic|lucide|chart\.js|unpkg|jsdelivr|quote-request|catalogue\.js|analytics|gtag|fbevents|pixel|https?:/i.test(s.attrs.src), `${p.path}: ${s.attrs.src}`);
      assert.ok(!/<link[^>]*rel="(?:preload|modulepreload|prefetch)"/i.test(p.html));
    });
    assert.ok(exists('js/site.js'));
  });

  it('is wired to the hooks js/site.js binds: the phone menu, the project lightbox (#projects + the dialog) and the Luzon map highlight (#luzon)', () => {
    for (const id of ['site-menu-btn', 'site-nav', 'site-header']) assert.ok(siteJs.includes(`'${id}'`), `site.js no longer looks up ${id}`);
    assert.ok(siteJs.includes("$('projects')") && siteJs.includes("'site-lightbox'") && siteJs.includes("'site-lightbox-img'") && siteJs.includes("'site-lightbox-close'") && siteJs.includes("a[data-lightbox]"));
    assert.ok(siteJs.includes("$('luzon')") && siteJs.includes('[data-pin="'));
    each((p) => {
      if (/data-lightbox/.test(p.html)) {
        assert.ok(p.html.includes('<dialog id="site-lightbox" aria-label="Project photo"><button type="button" id="site-lightbox-close" aria-label="Close photo">×</button><img id="site-lightbox-img" alt=""></dialog>'), `${p.path}: lightbox`);
        const proj = p.S.elements.find((e) => e.attrs.id === 'projects');
        assert.ok(proj, `${p.path}: no #projects`);
        for (const a of p.S.elements.filter((e) => 'data-lightbox' in e.attrs)) assert.ok(a.chain.includes(proj) || inId(a.chain, 'projects'), `${p.path}: a lightbox link outside #projects`);
      } else assert.ok(!p.html.includes('site-lightbox'));
    });
    const areas = byPath('/areas-we-serve/');
    const lz = areas.S.elements.find((e) => e.attrs.id === 'luzon');
    assert.ok(lz && areas.S.elements.filter((e) => e.attrs['data-pin'] && !inId(e.chain, 'luzon')).length === 0, 'every data-pin element must sit inside #luzon');
  });

  it('is not precached: no page, hub folder, stylesheet or social image in sw.js PRECACHE or in the precache manifest', () => {
    const sw = read('sw.js');
    for (const frag of ["'/services", "'/work", "'/areas-we-serve", "'/faq", "'/css/pages.css'", "'/site/img/pages/"]) assert.ok(!sw.includes(frag), `sw.js lists ${frag}`);
    assert.ok(!sw.includes("'/site/img/"));
    const mf = read('precache-manifest.json');
    assert.ok(!/"\/(services|work|areas-we-serve|faq)\b|pages\.css|site\/img\/pages/.test(mf), 'the precache manifest lists a content page');
    assert.ok(!/services\/|work\/|areas-we-serve\/|faq\//.test(sw.slice(sw.indexOf('const PRECACHE'), sw.indexOf('];', sw.indexOf('const PRECACHE')))));
  });

  it('has a stylesheet scoped to #site, with no 4-digit z-index, no @import, no !important, no fixed width that could overflow a 320px phone, and a rule for the narrowest header', () => {
    const css = pagesCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [];
    css.replace(/(^|[}{])\s*([^{}@\s][^{}]*)\{/g, (_, __, sel) => { selectors.push(...sel.split(',').map((x) => x.trim())); return ''; });
    assert.ok(selectors.length > 150, `only ${selectors.length} selectors were read`);
    for (const s of selectors) assert.ok(/^(#site|html$|body$)/.test(s), `an unscoped selector: ${s}`);
    assert.ok(!/z-index:\s*\d{4}/.test(css) && !/@import/.test(css) && !/!important/.test(css));
    for (const m of css.matchAll(/(?<![a-z-])width:\s*(\d+)px/g)) assert.ok(+m[1] <= 320, `a fixed width of ${m[1]}px`);
    // the header is css/site.css's (one design for every public page): its rule for the narrowest phone, and the 900-1099px squeeze that keeps six links, the button and the whole wordmark on one row
    const site = read('css/site.css').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(site, /@media \(max-width:359px\)\{[^@]*#site \.site-brand-name\{[^}]*white-space:normal/);
    assert.match(site, /@media \(min-width:900px\) and \(max-width:1099px\)\{\s*#site #site-nav\{gap:14px;margin-right:4px\}\s*#site #site-nav a\{font-size:14px\}\s*#site \.site-brand-name\{font-size:20px\}\s*\}/);
    // the footer: its eleven links wrap inside the right half from 900px at every width (so the address and the badges keep their room): there is no one-row layout any more
    assert.match(site, /@media \(min-width:900px\)\{[^@]*#site \.foot-in\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.1fr\);[^}]*\}\s*#site \.foot-links\{justify-content:flex-end\}/);
    assert.ok(!/@media \(min-width:1100px\)\{\s*#site \.foot-in\{/.test(site), 'the footer has a one-row layout again: eleven links no longer fit beside the address');
    assert.ok(!/site-brand-name|site-head-cta|#site-menu-btn|foot-portal|foot-links|foot-in/.test(css.replace(/#site #site-nav a\[aria-current\]/, '')), 'pages.css redraws the header or the footer that css/site.css owns');
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  });
});

describe('the homepage\'s own words, kept: the projects, the process, the warranty, the Luzon map', () => {
  const homeProject = (id) => {
    const art = home.match(new RegExp(`<article class="proj[^"]*" id="${id}">[\\s\\S]*?</article>`))[0];
    return {
      tag: visibleText(art.match(/<p class="proj-tag">([\s\S]*?)<\/p>/)[1]),
      name: visibleText(art.match(/<h3>([\s\S]*?)<\/h3>/)[1]),
      desc: visibleText(art.match(/<div class="proj-head">[\s\S]*?<p>([\s\S]*?)<\/p>\s*<\/div>/)[1]),
      photos: [...art.matchAll(/<li[^>]*><a href="(site\/img\/projects\/[^"]+)"[^>]*><img[^>]*?alt="([^"]*)"/g)].map((m) => ['/' + m[1], decode(m[2])]),
    };
  };

  for (const [slug, id] of [['/work/ispsc-2026/', 'proj-ispsc-2026'], ['/work/dmmmsu-2022-2023/', 'proj-dmmmsu-2022-2023']]) {
    it(`${slug} says what the homepage says about the project — the tag, the name, the description with its dates — and shows the same photos with the same alt text, in the same order`, () => {
      const hp = homeProject(id), p = byPath(slug);
      assert.ok(hp.desc.includes('(March') && hp.photos.length >= 6);
      assert.equal(visibleText(p.html.match(/<p class="eyebrow">([\s\S]*?)<\/p>/)[1]), hp.tag);
      assert.equal(visibleText(p.html.match(/<h1>([\s\S]*?)<\/h1>/)[1]).replace(/ \(([A-Z]+)\)$/, ''), hp.name);
      assert.equal(visibleText(p.html.match(/<h1>[\s\S]*?<\/h1>\s*<p class="site-lead">([\s\S]*?)<\/p>/)[1]), hp.desc);
      assert.ok(p.body.includes(hp.desc));
      const gallery = [...p.html.matchAll(/<li[^>]*><a href="(\/site\/img\/projects\/[^"]+)" data-lightbox><img[^>]*?alt="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]);
      assert.deepEqual(gallery, hp.photos, `${slug}: the gallery differs from the homepage's`);
      assert.ok(p.html.includes('<ul class="proj-gallery">') && !p.html.includes('class="pg-gallery"'));
    });
  }

  it('shows both projects on the two hubs and the supply page with the homepage\'s descriptions, dates and tags, and the owner\'s "Trusted by" line word for word', () => {
    const a = homeProject('proj-ispsc-2026'), b = homeProject('proj-dmmmsu-2022-2023');
    for (const slug of ['/work/', '/services/', '/services/institutional-and-government-supply/']) {
      const p = byPath(slug);
      for (const x of [a, b]) assert.ok(p.body.includes(x.desc) && p.body.includes(x.name) && p.body.includes(x.tag), `${slug}: ${x.tag}`);
    }
    const trust = visibleText(home.match(/<p class="trust[^"]*">[\s\S]*?<\/p>/)[0]);
    for (const slug of ['/work/', '/services/institutional-and-government-supply/']) assert.ok(byPath(slug).body.includes(trust), `${slug}: the "Trusted by" line`);
  });

  it('uses the six "How we work" steps and the two warranty cards of the homepage, word for word, and nothing else in those sections', () => {
    const steps = [...home.matchAll(/<li class="step">[\s\S]*?<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => [visibleText(m[1]), visibleText(m[2])]);
    assert.equal(steps.length, 6);
    assert.equal(steps[2][1], STEP3_NEW, 'the homepage\'s step 3 is the owner\'s two-grades, three-finishes wording');
    const cards = [...home.matchAll(/<article class="wcard[^"]*">([\s\S]*?)<\/article>/g)].map((m) => visibleText(m[1]));
    assert.equal(cards.length, 2);
    for (const p of PAGES.filter((x) => x.html.includes('id="process"'))) {
      const section = p.html.match(/<section id="process"[\s\S]*?<\/section>/)[0];
      const mine = [...section.matchAll(/<li class="step">[\s\S]*?<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => [visibleText(m[1]), visibleText(m[2])]);
      assert.deepEqual(mine, steps, `${p.path}: steps`);
      assert.equal(mine[2][1], STEP3_NEW, `${p.path}: step 3 (two grades, three finishes)`);
      const t = visibleText(section);
      assert.ok(!/\b(\d+|one|two|three|four|five|six|seven|ten|few|several)[ -]?(minutes?|hours?|days?|weeks?|months?|years?|working)\b/i.test(t), `${p.path}: a duration in the steps`);
      assert.ok(!/\b(within|same[- ]day|next[- ]day|overnight|turnaround|lead time)\b/i.test(t));
    }
    for (const p of PAGES.filter((x) => x.html.includes('id="warranty"'))) {
      const section = p.html.match(/<section id="warranty"[\s\S]*?<\/section>/)[0];
      assert.deepEqual([...section.matchAll(/<article class="wcard">([\s\S]*?)<\/article>/g)].map((m) => visibleText(m[1])), cards, `${p.path}: warranty cards`);
      const t = visibleText(section);
      assert.deepEqual([...new Set(t.match(/\d+/g))].sort(), ['12', '6']);
      assert.ok(!/\b(lifetime|guarantee[ds]?|parts|labou?r|free|unlimited|replacement|on[- ]site|24\/7|hours?|days?|years?|extended|full coverage)\b/i.test(t), `${p.path}: a warranty term the owner did not give`);
    }
    assert.deepEqual(PAGES.filter((x) => x.html.includes('id="warranty"')).map((x) => x.path), ['/services/', ...SERVICE_SLUGS.map((x) => `/services/${x}/`)]);
    assert.deepEqual(PAGES.filter((x) => x.html.includes('id="process"')).map((x) => x.path), ['/services/', ...SERVICE_SLUGS.map((x) => `/services/${x}/`)]);
  });

  it('copies the Luzon map and the 13 places from the homepage byte for byte (same projection, same pins, same labels) and groups them North / Central / Metro Manila & South', () => {
    const svg = (h) => h.match(/<svg class="lz-svg"[\s\S]*?<\/svg>/)[0];
    const areas = byPath('/areas-we-serve/');
    assert.equal(svg(areas.html), svg(home), 'the map differs from the homepage\'s');
    const groups = [...areas.html.matchAll(/<div class="luzon-group">\s*<h3>([^<]+)<\/h3>\s*<ul>([\s\S]*?)<\/ul>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g)];
    assert.equal(groups.length, 3);
    groups.forEach((g, i) => {
      assert.equal(decode(g[1]), GROUPS[i][0]);
      assert.deepEqual([...g[2].matchAll(/<li data-pin="([^"]+)">([^<]+)<\/li>/g)].map((m) => m[1]), GROUPS[i][1]);
      assert.ok(visibleText(g[3]).length > 60 && /^We have completed projects|^Our Central Luzon projects/.test(visibleText(g[3])), `the paragraph of ${GROUPS[i][0]}`);
    });
    const homeList = [...home.matchAll(/<li data-pin="([^"]+)">([^<]+)<\/li>/g)].map((m) => [m[1], decode(m[2])]);
    assert.deepEqual([...areas.html.matchAll(/<li data-pin="([^"]+)">([^<]+)<\/li>/g)].map((m) => [m[1], decode(m[2])]), homeList);
    assert.deepEqual(homeList.map((x) => x[1]), GROUPS.flatMap((g) => g[1]).map((id) => PLACES[['ilocos-sur', 'la-union', 'baguio', 'la-trinidad', 'tarlac', 'pampanga', 'bulacan', 'iba-zambales', 'subic', 'manila', 'cavite', 'laguna', 'batangas'].indexOf(id)]));
    assert.ok(areas.body.includes('13 locations across Luzon') && areas.body.includes('Schematic map, not to scale'));
    const claims = visibleText(areas.main);
    assert.ok(/we have completed projects/i.test(claims));
    assert.ok(!/\b(offices?|branch(?:es)?|showrooms?|warehouses?|branches|stores?|dealers?|resellers?|distributors?)\b/i.test(claims.replace('Our office is in Tandang Sora', '').replace('Our office:', '')), 'a claim beyond "we have completed projects in these areas"');
  });

  it('describes the stainless-steel options exactly as the catalogue does (the page and the catalogue cannot drift apart)', () => {
    const cat = visibleText(catalogue);
    for (const phrase of ['one to three layers', 'one to four sinks', 'three to six tiers', 'one to three tiers', 'Floor-standing / Wall-hung', 'Swing / Sliding', 'Gooseneck / Pre-rinse spray', 'Solid / Slotted', 'SS304', 'Made to your length, width and height', 'Made to your length and depth']) assert.ok(cat.includes(phrase), `the catalogue no longer says "${phrase}"`);
    const t = visibleText(byPath('/services/stainless-steel-fabrication/').main);
    for (const phrase of ['One to three layers', 'One to four sinks', 'gooseneck or pre-rinse spray faucet', 'Floor-standing or wall-hung', 'swing or sliding doors', 'one to three shelves inside', 'One to three tiers', 'solid or slotted surface', 'Three to six tiers', 'with or without wheels', 'Your length, width and height', 'Your length and depth', 'food-grade SS304 stainless steel as standard', 'laboratory-grade SS316 on request', 'brushed, mirror or satin finish']) assert.ok(t.includes(phrase), `the fabrication page lost "${phrase}"`);
  });

  it('shows the representative catalogue pictures as such, and the systems pages carry the owner\'s own disclaimer about standard examples', () => {
    for (const slug of ['exhaust-and-fresh-air-systems', 'kitchen-fire-suppression']) {
      const p = byPath(`/services/${slug}/`);
      assert.ok(p.body.includes('Representative image'), slug);
      assert.ok(p.imgs.filter((e) => /\/site\/img\/products\//.test(e.attrs.src)).length >= 1);
    }
    for (const slug of ['exhaust-and-fresh-air-systems', 'lpg-gas-line-installation', 'kitchen-fire-suppression']) {
      const t = byPath(`/services/${slug}/`).body;
      assert.ok(t.includes('These dimensions and specifications are standard examples and are not exhaustive. All equipment can be custom-fabricated to meet your specific site requirements.'), `${slug}: the disclaimer`);
      assert.ok(t.includes('One standard example from our 2026 kitchen catalogue'), `${slug}: "one standard example"`);
    }
    for (const p of PAGES.filter((x) => x.kind === 'service')) for (const { attrs: a } of p.imgs) if (/\/products\//.test(a.src)) assert.ok(!/\b(our work|our project|installed by|we installed)\b/i.test(a.alt));
  });
});

describe('sitemap and robots: the new paths are crawlable and listed', () => {
  it('robots.txt allows every path (no Disallow prefix covers any of the 12 pages; /projects/ stays private)', () => {
    const robots = read('robots.txt');
    const disallowed = robots.split('\n').filter((l) => /^Disallow:/i.test(l)).map((l) => l.replace(/^Disallow:\s*/i, '').trim()).filter(Boolean);
    for (const p of PAGE_PATHS) assert.deepEqual(disallowed.filter((d) => p.startsWith(d)), [], `robots.txt disallows ${p}`);
    assert.ok(disallowed.includes('/projects/'), '/projects/ is the private client portal and must stay disallowed');
    assert.ok(/^Allow: \/$/m.test(robots) && robots.includes('Sitemap: https://barroindustries.com/sitemap.xml'));
  });

  it('lists the home page, the catalogue and all 12 pages in sitemap.xml, once each, with a lastmod date, and every listed page exists', () => {
    const sm = read('sitemap.xml');
    const locs = [...sm.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>\s*<\/url>/g)].map((m) => ({ loc: m[1], lastmod: m[2] }));
    // these 14 are listed in this order; the product pages and the fresh-air page (tests/seo-products.test.mjs) and any later page sit between or after them
    const want = [BASE + '/', BASE + '/catalogue/', ...PAGE_PATHS.map((p) => BASE + p)];
    assert.deepEqual(locs.map((l) => l.loc).filter((u) => want.includes(u)), want);
    for (const l of locs) {
      assert.match(l.lastmod, /^\d{4}-\d{2}-\d{2}$/, `${l.loc}: lastmod`);
      assert.ok(exists(l.loc.replace(BASE + '/', '') + 'index.html'), `${l.loc} has no page`);
    }
    assert.ok(sm.split('<url>').length - 1 >= 14 && new Set(locs.map((l) => l.loc)).size === locs.length);
    assert.ok(!/brilliant/i.test(sm));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Owner 2026-10-22: "Message us" opens the Facebook Messenger chat (https://m.me/barrokitchens, which 302s to the chat). One link, written the same everywhere:
// a small inline chat-bubble icon (a single <path>: no Facebook / Meta logo, no image, no script, no widget, the CSP unchanged), target=_blank + rel=noopener,
// data-brand (the handle is the brand's, so a rename must find it; the inventory in the brand tests above allows exactly this URL beside the Facebook one).
describe('"Message us": the Messenger chat is linked from every public footer, the homepage contact section and the two call-to-action bands — and nowhere else', () => {
  const ALL = [['/', home], ['/catalogue/', catalogue], ...PAGES.map((p) => [p.path, p.html])];
  const row = (html) => html.match(/<p class="foot-links">[\s\S]*?<\/p>/)[0];
  const msgAnchors = (html) => [...html.matchAll(/<a\b[^>]*\shref="https:\/\/m\.me\/[^"]*"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
  const section = (html, re) => (html.match(re) || [''])[0];

  it('has the link in the footer of the homepage, the catalogue and all 12 content pages: right after Facebook, before "Get a quote" and "Team portal" (which stays last), written exactly as the shared markup', () => {
    assert.equal(ALL.length, 14);
    for (const [p, html] of ALL) {
      const r = row(html);
      assert.deepEqual(msgAnchors(r), [msgLink('', 'Message us')], `${p}: the footer's Messenger link`);
      const at = (s) => r.indexOf(s);
      assert.ok(at('>Facebook</a>') >= 0 && at('>Facebook</a>') < at(MSGR) && at(MSGR) < at('>Get a quote</a>') && at('>Get a quote</a>') < at('Team portal'), `${p}: the footer order`);
      assert.ok(r.endsWith('Team portal</a></p>'), `${p}: "Team portal" is not last`);
      assert.ok(r.indexOf(MSGR) === r.indexOf('>Facebook</a>') + '>Facebook</a>'.length + '<a href="'.length, `${p}: not directly beside the Facebook link`);
    }
  });

  it('writes it with its attributes: href https://m.me/barrokitchens, target="_blank", rel="noopener", a bare data-brand, the words "Message us" (no brand name), and an aria-hidden inline <svg> holding one <path>', () => {
    for (const [p, html] of ALL) {
      for (const a of msgAnchors(html)) {
        const S = scan(a);
        assert.deepEqual(S.problems, [], `${p}: the link is malformed`);
        const el = S.elements[0];
        assert.equal(el.tag, 'a');
        assert.equal(el.attrs.href, 'https://m.me/barrokitchens');
        assert.equal(el.attrs.target, '_blank');
        assert.equal(el.attrs.rel, 'noopener');
        assert.ok('data-brand' in el.attrs && el.attrs['data-brand'] === '', `${p}: no bare data-brand on the link`);
        assert.deepEqual(S.elements.slice(1).map((e) => e.tag), ['svg', 'path'], `${p}: the icon is one svg with one path, nothing else`);
        assert.equal(S.elements[1].attrs['aria-hidden'], 'true');
        assert.ok(!('href' in S.elements[1].attrs) && !/<(img|use|image|script|style)\b/i.test(a), `${p}: the icon pulls in an external file`);
        const words = visibleText(a);
        assert.ok(/^Message us( on Messenger)?$/.test(words), `${p}: link text "${words}"`);
        assert.ok(!/Barro|Kitchens/i.test(words), `${p}: the brand is in the link text`);
      }
    }
  });

  it('has it in the homepage CONTACT section as a prominent secondary (outline) button beside the primary "Get a quote" — "Message us on Messenger"', () => {
    const contact = section(home, /<section id="contact"[\s\S]*?<\/section>/);
    assert.ok(contact.includes(`<p class="contact-actions"><a class="site-btn site-btn-primary" href="/catalogue/?quote=1" data-qr-start>Get a quote</a>${msgLink('site-btn site-btn-outline', 'Message us on Messenger')}</p>`));
    assert.equal(msgAnchors(contact).length, 1);
    assert.ok(/#site \.contact-actions\{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px\}/.test(read('css/site.css')), 'the two buttons sit side by side and wrap');
  });

  it('has it as a secondary (outline) button in the catalogue\'s "Can\'t find it?" band and in the FAQ page\'s closing call to action, between the primary button and the "or call" lines', () => {
    const cat = section(catalogue, /<section class="cat-cta[\s\S]*?<\/section>/);
    assert.ok(cat.includes(`data-qr-start>Request a quote</a>\n      ${msgLink('site-btn site-btn-outline', 'Message us')}\n      <p class="cat-cta-or">`), 'catalogue band');
    const faq = section(byPath('/faq/').html, /<section class="pg-cta"[\s\S]*?<\/section>/);
    assert.ok(faq.includes(`href="/catalogue/?quote=1">Get a quote</a>\n      ${msgLink('site-btn site-btn-outline', 'Message us')}\n      <p class="pg-cta-or">`), 'FAQ call to action');
  });

  it('links Messenger exactly where it was asked for: 2 places on the homepage (contact + footer), the catalogue and the FAQ page (call to action + footer), 1 on each other page (footer) — never in the header, the phone menu, the JSON-LD or the hero', () => {
    const expected = { '/': 2, '/catalogue/': 2, '/faq/': 2 };
    for (const [p, html] of ALL) {
      assert.equal(msgAnchors(html).length, expected[p] || 1, `${p}: Messenger links`);
      assert.deepEqual(msgAnchors(section(html, /<header id="site-header">[\s\S]*?<\/header>/)), [], `${p}: the header keeps "Get a quote" only`);
      for (const s of scan(html).scripts.filter((x) => x.attrs.type === 'application/ld+json')) assert.ok(!/m\.me/.test(s.body), `${p}: m.me in the JSON-LD (it is not a profile)`);
    }
    assert.deepEqual(msgAnchors(section(home, /<section id="hero">[\s\S]*?<\/section>/)), []);
  });

  it('adds nothing to the CSP or the page weight: no Facebook / Meta / Messenger host in any CSP, no script, no image and no stylesheet from them, the icon is inline', () => {
    for (const [p, html] of ALL) {
      const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || '';
      assert.ok(csp && !/facebook|messenger|meta\.com|m\.me|fbcdn|fbsbx/i.test(csp), `${p}: the CSP names Messenger`);
      const S = scan(html);
      for (const e of S.elements.filter((x) => ['script', 'img', 'link', 'iframe', 'source'].includes(x.tag))) assert.ok(!/facebook|messenger|meta\.com|m\.me|fbcdn|fbsbx/i.test((e.attrs.src || '') + (e.attrs.href || '') + (e.attrs.srcset || '')), `${p}: a <${e.tag}> loads from Facebook / Messenger`);
    }
  });

  it('styles the icon with one shared rule (currentColor, so it follows the link and its hover), in css/site.css which every one of these pages links', () => {
    const css = read('css/site.css');
    assert.ok(/#site \.msg-ic\{flex:none;margin-right:8px;vertical-align:-3px\}/.test(css));
    for (const [p, html] of ALL.filter(([x]) => x !== '/')) assert.ok(/<link rel="stylesheet" href="\/css\/site\.css">/.test(html), `${p}: does not link css/site.css`);
    assert.ok(!/data-brand/.test(css) && !/data-brand/.test(read('js/site.js')), 'a stylesheet or script reads [data-brand]');
  });
});
