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
  // headerRightHTML (§3) replaces it. ──
  const BASE_CSS = `
.pd-stage,.pd-stage *{box-sizing:border-box;margin:0;padding:0}
.pd-stage{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;margin:0 auto;padding:16px 8px}
.pd-stage table{width:100%;border-collapse:collapse}
.pd-stage th,.pd-stage td{border:1px solid #444;padding:5px 7px;font-size:11px;vertical-align:top}
.pd-stage td.c{text-align:center}
.pd-stage td.r{text-align:right}
.pd-stage td.b{font-weight:700}
.pd-stage tr.blank td{height:22px}
.pd-stage .page{position:relative;background:#fff;color-scheme:light;
  --surface:#fff;--surface2:#f4f4f4;--border:#ddd;--text:#222;--text-muted:#666}
.pd-stage .wm{position:absolute;top:45%;left:0;right:0;text-align:center;transform:rotate(-24deg);
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
    document.body.appendChild(wrap);
    try {
      return await window.html2canvas(clone, { scale: opts.scale || 2, useCORS: true, backgroundColor: '#fff', logging: false });
    } finally {
      wrap.remove();
    }
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
    let canvas = await _captureDocCanvas(panel, o, { scale: 2 });
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
    if (!_isIOSStandalone()) { window.print(); return; }
    const origLabel = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      await _shareDocPDF(o, panel);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // user cancelled the share sheet — not a failure, swallow silently.
      } else if (err && err.code === 'SHARE_UNAVAILABLE') {
        if (window.Notifs && Notifs.showToast) Notifs.showToast('Sharing isn’t available on this device — trying Print, or use Save as JPEG instead.', 'error');
        try { window.print(); } catch (_) {}
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
      const bodyEl = sheet.closest('.page-panel-body') || panel;
      const avail = (bodyEl && bodyEl.clientWidth) || panel.clientWidth || window.innerWidth;
      const scale = Math.max(0.05, Math.min(1, (avail - 16) / w));
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
          window.print();
        } else if (window.Notifs && Notifs.showToast) {
          Notifs.showToast('Use Print / Save PDF above.');
        }
      }, 400);
    }

    return panel;
  };
})();
