/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Shared Printable-Document Scaffold
   js/print-docs.js  (loads AFTER letterhead.js, BEFORE departments.js)
   ═══════════════════════════════════════════════════
   window.openPrintableDoc(opts) -> Window | null
   Owns the window.open + full <html> scaffold + toolbar (Print/Close, plus
   any extraButtons) + optional watermark + document.write/close that used to
   be duplicated across buildBillingInvoiceHTML, printDeliveryReceipt,
   openInventoryCountForm's print path, openAECPrintSheet, printPurchaseOrder
   and printReceivingReport. Callers still build their own body table HTML —
   this module never touches document content, only the surrounding chrome.

   opts:
     title        - <title> text (plain text, will be escaped)
     bodyHtml     - inner HTML for the #<pageId> page div (unchanged per-doc content)
     pageId       - id attribute for the page div (default 'pd-page'; used by
                    callers that need to reference the node, e.g. the invoice's
                    html2canvas JPEG export)
     barLabel     - full HTML string shown in the toolbar (icon + doc title/no)
     extraButtons - optional extra HTML (rendered between Print and Close)
     extraScript  - optional raw JS injected in a trailing <script> tag
     accent       - toolbar background / accent hex (default '#1E3A5F')
     bgColor      - page background color, outside the .page sheet (default '#e8e8e8')
     pageCss      - per-doc CSS (page size/padding, table column widths, watermark
                    color, @page rules, etc.) — rides in verbatim after the shared
                    base CSS so it wins the cascade where it differs
     watermark    - optional watermark text (e.g. 'PENDING APPROVAL'); rendered
                    using the shared .wm rule unless overridden in pageCss
     winFeatures  - window.open() features string (default 'width=900,height=720')
     autoPrint    - if true, calls win.print() once the doc has loaded
   Returns the opened Window, or null if pop-ups are blocked (after showing
   the standard toast) so callers can bail out the same way they did before. */
(function () {
  const esc = (s) => (window.escHtml ? window.escHtml(String(s == null ? '' : s))
                                     : String(s == null ? '' : s).replace(/[&<>"']/g,
                        c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])));

  // ── Shared base CSS — the rules identical (or structurally identical) across
  // all six legacy builders: reset, body font, generic table/cell rules, the
  // fixed toolbar shell, and the print-time toolbar hide. Anything that varied
  // per doc (page width/padding, bar/table accent color, @page size, watermark
  // rotation/opacity) stays in each caller's pageCss. ──
  const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #444;padding:5px 7px;font-size:11px;vertical-align:top}
td.c{text-align:center}
td.r{text-align:right}
td.b{font-weight:700}
tr.blank td{height:22px}
.bar{position:fixed;top:0;left:0;right:0;background:var(--pd-accent,#1E3A5F);color:#fff;padding:9px 18px;display:flex;gap:10px;align-items:center;z-index:99}
.bar button{background:#fff;color:var(--pd-accent,#1E3A5F);border:none;padding:6px 15px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer}
.bar button:hover{opacity:.9}
.bar .pd-close{margin-left:auto;background:rgba(255,255,255,.15);color:#fff}
.barpad{height:46px}
.wm{position:fixed;top:45%;left:0;right:0;text-align:center;transform:rotate(-24deg);
    font-size:64px;font-weight:900;letter-spacing:6px;color:rgba(192,57,43,.13);
    z-index:5;pointer-events:none}
@media print{
  .bar,.barpad{display:none!important}
  body{background:#fff!important}
  .wm{color:rgba(192,57,43,.16)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;

  window.openPrintableDoc = function (opts) {
    const o = opts || {};
    const pageId = o.pageId || 'pd-page';
    const accent = o.accent || '#1E3A5F';
    const bg = o.bgColor || '#e8e8e8';
    const closeIcon = window.emojiIcon ? emojiIcon('✕', 16) : '✕';
    const printIcon = window.emojiIcon ? emojiIcon('🖨', 16) : '🖨';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>${esc(o.title || '')}</title>
<style>
${BASE_CSS}
body{background:${bg}}
${o.pageCss || ''}
</style></head><body style="--pd-accent:${accent}">
<div class="bar">
  <span style="font-weight:700">${o.barLabel || ''}</span>
  <button onclick="window.print()">${printIcon} Print / Save as PDF</button>
  ${o.extraButtons || ''}
  <button class="pd-close" onclick="window.close()">${closeIcon} Close</button>
</div>
<div class="barpad"></div>
<div class="page" id="${esc(pageId)}">
  ${o.watermark ? `<div class="wm">${esc(o.watermark)}</div>` : ''}
  ${o.bodyHtml || ''}
</div>
${o.extraScript ? `<script>${o.extraScript}<\/script>` : ''}
${o.autoPrint ? `<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script>` : ''}
</body></html>`;

    const win = window.open('', '_blank', o.winFeatures || 'width=900,height=720');
    if (!win) {
      if (window.Notifs && Notifs.showToast) Notifs.showToast('Allow pop-ups to print documents.', 'error');
      return null;
    }
    win.document.write(html);
    win.document.close();
    return win;
  };
})();
