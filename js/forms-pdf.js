/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — standalone "Download PDF"
   js/forms-pdf.js — the ONE PDF path: the forms engine's A4 preview (js/print-docs.js, downloadPdf option) and the quote builder's printed
   Quotation both call it.
   ═══════════════════════════════════════════════════
   STANDALONE. A plain browser IIFE that needs nothing from the operations app: no data layer, no sign-in, no script loader, no document builder. The
   quote builder runs in an iframe with none of those, and must be able to load just this file. It uses only two same-origin
   vendored files — js/vendor/html2canvas.min.js and js/pdf-lite.js — which it loads itself when missing, from the folder this file was loaded from
   (document.currentScript.src, so the same ?v= cache-bust rides along and it works from the root page and from the app alike).

   window.FormsPdf.download(target, fileName, opts?) → Promise<{ ok, fileName, error?, pages?, delivery? }>
     target    an Element, or an HTML string. A string is rendered into an off-screen A4-width container (794 CSS px, 1123 for landscape) with the
               caller's styles in effect, then removed. An Element is captured from a clone (so a scale-to-fit transform on a preview never skews
               it) unless opts.inPlace is true.
     fileName  ".pdf" is added when missing; cleaned exactly as print-docs.js cleans a file stem (letters, digits and hyphens only).
     opts      { landscape?: boolean   page orientation (default: landscape when the content is wider than 950 px)
                 quality?:   number      JPEG quality of the page images, 0–1 (default 0.92)
                 scale?:     number      canvas scale (default 2 ≈ 190 dpi; lowered automatically to stay under the phone canvas limit)
                 title?:     string      title handed to the share sheet (default: the file name)
                 inPlace?:   boolean     capture the Element itself instead of a clone
                 cutSelector? / keepNextSelector?   page-break candidates and heading-like blocks (defaults below)
                 deliver?:   boolean     false → build only; the File comes back as result.file }
   Tall content is cut into A4 pages (pdf-lite's array form) at the (visual) top edge of a table row or a block — never through a row, never between a heading
   (or a table's header row, or a category band) and what follows it, and never between the signature row and the footer under it (no footer-only page). Delivery: the share sheet when the device can share files and its main pointer
   is touch (phones, the iPhone home-screen app); otherwise a plain <a download> blob link. It NEVER throws: failures come back as { ok:false, error }.
   window.FormsPdf.ensureDeps() → Promise<void> loads the two vendored files (rejects with a plain message when they cannot be loaded).

   The page-splitting and file-name logic are pure helpers, exported for Node (tests/forms-pdf.test.mjs) the way js/money-core.js exports its own.   */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;

  // ═══ pure helpers ═════════════════════════════════════════════════════════════════════════════════════════
  const A4_W = 595.28, A4_H = 841.89;                       // PDF points, 210 × 297 mm
  const PORTRAIT_PX = 794, LANDSCAPE_PX = 1123;             // CSS px of an A4 sheet at 96 dpi
  const DEFAULT_CUT = 'tr, [data-pdf-cut], .section, .sig-row, .print-footer, .terms-block, .bill-strip';
  // keep-with-next: a heading, a category band, a table's header row, and the signature row (so the thanks / credentials footer is never left alone on a page)
  const DEFAULT_KEEP = '[data-pdf-keep-next], .sec-title, .cat-row, thead tr, .sig-row';

  // The file name, as print-docs.js's _sanitizeDocName cleans a stem (everything but letters, digits and hyphens goes), plus ".pdf" once.
  function cleanFileName(name) {
    const stem = String(name == null ? '' : name).replace(/\.pdf\s*$/i, '').replace(/[^a-zA-Z0-9-]/g, '') || 'document';
    return stem + '.pdf';
  }
  const isLandscape = (widthPx, optLandscape) => (typeof optLandscape === 'boolean' ? optLandscape : Number(widthPx) > 950);
  // One A4 page in CSS px at this content width.
  const pageHeightPx = (widthPx, landscape) => Number(widthPx) * (landscape ? A4_W / A4_H : A4_H / A4_W);

  // Allowed break positions from the raw measurements: every candidate's top edge (ascending, unique, > 0) EXCEPT the first candidate after each
  // keep-with-next position — that is where a heading, a header row or a category band would be left alone at the foot of a page.
  function allowedCuts(candidateYs, keepYs) {
    const pts = (candidateYs || []).map(Math.round).filter((y) => isFinite(y)).sort((a, b) => a - b);
    const forbidden = new Set();
    (keepYs || []).forEach((k) => { const next = pts.find((p) => p > Math.round(k)); if (next !== undefined) forbidden.add(next); });
    return pts.filter((p, i) => p > 0 && !forbidden.has(p) && pts[i - 1] !== p);
  }
  // [[y0, y1], …] — bands of at most pageH, each ended at the last allowed cut that leaves the page at least `minFill` full; with no such cut the band is
  // cut at the page boundary. Always makes progress; always ends at totalH.
  function pageBands(cuts, totalH, pageH, minFill) {
    const fill = minFill === undefined ? 0.35 : minFill;
    const pts = cuts || [];
    const bands = [];
    let start = 0;
    while (totalH - start > pageH + 2) {
      const target = start + pageH;
      let cut = 0;
      for (let i = pts.length - 1; i >= 0; i--) { if (pts[i] <= target && pts[i] > start + pageH * fill) { cut = pts[i]; break; } }
      if (!cut) cut = Math.round(target);
      bands.push([start, cut]);
      start = cut;
    }
    bands.push([start, totalH]);
    return bands;
  }
  // The canvas scale: the wanted one, lowered so width × height × scale² stays under ~12 MP (a phone's canvas cap is near 16.7 MP), never below 1.
  const fitScale = (w, h, wanted, maxPixels) => Math.max(1, Math.min(Number(wanted) || 2, Math.sqrt((maxPixels || 12e6) / Math.max(1, w * h))));
  // Source rectangles (canvas px) of each band: sy from the top, sh clipped to the page and to what is left of the canvas.
  function sliceRects(bands, k, pagePx, canvasH) {
    return bands.map((b) => {
      const sy = Math.round(b[0] * k);
      return { sy, sh: Math.max(0, Math.min(Math.round((b[1] - b[0]) * k), canvasH - sy, pagePx)) };
    });
  }
  // A sibling file of this script, same folder, same ?v=. selfSrc may be '' (then baseHref's /js/ folder is used).
  function depUrl(selfSrc, rel, baseHref) {
    try {
      const self = new URL(selfSrc || 'js/forms-pdf.js', baseHref || 'http://localhost/');
      const u = new URL(rel, self);
      u.search = self.search;
      return u.href;
    } catch (_) { return rel; }
  }

  // ═══ browser side ═════════════════════════════════════════════════════════════════════════════════════════
  const SELF_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  const selfSrc = () => {
    if (SELF_SRC) return SELF_SRC;
    try { const s = document.querySelector('script[src*="forms-pdf.js"]'); return (s && s.src) || ''; } catch (_) { return ''; }
  };
  const loading = {};
  function loadOnce(globalName, rel) {
    if (root[globalName]) return Promise.resolve();
    if (!loading[globalName]) {
      loading[globalName] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = depUrl(selfSrc(), rel, typeof document !== 'undefined' ? document.baseURI : undefined);
        s.onload = () => (root[globalName] ? resolve() : reject(new Error('missing ' + globalName)));
        s.onerror = () => reject(new Error('load failed: ' + rel));
        document.head.appendChild(s);
      }).catch((e) => { delete loading[globalName]; throw e; });         // a failed load is retried by the next call
    }
    return loading[globalName];
  }
  function ensureDeps() {
    return Promise.all([loadOnce('html2canvas', 'vendor/html2canvas.min.js'), loadOnce('jpegToPdf', 'pdf-lite.js')]).then(() => undefined)
      .catch(() => { throw new Error('Could not load the PDF export library — check your connection and try again.'); });
  }

  // The VISUAL top of a block, relative to the capture root (which has no transform: it is an off-screen clone / host): the highest top of the block
  // and of anything inside it. A signature row's role label sits ON its divider, 9 px above the box — a cut at the box's own edge would slice that
  // label in half. Descendants with no size (display:none, <style>) are ignored.
  function visualTop(el, rootTop) {
    let top = el.getBoundingClientRect().top - rootTop;
    try {
      el.querySelectorAll('*').forEach((k) => {
        const b = k.getBoundingClientRect();
        if ((b.width || b.height) && b.top - rootTop < top) top = b.top - rootTop;
      });
    } catch (_) { /* a block with nothing inside it */ }
    return top;
  }
  function measureCuts(rootEl, opts) {
    const rootTop = rootEl.getBoundingClientRect().top;
    const ys = (sel) => { const out = []; try { rootEl.querySelectorAll(sel).forEach((el) => out.push(visualTop(el, rootTop))); } catch (_) { /* a bad selector leaves no candidates */ } return out; };
    return allowedCuts(ys(opts.cutSelector || DEFAULT_CUT), ys(opts.keepNextSelector || DEFAULT_KEEP));
  }
  // an image still loading would be captured half-drawn
  function imagesReady(rootEl) {
    return Promise.all(Array.from(rootEl.querySelectorAll('img')).map((img) => {
      if (img.complete) return null;
      return new Promise((res) => {
        const t = setTimeout(res, 3000), done = () => { clearTimeout(t); res(); };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    }));
  }
  const toJpegBlob = (canvas, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the page image.'))), 'image/jpeg', quality);
  });

  // The share sheet on a touch device that can share files; a plain <a download> blob link everywhere else (a desktop browser that can also share
  // files would otherwise open a share dialog where the user wanted a file).
  async function deliver(file, title) {
    const touch = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: title || file.name }); return 'share'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; throw e; }     // the user closing the sheet is not a failure
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.download = file.name; link.href = url; link.rel = 'noopener';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'download';
  }

  async function download(target, fileName, opts) {
    opts = opts || {};
    const name = cleanFileName(fileName);
    let rootEl = null, tidy = null;
    try {
      await ensureDeps();
      if (typeof target === 'string') {
        const host = document.createElement('div');
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = `position:fixed;left:-99999px;top:0;width:${opts.landscape === true ? LANDSCAPE_PX : PORTRAIT_PX}px;background:#fff;pointer-events:none;`;
        host.innerHTML = target;
        document.body.appendChild(host);
        rootEl = host; tidy = () => host.remove();
      } else if (target && target.nodeType === 1 && opts.inPlace) {
        rootEl = target;
      } else if (target && target.nodeType === 1) {
        const wrap = document.createElement('div');
        wrap.setAttribute('aria-hidden', 'true');
        wrap.style.cssText = `position:fixed;left:-99999px;top:0;width:${target.offsetWidth || PORTRAIT_PX}px;background:#fff;pointer-events:none;`;
        const clone = target.cloneNode(true);
        clone.style.transform = 'none'; clone.style.margin = '0';
        wrap.appendChild(clone);
        document.body.appendChild(wrap);
        rootEl = clone; tidy = () => wrap.remove();
      } else {
        throw new Error('There is nothing to export.');
      }
      await imagesReady(rootEl);
      const w = rootEl.offsetWidth || PORTRAIT_PX, h = rootEl.offsetHeight || 1123;
      const landscape = isLandscape(w, opts.landscape);
      const pageH = pageHeightPx(w, landscape);
      const bands = pageBands(measureCuts(rootEl, opts), h, pageH);
      const quality = opts.quality > 0 && opts.quality <= 1 ? opts.quality : 0.92;
      const attempt = async (scale) => {
        const canvas = await root.html2canvas(rootEl, { scale, useCORS: true, backgroundColor: '#fff', logging: false });
        const k = canvas.width / w, pagePx = Math.max(1, Math.round(pageH * k));
        const pages = [];
        for (const r of sliceRects(bands, k, pagePx, canvas.height)) {
          const slice = document.createElement('canvas');
          slice.width = canvas.width; slice.height = pagePx;
          const ctx = slice.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, slice.width, slice.height);      // a full-page white canvas: the last page sits at the top like the others
          if (r.sh > 0) ctx.drawImage(canvas, 0, r.sy, canvas.width, r.sh, 0, 0, canvas.width, r.sh);
          pages.push({ bytes: await (await toJpegBlob(slice, quality)).arrayBuffer(), pxW: slice.width, pxH: slice.height, landscape });
        }
        return pages;
      };
      let pages;
      try { pages = await attempt(fitScale(w, h, opts.scale)); } catch (_) { pages = await attempt(1); }      // a phone refusing the big canvas gets one retry at scale 1
      const file = new File([root.jpegToPdf(pages)], name, { type: 'application/pdf' });
      if (opts.deliver === false) return { ok: true, fileName: name, pages: pages.length, delivery: 'none', file };
      const delivery = await deliver(file, opts.title);
      return { ok: true, fileName: name, pages: pages.length, delivery };
    } catch (err) {
      return { ok: false, fileName: name, error: 'Could not generate the PDF — ' + (err && err.message ? err.message : 'please try again.') };
    } finally {
      if (tidy) { try { tidy(); } catch (_) { /* already gone */ } }
    }
  }

  const api = { download, ensureDeps, A4_W, A4_H, cleanFileName, isLandscape, pageHeightPx, allowedCuts, pageBands, fitScale, sliceRects, depUrl, DEFAULT_CUT, DEFAULT_KEEP };
  root.FormsPdf = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
