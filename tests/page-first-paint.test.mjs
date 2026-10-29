// tests/page-first-paint.test.mjs — the first-paint guard for EVERY standalone public content page (2026-10-28).
//
// Why. A content page that links its stylesheets and its Google Fonts blocks the first paint: Lighthouse mobile 82-86 on the calibrated stand-in for the live host
// (HTTP/2, 250 ms server response), first paint 3.2-3.8 s. The same page with its stylesheets INLINE in the head and its fonts requested after the page has loaded
// scores 97-100 (first paint 1.2 s). The product pages got that in the SEO build (2026-10-22); the older content pages (/services/ and its six service pages, /work/
// and its two project pages, /areas-we-serve/, /faq/) and the three guides got it on 2026-10-28, with the same markers, the same <noscript> fonts link and the same
// js/late-fonts.js. This file is the one guard that holds all of them, so none can slide back and a new page cannot be forgotten.
//
// Which pages. Every static page of the public site except the homepage (its own inline block, scripts/inline-site-css.js, CHECK 11) (and /catalogue/, which has its own pins in the last suite below, since its scripts differ): every index.html under services/ work/ areas-we-serve/ faq/ guides/ products/ AND every other page sitemap.xml lists. Found on disk
// and in the sitemap, not listed by hand, so a page added tomorrow is held to the same rule the day it appears.
//
// What is pinned, for each of them (the function problems() below returns what is wrong with a page; a test per page asserts it is empty, and the "guard itself" suite
// feeds it 135 broken copies of three real pages — 53 kinds of breakage — and requires every one to be caught):
//   · ONE <!-- PAGE-CSS:START … --> / <!-- PAGE-CSS:END --> pair, the START marker the generated one, listing the sources in order — css/site.css css/pages.css, and
//     css/guides.css after them for a guide — between the <noscript> fonts link and </head>;
//   · the <style id="page-css"> block is those files verbatim (trailing whitespace trimmed, joined by a newline), so editing a stylesheet without running
//     `node scripts/inline-page-css.js` fails here and in CHECK 9; the block has no @import; there is no other <style> and no style attribute;
//   · the CSP's style-src is exactly 'self', the sha256 of that block, and the Google Fonts host — never 'unsafe-inline' / 'unsafe-eval';
//   · NOTHING blocks the first paint: no <link rel="stylesheet|preload|modulepreload|prefetch|prerender"> anywhere outside the one <noscript> (any attribute order, any
//     quoting), no font <link> but the two preconnect hints, no script that is not deferred (the JSON-LD data block is not a script that runs);
//   · the one <noscript> sits in the head and holds exactly the Google Fonts link, the URL js/late-fonts.js requests after the load event;
//   · the two scripts are /js/site.js then /js/late-fonts.js, both deferred, at the end of the body.
// And, for the generator and the commit gate: scripts/inline-page-css.js finds every one of these pages, --check fails (and names the page) when css/guides.css,
// css/pages.css or a block is edited alone, a plain run repairs exactly the committed page and moves the hash, and CHECK 9 of scripts/ci-invariants.sh runs the
// --check and refuses a page in these folders that has no block or that links a stylesheet.
//
// Mutation-tested in scratch copies of the repo (never the shared tree), 2026-10-28: 34 mutants of the pages, the three stylesheets, the generator, js/late-fonts.js and CHECK 9 itself —
// a stylesheet <link> put back in a content page, a guide and a product page (in several spellings), a page reverted to its HEAD shape, the fonts link moved out of the <noscript>, a hand-edited
// block with and without its CSP hash recomputed, a wrong hash, 'unsafe-inline', css/site.css, css/pages.css and css/guides.css each edited without re-inlining, the late-fonts script or the
// <noscript> removed, a guide marker without guides.css, a new page with no block, site.js without defer in the head, the CI's generator call, its folder walk and each of its per-page checks
// removed one at a time, a blind generator, a changed font URL — every one killed by this file, by CHECK 9 or by both. The one that first survived (CHECK 9's "no PAGE-CSS block" test removed:
// nothing was wrong with the real pages, so nothing exercised it) is why the CI code is itself run against broken scratch trees below.
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const GEN = createRequire(import.meta.url)('../scripts/inline-page-css.js');
const BASE = 'https://barroindustries.com';
const STYLE_RE = /<style id="page-css">([\s\S]*?)<\/style>/;     // the generated inline stylesheet
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..600&family=Inter:wght@400;500;600&display=swap';
const NOSCRIPT = `<noscript><link rel="stylesheet" href="${FONTS_URL}"></noscript>`;
const sha256 = (t) => 'sha256-' + crypto.createHash('sha256').update(t, 'utf8').digest('base64');

// ── which pages ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CONTENT_DIRS = ['services', 'work', 'areas-we-serve', 'faq', 'guides', 'products'];
const EXEMPT = new Set(['/', '/catalogue/']);   // the homepage (scripts/inline-site-css.js, CHECK 11) and the generated catalogue page: not part of this rule
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name === 'index.html' ? [`${dir}/${e.name}`] : []));
const fromDisk = CONTENT_DIRS.filter((d) => exists(d)).flatMap(walk).map((f) => '/' + f.slice(0, -'index.html'.length));
const fromSitemap = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(BASE + '/')).map((u) => u.slice(BASE.length)).filter((p) => !EXEMPT.has(p));
const PATHS = [...new Set([...fromDisk, ...fromSitemap])].sort();
// what a page's marker must list: the stylesheets its <link> lines used to load, in that order
const sourcesFor = (p) => (p.startsWith('/guides/') ? ['css/site.css', 'css/pages.css', 'css/guides.css'] : ['css/site.css', 'css/pages.css']);
const fileOf = (p) => p.slice(1) + 'index.html';
const PAGES = PATHS.map((p) => ({ path: p, file: fileOf(p), sources: sourcesFor(p), html: exists(fileOf(p)) ? read(fileOf(p)) : null }));

// a stylesheet reader that sees one file edited (a rule added) — what a developer's edit looks like before the inliner is run
const edited = (file) => (f) => (f === file ? read(f) + '\n#site .zz{margin:0}\n' : read(f));

// ── the guard: what is wrong with one page (html), given the sources it needs and a reader for them ────────────────────────────────────
function attrsOf(s) {
  const out = {};
  const re = /([^\s=\/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
  return out;
}
const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b((?:"[^"]*"|'[^']*'|[^'">])*)>`, 'gi'))].map((m) => ({ raw: m[0], attrs: attrsOf(m[1]) }));

function problems(html, sources, readCss) {
  const out = [];
  const add = (m) => out.push(m);
  // 1. the markers, the sources they list, and where the block sits
  const nStart = html.split('<!-- PAGE-CSS:START ').length - 1, nEnd = html.split('<!-- PAGE-CSS:END -->').length - 1;
  if (nStart !== 1 || nEnd !== 1) add(`needs exactly one PAGE-CSS:START and one PAGE-CSS:END marker (found ${nStart} / ${nEnd})`);
  let listed = null;
  try { listed = GEN.sourcesOf(html); } catch (e) { add('the PAGE-CSS:START marker: ' + e.message); }
  if (listed === null && nStart === 0) add('no PAGE-CSS block: the page still links its stylesheets (see the HOW A PAGE OPTS IN note in scripts/inline-page-css.js)');
  if (listed && listed.join(' ') !== sources.join(' ')) add(`the marker lists ${listed.join(' ')} but this page needs ${sources.join(' ')}`);
  const iFonts = html.indexOf(NOSCRIPT), iStart = html.indexOf('<!-- PAGE-CSS:START '), iEnd = html.indexOf('<!-- PAGE-CSS:END -->'), iHead = html.indexOf('</head>');
  if (!(iFonts >= 0 && iFonts < iStart && iStart < iEnd && iEnd < iHead)) add('the order in the head must be: the <noscript> fonts link, PAGE-CSS:START, the block, PAGE-CSS:END, </head>');
  // 2. the block is the stylesheets verbatim; the CSP carries its hash and nothing looser
  const m = html.match(STYLE_RE);
  if (!m) add('no <style id="page-css"> block');
  const text = m ? m[1] : '';
  const want = '\n' + sources.map((f) => readCss(f).replace(/\s+$/, '')).join('\n') + '\n';
  if (m && text !== want) add(`the inline block is not ${sources.join(' + ')} verbatim — run  node scripts/inline-page-css.js`);
  if (m && iStart >= 0 && iEnd > iStart && html.slice(html.indexOf('\n', iStart), iEnd) !== '\n<style id="page-css">' + text + '</style>\n') add('the PAGE-CSS markers must wrap the <style id="page-css"> block and nothing else');
  if (/@import/i.test(text)) add('the inline block has an @import, which fetches a stylesheet before the first paint');
  const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/) || [])[1];
  if (!csp) add('no Content-Security-Policy meta');
  else {
    const style = csp.split(';').map((x) => x.trim()).find((x) => /^style-src\s/.test(x));
    const tokens = style ? style.split(/\s+/).slice(1) : [];
    const expected = ["'self'", `'${sha256(text)}'`, 'https://fonts.googleapis.com'];
    if (tokens.join(' ') !== expected.join(' ')) add(`style-src must be ${expected.join(' ')} (the page has: ${tokens.join(' ') || 'none'})`);
    if (/unsafe-inline|unsafe-eval/.test(csp)) add("the CSP allows 'unsafe-inline' or 'unsafe-eval'");
  }
  // 3. nothing blocks the first paint: what the browser meets as it parses (comments gone, the <noscript> set aside, the generated css text removed)
  const live = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<noscript>[\s\S]*?<\/noscript>/gi, '').replace(STYLE_RE, '');
  for (const t of tagsOf(live, 'link')) {
    const rel = (t.attrs.rel || '').toLowerCase().split(/\s+/);
    if (rel.some((r) => ['stylesheet', 'preload', 'modulepreload', 'prefetch', 'prerender', 'import'].includes(r))) add(`a <link> that blocks or pre-fetches before the first paint: ${t.raw}`);
    else if (/fonts\.(googleapis|gstatic)\.com/.test(t.attrs.href || '') && !rel.includes('preconnect')) add(`a font <link> outside the <noscript>: ${t.raw}`);
  }
  if (tagsOf(live, 'style').length) add('a <style> element other than the generated block');
  if (/\sstyle\s*=/i.test(live)) add('a style attribute (the CSP allows no inline style but the one hashed block)');
  // 4. the fonts: the one <noscript>, in the head, with the one link; the preconnect hints stay
  const ns = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<noscript>([\s\S]*?)<\/noscript>/gi)].map((x) => x[1]);
  if (ns.length !== 1 || ns[0] !== `<link rel="stylesheet" href="${FONTS_URL}">`) add('the one <noscript> must hold exactly the Google Fonts link (the URL js/late-fonts.js requests)');
  for (const h of ['<link rel="preconnect" href="https://fonts.googleapis.com">', '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>']) if (!html.includes(h)) add('missing ' + h);
  // 5. the scripts: the JSON-LD data block in the head, then /js/site.js and /js/late-fonts.js, deferred, at the end of the body
  const scripts = tagsOf(live, 'script');
  const runnable = scripts.filter((s) => s.attrs.type !== 'application/ld+json');
  if (runnable.map((s) => s.attrs.src).join(' ') !== '/js/site.js /js/late-fonts.js') add(`the scripts must be /js/site.js then /js/late-fonts.js (found: ${runnable.map((s) => s.attrs.src || 'an inline script').join(' ') || 'none'})`);
  for (const s of runnable) if (!('defer' in s.attrs) || 'async' in s.attrs || s.attrs.type === 'module') add(`a script that is not a plain deferred one: ${s.raw}`);
  const body = html.indexOf('<body');
  if (runnable.some((s) => live.indexOf(s.raw) < live.indexOf('<body'))) add('a script in the head');
  if (body < 0) add('no <body>');
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('which pages: every standalone public page except the homepage and /catalogue/, found on disk and in sitemap.xml', () => {
  it('finds the 28 pages the first-paint work covers (13 product and fresh-air pages, 12 older content pages, 3 guides) and none is missing on disk', () => {
    for (const must of ['/products/', '/products/stainless-steel-sinks/', '/services/fresh-air-systems/', '/services/', '/services/commercial-kitchen-fit-out/', '/services/stainless-steel-fabrication/', '/services/exhaust-and-fresh-air-systems/',
      '/services/lpg-gas-line-installation/', '/services/kitchen-fire-suppression/', '/services/institutional-and-government-supply/', '/work/', '/work/ispsc-2026/', '/work/dmmmsu-2022-2023/', '/areas-we-serve/', '/faq/',
      '/guides/', '/guides/commissary-kitchen-requirements-philippines/', '/guides/ss304-vs-ss316-stainless-steel/']) assert.ok(PATHS.includes(must), `${must} is not found by the page discovery`);
    assert.ok(PATHS.length >= 28, `only ${PATHS.length} pages found`);
    for (const p of PAGES) assert.ok(p.html && p.html.length > 5000, `${p.file}: listed in sitemap.xml (or found on disk) but missing`);
    assert.ok(!PATHS.some((p) => EXEMPT.has(p)));
  });

  it('exempts exactly the homepage and the catalogue, and nothing is found twice', () => {
    assert.deepEqual([...EXEMPT].sort(), ['/', '/catalogue/']);
    assert.equal(new Set(PATHS).size, PATHS.length);
  });

  it('is found, every page of it, by scripts/inline-page-css.js (so its --check can see the page)', () => {
    const found = new Set(GEN.findPages(ROOT).map((x) => x.file));
    for (const p of PAGES) assert.ok(found.has(p.file), `${p.file}: the generator does not find it (no PAGE-CSS:START marker?)`);
  });
});

describe('every page: its stylesheets are inline, its fonts are requested late, and nothing else blocks its first paint', () => {
  for (const p of PAGES) {
    it(`${p.path}`, () => {
      assert.deepEqual(problems(p.html, p.sources, read), [], `${p.file}`);
      assert.equal(GEN.build(p.html, read), p.html, `${p.file}: the generator would write something different — run  node scripts/inline-page-css.js`);
    });
  }

  it('has js/late-fonts.js request the very URL the <noscript> links carry, once, after the load event', () => {
    const js = read('js/late-fonts.js');
    assert.equal((js.match(/var URL = '([^']+)'/) || [])[1], FONTS_URL);
    assert.equal((js.match(/createElement\('link'\)/g) || []).length, 1);
    assert.ok(/addEventListener\('load'/.test(js) && /setTimeout\(add, 300\)/.test(js));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the guard itself: broken copies of real pages are caught', () => {
  const content = PAGES.find((p) => p.path === '/faq/');
  const guide = PAGES.find((p) => p.path === '/guides/ss304-vs-ss316-stainless-steel/');
  const product = PAGES.find((p) => p.path === '/products/stainless-steel-sinks/');
  const must = (label, p, mutate) => {
    const bad = mutate(p.html);
    assert.notEqual(bad, p.html, `${label}: the mutation changed nothing`);
    assert.notDeepEqual(problems(bad, p.sources, read), [], `${label}: NOT caught on ${p.path}`);
  };
  // a stylesheet edited while the page is left as it was (the page was not re-inlined)
  const mustCss = (label, p, readCss) => assert.notDeepEqual(problems(p.html, p.sources, readCss), [], `${label}: NOT caught on ${p.path}`);

  it('accepts the three real pages (so the mutations below are the only difference)', () => {
    for (const p of [content, guide, product]) assert.deepEqual(problems(p.html, p.sources, read), []);
  });

  it('catches a stylesheet <link> put back in the head — in every spelling a hand edit takes', () => {
    for (const p of [content, guide, product]) {
      must('site.css link', p, (h) => h.replace('</head>', '<link rel="stylesheet" href="/css/site.css">\n</head>'));
      must('pages.css link', p, (h) => h.replace('</head>', '<link rel="stylesheet" href="/css/pages.css">\n</head>'));
      must('attribute order', p, (h) => h.replace('</head>', '<link href="/css/site.css" rel="stylesheet">\n</head>'));
      must('single quotes', p, (h) => h.replace('</head>', "<link rel='stylesheet' href='/css/site.css'>\n</head>"));
      must('unquoted', p, (h) => h.replace('</head>', '<link rel=stylesheet href=/css/site.css>\n</head>'));
      must('upper case', p, (h) => h.replace('</head>', '<LINK REL="STYLESHEET" HREF="/css/site.css">\n</head>'));
      must('two lines', p, (h) => h.replace('</head>', '<link\n  rel="stylesheet"\n  href="/css/site.css">\n</head>'));
      must('rel with a second token', p, (h) => h.replace('</head>', '<link rel="alternate stylesheet" href="/css/site.css">\n</head>'));
      must('guides.css link', p, (h) => h.replace('</head>', '<link rel="stylesheet" href="/css/guides.css">\n</head>'));
      must('in the body', p, (h) => h.replace('</body>', '<link rel="stylesheet" href="/css/pages.css">\n</body>'));
    }
  });

  it('catches the Google Fonts link put back outside the <noscript>, a font preload, and any other early fetch', () => {
    for (const p of [content, guide, product]) {
      must('fonts link in the head', p, (h) => h.replace('</head>', `<link rel="stylesheet" href="${FONTS_URL}">\n</head>`));
      must('fonts link moved out of the noscript', p, (h) => h.replace(NOSCRIPT, `<link rel="stylesheet" href="${FONTS_URL}">`));
      must('font preload', p, (h) => h.replace('</head>', '<link rel="preload" as="font" href="https://fonts.gstatic.com/s/inter/v1/x.woff2" crossorigin>\n</head>'));
      must('style preload', p, (h) => h.replace('</head>', '<link rel="preload" as="style" href="/css/site.css">\n</head>'));
      must('prefetch', p, (h) => h.replace('</head>', '<link rel="prefetch" href="/css/pages.css">\n</head>'));
      must('a font host link that is not a preconnect', p, (h) => h.replace('</head>', '<link rel="dns-prefetch icon" href="https://fonts.gstatic.com/x.woff2">\n</head>'));
    }
  });

  it('catches a missing or wrong <noscript> fonts link, and a missing preconnect hint', () => {
    for (const p of [content, guide, product]) {
      must('noscript removed', p, (h) => h.replace(NOSCRIPT + '\n', ''));
      must('noscript with another URL', p, (h) => h.replace(NOSCRIPT, NOSCRIPT.replace('Fraunces', 'Merriweather')));
      must('a second noscript', p, (h) => h.replace('</head>', '<noscript><link rel="stylesheet" href="/css/site.css"></noscript>\n</head>'));
      must('noscript holding more', p, (h) => h.replace(NOSCRIPT, `<noscript><link rel="stylesheet" href="${FONTS_URL}"><link rel="stylesheet" href="/css/site.css"></noscript>`));
      must('preconnect removed', p, (h) => h.replace('<link rel="preconnect" href="https://fonts.googleapis.com">\n', ''));
      must('gstatic preconnect without crossorigin', p, (h) => h.replace('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>', '<link rel="preconnect" href="https://fonts.gstatic.com">'));
    }
  });

  it('catches the block going stale, being hand-edited, or being wrong about its sources', () => {
    for (const p of [content, guide, product]) {
      must('hand edit inside the block', p, (h) => h.replace('<style id="page-css">\n', '<style id="page-css">\n/* hand edit */\n'));
      must('a rule dropped from the block', p, (h) => h.replace(/\n#site \.skip-link[^\n]*/, ''));
      must('hand edit with the CSP hash updated to match', p, (h) => { const t = h.match(STYLE_RE)[1]; const t2 = t + '/* x */\n'; return h.replace(t, t2).replace(sha256(t), sha256(t2)); });
      mustCss('css/site.css edited, the page not re-inlined', p, edited('css/site.css'));
      mustCss('css/pages.css edited, the page not re-inlined', p, edited('css/pages.css'));
    }
    mustCss('css/guides.css edited, the guide not re-inlined', guide, edited('css/guides.css'));
    must('guide marker without guides.css', guide, (h) => h.replace(' css/guides.css —', ' —'));
    must('content page marker with guides.css', content, (h) => h.replace('PAGE-CSS:START css/site.css css/pages.css —', 'PAGE-CSS:START css/site.css css/pages.css css/guides.css —'));
    must('sources in the wrong order', content, (h) => h.replace('css/site.css css/pages.css —', 'css/pages.css css/site.css —'));
    must('marker not the generated one', content, (h) => h.replace('— generated by scripts/inline-page-css.js —', '— written by hand —'));
    must('START marker removed', content, (h) => h.replace(/<!-- PAGE-CSS:START [^\n]*\n/, ''));
    must('END marker removed', content, (h) => h.replace('<!-- PAGE-CSS:END -->\n', ''));
    must('END marker doubled', content, (h) => h.replace('<!-- PAGE-CSS:END -->', '<!-- PAGE-CSS:END -->\n<!-- PAGE-CSS:END -->'));
    must('block after </head>', content, (h) => { const b = h.slice(h.indexOf('<!-- PAGE-CSS:START '), h.indexOf('<!-- PAGE-CSS:END -->') + '<!-- PAGE-CSS:END -->'.length); return h.replace(b + '\n', '').replace('</head>\n', '</head>\n' + b + '\n'); });
    must('block before the noscript', content, (h) => { const b = h.slice(h.indexOf('<!-- PAGE-CSS:START '), h.indexOf('<!-- PAGE-CSS:END -->') + '<!-- PAGE-CSS:END -->'.length); return h.replace(b + '\n', '').replace(NOSCRIPT + '\n', b + '\n' + NOSCRIPT + '\n'); });
    // an @import in a stylesheet, with the page honestly re-inlined from it: only the @import rule can catch this one
    const withImport = (f) => '@import url(/x.css);\n' + read(f);
    assert.ok(problems(GEN.build(content.html, withImport), content.sources, withImport).some((x) => /@import/.test(x)), 'an @import in the inline block is NOT caught');
  });

  it('catches a CSP that no longer matches the block or is looser than it should be', () => {
    for (const p of [content, guide, product]) {
      must('wrong hash', p, (h) => h.replace(/'sha256-[^']+'/, "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='"));
      must('hash removed', p, (h) => h.replace(/ 'sha256-[^']+'/, ''));
      must("'unsafe-inline' added", p, (h) => h.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"));
      must('hash of the other page class', p, (h) => h.replace(/'sha256-[^']+'/, p === guide ? "'sha256-eptjHnMe01LsXN0jTp49pQ+swQi7h/mbBahOvqX40+Y='" : "'sha256-c2JoYjzyHwyXOw2QqCsgjtMn0+4HRA0zRvNALsjxqT8='"));
      must('fonts host dropped from style-src', p, (h) => h.replace(/(style-src [^;]*) https:\/\/fonts\.googleapis\.com/, '$1'));
    }
    must('no CSP at all', content, (h) => h.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, ''));
  });

  it('catches a second style, a style attribute, a script that blocks or sits in the head, and a missing or misplaced late-fonts script', () => {
    for (const p of [content, guide, product]) {
      must('a second <style>', p, (h) => h.replace('</head>', '<style>#site{color:red}</style>\n</head>'));
      must('a style attribute', p, (h) => h.replace('<div id="site" class="pg">', '<div id="site" class="pg" style="margin:0">'));
      must('late-fonts script removed', p, (h) => h.replace('<script defer src="/js/late-fonts.js"></script>\n', ''));
      must('late-fonts without defer', p, (h) => h.replace('<script defer src="/js/late-fonts.js">', '<script src="/js/late-fonts.js">'));
      must('late-fonts async', p, (h) => h.replace('<script defer src="/js/late-fonts.js">', '<script async src="/js/late-fonts.js">'));
      must('late-fonts before site.js', p, (h) => h.replace('<script defer src="/js/site.js"></script>\n<script defer src="/js/late-fonts.js"></script>', '<script defer src="/js/late-fonts.js"></script>\n<script defer src="/js/site.js"></script>'));
      must('site.js blocking, in the head', p, (h) => h.replace('</head>', '<script src="/js/site.js"></script>\n</head>').replace('<script defer src="/js/site.js"></script>\n', ''));
      must('an inline script', p, (h) => h.replace('</body>', '<script>document.title="x"</script>\n</body>'));
      must('a module script', p, (h) => h.replace('<script defer src="/js/late-fonts.js">', '<script type="module" defer src="/js/late-fonts.js">'));
    }
  });

  it('does not mistake a comment, the generated block or the JSON-LD for a violation (no false alarm on the real pages)', () => {
    // the head comment of a page names <noscript> and "stylesheet"; the css text names @media, url() and "style"; the JSON-LD is a script that does not run
    for (const p of [content, guide, product]) assert.ok(p.html.includes('the <noscript> link is the same URL') && STYLE_RE.test(p.html) && /<script type="application\/ld\+json">/.test(p.html));
    for (const p of [content, guide, product]) assert.deepEqual(problems(p.html, p.sources, read), []);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the generator and the commit gate keep every copy current', () => {
  it('works end to end in a scratch tree for a guide and a content page: an edit of css/guides.css alone fails only the guide, an edit of css/pages.css fails both, a plain run repairs exactly the committed pages and moves the hash', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-first-paint-'));
    try {
      const pages = { guide: 'guides/ss304-vs-ss316-stainless-steel/index.html', faq: 'faq/index.html' };
      for (const d of ['scripts', 'css', 'guides/ss304-vs-ss316-stainless-steel', 'faq']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'scripts/inline-page-css.js'), path.join(tmp, 'scripts/inline-page-css.js'));
      for (const c of ['site', 'pages', 'guides']) fs.writeFileSync(path.join(tmp, `css/${c}.css`), read(`css/${c}.css`));
      const put = (k, html) => fs.writeFileSync(path.join(tmp, pages[k]), html);
      const get = (k) => fs.readFileSync(path.join(tmp, pages[k]), 'utf8');
      const good = { guide: read(pages.guide), faq: read(pages.faq) };
      const run = (...a) => spawnSync(process.execPath, [path.join(tmp, 'scripts/inline-page-css.js'), ...a], { encoding: 'utf8' });
      put('guide', good.guide); put('faq', good.faq);
      assert.equal(run('--check').status, 0, 'the committed pages must pass');

      fs.writeFileSync(path.join(tmp, 'css/guides.css'), read('css/guides.css') + '\n#site .zz{margin:0}\n');
      let r = run('--check');
      assert.equal(r.status, 1, 'css/guides.css edited alone must fail');
      assert.match(r.stderr, /FAIL: guides\/ss304-vs-ss316-stainless-steel\/index\.html: .*stale/);
      assert.ok(!/faq\/index\.html/.test(r.stderr), 'the FAQ page does not inline css/guides.css');
      assert.match(r.stderr, /FIX: node scripts\/inline-page-css\.js/);
      assert.equal(run().status, 0);
      assert.ok(get('guide').includes('#site .zz{margin:0}') && get('guide') !== good.guide && get('faq') === good.faq, 'the repair follows the css file, moves the hash and leaves the other page alone');
      assert.notEqual(get('guide').match(/'sha256-[^']+'/)[0], good.guide.match(/'sha256-[^']+'/)[0]);
      assert.deepEqual(problems(get('guide'), sourcesFor('/guides/x/'), edited('css/guides.css')), [], 'the repaired page passes the guard against the edited stylesheet');
      assert.equal(run('--check').status, 0);

      put('guide', good.guide);
      fs.writeFileSync(path.join(tmp, 'css/guides.css'), read('css/guides.css'));
      fs.writeFileSync(path.join(tmp, 'css/pages.css'), read('css/pages.css') + '\n#site .zy{margin:0}\n');
      r = run('--check');
      assert.equal(r.status, 1, 'css/pages.css edited alone must fail');
      assert.ok(/guides\/ss304-vs-ss316-stainless-steel\/index\.html/.test(r.stderr) && /faq\/index\.html/.test(r.stderr), 'both page classes inline css/pages.css');
      assert.equal(run().status, 0);
      assert.ok(get('guide').includes('#site .zy{margin:0}') && get('faq').includes('#site .zy{margin:0}'));

      fs.writeFileSync(path.join(tmp, 'css/pages.css'), read('css/pages.css'));
      assert.equal(run().status, 0);
      assert.equal(get('guide'), good.guide, 'a plain run puts the guide back to exactly the committed page');
      assert.equal(get('faq'), good.faq, 'a plain run puts the page back to exactly the committed page');
      put('faq', good.faq.replace('<style id="page-css">\n', '<style id="page-css">\n/* hand edit */\n'));
      assert.equal(run('--check').status, 1, 'a hand edit must fail');
      put('faq', good.faq.replace(/'sha256-[^']+'/, "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='"));
      assert.equal(run('--check').status, 1, 'a wrong hash must fail');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it('documents in the generator\'s own usage note that css/pages.css and css/guides.css (not only css/site.css) are inlined, and what to run after editing them', () => {
    const head = read('scripts/inline-page-css.js').slice(0, read('scripts/inline-page-css.js').indexOf("'use strict';"));
    assert.ok(/AFTER EDITING css\/pages\.css OR css\/guides\.css \(or css\/site\.css\), RUN THIS SCRIPT/.test(head));
    assert.ok(/css\/guides\.css only in the three \/guides\/ pages/.test(head) && /scripts\/inline-site-css\.js/.test(head));
    assert.ok(/css\/site\.css css\/pages\.css css\/guides\.css/.test(head), 'the guide marker is shown');
  });

  it('is run by the commit gate: CHECK 9 calls --check, walks the content folders for a missing block, and refuses a stylesheet <link> or a missing late-fonts script', () => {
    const ci = read('scripts/ci-invariants.sh');
    assert.ok(ci.includes('node scripts/inline-page-css.js --check'));
    assert.ok(/FIRST PAINT/.test(ci) && ci.includes('find services work areas-we-serve faq guides products catalogue -name index.html'), 'the folders are walked, not only listed');
    assert.ok(ci.includes('PAGE-CSS:START') && ci.includes('/js/late-fonts.js'));
    assert.ok(ci.indexOf('# FIRST-PAINT:BEGIN') > 0 && ci.indexOf('# FIRST-PAINT:END') > ci.indexOf('# FIRST-PAINT:BEGIN'), 'the markers the next test slices the check out with');
    assert.ok(/page_head\(\)/.test(ci) && /page_head "\$sp"/.test(ci), 'the content pages\' pricing-token scan skips the generated inline stylesheet');
  });

  it('refuses, in CHECK 9 itself (its FIRST PAINT code run against scratch trees), a page with no block, a stylesheet or preload link, no late-fonts script, a missing or wrong <noscript> fonts link, a script without defer, a stale block, a new untreated page, a missing page and an unreadable font URL — and passes the real pages', () => {
    const ci = read('scripts/ci-invariants.sh');
    const a = ci.indexOf('# FIRST-PAINT:BEGIN'), b = ci.indexOf('# FIRST-PAINT:END');
    assert.ok(a > 0 && b > a);
    const lists = ci.split('\n').filter((l) => /^(SEO_PAGES|PRODUCT_PAGES)='/.test(l)).join('\n');
    assert.equal(lists.split('\n').length, 2, 'SEO_PAGES and PRODUCT_PAGES are one line each');
    const script = `${lists}\ncat_fail=0\n${ci.slice(a, b)}\necho "cat_fail=$cat_fail"\n`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-first-paint-ci-'));
    try {
      for (const d of ['scripts', 'css', 'js']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'scripts/inline-page-css.js'), path.join(tmp, 'scripts/inline-page-css.js'));
      fs.copyFileSync(path.join(ROOT, 'js/late-fonts.js'), path.join(tmp, 'js/late-fonts.js'));
      for (const c of ['site', 'pages', 'guides']) fs.writeFileSync(path.join(tmp, `css/${c}.css`), read(`css/${c}.css`));
      for (const p of PAGES) { fs.mkdirSync(path.dirname(path.join(tmp, p.file)), { recursive: true }); fs.writeFileSync(path.join(tmp, p.file), p.html); }
      const run = () => { const r = spawnSync('bash', ['-c', script], { cwd: tmp, encoding: 'utf8' }); return r.stdout + r.stderr; };
      const good = run();
      assert.match(good, /PASS: all \d+ static pages/, good);
      assert.ok(!/FAIL/.test(good) && /cat_fail=0/.test(good), 'the real pages must pass CHECK 9\'s first-paint code');
      const tryIt = (label, file, fn, expect) => {
        const f = path.join(tmp, file), had = fs.existsSync(f), t = had ? fs.readFileSync(f, 'utf8') : '';
        fs.mkdirSync(path.dirname(f), { recursive: true });
        const next = fn(t); if (next === null) fs.rmSync(f); else fs.writeFileSync(f, next);
        const out = run();
        if (had) fs.writeFileSync(f, t); else fs.rmSync(f, { force: true });
        assert.ok(/cat_fail=1/.test(out), `${label}: CHECK 9 did not fail`);
        assert.match(out, expect, `${label}: the wrong message\n${out}`);
      };
      const block = (h) => h.slice(h.indexOf('<!-- PAGE-CSS:START '), h.indexOf('<!-- PAGE-CSS:END -->') + '<!-- PAGE-CSS:END -->'.length);
      const FAQ = fileOf('/faq/'), GUIDE = fileOf('/guides/ss304-vs-ss316-stainless-steel/'), PROD = fileOf('/products/stainless-steel-sinks/');
      tryIt('no block (and no link)', FAQ, (h) => h.replace(block(h) + '\n', ''), /FAIL: faq\/index\.html has no PAGE-CSS block/);
      tryIt('a stylesheet link', FAQ, (h) => h.replace('</head>', '<link rel="stylesheet" href="/css/pages.css">\n</head>'), /FAIL: faq\/index\.html has a <link> that loads a stylesheet/);
      tryIt('a stylesheet link, attributes reversed', GUIDE, (h) => h.replace('</head>', '<link href="/css/guides.css" rel=stylesheet>\n</head>'), /FAIL: guides\/ss304-vs-ss316-stainless-steel\/index\.html has a <link> that loads a stylesheet/);
      tryIt('a preload', PROD, (h) => h.replace('</head>', '<link rel="preload" as="style" href="/css/site.css">\n</head>'), /FAIL: products\/stainless-steel-sinks\/index\.html has a <link> that loads a stylesheet or preloads/);
      tryIt('no late-fonts script', FAQ, (h) => h.replace('<script defer src="/js/late-fonts.js"></script>\n', ''), /FAIL: faq\/index\.html does not load <script defer src="\/js\/late-fonts\.js">/);
      tryIt('no <noscript> fonts link', GUIDE, (h) => h.replace(NOSCRIPT + '\n', ''), /FAIL: guides\/ss304-vs-ss316-stainless-steel\/index\.html has no <noscript>/);
      tryIt('a <noscript> link with another URL', FAQ, (h) => h.replace(NOSCRIPT, NOSCRIPT.replace('Fraunces', 'Merriweather')), /FAIL: faq\/index\.html has no <noscript>/);
      tryIt('site.js without defer', FAQ, (h) => h.replace('<script defer src="/js/site.js">', '<script src="/js/site.js">'), /FAIL: faq\/index\.html loads a script without defer/);
      tryIt('a hand-edited block', FAQ, (h) => h.replace('<style id="page-css">\n', '<style id="page-css">\n/* hand edit */\n'), /FAIL: faq\/index\.html: the inline <style id="page-css"> block or the CSP hash is stale/);
      tryIt('a stylesheet edited and not re-inlined', 'css/guides.css', (t) => t + '\n#site .zz{margin:0}\n', /FAIL: guides\/ss304-vs-ss316-stainless-steel\/index\.html: .*stale/);
      tryIt('a NEW page that was not given the treatment', 'services/zz-new/index.html', () => PAGES.find((p) => p.path === '/faq/').html.replace(block(PAGES.find((p) => p.path === '/faq/').html) + '\n', ''), /FAIL: services\/zz-new\/index\.html has no PAGE-CSS block/);
      tryIt('a page that went missing', FAQ, () => null, /FAIL: only \d+ index\.html files found/);
      tryIt('the font URL cannot be read from js/late-fonts.js', 'js/late-fonts.js', (t) => t.replace('var URL =', 'var FONTS ='), /FAIL: cannot read the Google Fonts URL from js\/late-fonts\.js/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════�
describe('/catalogue/ (generated by scripts/build-catalogue.js) is on the same mechanism since 2026-10-29', () => {
  const cat = read('catalogue/index.html');
  const live = cat.replace(/<!--[\s\S]*?-->/g, '').replace(/<noscript>[\s\S]*?<\/noscript>/gi, '').replace(STYLE_RE, '');
  it('inlines css/site.css, css/catalogue.css and css/quote-request.css verbatim, in that order, with the hash in the CSP and no unsafe-inline', () => {
    assert.deepEqual(GEN.sourcesOf(cat), ['css/site.css', 'css/catalogue.css', 'css/quote-request.css']);
    const text = cat.match(STYLE_RE)[1];
    assert.equal(text, '\n' + ['css/site.css', 'css/catalogue.css', 'css/quote-request.css'].map((f) => read(f).replace(/\s+$/, '')).join('\n') + '\n');
    const csp = cat.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)[1];
    assert.ok(csp.includes(`style-src 'self' '${sha256(text)}' https://fonts.googleapis.com;`));
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp) && !/@import/i.test(text));
  });
  it('links no stylesheet or preload outside the one <noscript> fonts link, loads js/late-fonts.js deferred, and keeps the preconnect hints', () => {
    assert.deepEqual(tagsOf(live, 'link').filter((t) => /stylesheet|preload|modulepreload|prefetch/.test(t.attrs.rel || '')), []);
    assert.equal(tagsOf(live, 'style').length, 0);
    assert.ok(cat.includes(NOSCRIPT) && (cat.replace(/<!--[\s\S]*?-->/g, '').match(/<noscript>/g) || []).length === 1);
    assert.ok(cat.includes('<script defer src="/js/late-fonts.js"></script>'));
    assert.ok(cat.includes('<link rel="preconnect" href="https://fonts.googleapis.com">'));
    assert.ok(tagsOf(live, 'script').filter((s) => s.attrs.src).every((s) => 'defer' in s.attrs));
  });
  it('is found by the generator and survives a rebuild of its block (build-catalogue.js never touches the head styles)', () => {
    assert.ok(GEN.findPages().some((p) => p.file === 'catalogue/index.html'));
    assert.ok(!/PAGE-CSS|page-css|stylesheet/.test(read('scripts/build-catalogue.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  });
});
