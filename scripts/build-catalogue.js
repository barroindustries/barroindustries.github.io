#!/usr/bin/env node
/**
 * build-catalogue.js — PUBLIC-WEBSITE-SPEC.md §7.2 (retargeted at /catalogue/ on 2026-10-21).
 *
 * Bakes the public product catalogue into catalogue/index.html (between the
 * CATALOGUE markers) from the PRIVATE master JSON, with every price field stripped.
 * The homepage (index.html) carries NO products, no counts and no markers: the owner
 * ruled that the catalogue lives on its own page.
 *
 * PUBLIC CATEGORIES (owner ruling 2026-10-21, "just the equipment"; Ventilation added 2026-10-28 for the range hoods): the public page has exactly
 * six categories, in this order: Preparation, Washing, Cooking, Ventilation, Storage, Refrigeration.
 *   - EXCLUDED_CATEGORIES (fresh_air_system, gas_line, fire_suppression) are
 *     skipped entirely: no card, no count, no search hit. The master is never edited. (exhaust_system is NOT excluded since
 *     2026-10-28: its seven hoods are the Ventilation category, every other exhaust product is listed under excludedProducts.)
 *   - scripts/public-categories.json maps every other published product id to one of the six
 *     and lists the non-equipment items (services, materials, accessories) that are not
 *     published. A master product that is in none of those places REFUSES the build, so a new
 *     product always forces an explicit decision.
 *
 * It ALSO writes (PUBLIC-QUOTE-REQUEST-SPEC.md): the price-free "Add to quote" data island into catalogue/index.html
 * (between the QR:DATA markers) and functions/qr-published.json (the published product ids — the Cloud Functions'
 * allowlist), both from the SAME publishedProductIds() walk, so no list is ever kept by hand.
 * And the JSON-LD ItemList of the page's products (name + the #cat-… anchor of its category, nothing else: no price, no offer) into the
 * <head> of catalogue/index.html (between the LD:ITEMLIST markers), from the same walk again (2026-10-21, search-engine markup).
 *
 *   node scripts/build-catalogue.js [path/to/products-database.json]
 *
 * Default input: ./products-database.json if present, else
 * ~/Desktop/barro-private/products-database.json. Fails loudly if neither exists.
 * Node >= 18, no dependencies, plain CommonJS (CI runs `node --check scripts/*.js`).
 *
 * THE TWO RULINGS THIS FILE ENFORCES (owner, firm):
 *   R1  No prices anywhere on the public website. products-database.json is
 *       gitignored and 404s live; the catalogue is baked into catalogue/index.html, so
 *       no runtime data file exists to leak. Two layers:
 *         1. publicProduct() builds its output FIELD BY FIELD from an allowlist
 *            (never a spread), so basePrice / formula / formulaType / laborHours /
 *            leadTime / laborRoles / constants / _meta / specs[].priceAdder are
 *            dropped by construction.
 *         2. MONEY_RE (and FORMULA_RE, the CHECK 9 token list) is run over every
 *            string that is emitted (and the final HTML). A match THROWS the whole
 *            build — no partial output is written.
 *   R5  Brilliant Steel must not appear ANYWHERE on the public site. BRAND_RE is
 *       run over EVERY field of every master record — including the fields the
 *       allowlist drops — plus every emitted string and the final HTML. A hit
 *       THROWS and names the product id. A partner-branded / partner-only product
 *       is never dropped or renamed silently: the build refuses and the owner
 *       decides.
 *
 * DISPLAY-TEXT HYGIENE (owner, 2026-10-21): the master is private and is never edited
 * from here. Genuine typos / British-spelling / grammar slips in a DISPLAYED name or
 * note are corrected by the explicit TEXT_FIXES map below (same pattern as
 * NOTE_OVERRIDES: it applies only while the master text still matches, and every
 * applied / stale fix is printed). Category labels are shown in sentence case.
 *
 * PRODUCT PHOTOS (optional): scripts/product-photos.json maps product ids to
 * site/img/products/<slug>.webp (+ <slug>-thumb.webp). Absent file = every card keeps
 * its placeholder tile. Present file = validated hard (real ids, files exist, readable
 * WebP headers) and a mapped card shows the photo with a "Representative image" caption.
 * Product images are deliberately NOT precached by the service worker (CHECK 9).
 *
 * Violation messages carry product id + field + rule only — never the offending
 * text — so a price (or anything else) cannot leak into a log.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const PF = require('../js/product-families.js');          // the pure family helpers (validation, preview keys) — shared with the page and the server

const REPO_ROOT = path.resolve(__dirname, '..');
const CATALOGUE_HTML = path.join(REPO_ROOT, 'catalogue', 'index.html');
const PHOTO_MAP_FILE = path.join(__dirname, 'product-photos.json');
// PRODUCT FAMILIES (owner ruling 2026-10-21; five more 2026-10-28): eleven configurable products + every other published SKU as a fixed item.
// scripts/public-families.json is the source; js/qr-families.js (+ the byte-identical functions/qr-families.js) is GENERATED from it.
const FAMILIES_FILE = path.join(__dirname, 'public-families.json');
const FAMILIES_JS = path.join(REPO_ROOT, 'js', 'qr-families.js');
const FAMILIES_JS_MIRROR = path.join(REPO_ROOT, 'functions', 'qr-families.js');
// Configurator preview images (owner's shot list): scripts/configurator-previews.json maps a preview key to site/img/configurator/<family>/<key>.webp.
const PREVIEWS_FILE = path.join(__dirname, 'configurator-previews.json');
// The server-side allowlist of PUBLISHED product ids (PUBLIC-QUOTE-REQUEST-SPEC.md, "Add to quote" is for published
// products only). Generated from publishedProductIds() — the SAME computation that decides which cards reach the page —
// so the Cloud Functions never keep a second, hand-maintained list. Ids only: no price, no formula.
const PUBLISHED_IDS_FILE = path.join(REPO_ROOT, 'functions', 'qr-published.json');

// ci-invariants.sh CHECK 9 greps for these exact marker strings (the dash is U+2014).
const START_MARKER = '<!-- CATALOGUE:START generated by scripts/build-catalogue.js — DO NOT HAND-EDIT -->';
const END_MARKER = '<!-- CATALOGUE:END -->';
// The "Add to quote" data island (spec §3.4). The shell carries a <!-- QR:DATA --> placeholder the FIRST time; after
// that the build rewrites whatever sits between the START / END markers (same idempotent pattern as CATALOGUE).
const QR_PLACEHOLDER = '<!-- QR:DATA -->';
const QR_START_MARKER = '<!-- QR:DATA:START generated by scripts/build-catalogue.js — DO NOT HAND-EDIT -->';
const QR_END_MARKER = '<!-- QR:DATA:END -->';
// The JSON-LD ItemList in the <head> of catalogue/index.html (search-engine markup for the product list). It lives between these two
// markers, which the SHELL carries (unlike the QR island there is no first-run placeholder), and is rewritten by the same product walk
// that renders the cards, so it can never list a product the page does not show.
const LD_START_MARKER = '<!-- LD:ITEMLIST:START generated by scripts/build-catalogue.js — DO NOT HAND-EDIT -->';
const LD_END_MARKER = '<!-- LD:ITEMLIST:END -->';
const SITE_ORIGIN = 'https://barroindustries.com';
const CATALOGUE_URL = `${SITE_ORIGIN}/catalogue/`;
const ITEM_LIST_NAME = 'Commercial kitchen equipment catalogue';
// The one place this script writes the VISIBLE brand name (the catalogue eyebrow). It is always emitted inside <span data-brand> (CSS-neutral),
// like every other visible mention on the public pages, so renaming the brand is a find-and-replace of a small known set:
// tests/site-public-surface.test.mjs counts every occurrence across the public files and pins that set.
const SITE_BRAND_NAME = 'Barro Kitchens';

// §7.2 money scan. NO /g flag: .test() must stay stateless.
// Do not loosen it — a note that trips it gets a NOTE_OVERRIDES entry instead. (2026-10-21: TIGHTENED from
// "price" to "pric(e|ing)": a published note read "volume pricing for ...", which the old word never matched.)
const MONEY_RE = /₱|PHP ?\d|\b\d{1,3}(,\d{3})+\b|pric(?:e|ing)|cost|markup/i;
// ci-invariants.sh CHECK 9 forbids this token list in the baked block (spec §5.6). It is a
// DIFFERENT list from MONEY_RE (it adds the formula/rate field names and drops the bare
// words), and the master does carry such a token in a note (EX-001), so the build enforces
// it too: a note that CHECK 9 would reject fails HERE, where NOTE_OVERRIDES can fix it,
// instead of failing later in CI.
const FORMULA_RE = /basePrice|priceAdder|pricePer|rateW100|rateD100|rateH100|laborHours|ratePerDay|markup|₱|PHP ?[0-9]|\b[0-9]{1,3}(,[0-9]{3})+\b/i;
// Owner ruling: the partner company is never named on the public site.
const BRAND_RE = /brilliant\s*steel/i;
const isMoneyish = (t) => MONEY_RE.test(t) || FORMULA_RE.test(t);
// A file path or slug spells a name with separators ("brilliant-steel", "brilliant_steel.webp"): look through them.
const brandInPath = (t) => BRAND_RE.test(String(t).replace(/[\s\-_./]+/g, ' '));

const ID_RE = /^[A-Za-z0-9_-]+$/;                // product id: also used in markup
const CAT_ID_RE = /^[a-z0-9_]+$/;

// The six public categories — exactly these, in this order (owner ruling; Ventilation, for the range hoods, added 2026-10-28). The id is the deep-link
// slug (#cat-preparation); the label is what the page shows.
const PUBLIC_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'preparation', label: 'Preparation' }),
  Object.freeze({ id: 'washing', label: 'Washing' }),
  Object.freeze({ id: 'cooking', label: 'Cooking' }),
  Object.freeze({ id: 'ventilation', label: 'Ventilation' }),
  Object.freeze({ id: 'storage', label: 'Storage' }),
  Object.freeze({ id: 'refrigeration', label: 'Refrigeration' }),
]);
const PUBLIC_CATEGORY_IDS = PUBLIC_CATEGORIES.map(c => c.id);
// Master categories that are never published: the mechanical / plumbing systems, not equipment. (exhaust_system left this list on 2026-10-28: the range hoods are
// equipment and a family of their own; the ducting, blowers and other exhaust items are excluded one by one under excludedProducts in scripts/public-categories.json.)
const EXCLUDED_CATEGORIES = Object.freeze(['fresh_air_system', 'gas_line', 'fire_suppression']);
const PUBLIC_CATEGORIES_FILE = path.join(__dirname, 'public-categories.json');

// material.* keys that may reach the page (string values only). The spec lists
// grade/topGauge/bodyGauge/frame/finish and then "…"; this is that list closed over
// the keys that exist in the master today. A key that is not listed is DROPPED
// (and counted in report.droppedMaterialKeys), so a price-bearing key added to the
// master later cannot slip through just because its value is a string.
const MATERIAL_LABELS = {
  grade: 'Grade', topGauge: 'Top gauge', bodyGauge: 'Body gauge', gauge: 'Gauge',
  frame: 'Frame', finish: 'Finish', edge: 'Edge', bowlDepth: 'Bowl depth',
  shelves: 'Shelves', casters: 'Casters', loadRating: 'Load rating',
  panel: 'Panel', controls: 'Controls', lid: 'Lid',
};
const MATERIAL_KEYS = Object.keys(MATERIAL_LABELS);

// Master notes that carry pricing language (or a pricing-formula token) and therefore
// trip MONEY_RE / FORMULA_RE. Each entry is the SAME note with the pricing clause
// removed — nothing is ever added — except EX-015, whose replacement text is fixed by
// the spec. An override is applied ONLY while the master's note still trips a money
// guard and does not mention the partner brand; otherwise it is reported as unused.
// The ORIGINAL strings are deliberately not quoted here: this file is committed to a
// public repo.
const NOTE_OVERRIDES = Object.freeze({
  'EX-015': 'Scope varies per project',
  'EX-001': 'SS304',
  'PW-013': 'SS304 wall sheet, per square metre',
  'CE-017': 'Government/institutional grade. SS1.2mm top/0.8mm lower panel, 1.5" round posts, 1" horizontal braces, 2 HP industrial burners + base, 2 LP w/ crown, GI gas line, brass fittings.',
  'CE-018': 'SS1.2mm top, 0.8mm lower panel, 1.5" round tube posts, C40 burner. Institutional/government grade.',
  'CE-024': '3-shelf display warmer, optional horizontal layout',
  'EX-016': 'Inline blower (TECO/WEG type), 220V, on/off magnetic switch',
  'EX-026': 'Block-type, SS0.7mm',
  'MS-014': 'SS sheet 1.0mm',
  'BA-008': 'SS304 sheet/tray, 600x400mm GN-compatible. Rolled reinforced edges. Sold per piece.',
});

// Genuine typos, British-spelling slips (the site is British throughout: "catalogue",
// "millimetres", "labour") and grammar errors in DISPLAYED product text. { id: { field:
// [before, after] } } for name / notes only. A fix applies ONLY while the displayed text
// still equals `before` exactly, so a master that has since been corrected is never
// double-edited; a stale entry is reported and does nothing. Both strings must be clean of
// price / formula / partner-brand tokens (asserted at load, below) — a note that needs
// those removed belongs in NOTE_OVERRIDES. Terse spec fragments ("SS304 1.1mm top, 0.8mm
// body") are deliberately NOT touched; "N Layer" / "N Burner" in names, "heavy duty" in
// the master's own style elsewhere and "w/" are left as the master has them.
const TEXT_FIXES = Object.freeze({
  // typo: "Bottomshelf" is two words everywhere else in the master ("bottom shelf")
  'CE-026': { name: ['Lava Rock Griller w/ Bottomshelf', 'Lava Rock Griller w/ Bottom Shelf'], notes: ['Lava rock heat distribution, 150mm bottomshelf', 'Lava rock heat distribution, 150mm bottom shelf'] },
  'CE-027': { name: ['3 Open Top Burner w/ Bottomshelf (Compact)', '3 Open Top Burner w/ Bottom Shelf (Compact)'] },
  'CE-028': { name: ['Gas Griddle w/ Bottomshelf', 'Gas Griddle w/ Bottom Shelf'] },
  // hyphenation of a compound modifier / noun phrase
  'CE-011': { notes: ['Gas type, 6 tray capacity', 'Gas type, 6-tray capacity'] },
  'FS-003': { notes: ['4 gallons capacity, complete set', '4-gallon capacity, complete set'] },
  'CE-015': { notes: ['SS 1.4mm top, 1.2mm side, 2" round tube post, 1" horizontal braces, 2 LP + 2 HP burners, heavy duty base', 'SS 1.4mm top, 1.2mm side, 2" round tube post, 1" horizontal braces, 2 LP + 2 HP burners, heavy-duty base'] },
  'CE-029': { notes: ['SS304 1.2mm top, G#20 down panel, G#22 control panel, industrial heavy duty burners and base, gas line', 'SS304 1.2mm top, G#20 down panel, G#22 control panel, industrial heavy-duty burners and base, gas line'] },
  'EX-003': { notes: ['SS304, heavy duty, with canopy', 'SS304, heavy-duty, with canopy'] },
  // grammar: "bended" is not English
  'PW-027': { notes: ['SS1x1 sq tube, bended angle 1.0mm, 3" caster wheels', 'SS1x1 sq tube, bent angle 1.0mm, 3" caster wheels'] },
  'PW-034': { notes: ['SS G#20 all over, angle-bended tray slides, caster wheels', 'SS G#20 all over, angle-bent tray slides, caster wheels'] },
  // grammar: "recondition" is the verb, "reconditioning" the noun
  'MS-011': { notes: ['Existing oven, full recondition', 'Existing oven, full reconditioning'] },
  // units / typography: a temperature needs its degree sign, a range its en dash, a refrigerant its capital
  'RF-001': { name: ['Pasteurizer', 'Pasteuriser'], notes: ['304 food-grade SS double-layer water jacket; capacity 10L; temp range 60-95C', '304 food-grade SS double-layer water jacket; capacity 10L; temperature range 60–95°C'] },
  'RF-003': { notes: ['Fan cooling, Embraco/R404a compressor, -12C to -18C, SS body, digital LED controller, 100% copper condenser/evaporator, 220V/60Hz', 'Fan cooling, Embraco/R404A compressor, −12°C to −18°C, SS body, digital LED controller, 100% copper condenser/evaporator, 220V/60Hz'] },
  // British spelling: galvanised, fibre / fibreglass, sterilising / sterilisation, labour
  'EX-004': { name: ['Galvanized Exhaust Duct with Elbows (per ~1m)', 'Galvanised Exhaust Duct with Elbows (per ~1m)'] },
  'EX-005': { notes: ['Industrial, galvanized casing and reducer', 'Industrial, galvanised casing and reducer'] },
  'EX-006': { notes: ['Industrial, galvanized casing and reducer', 'Industrial, galvanised casing and reducer'] },
  'FA-001': { notes: ['Centrifugal blower, galvanized casing', 'Centrifugal blower, galvanised casing'] },
  'FA-002': { notes: ['Centrifugal blower, galvanized casing', 'Centrifugal blower, galvanised casing'] },
  'EX-011': { name: ['Fiber Wool Thermal Insulation (per set)', 'Fibre Wool Thermal Insulation (per set)'] },
  'EX-024': { name: ['Fire-Resistant Fiberglass Insulator (32kg)', 'Fire-Resistant Fibreglass Insulator (32kg)'], notes: ['32kg fiberglass duct insulation, bulk', '32kg fibreglass duct insulation, bulk'] },
  'EX-017': { notes: ['BI sheet welded duct run (25-30pcs), BI ledge bracket, 5pcs air vent grill 200x200mm, stand bolt + grip anchor, fiberglass wool insulation', 'BI sheet welded duct run (25-30pcs), BI ledge bracket, 5pcs air vent grill 200x200mm, stand bolt + grip anchor, fibreglass wool insulation'] },
  'CE-012': { notes: ['Fiber glass insulation, temp monitoring', 'Fibreglass insulation, temperature monitoring'] },
  'PW-014': { name: ['UVC Sterilizing Cabinet XXL', 'UVC Sterilising Cabinet XXL'], notes: ['45x36.5x64.5 cm, UV sterilization', '45x36.5x64.5 cm, UV sterilisation'] },
  'MS-014': { name: ['GI Galvanized Sheet & Gutter Fabrication', 'GI Galvanised Sheet & Gutter Fabrication'] },
  'EX-015': { name: ['Exhaust System Delivery, Labor & Installation', 'Exhaust System Delivery, Labour & Installation'] },
  'FA-007': { name: ['Fresh Air System Delivery, Labor & Installation', 'Fresh Air System Delivery, Labour & Installation'] },
  'GL-003': { name: ['Gas Line for Fryer/Griddle (Labor & Materials)', 'Gas Line for Fryer/Griddle (Labour & Materials)'] },
  'MS-005': { name: ['Delivery, Installation, Labor & Commissioning (Small)', 'Delivery, Installation, Labour & Commissioning (Small)'] },
  'MS-006': { name: ['Delivery, Installation, Labor & Commissioning (Medium)', 'Delivery, Installation, Labour & Commissioning (Medium)'] },
  'MS-007': { name: ['Delivery, Installation, Labor & Commissioning (Large)', 'Delivery, Installation, Labour & Commissioning (Large)'] },
  'MS-010': { name: ['SS Wall Cladding Installation (Labor Only)', 'SS Wall Cladding Installation (Labour Only)'] },
});
const TEXT_FIX_FIELDS = ['name', 'notes'];

// A TEXT_FIXES entry is public text in a public repo: refuse a malformed or unsafe one at load.
(function assertTextFixesSafe() {
  for (const [id, fields] of Object.entries(TEXT_FIXES)) {
    if (!ID_RE.test(id)) throw new Error(`TEXT_FIXES: bad product id "${id}"`);
    for (const [field, pair] of Object.entries(fields)) {
      if (!TEXT_FIX_FIELDS.includes(field)) throw new Error(`TEXT_FIXES ${id}: field "${field}" is not fixable (name / notes only)`);
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some(s => typeof s !== 'string' || !s.trim())) throw new Error(`TEXT_FIXES ${id}.${field}: expected [before, after]`);
      if (pair[0] === pair[1]) throw new Error(`TEXT_FIXES ${id}.${field}: before equals after`);
      for (const s of pair) {
        if (isMoneyish(s) || BRAND_RE.test(s)) throw new Error(`TEXT_FIXES ${id}.${field}: a pricing / partner-brand string belongs in NOTE_OVERRIDES, never here`);
      }
    }
  }
})();

// ── guard error ─────────────────────────────────────────────────────────────
class CatalogueGuardError extends Error {
  constructor(violations) {
    const list = violations.map(v => `  ${v.id} ${v.field}: ${RULE_TEXT[v.rule] || v.rule}`);
    const ids = new Set(violations.map(v => v.id));
    super(`catalogue build refused — ${violations.length} violation(s) in ${ids.size} product(s):\n${list.join('\n')}`);
    this.name = 'CatalogueGuardError';
    this.code = 'CATALOGUE_GUARD';
    this.violations = violations;
  }
}
const RULE_TEXT = {
  money: 'pricing pattern (a currency amount, a price/cost/markup word, or a pricing-formula field name)',
  brand: 'partner-brand reference (needs an owner decision — never dropped or renamed silently)',
  shape: 'missing or malformed value',
  unmapped: 'not in scripts/public-categories.json — map it to a public category, or list it under excludedProducts',
  stale: 'scripts/public-categories.json names a product the master does not have',
  family: 'not classified in scripts/public-families.json — absorb it into a family or list it under "fixed"',
  familyStale: 'scripts/public-families.json names a product the master does not have or the catalogue does not publish',
};

// ── helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Strip // and /* */ comments from JSON-with-comments WITHOUT touching string
// contents (a URL like "https://x" must survive). Newlines are preserved so a
// JSON.parse error position still points at the right line.
function stripJsonComments(src) {
  let out = '';
  let i = 0;
  let inStr = false;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { if (i + 1 < n) out += d; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      if (i >= n) throw new Error('unterminated /* comment in the master JSON');
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function str(v) { return typeof v === 'string' ? v.trim() : ''; }

// Every key and string value anywhere inside a record, as "a.b[2].c" paths — used
// for the brand scan, which must see fields the allowlist drops.
function brandPaths(value, prefix, out) {
  if (typeof value === 'string') { if (BRAND_RE.test(value)) out.push(prefix); return out; }
  if (Array.isArray(value)) { value.forEach((x, i) => brandPaths(x, `${prefix}[${i}]`, out)); return out; }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (BRAND_RE.test(k)) out.push(`${p}(key)`);
      brandPaths(value[k], p, out);
    }
  }
  return out;
}

// Add a violation once per (id, field, rule).
function makeSink(list) {
  const seen = new Set();
  return function add(id, field, rule) {
    const key = `${id}|${field}|${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ id, field, rule });
  };
}

// Scan one emitted string against both guards.
function scanEmitted(add, id, field, text) {
  if (BRAND_RE.test(text)) add(id, field, 'brand');
  if (isMoneyish(text)) add(id, field, 'money');
}

// ── the allowlist: one product ──────────────────────────────────────────────
/**
 * publicProduct(p[, ctx]) -> plain object holding ONLY allowlisted fields.
 * Built field by field. NEVER spread/Object.assign the input.
 * Throws CatalogueGuardError (all violations for this product) on money / brand /
 * shape problems. ctx: { noteOverrides, textFixes, applied: [], fixed: [], droppedMaterialKeys: [] }.
 */
function publicProduct(p, ctx) {
  ctx = ctx || {};
  const overrides = ctx.noteOverrides || NOTE_OVERRIDES;
  const fixes = ctx.textFixes || TEXT_FIXES;
  const violations = [];
  const add = makeSink(violations);

  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    throw new CatalogueGuardError([{ id: '(record)', field: '(whole record)', rule: 'shape' }]);
  }
  const id = str(p.id);
  const lbl = id || '(no id)';
  if (!ID_RE.test(id)) add(lbl, 'id', 'shape');

  // Partner-brand scan across the WHOLE record first — shortName, leadTime,
  // formula, laborRoles… everything, emitted or not.
  for (const f of brandPaths(p, '', [])) add(lbl, f, 'brand');

  const out = {};
  out.id = id;

  out.name = str(p.name);
  if (!out.name) add(lbl, 'name', 'shape');
  out.category = str(p.category);
  if (!CAT_ID_RE.test(out.category)) add(lbl, 'category', 'shape');
  const unit = str(p.unit);
  if (unit) out.unit = unit;

  // defaultDimensions.{W,D,H} — finite positive numbers only (the master carries
  // nulls for the 63 products with no fixed size).
  const dd = p.defaultDimensions;
  if (dd && typeof dd === 'object') {
    const dims = {};
    for (const k of ['W', 'D', 'H']) {
      const v = dd[k];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100000) dims[k] = v;
    }
    if (Object.keys(dims).length) out.defaultDimensions = dims;
  }

  // material.* — allowlisted keys, string values only.
  if (p.material && typeof p.material === 'object' && !Array.isArray(p.material)) {
    const mat = {};
    for (const k of MATERIAL_KEYS) {
      const v = p.material[k];
      if (typeof v === 'string' && v.trim()) mat[k] = v.trim();
    }
    if (ctx.droppedMaterialKeys) {
      for (const k of Object.keys(p.material)) {
        if (!MATERIAL_KEYS.includes(k)) ctx.droppedMaterialKeys.push(`${lbl}.${k}`);
      }
    }
    if (Object.keys(mat).length) out.material = mat;
  }

  // notes — money-tripping notes may be replaced ONLY via NOTE_OVERRIDES, and never
  // when the original mentions the partner brand (that must stay a hard stop).
  let notes = str(p.notes);
  if (notes && isMoneyish(notes) && !BRAND_RE.test(notes)) {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      notes = overrides[id];
      if (ctx.applied) ctx.applied.push({ id, replacement: notes });
    }
  }
  if (notes) out.notes = notes;

  // specs[].label / specs[].options / specs[].default ONLY — never priceAdder. `default` is the option LABEL the
  // Quote Builder pre-selects; it is emitted only when it is one of the options, and is scanned like every other emitted string.
  // Since 2026-10-21 neither the cards nor the data island SHOW these (a fixed item is quantity + size + note only); they stay in
  // this allowlist so every master option string is still money- and brand-scanned and a priceAdder can never pass.
  if (Array.isArray(p.specs)) {
    const specs = [];
    for (const s of p.specs) {
      if (!s || typeof s !== 'object') continue;
      const label = str(s.label);
      const options = Array.isArray(s.options) ? s.options.filter(o => typeof o === 'string' && o.trim()).map(o => o.trim()) : [];
      if (label && options.length) {
        const spec = { label, options };
        const def = str(s.default);
        if (def && options.includes(def)) spec.default = def;
        specs.push(spec);
      }
    }
    if (specs.length) out.specs = specs;
  }

  // TEXT_FIXES: a typo / spelling / grammar correction, only while the displayed text
  // still equals the recorded original. Runs BEFORE the emitted-string scan below, so a
  // fix can never smuggle a price or the partner name past the guards.
  if (Object.prototype.hasOwnProperty.call(fixes, id)) {
    for (const field of Object.keys(fixes[id])) {
      const pair = fixes[id][field];
      if (TEXT_FIX_FIELDS.includes(field) && out[field] === pair[0]) {
        out[field] = pair[1];
        if (ctx.fixed) ctx.fixed.push({ id, field, before: pair[0], after: pair[1] });
      }
    }
  }

  // Scan every emitted string (post-override, post-fix) for both guards.
  scanEmitted(add, lbl, 'id', out.id);
  scanEmitted(add, lbl, 'name', out.name);
  scanEmitted(add, lbl, 'category', out.category);
  if (out.unit) scanEmitted(add, lbl, 'unit', out.unit);
  if (out.notes) scanEmitted(add, lbl, 'notes', out.notes);
  if (out.material) for (const k of Object.keys(out.material)) scanEmitted(add, lbl, `material.${k}`, out.material[k]);
  if (out.specs) {
    out.specs.forEach((s, i) => {
      scanEmitted(add, lbl, `specs[${i}].label`, s.label);
      s.options.forEach((o, j) => scanEmitted(add, lbl, `specs[${i}].options[${j}]`, o));
      if (s.default) scanEmitted(add, lbl, `specs[${i}].default`, s.default);
    });
  }

  if (violations.length) throw new CatalogueGuardError(violations);
  return out;
}

// ── product photos (optional) ───────────────────────────────────────────────
// WebP is RIFF: 'RIFF' <size> 'WEBP' then a first chunk — 'VP8 ' (lossy), 'VP8L' (lossless)
// or 'VP8X' (extended). Returns { width, height } or null when the header is not WebP.
function webpSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 30) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') {
    return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
  }
  return null;
}

const PHOTO_PATH_RE = /^site\/img\/products\/[a-z0-9][a-z0-9-]*\.webp$/;
const thumbPathOf = (p) => p.replace(/\.webp$/, '-thumb.webp');

/**
 * loadPhotoMap({ ids, root, file }) -> { photos, files }
 *   file  path to the mapping JSON (default scripts/product-photos.json); ABSENT -> {} (not an error)
 *   ids   iterable of every real product id: a key that is not one is refused
 *   skipIds  ids that are NOT published (excluded categories / items): their entries are kept in the
 *         file but never validated or rendered, so excluding a product cannot fail the build
 *   root  repo root the mapped paths resolve against (default: this repo)
 * Each mapping value is "site/img/products/<slug>.webp"; its "<slug>-thumb.webp" sibling must exist too.
 * Many ids may share one image. Throws ONE aggregated Error listing every problem (ids and
 * paths only), so a half-valid map never produces a half-correct page.
 * photos[id] = { src, thumb, width, height, mainWidth } — width/height are the THUMB's (it is the <img src>).
 */
function loadPhotoMap(opts) {
  opts = opts || {};
  const file = opts.file || PHOTO_MAP_FILE;
  const root = opts.root || REPO_ROOT;
  const photos = Object.create(null);
  if (!fs.existsSync(file)) return { photos, files: 0 };

  const rel = path.relative(root, file) || file;
  let map;
  try { map = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { throw new Error(`${rel} is not valid JSON: ${e.message}`); }
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(`${rel} must be a JSON object of { "<PRODUCT_ID>": "site/img/products/<slug>.webp" }`);

  const known = new Set(opts.ids || []);
  const skip = new Set(opts.skipIds || []);
  let skipped = 0;
  const problems = [];
  const sizeCache = new Map();
  const sizeOf = (relPath) => {
    if (!sizeCache.has(relPath)) {
      let size = null;
      try { size = webpSize(fs.readFileSync(path.join(root, relPath))); } catch (_) { /* reported by the exists check */ }
      sizeCache.set(relPath, size);
    }
    return sizeCache.get(relPath);
  };

  for (const id of Object.keys(map)) {
    const val = map[id];
    if (!ID_RE.test(id) || !known.has(id)) { problems.push(`${id}: not a product id in the master`); continue; }
    if (skip.has(id)) { skipped++; continue; }
    if (typeof val !== 'string' || !PHOTO_PATH_RE.test(val) || /-thumb\.webp$/.test(val)) {
      problems.push(`${id}: value must look like "site/img/products/<slug>.webp" (lower-case slug, not a -thumb file)`);
      continue;
    }
    if (brandInPath(val) || isMoneyish(val)) { problems.push(`${id}: the image path trips a pricing / partner-brand guard`); continue; }
    const thumb = thumbPathOf(val);
    let ok = true;
    for (const f of [val, thumb]) {
      if (!fs.existsSync(path.join(root, f))) { problems.push(`${id}: missing file ${f}`); ok = false; }
    }
    if (!ok) continue;
    const mainSize = sizeOf(val), thumbSize = sizeOf(thumb);
    if (!mainSize || !thumbSize) { problems.push(`${id}: ${!mainSize ? val : thumb} is not a readable WebP`); continue; }
    if (Math.abs(mainSize.width / mainSize.height - thumbSize.width / thumbSize.height) > 0.03) {
      problems.push(`${id}: ${val} and its thumb have different aspect ratios`);
      continue;
    }
    if (thumbSize.width >= mainSize.width) { problems.push(`${id}: the thumb must be narrower than ${val}`); continue; }
    photos[id] = { src: val, thumb, width: thumbSize.width, height: thumbSize.height, mainWidth: mainSize.width };
  }
  if (problems.length) throw new Error(`${rel}: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  return { photos, files: new Set(Object.values(photos).map(p => p.src)).size, skipped };
}

// ── public categories ───────────────────────────────────────────────────────
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * loadPublicCategories({ file, ids }) -> { products, excludedProducts }
 *   products          { "<PRODUCT_ID>": "<one of the five public category ids>" }
 *   excludedProducts  { "<PRODUCT_ID>": "<one-line reason>" } — non-equipment items that are not published
 * Throws ONE aggregated Error (ids and keys only, never a value) on a missing / unreadable file, an id the
 * master does not have, a value that is not one of the five, a product listed twice, or a reason that trips a
 * price / partner-brand guard.
 */
function loadPublicCategories(opts) {
  opts = opts || {};
  const file = opts.file || PUBLIC_CATEGORIES_FILE;
  const rel = path.relative(REPO_ROOT, file) || file;
  if (!fs.existsSync(file)) throw new Error(`${rel} not found — it maps every published product to one of: ${PUBLIC_CATEGORY_IDS.join(', ')}`);
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { throw new Error(`${rel} is not valid JSON: ${e.message}`); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`${rel} must be a JSON object with "products" and "excludedProducts"`);
  const known = opts.ids ? new Set(opts.ids) : null;
  const problems = [];
  for (const k of Object.keys(j)) if (!['_readme', 'products', 'excludedProducts'].includes(k)) problems.push(`unknown top-level key "${k}"`);
  const products = Object.create(null), excludedProducts = Object.create(null);
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(j.products)) problems.push('"products" must be an object of { "<PRODUCT_ID>": "<public category>" }');
  else for (const id of Object.keys(j.products)) {
    if (!ID_RE.test(id) || (known && !known.has(id))) { problems.push(`${id}: not a product id in the master`); continue; }
    if (!PUBLIC_CATEGORY_IDS.includes(j.products[id])) { problems.push(`${id}: the category is not one of ${PUBLIC_CATEGORY_IDS.join(', ')}`); continue; }
    products[id] = j.products[id];
  }
  if (!isObj(j.excludedProducts)) problems.push('"excludedProducts" must be an object of { "<PRODUCT_ID>": "<reason>" }');
  else for (const id of Object.keys(j.excludedProducts)) {
    const why = j.excludedProducts[id];
    if (!ID_RE.test(id) || (known && !known.has(id))) { problems.push(`${id}: not a product id in the master`); continue; }
    if (typeof why !== 'string' || !why.trim()) { problems.push(`${id}: the reason must be a non-empty string`); continue; }
    if (BRAND_RE.test(why) || isMoneyish(why)) { problems.push(`${id}: the reason trips a pricing / partner-brand guard`); continue; }
    excludedProducts[id] = why.trim();
  }
  for (const id of Object.keys(products)) if (has(excludedProducts, id)) problems.push(`${id}: listed as published AND as excluded`);
  if (problems.length) throw new Error(`${rel}: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  return { products, excludedProducts };
}

/**
 * publishedProductIds(db, pub[, excludedCategories]) -> Set of the master product ids that reach the public page:
 * not in an excluded category, not listed under excludedProducts, and mapped to a public category.
 */
function publishedProductIds(db, pub, excludedCategories) {
  const excl = new Set(excludedCategories || EXCLUDED_CATEGORIES);
  const out = new Set();
  for (const p of (db && db.products) || []) {
    const id = str(p && p.id);
    if (id && !excl.has(str(p && p.category)) && !has(pub.excludedProducts, id) && has(pub.products, id)) out.add(id);
  }
  return out;
}

// ── product families (owner ruling 2026-10-21) ─────────────────────────────
// Eleven configurable products; every other published SKU stays a fixed item. scripts/public-families.json is the source of truth
// (options, defaults, size limits, the SKUs each family ABSORBS, preview rules) and holds no price of any kind.
const FAMILY_ID_RE = /^[a-z][a-z0-9_]{1,30}$/;
const GROUP_KEY_RE = /^[a-z][a-zA-Z0-9_]{0,30}$/;
const PREVIEW_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,78}$/;
const FAMILY_TOP_KEYS = ['_readme', 'version', 'order', 'families', 'fixed'];
const FAMILY_KEYS = ['label', 'category', 'description', 'title', 'titleAny', 'construction', 'photo', 'primary', 'sizeBasis', 'unit', 'groups', 'dims', 'widthRule', 'minDimWhen', 'maxDimWhen', 'specMap', 'preview', 'absorbed'];
const GROUP_KEYS = ['key', 'label', 'type', 'default', 'staffOnly', 'specRow', 'pricing', 'when', 'options', 'minSlots', 'maxSlots', 'unit', 'withText', 'noneText'];
const OPTION_KEYS = ['v', 'l', 'f', 's', 'c', 't', 'hint', 'short', 'w'];
const GROUP_TYPES = ['choice', 'slots', 'multi'];
// the fields of a family that reach the public/server file js/qr-families.js, in a fixed order (deterministic output)
const FAMILY_PUBLIC_KEYS = ['id', 'label', 'category', 'description', 'title', 'titleAny', 'construction', 'primary', 'unit', 'sizeBasis', 'groups', 'dims', 'widthRule', 'minDimWhen', 'maxDimWhen', 'specMap', 'preview', 'absorbed'];

const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIntNum = (n) => typeof n === 'number' && Number.isInteger(n);
const isPrimitiveValue = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

// Every string anywhere inside a value, with its path — the public text of a family is scanned like any other emitted string.
function stringPaths(value, prefix, out) {
  if (typeof value === 'string') { out.push([prefix, value]); return out; }
  if (Array.isArray(value)) { value.forEach((x, i) => stringPaths(x, `${prefix}[${i}]`, out)); return out; }
  if (isPlainObj(value)) { for (const k of Object.keys(value)) stringPaths(value[k], prefix ? `${prefix}.${k}` : k, out); }
  return out;
}

/**
 * checkFamily(id, f, add) -> normalised family (id added, sizeBasis defaulted, photo dropped) or null. Pushes plain-text problems
 * (ids and keys only, never a value) through add(message).
 */
function checkFamily(fid, f, add) {
  const at = (m) => add(`family "${fid}": ${m}`);
  if (!FAMILY_ID_RE.test(fid)) { at('the family id must be lower-case letters, digits and underscores'); return null; }
  if (!isPlainObj(f)) { at('must be an object'); return null; }
  for (const k of Object.keys(f)) if (!FAMILY_KEYS.includes(k)) at(`unknown key "${k}"`);
  const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!nonEmpty(f.label)) at('"label" must be a non-empty string');
  if (!PUBLIC_CATEGORY_IDS.includes(f.category)) at(`"category" must be one of ${PUBLIC_CATEGORY_IDS.join(', ')}`);
  if (!nonEmpty(f.description)) at('"description" must be a non-empty string');
  if (!(f.photo === null || (typeof f.photo === 'string' && ID_RE.test(f.photo)))) at('"photo" must be null or a product id');
  if (!(typeof f.primary === 'string' && ID_RE.test(f.primary))) at('"primary" must be a product id');
  if (!nonEmpty(f.unit)) at('"unit" must be a non-empty string');
  if (f.sizeBasis !== undefined && f.sizeBasis !== 'primary' && f.sizeBasis !== 'linear') at('"sizeBasis" must be "primary" or "linear"');

  // groups
  const groups = Array.isArray(f.groups) ? f.groups : null;
  if (!groups || !groups.length) { at('"groups" must be a non-empty array'); return null; }
  const seenKeys = new Set();
  let groupsOk = true;
  groups.forEach((g, i) => {
    const gt = `groups[${i}]`;
    if (!isPlainObj(g)) { at(`${gt} must be an object`); groupsOk = false; return; }
    for (const k of Object.keys(g)) if (!GROUP_KEYS.includes(k)) { at(`${gt}: unknown key "${k}"`); groupsOk = false; }
    if (typeof g.key !== 'string' || !GROUP_KEY_RE.test(g.key)) { at(`${gt}: bad "key"`); groupsOk = false; }
    else if (seenKeys.has(g.key)) { at(`${gt}: duplicate key "${g.key}"`); groupsOk = false; }
    else seenKeys.add(g.key);
    if (!nonEmpty(g.label)) { at(`${gt}: "label" must be a non-empty string`); groupsOk = false; }
    if (!GROUP_TYPES.includes(g.type)) { at(`${gt}: "type" must be one of ${GROUP_TYPES.join(', ')}`); groupsOk = false; return; }
    if (!Array.isArray(g.options) || !g.options.length || g.options.length > 12) { at(`${gt}: "options" must be 1 to 12 entries`); groupsOk = false; return; }
    // staffOnly (owner ruling 2026-10-28): a group only the Quote Builder (staff) may choose a non-default value of; a choice group, and only true / false
    if (g.staffOnly !== undefined && (typeof g.staffOnly !== 'boolean' || (g.staffOnly === true && g.type !== 'choice'))) { at(`${gt}: "staffOnly" must be true or false, and belongs to a choice group only`); groupsOk = false; }
    // specRow (owner ruling 2026-10-28): a staff-only group that still has a specification row of its own (the steel grade; the top plate has none, the Construction row says it) — a boolean, and only on a staff-only group
    if (g.specRow !== undefined && (typeof g.specRow !== 'boolean' || g.staffOnly !== true)) { at(`${gt}: "specRow" must be true or false, and belongs to a staff-only group only`); groupsOk = false; }
    // pricing (owner ruling 2026-10-28, specs/GRADE-PERCENT-SPEC): absent, or "percent" — the group's non-default value is priced as a PERCENTAGE of the whole line price (the steel grade), and its sheet cell
    // holds one "pct" instead of a flat amount; a choice group only. A word, not a figure: it carries no price into the public family file.
    if (g.pricing !== undefined && (g.pricing !== 'percent' || g.type !== 'choice')) { at(`${gt}: "pricing" must be "percent", and belongs to a choice group only`); groupsOk = false; }
    const seenV = [];
    g.options.forEach((o, j) => {
      const ot = `${gt}.options[${j}]`;
      if (!isPlainObj(o)) { at(`${ot} must be an object`); groupsOk = false; return; }
      for (const k of Object.keys(o)) if (!OPTION_KEYS.includes(k)) { at(`${ot}: unknown key "${k}"`); groupsOk = false; }
      if (!isPrimitiveValue(o.v)) { at(`${ot}: "v" must be a string, number or boolean`); groupsOk = false; }
      else if (seenV.some((x) => x === o.v)) { at(`${ot}: duplicate value`); groupsOk = false; }
      else seenV.push(o.v);
      if (g.type !== 'choice' && typeof o.v !== 'string') { at(`${ot}: a ${g.type} option value must be a string`); groupsOk = false; }
      if (!nonEmpty(o.l)) { at(`${ot}: "l" must be a non-empty string`); groupsOk = false; }
      for (const k of ['f', 's', 'c', 't', 'hint', 'short']) if (o[k] !== undefined && !nonEmpty(o[k])) { at(`${ot}: "${k}" must be a non-empty string`); groupsOk = false; }
      if (o.w !== undefined && !(isIntNum(o.w) && o.w >= 0 && o.w <= 5000)) { at(`${ot}: "w" must be a whole number of mm from 0 to 5000`); groupsOk = false; }
    });
    if (g.type === 'slots') {
      if (!(isIntNum(g.minSlots) && isIntNum(g.maxSlots) && g.minSlots >= 1 && g.maxSlots >= g.minSlots && g.maxSlots <= 12)) { at(`${gt}: minSlots / maxSlots must be whole numbers, 1 <= min <= max <= 12`); groupsOk = false; }
    } else if (g.minSlots !== undefined || g.maxSlots !== undefined) { at(`${gt}: minSlots / maxSlots belong to a slots group only`); groupsOk = false; }
  });
  // Conditional groups (CONFIGURATOR-FAMILIES-2-SPEC §4.1): `when` = { <earlier choice group>: [option values] }. The gated group is a choice or multi group (not slots, not
  // staff-only); every key names a choice group that comes EARLIER in "groups" (no forward or self reference, so there is no cycle) and is not itself staff-only; every
  // value is a non-empty list of that group's option values.
  if (groupsOk) groups.forEach((g, i) => {
    if (g.when === undefined) return;
    const wt = `groups[${i}]: "when"`;
    if (g.type === 'slots' || g.staffOnly === true) { at(`${wt} belongs to a choice or multi group that is not staff-only`); groupsOk = false; }
    if (!isPlainObj(g.when) || !Object.keys(g.when).length) { at(`${wt} must be an object of { earlier group key: [option values] }`); groupsOk = false; return; }
    for (const k of Object.keys(g.when)) {
      const gi = groups.findIndex((x) => x.key === k);
      if (gi < 0) { at(`${wt}: "${String(k).slice(0, 40)}" is not a group of this family`); groupsOk = false; continue; }
      if (gi >= i) { at(`${wt}: "${k}" must come EARLIER in "groups" (no forward or self reference)`); groupsOk = false; continue; }
      const gate = groups[gi];
      if (gate.type !== 'choice' || gate.staffOnly === true) { at(`${wt}: "${k}" must be a choice group that is not staff-only`); groupsOk = false; continue; }
      const vals = g.when[k];
      if (!Array.isArray(vals) || !vals.length || !vals.every((v) => PF.optionOf(gate, v))) { at(`${wt}: "${k}" needs a non-empty list of that group's option values`); groupsOk = false; }
    }
  });
  if (!groupsOk) return null;

  // dims
  const dims = isPlainObj(f.dims) ? f.dims : null;
  if (!dims || !dims.W) { at('"dims" must be an object with at least W'); return null; }
  let dimsOk = true;
  for (const k of Object.keys(dims)) {
    const d = dims[k];
    if (!['W', 'D', 'H'].includes(k)) { at(`dims: unknown axis "${k}"`); dimsOk = false; continue; }
    if (!isPlainObj(d) || !nonEmpty(d.label) || !['min', 'max', 'step', 'default'].every((x) => isIntNum(d[x]))) { at(`dims.${k} needs a label and whole-number min, max, step, default`); dimsOk = false; continue; }
    if (!(d.step >= 1 && d.step <= 100 && d.min >= 1 && d.min <= d.default && d.default <= d.max && d.min % d.step === 0 && d.max % d.step === 0 && d.default % d.step === 0)) { at(`dims.${k}: min <= default <= max, all on the step`); dimsOk = false; }
  }
  if (!dimsOk) return null;

  const fam = { id: fid };
  for (const k of FAMILY_PUBLIC_KEYS) if (k !== 'id' && f[k] !== undefined) fam[k] = f[k];
  if (!fam.sizeBasis) fam.sizeBasis = 'primary';
  const gOf = (key) => PF.groupOf(fam, key);

  // defaults must be a valid configuration
  const dc = PF.validateConfiguration(fam, PF.defaultConfig(fam));
  if (!dc.ok) at(`the defaults are not a valid configuration (${dc.errors.length} problem(s))`);

  // construction (owner ruling 2026-10-28): the public statement of how the made-to-order piece is built. A {token} in it names a CHOICE group of this
  // family and every option of that group carries "c" (its construction phrase), so PF.constructionLine() can fill it for any configuration.
  if (!nonEmpty(f.construction)) at('"construction" must be a non-empty string');
  else {
    if (/[{}]/.test(f.construction.replace(/\{[A-Za-z0-9_]+\}/g, ''))) at('construction: a brace that is not a {groupKey} token');
    const tokens = [...new Set([...f.construction.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]))];
    for (const t of tokens) {
      const g = gOf(t);
      if (!g || g.type !== 'choice') at(`construction: {${t}} does not name a choice group of this family`);
      else if (!g.options.every((o) => nonEmpty(o.c))) at(`construction: every option of "${t}" needs a "c" phrase (its construction wording)`);
      else if (g.when !== undefined) at(`construction: {${t}} names a conditional option (it has "when"): a construction phrase cannot depend on it`);
    }
  }

  // title (owner ruling 2026-10-28): the NAME the Quote Builder gives a configured line ("SS Sink", "SS Range Stove Combination (Griller, Fryer)"); the card and page names (label) are
  // untouched. A {token} in it names a choice or multi group of this family (a choice contributes its option's "t" title word, falling back to "l"; a multi, the labels of the
  // selected options). titleAny = { group, template }: used INSTEAD of "title" when that multi group has at least one selection (PF.lineTitle).
  const titleTokens = (tpl) => [...new Set([...tpl.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]))];
  const checkTitleTokens = (where, tpl) => {
    for (const t of titleTokens(tpl)) {
      const g = gOf(t);
      if (!g || (g.type !== 'choice' && g.type !== 'multi')) at(`${where}: {${t}} does not name a choice or multi group of this family`);
    }
  };
  if (!nonEmpty(f.title)) at('"title" must be a non-empty string');
  else checkTitleTokens('title', f.title);
  if (f.titleAny !== undefined) {
    const ta = f.titleAny;
    if (!isPlainObj(ta) || Object.keys(ta).sort().join() !== 'group,template') at('"titleAny" must be an object with exactly "group" and "template"');
    else {
      const tg = typeof ta.group === 'string' ? gOf(ta.group) : null;
      if (!tg || tg.type !== 'multi') at('titleAny: "group" must name a multi group of this family');
      if (!nonEmpty(ta.template)) at('titleAny: "template" must be a non-empty string');
      else checkTitleTokens('titleAny', ta.template);
    }
  }

  // widthRule
  if (f.widthRule !== undefined) {
    const r = f.widthRule;
    if (!isPlainObj(r) || !Array.isArray(r.terms) || !r.terms.length) at('"widthRule" needs a non-empty "terms" array');
    else {
      for (const k of Object.keys(r)) if (!['hard', 'allowance', 'noun', 'terms'].includes(k)) at(`widthRule: unknown key "${k}"`);
      if (r.hard !== undefined && typeof r.hard !== 'boolean') at('widthRule.hard must be true or false');
      if (r.allowance !== undefined && !(isIntNum(r.allowance) && r.allowance >= 0)) at('widthRule.allowance must be a whole number >= 0');
      if (r.noun !== undefined && !nonEmpty(r.noun)) at('widthRule.noun must be a non-empty string');
      r.terms.forEach((t, i) => {
        const g = isPlainObj(t) ? gOf(t.group) : null;
        if (!g) { at(`widthRule.terms[${i}]: unknown group`); return; }
        if (t.perUnit !== undefined) {
          if (!(isIntNum(t.perUnit) && t.perUnit > 0 && g.type === 'choice' && g.options.every((o) => typeof o.v === 'number'))) at(`widthRule.terms[${i}]: "perUnit" needs a positive whole number and a numeric choice group`);
        } else if (!((g.type === 'slots' || g.type === 'multi') && g.options.every((o) => isIntNum(o.w)))) at(`widthRule.terms[${i}]: a term without "perUnit" needs a slots / multi group whose options all carry "w"`);
      });
    }
  }
  // minDimWhen / maxDimWhen: [{ group, includes, min|max: { W?, D?, H? } }] — a chosen option forces a lower (an oven's depth) or an upper (a slim hood's depth, a deck oven's
  // width) limit on an axis the family has: whole mm inside the axis limits and on its step.
  const checkLimitRules = (listKey, valueKey) => {
    if (f[listKey] === undefined) return;
    if (!Array.isArray(f[listKey])) { at(`"${listKey}" must be an array`); return; }
    f[listKey].forEach((rule, i) => {
      const g = isPlainObj(rule) ? gOf(rule.group) : null;
      if (!g || !PF.optionOf(g, rule.includes)) { at(`${listKey}[${i}]: needs a known group and one of its option values in "includes"`); return; }
      const lim = rule[valueKey];
      if (!isPlainObj(lim) || !Object.keys(lim).length || !Object.keys(lim).every((k) => dims[k] && isIntNum(lim[k]) && lim[k] >= dims[k].min && lim[k] <= dims[k].max && lim[k] % dims[k].step === 0)) at(`${listKey}[${i}]: "${valueKey}" must name the family's own axes with values inside their limits and on the step`);
    });
  };
  checkLimitRules('minDimWhen', 'min');
  checkLimitRules('maxDimWhen', 'max');
  // a minimum and a maximum that can hold TOGETHER on one axis must not cross. Two rules on the SAME group can hold together when they name the same value of a choice group
  // (any two values of a multi group); rules on DIFFERENT groups are independent choices, so such a pair is refused rather than evaluated (none of the families needs one).
  if (Array.isArray(f.minDimWhen) && Array.isArray(f.maxDimWhen)) {
    f.minDimWhen.forEach((a, ia) => f.maxDimWhen.forEach((b, ib) => {
      if (!isPlainObj(a) || !isPlainObj(b) || !isPlainObj(a.min) || !isPlainObj(b.max)) return;       // already reported above
      const shared = Object.keys(a.min).filter((k) => Object.prototype.hasOwnProperty.call(b.max, k));
      if (!shared.length) return;
      const g = gOf(a.group);
      if (a.group !== b.group) { at(`minDimWhen[${ia}] and maxDimWhen[${ib}] limit the same axis from different groups: not supported (they could hold together and cross)`); return; }
      const together = g && g.type === 'choice' ? a.includes === b.includes : true;
      if (together && shared.some((k) => a.min[k] > b.max[k])) at(`minDimWhen[${ia}] and maxDimWhen[${ib}] can hold together but the minimum is above the maximum`);
    }));
  }
  // the family's own default size must be a valid size for its default options (a forced limit or a width rule cannot refuse the zero point)
  try {
    if (!PF.validateDims(fam, PF.defaultDims(fam), PF.defaultConfig(fam)).ok) at('the default size is not valid for the default options (a width rule or a forced limit refuses it)');
  } catch (e) { /* a malformed width rule or limit list was reported above */ }
  // specMap (old saved option -> new option)
  if (f.specMap !== undefined) {
    if (!isPlainObj(f.specMap)) at('"specMap" must be an object');
    else for (const label of Object.keys(f.specMap)) {
      const m = f.specMap[label];
      const g = isPlainObj(m) ? gOf(m.group) : null;
      if (!g || g.type !== 'choice' || !isPlainObj(m.values) || !Object.keys(m.values).every((k) => PF.optionOf(g, m.values[k]))) at(`specMap["${label}"]: needs a choice group and values that are its options`);
    }
  }
  // preview rules
  if (f.preview !== undefined) {
    const p = f.preview;
    if (!isPlainObj(p) || !isPlainObj(p.tokens) || !Array.isArray(p.chain) || !p.chain.length) at('"preview" needs "tokens" and a non-empty "chain"');
    else {
      for (const k of Object.keys(p)) if (!['tokens', 'chain', 'insets', 'insetEach', 'liveDiagram'].includes(k)) at(`preview: unknown key "${k}"`);
      for (const name of Object.keys(p.tokens)) {
        const t = p.tokens[name];
        const kinds = ['from', 'count', 'firstOf'].filter((k) => isPlainObj(t) && t[k] !== undefined);
        if (kinds.length !== 1) { at(`preview.tokens.${name}: exactly one of from / count / firstOf`); continue; }
        const g = gOf(t[kinds[0]]);
        if (!g) { at(`preview.tokens.${name}: unknown group`); continue; }
        if (kinds[0] === 'count' && g.type !== 'slots') at(`preview.tokens.${name}: "count" needs a slots group`);
        if (kinds[0] === 'firstOf') {
          if (g.type !== 'multi' || !Array.isArray(t.order) || !t.order.length || !t.order.every((x) => PF.optionOf(g, x))) at(`preview.tokens.${name}: "firstOf" needs a multi group and an "order" of its options`);
        }
        if (kinds[0] === 'from') {
          if (g.type !== 'choice') at(`preview.tokens.${name}: "from" needs a choice group`);
          else if (t.map !== undefined && !(isPlainObj(t.map) && g.options.every((o) => typeof t.map[String(o.v)] === 'string'))) at(`preview.tokens.${name}: "map" must give a string for every option of the group`);
        }
      }
      const declared = new Set(Object.keys(p.tokens));
      const refs = (tpl) => [...String(tpl).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
      p.chain.forEach((tpl, i) => { if (typeof tpl !== 'string' || !refs(tpl).every((n) => declared.has(n))) at(`preview.chain[${i}]: uses a token that is not declared`); });
      (p.insets || []).forEach((ins, i) => {
        if (!isPlainObj(ins) || typeof ins.template !== 'string' || !refs(ins.template).every((n) => declared.has(n))) { at(`preview.insets[${i}]: bad template`); return; }
        if (ins.when !== undefined && !(isPlainObj(ins.when) && Object.keys(ins.when).every((k) => { const g = gOf(k); return g && PF.optionOf(g, ins.when[k]); }))) at(`preview.insets[${i}]: "when" must name a group and one of its option values`);
      });
      if (p.insetEach !== undefined) {
        const ie = p.insetEach;
        const g = isPlainObj(ie) && isPlainObj(ie.over) ? gOf(ie.over.kinds) : null;
        if (!g || g.type !== 'slots' || !isPlainObj(ie.over.map) || !Object.keys(ie.over.map).every((k) => PF.optionOf(g, k) && typeof ie.over.map[k] === 'string') || typeof ie.template !== 'string' || !refs(ie.template).every((n) => n === 'kind')) at('preview.insetEach: needs a slots group, a value -> kind map and a template using only {kind}');
      }
      if (!p.tokens || !Object.keys(p.tokens).length) at('preview.tokens must declare at least one token');
    }
  }
  // absorbed SKUs: each strictly valid; the primary is one of them and IS the family's default configuration
  const ab = isPlainObj(f.absorbed) ? f.absorbed : null;
  if (!ab || !Object.keys(ab).length) at('"absorbed" must be a non-empty object of { sku: configuration }');
  else {
    // An absorbed SKU states every PUBLIC option and NEVER a staff-only one (it converts to that option's default: the standard 1.5 mm top plate).
    const publicKeys = PF.publicGroups(fam).map((g) => g.key).sort().join();
    const staffKeys = fam.groups.filter((g) => g.staffOnly === true).map((g) => g.key);
    for (const sku of Object.keys(ab)) {
      if (!ID_RE.test(sku)) { at(`absorbed: "${sku}" is not a product id`); continue; }
      const v = PF.validateConfiguration(fam, ab[sku]);
      if (!v.ok) at(`absorbed["${sku}"]: not a valid configuration (${v.errors.length} problem(s))`);
      else if (staffKeys.some((k) => Object.prototype.hasOwnProperty.call(ab[sku], k))) at(`absorbed["${sku}"]: must not state a staff-only option (it converts to that option's default)`);
      else if (Object.keys(ab[sku]).sort().join() !== publicKeys) at(`absorbed["${sku}"]: must state every option, and only the family's own`);
    }
    if (!Object.prototype.hasOwnProperty.call(ab, f.primary)) at('the primary SKU must be one of the absorbed SKUs');
    else if (PF.canonicalConfig(fam, PF.validateConfiguration(fam, ab[f.primary], { staff: true }).config) !== PF.canonicalConfig(fam, PF.defaultConfig(fam))) at('the primary SKU\'s configuration must equal the family defaults (the zero point the option deltas are measured from)');
  }
  // generated preview keys must be safe file-name stems that start with the family id
  if (f.preview) {
    try {
      const keys = PF.allPreviewKeys(fam);
      if (!keys.length) at('preview: the rules produce no keys');
      keys.forEach((k) => { if (!PREVIEW_KEY_RE.test(k) || !k.startsWith(`${fid}-`)) at(`preview: a generated key is not a safe file name starting "${fid}-"`); });
    } catch (e) { at('preview: the rules could not be evaluated'); }
  }
  // public text guard: every string of the family goes to the public page (and the server file)
  for (const [where, text] of stringPaths(fam, '', [])) {
    if (BRAND_RE.test(text) || brandInPath(text)) at(`${where}: partner-brand reference`);     // brandInPath also looks through hyphens / underscores (a file-name stem)
    if (isMoneyish(text)) at(`${where}: pricing pattern`);
  }
  return fam;
}

/**
 * loadPublicFamilies({ file, source, published, master }) -> {
 *   version, order, families:{id: family}, fixed:{sku: label}, absorbedIds:Set, familyOfSku:Map, photoOf:{id: productId|null }, fixedIds:Set }
 * Throws ONE aggregated Error (ids and keys only, never a value) on any problem. `published` (a Set of the published product ids) makes
 * the mapping COMPLETE: every published SKU is absorbed by exactly one family or listed under "fixed", never both, never neither.
 * `master` (the parsed private master) additionally checks the primaries and that sizeBasis matches the primary's formula type.
 */
function loadPublicFamilies(opts) {
  opts = opts || {};
  const file = opts.file || FAMILIES_FILE;
  const rel = path.relative(REPO_ROOT, file) || file;
  let j = opts.source;
  if (j === undefined) {
    if (!fs.existsSync(file)) throw new Error(`${rel} not found — it defines the eleven configurable product families`);
    try { j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
    catch (e) { throw new Error(`${rel} is not valid JSON: ${e.message}`); }
  }
  const problems = [];
  const add = (m) => problems.push(m);
  if (!isPlainObj(j)) throw new Error(`${rel} must be a JSON object`);
  for (const k of Object.keys(j)) if (!FAMILY_TOP_KEYS.includes(k)) add(`unknown top-level key "${k}"`);
  if (!(isIntNum(j.version) && j.version >= 1)) add('"version" must be a whole number >= 1');
  if (!isPlainObj(j.families) || !Object.keys(j.families).length) add('"families" must be a non-empty object');
  const famIds = isPlainObj(j.families) ? Object.keys(j.families) : [];
  if (!Array.isArray(j.order) || j.order.length !== famIds.length || !j.order.every((id) => famIds.includes(id)) || new Set(j.order).size !== j.order.length) add('"order" must list every family id exactly once');
  const families = {};
  const familyOfSku = new Map();
  const photoOf = {};
  for (const id of famIds) {
    const fam = checkFamily(id, j.families[id], add);
    if (!fam) continue;
    families[id] = fam;
    photoOf[id] = j.families[id].photo === undefined ? null : j.families[id].photo;
    for (const sku of Object.keys(fam.absorbed || {})) {
      if (familyOfSku.has(sku)) add(`"${sku}" is absorbed by two families ("${familyOfSku.get(sku)}" and "${id}")`);
      else familyOfSku.set(sku, id);
    }
  }
  const fixed = isPlainObj(j.fixed) ? j.fixed : null;
  if (!fixed) add('"fixed" must be an object of { sku: group label }');
  else for (const sku of Object.keys(fixed)) {
    if (!ID_RE.test(sku)) add(`fixed: "${sku}" is not a product id`);
    else if (typeof fixed[sku] !== 'string' || !fixed[sku].trim()) add(`fixed["${sku}"]: the group label must be a non-empty string`);
    else if (familyOfSku.has(sku)) add(`"${sku}" is both absorbed by "${familyOfSku.get(sku)}" and listed under fixed`);
  }
  if (opts.published) {
    const pub = opts.published;
    const classified = new Set([...familyOfSku.keys(), ...(fixed ? Object.keys(fixed) : [])]);
    for (const id of pub) if (!classified.has(id)) add(`${id}: a published product that is neither absorbed by a family nor listed under "fixed" — decide which`);
    for (const id of classified) if (!pub.has(id)) add(`${id}: not a published product (stale entry, or it was excluded in scripts/public-categories.json)`);
  }
  if (opts.master && Array.isArray(opts.master.products)) {
    const byId = new Map(opts.master.products.map((p) => [str(p && p.id), p]));
    for (const id of Object.keys(families)) {
      const f = families[id];
      const prim = byId.get(f.primary);
      if (!prim) { add(`family "${id}": the primary ${f.primary} is not in the master`); continue; }
      const lengthRule = prim.formulaType === 'per_length';
      if (lengthRule && f.sizeBasis === 'linear') add(`family "${id}": sizeBasis is "linear" but ${f.primary} already prices by length — use "primary"`);
      if (!lengthRule && f.sizeBasis !== 'linear') add(`family "${id}": ${f.primary} has no length rule of its own — set sizeBasis to "linear"`);
      const ph = photoOf[id];
      if (ph && !byId.has(ph)) add(`family "${id}": the photo product ${ph} is not in the master`);
    }
  }
  if (problems.length) throw new Error(`${rel}: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  const absorbedIds = new Set(familyOfSku.keys());
  return { version: j.version, order: j.order.slice(), families, fixed, absorbedIds, familyOfSku, photoOf, fixedIds: new Set(Object.keys(fixed)) };
}

/** The text of js/qr-families.js (and its byte-identical mirror functions/qr-families.js): the family definitions as one UMD module. Deterministic. */
function renderFamiliesJs(fams) {
  const out = { version: fams.version, order: fams.order.slice(), families: {} };
  for (const id of fams.order) {
    const f = fams.families[id];
    const o = {};
    for (const k of FAMILY_PUBLIC_KEYS) if (f[k] !== undefined) o[k] = f[k];
    out.families[id] = o;
  }
  const json = JSON.stringify(out, null, 2);
  return [
    '// js/qr-families.js — GENERATED by scripts/build-catalogue.js from scripts/public-families.json. DO NOT HAND-EDIT.',
    '// Edit scripts/public-families.json, then run: node scripts/build-catalogue.js (it also writes the byte-identical mirror',
    '// functions/qr-families.js — ci-invariants CHECK 10). The eleven configurable product families of the public catalogue: their',
    '// options, defaults, size limits, the SKUs each one absorbs, and the preview-image rules. It holds NO price of any kind: the option',
    '// amounts are kept in private staff data that no public page loads. Logic that walks these definitions: js/product-families.js.',
    '(function (root, factory) {',
    '  var api = factory();',
    "  if (typeof module === 'object' && module && module.exports) module.exports = api;   // functions/ + tests",
    '  if (root) root.QR_FAMILIES = api;',
    "})(typeof window !== 'undefined' ? window : null, function () {",
    "  'use strict';",
    '  return ' + json.replace(/\n/g, '\n  ') + ';',
    '});',
    ''
  ].join('\n');
}

// ── configurator preview images ─────────────────────────────────────────────
const PREVIEW_PATH_RE = /^site\/img\/configurator\/([a-z][a-z0-9_]{1,30})\/([a-z0-9][a-z0-9_-]{0,78})\.webp$/;
/**
 * loadPreviewManifest({ file, root, families }) -> { previews:{ family:{ key:{ src, thumb, width, height, mainWidth } } }, count }
 * The owner drops a WebP named by the preview key into site/img/configurator/<family>/ (+ a -thumb sibling) and adds a line to
 * scripts/configurator-previews.json. ABSENT file or empty "images" = no photos yet (the generated placeholders show). Present entries are
 * validated hard: a real family, a key the family's preview rules can actually ask for (so no unknown option value), the exact path, both
 * files present and readable WebP of the same shape. ONE aggregated Error on any problem (families, keys and paths only).
 */
function loadPreviewManifest(opts) {
  opts = opts || {};
  const file = opts.file || PREVIEWS_FILE;
  const root = opts.root || REPO_ROOT;
  const fams = opts.families;
  const previews = {};
  if (!fs.existsSync(file)) return { previews, count: 0 };
  const rel = path.relative(root, file) || file;
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { throw new Error(`${rel} is not valid JSON: ${e.message}`); }
  if (!isPlainObj(j)) throw new Error(`${rel} must be a JSON object with an "images" object`);
  const problems = [];
  for (const k of Object.keys(j)) if (!['_readme', 'images'].includes(k)) problems.push(`unknown top-level key "${k}"`);
  if (!isPlainObj(j.images)) problems.push('"images" must be an object of { family: { key: path } }');
  let count = 0;
  const sizeCache = new Map();
  const sizeOf = (p) => { if (!sizeCache.has(p)) { let s = null; try { s = webpSize(fs.readFileSync(path.join(root, p))); } catch (_) { /* reported by the exists check */ } sizeCache.set(p, s); } return sizeCache.get(p); };
  if (isPlainObj(j.images)) {
    for (const fid of Object.keys(j.images)) {
      const fam = fams && fams.families && fams.families[fid];
      if (!fam) { problems.push(`${fid}: not a product family`); continue; }
      if (!isPlainObj(j.images[fid])) { problems.push(`${fid}: must be an object of { key: path }`); continue; }
      const valid = new Set(PF.allPreviewKeys(fam));
      for (const key of Object.keys(j.images[fid])) {
        const val = j.images[fid][key];
        const tag = `${fid}/${key}`;
        if (!valid.has(key)) { problems.push(`${tag}: not a preview key this family can ask for (an unknown option value?)`); continue; }
        const expect = `site/img/configurator/${fid}/${key}.webp`;
        if (typeof val !== 'string' || val !== expect) { problems.push(`${tag}: the path must be exactly ${expect}`); continue; }
        if (brandInPath(val) || isMoneyish(val)) { problems.push(`${tag}: the path trips a pricing / partner-brand guard`); continue; }
        const thumb = thumbPathOf(val);
        let ok = true;
        for (const f of [val, thumb]) if (!fs.existsSync(path.join(root, f))) { problems.push(`${tag}: missing file ${f}`); ok = false; }
        if (!ok) continue;
        const m = sizeOf(val), t = sizeOf(thumb);
        if (!m || !t) { problems.push(`${tag}: ${!m ? val : thumb} is not a readable WebP`); continue; }
        if (Math.abs(m.width / m.height - t.width / t.height) > 0.03) { problems.push(`${tag}: the image and its thumb have different shapes`); continue; }
        if (t.width >= m.width) { problems.push(`${tag}: the thumb must be narrower than the image`); continue; }
        (previews[fid] = previews[fid] || {})[key] = { src: val, thumb, width: t.width, height: t.height, mainWidth: m.width };
        count++;
      }
    }
  }
  if (problems.length) throw new Error(`${rel}: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  return { previews, count };
}

// ── rendering ───────────────────────────────────────────────────────────────
function dimsText(dd) {
  if (!dd) return '';
  const have = ['W', 'D', 'H'].filter(k => dd[k] != null);
  if (!have.length) return '';
  // Plain String(n): a thousands separator ("1,200") would trip the money scan and CHECK 9.
  if (have.length === 3) return `${dd.W} × ${dd.D} × ${dd.H} mm`;
  return have.map(k => `${k} ${dd[k]}`).join(' × ') + ' mm';
}

// A FIXED card is compact and horizontal: a narrow image "well" on the left (the photo when there is one, otherwise a small category
// line-icon — never a big letter), then the code / name / size line, then a labelled Notes block (and a labelled Specifications list when
// the master carries material rows), then "Add to quote" (appended at run time by js/quote-request.js as the card's last child).
// A CONFIGURABLE card (renderFamilyCard) is the wide featured card: same parts, a bigger photo. The layout lives in css/catalogue.css.
const PHOTO_SIZES = '(min-width:720px) 96px, 80px';                                                  // the fixed card's image well
const FEATURE_PHOTO_SIZES = '(min-width:1024px) 360px, (min-width:720px) 45vw, calc(100vw - 34px)';   // the featured card's photo
const SEARCH_ICON = '<svg class="cat-search-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';

const PHOTO_FIGURE = (photo, name, sizes) =>
  `<figure class="cat-photo"><img src="/${esc(photo.thumb)}" srcset="/${esc(photo.thumb)} ${photo.width}w, /${esc(photo.src)} ${photo.mainWidth}w" sizes="${sizes || PHOTO_SIZES}" width="${photo.width}" height="${photo.height}" alt="${esc(name)}" loading="lazy" decoding="async"><figcaption>Representative image</figcaption></figure>`;

// The placeholder for a product with no photo yet: one line-icon per public category (24 x 24, stroke only, path / circle only — the tags the
// page's generated block is allowed to carry; numbers separated by spaces, never a comma, so CHECK 9's "thousands separator" scan stays quiet).
// Decorative (the tile is aria-hidden): the card's name and code say what the product is. A category with no icon gets a plain box.
const TILE_ICONS = Object.freeze({
  preparation: '<path d="M2.5 8h19v2.6h-19z"/><path d="M5 10.6V20M19 10.6V20M5 15.4h14"/>',
  washing: '<path d="M9 11.5V6.2A2.2 2.2 0 0 1 11.2 4H14a2.5 2.5 0 0 1 2.5 2.5V8"/><path d="M16.5 8v1.6"/><path d="M3 12h18l-1.3 6.2a2.2 2.2 0 0 1-2.2 1.8h-11a2.2 2.2 0 0 1-2.2-1.8z"/>',
  cooking: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  ventilation: '<path d="M3 15h18l-3.2-7H6.2z"/><path d="M10 8V3.5h4V8"/><path d="M7 18.5c0 1.2 1 1.6 1 3M12 18.5c0 1.2 1 1.6 1 3M17 18.5c0 1.2 1 1.6 1 3"/>',
  storage: '<path d="M5 3h14v17H5z"/><path d="M12 3v17"/><path d="M7 20v1.8M17 20v1.8"/><circle cx="9.6" cy="12" r=".7"/><circle cx="14.4" cy="12" r=".7"/>',
  refrigeration: '<path d="M12 2.5v19M9.2 4.6 12 6.8l2.8-2.2M9.2 19.4 12 17.2l2.8 2.2"/><path transform="rotate(60 12 12)" d="M12 2.5v19M9.2 4.6 12 6.8l2.8-2.2M9.2 19.4 12 17.2l2.8 2.2"/><path transform="rotate(120 12 12)" d="M12 2.5v19M9.2 4.6 12 6.8l2.8-2.2M9.2 19.4 12 17.2l2.8 2.2"/>',
});
const TILE_ICON_DEFAULT = '<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v9"/>';
const TILE = (categoryId) =>
  `<div class="cat-tile" aria-hidden="true"><svg class="cat-ic" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${has(TILE_ICONS, categoryId) ? TILE_ICONS[categoryId] : TILE_ICON_DEFAULT}</svg></div>`;

// The labels above the product notes. The owner's own word for the field is "notes" (2026-10-21: "put notes, it is very important"), and it
// is always accurate — a note can be a specification ("SS1.2mm top, 0.8mm lower"), a remark ("Larger variant of CE-012") or a status ("Pending
// full spec confirmation per project"). The material rows (grade, gauge, finish …) are specifications. Nothing is ever shortened: the page
// shows the whole note, and a card with no note shows no label and no placeholder.
const LABEL_NOTES = 'Notes';
const LABEL_SPECS = 'Specifications';
const LABEL = (text) => `<p class="cat-label">${text}</p>`;
const SPEC_LIST = (rows) => `<dl class="cat-specs">${rows.map((r) => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join('')}</dl>`;

// The material line of every configurable card. NOT a new claim: it is the owner's own public statement of what is offered — two stainless grades,
// SS304 food-grade (the standard) and SS316 laboratory-grade, and three finishes, brushed, mirror or satin (owner, 2026-10-21) — the same as the
// homepage proof bar, hero lead and Fabrication step and the catalogue lede. The WEBSITE configurators and the quote flow offer no grade or finish choice
// (the SS316 grade is a staff-only choice in the Quote Builder, 2026-10-28; website pricing for a grade is undecided): the line only says what Barro can supply;
// the customer asks for it in the quote's notes. tests/catalogue-layout.test.mjs
// and tests/site-public-surface.test.mjs pin it to the homepage wording, so a card can never claim a material the homepage does not.
const FAMILY_MATERIAL = 'SS304 food-grade (standard) or SS316 laboratory-grade · brushed, mirror or satin finish';

// The product page of each configurable family (SEO build, 2026-10-22: /products/ and one page per product, written by hand and pinned by
// tests/seo-products.test.mjs, which also checks that these are the families of scripts/public-families.json). A family card ends with a
// "Learn more" link to its page. A family with no page here simply has no link (a new family needs its page first). The last five pages arrived with the
// five new families (CONFIGURATOR-FAMILIES-2-SPEC §6.3, 2026-10-28).
const FAMILY_PAGES = Object.freeze({
  prep_table:   { path: '/products/stainless-steel-work-tables/',            about: 'stainless steel work tables' },
  sink:         { path: '/products/stainless-steel-sinks/',                  about: 'stainless steel sinks' },
  dish_table:   { path: '/products/stainless-steel-dish-tables/',            about: 'stainless steel dish tables' },
  stove:        { path: '/products/commercial-gas-stoves/',                  about: 'commercial gas stoves' },
  wok_range:    { path: '/products/commercial-wok-ranges/',                  about: 'commercial wok ranges' },
  cooking_line: { path: '/products/commercial-griddles-grillers-and-fryers/', about: 'commercial griddles, grillers and fryers' },
  deck_oven:    { path: '/products/gas-deck-ovens/',                         about: 'gas deck ovens' },
  hood:         { path: '/products/stainless-steel-range-hoods/',            about: 'stainless steel range hoods' },
  cabinet:      { path: '/products/stainless-steel-cabinets/',               about: 'stainless steel cabinets' },
  wall_shelf:   { path: '/products/stainless-steel-shelving/',               about: 'stainless steel shelving' },
  rack:         { path: '/products/stainless-steel-racks/',                  about: 'stainless steel racks' },
});

// The card of a CONFIGURABLE family: one card per family, rendered as the wide FEATURED card (css/catalogue.css: the full row, the photo on
// the left, the text on the right) — the "Configurable" tag, the name, the family description (the lead paragraph), then a labelled
// Specifications list: the options it offers, the size line and the material (this is also what the live search reads), then the "Learn more"
// link to the product page, and the names/codes of the SKUs it absorbed in data-kw (search only — never shown). The "Configure & add" button is
// added at run time by js/quote-request.js (like "Add to quote" on a fixed item), so the card needs no script to read.
function renderFamilyCard(fam, cat, photo, keywords) {
  const mark = photo ? PHOTO_FIGURE(photo, fam.label, FEATURE_PHOTO_SIZES) : TILE((cat && cat.id) || fam.category);
  const rows = [];
  for (const g of PF.publicGroups(fam)) {            // never a staff-only group (the 1.2 mm top plate is offered in the Quote Builder only)
    if (g.type === 'slots') rows.push([g.label, `Up to ${g.maxSlots} ${g.unit ? g.unit.many : 'positions'}, each chosen one by one`]);
    else {
      const when = PF.whenText(fam, g);                // a conditional option says when it applies: "Fry baskets — 1 / 2 / 3 (Type is Fryer)"
      rows.push([g.label, g.options.map((o) => o.l).join(' / ') + (when ? ` (${when})` : '')]);
    }
  }
  // the size line names the axes THIS family really has (wall shelving has a length and a depth, no height)
  const axes = ['W', 'D', 'H'].filter((k) => fam.dims && fam.dims[k]).map((k) => String(fam.dims[k].label).toLowerCase());
  const axesText = axes.length > 1 ? axes.slice(0, -1).join(', ') + ' and ' + axes[axes.length - 1] : (axes[0] || 'size');
  rows.push(['Size', 'Made to your ' + axesText]);
  // the standard construction (owner ruling 2026-10-28): how the made-to-order piece is built, at the family's DEFAULT options (1.5 mm top, 1.2 mm body …)
  const construction = PF.constructionLine(fam, PF.defaultConfig(fam));
  if (construction) rows.push(['Construction', construction]);
  rows.push(['Material', FAMILY_MATERIAL]);
  return `<li class="cat-card cat-card-family cat-card-feature${photo ? ' has-photo' : ''}" data-family="${esc(fam.id)}" data-kw="${esc(keywords)}">` + mark +
    `<div class="cat-head"><p class="cat-code cat-tag">Configurable</p><h3>${esc(fam.label)}</h3><p class="cat-lead">${esc(fam.description)}</p></div>` +
    `<div class="cat-body">${LABEL(LABEL_SPECS)}${SPEC_LIST(rows)}${learnMore(fam)}</div>` +
    `</li>`;
}

// "Learn more" under a family's specifications: a plain link to its product page (no script, no price word: CHECK 9 scans this block)
function learnMore(fam) {
  const page = has(FAMILY_PAGES, fam.id) ? FAMILY_PAGES[fam.id] : null;
  return page ? `<p class="cat-learn"><a class="link-arrow" href="${esc(page.path)}">Learn more about ${esc(page.about)}</a></p>` : '';
}

function renderCard(p, cat, photo) {
  const mark = photo ? PHOTO_FIGURE(photo, p.name) : TILE(cat && cat.id);
  const meta = [dimsText(p.defaultDimensions), p.unit ? `per ${p.unit}` : ''].filter(Boolean).join(' · ');
  const rows = [];
  if (p.material) for (const k of MATERIAL_KEYS) if (p.material[k]) rows.push([MATERIAL_LABELS[k], p.material[k]]);
  // The master's ad-hoc option lists (p.specs) are NOT shown any more (owner ruling 2026-10-21): a fixed item is quantity + size + note only,
  // and the configurable options live on the family cards. publicProduct() still scans every spec string, so a guard hit is still refused.
  // The note is shown whole, under its label; a product with no note (or no material rows) shows no label and no placeholder for it.
  const body = (p.notes ? LABEL(LABEL_NOTES) + `<p class="cat-notes">${esc(p.notes)}</p>` : '') + (rows.length ? LABEL(LABEL_SPECS) + SPEC_LIST(rows) : '');
  return `<li class="cat-card${photo ? ' has-photo' : ''}" data-id="${esc(p.id)}">` + mark +
    `<div class="cat-head"><p class="cat-code">${esc(p.id)}</p><h3>${esc(p.name)}</h3>${meta ? `<p class="cat-meta">${esc(meta)}</p>` : ''}</div>` +
    (body ? `<div class="cat-body">${body}</div>` : '') +
    `</li>`;
}

/**
 * renderCatalogue(db[, opts]) -> the HTML block (string) that goes between the
 * CATALOGUE markers of catalogue/index.html: the intro + search, the category nav
 * (desktop sidebar / mobile chip bar) and one section per PUBLIC category holding EVERY product.
 * opts: { report, noteOverrides, textFixes, photos, publicCategories, excludedCategories, families }.
 *   photos            loadPhotoMap().photos (or a fixture)
 *   publicCategories  loadPublicCategories() (default: scripts/public-categories.json)
 *   families          loadPublicFamilies() — when given, an ABSORBED SKU gets no card of its own (its family's card stands for it),
 *                     each family is ONE "Configurable" card placed first in its category, and every other published SKU must be
 *                     listed under "fixed" (a SKU in neither place refuses the build). Absent -> every published SKU is a card (v1).
 * Products in an excluded master category, or listed under excludedProducts, are skipped entirely.
 * Throws one aggregated CatalogueGuardError listing EVERY violating product.
 */
function renderCatalogue(db, opts) {
  opts = opts || {};
  const report = opts.report || {};
  const overrides = opts.noteOverrides || NOTE_OVERRIDES;
  const fixes = opts.textFixes || TEXT_FIXES;
  const photos = opts.photos || {};
  const excludedCats = new Set(opts.excludedCategories || EXCLUDED_CATEGORIES);
  const photoOf = (id) => (has(photos, id) ? photos[id] : null);

  if (!db || !Array.isArray(db.categories) || !Array.isArray(db.products)) {
    throw new Error('master JSON must have "categories" and "products" arrays');
  }
  const pub = opts.publicCategories || loadPublicCategories({ ids: db.products.map(p => str(p && p.id)).filter(Boolean) });
  const fams = opts.families || null;
  const absorbedIds = fams ? fams.absorbedIds : new Set();

  const violations = [];
  const add = makeSink(violations);
  const applied = [];
  const fixed = [];
  const droppedMaterialKeys = [];

  // Master categories: only their ids matter now (they place a product); the public page uses its own five.
  // A label that carries a price word or the partner name still refuses the build, unless the category is never published.
  const masterCats = new Set();
  db.categories.forEach((c, i) => {
    const cid = str(c && c.id);
    const lbl = cid || `(category #${i})`;
    if (!CAT_ID_RE.test(cid)) add(lbl, 'category.id', 'shape');
    masterCats.add(cid);
    if (excludedCats.has(cid)) return;
    for (const f of brandPaths(c, '', [])) add(lbl, `category.${f}`, 'brand');
    const label = str(c && c.label);
    if (!label) add(lbl, 'category.label', 'shape');
    scanEmitted(add, lbl, 'category.id', cid);
    scanEmitted(add, lbl, 'category.label', label);
  });

  const groupById = new Map(PUBLIC_CATEGORIES.map(c => [c.id, { id: c.id, label: c.label, products: [], familyCards: [] }]));
  const absorbed = [];
  const skipped = { categories: {}, categoryIds: [], products: [] };
  const rawIds = new Set();
  const seenIds = new Set();
  for (const raw of db.products) {
    const rid = str(raw && raw.id), rcat = str(raw && raw.category);
    if (rid) rawIds.add(rid);
    if (excludedCats.has(rcat)) { skipped.categories[rcat] = (skipped.categories[rcat] || 0) + 1; skipped.categoryIds.push(rid); continue; }
    if (rid && has(pub.excludedProducts, rid)) { skipped.products.push(rid); continue; }
    let p;
    try {
      p = publicProduct(raw, { noteOverrides: overrides, textFixes: fixes, applied, fixed, droppedMaterialKeys });
    } catch (e) {
      if (e instanceof CatalogueGuardError) { e.violations.forEach(v => add(v.id, v.field, v.rule)); continue; }
      throw e;
    }
    if (seenIds.has(p.id)) { add(p.id, 'id', 'shape'); continue; }
    seenIds.add(p.id);
    if (!masterCats.has(p.category)) { add(p.id, 'category', 'shape'); continue; }
    const target = has(pub.products, p.id) ? groupById.get(pub.products[p.id]) : null;
    if (!target) { add(p.id, 'publicCategory', 'unmapped'); continue; }
    if (fams) {
      if (absorbedIds.has(p.id)) { absorbed.push(p); continue; }          // a family's card stands for it
      if (!fams.fixedIds.has(p.id)) { add(p.id, 'families', 'family'); continue; }
    }
    target.products.push(p);
  }
  // a mapping that names a product the master does not have is stale
  for (const id of [...Object.keys(pub.products), ...Object.keys(pub.excludedProducts)]) {
    if (!rawIds.has(id)) add(id, 'publicCategory', 'stale');
  }
  if (fams) {
    const seen = new Set([...seenIds]);
    for (const id of [...absorbedIds, ...fams.fixedIds]) if (!seen.has(id)) add(id, 'families', 'familyStale');
    for (const fid of fams.order) {
      const f = fams.families[fid];
      const grp = groupById.get(f.category);
      if (!grp) { add(fid, 'category', 'shape'); continue; }
      grp.familyCards.push(f);
    }
  }
  if (violations.length) throw new CatalogueGuardError(violations);

  // Order: the five public categories as ruled; inside each, the master's own category order and then id — so
  // "Cooking" opens with the cooking line (stoves, fryers, ovens) and bakery items follow, not the other way round.
  // A category with no product is left out.
  const groups = [...groupById.values()].filter(c => c.products.length || c.familyCards.length);
  const masterOrder = new Map(db.categories.map((c, i) => [str(c && c.id), i]));
  const byOrder = (a, b) => (masterOrder.get(a.category) - masterOrder.get(b.category)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const g of groups) g.products.sort(byOrder);
  const cardsIn = (g) => g.familyCards.length + g.products.length;
  const total = groups.reduce((n, g) => n + cardsIn(g), 0);
  // the names and codes a family's search text carries: the SKUs it absorbed (never shown on the card)
  const keywordsOf = (fid) => absorbed.filter(a => fams.familyOfSku.get(a.id) === fid).map(a => `${a.id} ${a.name}`).join(' ');
  const nCats = groups.length;

  const lines = [];
  // intro: eyebrow, title, lede, search, live status
  lines.push('<section class="cat-intro" id="catalogue-top">');
  lines.push('<div class="site-wrap">');
  lines.push(`<p class="eyebrow"><span data-brand>${esc(SITE_BRAND_NAME)}</span></p>`);
  // SEO build, 2026-10-22: the H1 and the opening sentence carry the page's keyword ("commercial kitchen equipment") and who it is for; the sentences after
  // it are the owner's own, unchanged (tests/catalogue-layout.test.mjs, catalogue-public.test.mjs and site-public-surface.test.mjs pin them).
  lines.push('<h1>Commercial kitchen equipment catalogue</h1>');
  lines.push('<p class="cat-lede">Commercial kitchen equipment for restaurants, hotels, bakeries, catering and commissary kitchens: preparation, washing, cooking, ventilation, storage and refrigeration. Premium stainless-steel equipment in food-grade SS304 as standard, or laboratory-grade SS316, built to your specifications. Default sizes are in millimetres. Ask us for a quotation on any item.</p>');
  lines.push('<form class="cat-search" id="cat-search-form" role="search">');
  lines.push('<label class="sr-only" for="cat-search">Search products</label>');
  lines.push(SEARCH_ICON);
  lines.push(`<input type="search" id="cat-search" placeholder="Search ${total} products" autocomplete="off" enterkeyhint="search" spellcheck="false">`);
  lines.push('<button type="button" id="cat-search-clear" class="cat-clear" aria-label="Clear search" hidden>×</button>');
  lines.push('</form>');
  lines.push(`<p class="cat-status" id="cat-status" role="status" aria-live="polite">${total} products in ${nCats} categories</p>`);
  lines.push('</div>');
  lines.push('</section>');
  // body: category nav + one section per category
  lines.push('<div class="site-wrap cat-layout" id="catalogue">');
  lines.push('<nav class="cat-nav" id="cat-nav" aria-label="Product categories">');
  lines.push('<p class="cat-nav-title" aria-hidden="true">Categories</p>');
  lines.push('<ul>');
  for (const g of groups) {
    lines.push(`<li><a class="cat-link" href="#cat-${esc(g.id)}" data-cat="${esc(g.id)}"><span class="cat-link-name">${esc(g.label)}</span><span class="cat-link-n" data-total="${cardsIn(g)}">${cardsIn(g)}</span></a></li>`);
  }
  lines.push('</ul>');
  lines.push('</nav>');
  lines.push('<div class="cat-main">');
  for (const g of groups) {
    const n = cardsIn(g);
    lines.push(`<section class="cat-group" id="cat-${esc(g.id)}" data-cat="${esc(g.id)}" aria-labelledby="cat-h-${esc(g.id)}">`);
    lines.push(`<h2 id="cat-h-${esc(g.id)}">${esc(g.label)} <span class="cat-count">${n}</span></h2>`);
    // two or more configurable products in one category sit side by side (css: .cat-grid-multi); a lone one is the wide featured card
    lines.push(`<ul class="cat-grid${g.familyCards.length > 1 ? ' cat-grid-multi' : ''}">`);
    for (const f of g.familyCards) lines.push(renderFamilyCard(f, g, fams.photoOf[f.id] ? photoOf(fams.photoOf[f.id]) : null, keywordsOf(f.id)));
    for (const p of g.products) lines.push(renderCard(p, g, photoOf(p.id)));
    lines.push('</ul>');
    lines.push('</section>');
  }
  lines.push('<div class="cat-empty" id="cat-empty" hidden>');
  lines.push('<p class="cat-empty-title">No products match “<span id="cat-empty-q"></span>”.</p>');
  lines.push('<p>Try a different word, or tell us what you need and we will send you a quotation.</p>');
  lines.push('<p class="cat-empty-actions"><a class="site-btn site-btn-primary" href="/catalogue/?quote=1" data-qr-start>Request a quote</a><button type="button" id="cat-empty-clear" class="site-btn site-btn-outline">Clear search</button></p>');
  lines.push('</div>');
  lines.push('</div>');
  lines.push('</div>');
  const html = lines.join('\n');

  // Last line of defence: scan the finished markup itself, so a regression in this
  // template (not just in the data) cannot ship a price or the partner name.
  const last = [];
  const addLast = makeSink(last);
  if (BRAND_RE.test(html) || brandInPath(html)) addLast('(rendered block)', 'html', 'brand');
  if (isMoneyish(html)) addLast('(rendered block)', 'html', 'money');
  if (last.length) throw new CatalogueGuardError(last);

  // Overrides / fixes recorded for a product that is not published are SKIPPED, not "unused"
  const notPublished = new Set([...skipped.categoryIds, ...skipped.products]);
  report.total = total;
  report.categories = groups.map(g => ({ id: g.id, label: g.label, count: cardsIn(g) }));
  report.published = groups.flatMap(g => g.products.map(p => ({ id: p.id, category: g.id })));       // the FIXED items (every published SKU when no families)
  report.families = groups.flatMap(g => g.familyCards.map(f => ({ id: f.id, category: g.id })));
  report.absorbed = absorbed.map(a => ({ id: a.id, family: fams.familyOfSku.get(a.id) }));
  report.skipped = { categories: skipped.categories, categoryProducts: skipped.categoryIds.length, products: skipped.products };
  report.overrides = applied;
  report.unusedOverrides = Object.keys(overrides).filter(k => !applied.some(a => a.id === k) && !notPublished.has(k));
  report.skippedOverrides = Object.keys(overrides).filter(k => notPublished.has(k));
  report.textFixes = fixed;
  report.unusedTextFixes = [];
  report.skippedTextFixes = [];
  for (const id of Object.keys(fixes)) {
    for (const field of Object.keys(fixes[id])) {
      if (fixed.some(f => f.id === id && f.field === field)) continue;
      (notPublished.has(id) ? report.skippedTextFixes : report.unusedTextFixes).push(`${id}.${field}`);
    }
  }
  report.droppedMaterialKeys = droppedMaterialKeys;
  report.photos = groups.reduce((n, g) => n + g.products.filter(p => photoOf(p.id)).length + g.familyCards.filter(f => fams.photoOf[f.id] && photoOf(fams.photoOf[f.id])).length, 0);
  return html;
}

/**
 * renderCatalogueData(db[, opts]) -> the "Add to quote" data island (PUBLIC-QUOTE-REQUEST-SPEC.md §3.4): ONE JSON string
 * {"v":2,"products":[…one product per line…],"previews":{…}} where, for every FIXED published product (every published product
 * when no families are given), `products` holds ONLY
 *   { id, name, cat, unit, dims? }
 * and nothing else (no master option lists: a fixed item is quantity + size + note only, owner ruling 2026-10-21) — price-free BY CONSTRUCTION: every product goes through the SAME publicProduct() allowlist, the same
 * TEXT_FIXES / NOTE_OVERRIDES and the same money / partner-brand scans as the cards, and the finished string is scanned
 * again. The configurable FAMILIES (eleven) are not in the island: the page reads them from js/qr-families.js (window.QR_FAMILIES).
 * `previews` is the validated configurator-photo manifest, { family: { key: { s: image, t: thumb, w, h, m } } } — empty until the owner adds photos.
 * It walks the SAME product set as renderCatalogue() by calling it (so the guard errors, the exclusions, the
 * public-category map and the page order are identical, and a product can never be quotable without being on the page).
 *   cat   the PUBLIC category id (preparation / washing / cooking / ventilation / storage / refrigeration) — the page's own grouping
 *   unit  as the master has it, 'pc' when blank (the Quote Builder's own fallback)
 *   dims  the finite positive default W / D / H in mm — the page decides which size inputs to show from these keys alone
 * `<` is written as <, so no string can ever close the <script> element or open an HTML comment inside it.
 * Throws CatalogueGuardError (naming the island, never the offending text) on any money / brand hit.
 */
function renderCatalogueData(db, opts) {
  opts = opts || {};
  const report = opts.report || {};
  renderCatalogue(db, Object.assign({}, opts, { report }));              // the one product walk — throws first on any guard hit
  const overrides = opts.noteOverrides || NOTE_OVERRIDES;
  const fixes = opts.textFixes || TEXT_FIXES;
  const byId = new Map(db.products.map(p => [str(p && p.id), p]));
  const products = report.published.map(({ id, category }) => {
    const p = publicProduct(byId.get(id), { noteOverrides: overrides, textFixes: fixes });
    const out = { id: p.id, name: p.name, cat: category, unit: p.unit || 'pc' };
    if (p.defaultDimensions) out.dims = Object.assign({}, p.defaultDimensions);
    return out;
  });
  const body = products.map(x => JSON.stringify(x)).join(',\n');
  const pv = {};
  const prevSrc = opts.previews || {};
  for (const fid of Object.keys(prevSrc).sort()) {
    pv[fid] = {};
    for (const key of Object.keys(prevSrc[fid]).sort()) {
      const x = prevSrc[fid][key];
      pv[fid][key] = { s: x.src, t: x.thumb, w: x.width, h: x.height, m: x.mainWidth };
    }
  }
  const json = (`{"v":2,"products":[\n${body}\n],"previews":${JSON.stringify(pv)}}`).replace(/</g, '\\u003c');
  const last = [];
  const addLast = makeSink(last);
  if (BRAND_RE.test(json) || brandInPath(json)) addLast('(data island)', 'json', 'brand');
  if (isMoneyish(json)) addLast('(data island)', 'json', 'money');
  if (last.length) throw new CatalogueGuardError(last);
  // Self-check: the island must parse and carry exactly the published ids, in page order.
  const parsed = JSON.parse(json);
  if (parsed.products.length !== report.published.length) throw new Error('data island lost a product');
  return json;
}

/** The server-side allowlist file: the published product ids, sorted, ids only (functions/qr-published.json). */
function renderPublishedIds(published) {
  const ids = [...published].sort();
  return JSON.stringify({
    _readme: 'GENERATED by scripts/build-catalogue.js from publishedProductIds() minus the SKUs the product families absorb — the same computation that decides which FIXED products reach /catalogue/ as their own card. Do not hand-edit; run: node scripts/build-catalogue.js. The quote-request callables accept these ids as plain lines (quantity + size + note); the configurable families are quoted through js/qr-families.js instead, and everything else (exhaust, fresh air, gas line, fire suppression, the excluded items, the absorbed SKUs, anything unmapped) is refused. Ids only — no prices.',
    count: ids.length,
    ids,
  }, null, 2) + '\n';
}

/** Put the island between the QR:DATA markers (first run: replace the <!-- QR:DATA --> placeholder). Idempotent. */
function injectIsland(html, json, label) {
  label = label || 'catalogue/index.html';
  const count = (needle) => html.split(needle).length - 1;
  const script = `<script type="application/json" id="qr-catalogue">${json}</script>`;
  const nStart = count(QR_START_MARKER), nEnd = count(QR_END_MARKER);
  if (nStart === 1 && nEnd === 1) {
    const a = html.indexOf(QR_START_MARKER) + QR_START_MARKER.length;
    const b = html.indexOf(QR_END_MARKER);
    if (b < a) throw new Error(`QR:DATA:END appears before QR:DATA:START in ${label}`);
    return html.slice(0, a) + '\n' + script + '\n' + html.slice(b);
  }
  if (nStart !== 0 || nEnd !== 0) throw new Error(`${label} must contain the QR:DATA:START and QR:DATA:END markers exactly once each (found ${nStart} / ${nEnd})`);
  if (count(QR_PLACEHOLDER) !== 1) throw new Error(`${label} must contain the ${QR_PLACEHOLDER} placeholder (or the QR:DATA markers) exactly once (found ${count(QR_PLACEHOLDER)})`);
  // A replacer FUNCTION, never a replacement string: String.replace expands $&, $', $` and $1 inside a replacement string, so a product
  // name containing "$'" would splice the rest of the page into the island (and every guard above has already passed by then).
  return html.replace(QR_PLACEHOLDER, () => `${QR_START_MARKER}\n${script}\n${QR_END_MARKER}`);
}

/**
 * renderItemListLd(db[, opts]) -> the JSON-LD ItemList (a JSON string) that goes between the LD:ITEMLIST markers in the <head> of
 * catalogue/index.html: every product the page shows, in PAGE ORDER (the five public categories as ruled; inside each, the
 * configurable products first, then the fixed items), and for each one ONLY
 *   { "@type": "ListItem", "position": n, "name": <the card's name>, "url": "https://barroindustries.com/catalogue/#cat-<category>" }
 * The url is the anchor of the product's CATEGORY section: that is the only anchor the page has (cards carry no id of their own).
 * Price-free BY CONSTRUCTION, like the cards and the data island: no price, offer, availability, sku, image or description key ever
 * enters the list (it is built field by field from the names), every name goes through the same publicProduct() allowlist, the same
 * TEXT_FIXES / NOTE_OVERRIDES and the same money / partner-brand scans as the cards, and the finished string is scanned again.
 * It walks the SAME product set as renderCatalogue() by calling it (so the exclusions, the public-category map and the page order are
 * identical, and the list can never name a product the page does not show). Throws CatalogueGuardError on any money / brand hit.
 * Every `<` is written as the JSON escape backslash-u-003c, so no string can ever close the <script> element or open an HTML comment inside it.
 * opts: the renderCatalogue() options, plus listName (default ITEM_LIST_NAME; an option only so the final scan of the whole JSON can be exercised).
 */
function renderItemListLd(db, opts) {
  opts = opts || {};
  const report = opts.report || {};
  renderCatalogue(db, Object.assign({}, opts, { report }));              // the one product walk — throws first on any guard hit
  const fams = opts.families || null;
  const overrides = opts.noteOverrides || NOTE_OVERRIDES;
  const fixes = opts.textFixes || TEXT_FIXES;
  const byId = new Map(db.products.map(p => [str(p && p.id), p]));
  const items = [];
  for (const c of report.categories) {
    for (const f of report.families.filter(x => x.category === c.id)) items.push({ name: fams.families[f.id].label, cat: c.id });
    for (const p of report.published.filter(x => x.category === c.id)) {
      items.push({ name: publicProduct(byId.get(p.id), { noteOverrides: overrides, textFixes: fixes }).name, cat: c.id });
    }
  }
  if (items.length !== report.total) throw new Error('item list lost a product');
  const listName = str(opts.listName) || ITEM_LIST_NAME;               // an option only so the last-line guard below can be exercised
  const rows = items.map((x, i) => JSON.stringify({ '@type': 'ListItem', position: i + 1, name: x.name, url: `${CATALOGUE_URL}#cat-${x.cat}` }));
  const json = (`{"@context":"https://schema.org","@type":"ItemList","name":${JSON.stringify(listName)},"url":${JSON.stringify(CATALOGUE_URL)},` +
    `"numberOfItems":${items.length},"itemListElement":[\n${rows.join(',\n')}\n]}`).replace(/</g, '\\u003c');
  const last = [];
  const addLast = makeSink(last);
  if (BRAND_RE.test(json) || brandInPath(json)) addLast('(item list)', 'json', 'brand');
  if (isMoneyish(json)) addLast('(item list)', 'json', 'money');
  if (last.length) throw new CatalogueGuardError(last);
  // Self-check: it must parse, carry exactly the page's products in page order, and hold no key beyond the five it is built from.
  const parsed = JSON.parse(json);
  if (parsed.itemListElement.length !== report.total || parsed.numberOfItems !== report.total) throw new Error('item list lost a product');
  for (const li of parsed.itemListElement) if (Object.keys(li).join() !== '@type,position,name,url') throw new Error('item list carries an unexpected key');
  return json;
}

/** Put the ItemList between the LD:ITEMLIST markers of the <head>. Both markers must be in the shell exactly once. Idempotent. */
function injectItemList(html, json, label) {
  label = label || 'catalogue/index.html';
  const count = (needle) => html.split(needle).length - 1;
  const nStart = count(LD_START_MARKER), nEnd = count(LD_END_MARKER);
  if (nStart !== 1 || nEnd !== 1) throw new Error(`${label} must contain the LD:ITEMLIST:START and LD:ITEMLIST:END markers exactly once each (found ${nStart} / ${nEnd})`);
  const a = html.indexOf(LD_START_MARKER) + LD_START_MARKER.length;
  const b = html.indexOf(LD_END_MARKER);
  if (b < a) throw new Error(`LD:ITEMLIST:END appears before LD:ITEMLIST:START in ${label}`);
  const script = `<script type="application/ld+json">${json}</script>`;
  return html.slice(0, a) + '\n' + script + '\n' + html.slice(b);
}

// Replace everything between the two markers; the rest of the file is preserved
// byte-for-byte. Both markers must appear exactly once.
function injectIntoHtml(html, block, label) {
  label = label || 'catalogue/index.html';
  const count = (needle) => html.split(needle).length - 1;
  if (count(START_MARKER) !== 1) throw new Error(`${label} must contain the CATALOGUE:START marker exactly once (found ${count(START_MARKER)})`);
  if (count(END_MARKER) !== 1) throw new Error(`${label} must contain the CATALOGUE:END marker exactly once (found ${count(END_MARKER)})`);
  if (block.includes(START_MARKER) || block.includes(END_MARKER)) throw new Error('generated block must not contain the marker comments');
  const a = html.indexOf(START_MARKER) + START_MARKER.length;
  const b = html.indexOf(END_MARKER);
  if (b < a) throw new Error(`CATALOGUE:END appears before CATALOGUE:START in ${label}`);
  return html.slice(0, a) + '\n' + block + '\n' + html.slice(b);
}

function resolveInput(arg) {
  if (arg) {
    const p = path.resolve(arg);
    if (!fs.existsSync(p)) throw new Error(`input file not found: ${p}`);
    return p;
  }
  const tried = [
    path.resolve(process.cwd(), 'products-database.json'),
    path.join(REPO_ROOT, 'products-database.json'),
    path.join(os.homedir(), 'Desktop', 'barro-private', 'products-database.json'),
  ].filter((p, i, a) => a.indexOf(p) === i);
  for (const p of tried) if (fs.existsSync(p)) return p;
  throw new Error('products-database.json not found. Tried:\n  ' + tried.join('\n  '));
}

function main(argv) {
  const input = resolveInput(argv[2]);
  const raw = fs.readFileSync(input, 'utf8').replace(/^﻿/, '');
  const db = JSON.parse(stripJsonComments(raw));

  const ids = Array.isArray(db.products) ? db.products.map(p => str(p && p.id)).filter(Boolean) : [];
  const pub = loadPublicCategories({ ids });              // throws on a bad category map
  const published = publishedProductIds(db, pub);
  const fams = loadPublicFamilies({ published, master: db });   // throws unless every published SKU is absorbed or fixed, exactly once
  const photoMap = loadPhotoMap({ ids, skipIds: ids.filter(id => !published.has(id)) });   // throws on a bad photo map; {} when the file is absent
  const previewMap = loadPreviewManifest({ families: fams });                              // throws on a bad preview manifest; {} when none yet

  const report = {};
  const block = renderCatalogue(db, { report, photos: photoMap.photos, publicCategories: pub, families: fams });   // throws before anything is written

  const island = renderCatalogueData(db, { photos: photoMap.photos, publicCategories: pub, families: fams, previews: previewMap.previews });   // same guards, same product set
  const itemList = renderItemListLd(db, { photos: photoMap.photos, publicCategories: pub, families: fams });                                  // the <head> JSON-LD: names + category anchors only
  const quotable = new Set([...published].filter(id => !fams.absorbedIds.has(id)));   // the FIXED items: plain lines on the server
  const idsJson = renderPublishedIds(quotable);
  const familiesJs = renderFamiliesJs(fams);

  const html = fs.readFileSync(CATALOGUE_HTML, 'utf8');
  const next = injectItemList(injectIsland(injectIntoHtml(html, block), island), itemList);
  const changed = next !== html;
  if (changed) fs.writeFileSync(CATALOGUE_HTML, next);
  const prevIds = fs.existsSync(PUBLISHED_IDS_FILE) ? fs.readFileSync(PUBLISHED_IDS_FILE, 'utf8') : '';
  const idsChanged = prevIds !== idsJson;
  if (idsChanged) fs.writeFileSync(PUBLISHED_IDS_FILE, idsJson);
  const famWrite = (file) => {
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (prev !== familiesJs) fs.writeFileSync(file, familiesJs);
    return prev !== familiesJs;
  };
  const famChanged = famWrite(FAMILIES_JS) | famWrite(FAMILIES_JS_MIRROR);

  console.log(`build-catalogue: ${path.relative(process.cwd(), input) || input}`);
  for (const c of report.categories) console.log(`  ${c.label.padEnd(24)} ${String(c.count).padStart(3)}`);
  console.log(`  ${'TOTAL'.padEnd(24)} ${String(report.total).padStart(3)}   (${report.categories.length} categories: ${report.families.length} configurable famil${report.families.length === 1 ? 'y' : 'ies'} + ${report.published.length} fixed items; ${report.absorbed.length} published SKUs absorbed into the families and no longer cards of their own)`);
  const exCats = Object.entries(report.skipped.categories).map(([c, n]) => `${c} ${n}`).join(', ');
  console.log(`  not published: ${report.skipped.categoryProducts} product(s) in excluded categor${Object.keys(report.skipped.categories).length === 1 ? 'y' : 'ies'} (${exCats || 'none'}) + ${report.skipped.products.length} listed under excludedProducts in scripts/public-categories.json`);
  if (report.overrides.length) {
    console.log(`  note overrides applied (${report.overrides.length}) — owner to confirm wording:`);
    for (const o of report.overrides) console.log(`    ${o.id} -> ${JSON.stringify(o.replacement)}`);
  }
  if (report.skippedOverrides.length) console.log(`  ${report.skippedOverrides.length} NOTE_OVERRIDES entr${report.skippedOverrides.length === 1 ? 'y' : 'ies'} skipped (product not published): ${report.skippedOverrides.join(', ')}`);
  if (report.unusedOverrides.length) {
    console.log(`  WARN: ${report.unusedOverrides.length} NOTE_OVERRIDES entr${report.unusedOverrides.length === 1 ? 'y' : 'ies'} not applied (master note is clean or product absent): ${report.unusedOverrides.join(', ')}`);
  }
  if (report.textFixes.length) {
    console.log(`  text fixes applied (${report.textFixes.length}):`);
    for (const f of report.textFixes) console.log(`    ${f.id}.${f.field}: ${JSON.stringify(f.before)} -> ${JSON.stringify(f.after)}`);
  }
  if (report.unusedTextFixes.length) {
    console.log(`  WARN: ${report.unusedTextFixes.length} TEXT_FIXES entr${report.unusedTextFixes.length === 1 ? 'y' : 'ies'} not applied (the master text has changed or the product is gone): ${report.unusedTextFixes.join(', ')}`);
  }
  if (report.skippedTextFixes.length) console.log(`  ${report.skippedTextFixes.length} TEXT_FIXES entr${report.skippedTextFixes.length === 1 ? 'y' : 'ies'} skipped (product not published)`);
  if (report.droppedMaterialKeys.length) {
    console.log(`  WARN: material key(s) not on the allowlist were dropped: ${report.droppedMaterialKeys.join(', ')}`);
  }
  console.log(`  product photos: ${report.photos} card(s) mapped to ${photoMap.files} image(s)${photoMap.skipped ? `; ${photoMap.skipped} mapping entr${photoMap.skipped === 1 ? 'y' : 'ies'} skipped (product not published)` : ''}${fs.existsSync(PHOTO_MAP_FILE) ? '' : ' (scripts/product-photos.json absent — every card keeps its placeholder tile)'}`);
  console.log(`  catalogue/index.html: ${changed ? 'catalogue block / data island / item list updated' : 'already up to date'} (${Buffer.byteLength(block)} bytes of markup, ${Buffer.byteLength(island)} bytes of "Add to quote" data, ${report.total} products in the JSON-LD item list)`);
  console.log(`  functions/qr-published.json: ${idsChanged ? 'updated' : 'already up to date'} (${quotable.size} fixed product ids — the plain lines the quote-request callables accept)`);
  console.log(`  js/qr-families.js + functions/qr-families.js: ${famChanged ? 'updated' : 'already up to date'} (${fams.order.length} families, ${fams.absorbedIds.size} absorbed SKUs)`);
  console.log(`  configurator previews: ${previewMap.count} photo(s) in scripts/configurator-previews.json${fs.existsSync(PREVIEWS_FILE) ? '' : ' (file absent — every sheet shows its generated placeholder)'}`);
}

module.exports = {
  publicProduct, renderCatalogue, renderCatalogueData, renderPublishedIds, renderItemListLd, injectIntoHtml, injectIsland, injectItemList, stripJsonComments, esc, webpSize, loadPhotoMap,
  loadPublicCategories, publishedProductIds, PUBLIC_CATEGORIES, EXCLUDED_CATEGORIES,
  loadPublicFamilies, renderFamiliesJs, loadPreviewManifest, renderFamilyCard, FAMILIES_FILE, FAMILIES_JS, FAMILIES_JS_MIRROR, PREVIEWS_FILE,
  TILE_ICONS, FAMILY_MATERIAL, FAMILY_PAGES, LABEL_NOTES, LABEL_SPECS,
  NOTE_OVERRIDES, TEXT_FIXES, MATERIAL_KEYS, MONEY_RE, FORMULA_RE, BRAND_RE, START_MARKER, END_MARKER,
  QR_PLACEHOLDER, QR_START_MARKER, QR_END_MARKER, LD_START_MARKER, LD_END_MARKER, SITE_BRAND_NAME, PUBLISHED_IDS_FILE,
  CatalogueGuardError,
};

if (require.main === module) {
  try {
    main(process.argv);
  } catch (e) {
    console.error('build-catalogue: ' + (e && e.message ? e.message : e));
    process.exit(1);
  }
}
