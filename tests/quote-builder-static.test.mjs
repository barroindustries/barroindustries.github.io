// tests/quote-builder-static.test.mjs — quote-builder-v2.html, the CONFIGURATOR (specs/QUOTE-BUILDER-CONFIGURATOR-SPEC.md §9, work chunk WS-2).
//
// quote-builder-v2.html is one 9,000-line HTML file with one inline <script> and no module system, so it cannot be require()d. Two layers:
//
//   1. STATIC — the markup and the constants: the three new script tags and their order, the tutorial (TUTORIAL_VERSION 46, the What's New
//      entries 46, 45, 44 and 43, the guided-demo step and every selector it targets), ESTIMATE_RANGE_MODE, the A5 letterhead strings, CO.BS
//      byte-for-byte, and the two rules of the price-protection design that are about WHAT THE FILE MAY NAME: it never names the pricing
//      function (it prices only through QBConfigured) and it reads the option sheets (the product_pricing collection) in exactly one place —
//      inside loadDatabase(), in its own try/catch (spec §2.3).
//   2. BEHAVIOUR — the real inline script is executed inside a node:vm context against a small DOM stub, with the real
//      js/product-families.js, js/qr-families.js, js/pricing-core.js and js/qb-configured.js, and SYNTHETIC odd-figure catalogue data
//      (the repository is PUBLIC: the real price master and option sheets are private). The money paths are exercised for real:
//        R1  the cost-plus auto-pricer leaves 'website' / 'manual' lines alone and reprices 'cost' / unlabelled ones (applyComputedPricing)
//        R3  re-configuring a line: website recomputes, cost leaves the figure to the auto-pricer, manual keeps the staff price
//        R4  Use cost-based / Use website / Apply cost-based to all / typed price / ↺ re-apply / pass-through
//        R5  a line flagged "needs a price" blocks canFile() AND fileQuotation()
//        §3.2 `_cfg` is stripped from the payload, the draft in localStorage and templates; sourceRef / estimateCheck are filed
//        §4.5 itemCostBasis() hands a configured line to QBConfigured.costBasisFor (not to its primary SKU's cost)
//        §2.3/§2.5 loadDatabase(): the sheets are read, a denied read degrades, the kill switch works; the retired partner portal is gone
//             (PARTNER-REMOVAL-SPEC WS-E: nothing names it, and a leftover ?portal=partner boots as a plain staff session)
//        §4.2 the panel is generated from the definitions: every group type, option and size axis of every family — and of a family that
//             does not exist yet — renders with no code change
//        §4.9 the guided demo opens the panel read-only, adds nothing, closes it again
//
// Mutation-tested in scratch copies (never the shared tree) — each of these must fail here: the auto-pricer predicate reduced to the old
// `priceManual` test; the R5 gate dropped from canFile() / from fileQuotation() / its `unitPrice > 0` clause dropped; `_cfg` left in the
// strip list or the localStorage draft; the cost-basis hook removed from itemCostBasis(); R3 overwriting a manual or cost price / failing to
// reprice a website line; the typed price not recorded as `manual`; ↺ re-apply not returning a line to `cost`; sourceRef kept by a template;
// the sheet read moved outside loadDatabase() / out of its own try; the kill switch ignored; a hand-off ignoring qnoLoc / qnoMethod; the
// tour adding a line or leaving the panel open; the version not bumped; PARTNER_MODE / GENERIC_PARTNER / applyPartnerMode / CO.PT (or a
// pcoName / portal read) coming back; a boot that removes anything from its own DOM; a ?portal=partner URL changing the company, the
// configurator or the option-sheet read.
//
// WS-5C (owner ruling 2026-10-28 — the staff-only 1.2 mm top plate, spec §14.6) adds, at the end of the file: the "staff" chip, the 1.2 mm choice and its price from a
// real cell only, the Construction row that is printed, a line saved before the top plate existed, the hidden ⇄ PT chip on configured lines, and the builder
// SECTION of a configured line (base product's own; fallbacks; the hand-off's public category re-homed). Mutation-tested in scratch copies — each of these must fail
// here: validateLine / validateConfiguration called without { staff:true } (or with staff:false), no chip / a chip on every group / a chip without no-print or title,
// the section fallback of cfgMakeLine / cfgConvertLine removed or the catalogue not handed to the migration, the hand-off re-homing moving any section / never moving /
// ignoring a database section of the same name / not run on load / not run when the database arrives, the PT chip shown on configured lines again / hidden on every
// line / hidden on a configured line that carries the flag, the tutorial bullet / Help sentence / tour sentence missing from entry 43, a re-configure that
// does not rewrite the printed specs, priceLine no longer reading an absent group as its default.
//
// PARTNER-REMOVAL-SPEC WS-G (2026-10-28) adds "the starting company (?co=)": the Brilliant Steel department's Quote Builder page opens the builder with ?co=BS and
// the boot calls bootCompany() (BK / BI / BS only, else BK). Mutation-tested in a scratch copy — each of these must fail here: the boot back on a literal 'BK';
// bootCompany without its allowlist (any code passes through) / case-sensitive; a loaded quote (loadEditableState), a resumed draft (resumeDraft) or a #quote= link
// (loadFromStorage) no longer setting its own company, so the hint wins over it. (tests/quote-link.test.mjs pins the host side: ?co=BS only on bs-quote-builder, ahead of
// ?reopen=1.) Run with: node --test tests/*.test.mjs
//
// CONFIGURATOR-FAMILIES-2-SPEC WS-4 (2026-10-28) — five more families (dish table, wok range, griddle / griller / fryer, gas deck oven, range hood) in the builder. The synthetic
// catalogue below gained their five primaries (PW-029 and CE-012 FIXED, the three others per_length with no height rate) and CE-030 stands in as "the fixed SKU no family absorbed"
// (CE-016 is the deck oven's 12-tray model now). At the end of the file: conditional groups in the panel (only the groups that apply are drawn, ids stay the definition's indexes,
// a choice that stops applying snaps to its default BEFORE validation and never shows as an error, a chain of them in a twelfth family), a size an option caps (input max, the
// "maximum" / "fixed at" hint, Use N mm, routed under the box), the five families through chips / price / Add / ⚙ configure / "Priced after review" / convert / configure instead /
// sold online as, the per-product kill switch (productMeta/config.families.disabled), TUTORIAL_VERSION 45 with Help and the demo. Mutation-tested in scratch copies (43 mutants, each
// killed): every group drawn / only the non-applying ones / group ids renumbered among the showing groups; the snap never written back / left out of cfgEvaluate / left out after
// an option change / validating in public mode; the size input without its max / ignoring the forced max / the hint without "maximum" or "fixed at" / no Use N mm under a capped
// size / that button carrying the minimum / cfgSplitErrors losing "must be at most" or "must be at least" / forcedMaxes never read; families.disabled never read / not reset by a
// reload / not filtered to strings / taken from a non-list / a bare string taken as a list / the enabled test inverted; a listed product keeping its chip / an empty Configure row
// staying on screen / its "sold online as" / its "configure instead" / its "convert to configured" row and the conversion / its ⚙ configure button and the "configurator off" chip /
// the ⚙ configure action / the panel itself; the demo trying the sink when it is listed / showing its step with every product listed; the version not bumped / the entry carrying
// 44 / its second bullet removed; Help listing the old six / the old three-product top-plate sentence / no sentence on conditional options; the demo's Add-items step naming six /
// its configurator step naming three top plates / saying nothing on conditional options.
//
// CONFIGURATOR-GRADE-TITLES-SPEC (2026-10-28) — the staff-only steel grade and the line titles in the builder (section "GRADE-TITLES" at the end of the file; the panel tests above address
// groups by KEY, never by position, because the grade is now the FIRST group of every family): TUTORIAL_VERSION 46 with its entry, Help and demo sentences; the Material group drawn
// first, with its "staff" chip and two pills; a 316 line (preview "SS316", "Priced after review" until the sheet's grade cell is filled, then dearer by exactly that cell); a line named by
// its TITLE ("SS Sink", "SS Range Stove Combination (Griller, Fryer)"); ⚙ configure refreshing the name (cfgApplyEdit copies `name`).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILDER_PATH = path.join(ROOT, 'quote-builder-v2.html');
const HTML = fs.readFileSync(BUILDER_PATH, 'utf8');
const SCRIPT = (HTML.match(/<script>\n([\s\S]*?)<\/script>/) || [])[1];
assert.ok(SCRIPT && SCRIPT.length > 100000, 'could not find the builder\'s inline <script>');

const PF = require('../js/product-families.js');
const FAM = require('../js/qr-families.js');
const PC = require('../js/pricing-core.js');
const QB = require('../js/qb-configured.js');
// a group's index in the definition: the panel's ids and handlers use it (the staff-only grade is group 0 of every family, so nothing may assume 0 is the first public group)
const gAt = (id, key) => FAM.families[id].groups.findIndex((g) => g.key === key);

// ═══════════════════════════════════════ the harness: the real builder script in a vm context ═══════════════════════════════════════
const COMPILED = new vm.Script(SCRIPT, { filename: 'quote-builder-v2.html<script>' });   // parsed once; every environment below only RUNS it
function makeEnv({ search = '', protocol = 'http:', script = SCRIPT, db = undefined } = {}) {
  const els = new Map();
  const removed = new Set();
  const posted = [];
  const listeners = { window: {}, document: {} };
  const store = new Map();
  const classList = () => {
    const s = new Set();
    return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); return on; }, contains: (c) => s.has(c) };
  };
  const mkEl = (id) => ({
    id, value: '', checked: false, innerHTML: '', textContent: '', innerText: '', disabled: false, hidden: false, type: '', title: '', min: '', max: '',
    style: {}, dataset: {}, className: '', options: [], children: [], parentElement: null, offsetParent: {}, scrollTop: 0,
    classList: classList(),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, appendChild(c) { return c; }, insertBefore(c) { return c; }, insertAdjacentElement() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, remove() { removed.add(id); }, focus() {}, blur() {}, click() {},
    scrollIntoView() {}, closest() { return null; }, contains() { return false; }, querySelector() { return null; }, querySelectorAll() { return []; },
    cloneNode() { return mkEl(id + '-clone'); }, getBoundingClientRect() { return { width: 100, height: 20, left: 0, top: 0, right: 100, bottom: 20 }; },
    getClientRects() { return [{}]; },
  });
  const el = (id) => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); };
  const body = mkEl('body');
  const document = {
    getElementById: el, body, head: mkEl('head'), documentElement: mkEl('html'), activeElement: body,
    createElement: (tag) => mkEl('new-' + tag), createDocumentFragment: () => mkEl('frag'),
    addEventListener: (t, fn) => { (listeners.document[t] = listeners.document[t] || []).push(fn); },
    removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], contains: () => true,
  };
  const win = {
    document, location: { search, protocol, hash: '', origin: 'http://localhost' }, navigator: { maxTouchPoints: 0, userAgent: 'node' },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
    // the builder's debounce / autosave timers (200 ms … 5 s) must not hold the test process open
    console, URLSearchParams, setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; }, clearTimeout,
    requestAnimationFrame: (f) => { const t = setTimeout(f, 0); if (t && t.unref) t.unref(); return t; },
    matchMedia: () => ({ matches: false }), confirm: () => true, prompt: () => null, alert() {},
    addEventListener: (t, fn) => { (listeners.window[t] = listeners.window[t] || []).push(fn); }, removeEventListener() {},
    print() {}, parent: null, Event: class { constructor(type) { this.type = type; } },     // (a quote below its floor price ticks #reqApprovalCheck and fires 'change')
  };
  win.window = win; win.self = win; win.parent = { postMessage: (msg, origin) => posted.push({ msg, origin }) };
  win.ProductFamilies = PF; win.QR_FAMILIES = FAM; win.PricingCore = PC; win.QBConfigured = QB;
  Object.assign(win, { priceCatalogItem: PC.priceCatalogItem, validateSelection: PC.validateSelection, estimateRange: PC.estimateRange, estimateGate: PC.estimateGate });
  if (db) win.db = db;
  const ctx = vm.createContext(win);
  (script === SCRIPT ? COMPILED : new vm.Script(script, { filename: 'quote-builder-v2.html<script>' })).runInContext(ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { ctx, run, el, removed, posted, listeners, store,
    toast: () => el('qbToast').textContent,
    // plain-data copy out of the vm realm (so deepEqual compares prototypes of THIS realm)
    plain: (code) => JSON.parse(JSON.stringify(vm.runInContext(code, ctx) ?? null)) };
}

// ═══════════════════════════════════════ synthetic catalogue (odd-figure pesos; the repo is PUBLIC) ═══════════════════════════════════════
const prod = (id, category, formulaType, basePrice, defaultDimensions, formula, extra = {}) =>
  ({ id, category, name: id, formulaType, basePrice, defaultDimensions, formula, specs: [], unit: 'pc', capitalMaterials: 0, capitalLabor: 0, ...extra });
const PRIMARIES = [
  prod('PW-001', 'prep_washing', 'per_length', 4217, { W: 900, D: 600, H: 850 }, { baseLengthMm: 900, pricePerExtraMm: 3.3, rateD100: 31, rateH100: 17 }),
  prod('PW-004', 'prep_washing', 'per_length', 6173, { W: 500, D: 500, H: 850 }, { baseLengthMm: 500, pricePerExtraMm: 4.1, rateD100: 29, rateH100: 13 }),
  prod('CE-001', 'cooking_line', 'per_length', 7770, { W: 600, D: 700, H: 850 }, { baseLengthMm: 600, pricePerExtraMm: 5.7, rateD100: 41, rateH100: 0 }),
  prod('PW-015', 'prep_washing', 'per_length', 5119, { W: 600, D: 500, H: 1800 }, { baseLengthMm: 600, pricePerExtraMm: 2.9, rateD100: 23 }),
  prod('PW-023', 'prep_washing', 'fixed', 1893, { W: 1200, D: 450 }, {}),
  prod('PW-010', 'prep_washing', 'per_length', 3307, { W: 600, D: 500, H: 1600 }, { baseLengthMm: 600, pricePerExtraMm: 2.3, rateD100: 19, rateH100: 11 }),
  // the five families of 2026-10-28 (CONFIGURATOR-FAMILIES-2-SPEC): synthetic odd figures again. None of them has a height rate — a height is not a size of these families —
  // and the two LINEAR ones (dish table, deck oven) have a FIXED primary: their length is priced from the option sheet, not by the base item.
  prod('PW-029', 'prep_washing', 'fixed', 2719, { W: 1200, D: 660, H: 851 }, {}),
  prod('CE-006', 'cooking_line', 'per_length', 5233, { W: 600, D: 700, H: 850 }, { baseLengthMm: 600, pricePerExtraMm: 4.7, rateD100: 37, rateH100: 0 }),
  prod('CE-010', 'cooking_line', 'per_length', 4349, { W: 700, D: 700, H: 850 }, { baseLengthMm: 700, pricePerExtraMm: 3.9, rateD100: 33, rateH100: 0 }),
  prod('CE-012', 'cooking_line', 'fixed', 9871, { W: 700, D: 700, H: 1400 }, {}),
  prod('EX-001', 'exhaust_system', 'per_length', 3571, { W: 1000, D: 900, H: 500 }, { baseLengthMm: 1000, pricePerExtraMm: 2.1, rateD100: 27, rateH100: 0 }),
];
// every SKU a family absorbed is in the synthetic catalogue too (a configured line is costed from the NEAREST of them), each with a synthetic
// odd-figure cost — except the rack family's, which has none anywhere (the "no cost basis" case). The primaries carry costs as well.
const CATALOGUE = (() => {
  const out = new Map(PRIMARIES.map((p) => [p.id, p]));
  let n = 0;
  for (const id of FAM.order) {
    const f = FAM.families[id];
    const primary = out.get(f.primary);
    for (const sku of Object.keys(f.absorbed)) {
      n++;
      const costs = id === 'rack' ? {} : { capitalMaterials: 2000 + 53 * n, capitalLabor: 500 + 17 * n };
      if (!out.has(sku)) out.set(sku, prod(sku, primary.category, primary.formulaType, 5000 + 37 * n, primary.defaultDimensions, primary.formula, costs));
      else Object.assign(out.get(sku), costs);
    }
  }
  out.set('CE-030', prod('CE-030', 'cooking_line', 'fixed', 21911, {}, {}));      // the salamander oven: a fixed item no family absorbed (CE-016 is the deck oven's 12-tray model now)
  return [...out.values()];
})();
const GRADE_FLAT = 2917;       // the synthetic SS316 premium of every approved fixture sheet (an odd figure; the real amounts are private)
function sheetFor(familyId, { approved = true } = {}) {
  const f = FAM.families[familyId];
  const options = {};
  let i = 0;
  for (const c of PF.cells(f)) {
    // the staff-only steel grade: its SS316 cell has a synthetic figure of its own and does not count in `i`, so every other cell keeps the figure it had before the grade existed
    if (c.group === 'grade') { if (!c.baseline) (options.grade = options.grade || {})[c.value] = { flat: GRADE_FLAT, perW100: null }; continue; }
    i++;
    if (c.baseline) continue;
    (options[c.group] = options[c.group] || {})[c.value] = { flat: (i % 7 === 3 ? -1 : 1) * (311 + 97 * i), perW100: (i % 4 === 1 && familyId !== 'deck_oven') ? 13 + i : null };
  }
  // the length rate of a LINEAR family: wall shelving and the dish table have a rate; the deck oven's width follows its trays, so its rate is 0 ("Enter 0")
  return { familyId, schemaVersion: FAM.version, approved, approvedBy: 'u_syn', options, size: { perW100: familyId === 'wall_shelf' ? 77 : (familyId === 'dish_table' ? 61 : (familyId === 'deck_oven' ? 0 : null)) } };
}
const SHEETS = Object.fromEntries(FAM.order.map((id) => [id, sheetFor(id)]));

// a builder with the synthetic catalogue loaded and no DOM boot (the test sets the state it needs)
function builder(opts = {}) {
  const b = makeEnv(opts);
  b.run(`DB = { products: ${JSON.stringify(CATALOGUE)}, categories: [{id:'prep_washing',label:'Preparation & Washing'},{id:'cooking_line',label:'Cooking Line'},{id:'exhaust_system',label:'Exhaust'}], laborRoles: [], constants: {} };`);
  b.run(`FAMILY_PRICING = ${JSON.stringify(SHEETS)}; FAMILY_PRICING_STATE = 'live';`);
  return b;
}
// the builder's own configurator core, driven without a DOM: a panel state -> the line it would add
const stateFor = (familyId, over = {}) => {
  const f = FAM.families[familyId];
  const size = {};
  Object.entries(PF.standardDims(f, over.config || PF.defaultConfig(f))).forEach(([k, v]) => { size[k] = String(v); });
  return { familyId, config: PF.defaultConfig(f), sizeRaw: size, touched: {}, qty: 1, unit: f.unit, note: '', price: '', editItem: null, tour: false, ...over };
};
const sinkState = (over = {}) => stateFor('sink', { config: { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'prerinse' }, sizeRaw: { W: '1800', D: '700', H: '900' }, qty: 2, ...over });
function makeLine(b, st) {
  b.run(`globalThis.__st = ${JSON.stringify(st)}; globalThis.__ev = cfgEvaluate(__st); globalThis.__line = cfgMakeLine(__ev, __st);`);
  return { ev: b.run('__ev'), line: b.run('__line') };
}

// a fake Firestore for loadDatabase(): the synthetic catalogue, the synthetic option sheets (or a denied read), and whatever productMeta/config holds
const fakeDb = ({ sheets = 'ok', meta = {} } = {}) => {
  const reads = [];
  const snap = (docs) => ({ empty: docs.length === 0, docs: docs.map((d) => ({ id: d.id, data: () => d.data })) });
  const coll = (name) => ({
    get: async () => {
      reads.push(name);
      if (name === 'product_pricing') { if (sheets === 'denied') throw new Error('Missing or insufficient permissions.'); return snap(Object.entries(SHEETS).map(([id, data]) => ({ id, data }))); }
      if (name === 'products') return snap(CATALOGUE.map((p) => ({ id: p.id, data: { category: p.category, title: p.name, formulaType: p.formulaType, basePrice: p.basePrice, measurement: p.defaultDimensions, formula: p.formula, unit: 'pc' } })));
      return snap([]);
    },
    limit() { return this; },
    doc: (id) => ({ get: async () => { reads.push(name + '/' + id); return { exists: name === 'productMeta', data: () => meta }; } }),
  });
  return { reads, db: { collection: coll } };
};
const bootDb = async (opts, fake) => {
  const b = makeEnv({ ...opts, db: fake.db });
  await b.run('loadDatabase()');
  return b;
};

// ═══════════════════════════════════════ 1. STATIC — markup, constants, what the file may name ═══════════════════════════════════════
describe('static — the script tags, the tutorial, the letterhead', () => {
  it('the three configurator scripts load, deferred, in order, right after pricing-core.js (qb-configured is handed the others at run time)', () => {
    const tags = [...HTML.matchAll(/<script defer src="(js\/[a-z-]+\.js)"><\/script>/g)].map((m) => m[1]);
    const at = tags.indexOf('js/pricing-core.js');
    assert.ok(at >= 0);
    assert.deepEqual(tags.slice(at, at + 4), ['js/pricing-core.js', 'js/qr-families.js', 'js/product-families.js', 'js/qb-configured.js']);
    assert.equal((HTML.match(/js\/qb-configured\.js/g) || []).length >= 1, true);
  });

  it('TUTORIAL_VERSION is 46: the newest What\'s New entry is version 46 (the line titles and the staff-only Material row), dated; entries 45 (five more configurable products), 44 (the partner portal is retired) and 43 stay as history', () => {
    const b = makeEnv();
    assert.equal(b.run('TUTORIAL_VERSION'), 46);
    const wn = b.plain('WHATS_NEW');
    assert.equal(wn[0].ver, 46);
    assert.equal(wn[1].ver, 45, '45 stays as history: the titles and the Material row are a new entry');
    assert.equal(wn[2].ver, 44, '44 stays as history');
    assert.equal(wn[3].ver, 43, '43 had shipped (origin/master d491b5d): it stays as history');
    assert.match(wn[0].date, /^2026-10-\d\d$/);
    assert.deepEqual(wn.map((e) => e.ver), [...wn.map((e) => e.ver)].sort((x, y) => y - x), 'newest first');
    const t46 = wn[0].items.join(' ');
    for (const must of ['Configured lines now carry a proper name on the quote', '"SS Range Stove"', '"SS Range Stove Combination (Griller, Fryer)"', '"SS Griddle"', '"SS Lava-Rock Griller"', '"Gas Deck Oven"',
      'the name updates when you re-configure the line', 'Every configured product starts with a Material row', 'Stainless Steel 304 Food Grade as standard', 'Stainless Steel 316 Laboratory Grade',
      'a staff-only choice (the website never offers it)', 'shows "Priced after review" until Finance enters the 316 amount for that product in Inventory › Family pricing']) {
      assert.ok(t46.includes(must), `What's New 46 does not say: ${must}`);
    }
    assert.equal(wn[0].items.length, 2, 'two bullets: the line names, and the Material row');
    const t45 = wn[1].items.join(' ');
    for (const must of ['Five more products can be configured right in the builder', 'dish tables, wok ranges, griddles / grillers / fryers, gas deck ovens and range hoods', 'an option Finance has not priced yet asks you for a price instead of guessing',
      '"⚙ convert to configured"', 'Some choices only show when they apply', 'fry baskets for a fryer', 'pre-rinse sink on the soiled side of a dish table', 'a size an option does not allow is flagged as you type', '"Use N mm"',
      'a slim hood is at most 500 mm deep', 'a deck oven\'s width follows its trays per deck']) {
      assert.ok(t45.includes(must), `What's New 45 does not say: ${must}`);
    }
    assert.equal(wn[1].items.length, 2, 'two bullets: the products, and the conditional options with their size limits');
    const t44 = wn[2].items.join(' ');
    for (const must of ['partner portal is retired', 'Brilliant Steel pill', 'pass-through tick', 'Nothing changes for Barro Kitchens or Barro Industries quotes']) {
      assert.ok(t44.includes(must), `What's New 44 does not say: ${must}`);
    }
    const text = wn[3].items.join(' ');
    for (const must of ['Configure a sink, prep table, stove, cabinet, wall shelf or rack', 'Priced after review', 'Apply cost-based to all', 'estimate range', 'links it back', 'hello@barroindustries.com']) {
      assert.ok(text.includes(must), `What's New 43 does not say: ${must}`);
    }
    assert.equal(new Set(wn.map((e) => e.ver)).size, wn.length, 'no duplicate version');
  });

  it('the Help text and the demo no longer talk about partners: no "Estimator may be hidden depending on your account", no "Partners never see this button" — and the Brilliant Steel pill is explained', () => {
    const helpBody = (HTML.match(/<div class="modal-body" id="helpBody">[\s\S]*?<h4>What's new<\/h4>/) || [''])[0];
    assert.ok(helpBody.length > 3000, 'could not find the Help body');
    assert.equal(/partner/i.test(helpBody), false, 'the Help body still mentions partners');
    assert.equal(/may be hidden depending on your account/.test(helpBody), false);
    const steps = makeEnv().plain('TOUR_STEPS');
    assert.equal(steps.some((s) => /partner/i.test(s.title + ' ' + s.body)), false, 'a guided-demo step still mentions partners');
    assert.match(helpBody, /<strong>Pick the company<\/strong>[\s\S]*?Brilliant Steel quote hides the cost calculator and BOM; each line gets a <em>pass-through<\/em> tick/);
    assert.match(steps.find((s) => s.target === '#coBK').body, /On Brilliant Steel the cost calculator stays out of the way and each line gets a pass-through tick/);
  });

  it('the guided demo has a "Configure a product" step on #configPanel, inside the workspace, that needs the configurator, right after "Add items"', () => {
    const steps = makeEnv().plain('TOUR_STEPS');
    const i = steps.findIndex((s) => s.target === '#configPanel');
    assert.ok(i > 0, 'no TOUR_STEPS entry targets #configPanel');
    assert.equal(steps[i].needsWorkspace, true);
    assert.equal(steps[i].needsConfigurator, true);
    assert.equal(steps[i - 1].target, '#addItemsSection');
    assert.match(steps[i].title, /Configure a product/);
    assert.ok(HTML.includes('id="configPanel"'));
  });

  it('every guided-demo selector still resolves to markup (renamed ids are how the tour rots)', () => {
    const steps = makeEnv().plain('TOUR_STEPS');
    for (const s of steps.filter((x) => x.target)) {
      const idm = /^#([A-Za-z][\w-]*)$/.exec(s.target);
      const cm = /^\.([A-Za-z][\w-]*)$/.exec(s.target);
      if (idm) assert.ok(new RegExp(`id="${idm[1]}"`).test(HTML), `${s.target} (${s.title}) has no id="${idm[1]}"`);
      else if (cm) assert.ok(new RegExp(`class="[^"]*\\b${cm[1]}\\b`).test(HTML), `${s.target} (${s.title}) has no class ${cm[1]}`);
      else assert.fail(`unrecognised selector ${s.target}`);
      if (s.closest) assert.ok(new RegExp(`class="[^"]*\\b${s.closest.replace(/^\./, '')}\\b`).test(HTML), `closest ${s.closest} of ${s.title}`);
    }
  });

  it('the Help text and the demo copy mention the configurator (the tutorial contract)', () => {
    assert.match(HTML, /<li><strong>Configure a product<\/strong>/);
    assert.match(HTML, /Apply cost-based to all/);
    const steps = makeEnv().plain('TOUR_STEPS');
    assert.ok(steps.some((s) => /configure/i.test(s.body) && s.target === '#addItemsSection'));
  });

  it('the staff-only top plate is in the tutorial (spec §14.6): it is the last bullet of What\'s New entry 43 (the entry it was appended to before 43 shipped), Help "Configure a product" and the demo step say it', () => {
    const b = makeEnv();
    const items = b.plain('WHATS_NEW').find((e) => e.ver === 43).items;
    assert.equal(items.at(-1), 'Tables, sinks and stoves now quote with a 1.5 mm (16 ga) top as standard and print their construction on the quote; staff can still pick a lighter 1.2 mm top, priced once Finance enters its amount.');
    assert.equal(items.filter((t) => /1\.5 mm \(16 ga\)/.test(t)).length, 1, 'said once');
    const help = (HTML.match(/<li><strong>Configure a product<\/strong>[\s\S]*?<\/li>/) || [''])[0];
    assert.match(help, /1\.5 mm \(16 ga\) top as standard/);
    assert.match(help, /<em>Top plate<\/em> option \(marked <em>staff<\/em> — it is never offered on the website\)/);
    assert.match(help, /lighter 1\.2 mm top, which reads <em>Priced after review<\/em> until Finance has entered its amount/);
    const step = b.plain('TOUR_STEPS').find((s) => s.target === '#configPanel');
    assert.match(step.body, /staff-only Top plate option/);
    assert.match(step.body, /1\.5 mm top to a lighter 1\.2 mm/);
  });

  it('ESTIMATE_RANGE_MODE is one constant beside TUTORIAL_VERSION and defaults to "warn" (owner default 2026-10-28)', () => {
    assert.match(HTML, /const ESTIMATE_RANGE_MODE = 'warn';/);
    assert.ok(HTML.indexOf('const ESTIMATE_RANGE_MODE') < HTML.indexOf('const TUTORIAL_VERSION') + 800, 'declared beside TUTORIAL_VERSION');
    assert.equal(makeEnv().run('ESTIMATE_RANGE_MODE'), 'warn');
  });

  it('A5 — Barro Kitchens and Barro Industries carry the domain e-mail and the Quezon City address; no Gmail address anywhere in a code line', () => {
    const co = makeEnv().plain('CO');
    for (const code of ['BK', 'BI']) {
      assert.equal(co[code].addr, '21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila');
      assert.equal(co[code].contact, '09276836300  |  hello@barroindustries.com');
    }
    assert.equal(HTML.includes('barroindustries@gmail.com'), false);
  });

  it('CO.BS is byte-identical to what it was: no e-mail invented for Brilliant Steel (open owner ruling #11)', () => {
    const BS_LITERAL = `  BS:{name:'BRILLIANT STEEL CORPORATION',sub:'',logo:'',addr:'Pasig City, Metro Manila',contact:'09276836300',
    sig:{name:'GERALD CHAN',title:'President, Brilliant Steel Corporation'},nav:'<span>BRILLIANT</span> STEEL',code:'BS',
    thanks:'Thank you for considering Brilliant Steel Corporation. We are committed to quality steelworks delivered on time.',
    creds:'Brilliant Steel Corporation  •  SEC / BIR Registered  •  Pasig City, Metro Manila  •  0927 683 6300'},`;
    assert.ok(HTML.includes(BS_LITERAL), 'the CO.BS literal changed');
  });
});

describe('static — what the builder may name (spec §2.3 / the pricing-core guard)', () => {
  it('it never names the configured-price function or the sheet sanitiser: the price math lives in QBConfigured / pricing-core only', () => {
    assert.equal(/priceConfiguredItem|normalisePricingDoc/.test(HTML), false);
    assert.ok(/QBConfigured\.priceLine\(/.test(HTML), 'the configured price must go through QBConfigured.priceLine');
  });

  it('every ProductFamilies.validateLine / validateConfiguration call in the builder passes { staff:true } — the staff-only 1.2 mm top plate is refused by the public mode (spec §14.6)', () => {
    const calls = SCRIPT.split('\n').filter((l) => !/^\s*\/\//.test(l)).flatMap((l) => [...l.matchAll(/\.(validateLine|validateConfiguration)\(([^;]*)\)\s*;/g)]);
    assert.ok(calls.length >= 2, 'expected at least cfgEvaluate\'s validateLine and openConfigurator\'s validateConfiguration');
    assert.deepEqual([...new Set(calls.map((m) => m[1]))].sort(), ['validateConfiguration', 'validateLine']);
    for (const m of calls) assert.match(m[2], /,\s*\{\s*staff\s*:\s*true\s*\}\s*$/, `a public-mode validation: ${m[0]}`);
    // and no other spelling of a validation call hides from the scan above
    const all = SCRIPT.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').match(/\b(validateLine|validateConfiguration)\(/g) || [];
    assert.equal(all.length, calls.length, 'a validateLine / validateConfiguration call that the scan above did not see');
  });

  it('the product_pricing collection is read in exactly one place: inside loadDatabase(), in its own try/catch, ahead of the catalogue assembly', () => {
    const hits = [...HTML.matchAll(/product_pricing/g)].map((m) => m.index);
    const from = HTML.indexOf('async function loadDatabase(');
    const to = HTML.indexOf('function reloadDatabase()');
    assert.ok(from > 0 && to > from);
    assert.ok(hits.length >= 1);
    assert.ok(hits.every((i) => i > from && i < to), 'product_pricing is named outside loadDatabase()');
    const read = HTML.indexOf("db.collection('product_pricing')");
    const branchEnd = HTML.indexOf('    DB = {\n      products:', from);
    assert.ok(read > from && read < branchEnd, 'the sheet read is not inside loadDatabase() ahead of the catalogue assembly');
    assert.ok(/try \{\s*const sheetSnap = await db\.collection\('product_pricing'\)\.get\(\);/.test(HTML), 'the sheet read has no try/catch of its own');
  });

  it('the kill switch is the productMeta/config.quoteBuilder.configurator === false flag, read from the meta doc already fetched', () => {
    assert.match(HTML, /meta\.quoteBuilder && meta\.quoteBuilder\.configurator === false/);
  });

  it('the partner portal is gone: nothing in the script names PARTNER_MODE / GENERIC_PARTNER / applyPartnerMode / CO.PT, it reads no portal / pcoName parameter, and only BK / BI / BS exist', () => {
    // not even a comment names them (PARTNER-REMOVAL-SPEC WS-E). Only the historical What's New entries (user-facing data) still say "partner".
    for (const gone of ['PARTNER_MODE', 'GENERIC_PARTNER', 'applyPartnerMode', 'PARTNER_CO_NAME', 'PARTNER_BLOCKED_COS', 'CO.PT', 'portal=partner', 'pcoName', 'pcoContact', 'pcoSig']) {
      assert.equal(SCRIPT.includes(gone), false, `${gone} is still in the script`);
    }
    assert.equal(/get\(\s*['"]portal['"]\s*\)/.test(SCRIPT), false, 'the script still reads a portal URL parameter');
    const b = makeEnv();
    assert.deepEqual(Object.keys(b.plain('CO')), ['BK', 'BI', 'BS'], 'a runtime company is back');
    assert.equal(b.run('typeof PARTNER_MODE + "|" + typeof GENERIC_PARTNER + "|" + typeof applyPartnerMode + "|" + typeof PARTNER_BLOCKED_COS'), 'undefined|undefined|undefined|undefined');
    // 'PT' survives in exactly one code line: the ⇄ PT pass-through chip label (it is not a company code)
    const ptLines = SCRIPT.split('\n').filter((l) => !/^\s*\/\//.test(l) && /'PT'|"PT"/.test(l));
    assert.equal(ptLines.length, 1, `'PT' appears on ${ptLines.length} code lines`);
    assert.match(ptLines[0], /togglePassThrough/);
  });

  it('the real boot of a retired-portal URL (?portal=partner, even with the old generic-partner parameters) is a plain staff session: Barro Kitchens, nothing removed from the DOM, document sections collapsed, configurator available', () => {
    const b = makeEnv({ search: '?portal=partner&pcoName=Acme%20Steel&pcoContact=09170000000&pcoSig=A.%20Client' });
    const boots = b.listeners.document.DOMContentLoaded || [];
    assert.ok(boots.length >= 1, 'the builder registered no DOMContentLoaded boot');
    const warn = console.warn; console.warn = () => {};     // the stub has no Firestore: the boot logs "falling back" and uses the embedded catalogue
    try { boots.forEach((fn) => fn()); } finally { console.warn = warn; }
    assert.equal(b.run('currentCo'), 'BK');
    assert.equal(b.el('qnoCo').value, 'BK');
    assert.equal(b.el('navLogo').innerHTML, 'BARRO <span>KITCHENS</span>');
    assert.equal(b.run('CONFIGURATOR_ON'), true);
    assert.equal(b.run('configuratorAvailable()'), true);
    assert.deepEqual([...b.removed], [], 'the boot removed controls from its own DOM — a partner-style lock-down is back');
    assert.equal(b.ctx.document.body.classList.contains('doc-details-collapsed'), true, 'staff start with the document sections collapsed (initUI)');
    // every control the old partner mode removed is in the markup, and nothing in the script removes it by id
    for (const id of ['coBK', 'coBI', 'coBS', 'btnClient', 'btnInternal', 'btnTerms', 'btnOpenProductDb', 'btnImportItems', 'docDetailsBar', 'costMarginWrap', 'configPanel', 'cfgChips', 'handoffBar', 'laborTimelineWrap', 'mtbCoBI', 'mtbViewTerms']) {
      assert.ok(HTML.includes(`id="${id}"`), `#${id} is not in the markup`);
      assert.equal(new RegExp(`getElementById\\('${id}'\\)\\??\\.remove\\(\\)`).test(SCRIPT), false, `the script removes #${id}`);
    }
    // the company pills still switch the letterhead (BK / BI / BS): the retired lock never rebrands a pill
    for (const co of ['BI', 'BS', 'BK']) {
      b.run(`setCompany('${co}')`);
      assert.equal(b.run('currentCo'), co);
      assert.equal(b.el('phName').textContent, b.plain('CO')[co].name);
      assert.equal(b.el('coBS').classList.contains('active'), co === 'BS');
      assert.equal(b.el('coBI').classList.contains('active'), co === 'BI');
    }
    b.run(`setCompany('PT')`);                       // a leftover draft / template from the retired portal carries code PT: it degrades to Barro Kitchens, never throws
    assert.equal(b.run('currentCo'), 'BK');
  });

  // The Brilliant Steel department's Quote Builder page (js/app.js renderQuoteBuilderIframe) opens the builder with ?co=BS so it starts on the
  // Brilliant Steel pill. The builder honours BK / BI / BS only and only for a FRESH boot (PARTNER-REMOVAL-SPEC WS-G).
  describe('the starting company (?co=)', () => {
    // run the real DOMContentLoaded boot; `seed` pre-fills localStorage before it (a draft the previous session left behind)
    const boot = (search, seed) => {
      const b = makeEnv({ search });
      for (const [k, v] of Object.entries(seed || {})) b.store.set(k, v);
      const boots = b.listeners.document.DOMContentLoaded || [];
      assert.ok(boots.length >= 1, 'the builder registered no DOMContentLoaded boot');
      const warn = console.warn; console.warn = () => {};     // no Firestore in the stub: the boot logs "falling back" and uses the embedded catalogue
      try { boots.forEach((fn) => fn()); } finally { console.warn = warn; }
      return b;
    };
    const co = (search) => boot(search).run('currentCo');

    it('?co=BS boots on Brilliant Steel, ?co=BI on Barro Industries, ?co=BK and no parameter on Barro Kitchens', () => {
      assert.equal(co(''), 'BK');
      assert.equal(co('?co=BK'), 'BK');
      assert.equal(co('?co=BI'), 'BI');
      assert.equal(co('?co=BS'), 'BS');
      assert.equal(co('?co=bs'), 'BS');
      assert.equal(co('?reopen=1&co=BS'), 'BS', 'the parameter is read wherever it sits in the query');
    });

    it('anything else is Barro Kitchens: an empty, unknown or retired code, a prototype name, a padded or injected value, the retired portal parameter', () => {
      for (const bad of ['?co=', '?co=XX', '?co=PT', '?co=B', '?co=BSS', '?co=B%20S', '?co=BS%00', '?co=constructor', '?co=toString', '?co=__proto__', '?co=hasOwnProperty',
        '?co=%3Cimg%20src=x%3E', '?co[]=BS', '?portal=partner', '?portal=partner&co=PT', '?cox=BS']) {
        assert.equal(co(bad), 'BK', bad);
      }
    });

    it('the whole company follows the hint, not just the pill: quote number, letterhead, signature, the co-bs class (calculator and BOM hidden), the pills', () => {
      const b = boot('?co=BS');
      const BS = b.plain('CO').BS;
      assert.equal(b.el('qnoCo').value, 'BS');
      assert.equal(b.el('phName').textContent, BS.name);
      assert.equal(b.el('sigContact').textContent, BS.sig.name);
      assert.equal(b.el('navLogo').innerHTML, BS.nav);
      assert.equal(b.ctx.document.body.classList.contains('co-bs'), true);
      assert.equal(b.el('coBS').classList.contains('active'), true);
      assert.equal(b.el('coBK').classList.contains('active'), false);
      assert.match(b.run('document.getElementById("quoteNo").value || ""'), /^(BS|)/);
      // and the user can still switch the pill: the hint is a starting point, not a lock
      b.run(`setCompany('BK')`);
      assert.equal(b.run('currentCo'), 'BK');
      assert.equal(b.ctx.document.body.classList.contains('co-bs'), false);
    });

    it('it only chooses where a FRESH boot starts: a loaded quote, a revision, a resumed draft and a #quote= link keep their own company', () => {
      // LOAD_QUOTE / reopen / new revision / template -> loadEditableState(state): setCompany(state.currentCo) when the state has one
      const a = boot('?co=BS&reopen=1');
      a.run(`loadEditableState({ currentCo: 'BK', items: [] })`);
      assert.equal(a.run('currentCo'), 'BK', 'a Barro Kitchens quote reopened from the Brilliant Steel page stays Barro Kitchens');
      const a2 = boot('?co=BS&reopen=1');
      a2.run(`loadEditableState({ currentCo: 'BI', items: [] })`);
      assert.equal(a2.run('currentCo'), 'BI');
      const a3 = boot('?co=BS&reopen=1');
      a3.run(`loadEditableState({ items: [] })`);
      assert.equal(a3.run('currentCo'), 'BS', 'a state that names no company leaves the starting company alone');
      // a draft left behind by the last session: the resume banner restores the draft's own company
      const d = boot('?co=BS', { bkqb_client: JSON.stringify({ clientName: 'Fake Draft Client', currentCo: 'BI' }), bkqb_items: '[]' });
      assert.equal(d.run('currentCo'), 'BS', 'before "Resume" the fresh boot is on the hinted company (the draft is only offered, never auto-restored)');
      d.run('resumeDraft()');
      assert.equal(d.run('currentCo'), 'BI', 'Resume restores the draft\'s own company');
      // loadFromStorage: a #quote= share link carries its company
      const hashed = makeEnv({ search: '?co=BS' });
      hashed.ctx.atob = (x) => Buffer.from(String(x), 'base64').toString('binary');         // the vm context has no atob; the loader is `JSON.parse(decodeURIComponent(atob(hash)))`
      hashed.ctx.location.hash = '#quote=' + Buffer.from(encodeURIComponent(JSON.stringify({ currentCo: 'BK', items: [], clientName: 'Fake Link Client' }))).toString('base64');
      const warn = console.warn; console.warn = () => {};
      try { (hashed.listeners.document.DOMContentLoaded || []).forEach((fn) => fn()); } finally { console.warn = warn; }
      assert.equal(hashed.run('currentCo'), 'BK', 'a shared #quote= link keeps its own company');
    });

    it('source: the boot calls bootCompany() (not a literal), and bootCompany is an allowlist of exactly BK / BI / BS', () => {
      assert.match(SCRIPT, /document\.getElementById\('quoteDate'\)\.value = new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\];\s*setCompany\(bootCompany\(\)\);/);
      assert.equal(/DOMContentLoaded[\s\S]{0,1200}setCompany\('BK'\);\s*cfgInit/.test(SCRIPT), false, 'the boot starts on a literal Barro Kitchens again');
      const fn = makeEnv().run('bootCompany.toString()');
      assert.match(fn, /co==='BK'\|\|co==='BI'\|\|co==='BS'/);
      assert.equal(/hasOwnProperty|CO\[/.test(fn), false, 'bootCompany consults the CO table (a prototype name would pass)');
    });
  });

  it('the strip list, the auto-pricer and the cost basis name what the spec says they name', () => {
    const b = makeEnv();
    assert.match(b.run('buildQuotePayload.toString()'), /priceManual, _bomOpen, _uid, _miscId, _cfg, \.\.\.rest/);
    assert.match(b.run('applyComputedPricing.toString()'), /QBConfigured\.isAutoPriceable/);
    assert.equal(/item\.id==='MISCFEE' \|\| item\.priceManual\) return/.test(b.run('applyComputedPricing.toString()')), false, 'the old two-clause test is still there');
    assert.match(b.run('itemCostBasis.toString()'), /item\.familyId[\s\S]*QBConfigured\.costBasisFor/);
    assert.match(b.run('canFile.toString()'), /needsPriceReason\(\)/);
    assert.match(b.run('fileQuotation.toString()'), /needsPriceReason\(\)/);
    assert.match(b.run('TEMPLATE_LINEAGE_DROP_FIELDS.join(",")'), /sourceRef,estimateCheck/);
    assert.match(b.run('loadEditableState.toString()'), /\['qnoMethod','qnoLoc'\]/);
    assert.match(b.run('openSourceRequest.toString()'), /QB_OPEN_SOURCE/);
  });
});

// ═══════════════════════════════════════ 2. BEHAVIOUR ═══════════════════════════════════════
// ── R1: who may the cost-plus auto-pricer reprice? ─────────────────────────────────────────────────────────
describe('R1 — applyComputedPricing: the website price and a typed price are protected from the cost-plus auto-pricer', () => {
  const costObj = (b) => ({
    liveById: b.run('new Map((DB.products||[]).map(p => [p.id, p]))'), ohPct: 0.75, mkPct: 0.75,
    cs: { wastePct: 0.06, consumablesPct: 0.1, loadedLaborRate: 150, laborPctOfMaterials: 0.8 },
  });
  const line = (over) => ({ id: 'CE-001', category: 'cooking_line', name: 'x', qty: 1, unit: 'pc', unitPrice: 111, amount: 111, ...over });
  const cfgLine = (over) => ({ id: 'PW-004', category: 'prep_washing', name: 'Sink', familyId: 'sink', familyVersion: 1,
    config: { basins: 2, alignment: 'center', undershelf: false, upper: false, faucet: 'gooseneck' }, size: { W: 1000, D: 500, H: 850 },
    qty: 1, unit: 'pc', unitPrice: 111, amount: 111, basisUnitPrice: 24500, ...over });

  const price = (b, items) => {
    b.run(`items.length = 0; items.push(...${JSON.stringify(items)}); items.forEach(i => { if (i.familyId) i._cfg = cfgCompute(i); });`);
    b.run(`globalThis.__cost = ${JSON.stringify({ ohPct: 0.75, mkPct: 0.75, cs: { wastePct: 0.06, consumablesPct: 0.1, loadedLaborRate: 150, laborPctOfMaterials: 0.8 } })}; __cost.liveById = new Map(DB.products.map(p => [p.id, p]));`);
    const changed = b.run('applyComputedPricing(__cost)');
    return { changed, items: b.plain('items') };
  };

  it('plain catalogue line and a configured line on the COST basis are repriced; website, manual, priceManual and MISCFEE lines are not', () => {
    const b = builder();
    const r = price(b, [
      line({ _tag: 'plain-auto' }),
      line({ _tag: 'plain-cost', priceBasis: 'cost' }),
      line({ _tag: 'plain-manual-flag', priceManual: true }),
      line({ _tag: 'plain-website', priceBasis: 'website', basisUnitPrice: 111 }),
      line({ _tag: 'plain-manual', priceBasis: 'manual' }),
      cfgLine({ _tag: 'cfg-website', priceBasis: 'website' }),
      cfgLine({ _tag: 'cfg-manual', priceBasis: 'manual', priceManual: true }),
      cfgLine({ _tag: 'cfg-manual-noflag', priceBasis: 'manual' }),
      cfgLine({ _tag: 'cfg-cost', priceBasis: 'cost' }),
      { id: 'MISCFEE', category: 'miscellaneous', name: 'Delivery', qty: 1, unit: 'lot', unitPrice: 111, amount: 111, _miscId: 'm1' },
    ]);
    const by = Object.fromEntries(r.items.map((i) => [i._tag || i.id, i]));
    assert.equal(r.changed, true);
    assert.notEqual(by['plain-auto'].unitPrice, 111, 'an unlabelled catalogue line is auto-priced (today\'s behaviour)');
    assert.notEqual(by['plain-cost'].unitPrice, 111, 'a line on the cost basis is auto-priced');
    assert.notEqual(by['cfg-cost'].unitPrice, 111, 'a configured line the staff put on the cost basis is auto-priced');
    for (const k of ['plain-manual-flag', 'plain-website', 'plain-manual', 'cfg-website', 'cfg-manual', 'cfg-manual-noflag', 'MISCFEE']) assert.equal(by[k].unitPrice, 111, `${k} was repriced`);
    assert.equal(by['plain-auto'].unitPrice % 100, 0, 'computed prices still end in two zeros');
  });

  it('a quote of ONLY protected lines changes nothing (the pass reports no change)', () => {
    const b = builder();
    const r = price(b, [cfgLine({ priceBasis: 'website' }), cfgLine({ priceBasis: 'manual' }), line({ priceManual: true })]);
    assert.equal(r.changed, false);
    assert.deepEqual(r.items.map((i) => i.unitPrice), [111, 111, 111]);
  });

  it('a configured line whose basis is unknown or missing is protected, never auto-priced: loading makes it manual (R1 itself reads "no basis" as a plain catalogue line)', () => {
    const b = builder();
    const raw = [cfgLine({ priceBasis: 'whatever' }), cfgLine({ priceBasis: undefined })];
    b.run(`items.length = 0; items.push(...${JSON.stringify(raw)}); normalizeLoadedItems(items);`);
    assert.deepEqual(b.plain('items').map((i) => i.priceBasis), ['manual', 'manual']);
    b.run(`globalThis.__cost = ${JSON.stringify({ ohPct: 0.75, mkPct: 0.75, cs: { wastePct: 0.06, consumablesPct: 0.1, loadedLaborRate: 150, laborPctOfMaterials: 0.8 } })}; __cost.liveById = new Map(DB.products.map(p => [p.id, p]));`);
    assert.equal(b.run('applyComputedPricing(__cost)'), false);
    assert.deepEqual(b.plain('items').map((i) => i.unitPrice), [111, 111]);
  });
});

// ── R2 / R3: building and re-configuring a line ────────────────────────────────────────────────────────
describe('R2 / R3 — a configured line lands at the website price when the sheet prices it, flagged when it cannot; re-configuring follows the basis', () => {
  it('priced: priceBasis website, basisUnitPrice = unitPrice, no priceManual, no needsPrice, builder section = the base product\'s category, stamped with the definitions version', () => {
    const b = builder();
    const { ev, line } = makeLine(b, sinkState());
    assert.equal(ev.basis.priced, true);
    assert.equal(line.priceBasis, 'website');
    assert.equal(line.unitPrice, ev.basis.unitPrice);
    assert.equal(line.basisUnitPrice, ev.basis.unitPrice);
    assert.equal(line.amount, ev.basis.unitPrice * 2);
    assert.equal('priceManual' in line, false);
    assert.equal('needsPrice' in line, false);
    assert.equal(line.id, 'PW-004');
    assert.equal(line.category, 'prep_washing', 'the builder\'s own section, not the family\'s public category');
    assert.equal(line.familyVersion, FAM.version);
    assert.equal(line.dims, 'L1800 × W700 × H900 mm');
    assert.ok(line.specs.length >= 5 && line.specStr.includes('Faucet: Pre-rinse spray'));
  });

  it('the line is priced exactly as QBConfigured.priceLine prices it (one path), soft-width warning included for a stove', () => {
    const b = builder();
    const st = stateFor('stove', { config: { positions: ['wok', 'wok', 'wok', 'wok'], addons: [] }, sizeRaw: { W: '900', D: '700', H: '850' } });
    const { ev } = makeLine(b, st);
    const f = FAM.families.stove;
    const direct = QB.priceLine({ PF, PC, FAM }, { family: f, primary: CATALOGUE.find((p) => p.id === 'CE-001'), config: ev.v.config, size: ev.v.dims, sheet: SHEETS.stove, constants: {} });
    assert.equal(ev.basis.unitPrice, direct.unitPrice);
    assert.deepEqual(ev.basis.warnings, direct.warnings);
    assert.equal(ev.basis.warnings.length, 1, 'asked for 900 mm for 4 burners: priced at the usual length, and it says so');
  });

  it('unpriced (sheet not approved): priceBasis manual + needsPrice, unitPrice 0 — never the bare SKU price (A2)', () => {
    const b = builder();
    b.run(`FAMILY_PRICING.sink.approved = false;`);
    const { ev, line } = makeLine(b, sinkState());
    assert.equal(ev.basis.priced, false);
    assert.equal(ev.basis.reason, 'not_approved');
    assert.equal(line.unitPrice, 0);
    assert.equal(line.amount, 0);
    assert.equal(line.priceBasis, 'manual');
    assert.equal(line.needsPrice, true);
    assert.equal(line.basisUnitPrice, 0);
  });

  it('a price typed in the panel for an unpriced line: manual + priceManual, needsPrice cleared — and a typed price is ignored when the sheet DID price it', () => {
    const b = builder();
    b.run(`FAMILY_PRICING.sink.approved = false;`);
    const { ev, line } = makeLine(b, sinkState({ price: '31250' }));
    b.run(`globalThis.__l = ${JSON.stringify(line)}; cfgNewLinePricing(__l, ${ev.basis.priced}, 31250);`);
    const typed = b.plain('__l');
    assert.equal(typed.unitPrice, 31250);
    assert.equal(typed.amount, 31250 * 2);
    assert.equal(typed.priceBasis, 'manual');
    assert.equal(typed.priceManual, true);
    assert.equal('needsPrice' in typed, false);
    const ok = builder();
    const priced = makeLine(ok, sinkState({ price: '31250' }));
    ok.run(`globalThis.__l = ${JSON.stringify(priced.line)}; cfgNewLinePricing(__l, ${priced.ev.basis.priced}, 31250);`);
    assert.equal(ok.plain('__l').unitPrice, priced.ev.basis.unitPrice, 'the website price stands');
  });

  const edit = (b, old, st, typed = 0) => {
    const { line } = makeLine(b, st);
    b.run(`globalThis.__old = ${JSON.stringify(old)}; globalThis.__fresh = ${JSON.stringify(line)}; globalThis.__r = cfgApplyEdit(__old, __fresh, ${typed});`);
    return { old: b.plain('__old'), fresh: line, r: b.plain('__r') };
  };
  const oldLine = (b, over) => {
    const { line } = makeLine(b, sinkState({ qty: 1 }));
    return { ...line, _uid: 'u1', name: 'My renamed sink', catLabel: 'Option A', ...over };
  };
  const three = { basins: 3, alignment: 'center', undershelf: true, upper: false, faucet: 'prerinse' };

  it('R3 website: the price follows the new options, live; identity (_uid, name, section) is kept; the printed wording is regenerated', () => {
    const b = builder();
    const old = oldLine(b, { specEdit: 'hand-written wording' });
    const r = edit(b, old, sinkState({ qty: 1, config: three, sizeRaw: { W: '1800', D: '700', H: '900' }, touched: { W: true } }));
    assert.equal(r.old.priceBasis, 'website');
    assert.equal(r.old.unitPrice, r.fresh.unitPrice);
    assert.notEqual(r.old.unitPrice, old.unitPrice, 'three sinks cost more than two');
    assert.equal(r.old.basisUnitPrice, r.fresh.unitPrice);
    assert.equal(r.old.config.basins, 3);
    assert.equal(r.old._uid, 'u1');
    assert.equal(r.old.name, 'SS Sink', 're-configuring refreshes the line\'s name to the fresh TITLE (owner ruling 2026-10-28) — the stored name is replaced');
    assert.equal(r.old.catLabel, 'Option A');
    assert.equal('specEdit' in r.old, false, 'the overtyped specs are rewritten from the options');
    assert.equal(r.r.specsRewritten, true);
    assert.equal(r.old.amount, r.old.unitPrice * r.old.qty);
  });

  it('R3 manual: the staff\'s price is untouched when the options change; the basis figure follows', () => {
    const b = builder();
    const old = oldLine(b, { priceBasis: 'manual', priceManual: true, unitPrice: 77700, amount: 77700 });
    const r = edit(b, old, sinkState({ qty: 1, config: three, sizeRaw: { W: '1800', D: '700', H: '900' } }));
    assert.equal(r.old.unitPrice, 77700);
    assert.equal(r.old.priceBasis, 'manual');
    assert.equal(r.old.priceManual, true);
    assert.equal(r.old.basisUnitPrice, r.fresh.unitPrice);
    assert.equal('needsPrice' in r.old, false);
  });

  it('R3 manual + unpriced new options + a re-typed price: the new price is recorded', () => {
    const b = builder();
    b.run(`FAMILY_PRICING.sink.approved = false;`);
    const old = oldLine(b, { priceBasis: 'manual', priceManual: true, unitPrice: 77700, amount: 77700 });
    const r = edit(b, old, sinkState({ qty: 1, config: three, sizeRaw: { W: '1800', D: '700', H: '900' } }), 80100);
    assert.equal(r.old.unitPrice, 80100);
    assert.equal(r.old.priceBasis, 'manual');
  });

  it('R3 cost: the auto-pricer owns unitPrice — the edit leaves it, recomputes only the basis figure, keeps priceBasis cost', () => {
    const b = builder();
    const old = oldLine(b, { priceBasis: 'cost', unitPrice: 55500, amount: 55500 });
    const r = edit(b, old, sinkState({ qty: 1, config: three, sizeRaw: { W: '1800', D: '700', H: '900' } }));
    assert.equal(r.old.priceBasis, 'cost');
    assert.equal(r.old.unitPrice, 55500);
    assert.equal(r.old.basisUnitPrice, r.fresh.unitPrice);
  });

  it('R3 website line re-configured into options with NO website price: it becomes manual + needsPrice at 0 (or takes the typed price)', () => {
    const b = builder();
    const old = oldLine(b);
    b.run(`FAMILY_PRICING.sink.approved = false;`);
    const flagged = edit(b, old, sinkState({ qty: 1, config: three, sizeRaw: { W: '1800', D: '700', H: '900' } }));
    assert.equal(flagged.old.priceBasis, 'manual');
    assert.equal(flagged.old.unitPrice, 0);
    assert.equal(flagged.old.needsPrice, true);
    assert.equal(flagged.old.basisUnitPrice, 0);
    const typed = edit(b, old, sinkState({ qty: 1, config: three, sizeRaw: { W: '1800', D: '700', H: '900' } }), 61000);
    assert.equal(typed.old.unitPrice, 61000);
    assert.equal(typed.old.priceManual, true);
    assert.equal('needsPrice' in typed.old, false);
  });
});

// ── R4: the per-line choice ────────────────────────────────────────────────────────────────────────────
describe('R4 — website price vs cost-based price, per line and for all', () => {
  const setup = () => {
    const b = builder();
    const { line } = makeLine(b, sinkState({ qty: 1 }));
    b.run(`items.length = 0; items.push(${JSON.stringify({ ...line, _uid: 'a' })}); items[0]._cfg = cfgCompute(items[0]); currentView = 'internal';`);   // the cost pass runs in the Estimator
    return { b, website: line.unitPrice };
  };

  it('Use cost-based: the line goes on the cost basis, the auto-pricer fills the price (₱100-rounded); Use website puts the website figure back', () => {
    const { b, website } = setup();
    b.run(`setLinePriceBasis(0, 'cost')`);
    let it = b.plain('items[0]');
    assert.equal(it.priceBasis, 'cost');
    assert.notEqual(it.unitPrice, website);
    assert.equal(it.unitPrice % 100, 0);
    assert.equal(it.basisUnitPrice, website, 'the website figure is remembered');
    b.run(`setLinePriceBasis(0, 'website')`);
    it = b.plain('items[0]');
    assert.equal(it.priceBasis, 'website');
    assert.equal(it.unitPrice, website);
    assert.equal('priceManual' in it, false);
  });

  it('a typed price (updatePrice) is recorded as basis manual and clears needsPrice; ↺ re-apply returns a line that has a cost basis to the cost rule, one without keeps its price', () => {
    const { b } = setup();
    assert.equal(b.run('items[0].priceBasis'), 'website', 'precondition: the line starts on the website basis');
    b.run(`updatePrice(0, { value: '45600' })`);
    let it = b.plain('items[0]');
    assert.equal(it.unitPrice, 45600);
    assert.equal(it.priceBasis, 'manual', 'a typed price is the manual basis');
    assert.equal(it.priceManual, true);
    b.run(`items[0].needsPrice = true; items[0].unitPrice = 0; items[0].amount = 0; updatePrice(0, { value: '45600' })`);
    it = b.plain('items[0]');
    assert.equal('needsPrice' in it, false, 'a real price clears "needs a price"');
    b.run(`resetPricesToComputed()`);
    it = b.plain('items[0]');
    assert.equal(it.priceBasis, 'cost', 'a configured line with a cost basis returns to the cost rule');
    assert.equal('priceManual' in it, false);
    // a line with NO cost basis (primary SKU, no capital cost anywhere near it) stays on its typed price
    const b2 = builder();
    const { line } = makeLine(b2, stateFor('rack', {}));
    b2.run(`items.length = 0; items.push(${JSON.stringify({ ...line, priceBasis: 'manual', priceManual: true, unitPrice: 9900, amount: 9900 })});`);
    b2.run(`resetPricesToComputed()`);
    const kept = b2.plain('items[0]');
    assert.equal(kept.priceBasis, 'manual');
    assert.equal(kept.unitPrice, 9900);
  });

  it('a plain catalogue line has no price basis: typing a price leaves it byte-identical to before (priceManual only)', () => {
    const b = builder();
    b.run(`items.length = 0; items.push({id:'CE-030',category:'cooking_line',name:'Salamander',qty:1,unit:'pc',unitPrice:21911,amount:21911});`);
    b.run(`updatePrice(0, { value: '25000' })`);
    const it = b.plain('items[0]');
    assert.equal(it.priceManual, true);
    assert.equal('priceBasis' in it, false);
  });

  it('Apply cost-based to all: asks first, switches every line that has a cost basis (and only those), clears priceManual', () => {
    const { b } = setup();
    b.run(`items.push({id:'CE-001',category:'cooking_line',name:'Stove',qty:1,unit:'pc',unitPrice:12300,amount:12300,priceBasis:'manual',priceManual:true,capitalMaterials:2203,capitalLabor:611});
           items.push({id:'PW-010',category:'prep_washing',name:'Rack',qty:1,unit:'pc',unitPrice:7700,amount:7700,priceBasis:'manual',priceManual:true});`);   // no cost anywhere near the rack
    b.run(`globalThis.__asked = []; confirm = (m) => { __asked.push(m); return false; };`);
    b.run(`applyCostBasedToAll()`);
    assert.equal(b.run('__asked.length'), 1);
    assert.match(b.run('__asked[0]'), /Switch 2 line\(s\)/, 'the confirm says how many lines');
    assert.equal(b.run('items[1].priceBasis'), 'manual', 'declined: nothing changed');
    b.run(`confirm = () => true; applyCostBasedToAll()`);
    const its = b.plain('items');
    assert.equal(its[0].priceBasis, 'cost');
    assert.equal(its[1].priceBasis, 'cost');
    assert.equal(its[2].priceBasis, 'manual', 'no cost basis: untouched');
    assert.equal(its[2].unitPrice, 7700);
    assert.equal('priceManual' in its[1], false);
  });

  it('passing a website-hand-off PLAIN line through re-prices it for its new mode as it always did; a configured line keeps its basis', () => {
    const b = builder();
    b.run(`items.length = 0; items.push({id:'CE-001',category:'cooking_line',name:'Stove',qty:1,unit:'pc',unitPrice:12300,amount:12300,priceBasis:'website',basisUnitPrice:12300});
           items.push({id:'PW-004',category:'prep_washing',name:'Sink',familyId:'sink',config:{},size:{},qty:1,unit:'pc',unitPrice:9100,amount:9100,priceBasis:'website',basisUnitPrice:9100});`);
    b.run(`togglePassThrough(0, true); togglePassThrough(1, true);`);
    assert.equal(b.run('items[0].priceBasis'), 'cost');
    assert.equal(b.run('items[1].priceBasis'), 'website');
  });
});

// ── R5: the hard gate ──────────────────────────────────────────────────────────────────────────────────
describe('R5 — a line flagged "needs a price" blocks filing until it has one', () => {
  const fillVerify = (b) => {
    for (const [id, v] of Object.entries({ quoteNo: 'BKMLWB261028-001R1', quoteDate: '2026-10-28', salesperson: 'A', clientName: 'Client', clientPhone: '1', clientEmail: 'a@b.c' })) b.el(id).value = v;
  };
  const withLines = (b, lines) => b.run(`items.length = 0; items.push(...${JSON.stringify(lines)});`);
  const flagged = { id: 'PW-004', category: 'prep_washing', name: 'Sink', familyId: 'sink', qty: 1, unit: 'pc', unitPrice: 0, amount: 0, priceBasis: 'manual', needsPrice: true };
  const priced = { ...flagged, unitPrice: 24500, amount: 24500, priceBasis: 'website', needsPrice: undefined };

  it('needsPriceReason: counts only lines that are flagged AND still at 0, in the words of the spec', () => {
    const b = builder();
    withLines(b, [flagged, { ...flagged, unitPrice: 5000, amount: 5000 }, priced, { id: 'CE-030', category: 'x', name: 'f', qty: 1, unit: 'pc', unitPrice: 0, amount: 0 }]);
    assert.equal(b.run('needsPriceReason()'), '1 configured line(s) have no price yet — type a price or ask Finance to approve the option sheet.');
    withLines(b, [flagged, { ...flagged, familyId: undefined }]);
    assert.match(b.run('needsPriceReason()'), /^2 line\(s\) have no price yet/, 'a plain unpriced request line counts too');
    withLines(b, [priced]);
    assert.equal(b.run('needsPriceReason()'), '');
  });

  it('canFile() is false while a flagged line has no price (even with every verify field filled and nothing waived) and true once it has one', () => {
    const b = builder();
    fillVerify(b);
    withLines(b, [priced]);
    assert.equal(b.run('canFile()'), true, 'the harness fills every other check');
    withLines(b, [priced, flagged]);
    assert.equal(b.run('canFile()'), false);
    b.run(`items[1].unitPrice = 1; items[1].amount = 1;`);
    assert.equal(b.run('canFile()'), true, 'a price clears the gate (needsPrice alone is not enough to block)');
  });

  it('fileQuotation() is a second gate: it posts nothing for a flagged line even when canFile() were fooled, and files a priced quote', async () => {
    const b = builder();
    fillVerify(b);
    withLines(b, [priced, flagged]);
    b.run('canFile = () => true;');
    await b.run('fileQuotation()');
    assert.equal(b.posted.filter((p) => /^QUOTE_/.test(p.msg.type)).length, 0, 'an unpriced line reached the bridge');
    assert.match(b.toast(), /have no price yet/);
    const ok = builder();
    fillVerify(ok);
    withLines(ok, [priced]);
    await ok.run('fileQuotation()');
    const filed = ok.posted.find((p) => p.msg.type === 'QUOTE_FILED');
    assert.ok(filed, 'a fully priced quote files');
    assert.equal(filed.msg.payload.items[0].priceBasis, 'website');
  });

  it('the Verify & File modal says why (a red block), and the File button is disabled', () => {
    const b = builder();
    fillVerify(b);
    withLines(b, [priced, flagged]);
    b.run('buildVerifyModal()');
    assert.match(b.el('verifyBody').innerHTML, /Lines Without a Price/);
    assert.match(b.el('verifyBody').innerHTML, /1 configured line\(s\) have no price yet/);
    assert.equal(b.el('fileBtn').disabled, true);
  });

  it('a quote with no flagged line is not blocked: needsPriceReason() is empty', () => {
    const b = builder();
    withLines(b, [priced]);
    assert.equal(b.run('needsPriceReason()'), '');
  });
});

// ── §3.2: what leaves the builder ──────────────────────────────────────────────────────────────────────
describe('§3.2 — payload, draft and template: `_cfg` never leaves; sourceRef and estimateCheck are filed', () => {
  const cfgItem = (b) => {
    const { line } = makeLine(b, sinkState());
    return { ...line, _uid: 'z', sourceRef: { kind: 'qr', ref: 'QR-261021-K7M2PX', n: 1 }, priceManual: true };
  };

  it('buildQuotePayload(): no `_cfg` and no priceManual on any item or in editableState; every other configured field rides', () => {
    const b = builder();
    const it = cfgItem(b);
    assert.ok(it._cfg, 'precondition: the in-session line has its runtime figures');
    b.run(`items.length = 0; items.push(${JSON.stringify(it)}); items[0]._cfg = {base: 1, deltas: [{key:'x', amount: 2}], reason: null};`);
    const pl = b.plain('buildQuotePayload()');
    for (const row of [pl.items[0], pl.editableState.items[0]]) {
      assert.equal('_cfg' in row, false);
      assert.equal('_uid' in row, false);
      assert.equal('priceManual' in row, false);
      for (const k of ['familyId', 'familyVersion', 'config', 'size', 'specs', 'dims', 'priceBasis', 'basisUnitPrice', 'sourceRef']) assert.ok(k in row, `${k} must ride in the payload`);
    }
    assert.equal(JSON.stringify(pl).includes('"deltas"'), false, 'no option amount anywhere in the filed payload');
  });

  it('the cost sidecar carries cfgCost for a configured line (the model it was costed from) and priceManual', () => {
    const b = builder();
    const it = cfgItem(b);
    b.run(`items.length = 0; items.push(${JSON.stringify(it)});`);
    const side = b.plain('buildCostSidecar()');
    assert.equal(side.items[0].priceManual, true);
    assert.equal(side.items[0].cfgCost.basisSku, QB.nearestAbsorbed(FAM.families.sink, it.config).sku);
    assert.equal(typeof side.items[0].cfgCost.scale, 'number');
  });

  it('the local draft (localStorage) never stores `_cfg` either, and keeps the hand-off in its own key', () => {
    const b = builder();
    const it = cfgItem(b);
    b.run(`items.length = 0; items.push(${JSON.stringify(it)}); items[0]._cfg = {base: 1}; sourceRef = {kind:'qr', ref:'QR-261021-K7M2PX'}; flushSaveToStorageNow();`);
    assert.equal(b.store.get('bkqb_items').includes('_cfg'), false);
    assert.ok(JSON.parse(b.store.get('bkqb_items'))[0].familyId);
    assert.deepEqual(JSON.parse(b.store.get('bkqb_source')), { kind: 'qr', ref: 'QR-261021-K7M2PX', estimate: null });
  });

  it('sourceRef: top level carries {kind, ref} only; editableState carries the whole hand-off; a quote that did not start on the website files null', () => {
    const b = builder();
    b.run(`sourceRef = cleanSourceRef({kind:'qr', ref:'QR-261021-K7M2PX', estimate:{low:60000, high:75000, step:5000, vatBasis:'exclusive', deliveryIncluded:false}, targetDate:'2026-11-30', targetFlexible:true, useForLabel:'Restaurant / café', entityType:'private', notes:'call after 3', name:'Juan', evil:'x'}, true);`);
    const pl = b.plain('buildQuotePayload()');
    assert.deepEqual(pl.sourceRef, { kind: 'qr', ref: 'QR-261021-K7M2PX' });
    assert.equal(pl.editableState.sourceRef.estimate.low, 60000);
    assert.equal(pl.editableState.sourceRef.notes, 'call after 3');
    assert.equal('evil' in pl.editableState.sourceRef, false, 'unknown keys are dropped');
    const plain = builder();
    const p2 = plain.plain('buildQuotePayload()');
    assert.equal(p2.sourceRef, null);
    assert.equal(p2.estimateCheck, null);
    assert.equal(p2.editableState.sourceRef, null);
  });

  it('hostile sourceRef input is made safe: wrong kinds and refs are dropped, strings are capped, numbers are numbers', () => {
    const b = builder();
    const f = (v, full = true) => b.plain(`cleanSourceRef(${JSON.stringify(v)}, ${full})`);
    for (const bad of [null, 5, 'x', [], {}, { kind: 'qr' }, { ref: 'QR-1' }, { kind: 'evil', ref: 'QR-261021-K7M2PX' }, { kind: 'qr', ref: 5 }]) assert.equal(f(bad), null, JSON.stringify(bad));
    const r = f({ kind: 'cir', ref: 'CIR-261021-ABC234', notes: 'n'.repeat(5000), budget: 'b'.repeat(900), photosCount: '7', estimate: { low: 'x', high: 5 } });
    assert.equal(r.notes.length, 2000);
    assert.equal(r.budget.length, 200);
    assert.equal(r.photosCount, 7);
    assert.equal(r.estimate, null, 'an estimate with a non-number bound is dropped');
  });

  it('a TEMPLATE drops the hand-off and the estimate check, and no line of it points back at the request', () => {
    const b = builder();
    const it = cfgItem(b);
    b.run(`items.length = 0; items.push(${JSON.stringify(it)}); sourceRef = cleanSourceRef({kind:'qr', ref:'QR-261021-K7M2PX'}, true);`);
    const state = b.plain('stripTemplateState(buildQuotePayload().editableState)');
    assert.equal('sourceRef' in state, false);
    assert.equal('estimateCheck' in state, false);
    assert.equal('sourceRef' in state.items[0], false);
    assert.equal(state.items[0].familyId, 'sink', 'the configured line itself survives a template');
  });
});

// ── §4.5: the cost basis ───────────────────────────────────────────────────────────────────────────────
describe('§4.5 — itemCostBasis hands a configured line to QBConfigured.costBasisFor, never to its primary SKU\'s cost', () => {
  it('a configured sink is costed from the nearest standard model it absorbed (PW-006), approximately; a plain line is costed as before', () => {
    const b = builder();
    const { line } = makeLine(b, sinkState());
    b.run(`globalThis.__live = new Map(DB.products.map(p => [p.id, p]));`);
    const basis = b.plain(`itemCostBasis(${JSON.stringify(line)}, __live)`);
    assert.equal(basis.basisSku, QB.nearestAbsorbed(FAM.families.sink, line.config).sku);
    assert.equal(basis.hasBasis, true);
    assert.equal(basis.isCustom, false);
    assert.ok(basis.scale > 0 && basis.mat > 0);
    const plain = b.plain(`itemCostBasis({id:'CE-001', qty:1}, __live)`);
    assert.equal('basisSku' in plain, false, 'the catalogue branch is untouched');
    assert.equal(plain.mat, CATALOGUE.find((p) => p.id === 'CE-001').capitalMaterials);
  });

  it('a configured line with no cost anywhere near its family has no basis (the cost panel says so; the auto-pricer skips it)', () => {
    const b = builder();
    const { line } = makeLine(b, stateFor('rack', {}));
    b.run(`globalThis.__live = new Map(DB.products.map(p => [p.id, p]));`);
    assert.equal(b.plain(`itemCostBasis(${JSON.stringify(line)}, __live)`).hasBasis, false);
  });
});

// ── §6 / §7: hand-off and the estimate-range check ─────────────────────────────────────────────────────
describe('§6 / §7 — a website hand-off loads; the total is compared with the range the client saw', () => {
  const REF = 'QR-261021-K7M2PX';
  const handoff = (b, over = {}) => {
    b.el('qnoLoc').options = ['LU', 'BG', 'ML', 'SB', 'CL', 'DA', 'CB', 'IG', 'OT'].map((v) => ({ value: v }));
    b.el('qnoMethod').options = ['FB', 'VB', 'OF', 'RF', 'IG', 'WB', 'EM'].map((v) => ({ value: v }));
    const items = [
      QB.fromRequestItem({ n: 1, id: 'PW-004', cat: 'prep_washing', name: 'Sink', qty: 2, unit: 'pc', familyId: 'sink', config: { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'prerinse' }, size: { W: 1800, D: 700, H: 900 }, specs: [{ label: 'Sinks', value: '2' }] }, { n: 1, priced: true, unitPrice: 41300 }, REF),
      QB.fromRequestItem({ n: 2, id: 'PW-015', cat: 'prep_washing', name: 'Cabinet', qty: 1, unit: 'pc', familyId: 'cabinet', config: { type: 'wall', doors: 'sliding', shelves: 2 }, size: { W: 900, D: 400, H: 700 }, specs: [] }, { n: 2, priced: false, unitPrice: 0 }, REF),
      QB.fromRequestItem({ n: 3, id: 'CE-030', cat: 'cooking_line', name: 'Salamander', qty: 1, unit: 'pc', specs: [] }, { n: 3, priced: true, unitPrice: 30000 }, REF),
    ];
    const state = { clientName: 'Juan', currentCo: 'BK', qnoMethod: 'WB', qnoLoc: 'BG', purpose: 'Cafe / Coffee Shop', handoff: true, items,
      sourceRef: { kind: 'qr', ref: REF, estimate: { low: 60000, high: 75000, step: 5000 }, targetDate: '2026-11-30', targetFlexible: true, useForLabel: 'Restaurant / café', entityType: 'private', notes: 'call <img src=x onerror=alert(1)>', ...over }, ...over.state };
    b.run(`loadEditableState(${JSON.stringify(state)})`);
  };

  it('the lead source and location code come with the hand-off, the quote number is rebuilt from them, and an unknown code is ignored', () => {
    const b = builder();
    handoff(b);
    assert.equal(b.el('qnoMethod').value, 'WB');
    assert.equal(b.el('qnoLoc').value, 'BG');
    const b2 = builder();
    b2.el('qnoLoc').value = 'ML';
    b2.el('qnoLoc').options = [{ value: 'ML' }];
    b2.run(`loadEditableState({ currentCo: 'BK', qnoLoc: 'ZZ', items: [] })`);
    assert.equal(b2.el('qnoLoc').value, 'ML', 'a code the select does not offer is not applied');
  });

  it('request lines arrive protected: the priced ones as website lines, the unpriced one manual + needsPrice; none is left to the auto-pricer', () => {
    const b = builder();
    handoff(b);
    const its = b.plain('items');
    assert.deepEqual(its.map((i) => i.priceBasis), ['website', 'manual', 'website']);
    assert.equal(its[1].needsPrice, true);
    assert.equal(its[1].unitPrice, 0);
    assert.ok(its[0]._cfg && its[0].familyVersion === FAM.version, 'a configured line is hydrated with its runtime figures and the definitions version');
    assert.equal('_cfg' in its[2], false);
    assert.match(b.run('needsPriceReason()'), /^1 configured line/);
  });

  it('a configured line that arrives with NO price basis is protected (manual), never left to the auto-pricer', () => {
    const b = builder();
    b.run(`loadEditableState({ currentCo: 'BK', items: [{ id: 'PW-004', familyId: 'sink', config: {}, size: {}, name: 'Sink', qty: 1, unit: 'pc', unitPrice: 5000, amount: 5000 }, { id: 'PW-004', familyId: 'sink', name: 'Sink', qty: 1, unit: 'pc', unitPrice: 0, amount: 0, priceBasis: 'bogus' }] })`);
    const its = b.plain('items');
    assert.deepEqual(its.map((i) => i.priceBasis), ['manual', 'manual']);
    assert.equal(its[0].needsPrice, undefined);
    assert.equal(its[1].needsPrice, true);
  });

  it('the hand-off bar names the reference and what the client told us, as text — never as HTML', () => {
    const b = builder();
    handoff(b);
    const html = b.el('handoffBar').innerHTML;
    assert.ok(html.includes(REF));
    assert.ok(html.includes('Restaurant / café') && html.includes('target 2026-11-30 (flexible)') && html.includes('client saw ₱60,000 – ₱75,000'));
    assert.equal(/<img/i.test(html), false);
    assert.ok(html.includes('&lt;img'), 'the client\'s note is escaped');
    assert.notEqual(b.el('handoffBar').style.display, 'none');
  });

  it('"Open request" posts QB_OPEN_SOURCE with {kind, ref} only; New clears the hand-off', () => {
    const b = builder();
    handoff(b);
    b.run('openSourceRequest()');
    assert.deepEqual(JSON.parse(JSON.stringify(b.posted.at(-1).msg)), { type: 'QB_OPEN_SOURCE', payload: { sourceRef: { kind: 'qr', ref: REF } } });
    assert.equal(b.posted.at(-1).origin, 'http://localhost');
    b.run('clearForm()');
    assert.equal(b.run('sourceRef'), null);
    assert.equal(b.el('handoffBar').style.display, 'none');
  });

  it('estimate check: the comparable total (ex-VAT, before delivery, MISCFEE and VAT excluded) against the range the client saw', () => {
    const b = builder();
    handoff(b);
    b.run(`items.length = 0; items.push(
      {id:'PW-004', category:'prep_washing', name:'a', qty:1, unit:'pc', unitPrice:70000, amount:70000, priceBasis:'website'},
      {id:'MISCFEE', category:'miscellaneous', name:'Delivery', qty:1, unit:'lot', unitPrice:99999, amount:99999, _miscId:'m1'});`);
    b.el('showVat').checked = true;
    let ec = b.plain('currentEstimateCheck()');
    assert.deepEqual([ec.applicable, ec.inRange, ec.comparable], [true, true, 70000], 'a delivery fee and VAT never push a quote out of range');
    b.run(`items[0].unitPrice = 75000; items[0].amount = 75000`);
    assert.equal(b.plain('currentEstimateCheck()').inRange, true, 'the top of the range is inclusive');
    b.run(`items[0].unitPrice = 90000; items[0].amount = 90000`);
    ec = b.plain('currentEstimateCheck()');
    assert.deepEqual([ec.inRange, ec.direction, ec.pctOff], [false, 'above', 20]);
    const pl = b.plain('buildQuotePayload()');
    assert.deepEqual(pl.estimateCheck, { low: 60000, high: 75000, comparable: 90000, inRange: false, pctOff: 20, reason: '' });
  });

  it('an options quote compares the NOMINATED option\'s own lines, never a sum across options (the client takes exactly one)', () => {
    const b = builder();
    handoff(b);
    b.run(`items.length = 0; items.push(
      {id:'PW-004', category:'sec_1', catLabel:'Option A', name:'a', qty:1, unit:'pc', unitPrice:70000, amount:70000, priceBasis:'website'},
      {id:'PW-004', category:'sec_2', catLabel:'Option B', name:'b', qty:1, unit:'pc', unitPrice:200000, amount:200000, priceBasis:'website'});`);
    assert.equal(b.plain('currentEstimateCheck()').comparable, 270000, 'a plain quote adds everything up');
    b.el('optionsMode').checked = true;
    b.run(`optionsBasisKey = 'sec_1'`);
    assert.deepEqual([b.plain('currentEstimateCheck()').comparable, b.plain('currentEstimateCheck()').inRange], [70000, true]);
    b.run(`optionsBasisKey = 'sec_2'`);
    assert.deepEqual([b.plain('currentEstimateCheck()').comparable, b.plain('currentEstimateCheck()').inRange], [200000, false]);
  });

  it('a quote with no estimate on its source has no estimate check; the modal shows the warning only when out of range and never blocks (mode warn)', () => {
    const b = builder();
    handoff(b);
    b.run(`items.length = 0; items.push({id:'PW-004', category:'prep_washing', name:'a', qty:1, unit:'pc', unitPrice:90000, amount:90000, priceBasis:'website'});`);
    assert.match(b.run('estimateVerifyHtml()'), /Outside the estimate the client saw[\s\S]*₱60,000 – ₱75,000 online[\s\S]*₱90,000, 20 % above/);
    assert.equal(b.run('estimateReasonBlock()'), '', 'warn mode never blocks');
    b.run(`items[0].unitPrice = 65000; items[0].amount = 65000`);
    assert.equal(b.run('estimateVerifyHtml()'), '');
    b.run(`sourceRef.estimate = null`);
    assert.equal(b.run('currentEstimateCheck()'), null);
    assert.equal(b.plain('buildQuotePayload().estimateCheck'), null);
  });

  it('ESTIMATE_RANGE_MODE "reason" (a one-word change): File is held until at least 10 characters say why, and the reason is filed', () => {
    const b = makeEnv({ script: SCRIPT.replace("const ESTIMATE_RANGE_MODE = 'warn';", "const ESTIMATE_RANGE_MODE = 'reason';") });
    b.run(`DB = { products: ${JSON.stringify(CATALOGUE)}, categories: [], laborRoles: [], constants: {} };`);
    for (const [id, v] of Object.entries({ quoteNo: 'X1', quoteDate: '2026-10-28', salesperson: 'A', clientName: 'C', clientPhone: '1', clientEmail: 'a@b.c' })) b.el(id).value = v;
    b.run(`sourceRef = cleanSourceRef({kind:'qr', ref:'${REF}', estimate:{low:60000, high:75000}}, true);
           items.length = 0; items.push({id:'PW-004', category:'prep_washing', name:'a', qty:1, unit:'pc', unitPrice:90000, amount:90000, priceBasis:'website'});`);
    assert.equal(b.run('canFile()'), false);
    assert.match(b.run('estimateVerifyHtml()'), /<textarea id="estimateReasonBox"/);
    b.run(`estimateReason = 'too short'`);
    assert.equal(b.run('canFile()'), false);
    b.run(`estimateReason = 'client added a second sink after the call'`);
    assert.equal(b.run('canFile()'), true);
    assert.equal(b.plain('buildQuotePayload().estimateCheck').reason, 'client added a second sink after the call');
    b.run(`items[0].unitPrice = 65000; items[0].amount = 65000`);
    assert.equal(b.plain('buildQuotePayload().estimateCheck.reason'), '', 'in range: no reason filed');
  });
});

// ── §2.3 / §2.5: loadDatabase ──────────────────────────────────────────────────────────────────────────
describe('§2.3 / §2.5 — loadDatabase reads the option sheets for an internal session only; a denied read degrades; the kill switch works', () => {
  const boot = bootDb;

  it('internal session: the sheets are read once, kept raw by family id, state "live", configurator on', async () => {
    const f = fakeDb();
    const b = await boot({}, f);
    assert.equal(f.reads.filter((r) => r === 'product_pricing').length, 1);
    assert.deepEqual(Object.keys(b.plain('FAMILY_PRICING')).sort(), [...FAM.order].sort());
    assert.equal(b.run('FAMILY_PRICING_STATE'), 'live');
    assert.equal(b.run('CONFIGURATOR_ON'), true);
    assert.equal(b.run('configuratorAvailable()'), true);
  });

  it('a leftover ?portal=partner in the URL (the retired partner portal) changes nothing: the sheets are read once, state "live", the configurator on, and the old "skipped" state no longer exists', async () => {
    const f = fakeDb();
    const b = await boot({ search: '?portal=partner&pcoName=Acme' }, f);
    assert.equal(f.reads.filter((r) => r === 'product_pricing').length, 1);
    assert.equal(f.reads.includes('products'), true);
    assert.deepEqual(Object.keys(b.plain('FAMILY_PRICING')).sort(), [...FAM.order].sort());
    assert.equal(b.run('FAMILY_PRICING_STATE'), 'live');
    assert.equal(b.run('CONFIGURATOR_ON'), true);
    assert.equal(b.run('configuratorAvailable()'), true);
    assert.equal(SCRIPT.includes("'skipped'"), false, 'the partner-only "skipped" option-sheet state is back');
  });

  it('a denied read costs only the option amounts: the catalogue still loads, state "denied", configured lines read "Priced after review" in plain words', async () => {
    const f = fakeDb({ sheets: 'denied' });
    const b = await boot({}, f);
    assert.equal(b.run('DB.products.length'), CATALOGUE.length);
    assert.deepEqual(b.plain('FAMILY_PRICING'), {});
    assert.equal(b.run('FAMILY_PRICING_STATE'), 'denied');
    assert.equal(b.run('configuratorAvailable()'), true, 'the configurator still works, priced by hand');
    const { ev } = makeLine(b, sinkState());
    assert.equal(ev.basis.priced, false);
    assert.equal(b.run(`cfgReasonText(${JSON.stringify(ev.basis)})`), 'Option amounts not readable in this session — ask Finance.');
  });

  it('kill switch: productMeta/config.quoteBuilder.configurator === false turns it off with no deploy; any other value leaves it on', async () => {
    const off = await boot({}, fakeDb({ meta: { quoteBuilder: { configurator: false } } }));
    assert.equal(off.run('CONFIGURATOR_ON'), false);
    assert.equal(off.run('configuratorAvailable()'), false);
    assert.equal(off.run('absorbedFamilyOf("PW-006") && cfgSoldOnlineHtml("PW-006")'), '', 'no "sold online as" hint while off');
    for (const meta of [{}, { quoteBuilder: {} }, { quoteBuilder: { configurator: true } }, { quoteBuilder: { configurator: 0 } }, { quoteBuilder: { configurator: 'false' } }]) {
      const on = await boot({}, fakeDb({ meta }));
      assert.equal(on.run('CONFIGURATOR_ON'), true, JSON.stringify(meta));
    }
  });

  it('while off, a saved configured line still loads and totals at its stored price, wears a "configurator off" chip, and cannot be edited', async () => {
    const b = await boot({}, fakeDb({ meta: { quoteBuilder: { configurator: false } } }));
    b.run(`loadEditableState({ currentCo: 'BK', items: [{ id: 'PW-004', familyId: 'sink', familyVersion: 1, config: { basins: 2, alignment: 'center', undershelf: false, upper: false, faucet: 'gooseneck' }, size: { W: 1000, D: 500, H: 850 }, name: 'Sink', qty: 2, unit: 'pc', unitPrice: 25000, amount: 50000, priceBasis: 'website', basisUnitPrice: 25000 }] })`);
    assert.equal(b.run('computeTotals().grand'), 50000);
    assert.match(b.run('cfgLineRowHtml(items[0], 0)'), /configurator off/);
    assert.equal(/configureLine\(0\)/.test(b.run('cfgLineRowHtml(items[0], 0)')), false, 'no ⚙ configure button');
    b.run('configureLine(0)');
    assert.equal(b.run('cfgState'), null);
    assert.match(b.toast(), /switched off/);
  });
});

// ── §4: the panel is generated from the definitions ────────────────────────────────────────────────────
describe('§4.1 / §4.2 — the Configure chips and the panel are generated from the definitions, never written by hand per family', () => {
  it('one chip per family in QR_FAMILIES.order, labelled from the definition', () => {
    const b = builder();
    b.run('renderCfgChips()');
    const html = b.el('cfgChips').innerHTML;
    for (const id of FAM.order) {
      assert.ok(html.includes(`data-cfg-open="${id}"`), id);
      assert.ok(html.includes(`⚙ ${FAM.families[id].label}`), id);
    }
    assert.equal((html.match(/cfg-chip-btn/g) || []).length, FAM.order.length);
    assert.notEqual(b.el('cfgChips').style.display, 'none');
  });

  const openAndRender = (b, id) => { b.run(`openConfigurator(${JSON.stringify(id)})`); return b.el('cfgBody').innerHTML; };

  // The choices that make a conditional group apply: every key of its `when`, at the first value it allows (the rest at their defaults).
  const allowing = (f, g) => ({ ...PF.defaultConfig(f), ...Object.fromEntries(Object.entries(g.when || {}).map(([k, vals]) => [k, vals[0]])) });

  it('every group (choice pills, a select above four options, slots, multi), every option and every size axis of all eleven families renders — a conditional group as soon as the choices it depends on allow it', () => {
    const b = builder();
    let conditional = 0;
    for (const id of FAM.order) {
      const f = FAM.families[id];
      // one pass per group, each with a configuration under which THAT group applies (for an unconditional group: the default one)
      for (const target of f.groups) {
        const cfg = allowing(f, target);
        if (target.when) conditional++;
        b.run(`openConfigurator(${JSON.stringify(id)}, ${JSON.stringify({ config: cfg })})`);
        const html = b.el('cfgBody').innerHTML;
        assert.equal(b.run('cfgState && cfgState.familyId'), id);
        assert.equal(b.el('cfgNotice').textContent, '', `${id}/${target.key}: a valid configuration opens with no "reset" notice`);
        f.groups.forEach((g, gi) => {
          assert.equal(html.includes(`<div class="cfg-lbl" id="cfgL${gi}">`), PF.groupApplies(f, g, cfg), `${id}/${g.key}: shown exactly when it applies (target ${target.key})`);
        });
        f.groups.filter((g) => PF.groupApplies(f, g, cfg)).forEach((g) => {
          assert.ok(html.includes(g.label.replace(/&/g, '&amp;')), `${id}: group "${g.label}" missing`);
          g.options.forEach((o) => assert.ok(html.includes(String(o.l)) || html.includes(String(o.f)), `${id}/${g.key}: option ${o.v} missing`));
          if (g.type === 'slots') assert.ok(html.includes('cfg-slots') && html.includes('cfgSlotAdd'), `${id}: slots row`);
          if (g.type === 'multi') assert.ok(html.includes('type="checkbox"'), `${id}: add-on chips`);
          if (g.type === 'choice') assert.ok(g.options.length <= 4 ? html.includes('cfg-pills') : html.includes('<select data-cfg-key'), `${id}/${g.key}: pills vs select`);
          if (g.type === 'choice' && g.options.length <= 4) g.options.forEach((o) => assert.ok(html.includes(`data-cfg-group="${g.key}" data-cfg-v="${String(o.v)}"`), `${id}/${g.key}=${o.v}: the spec's button[data-cfg-group][data-cfg-v]`));
        });
        Object.entries(f.dims).forEach(([k, d]) => {
          assert.ok(html.includes(`id="cfgDim_${k}"`), `${id}: size input ${k}`);
          assert.ok(html.includes(`min="${d.min}" max="${d.max}" step="${d.step}"`), `${id}: ${k} limits from the definition`);
        });
        assert.ok(b.el('cfgPreview').textContent.startsWith(f.label), `${id}: the one-line summary`);
      }
    }
    assert.equal(conditional, 3, 'the premise: three conditional groups in the definitions (fry baskets, burners, a pre-rinse sink)');
  });

  it('a twelfth family added to the definitions renders with ZERO code change (a choice of 5 → select, slots, multi, two size axes, and a chain of conditional choices)', () => {
    const b = builder();
    const orderBefore = FAM.order.slice();
    const extra = JSON.parse(JSON.stringify(FAM.families.stove));
    extra.id = 'zz_test'; extra.label = 'Test rig'; extra.primary = 'CE-001';
    extra.groups = [
      { key: 'size5', label: 'Five sizes', type: 'choice', default: 1, options: [1, 2, 3, 4, 5].map((v) => ({ v, l: `S${v}`, s: `s${v}` })) },
      ...extra.groups,
      { key: 'finish', label: 'Finish', type: 'multi', default: [], options: [{ v: 'a', l: 'Alpha', s: 'a' }, { v: 'b', l: 'Beta', s: 'b' }] },
      // a chain: B applies only for A = y, and C only for B = 2 (so C can only be showing while B is — and both go when A goes back to x)
      { key: 'gate_a', label: 'Gate A', type: 'choice', default: 'x', options: [{ v: 'x', l: 'Ax', s: 'ax' }, { v: 'y', l: 'Ay', s: 'ay' }] },
      { key: 'gate_b', label: 'Gate B', type: 'choice', default: 1, when: { gate_a: ['y'] }, options: [{ v: 1, l: 'B1', s: 'b1' }, { v: 2, l: 'B2', s: 'b2' }] },
      { key: 'gate_c', label: 'Gate C', type: 'multi', default: [], when: { gate_b: [2] }, options: [{ v: 'p', l: 'Pee', s: 'p' }] },
    ];
    extra.dims = { W: extra.dims.W, H: extra.dims.H };
    // the builder's window.QR_FAMILIES IS this file's FAM (shared by every test below): put the definitions back however this test ends
    try {
      b.run(`QR_FAMILIES.families.zz_test = ${JSON.stringify(extra)}; QR_FAMILIES.order = QR_FAMILIES.order.concat('zz_test');`);
      b.run('renderCfgChips()');
      assert.ok(b.el('cfgChips').innerHTML.includes('⚙ Test rig'));
      const html = openAndRender(b, 'zz_test');
      assert.ok(html.includes('Five sizes') && html.includes('<select data-cfg-key="g0"') && html.includes('S5'));
      assert.ok(html.includes('Burner positions') && html.includes('cfg-slots'));
      assert.ok(html.includes('Finish') && html.includes('Alpha') && html.includes('Beta'));
      assert.ok(html.includes('id="cfgDim_W"') && html.includes('id="cfgDim_H"') && !html.includes('id="cfgDim_D"'), 'only the family\'s own axes');
      // the chain: only Gate A to begin with; A = y brings Gate B; B = 2 brings Gate C; A back to x takes BOTH away in the same draw and puts their choices back to the defaults
      const gi = (key) => extra.groups.findIndex((g) => g.key === key);
      const shown = () => ['gate_a', 'gate_b', 'gate_c'].filter((k) => b.el('cfgBody').innerHTML.includes(`<div class="cfg-lbl" id="cfgL${gi(k)}">`));
      assert.deepEqual(shown(), ['gate_a']);
      b.run(`cfgPickOpt(${gi('gate_a')}, 1)`);
      assert.deepEqual(shown(), ['gate_a', 'gate_b']);
      b.run(`cfgPickOpt(${gi('gate_b')}, 1)`);
      b.run(`cfgToggleMulti(${gi('gate_c')}, 0, true)`);
      assert.deepEqual(shown(), ['gate_a', 'gate_b', 'gate_c']);
      assert.deepEqual(b.plain('[cfgState.config.gate_b, cfgState.config.gate_c]'), [2, ['p']]);
      b.run(`cfgPickOpt(${gi('gate_a')}, 0)`);
      assert.deepEqual(shown(), ['gate_a'], 'both conditional groups are gone in the same draw');
      assert.deepEqual(b.plain('[cfgState.config.gate_b, cfgState.config.gate_c]'), [1, []], 'and back at their defaults');
      assert.equal(b.run('cfgEvaluate(cfgState).v.ok'), true, 'the panel never reports the snapped choices as an error');
    } finally {
      b.run(`delete QR_FAMILIES.families.zz_test; QR_FAMILIES.order = QR_FAMILIES.order.filter(id => id !== 'zz_test');`);
    }
    assert.deepEqual(FAM.order, orderBefore, 'the shared definitions are back as they were');
    assert.equal('zz_test' in FAM.families, false);
  });
});

describe('§4.3 / §4.4 — validation before pricing; the live price; "Priced after review"', () => {
  const open = (b, id, opts = {}) => { b.run(`openConfigurator(${JSON.stringify(id)}, ${JSON.stringify(opts)})`); };
  const pick = (b, gi, oi) => b.run(`cfgPickOpt(${gi}, ${oi})`);
  const dim = (b, k, v) => { b.el('cfgDim_' + k).value = String(v); b.run(`cfgDimInput('${k}', document.getElementById('cfgDim_${k}'))`); };

  it('a hard minimum length: below it Add is disabled and the length says "Minimum N mm for these sinks" with a Use shortcut; choosing more sinks lifts an untouched length by itself', () => {
    const b = builder();
    open(b, 'sink');
    assert.equal(b.el('cfgAddBtn').disabled, false);
    pick(b, gAt('sink', 'basins'), 2);                                   // 3 sinks
    assert.equal(b.el('cfgDim_W').value || b.run('cfgState.sizeRaw.W'), b.run('cfgState.sizeRaw.W'));
    assert.equal(b.run('cfgState.sizeRaw.W'), '1500', 'the untouched length follows the options');
    dim(b, 'W', 900);
    assert.equal(b.el('cfgAddBtn').disabled, true);
    assert.match(b.el('cfgErr_W').innerHTML, /Minimum 1500 mm for these sinks/);
    assert.match(b.el('cfgErr_W').innerHTML, /cfgUseMin\('W',1500\)[^>]*>Use 1500 mm/);
    assert.match(b.el('cfgPriceArea').innerHTML, /Fix the highlighted fields/);
    b.run(`cfgUseMin('W', 1500)`);
    assert.equal(b.el('cfgAddBtn').disabled, false);
    assert.equal(b.el('cfgErr_W').innerHTML, '');
  });

  it('a length typed by hand stays where it was put when the options change (only untouched axes follow)', () => {
    const b = builder();
    open(b, 'sink');
    dim(b, 'W', 2300);
    pick(b, gAt('sink', 'basins'), 2);
    assert.equal(b.run('cfgState.sizeRaw.W'), '2300');
    assert.equal(b.el('cfgAddBtn').disabled, false);
  });

  it('bad sizes are refused with the definition\'s own words (blank, off-step, out of range, fractional); nothing prices until it is valid', () => {
    const b = builder();
    open(b, 'prep_table');
    for (const bad of ['', '1234', '499', '9999', '900.5', 'abc']) {
      dim(b, 'W', bad);
      assert.equal(b.el('cfgAddBtn').disabled, true, `"${bad}" must not be addable`);
      assert.match(b.el('cfgErr_W').innerHTML, /must be a whole number of millimetres from 500 to 6000, in steps of 10/);
      assert.match(b.el('cfgPriceArea').innerHTML, /—/);
    }
    dim(b, 'W', 1200);
    assert.equal(b.el('cfgAddBtn').disabled, false);
    assert.match(b.el('cfgPriceArea').innerHTML, /website basis/);
  });

  it('a stove oven forces a minimum width and height (hint, min attribute, "Use N mm"); a short stove is a soft warning priced at the usual length — Add stays enabled', () => {
    const b = builder();
    open(b, 'stove');
    b.run(`cfgToggleMulti(${gAt('stove', 'addons')}, 2, true)`);                  // oven
    assert.match(b.el('cfgDH_H').innerHTML, /minimum 850 mm with these options/);
    dim(b, 'H', 800);
    assert.equal(b.el('cfgAddBtn').disabled, true);
    assert.match(b.el('cfgErr_H').innerHTML, /Use 850 mm/);
    dim(b, 'H', 850);
    const P = gAt('stove', 'positions');
    b.run(`cfgSlotAdd(${P}); cfgSlotAdd(${P}); cfgSlotAdd(${P})`);                // 4 burners: usual length is longer than the default
    dim(b, 'W', 700);
    assert.equal(b.el('cfgAddBtn').disabled, false, 'the soft rule never blocks');
    assert.match(b.el('cfgPriceArea').innerHTML, /priced at the usual \d+ mm length for these burners/);
  });

  it('slots: add / remove are bounded by the definition, reorder keeps the order (it is part of the configuration)', () => {
    const b = builder();
    open(b, 'stove');
    const P = gAt('stove', 'positions');
    for (let i = 0; i < 8; i++) b.run(`cfgSlotAdd(${P})`);
    assert.equal(b.run('cfgState.config.positions.length'), 6);
    assert.match(b.el('cfgBody').innerHTML, new RegExp(`data-cfg-key="g${P}add" disabled`));
    for (let i = 0; i < 8; i++) b.run(`cfgSlotDel(${P})`);
    assert.equal(b.run('cfgState.config.positions.length'), 1);
    b.run(`cfgSlotAdd(${P}); cfgSlotSet(${P}, 1, 2)`);
    const before = b.plain('cfgState.config.positions');
    b.run(`cfgSlotMove(${P}, 0, 1)`);
    assert.deepEqual(b.plain('cfgState.config.positions'), [before[1], before[0]]);
    b.run(`cfgSlotMove(${P}, 1, 1)`);
    assert.deepEqual(b.plain('cfgState.config.positions'), [before[1], before[0]], 'moving the last one right is a no-op');
  });

  it('priced: the big figure is the website price with its base + options caption; qty multiplies; the panel never touches the shared definitions', () => {
    const b = builder();
    const defsBefore = JSON.stringify(FAM);
    open(b, 'sink');
    pick(b, gAt('sink', 'basins'), 1);
    b.run('cfgBumpQty(2)');
    const area = b.el('cfgPriceArea').innerHTML;
    const direct = b.plain('cfgEvaluate(cfgState).basis');
    assert.ok(area.includes(`₱${direct.unitPrice.toLocaleString('en-PH')}`));
    assert.ok(area.includes('website basis'));
    assert.ok(area.includes(`× 3 = ₱${(direct.unitPrice * 3).toLocaleString('en-PH')}`));
    assert.match(area, /Catalogue base PW-004 at this size ₱[\d,]+ [+−] options ₱[\d,]+/);
    assert.equal(b.el('cfgManualWrap').style.display, 'none');
    assert.equal(JSON.stringify(FAM), defsBefore, 'the definitions were mutated');
    // the panel works on copies: no array of the shared definitions is ever handed to it as its own state
    open(b, 'stove');
    assert.equal(b.run('cfgState.config.positions === QR_FAMILIES.families.stove.groups.find(g => g.key === "positions").default'), false);
    assert.equal(b.run('cfgState.config.addons === QR_FAMILIES.families.stove.groups.find(g => g.key === "addons").default'), false);
  });

  it('not priced: "Priced after review" with the reason in plain words and a "Your price" box; Add stays enabled; each reason has its sentence', () => {
    const b = builder();
    const want = {
      not_approved: 'The option sheet for this product is not approved yet.',
      missing_input: 'No amount entered yet for: Faucet: Pre-rinse spray; Sinks: 2.',
      no_base_price: 'The catalogue base item has no list price.',
      size_basis: 'The family\'s size basis no longer matches its base item — Finance should check the product.',
      no_price: 'The configured total is not above zero — Finance should check the amounts.',
      no_primary: 'The base product for this family is not in the loaded catalogue.',
    };
    for (const [reason, text] of Object.entries(want)) assert.equal(b.run(`cfgReasonText({ reason: ${JSON.stringify(reason)}, missing: ['Faucet: Pre-rinse spray', 'Sinks: 2'] })`), text, reason);
    b.run(`FAMILY_PRICING.sink.approved = false`);
    open(b, 'sink');
    const area = b.el('cfgPriceArea').innerHTML;
    assert.match(area, /Priced after review/);
    assert.match(area, /not approved yet/);
    assert.notEqual(b.el('cfgManualWrap').style.display, 'none');
    assert.equal(b.el('cfgAddBtn').disabled, false);
    b.run(`cfgManualInput({ value: '12000' })`);
    assert.match(b.el('cfgPriceArea').innerHTML, /Your price ₱12,000/);
    b.run(`cfgState.price = ''; FAMILY_PRICING.sink = undefined; FAMILY_PRICING_STATE = 'denied'; cfgRefresh()`);
    assert.match(b.el('cfgPriceArea').innerHTML, /Option amounts not readable in this session — ask Finance\./);
  });

  it('Add puts a configured line on the quote and closes the panel; ⚙ configure re-opens it as an UPDATE of the same line; a removed line cannot be updated', () => {
    const b = builder();
    open(b, 'sink');
    pick(b, gAt('sink', 'basins'), 1);
    b.run('cfgCommit()');
    assert.equal(b.run('items.length'), 1);
    assert.equal(b.run('cfgState'), null);
    assert.equal(b.run('items[0].config.basins'), 2);
    assert.match(b.toast(), /Added: SS Sink \(configured\)/, 'the toast names the line by its title');
    b.run('configureLine(0)');
    assert.match(b.el('cfgTitle').innerHTML, /Edit:/);
    assert.equal(b.el('cfgAddBtn').textContent, '✔ Update line');
    pick(b, gAt('sink', 'basins'), 2);
    b.run('cfgCommit()');
    assert.equal(b.run('items.length'), 1, 'an update replaces, never appends');
    assert.equal(b.run('items[0].config.basins'), 3);
    b.run('configureLine(0)');
    b.run('items.length = 0');
    b.run('cfgCommit()');
    assert.match(b.toast(), /removed/);
    assert.equal(b.run('cfgState'), null);
  });

  it('a saved line whose options no longer exist opens with a visible notice and safe defaults', () => {
    const b = builder();
    open(b, 'sink', { config: { basins: 9, alignment: 'left' }, dims: { W: 1000, D: 500, H: 850 } });
    assert.match(b.el('cfgNotice').textContent, /no longer available/);
    assert.equal(b.run('cfgState.config.basins'), 1);
    assert.equal(b.run('cfgState.config.alignment'), 'left');
  });
});

// ── §10.3 and §4.6 ─────────────────────────────────────────────────────────────────────────────────────
describe('§10.3 / §4.6 — convert an old line; "configure instead"', () => {
  // priceManual: in the Estimator an untyped plain line is auto-priced from its cost, so a TYPED price is what stays put for the assertions below
  const plainSink = { id: 'PW-006', category: 'prep_washing', name: 'SS Double Sink Table', dims: 'L1200 × W500 × H850 mm', specs: [], qty: 2, unit: 'pc', unitPrice: 19300, amount: 38600, priceManual: true, _uid: 'u9', notes: 'n' };

  it('convert: the price is kept, the basis is manual, the builder section is kept (not the family\'s public category), identity fields survive', () => {
    const b = builder();
    b.run(`items.length = 0; items.push(${JSON.stringify(plainSink)});`);
    const conv = b.plain(`cfgConvertLine(items[0])`);
    assert.equal(conv.familyId, 'sink');
    assert.equal(conv.id, 'PW-004');
    assert.equal(conv.category, 'prep_washing');
    assert.equal(conv.unitPrice, 19300);
    assert.equal(conv.priceBasis, 'manual');
    assert.equal(conv.priceManual, true);
    assert.equal(conv._uid, 'u9');
    assert.equal(conv.notes, 'n');
    assert.deepEqual(conv.config.basins, 2);
    assert.equal(b.plain(`cfgConvertLine({ id: 'CE-030', name: 'x' })`), null, 'a SKU no family absorbed is not convertible');
  });

  it('the ⚙ row offers "convert to configured" only for an absorbed SKU, never for custom / fee / non-absorbed lines', () => {
    const b = builder();
    assert.match(b.run(`cfgLineRowHtml(${JSON.stringify(plainSink)}, 3)`), /convertToConfigured\(3\)/);
    for (const it of [{ id: 'CUSTOM', name: 'c' }, { id: 'MISCFEE', name: 'm' }, { id: 'CE-030', name: 'f' }]) assert.equal(b.run(`cfgLineRowHtml(${JSON.stringify(it)}, 0)`), '', it.id);
  });

  it('convert opens the panel pre-filled with the converted line; Cancel puts the original plain line back; Update keeps the converted one', () => {
    const b = builder();
    b.run(`items.length = 0; items.push(${JSON.stringify(plainSink)}); globalThis.__orig = items[0];`);
    b.run('convertToConfigured(0)');
    assert.equal(b.run('items[0].familyId'), 'sink');
    assert.equal(b.run('cfgState.config.basins'), 2);
    assert.equal(b.run('cfgState.sizeRaw.W'), '1200');
    assert.equal(b.run('cfgState.qty'), 2);
    b.run('closeConfigurator()');
    assert.equal(b.run('items[0] === __orig'), true, 'Cancel restored the very same plain line');
    b.run('convertToConfigured(0)');
    b.run('cfgCommit()');
    assert.equal(b.run('items[0].familyId'), 'sink');
    assert.equal(b.run('items[0].unitPrice'), 19300, 'updating the converted line never re-prices it');
    assert.equal(b.run('items[0].priceBasis'), 'manual');
  });

  it('"configure instead" opens the configurator on the family\'s configuration of that SKU, carrying the size typed in the calculator', () => {
    const b = builder();
    b.run(`selectedProduct = DB.products.find(p => p.id === 'PW-006'); dimsMm = { W: 1450, D: 500, H: 850 };`);
    b.run(`configureInstead('PW-006')`);
    assert.equal(b.run('cfgState.familyId'), 'sink');
    assert.equal(b.run('cfgState.config.basins'), 2);
    assert.equal(b.run('cfgState.sizeRaw.W'), '1450');
    assert.equal(b.run('selectedProduct'), null, 'the calculator panel was dismissed');
    assert.match(b.run(`cfgSoldOnlineHtml('PW-006')`), /Sold online as: Sink \(configurable\)[\s\S]*configure instead/);
    assert.equal(b.run(`cfgSoldOnlineHtml('CE-030')`), '', 'a SKU no family absorbed gets no hint');
  });
});

// ── §4.9: the guided demo ──────────────────────────────────────────────────────────────────────────────
describe('§4.9 — the guided demo shows the panel read-only: it adds nothing and closes it again', () => {
  const tourEnv = () => {
    const b = builder();
    // every selector "resolves" to a visible element, so no step is skipped
    b.ctx.document.querySelector = () => ({ offsetParent: {}, getBoundingClientRect: () => ({ width: 100, height: 20, left: 0, top: 0, right: 100, bottom: 20 }), scrollIntoView() {}, closest: () => null });
    b.run(`items.push({id:'PW-004',category:'prep_washing',name:'Sink',familyId:'sink',config:{basins:1,alignment:'center',undershelf:false,upper:false,faucet:'gooseneck'},size:{W:500,D:500,H:850},qty:1,unit:'pc',unitPrice:24500,amount:24500,priceBasis:'website',basisUnitPrice:24500});`);
    return b;
  };

  it('the configurator step opens #configPanel on a standard product with Add disabled, the demo cannot add a line, and the panel is closed when the demo leaves', () => {
    const b = tourEnv();
    const steps = b.plain('TOUR_STEPS');
    const at = steps.findIndex((s) => s.needsConfigurator);
    const quote = () => b.run('JSON.stringify(items.map(({ _uid, ...rest }) => rest))');   // _uid is stamped by the Estimator's own cost pass, whatever the tour does
    const snapshot = quote();
    b.run('startTour()');
    for (let i = 0; i < at; i++) b.run('tourGo(1)');
    assert.equal(b.run('tourIdx'), at);
    assert.equal(b.run('cfgState && cfgState.tour'), true);
    assert.equal(b.run('cfgTourOwned'), true);
    assert.equal(b.el('configPanel').classList.contains('open'), true);
    assert.equal(b.el('configPanel').classList.contains('cfg-tour'), true, 'in the page (not a bottom sheet) so the demo card is never hidden behind it');
    assert.equal(b.el('cfgAddBtn').disabled, true);
    b.run('cfgCommit()');                                                          // even if something calls it
    assert.equal(b.run('items.length'), 1, 'the demo added a line');
    b.run('tourGo(1)');                                                            // leave the step
    assert.equal(b.run('cfgState'), null);
    assert.equal(b.el('configPanel').classList.contains('open'), false);
    while (b.run('tourActive')) b.run('tourGo(1)');
    assert.equal(quote(), snapshot, 'the demo changed the quote');
  });

  it('Skip / Escape on the step closes the panel too; a panel the USER had open is left alone by the demo', () => {
    const b = tourEnv();
    const at = b.plain('TOUR_STEPS').findIndex((s) => s.needsConfigurator);
    b.run('startTour()');
    for (let i = 0; i < at; i++) b.run('tourGo(1)');
    b.run('endTour()');
    assert.equal(b.run('cfgState'), null);
    assert.equal(b.run('cfgTourOwned'), false);
    const u = tourEnv();
    u.run(`openConfigurator('stove')`);
    u.run('startTour()');
    for (let i = 0; i < at; i++) u.run('tourGo(1)');
    assert.equal(u.run('cfgState.familyId'), 'stove', 'the user\'s own panel is what the step shows');
    assert.equal(u.run('cfgTourOwned'), false);
    u.run('endTour()');
    assert.equal(u.run('cfgState && cfgState.familyId'), 'stove', 'and it is still theirs afterwards');
  });

  it('the step is skipped (no panel) when the configurator is unavailable — the kill switch', () => {
    const b = tourEnv();
    b.run('CONFIGURATOR_ON = false');
    const at = b.plain('TOUR_STEPS').findIndex((s) => s.needsConfigurator);
    b.run('startTour()');
    for (let i = 0; i < at; i++) b.run('tourGo(1)');
    assert.notEqual(b.run('tourIdx'), at, 'the step was shown anyway');
    assert.equal(b.run('cfgState'), null);
    b.run('endTour()');
  });

  it('from the Terms tab the demo switches to the Estimator for the workspace steps (it used to skip every one of them) — also on a phone, where #btnInternal is hidden behind the menu', () => {
    const b = tourEnv();
    const at = b.plain('TOUR_STEPS').findIndex((s) => s.needsConfigurator);
    b.run(`setView('terms')`);
    b.ctx.document.body.classList.add('body-terms-view');
    b.el('btnInternal').offsetParent = null;                                       // hidden, as on a phone
    b.run('startTour()');
    for (let i = 0; i < at; i++) b.run('tourGo(1)');
    assert.equal(b.ctx.document.body.classList.contains('body-terms-view'), false, 'the demo stayed on the Terms tab');
    assert.equal(b.run('currentView'), 'internal');
    assert.equal(b.run('tourIdx'), at, 'the configurator step was reached');
    b.run('endTour()');
    assert.equal(b.run('currentView'), 'terms', 'the demo puts the view back where it started');
  });
});

// ── tab/keyboard bits that do not need a browser ───────────────────────────────────────────────────────
describe('§4.8 — keyboard and focus (the parts that do not need a browser)', () => {
  it('Escape closes the panel unless the demo or a modal is on top; closing returns focus to the opener', () => {
    const b = builder();
    let focused = 0;
    const opener = { focus: () => { focused++; } };
    b.run(`openConfigurator('sink')`);
    b.run('cfgState.opener = null');
    b.ctx.__opener = opener;
    b.run('cfgState.opener = __opener');
    b.ctx.document.contains = () => true;
    b.run(`cfgKeyHandler({ key: 'Escape', preventDefault() {} })`);
    assert.equal(b.run('cfgState'), null);
    assert.equal(focused, 1, 'focus returned to the opener');
    b.run(`openConfigurator('sink')`);
    b.el('verifyModal').style.display = 'flex';
    b.run(`cfgKeyHandler({ key: 'Escape', preventDefault() {} })`);
    assert.notEqual(b.run('cfgState'), null, 'a modal on top takes the Escape first');
    b.el('verifyModal').style.display = 'none';
    b.run(`cfgKeyHandler({ key: 'a', preventDefault() {} })`);
    assert.notEqual(b.run('cfgState'), null);
  });

  it('the markup gives the panel its dialog role, a labelled title, a focus target, an explicit close button and 44px-class touch rules at phone width', () => {
    assert.match(HTML, /id="configPanel" role="dialog" aria-modal="false" aria-labelledby="cfgTitle" tabindex="-1"/);
    assert.match(HTML, /aria-label="Close the configurator"/);
    const css = HTML.slice(HTML.indexOf('/* ── CONFIGURATOR'), HTML.indexOf('@media print{#configPanel'));
    assert.match(css, /@media\(max-width:768px\)\{[\s\S]*#configPanel\.open:not\(\.cfg-tour\)\{display:flex;flex-direction:column;position:fixed;left:0;right:0;bottom:0/);
    assert.match(css, /\.cfg-foot\{margin-top:0;[^}]*env\(safe-area-inset-bottom/);
    for (const sel of ['#configPanel .cfg-pill{min-height:44px', '#configPanel .cfg-check{min-height:44px', '#configPanel .cfg-stepper button{min-height:44px', '#configPanel .cfg-slot-mv button{min-height:44px', '#configPanel select,#configPanel input:not([type="checkbox"]):not([type="radio"]){min-height:44px']) {
      assert.ok(css.includes(sel), `phone touch target missing: ${sel}`);
    }
    assert.match(css, /\.cfg-slots\{display:flex;gap:8px;overflow-x:auto/, 'the burner row scrolls sideways');
  });

  it('nothing the configurator adds is printed: its markup and per-line rows are .no-print, and the print stylesheet hides the panel and chips outright', () => {
    for (const re of [/class="cfg-panel no-print" id="configPanel"/, /class="cfg-chips no-print" id="cfgChips"/, /class="no-print" id="cfgBackdrop"/, /class="handoff-bar no-print" id="handoffBar"/]) assert.match(HTML, re);
    assert.match(HTML, /@media print\{#configPanel,#cfgBackdrop,#cfgChips,#handoffBar\{display:none!important;\}\}/);
    const b = builder();
    const row = b.run(`cfgLineRowHtml({ id: 'PW-004', familyId: 'sink', config: {}, size: {}, unitPrice: 0, needsPrice: true, priceBasis: 'manual', basisUnitPrice: 0, _cfg: { reason: 'not_approved', missing: [], base: 0, deltas: [], warnings: [] } }, 0)`);
    assert.match(row, /^<div class="spec-line cfg-row no-print">/);
    assert.match(row, /needs a price/);
  });
});

// ═══════════════════════════════════════ WS-5C — the staff-only 1.2 mm top plate (owner ruling 2026-10-28, spec §14.6) ═══════════════════════════════════════
// The made-to-order standard is a 1.5 mm (16 ga) top on tables, sinks and stoves; the lighter 1.2 mm top is a STAFF choice (a `staffOnly` group in the
// definitions — the website, the server and a public validation refuse it). The builder is the one place it can be picked, so it must validate in staff mode.
describe('WS-5C — the staff-only 1.2 mm top plate: offered in the panel with a "staff" chip, priced only from a real cell, printed as the Construction row', () => {
  const open = (b, id, opts = {}) => { b.run(`openConfigurator(${JSON.stringify(id)}, ${JSON.stringify(opts)})`); };
  const groupAt = (id, key) => FAM.families[id].groups.findIndex((g) => g.key === key);
  const optAt = (id, key, v) => FAM.families[id].groups[groupAt(id, key)].options.findIndex((o) => o.v === v);
  const pickTop = (b, id, v) => b.run(`cfgPickOpt(${groupAt(id, 'top')}, ${optAt(id, 'top', v)})`);
  const STAFF = ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range'];       // the hood, the cooking line and the deck oven have no top plate (CONFIGURATOR-FAMILIES-2-SPEC §3)
  const CHIP = '<span class="cfg-staff-chip no-print" title="Not offered on the website">staff</span>';
  const SINK_CONSTRUCTION = (top) => `SS304 stainless steel · ${top} · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet`;
  const specText = (html) => { const m = /<span class="spec-edit cell-edit"[^>]*>([^<]*)<\/span>/.exec(html); return m ? m[1] : null; };   // what the quote prints for the line's specs

  it('premise: the definitions mark the Top plate staff-only on exactly the table, the sink, the dish table, the stove and the wok range (and the steel grade on all eleven, first) — and a PUBLIC validation refuses its 1.2 mm value', () => {
    assert.deepEqual(FAM.order.filter((id) => FAM.families[id].groups.some((g) => g.staffOnly && g.key === 'top')), STAFF);
    assert.deepEqual(FAM.order.filter((id) => FAM.families[id].groups[0].key === 'grade' && FAM.families[id].groups[0].staffOnly === true), FAM.order, 'the grade is the staff-only FIRST group of every family');
    for (const id of STAFF) {
      const f = FAM.families[id];
      const top = f.groups.find((g) => g.key === 'top');
      assert.deepEqual([top.type, top.default, top.options.map((o) => o.v)], ['choice', 1.5, [1.5, 1.2]], id);
      assert.equal(f.groups[f.groups.length - 1], top, `${id}: the staff-only group comes last`);
      const cfg = { ...PF.defaultConfig(f), top: 1.2 };
      assert.equal(PF.validateLine(f, cfg, PF.defaultDims(f)).ok, false, `${id}: the public mode must refuse 1.2 mm`);
      assert.equal(PF.validateLine(f, cfg, PF.defaultDims(f), { staff: true }).ok, true, `${id}: the staff mode accepts it`);
    }
  });

  it('the panel renders a staff-only choice like any group of two options (pills, its hint), with a "staff" chip in its label — and no other group, of any family, gets one', () => {
    const b = builder();
    for (const id of FAM.order) {
      const f = FAM.families[id];
      open(b, id);
      const html = b.el('cfgBody').innerHTML;
      const chips = html.split(CHIP).length - 1;
      assert.equal(chips, f.groups.filter((g) => g.staffOnly).length, `${id}: one chip per staff-only group`);
      assert.equal((html.match(/cfg-staff-chip/g) || []).length, chips, `${id}: no other chip markup`);
      f.groups.forEach((g, gi) => {
        const label = g.label.replace(/&/g, '&amp;');
        const mark = `<div class="cfg-lbl" id="cfgL${gi}">${label}${g.staffOnly ? ' ' + CHIP : ''}</div>`;
        // a conditional group (fry baskets for a fryer…) is not drawn until its choice allows it, so it has no label here
        assert.equal(html.includes(mark), PF.groupApplies(f, g, PF.defaultConfig(f)), `${id}/${g.key}: label${g.staffOnly ? ' + chip' : ' alone'}, drawn only when it applies`);
      });
    }
    open(b, 'sink');
    const html = b.el('cfgBody').innerHTML;
    const top = FAM.families.sink.groups.find((g) => g.key === 'top');
    assert.ok(html.includes('data-cfg-group="top" data-cfg-v="1.5"') && html.includes('data-cfg-group="top" data-cfg-v="1.2"'), 'a pill per option, the spec\'s selectors');
    assert.ok(html.includes('>1.5 mm (16 ga)</button>') && html.includes('>1.2 mm</button>'));
    assert.ok(html.includes('role="group" aria-labelledby="cfgL' + groupAt('sink', 'top') + '"'), 'a pill group like any other');
    assert.ok(html.includes(`<div class="cfg-hintline">${top.options[0].hint}</div>`), 'the standard top carries its hint');
    assert.equal(top.options.length <= 4, true);
    assert.match(HTML, /\.cfg-staff-chip\{[^}]*font-size:10px/, 'the chip has a style');
  });

  it('the Top plate starts on the standard 1.5 mm; picking 1.2 mm is a valid choice (staff mode): Add stays enabled, the summary says "1.2 mm top", and the hint changes', () => {
    const b = builder();
    open(b, 'sink');
    assert.equal(b.run('cfgState.config.top'), 1.5);
    assert.equal(/1\.2 mm top/.test(b.el('cfgPreview').textContent), false, 'the standard top is not repeated in the summary');
    assert.equal(b.el('cfgAddBtn').disabled, false);
    pickTop(b, 'sink', 1.2);
    assert.equal(b.run('cfgState.config.top'), 1.2);
    assert.deepEqual(b.plain('cfgEvaluate(cfgState).v.errors'), [], 'no "chosen by our staff" error in the builder');
    assert.equal(b.plain('cfgEvaluate(cfgState).v.ok'), true);
    assert.equal(b.el('cfgAddBtn').disabled, false, 'Add is not disabled by the staff-only choice');
    assert.match(b.el('cfgPreview').textContent, /gooseneck faucet · 1\.2 mm top · /);
    assert.ok(b.el('cfgBody').innerHTML.includes(`<div class="cfg-hintline">${FAM.families.sink.groups.find((g) => g.key === 'top').options[1].hint}</div>`), 'the hint follows the choice');
    assert.equal(b.el('cfgBody').innerHTML.includes('chosen by our staff'), false);
    for (const id of STAFF) { open(b, id); pickTop(b, id, 1.2); assert.equal(b.run('cfgEvaluate(cfgState).v.ok'), true, id); }
  });

  it('1.2 mm with NO cell on the option sheet: "Priced after review — Top plate: 1.2 mm", a required price box, Add enabled; a negative cell then prices it (cheaper by exactly that amount); a zero cell prices it the same; a blank cell never reads as 0', () => {
    const b = builder();
    b.run(`delete FAMILY_PRICING.sink.options.top`);                       // the sheet has no Top plate cell at all (Finance has not entered one)
    open(b, 'sink');
    const standard = b.plain('cfgEvaluate(cfgState).basis');
    assert.equal(standard.priced, true, 'the standard 1.5 mm top is the zero point: it needs no cell');
    assert.deepEqual(standard.deltas.filter((d) => /^top:/.test(d.key)), []);
    pickTop(b, 'sink', 1.2);
    const area = b.el('cfgPriceArea').innerHTML;
    assert.match(area, /<span class="cfg-badge">Priced after review<\/span>/);
    assert.match(area, /No amount entered yet for: Top plate: 1\.2 mm\./);
    assert.notEqual(b.el('cfgManualWrap').style.display, 'none');
    assert.equal(b.el('cfgAddBtn').disabled, false);
    assert.deepEqual(b.plain('cfgEvaluate(cfgState).basis').missing, ['Top plate: 1.2 mm']);
    assert.equal(b.plain('cfgEvaluate(cfgState).basis').unitPrice, 0, 'a blank cell is never zero');
    // a synthetic NEGATIVE cell — the lighter top takes money off
    b.run(`FAMILY_PRICING.sink.options.top = { '1.2': { flat: -1234, perW100: null } }; cfgRefresh();`);
    const lighter = b.plain('cfgEvaluate(cfgState).basis');
    assert.equal(lighter.priced, true);
    assert.equal(lighter.unitPrice, standard.unitPrice - 1234);
    assert.deepEqual(lighter.deltas.filter((d) => /^top:/.test(d.key)), [{ key: 'top:1.2', amount: -1234 }]);
    assert.match(b.el('cfgPriceArea').innerHTML, /website basis/);
    assert.equal(b.el('cfgManualWrap').style.display, 'none');
    // a ZERO cell (the lighter top costs the same): priced, same figure
    b.run(`FAMILY_PRICING.sink.options.top = { '1.2': { flat: 0, perW100: null } }; cfgRefresh();`);
    assert.equal(b.plain('cfgEvaluate(cfgState).basis').unitPrice, standard.unitPrice);
    // going back to the standard top removes the delta again
    b.run(`FAMILY_PRICING.sink.options.top = { '1.2': { flat: -1234, perW100: null } }`);
    pickTop(b, 'sink', 1.5);
    assert.equal(b.plain('cfgEvaluate(cfgState).basis').unitPrice, standard.unitPrice);
  });

  it('a 1.2 mm line added with a typed price: manual + priceManual, config.top 1.2 stored, and the printed specs END with the Construction row naming the lighter top — never a "Top plate" row', () => {
    const b = builder();
    b.run(`delete FAMILY_PRICING.sink.options.top`);
    open(b, 'sink');
    pickTop(b, 'sink', 1.2);
    b.run(`cfgManualInput({ value: '38000' }); cfgCommit()`);
    const it = b.plain('items[0]');
    assert.equal(it.config.top, 1.2);
    assert.deepEqual([it.priceBasis, it.priceManual, it.unitPrice], ['manual', true, 38000]);
    assert.equal(it.needsPrice, undefined);
    assert.equal(it.specs.at(-1).label, 'Construction');
    assert.equal(it.specs.at(-1).value, SINK_CONSTRUCTION('1.2 mm top plate (lighter)'));
    assert.equal(it.specs.some((s) => /^top plate$/i.test(s.label)), false, 'the top plate has no row of its own');
    assert.equal(it.specs.filter((s) => s.label === 'Construction').length, 1);
    assert.ok(it.specStr.endsWith('Construction: ' + SINK_CONSTRUCTION('1.2 mm top plate (lighter)')));
    // what the Estimator table (and so the client preview, which clones it, and the PDF) prints
    const printed = specText(b.el('itemsTbody').innerHTML);
    assert.ok(printed, 'the line\'s specs cell was not found in the items table');
    assert.ok(printed.endsWith('Construction: ' + SINK_CONSTRUCTION('1.2 mm top plate (lighter)')), `printed: ${printed}`);
    assert.equal(/Top plate:/.test(printed), false, 'a "Top plate" row is never printed');
    assert.match(printed, /^Material: Stainless Steel 304 Food Grade • Sinks: /, 'the Material row is the first printed row');
    // …and what is filed
    const pl = b.plain('buildQuotePayload()');
    for (const row of [pl.items[0], pl.editableState.items[0]]) {
      assert.equal(row.specs.at(-1).label, 'Construction');
      assert.equal(row.config.top, 1.2);
      assert.equal(row.specs.some((s) => /top plate/i.test(s.label)), false);
    }
    assert.match(b.run('QB_DOC_SOURCE_IDS.join()'), /\bitemsSection\b/, 'the client preview is a clone of the same items table the specs are printed in');
  });

  it('the standard line (1.5 mm) prints the 1.5 mm (16 ga) construction, for all three families that have a top plate', () => {
    for (const id of STAFF) {
      const b = builder();
      const { line } = makeLine(b, stateFor(id, {}));
      const last = line.specs.at(-1);
      assert.equal(last.label, 'Construction', id);
      assert.match(last.value, /^SS304 stainless steel · 1\.5 mm \(16 ga\) top plate · 1\.2 mm /, id);
      assert.equal(line.config.top, 1.5, `${id}: the canonical config states the standard top`);
      assert.equal(line.specs.some((s) => /top plate/i.test(s.label)), false, id);
    }
    // a family with no staff-only group still ends with its own Construction row
    const b = builder();
    assert.equal(makeLine(b, stateFor('cabinet', {})).line.specs.at(-1).label, 'Construction');
    assert.equal('top' in makeLine(b, stateFor('cabinet', {})).line.config, false);
  });

  it('⚙ configure on a line saved BEFORE the top plate existed (no `top` key) opens on the standard 1.5 mm with no "reset" notice, and Update keeps the price and states the 1.5 mm top', () => {
    const b = builder();
    const { line } = makeLine(b, sinkState({ qty: 1 }));
    const { top, ...old } = line.config;
    assert.equal(top, 1.5);
    const oldLine = { ...line, config: old, _uid: 'z' };
    b.run(`items.length = 0; items.push(${JSON.stringify(oldLine)});`);
    b.run('configureLine(0)');
    assert.equal(b.run('cfgState.config.top'), 1.5);
    assert.equal(b.el('cfgNotice').textContent, '', 'a missing staff-only key is the default, not a saved option that went away');
    assert.equal(b.el('cfgNotice').style.display, 'none');
    assert.match(b.el('cfgBody').innerHTML, new RegExp(`data-cfg-v="1\\.5" data-cfg-key="g${gAt('sink', 'top')}o0" aria-pressed="true"`));
    b.run('cfgCommit()');
    const it = b.plain('items[0]');
    assert.equal(it.config.top, 1.5);
    assert.equal(it.unitPrice, line.unitPrice, 'the standard top is the zero point: re-saving an old line does not move its price');
    assert.equal(it.specs.at(-1).label, 'Construction');
    assert.match(it.specs.at(-1).value, /1\.5 mm \(16 ga\) top plate/);
  });

  it('a line (or a draft, or a request line) saved BEFORE the top plate existed loads and prices like the standard 1.5 mm line: its runtime figures say "priced", never "no amount for Top plate"', () => {
    const b = builder();
    const { line } = makeLine(b, sinkState({ qty: 1 }));
    const { top, ...old } = line.config;
    assert.equal(top, 1.5);
    b.run(`items.length = 0; items.push(${JSON.stringify({ ...line, config: old, _uid: 'z' })}); normalizeLoadedItems(items);`);
    const cfg = b.plain('items[0]._cfg');
    assert.equal(cfg.priced, true, `an absent staff-only key is the default: ${cfg.reason}`);
    assert.deepEqual(cfg.missing, []);
    assert.equal(cfg.livePrice, line.unitPrice, 'the same figure the explicit 1.5 mm configuration prices at');
    assert.equal(b.run('items[0].priceBasis'), 'website');
    assert.equal(b.run('items[0].unitPrice'), line.unitPrice, 'loading never moves a price');
  });

  it('re-configuring a website-priced line into 1.2 mm with no cell: it becomes manual + "needs a price" at 0 (R3), its printed specs are rewritten to the lighter top, and a typed price sticks', () => {
    const b = builder();
    b.run(`delete FAMILY_PRICING.sink.options.top`);
    const { line } = makeLine(b, sinkState({ qty: 1 }));
    b.run(`items.length = 0; items.push(${JSON.stringify({ ...line, _uid: 'z' })}); items[0]._cfg = cfgCompute(items[0]);`);
    assert.equal(b.run('items[0].priceBasis'), 'website');
    b.run('configureLine(0)');
    pickTop(b, 'sink', 1.2);
    b.run('cfgCommit()');
    let it = b.plain('items[0]');
    assert.deepEqual([it.priceBasis, it.unitPrice, it.needsPrice], ['manual', 0, true]);
    assert.equal(it.config.top, 1.2);
    assert.equal(it.specs.at(-1).value, SINK_CONSTRUCTION('1.2 mm top plate (lighter)'));
    assert.match(b.run('cfgReasonText(items[0]._cfg)'), /No amount entered yet for: Top plate: 1\.2 mm\./);
    assert.match(b.run('cfgLineRowHtml(items[0], 0)'), /No amount entered yet for: Top plate: 1\.2 mm\./);
    b.run('configureLine(0)');
    assert.equal(b.run('cfgState.config.top'), 1.2, 'a saved 1.2 mm line re-opens on 1.2 mm (a public-mode validation would reset it to the standard top)');
    assert.equal(b.el('cfgNotice').textContent, '', 'and without a "reset to the default" notice');
    b.run(`cfgManualInput({ value: '36500' }); cfgCommit()`);
    it = b.plain('items[0]');
    assert.deepEqual([it.priceBasis, it.unitPrice, it.priceManual], ['manual', 36500, true]);
    assert.equal(it.needsPrice, undefined);
  });

  it('"configure instead" (an absorbed SKU) opens on the standard top with no notice — a catalogue model never states a top plate', () => {
    const b = builder();
    b.run(`selectedProduct = DB.products.find(p => p.id === 'PW-006'); dimsMm = { W: 1450, D: 500, H: 850 };`);
    b.run(`configureInstead('PW-006')`);
    assert.equal(b.run('cfgState.config.top'), 1.5);
    assert.equal(b.el('cfgNotice').textContent, '');
    // a prep table (BA-001 is the one SKU with a "Top Gauge" spec of its own) likewise
    b.run(`selectedProduct = null; configureInstead('BA-001')`);
    assert.equal(b.run('cfgState.familyId'), 'prep_table');
    assert.equal(b.run('cfgState.config.top'), 1.5);
    assert.equal(b.el('cfgNotice').textContent, '');
  });

  it('a stove and a prep table price their 1.2 mm top from their own cell too (the cell is per family)', () => {
    for (const id of ['prep_table', 'stove']) {
      const b = builder();
      b.run(`delete FAMILY_PRICING[${JSON.stringify(id)}].options.top`);
      open(b, id);
      const standard = b.plain('cfgEvaluate(cfgState).basis').unitPrice;
      pickTop(b, id, 1.2);
      assert.deepEqual(b.plain('cfgEvaluate(cfgState).basis').missing, ['Top plate: 1.2 mm'], id);
      b.run(`FAMILY_PRICING[${JSON.stringify(id)}].options.top = { '1.2': { flat: -777, perW100: null } }; cfgRefresh();`);
      assert.equal(b.plain('cfgEvaluate(cfgState).basis').unitPrice, standard - 777, id);
    }
  });
});

// ── owner-suggested default: a configured line is never a supplier resale, so the ⇄ PT opt-in is not offered on it ─────────────────────
describe('WS-5C — the ⇄ pass-through chip is hidden on configured lines (plain lines unchanged)', () => {
  const paint = (b, lines) => {
    b.run(`items.length = 0; items.push(...${JSON.stringify(lines)}); items.forEach(i => { if (i.familyId) i._cfg = cfgCompute(i); }); currentView = 'internal'; computeMarginSummary();`);
    return b.el('marginTbl').innerHTML;
  };
  const rowOf = (html, name) => (html.split('<tr>').find((r) => r.includes('>' + name)) || html.split('<tr>').find((r) => r.includes(name)) || '');
  const fryer = { id: 'CE-030', category: 'cooking_line', name: 'Salamander', qty: 1, unit: 'pc', unitPrice: 21911, amount: 21911, _uid: 'f' };
  const sink = (b, over = {}) => ({ ...makeLine(b, sinkState({ qty: 1 })).line, _uid: 's', ...over });

  it('a configured line has no PT chip; a plain line beside it keeps its chip and its handler', () => {
    const b = builder();
    const html = paint(b, [sink(b), fryer]);
    assert.ok(html.includes('togglePassThrough(1)'), 'the plain Salamander row keeps its ⇄ PT chip');
    assert.equal(html.includes('togglePassThrough(0)'), false, 'the configured Sink row has none');
    assert.ok(rowOf(html, 'Salamander').includes('⇄ PT'));
    assert.equal(rowOf(html, 'Sink').includes('⇄'), false);
    assert.ok(rowOf(html, 'Sink').includes('cost from') || rowOf(html, 'Sink').includes('cost ≈'), 'the row is still the configured line\'s (its cost chip)');
  });

  it('a configured line that ALREADY carries the flag (converted from a pass-through line, or loaded from an older quote) keeps its chip, so the flag can still be cleared', () => {
    const b = builder();
    const html = paint(b, [sink(b, { passThrough: true }), fryer]);
    assert.ok(html.includes('togglePassThrough(0)'), 'a flagged configured line must keep the control that clears the flag');
    assert.ok(rowOf(html, 'Sink').includes('⇄ pass-through'));
    b.run('togglePassThrough(0)');
    assert.equal(b.run('items[0].passThrough'), undefined, 'and it works');
    assert.equal(b.run('items[0].priceBasis'), 'website', 'a configured line keeps its price basis through it');
  });

  it('a plain flagged line shows its chip as before, and a plain line beside a configured one is untouched', () => {
    const b = builder();
    const html = paint(b, [{ ...fryer, passThrough: true }, sink(b)]);
    assert.ok(html.includes('togglePassThrough(0)') && rowOf(html, 'Salamander').includes('⇄ pass-through'));
    assert.equal(html.includes('togglePassThrough(1)'), false);
  });
});

// ── the SECTION a configured line sits in (QBConfigured does the normal case; the builder does the two it cannot) ────────────────────────────
describe('WS-5C — the builder section of a configured line: the base product\'s own, with the builder\'s fallbacks and the hand-off re-homing', () => {
  const REF = 'QR-261021-K7M2PX';
  const sinkRow = (over = {}) => ({ n: 1, id: 'PW-004', cat: 'washing', name: 'Sink', qty: 1, unit: 'pc', familyId: 'sink', config: { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'prerinse', top: 1.5 },
    size: { W: 1800, D: 700, H: 900 }, specs: [], ...over });
  const handoff = (b, rows) => {
    const items = rows.map((r, i) => QB.fromRequestItem(r, { n: i + 1, priced: true, unitPrice: 41300 }, REF));
    b.run(`loadEditableState(${JSON.stringify({ currentCo: 'BK', handoff: true, items })})`);
    return b.plain('items.map(i => i.category)');
  };

  it('a new line takes its base product\'s category (QBConfigured.buildLine); with no base product loaded the builder uses a model the family absorbed, else Miscellaneous — never the public "washing"', () => {
    const b = builder();
    assert.equal(makeLine(b, sinkState()).line.category, 'prep_washing');
    assert.equal(makeLine(b, stateFor('stove', {})).line.category, 'cooking_line');
    b.run(`DB.products = DB.products.filter(p => p.id !== 'PW-004')`);       // the family's base product is not in the catalogue…
    assert.equal(makeLine(b, sinkState()).line.category, 'prep_washing', '…so an absorbed model\'s section is used');
    b.run(`DB.products = []`);
    assert.equal(makeLine(b, sinkState()).line.category, 'miscellaneous', 'nothing at all in the catalogue: Miscellaneous, not the public category');
  });

  it('convert: the line KEEPS the section it sits in (a baking line stays in baking); one with no section takes its base product\'s; with no base product either, an absorbed model\'s, else Miscellaneous', () => {
    const b = builder();
    const plain = { id: 'PW-006', name: 'Sink', dims: '', specs: [], qty: 1, unit: 'pc', unitPrice: 19300, amount: 19300, priceManual: true };
    assert.equal(b.plain(`cfgConvertLine(${JSON.stringify({ ...plain, category: 'baking' })})`).category, 'baking');
    assert.equal(b.plain(`cfgConvertLine(${JSON.stringify({ ...plain, category: 'sec_1', catLabel: 'Option A' })})`).category, 'sec_1');
    assert.equal(b.plain(`cfgConvertLine(${JSON.stringify(plain)})`).category, 'prep_washing', 'no section of its own: the base product\'s, from the catalogue');
    b.run(`DB.products = DB.products.filter(p => p.id !== 'PW-004')`);
    assert.equal(b.plain(`cfgConvertLine(${JSON.stringify(plain)})`).category, 'prep_washing', 'no base product: a model the family absorbed');
    b.run(`DB.products = []`);
    assert.equal(b.plain(`cfgConvertLine(${JSON.stringify(plain)})`).category, 'miscellaneous');
    assert.equal(b.plain(`cfgConvertLine(${JSON.stringify({ ...plain, category: 'baking' })})`).category, 'baking', 'a line that has a section never moves, whatever the catalogue holds');
  });

  it('a website hand-off line arrives with the request\'s PUBLIC category ("washing") and is moved into its base product\'s section; the fixed line beside it is untouched', () => {
    const b = builder();
    const cats = handoff(b, [sinkRow(), sinkRow({ n: 2, id: 'PW-010', cat: 'storage', name: 'Rack', familyId: 'rack', config: { tiers: 3, wheels: true }, size: { W: 1200, D: 500, H: 1600 } }),
      { n: 3, id: 'CE-030', cat: 'cooking_line', name: 'Salamander', qty: 1, unit: 'pc', specs: [] }]);
    assert.deepEqual(cats, ['prep_washing', 'prep_washing', 'cooking_line']);
    assert.equal(QB.fromRequestItem(sinkRow(), { n: 1, priced: true, unitPrice: 41300 }, REF).category, 'washing', 'premise: fromRequestItem still emits the public category');
  });

  it('only ever out of the public category itself: a section the preparer made, a builder section, Miscellaneous, or a section the database also knows by that name is left alone', () => {
    const b = builder();
    const row = (category) => QB.fromRequestItem(sinkRow(), { n: 1, priced: true, unitPrice: 41300 }, REF) && { ...QB.fromRequestItem(sinkRow(), { n: 1, priced: true, unitPrice: 41300 }, REF), category };
    const load = (cats) => { b.run(`loadEditableState(${JSON.stringify({ currentCo: 'BK', items: cats.map(row) })})`); return b.plain('items.map(i => i.category)'); };
    assert.deepEqual(load(['sec_1', 'cooking_line', 'miscellaneous', 'prep_washing', 'baking']), ['sec_1', 'cooking_line', 'miscellaneous', 'prep_washing', 'baking']);
    b.run(`DB.categories.push({ id: 'washing', label: 'Washing' })`);       // the database has a section of that very name
    assert.deepEqual(load(['washing']), ['washing']);
  });

  it('a hand-off that loads BEFORE the catalogue arrives is re-homed when the database does (initUI → cfgRefreshAll); nothing is invented while there is no base product to name', () => {
    const b = builder();
    b.run(`globalThis.__db = DB.products; DB.products = [];`);
    assert.deepEqual(handoff(b, [sinkRow()]), ['washing'], 'no catalogue yet: left as it came');
    b.run(`DB.products = __db; cfgRefreshAll();`);
    assert.deepEqual(b.plain('items.map(i => i.category)'), ['prep_washing']);
    assert.ok(b.plain('items[0]._cfg.pricedSize'), 'and its runtime figures came with it');
  });
});

// ═══════════════════════════════════════ CONFIGURATOR-FAMILIES-2-SPEC WS-4 — five more families in the builder ═══════════════════════════════════════
// Dish table, wok range, griddle / griller / fryer, gas deck oven, range hood (families 3, 5, 6, 7, 8 of the eleven). Nothing in the builder is written per family: the panel walks the
// definitions, so what this block pins is the two generic additions (a choice that applies only for some values of an earlier one — `when`; an option that caps a size — `maxDimWhen`),
// the per-product kill switch (productMeta/config.families.disabled) and that every new family goes through the SAME pipeline: chips, panel, price, Add, ⚙ configure, convert, hints.
describe('FAMILIES-2 — conditional options in the panel: only the groups that apply are drawn, and a choice that stops applying goes back to its default', () => {
  const gIdx = (id, key) => FAM.families[id].groups.findIndex((g) => g.key === key);
  const oIdx = (id, key, v) => FAM.families[id].groups[gIdx(id, key)].options.findIndex((o) => o.v === v);
  const open = (b, id, opts = {}) => { b.run(`openConfigurator(${JSON.stringify(id)}, ${JSON.stringify(opts)})`); };
  const pickV = (b, id, key, v) => b.run(`cfgPickOpt(${gIdx(id, key)}, ${oIdx(id, key, v)})`);
  const groupsShown = (b) => [...b.el('cfgBody').innerHTML.matchAll(/<div class="cfg-lbl" id="cfgL\d+">([^<]*)/g)].map((m) => m[1].trim());
  const basisOf = (b) => b.plain('cfgEvaluate(cfgState).basis');

  it('a cooking line draws Burners for a griddle or a griller, Fry baskets for a fryer, and neither for a griller + griddle — Type and Base always', () => {
    const b = builder();
    open(b, 'cooking_line');
    assert.deepEqual(groupsShown(b), ['Material', 'Type', 'Burners', 'Base'], 'the default is a griddle: no fry baskets');
    assert.equal(b.el('cfgBody').innerHTML.includes('data-cfg-group="baskets"'), false);
    pickV(b, 'cooking_line', 'type', 'fryer');
    assert.deepEqual(groupsShown(b), ['Material', 'Type', 'Fry baskets', 'Base']);
    assert.equal(b.el('cfgBody').innerHTML.includes('data-cfg-group="burners"'), false, 'no burner choice on a fryer');
    assert.ok(b.el('cfgBody').innerHTML.includes('data-cfg-group="baskets" data-cfg-v="3"'));
    pickV(b, 'cooking_line', 'type', 'griller');
    assert.deepEqual(groupsShown(b), ['Material', 'Type', 'Burners', 'Base']);
    pickV(b, 'cooking_line', 'type', 'combi');
    assert.deepEqual(groupsShown(b), ['Material', 'Type', 'Base'], 'a griller + griddle has one burner under each side: nothing to choose');
  });

  it('a dish table draws the pre-rinse sink only on the soiled side; the Top plate keeps its staff chip and stays last', () => {
    const b = builder();
    open(b, 'dish_table');
    assert.deepEqual(groupsShown(b), ['Material', 'Side', 'Dishwasher on the', 'Undershelf', 'Top plate'], 'the clean side: no sink to choose');
    pickV(b, 'dish_table', 'side', 'soiled');
    assert.deepEqual(groupsShown(b), ['Material', 'Side', 'Dishwasher on the', 'Pre-rinse sink', 'Undershelf', 'Top plate']);
    assert.ok(b.el('cfgBody').innerHTML.includes('<span class="cfg-staff-chip no-print" title="Not offered on the website">staff</span>'));
  });

  it('a group keeps its index in the definition as its id and in its handlers, whichever groups are showing (pick by index still picks the right group)', () => {
    const b = builder();
    open(b, 'cooking_line');
    const bi = gIdx('cooking_line', 'baskets'), ti = gIdx('cooking_line', 'type');
    pickV(b, 'cooking_line', 'type', 'fryer');
    const html = b.el('cfgBody').innerHTML;
    assert.ok(html.includes(`<div class="cfg-lbl" id="cfgL${bi}">Fry baskets</div>`), 'the label id is the index in fam.groups (2), not its position among the groups showing (1)');
    assert.ok(html.includes(`onclick="cfgPickOpt(${bi},2)"`) && html.includes(`onclick="cfgPickOpt(${ti},0)"`));
    b.run(`cfgPickOpt(${bi}, 2)`);
    assert.equal(b.run('cfgState.config.baskets'), 3);
    assert.equal(b.run('cfgState.config.type'), 'fryer');
  });

  it('a choice that stops applying is back at its default in the panel\'s own state — and the panel never calls that an error', () => {
    const b = builder();
    open(b, 'cooking_line');
    pickV(b, 'cooking_line', 'type', 'fryer');
    pickV(b, 'cooking_line', 'baskets', 3);
    assert.equal(b.run('cfgState.config.baskets'), 3);
    assert.equal(b.run('cfgState.sizeRaw.W'), '1000', 'three baskets lift an untouched length to the minimum');
    pickV(b, 'cooking_line', 'type', 'griddle');
    assert.deepEqual(b.plain('cfgState.config'), { grade: 304, type: 'griddle', burners: 1, baskets: 2, base: 'stand' }, 'baskets are back at the default 2');
    assert.equal(b.el('cfgErrAll').style.display, 'none', 'no "applies only when" box');
    assert.equal(b.el('cfgAddBtn').disabled, false);
    assert.equal(b.run('cfgState.sizeRaw.W'), '700', 'and the untouched length followed the options back');
    // the validator itself calls a non-default value of an option that does not apply an error (that is what the website and the server do with it) — the panel snaps first
    assert.equal(PF.validateLine(FAM.families.cooking_line, { type: 'griddle', burners: 1, baskets: 3, base: 'stand' }, { W: 700, D: 700 }, { staff: true }).ok, false, 'premise');
    b.run(`cfgState.config.baskets = 3`);
    const ev = b.plain('cfgEvaluate(cfgState)');
    assert.equal(ev.v.ok, true);
    assert.equal(ev.v.config.baskets, 2);
    assert.equal(b.run('cfgState.config.baskets'), 2, 'cfgEvaluate wrote the canonical configuration back');
  });

  it('dish table: the pre-rinse sink forces a length of at least 1200 only while it applies; going back to the clean side drops the sink, its minimum and its price', () => {
    const b = builder();
    open(b, 'dish_table');
    const plainPrice = basisOf(b).unitPrice;
    pickV(b, 'dish_table', 'side', 'soiled');
    pickV(b, 'dish_table', 'sink', 'prerinse');
    assert.equal(b.run('cfgState.config.sink'), 'prerinse');
    assert.ok(basisOf(b).deltas.some((d) => d.key === 'sink:prerinse') && basisOf(b).deltas.some((d) => d.key === 'side:soiled'));
    assert.match(b.el('cfgDH_W').innerHTML, /minimum 1200 mm with these options/);
    b.run(`cfgDimInput('W', { value: '1000' })`);                                       // typed by hand (so no longer following the options)
    assert.equal(b.el('cfgAddBtn').disabled, true);
    assert.match(b.el('cfgErr_W').innerHTML, /With these options the length must be at least 1200 mm\./);
    pickV(b, 'dish_table', 'side', 'clean');
    assert.equal(b.run('cfgState.config.sink'), 'none');
    assert.doesNotMatch(b.el('cfgDH_W').innerHTML, /minimum 1200/);
    assert.equal(b.el('cfgErr_W').innerHTML, '', 'the forced minimum went with the sink');
    assert.equal(b.el('cfgAddBtn').disabled, false);
    pickV(b, 'dish_table', 'side', 'soiled');
    assert.equal(b.run('cfgState.config.sink'), 'none', 'it does not come back by itself');
    b.run(`cfgState.sizeRaw.W = '1200'; cfgState.touched.W = false; cfgAfterConfigChange()`);
    pickV(b, 'dish_table', 'side', 'clean');
    assert.equal(basisOf(b).unitPrice, plainPrice, 'a clean-side table at the usual length is priced like the plain one again');
    assert.deepEqual(basisOf(b).deltas, [], 'no cell left over from the soiled side');
  });

  it('what is added to the quote is canonical: an option that does not apply is at its default, has no spec row and no price cell (a griddle that was a fryer with 3 baskets for a moment)', () => {
    const b = builder();
    open(b, 'cooking_line');
    pickV(b, 'cooking_line', 'type', 'fryer');
    pickV(b, 'cooking_line', 'baskets', 3);
    pickV(b, 'cooking_line', 'type', 'griddle');
    pickV(b, 'cooking_line', 'burners', 2);
    const priced = basisOf(b);
    assert.deepEqual(priced.deltas.map((d) => d.key).sort(), ['burners:2'], 'one cell: the burners — no fryer, no baskets');
    b.run('cfgCommit()');
    const it = b.plain('items[0]');
    assert.deepEqual(it.config, { grade: 304, type: 'griddle', burners: 2, baskets: 2, base: 'stand' });
    assert.deepEqual(it.specs.map((r) => r.label).filter((l) => l !== 'Construction'), ['Material', 'Type', 'Burners', 'Base'], 'no "Fry baskets" row on the printed quote');
    assert.equal(it.specStr.includes('basket'), false);
    // the same line made without the detour prices the same, to the peso
    const fresh = builder();
    open(fresh, 'cooking_line');
    pickV(fresh, 'cooking_line', 'burners', 2);
    assert.equal(basisOf(fresh).unitPrice, priced.unitPrice);
    assert.equal(it.unitPrice, priced.unitPrice);
    // ⚙ configure on it opens with only the groups that apply
    b.run('configureLine(0)');
    assert.deepEqual(groupsShown(b), ['Material', 'Type', 'Burners', 'Base']);
  });

  it('a saved line that states a value for an option that does not apply opens with the visible "reset" notice and that option at its default', () => {
    const b = builder();
    open(b, 'cooking_line', { config: { type: 'griddle', burners: 1, baskets: 3, base: 'stand' }, dims: { W: 700, D: 700 } });
    assert.match(b.el('cfgNotice').textContent, /no longer available/);
    assert.equal(b.run('cfgState.config.baskets'), 2);
    assert.deepEqual(groupsShown(b), ['Material', 'Type', 'Burners', 'Base']);
    // a canonical line opens with no notice
    open(b, 'cooking_line', { config: { type: 'fryer', burners: 1, baskets: 3, base: 'stand' }, dims: { W: 1000, D: 700 } });
    assert.equal(b.el('cfgNotice').textContent, '');
    assert.deepEqual(groupsShown(b), ['Material', 'Type', 'Fry baskets', 'Base']);
  });
});

describe('FAMILIES-2 — a size an option caps: the hood\'s depth and the deck oven\'s width (input max, hint, "Use N mm", routed under the box)', () => {
  const gIdx = (id, key) => FAM.families[id].groups.findIndex((g) => g.key === key);
  const oIdx = (id, key, v) => FAM.families[id].groups[gIdx(id, key)].options.findIndex((o) => o.v === v);
  const open = (b, id, opts = {}) => { b.run(`openConfigurator(${JSON.stringify(id)}, ${JSON.stringify(opts)})`); };
  const pickV = (b, id, key, v) => b.run(`cfgPickOpt(${gIdx(id, key)}, ${oIdx(id, key, v)})`);
  const dim = (b, k, v) => { b.el('cfgDim_' + k).value = String(v); b.run(`cfgDimInput('${k}', document.getElementById('cfgDim_${k}'))`); };

  it('cfgSplitErrors routes "must be at most" (and "must be at least") to the axis it is about — never into the general box; anything else is general', () => {
    const b = builder();
    const split = (fid, errors) => b.plain(`cfgSplitErrors(cfgFamily(${JSON.stringify(fid)}), ${JSON.stringify(errors)})`);
    const max = 'With these options the depth must be at most 500 mm.';
    const min = 'With these options the length must be at least 1200 mm.';
    assert.deepEqual(split('hood', [max]), { byDim: { D: [max] }, general: [] });
    assert.deepEqual(split('hood', [min, max]), { byDim: { W: [min], D: [max] }, general: [] });
    assert.deepEqual(split('deck_oven', ['With these options the width must be at most 1200 mm.']).byDim, { W: ['With these options the width must be at most 1200 mm.'] });
    const other = '"Fry baskets" applies only when Type is Fryer.';
    assert.deepEqual(split('hood', [other, max]), { byDim: { D: [max] }, general: [other] });
    assert.deepEqual(split('hood', ['With these options the height must be at most 500 mm.']).general, ['With these options the height must be at most 500 mm.'], 'an axis the family does not have is not an axis');
  });

  it('a slim hood is at most 500 mm deep: an untouched depth follows (900 → 500), the input is capped, the hint says so; typing 600 is refused under the box with a Use 500 mm button', () => {
    const b = builder();
    open(b, 'hood');
    assert.equal(b.run('cfgState.sizeRaw.D'), '900');
    assert.equal(b.el('cfgDim_D').max, '1500');
    assert.doesNotMatch(b.el('cfgDH_D').innerHTML, /maximum/);
    pickV(b, 'hood', 'type', 'slim');
    assert.equal(b.run('cfgState.sizeRaw.D'), '500', 'the untouched depth follows the type');
    assert.equal(b.el('cfgDim_D').max, '500');
    assert.match(b.el('cfgDH_D').innerHTML, /300–1500 mm, steps of 10 · maximum 500 mm with these options/);
    assert.equal(b.el('cfgAddBtn').disabled, false);
    dim(b, 'D', 600);
    assert.equal(b.el('cfgAddBtn').disabled, true);
    assert.match(b.el('cfgErr_D').innerHTML, /With these options the depth must be at most 500 mm\./);
    assert.match(b.el('cfgErr_D').innerHTML, /cfgUseMax\('D',500\)[^>]*>Use 500 mm/);
    assert.equal(b.el('cfgErrAll').style.display, 'none', 'it is under the depth box, not in the general one');
    assert.equal(b.el('cfgDim_D').classList.contains('cfg-bad'), true);
    assert.match(b.el('cfgPriceArea').innerHTML, /Fix the highlighted fields/);
    b.run(`cfgUseMax('D', 500)`);
    assert.equal(b.el('cfgAddBtn').disabled, false);
    assert.equal(b.el('cfgErr_D').innerHTML, '');
    assert.match(b.el('cfgPriceArea').innerHTML, /website basis/);
    // the cap goes with the type
    pickV(b, 'hood', 'type', 'wall');
    assert.equal(b.el('cfgDim_D').max, '1500');
    assert.equal(b.el('cfgDim_D').min, '500', 'a wall canopy is at least 500 mm deep');
    assert.match(b.el('cfgDH_D').innerHTML, /minimum 500 mm with these options/);
    assert.doesNotMatch(b.el('cfgDH_D').innerHTML, /maximum/);
    // an island canopy: at least 1200 long and 700 deep
    pickV(b, 'hood', 'type', 'island');
    assert.equal(b.el('cfgDim_W').min, '1200');
    assert.equal(b.el('cfgDim_D').min, '700');
  });

  it('a deck oven\'s width follows its trays: 700 for three, 1200 for six — the input is pinned, the hint says "fixed", a wrong width is refused with a Use button, a typed width that fits is kept', () => {
    const b = builder();
    open(b, 'deck_oven');
    assert.equal(b.run('cfgState.sizeRaw.W'), '700');
    assert.equal(b.el('cfgDim_W').min, '700');
    assert.equal(b.el('cfgDim_W').max, '700');
    assert.match(b.el('cfgDH_W').innerHTML, /fixed at 700 mm by these options/);
    pickV(b, 'deck_oven', 'trays', 6);
    assert.equal(b.run('cfgState.sizeRaw.W'), '1200', 'an untouched width follows the trays');
    assert.equal(b.el('cfgDim_W').min, '1200');
    assert.equal(b.el('cfgDim_W').max, '1200');
    assert.match(b.el('cfgDH_W').innerHTML, /fixed at 1200 mm by these options/);
    assert.equal(b.el('cfgAddBtn').disabled, false);
    dim(b, 'W', 1300);
    assert.equal(b.el('cfgAddBtn').disabled, true);
    assert.match(b.el('cfgErr_W').innerHTML, /With these options the width must be at most 1200 mm\./);
    assert.match(b.el('cfgErr_W').innerHTML, /cfgUseMax\('W',1200\)[^>]*>Use 1200 mm/);
    dim(b, 'W', 1100);
    assert.match(b.el('cfgErr_W').innerHTML, /With these options the width must be at least 1200 mm\./);
    assert.match(b.el('cfgErr_W').innerHTML, /cfgUseMin\('W',1200\)[^>]*>Use 1200 mm/);
    b.run(`cfgUseMin('W', 1200)`);
    assert.equal(b.el('cfgAddBtn').disabled, false);
    // back to three trays with the width typed by hand: the typed 1200 is now above the cap
    pickV(b, 'deck_oven', 'trays', 3);
    assert.equal(b.run('cfgState.sizeRaw.W'), '1200', 'a length typed by hand stays where it was put…');
    assert.equal(b.el('cfgAddBtn').disabled, true, '…and is refused when the new options cap it');
    assert.match(b.el('cfgErr_W').innerHTML, /must be at most 700 mm/);
    b.run(`cfgUseMax('W', 700)`);
    assert.equal(b.el('cfgAddBtn').disabled, false);
  });

  it('a hood\'s other size limits are the axis limits: a depth under the type\'s minimum is refused the same way, and the input min follows the options', () => {
    const b = builder();
    open(b, 'hood');
    dim(b, 'D', 400);                                           // a wall canopy is at least 500 mm deep
    assert.equal(b.el('cfgAddBtn').disabled, true);
    assert.match(b.el('cfgErr_D').innerHTML, /With these options the depth must be at least 500 mm\./);
    assert.match(b.el('cfgErr_D').innerHTML, /Use 500 mm/);
    pickV(b, 'hood', 'type', 'slim');                           // …a slim one may be shallower
    assert.equal(b.el('cfgAddBtn').disabled, false);
    assert.equal(b.el('cfgDim_D').min, '300');
  });
});

describe('FAMILIES-2 — the five new families go through the same pipeline: chips, price, Add to Quote, ⚙ configure, "Priced after review"', () => {
  const NEW = ['dish_table', 'wok_range', 'cooking_line', 'deck_oven', 'hood'];
  const gIdx = (id, key) => FAM.families[id].groups.findIndex((g) => g.key === key);
  const oIdx = (id, key, v) => FAM.families[id].groups[gIdx(id, key)].options.findIndex((o) => o.v === v);
  const open = (b, id, opts = {}) => { b.run(`openConfigurator(${JSON.stringify(id)}, ${JSON.stringify(opts)})`); };
  const pickV = (b, id, key, v) => b.run(`cfgPickOpt(${gIdx(id, key)}, ${oIdx(id, key, v)})`);
  const SECTION = { dish_table: 'prep_washing', wok_range: 'cooking_line', cooking_line: 'cooking_line', deck_oven: 'cooking_line', hood: 'exhaust_system' };

  it('the definitions are the eleven, in the website\'s order — and the builder\'s one chip per family carries each label and its one-line description', () => {
    assert.deepEqual(FAM.order, ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range', 'cooking_line', 'deck_oven', 'hood', 'cabinet', 'wall_shelf', 'rack']);
    const b = builder();
    b.run('renderCfgChips()');
    const html = b.el('cfgChips').innerHTML;
    assert.deepEqual([...html.matchAll(/data-cfg-open="([a-z_]+)"/g)].map((m) => m[1]), FAM.order, 'one chip per family, in order');
    assert.equal((html.match(/cfg-chip-btn/g) || []).length, FAM.order.length);
    for (const [id, label] of [['dish_table', 'Dish table'], ['wok_range', 'Wok range'], ['cooking_line', 'Griddle, griller or fryer'], ['deck_oven', 'Gas deck oven'], ['hood', 'Range hood']]) {
      assert.ok(html.includes(`⚙ ${label}</button>`), `⚙ ${label}`);
      assert.ok(html.includes(`title="${FAM.families[id].description}"`), `${id}: the chip's title is its description`);
    }
  });

  it('on a phone the chip row is a two-column grid of 44 px targets (the longest label wraps), and nothing about it is printed', () => {
    const css = HTML.slice(HTML.indexOf('/* ── CONFIGURATOR'), HTML.indexOf('@media print{#configPanel'));
    assert.match(css, /@media\(max-width:768px\)\{[\s\S]*\.cfg-chips\{display:grid;grid-template-columns:1fr 1fr;gap:8px;\}/);
    assert.match(css, /\.cfg-chip-btn\{min-height:44px;/);
    assert.match(HTML, /class="cfg-chips no-print" id="cfgChips"/);
  });

  it('every new family, at its defaults, prices on the website basis, adds a configured line in its base product\'s section, and ⚙ configure re-opens it as an update (never a second line)', () => {
    for (const id of NEW) {
      const b = builder();
      const f = FAM.families[id];
      open(b, id);
      assert.match(b.el('cfgPriceArea').innerHTML, /website basis/, `${id}: priced`);
      assert.equal(b.el('cfgAddBtn').disabled, false, id);
      assert.ok(b.el('cfgTitle').innerHTML.includes(`Configure: <strong id="cfgTitleName">${PF.lineTitle(f, b.plain('cfgState.config'))}</strong>`), id);
      b.run('cfgCommit()');
      const it = b.plain('items[0]');
      assert.equal(b.run('items.length'), 1, id);
      assert.equal(it.familyId, id);
      assert.equal(it.id, f.primary, `${id}: the line carries the primary SKU`);
      assert.equal(it.category, SECTION[id], `${id}: the builder section is the base product's own, never the website's public category`);
      assert.equal(it.priceBasis, 'website');
      assert.ok(it.unitPrice > 0 && it.basisUnitPrice === it.unitPrice, id);
      assert.deepEqual(it.specs.map((r) => r.label), PF.describe(f, it.config).map((r) => r.label), `${id}: the printed rows are the options that apply, then the construction`);
      assert.equal(it.specs.at(-1).label, 'Construction');
      assert.equal(it.dims, PF.sizeTextLabelled(f, it.size), id);
      assert.deepEqual(it.config, PF.validateConfiguration(f, it.config, { staff: true }).config, `${id}: canonical`);
      assert.equal(b.run('cfgState'), null, 'the panel closed');
      b.run('configureLine(0)');
      assert.match(b.el('cfgTitle').innerHTML, /Edit:/);
      assert.equal(b.el('cfgAddBtn').textContent, '✔ Update line');
      b.run('cfgCommit()');
      assert.equal(b.run('items.length'), 1, `${id}: an update replaces, never appends`);
    }
  });

  it('the figure the panel shows is QBConfigured.priceLine\'s for every family, option and size it can reach (the builder never prices on its own) — conditional groups included', () => {
    const b = builder();
    const cases = [
      ['dish_table', { side: 'soiled', hand: 'right', sink: 'prerinse', undershelf: false, top: 1.2 }, { W: 1800, D: 660 }],
      ['wok_range', { holes: 3, rear: true, faucet: 'swan', top: 1.5 }, { W: 1900, D: 900 }],
      ['cooking_line', { type: 'fryer', burners: 1, baskets: 3, base: 'shelf' }, { W: 1100, D: 800 }],
      ['cooking_line', { type: 'griller', burners: 3, baskets: 2, base: 'stand' }, { W: 1300, D: 700 }],
      ['deck_oven', { decks: 3, trays: 6, stand: 'heavy' }, { W: 1200 }],
      ['hood', { type: 'slim', filters: 'none', lighting: false }, { W: 2400, D: 450 }],
    ];
    for (const [id, config, size] of cases) {
      const f = FAM.families[id];
      b.run(`globalThis.__st = ${JSON.stringify(stateFor(id, { config, sizeRaw: Object.fromEntries(Object.entries(size).map(([k, v]) => [k, String(v)]) ) }))}; globalThis.__ev = cfgEvaluate(__st);`);
      const ev = b.plain('__ev');
      assert.equal(ev.v.ok, true, `${id}: ${ev.v.errors.join('; ')}`);
      const primary = CATALOGUE.find((p) => p.id === f.primary);
      const direct = QB.priceLine({ PF, PC, FAM }, { family: f, primary, config: ev.v.config, size: ev.v.dims, sheet: SHEETS[id], constants: {} });
      assert.equal(ev.basis.priced, true, `${id}: priced`);
      assert.equal(ev.basis.unitPrice, direct.unitPrice, id);
      assert.deepEqual(ev.basis.deltas, direct.deltas, `${id}: the same cells`);
    }
  });

  it('a conditional group never reaches the price: a fryer prices its type and baskets and NO burner cell; a griddle its burners and NO basket cell; a griller + griddle neither', () => {
    const b = builder();
    const keys = (cfg, size) => { b.run(`globalThis.__st = ${JSON.stringify(stateFor('cooking_line', { config: cfg, sizeRaw: size }))}; globalThis.__ev = cfgEvaluate(__st);`); const ev = b.plain('__ev'); assert.equal(ev.v.ok, true, ev.v.errors.join('; ')); return ev.basis.deltas.map((d) => d.key).sort(); };
    assert.deepEqual(keys({ type: 'fryer', burners: 1, baskets: 3, base: 'stand' }, { W: '1000', D: '700' }), ['baskets:3', 'type:fryer']);
    assert.deepEqual(keys({ type: 'griddle', burners: 3, baskets: 2, base: 'stand' }, { W: '1200', D: '700' }), ['burners:3']);
    assert.deepEqual(keys({ type: 'combi', burners: 1, baskets: 2, base: 'shelf' }, { W: '900', D: '700' }), ['base:shelf', 'type:combi']);
  });

  it('deck oven: six trays at 1200 mm prices the six-tray cell and a length rate of 0 — priced; with the width rate blank it reads "Priced after review" for Size; three trays at 700 needs no width rate at all', () => {
    const b = builder();
    open(b, 'deck_oven');
    assert.match(b.el('cfgPriceArea').innerHTML, /website basis/, 'three trays, 700 mm: no length term at all');
    pickV(b, 'deck_oven', 'trays', 6);
    let ev = b.plain('cfgEvaluate(cfgState)');
    assert.equal(ev.v.dims.W, 1200);
    assert.equal(ev.basis.priced, true);
    assert.deepEqual(ev.basis.deltas.map((d) => d.key).sort(), ['size:W', 'trays:6']);
    assert.equal(ev.basis.deltas.find((d) => d.key === 'size:W').amount, 0, 'the width rate is 0: the width is a consequence of the trays');
    b.run(`FAMILY_PRICING.deck_oven.size.perW100 = null; cfgRefresh();`);
    ev = b.plain('cfgEvaluate(cfgState)');
    assert.equal(ev.basis.priced, false);
    assert.deepEqual(ev.basis.missing, ['Size']);
    assert.match(b.el('cfgPriceArea').innerHTML, /Priced after review/);
    assert.match(b.el('cfgPriceArea').innerHTML, /No amount entered yet for: Size\./);
    assert.notEqual(b.el('cfgManualWrap').style.display, 'none', 'a typed price is asked for');
  });

  it('no list price on the base product (the dish table\'s PW-029 today) reads "Priced after review — no list price", asks for a price, and a line left without one cannot be filed', () => {
    const b = builder();
    b.run(`DB.products.find(p => p.id === 'PW-029').basePrice = 0;`);
    open(b, 'dish_table');
    assert.match(b.el('cfgPriceArea').innerHTML, /Priced after review/);
    assert.match(b.el('cfgPriceArea').innerHTML, /The catalogue base item has no list price\./);
    assert.notEqual(b.el('cfgManualWrap').style.display, 'none');
    assert.equal(b.el('cfgAddBtn').disabled, false, 'Add stays enabled');
    b.run('cfgCommit()');
    let it = b.plain('items[0]');
    assert.deepEqual([it.priceBasis, it.unitPrice, it.needsPrice], ['manual', 0, true]);
    assert.match(b.run('needsPriceReason()'), /^1 configured line\(s\) have no price yet/);
    b.run('configureLine(0)');
    b.run(`cfgManualInput({ value: '28500' }); cfgCommit()`);
    it = b.plain('items[0]');
    assert.deepEqual([it.priceBasis, it.unitPrice, it.priceManual, it.needsPrice], ['manual', 28500, true, undefined]);
    assert.equal(b.run('needsPriceReason()'), '');
  });

  it('a blank cell of a new family is "Priced after review" for exactly that option, in the option\'s own words (a fryer, a hood without lighting)', () => {
    const b = builder();
    b.run(`FAMILY_PRICING.cooking_line.options.type.fryer.flat = null; FAMILY_PRICING.hood.options.lighting.false.flat = null;`);
    open(b, 'cooking_line');
    pickV(b, 'cooking_line', 'type', 'fryer');
    assert.match(b.el('cfgPriceArea').innerHTML, /No amount entered yet for: Type: Fryer\./);
    pickV(b, 'cooking_line', 'type', 'griller');
    assert.match(b.el('cfgPriceArea').innerHTML, /website basis/, 'the blank cell is not in use for a griller');
    open(b, 'hood');
    pickV(b, 'hood', 'lighting', false);
    assert.match(b.el('cfgPriceArea').innerHTML, /No amount entered yet for: Lighting: Without\./);
    pickV(b, 'hood', 'lighting', true);
    assert.match(b.el('cfgPriceArea').innerHTML, /website basis/);
  });

  it('the cost basis (§4.5) of a configured line of each new family is the nearest standard model it absorbed — a fryer with 3 baskets is CE-022, with 2 CE-009; a two-hole wok range with a rear burner CE-025 — never the primary\'s own cost', () => {
    const b = builder();
    b.run(`globalThis.__live = new Map(DB.products.map(p => [p.id, p]));`);
    const basisFor = (id, config, size) => { const { line } = makeLine(b, stateFor(id, { config, sizeRaw: Object.fromEntries(Object.entries(size).map(([k, v]) => [k, String(v)])) })); return b.plain(`itemCostBasis(${JSON.stringify(line)}, __live)`); };
    const cases = [
      ['cooking_line', { type: 'fryer', burners: 1, baskets: 3, base: 'stand' }, { W: 1000, D: 700 }, 'CE-022'],
      ['cooking_line', { type: 'fryer', burners: 1, baskets: 2, base: 'stand' }, { W: 700, D: 700 }, 'CE-009'],
      ['wok_range', { holes: 2, rear: true, faucet: 'none', top: 1.5 }, { W: 1200, D: 800 }, 'CE-025'],
      ['deck_oven', { decks: 2, trays: 6, stand: 'none' }, { W: 1200 }, 'CE-016'],
      ['hood', { type: 'island', filters: 'baffle', lighting: true }, { W: 1200, D: 900 }, 'EX-018'],
      ['dish_table', { side: 'clean', hand: 'left', sink: 'none', undershelf: true, top: 1.5 }, { W: 1200, D: 660 }, 'PW-029'],
    ];
    for (const [id, config, size, sku] of cases) {
      const basis = basisFor(id, config, size);
      assert.equal(basis.basisSku, sku, `${id} ${JSON.stringify(config)}`);
      assert.equal(basis.basisSku, QB.nearestAbsorbed(FAM.families[id], config).sku);
      assert.equal(basis.hasBasis, true, id);
      assert.ok(basis.mat > 0 && basis.scale > 0, id);
    }
  });

  it('every line the builder can hold for the five families survives save → reopen: familyId, config, size ride the payload; the runtime _cfg figures do not', () => {
    const b = builder();
    for (const id of NEW) { open(b, id); b.run('cfgCommit()'); }
    assert.equal(b.run('items.length'), 5);
    const pl = b.plain('buildQuotePayload()');
    assert.deepEqual(pl.items.map((i) => i.familyId), NEW);
    for (const row of pl.items) { assert.equal('_cfg' in row, false); assert.ok(row.config && row.size && row.specs.length); }
    // reopen: the lines load back as the same configured lines, with their runtime figures recomputed
    const again = builder();
    again.run(`loadEditableState(${JSON.stringify(pl.editableState)})`);
    assert.deepEqual(again.plain('items.map(i => i.familyId)'), NEW);
    assert.deepEqual(again.plain('items.map(i => i.config)'), pl.items.map((i) => i.config));
    assert.ok(again.plain('items.every(i => i._cfg && i._cfg.priced)'), 'the runtime figures came back');
  });
});

describe('FAMILIES-2 — a website hand-off of the five families (the request carries the family\'s PUBLIC category: washing, cooking, ventilation) loads as configured lines, re-homed into the base product\'s builder section', () => {
  const REF = 'QR-261021-K7M2PX';
  const rows = [
    { n: 1, id: 'PW-029', cat: 'washing', name: 'Dish table', qty: 1, unit: 'pc', familyId: 'dish_table', config: { side: 'soiled', hand: 'right', sink: 'prerinse', undershelf: true, top: 1.5 }, size: { W: 1800, D: 660 }, specs: [] },
    { n: 2, id: 'CE-006', cat: 'cooking', name: 'Wok range', qty: 2, unit: 'pc', familyId: 'wok_range', config: { holes: 2, rear: false, faucet: 'none', top: 1.5 }, size: { W: 1200, D: 700 }, specs: [] },
    { n: 3, id: 'CE-010', cat: 'cooking', name: 'Griddle, griller or fryer', qty: 1, unit: 'pc', familyId: 'cooking_line', config: { type: 'fryer', burners: 1, baskets: 3, base: 'stand' }, size: { W: 1000, D: 700 }, specs: [] },
    { n: 4, id: 'CE-012', cat: 'cooking', name: 'Gas deck oven', qty: 1, unit: 'pc', familyId: 'deck_oven', config: { decks: 2, trays: 6, stand: 'none' }, size: { W: 1200 }, specs: [] },
    { n: 5, id: 'EX-001', cat: 'ventilation', name: 'Range hood', qty: 1, unit: 'pc', familyId: 'hood', config: { type: 'slim', filters: 'baffle', lighting: true }, size: { W: 2400, D: 500 }, specs: [] },
  ];

  it('each arrives as a configured line of its family at the website price (priced rows) or manual + needs a price (the unpriced dish table), in its base product\'s section — and ⚙ configure opens it with only the groups that apply', () => {
    const b = builder();
    const items = rows.map((r, i) => QB.fromRequestItem(r, { n: i + 1, priced: r.familyId !== 'dish_table', unitPrice: r.familyId !== 'dish_table' ? 41300 + i : 0 }, REF));
    assert.deepEqual(items.map((x) => x.category), ['washing', 'cooking', 'cooking', 'cooking', 'ventilation'], 'premise: fromRequestItem emits the PUBLIC category');
    b.run(`loadEditableState(${JSON.stringify({ currentCo: 'BK', handoff: true, items })})`);
    assert.deepEqual(b.plain('items.map(i => i.familyId)'), ['dish_table', 'wok_range', 'cooking_line', 'deck_oven', 'hood']);
    assert.deepEqual(b.plain('items.map(i => i.category)'), ['prep_washing', 'cooking_line', 'cooking_line', 'cooking_line', 'exhaust_system']);
    assert.deepEqual(b.plain('items.map(i => i.priceBasis)'), ['manual', 'website', 'website', 'website', 'website']);
    assert.equal(b.run('items[0].needsPrice'), true, 'the dish table has no price (PW-029 is unpriced): typed, never guessed');
    assert.ok(b.plain('items.every(i => i._cfg && i._cfg.pricedSize)'));
    b.run('configureLine(2)');
    assert.equal(b.run('cfgState.familyId'), 'cooking_line');
    assert.equal(b.el('cfgNotice').textContent, '', 'a canonical request line opens with no "reset" notice');
    assert.deepEqual([...b.el('cfgBody').innerHTML.matchAll(/<div class="cfg-lbl" id="cfgL\d+">([^<]*)/g)].map((m) => m[1].trim()), ['Material', 'Type', 'Fry baskets', 'Base']);
    b.run('configureLine(4)');
    assert.equal(b.run('cfgState.sizeRaw.D'), '500');
    assert.equal(b.el('cfgDim_D').max, '500');
    assert.equal(b.el('cfgAddBtn').disabled, false);
  });
});

describe('FAMILIES-2 — convert an old line, "configure instead", "sold online as": the SKUs the five families absorbed (and the stove no longer does CE-006 / CE-025)', () => {
  const plain = (id, extra = {}) => ({ id, category: 'cooking_line', name: id, dims: '', specs: [], qty: 1, unit: 'pc', unitPrice: 12300, amount: 12300, priceManual: true, ...extra });
  const conv = (b, line) => b.plain(`cfgConvertLine(${JSON.stringify(line)})`);

  it('an old plain line of each absorbed SKU converts to its family\'s configuration of that SKU: the price is kept (manual), the section is kept', () => {
    const b = builder();
    const want = {
      'PW-029': ['dish_table', { grade: 304, side: 'clean', hand: 'left', sink: 'none', undershelf: true, top: 1.5 }],
      'CE-006': ['wok_range', { grade: 304, holes: 1, rear: false, faucet: 'none', top: 1.5 }],
      'CE-025': ['wok_range', { grade: 304, holes: 2, rear: true, faucet: 'none', top: 1.5 }],
      'CE-007': ['cooking_line', { grade: 304, type: 'combi', burners: 1, baskets: 2, base: 'stand' }],
      'CE-009': ['cooking_line', { grade: 304, type: 'fryer', burners: 1, baskets: 2, base: 'stand' }],
      'CE-020': ['cooking_line', { grade: 304, type: 'fryer', burners: 1, baskets: 1, base: 'stand' }],
      'CE-022': ['cooking_line', { grade: 304, type: 'fryer', burners: 1, baskets: 3, base: 'stand' }],
      'CE-023': ['cooking_line', { grade: 304, type: 'griddle', burners: 3, baskets: 2, base: 'stand' }],
      'CE-026': ['cooking_line', { grade: 304, type: 'griller', burners: 1, baskets: 2, base: 'shelf' }],
      'CE-012': ['deck_oven', { grade: 304, decks: 2, trays: 3, stand: 'none' }],
      'CE-016': ['deck_oven', { grade: 304, decks: 2, trays: 6, stand: 'none' }],
      'EX-018': ['hood', { grade: 304, type: 'island', filters: 'baffle', lighting: true }],
      'EX-020': ['hood', { grade: 304, type: 'slim', filters: 'baffle', lighting: true }],
      'EX-021': ['hood', { grade: 304, type: 'wall', filters: 'baffle', lighting: true }],
    };
    for (const [sku, [familyId, config]] of Object.entries(want)) {
      const c = conv(b, plain(sku, { category: 'baking' }));
      assert.equal(c.familyId, familyId, sku);
      assert.deepEqual(c.config, config, sku);
      assert.equal(c.id, FAM.families[familyId].primary, `${sku}: the line carries the family's primary SKU`);
      assert.equal(c.unitPrice, 12300, `${sku}: the price is kept`);
      assert.equal(c.priceBasis, 'manual');
      assert.equal(c.category, 'baking', `${sku}: the section it sits in is kept`);
    }
    assert.equal(conv(b, plain('CE-030')), null, 'the salamander stays a plain item');
    assert.equal(conv(b, plain('CE-008')).familyId, 'stove', 'a griller + griddle + burners range is still a stove');
  });

  it('the wok ranges left the stove family: "sold online as" says Wok range for CE-006 and CE-025, and a stove asking for a wok burner no longer finds CE-006', () => {
    const b = builder();
    assert.match(b.run(`cfgSoldOnlineHtml('CE-006')`), /Sold online as: Wok range \(configurable\)/);
    assert.match(b.run(`cfgSoldOnlineHtml('CE-025')`), /Sold online as: Wok range \(configurable\)/);
    assert.match(b.run(`cfgSoldOnlineHtml('EX-018')`), /Sold online as: Range hood \(configurable\)/);
    assert.match(b.run(`cfgSoldOnlineHtml('CE-016')`), /Sold online as: Gas deck oven \(configurable\)/);
    assert.match(b.run(`cfgSoldOnlineHtml('PW-029')`), /Sold online as: Dish table \(configurable\)/);
    assert.match(b.run(`cfgSoldOnlineHtml('CE-022')`), /Sold online as: Griddle, griller or fryer \(configurable\)/);
    assert.match(b.run(`cfgSoldOnlineHtml('CE-001')`), /Sold online as: Stove \(configurable\)/);
    assert.equal(b.run(`cfgSoldOnlineHtml('CE-030')`), '', 'a SKU no family absorbed gets no hint');
    assert.match(b.run(`cfgLineRowHtml(${JSON.stringify(plain('CE-006'))}, 2)`), /convertToConfigured\(2\)/);
    assert.equal(FAM.families.stove.absorbed['CE-006'], undefined);
    assert.equal(FAM.families.stove.absorbed['CE-025'], undefined);
  });

  it('"configure instead" opens each new family on its configuration of that SKU, carrying the size typed in the calculator (a deck oven\'s width is its trays\')', () => {
    const b = builder();
    b.run(`selectedProduct = DB.products.find(p => p.id === 'CE-016'); dimsMm = { W: 1200, D: 700, H: 1400 };`);
    b.run(`configureInstead('CE-016')`);
    assert.equal(b.run('cfgState.familyId'), 'deck_oven');
    assert.deepEqual(b.plain('cfgState.config'), { grade: 304, decks: 2, trays: 6, stand: 'none' });
    assert.equal(b.run('cfgState.sizeRaw.W'), '1200');
    assert.equal(b.el('cfgAddBtn').disabled, false);
    b.run(`selectedProduct = DB.products.find(p => p.id === 'EX-020'); dimsMm = { W: 1800, D: 305, H: 355 };`);
    b.run(`configureInstead('EX-020')`);
    assert.equal(b.run('cfgState.familyId'), 'hood');
    assert.equal(b.run('cfgState.config.type'), 'slim');
    assert.equal(b.run('cfgState.sizeRaw.W'), '1800');
    assert.equal(b.run('cfgState.sizeRaw.D'), '310', 'the typed 305 rounds up to the family\'s 10 mm step, inside the slim cap');
    assert.equal(b.el('cfgAddBtn').disabled, false);
    b.run(`configureInstead('CE-022')`);
    assert.equal(b.run('cfgState.familyId'), 'cooking_line');
    assert.deepEqual(groupsOf(b), ['Material', 'Type', 'Fry baskets', 'Base']);
    function groupsOf(env) { return [...env.el('cfgBody').innerHTML.matchAll(/<div class="cfg-lbl" id="cfgL\d+">([^<]*)/g)].map((m) => m[1].trim()); }
  });
});

describe('FAMILIES-2 §9 — one product switched off on its own (productMeta/config.families.disabled): no chip, no hint, no convert, no panel; its existing lines are read-only at their stored price', () => {
  const lineOf = (id, over = {}) => { const f = FAM.families[id]; const l = makeLine(builder(), stateFor(id)).line; return { ...l, _uid: 'u_' + id, ...over }; };

  it('the list is read beside the configurator switch, only a real list of strings counts, and a reload resets it', async () => {
    assert.match(HTML, /meta\.families && Array\.isArray\(meta\.families\.disabled\)/);
    const b = await bootDb({}, fakeDb({ meta: { families: { disabled: ['hood', 'cooking_line'] } } }));
    assert.deepEqual(b.plain('FAMILIES_DISABLED'), ['hood', 'cooking_line']);
    assert.equal(b.run('CONFIGURATOR_ON'), true, 'the whole configurator stays on');
    assert.equal(b.run('configuratorAvailable()'), true);
    assert.deepEqual(['hood', 'cooking_line', 'sink', 'rack'].map((id) => b.run(`familyEnabled(${JSON.stringify(id)})`)), [false, false, true, true]);
    assert.deepEqual(['hood', 'sink'].map((id) => b.run(`familyConfigurable(${JSON.stringify(id)})`)), [false, true]);
    // "Reload DB" with the product back on: the list is reset by the run, not kept from the last one
    const f2 = fakeDb({ meta: {} });
    b.ctx.db = f2.db;
    await b.run('loadDatabase()');
    assert.deepEqual(b.plain('FAMILIES_DISABLED'), []);
    // anything that is not a list leaves every product on; a list keeps only its strings
    for (const meta of [undefined, {}, { families: {} }, { families: { disabled: [] } }, { families: { disabled: 'hood' } }, { families: { disabled: { hood: true } } }, { families: 'hood' }, { families: null }, { families: { disabled: null } }, { quoteBuilder: { configurator: false } }]) {
      const x = await bootDb({}, fakeDb({ meta: meta || {} }));
      assert.deepEqual(x.plain('FAMILIES_DISABLED'), [], JSON.stringify(meta));
      assert.equal(x.run(`FAMILY_PRICING_STATE`), 'live');
    }
    const junk = await bootDb({}, fakeDb({ meta: { families: { disabled: [5, null, {}, ['hood'], 'hood', 'no_such_family'] } } }));
    assert.deepEqual(junk.plain('FAMILIES_DISABLED'), ['hood', 'no_such_family'], 'only the strings');
    assert.equal(junk.run('familyEnabled("sink")'), true);
    const whole = await bootDb({}, fakeDb({ meta: { quoteBuilder: { configurator: false }, families: { disabled: ['hood'] } } }));
    assert.equal(whole.run('configuratorAvailable()'), false, 'the old whole-configurator switch is untouched');
  });

  it('the file:// / offline paths never leave a stale list behind (nothing was read, so nothing is off)', async () => {
    const b = makeEnv({ protocol: 'file:' });
    b.run(`FAMILIES_DISABLED = ['hood']`);
    await b.run('loadDatabase()');
    assert.deepEqual(b.plain('FAMILIES_DISABLED'), []);
  });

  it('chips: a listed product has none; the rest keep theirs in order; with every product listed the whole Configure row goes', async () => {
    const b = await bootDb({}, fakeDb({ meta: { families: { disabled: ['hood', 'cooking_line'] } } }));
    b.run('renderCfgChips()');
    const html = b.el('cfgChips').innerHTML;
    assert.deepEqual([...html.matchAll(/data-cfg-open="([a-z_]+)"/g)].map((m) => m[1]), FAM.order.filter((id) => id !== 'hood' && id !== 'cooking_line'));
    assert.equal(html.includes('Range hood'), false);
    assert.equal(html.includes('Griddle, griller or fryer'), false);
    assert.ok(html.includes('⚙ Wok range</button>'));
    b.run(`FAMILIES_DISABLED = ${JSON.stringify(FAM.order)}; renderCfgChips();`);
    assert.equal(b.el('cfgChips').style.display, 'none');
    assert.equal(b.el('cfgChips').innerHTML, '');
  });

  it('the panel refuses a listed product (an old chip, a stale ⚙, a hand-typed call) and opens every other one', async () => {
    const b = await bootDb({}, fakeDb({ meta: { families: { disabled: ['hood'] } } }));
    assert.equal(b.run(`openConfigurator('hood')`), false);
    assert.equal(b.run('cfgState'), null);
    assert.match(b.toast(), /Configurator unavailable/);
    assert.equal(b.run(`openConfigurator('wok_range')`), true);
    assert.equal(b.run('cfgState.familyId'), 'wok_range');
    // a panel left open when the product is switched off by a reload is not kept (the next openConfigurator replaces it anyway)
    b.run(`openConfigurator('sink')`);
    assert.equal(b.run('cfgState.familyId'), 'sink');
  });

  it('"sold online as" and "configure instead" go for the listed product\'s SKUs only; the others keep them', async () => {
    const b = await bootDb({}, fakeDb({ meta: { families: { disabled: ['hood', 'wok_range'] } } }));
    assert.equal(b.run(`cfgSoldOnlineHtml('EX-018')`), '');
    assert.equal(b.run(`cfgSoldOnlineHtml('CE-006')`), '');
    assert.match(b.run(`cfgSoldOnlineHtml('PW-006')`), /Sold online as: Sink/);
    assert.match(b.run(`cfgSoldOnlineHtml('CE-010')`), /Sold online as: Griddle, griller or fryer/);
    b.run(`configureInstead('EX-018')`);
    assert.equal(b.run('cfgState'), null, 'no panel for a switched-off product');
    assert.match(b.toast(), /no configurable version/);
    b.run(`configureInstead('PW-006')`);
    assert.equal(b.run('cfgState.familyId'), 'sink');
  });

  it('an old plain line of a listed product gets no "⚙ convert to configured" (and convert is refused); other products keep it', async () => {
    const b = await bootDb({}, fakeDb({ meta: { families: { disabled: ['hood'] } } }));
    const eh = { id: 'EX-018', category: 'exhaust_system', name: 'Island hood', qty: 1, unit: 'pc', unitPrice: 12300, amount: 12300, priceManual: true };
    assert.equal(b.run(`cfgLineRowHtml(${JSON.stringify(eh)}, 0)`), '');
    b.run(`items.length = 0; items.push(${JSON.stringify(eh)}); convertToConfigured(0)`);
    assert.equal(b.run('items[0].familyId'), undefined, 'the line was not converted');
    assert.equal(b.run('cfgState'), null);
    assert.match(b.toast(), /cannot be converted/);
    assert.match(b.run(`cfgLineRowHtml(${JSON.stringify({ ...eh, id: 'PW-006', category: 'prep_washing' })}, 1)`), /convertToConfigured\(1\)/);
  });

  it('an existing line of a listed product loads, totals at its stored price, reads "configurator off for this product" and cannot be re-configured — while the sink line beside it still can', async () => {
    const b = await bootDb({}, fakeDb({ meta: { families: { disabled: ['hood'] } } }));
    const hood = lineOf('hood', { unitPrice: 41700, amount: 41700, basisUnitPrice: 41700 });
    const sink = lineOf('sink');
    b.run(`loadEditableState(${JSON.stringify({ currentCo: 'BK', items: [hood, sink] })})`);
    assert.equal(b.run('items.length'), 2);
    assert.equal(b.run('items[0].unitPrice'), 41700, 'the stored price is untouched');
    assert.equal(b.run('computeTotals().grand') > 41700, true);
    const row = b.run('cfgLineRowHtml(items[0], 0)');
    assert.match(row, /configurator off/);
    assert.match(row, /switched off for this product/);
    assert.equal(/configureLine\(0\)/.test(row), false, 'no ⚙ configure button on it');
    assert.match(b.run('cfgLineRowHtml(items[1], 1)'), /configureLine\(1\)/, 'the sink keeps its button');
    assert.equal(/configurator off/.test(b.run('cfgLineRowHtml(items[1], 1)')), false);
    b.run('configureLine(0)');
    assert.equal(b.run('cfgState'), null);
    assert.match(b.toast(), /switched off for this product — this line keeps its stored price/);
    b.run('configureLine(1)');
    assert.equal(b.run('cfgState.familyId'), 'sink');
    // and with the WHOLE configurator off the wording stays the old one
    b.run('closeConfigurator({ silent: true }); CONFIGURATOR_ON = false;');
    assert.doesNotMatch(b.run('cfgLineRowHtml(items[0], 0)'), /for this product/);
    b.run('configureLine(0)');
    assert.match(b.toast(), /The configurator is switched off — this line keeps its stored price\./);
  });

  it('the guided demo opens the first product that is on: the sink, or — with the sink listed — the next one; with every product listed the step is skipped', async () => {
    const tour = async (disabled) => {
      const b = await bootDb({}, fakeDb({ meta: { families: { disabled } } }));
      b.ctx.document.querySelector = () => ({ offsetParent: {}, getBoundingClientRect: () => ({ width: 100, height: 20, left: 0, top: 0, right: 100, bottom: 20 }), scrollIntoView() {}, closest: () => null });
      const at = b.plain('TOUR_STEPS').findIndex((s) => s.needsConfigurator);
      b.run('startTour()');
      for (let i = 0; i < at; i++) b.run('tourGo(1)');
      return { b, at };
    };
    const one = await tour([]);
    assert.equal(one.b.run('cfgState.familyId'), 'sink');
    one.b.run('endTour()');
    const two = await tour(['sink']);
    assert.equal(two.b.run('cfgState.familyId'), 'prep_table', 'the first product that is on');
    assert.equal(two.b.run('cfgState.tour'), true);
    assert.equal(two.b.el('cfgAddBtn').disabled, true, 'the demo still adds nothing');
    two.b.run('endTour()');
    assert.equal(two.b.run('cfgState'), null);
    const none = await tour(FAM.order);
    assert.notEqual(none.b.run('tourIdx'), none.at, 'no panel to show: the step was skipped');
    assert.equal(none.b.run('cfgState'), null);
    none.b.run('endTour()');
  });
});

describe('FAMILIES-2 — the tutorial (TUTORIAL_VERSION 45, Help and the demo tell the same story)', () => {
  const helpLi = (HTML.match(/<li><strong>Configure a product<\/strong>[\s\S]*?<\/li>/) || [''])[0];

  it('Help "Configure a product" lists every product kind in the chips\' own order and words, and says what is new: options that only show when they apply, a Use N mm for a capped size, the staff top on five products', () => {
    assert.ok(helpLi.length > 500);
    // the kinds come from the definitions, so a renamed or added family fails here until Help says it (the one label with commas is written with slashes in a sentence)
    const kinds = FAM.order.map((id) => (id === 'cooking_line' ? 'Griddle / griller / fryer' : FAM.families[id].label));
    assert.equal(kinds.length, 11);
    assert.ok(helpLi.includes('(' + kinds.join(', ') + ')'), 'the eleven kinds, in the chips\' order');
    for (const must of ['Some choices only show when they apply — fry baskets for a fryer, a pre-rinse sink on the soiled side of a dish table', 'a size an option does not allow is flagged under the box with a <em>Use N mm</em> shortcut',
      'a slim hood is at most 500 mm deep; a deck oven\'s width follows its trays per deck', 'Tables, sinks, dish tables, stoves and wok ranges are built with a 1.5 mm (16 ga) top as standard']) {
      assert.ok(helpLi.includes(must), `Help does not say: ${must}`);
    }
    assert.equal(/Tables, sinks and stoves are built/.test(helpLi), false, 'the old three-product sentence is gone');
  });

  it('the demo: the Add-items step names all the product kinds; the configurator step says some choices only appear when they apply, and the staff top is on five products — and its selectors all still resolve', () => {
    const b = makeEnv();
    const steps = b.plain('TOUR_STEPS');
    const add = steps.find((s) => s.target === '#addItemsSection');
    assert.match(add.body, /configure a table, sink, dish table, stove, wok range, griddle \/ griller \/ fryer, deck oven, hood, cabinet, shelf or rack — the next step\./);
    const cfg = steps.find((s) => s.target === '#configPanel');
    assert.match(cfg.body, /Some choices only appear when they apply \(fry baskets for a fryer, a pre-rinse sink on the soiled side of a dish table\)\./);
    assert.match(cfg.body, /On a table, sink, dish table, stove or wok range the staff-only Top plate option switches the standard 1\.5 mm top to a lighter 1\.2 mm one\./);
    assert.equal(steps.filter((x) => x.needsConfigurator).length, 1, 'no new step: the same #configPanel step (spec §6.6)');
    assert.equal(steps.filter((x) => x.target === '#configPanel').length, 1);
    for (const s of steps.filter((x) => x.target)) assert.ok(new RegExp(`id="${s.target.replace(/^[#.]/, '')}"`).test(HTML) || s.target.startsWith('.'), s.target);
  });

  it('no price, amount or option figure in the new tutorial copy (the repo is public)', () => {
    const wn = makeEnv().plain('WHATS_NEW')[0].items.join(' ');
    const copy = helpLi + ' ' + wn + ' ' + makeEnv().plain('TOUR_STEPS').filter((s) => s.target === '#configPanel' || s.target === '#addItemsSection').map((s) => s.body).join(' ');
    assert.equal(/₱\s*\d|PHP\s*\d|\bpesos?\b/i.test(copy.replace(/₱20,000/g, '')), false);
  });
});

// ═══════════════════════════════════════ GRADE-TITLES — the staff-only steel grade and the line titles (owner rulings 2026-10-28) ═══════════════════════════════════════
// specs/CONFIGURATOR-GRADE-TITLES-SPEC.md §5 / §6. Nothing in the builder is written per family: the Material group is the FIRST group of every family in the definitions, so the panel
// draws it first with the existing "staff" chip and two pills; a 316 line is priced from the sheet's grade cell (blank = "Priced after review"); a line is NAMED by its family's title; and
// re-configuring a line refreshes that name (cfgApplyEdit copies `name`). A saved or filed quote is never retitled by a load.
describe('GRADE-TITLES — Material is drawn first, a 316 line is "Priced after review" until the sheet\'s grade cell is filled, and a line is named by its title', () => {
  const G304 = 'Stainless Steel 304 Food Grade';
  const G316 = 'Stainless Steel 316 Laboratory Grade';
  const CHIP = '<span class="cfg-staff-chip no-print" title="Not offered on the website">staff</span>';
  const TITLE = { prep_table: 'SS Preparation Table', sink: 'SS Sink', dish_table: 'SS Dish Table', stove: 'SS Range Stove', wok_range: 'SS Wok Range', cooking_line: 'SS Griddle', deck_oven: 'Gas Deck Oven', hood: 'SS Range Hood', cabinet: 'SS Cabinet', wall_shelf: 'SS Wall Shelving', rack: 'SS Rack' };
  const open = (b, id, opts = {}) => { b.run(`openConfigurator(${JSON.stringify(id)}, ${JSON.stringify(opts)})`); };
  const oAt = (id, key, v) => FAM.families[id].groups[gAt(id, key)].options.findIndex((o) => o.v === v);
  const pickV = (b, id, key, v) => b.run(`cfgPickOpt(${gAt(id, key)}, ${oAt(id, key, v)})`);
  const specText = (html) => { const m = /<span class="spec-edit cell-edit"[^>]*>([^<]*)<\/span>/.exec(html); return m ? m[1] : null; };

  it('every family draws Material FIRST: the label with the "staff" chip, a pill group with the two grade labels (304 pressed), and no hint line under it', () => {
    const b = builder();
    for (const id of FAM.order) {
      open(b, id);
      const html = b.el('cfgBody').innerHTML;
      assert.equal(gAt(id, 'grade'), 0, `${id}: the grade is the first group of the definition`);
      assert.ok(html.includes(`<div class="cfg-lbl" id="cfgL0">Material ${CHIP}</div>`), `${id}: label + chip`);
      assert.ok(html.indexOf('id="cfgL0"') < html.indexOf('id="cfgL1"'), `${id}: Material comes before the next group`);
      assert.ok(html.includes('role="group" aria-labelledby="cfgL0"'), `${id}: a pill group`);
      assert.ok(html.includes(`>${G304}</button>`) && html.includes(`>${G316}</button>`), id);
      assert.match(html, /data-cfg-group="grade" data-cfg-v="304" data-cfg-key="g0o0" aria-pressed="true"/);
      assert.match(html, /data-cfg-group="grade" data-cfg-v="316" data-cfg-key="g0o1" aria-pressed="false"/);
      const firstGroup = html.split('<div class="cfg-group')[1];
      assert.equal(firstGroup.includes('cfg-hintline'), false, `${id}: the grade options carry no hint, so no hint line is drawn`);
    }
  });

  it('picking 316: the summary starts "SS316", Add stays enabled and nothing is called an error; the figure is the 304 one plus exactly the sheet\'s grade cell; going back to 304 takes it away', () => {
    const b = builder();
    open(b, 'sink');
    const std = b.plain('cfgEvaluate(cfgState).basis');
    assert.equal(std.priced, true);
    assert.equal(/SS3\d\d/.test(b.el('cfgPreview').textContent), false, 'the standard grade is not repeated in the summary');
    pickV(b, 'sink', 'grade', 316);
    assert.equal(b.run('cfgState.config.grade'), 316);
    assert.match(b.el('cfgPreview').textContent, /^Sink — SS316 · /);
    assert.deepEqual(b.plain('cfgEvaluate(cfgState).v.errors'), [], 'no "chosen by our staff" error in the builder');
    assert.equal(b.el('cfgAddBtn').disabled, false);
    assert.equal(b.el('cfgBody').innerHTML.includes('chosen by our staff'), false);
    const dearer = b.plain('cfgEvaluate(cfgState).basis');
    assert.equal(dearer.priced, true);
    assert.deepEqual(dearer.deltas.filter((d) => d.key === 'grade:316'), [{ key: 'grade:316', amount: GRADE_FLAT }]);
    assert.equal(dearer.unitPrice - std.unitPrice, GRADE_FLAT);
    pickV(b, 'sink', 'grade', 304);
    assert.equal(b.run('cfgState.config.grade'), 304);
    assert.equal(b.plain('cfgEvaluate(cfgState).basis').unitPrice, std.unitPrice);
    assert.deepEqual(b.plain('cfgEvaluate(cfgState).basis').deltas.filter((d) => /^grade:/.test(d.key)), []);
  });

  it('316 with the grade cell blank, or no cell at all: "Priced after review — Material: …", a required price box, Add enabled; a blank cell is never read as 0', () => {
    for (const how of ['blank', 'missing']) {
      const b = builder();
      b.run(how === 'blank' ? `FAMILY_PRICING.sink.options.grade = { '316': { flat: null, perW100: null } }` : `delete FAMILY_PRICING.sink.options.grade`);
      open(b, 'sink');
      assert.equal(b.plain('cfgEvaluate(cfgState).basis').priced, true, `${how}: the standard grade is the zero point and needs no cell`);
      pickV(b, 'sink', 'grade', 316);
      const area = b.el('cfgPriceArea').innerHTML;
      assert.match(area, /<span class="cfg-badge">Priced after review<\/span>/, how);
      assert.match(area, /No amount entered yet for: Material: Stainless Steel 316 Laboratory Grade\./, how);
      assert.notEqual(b.el('cfgManualWrap').style.display, 'none', how);
      assert.equal(b.el('cfgAddBtn').disabled, false, how);
      assert.deepEqual(b.plain('cfgEvaluate(cfgState).basis').missing, ['Material: ' + G316], how);
      assert.equal(b.plain('cfgEvaluate(cfgState).basis').unitPrice, 0, `${how}: a blank cell is never zero`);
    }
  });

  it('a 316 line added with a typed price: named by its title, Material 316 first in the printed specs, the Construction sentence agrees (SS316), manual + priceManual, the grade stored and filed', () => {
    const b = builder();
    b.run(`delete FAMILY_PRICING.sink.options.grade`);
    open(b, 'sink');
    pickV(b, 'sink', 'grade', 316);
    b.run(`cfgManualInput({ value: '39000' }); cfgCommit()`);
    const it = b.plain('items[0]');
    assert.equal(it.name, 'SS Sink');
    assert.equal(it.config.grade, 316);
    assert.deepEqual([it.priceBasis, it.priceManual, it.unitPrice], ['manual', true, 39000]);
    assert.equal(it.needsPrice, undefined);
    assert.deepEqual(it.specs[0], { label: 'Material', value: G316 });
    assert.equal(it.specs.filter((s) => s.label === 'Material').length, 1);
    assert.match(it.specs.at(-1).value, /^SS316 stainless steel · 1\.5 mm \(16 ga\) top plate · /, 'the Construction line cannot contradict the Material row');
    assert.ok(it.specStr.startsWith('Material: ' + G316 + ', '));
    const printed = specText(b.el('itemsTbody').innerHTML);
    assert.match(printed, /^Material: Stainless Steel 316 Laboratory Grade • Sinks: /);
    assert.match(printed, /Construction: SS316 stainless steel/);
    assert.equal(/SS304/.test(printed), false, 'a 316 line never prints the 304 wording');
    const pl = b.plain('buildQuotePayload()');
    for (const row of [pl.items[0], pl.editableState.items[0]]) {
      assert.equal(row.name, 'SS Sink'); assert.equal(row.config.grade, 316); assert.equal(row.specs[0].label, 'Material'); assert.equal(row.specs[0].value, G316);
    }
  });

  it('every family: the line the panel builds is named by its TITLE and prints Material first; at 316 the name is the same and only the Material row (and the Construction sentence) change', () => {
    const b = builder();
    for (const id of FAM.order) {
      const f = FAM.families[id];
      const std = makeLine(b, stateFor(id, {})).line;
      assert.equal(std.name, TITLE[id], id);
      assert.notEqual(std.name, f.label, `${id}: not the website's name`);
      assert.deepEqual(std.specs[0], { label: 'Material', value: G304 }, id);
      assert.equal(std.config.grade, 304, id);
      const l316 = makeLine(b, stateFor(id, { config: { ...PF.defaultConfig(f), grade: 316 } })).line;
      assert.equal(l316.name, TITLE[id], `${id}: the title never names the grade`);
      assert.deepEqual(l316.specs[0], { label: 'Material', value: G316 }, id);
      assert.deepEqual(l316.specs.slice(1, -1), std.specs.slice(1, -1), `${id}: only Material and Construction differ`);
      assert.equal(l316.config.grade, 316, id);
    }
  });

  it('the stove and the griddle / griller / fryer are named from what is chosen in the panel; ⚙ configure refreshes the name (cfgApplyEdit copies `name`), and the toast says the new one', () => {
    const b = builder();
    open(b, 'stove');
    const nameNow = () => b.run('cfgMakeLine(cfgEvaluate(cfgState), cfgState).name');
    const A = gAt('stove', 'addons');
    assert.equal(nameNow(), 'SS Range Stove');
    b.run(`cfgToggleMulti(${A}, 3, true); cfgToggleMulti(${A}, 0, true)`);                       // the fryer, then the griller: named in the family's own order
    assert.equal(nameNow(), 'SS Range Stove Combination (Griller, Fryer)');
    b.run('cfgCommit()');
    assert.equal(b.run('items[0].name'), 'SS Range Stove Combination (Griller, Fryer)');
    assert.match(b.toast(), /Added: SS Range Stove Combination \(Griller, Fryer\) \(configured\)/);
    b.run('configureLine(0)');
    b.run(`cfgToggleMulti(${A}, 3, false); cfgToggleMulti(${A}, 0, false)`);
    b.run('cfgCommit()');
    assert.equal(b.run('items.length'), 1);
    assert.equal(b.run('items[0].name'), 'SS Range Stove', 'the name follows the configuration back');
    assert.match(b.toast(), /Updated: SS Range Stove/);
    b.run(`items[0].name = 'My own name'`);                                                       // a hand-typed name is replaced by the title on the next re-configure
    b.run('configureLine(0)'); b.run('cfgCommit()');
    assert.equal(b.run('items[0].name'), 'SS Range Stove');
    for (const [type, name] of [['griddle', 'SS Griddle'], ['griller', 'SS Lava-Rock Griller'], ['fryer', 'SS Fryer'], ['combi', 'SS Griller + Griddle Combination']]) {
      open(b, 'cooking_line');
      pickV(b, 'cooking_line', 'type', type);
      assert.equal(b.run('cfgMakeLine(cfgEvaluate(cfgState), cfgState).name'), name, type);
    }
    // the pin: the Update path copies `name` from the fresh line (the Add path takes the whole fresh line)
    assert.match(SCRIPT, /\['id', 'name', 'familyId', 'familyVersion', 'config', 'size', 'dims', 'specs', 'specStr', 'formulaType', 'qty', 'unit', 'notes', 'basisUnitPrice'\]\.forEach\(k => \{ old\[k\] = fresh\[k\]; \}\);/);
  });

  it('a stored line is never retitled by a load: a saved quote, a draft or a template keeps the name it was filed with (only a new line, a re-configure or a conversion get a title)', () => {
    const b = builder();
    const { line } = makeLine(b, sinkState({ qty: 1 }));
    const stored = { ...line, name: 'Sink', specs: line.specs.filter((s) => s.label !== 'Material'), _uid: 'old1' };       // as it was filed before the titles and the Material row existed
    b.run(`items.length = 0; items.push(${JSON.stringify(stored)}); normalizeLoadedItems(items);`);
    const it = b.plain('items[0]');
    assert.equal(it.name, 'Sink');
    assert.deepEqual(it.specs.map((s) => s.label), stored.specs.map((s) => s.label), 'its printed specs are untouched too');
    assert.equal(it._cfg.priced, true, 'and it still prices like the standard grade: an absent grade is the default');
    assert.deepEqual(it._cfg.missing, []);
  });

  it('the Help text and the demo say the Material option and the line names (the tutorial contract); no figure in the new copy', () => {
    const helpBody = (HTML.match(/<div class="modal-body" id="helpBody">[\s\S]*?<h4>What's new<\/h4>/) || [''])[0];
    const li = (helpBody.match(/<li><strong>Configure a product<\/strong>[\s\S]*?<\/li>/) || [''])[0];
    assert.ok(li.length > 500, 'could not find the Configure a product item');
    for (const must of ['Every product opens with a <em>Material</em> option', 'Stainless Steel 304 Food Grade as standard', 'the <em>staff</em> choice Stainless Steel 316 Laboratory Grade (the website never offers it)',
      'reads <em>Priced after review</em> until Finance has entered the 316 amount for that product in Inventory › Family pricing', 'each configured line is named for what it is on the quote', '<em>SS Sink</em>', '<em>SS Range Stove Combination (Griller, Fryer)</em>']) {
      assert.ok(li.includes(must), `Help does not say: ${must}`);
    }
    const cfg = makeEnv().plain('TOUR_STEPS').find((s) => s.target === '#configPanel').body;
    assert.match(cfg, /Every product opens with the staff-only Material option — Stainless Steel 304 Food Grade as standard, or 316 Laboratory Grade — and each line is named for what it is on the quote \(SS Sink, SS Griddle…\)\./);
    assert.equal(/₱\s*\d|PHP\s*\d|\bpesos?\b/i.test(li + ' ' + cfg + ' ' + makeEnv().plain('WHATS_NEW')[0].items.join(' ')), false);
  });
});

// GRADE-TITLES follow-up (owner 2026-10-28): the panel header shows the line's live title, and a website hand-off's configured lines arrive titled (a filed quote is never retitled).
describe('GRADE-TITLES follow-up — panel header title and hand-off retitle', () => {
  const gAt2 = (id, key) => FAM.families[id].groups.findIndex((g) => g.key === key);
  const oAt2 = (id, key, v) => FAM.families[id].groups[gAt2(id, key)].options.findIndex((o) => o.v === v);
  it('the header reads the title and follows the add-ons', () => {
    const b = builder();
    b.run(`openConfigurator('stove', {})`);
    assert.equal(b.run(`document.getElementById('cfgTitleName').textContent`), 'SS Range Stove');
    b.run(`cfgToggleMulti(${gAt2('stove', 'addons')}, ${oAt2('stove', 'addons', 'fryer')}, true)`);
    assert.equal(b.run(`document.getElementById('cfgTitleName').textContent`), 'SS Range Stove Combination (Fryer)');
  });
  it('a hand-off state retitles its configured lines; a non-hand-off load keeps the stored name', () => {
    const line = { id: 'PW-004', category: 'prep_washing', name: 'Sink', familyId: 'sink', config: {}, size: { W: 500, D: 500, H: 850 }, qty: 1, unit: 'pc', unitPrice: 0, priceBasis: 'manual', needsPrice: true };
    const b = builder();
    b.run(`loadEditableState({ currentCo: 'BK', handoff: true, items: [${JSON.stringify(line)}] })`);
    assert.equal(b.run('items[0].name'), 'SS Sink');
    const c = builder();
    c.run(`loadEditableState({ currentCo: 'BK', items: [${JSON.stringify(line)}] })`);
    assert.equal(c.run('items[0].name'), 'Sink');
  });
});
