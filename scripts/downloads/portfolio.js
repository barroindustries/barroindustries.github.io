'use strict';
// scripts/downloads/portfolio.js — the portfolio (10 A4 pages): two named projects in depth (ISPSC 2026, DMMMSU 2022-2023; the only two clients the owner allows) and one
// project from the owner's own portfolio PDF shown WITHOUT its client's name ("Restaurant kitchen, Bulacan"). Wording for the two named projects is the website's own
// (homepage and /work/ pages); the third states only what its photographs show and the year the owner gave. No grade or finish is credited to any project.
const L = require('./lib');
const { CO, img, ic, icb } = L;

const DOC = 'Portfolio';
const META = {
  title: `Portfolio | ${CO.name}`,
  subject: `${CO.brand} by ${CO.name}: portfolio of completed projects, 2026 edition.`,
  keywords: `${CO.name}, ${CO.brand}, portfolio, completed projects, stainless-steel kitchens, Philippines`,
};
const fig = (name, alt, cap, h = 'fill', pos = '', cls = '') => `<figure class="fig ${cls}"><div class="ph-box"${h === 'fill' ? '' : ` style="height:${h}mm"`}><img src="${img(name)}" alt="${L.esc(alt)}"${pos ? ` style="object-position:${pos}"` : ''}></div>${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
const A = L.PROJ_ALT;
const cap = L.projCap;
const ph = (k, h = 'fill', pos = '') => fig(`${k}.jpg`, A[k], cap(k), h, pos);

function projectPage({ no, kicker, title, sub, lead, body, facts, heroKey, heroPos, pair }) {
  return L.page({ doc: DOC, label: `${title}` , body: `
    <p class="eyebrow">${kicker}</p>
    <h1 class="h1">${title}</h1>
    <p class="h2 mt1" style="font-size:12pt;color:var(--muted);font-weight:500">${sub}</p>
    <div class="mt3">${fig(`${heroKey}.jpg`, A[heroKey], cap(heroKey), 92, heroPos)}</div>
    <div class="cols c32 gap8 mt3 top">
      <div><p class="lead" style="margin-top:0;font-size:10.4pt;color:var(--ink)">${lead}</p><p class="sm muted mt2">${body}</p></div>
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    </div>
    <div class="fill"><div class="cols c2 gap4">${pair.map((k) => ph(k)).join('')}</div></div>` });
}

function build() {
  const pages = [];

  // 1 — cover
  pages.push(L.cover({
    photo: 'ispsc-02.jpg', edition: '2026 edition', kicker: 'Portfolio',
    title: 'Completed kitchens and <span class="nowrap">stainless-steel</span> installations.',
    sub: 'Projects in depth: Ilocos Sur Polytechnic State College, Don Mariano Marcos Memorial State University, and a restaurant kitchen in Bulacan.',
    footLeft: '<b>Ilocos Sur</b> · La Union · Bulacan', footRight: `<b>${CO.site}</b>`, photoPos: '50% 55%',
  }));

  // 2 — overview
  const card = (k, t, d, p) => `<div class="card paper"><div class="ph-box" style="height:36mm">${`<img src="${img(k)}" alt="">`}</div><div class="h3 mt2">${t}</div><p>${d}</p><p class="num mt1">Page ${p}</p></div>`;
  pages.push(L.page({ doc: DOC, label: 'Overview', body: `
    <p class="eyebrow">Our work</p>
    <h1 class="h1">Selected projects</h1>
    <p class="lead">A selection of completed projects across Luzon, from school rooms and campuses to a restaurant kitchen, with photographs of each.</p>
    <table class="tb mt3">
      <colgroup><col style="width:31%"><col style="width:13%"><col style="width:21%"><col style="width:35%"></colgroup>
      <thead><tr><th>Project</th><th>Where</th><th>Completed</th><th>Work</th></tr></thead>
      <tbody>
        <tr><td>ISPSC 2026<br><span class="xs muted" style="font-family:var(--sans);font-weight:500">Ilocos Sur Polytechnic State College</span></td><td>Ilocos Sur</td><td>March 2026</td><td>Laboratory and kitchen work tables, sinks, gas ranges and exhaust hoods</td></tr>
        <tr><td>DMMMSU 2022–2023<br><span class="xs muted" style="font-family:var(--sans);font-weight:500">Don Mariano Marcos Memorial State University</span></td><td>La Union</td><td>March 2023 – December 2025</td><td>Stainless-steel equipment delivered and installed on campus</td></tr>
        <tr><td>Restaurant kitchen<br><span class="xs muted" style="font-family:var(--sans);font-weight:500">Shown without its client’s name</span></td><td>Bulacan</td><td>2026</td><td>A commercial restaurant kitchen, shown in photographs</td></tr>
      </tbody>
    </table>
    <div class="cols c3 gap4 mt4 stretch">
      ${card('ispsc-01.jpg', 'ISPSC 2026', 'A school room with work tables, sinks, gas ranges and exhaust hoods.', 3)}
      ${card('dmmmsu-01.jpg', 'DMMMSU 2022–2023', 'Equipment delivered and installed on a university campus.', 5)}
      ${card('restaurant-1.jpg', 'Restaurant kitchen', 'A commercial kitchen in Bulacan, completed in 2026.', 7)}
    </div>
    <div class="note mt3">Every project is built to order, to the client’s own sizes and layout. Your project can be planned the same way: send us a brief, or ask for a quotation. Details are on the last page.</div>
    <div class="fill">${fig('ispsc-03.jpg', A['ispsc-03'], cap('ispsc-03'), 'fill')}</div>` }));

  // 3 — ISPSC (1)
  pages.push(projectPage({
    kicker: 'Project 01 · Government · School', title: 'ISPSC 2026', sub: 'Ilocos Sur Polytechnic State College (ISPSC)',
    lead: 'Stainless-steel laboratory and kitchen work tables, sinks, gas ranges and exhaust hoods, fabricated and installed in a school room (March 2026).',
    body: 'The photographs show rows of stainless-steel work tables in the school room, some still with their protective film on, cooking stations with gas ranges, sinks and overhead exhaust hoods, and a sink station and a range, each with an overhead shelf.',
    facts: [['Client', 'Ilocos Sur Polytechnic State College (ISPSC)'], ['Location', 'Ilocos Sur'], ['Completed', 'March 2026'], ['Work', 'Stainless-steel laboratory and kitchen work tables, sinks, gas ranges and exhaust hoods'], ['Scope', 'Fabricated and installed in a school room']],
    heroKey: 'ispsc-01', heroPos: '50% 45%', pair: ['ispsc-05', 'ispsc-03'],
  }));

  // 4 — ISPSC (2)
  pages.push(L.page({ doc: DOC, label: 'ISPSC 2026 photographs', body: `
    <p class="eyebrow">Project 01 · Photographs</p>
    <h1 class="h1">ISPSC 2026 in the school room</h1>
    <p class="lead">Work tables in rows, cooking stations and sink stations, as installed.</p>
    <div class="mt3">${fig('ispsc-02.jpg', A['ispsc-02'], cap('ispsc-02'), 86)}</div>
    <div class="cols c3 gap4 mt3 top">
      ${fig('ispsc-04.jpg', A['ispsc-04'], cap('ispsc-04'), 62)}
      ${fig('ispsc-06.jpg', A['ispsc-06'], cap('ispsc-06'), 62, '50% 40%')}
      ${fig('ispsc-07.jpg', A['ispsc-07'], cap('ispsc-07'), 62, '50% 40%')}
    </div>
    <p class="h4 mt4">The scope at a glance</p>
    <div class="pills mt1"><span class="pill">${ic('layers')}Work tables</span><span class="pill">${ic('drop')}Sinks</span><span class="pill">${ic('flame')}Gas ranges</span><span class="pill">${ic('wind')}Exhaust hoods</span></div>
    <div class="cols c2 gap8 mt3 top">
      <div><p class="h4">Related services</p><ul class="dots mt1"><li>Stainless-steel &amp; metal fabrication</li><li>Exhaust &amp; fresh-air systems</li><li>Institutional &amp; government supply</li></ul></div>
      <div><p class="h4">In the catalogue</p><ul class="dots mt1"><li>Preparation table, sink and stove: the configurable products</li><li>Exhaust hoods and ducting</li></ul></div>
    </div>` }));

  // 5 — DMMMSU (1)
  pages.push(projectPage({
    kicker: 'Project 02 · Government · University', title: 'DMMMSU 2022–2023', sub: 'Don Mariano Marcos Memorial State University (DMMMSU)',
    lead: 'Stainless-steel equipment delivered and installed on campus in La Union (March 2023 – December 2025).',
    body: 'The photographs show a finished commercial kitchen with a range, hood and work tables, a room installed with stainless-steel tables, racks and shelving, and a close-up of a stainless-steel rack.',
    facts: [['Client', 'Don Mariano Marcos Memorial State University (DMMMSU)'], ['Location', 'La Union'], ['Dates', 'March 2023 – December 2025'], ['Work', 'Stainless-steel equipment delivered and installed on campus']],
    heroKey: 'dmmmsu-01', heroPos: '50% 55%', pair: ['dmmmsu-02', 'dmmmsu-03'],
  }));

  // 6 — DMMMSU (2)
  pages.push(L.page({ doc: DOC, label: 'DMMMSU photographs', body: `
    <p class="eyebrow">Project 02 · Photographs</p>
    <h1 class="h1">DMMMSU on campus</h1>
    <p class="lead">Tables, racks and shelving installed in the room, and a finished commercial kitchen.</p>
    <div class="mt3">${fig('dmmmsu-05.jpg', A['dmmmsu-05'], cap('dmmmsu-05'), 90)}</div>
    <div class="cols c32 gap4 mt3 top">
      ${fig('dmmmsu-04.jpg', A['dmmmsu-04'], cap('dmmmsu-04'), 66)}
      ${fig('dmmmsu-06.jpg', A['dmmmsu-06'], cap('dmmmsu-06'), 66, '50% 40%')}
    </div>
    <p class="h4 mt4">The scope at a glance</p>
    <div class="pills mt1"><span class="pill">${ic('layers')}Tables</span><span class="pill">${ic('boxes')}Racks</span><span class="pill">${ic('sliders')}Shelving</span><span class="pill">${ic('flame')}Range and hood</span></div>
    <div class="cols c2 gap8 mt3 top">
      <div><p class="h4">Related services</p><ul class="dots mt1"><li>Stainless-steel &amp; metal fabrication</li><li>Institutional &amp; government supply</li><li>Commercial &amp; commissary kitchen fit-outs</li></ul></div>
      <div><p class="h4">In the catalogue</p><ul class="dots mt1"><li>Racks, wall shelving and preparation tables</li><li>Gas stove and exhaust hood</li></ul></div>
    </div>` }));

  // 7 — the restaurant kitchen (no client name)
  pages.push(L.page({ doc: DOC, label: 'Restaurant kitchen', body: `
    <p class="eyebrow">Project 03 · Restaurant</p>
    <h1 class="h1">Restaurant kitchen, Bulacan</h1>
    <p class="h2 mt1" style="font-size:12pt;color:var(--muted);font-weight:500">Completed 2026. Shown without the client’s name.</p>
    <div class="mt3">${fig('restaurant-2.jpg', 'A commercial restaurant kitchen in Bulacan: the exhaust hood and the stainless-steel wall along the cooking line', 'The cooking line along the stainless-steel wall, under the exhaust hood.', 62)}</div>
    <div class="cols c3 gap4 mt3 top">
      ${fig('restaurant-1.jpg', 'A commercial restaurant kitchen in Bulacan: stock pots on the cooking line under the hood', 'Stock pots on the cooking line, under the hood.', 86, '40% 50%')}
      ${fig('restaurant-3.jpg', 'A commercial restaurant kitchen in Bulacan: a view along the cooking line', 'A view along the cooking line.', 86, '50% 40%')}
      ${fig('restaurant-4.jpg', 'A commercial restaurant kitchen in Bulacan: cooking at a wok burner under the hood', 'Cooking at the line, under the hood.', 86, '50% 35%')}
    </div>
    <div class="cols c32 gap8 mt3 top">
      <div><p class="lead" style="margin-top:0;font-size:10.4pt;color:var(--ink)">A commercial restaurant kitchen in Bulacan, completed in 2026.</p><p class="sm muted mt2">The photographs show the kitchen’s cooking line under its exhaust hood, with stainless-steel work tables and equipment around it. The client’s name is not shown.</p></div>
      <dl class="facts"><div><dt>Type</dt><dd>Restaurant kitchen</dd></div><div><dt>Location</dt><dd>Bulacan</dd></div><div><dt>Completed</dt><dd>2026</dd></div></dl>
    </div>` }));

  // 8 — what these projects show
  const cap6 = (icon, t, d) => `<div class="tile-ic">${icb(icon)}<div><div class="h3">${t}</div><p>${d}</p></div></div>`;
  pages.push(L.page({ doc: DOC, label: 'What these projects show', body: `
    <p class="eyebrow">What these projects show</p>
    <h1 class="h1">The same build, in every kitchen</h1>
    <p class="lead">Seams welded and ground smooth, surfaces polished to a professional finish, and every piece built to order.</p>
    <div class="cols c2 gap8 mt3 top">
      ${cap6('layers', 'Work tables and sinks', 'Laboratory and kitchen work tables and sinks, fabricated to your sizes and installed on site, as at ISPSC.')}
      ${cap6('flame', 'Gas ranges', 'Stainless-steel gas ranges, some with an overhead shelf, supplied and installed at ISPSC.')}
      ${cap6('wind', 'Exhaust hoods', 'Overhead exhaust hoods above the cooking stations, planned with the cooking line.')}
      ${cap6('boxes', 'Racks, shelving and cabinets', 'Racks and shelving feature in our DMMMSU project, built to your length, width and height.')}
      ${cap6('truck', 'Delivery and installation', 'Equipment delivered to your site, installed there and commissioned for use.')}
      ${cap6('columns', 'Schools and universities', 'Laboratories, school rooms and campuses, supplied and installed for state universities.')}
    </div>
    <div class="band mt4"><p class="eyebrow">Your project</p><p class="mt1" style="color:#fff;font-size:11pt;line-height:1.5">Tell us what you need. We design, fabricate, deliver and install, then commission everything on site. For a larger project (a hospital, school, hotel or commissary), send us a full project brief.</p><p class="sm mt1" style="color:var(--goldlite)">${L.link(CO.briefUrl, CO.briefText)}</p></div>
    <div class="fill">${fig('ispsc-05.jpg', A['ispsc-05'], cap('ispsc-05'), 'fill', '50% 55%')}</div>` }));

  // 9 — how a project runs, and after handover
  pages.push(L.page({ doc: DOC, label: 'How a project runs', body: `
    <p class="eyebrow">How a project runs</p>
    <h1 class="h1">From consultation to after-sales</h1>
    <p class="lead">One team carries your project from the first consultation through to after-sales support.</p>
    <div class="cols c32 gap8 mt3 top">
      <div>${L.stepsHtml('compact')}</div>
      <div>${fig('ispsc-06.jpg', A['ispsc-06'], 'A sink station with an overhead shelf, installed at ISPSC.', 88, '50% 40%', 'frame')}</div>
    </div>
    <p class="h4 mt4">After handover</p>
    <div class="mt1">${L.warranty()}</div>
    <div class="mt3">${L.regs()}</div>
    <p class="xs muted mt1">We supply and install through public bidding, and government purchases follow procurement rules.</p>
    <div class="fill">${fig('dmmmsu-02.jpg', A['dmmmsu-02'], cap('dmmmsu-02'), 'fill')}</div>` }));

  // 10 — contact
  pages.push(L.contactPage({ doc: DOC, lead: 'Tell us about your project and we will come back with a quotation. No account needed.', photo: 'dmmmsu-01.jpg', photoAlt: A['dmmmsu-01'], photoPos: '50% 60%' }));

  return L.docHtml({ title: META.title, pages });
}
module.exports = { build, META };
