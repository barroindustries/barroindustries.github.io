/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Shared Document Letterhead Engine
   js/letterhead.js  (loads AFTER config.js so window.BRAND exists)
   ═══════════════════════════════════════════════════
   window.buildLetterhead(opts) -> { headerHTML, footerHTML, printCSS }
   All three are inlinable strings usable inside a window.open()+document.write()
   document OR injected into an in-page container. Caller concatenates:
     <style>${printCSS}${docSpecificCSS}</style> ... ${headerHTML} ...<sections>... ${footerHTML}
   The engine escapes every field it interpolates (BRAND fields are trusted-static;
   doc-specific fields like docNumber / signature names may be user-derived). */
(function () {
  const esc = (s) => (window.escHtml ? window.escHtml(String(s == null ? '' : s))
                                     : String(s == null ? '' : s).replace(/[&<>"']/g,
                        c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])));

  // Absolute logo URL — resolves inside window.open('','_blank') docs (no base href).
  function absLogo(path) {
    try { return location.origin + location.pathname.replace(/[^/]*$/, '') + path; }
    catch (_) { return path; }
  }

  window.buildLetterhead = function (opts) {
    const o = opts || {};
    const B = window.BRAND || {};
    const ent = o.entity || (window.brandEntity ? window.brandEntity('corporate') : {});
    const accent = o.accent || '#1E3A5F';
    const showLogo = o.showLogo !== false;
    const logoUrl = absLogo(o.logo || (B.logo && B.logo.print) || 'icons/barro-industries.png');

    // ── Entity identity lines (left column) ──
    const idLines = [];
    if (ent.registration) idLines.push(esc(ent.registration));
    if (ent.address)      idLines.push(esc(ent.address));
    const contactBits = [];
    if (ent.phone) contactBits.push(esc(ent.phone));
    if (ent.email) contactBits.push(esc(ent.email));
    if (contactBits.length) idLines.push(contactBits.join('  ·  '));
    if (ent.tin)   idLines.push('TIN: ' + esc(ent.tin));

    const logoImg = showLogo
      ? `<img src="${logoUrl}" class="lh-logo" alt="" onerror="this.style.display='none'"/>` : '';

    // ── Right column: doc title / number / date / extra meta ──
    const metaLines = [];
    if (o.docNumber) metaLines.push(`<div class="lh-docno">${esc(o.docNumber)}</div>`);
    if (o.dateLabel) metaLines.push(`<div class="lh-docdate">${esc(o.dateLabel)}</div>`);
    (o.extraMeta || []).forEach(m => metaLines.push(`<div class="lh-docmeta">${esc(m)}</div>`));

    const headerHTML =
`<div class="lh-header" style="--lh-accent:${accent}">
  <div class="lh-id">
    ${logoImg}
    <div>
      <div class="lh-name">${esc(ent.name || B.name || '')}</div>
      ${idLines.map(l => `<div class="lh-idline">${l}</div>`).join('')}
    </div>
  </div>
  <div class="lh-doc">
    ${o.docTitle ? `<div class="lh-doctitle">${esc(o.docTitle)}</div>` : ''}
    ${metaLines.join('')}
  </div>
</div>`;

    // ── Signature grid (variable 1–4 slots) ──
    const sigs = Array.isArray(o.signatures) ? o.signatures : [];
    const sigHTML = sigs.length
      ? `<div class="lh-sig-row" style="grid-template-columns:repeat(${sigs.length},1fr)">` +
        sigs.map(s =>
          `<div class="lh-sig"><div class="lh-sig-line"></div>` +
          `<b>${esc(s.name || '')}</b>` +
          `<span>${esc(s.label || '')}${s.title ? ' — ' + esc(s.title) : ''}</span></div>`
        ).join('') + `</div>`
      : '';

    const footerHTML =
`${sigHTML}
<div class="lh-footer" style="--lh-accent:${accent}">${esc(o.footerNote || (B.fullName || 'Barro Industries Operating System'))}</div>`;

    // ── Shared print CSS — generalized from quote-builder-v2.html:329-386 ──
    const printCSS =
`.lh-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;padding-bottom:7px;border-bottom:2.5px solid var(--lh-accent,#1E3A5F);}
.lh-id{display:flex;align-items:flex-start;gap:12px;}
.lh-logo{height:56px;flex-shrink:0;margin-top:1px;}
.lh-name{font-size:16pt;font-weight:900;color:var(--lh-accent,#1E3A5F);letter-spacing:.4px;line-height:1.1;}
.lh-idline{font-size:9pt;color:#555;margin-top:1px;}
.lh-doc{text-align:right;}
.lh-doctitle{font-size:14pt;font-weight:900;color:var(--lh-accent,#1E3A5F);letter-spacing:1px;}
.lh-docno{font-size:11pt;font-weight:700;color:#333;margin-top:4px;}
.lh-docdate,.lh-docmeta{font-size:9.5pt;color:#555;margin-top:2px;}
.lh-sig-row{display:grid;gap:36px;margin-top:20px;}
.lh-sig{text-align:center;}
.lh-sig-line{border-top:1px solid #000;margin-top:26px;}
.lh-sig b{display:block;font-size:11px;color:#000;margin-top:5px;}
.lh-sig span{font-size:10px;color:#444;}
.lh-footer{margin-top:18px;border-top:1px solid #ddd;padding-top:8px;font-size:9px;color:#999;text-align:center;}
@media print{
  @page{size:A4 portrait;margin:11mm 10mm 7mm;}
  body{background:#fff!important;}
  .lh-noprint{display:none!important;}
  /* two-tier page-break strategy (quote fix aab024a): sections FLOW, headers repeat, rows stay whole */
  .lh-section{page-break-inside:auto;break-inside:auto;}
  thead{display:table-header-group;}
  tr,.lh-avoid,.cat-row,.subtotal-row{page-break-inside:avoid;break-inside:avoid;}
  .lh-sig-row{page-break-inside:avoid;}
  th{background:var(--lh-accent,#1E3A5F)!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
}`;

    return { headerHTML, footerHTML, printCSS };
  };

  // ── Bonus: atomic doc-serial for future BIR docs (reuses _counters, already rules-covered) ──
  // e.g. await nextSerial('invoice','INV') -> 'INV-2026-000123'. Not called by WS14 conversions.
  window.nextSerial = async function (counterKey, prefix) {
    const ref = db.collection('_counters').doc(counterKey);
    const n = await db.runTransaction(async t => {
      const c = await t.get(ref);
      const next = (c.exists ? (c.data().count || 0) : 0) + 1;
      t.set(ref, { count: next }, { merge: true });
      return next;
    });
    return `${prefix}-${(window.bizYear ? window.bizYear() : new Date().getFullYear())}-${String(n).padStart(6, '0')}`;
  };
})();
