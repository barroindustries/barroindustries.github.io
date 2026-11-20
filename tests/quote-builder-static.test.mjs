// tests/quote-builder-static.test.mjs — quote-builder-v2.html, the CONFIGURATOR (specs/QUOTE-BUILDER-CONFIGURATOR-SPEC.md §9, work chunk WS-2).
//
// quote-builder-v2.html is one 9,000-line HTML file with one inline <script> and no module system, so it cannot be require()d. Two layers:
//
//   1. STATIC — the markup and the constants: the three new script tags and their order, the tutorial (TUTORIAL_VERSION 47, the What's New
//      entries 47, 46, 45, 44 and 43, the guided-demo step and every selector it targets), ESTIMATE_RANGE_MODE, the A5 letterhead strings, CO.BS
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
const QS = require('../js/qb-spec-sheet.js');     // the pure spec-sheet helpers the builder prints every line with (QB-SELLING-QUOTE-SPEC Phase 1)
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
  win.ProductFamilies = PF; win.QR_FAMILIES = FAM; win.PricingCore = PC; win.QBConfigured = QB; win.QBSpecSheet = QS;
  Object.assign(win, { priceCatalogItem: PC.priceCatalogItem, validateSelection: PC.validateSelection, estimateRange: PC.estimateRange, estimateGate: PC.estimateGate });
  if (db) win.db = db;
  const ctx = vm.createContext(win);
  (script === SCRIPT ? COMPILED : new vm.Script(script, { filename: 'quote-builder-v2.html<script>' })).runInContext(ctx);
  const run = (code) => vm.runInContext(code, ctx);
  // the markup's own defaults for the two document options (the first <option> is selected, the checkbox is `checked`) — a stub select would otherwise read '' = "as issued"
  el('warrantyPlan').value = 'service6'; el('showStandardPage').checked = true;
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
  prod('PW-029', 'prep_washing', 'fixed', 2719, { W: 1220, D: 660, H: 851 }, {}),
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
const GRADE_PCT = 37;          // the synthetic SS316 premium of every approved fixture sheet, a PERCENTAGE of the whole line price (specs/GRADE-PERCENT-SPEC.md; a made-up figure: the real one is private)
function sheetFor(familyId, { approved = true } = {}) {
  const f = FAM.families[familyId];
  const options = {};
  let i = 0;
  for (const c of PF.cells(f)) {
    // the staff-only steel grade: its SS316 cell is a synthetic PERCENTAGE ({ pct }, schema 5) and does not count in `i`, so every other cell keeps the figure it had before the grade existed
    if (c.group === 'grade') { if (!c.baseline) (options.grade = options.grade || {})[c.value] = { pct: GRADE_PCT }; continue; }
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
    // the local scripts are written, in this order, by the one-line ?v= loader (2026-10-29; pinned in tests/lazy-script-versioning.test.mjs)
    const loader = (HTML.match(/<script>\(function\(\)\{var v=new URLSearchParams[^\n]*?<\/script>\n/) || [''])[0];
    const tags = [...loader.matchAll(/'(js\/[a-z-]+\.js)'/g)].map((m) => m[1]);
    const at = tags.indexOf('js/pricing-core.js');
    assert.ok(at >= 0);
    assert.deepEqual(tags.slice(at, at + 4), ['js/pricing-core.js', 'js/qr-families.js', 'js/product-families.js', 'js/qb-configured.js']);
    assert.equal((HTML.match(/js\/qb-configured\.js/g) || []).length >= 1, true);
  });

  it('TUTORIAL_VERSION is 52: the newest What\'s New entry is version 52 (the approval link to the quote itself, QUOTE-APPROVAL-LINK-SPEC-2026-11-20), then 51 (the Barro Kitchens configurators in the live builder, dated the day they open), then 50 (Preview\'s Back to the form stays on screen, owner Q70); entry 49 (the timeline rule, quotations "as issued", the printed page tail), 48 (the selling document) and 47 (the 316 percentage), 46 (the line titles and the staff-only Material row), 45 (five more configurable products), 44 (the partner portal is retired) and 43 stay as history', () => {
    const b = makeEnv();
    assert.equal(b.run('TUTORIAL_VERSION'), 52);
    const wn52 = b.plain('WHATS_NEW');
    // 52 — QUOTE-APPROVAL-LINK-SPEC-2026-11-20: Send for approval gives a link to the quote itself. One bullet, plain user language, no figure; held like 51 until the configurators are on (kc:true: Addendum 2 B5).
    assert.equal(wn52[0].ver, 52);
    assert.equal(wn52[0].date, '2026-11-20');
    assert.equal(wn52[0].kc, true);
    assert.equal(wn52[0].items.length, 1);
    for (const must of ['Send for approval now gives you a link to the quote itself', 'the President opens it, sees every line', 'approve it, return it with a note, or leave a comment', 'Approval link button on the Quotes list']) assert.ok(wn52[0].items[0].includes(must), `What's New 52 does not say: ${must}`);
    assert.equal(/prototype/i.test(wn52[0].items[0]), false);
    assert.equal(/₱\s*\d|PHP\s*\d|\bpesos?\b/i.test(wn52[0].items[0]), false, 'What\'s New 52 states no peso figure');
    const wn = wn52.slice(1);   // everything below 52 is what this test has always pinned, at the indexes it has always used
    // 51 — the configurators (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md): one bullet per change, in plain user language, no figure, no word "prototype"; the date is the day they open
    assert.equal(wn[0].ver, 51);
    assert.equal(wn[0].date, '2026-11-20');
    assert.equal(wn[0].items.length, 6, 'six bullets: the tabs, the pricing, the one print format, the approval, the markup, old quotes');
    const t51 = wn[0].items.join(' ');
    for (const must of ['seven tabs', 'Prep and storage', 'Mechanical Systems', 'Add custom item', 'prices itself from the materials price list', 'Chef Mode', 'Standard Product Price List', 'Catalogue items keep their catalogue price', 'one format', 'centavos',
      'Workforce Copy', 'goes to the President for approval', 'Messenger or Viber', 'keeps its approval', 'one markup for a quote', 'a discount stops at the project cost', 'Quotes, drafts and templates made before today open and price exactly as before']) {
      assert.ok(t51.includes(must), `What's New 51 does not say: ${must}`);
    }
    assert.equal(/prototype/i.test(t51), false, 'no "Prototype:" wording');
    assert.equal(/₱\s*\d|PHP\s*\d|\bpesos?\b/i.test(t51), false, 'What\'s New 51 states no peso figure');
    // 50 — owner Q70 (it shipped before this change and stays as history)
    assert.equal(wn[1].ver, 50);
    assert.equal(wn[1].date, '2026-11-19');
    assert.equal(wn[1].items.length, 1, 'one bullet: the Back to the form button');
    assert.ok(wn[1].items[0].includes('✎ Back to the form button now stays on screen'), 'What\'s New 50 names the fix in user language');
    assert.equal(wn[2].ver, 49, '49 stays as history: this change is a new entry');
    assert.equal(wn[3].ver, 48, '48 stays as history: this change is a new entry');
    assert.equal(wn[4].ver, 47, '47 stays as history');
    assert.equal(wn[5].ver, 46, '46 stays as history');
    assert.equal(wn[6].ver, 45, '45 stays as history');
    assert.equal(wn[7].ver, 44, '44 stays as history');
    assert.equal(wn[8].ver, 43, '43 had shipped (origin/master d491b5d): it stays as history');
    assert.equal(wn[2].date, '2026-11-05');
    assert.equal(wn[3].date, '2026-11-05');
    assert.match(wn[4].date, /^2026-10-\d\d$/);
    assert.deepEqual(wn.map((e) => e.ver), [...wn.map((e) => e.ver)].sort((x, y) => y - x), 'newest first');
    // 49 — the owner's timeline ruling and the as-issued rule, in plain user language: one bullet per change
    const t49 = wn[2].items.join(' ');
    for (const must of ['at least 25 working days (Sundays not counted)', 'Barro Kitchens and Barro Industries quotations', '12 working days plus 3 for every ₱20,000 of materials, if that is longer', 'estimated completion date', 'priority-order threshold',
      'the printed timeline note says so', 'Brilliance Steel is unchanged', 'filed before the warranty plan existed', 'keeps the warranty and site-requirements wording and the timeline it was issued with', '“As issued”', 'Pick a Warranty plan',
      'bottom margin of every page', 'close the “Our standard” page']) {
      assert.ok(t49.includes(must), `What's New 49 does not say: ${must}`);
    }
    assert.equal(wn[2].items.length, 3, 'three bullets: the timeline rule, quotations as issued, the printed page tail');
    // 48 — QB-SELLING-QUOTE-SPEC Phase 1, in plain user language: one bullet per change
    const t48 = wn[3].items.join(' ');
    for (const must of ['spec sheet', 'dimension legend', 'one-line summary', 'Details ▸', 'hairline is the standard', 'brushed, mirror, satin', 'Includes, Not included', '25 working days minimum, from downpayment and approved drawings',
      '“Our standard” page', 'Warranty plan', '6-month service warranty', 'Full kitchen', '12 months of preventive maintenance service (PMS) with KitchenShield™', 'The Warranty term now states the 6-month service warranty',
      'names the company that is quoting', 'no size, no specs, no finish, no photo', 'Quote strength', 'will not file a made-to-order line that has no size', 'PREP_WASHING', 'current quote number', 'Brilliance Steel quotes are unchanged']) {
      assert.ok(t48.includes(must), `What's New 48 does not say: ${must}`);
    }
    assert.equal(wn[3].items.length, 6, 'six bullets: the sheet, Details, Our standard, the warranty plan, the chips and the check, the small fixes');
    const t47 = wn[4].items.join(' ');
    assert.equal(/₱\s*\d|PHP\s*\d|\bpesos?\b|\d\s?%|\bper cent\b/i.test(t47), false, 'the What\'s New entry states no figure');
    assert.deepEqual(wn[4].items, ['The 316 Material premium is now a percentage of the whole line — base, size and every option — set by Finance in Inventory › Family pricing.']);
    const t46 = wn[5].items.join(' ');
    for (const must of ['Configured lines now carry a proper name on the quote', '"SS Range Stove"', '"SS Range Stove Combination (Griller, Fryer)"', '"SS Griddle"', '"SS Lava-Rock Griller"', '"Gas Deck Oven"',
      'the name updates when you re-configure the line', 'Every configured product starts with a Material row', 'Stainless Steel 304 Food Grade as standard', 'Stainless Steel 316 Laboratory Grade',
      'a staff-only choice (the website never offers it)', 'shows "Priced after review" until Finance enters the 316 percentage for that product in Inventory › Family pricing']) {
      assert.ok(t46.includes(must), `What's New 46 does not say: ${must}`);
    }
    assert.equal(/316 amount/.test(wn.map((e) => e.items.join(' ')).join(' ')), false, 'no What\'s New entry still calls the 316 premium an amount');
    assert.equal(wn[5].items.length, 2, 'two bullets: the line names, and the Material row');
    const t45 = wn[6].items.join(' ');
    for (const must of ['Five more products can be configured right in the builder', 'dish tables, wok ranges, griddles / grillers / fryers, gas deck ovens and range hoods', 'an option Finance has not priced yet asks you for a price instead of guessing',
      '"⚙ convert to configured"', 'Some choices only show when they apply', 'fry baskets for a fryer', 'pre-rinse sink on the soiled side of a dish table', 'a size an option does not allow is flagged as you type', '"Use N mm"',
      'a slim hood is at most 500 mm deep', 'a deck oven\'s width follows its trays per deck']) {
      assert.ok(t45.includes(must), `What's New 45 does not say: ${must}`);
    }
    assert.equal(wn[6].items.length, 2, 'two bullets: the products, and the conditional options with their size limits');
    const t44 = wn[7].items.join(' ');
    for (const must of ['partner portal is retired', 'Brilliance Steel pill', 'pass-through tick', 'Nothing changes for Barro Kitchens or Barro Industries quotes']) {
      assert.ok(t44.includes(must), `What's New 44 does not say: ${must}`);
    }
    const text = wn[8].items.join(' ');
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
    assert.match(helpBody, /<strong>Pick the company<\/strong>[\s\S]*?Brilliance Steel quote hides the cost calculator and BOM; each line gets a <em>pass-through<\/em> tick/);
    assert.match(steps.find((s) => s.target === '#coBK').body, /On Brilliance Steel the cost calculator stays out of the way and each line gets a pass-through tick/);
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
    const BS_LITERAL = `  BS:{name:'BRILLIANCE STEEL CORPORATION',sub:'',logo:'',addr:'Pasig City, Metro Manila',contact:'09276836300',
    sig:{name:'GERALD CHAN',title:'President, Brilliance Steel Corporation'},nav:'<span>BRILLIANCE</span> STEEL',code:'BS',
    thanks:'Thank you for considering Brilliance Steel Corporation. We are committed to quality steelworks delivered on time.',
    creds:'Brilliance Steel Corporation  •  SEC / BIR Registered  •  Pasig City, Metro Manila  •  0927 683 6300'},`;
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
      assert.match(SCRIPT, /document\.getElementById\('quoteDate'\)\.value = manilaToday\(\);\s*setCompany\(bootCompany\(\)\);/);   // Fable review F15 (2026-11-20): the Manila date, not UTC (was new Date().toISOString().split('T')[0])
      assert.equal(/DOMContentLoaded[\s\S]{0,1200}setCompany\('BK'\);\s*cfgInit/.test(SCRIPT), false, 'the boot starts on a literal Barro Kitchens again');
      const fn = makeEnv().run('bootCompany.toString()');
      assert.match(fn, /co==='BK'\|\|co==='BI'\|\|co==='BS'/);
      assert.equal(/hasOwnProperty|CO\[/.test(fn), false, 'bootCompany consults the CO table (a prototype name would pass)');
    });
  });

  it('the strip list, the auto-pricer and the cost basis name what the spec says they name', () => {
    const b = makeEnv();
    assert.match(b.run('buildQuotePayload.toString()'), /priceManual, _bomOpen, _uid, _miscId, _cfg, _kc, \.\.\.rest/);   // _kc: a configured (KC) line's runtime figures are stripped too (the configurators port, D7:E18)
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
  const flagged = { id: 'PW-004', category: 'prep_washing', name: 'Sink', familyId: 'sink', dims: 'L900 × W500 × H850 mm', qty: 1, unit: 'pc', unitPrice: 0, amount: 0, priceBasis: 'manual', needsPrice: true };   // dims: the size block (QB-SELLING-QUOTE-SPEC #5) is a separate gate, tested on its own
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

  it('picking 316: the summary starts "SS316", Add stays enabled and nothing is called an error; the figure is the 304 one plus exactly the sheet\'s grade PERCENTAGE of the whole line; going back to 304 takes it away', () => {
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
    const S = std.deltas.reduce((n, d) => n + d.amount, std.base);                      // the whole 304 line before rounding, summed in the pricer's order
    assert.deepEqual(dearer.deltas.filter((d) => d.key === 'grade:316'), [{ key: 'grade:316', amount: S * GRADE_PCT / 100 }]);
    assert.equal(dearer.unitPrice, Math.round(S + S * GRADE_PCT / 100), 'the whole line x (1 + pct / 100)');
    assert.ok(dearer.unitPrice > std.unitPrice);
    // the panel's own breakdown line: the catalogue base at this size + the options, the percentage inside the options part (peso amounts)
    const dsum = dearer.deltas.reduce((n, d) => n + d.amount, 0);
    assert.ok(b.el('cfgPriceArea').innerHTML.includes('+ options ' + b.run(`formatPeso(${Math.abs(dsum)})`)), 'the premium shows as a peso amount in the options part of the breakdown');
    pickV(b, 'sink', 'grade', 304);
    assert.equal(b.run('cfgState.config.grade'), 304);
    assert.equal(b.plain('cfgEvaluate(cfgState).basis').unitPrice, std.unitPrice);
    assert.deepEqual(b.plain('cfgEvaluate(cfgState).basis').deltas.filter((d) => /^grade:/.test(d.key)), []);
  });

  it('a 316 line added at the website price: the line prices at the whole line x (1 + pct / 100), and its "Base … + options …" detail adds up — base + the other options + the premium — in peso amounts; at quantity 3 the amount is three times the unit price', () => {
    const b = builder();
    open(b, 'sink');
    pickV(b, 'sink', 'basins', 2); pickV(b, 'sink', 'faucet', 'prerinse'); pickV(b, 'sink', 'undershelf', true);
    b.run(`cfgState.qty = 3`);
    const std = b.plain('cfgEvaluate(cfgState).basis');                                // the 304 line of the same configuration
    assert.equal(std.priced, true, std.missing.join(', '));
    assert.ok(std.deltas.length >= 3, 'the fixture must carry other priced options, or this test proves nothing');
    pickV(b, 'sink', 'grade', 316);
    const basis = b.plain('cfgEvaluate(cfgState).basis');
    const S = std.deltas.reduce((n, d) => n + d.amount, std.base);
    const premium = S * GRADE_PCT / 100;
    assert.deepEqual(basis.deltas, [...std.deltas, { key: 'grade:316', amount: premium }]);
    b.run('cfgCommit()');
    const it = b.plain('items[0]');
    assert.equal(it.config.grade, 316); assert.equal(it.priceBasis, 'website');
    assert.equal(it.unitPrice, Math.round(S + premium), 'the unit price is the whole line x (1 + pct / 100)');
    assert.equal(it.qty, 3); assert.equal(it.amount, 3 * it.unitPrice, 'the quantity multiplies the unit price that already carries the percentage');
    const detail = (b.el('itemsTbody').innerHTML.match(/<div class="cfg-detail">(Base [^<]*)<\/div>/) || [])[1];
    assert.ok(detail, 'the line carries its Base … + options … detail');
    const options = std.deltas.reduce((n, d) => n + d.amount, 0) + premium;
    assert.equal(detail, `Base ${b.run(`formatPeso(${std.base})`)} at this size + options ${b.run(`formatPeso(${Math.abs(options)})`)}`);
    assert.ok(Math.abs(std.base + options - it.unitPrice) <= 0.5, 'base + the other options + the premium is the unit price, to the one rounding');
  });

  it('316 with the grade cell blank, or no cell at all: "Priced after review — Material: …", a required price box, Add enabled; a blank cell is never read as 0', () => {
    for (const how of ['blank', 'missing']) {
      const b = builder();
      b.run(how === 'blank' ? `FAMILY_PRICING.sink.options.grade = { '316': { pct: null } }` : `delete FAMILY_PRICING.sink.options.grade`);
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
      'reads <em>Priced after review</em> until Finance has entered the 316 percentage for that product in Inventory › Family pricing', 'each configured line is named for what it is on the quote', '<em>SS Sink</em>', '<em>SS Range Stove Combination (Griller, Fryer)</em>']) {
      assert.ok(li.includes(must), `Help does not say: ${must}`);
    }
    const cfg = makeEnv().plain('TOUR_STEPS').find((s) => s.target === '#configPanel').body;
    assert.match(cfg, /Every product opens with the staff-only Material option — Stainless Steel 304 Food Grade as standard, or 316 Laboratory Grade, which adds a percentage of the whole line price — and each line is named for what it is on the quote \(SS Sink, SS Griddle…\)\./);
    assert.equal(/316 amount/.test(li + ' ' + cfg), false, 'the Help and the demo no longer call the 316 premium an amount');
    assert.equal(/₱\s*\d|PHP\s*\d|\bpesos?\b/i.test(li + ' ' + cfg + ' ' + makeEnv().plain('WHATS_NEW').find((e) => e.ver === 47).items.join(' ')), false, 'the 316-percentage entry (47) states no figure');
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

// ═══════════════════════════════════════ SELLING QUOTE — Phase 1 (specs/QB-SELLING-QUOTE-SPEC.md, owner rulings 2026-11-05) ═══════════════════════════════════════
// The quotation as the selling point: every line prints as a SPEC SHEET (js/qb-spec-sheet.js), "Details ▸" edits the finish / includes / not-included / extra rows, chips and a
// quote strength show what is missing, Verify & File blocks a made-to-order line with no size and lists the weak ones, the Warranty term follows a per-quote plan (the 6-month
// service warranty, or the full-kitchen plan with the KitchenShield PMS), an "Our standard" page follows the terms, a summary strip and a dimension legend print once, section
// headings never print an id — and Brilliant Steel is left exactly as it was. The price math is frozen: every test below that edits a field also checks that no figure moved.
//
// Mutation-tested in scratch copies (never the shared tree) — each of these must fail here: the sheet slot not .print-only / the editor lines not .no-print / Brilliant Steel getting the sheet;
// canFile() without the size gate / the gate ignoring numeric sizes / the gate on Brilliant Steel; fileQuotation() without its second gate; the modal without its red block / its weak list;
// a handler touching unitPrice / amount / priceBasis; editFinish accepting an unknown finish; the four fields lost by the payload / a template; warrantyPlan or showStandardPage missing from
// PRICING_IDS; a legacy state gaining the Standard page; a stored Warranty term losing to the default; saveTerm storing an unedited default; the Standard page on Brilliant Steel / unticked / with the
// KitchenShield paragraph on the standard plan / printing a warranty the Warranty term does not say; the summary strip stating a warranty a rewritten term contradicts; the legend without a size;
// the footer / Standard page order; the preview listing the payment sections twice; a raw section id; the annex header on a stale number; a re-configure overwriting the finish / not regenerating the
// includes; a line creator forgetting the four fields; the tutorial version / entry / steps.
const SELL_DEPS = { PF, PC, FAM, constants: {} };
const sellLine = (familyId, config, size, qty, price, extra) => {
  const f = FAM.families[familyId];
  const cfg = Object.assign({}, PF.defaultConfig(f), config || {});
  const it = QB.buildLine(SELL_DEPS, { family: f, primary: { id: f.primary, category: 'prep_washing', formulaType: 'per_length' }, config: cfg, size, qty, basis: { priced: false } });
  assert.ok(it, `buildLine refused ${familyId}`);
  delete it._cfg; delete it.needsPrice;
  it.unitPrice = price; it.amount = price * qty; it.priceBasis = 'manual'; it.priceManual = true;     // a typed price, like the review's sample quote
  return Object.assign(it, extra || {});
};
// the review's sample quote (2026-11-05): five configured lines and three catalogue lines — a typed price on every one, so the database never re-prices it
const catLine = (id, category, name, dims, specs, qty, price, lead, formulaType) => ({ id, category, name, dims, specs, specStr: '', qty, unit: 'pc', unitPrice: price, amount: price * qty, priceManual: true, leadTime: lead, laborHours: null, formulaType });
const sampleItems = () => [
  sellLine('prep_table', {}, { W: 1800, D: 700, H: 850 }, 2, 28500, { notes: 'Under the pass-through window' }),
  sellLine('sink', { basins: 3, faucet: 'prerinse' }, { W: 2100, D: 700, H: 850 }, 1, 46800),
  sellLine('stove', { positions: ['hp_large', 'hp_large', 'lp_small', 'lp_small'], addons: ['griddle'] }, { W: 1500, D: 800, H: 850 }, 1, 68500),
  sellLine('hood', {}, { W: 3000, D: 1000 }, 1, 54000),
  sellLine('rack', { tiers: 4, wheels: true }, { W: 1200, D: 500, H: 1800 }, 3, 14500),
  catLine('PW-004', 'prep_washing', 'SS Wash Sink (Single) with Gooseneck Faucet', 'L500 × W500 × H850 mm', [{ label: 'Basin Depth', value: '300mm' }, { label: 'Faucet Type', value: 'Gooseneck' }], 1, 16500, '7-10 days', 'per_length'),
  catLine('RF-004', 'refrigeration', 'Undercounter Chiller', '', [], 1, 62000, '14-21 days', 'fixed'),
  catLine('FS-001', 'fire_suppression', 'Fire Suppression System (Wet Chemical, Small)', '', [], 1, 85000, '21-30 days', 'fixed'),
];
const LEGACY_FIELDS = ['finish', 'includes', 'excludes', 'specLines'];
const legacyOf = (items) => items.map((it) => { const c = JSON.parse(JSON.stringify(it)); LEGACY_FIELDS.forEach((k) => delete c[k]); if (c.familyId) c.leadTime = '—'; return c; });
const sellBuilder = (items, { co = 'BK', plan = 'service6', page = true } = {}) => {
  const b = builder();
  b.run(`currentCo = ${JSON.stringify(co)};`);
  if (co === 'BS') b.ctx.document.body.classList.add('co-bs');
  b.el('showStandardPage').type = 'checkbox';       // the real input is one: getPricingFields() reads .checked for a checkbox, .value otherwise
  b.el('warrantyPlan').value = plan; b.el('showStandardPage').checked = page;
  b.run(`items.length = 0; items.push(...${JSON.stringify(items || sampleItems())}); cfgRefreshAll(); renderItems();`);
  return b;
};
const money = (b) => JSON.parse(b.run('JSON.stringify(computeTotals())'));
const priceFields = (b) => b.plain('items.map(i => [i.unitPrice, i.amount, i.qty, i.priceBasis, i.priceManual === true, i.basisUnitPrice, i.needsPrice === true])');
const fillVerifySell = (b) => { for (const [id, v] of Object.entries({ quoteNo: 'BKMLWB261105-001R1', quoteDate: '2026-11-05', salesperson: 'A', clientName: 'Client', clientPhone: '1', clientEmail: 'a@b.c' })) b.el(id).value = v; };

describe('SELLING QUOTE — the markup, the loader and the constants', () => {
  it('js/qb-spec-sheet.js loads last in the builder\'s own script list (after qb-configured.js, ahead of the main script) and is NOT an app-kit script', () => {
    const loader = (HTML.match(/<script>\(function\(\)\{var v=new URLSearchParams[^\n]*?<\/script>\n/) || [''])[0];
    const tags = [...loader.matchAll(/'(js\/[a-z-]+\.js)'/g)].map((m) => m[1]);
    assert.deepEqual(tags.slice(-2), ['js/qb-configured.js', 'js/qb-spec-sheet.js']);
    assert.equal(tags.length, 7);
    assert.equal(typeof makeEnv().run('window.QBSpecSheet.rows'), 'string' === typeof 1 ? 'x' : 'function');
    assert.equal(/<script[^>]*src="js\/qb-spec-sheet/.test(HTML), false, 'never a bare <script src> in the builder: the loader writes it with ?v=');
    assert.equal(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('qb-spec-sheet'), false, 'not an app-kit script of index.html');
  });

  it('the new blocks are in the markup, in print order: …terms → footer → "Our standard" → (internal panel) → photo annex; and the Terms tab carries the warranty plan and the tick', () => {
    const at = (id) => HTML.indexOf(`id="${id}"`);
    for (const id of ['termsSection', 'printFooter', 'standardPage', 'internalPanel', 'photoAnnex', 'agentBox']) assert.ok(at(id) > 0, id);
    assert.ok(at('termsSection') < at('printFooter') && at('printFooter') < at('standardPage') && at('standardPage') < at('photoAnnex') && at('photoAnnex') < at('agentBox'), 'footer, then the Standard page, then the annex');
    assert.match(HTML, /<div class="print-only print-footer" id="printFooter">/);
    assert.match(HTML, /<div class="print-only" id="standardPage"><\/div>/);
    assert.match(HTML, /<div class="print-only doc-notes" id="itemsNotes"><\/div>/);
    assert.match(HTML, /<div class="print-only summary-strip" id="summaryStrip"><\/div>/);
    assert.match(HTML, /<span class="ms-chip shadow no-print" id="qualityChip" style="display:none;"><\/span>/);
    assert.match(HTML, /<div class="no-print" id="termsOptionsBox"/);
    const sel = HTML.match(/<select id="warrantyPlan" onchange="onWarrantyPlanChange\(\)">([\s\S]*?)<\/select>/)[1];
    assert.deepEqual([...sel.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]), ['service6', 'kitchenshield12'], 'the standard plan is first (the default)');
    assert.match(sel, /6-month service warranty \(standard\)/);
    assert.match(sel, /Full kitchen — 6-month service warranty \+ 12 months PMS with KitchenShield™/);
    assert.match(HTML, /<input type="checkbox" id="showStandardPage" checked onchange="onShowStandardPageChange\(\)">/);
    assert.equal(/fullKitchen/.test(HTML), false, 'the fullKitchen checkbox of the first draft of the spec is replaced by the warranty plan (ruling #1)');
  });

  it('warrantyPlan and showStandardPage ride PRICING_IDS (so a draft, a template, a revision and a filed quote keep them), after every older key', () => {
    const ids = makeEnv().plain('PRICING_IDS');
    assert.deepEqual(ids.slice(-2), ['warrantyPlan', 'showStandardPage']);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(HTML.includes('id="warrantyPlan"') && HTML.includes('id="showStandardPage"'), 'both have their control in the Terms tab');
  });

  it('the preview clones the same blocks the PDF prints, in print order, each once (the payment sections live INSIDE the terms); Brilliant Steel keeps its old order', () => {
    const b = makeEnv();
    assert.deepEqual(b.plain('QB_DOC_SOURCE_IDS'), ['lhPrintHeader', 'phSubject', 'billStrip', 'itemsSection', 'diSection', 'timelineSection', 'remarksSection', 'termsSection', 'printFooter', 'standardPage', 'photoAnnex']);
    assert.deepEqual(b.plain('QB_DOC_SOURCE_IDS_BS'), ['lhPrintHeader', 'phSubject', 'billStrip', 'itemsSection', 'diSection', 'timelineSection', 'remarksSection', 'termsSection', 'photoAnnex', 'printFooter']);
    for (const list of [b.plain('QB_DOC_SOURCE_IDS'), b.plain('QB_DOC_SOURCE_IDS_BS')]) assert.equal(list.some((id) => id === 'paymentSection' || id === 'paymentDetailsSection'), false, 'listing the payment sections as well showed them twice in the Client preview');
    assert.deepEqual(b.plain('qbDocSourceIds()'), b.plain('QB_DOC_SOURCE_IDS'));
    b.run(`setCompany('BS')`);
    assert.deepEqual(b.plain('qbDocSourceIds()'), b.plain('QB_DOC_SOURCE_IDS_BS'));
    b.run(`setCompany('BI')`);
    assert.deepEqual(b.plain('qbDocSourceIds()'), b.plain('QB_DOC_SOURCE_IDS'));
    // unifyPaymentIntoTerms puts both payment sections INSIDE #termsSection: that is why the preview must not list them
    assert.match(HTML, /terms\.insertBefore\(el, anchor\)/);
  });

  it('the print CSS: the Standard page is its own page and only when it has content; the sheet\'s cells keep their own two columns; the room for the sheet is Barro Kitchens / Barro Industries only; the alignment fix stays', () => {
    assert.match(HTML, /#standardPage\{display:none!important;\}\n\s*#standardPage\.has-std\{display:block!important;page-break-before:always;break-before:page;\}/);
    assert.match(HTML, /\.items-table \.spec-sheet td\.ss-l\{width:24mm!important;\}\n\s*\.items-table \.spec-sheet td\.ss-v\{width:auto!important;\}/);
    assert.match(HTML, /body:not\(\.co-bs\) \.items-table th:nth-child\(2\)\{width:54%!important;\}/);
    assert.match(HTML, /body:not\(\.co-bs\) \.items-table th:nth-child\(3\),\n\s*body:not\(\.co-bs\) \.items-table th:nth-child\(4\)\{width:7%!important;\}/);
    assert.match(HTML, /body:not\(\.co-bs\) \.cat-row\{page-break-after:avoid;break-after:avoid;\}/);
    // …and the Client preview gets the same room (Barro Kitchens / Barro Industries only; 4 + 54 + 7 + 7 + 12 + 16 = 100), Brilliant Steel's preview keeps its widths
    assert.match(HTML, /body:not\(\.co-bs\) \.qb-doc-sheet \.items-table th:nth-child\(2\)\{width:54%!important;\}\nbody:not\(\.co-bs\) \.qb-doc-sheet \.items-table th:nth-child\(3\),\nbody:not\(\.co-bs\) \.qb-doc-sheet \.items-table th:nth-child\(4\)\{width:7%!important;\}\nbody:not\(\.co-bs\) \.qb-doc-sheet \.items-table th:nth-child\(5\)\{width:12%!important;\}\nbody:not\(\.co-bs\) \.qb-doc-sheet \.items-table th:nth-child\(6\)\{width:16%!important;\}/);
    assert.match(HTML, /\.qb-doc-sheet \.items-table th:nth-child\(2\)\{width:46%!important;\}\n\.qb-doc-sheet \.items-table th:nth-child\(5\)\{width:14%!important;\}\n\.qb-doc-sheet \.items-table th:nth-child\(6\)\{width:18%!important;\}/);
    // Brilliant Steel keeps the widths it always had (4 + 46 + 9 + 9 + 14 + 18 = 100)
    assert.match(HTML, /\.items-table th:nth-child\(2\),\n\s*\.items-table td:nth-child\(2\)\{width:46%!important;\}/);
    assert.match(HTML, /\.items-table th:nth-child\(5\)\{width:14%!important;\}\n\s*\.items-table th:nth-child\(6\)\{width:18%!important;\}/);
    // the already-applied print alignment fix is kept
    assert.match(HTML, /\.spec-edit\{display:block;font-size:8pt;color:#333;\}\n\s*\.dims-edit\{display:block;font-size:8pt;color:#333;\}/);
    // the crew copy carries no sales text
    assert.match(HTML, /body\.body-workforce #standardPage,\nbody\.body-workforce #summaryStrip,\nbody\.body-workforce #itemsNotes\{display:none!important;\}/);
    assert.match(HTML, /body\.co-bs #termsOptionsBox\{display:none!important;\}/);
    assert.match(HTML, /\.qb-doc-sheet #standardPage:not\(\.has-std\)\{display:none!important;\}/);
    assert.match(HTML, /\.qb-doc-sheet #photoAnnex\.has-photos\{margin-top:22px;padding-top:18px;border-top:2px dashed #c9d3e2;\}/);
  });
});

describe('SELLING QUOTE — a Barro Kitchens line prints as a spec sheet; the Estimator keeps its editable lines and gains Details ▸', () => {
  it('the description cell: name, the .print-only spec sheet (Size first), then the editable Specs / Dims / Notes lines — all .no-print — then the cost / config rows and the Details ▸ row', () => {
    const b = sellBuilder();
    const html = b.el('itemsTbody').innerHTML;
    const row = html.split('<tr class="item-row"').find((r) => r.includes('SS Sink'));
    assert.ok(row.indexOf('class="name-cell') < row.indexOf('class="print-only sheet-slot"') && row.indexOf('class="print-only sheet-slot"') < row.indexOf('<span class="spec-tag no-print">Specs</span>'));
    assert.match(row, /<div class="print-only sheet-slot"><table class="spec-sheet"><tr class="ss-row ss-size"><td class="ss-l">Size<\/td><td class="ss-v">L2100 × W700 × H850 mm<\/td><\/tr><tr class="ss-row ss-spec"><td class="ss-l">Material<\/td>/);
    assert.match(row, /<div class="spec-line  no-print"><span class="spec-tag no-print">Specs<\/span>/);
    assert.match(row, /<div class="spec-line  no-print"><span class="spec-tag no-print">Dims<\/span>/);
    assert.match(row, /<div class="notes-cell cell-edit pe-empty no-print"/);
    assert.ok(row.indexOf('line-details-toggle') > row.indexOf('data-cfg-edit'), 'the Details row comes after the config row');
    assert.match(row, /<button type="button" class="cfg-link line-details-toggle" aria-expanded="false" onclick="toggleLineDetails\(1\)">Details ▸<\/button>/);
    // the printed sentence of old is still the editable Specs line (existing tests read it), unchanged
    assert.match(row, /<span class="spec-edit cell-edit"[^>]*>Material: Stainless Steel 304 Food Grade • Sinks: 3 • /);
  });

  it('the sheet carries the finish, includes, not-included and the ruled lead time of a freshly configured line; a catalogue line only what it has; a bare catalogue line only its name', () => {
    const b = sellBuilder();
    const rowOf = (name) => b.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes(name));
    const sheetOf = (name) => (rowOf(name).match(/<table class="spec-sheet">[\s\S]*?<\/table>/) || [''])[0];
    const sink = sheetOf('SS Sink');
    for (const must of ['<td class="ss-l">Finish</td><td class="ss-v">Hairline finish</td>', '<td class="ss-l">Includes</td><td class="ss-v">3 basins with waste fittings and strainers; pre-rinse spray faucet; adjustable bullet feet</td>',
      '<td class="ss-l">Not included</td><td class="ss-v">Water supply and drain line to the sink; angle valves</td>', '<td class="ss-l">Lead time</td><td class="ss-v">25 working days min.</td>', '<tr class="ss-row ss-construction">']) assert.ok(sink.includes(must), must);
    const wash = sheetOf('SS Wash Sink (Single)');
    assert.equal(/Finish|Includes|Lead time|Construction/.test(wash), false, 'a catalogue line states nothing it does not have (its "7-10 days" never prints)');
    assert.match(wash, /Basin Depth<\/td><td class="ss-v">300mm/);
    assert.equal(sheetOf('Undercounter Chiller'), '', 'a bare catalogue line has no sheet');
    assert.match(rowOf('Undercounter Chiller'), /<div class="print-only sheet-slot"><\/div>/);
  });

  it('a LEGACY configured line (none of the new fields) prints exactly the rows it always had — size, material, options, construction — no finish, no includes, no lead time (a reopened quote never changes its document)', () => {
    const b = sellBuilder(legacyOf(sampleItems()));
    const sheet = (b.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes('SS Rack')).match(/<table class="spec-sheet">[\s\S]*?<\/table>/) || [''])[0];
    assert.deepEqual([...sheet.matchAll(/<td class="ss-l">([^<]*)<\/td>/g)].map((m) => m[1]), ['Size', 'Material', 'Tiers', 'Wheels', 'Construction']);
    assert.equal(b.run('QBSpecSheet.docNotes(items).lead'), '', 'no ruled lead on a legacy quote: no lead sentence');
  });

  it('a line in the preparer\'s own wording prints the free text as ONE paragraph and shows "custom wording" + "↺ regenerate"; regenerate deletes the override and the generated rows print again', () => {
    const b = sellBuilder();
    b.run(`items[1].specEdit = 'My own wording\\nsecond line'; renderItems();`);
    const row = b.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes('SS Sink'));
    assert.match(row, /<tr class="ss-row ss-spec"><td class="ss-v" colspan="2">My own wording<br>second line<\/td><\/tr>/);
    assert.equal(/<td class="ss-l">Material<\/td>/.test(row), false);
    assert.match(row, /<span class="ms-chip warn" title="[^"]*">custom wording<\/span><button type="button" class="cfg-link" onclick="regenerateSpecs\(1\)"/);
    const before = priceFields(b);
    b.run('regenerateSpecs(1)');
    assert.equal(b.run(`'specEdit' in items[1]`), false);
    assert.match(b.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes('SS Sink')), /<td class="ss-l">Material<\/td>/);
    assert.deepEqual(priceFields(b), before);
    // a custom line with no structured specs has nothing to regenerate to: no chip
    b.run(`items.push({id:'CUSTOM',category:'miscellaneous',name:'Gate',dims:'L2000 mm',specs:[],specEdit:'Mild steel',qty:1,unit:'pc',unitPrice:9000,amount:9000,formulaType:'fixed'}); renderItems();`);
    assert.equal(/custom wording/.test(b.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes('Gate'))), false);
  });

  it('the chips: "no size" (made-to-order, red), "no specs", "no finish", "no photo" — a photo linked to a line clears its chip; fee lines and Brilliant Steel get none', () => {
    const b = sellBuilder();
    const chips = (name) => { const row = b.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes(name)); const box = (row.match(/<span class="ld-chips"[^>]*>([\s\S]*?)<\/span><\/div>/) || [, ''])[1]; return [...(box.match(/<span class="ms-chip (?:bad|warn|shadow)" title="[^"]*">([^<]*)<\/span>/g) || [])].map((x) => x.replace(/<[^>]*>/g, '')); };
    assert.deepEqual(chips('SS Sink'), ['no photo']);
    assert.deepEqual(chips('SS Wash Sink (Single)'), ['no finish', 'no photo'], 'catalogue lines per length are made to order: they lack a finish; they have specs and a size');
    assert.deepEqual(chips('Undercounter Chiller'), ['no specs', 'no photo']);
    b.run(`quotePhotos.push({ url: 'https://firebasestorage.googleapis.com/x', caption: '', itemIndex: 1 }); renderItems();`);
    assert.deepEqual(chips('SS Sink'), [], 'a linked photo clears the chip');
    b.run(`items.push({id:'CUSTOM',category:'miscellaneous',name:'Pass-through shelf',dims:'',specs:[],specEdit:'',qty:1,unit:'pc',unitPrice:1000,amount:1000,formulaType:'fixed'}); renderItems();`);
    assert.deepEqual(chips('Pass-through shelf'), ['no size', 'no specs', 'no finish', 'no photo']);
    assert.match(b.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes('Pass-through shelf')), /<span class="ms-chip bad" title="[^"]*">no size<\/span>/);
    const bs = sellBuilder(sampleItems(), { co: 'BS' });
    assert.equal(/line-details|ms-chip (?:bad|warn|shadow)" title="No photo|no photo|no size/.test(bs.el('itemsTbody').innerHTML), false, 'Brilliant Steel: no Details row, no chips');
  });

  it('Brilliant Steel\'s rows are the OLD rows: no sheet slot, no Details row, and the Specs / Dims / Notes lines keep their classes (they print, as they always did)', () => {
    const bs = sellBuilder(sampleItems(), { co: 'BS' });
    const row = bs.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes('SS Sink'));
    assert.equal(/sheet-slot|spec-sheet|line-details/.test(row), false);
    assert.match(row, /<div class="spec-line "><span class="spec-tag no-print">Specs<\/span><span class="spec-edit cell-edit"/);
    assert.match(row, /<div class="spec-line "><span class="spec-tag no-print">Dims<\/span><span class="dims-edit cell-edit"/);
    assert.match(row, /<div class="notes-cell cell-edit pe-empty" contenteditable="true"/);
    assert.equal(bs.run('docSheetOn()'), false);
    assert.equal(bs.run('lineDetailsHtml(items[0], 0)'), '');
    assert.equal(bs.run('lineChipsHtml(items[0], 0)'), '', 'the chips helper itself refuses Brilliant Steel (not only its callers)');
    assert.equal(bs.el('qualityChip').style.display, 'none');
  });

  it('without the helper file (an offline copy that failed to load it) the builder degrades to the old rows — it never throws', () => {
    const b = builder();
    b.run('delete window.QBSpecSheet;');
    b.run(`items.length = 0; items.push(...${JSON.stringify(sampleItems())}); cfgRefreshAll();`);
    assert.doesNotThrow(() => b.run('renderItems(); renderDocExtras(); buildVerifyModal();'));
    assert.equal(b.run('docSheetOn()'), false);
    assert.equal(b.run('canFile.name'), 'canFile');
    assert.equal(/sheet-slot/.test(b.el('itemsTbody').innerHTML), false);
  });

  it('the Details editor (open): the four finishes + "not stated" with the current one pressed, includes / not-included one per line, extra rows; closed, nothing of it is in the markup', () => {
    const b = sellBuilder();
    assert.equal(/class="line-details no-print"/.test(b.el('itemsTbody').innerHTML), false);
    b.run('toggleLineDetails(1)');
    const row = b.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes('SS Sink'));
    assert.match(row, /aria-expanded="true" onclick="toggleLineDetails\(1\)">Details ▾<\/button>/);
    const ed = row.match(/<div class="line-details no-print" data-ld="1">[\s\S]*?<div class="ld-hint">/)[0];
    assert.deepEqual([...ed.matchAll(/<button type="button" class="ld-pill" aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[2], m[1]]), [['Hairline', 'true'], ['Brushed', 'false'], ['Mirror', 'false'], ['Satin', 'false'], ['not stated', 'false']]);
    assert.ok(ed.includes('onclick="editFinish(1,\'hairline\')"') && ed.includes('onclick="editFinish(1,\'\')"'));
    assert.match(ed, /<textarea rows="3" placeholder="One item per line" aria-label="Includes" onchange="editIncludes\(1,this\)">3 basins with waste fittings and strainers\npre-rinse spray faucet\nadjustable bullet feet<\/textarea>/);
    assert.match(ed, /<textarea rows="2" placeholder="One item per line" aria-label="Not included" onchange="editExcludes\(1,this\)">water supply and drain line to the sink\nangle valves<\/textarea>/);
    assert.match(ed, /onclick="addSpecLine\(1\)">＋ Add a row<\/button>/);
    // the open state is screen state: never in the payload or the saved draft
    b.run('flushSaveToStorageNow()');
    assert.equal(/_detailsOpen|line-details/.test(b.store.get('bkqb_items') + JSON.stringify(b.plain('buildQuotePayload()'))), false);
    b.run('toggleLineDetails(1)');
    assert.equal(/class="line-details no-print"/.test(b.el('itemsTbody').innerHTML), false);
  });

  it('user text never reaches the markup raw: a "<" in an include, an extra row, a note and a name is escaped in the sheet AND in the editor', () => {
    const b = sellBuilder();
    b.run(`items[1].includes = ['<img src=x onerror=alert(1)>']; items[1].excludes = ['a "quoted" <b>']; items[1].specLines = [{ label: '<i>L', value: '</td><script>x</script>' }]; items[1].notes = '<u>n</u>'; items[1].name = '<s>Sink</s>'; toggleLineDetails(1);`);
    const row = b.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes('Sink'));
    { const stripped = row.replace(/<\/?(tr|td|div|span|table|button|textarea|input|section)\b[^>]*>/g, ''); const m = /<(img|script|i|u|s|b)[ >]/.exec(stripped); assert.equal(m, null, m ? stripped.slice(Math.max(0, m.index - 80), m.index + 120) : ''); }
    assert.ok(row.includes('&lt;img src=x onerror=alert(1)&gt;') && row.includes('&lt;/td&gt;&lt;script&gt;x&lt;/script&gt;'));
    // the editor's own inputs (the strip above eats a tag-looking value inside an attribute, so look at them directly)
    assert.ok(row.includes('value="&lt;i&gt;L"') && row.includes('value="&lt;/td&gt;&lt;script&gt;x&lt;/script&gt;"'), 'the extra-row inputs hold the escaped label and value');
    assert.equal(row.includes('value="<i>L"') || row.includes('value="</td>'), false, 'an extra-row input carries raw markup');
  });
});

describe('SELLING QUOTE — the Details handlers change the line\'s own fields and NEVER a price', () => {
  const lineOf = (b) => b.plain('items[1]');
  it('editFinish / editIncludes / editExcludes / addSpecLine / editSpecLine / removeSpecLine / regenerateSpecs: each sets its field, saves, repaints, flashes — and every price, basis and the totals are byte-identical', () => {
    const b = sellBuilder();
    const prices = priceFields(b), totals = JSON.stringify(money(b));
    const el = (value) => ({ value });
    b.run(`editFinish(1, 'mirror')`);
    assert.equal(lineOf(b).finish, 'mirror');
    b.run(`editIncludes(1, ${JSON.stringify(el(' one \n\ntwo\nthree '))})`);
    assert.deepEqual(lineOf(b).includes, ['one', 'two', 'three']);
    b.run(`editExcludes(1, ${JSON.stringify(el('a\nb'))})`);
    assert.deepEqual(lineOf(b).excludes, ['a', 'b']);
    b.run('addSpecLine(1)');
    assert.deepEqual(lineOf(b).specLines, [{ label: '', value: '' }]);
    assert.equal(b.run('_detailsOpen.has(items[1])'), true, 'adding a row opens the editor');
    b.run(`editSpecLine(1, 0, 'label', ${JSON.stringify(el('  Capacity '))}); editSpecLine(1, 0, 'value', ${JSON.stringify(el('2 x 10 L'))})`);
    assert.deepEqual(lineOf(b).specLines, [{ label: 'Capacity', value: '2 x 10 L' }]);
    assert.match(b.el('itemsTbody').innerHTML.split('<tr class="item-row"').find((r) => r.includes('SS Sink')), /<td class="ss-l">Finish<\/td><td class="ss-v">Mirror finish<\/td>/);
    b.run('removeSpecLine(1, 0)');
    assert.deepEqual(lineOf(b).specLines, []);
    b.run(`items[1].specEdit = 'x'; regenerateSpecs(1)`);
    assert.equal('specEdit' in lineOf(b), false);
    assert.deepEqual(priceFields(b), prices, 'no price, basis or flag moved');
    assert.equal(JSON.stringify(money(b)), totals, 'the totals are byte-identical');
  });

  it('caps and guards: an unknown finish is ignored (the line keeps its finish), "not stated" clears it, 12 includes of 160 characters at most, a row\'s label 60 and value 300, 12 extra rows at most, a stranger\'s index or field does nothing', () => {
    const b = sellBuilder();
    b.run(`editFinish(1, 'matte'); editFinish(1, 'HAIRLINE'); editFinish(1, 5);`);
    assert.equal(lineOf(b).finish, 'hairline');
    b.run(`editFinish(1, '')`);
    assert.equal(lineOf(b).finish, '');
    b.run(`editIncludes(1, ${JSON.stringify({ value: Array.from({ length: 20 }, (_, i) => `${i}${'x'.repeat(200)}`).join('\n') })})`);
    assert.equal(lineOf(b).includes.length, 12);
    assert.equal(lineOf(b).includes.every((t) => t.length === 160), true);
    for (let i = 0; i < 14; i++) b.run('addSpecLine(1)');
    assert.equal(lineOf(b).specLines.length, 12);
    assert.match(b.toast(), /Twelve extra rows/);
    b.run(`editSpecLine(1, 0, 'label', ${JSON.stringify({ value: 'L'.repeat(100) })}); editSpecLine(1, 0, 'value', ${JSON.stringify({ value: 'V'.repeat(400) })})`);
    assert.deepEqual([lineOf(b).specLines[0].label.length, lineOf(b).specLines[0].value.length], [60, 300]);
    const snap = JSON.stringify(b.plain('items'));
    b.run(`editSpecLine(1, 0, 'price', { value: '1' }); editSpecLine(1, 99, 'label', { value: 'x' }); editSpecLine(99, 0, 'label', { value: 'x' }); editFinish(99, 'mirror'); editIncludes(99, { value: 'x' }); removeSpecLine(1, 99); removeSpecLine(99, 0); regenerateSpecs(99); toggleLineDetails(99); addSpecLine(99)`);
    assert.equal(JSON.stringify(b.plain('items')), snap);
  });

  it('the finish is a pill group: pressing a pill sets exactly that finish; the sheet follows', () => {
    const b = sellBuilder();
    for (const f of ['brushed', 'satin', 'mirror', 'hairline']) {
      b.run(`editFinish(1, ${JSON.stringify(f)})`);
      assert.equal(lineOf(b).finish, f);
      assert.ok(b.el('itemsTbody').innerHTML.includes(`<td class="ss-l">Finish</td><td class="ss-v">${QS.FINISH_LABELS[f]}</td>`));
    }
  });
});

describe('SELLING QUOTE — the price math is untouched (acceptance 3): totals, VAT, discount, commission, payment schedule are byte-identical with and without the new fields', () => {
  it('the sample quote\'s totals are the figures the review\'s printed quotation carried before this phase — ₱433,300 subtotal, ₱51,996 VAT, ₱485,296 grand total — for the new lines and for the same lines stripped of every new field', () => {
    for (const items of [sampleItems(), legacyOf(sampleItems())]) {
      const b = sellBuilder(items);
      b.el('showVat').checked = true;
      const t = money(b);
      assert.deepEqual([t.subtotal, t.vatAmt, t.grand, t.discountAmt, t.commissionAmt], [433300, 51996, 485296, 0, 0]);
    }
  });

  it('every pricing control — VAT, a percent discount, a commission, a down payment and staggered balance, an installment plan, milestones, an options quote — gives the same JSON with the new fields as without them', () => {
    const variants = [
      () => {}, (b) => { b.el('showVat').checked = true; }, (b) => { b.el('showVat').checked = true; b.el('discountPct').value = '10'; b.el('commissionPct').value = '3'; },
      (b) => { b.el('dpMode').value = '30'; b.el('balMode').value = 'stagger3'; }, (b) => { b.el('dpMode').value = '20'; b.el('balMode').value = 'install6'; b.el('interestRate').value = '8'; },
      (b) => { b.el('optionsMode').checked = true; b.el('discountPct').value = '5'; b.el('showVat').checked = true; },
      (b) => { b.run(`payMilestones = [{pct:40,label:'Upon order',date:''},{pct:30,label:'Upon fabrication',date:''},{pct:30,label:'Upon delivery',date:''}]`); },
    ];
    const pack = (b) => {
      b.run('renderItems()');
      const pl = b.plain('buildQuotePayload()');
      return JSON.stringify({ totals: money(b), totalsTbl: b.el('totalsTbl').innerHTML, paymentSummary: b.el('paymentSummary').innerHTML,
        payload: { subtotal: pl.subtotal, discountAmount: pl.discountAmount, netAmount: pl.netAmount, vatAmount: pl.vatAmount, total: pl.total, grandTotal: pl.grandTotal, commissionPct: pl.commissionPct, commissionAmount: pl.commissionAmount, payment: pl.payment, optionsBasis: pl.optionsBasis, options: (pl.options || []).map(({ label, ...r }) => r), timeline: pl.timeline },
        prices: priceFields(b) });
    };
    variants.forEach((setV, i) => {
      const a = sellBuilder(sampleItems()); setV(a);
      const c = sellBuilder(legacyOf(sampleItems())); setV(c);
      assert.equal(pack(a), pack(c), `variant ${i}`);
    });
  });

  it('the document options change no figure: the warranty plan, the Standard page tick, the finish, includes, extra rows and the Details toggle leave computeTotals() and every price as they were', () => {
    const b = sellBuilder(); b.el('showVat').checked = true; b.el('discountPct').value = '10';
    const totals = JSON.stringify(money(b)), prices = priceFields(b);
    b.el('warrantyPlan').value = 'kitchenshield12'; b.run('onWarrantyPlanChange()');
    b.el('showStandardPage').checked = false; b.run('onShowStandardPageChange()');
    b.run(`editFinish(0, 'satin'); editIncludes(0, { value: 'a\\nb' }); addSpecLine(0); toggleLineDetails(0); renderItems(); renderDocExtras();`);
    assert.equal(JSON.stringify(money(b)), totals);
    assert.deepEqual(priceFields(b), prices);
  });

  it('the new modules carry no price logic: the builder\'s print / sheet code reads no unitPrice (the only reads of a price are the ones that were already there)', () => {
    const raw = HTML.slice(HTML.indexOf('//  SPEC SHEET, LINE DETAILS, COMPLETENESS, SUMMARY AND "OUR STANDARD"'), HTML.indexOf('function renderItems(){'));
    assert.ok(raw.length > 6000);
    const block = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    assert.equal(/unitPrice|\.amount|priceBasis|priceManual|basisUnitPrice|computeTotals|\.grand\b|formatPeso|capitalMaterials/.test(block), false);
  });
});

describe('SELLING QUOTE — Verify & File: a made-to-order line with no size is a HARD block; the rest of the document check only warns (owner ruling #5)', () => {
  // a custom line with a bill of materials: made to order (a "no costing" custom line is bought-in, so it would never be blocked)
  const noSize = { id: 'CUSTOM', category: 'miscellaneous', name: 'Stainless pass-through shelf', dims: '', specs: [], specEdit: '', qty: 1, unit: 'pc', unitPrice: 12000, amount: 12000, formulaType: 'fixed', costMat: 5000, bom: [{ name: 'x', qty: 1, unitPrice: 5000 }] };
  it('canFile() is false while a made-to-order line states no size — with every other check filled — and true once it has a dims text (or a numeric size)', () => {
    const b = sellBuilder([sampleItems()[1]]);
    fillVerifySell(b);
    assert.equal(b.run('canFile()'), true, 'the harness fills every other check');
    b.run(`items.push(${JSON.stringify(noSize)}); renderItems();`);
    assert.equal(b.run('canFile()'), false);
    assert.match(b.run('sizeBlockReason()'), /^1 made-to-order line\(s\) have no size — add the dimensions \(e\.g\. L1200 × W600 × H850 mm\) in the Dims line \(#2 Stainless pass-through shelf\)\.$/);
    b.run(`items[1].dims = 'L1200 × W600 × H850 mm'; renderItems();`);
    assert.equal(b.run('canFile()'), true);
    b.run(`items[1].dims = ''; items[1].size = { W: 1200 }; renderItems();`);
    assert.equal(b.run('canFile()'), true, 'a numeric size is a size');
    b.run(`items[1].size = {}; renderItems();`);
    assert.equal(b.run('canFile()'), false);
  });

  it('a configured line with no size, a per-length catalogue line with none, are blocked too; a bought-in fixed line, a pass-through, a "no costing" custom line and a fee line are not', () => {
    const b = sellBuilder([]);
    fillVerifySell(b);
    const blocked = (line) => { b.run(`items.length = 0; items.push(${JSON.stringify({ category: 'miscellaneous', qty: 1, unit: 'pc', unitPrice: 5000, amount: 5000, ...line })}); renderItems();`); return b.run('canFile()') === false; };
    assert.equal(blocked({ id: 'PW-004', name: 'Sink', familyId: 'sink', config: {}, size: {}, dims: '', priceBasis: 'manual', priceManual: true }), true);
    assert.equal(blocked({ id: 'PW-004', name: 'Sink', formulaType: 'per_length', dims: '' }), true);
    assert.equal(blocked({ id: 'RF-004', name: 'Chiller', formulaType: 'fixed', dims: '' }), false);
    assert.equal(blocked({ id: 'CUSTOM', name: 'Client-supplied unit', dims: '', noCosting: true }), false);
    assert.equal(blocked({ id: 'CUSTOM', name: 'Supplier item', dims: '', passThrough: true, costMat: 1000 }), false);
    assert.equal(blocked({ id: 'MISCFEE', name: 'Delivery', dims: '', formulaType: 'per_length' }), false);
  });

  it('Brilliant Steel is never blocked by it (its quotations are left exactly as they were)', () => {
    const b = sellBuilder([noSize], { co: 'BS' });
    fillVerifySell(b);
    assert.equal(b.run('sizeBlockReason()'), '');
    assert.equal(b.run('canFile()'), true);
    b.run('buildVerifyModal()');
    assert.equal(/Made-to-order Lines Without a Size|Document completeness/.test(b.el('verifyBody').innerHTML), false);
  });

  it('fileQuotation() is a second gate: it posts nothing for a made-to-order line with no size even if canFile() were fooled, and files the quote once the size is typed', async () => {
    const b = sellBuilder([sampleItems()[1], noSize]);
    fillVerifySell(b);
    b.run('canFile = () => true;');
    await b.run('fileQuotation()');
    assert.equal(b.posted.filter((p) => /^QUOTE_/.test(p.msg.type)).length, 0, 'an unsized line reached the bridge');
    assert.match(b.toast(), /1 made-to-order line\(s\) have no size/);
    b.run(`items[1].dims = 'L900 mm'`);
    await b.run('fileQuotation()');
    assert.ok(b.posted.find((p) => p.msg.type === 'QUOTE_FILED'), 'a sized quote files');
  });

  it('the modal: a red "Made-to-order Lines Without a Size" block naming the line by the number the table shows, the File button disabled — and the document-completeness list beside it', () => {
    const b = sellBuilder([...sampleItems(), noSize]);
    fillVerifySell(b);
    b.run('buildVerifyModal()');
    const html = b.el('verifyBody').innerHTML;
    assert.match(html, /Made-to-order Lines Without a Size/);
    assert.match(html, /1 made-to-order line\(s\) have no size — add the dimensions \(e\.g\. L1200 × W600 × H850 mm\) in the Dims line \(#\d+ Stainless pass-through shelf\)\./);
    assert.equal(b.el('fileBtn').disabled, true);
    const q = b.plain('docQuality()');
    assert.match(html, new RegExp(`Document completeness — Quote strength ${q.outOf10}/10`));
    assert.match(html, /\d lines? (?:has|have) no specs, \d (?:has|have) no finish — you can still file\./);
    // numbered as the TABLE numbers them (section order), not by array position
    const shown = b.plain(`lineNoOf(${b.run('items.length') - 1})`);
    assert.ok(html.includes(`#${shown} Stainless pass-through shelf`), `the block names the line as the table does (#${shown})`);
  });

  it('the modal escapes every line name it prints (the size block and the completeness list) and numbers a line by the TABLE\'s number even when its section prints before the lines that come earlier in the list', () => {
    const early = { ...noSize, category: 'cooking_line', name: 'Shelf <b>X</b>' };       // a section that prints first: its number is not its position
    const weak = { id: 'CUSTOM', category: 'miscellaneous', name: 'Plain <i>Y</i>', dims: 'L1 mm', specs: [], specEdit: '', qty: 1, unit: 'pc', unitPrice: 1000, amount: 1000, formulaType: 'fixed' };
    const b = sellBuilder([...sampleItems(), early, weak]);
    fillVerifySell(b);
    b.run('buildVerifyModal()');
    const html = b.el('verifyBody').innerHTML;
    assert.equal(/<b>X<\/b>|<i>Y<\/i>/.test(html), false, 'a line name reached the modal raw');
    const at = b.run('items.length') - 2;                                                  // the array position of the sample's last-but-one line: the "early" one
    const shown = b.plain(`lineNoOf(${at})`);
    assert.notEqual(shown, at + 1, 'fixture: the number the table shows is not the array position');
    assert.ok(html.includes(`(#${shown} Shelf &lt;b&gt;X&lt;/b&gt;)`), `the size block names it as #${shown} and escapes it: ${html.slice(html.indexOf('Made-to-order'), html.indexOf('Made-to-order') + 400)}`);
    assert.equal(html.includes(`#${at + 1} Shelf`), false, 'never the array position');
    assert.ok(html.includes('Plain &lt;i&gt;Y&lt;/i&gt; — no specs'), 'the completeness list escapes too');
  });

  it('a quote with every sheet complete says so and does not block; weak lines (no specs / no finish) only WARN — the quote still files', async () => {
    const complete = sellBuilder([sampleItems()[0], sampleItems()[1]]);
    fillVerifySell(complete);
    complete.run('buildVerifyModal()');
    assert.match(complete.el('verifyBody').innerHTML, /Every line has its specs and a finish\./);
    assert.equal(complete.el('fileBtn').disabled, false);
    const weak = sellBuilder([sampleItems()[1], sampleItems()[6], sampleItems()[5]]);
    fillVerifySell(weak);
    weak.run('buildVerifyModal()');
    const html = weak.el('verifyBody').innerHTML;
    assert.match(html, /1 line has no specs, 1 has no finish — you can still file\./);
    assert.match(html, /Undercounter Chiller — no specs/);
    assert.match(html, /SS Wash Sink \(Single\) with Gooseneck Faucet — no finish/);
    assert.equal(/Made-to-order Lines Without a Size/.test(html), false);
    assert.equal(weak.run('canFile()'), true);
    await weak.run('fileQuotation()');
    assert.ok(weak.posted.find((p) => p.msg.type === 'QUOTE_FILED'));
  });

  it('the quote strength: "Quote strength n/10" beside the Quote Items title and in the running pill; hidden with no lines; scored per line (a bought-in line with specs and a photo is complete)', () => {
    const b = sellBuilder();
    const q = b.plain('docQuality()');
    assert.equal(q.count, 8);
    assert.equal(b.el('qualityChip').textContent, `Quote strength ${q.outOf10}/10`);
    assert.match(b.el('qualityChip').className, /^ms-chip (?:ok|warn|bad) no-print$/);
    assert.notEqual(b.el('qualityChip').style.display, 'none');
    assert.match(b.el('runningTotalPill').textContent, new RegExp(` · Strength ${q.outOf10}/10$`));
    b.run('items.length = 0; renderItems();');
    assert.equal(b.el('qualityChip').style.display, 'none');
    // ≥ 8 green, 5-7 amber, < 5 red
    const cls = (items) => { const c = sellBuilder(items); return c.el('qualityChip').className; };
    assert.match(cls([{ ...sampleItems()[1] }]), /ms-chip ok/, 'a complete sheet that only lacks a photo is 8/10');
    assert.match(cls([{ ...sampleItems()[1], finish: '' }]), /ms-chip warn/, 'no finish and no photo: 6/10');
    assert.match(cls([{ ...sampleItems()[6] }]), /ms-chip bad/);
    assert.match((() => { const c = sellBuilder([sampleItems()[1]]); c.run(`quotePhotos.push({ url: 'https://firebasestorage.googleapis.com/x', caption: '', itemIndex: 0 }); renderItems();`); return c.el('qualityChip').className; })(), /ms-chip ok/);
  });
});

describe('SELLING QUOTE — what a saved quote carries: the four new fields, the warranty plan and the Standard page tick', () => {
  const fieldsOf = (it) => ({ finish: it.finish, includes: it.includes, excludes: it.excludes, specLines: it.specLines, leadTime: it.leadTime });
  it('the new fields survive buildQuotePayload() (the filed items AND editableState.items), loadEditableState(), the localStorage draft and stripTemplateState()', () => {
    const b = sellBuilder();
    b.run(`items[1].finish = 'satin'; items[1].includes = ['one', 'two']; items[1].excludes = ['three']; items[1].specLines = [{ label: 'Capacity', value: '2 x 10 L' }];`);
    const want = fieldsOf(b.plain('items[1]'));
    assert.deepEqual(want, { finish: 'satin', includes: ['one', 'two'], excludes: ['three'], specLines: [{ label: 'Capacity', value: '2 x 10 L' }], leadTime: '25 working days' });
    const pl = b.plain('buildQuotePayload()');
    assert.deepEqual(fieldsOf(pl.items[1]), want);
    assert.deepEqual(fieldsOf(pl.editableState.items[1]), want);
    b.run('flushSaveToStorageNow()');
    assert.deepEqual(fieldsOf(JSON.parse(b.store.get('bkqb_items'))[1]), want);
    // …through a reopen, through a template, and back
    const re = sellBuilder([]);
    re.run(`loadEditableState(${JSON.stringify(pl.editableState)}, { asRevision: false })`);
    assert.deepEqual(fieldsOf(re.plain('items[1]')), want);
    const tpl = b.plain(`stripTemplateState(buildQuotePayload().editableState)`);
    assert.deepEqual(fieldsOf(tpl.items[1]), want);
    assert.equal(tpl.clientName, '');
    const fromTpl = sellBuilder([]);
    fromTpl.run(`loadEditableState(${JSON.stringify(tpl)}, { asRevision: false })`);
    assert.deepEqual(fieldsOf(fromTpl.plain('items[1]')), want);
    assert.equal(fromTpl.run('buildQuotePayload().items.every(i => !("_cfg" in i))'), true, '`_cfg` still never leaves');
  });

  it('warrantyPlan and showStandardPage ride getPricingFields() → the payload\'s editableState.pricing → loadEditableState(); a draft resumes them', () => {
    const b = sellBuilder(sampleItems(), { plan: 'kitchenshield12', page: false });
    const pr = b.plain('getPricingFields()');
    assert.equal(pr.warrantyPlan, 'kitchenshield12');
    assert.equal(pr.showStandardPage, false);
    const pl = b.plain('buildQuotePayload()');
    assert.equal(pl.editableState.pricing.warrantyPlan, 'kitchenshield12');
    assert.equal(pl.editableState.pricing.showStandardPage, false);
    const re = sellBuilder([], { plan: 'service6', page: true });
    re.run(`loadEditableState(${JSON.stringify(pl.editableState)}, { asRevision: false })`);
    assert.equal(re.el('warrantyPlan').value, 'kitchenshield12');
    assert.equal(re.el('showStandardPage').checked, false);
    b.run('flushSaveToStorageNow()');
    const saved = JSON.parse(b.store.get('bkqb_pricing'));
    assert.deepEqual([saved.warrantyPlan, saved.showStandardPage], ['kitchenshield12', false]);
  });

  it('a state with NO plan reads two ways: a REOPEN / REVISION of a filing (the app stamps sourceDocId) is "as issued" (the select holds \'\', no Standard page); anything else — a draft saved before the plan existed, a link, a state with no pricing — is the current rules (6-month plan, Standard page ticked)', () => {
    const state = (extra) => ({ currentCo: 'BK', items: legacyOf(sampleItems()), pricing: { showVat: true, quoteValidDays: '30' }, ...extra });
    const b = sellBuilder([], { plan: 'kitchenshield12', page: true });
    b.run(`loadEditableState(${JSON.stringify(state({ sourceDocId: 'Q-1', sourceCollection: 'bk_quotes', rootQuoteId: 'Q-1' }))}, { asRevision: false })`);
    assert.equal(b.el('warrantyPlan').value, '');
    assert.equal(b.run('isLegacyDoc()'), true);
    assert.equal(b.el('showStandardPage').checked, false);
    assert.equal(b.el('standardPage').innerHTML, '');
    b.run(`loadEditableState({ currentCo: 'BK', items: [], sourceDocId: 'Q-2' }, { asRevision: false })`);
    assert.equal(b.el('warrantyPlan').value, '', 'a reopened filing with no pricing at all is "as issued" too');
    assert.equal(b.el('showStandardPage').checked, false);
    // not a reopen: the current rules
    b.run(`loadEditableState(${JSON.stringify(state())}, { asRevision: false })`);
    assert.equal(b.el('warrantyPlan').value, 'service6');
    assert.equal(b.run('isLegacyDoc()'), false);
    assert.equal(b.el('showStandardPage').checked, true, 'a draft saved before the plan existed is a quote of the current rules: the page is ticked');
    b.run(`loadEditableState({ currentCo: 'BK', items: [] }, { asRevision: false })`);
    assert.equal(b.el('warrantyPlan').value, 'service6');
    assert.equal(b.el('showStandardPage').checked, true);
    // a stored tick / plan is honoured as it is, reopen or not
    b.run(`loadEditableState(${JSON.stringify(state({ sourceDocId: 'Q-3', pricing: { warrantyPlan: 'kitchenshield12', showStandardPage: false } }))}, { asRevision: false })`);
    assert.deepEqual([b.el('warrantyPlan').value, b.el('showStandardPage').checked, b.run('isLegacyDoc()')], ['kitchenshield12', false, false]);
    // a garbled plan is never "as issued" by accident (an unknown value would otherwise blank the select)
    for (const junk of ['service12', 'KITCHENSHIELD12', 7, null, true]) {
      b.run(`loadEditableState(${JSON.stringify(state({ pricing: { warrantyPlan: junk } }))}, { asRevision: false })`);
      assert.equal(b.el('warrantyPlan').value, 'service6', String(junk));
    }
  });

  it('changing the warranty plan, or the Standard-page tick, schedules a save — so a draft, a template and a filed quote keep the choice', () => {
    const b = sellBuilder();
    b.run('renderTotals = function () {}; renderItems = function () {};');      // renderTotals() saves too: only the handlers' own save may schedule here
    b.run('flushSaveToStorageNow()');
    assert.equal(b.run('_saveToStorageTimer === null'), true, 'fixture: nothing pending');
    b.el('warrantyPlan').value = 'kitchenshield12'; b.run('onWarrantyPlanChange()');
    assert.equal(b.run('_saveToStorageTimer !== null'), true, 'the plan change was not saved');
    b.run('flushSaveToStorageNow()');
    assert.equal(JSON.parse(b.store.get('bkqb_pricing')).warrantyPlan, 'kitchenshield12');
    assert.equal(b.run('_saveToStorageTimer === null'), true);
    b.el('showStandardPage').checked = false; b.run('onShowStandardPageChange()');
    assert.equal(b.run('_saveToStorageTimer !== null'), true, 'the tick was not saved');
    b.run('flushSaveToStorageNow()');
    assert.equal(JSON.parse(b.store.get('bkqb_pricing')).showStandardPage, false);
  });

  it('a brand-new quote (🗑 New) starts on the 6-month plan with the Standard page ticked', () => {
    const b = sellBuilder(sampleItems(), { plan: 'kitchenshield12', page: false });
    b.run('clearForm()');
    assert.equal(b.el('warrantyPlan').value, 'service6');
    assert.equal(b.el('showStandardPage').checked, true);
  });
});

describe('SELLING QUOTE — the Warranty and Site Requirements terms in the builder: per plan, per company; a stored wording always wins; an unedited block keeps following its default', () => {
  const WARRANTY_6 = '6-month service warranty on our equipment and work. Warranty does not cover misuse, physical damage, or failure to maintain the equipment.';
  const KS = 'This project includes 12 months of preventive maintenance service (PMS) with KitchenShield™.';
  const termHtml = (b, id) => { const grid = b.el('termsGrid').innerHTML; return (grid.split('<div class="terms-block').find((x) => x.includes(`saveTerm('${id}'`)) || '').split('>').slice(-2, -1).join('>') ? grid.split('<div class="terms-block').find((x) => x.includes(`saveTerm('${id}'`)).match(/<div class="term-content"[^>]*>([\s\S]*?)<\/div>/)[1] : ''; };

  it('renderTerms() prints the plan\'s wording: the 6-month sentence by default, plus the PMS sentence on the full-kitchen plan; switching the plan re-renders it', () => {
    const b = sellBuilder();
    b.run('renderTerms()');
    assert.equal(termHtml(b, 'tc_warranty'), WARRANTY_6);
    b.el('warrantyPlan').value = 'kitchenshield12'; b.run('onWarrantyPlanChange()');
    assert.equal(termHtml(b, 'tc_warranty'), `${WARRANTY_6} ${KS}`);
    b.el('warrantyPlan').value = 'service6'; b.run('onWarrantyPlanChange()');
    assert.equal(termHtml(b, 'tc_warranty'), WARRANTY_6);
  });

  it('a quote filed before this phase with a stored termsContent.tc_warranty keeps its stored wording — whatever the plan (regression: the stored override still wins)', () => {
    const OLD = '12 months warranty on fabrication workmanship. Warranty does not cover misuse, physical damage, or failure to maintain equipment properly.';
    const b = sellBuilder([], { plan: 'kitchenshield12' });
    b.run(`loadEditableState({ currentCo: 'BK', items: [], termsContent: { tc_warranty: ${JSON.stringify(OLD)} }, pricing: { warrantyPlan: 'kitchenshield12', showStandardPage: true } }, { asRevision: false })`);
    assert.equal(termHtml(b, 'tc_warranty'), OLD);
    assert.equal(b.run('termsContent.tc_warranty'), OLD);
  });

  it('saveTerm stores a block only when the preparer CHANGED it: clicking in and out of the default leaves nothing stored (so a later plan change still reaches it); an edit is stored and then wins', () => {
    const b = sellBuilder();
    b.run('renderTerms()');
    b.run(`saveTerm('tc_warranty', { innerHTML: ${JSON.stringify(WARRANTY_6)} })`);
    assert.equal(b.run(`'tc_warranty' in termsContent`), false, 'an unedited default is not stored');
    b.el('warrantyPlan').value = 'kitchenshield12'; b.run('onWarrantyPlanChange()');
    assert.equal(termHtml(b, 'tc_warranty'), `${WARRANTY_6} ${KS}`, 'it follows the plan');
    b.run(`saveTerm('tc_warranty', { innerHTML: 'Our own warranty wording.' })`);
    assert.equal(b.run('termsContent.tc_warranty'), 'Our own warranty wording.');
    b.el('warrantyPlan').value = 'service6'; b.run('onWarrantyPlanChange()');
    assert.equal(termHtml(b, 'tc_warranty'), 'Our own warranty wording.', 'a stored wording wins');
    // an old stored default (a block that was clicked in before this rule) is also "the stored wording": it is the preparer's, and stays
    b.run(`saveTerm('tc_validity', { innerHTML: 'This quotation is valid for 30 days from date of issuance. Prices are subject to change after validity.' })`);
    assert.equal(b.run(`'tc_validity' in termsContent`), false);
  });

  it('Site Requirements names the company that is quoting (Barro Kitchens / Barro Industries OPC); Brilliant Steel keeps its old wording, for both terms, whatever the plan', () => {
    const b = sellBuilder();
    for (const [co, name] of [['BK', 'Barro Kitchens'], ['BI', 'Barro Industries OPC']]) {
      b.run(`setCompany(${JSON.stringify(co)})`);
      assert.equal(termHtml(b, 'tc_site'), `Client is responsible for ensuring site is ready for installation. ${name} is not liable for delays due to unprepared site conditions.`, co);
      assert.equal(termHtml(b, 'tc_warranty'), WARRANTY_6, co);
    }
    b.el('warrantyPlan').value = 'kitchenshield12';
    b.run(`setCompany('BS')`);
    assert.equal(termHtml(b, 'tc_warranty'), '12 months warranty on fabrication workmanship. Warranty does not cover misuse, physical damage, or failure to maintain equipment properly.');
    assert.equal(termHtml(b, 'tc_site'), 'Client is responsible for ensuring site is ready for installation. Barro Kitchens is not liable for delays due to unprepared site conditions.');
    b.run(`setCompany('BK')`);
    assert.match(termHtml(b, 'tc_warranty'), /KitchenShield™\.$/, 'back on Barro Kitchens the plan applies again');
  });
});

describe('SELLING QUOTE — "Our standard", the summary strip and the dimension legend', () => {
  const stdOf = (b) => b.el('standardPage').innerHTML;
  const headings = (html) => [...html.matchAll(/<h4>([^<]*)<\/h4>/g)].map((m) => m[1]);

  it('a ticked Barro Kitchens quote prints the page: materials & finishes, the standard construction of THIS quote\'s configured lines (one bullet per distinct sentence, led by the family), warranty, how we work, references, registrations, the contact line', () => {
    const b = sellBuilder();
    const html = stdOf(b);
    assert.equal(b.el('standardPage').classList.contains('has-std'), true);
    assert.deepEqual(headings(html), ['Materials &amp; finishes', 'Standard construction', 'Warranty &amp; after-sales', 'How we work', 'References', 'Registrations']);
    assert.ok(html.includes('<div class="std-title">Our standard</div><div class="std-meta">Barro Kitchens, by Barro Industries OPC</div>'));
    assert.ok(html.includes('<p>Our standard material is SS304 food-grade stainless steel. SS316 laboratory grade is available on request. Standard finish: hairline. Brushed, mirror or satin on request.</p>'));
    assert.deepEqual([...html.matchAll(/<li><strong>([^<]*)<\/strong> — ([^<]*)<\/li>/g)].map((m) => m[1]), ['Preparation table', 'Sink', 'Stove', 'Range hood', 'Rack'], 'five distinct families, in line order — the catalogue lines add none');
    assert.ok(html.includes('<li><strong>Rack</strong> — SS304 stainless steel · 1.2 mm shelves · square-tube frame · on wheels</li>'));
    assert.ok(html.includes(`<p>${WARRANTY_SERVICE}</p>`) && !html.includes('KitchenShield'));
    assert.ok(html.includes('<ol><li>Site measurement and design</li><li>Fabrication in our Quezon City shop</li><li>Delivery</li><li>Installation and commissioning</li><li>Turnover and after-sales service</li></ol>'));
    assert.ok(html.includes('<p>Institutional clients include DMMMSU and ISPSC.</p>') && html.includes('<p>Barro Industries OPC is SEC-registered, VAT-registered and PhilGEPS-registered.</p>'));
    assert.equal(html.includes('std-contact'), false, 'the contact line is the thank-you block that closes the page (layoutDocTail()), not a second copy inside it');
    b.run(`setCompany('BK')`);
    assert.equal(b.el('pfCreds').textContent, 'Barro Industries OPC  •  SEC Registered  •  hello@barroindustries.com  •  09276836300  •  21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila');
    assert.equal(/PREP_WASHING|COOKING_LINE|prep_washing|cooking_line|undefined|\[object/.test(html), false, 'a heading is a human label, never an id');
    assert.equal(/<img|<svg|<picture|<canvas|url\(/i.test(html), false, 'text only: no logo, no agency mark');
  });

  it('the full-kitchen plan adds the KitchenShield paragraph to the warranty block — on that plan only; Barro Industries names itself "Barro Industries"', () => {
    const ks = sellBuilder(sampleItems(), { plan: 'kitchenshield12' });
    assert.ok(stdOf(ks).includes(`<p>${WARRANTY_SERVICE}</p><p>This project includes 12 months of preventive maintenance service (PMS) with KitchenShield™.</p>`));
    assert.equal(stdOf(sellBuilder(sampleItems(), { plan: 'service6' })).includes('KitchenShield'), false);
    const bi = sellBuilder(sampleItems(), { co: 'BI' });
    assert.ok(stdOf(bi).includes('<div class="std-meta">Barro Industries</div>'));
  });

  it('the page is omitted — nothing printed, the block empty and without its class — when UNTICKED, with no lines, and on Brilliant Steel even if ticked', () => {
    const off = sellBuilder(sampleItems(), { page: false });
    assert.equal(stdOf(off), '');
    assert.equal(off.el('standardPage').classList.contains('has-std'), false);
    assert.equal(stdOf(sellBuilder([], { page: true })), '');
    const bs = sellBuilder(sampleItems(), { co: 'BS', page: true });
    assert.equal(stdOf(bs), '');
    assert.equal(bs.el('standardPage').classList.contains('has-std'), false);
    // …and it comes back with the tick
    off.el('showStandardPage').checked = true; off.run('onShowStandardPageChange()');
    assert.notEqual(stdOf(off), '');
  });

  it('the construction block is omitted when no configured line prints one (catalogue lines only, or the preparer\'s own wording)', () => {
    const cat = sellBuilder(sampleItems().slice(5));
    assert.equal(headings(stdOf(cat)).includes('Standard construction'), false);
    const custom = sellBuilder([{ ...sampleItems()[1], specEdit: 'my words' }]);
    assert.equal(headings(stdOf(custom)).includes('Standard construction'), false);
  });

  it('it never states a warranty the Warranty term does not: with the term switched off, or its wording rewritten / stored, the warranty block and the strip\'s warranty part are left out', () => {
    const b = sellBuilder();
    assert.equal(b.run('warrantyIsDefault()'), true);
    b.run(`termsEnabled.tc_warranty = false; renderDocExtras();`);
    assert.equal(headings(stdOf(b)).includes('Warranty &amp; after-sales'), false);
    assert.equal(b.el('summaryStrip').textContent.includes('warranty'), false);
    b.run(`termsEnabled.tc_warranty = true; termsContent.tc_warranty = 'Our own warranty wording.'; renderDocExtras();`);
    assert.equal(b.run('warrantyIsDefault()'), false);
    assert.equal(headings(stdOf(b)).includes('Warranty &amp; after-sales'), false);
    assert.equal(/warranty|PMS/.test(b.el('summaryStrip').textContent), false);
    b.run(`delete termsContent.tc_warranty; renderDocExtras();`);
    assert.match(b.el('summaryStrip').textContent, /6-month service warranty$/);
  });

  it('the summary strip: validity · payment · lead time · delivery · warranty, from the fields already on the quote — and the KitchenShield part on the full-kitchen plan; empty on Brilliant Steel and with no lines', () => {
    const b = sellBuilder();
    b.el('diMethod').value = 'Company delivery truck';
    b.run('renderTotals()');
    assert.equal(b.el('summaryStrip').textContent, 'Valid 30 days · 50% down payment, balance on completion · Lead time from 25 working days · Delivery: Company delivery truck · 6-month service warranty');
    b.el('quoteValidDays').value = '120'; b.el('dpMode').value = '30'; b.el('balMode').value = 'stagger3'; b.el('warrantyPlan').value = 'kitchenshield12';
    b.run('renderTotals()');
    assert.equal(b.el('summaryStrip').textContent, 'Valid 120 days · 30% down payment, balance in 3 staggered payments · Lead time from 25 working days · Delivery: Company delivery truck · 6-month service warranty · 12-month PMS with KitchenShield™');
    b.run(`payMilestones = [{pct:50,label:'a',date:''},{pct:50,label:'b',date:''}]; renderTotals();`);
    assert.match(b.el('summaryStrip').textContent, /^Valid 120 days · 2 payment milestones · /);
    assert.equal(sellBuilder(sampleItems(), { co: 'BS' }).el('summaryStrip').textContent, '');
    assert.equal(sellBuilder([]).el('summaryStrip').textContent, '');
  });

  it('the legend under the items table: the dimension legend + tolerance reference only when a line has a size, the ruled lead-time sentence once; gone on Brilliant Steel; the tolerance reference follows its term', () => {
    const b = sellBuilder();
    assert.equal(b.el('itemsNotes').innerHTML, '<p class="dims-legend">Dimensions are Length × Width × Height in mm (hoods: Length × Depth). Fabricated dimensions carry the ±5 mm tolerance stated in the terms.</p><p class="lead-legend">Lead time: 25 working days minimum, from downpayment and approved drawings.</p>');
    b.run(`termsEnabled.tc_tolerance = false; renderDocExtras();`);
    assert.equal(b.el('itemsNotes').innerHTML.includes('tolerance'), false);
    assert.ok(b.el('itemsNotes').innerHTML.includes('Dimensions are Length × Width × Height in mm (hoods: Length × Depth).'));
    assert.equal(sellBuilder(sampleItems().slice(6)).el('itemsNotes').innerHTML, '', 'two bare catalogue lines: no size, no ruled lead: nothing to say');
    assert.equal(sellBuilder(sampleItems(), { co: 'BS' }).el('itemsNotes').innerHTML, '');
    assert.equal(sellBuilder(legacyOf(sampleItems())).el('itemsNotes').innerHTML.includes('Lead time'), false, 'a legacy quote carries no ruled lead time: no sentence');
  });

  it('the summary, the legend and the Standard page follow the fields live: validity, delivery, a term switched off, a rewritten warranty (updatePrintHeader / updateDiPrint / toggleTerm / saveTerm repaint them)', () => {
    const b = sellBuilder();
    b.el('quoteValidDays').value = '45'; b.run('updatePrintHeader()');
    assert.match(b.el('summaryStrip').textContent, /^Valid 45 days/);
    b.el('diMethod').value = 'Client pick-up'; b.run('updateDiPrint()');
    assert.match(b.el('summaryStrip').textContent, /Delivery: Client pick-up/);
    b.run(`toggleTerm('tc_tolerance', { checked: false })`);
    assert.equal(b.el('itemsNotes').innerHTML.includes('tolerance'), false);
    b.run(`toggleTerm('tc_warranty', { checked: false })`);
    assert.equal(/warranty/.test(b.el('summaryStrip').textContent), false);
    b.run(`toggleTerm('tc_warranty', { checked: true }); saveTerm('tc_warranty', { innerHTML: 'Custom' })`);
    assert.equal(/warranty/.test(b.el('summaryStrip').textContent), false);
  });
});

describe('SELLING QUOTE — the document\'s order, section headings and annex header', () => {
  // a tiny linked tree standing in for the DOM: enough for insertBefore / nextSibling
  const miniTree = (ids) => {
    const parent = { children: [] };
    const nodes = {};
    ids.forEach((id) => { nodes[id] = { id, innerHTML: '', classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, cloneNode() { return { removeAttribute() {}, querySelectorAll: () => [] }; }, insertBefore() {}, appendChild() {}, parentNode: parent, get nextSibling() { const i = parent.children.indexOf(this); return parent.children[i + 1] || null; } }; parent.children.push(nodes[id]); });
    parent.insertBefore = (node, ref) => { const i = parent.children.indexOf(node); if (i >= 0) parent.children.splice(i, 1); const j = ref ? parent.children.indexOf(ref) : -1; if (j < 0) parent.children.push(node); else parent.children.splice(j, 0, node); return node; };
    return { nodes, order: () => parent.children.map((n) => n.id) };
  };
  it('layoutDocTail(): the footer sits right after the terms and the Standard page right after it (Barro Kitchens / Barro Industries); Brilliant Steel gets the footer back after the annex and the agent box — its old order', () => {
    const b = builder();
    const tree = miniTree(['termsSection', 'printFooter', 'standardPage', 'internalPanel', 'photoAnnex', 'agentBox']);
    const real = b.ctx.document.getElementById;
    b.ctx.document.getElementById = (id) => tree.nodes[id] || real(id);
    b.run(`currentCo = 'BK'; layoutDocTail();`);
    assert.deepEqual(tree.order(), ['termsSection', 'printFooter', 'standardPage', 'internalPanel', 'photoAnnex', 'agentBox']);
    b.run(`currentCo = 'BS'; layoutDocTail();`);
    assert.deepEqual(tree.order(), ['termsSection', 'standardPage', 'internalPanel', 'photoAnnex', 'agentBox', 'printFooter'], 'the old order: …annex, agent box, footer');
    b.run(`currentCo = 'BI'; layoutDocTail();`);
    assert.deepEqual(tree.order(), ['termsSection', 'printFooter', 'standardPage', 'internalPanel', 'photoAnnex', 'agentBox']);
    b.run(`layoutDocTail(); layoutDocTail();`);
    assert.deepEqual(tree.order(), ['termsSection', 'printFooter', 'standardPage', 'internalPanel', 'photoAnnex', 'agentBox'], 'idempotent');
    // the Standard page is pulled in right behind the footer even when the footer already sits in place and the page is somewhere else
    const stray = miniTree(['termsSection', 'printFooter', 'internalPanel', 'standardPage', 'photoAnnex', 'agentBox']);
    b.ctx.document.getElementById = (id) => stray.nodes[id] || real(id);
    b.run(`currentCo = 'BK'; layoutDocTail();`);
    assert.deepEqual(stray.order(), ['termsSection', 'printFooter', 'standardPage', 'internalPanel', 'photoAnnex', 'agentBox']);
    b.ctx.document.getElementById = (id) => tree.nodes[id] || real(id);
    // setCompany() runs it on its own (the Standard page repaint that also lays the tail out is stubbed away: only setCompany's own call can place the footer)
    b.run('renderStandardPage = function () {};');
    b.run(`setCompany('BS')`);
    assert.equal(tree.order().at(-1), 'printFooter');
    b.run(`setCompany('BK')`);
    assert.deepEqual(tree.order().slice(0, 3), ['termsSection', 'printFooter', 'standardPage']);
  });

  it('the thank-you CLOSES the "Our standard" page: with the page on the order is terms → Our standard → thank-you & company details → annex (it used to land ALONE on a page of its own when the signatures ended the page above); with the page off the thank-you follows the terms; Brilliant Steel keeps its old order', () => {
    const b = builder();
    const tree = miniTree(['termsSection', 'printFooter', 'standardPage', 'internalPanel', 'photoAnnex', 'agentBox']);
    let stdOn = true;
    tree.nodes.standardPage.classList.contains = (c) => stdOn && c === 'has-std';
    const real = b.ctx.document.getElementById;
    b.ctx.document.getElementById = (id) => tree.nodes[id] || real(id);
    const ON = ['termsSection', 'standardPage', 'printFooter', 'internalPanel', 'photoAnnex', 'agentBox'], OFF = ['termsSection', 'printFooter', 'standardPage', 'internalPanel', 'photoAnnex', 'agentBox'];
    for (const co of ['BK', 'BI']) { b.run(`currentCo = '${co}'; layoutDocTail();`); assert.deepEqual(tree.order(), ON, co); }
    b.run('layoutDocTail(); layoutDocTail();');
    assert.deepEqual(tree.order(), ON, 'idempotent');
    stdOn = false; b.run('layoutDocTail();');
    assert.deepEqual(tree.order(), OFF, 'page off: terms → thank-you');
    stdOn = true; b.run('layoutDocTail();');
    assert.deepEqual(tree.order(), ON, 'ticked again');
    // the page is pulled up behind the terms even when something else sits between them (and the thank-you follows it wherever it was)
    const stray = miniTree(['termsSection', 'internalPanel', 'standardPage', 'printFooter', 'photoAnnex', 'agentBox']);
    stray.nodes.standardPage.classList.contains = (c) => c === 'has-std';
    b.ctx.document.getElementById = (id) => stray.nodes[id] || real(id);
    b.run(`currentCo = 'BK'; layoutDocTail();`);
    assert.deepEqual(stray.order(), ['termsSection', 'standardPage', 'printFooter', 'internalPanel', 'photoAnnex', 'agentBox']);
    b.ctx.document.getElementById = (id) => tree.nodes[id] || real(id);
    // the thank-you is placed when the page is (de)populated: renderStandardPage() lays the tail out
    const c = sellBuilder(sampleItems());
    c.run('var __n = 0; layoutDocTail = function () { __n++; }; renderStandardPage();');
    assert.equal(c.run('__n'), 1, 'populated');
    c.el('showStandardPage').checked = false; c.run('__n = 0; renderStandardPage();');
    assert.equal(c.run('__n'), 1, 'emptied');
    // Brilliant Steel: the footer after the annex and the agent box, whatever the page state
    stdOn = true; b.run(`currentCo = 'BS'; layoutDocTail();`);
    assert.equal(tree.order().at(-1), 'printFooter');
    // …and back on Barro Kitchens the footer returns from the end of the document to right behind the Standard page
    b.run(`currentCo = 'BK'; layoutDocTail();`);
    assert.deepEqual(tree.order(), ON, 'from the Brilliant Steel order back to the current one');
  });

  it('the Client preview follows the printed order: with a Standard page the thank-you block comes right after it; with none (unticked), directly after the terms; Brilliant Steel\'s list is unchanged', () => {
    const on = sellBuilder(sampleItems());
    assert.deepEqual(on.plain('qbDocSourceIds()'), ['lhPrintHeader', 'phSubject', 'billStrip', 'itemsSection', 'diSection', 'timelineSection', 'remarksSection', 'termsSection', 'standardPage', 'printFooter', 'photoAnnex']);
    const off = sellBuilder(sampleItems(), { page: false });
    assert.deepEqual(off.plain('qbDocSourceIds()'), off.plain('QB_DOC_SOURCE_IDS'));
    assert.deepEqual(sellBuilder(sampleItems(), { co: 'BS' }).plain('qbDocSourceIds()'), sellBuilder(sampleItems(), { co: 'BS' }).plain('QB_DOC_SOURCE_IDS_BS'));
  });

  it('the running identifier: a bottom page-MARGIN box on a named page for Barro Kitchens / Barro Industries on a browser that draws them (Chrome / Edge 131+, detected by CSSMarginRule), the old fixed footer for Brilliant Steel and for any other browser — written into --run-id as a safe CSS string', () => {
    // the detection script is in the head (before the stylesheet) and only adds a class
    assert.match(HTML, /<title>Quote Builder — Barro Industries<\/title>\n<script>try\{ if\(typeof CSSMarginRule==='function'\) document\.documentElement\.classList\.add\('mb-footer'\); \}catch\(e\)\{\}<\/script>\n<style>/);
    // the named page and its margin box (12 mm at the bottom for these documents), and the two rules that switch the old footer off for them only
    assert.match(HTML, /@page bkdoc\{size:A4 portrait;margin:11mm 10mm 12mm;\n\s*@bottom-center\{content:var\(--run-id,""\);font-family:var\(--font\);font-size:7pt;color:#888;vertical-align:top;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-top:\.5px solid #ddd;padding-top:1\.5mm;\}\}/);
    assert.match(HTML, /@media print\{\n\s*html\.mb-footer body:not\(\.co-bs\)\{page:bkdoc;\}\n\s*html\.mb-footer body:not\(\.co-bs\) \.print-run-footer\{display:none!important;\}\n\}/);
    // Brilliant Steel (and every browser without margin boxes) keeps the fixed footer and the 7 mm margin EXACTLY as they were
    assert.match(HTML, /\.print-run-footer\{display:block!important;position:fixed;bottom:2mm;left:10mm;right:10mm;\n\s*font-size:7pt;color:#888;text-align:center;border-top:\.5px solid #ddd;padding-top:1\.5mm;\}\n\s*@page\{size:A4 portrait;margin:11mm 10mm 7mm;\}\n\}/);
    assert.equal((HTML.match(/@page\{/g) || []).length, 1, 'the unnamed @page rule is still the one Brilliant Steel prints on');
    assert.equal((HTML.match(/page:bkdoc/g) || []).length, 1);
    assert.equal(/body\.co-bs[^{]*\{[^}]*\bpage:/.test(HTML), false, 'nothing gives Brilliant Steel a named page');
    // the text: control characters out, backslash and quote escaped
    const b = sellBuilder(sampleItems());
    const props = {}; b.ctx.document.documentElement.style = { setProperty: (k, v) => { props[k] = v; } };
    b.el('quoteNo').value = 'BKLUFB261105-001R1'; b.el('clientName').value = 'Maria Santos';
    b.run('updatePrintRunFooter()');
    assert.equal(props['--run-id'], '"BKLUFB261105-001R1 — Maria Santos"');
    assert.equal(b.el('printRunFooter').textContent, 'BKLUFB261105-001R1 — Maria Santos', 'the fixed footer carries the same text');
    b.el('clientName').value = 'A "quoted" \\ name\nline\u0007x';
    b.run('updatePrintRunFooter()');
    assert.equal(props['--run-id'], '"BKLUFB261105-001R1 — A \\"quoted\\" \\\\ name line x"');
    b.el('quoteNo').value = ''; b.el('clientName').value = '';
    b.run('updatePrintRunFooter()');
    assert.equal(props['--run-id'], '""');
    // a page that cannot set the property (an old engine) never throws
    b.ctx.document.documentElement.style = {};
    assert.doesNotThrow(() => b.run('updatePrintRunFooter()'));
  });

  it('a company switch repaints the items table BEFORE it re-clones the Client preview (the table\'s markup depends on the company: a preview cloned first kept the old company\'s spec sheets)', () => {
    const b = builder();
    b.run(`var __order = []; var __ri = renderItems, __rc = renderClientPreview; renderItems = function () { __order.push('items'); return __ri.apply(this, arguments); }; renderClientPreview = function () { __order.push('preview'); return __rc.apply(this, arguments); }; setCompany('BS');`);
    const order = b.plain('__order');
    assert.ok(order.includes('items') && order.includes('preview'), JSON.stringify(order));
    assert.ok(order.indexOf('items') < order.indexOf('preview'), `the preview was cloned before the items table was repainted: ${JSON.stringify(order)}`);
    assert.equal(order.at(-1), 'preview', 'and the preview is the last word');
  });

  it('section headings print the human label, never the raw id — with the product database not loaded, for a built-in id, an unknown id, a renamed section; the database label still wins', () => {
    const b = makeEnv();
    b.run(`DB = { products: [], categories: [], laborRoles: [], constants: {} }; items.length = 0;`);
    const label = (id, catLabel) => { b.run(`items.length = 0; items.push(${JSON.stringify({ id: 'X', category: id, name: 'n', qty: 1, amount: 1, unitPrice: 1, ...(catLabel ? { catLabel } : {}) })});`); return b.run(`sectionLabel(${JSON.stringify(id)})`); };
    assert.equal(label('prep_washing'), 'Preparation & Washing');
    assert.equal(label('cooking_line'), 'Cooking Line');
    assert.equal(label('exhaust_system'), 'Exhaust System');
    assert.equal(label('fire_suppression'), 'Fire Suppression');
    assert.equal(label('some_new_section'), 'Some New Section');
    assert.equal(label('sec_2', 'Option A — Full Kitchen Package'), 'Option A — Full Kitchen Package');
    assert.equal(label(''), 'Uncategorised');
    assert.equal(label('constructor'), 'Constructor', 'a prototype name is just a word');
    b.run(`DB.categories = [{ id: 'prep_washing', label: 'Prep & Wash (from the database)' }];`);
    assert.equal(label('prep_washing'), 'Prep & Wash (from the database)');
    for (const id of Object.keys(b.plain('SECTION_FALLBACK_LABELS'))) assert.equal(/_|^[a-z]/.test(b.plain('SECTION_FALLBACK_LABELS')[id]), false, id);
  });

  it('the rendered table, the subtotal rows and the options ladder all carry the label — a quote rendered before the database loads (a #quote= link) has no raw id in it', () => {
    const b = builder();
    b.run(`DB = { products: [], categories: [], laborRoles: [], constants: {} };`);
    b.run(`items.length = 0; items.push(...${JSON.stringify(sampleItems())}); renderItems();`);
    const html = b.el('itemsTbody').innerHTML;
    assert.equal(/prep_washing|cooking_line|exhaust_system|refrigeration"|fire_suppression/.test(html.replace(/data-[a-z-]+="[^"]*"|moveSection\('[^']*'|editCatLabel\('[^']*'/g, '')), false);
    assert.ok(html.includes('Subtotal — Preparation &amp; Washing:') && html.includes('Subtotal — Fire Suppression:'));
  });

  it('the photo annex header reads the LIVE quote number (it used to keep the one it was built with): updatePrintHeader() refreshes it, without re-rendering the photos', () => {
    const b = builder();
    b.run(`qnoMode = 'manual'`);
    const meta = { innerHTML: 'OLD' };
    const real = b.ctx.document.querySelector;
    b.ctx.document.querySelector = (sel) => (sel === '#photoAnnex .photo-annex-meta' ? meta : real(sel));
    b.el('quoteNo').value = 'BKLUFB261105-001R1'; b.el('clientName').value = 'Maria <Santos>';
    b.run('updatePrintHeader()');
    assert.equal(meta.innerHTML, 'BARRO KITCHENS<br>Quote BKLUFB261105-001R1 • Maria &lt;Santos&gt;');
    b.el('quoteNo').value = 'BKLUFB261105-001R2';
    b.run('updatePrintHeader()');
    assert.match(meta.innerHTML, /Quote BKLUFB261105-001R2/);
    b.run(`setCompany('BI')`);
    b.run('updatePrintHeader()');
    assert.match(meta.innerHTML, /^BARRO INDUSTRIES OPC<br>/);
    // and renderPhotoAnnex builds its header from the same helper
    b.run(`quotePhotos.push({ url: 'https://firebasestorage.googleapis.com/x', caption: 'c', itemIndex: null }); renderPhotoAnnex();`);
    assert.ok(b.el('photoAnnex').innerHTML.includes('<div class="photo-annex-meta">BARRO INDUSTRIES OPC<br>Quote BKLUFB261105-001R2 • Maria &lt;Santos&gt;</div>'));
  });
});

describe('SELLING QUOTE — ⚙ configure regenerates the options-driven fields and keeps what the preparer chose; every line creator carries the four fields', () => {
  it('a re-configure regenerates includes, not-included and lead time from the new options (specs and name too), KEEPS the finish the preparer picked and their extra rows, and fills a missing finish with the family default', () => {
    const b = builder();
    const { line } = makeLine(b, sinkState());
    b.run(`items.length = 0; items.push(${JSON.stringify({ ...line, finish: 'mirror', specLines: [{ label: 'Capacity', value: 'x' }] })}); cfgRefreshAll();`);
    assert.deepEqual(b.plain('items[0].includes'), ['2 basins with waste fittings and strainers', 'pre-rinse spray faucet', 'adjustable bullet feet']);
    b.run(`items[0].includes = ['typed by hand']; items[0].leadTime = '30 working days';`);
    const st = stateFor('sink', { config: { basins: 4, alignment: 'center', undershelf: false, upper: false, faucet: 'gooseneck' }, sizeRaw: { W: '2400', D: '700', H: '900' }, qty: 2, editItem: null });
    b.run(`globalThis.__st = ${JSON.stringify(st)}; __st.editItem = items[0]; globalThis.__ev = cfgEvaluate(__st); globalThis.__fresh = cfgMakeLine(__ev, __st); cfgApplyEdit(items[0], __fresh, 0);`);
    const it = b.plain('items[0]');
    assert.deepEqual(it.includes, ['4 basins with waste fittings and strainers', 'gooseneck faucet', 'adjustable bullet feet'], 'regenerated from the new options — the hand-typed list is replaced (the Help says so)');
    assert.deepEqual(it.excludes, ['water supply and drain line to the sink', 'angle valves']);
    assert.equal(it.leadTime, '25 working days');
    assert.equal(it.finish, 'mirror', 'the finish is the preparer\'s choice and stays');
    assert.deepEqual(it.specLines, [{ label: 'Capacity', value: 'x' }], 'extra rows are never touched');
    // a line with no finish takes the family default; a legacy line (no fields at all) gets the whole set
    b.run(`items[0].finish = ''; globalThis.__ev = cfgEvaluate(__st); globalThis.__fresh = cfgMakeLine(__ev, __st); cfgApplyEdit(items[0], __fresh, 0);`);
    assert.equal(b.run('items[0].finish'), 'hairline');
    const legacy = legacyOf([sampleItems()[1]])[0];
    b.run(`items.length = 0; items.push(${JSON.stringify(legacy)}); __st.editItem = items[0]; globalThis.__ev = cfgEvaluate(__st); globalThis.__fresh = cfgMakeLine(__ev, __st); cfgApplyEdit(items[0], __fresh, 0);`);
    const re = b.plain('items[0]');
    assert.deepEqual([re.finish, re.leadTime, re.includes.length, re.excludes.length, re.specLines], ['hairline', '25 working days', 3, 2, []]);
  });

  it('a newly configured line carries finish "hairline", its includes / not-included and the ruled lead time; cfgCommit() adds it and the price is the one the sheet gave (nothing changes it)', () => {
    const b = builder();
    const { ev } = makeLine(b, stateFor('rack', {}));
    b.run(`openConfigurator('rack', {}); cfgCommit();`);
    const it = b.plain('items[0]');
    assert.deepEqual([it.finish, it.includes, it.excludes, it.leadTime, it.specLines], ['hairline', ['shelves as configured', 'wheels'], [], '25 working days', []]);
    assert.equal(it.priceBasis, 'website');
    assert.equal(it.unitPrice, ev.basis.unitPrice, 'the line lands at the website price the option sheet gave — the new fields never touch it');
  });

  it('addItemFromCalc / addFixedItemDirect / addCustomItem / addSection / normalizeImportItem / duplicateItem each carry finish, includes, excludes and specLines (empty = "not stated": a reader never takes them as a claim)', () => {
    const b = builder();
    b.run(`items.length = 0; addFixedItemDirect(DB.products.find(p => p.id === 'CE-030')); addCustomItem(); closeBomModal && closeBomModal();`);
    for (const it of b.plain('items')) assert.deepEqual([it.finish, it.includes, it.excludes, it.specLines], ['', [], [], []], it.name);
    b.run(`selectedProduct = DB.products.find(p => p.id === 'PW-023'); buildCalcPanel(selectedProduct); addItemFromCalc();`);
    assert.deepEqual(b.plain('items.at(-1)').specLines, []);
    assert.equal(b.run(`items.at(-1).finish`), '');
    b.run(`prompt = () => 'Option A'; addSection();`);
    assert.deepEqual(b.plain('items.at(-1)').includes, []);
    const imp = b.plain(`normalizeImportItem({ name: 'Imported gate', dims: 'L2000 mm', qty: 2 }, [], '', 1)`);
    assert.deepEqual([imp.finish, imp.includes, imp.excludes, imp.specLines], ['', [], [], []]);
    b.run(`items.length = 0; items.push(${JSON.stringify(sampleItems()[1])}); duplicateItem(0);`);
    assert.deepEqual(b.plain('items').map((i) => [i.finish, i.includes.length]), [['hairline', 3], ['hairline', 3]]);
    assert.notEqual(b.run('items[0].includes === items[1].includes'), true, 'the copy is its own list');
  });
});

describe('SELLING QUOTE — the tutorial (TUTORIAL_VERSION 49, Help and the demo tell the same story)', () => {
  it('Help: the Details ▸ bullet, the Terms-tab warranty plan and Our standard sentence, the Verify & File sentence; no "12 months warranty" anywhere in Help or the demo', () => {
    const help = (HTML.match(/<div class="modal-body" id="helpBody">[\s\S]*?<h4>What's new<\/h4>/) || [''])[0];
    const li = (HTML.match(/<li><strong>Details ▸ on each line<\/strong>[\s\S]*?<\/li>/) || [''])[0];
    for (const must of ['spec sheet', 'Details ▸', 'finish', 'hairline is the standard', 'brushed, mirror, satin', 'Includes', 'Not included', 'extra rows', '25 working days minimum, from downpayment and approved drawings', '⚙ configure regenerates its includes, not-included and lead time from the new options (your finish stays)',
      'no size', 'no specs', 'no finish', 'no photo', 'Quote strength n/10', 'custom wording', '↺ regenerate', 'dimension legend', 'Brilliance Steel quotes are not changed by any of this']) assert.ok(li.includes(must), `Help bullet does not say: ${must}`);
    assert.match(help, /<strong>Warranty plan<\/strong> is the standard 6-month service warranty, or <em>Full kitchen<\/em> — the 6-month warranty plus 12 months of preventive maintenance service \(PMS\) with KitchenShield™ — and a tick prints the <strong>“Our standard” page<\/strong> after the terms/);
    assert.match(help, /A made-to-order line with no size blocks filing; lines still missing specs or a finish are only listed \(you can file anyway\)\./);
    assert.ok(help.indexOf('Details ▸ on each line') > help.indexOf('Configure a product') && help.indexOf('Details ▸ on each line') < help.indexOf('Pricing is automatic'));
    const steps = makeEnv().plain('TOUR_STEPS');
    assert.equal(/12 months warranty/i.test(help + JSON.stringify(steps)), false);
  });

  it('the demo: a "Details ▸" step on .line-details-toggle (Estimator), right after "Items price themselves" and before the miscellaneous costs, and a Terms-tab step on #termsOptionsBox right after "The Terms tab"; both targets exist in the markup', () => {
    const steps = makeEnv().plain('TOUR_STEPS');
    const at = (target) => steps.findIndex((s) => s.target === target);
    assert.ok(at('.line-details-toggle') > 0 && at('#termsOptionsBox') > 0);
    assert.equal(steps[at('.line-details-toggle')].needsWorkspace, true);
    assert.equal(steps[at('#termsOptionsBox')].needsTerms, true);
    assert.equal(steps[at('.line-details-toggle') - 1].target, '#itemsSection');
    assert.equal(steps[at('.line-details-toggle') + 1].target, '#laborTimelineWrap');
    assert.equal(steps[at('#termsOptionsBox') - 1].target, '#termsSection');
    assert.match(steps[at('.line-details-toggle')].title, /Details ▸/);
    assert.match(steps[at('.line-details-toggle')].body, /hairline is the standard/);
    assert.match(steps[at('.line-details-toggle')].body, /A made-to-order line with no size cannot be filed\./);
    assert.match(steps[at('#termsOptionsBox')].body, /Full kitchen — the 6-month warranty plus 12 months of preventive maintenance service \(PMS\) with KitchenShield™/);
    assert.match(steps[at('#termsOptionsBox')].body, /Brilliance Steel quotes do not get it\./);
    assert.ok(HTML.includes('class="cfg-link line-details-toggle"') && HTML.includes('id="termsOptionsBox"'));
    const verify = steps.find((s) => s.target === '#btnVerify').body;
    assert.match(verify, /lists the lines that still lack specs or a finish \(a warning — you can file anyway\), blocks a made-to-order line that has no size/);
  });

  it('the demo skips the Details step cleanly on an empty quote (no line, no toggle: the target is missing) and on Brilliant Steel; nothing in it mutates the quote', () => {
    const b = makeEnv();
    assert.equal(b.run(`document.querySelector('.line-details-toggle')`), null, 'no rows, no toggle');
    const src = HTML.slice(HTML.indexOf('const TOUR_STEPS = ['), HTML.indexOf('// ── What\'s New / Help modal'));
    assert.equal(/toggleLineDetails|editFinish|addSpecLine|saveToStorage/.test(src), false);
    const bs = sellBuilder(sampleItems(), { co: 'BS' });
    assert.equal(/line-details-toggle/.test(bs.el('itemsTbody').innerHTML), false);
  });
});

// ═══════════════════════════════════════ TIMELINE (owner ruling 2026-11-05, option a) ═══════════════════════════════════════
// The lead time of a Barro Kitchens / Barro Industries quotation is the LONGER of 25 working days and the earlier formula (12 working days + 3 per ₱20,000 of materials), Sundays never counted. It
// feeds the Timeline block, the estimated completion date and the "+2% priority order" threshold (cut the timeline by more than a third). Brilliant Steel keeps the earlier formula, and so does a
// quotation "as issued" (filed before the warranty plan existed, then reopened): reopening an old quotation must not move its price. This money-adjacent change is pinned below the crossover, at
// it and above it; the priority surcharge before / after; the totals with no shortening (byte-identical); and exactly which totals move. Mutation-tested in a scratch copy (see the phase report):
// the 25 floor off / 24 / 26 / Math.min; the crossover moved; a Sunday counted; Brilliant Steel or an "as issued" quote on the new rule; the threshold changed; the note not following the rule.
describe('TIMELINE — lead = max(25, 12 + 3 × ⌊materials ÷ ₱20,000⌋) working days, Sundays never counted; Brilliant Steel and a quotation "as issued" keep the earlier formula', () => {
  const START = '2026-11-05';                                  // a Thursday
  // the walk the builder does, written out independently: calendar days from `start` to the Nth non-Sunday after it
  const calendarDays = (start, workingDays) => { const d = new Date(`${start}T12:00:00`); let left = workingDays, n = 0; while (left > 0) { d.setDate(d.getDate() + 1); n++; if (d.getDay() !== 0) left--; } return n; };
  const timelineBuilder = (materials, { co = 'BK', plan = 'service6', lead = '' } = {}) => {
    const b = sellBuilder(sampleItems(), { co, plan });
    if (materials !== null) b.run(`computeTrueCost = function () { return { materials: ${materials} }; };`);
    b.el('projStart').value = START; b.el('overallLead').value = String(lead);
    return b;
  };
  const EARLIER = { BS: { co: 'BS' }, 'as issued': { plan: '' }, 'BS as issued': { co: 'BS', plan: '' } };

  it('the working days: 25 up to ₱99,999 of materials, 27 from ₱100,000, then 3 more for every further ₱20,000 — and exactly the earlier 12 + 3 per ₱20,000 on Brilliant Steel and on a quotation "as issued"', () => {
    const NEW = [[0, 25], [20000, 25], [79999, 25], [80000, 25], [99999, 25], [100000, 27], [119999, 27], [120000, 30], [139999, 30], [140000, 33], [200000, 42], [500000, 87]];
    const OLD = [[0, 12], [19999, 12], [20000, 15], [79999, 21], [80000, 24], [99999, 24], [100000, 27], [119999, 27], [120000, 30], [139999, 30], [140000, 33], [200000, 42], [500000, 87]];
    for (const [m, wd] of NEW) assert.equal(timelineBuilder(m).run(`leadWorkingDays(${m})`), wd, `Barro Kitchens, ₱${m} of materials`);
    for (const [m, wd] of NEW) assert.equal(timelineBuilder(m, { co: 'BI' }).run(`leadWorkingDays(${m})`), wd, `Barro Industries, ₱${m} of materials`);
    for (const [name, o] of Object.entries(EARLIER)) for (const [m, wd] of OLD) assert.equal(timelineBuilder(m, o).run(`leadWorkingDays(${m})`), wd, `${name}, ₱${m} of materials`);
    assert.equal(timelineBuilder(0).run('LEAD_MIN_WORKING_DAYS'), 25);
    assert.equal(timelineBuilder(0).run('leadWorkingDays(undefined) + leadWorkingDays(null) + leadWorkingDays("x")'), 75, 'junk materials read as none');
    assert.equal(timelineBuilder(0).run('leadRuleIsNew()'), true);
    for (const o of Object.values(EARLIER)) assert.equal(timelineBuilder(0, o).run('leadRuleIsNew()'), false);
  });

  it('the calendar days (what #overallLead stores and the document prints) are the Sunday-skipping walk from the start date: 25 working days from Thu 5 Nov 2026 end Fri 4 Dec (29 days, ~4.1 weeks); 27 → 32; 30 → 35; the earlier 12 → 14 (19 Nov)', () => {
    for (const [m, wd, days] of [[0, 25, 29], [99999, 25, 29], [100000, 27, 32], [120000, 30, 35], [200000, 42, 49]]) {
      const b = timelineBuilder(m);
      assert.equal(calendarDays(START, wd), days, 'the independent walk');
      assert.equal(b.run('autoLeadDays()'), days, `₱${m}`);
      assert.equal(b.run('getLeadDays()'), days, 'no lead typed: the auto one');
    }
    assert.equal(timelineBuilder(0, EARLIER.BS).run('autoLeadDays()'), 14);
    assert.equal(timelineBuilder(0, EARLIER['as issued']).run('autoLeadDays()'), 14);
    // a start date that is not a Thursday: Sunday is never counted wherever the walk begins
    for (const start of ['2026-11-01', '2026-11-02', '2026-11-07', '2026-12-26']) {
      const b = timelineBuilder(0); b.el('projStart').value = start;
      assert.equal(b.run('autoLeadDays()'), calendarDays(start, 25), start);
    }
  });

  it('the Timeline block says 29 calendar days (~4.1 weeks) and completes on 4 December 2026 — a typed lead time still wins and its weeks are computed from it', () => {
    const b = timelineBuilder(0);
    b.run('renderTimeline()');
    const html = b.el('timelineSummary').innerHTML;
    assert.ok(html.includes('<tr class="pay-head"><td>Start Date (basis)</td><td>November 5, 2026</td></tr>'), html);
    assert.ok(html.includes('<tr><td>Overall Lead Time</td><td>29 calendar days (~4.1 weeks)</td></tr>'), html);
    assert.ok(html.includes('<tr class="pay-head"><td>Estimated Completion</td><td>December 4, 2026</td></tr>'), html);
    assert.equal(b.el('overallLead').placeholder, 'auto: 29 days');
    b.el('overallLead').value = '35'; b.run('renderTimeline()');
    assert.ok(b.el('timelineSummary').innerHTML.includes('35 calendar days (~5.0 weeks)') && b.el('timelineSummary').innerHTML.includes('December 10, 2026'));
    const old = timelineBuilder(0, EARLIER.BS); old.run('renderTimeline()');
    assert.ok(old.el('timelineSummary').innerHTML.includes('14 calendar days (~2.0 weeks)') && old.el('timelineSummary').innerHTML.includes('November 19, 2026'));
    // the payment schedule's "estimated completion" and the filed payload follow it too
    const c = timelineBuilder(0); c.run('renderTotals()');
    assert.ok(c.el('paymentSummary').innerHTML.includes('December 4, 2026'), 'the balance falls due on the estimated completion date');
    assert.deepEqual(c.plain('buildQuotePayload().timeline'), { startDate: START, leadDays: 29, completionDate: '2026-12-04' });
    assert.deepEqual(old.plain('buildQuotePayload().timeline'), { startDate: START, leadDays: 14, completionDate: '2026-11-19' });
  });

  it('the printed note under the Timeline states the rule in force: 25 working days minimum, or 12 + 3 per ₱20,000 whichever is longer — never "Minimum two weeks" — and the priority-order sentence stays; Brilliant Steel and "as issued" print the earlier note byte for byte', () => {
    const NOTE_NEW = 'Lead time begins upon receipt of the down payment and approved design: 25 working days minimum, or 12 working days plus 3 working days per ₱20,000 of materials for larger orders, whichever is longer. Sundays are not counted as working days. You may shorten the timeline; cutting it by more than a third makes the quote a priority order (+2%). Subject to site readiness and unforeseen supply delays.';
    const NOTE_OLD = 'Lead time begins upon receipt of the down payment and approved design. Minimum two weeks, plus 3 working days per ₱20,000 of materials — Sundays are not counted as working days. You may shorten the timeline; cutting it by more than a third makes the quote a priority order (+2%). Subject to site readiness and unforeseen supply delays.';
    const note = (b) => { b.run('renderTimeline()'); return (b.el('timelineSummary').innerHTML.match(/<div class="pay-note">([\s\S]*?)<\/div>/) || [, ''])[1]; };
    assert.equal(note(timelineBuilder(0)), NOTE_NEW);
    assert.equal(note(timelineBuilder(0, { co: 'BI' })), NOTE_NEW);
    assert.equal(/Minimum two weeks/.test(NOTE_NEW), false);
    for (const [name, o] of Object.entries(EARLIER)) assert.equal(note(timelineBuilder(0, o)), NOTE_OLD, name);
    // consistent with the rest of the document: the strip says "Lead time from 25 working days", every configured line "25 working days min."
    const b = timelineBuilder(0); b.run('renderTotals()');
    assert.match(b.el('summaryStrip').textContent, /Lead time from 25 working days/);
    assert.match(b.el('itemsNotes').innerHTML, /Lead time: 25 working days minimum, from downpayment and approved drawings\./);
    // an order whose materials make the formula longer than 25 days: the note still reads true (it names both) and the days follow the formula
    const big = timelineBuilder(200000); big.run('renderTimeline()');
    assert.ok(big.el('timelineSummary').innerHTML.includes('49 calendar days (~7.0 weeks)'));
    assert.equal(note(big), NOTE_NEW);
  });

  it('the Auto button and the calculator say the rule in force (25 working days min. / the earlier 2 weeks + 3d per ₱20k) and ↻ Auto stores the calendar days', () => {
    const b = timelineBuilder(0); b.run('renderTimeline()');
    assert.equal(b.el('autoLeadBtn').textContent, '↻ Auto (25 working days min., no Sundays)');
    assert.match(b.el('autoLeadBtn').title, /^25 working days minimum, or 12 working days \+ 3 working days per ₱20,000 of materials if that is longer/);
    b.run('autoFillLead()');
    assert.equal(b.el('overallLead').value, 29);
    for (const o of Object.values(EARLIER)) {
      const e = timelineBuilder(0, o); e.run('renderTimeline()');
      assert.equal(e.el('autoLeadBtn').textContent, '↻ Auto (2 wks + 3d/₱20k, no Sundays)');
      assert.match(e.el('autoLeadBtn').title, /^Minimum 2 weeks \(12 working days\) \+ 3 working days per ₱20,000 of materials/);
      e.run('autoFillLead()');
      assert.equal(e.el('overallLead').value, 14);
    }
    // the calculator's own Timeline row (Estimator): ₱0 → 25 working days ≈ 4.2 weeks; ₱120,000 → 30 ≈ 5.0 weeks; the earlier rule on Brilliant Steel
    const row = (bb, m) => bb.run(`renderTrueCostPanelHtml(Object.assign({}, computeTrueCost(), { materials: ${m} }))`).match(/>Timeline: ([^<]*)</)[1];
    const k = sellBuilder(sampleItems());
    assert.equal(row(k, 0), '25 working days (no Sundays) ≈ 4.2 weeks');
    assert.equal(row(k, 120000), '30 working days (no Sundays) ≈ 5.0 weeks');
    assert.equal(row(sellBuilder(sampleItems(), { co: 'BS' }), 0), '12 working days (no Sundays) ≈ 2.0 weeks');
    assert.equal(row(sellBuilder(sampleItems(), { plan: '' }), 0), '12 working days (no Sundays) ≈ 2.0 weeks');
  });

  it('the "+2% priority order" threshold measures against the timeline of the rule in force: cut it by more than a third of 29 days (below 19.3) on Barro Kitchens, of 14 days (below 9.3) on Brilliant Steel and "as issued"; the 14 days ↻ Auto used to give is a priority order only under the new rule', () => {
    const rush = (o, entered) => { const b = timelineBuilder(0, { ...o, lead: entered }); b.el('showVat').checked = true; b.run('renderTimeline(); renderTotals();'); return money(b); };
    assert.equal(rush({}, 19).rushActive, true);
    assert.equal(rush({}, 20).rushActive, false);
    assert.equal(rush({}, 29).rushActive, false);
    assert.equal(rush({}, '').rushActive, false, 'no lead typed: the auto one is never a rush');
    for (const [name, o] of Object.entries(EARLIER)) { assert.equal(rush(o, 9).rushActive, true, name); assert.equal(rush(o, 10).rushActive, false, name); }
    // the same stored 14 days, before / after
    assert.equal(rush({}, 14).rushActive, true, 'new rule: 14 < 29 × ⅔');
    for (const o of Object.values(EARLIER)) assert.equal(rush(o, 14).rushActive, false);
    // the banner in the Timeline block names the standard it measures against
    const b = timelineBuilder(0, { lead: 14 }); b.run('renderTimeline()');
    assert.ok(b.el('timelineSummary').innerHTML.includes('the timeline is cut by more than a third of the standard (29 days). A +2% Priority Order Charge applies to the grand total.'));
    const e = timelineBuilder(0, { ...EARLIER.BS, lead: 9 }); e.run('renderTimeline()');
    assert.ok(e.el('timelineSummary').innerHTML.includes('of the standard (14 days)'));
  });

  it('EXACTLY which totals move: none while the typed lead is not a shortening (blank, the auto days, longer) — and, when it is, ONLY the priority surcharge (+2% of the net, charged before VAT): ₱433,300 → +₱8,666, grand ₱485,296 → ₱495,001.92', () => {
    const pack = (b) => JSON.stringify({ totals: money(b), totalsTbl: b.el('totalsTbl').innerHTML, paymentSummary: b.el('paymentSummary').innerHTML.replace(/\([A-Z][a-z]+ \d+, \d{4}\)|estimated [A-Z][a-z]+ \d+, \d{4}/g, ''), prices: priceFields(b) });
    const run = (o, lead) => { const b = timelineBuilder(0, { ...o, lead }); b.el('showVat').checked = true; b.run('renderItems(); renderTimeline(); renderTotals();'); return b; };
    // no shortening: the same JSON under the new rule, the earlier rule and "as issued" (only the completion DATE in the payment note differs — it is blanked out above)
    for (const lead of ['', 29, 30, 60]) {                    // (14 IS a shortening under the new rule: below)
      assert.equal(pack(run({}, lead)), pack(run({ plan: '' }, lead)), `lead ${lead || 'blank'}`);
      assert.equal(pack(run({}, lead)), pack(run({ plan: '' }, '')), `lead ${lead || 'blank'} vs blank, as issued`);
    }
    const none = money(run({}, '')), rushed = money(run({}, 14)), issued = money(run({ plan: '' }, 14));
    assert.deepEqual([none.subtotal, none.rushActive, none.rushFee, none.vatAmt, none.grand], [433300, false, 0, 51996, 485296]);
    assert.deepEqual([rushed.subtotal, rushed.rushActive, rushed.rushFee, rushed.vatAmt, +rushed.grand.toFixed(2)], [433300, true, 8666, +(441966 * 0.12).toFixed(2), 495001.92]);
    assert.deepEqual([issued.rushActive, issued.grand], [false, 485296], 'the same stored lead on a quotation "as issued": not a rush, nothing moves');
    // every other field of the totals is identical between the rushed and the unrushed quote
    for (const k of Object.keys(none)) if (!['rushActive', 'rushFee', 'rushCharged', 'vatAmt', 'grand', 'grandNoDisc'].includes(k)) assert.deepEqual(rushed[k], none[k], `totals.${k} moved`);
    // …and no line price moved
    assert.deepEqual(priceFields(run({}, 14)), priceFields(run({}, '')));
    // the FOC switch still gives the +2% back as a discount (the rule's own behaviour, unchanged)
    const f = timelineBuilder(0, { lead: 14 }); f.el('showVat').checked = true; f.el('rushFoc').checked = true;
    const foc = money(f);
    assert.deepEqual([foc.rushActive, foc.rushFoc, foc.rushCharged, foc.focRush], [true, true, 0, 8666]);
  });

  it('switching the company repaints the Timeline at once (renderTotals() repaints it): Brilliant Steel gets the earlier days, note and Auto label, Barro Kitchens / Barro Industries the current ones', () => {
    const b = timelineBuilder(0); b.run('renderTimeline()');
    const has = (needle) => b.el('timelineSummary').innerHTML.includes(needle);
    assert.ok(has('29 calendar days') && has('25 working days minimum'));
    b.run(`setCompany('BS')`);
    assert.ok(has('14 calendar days') && has('Minimum two weeks') && !has('25 working days minimum'));
    assert.equal(b.el('autoLeadBtn').textContent, '↻ Auto (2 wks + 3d/₱20k, no Sundays)');
    for (const co of ['BK', 'BI']) {
      b.run(`setCompany(${JSON.stringify(co)})`);
      assert.ok(has('29 calendar days') && has('25 working days minimum') && !has('Minimum two weeks'), co);
      assert.equal(b.el('autoLeadBtn').textContent, '↻ Auto (25 working days min., no Sundays)', co);
    }
  });

  it('the timeline rule lives in the builder only: neither money-core.js nor pricing-core.js carries it, and the earlier text is gone from the live copy (Help and the demo name the rule in force)', () => {
    for (const f of ['js/money-core.js', 'js/pricing-core.js']) assert.equal(/autoLeadDays|20000|LEAD_MIN_WORKING_DAYS/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), false, f);
    const help = (HTML.match(/<div class="modal-body" id="helpBody">[\s\S]*?<h4>What's new<\/h4>/) || [''])[0];
    assert.match(help, /The <strong>project timeline<\/strong> is 25 working days minimum \(or 12 working days \+ 3 per ₱20,000 of materials, if longer; Sundays never counted\) on Barro Kitchens and Barro Industries quotations; Brilliance Steel keeps minimum 2 weeks \+ 3 per ₱20,000\./);
    const steps = makeEnv().plain('TOUR_STEPS');
    assert.match(steps.find((s) => s.target === '#diSection').body, /the ↻ Auto button computes the lead: 25 working days minimum, or 12 working days plus 3 per ₱20,000 of materials if that is longer, Sundays excluded \(Brilliance Steel and quotations issued before the warranty plan keep the earlier rule: minimum 2 weeks plus 3 per ₱20,000\)/);
    assert.equal(/minimum 2 weeks plus 3 working days per ₱20,000 of materials, Sundays excluded\./.test(HTML), false);
    // the markup's own button starts on the current rule
    assert.match(HTML, /<button class="btn btn-outline" style="background:var\(--dark-blue\);" id="autoLeadBtn" onclick="autoFillLead\(\)" title="25 working days minimum[^"]*">↻ Auto \(25 working days min\., no Sundays\)<\/button>/);
  });
});

// ═══════════════════════════════════════ AS ISSUED (owner ruling 2026-11-05: freeze the legacy warranty) ═══════════════════════════════════════
// A quotation FILED before the warranty plan existed and now REOPENED (edit a copy / update) or REVISED keeps what it was issued with: the old Warranty and Site Requirements wording, the earlier timeline
// rule (so its lead time, its completion date and — through the "+2% priority order" threshold — its price cannot move on reopen), no Standard page. The marker is the plan select holding '' ("As issued");
// it rides PRICING_IDS, so it survives every re-save. A stored termsContent override still wins. A new quote, a draft, a link and a TEMPLATE are the current rules; picking a plan brings an issued quote onto them.
// A REVISION of an issued quotation stays as issued until staff pick a plan (the owner's recommendation). Mutation-tested in a scratch copy (see the phase report): the reopen flag not set / read; '' not
// honoured through a re-save; a template or a draft keeping the old rules; the old wording or the earlier rule applied to the current ones (or the reverse); the stored override not winning; the select not
// repainting the timeline / totals / sheets; the "As issued" option or note not shown; Brilliant Steel changed by the marker.
describe('AS ISSUED — a quotation filed before the warranty plan existed keeps the wording and the timeline rule it was issued with; a new quote, a draft and a template do not', () => {
  const OLD_WARRANTY = '12 months warranty on fabrication workmanship. Warranty does not cover misuse, physical damage, or failure to maintain equipment properly.';
  const OLD_SITE = 'Client is responsible for ensuring site is ready for installation. Barro Kitchens is not liable for delays due to unprepared site conditions.';
  const NEW_SITE_BI = 'Client is responsible for ensuring site is ready for installation. Barro Industries OPC is not liable for delays due to unprepared site conditions.';
  const termText = (b, id) => { const block = b.el('termsGrid').innerHTML.split('<div class="terms-block').find((x) => x.includes(`saveTerm('${id}'`)); return (block.match(/<div class="term-content"[^>]*>([\s\S]*?)<\/div>/) || [, ''])[1]; };
  // a filed quotation as the app hands it back to the builder (LOAD_QUOTE): the filed editableState plus the lineage stamp; its pricing carries NO plan and NO Standard-page key
  const filed = (over = {}) => ({ currentCo: 'BK', items: legacyOf(sampleItems()), quoteNo: 'BKLUFB260901-001R1', clientName: 'Maria Santos', quoteDate: '2026-09-01', filedAt: '2026-09-01T03:00:00.000Z', termsContent: {}, termsEnabled: {},
    pricing: { showVat: true, quoteValidDays: '30', projStart: '2026-09-01', overallLead: '14', dpMode: '50', balMode: 'lump' }, sourceDocId: 'doc-1', sourceCollection: 'bk_quotes', rootQuoteId: 'doc-1', ...over });
  const load = (state, opts = { asRevision: false }) => { const b = sellBuilder([]); b.run(`computeTrueCost = function () { return { materials: 0 }; }; loadEditableState(${JSON.stringify(state)}, ${JSON.stringify(opts)})`); return b; };
  const optionStub = (b) => { const opt = { hidden: true }; b.el('warrantyPlan').querySelector = (sel) => (sel === 'option[value=""]' ? opt : null); const note = b.el('legacyDocNote'); return { opt, note }; };

  it('REOPEN: the Warranty and Site Requirements terms print what the quotation was issued with — for Barro Kitchens AND Barro Industries — the select shows "As issued", and nothing states the 6-month warranty, a lead time or a Standard page', () => {
    for (const co of ['BK', 'BI']) {
      const b = load(filed({ currentCo: co, items: sampleItems() }));      // (new lines added since carry a ruled lead: a quotation under the earlier rule must not print it)
      assert.equal(b.el('warrantyPlan').value, '', co);
      assert.equal(b.run('isLegacyDoc()'), true);
      assert.equal(termText(b, 'tc_warranty'), OLD_WARRANTY, co);
      assert.equal(termText(b, 'tc_site'), OLD_SITE, `${co}: the old Site wording names Barro Kitchens whichever company quotes`);
      assert.equal(b.run('warrantyIsDefault()'), false, 'it does not state the current wording elsewhere');
      assert.equal(b.el('showStandardPage').checked, false);
      assert.equal(b.el('standardPage').innerHTML, '');
      const strip = b.el('summaryStrip').textContent;
      assert.equal(/warranty|PMS|Lead time/.test(strip), false, `${co}: the strip says "${strip}"`);
      assert.equal(/Lead time/.test(b.el('itemsNotes').innerHTML), false, `${co}: no lead-time sentence under the table`);
      assert.match(b.el('itemsNotes').innerHTML, /Dimensions are Length × Width × Height in mm/, 'the legend itself stays');
      assert.equal(/<td class="ss-l">Lead time<\/td>/.test(b.el('itemsTbody').innerHTML), false, `${co}: no lead-time row on any line`);
      assert.match(b.el('itemsTbody').innerHTML, /<td class="ss-l">Finish<\/td><td class="ss-v">Hairline finish<\/td>/, 'the rest of the sheet is untouched');
      assert.equal(/ms-chip[^>]*>no lead|no lead/i.test(b.el('itemsTbody').innerHTML), false);
    }
    // the same quotation, current rules: the contrast
    const fresh = sellBuilder(sampleItems(), { co: 'BI' });
    fresh.run('renderTerms()');
    assert.equal(termText(fresh, 'tc_site'), NEW_SITE_BI);
    assert.match(fresh.el('itemsNotes').innerHTML, /Lead time: 25 working days minimum/);
  });

  it('REOPEN: a wording STORED with the quotation (termsContent) still wins over the as-issued default; switching the term off still removes it', () => {
    const b = load(filed({ termsContent: { tc_warranty: 'Our own warranty wording.', tc_site: 'Our own site wording.' } }));
    assert.equal(termText(b, 'tc_warranty'), 'Our own warranty wording.');
    assert.equal(termText(b, 'tc_site'), 'Our own site wording.');
    assert.equal(b.run('termsContent.tc_warranty'), 'Our own warranty wording.');
    // an unedited block clicked in and out is not stored (it keeps following its default: the old one now, the plan's after a plan is picked)
    const c = load(filed());
    c.run(`saveTerm('tc_warranty', { innerHTML: ${JSON.stringify(OLD_WARRANTY)} })`);
    assert.equal(c.run(`'tc_warranty' in termsContent`), false);
  });

  it('REOPEN: the timeline rule it was issued with — its stored 14 days is NOT a priority order, its auto timeline is still 14 days and the earlier note prints — so its totals cannot move on reopen', () => {
    const b = load(filed());
    assert.equal(b.run('leadRuleIsNew()'), false);
    assert.equal(b.run('autoLeadDays()'), 14);
    assert.equal(b.run('getLeadDays()'), 14, 'the stored lead time');
    const t = money(b);
    assert.deepEqual([t.rushActive, t.rushFee, t.subtotal, t.grand], [false, 0, 433300, 433300]);
    b.run('renderTimeline()');
    assert.ok(b.el('timelineSummary').innerHTML.includes('Minimum two weeks, plus 3 working days per ₱20,000 of materials'));
    assert.equal(b.el('timelineSummary').innerHTML.includes('SPECIAL RUSH'), false);
    // the SAME state loaded as a draft (no sourceDocId: nothing was issued) follows the current rule, where the stored 14 days IS a shortening — visible in the Timeline banner and the totals row
    const d = load(filed({ sourceDocId: undefined, sourceCollection: undefined, rootQuoteId: undefined }));
    assert.equal(d.el('warrantyPlan').value, 'service6');
    assert.equal(d.run('autoLeadDays()'), 29);
    const dt = money(d);
    assert.deepEqual([dt.rushActive, dt.rushFee, dt.grand], [true, 8666, 441966], '+2% of the ₱433,300 net, before VAT');
    d.run('renderTimeline()');
    assert.ok(d.el('timelineSummary').innerHTML.includes('SPECIAL RUSH'));
  });

  it('RE-SAVE: the marker is saved with the quotation (payload, draft) — a second reopen, or a draft of the reopened quote, stays as issued; a TEMPLATE made from it starts a new quote on the current rules', () => {
    const b = load(filed());
    const pl = b.plain('buildQuotePayload()');
    assert.equal(pl.editableState.pricing.warrantyPlan, '');
    assert.equal(b.plain('getPricingFields().warrantyPlan'), '');
    b.run('flushSaveToStorageNow()');
    assert.equal(JSON.parse(b.store.get('bkqb_pricing')).warrantyPlan, '');
    // a draft of it (the state, no sourceDocId): still as issued — the explicit '' is the marker
    const d = load({ ...pl.editableState, sourceDocId: undefined });
    assert.equal(d.el('warrantyPlan').value, '');
    assert.equal(termText(d, 'tc_warranty'), OLD_WARRANTY);
    // …and a second reopen of the re-filed doc
    const r = load({ ...pl.editableState, sourceDocId: 'doc-2' });
    assert.equal(r.el('warrantyPlan').value, '');
    // a template: stripTemplateState turns it into a quote of the current rules (plan, page), and so does a pre-release template that has no plan
    const tpl = b.plain('stripTemplateState(buildQuotePayload().editableState)');
    assert.deepEqual([tpl.pricing.warrantyPlan, tpl.pricing.showStandardPage], ['service6', true]);
    assert.equal(tpl.clientName, '');
    for (const state of [tpl, { ...filed(), sourceDocId: undefined, clientName: '', quoteNo: '', filedAt: '' }, { ...pl.editableState, clientName: '', quoteNo: '', filedAt: '' }]) {
      const t = sellBuilder([]);
      t.run(`loadEditableState(${JSON.stringify(state)}, { asRevision: false, template: true })`);
      assert.equal(t.el('warrantyPlan').value, 'service6', 'a template is a NEW quote');
      assert.equal(termText(t, 'tc_warranty'), WARRANTY_SERVICE);
      assert.equal(t.run('isLegacyDoc()'), false);
      assert.equal(t.run('leadRuleIsNew()'), true);
    }
    // a template that came from an as-issued quote does not carry the missing Standard page into the new quote
    const t2 = sellBuilder([]);
    t2.run(`loadEditableState(${JSON.stringify(b.plain('buildQuotePayload().editableState'))}, { asRevision: false, template: true })`);
    assert.equal(t2.el('showStandardPage').checked, false, 'only through stripTemplateState (saveAsTemplate) is it normalised: an unstripped state keeps its stored tick');
    b.run('prompt = () => "Old range bundle"; saveAsTemplate();');
    const posted = b.posted.find((p) => p.msg.type === 'QUOTE_SAVE_TEMPLATE').msg.payload.state;
    assert.deepEqual([posted.pricing.warrantyPlan, posted.pricing.showStandardPage], ['service6', true], 'a template saved from an as-issued quote is a new-quote template');
  });

  it('the app\'s messages: LOAD_QUOTE (a reopen, or a new revision) of a filing with no plan is "as issued"; LOAD_TEMPLATE of the very same state starts a NEW quote on the current rules', () => {
    const send = (b, data) => b.listeners.window.message.forEach((fn) => fn({ origin: 'http://localhost', data }));
    const state = filed({ clientName: '', quoteNo: '', filedAt: '' });
    const q = sellBuilder([]); q.run('computeTrueCost = function () { return { materials: 0 }; };');
    send(q, { type: 'LOAD_QUOTE', payload: { editableState: filed(), asRevision: false } });
    assert.deepEqual([q.el('warrantyPlan').value, termText(q, 'tc_warranty')], ['', OLD_WARRANTY]);
    send(q, { type: 'LOAD_QUOTE', payload: { editableState: filed(), asRevision: true } });
    assert.deepEqual([q.el('warrantyPlan').value, q.el('quoteNo').value], ['', 'BKLUFB260901-001R2'], 'a new revision of an issued quotation is still as issued');
    send(q, { type: 'LOAD_TEMPLATE', payload: { state } });
    assert.deepEqual([q.el('warrantyPlan').value, q.el('showStandardPage').checked, termText(q, 'tc_warranty')], ['service6', true, WARRANTY_SERVICE], 'a template is a new quote: the current wording and the Standard page');
    const t2 = sellBuilder([]);
    send(t2, { type: 'LOAD_TEMPLATE', payload: { state: { ...state, pricing: { ...state.pricing, warrantyPlan: '' } } } });
    assert.equal(t2.el('warrantyPlan').value, 'service6', 'even a template that still carries the marker');
    assert.match(t2.toast(), /Template loaded/);
  });

  it('REVISION of an issued quotation stays AS ISSUED until staff pick a plan: the old wording, the earlier timeline, no Standard page — then picking a plan brings it onto the current terms (wording, 25-day rule, sheets, totals) and says so', () => {
    const b = load(filed({ items: sampleItems() }), { asRevision: true });
    const { opt, note } = optionStub(b);
    b.run('syncLegacyDocUi()');
    assert.equal(b.el('warrantyPlan').value, '');
    assert.equal(opt.hidden, false, 'the "As issued" choice is offered while the quote is as issued');
    assert.equal(note.style.display, '', 'and the note explains it');
    assert.equal(termText(b, 'tc_warranty'), OLD_WARRANTY);
    assert.equal(b.el('quoteNo').value, 'BKLUFB260901-001R2', 'it is a revision (R2)');
    assert.equal(money(b).rushActive, false);
    // staff pick the standard plan
    b.el('warrantyPlan').value = 'service6'; b.run('onWarrantyPlanChange()');
    assert.equal(b.run('isLegacyDoc()'), false);
    assert.equal(termText(b, 'tc_warranty'), WARRANTY_SERVICE, 'the plan\'s wording');
    assert.equal(termText(b, 'tc_site'), 'Client is responsible for ensuring site is ready for installation. Barro Kitchens is not liable for delays due to unprepared site conditions.', 'Barro Kitchens quoting: the same words');
    assert.equal(b.run('autoLeadDays()'), 29, 'the new rule');
    assert.match(b.el('summaryStrip').textContent, /Lead time from 25 working days · .*6-month service warranty$/);
    assert.match(b.el('itemsNotes').innerHTML, /Lead time: 25 working days minimum/);
    assert.match(b.el('itemsTbody').innerHTML, /<td class="ss-l">Lead time<\/td><td class="ss-v">25 working days min\.<\/td>/);
    assert.ok(b.el('timelineSummary').innerHTML.includes('25 working days minimum, or 12 working days plus 3'), 'the Timeline note repainted');
    const t = money(b);
    assert.deepEqual([t.rushActive, t.rushFee], [true, 8666], 'the stored 14 days is now a priority order — the totals row shows it');
    assert.match(b.toast(), /^This quotation now follows the current terms: the plan’s warranty wording and a lead time of 25 working days minimum\. The lead time stored on it is now a priority order \(\+2%\) — press ↻ Auto to reset it\.$/);
    assert.equal(opt.hidden, false, 'the choice stays offered, so staff can go back');
    assert.equal(note.style.display, 'none');
    assert.equal(b.run('getPricingFields().warrantyPlan'), 'service6', 'saved: it is now a quote of the current rules');
    // ↻ Auto resets the stored lead and the surcharge goes
    b.run('autoFillLead()');
    assert.equal(money(b).rushActive, false);
    // and back to "As issued": the old wording and the earlier timeline return
    b.el('warrantyPlan').value = ''; b.run('onWarrantyPlanChange()');
    assert.equal(termText(b, 'tc_warranty'), OLD_WARRANTY);
    assert.equal(b.run('leadRuleIsNew()'), false);
    assert.equal(/Lead time/.test(b.el('itemsNotes').innerHTML), false);
  });

  it('picking a plan calls every repaint itself — the terms, the line sheets, the strip / legend / Standard page, the Timeline and the totals — and saves; a plan change on a NEW quote says nothing', () => {
    const b = load(filed());
    b.run(`var __calls = []; ['renderTerms', 'renderItems', 'renderDocExtras', 'renderTimeline', 'renderTotals', 'saveToStorage'].forEach(function (n) { globalThis[n] = function () { __calls.push(n); }; });`);
    b.el('warrantyPlan').value = 'service6'; b.run('onWarrantyPlanChange()');
    assert.deepEqual([...b.plain('__calls')].sort(), ['renderDocExtras', 'renderItems', 'renderTerms', 'renderTimeline', 'renderTotals', 'saveToStorage']);
    const n = sellBuilder(sampleItems());
    n.b = null;
    n.el('warrantyPlan').value = 'kitchenshield12'; n.run('onWarrantyPlanChange()');
    assert.equal(n.toast(), '', 'a plan change on a quote that was never "as issued" says nothing');
    n.el('warrantyPlan').value = 'service6'; n.run('onWarrantyPlanChange()');
    assert.equal(n.toast(), '');
  });

  it('a line\'s sheet repainted in place (an Includes edit) follows the quotation\'s timeline rule too: no lead-time row on an "as issued" one, the row on a current one — and the strength and the chips of an "as issued" quotation do not count a lead time', () => {
    const lineSheet = (b) => { const slot = { innerHTML: '' }, chips = { innerHTML: '' }; const row = { querySelector: (sel) => (sel === '.sheet-slot' ? slot : sel === '.ld-chips' ? chips : null) }; b.el('itemsTbody').querySelector = (sel) => (sel === 'tr.item-row[data-idx="1"]' ? row : null); b.run('editIncludes(1, { value: "one\\ntwo" })'); return slot.innerHTML; };
    const issued = load(filed({ items: sampleItems() }));
    assert.equal(/Lead time/.test(lineSheet(issued)), false, 'as issued');
    assert.match(lineSheet(sellBuilder(sampleItems())), /<td class="ss-l">Lead time<\/td><td class="ss-v">25 working days min\.<\/td>/);
    // a made-to-order line with a size, specs and a finish but no ruled lead time: complete as issued, lacking the lead time on a current quote
    const custom = { id: 'CUSTOM', category: 'miscellaneous', name: 'Gate', dims: 'L1 mm', specs: [], specEdit: 'Mild steel', finish: 'satin', includes: [], excludes: [], specLines: [], qty: 1, unit: 'pc', unitPrice: 1000, amount: 1000, leadTime: '', formulaType: 'fixed' };
    const a = load(filed({ items: [custom] })), c = sellBuilder([custom]);
    assert.deepEqual(a.plain('lineCompleteness(items[0], 0).missing'), ['photo']);
    assert.deepEqual(c.plain('lineCompleteness(items[0], 0).missing'), ['lead', 'photo']);
    assert.equal(a.plain('docQuality().counts.lead'), 0);
    assert.equal(c.plain('docQuality().counts.lead'), 1);
  });

  it('picking a plan on an issued quotation WITHOUT a stored lead time says nothing about a priority order (nothing moves: the auto timeline just becomes 25 working days)', () => {
    const b = load(filed({ pricing: { showVat: true, quoteValidDays: '30', projStart: '2026-09-01' } }));
    assert.equal(b.run('getLeadDays()'), 14);
    b.el('warrantyPlan').value = 'kitchenshield12'; b.run('onWarrantyPlanChange()');
    assert.equal(b.toast(), 'This quotation now follows the current terms: the plan’s warranty wording and a lead time of 25 working days minimum.');
    assert.equal(money(b).rushActive, false);
    assert.equal(b.run('getLeadDays()'), 29);
    assert.equal(termText(b, 'tc_warranty'), `${WARRANTY_SERVICE} This project includes 12 months of preventive maintenance service (PMS) with KitchenShield™.`);
  });

  it('NEW QUOTE, DRAFT and LINK read the current rules; a FILED new-schema quotation reopened keeps its plan and its page; the marker never makes Brilliant Steel differ', () => {
    // 🗑 New
    const n = sellBuilder(sampleItems(), { plan: '' });
    n.run('clearForm()');
    assert.deepEqual([n.el('warrantyPlan').value, n.el('showStandardPage').checked, n.run('isLegacyDoc()'), n.run('leadRuleIsNew()')], ['service6', true, false, true]);
    // a reopened filing of the NEW schema (it carries a plan): untouched
    for (const plan of ['service6', 'kitchenshield12']) {
      const b = load(filed({ pricing: { showVat: true, warrantyPlan: plan, showStandardPage: true } }));
      assert.deepEqual([b.el('warrantyPlan').value, b.run('isLegacyDoc()'), b.run('leadRuleIsNew()')], [plan, false, true], plan);
      assert.equal(termText(b, 'tc_warranty').startsWith('6-month service warranty'), true);
    }
    // Brilliant Steel: old wording and the earlier timeline whatever the marker, and its output is the same as ever
    for (const state of [filed({ currentCo: 'BS' }), filed({ currentCo: 'BS', pricing: { warrantyPlan: 'service6', projStart: '2026-09-01', overallLead: '14' } })]) {
      const b = load(state);
      assert.equal(termText(b, 'tc_warranty'), OLD_WARRANTY);
      assert.equal(termText(b, 'tc_site'), OLD_SITE);
      assert.equal(b.run('leadRuleIsNew()'), false);
      assert.equal(b.run('autoLeadDays()'), 14);
      assert.equal(money(b).rushActive, false);
      assert.equal(b.el('standardPage').innerHTML, '');
      assert.equal(b.el('summaryStrip').textContent, '');
    }
  });

  it('the plan select offers "As issued" only for a quotation that came in that way (a hidden option until then), with the explanatory note; 🗑 New and a new quote hide both again', () => {
    assert.match(HTML, /<option value="" hidden>As issued — earlier wording and timeline<\/option>/);
    assert.match(HTML, /<div class="pc-hint" id="legacyDocNote" style="display:none;[^"]*">This quotation was issued before the warranty plan existed, so it keeps the warranty and site-requirements wording and the timeline rule it was issued with\. Pick a plan to bring it onto the current terms \(the plan’s warranty wording and a lead time of 25 working days minimum\)\.<\/div>/);
    const b = sellBuilder([]); const { opt, note } = optionStub(b);
    b.run(`loadEditableState(${JSON.stringify(filed())}, { asRevision: false })`);
    assert.deepEqual([opt.hidden, note.style.display], [false, '']);
    b.el('warrantyPlan').value = 'service6'; b.run('onWarrantyPlanChange()');
    assert.deepEqual([opt.hidden, note.style.display], [false, 'none']);
    b.run('clearForm()');
    assert.deepEqual([opt.hidden, note.style.display], [true, 'none'], 'a new quote does not offer it');
    b.run(`loadEditableState(${JSON.stringify(filed({ pricing: { warrantyPlan: 'service6' } }))}, { asRevision: false })`);
    assert.deepEqual([opt.hidden, note.style.display], [true, 'none']);
  });
});

const WARRANTY_SERVICE = '6-month service warranty on our equipment and work. Warranty does not cover misuse, physical damage, or failure to maintain the equipment.';
