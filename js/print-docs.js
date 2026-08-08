/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Shared Printable-Document Scaffold
   js/print-docs.js  (loads AFTER letterhead.js, BEFORE departments.js)
   ═══════════════════════════════════════════════════
   DOCUMENTS-PRINT-SPEC.md — window.openPrintableDoc(opts) -> HTMLElement
   Rebuilt on window.openPage (the same in-app page-panel host the payslip
   uses — js/screens/hr.js renderPayslipPage) instead of window.open()+
   document.write(). window.open is blocked/breaks out to Safari inside the
   iOS Add-to-Home-Screen standalone PWA, so every legacy caller (billing
   invoice, delivery receipt, inventory count form, purchase order, receiving
   report, ROC/AEC contact sheets) silently failed to open/print/save there.
   This module never touches document CONTENT — callers still build their
   own body table HTML; only the surrounding chrome (panel host, toolbar,
   print isolation, Save PDF/JPEG) lives here.

   opts (unchanged contract — every existing caller needs zero edits):
     title        - fallback panel title (used only if barLabel is absent)
                    AND the save-filename stem (sanitized, §4)
     bodyHtml     - inner HTML for the #<pageId> page div (unchanged per-doc content)
     pageId       - id attribute for the page div (default 'pd-page'; also the
                    html2canvas capture target id)
     barLabel     - HTML string (icon + doc title/no) shown as the panel title;
                    _setPanelTitle (app.js) strips the icon markup to a real
                    <i data-lucide> element and textContents the rest
     extraButtons - optional extra HTML appended after the built-in Print/JPEG buttons
     extraScript  - REMOVED. CSP has no unsafe-eval, so caller-supplied JS text
                    can never execute in-app. Passing it now only logs a loud
                    console.warn and is otherwise ignored.
     accent       - toolbar/accent hex; set as --pd-accent on .pd-stage (kept
                    for any caller CSS that references it; the header buttons
                    themselves use the app's own theme, not this)
     bgColor      - accepted + ignored (panel body supplies the backdrop now)
     pageCss      - per-doc CSS (page size/padding, table column widths,
                    watermark color, @page rules, letterhead printCSS, etc.) —
                    rides in verbatim after the shared base CSS so it wins the
                    cascade where it differs, exactly as before
     watermark    - optional watermark text (e.g. 'PENDING APPROVAL'); rendered
                    using the shared .wm rule unless overridden in pageCss
     winFeatures  - accepted + ignored (no window.open anymore)
     autoPrint    - after the panel opens + settles, calls window.print() on
                    non-iOS-standalone; on iOS standalone shows a toast instead
                    (navigator.share needs a user gesture, so autoPrint alone
                    can't drive the share sheet there)
   Returns the panel element (openPage's return value) — truthy. The old
   contract returned Window | null; no caller ever reads the return value or
   depends on the popup-blocked-toast/null branch (verified against every
   caller — none does `= openPrintableDoc(`), so that branch is gone. */
(function () {
  const esc = (s) => (window.escHtml ? window.escHtml(String(s == null ? '' : s))
                                     : String(s == null ? '' : s).replace(/[&<>"']/g,
                        c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])));

  // ── Scoped base CSS — rewrite of the old popup BASE_CSS. That version used
  // bare body/*/table selectors, which is fine document-wide in a standalone
  // popup document but would leak into the live app now that this <style> tag
  // rides inside an openPage panel body. Same declarations, `.pd-stage`-scoped
  // selectors. The old fixed `.bar` toolbar is gone entirely — openPage's own
  // headerRightHTML (§3) replaces it.
  //
  // ── WHY every rule below is ALSO mirrored onto `.pd-print` ────────────────
  // `.pd-stage`-only scoping silently broke every JPEG/PDF export. The capture
  // target is the SHEET (`.page.pd-print`, a CHILD of `.pd-stage`), and
  // _captureDocCanvas clones that sheet into a bare <div> hung off <body> —
  // where it has no `.pd-stage` ancestor and so matched NONE of these rules.
  // What it got instead was whatever it inherited from <body>: `color:
  // var(--text)`, `font-family:var(--font)`, `font-size:var(--fs-base)`, and no
  // table styling at all — css/styles.css has no global table/th/td rule outside
  // its own @media print block, and callers supply only DELTAS (production.js's
  // delivery receipt sets `th{background:#1E3A5F}` and `table{margin-bottom}`
  // but relies on THIS file for the borders, the padding and the collapse).
  //
  // Measured in headless Chrome against the real css/styles.css, cloning the
  // real panel DOM exactly the way _captureDocCanvas does — 25 computed
  // properties × 6 real caller pageCss blocks × both themes:
  //
  //   property          live sheet       ORPHANED CLONE (before)  after
  //   color             #000             dark  #E4E6EB            #000
  //                                      light #1C1E21
  //   font-family       Arial            Times                    Arial
  //   font-size         11px             16px                     11px
  //   td border         1px solid #444   0px none                 1px solid #444
  //   td padding        5px 7px          0                        5px 7px
  //   table width       688px            245px (shrink-to-fit)    688px
  //   border-collapse   collapse         separate                 collapse
  //   td.c text-align   center           start                    center
  //   tr.blank td h     23px             18px                     23px
  //   .wm position      absolute         static                   absolute
  //   .wm transform     rotate(-24deg)   none                     rotate(-24deg)
  //   .wm font-size     64px             16px                     64px
  //
  // On the default dark theme that is #E4E6EB text on the sheet's own #fff (and
  // on html2canvas's backgroundColor:'#fff') — ~1.1:1 contrast, i.e. the export
  // came out a BLANK WHITE SHEET. Every openPrintableDoc caller was hit:
  // delivery receipts, job orders, POs, receiving reports, billing invoices, ID
  // cards, AEC/ROC lead sheets. Only the payslip escaped, because
  // `.payslip-print` carries its styling on the SAME element that gets captured
  // (css/styles.css) rather than on an ancestor — which is why nobody noticed.
  //
  // The fix is deliberately ADDITIVE: every rule keeps its existing
  // `.pd-stage`-rooted selector and gains a `.pd-print`-rooted twin of
  // IDENTICAL specificity, so the live preview's cascade cannot move. That
  // parity is load-bearing, not cosmetic — callers are full of bare, low
  // specificity selectors that LOSE to this block today and must keep losing:
  //   · crm.js / sales.js lead sheets ship `th,td{font-size:9.5px}` (0,0,1),
  //     beaten today by `.pd-stage th,.pd-stage td` (0,1,1). The twin
  //     `.pd-print th,.pd-print td` is also (0,1,1), so it stays beaten.
  //     Descoping this block to a bare `th,td` instead would have handed the
  //     caller the win and visibly shrunk the on-screen lead sheets.
  //   · departments.js's invoice ships `td,th{border:1px solid #000}` (0,0,1) —
  //     same story: still overridden to #444, exactly as it is today.
  //   · every caller's `.page{width:210mm;padding:14mm;…}` (0,1,0) must keep
  //     BEATING this block's page rule, so that one is mirrored as
  //     `.pd-print.page` — (0,2,0), matching `.pd-stage .page` exactly, rather
  //     than the (0,1,0) a bare `.pd-print` would have given it. Same reason
  //     `position:relative` survives there, which is what keeps the absolutely
  //     positioned `.wm` watermark's containing block intact in the clone.
  // Verified empirically: all 25 properties byte-identical old-vs-new on the
  // LIVE preview for all 6 caller shapes in both themes, and the clone now
  // matches the live preview on all 25.
  //
  // `.pd-stage`'s own chrome (`margin:0 auto;padding:16px 8px` — the padding
  // _fitDocSheet reads back via padX(stage)) is split into its own rule and is
  // deliberately NOT mirrored: the clone is off-viewport and must not pick up a
  // 16px/8px band the live sheet does not have. It stays AFTER the reset rule,
  // which is the only ordering constraint in this block. ──
  const BASE_CSS = `
.pd-stage,.pd-stage *,.pd-print,.pd-print *{box-sizing:border-box;margin:0;padding:0}
.pd-stage,.pd-print{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000}
.pd-stage{margin:0 auto;padding:16px 8px}
.pd-stage table,.pd-print table{width:100%;border-collapse:collapse}
.pd-stage th,.pd-stage td,.pd-print th,.pd-print td{border:1px solid #444;padding:5px 7px;font-size:11px;vertical-align:top}
.pd-stage td.c,.pd-print td.c{text-align:center}
.pd-stage td.r,.pd-print td.r{text-align:right}
.pd-stage td.b,.pd-print td.b{font-weight:700}
.pd-stage tr.blank td,.pd-print tr.blank td{height:22px}
.pd-stage .page,.pd-print.page{position:relative;background:#fff;color-scheme:light;
  --surface:#fff;--surface2:#f4f4f4;--border:#ddd;--text:#222;--text-muted:#666}
.pd-stage .wm,.pd-print .wm{position:absolute;top:45%;left:0;right:0;text-align:center;transform:rotate(-24deg);
    font-size:64px;font-weight:900;letter-spacing:6px;color:rgba(192,57,43,.13);
    z-index:5;pointer-events:none}
@media print{
  /* fallback A4 page box for letterhead-less docs; caller pageCss (and any
     letterhead.js printCSS a caller concatenates into it) is injected right
     after this in the cascade, so a later @page rule there (e.g. landscape)
     still wins over this one — same ordering guarantee as the old popup. */
  @page{size:A4 portrait;margin:11mm 10mm 7mm}
}`;

  // ── Print isolation (§2) — reuse the payslip's proven two-layer approach,
  // generalized for docs that can be MORE than one printed page (the payslip
  // is always exactly one). Rides as the LAST chunk of the panel's <style>
  // tag, after caller pageCss, so it always wins where it needs to. ──
  const PRINT_CSS = `
@media print{
  /* (a) confidentiality — beat styles.css's #page-content,#page-content
     *{visibility:visible} (v13 Phase 56) with the same !important trick
     hr.js's _psPrintCss uses, so a doc panel never prints the screen
     stacked underneath it (e.g. an invoice opened from Finance must never
     also print that project's full finance table). */
  #page-content,#page-content *{visibility:hidden!important}
  .pd-print,.pd-print *{visibility:visible!important}

  /* (b) multi-page un-clipping — the payslip never exercised this (always
     one page); .page-panel is position:fixed with an overflow-y:auto body
     (styles.css ~2191/2203), which clips printed content to one page unless
     released for the doc panel specifically. */
  .pd-host.page-panel{position:static!important;inset:auto!important;height:auto!important;overflow:visible!important;transform:none!important}
  .pd-host .page-panel-body{overflow:visible!important;height:auto!important}
  .pd-host .page-panel-head,.pd-host .page-panel-foot{display:none!important}

  /* (c) sheet placement + un-scale (payslip §3 pattern) */
  .pd-stage{transform:none!important;width:auto!important;height:auto!important;padding:0!important}
  .pd-host .page{position:absolute;left:0;top:0;width:100%;margin:0}
  .pd-host .wm{position:fixed;color:rgba(192,57,43,.16)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;

  // ═══════════════════════════════════════════════════════════
  //  Save (PDF / JPEG) — local vendored pipeline, zero CDN. Copied from the
  //  proven js/screens/hr.js §4 implementations (capturePayslipCanvas /
  //  sharePayslipPDF / downloadPayslipJPEG) — hr.js itself is NOT modified,
  //  per DOCUMENTS-PRINT-SPEC.md §1.1. Both loaders guard on the same global
  //  (window.html2canvas / window.jpegToPdf) hr.js's loaders check, so
  //  whichever host loads first wins and neither double-loads the script.
  // ═══════════════════════════════════════════════════════════
  let _html2canvasLoadPromise = null;
  function _ensureHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve();
    if (_html2canvasLoadPromise) return _html2canvasLoadPromise;
    _html2canvasLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/html2canvas.min.js';
      s.onload = () => resolve();
      s.onerror = () => { _html2canvasLoadPromise = null; reject(new Error('Could not load the export library — check your connection and try again.')); };
      document.head.appendChild(s);
    });
    return _html2canvasLoadPromise;
  }
  let _pdfLiteLoadPromise = null;
  function _ensurePdfLite() {
    if (window.jpegToPdf) return Promise.resolve();
    if (_pdfLiteLoadPromise) return _pdfLiteLoadPromise;
    _pdfLiteLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/pdf-lite.js';
      s.onload = () => resolve();
      s.onerror = () => { _pdfLiteLoadPromise = null; reject(new Error('Could not load the PDF export helper.')); };
      document.head.appendChild(s);
    });
    return _pdfLiteLoadPromise;
  }

  function _isIOSStandalone() {
    try {
      const ua = navigator.userAgent || '';
      const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
      const standalone = window.navigator.standalone === true
        || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      return isIOS && standalone;
    } catch (_) { return false; }
  }

  // Capture target: the `.page` sheet (id=pageId), falling back to `.pd-print`
  // if a caller ever omits pageId weirdly. Clone-capture exactly like
  // capturePayslipCanvas: clone the sheet, neutralize its live scale-to-fit
  // transform, capture off-viewport at the requested scale, remove the clone.
  //
  // ── WHY the ScrollLock.withUnlocked() wrapper below (mobile-window recon,
  // Hazard 6) ──────────────────────────────────────────────────────────────
  // The mobile window model locks background scrolling by putting
  // `position:fixed; top:-<scrollY>px; left:0; right:0; width:100%;
  // overflow:hidden` on <body> for as long as any page/modal is open — and a
  // printable doc is itself an openPage panel, so the lock is ALWAYS held while
  // this runs on the phone shell.
  //
  // js/vendor/html2canvas.min.js reads `pageYOffset` (3×), `scrollY` (5×),
  // `pageXOffset`, `scrollX` (5×) and `windowBounds` (7×) to derive its default
  // capture window, and it clones the whole document — INCLUDING <body>'s inline
  // style — into an offscreen iframe, where `position:fixed; top:-1234px` would
  // be inherited. Whether that actually corrupts the capture was never verified:
  // the recon's "the fixed wrapper should stay viewport-anchored, so it probably
  // survives" is static inference over minified control flow, not a measurement.
  //
  // This is the ONLY export path on iOS standalone — every payslip, quote,
  // invoice, delivery receipt, PO and count form ships through it — so we do not
  // gamble on "probably". Rather than measure the interaction, we make the lock
  // provably ABSENT for the duration of the capture: withUnlocked() fully
  // releases regardless of refcount depth, runs the capture against a normal
  // scrollable document (exactly the conditions html2canvas was written for),
  // then re-applies the lock at the SAME scroll offset in a `finally` — so a
  // throwing capture cannot strand the app unlocked.
  //
  // The unlock is deliberately scoped as tightly as possible: it starts at the
  // appendChild (the first moment the offscreen wrapper is subject to body's
  // layout) and ends when the wrapper is removed. `_ensureHtml2Canvas()` stays
  // OUTSIDE it — no reason to leave the shell scrollable across a script fetch.
  // At refcount 0 (every desktop case, and any phone case with no panel open)
  // withUnlocked is a pure pass-through: it touches no DOM at all.
  //
  // This is the single chokepoint — every capture in this module, including
  // _captureDocJpeg's scale-1 retry, funnels through here — so wrapping it here
  // rather than at each caller makes "html2canvas never runs under the lock" a
  // property of the function, not of its call sites.
  async function _captureDocCanvas(panel, o, opts) {
    opts = opts || {};
    await _ensureHtml2Canvas();
    const root = panel || document;
    const pageId = o.pageId || 'pd-page';
    const src = (root.querySelector && root.querySelector('#' + CSS.escape(pageId)))
      || (root.querySelector && root.querySelector('.pd-print'));
    if (!src) throw new Error('Could not find the document content to capture.');
    const clone = src.cloneNode(true);
    clone.style.transform = 'none'; // neutralize the live scale-to-fit transform — capture at true 1x
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-99999px;top:0;background:#fff;';
    wrap.appendChild(clone);
    // Guarded so this module keeps working if config.js ever fails to define
    // ScrollLock (or is reordered after this file): fall back to calling fn()
    // straight through, i.e. exactly today's behaviour.
    //
    // This module CAN overlap two withUnlocked() windows, so it relies on that
    // function's reentrancy handling (_uDepth) rather than assuming exclusivity:
    // #pd-print-btn and #pd-jpeg-btn each disable only THEMSELVES (see
    // _handleDocPrintOrPdf / _downloadDocJPEG below), so tapping one and then
    // the other while the first is still capturing is a two-tap gesture, not a
    // race you have to engineer. Nothing here nests a second run() inside a
    // first, though: the SHARE_UNAVAILABLE print retry only fires after
    // _shareDocPDF has already settled, and _captureDocJpeg's scale-1 fallback
    // is strictly sequential after the scale-2 attempt rejects.
    const run = window.ScrollLock?.withUnlocked?.bind(window.ScrollLock) || ((fn) => fn());
    return await run(async () => {
      document.body.appendChild(wrap);
      try {
        return await window.html2canvas(clone, { scale: opts.scale || 2, useCORS: true, backgroundColor: '#fff', logging: false });
      } finally {
        wrap.remove();
      }
    });
  }

  function _canvasToJpegBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not render the image.')), 'image/jpeg', 0.92);
    });
  }

  // Capture + toBlob with the huge-canvas fallback (retry once at scale:1) —
  // matters more here than for the payslip: a multi-page landscape lead
  // sheet at scale 2 can exceed iOS's ~16.7 MP canvas cap.
  async function _captureDocJpeg(panel, o) {
    // Honour the CALLER's scale. It was hardcoded to 2, so opts.scale — which
    // openPrintableDoc accepts and documents — could never reach the PDF path.
    // A caller that knows its document is large (a whole payroll batch) has no
    // other way to stay under iOS's canvas-area cap, and the retry below cannot
    // save it: WebKit above the cap returns a non-allocated backing store, so
    // drawing is a no-op and toBlob resolves with a VALID BUT BLANK jpeg rather
    // than the null this catch is waiting for.
    let canvas = await _captureDocCanvas(panel, o, { scale: o.scale || 2 });
    let blob;
    try {
      blob = await _canvasToJpegBlob(canvas);
    } catch (_) {
      canvas = await _captureDocCanvas(panel, o, { scale: 1 });
      blob = await _canvasToJpegBlob(canvas);
    }
    return { canvas, blob };
  }

  function _sanitizeDocName(title) {
    return String(title || 'document').replace(/[^a-zA-Z0-9-]/g, '') || 'document';
  }

  // Save as JPEG — Blob + Web Share (files) when available (iOS standalone:
  // Save Image/Save to Files/AirDrop/Messages/Print), else a plain Blob-URL
  // anchor download (never a data: URL). Every failure surfaces via a toast;
  // the button ALWAYS comes back off "Generating…" (finally).
  async function _downloadDocJPEG(o, panel, btn) {
    const origLabel = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      const { blob } = await _captureDocJpeg(panel, o);
      const fname = `${_sanitizeDocName(o.title)}.jpg`;
      const file = new File([blob], fname, { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: o.title || 'Document' });
        } catch (shareErr) {
          if (!shareErr || shareErr.name !== 'AbortError') throw shareErr; // AbortError = user cancelled, not a failure
        }
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = fname; link.href = url; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } catch (err) {
      console.error('openPrintableDoc: JPEG export failed', err);
      if (window.Notifs && Notifs.showToast) Notifs.showToast('Could not generate the JPEG — ' + (err && err.message ? err.message : 'please try again.'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origLabel || `${window.emojiIcon ? emojiIcon('📷', 16) : '📷'} Save as JPEG`; }
    }
  }

  // PDF path — payslip's sharePayslipPDF generalized for length + orientation
  // (DOCUMENTS-PRINT-SPEC.md §4). Detects orientation from the sheet's
  // UNSCALED layout width (offsetWidth ignores CSS transforms — portrait
  // sheets are ~794px, landscape ~1123px), page-slices long documents into
  // one PDF page per slice via pdf-lite's array form + its new landscape flag.
  async function _shareDocPDF(o, panel) {
    await _ensurePdfLite();
    const pageId = o.pageId || 'pd-page';
    const sheet = (panel.querySelector && panel.querySelector('#' + CSS.escape(pageId)))
      || (panel.querySelector && panel.querySelector('.pd-print'));
    const sheetWidthPx = (sheet && sheet.offsetWidth) || 794;
    const landscape = sheetWidthPx > 950;

    const { canvas, blob } = await _captureDocJpeg(panel, o);
    const jpegBuf = await blob.arrayBuffer();

    // ── On the "captureScale compares the CLONE against the LIVE sheet, so any
    // divergence skews the page slicing" concern raised against the BASE_CSS
    // scoping bug above: it does not, and it never did. sheetWidthPx CANCELS
    // OUT of pageHeightPx algebraically —
    //     sheetWidthPx * (canvas.width / sheetWidthPx) * ratio  ==  canvas.width * ratio
    // — so the slice height is a function of the CAPTURED canvas alone and is
    // self-consistent no matter how far the clone's layout drifts from the live
    // sheet's. captureScale is kept as a named intermediate because it is the
    // honest description of what the canvas is (device px per CSS px of sheet),
    // not because the arithmetic needs it.
    //
    // The one place sheetWidthPx genuinely decides something is `landscape`
    // above, and that is measured off the LIVE sheet on purpose: orientation is
    // a property of the document being printed, not of the capture.
    //
    // Measured anyway, same harness as BASE_CSS: live-vs-clone width skew is
    // exactly 1.0000x for all five real caller shapes in both themes, BEFORE
    // and AFTER the scoping fix — every caller pins `.page{width:210mm|297mm}`
    // with a bare selector that survives the orphaning, and css/styles.css's
    // global `*{box-sizing:border-box}` kept the clone border-box even while
    // BASE_CSS's own reset was missing. A synthetic caller that omits
    // `.page{width}` does diverge (0.19x, unchanged by this fix, since the
    // cause is the absent width and not the lost BASE_CSS) — harmless for the
    // slicing per the cancellation above, but such a doc would export at
    // content width instead of sheet width, so: pin .page's width in pageCss.
    const captureScale = canvas.width / sheetWidthPx;
    const ratio = landscape ? (595.28 / 841.89) : (841.89 / 595.28);
    const pageHeightPx = Math.max(1, Math.round(sheetWidthPx * captureScale * ratio));
    const totalH = canvas.height;
    const pageCount = Math.max(1, Math.ceil(totalH / pageHeightPx));

    const pages = [];
    for (let i = 0; i < pageCount; i++) {
      const y0 = i * pageHeightPx;
      const h = Math.min(pageHeightPx, totalH - y0);
      if (pageCount === 1) {
        pages.push({ bytes: jpegBuf, pxW: canvas.width, pxH: h, landscape });
        break;
      }
      const slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = h;
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, y0, canvas.width, h, 0, 0, canvas.width, h);
      const sliceBlob = await _canvasToJpegBlob(slice);
      const sliceBuf = await sliceBlob.arrayBuffer();
      pages.push({ bytes: sliceBuf, pxW: canvas.width, pxH: h, landscape });
    }

    // A one-page doc degenerates to the single jpegToPdf(buf,w,h,landscape)
    // call, identical in shape to the payslip's own call (hr.js untouched —
    // this is print-docs.js's own path, byte-identical output either way).
    const pdfBytes = pages.length === 1
      ? window.jpegToPdf(pages[0].bytes, pages[0].pxW, pages[0].pxH, pages[0].landscape)
      : window.jpegToPdf(pages);

    const fname = `${_sanitizeDocName(o.title)}.pdf`;
    const file = new File([pdfBytes], fname, { type: 'application/pdf' });
    if (!(navigator.canShare && navigator.canShare({ files: [file] }))) {
      const e = new Error('SHARE_UNAVAILABLE'); e.code = 'SHARE_UNAVAILABLE'; throw e;
    }
    await navigator.share({ files: [file], title: o.title || 'Document' });
  }

  async function _handleDocPrintOrPdf(o, panel, btn) {
    // Same escape hatch as _captureDocCanvas, for the OTHER delivery mechanism
    // (recon Hazard 7). window.print() paginates from the document flow, and the
    // global @media print block resets #page-content's position but never body's
    // — so under the lock the printer would get only the visible viewport slice
    // and clip everything below it. This is not the iOS-standalone path (that
    // one goes through _shareDocPDF → html2canvas), but it IS the path for
    // Android Chrome and for iPhone Safari opened as a tab rather than from the
    // Home Screen, both of which sit on the phone shell and so DO hold the lock.
    // Unlocking here fixes it in the export path itself instead of depending on
    // a css/styles.css print rule this batch does not own.
    const run = window.ScrollLock?.withUnlocked?.bind(window.ScrollLock) || ((fn) => fn());
    if (!_isIOSStandalone()) { await run(() => { window.print(); }); return; }
    const origLabel = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      await _shareDocPDF(o, panel);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // user cancelled the share sheet — not a failure, swallow silently.
      } else if (err && err.code === 'SHARE_UNAVAILABLE') {
        if (window.Notifs && Notifs.showToast) Notifs.showToast('Sharing isn’t available on this device — trying Print, or use Save as JPEG instead.', 'error');
        try { await run(() => { window.print(); }); } catch (_) {}
      } else {
        console.error('openPrintableDoc: PDF export failed', err);
        if (window.Notifs && Notifs.showToast) Notifs.showToast('Could not generate the PDF — ' + (err && err.message ? err.message : 'please try again.'), 'error');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origLabel || `${window.emojiIcon ? emojiIcon('🖨', 16) : '🖨'} Print / Save PDF`; }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  §5 — generalized scale-to-fit. hr.js's fitA4Sheet hardcodes 794px
  //  (always-portrait A4). Docs here are 210mm (~794px) OR 297mm (~1123px)
  //  wide, with content-driven heights (multi-page-capable), so dimensions
  //  are MEASURED live off the sheet rather than assumed — a fixed
  //  height:calc(1123px*scale) would clip/overlap a landscape or tall sheet.
  // ═══════════════════════════════════════════════════════════
  function _fitDocSheet(panel) {
    if (!panel) return () => {};
    const recalc = () => {
      const sheet = panel.querySelector && panel.querySelector('.pd-print');
      const stage = panel.querySelector && panel.querySelector('.pd-stage');
      if (!sheet || !stage) return;
      const w = sheet.offsetWidth, h = sheet.offsetHeight;
      if (!w || !h) return;
      // ── Gutter: MEASURED, not the old hardcoded 16 (mobile-window recon
      // cleanup #19). Two independent paddings eat into the width the scaled
      // sheet can occupy, and the flat 16 modelled exactly one of them.
      //
      //  1. .pd-stage is border-box with `padding:16px 8px` (BASE_CSS above),
      //     and its width is set to w*scale below — so its CONTENT box is only
      //     w*scale-16 wide while the scaled sheet is w*scale, because the sheet
      //     is transform-scaled from the stage's CONTENT-box top-left
      //     (transform-origin:top left, and transforms do not affect layout).
      //     The sheet therefore always overhangs the stage's own border box by
      //     stagePadLeft (8px) on the right. `margin:0 auto` does NOT rescue
      //     that: as soon as w*scale exceeds the host's content width the auto
      //     margins resolve to 0, the stage sits flush left, and the overhang
      //     lands straight in the host's padding. This 16 is the ONLY thing the
      //     old constant was accounting for — it is literally padX(stage).
      //  2. …but `avail` is a clientWidth, which INCLUDES the host's OWN padding,
      //     and the old constant subtracted none of it. .page-panel-body is
      //     16px on the sides at desktop and 12px under the ≤640px density block
      //     (css/styles.css — search `.page-panel-body`: the base rule and the
      //     @media (max-width:640px) one; line numbers deliberately not quoted
      //     here, they drift every batch). So padX(host) is 32 or 24 and the old
      //     formula overshot by exactly that. Both are also `max(Npx,
      //     env(safe-area-inset-left/right))`, so on a notched iPhone in
      //     landscape they jump to ~44px a side — unrepresentable as a constant
      //     at all.
      //
      // Note this is NOT a case of the CSS drifting out from under a constant:
      // .page-panel-body's padding is byte-identical to what it was when the 16
      // was written. The 16 was wrong on the day it landed; it just failed
      // quietly, as a horizontal scrollbar nobody filed.
      //
      // Measured in Chrome against this exact cascade, both formulas run side by
      // side on the same DOM (scrollWidth/clientWidth is .page-panel-body's):
      //
      //   host width / sheet      old `- 16`                    measured gutter
      //   375 phone,  portrait    +16.0px past the content      +0.0px past,
      //                           box, 383 vs 375 — REAL        375 vs 375, none
      //                           horizontal scroll
      //   1000 desktop, LANDSCAPE +24.0px past, 1016 vs 1000    +0.0px, 1000/1000
      //                           — REAL horizontal scroll
      //   1100 desktop, LANDSCAPE +24.0px past, 1116 vs 1100    +0.0px, 1100/1100
      //                           — REAL horizontal scroll
      //   1200 desktop, portrait  scale clamps to 1 both ways — byte-identical
      //
      // On the review note that landscape sheets (w≈1123) come out ~3% smaller
      // in the 1000-1170px desktop band (at 1100px: 1084px wide → 1052px): that
      // band is EXACTLY where the old constant was overflowing. Those 1084px did
      // not fit — they pushed the panel body's scrollWidth to 1116 and gave the
      // doc panel a horizontal scrollbar. The 3% is the sheet being made to fit
      // the box it is in. So the gutter is deliberately NOT width-scoped or
      // orientation-scoped: it is the same geometry at every width, and the only
      // reason landscape shows the largest delta is that it is the one case
      // whose scale is not already clamped to 1 (portrait A4 is 794px, which
      // fits any desktop panel outright, so desktop portrait is unchanged).
      //
      // Reading both paddings live via getComputedStyle keeps this correct for
      // the safe-area case in (2), and means a future density-pass edit to
      // .page-panel-body can't silently reintroduce the same class of bug.
      const bodyEl = sheet.closest('.page-panel-body') || panel;
      // Track WHICH element `avail` came from, so the padding subtracted below
      // always belongs to the same box that supplied the width.
      let host = bodyEl, avail = (bodyEl && bodyEl.clientWidth) || 0;
      if (!avail) { host = panel; avail = panel.clientWidth || 0; }
      if (!avail) { host = null;  avail = window.innerWidth; }   // last resort: no box to measure
      const padX = (el) => {
        if (!el) return 0;
        const cs = getComputedStyle(el);
        return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      };
      const gutter = padX(host) + padX(stage);
      const scale = Math.max(0.05, Math.min(1, (avail - gutter) / w));
      stage.style.width = (w * scale) + 'px';
      stage.style.height = (h * scale) + 'px';
      sheet.style.transform = 'scale(' + scale + ')';
      sheet.style.transformOrigin = 'top left';
    };
    recalc();
    window.addEventListener('resize', recalc);
    window.addEventListener('orientationchange', recalc);
    return () => {
      window.removeEventListener('resize', recalc);
      window.removeEventListener('orientationchange', recalc);
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  §1 — the host itself
  // ═══════════════════════════════════════════════════════════
  window.openPrintableDoc = function (opts) {
    const o = opts || {};
    const pageId = o.pageId || 'pd-page';
    const accent = o.accent || '#1E3A5F';

    if (o.extraScript) console.warn('openPrintableDoc: extraScript is no longer supported (CSP has no unsafe-eval — caller-supplied JS text can never execute in-app). Ignored.');

    const bodyHTML = `
<style>
${BASE_CSS}
${o.pageCss || ''}
${PRINT_CSS}
</style>
<div class="pd-stage" style="--pd-accent:${accent}">
  <div class="page pd-print" id="${esc(pageId)}">
    ${o.watermark ? `<div class="wm">${esc(o.watermark)}</div>` : ''}
    ${o.bodyHtml || ''}
  </div>
</div>`;

    const printIcon = window.emojiIcon ? emojiIcon('🖨', 16) : '🖨';
    const jpegIcon = window.emojiIcon ? emojiIcon('📷', 16) : '📷';
    const headerRightHTML = `
    <button class="btn-primary btn-sm" id="pd-print-btn">${printIcon} Print / Save PDF</button>
    <button class="btn-secondary btn-sm" id="pd-jpeg-btn">${jpegIcon} Save as JPEG</button>
    ${o.extraButtons || ''}`;

    let fitCleanup = null;
    const panel = window.openPage(o.barLabel || (o.title || 'Document'), bodyHTML, '', {
      headerRightHTML,
      onClose: () => { if (fitCleanup) fitCleanup(); }
    });
    panel.classList.add('pd-host');

    panel.querySelector('#pd-print-btn')?.addEventListener('click', (e) => _handleDocPrintOrPdf(o, panel, e.currentTarget));
    panel.querySelector('#pd-jpeg-btn')?.addEventListener('click', (e) => _downloadDocJPEG(o, panel, e.currentTarget));

    if (window.lucide) lucide.createIcons({ nodes: [panel] });
    fitCleanup = _fitDocSheet(panel);

    if (o.autoPrint) {
      setTimeout(() => {
        if (!_isIOSStandalone()) {
          // Third print/capture site — same Hazard 7 unlock as
          // _handleDocPrintOrPdf. This one fires from a timer with nothing
          // awaiting it, so the promise is explicitly swallowed: withUnlocked
          // always returns one, and an unhandled rejection here would surface as
          // a console error on a path that previously could not reject.
          const run = window.ScrollLock?.withUnlocked?.bind(window.ScrollLock) || ((fn) => fn());
          Promise.resolve(run(() => { window.print(); })).catch(() => {});
        } else if (window.Notifs && Notifs.showToast) {
          Notifs.showToast('Use Print / Save PDF above.');
        }
      }, 400);
    }

    return panel;
  };

  // ═══════════════════════════════════════════════════════════
  //  §6 — openScreenPrintDoc: the SAME host, for screens that print themselves
  //  (MOBILE FINANCE PASS, 2026-08-08)
  // ═══════════════════════════════════════════════════════════
  // §1 above serves callers that BUILD a document (invoice, delivery receipt,
  // PO). Finance/HR has a second, older shape: screens that render into
  // #page-content (or into an openPage panel) and print THEMSELVES via a bare
  // `onclick="window.print()"`, relying on css/styles.css's `@media print`
  // block to hide the app chrome. Five of those exist — the Financial Report,
  // the income/expense category drilldown, Break-even, the payroll
  // three-way reconciliation, and the batch payslip run — and every one of them
  // is DEAD on iOS standalone for the reason js/screens/hr.js §4 already
  // documents: window.print() is a no-op in an Add-to-Home-Screen webview.
  //
  // This is deliberately NOT a second print mechanism. It is a call-shape
  // adapter: snapshot the live DOM, drop the on-screen-only chrome, and hand
  // the result to openPrintableDoc — so those five screens end up on exactly
  // the same iOS-aware Print / Save PDF / Save as JPEG path as every other doc,
  // with no per-caller iOS branching anywhere.
  //
  // opts:
  //   source   - Element to snapshot (REQUIRED; falls back to window.print())
  //   strip    - extra selector(s) to delete from the clone, on top of the
  //              default chrome list
  //   reveal   - selector(s) that are display:none on screen and must be shown
  //              in the document (the `*-print-lh` letterhead blocks); set as an
  //              inline style so it beats the cloned <style> tag's own rule
  //   title / barLabel / pageId / accent / watermark / pageCss - as §1
  const SCREEN_DOC_CSS = `
/* Pin the sheet width — print-docs §4: a .page with no width exports at CONTENT
   width instead of sheet width. */
.pd-print.page{width:210mm;padding:12mm;background:#fff}
/* .page already re-points --surface/--border/--text/--text-muted to light
   values (BASE_CSS), so cloned .card/.data-table markup comes out light-on-white
   without per-component overrides. These are the few tokens it does NOT own. */
.pd-print .card{background:#fff;border:1px solid #ccc;box-shadow:none;margin-bottom:10px;overflow:visible}
.pd-print .card-header{background:#f2f4f8;border-bottom:1px solid #ddd;padding:6px 9px}
.pd-print .card-header h3{font-size:11pt;font-weight:800;color:#1E3A5F;margin:0}
.pd-print .card-body{padding:8px 9px}
.pd-print .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:10px}
.pd-print .kpi-card{background:#f7f8fa;border:1px solid #ddd;border-radius:4px;padding:8px;box-shadow:none}
.pd-print .kpi-label{font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:.04em}
.pd-print .kpi-value{font-size:12pt;font-weight:800;color:#111}
.pd-print .data-table th{background:#1E3A5F;color:#fff;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pd-print .data-table td,.pd-print .data-table th{border:1px solid #ccc;padding:4px 6px;font-size:9.5pt}
/* .table-wrap is overflow-x:auto on screen — an overflow container clips in the
   210mm sheet and in the html2canvas capture, so release it (and its ≤640px
   edge-fade ::after, which would paint a themed band over the paper). */
.pd-print .table-wrap,.pd-print .table-scroll{overflow:visible}
.pd-print .table-wrap::after,.pd-print .table-scroll::after{display:none}
.pd-print .badge{border:1px solid #bbb;background:#f2f2f2;color:#333;padding:1px 5px;border-radius:3px;font-size:8pt}
.pd-print .progress-bar-wrap{background:#eee;border:1px solid #ddd}
.pd-print .empty-state{color:#555}`;

  const SCREEN_STRIP = [
    '.no-print', 'script', 'button', '.btn', '.btn-primary', '.btn-secondary',
    '.btn-danger', '.btn-outline', '.btn-success', '.chip-tabs', '.fab',
    '.skeleton', '.skeleton-row', 'input', 'select', 'textarea'
  ].join(', ');

  window.openScreenPrintDoc = function (opts) {
    const o = opts || {};
    const src = o.source;
    // Never leave the caller with a dead button: if the snapshot target is
    // missing, fall through to the behaviour that at least still works on
    // desktop rather than doing nothing at all.
    if (!src || typeof src.cloneNode !== 'function') {
      try { window.print(); } catch (_) {}
      return null;
    }
    const clone = src.cloneNode(true);
    try {
      clone.querySelectorAll(SCREEN_STRIP + (o.strip ? ', ' + o.strip : ''))
           .forEach(el => el.remove());
      if (o.reveal) clone.querySelectorAll(o.reveal).forEach(el => { el.style.display = 'block'; });
    } catch (e) {
      console.error('openScreenPrintDoc: could not prepare the snapshot', e);
    }
    return window.openPrintableDoc({
      title: o.title || 'Document',
      barLabel: o.barLabel || null,
      pageId: o.pageId || 'pd-screen-page',
      accent: o.accent || '#1E3A5F',
      watermark: o.watermark || null,
      pageCss: SCREEN_DOC_CSS + '\n' + (o.pageCss || ''),
      bodyHtml: clone.innerHTML
    });
  };
})();
