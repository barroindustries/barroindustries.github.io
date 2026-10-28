// tests/qb-configured.test.mjs — js/qb-configured.js, the pure module behind the quote builder's CONFIGURATOR
// (specs/QUOTE-BUILDER-CONFIGURATOR-SPEC.md §2.2 / §4.5 / §5 R1 / §6.3 / §6.4 / §7 / §10.3 / §9).
//
// What is pinned:
//   1. PRICE PARITY (money): priceLine() equals functions/qr-core.js computeBasket() — the server that priced the figure the client saw
//      on the website — on unitPrice, priced, reason, missing, base, deltas and warnings, for 300 seeded random valid (family, config,
//      size) lines x 3 synthetic option sheets (approved / unapproved / blank cells) x random materials multipliers, including the
//      stove's SOFT width rule (priced at the usual length, said so) and the sink's HARD rule (never substituted).
//   2. THE COST BASIS of a configured line (§4.5): the nearest absorbed SKU (choice +1, multi Jaccard, slots multiset overlap; a tie goes to
//      the first SKU in map order), its cost scaled by configured-list / SKU-list clamped to [0.25, 4], labelled approximate.
//   3. THE AUTO-PRICER PREDICATE (R1), the estimate-range maths (§7), the website hand-off mapping (§6.1), the purpose / location tables
//      (§6.3 / §6.4) and the old-line migration (§10.3).
//   4. PURITY: no DOM, no Firebase, no clock, no randomness, no price figure in the module; it never mutates its inputs and never throws.
//   5. THE STAFF-ONLY TOP PLATE (owner ruling 2026-10-28, §14): the nearest-model match reads an ABSENT group as its default (the absorbed configurations never
//      state the 1.5 mm / 1.2 mm top plate), buildLine / migrateLegacyConfiguredLine validate in STAFF mode, a blank 1.2 mm cell is "missing input", and a
//      configured line sits in its base product's builder SECTION — never in the family's public category, and priceLine / fromRequestItem read an ABSENT group as its
//      default, so a request or draft stored before the top plate existed prices like the standard 1.5 mm configuration (section 9 at the end of the file).
//
//   6. THE FIVE FAMILIES OF 2026-10-28 (CONFIGURATOR-FAMILIES-2-SPEC §10.3): the parity sweep now draws from ALL ELEVEN families and passes unchanged (js/pricing-core.js is
//      untouched: a conditional option that does not apply is at its default, so it is never priced); a fryer prices its type and basket cells and NO burner cell, a griddle the
//      burner cell only; a six-tray deck oven at 1200 mm prices the 6-tray cell + the (zero) width rate, and without a width rate it is "Size" missing; the nearest-model match
//      finds CE-022 / CE-009 / CE-025 for a fryer with 3 / 2 baskets and a two-hole wok range with a rear burner, and a stove that asks for a wok burner no longer finds CE-006.
//
//   7. THE STAFF-ONLY STEEL GRADE AND THE LINE TITLES (owner rulings 2026-10-28, specs/CONFIGURATOR-GRADE-TITLES-SPEC.md, section 11 at the end of the file): buildLine /
//      migrateLegacyConfiguredLine name a line by PF.lineTitle ("SS Sink", "SS Range Stove Combination (Griller, Fryer)"; the family label only when there is no title or no
//      lineTitle), fromRequestItem retitles when it is given the family definitions AND PF and keeps the server's name otherwise, an ABSENT `grade` reads as the standard 304 (no
//      "Material" ever missing), the Material row is the first spec row, and a 316 line is priced from the sheet's grade cell exactly as the server's computeBasket prices it.
//
// Fixtures are SYNTHETIC odd-figure pesos (the repository is PUBLIC; the real price master and option sheets are private).
//
// Mutation-tested in scratch copies (never the shared tree) — each of these must fail here: dropping the soft-width substitution,
// applying it to hard rules too, pricing the asked size instead of the substituted one, a wrong schema version, a blank cell read as 0;
// the cost scale inverted / unclamped, a tie going to the LAST SKU, costing from the primary instead of the nearest SKU, hasBasis true on a
// zero cost; the auto-pricer treating 'website' or 'manual' as automatic or ignoring priceManual; MISCFEE counted in the comparable total,
// the discount forgotten, exclusive range bounds, low / high swapped; a priced hand-off line losing its website basis, an unpriced one
// getting the bare SKU's price; and so on. 2026-10-28: no default fill (the primary is no longer exact), buildLine validating in public mode (a 1.2 mm top builds nothing),
// the family's public category back in place of the base product's, a converted line moved out of its section, the catalogue passed to the migration ignored; priceLine pricing the
// raw configuration (or completing only the width rule, or overwriting a stated value, or filling only the top plate), fromRequestItem not completing / replacing the stored one.
// 2026-10-28 (the five new families, scratch copies under /private/tmp/.../cf2-ws1-mut/, each must fail here): validation that keeps a non-default value of an option that does not
// apply (a baskets cell then prices on a griddle), validation ignoring the forced maximum, pricing-core pricing the cell of a conditional option that does not apply, the nearest-model
// score ignoring the conditional groups' values, the nearest model replaced by the primary, an absent group no longer read as its default.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const QB = require('../js/qb-configured.js');
const PF = require('../js/product-families.js');
const PC = require('../js/pricing-core.js');
const FAM = require('../js/qr-families.js');
const Q = require('../functions/qr-core.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DEPS = { PF, PC, FAM };
const FIDS = FAM.order;
const fam = (id) => FAM.families[id];
// a configuration with EVERY group stated — the staff-only top plate (owner ruling 2026-10-28) at its default, as the validators return it. The
// absorbed configurations never state it, and priceConfiguredItem() reads a missing key as "a non-standard option", so a hand-built fixture is completed here.
const full = (f, cfg) => PF.validateConfiguration(f, cfg, { staff: true }).config;

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const noUndefined = (v, where = '$') => {
  if (v === undefined) throw new assert.AssertionError({ message: `undefined at ${where}` });
  if (v && typeof v === 'object') Object.keys(v).forEach((k) => noUndefined(v[k], `${where}.${k}`));
};

// mulberry32 — a tiny deterministic PRNG so every sweep is reproducible (never Math.random in a pinned test)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

// ═══════════════════════════ synthetic catalogue: one primary SKU per family, three option sheets ═══════════════════════════
const prod = (id, category, formulaType, basePrice, defaultDimensions, formula) => ({ id, category, name: id, formulaType, basePrice, defaultDimensions, formula, specs: [], unit: 'pc' });
const PRIMARIES = {
  prep_table: prod('PW-001', 'preparation', 'per_length', 4217, { W: 900, D: 600, H: 850 }, { baseLengthMm: 900, pricePerExtraMm: 3.3, rateD100: 31, rateH100: 17 }),
  sink: prod('PW-004', 'washing', 'per_length', 6173, { W: 500, D: 500, H: 850 }, { baseLengthMm: 500, pricePerExtraMm: 4.1, rateD100: 29, rateH100: 13 }),
  stove: prod('CE-001', 'cooking', 'per_length', 7770, { W: 600, D: 700, H: 850 }, { baseLengthMm: 600, pricePerExtraMm: 5.7, rateD100: 41, rateH100: 0 }),
  cabinet: prod('PW-015', 'storage', 'per_length', 5119, { W: 600, D: 500, H: 1800 }, { baseLengthMm: 600, pricePerExtraMm: 2.9, rateD100: 23 }),     // no rateH100: a custom height is "Size (height)" missing
  wall_shelf: prod('PW-023', 'storage', 'fixed', 1893, { W: 1200, D: 450 }, {}),                                                                       // the LINEAR family: its primary has no length rule
  rack: prod('PW-010', 'storage', 'per_length', 3307, { W: 600, D: 500, H: 1600 }, { baseLengthMm: 600, pricePerExtraMm: 2.3, rateD100: 19, rateH100: 11 }),
  // the five families of 2026-10-28 (synthetic odd figures; no height rate: a height is not a size of these families)
  dish_table: prod('PW-029', 'washing', 'fixed', 2719, { W: 1200, D: 660, H: 851 }, {}),                                                                 // LINEAR: a fixed base item, its length is priced from the sheet
  wok_range: prod('CE-006', 'cooking', 'per_length', 5233, { W: 600, D: 700, H: 850 }, { baseLengthMm: 600, pricePerExtraMm: 4.7, rateD100: 37, rateH100: 0 }),
  cooking_line: prod('CE-010', 'cooking', 'per_length', 4349, { W: 700, D: 700, H: 850 }, { baseLengthMm: 700, pricePerExtraMm: 3.9, rateD100: 33, rateH100: 0 }),
  deck_oven: prod('CE-012', 'cooking', 'fixed', 9871, { W: 700, D: 700, H: 1400 }, {}),                                                                  // LINEAR as well: its width follows the trays (the sheet's width rate is 0)
  hood: prod('EX-001', 'ventilation', 'per_length', 3571, { W: 1000, D: 900, H: 500 }, { baseLengthMm: 1000, pricePerExtraMm: 2.1, rateD100: 27, rateH100: 0 }),
};
const PRIMARY_MAP = new Map(Object.entries(PRIMARIES));

const GRADE_FLAT = 2917;       // the synthetic SS316 premium of every approved fixture sheet (an odd figure; the real amounts are private)
// kind: 'approved' (every non-standard cell has an amount, some per-100-mm rates, some negative) | 'unapproved' (the same, approved:false)
//       | 'blank' (approved, but every 4th cell is blank and the linear family has no length rate)
function sheetFor(familyId, kind) {
  const f = fam(familyId);
  const options = {};
  let i = 0;
  for (const c of PF.cells(f)) {
    // the staff-only steel grade (owner ruling 2026-10-28): its SS316 cell is a synthetic odd figure of its own, blank in the 'blank' kind — and it does not count in `i`, so every
    // other cell keeps exactly the figure and the blank pattern it had before the grade existed
    if (c.group === 'grade') { if (!c.baseline) (options.grade = options.grade || {})[c.value] = { flat: kind === 'blank' ? null : GRADE_FLAT, perW100: null }; continue; }
    i++;
    if (c.baseline) continue;
    const flat = (i % 7 === 3 ? -1 : 1) * (311 + 97 * i);
    const blank = kind === 'blank' && i % 4 === 0;
    (options[c.group] = options[c.group] || {})[c.value] = { flat: blank ? null : flat, perW100: (i % 4 === 1 && familyId !== 'deck_oven') ? 13 + i : null };      // (no cell of the deck oven scales with length: its width follows the trays)
  }
  return {
    familyId, schemaVersion: FAM.version, approved: kind !== 'unapproved', approvedBy: 'u_syn', options,
    // the length rate of a LINEAR family: wall shelving and the dish table have a rate; the deck oven's width follows its trays, so its rate is 0 ("Enter 0")
    size: { perW100: (f.sizeBasis === 'linear' && kind !== 'blank') ? (familyId === 'deck_oven' ? 0 : 77) : null },
  };
}
const SHEETS = Object.fromEntries(['approved', 'unapproved', 'blank'].map((k) => [k, Object.fromEntries(FIDS.map((id) => [id, sheetFor(id, k)]))]));
const sheetDocs = (kind) => FIDS.map((id) => ({ id, data: SHEETS[kind][id] }));

// ═══════════════════════════ random valid lines ═══════════════════════════
function randomLine(r, familyId) {
  const f = fam(familyId);
  for (let attempt = 0; attempt < 200; attempt++) {
    const config = {};
    for (const g of f.groups) {
      // a conditional option (fry baskets, a pre-rinse sink) is drawn only where it applies; elsewhere it stays at its default, as every validated configuration has it
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
    Object.entries(PF.forcedMaxes(f, config)).forEach(([k, m]) => { if (size[k] > m) size[k] = m; });          // a slim hood's depth, a deck oven's width
    if (mw && !mw.hard && r() < 0.45) { const room = (mw.mm - f.dims.W.min) / f.dims.W.step; if (room >= 1) size.W = f.dims.W.min + f.dims.W.step * Math.floor(r() * room); }   // the SOFT rule: a body shorter than the burners need
    const v = PF.validateLine(f, config, size);
    if (v.ok) return { config: v.config, size: v.dims, qty: 1 + Math.floor(r() * 5) };
  }
  throw new Error('could not draw a valid line for ' + familyId);
}

// the server's answer for one line: normaliseItems (the real validator) then computeBasket (the real pricer) with the same synthetic sheet
function serverLine(familyId, config, size, qty, sheetKind, constants) {
  const norm = Q.normaliseItems([{ familyId, config, dims: size, qty, note: '' }], new Map(), { families: FAM, primaries: PRIMARY_MAP });
  assert.equal(norm.ok, true, norm.errors.join('; '));
  const pricing = Q.buildPricingIndex(sheetDocs(sheetKind), FAM);
  const basket = Q.computeBasket(norm.items, new Map(), constants || {}, undefined, { families: FAM, primaries: PRIMARY_MAP, pricing });
  return { row: norm.items[0], line: basket.lines[0] };
}
const ours = (familyId, config, size, sheetKind, constants) => QB.priceLine(DEPS, { family: fam(familyId), primary: PRIMARIES[familyId], config, size, sheet: sheetKind === null ? null : SHEETS[sheetKind][familyId], constants });
const PARITY_KEYS = ['unitPrice', 'priced', 'reason', 'missing', 'base', 'deltas', 'warnings'];
const pickKeys = (o) => Object.fromEntries(PARITY_KEYS.map((k) => [k, o[k]]));

// ═══════════════════════════════════════ 1. PRICE PARITY ═══════════════════════════════════════
describe('priceLine — PARITY with functions/qr-core.js computeBasket (the server that priced the figure the client saw)', () => {
  it('330 seeded random valid lines (30 of each of the ELEVEN families) x 3 sheets (approved / unapproved / blank cells) x random materials multipliers: identical unitPrice, priced, reason, missing, base, deltas and warnings', () => {
    const r = rng(20261028);
    const seen = { lines: 0, priced: 0, byReason: {}, soft: 0, byFamily: {}, withDeltas: 0, multipliers: new Set() };
    for (let i = 0; i < 330; i++) {
      const familyId = FIDS[i % FIDS.length];
      const { config, size, qty } = randomLine(r, familyId);
      const constants = { materialPriceIndexMultiplier: pick(r, [1, 1, 1.05, 0.97, 1.13]) };
      seen.multipliers.add(constants.materialPriceIndexMultiplier);
      for (const kind of ['approved', 'unapproved', 'blank']) {
        const { row, line } = serverLine(familyId, config, size, qty, kind, constants);
        const mine = ours(familyId, row.config, row.size, kind, constants);
        assert.deepEqual(pickKeys(mine), pickKeys(line), `line ${i} ${familyId} ${kind} ${JSON.stringify({ config, size })}`);
        seen.lines++;
        if (mine.priced) { seen.priced++; if (mine.deltas.length) seen.withDeltas++; } else seen.byReason[mine.reason] = (seen.byReason[mine.reason] || 0) + 1;
        if (mine.warnings.length) seen.soft++;
        seen.byFamily[familyId] = (seen.byFamily[familyId] || 0) + 1;
      }
    }
    // the sweep is not vacuous: every family, priced and unpriced outcomes, option deltas, the soft-width substitution and several multipliers all occurred
    assert.equal(seen.lines, 990);
    assert.deepEqual(Object.keys(seen.byFamily).sort(), [...FIDS].sort());
    for (const id of FIDS) assert.equal(seen.byFamily[id], 90, id);
    assert.ok(seen.priced >= 150, `priced lines: ${seen.priced}`);
    assert.ok(seen.withDeltas >= 100, `priced lines with option deltas: ${seen.withDeltas}`);
    assert.ok((seen.byReason.not_approved || 0) >= 250, `not_approved: ${seen.byReason.not_approved}`);
    assert.ok((seen.byReason.missing_input || 0) >= 40, `missing_input: ${seen.byReason.missing_input}`);
    assert.ok(seen.soft >= 25, `soft-width substitutions: ${seen.soft}`);
    assert.ok(seen.multipliers.size >= 3);
  });
  it('the same parity holds when the sheet is handed over RAW (the builder) and already SANITISED (the server\'s buildPricingIndex)', () => {
    const r = rng(77);
    for (let i = 0; i < 60; i++) {
      const familyId = FIDS[i % FIDS.length];
      const { config, size, qty } = randomLine(r, familyId);
      const { row, line } = serverLine(familyId, config, size, qty, 'approved');
      const sanitised = PC.normalisePricingDoc(fam(familyId), SHEETS.approved[familyId]);
      const viaRaw = ours(familyId, row.config, row.size, 'approved');
      const viaClean = QB.priceLine(DEPS, { family: fam(familyId), primary: PRIMARIES[familyId], config: row.config, size: row.size, sheet: sanitised });
      assert.deepEqual(pickKeys(viaRaw), pickKeys(line));
      assert.deepEqual(pickKeys(viaClean), pickKeys(line));
    }
  });

  describe('the stove\'s SOFT width rule: priced at the usual length, and the line says so', () => {
    const stoveCfg = { positions: ['lp_small', 'lp_small', 'lp_small', 'lp_small'], addons: ['griller'], top: 1.5 };   // 400 + 4 x 200 + 200 = 1400 mm
    const sizeAt = (W) => ({ W, D: 700, H: 850 });
    it('a body shorter than the burners need is priced at the usual length, with the server\'s sentence, and pricedSize shows what was priced', () => {
      assert.deepEqual(PF.minWidth(fam('stove'), stoveCfg), { mm: 1400, hard: false, noun: 'burners' });
      const asked = ours('stove', stoveCfg, sizeAt(600), 'approved');
      assert.deepEqual(asked.warnings, ['Asked for 600 mm; priced at the usual 1400 mm length for these burners.']);
      assert.deepEqual(asked.pricedSize, sizeAt(1400));
      const usual = ours('stove', stoveCfg, sizeAt(1400), 'approved');
      assert.equal(asked.priced, true);
      assert.equal(asked.unitPrice, usual.unitPrice, 'priced at the asked length instead of the usual one');
      const atAsked = PC.priceConfiguredItem(PRIMARIES.stove, fam('stove'), stoveCfg, sizeAt(600), SHEETS.approved.stove, {}, { schemaVersion: FAM.version });
      assert.notEqual(atAsked.unitPrice, asked.unitPrice, 'the fixture must make the two lengths cost different amounts, or this test proves nothing');
      const server = serverLine('stove', stoveCfg, sizeAt(600), 1, 'approved');
      assert.deepEqual(pickKeys(asked), pickKeys(server.line));
    });
    it('exactly the usual length, or longer: no warning, no substitution', () => {
      for (const W of [1400, 1410, 2000]) {
        const r = ours('stove', stoveCfg, sizeAt(W), 'approved');
        assert.deepEqual(r.warnings, [], String(W));
        assert.equal(r.pricedSize.W, W);
      }
    });
    it('the input size object is never changed, and pricedSize is a copy of it', () => {
      const size = deepFreeze(sizeAt(600));
      const r = ours('stove', stoveCfg, size, 'approved');
      assert.equal(size.W, 600);
      assert.notEqual(r.pricedSize, size);
      r.pricedSize.W = 5;
      assert.equal(size.W, 600);
    });
  });

  describe('a HARD width rule (sinks) is never substituted — validation refuses such a line before it can be priced', () => {
    const sinkCfg = { grade: 304, basins: 3, alignment: 'center', undershelf: false, upper: false, faucet: 'gooseneck', top: 1.5 };   // 3 x 500 = 1500 mm, hard
    it('a too-short sink is priced at the size it was given, with no warning (exactly what computeBasket does with the same hand-built line)', () => {
      assert.equal(PF.minWidth(fam('sink'), sinkCfg).hard, true);
      const size = { W: 1000, D: 500, H: 850 };
      const mine = ours('sink', sinkCfg, size, 'approved');
      assert.deepEqual(mine.warnings, []);
      assert.deepEqual(mine.pricedSize, size);
      const handBuilt = [{ n: 1, kind: 'family', id: 'PW-004', familyId: 'sink', name: 'Sink', cat: 'washing', unit: 'pc', qty: 1, runs: null, size, sizeCustom: true, config: sinkCfg, specs: [], note: '' }];
      const basket = Q.computeBasket(handBuilt, new Map(), {}, undefined, { families: FAM, primaries: PRIMARY_MAP, pricing: Q.buildPricingIndex(sheetDocs('approved'), FAM) });
      assert.deepEqual(pickKeys(mine), pickKeys(basket.lines[0]));
      const atUsual = ours('sink', sinkCfg, { W: 1500, D: 500, H: 850 }, 'approved');
      assert.notEqual(mine.unitPrice, atUsual.unitPrice, 'a hard rule must price the size asked, not the usual one');
    });
  });

  describe('the sheet: not approved, wrong schema version, blank cells, no sheet at all — "priced after review", never a partial or zero-based figure', () => {
    const cfg = { basins: 2, alignment: 'left', undershelf: true, upper: false, faucet: 'prerinse', top: 1.5 };
    const size = { W: 1200, D: 500, H: 850 };
    it('an unapproved sheet, a missing sheet and a sheet approved for ANOTHER schema version price nothing', () => {
      assert.equal(ours('sink', cfg, size, 'unapproved').reason, 'not_approved');
      assert.equal(ours('sink', cfg, size, null).reason, 'not_approved');
      const stale = QB.priceLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: cfg, size, sheet: { ...SHEETS.approved.sink, schemaVersion: FAM.version + 1 } });
      assert.equal(stale.reason, 'not_approved');
      assert.equal(stale.priced, false); assert.equal(stale.unitPrice, 0);
      assert.equal(ours('sink', cfg, size, 'approved').priced, true, 'the control: the right version, approved, prices');
    });
    it('a BLANK cell is "missing input" and names the option — it is never read as zero', () => {
      const blankSheet = { ...SHEETS.approved.sink, options: { ...SHEETS.approved.sink.options, undershelf: { true: { flat: null, perW100: null } } } };
      const r = QB.priceLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: cfg, size, sheet: blankSheet });
      assert.equal(r.priced, false); assert.equal(r.unitPrice, 0);
      assert.equal(r.reason, 'missing_input');
      assert.ok(r.missing.some((m) => /Undershelf/.test(m)), JSON.stringify(r.missing));
      const zeroSheet = { ...SHEETS.approved.sink, options: { ...SHEETS.approved.sink.options, undershelf: { true: { flat: 0, perW100: null } } } };
      assert.equal(QB.priceLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: cfg, size, sheet: zeroSheet }).priced, true, 'an explicit 0 IS a figure');
    });
    it('the materials-index multiplier is applied through the primary SKU', () => {
      const a = QB.priceLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: cfg, size, sheet: SHEETS.approved.sink, constants: {} });
      const b = QB.priceLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: cfg, size, sheet: SHEETS.approved.sink, constants: { materialPriceIndexMultiplier: 1.2 } });
      assert.ok(b.base > a.base);
    });
  });

  describe('robustness', () => {
    it('an unknown family or a missing primary SKU is "no_family" with the same shape the server gives, never a throw', () => {
      const noFam = QB.priceLine(DEPS, { family: null, primary: PRIMARIES.sink, config: {}, size: {}, sheet: null });
      assert.deepEqual(noFam, { unitPrice: 0, priced: false, reason: 'no_family', missing: [], base: 0, deltas: [], pricedSize: {}, warnings: [] });
      assert.equal(QB.priceLine(DEPS, { family: fam('sink'), primary: null, config: {}, size: {}, sheet: null }).reason, 'no_family');
      for (const bad of [undefined, null, 0, 'x', [], {}]) assert.doesNotThrow(() => QB.priceLine(bad, bad));
      assert.doesNotThrow(() => QB.priceLine());
      assert.equal(QB.priceLine({}, {}).priced, false);
    });
    it('inputs are never mutated (deep-frozen family, primary, config, size and sheet go through untouched)', () => {
      const cfg = { positions: ['lp_small', 'lp_small', 'lp_small', 'lp_small'], addons: ['griller'], top: 1.5 };
      assert.doesNotThrow(() => QB.priceLine(DEPS, deepFreeze({ family: JSON.parse(JSON.stringify(fam('stove'))), primary: JSON.parse(JSON.stringify(PRIMARIES.stove)), config: cfg, size: { W: 600, D: 700, H: 850 }, sheet: JSON.parse(JSON.stringify(SHEETS.approved.stove)), constants: { materialPriceIndexMultiplier: 1.1 } })));
    });
  });
});

// ═══════════════════════════════════════ buildLine ═══════════════════════════════════════
describe('buildLine — a configured line in the builder\'s item shape (§3.1, rule R2)', () => {
  const sinkCfg = { grade: 304, basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'prerinse', top: 1.5 };
  const sinkSize = { W: 1800, D: 700, H: 900 };
  const build = (kind, extra) => {
    const basis = kind === undefined ? undefined : ours('sink', sinkCfg, sinkSize, kind);
    return QB.buildLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: sinkCfg, size: sinkSize, qty: 2, unit: 'pc', note: 'Near the loading door', basis, ...(extra || {}) });
  };
  it('a PRICED line lands on the website basis at exactly the priced figure', () => {
    const basis = ours('sink', sinkCfg, sinkSize, 'approved');
    assert.equal(basis.priced, true);
    const it = build('approved');
    assert.equal(it.id, 'PW-004', 'every downstream consumer keeps a real product id: the family\'s PRIMARY SKU');
    assert.equal(it.category, 'washing');
    assert.equal(it.name, 'SS Sink', 'the line is named by its TITLE, not by the website\'s card name ("Sink")');
    assert.equal(it.familyId, 'sink');
    assert.equal(it.familyVersion, FAM.version);
    assert.deepEqual(it.config, sinkCfg);
    assert.deepEqual(it.size, sinkSize);
    assert.equal(it.dims, 'L1800 × W700 × H900 mm');
    assert.deepEqual(it.specs, PF.describe(fam('sink'), sinkCfg));
    assert.equal(it.specStr, 'Material: Stainless Steel 304 Food Grade, Sinks: 2, Sink position: Centre, Undershelf: With, Upper shelf: Without, Faucet: Pre-rinse spray, Construction: SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet');
    assert.equal(it.qty, 2); assert.equal(it.unit, 'pc');
    assert.equal(it.unitPrice, basis.unitPrice);
    assert.equal(it.amount, basis.unitPrice * 2);
    assert.equal(it.basisUnitPrice, basis.unitPrice);
    assert.equal(it.priceBasis, 'website');
    assert.ok(!('needsPrice' in it), 'a priced line has no needsPrice');
    assert.ok(!('priceManual' in it), 'the auto-pricer is held off by the basis, not by a flag');
    assert.ok(!('sourceRef' in it));
    assert.equal(it.formulaType, 'per_length', 'the primary\'s formulaType');
    assert.equal(it.notes, 'Near the loading door');
    assert.equal(it.leadTime, '—'); assert.equal(it.laborHours, null);
    assert.deepEqual(it._cfg, { reason: basis.reason, missing: basis.missing, base: basis.base, deltas: basis.deltas, warnings: basis.warnings, pricedSize: basis.pricedSize });
    noUndefined(it);
    assert.deepEqual(JSON.parse(JSON.stringify(it)), it, 'survives a JSON round trip (saved as a draft / filed as a quote)');
  });
  it('an UNPRICED line (every reason) lands at zero on the MANUAL basis and needs a price — never the bare SKU\'s price', () => {
    for (const kind of ['unapproved', 'blank', null]) {
      const basis = ours('sink', sinkCfg, sinkSize, kind);
      const it = build(kind);
      assert.equal(basis.priced, false);
      assert.equal(it.priceBasis, 'manual', String(kind));
      assert.equal(it.needsPrice, true);
      assert.equal(it.unitPrice, 0); assert.equal(it.amount, 0); assert.equal(it.basisUnitPrice, 0);
      assert.equal(it._cfg.reason, basis.reason);
      assert.ok(!('priceManual' in it));
      assert.ok(basis.base >= 0);
    }
    const noBasis = build(undefined);
    assert.equal(noBasis.priceBasis, 'manual'); assert.equal(noBasis.needsPrice, true); assert.equal(noBasis.unitPrice, 0);
    assert.equal(noBasis._cfg.reason, null);
  });
  it('a basis that says "priced" but carries no positive figure is treated as unpriced', () => {
    for (const unitPrice of [0, -5, NaN, 'x', null]) {
      const it = build(undefined, { basis: { priced: true, unitPrice } });
      assert.equal(it.priceBasis, 'manual', String(unitPrice)); assert.equal(it.unitPrice, 0);
    }
    assert.equal(build(undefined, { basis: { priced: 'yes', unitPrice: 5000 } }).priceBasis, 'manual', 'only the boolean true counts');
  });
  it('quantity is a whole number of at least 1; the unit and note default sensibly', () => {
    assert.equal(build('approved', { qty: '-4' }).qty, 1);
    assert.equal(build('approved', { qty: 0 }).qty, 1);
    assert.equal(build('approved', { qty: '3' }).qty, 3);
    assert.equal(build('approved', { qty: 2.9 }).qty, 2);
    assert.equal(build('approved', { qty: undefined }).qty, 1);
    assert.equal(build('approved', { unit: undefined }).unit, 'pc');
    assert.equal(build('approved', { unit: 'set' }).unit, 'set');
    assert.equal(build('approved', { note: undefined }).notes, '');
    assert.equal(build('approved', { qty: 3 }).amount, build('approved', { qty: 3 }).unitPrice * 3);
  });
  it('the configuration is stored in its CANONICAL form (add-ons in the family\'s own order, burner order kept)', () => {
    const it = QB.buildLine(DEPS, { family: fam('stove'), primary: PRIMARIES.stove, config: { positions: ['wok', 'lp_small'], addons: ['griddle', 'griller'] }, size: { W: 1500, D: 700, H: 850 }, qty: 1 });
    assert.deepEqual(it.config, { grade: 304, positions: ['wok', 'lp_small'], addons: ['griller', 'griddle'], top: 1.5 }, 'the staff-only steel grade and top plate are stated, at their defaults');
    assert.equal(it.name, 'SS Range Stove Combination (Griller, Griddle)');
    assert.equal(it.formulaType, 'per_length');
  });
  it('a configuration or size the family would refuse builds NOTHING (null), and so does a missing family', () => {
    assert.equal(QB.buildLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: { ...sinkCfg, basins: 9 }, size: sinkSize }), null);
    assert.equal(QB.buildLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: { ...sinkCfg, nope: 1 }, size: sinkSize }), null);
    assert.equal(QB.buildLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: sinkCfg, size: { W: 1010, D: 700, H: 900 }, qty: 1 }) !== null, true, 'a size on the step is fine');
    assert.equal(QB.buildLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: sinkCfg, size: { W: 1001, D: 700, H: 900 } }), null);
    assert.equal(QB.buildLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: { ...sinkCfg, basins: 3 }, size: { W: 1000, D: 500, H: 850 } }), null, 'a hard width rule is refused');
    assert.equal(QB.buildLine(DEPS, { family: null, config: sinkCfg, size: sinkSize }), null);
    assert.equal(QB.buildLine(DEPS, undefined), null);
    assert.equal(QB.buildLine(), null);
  });
  it('nothing is aliased: changing the built line never changes the configuration or size it was built from', () => {
    const cfg = { ...sinkCfg }, size = { ...sinkSize };
    const it = QB.buildLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: cfg, size, qty: 1, basis: ours('sink', sinkCfg, sinkSize, 'approved') });
    it.config.basins = 3; it.size.W = 1; it._cfg.pricedSize.W = 2;
    assert.equal(cfg.basins, 2); assert.equal(size.W, 1800);
  });
  it('every line it builds for every family passes the family\'s own validation and prints a size', () => {
    const r = rng(5);
    for (let i = 0; i < 60; i++) {
      const familyId = FIDS[i % FIDS.length];
      const { config, size } = randomLine(r, familyId);
      const it = QB.buildLine(DEPS, { family: fam(familyId), primary: PRIMARIES[familyId], config, size, qty: 1, basis: ours(familyId, config, size, 'approved') });
      assert.ok(it, familyId);
      assert.equal(PF.validateLine(fam(familyId), it.config, it.size).ok, true);
      assert.equal(it.id, fam(familyId).primary);
      assert.match(it.dims, / mm$/);
    }
  });
});

// ═══════════════════════════════════════ 2. COST BASIS ═══════════════════════════════════════
// independent oracle (written differently from the module): the score of a configuration against one absorbed configuration
function oracleScore(f, cfg, target) {
  let s = 0;
  for (const g of f.groups) {
    const a = cfg[g.key] === undefined ? g.default : cfg[g.key], b = target[g.key] === undefined ? g.default : target[g.key];      // an ABSENT group reads as its default (the absorbed configs never state the top plate)
    if (g.type === 'choice') s += a === b ? 1 : 0;
    else if (g.type === 'multi') {
      const A = new Set(a), B = new Set(b);
      const inter = [...A].filter((x) => B.has(x)).length;
      const union = new Set([...A, ...B]).size;
      s += union === 0 ? 1 : inter / union;
    } else {
      const count = (l) => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
      const ca = count(a), cb = count(b);
      let overlap = 0;
      for (const [k, n] of ca) overlap += Math.min(n, cb.get(k) || 0);
      const longest = Math.max(a.length, b.length);
      s += longest === 0 ? 1 : overlap / longest;
    }
  }
  return s;
}
const near = (x, y) => Math.abs(x - y) < 1e-9;

describe('nearestAbsorbed — the standard model a configuration is closest to (§4.5)', () => {
  const sink = fam('sink'), stove = fam('stove');
  it('the primary SKU is always one of the family\'s absorbed SKUs, for all six families (so a match always exists)', () => {
    for (const id of FIDS) assert.ok(Object.prototype.hasOwnProperty.call(fam(id).absorbed, fam(id).primary), id);
  });
  it('every absorbed configuration finds itself: exact, with the full score, at the FIRST SKU in map order that shares it', () => {
    for (const id of FIDS) {
      const f = fam(id), skus = Object.keys(f.absorbed);
      for (const sku of skus) {
        const got = QB.nearestAbsorbed(f, f.absorbed[sku]);
        const firstSame = skus.find((s) => PF.sameConfig(f, f.absorbed[s], f.absorbed[sku]));
        assert.equal(got.sku, firstSame, `${id} ${sku}`);
        assert.equal(got.exact, true);
        assert.ok(near(got.score, f.groups.length), `${id} ${sku} score ${got.score}`);
      }
    }
  });
  it('choice groups score +1 each when equal: the best-scoring SKU wins and the partial match is not exact', () => {
    const cfg = { basins: 2, alignment: 'left', undershelf: false, upper: false, faucet: 'prerinse' };
    const got = QB.nearestAbsorbed(sink, cfg);
    assert.equal(got.sku, 'PW-006');                 // PW-006 and PW-007 share a configuration and both score 4 (+1 for the standard steel grade and +1 for the standard top plate both share): the first in map order wins
    assert.ok(near(got.score, 6));
    assert.equal(got.exact, false);
    assert.equal(QB.nearestAbsorbed(sink, { basins: 3, alignment: 'right', undershelf: false, upper: false, faucet: 'gooseneck' }).sku, 'PW-008');
    assert.equal(QB.nearestAbsorbed(sink, { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'gooseneck' }).sku, 'PW-037');
  });
  it('a multi group scores the Jaccard overlap of the selected sets; a slots group the multiset overlap over the longer list', () => {
    // two lp_small burners + a griller: CE-008 (two lp_small + griller & griddle) scores 1 (slots) + 1/2 (Jaccard) + 1 (the standard top plate) + 1 (the standard steel grade) = 3.5
    const got = QB.nearestAbsorbed(stove, { positions: ['lp_small', 'lp_small'], addons: ['griller'] });
    assert.equal(got.sku, 'CE-008');
    assert.ok(near(got.score, 3.5), String(got.score));
    assert.equal(got.exact, false);
    // slots: [A,A,B] against [A,B,B] shares two of three positions -> 2/3
    const synth = { groups: [{ key: 'p', type: 'slots' }], absorbed: { X: { p: ['a', 'b', 'b'] } } };
    assert.ok(near(QB.nearestAbsorbed(synth, { p: ['a', 'a', 'b'] }).score, 2 / 3));
    // multi: two empty selections are identical (1); disjoint selections score 0; {a,b} vs {b,c} is 1/3
    const syn2 = (sel) => ({ groups: [{ key: 'm', type: 'multi' }], absorbed: { X: { m: sel } } });
    assert.ok(near(QB.nearestAbsorbed(syn2([]), { m: [] }).score, 1));
    assert.ok(near(QB.nearestAbsorbed(syn2(['a']), { m: ['b'] }).score, 0));
    assert.ok(near(QB.nearestAbsorbed(syn2(['b', 'c']), { m: ['a', 'b'] }).score, 1 / 3));
    // the burner ORDER matters for "exact" (PF.sameConfig) though not for the score
    const ordered = { groups: [{ key: 'p', type: 'slots' }], absorbed: { X: { p: ['a', 'b'] } } };
    const swapped = QB.nearestAbsorbed(ordered, { p: ['b', 'a'] });
    assert.ok(near(swapped.score, 1)); assert.equal(swapped.exact, false);
  });
  it('a TIE goes to the first SKU in the family\'s absorbed map order — whichever order that is', () => {
    const mk = (order) => ({ groups: [{ key: 'k', type: 'choice' }, { key: 'j', type: 'choice' }], absorbed: Object.fromEntries(order.map((s) => [s, { k: 'a', j: 1 }])) });
    assert.equal(QB.nearestAbsorbed(mk(['X', 'Y', 'Z']), { k: 'a', j: 1 }).sku, 'X');
    assert.equal(QB.nearestAbsorbed(mk(['Z', 'Y', 'X']), { k: 'a', j: 1 }).sku, 'Z');
    // a tie that is not exact too: two SKUs each match one of two groups
    const half = { groups: [{ key: 'k', type: 'choice' }, { key: 'j', type: 'choice' }], absorbed: { P: { k: 'a', j: 9 }, Q: { k: 'b', j: 1 } } };
    assert.equal(QB.nearestAbsorbed(half, { k: 'a', j: 1 }).sku, 'P');
    // a tie decided by floating-point noise in different summation orders is still a tie: 1/3 + 2/3 vs 2/3 + 1/3
    const noisy = { groups: [{ key: 'm', type: 'multi' }, { key: 'n', type: 'multi' }], absorbed: { P: { m: ['a'], n: ['a', 'b', 'c'] }, Q: { m: ['a', 'b', 'c'], n: ['a'] } } };
    assert.equal(QB.nearestAbsorbed(noisy, { m: ['a'], n: ['a'] }).sku, 'P');
  });
  it('a tie decided ONLY by floating-point noise (the same three fractions summed in another order) is still a tie: the first SKU wins', () => {
    const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    const groups = [{ key: 'g1', type: 'multi' }, { key: 'g2', type: 'multi' }, { key: 'g3', type: 'multi' }];
    const cfg = { g1: A, g2: A, g3: A };
    const sixth = ['a1'];                      // 1 of 6 shared, union 6   -> 1/6
    const eighth = ['a1', 'x1', 'x2'];         // 1 of 6 shared, union 8   -> 1/8
    const P = { g1: sixth, g2: sixth, g3: eighth };      // (1/6 + 1/6) + 1/8
    const Q = { g1: eighth, g2: sixth, g3: sixth };      // (1/8 + 1/6) + 1/6 — the same total, one ulp lower
    const mk = (order) => ({ groups, absorbed: Object.fromEntries(order.map((k) => [k, k === 'P' ? P : Q])) });
    assert.ok(oracleScore(mk(['P', 'Q']), cfg, P) > oracleScore(mk(['P', 'Q']), cfg, Q), 'the fixture must produce float noise, or this test proves nothing');
    assert.ok(near(oracleScore(mk(['P', 'Q']), cfg, P), oracleScore(mk(['P', 'Q']), cfg, Q)));
    assert.equal(QB.nearestAbsorbed(mk(['Q', 'P']), cfg).sku, 'Q', 'the first SKU in map order wins a real tie, not the one with the luckier rounding');
    assert.equal(QB.nearestAbsorbed(mk(['P', 'Q']), cfg).sku, 'P');
  });
  it('agrees with an independent brute-force scorer on 600 random configurations, and `exact` agrees with ProductFamilies.sameConfig', () => {
    const r = rng(99);
    for (let i = 0; i < 600; i++) {
      const familyId = FIDS[i % FIDS.length], f = fam(familyId);
      const { config } = randomLine(r, familyId);
      const got = QB.nearestAbsorbed(f, config);
      const scores = Object.keys(f.absorbed).map((sku) => [sku, oracleScore(f, config, f.absorbed[sku])]);
      const best = Math.max(...scores.map((s) => s[1]));
      const want = scores.find((s) => near(s[1], best));
      assert.equal(got.sku, want[0], `${familyId} ${JSON.stringify(config)}`);
      assert.ok(near(got.score, best));
      assert.equal(got.exact, PF.sameConfig(f, config, full(f, f.absorbed[got.sku])), 'exact = the same configuration once the absorbed one states every group');
    }
  });
  it('a family that absorbs nothing, and junk, never throw', () => {
    assert.deepEqual(QB.nearestAbsorbed({ groups: [], absorbed: {} }, {}), { sku: null, exact: false, score: 0 });
    for (const bad of [undefined, null, 0, 'x', [], {}]) assert.doesNotThrow(() => QB.nearestAbsorbed(bad, bad));
    assert.doesNotThrow(() => QB.nearestAbsorbed(sink, undefined));
  });
});

describe('costBasisFor — a configured line is costed as its nearest standard model, scaled, and labelled approximate (§4.5)', () => {
  const skuProd = (id, basePrice, dims, mat, lab) => ({ id, category: 'washing', name: id, formulaType: 'fixed', basePrice, defaultDimensions: dims, formula: {}, specs: [], unit: 'pc', capitalMaterials: mat, capitalLabor: lab });
  const LIVE = new Map([
    ['PW-004', skuProd('PW-004', 6000, { W: 500, D: 500, H: 850 }, 2000, 800)],
    ['PW-006', skuProd('PW-006', 12000, { W: 1000, D: 500, H: 850 }, 4400, 1500)],
    ['PW-008', skuProd('PW-008', 17000, { W: 1500, D: 500, H: 850 }, 6300, 2100)],
  ]);
  const cfg6 = { basins: 2, alignment: 'center', undershelf: false, upper: false, faucet: 'prerinse' };   // = PW-006 exactly
  const size6 = { W: 1000, D: 500, H: 850 };                                                              // = PW-006's own default size
  const line = (over) => ({ familyId: 'sink', config: cfg6, size: size6, basisUnitPrice: 12000, _cfg: { base: 0 }, ...(over || {}) });
  const cost = (item, live, deps) => QB.costBasisFor(deps || DEPS, item, live || LIVE);

  it('an EXACT match at the SKU\'s own size and list figure is that SKU\'s cost, unscaled and not approximate', () => {
    const r = cost(line());
    assert.deepEqual(r, { mat: 4400, capLaborPesos: 1500, hrs: 0, laborAbsent: false, hasBasis: true, isCustom: false, approx: false, basisSku: 'PW-006', scale: 1, note: '' });
  });
  it('scale = configured list figure ÷ the SKU\'s own list figure: mat and labour move together, still exact when nothing else differs', () => {
    const r = cost(line({ basisUnitPrice: 18000 }));
    assert.equal(r.scale, 1.5);
    assert.equal(r.mat, 6600); assert.equal(r.capLaborPesos, 2250);
    assert.equal(r.approx, false);
    assert.equal(r.note, '');
    const cheaper = cost(line({ basisUnitPrice: 9000 }));
    assert.equal(cheaper.scale, 0.75); assert.equal(cheaper.mat, 3300);
  });
  it('the scale is CLAMPED to [0.25, 4] and a clamped basis is approximate and says so', () => {
    const hi = cost(line({ basisUnitPrice: 100000 }));
    assert.equal(hi.scale, 4); assert.equal(hi.mat, 17600); assert.equal(hi.capLaborPesos, 6000);
    assert.equal(hi.approx, true); assert.equal(hi.note, 'scale clamped');
    const lo = cost(line({ basisUnitPrice: 1000 }));
    assert.equal(lo.scale, 0.25); assert.equal(lo.mat, 1100); assert.equal(lo.capLaborPesos, 375);
    assert.equal(lo.approx, true); assert.equal(lo.note, 'scale clamped');
    const edgeHi = cost(line({ basisUnitPrice: 48000 })), edgeLo = cost(line({ basisUnitPrice: 3000 }));
    assert.equal(edgeHi.scale, 4); assert.equal(edgeHi.approx, false, 'exactly 4 is not clamped');
    assert.equal(edgeLo.scale, 0.25); assert.equal(edgeLo.approx, false, 'exactly 0.25 is not clamped');
  });
  it('approximate when the configuration is not exactly the SKU\'s, or the size is not its default size', () => {
    const notExact = cost(line({ config: { ...cfg6, alignment: 'left' } }));
    assert.equal(notExact.basisSku, 'PW-006'); assert.equal(notExact.approx, true); assert.equal(notExact.scale, 1);
    const otherSize = cost(line({ size: { ...size6, W: 1200 } }));
    assert.equal(otherSize.approx, true); assert.equal(otherSize.basisSku, 'PW-006');
    for (const k of ['W', 'D', 'H']) assert.equal(cost(line({ size: { ...size6, [k]: size6[k] + 10 } })).approx, true, k);
    assert.equal(cost(line({ size: { W: 1000, D: 500 } })).approx, true, 'a size that does not say every axis cannot be matched to the default');
    assert.equal(cost(line({ size: null })).approx, true);
  });
  it('costs from the NEAREST standard model, not from the family\'s primary SKU', () => {
    const three = { basins: 3, alignment: 'right', undershelf: false, upper: false, faucet: 'gooseneck' };
    const r = cost(line({ config: three, size: { W: 1500, D: 500, H: 850 }, basisUnitPrice: 17000 }));
    assert.equal(r.basisSku, 'PW-008');
    assert.equal(r.mat, 6300); assert.equal(r.capLaborPesos, 2100); assert.equal(r.scale, 1);
    assert.equal(r.approx, true, 'alignment differs');
    assert.notEqual(r.basisSku, fam('sink').primary);
  });
  it('an UNPRICED line is scaled by the base alone (_cfg.base); with no list figure at all there is no basis, never an invented scale', () => {
    const r = cost(line({ basisUnitPrice: 0, _cfg: { base: 15000 } }));
    assert.equal(r.scale, 1.25); assert.equal(r.mat, 5500); assert.equal(r.capLaborPesos, 1875);
    for (const item of [line({ basisUnitPrice: 0, _cfg: { base: 0 } }), line({ basisUnitPrice: 0, _cfg: undefined }), line({ basisUnitPrice: 0 }), line({ basisUnitPrice: -5, _cfg: {} })]) {
      const none = cost(item);
      assert.equal(none.hasBasis, false);
      assert.equal(none.mat, 0); assert.equal(none.capLaborPesos, 0); assert.equal(none.hrs, 0);
      assert.equal(none.basisSku, 'PW-006');
    }
  });
  it('NO basis when the standard model has no cost on file (both zero), is not in the live catalogue, or has no list price to scale from', () => {
    const live0 = new Map([['PW-006', skuProd('PW-006', 12000, size6, 0, 0)]]);
    const z = cost(line(), live0);
    assert.equal(z.hasBasis, false, 'a zero cost must not become a basis');
    assert.equal(z.mat, 0); assert.equal(z.capLaborPesos, 0);
    assert.equal(cost(line(), new Map()).hasBasis, false);
    assert.equal(QB.costBasisFor(DEPS, line(), undefined).hasBasis, false);
    assert.equal(QB.costBasisFor(DEPS, line(), null).hasBasis, false);
    assert.equal(cost(line(), new Map([['PW-006', skuProd('PW-006', 0, size6, 4400, 1500)]])).hasBasis, false, 'the SKU has no list price');
    assert.equal(cost(line(), new Map([['PW-006', skuProd('PW-006', 12000, size6, -5, -7)]])).hasBasis, false, 'a negative cost is no cost');
  });
  it('materials only (no labour on file) leaves the labour to the engine\'s assumption; labour only is a basis too', () => {
    const matOnly = cost(line(), new Map([['PW-006', skuProd('PW-006', 12000, size6, 4400, 0)]]));
    assert.equal(matOnly.hasBasis, true); assert.equal(matOnly.laborAbsent, true); assert.equal(matOnly.capLaborPesos, 0);
    const labOnly = cost(line(), new Map([['PW-006', skuProd('PW-006', 12000, size6, 0, 1500)]]));
    assert.equal(labOnly.hasBasis, true); assert.equal(labOnly.laborAbsent, false); assert.equal(labOnly.mat, 0);
  });
  it('the materials-index multiplier is applied to the SKU\'s list figure exactly as it was to the configured one, so the scale does not absorb it', () => {
    const withIndex = { ...DEPS, constants: { materialPriceIndexMultiplier: 1.1 } };
    const r = cost(line({ basisUnitPrice: 13200 }), LIVE, withIndex);       // 12000 x 1.1
    assert.equal(r.scale, 1); assert.equal(r.mat, 4400);
    assert.equal(cost(line({ basisUnitPrice: 13200 })).scale, 1.1, 'without the constants the scale would be 1.1');
  });
  it('returns the same shape itemCostBasis gives a catalogue line (plus approx, basisSku, scale, note), for a basis and for none', () => {
    const KEYS = ['approx', 'basisSku', 'capLaborPesos', 'hasBasis', 'hrs', 'isCustom', 'laborAbsent', 'mat', 'note', 'scale'];
    assert.deepEqual(Object.keys(cost(line())).sort(), KEYS);
    assert.deepEqual(Object.keys(cost(line(), new Map())).sort(), KEYS);
    assert.deepEqual(Object.keys(cost({ familyId: 'nope' })).sort(), KEYS);
    assert.equal(cost(line()).isCustom, false);
  });
  it('accepts a plain object as the live lookup, ignores a line with no known family, never throws and never mutates', () => {
    assert.equal(cost(line(), { 'PW-006': LIVE.get('PW-006') }).hasBasis, true);
    assert.equal(cost({ familyId: 'nope', config: {} }).hasBasis, false);
    assert.equal(cost({}).hasBasis, false);
    for (const bad of [undefined, null, 0, 'x', []]) assert.doesNotThrow(() => QB.costBasisFor(bad, bad, bad));
    assert.doesNotThrow(() => QB.costBasisFor(DEPS, deepFreeze(line()), deepFreeze(new Map([['PW-006', LIVE.get('PW-006')]]))));
  });
  it('every real family can be costed from its own absorbed SKUs (synthetic costs and prices)', () => {
    for (const id of FIDS) {
      const f = fam(id);
      const live = new Map(Object.keys(f.absorbed).map((sku) => [sku, { ...skuProd(sku, 5000, { W: 700, D: 500, H: 800 }, 1000, 400) }]));
      const r = cost({ familyId: id, config: f.absorbed[f.primary], size: PF.defaultDims(f), basisUnitPrice: 5000 }, live);
      assert.equal(r.hasBasis, true, id);
      assert.equal(r.basisSku, Object.keys(f.absorbed).find((s) => PF.sameConfig(f, f.absorbed[s], f.absorbed[f.primary])));
      assert.equal(r.scale, 1);
    }
  });
});

// ═══════════════════════════════════════ 3. isAutoPriceable (R1) ═══════════════════════════════════════
describe('isAutoPriceable — rule R1, the single predicate the auto-pricer calls', () => {
  const rows = [
    // [item, expected]
    [{ id: 'PW-001' }, true],
    [{ id: 'PW-001', priceBasis: undefined }, true],
    [{ id: 'PW-001', priceBasis: 'cost' }, true],
    [{ id: 'PW-001', priceBasis: 'website' }, false],
    [{ id: 'PW-001', priceBasis: 'manual' }, false],
    [{ id: 'PW-001', priceBasis: 'anything-else' }, false],
    [{ id: 'PW-001', priceBasis: null }, false],
    [{ id: 'PW-001', priceManual: true }, false],
    [{ id: 'PW-001', priceManual: true, priceBasis: 'cost' }, false],
    [{ id: 'PW-001', priceManual: true, priceBasis: 'website' }, false],
    [{ id: 'PW-001', priceManual: false, priceBasis: 'cost' }, true],
    [{ id: 'PW-001', priceManual: 0 }, true],
    [{ id: 'CUSTOM' }, true],
    [{ id: 'MISCFEE' }, false],
    [{ id: 'MISCFEE', priceBasis: 'cost' }, false],
    [{ id: 'MISCFEE', priceBasis: undefined, priceManual: false }, false],
  ];
  for (const [item, want] of rows) {
    it(`${JSON.stringify(item)} -> ${want}`, () => assert.equal(QB.isAutoPriceable(item), want));
  }
  it('junk is never auto-priceable', () => {
    for (const bad of [undefined, null, 0, 'x', [], 7, true]) assert.equal(QB.isAutoPriceable(bad), false, String(bad));
    assert.equal(QB.isAutoPriceable({}), true, 'a line with no id at all is an ordinary line');
  });
  it('a configured line is protected by default: a website-basis or manual line is never repriced, a cost-basis line is', () => {
    const basis = ours('sink', { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'prerinse', top: 1.5 }, { W: 1800, D: 700, H: 900 }, 'approved');
    const mk = (b) => QB.buildLine(DEPS, { family: fam('sink'), primary: PRIMARIES.sink, config: { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'prerinse', top: 1.5 }, size: { W: 1800, D: 700, H: 900 }, qty: 1, basis: b });
    assert.equal(basis.priced, true, 'the line under test is a PRICED website-basis line (a configuration missing the top plate would price nothing and make this test vacuous)');
    assert.equal(mk(basis).priceBasis, 'website');
    assert.equal(QB.isAutoPriceable(mk(basis)), false);
    assert.equal(QB.isAutoPriceable(mk(undefined)), false);
    assert.equal(QB.isAutoPriceable({ ...mk(basis), priceBasis: 'cost' }), true);
  });
});

// ═══════════════════════════════════════ 4. estimate-range check (§7) ═══════════════════════════════════════
describe('comparableTotal — what the client\'s online estimate can be compared with', () => {
  const items = [
    { id: 'PW-004', amount: 100000 }, { id: 'CE-009', amount: 25000 },
    { id: 'MISCFEE', amount: 8000 }, { id: 'MISCFEE', amount: 1500 },
  ];
  it('sums the goods lines only: fee lines (MISCFEE) are never in it', () => {
    assert.equal(QB.comparableTotal(items, {}), 125000);
    assert.equal(QB.comparableTotal(items, { volumeBreakTotal: 0, discountAmt: 0 }), 125000);
  });
  it('subtracts the per-line quantity breaks AND the quote-level discount', () => {
    assert.equal(QB.comparableTotal(items, { volumeBreakTotal: 5000, discountAmt: 0 }), 120000);
    assert.equal(QB.comparableTotal(items, { volumeBreakTotal: 0, discountAmt: 12500 }), 112500);
    assert.equal(QB.comparableTotal(items, { volumeBreakTotal: 5000, discountAmt: 12500 }), 107500);
  });
  it('VAT, rush fee, delivery / installation and every other quote-level charge in `totals` are ignored', () => {
    const t = { volumeBreakTotal: 5000, discountAmt: 12500, vatAmt: 99999, rushFee: 8888, rushCharged: 7777, diAmount: 6666, diAdded: 6666, miscFeeTotal: 9500, focFees: 3000, grand: 555555, net: 444444, subtotal: 125000 };
    assert.equal(QB.comparableTotal(items, t), 107500);
  });
  it('tolerates no lines, no totals, junk amounts and junk lines', () => {
    assert.equal(QB.comparableTotal([], {}), 0);
    assert.equal(QB.comparableTotal(undefined, undefined), 0);
    assert.equal(QB.comparableTotal([{ id: 'A', amount: 'x' }, null, 7, { id: 'B', amount: 40 }, { id: 'C' }], { volumeBreakTotal: 'x', discountAmt: NaN }), 40);
    assert.equal(QB.comparableTotal([{ id: 'A', amount: '250' }], {}), 250);
  });
  it('does not change its inputs', () => {
    assert.doesNotThrow(() => QB.comparableTotal(deepFreeze(JSON.parse(JSON.stringify(items))), deepFreeze({ volumeBreakTotal: 1, discountAmt: 2 })));
  });
});

describe('estimateCheck — outside the range the client saw?', () => {
  const est = { low: 100000, high: 120000 };
  it('inside the range, and exactly ON either bound (inclusive both ends), is in range with no direction and no percentage', () => {
    for (const c of [100000, 110000, 120000]) {
      assert.deepEqual(QB.estimateCheck(c, est), { applicable: true, inRange: true, low: 100000, high: 120000, comparable: c, pctOff: 0, direction: null }, String(c));
    }
  });
  it('ABOVE the top: direction above, pctOff = (comparable - high) / high as a percent rounded to 0.1', () => {
    assert.deepEqual(QB.estimateCheck(134880, est), { applicable: true, inRange: false, low: 100000, high: 120000, comparable: 134880, pctOff: 12.4, direction: 'above' });
    assert.equal(QB.estimateCheck(240000, est).pctOff, 100);
    assert.equal(QB.estimateCheck(120001, est).inRange, false, 'one peso over is over');
    assert.equal(QB.estimateCheck(120001, est).pctOff, 0);
  });
  it('BELOW the bottom: direction below, pctOff = (low - comparable) / low as a percent rounded to 0.1', () => {
    assert.deepEqual(QB.estimateCheck(75000, est), { applicable: true, inRange: false, low: 100000, high: 120000, comparable: 75000, pctOff: 25, direction: 'below' });
    assert.equal(QB.estimateCheck(87654, est).pctOff, 12.3);
    assert.equal(QB.estimateCheck(99999, est).inRange, false);
    assert.equal(QB.estimateCheck(0, est).pctOff, 100);
    assert.equal(QB.estimateCheck(-5000, est).direction, 'below');
  });
  it('floating-point noise from a sum of discounts cannot turn "exactly at the edge" into "outside": the total is taken to the centavo first', () => {
    assert.equal(QB.estimateCheck(120000.0000000001, est).inRange, true);
    assert.equal(QB.estimateCheck(99999.9999999999, est).inRange, true);
    assert.equal(QB.estimateCheck(120000.01, est).inRange, false);
    assert.equal(QB.estimateCheck(0.1 + 0.2 + 119999.7, est).inRange, true);
  });
  it('not applicable without a usable estimate: null, empty, zero, negative, missing or non-numeric bounds — and then it is never "outside"', () => {
    for (const e of [null, undefined, {}, { low: 0, high: 0 }, { low: 0, high: 100 }, { low: 100, high: 0 }, { low: -1, high: 5 }, { low: 'x', high: 'y' }, { low: 100 }, { high: 100 }, 5, 'x', []]) {
      const r = QB.estimateCheck(555555, e);
      assert.equal(r.applicable, false, JSON.stringify(e));
      assert.equal(r.inRange, true);
      assert.equal(r.direction, null); assert.equal(r.pctOff, 0);
    }
  });
  it('the estimate may carry extra fields (the hand-off keeps step, vatBasis, deliveryIncluded); only low and high are read', () => {
    const r = QB.estimateCheck(110000, { low: 100000, high: 120000, step: 5000, vatBasis: 'exclusive', deliveryIncluded: false });
    assert.equal(r.applicable, true); assert.equal(r.inRange, true);
  });
  it('end to end with comparableTotal: a quote of goods + a delivery fee + VAT is judged on the goods alone', () => {
    const items = [{ id: 'PW-004', amount: 110000 }, { id: 'MISCFEE', amount: 40000 }];
    const comparable = QB.comparableTotal(items, { volumeBreakTotal: 0, discountAmt: 0, vatAmt: 18000 });
    assert.equal(QB.estimateCheck(comparable, est).inRange, true);
    assert.equal(QB.estimateCheck(comparable + 40000, est).inRange, false, 'including the fee line would have flagged it');
  });
});

// ═══════════════════════════════════════ 5. fromRequestItem (R2 / §6.1) ═══════════════════════════════════════
describe('fromRequestItem — a website request line in the builder\'s item shape', () => {
  const REF = 'QR-261021-K7M2PX';
  const sinkCfg = { grade: 304, basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'prerinse', top: 1.5 };
  const sinkSize = { W: 1800, D: 700, H: 900 };
  // a REAL request row (the server's normaliseItems) and a REAL internal line (its computeBasket) for a configured sink
  const real = (kind) => { const { row, line } = serverLine('sink', sinkCfg, sinkSize, 2, kind); return { row: { ...row, n: 3, note: 'Near the loading door' }, line: { ...line, n: 3 } }; };

  it('a PRICED configured line becomes a real configured line at the website price — on the website basis, no priceManual, sourceRef set', () => {
    const { row, line } = real('approved');
    assert.equal(line.priced, true);
    const it = QB.fromRequestItem(row, line, REF);
    assert.equal(it.familyId, 'sink');
    assert.deepEqual(it.config, sinkCfg);
    assert.deepEqual(it.size, sinkSize);
    assert.equal(it.id, 'PW-004');
    assert.equal(it.name, 'Sink', 'a real configured line: no "(configured)" stand-in suffix — and, without the family definitions, the name the server stored');
    assert.equal(it.category, 'washing');
    assert.equal(it.dims, 'L1800 × W700 × H900 mm');
    assert.deepEqual(it.specs, PF.describe(fam('sink'), sinkCfg));
    assert.equal(it.specStr, 'Material: Stainless Steel 304 Food Grade, Sinks: 2, Sink position: Centre, Undershelf: With, Upper shelf: Without, Faucet: Pre-rinse spray, Construction: SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet');
    assert.equal(it.qty, 2); assert.equal(it.unit, 'pc');
    assert.equal(it.unitPrice, line.unitPrice); assert.equal(it.amount, line.unitPrice * 2);
    assert.equal(it.basisUnitPrice, line.unitPrice);
    assert.equal(it.priceBasis, 'website');
    assert.ok(!('priceManual' in it), 'the basis, not a flag, holds the auto-pricer off');
    assert.ok(!('needsPrice' in it));
    assert.equal(it.notes, 'Near the loading door');
    assert.equal(it.formulaType, line.formulaType);
    assert.deepEqual(it.sourceRef, { kind: 'qr', ref: REF, n: 3 });
    noUndefined(it);
  });
  it('the website figure it carries is exactly what the builder\'s own priceLine says for that configuration and sheet (so the builder\'s recomputation on load agrees with the hand-off)', () => {
    const r = rng(31337);
    for (let i = 0; i < 40; i++) {
      const familyId = FIDS[i % FIDS.length];
      const { config, size, qty } = randomLine(r, familyId);
      const { row, line } = serverLine(familyId, config, size, qty, 'approved');
      const it = QB.fromRequestItem(row, line, REF);
      const recomputed = ours(familyId, it.config, it.size, 'approved');
      assert.equal(recomputed.priced, line.priced, `${familyId} ${i}`);
      assert.equal(it.basisUnitPrice, recomputed.unitPrice, `${familyId} ${i}`);
      assert.equal(it.unitPrice, recomputed.unitPrice);
      assert.equal(it.priceBasis, line.priced ? 'website' : 'manual');
      const rebuilt = QB.buildLine(DEPS, { family: fam(familyId), primary: PRIMARIES[familyId], config: it.config, size: it.size, qty: it.qty, basis: recomputed });
      assert.ok(rebuilt, `${familyId} ${i}`);
      assert.equal(rebuilt.unitPrice, it.unitPrice); assert.equal(rebuilt.priceBasis, it.priceBasis); assert.deepEqual(rebuilt.specs, it.specs);
    }
  });
  it('an UNPRICED configured line (each reason) lands at zero on the MANUAL basis and needs a price — still no bare-SKU price', () => {
    for (const kind of ['unapproved', 'blank']) {
      const { row, line } = real(kind);
      assert.equal(line.priced, false);
      const it = QB.fromRequestItem(row, line, REF);
      assert.equal(it.priceBasis, 'manual', kind); assert.equal(it.needsPrice, true);
      assert.equal(it.unitPrice, 0); assert.equal(it.amount, 0); assert.equal(it.basisUnitPrice, 0);
      assert.equal(it.id, 'PW-004'); assert.equal(it.familyId, 'sink');
      assert.ok(!('priceManual' in it));
    }
    const { row } = real('approved');
    for (const reason of ['not_approved', 'size_basis', 'no_price', 'no_base_price', 'missing_input', 'no_family']) {
      const it = QB.fromRequestItem(row, { n: 3, priced: false, unitPrice: 0, reason }, REF);
      assert.equal(it.priceBasis, 'manual', reason); assert.equal(it.needsPrice, true); assert.equal(it.unitPrice, 0);
    }
    for (const noLine of [null, undefined, {}, 7, 'x']) {
      const it = QB.fromRequestItem(row, noLine, REF);
      assert.equal(it.priceBasis, 'manual'); assert.equal(it.unitPrice, 0); assert.equal(it.needsPrice, true);
    }
  });
  it('a line that claims to be priced without a positive figure is NOT priced (no website basis on a zero)', () => {
    const { row } = real('approved');
    for (const unitPrice of [0, -3, 'x', NaN, null, undefined]) {
      const it = QB.fromRequestItem(row, { n: 3, priced: true, unitPrice }, REF);
      assert.equal(it.priceBasis, 'manual', String(unitPrice)); assert.equal(it.needsPrice, true); assert.equal(it.unitPrice, 0);
    }
    assert.equal(QB.fromRequestItem(row, { n: 3, priced: 'yes', unitPrice: 5000 }, REF).priceBasis, 'manual');
  });
  it('a line that is NOT flagged priced is unpriced whatever figure it carries — a stale or hostile unitPrice never becomes the quote\'s price', () => {
    const { row } = real('approved');
    for (const line of [{ n: 3, priced: false, unitPrice: 5000 }, { n: 3, unitPrice: 5000 }, { n: 3, priced: 0, unitPrice: 5000 }, { n: 3, priced: null, unitPrice: 5000 }]) {
      const it = QB.fromRequestItem(row, line, REF);
      assert.equal(it.unitPrice, 0, JSON.stringify(line)); assert.equal(it.amount, 0); assert.equal(it.basisUnitPrice, 0);
      assert.equal(it.priceBasis, 'manual'); assert.equal(it.needsPrice, true);
      const plain = QB.fromRequestItem({ n: 1, id: 'RF-003', qty: 2 }, line, REF);
      assert.equal(plain.unitPrice, 0, 'plain ' + JSON.stringify(line)); assert.equal(plain.priceBasis, 'manual'); assert.equal(plain.needsPrice, true);
    }
  });
  it('a PLAIN priced line keeps today\'s shape (values only in the description) on the website basis; a plain UNPRICED one is manual + needsPrice', () => {
    const fixed = { n: 2, id: 'RF-003', name: 'Chiller', cat: 'Refrigeration', unit: 'pc', qty: 3, size: { W: 1200 }, specs: [{ label: 'Doors', value: 'Two' }], note: 'n' };
    const priced = QB.fromRequestItem(fixed, { n: 2, priced: true, unitPrice: 5000, formulaType: 'per_length' }, REF);
    assert.equal(priced.id, 'RF-003'); assert.equal(priced.name, 'Chiller'); assert.equal(priced.category, 'Refrigeration');
    assert.equal(priced.specStr, 'Two');
    assert.equal(priced.dims, 'L1200 mm');
    assert.equal(priced.unitPrice, 5000); assert.equal(priced.amount, 15000); assert.equal(priced.qty, 3);
    assert.equal(priced.formulaType, 'per_length');
    assert.equal(priced.priceBasis, 'website'); assert.equal(priced.basisUnitPrice, 5000);
    assert.ok(!('familyId' in priced) && !('config' in priced) && !('size' in priced) && !('priceManual' in priced) && !('needsPrice' in priced));
    assert.deepEqual(priced.sourceRef, { kind: 'qr', ref: REF, n: 2 });
    const unpriced = QB.fromRequestItem(fixed, { n: 2, priced: false, unitPrice: 0 }, REF);
    assert.equal(unpriced.priceBasis, 'manual'); assert.equal(unpriced.needsPrice, true);
    assert.equal(unpriced.unitPrice, 0); assert.equal(unpriced.amount, 0); assert.equal(unpriced.basisUnitPrice, 0);
    assert.ok(!('priceManual' in unpriced));
  });
  it('the sourceRef is only set when a reference is given, and n falls back to the internal line\'s number', () => {
    const { row, line } = real('approved');
    assert.ok(!('sourceRef' in QB.fromRequestItem(row, line)));
    for (const bad of [undefined, null, '', 5, {}, []]) assert.ok(!('sourceRef' in QB.fromRequestItem(row, line, bad)), String(bad));
    assert.deepEqual(QB.fromRequestItem({ ...row, n: undefined }, { ...line, n: 7 }, REF).sourceRef, { kind: 'qr', ref: REF, n: 7 });
    assert.deepEqual(QB.fromRequestItem({ ...row, n: undefined }, { ...line, n: undefined }, REF).sourceRef, { kind: 'qr', ref: REF });
  });
  it('visitor-supplied strings pass through as TEXT: not escaped, not parsed, never turned into markup by this module', () => {
    const HOSTILE = '<img src=x onerror="alert(1)"> & "\' <script>x</script>';
    const { row, line } = real('approved');
    const evil = { ...row, name: HOSTILE, note: HOSTILE, unit: HOSTILE, specs: [{ label: HOSTILE, value: HOSTILE }, { label: 'ok', value: '<b>x</b>' }] };
    const it = QB.fromRequestItem(evil, line, REF);
    assert.equal(it.name, HOSTILE); assert.equal(it.notes, HOSTILE); assert.equal(it.unit, HOSTILE);
    assert.deepEqual(it.specs, [{ label: HOSTILE, value: HOSTILE }, { label: 'ok', value: '<b>x</b>' }]);
    assert.equal(it.specStr, `${HOSTILE}: ${HOSTILE}, ok: <b>x</b>`);
    assert.ok(!/&lt;|&amp;|&quot;/.test(it.specStr), 'the module must not escape (every renderer escapes once, on output)');
    for (const v of [it.name, it.notes, it.unit, it.specStr, it.dims, it.id]) assert.equal(typeof v, 'string');
    const plain = QB.fromRequestItem({ n: 1, id: 'RF-003', name: HOSTILE, specs: [{ label: 'a', value: HOSTILE }], qty: 1 }, { priced: true, unitPrice: 10 }, REF);
    assert.equal(plain.specStr, HOSTILE);
  });
  it('odd input is coerced, never trusted: quantity is a whole number of at least 1, non-text fields become text or nothing, a hostile size is dropped', () => {
    const it = QB.fromRequestItem({ id: { toString() { throw new Error('boom'); } }, name: undefined, cat: [], qty: '-4', unit: 5, note: {}, specs: [null, { label: 5, value: undefined }, 'x', { label: {}, value: [] }], familyId: 'sink', config: 'nope', size: { W: '<b>', D: Infinity, H: 900, X: 1 } }, { priced: true, unitPrice: 'x' }, REF);
    assert.equal(it.qty, 1);
    assert.equal(typeof it.name, 'string'); assert.equal(it.id, ''); assert.equal(it.category, '');
    assert.equal(it.unit, '5'); assert.equal(it.notes, '');
    assert.deepEqual(it.specs, [{ label: '', value: '' }, { label: '5', value: '' }, { label: '', value: '' }, { label: '', value: '' }]);
    assert.deepEqual(it.config, {});
    assert.deepEqual(it.size, { H: 900 });
    assert.equal(it.dims, 'H900 mm');
    assert.equal(it.unitPrice, 0);
    assert.equal(QB.fromRequestItem(undefined, undefined).qty, 1);
    for (const bad of [null, 0, 'x', []]) assert.doesNotThrow(() => QB.fromRequestItem(bad, bad, bad));
  });
  it('a per-run line prints its runs; a missing size prints nothing; quantity strings parse', () => {
    assert.equal(QB.fromRequestItem({ id: 'EX-001', runs: 4, qty: '2' }, null).dims, '4 run(s)');
    assert.equal(QB.fromRequestItem({ id: 'EX-001', runs: 4, qty: '2' }, null).qty, 2);
    assert.equal(QB.fromRequestItem({ id: 'RF-003', size: null }, null).dims, '');
    assert.equal(QB.fromRequestItem({ id: 'RF-003', size: { W: 1200, D: 600, H: 800 } }, null).dims, 'L1200 × W600 × H800 mm');
  });
  it('never mutates the row or the line', () => {
    const { row, line } = real('approved');
    assert.doesNotThrow(() => QB.fromRequestItem(deepFreeze(JSON.parse(JSON.stringify(row))), deepFreeze(JSON.parse(JSON.stringify(line))), REF));
    const it = QB.fromRequestItem(row, line, REF);
    it.config.basins = 9; it.size.W = 1; it.specs[0].value = 'x';
    assert.equal(row.config.basins, 2); assert.equal(row.size.W, 1800); assert.notEqual(row.specs[0].value, 'x');
  });
});

// ═══════════════════════════════════════ 6. purposeFor / locationCodeFor ═══════════════════════════════════════
const builderHtml = read('quote-builder-v2.html');
const optionsOf = (id) => {
  const m = builderHtml.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(m, `no <select id="${id}"> in quote-builder-v2.html`);
  return [...m[1].matchAll(/<option(?:\s+value="([^"]*)")?[^>]*>([^<]*)</g)].map((o) => (o[1] !== undefined ? o[1] : o[2]));
};

describe('purposeFor — the builder\'s "Project type" from what the website told us (§6.3)', () => {
  const P = QB.purposeFor;
  it('the public quote form\'s "use for" (every option, exactly as the table)', () => {
    const want = { restaurant_cafe: 'Restaurant', hotel_resort: 'Hotel Restaurant', commissary: 'Catering / Food Service', catering: 'Catering / Food Service', school: 'Hospital / Institutional', hospital: 'Hospital / Institutional', government: 'Government / Bidding', home: 'Residential', other: 'Other' };
    for (const [useFor, purpose] of Object.entries(want)) assert.equal(P({ useFor, entityType: 'private' }), purpose, useFor);
    assert.deepEqual(Object.keys(want).sort(), require('../js/qr-def.js').INTAKE.useFor.options.map((o) => o.v).sort(), 'the table covers every option the public form offers');
  });
  it('a GOVERNMENT entity is always Government / Bidding, whatever it will use the kitchen for', () => {
    for (const useFor of ['restaurant_cafe', 'hotel_resort', 'commissary', 'catering', 'school', 'hospital', 'home', 'other', 'junk']) assert.equal(P({ useFor, entityType: 'government' }), 'Government / Bidding', useFor);
    assert.equal(P({ entityType: 'government' }), 'Government / Bidding');
    assert.equal(P({ useFor: 'hospital', entityType: 'private' }), 'Hospital / Institutional');
    assert.equal(P({ useFor: 'hospital', entityType: 'Government' }), 'Hospital / Institutional', 'only the exact value overrides');
  });
  it('the project brief\'s project type (every option, exactly as the table; bakery has no builder equivalent)', () => {
    const want = { restaurant: 'Restaurant', cafe: 'Cafe / Coffee Shop', bakery: 'Other', commissary: 'Catering / Food Service', hotel: 'Hotel Restaurant', catering: 'Catering / Food Service', hospital: 'Hospital / Institutional', school: 'Hospital / Institutional', laboratory: 'Hospital / Institutional', government: 'Government / Bidding', home: 'Residential', other: 'Other' };
    for (const [t, purpose] of Object.entries(want)) assert.equal(P({ cirProjectType: t }), purpose, t);
    const types = [...read('js/cir-forms.js').matchAll(/\{ v: '([a-z_]+)',\s+l: '[^']*',\s+d: '/g)].map((m) => m[1]);
    for (const t of Object.keys(want)) assert.ok(types.includes(t), `${t} is not a project type of the brief form`);
    for (const t of types) assert.ok(Object.prototype.hasOwnProperty.call(want, t), `the brief offers "${t}" but the table does not cover it`);
  });
  it('the old brief\'s free-text business type: first group with a keyword wins, case-insensitive', () => {
    const rows = [
      ['Hotel & Resort', 'Hotel Restaurant'], ['hotel restaurant', 'Hotel Restaurant'], ['HOTEL', 'Hotel Restaurant'],
      ['Café', 'Cafe / Coffee Shop'], ['Cafeteria', 'Cafe / Coffee Shop'], ['coffee CAFE', 'Cafe / Coffee Shop'], ['Cafe restaurant', 'Cafe / Coffee Shop'],
      ['Restaurant', 'Restaurant'], ['Grill house', 'Restaurant'], ['Fast food chain', 'Restaurant'], ['Fast food central kitchen', 'Restaurant'],
      ['Hospital', 'Hospital / Institutional'], ['Private clinic', 'Hospital / Institutional'], ['School canteen', 'Hospital / Institutional'], ['University', 'Hospital / Institutional'], ['Laboratory', 'Hospital / Institutional'],
      ['Government agency', 'Government / Bidding'], ['LGU canteen', 'Government / Bidding'], ['Provincial government', 'Government / Bidding'],
      ['Home kitchen', 'Residential'], ['Residential', 'Residential'],
      ['Commissary', 'Catering / Food Service'], ['Catering service', 'Catering / Food Service'], ['Central kitchen', 'Catering / Food Service'],
      ['Bakery', 'Other'], ['', 'Other'], ['   ', 'Other'], ['something else', 'Other'],
    ];
    for (const [text, purpose] of rows) assert.equal(P({ cirBizType: text }), purpose, JSON.stringify(text));
  });
  it('unknown, missing and hostile values are Other (never an inherited property, never a throw)', () => {
    for (const bad of [undefined, null, 0, 'x', [], {}, { useFor: 'zzz' }, { useFor: '__proto__' }, { useFor: 'constructor' }, { useFor: 'toString' }, { cirProjectType: 'hasOwnProperty' }, { cirProjectType: '__proto__' }, { useFor: 5 }, { cirBizType: 5 }, { cirBizType: {} }]) {
      assert.equal(P(bad), 'Other', JSON.stringify(bad));
    }
  });
  it('the first source given decides: use-for, then project type, then business type', () => {
    assert.equal(P({ useFor: 'home', cirProjectType: 'restaurant', cirBizType: 'hotel' }), 'Residential');
    assert.equal(P({ cirProjectType: 'restaurant', cirBizType: 'hotel' }), 'Restaurant');
    assert.equal(P({ cirBizType: 'hotel' }), 'Hotel Restaurant');
    assert.equal(P({ useFor: 'zzz', cirProjectType: 'restaurant' }), 'Other', 'an unknown value from the first source is Other, not a fall-through');
  });
  it('every answer is one of the builder\'s own #purpose options (read from quote-builder-v2.html)', () => {
    const options = optionsOf('purpose');
    assert.deepEqual(options, ['Restaurant', 'Hotel Restaurant', 'Hospital / Institutional', 'Government / Bidding', 'Residential', 'Cafe / Coffee Shop', 'Catering / Food Service', 'Other']);
    const answers = new Set();
    for (const useFor of ['restaurant_cafe', 'hotel_resort', 'commissary', 'catering', 'school', 'hospital', 'government', 'home', 'other', 'zzz']) answers.add(P({ useFor }));
    for (const t of ['restaurant', 'cafe', 'bakery', 'commissary', 'hotel', 'catering', 'hospital', 'school', 'laboratory', 'government', 'home', 'other', 'zzz']) answers.add(P({ cirProjectType: t }));
    for (const b of ['hotel', 'cafe', 'grill', 'clinic', 'agency', 'home', 'central', 'nothing']) answers.add(P({ cirBizType: b }));
    answers.add(P({ entityType: 'government' })); answers.add(P());
    for (const a of answers) assert.ok(options.includes(a), `"${a}" is not a #purpose option`);
    for (const o of options) assert.ok(answers.has(o), `no input reaches the option "${o}"`);
  });
});

describe('locationCodeFor — the builder\'s quote-number location from an address (§6.4)', () => {
  const L = QB.locationCodeFor;
  it('the spec\'s examples', () => {
    assert.equal(L('Quezon City, Metro Manila'), 'ML');
    assert.equal(L('San Fernando, La Union'), 'LU');
    assert.equal(L('21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila'), 'ML');
  });
  it('every place name of the table maps to its code, case-insensitively', () => {
    const table = {
      LU: ['la union'], BG: ['baguio', 'benguet'], SB: ['subic', 'olongapo', 'zambales'], CL: ['clark', 'angeles', 'pampanga', 'mabalacat'], DA: ['davao'],
      CB: ['cebu', 'mandaue', 'lapu-lapu', 'lapu lapu'], IG: ['ilocos', 'vigan', 'laoag'],
      ML: ['metro manila', 'manila', 'ncr', 'quezon city', 'makati', 'pasig', 'taguig', 'mandaluyong', 'pasay', 'parañaque', 'paranaque', 'caloocan', 'marikina', 'muntinlupa', 'las piñas', 'las pinas', 'valenzuela', 'malabon', 'navotas', 'san juan', 'pateros', 'bgc'],
    };
    for (const [code, places] of Object.entries(table)) {
      for (const p of places) {
        for (const text of [p, p.toUpperCase(), `Brgy. 12, ${p} City, Philippines`, `12 Main St, ${p}`, `${p.replace(/\b./g, (c) => c.toUpperCase())}`]) assert.equal(L(text), code, `${p} -> ${text}`);
      }
    }
  });
  it('anywhere else is OT', () => {
    for (const t of ['', '   ', 'Lipa City, Batangas', 'Tarlac City', 'Iloilo', 'Cagayan de Oro', 'Philippines', 'Los Baños, Laguna']) assert.equal(L(t), 'OT', JSON.stringify(t));
  });
  it('the first matching RULE wins, in the table\'s order (La Union before Manila and San Juan; Baguio before Manila; Clark before Manila)', () => {
    assert.equal(L('San Juan, La Union'), 'LU');
    assert.equal(L('Baguio City, near Manila North Road'), 'BG');
    assert.equal(L('Clark Freeport, Pampanga, 90 km from Manila'), 'CL');
    assert.equal(L('Subic Bay, Zambales'), 'SB');
    assert.equal(L('Ilocos Norte via Manila'), 'IG');
    assert.equal(L('Cebu City / Metro Manila office'), 'CB');
    assert.equal(L('Davao, then Metro Manila'), 'DA');
    assert.equal(L('San Juan City, Metro Manila'), 'ML');
  });
  it('a place name is matched as a WHOLE word or phrase (NCR is not found inside "concrete"), with any spacing and the accent composed or decomposed', () => {
    assert.equal(L('Concrete Road, Lipa City'), 'OT');
    assert.equal(L('Francrane Compound, Lipa'), 'OT');
    assert.equal(L('Mabalacatan'), 'OT');
    assert.equal(L('Caloocan(NCR)'), 'ML');
    assert.equal(L('NCR-BGC'), 'ML');
    assert.equal(L('Quezon    City'), 'ML');
    assert.equal(L('Quezon City'), 'ML');
    assert.equal(L('Parañaque'), 'ML');
    assert.equal(L('Parañaque'), 'ML', 'a decomposed n + combining tilde');
    assert.equal(L('Las Piñas'), 'ML');
    assert.equal(L('LA   UNION'), 'LU');
  });
  it('junk is OT, never a throw', () => {
    for (const bad of [undefined, null, 0, 5, {}, [], true, () => 'Manila']) assert.equal(L(bad), 'OT', String(bad));
    assert.equal(L(['Manila']), 'OT');
  });
  it('every answer is one of the builder\'s own #qnoLoc codes (read from quote-builder-v2.html)', () => {
    const options = optionsOf('qnoLoc');
    assert.deepEqual(options, ['LU', 'BG', 'ML', 'SB', 'CL', 'DA', 'CB', 'IG', 'OT']);
    const answers = new Set(['la union', 'baguio', 'manila', 'subic', 'clark', 'davao', 'cebu', 'ilocos', 'nowhere', ''].map(L));
    for (const o of options) assert.ok(answers.has(o), o);
    for (const a of answers) assert.ok(options.includes(a), a);
    assert.ok(optionsOf('qnoMethod').includes('WB'), 'the hand-off sets the lead source to WB (Website)');
  });
});

// ═══════════════════════════════════════ 7. migrateLegacyConfiguredLine (§10.3) ═══════════════════════════════════════
describe('migrateLegacyConfiguredLine — an old plain line becomes a configured line, keeping its price', () => {
  const plain = (over) => ({
    id: 'PW-006', category: 'prep_washing', name: 'Sink 2 bowls', dims: 'L1200 × W500 × H850 mm',
    specs: [{ label: 'Faucet Type', value: 'Gooseneck' }], specStr: 'Gooseneck', qty: 2, unit: 'pc', unitPrice: 12345, amount: 24690,
    leadTime: '3 wks', laborHours: null, capitalMaterials: 4400, capitalLabor: 1500, formulaType: 'fixed', notes: 'by the window', _uid: 'u1abc', ...(over || {}),
  });
  const migrate = (item) => QB.migrateLegacyConfiguredLine(DEPS, item);

  it('a PW-006 plain line becomes a sink: the SKU\'s configuration with the saved faucet applied through specMap, the saved size kept on the step', () => {
    const out = migrate(plain());
    assert.equal(out.familyId, 'sink');
    assert.deepEqual(out.config, { grade: 304, basins: 2, alignment: 'center', undershelf: false, upper: false, faucet: 'gooseneck', top: 1.5 }, 'the SKU converts to the standard steel grade and the standard 1.5 mm top plate');
    assert.deepEqual(out.size, { W: 1200, D: 500, H: 850 });
    assert.equal(out.dims, 'L1200 × W500 × H850 mm');
    assert.equal(out.id, 'PW-004', 'the family\'s primary SKU');
    assert.equal(out.name, 'SS Sink', 'a converted line is named by its title, like a line built in the panel');
    assert.equal(out.category, 'prep_washing', 'the section the line already sat in is KEPT — never the family\'s public category ("washing")');
    assert.equal(out.familyVersion, FAM.version);
    assert.deepEqual(out.specs, PF.describe(fam('sink'), out.config));
    assert.equal(out.specStr, 'Material: Stainless Steel 304 Food Grade, Sinks: 2, Sink position: Centre, Undershelf: Without, Upper shelf: Without, Faucet: Gooseneck, Construction: SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet');
    assert.equal(PF.validateLine(fam('sink'), out.config, out.size).ok, true);
  });
  it('KEEPS the unit price, lands on the MANUAL basis (a typed price sticks), and is never auto-priceable', () => {
    const out = migrate(plain());
    assert.equal(out.unitPrice, 12345); assert.equal(out.amount, 24690); assert.equal(out.qty, 2);
    assert.equal(out.priceBasis, 'manual');
    assert.equal(out.priceManual, true);
    assert.equal(out.basisUnitPrice, 0, 'the website figure is not known here; the builder recomputes it');
    assert.ok(!('needsPrice' in out));
    assert.equal(QB.isAutoPriceable(out), false);
  });
  it('carries everything else on the line over (misc-cost distribution id, notes, lead time, unit…) and drops the cost snapshots and any runtime _cfg', () => {
    const out = migrate(plain({ _cfg: { base: 1 }, passThrough: false, volumeBreakOff: true }));
    assert.equal(out._uid, 'u1abc'); assert.equal(out.notes, 'by the window'); assert.equal(out.leadTime, '3 wks'); assert.equal(out.unit, 'pc');
    assert.equal(out.volumeBreakOff, true); assert.equal(out.formulaType, 'fixed');
    assert.ok(!('capitalMaterials' in out) && !('capitalLabor' in out) && !('_cfg' in out));
    noUndefined(out);
  });
  it('an old request hand-off line "<family> (configured)" at its primary SKU converts too, losing the stand-in suffix and keeping its price', () => {
    const legacy = { id: 'PW-004', category: 'washing', name: 'Sink (configured)', dims: 'L1800 × W700 × H900 mm', specs: [{ label: 'Faucet', value: 'Pre-rinse spray' }], specStr: 'Sinks: 2', qty: 2, unit: 'pc', unitPrice: 36703, amount: 73406, leadTime: '—', laborHours: null, formulaType: 'fixed', notes: '', priceManual: true };
    const out = migrate(legacy);
    assert.equal(out.name, 'SS Sink', 'losing the stand-in suffix, the line takes the title'); assert.equal(out.id, 'PW-004'); assert.equal(out.familyId, 'sink');
    assert.equal(out.unitPrice, 36703); assert.equal(out.amount, 73406);
    assert.equal(out.priceBasis, 'manual'); assert.equal(out.priceManual, true);
    assert.equal(out.config.faucet, 'prerinse', 'the saved faucet row maps through specMap');
    assert.deepEqual(out.size, { W: 1800, D: 700, H: 900 });
  });
  it('the saved size is rounded to the step, raised to the family\'s HARD minimum for those options, and never invented', () => {
    assert.deepEqual(migrate(plain({ dims: 'L1203 × W503 × H851 mm' })).size, { W: 1200, D: 500, H: 850 });
    assert.deepEqual(migrate(plain({ dims: 'L800 × W500 × H850 mm' })).size, { W: 1000, D: 500, H: 850 }, '2 sinks need 1000 mm');
    assert.deepEqual(migrate(plain({ dims: '' })).size, { W: 1000, D: 500, H: 850 }, 'no saved size: the family default raised to the hard rule');
    assert.deepEqual(migrate(plain({ dims: undefined })).size, { W: 1000, D: 500, H: 850 });
    assert.deepEqual(migrate(plain({ dims: '4 run(s)' })).size, { W: 1000, D: 500, H: 850 });
    assert.deepEqual(migrate(plain({ dims: "L4' 0\" × W2' 0\" × H2' 10\"" })).size, { W: 1000, D: 500, H: 850 }, 'feet-and-inches text is not guessed at');
  });
  it('reads the size from centimetres or metres, and from a numeric size when the line carries one (which wins over the text)', () => {
    assert.deepEqual(migrate(plain({ dims: 'L120 × W50 × H85 cm' })).size, { W: 1200, D: 500, H: 850 });
    assert.deepEqual(migrate(plain({ dims: 'L1.2 × W0.5 × H0.85 m' })).size, { W: 1200, D: 500, H: 850 });
    assert.deepEqual(migrate(plain({ dims: 'L9999 × W9999 × H9999 mm', size: { W: 1400, D: 600, H: 900 } })).size, { W: 1400, D: 600, H: 900 });
    assert.deepEqual(migrate(plain({ dims: 'L1500 mm' })).size, { W: 1500, D: 500, H: 850 }, 'axes the text does not give take the family default');
  });
  it('a line with NO price converts to a line that needs one; a stale priceManual flag is dropped with it', () => {
    for (const unitPrice of [0, undefined, -4, 'x']) {
      const out = migrate(plain({ unitPrice, amount: 0, priceManual: true }));
      assert.equal(out.unitPrice, 0); assert.equal(out.amount, 0);
      assert.equal(out.priceBasis, 'manual'); assert.equal(out.needsPrice, true);
      assert.ok(!('priceManual' in out), String(unitPrice));
    }
  });
  it('converts a line of every family\'s absorbed SKUs into a valid configured line of that family', () => {
    for (const id of FIDS) {
      for (const sku of Object.keys(fam(id).absorbed)) {
        const out = migrate({ id: sku, name: sku, dims: '', specs: [], qty: 1, unit: 'pc', unitPrice: 1000, amount: 1000 });
        assert.ok(out, sku);
        assert.equal(out.familyId, id); assert.equal(out.id, fam(id).primary);
        assert.equal(PF.validateLine(fam(id), out.config, out.size).ok, true, sku);
        assert.equal(PF.sameConfig(fam(id), out.config, full(fam(id), fam(id).absorbed[sku])), true, `${sku} keeps the SKU's own configuration when nothing else is saved (at the standard top plate)`);
      }
    }
  });
  it('a non-absorbed id, a fixed catalogue product, a custom or fee line, an already-configured line and junk are NOT converted (null)', () => {
    for (const id of ['RF-003', 'CE-030', 'EX-004', 'CUSTOM', 'MISCFEE', '', 'nope', 'pw-006']) assert.equal(migrate(plain({ id })), null, id);          // CE-030 (salamander) is still a fixed item; EX-004 (ducting) is not published
    assert.equal(migrate(plain({ id: undefined })), null);
    assert.equal(migrate(plain({ id: 5 })), null);
    assert.equal(migrate(plain({ familyId: 'sink' })), null, 'already configured');
    for (const bad of [undefined, null, 0, 'PW-006', [], true]) assert.equal(migrate(bad), null, String(bad));
    assert.equal(QB.migrateLegacyConfiguredLine(undefined, plain()), null);
    assert.equal(QB.migrateLegacyConfiguredLine({}, plain()), null);
    assert.equal(QB.migrateLegacyConfiguredLine({ PF, FAM: null }, plain()), null);
  });
  it('is pure: the input line is untouched and the result shares nothing with it', () => {
    const src = deepFreeze(plain());
    const out = migrate(src);
    assert.equal(src.id, 'PW-006');
    out.config.basins = 3; out.size.W = 1; out.specs.push({});
    assert.equal(migrate(src).config.basins, 2);
  });
});

// ═══════════════════════════════════════ 8. the module itself ═══════════════════════════════════════
describe('js/qb-configured.js — surface, purity, nothing sensitive', () => {
  const src = read('js/qb-configured.js');
  const code = src.replace(/\/\/.*$/gm, '');      // the file without its // comments

  it('exports exactly the eleven functions of the spec', () => {
    assert.deepEqual(Object.keys(QB).sort(), ['buildLine', 'comparableTotal', 'costBasisFor', 'estimateCheck', 'fromRequestItem', 'isAutoPriceable', 'locationCodeFor', 'migrateLegacyConfiguredLine', 'nearestAbsorbed', 'priceLine', 'purposeFor'].sort());
    for (const f of Object.values(QB)) assert.equal(typeof f, 'function');
  });
  it('UMD like its siblings: a plain <script> sets window.QBConfigured and needs no module; require() under Node creates NO window global', () => {
    const win = {};
    const ctx = vm.createContext({ window: win });
    vm.runInContext(src, ctx);
    assert.equal(typeof win.QBConfigured.priceLine, 'function');
    assert.deepEqual(Object.keys(win.QBConfigured).sort(), Object.keys(QB).sort());
    assert.equal(typeof globalThis.window, 'undefined', 'requiring the module under Node must not create a window global');
  });
  it('no DOM, no Firebase, no storage, no network, no clock, no randomness, no module loading — it only computes', () => {
    for (const re of [/\bdocument\b/, /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, /\bfirebase\b|\bFirestore\b|\bdb\./i, /\bfetch\s*\(|XMLHttpRequest|WebSocket/, /Date\.now|new Date|Math\.random|performance\.now|setTimeout|setInterval/, /\brequire\s*\(|\bimport\s/, /\beval\b|new Function/, /\bconsole\./, /innerHTML|insertAdjacentHTML/]) {
      assert.ok(!re.test(code), `forbidden in a pure module: ${re}`);
    }
    assert.equal((code.match(/\bwindow\b/g) || []).length, 2, 'window appears only in the UMD shim');
  });
  it('carries no price, rate or amount of its own, and none of the public-site or partner vocabulary', () => {
    assert.ok(!/₱/.test(src));
    assert.ok(!/\bbasePrice\b|\bpriceAdder\b|pricePerExtraMm|rateD100|rateH100|\bpricePerSqm\b|\bpricePerRun\b/.test(code), 'the module reads prices through PricingCore only');
    assert.ok(!/Brilliant|\bgmail\b|barroindustries@/i.test(src));
    const numbers = [...code.matchAll(/(?<![\w.$'"-])\d+(?:\.\d+)?(?![\w'"])/g)].map((m) => Number(m[0]));
    assert.ok(numbers.every((n) => n <= 1000), 'a numeric literal above 1000 in the module: ' + numbers.filter((n) => n > 1000));
  });
  it('is ES5 like its siblings (the same old-phone-safe style): no arrow functions, let / const, template strings or spread', () => {
    assert.ok(!/=>/.test(code));
    assert.ok(!/\b(?:let|const)\s/.test(code));
    assert.ok(!/`/.test(code));
    assert.ok(!/\.\.\.[A-Za-z_{[(]/.test(code));
  });
  it('is registered for offline use: sw.js precaches it, and the file exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'js/qb-configured.js')));
    assert.match(read('sw.js'), /'\/js\/qb-configured\.js',/);
  });
  it('the shared libraries it leans on are unchanged in the ways it depends on (export lists)', () => {
    assert.deepEqual(Object.keys(PC).sort(), ['estimateGate', 'estimateRange', 'normalisePricingDoc', 'priceCatalogItem', 'priceConfiguredItem', 'validateSelection']);
    for (const k of ['validateLine', 'minWidth', 'describe', 'sizeTextLabelled', 'migrateAbsorbed', 'sameConfig', 'cells', 'forcedMins', 'defaultDims']) assert.equal(typeof PF[k], 'function', k);
    assert.equal(typeof FAM.version, 'number');
  });
});

// ═══════════════════════════════ 9. the staff-only top plate and the builder SECTION (owner ruling 2026-10-28) ═══════════════════════════════
// QUOTE-BUILDER-CONFIGURATOR-SPEC §14.2 / §14.7: tables, sinks and stoves have a staff-only `top` group (1.5 mm standard, 1.2 mm lighter). The absorbed configurations
// never state it, a line saved before it existed has no `top` either, and only a STAFF session may choose 1.2 mm — so this module compares with an absent key read as the
// default, and validates in staff mode. Also: a configured line sits in its base product's builder section, never in the family's PUBLIC category.
describe('the staff-only top plate: default fill in the nearest-model match, staff-mode validation, a blank 1.2 mm cell, and the builder section of a line', () => {
  const WITH_TOP = ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range'];
  const withoutTop = (cfg) => { const { top, ...rest } = cfg; void top; return rest; };
  const withoutStaff = (cfg) => { const { top, grade, ...rest } = cfg; void top; void grade; return rest; };       // a configuration stored before EITHER staff-only group existed
  // a copy of the approved sheet whose 1.2 mm top cell is `cell` ({ flat, perW100 }); the standard 1.5 mm top never has a cell of its own to fill
  const sheetWithTop = (id, cell) => ({ ...SHEETS.approved[id], options: { ...SHEETS.approved[id].options, top: { 1.2: cell } } });
  const priceAt = (id, cfg, sheet) => QB.priceLine(DEPS, { family: fam(id), primary: PRIMARIES[id], config: cfg, size: PF.defaultDims(fam(id)), sheet });

  describe('nearestAbsorbed — an ABSENT group reads as its default, so the primary is still EXACT once a family has a staff-only top plate', () => {
    it('the primary at the full default configuration (top plate included) is exact with the full score — for all eleven families, and also when the configuration does not state the top at all', () => {
      for (const id of FIDS) {
        const f = fam(id);
        const cfg = PF.defaultConfig(f);
        for (const c of [cfg, withoutTop(cfg)]) {
          const got = QB.nearestAbsorbed(f, c);
          assert.equal(got.sku, f.primary, id);
          assert.equal(got.exact, true, `${id}: the primary must be exact (the absorbed configurations never state the top plate)`);
          assert.ok(near(got.score, f.groups.length), `${id} score ${got.score}`);
        }
      }
    });
    it('a 1.2 mm top is NOT exact — the nearest standard model is still the primary, one point short; the same line with the standard top is exact', () => {
      for (const id of WITH_TOP) {
        const f = fam(id);
        const light = QB.nearestAbsorbed(f, { ...PF.defaultConfig(f), top: 1.2 });
        assert.equal(light.sku, f.primary, id);
        assert.equal(light.exact, false, `${id}: a lighter top is not the standard model`);
        assert.ok(near(light.score, f.groups.length - 1), `${id} score ${light.score}`);
        assert.equal(QB.nearestAbsorbed(f, { ...PF.defaultConfig(f), top: 1.5 }).exact, true, id);
      }
    });
    it('exact agrees with ProductFamilies.sameConfig of the two VALIDATED configurations, for every absorbed SKU at both top plates', () => {
      let n = 0;
      for (const id of FIDS) {
        const f = fam(id);
        for (const sku of Object.keys(f.absorbed)) for (const top of (WITH_TOP.includes(id) ? [1.5, 1.2] : [undefined])) {
          const cfg = full(f, top === undefined ? f.absorbed[sku] : { ...f.absorbed[sku], top });
          const got = QB.nearestAbsorbed(f, cfg);
          assert.equal(got.exact, PF.sameConfig(f, cfg, full(f, f.absorbed[got.sku])), `${id} ${sku} top ${top}`);
          assert.equal(got.exact, top !== 1.2 && PF.sameConfig(f, cfg, full(f, f.absorbed[sku])), `${id} ${sku} top ${top}: exact only at the standard top`);
          n++;
        }
      }
      assert.equal(n, 64 + 35, '64 absorbed SKUs, plus the 1.2 mm variant of the 35 table / sink / dish table / stove / wok range ones');
    });
  });

  describe('priceLine — the standard top needs no cell; a BLANK 1.2 mm cell is "missing input" naming it, never zero', () => {
    for (const id of WITH_TOP) {
      it(`${id}: a blank 1.2 mm cell leaves the line "priced after review" (missing Top plate: 1.2 mm), an explicit amount prices it (signed, a negative lowers it, 0 keeps it), and the standard top never reads the cell`, () => {
        const std = { ...PF.defaultConfig(fam(id)), top: 1.5 };
        const light = { ...std, top: 1.2 };
        const blankSheet = sheetWithTop(id, { flat: null, perW100: null });
        const blank = priceAt(id, light, blankSheet);
        assert.equal(blank.priced, false); assert.equal(blank.unitPrice, 0);
        assert.equal(blank.reason, 'missing_input');
        assert.deepEqual(blank.missing, ['Top plate: 1.2 mm']);
        // the standard top prices from the base item alone, whatever the 1.2 mm cell holds (and even with no cell at all)
        const base = priceAt(id, std, blankSheet);
        assert.equal(base.priced, true); assert.equal(base.reason, null);
        assert.deepEqual(base.deltas, []);
        const noTop = { ...SHEETS.approved[id], options: Object.fromEntries(Object.entries(SHEETS.approved[id].options).filter(([g]) => g !== 'top')) };
        assert.equal(priceAt(id, std, noTop).unitPrice, base.unitPrice);
        // a NEGATIVE amount lowers the line by exactly that much, 0 keeps it (an explicit 0 IS a figure)
        const cheaper = priceAt(id, light, sheetWithTop(id, { flat: -777, perW100: null }));
        assert.equal(cheaper.priced, true);
        assert.equal(cheaper.unitPrice, base.unitPrice - 777);
        assert.deepEqual(cheaper.deltas, [{ key: 'top:1.2', amount: -777 }]);
        const same = priceAt(id, light, sheetWithTop(id, { flat: 0, perW100: null }));
        assert.equal(same.priced, true); assert.equal(same.unitPrice, base.unitPrice);
        // and the builder prices it exactly as the server's pricer does (computeBasket on the same hand-built line; the SERVER refuses such a line before it gets there)
        const handBuilt = [{ n: 1, kind: 'family', id: fam(id).primary, familyId: id, name: fam(id).label, cat: fam(id).category, unit: 'pc', qty: 1, runs: null, size: PF.defaultDims(fam(id)), sizeCustom: false, config: light, specs: [], note: '' }];
        for (const sheet of [blankSheet, sheetWithTop(id, { flat: -777, perW100: null })]) {
          const docs = [{ id, data: sheet }];
          const basket = Q.computeBasket(handBuilt, new Map(), {}, undefined, { families: FAM, primaries: PRIMARY_MAP, pricing: Q.buildPricingIndex(docs, FAM) });
          assert.deepEqual(pickKeys(priceAt(id, light, sheet)), pickKeys(basket.lines[0]), `${id}: builder and server price the same line differently`);
        }
      });
    }
    it('a sheet approved against the OLD definitions (schema 1) prices nothing: the base item\'s list price must be approved again as the 1.5 mm price', () => {
      assert.equal(FAM.version, 4, 'schema 4: the staff-only steel grade and the line titles (no sheet is approved against it yet, so the bump costs nothing live)');
      for (const id of FIDS) {
        for (const older of [1, 2, 3]) {
          const old = priceAt(id, PF.defaultConfig(fam(id)), { ...SHEETS.approved[id], schemaVersion: older });
          assert.equal(old.priced, false, `${id} at schema ${older}`); assert.equal(old.reason, 'not_approved', `${id} at schema ${older}`);
        }
        assert.equal(priceAt(id, PF.defaultConfig(fam(id)), { ...SHEETS.approved[id], schemaVersion: FAM.version }).priced, true, `${id}: the control — the current schema, approved, prices`);
      }
    });
  });

  describe('buildLine / migrateLegacyConfiguredLine validate in STAFF mode', () => {
    for (const id of WITH_TOP) {
      it(`${id}: buildLine accepts a 1.2 mm top, stores it, and its specs end with the Construction row for that top (never a "Top plate" row); an unpriced one needs a price`, () => {
        const f = fam(id);
        const cfg = { ...PF.defaultConfig(f), top: 1.2 };
        const size = PF.defaultDims(f);
        const priced = priceAt(id, cfg, sheetWithTop(id, { flat: -777, perW100: null }));
        const it = QB.buildLine(DEPS, { family: f, primary: PRIMARIES[id], config: cfg, size, qty: 2, basis: priced });
        assert.ok(it, `${id}: a staff session builds a 1.2 mm line`);
        assert.equal(it.config.top, 1.2);
        assert.equal(it.priceBasis, 'website'); assert.equal(it.unitPrice, priced.unitPrice);
        assert.equal(it.specs.at(-1).label, 'Construction');
        assert.equal(it.specs.at(-1).value, PF.constructionLine(f, cfg));
        assert.match(it.specs.at(-1).value, /1\.2 mm top plate \(lighter\)/);
        assert.ok(!it.specs.some((s) => /top plate/i.test(s.label)), 'no "Top plate" row of its own');
        assert.match(it.specStr, /Construction: SS304 stainless steel · 1\.2 mm top plate \(lighter\)/);
        // the blank cell: priced after review -> manual, needs a price, at zero
        const unpriced = QB.buildLine(DEPS, { family: f, primary: PRIMARIES[id], config: cfg, size, qty: 1, basis: priceAt(id, cfg, sheetWithTop(id, { flat: null, perW100: null })) });
        assert.equal(unpriced.priceBasis, 'manual'); assert.equal(unpriced.needsPrice, true); assert.equal(unpriced.unitPrice, 0);
        assert.deepEqual(unpriced._cfg.missing, ['Top plate: 1.2 mm']);
        assert.equal(unpriced.config.top, 1.2);
      });
    }
    it('a value that is not an option of the top plate still builds NOTHING, and a configuration with no top is built at the standard one', () => {
      const f = fam('sink');
      assert.equal(QB.buildLine(DEPS, { family: f, primary: PRIMARIES.sink, config: { ...PF.defaultConfig(f), top: 9 }, size: PF.defaultDims(f) }), null);
      assert.equal(QB.buildLine(DEPS, { family: f, primary: PRIMARIES.sink, config: { ...PF.defaultConfig(f), top: '1.2' }, size: PF.defaultDims(f) }), null);
      assert.equal(QB.buildLine(DEPS, { family: f, primary: PRIMARIES.sink, config: withoutTop(PF.defaultConfig(f)), size: PF.defaultDims(f) }).config.top, 1.5);
    });
    it('every absorbed SKU converts to a line at the standard 1.5 mm top whose specs end with the Construction row at that top', () => {
      let n = 0;
      for (const id of FIDS) for (const sku of Object.keys(fam(id).absorbed)) {
        const out = QB.migrateLegacyConfiguredLine(DEPS, { id: sku, category: 'prep_washing', name: sku, dims: '', specs: [], qty: 1, unit: 'pc', unitPrice: 1000, amount: 1000 });
        assert.ok(out, sku);
        if (WITH_TOP.includes(id)) assert.equal(out.config.top, 1.5, sku);
        assert.equal(out.specs.at(-1).label, 'Construction', sku);
        assert.equal(out.specs.at(-1).value, PF.constructionLine(fam(id), out.config), sku);
        n++;
      }
      assert.equal(n, 64);
    });
  });

  describe('an ABSENT group reads as its default — a request or draft stored before the top plate existed prices like the standard 1.5 mm configuration (owner follow-up 2026-10-28)', () => {
    it('priceLine: a configuration with no `top` prices EXACTLY like the same configuration at the standard 1.5 mm top — and exactly as the server prices it (330 seeded random lines x 3 sheets)', () => {
      const r = rng(77077);
      let withTop = 0;
      for (let i = 0; i < 330; i++) {
        const fid = FIDS[i % FIDS.length];
        const { config, size, qty } = randomLine(r, fid);
        for (const kind of ['approved', 'unapproved', 'blank']) {
          const std = ours(fid, config, size, kind);
          const old = ours(fid, withoutTop(config), size, kind);
          assert.deepEqual(old, std, `${fid} ${kind} ${JSON.stringify(config)}`);                    // every field: price, reason, missing, base, deltas, pricedSize, warnings
          assert.ok(!old.missing.includes('Top plate'), `${fid} ${kind}: "Top plate" reported missing`);
          const older = ours(fid, withoutStaff(config), size, kind);                                  // ... and one stored before the steel grade existed either
          assert.deepEqual(older, std, `${fid} ${kind}: no grade stated`);
          assert.ok(!older.missing.includes('Material'), `${fid} ${kind}: "Material" reported missing`);
          assert.deepEqual(pickKeys(old), pickKeys(serverLine(fid, config, size, qty, kind).line), `${fid} ${kind}: not what the server prices`);
        }
        if (WITH_TOP.includes(fid)) withTop++;
      }
      assert.ok(withTop >= 140, `the sweep must cover the five families that have a top plate (${withTop})`);
    });

    it('only ABSENT keys are filled — a stated value is never touched: 1.2 mm stays 1.2 mm (and reads its own cell), undefined counts as absent, a wrong value is not silently "fixed"', () => {
      for (const id of WITH_TOP) {
        const std = { ...PF.defaultConfig(fam(id)), top: 1.5 };
        const cheap = sheetWithTop(id, { flat: -777, perW100: null });
        const standard = priceAt(id, std, cheap);
        assert.equal(standard.priced, true, id);
        assert.equal(priceAt(id, { ...std, top: 1.2 }, cheap).unitPrice, standard.unitPrice - 777, `${id}: a STATED 1.2 mm top is priced as 1.2 mm`);
        assert.equal(priceAt(id, { ...withoutTop(std), top: 1.2 }, sheetWithTop(id, { flat: null, perW100: null })).reason, 'missing_input', `${id}: and a blank 1.2 mm cell still leaves it unpriced`);
        assert.deepEqual(priceAt(id, { ...withoutTop(std), top: undefined }, cheap), standard, `${id}: undefined is absent`);
        for (const wrong of [9, null, '1.5', true, []]) {
          const w = priceAt(id, { ...std, top: wrong }, cheap);
          assert.equal(w.priced, false, `${id} ${JSON.stringify(wrong)}: a wrong top plate must not price`);
          assert.equal(w.reason, 'missing_input', `${id} ${JSON.stringify(wrong)}`);
          assert.ok(w.missing.some((m) => /^Top plate/.test(m)), `${id} ${JSON.stringify(wrong)}: ${JSON.stringify(w.missing)}`);
        }
      }
    });

    it('every group a configuration leaves out reads as its default — not only the top plate — and the width rule sees the completed configuration too', () => {
      const sinkSize = { W: 1000, D: 500, H: 850 };
      assert.deepEqual(ours('sink', { basins: 2 }, sinkSize, 'approved'), ours('sink', full(fam('sink'), { basins: 2 }), sinkSize, 'approved'));
      // stove: only an add-on stated — the burners are the default single burner, so the usual length is 400 + 200 + 200 = 800 mm and a 600 mm body is priced (and warned) at it
      const stoveSize = { W: 600, D: 700, H: 850 };
      const part = ours('stove', { addons: ['griller'] }, stoveSize, 'approved');
      assert.deepEqual(part, ours('stove', full(fam('stove'), { addons: ['griller'] }), stoveSize, 'approved'));
      assert.deepEqual(part.warnings, ['Asked for 600 mm; priced at the usual 800 mm length for these burners.']);
      assert.deepEqual(part.pricedSize, { W: 800, D: 700, H: 850 });
      // nothing stated at all is the default configuration
      for (const id of FIDS) assert.deepEqual(ours(id, {}, PF.defaultDims(fam(id)), 'approved'), ours(id, PF.defaultConfig(fam(id)), PF.defaultDims(fam(id)), 'approved'), id);
    });

    it('something that is not a plain object is not completed (it is never priced as "the default"): junk never prices and never throws', () => {
      for (const bad of [undefined, null, 0, 5, 'x', [], [1], true]) {
        let r;
        assert.doesNotThrow(() => { r = ours('sink', bad, PF.defaultDims(fam('sink')), 'approved'); }, String(bad));
        assert.equal(r.priced, false, String(bad));
        assert.equal(r.unitPrice, 0, String(bad));
      }
    });

    it('priceLine never changes the configuration it is given (deep-frozen inputs go through untouched)', () => {
      const input = deepFreeze({ family: JSON.parse(JSON.stringify(fam('stove'))), primary: JSON.parse(JSON.stringify(PRIMARIES.stove)), config: { addons: ['griller'] }, size: { W: 800, D: 700, H: 850 }, sheet: JSON.parse(JSON.stringify(SHEETS.approved.stove)) });
      let r;
      assert.doesNotThrow(() => { r = QB.priceLine(DEPS, input); });
      assert.equal(r.priced, true);
      assert.deepEqual(input.config, { addons: ['griller'] });
    });
  });

  describe('fromRequestItem with the family definitions — a request stored before the top plate (or the steel grade) existed gets the standard 1.5 mm top and the standard grade, and nothing else changes', () => {
    const REF = 'QR-261021-K7M2PX';
    // a request row as it was stored BEFORE the staff-only top plate existed: no `top` in the configuration, no Construction row in the options
    const preChange = (row) => ({ ...row, config: withoutStaff(row.config), specs: row.specs.filter((s) => s.label !== 'Construction' && s.label !== 'Material') });
    const without = (item) => { const { config, ...rest } = item; void config; return rest; };

    it('every family: with deps the stored configuration is the complete one (only `grade: 304` and `top: 1.5` added), it prices as the figure the client saw, and neither "Top plate" nor "Material" is ever missing; without deps it is carried over as stored and still prices the same', () => {
      const r = rng(4242);
      let added = 0, pricedLines = 0;
      for (let i = 0; i < 60; i++) {
        const fid = FIDS[i % FIDS.length];
        const { config, size, qty } = randomLine(r, fid);
        const { row, line } = serverLine(fid, config, size, qty, 'approved');
        if (line.priced) pricedLines++;
        const old = preChange(row);
        const bare = QB.fromRequestItem(old, line, REF);
        const done = QB.fromRequestItem(old, line, REF, DEPS);
        assert.deepEqual(bare.config, old.config, `${fid}: without deps the configuration is carried over exactly as stored`);
        assert.deepEqual(done.config, row.config, `${fid}: with deps it is the complete configuration — every stored value kept, the missing groups at their defaults`);
        if (WITH_TOP.includes(fid)) { assert.equal(done.config.top, 1.5, fid); assert.ok(!('top' in bare.config), fid); added++; }
        assert.equal(done.config.grade, 304, `${fid}: the standard steel grade`); assert.ok(!('grade' in bare.config), fid);
        assert.deepEqual(without({ ...done, name: '' }), without({ ...bare, name: '' }), `${fid}: nothing but the configuration (and the title the family definitions give the line) differs`);
        assert.equal(bare.name, row.name, `${fid}: without deps the server's name passes through`);
        assert.equal(done.name, PF.lineTitle(fam(fid), row.config), `${fid}: with the family definitions the line is named by its title`);
        for (const it of [bare, done]) {
          const priced = ours(fid, it.config, it.size, 'approved');
          assert.equal(priced.priced, line.priced, `${fid}: the builder's own recomputation agrees with the server on whether it prices`);
          assert.equal(priced.unitPrice, line.unitPrice, `${fid}: at the figure the client saw`);
          assert.equal(it.basisUnitPrice, line.priced ? line.unitPrice : 0);
          assert.ok(!priced.missing.includes('Top plate') && !priced.missing.includes('Material'), fid);
        }
      }
      assert.ok(added >= 25 && pricedLines >= 30, `the sweep must cover the top-plate families and priced lines (${added} / ${pricedLines})`);
    });

    it('the completion invents no price: with an unapproved sheet or a blank cell the line is exactly as unpriced as the server left it — same reason, a blank cell still names ITS option, never the top plate', () => {
      const cfg = { ...PF.defaultConfig(fam('sink')), basins: 4 };                       // the fixture sheet leaves the 4-sink cell blank
      const size = { W: 2000, D: 500, H: 850 };
      for (const kind of ['unapproved', 'blank']) {
        const { row, line } = serverLine('sink', cfg, size, 1, kind);
        assert.equal(line.priced, false, kind);
        const done = QB.fromRequestItem(preChange(row), line, REF, DEPS);
        const priced = ours('sink', done.config, done.size, kind);
        assert.deepEqual(pickKeys(priced), pickKeys(line), `${kind}: identical to the server, reason and missing list included`);
        assert.ok(!priced.missing.includes('Top plate'), kind);
        assert.deepEqual(priced.missing, kind === 'blank' ? ['Sinks: 4'] : [], kind);
        assert.equal(done.priceBasis, 'manual', kind); assert.equal(done.needsPrice, true, kind); assert.equal(done.unitPrice, 0, kind);
      }
    });

    it('only the missing groups are filled: every stated value stays as stored (a 1.2 mm top, an invalid value, add-on and burner order); a row whose configuration is not an object is not turned into a default line', () => {
      const stated = { grade: 316, positions: ['wok', 'lp_small'], addons: ['oven', 'fryer'], top: 1.2 };
      const row = { n: 1, kind: 'family', id: 'CE-001', familyId: 'stove', name: 'Stove', cat: 'cooking', unit: 'pc', qty: 1, size: { W: 1400, D: 700, H: 850 }, config: stated, specs: [], note: '' };
      assert.deepEqual(QB.fromRequestItem(row, null, REF, DEPS).config, stated, 'nothing is missing: nothing changes (the stated 1.2 mm top stays 1.2 mm, a stated 316 stays 316)');
      const part = QB.fromRequestItem({ ...row, config: { addons: ['fryer'], positions: 'x' } }, null, REF, DEPS).config;
      assert.deepEqual(part, { addons: ['fryer'], positions: 'x', grade: 304, top: 1.5 }, 'an invalid stated value is not "fixed"; only the absent steel grade and top plate are added');
      for (const notObject of [null, undefined, 5, 'x', [], [1]]) assert.deepEqual(QB.fromRequestItem({ ...row, config: notObject }, null, REF, DEPS).config, {}, String(notObject));
    });

    it('without usable family definitions nothing is completed: no deps, null, {}, no FAM, an unknown family, a family id that is not text — and plain rows are never touched', () => {
      const { row, line } = serverLine('sink', { ...PF.defaultConfig(fam('sink')) }, PF.defaultDims(fam('sink')), 1, 'approved');
      const old = preChange(row);
      const asStored = QB.fromRequestItem(old, line, REF).config;
      assert.ok(!('top' in asStored));
      for (const deps of [undefined, null, {}, 'x', 5, [], { FAM: null }, { FAM: {} }, { FAM: { families: {} } }, { FAM: { families: null } }]) {
        assert.deepEqual(QB.fromRequestItem(old, line, REF, deps).config, asStored, JSON.stringify(deps));
      }
      assert.deepEqual(QB.fromRequestItem({ ...old, familyId: 'toaster' }, line, REF, DEPS).config, asStored, 'an unknown family');
      assert.deepEqual(QB.fromRequestItem({ ...old, familyId: ['sink'] }, line, REF, DEPS).config, asStored);
      // a PLAIN row has no configuration to complete
      const plain = { n: 2, id: 'RF-003', name: 'Chiller', cat: 'Refrigeration', unit: 'pc', qty: 3, specs: [], note: '' };
      assert.deepEqual(QB.fromRequestItem(plain, { n: 2, priced: true, unitPrice: 1500 }, REF, DEPS), QB.fromRequestItem(plain, { n: 2, priced: true, unitPrice: 1500 }, REF));
      assert.ok(!('config' in QB.fromRequestItem(plain, null, REF, DEPS)));
    });

    it('the completed configuration is a copy: changing it never changes the family definition or the row, and deep-frozen inputs go through', () => {
      const f = fam('stove');
      const row = deepFreeze({ n: 1, kind: 'family', id: 'CE-001', familyId: 'stove', name: 'Stove', cat: 'cooking', unit: 'pc', qty: 1, size: { W: 600, D: 700, H: 850 }, config: { addons: [] }, specs: [], note: '' });
      const deps = deepFreeze({ FAM: JSON.parse(JSON.stringify(FAM)) });
      let done;
      assert.doesNotThrow(() => { done = QB.fromRequestItem(row, null, REF, deps); });
      assert.deepEqual(done.config, { addons: [], positions: ['lp_small'], grade: 304, top: 1.5 });
      done.config.positions.push('wok');
      assert.deepEqual(f.groups.find((g) => g.key === 'positions').default, ['lp_small'], 'the family definition shares nothing with the completed configuration');
      assert.deepEqual(row.config, { addons: [] });
      assert.deepEqual(QB.fromRequestItem(row, null, REF, DEPS).config.positions, ['lp_small'], 'and the next completion starts from the definition again');
    });
  });

  describe('every validation the module makes is a STAFF-mode call', () => {
    it('buildLine and migrateLegacyConfiguredLine hand { staff: true } to ProductFamilies.validateLine (the dependency is injected, so a spy sees every call)', () => {
      const calls = [];
      const spy = { ...PF, validateLine: (...args) => { calls.push(args); return PF.validateLine(...args); } };
      const deps = { ...DEPS, PF: spy };
      const f = fam('sink');
      assert.ok(QB.buildLine(deps, { family: f, primary: PRIMARIES.sink, config: PF.defaultConfig(f), size: PF.defaultDims(f) }));
      assert.equal(calls.length, 1, 'buildLine validates once');
      assert.ok(QB.migrateLegacyConfiguredLine(deps, { id: 'PW-006', category: 'prep_washing', name: 'x', dims: '', specs: [], qty: 1, unit: 'pc', unitPrice: 1, amount: 1 }));
      assert.equal(calls.length, 2, 'the migration validates once');
      for (const c of calls) assert.deepEqual(c[3], { staff: true }, 'validateLine(family, config, size, { staff: true })');
    });
  });

  describe('the builder SECTION of a configured line — its base product\'s own category, never the family\'s PUBLIC one', () => {
    const SECTION = { prep_table: 'prep_washing', sink: 'prep_washing', dish_table: 'prep_washing', stove: 'cooking_line', wok_range: 'cooking_line', cooking_line: 'cooking_line', deck_oven: 'cooking_line', hood: 'exhaust_system', cabinet: 'prep_washing', wall_shelf: 'prep_washing', rack: 'prep_washing' };
    const primaryIn = (id) => ({ ...PRIMARIES[id], category: SECTION[id] });
    it('buildLine takes the category of the primary product passed in, for every family — and it is never the family\'s public category', () => {
      const r = rng(2810);
      for (const id of FIDS) {
        const { config, size } = randomLine(r, id);
        const it = QB.buildLine(DEPS, { family: fam(id), primary: primaryIn(id), config, size, qty: 1, basis: ours(id, config, size, 'approved') });
        assert.equal(it.category, SECTION[id], id);
        assert.notEqual(it.category, fam(id).category, `${id}: the family's PUBLIC category ("${fam(id).category}") leaked into the builder`);
      }
      assert.deepEqual(FIDS.map((id) => fam(id).category), ['preparation', 'washing', 'washing', 'cooking', 'cooking', 'cooking', 'cooking', 'ventilation', 'storage', 'storage', 'storage'], 'the premise: the public categories are not builder section ids');
    });
    it('only when no usable product is given does it fall back to the family\'s public category: no primary, a product with no category, a blank or non-text category', () => {
      const f = fam('sink');
      for (const primary of [undefined, null, {}, { id: 'PW-004' }, { category: '' }, { category: 5 }, { category: null }, { category: ['prep_washing'] }, [], 'PW-004']) {
        const it = QB.buildLine(DEPS, { family: f, primary, config: PF.defaultConfig(f), size: PF.defaultDims(f) });
        assert.equal(it.category, 'washing', JSON.stringify(primary));
      }
    });
    it('buildLine never changes the primary product it reads the category from', () => {
      const primary = deepFreeze(primaryIn('sink'));
      assert.doesNotThrow(() => QB.buildLine(DEPS, { family: fam('sink'), primary, config: PF.defaultConfig(fam('sink')), size: PF.defaultDims(fam('sink')) }));
    });
    const legacy = (over) => ({ id: 'BA-001', category: 'baking', name: 'Baker\'s worktable', dims: '', specs: [], qty: 1, unit: 'pc', unitPrice: 5000, amount: 5000, ...(over || {}) });
    it('migrateLegacyConfiguredLine KEEPS the section the line sits in: a bakery model stays in its bakery section, it does not jump to the base product\'s section or to the public category', () => {
      const catalogue = new Map([['PW-001', { id: 'PW-001', category: 'prep_washing' }]]);
      assert.equal(QB.migrateLegacyConfiguredLine(DEPS, legacy(), catalogue).category, 'baking');
      assert.equal(QB.migrateLegacyConfiguredLine(DEPS, legacy()).category, 'baking');
      assert.equal(QB.migrateLegacyConfiguredLine(DEPS, legacy({ id: 'PW-006', category: 'prep_washing' })).category, 'prep_washing');
      assert.equal(QB.migrateLegacyConfiguredLine(DEPS, legacy({ category: 'custom_section_7' })).category, 'custom_section_7', 'a section the preparer made up is kept as it is');
    });
    it('a line with NO section takes the base product\'s category from the catalogue passed in (a Map or a plain object), else the family\'s public one', () => {
      for (const none of [undefined, '', null, 5]) {
        const line = legacy({ id: 'PW-006', category: none });
        const m = (cat) => QB.migrateLegacyConfiguredLine(DEPS, line, cat).category;
        assert.equal(m(new Map([['PW-004', { id: 'PW-004', category: 'prep_washing' }]])), 'prep_washing', String(none));
        assert.equal(m({ 'PW-004': { id: 'PW-004', category: 'prep_washing' } }), 'prep_washing', String(none));
        assert.equal(m(undefined), 'washing', String(none));
        assert.equal(m(new Map()), 'washing', 'the base product is not in the catalogue passed');
        assert.equal(m(new Map([['PW-004', { id: 'PW-004' }]])), 'washing', 'the base product has no category');
        assert.equal(m(new Map([['PW-004', { id: 'PW-004', category: '' }]])), 'washing');
        assert.equal(m(new Map([['PW-001', { id: 'PW-001', category: 'prep_washing' }]])), 'washing', 'only the family\'s OWN primary is consulted');
        assert.equal(m('PW-004'), 'washing', 'junk is not a catalogue');
      }
    });
    it('migrateLegacyConfiguredLine never changes the line or the catalogue it is handed', () => {
      const line = deepFreeze(legacy({ id: 'PW-006', category: undefined }));
      const catalogue = new Map([['PW-004', deepFreeze({ id: 'PW-004', category: 'prep_washing' })]]);
      assert.equal(QB.migrateLegacyConfiguredLine(DEPS, line, catalogue).category, 'prep_washing');
      assert.ok(!('category' in line) || line.category === undefined);
    });
  });
});

// ═══════════════════════════════ 10. the five families of 2026-10-28 (CONFIGURATOR-FAMILIES-2-SPEC §10.3) ═══════════════════════════════
// Money-adjacent: the price of a conditional option that does not apply is NOTHING (js/pricing-core.js is untouched — validation keeps the configuration canonical), the deck
// oven's width follows its trays (a width rate of 0 prices; a blank one leaves it "Size" missing), and the nearest-model match finds the right standard SKU. The parity sweep
// at the top of the file already draws from all eleven families; these are the fixed cases.
describe('the five families of 2026-10-28 — conditional options are never priced when they do not apply, a deck oven\'s width follows its trays, and the nearest-model match finds the right SKU', () => {
  const NEW5 = ['dish_table', 'wok_range', 'cooking_line', 'deck_oven', 'hood'];
  const keysOf = (r) => r.deltas.map((d) => d.key);
  const price = (id, cfg, size, sheet) => QB.priceLine(DEPS, { family: fam(id), primary: PRIMARIES[id], config: full(fam(id), cfg), size, sheet: sheet === undefined ? SHEETS.approved[id] : sheet, constants: {} });
  const serverSays = (id, cfg, size, kind) => { const { row, line } = serverLine(id, full(fam(id), cfg), size, 1, kind || 'approved'); return { row, line }; };

  it('a fryer prices its TYPE and its BASKET count and no burner cell; a griddle prices the burner cell only (no type cell, no basket cell); the server prices both identically', () => {
    const fryer = price('cooking_line', { type: 'fryer', baskets: 3 }, { W: 1000, D: 700 });
    assert.equal(fryer.priced, true, fryer.missing.join(', '));
    assert.deepEqual(keysOf(fryer), ['type:fryer', 'baskets:3'], 'no "burners" cell: burners do not apply to a fryer');
    const griddle = price('cooking_line', { type: 'griddle', burners: 3 }, { W: 1200, D: 700 });
    assert.equal(griddle.priced, true, griddle.missing.join(', '));
    assert.deepEqual(keysOf(griddle), ['burners:3'], 'the griddle is the base item: no type cell, and no basket cell (baskets do not apply to it)');
    assert.deepEqual(keysOf(price('cooking_line', { type: 'combi' }, { W: 900, D: 700 })), ['type:combi'], 'a combination has neither burners nor baskets to choose');
    assert.deepEqual(keysOf(price('cooking_line', { type: 'griller', burners: 2, base: 'shelf' }, { W: 900, D: 700 })), ['type:griller', 'burners:2', 'base:shelf']);
    assert.deepEqual(keysOf(price('cooking_line', { type: 'fryer', baskets: 1 }, { W: 700, D: 700 })), ['type:fryer', 'baskets:1']);
    assert.deepEqual(keysOf(price('cooking_line', {}, { W: 700, D: 700 })), [], 'the default is the base item alone');
    for (const [cfg, size] of [[{ type: 'fryer', baskets: 3 }, { W: 1000, D: 700 }], [{ type: 'griddle', burners: 3 }, { W: 1200, D: 700 }], [{ type: 'combi' }, { W: 900, D: 700 }], [{ type: 'fryer', baskets: 1, base: 'shelf' }, { W: 800, D: 650 }]]) {
      for (const kind of ['approved', 'blank']) {
        const { row, line } = serverSays('cooking_line', cfg, size, kind);
        assert.deepEqual(pickKeys(ours('cooking_line', row.config, row.size, kind)), pickKeys(line), `${JSON.stringify(cfg)} ${kind}`);
      }
    }
  });

  it('the dish table: the pre-rinse cell is priced on the soiled side only; a clean-side table never reads it', () => {
    const soiled = price('dish_table', { side: 'soiled', sink: 'prerinse' }, { W: 1200, D: 660 });
    assert.deepEqual(keysOf(soiled), ['side:soiled', 'sink:prerinse']);
    assert.deepEqual(keysOf(price('dish_table', { side: 'soiled' }, { W: 1200, D: 660 })), ['side:soiled']);
    assert.deepEqual(keysOf(price('dish_table', { side: 'clean', hand: 'right', undershelf: false }, { W: 1200, D: 660 })), ['hand:right', 'undershelf:false']);
    // the table is a LINEAR family: a width other than the standard 660 is left for review (the sheet prices the length only)
    const wide = price('dish_table', {}, { W: 1200, D: 800 });
    assert.equal(wide.priced, false); assert.deepEqual(wide.missing, ['Size (width)']);
  });

  it('a six-tray deck oven at 1200 mm prices the 6-tray cell + the width rate (0 = a delta of 0, priced); with NO width rate it is "Size" missing; at its standard 700 mm no width rate is needed', () => {
    const six = price('deck_oven', { trays: 6 }, { W: 1200 });
    assert.equal(six.priced, true, six.missing.join(', '));
    assert.deepEqual(keysOf(six), ['trays:6', 'size:W']);
    assert.equal(six.deltas.find((d) => d.key === 'size:W').amount, 0, 'size.perW100 = 0: the extra width adds nothing');
    const noRate = price('deck_oven', { trays: 6 }, { W: 1200 }, { ...SHEETS.approved.deck_oven, size: { perW100: null } });
    assert.equal(noRate.priced, false); assert.equal(noRate.reason, 'missing_input'); assert.deepEqual(noRate.missing, ['Size']);
    const standard = price('deck_oven', {}, { W: 700 }, { ...SHEETS.approved.deck_oven, size: { perW100: null } });
    assert.equal(standard.priced, true, 'W = the base item\'s own length: no width rate needed'); assert.deepEqual(keysOf(standard), []);
    assert.deepEqual(keysOf(price('deck_oven', { decks: 3, stand: 'heavy' }, { W: 700 })), ['decks:3', 'stand:heavy']);
    // the server agrees, for both sheets
    for (const kind of ['approved', 'blank']) {
      const { row, line } = serverSays('deck_oven', { trays: 6 }, { W: 1200 }, kind);
      assert.equal(row.size.W, 1200);
      assert.deepEqual(pickKeys(ours('deck_oven', row.config, row.size, kind)), pickKeys(line), kind);
    }
    // a hand-made 1300 mm six-tray line never gets here (the validators refuse it) — the server proves it
    assert.throws(() => serverLine('deck_oven', full(fam('deck_oven'), { trays: 6 }), { W: 1300 }, 1, 'approved'), /at most 1200 mm/);
  });

  it('the hood prices its type, filters and lighting cells; the wok range its holes, rear burner and faucet cells; no height is ever a size of these families (a custom height is not offered)', () => {
    assert.deepEqual(keysOf(price('hood', { type: 'island', filters: 'none', lighting: false }, { W: 1500, D: 900 })), ['type:island', 'filters:none', 'lighting:false']);
    assert.deepEqual(keysOf(price('hood', { type: 'slim' }, { W: 1000, D: 500 })), ['type:slim']);
    assert.deepEqual(keysOf(price('wok_range', { holes: 3, rear: true, faucet: 'swan' }, { W: 1800, D: 800 })), ['holes:3', 'rear:true', 'faucet:swan']);
    for (const id of NEW5) assert.ok(!('H' in fam(id).dims), `${id}: no height axis`);
    const hood = price('hood', { type: 'slim' }, { W: 1000, D: 500 });
    assert.deepEqual(hood.pricedSize, { W: 1000, D: 500 });
  });

  it('a configuration that an inapplicable option changes is NOT a priced line of its own: the validators refuse it, so a baskets amount can never be added to a griddle (both server and builder go through them)', () => {
    const bad = { ...PF.defaultConfig(fam('cooking_line')), type: 'griddle', baskets: 3 };
    assert.equal(PF.validateLine(fam('cooking_line'), bad, { W: 1000, D: 700 }, { staff: true }).ok, false, 'staff mode too');
    assert.equal(QB.buildLine(DEPS, { family: fam('cooking_line'), primary: PRIMARIES.cooking_line, config: bad, size: { W: 1000, D: 700 } }), null, 'the builder builds nothing from it');
    const norm = Q.normaliseItems([{ familyId: 'cooking_line', config: bad, dims: { W: 1000, D: 700 }, qty: 1, note: '' }], new Map(), { families: FAM, primaries: PRIMARY_MAP });
    assert.equal(norm.ok, false); assert.match(norm.errors.join(' '), /"Fry baskets" applies only when Type is Fryer\./);
    // and the pricing function itself, handed such a non-canonical configuration by mistake, would read the cell — which is why nothing upstream may pass one
    const wrongly = QB.priceLine(DEPS, { family: fam('cooking_line'), primary: PRIMARIES.cooking_line, config: bad, size: { W: 1000, D: 700 }, sheet: SHEETS.approved.cooking_line });
    assert.equal(wrongly.priced, true);
    assert.ok(keysOf(wrongly).includes('baskets:3'), 'the premise of the checks above: the pricing function trusts a canonical configuration, so validation is what keeps a basket cell off a griddle');
  });

  describe('nearestAbsorbed finds the standard model: the SKU a configuration IS, or the closest one', () => {
    const near3 = (id, cfg) => { const got = QB.nearestAbsorbed(fam(id), cfg); return [got.sku, got.exact]; };
    it('cooking line: a three-basket fryer is CE-022 (exact), a two-basket one CE-009, a one-basket one CE-020, a combination CE-007, a three-burner griddle CE-023, shelf bases CE-026 / CE-028', () => {
      assert.deepEqual(near3('cooking_line', { type: 'fryer', baskets: 3, base: 'stand' }), ['CE-022', true]);
      assert.deepEqual(near3('cooking_line', { type: 'fryer', baskets: 2 }), ['CE-009', true]);
      assert.deepEqual(near3('cooking_line', { type: 'fryer', baskets: 1 }), ['CE-020', true]);
      assert.deepEqual(near3('cooking_line', { type: 'combi' }), ['CE-007', true]);
      assert.deepEqual(near3('cooking_line', { type: 'griddle', burners: 3 }), ['CE-023', true]);
      assert.deepEqual(near3('cooking_line', { type: 'griddle', base: 'shelf' }), ['CE-028', true]);
      assert.deepEqual(near3('cooking_line', { type: 'griller', base: 'shelf' }), ['CE-026', true]);
      assert.deepEqual(near3('cooking_line', {}), ['CE-010', true], 'the default is the primary');
      // not a standard model: a two-burner griddle is the closest to the one-burner griddle (the first of the ties in map order), but not exact
      assert.deepEqual(near3('cooking_line', { type: 'griddle', burners: 2 }), ['CE-010', false]);
    });
    it('wok range: two holes with a rear burner is CE-025 (exact); one hole CE-006; hood: island EX-018, slim EX-020, wall EX-001 (the first of four identical wall models); deck oven: 12 trays CE-016; dish table PW-029', () => {
      assert.deepEqual(near3('wok_range', { holes: 2, rear: true }), ['CE-025', true]);
      assert.deepEqual(near3('wok_range', { holes: 1 }), ['CE-006', true]);
      assert.deepEqual(near3('wok_range', { holes: 3, rear: true, faucet: 'swan' }), ['CE-025', false]);
      assert.deepEqual(near3('hood', { type: 'island' }), ['EX-018', true]);
      assert.deepEqual(near3('hood', { type: 'slim' }), ['EX-020', true]);
      assert.deepEqual(near3('hood', { type: 'wall' }), ['EX-001', true]);
      assert.deepEqual(near3('hood', { type: 'wall', filters: 'none' }), ['EX-001', false]);
      assert.deepEqual(near3('deck_oven', { trays: 6 }), ['CE-016', true]);
      assert.deepEqual(near3('deck_oven', {}), ['CE-012', true]);
      assert.deepEqual(near3('deck_oven', { decks: 3, stand: 'heavy' }), ['CE-012', false]);
      assert.deepEqual(near3('dish_table', { side: 'soiled', sink: 'prerinse' }), ['PW-029', false]);
      assert.deepEqual(near3('dish_table', {}), ['PW-029', true]);
    });
    it('a stove that asks for a wok burner no longer finds CE-006 (the wok ranges left the stove family): its nearest model is the first of the ties, CE-001, and it is not exact', () => {
      assert.deepEqual(near3('stove', { positions: ['wok'] }), ['CE-001', false]);
      assert.ok(!Object.keys(fam('stove').absorbed).includes('CE-006') && !Object.keys(fam('stove').absorbed).includes('CE-025'));
      for (const sku of ['CE-006', 'CE-025']) assert.ok(Object.keys(fam('wok_range').absorbed).includes(sku), sku);
      assert.deepEqual(near3('stove', { positions: ['wok', 'wok'] }).slice(1), [false]);
    });
    it('the primary of every one of the five is exact at its default, with the full score (conditional options at their defaults count as matching on both sides)', () => {
      for (const id of NEW5) {
        const f = fam(id);
        const got = QB.nearestAbsorbed(f, PF.defaultConfig(f));
        assert.equal(got.sku, f.primary, id); assert.equal(got.exact, true, id);
        assert.ok(near(got.score, f.groups.length), `${id} score ${got.score}`);
      }
    });
  });

  describe('buildLine / migrateLegacyConfiguredLine for the five families', () => {
    it('buildLine: the primary\'s id, the family name, ONLY the family\'s own axes in the printed size (no height), and specs = describe() — only the rows that apply, ending with the Construction row', () => {
      for (const id of NEW5) {
        const f = fam(id);
        const cfg = PF.defaultConfig(f);
        const size = PF.standardDims(f, cfg);
        const it = QB.buildLine(DEPS, { family: f, primary: PRIMARIES[id], config: cfg, size, qty: 2, basis: ours(id, cfg, size, 'approved') });
        assert.ok(it, id);
        assert.equal(it.id, f.primary); assert.equal(it.name, { dish_table: 'SS Dish Table', wok_range: 'SS Wok Range', cooking_line: 'SS Griddle', deck_oven: 'Gas Deck Oven', hood: 'SS Range Hood' }[id]); assert.equal(it.familyId, id);
        assert.equal(it.dims, PF.sizeTextLabelled(f, size));
        assert.ok(!/H\d/.test(it.dims), `${id}: no height in "${it.dims}"`);
        assert.deepEqual(it.specs, PF.describe(f, it.config));
        assert.equal(it.specs[0].label, 'Material', `${id}: the Material row is the first`);
        assert.equal(it.specs.at(-1).label, 'Construction');
      }
      const ck = fam('cooking_line');
      const fryer = QB.buildLine(DEPS, { family: ck, primary: PRIMARIES.cooking_line, config: { type: 'fryer', baskets: 3 }, size: { W: 1000, D: 700 }, qty: 1 });
      assert.deepEqual(fryer.specs.map((x) => x.label), ['Material', 'Type', 'Fry baskets', 'Base', 'Construction'], 'no "Burners" row on a fryer');
      assert.deepEqual(fryer.config, { grade: 304, type: 'fryer', burners: 1, baskets: 3, base: 'stand' });
      assert.equal(fryer.name, 'SS Fryer');
      const griddle = QB.buildLine(DEPS, { family: ck, primary: PRIMARIES.cooking_line, config: { type: 'griddle', burners: 2 }, size: { W: 900, D: 700 }, qty: 1 });
      assert.deepEqual(griddle.specs.map((x) => x.label), ['Material', 'Type', 'Burners', 'Base', 'Construction'], 'no "Fry baskets" row on a griddle');
      assert.equal(griddle.name, 'SS Griddle');
    });
    it('a saved plain line converts to the new family: CE-006 -> a wok range, CE-025 -> two holes with a rear burner, CE-010 / CE-009 / CE-022 -> the cooking line, CE-016 -> a six-tray oven, EX-020 -> a slim hood, PW-029 -> a dish table — keeping its price, at a VALID size', () => {
      const cases = [['CE-006', 'wok_range', (c) => c.holes === 1 && c.rear === false], ['CE-025', 'wok_range', (c) => c.holes === 2 && c.rear === true], ['CE-010', 'cooking_line', (c) => c.type === 'griddle'],
        ['CE-009', 'cooking_line', (c) => c.type === 'fryer' && c.baskets === 2], ['CE-022', 'cooking_line', (c) => c.type === 'fryer' && c.baskets === 3], ['CE-016', 'deck_oven', (c) => c.trays === 6],
        ['CE-012', 'deck_oven', (c) => c.trays === 3], ['EX-020', 'hood', (c) => c.type === 'slim'], ['EX-018', 'hood', (c) => c.type === 'island'], ['PW-029', 'dish_table', (c) => c.side === 'clean']];
      for (const [sku, fid, ok] of cases) {
        const out = QB.migrateLegacyConfiguredLine(DEPS, { id: sku, category: 'cooking_line', name: sku, dims: '', specs: [], qty: 3, unit: 'pc', unitPrice: 12345, amount: 37035 });
        assert.ok(out, sku);
        assert.equal(out.familyId, fid, sku); assert.equal(out.id, fam(fid).primary, sku);
        assert.ok(ok(out.config), `${sku}: ${JSON.stringify(out.config)}`);
        assert.equal(PF.validateLine(fam(fid), out.config, out.size, { staff: true }).ok, true, `${sku}: a valid size`);
        assert.equal(out.unitPrice, 12345, `${sku}: keeps its price`); assert.equal(out.qty, 3);
        assert.equal(out.priceBasis, 'manual', `${sku}: a converted line keeps its typed price`);
      }
    });
  });
});


// ═══════════════════════════════ 11. the staff-only steel grade and the line titles (owner rulings 2026-10-28) ═══════════════════════════════
// specs/CONFIGURATOR-GRADE-TITLES-SPEC.md §5 / §6. A configured line is NAMED by its family's title ("SS Sink", "SS Range Stove Combination (Griller, Fryer)"); the website's
// card names are unchanged. The first spec row is Material. A 316 line is a staff-only choice: built in staff mode, priced from the sheet's grade cell exactly as the server's
// computeBasket prices the same hand-built line, "priced after review" while that cell is blank. An ABSENT grade is the standard 304 (never a missing "Material").
describe('the staff-only steel grade (Material) and the line titles', () => {
  const TITLE = { prep_table: 'SS Preparation Table', sink: 'SS Sink', dish_table: 'SS Dish Table', stove: 'SS Range Stove', wok_range: 'SS Wok Range', cooking_line: 'SS Griddle', deck_oven: 'Gas Deck Oven', hood: 'SS Range Hood', cabinet: 'SS Cabinet', wall_shelf: 'SS Wall Shelving', rack: 'SS Rack' };
  const G316 = 'Stainless Steel 316 Laboratory Grade';
  const REF = 'QR-261028-T1TL3S';
  const build = (id, cfg, extra) => { const f = fam(id); const c = full(f, cfg); return QB.buildLine(DEPS, { family: f, primary: PRIMARIES[id], config: c, size: PF.standardDims(f, c), qty: 1, ...(extra || {}) }); };

  describe('buildLine / migrateLegacyConfiguredLine name a line by its title', () => {
    it('every family at its defaults is named by its title — never by the website\'s card name, never empty', () => {
      for (const id of FIDS) {
        const it = build(id, {});
        assert.equal(it.name, TITLE[id], id);
        assert.notEqual(it.name, fam(id).label, `${id}: the card name is not the line name`);
      }
    });
    it('the title follows the configuration: the stove\'s add-ons (in the family\'s option order) and the griddle / griller / fryer type', () => {
      assert.equal(build('stove', { addons: ['fryer', 'griller'] }).name, 'SS Range Stove Combination (Griller, Fryer)');
      assert.equal(build('stove', { addons: ['griller', 'griddle', 'oven', 'fryer'] }).name, 'SS Range Stove Combination (Griller, Griddle, Oven, Fryer)');
      assert.equal(build('stove', { addons: [] }).name, 'SS Range Stove');
      for (const [type, name] of [['griddle', 'SS Griddle'], ['griller', 'SS Lava-Rock Griller'], ['fryer', 'SS Fryer'], ['combi', 'SS Griller + Griddle Combination']]) assert.equal(build('cooking_line', { type }).name, name, type);
      assert.equal(build('sink', { grade: 316 }).name, 'SS Sink', 'the title never names the grade: the Material row does');
    });
    it('a PF without lineTitle (or one that answers nothing), or a family without a usable title, falls back to the family label — a line is never nameless', () => {
      const f = fam('sink'), cfg = PF.defaultConfig(f), size = PF.defaultDims(f);
      for (const pf of [{ ...PF, lineTitle: undefined }, { ...PF, lineTitle: () => '' }, { ...PF, lineTitle: 'x' }, { ...PF, lineTitle: null }]) {
        assert.equal(QB.buildLine({ ...DEPS, PF: pf }, { family: f, primary: PRIMARIES.sink, config: cfg, size }).name, 'Sink');
      }
      for (const title of [undefined, '', '   ', 5, null]) assert.equal(QB.buildLine(DEPS, { family: { ...f, title }, primary: PRIMARIES.sink, config: cfg, size }).name, 'Sink', String(title));
      const legacy = { id: 'PW-006', category: 'prep_washing', name: 'Sink 2 bowls', dims: '', specs: [], qty: 1, unit: 'pc', unitPrice: 100, amount: 100 };
      assert.equal(QB.migrateLegacyConfiguredLine({ ...DEPS, PF: { ...PF, lineTitle: undefined } }, legacy).name, 'Sink');
    });
    it('migrateLegacyConfiguredLine: every one of the 64 absorbed SKUs converts to a line named by the title of its configuration', () => {
      let n = 0;
      for (const id of FIDS) for (const sku of Object.keys(fam(id).absorbed)) {
        const out = QB.migrateLegacyConfiguredLine(DEPS, { id: sku, category: 'prep_washing', name: sku, dims: '', specs: [], qty: 1, unit: 'pc', unitPrice: 1000, amount: 1000 });
        assert.equal(out.name, PF.lineTitle(fam(id), out.config), sku);
        assert.ok(out.name.length > 0 && out.name !== fam(id).label, sku);
        assert.equal(out.specs[0].label, 'Material', `${sku}: the Material row first`);
        assert.equal(out.config.grade, 304, `${sku}: converts at the standard steel grade`);
        n++;
      }
      assert.equal(n, 64);
      const conv = (sku) => QB.migrateLegacyConfiguredLine(DEPS, { id: sku, category: 'x', name: sku, dims: '', specs: [], qty: 1, unit: 'pc', unitPrice: 1, amount: 1 }).name;
      assert.equal(conv('PW-006'), 'SS Sink'); assert.equal(conv('CE-009'), 'SS Fryer'); assert.equal(conv('CE-007'), 'SS Griller + Griddle Combination'); assert.equal(conv('CE-008'), 'SS Range Stove Combination (Griller, Griddle)');
    });
  });

  describe('fromRequestItem: with the family definitions AND PF the line is named by its title; otherwise the name the server stored passes through', () => {
    const real = (id, cfg) => { const f = fam(id); const c = full(f, cfg); return serverLine(id, c, PF.standardDims(f, c), 1, 'approved'); };
    it('with deps every family\'s request line takes the title; with no deps, only FAM, a PF without lineTitle, an unknown family or a family id that is not text it keeps the server\'s name', () => {
      for (const id of FIDS) {
        const { row, line } = real(id, {});
        assert.equal(row.name, fam(id).label, `${id}: the premise — the server stores the card name`);
        assert.equal(QB.fromRequestItem(row, line, REF, DEPS).name, TITLE[id], id);
        assert.equal(QB.fromRequestItem(row, line, REF, { PF, FAM }).name, TITLE[id], `${id}: {PF, FAM} is enough`);
        for (const deps of [undefined, null, {}, { FAM }, { PF }, { PF: { ...PF, lineTitle: undefined }, FAM }, { PF, FAM: { families: {} } }, { PF: { ...PF, lineTitle: () => '' }, FAM }]) assert.equal(QB.fromRequestItem(row, line, REF, deps).name, fam(id).label, `${id} ${Object.keys(deps || {}).join('+') || String(deps)}`);
        assert.equal(QB.fromRequestItem({ ...row, familyId: 'toaster' }, line, REF, DEPS).name, fam(id).label, `${id}: an unknown family`);
      }
      const stove = real('stove', { addons: ['fryer', 'griller'] });
      assert.equal(QB.fromRequestItem(stove.row, stove.line, REF, DEPS).name, 'SS Range Stove Combination (Griller, Fryer)');
      assert.equal(QB.fromRequestItem(stove.row, stove.line, REF).name, 'Stove', 'no deps: the server\'s name');
    });
    it('a family that has no usable title keeps the name the server stored — never the family\'s label', () => {
      const { row, line } = real('sink', {});
      const stored = { ...row, name: 'Stored by the server' };
      for (const title of [undefined, '', '   ', 5]) {
        const noTitle = { ...FAM, families: { ...FAM.families, sink: { ...FAM.families.sink, title } } };
        assert.equal(QB.fromRequestItem(stored, line, REF, { PF, FAM: noTitle }).name, 'Stored by the server', String(title));
      }
      assert.equal(QB.fromRequestItem(stored, line, REF, DEPS).name, 'SS Sink', 'the control: with its title the family names the line');
    });
    it('a row that is not configured (a plain catalogue line) is never retitled, and junk rows never throw', () => {
      const plain = { n: 2, id: 'RF-003', name: 'Chiller', cat: 'refrigeration', unit: 'pc', qty: 3, specs: [], note: '' };
      assert.equal(QB.fromRequestItem(plain, null, REF, DEPS).name, 'Chiller');
      for (const bad of [null, undefined, 0, 'x', []]) assert.doesNotThrow(() => QB.fromRequestItem(bad, bad, bad, DEPS), String(bad));
      assert.equal(QB.fromRequestItem({ familyId: 'sink', config: 'nope', name: 'Sink' }, null, REF, DEPS).name, 'Sink', 'a configuration that is not an object is not completed, nor titled');
    });
  });

  describe('an ABSENT grade is the standard 304; a stated 316 is kept', () => {
    it('fromRequestItem(…, DEPS) fills `grade: 304` into a request stored without it, keeps a stated 316, and the line prices as the standard grade', () => {
      const { row, line } = serverLine('sink', full(fam('sink'), {}), PF.defaultDims(fam('sink')), 1, 'approved');
      const old = { ...row, config: { ...row.config } };
      delete old.config.grade;
      assert.ok(!('grade' in QB.fromRequestItem(old, line, REF).config), 'without deps the configuration is carried over as stored');
      assert.equal(QB.fromRequestItem(old, line, REF, DEPS).config.grade, 304);
      assert.equal(QB.fromRequestItem({ ...old, config: { ...old.config, grade: 316 } }, line, REF, DEPS).config.grade, 316);
      const done = QB.fromRequestItem(old, line, REF, DEPS);
      const priced = ours('sink', done.config, done.size, 'approved');
      assert.equal(priced.unitPrice, line.unitPrice); assert.ok(!priced.missing.includes('Material'));
    });
  });

  describe('a 316 line: built in staff mode, priced from the sheet\'s grade cell exactly as the server prices it, "priced after review" while that cell is blank', () => {
    it('every family: the Material row first, the same title as at 304, the grade in the stored configuration, dearer than the 304 line by exactly the grade cell', () => {
      for (const id of FIDS) {
        const f = fam(id);
        const cfg = full(f, { grade: 316 });
        const size = PF.standardDims(f, cfg);
        const basis = ours(id, cfg, size, 'approved');
        const std = ours(id, { ...cfg, grade: 304 }, size, 'approved');
        assert.equal(std.priced, true, `${id}: the premise — the 304 line prices`);
        assert.equal(basis.priced, true, `${id}: ${basis.missing.join(', ')}`);
        assert.deepEqual(basis.deltas.filter((d) => d.key === 'grade:316'), [{ key: 'grade:316', amount: GRADE_FLAT }], id);
        assert.ok(!std.deltas.some((d) => d.key.startsWith('grade:')), `${id}: the standard grade adds no delta`);
        assert.equal(basis.unitPrice - std.unitPrice, GRADE_FLAT, `${id}: exactly the grade cell`);
        const it = QB.buildLine(DEPS, { family: f, primary: PRIMARIES[id], config: cfg, size, qty: 1, basis });
        assert.ok(it, `${id}: a staff session builds a 316 line`);
        assert.equal(it.config.grade, 316, id);
        assert.equal(it.name, TITLE[id], id);
        assert.deepEqual(it.specs[0], { label: 'Material', value: G316 }, id);
        assert.ok(it.specStr.startsWith('Material: ' + G316 + ', '), id);
        assert.equal(it.priceBasis, 'website'); assert.equal(it.unitPrice, basis.unitPrice);
        assert.ok(!it.needsPrice);
      }
    });
    it('a per-100-mm figure in the grade cell scales with the length above the standard one — a fake odd figure, never a real amount', () => {
      const f = fam('sink'), cfg = full(f, { grade: 316 });
      const size = { W: 1500, D: 500, H: 850 };
      const sheet = { ...SHEETS.approved.sink, options: { ...SHEETS.approved.sink.options, grade: { 316: { flat: 1000, perW100: 70 } } } };
      const r = QB.priceLine(DEPS, { family: f, primary: PRIMARIES.sink, config: cfg, size, sheet });
      assert.equal(r.priced, true, r.missing.join(', '));
      assert.deepEqual(r.deltas.filter((d) => d.key === 'grade:316'), [{ key: 'grade:316', amount: 1000 + 70 * (1500 - 500) / 100 }]);
    });
    it('while the SS316 cell is blank the line is "priced after review", naming exactly that option; buildLine flags it needsPrice at zero on the manual basis', () => {
      for (const id of FIDS) {
        const f = fam(id);
        const cfg = full(f, { grade: 316 });
        const size = PF.standardDims(f, cfg);
        const basis = ours(id, cfg, size, 'blank');
        assert.equal(basis.priced, false, id); assert.equal(basis.reason, 'missing_input', id);
        assert.deepEqual(basis.missing, ['Material: ' + G316], id);
        const it = QB.buildLine(DEPS, { family: f, primary: PRIMARIES[id], config: cfg, size, qty: 1, basis });
        assert.equal(it.priceBasis, 'manual', id); assert.equal(it.needsPrice, true, id); assert.equal(it.unitPrice, 0, id);
        assert.deepEqual(it._cfg.missing, ['Material: ' + G316], id);
        assert.equal(it.config.grade, 316, id);
        assert.equal(ours(id, { ...cfg, grade: 304 }, size, 'blank').missing.includes('Material: ' + G316), false, `${id}: the standard grade never reads the cell`);
      }
    });
    it('the builder prices a 316 line exactly as the server\'s computeBasket prices the same hand-built line (the website refuses such a line before it gets there)', () => {
      for (const id of FIDS) for (const kind of ['approved', 'blank']) {
        const f = fam(id);
        const cfg = full(f, { grade: 316 });
        const size = PF.standardDims(f, cfg);
        const handBuilt = [{ n: 1, kind: 'family', id: f.primary, familyId: id, name: f.label, cat: f.category, unit: 'pc', qty: 1, runs: null, size, sizeCustom: false, config: cfg, specs: [], note: '' }];
        const basket = Q.computeBasket(handBuilt, new Map(), {}, undefined, { families: FAM, primaries: PRIMARY_MAP, pricing: Q.buildPricingIndex(sheetDocs(kind), FAM) });
        assert.deepEqual(pickKeys(ours(id, cfg, size, kind)), pickKeys(basket.lines[0]), `${id} ${kind}`);
        // ... and the server's own validation refuses such a line, with the staff message
        const norm = Q.normaliseItems([{ familyId: id, config: cfg, dims: size, qty: 1, note: '' }], new Map(), { families: FAM, primaries: PRIMARY_MAP });
        assert.equal(norm.ok, false, id); assert.match(norm.errors.join(' '), /"Material" is chosen by our staff when the quotation is prepared\./, id);
      }
    });
    it('buildLine validates a 316 line in STAFF mode only: a value that is not a grade builds nothing, and an absent grade is built at 304', () => {
      const f = fam('sink');
      for (const g of [9, '316', null, true, [], 'x']) assert.equal(QB.buildLine(DEPS, { family: f, primary: PRIMARIES.sink, config: { ...PF.defaultConfig(f), grade: g }, size: PF.defaultDims(f) }), null, String(g));
      const { grade, ...noGrade } = PF.defaultConfig(f);
      void grade;
      assert.equal(QB.buildLine(DEPS, { family: f, primary: PRIMARIES.sink, config: noGrade, size: PF.defaultDims(f) }).config.grade, 304);
    });
  });
});
