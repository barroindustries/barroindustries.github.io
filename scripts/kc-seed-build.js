#!/usr/bin/env node
/**
 * kc-seed-build.js — builds the PRIVATE seed of the Barro Kitchens configurators in the live quote builder:
 * the material price list, the whole Standard Price List (every code with its price, per-metre rate and price status), the pricing settings and the Grilling / Bakery catalogue products.
 *
 *   node scripts/kc-seed-build.js [--private <dir>] [--overrides <file>] [--out <file>]
 *
 * WHAT IT DOES (the BK live integration spec in specs/, section 3.6, and its addendum 1). It reads PRIVATE inputs and writes ONE private file:
 *   1. the prototype's own price list: <private>/prototypes/qb-d7/kc/core.js then materials.js, run in a vm sandbox with a window stub.
 *      That gives KC.P (every material row and its SAMPLE price), KC.PL_INFO / KC.PL_CATS and KC.SET (the pricing settings).
 *      The live engine's own list (core.js and materials.js, price-free) is read too, from <private>/kc-src or qb/kc when either has it: every key it ships must have a price here.
 *   2. <private>/kc-seed/overrides-<date>.json, made by hand from the owner's rulings (Round 5 section 4: the Kingsway prices, the blower and heater prices;
 *      the Standard Price List: the Doc's prices where the sheet has none; Round 5 Q68: the Grilling and Bakery catalogue items; addendum A2: the renamed codes).
 *   3. the Standard Price List sheet, as a csv in <private>/kc-seed (named by listPrices.csv in the overrides): every row becomes one list row, so the whole price
 *      list is in kc_config/list_prices with its per-metre rate and its price status.
 *   Output: <private>/kc-seed/kc-seed.json, the file the President imports from the quote builder (Pricing settings > Import prices from a file).
 *
 * NOTHING IN THIS FILE IS A PRICE. It holds keys, labels and rules; every number comes out of the two private inputs at run time, and the console
 * prints counts and codes only, never an amount, so a log cannot leak one. This repository is public (GitHub Pages serves every tracked file):
 * the inputs and the output live in the gitignored private/ folder and must never be committed. The output may only be written inside a
 * private/ folder, or outside the repository altogether; anything else is refused.
 *
 * WHERE private/ IS. --private <dir>, else $KC_PRIVATE, else the repo's own private/, else the nearest parent's private/ (so it also works from a
 * git worktree under <main checkout>/.claude/worktrees/<name>, where private/ only exists in the main checkout). A folder counts only when it has
 * prototypes/qb-d7/kc/core.js inside.
 *
 * THE SEED (what the file holds):
 *   { v, made, settings, materials, listPrices, products }
 *   settings    the shape of KC.SET plus v and floorMode ('list'), i.e. the kc_config/settings document.
 *   materials   { <key>: { p, source } } for every row of the reference price list, plus { p, source, l, u, cat, grade, size } for each row
 *               the overrides declare as new (so the document is complete even when materials.js does not have the row yet).
 *               source: 'Sample' (the prototype's made-up price), 'Kingsway PO + 10%', 'Set by Neil' (blowers), 'Manual'.
 *   listPrices  { effective, rows: { <code>: { code, price, perMetre | null, status, label, std } } }, the kc_config/list_prices document. status is one of Data, Smoothed,
 *               Estimate, After review, Supplier price (staff only, never printed); label is the product name and std its standard size and spec.
 *   products    [ { sku, title, category, unit, formulaType, basePrice, measurement?, specifications } ], written to products/{sku}.
 *               measurement uses W / D / H in millimetres, the keys the Product Database page and the quote builder read.
 *
 * IT FAILS (exit 1, nothing written) WHEN: a material ends up with no price (null, not a number, or negative); a key of the live materials.js has no price here;
 * a key of the overrides' price table is not in the reference list, or a blower HP tier matches no row; a list code in a product-chef.js LIST has no price (a row whose line carries
 * the words "formula-only" is exempt; an old name that the overrides rename only warns); a list row has no price, a bad status or no label; a product row lacks sku, title or basePrice;
 * a key, code or sku is malformed or repeated.
 * WARNS (exit 0) when the Doc and the sheet disagree on a price, when the live product-chef.js still uses an old code name, when a list price disagrees with the
 * prototype's own LIST, or when a new row reads differently here and in the live materials.js.
 *
 * Plain CommonJS, Node 18 or later, no dependencies, no network, no credentials.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCES = ['Sample', 'Kingsway PO + 10%', 'Set by Neil', 'Manual'];
const STATUSES = ['Data', 'Smoothed', 'Estimate', 'After review', 'Supplier price'];       // the price status of a list row: staff only, never printed
const KEY_RE = /^[a-z0-9_]{1,40}$/;        // the kc_materials rule: the doc id is the key
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,40}$/;
const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const isNum = (n) => typeof n === 'number' && isFinite(n);
const isStr = (s) => typeof s === 'string' && s.trim() !== '';
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

// ── arguments and paths ─────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--private' || a === '--overrides' || a === '--out') out[a.slice(2)] = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
    else throw new Error('unknown argument: ' + a + '  (usage: node scripts/kc-seed-build.js [--private <dir>] [--overrides <file>] [--out <file>])');
    if (a.startsWith('--') && a !== '--help' && out[a.slice(2)] === undefined) throw new Error(a + ' needs a value');
  }
  return out;
}

function findPrivate(explicit) {
  const cands = [];
  if (explicit) cands.push(path.resolve(explicit));
  if (process.env.KC_PRIVATE) cands.push(path.resolve(process.env.KC_PRIVATE));
  let dir = REPO_ROOT;
  for (let i = 0; i < 7; i++) {
    cands.push(path.join(dir, 'private'));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const c of cands) if (fs.existsSync(path.join(c, 'prototypes', 'qb-d7', 'kc', 'core.js'))) return c;
  throw new Error('private/ with prototypes/qb-d7/kc/core.js not found. Tried:\n  ' + cands.join('\n  ') + '\nPass --private <dir> (or set KC_PRIVATE).');
}

/** The output holds PRICES and this repository is public: only inside a private/ folder, or outside the repository and its main checkout. */
function assertSafeOut(out, privateDir) {
  const inside = (parent, child) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  if (inside(privateDir, out)) return;
  if (inside(REPO_ROOT, out) || inside(path.dirname(privateDir), out)) {
    throw new Error('refusing to write the seed to ' + out + ': inside the repository only a private/ folder (gitignored) is allowed');
  }
}

// ── the price lists: the prototype's (the reference) and the live engine's (qb/kc, price-free) ─────────────────
function loadKC(base) {
  const doc = {
    readyState: 'complete', addEventListener() {}, getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} },
  };
  const sandbox = { console, Intl, document: doc, setTimeout: () => 0, clearTimeout() {}, matchMedia: () => ({ matches: false }) };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['core.js', 'materials.js']) {
    const file = path.join(base, f);
    if (!fs.existsSync(file)) throw new Error('missing reference file: ' + file);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  const json = vm.runInContext('JSON.stringify({ P: window.KC.P, INFO: window.KC.PL_INFO, CATS: window.KC.PL_CATS, SET: window.KC.SET })', sandbox);
  const ref = JSON.parse(json);
  if (!plain(ref.P) || !Object.keys(ref.P).length) throw new Error(path.join(base, 'materials.js') + ' defines no price list (KC.P is empty)');
  if (!plain(ref.SET) || !plain(ref.SET.br) || !plain(ref.SET.hood) || !plain(ref.SET.duct)) throw new Error(path.join(base, 'core.js') + ' defines no KC.SET');
  return ref;
}
const loadReference = (privateDir) => loadKC(path.join(privateDir, 'prototypes', 'qb-d7', 'kc'));
/** Where the live engine sources are: the private kc-src folder when the engine is kept out of the public repo, else qb/kc in this checkout. */
function engineDir(privateDir) {
  return [path.join(privateDir, 'kc-src'), path.join(REPO_ROOT, 'qb', 'kc')].find((d) => fs.existsSync(path.join(d, 'core.js')) && fs.existsSync(path.join(d, 'materials.js'))) || null;
}
/** The live engine's lists, when the sources are here: its keys are what the app shows, so each must have a seed price. */
function loadLive(privateDir) {
  const base = engineDir(privateDir);
  return base ? { dir: base, kc: loadKC(base) } : null;
}

// ── the Standard Price List sheet (a csv exported from the owner's sheet) ───────────────────────────────────
function parseCsv(text) {
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x !== '')) out.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== '')) out.push(row);
  return out;
}
const numCell = (v) => { const n = Number(String(v == null ? '' : v).replace(/[,\s]/g, '')); return String(v == null ? '' : v).trim() !== '' && isFinite(n) && n > 0 ? n : null; };
/** code -> { label, std, price (a number, or null for "Priced after review" and the like), perMetre (a number or null), status } */
function readSheet(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('the price list sheet is empty: ' + file);
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (start) => { const i = head.findIndex((h) => h.startsWith(start)); if (i < 0) throw new Error('the price list sheet has no column "' + start + '": ' + file); return i; };
  const ci = { code: col('code'), label: col('product'), std: col('standard size'), price: col('standard price'), metre: col('per-metre'), status: col('price status') };
  const sheet = new Map();
  rows.slice(1).forEach((r) => {
    const code = (r[ci.code] || '').trim(); if (!code) return;
    sheet.set(code, { label: (r[ci.label] || '').trim(), std: (r[ci.std] || '').trim(), price: numCell(r[ci.price]), perMetre: numCell(r[ci.metre]), status: (r[ci.status] || '').trim() });
  });
  return sheet;
}

// ── the list codes of product-chef.js ───────────────────────────────────────────────────────────────────────
/** Rows of the `const LIST = [ ... ].map(` table: [{ code, price (a number, or null when the row has none), formulaOnly }]. Write "formula-only" on a row's line to exempt it. */
function chefRows(src) {
  const at = src.indexOf('const LIST = [');
  if (at < 0) return null;
  const end = src.indexOf('].map(', at);
  const lines = src.slice(at, end < 0 ? undefined : end).split('\n');
  const rows = [];
  for (const line of lines) {
    const formulaOnly = /formula[- ]only/i.test(line);
    for (const m of line.matchAll(/\[\s*'CK-[A-Za-z0-9-]+'[^\]]*\]/g)) {
      let row = null;
      try { row = vm.runInNewContext(m[0], Object.create(null), { timeout: 100 }); } catch (e) { row = null; }     // a row is a plain array literal: [code, items, n, variant, price?]
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      rows.push({ code: row[0], price: isNum(row[4]) ? row[4] : null, formulaOnly });
    }
  }
  return rows;
}

// ── build ───────────────────────────────────────────────────────────────────────────────────────────────────
function build(ref, ov, chefFiles, live, sheet) {
  const errors = [], warnings = [];
  const fail = (m) => errors.push(m);

  if (!plain(ov)) throw new Error('the overrides file is not a JSON object');

  // settings: the reference KC.SET, then the overrides' keys; the markup must satisfy the rules' bounds
  const settings = Object.assign({ v: 1 }, JSON.parse(JSON.stringify(ref.SET)), ov.settings || {}, { floorMode: (ov.settings && ov.settings.floorMode) || 'list' });
  settings.v = 1;
  const num = (label, v) => { if (!isNum(v) || v < 0) fail('settings: ' + label + ' is not a number >= 0'); };
  ['simple', 'medium', 'complex'].forEach((k) => num('br.' + k, settings.br && settings.br[k]));
  num('misc', settings.misc);
  num('corner', settings.corner);
  if (!isNum(settings.markup) || settings.markup < 1 || settings.markup > 10) fail('settings: markup must be a number from 1 to 10 (the rules refuse anything else)');
  if (!['list', 'formula'].includes(settings.floorMode)) fail("settings: floorMode must be 'list' or 'formula'");

  // materials: every reference row at its sample price, then the owner's table, the blower tiers and the new rows
  const materials = {};
  const prices = new Map();
  for (const key of Object.keys(ref.P)) {
    if (!KEY_RE.test(key)) fail('material key is not a-z 0-9 _ (1 to 40): ' + key);
    materials[key] = { p: ref.P[key].p, source: 'Sample' };
  }
  if (materials.cornerc) materials.cornerc.p = settings.corner;      // the corner charge row follows the setting (the screen writes both)

  for (const [key, row] of Object.entries(ov.materials || {})) {
    if (!materials[key]) { fail('overrides price a key the reference list does not have: ' + key); continue; }
    if (!isNum(row && row.p) || row.p < 0) { fail('overrides: no price for ' + key); continue; }
    if (!SOURCES.includes(row.source)) { fail('overrides: unknown source for ' + key); continue; }
    materials[key] = { p: row.p, source: row.source };
  }

  const bl = ov.blowers || {};
  const isBlower = (r) => r && isNum(r.hp) && r.fam && r.fam !== 'fan';     // blowers only: the Vector fans keep their sample prices
  for (const [hp, p] of Object.entries(bl.byHp || {})) {
    const hit = Object.keys(ref.P).filter((k) => isBlower(ref.P[k]) && String(ref.P[k].hp) === String(hp));
    if (!hit.length) { fail('blower tier matches no row of the reference list: ' + hp + ' HP'); continue; }
    if (!isNum(p) || p < 0) { fail('overrides: no blower price for ' + hp + ' HP'); continue; }
    if (!SOURCES.includes(bl.source)) { fail('overrides: unknown blower source'); continue; }
    hit.forEach((k) => { materials[k] = { p, source: bl.source }; });
  }

  const cats = new Set(ref.CATS || []);
  const newKeys = [];
  for (const [key, row] of Object.entries(ov.newRows || {})) {
    if (!KEY_RE.test(key)) { fail('new row key is not a-z 0-9 _ (1 to 40): ' + key); continue; }
    if (!row || !isNum(row.p) || row.p < 0) { fail('overrides: no price for the new row ' + key); continue; }
    if (!SOURCES.includes(row.source)) { fail('overrides: unknown source for the new row ' + key); continue; }
    for (const f of ['l', 'u', 'cat', 'grade', 'size']) if (!isStr(row[f])) fail('new row ' + key + ' has no ' + f);
    if (isStr(row.cat) && cats.size && !cats.has(row.cat)) fail('new row ' + key + ' names a category the price list does not have');
    if (ref.P[key]) {                                         // the prototype may have the row already: say so only when it reads differently
      const inf = ref.INFO && ref.INFO[key], rv = ref.P[key];
      const diff = [['label', rv.l, row.l], ['unit', rv.u, row.u], ['category', inf && inf[0], row.cat], ['grade', inf && inf[1], row.grade], ['size', inf && inf[2], row.size]].filter((d) => d[1] !== d[2]).map((d) => d[0]);
      if (diff.length) warnings.push('new row ' + key + ' reads differently in the reference list (' + diff.join(', ') + '); the overrides win');
    }
    materials[key] = { p: row.p, source: row.source, l: row.l, u: row.u, cat: row.cat, grade: row.grade, size: row.size };
    newKeys.push(key);
  }
  for (const [key, row] of Object.entries(materials)) {
    if (!isNum(row.p) || row.p < 0) fail('material has no price: ' + key);
    prices.set(key, row.p);
  }
  // the live list (qb/kc/materials.js): every key it ships needs a price here, and a new row's wording should read the same in both
  if (live) {
    const lk = live.kc;
    Object.keys(lk.P).forEach((k) => { if (!materials[k]) fail('the live materials.js has a material the seed does not price: ' + k); });
    Object.keys(materials).forEach((k) => { if (!lk.P[k] && !(materials[k].l && materials[k].u)) warnings.push('the seed prices a key the live materials.js does not have (the app ignores it): ' + k); });
    newKeys.forEach((k) => {
      const lv = lk.P[k], inf = lk.INFO && lk.INFO[k], row = materials[k];
      if (!lv) { warnings.push('new row ' + k + ' is not in the live materials.js yet (the app creates it from its document)'); return; }
      const diff = [['label', lv.l, row.l], ['unit', lv.u, row.u], ['category', inf && inf[0], row.cat], ['grade', inf && inf[1], row.grade], ['size', inf && inf[2], row.size]].filter((d) => d[1] !== d[2]).map((d) => d[0]);
      if (diff.length) warnings.push('new row ' + k + ' reads differently in the live materials.js (' + diff.join(', ') + ')');
    });
  } else warnings.push('no live engine sources (private/kc-src or qb/kc): the live list was not cross-checked');

  // list prices: the whole Standard Price List. Codes and prices are the Doc's (the sheet rows, the overrides' docPrices over them, the extra rows the sheet lacks);
  // the per-metre rate and the price status come from the sheet. One row per code: { code, price, perMetre | null, status, label, std }.
  const lp = ov.listPrices || {};
  const rows = {}, renamed = plain(ov.renamed) ? ov.renamed : {};
  const doc = plain(lp.docPrices) ? lp.docPrices : {}, drop = new Set(Array.isArray(lp.drop) ? lp.drop : []), extra = plain(lp.extra) ? lp.extra : {}, text = plain(lp.text) ? lp.text : {};
  let dropped = [];
  if (!DATE_RE.test(lp.effective || '')) fail('listPrices.effective is not a date (yyyy-mm-dd)');
  if (!sheet) fail('listPrices.csv is not set: the price list sheet is needed for the per-metre rates and the price status');
  const conflicts = [];
  const put = (code, price, perMetre, status, label, std, from) => {
    if (!CODE_RE.test(code)) return fail('list code is malformed: ' + code);
    if (!isNum(price) || price <= 0) return fail('list code has no price (' + from + '): ' + code);
    if (perMetre !== null && !(isNum(perMetre) && perMetre > 0)) return fail('list per-metre rate is not a number above 0 (' + from + '): ' + code);
    if (!STATUSES.includes(status)) return fail('list price status is not one of ' + STATUSES.join(', ') + ' (' + from + '): ' + code + ' has "' + status + '"');
    if (!isStr(label)) return fail('list code has no label (' + from + '): ' + code);
    rows[code] = { code, price, perMetre, status, label, std: typeof std === 'string' ? std : '' };
  };
  if (sheet) {
    for (const [code, r] of sheet) {
      if (drop.has(code)) { dropped.push(code); continue; }
      let price = r.price;
      if (isNum(doc[code])) { if (isNum(price) && price !== doc[code]) conflicts.push(code); price = doc[code]; }
      const t = plain(text[code]) ? text[code] : {};                              // the Doc's own wording, where the sheet reads differently
      put(code, price, r.perMetre, r.status, isStr(t.label) ? t.label : r.label, typeof t.std === 'string' ? t.std : r.std, 'the sheet and docPrices');
    }
    for (const code of drop) if (!sheet.has(code)) warnings.push('listPrices.drop names a code the sheet does not have: ' + code);
  }
  for (const [code, e] of Object.entries(extra)) {
    if (rows[code]) { fail('listPrices.extra repeats a code of the sheet: ' + code); continue; }
    put(code, doc[code], e && e.perMetre != null ? e.perMetre : null, e && e.status, e && e.label, e && e.std, 'extra and docPrices');
  }
  for (const code of Object.keys(text)) if (!rows[code]) fail('listPrices.text words a code that is not in the price list: ' + code);
  for (const code of Object.keys(doc)) if (!rows[code]) fail('listPrices.docPrices prices a code that is neither in the sheet nor in "extra": ' + code);
  if (conflicts.length) warnings.push('the Doc and the sheet disagree on the price of (the Doc wins): ' + conflicts.join(', '));
  if (dropped.length) warnings.push('left out (sheet only, dropped by the overrides): ' + dropped.join(', '));
  // the old prototype names of the renamed codes (addendum A2) must point at a priced code
  for (const [oldCode, newCode] of Object.entries(renamed)) if (!rows[newCode]) fail('renamed: ' + oldCode + ' -> ' + newCode + ' but ' + newCode + ' is not in the price list');
  const codeOf = (c) => renamed[c] || c;
  const known = new Map();                                  // chef LIST code -> the prototype's own price
  const stale = [];
  for (const f of chefFiles) {
    for (const r of f.rows) {
      if (f.label === 'prototype' && isNum(r.price)) known.set(r.code, r.price);
      if (r.formulaOnly || rows[r.code]) continue;
      if (renamed[r.code] && rows[renamed[r.code]]) { if (f.label !== 'prototype') stale.push(r.code + ' -> ' + renamed[r.code]); continue; }
      fail('list code has no price (' + f.label + '): ' + r.code);
    }
  }
  if (stale.length) warnings.push('the live product-chef.js still uses old list codes; rename them (addendum A2): ' + stale.join(', '));
  const differs = [...known].filter(([c, p]) => rows[codeOf(c)] && rows[codeOf(c)].price !== p).map(([c]) => c);
  if (differs.length) warnings.push('list price differs from the prototype LIST for: ' + differs.join(', '));
  if (!chefFiles.length) warnings.push('no product-chef.js found: the list codes were not cross-checked');

  // products
  const products = [], seen = new Set();
  (Array.isArray(ov.products) ? ov.products : []).forEach((p, i) => {
    const at = 'product row ' + (i + 1) + (p && p.sku ? ' (' + p.sku + ')' : '');
    if (!plain(p) || !isStr(p.sku) || !isStr(p.title) || !isNum(p.basePrice) || p.basePrice <= 0) return fail(at + ' lacks a sku, a title or a basePrice');
    if (!SKU_RE.test(p.sku)) fail(at + ': sku is malformed');
    if (seen.has(p.sku)) fail(at + ': sku is repeated');
    seen.add(p.sku);
    if (!isStr(p.category) || !/^[a-z_]+$/.test(p.category)) fail(at + ': category is missing or malformed');
    const row = { sku: p.sku, title: p.title, category: p.category, unit: p.unit || 'pc', formulaType: p.formulaType || 'fixed', basePrice: p.basePrice };
    if (p.measurement !== undefined) {
      const m = p.measurement;
      if (!plain(m) || !Object.keys(m).length || !Object.entries(m).every(([k, v]) => ['W', 'D', 'H'].includes(k) && isNum(v) && v > 0)) fail(at + ': measurement must be { W, D, H } in mm');
      else row.measurement = m;
    }
    if (p.specifications !== undefined) row.specifications = String(p.specifications);
    products.push(row);
  });
  if (Array.isArray(ov.products) === false) fail('overrides.products is not a list');

  const seed = {
    v: 1,
    made: new Date().toISOString(),
    settings,
    materials,
    listPrices: { effective: lp.effective, rows },
    products,
  };
  const bySource = {}, byStatus = {};
  Object.values(materials).forEach((m) => { bySource[m.source] = (bySource[m.source] || 0) + 1; });
  Object.values(rows).forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  return { seed, errors, warnings, counts: { materials: Object.keys(materials).length, newRows: newKeys.length, listPrices: Object.keys(rows).length, products: products.length, bySource, byStatus } };
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log('usage: node scripts/kc-seed-build.js [--private <dir>] [--overrides <file>] [--out <file>]'); return 0; }
  const privateDir = findPrivate(args.private);
  const seedDir = path.join(privateDir, 'kc-seed');
  let overridesFile = args.overrides ? path.resolve(args.overrides) : null;
  if (!overridesFile) {
    const found = fs.existsSync(seedDir) ? fs.readdirSync(seedDir).filter((f) => /^overrides-.*\.json$/.test(f)).sort() : [];
    if (!found.length) throw new Error('no overrides file: expected ' + path.join(seedDir, 'overrides-<date>.json') + ' (see private/kc-seed/README.md for its shape), or pass --overrides <file>');
    overridesFile = path.join(seedDir, found[found.length - 1]);
  }
  const outFile = path.resolve(args.out || path.join(seedDir, 'kc-seed.json'));
  assertSafeOut(outFile, privateDir);

  const ref = loadReference(privateDir);
  const ov = JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
  const live = loadLive(privateDir);
  const chefFiles = [];
  for (const [label, file] of [['prototype', path.join(privateDir, 'prototypes', 'qb-d7', 'kc', 'product-chef.js')], ['live', live && path.join(live.dir, 'product-chef.js')]]) {
    if (!file || !fs.existsSync(file)) continue;
    const rows = chefRows(fs.readFileSync(file, 'utf8'));
    if (rows) chefFiles.push({ label, rows });
  }
  const csvName = ov && ov.listPrices && ov.listPrices.csv;
  const csvFile = isStr(csvName) ? path.resolve(path.dirname(overridesFile), csvName) : null;
  if (csvFile && !fs.existsSync(csvFile)) throw new Error('the price list sheet is missing: ' + csvFile);
  const sheet = csvFile ? readSheet(csvFile) : null;

  const { seed, errors, warnings, counts } = build(ref, ov, chefFiles, live, sheet);
  console.log('kc-seed-build');
  console.log('  private    ' + privateDir);
  console.log('  overrides  ' + overridesFile);
  if (live) console.log('  engine     ' + live.dir);
  warnings.forEach((w) => console.log('  WARNING    ' + w));
  if (errors.length) {
    errors.forEach((e) => console.error('  FAIL       ' + e));
    console.error('  ' + errors.length + ' problem(s); nothing written.');
    return 1;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(seed, null, 2) + '\n');
  console.log('  materials  ' + counts.materials + ' (' + Object.entries(counts.bySource).map(([s, n]) => n + ' ' + s).join(', ') + '; ' + counts.newRows + ' new rows)');
  console.log('  list rows  ' + counts.listPrices + ' (' + Object.entries(counts.byStatus).map(([s, n]) => n + ' ' + s).join(', ') + '; effective ' + seed.listPrices.effective + ')');
  console.log('  products   ' + counts.products);
  console.log('  settings   1 (floor mode ' + seed.settings.floorMode + ')');
  console.log('  written    ' + outFile);
  return 0;
}

module.exports = { build, chefRows, loadKC, loadReference, loadLive, assertSafeOut, findPrivate };

if (require.main === module) {
  try { process.exitCode = main(); } catch (e) { console.error('kc-seed-build: ' + (e && e.message || e)); process.exitCode = 1; }
}
