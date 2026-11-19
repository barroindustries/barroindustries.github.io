// tests/kc-builder-port.test.mjs — the Barro Kitchens configurators in the LIVE quote builder, the page side (packet A of specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md).
//
// quote-builder-v2.html carries the D7 prototype's edits (marked D7:E<n> / D7:R4) and the live-only edits (marked KC:L<n>) behind ONE gate:
//     d7On() = the layer is loaded and complete (D7.live) && the quote's engine stamp is 'kc1' && not Brilliant Steel && not a quotation "as issued".
// With the stamp 'legacy' (the office switch off, qb/ missing or broken, Brilliant Steel, every quote, draft and template made before the switch) the page runs the code that ran before.
//
//   1. STATIC     the file itself: the shim before every other statement, the four conditions of d7On(), the engine stamp in the four places the spec names, the storage keys still bkqb_*, no D7.post(), every
//                 window.parent.postMessage and both window.parent===window guards kept, the products-database.json fallback kept, every direct D7.pricing call behind d7On() &&, the Workforce Copy rules
//                 still addressing columns 5 and 6 and the KC table still seven columns, the second loader (and that the first one, pinned by tests/lazy-script-versioning.test.mjs, is untouched), the tutorial
//                 (TUTORIAL_VERSION 51: Q70 took 50 first) and every TOUR_STEPS target, and the two words no document of ours may carry.
//   2. BEHAVIOUR the real inline script in a node:vm context against a small DOM stub: the engine stamp across every state-load path, the blank-quote adoption, the Brilliant Steel guard, the sections of a
//                 KC line, the header and the PDF name, the cost sidecar, the approval wiring, whole pesos in legacy / centavos in KC mode, and that a legacy quote never reaches a KC hook that could change a price.
//
// This file states no peso figure (tests/kc-no-prices.test.mjs scans it): the currency sign is built from its code point and every amount is a bare number.
// Mutation-tested in a scratch copy of the page (each must fail here): the shim moved after `const CO`; d7On() without its D7.live / quoteEngine / BS / as-issued condition; the engine missing from
// getPricingFields / applyPricingFields / the clearForm defaults / kept by stripTemplateState; the early stamp missing from a loader; `engine` deleted from a template; the Brilliant Steel guard removed;
// kcAdoptEngineIfBlank adopting over lines / a reopen source; a direct D7.pricing call without d7On() &&; formatPeso in centavos for legacy; the thead rewritten in legacy; D7.post back in.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'quote-builder-v2.html'), 'utf8');
const SCRIPT = (HTML.match(/<script>\n([\s\S]*?)<\/script>/) || [])[1];
assert.ok(SCRIPT && SCRIPT.length > 100000, 'could not find the builder\'s inline <script>');
const PESO = '₱';                                   // the currency sign, from its code point (this file must hold no sign-and-digit)
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const fnSource = (name) => { const i = SCRIPT.indexOf(`function ${name}(`); assert.ok(i >= 0, `function ${name} not found`); let d = 0, j = SCRIPT.indexOf('{', i); const s = j; for (; j < SCRIPT.length; j++) { if (SCRIPT[j] === '{') d++; else if (SCRIPT[j] === '}' && --d === 0) break; } return SCRIPT.slice(i, j + 1) + ''.padEnd(0, s + ''); };

// ═══════════════════════════════════════════════ 1. STATIC ═══════════════════════════════════════════════
describe('the page — static: the loaders, the shim, the gate, the stamp, what was kept', () => {
  it('the first loader is untouched (the seven js/ files, in order); the second loader writes the three stylesheets and the scripts of spec 4.2 as changed by Addendum 1 (ONE minified engine file, qb/kc.min.js, not the 12 engine files; js/forms-pdf.js), with the same ?v= rule', () => {
    const first = (HTML.match(/<script>(\(function\(\)\{var v=new URLSearchParams[^\n]*?)<\/script>\n/) || [])[1];
    assert.ok(first && first.includes("'js/firebase-config.js'") && first.includes("'js/qb-spec-sheet.js'"), 'the regex of tests/lazy-script-versioning.test.mjs must still find the FIRST loader');
    assert.equal(first.includes('forms-pdf') || first.includes('qb/'), false, 'the first loader (pinned by tests/lazy-script-versioning.test.mjs) is untouched');
    const at = HTML.indexOf('<script>/* kc */(function(){');
    assert.ok(at > HTML.indexOf(first) && at < HTML.indexOf('<script>\n'), 'the second loader sits between the first loader and the main inline script');
    const loader = HTML.slice(at + '<script>'.length, HTML.indexOf('</script>', at));
    const run = (search) => { const written = []; vm.runInNewContext(loader, { location: { search }, URLSearchParams, document: { write: (h) => written.push(h) } }); return written; };
    const CSS = ['qb/kc/kc-d7.css', 'qb/d7/d7-doc.css', 'qb/d7/d7-flow.css'];
    const JS = ['qb/kc-rules.js', 'js/forms-pdf.js', 'qb/d7/d7-core.js', 'qb/kc.min.js', 'qb/kc/host-d7.js', 'qb/d7/d7-pricing.js', 'qb/d7/d7-doc.js', 'qb/d7/d7-adapter.js', 'qb/kc/admin-d7.js', 'qb/d7/d7-flow.js', 'qb/kc-live.js'];
    const want = (q) => [...CSS.map((f) => `<link rel="stylesheet" href="${f}${q}">`), ...JS.map((f) => `<script defer src="${f}${q}"></script>`)];
    assert.deepEqual(run('?v=14.0.999&co=BS'), want('?v=14.0.999'));
    assert.deepEqual(run(''), want(''));
    assert.deepEqual(run('?v=%22%3E%3Cimg'), want(''), 'a non-version value is refused');
    assert.equal(JS[JS.length - 1], 'qb/kc-live.js', 'kc-live.js is the last script: it sets D7.live only when every piece is there');
    assert.ok(JS.indexOf('qb/kc-rules.js') < JS.indexOf('qb/kc.min.js') && JS.indexOf('qb/d7/d7-core.js') < JS.indexOf('qb/kc.min.js') && JS.indexOf('qb/kc.min.js') < JS.indexOf('qb/kc/host-d7.js'), 'the engine file comes after the rules and the core, before the host');
    for (const gone of ['core', 'materials', 'library', 'draw-table', 'draw-chef', 'product-table', 'product-sink', 'product-hood', 'product-duct', 'product-storage', 'product-cart', 'product-chef']) {
      assert.equal(loader.includes(`qb/kc/${gone}.js`), false, `qb/kc/${gone}.js is part of the bundle now: the build logic is not committed as sources (Addendum 1, A9)`);
    }
    assert.ok(!/<script defer src="(js|qb)\//.test(HTML), 'a local script tag is back outside the loaders (it would load unversioned; tests/lazy-script-versioning.test.mjs forbids it)');
    assert.ok(!/<link rel="stylesheet" href="(kc|d7|qb)\//.test(HTML), 'a stylesheet tag outside the loader');
  });

  it('js/forms-pdf.js (the Sales flow\'s form engine, merged later) is a plain deferred script of the kc loader: the tag is written with the ?v= rule, and the page does not depend on it (a missing file is a 404, nothing else: nothing in the page reads window.FormsPdf)', () => {
    const at = HTML.indexOf('<script>/* kc */(function(){');
    const loader = HTML.slice(at + '<script>'.length, HTML.indexOf('</script>', at));
    const written = (search) => { const w = []; vm.runInNewContext(loader, { location: { search }, URLSearchParams, document: { write: (h) => w.push(h) } }); return w; };
    assert.ok(written('').includes('<script defer src="js/forms-pdf.js"></script>'), 'the tag exists: <script defer src="js/forms-pdf.js"></script>');
    assert.ok(written('?v=14.0.999').includes('<script defer src="js/forms-pdf.js?v=14.0.999"></script>'), 'and carries the app version like every local script');
    assert.equal(written('').filter((h) => h.includes('forms-pdf')).length, 1, 'once');
    assert.equal(/window\.FormsPdf|\bFormsPdf\b/.test(stripComments(SCRIPT)), false, 'the page itself never touches window.FormsPdf: only the bridge does, behind a guard');
    assert.equal(/<script defer src="js\/forms-pdf/.test(HTML), false, 'no literal tag outside the loader (tests/lazy-script-versioning.test.mjs forbids one)');
  });

  it('the shim precedes every other statement of the main script: window.D7, D7.h / D7.has returning nothing, the five namespaces — and D7.live is NOT created (it is the flag d7On() reads)', () => {
    const code = stripComments(SCRIPT).replace(/^\s+/, '');
    assert.ok(code.startsWith('window.D7 = window.D7 || {};'), 'the first statement of the main script is the shim');
    const head = code.slice(0, code.indexOf('const CO = {'));
    assert.equal(head.replace(/\s+/g, ' ').trim(), "window.D7 = window.D7 || {}; if(!D7.h){ D7.h=function(){ return ''; }; D7.has=function(){ return false; }; } ['adapter','pricing','doc','flow','core'].forEach(function(k){ D7[k]=D7[k]||{}; });");
    assert.equal(/D7\.live\s*=/.test(head) || /['"]live['"]/.test(head), false, 'the shim must not make D7.live truthy: a quote stamped kc1 must fall back to the old layout when the qb/ files are missing');
  });

  it('d7On() has the four conditions: the layer is live (D7.live), the engine is kc1, the company is not Brilliant Steel, the quote is not "as issued"', () => {
    const f = stripComments(fnSource('d7On'));
    assert.ok(/D7\.live/.test(f) && /quoteEngine\s*===\s*'kc1'/.test(f) && /currentCo\s*!==\s*'BS'/.test(f) && /!isLegacyDoc\(\)/.test(f), f);
    assert.equal((f.match(/&&/g) || []).length, 4, 'four conditions, joined by &&: (window.D7 && D7.live) && kc1 && not BS && not as issued');
    assert.match(SCRIPT, /let quoteEngine='legacy';/);
    assert.match(fnSource('kcDefaultEngine'), /KCLive\.allowsNew/);
  });

  it('the engine rides the pricing fields: written by getPricingFields, read first by applyPricingFields, in the clearForm defaults; a template keeps it and drops the approval carry; the three loaders stamp it before setCompany()', () => {
    assert.match(fnSource('getPricingFields'), /o\.engine=quoteEngine;/);
    assert.match(fnSource('getPricingFields'), /o\.approvalCarry=/);
    const ap = fnSource('applyPricingFields');
    assert.ok(ap.indexOf("quoteEngine = (o && o.engine==='kc1') ? 'kc1' : 'legacy';") > 0 && ap.indexOf("quoteEngine = (o && o.engine==='kc1')") < ap.indexOf('_msStash = null'), 'the stamp comes before anything else in applyPricingFields');
    assert.match(ap, /D7\.h\('live\.setCarry'/);
    const cf = fnSource('clearForm');
    assert.match(cf, /const _eng=kcDefaultEngine\(\);/);
    assert.match(cf, /applyPricingFields\(\{engine:_eng,/);
    const st = fnSource('stripTemplateState');
    assert.match(st, /delete pr\.approvalCarry;/);
    assert.equal(/delete pr\.engine/.test(st), false, 'a template keeps the engine it was saved with');
    for (const fn of ['loadEditableState', 'resumeDraft', 'loadFromStorage']) {
      const s = fnSource(fn);
      assert.ok(/kcStampEngine\(/.test(s), `${fn} stamps the engine of the state it loads`);
      assert.ok(s.indexOf('kcStampEngine(') < s.indexOf('normalizeLoadedItems('), `${fn}: before the lines are normalised`);
      assert.ok(s.indexOf('kcStampEngine(') < s.indexOf('setCompany('), `${fn}: before setCompany() re-renders the lines`);
    }
  });

  it('storage keys stay bkqb_*, nothing posts through D7, every window.parent.postMessage and both window.parent===window guards are as they were, the products-database.json fallback is kept', () => {
    assert.equal(/d7qb/.test(HTML), false, 'no d7qb_ string anywhere');
    assert.equal(/D7\.post\(|D7\.reply\(|D7\.onPost\(/.test(SCRIPT), false, 'the page never talks to a local parent');
    const code = stripComments(SCRIPT);
    assert.ok((code.match(/window\.parent\.postMessage\(/g) || []).length >= 10, 'every outbound message goes through window.parent.postMessage (ten of them, as before)');
    for (const type of ['QB_READY', 'QUOTE_FILED', 'QUOTE_UPDATE', 'QUOTE_APPROVAL_REQUESTED', 'QUOTE_DRAFT', 'QUOTE_SAVE_DRAFT', 'QUOTE_SAVE_TEMPLATE', 'QUOTE_REQUEST_TEMPLATES', 'QUOTE_STATE', 'QB_OPEN_SOURCE']) {
      assert.ok(new RegExp(`window\\.parent\\.postMessage\\(\\s*\\{\\s*type:'${type}'`).test(SCRIPT), `${type} is posted with window.parent.postMessage`);
    }
    assert.equal((code.match(/window\.parent\s*===\s*window/g) || []).length, 2, 'both "open the builder from the app" guards');
    assert.match(SCRIPT, /fetch\('products-database\.json'/, 'the live fallback to products-database.json is still there');
    assert.match(SCRIPT, /localStorage\.setItem\('bkqb_items'/);
    assert.match(SCRIPT, /'qbTutSeenVer'/);
    assert.ok(/window\.addEventListener\('message',ev=>\{[\s\S]*?if\(ev\.origin!==window\.location\.origin\) return;\s*qbOnMessage\(ev\.data\|\|\{\}\);/.test(SCRIPT), 'the message listener keeps its origin pin and hands the body to qbOnMessage');
    assert.equal(/<meta http-equiv="Content-Security-Policy"/.test(HTML), false, 'no CSP tag: the page never had one and gets none');
    assert.equal(/Quote Builder \(D7 prototype\)/.test(HTML), false);
  });

  it('every direct D7.pricing.<fn> call sits behind d7On() && D7.pricing && … (a legacy quote never reaches the KC price engine)', () => {
    const code = stripComments(SCRIPT);
    const calls = [...code.matchAll(/D7\.pricing\.(\w+)\s*\(/g)];
    assert.ok(calls.length >= 8, `expected the eight direct calls, found ${calls.length}`);
    for (const m of calls) {
      const before = code.slice(Math.max(0, m.index - 140), m.index);
      assert.ok(/d7On\(\)\s*&&\s*D7\.pricing\s*&&\s*D7\.pricing\.\w+\s*\)?\s*(return\s*)?$/.test(before) || /d7On\(\)\s*&&\s*D7\.pricing\s*&&\s*D7\.pricing\.\w+\)\s*return\s*$/.test(before), `D7.pricing.${m[1]}( is not behind d7On() && D7.pricing && D7.pricing.${m[1]}`);
    }
    assert.deepEqual([...new Set(calls.map((m) => m[1]))].sort(), ['apply', 'customHasBasis', 'miscMult', 'needsPriceReason', 'panelHtml', 'resetPrices', 'trueCost', 'uncostedReason']);
  });

  it('the Workforce Copy still hides columns 5 and 6 by position, and the table is seven columns in both layouts (the KC header has seven <th>, the page\'s own header seven too)', () => {
    for (const sel of ['th:nth-child(5)', 'td:nth-child(5)', 'th:nth-child(6)', 'td:nth-child(6)']) assert.ok(HTML.includes(`body.body-workforce .items-table ${sel}`), `the Workforce Copy rule for ${sel}`);
    const th = (HTML.match(/th\.innerHTML=`<tr>(.*?)<\/tr>`;/) || [])[1];
    assert.ok(th, 'the KC header template');
    assert.equal((th.match(/<th\b/g) || []).length, 7, 'seven <th> in the KC header');
    const legacy = (HTML.match(/<thead id="itemsThead">([\s\S]*?)<\/thead>/) || [])[1];
    assert.equal((legacy.match(/<th\b/g) || []).length, 7, 'seven <th> in the page\'s own header');
    assert.match(th, /c-no[\s\S]*c-ph[\s\S]*c-desc[\s\S]*c-qty[\s\S]*c-up[\s\S]*c-amt[\s\S]*c-act/);
    assert.ok(HTML.includes('<div class="cat-tabs" id="catTabs">\n    <button class="cat-tab active" onclick="filterCat(\'all\',this)"'), 'the ten legacy tab buttons are in the HTML, not drawn by script');
    assert.equal((HTML.match(/<div class="cat-tabs" id="catTabs">[\s\S]*?<\/div>/)[0].match(/<button/g) || []).length, 10);
  });

  it('the tutorial (repo contract): TUTORIAL_VERSION 51 (Q70 shipped 50 first), What\'s New 51 on top in plain words, Help has the Configurators section and the device row, every TOUR_STEPS target resolves', () => {
    assert.match(SCRIPT, /const TUTORIAL_VERSION = 51;/);
    const wn = new Function(`${SCRIPT.slice(SCRIPT.indexOf('const WHATS_NEW = ['), SCRIPT.indexOf('\n];', SCRIPT.indexOf('const WHATS_NEW = [')) + 3)}\nreturn WHATS_NEW;`)();
    assert.equal(wn[0].ver, 51);
    assert.equal(wn[1].ver, 50, 'the Q70 entry stays as history');
    assert.equal(wn[0].date, '2026-11-20');
    assert.ok(/Quotes, drafts and templates made before today open and price exactly as before/.test(wn[0].items.join(' ')));
    const helpKc = (HTML.match(/<div class="d7-only" id="helpKcSection">[\s\S]*?<\/div>/) || [''])[0];
    assert.ok(helpKc.length > 1500 && /<h4>Configurators<\/h4>/.test(helpKc), 'Help carries the Configurators section');
    assert.equal(/prototype/i.test(helpKc + wn[0].items.join(' ')), false, 'no "prototype" in the user words');
    assert.equal(/\d\s*pesos|\bpesos?\b/i.test(helpKc + wn[0].items.join(' ')), false);
    assert.ok(HTML.includes('id="helpKcDevice"') && HTML.includes('id="kcDeviceSel"') && /value="office">Follow the office setting</.test(HTML) && /value="off">Off</.test(HTML), 'the "Configurators on this device" row');
    const steps = vm.runInNewContext(`${SCRIPT.slice(SCRIPT.indexOf('const TOUR_STEPS = ['), SCRIPT.indexOf('\n];\n', SCRIPT.indexOf('const TOUR_STEPS = [')) + 3)}\nTOUR_STEPS`, {});
    for (const s of steps.filter((x) => x.target)) {
      const idm = /^#([A-Za-z][\w-]*)$/.exec(s.target), cm = /^\.([A-Za-z][\w-]*)$/.exec(s.target);
      if (idm) assert.ok(new RegExp(`id="${idm[1]}"`).test(HTML), `${s.target} has no id in the file`);
      else if (cm) assert.ok(new RegExp(`class="[^"]*\\b${cm[1]}\\b`).test(HTML), `${s.target} has no class in the file`);
      else assert.fail(`unrecognised selector ${s.target}`);
    }
    const cards = steps.find((s) => s.target === '#d7Cards');
    assert.ok(cards && cards.needsContent === true && cards.kcOnly === true && cards.needsWorkspace === true, 'the #d7Cards step keeps needsContent and is KC-only');
    const cfg = steps.find((s) => s.target === '#configPanel');
    assert.equal(cfg.legacyOnly, true, 'the website-family configurator step is skipped in KC mode');
    assert.equal(steps.filter((s) => s.kcBody).length, 7, 'seven steps have a KC wording');
    assert.equal(steps.some((s) => /prototype/i.test(`${s.title} ${s.body} ${s.kcBody || ''}`)), false);
    assert.equal(steps.length, 21, 'the 20 legacy steps plus the one KC-only step');
  });

  it('the two words no document of ours may carry are in neither the page nor qb/: "Official Receipt", "Sales Invoice"', () => {
    const files = [path.join(ROOT, 'quote-builder-v2.html')];
    const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|css|html)$/.test(e.name)) files.push(p); } };
    walk(path.join(ROOT, 'qb'));
    for (const f of files) assert.equal(/Official Receipt|Sales Invoice/i.test(fs.readFileSync(f, 'utf8')), false, `${path.relative(ROOT, f)} carries a forbidden document title`);
  });
});

// ═══════════════════════════════════════════════ 2. BEHAVIOUR ═══════════════════════════════════════════════
const PF = require('../js/product-families.js');
const FAM = require('../js/qr-families.js');
const PC = require('../js/pricing-core.js');
const QB = require('../js/qb-configured.js');
const QS = require('../js/qb-spec-sheet.js');
const COMPILED = new vm.Script(SCRIPT, { filename: 'quote-builder-v2.html<script>' });

function makeEnv() {
  const els = new Map(), posted = [], listeners = { window: {}, document: {} }, store = new Map();
  const classList = () => { const s = new Set(); return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); return on; }, contains: (c) => s.has(c) }; };
  const mkEl = (id) => ({ id, value: '', checked: false, innerHTML: '', textContent: '', innerText: '', disabled: false, hidden: false, type: '', title: '', min: '', max: '', style: {}, dataset: {}, className: '', options: [], children: [], parentElement: null, offsetParent: {}, scrollTop: 0,
    classList: classList(), addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, appendChild(c) { return c; }, insertBefore(c) { return c; }, insertAdjacentElement() {}, setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, remove() {},
    focus() {}, blur() {}, click() {}, scrollIntoView() {}, closest() { return null; }, contains() { return false; }, querySelector() { return null; }, querySelectorAll() { return []; }, cloneNode() { return mkEl(id + '-clone'); },
    getBoundingClientRect() { return { width: 100, height: 20, left: 0, top: 0, right: 100, bottom: 20 }; }, getClientRects() { return [{}]; } });
  const el = (id) => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); };
  const body = mkEl('body');
  const document = { getElementById: el, body, head: mkEl('head'), documentElement: mkEl('html'), activeElement: body, createElement: (tag) => mkEl('new-' + tag), createDocumentFragment: () => mkEl('frag'),
    addEventListener: (t, fn) => { (listeners.document[t] = listeners.document[t] || []).push(fn); }, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], contains: () => true };
  const win = { document, location: { search: '', protocol: 'http:', hash: '', origin: 'http://localhost' }, navigator: { maxTouchPoints: 0, userAgent: 'node' },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
    console, URLSearchParams, setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; }, clearTimeout, requestAnimationFrame: (f) => { const t = setTimeout(f, 0); if (t && t.unref) t.unref(); return t; },
    matchMedia: () => ({ matches: false }), confirm: () => true, prompt: () => null, alert() {}, addEventListener: (t, fn) => { (listeners.window[t] = listeners.window[t] || []).push(fn); }, removeEventListener() {}, print() {}, parent: null,
    Event: class { constructor(type) { this.type = type; } } };
  win.window = win; win.self = win; win.parent = { postMessage: (msg, origin) => posted.push({ msg, origin }) };
  win.ProductFamilies = PF; win.QR_FAMILIES = FAM; win.PricingCore = PC; win.QBConfigured = QB; win.QBSpecSheet = QS;
  const ctx = vm.createContext(win);
  COMPILED.runInContext(ctx);
  const run = (code) => vm.runInContext(code, ctx);
  el('warrantyPlan').value = 'service6'; el('showStandardPage').checked = true;
  el('dpMode').options = [{ value: '10' }, { value: '50' }, { value: '60' }, { value: '65' }, { value: 'custom' }]; el('dpMode').value = '50';
  // the KC layer, as a recorder: D7.h(name, ...args) logs the call and answers from `answers`; D7.live is the flag
  run(`globalThis.__calls = []; globalThis.__answers = {};
       D7.h = function (name) { var a = Array.prototype.slice.call(arguments, 1); __calls.push([name].concat(a)); var r = __answers[name]; return typeof r === 'function' ? r.apply(null, a) : (r == null ? '' : r); };
       D7.has = function (name) { return Object.prototype.hasOwnProperty.call(__answers, name); };
       D7.TABS = [{id:'prep',label:'Prep and storage'},{id:'wash',label:'Washing'},{id:'cook',label:'Cooking'},{id:'vent',label:'Ventilation'},{id:'cold',label:'Refrigeration'},{id:'multi',label:'Multi-purpose'},{id:'mech',label:'Mechanical Systems'}];
       D7.sectionFor = function (p) { return 'prep'; }; D7.tabOfProduct = function (p) { return 'prep'; };`);
  const kc = (on = true) => run(`D7.live = ${on ? 'true' : 'false'}; quoteEngine = ${on ? "'kc1'" : "'legacy'"};`);
  return { ctx, run, el, posted, store, kc, calls: () => run('__calls').map((c) => c.slice()), clear: () => run('__calls.length = 0'), answer: (n, v) => run(`__answers[${JSON.stringify(n)}] = ${typeof v === 'function' ? v.toString() : JSON.stringify(v)};`), plain: (code) => JSON.parse(JSON.stringify(vm.runInContext(code, ctx) ?? null)) };
}
const catalogueLine = (over = {}) => ({ id: 'PW-001', category: 'prep_washing', name: 'Table', dims: '900 x 600', specs: [], specEdit: '', qty: 2, unit: 'pc', unitPrice: 4217.5, amount: 8435, formulaType: 'per_length', priceBasis: 'manual', priceManual: true, ...over });
const kcLine = (over = {}) => ({ id: 'KC', kcKind: 'chef_hp', kcId: 'K1', kcStart: 'hp4', kcVer: 1, category: 'cook', name: 'Chef Mode stove', dims: '1000 x 800', specs: [], specEdit: '', qty: 1, unit: 'pc', unitPrice: 26000, amount: 26000, formulaType: 'configurable', priceBasis: 'configured', ...over });

describe('the engine stamp: a state with no engine is legacy; kc1 only where the layer is live, the company is not Brilliant Steel and the quote is not "as issued"', () => {
  it('d7On(): false without D7.live whatever the stamp says (qb/ missing or broken); true only for kc1 on BK / BI; false on Brilliant Steel and on a quotation "as issued"', () => {
    const b = makeEnv();
    assert.equal(b.run('quoteEngine'), 'legacy');
    assert.equal(b.run('d7On()'), false);
    b.run("quoteEngine = 'kc1'");
    assert.equal(b.run('d7On()'), false, 'kc1 without the layer: the old layout (spec 2.2, 6.5 step 12)');
    b.run('D7.live = true');
    assert.equal(b.run('d7On()'), true);
    b.run("currentCo = 'BI'"); assert.equal(b.run('d7On()'), true, 'Barro Industries follows the new rules too');
    b.run("currentCo = 'BS'"); assert.equal(b.run('d7On()'), false, 'Brilliant Steel never enters KC mode');
    b.run("currentCo = 'BK'"); b.el('warrantyPlan').value = ''; assert.equal(b.run('d7On()'), false, 'a quotation as issued keeps its old rules');
    b.el('warrantyPlan').value = 'service6'; b.run("quoteEngine = 'legacy'"); assert.equal(b.run('d7On()'), false);
  });

  it('applyPricingFields: engine kc1 -> kc1; no engine, an unknown engine, an empty state, null -> legacy; the approval carry goes to the live layer (null clears it)', () => {
    const b = makeEnv(); b.kc(false);
    b.run("applyPricingFields({ engine: 'kc1', approvalCarry: { lastApprovedNet: 7 } })");
    assert.equal(b.run('quoteEngine'), 'kc1');
    const j = (x) => JSON.parse(JSON.stringify(x));
    assert.deepEqual(j(b.calls().filter((c) => c[0] === 'live.setCarry').pop()), ['live.setCarry', { lastApprovedNet: 7 }]);
    for (const state of ['{}', "{ engine: 'legacy' }", "{ engine: 'kc2' }", "{ engine: 'KC1' }", 'null', 'undefined']) {
      b.run("quoteEngine = 'kc1'"); b.clear();
      b.run(`applyPricingFields(${state})`);
      assert.equal(b.run('quoteEngine'), 'legacy', `${state} is a legacy state`);
      assert.deepEqual(j(b.calls().filter((c) => c[0] === 'live.setCarry').pop()), ['live.setCarry', null], `${state} clears the carry`);
    }
  });

  it('getPricingFields: the stamp rides every save; a legacy quote gets engine "legacy" and a null carry and none of the KC fields; a KC quote adds photoCol, the markup and the carry', () => {
    const b = makeEnv();
    const lg = b.plain('getPricingFields()');
    assert.equal(lg.engine, 'legacy'); assert.equal(lg.approvalCarry, null);
    for (const k of ['photoCol', 'markupOvr']) assert.equal(k in lg, false, `${k} is KC-only`);
    b.answer('live.carry', { lastApprovedNet: 9 }); b.answer('pricing.fields', { markupOvr: 1.5 }); b.el('d7PhotoCol').checked = false;
    assert.equal(b.plain('getPricingFields()').approvalCarry, null, 'a legacy quote never carries an approval, whatever the layer answers');
    b.kc(true);
    const kc = b.plain('getPricingFields()');
    assert.equal(kc.engine, 'kc1'); assert.equal(kc.photoCol, false); assert.equal(kc.markupOvr, 1.5); assert.deepEqual(kc.approvalCarry, { lastApprovedNet: 9 });
  });

  it('every state-load path takes the engine of the state it loads BEFORE anything is drawn: a reopen (LOAD_QUOTE), a template, a #quote= link, a resumed draft — a kc1 quote opens in KC mode even with the device switched off, a legacy one never does', () => {
    const states = { kc: { items: [kcLine()], currentCo: 'BK', pricing: { engine: 'kc1', warrantyPlan: 'service6' }, sourceDocId: 'd1', sourceCollection: 'bk_quotes' }, lg: { items: [catalogueLine()], currentCo: 'BK', pricing: { warrantyPlan: 'service6' }, sourceDocId: 'd2', sourceCollection: 'bk_quotes' } };
    for (const via of ['LOAD_QUOTE', 'LOAD_TEMPLATE']) {
      const b = makeEnv(); b.run('D7.live = true');
      b.answer('live.afterLoad', 1);
      const msg = (s) => via === 'LOAD_QUOTE' ? { type: via, payload: { editableState: s } } : { type: via, payload: { state: s } };
      b.run(`qbOnMessage(${JSON.stringify(msg(states.kc))})`);
      assert.equal(b.run('quoteEngine'), 'kc1', `${via}: a kc1 state`); assert.equal(b.run('items.length'), 1);
      assert.ok(b.calls().some((c) => c[0] === 'live.afterLoad'), `${via}: the live layer is told`);
      b.clear();
      b.run(`qbOnMessage(${JSON.stringify(msg(states.lg))})`);
      assert.equal(b.run('quoteEngine'), 'legacy', `${via}: a legacy state over a kc1 quote`);
      assert.equal(b.calls().some((c) => c[0] === 'live.afterLoad'), false, `${via}: a legacy quote is never handed to the live layer`);
    }
    // the early stamp: the engine is the state's when setCompany() draws the lines (it used to be the previous quote's)
    const b = makeEnv(); b.run('D7.live = true; quoteEngine = "legacy"');
    b.run('globalThis.__engineAtDraw = []; const __rI = renderItems; renderItems = function () { __engineAtDraw.push(quoteEngine); return __rI.apply(this, arguments); };');
    b.run(`loadEditableState(${JSON.stringify(states.kc)}, {})`);
    assert.ok(b.plain('__engineAtDraw').length > 0 && b.plain('__engineAtDraw').every((e) => e === 'kc1'), 'every render of a kc1 state saw kc1: ' + b.run('JSON.stringify(__engineAtDraw)'));
    const h = makeEnv(); h.run('D7.live = true; quoteEngine = "kc1"');
    h.run('globalThis.__engineAtDraw = []; const __rI = renderItems; renderItems = function () { __engineAtDraw.push(quoteEngine); return __rI.apply(this, arguments); };');
    h.run(`loadEditableState(${JSON.stringify(states.lg)}, {})`);
    assert.ok(h.plain('__engineAtDraw').length > 0 && h.plain('__engineAtDraw').every((e) => e === 'legacy'), 'every render of a legacy state saw legacy: ' + h.run('JSON.stringify(__engineAtDraw)'));
    // a #quote= link and a resumed draft
    const l = makeEnv(); l.run('D7.live = true'); l.ctx.location.hash = '#quote=' + Buffer.from(encodeURIComponent(JSON.stringify(states.kc))).toString('base64'); l.ctx.atob = (s) => Buffer.from(s, 'base64').toString('binary');
    l.run('loadFromStorage()'); assert.equal(l.run('quoteEngine'), 'kc1', 'a #quote= link');
    const r = makeEnv(); r.run('D7.live = true; _draftSnapshot = ' + JSON.stringify({ client: { currentCo: 'BK' }, items: [kcLine()], pricing: { engine: 'kc1', warrantyPlan: 'service6' } }) + '; resumeDraft()');
    assert.equal(r.run('quoteEngine'), 'kc1', 'a resumed draft');
  });

  it('clearForm: the new blank quote takes the engine the office switch gives it (KCLive.allowsNew), with the 65 % down payment for KC on Barro Kitchens / Barro Industries and 50 otherwise; Brilliant Steel is always legacy', () => {
    const b = makeEnv(); b.run('D7.live = true; globalThis.KCLive = { allowsNew: function () { return globalThis.__allow; } }; __allow = true;');
    b.run('clearForm()'); assert.equal(b.run('quoteEngine'), 'kc1'); assert.equal(b.el('dpMode').value, '65');
    b.run('__allow = false; clearForm()'); assert.equal(b.run('quoteEngine'), 'legacy'); assert.equal(b.el('dpMode').value, '50', 'switch off: today\'s default');
    b.run("__allow = true; currentCo = 'BS'; clearForm()"); assert.equal(b.run('quoteEngine'), 'legacy', 'Brilliant Steel never starts on the configurators'); assert.equal(b.el('dpMode').value, '50');
    b.run('KCLive.allowsNew = function () { throw new Error("boom"); }; currentCo = "BK"; clearForm()'); assert.equal(b.run('quoteEngine'), 'legacy', 'a failing switch read is "off"');
    assert.ok(b.calls().some((c) => c[0] === 'adapter.reset'), 'a new quote resets the layer (panel, markup override)');
    const none = makeEnv(); none.run('clearForm()'); assert.equal(none.run('quoteEngine'), 'legacy', 'no KCLive at all: legacy'); assert.equal(none.el('dpMode').value, '50');
  });

  it('kcAdoptEngineIfBlank: a BLANK quote (no lines, no reopen source, no saved draft) follows the switch and its blank-quote down payment (unless the preparer chose one); a quote with lines, a reopened one or a draft never changes engine', () => {
    const mk = () => { const b = makeEnv(); b.run('D7.live = true; globalThis.KCLive = { allowsNew: function () { return globalThis.__allow; } }; __allow = true;'); return b; };
    let b = mk(); b.run('kcAdoptEngineIfBlank()');
    assert.equal(b.run('quoteEngine'), 'kc1'); assert.equal(b.el('dpMode').value, '65');
    b.run('__allow = false; kcAdoptEngineIfBlank()'); assert.equal(b.run('quoteEngine'), 'legacy'); assert.equal(b.el('dpMode').value, '50', 'back to the legacy default');
    b = mk(); b.run('_dpTouched = true; kcAdoptEngineIfBlank()'); assert.equal(b.run('quoteEngine'), 'kc1'); assert.equal(b.el('dpMode').value, '50', 'the preparer\'s own choice is left alone');
    b = mk(); b.run(`items.push(${JSON.stringify(catalogueLine())}); kcAdoptEngineIfBlank()`); assert.equal(b.run('quoteEngine'), 'legacy', 'a quote with a line keeps its engine');
    b = mk(); b.run("reopenSourceDocId = 'x'; kcAdoptEngineIfBlank()"); assert.equal(b.run('quoteEngine'), 'legacy', 'a reopened quote keeps its engine');
    b = mk(); b.run("savedDraftDocId = 'x'; kcAdoptEngineIfBlank()"); assert.equal(b.run('quoteEngine'), 'legacy', 'a named draft keeps its engine');
    b = mk(); b.run("quoteEngine = 'kc1'; items.push(" + JSON.stringify(kcLine()) + '); __allow = false; kcAdoptEngineIfBlank()'); assert.equal(b.run('quoteEngine'), 'kc1', 'a kc1 quote stays kc1 when the switch is turned off');
  });

  it('the Brilliant Steel guard: while the quote holds a configured line the pill does not move and the toast says why; with none it moves; a state that is being loaded is never refused (its own lines are in place first)', () => {
    const b = makeEnv(); b.kc(true);
    b.run(`items.push(${JSON.stringify(kcLine())})`);
    b.run("setCompany('BS')");
    assert.equal(b.run('currentCo'), 'BK');
    assert.equal(b.el('qbToast').textContent, 'Remove the configured lines first: a Brilliance Steel quote cannot carry them.');
    b.run('items.length = 0; setCompany("BS")'); assert.equal(b.run('currentCo'), 'BS');
    b.run('setCompany("BK"); items.push(' + JSON.stringify(catalogueLine()) + '); setCompany("BS")'); assert.equal(b.run('currentCo'), 'BS', 'catalogue lines may go to Brilliant Steel');
    const l = makeEnv(); l.kc(true); l.run(`items.push(${JSON.stringify(kcLine())})`);
    l.run(`loadEditableState(${JSON.stringify({ items: [catalogueLine()], currentCo: 'BS', pricing: { warrantyPlan: 'service6' } })}, {})`);
    assert.equal(l.run('currentCo'), 'BS', 'loading a Brilliant Steel quote over a kc quote works');
  });
});

describe('what only KC mode changes: whole pesos stay whole in legacy, the items header and tab row are never rewritten for a legacy quote, the sections, the sidecar, the file name, the header', () => {
  it('formatPeso: whole pesos (no centavos) in legacy, two decimals in KC mode', () => {
    const b = makeEnv();
    assert.equal(b.run('formatPeso(7.6)'), PESO + '8'); assert.equal(b.run('formatPeso(0)'), PESO + '0'); assert.equal(b.run('formatPeso(null)'), '—');
    b.kc(true);
    assert.equal(b.run('formatPeso(7.6)'), PESO + '7.60'); assert.equal(b.run('formatPeso(7)'), PESO + '7.00'); assert.equal(b.run('formatPeso(0)'), PESO + '0.00');
    b.run("currentCo = 'BS'"); assert.equal(b.run('formatPeso(7.6)'), PESO + '8', 'Brilliant Steel keeps whole pesos');
  });

  it('renderItems: a legacy quote never gets the KC header or the KC price pass; a KC quote gets the seven-column header with the photo column, the KC row and the price pass; leaving KC mode puts the page\'s own header back', () => {
    const b = makeEnv(); const LEGACY_TABS = '<button class="cat-tab active" onclick="filterCat(\'all\',this)">All</button><button class="cat-tab" id="tabCooking">Cooking Line</button>';
    b.el('catTabs').innerHTML = LEGACY_TABS;
    b.run(`items.push(${JSON.stringify(catalogueLine())}); DB = { products: [], categories: [{id:'prep_washing',label:'Prep'}], laborRoles: [], constants: {} };`);
    b.answer('pricing.autoPrice', true);
    b.run('renderItems()');
    assert.equal(b.el('itemsThead').innerHTML, '', 'legacy: the header is never written');
    assert.equal(b.calls().some((c) => c[0] === 'pricing.autoPrice'), false, 'legacy: the KC price pass is never asked');
    assert.equal(b.el('catTabs').innerHTML, LEGACY_TABS, 'legacy: the page\'s own tab row is never rewritten');
    assert.match(b.el('itemsTbody').innerHTML, /<td style="text-align:center;color:var\(--gray-dark\);font-size:12px;">1<\/td>/, 'the old row template');
    b.kc(true); b.answer('doc.photoCell', ''); b.el('d7PhotoCol').checked = true; b.run('renderItems()');
    assert.notEqual(b.el('catTabs').innerHTML, LEGACY_TABS, 'KC: the tab row is drawn (the provisional row, no adapter hook in this harness)'); assert.match(b.el('catTabs').innerHTML, /Prep and storage/);
    const th = b.el('itemsThead').innerHTML;
    assert.equal((th.match(/<th\b/g) || []).length, 7); assert.match(th, /class="c-ph">Photo<\/th>/); assert.match(th, /<th class="c-qty">Quantity<\/th>/);
    assert.match(b.el('itemsTbody').innerHTML, /<td class="c-ph">/, 'the D7 row');
    assert.ok(b.calls().some((c) => c[0] === 'pricing.autoPrice'), 'KC: the price pass runs');
    b.el('itemsThead')._kcLegacyHtml = '<tr><th>#</th></tr>'; b.kc(false); b.run('renderItems()');
    assert.equal(b.el('itemsThead').innerHTML, '<tr><th>#</th></tr>', 'back to legacy: the markup of the page is restored');
    assert.equal(b.el('catTabs').innerHTML, LEGACY_TABS, 'back to legacy: the ten buttons of the page, byte for byte');
  });

  it('the sections: a legacy quote reads DB.categories untouched; a KC quote gets the seven tab ids first, then the catalogue\'s own categories', () => {
    const b = makeEnv(); b.run("DB = { products: [], categories: [{id:'prep_washing',label:'Prep & Washing'}], laborRoles: [], constants: {} }");
    assert.equal(b.run('qbCategories() === DB.categories'), true, 'legacy: the same array');
    assert.equal(b.run("dbCategory('prep')"), null);
    b.kc(true);
    assert.deepEqual(b.plain('qbCategories().map(c => c.id)'), ['prep', 'wash', 'cook', 'vent', 'cold', 'multi', 'mech', 'prep_washing']);
    assert.equal(b.plain("dbCategory('wash').label"), 'Washing');
    assert.deepEqual(b.plain("(items.length = 0, items.push({ category: 'cook' }, { category: 'prep' }, { category: 'prep_washing' }), sectionKeys())"), ['prep', 'cook', 'prep_washing'], 'tab order first');
  });

  it('buildCostSidecar: a legacy quote with no cost fields has none (as before); a KC quote has a row for EVERY line, the live layer\'s { kcSummary, approval } and the markup override; payloads never carry a KC line\'s runtime figures', () => {
    const b = makeEnv();
    b.run(`items.push(${JSON.stringify(catalogueLine({ priceManual: undefined, priceBasis: undefined }))})`);
    assert.equal(b.run('buildCostSidecar()'), null, 'legacy: nothing to save, as it was');
    b.answer('live.sidecarExtras', { kcSummary: { v: 1 }, approval: null }); b.run('D7.markupOvr = function () { return 1.5; }');
    b.run(`items.push(${JSON.stringify(catalogueLine({ costMat: 400 }))})`);
    const lg = b.plain('buildCostSidecar()');
    assert.deepEqual(Object.keys(lg).sort(), ['items', 'v'], 'legacy: a costed line gives the sidecar it always gave: no kcSummary, no approval, no markup override');
    b.run('items.length = 0');
    b.run(`items.push(${JSON.stringify(catalogueLine({ priceManual: undefined, priceBasis: undefined }))})`);
    b.kc(true);
    b.answer('live.sidecarExtras', { kcSummary: { v: 1 }, approval: null }); b.answer('adapter.sidecarRow', { kind: 'chef_hp' }); b.run('D7.markupOvr = function () { return 1.5; }');
    b.run(`items.push(${JSON.stringify(kcLine())})`);
    const sc = b.plain('buildCostSidecar()');
    assert.equal(sc.items.length, 2, 'one row per line, the one with no cost field included'); assert.deepEqual(sc.items[0].i, 0); assert.equal(sc.items[0].n, 'Table');
    assert.deepEqual(sc.items[1].kc, { kind: 'chef_hp' });
    assert.deepEqual(sc.kcSummary, { v: 1 }); assert.equal('approval' in sc, true); assert.equal(sc.markupOvr, 1.5); assert.equal(sc.v, 1);
    // a payload: _kc is stripped, adapter.publicItem is asked for KC lines only
    b.run(`items[1]._kc = { projectCost: 5, M: 3 }`); b.answer('adapter.publicItem', (x) => ({ ...x, cfg: { cleaned: true } })); b.clear();
    const p = b.plain('buildQuotePayload()');
    assert.equal(JSON.stringify(p.items).includes('projectCost'), false); assert.equal('_kc' in p.items[1], false);
    assert.deepEqual(p.items[1].cfg, { cleaned: true }); assert.equal('cfg' in p.items[0], false, 'a catalogue line is not touched');
    assert.deepEqual(b.calls().filter((c) => c[0] === 'adapter.publicItem').length, 1, 'publicItem is asked for the KC line only');
    assert.equal(p.editableState.pricing.engine, 'kc1');
    const drafts = b.run("JSON.stringify(items, (k, v) => (k === '_cfg' || k === '_kc') ? undefined : v)");
    assert.equal(drafts.includes('projectCost'), false);
  });

  it('the PDF is named by the quote number as is in KC mode (owner: no "Rev." label; the Agent and Workforce copies keep their rule); legacy keeps client name + last segment', () => {
    const b = makeEnv(); b.el('clientName').value = 'Juan Dela Cruz'; b.el('quoteNo').value = 'BKLUFB261119-001R1';
    assert.equal(b.run("quoteFileName('')"), 'Juan Dela Cruz - 001R1');
    b.kc(true);
    assert.equal(b.run("quoteFileName('')"), 'BKLUFB261119-001R1');
    b.el('quoteNo').value = 'BKMLFB261118-002R12'; assert.equal(b.run("quoteFileName('')"), 'BKMLFB261118-002R12');
    b.el('quoteNo').value = 'Q-2026-7'; assert.equal(b.run("quoteFileName('')"), 'Q-2026-7');
    b.el('quoteNo').value = 'BK/LU:1R2'; assert.equal(b.run("quoteFileName('')"), 'BK LU 1R2', 'characters a file name cannot hold are taken out');
    b.el('quoteNo').value = 'BKLUFB261119-001R3'; assert.equal(b.run("quoteFileName('Agent Copy')"), 'Juan Dela Cruz - 001R3 (Agent Copy)');
  });

  it('the printed header: in KC mode the doc layer\'s header (when it answers) replaces the letterhead block, with the quote number, the date and the copy tag; legacy and an empty answer keep the letterhead', () => {
    const b = makeEnv();
    b.ctx.buildLetterhead = (o) => ({ headerHTML: '<div>LETTERHEAD ' + o.docNumber + '</div>', printCSS: '' });
    b.ctx.document.head = { appendChild() {} };
    b.run('buildQuoteNo = function () {}'); b.el('quoteNo').value = 'BKLUFB261119-001R1'; b.el('quoteDate').value = '2026-11-19';
    b.answer('doc.header', (s) => '<div>FORMS ' + s.no + ' ' + s.date + ' [' + s.tags.join(',') + '] ' + s.co + '</div>');
    b.run('applyLetterheadHeader()'); assert.equal(b.el('lhPrintHeader').innerHTML, '<div>LETTERHEAD BKLUFB261119-001R1</div>', 'legacy: the hook is never asked');
    b.kc(true); b.run('applyLetterheadHeader()'); assert.equal(b.el('lhPrintHeader').innerHTML, '<div>FORMS BKLUFB261119-001R1 2026-11-19 [] BK</div>');
    b.ctx.document.body.classList.add('body-workforce'); b.run('applyLetterheadHeader()'); assert.match(b.el('lhPrintHeader').innerHTML, /\[WORKFORCE COPY — NO PRICES\]/);
    b.answer('doc.header', ''); b.run('applyLetterheadHeader()'); assert.equal(b.el('lhPrintHeader').innerHTML, '<div>LETTERHEAD BKLUFB261119-001R1</div>', 'no answer: the letterhead stays');
  });
});

describe('the approval wiring: the reason the layer gives forces the approval tick and the button; Mark all reviewed only while a review is open; the link panel after sending; a legacy quote is never asked', () => {
  const fillVerify = (b) => { for (const id of ['quoteNo', 'clientName']) b.el(id).value = 'BKLUFB261119-001R1'; b.el('quoteDate').value = '2026-11-19'; b.run('waiveFlags = { salesperson: true, clientPhone: true, clientEmail: true }'); b.run(`items.push(${JSON.stringify(catalogueLine())})`); };

  it('reviewBlockReason() is the layer\'s approvalReason in KC mode and \'\' in legacy; the Verify & File row names the reason, ticks and locks the box, and the button reads "Send for approval (get the link)"', () => {
    const b = makeEnv(); fillVerify(b); b.answer('flow.approvalReason', 'the quote sells below its standard price'); b.answer('flow.reviewReason', '');
    b.run('DB = { products: [], categories: [], laborRoles: [], constants: {} }; globalThis.KC = { can: function (a) { return a === "review"; } };');
    assert.equal(b.run('reviewBlockReason()'), '', 'legacy: never asked');
    b.kc(true);
    assert.equal(b.run('reviewBlockReason()'), 'the quote sells below its standard price');
    b.run('buildVerifyModal()');
    const html = b.el('verifyBody').innerHTML;
    assert.match(html, /<input type="checkbox" id="reqApprovalCheck" checked disabled /); assert.match(html, /Needs the President's approval: the quote sells below its standard price/);
    assert.equal(b.el('fileBtn').textContent, 'Send for approval (get the link)');
    assert.equal(html.includes('markAllReviewedBtn'), false, 'a price reason is not cleared by "Mark all reviewed"');
    b.answer('flow.reviewReason', '1 line(s) need review: #1'); b.run('buildVerifyModal()');
    assert.ok(b.el('verifyBody').innerHTML.includes('markAllReviewedBtn'), 'a review is open and this role may clear it');
    b.run('KC.can = function () { return false; }; buildVerifyModal()'); assert.equal(b.el('verifyBody').innerHTML.includes('markAllReviewedBtn'), false, 'a role that may not review does not get the button');
    b.answer('flow.approvalReason', ''); b.answer('flow.reviewReason', ''); b.run('buildVerifyModal()');
    assert.match(b.el('verifyBody').innerHTML, /<input type="checkbox" id="reqApprovalCheck"\s+style/, 'nothing forces it: the box is free and unticked'); assert.equal(b.el('fileBtn').textContent, '📁 File Quotation');
  });

  it('fileQuotation: a forced approval can never reach QUOTE_FILED — it posts QUOTE_APPROVAL_REQUESTED, asks the layer for the link panel (KC mode only) and the badge reads Pending; legacy is as before', async () => {
    for (const kcOn of [true, false]) {
      const b = makeEnv(); fillVerify(b); b.run('DB = { products: [], categories: [], laborRoles: [], constants: {} }');
      b.answer('flow.approvalReason', 'a line needs review'); b.answer('flow.showApprovalLink', 1); b.kc(kcOn);
      b.run('doVerifyAndFile()');
      if (!kcOn) b.el('reqApprovalCheck').checked = true;   // legacy: the preparer's own "send to the president first" tick
      await b.run('fileQuotation()');
      const types = b.posted.map((p) => p.msg.type);
      if (kcOn) {
        assert.deepEqual(types, ['QUOTE_APPROVAL_REQUESTED']); assert.equal(b.run('quoteStatus'), 'pending_approval'); assert.equal(b.el('filedBadge').textContent, '⏳ Pending Approval');
        assert.ok(b.calls().some((c) => c[0] === 'flow.showApprovalLink' && c[1] && c[1].editableState), 'the link panel is asked, with the payload');
        assert.equal(b.el('filedBadge').style.cursor, 'pointer');
      } else {
        assert.deepEqual(types, ['QUOTE_APPROVAL_REQUESTED'], 'legacy: only the preparer\'s own tick sends it for approval (the layer\'s reason is never read)'); assert.equal(b.calls().some((c) => c[0] === 'flow.showApprovalLink'), false, 'legacy: the link panel is not the layer\'s business');
        assert.equal(b.el('filedBadge').style.cursor, '', 'legacy: the badge is not made clickable');
      }
      assert.ok(b.posted.every((p) => p.origin === 'http://localhost'), 'every message is pinned to the origin');
    }
  });

  it('the badge click shows the approval link only for a pending KC quote; the layer\'s approval-covers answer stops the below-floor tick from coming back', () => {
    const b = makeEnv(); b.answer('flow.showApprovalLink', 1);
    const onclick = HTML.match(/id="filedBadge" onclick="([^"]*)"/)[1];
    const click = () => { b.clear(); vm.runInContext(onclick, b.ctx); return b.calls().some((c) => c[0] === 'flow.showApprovalLink'); };
    b.kc(true); b.run("quoteStatus = 'draft'"); assert.equal(click(), false);
    b.run("quoteStatus = 'pending_approval'"); assert.equal(click(), true);
    b.kc(false); b.run("quoteStatus = 'pending_approval'"); assert.equal(click(), false, 'a legacy pending quote is not the layer\'s business');
    b.kc(true); b.answer('flow.approvalCovers', true); assert.equal(b.run('approvalCoversNow()'), true);
    b.kc(false); assert.equal(b.run('approvalCoversNow()'), false);
  });
});

describe('the guided tour and Help in both modes; the per-device switch', () => {
  it('tourSkips: the website-family configurator step is skipped in KC mode and the cards step in legacy; KC mode says its own wording; the counter counts the steps that are shown', () => {
    const b = makeEnv();
    const steps = b.plain('TOUR_STEPS');
    const cfg = steps.find((s) => s.target === '#configPanel'), cards = steps.find((s) => s.target === '#d7Cards'), add = steps.find((s) => s.target === '#addItemsSection');
    const sk = (s) => b.run(`tourSkips(${JSON.stringify(s)})`);
    assert.equal(sk(cfg), false); assert.equal(sk(cards), true, 'legacy: the KC-only step is skipped');
    assert.equal(b.run(`tourBody(${JSON.stringify(add)})`), add.body);
    b.kc(true);
    assert.equal(sk(cfg), true); assert.equal(sk(cards), false);
    assert.equal(b.run(`tourBody(${JSON.stringify(add)})`), add.kcBody); assert.notEqual(add.kcBody, add.body);
    assert.equal(b.run('TOUR_STEPS.filter(x => !tourSkips(x)).length'), 20); b.kc(false); assert.equal(b.run('TOUR_STEPS.filter(x => !tourSkips(x)).length'), 20, '20 steps in either mode');
    assert.equal(b.run('tourTitle({ title: "a", kcTitle: "b" })'), 'a'); b.kc(true); assert.equal(b.run('tourTitle({ title: "a", kcTitle: "b" })'), 'b');
  });

  it('the device switch: the key is bkqb_kc_force; "off" writes 0, "office" removes it; the Help row shows only to whoever can use the configurators (live layer AND it is on for them, a KC quote is open, or this device turned it off)', () => {
    const b = makeEnv();
    assert.equal(b.run('kcDeviceMode()'), 'office');
    b.run("kcSetDeviceMode('off')"); assert.equal(b.store.get('bkqb_kc_force'), '0'); assert.equal(b.run('kcDeviceMode()'), 'off');
    b.run("kcSetDeviceMode('office')"); assert.equal(b.store.has('bkqb_kc_force'), false);
    const row = () => { b.el('helpKcDevice').style.display = 'x'; b.run('kcSyncHelp()'); return b.el('helpKcDevice').style.display; };
    assert.equal(row(), 'none', 'the layer is not live');
    b.run('D7.live = true'); assert.equal(row(), 'none', 'live, but off for this person and no KC quote open: nothing to switch');
    b.run('globalThis.KCLive = { allowsNew: function () { return true; } }'); assert.equal(row(), '', 'on for this person');
    b.run('KCLive.allowsNew = function () { return false; }; quoteEngine = "kc1"'); assert.equal(row(), '', 'a KC quote is open');
    b.run('quoteEngine = "legacy"; localStorage.setItem("bkqb_kc_force", "0")'); assert.equal(row(), '', 'this device turned it off and may want it back');
  });

  it('switching the device off while a blank quote is open puts that quote back on the old builder at once; a quote with lines keeps its engine', () => {
    const b = makeEnv(); b.run('D7.live = true; globalThis.KCLive = { allowsNew: function () { return localStorage.getItem("bkqb_kc_force") !== "0"; } }; quoteEngine = "kc1";');
    b.run("kcSetDeviceMode('off')"); assert.equal(b.run('quoteEngine'), 'legacy');
    const c = makeEnv(); c.run('D7.live = true; globalThis.KCLive = { allowsNew: function () { return localStorage.getItem("bkqb_kc_force") !== "0"; } }; quoteEngine = "kc1"; items.push(' + JSON.stringify(kcLine()) + ')');
    c.run("kcSetDeviceMode('off')"); assert.equal(c.run('quoteEngine'), 'kc1', 'quotes already made keep opening the way they were made');
  });
});

// ═══════════════════════════════════════════════ 3. ADDENDUM 1: names, words, defaults ═══════════════════════════════════════════════
describe('Addendum 1 (owner-approved): "Brilliance Steel" on screen, no prototype wording, the new-quote defaults', () => {
  const visibleSource = () => stripComments(HTML.replace(/<!--[\s\S]*?-->/g, ''));

  it('A7: "Brilliance Steel", not "Brilliant Steel", in every user-visible string of the page — the two company pills, the commission hint, the toast, Help, What\'s New, the guided tour; the printed letterhead of a Brilliant Steel quotation (CO.BS, pinned byte for byte by other tests and an owner ruling) is the one exception', () => {
    const noLetterhead = visibleSource().replace(/ {2}BS:\{name:'BRILLIANT STEEL CORPORATION'[\s\S]*?creds:'Brilliant Steel Corporation[^\n]*\},\n/, '');
    assert.ok(noLetterhead.length < visibleSource().length, 'CO.BS was found and set aside');
    assert.equal(/Brilliant Steel/i.test(noLetterhead), false, 'a user-visible "Brilliant Steel" is left: ' + (noLetterhead.match(/.{40}Brilliant Steel.{40}/i) || [''])[0]);
    assert.equal((HTML.match(/⚙ Brilliance Steel<\/button>/g) || []).length, 2, 'the desktop and the mobile company pill');
    assert.ok(HTML.includes("showToast('Remove the configured lines first: a Brilliance Steel quote cannot carry them.','error')"));
    assert.ok(/\(never on Brilliance Steel\); your manual choice wins/.test(HTML));
    for (const id of ['coBS', 'mtbCoBS']) assert.ok(new RegExp(`id="${id}"[^>]*onclick="(mtb)?[sS]etCompany\\('BS'\\)"`).test(HTML), `the id and the code of ${id} are internal and unchanged`);
    assert.match(HTML, /QUOTE_COLL=\{ BK:'bk_quotes', BI:'bk_quotes', BS:'bs_quotes' \};/, 'bs_quotes and BS stay');
  });

  it('A10: no prototype wording anywhere a person can read it (the pages, Help, What\'s New, the tour): no "prototype", no "Prototype:" prefix, no "sample prices", no "made-up"', () => {
    const text = visibleSource().replace(/Object\.prototype/g, 'Object').replace(/\.prototype\b/g, '');
    assert.equal(/prototype/i.test(text), false, 'prototype wording: ' + (text.match(/.{40}prototype.{40}/i) || [''])[0]);
    assert.equal(/sample (material )?prices|made-up|made up costs?/i.test(text), false);
    assert.equal(/D7 prototype|\(prototype\)/i.test(HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\/\/[^\n]*/g, '')), false);
  });

  it('A10: new-quote defaults — 65 % down payment and a 6-month warranty on a KC quote (Barro Kitchens / Barro Industries), the live defaults (50 % down, the same 6-month warranty) on a legacy quote; balance in one payment after completion in both', () => {
    for (const [kcOn, dp] of [[true, '65'], [false, '50']]) {
      const b = makeEnv(); b.run(`D7.live = true; globalThis.KCLive = { allowsNew: function () { return ${kcOn}; } };`);
      b.run('clearForm()');
      assert.equal(b.run('quoteEngine'), kcOn ? 'kc1' : 'legacy');
      assert.equal(b.el('dpMode').value, dp, `down payment of a new ${kcOn ? 'KC' : 'legacy'} quote`);
      assert.equal(b.el('warrantyPlan').value, 'service6', 'the 6-month service warranty is the plan of every new quote');
      assert.equal(b.el('balMode').value, 'lump', 'the balance in one payment');
      assert.equal(b.run("getPricingFields().warrantyPlan"), 'service6');
    }
    assert.match(HTML, /<select id="warrantyPlan"[^>]*>\s*<option value="service6"/, 'the markup\'s own first (selected) plan is the 6-month service warranty');
    assert.match(HTML, /<option value="65" hidden>65% Down Payment<\/option>/, 'the 65 % option exists and is shown only in KC mode');
  });

  it('A10: a phone in KC mode (KC:L10) — the Verify & File footer wraps with File Quotation on the whole bottom row, the "Lead time" chip sits on its own line, the Save draft label has a background; EVERY rule is scoped to body.d7-on, so the old builder\'s layout is untouched', () => {
    const at = HTML.indexOf('/* KC:L10');
    assert.ok(at > 0, 'the KC:L10 block');
    const css = HTML.slice(at, HTML.indexOf('</style>', at)).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] })).filter((r) => !r.sel.startsWith('@'));
    assert.ok(rules.length >= 5, 'five rules: the footer, its buttons, the file button, the lead chip and its text, the draft button');
    for (const r of rules) for (const s of r.sel.split(',')) assert.ok(s.trim().startsWith('body.d7-on '), `scoped to the new rules only: "${s.trim()}"`);
    const rule = (sel) => { const r = rules.find((x) => x.sel === sel); assert.ok(r, `a rule for ${sel}`); return r.body; };
    assert.match(css, /@media\(max-width:640px\)\{/, 'phone widths only for the layout rules');
    assert.match(rule('body.d7-on #verifyModal .modal-footer'), /flex-wrap:wrap/);
    assert.match(rule('body.d7-on #verifyModal .modal-footer .btn'), /flex:1 1 calc\(50% - 4px\)/);
    assert.match(rule('body.d7-on #verifyModal .modal-footer .btn'), /min-height:44px/, 'a thumb-sized target');
    assert.match(rule('body.d7-on #verifyModal #fileBtn'), /flex:1 1 100%/);
    assert.match(rule('body.d7-on #verifyModal #fileBtn'), /order:1/, 'File Quotation is the last row');
    assert.match(rule('body.d7-on #d7LeadChip'), /display:block/, 'the chip breaks onto its own line: next to the quality chip it was wider than a 360 px screen');
    assert.match(rule('body.d7-on #d7LeadChip .kc-q-lead'), /margin-left:0/);
    assert.match(rule('body.d7-on #verifyModal #saveDraftBtn'), /background:var\(--dark-blue\)/);
    // the draft button's rule is NOT inside the phone query (the label was invisible at every width)
    assert.ok(css.indexOf('#saveDraftBtn') >= 0 && css.indexOf('#saveDraftBtn') < css.indexOf('@media'), 'the Save draft background applies at every width');
    // the markup the rules address still exists
    for (const id of ['verifyModal', 'fileBtn', 'saveDraftBtn', 'd7LeadChip']) assert.ok(new RegExp(`id="${id}"`).test(HTML), `#${id} is in the page`);
  });
});

// ═══════════════════════════════════════════════ QA: one element id, one element ═══════════════
// The Materials price list (qb/kc/admin-d7.js) wrote id="plSearch" for its search box, the id the page's own Pricelist picker (the old modal) already has.  Once the President or Purchasing had opened the
// Materials list, document.getElementById('plSearch') (what the picker reads) answered the Materials screen's box, and typing in the picker no longer filtered it (549 rows stayed 549).
describe('QA: no element id written by the qb/ files is also written by the page', () => {
  const ids = (text) => { const out = new Set(); const re = /\bid=["']([A-Za-z][\w-]*)["']/g; let m; while ((m = re.exec(text))) out.add(m[1]); return out; };
  const QB_FILES = ['qb/kc/admin-d7.js', 'qb/kc/host-d7.js', 'qb/kc-live.js', 'qb/d7/d7-adapter.js', 'qb/d7/d7-doc.js', 'qb/d7/d7-flow.js', 'qb/d7/d7-pricing.js', 'qb/d7/d7-core.js'];
  it('every id the bridge and the screens write is theirs alone (the page and the qb/ files never share one)', () => {
    const page = ids(HTML);
    for (const f of QB_FILES) {
      const mine = ids(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      const both = [...mine].filter((x) => page.has(x));
      assert.deepEqual(both, [], `${f} writes id(s) the page already has: ${both.join(', ')}`);
    }
  });
  it('the Materials list search box has its own id and its handler listens for that one; the page\'s Pricelist picker keeps plSearch', () => {
    const adm = fs.readFileSync(path.join(ROOT, 'qb/kc/admin-d7.js'), 'utf8');
    assert.match(adm, /id="kcPlSearch"/); assert.match(adm, /e\.target\.id==='kcPlSearch'/);
    assert.equal(/id="plSearch"/.test(adm), false);
    assert.match(HTML, /<input id="plSearch" placeholder="Search the pricelist/);
  });
});

// ═══════════════════════════════════════════════ QA: the approval reason is read as a sentence ═══════════════
describe('QA: the Verify & File approval row (a whole sentence naming the lines and the reason) is not printed in capitals', () => {
  it('in KC mode the labels of the Verify rows are sentence case; the rule is scoped to body.d7-on, so the old builder\'s modal is untouched', () => {
    const at = HTML.indexOf('/* KC:L10');
    const css = HTML.slice(at, HTML.indexOf('</style>', at)).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] })).filter((r) => !r.sel.startsWith('@'));
    const r = rules.find((x) => x.sel === 'body.d7-on #verifyModal .verify-val label');
    assert.ok(r, 'a rule for the labels inside the Verify rows');
    assert.match(r.body, /text-transform:none/); assert.match(r.body, /letter-spacing:normal/);
    // the sentence really sits in such a label (buildVerifyModal writes it inside .verify-val > label)
    assert.match(SCRIPT, /class="verify-val" style="margin-top:4px">\s*<label[^>]*>\s*<input type="checkbox" id="reqApprovalCheck"/);
  });
});

// ═══════════════════════════════════════════════ QA: the Photo column follows the photo link ═══════════════
describe('QA: linking, unlinking, deleting or reordering a photo redraws the Photo column of a new-rules quote (and only of one)', () => {
  for (const name of ['updatePhotoLink', 'deletePhoto', 'movePhotoUp', 'movePhotoDown']) {
    it(`${name}() redraws the items table when d7On(); the legacy path is unchanged (no extra call without d7On())`, () => {
      const src = stripComments(fnSource(name));
      assert.match(src, /if\(d7On\(\)\)\s*renderItems\(\)/, `${name} must call renderItems() for a quote that follows the new rules`);
      assert.equal((src.match(/renderItems\(\)/g) || []).length, 1, 'one redraw, and only behind the d7On() test');
    });
  }
  it('the Photo cell reads the quote\'s photos (so the redraw is what puts a linked photo in the cell)', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'qb/d7/d7-doc.js'), 'utf8');
    assert.match(doc, /function photoCell\(/); assert.match(doc, /quotePhotos/);
  });
});
