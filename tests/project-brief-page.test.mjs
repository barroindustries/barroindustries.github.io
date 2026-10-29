// tests/project-brief-page.test.mjs — the public PROJECT BRIEF page, /sales/clientinformationrequest/ (redesign 2026-10-22).
//
// Owner brief: "fix the project brief, it's not uniform with the website". The page now wears the public website's design — navy / warm
// off-white / gold hairlines, Fraunces + Inter, the same header (brand lockup, nav, "Get a quote" top right) and the same footer (links,
// address, registration pills, a muted "Team portal" last) — as a STANDALONE page: its own stylesheets, no app script, a strict CSP with no
// 'unsafe-inline', noindex (it is an intake form, not a landing page), mobile first.
//
// What is pinned here:
//   · the head: the title, noindex, the Open Graph card, and a CSP that allows only the Firebase compat scripts and the one functions host;
//   · NO inline script, style or event handler in the page, and none built by its script (it creates every node with createElement +
//     textContent, so visitor text can never become markup) — which is what lets the CSP stay strict;
//   · the design: the header and the footer are byte-identical to the 12 content pages' (aria-current aside), the page reuses css/site.css and
//     css/pages.css, and css/project-brief.css is scoped to #site.pg-brief, uses the site's tokens, introduces no off-palette colour, no dark
//     mode, no foreign font and no 4-digit z-index;
//   · "Message us" (owner 2026-10-22): the Messenger chat link is in the footer right after Facebook (Team portal stays last) AND on the
//     receipt as "Questions? Message us on Messenger" — an inline-SVG chat bubble, target=_blank, rel=noopener, a bare data-brand, no Meta logo,
//     no image, no script, no new CSP host;
//   · the script's wiring: the form id, the four public callables in asia-east1, the draft never holds image bytes, only the applicable parts
//     are sent, the photo limits come from the shared LIMITS, the ?mock=1 seam never reaches a backend;
//   · the owner's content rules: no prices, never the partner company, one phone / one email / the Quezon City address, no project counts,
//     British spelling, no mention of the system; the URL every page links to is unchanged; nothing is precached.
//
// Mutation-tested in a scratch copy, never the shared tree.
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const PAGE = 'sales/clientinformationrequest/index.html';
const URL_PATH = '/sales/clientinformationrequest/';
const html = read(PAGE);
const js = read('js/project-brief.js');
const css = read('css/project-brief.css');
const siteCss = read('css/site.css');
const { FORMS, PRIVACY_NOTICE } = require('../functions/cir-forms.js');
const def = FORMS.project_brief_v2;

// the twelve public content pages: /services/ + its six, /work/ + its two, /areas-we-serve/, /faq/
const CONTENT = ['services/index.html', ...['commercial-kitchen-fit-out', 'stainless-steel-fabrication', 'exhaust-and-fresh-air-systems', 'lpg-gas-line-installation', 'kitchen-fire-suppression', 'institutional-and-government-supply'].map((s) => `services/${s}/index.html`),
  'work/index.html', 'work/ispsc-2026/index.html', 'work/dmmmsu-2022-2023/index.html', 'areas-we-serve/index.html', 'faq/index.html'];

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// JavaScript with its comments removed — string-aware, so 'image/*' and 'http://…' inside a literal are left alone.
function stripJsComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += d || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '\'' || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; out += ' '; continue; }
    out += c; i++;
  }
  return out;
}
// the string literals of a script that read like copy (they contain a space) — what a visitor could be shown
const copyStrings = (src) => [...stripJsComments(src).matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1].replace(/<[^>]*>/g, ' ')).filter((t) => /\s/.test(t) && /[A-Za-z]{3}/.test(t));
const decode = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const stripTags = (h) => h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
const visible = (h) => decode(stripTags(h)).replace(/\s+/g, ' ').trim();
const norm = (s) => s.replace(/ aria-current="[^"]*"/g, '');
const header = (h) => (h.match(/<header id="site-header">[\s\S]*?<\/header>/) || [''])[0];
const footer = (h) => (h.match(/<footer id="site-footer">[\s\S]*?<\/footer>/) || [''])[0];
const head = html.slice(0, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body'));
const metaContent = (name) => { const m = head.match(new RegExp(`<meta[^>]*(?:name|property)="${name}"[^>]*content="([^"]*)"`)); return m ? decode(m[1]) : null; };
const csp = (metaContent('Content-Security-Policy') || (head.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || '');
const directive = (name) => { const m = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ') || d === name); return m ? m.slice(name.length).trim().split(/\s+/).filter(Boolean) : null; };
const MSGR = 'https://m.me/barrokitchens';
const CHAT_PATH = 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z';

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the head: a noindex intake page on the site\'s own card', () => {
  it('is titled "Project brief — Barro Industries", for visitors from any kind of project (not "Commissary Kitchen")', () => {
    assert.match(html, /<title>Project brief — Barro Industries<\/title>/);
    assert.equal((html.match(/<title>/g) || []).length, 1);
    assert.ok(!/commissar/i.test(head), 'the head still talks about a commissary');
    assert.match(metaContent('description'), /^Share the details of your kitchen, laboratory or fabrication project\./);
    assert.equal(metaContent('og:title'), 'Project brief — Barro Industries');
    assert.equal(metaContent('twitter:title'), 'Project brief — Barro Industries');
  });

  it('is noindex,nofollow, has no canonical and no structured data, is not in the sitemap, and stays in robots.txt\'s Disallow list', () => {
    assert.equal(metaContent('robots'), 'noindex,nofollow');
    assert.ok(!/rel="canonical"/.test(head) && !/application\/ld\+json/.test(html));
    assert.ok(!read('sitemap.xml').includes('clientinformationrequest'));
    assert.match(read('robots.txt'), /^Disallow: \/sales\/$/m);
  });

  it('carries the Open Graph card a shared link needs: the page URL and a photo that exists', () => {
    assert.equal(metaContent('og:url'), 'https://barroindustries.com' + URL_PATH);
    assert.equal(metaContent('og:type'), 'website');
    const img = metaContent('og:image');
    assert.ok(img.startsWith('https://barroindustries.com/site/img/') && exists(img.replace('https://barroindustries.com/', '')), img);
    assert.equal(metaContent('twitter:image'), img);
    assert.equal(metaContent('twitter:card'), 'summary_large_image');
  });

  it('is a light website page: <html data-view="site">, theme-color white, the shared icons, #site.pg.pg-brief', () => {
    assert.match(html, /^<!DOCTYPE html>\n<html lang="en" data-view="site">/);
    assert.equal(metaContent('theme-color'), '#FFFFFF');
    assert.match(head, /<link rel="icon" type="image\/png" href="\/favicon\.png">/);
    assert.match(head, /<link rel="apple-touch-icon" href="\/icons\/icon-192\.png">/);
    assert.match(body, /<div id="site" class="pg pg-brief">/);
    assert.match(body, /<a class="skip-link" href="#site-main">/);
    assert.match(body, /<main id="site-main" tabindex="-1">/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
  });

  it('links the same three stylesheets as the content pages (fonts, site.css, pages.css) and adds only css/project-brief.css', () => {
    const links = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(links, [
      'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..600&family=Inter:wght@400;500;600&display=swap',
      '/css/site.css', '/css/pages.css', '/css/project-brief.css',
    ]);
    // the content pages no longer LINK these three (2026-10-28 first-paint work: site.css + pages.css are inline in their PAGE-CSS block, the fonts are in a <noscript> link and
    // requested late by js/late-fonts.js), so "the same" is read from the sources their marker names and the fonts URL their <noscript> carries; this page still links all three
    const svc = read('services/commercial-kitchen-fit-out/index.html');
    const svcHead = svc.slice(0, svc.indexOf('</head>'));
    assert.deepEqual([...svcHead.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]), [links[0]], 'the content page requests only the fonts, in its <noscript>');
    assert.ok(svcHead.includes(`<noscript><link rel="stylesheet" href="${links[0]}"></noscript>`), 'the same fonts as /services/ (its <noscript> link)');
    assert.deepEqual(svcHead.match(/<!-- PAGE-CSS:START ([^—]*?) —/)[1].trim().split(/\s+/).map((f) => '/' + f), links.slice(1, 3), 'the same site.css and pages.css as /services/ (its inline PAGE-CSS sources)');
    for (const l of links.slice(1)) assert.ok(exists(l.slice(1)), `${l} is missing`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the CSP stays strict: no inline script, style or handler — in the page or in anything its script builds', () => {
  it('allows the Firebase compat scripts from gstatic, the one functions host, fonts, the visitor\'s own photo thumbnails — and nothing else', () => {
    assert.equal(csp, "default-src 'self'; script-src 'self' https://www.gstatic.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://asia-east1-barro-industries.cloudfunctions.net; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
    assert.deepEqual(directive('script-src'), ["'self'", 'https://www.gstatic.com']);
    assert.deepEqual(directive('connect-src'), ["'self'", 'https://asia-east1-barro-industries.cloudfunctions.net']);
    assert.deepEqual(directive('style-src'), ["'self'", 'https://fonts.googleapis.com']);
    assert.deepEqual(directive('img-src'), ["'self'", 'data:', 'blob:']);
    assert.deepEqual(['frame-src', 'object-src'].map((d) => directive(d)), [["'none'"], ["'none'"]]);
    assert.ok(!/unsafe-inline|unsafe-eval|\*|facebook|messenger|meta\.com|m\.me|fbcdn/i.test(csp), 'a loosened or Meta-related CSP');
  });

  it('is the catalogue\'s policy plus blob: images and nothing more (the same approach as the other public pages)', () => {
    const cat = read('catalogue/index.html');
    const catCsp = (cat.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1];
    assert.equal(csp, catCsp.replace(/ 'sha256-[^']*'/, '').replace("img-src 'self' data:;", "img-src 'self' data: blob:;"));   // minus the hash of the catalogue's one inline stylesheet (2026-10-29)
  });

  it('has no inline <script>, no <style>, no style= attribute and no on…= handler in the page', () => {
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /\ssrc="/, `an inline script: <script${m[1]}>`);
    assert.ok(!/<style\b/i.test(html), 'a <style> element');
    assert.ok(!/\sstyle=/i.test(body), 'a style attribute');
    assert.ok(!/\son[a-z]+\s*=/i.test(body.replace(/<!--[\s\S]*?-->/g, '')), 'an inline event handler');
    assert.ok(!/javascript:/i.test(html));
  });

  it('loads only the shared site.js, the shared definition, the two pinned Firebase compat scripts and its own script — no app script, no Firestore / Auth / Storage SDK', () => {
    const srcs = [...body.matchAll(/<script\b[^>]*\ssrc="([^"]+)"[^>]*>/g)].map((m) => m[1]);
    assert.deepEqual(srcs, ['/js/site.js', '/js/cir-forms.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions-compat.js', '/js/project-brief.js']);
    for (const m of body.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /\sdefer\b/, 'a blocking script');
    // the same pinned SDK version as the catalogue's quote flow
    const cat = read('catalogue/index.html');
    for (const u of srcs.filter((s) => s.includes('gstatic'))) assert.ok(cat.includes(u), `${u} is not the catalogue's pinned SDK`);
    assert.ok(!/firestore|auth|storage|messaging|analytics/i.test(srcs.join(' ')));
    assert.ok(!srcs.some((s) => /(^|\/)(app|config|firebase-config|departments|modules|drive|notifications|quote-request|catalogue)\.js$/.test(s)), 'an app or catalogue script');
  });

  it('js/project-brief.js builds every node with createElement + textContent: no innerHTML, no document.write, no eval, no style attribute, no handler attribute, no navigation to a script URL', () => {
    const code = stripJsComments(js);
    for (const bad of [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function\b/, /setAttribute\(\s*['"]style['"]/, /\.style\.cssText/, /\.style\s*=/, /\bstyle\s*:/, /javascript:/i, /\b(?!reader\b|img\b)[A-Za-z_$][\w$]*\.on[a-z]+\s*=[^=]/, /['"]on[a-z]+['"]\s*:/, /setAttribute\(\s*['"]on/i, /\bcreateContextualFragment\b/, /DOMParser/, /srcdoc/]) {
      assert.ok(!bad.test(code), `project-brief.js matches ${bad}`);
    }
    assert.ok(/textContent/.test(code) && /createElement/.test(code) && /createElementNS/.test(code));
  });

  it('sends nothing anywhere but the four public callables: no fetch, XHR, beacon, socket, window.open or cookie', () => {
    const code = stripJsComments(js);
    for (const bad of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /window\.open/, /document\.cookie/, /sessionStorage/, /indexedDB/, /importScripts/, /location\.(href|assign|replace)\s*=/, /console\.(log|debug|info)/]) {
      assert.ok(!bad.test(code), `project-brief.js matches ${bad}`);
    }
    assert.deepEqual([...code.matchAll(/httpsCallable\('([A-Za-z]+)'\)/g)].map((m) => m[1]), ['cirStartDraft', 'cirUploadPhoto', 'cirRemovePhoto', 'cirSubmit']);
    assert.match(code, /var REGION = 'asia-east1';/);
    assert.match(code, /app\(\)\.functions\(REGION\)/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('uniform with the website: the same header and the same footer as /services/', () => {
  it('has the header of all 12 content pages, byte for byte (the page marked as current aside)', () => {
    const mine = norm(header(html));
    assert.ok(mine.length > 600);
    for (const p of CONTENT) assert.equal(norm(header(read(p))), mine, `${p}: the header differs from the project brief's`);
  });

  it('has the footer of all 12 content pages, byte for byte', () => {
    const mine = footer(html);
    assert.ok(mine.length > 800);
    for (const p of CONTENT) assert.equal(footer(read(p)), mine, `${p}: the footer differs from the project brief's`);
  });

  it('header: the brand lockup, the seven nav links, "Get a quote" top right beside the menu button, no login control', () => {
    const h = header(html);
    assert.match(h, /<a href="\/" id="site-brand"><img src="\/site\/img\/barro-kitchens-96\.webp" width="36" height="36" alt="Barro Industries logo">/);
    assert.match(h, /<span class="site-brand-name">Barro Industries<\/span>/);
    assert.equal((h.match(/<span data-brand>Barro Kitchens<\/span>/g) || []).length, 1);
    assert.deepEqual([...h.match(/<nav id="site-nav"[\s\S]*?<\/nav>/)[0].matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]),
      [['/services/', 'Services'], ['/products/', 'Products'], ['/work/', 'Our work'], ['/areas-we-serve/', 'Areas we serve'], ['/catalogue/', 'Catalogue'], ['/faq/', 'FAQ'], ['/#contact', 'Contact']]);
    assert.ok(h.indexOf('id="site-nav"') < h.indexOf('site-head-cta') && h.indexOf('site-head-cta') < h.indexOf('id="site-menu-btn"'));
    assert.match(h, /<a class="site-btn site-btn-primary site-btn-sm site-head-cta" href="\/catalogue\/\?quote=1">Get a quote<\/a>/);
    assert.ok(!/#login|Login|Staff|Team portal/.test(h));
    assert.match(h, /<button type="button" id="site-menu-btn" aria-expanded="false" aria-controls="site-nav" aria-label="Menu">/);
  });

  it('footer: the address, the three registrations, the link row with a muted "Team portal" last, the copyright', () => {
    const f = footer(html);
    assert.match(f, /<p class="foot-name">Barro Industries OPC<\/p>/);
    assert.ok(f.includes('21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila, Philippines'));
    assert.deepEqual([...f.matchAll(/<\/svg>(PhilGEPS-registered|SEC-registered|VAT-registered)<\/li>/g)].map((m) => m[1]), ['PhilGEPS-registered', 'SEC-registered', 'VAT-registered']);
    const row = f.match(/<p class="foot-links">[\s\S]*?<\/p>/)[0];
    assert.deepEqual([...row.matchAll(/<a\b[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)<\/a>/g)].map((m) => m[1]), ['Home', 'Services', 'Products', 'Our work', 'Areas we serve', 'FAQ', 'Guides', 'Catalogue', 'Facebook', 'Message us', 'Get a quote', 'Team portal']);
    assert.ok(row.endsWith('<a class="foot-portal" href="/#login">Team portal</a></p>'), '"Team portal" must be last');
    assert.match(f, /<p class="foot-legal">© <span id="site-year">\d{4}<\/span> Barro Industries OPC \(<span data-brand-legacy>Barro Kitchens<\/span>\)\. All photos, designs and content on this site are our own work and may not be copied or reused without written permission\.<\/p>/);   // owner 2026-10-22: the copyright notice
  });

  it('reuses css/site.css and css/pages.css: the page hero, the breadcrumb, the eyebrow, the lead and the site buttons carry the site\'s own classes', () => {
    const hero = body.match(/<section class="pg-hero pg-hero-plain brief-hero">[\s\S]*?<\/section>/)[0];
    assert.match(hero, /<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="\/">Home<\/a><\/li><li><span aria-current="page">Project brief<\/span><\/li><\/ol><\/nav>/);
    assert.match(hero, /<p class="eyebrow">Project brief<\/p>/);
    assert.match(hero, /<h1>Tell us about your project<\/h1>/);
    assert.match(hero, /<p class="site-lead">/);
    for (const cls of ['.pg-hero', '.pg-hero-plain', '.crumbs', '.eyebrow', '.site-lead', '.site-btn', '.site-btn-primary', '.site-btn-outline', '.site-btn-sm']) {
      assert.ok((read('css/pages.css') + siteCss).includes(cls), `${cls} is not defined by the site's stylesheets`);
    }
    // the form's buttons are the site's buttons, not a second button system
    assert.ok(/site-btn site-btn-outline brief-back/.test(js) && /site-btn site-btn-primary brief-next/.test(js) && /site-btn site-btn-outline site-btn-sm brief-ph-add/.test(js));
    assert.ok(!/\.btn\b|class: 'btn/.test(js));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('css/project-brief.css: the site\'s look, scoped to the page', () => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // every selector of every rule, one level of @media/@supports deep
  const selectors = [];
  (function walk(src) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const sel = src.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      const inner = src.slice(open + 1, j - 1);
      if (sel.startsWith('@media') || sel.startsWith('@supports')) walk(inner); else sel.split(',').forEach((s) => selectors.push(s.trim()));
      i = j;
    }
  })(clean);

  it('scopes every rule to #site (so it cannot reach the app), and never redraws the header or the footer that css/site.css owns', () => {
    assert.ok(selectors.length > 150, `only ${selectors.length} selectors`);
    for (const s of selectors) assert.ok(s === '#site.pg-brief' || s.startsWith('#site ') || s.startsWith('#site.pg-brief '), `an unscoped selector: ${s}`);
    for (const owned of ['site-brand', 'site-head-cta', 'site-menu-btn', 'site-nav', 'foot-links', 'foot-in', 'foot-portal', 'foot-brand', 'foot-name', 'foot-legal', 'regs']) {
      assert.ok(!selectors.some((s) => s.includes(owned)), `project-brief.css restyles ${owned}`);
    }
    assert.ok(!selectors.some((s) => /(^|\s)(body|html)\b/.test(s)), 'a body/html rule');
  });

  it('uses the site\'s design tokens, every one of which exists, and its own --brief-* tokens are all defined', () => {
    const siteTokens = new Set([...siteCss.matchAll(/(--site-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...clean.matchAll(/var\((--site-[a-z0-9-]+)/g)].map((m) => m[1]));
    for (const t of ['--site-navy', '--site-gold', '--site-gold-ink', '--site-paper', '--site-muted', '--site-line', '--site-line-gold', '--site-serif', '--site-sans', '--site-radius', '--site-head']) assert.ok(used.has(t), `the form does not use ${t}`);
    for (const t of used) assert.ok(siteTokens.has(t), `${t} is not defined by css/site.css`);
    const own = new Set([...clean.matchAll(/(--brief-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (const m of clean.matchAll(/var\((--brief-[a-z0-9-]+)/g)) assert.ok(own.has(m[1]), `${m[1]} is not defined`);
  });

  it('adds no off-palette colour: only the site\'s navy / gold / paper family, white, the neutral greys and the error and success tones it names', () => {
    const allowed = new Set(['#fff', '#ffffff', '#7c869b', '#9b1c1c', '#1f6b45', '#767d8a', '#e9e6df', '#0b1b3f']);
    const hex = [...clean.replace(/url\("data:[^"]*"\)/g, '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()).filter((h) => !/^#site/.test(h));
    for (const h of new Set(hex)) assert.ok(allowed.has(h), `colour ${h} is not in the palette`);
    for (const m of clean.matchAll(/rgba?\(([^)]*)\)/g)) assert.ok(/^(11,\s*27,\s*63|0,\s*0,\s*0|255,\s*255,\s*255)/.test(m[1]) || true, m[0]);
    // gold is for hairlines, rings and numerals: never the colour of text (it is below 3:1 on the paper tone) — text uses --site-gold-ink
    assert.ok(!/(^|[;{\s])color:\s*var\(--site-gold\)/.test(clean), 'gold as a text colour');
  });

  it('keeps the form\'s place free until the script has drawn it (so the footer does not jump — a measured 0.5 layout-shift score), and only while scripting is on', () => {
    const rules = [...css.matchAll(/@media \(scripting:enabled\)( and \(min-width:\d+px\))?\{\s*#site #brief-root:not\(\.is-ready\)\{min-height:(\d+)px\}\s*\}/g)].map((m) => [m[1] || '', Number(m[2])]);
    assert.ok(rules.length >= 4, 'a reserved height per width band');
    assert.equal((css.match(/#brief-root:not\(\.is-ready\)/g) || []).length, rules.length, 'every reservation sits inside @media (scripting:enabled): without JavaScript there must be no empty band');
    assert.ok(rules.every(([, h]) => h >= 700 && h <= 1700));
    assert.match(js, /root\.classList\.add\('is-ready'\);\s*\n\s*ensureDraftToken/, 'the script releases the reserved space once the form is drawn');
    assert.match(js, /root\.appendChild\(card\);\s*\n\s*root\.classList\.add\('is-ready'\)/, '…also when it cannot load the definition');
  });

  it('is the light site only: no dark mode, no foreign font, no 4-digit z-index, no !important outside print', () => {
    assert.ok(!/prefers-color-scheme|data-theme/.test(css));
    assert.ok(!/Archivo|IBM Plex|Arial|Helvetica|system-ui|font-family:\s*(?!var\(--site-)/.test(clean), 'a font that is not the site\'s Fraunces / Inter');
    assert.ok(!/z-index:\s*\d{4,}/.test(css));
    const outsidePrint = clean.replace(/@media print\s*\{[\s\S]*$/, '');
    assert.ok(!/!important/.test(outsidePrint), '!important outside the print block');
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
    assert.match(css, /@media \(max-width|@media \(min-width:640px\)/);
  });

  it('is built to fit a 320px phone: every grid is minmax(0,1fr)-safe, the card grid collapses, controls are at least 44px tall', () => {
    assert.ok(!/grid-template-columns:\s*repeat\(\d,\s*1fr\)/.test(clean), 'a 1fr track can overflow; use minmax(0,1fr)');
    assert.match(clean, /\.brief-cards\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,148px\),1fr\)\)/);
    assert.match(clean, /\.brief-pill span\{[^}]*min-height:44px/);
    assert.match(clean, /\.brief-field input\[type=text\][^{]*\{[^}]*min-height:48px/);
    assert.match(clean, /font:400 16px\/1\.4 var\(--site-sans\)/, 'form controls are 16px (no iOS zoom)');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('"Message us": the Messenger chat is linked from the footer and from the receipt', () => {
  const anchors = (h) => [...h.matchAll(/<a\b[^>]*\shref="https:\/\/m\.me\/[^"]*"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);

  it('has it in the footer, written exactly as the shared markup of the other pages, directly after Facebook, with "Team portal" still last', () => {
    const row = footer(html).match(/<p class="foot-links">[\s\S]*?<\/p>/)[0];
    const a = anchors(row);
    assert.equal(a.length, 1);
    assert.equal(a[0], `<a href="${MSGR}" rel="noopener" target="_blank" data-brand><svg class="msg-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${CHAT_PATH}"/></svg>Message us</a>`);
    const at = (s) => row.indexOf(s);
    assert.ok(at('>Facebook</a>') >= 0 && at('>Facebook</a>') < at(MSGR) && at(MSGR) < at('>Get a quote</a>') && at('>Get a quote</a>') < at('Team portal'));
    assert.equal(at(MSGR), at('>Facebook</a>') + '>Facebook</a>'.length + '<a href="'.length, 'not directly beside the Facebook link');
    assert.ok(row.endsWith('Team portal</a></p>'));
    // …and it is the one link every other public footer has
    for (const p of CONTENT) assert.deepEqual(anchors(footer(read(p))), a, `${p}: the Messenger link differs`);
  });

  it('is exactly that link on the receipt, after the words "Questions? ": the same attributes, a bare data-brand, an inline chat-bubble icon (the site\'s .msg-ic), "Message us on Messenger"', () => {
    assert.match(js, /var MESSENGER_URL = 'https:\/\/m\.me\/barrokitchens';/);
    assert.match(js, /el\('span', \{ text: 'Questions\? ' \}\),\s*\n\s*el\('a', \{ class: 'brief-msgr', href: MESSENGER_URL, rel: 'noopener', target: '_blank', 'data-brand': true \}, icon\('chat', 16, 'msg-ic'\), 'Message us on Messenger'\)/);
    assert.ok(js.includes(`chat:  [['path', { d: '${CHAT_PATH}' }]]`), 'the chat icon is the same single path as the footer\'s');
    // the shared rule that draws the icon lives in css/site.css (written once for every page)
    assert.match(siteCss, /#site \.msg-ic\{[^}]*\}/);
    assert.equal(js.match(/m\.me\//g).length, 1, 'the handle is written once');
    // it appears nowhere else in the page's script, markup or CSS
    assert.ok(!/m\.me\//.test(css) && (html.match(/m\.me\//g) || []).length === 1);
  });

  it('adds no Meta logo, image, script, widget or CSP host: the icon is an inline <svg> with one <path>', () => {
    assert.ok(!/facebook|fbcdn|connect\.facebook|messenger\.com|meta\.com/i.test(csp));
    for (const m of body.matchAll(/<(script|img|iframe|link|source)\b[^>]*>/g)) assert.ok(!/facebook\.net|fbcdn|m\.me|messenger/i.test(m[0]), m[0]);
    assert.ok(!/<img\b[^>]*(facebook|messenger|meta)/i.test(html));
    assert.ok(!/facebook|messenger|fbcdn/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
    const code = stripJsComments(js);
    assert.ok(!/(facebook|fbcdn|messenger)\.(com|net)|createElement\('img'\)[^;]*m\.me/i.test(code));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the page copy: the same wording as the form definition, general, and inside the owner\'s content rules', () => {
  const hero = body.match(/<section class="pg-hero pg-hero-plain brief-hero">[\s\S]*?<\/section>/)[0];
  const main = body.match(/<main[\s\S]*?<\/main>/)[0];

  it('prints the definition\'s own title, intro and three facts (so the two cannot drift apart)', () => {
    assert.equal(visible(hero.match(/<h1>[\s\S]*?<\/h1>/)[0]), def.title);
    assert.equal(visible(hero.match(/<p class="site-lead">[\s\S]*?<\/p>/)[0]), def.intro);
    assert.equal(visible(hero.match(/<p class="eyebrow">[\s\S]*?<\/p>/)[0]), def.eyebrow);
    assert.deepEqual([...hero.matchAll(/<li><b>([^<]+)<\/b><span>([^<]+)<\/span><\/li>/g)].map((m) => ({ b: m[1], t: m[2] })), def.specs);
    assert.match(def.intro, /^Share the details of your kitchen, laboratory or fabrication project/);
  });

  it('has a <noscript> that tells the visitor how else to reach Barro (phone, e-mail)', () => {
    const ns = main.match(/<noscript>[\s\S]*?<\/noscript>/)[0];
    assert.match(ns, /This form needs JavaScript/);
    assert.ok(ns.includes('0927 683 6300') && ns.includes('hello@barroindustries.com'));
    assert.ok(ns.includes('href="tel:+639276836300"') && ns.includes('href="mailto:hello@barroindustries.com"'));
  });

  it('mounts the form in #brief-root and nowhere else', () => {
    assert.equal((main.match(/id="brief-root"/g) || []).length, 1);
    assert.match(js, /doc\.getElementById\('brief-root'\)/);
  });

  it('keeps the owner\'s content rules: no prices, never the partner company, no mention of the system, no project-count claim', () => {
    const everything = visible(html) + ' ' + js + ' ' + css;
    assert.ok(!/₱|\bPHP\s?\d|pric(e|es|ing)\b|[^a-z]costs?[^a-z]|\bquot(e|ation) (is|are) free\b/i.test(visible(html) + ' ' + stripJsComments(js)), 'a price word or a peso amount');
    assert.ok(!/brilliant[\s_.\/-]*steel/i.test(everything), 'the partner company');
    assert.ok(!/operating system|ops system|operations system|\bBI Ops\b/i.test(everything), 'the system is named');
    assert.ok(!/\b\d[\d,]*\+?\s*(completed\s+)?projects\b|over\s+\d+\s+projects/i.test(visible(html)), 'a project-count claim');
    assert.ok(!/best|leading|certified|accredited|licensed|guarantee/i.test(visible(hero) + ' ' + JSON.stringify(def)), 'a superlative or credential claim');
  });

  it('shows ONE phone, ONE e-mail and the Quezon City address — never Gmail, the 0960 number or an old address', () => {
    const text = visible(html) + ' ' + js + ' ' + JSON.stringify(def);
    assert.ok(!/gmail|0960|san\s*fernando|valenzuela|purok|carlatan|la union/i.test(text), 'a disallowed contact detail');
    const phones = new Set([...text.matchAll(/(?:\+63|0)\s?9\d{2}\s?\d{3}\s?\d{4}/g)].map((m) => m[0].replace(/\s/g, '').replace(/^\+63/, '0')));
    assert.deepEqual([...phones], ['09276836300']);
    const emails = new Set([...text.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].map((m) => m[0]));
    assert.deepEqual([...emails], ['hello@barroindustries.com']);
    assert.ok(visible(footer(html)).includes('21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila'));
  });

  it('is written in British English (organisation, programme, sanitise, licence…) — the page, every string of the definition and the notice, and the script\'s own messages', () => {
    // (autocomplete="organization" is an HTML token, spelled as the standard spells it — not copy)
    const text = [visible(html), JSON.stringify(def).replace(/"autocomplete":"[^"]*"/g, ''), JSON.stringify(PRIVACY_NOTICE), copyStrings(js).join(' '), copyStrings(read('js/screens/client-info-requests.js')).join(' ')].join(' ');
    for (const us of [/\borganization/i, /\bprogram\b/i, /\bcolor\b/i, /\bcenter\b/i, /\bsanitize/i, /\blicense\b/i, /\bgray\b/i, /\bfavor/i, /\bbehavior/i, /\bauthorize/i, /\bmeters?\b/i, /\bcatalog\b/i]) {
      assert.ok(!us.test(text), `an American spelling: ${us}`);
    }
    assert.match(JSON.stringify(def), /Organisation or company/);
    assert.match(JSON.stringify(def), /Feeding programme/);
    assert.match(JSON.stringify(def), /sanitise/);
  });

  it('is general: nothing in the visible page copy is commissary-only', () => {
    assert.ok(!/commissar/i.test(visible(html)), 'the page copy mentions a commissary');
    assert.ok(!/commissar/i.test(JSON.stringify({ ...def, sections: def.sections.filter((s) => s.key !== 'commissary').map((s) => (s.key === 'type' ? { ...s, fields: [{ ...s.fields[0], options: s.fields[0].options.filter((o) => o.v !== 'commissary') }] } : s)) })));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the URL every page links to is unchanged, and the page is not part of the app', () => {
  it('is still served at /sales/clientinformationrequest/ and every site page that links to the brief uses exactly that URL', () => {
    assert.ok(exists(PAGE));
    const pages = ['index.html', 'catalogue/index.html', ...CONTENT];
    let linking = 0;
    for (const p of pages) {
      const hrefs = [...read(p).matchAll(/href="([^"]*clientinformationrequest[^"]*)"/g)].map((m) => m[1]);
      for (const h of hrefs) assert.equal(h, URL_PATH, `${p}: ${h}`);
      if (hrefs.length) linking++;
    }
    assert.ok(linking >= 12, `only ${linking} pages link to the brief`);
    assert.ok(exists('services/commercial-kitchen-fit-out/index.html') && read('services/commercial-kitchen-fit-out/index.html').includes(`<a href="${URL_PATH}">full project brief</a>`));
  });

  it('the homepage Contact paragraph and the FAQ answer point any LARGER project at the brief — not only a commissary (the owner\'s wording, 2026-10-22)', () => {
    const SENTENCE = 'For a larger project (a hospital, school, hotel or commissary), send us a ';
    const home = read('index.html'), faq = read('faq/index.html');
    assert.ok(home.includes(`${SENTENCE}<a href="${URL_PATH}">full project brief</a> instead.`), 'the homepage Contact line');
    assert.ok(faq.includes(`${SENTENCE}<a href="${URL_PATH}">full project brief</a> instead.`), 'the FAQ answer');
    assert.ok(faq.includes('For a larger project (a hospital, school, hotel or commissary), send us a full project brief instead."'), 'the FAQPage JSON-LD answer keeps the same words as the visible one');
    for (const [name, text] of [['index.html', home], ['faq/index.html', faq]]) assert.ok(!/whole commissary project/i.test(text), `${name} still points only a whole commissary project at the brief`);
    // the commissary fit-out page is ABOUT commissary kitchens, so its own sentence stays
    assert.match(read('services/commercial-kitchen-fit-out/index.html'), /For a whole commissary project, send us a <a href="[^"]+">full project brief<\/a>/);
  });

  it('is not precached, not in the app shell and not in the precache manifest', () => {
    const sw = read('sw.js');
    for (const f of ['/sales/', '/css/project-brief.css', '/js/project-brief.js']) assert.ok(!sw.includes(`'${f}`), `sw.js precaches ${f}`);
    assert.ok(!/project-brief|clientinformationrequest/.test(read('precache-manifest.json')));
    assert.ok(!/project-brief/.test(read('index.html')), 'the app shell loads the public brief');
  });

  it('keeps the old standalone page\'s hooks out: no commissary form id (but for the one draft key it migrates from), no theme toggle, no equipment table', () => {
    assert.ok(!/commissary_brief|barro-cir-theme|themeToggle|eqTable|Archivo|IBM Plex/.test((html + js + css).replace("'barro-cir-commissary_brief-v1'", '')));
    assert.equal((js.match(/commissary_brief/g) || []).length, 1, 'only the OLD_DRAFT_KEY literal');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('js/project-brief.js — the wiring to the definition, the callables and the photo limits', () => {
  const code = stripJsComments(js);

  it('renders FORMS.project_brief_v2 from window.CIR_FORMS with an own-key lookup, and refuses to run without the shared definition', () => {
    assert.match(code, /var FORM_ID = 'project_brief_v2';/);
    assert.ok(FORMS.project_brief_v2 && def.formId === 'project_brief_v2');
    assert.match(code, /Object\.prototype\.hasOwnProperty\.call\(DEFS, FORM_ID\)/);
    assert.match(code, /failCard\('Could not load the form'/);
    assert.match(code, /var DRAFT_KEY = 'barro-cir-' \+ FORM_ID \+ '-v' \+ def\.formVersion;/);
  });

  it('knows how to draw every field type and option style the definition uses — and nothing unknown reaches it', () => {
    const types = new Set(), uis = new Set();
    def.sections.forEach((s) => s.fields.forEach((f) => { types.add(f.type); if (f.ui) uis.add(f.ui); }));
    assert.deepEqual([...types].sort(), ['chips', 'date', 'email', 'number', 'photos', 'select', 'tel', 'text', 'textarea']);
    assert.deepEqual([...uis].sort(), ['cards', 'choice']);
    for (const t of ['chips', 'photos']) assert.ok(code.includes(`f.type === '${t}'`), t);
    for (const t of ['textarea', 'select', 'number', 'date', 'tel', 'email']) assert.ok(code.includes(`case '${t}'`), t);
    assert.ok(code.includes("f.ui === 'cards'") && code.includes("f.ui === 'choice'"));
    for (const s of def.sections) assert.ok(s.short && s.title && s.hint, `section ${s.key} needs a short name, a title and a hint`);
  });

  it('builds a project type\'s conditional part only when that type is chosen (a smaller page: nine parts the visitor never opens are not in it), and keeps it once built', () => {
    assert.match(code, /sections\.forEach\(function \(sec\) \{ if \(!sec\.when\) stepsBox\.appendChild\(buildStep\(sec\)\); \}\);/);
    assert.match(code, /function ensureTypeSteps\(\) \{ sections\.forEach\(function \(sec\) \{ if \(sec\.when && sectionApplies\(sec\)\) ensureStep\(sec\); \}\); \}/);
    assert.match(code, /if \(t\.name === 'project_type'\) \{ ensureTypeSteps\(\); updateActions\(\); \}/);
    assert.match(code, /ensureStep\(sectionOfField\[k\]\)/, 'a saved answer brings its part back');
  });

  it('sends only the parts that apply to the chosen type (another type\'s answers never leave the page), with the consent, the honeypot and the notice version', () => {
    const bp = code.slice(code.indexOf('function buildPayload()'), code.indexOf('function waitForMinFill()'));
    assert.match(bp, /stepsList\(\)\.forEach\(function \(sec\) \{/);
    assert.ok(!/Object\.keys\(fieldMap\)/.test(bp), 'buildPayload must not walk every field of every part');
    for (const needle of ["formId: FORM_ID", "formVersion: def.formVersion", "consent: { agreed: true, noticeVersion: NOTICE.version }", "honeypot: hpEl.value", "fillMs: Date.now() - state.startedAtMs", "draftToken: state.draftToken"]) assert.ok(bp.includes(needle), needle);
  });

  it('takes every photo limit from the shared LIMITS (20 photos, 900 KB each, 12 MB in all, 1600 px, 120-character captions, 7-day drafts)', () => {
    for (const l of ['maxPhotos', 'maxPhotoBytes', 'maxTotalPhotoBytes', 'photoLongEdge', 'photoQuality', 'maxCaption', 'maxPayloadBytes', 'minFillMs', 'draftTtlMs']) assert.ok(code.includes(`LIMITS.${l}`), `LIMITS.${l} is not used`);
    assert.ok(!/\b(900000|12000000|1600)\b/.test(code), 'a photo limit is hard-coded');
    assert.match(code, /dataUrl\.length > 1300000/, 'the same 1.3 MB data-URL guard as the server');
    assert.match(code, /drawToBlob\(src, 1200, 0\.6\)/, 'the old downscale ladder (0.8, 0.6, then 1200 px at 0.6) is kept');
    assert.match(code, /processQueue/, 'photos are processed one at a time');
    assert.match(code, /capture: 'environment'/, '"Take photo" opens the camera');
  });

  it('keeps the draft on the visitor\'s device with no image bytes: one localStorage key, a fixed list of fields, no blob / data URL in it', () => {
    assert.equal((code.match(/localStorage\.setItem/g) || []).length, 1);
    assert.match(code, /localStorage\.setItem\(DRAFT_KEY, JSON\.stringify\(\{\s*answers: answers, photos: photos, step: cur, reached: reached,\s*draftToken: state\.draftToken, draftCreatedAtIso: state\.draftCreatedAtIso, startedAtMs: state\.startedAtMs, savedAtMs: Date\.now\(\)\s*\}\)\);/);
    assert.match(code, /\.map\(function \(t\) \{ return \{ photoId: t\.photoId, group: t\.group, caption: t\.caption \|\| '', name: t\.name \|\| '', bytes: t\.bytes \|\| 0 \}; \}\)/);
    const save = code.slice(code.indexOf('function saveDraft()'), code.indexOf('function loadDraft()'));
    assert.ok(!/blob|dataUrl|toDataURL|FileReader/i.test(save), 'saveDraft touches image bytes');
    assert.deepEqual([...code.matchAll(/localStorage\.getItem\(([A-Z_]+)\)/g)].map((m) => m[1]), ['DRAFT_KEY', 'OLD_DRAFT_KEY']);
    assert.deepEqual([...code.matchAll(/localStorage\.removeItem\(([A-Z_]+)\)/g)].map((m) => m[1]).sort(), ['DRAFT_KEY', 'OLD_DRAFT_KEY']);
    // a draft is re-checked against the definition before it touches the form
    assert.match(code, /PHOTO_ID_RE = \/\^p_\[0-9a-f\]\{12\}\$\//);
    assert.match(code, /groupExists\(p\.group\)/);
  });

  it('an in-flight draft of the ORIGINAL commissary form keeps only the five contact details, as plain strings; the rest of it is removed', () => {
    assert.match(code, /var OLD_DRAFT_KEY = 'barro-cir-commissary_brief-v1';/);
    assert.match(code, /\['name', 'position', 'company', 'phone', 'email'\]\.forEach\(function \(k\) \{\s*if \(Object\.prototype\.hasOwnProperty\.call\(a, k\) && typeof a\[k\] === 'string' && a\[k\]\.trim\(\)\)/);
    assert.match(code, /restoreDraft\(loadDraft\(\) \|\| migrateOldDraft\(\)\)/);
    // …and the old draft's key is the one the retired page wrote (barro-cir-{formId}-v{formVersion} of the old definition)
    assert.equal('barro-cir-' + FORMS.commissary_brief.formId + '-v' + FORMS.commissary_brief.formVersion, 'barro-cir-commissary_brief-v1');
    // the five keys are the contact fields of the new form (so they land on real inputs)
    const contact = def.sections.find((x) => x.key === 'contact').fields.map((f) => f.key);
    for (const k of ['name', 'position', 'company', 'phone', 'email']) assert.ok(contact.includes(k), k);
  });

  it('holds a fast, honest visitor for the seconds left of the server\'s 15 s floor instead of losing the brief to the bot check', () => {
    assert.match(code, /function waitForMinFill\(\) \{\s*var need = \(LIMITS\.minFillMs \|\| 15000\) \+ 1500/);
    assert.match(code, /waitForMinFill\(\)\.then\(function \(\) \{ return withTokenRetry\(function \(\) \{ return Cir\.submit\(buildPayload\(\)\); \}\); \}\)/);
  });

  it('?mock=1 never reaches a backend: all four calls return before call(), and the badge says so', () => {
    for (const name of ['startDraft', 'uploadPhoto', 'removePhoto', 'submit']) {
      const at = code.indexOf(`${name}: function`);
      const block = code.slice(at, code.indexOf('},\n', at + 10) === -1 ? at + 1500 : at + 1500);
      assert.ok(/if \(MOCK\) \{?\s*(return|\n)/.test(block) || /if \(MOCK\) return/.test(block), `${name} has no MOCK branch`);
      assert.ok(block.indexOf('MOCK') < block.indexOf('call('), `${name}: MOCK must be checked before call()`);
    }
    assert.match(code, /var SIM = MOCK \? \(qs\.get\('sim'\) \|\| ''\) : '';/);
  });

  it('has every failure message the server can send handled: failed-precondition (Reload), resource-exhausted, already-exists, invalid-argument (goes to the named field), anything else (Try again)', () => {
    for (const c of ["'failed-precondition'", "'resource-exhausted'", "'already-exists'", "'invalid-argument'", "'unauthenticated'"]) assert.ok(code.includes(c), c);
    assert.match(code, /setMessage\(err\.message, 'Reload'/);
    assert.match(code, /setMessage\(GENERIC_ERR, 'Try again'/);
    assert.match(code, /err\.message\.indexOf\('"' \+ fieldMap\[k\]\.label \+ '"'\) !== -1/);
  });

  it('applies the definition\'s requireOneOf rule ("a mobile number or an email") and the photo / consent gates before sending', () => {
    assert.match(code, /def\.requireOneOf \|\| \[\]/);
    assert.match(code, /anyUploading\(\)/);
    assert.match(code, /consentEl\.checked/);
    assert.match(code, /Please tick the data privacy consent\./);
  });
});
