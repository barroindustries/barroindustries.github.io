// tests/site-luzon-map.test.mjs — the 2026-10-21 owner additions to the PUBLIC homepage (index.html #site + head JSON-LD):
//
//   1. "Projects across Luzon": an inline SVG schematic map of Luzon with 13 project pins, plus the same 13 places as a plain
//      HTML list. The pins are projected from real coordinates (equirectangular, standard parallel 15.6 N) and the coastline is
//      checked against real landmarks (towns that must be land, bays that must be water), real extents and real areas, so a
//      hand edit of the outline cannot quietly make Luzon look wrong. Labels must not collide.
//   2. No project-count claim anywhere (the owner withdrew "500+ projects": it cannot be documented).
//   3. "Trusted by state universities": typography only, exactly the two institutions the owner named.
//   4. "How we work": six numbered steps, no durations (a TODO-NEIL comment per step holds the slot).
//   5. "Warranty & after-sales": the owner's two facts in two cards, nothing added (KitchenShield™ keeps its mark).
//   6. The verified Google Maps place: Contact links, JSON-LD geo + hasMap, and no embedded iframe (CSP frame-src 'self').
//   7. No government-agency logos.
//
// The La Union / San Fernando address guard in tests/catalogue-public.test.mjs is narrowed to match (La Union is a project
// location in section #luzon and in areaServed; it is still never an address) and is re-pinned here from the other side.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const home = read('index.html');
const homeSite = home.slice(home.indexOf('<div id="site"'), home.indexOf('<!-- /#site -->'));
const homeHead = home.slice(0, home.indexOf('</head>'));
const css = read('css/site.css');
const js = read('js/site.js');

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const stripTags = (html, sep = ' ') => html.replace(/<!--[\s\S]*?-->/g, sep).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, sep).replace(/<[^>]+>/g, sep);
const visibleText = (html) => decode(stripTags(html)).replace(/\s+/g, ' ').trim();
const attrText = (html) => [...html.matchAll(/\s(?:alt|aria-label|placeholder|title)="([^"]*)"|<meta[^>]*\scontent="([^"]*)"/g)].map(m => decode(m[1] || m[2] || '')).join(' | ');
const sectionOf = (html, id) => {
  const i = html.indexOf(`<section id="${id}"`);
  assert.ok(i >= 0, `section #${id} is missing`);
  return html.slice(i, html.indexOf('</section>', i) + '</section>'.length);
};
const luzon = sectionOf(homeSite, 'luzon');
const process_ = sectionOf(homeSite, 'process');
const warranty = sectionOf(homeSite, 'warranty');
const projects = sectionOf(homeSite, 'projects');
const about = sectionOf(homeSite, 'about');
const contact = sectionOf(homeSite, 'contact');
const ld = JSON.parse(homeHead.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

const PLACE_URL = 'https://www.google.com/maps/place/Barro+Industries/@14.6852336,121.0376564,17z/data=!3m1!4b1!4m6!3m5!1s0x3397b7e5c5101e17:0x43c0f9fffeef237!8m2!3d14.6852336!4d121.0376564!16s%2Fg%2F11p24zhgfq';

// ── the 13 owner places: id, list text, real coordinates (lat, lon) ──────────────────────
const PLACES = [
  ['ilocos-sur', 'Ilocos Sur', 17.57, 120.39], ['la-union', 'La Union', 16.62, 120.32], ['baguio', 'Baguio', 16.41, 120.60],
  ['la-trinidad', 'La Trinidad', 16.46, 120.59], ['tarlac', 'Tarlac', 15.48, 120.59], ['pampanga', 'Pampanga', 15.03, 120.69],
  ['bulacan', 'Bulacan', 14.84, 120.81], ['iba-zambales', 'Iba, Zambales', 15.33, 119.98], ['subic', 'Subic', 14.88, 120.23],
  ['manila', 'Manila', 14.60, 120.98], ['cavite', 'Cavite', 14.43, 120.94], ['laguna', 'Laguna', 14.28, 121.42], ['batangas', 'Batangas', 13.76, 121.06],
];
const GROUPS = [
  ['North Luzon', ['ilocos-sur', 'la-union', 'baguio', 'la-trinidad']],
  ['Central Luzon', ['tarlac', 'pampanga', 'bulacan', 'iba-zambales', 'subic']],
  ['Metro Manila & South', ['manila', 'cavite', 'laguna', 'batangas']],
];

// ── the inline SVG ───────────────────────────────────────────────────────────────────────
const svg = luzon.match(/<svg class="lz-svg"[\s\S]*?<\/svg>/)[0];
const svgAttr = (name) => svg.match(new RegExp(`<svg [^>]*\\bdata-${name}="([^"]+)"`))[1];
const P = { lon0: +svgAttr('lon0'), lat0: +svgAttr('lat0'), phi: +svgAttr('phi'), k: +svgAttr('k'), lm: +svgAttr('lm'), tm: +svgAttr('tm') };
const project = (lat, lon) => [P.lm + (lon - P.lon0) * P.k * Math.cos(P.phi * Math.PI / 180), P.tm + (P.lat0 - lat) * P.k];
const unproject = (x, y) => [P.lat0 - (y - P.tm) / P.k, P.lon0 + (x - P.lm) / (P.k * Math.cos(P.phi * Math.PI / 180))];
const [VBX, VBY, VBW, VBH] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const pathD = (id) => svg.match(new RegExp(`<path[^>]*\\b${id}[^>]*\\sd="([^"]+)"`))[1];
const polyOf = (d) => { const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number); const out = []; for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]); return out; };
const kmPerDeg = 111.32;
const toKm = ([x, y]) => [x / P.k * kmPerDeg * 1, y / P.k * kmPerDeg]; // user units -> km: K units = 1 degree of latitude; x already carries cos(phi)
const areaKm2 = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const [x1, y1] = toKm(poly[i]), [x2, y2] = toKm(poly[(i + 1) % poly.length]); a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const crosses = (a, b, c, d) => { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };

const coast = polyOf(pathD('lz-coast'));
const lake = polyOf(pathD('lz-lake'));
const isle = polyOf(pathD('lz-isle'));

describe('Projects across Luzon: the section and its words', () => {
  it('sits immediately before the Government projects section, as its own section (no nesting)', () => {
    assert.ok(homeSite.indexOf('<section id="luzon"') > 0 && homeSite.indexOf('<section id="luzon"') < homeSite.indexOf('<section id="projects"'));
    const between = homeSite.slice(homeSite.indexOf('<section id="luzon"'), homeSite.indexOf('<section id="projects"'));
    assert.equal((between.match(/<section\b/g) || []).length, 1, 'something else sits between the map and the projects');
    assert.equal((luzon.match(/<section\b/g) || []).length, 1, 'a nested <section> would break the La Union guard');
  });

  it('has the eyebrow, the heading, one grammatical lead line and the "not to scale" note', () => {
    const t = visibleText(luzon);
    assert.match(luzon, /<p class="eyebrow">Where we work<\/p>/);
    assert.match(luzon, /<h2 id="luzon-h">Projects across Luzon<\/h2>/);
    assert.match(luzon, /<p class="site-lead">From Ilocos Sur in the north to Batangas in the south, we have projects across Luzon\.<\/p>/);
    assert.match(luzon, /<figcaption>Schematic map, not to scale<\/figcaption>/);
    assert.ok(t.includes('13 locations across Luzon'));
  });

  it('keeps the ISPSC and DMMMSU galleries', () => {
    assert.ok(projects.includes('id="proj-ispsc-2026"') && projects.includes('id="proj-dmmmsu-2022-2023"'));
  });

  it('lists the same 13 places in plain HTML, in three groups, each carrying data-pin', () => {
    const groups = [...luzon.matchAll(/<div class="luzon-group">\s*<h3>([^<]+)<\/h3>\s*<ul>([\s\S]*?)<\/ul>/g)];
    assert.equal(groups.length, 3);
    groups.forEach((g, i) => {
      assert.equal(decode(g[1]), GROUPS[i][0]);
      const items = [...g[2].matchAll(/<li data-pin="([^"]+)">([^<]+)<\/li>/g)];
      assert.deepEqual(items.map(m => m[1]), GROUPS[i][1]);
      assert.deepEqual(items.map(m => decode(m[2])), GROUPS[i][1].map(id => PLACES.find(p => p[0] === id)[1]));
    });
    assert.equal([...luzon.matchAll(/<li data-pin=/g)].length, 13);
  });

  it('is a real list: the places are text in the document, not only drawn in the picture', () => {
    const text = visibleText(luzon.replace(/<svg[\s\S]*?<\/svg>/, ''));
    for (const [, name] of PLACES) assert.ok(text.includes(name), `${name} is not in the HTML text`);
  });
});

describe('Projects across Luzon: the SVG is an accessible, honest picture', () => {
  it('is inline, role="img", named by its <title> and described by its <desc>, which list every place', () => {
    assert.match(svg, /^<svg class="lz-svg"[^>]*\srole="img"/);
    const [, t, d] = svg.match(/aria-labelledby="(\S+) (\S+)"/);
    assert.match(svg, new RegExp(`<title id="${t}">Map of Luzon[^<]*</title>`));
    const desc = svg.match(new RegExp(`<desc id="${d}">([^<]+)</desc>`))[1];
    for (const name of ['Ilocos Sur', 'La Union', 'Baguio', 'La Trinidad', 'Tarlac', 'Pampanga', 'Bulacan', 'Iba', 'Zambales', 'Subic', 'Manila', 'Cavite', 'Laguna', 'Batangas']) assert.ok(desc.includes(name), `desc misses ${name}`);
    assert.ok(/not to scale/.test(desc) && desc.includes('13 project locations'));
  });

  it('has exactly 13 pins, one label each, and a pin/label/list-item trio per place (the data-pin hover link)', () => {
    const pins = [...svg.matchAll(/<g class="lz-pin" data-pin="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(pins.slice().sort(), PLACES.map(p => p[0]).sort());
    assert.equal(new Set(pins).size, 13);
    for (const [id] of PLACES) {
      assert.equal((svg.match(new RegExp(`<text class="lz-label" data-pin="${id}"`, 'g')) || []).length, 1, `${id}: label count`);
      assert.equal((luzon.match(new RegExp(`<li data-pin="${id}">`, 'g')) || []).length, 1, `${id}: list item count`);
    }
    for (const m of svg.matchAll(/<path class="lz-leader" data-pin="([^"]+)"/g)) assert.ok(pins.includes(m[1]), `leader for unknown pin ${m[1]}`);
  });

  it('labels each pin with the owner\'s name (Iba and Zambales share one two-line label)', () => {
    for (const [id, name] of PLACES) {
      const m = svg.match(new RegExp(`<text class="lz-label" data-pin="${id}"[^>]*>([\\s\\S]*?)</text>`));
      assert.ok(m, `no label for ${id}`);
      assert.equal(visibleText(m[1]).replace(/\s+/g, ' '), name, `${id}: label text`);
    }
  });

  it('carries no comma-separated number anywhere (CHECK 9 would read "120,500" as a price): path data uses spaces only', () => {
    assert.ok(!/\b\d{1,3}(,\d{3})+\b/.test(homeSite));
    for (const id of ['lz-coast', 'lz-lake', 'lz-isle']) assert.match(pathD(id), /^M[\d. -]+L[\d. -]+Z$/, `${id} is not a plain M/L/Z polyline`);
  });
});

describe('Projects across Luzon: the pins are projected from the real coordinates', () => {
  const pinOf = (id) => { const m = svg.match(new RegExp(`<g class="lz-pin" data-pin="${id}" data-lat="([\\d.]+)" data-lon="([\\d.]+)" transform="translate\\(([\\d.]+) ([\\d.]+)\\)"`)); assert.ok(m, `pin ${id}`); return { lat: +m[1], lon: +m[2], x: +m[3], y: +m[4] }; };

  it('uses an equirectangular projection (standard parallel at the middle of Luzon) and the owner\'s coordinates', () => {
    assert.equal(svgAttr('projection'), 'equirectangular');
    assert.ok(P.phi >= 15.2 && P.phi <= 16.0, 'standard parallel is not mid-Luzon');
    for (const [id, , lat, lon] of PLACES) {
      const p = pinOf(id);
      assert.equal(p.lat, lat, `${id} latitude`);
      assert.equal(p.lon, lon, `${id} longitude`);
      const [x, y] = project(lat, lon);
      assert.ok(Math.abs(p.x - x) <= 0.06 && Math.abs(p.y - y) <= 0.06, `${id} is drawn at (${p.x}, ${p.y}) but projects to (${x.toFixed(2)}, ${y.toFixed(2)})`);
    }
  });

  it('keeps the relative positions right: north-south and east-west order, and the Baguio / La Trinidad pair', () => {
    const pts = PLACES.map(([id, , lat, lon]) => ({ id, lat, lon, ...pinOf(id) }));
    for (const a of pts) for (const b of pts) {
      if (a.lat > b.lat + 1e-9) assert.ok(a.y < b.y, `${a.id} should be north of ${b.id}`);
      if (a.lon > b.lon + 1e-9) assert.ok(a.x > b.x, `${a.id} should be east of ${b.id}`);
    }
    const bag = pinOf('baguio'), lat = pinOf('la-trinidad');
    assert.ok(lat.y < bag.y && Math.hypot(lat.x - bag.x, lat.y - bag.y) < 5, 'La Trinidad is ~5 km north of Baguio: the two pins sit almost together');
    // scale check: Manila -> Batangas City is ~95 km; Vigan -> Batangas City ~ 420 km
    const d = (a, b) => Math.hypot((a.x - b.x) / Math.cos(P.phi * Math.PI / 180) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), a.y - b.y) / P.k * kmPerDeg;
    assert.ok(Math.abs(d(pinOf('manila'), pinOf('batangas')) - 95) < 12);
    assert.ok(Math.abs(d(pinOf('ilocos-sur'), pinOf('batangas')) - 440) < 45);
  });
});

describe('Projects across Luzon: the coastline reads as Luzon', () => {
  const inLand = ([lat, lon]) => inside(project(lat, lon), coast);

  it('spans the real extents of the island (Cape Bojeador-Claveria in the north to Matnog in the south, Bolinao to Sorsogon)', () => {
    const lats = coast.map(([x, y]) => unproject(x, y)[0]), lons = coast.map(([x, y]) => unproject(x, y)[1]);
    const n = Math.max(...lats), s = Math.min(...lats), w = Math.min(...lons), e = Math.max(...lons);
    assert.ok(n >= 18.58 && n <= 18.72, `northernmost ${n.toFixed(2)}`);
    assert.ok(s >= 12.48 && s <= 12.64, `southernmost ${s.toFixed(2)}`);
    assert.ok(w >= 119.68 && w <= 119.84, `westernmost ${w.toFixed(2)}`);
    assert.ok(e >= 124.05 && e <= 124.25, `easternmost ${e.toFixed(2)}`);
  });

  it('has about the area of Luzon (~104,700 km2 mainland; ~110,000 with its small islands) and no self-intersection', () => {
    const a = areaKm2(coast);
    assert.ok(a > 98000 && a < 112000, `area ${Math.round(a)} km2`);
    for (let i = 0; i < coast.length; i++) for (let j = i + 2; j < coast.length; j++) {
      if (i === 0 && j === coast.length - 1) continue;
      assert.ok(!crosses(coast[i], coast[(i + 1) % coast.length], coast[j], coast[(j + 1) % coast.length]), `the outline crosses itself near vertex ${i}/${j}`);
    }
  });

  it('puts known towns on land and known bays and gulfs in the water', () => {
    const land = { Baguio: [16.41, 120.60], 'Tarlac City': [15.48, 120.59], Cabanatuan: [15.49, 120.97], Angeles: [15.15, 120.59], Tuguegarao: [17.61, 121.73], 'Santiago City': [16.69, 121.55], Cauayan: [16.93, 121.77], Antipolo: [14.59, 121.18], Tagaytay: [14.10, 120.96], Lipa: [13.94, 121.16], 'Naga City': [13.62, 123.18], Mayon: [13.26, 123.69], Legazpi: [13.14, 123.74], 'Sorsogon interior': [12.8, 124.0] };
    const sea = { 'Manila Bay': [14.55, 120.78], 'Lingayen Gulf': [16.15, 120.20], 'West Philippine Sea off Zambales': [15.4, 119.6], 'Tayabas Bay': [13.72, 121.8], 'Ragay Gulf': [13.65, 122.78], 'Lamon Bay': [14.15, 122.2], 'Verde Island Passage': [13.5, 121.0], 'Balayan Bay': [13.85, 120.78], 'San Miguel Bay': [13.9, 123.28], 'Philippine Sea off Cagayan': [18.0, 123.0], 'Babuyan Channel': [19.0, 121.0], 'South China Sea off Ilocos': [17.5, 119.8] };
    for (const [n, c] of Object.entries(land)) assert.ok(inLand(c), `${n} should be land`);
    for (const [n, c] of Object.entries(sea)) assert.ok(!inLand(c), `${n} should be water`);
  });

  it('keeps every project pin on land, and the coastal ones close to the shore', () => {
    for (const [id, , lat, lon] of PLACES) assert.ok(inLand([lat, lon]), `${id} pin is in the sea`);
    const shore = ([lat, lon]) => { const [x, y] = project(lat, lon); let best = 1e9; for (let i = 0; i < coast.length; i++) { const [ax, ay] = coast[i], [bx, by] = coast[(i + 1) % coast.length]; const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return best / P.k * kmPerDeg; };
    for (const id of ['ilocos-sur', 'la-union', 'iba-zambales', 'manila', 'bulacan', 'batangas', 'cavite', 'subic']) { const p = PLACES.find(q => q[0] === id); assert.ok(shore([p[2], p[3]]) < 9, `${id} is ${shore([p[2], p[3]]).toFixed(1)} km from the drawn shore`); }
  });

  it('draws Laguna de Bay as a lake of about the right size, with Talim Island, and the Laguna pin on its shore, not in it', () => {
    const a = areaKm2(lake), t = areaKm2(isle);
    assert.ok(a > 780 && a < 1050, `lake ${Math.round(a)} km2 (real: ~911)`);
    assert.ok(t > 20 && t < 65, `Talim ${Math.round(t)} km2 (real: ~38)`);
    assert.ok(lake.every(v => inside(v, coast)), 'the lake leaves the island');
    assert.ok(isle.every(v => inside(v, lake)), 'Talim leaves the lake');
    assert.ok(!inside(project(14.28, 121.42), lake), 'the Laguna pin is in the lake');
    assert.ok(!inside(project(14.60, 120.98), lake), 'the Manila pin is in the lake');
    assert.ok(inside(project(14.35, 121.15), lake), 'the middle of Laguna de Bay is not water');
  });
});

describe('Projects across Luzon: no label collides with another label or a pin', () => {
  const FONT = +css.match(/#site \.lz-label\{[^}]*font:600 (\d+(?:\.\d+)?)px/)[1];    // the phone size, the larger of the two
  const WIDTH = 0.6;                                                              // average glyph width, em (generous for Inter 600)
  const labels = [...svg.matchAll(/<text class="lz-label" data-pin="([^"]+)" x="([\d.]+)" y="([\d.]+)"(?: text-anchor="(\w+)")?>([\s\S]*?)<\/text>/g)].map(m => {
    const lines = [...m[5].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(t => t[1]); const text = lines.length ? lines : [m[5]];
    const w = Math.max(...text.map(s => s.length)) * FONT * WIDTH, x = +m[2], y = +m[3], anchor = m[4] || 'start';
    const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    return { id: m[1], x0, x1: x0 + w, y0: y - FONT * 0.78, y1: y + FONT * 0.25 + (text.length - 1) * FONT };
  });
  const pins = PLACES.map(([id, , lat, lon]) => ({ id, ...(() => { const [x, y] = project(lat, lon); return { x, y }; })() }));

  it('has the label font size in the stylesheet and 13 labels in the picture', () => {
    assert.ok(FONT >= 12 && FONT <= 14);
    assert.equal(labels.length, 13);
  });

  it('keeps every label inside the viewBox', () => {
    for (const l of labels) assert.ok(l.x0 >= VBX && l.x1 <= VBX + VBW && l.y0 >= VBY && l.y1 <= VBY + VBH, `${l.id} leaves the viewBox`);
  });

  it('never overlaps two labels', () => {
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      assert.ok(!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1), `${a.id} overlaps ${b.id}`);
    }
  });

  it('never covers a pin (the Baguio / La Trinidad pins overlap each other by geography, not by layout)', () => {
    for (const l of labels) for (const p of pins) {
      const cx = Math.max(l.x0, Math.min(p.x, l.x1)), cy = Math.max(l.y0, Math.min(p.y, l.y1));
      assert.ok(Math.hypot(cx - p.x, cy - p.y) >= 5.3, `the ${l.id} label covers the ${p.id} pin`);
    }
  });
});

describe('Projects across Luzon: look, behaviour, motion and layout', () => {
  it('draws gold pins with a navy ring, the land as a navy line on a navy tint, and uses only the site\'s own tokens', () => {
    assert.match(css, /#site \.lz-core\{fill:var\(--site-gold\);stroke:var\(--site-navy\)/);
    assert.match(css, /#site \.lz-land\{fill:var\(--site-tint\);stroke:var\(--site-navy\)/);
    assert.match(css, /--site-tint:#E6EAF2;/);
    assert.ok(!/#0F6CBD|#2886DE/i.test(css));
  });

  it('links a hovered or focused place to its pin with class toggles only (no HTML written, no storage, no network)', () => {
    assert.ok(js.includes("$('luzon')") && js.includes('[data-pin="'));
    for (const ev of ['mouseover', 'mouseout', 'focusin', 'focusout']) assert.ok(js.includes(`'${ev}'`), `no ${ev} handler`);
    assert.ok(js.includes("classList.add('is-on')") && js.includes("classList.remove('is-on')"));
    assert.match(css, /#site \.lz-pin\.is-on \.lz-core\{/);
    assert.match(css, /#site \.luzon-group li\.is-on\{/);
  });

  it('adds no animation of its own, and the global reduced-motion rule that switches transitions off is intact', () => {
    const block = css.slice(css.indexOf('/* projects across Luzon'), css.indexOf('/* about: the "23" story moment */'));
    assert.ok(block.length > 3000, 'the new CSS block was not found');
    assert.ok(!/@keyframes|animation\s*:/.test(block), 'the new sections animate');
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*#site \*,#site \*::before,#site \*::after\{transition:none !important;animation:none !important\}/);
    assert.ok(!/z-index:\s*\d{4}/.test(css));
  });

  it('puts the map above the list on a phone (markup order) and side by side from 1024px', () => {
    const iHead = luzon.indexOf('<header class="sec-head'), iMap = luzon.indexOf('<figure class="luzon-map'), iList = luzon.indexOf('<div class="luzon-places');
    assert.ok(iHead < iMap && iMap < iList, 'markup order must be heading, map, list');
    assert.match(css, /#site \.luzon-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
    assert.match(css, /@media \(min-width:1024px\)\{[^@]*#site \.luzon-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);grid-template-areas:"head map" "places map"/);
    assert.match(css, /@media \(min-width:600px\)\{\s*#site \.luzon-places\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  });
});

describe('JSON-LD: the 13 areas served, the verified Google Maps place, and nothing unverified', () => {
  it('lists the 13 places as areaServed (Place names), in list order, and leaves the business address untouched', () => {
    assert.ok(Array.isArray(ld.areaServed) && ld.areaServed.length === 13);
    assert.ok(ld.areaServed.every(a => a['@type'] === 'Place' && Object.keys(a).sort().join() === '@type,name'));
    assert.deepEqual(ld.areaServed.map(a => a.name), GROUPS.flatMap(g => g[1]).map(id => PLACES.find(p => p[0] === id)[1]));
    assert.deepEqual(ld.address, { '@type': 'PostalAddress', streetAddress: '21 Capricorn St., Tandang Sora', addressLocality: 'Quezon City', postalCode: '1116', addressRegion: 'Metro Manila', addressCountry: 'PH' });
  });

  it('carries the Google Maps place\'s coordinates (geo) and its URL (hasMap), and still no rating, opening hours or price range', () => {
    assert.deepEqual(ld.geo, { '@type': 'GeoCoordinates', latitude: 14.6852336, longitude: 121.0376564 });
    assert.equal(ld.hasMap, PLACE_URL);
    for (const k of ['priceRange', 'aggregateRating', 'openingHours', 'openingHoursSpecification', 'review']) assert.ok(!(k in ld), `${k} must not be claimed`);
    // the coordinates are the place URL's own (@lat,lon, !3d, !4d) and are in Tandang Sora, Quezon City
    assert.ok(PLACE_URL.includes(`@${ld.geo.latitude},${ld.geo.longitude},`) && PLACE_URL.includes(`!3d${ld.geo.latitude}`) && PLACE_URL.includes(`!4d${ld.geo.longitude}`));
    assert.ok(ld.geo.latitude > 14.65 && ld.geo.latitude < 14.72 && ld.geo.longitude > 121.0 && ld.geo.longitude < 121.08);
  });

  it('keeps La Union only where the owner allowed it: the map section, the DMMMSU project entry in #projects (owner, 2026-10-21) and areaServed — never the contact section, footer, address or head tags', () => {
    // Owner 2026-10-22: the About line names where the family business began (Baguio City and La Union) — allowed there, once.
    const ABOUT_ORIGIN = '<p class="about-note">The company began as a family business in Baguio City and La Union.</p>';
    assert.ok(homeSite.includes(ABOUT_ORIGIN));
    const outsideMap = homeSite.replace(luzon, '').replace(projects, '').replace(ABOUT_ORIGIN, '');
    assert.ok(!/La\s*Union|San\s*Fernando/i.test(outsideMap), 'La Union / San Fernando appears in #site outside the map section and the projects');
    // in #projects it is the DMMMSU description and nothing else: not the ISPSC entry, a heading, a photo's alt text or a tag
    assert.equal((projects.match(/La\s*Union/gi) || []).length, 1, 'La Union appears more than once in #projects');
    assert.ok(projects.includes('<p>Stainless-steel equipment delivered and installed on campus in La Union (March 2023 – December 2025).</p>'));
    assert.equal((projects.match(/<section\b/g) || []).length, 1, 'a nested <section> would break the La Union guard');
    const headNoAreas = homeHead.replace(/"areaServed":\[[^\]]*\],?/, '');
    assert.ok(!/La\s*Union|San\s*Fernando/i.test(headNoAreas), 'La Union / San Fernando appears in the head outside areaServed');
    assert.ok(/La Union/.test(luzon) && ld.areaServed.some(a => a.name === 'La Union'));
    assert.ok(!/San\s*Fernando/i.test(home.slice(0, home.indexOf('<!-- /#site -->'))), 'San Fernando is never named');
    assert.ok(!/0960/.test(homeSite + homeHead), 'the 0960 number is banned everywhere');
    assert.ok(!/purok|carlatan/i.test(homeSite + homeHead), 'the old La Union address is back');
  });
});

describe('No project-count claim (owner, 2026-10-21: "500+ projects" removed, it cannot be documented)', () => {
  const proof = homeSite.match(/<ul class="proof-bar"[\s\S]*?<\/ul>/)[0];
  const items = [...proof.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => visibleText(m[1]));

  it('keeps the four original proof items, 23 years first and End-to-end restored', () => {
    assert.deepEqual(items.map(t => t.split(' ')[0]), ['23', 'SS304', 'Made', 'End-to-end']);
  });

  it('About keeps the family-business line and the SEC-registered wording, with no project count', () => {
    const t = visibleText(about);
    assert.ok(t.includes('The company began as a family business in Baguio City and La Union.'));
    assert.ok(t.includes('Barro Industries OPC is an SEC-registered manufacturing company built on precision, quality and a commitment to long-term growth.'));
  });

  it('states no number of projects, clients or customers anywhere a visitor or crawler reads', () => {
    const text = visibleText(homeSite);
    const re = /\b\d[\d,]*\+?\s+(projects|clients|customers|kitchens installed)/i;
    assert.ok(!re.test(text), 'a project-count claim is on the page');
    assert.ok(!re.test(home.match(/<title>[^<]*<\/title>/)[0] + attrText(homeHead) + JSON.stringify(ld) + attrText(homeSite)));
  });
});

describe('Trusted by state universities: typography only, exactly two institutions', () => {
  const trust = projects.match(/<p class="trust[^"]*">[\s\S]*?<\/p>/)[0];

  it('reads exactly as the owner worded it', () => {
    assert.equal(visibleText(trust), 'Trusted by state universities: Don Mariano Marcos Memorial State University (DMMMSU) · Ilocos Sur Polytechnic State College (ISPSC)');
  });

  it('has no logos, seals, images or links, and sits inside the projects section ahead of the galleries', () => {
    assert.ok(!/<(img|svg|picture|a|use)\b/i.test(trust));
    assert.ok(projects.indexOf('class="trust') < projects.indexOf('id="proj-ispsc-2026"'));
    assert.match(css, /#site \.trust-name\{[^}]*font:500 1\.1875rem\/1\.35 var\(--site-serif\)/);
  });

  it('names no other client anywhere on the homepage', () => {
    const text = visibleText(homeSite);
    for (const other of ['Lorma', 'ITRMC', 'Bethany', 'Casa Carmelo', 'Cosmos', 'Chibab', 'Aboy', 'Florante', 'Vhia']) assert.ok(!text.includes(other), `${other} is named on the homepage`);
  });
});

describe('How we work: six numbered steps, no durations', () => {
  const steps = [...process_.matchAll(/<li class="step">([\s\S]*?)<\/li>/g)].map(m => m[1]);

  it('comes after the projects and before the warranty, as an ordered list', () => {
    assert.ok(homeSite.indexOf('<section id="projects"') < homeSite.indexOf('<section id="process"') && homeSite.indexOf('<section id="process"') < homeSite.indexOf('<section id="warranty"'));
    assert.match(process_, /<ol class="steps reveal" role="list">/);
    assert.match(process_, /<h2 id="process-h">How we work<\/h2>/);
  });

  it('has the owner\'s six steps in order, each with a one-line description', () => {
    assert.equal(steps.length, 6);
    const titles = steps.map(s => visibleText(s.match(/<h3>([\s\S]*?)<\/h3>/)[1]));
    assert.deepEqual(titles, ['Consultation & site visit', 'Design & layout', 'Fabrication', 'Delivery', 'Installation & commissioning', 'After-sales support']);
    steps.forEach((s, i) => { assert.equal((s.match(/<span class="step-num" aria-hidden="true">(\d)<\/span>/) || [])[1], String(i + 1)); const p = visibleText(s.match(/<p>([\s\S]*?)<\/p>/)[1]); assert.ok(p.length > 20 && p.length < 110 && /\.$/.test(p), `step ${i + 1} description`); });
    const fab = visibleText(steps[2]);
    assert.ok(fab.includes('SS304') && /seams welded and ground smooth/.test(fab), 'Fabrication must name SS304 and the welded and ground seams');
  });

  it('shows no duration, and leaves one "TODO-NEIL: typical duration" comment per step for the owner to fill', () => {
    for (const s of steps) assert.equal((s.match(/<!-- TODO-NEIL: typical duration -->/g) || []).length, 1);
    assert.equal((process_.match(/TODO-NEIL/g) || []).length, 6);
    const t = visibleText(process_);
    assert.ok(!/\b(\d+|one|two|three|four|five|six|seven|ten|few|several)[ -]?(minutes?|hours?|days?|weeks?|months?|years?|working)\b/i.test(t), 'a duration is visible');
    assert.ok(!/\b(within|same[- ]day|next[- ]day|overnight|turnaround|lead time)\b/i.test(t), 'a time promise is visible');
  });

  it('is a vertical timeline on a phone and one horizontal line of six from 1024px', () => {
    assert.match(css, /#site \.steps\{display:grid;grid-template-columns:minmax\(0,1fr\);list-style:none\}/);
    assert.match(css, /@media \(min-width:1024px\)\{[^@]*#site \.steps\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  });
});

describe('Warranty & after-sales: the owner\'s two facts, exactly', () => {
  const cards = [...warranty.matchAll(/<article class="wcard[^"]*">([\s\S]*?)<\/article>/g)].map(m => m[1]);

  it('has two cards: the 6-month service warranty and the 12 months of PMS with KitchenShield™', () => {
    assert.equal(cards.length, 2);
    assert.ok(visibleText(cards[0]).includes('A 6-month service warranty on our equipment and work.'));
    assert.ok(visibleText(cards[1]).includes('Full-kitchen projects include 12 months of preventive maintenance service (PMS) with KitchenShield™.'));
    assert.match(warranty, /<h2 id="warranty-h">Warranty &amp; after-sales<\/h2>/);
  });

  it('adds no other term: only the numbers 6 and 12, no lifetime / guarantee / parts / labour / free / unlimited', () => {
    const t = visibleText(warranty);
    assert.deepEqual([...new Set(t.match(/\d+/g))].sort(), ['12', '6']);
    assert.ok(!/\b(lifetime|guarantee[ds]?|parts|labou?r|free|unlimited|replacement|on[- ]site|24\/7|hours?|days?|years?|extended|full coverage)\b/i.test(t), 'a term the owner did not give is in the warranty section');
  });

  it('keeps the ™ on KitchenShield exactly once, and the page has just two marks (the header brand and KitchenShield)', () => {
    assert.equal((homeSite.match(/KitchenShield™/g) || []).length, 1);
    assert.equal((homeSite.match(/KitchenShield/g) || []).length, 1);
    assert.equal((visibleText(homeSite).match(/™/g) || []).length, 2);
    assert.ok(homeSite.includes('<span class="site-brand-sub"><span data-brand>Barro Kitchens</span>™</span>'));
  });

  it('comes after How we work, before About, as two navy cards', () => {
    assert.ok(homeSite.indexOf('<section id="warranty"') < homeSite.indexOf('<section id="about"'));
    assert.match(css, /#site \.wcard\{[^}]*background:var\(--site-navy\)/);
    assert.match(css, /#site \.wcards\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  });
});

describe('The Google listing: Contact links, JSON-LD, and no iframe', () => {
  it('points "Get directions" at the place URL, opens it in a new tab with rel="noopener", and adds "View on Google Maps"', () => {
    const links = [...contact.matchAll(/<a class="contact-dir" href="([^"]+)" rel="noopener" target="_blank">([^<]+)<\/a>/g)];
    assert.deepEqual(links.map(m => m[2]), ['Get directions', 'View on Google Maps']);
    for (const l of links) assert.equal(l[1], PLACE_URL);
    assert.ok(!/maps\/search\/\?api=1/.test(homeSite), 'the old search link is still there');
    assert.ok(contact.includes('<address>21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila, Philippines</address>'));
  });

  it('embeds nothing from Google: no iframe in the site or head, no maps embed anywhere, and the CSP still says frame-src \'self\'', () => {
    assert.ok(!/<iframe\b/i.test(homeSite + homeHead));
    assert.ok(!/maps\/embed|output=embed|<embed\b|<object\b/i.test(home));
    assert.match(home, /<meta http-equiv="Content-Security-Policy" content="[^"]*frame-src 'self';/);
  });
});

describe('No government-agency logos or seals', () => {
  it('uses no image whose name, alt or class suggests SEC / DTI / PhilGEPS / BIR / a seal, and the registrations are plain words', () => {
    const imgs = [...homeSite.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
    assert.ok(imgs.length > 10);
    for (const tag of imgs.filter(x => /\ssrc="/.test(x))) {        // the empty lightbox <img> has no src until a photo opens
      assert.ok(!/\b(sec|dti|philgeps|bir|bureau|seal|certificate|accreditation|iso)\b/i.test(tag.replace(/srcset="[^"]*"/, '')), `an agency-style image: ${tag.slice(0, 90)}`);
      assert.ok(/site\/img\/(projects|barro-kitchens-96)/.test(tag), `an unexpected image source: ${tag.slice(0, 90)}`);
    }
    // Owner 2026-10-21: the company IS PhilGEPS-, SEC- and VAT-registered, shown as plain TEXT badges (pinned in tests/site-registrations.test.mjs).
    // DTI and BIR are still not claimed, and PhilGEPS appears only inside the words "PhilGEPS-registered".
    assert.ok(!/\b(DTI|BIR)\b/.test(visibleText(homeSite)), 'a registration the owner did not state is named in the copy');
    assert.ok(!/\bPhilGEPS\b(?!-registered)/.test(visibleText(homeSite)), 'PhilGEPS is named outside the "PhilGEPS-registered" badge words');
    assert.ok(visibleText(about).includes('SEC-registered'));
    const dirs = fs.readdirSync(path.join(ROOT, 'site/img'));
    assert.ok(!dirs.some(n => /sec|dti|philgeps|bir|seal|logo-gov/i.test(n)), 'an agency logo folder exists under site/img');
  });
});
