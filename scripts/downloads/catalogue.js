'use strict';
// scripts/downloads/catalogue.js — the product catalogue (about 23 A4 pages), generated from the website's own data so it follows the site:
//   · the eleven configurable products: js/qr-families.js (options, size limits), the catalogue page's cards (the specification lines), scripts/product-photos.json
//     and site/img/products (representative photographs), and the website configurator's own drawing code (js/qr-preview.js, run here with a tiny DOM shim);
//   · the fixed equipment, by category: every card of catalogue/index.html (code, name, size, notes and specifications in full — the owner's rule);
//   · the kitchen systems (exhaust and fresh air, LPG gas line, fire suppression): the wording of the three service pages, which carry the "standard example" of
//     the owner's 2026 catalogue (no prices, no compliance claims).
// NO prices anywhere: the catalogue page is already stripped of them, the family data holds none, and the build's text scan refuses any.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const L = require('./lib');
const { CO, img, ic, icb, esc, link } = L;

const DOC = 'Product catalogue';
const META = {
  title: `Product catalogue | ${CO.name}`,
  subject: `${CO.brand} by ${CO.name}: product catalogue, 2026 edition.`,
  keywords: `${CO.name}, ${CO.brand}, product catalogue, commercial kitchen equipment, stainless steel, SS304, SS316, Philippines`,
};
const PF = require(path.join(L.ROOT, 'js', 'product-families.js'));
const QF = require(path.join(L.ROOT, 'js', 'qr-families.js'));
const CAT_LABEL = { preparation: 'Preparation', washing: 'Washing', cooking: 'Cooking', ventilation: 'Ventilation', storage: 'Storage', refrigeration: 'Refrigeration' };
// The standard construction of the made-to-order pieces (owner ruling 2026-10-28): the very sentence of the website's /products/ page, under "Two grades, three finishes".
// (Each family's own line — PF.constructionLine — reaches the family pages through the catalogue page's cards.) tests/content-assets.test.mjs pins the two together.
const CONSTRUCTION_NOTE = 'Made-to-order tables, sinks and stoves have a 1.5 mm (16 gauge) top plate; bodies and shelving are 1.2 mm; floor-standing pieces stand on square-tube posts with adjustable bullet feet.';

const dec = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

// ───────────────────────────── the website's catalogue page → data ─────────────────────────────
function loadCatalogue() {
  const html = L.read('catalogue/index.html');
  const s = html.indexOf('<!-- CATALOGUE:START'), e = html.indexOf('<!-- CATALOGUE:END');
  if (s < 0 || e < 0) throw new Error('catalogue/index.html has no CATALOGUE block');
  const block = html.slice(s, e);
  const families = {}, fixed = { cooking: [], refrigeration: [], other: [] };
  for (const g of block.matchAll(/<section class="cat-group" id="cat-([a-z_]+)"[\s\S]*?<\/section>/g)) {
    const cat = g[1];
    for (const c of g[0].matchAll(/<li class="cat-card([^"]*)"([^>]*)>([\s\S]*?)<\/li>(?=\s*(?:<li class="cat-card|<\/ul>))/g)) {
      const body = c[3];
      const get = (re) => { const m = re.exec(body); return m ? dec(m[1]) : ''; };
      const imgSrc = (/<img src="([^"]+)"/.exec(body) || [])[1];
      const photo = imgSrc ? 'prod-' + path.basename(imgSrc).replace(/-thumb\.webp$/, '.webp').replace(/\.webp$/, '.jpg') : '';
      const specs = [...body.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map((m) => [dec(m[1]), dec(m[2])]);
      const fam = (/data-family="([^"]+)"/.exec(c[2]) || [])[1];
      if (fam) { families[fam] = { name: get(/<h3>([^<]*)<\/h3>/), lead: get(/<p class="cat-lead">([^<]*)<\/p>/), specs, photo }; continue; }
      const item = { cat, code: get(/<p class="cat-code[^"]*">([^<]*)<\/p>/), name: get(/<h3>([^<]*)<\/h3>/), meta: get(/<p class="cat-meta">([^<]*)<\/p>/), notes: get(/<p class="cat-notes">([^<]*)<\/p>/), specs, photo };
      (fixed[cat] || fixed.other).push(item);
    }
  }
  return { families, fixed };
}
const havePhoto = (name) => name && fs.existsSync(path.join(L.IMG, name));

// photographs of a family: its own card photo first, then those of the products it absorbs (scripts/product-photos.json), no more than three
function familyPhotos(famId, cardPhoto) {
  const map = JSON.parse(L.read('scripts/product-photos.json'));
  const out = [];
  const push = (n) => { if (havePhoto(n) && !out.includes(n)) out.push(n); };
  push(cardPhoto);
  for (const sku of Object.keys(QF.families[famId].absorbed || {})) if (map[sku]) push('prod-' + path.basename(map[sku]).replace(/\.webp$/, '.jpg'));
  return out.slice(0, 3);
}

// ───────────────────────────── the configurator's drawings (js/qr-preview.js with a DOM shim) ─────────────────────────────
function makeDrawer() {
  class El {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this._text = ''; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    appendChild(c) { this.children.push(c); return c; }
    set textContent(t) { this._text = String(t); this.children = []; }
    get textContent() { return this._text; }
    set className(v) { this.attrs.class = v; }
    toString() {
      const a = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
      return `<${this.tag}${a}>${this._text ? esc(this._text) : this.children.map(String).join('')}</${this.tag}>`;
    }
  }
  const document = { createElementNS: (ns, tag) => new El(tag), createElement: (tag) => new El(tag) };
  const win = { ProductFamilies: PF, matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(L.read('js/qr-preview.js'), { window: win, document });
  const QP = win.QR_PREVIEW;
  return (famId, cfg) => {
    const fam = QF.families[famId];
    const v = PF.validateConfiguration(fam, cfg);
    if (!v.ok) throw new Error(`catalogue drawing: ${famId} ${JSON.stringify(cfg)} is not a valid configuration (${v.errors})`);
    const svg = QP.placeholder(fam, v.config);
    const art = svg.children.find((c) => c.attrs.class === 'qr-pv-art');
    const inner = String(art).replace(/qr-pv-/g, 'pv-');
    const vb = ['stove', 'wok_range', 'dish_table'].includes(famId) ? '20 52 360 176' : '52 52 296 176';
    return { svg: `<svg viewBox="${vb}" role="img" aria-label="${esc(PF.summaryParts(fam, v.config).join(', '))}">${inner}</svg>`, caption: PF.summaryParts(fam, v.config).join(' · ') };
  };
}
// three layouts per family, from the simplest to the fullest
const VARIANTS = {
  prep_table: [{ layers: 1, upper: 0 }, { layers: 2, upper: 1 }, { layers: 3, upper: 2 }],
  sink: [{ basins: 1, alignment: 'center', undershelf: true, upper: false, faucet: 'gooseneck' }, { basins: 2, alignment: 'left', undershelf: true, upper: false, faucet: 'prerinse' }, { basins: 3, alignment: 'center', undershelf: false, upper: true, faucet: 'gooseneck' }],
  stove: [{ positions: ['lp_small', 'lp_small'], addons: [] }, { positions: ['hp_large', 'hp_large', 'hp_small', 'hp_small'], addons: ['oven'] }, { positions: ['wok', 'hp_large', 'hp_large'], addons: ['griddle'] }],
  cabinet: [{ type: 'floor', doors: 'swing', shelves: 3 }, { type: 'floor', doors: 'sliding', shelves: 2 }, { type: 'wall', doors: 'swing', shelves: 1 }, { type: 'wall', doors: 'sliding', shelves: 2 }],
  wall_shelf: [{ tiers: 1, surface: 'solid' }, { tiers: 2, surface: 'slotted' }, { tiers: 3, surface: 'solid' }],
  rack: [{ tiers: 3, wheels: false }, { tiers: 4, wheels: true }, { tiers: 6, wheels: true }],
  // the five of 2026-10-28 (CONFIGURATOR-FAMILIES-2-SPEC): the dish table, wok range and deck oven have no photograph, so each has four layouts (the first is its main picture)
  dish_table: [{ side: 'clean', hand: 'left', sink: 'none', undershelf: true }, { side: 'soiled', hand: 'left', sink: 'prerinse', undershelf: true }, { side: 'clean', hand: 'right', sink: 'none', undershelf: false }, { side: 'soiled', hand: 'right', sink: 'none', undershelf: true }],
  wok_range: [{ holes: 1, rear: false, faucet: 'none' }, { holes: 2, rear: true, faucet: 'none' }, { holes: 3, rear: false, faucet: 'swan' }, { holes: 3, rear: true, faucet: 'swan' }],
  cooking_line: [{ type: 'griddle', burners: 2, baskets: 2, base: 'stand' }, { type: 'griller', burners: 3, baskets: 2, base: 'shelf' }, { type: 'fryer', burners: 1, baskets: 3, base: 'stand' }, { type: 'combi', burners: 1, baskets: 2, base: 'shelf' }],
  deck_oven: [{ decks: 1, trays: 3, stand: 'none' }, { decks: 2, trays: 3, stand: 'heavy' }, { decks: 3, trays: 6, stand: 'heavy' }, { decks: 2, trays: 6, stand: 'none' }],
  hood: [{ type: 'wall', filters: 'baffle', lighting: true }, { type: 'island', filters: 'baffle', lighting: true }, { type: 'slim', filters: 'baffle', lighting: false }, { type: 'wall', filters: 'none', lighting: false }],
};
// a project photograph that shows the product at work (the website's own photographs and captions)
// (the hoods overhead and a griller beside a range really are the product; the dish table, wok range and deck oven have no project photograph of their own, so their block
// says what its photograph does show, as their website pages do: work tables, a gas cooking line, range ovens)
const IN_PROJECTS = { prep_table: 'ispsc-03', sink: 'ispsc-05', stove: 'ispsc-01', cabinet: 'dmmmsu-02', wall_shelf: 'dmmmsu-04', rack: 'dmmmsu-03', dish_table: 'ispsc-03', wok_range: 'ispsc-05', cooking_line: 'dmmmsu-01', deck_oven: 'dmmmsu-01', hood: 'ispsc-01' };
const IN_PROJECTS_POS = { stove: '50% 40%', sink: '50% 60%', dish_table: '50% 82%', wok_range: '50% 62%', cooking_line: '50% 62%', deck_oven: '50% 62%', hood: '50% 12%' };
const IN_PROJECTS_LABEL = { dish_table: 'Tables in our projects', wok_range: 'Gas cooking lines in our projects', deck_oven: 'Range ovens in our projects' };

const dimWords = (fam) => { const w = Object.values(fam.dims).map((d) => d.label.toLowerCase()); return w.length === 1 ? w[0] : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`; };
// a family whose width is LOCKED by an option says so instead of printing the range its schema allows (the deck oven: 700 mm for three trays per deck, 1200 mm for six)
const LOCKED_SIZE = { deck_oven: 'Width 700 mm with three trays per deck, 1200 mm with six' };
const sizeLine = (fam) => {
  if (LOCKED_SIZE[fam.id]) return LOCKED_SIZE[fam.id] + '.';
  const d = fam.dims, keys = Object.keys(d);
  const range = keys.map((k) => `${d[k].label} ${d[k].min}–${d[k].max}`).join(' · ');
  const def = keys.map((k) => d[k].default).join(' × ');
  return `${range} mm. Default ${def} mm.`;
};

// ───────────────────────────── pages ─────────────────────────────
function familyPage(fam, card, draw) {
  const photos = familyPhotos(fam.id, card.photo);
  // The rows are the website card's own, in its own order — the options, Size, Construction (the standard build: top plate, body, posts), Material — and each one is
  // shown in full. Only the Size row is the PDF's own, with the size limits; it takes the place of the card's Size row. Each row sits a little tighter than print.css's
  // default: with the Construction row (three lines) a sink page carries eight rows, and it must still end on its own A4 page with the project photograph.
  const optRow = (label, valueHtml) => `<div><dt style="padding-top:1.5mm">${esc(label)}</dt><dd style="margin:.4mm 0 1.9mm">${valueHtml}</dd></div>`;
  if (!card.specs.some(([k]) => k === 'Size')) throw new Error(`catalogue/index.html: the ${fam.id} card has no Size row`);
  const optRows = card.specs.map(([k, v]) => (k === 'Size'
    ? optRow('Size', `Made to your ${dimWords(fam)}<br><span class="xs muted" style="font-weight:400">${esc(sizeLine(fam))}</span>`)
    : optRow(k, esc(v))));
  const slots = fam.groups.find((g) => g.type === 'slots');
  if (slots) optRows.splice(1, 0, optRow('Burner types', slots.options.map((o) => esc(o.l)).join(' · ')));
  const main = photos[0]
    ? `<div class="white-ph" style="height:${photos.length > 1 ? 58 : 92}mm"><img src="${img(photos[0])}" alt="${esc(fam.label)}, representative image"></div><p class="cap">Representative image</p>`
    : `<div class="pv" style="padding:4mm">${draw(fam.id, VARIANTS[fam.id][0]).svg}</div><p class="cap">Illustration</p>`;
  const thumbs = photos.length > 1 ? `<div class="cols c2 gap3 mt1">${photos.slice(1).map((p) => `<div class="white-ph" style="height:26mm"><img src="${img(p)}" alt=""></div>`).join('')}</div>` : '';
  const proj = IN_PROJECTS[fam.id];
  const noPhoto = !photos[0];
  const variants = noPhoto ? VARIANTS[fam.id].slice(1, 4) : VARIANTS[fam.id].slice(0, 3);
  const dr = variants.map((cfg) => { const d = draw(fam.id, cfg); return `<div><div class="pv">${d.svg}</div><p class="cap">${esc(d.caption)}</p></div>`; }).join('');
  const projBlock = proj
    ? `<div class="fill"><p class="h4">${esc(IN_PROJECTS_LABEL[fam.id] || 'Seen in our projects')}</p><figure class="fig mt1"><div class="ph-box"><img src="${img(proj + '.jpg')}" alt="${esc(L.PROJ_ALT[proj])}" style="object-position:${IN_PROJECTS_POS[fam.id] || '50% 50%'}"></div><figcaption>${esc(L.projCap(proj))}</figcaption></figure></div>`
    : '<div class="fill"></div>';
  return L.page({ doc: DOC, label: fam.label, body: `
    <p class="eyebrow">Configurable product · ${CAT_LABEL[fam.category] || ''}</p>
    <h1 class="h1">${esc(fam.label)}</h1>
    <p class="lead">${esc(fam.description)}</p>
    <div class="cols c2 gap8 mt3 top">
      <div>${main}${thumbs}</div>
      <dl class="opt">${optRows.join('')}</dl>
    </div>
    <p class="h4 mt3">Layouts at a glance</p>
    <div class="cols c3 gap4 mt1">${dr}</div>
    ${projBlock}
    <div class="band mt2" style="padding:4mm 6mm;display:flex;align-items:center;justify-content:space-between;gap:6mm"><span class="sm" style="color:#fff">Set up your ${esc(fam.label.toLowerCase())} online and add it to your quote request.</span><span class="sm" style="color:var(--goldlite);white-space:nowrap">${link(CO.quoteUrl, CO.quoteText)}</span></div>` });
}

function eqCard(it) {
  const ph = havePhoto(it.photo);
  const specs = it.specs.length ? `<p class="lbl">Specifications</p><p class="spl">${it.specs.map(([k, v]) => `<span>${esc(k)}</span> ${esc(v)}`).join(' · ')}</p>` : '';
  const notes = it.notes ? `<p class="lbl">Notes</p><p class="notes">${esc(it.notes)}</p>` : '';
  const text = `<p class="code">${esc(it.code)}</p><h4>${esc(it.name)}</h4>${it.meta ? `<p class="meta">${esc(it.meta)}</p>` : ''}${notes}${specs}`;
  return `<div class="eqc${ph ? ' has-ph' : ''}">${ph ? `<div class="ph-s"><img src="${img(it.photo)}" alt=""></div><div class="eqt">${text}</div>` : text}</div>`;
}
function fixedPage({ title, kicker, lead, items, extra = '' }) {
  return L.page({ doc: DOC, label: title, body: `
    <p class="eyebrow">${kicker}</p>
    <h1 class="h1">${title}</h1>
    <p class="lead">${lead}</p>
    <div class="eq mt3">${items.map(eqCard).join('')}</div>
    ${extra}` });
}

// the three kitchen-system pages (the wording of the website's service pages)
const sysList = (items) => `<ul class="dots mt1">${items.map(([t, d]) => `<li><b>${t}.</b> ${d}</li>`).join('')}</ul>`;
const example = (title, lead, rows) => `<div class="card paper"><p class="h4">A standard example</p><div class="h2 mt1" style="font-size:12.5pt">${title}</div><p class="sm muted mt1" style="font-size:8.4pt;max-width:150mm">${lead}</p><div class="cols ${rows.length === 3 ? 'c3' : 'c2'} gap4 mt2">${rows.map(([k, v]) => `<div style="border-top:.25mm solid rgba(201,162,39,.6);padding-top:2mm"><p class="h4">${k}</p><p class="sm mt1" style="font-size:8.4pt">${v}</p></div>`).join('')}</div></div>`;
const DISCLAIMER = 'These dimensions and specifications are standard examples and are not exhaustive. All equipment can be custom-fabricated to meet your specific site requirements.';
const whiteFig = (name, cap, h) => `<figure><div class="white-ph" style="height:${h}mm"><img src="${img(name)}" alt="${esc(cap)}"></div><figcaption class="cap c">${cap}</figcaption></figure>`;
const stripFig = (name, alt, cap, pos) => `<div class="fill"><figure class="fig"><div class="ph-box"><img src="${img(name)}" alt="${esc(alt)}" style="object-position:${pos}"></div><figcaption>${cap}</figcaption></figure></div>`;

function systemsPages() {
  const exhaust = L.page({ doc: DOC, label: 'Exhaust and fresh-air systems', body: `
    <p class="eyebrow">Kitchen systems · 01</p>
    <h1 class="h1">Exhaust and fresh-air systems</h1>
    <p class="lead">A well-ventilated kitchen is essential for both safety and comfort. We design, fabricate and install exhaust hoods, ducting and fresh-air systems that remove smoke, grease and heat while keeping the air in your kitchen moving.</p>
    <div class="cols c32 gap8 mt3 top">
      <div>
        <p class="h4">Two paths, one balanced kitchen</p>
        <p class="sm mt1">A commercial kitchen ventilation system has two paths. A heavy-duty exhaust line removes heat, smoke and grease from over the cooking line. A fresh-air supply line replaces the air being pulled out, so the kitchen does not turn into a vacuum and the air circulates across its different zones through room diffusers.</p>
        <p class="sm">Because the two paths depend on each other, we plan the exhaust and the fresh-air supply as one system, together with your cooking line, gas line and fire suppression.</p>
        <p class="h4 mt3">What’s included</p>
        ${sysList([
    ['Stainless-steel range hoods', 'SS304 hoods over your cooking line, fitted with filters, lighting and integrated switch controls.'],
    ['Exhaust ducting and blower', 'Fully welded rectangular exhaust ducting powered by a centrifugal blower, with foil insulation and an access door for maintenance.'],
    ['Fresh-air ducting and blower', 'Fresh-air ducting with its own blower, integrated into the hood and distributed through room diffusers.'],
    ['Room diffusers', 'Square louvered diffusers that spread the fresh air across the zones of your kitchen.'],
    ['Site assessment and layout', 'We assess your site, customise the system to suit your kitchen and prepare drawings.'],
    ['Installation and commissioning', 'We deliver, install and commission the system on site.'],
  ])}
      </div>
      <div>
        ${whiteFig('own-hoods.jpg', 'Hoods with their ducting (representative image)', 50)}
        <p class="h4 mt3">The main components</p>
        <div class="cols c2 gap3 mt1">
          ${whiteFig('prod-stainless-steel-range-hood.jpg', 'Stainless-steel range hood', 24)}
          ${whiteFig('prod-stainless-steel-ducting.jpg', 'Ducting sections with elbows', 24)}
          ${whiteFig('own-inline-fan.jpg', 'In-line ceiling exhaust fan for rectangular duct', 24)}
          ${whiteFig('prod-square-louvered-diffusers.jpg', 'Square louvered diffuser', 24)}
        </div>
      </div>
    </div>
    <div class="mt3">${example('A dual-path ventilation system', 'One standard example from our 2026 kitchen catalogue. Every system is custom-fabricated to meet the requirements of your site.', [['Hood', 'A 4-metre SS304 stainless-steel range hood with filters, lighting and integrated switch controls.'], ['Exhaust', 'A 10-metre rectangular duct of fully welded BI sheet, powered by a 3HP centrifugal blower, with foil insulation and an access door for maintenance.'], ['Fresh air', 'A 15-metre GI (galvanised iron) duct system with a 3HP blower, integrated into the hood and distributed through about 8 room diffusers.']])}</div>
    <p class="xs muted mta">${DISCLAIMER} Images are representative.</p>` });

  const gas = L.page({ doc: DOC, label: 'LPG gas line installation', body: `
    <p class="eyebrow">Kitchen systems · 02</p>
    <h1 class="h1">LPG gas line installation</h1>
    <p class="lead">A centralised and safe supply of fuel to your cooking equipment. We design, fabricate and install a fully welded gas line that runs from an external gas tank farm to the appliances on your cooking line, with safety controls built in.</p>
    <div class="cols c32 gap8 mt3 top">
      <div>
        <p class="h4">What’s included</p>
        ${sysList([
    ['Gas tank farm', 'A secured cage in an external storage area, designed to hold your gas tanks.'],
    ['Piping network', 'Fully welded black iron (BI) pipes and fittings that carry the fuel into the kitchen and to your appliances.'],
    ['Safety controls', 'A gas leak detection system paired with an emergency auto-shutoff valve.'],
    ['Appliance connections', 'We connect your cooking equipment, such as stoves, to the gas line.'],
    ['Testing', 'We test the installation to make sure there are no leaks.'],
    ['Planned with your kitchen', 'The gas line is laid out with your cooking line and your exhaust system as part of one kitchen layout.'],
  ])}
      </div>
      <div>${whiteFig('own-gas-tank-farm.jpg', 'Gas tank farm (representative image)', 46)}
        <div class="cols c2 gap3 mt3">${whiteFig('own-gas-valve-a.jpg', 'Safety controls: a gas shut-off valve', 26)}${whiteFig('own-gas-valve-b.jpg', 'Safety controls: an automatic valve', 26)}</div>
      </div>
    </div>
    <div class="mt3">${example('A centralised gas line system', 'One standard example from our 2026 kitchen catalogue: a centralised and safe distribution of fuel to your high-pressure cooking equipment, moving from an external storage area to an internal network with built-in safety monitoring.', [['Gas tank farm', 'A secured cage designed to hold four 50 kg gas tanks.'], ['Piping network', 'Fully welded BI pipes and fittings for fuel transport.'], ['Safety controls', 'A gas leak detection system paired with an emergency auto-shutoff valve.']])}</div>
    ${stripFig('ispsc-05.jpg', L.PROJ_ALT['ispsc-05'], 'A gas range and sink at ISPSC (March 2026).', '50% 55%')}
    <p class="xs muted mt2">${DISCLAIMER} Images are representative.</p>` });

  const fire = L.page({ doc: DOC, label: 'Kitchen fire suppression', body: `
    <p class="eyebrow">Kitchen systems · 03</p>
    <h1 class="h1">Kitchen fire suppression</h1>
    <p class="lead">A wet chemical fire suppression system integrated with your range hood, designed to protect the cooking surface and the exhaust path. We supply, install and integrate it into your kitchen as part of the project.</p>
    <div class="cols c32 gap8 mt3 top">
      <div>
        <p class="h4">What a system includes</p>
        ${sysList([
    ['Wet chemical tank', 'The tank that stores the extinguishing agent for kitchen fires.'],
    ['Hood integration', 'Specialised hardware links the suppression discharge to the stainless-steel range hood.'],
    ['Detectors', 'Detectors that allow the system to operate automatically.'],
    ['Suppression line and cylinder', 'A suppression line and a suppression cylinder complete the layout.'],
    ['Manual pull', 'A manual pull for operating the system by hand.'],
    ['Installation and integration', 'We install the system and integrate it with your hood and the kitchen’s ventilation.'],
  ])}
      </div>
      <div>
        <div class="white-ph" style="height:58mm"><img src="${img('own-fire-diagram.jpg')}" alt="Diagram of possible fire suppression system components"></div>
        <p class="cap">Diagram of possible system components: duct, detector, detector line, suppression line, cylinder and manual pull (representative).</p>
      </div>
    </div>
    <div class="mt3">${example('A wet chemical suppression system', 'One standard example from our 2026 kitchen catalogue: a specialised system integrated directly into the kitchen’s ventilation to deal with grease fires and high-temperature hazards.', [['System', 'A wet chemical suppression system integrated with the range hood, to provide automatic fire extinguishing. It is designed to protect the cooking surface and the exhaust path.'], ['Agent', 'A 16 L wet chemical tank, the primary storage for the extinguishing agent.'], ['Hood integration', 'Specialised hardware linking the suppression discharge to the SS range hood.'], ['Components', 'Detectors, a suppression line, a manual pull and a suppression cylinder.']])}</div>
    ${stripFig('ispsc-01.jpg', L.PROJ_ALT['ispsc-01'], 'Overhead hoods above the cooking stations at ISPSC (March 2026).', '50% 22%')}
    <p class="xs muted mt2">${DISCLAIMER} Images are representative.</p>` });
  return { exhaust, gas, fire };
}

function build() {
  const data = loadCatalogue();
  const draw = makeDrawer();
  const fams = QF.order.map((id) => QF.families[id]);
  for (const f of fams) if (!data.families[f.id]) throw new Error(`catalogue/index.html has no card for the ${f.id} family`);

  // fixed equipment: ten cards to a page
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  const fixedPages = [];
  chunk(data.fixed.cooking, 10).forEach((items, i, all) => fixedPages.push({ cat: 'cooking', title: all.length > 1 ? `Cooking equipment ${i + 1} of ${all.length}` : 'Cooking equipment', kicker: 'Fixed equipment · Cooking', lead: 'Standard items for the cooking line, the bakery and the preparation kitchen, with their sizes, notes and specifications. Ask us for a quotation on any item.', items }));
  chunk(data.fixed.refrigeration, 10).forEach((items) => fixedPages.push({ cat: 'refrigeration', title: 'Refrigeration', kicker: 'Fixed equipment · Refrigeration', lead: 'Standard refrigeration equipment with its sizes, notes and specifications. Specifications are confirmed with you for each project.', items }));
  for (const k of Object.keys(data.fixed)) if (!['cooking', 'refrigeration'].includes(k) && data.fixed[k].length) fixedPages.push({ cat: k, title: CAT_LABEL[k] || k, kicker: `Fixed equipment · ${CAT_LABEL[k] || k}`, lead: 'Standard items with their sizes, notes and specifications. Ask us for a quotation on any item.', items: data.fixed[k] });

  // the page order, from which the contents list takes its numbers
  const ids = ['cover', 'contents', 'materials', 'glance', ...fams.map((f) => 'fam-' + f.id), ...fixedPages.map((p, i) => 'fixed-' + i), 'sys-exhaust', 'sys-gas', 'sys-fire', 'how', 'order', 'contact'];
  const no = (id) => ids.indexOf(id) + 1;
  const row = (t, id, sub) => `<li${sub ? ' class="sub"' : ''}>${sub ? '' : '<span class="no">&nbsp;</span>'}<span>${t}</span><i></i><b>${no(id)}</b></li>`;
  const pg = (p) => { const first = ids.indexOf('fixed-' + fixedPages.indexOf(p)) + 1; return first; };
  const firstOf = (cat) => fixedPages.findIndex((p) => p.cat === cat);
  const lastOf = (cat) => fixedPages.map((p) => p.cat).lastIndexOf(cat);
  const fixedRange = (cat) => { const a = no('fixed-' + firstOf(cat)), b = no('fixed-' + lastOf(cat)); return a === b ? `${a}` : `${a}–${b}`; };

  const pages = [];
  pages.push(L.cover({
    photo: 'dmmmsu-01.jpg', edition: '2026 edition', kicker: 'Product catalogue',
    title: '<span class="nowrap">Stainless-steel</span> kitchen equipment, made to order.',
    sub: 'Preparation · Washing · Cooking · Ventilation · Storage · Refrigeration, and the exhaust, gas and fire suppression systems that go with them.',
    footLeft: `<b>${CO.brand}™</b> by ${CO.name}`, footRight: `<b>${CO.site}</b>`, photoPos: '50% 55%',
  }));

  pages.push(L.page({ doc: DOC, label: 'Contents', body: `
    <p class="eyebrow">Welcome</p>
    <h1 class="h1">Equipment built to your specifications</h1>
    <p class="lead">Premium stainless-steel equipment in food-grade SS304 as standard, or laboratory-grade SS316, built to your specifications. Default sizes are in millimetres. Ask us for a quotation on any item.</p>
    <div class="mt3">${L.proofBar()}</div>
    <div class="cols c32 gap8 mt4 top">
      <div><p class="h4">Contents</p><ol class="toc mt1">
        ${row('Materials and finishes', 'materials').replace('<span class="no">&nbsp;</span>', '<span class="no">01</span>')}
        <li><span class="no">02</span><span>Configurable products</span><i></i><b>${no('glance')}–${no('fam-' + fams[fams.length - 1].id)}</b></li>
        ${fams.map((f) => row(esc(f.label), 'fam-' + f.id, true).replace('<li class="sub">', '<li class="sub" style="padding-top:.9mm;padding-bottom:.9mm">')).join('')}
        <li><span class="no">03</span><span>Fixed equipment</span><i></i><b>${no('fixed-0')}–${no('fixed-' + (fixedPages.length - 1))}</b></li>
        ${[...new Set(fixedPages.map((p) => p.cat))].map((c) => `<li class="sub"><span>${CAT_LABEL[c] || c}</span><i></i><b>${fixedRange(c)}</b></li>`).join('')}
        <li><span class="no">04</span><span>Kitchen systems</span><i></i><b>${no('sys-exhaust')}–${no('sys-fire')}</b></li>
        ${row('Exhaust and fresh-air systems', 'sys-exhaust', true)}${row('LPG gas line installation', 'sys-gas', true)}${row('Kitchen fire suppression', 'sys-fire', true)}
        ${row('How we work, warranty', 'how').replace('<span class="no">&nbsp;</span>', '<span class="no">05</span>')}
        ${row('How to order', 'order').replace('<span class="no">&nbsp;</span>', '<span class="no">06</span>')}
        ${row('Contact', 'contact').replace('<span class="no">&nbsp;</span>', '<span class="no">07</span>')}
      </ol></div>
      <div>
        <p class="h4">How to read this catalogue</p>
        <div class="tile-ic">${icb('sliders')}<div><div class="h3">Configurable products</div><p>Eleven products you set up yourself: choose the options, then your own size.</p></div></div>
        <div class="tile-ic">${icb('boxes')}<div><div class="h3">Fixed equipment</div><p>Standard items with their sizes, notes and specifications.</p></div></div>
        <div class="tile-ic">${icb('wind')}<div><div class="h3">Kitchen systems</div><p>Exhaust and fresh air, LPG gas line and fire suppression, planned together with your cooking line.</p></div></div>
        <div class="note mt3">Ask us for a quotation on any item. Choose your equipment online and you will see an estimated range for your selection, then we send you the final quotation.</div>
      </div>
    </div>` }));

  // materials and finishes, and the size limits of the eleven products
  pages.push(L.page({ doc: DOC, label: 'Materials and finishes', body: `
    <p class="eyebrow">01 · Materials and finishes</p>
    <h1 class="h1">Two grades, three finishes</h1>
    <p class="lead">We work in two grades, food-grade SS304 as standard and laboratory-grade SS316 on request, in a brushed, mirror or satin finish. Seams are welded and ground smooth, and surfaces are polished to a professional finish.</p>
    <div class="cols c2 gap4 mt3 stretch">
      <div class="card"><p class="h4">Standard</p><div class="h3">SS304 food grade</div><p>Food-grade SS304 stainless steel is our standard for kitchens: preparation tables, sinks, cabinets, shelving and racks.</p></div>
      <div class="card"><p class="h4">On request</p><div class="h3">SS316 laboratory grade</div><p>Laboratory-grade SS316 stainless steel is available on request and suits laboratories and school science rooms.</p></div>
    </div>
    <div class="cols c3 gap4 mt3">
      <div><div class="sw brushed"></div><div class="h3 mt1">Brushed</div><p class="sm muted">A visible straight grain, the usual choice for work surfaces.</p></div>
      <div><div class="sw mirror"></div><div class="h3 mt1">Mirror</div><p class="sm muted">Polished to a high gloss, for decorative parts and low-contact areas.</p></div>
      <div><div class="sw satin"></div><div class="h3 mt1">Satin</div><p class="sm muted">A soft, low-sheen finish between brushed and mirror.</p></div>
    </div>
    <p class="xs muted mt1">The swatches are illustrations. Ask to see a sample before you decide.</p>
    <p class="xs muted mt3">Every configurable product is built to order in SS304 or SS316, in a brushed, mirror or satin finish. ${esc(CONSTRUCTION_NOTE)}</p>
    <div class="fill"><figure class="fig"><div class="ph-box"><img src="${img('ispsc-04.jpg')}" alt="${esc(L.PROJ_ALT['ispsc-04'])}"></div><figcaption>${esc(L.projCap('ispsc-04'))}</figcaption></figure></div>` }));

  // the eleven configurable products at a glance: what you choose and the size range online, one row each
  pages.push(L.page({ doc: DOC, label: 'Configurable products at a glance', body: `
    <p class="eyebrow">02 · Configurable products</p>
    <h1 class="h1">Eleven products, set up online</h1>
    <p class="lead">Choose the options, then your own size. Each product has a page of its own in this catalogue, with its options, its size limits and its layouts at a glance.</p>
    <p class="h4 mt4">The eleven configurable products at a glance</p>
    <table class="tb mt1">
      <thead><tr><th>Product</th><th>You choose</th><th>Online size range (mm)</th></tr></thead>
      <tbody>${fams.map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(data.families[f.id].specs.filter(([k]) => k !== 'Size' && k !== 'Construction' && k !== 'Material').map(([k, v]) => k.toLowerCase()).join(', '))}</td><td>${esc(LOCKED_SIZE[f.id] || Object.keys(f.dims).map((k) => `${f.dims[k].label} ${f.dims[k].min}–${f.dims[k].max}`).join(' · '))}</td></tr>`).join('')}</tbody>
    </table>
    <p class="xs muted mt1">Every configurable product is built to order in SS304 or SS316, in a brushed, mirror or satin finish. Need a different size? Ask us for a quotation built to your specifications.</p>
    <div class="fill"><figure class="fig"><div class="ph-box"><img src="${img('dmmmsu-01.jpg')}" alt="${esc(L.PROJ_ALT['dmmmsu-01'])}" style="object-position:50% 55%"></div><figcaption>${esc(L.projCap('dmmmsu-01'))}</figcaption></figure></div>` }));

  for (const f of fams) pages.push(familyPage(f, data.families[f.id], draw));

  fixedPages.forEach((p, i) => {
    const last = i === fixedPages.length - 1;
    pages.push(fixedPage({ ...p, extra: p.cat === 'refrigeration' ? `<div class="note mt3">Refrigeration capacities and layouts are confirmed with you for each project. Images are representative.</div><div class="fill"><figure class="fig"><div class="ph-box"><img src="${img('dmmmsu-01.jpg')}" alt="${esc(L.PROJ_ALT['dmmmsu-01'])}" style="object-position:50% 55%"></div><figcaption>${esc(L.projCap('dmmmsu-01'))}</figcaption></figure></div>` : (last ? '' : '<p class="xs muted mt2">Images are representative. Notes and specifications are shown in full; ask us for a quotation on any item.</p>') }));
  });

  const sys = systemsPages();
  pages.push(sys.exhaust, sys.gas, sys.fire);

  pages.push(L.page({ doc: DOC, label: 'How we work', body: `
    <p class="eyebrow">05 · How we work</p>
    <h1 class="h1">How we work, and what follows</h1>
    <p class="lead">One team carries your project from the first consultation through to after-sales support.</p>
    <div class="cols c32 gap8 mt3 top">
      <div>${L.stepsHtml('compact')}</div>
      <div><figure class="fig frame"><div class="ph-box" style="height:96mm"><img src="${img('ispsc-06.jpg')}" alt="${esc(L.PROJ_ALT['ispsc-06'])}" style="object-position:50% 40%"></div><figcaption>A sink station with an overhead shelf, installed at ISPSC.</figcaption></figure></div>
    </div>
    <p class="h4 mt4">Warranty and after-sales</p>
    <div class="mt1">${L.warranty()}</div>
    <div class="mt3">${L.regs()}</div>
    <p class="xs muted mt1">We supply and install through public bidding, and government purchases follow procurement rules.</p>
    <div class="fill"><figure class="fig"><div class="ph-box"><img src="${img('dmmmsu-05.jpg')}" alt="${esc(L.PROJ_ALT['dmmmsu-05'])}"></div><figcaption>${esc(L.projCap('dmmmsu-05'))}</figcaption></figure></div>` }));

  pages.push(L.page({ doc: DOC, label: 'How to order', body: `
    <p class="eyebrow">06 · How to order</p>
    <h1 class="h1">How to order</h1>
    <p class="lead">Choose your equipment and we will send you a final quotation. No account is needed.</p>
    <div class="cols c3 gap4 mt3 stretch">
      <div class="card"><div class="icb">${ic('sliders')}</div><div class="num mt1">01</div><div class="h3">Online quote request</div><p>Choose your equipment and sizes, and see an estimated range for your selection. We then review your request and send you the final quotation.</p><p>${link(CO.quoteUrl, CO.quoteText)}</p></div>
      <div class="card"><div class="icb">${ic('clipboard')}</div><div class="num mt1">02</div><div class="h3">Project brief</div><p>For a larger project (a hospital, school, hotel or commissary), send us a full project brief. It helps us plan your layout, equipment, exhaust and utilities before our site visit.</p><p>${link(CO.briefUrl, 'Open the project brief')}</p></div>
      <div class="card"><div class="icb">${ic('chat')}</div><div class="num mt1">03</div><div class="h3">Message us</div><p>Ask a question on Messenger, or call or email us, and we will come back with a quotation.</p><p>${link(CO.messenger, CO.messengerText)}<br>${link('tel:' + CO.tel, CO.phone)}<br>${link('mailto:' + CO.email, CO.email)}</p></div>
    </div>
    <div class="cols c32 gap8 mt4 top">
      <div>
        <p class="h4">What happens next</p>
        <ol class="steps compact mt1">
          <li><span class="n">1</span><div><b>You tell us what you need</b><p>Your equipment, your sizes, your options.</p></div></li>
          <li><span class="n">2</span><div><b>We review and quote</b><p>We review your request and send you the final quotation.</p></div></li>
          <li><span class="n">3</span><div><b>We build, deliver and install</b><p>Built to order, delivered to your site, installed and commissioned for use.</p></div></li>
        </ol>
      </div>
      <div class="c"><div class="qrbox" style="border:.25mm solid var(--line)">${L.qrSvg(CO.quoteUrl)}</div><p class="xs mt1 muted">Scan to start your quote request</p></div>
    </div>
    <div class="note mt3">The online estimate is a range for your selection. The final quotation comes from us after we review your request.</div>
    <div class="fill"><figure class="fig"><div class="ph-box"><img src="${img('ispsc-03.jpg')}" alt="${esc(L.PROJ_ALT['ispsc-03'])}"></div><figcaption>${esc(L.projCap('ispsc-03'))}</figcaption></figure></div>` }));

  pages.push(L.contactPage({ doc: DOC, lead: 'Tell us about your kitchen and we will come back with a quotation. No account needed.' }));

  if (pages.length !== ids.length) throw new Error(`catalogue: ${pages.length} pages built, ${ids.length} planned`);
  return L.docHtml({ title: META.title, pages });
}
module.exports = { build, META };
