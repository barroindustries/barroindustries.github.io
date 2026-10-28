// tests/grade-percent-parity.test.mjs — specs/GRADE-PERCENT-SPEC.md §4.2: the PUBLIC path is untouched by the SS316 percentage.
//
// The steel grade became a PERCENT group in schema 5 (js/pricing-core.js), but a visitor to the website can only ever build SS304: public validation refuses every other
// grade, so qrEstimate / qrSubmit never read the grade cell. Every line the website prices must therefore come out EXACTLY as it did when the grade was an ordinary
// { flat, perW100 } cell. tests/fixtures/pricing-core.schema4.js is js/pricing-core.js verbatim at schema 4 — a frozen oracle (its sha256 is pinned below).
//
//   1. 600 seeded random PUBLIC lines — all eleven families, random public options, sizes and quantities, random option sheets in which the grade cell is sometimes a pct, sometimes blank,
//      sometimes the schema-4 { flat, perW100 } shape, and the sheet is sometimes unapproved or approved against another schema, with random materials multipliers:
//      priceConfiguredItem of the NEW module is deepEqual to the oracle's, field for field (unitPrice, priced, reason, base, missing, deltas, sizeAdjusted).
//   2. functions/qr-core.js computeBasket — the server's pricer, the thing that makes the figure a visitor sees — gives a deepEqual basket with either module behind it
//      (the oracle is injected in place of './pricing-core' while qr-core loads; a control proves the injection really swaps the pricer).
//   3. the oracle is frozen, and the module qr-core runs is the one tested here (functions/pricing-core.js is js/pricing-core.js byte for byte).
//
// Fixtures are SYNTHETIC odd-figure pesos and fake percentages (the repository is public; the real sheets are private).
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const NEW = require('../js/pricing-core.js');
const OLD = require('./fixtures/pricing-core.schema4.js');
const PF = require('../js/product-families.js');
const FAMS = require('../js/qr-families.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIDS = FAMS.order;
const fam = (id) => FAMS.families[id];

// mulberry32 — a tiny deterministic PRNG so every sweep is reproducible (never Math.random in a pinned test)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

// ── synthetic catalogue: one primary SKU per family (odd figures; the five length-priced families' primaries carry a length rule, the three linear families' do not) ──
const prod = (id, category, formulaType, basePrice, defaultDimensions, formula) => ({ id, category, name: id, formulaType, basePrice, defaultDimensions, formula, specs: [], unit: 'pc' });
const PRIMARIES = {
  prep_table: prod('PW-001', 'preparation', 'per_length', 4217, { W: 900, D: 600, H: 850 }, { baseLengthMm: 900, pricePerExtraMm: 3.3, rateD100: 31, rateH100: 17 }),
  sink: prod('PW-004', 'washing', 'per_length', 6173, { W: 500, D: 500, H: 850 }, { baseLengthMm: 500, pricePerExtraMm: 4.1, rateD100: 29, rateH100: 13 }),
  stove: prod('CE-001', 'cooking', 'per_length', 7770, { W: 600, D: 700, H: 850 }, { baseLengthMm: 600, pricePerExtraMm: 5.7, rateD100: 41, rateH100: 0 }),
  cabinet: prod('PW-015', 'storage', 'per_length', 5119, { W: 600, D: 500, H: 1800 }, { baseLengthMm: 600, pricePerExtraMm: 2.9, rateD100: 23 }),
  wall_shelf: prod('PW-023', 'storage', 'fixed', 1893, { W: 1200, D: 450 }, {}),
  rack: prod('PW-010', 'storage', 'per_length', 3307, { W: 600, D: 500, H: 1600 }, { baseLengthMm: 600, pricePerExtraMm: 2.3, rateD100: 19, rateH100: 11 }),
  dish_table: prod('PW-029', 'washing', 'fixed', 2719, { W: 1200, D: 660, H: 851 }, {}),
  wok_range: prod('CE-006', 'cooking', 'per_length', 5233, { W: 600, D: 700, H: 850 }, { baseLengthMm: 600, pricePerExtraMm: 4.7, rateD100: 37, rateH100: 0 }),
  cooking_line: prod('CE-010', 'cooking', 'per_length', 4349, { W: 700, D: 700, H: 850 }, { baseLengthMm: 700, pricePerExtraMm: 3.9, rateD100: 33, rateH100: 0 }),
  deck_oven: prod('CE-012', 'cooking', 'fixed', 9871, { W: 700, D: 700, H: 1400 }, {}),
  hood: prod('EX-001', 'ventilation', 'per_length', 3571, { W: 1000, D: 900, H: 500 }, { baseLengthMm: 1000, pricePerExtraMm: 2.1, rateD100: 27, rateH100: 0 }),
};
const PRIMARY_MAP = new Map(Object.entries(PRIMARIES));

// a random PUBLIC line: public options only (the staff-only grade and top plate stay at their defaults, as public validation insists), valid sizes, quantities up to 20
function randomLine(r, familyId) {
  const f = fam(familyId);
  for (let attempt = 0; attempt < 300; attempt++) {
    const config = {};
    for (const g of f.groups) {
      if (g.staffOnly === true) { config[g.key] = JSON.parse(JSON.stringify(g.default)); continue; }
      if (!PF.groupApplies(f, g, config)) { config[g.key] = JSON.parse(JSON.stringify(g.default)); continue; }
      if (g.type === 'choice') config[g.key] = pick(r, g.options).v;
      else if (g.type === 'slots') { const n = g.minSlots + Math.floor(r() * (g.maxSlots - g.minSlots + 1)); config[g.key] = Array.from({ length: n }, () => pick(r, g.options).v); }
      else config[g.key] = g.options.filter(() => r() < 0.4).map((o) => o.v);
    }
    const size = {};
    for (const [k, d] of Object.entries(f.dims)) size[k] = r() < 0.4 ? d.default : d.min + d.step * Math.floor(r() * ((d.max - d.min) / d.step + 1));
    const mw = PF.minWidth(f, config);
    if (mw && mw.hard && size.W < mw.mm) size.W = mw.mm;
    Object.entries(PF.forcedMins(f, config)).forEach(([k, m]) => { if (size[k] < m) size[k] = m; });
    Object.entries(PF.forcedMaxes(f, config)).forEach(([k, m]) => { if (size[k] > m) size[k] = m; });
    if (mw && !mw.hard && r() < 0.5) { const room = (mw.mm - f.dims.W.min) / f.dims.W.step; if (room >= 1) size.W = f.dims.W.min + f.dims.W.step * Math.floor(r() * room); }   // the SOFT rule: a body shorter than the burners need
    const v = PF.validateLine(f, config, size);                 // PUBLIC mode: no { staff: true }
    if (v.ok) return { config: v.config, size: v.dims, qty: 1 + Math.floor(r() * 20) };
  }
  throw new Error('could not draw a valid public line for ' + familyId);
}

// a random option sheet: every non-baseline cell a figure (some signed, some with a per-100-mm rate, some fractional), some blank; the grade cell sometimes a pct, sometimes blank,
// sometimes absent, sometimes the schema-4 shape; the sheet sometimes unapproved or approved against another schema version; a length rate for the linear families
function randomSheet(r, familyId) {
  const f = fam(familyId);
  const options = {};
  let i = 0;
  for (const c of PF.cells(f)) {
    if (c.baseline) continue;
    if (c.group === 'grade') {
      const k = Math.floor(r() * 5);
      if (k === 0) (options.grade = options.grade || {})[c.value] = { pct: pick(r, [0, 12.5, 37, -10, 100, 250.25]) };
      else if (k === 1) (options.grade = options.grade || {})[c.value] = { pct: null };
      else if (k === 2) (options.grade = options.grade || {})[c.value] = { flat: 2917, perW100: 31 };
      else if (k === 3) (options.grade = options.grade || {})[c.value] = { pct: 37, flat: 2917 };
      continue;                                                                   // k === 4: no grade group at all
    }
    i++;
    const blank = r() < 0.12;
    const flat = (r() < 0.2 ? -1 : 1) * (311 + 97 * i + (r() < 0.3 ? 0.5 : 0));
    (options[c.group] = options[c.group] || {})[c.value] = { flat: blank ? null : flat, perW100: r() < 0.4 ? 13 + i + (r() < 0.3 ? 0.25 : 0) : null };
  }
  const u = r();
  return {
    familyId, schemaVersion: u < 0.06 ? FAMS.version - 1 : u < 0.09 ? FAMS.version + 1 : FAMS.version, approved: r() > 0.07, approvedBy: 'u_syn', options,
    size: { perW100: f.sizeBasis === 'linear' ? (r() < 0.12 ? null : (familyId === 'deck_oven' ? 0 : 50 + Math.floor(r() * 60))) : null },
  };
}

// functions/qr-core.js with a given pricing module behind './pricing-core' (the oracle is injected while qr-core loads; the real module is the default)
function loadQrCoreWith(pricingModule) {
  const qrPath = require.resolve('../functions/qr-core.js');
  const cached = require.cache[qrPath];
  delete require.cache[qrPath];
  const orig = Module._load;
  Module._load = function (request, parent) {
    if (request === './pricing-core' && parent && parent.filename === qrPath) return pricingModule;
    return orig.apply(this, arguments);
  };
  try { return require(qrPath); } finally { Module._load = orig; if (cached) require.cache[qrPath] = cached; else delete require.cache[qrPath]; }
}

describe('the schema-4 oracle is frozen, and what qr-core runs is what is tested', () => {
  it('tests/fixtures/pricing-core.schema4.js is pinned by its sha256 (a deliberate, re-pinned edit — never a side effect)', () => {
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'tests/fixtures/pricing-core.schema4.js'))).digest('hex');
    assert.equal(h, '514052434465145fcf1da041227a8e02aa32799ddb42bd510bc4a4fd099f244d');
  });
  it('the oracle IS a schema-4 pricer: it prices an SS316 line from a { flat } cell and knows no percentage, while the real module prices a pct cell and ignores a flat (control)', () => {
    const f = fam('sink'), prim = PRIMARIES.sink;
    const cfg = { ...PF.defaultConfig(f), grade: 316 };
    const dims = PF.defaultDims(f);
    const sheet = (cell) => ({ approved: true, schemaVersion: FAMS.version, options: { grade: { 316: cell } }, size: { perW100: null } });
    const o = { schemaVersion: FAMS.version };
    const oldFlat = OLD.priceConfiguredItem(prim, f, cfg, dims, sheet({ flat: 2917, perW100: null }), {}, o);
    assert.equal(oldFlat.priced, true); assert.deepEqual(oldFlat.deltas, [{ key: 'grade:316', amount: 2917 }]);
    assert.equal(OLD.priceConfiguredItem(prim, f, cfg, dims, sheet({ pct: 37 }), {}, o).priced, false, 'the oracle cannot read a pct');
    const newFlat = NEW.priceConfiguredItem(prim, f, cfg, dims, sheet({ flat: 2917, perW100: null }), {}, o);
    assert.equal(newFlat.priced, false); assert.equal(newFlat.reason, 'missing_input');
    const newPct = NEW.priceConfiguredItem(prim, f, cfg, dims, sheet({ pct: 37 }), {}, o);
    assert.equal(newPct.priced, true); assert.deepEqual(newPct.deltas, [{ key: 'grade:316', amount: 6173 * 37 / 100 }]);
  });
  it('functions/pricing-core.js (what qr-core.js requires) is js/pricing-core.js byte for byte, and loadQrCoreWith really swaps the pricer behind computeBasket', () => {
    assert.ok(fs.readFileSync(path.join(ROOT, 'functions/pricing-core.js')).equals(fs.readFileSync(path.join(ROOT, 'js/pricing-core.js'))));
    const Qold = loadQrCoreWith(OLD), Qnew = loadQrCoreWith(NEW);
    assert.notEqual(Qold, Qnew);
    const f = fam('sink'), cfg = { ...PF.defaultConfig(f), grade: 316 }, size = PF.defaultDims(f);
    const handBuilt = [{ n: 1, kind: 'family', id: 'PW-004', familyId: 'sink', name: 'Sink', cat: 'washing', unit: 'pc', qty: 1, runs: null, size, sizeCustom: false, config: cfg, specs: [], note: '' }];
    const docs = [{ id: 'sink', data: { approved: true, schemaVersion: FAMS.version, options: { grade: { 316: { pct: 37 } } }, size: { perW100: null } } }];
    const run = (Q) => Q.computeBasket(handBuilt, new Map(), {}, undefined, { families: FAMS, primaries: PRIMARY_MAP, pricing: Q.buildPricingIndex(docs, FAMS) });
    assert.equal(run(Qnew).lines[0].priced, true, 'the new pricer prices a 316 line from a pct cell');
    assert.equal(run(Qold).lines[0].priced, false, 'the oracle behind qr-core cannot: the injection works');
  });
});

describe('PARITY — a PUBLIC (standard-grade) line prices byte-for-byte as it did at schema 4', () => {
  it('600 seeded random public lines x random sheets (grade cell a pct / blank / absent / the old shape; unapproved; another schema) x random materials multipliers: priceConfiguredItem is deepEqual, old vs new', () => {
    const r = rng(20261028);
    const seen = { lines: 0, priced: 0, byReason: {}, withDeltas: 0, byFamily: {}, multipliers: new Set(), custom: 0, qty: new Set() };
    for (let i = 0; i < 600; i++) {
      const fid = FIDS[i % FIDS.length];
      const line = randomLine(r, fid);
      const sheet = randomSheet(r, fid);
      const constants = { materialPriceIndexMultiplier: pick(r, [1, 1, 1.05, 0.97, 1.13]) };
      const args = [PRIMARIES[fid], fam(fid), line.config, line.size, sheet, constants, { schemaVersion: FAMS.version }];
      assert.equal(line.config.grade, 304, 'the premise: a public line is the standard grade');
      const was = OLD.priceConfiguredItem(...args), now = NEW.priceConfiguredItem(...args);
      assert.deepEqual(now, was, `line ${i} ${fid} ${JSON.stringify(line)}`);
      seen.lines++;
      if (now.priced) { seen.priced++; if (now.deltas.length) seen.withDeltas++; } else seen.byReason[now.reason] = (seen.byReason[now.reason] || 0) + 1;
      seen.byFamily[fid] = (seen.byFamily[fid] || 0) + 1;
      seen.multipliers.add(constants.materialPriceIndexMultiplier); seen.qty.add(line.qty);
      if (now.sizeAdjusted) seen.custom++;
    }
    // the sweep is not vacuous: every family; priced and unpriced outcomes; option deltas; several multipliers and quantities
    assert.equal(seen.lines, 600);
    assert.deepEqual(Object.keys(seen.byFamily).sort(), [...FIDS].sort());
    for (const id of FIDS) assert.ok(seen.byFamily[id] >= 54, id);
    assert.ok(seen.priced >= 150, `priced lines: ${seen.priced}`);
    assert.ok(seen.withDeltas >= 100, `priced lines with option deltas: ${seen.withDeltas}`);
    assert.ok((seen.byReason.not_approved || 0) >= 20, `not_approved: ${seen.byReason.not_approved}`);
    assert.ok((seen.byReason.missing_input || 0) >= 50, `missing_input: ${seen.byReason.missing_input}`);
    assert.ok(seen.custom >= 100, `custom sizes: ${seen.custom}`);
    assert.ok(seen.multipliers.size >= 3); assert.ok(seen.qty.size >= 10);
  });

  it('the same lines through functions/qr-core.js computeBasket (baskets of 1 to 4 lines, quantities up to 20): the basket is deepEqual with either pricing module behind it', () => {
    const Qold = loadQrCoreWith(OLD), Qnew = loadQrCoreWith(NEW);
    const r = rng(77);
    const seen = { baskets: 0, lines: 0, pricedLines: 0, exact: 0 };
    for (let b = 0; b < 160; b++) {
      const n = 1 + Math.floor(r() * 4);
      const lines = Array.from({ length: n }, (_, k) => { const fid = FIDS[(b * 3 + k * 5) % FIDS.length]; return { fid, ...randomLine(r, fid) }; });
      const raw = lines.map((l) => ({ familyId: l.fid, config: l.config, dims: l.size, qty: l.qty, note: '' }));
      const norm = Qnew.normaliseItems(raw, new Map(), { families: FAMS, primaries: PRIMARY_MAP });
      assert.equal(norm.ok, true, norm.errors.join('; '));
      const docs = [];
      for (const l of lines) if (!docs.some((d) => d.id === l.fid)) docs.push({ id: l.fid, data: randomSheet(r, l.fid) });
      const constants = { materialPriceIndexMultiplier: pick(r, [1, 1.05, 0.97]) };
      const basket = (Q) => Q.computeBasket(norm.items, new Map(), constants, undefined, { families: FAMS, primaries: PRIMARY_MAP, pricing: Q.buildPricingIndex(docs, FAMS) });
      const was = basket(Qold), now = basket(Qnew);
      assert.deepEqual(now, was, `basket ${b}`);
      seen.baskets++; seen.lines += now.lines.length; seen.pricedLines += now.pricedCount; seen.exact += now.exact;
    }
    assert.equal(seen.baskets, 160);
    assert.ok(seen.pricedLines >= 100, `priced lines: ${seen.pricedLines}`);
    assert.ok(seen.exact > 0);
  });
});
