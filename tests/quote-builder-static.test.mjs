// tests/quote-builder-static.test.mjs — quote-builder-v2.html, the CONFIGURATOR (specs/QUOTE-BUILDER-CONFIGURATOR-SPEC.md §9, work chunk WS-2).
//
// quote-builder-v2.html is one 9,000-line HTML file with one inline <script> and no module system, so it cannot be require()d. Two layers:
//
//   1. STATIC — the markup and the constants: the three new script tags and their order, the tutorial (TUTORIAL_VERSION 43, the What's New
//      entry, the guided-demo step and every selector it targets), ESTIMATE_RANGE_MODE, the A5 letterhead strings, CO.BS byte-for-byte,
//      and the two rules of the price-protection design that are about WHAT THE FILE MAY NAME: it never names the pricing function
//      (it prices only through QBConfigured) and it reads the option sheets (the product_pricing collection) in exactly one place — inside
//      loadDatabase()'s internal-session branch (spec §2.3).
//   2. BEHAVIOUR — the real inline script is executed inside a node:vm context against a small DOM stub, with the real
//      js/product-families.js, js/qr-families.js, js/pricing-core.js and js/qb-configured.js, and SYNTHETIC odd-figure catalogue data
//      (the repository is PUBLIC: the real price master and option sheets are private). The money paths are exercised for real:
//        R1  the cost-plus auto-pricer leaves 'website' / 'manual' lines alone and reprices 'cost' / unlabelled ones (applyComputedPricing)
//        R3  re-configuring a line: website recomputes, cost leaves the figure to the auto-pricer, manual keeps the staff price
//        R4  Use cost-based / Use website / Apply cost-based to all / typed price / ↺ re-apply / pass-through
//        R5  a line flagged "needs a price" blocks canFile() AND fileQuotation(); the gate is silent for a partner
//        §3.2 `_cfg` is stripped from the payload, the draft in localStorage and templates; sourceRef / estimateCheck are filed
//        §4.5 itemCostBasis() hands a configured line to QBConfigured.costBasisFor (not to its primary SKU's cost)
//        §2.3/§2.5 loadDatabase(): the sheets are read for an internal session only, a denied read degrades, the kill switch works
//        §4.2 the panel is generated from the definitions: every group type, option and size axis of every family — and of a family that
//             does not exist yet — renders with no code change
//        §4.9 the guided demo opens the panel read-only, adds nothing, closes it again
//
// Mutation-tested in scratch copies (never the shared tree) — each of these must fail here: the auto-pricer predicate reduced to the old
// `priceManual` test; the R5 gate dropped from canFile() / from fileQuotation() / its `unitPrice > 0` clause dropped; `_cfg` left in the
// strip list or the localStorage draft; the cost-basis hook removed from itemCostBasis(); R3 overwriting a manual or cost price / failing to
// reprice a website line; the typed price not recorded as `manual`; ↺ re-apply not returning a line to `cost`; sourceRef kept by a template;
// the sheet read moved outside the !PARTNER_MODE branch; the kill switch ignored; a hand-off ignoring qnoLoc / qnoMethod; the partner
// removal list losing #configPanel; the tour adding a line or leaving the panel open; the version not bumped.
//
// WS-5C (owner ruling 2026-10-28 — the staff-only 1.2 mm top plate, spec §14.6) adds, at the end of the file: the "staff" chip, the 1.2 mm choice and its price from a
// real cell only, the Construction row that is printed, a line saved before the top plate existed, the hidden ⇄ PT chip on configured lines, and the builder
// SECTION of a configured line (base product's own; fallbacks; the hand-off's public category re-homed). Mutation-tested in scratch copies — each of these must fail
// here: validateLine / validateConfiguration called without { staff:true } (or with staff:false), no chip / a chip on every group / a chip without no-print or title,
// the section fallback of cfgMakeLine / cfgConvertLine removed or the catalogue not handed to the migration, the hand-off re-homing moving any section / never moving /
// ignoring a database section of the same name / not run on load / not run when the database arrives, the PT chip shown on configured lines again / hidden on every
// line / hidden on a configured line that carries the flag, the tutorial bullet / Help sentence / tour sentence missing or TUTORIAL_VERSION bumped, a re-configure that
// does not rewrite the printed specs, priceLine no longer reading an absent group as its default. Run with: node --test tests/*.test.mjs

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
  out.set('CE-016', prod('CE-016', 'cooking_line', 'fixed', 21911, {}, {}));
  return [...out.values()];
})();
function sheetFor(familyId, { approved = true } = {}) {
  const f = FAM.families[familyId];
  const options = {};
  let i = 0;
  for (const c of PF.cells(f)) {
    i++;
    if (c.baseline) continue;
    (options[c.group] = options[c.group] || {})[c.value] = { flat: (i % 7 === 3 ? -1 : 1) * (311 + 97 * i), perW100: i % 4 === 1 ? 13 + i : null };
  }
  return { familyId, schemaVersion: FAM.version, approved, approvedBy: 'u_syn', options, size: { perW100: familyId === 'wall_shelf' ? 77 : null } };
}
const SHEETS = Object.fromEntries(FAM.order.map((id) => [id, sheetFor(id)]));

// a builder with the synthetic catalogue loaded and no DOM boot (the test sets the state it needs)
function builder(opts = {}) {
  const b = makeEnv(opts);
  b.run(`DB = { products: ${JSON.stringify(CATALOGUE)}, categories: [{id:'prep_washing',label:'Preparation & Washing'},{id:'cooking_line',label:'Cooking Line'}], laborRoles: [], constants: {} };`);
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

// ═══════════════════════════════════════ 1. STATIC — markup, constants, what the file may name ═══════════════════════════════════════
describe('static — the script tags, the tutorial, the letterhead', () => {
  it('the three configurator scripts load, deferred, in order, right after pricing-core.js (qb-configured is handed the others at run time)', () => {
    const tags = [...HTML.matchAll(/<script defer src="(js\/[a-z-]+\.js)"><\/script>/g)].map((m) => m[1]);
    const at = tags.indexOf('js/pricing-core.js');
    assert.ok(at >= 0);
    assert.deepEqual(tags.slice(at, at + 4), ['js/pricing-core.js', 'js/qr-families.js', 'js/product-families.js', 'js/qb-configured.js']);
    assert.equal((HTML.match(/js\/qb-configured\.js/g) || []).length >= 1, true);
  });

  it('TUTORIAL_VERSION is 43 and the newest What\'s New entry is version 43, dated, with the configurator bullets', () => {
    const b = makeEnv();
    assert.equal(b.run('TUTORIAL_VERSION'), 43);
    const wn = b.plain('WHATS_NEW');
    assert.equal(wn[0].ver, 43);
    assert.match(wn[0].date, /^2026-10-\d\d$/);
    assert.deepEqual(wn.map((e) => e.ver), [...wn.map((e) => e.ver)].sort((x, y) => y - x), 'newest first');
    const text = wn[0].items.join(' ');
    for (const must of ['Configure a sink, prep table, stove, cabinet, wall shelf or rack', 'Priced after review', 'Apply cost-based to all', 'estimate range', 'links it back', 'hello@barroindustries.com']) {
      assert.ok(text.includes(must), `What's New 43 does not say: ${must}`);
    }
    assert.equal(new Set(wn.map((e) => e.ver)).size, wn.length, 'no duplicate version');
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

  it('the staff-only top plate is in the tutorial (spec §14.6): the What\'s New 43 entry is APPENDED (43 had not shipped, so no new version), Help "Configure a product" and the demo step say it', () => {
    const b = makeEnv();
    assert.equal(b.run('TUTORIAL_VERSION'), 43, '43 had not shipped: the bullet joins entry 43, the version is not bumped');
    const items = b.plain('WHATS_NEW')[0].items;
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

  it('the product_pricing collection is read in exactly one place: inside loadDatabase(), in its own try/catch, in the !PARTNER_MODE branch', () => {
    const hits = [...HTML.matchAll(/product_pricing/g)].map((m) => m.index);
    const from = HTML.indexOf('async function loadDatabase(');
    const to = HTML.indexOf('function reloadDatabase()');
    assert.ok(from > 0 && to > from);
    assert.ok(hits.length >= 1);
    assert.ok(hits.every((i) => i > from && i < to), 'product_pricing is named outside loadDatabase()');
    const read = HTML.indexOf("db.collection('product_pricing')");
    const branch = HTML.indexOf('if (!PARTNER_MODE) {', from);
    const branchEnd = HTML.indexOf('    DB = {\n      products:', from);
    assert.ok(branch > 0 && read > branch && read < branchEnd, 'the sheet read is not inside the !PARTNER_MODE branch');
    assert.ok(/try \{\s*const sheetSnap = await db\.collection\('product_pricing'\)\.get\(\);/.test(HTML), 'the sheet read has no try/catch of its own');
  });

  it('the kill switch is the productMeta/config.quoteBuilder.configurator === false flag, read from the meta doc already fetched', () => {
    assert.match(HTML, /meta\.quoteBuilder && meta\.quoteBuilder\.configurator === false/);
  });

  it('applyPartnerMode() takes the panel, its backdrop, the chips and every data-cfg control out of the DOM; the configurator is off for a partner', () => {
    const src = makeEnv().run('applyPartnerMode.toString()');
    for (const id of ['configPanel', 'cfgBackdrop', 'cfgChips']) assert.ok(src.includes(`'${id}'`), `${id} is not removed`);
    assert.match(src, /CONFIGURATOR_ON\s*=\s*false/);
    assert.match(src, /data-cfg-open/);
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
    assert.equal(r.old.name, 'My renamed sink');
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
    b.run(`items.length = 0; items.push({id:'CE-016',category:'cooking_line',name:'Fryer',qty:1,unit:'pc',unitPrice:21911,amount:21911});`);
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
    withLines(b, [flagged, { ...flagged, unitPrice: 5000, amount: 5000 }, priced, { id: 'CE-016', category: 'x', name: 'f', qty: 1, unit: 'pc', unitPrice: 0, amount: 0 }]);
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

  it('a partner session is never blocked by it (it never rendered the controls to fix it): needsPriceReason() is empty', () => {
    const b = builder({ search: '?portal=partner' });
    withLines(b, [flagged]);
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
      QB.fromRequestItem({ n: 3, id: 'CE-016', cat: 'cooking_line', name: 'Fryer', qty: 1, unit: 'pc', specs: [] }, { n: 3, priced: true, unitPrice: 30000 }, REF),
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
  const boot = async (opts, fake) => {
    const b = makeEnv({ ...opts, db: fake.db });
    await b.run('loadDatabase()');
    return b;
  };

  it('internal session: the sheets are read once, kept raw by family id, state "live", configurator on', async () => {
    const f = fakeDb();
    const b = await boot({}, f);
    assert.equal(f.reads.filter((r) => r === 'product_pricing').length, 1);
    assert.deepEqual(Object.keys(b.plain('FAMILY_PRICING')).sort(), [...FAM.order].sort());
    assert.equal(b.run('FAMILY_PRICING_STATE'), 'live');
    assert.equal(b.run('CONFIGURATOR_ON'), true);
    assert.equal(b.run('configuratorAvailable()'), true);
  });

  it('partner session: product_pricing is never requested (no doomed round trip, no sheet in the page), the configurator is off', async () => {
    const f = fakeDb();
    const b = await boot({ search: '?portal=partner' }, f);
    assert.equal(f.reads.includes('product_pricing'), false);
    assert.equal(f.reads.includes('products'), true, 'the catalogue itself still loads');
    assert.deepEqual(b.plain('FAMILY_PRICING'), {});
    assert.equal(b.run('FAMILY_PRICING_STATE'), 'skipped');
    assert.equal(b.run('CONFIGURATOR_ON'), false);
    assert.equal(b.run('configuratorAvailable()'), false);
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

  it('every group (choice pills, a select above four options, slots, multi), every option and every size axis of all six families renders', () => {
    const b = builder();
    for (const id of FAM.order) {
      const f = FAM.families[id];
      const html = openAndRender(b, id);
      assert.equal(b.run('cfgState && cfgState.familyId'), id);
      f.groups.forEach((g) => {
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
  });

  it('a seventh family added to the definitions renders with ZERO code change (a choice of 5 → select, slots, multi, two size axes)', () => {
    const b = builder();
    const orderBefore = FAM.order.slice();
    const extra = JSON.parse(JSON.stringify(FAM.families.stove));
    extra.id = 'zz_test'; extra.label = 'Test rig'; extra.primary = 'CE-001';
    extra.groups = [
      { key: 'size5', label: 'Five sizes', type: 'choice', default: 1, options: [1, 2, 3, 4, 5].map((v) => ({ v, l: `S${v}`, s: `s${v}` })) },
      ...extra.groups,
      { key: 'finish', label: 'Finish', type: 'multi', default: [], options: [{ v: 'a', l: 'Alpha', s: 'a' }, { v: 'b', l: 'Beta', s: 'b' }] },
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
    pick(b, 0, 2);                                                       // 3 sinks
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
    pick(b, 0, 2);
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
    b.run(`cfgToggleMulti(1, 2, true)`);                                          // oven
    assert.match(b.el('cfgDH_H').innerHTML, /minimum 850 mm with these options/);
    dim(b, 'H', 800);
    assert.equal(b.el('cfgAddBtn').disabled, true);
    assert.match(b.el('cfgErr_H').innerHTML, /Use 850 mm/);
    dim(b, 'H', 850);
    b.run(`cfgSlotAdd(0); cfgSlotAdd(0); cfgSlotAdd(0)`);                         // 4 burners: usual length is longer than the default
    dim(b, 'W', 700);
    assert.equal(b.el('cfgAddBtn').disabled, false, 'the soft rule never blocks');
    assert.match(b.el('cfgPriceArea').innerHTML, /priced at the usual \d+ mm length for these burners/);
  });

  it('slots: add / remove are bounded by the definition, reorder keeps the order (it is part of the configuration)', () => {
    const b = builder();
    open(b, 'stove');
    for (let i = 0; i < 8; i++) b.run('cfgSlotAdd(0)');
    assert.equal(b.run('cfgState.config.positions.length'), 6);
    assert.match(b.el('cfgBody').innerHTML, /data-cfg-key="g0add" disabled/);
    for (let i = 0; i < 8; i++) b.run('cfgSlotDel(0)');
    assert.equal(b.run('cfgState.config.positions.length'), 1);
    b.run(`cfgSlotAdd(0); cfgSlotSet(0, 1, 2)`);
    const before = b.plain('cfgState.config.positions');
    b.run('cfgSlotMove(0, 0, 1)');
    assert.deepEqual(b.plain('cfgState.config.positions'), [before[1], before[0]]);
    b.run('cfgSlotMove(0, 1, 1)');
    assert.deepEqual(b.plain('cfgState.config.positions'), [before[1], before[0]], 'moving the last one right is a no-op');
  });

  it('priced: the big figure is the website price with its base + options caption; qty multiplies; the panel never touches the shared definitions', () => {
    const b = builder();
    const defsBefore = JSON.stringify(FAM);
    open(b, 'sink');
    pick(b, 0, 1);
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
    pick(b, 0, 1);
    b.run('cfgCommit()');
    assert.equal(b.run('items.length'), 1);
    assert.equal(b.run('cfgState'), null);
    assert.equal(b.run('items[0].config.basins'), 2);
    assert.match(b.toast(), /Added: Sink/);
    b.run('configureLine(0)');
    assert.match(b.el('cfgTitle').innerHTML, /Edit:/);
    assert.equal(b.el('cfgAddBtn').textContent, '✔ Update line');
    pick(b, 0, 2);
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
    assert.equal(b.plain(`cfgConvertLine({ id: 'CE-016', name: 'x' })`), null, 'a SKU no family absorbed is not convertible');
  });

  it('the ⚙ row offers "convert to configured" only for an absorbed SKU, never for custom / fee / non-absorbed lines or in a partner session', () => {
    const b = builder();
    assert.match(b.run(`cfgLineRowHtml(${JSON.stringify(plainSink)}, 3)`), /convertToConfigured\(3\)/);
    for (const it of [{ id: 'CUSTOM', name: 'c' }, { id: 'MISCFEE', name: 'm' }, { id: 'CE-016', name: 'f' }]) assert.equal(b.run(`cfgLineRowHtml(${JSON.stringify(it)}, 0)`), '', it.id);
    const p = builder({ search: '?portal=partner' });
    assert.equal(p.run(`cfgLineRowHtml(${JSON.stringify(plainSink)}, 0)`), '');
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
    assert.equal(b.run(`cfgSoldOnlineHtml('CE-016')`), '', 'a SKU no family absorbed gets no hint');
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

  it('the step is skipped (no panel) when the configurator is unavailable — a partner, or the kill switch', () => {
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
  const STAFF = ['prep_table', 'sink', 'stove'];
  const CHIP = '<span class="cfg-staff-chip no-print" title="Not offered on the website">staff</span>';
  const SINK_CONSTRUCTION = (top) => `SS304 stainless steel · ${top} · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet`;
  const specText = (html) => { const m = /<span class="spec-edit cell-edit"[^>]*>([^<]*)<\/span>/.exec(html); return m ? m[1] : null; };   // what the quote prints for the line's specs

  it('premise: the definitions mark the Top plate staff-only on exactly the table, the sink and the stove — and a PUBLIC validation refuses its 1.2 mm value', () => {
    assert.deepEqual(FAM.order.filter((id) => FAM.families[id].groups.some((g) => g.staffOnly)), STAFF);
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
        assert.ok(html.includes(`<div class="cfg-lbl" id="cfgL${gi}">${label}${g.staffOnly ? ' ' + CHIP : ''}</div>`), `${id}/${g.key}: label${g.staffOnly ? ' + chip' : ' alone'}`);
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
    assert.match(printed, /^Sinks: /);
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
    assert.match(b.el('cfgBody').innerHTML, /data-cfg-v="1\.5" data-cfg-key="g5o0" aria-pressed="true"/);
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
  const fryer = { id: 'CE-016', category: 'cooking_line', name: 'Fryer', qty: 1, unit: 'pc', unitPrice: 21911, amount: 21911, _uid: 'f' };
  const sink = (b, over = {}) => ({ ...makeLine(b, sinkState({ qty: 1 })).line, _uid: 's', ...over });

  it('a configured line has no PT chip; a plain line beside it keeps its chip and its handler', () => {
    const b = builder();
    const html = paint(b, [sink(b), fryer]);
    assert.ok(html.includes('togglePassThrough(1)'), 'the plain Fryer row keeps its ⇄ PT chip');
    assert.equal(html.includes('togglePassThrough(0)'), false, 'the configured Sink row has none');
    assert.ok(rowOf(html, 'Fryer').includes('⇄ PT'));
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

  it('a partner session never had the chip, and a plain flagged line shows it as before', () => {
    const b = builder();
    const html = paint(b, [{ ...fryer, passThrough: true }, sink(b)]);
    assert.ok(html.includes('togglePassThrough(0)') && rowOf(html, 'Fryer').includes('⇄ pass-through'));
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
      { n: 3, id: 'CE-016', cat: 'cooking_line', name: 'Fryer', qty: 1, unit: 'pc', specs: [] }]);
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
