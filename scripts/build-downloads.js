#!/usr/bin/env node
'use strict';
/* scripts/build-downloads.js — regenerates the three downloadable PDFs of the public website:
 *
 *   downloads/barro-industries-company-profile.pdf   who we are, what we do, how we work, projects, areas, registrations, contact
 *   downloads/barro-industries-catalogue.pdf         the complete product catalogue: six configurable products, fixed equipment, kitchen systems, how to order
 *   downloads/barro-industries-portfolio.pdf         completed projects in depth (ISPSC 2026, DMMMSU 2022-2023) and one more shown without its client's name
 *
 * RUN:        node scripts/build-downloads.js              (all three)
 *             node scripts/build-downloads.js catalogue    (one: profile | catalogue | portfolio)
 *             node scripts/build-downloads.js --html-only  (write downloads/src/*.html, skip Chrome)
 *             node scripts/build-downloads.js --force-images
 *             node scripts/build-downloads.js --lenient    (while designing: print even if a page overflows; never use it for the files you commit)
 * NEEDS:      macOS (sips, to turn the site's WebP photographs into JPEG) and Google Chrome at /Applications/Google Chrome.app (or set CHROME=/path).
 *             Nothing is downloaded: the QR code comes from js/qrcode.js, Fraunces is embedded from downloads/src/fonts/ (SIL Open Font License).
 * HOW IT WORKS: each document is HTML + downloads/src/print.css, generated from the repo's own data (scripts/downloads/*.js; the catalogue from catalogue/index.html,
 *             js/qr-families.js and scripts/product-photos.json, so it follows the website), written next to the CSS as downloads/src/<name>.html, then printed by
 *             headless Chrome (A4, no browser header or footer; every page carries its own running header, footer and page number).
 *             Before printing, each page's content box is measured in Chrome and the build STOPS if anything overflows its A4 page. After printing, the page count
 *             is compared with the HTML, and the text of the PDF is scanned for the things the public site never says (prices, the partner company's name, a Gmail
 *             address, an old phone number or address, "Operating System", superlatives). tests/content-assets.test.mjs repeats those checks.
 * Re-run after changing: the catalogue (node scripts/build-catalogue.js first), the photographs, js/qr-families.js, or any wording in scripts/downloads/.
 * The images named own-* and restaurant-* in downloads/src/img/ were extracted once from the owner's 2026-10-10 PDFs and are not regenerated.
 * COPYRIGHT (owner approved 2026-10-22): every page carries "© 2026 Barro Industries OPC · barroindustries.com" and the back page says the photos, designs and content
 *             are ours and may not be copied or reused without written permission; scripts/downloads/pdf-meta.js writes Author / Creator / Producer = Barro Industries OPC,
 *             a Subject naming Barro Kitchens, Keywords, a Copyright line and an XMP packet (an incremental update: Chrome's bytes are untouched). The site photographs
 *             are converted from site/img (already marked by scripts/watermark-images.py); the hero photograph (ispsc-01), the restaurant photographs and the pictures
 *             from the catalogue PDF are marked by  python3 scripts/watermark-downloads.py  (the same look; masters stay in private/img-masters/downloads/).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('./downloads/lib');
const { pdfPages, compact } = require('./downloads/pdf-text');
const { stampPdf, readMeta } = require('./downloads/pdf-meta');

const ROOT = lib.ROOT;
const OUT = path.join(ROOT, 'downloads');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DOCS = {
  profile: { mod: './downloads/profile', html: 'company-profile.html', pdf: 'barro-industries-company-profile.pdf' },
  catalogue: { mod: './downloads/catalogue', html: 'catalogue.html', pdf: 'barro-industries-catalogue.pdf' },
  portfolio: { mod: './downloads/portfolio', html: 'portfolio.html', pdf: 'barro-industries-portfolio.pdf' },
};
const MAX_BYTES = 8 * 1024 * 1024;

// what a public PDF of ours must never contain (the tests carry the full list; this is the build's own early stop)
const NEVER = [
  [/brilliant\s*steel|barro\s*steel|vesta/i, 'a name the owner banned'],
  [/gmail|0960|san\s*fernando/i, 'an old contact detail'],
  [/₱|\bphp\s?\d|\bpesos?\b|\b\d{1,3}(,\d{3})+\b/i, 'a peso amount'],
  [/operat(?:ing|ions?)\s+system/i, 'the system'],
  [/#1\b|\bnumber one\b|\bleading\b|\bbest\b/i, 'a superlative'],
];

function chrome(args, opts = {}) {
  const udir = fs.mkdtempSync(path.join(os.tmpdir(), 'barro-dl-'));
  try {
    const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', `--user-data-dir=${udir}`, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 240000, ...opts });
    if (r.error) throw r.error;
    return r;
  } finally { fs.rmSync(udir, { recursive: true, force: true }); }
}
const fileUrl = (p) => 'file://' + p.split('/').map(encodeURIComponent).join('/').replace(/%3A/g, ':');

function build(key, { htmlOnly, lenient }) {
  const d = DOCS[key];
  const html = require(d.mod).build();
  const htmlPath = path.join(lib.SRC, d.html);
  fs.writeFileSync(htmlPath, html);
  const nPages = (html.match(/<section class="page\b/g) || []).length;
  console.log(`${key}: ${d.html} written (${nPages} pages)`);
  if (htmlOnly) return;

  // 1. measure: does anything overflow its page, did every image and the font load?
  const dom = chrome(['--dump-dom', '--virtual-time-budget=8000', fileUrl(htmlPath) + '#check']).stdout;
  const m = /<pre id="check-result">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) throw new Error(`${key}: the page check did not run`);
  const chk = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const problems = [];
  if (chk.pages !== nPages) problems.push(`Chrome sees ${chk.pages} pages, the HTML has ${nPages}`);
  for (const o of chk.overflow) problems.push(`page ${o.page} (${o.label}) overflows: content ${o.scrollH} x ${o.scrollW}, box ${o.boxH} x ${o.boxW}`);
  for (const i of chk.images) problems.push(`image did not load: ${i}`);
  if (!chk.font) problems.push('the Fraunces font did not load');
  if (problems.length && !lenient) throw new Error(`${key}: ${problems.join('\n  ')}`);
  if (problems.length) console.warn(`WARNING ${key}: ${problems.join('\n  ')}`);

  // 2. print
  const pdfPath = path.join(OUT, d.pdf);
  fs.mkdirSync(OUT, { recursive: true });
  const r = chrome(['--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, '--virtual-time-budget=8000', fileUrl(htmlPath)]);
  if (!fs.existsSync(pdfPath)) throw new Error(`${key}: Chrome wrote no PDF\n${r.stderr}`);

  // 3. copyright and document metadata (owner approved 2026-10-22): Author, Creator, Producer, Subject, Keywords, a Copyright line and an XMP packet
  const META = require(d.mod).META;
  stampPdf(pdfPath, { ...META, author: lib.CO.legal, creator: lib.CO.legal, producer: lib.CO.legal, rights: lib.CO.rights, usage: 'Reuse requires written permission. Contact ' + lib.CO.email + '.', webStatement: lib.CO.siteUrl + '#copyright' });
  const md = readMeta(pdfPath);
  if (md.author !== lib.CO.legal || md.creator !== lib.CO.legal || md.producer !== lib.CO.legal || !/Barro Kitchens/.test(md.subject) || !/©/.test(md.copyright) || !/xmpRights:Marked="True"/.test(md.xmp || '') || !md.startxrefOk) throw new Error(`${key}: the PDF metadata did not take`);

  // 4. verify what was written
  const size = fs.statSync(pdfPath).size;
  const pages = pdfPages(pdfPath);
  if (pages.length !== nPages) throw new Error(`${key}: the PDF has ${pages.length} pages, the HTML ${nPages}`);
  const text = pages.join('\n');
  const c = compact(text);
  if (!c.includes('21capricornsttandangsoraquezoncity') || !/hello@barroindustries\.com/.test(text.replace(/\s+/g, ''))) throw new Error(`${key}: the Quezon City address or the email is missing from the PDF text`);
  for (const [re, what] of NEVER) {
    const hit = re.exec(text) || re.exec(text.replace(/\s+/g, ''));
    if (hit) throw new Error(`${key}: the PDF text carries ${what}`);
  }
  if (!pages.every((p, i) => (i === 0 ? /© 2026 Barro Industries OPC/.test(p) : p.includes(lib.CO.footerCopy)))) throw new Error(`${key}: a page lacks the copyright footer`);
  if (!pages[pages.length - 1].replace(/\s+/g, ' ').includes(lib.CO.permission)) throw new Error(`${key}: the back page lacks the permission sentence`);
  if (size > MAX_BYTES) throw new Error(`${key}: ${(size / 1048576).toFixed(1)} MB is over the ${MAX_BYTES / 1048576} MB cap`);
  console.log(`${key}: ${d.pdf}  ${pages.length} pages  ${(size / 1048576).toFixed(2)} MB`);
}

function main() {
  const args = process.argv.slice(2);
  const htmlOnly = args.includes('--html-only');
  const keys = args.filter((a) => DOCS[a]);
  const todo = keys.length ? keys : Object.keys(DOCS);
  if (!htmlOnly && !fs.existsSync(CHROME)) throw new Error(`Google Chrome not found at ${CHROME} (set CHROME=/path/to/chrome)`);
  const made = lib.prepareImages({ force: args.includes('--force-images') });
  if (made) console.log(`images: ${made} converted into downloads/src/img/`);
  for (const k of todo) build(k, { htmlOnly, lenient: args.includes('--lenient') });
}
if (require.main === module) {
  try { main(); } catch (e) { console.error('FAIL: ' + e.message); process.exit(1); }
}
module.exports = { DOCS, MAX_BYTES };
