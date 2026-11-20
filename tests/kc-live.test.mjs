// tests/kc-live.test.mjs: the bridge between the configurators and the live quote builder (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md sections 2.2, 3.2 to 3.5, 4.3, 6, packet C).
//
// WHAT RUNS.  The real bridge files (qb/kc-live.js, qb/d7/*.js, qb/kc/host-d7.js) are loaded, with the real engine (the bundle qb/kc.min.js) and the real rules (qb/kc-rules.js), into ONE node:vm context, in the
// order of the page loader (spec 4.2).  The quote builder page itself is not loaded: its globals (items, computeTotals, renderItems ...) are small stand-ins written below, and Firestore is a small fake
// (makeFakeDb).  Nothing here draws a pixel and no network is touched.
//
// NO PRICE IN THIS FILE (the repository is public; tests/kc-no-prices.test.mjs scans it): every price is SYNTHETIC, from packet B's fixture (tests/fixtures/kc-prices.fixture.json: made-up numbers) or made up below.
//
// MUTATION LOG (the repo rule for money code: break the rule in a scratch copy, the tests must fail).  Set KC_QB_DIR to a scratch copy of qb/ (it needs kc.min.js and kc-rules.js too) and run this file.
// Every mutant below was run on 2026-11-19 and is KILLED by the test named, except where it says EQUIVALENT:
//   19. d7-adapter.js   adapter.price without its read-only guard                       -> "adapter.price changes nothing while the prices have not loaded"
//   20. d7-adapter.js   publicItem leaves cfg.custom[i].m                               -> "publicItem takes the typed costs out of a custom part and a custom item"
//   21. kc-live.js      sidecarExtras without costKnown                                  -> "sidecarExtras has exactly the keys of the cost sidecar"
//   22. d7-adapter.js   the price hold never decides (shouldHold skipped)                -> the five "price hold" tests
//   23. kc-live.js      the approval carry takes net 0                                    -> "the approval carry is built from an approved source quote"
//   24. d7-pricing.js   the auto-pricer reprices catalogue lines                         -> "the auto-pricer skips a catalogue line, for every role ..."
//   25. kc-live.js      Operations maps to Sales                                          -> "President, Sales, Operations, Purchasing and Finance"
//   26. kc-live.js      switch 'president' gives every role the configurators             -> "the office switch decides who gets the configurators on a blank quote"
//   27. kc-live.js      the graft does not check the line's name                          -> "a sidecar row whose name is not the line's is refused"
//   28. d7-doc.js       downloadPdf calls FormsPdf without the guard                      -> "without the form engine the print dialog opens instead ..."
//   29. d7-doc.js       no print dialog after a failure                                   -> the same test and "an engine that reports a failure, one that throws ..."
//   30. d7-doc.js       the filed gate skipped                                            -> "the gates of the page's doPrint() ..."
//   31. d7-doc.js       the off-screen container is never taken out                       -> "a filed KC quote: FormsPdf.download gets the A4 container ..."
//   32/33. d7-doc.js    paginate ignores keepPrev / keep (signatures and headings drift)  -> "a heading goes with the unit after it; a signature row ..."
//   34. d7-doc.js       paginate ignores the table's heading row                          -> "a table that runs over pages pays for its heading row ..." and the property test
//   35. d7-doc.js       the Standard page does not start a page of its own                -> "the Standard page and the photo annex start a page of their own"
//   36-37. (Addendum 2 B1 removed the blower reason and the President-only lock: mutants 36 and 37 are replaced by 50 and 51 below)
//   38. d7-flow.js      the reason sentences are not said once after the list              -> "flow.approvalReason names the ducting sentence once ..."
//   39. d7-pricing.js   the formula-low note for every role                               -> "floor mode "formula": the President sees it ..."
//   40. d7-pricing.js   the formula-low note without the floor-mode test                  -> EQUIVALENT: KCRules.formulaBelowList applies the same gate (the bridge's test is a second lock)
//   41. d7-doc.js       the file name carries " Rev. 1" again                             -> "the file is named by the quote number and nothing else"
//   42. d7-doc.js       the Barro Kitchens tile on every company                          -> "the Barro Kitchens tile (about 40 px high) sits above QUOTATION ..."
//   43. d7-doc.js       Prepared by replaces today's boxes                                -> "Prepared by: one box added to today's signature row ..."
//   44. kc-live.js      list rows read as bare numbers only (object rows dropped)         -> five tests: the import, the merge, the 86 object rows, load, saveListPrices
//   45/46. kc-live.js   saveListPrices drops / overwrites object rows                     -> "saveListPrices keeps what the row holds ..."
//   47. kc-live.js      a material document without v 1                                   -> "a changed price appends one history entry ..." and "a rating change is its own history entry ..."
//   48. d7-doc.css      the Q66 phone cards reach the A4 pages                            -> "Q66: every rule that stacks the preview into cards ... leaves the A4 pages alone"
//   49. d7-adapter.js   the price status leaves the cost sidecar                          -> "a line row of the sidecar ..." and "it is in the cost sidecar and in the chip of the line ..."
// ADDENDUM 2 ROUND (owner answers B1 to B9, QA D4 / D7 / D14): the same procedure in a scratch copy (a mutant of a private source is re-bundled with the pinned esbuild first); 55 mutants in all (the page ones are in tests/kc-builder-port.test.mjs), every one KILLED:
//   50. d7-adapter.js   the bridge adds the old blower reason to a ventilation line again    -> "a ventilation line (...) needs review for the ducting only ...", "flow.approvalReason names the ducting sentence once ...", "the chip says why ..."
//   51. d7-adapter.js   only the President may clear a ventilation line again                -> "Operations clears a ventilation line like any other reason ..."
//   52. engine source   the engine check puts the old blower reason back (and: the ducting reason dropped from engine and bridge)  -> tests/kc-list.test.mjs "every ventilation line is reviewed for its ducting ..." and these
//   53. engine source   B9: the Recommended tag back on "None" / on Flat, the default start without its pre-selection, no 15 GPM trap, the 15 GPM pill untagged  -> the five "Addendum 2 B9" tests (and the golden for the trap)
//   54. seed builder, admin-d7.js   B6: the seed builder refuses Approved; the Standard price list screen does not know it or gives it no colour; the status printed in a block  -> the four "Addendum 2 B6" tests
//   55. d7-doc.js, d7-adapter.js, d7-doc.css   B2: no code row; the row after the material row; no code in the snapshot; a non-list catalogue SKU printing; an old snapshot printing no code; a code that is not cleaned or
//                       not escaped; no print rule; a large black code on the A4 pages; the custom item with a code  -> the seven "Addendum 2 B2" tests
//   56. host-d7.js      D4: the card shows the cheapest start / the dearest standard model; the start cache ignores the list; D14: the id chip back  -> the "D4 / D14" tests
//   57. d7-doc.js       D7: the client's box stays first / is not put back when the quote stops being a KC one  -> "Prepared by: one box added ..." and "the order is also set when the page asks for the header ..."
//   58. kc-live.js      D7: the approver's name is never looked up / falls back to the signed-in user / overwrites a stored name / overwrites a carry set meanwhile / holds the carry back until the lookup answers  -> the six "D7" afterLoad tests
// FABLE REVIEW ROUND (2026-11-20, findings F5 F7 F8 F10 F12 F13 F15; specs/BK-LIVE-FABLE-REVIEW-2026-11-20.md): 75 mutants in a scratch copy (the page ones are in tests/kc-builder-port.test.mjs), every one KILLED:
//   59. d7-pricing.js   F5: a formula catalogue line has no calculator-price standard / that price replaces a fixed product's base price                         -> the four "F5" tests (+ "a typed catalogue price ..." / "standard total ...")
//   60. d7-adapter.js   F7: a loaded line is never "not known" / sidecarRow ignores the mark / graft does not end the doubt / typed numbers (or typed custom parts) on the line do not count
//                                                                                                                                                       -> the five "Fable review F7" adapter tests
//   61. js/app.js       F7: keepTypedCosts never applied / replaces a row the builder knows / does not check the name or the kind / a revision does not look at its parent / a failing read blocks the write /
//                       the stored sidecar is read on every save / the kept rows are not written / no cap on the read  -> the "keepTypedCosts" and the six bridge tests (the real listener, lifted out of js/app.js)
//   62. d7-flow.js      F8: the buttons for everyone on a KC quote again / Purchasing loses them / no link, a link for the President, a link on a legacy quote, a link at the end of the row, a link to the wrong screen /
//                       no way back for a person without the buttons (bar, phone menu) / the phone back row for the President too; d7-flow.css: no 44 px target  -> the "Fable review F8" tests
//   63. kc-live.js      F10: failedForUser ignores the switch / says nothing for denied or for offline / says it when the prices loaded / a timeout forgets the switch or the person; allowsNew without the prices test
//                                                                                                                                                       -> the four "Fable review F10" tests, "KCLive.allowsNew"
//   64. d7-adapter.js   F12: the chip says "cannot be filed until then" again                                                                         -> "Fable review F12"
//
// Run with: node --test tests/kc-live.test.mjs        (or  KC_QB_DIR=/path/to/scratch/qb node --test tests/kc-live.test.mjs)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadEngine, loadFixture, applyFixture } from './helpers/kc-vm.mjs';        // packet B's loader of the engine (the bundle qb/kc.min.js) and its SYNTHETIC price fixture

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QB = process.env.KC_QB_DIR || path.join(ROOT, 'qb');
// the bridge files, in the order of the page loader (spec 4.2), after qb/kc-rules.js and the engine files that kc-vm.mjs loads
const BRIDGE = ['d7/d7-core.js', 'kc/host-d7.js', 'd7/d7-pricing.js', 'd7/d7-doc.js', 'd7/d7-adapter.js', 'd7/d7-flow.js', 'kc-live.js'];
const FX = loadFixture();                                           // made-up prices, obviously not real (tests/fixtures/kc-prices.fixture.json)
const LIST4 = FX.listPrices['CK-HP-4'];                             // the fixture's list price of the 4-burner high pressure stove
const plain = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));        // vm objects have the vm's prototypes: compare plain copies

// ═════════════════════════════ the page stand-in: the globals the bridge reads by bare name ═════════════════════════════
const PAGE = `
var items = [], miscCosts = [], quotePhotos = [];
var DB = { products: [], categories: [], constants: {} };
var COSTING_SETTINGS = {}, COSTING_DEFAULTS = { miscOhPct: 0.25 };
var currentCo = 'BK', quoteEngine = 'kc1', reopenSourceDocId = null, reopenSourceCollection = null;
var _inComputeTotals = false, _loadIsTemplate = false, _loadIsReopen = false;
var __renders = 0, __saves = 0, __toasts = [], __disc = 0, __di = 0;
function d7On(){ return !!(window.D7 && D7.live) && quoteEngine === 'kc1' && currentCo !== 'BS'; }
function renderItems(){ __renders++; D7.h('adapter.sync'); }
function saveToStorage(){ __saves++; }
function showToast(t, k){ __toasts.push([t, k]); }
function flashItemSaved(){}
function withPhotoIndexRemap(fn){ fn(); }
function lineNoOf(idx){ var n = 0; for (var i = 0; i <= idx; i++) if (items[i] && items[i].id !== 'MISCFEE') n++; return n; }
function formatPeso(n){ return 'P' + Number(n).toFixed(2); }
function txtEsc(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function attrEsc(s){ return txtEsc(s).replace(/'/g, '&#39;'); }
function leadWorkingDays(m){ return KCRules.leadWorkingDays(m); }
function lineNeedsPrice(item){ return !!(item && item.needsPrice && !(Number(item.unitPrice) > 0)); }
function priceBasisChipHtml(){ return ''; }
function itemCostBasis(){ return {}; }
function ptUnitCostOf(item){ return Number(item.unitPrice) || 0; }
function computeMarginSummary(){}
function ensureItemUids(){ items.forEach(function(it, i){ if (it && !it._uid) it._uid = 'u' + i; }); }
function computeTrueCost(){ return D7.pricing.trueCost(); }
function optionsOn(){ return false; }
function applyLetterheadHeader(){ var b = document.getElementById('lhPrintHeader'); if (b) b.innerHTML = '<div class="lh-header">old letterhead</div>'; }
function updatePrintHeader(){ __uph = (typeof __uph === 'undefined' ? 0 : __uph) + 1; }
var __uph = 0;
function computeTotals(subset){
  var prevIn = _inComputeTotals; _inComputeTotals = true;
  var list = subset || items;
  var fee = list.filter(function(i){ return i.id === 'MISCFEE'; }), goods = list.filter(function(i){ return i.id !== 'MISCFEE'; });
  var subtotal = goods.reduce(function(s, i){ return s + i.amount; }, 0);
  var ptQuoted = goods.reduce(function(s, i){ return s + (i.passThrough ? (+i.amount || 0) : 0); }, 0);
  var miscFeeTotal = fee.reduce(function(s, i){ return s + (+i.amount || 0); }, 0);
  var diAdded = __di, volumeBreakTotal = 0;
  var preDiscount = subtotal + miscFeeTotal - volumeBreakTotal + diAdded;
  var discBase = Math.max(0, subtotal - volumeBreakTotal - ptQuoted);
  var discountAmt = discBase * (__disc / 100), discountCapped = false;
  if (!subset && discountAmt > 0) {
    var tc = computeTrueCost(), maxDisc = Math.max(0, preDiscount - (tc ? tc.trueCostTotal : 0));
    if (discountAmt > maxDisc + 0.005) { discountAmt = maxDisc; discountCapped = true; }
  }
  var net = preDiscount - discountAmt;
  _inComputeTotals = prevIn;
  return { subtotal: subtotal, ptQuoted: ptQuoted, miscFeeTotal: miscFeeTotal, volumeBreakTotal: volumeBreakTotal, diAdded: diAdded, discountAmt: discountAmt, preDiscount: preDiscount,
    discountCapped: discountCapped, net: net, focFees: 0, rushFee: 0, rushCharged: 0, vatAmt: 0, grand: net };
}
`;

// ═════════════════════════════ a small fake of the Firestore compat SDK (what the bridge uses) ═════════════════════════════
const isMap = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function deepMerge(a, b) {                                   // set(data, { merge: true }) merges maps field by field, as Firestore does; arrays and values are replaced
  const o = Object.assign({}, a);
  for (const k of Object.keys(b)) o[k] = isMap(b[k]) && isMap(o[k]) ? deepMerge(o[k], b[k]) : b[k];
  return o;
}
function makeFakeDb(seed = {}, opt = {}) {
  const store = new Map(Object.entries(seed));
  const writes = [];
  const gate = coll => {
    if ((opt.deny || []).includes(coll)) return Promise.reject(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    if ((opt.fail || []).includes(coll)) return Promise.reject(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    if ((opt.hang || []).includes(coll)) return new Promise(() => {});
    return null;
  };
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))) });
  const ref = (coll, id) => ({ path: coll + '/' + id, coll, id,
    get() { return gate(coll) || Promise.resolve(snap(id, store.get(coll + '/' + id))); },
    set(data, o) { const k = coll + '/' + id; writes.push({ op: 'set', path: k, data: plain(data), merge: !!(o && o.merge) }); store.set(k, plain((o && o.merge && store.has(k)) ? deepMerge(store.get(k), data) : data)); return Promise.resolve(); } });
  return {
    store, writes, batches: [],
    collection(coll) {
      return { doc: id => ref(coll, id), get() {
        const g = gate(coll); if (g) return g;
        const docs = []; for (const [k, v] of store) { if (k.startsWith(coll + '/') && !k.slice(coll.length + 1).includes('/')) docs.push(snap(k.slice(coll.length + 1), v)); }
        return Promise.resolve({ docs, empty: docs.length === 0, size: docs.length, forEach: fn => docs.forEach(fn) }); } };
    },
    batch() { const ops = [], me = this; return { set(r, data, o) { ops.push([r, data, o]); }, commit() { me.batches.push(ops.length); ops.forEach(([r, d, o]) => r.set(d, o)); return Promise.resolve(); } }; },
    runTransaction(fn) {
      const staged = [];
      const tx = { get: r => r.get(), set(r, data, o) { staged.push([r, data, o]); return tx; } };
      return Promise.resolve(fn(tx)).then(res => { staged.forEach(([r, d, o]) => r.set(d, o)); return res; });
    }
  };
}

// ═════════════════════════════ the environment: the real files, in the loader's order ═════════════════════════════
// opts.without = file names (relative to qb/) to leave out; opts.db / opts.user / opts.protocol / opts.print
function makeEnv(opts = {}) {
  const without = opts.without || [];
  const eng = loadEngine({ bundle: path.join(QB, 'kc.min.js'), rulesFile: path.join(QB, 'kc-rules.js'), rules: !without.includes('kc-rules.js') });
  const sandbox = eng.ctx, logs = eng.logs, timers = [], els = new Map();
  const classList = () => { const s = new Set(); return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; on ? s.add(c) : s.delete(c); return on; }, contains: c => s.has(c) }; };
  const inert = () => ({ style: {}, dataset: {}, children: [], classList: classList(), setAttribute() {}, getAttribute() { return null; }, appendChild() {}, addEventListener() {}, remove() {}, textContent: '', innerHTML: '', value: '' });
  const body = Object.assign(inert(), { dataset: {} });
  Object.assign(sandbox, {
    document: { readyState: 'complete', createElement: inert, head: { appendChild() {} }, body, addEventListener() {}, getElementById: id => els.get(id) || null, querySelector: () => null, querySelectorAll: () => [] },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    location: { protocol: opts.protocol || 'http:', origin: 'https://ops.example.test', host: 'ops.example.test', href: 'https://ops.example.test/q.html' },
    localStorage: { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
    DOMParser: class { parseFromString(s) { return { body: { textContent: String(s).replace(/<[^>]*>/g, '') } }; } },
    addEventListener() {}, removeEventListener() {}
  });
  if (opts.print) sandbox.print = opts.print;
  if (opts.db) sandbox.db = opts.db;
  if (opts.user !== null) sandbox.auth = { currentUser: opts.user || { uid: 'u-pres', displayName: 'Neil Barro' } };
  vm.runInContext(PAGE, sandbox, { filename: 'page-stand-in.js' });
  for (const f of BRIDGE) if (!without.includes(f)) vm.runInContext(fs.readFileSync(path.join(QB, f), 'utf8'), sandbox, { filename: f });
  const run = code => vm.runInContext(code, sandbox);
  return { ctx: sandbox, win: sandbox, run, logs, timers, els, body, KC: sandbox.KC, D7: sandbox.D7, KCLive: sandbox.KCLive, KCRules: sandbox.KCRules };
}
// synthetic prices from packet B's fixture: every material, the whole Standard Price List, the corner charge
function setPrices(env) { applyFixture(env.KC, FX); return env; }
const live = env => { env.KCLive.state = 'live'; env.KCLive.ready = true; env.D7.ready = true; return env; };
const profile = (role, depts, extra = {}) => ({ role, departments: depts, ...extra });
// a priced environment with the switch on, the person signed in with a given role
function readyEnv(role = 'president') {
  const env = setPrices(makeEnv({ db: makeFakeDb({}) }));
  live(env); env.KC.S.role = role; env.KCLive.role = role;
  return env;
}
const addSink = (env, qty) => env.KC.addLine('sink', env.KC.products.sink.startCfg('hand'), { qty, render: false });
const addStation = (env, qty) => env.KC.addLine('station', env.KC.products.station.startCfg('stall'), { qty, render: false });         // a product the Standard Price List does not cover: it sells at cost x the markup
const addChef = (env, o = {}) => { const D = env.KC.products.chef_hp, st = D.starts.find(s => D.startCfg(s.id).n === 4); return env.KC.addLine('chef_hp', D.startCfg(st.id), Object.assign({ render: false }, o)); };
const itemsOf = env => env.run('items');
const snapshotPrices = env => plain(env.run('items.map(i => ({ id: i.kcId || i.id, unitPrice: i.unitPrice, amount: i.amount, needsPrice: i.needsPrice, reviewed: i.reviewed, priceBasis: i.priceBasis }))'));

describe('qb: every file parses and the feature goes live only when everything is there', () => {
  it('the whole set loads with no console error and D7.live is truthy last', () => {
    const env = makeEnv();
    assert.equal(!!env.D7.live, true, 'D7.live');
    assert.deepEqual(env.logs.filter(l => l[0] === 'error'), [], 'no console error while loading');
    assert.equal(env.D7.live, env.KCLive, 'D7.live IS the KCLive object, so D7.h("live.carry") reaches it');
  });
  it('a missing file leaves the feature off: D7.live stays falsy, and every D7.h hook answers ""', () => {
    for (const drop of ['kc-rules.js', 'd7/d7-adapter.js', 'd7/d7-pricing.js', 'd7/d7-doc.js']) {
      const env = makeEnv({ without: [drop] });
      assert.equal(!!env.D7.live, false, 'without ' + drop);
      assert.equal(env.D7.h('live.carry'), '', 'the hook is not reachable while the feature is off');
    }
  });
  it('the engine starts as nobody: KC.S.role is sales until KCLive.load has read the profile', () => {
    const env = makeEnv();
    assert.equal(env.KC.S.role, 'sales');
    assert.equal(env.D7.role(), 'sales');
  });
});

// ═════════════════════════════ KCLive.load: the five reads (spec 4.3) ═════════════════════════════
const seedDocs = (over = {}) => ({
  'users/u-pres': { role: 'president', name: 'Neil Barro' },
  'settings/quote_builder': { kcMode: 'on' },
  'kc_config/settings': { v: 1, br: { simple: 31, medium: 51, complex: 71 }, misc: 11, markup: 2.5, corner: 1234, hood: { overhang: 17 }, floorMode: 'formula' },
  'kc_config/list_prices': { v: 1, effective: '2026-11-19', rows: { 'CK-HP-4': 25000, 'CK-LP-2': 0, 'CK-X': 'bad' } },
  'kc_materials/sh12': { key: 'sh12', p: 321.5, source: 'Set by Neil', hist: [{ d: '2026-11-19', p: 321.5, by: 'Neil Barro' }] },
  'kc_materials/sir2': { key: 'sir2', p: 4000, hp: 3, cfm: 4400, sp: 1.2 },
  'kc_materials/zz_new': { key: 'zz_new', p: 77, l: 'Test material', u: 'pc', cat: 'Hardware', grade: 'SS304', size: 'small' },
  ...over
});
const loaded = async (seed, opt = {}, envOpt = {}) => { const env = makeEnv({ db: makeFakeDb(seed, opt), ...envOpt }); await env.KCLive.load(); return env; };

describe('KCLive.load: the five reads', () => {
  it('waits for the restored sign-in (first live day, v15.0.1): at boot auth.currentUser is still null; the profile is read once onAuthStateChanged answers, so the President is the President', async () => {
    const env = makeEnv({ db: makeFakeDb(seedDocs()), user: null });
    let cb = null, unsub = 0;
    env.win.auth = { currentUser: null, onAuthStateChanged(f) { cb = f; return () => { unsub++; }; } };
    const p = env.KCLive.load();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(typeof cb, 'function', 'it asks auth instead of reading with nobody');
    assert.equal(env.KCLive.state, 'loading');
    const u = { uid: 'u-pres', displayName: 'Neil Barro' }; env.win.auth.currentUser = u; cb(u);
    await p;
    assert.equal(env.KCLive.role, 'president'); assert.equal(env.KC.S.role, 'president'); assert.equal(env.KCLive.state, 'live');
    assert.equal(unsub, 1, 'the listener is removed after the first answer');
  });
  it('inside the ops app a direct get() of users/<uid> can hang (v15.0.2 iframe; Fable F1a): the document-id query runs at the same time, so the profile answers at once with no wait, and the President is the President', async () => {
    const env = makeEnv({ db: makeFakeDb(seedDocs()) });
    const real = env.win.db, base = real.collection.bind(real); let asked = 0;
    env.win.firebase = { firestore: { FieldPath: { documentId: () => '__name__' } } };
    env.win.db = Object.assign(Object.create(real), { collection(c) {
      if (c !== 'users') return base(c);
      return { doc: () => ({ get: () => new Promise(() => {}) }),
        where: (f, op, id) => { asked++; return { limit: () => ({ get: async () => ({ docs: [{ id, data: () => ({ role: 'president', name: 'Neil Barro' }) }] }) }) }; } };
    } });
    await env.KCLive.load();                                   // no timer is fired: it must finish on its own
    assert.equal(asked, 1, 'the document-id query was used'); assert.equal(env.KCLive.role, 'president'); assert.equal(env.KCLive.state, 'live');
  });
  it('a profile that answers neither way never throws the prices away (Fable F1b): after the 3 s cap the role is Sales and the price state is still live', async () => {
    const env = makeEnv({ db: makeFakeDb(seedDocs()) });
    const real = env.win.db, base = real.collection.bind(real);
    env.win.db = Object.assign(Object.create(real), { collection(c) {
      if (c !== 'users') return base(c);
      return { doc: () => ({ get: (o) => (o && o.source === 'cache') ? Promise.reject(Object.assign(new Error('no cache'), { code: 'unavailable' })) : new Promise(() => {}) }) };
    } });
    const p = env.KCLive.load(); for (let i = 0; i < 8; i++) await Promise.resolve();
    const t = env.timers.find(x => x && x.fn && x.ms === 3000); assert.ok(t, 'a 3 s cap on the profile read'); t.fn();
    await p;
    assert.equal(env.KCLive.role, 'sales'); assert.equal(env.KCLive.state, 'live', 'the prices still count');
  });
  it('nobody signed in: auth answers null and the role stays Sales; an auth that never answers goes on after the wait with Sales too', async () => {
    const a = makeEnv({ db: makeFakeDb(seedDocs()), user: null });
    a.win.auth = { currentUser: null, onAuthStateChanged(f) { Promise.resolve().then(() => f(null)); return () => {}; } };
    await a.KCLive.load(); assert.equal(a.KCLive.role, 'sales');
    const b = makeEnv({ db: makeFakeDb(seedDocs()), user: null });
    b.win.auth = { currentUser: null, onAuthStateChanged() { return () => {}; } };
    const p = b.KCLive.load(); await Promise.resolve(); await Promise.resolve();
    const t = b.timers.find(x => x && x.fn && x.ms === 5000); assert.ok(t, 'a 5 s wait is set'); t.fn();
    await p; assert.equal(b.KCLive.role, 'sales');
  });
  it('reads the role, the switch, the settings, the list prices and the materials, and goes live', async () => {
    const env = await loaded(seedDocs());
    const { KC, KCLive } = env;
    assert.equal(KCLive.state, 'live'); assert.equal(KCLive.ready, true);
    assert.equal(KCLive.role, 'president'); assert.equal(KC.S.role, 'president'); assert.equal(env.body.dataset.role, 'president');
    assert.equal(KCLive.userName, 'Neil Barro');
    assert.deepEqual(plain(KCLive.flags), { kcMode: 'on', approveAll: false, approvalBelowStandard: 'force', catalogueCostPricing: false });
    assert.deepEqual(plain(KC.SET.br), { simple: 31, medium: 51, complex: 71 }); assert.equal(KC.SET.misc, 11); assert.equal(KC.SET.markup, 2.5); assert.equal(KC.SET.corner, 1234);
    assert.equal(KC.SET.hood.overhang, 17); assert.ok(KC.SET.hood.depth > 0, 'a key the doc does not carry keeps its default');
    assert.equal(KC.FLOOR_MODE, 'formula');
    assert.deepEqual(plain(KC.LISTP), { 'CK-HP-4': 25000 }, 'only a number above 0 is a list price');
    assert.equal(KC.P.sh12.p, 321.5); assert.equal(KC.P.sh12.source, 'Set by Neil'); assert.equal(KC.P.sh12.hist.length, 1);
    assert.equal(KC.P.sh10.p, null, 'a key in the file with no doc keeps p null');
    assert.deepEqual([KC.P.sir2.hp, KC.P.sir2.cfm, KC.P.sir2.sp], [3, 4400, 1.2], 'a blower rating edited on the screen is applied');
    assert.equal(KC.P.zz_new.p, 77); assert.equal(KC.P.zz_new.l, 'Test material'); assert.deepEqual(plain(KC.PL_INFO.zz_new), ['Hardware', 'SS304', 'small'], 'a doc whose key is not in the file makes a new row');
  });
  it('a setting that is not a usable number keeps its default; a missing settings document is the defaults', async () => {
    const bad = await loaded(seedDocs({ 'kc_config/settings': { v: 1, br: { simple: 'x', medium: -4 }, misc: null, markup: 0.5, corner: 'a lot', duct: { fpm: NaN } } }));
    assert.deepEqual(plain(bad.KC.SET.br), { simple: 30, medium: 50, complex: 70 }); assert.equal(bad.KC.SET.misc, 10); assert.equal(bad.KC.SET.markup, 2); assert.equal(bad.KC.SET.corner, null);
    assert.equal(bad.KCLive.state, 'live');
    const none = seedDocs(); delete none['kc_config/settings'];
    const e2 = await loaded(none);
    assert.equal(e2.KCLive.state, 'live'); assert.equal(e2.KC.SET.markup, 2); assert.equal(e2.KC.SET.corner, null); assert.equal(e2.KC.FLOOR_MODE, 'list');
  });
  it('a reload starts from "no price": a document that has gone is a price that has gone, and a row added by an earlier load is put away', async () => {
    const env = await loaded(seedDocs());
    assert.equal(env.KC.P.sh12.p, 321.5); assert.ok(env.KC.P.zz_new);
    env.win.db.store.delete('kc_materials/sh12'); env.win.db.store.delete('kc_materials/zz_new');
    await env.KCLive.load();
    assert.equal(env.KC.P.sh12.p, null); assert.equal(env.KC.P.zz_new, undefined); assert.equal(env.KC.PL_INFO.zz_new, undefined);
  });
  it('a refused materials read is "denied", any other failure is "offline", and neither is ready', async () => {
    const denied = await loaded(seedDocs(), { deny: ['kc_materials'] });
    assert.equal(denied.KCLive.state, 'denied'); assert.equal(denied.KCLive.ready, false);
    const down = await loaded(seedDocs(), { fail: ['kc_materials'] });
    assert.equal(down.KCLive.state, 'offline'); assert.equal(down.KCLive.ready, false);
  });
  it('no prices imported yet (the collection is empty) is not ready either', async () => {
    const seed = seedDocs(); for (const k of Object.keys(seed)) if (k.startsWith('kc_materials/')) delete seed[k];
    const env = await loaded(seed);
    assert.equal(env.KCLive.state, 'offline'); assert.equal(env.KCLive.ready, false);
  });
  it('stricter than the spec: a failed settings or list-price read (not a missing document) is not ready', async () => {
    for (const coll of ['kc_config']) {
      const env = await loaded(seedDocs(), { fail: [coll] });
      assert.equal(env.KCLive.ready, false, coll + ' failed'); assert.notEqual(env.KCLive.state, 'live');
    }
    const none = seedDocs(); delete none['kc_config/settings']; delete none['kc_config/list_prices'];
    assert.equal((await loaded(none)).KCLive.ready, true, 'missing documents are fine');
  });
  it('a profile that cannot be read is the least privileged role; a switch that cannot be read is off', async () => {
    const env = await loaded(seedDocs(), { fail: ['users', 'settings'] });
    assert.equal(env.KCLive.role, 'sales'); assert.equal(env.KC.S.role, 'sales'); assert.equal(env.KCLive.flags.kcMode, 'off'); assert.equal(env.KCLive.state, 'live');
  });
  it('a read that never answers resolves as offline after 6 seconds', async () => {
    const env = makeEnv({ db: makeFakeDb(seedDocs(), { hang: ['kc_materials'] }) });
    const p = env.KCLive.load();
    assert.equal(env.KCLive.state, 'loading'); assert.equal(env.KCLive.ready, false);
    await new Promise(r => setImmediate(r));
    const t = env.timers.find(x => x.ms === 6000 && x.fn); assert.ok(t, 'the 6-second timer');
    t.fn();
    await p;
    assert.equal(env.KCLive.state, 'offline'); assert.equal(env.KCLive.ready, false);
  });
  it('on file: or with no database it resolves at once as offline, and it never throws', async () => {
    const f = makeEnv({ db: makeFakeDb(seedDocs()), protocol: 'file:' });
    await f.KCLive.load(); assert.equal(f.KCLive.state, 'offline');
    const n = makeEnv({}); await n.KCLive.load(); assert.equal(n.KCLive.state, 'offline');
    const s = makeEnv({ db: makeFakeDb(seedDocs()), user: null }); await s.KCLive.load();
    assert.equal(s.KCLive.role, 'sales', 'not signed in');
  });
  it('two calls at the same time share one load', async () => {
    const env = makeEnv({ db: makeFakeDb(seedDocs()) });
    const a = env.KCLive.load(), b = env.KCLive.load();
    assert.equal(a, b); await a; assert.equal(env.KCLive.state, 'live');
  });
});

// ═════════════════════════════ the role (spec 3.2) ═════════════════════════════
describe('KCLive.roleOf: the five profiles of the office', () => {
  const env = makeEnv();
  const roleOf = p => env.KCLive.roleOf(p);
  it('President, Sales, Operations, Purchasing and Finance', () => {
    assert.equal(roleOf(profile('president', ['Admin'])), 'president');
    assert.equal(roleOf(profile('employee', ['Sales'])), 'sales', 'Uriel');
    assert.equal(roleOf(profile('manager', ['Production'])), 'manager', 'Rene: Operations');
    assert.equal(roleOf(profile('employee', ['Purchasing'])), 'purchasing', 'Delfin');
    assert.equal(roleOf(profile('finance', ['Finance'])), 'sales', 'Shaira: Finance sees what Sales sees');
  });
  it('the departments may be a single string (department), in any case, and the order of the rules holds', () => {
    assert.equal(roleOf({ role: 'employee', department: 'purchasing' }), 'purchasing');
    assert.equal(roleOf({ role: 'employee', department: 'Production' }), 'manager', 'a Production department makes Operations');
    assert.equal(roleOf({ role: 'manager', departments: ['Sales', 'Purchasing'] }), 'purchasing', 'Purchasing before manager');
    assert.equal(roleOf({ role: 'president', departments: ['Purchasing'] }), 'president', 'president before everything');
    assert.equal(roleOf({ role: 'employee', departments: ['Sales', 'CRM'], department: 'Sales' }), 'sales');
  });
  it('a profile that could not be read, or is junk, is sales', () => {
    for (const p of [null, undefined, 'president', 42, [], {}]) assert.equal(roleOf(p), 'sales', String(p));
  });
});

// ═════════════════════════════ the switch (spec 2.2) ═════════════════════════════
describe('KCLive.allowsNew: switch x role x device override', () => {
  const MODES = ['off', 'president', 'on'], ROLES = ['president', 'manager', 'purchasing', 'sales'];
  const make = (mode, role, force) => {
    const env = makeEnv(); env.KCLive.ready = true; env.KCLive.state = 'live'; env.KCLive.role = role;
    env.KCLive.flags = { kcMode: mode, approveAll: false, approvalBelowStandard: 'force', catalogueCostPricing: false };
    if (force != null) env.win.localStorage.setItem('bkqb_kc_force', force);
    return env;
  };
  it('the office switch decides who gets the configurators on a blank quote', () => {
    for (const mode of MODES) for (const role of ROLES) {
      const want = mode === 'on' || (mode === 'president' && role === 'president');
      assert.equal(make(mode, role).KCLive.allowsNew(), want, mode + ' / ' + role);
    }
  });
  it('the device override wins: "1" is on, "0" is off, anything else follows the office', () => {
    for (const mode of MODES) for (const role of ROLES) {
      assert.equal(make(mode, role, '1').KCLive.allowsNew(), true, 'force 1: ' + mode + ' / ' + role);
      assert.equal(make(mode, role, '0').KCLive.allowsNew(), false, 'force 0: ' + mode + ' / ' + role);
      assert.equal(make(mode, role, 'yes').KCLive.allowsNew(), mode === 'on' || (mode === 'president' && role === 'president'), 'junk follows the office');
    }
  });
  it('never before the prices are in, whatever the switch or the device say', () => {
    const env = make('on', 'president', '1'); env.KCLive.ready = false;
    assert.equal(env.KCLive.allowsNew(), false);
  });
  it('no document, a missing field or a junk value is off', async () => {
    const none = await loaded(seedDocs({ 'settings/quote_builder': undefined }));
    none.win.db.store.delete('settings/quote_builder'); await none.KCLive.load();
    assert.equal(none.KCLive.flags.kcMode, 'off'); assert.equal(none.KCLive.allowsNew(), false);
    const junk = await loaded(seedDocs({ 'settings/quote_builder': { kcMode: 'everybody', approveAll: 'yes', approvalBelowStandard: 'maybe', catalogueCostPricing: 1 } }));
    assert.deepEqual(plain(junk.KCLive.flags), { kcMode: 'off', approveAll: false, approvalBelowStandard: 'force', catalogueCostPricing: false });
    const set = await loaded(seedDocs({ 'settings/quote_builder': { kcMode: 'president', approveAll: true, approvalBelowStandard: 'tick', catalogueCostPricing: true } }));
    assert.deepEqual(plain(set.KCLive.flags), { kcMode: 'president', approveAll: true, approvalBelowStandard: 'tick', catalogueCostPricing: true });
  });
});

// ═════════════════════════════ read-only until the prices are in (spec 2.2) ═════════════════════════════
describe('read-only until the prices are in', () => {
  // a quote of a sink, a 4-burner stove (list-priced), a custom item and a hand-typed price, all priced while the prices were in
  function quote() {
    const env = readyEnv('president');
    addSink(env); addChef(env);
    env.KC.addLine('custom', { cat: 'prep', name: 'Test cart', desc: 'a cart', dims: '', rows: [{ k: 'sh12', q: 2 }], m: null, lab: 50 }, { render: false });
    const s2 = addSink(env, 2); env.run('items[items.length - 1].priceBasis = "manual"; items[items.length - 1].priceManual = true; items[items.length - 1].unitPrice = 123; items[items.length - 1].amount = 246;');
    assert.ok(s2);
    env.run('ensureItemUids()');
    return env;
  }
  // the price list moves under the quote, then the prices stop being trustworthy
  const darken = env => { for (const k of Object.keys(env.KC.P)) env.KC.P[k].p *= 3; env.KC.SET.markup = 3; env.KCLive.ready = false; env.KCLive.state = 'offline'; };

  it('adapter.price changes nothing while the prices have not loaded', () => {
    const env = quote(); const before = snapshotPrices(env);
    darken(env);
    for (const it of itemsOf(env)) env.D7.adapter.price(it, 0);
    assert.deepEqual(snapshotPrices(env), before);
    env.KCLive.ready = true; env.KCLive.state = 'live';
    for (const it of itemsOf(env)) env.D7.adapter.price(it, 0);
    assert.notDeepEqual(snapshotPrices(env), before, 'with the prices in, the same call does move the prices (so the guard is what held them)');
  });
  it('pricing.apply, autoPrice, repriceAll, reprice, resetPrices and resetLine change nothing either', () => {
    const env = quote(); const before = snapshotPrices(env);
    darken(env);
    assert.equal(env.D7.pricing.apply(env.D7.pricing.trueCost()), false);
    assert.equal(env.D7.pricing.autoPrice(), false);
    assert.equal(env.D7.pricing.repriceAll(), false);
    assert.equal(env.D7.pricing.reprice(itemsOf(env)[0]), false);
    env.D7.pricing.resetPrices(); env.D7.pricing.resetLine(itemsOf(env).length - 1);
    env.D7.adapter.repriceAll(); env.D7.h('core.ready');
    assert.deepEqual(snapshotPrices(env), before);
  });
  it('"Add to Quote" is refused: commit returns null and says why, and nothing is added', () => {
    const env = quote(); darken(env);
    const n = env.run('items.length');
    const r = env.D7.adapter.commit({ kind: 'sink', cfg: env.KC.products.sink.startCfg('hand'), start: 'hand', qty: 1, unit: 'pc', note: '' });
    assert.equal(r, null); assert.equal(env.run('items.length'), n);
    assert.match(plain(env.run('__toasts'))[0][0], /not loaded/i);
  });
  it('a quote loaded before the prices stay as it was: its lines are not settled, and settle is waiting for the prices', () => {
    const env = readyEnv('president'); env.KCLive.ready = false;
    const cfg = env.KC.products.sink.startCfg('hand');
    env.run(`items.push({ id:'KC', kcKind:'sink', kcId:'K1', kcStart:'hand', cfg:${JSON.stringify(cfg)}, name:'Hand Wash Sink', qty:1, unit:'pc', unitPrice:777, amount:777, priceBasis:'configured', needsReview:false, reviewed:false })`);
    env.D7.h('adapter.hydrate', itemsOf(env)[0]);
    env.D7.h('adapter.sync');
    assert.equal(itemsOf(env)[0].unitPrice, 777); assert.equal(itemsOf(env)[0]._kc.stale, true, 'still waiting');
    env.KCLive.ready = true; env.KCLive.state = 'live';
    env.D7.h('adapter.sync');
    assert.equal(itemsOf(env)[0]._kc.stale, undefined, 'settled once the prices are in');
  });
  it('after a FAILED materials read the state is not ready and repriceAll() leaves every stored price alone', async () => {
    const env = makeEnv({ db: makeFakeDb(seedDocs({ 'kc_materials/sh12': { key: 'sh12', p: 100 } })) });
    await env.KCLive.load(); assert.equal(env.KCLive.ready, true);
    env.D7.ready = true; env.run('quoteEngine = "kc1"');
    setPrices(env); addSink(env);                                                       // the synthetic prices give the line a price
    const before = snapshotPrices(env);
    const down = makeFakeDb(seedDocs(), { fail: ['kc_materials'] });
    env.win.db = down; await env.KCLive.load();
    assert.equal(env.KCLive.ready, false); assert.equal(env.KCLive.state, 'offline');
    env.KC.SET.markup = 4;                                                            // a half-loaded settings overlay must not reprice anything
    env.D7.pricing.repriceAll(); env.D7.adapter.repriceAll();
    assert.deepEqual(snapshotPrices(env), before);
  });
  it('the cards and the panel say so: "Loading prices…" / "Prices could not be loaded…", and Add to Quote is disabled', () => {
    const env = readyEnv('president'); env.KCLive.ready = false;
    env.KCLive.state = 'loading';
    assert.equal(env.D7.live === env.KCLive, true);
    env.KCLive.state = 'offline';
    // the host draws the strings; check them in the source of the one place they live
    const host = fs.readFileSync(path.join(QB, 'kc/host-d7.js'), 'utf8');
    assert.match(host, /Loading prices…/); assert.match(host, /Prices could not be loaded\. Configured lines keep their stored price\./);
    assert.match(host, /canAdd=v\.errors\.length===0 && pricesReady\(\)/);
  });
});

// ═════════════════════════════ the price hold on a filed quote (spec 3.5 rule 2) ═════════════════════════════
describe('price hold: a line loaded from a FILED quote keeps its stored price', () => {
  // add a sink at the current prices, file it (keep its stored shape), then move the price list under it and "load" it back
  function filedThenLoaded({ filed = true, edit = null } = {}) {
    const env = readyEnv('president');
    addSink(env);
    const stored = plain(env.run('items[0]')); delete stored._kc;
    const filedPrice = stored.unitPrice;
    for (const k of Object.keys(env.KC.P)) env.KC.P[k].p += 40;                       // the price list moved
    env.run(`items.length = 0; reopenSourceDocId = ${filed ? '"q-filed"' : 'null'};`);
    const it = Object.assign({}, stored, edit || {}); env.run(`items.push(${JSON.stringify(it)})`);
    env.D7.h('adapter.hydrate', itemsOf(env)[0]);
    env.D7.h('adapter.sync');
    return { env, filedPrice, item: () => itemsOf(env)[0] };
  }
  it('reopened from a filed quote: the stored price stays, the fresh one is shown as "now"', () => {
    const { env, filedPrice, item } = filedThenLoaded();
    const it = item();
    assert.equal(it.unitPrice, filedPrice); assert.equal(it.priceHeld, true); assert.ok(it.basisUnitPrice > 0 && it.basisUnitPrice !== filedPrice, 'the fresh price is kept for the chip');
    assert.equal(it.amount, filedPrice * it.qty);
    const row = env.D7.h('adapter.lineRow', it, 0);
    assert.match(row, /price as filed/); assert.match(row, /now P/); assert.match(row, /releaseHold\(0\)/);
  });
  it('a draft or a template that never came from a filed quote follows the price list', () => {
    const { item, filedPrice } = filedThenLoaded({ filed: false });
    assert.notEqual(item().unitPrice, filedPrice); assert.equal(item().priceHeld, undefined);
  });
  it('the hold is saved with the line: a draft of a held line stays held on resume', () => {
    const { item, filedPrice } = filedThenLoaded({ filed: false, edit: { priceHeld: true } });
    assert.equal(item().unitPrice, filedPrice); assert.equal(item().priceHeld, true);
  });
  it('a price that did not change is not held (nothing to hold)', () => {
    const env = readyEnv('president'); addSink(env);
    const stored = plain(env.run('items[0]')); delete stored._kc;
    env.run(`items.length = 0; reopenSourceDocId = "q-filed"; items.push(${JSON.stringify(stored)})`);
    env.D7.h('adapter.hydrate', itemsOf(env)[0]); env.D7.h('adapter.sync');
    assert.equal(itemsOf(env)[0].priceHeld, undefined);
  });
  it('"↺ now" takes the fresh price and lets go of the hold', () => {
    const { env, filedPrice, item } = filedThenLoaded();
    const fresh = item().basisUnitPrice;
    assert.equal(env.D7.adapter.releaseHold(0), true);
    assert.equal(item().unitPrice, fresh); assert.equal(item().priceHeld, undefined); assert.notEqual(item().unitPrice, filedPrice);
  });
  it('changing the line\'s configuration clears the hold; changing only the quantity does not', () => {
    const a = filedThenLoaded();
    a.env.D7.adapter.commit({ kind: 'sink', cfg: plain(a.item().cfg), start: 'hand', qty: 3, unit: 'pc', note: 'a note' }, { editIdx: 0 });
    assert.equal(a.item().priceHeld, true, 'same configuration, other quantity: still held'); assert.equal(a.item().unitPrice, a.filedPrice); assert.equal(a.item().qty, 3);
    const b = filedThenLoaded();
    const cfg = plain(b.item().cfg); const D = b.env.KC.products.sink; const other = D.startCfg('pot');
    b.env.D7.adapter.commit({ kind: 'sink', cfg: other, start: 'pot', qty: 1, unit: 'pc', note: '' }, { editIdx: 0 });
    assert.equal(b.item().priceHeld, undefined, 'a changed configuration is priced again'); assert.notEqual(b.item().unitPrice, b.filedPrice);
    void cfg;
  });
  it('a template load lets go of every hold: it follows the price list', () => {
    const { env, item } = filedThenLoaded({ edit: { priceHeld: true } });
    env.run('_loadIsTemplate = true');
    env.D7.h('pricing.applyFields', { engine: 'kc1', warrantyPlan: 'service6' });
    env.run('_loadIsTemplate = false');
    assert.equal(item().priceHeld, undefined);
  });
  it('a typed (manual) price is never held, and a line whose fresh price is missing keeps what was filed', () => {
    const m = filedThenLoaded({ edit: { priceBasis: 'manual', priceManual: true, unitPrice: 321, amount: 321 } });
    assert.equal(m.item().unitPrice, 321); assert.equal(m.item().priceHeld, undefined);
    const env = readyEnv('president'); addSink(env);
    const stored = plain(env.run('items[0]')); delete stored._kc;
    for (const k of Object.keys(env.KC.P)) env.KC.P[k].p = null;                      // the price list lost its prices
    env.run(`items.length = 0; reopenSourceDocId = "q-filed"; items.push(${JSON.stringify(stored)})`);
    env.D7.h('adapter.hydrate', itemsOf(env)[0]); env.D7.h('adapter.sync');
    assert.equal(itemsOf(env)[0].unitPrice, stored.unitPrice, 'as filed'); assert.equal(itemsOf(env)[0]._kc.asFiled, true);
  });
});

// ═════════════════════════════ catalogue lines keep their catalogue price (spec 3.5 rule 1) ═════════════════════════════
const addCatalogue = (env, o = {}) => {
  env.run(`DB.products = [{ id: 'PW-001', category: 'prep_washing', name: 'Prep table', formulaType: 'fixed', basePrice: 1111, capitalMaterials: 400, capitalLabor: 0 },
                          { id: 'PW-013', category: 'prep_washing', name: 'Per sqm table', formulaType: 'per_sqm', basePrice: 900, capitalMaterials: 300, capitalLabor: 0 }]`);
  env.run(`items.push(${JSON.stringify(Object.assign({ id: 'PW-001', category: 'prep', name: 'Prep table', dims: '', specs: [], qty: 1, unit: 'pc', unitPrice: 1111, amount: 1111, capitalMaterials: 400, capitalLabor: 0, formulaType: 'fixed' }, o))})`);
  env.run('ensureItemUids()');
  return itemsOf(env)[itemsOf(env).length - 1];
};
describe('catalogue lines keep their catalogue price in KC mode', () => {
  it('the auto-pricer skips a catalogue line, for every role; its cost still feeds the calculator, the floor and the materials', () => {
    for (const role of ['president', 'sales', 'manager']) {
      const env = readyEnv(role); const line = addCatalogue(env);
      assert.equal(env.D7.pricing.apply(env.D7.pricing.trueCost()), false, role);
      env.D7.pricing.autoPrice(); env.D7.pricing.repriceAll();
      assert.equal(line.unitPrice, 1111, role); assert.equal(line.amount, 1111);
      const tc = env.D7.pricing.trueCost();
      assert.equal(Math.round(tc.materials), 400, 'its materials still feed the lead time'); assert.ok(tc.direct > 400, 'and its project cost the floor');
    }
  });
  it('with the office flag catalogueCostPricing on, D7\'s rule applies: R1 from capitalMaterials, bracket by section (Q42)', () => {
    const env = readyEnv('president'); env.KCLive.flags = Object.assign({}, env.KCLive.flags, { catalogueCostPricing: true });
    const line = addCatalogue(env);
    assert.equal(env.D7.pricing.apply(env.D7.pricing.trueCost()), true);
    const R = env.KCRules, S = env.KC.SET;
    const want = R.sellUnit({ projectCost: R.r1(400, S.br.medium, S.misc).projectCost, markup: S.markup });
    assert.equal(line.unitPrice, want, 'Prep is Medium');
    const cook = addCatalogue(env, { id: 'GL-X', category: 'cook', unitPrice: 5, amount: 5 });
    env.D7.pricing.apply(env.D7.pricing.trueCost());
    assert.equal(cook.unitPrice, R.sellUnit({ projectCost: R.r1(400, S.br.complex, S.misc).projectCost, markup: S.markup }), 'Cooking is Complex');
  });
  it('a pass-through catalogue line still sells at the supplier cost (the person\'s own choice)', () => {
    const env = readyEnv('president'); const line = addCatalogue(env, { passThrough: true, unitPrice: 5, amount: 5 });
    env.run('ptUnitCostOf = function(){ return 700; }');
    env.D7.pricing.apply(env.D7.pricing.trueCost());
    assert.equal(line.unitPrice, 700);
  });
});

// ═════════════════════════════ the standard total, the below-markup warning (Q64), the cost summary ═════════════════════════════
describe('standard total, costKnown and the below-markup warning', () => {
  it('the standard unit of each kind of line, through KCRules.standardUnit', () => {
    const env = readyEnv('president'); const P = env.D7.pricing;
    addStation(env); addChef(env); addCatalogue(env); addSink(env);
    const [stn, chef, cat, sink] = itemsOf(env);
    const std = it => P.standardOf(it, P.lineCost(it));
    const R = env.KCRules, mk = env.KC.SET.markup;
    assert.deepEqual(plain(std(stn)), { unit: R.round10(stn._kc.projectCost * mk), known: true, kind: 'kc' }, 'a product with no list code: cost x the markup');
    assert.deepEqual(plain(std(chef)), { unit: LIST4, known: true, kind: 'list' }, 'a list-priced line: its list-based price');
    assert.deepEqual(plain(std(sink)), { unit: R.sellUnit({ projectCost: sink._kc.projectCost, markup: mk, listAdj: sink._kc.list.adj }), known: true, kind: 'list' }, 'A1: every configurator is list-priced where its product has a list code');
    assert.deepEqual(plain(std(cat)), { unit: 1111, known: true, kind: 'catalogue' });
    env.KC.FLOOR_MODE = 'formula';
    assert.equal(std(chef).unit, R.round10(chef._kc.projectCost * mk), 'floor mode formula: cost x the standard markup');
  });
  it('the standard total: standard prices of the lines + pass-throughs + the additional costs as quoted; below it is "below standard"', () => {
    const env = readyEnv('president'); addSink(env, 2);
    const base = env.D7.pricing.standardInfo();
    assert.equal(base.net, base.standardTotal, 'priced by the formula: net = standard total'); assert.equal(base.costKnown, true); assert.equal(base.markup, 2); assert.equal(base.floorMode, 'list');
    env.run('__disc = 10');
    const d = env.D7.pricing.standardInfo();
    assert.ok(d.net < d.standardTotal); assert.equal(Math.round(d.standardTotal), Math.round(base.standardTotal));
    assert.ok(d.projectCost > 0 && d.floorTotal >= d.projectCost);
    assert.equal(d.costTimesMarkup, d.floorTotal + d.projectCost * (d.markup - 1), 'floorTotal with the project cost at the standard markup');
  });
  it('a line with no basis at all (a custom item priced by hand before it is costed) is neutral, and the cost is not known', () => {
    const env = readyEnv('president');
    env.KC.addLine('custom', { cat: 'prep', name: 'Mystery', desc: '', dims: '', rows: [], m: null, lab: null }, { render: false });
    env.run('items[0].priceBasis = "manual"; items[0].priceManual = true; items[0].unitPrice = 4321; items[0].amount = 4321');
    const i = env.D7.pricing.standardInfo();
    assert.equal(i.costKnown, false); assert.equal(i.standardTotal, 4321); assert.equal(i.net, 4321);
  });
  it('a typed catalogue price: the base price of a fixed product is the standard; a formula product made before the calculator\'s price was kept on the line has none to read back, so the cost is not known', () => {
    const env = readyEnv('president'); const fixed = addCatalogue(env, { priceBasis: 'manual', priceManual: true, unitPrice: 900, amount: 900 });
    let i = env.D7.pricing.standardInfo();
    assert.equal(i.standardTotal, 1111); assert.equal(i.net, 900); assert.equal(i.costKnown, true);
    const env2 = readyEnv('president');
    addCatalogue(env2, { id: 'PW-013', priceBasis: 'manual', priceManual: true, unitPrice: 900, amount: 900 });
    i = env2.D7.pricing.standardInfo(); assert.equal(i.costKnown, false);
    void fixed;
  });
  // Fable review F5 (2026-11-20): a size-priced catalogue line used to escape the approval rule once its price was typed (the standard could not be read back); the page now keeps the calculator's price on the line
  // when it is added (basisUnitPrice, KC mode) and that is the standard a typed price is held against.
  const formulaLine = (over = {}) => ({ id: 'PW-013', formulaType: 'per_sqm', unitPrice: 1234, amount: 1234, basisUnitPrice: 1234, ...over });     // as the calculator adds it: no priceBasis, no priceManual
  const typeOver = (env, price) => env.run(`items[0].unitPrice = ${price}; items[0].amount = ${price}; items[0].priceManual = true;`);                // what updatePrice() does to a catalogue line
  it('F5: a typed price on a size-priced catalogue line is held against the price the calculator gave: the standard is that price, the cost is known, and Sales must send it for approval', () => {
    const env = readyEnv('sales'); addCatalogue(env, formulaLine()); typeOver(env, 900);
    const i = env.D7.pricing.standardInfo();
    assert.equal(i.standardTotal, 1234); assert.equal(i.net, 900); assert.equal(i.costKnown, true);
    const r = env.D7.flow.approvalRequired();
    assert.equal(r.required, true); assert.equal(r.locked, true); assert.deepEqual(plain(r.reasons), ['below-standard']);
    assert.match(env.D7.h('flow.approvalReason'), /below its standard price/);
    assert.match(env.D7.h('pricing.priceNote', itemsOf(env)[0], 0), /Below the list price \(P1234\.00\)/, 'the line says so under the price box');
  });
  it('F5: the President is never forced; a typed price equal to the calculator\'s, or above it, forces nothing; a line nobody typed over is neutral', () => {
    const pres = readyEnv('president'); addCatalogue(pres, formulaLine()); typeOver(pres, 900);
    assert.equal(pres.D7.flow.approvalRequired().required, false, 'the approver is the President');
    for (const price of [1234, 1500]) { const env = readyEnv('sales'); addCatalogue(env, formulaLine()); typeOver(env, price); assert.equal(env.D7.flow.approvalRequired().required, false, 'typed ' + price); }
    const plainLine = readyEnv('sales'); addCatalogue(plainLine, formulaLine());
    assert.equal(plainLine.D7.flow.approvalRequired().required, false); assert.equal(plainLine.D7.pricing.standardInfo().standardTotal, 1234);
  });
  it('F5: a typed price below the calculator\'s also shows on a quote of several lines (the total is held against the sum of the standards), and the approval carry still covers an approved quote', () => {
    const env = readyEnv('sales'); addCatalogue(env, formulaLine({ qty: 2, amount: 2468 })); addSink(env);
    env.run('items[0].unitPrice = 1000; items[0].amount = 2000; items[0].priceManual = true;');
    const i = env.D7.pricing.standardInfo();
    assert.ok(i.net < i.standardTotal); assert.equal(env.D7.flow.approvalRequired().required, true);
    env.KCLive.setCarry({ lastApprovedNet: i.net, lastApprovedGrand: i.net, approvedBy: 'u-pres', sourceColl: 'bk_quotes', sourceDocId: 'q1' });
    assert.equal(env.D7.flow.approvalRequired().required, false, 'an approved quote keeps its approval on reopen (Q65): unchanged');
  });
  it('F5 keeps every other case: a FIXED product is still held against its base price (a stored calculator price does not replace it), a line from before the change stays neutral, a website line keeps its own rule', () => {
    const fixed = readyEnv('sales'); addCatalogue(fixed, { priceBasis: 'manual', priceManual: true, unitPrice: 900, amount: 900, basisUnitPrice: 1000 });
    assert.equal(fixed.D7.pricing.standardInfo().standardTotal, 1111, 'the fixed rule, unchanged');
    const old = readyEnv('sales'); addCatalogue(old, formulaLine({ basisUnitPrice: undefined })); typeOver(old, 900);
    assert.equal(old.D7.pricing.standardInfo().costKnown, false); assert.equal(old.D7.flow.approvalRequired().required, false, 'no stored price: neutral, as before');
    const web = readyEnv('sales'); addCatalogue(web, { id: 'PW-004', familyId: 'sink', priceBasis: 'manual', priceManual: true, unitPrice: 900, amount: 900, basisUnitPrice: 2000 });
    assert.equal(web.D7.pricing.standardInfo().standardTotal, 2000, 'a website line: its website price');
  });
  it('Q64: a typed price on a list-priced line is warned against its list-based price; the amount is the list price, so every role reads it', () => {
    for (const role of ['president', 'sales']) {
      const env = readyEnv(role); const chef = addChef(env);
      env.run('items[0].priceBasis = "manual"; items[0].priceManual = true;');
      const note = price => { env.run(`items[0].unitPrice = ${price}`); return env.D7.h('pricing.priceNote', itemsOf(env)[0], 0); };
      assert.match(note(LIST4 - 10), new RegExp('Below the list price \\(P' + LIST4 + '\\.00\\)'), role);
      assert.doesNotMatch(note(LIST4), /Below/, role + ': equal is not below'); assert.doesNotMatch(note(LIST4 + 1000), /Below/, role);
      assert.match(note(LIST4 - 10), /auto P/, 'the auto price and ↺ are offered');
      void chef;
    }
  });
  it('Q64: with the floor mode "formula" the warning is cost x the markup, and only the President reads the amount', () => {
    for (const [role, amount] of [['president', true], ['sales', false]]) {
      const env = readyEnv(role); addChef(env); env.KC.FLOOR_MODE = 'formula';
      env.run('items[0].priceBasis = "manual"; items[0].priceManual = true; items[0].unitPrice = 1');
      const note = env.D7.h('pricing.priceNote', itemsOf(env)[0], 0);
      assert.match(note, /Below cost × standard markup/); assert.equal(/\(P\d/.test(note), amount, role);
    }
  });
  it('a catalogue line has no "auto" price in KC mode (it sells at its catalogue price), and is warned against its list price', () => {
    const env = readyEnv('sales'); addCatalogue(env, { priceBasis: 'manual', priceManual: true, unitPrice: 900, amount: 900 });
    const note = env.D7.h('pricing.priceNote', itemsOf(env)[0], 0);
    assert.doesNotMatch(note, /auto P/); assert.match(note, /Below the list price \(P1111\.00\)/);
  });
  it('the host\'s own warning (the panel and the table) agrees: KC.belowMarkup', () => {
    const env = readyEnv('sales'); const D = env.KC.products.chef_hp, st = D.starts.find(s => D.startCfg(s.id).n === 4);
    const ln = { kind: 'chef_hp', cfg: D.startCfg(st.id), priceOvr: LIST4 - 1000 };
    assert.match(env.KC.belowMarkup(ln), /Below the list price/); ln.priceOvr = LIST4; assert.equal(env.KC.belowMarkup(ln), '');
    const stn = { kind: 'station', cfg: env.KC.products.station.startCfg('stall'), priceOvr: 1 };
    assert.match(env.KC.belowMarkup(stn), /Below cost × standard markup\.$/, 'a line with no list code, a role without costs: no amount');
    const sink = { kind: 'sink', cfg: env.KC.products.sink.startCfg('hand'), priceOvr: 1 };
    assert.match(env.KC.belowMarkup(sink), /^Below the list price \(/, 'A1: a sink has a list code too');
  });
});

// ═════════════════════════════ approval in the flow (spec 1.3) ═════════════════════════════
describe('approval: when it is required, the reason, the carry', () => {
  const customLine = env => { env.KC.addLine('custom', { cat: 'prep', name: 'Cart', desc: '', dims: '', rows: [{ k: 'sh12', q: 1 }], m: null, lab: 50 }, { render: false }); };
  it('a line that needs review forces approval for Sales; Operations clears it by marking the line reviewed; the President is never forced', () => {
    const sales = readyEnv('sales'); customLine(sales);
    const r = sales.D7.flow.approvalRequired();
    assert.equal(r.required, true); assert.equal(r.locked, true); assert.deepEqual(plain(r.reasons), ['review']);
    assert.match(sales.D7.h('flow.approvalReason'), /1 line\(s\) need review: #1 .*\(custom item\)/);
    const ops = readyEnv('manager'); customLine(ops);
    assert.equal(ops.D7.flow.approvalRequired().required, true);
    ops.D7.h('flow.markAllReviewed');
    assert.equal(ops.D7.flow.approvalRequired().required, false); assert.equal(ops.D7.h('flow.approvalReason'), '');
    const pres = readyEnv('president'); customLine(pres);
    assert.equal(pres.D7.flow.approvalRequired().required, false); assert.equal(pres.D7.h('flow.approvalReason'), '');
  });
  it('Sales cannot mark a line reviewed', () => {
    const sales = readyEnv('sales'); customLine(sales); sales.D7.h('flow.markAllReviewed');
    assert.equal(itemsOf(sales)[0].reviewed, false);
  });
  it('selling below the standard total forces approval (default), only pre-ticks it with "tick", and an office "approve all" forces every quote', () => {
    const e = readyEnv('sales'); addSink(e); e.run('__disc = 10');
    assert.deepEqual(plain(e.D7.flow.approvalRequired().reasons), ['below-standard']); assert.match(e.D7.h('flow.approvalReason'), /below its standard price/);
    e.KCLive.flags = Object.assign({}, e.KCLive.flags, { approvalBelowStandard: 'tick' });
    assert.equal(e.D7.flow.approvalRequired().required, false); assert.equal(e.D7.flow.approvalPreTick(), true);
    const all = readyEnv('sales'); addSink(all); all.KCLive.flags = Object.assign({}, all.KCLive.flags, { approveAll: true });
    assert.deepEqual(plain(all.D7.flow.approvalRequired().reasons), ['approve-all']); assert.match(all.D7.h('flow.approvalReason'), /Every quote needs the President/);
  });
  it('an approval the quote carries still covers it unless the total falls below what was approved (and below standard)', () => {
    const env = readyEnv('sales'); addSink(env, 2); customLine(env);
    const net = env.D7.pricing.standardInfo().net;
    assert.equal(env.D7.h('flow.approvalCovers'), false, 'no carry');
    env.KCLive.setCarry({ lastApprovedNet: net, lastApprovedGrand: net, approvedAt: '2026-11-19T01:00:00.000Z', approvedBy: 'u-pres', approvedByName: 'Neil Barro', sourceColl: 'bk_quotes', sourceDocId: 'q1' });
    assert.equal(env.D7.h('flow.approvalCovers'), true);
    assert.equal(env.D7.flow.approvalRequired().required, false, 'a review that was open does not come back while the approval covers the quote');
    env.run('__disc = 10');
    assert.equal(env.D7.h('flow.approvalCovers'), false, 'below the approved net and below the standard total');
    assert.equal(env.D7.flow.approvalRequired().required, true);
    env.KCLive.setCarry({ lastApprovedNet: net / 2, sourceColl: 'bk_quotes', sourceDocId: 'q1' });
    assert.equal(env.D7.h('flow.approvalCovers'), true, 'not below what was approved');
  });
  it('the carry only keeps a usable shape: junk is nothing, and it never has an undefined value', () => {
    const env = readyEnv('sales');
    for (const bad of [null, undefined, 'x', 7, {}, { lastApprovedNet: 'a lot' }]) assert.equal(env.KCLive.setCarry(bad), null);
    const c = plain(env.KCLive.setCarry({ lastApprovedNet: 100 }));
    assert.deepEqual(Object.keys(c).sort(), ['approvedAt', 'approvedBy', 'approvedByName', 'lastApprovedGrand', 'lastApprovedNet', 'sourceColl', 'sourceDocId']);
    assert.ok(Object.values(c).every(v => v !== undefined));
  });
});

// ═════════════════════════════ afterLoad: the approval carry and the typed costs (spec 3.4) ═════════════════════════════
describe('KCLive.afterLoad', () => {
  const approvedDoc = (over = {}) => ({ approvalStatus: 'approved', netAmount: 5000, grandTotal: 5600, vatAmount: 600, approvedAt: { seconds: 1763517600 }, approvedBy: 'u-pres', ...over });
  const sidecar = (over = {}) => ({ items: [{ i: 0, n: 'Cart', kc: { kcId: 'K1', kind: 'custom', typed: { custom: [], m: null, lab: 777 } } }], ...over });
  async function setup(docs, role = 'president') {
    const env = readyEnv(role); env.win.db = makeFakeDb(docs);
    env.KC.addLine('custom', { cat: 'prep', name: 'Cart', desc: '', dims: '', rows: [{ k: 'sh12', q: 1 }], m: null, lab: null }, { render: false });
    env.run('reopenSourceDocId = "q1"; reopenSourceCollection = "bk_quotes"');
    return env;
  }
  const load = env => env.KCLive.afterLoad({ sourceDocId: 'q1', sourceCollection: 'bk_quotes' });

  it('the approval carry is built from an approved source quote', async () => {
    const env = await setup({ 'bk_quotes/q1': approvedDoc(), 'quote_costs/bk_quotes_q1': sidecar() });
    await load(env);
    assert.deepEqual(plain(env.KCLive.carry()), { lastApprovedNet: 5000, lastApprovedGrand: 5600, approvedAt: '2025-11-19T02:00:00.000Z', approvedBy: 'u-pres', approvedByName: '', sourceColl: 'bk_quotes', sourceDocId: 'q1' });
  });
  it('with no netAmount the net is grandTotal less vatAmount; the approver\'s own name is known to the approver', async () => {
    const env = await setup({ 'bk_quotes/q1': approvedDoc({ netAmount: 'n/a' }) });
    env.win.auth.currentUser.uid = 'u-pres'; env.KCLive.userName = 'Neil Barro';
    await load(env);
    assert.equal(env.KCLive.carry().lastApprovedNet, 5000); assert.equal(env.KCLive.carry().approvedByName, 'Neil Barro');
  });
  // QA D7: js/screens/approvals.js writes approvedBy (a uid) and no name, so the carry's approvedByName was empty: it is filled from the approver's own user record (one get of users/<uid>)
  const spyReads = env => { const reads = [], col = env.win.db.collection.bind(env.win.db); env.win.db.collection = c => { const o = col(c), doc = o.doc.bind(o); o.doc = id => { const d = doc(id), get = d.get.bind(d); d.get = () => { reads.push(c + '/' + id); return get(); }; return d; }; return o; }; return reads; };
  it('D7: the approver\'s name comes from the approver\'s user record when the quote only has the uid (another user than the one signed in); one read of users/<uid>, nothing else new', async () => {
    const env = await setup({ 'bk_quotes/q1': approvedDoc(), 'quote_costs/bk_quotes_q1': sidecar(), 'users/u-pres': { name: 'Neil Barro', role: 'president' } });
    const reads = spyReads(env); await load(env);
    assert.equal(env.KCLive.carry().approvedByName, 'Neil Barro'); assert.equal(env.KCLive.carry().approvedBy, 'u-pres'); assert.equal(env.KCLive.carry().lastApprovedNet, 5000, 'the rest of the carry is as it was');
    assert.deepEqual(reads, ['bk_quotes/q1', 'quote_costs/bk_quotes_q1', 'users/u-pres'], 'the quote, its sidecar, and the approver: three gets');
    assert.equal(plain(env.KCLive.sidecarExtras().approval).approvedByName, 'Neil Barro', 'it goes to the sidecar with the rest of the approval');
    const dn = await setup({ 'bk_quotes/q1': approvedDoc(), 'users/u-pres': { displayName: 'N. Barro' } }); await load(dn); assert.equal(dn.KCLive.carry().approvedByName, 'N. Barro', 'displayName when there is no name');
    const ful = await setup({ 'bk_quotes/q1': approvedDoc(), 'users/u-pres': { fullName: 'Neil A. Barro' } }); await load(ful); assert.equal(ful.KCLive.carry().approvedByName, 'Neil A. Barro', 'fullName last');
  });
  it('D7: a name the quote already has is not read again; the person signed in who is the approver needs no read; the name of another user is never the signed-in user\'s', async () => {
    const own = await setup({ 'bk_quotes/q1': approvedDoc({ approvedByName: 'Neil Barro' }), 'users/u-pres': { name: 'Someone Else' } }); const r1 = spyReads(own); await load(own);
    assert.equal(own.KCLive.carry().approvedByName, 'Neil Barro'); assert.equal(r1.includes('users/u-pres'), false, 'the stored name wins: no read');
    const me = await setup({ 'bk_quotes/q1': approvedDoc(), 'users/u-pres': { name: 'Someone Else' } }); me.win.auth.currentUser.uid = 'u-pres'; me.KCLive.userName = 'Neil Barro'; const r2 = spyReads(me); await load(me);
    assert.equal(me.KCLive.carry().approvedByName, 'Neil Barro'); assert.equal(r2.includes('users/u-pres'), false, 'the signed-in approver is known without a read');
    const other = await setup({ 'bk_quotes/q1': approvedDoc({ approvedBy: 'u-other' }), 'users/u-other': { name: 'Delfin Purchasing' } }); other.win.auth.currentUser.displayName = 'Uriel Sales'; await load(other);
    assert.equal(other.KCLive.carry().approvedByName, 'Delfin Purchasing', 'the approver\'s record, never the signed-in user\'s display name');
  });
  it('D7: a user record that cannot be read, has no name, or is missing leaves the name blank, as before; the carry itself is still built', async () => {
    for (const [label, docs, opt] of [['missing', { 'bk_quotes/q1': approvedDoc() }, {}], ['no name', { 'bk_quotes/q1': approvedDoc(), 'users/u-pres': { role: 'president' } }, {}], ['blank name', { 'bk_quotes/q1': approvedDoc(), 'users/u-pres': { name: '   ' } }, {}],
      ['denied', { 'bk_quotes/q1': approvedDoc(), 'users/u-pres': { name: 'Neil Barro' } }, { deny: ['users'] }], ['unavailable', { 'bk_quotes/q1': approvedDoc(), 'users/u-pres': { name: 'Neil Barro' } }, { fail: ['users'] }]]) {
      const env = await setup(docs); env.win.db = makeFakeDb(docs, opt); await load(env);
      assert.equal(env.KCLive.carry().approvedByName, '', label); assert.equal(env.KCLive.carry().lastApprovedNet, 5000, label + ': the carry is built'); assert.equal(env.KCLive.carry().approvedBy, 'u-pres', label);
    }
    const none = await setup({ 'bk_quotes/q1': approvedDoc({ approvedBy: undefined }), 'users/u-pres': { name: 'Neil Barro' } }); const r = spyReads(none); await load(none);
    assert.equal(none.KCLive.carry().approvedByName, '', 'no approver uid: nothing to look up'); assert.equal(r.some(x => x.startsWith('users/')), false);
  });
  it('D7: the carry does not wait for the lookup (it is there, without a name, while the user read is pending), and a carry set by another load meanwhile is not overwritten when the lookup answers', async () => {
    const docs = { 'bk_quotes/q1': approvedDoc(), 'users/u-pres': { name: 'Neil Barro' } };
    const slow = await setup(docs); slow.win.db = makeFakeDb(docs, { hang: ['users'] });
    void load(slow); await new Promise(r => setTimeout(r, 25));
    assert.equal(slow.KCLive.carry().lastApprovedNet, 5000, 'the approval is carried'); assert.equal(slow.KCLive.carry().approvedByName, '', 'the name has not come yet');
    const env = await setup(docs); let release; const gate = new Promise(r => { release = r; }), col = env.win.db.collection.bind(env.win.db);
    env.win.db.collection = c => { const o = col(c); if (c !== 'users') return o; const doc = o.doc.bind(o); o.doc = id => { const d = doc(id), get = d.get.bind(d); d.get = () => gate.then(() => get()); return d; }; return o; };
    const done = load(env); await new Promise(r => setTimeout(r, 25));
    assert.equal(env.KCLive.carry().approvedByName, '');
    env.KCLive.setCarry({ lastApprovedNet: 123 });                                                        // another quote was loaded meanwhile
    release(); await done;
    assert.equal(env.KCLive.carry().lastApprovedNet, 123); assert.equal(env.KCLive.carry().approvedByName, '', 'the new carry is left alone');
    const ok = await setup(docs); await load(ok); assert.equal(ok.KCLive.carry().approvedByName, 'Neil Barro', 'and without a rival load the name joins the carry');
  });
  it('D7: the sidecar\'s own approval gets its approver\'s name too (an approval carried over from an older revision that never had one)', async () => {
    const approval = { lastApprovedNet: 4200, lastApprovedGrand: 4704, approvedAt: '2026-11-18T01:00:00.000Z', approvedBy: 'u-pres', approvedByName: '', sourceColl: 'bk_quotes', sourceDocId: 'q0' };
    const env = await setup({ 'bk_quotes/q1': { approvalStatus: 'filed' }, 'quote_costs/bk_quotes_q1': sidecar({ approval }), 'users/u-pres': { name: 'Neil Barro' } }); await load(env);
    assert.equal(env.KCLive.carry().approvedByName, 'Neil Barro'); assert.equal(env.KCLive.carry().lastApprovedNet, 4200);
  });
  it('D7 needs no rules change: any signed-in profile may get another user\'s document (users/<uid>), which is all the lookup does', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'), at = rules.indexOf('match /users/{uid} {');
    assert.ok(at > 0); assert.match(rules.slice(at, at + 900), /allow get:\s*if isAuth\(\);/);
  });
  it('a quote that is not approved: the sidecar\'s own approval is carried (an approved quote revised once already); neither is nothing', async () => {
    const approval = { lastApprovedNet: 4200, lastApprovedGrand: 4704, approvedAt: '2026-11-18T01:00:00.000Z', approvedBy: 'u-pres', approvedByName: 'Neil Barro', sourceColl: 'bk_quotes', sourceDocId: 'q0' };
    const env = await setup({ 'bk_quotes/q1': { approvalStatus: 'filed' }, 'quote_costs/bk_quotes_q1': sidecar({ approval }) });
    await load(env);
    assert.deepEqual(plain(env.KCLive.carry()), approval, 'the approved document\'s own identity is kept');
    const none = await setup({ 'bk_quotes/q1': { approvalStatus: 'filed' }, 'quote_costs/bk_quotes_q1': sidecar() });
    none.KCLive.setCarry({ lastApprovedNet: 1 }); await load(none); assert.equal(none.KCLive.carry(), null);
  });
  it('a read that fails leaves the carry null, and a state that came from no filed quote is left alone', async () => {
    const env = await setup({ 'bk_quotes/q1': approvedDoc() });
    env.win.db = makeFakeDb({ 'bk_quotes/q1': approvedDoc() }, { fail: ['bk_quotes'] });
    env.KCLive.setCarry({ lastApprovedNet: 9 }); await load(env); assert.equal(env.KCLive.carry(), null);
    env.KCLive.setCarry({ lastApprovedNet: 9 });
    assert.equal(await env.KCLive.afterLoad({ items: [] }), false); assert.equal(env.KCLive.carry().lastApprovedNet, 9, 'a template or a hand-off has no source: the pricing fields own the carry');
    assert.equal(await env.KCLive.afterLoad(null), false);
  });
  it('the typed costs go back into the line by kcId, and the line is priced again (every internal role, in memory only)', async () => {
    for (const role of ['president', 'sales', 'manager', 'purchasing']) {
      const env = await setup({ 'bk_quotes/q1': approvedDoc(), 'quote_costs/bk_quotes_q1': sidecar() }, role);
      const line = itemsOf(env)[0];
      assert.equal(line.cfg.lab, null); assert.equal(line.needsPrice, true, 'unpriced before: no typed labor');
      await load(env);
      assert.equal(line.cfg.lab, 777, role); assert.equal(line._kc.priced, true, role); assert.ok(line.unitPrice > 0); assert.equal(line.needsPrice, undefined);
    }
  });
  it('a sidecar row whose name is not the line\'s is refused: a stale row never lands on the wrong line', async () => {
    const env = await setup({ 'bk_quotes/q1': approvedDoc(), 'quote_costs/bk_quotes_q1': sidecar({ items: [{ i: 0, n: 'Some other line', kc: { kcId: 'K1', kind: 'custom', typed: { custom: [], m: null, lab: 777 } } }] }) });
    await load(env); assert.equal(itemsOf(env)[0].cfg.lab, null);
  });
  it('a row of an older sidecar without a kcId matches by index AND name; a kcId that is not on the quote and an index that is not a kc line are refused', async () => {
    const byIndex = await setup({ 'bk_quotes/q1': approvedDoc(), 'quote_costs/bk_quotes_q1': sidecar({ items: [{ i: 0, n: 'Cart', kc: { kind: 'custom', typed: { custom: [], m: null, lab: 55 } } }] }) });
    await load(byIndex); assert.equal(itemsOf(byIndex)[0].cfg.lab, 55);
    const gone = await setup({ 'bk_quotes/q1': approvedDoc(), 'quote_costs/bk_quotes_q1': sidecar({ items: [{ i: 0, n: 'Cart', kc: { kcId: 'K9', kind: 'custom', typed: { custom: [], m: null, lab: 55 } } }] }) });
    await load(gone); assert.equal(itemsOf(gone)[0].cfg.lab, null);
  });
  it('custom parts on a product line get their typed costs back, part by part', async () => {
    const env = readyEnv('president'); addSink(env);
    env.run('items[0].cfg.custom = [{ text: "a bracket", m: null, lab: null }, { text: "a shelf", m: null, lab: null }]; items[0].reopen = 1');
    env.win.db = makeFakeDb({ 'bk_quotes/q1': approvedDoc(), 'quote_costs/bk_quotes_q1': { items: [{ i: 0, n: itemsOf(env)[0].name, kc: { kcId: 'K1', kind: 'sink', typed: { custom: [{ m: 10, lab: 20 }, { m: 30, lab: 40 }] } } }] } });
    await load(env);
    assert.deepEqual(plain(itemsOf(env)[0].cfg.custom.map(c => [c.m, c.lab])), [[10, 20], [30, 40]]);
  });
});

// ═════════════════════════════ the cost sidecar (spec 3.4) ═════════════════════════════
describe('the cost sidecar', () => {
  const KEYS = ['at', 'costKnown', 'costTimesMarkup', 'engine', 'floorMode', 'floorTotal', 'grandTotal', 'markup', 'net', 'projectCost', 'standardTotal', 'v'];
  it('sidecarExtras has exactly the keys of the cost sidecar: { kcSummary, approval }', () => {
    const env = readyEnv('sales'); addSink(env, 2);
    const x = plain(env.KCLive.sidecarExtras());
    assert.deepEqual(Object.keys(x).sort(), ['approval', 'kcSummary']);
    assert.deepEqual(Object.keys(x.kcSummary).sort(), KEYS);
    assert.equal(x.kcSummary.v, 1); assert.equal(x.kcSummary.engine, 'kc1'); assert.match(x.kcSummary.at, /^\d{4}-\d\d-\d\dT/); assert.equal(typeof x.kcSummary.costKnown, 'boolean');
    assert.equal(x.kcSummary.floorMode, 'list'); assert.equal(x.kcSummary.markup, 2); assert.equal(x.approval, null);
    for (const k of KEYS) assert.notEqual(x.kcSummary[k], undefined, k);
  });
  it('the numbers are the ones of the quote: net, grand, project cost, floor, cost x markup, standard total', () => {
    const env = readyEnv('president'); addSink(env, 2); addChef(env);
    const x = plain(env.KCLive.sidecarExtras().kcSummary), i = plain(env.D7.pricing.standardInfo()), t = env.run('computeTotals()'), tc = env.D7.pricing.trueCost();
    assert.equal(x.net, Math.round(t.net * 100) / 100); assert.equal(x.grandTotal, Math.round(t.grand * 100) / 100);
    assert.equal(x.projectCost, Math.round(tc.direct * 100) / 100); assert.equal(x.floorTotal, Math.round(tc.floorTotal * 100) / 100);
    assert.equal(x.costTimesMarkup, Math.round(i.costTimesMarkup * 100) / 100); assert.equal(x.standardTotal, Math.round(i.standardTotal * 100) / 100);
  });
  it('the approval part is the carry, with its seven keys, and nothing else', () => {
    const env = readyEnv('sales'); addSink(env);
    env.KCLive.setCarry({ lastApprovedNet: 100, lastApprovedGrand: 112, approvedAt: '2026-11-19T01:00:00.000Z', approvedBy: 'u-pres', approvedByName: 'Neil Barro', sourceColl: 'bk_quotes', sourceDocId: 'q1', secret: 'x' });
    const a = plain(env.KCLive.sidecarExtras().approval);
    assert.deepEqual(Object.keys(a).sort(), ['approvedAt', 'approvedBy', 'approvedByName', 'lastApprovedGrand', 'lastApprovedNet', 'sourceColl', 'sourceDocId']);
  });
  it('a line row of the sidecar carries the kcId, the typed costs and the build, and the list basis of a list-priced line', () => {
    const env = readyEnv('president'); addStation(env); addChef(env);
    const a = plain(env.D7.h('adapter.sidecarRow', itemsOf(env)[0])), b = plain(env.D7.h('adapter.sidecarRow', itemsOf(env)[1]));
    assert.deepEqual(Object.keys(a).sort(), ['M', 'groups', 'kcId', 'kind', 'lines', 'markup', 'projectCost', 'typed'], 'a product with no list code: no list basis');
    assert.equal(a.kcId, 'K1'); assert.deepEqual(Object.keys(a.groups[0]).sort(), ['M', 'bracket', 'label', 'labor', 'misc']); assert.deepEqual(Object.keys(a.lines[0]).sort(), ['k', 'l', 'p', 'part', 'q', 't', 'u']);
    assert.deepEqual(Object.keys(b.list).sort(), ['adj', 'base', 'baseSelling', 'code', 'lengthAdj', 'status']);
    assert.equal(typeof b.list.status, 'string', 'the price status of the list row is in the cost sidecar (staff only), as a string');
    assert.ok(JSON.stringify(a).indexOf('undefined') < 0 && JSON.stringify(b).indexOf('undefined') < 0);
  });
});

// ═════════════════════════════ publicItem: the typed costs leave the payload (spec 3.4) ═════════════════════════════
describe('publicItem', () => {
  const COST_KEYS = ['M', 'projectCost', 'labor', 'misc', 'lab', 'costMat', 'bom', 'capitalMaterials', 'capitalLabor', '_kc', 'markup', 'p'];
  const keysAt = (o, found = []) => { if (Array.isArray(o)) o.forEach(v => keysAt(v, found)); else if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (COST_KEYS.includes(k)) found.push(k); keysAt(o[k], found); } return found; };
  it('publicItem takes the typed costs out of a custom part and a custom item', () => {
    const env = readyEnv('president'); addSink(env);
    env.run('items[0].cfg.custom = [{ text: "a bracket", m: 123, lab: 45 }]');
    env.KC.addLine('custom', { cat: 'prep', name: 'Cart', desc: '', dims: '', rows: [{ k: 'sh12', q: 1 }], m: 999, lab: 88 }, { render: false });
    const sink = itemsOf(env)[0], custom = itemsOf(env)[1];
    const a = plain(env.D7.h('adapter.publicItem', sink)), b = plain(env.D7.h('adapter.publicItem', custom));
    assert.deepEqual(plain(a.cfg.custom), [{ text: 'a bracket' }], 'the part keeps its words, not its costs');
    assert.equal('m' in b.cfg, false); assert.equal('lab' in b.cfg, false); assert.deepEqual(plain(b.cfg.rows), [{ k: 'sh12', q: 1 }]);
    assert.equal(sink.cfg.custom[0].m, 123, 'the live line is not touched: the payload gets a copy');
  });
  it('none of the cost keys survives at any depth, on any product start, and the line keeps its words and its price', () => {
    const env = readyEnv('president');
    for (const D of env.KC.productList()) for (const st of D.starts) { env.KC.addLine(D.id, D.startCfg(st.id), { render: false }); }
    env.run('items.forEach(function(it){ it._kc.projectCost = 1; it.costMat = 5; it.capitalMaterials = 6; it.bom = [{ name: "x", qty: 1, unitPrice: 2 }]; it.markup = 3; it.p = 4; })');
    for (const it of itemsOf(env)) {
      const out = plain(env.D7.h('adapter.publicItem', it));
      assert.deepEqual(keysAt(out), [], it.kcKind + ' ' + it.kcId);
      assert.equal(out.name, it.name); assert.equal(out.unitPrice, it.unitPrice); assert.equal(out.kcKind, it.kcKind);
    }
  });
  it('a product\'s own configuration never uses a name of the list, so removing the names takes no real setting out', () => {
    const env = readyEnv('president');
    for (const D of env.KC.productList()) for (const st of D.starts) assert.deepEqual(keysAt(plain(D.startCfg(st.id))), [], D.id + ' ' + st.id);
    assert.deepEqual(keysAt(plain(env.KC.customDef.startCfg())), ['lab'], 'the custom item\'s only such key is its typed labor: a typed cost, which publicItem is there to take out');
  });
  it('a line that is not a kc line is not touched (the page\'s own strip handles it)', () => {
    const env = readyEnv('president');
    assert.equal(env.D7.h('adapter.publicItem', { id: 'PW-001', name: 'x', capitalMaterials: 5 }), '');
    assert.equal(env.D7.h('adapter.publicItem', null), '');
  });
});

// ═════════════════════════════ the writes (spec 3.6, packet D's contract) ═════════════════════════════
// a row of kc_config/list_prices as the seed writes it (Addendum 1 A1): an OBJECT per code, { code, price, perMetre | null, status, label, std }.  A bare number is the older format and is still read.
const LROW = (code, price, o = {}) => ({ code, price, perMetre: null, status: 'Data', label: 'Made-up ' + code, std: '1200 x 600', ...o });
const SEED = () => ({ v: 1, made: '2026-11-19T00:00:00.000Z',
  settings: { v: 1, br: { simple: 30, medium: 50, complex: 70 }, misc: 10, markup: 2, corner: 1500, hood: { overhang: 15 }, duct: { fpm: 1800 }, floorMode: 'list' },
  materials: { sh12: { p: 321, source: 'Kingsway PO + 10%' }, sh10: { p: 111, source: 'Sample' }, sir2: { p: 4000, source: 'Set by Neil' },
    zz_new: { p: 5, source: 'Sample', l: 'Thing', u: 'pc', cat: 'Hardware', grade: 'x', size: 'y' } },
  listPrices: { effective: '2026-11-19', rows: { 'CK-HP-4': LROW('CK-HP-4', 25000), 'CK-LP-2': LROW('CK-LP-2', 20000, { perMetre: 500, status: 'Estimate' }), 'CK-NONE': LROW('CK-NONE', 0), 'CK-OLD': 7000 } },
  products: [{ sku: 'GR-LR-900', title: 'Lava rock griller, 900', category: 'cooking_line', basePrice: 4242, measurement: { w: 900, d: 750, h: 850 }, specifications: 'a made-up spec' }] });
const PROFILES = { president: { role: 'president' }, purchasing: { role: 'employee', departments: ['Purchasing'] }, manager: { role: 'manager', departments: ['Production'] }, sales: { role: 'employee', departments: ['Sales'] } };
const writerEnv = async (role = 'president', docs = {}) => {
  const env = makeEnv({ db: makeFakeDb({ ['users/u-' + role]: { ...PROFILES[role], name: role + ' Name' }, ...docs }), user: { uid: 'u-' + role, displayName: role + ' Name' } });
  env.KCLive.role = role; env.KCLive.userName = role + ' Name'; env.KC.S.role = role;
  return env;
};
const wrote = (env, p) => env.win.db.writes.filter(w => w.path === p);

describe('KCLive.importSeed', () => {
  it('writes the settings, the list prices, one doc per material (with one history entry) and the products, all stamped, and loads the result', async () => {
    const env = await writerEnv(); const out = await env.KCLive.importSeed(SEED());
    assert.deepEqual(plain(out), { settings: 1, materials: 4, listPrices: 3, products: 1, historyAdded: 4, written: 7 });
    const s = env.win.db.store;
    assert.equal(s.get('kc_config/settings').updatedBy, 'u-president'); assert.equal(s.get('kc_config/settings').updatedByName, 'president Name'); assert.equal(s.get('kc_config/settings').v, 1);
    assert.deepEqual(s.get('kc_config/list_prices').rows, { 'CK-HP-4': LROW('CK-HP-4', 25000), 'CK-LP-2': LROW('CK-LP-2', 20000, { perMetre: 500, status: 'Estimate' }), 'CK-OLD': 7000 }, 'object rows keep every field; a row with no price is not written; a bare number is kept');
    assert.equal(s.get('kc_config/list_prices').effective, '2026-11-19'); assert.equal(s.get('kc_config/list_prices').v, 1); assert.equal(s.get('kc_config/list_prices').updatedBy, 'u-president');
    const m = s.get('kc_materials/sh12');
    assert.equal(m.v, 1); assert.equal(m.key, 'sh12'); assert.equal(m.p, 321); assert.equal(m.source, 'Kingsway PO + 10%'); assert.equal(m.hist.length, 1); assert.equal(m.hist[0].p, 321); assert.equal(m.hist[0].by, 'president Name'); assert.match(m.hist[0].d, /^\d{4}-\d\d-\d\d$/);
    assert.equal(m.updatedBy, 'u-president');
    assert.equal(s.get('kc_materials/zz_new').l, 'Thing'); assert.equal(s.get('kc_materials/zz_new').cat, 'Hardware');
    const p = s.get('products/GR-LR-900');
    assert.deepEqual(plain({ t: p.title, c: p.category, f: p.formulaType, b: p.basePrice, u: p.unit, m: p.measurement, sp: p.specifications }), { t: 'Lava rock griller, 900', c: 'cooking_line', f: 'fixed', b: 4242, u: 'pc', m: { w: 900, d: 750, h: 850 }, sp: 'a made-up spec' });
    for (const k of ['capitalMaterials', 'capitalLabor', 'bom', 'costMat']) assert.equal(k in p, false, 'never a cost field: ' + k);
    assert.equal(env.KCLive.state, 'live', 'the import ends with a load'); assert.equal(env.KC.P.sh12.p, 321); assert.equal(env.KC.listRow('CK-HP-4').price, 25000); assert.equal(env.KC.listRow('CK-LP-2').perMetre, 500); assert.equal(env.KC.listRow('CK-LP-2').status, 'Estimate'); assert.equal(env.KC.listRow('CK-OLD').price, 7000); assert.equal(env.KC.SET.corner, 1500);
  });
  it('is idempotent: a second run adds no history entry, and a changed price adds exactly one', async () => {
    const env = await writerEnv(); await env.KCLive.importSeed(SEED());
    const again = await env.KCLive.importSeed(SEED());
    assert.equal(again.historyAdded, 0); assert.equal(env.win.db.store.get('kc_materials/sh12').hist.length, 1);
    const changed = SEED(); changed.materials.sh12.p = 322;
    const third = await env.KCLive.importSeed(changed);
    assert.equal(third.historyAdded, 1); assert.deepEqual(plain(env.win.db.store.get('kc_materials/sh12').hist.map(h => h.p)), [321, 322]); assert.equal(env.win.db.store.get('kc_materials/sh10').hist.length, 1);
  });
  it('merges: a rating edited on the screen survives a re-import, a code added later keeps its list price', async () => {
    const env = await writerEnv('president', { 'kc_materials/sir2': { key: 'sir2', p: 1, hp: 3, cfm: 4400, sp: 1.2, hist: [] }, 'kc_config/list_prices': { v: 1, rows: { 'CK-LATE': 30000 } } });
    await env.KCLive.importSeed(SEED());
    assert.equal(env.win.db.store.get('kc_materials/sir2').hp, 3); assert.equal(env.win.db.store.get('kc_config/list_prices').rows['CK-LATE'], 30000); assert.equal(env.win.db.store.get('kc_config/list_prices').rows['CK-HP-4'].price, 25000);
  });
  it('writes in batches of at most 400', async () => {
    const env = await writerEnv(); const seed = SEED();
    for (let i = 0; i < 450; i++) seed.materials['m_' + i] = { p: i + 1, source: 'Sample' };
    await env.KCLive.importSeed(seed);
    assert.ok(env.win.db.batches.length >= 2); assert.ok(env.win.db.batches.every(n => n <= 400), env.win.db.batches.join(','));
    assert.equal(env.win.db.batches.reduce((a, b) => a + b, 0), 2 + 454 + 1);                    // the settings, the list prices, 454 materials, the product
  });
  it('only the President, and a bad file writes nothing at all', async () => {
    for (const role of ['sales', 'manager', 'purchasing']) {
      const env = await writerEnv(role); await assert.rejects(() => env.KCLive.importSeed(SEED()), /Only the President/, role); assert.equal(env.win.db.writes.length, 0);
    }
    const env = await writerEnv();
    for (const bad of [{ ...SEED(), v: 2 }, { ...SEED(), settings: null }, (() => { const s = SEED(); s.materials['Bad Key'] = { p: 1 }; return s; })(),
      (() => { const s = SEED(); s.products[0].basePrice = 'x'; return s; })(), (() => { const s = SEED(); s.settings.markup = 0; return s; })(), 'not json']) {
      await assert.rejects(() => env.KCLive.importSeed(bad)); assert.equal(env.win.db.writes.length, 0, 'nothing written');
    }
  });
  it('accepts the file as text', async () => {
    const env = await writerEnv(); const out = await env.KCLive.importSeed(JSON.stringify(SEED())); assert.equal(out.materials, 4);
  });
});

describe('the Standard Price List rows are objects (Addendum 1 A1): { code, price, perMetre | null, status, label, std }', () => {
  const STATUSES = ['Data', 'Smoothed', 'Estimate', 'After review', 'Supplier price'];
  const rows86 = () => { const r = {}; for (let i = 0; i < 86; i++) { const code = 'T-' + String(i).padStart(3, '0'); r[code] = LROW(code, 100 + i, { perMetre: i % 4 === 0 ? 10 + i : null, status: STATUSES[i % 5], label: 'Made-up item ' + i, std: (900 + i) + ' mm' }); } return r; };
  it('importSeed takes a map of 86 object rows: 86 list prices, every field kept, the document a map with v 1 and updatedBy', async () => {
    const env = await writerEnv(); const seed = SEED();
    seed.listPrices.rows = Object.assign(rows86(), { 'T-NOPRICE': LROW('T-NOPRICE', 0), 'T-NULL': LROW('T-NULL', null) });          // two rows without a usable price: not written
    const out = await env.KCLive.importSeed(seed);
    assert.equal(out.listPrices, 86, 'the count the screen shows');
    const doc = env.win.db.store.get('kc_config/list_prices');
    assert.equal(doc.v, 1); assert.equal(doc.updatedBy, 'u-president'); assert.ok(isMap(doc.rows), 'rows is a map (the rules require it)');
    assert.equal(Object.keys(doc.rows).length, 86); assert.deepEqual(doc.rows, rows86(), 'every field of every row, exactly');
    assert.equal(Object.keys(env.KC.LISTP).length, 86, 'the engine has all of them after the import');
    assert.deepEqual(plain(env.KC.listRow('T-004')), { price: 104, perMetre: 14, status: 'Supplier price', label: 'Made-up item 4', std: '904 mm' });
    assert.equal(env.KC.listRow('T-005').perMetre, null); assert.equal(env.KC.listRow('T-NOPRICE'), null, 'no price above 0: no list price, the formula stands');
  });
  it('every document the import writes carries what the rules ask: v 1, updatedBy, key = the document id, at most 20 history entries, rows as a map', async () => {
    const env = await writerEnv(); await env.KCLive.importSeed(SEED());
    const s = env.win.db.store;
    for (const k of s.keys()) {
      const d = s.get(k);
      if (k.startsWith('kc_config/')) { assert.equal(d.v, 1, k); assert.equal(d.updatedBy, 'u-president', k); }
      if (k.startsWith('kc_materials/')) { assert.equal(d.v, 1, k); assert.equal(d.updatedBy, 'u-president', k); assert.equal(d.key, k.split('/')[1], k); assert.ok(Array.isArray(d.hist) && d.hist.length <= 20, k); }
    }
    assert.ok(isMap(s.get('kc_config/list_prices').rows));
  });
  it('KCLive.load puts object rows in KC.LISTP (the engine reads them with KC.listRow); a bare number and a row with no price are handled', async () => {
    const env = await writerEnv('president', { 'kc_config/list_prices': { v: 1, rows: Object.assign(rows86(), { 'T-OLD': 7000, 'T-ZERO': LROW('T-ZERO', 0) }) }, 'kc_materials/sh12': { key: 'sh12', p: 321, hist: [] } });
    await env.KCLive.load();
    assert.equal(env.KCLive.ready, true); assert.equal(Object.keys(env.KC.LISTP).length, 87, '86 objects and one bare number; the row with no price is not there');
    assert.equal(env.KC.listRow('T-OLD').price, 7000); assert.equal(env.KC.listRow('T-ZERO'), null);
    assert.equal(env.KC.listRow('T-008').perMetre, 18); assert.equal(env.KC.listRow('T-008').status, STATUSES[3]);
  });
  it('saveListPrices keeps what the row holds: a new price changes only the price (the per-metre rate, status, label and size stay); null removes the code; a new code is a bare number; the others are untouched', async () => {
    const env = await writerEnv('president', { 'kc_config/list_prices': { v: 1, effective: '2026-11-19', rows: rows86() }, 'kc_materials/sh12': { key: 'sh12', p: 321, hist: [] } });
    await env.KCLive.load();
    await env.KCLive.saveListPrices({ 'T-004': 999, 'T-005': null, 'T-NEW': 55 });
    const rows = env.win.db.store.get('kc_config/list_prices').rows, want = rows86();
    assert.deepEqual(rows['T-004'], { ...want['T-004'], price: 999 }); assert.equal('T-005' in rows, false); assert.equal(rows['T-NEW'], 55);
    delete want['T-004']; delete want['T-005']; const rest = { ...rows }; delete rest['T-004']; delete rest['T-NEW'];
    assert.deepEqual(rest, want, 'all other 84 rows exactly as they were');
    assert.equal(env.win.db.store.get('kc_config/list_prices').v, 1); assert.equal(env.win.db.store.get('kc_config/list_prices').updatedBy, 'u-president');
    assert.equal(env.KC.listRow('T-004').price, 999); assert.equal(env.KC.listRow('T-004').perMetre, 14); assert.equal(env.KC.listRow('T-005'), null); assert.equal(env.KC.listRow('T-NEW').price, 55);
    await assert.rejects(() => env.KCLive.saveListPrices({ 'T-004': 0 }), /above 0/);
  });
});

describe('Addendum 2 B6: the price status "Approved" (staff only, never printed) is a status like the other five, in the seed builder, the engine rows and the Standard price list screen', () => {
  const requireCjs = createRequire(import.meta.url), SEEDER = requireCjs('../scripts/kc-seed-build.js');
  const SIX = ['Data', 'Smoothed', 'Estimate', 'After review', 'Supplier price', 'Approved'];
  // the smallest inputs the builder accepts: one material, one list code from the sheet and one the sheet lacks (the owner approved it)
  const mk = (extra, sheetStatus) => {
    const ref = { P: { sh12: { l: 'Sheet 1.2', u: 'sheet', p: 1 } }, INFO: {}, CATS: ['Sheet'], SET: { br: { simple: 30, medium: 50, complex: 70 }, misc: 10, markup: 2, corner: 5, hood: {}, duct: {} } };
    const ov = { v: 1, materials: {}, blowers: {}, newRows: {}, listPrices: { effective: '2026-11-19', csv: 'x.csv', docPrices: { 'T-NEW': 150 }, extra: { 'T-NEW': extra } }, renamed: {}, products: [], settings: {} };
    const sheet = new Map([['T-OLD', { label: 'Made-up old', std: '1 pc', price: 100, perMetre: null, status: sheetStatus || 'Data' }]]);
    return SEEDER.build(ref, ov, [], null, sheet);
  };
  it('the seed builder accepts Approved on a row the sheet lacks and on a sheet row, keeps it in the seed, and counts it', () => {
    const out = mk({ status: 'Approved', label: 'Made-up new', std: '2 pc' });
    assert.deepEqual(out.errors, []); assert.equal(out.seed.listPrices.rows['T-NEW'].status, 'Approved'); assert.equal(out.counts.byStatus.Approved, 1);
    const sheetRow = mk({ status: 'Data', label: 'Made-up new', std: '2 pc' }, 'Approved'); assert.deepEqual(sheetRow.errors, []); assert.equal(sheetRow.seed.listPrices.rows['T-OLD'].status, 'Approved');
    for (const st of SIX) assert.deepEqual(mk({ status: st, label: 'x', std: '' }).errors, [], st);
  });
  it('the seed builder still refuses a status that is not one of the six, and its message names all six', () => {
    for (const bad of ['Final', 'approved', 'APPROVED', 'Confirmed', '']) {
      const out = mk({ status: bad, label: 'x', std: '' }), msg = out.errors.find(e => /list price status is not one of/.test(e));
      assert.ok(msg, JSON.stringify(bad) + ' is refused: ' + out.errors.join(' | '));
      for (const st of SIX) assert.ok(msg.includes(st), st + ' is named: ' + msg);
    }
  });
  it('a row of the list document carries the status through KCLive (the engine row) and keeps it when only its price changes', async () => {
    const rows = { 'T-001': LROW('T-001', 100, { status: 'Approved', label: 'Made-up one', std: '1 pc' }) };
    const env = await writerEnv('president', { 'kc_config/list_prices': { v: 1, effective: '2026-11-19', rows }, 'kc_materials/sh12': { key: 'sh12', p: 321, hist: [] } });
    await env.KCLive.load();
    assert.equal(env.KC.listRow('T-001').status, 'Approved');
    await env.KCLive.saveListPrices({ 'T-001': 120 });
    assert.equal(env.win.db.store.get('kc_config/list_prices').rows['T-001'].status, 'Approved'); assert.equal(env.KC.listRow('T-001').price, 120);
  });
  it('the Standard price list screen shows Approved: its own colour, its own count button that filters by it, its tooltip, and the status is on no printed block', async () => {
    const env = readyEnv('president');
    env.KC.LISTP['T-001'] = { price: 100, perMetre: null, status: 'Approved', label: 'Made-up one', std: '1 pc' };
    env.KC.LISTP['T-002'] = { price: 200, perMetre: null, status: 'Data', label: 'Made-up two', std: '2 pc' };
    env.KC.LISTP['T-003'] = { price: 300, perMetre: null, status: 'Approved', label: 'Made-up three', std: '3 pc' };
    const host = { innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, hidden: false, querySelector: () => null, querySelectorAll: () => [], contains: () => false };
    env.els.set('scrSettings', host);
    vm.runInContext(fs.readFileSync(path.join(QB, 'kc/admin-d7.js'), 'utf8'), env.ctx, { filename: 'kc/admin-d7.js' });
    env.KC.renderSettings();
    const html = host.innerHTML;
    assert.match(html, /<span class="kc-adm-st kc-adm-st-appr" title="The owner has confirmed this price\.">Approved<\/span>/, 'the row chip');
    assert.equal((html.match(/kc-adm-st kc-adm-st-appr" title="[^"]*">Approved</g) || []).length, 2, 'one chip for each of the two approved rows');
    assert.match(html, /<button type="button" class="kc-adm-st kc-adm-st-appr kc-adm-stbtn" data-lpst="Approved"[^>]*>Approved 2<\/button>/, 'the count button of the filter');
    assert.match(html, /<span class="kc-adm-st kc-adm-st-data" title="[^"]*">Data<\/span>/, 'the other statuses are as they were');
    assert.match(fs.readFileSync(path.join(QB, 'kc/admin-d7.js'), 'utf8'), /\.kc-adm-st-appr\{background:#[0-9a-f]{6};color:#[0-9a-f]{6};border-color:#[0-9a-f]{6};\}/, 'the chip has its colours');
    // never printed: a list-priced line prints no status word, whatever the row says
    const line = addChef(env); const it = itemsOf(env)[0]; env.KC.LISTP['CK-HP-4'] = { price: 50000, perMetre: null, status: 'Approved', label: 'x', std: '' }; env.D7.adapter.repriceAll(); void line;
    const printed = env.D7.h('doc.printBlock', it, 0) + env.D7.h('doc.workforceBlock', it, 0) + JSON.stringify(plain(env.D7.h('adapter.publicItem', it)));
    assert.doesNotMatch(printed, /Approved/, 'the status is staff only');
  });
});

describe('KCLive.saveMaterial / saveSettings / saveListPrices / saveSwitch', () => {
  it('a changed price appends one history entry (newest last, at most 20) and updates the row in memory', async () => {
    const hist = Array.from({ length: 20 }, (_, i) => ({ d: '2026-11-0' + (i % 9 + 1), p: i + 1, by: 'x' }));
    const env = await writerEnv('purchasing', { 'kc_materials/sh12': { key: 'sh12', p: 20, source: 'Sample', hist } });
    const r = await env.KCLive.saveMaterial('sh12', { p: 456.789 });
    const d = env.win.db.store.get('kc_materials/sh12');
    assert.equal(d.p, 456.79); assert.equal(d.source, 'Manual'); assert.equal(d.hist.length, 20); assert.equal(d.hist[19].p, 456.79); assert.equal(d.hist[19].by, 'purchasing Name'); assert.equal(d.hist[0].p, 2);
    assert.equal(d.updatedBy, 'u-purchasing'); assert.equal(d.key, 'sh12'); assert.equal(d.v, 1, 'every document carries v 1 (the rules of kc_config ask for it; one shape for all of them)');
    assert.equal(env.KC.P.sh12.p, 456.79); assert.equal(r.p, 456.79);
    await env.KCLive.saveMaterial('sh12', { p: 456.79 });
    assert.equal(env.win.db.store.get('kc_materials/sh12').hist.length, 20, 'the same price adds no entry');
    await env.KCLive.saveMaterial('sh12', { p: null });
    assert.equal(env.win.db.store.get('kc_materials/sh12').p, null); assert.equal(env.KC.P.sh12.p, null, 'blank is no price, never zero');
  });
  it('a rating change is its own history entry, and a row added from the screen is created', async () => {
    const env = await writerEnv('president');
    await env.KCLive.saveMaterial('sir2', { hp: 3, cfm: 4400, sp: 1.2, ratingNote: '3 HP, 4400 CFM' });
    const d = env.win.db.store.get('kc_materials/sir2');
    assert.deepEqual([d.hp, d.cfm, d.sp], [3, 4400, 1.2]); assert.deepEqual(plain(d.hist.map(h => h.note)), ['rating changed']); assert.equal(d.hist[0].rating, '3 HP, 4400 CFM'); assert.equal(env.KC.P.sir2.hp, 3);
    await env.KCLive.saveMaterial('zz_added', { p: 9, l: 'Added thing', u: 'set', cat: 'Fixtures', grade: 'x', size: 'y' });
    assert.equal(env.KC.P.zz_added.l, 'Added thing'); assert.equal(env.KC.P.zz_added.p, 9); assert.deepEqual(plain(env.KC.PL_INFO.zz_added), ['Fixtures', 'x', 'y']);
    const added = env.win.db.store.get('kc_materials/zz_added');
    assert.equal(added.v, 1); assert.equal(added.key, 'zz_added', 'key = the document id (the rules)'); assert.deepEqual(plain(added.hist.map(h => h.p)), [9], 'a new row without a history: its first price is the first entry'); assert.equal(added.updatedBy, 'u-president');
  });
  it('who may change a price, and what is refused', async () => {
    for (const role of ['sales', 'manager']) { const e = await writerEnv(role); await assert.rejects(() => e.KCLive.saveMaterial('sh12', { p: 1 }), /Only the President and Purchasing/); assert.equal(e.win.db.writes.length, 0); }
    const env = await writerEnv('president');
    await assert.rejects(() => env.KCLive.saveMaterial('Bad Key', { p: 1 }), /not a valid material key/);
    await assert.rejects(() => env.KCLive.saveMaterial('sh12', { p: -1 }), /number of 0 or more/); await assert.rejects(() => env.KCLive.saveMaterial('sh12', { p: 'abc' }), /number of 0 or more/);
    await assert.rejects(() => env.KCLive.saveMaterial('sir2', { hp: -2 }), /rating/);
    assert.equal(env.win.db.writes.length, 0);
  });
  it('saveSettings merges numbers into the stored settings, refuses what is not a setting, and updates KC.SET', async () => {
    const env = await writerEnv('president', { 'kc_config/settings': { v: 1, br: { simple: 30, medium: 50, complex: 70 }, misc: 10, markup: 2, corner: 1500, hood: { overhang: 15 }, duct: { fpm: 1800 }, floorMode: 'list' } });
    const r = await env.KCLive.saveSettings({ br: { medium: 55 }, markup: 2.2, corner: 1600, duct: { loss: { perM: 0.03 } }, floorMode: 'formula' });
    const d = env.win.db.store.get('kc_config/settings');
    assert.equal(d.br.medium, 55); assert.equal(d.br.simple, 30); assert.equal(d.markup, 2.2); assert.equal(d.corner, 1600); assert.equal(d.duct.loss.perM, 0.03); assert.equal(d.duct.fpm, 1800); assert.equal(d.floorMode, 'formula'); assert.equal(d.v, 1); assert.equal(d.updatedBy, 'u-president');
    assert.equal(env.KC.SET.br.medium, 55); assert.equal(env.KC.SET.markup, 2.2); assert.equal(env.KC.FLOOR_MODE, 'formula'); assert.equal(r.markup, 2.2);
    for (const [bad, msg] of [[{ markup: 0.9 }, /1 to 10/], [{ markup: 11 }, /1 to 10/], [{ misc: -1 }, /0 or more/], [{ nope: 1 }, /not a pricing setting/], [{ br: { huge: 1 } }, /not a pricing setting/], [{ br: 5 }, /group of numbers/], [{ floorMode: 'sometimes' }, /list or formula/], [{ misc: 'x' }, /number/]])
      await assert.rejects(() => env.KCLive.saveSettings(bad), msg);
    const s = await writerEnv('sales'); await assert.rejects(() => s.KCLive.saveSettings({ misc: 5 }), /Only the President/);
  });
  it('saveSettings with no document yet writes the whole settings (markup included: the rules need it)', async () => {
    const env = await writerEnv('president'); await env.KCLive.saveSettings({ misc: 12 });
    const d = env.win.db.store.get('kc_config/settings');
    assert.equal(d.misc, 12); assert.equal(d.markup, 2); assert.deepEqual(plain(d.br), { simple: 30, medium: 50, complex: 70 }); assert.equal(d.floorMode, 'list'); assert.equal(d.corner, null);
  });
  it('saveListPrices sets a price above 0, removes a code with null, and keeps the others', async () => {
    const env = await writerEnv('president', { 'kc_config/list_prices': { v: 1, effective: '2026-11-19', rows: { 'CK-HP-4': 25000, 'CK-LP-2': 20000 } } });
    await env.KCLive.saveListPrices({ 'CK-HP-4': 26000, 'CK-LP-2': null, 'CK-NEW': 31000 });
    assert.deepEqual(plain(env.win.db.store.get('kc_config/list_prices').rows), { 'CK-HP-4': 26000, 'CK-NEW': 31000 }); assert.deepEqual(plain(env.KC.LISTP), { 'CK-HP-4': 26000, 'CK-NEW': 31000 });
    assert.equal(env.win.db.store.get('kc_config/list_prices').effective, '2026-11-19'); assert.equal(env.win.db.store.get('kc_config/list_prices').updatedBy, 'u-president');
    await assert.rejects(() => env.KCLive.saveListPrices({ 'CK-HP-4': 0 }), /above 0/); await assert.rejects(() => env.KCLive.saveListPrices({ 'a/b': 5 }), /valid code/);
    const s = await writerEnv('purchasing'); await assert.rejects(() => s.KCLive.saveListPrices({ 'CK-HP-4': 1 }), /Only the President/);
  });
  it('saveSwitch writes only what it is given, validates the values, and the flags follow', async () => {
    const env = await writerEnv('president');
    const f = await env.KCLive.saveSwitch({ kcMode: 'president', approvalBelowStandard: 'tick' });
    const d = env.win.db.store.get('settings/quote_builder');
    assert.equal(d.kcMode, 'president'); assert.equal(d.approvalBelowStandard, 'tick'); assert.equal('approveAll' in d, false); assert.equal(d.updatedByName, 'president Name'); assert.ok(d.updatedAt);
    assert.deepEqual(plain(f), { kcMode: 'president', approveAll: false, approvalBelowStandard: 'tick', catalogueCostPricing: false }); assert.equal(env.KCLive.flags.kcMode, 'president');
    for (const bad of [{ kcMode: 'all' }, { approveAll: 'yes' }, { approvalBelowStandard: 'x' }, { catalogueCostPricing: 1 }, {}, null]) await assert.rejects(() => env.KCLive.saveSwitch(bad));
    const s = await writerEnv('sales'); await assert.rejects(() => s.KCLive.saveSwitch({ kcMode: 'on' }), /Only the President/);
  });
});

// ═════════════════════════════ the approval link, the screen buttons ═════════════════════════════
describe('the approval link and the screens', () => {
  const withModal = env => {
    const el = () => ({ innerHTML: '', textContent: '', style: {}, hidden: true, className: '', dataset: {}, focus() {}, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } });
    for (const id of ['d7Modal', 'd7ModalTitle', 'd7ModalBody', 'd7ModalFoot', 'd7ModalCard']) env.els.set(id, el());
    return env;
  };
  it('the layer no longer draws an approval-link panel (QUOTE-APPROVAL-LINK-SPEC-2026-11-20: the link is the app shell\'s window, js/app.js showQuoteApprovalLink, and points at the quote itself, not at the Approvals list)', () => {
    const env = withModal(readyEnv('sales')); addSink(env, 2); customLineOf(env);
    assert.equal(env.D7.flow.showApprovalLink, undefined, 'F.showApprovalLink is gone');
    assert.equal(env.D7.flow.approvalsLink, undefined, 'F.approvalsLink is gone');
    assert.ok(!env.D7.h('flow.showApprovalLink', { quoteNumber: 'Q<b>1', clientName: '<img src=x>', grandTotal: 10 }), 'a hook that is not there does nothing');
    assert.equal(env.els.get('d7Modal').hidden, true, 'no panel opened');
    assert.equal(env.els.get('d7ModalBody').innerHTML, '', 'nothing was drawn into the modal body');
    const flowSrc = fs.readFileSync(path.join(ROOT, 'qb/d7/d7-flow.js'), 'utf8');
    assert.equal(/showApprovalLink|approvalsLink|#\/approvals|lastSent|sentFrom/.test(flowSrc), false, 'no trace of the old panel in d7-flow.js');
    assert.match(flowSrc, /function ensureModal\(\)/, 'the inert modal helpers stay (smaller diff in a tested file)');
  });
  it('the two screen buttons are for the President and Purchasing only (the bar was crowded: Fable review F8), whatever the quote; nothing is drawn when the feature is not live', () => {
    const off = (role, kc) => { const e = readyEnv(role); e.run(`quoteEngine = "${kc ? 'kc1' : 'legacy'}"`); return e.D7.flow.wantsButtons(); };
    assert.equal(off('president', false), true); assert.equal(off('purchasing', false), true);
    assert.equal(off('sales', false), false, 'Sales and Operations see today\'s builder, byte for byte, while the switch is off'); assert.equal(off('manager', false), false);
    for (const role of ['president', 'purchasing']) assert.equal(off(role, true), true, role);
    for (const role of ['sales', 'manager']) assert.equal(off(role, true), false, role + ' has no buttons on a KC quote either: they cannot change anything on either screen');
    const dead = makeEnv({ without: ['d7/d7-pricing.js'] }); dead.run('quoteEngine = "kc1"');
    assert.equal(dead.D7.flow ? !!(dead.D7.flow.wantsButtons && dead.D7.flow.wantsButtons()) : false, false, 'nothing is drawn when the feature is not live');
  });
});
function customLineOf(env) { env.KC.addLine('custom', { cat: 'prep', name: 'Cart', desc: '', dims: '', rows: [{ k: 'sh12', q: 1 }], m: null, lab: 50 }, { render: false }); }

// ═════════════════════════════ the files themselves ═════════════════════════════
describe('the bridge files: no prototype leftovers, no price, the service worker lists them', () => {
  const MINE = ['kc-live.js', 'd7/d7-core.js', 'd7/d7-adapter.js', 'd7/d7-pricing.js', 'd7/d7-doc.js', 'd7/d7-doc.css', 'd7/d7-flow.js', 'd7/d7-flow.css', 'kc/host-d7.js', 'kc/kc-d7.css'];
  const read = f => fs.readFileSync(path.join(QB, f), 'utf8');
  it('nothing of the prototype\'s own tooling is left (no stub, no seed, no local parent, no d7qb_ key, no prototype bar)', () => {
    for (const f of MINE) {
      const t = read(f);
      for (const bad of ['D7_STUB', 'D7_SEED_DATA', 'd7qb_', 'D7.post(', 'D7.reply(', 'D7.onPost', 'D7.setRole', 'd7Bar', 'd7NetChip', 'seed-data', 'firebase-stub'])
        assert.equal(t.includes(bad), false, f + ' still has ' + bad);
    }
    assert.equal(read('d7/d7-pricing.js').includes('checks'), false, 'the in-browser checks are node tests now');
    assert.equal(/loadSample|Load sample/.test(read('d7/d7-adapter.js')), false);
  });
  it('no peso figure, no comma-grouped number and no "want:" table in any bridge file (the repository is public)', () => {
    for (const f of MINE) read(f).split('\n').forEach((line, i) => {
      assert.doesNotMatch(line, /₱\s*[0-9]|PHP\s*[0-9]|\b[0-9]{1,3}(,[0-9]{3})+\b|want:/, f + ':' + (i + 1) + ': ' + line.slice(0, 120));
    });
  });
  it('never "Official Receipt" or "Sales Invoice" (the Forms Standard)', () => {
    for (const f of MINE) assert.doesNotMatch(read(f), /official\s+receipt|sales\s+invoice/i, f);
  });
  it('every string a line carries into the page is escaped on its way out (the rows of the table, the link panel)', () => {
    const doc = makeEnv().D7.doc;
    const html = doc.blockHtml({ material: '<b>x</b>', use: '', title: '<img src=x onerror=1>', sub: '', dims: '"q"', specs: '<script>1</script>', notes: ['a&b'], includes: [], excludes: [] });
    assert.doesNotMatch(html, /<img|<script|<b>x/); assert.match(html, /&lt;img/);
  });
  it('sw.js lists every file of the set once, bare, right after js/qb-spec-sheet.js: the 13 lines (the engine as its one bundle, never its sources), and each exists', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const want = ['/qb/kc-rules.js', '/qb/kc-live.js', '/qb/kc.min.js', '/qb/kc/host-d7.js', '/qb/kc/kc-d7.css', '/qb/kc/admin-d7.js', '/qb/d7/d7-core.js', '/qb/d7/d7-adapter.js',
      '/qb/d7/d7-pricing.js', '/qb/d7/d7-doc.js', '/qb/d7/d7-doc.css', '/qb/d7/d7-flow.js', '/qb/d7/d7-flow.css'];
    const block = sw.slice(sw.indexOf("  '/js/qb-spec-sheet.js',\n") + "  '/js/qb-spec-sheet.js',\n".length);
    assert.equal(block.startsWith(want.map(f => `  '${f}',\n`).join('')), true, 'the 13 lines, in order, one bare literal each');
    for (const f of want) { assert.equal(sw.split(`'${f}'`).length - 1, 1, f + ' once'); assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists'); }
    for (const src of ['core', 'materials', 'library', 'draw-table', 'product-table', 'product-sink', 'product-hood', 'product-duct', 'product-storage', 'product-cart', 'draw-chef', 'product-chef'])
      assert.equal(sw.includes(`'/qb/kc/${src}.js'`), false, 'the engine sources are private (Addendum 1 A9): ' + src);
  });
  it('the header names the horizontal Barro Industries logo of the Sales flow branch by its path (that branch ships the file and its precache line)', () => {
    assert.match(read('d7/d7-doc.js'), /logo: 'icons\/barro-industries-horizontal\.png'/);
  });
});


// ═════════════════════════════ the Forms Standard (spec 3.7, Addendum 1 A5, the header ruling) ═════════════════════════════
describe('Forms Standard: the header, the Prepared by box, the file name', () => {
  const field = (env, id, value) => env.els.set(id, { value, innerHTML: '', style: {}, dataset: {} });
  // a very small DOM for the signature row: just what the bridge touches (document.querySelector('#termsSection > .sig-row'), getElementById('sigClientName'), createElement('template'), insertBefore, appendChild, classList)
  const classList = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) }; };
  function sigRow(env) {
    const row = { children: [], classList: classList(), get firstChild() { return this.children[0] || null; },
      insertBefore(n, ref) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); this.children.splice(ref ? this.children.indexOf(ref) : this.children.length, 0, n); n.parentNode = this; return n; },
      appendChild(n) { return this.insertBefore(n, null); } };
    const own = name => ({ classList: { contains: () => false }, own: name, parentNode: row });
    row.children.push(own('conforme'), own('approved'));                                          // today's two boxes (Conforme — Accepted by Client, Reviewed and Approved by)
    env.els.set('sigClientName', { parentNode: row.children[0] });                                // #sigClientName sits inside the Conforme box
    const mkBox = html => {
      const m = /<div class="sig-name">([^<]*)<\/div>/.exec(html), nm = { textContent: m ? m[1] : '' };
      const box = { html, nm, parentNode: row, classList: { contains: c => c === 'd7-sig-prep' || c === 'sig-box' }, querySelector: s => (s === '.sig-name' ? nm : null), remove() { row.children.splice(row.children.indexOf(box), 1); box.parentNode = null; } };
      return box;
    };
    const d = env.win.document, makeEl = d.createElement;
    d.querySelector = sel => (sel === '#termsSection > .sig-row' ? row : null);
    d.createElement = tag => {
      if (tag !== 'template') return makeEl(tag);
      const t = { _h: '', content: { get firstElementChild() { return mkBox(t._h); } } };
      Object.defineProperty(t, 'innerHTML', { set(h) { t._h = h; } });
      return t;
    };
    return row;
  }
  it('the file is named by the quote number and nothing else: no "Rev." label, the R suffix is part of the number, no character a file name cannot hold', () => {
    const doc = makeEnv().D7.doc;
    assert.equal(doc.fileName('BKMLFB261118-002R1'), 'BKMLFB261118-002R1'); assert.equal(doc.fileName('BKMLFB261118-002R3'), 'BKMLFB261118-002R3');
    assert.equal(doc.fileName('A/B:C*?"<>|D R2'), 'A B C D R2'); assert.equal(doc.fileName(''), 'Quotation');
    assert.equal(doc.pdfName('BKMLFB261118-002R1'), 'BKMLFB261118-002R1.pdf'); assert.equal(doc.pdfName(''), 'Quotation.pdf');
    assert.equal(doc.revOf, undefined, 'there is no revision label to compute');
  });
  it('the header: the horizontal logo top left with the company lines under it, QUOTATION / the number as it is / the date top right, every string escaped', () => {
    const doc = makeEnv().D7.doc;
    const h = doc.headerHtml({ no: 'BKMLFB261118-002R2', date: '2026-11-18', tags: ['WORKFORCE COPY — NO PRICES'], co: 'BI' });
    assert.match(h, /<img class="d7-lh-logo" src="icons\/barro-industries-horizontal\.png" alt="Barro Industries OPC"/);
    assert.ok(h.indexOf('d7-lh-id') < h.indexOf('d7-lh-logo') && h.indexOf('d7-lh-logo') < h.indexOf('d7-lh-co') && h.indexOf('d7-lh-co') < h.indexOf('d7-lh-doc'), 'logo, then the company lines under it, then the document block');
    const lines = [...h.matchAll(/<div class="d7-lh-(?:name|line)">([^<]*)<\/div>/g)].map(m => m[1]);
    assert.deepEqual(lines, ['Barro Industries OPC', '21 Capricorn St., Tandang Sora, Quezon City', '0927 683 6300 · hello@barroindustries.com · barroindustries@gmail.com'], 'the company lines and both emails');
    assert.match(h, /<div class="d7-lh-title">QUOTATION<\/div><div class="d7-lh-no">BKMLFB261118-002R2<\/div><div class="d7-lh-date">November 18, 2026<\/div><div class="lh-docmeta">WORKFORCE COPY — NO PRICES<\/div>/);
    assert.doesNotMatch(h, /Rev\.|d7-lh-rev/, 'the number is printed as it is: there is no separate Rev. label');
    assert.doesNotMatch(doc.headerHtml({ no: '<b>x</b>R1', tags: ['<i>t</i>'] }), /<b>x|<i>t/);
  });
  it('brand ruling (owner 2026-11-20): a Barro Kitchens quote leads with the Barro Kitchens mark and name, "By Barro Industries OPC" is the legal company line under it; no Barro Industries logo and no second tile; Barro Industries keeps its own mark', () => {
    const doc = makeEnv().D7.doc;
    const bk = doc.headerHtml({ no: 'BKX-1R1', co: 'BK' });
    assert.match(bk, /^<div class="d7-lh d7-lh--bk"><div class="d7-lh-id"><div class="d7-lh-brand"><img class="d7-lh-bkmark" src="icons\/barro-kitchens\.png" alt="Barro Kitchens"/);
    assert.match(bk, /<div class="d7-lh-brandname">BARRO KITCHENS<\/div><div class="d7-lh-legal">By Barro Industries OPC<\/div>/);
    assert.ok(bk.indexOf('d7-lh-brand') < bk.indexOf('d7-lh-co') && bk.indexOf('d7-lh-co') < bk.indexOf('d7-lh-doc'), 'brand, then the company lines, then the document block');
    assert.match(bk, /21 Capricorn St\., Tandang Sora, Quezon City/); assert.match(bk, /hello@barroindustries\.com · barroindustries@gmail\.com/);
    assert.doesNotMatch(bk, /barro-industries-horizontal|d7-lh-tile|d7-lh-logo|d7-lh-name/, 'no Barro Industries logo, no tile, no separate company name line');
    const bi = doc.headerHtml({ no: 'BIX-1R1', co: 'BI' });
    assert.match(bi, /d7-lh-logo" src="icons\/barro-industries-horizontal\.png"/); assert.doesNotMatch(bi, /d7-lh--bk|d7-lh-brand|BARRO KITCHENS/, 'Barro Industries: its own mark only');
    const env = makeEnv(); env.run('var currentCo = "BI"'); assert.doesNotMatch(env.D7.doc.headerHtml({ no: 'X' }), /d7-lh-brand/, 'no co handed over: the company of the page');
    env.run('currentCo = "BK"; var CO = { BK: { logo: "icons/own-tile.png" } }'); assert.match(env.D7.doc.headerHtml({ no: 'X' }), /d7-lh-bkmark" src="icons\/own-tile\.png"/, 'the page\'s own CO.BK.logo');
    env.run('CO.BK.logo = "https://evil.example/t.png"'); assert.match(env.D7.doc.headerHtml({ no: 'X' }), /src="icons\/barro-kitchens\.png"/, 'a logo from another site is refused');
  });
  it('header(state): a KC quote gets the Forms Standard header from what the page hands the letterhead engine; anything else gets "" (the old letterhead stays)', () => {
    const env = readyEnv('sales'); field(env, 'quoteNo', 'BKTEST261119-001R1'); field(env, 'quoteDate', '2026-11-19');
    const h = env.D7.h('doc.header', { docNumber: 'BKTEST261119-009R3', extraMeta: ['AGENT COPY — CONFIDENTIAL'], dateLabel: 'ignored', co: 'BK' });
    assert.match(h, /d7-lh-no">BKTEST261119-009R3</); assert.doesNotMatch(h, /Rev\./); assert.match(h, /November 19, 2026/); assert.match(h, /AGENT COPY — CONFIDENTIAL/); assert.match(h, /d7-lh-brandname">BARRO KITCHENS/);
    assert.doesNotMatch(env.D7.h('doc.header', { docNumber: 'BIX-1R1', co: 'BI' }), /d7-lh-brand/);
    assert.match(env.D7.h('doc.header', {}), /BKTEST261119-001R1/, 'no number handed over: the box of the page');
    env.run('quoteEngine = "legacy"'); assert.equal(env.D7.h('doc.header', { docNumber: 'X' }), '');
    env.run('quoteEngine = "kc1"; currentCo = "BS"'); assert.equal(env.D7.h('doc.header', { docNumber: 'X' }), '', 'Brilliance Steel keeps its own letterhead');
  });
  it('Prepared by: one box added to today\'s signature row, first, with the salesperson; the order is Prepared by, Approved by, Client conforme (the client\'s box goes last); the two boxes of the page are the same nodes; it follows the field and goes away with the mode', () => {
    const env = readyEnv('sales'); field(env, 'salesperson', 'Rene Cruz'); const row = sigRow(env); const own = row.children.slice(), [conforme, approved] = own;
    const order = () => row.children.map(b => b === conforme ? 'conforme' : b === approved ? 'approved' : b.classList.contains('d7-sig-prep') ? 'prepared' : '?');
    env.D7.doc.sync();
    assert.equal(row.children.length, 3); assert.equal(row.children[0].classList.contains('d7-sig-prep'), true, 'first');
    assert.match(row.children[0].html, /^<div class="sig-box d7-sig-prep"><div class="sig-role">Prepared by<\/div><div style="height:34px;"><\/div><div class="sig-name">Rene Cruz<\/div><small>Sales<\/small><\/div>$/, 'the same look as the page\'s own boxes');
    assert.deepEqual(order(), ['prepared', 'approved', 'conforme'], 'QA D7 / A5: Prepared by, Approved by, Client conforme');
    assert.deepEqual(row.children.slice(1), [approved, conforme], 'today\'s two boxes: the same nodes, the client\'s now last'); assert.equal(row.classList.contains('d7-sig3'), true, 'three boxes on a row');
    env.D7.doc.sync(); assert.deepEqual(order(), ['prepared', 'approved', 'conforme'], 'idempotent: nothing is moved twice'); assert.equal(row.children.length, 3);
    field(env, 'salesperson', 'Rene <b>'); env.D7.doc.sync(); assert.equal(row.children.length, 3, 'not added twice'); assert.equal(row.children[0].nm.textContent, 'Rene <b>', 'the name follows the field, as text'); assert.deepEqual(order(), ['prepared', 'approved', 'conforme']);
    field(env, 'salesperson', ''); env.D7.doc.sync(); assert.equal(row.children[0].nm.textContent, '', 'an unknown name leaves the line empty: no placeholder');
    env.run('quoteEngine = "legacy"'); env.D7.doc.sync();
    assert.deepEqual(row.children, own, 'a legacy quote: the row is as the page made it, Conforme first again'); assert.equal(row.classList.contains('d7-sig3'), false);
    env.run('quoteEngine = "kc1"'); env.D7.doc.sync(); assert.deepEqual(order(), ['prepared', 'approved', 'conforme'], 'back to a KC quote');
    env.run('currentCo = "BS"'); env.D7.doc.sync(); assert.deepEqual(row.children, own, 'Brilliance Steel: the page\'s own row, in the page\'s own order');
    const bs = readyEnv('sales'); const bsRow = sigRow(bs); bs.run('currentCo = "BS"'); bs.D7.doc.sync(); assert.deepEqual(bsRow.children.map(b => b.own), ['conforme', 'approved'], 'a Brilliance Steel quote never gets a Prepared by box or a new order');
    assert.equal(sigRow(env).children.length, 2, 'Brilliance Steel: untouched');
  });
  it('the order is also set when the page asks for the header (print, preview, company switch): doc.header runs the same sync, and a row whose client box cannot be told is left as the page made it', () => {
    const env = readyEnv('sales'); field(env, 'salesperson', 'Rene Cruz'); field(env, 'quoteNo', 'BKTEST261119-001R1'); const row = sigRow(env); const [conforme, approved] = row.children.slice();
    env.D7.h('doc.header', { docNumber: 'BKTEST261119-001R1', co: 'BK' });
    assert.equal(row.children.length, 3); assert.deepEqual(row.children.slice(1), [approved, conforme]);
    const blind = readyEnv('sales'); field(blind, 'salesperson', 'Rene Cruz'); const r2 = sigRow(blind); blind.els.delete('sigClientName'); const orig = r2.children.slice();
    blind.D7.doc.sync(); assert.equal(r2.children.length, 3, 'Prepared by is still added'); assert.deepEqual(r2.children.slice(1), orig, 'the two boxes keep the page\'s order when the client box is not found');
  });
  it('the name in the print dialog is the quote number; agent and workforce copies, legacy quotes and Brilliance Steel keep their names', () => {
    const seen = [];
    const env = makeEnv({ print: () => { seen.push(env.win.document.title); } });
    env.win.document.title = 'Page'; field(env, 'quoteNo', 'BKTEST261119-001R2');
    live(env);
    env.win.print(); assert.equal(seen[0], 'BKTEST261119-001R2');
    const restore = env.timers.filter(t => t.ms === 60000 && t.fn).pop(); assert.ok(restore, 'the title is put back after the dialog (afterprint, or the 60 s timer)'); restore.fn();
    assert.equal(env.win.document.title, 'Page');
    env.body.classList.add('body-workforce'); env.win.print(); assert.equal(seen[1], 'Page', 'workforce copy: its own name'); env.body.classList.remove('body-workforce');
    env.body.classList.add('body-agent'); env.win.print(); assert.equal(seen[2], 'Page'); env.body.classList.remove('body-agent');
    env.run('quoteEngine = "legacy"'); env.win.print(); assert.equal(seen[3], 'Page');
    env.run('quoteEngine = "kc1"; currentCo = "BS"'); env.win.print(); assert.equal(seen[4], 'Page');
  });
  it('the page\'s own letterhead is replaced by the safety net when the page did not do it, and updatePrintHeader still runs', () => {
    const env = live(makeEnv()); const box = { innerHTML: '', querySelector: () => null }; env.els.set('lhPrintHeader', box); field(env, 'quoteNo', 'BKTEST261119-003R1');
    env.run('applyLetterheadHeader()');
    assert.match(box.innerHTML, /d7-lh-title">QUOTATION/); assert.match(box.innerHTML, /BKTEST261119-003R1/);
    env.run('quoteEngine = "legacy"; applyLetterheadHeader()'); assert.equal(box.innerHTML, '<div class="lh-header">old letterhead</div>');
    env.run('updatePrintHeader()'); assert.equal(env.run('__uph'), 1, 'the page\'s own function still runs');
  });
  it('safeSrc: a data / blob image, a relative path, an https image from this site or the company\'s Firebase Storage; nothing else', () => {
    const { safeSrc } = makeEnv().D7.doc;
    for (const ok of ['data:image/png;base64,AAAA', 'blob:https://ops.example.test/1', 'icons/x.png', 'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media', 'https://storage.googleapis.com/b/o', 'https://ops.example.test/img.png'])
      assert.equal(safeSrc(ok), ok, ok);
    for (const bad of ['https://evil.example/a.png', 'http://firebasestorage.googleapis.com/x', '//evil.example/a.png', 'javascript:alert(1)', 'data:text/html;base64,AAAA', 'ftp://x/y', '']) assert.equal(safeSrc(bad), '', bad);
  });
});

// ═════════════════════════════ Download PDF: the one function behind every button, the form engine, the fallback ═════════════════════════════
describe('Download PDF: D7.doc.downloadPdf()', () => {
  const field = (env, id, value) => env.els.set(id, { value, innerHTML: '', style: {}, dataset: {} });
  function pdfEnv(o = {}) {
    const calls = { print: 0, verify: 0, dl: [], disposed: 0 };
    const env = live(makeEnv({ print: () => { calls.print++; } }));
    field(env, 'quoteNo', 'BKTEST261119-001R1');
    env.run('var quoteStatus = "filed"; var doVerifyAndFile = function () { __verify++; }; var __verify = 0;');
    env.win.__verifyCalls = () => env.run('__verify');
    env.D7.doc.buildA4 = async () => (o.build ? o.build(calls) : { ok: true, node: { node: 'the A4 container' }, pages: 2, dispose() { calls.disposed++; } });      // the layout is checked in a browser (tests/a4: the real page); the bridge is checked here
    if (o.engine !== null) env.win.FormsPdf = { download: o.engine || (async (node, name, opts) => { calls.dl.push([node, name, opts]); return { ok: true, fileName: name }; }) };
    return { env, calls, toasts: () => plain(env.run('__toasts')).map(t => t[0]) };
  }
  it('a filed KC quote: FormsPdf.download gets the A4 container and "<quote number>.pdf"; the container is taken out again; no print dialog; "PDF saved" in plain words', async () => {
    const { env, calls, toasts } = pdfEnv();
    const r = await env.D7.doc.downloadPdf();
    assert.deepEqual(plain(r), { ok: true, fileName: 'BKTEST261119-001R1.pdf' });
    assert.equal(calls.dl.length, 1); assert.deepEqual(plain(calls.dl[0][0]), { node: 'the A4 container' }); assert.equal(calls.dl[0][1], 'BKTEST261119-001R1.pdf');
    assert.equal(calls.disposed, 1, 'the off-screen pages are removed once the engine has finished'); assert.equal(calls.print, 0);
    assert.ok(toasts().some(t => /^PDF saved: BKTEST261119-001R1\.pdf\.$/.test(t)), toasts().join(' | '));
  });
  it('the real form engine re-cuts whatever it is given at table rows unless told otherwise: the call names the A4 page containers as the only cut points and switches keep-with-next off (a mis-paginated PDF otherwise)', async () => {
    const { env, calls } = pdfEnv();
    await env.D7.doc.downloadPdf();
    const opts = plain(calls.dl[0][2]);
    assert.ok(opts && typeof opts === 'object', 'FormsPdf.download is called with options');
    assert.equal(opts.cutSelector, '.d7-a4-page', 'the page containers are the cut points: the engine default (tr, .section, .sig-row ...) would cut inside a page');
    assert.equal(typeof opts.keepNextSelector, 'string'); assert.ok(opts.keepNextSelector.length > 0, 'an empty selector would fall back to the engine default keep list');
    assert.ok(!/\b(tr|thead|\.sec-title|\.cat-row|\.sig-row)\b/.test(opts.keepNextSelector), 'the keep-with-next selector names nothing the document contains');
    // the class the selector names is the class buildA4 gives every page (one source file: the selector cannot drift from the pages)
    const SRC = fs.readFileSync(new URL('../qb/d7/d7-doc.js', import.meta.url), 'utf8');
    assert.ok(/page\.className = 'd7-a4-page'/.test(SRC), 'buildA4 still writes class d7-a4-page on every page');
  });
  it('without the form engine the print dialog opens instead, and a toast says so in plain words; it never throws', async () => {
    const { env, calls, toasts } = pdfEnv({ engine: null });
    const r = await env.D7.doc.downloadPdf();
    assert.equal(r.ok, false); assert.equal(r.fileName, 'BKTEST261119-001R1.pdf'); assert.equal(calls.print, 1); assert.equal(calls.disposed, 0, 'nothing was built');
    assert.ok(toasts().some(t => /PDF maker is not available/.test(t) && /Save as PDF/.test(t)), toasts().join(' | '));
  });
  it('an engine that reports a failure, one that throws, and a layout that fails: the same fallback, the container is always taken out, and the call never rejects', async () => {
    for (const [name, o] of [['reports a failure', { engine: async () => ({ ok: false, error: 'canvas too large' }) }], ['throws', { engine: async () => { throw new Error('boom'); } }],
      ['returns nothing', { engine: async () => undefined }]]) {
      const { env, calls, toasts } = pdfEnv(o); const r = await env.D7.doc.downloadPdf();
      assert.equal(r.ok, false, name); assert.equal(calls.print, 1, name); assert.equal(calls.disposed, 1, name + ': disposed'); assert.ok(toasts().some(t => /could not be made/.test(t) && /Save as PDF/.test(t)), name + ': ' + toasts().join(' | '));
    }
    const failed = pdfEnv({ build: () => ({ ok: false, error: 'A line of the quote is taller than a page.' }) });
    let dl = 0; failed.env.win.FormsPdf = { download: async () => { dl++; return { ok: true }; } };
    const r = await failed.env.D7.doc.downloadPdf();
    assert.equal(r.ok, false); assert.equal(r.error, 'A line of the quote is taller than a page.'); assert.equal(dl, 0, 'no layout: the engine is not called'); assert.equal(failed.calls.print, 1);
    const thrown = pdfEnv({ build: () => { throw new Error('layout blew up'); } });
    assert.equal((await thrown.env.D7.doc.downloadPdf()).ok, false); assert.equal(thrown.calls.print, 1);
  });
  it('the gates of the page\'s doPrint(): an unfiled quote is filed first (nothing is made); the offline catalogue refuses; a legacy quote and Brilliance Steel are not served', async () => {
    const draft = pdfEnv(); draft.env.run('quoteStatus = "draft"');
    const r = await draft.env.D7.doc.downloadPdf();
    assert.equal(r.ok, false); assert.equal(draft.calls.dl.length, 0); assert.equal(draft.calls.print, 0); assert.equal(draft.env.run('__verify'), 1, 'Verify & File is started, as the old button did');
    assert.ok(draft.toasts().some(t => /file this quote before downloading the PDF/.test(t)), draft.toasts().join(' | '));
    const offline = pdfEnv(); offline.env.run('DB.pricesUnavailable = true');
    assert.equal((await offline.env.D7.doc.downloadPdf()).ok, false); assert.equal(offline.calls.dl.length, 0); assert.ok(offline.toasts().some(t => /Prices are unavailable/.test(t)));
    for (const set of ['quoteEngine = "legacy"', 'currentCo = "BS"']) {
      const e = pdfEnv(); e.env.run(set); const x = await e.env.D7.doc.downloadPdf();
      assert.equal(x.ok, false, set); assert.equal(e.calls.dl.length + e.calls.print, 0, set + ': nothing is made and nothing prints');
    }
  });
  it('the copy is the client copy: the agent and workforce states are taken off before the PDF is made', async () => {
    const { env } = pdfEnv(); env.body.classList.add('body-agent'); env.body.classList.add('body-workforce');
    await env.D7.doc.downloadPdf(); assert.equal(env.body.classList.contains('body-agent'), false); assert.equal(env.body.classList.contains('body-workforce'), false);
  });
  it('a second tap while the first is working changes nothing: the engine is called once', async () => {
    let release, dl = 0; const gate = new Promise(r => { release = r; });
    const { env } = pdfEnv({ engine: async (n, name) => { dl++; await gate; return { ok: true, fileName: name }; } });
    const first = env.D7.doc.downloadPdf(); await new Promise(r => setImmediate(r));
    const second = await env.D7.doc.downloadPdf(); assert.equal(second.ok, false); assert.match(second.error, /already being made/);
    release(); assert.equal((await first).ok, true); assert.equal(dl, 1);
    assert.equal((await env.D7.doc.downloadPdf()).ok, true, 'free again once it has finished');
  });
});

// ═════════════════════════════ the A4 pages: the packing step (pure) ═════════════════════════════
describe('the A4 pages: D7.doc.paginate packs units onto pages', () => {
  const U = (h, o = {}) => ({ h, keep: false, keepPrev: false, brk: false, frames: [], ...o });
  const pg = (env, units, H) => plain(env.D7.doc.paginate(units, H));
  const env = makeEnv();
  it('whole units only: a unit is never split, and a page is never taller than the page', () => {
    assert.deepEqual(pg(env, Array.from({ length: 10 }, () => U(100)), 450), { pages: [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]], overflow: false });
    assert.deepEqual(pg(env, [], 450), { pages: [[]], overflow: false }, 'nothing to print: one empty page, not a crash');
  });
  it('a table that runs over pages pays for its heading row on every page it opens on', () => {
    const table = { id: 1, ov: 50 };
    assert.deepEqual(pg(env, Array.from({ length: 7 }, () => U(100, { frames: [table] })), 350), { pages: [[0, 1, 2], [3, 4, 5], [6]], overflow: false }, '50 + 3 x 100 per page');
    const sect = { id: 2, ov: 20 }, tbl = { id: 3, ov: 30 };                                    // a section that holds the table: both frames are paid for when a page opens them, once
    assert.deepEqual(pg(env, [U(100, { frames: [sect, tbl] }), U(100, { frames: [sect, tbl] }), U(100, { frames: [sect, tbl] })], 340).pages, [[0, 1], [2]], '20 + 30 + 2 x 100 = 250: a third row makes 350, over 340');
  });
  it('a heading goes with the unit after it; a signature row and a footer go with the unit before them', () => {
    assert.deepEqual(pg(env, [U(300), U(100, { keep: true }), U(100)], 450).pages, [[0], [1, 2]], 'the heading is not left alone at the foot of a page');
    assert.deepEqual(pg(env, [U(250), U(100), U(100, { keepPrev: true })], 400).pages, [[0], [1, 2]], 'the signatures are never separated from the last terms');
    assert.deepEqual(pg(env, [U(250), U(100), U(100, { keepPrev: true }), U(60, { keepPrev: true })], 500).pages, [[0], [1, 2, 3]], 'and the thank-you footer follows them');
  });
  it('the Standard page and the photo annex start a page of their own', () => {
    assert.deepEqual(pg(env, [U(100), U(100, { brk: true }), U(100)], 450).pages, [[0], [1, 2]]);
    assert.deepEqual(pg(env, [U(100, { brk: true }), U(100)], 450).pages, [[0, 1]], 'nothing to break from at the top of the first page: no empty page');
  });
  it('a group taller than a page is split unit by unit; a unit taller than a page is reported (the pages would clip it)', () => {
    const r = pg(env, [U(200, { keep: true }), U(200, { keep: true }), U(200)], 450);
    assert.deepEqual(r.pages, [[0, 1], [2]]); assert.equal(r.overflow, false);
    const big = pg(env, [U(100), U(600), U(100)], 450); assert.equal(big.overflow, true);
  });
  it('for any heights: every unit once, in order, and no page over the height', () => {
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 60; round++) {
      const t = { id: 1, ov: 40 }, units = Array.from({ length: 5 + Math.floor(rnd() * 30) }, () => U(20 + Math.floor(rnd() * 200), { frames: rnd() < .7 ? [t] : [], keep: rnd() < .15, keepPrev: rnd() < .15, brk: rnd() < .05 }));
      const H = 450, r = pg(env, units, H), flat = r.pages.flat();
      assert.deepEqual(flat, units.map((_, i) => i), 'every unit once, in order');
      if (!r.overflow) r.pages.forEach(p => { let used = 0, prev = null; p.forEach(i => { const u = units[i], same = prev && prev.frames.length && u.frames.length && prev.frames[0].id === u.frames[0].id; used += u.h + (u.frames.length && !same ? u.frames[0].ov : 0); prev = u; }); assert.ok(used <= H + 1e-9, 'a page of ' + used); });
    }
  });
});

// ═════════════════════════════ the stylesheet of the document ═════════════════════════════
describe('the document stylesheet (d7-doc.css)', () => {
  const css = fs.readFileSync(path.join(QB, 'd7/d7-doc.css'), 'utf8');
  it('A4 portrait, navy #1F3A5F for headings and rules, the tile 40 px high, the header has no revision rule, the signature row has three boxes', () => {
    assert.match(css, /@page\s*\{\s*size:\s*A4 portrait/);
    for (const rule of [/\.d7-lh-title\{[^}]*color:#1F3A5F/, /\.d7-lh\{[^}]*border-bottom:2px solid #1F3A5F/, /\.d7-lh-tile\{[^}]*height:40px/, /html body\.d7-on th\{background:#1F3A5F!important/, /html body\.d7-on \.qb-doc-sheet th\{background:#1F3A5F/,
      /html body\.d7-on \.sig-row\.d7-sig3\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/]) assert.match(css, rule);
    assert.doesNotMatch(css, /d7-lh-rev|\.d7-sigs|\.d7-sig-(?:h|role|sign|name|date|cap)\b/, 'no revision label and none of the three-block signature layout');
    assert.doesNotMatch(css, /\.sig-row:not\(\.d7-sigs\)\{display:none/, 'today\'s signature row is never hidden');
  });
  it('Q66: every rule that stacks the preview into cards is a SCREEN rule at 640 px and leaves the A4 pages alone', () => {
    const at = css.indexOf('@media screen and (max-width:640px)'); assert.ok(at > 0, 'the phone query');
    const sec8 = css.slice(css.indexOf('/* ───────── 8. Q66'), css.indexOf('/* ───────── 9. The A4 pages'));
    assert.doesNotMatch(sec8, /@media print/, 'the cards are never inside print');
    assert.match(sec8, /\.items-table\.d7-cols tbody > tr\.item-row\{\s*display:grid/); assert.match(css, /td\.c-qty::before\{content:"Quantity";?\}/); assert.match(css, /td\.c-up::before\{content:"Unit price";?\}/); assert.match(css, /td\.c-amt::before\{content:"Amount";?\}/);
    const rules = sec8.match(/^ *html body\.d7-on [^{]*\{/gm) || [];
    for (const r of rules) if (/\.qb-doc-sheet/.test(r)) assert.match(r, /\.qb-doc-sheet:not\(\.d7-a4-body\)/, 'a preview rule must exclude the A4 pages: ' + r.trim());
  });
  it('the A4 pages: 794 x 1123 px boxes, the print look written out for the properties a phone-width rule of the page would change', () => {
    assert.match(css, /\.d7-a4-page\{[^}]*width:794px;height:1123px/); assert.match(css, /\.d7-a4-doc\{position:absolute;left:-10000px/);
    assert.match(css, /\.d7-a4-page > \.d7-a4-body\{position:absolute;left:30px;top:34px;width:734px;height:1043px;overflow:hidden/);   // owner 2026-11-20: tighter margins (≈8 mm), the PDF engine adds none for the quotation
    for (const rule of [/\.d7-a4-body \.items-table > tbody > tr > td\{padding:2\.5px 6px!important;font-size:8\.5pt!important/, /\.d7-a4-body \.terms-grid\{grid-template-columns:1fr 1fr/, /\.d7-a4-body \.sig-row\.d7-sig3\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,
      /\.d7-a4-body \.totals-box\{[^}]*position:static/, /\.d7-a4-body \.d7-lh\{[^}]*display:flex/, /\.d7-a4-body \.d7-lh-id\{display:block/]) assert.match(css, rule);
  });
});

// ═════════════════════════════ Addendum 2 B1 (blowers are a cost) and Addendum 1 A1 (ducting is per job); the formula-low warning; the price status ══════════════════
describe('Addendum 2 B1: a blower is a cost and needs no review; ducting is priced per job and keeps its review', () => {
  const BLOWER = 'Blower price to be confirmed by Neil.', DUCT = 'Ducting is priced per job; check before sending.';
  const addVent = (env, scope) => { const D = env.KC.products.vent, c = D.startCfg('ex1'); if (scope) c.scope = scope; return env.KC.addLine('vent', c, { render: false }); };
  it('a ventilation line (the whole system, the blower alone, or the ducts for a blower by others) needs review for the ducting only; no line carries the old blower reason; no other line carries either', () => {
    for (const scope of ['full', 'blower', 'duct']) {
      const env = readyEnv('sales'); addVent(env, scope); const it = itemsOf(env)[0];
      assert.equal(it.needsReview, true, scope); assert.ok(it.reviewReasons.includes(DUCT), scope); assert.equal(it.reviewReasons.includes(BLOWER), false, scope + ': no blower reason');
      assert.ok(it.reviewReasons.every(r => !/blower/i.test(r)), scope + ': ' + it.reviewReasons.join(' | '));
    }
    // a sirocco blower is picked by hand: the engine's check sees a blower row and the bridge no longer has a second lock for one either
    const sir = readyEnv('sales'); { const c = sir.KC.products.vent.startCfg('ex1'); c.exFam = 'sir'; c.scope = 'full'; c.needsReview = false; sir.KC.addLine('vent', c, { render: false }); }
    assert.deepEqual(plain(itemsOf(sir)[0].reviewReasons), [DUCT], 'the ducting reason only'); assert.equal(itemsOf(sir)[0].needsReview, true);
    const other = readyEnv('sales'); addSink(other); addChef(other);
    for (const it of itemsOf(other)) { assert.equal(it.reviewReasons.includes(BLOWER) || it.reviewReasons.includes(DUCT), false); assert.equal(it.needsReview, false); }
    assert.equal(sir.D7.adapter.BLOWER_REASON, undefined, 'the reason is gone from the bridge');
    assert.equal(sir.D7.adapter.hasBlower, undefined); assert.equal(sir.D7.adapter.blowerLocked, undefined);
  });
  it('flow.approvalReason names the ducting sentence once and never a blower one', () => {
    const env = readyEnv('sales'); addVent(env, 'full'); addVent(env, 'full');
    const t = env.D7.h('flow.approvalReason');
    assert.equal(env.D7.flow.approvalRequired().required, true); assert.ok(t.includes(DUCT), t); assert.equal(t.includes(BLOWER), false, t); assert.doesNotMatch(t, /blower/i);
    assert.equal(t.split(DUCT).length - 1, 1, 'said once for two lines'); assert.match(t, /^2 line\(s\) need review: #1 .*, #2 .*\./);
  });
  it('Operations clears a ventilation line like any other reason: one by one and with "Mark all reviewed" (the President-only lock on a blower line is gone)', () => {
    const ops = readyEnv('manager'); addVent(ops, 'full'); ops.KC.addLine('custom', { cat: 'prep', name: 'Cart', desc: '', dims: '', rows: [{ k: 'sh12', q: 1 }], m: null, lab: 50 }, { render: false });
    assert.equal(ops.D7.h('adapter.markReviewed', 0, true), true); assert.ok(itemsOf(ops)[0].reviewed, 'the ventilation line is cleared by Operations');
    assert.equal(plain(ops.run('__toasts')).some(t => /President can clear the blower/.test(t[0])), false, 'no toast about a blower');
    ops.D7.h('adapter.markReviewed', 0, false); assert.equal(itemsOf(ops)[0].reviewed, false);
    ops.D7.h('flow.markAllReviewed');
    assert.ok(itemsOf(ops)[0].reviewed, 'the ventilation line is cleared with the others'); assert.ok(itemsOf(ops)[1].reviewed, 'the custom item is cleared');
    assert.equal(ops.D7.flow.approvalRequired().required, false, 'nothing is left to review');
    // a review that Operations gave is kept when the line is checked again (it used to be dropped for a blower line)
    const again = readyEnv('manager'); addVent(again, 'full'); itemsOf(again)[0].reviewed = 'Operations'; again.D7.adapter.refresh(itemsOf(again)[0]); assert.equal(itemsOf(again)[0].reviewed, 'Operations');
    const pres = readyEnv('president'); addVent(pres, 'full');
    assert.equal(pres.D7.h('adapter.markReviewed', 0, true), true); assert.ok(itemsOf(pres)[0].reviewed);
  });
  it('the chip says why and who reviews it: the ducting sentence, "The President or Operations reviews it", no blower sentence and no President-only note', () => {
    const ops = readyEnv('manager'); addVent(ops, 'full'); const html = ops.D7.h('adapter.lineRow', itemsOf(ops)[0], 0);
    assert.match(html, /needs review/); assert.ok(html.includes(DUCT)); assert.equal(html.includes(BLOWER), false); assert.match(html, /The President or Operations reviews it/);
    assert.doesNotMatch(html, /blower|Only the President can clear/i);
    assert.doesNotMatch(html, /\.\./, 'no doubled full stop');
  });
  it('a blower line prices by the normal formula: the unit on the line is the project cost x the markup to the nearest 10 (the same for every role), and it is not "priced after review"', () => {
    for (const role of ['sales', 'manager', 'president']) {
      const env = readyEnv(role); addVent(env, 'full'); const it = itemsOf(env)[0];
      const pr = env.KC.priceOf('vent', it.cfg);
      assert.equal(pr.priced, true, role); assert.ok(pr.lines.some(l => l.q > 0 && env.KC.isBlower(l.k)), role + ': the line holds a blower');
      assert.equal(it.unitPrice, Math.round(pr.projectCost * env.KC.SET.markup / 10) * 10, role + ': the formula'); assert.equal(it.unitPrice, pr.unit, role);
      assert.notEqual(it.needsPrice, true, role); assert.equal(it.priceBasis, 'configured', role);
    }
  });
});

describe('Addendum 1 A1 item 7: the formula-low warning is the President\'s, only in the "formula" floor mode, and never changes a price', () => {
  const lowEnv = role => { const env = readyEnv(role); addChef(env); const it = itemsOf(env)[0]; for (const m of Object.values(env.KC.P)) if (m.p != null) m.p = 1; return { env, it }; };   // every material at a very low price: the formula price falls far under the list-based price
  it('floor mode "list" (the default): never shown, to anybody', () => {
    for (const role of ['president', 'manager', 'purchasing', 'sales']) { const { env, it } = lowEnv(role); env.D7.adapter.repriceAll(); assert.equal(env.D7.pricing.formulaLow(it, env.D7.pricing.lineCost(it)), null, role); assert.doesNotMatch(env.D7.h('pricing.priceNote', it, 0), /formula price/); }
  });
  it('floor mode "formula": the President sees it (note and chip), nobody else; the price on the line does not move; 10 % exactly is not below', () => {
    const { env, it } = lowEnv('president'); env.KC.FLOOR_MODE = 'formula'; env.D7.adapter.repriceAll();
    const before = it.unitPrice, lc = env.D7.pricing.lineCost(it), f = env.D7.pricing.formulaLow(it, lc);
    assert.ok(f && f.formula < 0.9 * f.list, 'the formula price is under 90 % of the list-based unit');
    const note = env.D7.h('pricing.priceNote', it, 0); assert.match(note, /formula price \(.*\) is more than 10% below the list-based price \(.*\)\. Check the material prices\. The price on the line is not changed\./);
    assert.match(env.D7.pricing.panelHtml(env.D7.pricing.trueCost()), /formula low/, 'the chip in the calculator\'s line table');
    assert.equal(it.unitPrice, before, 'a warning, never a price change');
    for (const role of ['manager', 'purchasing', 'sales']) { const o = lowEnv(role); o.env.KC.FLOOR_MODE = 'formula'; assert.equal(o.env.D7.pricing.formulaLow(o.it, o.env.D7.pricing.lineCost(o.it)), null, role + ' never sees it'); }
    const R = env.KCRules; assert.equal(R.formulaBelowList({ floorMode: 'formula', formulaSell: 90, listUnit: 100 }), false, '90 % exactly is not below'); assert.equal(R.formulaBelowList({ floorMode: 'formula', formulaSell: 89.99, listUnit: 100 }), true);
    assert.equal(R.formulaBelowList({ floorMode: 'list', formulaSell: 1, listUnit: 100 }), false, 'only in the formula mode');
  });
});

describe('Addendum 1 A1 item 7 in the panel: the engine\'s warning is staff only, so only the President reads it, and only in the formula floor mode', () => {
  const warnFor = (role, mode) => { const env = readyEnv(role); const D = env.KC.products.chef_hp, st = D.starts.find(s => D.startCfg(s.id).n === 4); for (const m of Object.values(env.KC.P)) if (m.p != null) m.p = 1; env.KC.FLOOR_MODE = mode; return plain(env.KC.shownWarnings(env.KC.check('chef_hp', D.startCfg(st.id)))); };
  it('the President reads it in the formula mode; Sales, Operations and Purchasing never; nobody in the list mode', () => {
    assert.ok(warnFor('president', 'formula').some(w => /more than 10% below the standard price/.test(w)));
    for (const role of ['sales', 'manager', 'purchasing']) assert.equal(warnFor(role, 'formula').some(w => /more than 10% below/.test(w)), false, role);
    assert.equal(warnFor('president', 'list').some(w => /more than 10% below/.test(w)), false);
  });
});

describe('Addendum 1 A1: the price status of a list row is staff only and never printed', () => {
  it('it is in the cost sidecar and in the chip of the line; it is in no public item and in no printed word', () => {
    const env = readyEnv('president'); env.KC.LISTP['CK-HP-4'] = { price: LIST4, perMetre: null, status: 'Supplier price', label: 'x', std: '' }; addChef(env);
    const it = itemsOf(env)[0]; env.D7.adapter.repriceAll();
    assert.equal(plain(env.D7.h('adapter.sidecarRow', it)).list.status, 'Supplier price');
    assert.match(env.D7.h('adapter.lineRow', it, 0), /Price status: Supplier price \(staff only, never printed\)/);
    const pub = JSON.stringify(plain(env.D7.h('adapter.publicItem', it))); assert.doesNotMatch(pub, /Supplier price|"status"/, 'nothing of the list row is in the public item');
    const printed = env.D7.doc.printBlock(it, 0) + env.D7.doc.lines(env.D7.doc.parts(it)).join(' ') + env.D7.doc.screenBlock(it, 0);
    assert.doesNotMatch(printed, /Supplier price|After review|Smoothed|Estimate|price status/i);
  });
});

// ═════════════════════════════ the corner charge, kept in step (packet B's contract) ═════════════════════════════
describe('the corner charge: KC.SET.corner and the cornerc price-list row say the same thing', () => {
  const seedC = (settingsCorner, rowP) => {
    const d = seedDocs({ 'kc_config/settings': { v: 1, markup: 2, ...(settingsCorner === undefined ? {} : { corner: settingsCorner }) } });
    if (rowP !== undefined) d['kc_materials/cornerc'] = { key: 'cornerc', p: rowP };
    return d;
  };
  it('at load the price-list row wins when it has a number; else the settings\' number; the other follows', async () => {
    const both = await loaded(seedC(1234, 777)); assert.equal(both.KC.P.cornerc.p, 777); assert.equal(both.KC.SET.corner, 777);
    const onlySettings = await loaded(seedC(1234)); assert.equal(onlySettings.KC.P.cornerc.p, 1234); assert.equal(onlySettings.KC.SET.corner, 1234);
    const onlyRow = await loaded(seedC(undefined, 900)); assert.equal(onlyRow.KC.SET.corner, 900); assert.equal(onlyRow.KC.P.cornerc.p, 900);
    const neither = await loaded(seedC(undefined)); assert.equal(neither.KC.SET.corner, null); assert.equal(neither.KC.P.cornerc.p, null, 'no corner charge: the L / U stations say so');
  });
  it('the President changing the corner charge in Pricing settings changes the price-list row too (one history entry), in one write', async () => {
    const env = await writerEnv('president', { 'kc_config/settings': { v: 1, markup: 2, corner: 1500 }, 'kc_materials/cornerc': { key: 'cornerc', p: 1500, hist: [] } });
    await env.KCLive.saveSettings({ corner: 1600 });
    const row = env.win.db.store.get('kc_materials/cornerc');
    assert.equal(row.p, 1600); assert.equal(row.hist.length, 1); assert.equal(row.hist[0].p, 1600); assert.equal(row.updatedBy, 'u-president'); assert.equal(env.win.db.store.get('kc_config/settings').corner, 1600);
    assert.equal(env.KC.SET.corner, 1600); assert.equal(env.KC.P.cornerc.p, 1600);
    await env.KCLive.saveSettings({ misc: 12 });
    assert.equal(env.win.db.store.get('kc_materials/cornerc').hist.length, 1, 'another setting does not touch the row');
  });
  it('the President changing the cornerc row changes the setting too; Purchasing changes the row only, and KC.SET.corner follows in memory', async () => {
    const pres = await writerEnv('president', { 'kc_config/settings': { v: 1, markup: 2, corner: 1500 } });
    await pres.KCLive.saveMaterial('cornerc', { p: 1700 });
    assert.equal(pres.win.db.store.get('kc_config/settings').corner, 1700); assert.equal(pres.win.db.store.get('kc_config/settings').markup, 2, 'the rest of the settings stays'); assert.equal(pres.KC.SET.corner, 1700);
    const fresh = await writerEnv('president');
    await fresh.KCLive.saveMaterial('cornerc', { p: 1800 });
    const made = fresh.win.db.store.get('kc_config/settings');
    assert.equal(made.corner, 1800); assert.equal(made.v, 1); assert.equal(made.markup, 2, 'no settings document yet: the whole settings are written (the rules need the markup)');
    const buy = await writerEnv('purchasing', { 'kc_config/settings': { v: 1, markup: 2, corner: 1500 } });
    await buy.KCLive.saveMaterial('cornerc', { p: 1900 });
    assert.equal(buy.win.db.store.get('kc_materials/cornerc').p, 1900); assert.equal(buy.win.db.store.get('kc_config/settings').corner, 1500, 'Purchasing may not write the settings'); assert.equal(buy.KC.SET.corner, 1900);
    await pres.KCLive.saveMaterial('cornerc', { p: null });
    assert.equal(pres.win.db.store.get('kc_config/settings').corner, null); assert.equal(pres.KC.SET.corner, null);
  });
});

// ═════════════════════════════ Q67 and Q68 on the panel and the cards ═════════════════════════════
describe('Q67: the list price of a material on a custom item is for every role; the totals stay with the President', () => {
  const PESO = '₱';
  const form = role => { const env = readyEnv(role); return env.KC.customDef.form({ cat: 'prep', name: 'Cart', desc: '', dims: '', rows: [{ k: 'sh12', q: 3 }], m: null, lab: null }); };
  const cellOf = h => { const m = /<div class="kc-q-mp">([\s\S]*?)<\/div>\s*\n?\s*<button/.exec(h); return m ? m[1] : ''; };
  const has = (h, re, what) => assert.ok(re.test(h), what + ' [' + h.slice(0, 160).replace(/\s+/g, ' ') + ']');
  it('Sales, Operations and Purchasing see the price per unit of each row, and neither the line total nor the materials total nor a typed cost', () => {
    for (const role of ['sales', 'manager', 'purchasing']) {
      const h = form(role), cell = cellOf(h);
      has(cell, new RegExp('Price list</span> <b>' + PESO + '\\d+\\.\\d\\d</b> / sheet'), role + ': the price of the row');
      assert.equal(/Line <span data-crow-t/.test(h), false, role + ': no line total'); assert.equal(/Materials from the list/.test(h), false, role); assert.equal(/Other materials/.test(h), false, role);
      assert.ok(h.includes('The price of each material comes from the list and cannot be changed here. Only Neil sees the line totals and the costs.'), role + ': the hint');
    }
  });
  it('the President sees the price, the line total and the materials total, and may type costs', () => {
    const h = form('president'), cell = cellOf(h);
    has(cell, new RegExp('Price list</span> <b>' + PESO + '\\d+\\.\\d\\d</b> / sheet'), 'the price of the row');
    has(cell, new RegExp('Line <span data-crow-t="0">' + PESO + '\\d+\\.\\d\\d'), 'the line total'); assert.ok(h.includes('Materials from the list: <b id="kcCrowTot">')); assert.ok(h.includes('Other materials'));
  });
  it('a material with no price says "no price" in words to every role', () => {
    const env = readyEnv('sales'); env.KC.P.sh12.p = null;
    assert.ok(env.KC.customDef.form({ cat: 'prep', name: 'x', rows: [{ k: 'sh12', q: 1 }] }).includes('<b style="color:var(--red)">no price</b>'));
  });
});
describe('Q68: the grilling and bakery placeholder cards are gone, the refrigeration ones stay', () => {
  it('KC.TAB_PLACEHOLDERS has no cooking entry', () => {
    const env = makeEnv(); assert.equal(env.KC.TAB_PLACEHOLDERS.cook, undefined); assert.deepEqual(plain(env.KC.TAB_PLACEHOLDERS.cold), ['Chiller', 'Ice container', 'Ice bin']);
  });
});

// ═════════════════════════════ Addendum 2 B9: the "Recommended" tag is on the choice that is pre-selected ═════════════════════════════
describe('Addendum 2 B9: the Recommended tag sits on the pre-selected choice (prep backsplash, station edge, sink grease trap)', () => {
  const pillsOf = html => [...html.matchAll(/<button type="button" class="cfg-pill" data-set="([^"]+)" data-val="([^"]*)" aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)]
    .map(m => ({ path: m[1], val: m[2], on: m[3] === 'true', rec: /class="kc-rec">Recommended</.test(m[4]) }));
  const formOf = (env, id) => { const D = env.KC.products[id], c = D.startCfg(D.defaultStart); env.KC.S.cfg = c; env.KC.S.kind = id; return { c, pills: pillsOf(D.form(c)) }; };
  const groupOf = (pills, path) => pills.filter(p => p.path === path);
  const chosen = g => g.filter(p => p.on).map(p => p.val), tagged = g => g.filter(p => p.rec).map(p => p.val);
  it('the prep table: the 150 mm backsplash is pre-selected and is the one that carries the tag ("None" no longer does); the Flat edge keeps both', () => {
    const { pills } = formOf(readyEnv('sales'), 'prep');
    const bs = groupOf(pills, 'top.splash'); assert.equal(bs.length, 3, 'None, 150 mm, Full height');
    assert.deepEqual(chosen(bs), ['150']); assert.deepEqual(tagged(bs), ['150']);
    const edge = groupOf(pills, 'top.edge'); assert.deepEqual(chosen(edge), ['flat']); assert.deepEqual(tagged(edge), ['flat']);
  });
  it('the station: the Marine edge is pre-selected and carries the tag (Flat does not); the 150 mm backsplash keeps both', () => {
    const { pills } = formOf(readyEnv('sales'), 'station');
    const edge = groupOf(pills, 'top.edge'); assert.equal(edge.length, 2, 'Flat, Marine edge');
    assert.deepEqual(chosen(edge), ['marine']); assert.deepEqual(tagged(edge), ['marine']);
    const bs = groupOf(pills, 'top.splash'); assert.deepEqual(chosen(bs), ['150']); assert.deepEqual(tagged(bs), ['150']);
  });
  it('the sink: the 15 GPM grease trap is pre-selected and keeps the tag; None and 10 GPM are not tagged', () => {
    const env = readyEnv('sales'), { c, pills } = formOf(env, 'sink');
    assert.equal(c.trap, 15, 'the default package starts with the 15 GPM trap');
    const gt = groupOf(pills, 'trap'); assert.equal(gt.length, 3, 'None, 10 GPM, 15 GPM');
    assert.deepEqual(chosen(gt), ['15']); assert.deepEqual(tagged(gt), ['15']);
    // the other packages are as they were: no trap until the person picks one (the owner ruled on the default package)
    for (const id of ['hand', 'pot', 'blank']) assert.equal(env.KC.products.sink.startCfg(id).trap, 0, id);
    // and the line the package adds carries the trap in its text and its materials
    const line = env.KC.addLine('sink', c, { render: false }); const it = itemsOf(env)[itemsOf(env).length - 1]; void line;
    assert.match(it.specEdit + ' ' + JSON.stringify(plain(it.doc)), /grease trap 15 GPM/i);
  });
  it('no product contradicts itself: in the default form of every product, every pill that carries the tag is the one that is pre-selected', () => {
    const env = readyEnv('sales'); let tags = 0;
    for (const D of env.KC.productList()) {
      const { pills } = formOf(env, D.id), by = {};
      pills.forEach(p => { (by[p.path] = by[p.path] || []).push(p); });
      for (const [path, g] of Object.entries(by)) for (const p of g.filter(x => x.rec)) { tags++; assert.equal(p.on, true, `${D.id}: ${path} = ${p.val} carries the tag but is not pre-selected`); }
    }
    assert.ok(tags >= 20, 'the scan really found the tags: ' + tags);
  });
});

// ═════════════════════════════ Addendum 2 B2: the item code on the printed quotation ═════════════════════════════
describe('Addendum 2 B2: the item code is small grey text at the start of each line\'s description (no column), for KC quotes only', () => {
  const CODE = /<div class="kc-d-code">([^<]*)<\/div>/g;
  const codesIn = html => [...html.matchAll(CODE)].map(m => m[1]);
  const addKc = (env, kind, start) => { env.KC.addLine(kind, env.KC.products[kind].startCfg(start), { render: false }); const its = itemsOf(env); return its[its.length - 1]; };
  // [kind, start, the list code the line is built from, or '' when the line has none]
  const LINES = [['chef_hp', '4', 'CK-HP-4'], ['chef_lp', '2', 'CK-LP-2'], ['chef_wok', '2', 'CK-WK-2'], ['prep', 'basic', 'PS-PT-1200'], ['sink', 'dish2', 'WS-SK2-1200'], ['sink', 'hand', 'WS-HS-400'],
    ['hood', 'wall', 'VN-HD-1800'], ['rack', 'rack', 'PS-RK-1200'], ['cabinet', 'cabinet', 'PS-CB-1200'], ['chef_hold', 'std', 'CK-HH'], ['trolley', 'dish', 'PS-TR-DC'], ['dishrack', 'std', 'PS-DR-PL'],
    ['caddy', 'std', 'PS-CD-4'], ['chef_noodle', '6', 'CK-NB-6B'], ['chef_sal', 'wall', 'CK-SL'], ['chef_bain', '3', 'CK-BM-3'],
    ['station', 'stall', ''], ['vent', 'ex1', ''], ['chef_bain', '4', '']];
  it('a kc product line prints the price-list code of its model first, above the material and the title; the snapshot the adapter stores carries it; a line with no code prints nothing extra', () => {
    const env = readyEnv('sales');
    for (const [kind, start, code] of LINES) {
      const it = addKc(env, kind, start), html = env.D7.doc.printBlock(it, 0);
      assert.equal(it.doc.code, code, kind + '/' + start + ': the snapshot');
      if (!code) { assert.equal(html.includes('kc-d-code'), false, kind + '/' + start + ': no code row'); assert.match(html, /^<div class="kc-d d7-blk"><div class="kc-d-mat">/, kind + ': the block starts with the material row'); continue; }
      assert.deepEqual(codesIn(html), [code], kind + '/' + start + ': exactly one code row');
      assert.match(html, new RegExp('^<div class="kc-d d7-blk"><div class="kc-d-code">' + code + '</div><div class="kc-d-mat">'), kind + '/' + start + ': first, then the material row, then the title');
      assert.ok(html.indexOf('kc-d-code') < html.indexOf('kc-d-mat') && html.indexOf('kc-d-mat') < html.indexOf('kc-d-title'), kind + ': above the product name');
    }
  });
  it('the custom item has no code; a Chef Mode model that is not on the list has none; every code is a Standard Price List code', () => {
    const env = readyEnv('sales'); customLineOf(env);
    assert.equal(itemsOf(env)[0].doc.code, ''); assert.equal(env.D7.doc.printBlock(itemsOf(env)[0], 0).includes('kc-d-code'), false);
    for (const [kind, start, code] of LINES) if (code) assert.match(code, /^(?:PS|WS|CK|GR|BK|VN)-[A-Z0-9-]+$/, kind);
  });
  it('the same block is drawn on screen (the preparer sees what prints), in the plain-text lines, and in every copy that prints the block: the code is on every one of them', () => {
    const env = readyEnv('sales'); const it = addKc(env, 'chef_hp', '4');
    assert.deepEqual(codesIn(env.D7.doc.screenBlock(it, 0)), ['CK-HP-4'], 'the on-screen block (class no-print)');
    assert.equal(env.D7.doc.lines(env.D7.doc.parts(it))[0], 'CK-HP-4', 'the plain text lines start with it');
    assert.equal(env.D7.doc.parts(it).code, 'CK-HP-4');
    assert.deepEqual(codesIn(env.D7.h('doc.printBlock', it, 0)), ['CK-HP-4'], 'the hook the page calls for the sheet slot (client preview, PDF pages, agent and workforce copies all clone the slot)');
    const wf = env.D7.doc.workforceBlock(it, 0); assert.equal(wf.includes('kc-d-code'), false, 'the workforce detail is a separate block (drawing and build detail); the description cell holds the code, with no prices anywhere');
  });
  it('the code is stored with the line: it survives a save and a reload of the quote (publicItem keeps it), and a stored snapshot that has none gets it from the configuration', () => {
    const env = readyEnv('sales'); const it = addKc(env, 'chef_hp', '4');
    const pub = plain(env.D7.h('adapter.publicItem', it)); assert.equal(pub.doc.code, 'CK-HP-4');
    const old = JSON.parse(JSON.stringify(pub)); delete old.doc.code;                                        // made before the field existed
    assert.equal(env.D7.doc.parts(old).code, 'CK-HP-4', 'derived from the configuration');
    old.doc.code = ''; assert.equal(env.D7.doc.parts(old).code, '', 'a snapshot that says "no code" has none');
    const noDoc = JSON.parse(JSON.stringify(pub)); delete noDoc.doc; assert.equal(env.D7.doc.parts(noDoc).code, 'CK-HP-4', 'no snapshot at all: built from the product file');
  });
  it('a catalogue line whose SKU is a Standard Price List code prints it (GR-, BK-, CK-TP-); an older catalogue SKU, a custom line and a fee print none', () => {
    const doc = readyEnv('sales').D7.doc, line = id => ({ id, name: 'A catalogue item', qty: 1, unit: 'pc', specs: [], unitPrice: 1, amount: 1 });
    for (const sku of ['GR-LR-900', 'BK-PG-2', 'CK-TP-1200', 'PS-PT-900', 'WS-GT-15', 'VN-HD-1200']) assert.deepEqual(codesIn(doc.printBlock(line(sku), 0)), [sku], sku);
    for (const sku of ['PW-001', 'CE-004', 'GL-001', 'EX-001', 'FA-001', 'MS-001', 'RF-001', 'BA-001', 'CUSTOM', 'KC', 'gr-lr-900', 'GR-', 'GR LR 900', '']) assert.equal(doc.printBlock(line(sku), 0).includes('kc-d-code'), false, JSON.stringify(sku));
    assert.equal(doc.printBlock({ id: 'MISCFEE', name: 'Delivery' }, 0), '', 'a fee prints nothing at all');
  });
  it('the code is plain text, escaped and refused when odd: letters, digits and hyphens only', () => {
    const doc = readyEnv('sales').D7.doc;
    assert.match(doc.blockHtml({ code: '<b>CK-1</b>', material: 'M', use: 'U', title: 'T' }), /<div class="kc-d-code">&lt;b&gt;CK-1&lt;\/b&gt;<\/div>/, 'blockHtml escapes whatever it is handed');
    for (const bad of ['<b>x</b>', 'CK 4', 'CK-4;', '"x"', '-CK', 'a'.repeat(60), 7, null, {}]) assert.equal(doc.parts({ kcKind: 'chef_hp', cfg: {}, name: 'x', doc: { code: bad, title: 'T' } }).code, '', JSON.stringify(bad));
    assert.equal(doc.parts({ kcKind: 'chef_hp', cfg: {}, name: 'x', doc: { code: 'CK-HP-4', title: 'T' } }).code, 'CK-HP-4');
    assert.equal(doc.parts({ id: 'GR-LR-900', name: 'x', specs: [] }).code, 'GR-LR-900');
  });
  it('the code looks small and grey wherever the block is drawn: on screen, on paper, in the Client preview and on the A4 pages of the PDF (no column, no new table cell)', () => {
    const css = fs.readFileSync(path.join(QB, 'd7/d7-doc.css'), 'utf8');
    const rules = [...css.matchAll(/([^{}]*\.kc-d-code[^{}]*)\{([^}]*)\}/g)].map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
    const selectors = rules.map(r => r.sel);
    assert.ok(selectors.includes('.d7-blk .kc-d-code'), 'on screen and in the Client preview');
    assert.ok(selectors.includes('html body.d7-on .d7-a4-body .d7-blk .kc-d-code'), 'on the A4 pages of the PDF');
    assert.equal(rules.length, 3, 'screen, paper (@media print) and the A4 pages');
    for (const r of rules) {
      const size = /font-size:([0-9.]+)(px|pt)/.exec(r.body), grey = /color:#([0-9a-f]{6});/.exec(r.body);
      assert.ok(size && ((size[2] === 'px' && +size[1] <= 10) || (size[2] === 'pt' && +size[1] <= 7)), 'small: ' + r.body);
      assert.ok(grey && grey[1][0] === grey[1][2] && grey[1][2] === grey[1][4] && parseInt(grey[1].slice(0, 2), 16) >= 0x70 && parseInt(grey[1].slice(0, 2), 16) <= 0xa0, 'a mid grey (the three channels equal): ' + r.body);
    }
    assert.equal(/<th[^>]*>\s*(?:Item )?Code\s*<\/th>/i.test(fs.readFileSync(path.join(ROOT, 'quote-builder-v2.html'), 'utf8')), false, 'no code column in the page\'s table heads');
  });
});

// ═════════════════════════════ D4 (the cards say "from" the list price of the smallest standard model) and D14 (no internal id chip) ═════════════════════════════
describe('D4 (Addendum 1 A1 rule 5): a product card\'s "from" price is the list price of the smallest standard model; D14: the panel header has no internal id chip', () => {
  const stubEl = () => ({ innerHTML: '', style: {}, dataset: {}, hidden: false, scrollTop: 0, scrollLeft: 0, value: '', classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null, appendChild() {}, scrollIntoView() {}, focus() {}, addEventListener() {} });
  const cardsEnv = (role = 'sales') => {
    const env = readyEnv(role); env.D7.ready = true;
    for (const id of ['catTabs', 'd7Cards', 'kcPanel', 'kcPanelTitle', 'kcPanelScroll', 'kcPanelFoot', 'kcName', 'kcMsgs', 'kcAside', 'kcPrintPrev', 'kcCostSum']) env.els.set(id, stubEl());
    env.els.get('catTabs').querySelector = sel => (sel === '.kc-tabs' ? stubEl() : null);
    env.ctx.NodeFilter = { SHOW_TEXT: 4 }; env.ctx.document.createTreeWalker = () => ({ nextNode: () => null });        // the sink's read-outs walk the text nodes of the panel: there are none in this stand-in
    return env;
  };
  const fromOf = (env, id) => { const m = new RegExp('data-card="' + id + '"[^>]*><div class="kc-card-hd"><div class="kc-card-t">[^<]*</div><div class="kc-card-from">([^<]*)</div>').exec(env.els.get('d7Cards').innerHTML); return m ? m[1] : null; };
  const SEVEN = ['prep', 'sink', 'hood', 'rack', 'cabinet', 'dishrack', 'chef_noodle'];       // the cards that showed the cheapest START, default options included (QA D4)
  const cheapestStart = (env, id) => { const D = env.KC.products[id]; return Math.min(...D.starts.map(st => env.KC.price(id, D.startCfg(st.id), { skipHood: true })).filter(r => r.priced).map(r => r.unit)); };
  it('the seven cards that used to show the cheapest START (default options included) show the LIST price of the smallest standard model', () => {
    const env = cardsEnv(); env.KC.renderChips(true);
    for (const id of SEVEN) {
      const sa = env.KC.startsAt(id), models = env.KC.stdModels(id).map(m => env.KC.listRow(m.code).price);
      assert.ok(sa && sa.code, id + ': the product has standard models on the list');
      assert.equal(sa.price, Math.min(...models), id + ': the cheapest of its standard models'); assert.equal(sa.price, env.KC.listRow(sa.code).price, id + ': a list price, not a formula price');
      assert.equal(fromOf(env, id), 'from ' + env.KC.peso(sa.price), id + ': the card says the list price of ' + sa.code);
    }
    // under the synthetic prices these five differ from what their cheapest start costs once its default options are in: the card no longer follows the start
    for (const id of ['prep', 'hood', 'rack', 'cabinet', 'chef_noodle']) assert.notEqual(fromOf(env, id), 'from ' + env.KC.peso(cheapestStart(env, id)), id + ': not the cheapest start');
  });
  it('the card does not follow the materials or the options: material prices tripled, the "from" of a list-covered product stays the list price (the start pills and the panel still follow them)', () => {
    const env = cardsEnv(); env.KC.renderChips(true);
    const before = Object.fromEntries(SEVEN.map(id => [id, fromOf(env, id)]));
    Object.keys(env.KC.P).forEach(k => { if (env.KC.P[k].p != null) env.KC.P[k].p *= 3; });
    env.KC.renderChips(true);
    for (const id of SEVEN) assert.equal(fromOf(env, id), before[id], id + ': a list price');
    assert.notEqual(env.KC.price('prep', env.KC.products.prep.startCfg('basic')).unit, env.KC.price('prep', env.KC.products.prep.startCfg('basic'), { noList: true }).unit, 'the start is still list based');
  });
  it('every card of a product the list covers says exactly KC.startsAt; the cards of the Chef Mode products too', () => {
    const env = cardsEnv(); env.KC.renderChips(true);
    for (const D of env.KC.productList()) {
      const sa = env.KC.startsAt(D.id), shown = fromOf(env, D.id);
      assert.notEqual(shown, null, D.id + ' has a card');
      if (sa) assert.equal(shown, 'from ' + env.KC.peso(sa.price), D.id);
    }
    assert.equal(env.KC.cardFrom('sink'), env.KC.startsAt('sink').price, 'the exported cardFrom is the same figure');
  });
  it('a product with no standard model on the list (the kitchen station, ventilation) keeps the lowest of its start prices; with no list loaded at all every card falls back to its starts (the Sink to its default package)', () => {
    const env = cardsEnv(); env.KC.renderChips(true);
    for (const id of ['station', 'vent']) {
      const D = env.KC.products[id], units = D.starts.map(s => env.KC.price(id, D.startCfg(s.id), { skipHood: true })).filter(r => r.priced).map(r => r.unit);
      assert.equal(env.KC.startsAt(id), null, id + ' has no standard model');
      assert.equal(fromOf(env, id), 'from ' + env.KC.peso(Math.min(...units)), id + ': the cheapest start');
    }
    const bare = cardsEnv(); Object.keys(bare.KC.LISTP).forEach(k => { delete bare.KC.LISTP[k]; }); bare.KC.renderChips(true);
    const sink = bare.KC.products.sink, pr = bare.KC.price('sink', sink.startCfg('dish2'), { skipHood: true });
    assert.equal(fromOf(bare, 'sink'), 'from ' + bare.KC.peso(pr.unit), 'no list: the Sink card reads its default package (owner Q37), the formula price');
    assert.notEqual(fromOf(bare, 'prep'), null);
  });
  it('the cards follow the price list: a changed list price changes the figure on the next draw (the cache is keyed by the list too)', () => {
    const env = cardsEnv(); env.KC.renderChips(true);
    const code = env.KC.startsAt('prep').code, before = fromOf(env, 'prep'); assert.equal(before, 'from ' + env.KC.peso(env.KC.listRow(code).price));
    const row = env.KC.LISTP[code]; env.KC.LISTP[code] = typeof row === 'object' ? Object.assign({}, row, { price: (row.price || 0) - 1000 }) : row - 1000;
    env.KC.renderChips(true); assert.notEqual(fromOf(env, 'prep'), before); assert.equal(fromOf(env, 'prep'), 'from ' + env.KC.peso(env.KC.listRow(code).price));
  });
  it('the Chef Mode model pills follow the price list too: a changed list price shows on the pill on the next draw (the start-price cache is keyed by the list as well as by the materials)', () => {
    const env = cardsEnv(); env.KC.renderChips(true);
    const pillOf = model => { const m = new RegExp('data-kind="chef_hp" data-model="' + model + '"[^>]*><span>[^<]*</span><b>([^<]*)</b>').exec(env.els.get('d7Cards').innerHTML); return m && m[1]; };
    const before = pillOf('4'); assert.equal(before, env.KC.peso(env.KC.price('chef_hp', env.KC.products.chef_hp.startCfg('4')).unit), 'the model pill is the list based unit of that model');
    const row = env.KC.LISTP['CK-HP-4']; env.KC.LISTP['CK-HP-4'] = typeof row === 'object' ? Object.assign({}, row, { price: (row.price || 0) + 1000 }) : row + 1000;
    env.KC.renderChips(true); const after = pillOf('4');
    assert.notEqual(after, before, 'the pill moved with the list'); assert.equal(after, env.KC.peso(env.KC.price('chef_hp', env.KC.products.chef_hp.startCfg('4')).unit));
  });
  it('D14: the configurator panel header says "Configure: <title>" and no internal id chip (KC-PREP, KC-SINK, KC-HOOD, KC-VENT, KC-RACK, KC-STN, KC-CHEF-HP ...); the custom item header is as it was', () => {
    for (const [kind, title] of [['prep', 'SS Prep Table'], ['sink', 'SS Sink'], ['hood', 'SS Range Hood'], ['vent', 'Ventilation'], ['rack', 'SS Rack'], ['station', 'Multi-Purpose Kitchen Station'], ['chef_hp', 'Chef Mode High Pressure Stove']]) {
      const env = cardsEnv(); const D = env.KC.products[kind]; assert.ok(D, kind);
      env.KC.openKind(kind);
      const head = env.els.get('kcPanelTitle').innerHTML;
      assert.match(head, /^⚙ Configure: /, kind); assert.equal(/kc-code|KC-[A-Z]/.test(head), false, kind + ': no id chip in ' + head);
      assert.equal(head.includes(D.code), false, kind + ': the internal id ' + D.code + ' is not shown');
      assert.equal(head, '⚙ Configure: ' + D.title.replace(/&/g, '&amp;'), kind + ': just the title');
      void title;
    }
    const env = cardsEnv(); env.KC.openCustom('prep'); assert.equal(env.els.get('kcPanelTitle').innerHTML, '➕ Add custom item');
  });
});

// ═════════════════════════════ Fable review F7 (2026-11-20): typed costs the page does not hold are never sent as "none" ═════════════════════════════
// The typed costs of a custom item live only in the cost sidecar (the payload never carries them) and the sidecar is REPLACED as a whole on every save.  A line loaded from a saved quote has none in memory until
// afterLoad grafts them back: if that read has not answered, failed, matched nothing, or the quote came from a draft (which never reads them), the page sends typed: null ("not known"), and the bridge in js/app.js keeps
// what is stored for that line.  Made in this session, typed by the person, or grafted back = known, and sent as it is.
describe('Fable review F7: the typed costs of a custom item survive an update in place when the graft did not run', () => {
  const TYPED = { custom: [], m: 999, lab: 88 };
  // a custom item with typed materials and labor, as it is FILED: the payload copy (publicItem) and its sidecar row; then "loaded" into a page that has neither the typed costs nor the graft
  function filedCustom() {
    const env = readyEnv('president');
    env.KC.addLine('custom', { cat: 'prep', name: 'Cart', desc: '', dims: '', rows: [{ k: 'sh12', q: 1 }], m: TYPED.m, lab: TYPED.lab }, { render: false });
    const row = plain(env.D7.h('adapter.sidecarRow', itemsOf(env)[0])), pub = plain(env.D7.h('adapter.publicItem', itemsOf(env)[0]));
    return { env, row, pub };
  }
  function loadInto(env, pub, docs = null, opt = {}) {
    env.run(`items.length = 0; reopenSourceDocId = "q1"; reopenSourceCollection = "bk_quotes"; items.push(${JSON.stringify(pub)})`);
    env.D7.h('adapter.hydrate', itemsOf(env)[0]); env.D7.h('adapter.sync');
    if (docs) env.win.db = makeFakeDb(docs, opt);
    return env;
  }
  it('a loaded line is "not known": its sidecar row says typed: null, not a row of nulls; a line made in this session sends what it holds, even when that is nothing', () => {
    const { env, row, pub } = filedCustom();
    assert.deepEqual(row.typed, { custom: [], m: 999, lab: 88 }, 'in the session that made it: the typed costs');
    loadInto(env, pub);
    assert.equal(itemsOf(env)[0].cfg.lab == null, true, 'the payload never carried them'); assert.equal(itemsOf(env)[0]._kc.typedUnknown, true);
    const loaded = plain(env.D7.h('adapter.sidecarRow', itemsOf(env)[0]));
    assert.equal(loaded.typed, null); assert.equal(loaded.kcId, 'K1'); assert.equal(loaded.kind, 'custom'); assert.ok(loaded.M > 0, 'the rest of the row is as it was');
    assert.ok(JSON.stringify(loaded).indexOf('undefined') < 0, 'nothing a Firestore write would refuse');
    const fresh = readyEnv('president'); fresh.KC.addLine('custom', { cat: 'prep', name: 'Plain', desc: '', dims: '', rows: [{ k: 'sh12', q: 1 }], m: null, lab: 5 }, { render: false });
    fresh.KC.addLine('sink', fresh.KC.products.sink.startCfg('hand'), { render: false });
    assert.deepEqual(plain(fresh.D7.h('adapter.sidecarRow', itemsOf(fresh)[1])).typed, { custom: [] }, 'a product made in this session: a row of nulls is the truth');
    assert.equal(itemsOf(fresh)[0]._kc.typedUnknown, undefined);
  });
  it('typed numbers in memory end the doubt (a restore from this browser\'s own storage keeps them), and so does typing them on a loaded line', () => {
    const { env, pub } = filedCustom();
    const raw = JSON.parse(JSON.stringify(plain(env.run('items[0]')))); delete raw._kc;                 // what bkqb_items holds: the line with its typed costs, no _kc
    loadInto(env, raw);
    assert.equal(itemsOf(env)[0]._kc.typedUnknown, undefined); assert.deepEqual(plain(env.D7.h('adapter.sidecarRow', itemsOf(env)[0])).typed, { custom: [], m: 999, lab: 88 });
    loadInto(env, pub); env.run('items[0].cfg.lab = 12');
    assert.deepEqual(plain(env.D7.h('adapter.sidecarRow', itemsOf(env)[0])).typed, { custom: [], m: null, lab: 12 }, 'the person typed a cost on a line that was not known: that is what is sent');
  });
  it('a product line with typed costs on its custom parts (restored from this browser\'s own storage) is known too: part by part, the row of costs goes out as it is', () => {
    const env = readyEnv('president'); addSink(env);
    env.run('items[0].cfg.custom = [{ text: "a bracket", m: 10, lab: 20 }, { text: "a shelf", m: null, lab: null }]');
    const raw = JSON.parse(JSON.stringify(plain(env.run('items[0]')))); delete raw._kc;
    env.run(`items.length = 0; items.push(${JSON.stringify(raw)})`); env.D7.h('adapter.hydrate', itemsOf(env)[0]); env.D7.h('adapter.sync');
    assert.equal(itemsOf(env)[0]._kc.typedUnknown, undefined); assert.deepEqual(plain(env.D7.h('adapter.sidecarRow', itemsOf(env)[0])).typed, { custom: [{ m: 10, lab: 20 }, { m: null, lab: null }] });
    const bare = JSON.parse(JSON.stringify(raw)); bare.cfg.custom = [{ text: 'a bracket' }, { text: 'a shelf' }];
    env.run(`items.length = 0; items.push(${JSON.stringify(bare)})`); env.D7.h('adapter.hydrate', itemsOf(env)[0]); env.D7.h('adapter.sync');
    assert.equal(itemsOf(env)[0]._kc.typedUnknown, true, 'the payload copy has none of them'); assert.equal(plain(env.D7.h('adapter.sidecarRow', itemsOf(env)[0])).typed, null);
  });
  it('afterLoad grafts the stored typed costs back and the line is known again; a sidecar that cannot be read, or does not match, leaves it "not known"', async () => {
    const approved = { approvalStatus: 'approved', netAmount: 5000, grandTotal: 5600, vatAmount: 600, approvedBy: 'u-pres' };
    const ok = filedCustom(); loadInto(ok.env, ok.pub, { 'bk_quotes/q1': approved, 'quote_costs/bk_quotes_q1': { items: [{ i: 0, n: 'Cart', kc: ok.row }] } });
    await ok.env.KCLive.afterLoad({ sourceDocId: 'q1', sourceCollection: 'bk_quotes' });
    assert.equal(itemsOf(ok.env)[0].cfg.lab, 88); assert.equal(itemsOf(ok.env)[0]._kc.typedUnknown, undefined);
    assert.deepEqual(plain(ok.env.D7.h('adapter.sidecarRow', itemsOf(ok.env)[0])).typed, { custom: [], m: 999, lab: 88 }, 'round trip: what was stored goes back');
    for (const [why, docs, opt] of [['the read is refused', { 'bk_quotes/q1': approved, 'quote_costs/bk_quotes_q1': { items: [] } }, { deny: ['quote_costs'] }], ['the read fails', { 'bk_quotes/q1': approved }, { fail: ['quote_costs'] }],
      ['no sidecar', { 'bk_quotes/q1': approved }, {}], ['the row is another line\'s', { 'bk_quotes/q1': approved, 'quote_costs/bk_quotes_q1': { items: [{ i: 0, n: 'Not Cart', kc: ok.row }] } }, {}]]) {
      const x = filedCustom(); loadInto(x.env, x.pub, docs, opt); await x.env.KCLive.afterLoad({ sourceDocId: 'q1', sourceCollection: 'bk_quotes' });
      assert.equal(itemsOf(x.env)[0]._kc.typedUnknown, true, why); assert.equal(plain(x.env.D7.h('adapter.sidecarRow', itemsOf(x.env)[0])).typed, null, why);
    }
  });
  it('a draft resume never reads the typed costs (afterLoad returns at once): its custom items stay "not known", so an autosave cannot erase them', async () => {
    const { env, pub } = filedCustom(); loadInto(env, pub); env.run('reopenSourceDocId = null; reopenSourceCollection = null');
    assert.equal(await env.KCLive.afterLoad({ draftDocId: 'd1', items: [pub] }), false);
    assert.equal(plain(env.D7.h('adapter.sidecarRow', itemsOf(env)[0])).typed, null);
  });
  it('a duplicate of a line, and a line the product file does not know, carry no flag problems: a copy of a known line is known, a missing configurator has no row at all', () => {
    const { env } = filedCustom(); env.run('items.push(JSON.parse(JSON.stringify(items[0]))); items[1].kcId = "K2"');
    assert.equal(itemsOf(env)[1]._kc && itemsOf(env)[1]._kc.typedUnknown, undefined); assert.equal(env.D7.h('adapter.sidecarRow', { kcKind: 'nothing', cfg: {} }), '');
  });

  // ── the bridge in js/app.js, the REAL listener lifted out of its own source and driven with real messages (the same way tests/quote-link.test.mjs drives it) ──
  const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const LISTENER = (() => {
    const start = APP.indexOf("window.addEventListener('message', async (e) => {", APP.indexOf('Quote Builder iframe → Firestore bridge'));
    assert.ok(start > 0, 'the bridge listener was not found');
    const end = APP.indexOf('\n});', start); assert.ok(end > start && APP.slice(start, end).includes('saveCostSidecar'));
    return APP.slice(start, end + 4);
  })();
  const KEEP = (APP.match(/^function keepTypedCosts\([\s\S]*?\n\}/m) || [])[0];
  const ORIGIN = 'https://app.test';
  function makeBridge(docs = {}, opt = {}) {
    const store = new Map(Object.entries(docs).map(([k, v]) => [k, plain(v)])), reads = [], sets = [], listeners = [], FRAME = {};
    let seq = 0;
    const ref = (coll, id) => ({ id,
      get: async () => { const k = coll + '/' + id; reads.push(k); if (opt.failGet && coll === 'quote_costs') throw Object.assign(new Error('unavailable'), { code: 'unavailable' }); if (opt.hangGet && coll === 'quote_costs') return new Promise(() => {}); return { exists: store.has(k), id, data: () => plain(store.get(k)) }; },
      set: async (body) => { const k = coll + '/' + id; sets.push({ key: k, body: plain(body) }); store.set(k, plain(body)); },
      update: async (patch) => { const k = coll + '/' + id; store.set(k, Object.assign({}, store.get(k), plain(patch))); }, delete: async () => { store.delete(coll + '/' + id); } });
    const db = { collection: (coll) => ({ doc: (id) => ref(coll, id), add: async (data) => { const id = 'new' + (++seq); store.set(coll + '/' + id, plain(data)); return ref(coll, id); }, where: () => ({ get: async () => ({ docs: [] }) }) }) };
    const win = { location: { origin: ORIGIN }, addEventListener: (t, f) => { if (t === 'message') listeners.push(f); }, QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'], quoteCollectionFor: () => 'bk_quotes',
      quoteStateFields: (s) => ({ filed: { status: 'filed' }, pending_approval: { status: 'pending_approval' } })[s], Clients: { upsertFromQuote: async () => 'c1' }, fmtN2: String, logAudit() {}, linkQuoteToRequest: async () => true };
    const ctx = vm.createContext({ window: win, db, console: { log() {}, error() {}, warn() {} }, document: { getElementById: (id) => (id === 'qb-frame' ? { contentWindow: FRAME } : null) },
      firebase: { firestore: { FieldValue: { serverTimestamp: () => ({ ts: 1 }) } } }, currentUser: { uid: 'u-sales', email: 's@example.test' }, userProfile: { displayName: 'Sales One' }, currentRole: 'employee',
      Notifs: { showToast() {}, success() {}, sendToOwner: async () => {} }, dbCacheInvalidate() {}, setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; }, clearTimeout });
    vm.runInContext('function _qbCleanSourceRef() { return null; } function _qbCleanEstimateCheck() { return null; }\n' + (opt.noKeep ? '' : KEEP + '\n') + LISTENER, ctx);       // the two sanitisers are not what this is about
    const send = async (type, payload, extra) => { await listeners[0]({ origin: ORIGIN, source: FRAME, data: Object.assign({ type, payload }, extra || {}) }); };
    return { store, reads, sets, send, ctx };
  }
  const row = (typed, over = {}) => ({ i: 0, n: 'Cart', kc: { kcId: 'K1', kind: 'custom', markup: 2, M: 100, projectCost: 200, groups: [], lines: [], typed }, ...over });
  const sidecarOf = (rows, over = {}) => ({ v: 1, items: rows, kcSummary: { v: 1, net: 4000 }, approval: null, ...over });
  const quote = (over = {}) => ({ quoteNumber: 'BKTEST261120-001R1', company: 'BK', clientName: 'Juan', items: [], total: 4000, grandTotal: 4000, netAmount: 4000, ...over });
  const stored = (b, key) => b.store.get(key);

  it('keepTypedCosts: a row with typed null takes the stored typed costs of the same line (kcId, kind and name); a row with typed as an object, even of nulls, is the builder\'s word and replaces; nothing is mutated', () => {
    assert.ok(KEEP, 'keepTypedCosts is a top-level function of js/app.js');
    const fn = new Function(KEEP + '; return keepTypedCosts;')();
    const prev = [row({ custom: [], m: 1, lab: 2 }), row({ custom: [{ m: 3, lab: 4 }] }, { i: 1, n: 'Sink', kc: { kcId: 'K2', kind: 'sink', typed: { custom: [{ m: 3, lab: 4 }] } } })];
    const rows = [row(null), row({ custom: [{ m: null, lab: null }] }, { i: 1, n: 'Sink', kc: { kcId: 'K2', kind: 'sink', typed: { custom: [{ m: null, lab: null }] } } })];
    const frozen = JSON.parse(JSON.stringify([rows, prev]));
    const out = plain(fn(rows, prev));
    assert.deepEqual(out[0].kc.typed, { custom: [], m: 1, lab: 2 }, 'not known: the stored costs');
    assert.deepEqual(out[1].kc.typed, { custom: [{ m: null, lab: null }] }, 'known (a row of nulls): replaces');
    assert.equal(out[0].kc.M, 100, 'every other field is the new row\'s'); assert.deepEqual(plain([rows, prev]), frozen, 'inputs untouched');
    for (const other of [row(null, { n: 'Renamed' }), row(null, { kc: { kcId: 'K1', kind: 'sink', typed: null } }), row(null, { kc: { kcId: 'K7', kind: 'custom', typed: null } }), row(null, { kc: { kind: 'custom', typed: null } })])
      assert.equal(plain(fn([other], prev))[0].kc.typed, null, 'a row that is not the same line keeps null');
    assert.equal(plain(fn([row(null)], [row(null)]))[0].kc.typed, null, 'nothing stored to keep');
    for (const junk of [null, undefined, 'x', 5, {}]) { assert.equal(fn(junk, prev), junk); assert.deepEqual(plain(fn(rows, junk)), plain(rows)); }
    assert.deepEqual(plain(fn([null, { i: 2 }, { i: 3, kc: null }], prev)), [null, { i: 2 }, { i: 3, kc: null }]);
  });
  it('QUOTE_UPDATE (update in place) with a line the page does not know the typed costs of: the stored typed costs survive the write; everything else in the sidecar is the new one', async () => {
    const b = makeBridge({ 'quote_costs/bk_quotes_q1': sidecarOf([row({ custom: [], m: 999, lab: 88 })], { kcSummary: { v: 1, net: 1 } }) });
    await b.send('QUOTE_UPDATE', quote(), { docId: 'q1', collection: 'bk_quotes', costSidecar: sidecarOf([row(null)]) });
    const w = b.sets.filter(s => s.key === 'quote_costs/bk_quotes_q1'); assert.equal(w.length, 1, 'one write');
    assert.deepEqual(w[0].body.items[0].kc.typed, { custom: [], m: 999, lab: 88 }, 'the cost basis is kept'); assert.equal(w[0].body.kcSummary.net, 4000, 'the summary is the new one');
    assert.equal(w[0].body.quoteDocId, 'q1'); assert.equal(w[0].body.createdBy, 'u-sales');
  });
  it('the builder\'s own word replaces: typed as an object (the person cleared the costs on a line the page knows) overwrites, and no read is made when no row says "not known"', async () => {
    const b = makeBridge({ 'quote_costs/bk_quotes_q1': sidecarOf([row({ custom: [], m: 999, lab: 88 })]) });
    await b.send('QUOTE_UPDATE', quote(), { docId: 'q1', collection: 'bk_quotes', costSidecar: sidecarOf([row({ custom: [], m: null, lab: null })]) });
    assert.deepEqual(b.sets.filter(s => s.key === 'quote_costs/bk_quotes_q1')[0].body.items[0].kc.typed, { custom: [], m: null, lab: null });
    assert.equal(b.reads.some(r => r.startsWith('quote_costs/')), false, 'no read of the stored sidecar');
  });
  it('a stored sidecar that is missing, cannot be read, or does not answer in time never blocks the write: the rows go as they are', { timeout: 8000 }, async () => {
    for (const [why, docs, opt] of [['missing', {}, {}], ['fails', { 'quote_costs/bk_quotes_q1': sidecarOf([row({ custom: [], m: 1, lab: 2 })]) }, { failGet: true }]]) {
      const b = makeBridge(docs, opt);
      await b.send('QUOTE_UPDATE', quote(), { docId: 'q1', collection: 'bk_quotes', costSidecar: sidecarOf([row(null)]) });
      assert.equal(b.sets.filter(s => s.key === 'quote_costs/bk_quotes_q1')[0].body.items[0].kc.typed, null, why);
    }
    const hang = makeBridge({ 'quote_costs/bk_quotes_q1': sidecarOf([row({ custom: [], m: 1, lab: 2 })]) }, { hangGet: true }); hang.ctx.setTimeout = (fn) => { fn(); return 0; };      // the 4 s cap fires at once
    await hang.send('QUOTE_UPDATE', quote(), { docId: 'q1', collection: 'bk_quotes', costSidecar: sidecarOf([row(null)]) });
    assert.equal(hang.sets.filter(s => s.key === 'quote_costs/bk_quotes_q1').length, 1, 'still written');
  });
  it('a draft autosave and a draft save keep the stored typed costs of that draft too (a resumed draft never reads them back)', async () => {
    const b = makeBridge({ 'quote_costs/bk_quotes_draft_u-sales': sidecarOf([row({ custom: [], m: 5, lab: 6 })]) });
    await b.send('QUOTE_DRAFT', quote(), { costSidecar: sidecarOf([row(null)]) });
    assert.deepEqual(b.sets.filter(s => s.key === 'quote_costs/bk_quotes_draft_u-sales')[0].body.items[0].kc.typed, { custom: [], m: 5, lab: 6 });
    const named = makeBridge({ 'bk_quotes/d9': { status: 'draft' }, 'quote_costs/bk_quotes_d9': sidecarOf([row({ custom: [], m: 7, lab: 8 })]) });
    await named.send('QUOTE_SAVE_DRAFT', quote(), { draftDocId: 'd9', costSidecar: sidecarOf([row(null)]) });
    assert.deepEqual(named.sets.filter(s => s.key === 'quote_costs/bk_quotes_d9')[0].body.items[0].kc.typed, { custom: [], m: 7, lab: 8 });
  });
  it('a NEW REVISION of a reopened quote (QUOTE_FILED, a new document) keeps the typed costs of the quote it was reopened from; a quote with no parent reads only its own (new) document', async () => {
    const b = makeBridge({ 'quote_costs/bk_quotes_q1': sidecarOf([row({ custom: [], m: 999, lab: 88 })]) });
    await b.send('QUOTE_FILED', quote({ parentQuoteId: 'q1', rootQuoteId: 'q1' }), { costSidecar: sidecarOf([row(null)]) });
    const w = b.sets.filter(s => s.key.startsWith('quote_costs/') && s.key !== 'quote_costs/bk_quotes_q1');
    assert.equal(w.length, 1); assert.deepEqual(w[0].body.items[0].kc.typed, { custom: [], m: 999, lab: 88 });
    assert.deepEqual(stored(b, 'quote_costs/bk_quotes_q1').items[0].kc.typed, { custom: [], m: 999, lab: 88 }, 'the first copy is untouched');
    const alone = makeBridge({}); await alone.send('QUOTE_FILED', quote(), { costSidecar: sidecarOf([row(null)]) });
    assert.deepEqual(alone.reads.filter(r => r.startsWith('quote_costs/')), ['quote_costs/bk_quotes_new1']);
  });
  it('the sidecar write keeps its shape: the whole document is replaced (set, no merge), the call sites are as they were, and a bridge without the helper still writes', async () => {
    assert.match(LISTENER, /await db\.collection\('quote_costs'\)\.doc\(coll \+ '_' \+ id\)\.set\(\{\s*\.\.\.sc, items: rows, quoteColl: coll, quoteDocId: id,/);
    assert.equal((LISTENER.match(/saveCostSidecar\(coll, docRef\.id\)/g) || []).length, 2); assert.match(LISTENER, /saveCostSidecar\(collection, docId\)/);
    const b = makeBridge({ 'quote_costs/bk_quotes_q1': sidecarOf([row({ custom: [], m: 9, lab: 9 })]) }, { noKeep: true });
    await b.send('QUOTE_UPDATE', quote(), { docId: 'q1', collection: 'bk_quotes', costSidecar: sidecarOf([row(null)]) });
    assert.equal(b.sets.filter(s => s.key === 'quote_costs/bk_quotes_q1').length, 1, 'no helper (an older app file): the write is the old one');
  });
});

// ═════════════════════════════ Fable review F8 (2026-11-20): the top bar, the Estimator link, the way back ═════════════════════════════
// A small tree of nodes stands in for the page: .topbar-right (with ❓ Help), the phone menu sheet (header, rows, a divider) and the search row (with "Add custom item").  The real d7-flow.js draws into it.
describe('Fable review F8: the two screen buttons are the President\'s and Purchasing\'s; everyone else gets one text link beside "Add custom item", and a way back from a screen', () => {
  function node(tag, id = '', cls = '') {
    const n = { tag, id, className: cls, children: [], parentNode: null, attrs: {}, dataset: {}, textContent: '', style: {}, hidden: false,
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : (k === 'id' ? this.id : null); },
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
      insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
      get nextSibling() { const p = this.parentNode; return p ? (p.children[p.children.indexOf(this) + 1] || null) : null; },
      get firstChild() { return this.children[0] || null; },
      get classList() { const o = this; return { add(c) { if (!o.className.split(' ').includes(c)) o.className = (o.className + ' ' + c).trim(); }, remove(c) { o.className = o.className.split(' ').filter(x => x !== c).join(' '); }, toggle(c, f) { f ? this.add(c) : this.remove(c); }, contains: c => o.className.split(' ').includes(c) }; },
      querySelector(sel) { const want = sel.replace(/^\./, ''); const all = (x) => x.children.flatMap(c => [c, ...all(c)]); return all(this).find(c => c.className.split(' ').includes(want)) || null; },
      closest(sel) { for (let x = this; x; x = x.parentNode) { if (sel === '[data-d7]' && 'd7' in x.dataset) return x; if (sel.startsWith('#') && x.id === sel.slice(1)) return x; } return null; } };
    return n;
  }
  function page(role, { kc = true, builder = true } = {}) {
    const env = readyEnv(role); env.run(`quoteEngine = "${kc ? 'kc1' : 'legacy'}"`);
    const body = node('body'), bar = node('div', '', 'topbar-right'), help = node('button', 'btnHelp'), row = node('div', 'productSearchRow'), add = node('button', 'btnAddCustomItem'), sheet = node('div', 'mtbSheet');
    const hdr = node('div', '', 'mtb-sheet-hdr'), r1 = node('button', 'mtbHelp', 'mtb-row'), div = node('div', '', 'mtb-divider');
    bar.appendChild(help); row.appendChild(add); row.appendChild(node('button', 'btnImportItems')); sheet.appendChild(hdr); sheet.appendChild(r1); sheet.appendChild(div);
    [bar, row, sheet].forEach(x => body.appendChild(x));
    const find = (root, id) => { if (root.id === id) return root; for (const c of root.children) { const f = find(c, id); if (f) return f; } return null; };
    const doc = env.win.document; const listeners = {};
    doc.createElement = tag => node(tag); doc.getElementById = id => find(body, id); doc.querySelector = sel => (sel === '.topbar-right' ? bar : (sel === '.main' ? null : null));
    doc.addEventListener = (t, fn) => { listeners[t] = fn; }; doc.contains = () => true; doc.body = Object.assign(doc.body, { appendChild: c => body.appendChild(c), removeAttribute() {}, classList: doc.body.classList });
    void builder;
    return { env, body, bar, row, sheet, ids: root => root.children.map(c => c.id || c.className), find: id => find(body, id), listeners, click: el => listeners.click({ target: el, preventDefault() {} }) };
  }
  it('the President and Purchasing: both buttons in the bar (before Help) and in the phone menu, on a KC quote and on a legacy one; no Estimator link', () => {
    for (const role of ['president', 'purchasing']) for (const kc of [true, false]) {
      const p = page(role, { kc }); p.env.D7.flow.syncButtons();
      assert.deepEqual(p.ids(p.bar), ['d7BtnPrices', 'd7BtnSettings', 'btnHelp'], role + ' kc=' + kc);
      assert.deepEqual(p.ids(p.sheet), ['mtb-sheet-hdr', 'mtbHelp', 'd7MtbPrices', 'd7MtbSettings', 'mtb-divider'], role + ' kc=' + kc);
      assert.equal(p.find('d7LnkPrices'), null, role + ': the buttons are enough');
      assert.equal(p.find('d7BtnPrices').textContent, '🧱 Materials price list'); assert.equal(p.find('d7BtnPrices').getAttribute('data-screen'), 'prices');
    }
  });
  it('Sales and Operations on a KC quote: no button in the bar, no row in the menu; one text link "Materials price list" right after "Add custom item"; on a legacy quote nothing at all', () => {
    for (const role of ['sales', 'manager']) {
      const p = page(role, { kc: true }); p.env.D7.flow.syncButtons();
      assert.deepEqual(p.ids(p.bar), ['btnHelp'], role); assert.deepEqual(p.ids(p.sheet), ['mtb-sheet-hdr', 'mtbHelp', 'mtb-divider'], role);
      assert.deepEqual(p.ids(p.row), ['btnAddCustomItem', 'd7LnkPrices', 'btnImportItems'], role + ': right after Add custom item');
      const l = p.find('d7LnkPrices'); assert.equal(l.textContent, 'Materials price list'); assert.equal(l.getAttribute('data-d7'), 'screen'); assert.equal(l.getAttribute('data-screen'), 'prices'); assert.equal(l.tag, 'button'); assert.equal(l.type, 'button');
      assert.match(l.className, /d7-lnk-prices/); assert.match(l.className, /no-print/);
      p.env.D7.flow.syncButtons(); assert.equal(p.row.children.filter(c => c.id === 'd7LnkPrices').length, 1, 'drawn once, however often it syncs');
      const lg = page(role, { kc: false }); lg.env.D7.flow.syncButtons();
      assert.deepEqual(lg.ids(lg.bar), ['btnHelp']); assert.deepEqual(lg.ids(lg.row), ['btnAddCustomItem', 'btnImportItems']); assert.deepEqual(lg.ids(lg.sheet), ['mtb-sheet-hdr', 'mtbHelp', 'mtb-divider'], role + ': the legacy builder is untouched');
    }
  });
  it('the link follows the quote and the person: it goes when the quote stops being a KC one or the role becomes the President\'s, and comes back with the quote', () => {
    const p = page('sales'); p.env.D7.flow.syncButtons(); assert.ok(p.find('d7LnkPrices'));
    p.env.run('quoteEngine = "legacy"'); p.env.D7.flow.syncButtons(); assert.equal(p.find('d7LnkPrices'), null);
    p.env.run('quoteEngine = "kc1"'); p.env.D7.flow.syncButtons(); assert.ok(p.find('d7LnkPrices'));
    p.env.KC.S.role = 'president'; p.env.D7.flow.syncButtons(); assert.equal(p.find('d7LnkPrices'), null); assert.ok(p.find('d7BtnPrices'), 'the role became known (KCLive.load): the buttons arrive');
    p.env.KC.S.role = 'sales'; p.env.D7.flow.syncButtons(); assert.equal(p.find('d7BtnPrices'), null); assert.equal(p.find('d7MtbSettings'), null); assert.ok(p.find('d7LnkPrices'));
  });
  it('a way back is always there while a screen is open: the bar button and, for a person without the two menu rows, one "Quote builder" row at the top of the phone menu; both go when the builder is back', () => {
    const p = page('sales'); p.env.D7.flow.boot();
    p.env.KC.S.screen2 = 'prices'; p.env.D7.flow.syncButtons();
    assert.equal(p.bar.children[0].id, 'd7BtnBack'); assert.equal(p.find('d7BtnBack').getAttribute('data-screen'), 'builder');
    assert.deepEqual(p.ids(p.sheet), ['mtb-sheet-hdr', 'd7MtbBack', 'mtbHelp', 'mtb-divider']); assert.equal(p.find('d7MtbBack').textContent, '← Quote builder');
    p.click(p.find('d7MtbBack')); assert.equal(p.env.KC.S.screen2, 'builder', 'pressing it goes back to the quote');
    assert.equal(p.find('d7BtnBack'), null); assert.equal(p.find('d7MtbBack'), null);
    const pres = page('president'); pres.env.D7.flow.boot(); pres.env.KC.S.screen2 = 'settings'; pres.env.D7.flow.syncButtons();
    assert.ok(pres.find('d7BtnBack')); assert.equal(pres.find('d7MtbBack'), null, 'the President leaves by pressing the row of the open screen (as before)');
    assert.equal(pres.find('d7MtbSettings').getAttribute('aria-pressed'), 'true');
  });
  it('the link opens the screen through the same click handler as the buttons (data-d7="screen"); the materials screen then shows the prices to every role (Q67), and the settings screen is not reachable from it', () => {
    const p = page('sales'); p.env.D7.flow.boot(); p.env.D7.flow.syncButtons();
    p.click(p.find('d7LnkPrices')); assert.equal(p.env.KC.S.screen2, 'prices');
    const src = fs.readFileSync(path.join(QB, 'd7/d7-flow.js'), 'utf8'); assert.match(src, /case 'screen':/);
    assert.equal(p.find('d7LnkPrices').getAttribute('data-screen'), 'prices');
  });
  it('the stylesheet has the link\'s rules (one small text link, a 44 px target on a phone, never printed)', () => {
    const css = fs.readFileSync(path.join(QB, 'd7/d7-flow.css'), 'utf8');
    assert.match(css, /#productSearchRow \.d7-lnk-prices\{[^}]*text-decoration:underline/); assert.match(css, /@media\(max-width:768px\)\{ #productSearchRow \.d7-lnk-prices\{min-height:44px/); assert.match(css, /@media print\{[^}]*\.d7-lnk-prices\{display:none!important;\}/);
  });
});

// ═════════════════════════════ Fable review F10 (2026-11-20): the switch allows this person but the prices did not load ═════════════════════════════
describe('Fable review F10: KCLive.failedForUser — the switch gives this person the configurators, the prices did not load', () => {
  const sw = (kcMode) => seedDocs({ 'settings/quote_builder': { kcMode } });
  it('offline and denied, with the switch on for this person: true; loaded, loading and idle: false; the switch off, or on for the President only and this is Sales: false', async () => {
    const down = await loaded(sw('on'), { fail: ['kc_materials'] }, {}); assert.equal(down.KCLive.state, 'offline'); assert.equal(down.KCLive.failedForUser(), true, 'a read failed');
    const denied = await loaded(sw('on'), { deny: ['kc_materials'] }); assert.equal(denied.KCLive.state, 'denied'); assert.equal(denied.KCLive.failedForUser(), true, 'denied');
    const empty = sw('on'); for (const k of Object.keys(empty)) if (k.startsWith('kc_materials/')) delete empty[k];
    const none = await loaded(empty); assert.equal(none.KCLive.state, 'offline'); assert.equal(none.KCLive.failedForUser(), true, 'no prices imported yet');
    const ok = await loaded(sw('on')); assert.equal(ok.KCLive.state, 'live'); assert.equal(ok.KCLive.failedForUser(), false, 'it loaded');
    const idle = makeEnv({ db: makeFakeDb(sw('on')) }); assert.equal(idle.KCLive.failedForUser(), false, 'idle'); void idle.KCLive.load(); assert.equal(idle.KCLive.failedForUser(), false, 'loading');
    const off = await loaded(sw('off'), { deny: ['kc_materials'] }); assert.equal(off.KCLive.failedForUser(), false, 'the switch is off: nothing was expected');
    const sales = await loaded(seedDocs({ 'settings/quote_builder': { kcMode: 'president' }, 'users/u-pres': { role: 'employee', departments: ['Sales'] } }), { deny: ['kc_materials'] });
    assert.equal(sales.KCLive.role, 'sales'); assert.equal(sales.KCLive.failedForUser(), false, 'president-only switch, a Sales person');
    const pres = await loaded(sw('president'), { deny: ['kc_materials'] }); assert.equal(pres.KCLive.role, 'president'); assert.equal(pres.KCLive.failedForUser(), true, 'president-only switch, the President');
  });
  it('the device override counts: forced on says so when the prices failed, forced off never does', async () => {
    const e = await loaded(sw('off'), { deny: ['kc_materials'] }); e.win.localStorage.setItem('bkqb_kc_force', '1'); assert.equal(e.KCLive.failedForUser(), true);
    const f = await loaded(sw('on'), { deny: ['kc_materials'] }); f.win.localStorage.setItem('bkqb_kc_force', '0'); assert.equal(f.KCLive.failedForUser(), false);
  });
  it('allowsNew is what it was: only with the prices in, and the same switch rules', async () => {
    const ok = await loaded(sw('on')); assert.equal(ok.KCLive.allowsNew(), true);
    const bad = await loaded(sw('on'), { deny: ['kc_materials'] }); assert.equal(bad.KCLive.allowsNew(), false, 'no prices, no new configured quote');
    const p = await loaded(sw('president')); assert.equal(p.KCLive.allowsNew(), true);
    const s = await loaded(seedDocs({ 'settings/quote_builder': { kcMode: 'president' }, 'users/u-pres': { role: 'employee', departments: ['Sales'] } })); assert.equal(s.KCLive.allowsNew(), false);
  });
  it('a SLOW price list (the 6 s cap) still knows the switch and the person when those reads answered: the message is not lost to a timeout, and the prices are still not applied', async () => {
    const env = makeEnv({ db: makeFakeDb(sw('on'), { hang: ['kc_materials'] }) });
    const p = env.KCLive.load(); for (let i = 0; i < 12; i++) await Promise.resolve();
    const t = env.timers.find(x => x && x.fn && x.ms === 6000); assert.ok(t, 'the 6 s cap'); t.fn(); await p;
    assert.equal(env.KCLive.state, 'offline'); assert.equal(env.KCLive.ready, false); assert.equal(env.KCLive.flags.kcMode, 'on', 'the switch that did answer'); assert.equal(env.KCLive.role, 'president', 'and who this is');
    assert.equal(env.KCLive.failedForUser(), true); assert.equal(env.KC.P.sh12.p, null, 'no price was applied from a half-read list');
    const none = makeEnv({ db: makeFakeDb(sw('on'), { hang: ['settings'] }) });
    const q = none.KCLive.load(); for (let i = 0; i < 12; i++) await Promise.resolve(); const t2 = none.timers.find(x => x && x.fn && x.ms === 6000); t2.fn(); await q;
    assert.equal(none.KCLive.state, 'offline'); assert.equal(none.KCLive.flags.kcMode, 'off', 'a switch that did not answer is off'); assert.equal(none.KCLive.failedForUser(), false);
  });
});

// ═════════════════════════════ Fable review F12 (2026-11-20): one sentence for the review rule ═════════════════════════════
describe('Fable review F12: the line chip and the panel say the same about a line that needs review', () => {
  it('the chip says the quote goes to the President for approval (the panel\'s own sentence), and no longer says it cannot be filed', () => {
    const env = readyEnv('sales'); env.KC.addLine('custom', { cat: 'prep', name: 'Cart', desc: '', dims: '', rows: [{ k: 'sh12', q: 1 }], m: null, lab: 50 }, { render: false });
    const html = env.D7.h('adapter.lineRow', itemsOf(env)[0], 0);
    assert.match(html, /The President or Operations reviews it; until then the quote goes to the President for approval\./); assert.equal(/cannot be filed until then/.test(html), false);
    const host = fs.readFileSync(path.join(QB, 'kc/host-d7.js'), 'utf8');
    assert.ok(host.includes('until then the quote goes to the President for approval.'), 'the panel says it');
    assert.match(env.D7.h('flow.approvalReason'), /need review/, 'and Verify & File really does send it for approval');
  });
});

describe('owner 2026-11-20 "pdf has too large margins": the quotation asks the PDF engine for no margin of its own; other forms keep the default', () => {
  it('d7-doc.js passes margin 0 to FormsPdf.download, forms-pdf forwards it per page, pdf-lite uses it and keeps MARGIN otherwise', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'qb/d7/d7-doc.js'), 'utf8'), fp = fs.readFileSync(path.join(ROOT, 'js/forms-pdf.js'), 'utf8'), pl = fs.readFileSync(path.join(ROOT, 'js/pdf-lite.js'), 'utf8');
    assert.match(doc, /FormsPdf\.download\(built\.node, name, \{ cutSelector: '\.d7-a4-page', keepNextSelector: '\[data-pdf-no-keep\]', margin: 0 \}\)/);
    assert.match(fp, /typeof opts\.margin === 'number' \? \{ margin: opts\.margin \} : \{\}/);
    assert.match(pl, /var m = \(typeof p\.margin === 'number' && p\.margin >= 0 && p\.margin < 100\) \? p\.margin : MARGIN;/);
    assert.match(pl, /var scale = Math\.min\(\(pageW - 2 \* m\) \/ p\.pxW, \(pageH - 2 \* m\) \/ p\.pxH\);/);
  });
});
