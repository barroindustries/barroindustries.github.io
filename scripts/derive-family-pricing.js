#!/usr/bin/env node
/**
 * derive-family-pricing.js — STARTING VALUES for the private option sheets of the six configurable product families.
 *
 *   node scripts/derive-family-pricing.js [path/to/products-database.json] [--out private/family-pricing.seed.json]
 *
 * WHAT IT DOES. For every option of every family (scripts/public-families.json) it looks in the PRIVATE master for evidence of what that
 * option adds to the family's primary SKU, and writes ONE private file listing every option value with: the derived amount (a flat peso
 * amount, plus a per-100-mm-of-length amount where the master supports one), HOW it was derived (which SKUs, which rule), a confidence
 * label, or BLANK when nothing in the master supports it. The output defaults to private/family-pricing.seed.json, which is GITIGNORED:
 * it contains prices, and this repository is public. The owner reads it, then imports it from the app (Inventory > Family Pricing >
 * Import, president only), reviews it, edits it and approves each family. Nothing is written to Firestore from here.
 *
 * NOTHING IN THIS FILE IS A PRICE. It holds SKU ids, spec labels and rules; every number comes out of the master at run time, and the
 * console prints statuses and confidence only (never an amount), so a log cannot leak one.
 *
 * EVIDENCE RULES (a value is derived only when the master really says it; everything else is left BLANK, never guessed):
 *   spec      the master's own price adder for the option on a SKU of that product kind (e.g. a sink table's "Double" basin type,
 *             a faucet type, a bench's undershelf). Best evidence: the master states it.
 *   pair      two SKUs of the same kind that differ in exactly the option, compared at the same size through the pricing machinery
 *             (priceCatalogItem), so size does not leak into the figure. Both SKUs' default sizes must be inside the family's limits.
 *   interp    a value BETWEEN two anchors (e.g. 2 layers from the 1- and 3-layer tables). Low confidence.
 *   (never)   extrapolation beyond the anchors, a figure that needs a guess about a feature the master does not state, or a proxy from
 *             another kind of product: those stay BLANK, with the candidates written in the derivation text for the owner.
 * CONFIDENCE.  high = two independent pieces of evidence agree (within 25 %).  medium = one clean piece of evidence.
 *              low = interpolated, or the evidence conflicts with other figures in the master, or the pair differs in more than the option.
 *              blank = no usable evidence. The text always says why, and lists the figures it was compared with.
 *
 * The MODEL these figures feed is js/pricing-core.js priceConfiguredItem(): configured price = the primary SKU priced at the requested size
 * through its own rules + the sum of the option deltas; an option equal to the family default adds nothing (the zero point).
 *   a choice value:   flat + perW100 x max(0, W - refW) / 100        (refW = the primary's standard length; a blank perW100 means none)
 *   a burner position: the cost of ONE position of that type (the amount the primary's own burner is also counted at: only the DIFFERENCE
 *                      between the chosen positions and the default ones is added)
 *   a linear family (the primary SKU has no length rule of its own): the amounts scale with length in both directions.
 *
 * Plain CommonJS, Node >= 18, no dependencies.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('./build-catalogue.js');
const PC = require('../js/pricing-core.js');
const PF = require('../js/product-families.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'private', 'family-pricing.seed.json');

// ── small helpers ───────────────────────────────────────────────────────────
const isNum = (n) => typeof n === 'number' && isFinite(n);
const round = (n) => Math.round(n);
const pct = (a, b) => (b === 0 ? Infinity : Math.abs(a - b) / Math.abs(b));
const fmt = (n) => Number(n).toLocaleString('en-PH');           // private file only
const CONF_ORDER = ['blank', 'low', 'medium', 'high'];
const down = (c) => CONF_ORDER[Math.max(1, CONF_ORDER.indexOf(c) - 1)];

function resolveMasterPath(arg) {
  const tried = [];
  if (arg) { tried.push(path.resolve(arg)); }
  else tried.push(path.resolve(process.cwd(), 'products-database.json'), path.join(REPO_ROOT, 'products-database.json'), path.join(os.homedir(), 'Desktop', 'barro-private', 'products-database.json'));
  for (const p of tried) if (fs.existsSync(p)) return p;
  throw new Error('products-database.json (the private master) not found. Tried:\n  ' + tried.join('\n  '));
}

// The same mapping the server and the Quote Builder apply to a product record.
function normaliseProduct(p) {
  return {
    id: p.id, category: p.category, name: p.name || p.title || '', formulaType: p.formulaType || 'fixed',
    basePrice: p.basePrice ?? p.baseRate ?? 0, defaultDimensions: p.measurement || p.defaultDimensions || {},
    formula: p.formula || {}, specs: Array.isArray(p.specs) ? p.specs : [], unit: p.unit || 'pc',
  };
}
function defaultSpecIdx(p) {
  return (p.specs || []).map((sp) => { const o = sp && Array.isArray(sp.options) ? sp.options : []; if (!o.length) return null; const i = o.indexOf(sp.default); return i < 0 ? 0 : i; });
}

function main(argv) {
  const args = argv.slice(2);
  let outPath = DEFAULT_OUT;
  const outIdx = args.indexOf('--out');
  if (outIdx >= 0) { outPath = path.resolve(args[outIdx + 1] || ''); args.splice(outIdx, 2); }
  // The output holds PRICES and this repository is public: it may only be written outside the repository or inside its gitignored private/ folder.
  const rel = path.relative(REPO_ROOT, outPath);
  const insideRepo = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (insideRepo && !(rel === 'private' || rel.startsWith('private' + path.sep))) throw new Error('refusing to write the private seed to ' + rel + ': inside the repository only private/ (gitignored) is allowed');
  const masterPath = resolveMasterPath(args[0]);
  let db;
  try { db = JSON.parse(B.stripJsonComments(fs.readFileSync(masterPath, 'utf8').replace(/^﻿/, ''))); }
  catch (e) { throw new Error(path.basename(masterPath) + ' is not valid JSON (the position is not echoed: the file holds prices)'); }
  const ids = db.products.map((p) => p.id);
  const pub = B.loadPublicCategories({ ids });
  const published = B.publishedProductIds(db, pub);
  const fams = B.loadPublicFamilies({ published, master: db });
  const constants = db.constants || {};
  const byId = new Map(db.products.map((p) => [p.id, normaliseProduct(p)]));

  const seed = deriveAll({ fams, byId, constants, masterName: path.basename(masterPath) });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(seed, null, 2) + '\n');

  // Console: statuses only — never an amount.
  console.log(`derive-family-pricing: ${path.basename(masterPath)} -> ${path.relative(process.cwd(), outPath) || outPath}  (PRIVATE: contains prices, gitignored)`);
  let derived = 0, blank = 0;
  for (const fid of fams.order) {
    const f = seed.families[fid];
    console.log(`\n  ${fid}  (primary ${f.primary}${f.sizeBasis === 'linear' ? ', length scales linearly' : ''})`);
    for (const row of f.table) {
      console.log(`    ${row.group.padEnd(11)} ${String(row.value).padEnd(10)} ${row.status.padEnd(8)} ${row.confidence.padEnd(7)} ${row.label}`);
      if (row.status === 'derived') derived++; else blank++;
    }
    if (f.anomalies.length) console.log(`    ! ${f.anomalies.length} data anomaly flag(s) — see the file`);
  }
  console.log(`\n  ${derived} option value(s) derived, ${blank} left blank (no usable evidence). Nothing was written to Firestore.`);
}

// ── the derivation ──────────────────────────────────────────────────────────
function deriveAll(ctx) {
  const { fams, byId, constants } = ctx;
  const seed = {
    _readme: 'PRIVATE. This file contains prices and must never be committed (the repository is public; this path is gitignored). Generated by scripts/derive-family-pricing.js from the private product master. Each option value shows the amount the master supports, how it was derived and how far to trust it. Import it in the app (Inventory > Family Pricing > Import derived starting values, president only), review and edit every figure, then approve each family. A blank value means the master gave no usable evidence: that option is "priced after review" until someone enters a figure. Imported sheets start UNAPPROVED, so nothing here reaches the public estimate until a family is approved.',
    kind: 'barro-family-pricing-seed',
    version: 1,
    schemaVersion: fams.version,
    generatedAt: new Date().toISOString(),
    masterFile: ctx.masterName,
    families: {},
  };
  for (const fid of fams.order) seed.families[fid] = deriveFamily(fid, fams.families[fid], ctx);
  return seed;
}

function deriveFamily(fid, fam, ctx) {
  const { byId, constants } = ctx;
  const prim = byId.get(fam.primary);
  if (!prim) throw new Error(`family "${fid}": the primary SKU ${fam.primary} is not in the master`);
  const primDD = prim.defaultDimensions || {};
  const linear = fam.sizeBasis === 'linear';
  const refW = (prim.formulaType === 'per_length' && prim.formula && prim.formula.baseLengthMm) || primDD.W || fam.dims.W.default;
  const cells = {};          // group -> valueKey -> cell
  const table = [];          // flat rows for the console / the report
  const anomalies = [];

  // price of a SKU at given dims through the production machinery
  const P = (id, dims) => (byId.get(id) ? PC.priceCatalogItem(byId.get(id), { dims: dims || {}, runs: null, specIdx: defaultSpecIdx(byId.get(id)) }, constants) : { unitPrice: 0, priced: false });
  const priced = (id) => !!byId.get(id) && P(id, {}).priced;
  const dd = (id) => (byId.get(id) && byId.get(id).defaultDimensions) || {};
  const insideLimits = (id) => ['W', 'D', 'H'].every((k) => {
    const v = dd(id)[k];
    if (v == null || !fam.dims[k]) return true;
    return v >= fam.dims[k].min && v <= fam.dims[k].max;
  });
  const specAdder = (id, label, option, baseOption) => {
    const sp = ((byId.get(id) && byId.get(id).specs) || []).filter((s) => s.label === label)[0];
    if (!sp || !Array.isArray(sp.priceAdder)) return null;
    const i = sp.options.indexOf(option), j = sp.options.indexOf(baseOption != null ? baseOption : sp.default);
    if (i < 0 || j < 0 || !isNum(sp.priceAdder[i]) || !isNum(sp.priceAdder[j])) return null;
    return sp.priceAdder[i] - sp.priceAdder[j];
  };
  // the same size for both SKUs: each axis at the larger of the two defaults (so the "shrinking never discounts" rule cannot leak in)
  const commonDims = (a, b) => {
    const out = {};
    for (const k of ['W', 'D', 'H']) {
      const v = [dd(a)[k], dd(b)[k]].filter(isNum);
      if (v.length) out[k] = Math.max(...v);
    }
    if (isNum(out.W)) out.W = Math.max(out.W, refW);
    return out;
  };
  // pair: `other` differs from `base` in the option, `n` times over. -> { flat, slope|null, evalW, approx, fixedPair } | null
  const pair = (base, other, n) => {
    if (!priced(base) || !priced(other)) return null;
    if (!insideLimits(base) || !insideLimits(other)) return null;
    const dims = commonDims(base, other);
    const pb = P(base, dims).unitPrice, po = P(other, dims).unitPrice;
    const both = byId.get(base).formulaType === 'per_length' && byId.get(other).formulaType === 'per_length';
    const approx = isNum(dims.W) && dims.W > refW;
    const slope = both && !approx ? (((byId.get(other).formula || {}).pricePerExtraMm || 0) - ((byId.get(base).formula || {}).pricePerExtraMm || 0)) * 100 / n : null;
    return { flat: (po - pb) / n, slope, evalW: dims.W, approx, fixedPair: !both };
  };

  const rowOf = (group, valueKey, label) => ({ group, value: valueKey, label });
  function setCell(group, valueKey, label, decision) {
    cells[group] = cells[group] || {};
    const c = decision && isNum(decision.flat) ? {
      flat: round(decision.flat),
      perW100: isNum(decision.perW100) && round(decision.perW100) !== 0 ? round(decision.perW100) : null,
      confidence: decision.confidence,
      derivation: decision.text,
    } : { flat: null, perW100: null, confidence: 'blank', derivation: (decision && decision.text) || 'No usable evidence in the master.' };
    if (linear && c.flat !== null && c.perW100 === null && refW > 0) c.perW100 = round(c.flat * 100 / refW);   // scales with length both ways
    cells[group][valueKey] = c;
    table.push(Object.assign(rowOf(group, valueKey, label), { status: c.flat === null ? 'blank' : 'derived', confidence: c.confidence }));
  }
  // decide(candidates): candidate = { kind:'spec'|'pair'|'interp', flat, slope, text, approx? }
  function decide(cands, blankWhy) {
    const live = cands.filter((c) => c && isNum(c.flat));
    if (!live.length) return { flat: null, text: (blankWhy || 'No usable evidence in the master.') };
    const rank = { spec: 1, pair: 2, interp: 3 };
    live.sort((a, b) => ((b.prefer ? 1 : 0) - (a.prefer ? 1 : 0)) || (rank[a.kind] - rank[b.kind]));   // an owner-prescribed comparison goes first
    const first = live[0];
    const others = live.slice(1);
    const agree = others.filter((o) => pct(o.flat, first.flat) <= 0.25);
    const clash = others.filter((o) => pct(o.flat, first.flat) > 0.5);
    let conf = first.kind === 'interp' ? 'low' : 'medium';
    if (first.kind === 'pair' && (first.fixedPair || first.approx || first.mixed)) conf = down(conf);
    if (agree.length && first.kind !== 'interp') conf = 'high';
    if (clash.length) conf = 'low';
    const parts = [first.text];
    others.forEach((o) => parts.push(`Cross-check (${o.kind === 'spec' ? 'master adder' : o.kind === 'pair' ? 'SKU pair' : 'interpolation'}): ${o.text.replace(/\.$/, '')} — ${pct(o.flat, first.flat) <= 0.25 ? 'agrees' : pct(o.flat, first.flat) > 0.5 ? 'CONFLICTS' : 'differs somewhat'}.`));
    return { flat: first.flat, perW100: first.slope, confidence: conf, text: parts.join(' ') };
  }
  const blank = (why) => ({ flat: null, text: why });
  const cand = (kind, flat, slope, text, extra) => Object.assign({ kind, flat, slope: slope == null ? null : slope, text }, extra || {});
  const sku = (...a) => a.join(' ');
  const pairCand = (base, other, n, what) => {
    const r = pair(base, other, n);
    if (!r) return null;
    const bits = [`${other} versus ${base} at the same size${r.approx ? ` (taken at ${r.evalW} mm, the larger SKU's standard length, so below that length it is approximate)` : ''}`];
    if (n > 1) bits.push(`divided by ${n}`);
    if (what) bits.push(what);
    return cand('pair', r.flat, r.slope, `${bits.join(', ')} = ${fmt(round(r.flat))}${r.slope ? `, plus ${fmt(round(r.slope))} per 100 mm of length (the two SKUs' per-mm rates differ)` : ''}.`, { approx: r.approx, fixedPair: r.fixedPair });
  };
  const adderCand = (id, label, option, baseOption, what) => {
    const v = specAdder(id, label, option, baseOption);
    return v == null ? null : cand('spec', v, null, `The master's own option adder on ${id} ("${label}": ${option}${baseOption ? ' versus ' + baseOption : ''})${what ? ', ' + what : ''} = ${fmt(round(v))}.`);
  };
  const lbl = (g, v) => { const gg = PF.groupOf(fam, g); const o = PF.optionOf(gg, v); return gg.label + ': ' + (o.f || o.l); };

  // ── per-family recipes ────────────────────────────────────────────────────
  if (fid === 'prep_table') {
    const three = pairCand('PW-001', 'PW-003', 1, 'the 3-layer table (top + 2 undershelves) against the 1-layer table, as the owner prescribed; PW-002 is not used (it also has casters)');
    if (three) three.prefer = true;
    const baker = adderCand('BA-001', 'Undershelf', '1 undershelf', 'None', 'one undershelf on the baker\'s worktable');
    const bakerNote = baker ? [cand('spec', baker.flat, null, baker.text)] : [];
    // 3 layers: the direct pair; the master's undershelf adder is shown as a cross-check on the PER-LAYER figure
    const perLayerPair = pair('PW-001', 'PW-003', 2);
    setCell('layers', '3', lbl('layers', 3), decide([three, ...bakerNote.map((b) => cand('spec', b.flat * 2, null, `${b.text.replace(/ = [\d,.-]+\.$/, '')} counted twice (two undershelves) = ${fmt(round(b.flat * 2))}.`))]));
    // 2 layers: half-way (one undershelf), interpolated between the 1- and 3-layer tables
    setCell('layers', '2', lbl('layers', 2), perLayerPair
      ? decide([cand('interp', perLayerPair.flat, perLayerPair.slope, `Half of the 3-layer difference (one undershelf), interpolated between the 1-layer and 3-layer tables; PW-002 (2 layers with casters) is not used = ${fmt(round(perLayerPair.flat))}.`)])
      : blank('The 1-layer and 3-layer tables cannot be compared.'));
    const over = adderCand('BA-010', 'Overshelf', 'Single overshelf', 'None', 'one overshelf on the bread slicing table');
    setCell('upper', '1', lbl('upper', 1), decide([over]));
    setCell('upper', '2', lbl('upper', 2), blank(`Only one upper shelf is priced in the master; a second one would be an extrapolation.${over ? ` Suggested if you agree it doubles: ${fmt(round(over.flat * 2))}.` : ''}`));
  } else if (fid === 'sink') {
    const basin = adderCand('PW-051', 'Basin Type', 'Double', 'Single (508x508x254)', 'the sink table, double basin against single');
    const faucetA = adderCand('PW-004', 'Faucet Type', 'Pre-rinse spray', 'Gooseneck', 'the primary sink');
    const faucetB = adderCand('BA-012', 'Faucet', 'Pre-rinse spray', 'Gooseneck', 'the bakery pot and pan sink');
    // cross-checks for 2 basins: the two double-sink SKUs against the single sink, less the faucet difference
    const faucetAdder = faucetA ? faucetA.flat : 0;
    const xcheck = (other, what) => {
      const r = pair('PW-004', other, 1);
      if (!r) return null;
      return cand('pair', r.flat - faucetAdder, null, `${other} (2 sinks, pre-rinse) versus PW-004 at the same size, less the pre-rinse faucet adder${what ? ', ' + what : ''} = ${fmt(round(r.flat - faucetAdder))}.`, { fixedPair: r.fixedPair, approx: r.approx, mixed: true });
    };
    const two = decide([basin, xcheck('PW-006'), xcheck('PW-007', 'a SKU whose list price is below the smaller double sink')].filter(Boolean));
    setCell('basins', '2', lbl('basins', 2), two);
    const c6 = xcheck('PW-008', 'a hospital-grade triple sink, which is not a clean comparison');
    const c18 = (() => { const r = pair('PW-004', 'PW-018', 1); return r ? `PW-018 (3 sinks, with cabinet) versus PW-004 at the same size = ${fmt(round(r.flat))} (includes the cabinet)` : null; })();
    setCell('basins', '3', lbl('basins', 3), blank(`No clean 3-sink comparison in the master.${c6 ? ' ' + c6.text.replace('(2 sinks, pre-rinse)', '(3 sinks, hospital grade)') : ''}${c18 ? ' ' + c18 + '.' : ''}${basin ? ` If you want a straight line from the double-basin adder: ${fmt(round(basin.flat * 2))}.` : ''}`));
    setCell('basins', '4', lbl('basins', 4), blank('No 4-sink SKU: an extrapolation.'));
    setCell('alignment', 'left', lbl('alignment', 'left'), blank('A layout choice with no SKU behind it. Suggested: 0 (no extra material) if you agree.'));
    setCell('alignment', 'right', lbl('alignment', 'right'), blank('A layout choice with no SKU behind it. Suggested: 0 (no extra material) if you agree.'));
    const slot = pair('PW-006', 'PW-009', 1);
    setCell('undershelf', 'true', lbl('undershelf', true), blank(`The master has no clean sink-undershelf figure.${slot ? ` PW-009 (2 sinks, slotted bottom, pull-out faucet) versus PW-006 differs by ${fmt(round(slot.flat))}, but also in the faucet and the length, so it is not used.` : ''}${(() => { const a = specAdder('BA-001', 'Undershelf', '1 undershelf', 'None'); return a == null ? '' : ` The baker's worktable undershelf adder is ${fmt(round(a))} (a table, not a sink).`; })()}`));
    setCell('upper', 'true', lbl('upper', true), blank(`The master has no sink upper-shelf figure.${(() => { const a = specAdder('BA-010', 'Overshelf', 'Single overshelf', 'None'); return a == null ? '' : ` The bread table's overshelf adder is ${fmt(round(a))} (a table, not a sink).`; })()}`));
    setCell('faucet', 'prerinse', lbl('faucet', 'prerinse'), decide([faucetA, faucetB]));
  } else if (fid === 'stove') {
    // Per-position costs. Model: price = P(CE-001 at the SKU's size) + (sum of position costs) - (cost of ONE low-pressure small position).
    const unitOf = (id, positions) => {
      const dims = commonDims('CE-001', id);
      if (!priced(id) || !insideLimits(id)) return null;
      const base = P('CE-001', dims).unitPrice;
      const own = P(id, dims).unitPrice;
      return { diff: own - base, positions, dims };
    };
    const c2 = unitOf('CE-002', 2), c3 = unitOf('CE-003', 3);
    const lpA = c2 ? c2.diff : null;                         // 2c - c = c
    const lpB = c3 ? c3.diff / 2 : null;                     // 3c - c = 2c
    const lpC = [lpA, lpB].filter(isNum);
    const lp = lpC.length ? lpC.reduce((a, b) => a + b, 0) / lpC.length : null;
    const lpTxt = [];
    if (lpA != null) lpTxt.push(`CE-002 (2 low-pressure burners) against the single-burner range at the same size = ${fmt(round(lpA))}`);
    if (lpB != null) lpTxt.push(`CE-003 (3 burners) = ${fmt(round(lpB))} per extra burner`);
    const lpConf = lpC.length === 2 ? (pct(lpA, lpB) <= 0.25 ? 'high' : (pct(lpA, lpB) > 0.5 ? 'low' : 'medium')) : (lpC.length === 1 ? 'medium' : 'blank');
    const mk = (flat, conf, text) => ({ flat, confidence: conf, text });
    setCell('positions', 'lp_small', lbl('positions', 'lp_small'), lp == null ? blank('The 2- and 3-burner low-pressure ranges are not both usable.') : mk(lp, lpConf, `Cost of one low-pressure small position: ${lpTxt.join('; ')}${lpC.length === 2 ? (pct(lpA, lpB) <= 0.25 ? `. The two agree (within 25 %), so their average ${fmt(round(lp))} is used` : `. The two disagree, so the average ${fmt(round(lp))} is used`) : ''}.`));
    // wok: CE-006 against the single low-pressure burner at the same size
    const wok = unitOf('CE-006', 1);
    setCell('positions', 'wok', lbl('positions', 'wok'), wok && lp != null ? mk(wok.diff + lp, down(lpConf === 'blank' ? 'low' : lpConf), `CE-006 (one wok burner) is ${fmt(round(wok.diff))} more than the single low-pressure range at the same size; added to the low-pressure position cost ${fmt(round(lp))} = ${fmt(round(wok.diff + lp))}.`) : blank('CE-006 or the low-pressure cost is not usable.'));
    // high-pressure large: CE-004 (4 positions)
    const c4 = unitOf('CE-004', 4);
    setCell('positions', 'hp_large', lbl('positions', 'hp_large'), c4 && lp != null ? mk((c4.diff + lp) / 4, down(lpConf === 'blank' ? 'low' : lpConf) === 'low' ? 'low' : 'medium', `CE-004 (4 high-pressure burners) is ${fmt(round(c4.diff))} more than the single low-pressure range at the same size; (that + one low-pressure position ${fmt(round(lp))}) / 4 = ${fmt(round((c4.diff + lp) / 4))} per position.`) : blank('CE-004 or the low-pressure cost is not usable.'));
    // high-pressure small: CE-005 is a different (square, SS/BI) construction; refused when it contradicts "small <= large"
    const c5 = unitOf('CE-005', 4);
    const hpSmall = c5 && lp != null ? (c5.diff + lp) / 4 : null;
    const hpLarge = c4 && lp != null ? (c4.diff + lp) / 4 : null;
    setCell('positions', 'hp_small', lbl('positions', 'hp_small'), hpSmall != null && (hpLarge == null || hpSmall <= hpLarge)
      ? mk(hpSmall, 'low', `CE-005 (4 square high-pressure burners) implies ${fmt(round(hpSmall))} per position.`)
      : blank(`CE-005 (the only small high-pressure range) is a different square SS/BI construction${hpSmall != null ? ` and implies ${fmt(round(hpSmall))} per position, MORE than the large burner's ${hpLarge != null ? fmt(round(hpLarge)) : 'figure'}` : ''}: not used.`));
    setCell('positions', 'lp_large', lbl('positions', 'lp_large'), blank('No priced SKU has a large low-pressure burner (CE-017 is unpriced).'));
    setCell('positions', 'soup', lbl('positions', 'soup'), blank('No priced SKU has a soup burner (CE-018 is unpriced; CE-013 has implausible default sizes).'));
    // add-ons: the master's combis are not coherent enough to split
    const g = pair('CE-001', 'CE-010', 1);
    setCell('addons', 'griller', lbl('addons', 'griller'), blank('No priced SKU separates a griller section (CE-019, CE-026 are unpriced); the combis CE-007 and CE-008 do not agree with each other.'));
    setCell('addons', 'griddle', lbl('addons', 'griddle'), blank(`No clean griddle-section figure: CE-010 (a griddle on its own stand) includes a body. ${g && lp != null ? `For reference it is ${fmt(round(g.flat + lp))} once the burner cost is added back.` : ''} The combis CE-007 / CE-008 imply very different sums for griller + griddle together.`));
    setCell('addons', 'oven', lbl('addons', 'oven'), blank('CE-014 (the only range with an oven) has a default depth outside the stove\'s limits and costs less than the same range without an oven in the master: not usable.'));
    setCell('addons', 'fryer', lbl('addons', 'fryer'), blank('Only double and triple fryers are priced (CE-009, CE-022); there is no single fryer section to compare.'));
  } else if (fid === 'cabinet') {
    const why = 'No clean comparison in the master: ';
    setCell('type', 'wall', lbl('type', 'wall'), blank(why + 'the wall-hung cabinets (PW-045, PW-046) are fixed-price lots at sizes far from the floor cabinet.'));
    setCell('doors', 'sliding', lbl('doors', 'sliding'), blank(why + 'no SKU has sliding doors.'));
    setCell('shelves', '1', lbl('shelves', 1), blank(why + 'only 3-shelf floor cabinets are priced.'));
    setCell('shelves', '2', lbl('shelves', 2), blank(why + 'only 3-shelf floor cabinets are priced.'));
    const a = byId.get('PW-015'), b = byId.get('PW-038');
    if (a && b && a.basePrice > 0 && a.basePrice === b.basePrice) anomalies.push('PW-015 and PW-038 carry the SAME list price although PW-038\'s default size is several times larger — please check the master.');
  } else if (fid === 'wall_shelf') {
    const t3 = pair('PW-023', 'PW-024', 1);
    const t3c = t3 ? cand('pair', t3.flat, null, `PW-024 (3-layer open shelves) versus PW-023 (one shelf) at the same standard length = ${fmt(round(t3.flat))}; assumes the surface is the same.`, { fixedPair: true, mixed: true }) : null;
    setCell('tiers', '3', lbl('tiers', 3), decide([t3c], 'PW-024 is not usable.'));
    setCell('tiers', '2', lbl('tiers', 2), t3 ? decide([cand('interp', t3.flat / 2, null, `Half of the 3-tier difference, interpolated between the 1-tier and 3-tier SKUs = ${fmt(round(t3.flat / 2))}; PW-033 (2 layers) is unpriced.`)]) : blank('PW-024 is not usable.'));
    setCell('surface', 'slotted', lbl('surface', 'slotted'), blank('No SKU states a slotted-versus-solid difference.'));
  } else if (fid === 'rack') {
    const feet = adderCand('BA-004', 'Casters', 'Adjustable feet', 'Casters w/ brake', 'a bread cooling rack');
    setCell('wheels', 'false', lbl('wheels', false), feet ? decide([Object.assign({}, feet, { fixedPair: true })].map((c) => Object.assign(c, { kind: 'pair', mixed: true }))) : blank('No wheels adder in the master.'));
    const why = 'No clean comparison in the master: the other racks differ from PW-010 in size and construction as well as tiers.';
    for (const t of [3, 5, 6]) setCell('tiers', String(t), lbl('tiers', t), blank(why));
  }

  // The length rate for a family whose primary SKU has no length rule of its own: the master has none, so it is derived as list price per 100 mm of the
  // primary's standard length (price assumed proportional to length) — low confidence, and flagged as such.
  let size = { perW100: null, confidence: 'blank', derivation: '' };
  if (linear) {
    const base = P(fam.primary, {}).unitPrice;
    if (base > 0 && refW > 0) size = { perW100: round(base * 100 / refW), confidence: 'low', derivation: `${fam.primary} has no length rule of its own, so the length rate is its list price per 100 mm of its standard length (${refW} mm), i.e. price assumed proportional to length. Edit if a shorter or longer shelf should cost more or less per metre.` };
    else size.derivation = `${fam.primary} is not priced, so no length rate can be derived.`;
    table.push({ group: 'size', value: 'W', label: 'Length (per 100 mm from the standard length)', status: size.perW100 === null ? 'blank' : 'derived', confidence: size.confidence });
  }

  // Data-quality flags (private file only)
  const absorbed = Object.keys(fam.absorbed);
  const variance = [];
  for (const id of absorbed) {
    const p = byId.get(id);
    if (!p || !(p.basePrice > 0)) continue;
    const cfg = fam.absorbed[id];
    const dims = {};
    for (const k of Object.keys(fam.dims)) { const v = (p.defaultDimensions || {})[k]; dims[k] = isNum(v) ? Math.min(Math.max(v, fam.dims[k].min), fam.dims[k].max) : fam.dims[k].default; }
    const sheet = { approved: true, schemaVersion: fams_version(ctx), options: toSheetOptions(cells), size: { perW100: size.perW100 } };
    const r = PC.priceConfiguredItem(prim, fam, cfg, dims, sheet, constants, { schemaVersion: fams_version(ctx) });
    if (r.priced) {
      const ratio = r.unitPrice / p.basePrice;
      variance.push({ sku: id, familyEstimateVsList: Math.round(ratio * 100) / 100, flag: Math.abs(ratio - 1) > 0.35 ? 'differs by more than 35 % from the SKU\'s own list price' : 'ok' });
    } else variance.push({ sku: id, familyEstimateVsList: null, flag: r.reason === 'missing_input' ? 'cannot be checked: blank cells (' + r.missing.join(', ') + ')' : 'cannot be checked' });
  }
  // two SKUs of the family with the same list price at very different sizes
  const priced2 = absorbed.map((id) => byId.get(id)).filter((p) => p && p.basePrice > 0);
  for (let i = 0; i < priced2.length; i++) for (let j = i + 1; j < priced2.length; j++) {
    const a = priced2[i], b = priced2[j];
    const wa = (a.defaultDimensions || {}).W, wb = (b.defaultDimensions || {}).W;
    if (a.basePrice === b.basePrice && isNum(wa) && isNum(wb) && Math.max(wa, wb) / Math.min(wa, wb) > 1.5 && !anomalies.some((x) => x.includes(a.id) && x.includes(b.id))) anomalies.push(`${a.id} and ${b.id} carry the SAME list price at default lengths ${wa} and ${wb} mm — please check the master.`);
  }

  return {
    familyId: fid, primary: fam.primary, schemaVersion: fams_version(ctx), sizeBasis: fam.sizeBasis, refW,
    options: cells, size, table, anomalies, absorbedCheck: variance,
  };
}
function fams_version(ctx) { return ctx.fams.version; }
function toSheetOptions(cells) {
  const out = {};
  for (const g of Object.keys(cells)) {
    out[g] = {};
    for (const v of Object.keys(cells[g])) out[g][v] = { flat: cells[g][v].flat, perW100: cells[g][v].perW100 };
  }
  return out;
}

module.exports = { deriveAll, deriveFamily, normaliseProduct, resolveMasterPath };

if (require.main === module) {
  try { main(process.argv); }
  catch (e) { console.error('derive-family-pricing: ' + (e && e.message ? e.message : e)); process.exit(1); }
}
