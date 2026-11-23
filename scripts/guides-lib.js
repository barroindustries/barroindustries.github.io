/**
 * guides-lib.js — what scripts/build-guides-hub.js (the /guides/ front page) and scripts/apply-guide-template.js (the shared article template)
 * both need: the curated config (scripts/guides-hub.json), the photo manifests (scripts/guide-photos-*.json), the Quick answers
 * (scripts/guide-answers.json), the facts an article page states about itself (H1, dates, reading time, hero) and the small HTML helpers.
 * Dependency-free CommonJS. Nothing here writes a file.
 *
 * The one spec for all of it is specs/KITCHEN-GUIDE-JOURNAL-SPEC.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// every problem the generators know how to report (a missing page, photograph or manifest entry, a bad config) is one of these; anything else is a bug
class GuidesError extends Error {}
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const BASE = 'https://barroindustries.com';
// the date the release is stamped with: the "Updated" date of an article whose text, figures or sources changed in it
const STANDARDS_PATH = '/guides/editorial-standards/';
const PILLAR_LINK = '/guides/how-to-build-a-restaurant-kitchen/';

// ── text helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const textOf = (html) => unesc(String(html).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoOk = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso);
// '2026-11-19' → '19 Nov 2026' (cards) and '19 November 2026' (masthead, byline)
const shortDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`; };
const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

// ── the inputs ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function loadConfig() { return JSON.parse(read('scripts/guides-hub.json')); }

// every slug of scripts/guide-photos-*.json (a, b, c ...) in one object
function loadManifests() {
  const out = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'scripts')).filter((x) => /^guide-photos-.*\.json$/.test(x)).sort()) {
    const j = JSON.parse(read('scripts/' + f));
    for (const [slug, e] of Object.entries(j)) {
      if (out[slug]) throw new GuidesError(`${f}: ${slug} is in two photo manifests`);
      out[slug] = e;
    }
  }
  return out;
}

// scripts/guide-answers.json: { "<slug>": { "question": "…", "answer": "…" } } — absent or partial is fine (an article without an entry gets no Quick answer block)
function loadAnswers() { return exists('scripts/guide-answers.json') ? JSON.parse(read('scripts/guide-answers.json')) : {}; }

// ── what an article page says about itself ───────────────────────────────────────────────────────────────────────────────────────────
const articleFile = (slug) => `guides/${slug}/index.html`;
function readArticle(slug) {
  const file = articleFile(slug);
  if (!exists(file)) throw new GuidesError(`${file} does not exist`);
  const html = read(file);
  const h1Html = (html.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1];
  if (!h1Html) throw new GuidesError(`${file}: no <h1>`);
  const meta = (html.match(/<p class="art-meta">([\s\S]*?)<\/p>/) || [])[1] || '';
  const published = (meta.match(/<time datetime="(\d{4}-\d{2}-\d{2})">/) || [])[1];
  const mins = (meta.match(/<span>(\d+) min read<\/span>/) || [])[1];
  if (!published || !mins) throw new GuidesError(`${file}: no published date or reading time in p.art-meta`);
  const ldModified = (html.match(/"dateModified": "(\d{4}-\d{2}-\d{2})T/) || [])[1];
  const lead = textOf((html.match(/<p class="site-lead">([\s\S]*?)<\/p>/) || [])[1] || '');
  const description = unesc((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  const fig = (html.match(/<figure class="pg-hero-media">([\s\S]*?)<\/figure>/) || [])[1] || '';
  const img = (fig.match(/<img\b[^>]*>/) || [''])[0];
  const attr = (n) => unesc((img.match(new RegExp(`\\s${n}="([^"]*)"`)) || [])[1] || '');
  return {
    slug, file, html,
    h1: textOf(h1Html), published, modified: ldModified || published, mins: Number(mins),
    noindex: /<meta name="robots" content="noindex/.test(html),
    lead, description,
    hero: { src: attr('src'), srcset: attr('srcset'), width: Number(attr('width')), height: Number(attr('height')), alt: attr('alt'), caption: textOf((fig.match(/<figcaption>([\s\S]*?)<\/figcaption>/) || [])[1] || '') },
  };
}

// ── photographs ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function webpSize(rel) {
  const b = fs.readFileSync(path.join(ROOT, rel));
  if (!(b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP')) throw new GuidesError(`${rel} is not a WebP`);
  const f = b.toString('ascii', 12, 16);
  if (f === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (f === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  if (f === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  throw new GuidesError(`${rel}: unknown WebP chunk ${f}`);
}
const SOURCE_NAMES = { 'unsplash.com': 'Unsplash', 'www.pexels.com': 'Pexels', 'pexels.com': 'Pexels' };
function sourceName(e) {
  let host = '';
  try { host = new URL(e.source_page).host; } catch (_) { /* below */ }
  if (!SOURCE_NAMES[host]) throw new GuidesError(`photo credit: no known source name for "${e.source_page}"`);
  return SOURCE_NAMES[host];
}
// the manifest "caption" is "<caption sentence> Stock photo for illustration — not a Barro Kitchens project. Photo: Name / Unsplash (Unsplash License)":
// only the first part is the caption; the credit and the disclaimer are written from the fields. An owner photo ("own") or a design render ("render") has a plain caption.
function baseCaption(e) {
  if (e.own || e.render) return e.caption;
  const i = e.caption.indexOf(e.disclaimer);
  if (i < 0) throw new GuidesError(`photo caption does not hold its disclaimer: ${e.caption}`);
  return e.caption.slice(0, i).trim();
}
// the variants of one photograph, by file: 1600 (src), 1000, 600 and 320 wide
function photoOf(slug, manifest) {
  const e = manifest[slug];
  if (!e) return null;
  const cand = Object.fromEntries(e.srcset.split(',').map((s) => s.trim().split(/\s+/)).map(([u, w]) => [w, u]));
  const p = {
    slug, entry: e, own: !!e.own, render: !!e.render,
    s1600: e.src, s1000: cand['1000w'], s600: cand['600w'], s320: e.src320 || e.src.replace(/\.webp$/, '-320.webp'),
    alt: e.alt, caption: baseCaption(e),
  };
  for (const k of ['s1600', 's1000', 's600', 's320']) if (!p[k]) throw new GuidesError(`${slug}: the manifest has no ${k} file`);
  return p;
}
// the picture's own pixels, read from the file (an <img> carries exactly these)
const dims = (rel) => { const { w, h } = webpSize(rel.replace(/^\//, '')); return { w, h }; };
function checkPhotoFiles(p) {
  for (const k of ['s1600', 's1000', 's600', 's320']) if (!exists(p[k].replace(/^\//, ''))) throw new GuidesError(`${p.slug}: ${p[k]} is missing${k === 's320' ? ' (run python3 scripts/make-guide-photo-320.py)' : ''}`);
}
// <img> markup: src, srcset (list of [file, width]), sizes, and the loading attributes of the slot
function imgTag({ src, srcset, sizes, alt, eager }) {
  const d = dims(src);
  return `<img src="${src}" srcset="${srcset.map(([u, w]) => `${u} ${w}w`).join(', ')}" sizes="${sizes}" width="${d.w}" height="${d.h}" alt="${esc(alt)}"${eager ? ' fetchpriority="high" decoding="async"' : ' loading="lazy" decoding="async"'}>`;
}

// the credit line of a photograph: "Photo: <a>Name</a> / Unsplash. Stock photo for illustration — not a Barro Kitchens project." (an owner photo: "Photo: Barro Kitchens."; a render: "Image: Barro Kitchens.")
function creditSpan(p) {
  const e = p.entry;
  if (p.own) return `<span class="art-credit">Photo: ${esc(e.photographer || 'Barro Kitchens')}.</span>`;
  if (p.render) return `<span class="art-credit">Image: ${esc(e.photographer || 'Barro Kitchens')}.</span>`;
  return `<span class="art-credit">Photo: <a href="${esc(e.source_page)}" rel="noopener nofollow" target="_blank">${esc(e.photographer)}</a> / ${sourceName(e)}. ${esc(e.disclaimer)}</span>`;
}
// the hero figure of an article (spec §4.1–4.2); `indent` is the page's own indentation of the figure
function heroFigure(p) {
  checkPhotoFiles(p);
  const d = dims(p.s1600);   // the file's own pixels: a stock photograph is not always 4:3 (the page frames it in 4:3 with object-fit:cover)
  const img = `<img src="${p.s1600}" srcset="${p.s600} 600w, ${p.s1000} 1000w, ${p.s1600} 1600w" sizes="(min-width:900px) 520px, 70vw" width="${d.w}" height="${d.h}" alt="${esc(p.alt)}" fetchpriority="high" decoding="async">`;
  return `<figure class="pg-hero-media">\n      ${img}\n      <figcaption>${esc(p.caption)} ${creditSpan(p)}</figcaption>\n    </figure>`;
}

// ── the registry: config + pages + manifests, with every check both generators rely on ─────────────────────────────────────────────────
class RegistryError extends GuidesError {}
const MIN_TOPIC = 3;       // a topic with fewer articles than this is not shown and its articles fall back to cfg.fallback
const fail = (m) => { throw new RegistryError(m); };
function loadRegistry() {
  const cfg = loadConfig();
  const manifest = loadManifests();
  const onDisk = fs.readdirSync(path.join(ROOT, 'guides'), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'editorial-standards' && exists(articleFile(e.name))).map((e) => e.name);
  const slugs = cfg.articles.map((a) => a.slug);
  if (new Set(slugs).size !== slugs.length) fail('scripts/guides-hub.json: a slug is registered twice');
  for (const s of slugs) if (!exists(articleFile(s))) fail(`scripts/guides-hub.json lists ${s}, which has no page (guides/${s}/index.html)`);
  for (const s of onDisk) if (!slugs.includes(s)) fail(`guides/${s}/index.html is in no articles[] entry of scripts/guides-hub.json`);
  const secIds = cfg.sections.map((s) => s.id);
  if (new Set(secIds).size !== secIds.length) fail('scripts/guides-hub.json: a section id is repeated');
  if (!secIds.includes(cfg.fallback)) fail(`the fallback section "${cfg.fallback}" is not in sections`);
  const arts = cfg.articles.map((c, i) => {
    const a = readArticle(c.slug);
    if (typeof c.dek !== 'string' || !c.dek) fail(`${c.slug}: no dek`);
    if (c.dek.length > 160) fail(`${c.slug}: the dek is ${c.dek.length} characters (160 at most)`);
    if (/barro/i.test(c.dek)) fail(`${c.slug}: the dek names the brand`);
    if (c.modified && (!isoOk(c.modified) || c.modified < a.published)) fail(`${c.slug}: modified ${c.modified} is not a date on or after ${a.published}`);
    return { ...a, ...c, pageModified: a.modified, modified: c.modified || a.published, index: i };
  }).filter((a) => !a.noindex);                                    // a draft (noindex) page is not listed
  const bySlug = Object.fromEntries(arts.map((a) => [a.slug, a]));
  const count = {};
  arts.forEach((a) => { count[a.section] = (count[a.section] || 0) + 1; });
  const rendered = new Set(cfg.sections.filter((s) => (count[s.id] || 0) >= MIN_TOPIC).map((s) => s.id));
  if (!rendered.has(cfg.fallback)) fail('the fallback section has fewer than 3 articles');
  arts.forEach((a) => { if (!secIds.includes(a.section)) fail(`${a.slug}: section "${a.section}" is not in sections`); if (!rendered.has(a.section)) a.section = cfg.fallback; });
  const sections = cfg.sections.filter((s) => rendered.has(s.id)).map((s) => ({ ...s, articles: [] }));
  const secById = Object.fromEntries(sections.map((s) => [s.id, s]));
  // the order inside a topic: the pinned slugs first, then the newest, a tie going to the later registry position
  const newestFirst = (x, y) => (x.published < y.published ? 1 : x.published > y.published ? -1 : y.index - x.index);
  for (const s of sections) {
    const mine = arts.filter((a) => a.section === s.id);
    const pinned = (s.pin || []).map((slug) => { if (!bySlug[slug]) fail(`section ${s.id}: pinned ${slug} is unknown`); return bySlug[slug]; }).filter((a) => a.section === s.id);
    s.articles = [...pinned, ...mine.filter((a) => !pinned.includes(a)).sort(newestFirst)];
  }
  return { cfg, manifest, arts, bySlug, sections, secById, newestFirst };
}

module.exports = {
  GuidesError, RegistryError, MIN_TOPIC, loadRegistry,
  ROOT, BASE, STANDARDS_PATH, PILLAR_LINK, read, exists, esc, unesc, textOf, wordCount, MONTHS, isoOk, shortDate, longDate,
  loadConfig, loadManifests, loadAnswers, articleFile, readArticle, webpSize, dims, sourceName, baseCaption, photoOf, checkPhotoFiles, imgTag, creditSpan, heroFigure,
};
