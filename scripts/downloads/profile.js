'use strict';
// scripts/downloads/profile.js — the company profile (13 A4 pages). Wording comes from the public website (homepage, the six service pages, the FAQ, /areas-we-serve/,
// the two project pages), so it says exactly what the site says: no prices, no project counts, no client but DMMMSU and ISPSC, SS304 / SS316 as the owner stated.
const L = require('./lib');
const { CO, img, ic, icb, link } = L;

const DOC = 'Company profile';
// The owner's own 2026-10-10 catalogue carried "Narciso Neil Barro, President" with a portrait on its About page; it is carried over here. Set false to leave the card out.
const SHOW_LEADERSHIP = true;
// The standard construction of the made-to-order pieces (owner ruling 2026-10-28): the very sentence of the website's /products/ page, under "Two grades, three finishes"
// (and of the catalogue PDF's materials page). tests/content-assets.test.mjs pins them together.
const CONSTRUCTION_NOTE = 'Made-to-order tables, sinks and stoves have a 1.5 mm (16 gauge) top plate; bodies and shelving are 1.2 mm; floor-standing pieces stand on square-tube posts with adjustable bullet feet.';
// the PDF's document information (scripts/downloads/pdf-meta.js writes it, with the copyright, after Chrome has printed the file)
const META = {
  title: `Company profile | ${CO.name}`,
  subject: `${CO.brand} by ${CO.name}: company profile, 2026 edition.`,
  keywords: `${CO.name}, ${CO.brand}, stainless-steel kitchens, commercial kitchens, company profile, Quezon City, Philippines`,
};

// the order of the numbered sections; the contents list and the page numbers are both taken from it (cover = 1, at a glance = 2)
const SECTIONS = [
  ['who', 'Who we are'], ['values', 'What guides us'], ['do', 'What we do'], ['how', 'How we work'], ['materials', 'Materials and finishes'], ['built', 'Built to order'],
  ['serve', 'Who we serve'], ['projects', 'Projects'], ['areas', 'Areas we serve'], ['regs', 'Registrations, warranty and after-sales'], ['contact', 'Contact'],
];
const pageNo = (id) => 3 + SECTIONS.findIndex((s) => s[0] === id);
const toc = () => `<ol class="toc">${SECTIONS.map(([id, t], i) => `<li><span class="no">${String(i + 1).padStart(2, '0')}</span><span>${t}</span><i></i><b>${pageNo(id)}</b></li>`).join('')}</ol>`;
const fig = (name, alt, cap, h, cls = '', pos = '') => `<figure class="fig ${cls}"><div class="ph-box"${h === 'fill' ? '' : ` style="height:${h}mm"`}><img src="${img(name)}" alt="${L.esc(alt)}"${pos ? ` style="object-position:${pos}"` : ''}></div>${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;

function build() {
  const pages = [];

  // 1 — cover
  pages.push(L.cover({
    photo: 'ispsc-01.jpg', edition: '2026 edition', kicker: 'Company profile',
    title: 'Premium <span class="nowrap">stainless-steel</span> kitchens, built to order in Metro Manila.',
    sub: `${CO.legal}, well known as ${CO.brand}. Designed, fabricated, delivered and installed by one team, for restaurants, hotels, schools and government institutions.`,
    footLeft: `<b>23 years</b> in business`, footRight: `<b>${CO.site}</b>`, photoPos: '50% 40%',
  }));

  // 2 — at a glance
  pages.push(L.page({ doc: DOC, label: 'At a glance', body: `
    <p class="eyebrow">At a glance</p>
    <h1 class="h1">${CO.name} at a glance</h1>
    <p class="lead">${CO.legal} is an SEC-registered manufacturing company built on precision, quality and a commitment to long-term growth.</p>
    <div class="mt3">${L.proofBar()}</div>
    <div class="cols c32 gap8 mt4 top">
      <div><p class="h4">Contents</p><div class="mt1">${toc()}</div></div>
      <div>
        <p class="h4">Why choose us</p>
        <ul class="dots mt1">
          <li><b>23 years in business.</b> A family business that began in Baguio City and La Union.</li>
          <li><b>One team, end to end.</b> We design, fabricate, deliver and install, then commission on site.</li>
          <li><b>Made to order.</b> Your exact dimensions, SS304 or SS316, brushed, mirror or satin.</li>
          <li><b>Finished with care.</b> Seams welded and ground smooth, surfaces polished to a professional finish.</li>
          <li><b>Here after handover.</b> A 6-month service warranty, and 12 months of preventive maintenance with KitchenShield™ on full-kitchen projects.</li>
        </ul>
        <p class="h4 mt3">Companion documents</p>
        <p class="sm mt1"><b>Product catalogue</b><br>${CO.site}/downloads/barro-industries-catalogue.pdf</p>
        <p class="sm mt1"><b>Portfolio</b><br>${CO.site}/downloads/barro-industries-portfolio.pdf</p>
      </div>
    </div>
    <div class="fill">${fig('ispsc-05.jpg', 'ISPSC 2026 — cooking station with range oven and sink', 'ISPSC 2026 — cooking station with range oven and sink.', 'fill')}</div>` }));

  // 3 — who we are
  pages.push(L.page({ doc: DOC, label: 'Who we are', body: `
    <p class="eyebrow">01 · Who we are</p>
    <h1 class="h1">Who we are</h1>
    <p class="lead">${CO.legal}, well known as ${CO.brand}, designs, fabricates, delivers and installs premium stainless-steel kitchens from its base in Quezon City, Metro Manila.</p>
    <div class="cols ${SHOW_LEADERSHIP ? 'c32' : ''} gap8 mt3 top">
      <div>
        <p>The company began as a family business in Baguio City and La Union and has been in business for 23 years. Our kitchens have long been known as ${CO.brand}.</p>
        <p>${CO.legal} is an SEC-registered manufacturing company built on precision, quality and a commitment to long-term growth.</p>
        <p>We work end to end. We visit your site, plan the layout, build every piece to order, deliver and install it, and commission it for use. Service and support continue after handover.</p>
      </div>
      ${SHOW_LEADERSHIP ? `<div class="card paper">
        <p class="h4">Leadership</p>
        <div class="person mt2"><div class="pt"><img src="${img('own-president.jpg')}" alt="Narciso Neil Barro"></div><div><b>Narciso Neil Barro</b><span>President</span></div></div>
      </div>` : ''}
    </div>
    <p class="h4 mt4">Our story</p>
    <div class="cols c3 gap4 mt1">
      <div class="card"><div class="icb gold">${ic('home')}</div><div class="h3">Where we began</div><p>Baguio City and La Union: the company began as a family business.</p></div>
      <div class="card"><div class="icb gold">${ic('pin')}</div><div class="h3">Where we are</div><p>Quezon City: our office and base at 21 Capricorn St., Tandang Sora.</p></div>
      <div class="card"><div class="icb gold">${ic('globe')}</div><div class="h3">Where we build</div><p>Across Luzon: completed projects from Ilocos Sur in the north to Batangas in the south.</p></div>
    </div>
    <div class="fill">${fig('ispsc-03.jpg', 'Rows of fabricated stainless-steel work tables', 'Rows of fabricated stainless-steel work tables.', 'fill')}</div>` }));

  // 4 — what guides us
  pages.push(L.page({ doc: DOC, label: 'What guides us', body: `
    <p class="eyebrow">02 · What guides us</p>
    <h1 class="h1">What guides us</h1>
    <p class="lead">Excellence · Integrity · People first · Growth. Four values shape how we build and how we work with you.</p>
    <div class="cols c2 gap4 mt3 stretch">
      <div class="card"><div class="num">01</div><div class="h3">Excellence</div><p>Every piece is built to order. Seams are welded and ground smooth, and surfaces are polished to a professional finish.</p></div>
      <div class="card"><div class="num">02</div><div class="h3">Integrity</div><p>We build to your specifications and tell you plainly what we will deliver: your equipment, your sizes, your grade and finish, and a 6-month service warranty on our equipment and work.</p></div>
      <div class="card"><div class="num">03</div><div class="h3">People first</div><p>One team carries your project from the first consultation and site visit to after-sales support. Full-kitchen projects include 12 months of preventive maintenance service with KitchenShield™.</p></div>
      <div class="card"><div class="num">04</div><div class="h3">Growth</div><p>A family business that began in Baguio City and La Union, now a Quezon City manufacturer with projects across Luzon, built on a commitment to long-term growth.</p></div>
    </div>
    <div class="band mt4"><p class="eyebrow">Our promise</p><p class="h1" style="color:#fff;margin-top:3mm">${CO.tagline}</p></div>
    <div class="fill">${fig('dmmmsu-01.jpg', 'Finished commercial kitchen with a range, hood and stainless-steel work tables', 'A finished commercial kitchen with a range, hood and stainless-steel work tables.', 'fill')}</div>` }));

  // 5 — what we do
  const svc = (n, icon, t, d) => `<div class="card"><div class="icb">${ic(icon)}</div><div class="h3 mt1">${t}</div><p>${d}</p></div>`;
  pages.push(L.page({ doc: DOC, label: 'What we do', body: `
    <p class="eyebrow">03 · What we do</p>
    <h1 class="h1">What we do</h1>
    <p class="lead">The same high-quality build runs through every service: seams welded and ground smooth, surfaces polished to a professional finish, and every piece built to order.</p>
    <div class="cols c2 gap4 mt3 stretch">
      ${svc('01', 'flame', 'Commercial &amp; commissary kitchen fit-outs', 'Design-build from concept to completion: cooking lines, preparation and washing stations, baking equipment, exhaust hoods and ducting, fresh-air systems, gas lines and fire suppression. One contractor, from drawings to commissioning.')}
      ${svc('02', 'layers', 'Custom stainless &amp; metal fabrication', 'Work tables, sinks, cabinets, shelving and racks in stainless steel, plus railings, gates, structural and sheet-metal work fabricated to your drawing, in stainless or mild steel, for commercial and residential sites.')}
      ${svc('03', 'columns', 'Institutional &amp; government supply', 'Stainless-steel equipment, work tables and sinks supplied and installed for schools, LGUs and government agencies through public bidding.')}
      ${svc('04', 'wind', 'Exhaust &amp; fresh-air systems', 'Hoods, ducting and fresh-air supply that remove heat, smoke and grease and keep the air in your kitchen moving.')}
      ${svc('05', 'sliders', 'LPG gas line installation', 'A centralised gas supply from an external tank farm to your cooking equipment, with safety controls built in.')}
      ${svc('06', 'shield', 'Kitchen fire suppression', 'Wet chemical fire suppression integrated with your range hood, protecting the cooking surface and the exhaust path.')}
    </div>
    <div class="note mt3">Hoods, exhaust, fresh air, gas line and fire suppression are planned together with your cooking line, as part of one kitchen layout.</div>
    <div class="fill">${fig('ispsc-01.jpg', 'ISPSC 2026 — wide view of the cooking stations with range ovens, sinks and overhead hoods', 'Cooking stations with range ovens, sinks and overhead hoods at ISPSC.', 'fill', '', '50% 38%')}</div>` }));

  // 6 — how we work
  pages.push(L.page({ doc: DOC, label: 'How we work', body: `
    <p class="eyebrow">04 · How we work</p>
    <h1 class="h1">How we work</h1>
    <p class="lead">One team carries your project from the first consultation through to after-sales support.</p>
    <div class="cols c32 gap8 mt3 top">
      <div>${L.stepsHtml('roomy')}</div>
      <div>
        <figure class="fig frame"><div class="ph-box" style="height:128mm"><img src="${img('ispsc-06.jpg')}" alt="ISPSC 2026 — sink station with an overhead shelf" style="object-position:50% 40%"></div><figcaption>A sink station with an overhead shelf, installed at ISPSC.</figcaption></figure>
        <div class="note mt4">For a larger project (a hospital, school, hotel or commissary), send us a full project brief. It helps us plan your layout, equipment, exhaust and utilities before our site visit.</div>
      </div>
    </div>
    <div class="fill">${fig('dmmmsu-03.jpg', 'DMMMSU — stainless-steel tables and racks installed in the room', 'Stainless-steel tables and racks installed in a room on a campus.', 'fill', '50% 60%')}</div>` }));

  // 7 — materials and finishes
  pages.push(L.page({ doc: DOC, label: 'Materials and finishes', body: `
    <p class="eyebrow">05 · Materials and finishes</p>
    <h1 class="h1">Two grades, three finishes</h1>
    <p class="lead">We work in two grades, food-grade SS304 as standard and laboratory-grade SS316 on request, in a brushed, mirror or satin finish.</p>
    <div class="cols c2 gap4 mt3 stretch">
      <div class="card"><p class="h4">Standard</p><div class="h3">SS304 food grade</div><p>Food-grade SS304 stainless steel is our standard for kitchens: preparation tables, sinks, cabinets, shelving and racks.</p></div>
      <div class="card"><p class="h4">On request</p><div class="h3">SS316 laboratory grade</div><p>Laboratory-grade SS316 stainless steel is available on request and suits laboratories and school science rooms.</p></div>
    </div>
    <p class="h4 mt4">Finishes</p>
    <div class="cols c3 gap4 mt1">
      <div><div class="sw brushed"></div><div class="h3 mt1">Brushed</div><p class="sm muted">A visible straight grain. The usual choice for work surfaces, because it hides everyday scratches.</p></div>
      <div><div class="sw mirror"></div><div class="h3 mt1">Mirror</div><p class="sm muted">Polished to a high gloss. It suits decorative parts and low-contact areas.</p></div>
      <div><div class="sw satin"></div><div class="h3 mt1">Satin</div><p class="sm muted">A soft, low-sheen finish between brushed and mirror, with a smoother, more even look.</p></div>
    </div>
    <p class="xs muted mt1">The swatches are illustrations. Ask to see a sample before you decide.</p>
    <div class="note mt3">${L.esc(CONSTRUCTION_NOTE)}</div>
    <div class="note mt2">Need SS316? Say so when you send a project brief or message us, and we will confirm it for your project.</div>
    <div class="fill">${fig('ispsc-02.jpg', 'ISPSC 2026 — rows of stainless-steel work tables in the school room', 'Rows of stainless-steel work tables in a school room.', 'fill')}</div>` }));

  // 8 — built to order
  pages.push(L.page({ doc: DOC, label: 'Built to order', body: `
    <p class="eyebrow">06 · Built to order</p>
    <h1 class="h1">Built to order</h1>
    <p class="lead">Every piece is made to your exact dimensions. Seams are welded and ground smooth, and surfaces are polished to a professional finish.</p>
    <p class="h4 mt3">From drawing to finished piece</p>
    <div class="cols c4 gap4 mt1 stretch">
      <div class="card"><div class="icb">${ic('pencil')}</div><div class="h3 mt1">Drawings</div><p>We prepare precise drawings from your kitchen’s layout.</p></div>
      <div class="card"><div class="icb">${ic('layers')}</div><div class="h3 mt1">Cutting, punching and bending</div><p>Industrial machines cut, punch and bend the metal into shape.</p></div>
      <div class="card"><div class="icb">${ic('wrench')}</div><div class="h3 mt1">Welding and grinding</div><p>Skilled technicians weld the components together and grind down any rough seams, so every surface is smooth and easy to clean.</p></div>
      <div class="card"><div class="icb">${ic('star')}</div><div class="h3 mt1">Polishing</div><p>Surfaces are polished to a professional finish.</p></div>
    </div>
    <p class="h4 mt4">What made to order means</p>
    <div class="cols c3 gap4 mt1 stretch">
      <div class="card paper"><div class="icb gold">${ic('ruler')}</div><div class="h3 mt1">Your sizes</div><p>Set your own length, width and height. Nothing is cut to a catalogue size you did not choose.</p></div>
      <div class="card paper"><div class="icb gold">${ic('clipboard')}</div><div class="h3 mt1">Your layout</div><p>The equipment is planned around your space and the way your team works.</p></div>
      <div class="card paper"><div class="icb gold">${ic('sliders')}</div><div class="h3 mt1">Your options</div><p>Layers, sinks, burners, tiers, doors and shelves are chosen one by one.</p></div>
    </div>
    <div class="fill"><div class="cols c2 gap4">
      ${fig('ispsc-04.jpg', 'ISPSC 2026 — stainless-steel work tables with the protective film still on', 'New work tables, with the protective film still on.', 'fill')}
      ${fig('dmmmsu-06.jpg', 'DMMMSU — close-up of a stainless-steel rack', 'A close-up of a stainless-steel rack.', 'fill', '50% 35%')}
    </div></div></div>` }));

  // 9 — who we serve
  const seg = (icon, t, d) => `<div class="tile-ic">${icb(icon)}<div><div class="h3">${t}</div><p>${d}</p></div></div>`;
  pages.push(L.page({ doc: DOC, label: 'Who we serve', body: `
    <p class="eyebrow">07 · Who we serve</p>
    <h1 class="h1">Who we serve</h1>
    <p class="lead">We plan and build kitchens and stainless-steel installations for food businesses, institutions and homes.</p>
    <div class="cols c2 gap8 mt3 top">
      <div>
        ${seg('fork', 'Restaurants', 'Cooking lines, preparation and washing stations, hoods and ducting, built to your layout.')}
        ${seg('cup', 'Cafés', 'Work tables, sinks, shelving and cabinets sized for a compact space.')}
        ${seg('hotel', 'Hotels', 'Full-kitchen fit-outs with exhaust, fresh air, gas lines and fire suppression.')}
        ${seg('hospital', 'Hospitals', 'Kitchen and food-service equipment built to your specifications and installed on site.')}
      </div>
      <div>
        ${seg('flask', 'Schools and laboratories', 'Work tables, sinks, ranges and hoods, with laboratory-grade SS316 on request.')}
        ${seg('boxes', 'Commissaries', 'Production kitchens planned zone by zone from your project brief.')}
        ${seg('columns', 'Government and LGUs', 'Equipment supplied and installed through public bidding. PhilGEPS-registered.')}
        ${seg('home', 'Homes', 'Railings, gates and stainless-steel work fabricated to your drawing for residential sites.')}
      </div>
    </div>
    <div class="band mt4"><p class="eyebrow">Larger project?</p><p class="mt1" style="color:#fff;font-size:11pt;line-height:1.5">For a hospital, school, hotel or commissary, send us a full project brief. It helps us plan your layout, equipment, exhaust and utilities before our site visit.</p><p class="sm mt1" style="color:var(--goldlite)">${link(CO.briefUrl, CO.briefText)}</p></div>
    <div class="fill">${fig('dmmmsu-02.jpg', 'DMMMSU — room installed with stainless-steel tables, racks and shelving', 'A room installed with stainless-steel tables, racks and shelving.', 'fill')}</div>` }));

  // 10 — projects
  pages.push(L.page({ doc: DOC, label: 'Projects', body: `
    <p class="eyebrow">08 · Projects</p>
    <h1 class="h1">Completed for state universities</h1>
    <p class="lead">Two completed government projects: Don Mariano Marcos Memorial State University (DMMMSU) and Ilocos Sur Polytechnic State College (ISPSC).</p>
    <div class="mt3">
      ${fig('ispsc-01.jpg', 'ISPSC 2026 — wide view of the cooking stations with range ovens, sinks and overhead hoods', '', 66)}
      <div class="cols c23 gap8 mt2 top">
        <div><p class="h4">ISPSC 2026</p><div class="h2 mt1">Ilocos Sur Polytechnic State College</div><p class="sm mt1">Stainless-steel laboratory and kitchen work tables, sinks, gas ranges and exhaust hoods, fabricated and installed in a school room (March 2026).</p></div>
        <dl class="facts"><div><dt>Completed</dt><dd>March 2026</dd></div><div><dt>Location</dt><dd>Ilocos Sur</dd></div><div><dt>Scope</dt><dd>Fabricated and installed in a school room</dd></div></dl>
      </div>
    </div>
    <div class="mt4">
      ${fig('dmmmsu-01.jpg', 'DMMMSU — finished commercial kitchen with range, hood and work tables', '', 66)}
      <div class="cols c23 gap8 mt2 top">
        <div><p class="h4">DMMMSU 2022–2023</p><div class="h2 mt1">Don Mariano Marcos Memorial State University</div><p class="sm mt1">Stainless-steel equipment delivered and installed on campus in La Union (March 2023 – December 2025).</p></div>
        <dl class="facts"><div><dt>Dates</dt><dd>March 2023 – December 2025</dd></div><div><dt>Location</dt><dd>La Union</dd></div><div><dt>Work</dt><dd>Equipment delivered and installed on campus</dd></div></dl>
      </div>
    </div>
    <p class="xs muted mta">More photographs and details are in our portfolio: ${CO.site}/downloads/barro-industries-portfolio.pdf</p>` }));

  // 11 — areas we serve
  pages.push(L.page({ doc: DOC, label: 'Areas we serve', body: `
    <p class="eyebrow">09 · Areas we serve</p>
    <h1 class="h1">Projects across Luzon</h1>
    <p class="lead">From Ilocos Sur in the north to Batangas in the south, we have projects across Luzon. Our office is in Tandang Sora, Quezon City.</p>
    <div class="cols c32 gap8 mt3 top">
      <figure class="fig"><div class="ph-box" style="height:auto;background:#FAF8F4;padding:5mm;border:.25mm solid var(--line)">${L.luzonMap()}</div><figcaption class="c">Schematic map, not to scale</figcaption></figure>
      <div>
        <div class="stat-big">13</div><div class="stat-lbl">locations across Luzon</div>
        ${L.LUZON.map(([g, ps]) => `<p class="h4 mt3">${g}</p><div class="lz-places mt1"><ul>${ps.map((p) => `<li>${p}</li>`).join('')}</ul></div>`).join('')}
      </div>
    </div>
    <div class="fill">${fig('dmmmsu-04.jpg', 'DMMMSU — stainless-steel shelving and work tables after installation', 'Stainless-steel shelving and work tables after installation on a campus.', 'fill')}</div>
    <div class="note mt2">We have completed projects in each of these places. In La Union, we delivered and installed stainless-steel equipment on the campus of Don Mariano Marcos Memorial State University (DMMMSU).</div>` }));

  // 12 — registrations, warranty, after-sales
  pages.push(L.page({ doc: DOC, label: 'Registrations and warranty', body: `
    <p class="eyebrow">10 · Registrations, warranty and after-sales</p>
    <h1 class="h1">Registered, and here after handover</h1>
    <p class="lead">${CO.legal} is PhilGEPS-registered, SEC-registered and VAT-registered. Our support continues once your kitchen is installed.</p>
    <p class="h4 mt3">Registrations</p>
    <div class="mt1">${L.regs()}</div>
    <p class="sm mt2">We supply and install through public bidding, and government purchases follow procurement rules.</p>
    <p class="h4 mt4">Warranty</p>
    <div class="mt1">${L.warranty()}</div>
    <p class="h4 mt4">After-sales</p>
    <div class="cols c2 gap4 mt1 stretch">
      <div class="card"><div class="icb">${ic('headset')}</div><div class="h3 mt1">Service and support</div><p>Service and support continue after handover, from one team.</p></div>
      <div class="card"><div class="icb">${ic('shield')}</div><div class="h3 mt1">KitchenShield™</div><p>Preventive maintenance service (PMS) for full-kitchen projects, for 12 months.</p></div>
    </div>
    <div class="fill">${fig('ispsc-02.jpg', 'ISPSC 2026 — rows of stainless-steel work tables in the school room', 'Rows of stainless-steel work tables in a school room.', 'fill', '50% 55%')}</div>` }));

  // 13 — contact
  pages.push(L.contactPage({ doc: DOC, lead: 'Tell us about your kitchen and we will come back with a quotation. No account needed.' }));

  return L.docHtml({ title: META.title, pages });
}
module.exports = { build, META };
