// tests/forms-pdf.test.mjs — js/forms-pdf.js, the ONE standalone "Download PDF" path (window.FormsPdf), specs/SALES-FLOW-SPEC-2026-11-19.md §9.4 and the
// coordinator's 2026-11-19 ruling: the forms engine's A4 preview AND the quote builder's printed Quotation both call it.
//
// WHAT IT PINS
//   1. STANDALONE   the file names nothing of the operations app (no data layer, sign-in, script loader, forms engine, letterhead), loads only its two
//                   same-origin vendored files itself (from the folder it was loaded from, with the same ?v=), and RUNS in an empty JavaScript
//                   context given only a DOM-ish `document` — the behavioural proof of the textual scan.
//   2. PURE MATH    file-name cleaning (the same stem rule print-docs.js applies), A4 page height, allowed cut positions (never directly after a heading /
//                   table header / category band), page bands (cut at the last allowed row boundary, forced cut only when none fits, always progress,
//                   always end at the bottom), canvas scale cap, slice rectangles, dependency URLs.
//   3. download()   with a fake DOM + the REAL js/pdf-lite.js: a string or an Element becomes a multi-page PDF cut where the bands say, the host is
//                   removed afterwards, a failing big canvas retries at scale 1, delivery is the share sheet only on a touch device that can share files
//                   and a plain download everywhere else, and it NEVER throws — every failure is { ok:false, error }.
// Mutation-checked by hand (scratch copy, one break at a time): see the commit report.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { File as NodeFile } from 'node:buffer';
import { ROOT, read } from './fixtures/forms-env.mjs';

const require = createRequire(import.meta.url);
const FP = require('../js/forms-pdf.js');
const SRC = read('js/forms-pdf.js');
const PDF_LITE = read('js/pdf-lite.js');

describe('1. standalone: needs nothing from the operations app', () => {
  it('names none of the app\'s globals — not even in a comment (the quote builder iframe has none of them)', () => {
    const banned = ['db', 'auth', 'firebase', 'Forms', 'FormsCore', 'FormsBodies', 'ensureScript', 'openPage', 'openPrintableDoc', 'exportPrintableDocPdf', 'navigateTo', 'buildLetterhead',
      'Letterhead', 'escHtml', 'Notifs', 'currentUser', 'currentRole', 'currentDepts', 'userProfile', 'dbCachedGet', 'APP_VERSION', 'Drive', 'lucide', 'ScrollLock', 'jobOrderNoFor'];
    for (const word of banned) assert.ok(!new RegExp(`\\b${word}\\b`).test(SRC), `forms-pdf.js mentions "${word}"`);
    assert.ok(!/letterhead/i.test(SRC) && !/firebase/i.test(SRC));
    assert.ok(!/\bwindow\.(db|auth|firebase|Forms)\b/.test(SRC));
  });
  it('uses exactly two vendored files, loaded by itself: html2canvas and pdf-lite, same folder as the script (the folder is not hard-coded)', () => {
    const pairs = [...SRC.matchAll(/loadOnce\('([A-Za-z0-9_]+)',\s*'([^']+)'\)/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(pairs, [['html2canvas', 'vendor/html2canvas.min.js'], ['jpegToPdf', 'pdf-lite.js']]);
    assert.equal((SRC.match(/createElement\('script'\)/g) || []).length, 1, 'one loader');
    for (const [, rel] of pairs) assert.ok(fs.existsSync(path.join(ROOT, 'js', rel)), `js/${rel} is missing`);
    assert.deepEqual([...SRC.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]).filter((u) => !/^https?:\/\/localhost\/?$/.test(u)), [], 'no external URL — only the same-origin files');
    assert.match(SRC, /document\.currentScript/);
    assert.ok(!/<script[\s>]/i.test(SRC));
  });
  it('is not part of the app kit and is precached for offline use; the two vendored files are precached too', () => {
    const idx = read('index.html'), sw = read('sw.js');
    assert.ok(!/forms-pdf\.js/.test(idx), 'a lazy file must never be a <script> in index.html (CLAUDE.md app-kit rule)');
    for (const f of ['/js/forms-pdf.js', '/js/vendor/html2canvas.min.js', '/js/pdf-lite.js']) assert.ok(sw.includes(`'${f}',`), `${f} is not in sw.js PRECACHE`);
  });
  it('loads and runs in an EMPTY JavaScript context (no window, no db, no auth, no loader) and exposes the whole API', () => {
    const box = {}; vm.createContext(box);
    vm.runInContext(SRC, box, { filename: 'forms-pdf.js' });
    assert.equal(typeof box.FormsPdf, 'object');
    for (const fn of ['download', 'ensureDeps', 'cleanFileName', 'isLandscape', 'pageHeightPx', 'allowedCuts', 'pageBands', 'fitScale', 'sliceRects', 'depUrl']) assert.equal(typeof box.FormsPdf[fn], 'function', fn);
    assert.equal(typeof box.FormsPdf.DEFAULT_CUT, 'string'); assert.equal(typeof box.FormsPdf.DEFAULT_KEEP, 'string');
    assert.equal(box.FormsPdf.A4_W, 595.28); assert.equal(box.FormsPdf.A4_H, 841.89);
  });
  it('the Node export is the same API (the money-core shim style)', () => {
    assert.deepEqual(Object.keys(FP).sort(), ['A4_H', 'A4_W', 'DEFAULT_CUT', 'DEFAULT_KEEP', 'allowedCuts', 'cleanFileName', 'depUrl', 'download', 'ensureDeps', 'fitScale', 'isLandscape', 'pageBands', 'pageHeightPx', 'sliceRects']);
  });
  it('with no browser at all, download() RESOLVES { ok:false, error } — it never throws, never rejects; so does ensureDeps() (a plain message)', async () => {
    const box = {}; vm.createContext(box);
    vm.runInContext(SRC, box);
    const res = await box.FormsPdf.download('<p>x</p>', 'SO-0012-R1.pdf');
    assert.equal(res.ok, false); assert.equal(res.fileName, 'SO-0012-R1.pdf'); assert.match(res.error, /^Could not generate the PDF — /);
    await assert.rejects(box.FormsPdf.ensureDeps(), (e) => e.message === 'Could not load the PDF export library — check your connection and try again.');
    for (const bad of [undefined, null, 5, {}]) { const r = await box.FormsPdf.download(bad, 'x'); assert.equal(r.ok, false); assert.equal(typeof r.error, 'string'); }
  });
});

describe('2. the pure helpers', () => {
  const printDocsSanitise = (() => { const m = read('js/print-docs.js').match(/function _sanitizeDocName\(title\) \{[\s\S]*?\n  \}/); return new Function(`${m[0]}\nreturn _sanitizeDocName;`)(); })();

  it('cleanFileName: ".pdf" added once, letters / digits / hyphens only — exactly the stem rule print-docs.js applies', () => {
    assert.equal(FP.cleanFileName('SO-0012-R1'), 'SO-0012-R1.pdf');
    assert.equal(FP.cleanFileName('SO-0012-R1.pdf'), 'SO-0012-R1.pdf');
    assert.equal(FP.cleanFileName('Quotation-BK-ML-FB-261119-001-R3.PDF'), 'Quotation-BK-ML-FB-261119-001-R3.pdf');
    assert.equal(FP.cleanFileName('Sales Order — SO-0012 R1'), 'SalesOrderSO-0012R1.pdf');
    assert.equal(FP.cleanFileName('JO-0012 R1.pdf  '), 'JO-0012R1.pdf');
    for (const empty of ['', null, undefined, '.pdf', '   ', '///', '日本語']) assert.equal(FP.cleanFileName(empty), 'document.pdf', JSON.stringify(empty));
    for (const hostile of ['../../etc/passwd', 'a/b\\c:d*e?f"g<h>i|j', 'x\u0000y', 'ünï-cødé', 'a.b.c', '-', '--'])
      assert.match(FP.cleanFileName(hostile), /^[A-Za-z0-9-]+\.pdf$/, hostile);
    for (const stem of ['SO-0012-R1', 'Quotation-BK-ML-FB-261119-001-R3', 'Sales Order — SO-0012 R1', 'a/b\\c', 'Résumé 2026', '日本語', '', 'x y z', 'PA-0031'])
      assert.equal(FP.cleanFileName(stem), printDocsSanitise(stem) + '.pdf', `parity with print-docs for ${JSON.stringify(stem)}`);
  });
  it('isLandscape: an explicit true/false wins; otherwise a sheet wider than 950 px is landscape', () => {
    assert.equal(FP.isLandscape(794), false); assert.equal(FP.isLandscape(1123), true); assert.equal(FP.isLandscape(950), false); assert.equal(FP.isLandscape(951), true);
    assert.equal(FP.isLandscape(1123, false), false); assert.equal(FP.isLandscape(794, true), true); assert.equal(FP.isLandscape(794, undefined), false); assert.equal(FP.isLandscape(NaN), false);
  });
  it('pageHeightPx: one A4 page at the content width — 794 px → 1123 px portrait; 1123 px → 794 px landscape', () => {
    assert.ok(Math.abs(FP.pageHeightPx(794, false) - 1123) < 1);
    assert.ok(Math.abs(FP.pageHeightPx(1123, true) - 794) < 1);
    assert.ok(Math.abs(FP.pageHeightPx(400, false) - 400 * FP.A4_H / FP.A4_W) < 1e-9);
  });

  it('allowedCuts: every candidate top, ascending, unique, > 0 (rounded)', () => {
    assert.deepEqual(FP.allowedCuts([300, 0, 100, 100, 500, -4], []), [100, 300, 500]);
    assert.deepEqual(FP.allowedCuts([100.4, 250.6, 251.2], null), [100, 251], '250.6 and 251.2 are the same cut after rounding');
    assert.deepEqual(FP.allowedCuts(undefined, undefined), []);
    assert.deepEqual(FP.allowedCuts([NaN, Infinity, 'x', 50], []), [50]);
  });
  it('allowedCuts: never the FIRST candidate after a heading / table header / category band — the heading would sit alone at the foot of a page', () => {
    assert.deepEqual(FP.allowedCuts([100, 200, 300, 400], [100]), [100, 300, 400], 'cut above the heading is fine, cut right below it is not');
    assert.deepEqual(FP.allowedCuts([100, 200, 300, 400], [100, 300]), [100, 300], 'two headings forbid 200 and 400');
    assert.deepEqual(FP.allowedCuts([100, 200, 300], [150]), [100, 300], 'a heading that is not itself a candidate still forbids the next one');
    assert.deepEqual(FP.allowedCuts([100, 200, 300], [100, 120]), [100, 300], 'two keep points before the same candidate forbid it once');
    assert.deepEqual(FP.allowedCuts([100, 200], [200]), [100, 200], 'a heading with nothing after it forbids nothing');
    assert.deepEqual(FP.allowedCuts([100, 200, 300], [0]), [200, 300], 'a heading at the very top forbids the first candidate below it');
  });
  it('allowedCuts: the signature row is kept with the footer under it — a sheet a few px over one page does not end with a footer-only page', () => {
    assert.match(FP.DEFAULT_KEEP, /\.sig-row/); assert.match(FP.DEFAULT_KEEP, /\.sec-title/); assert.match(FP.DEFAULT_KEEP, /thead tr/); assert.match(FP.DEFAULT_KEEP, /\.cat-row/);
    assert.match(FP.DEFAULT_CUT, /\.sig-row/); assert.match(FP.DEFAULT_CUT, /\.print-footer/); assert.match(FP.DEFAULT_CUT, /\btr\b/);
    // a real 3-item Sales Order measured in the browser: 1174 px tall, candidates …853 923 985(sig-row) 1085(footer)
    const cuts = FP.allowedCuts([190, 256, 372, 409, 430, 501, 527, 549, 578, 606, 651, 671, 701, 758, 853, 923, 985, 1085], [259, 609, 704, 760, 985]);
    assert.ok(!cuts.includes(1085), 'no cut right above the footer'); assert.ok(cuts.includes(985), 'a cut above the signature row is fine');
    assert.deepEqual(FP.pageBands(cuts, 1174, 1122.94), [[0, 985], [985, 1174]], 'the signatures and the footer travel together to page 2');
    assert.deepEqual(FP.pageBands(FP.allowedCuts([190, 985, 1085], []), 1174, 1122.94), [[0, 1085], [1085, 1174]], 'without the keep rule it would be a footer-only page');
  });
  it('pageBands: one page → one band; a sheet at most 2 px over the page is still one page', () => {
    assert.deepEqual(FP.pageBands([], 1000, 1123), [[0, 1000]]);
    assert.deepEqual(FP.pageBands([500], 1125, 1123), [[0, 1125]]);
    assert.deepEqual(FP.pageBands([500], 1126, 1123).length, 2);
    assert.deepEqual(FP.pageBands(undefined, 800, 1123), [[0, 800]]);
  });
  it('pageBands: each page ends at the LAST allowed cut that fits; the next page starts exactly there', () => {
    assert.deepEqual(FP.pageBands([400, 900, 1000, 1200], 2000, 1123), [[0, 1000], [1000, 2000]]);
    assert.deepEqual(FP.pageBands([300, 700, 1000, 1100, 1500, 1900, 2200, 2600], 3000, 1122.94), [[0, 1100], [1100, 2200], [2200, 3000]]);
  });
  it('pageBands: a cut that would leave the page under 35% full is skipped; with no usable cut the page is cut at the page boundary (never an endless loop)', () => {
    assert.deepEqual(FP.pageBands([100], 2000, 1123), [[0, 1123], [1123, 2000]]);
    assert.deepEqual(FP.pageBands([], 5000, 1000), [[0, 1000], [1000, 2000], [2000, 3000], [3000, 4000], [4000, 5000]]);
    assert.deepEqual(FP.pageBands([100], 2000, 1123, 0.05), [[0, 100], [100, 1223], [1223, 2000]], 'a custom minFill is honoured');
  });
  it('pageBands, 400 random sheets: contiguous from 0 to the bottom, never taller than a page, every inner cut is an allowed cut or the page boundary', () => {
    let seed = 20261119; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 400; n++) {
      const totalH = 200 + Math.floor(rnd() * 9000), pageH = rnd() < 0.2 ? 794 : 1122.94;
      const cands = Array.from({ length: Math.floor(rnd() * 45) }, () => Math.floor(rnd() * totalH));
      const keeps = cands.filter(() => rnd() < 0.15);
      const cuts = FP.allowedCuts(cands, keeps);
      const bands = FP.pageBands(cuts, totalH, pageH);
      assert.equal(bands[0][0], 0); assert.equal(bands[bands.length - 1][1], totalH);
      bands.forEach((b, i) => {
        assert.ok(b[1] > b[0], `band ${i} is empty (${JSON.stringify(bands)})`);
        assert.ok(b[1] - b[0] <= pageH + 2, `band ${i} is taller than a page`);
        if (i) assert.equal(b[0], bands[i - 1][1], 'bands are contiguous');
        if (i < bands.length - 1) assert.ok(cuts.includes(b[1]) || b[1] === Math.round(b[0] + pageH), `cut ${b[1]} is neither an allowed cut nor the page boundary`);
      });
      assert.equal(bands.length, Math.max(1, bands.length)); assert.ok(bands.length >= Math.ceil((totalH - 2) / pageH));
    }
  });
  it('a heading is never stranded at the foot of a page: the cut goes above it', () => {
    const cuts = FP.allowedCuts([0, 400, 1000, 1100, 1500], [1000]);
    assert.deepEqual(cuts, [400, 1000, 1500]);
    assert.deepEqual(FP.pageBands(cuts, 2000, 1122.94), [[0, 1000], [1000, 2000]], 'page 1 ends where the heading starts (not at 1100, right under it); the heading and its first rows lead page 2');
  });

  it('fitScale: the wanted scale, lowered to keep width × height × scale² under 12 MP (a phone\'s canvas cap), never below 1', () => {
    assert.equal(FP.fitScale(794, 1123, 2), 2);
    assert.equal(FP.fitScale(794, 3000, 2), 2);
    assert.equal(FP.fitScale(794, 20000, 2), 1, 'a very long sheet is clamped to 1');
    const mid = FP.fitScale(1000, 5000, 2); assert.ok(mid > 1 && mid < 2); assert.ok(1000 * 5000 * mid * mid <= 12e6 + 1);
    assert.equal(FP.fitScale(794, 1123, 0), 2, 'no usable wish → the default'); assert.equal(FP.fitScale(794, 1123, 'x'), 2); assert.equal(FP.fitScale(0, 0, 2), 2);
    assert.equal(FP.fitScale(794, 1123, 1), 1); assert.equal(FP.fitScale(794, 1123, 0.5), 1, 'never below 1');
  });
  it('sliceRects: source rectangles in canvas px, clipped to the page and to what is left of the canvas', () => {
    assert.deepEqual(FP.sliceRects([[0, 1000], [1000, 2000]], 2, 2246, 4000), [{ sy: 0, sh: 2000 }, { sy: 2000, sh: 2000 }]);
    assert.deepEqual(FP.sliceRects([[0, 1000], [1000, 2000]], 2, 2246, 3500), [{ sy: 0, sh: 2000 }, { sy: 2000, sh: 1500 }], 'the canvas ends early');
    assert.deepEqual(FP.sliceRects([[0, 2000]], 1, 1123, 2000), [{ sy: 0, sh: 1123 }], 'never taller than one page');
    assert.deepEqual(FP.sliceRects([[500, 500]], 1, 1123, 2000), [{ sy: 500, sh: 0 }]);
    assert.deepEqual(FP.sliceRects([[0, 100]], 1.5, 1123, 2000), [{ sy: 0, sh: 150 }]);
  });
  it('depUrl: a sibling of this script, same folder, same ?v= (the loader never hard-codes a folder)', () => {
    assert.equal(FP.depUrl('https://x.test/app/js/forms-pdf.js?v=14.0.372', 'vendor/html2canvas.min.js', 'https://x.test/app/'), 'https://x.test/app/js/vendor/html2canvas.min.js?v=14.0.372');
    assert.equal(FP.depUrl('https://x.test/app/js/forms-pdf.js?v=14.0.372', 'pdf-lite.js', 'https://x.test/app/'), 'https://x.test/app/js/pdf-lite.js?v=14.0.372');
    assert.equal(FP.depUrl('js/forms-pdf.js?v=1', 'pdf-lite.js', 'http://localhost/quote/'), 'http://localhost/quote/js/pdf-lite.js?v=1', 'a relative script URL resolves against the page');
    assert.equal(FP.depUrl('', 'pdf-lite.js', 'https://x.test/index.html'), 'https://x.test/js/pdf-lite.js', 'script URL unknown → the /js/ folder');
    assert.equal(FP.depUrl('http://[bad', 'pdf-lite.js'), 'pdf-lite.js', 'never throws');
  });
});

// ── a fake browser: the smallest DOM the file touches, plus the REAL js/pdf-lite.js ────────────────────────────────────────
function makeBrowser(o) {
  o = Object.assign({ width: 794, height: 3000, cutYs: [], keepYs: [], touch: false, canShare: false, preload: true, currentScript: null, html2canvasImpl: null, shareImpl: null, onScript: null }, o || {});
  const log = { created: [], appended: [], removed: [], clicks: [], html2canvas: [], pdfPages: null, drawn: [], qualities: [], timers: [], shared: [], objectUrls: [], revoked: [], scripts: [] };
  // a candidate block at y — or { y, above, ghost }: a child poking `above` px over its top edge (the signature role label), and a size-less child at the very top
  // of the page (a display:none element / <style>) that must be ignored
  const rect = (c) => {
    const y = typeof c === 'number' ? c : c.y;
    const kids = typeof c === 'number' ? [] : [{ getBoundingClientRect: () => ({ top: y - (c.above || 0), width: 90, height: 13 }) }, ...(c.ghost ? [{ getBoundingClientRect: () => ({ top: 0, width: 0, height: 0 }) }] : [])];
    return { getBoundingClientRect: () => ({ top: y, width: 700, height: 80 }), querySelectorAll: () => kids };
  };
  const ctx = { fillStyle: '', fillRect() {}, drawImage(...a) { log.drawn.push(a); } };
  const box = { console, File: NodeFile, Blob };
  box.window = box;
  vm.createContext(box);
  box.URL = class extends URL { static createObjectURL(f) { log.objectUrls.push(f); return 'blob:fake'; } static revokeObjectURL(u) { log.revoked.push(u); } };
  box.setTimeout = (fn, ms) => { log.timers.push([fn, ms]); return log.timers.length; };
  box.clearTimeout = () => {};
  const mkEl = (tag) => {
    const el = {
      tag, nodeType: 1, style: {}, attrs: {}, children: [], offsetWidth: o.width, offsetHeight: o.height,
      setAttribute(k, v) { el.attrs[k] = v; }, appendChild(c) { el.children.push(c); log.appended.push([el, c]); return c; },
      remove() { log.removed.push(el); }, click() { log.clicks.push(el); }, addEventListener() {},
      querySelectorAll(sel) { return sel === FP.DEFAULT_CUT ? o.cutYs.map(rect) : sel === FP.DEFAULT_KEEP ? o.keepYs.map(rect) : []; },
      getBoundingClientRect() { return { top: 0 }; },
      getContext() { return ctx; },
      // a blob whose bytes are an ArrayBuffer of the SANDBOX's realm — pdf-lite (running in the sandbox) tests `instanceof ArrayBuffer`, as it would in a page
      toBlob(cb, type, q) { log.qualities.push(q); cb({ type, arrayBuffer: async () => vm.runInContext('new Uint8Array([255, 216, 255, 217]).buffer', box) }); },
    };
    log.created.push(el);
    return el;
  };
  const head = mkEl('head');
  head.appendChild = (s) => { log.scripts.push(s); queueMicrotask(() => (o.onScript ? o.onScript(s, box, log) : s.onload && s.onload())); return s; };
  box.document = { createElement: mkEl, body: mkEl('body'), head, currentScript: o.currentScript, baseURI: 'https://x.test/app/', querySelector: () => null };
  if (o.touch !== undefined) box.matchMedia = () => ({ matches: !!o.touch });
  box.navigator = { canShare: () => !!o.canShare, share: async (d) => { log.shared.push(d); if (o.shareImpl) return o.shareImpl(d); } };
  const loadPdfLite = () => { vm.runInContext(PDF_LITE, box); const real = box.jpegToPdf; box.jpegToPdf = (pages, ...rest) => { log.pdfPages = pages; return real(pages, ...rest); }; };
  const loadHtml2canvas = () => {
    box.html2canvas = async (el, opt) => {
      log.html2canvas.push({ el, ...opt });
      if (o.html2canvasImpl) return o.html2canvasImpl(el, opt);
      return { width: Math.round(o.width * opt.scale), height: Math.round(o.height * opt.scale) };
    };
  };
  if (o.preload) { loadHtml2canvas(); loadPdfLite(); }
  vm.runInContext(SRC, box, { filename: 'forms-pdf.js' });
  return { box, log, FormsPdf: box.FormsPdf, loadPdfLite, loadHtml2canvas, mkEl };
}
const pdfInfo = async (file) => {
  const text = Buffer.from(await file.arrayBuffer()).toString('latin1');
  return { head: text.slice(0, 5), pages: Number((text.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/) || [])[1]), boxes: [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]) };
};

describe('3. download() — a fake DOM and the real pdf-lite', () => {
  it('a string becomes a multi-page A4 PDF, cut at the measured row boundaries; the off-screen host is removed afterwards', async () => {
    const b = makeBrowser({ height: 3000, cutYs: [300, 700, 1000, 1100, 1500, 1900, 2200, 2600] });
    const res = await b.FormsPdf.download('<div class="sheet">hello</div>', 'SO-0012-R1.pdf', { deliver: false });
    assert.equal(res.ok, true, res.error); assert.equal(res.fileName, 'SO-0012-R1.pdf'); assert.equal(res.pages, 3); assert.equal(res.delivery, 'none');
    assert.equal(res.file.name, 'SO-0012-R1.pdf'); assert.equal(res.file.type, 'application/pdf');
    const info = await pdfInfo(res.file);
    assert.equal(info.head, '%PDF-'); assert.equal(info.pages, 3); assert.deepEqual(info.boxes.map((m) => m.length), [2, 2, 2]);
    assert.ok(info.boxes.every(([w, h]) => w < h), 'portrait pages');
    // what was captured: the canvas at scale 2, sliced at the bands [0,1100] [1100,2200] [2200,3000] → source y 0 / 2200 / 4400, heights 2200 / 2200 / 1600
    assert.equal(b.log.html2canvas.length, 1); assert.equal(b.log.html2canvas[0].scale, 2); assert.equal(b.log.html2canvas[0].backgroundColor, '#fff'); assert.equal(b.log.html2canvas[0].useCORS, true);
    assert.deepEqual(b.log.drawn.map((a) => [a[2], a[4]]), [[0, 2200], [2200, 2200], [4400, 1600]]);
    assert.deepEqual(Array.from(b.log.pdfPages, (p) => [p.pxW, p.pxH, p.landscape]), [[1588, 2246, false], [1588, 2246, false], [1588, 2246, false]], 'every page a full A4-shaped canvas');
    assert.ok(b.log.pdfPages.every((p) => Object.prototype.toString.call(p.bytes) === '[object ArrayBuffer]' && p.bytes.byteLength === 4), 'JPEG bytes handed to pdf-lite as ArrayBuffers');
    assert.deepEqual(b.log.qualities, [0.92, 0.92, 0.92], 'default JPEG quality');
    // the host: an off-screen A4-width container that held the caller's HTML, then was removed
    const host = b.log.created.find((e) => e.tag === 'div');
    assert.match(host.style.cssText, /position:fixed;left:-99999px;top:0;width:794px/); assert.equal(host.innerHTML, '<div class="sheet">hello</div>');
    assert.ok(b.log.appended.some(([p, c]) => p === b.box.document.body && c === host)); assert.deepEqual(b.log.removed, [host]);
  });
  it('quality and scale options are honoured; the file name gets ".pdf" and is cleaned', async () => {
    const b = makeBrowser({ height: 1000 });
    const res = await b.FormsPdf.download('<p/>', 'Sales Order — SO-0012 R1', { deliver: false, quality: 0.85, scale: 1.5 });
    assert.equal(res.fileName, 'SalesOrderSO-0012R1.pdf'); assert.equal(res.pages, 1);
    assert.deepEqual(b.log.qualities, [0.85]); assert.equal(b.log.html2canvas[0].scale, 1.5);
    const bad = await makeBrowser({ height: 1000 }).FormsPdf.download('<p/>', 'x', { deliver: false, quality: 5 });
    assert.equal(bad.ok, true);
    const b2 = makeBrowser({ height: 1000 }); await b2.FormsPdf.download('<p/>', 'x', { deliver: false, quality: 5 }); assert.deepEqual(b2.log.qualities, [0.92], 'an impossible quality falls back to the default');
  });
  it('landscape: an explicit option (or a sheet wider than 950 px) makes landscape pages', async () => {
    const b = makeBrowser({ width: 1123, height: 1500 });
    const res = await b.FormsPdf.download('<p/>', 'Report', { deliver: false, landscape: true });
    assert.equal(res.ok, true); assert.equal(res.pages, 2);
    assert.ok(b.log.pdfPages.every((p) => p.landscape === true));
    assert.match(b.log.created.find((e) => e.tag === 'div').style.cssText, /width:1123px/, 'a landscape string is laid out 1123 px wide');
    const info = await pdfInfo(res.file); assert.ok(info.boxes.every(([w, h]) => w > h), 'landscape pages');
    const wide = makeBrowser({ width: 1200, height: 700 }); await wide.FormsPdf.download('<p/>', 'Wide', { deliver: false });
    assert.equal(wide.log.pdfPages[0].landscape, true, 'detected from the width');
  });
  it('an Element is captured from a CLONE (a scale-to-fit transform on the preview never skews it), the clone is removed; inPlace captures the element itself', async () => {
    const b = makeBrowser({ height: 1000 });
    const clone = b.mkEl('div'); const cloneArgs = [];
    const target = { nodeType: 1, offsetWidth: 794, cloneNode: (deep) => { cloneArgs.push(deep); return clone; } };
    const res = await b.FormsPdf.download(target, 'JO-0012', { deliver: false });
    assert.equal(res.ok, true, res.error); assert.deepEqual(cloneArgs, [true]);
    assert.equal(clone.style.transform, 'none'); assert.equal(clone.style.margin, '0');
    assert.equal(b.log.html2canvas[0].el, clone, 'the clone is what html2canvas sees');
    const wrap = b.log.appended.find(([, c]) => c === clone)[0];
    assert.match(wrap.style.cssText, /left:-99999px/); assert.match(wrap.style.cssText, /width:794px/); assert.ok(b.log.removed.includes(wrap), 'the wrapper is removed');
    const live = makeBrowser({ height: 1000 }); const el = live.mkEl('div'); const before = live.log.appended.length;
    const r2 = await live.FormsPdf.download(el, 'JO-0012', { deliver: false, inPlace: true });
    assert.equal(r2.ok, true); assert.equal(live.log.html2canvas[0].el, el); assert.equal(live.log.appended.length, before); assert.deepEqual(live.log.removed, []);
  });
  it('headings are not stranded: a heading (keep-next) at the foot of page 1 moves to page 2', async () => {
    const b = makeBrowser({ height: 2000, cutYs: [400, 1000, 1100, 1500], keepYs: [1000] });
    const res = await b.FormsPdf.download('<p/>', 'X', { deliver: false });
    assert.equal(res.pages, 2); assert.deepEqual(b.log.drawn.map((a) => [a[2], a[4]]), [[0, 2000], [2000, 2000]], 'page 1 ends at y=1000 (above the heading), not at 1100 (right under it)');
    const without = makeBrowser({ height: 2000, cutYs: [400, 1000, 1100, 1500], keepYs: [] });
    await without.FormsPdf.download('<p/>', 'X', { deliver: false });
    assert.deepEqual(without.log.drawn.map((a) => [a[2], a[4]]), [[0, 2200], [2200, 1800]], 'the same rows with no heading: the page fills to 1100');
  });
  it('a block is cut at its VISUAL top: a role label poking above the signature row\'s box is not sliced in half; size-less descendants are ignored', async () => {
    const b = makeBrowser({ height: 1200, cutYs: [190, 600, { y: 985, above: 8, ghost: true }, 1085], keepYs: [{ y: 985, above: 8, ghost: true }] });
    const res = await b.FormsPdf.download('<p/>', 'X', { deliver: false });
    assert.equal(res.pages, 2);
    assert.deepEqual(b.log.drawn.map((a) => [a[2], a[4]]), [[0, 1954], [1954, 446]], 'page 1 ends at 977 (985 − 8), not at 985 and not at the ghost\'s 0; the footer at 1085 is never a cut');
    const plain = makeBrowser({ height: 1200, cutYs: [190, 600, 985, 1085], keepYs: [985] });
    await plain.FormsPdf.download('<p/>', 'X', { deliver: false });
    assert.deepEqual(plain.log.drawn.map((a) => [a[2], a[4]]), [[0, 1970], [1970, 430]], 'without anything poking above, the box edge is the cut');
  });
  it('a custom cut / keep selector is used for measuring', async () => {
    const seen = [];
    const b = makeBrowser({ height: 2300 });
    const el = b.mkEl('div'); el.querySelectorAll = (sel) => { seen.push(sel); return []; };
    await b.FormsPdf.download(el, 'X', { deliver: false, inPlace: true, cutSelector: '.my-cut', keepNextSelector: '.my-keep' });
    assert.ok(seen.includes('.my-cut') && seen.includes('.my-keep')); assert.ok(!seen.includes(FP.DEFAULT_CUT));
  });
  it('a phone that refuses the big canvas gets ONE retry at scale 1', async () => {
    const b = makeBrowser({ height: 1000, html2canvasImpl: (el, opt) => { if (opt.scale !== 1) throw new Error('Canvas area exceeds the maximum limit'); return { width: 794, height: 1000 }; } });
    const res = await b.FormsPdf.download('<p/>', 'X', { deliver: false });
    assert.equal(res.ok, true, res.error); assert.deepEqual(b.log.html2canvas.map((c) => c.scale), [2, 1]);
  });
  it('a failing capture comes back { ok:false, error } with the plain prefix — and the host is STILL removed', async () => {
    const b = makeBrowser({ height: 1000, html2canvasImpl: () => { throw new Error('boom'); } });
    const res = await b.FormsPdf.download('<p/>', 'SO-0012', {});
    assert.equal(res.ok, false); assert.equal(res.fileName, 'SO-0012.pdf'); assert.equal(res.error, 'Could not generate the PDF — boom');
    assert.equal(b.log.html2canvas.length, 2, 'it did retry at scale 1 first'); assert.equal(b.log.removed.length, 1);
    assert.deepEqual(b.log.clicks, [], 'nothing was downloaded');
  });
  it('nothing to export / junk targets resolve { ok:false } and never throw', async () => {
    const b = makeBrowser({});
    for (const bad of [undefined, null, 5, {}, { nodeType: 3 }]) { const r = await b.FormsPdf.download(bad, 'X', {}); assert.equal(r.ok, false, String(bad)); assert.equal(r.error, 'Could not generate the PDF — There is nothing to export.'); }
    assert.equal((await b.FormsPdf.download('<p/>', 'X', null)).ok, true, 'opts may be null');
  });

  it('delivery on a computer: a plain download link (an <a download> with a blob URL), even when the browser could share files', async () => {
    const b = makeBrowser({ height: 1000, touch: false, canShare: true });
    const res = await b.FormsPdf.download('<p/>', 'SO-0012-R1.pdf', {});
    assert.equal(res.ok, true, res.error); assert.equal(res.delivery, 'download'); assert.equal(b.log.shared.length, 0);
    const link = b.log.created.find((e) => e.tag === 'a');
    assert.equal(link.download, 'SO-0012-R1.pdf'); assert.equal(link.href, 'blob:fake'); assert.equal(link.rel, 'noopener'); assert.deepEqual(b.log.clicks, [link]); assert.ok(b.log.removed.includes(link));
    assert.equal(b.log.objectUrls[0].name, 'SO-0012-R1.pdf'); assert.ok(b.log.timers.some(([, ms]) => ms === 4000), 'the blob URL is released a moment later');
    b.log.timers.find(([, ms]) => ms === 4000)[0](); assert.deepEqual(b.log.revoked, ['blob:fake']);
  });
  it('delivery on a phone (touch + files can be shared): the share sheet with the PDF file and the title — an AbortError is not a failure; any other error is', async () => {
    const b = makeBrowser({ height: 1000, touch: true, canShare: true });
    const res = await b.FormsPdf.download('<p/>', 'SO-0012-R1.pdf', { title: 'Sales Order SO-0012 R1' });
    assert.equal(res.ok, true, res.error); assert.equal(res.delivery, 'share');
    assert.equal(b.log.shared[0].title, 'Sales Order SO-0012 R1'); assert.equal(b.log.shared[0].files[0].name, 'SO-0012-R1.pdf'); assert.equal(b.log.shared[0].files[0].type, 'application/pdf');
    assert.equal(b.log.clicks.length, 0, 'no download link on the share path');
    const cancelled = makeBrowser({ height: 1000, touch: true, canShare: true, shareImpl: () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } });
    const c = await cancelled.FormsPdf.download('<p/>', 'X', {}); assert.equal(c.ok, true); assert.equal(c.delivery, 'cancelled');
    const failing = makeBrowser({ height: 1000, touch: true, canShare: true, shareImpl: () => { throw new Error('share broke'); } });
    const f = await failing.FormsPdf.download('<p/>', 'X', {}); assert.equal(f.ok, false); assert.match(f.error, /share broke/);
    const noShare = makeBrowser({ height: 1000, touch: true, canShare: false });
    assert.equal((await noShare.FormsPdf.download('<p/>', 'X', {})).delivery, 'download', 'a phone that cannot share files still downloads');
    const noMedia = makeBrowser({ height: 1000, touch: undefined, canShare: true });
    assert.equal((await noMedia.FormsPdf.download('<p/>', 'X', {})).delivery, 'download', 'no matchMedia → treated as a computer');
  });

  it('ensureDeps loads html2canvas and pdf-lite once each, from the folder of this script with its ?v=; a second call loads nothing', async () => {
    const onScript = (s, box) => { if (/html2canvas/.test(s.src)) box.html2canvas = async () => ({}); else vm.runInContext(PDF_LITE, box); s.onload(); };
    const b = makeBrowser({ preload: false, currentScript: { src: 'https://x.test/app/js/forms-pdf.js?v=14.0.9' }, onScript });
    await b.FormsPdf.ensureDeps();
    assert.deepEqual(b.log.scripts.map((s) => s.src), ['https://x.test/app/js/vendor/html2canvas.min.js?v=14.0.9', 'https://x.test/app/js/pdf-lite.js?v=14.0.9']);
    await b.FormsPdf.ensureDeps(); assert.equal(b.log.scripts.length, 2);
  });
  it('ensureDeps: a failed load rejects with a plain message and the NEXT call retries; download() reports it as { ok:false }', async () => {
    let attempt = 0;
    const onScript = (s, box) => { if (/html2canvas/.test(s.src) && ++attempt === 1) return s.onerror(); if (/html2canvas/.test(s.src)) box.html2canvas = async () => ({}); else vm.runInContext(PDF_LITE, box); s.onload(); };
    const b = makeBrowser({ preload: false, currentScript: { src: 'https://x.test/app/js/forms-pdf.js' }, onScript });
    const res = await b.FormsPdf.download('<p/>', 'X', {});
    assert.equal(res.ok, false); assert.equal(res.error, 'Could not generate the PDF — Could not load the PDF export library — check your connection and try again.');
    await b.FormsPdf.ensureDeps(); assert.equal(typeof b.box.jpegToPdf, 'function'); assert.equal(typeof b.box.html2canvas, 'function');
  });
  it('without document.currentScript it finds its own <script> tag for the folder', async () => {
    const b = makeBrowser({ preload: false, currentScript: null, onScript: (s, box) => { if (/html2canvas/.test(s.src)) box.html2canvas = async () => ({}); else vm.runInContext(PDF_LITE, box); s.onload(); } });
    b.box.document.querySelector = (sel) => (/forms-pdf\.js/.test(sel) ? { src: 'https://x.test/other/js/forms-pdf.js?v=3' } : null);
    await b.FormsPdf.ensureDeps();
    assert.deepEqual(b.log.scripts.map((s) => s.src), ['https://x.test/other/js/vendor/html2canvas.min.js?v=3', 'https://x.test/other/js/pdf-lite.js?v=3']);
  });
});
