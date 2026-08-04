// ═══════════════════════════════════════════════════════════
//  js/pdf-lite.js — dependency-free JPEG → single/multi-page A4 PDF
//  PAYSLIP-OVERHAUL-SPEC.md §4. A JPEG is embeddable in a PDF verbatim as a
//  DCTDecode XObject stream — no re-encoding, no external library. This file
//  hand-assembles the minimal PDF object graph (Catalog → Pages → one
//  Page/Contents/Image-XObject triple per page) with a correct xref table,
//  which is all a JPEG→PDF wrapper needs. No DOM, no Firebase, no window
//  dependency beyond attaching the export (browser-only helper — lazy-loaded
//  same-origin by js/screens/hr.js's _ensurePdfLite(), same pattern as the
//  vendored html2canvas).
//
//  window.jpegToPdf(jpegBytes, pxW, pxH, landscape) -> Uint8Array (one-page PDF)
//  window.jpegToPdf([{bytes,pxW,pxH,landscape}, ...])  -> Uint8Array
//    (multi-page PDF, one page per entry, in array order — §4's "Multi-page:
//    one canvas slice per 1123px-equivalent -> one PDF page each" edge case).
//
//  DOCUMENTS-PRINT-SPEC.md §4 point 3 — ADDITIVE landscape support (2026-08):
//  every page defaults to portrait A4 (byte-identical to before this change
//  when the flag is omitted — the payslip's sharePayslipPDF call in hr.js is
//  untouched and never passes it). Pass `landscape` as the 4th arg for the
//  single-page form, or set `.landscape` on any entry of the array form
//  (js/print-docs.js's ROC/AEC/inventory-count landscape sheets use this).
//  Accepts either a bare boolean or `{landscape:true}` for a little
//  future-proofing against a caller reaching for an options-object shape.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';

  // A4 in PDF points (1pt = 1/72in): 210mm × 297mm ≈ 595.28 × 841.89pt.
  var PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 28;

  function isLandscape(x) {
    if (x === true) return true;
    if (x && typeof x === 'object' && x.landscape) return true;
    return false;
  }

  function asciiBytes(str) {
    var buf = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i) & 0xFF;
    return buf;
  }

  function toBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (x && x.buffer instanceof ArrayBuffer && typeof x.byteLength === 'number') return new Uint8Array(x.buffer, x.byteOffset || 0, x.byteLength);
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (Array.isArray(x)) return new Uint8Array(x);
    throw new Error('jpegToPdf: unsupported JPEG byte source');
  }

  function concatBytes(chunks) {
    var total = 0, i;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
    return out;
  }

  // PDF xref entries are fixed 20-byte lines: "nnnnnnnnnn ggggg n \n"
  function padOffset(n) {
    var s = String(n);
    while (s.length < 10) s = '0' + s;
    return s;
  }

  window.jpegToPdf = function (jpegBytesOrPages, pxW, pxH, landscape) {
    var pages = Array.isArray(jpegBytesOrPages)
      ? jpegBytesOrPages.map(function (p) { return { bytes: toBytes(p.bytes), pxW: p.pxW, pxH: p.pxH, landscape: isLandscape(p.landscape) }; })
      : [{ bytes: toBytes(jpegBytesOrPages), pxW: pxW, pxH: pxH, landscape: isLandscape(landscape) }];

    if (!pages.length) throw new Error('jpegToPdf: no pages supplied');

    // Object numbering: 1 = Catalog, 2 = Pages, then per page: Page, Contents, Image (3 objs each).
    var CATALOG = 1, PAGES = 2;
    var next = 3;
    var pageObjs = pages.map(function (p) {
      var pageNum = next++, contentsNum = next++, imgNum = next++;
      return { pageNum: pageNum, contentsNum: contentsNum, imgNum: imgNum, bytes: p.bytes, pxW: p.pxW, pxH: p.pxH, landscape: p.landscape };
    });
    var maxObjNum = next - 1;

    // objMap[n] is either a Uint8Array (plain dict-only object body) or
    // {dict, stream} (a stream object — Contents / Image XObject).
    var objMap = {};
    var kids = pageObjs.map(function (p) { return p.pageNum + ' 0 R'; }).join(' ');
    objMap[CATALOG] = asciiBytes('<< /Type /Catalog /Pages ' + PAGES + ' 0 R >>');
    objMap[PAGES] = asciiBytes('<< /Type /Pages /Kids [' + kids + '] /Count ' + pageObjs.length + ' >>');

    pageObjs.forEach(function (p) {
      if (!(p.pxW > 0 && p.pxH > 0)) throw new Error('jpegToPdf: page missing pixel width/height');
      // Additive landscape support (DOCUMENTS-PRINT-SPEC.md §4 point 3) — swap
      // the page box dimensions for this page only when flagged; every
      // existing caller never sets it, so pageW/pageH === PAGE_W/PAGE_H and
      // this is byte-identical to the pre-flag behavior.
      var pageW = p.landscape ? PAGE_H : PAGE_W, pageH = p.landscape ? PAGE_W : PAGE_H;
      var scale = Math.min((pageW - 2 * MARGIN) / p.pxW, (pageH - 2 * MARGIN) / p.pxH);
      var drawW = p.pxW * scale, drawH = p.pxH * scale;
      var x = (pageW - drawW) / 2, y = (pageH - drawH) / 2;
      var contentStr = 'q ' + drawW.toFixed(2) + ' 0 0 ' + drawH.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im' + p.pageNum + ' Do Q';
      var contentBytes = asciiBytes(contentStr);
      objMap[p.pageNum] = asciiBytes(
        '<< /Type /Page /Parent ' + PAGES + ' 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + ']' +
        ' /Resources << /XObject << /Im' + p.pageNum + ' ' + p.imgNum + ' 0 R >> >>' +
        ' /Contents ' + p.contentsNum + ' 0 R >>'
      );
      objMap[p.contentsNum] = { dict: '<< /Length ' + contentBytes.length + ' >>', stream: contentBytes };
      objMap[p.imgNum] = {
        dict: '<< /Type /XObject /Subtype /Image /Width ' + p.pxW + ' /Height ' + p.pxH +
              ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.bytes.length + ' >>',
        stream: p.bytes
      };
    });

    var chunks = [];
    var header = asciiBytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    chunks.push(header);
    var offset = header.length;
    var offsets = {};

    for (var n = 1; n <= maxObjNum; n++) {
      offsets[n] = offset;
      var body = objMap[n];
      var objBytes;
      if (body instanceof Uint8Array) {
        objBytes = concatBytes([asciiBytes(n + ' 0 obj\n'), body, asciiBytes('\nendobj\n')]);
      } else {
        objBytes = concatBytes([asciiBytes(n + ' 0 obj\n' + body.dict + '\nstream\n'), body.stream, asciiBytes('\nendstream\nendobj\n')]);
      }
      chunks.push(objBytes);
      offset += objBytes.length;
    }

    var xrefStart = offset;
    var xref = 'xref\n0 ' + (maxObjNum + 1) + '\n0000000000 65535 f \n';
    for (var m = 1; m <= maxObjNum; m++) xref += padOffset(offsets[m]) + ' 00000 n \n';
    var xrefBytes = asciiBytes(xref);
    chunks.push(xrefBytes);
    offset += xrefBytes.length;

    var trailer = 'trailer\n<< /Size ' + (maxObjNum + 1) + ' /Root ' + CATALOG + ' 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';
    chunks.push(asciiBytes(trailer));

    return concatBytes(chunks);
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { jpegToPdf: window.jpegToPdf };
  }
})();
