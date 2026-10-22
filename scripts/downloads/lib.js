'use strict';
// scripts/downloads/lib.js — shared helpers for scripts/build-downloads.js: paths, image preparation, icons, the QR code, the Luzon map, and the page /
// document wrappers every document is built from. No prices, no peso amounts, no client names other than the two the owner allows (DMMMSU, ISPSC).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'downloads', 'src');
const IMG = path.join(SRC, 'img');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ───────────────────────────── the facts every document repeats (one place, so they cannot drift) ─────────────────────────────
const CO = {
  name: 'Barro Industries',
  legal: 'Barro Industries OPC',
  brand: 'Barro Kitchens',
  address: '21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila, Philippines',
  phone: '0927 683 6300',
  tel: '+639276836300',
  email: 'hello@barroindustries.com',
  site: 'barroindustries.com',
  siteUrl: 'https://barroindustries.com/',
  quoteUrl: 'https://barroindustries.com/catalogue/?quote=1',
  quoteText: 'barroindustries.com/catalogue/',
  briefUrl: 'https://barroindustries.com/sales/clientinformationrequest/',
  briefText: 'barroindustries.com/sales/clientinformationrequest/',
  messenger: 'https://m.me/barrokitchens',
  messengerText: 'm.me/barrokitchens',
  facebook: 'https://www.facebook.com/barrokitchens',
  facebookText: 'facebook.com/barrokitchens',
  tagline: 'Building the Future, Brick by Brick.',
  // copyright (owner approved 2026-10-22): the footer of every page, the back page, the PDF metadata and the XMP packet all use these
  footerCopy: '© 2026 Barro Industries OPC · barroindustries.com',
  permission: 'All photos, designs and content are our own work and may not be copied or reused without written permission.',
  rights: '© 2026 Barro Industries OPC (Barro Kitchens). All rights reserved. All photos, designs and content in this document are our own work and may not be copied or reused without written permission.',
};

// ───────────────────────────── images ─────────────────────────────
// Photographs are converted to JPEG (Chrome embeds a JPEG as it is, a WebP as raw pixels, which would triple the size). Sources: the site's project and product
// photographs and the logo. The images named own-* and restaurant-* were extracted ONCE from the owner's 2026-10-10 PDFs and are committed as they are (the build
// does not touch them); the restaurant photographs are shown without the client's name, and the one photograph of that set that carries an AI-tool watermark is not kept.
function photoManifest() {
  const m = [];
  // ispsc-01 is the homepage hero (the site copy has no visible mark): scripts/watermark-downloads.py builds and marks it, so it is not converted here
  for (const n of ['02', '03', '04', '05', '06', '07']) m.push([`ispsc-${n}.jpg`, `site/img/projects/ispsc/${n}.webp`, 1400, 74]);
  for (const n of ['01', '02', '03', '04', '05', '06']) m.push([`dmmmsu-${n}.jpg`, `site/img/projects/dmmmsu/${n}.webp`, 1400, 74]);
  m.push(['logo.jpg', 'icons/barro-kitchens.png', 480, 92]);
  const pdir = path.join(ROOT, 'site', 'img', 'products');
  if (fs.existsSync(pdir)) for (const f of fs.readdirSync(pdir).sort()) if (/\.webp$/.test(f) && !/-thumb\.webp$/.test(f)) m.push([`prod-${f.replace(/\.webp$/, '.jpg')}`, `site/img/products/${f}`, 800, 86]);
  return m;
}
function prepareImages({ force = false } = {}) {
  fs.mkdirSync(IMG, { recursive: true });
  let made = 0;
  for (const [out, from, max, q] of photoManifest()) {
    const src = path.join(ROOT, from), dst = path.join(IMG, out);
    if (!fs.existsSync(src)) throw new Error(`missing source image ${from}`);
    if (!force && fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs) continue;
    cp.execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(q), '-Z', String(max), src, '--out', dst], { stdio: 'ignore' });
    made++;
  }
  return made;
}
const img = (name) => `img/${name}`;

// ───────────────────────────── icons (24 x 24, stroke) ─────────────────────────────
const ICONS = {
  fork: '<path d="M6 3v6a2 2 0 0 0 4 0V3M8 3v18"/><path d="M17 3c-2.2 1.6-3 4-3 7h3v11"/>',
  cup: '<path d="M4.5 9h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M15.5 10H17a2.5 2.5 0 0 1 0 5h-1.5M8 4v2.5M11.5 4v2.5"/>',
  hotel: '<path d="M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 10h3a1 1 0 0 1 1 1v10M3 21h18M8.5 8h2M8.5 12h2M8.5 16h2"/>',
  hospital: '<path d="M4 21V9l8-6 8 6v12z"/><path d="M12 10v6M9 13h6"/>',
  school: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.2V16c2.4 2.2 9.6 2.2 12 0v-4.8"/>',
  flask: '<path d="M9 3h6M10 3v6L5 19a1.6 1.6 0 0 0 1.4 2.2h11.2A1.6 1.6 0 0 0 19 19l-5-10V3"/><path d="M7.6 15h8.8"/>',
  boxes: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  columns: '<path d="M3 9l9-5 9 5M5 9v9M10 9v9M14 9v9M19 9v9M3 20.5h18"/>',
  home: '<path d="M3 11l9-8 9 8M5 10v10.5h14V10M10 20.5v-6h4v6"/>',
  flame: '<path d="M12 3c.8 3.2 5.2 5 5.2 10a5.2 5.2 0 0 1-10.4 0c0-2.2 1-3.4 2.2-4.4.1 2 1 3 2 3.4-.6-3.2-.8-6 1-9z"/>',
  wind: '<path d="M3 8h10.5a3 3 0 1 0-3-3M3 12h15.5a3 3 0 1 1-3 3M3 16h7"/>',
  shield: '<path d="M12 3 5 6v5.2c0 4.3 2.9 7.7 7 9.8 4.1-2.1 7-5.5 7-9.8V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  drop: '<path d="M12 3s6.2 6.6 6.2 11.2a6.2 6.2 0 0 1-12.4 0C5.8 9.6 12 3 12 3z"/><path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.2l9 5 9-5M3 16.2l9 5 9-5"/>',
  clipboard: '<path d="M9 4h6v3H9zM7 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1"/><path d="M9 12h6M9 16h4"/>',
  pencil: '<path d="M4 20l1-4.2L16.2 4.6a1.6 1.6 0 0 1 2.3 0l.9.9a1.6 1.6 0 0 1 0 2.3L8.2 19z"/><path d="M14.5 6.4l3.1 3.1"/>',
  truck: '<path d="M3 6.5h11V16H3zM14 9.5h4l3 3.2V16h-7"/><circle cx="7.2" cy="18" r="1.7"/><circle cx="17.2" cy="18" r="1.7"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 9.8 17.4 6.2 14.7 6.3z"/><path d="M13.6 9.6 4.5 18.7a1.9 1.9 0 0 0 2.8 2.8l9.1-9.1"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v5H5.5a1.5 1.5 0 0 1-1.5-1.5zM20 14h-3v5h1.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  phone: '<path d="M5.5 4h3.6l1.8 4.6-2.3 1.5a10.6 10.6 0 0 0 4.9 4.9l1.5-2.3 4.6 1.8v3.6a2 2 0 0 1-2.2 2A15.7 15.7 0 0 1 3.5 6.2 2 2 0 0 1 5.5 4z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="M3.5 7l8.5 6.5L20.5 7"/>',
  pin: '<path d="M12 21.5s7-5.8 7-11.2a7 7 0 0 0-14 0c0 5.4 7 11.2 7 11.2z"/><circle cx="12" cy="10" r="2.6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.2 3.2 14.8 0 18M12 3c-3.2 3.2-3.2 14.8 0 18"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  ruler: '<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="M7 13l2.2 2.2M10 10l1.6 1.6M13 7l2.2 2.2"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
};
const iconDefs = () => `<svg class="defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('')}</svg>`;
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const icb = (name, cls = '') => `<span class="icb ${cls}">${ic(name)}</span>`;

// ───────────────────────────── the QR code (js/qrcode.js, MIT, the same generator the ops app uses; nothing is downloaded) ─────────────────────────────
function qrSvg(text) {
  const ctx = { window: {} };
  vm.runInNewContext(read('js/qrcode.js'), ctx);
  const q = ctx.qrcode(0, 'M');
  q.addData(String(text));
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (q.isDark(r, c)) { let e = c; while (e < n && q.isDark(r, e)) e++; d += `M${c} ${r}h${e - c}v1h-${e - c}z`; c = e; } else c++;
    }
  }
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${esc(text)}"><path d="${d}" fill="#0B1B3F"/></svg>`;
}

// ───────────────────────────── the Luzon map (the homepage's own schematic SVG) ─────────────────────────────
function luzonMap() {
  const h = read('index.html');
  const s = h.indexOf('<svg class="lz-svg"');
  const e = h.indexOf('</svg>', s) + 6;
  if (s < 0) throw new Error('the Luzon map is missing from index.html');
  return h.slice(s, e).replace(/\sdata-[a-z0-9-]+="[^"]*"/g, '').replace(/\sfocusable="false"/, '');
}
const LUZON = [
  ['North Luzon', ['Ilocos Sur', 'La Union', 'Baguio', 'La Trinidad']],
  ['Central Luzon', ['Tarlac', 'Pampanga', 'Bulacan', 'Iba, Zambales', 'Subic']],
  ['Metro Manila & South', ['Manila', 'Cavite', 'Laguna', 'Batangas']],
];

// ───────────────────────────── shared pieces of copy and markup ─────────────────────────────
const STEPS = [
  ['clipboard', 'Consultation &amp; site visit', 'We listen to your requirements and visit your site to take measurements.'],
  ['pencil', 'Design &amp; layout', 'We plan the layout and prepare drawings for your kitchen.'],
  ['layers', 'Fabrication', 'Built to order in SS304 or SS316, finished brushed, mirror or satin, with seams welded and ground smooth.'],
  ['truck', 'Delivery', 'Your finished equipment is delivered to your site.'],
  ['wrench', 'Installation &amp; commissioning', 'We install everything on site and commission it for use.'],
  ['headset', 'After-sales support', 'Service and support continue after handover.'],
];
const stepsHtml = (cls = '') => `<ol class="steps ${cls}">${STEPS.map(([, t, d], i) => `<li><span class="n">${i + 1}</span><div><b>${t}</b><p>${d}</p></div></li>`).join('')}</ol>`;
const proofBar = () => `<ul class="proof" aria-label="Key facts">
  <li><b><em>23</em> years</b><span>in business</span></li>
  <li><b>SS304 / SS316</b><span>High-quality, food-grade and laboratory-grade</span></li>
  <li><b>Made to order</b><span>Built to your exact dimensions</span></li>
  <li><b>End-to-end</b><span>Design · fabricate · deliver · install</span></li>
</ul>`;
const regs = (cls = '') => `<div class="pills ${cls}">${['PhilGEPS-registered', 'SEC-registered', 'VAT-registered'].map((t) => `<span class="pill">${ic('shield')}${t}</span>`).join('')}</div>`;
const warranty = () => `<div class="cols c2 gap4">
  <div class="card paper"><div class="fig4"><b>6</b><span>months</span></div><div class="h3">Service warranty</div><p>A 6-month service warranty on our equipment and work.</p></div>
  <div class="card paper"><div class="fig4"><b>12</b><span>months</span></div><div class="h3">Preventive maintenance</div><p>Full-kitchen projects include 12 months of preventive maintenance service (PMS) with KitchenShield™.</p></div>
</div>`;
const link = (href, text) => `<a href="${href}">${text}</a>`;


// the website's own alt text for each project photograph (also used as the caption)
const PROJ_ALT = {
  'ispsc-01': 'ISPSC 2026 — wide view of the cooking stations with range ovens, sinks and overhead hoods',
  'ispsc-02': 'ISPSC 2026 — rows of stainless-steel work tables in the school room',
  'ispsc-03': 'ISPSC 2026 — rows of stainless-steel work tables, wide view',
  'ispsc-04': 'ISPSC 2026 — stainless-steel work tables with the protective film still on',
  'ispsc-05': 'ISPSC 2026 — cooking station with range oven and sink',
  'ispsc-06': 'ISPSC 2026 — sink station with an overhead shelf',
  'ispsc-07': 'ISPSC 2026 — range with an overhead shelf',
  'dmmmsu-01': 'DMMMSU — finished commercial kitchen with range, hood and work tables',
  'dmmmsu-02': 'DMMMSU — room installed with stainless-steel tables, racks and shelving',
  'dmmmsu-03': 'DMMMSU — stainless-steel tables and racks installed in the room',
  'dmmmsu-04': 'DMMMSU — stainless-steel shelving and work tables after installation',
  'dmmmsu-05': 'DMMMSU — installed stainless-steel tables and racks, wide view',
  'dmmmsu-06': 'DMMMSU — close-up of a stainless-steel rack',
};
const projCap = (k) => PROJ_ALT[k].replace(/^(ISPSC 2026|DMMMSU) — /, (m) => m.replace(' — ', ': ')).replace(/^(\w)/, (c) => c.toUpperCase());

// ───────────────────────────── pages ─────────────────────────────
function runningHeader(docName) {
  return `<header class="rh"><span class="brand"><img src="${img('logo.jpg')}" alt=""><span class="bn"><b>${CO.name}</b><i>${CO.brand}™</i></span></span><span class="dn">${esc(docName)}</span></header>`;
}
const runningFooter = () => `<footer class="rf"><span>${CO.footerCopy}</span><span class="pn"></span></footer>`;
function page({ doc, cls = '', body, label }) {
  return `<section class="page ${cls}"${label ? ` data-label="${esc(label)}"` : ''}>${runningHeader(doc)}<div class="pc">${body}</div>${runningFooter()}</section>`;
}
function cover({ photo, edition, kicker, title, sub, footLeft, footRight, photoPos = 'center' }) {
  return `<section class="page cover" data-label="Cover">
  <div class="cv-photo"><img src="${img(photo)}" alt="" style="object-position:${photoPos}"></div>
  <div class="cv-top"><div class="cv-brand"><img src="${img('logo.jpg')}" alt=""><div><b>${CO.name}</b><i>${CO.brand}™</i></div></div><span class="cv-ed">${esc(edition)}</span></div>
  <div class="cv-body">
    <p class="eyebrow">${esc(kicker)}</p>
    <h1 class="cv-title">${title}</h1>
    <p class="cv-sub">${sub}</p>
    <div class="cv-foot"><span>${footLeft}</span><span>${footRight}</span></div>
    <p class="cv-copy">${CO.footerCopy}</p>
  </div>
</section>`;
}
// the closing page: contact details, the QR code to the website, the three ways to start
function contactPage({ doc, lead, label = 'Contact', photo = 'ispsc-01.jpg', photoAlt = 'ISPSC 2026 — wide view of the cooking stations with range ovens, sinks and overhead hoods', photoPos = '50% 55%' }) {
  const qr = qrSvg(CO.siteUrl);
  return `<section class="page dark" data-label="${label}">${runningHeader(doc)}<div class="pc">
  <p class="eyebrow">Contact</p>
  <h1 class="h1">Let’s plan your kitchen.</h1>
  <p class="lead">${lead}</p>
  <div class="cols c32 gap8 mt4 top">
    <ul class="contact-list">
      <li>${icb('pin')}<div><small>Address</small><span>${CO.address}</span></div></li>
      <li>${icb('phone')}<div><small>Phone</small><span>${link('tel:' + CO.tel, CO.phone)}</span></div></li>
      <li>${icb('mail')}<div><small>Email</small><span>${link('mailto:' + CO.email, CO.email)}</span></div></li>
      <li>${icb('globe')}<div><small>Website</small><span>${link(CO.siteUrl, CO.site)}</span></div></li>
      <li>${icb('chat')}<div><small>Message us on Messenger</small><span>${link(CO.messenger, CO.messengerText)}</span></div></li>
      <li>${icb('star')}<div><small>Facebook</small><span>${link(CO.facebook, CO.facebookText)}</span></div></li>
    </ul>
    <div class="c"><div class="qrbox">${qr}</div><p class="xs mt1" style="color:rgba(255,255,255,.75)">Scan to visit<br><b style="color:#fff">${CO.site}</b></p></div>
  </div>
  <div class="cols c3 gap4 mt4">
    <div class="card"><div class="num">01</div><div class="h3">Get a quote online</div><p>Choose your equipment and sizes and see an estimated range for your selection. No account needed.<br>${link(CO.quoteUrl, CO.quoteText)}</p></div>
    <div class="card"><div class="num">02</div><div class="h3">Send a project brief</div><p>For a larger project (a hospital, school, hotel or commissary), tell us about it before our site visit.<br>${link(CO.briefUrl, 'Project brief')}</p></div>
    <div class="card"><div class="num">03</div><div class="h3">Message us</div><p>Ask a question on Messenger, or call or email us. We will come back with a quotation.<br>${link(CO.messenger, CO.messengerText)}</p></div>
  </div>
  <div class="fill"><figure class="fig"><div class="ph-box"><img src="${img(photo)}" alt="${esc(photoAlt)}" style="object-position:${photoPos}"></div></figure></div>
  <div class="mt3">
    ${regs()}
    <p class="xs mt2" style="color:rgba(255,255,255,.72)">© 2026 ${CO.legal}. ${CO.brand} is a brand of ${CO.legal}. ${CO.address}</p>
    <p class="xs mt1" style="color:rgba(255,255,255,.72)">${CO.permission}</p>
    <p class="h2 mt2" style="color:#fff">${CO.tagline}</p>
  </div>
</div>${runningFooter()}</section>`;
}

// the whole document: head, icon symbols, the pages, and a self-check that runs only when the page is opened with #check (overflow, images, font)
function docHtml({ title, pages, noindex = true }) {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta name="author" content="${CO.legal}">
<meta name="copyright" content="${esc(CO.rights)}">
<!-- GENERATED by scripts/build-downloads.js from the repo's own data. Do not hand-edit: change the script or the data and run it again.
     Print design: downloads/src/print.css. Chrome turns this file into the PDF next to it (headless --print-to-pdf, A4). -->
<link rel="stylesheet" href="print.css">
</head>
<body>
${iconDefs()}
${pages.join('\n')}
<script>
(function () {
  if (location.hash !== '#check') return;
  function go() {
    var out = { pages: 0, overflow: [], images: [], font: false };
    document.querySelectorAll('.page').forEach(function (p, i) {
      out.pages++;
      var pc = p.querySelector('.pc');
      if (pc && (pc.scrollHeight > pc.clientHeight + 1 || pc.scrollWidth > pc.clientWidth + 1)) out.overflow.push({ page: i + 1, label: p.getAttribute('data-label') || '', scrollH: pc.scrollHeight, boxH: pc.clientHeight, scrollW: pc.scrollWidth, boxW: pc.clientWidth });
    });
    document.querySelectorAll('img').forEach(function (im) { if (!im.complete || im.naturalWidth === 0) out.images.push(im.getAttribute('src')); });
    out.font = document.fonts ? document.fonts.check('600 12px Fraunces') : true;
    var pre = document.createElement('pre'); pre.id = 'check-result'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () { setTimeout(go, 60); });
})();
</script>
</body>
</html>
`;
}

module.exports = { PROJ_ALT, projCap, ROOT, SRC, IMG, CO, esc, read, prepareImages, photoManifest, img, ic, icb, iconDefs, qrSvg, luzonMap, LUZON, STEPS, stepsHtml, proofBar, regs, warranty, link, page, cover, contactPage, docHtml, runningHeader, runningFooter };
