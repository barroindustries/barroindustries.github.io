// tests/helpers/kc-vm.mjs: loads the Barro Kitchens configurator engine (qb/kc-rules.js and the BUNDLE qb/kc.min.js) into ONE vm context, the way the quote builder page loads
// them (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md section 4.2 and Addendum 1 A9), with a minimal window / document: createElement returns an inert object, head.appendChild
// does nothing, matchMedia says "no match", setTimeout never fires (so KC.boot() never runs). Nothing here draws a pixel.
// The engine sources are private (private/kc-src in the main checkout): CI and every test load the committed bundle, so nothing here needs them.
// opts.kcDir loads a folder of the twelve engine source files instead (only for tools that compare or mutate sources, never for a test that runs in CI).
//
// The engine is price-free (tests/kc-no-prices.test.mjs), so a test that needs prices applies the SYNTHETIC fixture (tests/fixtures/kc-prices.fixture.json: made-up numbers,
// obviously not real) with applyFixture(). Every call to loadEngine() makes a fresh context, so no test can leave state behind for another.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const BUNDLE_FILE = path.join(ROOT, 'qb', 'kc.min.js');
export const RULES_FILE = path.join(ROOT, 'qb', 'kc-rules.js');
export const FIXTURE_FILE = path.join(ROOT, 'tests', 'fixtures', 'kc-prices.fixture.json');
export const GOLDEN_FILE = path.join(ROOT, 'tests', 'fixtures', 'kc-golden.json');

// the engine source files, in the load order of the page loader (spec 4.2): the order of the bundle. The bridge files (host-d7.js, admin-d7.js, the d7/ files) are not part of it.
export const ENGINE_FILES = ['core.js', 'materials.js', 'library.js', 'draw-table.js', 'product-table.js', 'product-sink.js', 'product-hood.js', 'product-duct.js',
  'product-storage.js', 'product-cart.js', 'draw-chef.js', 'product-chef.js'];

/**
 * Load the engine into a new context.
 * opts.bundle / opts.rulesFile               the bundle and the rules file to load (defaults: the repository's qb/kc.min.js and qb/kc-rules.js); a mutation test passes a scratch copy
 * opts.kcDir / opts.files                     load the engine SOURCE files from a folder instead of the bundle (tools only)
 * opts.rules=false                            do not load kc-rules.js (to show the engine needs it)
 * opts.transform(name, text)                  rewrite a file's text before it runs (used only by tests that prove a rule is one copy)
 * returns { KC, KCRules, ctx, logs }          logs = the console.warn / console.error lines the engine wrote
 */
export function loadEngine(opts = {}) {
  const { kcDir = null, bundle = BUNDLE_FILE, rulesFile = RULES_FILE, files = ENGINE_FILES, rules = true, transform = null } = opts;
  const logs = [];
  const inert = () => ({ style: {}, dataset: {}, children: [], setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, textContent: '', innerHTML: '' });
  const sandbox = {
    document: { readyState: 'complete', createElement: inert, head: { appendChild() {} }, body: { appendChild() {}, dataset: {} }, addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    console: { log() {}, info() {}, debug() {}, warn: (...a) => logs.push(['warn', ...a]), error: (...a) => logs.push(['error', ...a]) },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const run = (file, name) => {
    let text = fs.readFileSync(file, 'utf8');
    if (transform) text = transform(name, text);
    vm.runInContext(text, ctx, { filename: file });
  };
  if (rules) run(rulesFile, 'kc-rules.js');
  if (kcDir) for (const f of files) run(path.join(kcDir, f), f);
  else run(bundle, 'kc.min.js');
  return { KC: sandbox.KC, KCRules: sandbox.KCRules, ctx, logs };
}

export function loadFixture(file = FIXTURE_FILE) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/** apply the synthetic price fixture: material prices, the Standard Price List, the corner charge (and the cornerc row that follows it) */
export function applyFixture(KC, fx = loadFixture()) {
  for (const [k, p] of Object.entries(fx.materials)) {
    if (!KC.P[k]) throw new Error('kc-vm: the fixture prices a material the engine does not have: ' + k);
    KC.P[k].p = p;
  }
  Object.assign(KC.LISTP, fx.listPrices);
  KC.SET.corner = fx.corner;
  if (KC.P.cornerc) KC.P.cornerc.p = fx.corner;
  return KC;
}

/** a fresh engine with the fixture applied */
export function loadPricedEngine(opts = {}) {
  const e = loadEngine(opts);
  applyFixture(e.KC, opts.fixture || loadFixture());
  return e;
}

const r2 = n => Math.round(n * 100) / 100;

/**
 * Every product and every start pill, priced: { productId: { startId: { M, projectCost, selling, unit, priced, missing, listAdj? } } }  (money to 2 decimals).
 * This is the shape of tests/fixtures/kc-golden.json.
 */
export function snapshotStarts(KC) {
  const out = {};
  for (const def of KC.productList()) {
    out[def.id] = {};
    for (const st of def.starts) {
      const r = KC.price(def.id, def.startCfg(st.id));
      const row = { M: r2(r.M), projectCost: r2(r.projectCost), selling: r2(r.selling), unit: r.unit, priced: r.priced, missing: r.missing.length };
      if (r.list) row.listAdj = r2(r.list.adj);
      out[def.id][st.id] = row;
    }
  }
  return out;
}
