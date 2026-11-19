'use strict';
// scripts/downloads/catalogue.js — the product catalogue PDF, generated from the website's own catalogue page so it follows the site.
// Owner rulings 2026-11-19/20:
//   · TEXT ONLY: no photographs, no design images, no line drawings (the catalogue PDF embeds no product picture; only the small logo in the running header);
//   · NO prices of any kind (no "From", no peso amount, no "+ VAT" line, no "priced per project"): the card's price line is never read, and the build's text scan refuses any price;
//   · the same groups and the same products, in the same order, as /catalogue/, each with its name, price-list code (where it has one), its one sentence, "Standard size",
//     its three or four key specifications and "Options"; the hero products carry a "Featured" tag. No panel gauges, part lists or costs;
//   · the kitchen systems (exhaust and fresh air, LPG gas line, fire suppression): the wording of the three service pages, no prices.
// The cards are read from catalogue/index.html (the generated CATALOGUE block): one <section class="cat-group" data-cat> per group, one <li class="cat-card"> per product.
const L = require('./lib');
const { CO, ic, icb, esc, link } = L;

const DOC = 'Product catalogue';
const META = {
  title: `Product catalogue | ${CO.brand}`,
  subject: `${CO.brand} by ${CO.name}: product catalogue, 2026 edition.`,
  keywords: `${CO.name}, ${CO.brand}, product catalogue, commercial kitchen equipment, stainless steel, SS304, SS316, Luzon`,
};

const dec = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();

// ───────────────────────────── the website's catalogue page → data ─────────────────────────────
function loadCatalogue() {
  const html = L.read('catalogue/index.html');
  const s = html.indexOf('<!-- CATALOGUE:START'), e = html.indexOf('<!-- CATALOGUE:END');
  if (s < 0 || e < 0) throw new Error('catalogue/index.html has no CATALOGUE block');
  const groups = [];
  for (const g of html.slice(s, e).matchAll(/<section class="cat-group" data-cat="([a-z_]+)"[^>]*>([\s\S]*?)<\/section>/g)) {
    const title = /<h2[^>]*>([^<]*)/.exec(g[2]);
    if (!title) throw new Error(`catalogue/index.html: the ${g[1]} group has no heading`);
    const items = [];
    // a card ends where the next one starts (its feature <li> items also close with </li>, so the card cannot be matched by its own closing tag)
    for (const body of g[2].split('<li class="cat-card').slice(1)) {
      const get = (re) => { const m = re.exec(body); return m ? dec(m[1]) : ''; };
      const it = {
        name: get(/<h3>([^<]*)<\/h3>/),
        code: get(/<p class="cat-code">([^<]*)</),
        lead: get(/<p class="cat-lead">([^<]*)</),
        size: get(/<p class="cat-size"><span>[^<]*<\/span>([^<]*)</),
        specs: [...(/<ul class="cat-feat">([\s\S]*?)<\/ul>/.exec(body) || [, ''])[1].matchAll(/<li>([^<]*)<\/li>/g)].map((m) => dec(m[1])),
        options: get(/<p class="cat-options"><span>[^<]*<\/span>([^<]*)</),
        featured: /class="cat-tag[^"]*">Featured</.test(body),
      };
      if (!it.name || !it.lead || it.specs.length < 3 || it.specs.length > 4) throw new Error(`catalogue/index.html: the card "${it.name}" lacks its name, sentence or 3 to 4 specifications`);
      items.push(it);
    }
    groups.push({ cat: g[1], title: dec(title[1]), items });
  }
  if (groups.length !== 8) throw new Error(`catalogue/index.html: ${groups.length} groups, the catalogue has 8`);
  return groups;
}

// ───────────────────────────── product blocks, and their pages ─────────────────────────────
function block(it, wide) {
  return `<div class="pb${it.featured ? ' ft' : ''}${wide ? ' wide' : ''}">${it.featured ? '<div class="tg"><i class="f">Featured</i></div>' : ''}
    <h3>${esc(it.name)}</h3>${it.code ? `<p class="cd">${esc(it.code)}</p>` : ''}
    <p class="ld">${esc(it.lead)}</p>
    ${it.size ? `<p class="sz"><span>Standard size</span> ${esc(it.size)}</p>` : ''}
    <ul>${it.specs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${it.options ? `<p class="op"><span>Options</span> ${esc(it.options)}</p>` : ''}</div>`;
}
// a rough height in mm of a block (a 2-column grid: about 36 characters of 8 pt text to a line), for packing the groups into pages; the build's overflow check is the judge
const lines = (t, n) => Math.max(1, Math.ceil(String(t).length / n));
function height(it) {
  return 0.9 * (12.5 + lines(it.name, 30) * 1.8 + (it.code ? 3 : 0) + lines(it.lead, 46) * 3.6 + (it.size ? lines(it.size, 38) * 3.4 + 1.4 : 0)
    + it.specs.reduce((a, x) => a + lines(x, 44) * 3.3, 1.4) + (it.options ? lines('Options ' + it.options, 48) * 3.3 + 1.4 : 0));
}
const PAGE_MM = 252, HEAD_MM = 13, GAP_MM = 3.8, FIRST_MM = 8;   // content height, a group heading, the gap between rows, the page title on a page's first group

// rows of two, a group heading before each group's first row; a group is split across pages only between rows
function paginate(groups) {
  const pages = [];
  let cur = null;
  const fresh = () => { cur = { used: 0, parts: [] }; pages.push(cur); };
  fresh();
  for (const g of groups) {
    const rows = [];
    for (let i = 0; i < g.items.length; i += 2) rows.push(g.items.slice(i, i + 2));
    let open = null;
    rows.forEach((r, ri) => {
      const rh = Math.max(...r.map(height)) + GAP_MM;
      const need = (open ? 0 : HEAD_MM + (rows.length > 1 && ri === 0 ? 0 : 0)) + rh + (cur.parts.length === 0 ? FIRST_MM : 0);
      if (cur.used + need > PAGE_MM && cur.parts.length) { fresh(); open = null; }
      if (!open) { open = { group: g, rows: [], cont: ri > 0 }; cur.parts.push(open); cur.used += HEAD_MM + (cur.parts.length === 1 ? FIRST_MM : 0); }
      open.rows.push(r); cur.used += rh;
    });
  }
  return pages;
}

function productPage(pg, i, n, total) {
  const body = pg.parts.map((p) => `<div class="grp"><h2>${esc(p.group.title)}${p.cont ? ' <span style="margin-left:2mm">continued</span>' : ''}</h2><span>${p.group.items.length} ${p.group.items.length === 1 ? 'product' : 'products'}</span></div>
    <div class="pg">${p.rows.map((r) => r.map((x) => block(x, p.group.items.length === 1)).join('')).join('')}</div>`).join('');
  return L.page({ doc: DOC, label: `Products ${i + 1} of ${n}`, body: `
    <p class="eyebrow">Products · ${i + 1} of ${n}</p>
    ${body}` });
}

// ───────────────────────────── the kitchen systems (the wording of the service pages; no pictures) ─────────────────────────────
const sysList = (items) => `<ul class="dots mt1">${items.map(([t, d]) => `<li><b>${t}.</b> ${d}</li>`).join('')}</ul>`;
const example = (title, rows) => `<div class="card paper" style="padding:3.6mm 4.4mm"><p class="h4">A standard example</p><div class="h2 mt1" style="font-size:11.5pt">${title}</div><div class="cols ${rows.length === 3 ? 'c3' : 'c2'} gap4 mt1">${rows.map(([k, v]) => `<div style="border-top:.25mm solid rgba(201,162,39,.6);padding-top:1.6mm"><p class="h4">${k}</p><p class="sm mt1" style="font-size:8pt">${v}</p></div>`).join('')}</div></div>`;
const DISCLAIMER = 'These dimensions and specifications are standard examples and are not exhaustive. All equipment can be custom-fabricated to meet your specific site requirements.';

function systemsPages() {
  const exhaust = L.page({ doc: DOC, label: 'Exhaust and fresh-air systems', body: `
    <p class="eyebrow">Kitchen systems · 01</p>
    <h1 class="h1">Exhaust and fresh-air systems</h1>
    <p class="lead">A well-ventilated kitchen is essential for both safety and comfort. We design, build and install exhaust hoods, ducting and fresh-air systems that remove smoke, grease and heat while keeping the air in your kitchen moving.</p>
    <div class="cols c2 gap8 mt3 top">
      <div>
        <p class="h4">Two paths, one balanced kitchen</p>
        <p class="sm mt1">A commercial kitchen ventilation system has two paths. A heavy-duty exhaust line removes heat, smoke and grease from over the cooking line. A fresh-air supply line replaces the air being pulled out, so the kitchen does not turn into a vacuum and the air circulates across its different zones through room diffusers.</p>
        <p class="sm">Because the two paths depend on each other, we plan the exhaust and the fresh-air supply as one system, together with your cooking line, gas line and fire suppression.</p>
      </div>
      <div>
        <p class="h4">What’s included</p>
        ${sysList([
    ['Stainless-steel range hoods', 'SS304 hoods over your cooking line, fitted with filters, lighting and integrated switch controls.'],
    ['Exhaust ducting and blower', 'Fully welded rectangular exhaust ducting powered by a centrifugal blower, with foil insulation and an access door for maintenance.'],
    ['Fresh-air ducting and blower', 'Fresh-air ducting with its own blower, integrated into the hood and distributed through room diffusers.'],
    ['Room diffusers', 'Square louvered diffusers that spread the fresh air across the zones of your kitchen.'],
    ['Site assessment and layout', 'We assess your site, customise the system to suit your kitchen and prepare drawings.'],
    ['Installation and commissioning', 'We deliver, install and commission the system on site.'],
  ])}
      </div>
    </div>
    <div class="mt3">${example('A dual-path ventilation system', [['Hood', 'A 4-metre SS304 stainless-steel range hood with filters, lighting and integrated switch controls.'], ['Exhaust', 'A 10-metre rectangular duct of fully welded BI sheet, powered by a 3HP centrifugal blower, with foil insulation and an access door for maintenance.'], ['Fresh air', 'A 15-metre GI (galvanised iron) duct system with a 3HP blower, integrated into the hood and distributed through about 8 room diffusers.']])}</div>
    <p class="xs muted mt2">One standard example from our 2026 kitchen catalogue. Every system is custom-fabricated to meet the requirements of your site.</p>
    <p class="xs muted mta">${DISCLAIMER}</p>` });

  const gasFire = L.page({ doc: DOC, label: 'LPG gas line and fire suppression', body: `
    <p class="eyebrow">Kitchen systems · 02 and 03</p>
    <h1 class="h1" style="font-size:21pt">LPG gas line installation</h1>
    <p class="lead" style="font-size:10pt">A centralised and safe supply of fuel to your cooking equipment. We design, build and install a fully welded gas line that runs from an external gas tank farm to the appliances on your cooking line, with safety controls built in.</p>
    ${sysList([
    ['Gas tank farm', 'A secured cage in an external storage area, designed to hold your gas tanks.'],
    ['Piping network', 'Fully welded black iron (BI) pipes and fittings that carry the fuel into the kitchen and to your appliances.'],
    ['Safety controls', 'A gas leak detection system paired with an emergency auto-shutoff valve.'],
    ['Appliance connections and testing', 'We connect your cooking equipment, such as stoves, to the gas line and test the installation to make sure there are no leaks.'],
  ])}
    <div class="mt2">${example('A centralised gas line system', [['Gas tank farm', 'A secured cage designed to hold four 50 kg gas tanks.'], ['Piping network', 'Fully welded BI pipes and fittings for fuel transport.'], ['Safety controls', 'A gas leak detection system paired with an emergency auto-shutoff valve.']])}</div>
    <h1 class="h1 mt4" style="font-size:21pt">Kitchen fire suppression</h1>
    <p class="lead" style="font-size:10pt">A wet chemical fire suppression system integrated with your range hood, designed to protect the cooking surface and the exhaust path. We supply, install and integrate it into your kitchen as part of the project.</p>
    ${sysList([
    ['Wet chemical tank', 'The tank that stores the extinguishing agent for kitchen fires.'],
    ['Hood integration', 'Specialised hardware links the suppression discharge to the stainless-steel range hood.'],
    ['Detectors, line and manual pull', 'Detectors that allow the system to operate automatically, a suppression line and cylinder, and a manual pull for operating the system by hand.'],
    ['Installation and integration', 'We install the system and integrate it with your hood and the kitchen’s ventilation.'],
  ])}
    <div class="mt2">${example('A wet chemical suppression system', [['System', 'Integrated with the range hood for automatic fire extinguishing, to protect the cooking surface and the exhaust path.'], ['Agent', 'A 16 L wet chemical tank, the primary storage for the extinguishing agent.'], ['Hood integration', 'Specialised hardware linking the suppression discharge to the SS range hood.']])}</div>
    <p class="xs muted mta">${DISCLAIMER}</p>` });
  return { exhaust, gasFire };
}

function build() {
  const groups = loadCatalogue();
  const prodPages = paginate(groups);
  const nProd = groups.reduce((a, g) => a + g.items.length, 0);

  // the page order, from which the contents list takes its numbers
  const ids = ['cover', 'contents', 'materials', ...prodPages.map((_, i) => 'prod-' + i), 'sys-exhaust', 'sys-gasfire', 'how', 'order', 'contact'];
  const no = (id) => ids.indexOf(id) + 1;
  const firstPage = (g) => prodPages.findIndex((p) => p.parts.some((x) => x.group === g));
  const lastPage = (g) => prodPages.map((p) => p.parts.some((x) => x.group === g)).lastIndexOf(true);
  const range = (g) => { const a = no('prod-' + firstPage(g)), b = no('prod-' + lastPage(g)); return a === b ? `${a}` : `${a}–${b}`; };
  const row = (t, id, sub, n) => `<li${sub ? ' class="sub"' : ''}>${sub ? '' : `<span class="no">${n || '&nbsp;'}</span>`}<span>${t}</span><i></i><b>${no(id)}</b></li>`;

  const pages = [];
  pages.push(L.cover({
    photo: null, edition: '2026 edition', kicker: 'Product catalogue',
    title: '<span class="nowrap">Stainless-steel</span> kitchen equipment, built to your sizes.',
    sub: `${nProd} products in 8 groups, from preparation tables and sinks to Chef Mode cooking equipment, refrigeration, and the exhaust, gas and fire suppression systems that go with them.`,
    footLeft: `<b>${CO.brand}™</b> by ${CO.legal}`, footRight: `<b>${CO.site}</b>`,
  }));

  pages.push(L.page({ doc: DOC, label: 'Contents', body: `
    <p class="eyebrow">Welcome</p>
    <h1 class="h1">Equipment built to your specifications</h1>
    <p class="lead">Commercial kitchen equipment for restaurants, hotels, bakeries, catering and commissary kitchens, built by our own team in food-grade SS304 stainless steel (SS316 on request) and built to your sizes. Sizes are in millimetres. We serve Luzon.</p>
    <div class="mt3">${L.proofBar()}</div>
    <div class="cols c32 gap8 mt4 top">
      <div><p class="h4">Contents</p><ol class="toc mt1">
        ${row('Materials and finishes', 'materials', false, '01')}
        <li><span class="no">02</span><span>Products</span><i></i><b>${no('prod-0')}–${no('prod-' + (prodPages.length - 1))}</b></li>
        ${groups.map((g) => `<li class="sub"><span>${esc(g.title)}</span><i></i><b>${range(g)}</b></li>`).join('')}
        <li><span class="no">03</span><span>Kitchen systems</span><i></i><b>${no('sys-exhaust')}–${no('sys-gasfire')}</b></li>
        ${row('Exhaust and fresh-air systems', 'sys-exhaust', true)}${row('LPG gas line and kitchen fire suppression', 'sys-gasfire', true)}
        ${row('How we work, warranty', 'how', false, '04')}
        ${row('How to order', 'order', false, '05')}
        ${row('Contact', 'contact', false, '06')}
      </ol></div>
      <div>
        <p class="h4">How to read this catalogue</p>
        <div class="tile-ic">${icb('boxes')}<div><div class="h3">Products</div><p>Each product shows its name, its product code where it has one, what it is for, its standard size, its key specifications and its options.</p></div></div>
        <div class="tile-ic">${icb('star')}<div><div class="h3">Featured</div><p>Products marked Featured are the ones we put forward first in our range.</p></div></div>
        <div class="tile-ic">${icb('wind')}<div><div class="h3">Kitchen systems</div><p>Exhaust and fresh air, LPG gas line and fire suppression, planned together with your cooking line.</p></div></div>
        <div class="note mt3">Ask us for a quotation on any item. Choose your equipment online, then we send you the final quotation.</div>
      </div>
    </div>` }));

  pages.push(L.page({ doc: DOC, label: 'Materials and finishes', body: `
    <p class="eyebrow">01 · Materials and finishes</p>
    <h1 class="h1">Two grades, four finishes</h1>
    <p class="lead">We work in two grades, food-grade SS304 as standard and laboratory-grade SS316 on request. Our standard finish is hairline, with brushed, mirror or satin on request. Seams are welded and ground smooth, and surfaces are polished to a professional finish.</p>
    <div class="cols c2 gap4 mt3 stretch">
      <div class="card"><p class="h4">Standard</p><div class="h3">SS304 food grade</div><p>Food-grade SS304 stainless steel is our standard for kitchens: preparation tables, sinks, cabinets, shelving and racks.</p></div>
      <div class="card"><p class="h4">On request</p><div class="h3">SS316 laboratory grade</div><p>Laboratory-grade SS316 stainless steel is available on request and suits laboratories and school science rooms.</p></div>
    </div>
    <div class="cols c4 gap4 mt3">
      <div><div class="sw hairline"></div><div class="h3 mt1">Hairline</div><p class="sm muted">Our standard finish. A fine, uniform straight-line grain.</p></div>
      <div><div class="sw brushed"></div><div class="h3 mt1">Brushed</div><p class="sm muted">A visible straight grain that hides everyday scratches.</p></div>
      <div><div class="sw mirror"></div><div class="h3 mt1">Mirror</div><p class="sm muted">Polished to a high gloss, for decorative parts and low-contact areas.</p></div>
      <div><div class="sw satin"></div><div class="h3 mt1">Satin</div><p class="sm muted">A soft, low-sheen finish between brushed and mirror.</p></div>
    </div>
    <p class="xs muted mt1">The swatches are illustrations. Ask to see a sample before you decide.</p>
    <p class="h4 mt4">Built to order</p>
    <p class="sm mt1">Our configurable products are built to your sizes in SS304 or SS316, with a hairline finish as standard. Need a size that is not listed? Ask us for a quotation built to your specifications.</p>` }));

  prodPages.forEach((pg, i) => pages.push(productPage(pg, i, prodPages.length)));

  const sys = systemsPages();
  pages.push(sys.exhaust, sys.gasFire);

  pages.push(L.page({ doc: DOC, label: 'How we work', body: `
    <p class="eyebrow">04 · How we work</p>
    <h1 class="h1">How we work, and what follows</h1>
    <p class="lead">One team carries your project from the first consultation through to after-sales support.</p>
    <div class="mt3">${L.stepsHtml('')}</div>
    <p class="h4 mt4">Warranty and after-sales</p>
    <div class="mt1">${L.warranty()}</div>
    <div class="mt3">${L.regs()}</div>
    <p class="xs muted mt1">We supply and install through public bidding, and government purchases follow procurement rules.</p>` }));

  pages.push(L.page({ doc: DOC, label: 'How to order', body: `
    <p class="eyebrow">05 · How to order</p>
    <h1 class="h1">How to order</h1>
    <p class="lead">Choose your equipment and we will send you a final quotation. No account is needed.</p>
    <div class="cols c3 gap4 mt3 stretch">
      <div class="card"><div class="icb">${ic('sliders')}</div><div class="num mt1">01</div><div class="h3">Online quote request</div><p>Choose your equipment and sizes. We review your request and send you the final quotation.</p><p>${link(CO.quoteUrl, CO.quoteText)}</p></div>
      <div class="card"><div class="icb">${ic('clipboard')}</div><div class="num mt1">02</div><div class="h3">Project brief</div><p>For a larger project (a hospital, school, hotel or commissary), send us a full project brief. It helps us plan your layout, equipment, exhaust and utilities before our site visit.</p><p>${link(CO.briefUrl, 'Open the project brief')}</p></div>
      <div class="card"><div class="icb">${ic('chat')}</div><div class="num mt1">03</div><div class="h3">Message us</div><p>Ask a question on Messenger, or call or email us, and we will come back with a quotation.</p><p>${link(CO.messenger, CO.messengerText)}<br>${link('tel:' + CO.tel, CO.phone)}<br>${link('mailto:' + CO.email, CO.email)}</p></div>
    </div>
    <div class="cols c32 gap8 mt4 top">
      <div>
        <p class="h4">What happens next</p>
        <ol class="steps compact mt1">
          <li><span class="n">1</span><div><b>You tell us what you need</b><p>Your equipment, your sizes, your options.</p></div></li>
          <li><span class="n">2</span><div><b>We review and quote</b><p>We review your request and send you the final quotation.</p></div></li>
          <li><span class="n">3</span><div><b>We build, deliver and install</b><p>Built to order by our own team, delivered to your site across Luzon, installed and commissioned for use.</p></div></li>
        </ol>
      </div>
      <div class="c"><div class="qrbox" style="border:.25mm solid var(--line)">${L.qrSvg(CO.quoteUrl)}</div><p class="xs mt1 muted">Scan to start your quote request</p></div>
    </div>` }));

  pages.push(L.contactPage({ doc: DOC, lead: 'Tell us about your kitchen and we will come back with a quotation. No account needed.', photo: null }));

  if (pages.length !== ids.length) throw new Error(`catalogue: ${pages.length} pages built, ${ids.length} planned`);
  return L.docHtml({ title: META.title, pages });
}
module.exports = { build, META, loadCatalogue };
