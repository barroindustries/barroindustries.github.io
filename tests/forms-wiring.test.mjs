// tests/forms-wiring.test.mjs — how the forms engine is wired into the app (specs/SALES-FLOW-SPEC-2026-11-19.md §9.3, §9.4, §9.7).
//
//   1. FILES        the five new lazy files + the logo are precached in the order the pre-commit hook parses, none of them is an index.html <script>
//                   (CLAUDE.md "app-kit" rule), the forms never use the letterhead engine.
//   2. PRINT-DOCS   js/print-docs.js is ADDITIVE: with no `downloadPdf` option the toolbar and the page markup are exactly what they were; with it the
//                   toolbar is Download PDF · Print · JPEG and the PDF is made by FormsPdf.download (the ONE PDF path), also off-screen
//                   (exportPrintableDocPdf) with the same capture and the same plain failures.
//   3. THE WALL     the Operations bodies (job order, handoff pack) read only declared, money-free fields and contain no peso, no money formatter.
//   4. Forms API    the §9.3 contract, run in a vm with a stub app around the REAL js/forms.js, js/forms-core.js and js/forms-set-1.js: ready-when-
//                   awaited (QF's loader), buttonHtml / canOpen / open / downloadPdf / assignNumbers / nextNumber / offer / bind — and none of them throws.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { ROOT, read, setupForms, fixtures, PEOPLE, jobOrderHelpersSource } from './fixtures/forms-env.mjs';

const require = createRequire(import.meta.url);
const { createFake } = require('./fixtures/fake-firestore.cjs');
const FC = setupForms();
const plain = (v) => JSON.parse(JSON.stringify(v));                 // a value that came out of a vm context, as a plain main-realm object

describe('1. files and wiring', () => {
  const sw = read('sw.js');
  const precache = (() => { const m = sw.match(/const PRECACHE = \[([\s\S]*?)\n\];/); return [...m[1].matchAll(/^\s*'([^']+)',?\s*(?:\/\/.*)?$/gm)].map((x) => x[1]); })();

  it('sw.js precaches the forms files and the header logo, one single-quoted entry per line (the shape the hook and the manifest parse), after pdf-lite and in this order', () => {
    const at = ['/js/pdf-lite.js', '/js/forms-core.js', '/js/forms.js', '/js/forms-set-1.js', '/js/forms-pdf.js', '/icons/barro-industries-horizontal.png'].map((f) => precache.indexOf(f));
    assert.ok(at.every((i) => i >= 0), 'every entry is in PRECACHE: ' + at.join(','));
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'and in this order');
    for (const f of ['/js/forms-core.js', '/js/forms.js', '/js/forms-set-1.js', '/js/forms-pdf.js', '/icons/barro-industries-horizontal.png']) assert.ok(sw.includes(`\n  '${f}',\n`), `${f} is on its own line`);
    for (const f of ['/js/forms-core.js', '/js/forms.js', '/js/forms-set-1.js', '/js/forms-pdf.js', '/icons/barro-industries-horizontal.png', '/js/vendor/html2canvas.min.js', '/js/pdf-lite.js', '/js/screens/production.js', '/icons/barro-kitchens.png'])
      assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is precached or needed but missing on disk`);
    assert.ok(precache.includes('/icons/barro-kitchens.png') || fs.existsSync(path.join(ROOT, 'icons/barro-kitchens.png')));
    assert.equal(precache.length, new Set(precache).size, 'no duplicate precache entries');
    assert.ok(!sw.includes('barro-industries-logo-horizontal'), 'the superseded logo path is gone');
  });
  it('the forms files are LAZY: none is a <script> in index.html (they load through ensureScript), and nothing else of the app kit moved', () => {
    const html = read('index.html');
    assert.doesNotMatch(html, /js\/forms(-core|-set-1|-pdf)?\.js/);
    assert.doesNotMatch(html.replace(/<img src="icons\/barro-industries-horizontal\.png" alt="[^"]*" class="(topbar|splash|login)-hlogo"[^>]*>/g, '').replace(/<link rel="preload" as="image" href="icons\/barro-industries-horizontal\.png"\/>/, ''), /barro-industries-horizontal/, 'only the top bar, the splash, the sign-in screen and the kit preload (owner 2026-11-20) reference the horizontal logo');
    const cfg = read('js/config.js');
    // QUOTE-APPROVAL-LINK-SPEC-2026-11-20 §2.3: the quote review page lists js/forms-core.js (the section headings and item codes it prints) in its OWN PAGE_SCRIPTS entry — the one
    // mention allowed; every form still loads the engine through ensureScript, and the other three forms files are named nowhere in config.js.
    const qa = cfg.match(/'quote-approval':\s*\[([^\]]*)\]/);
    assert.ok(qa && /'js\/forms-core\.js'/.test(qa[1]), 'the review page names forms-core.js in PAGE_SCRIPTS');
    const rest = cfg.replace(qa[0], '').replace(/\/\/ ── Quote review page \(QUOTE-APPROVAL-LINK-SPEC[^\n]*\n(?:\s*\/\/[^\n]*\n)*/, '');
    assert.ok(!/forms-core|forms-set-1|forms-pdf/.test(rest), 'config.js (PAGE_SCRIPTS) is not touched by Phase 1 — QF loads the engine with ensureScript');
  });
  it('the registry says what each form needs: the body set, and production.js for the job-based forms', () => {
    for (const e of FC.list()) assert.equal(e.bodySet, ['sales_order', 'payment_ack', 'job_order', 'handoff_pack'].includes(e.id) ? 'js/forms-set-1.js' : 'js/forms-set-2.js');
    assert.deepEqual(FC.get('job_order').needs, ['js/screens/production.js']); assert.deepEqual(FC.get('handoff_pack').needs, ['js/screens/production.js']);
    assert.deepEqual(plain(FC.get('sales_order').needs || []), []); assert.deepEqual(plain(FC.get('payment_ack').needs || []), []);
  });
  it('the forms do not use the letterhead engine: the header is the owner\'s own, built in forms-core', () => {
    for (const f of ['js/forms-core.js', 'js/forms.js', 'js/forms-set-1.js', 'js/forms-pdf.js']) {
      const src = read(f);
      assert.doesNotMatch(src, /buildLetterhead\s*\(|window\.Letterhead|\bLetterhead\./, f);
      assert.doesNotMatch(src, /ensureScript\([^)]*letterhead/i, f);
    }
  });
});

describe('2. js/print-docs.js is additive', () => {
  const PD = read('js/print-docs.js');
  const DL_CSS = PD.match(/const DL_CSS = `([\s\S]*?)`;/)[1];
  // print-docs.js in a vm, with the smallest app around it. → { box, log, buttons }
  function loadPrintDocs(extra) {
    const log = { openPage: [], removed: [], appended: [], download: [], loaded: [], unlock: 0 };
    const buttons = {};
    const button = (id) => ({ id, listeners: [], addEventListener(type, fn) { this.listeners.push([type, fn]); } });
    const panel = { classList: { add() {} }, querySelector: (sel) => { const m = /^#(pd-[a-z]+-btn)$/.exec(sel); return m ? (buttons[m[1]] = buttons[m[1]] || button(m[1])) : null; } };
    const box = { console, setTimeout, clearTimeout, CSS: { escape: (s) => s }, navigator: {}, getComputedStyle: () => ({}), innerWidth: 1000, addEventListener() {}, removeEventListener() {} };
    box.window = box; vm.createContext(box);
    box.openPage = (title, html, sub, opts) => { log.openPage.push({ title, html, sub, opts }); return panel; };
    Object.assign(box, extra || {});
    vm.runInContext(PD, box, { filename: 'print-docs.js' });
    return { box, log, buttons };
  }
  const html = (o) => { const { box, log } = loadPrintDocs(); box.openPrintableDoc(o); return log.openPage[0]; };

  it('WITHOUT downloadPdf the toolbar is byte-for-byte the old one: Print / Save PDF + Save as JPEG, and extraButtons after them', () => {
    const OLD = '\n    <button class="btn-primary btn-sm" id="pd-print-btn">🖨 Print / Save PDF</button>\n    <button class="btn-secondary btn-sm" id="pd-jpeg-btn">📷 Save as JPEG</button>\n    ';
    assert.equal(html({ title: 'X', bodyHtml: '<p>x</p>' }).opts.headerRightHTML, OLD);
    assert.equal(html({ title: 'X', bodyHtml: '<p>x</p>', extraButtons: '<b id="e"></b>' }).opts.headerRightHTML, OLD + '<b id="e"></b>');
    assert.equal(html({ title: 'X', bodyHtml: '<p>x</p>', downloadPdf: false }).opts.headerRightHTML, OLD, 'downloadPdf:false is the same as absent');
    const first = html({ title: 'Delivery Receipt', bodyHtml: '<p>x</p>', pageCss: '.a{b:c}' });
    assert.equal(first.title, 'Delivery Receipt'); assert.equal(first.sub, '');
    assert.doesNotMatch(first.html, /pd-tb2|pd-lbl|pd-pdf-btn|max-width:640px\)\{\s*\.pd-host/);
  });
  it('WITHOUT downloadPdf only the two old buttons are wired (one click listener each) and the page markup is unchanged', () => {
    const { box, log, buttons } = loadPrintDocs();
    box.openPrintableDoc({ title: 'X', bodyHtml: '<p>x</p>' });
    assert.deepEqual(Object.keys(buttons).sort(), ['pd-jpeg-btn', 'pd-print-btn']);
    for (const b of Object.values(buttons)) assert.deepEqual(b.listeners.map((l) => l[0]), ['click']);
    assert.match(log.openPage[0].html, /^\n<style>\n[\s\S]*\n<\/style>\n<div class="pd-stage" style="--pd-accent:#1E3A5F">\n  <div class="page pd-print" id="pd-page">\n    \n    <p>x<\/p>\n  <\/div>\n<\/div>$/, 'the default accent and sheet markup are as they were');
  });
  it('the downloadPdf page is the default page PLUS the phone toolbar CSS — nothing else changes', () => {
    const base = html({ title: 'X', bodyHtml: '<p>x</p>', pageCss: '.a{b:c}' }).html;
    const dl = html({ title: 'X', bodyHtml: '<p>x</p>', pageCss: '.a{b:c}', downloadPdf: true }).html;
    assert.notEqual(base, dl);
    assert.equal(dl.replace('\n' + DL_CSS, ''), base);
    assert.match(DL_CSS, /@media \(max-width:640px\)\{\s*\.pd-host \.pd-tb2 \.pd-lbl\{display:none\}\s*\}/);
  });
  it('WITH downloadPdf: Download PDF (primary) · Print · Save as JPEG — the labels collapse to icons on a phone; all three are wired', () => {
    const { box, log, buttons } = loadPrintDocs();
    box.openPrintableDoc({ title: 'Sales Order — SO-0012', bodyHtml: '<p>x</p>', downloadPdf: true, fileName: 'SO-0012.pdf' });
    const bar = log.openPage[0].opts.headerRightHTML;
    assert.deepEqual([...bar.matchAll(/<button class="([^"]*)" id="([^"]*)"/g)].map((m) => [m[2], m[1]]), [
      ['pd-pdf-btn', 'btn-primary btn-sm'], ['pd-print-btn', 'btn-secondary btn-sm pd-tb2'], ['pd-jpeg-btn', 'btn-secondary btn-sm pd-tb2']]);
    assert.match(bar, /id="pd-pdf-btn">⬇️ Download PDF<\/button>/); assert.doesNotMatch(bar, /Print \/ Save PDF/);
    assert.match(bar, /aria-label="Print" title="Print">🖨<span class="pd-lbl"> Print<\/span>/); assert.match(bar, /aria-label="Save as JPEG" title="Save as JPEG">📷<span class="pd-lbl"> Save as JPEG<\/span>/);
    assert.deepEqual(Object.keys(buttons).sort(), ['pd-jpeg-btn', 'pd-pdf-btn', 'pd-print-btn']);
    for (const b of Object.values(buttons)) assert.deepEqual(b.listeners.map((l) => l[0]), ['click'], b.id);
  });
  it('window.exportPrintableDocPdf exists (Forms.downloadPdf uses it) and the PDF itself is FormsPdf\'s — print-docs makes none of its own for this path', () => {
    const { box } = loadPrintDocs();
    assert.equal(typeof box.exportPrintableDocPdf, 'function'); assert.equal(typeof box.openPrintableDoc, 'function');
    assert.ok(!/_buildDocPdf|_cutPoints|_pageBands/.test(PD), 'no second page-cutting implementation inside print-docs.js');
    assert.equal((PD.match(/FormsPdf\.download\(/g) || []).length, 1, 'one call site');
    assert.match(PD, /ensureScript\('js\/forms-pdf\.js'\)/);
    assert.doesNotMatch(PD, /createElement\('script'\)/, 'print-docs.js never injects a <script> itself (tests/lazy-script-versioning)');
  });

  // exportPrintableDocPdf: the sheet is laid out off-screen WITH its CSS and handed to FormsPdf.download
  function exportHarness({ sheet = {}, download, ensure, scrollLock } = {}) {
    const rec = { calls: [], loaded: [], removed: [], appended: [], unlocked: 0 };
    const host = { style: {}, setAttribute() {}, remove() { rec.removed.push(host); }, querySelector: (sel) => (sheet === null ? null : (sel === '#frm-page' || sel === '.pd-print' ? sheet : null)) };
    Object.defineProperty(host, 'innerHTML', { get() { return this._h; }, set(v) { this._h = v; } });
    const extra = {
      document: { createElement: () => host, body: { appendChild: (c) => rec.appended.push(c) } },
      ensureScript: (src) => { rec.loaded.push(src); return ensure ? ensure(src) : Promise.resolve(); },
      FormsPdf: { download: async (...a) => { rec.calls.push(a); return download ? download(...a) : { ok: true, fileName: a[1] }; } },
    };
    if (scrollLock) extra.ScrollLock = { withUnlocked: (fn) => { rec.unlocked++; return fn(); } };
    const { box } = loadPrintDocs(extra);
    return { box, rec, host };
  }
  it('exportPrintableDocPdf: off-screen host with BASE css + the form css + the sheet; FormsPdf.download(sheet, "<file>.pdf", { quality 0.85, scale 2, title }); host removed after', async () => {
    const sheet = { id: 'sheet' };
    const { box, rec, host } = exportHarness({ sheet, scrollLock: true });
    const res = await box.exportPrintableDocPdf({ pageId: 'frm-page', bodyHtml: '<p>BODY</p>', pageCss: '.mine{color:red}', fileName: 'SO-0012-R1', pdfQuality: 0.85, title: 'Sales Order — SO-0012 R1', watermark: 'IGNORED' });
    assert.deepEqual(plain(res), { ok: true, fileName: 'SO-0012-R1.pdf' });
    assert.deepEqual(rec.loaded, ['js/forms-pdf.js']);
    assert.equal(rec.calls.length, 1); assert.equal(rec.calls[0][0], sheet); assert.equal(rec.calls[0][1], 'SO-0012-R1.pdf');
    assert.deepEqual(plain(rec.calls[0][2]), { quality: 0.85, scale: 2, title: 'Sales Order — SO-0012 R1' });
    assert.match(host.innerHTML, /\.pd-stage,\.pd-stage \*,\.pd-print,\.pd-print \*\{box-sizing:border-box/); assert.match(host.innerHTML, /\.mine\{color:red\}/);
    assert.match(host.innerHTML, /<div class="page pd-print" id="frm-page"><p>BODY<\/p><\/div>/);
    assert.match(host.style.cssText, /position:fixed;left:-99999px/);
    assert.deepEqual(rec.appended, [host]); assert.deepEqual(rec.removed, [host]); assert.equal(rec.unlocked, 1, 'the app\'s scroll lock is released around the capture');
  });
  it('exportPrintableDocPdf: quality / scale defaults, a name from the title when there is no file name, ".pdf" not doubled', async () => {
    const a = exportHarness({ sheet: {} });
    await a.box.exportPrintableDocPdf({ bodyHtml: '', title: 'Sales Order — X', pdfQuality: 7, scale: 3 });
    assert.equal(a.rec.calls[0][1], 'SalesOrderX'); assert.deepEqual(plain(a.rec.calls[0][2]), { quality: 0.85, scale: 3, title: 'Sales Order — X' });
    const b = exportHarness({ sheet: {} });
    await b.box.exportPrintableDocPdf({ bodyHtml: '', fileName: 'JO-0012.pdf', pdfQuality: 0.5 });
    assert.equal(b.rec.calls[0][1], 'JO-0012.pdf'); assert.equal(b.rec.calls[0][2].quality, 0.5);
  });
  it('exportPrintableDocPdf: every failure is { ok:false, error } — FormsPdf\'s own, a load failure, a missing sheet — and the host is always removed', async () => {
    const fails = exportHarness({ sheet: {}, download: () => ({ ok: false, fileName: 'X.pdf', error: 'Could not generate the PDF — boom' }) });
    assert.deepEqual(plain(await fails.box.exportPrintableDocPdf({ bodyHtml: '', fileName: 'X' })), { ok: false, fileName: 'X.pdf', error: 'Could not generate the PDF — boom' });
    assert.equal(fails.rec.removed.length, 1);
    const noLoad = exportHarness({ sheet: {}, ensure: () => Promise.reject(new Error('offline')) });
    const r1 = await noLoad.box.exportPrintableDocPdf({ bodyHtml: '', fileName: 'X' });
    assert.equal(r1.ok, false); assert.equal(r1.error, 'Could not load the PDF export — offline'); assert.equal(noLoad.rec.calls.length, 0); assert.equal(noLoad.rec.removed.length, 1);
    const noSheet = exportHarness({ sheet: null });
    const r2 = await noSheet.box.exportPrintableDocPdf({ bodyHtml: '', fileName: 'X' });
    assert.equal(r2.ok, false); assert.equal(r2.error, 'Could not find the document content to capture.'); assert.equal(noSheet.rec.removed.length, 1);
  });
});

describe('3. the peso wall in the Operations bodies', () => {
  const src = read('js/forms-set-1.js');
  // code only: whole-line comments are dropped (the section headers say "no pesos" in words)
  const workforce = src.slice(src.indexOf('// The scope table both workforce copies share'), src.lastIndexOf('})();')).replace(/^\s*\/\/.*$/gm, '');
  const region = (from, to) => workforce.slice(workforce.indexOf(from), workforce.indexOf(to));
  it('the workforce copies (job order, handoff pack, and the scope table they share) contain no peso sign, no money formatter, no h.peso', () => {
    assert.ok(workforce.length > 3000 && workforce.includes('bodies.job_order') && workforce.includes('bodies.handoff_pack') && workforce.includes('function crewItems'), 'the scan found the right region');
    for (const bad of [/₱/, /\bfmtN?2?\s*\(/, /\bh\.peso\b/, /\bmoney\s*\(/, /\bsigned\s*\(/, /\bPHP\b|\bPhp\b/, /toLocaleString\(/, /Intl\.NumberFormat/, /\bfmtPeso|\bpesos?\b/i])
      assert.doesNotMatch(workforce, bad, String(bad));
  });
  it('every field the Operations bodies read is a DECLARED field of that entry — and none is a price-like name', () => {
    const shared = region('function crewItems', 'bodies.job_order');                                  // the scope table + crewRequests, used by both
    const jo = region('bodies.job_order', 'bodies.handoff_pack'), hp = workforce.slice(workforce.indexOf('bodies.handoff_pack'));
    const keys = (id) => new Set(FC.get(id).fields.map((f) => f.key));
    const reads = (text) => new Set([...text.matchAll(/\bd\.([A-Za-z_]\w*)/g)].map((m) => m[1]));
    for (const [id, text] of [['job_order', jo + shared], ['handoff_pack', hp + shared]]) {
      const declared = keys(id);
      for (const r of reads(text)) { assert.ok(declared.has(r), `${id} body reads d.${r}, which is not a declared field`); assert.doesNotMatch(r, /price|amount|total|cost|peso|contract|paid|collect|balance|budget|margin|markup|vat|discount|fee|credit|refund/i, r); }
      assert.ok(reads(text).size >= 8, `${id}: the scan found only ${reads(text).size} reads`);
    }
    const lineKeys = new Set(['name', 'specs', 'dims', 'qty', 'unit', 'location', 'adjustment', 'notes', 'catLabel']);
    const itReads = new Set([...region('function crewItems', 'bodies.job_order').matchAll(/\bit\.([A-Za-z_]\w*)/g)].map((m) => m[1]));
    for (const r of itReads) assert.ok(lineKeys.has(r), `the scope table reads it.${r}`);
  });
  it('the declared fields of both Operations entries carry no money flag and no priced name', () => {
    for (const id of ['job_order', 'handoff_pack']) for (const f of FC.get(id).fields) { assert.ok(!f.money, `${id}.${f.key}`); assert.doesNotMatch(f.key, /price|amount|total|cost|peso|contract|paid|collect|balance|budget|margin|markup|vat|discount|fee|credit|refund/i, `${id}.${f.key}`); }
  });
});

// ── the app around the engine: REAL js/forms.js + forms-core.js + forms-set-1.js, a stub app, a fake Firestore ────────────────────
function makeApp(person, extra) {
  const log = { loaded: [], open: [], exports: [], toasts: [], modals: [], timers: [], counters: [], busy: [], clicks: [], errors: [], fail: new Set() };
  const box = { console: { ...console, error: (...a) => log.errors.push(a) } };
  box.window = box; vm.createContext(box);
  Object.assign(box, {
    currentRole: person.role, currentDepts: person.depts, currentUser: { uid: person.uid, email: 'user@example.com' }, userProfile: { displayName: person.name, role: person.role, departments: person.depts },
    bizDate: () => '2026-11-19',
    Notifs: { showToast: (m, t) => log.toasts.push([m, t]) },
    openModal: (t, h) => log.modals.push({ title: t, html: h }),
    document: { querySelector: () => null },
    openPrintableDoc: (o) => { log.open.push(o); return panel; },
    exportPrintableDocPdf: async (o) => { log.exports.push(o); return { ok: true, fileName: o.fileName }; },
    nextCounterId: async (name, seed, fmt) => { log.counters.push(name); return fmt(12); },
    busy: (btn, fn) => { log.busy.push(btn); return fn(); },
    setTimeout: (fn, ms) => { log.timers.push([fn, ms]); return log.timers.length; },
  });
  const panel = { querySelector: (sel) => (sel === '#pd-pdf-btn' ? { click: () => log.clicks.push('pdf-btn') } : null) };
  const loaded = new Map();
  const run = (src) => (src === 'js/screens/production.js' ? vm.runInContext(jobOrderHelpersSource(), box, { filename: 'production.js (job-order helpers)' }) : vm.runInContext(read(src), box, { filename: src }));
  box.ensureScript = (src) => {
    if (log.fail.has(src)) return Promise.reject(new Error('offline: ' + src));          // a file that cannot be fetched (log.fail.add('js/…'))
    if (!loaded.has(src)) { log.loaded.push(src); loaded.set(src, new Promise((res, rej) => setTimeout(() => { try { run(src); res(); } catch (e) { rej(e); } }, 2))); }
    return loaded.get(src);
  };
  Object.assign(box, extra || {});
  // QF's loader, verbatim:  const flowForms = () => window.ensureScript('js/forms.js').then(() => window.Forms);
  const flowForms = () => box.ensureScript('js/forms.js').then(() => box.Forms);
  return { box, log, flowForms };
}
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const salesPreload = () => { const fx = fixtures(); return { fx, ref: { record: fx.order, project: fx.project, client: fx.client, preparer: { name: 'Uriel Sagaoinit', title: 'Sales Manager' } } }; };

describe('4. window.Forms — the §9.3 contract', () => {
  it('ready-when-awaited: window.Forms exists the moment forms.js has run; awaiting it (QF\'s loader) yields a fully ready, non-thenable API', async () => {
    const { box, log, flowForms } = makeApp(PEOPLE.uriel);
    const p = box.ensureScript('js/forms.js');
    await p;
    assert.equal(typeof box.Forms, 'object', 'defined synchronously');
    assert.equal(box.FormsCore, undefined, 'forms-core.js has not arrived yet');
    assert.equal(box.Forms.canOpen('sales_order'), false, 'a synchronous call before the registry exists says no');
    assert.equal(box.Forms.buttonHtml('sales_order', { orderId: 'o1' }), '');
    assert.ok(!Object.keys(box.Forms).includes('then'), 'then is not enumerable');
    const F = await flowForms();
    assert.equal(F.then, undefined, 'the resolved object is not a thenable (it would be adopted again)');
    assert.equal(typeof box.FormsCore, 'object');
    for (const fn of ['open', 'downloadPdf', 'offer', 'assignNumbers', 'nextNumber', 'buttonHtml', 'bind', 'canOpen', 'whenReady']) assert.equal(typeof F[fn], 'function', fn);
    assert.equal(F.canOpen('sales_order'), true);
    assert.match(F.buttonHtml('sales_order', { orderId: 'o1' }), /^<button /);
    assert.deepEqual(log.loaded.filter((s) => s === 'js/forms-core.js'), ['js/forms-core.js'], 'forms-core.js loaded once');
    assert.equal(await box.Forms.whenReady().then((x) => x.then), undefined);
  });

  it('buttonHtml: btn-secondary btn-sm, data-form, data-ref (ids only), the title-cased label; "" outside the audience or for an unknown form', async () => {
    const F = await makeApp(PEOPLE.uriel).flowForms();
    assert.equal(F.buttonHtml('sales_order', { orderId: 'ord1', projectId: 'p1' }), '<button type="button" class="btn-secondary btn-sm" data-form="sales_order" data-ref="{&quot;orderId&quot;:&quot;ord1&quot;,&quot;projectId&quot;:&quot;p1&quot;}">Sales Order</button>');
    assert.match(F.buttonHtml('payment_ack', { claimId: 'c1' }), />Payment Acknowledgement<\/button>$/);
    assert.match(F.buttonHtml('job_order', { projectId: 'p1' }, { label: 'Open JO', rev: 2 }), /data-form="job_order" data-ref="\{&quot;projectId&quot;:&quot;p1&quot;\}" data-rev="2">Open JO<\/button>$/);
    assert.equal(F.buttonHtml('nope', { orderId: 'o' }), '');
    assert.match(F.buttonHtml('sales_order', null), /data-ref="\{\}"/);
    const slim = F.buttonHtml('sales_order', { orderId: 'o1', record: { secret: 1 }, extra: 'x', quoteId: 'q1', quoteColl: 'bk_quotes', docId: 'd1', claimId: 'c1' });
    assert.deepEqual(JSON.parse(unescape(slim.match(/data-ref="([^"]*)"/)[1])), { orderId: 'o1', claimId: 'c1', quoteId: 'q1', quoteColl: 'bk_quotes', docId: 'd1' }, 'only the ids travel in the markup');
    // outside the audience → '' (Production cannot see money forms; every staff profile sees the workforce forms)
    const rene = await makeApp(PEOPLE.rene).flowForms();
    assert.equal(rene.buttonHtml('sales_order', { orderId: 'o' }), ''); assert.equal(rene.buttonHtml('payment_ack', { orderId: 'o' }), '');
    assert.match(rene.buttonHtml('job_order', { projectId: 'p' }), /data-form="job_order"/); assert.match(rene.buttonHtml('handoff_pack', { projectId: 'p' }), /data-form="handoff_pack"/);
    assert.equal((await makeApp(PEOPLE.nobody).flowForms()).buttonHtml('job_order', { projectId: 'p' }), '');
  });
  it('buttonHtml escapes a hostile ref — nothing breaks out of the attribute, and the ids round-trip', async () => {
    const F = await makeApp(PEOPLE.uriel).flowForms();
    const evil = '"><img src=x onerror=alert(1)>\'';
    const out = F.buttonHtml('sales_order', { orderId: evil }, { label: '<b>x</b>' });
    assert.ok(!out.includes('<img') && !out.includes('"><') && !out.includes('<b>'), out);
    assert.equal(out.match(/</g).length, 2, 'only the button\'s own opening and closing tag');
    assert.deepEqual(JSON.parse(unescape(out.match(/data-ref="([^"]*)"/)[1])), { orderId: evil });
  });
  it('canOpen follows the audience for the signed-in viewer', async () => {
    const ids = ['sales_order', 'job_order', 'payment_ack', 'handoff_pack'];
    const table = { uriel: [true, true, true, true], shaira: [true, true, true, true], rene: [false, true, false, true], designer: [false, true, false, true], nobody: [false, false, false, false] };
    for (const [who, expect] of Object.entries(table)) {
      const F = await makeApp(PEOPLE[who]).flowForms();
      assert.deepEqual(ids.map((id) => F.canOpen(id)), expect, who);
      assert.equal(F.canOpen('nope'), false);
    }
  });

  it('open: builds the page and hands it to openPrintableDoc with downloadPdf, the file name, the JPEG quality, the navy accent — and returns { ok, number, fileName }', async () => {
    const app = makeApp(PEOPLE.uriel); const F = await app.flowForms(); const { ref } = salesPreload();
    const res = await F.open('sales_order', ref);
    assert.equal(res.ok, true, res.error); assert.equal(res.number, 'SO-123456'); assert.equal(res.fileName, 'SO-123456.pdf');
    assert.equal(app.log.open.length, 1);
    const o = app.log.open[0];
    assert.equal(o.downloadPdf, true); assert.equal(o.fileName, 'SO-123456.pdf'); assert.equal(o.pdfQuality, 0.85); assert.equal(o.accent, '#1F3A5F'); assert.equal(o.pageId, 'frm-page');
    assert.equal(o.title, 'Sales Order — SO-123456'); assert.equal(o.barLabel, 'Sales Order — SO-123456'); assert.ok(!o.watermark);
    assert.match(o.bodyHtml, /<div class="fh-title">SALES ORDER<\/div>/); assert.match(o.pageCss, /\.fh-header\{/);
    assert.deepEqual(app.log.toasts, []);
    assert.ok(app.log.loaded.includes('js/forms-set-1.js'), 'the body set loaded on first use'); assert.ok(!app.log.loaded.includes('js/screens/production.js'), 'a sales order needs nothing from production.js');
  });
  it('open: the job order loads production.js for its helpers, takes opts.rev, and autoDownload clicks Download PDF after the panel is up', async () => {
    const app = makeApp(PEOPLE.rene); const F = await app.flowForms(); const { fx } = salesPreload();
    fx.project.joNumber = 'JO-0012'; fx.project.joRev = 1;
    const res = await F.open('job_order', { record: fx.project, order: fx.order }, { autoDownload: true });
    assert.equal(res.ok, true, res.error); assert.equal(res.number, 'JO-0012'); assert.equal(res.fileName, 'JO-0012-R1.pdf');
    assert.ok(app.log.loaded.includes('js/screens/production.js'));
    assert.match(app.log.open[0].bodyHtml, /WORKFORCE COPY — NO PRICES/);
    assert.doesNotMatch(app.log.open[0].bodyHtml, /₱/);
    const t = app.log.timers.find(([, ms]) => ms === 350); assert.ok(t, 'autoDownload schedules the click'); t[0]();
    assert.deepEqual(app.log.clicks, ['pdf-btn']);
    const plainOpen = makeApp(PEOPLE.rene); const G = await plainOpen.flowForms();
    await G.open('job_order', { record: fx.project, order: fx.order }); assert.equal(plainOpen.log.timers.filter(([, ms]) => ms === 350).length, 0, 'no autoDownload by default');
  });
  it('open: an earlier revision is watermarked SUPERSEDED', async () => {
    const app = makeApp(PEOPLE.uriel); const F = await app.flowForms(); const { fx } = salesPreload();
    fx.order.soNumber = 'SO-0012'; fx.order.contractRev = 2; fx.order.originalContractAmount = 100000;
    fx.order.revisions = [{ revNo: 1, toAmount: 120000, fromAmount: 100000, decidedAt: '2026-11-18T09:00:00Z', arAfter: 55000 }, { revNo: 2, toAmount: 150000, decidedAt: '2026-11-19T09:00:00Z', arAfter: 75000 }];
    const r = await F.open('sales_order', { record: fx.order, project: fx.project }, { rev: 1 });
    assert.equal(r.ok, true, r.error); assert.equal(r.fileName, 'SO-0012-R1.pdf'); assert.equal(app.log.open[0].watermark, 'SUPERSEDED');
  });
  it('open: refusals are plain sentences, toasted, never thrown — no access, unknown form, record not found, record not readable, a price in the notes, a panel that throws', async () => {
    const { fx, ref } = salesPreload();
    const rene = makeApp(PEOPLE.rene); const R = await rene.flowForms();
    assert.deepEqual(plain(await R.open('sales_order', ref)), { ok: false, error: 'You do not have access to this document.' });
    assert.deepEqual(rene.log.toasts, [['You do not have access to this document.', 'error']]); assert.equal(rene.log.open.length, 0);
    assert.ok(!rene.log.loaded.includes('js/forms-set-1.js'), 'a viewer outside the audience loads no form code');
    const app = makeApp(PEOPLE.uriel); const F = await app.flowForms();
    assert.deepEqual(plain(await F.open('nope', ref)), { ok: false, error: 'That document is not available.' });
    assert.deepEqual(plain(await F.open('sales_order', { orderId: 'ordMissing' })), { ok: false, error: 'Could not load the record. Check your connection and try again.' }, 'no database at all');
    const fake = createFake(); app.box.db = fake.db;
    assert.deepEqual(plain(await F.open('sales_order', { orderId: 'ordMissing' })), { ok: false, error: 'We could not find that record.' });
    const priced = fixtures(); priced.project.jobOrder.instructions = 'collect ₱5,000 on delivery';
    const R2 = await rene.flowForms();
    assert.deepEqual(plain(await R2.open('job_order', { record: priced.project, order: priced.order })), { ok: false, error: 'This form has a price in its notes. Remove it, then try again.' });
    assert.equal(rene.log.open.length, 0, 'nothing was shown');
    app.box.openPrintableDoc = () => { throw new Error('panel exploded'); };
    assert.deepEqual(plain(await F.open('sales_order', ref)), { ok: false, error: 'This document could not be opened.' });
    assert.equal(app.log.errors.length >= 1, true, 'the cause is logged for us');
    void fx;
  });

  it('downloadPdf: the same build straight to the PDF through exportPrintableDocPdf (no panel); failures are plain', async () => {
    const app = makeApp(PEOPLE.uriel); const F = await app.flowForms(); const { ref } = salesPreload();
    const res = await F.downloadPdf('sales_order', ref);
    assert.deepEqual(plain(res), { ok: true, fileName: 'SO-123456.pdf' });
    assert.equal(app.log.open.length, 0, 'no panel'); assert.equal(app.log.exports.length, 1);
    const o = app.log.exports[0];
    assert.equal(o.fileName, 'SO-123456.pdf'); assert.equal(o.pdfQuality, 0.85); assert.equal(o.pageId, 'frm-page'); assert.equal(o.title, 'Sales Order — SO-123456');
    assert.match(o.bodyHtml, /fh-title">SALES ORDER/); assert.match(o.pageCss, /\.fh-header/); assert.ok(!('downloadPdf' in o));
    app.box.exportPrintableDocPdf = async () => ({ ok: false, error: 'Could not generate the PDF — boom' });
    assert.deepEqual(plain(await F.downloadPdf('sales_order', ref)), { ok: false, fileName: 'SO-123456.pdf', error: 'Could not generate the PDF — boom' });
    assert.deepEqual(app.log.toasts.pop(), ['Could not generate the PDF — boom', 'error']);
    app.box.exportPrintableDocPdf = async () => { throw new Error('x'); };
    assert.deepEqual(plain(await F.downloadPdf('sales_order', ref)), { ok: false, error: 'The PDF could not be made.' });
    delete app.box.exportPrintableDocPdf;
    assert.deepEqual(plain(await F.downloadPdf('sales_order', ref)), { ok: false, error: 'The PDF export is not available.' });
    assert.deepEqual(plain(await F.downloadPdf('payment_ack', { ...ref, record: { ...ref.record, status: 'pending' } })).ok, false);
    const R = await makeApp(PEOPLE.rene).flowForms();
    assert.deepEqual(plain(await R.downloadPdf('sales_order', ref)), { ok: false, error: 'You do not have access to this document.' });
  });

  it('assignNumbers NEVER throws: with no database it returns the §9.5 fallbacks; junk in, {} out', async () => {
    const app = makeApp(PEOPLE.shaira); const F = await app.flowForms();
    const out = await F.assignNumbers(['sales_order', 'payment_ack', 'job_order', 'nope'], { orderId: 'ordAbCdEf123456', projectId: 'projXyz1' });
    assert.equal(out.sales_order, 'SO-123456'); assert.equal(out.payment_ack, 'PA-123456'); assert.equal(typeof out.job_order, 'string'); assert.equal(out.nope, '');
    for (const junk of [undefined, null, 'sales_order', 5, {}]) assert.deepEqual(plain(await F.assignNumbers(junk, {})), {});
    assert.equal(typeof (await F.assignNumbers(['sales_order'], undefined)).sales_order, 'string');
  });
  it('assignNumbers: a failed production.js load costs only the JO fallback, never the serial; an engine that cannot load returns \'\' for every requested id — still no throw', async () => {
    const app = makeApp(PEOPLE.shaira); const F = await app.flowForms(); const fx = fixtures();
    const fake = createFake(); app.box.db = fake.db;
    fake.seed('sales_orders/ordAbCdEf123456', plain(fx.order)); fake.seed('job_projects/projXyz1', plain(fx.project));
    app.log.fail.add('js/screens/production.js');                                   // offline: the job-order helpers never arrive
    assert.deepEqual(plain(await F.assignNumbers(['sales_order', 'job_order'], { orderId: 'ordAbCdEf123456', projectId: 'projXyz1' })), { sales_order: 'SO-0001', job_order: 'JO-0001' });
    assert.equal(fake.read('job_projects/projXyz1').joNumber, 'JO-0001');
    const dead = makeApp(PEOPLE.shaira); dead.log.fail.add('js/forms-core.js');
    await dead.box.ensureScript('js/forms.js');
    assert.deepEqual(plain(await dead.box.Forms.assignNumbers(['sales_order', 'job_order'], { orderId: 'o1' })), { sales_order: '', job_order: '' });
    assert.deepEqual(plain(await dead.box.Forms.assignNumbers(undefined, {})), {});
  });
  it('assignNumbers stores ONE serial for the sales order and the job order through the real db binding, for the signed-in viewer\'s rights', async () => {
    const app = makeApp(PEOPLE.shaira); const F = await app.flowForms(); const fx = fixtures();
    const fake = createFake(); app.box.db = fake.db;
    fake.seed('sales_orders/ordAbCdEf123456', plain(fx.order)); fake.seed('job_projects/projXyz1', plain(fx.project));
    const out = await F.assignNumbers(['sales_order', 'job_order'], { orderId: 'ordAbCdEf123456', projectId: 'projXyz1' });
    assert.deepEqual(plain(out), { sales_order: 'SO-0001', job_order: 'JO-0001' });
    assert.equal(fake.read('sales_orders/ordAbCdEf123456').soNumber, 'SO-0001'); assert.equal(fake.read('job_projects/projXyz1').joNumber, 'JO-0001'); assert.equal(fake.read('_counters/form_SO').count, 1);
    assert.ok(app.log.loaded.includes('js/screens/production.js'), 'joNumber\'s fallback needs production.js, loaded before the numbers are worked out');
    // a Production login may store the job order number only
    const rene = makeApp(PEOPLE.rene); const R = await rene.flowForms(); const fake2 = createFake(); rene.box.db = fake2.db;
    fake2.seed('sales_orders/ordAbCdEf123456', plain(fx.order)); fake2.seed('job_projects/projXyz1', plain(fx.project));
    const o2 = await R.assignNumbers(['job_order', 'sales_order'], { orderId: 'ordAbCdEf123456', projectId: 'projXyz1' });
    assert.equal(o2.job_order, 'JO-0001'); assert.equal(o2.sales_order, 'SO-0001', 'the sales order reads the serial the job carries'); assert.equal(fake2.read('sales_orders/ordAbCdEf123456').soNumber, undefined);
  });
  it('nextNumber: the next serial of a series from its counter — the job order draws from the SALES ORDER\'s counter (one serial)', async () => {
    const app = makeApp(PEOPLE.shaira); const F = await app.flowForms();
    assert.equal(await F.nextNumber('PA'), 'PA-0012'); assert.equal(await F.nextNumber('SO'), 'SO-0012'); assert.equal(await F.nextNumber('JO'), 'JO-0012');
    assert.deepEqual(app.log.counters, ['form_PA', 'form_SO', 'form_SO']);
  });

  it('offer: "Documents ready" lists only the forms the viewer may open — title, number, View, Download PDF — and the buttons drive open / downloadPdf', async () => {
    const { fx } = salesPreload();
    const ref = { order: fx.order, project: fx.project };
    const app = makeApp(PEOPLE.uriel); const F = await app.flowForms();
    const wrap = { listeners: [], addEventListener(t, fn) { this.listeners.push([t, fn]); } };
    app.box.document = { querySelector: (sel) => (sel === '#modal-body .forms-offer' ? wrap : null) };
    await F.offer(['sales_order', 'job_order', 'payment_ack', 'nope'], ref, { rev: 0 });
    assert.equal(app.log.modals.length, 1); assert.equal(app.log.modals[0].title, 'Documents ready');
    const m = app.log.modals[0].html;
    assert.deepEqual([...m.matchAll(/data-forms-act="view" data-form="([a-z_]+)"/g)].map((x) => x[1]), ['sales_order', 'job_order', 'payment_ack']);
    assert.deepEqual([...m.matchAll(/data-forms-act="pdf" data-form="([a-z_]+)"/g)].map((x) => x[1]), ['sales_order', 'job_order', 'payment_ack']);
    for (const t of ['Sales Order', 'Job Order', 'Payment Acknowledgement', 'SO-123456', 'PA-123456', 'Download PDF', 'View']) assert.ok(m.includes(t), t);
    // the clicks
    const calls = []; app.box.Forms.open = (...a) => { calls.push(['open', ...a]); }; app.box.Forms.downloadPdf = (...a) => { calls.push(['pdf', ...a]); };      // on the base object: the sheet's handlers look the methods up when tapped
    const handler = wrap.listeners.find(([t]) => t === 'click')[1];
    const click = (act, id) => handler({ target: { closest: () => ({ getAttribute: (k) => (k === 'data-forms-act' ? act : id) }) } });
    click('view', 'sales_order'); click('pdf', 'job_order'); handler({ target: { closest: () => null } }); handler({ target: {} });
    assert.deepEqual(calls.map((c) => [c[0], c[1]]), [['open', 'sales_order'], ['pdf', 'job_order']]); assert.equal(calls[0][2], ref); assert.deepEqual(calls[0][3], { rev: 0 });
    assert.equal(app.log.busy.length, 2, 'each tap is wrapped in busy() when it exists');
    const R = makeApp(PEOPLE.rene); const RF = await R.flowForms(); R.box.document = app.box.document;
    await RF.offer(['sales_order', 'job_order', 'payment_ack', 'handoff_pack'], ref);
    assert.deepEqual([...R.log.modals[0].html.matchAll(/data-forms-act="view" data-form="([a-z_]+)"/g)].map((x) => x[1]), ['job_order', 'handoff_pack']);
    const N = makeApp(PEOPLE.nobody); const NF = await N.flowForms(); await NF.offer(['sales_order', 'job_order'], ref); assert.equal(N.log.modals.length, 0, 'nothing to offer → no sheet');
    await NF.offer(undefined, undefined); await NF.offer(['sales_order'], null);          // junk never throws
  });

  it('bind: ONE click listener per container; a tap on [data-form] opens the form with the ids in data-ref (and data-rev); anything else is ignored; bad JSON is {}', async () => {
    const app = makeApp(PEOPLE.uriel); const F = await app.flowForms();
    const calls = []; app.box.Forms.open = (...a) => { calls.push(a); return Promise.resolve({ ok: true }); };
    const container = { listeners: [], addEventListener(t, fn) { this.listeners.push([t, fn]); }, contains: () => true };
    F.bind(container); F.bind(container);
    assert.equal(container.listeners.length, 1); assert.equal(container._formsBound, true);
    const handler = container.listeners[0][1];
    const mk = (attrs) => ({ target: { closest: () => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) }) }, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
    const ev1 = mk({ 'data-form': 'sales_order', 'data-ref': '{"orderId":"o1"}' }); handler(ev1);
    assert.deepEqual(calls[0].slice(0, 2).map(plain), ['sales_order', { orderId: 'o1' }]); assert.deepEqual(plain(calls[0][2]), {}); assert.equal(ev1.prevented, true); assert.equal(ev1.stopped, true);
    handler(mk({ 'data-form': 'job_order', 'data-ref': '{"projectId":"p1"}', 'data-rev': '2' })); assert.deepEqual(plain(calls[1][2]), { rev: 2 });
    handler(mk({ 'data-form': 'job_order', 'data-ref': '{not json' })); assert.deepEqual(plain(calls[2][1]), {});
    handler({ target: { closest: () => null }, preventDefault() { throw new Error('must not swallow other clicks'); } }); handler({ target: null }); assert.equal(calls.length, 3);
    assert.equal(app.log.busy.length, 3, 'wrapped in busy() when the app has it');
    for (const junk of [null, undefined, {}, 5]) F.bind(junk);              // never throws
    const elsewhere = { listeners: [], addEventListener(t, fn) { this.listeners.push([t, fn]); }, contains: () => false };
    F.bind(elsewhere); elsewhere.listeners[0][1](mk({ 'data-form': 'sales_order' })); assert.equal(calls.length, 3, 'a button outside the container is not ours');
  });
});

// 5. RULES IN STEP: the engine lets Sales store `soNumber` only because firestore.rules (QF's C4, deployed 2026-11-20) lists it as a Sales
//    hand-off key. If either side changes alone, a Sales login either prints a fallback number or gets a refused write.
describe('forms ↔ firestore.rules: Sales may store the SO number', () => {
  it('ships salesMayWriteSoNumber = true, and the rules list soNumber and paNumber as Sales hand-off keys', () => {
    const core = read('js/forms-core.js');
    assert.match(core, /FC\.RULES = \{ salesMayWriteSoNumber: true \};/);
    const rules = read('firestore.rules');
    const m = rules.match(/function soHandoffKeys\(\)\s*\{\s*return \[([\s\S]*?)\];/);
    assert.ok(m, 'soHandoffKeys() is in firestore.rules');
    assert.match(m[1], /'soNumber'/);
    assert.match(m[1], /'paNumber'/);
  });
});
