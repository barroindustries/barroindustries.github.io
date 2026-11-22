#!/usr/bin/env node
/**
 * add-ads-tag.js — puts the Google Ads conversion tag (js/ads-tag.js) on every PUBLIC page and widens each page's CSP for it. IDEMPOTENT: run it
 * again after adding or regenerating public pages (guides, products, services …); a page already in order is not touched.
 *
 *   node scripts/add-ads-tag.js            rewrite pages
 *   node scripts/add-ads-tag.js --check    exit 1 when a page is missing the tag or a CSP entry (writes nothing)
 *
 * Pages: every *.html under products/ services/ work/ areas-we-serve/ faq/ guides/ catalogue/ sales/clientinformationrequest/, plus 404.html.
 * Each gets <script src="/js/ads-tag.js" defer></script> right after its js/site.js tag (before </body> if it has none).
 * index.html is the website AND the staff app: it gets the CSP entries only — the website view loads the tag from js/site.js, the app views never do
 * (it must not appear in <template id="app-kit">).
 * CSP (only ever ADDS tokens; style-src is not touched, so scripts/inline-page-css.js and this never fight):
 *   script-src  + https://www.googletagmanager.com
 *   connect-src + https://www.google.com https://googleads.g.doubleclick.net https://www.googleadservices.com https://*.google.com
 *                 (created as 'self' + those when the page has none — it would otherwise fall back to default-src 'self')
 *   img-src     + https://www.google.com https://googleads.g.doubleclick.net https://www.googleadservices.com   (skipped when img-src has https:)
 *   frame-src   'none' -> https://td.doubleclick.net https://www.googletagmanager.com ; 'self' -> 'self' + the same two
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TAG_LINE = '<script src="/js/ads-tag.js" defer></script>';
const CSP_RE = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)("\s*\/?>)/;
const DIRS = ['products', 'services', 'work', 'areas-we-serve', 'faq', 'guides', 'catalogue', 'sales/clientinformationrequest'];
const GTM = 'https://www.googletagmanager.com';
const CONNECT = ['https://www.google.com', 'https://googleads.g.doubleclick.net', 'https://www.googleadservices.com', 'https://*.google.com'];
const IMG = ['https://www.google.com', 'https://googleads.g.doubleclick.net', 'https://www.googleadservices.com'];
const FRAME = ['https://td.doubleclick.net', GTM];

function walk(dir, out) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.html')) out.push(rel);
  }
}
function pageList() {
  const out = [];
  DIRS.forEach((d) => walk(d, out));
  out.push('404.html');
  return out.filter((f) => fs.existsSync(path.join(ROOT, f)));
}

function widenCsp(csp) {
  const dirs = csp.split(';').map((x) => x.trim()).filter(Boolean).map((x) => x.split(/\s+/));
  const get = (n) => dirs.find((d) => d[0] === n);
  const addTo = (d, toks) => { for (const t of toks) if (!d.includes(t)) d.push(t); };
  const script = get('script-src');
  if (script) addTo(script, [GTM]); else dirs.push(['script-src', "'self'", GTM]);
  const conn = get('connect-src');
  if (conn) addTo(conn, CONNECT);
  else { const at = dirs.findIndex((d) => d[0] === 'frame-src'); dirs.splice(at < 0 ? dirs.length : at, 0, ['connect-src', "'self'", ...CONNECT]); }
  const img = get('img-src');
  if (img && !img.includes('https:')) addTo(img, IMG);
  const frame = get('frame-src');
  if (frame) {
    const i = frame.indexOf("'none'");
    if (i > 0) frame.splice(i, 1);
    addTo(frame, FRAME);
  }
  return dirs.map((d) => d.join(' ')).join('; ');
}

function fix(html, isIndex) {
  let out = html;
  const m = out.match(CSP_RE);
  if (!m) throw new Error('no Content-Security-Policy meta');
  out = out.replace(CSP_RE, (_, a, c, z) => a + widenCsp(c) + z);
  if (!isIndex && !out.includes('/js/ads-tag.js')) {
    const site = out.match(/<script defer src="\/js\/site\.js"><\/script>\n?/);
    if (site) out = out.replace(site[0], (x) => x + TAG_LINE + '\n');
    else if (out.includes('</body>')) out = out.replace('</body>', TAG_LINE + '\n</body>');
    else throw new Error('no place for the tag');
  }
  return out;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  let changed = 0, bad = 0;
  const files = pageList().map((f) => [f, false]).concat([['index.html', true]]);
  for (const [f, isIndex] of files) {
    const abs = path.join(ROOT, f);
    const before = fs.readFileSync(abs, 'utf8');
    let after;
    try { after = fix(before, isIndex); } catch (e) { console.error('FAIL: ' + f + ': ' + e.message); bad++; continue; }
    if (after !== before) { changed++; if (check) console.error('STALE: ' + f); else fs.writeFileSync(abs, after); }
  }
  console.log((check ? 'checked ' : 'updated ') + files.length + ' page(s); ' + changed + (check ? ' need' : ' changed') + ' the ads tag');
  process.exit(bad || (check && changed) ? 1 : 0);
}
module.exports = { fix, widenCsp, pageList, TAG_LINE };
