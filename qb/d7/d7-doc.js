/* ==============================================================================================================
   qb/d7/d7-doc.js: D7.doc.   The document layer of the configurators in the LIVE quote builder (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md sections 1.2 M7 / M9 / M14, 3.7, 5 packet C).
   Ported from the D7 prototype's d7/d7-doc.js (its spec 3.3 to 3.5, 3.8 (M8), 3.13, E20, E21, E22).   Loaded after kc/*, before d7-adapter.js.
   KC:C marks what is different in the live builder: the Photo column also shows an image from the company's own Firebase Storage (the prototype refused every remote image).

   WHAT IT IS   The ONE print block of every Barro Kitchens / Barro Industries line (owner D5), the Photo column, the Workforce Copy detail, the
                "Our standard" bullet and the owner wording of the summary strip.  Nothing here reads or writes a price, a cost or a quote total:
                the document layer only draws text the other layers already decided.  Brilliance Steel and "as issued" quotes never reach it
                (the builder calls these hooks only when d7On() is true).

   HOOKS        (D7.h('doc.<name>', ...) in quote-builder.html; a hook that throws is turned into '' by D7.h)
     parts(item)                    -> { material, use, title, sub, dims, dimsLabel, specs, notes[], includes[], excludes[], sep }   all PLAIN text, never HTML
     blockHtml(parts, {print})      -> the D5 block, HTML.  Includes / Not included are part of the Notes row unless {print:false}.
     lines(parts, {print})          -> the same block as an array of plain-text lines (for the Checks screen and the approval view)
     printBlock(item, idx, {view})  -> the block for the .sheet-slot of EVERY D7 line (print and the Client preview).  Also repaints that row's screen block.
     screenBlock(item, idx)         -> the same block for the description cell of a kc line on screen (class no-print: it never prints, the slot does)
     photoCell(item, idx)           -> the Photo cell: the linked quote photo, else the drawing (thumbnail, no labels), else item.photoUrl, else nothing
     workforceBlock(item, idx)      -> the .wf-only detail of a kc line: full drawing with labels + one table per build part, quantities only, no prices
     standardBullets()              -> [{ title:'Standard construction', text }]   the std sentence of each kc product on the quote, once each, product order
     summaryStrip(text, state)      -> the strip with the owner wording "65% downpayment, 35% upon delivery" (or '' to keep the text as it is)
     setUse(idx, use)               -> the "Use" pills of the Details editor (item.use, and the stored snapshot's use)
     header(state)                  -> the Forms Standard header of a KC quote ('' = keep the old letterhead): the page calls it from applyLetterheadHeader()
     sync()                         -> puts the KC-only chrome in the page (Download PDF buttons, the Prepared by box) or takes it out again
     print()                        -> the optional hook of doPrint(): prints; the name in the print dialog is the quote number, set by the wrapper of window.print
     downloadPdf()                  -> Promise<{ ok, fileName, error? }>, never rejects: the one function behind every Download PDF button (FormsPdf of js/forms-pdf.js, from A4 page containers)
     buildA4()                      -> Promise<{ ok, node, pages, dispose }>: the A4 page containers of the document;  paginate(units, pageH) -> { pages, overflow }: the pure packing step
   EXTRAS       drawing(item, {noTop, small}) -> the product's SVG string ('' when there is none; a small one has its text labels removed, owner Q38)
                safeSrc(url) -> the url when it is a data: / blob: image, a relative path of this site, or an https image from this site or the company's Firebase Storage, else ''

   WHERE THE TEXT COMES FROM (spec 3.4)
     kc product line   item.doc, the snapshot the adapter stored (so a filed quote prints the same after a product file changes); when it is missing
                       (a quote stored before the adapter, or the adapter not loaded) it is built here from KC.products[kind] the way KC.descBlock does.
                       The line note (item.notes) goes first in Notes, then the product's forced notes, then Includes / Not included.
     kc custom item    material = the one the description names, else STAINLESS STEEL 304; title cfg.name; dims cfg.dims; specs cfg.desc; the Details editor's
                       finish / specLines / includes / excludes are added like any other line.
     every other line  material = an extra row (Details editor) labelled "Material", else the Material row of item.specs, else item.material, else STAINLESS STEEL 304
                       for a made-to-order line and nothing for a bought-in one (then the first line is only the use); use = item.use or COMMERCIAL;
                       specs = item.specEdit when defined, else the other spec rows (not Material, not Construction: that goes to the "Our standard" page),
                       then the finish label, then the extra rows; notes = item.notes, Includes, Not included.
   Every string is escaped on the way out (txtEsc plus the apostrophe).  Nothing here touches the network.

   FORMS STANDARD (owner Round 5, Addendum 1 A5): see the section of that name below (header, the Prepared by box, Download PDF and the A4 pages, the PDF name); the phone cards of the Client preview (Q66) are CSS only (d7-doc.css section 8).
   ============================================================================================================== */
(function () {
  'use strict';
  const D7 = window.D7 = window.D7 || {};
  D7.doc = D7.doc || {};

  /* ---------- small helpers ---------- */
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const arr = v => Array.isArray(v) ? v : [];
  const str = v => typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : '';
  const trim = v => str(v).trim();
  /* escape for HTML text AND for a double-quoted attribute: the page's own txtEsc (& " < >) plus the apostrophe */
  const esc = s => {
    const t = String(s == null ? '' : s);
    const e = typeof window.txtEsc === 'function' ? window.txtEsc(t) : t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return e.replace(/'/g, '&#39;');
  };
  const escBr = s => esc(s).replace(/\r?\n/g, '<br>');
  const list = v => (Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? [v] : [])).map(trim).filter(Boolean);
  const nf2 = n => (Number.isFinite(+n) ? (+n).toFixed(2) : '');

  /* HTML -> plain text.  A DOMParser document is inert (no script runs, no image loads), so this is safe for any string.  Used on KC's shortSpecs (always HTML:
     force) and, as a safety net, on a stored snapshot whose Specs still carry the kc host's own markup (<span>, <br>); typed text with other tags stays literal,
     exactly as KC.descBlock prints it. */
  function htmlToText(html, force) {
    html = str(html);
    if (!force && !/<\/?(?:span|br)\b[^>]*>/i.test(html)) return html;
    try {
      const doc = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html');
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (e) { return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
  }

  /* the join of a Specs paragraph: pieces end in "; " unless the piece before them already ended a sentence */
  function joinPieces(pieces, addStop) {
    let out = '';
    pieces.forEach(p => {
      p = trim(p);
      if (!p) return;
      out = out ? out + (/[.!?]$/.test(out) ? ' ' : '; ') + p : p;
    });
    if (out && addStop && !/[.!?]$/.test(out)) out += '.';
    return out;
  }

  /* ---------- what kind of line is it ---------- */
  const QS = () => window.QBSpecSheet || null;
  const FINISH = () => (QS() && QS().FINISH_LABELS) || { hairline: 'Hairline finish', brushed: 'Brushed finish', mirror: 'Mirror finish', satin: 'Satin finish' };
  function madeToOrder(item) {
    try { if (QS() && typeof QS().isFabricated === 'function') return !!QS().isFabricated(item); } catch (e) { /* fall through */ }
    return !!(item && (item.familyId || item.id === 'CUSTOM' || item.formulaType === 'configurable'));
  }

  /* a custom item's material: the one its description names (a grade, a metal), else Stainless Steel 304 (spec 3.4) */
  function namedMaterial(desc) {
    const t = str(desc);
    let m = /stainless\s+steel\s+(?:grade\s+)?(\d{3}L?)\b/i.exec(t) || /\bSS\s?(\d{3}L?)\b/i.exec(t);
    if (m) return 'Stainless Steel ' + m[1].toUpperCase();
    if (/galvani[sz]ed\s+(?:iron|steel)|\bG\.?I\.?\s+sheet\b/i.test(t)) return 'Galvanized Iron';
    if (/black\s+iron/i.test(t)) return 'Black Iron';
    if (/alumin(?:i)?um/i.test(t)) return 'Aluminum';
    if (/mild\s+steel/i.test(t)) return 'Mild Steel';
    if (/marine\s+plywood/i.test(t)) return 'Marine Plywood';
    return '';
  }

  /* ---------- parts: the text of one line, as data ---------- */
  function emptyParts() { return { material: '', use: '', title: '', sub: '', dims: '', dimsLabel: 'Dimensions', specs: '', notes: [], includes: [], excludes: [], sep: '; ' }; }

  /* a line that has no product file behind it: a catalogue line, a website family line, an old 🧮 custom line, the kc custom item.
     o.title / o.dims / o.desc override the line's own name / dims / spec text (the kc custom item reads them from its cfg). */
  function genericParts(item, o) {
    o = o || {};
    const rows = arr(item.specs).filter(isObj).map(s => ({ label: trim(s.label), value: trim(s.value) })).filter(r => r.value);
    const extra = arr(item.specLines).filter(isObj).map(s => ({ label: trim(s.label), value: trim(s.value) })).filter(r => r.value);
    const matRow = rows.find(r => r.label === 'Material');
    const matExtra = extra.find(r => /^material$/i.test(r.label));      // an extra row of the Details editor labelled "Material" sets the first line (the editor has no material box)
    let material = matExtra ? matExtra.value : (matRow ? matRow.value : trim(item.material));
    if (!material && madeToOrder(item)) material = o.desc != null ? (namedMaterial(o.desc) || 'Stainless Steel 304') : 'Stainless Steel 304';
    const dims = trim(o.dims != null ? o.dims : item.dims);
    const pieces = []; let generated = false;
    if (o.desc != null) { if (trim(o.desc)) pieces.push(trim(o.desc)); }
    else if (item.specEdit !== undefined) { if (trim(item.specEdit)) pieces.push(trim(item.specEdit)); }
    else rows.forEach(r => { if (r.label !== 'Material' && r.label !== 'Construction') { pieces.push(r.label ? r.label + ': ' + r.value : r.value); generated = true; } });
    if (typeof item.finish === 'string' && has(FINISH(), item.finish)) { pieces.push(FINISH()[item.finish]); generated = true; }
    extra.forEach(r => { if (r !== matExtra) { pieces.push(r.label ? r.label + ': ' + r.value : r.value); generated = true; } });
    const p = emptyParts();
    p.material = material;
    p.use = trim(item.use) || 'Commercial';
    p.title = trim(o.title != null ? o.title : item.name);
    p.dims = dims;
    p.dimsLabel = /run\(s\)/i.test(dims) ? 'Runs' : 'Dimensions';
    p.specs = joinPieces(pieces, generated);
    p.notes = list(item.notes);
    p.includes = list(item.includes);
    p.excludes = list(item.excludes);
    p.sep = '; ';
    return p;
  }

  function customParts(item) {
    const c = isObj(item.cfg) ? item.cfg : {};
    const desc = c.desc != null ? c.desc : (item.specEdit != null ? item.specEdit : '');
    const p = genericParts(item, { title: trim(c.name) || trim(item.name), dims: trim(c.dims) || trim(item.dims), desc });
    return p;
  }

  /* the snapshot of a kc product line, built from its product file (what the adapter stores in item.doc; the same words KC.descBlock prints) */
  function deriveKc(item) {
    const D = window.KC && KC.products && KC.products[item.kcKind], c = item.cfg;
    if (!D || !isObj(c) || typeof D.lineParts !== 'function') return null;
    const L = D.lineParts(c) || {};
    const ix = (typeof D.incl === 'function' ? D.incl(c) : null) || { i: [], x: [] };
    let specs;
    if (c.txt && trim(c.txt.specs)) specs = trim(c.txt.specs);
    else {
      specs = typeof D.shortSpecs === 'function' ? htmlToText(D.shortSpecs(c), true) : '';
      const cu = (c.custom || []).map(x => trim(x && x.text).replace(/[.\s]+$/, '')).filter(Boolean).map(t => 'Custom: ' + t + '.').join(' ');
      if (cu) specs += (specs ? ' ' : '') + cu;
    }
    return { material: L.material, use: L.use, title: L.title, sub: L.sub, dims: L.dims, specs,
      notes: typeof D.notes === 'function' ? arr(D.notes(c)) : [], includes: arr(ix.i), excludes: arr(ix.x) };
  }

  function kcParts(item) {
    const d = isObj(item.doc) ? item.doc : deriveKc(item);
    if (!d) return null;
    const p = emptyParts();
    p.material = trim(d.material);
    p.use = trim(d.use);
    p.title = trim(d.title) || trim(item.name);
    p.sub = trim(d.sub);
    p.dims = trim(d.dims) || trim(item.dims);
    p.dimsLabel = 'Dimensions';
    p.specs = htmlToText(d.specs, false).trim() || trim(item.specEdit);
    const notes = list(d.notes), line = trim(item.notes);
    if (line && notes.indexOf(line) < 0) notes.unshift(line);     // the line note first, then the product's forced notes
    p.notes = notes;
    p.includes = list(d.includes);
    p.excludes = list(d.excludes);
    p.sep = ', ';                                                  // the separator KC.descBlock uses
    return p;
  }

  function parts(item) {
    if (!isObj(item)) return emptyParts();
    if (item.kcKind === 'custom') return customParts(item);
    if (item.kcKind) { const p = kcParts(item); if (p) return p; }
    return genericParts(item);
  }

  /* ---------- the D5 block ---------- */
  /* rows of the block as data, so the HTML and the plain-text lines can never drift apart */
  function rowsOf(p, o) {
    const withInc = !(o && o.print === false);
    const out = [];
    const head = [p.material, p.use].filter(Boolean).join(' | ').toUpperCase();
    if (head) out.push({ cls: 'kc-d-mat', text: head });
    if (p.title) out.push({ cls: 'kc-d-title', text: p.title });
    if (p.sub) out.push({ cls: 'kc-d-sub', text: p.sub });
    if (p.dims) out.push({ cls: 'kc-d-row', label: p.dimsLabel || 'Dimensions', text: p.dims });
    if (p.specs) out.push({ cls: 'kc-d-row kc-d-para', label: 'Specs', text: p.specs });
    const notes = arr(p.notes).map(t => ({ text: t }));
    if (withInc && arr(p.includes).length) notes.push({ label: 'Includes', text: p.includes.join(p.sep || ', ') });
    if (withInc && arr(p.excludes).length) notes.push({ label: 'Not included', text: p.excludes.join(p.sep || ', ') });
    if (notes.length) out.push({ cls: 'kc-d-row', label: 'Notes', notes });
    return out;
  }
  function blockHtml(p, o) {
    p = isObj(p) ? p : emptyParts();
    let h = '<div class="kc-d d7-blk">';
    rowsOf(p, o).forEach(r => {
      if (r.notes) h += '<div class="' + r.cls + '"><b>' + esc(r.label) + ':</b> ' + r.notes.map(n => (n.label ? '<b>' + esc(n.label) + ':</b> ' : '') + escBr(n.text)).join(' · ') + '</div>';
      else h += '<div class="' + r.cls + '">' + (r.label ? '<b>' + esc(r.label) + ':</b> ' : '') + escBr(r.text) + '</div>';
    });
    return h + '</div>';
  }
  function lines(p, o) {
    p = isObj(p) ? p : emptyParts();
    return rowsOf(p, o).map(r => r.notes ? r.label + ': ' + r.notes.map(n => (n.label ? n.label + ': ' : '') + n.text).join(' · ') : (r.label ? r.label + ': ' : '') + r.text);
  }

  /* what the description cell shows on screen for a kc line (the preparer sees what prints) */
  function screenBlock(item, idx) {
    if (!isObj(item)) return '';
    return '<div class="d7-screen no-print" data-d7-line="' + (Number(idx) || 0) + '">' + blockHtml(parts(item), { print: true }) + '</div>';
  }
  /* a row's screen block is repainted with its print slot (refreshLineDocParts() repaints only the slot, e.g. after the Details editor changed the includes) */
  function syncScreen(item, idx, html) {
    try {
      if (typeof items === 'undefined' || items[idx] !== item) return;
      const row = document.querySelector('#itemsTbody tr.item-row[data-idx="' + (Number(idx) || 0) + '"]');
      const scr = row && row.querySelector('.d7-screen');
      if (scr && scr.innerHTML !== html) scr.innerHTML = html;
    } catch (e) { /* a render must never break because of this */ }
  }
  function printBlock(item, idx /*, opts */) {
    if (!isObj(item) || item.id === 'MISCFEE') return '';
    const html = blockHtml(parts(item), { print: true });
    if (item.kcKind) syncScreen(item, idx, html);
    return html;
  }

  /* ---------- the Photo column ---------- */
  /* KC:C never an image from just any host.  data: / blob: images, relative paths of this site, an https image from this site's own origin, and an https image from the company's Firebase Storage (where the
     quote photos and the product photos live: firebasestorage.googleapis.com, storage.googleapis.com).  Anything else is refused. */
  const OWN_HOSTS = /^https:\/\/(?:firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//i;
  function safeSrc(u) {
    u = trim(u);
    if (!u) return '';
    if (/^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|svg\+xml)[;,]/i.test(u) || /^blob:/i.test(u)) return u;
    if (OWN_HOSTS.test(u)) return u;
    try { if (/^https:\/\//i.test(u) && typeof location !== 'undefined' && location.origin && u.indexOf(location.origin + '/') === 0) return u; } catch (e) { /* no location */ }
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.slice(0, 2) === '//') return '';
    return u;
  }
  function linkedPhoto(idx) {
    try {
      if (typeof quotePhotos === 'undefined') return '';
      for (let i = 0; i < quotePhotos.length; i++) {
        const p = quotePhotos[i];
        if (p && p.itemIndex === idx) { const s = safeSrc(p.url || p.dataUrl); if (s) return s; }
      }
    } catch (e) { /* no photos */ }
    return '';
  }
  /* the line's drawing.  A small one (a thumbnail) carries no text labels at all (owner Q38); the full one keeps every label. */
  function drawing(item, o) {
    try {
      const k = item && item.kcKind;
      if (!k || k === 'custom') return '';
      const D = window.KC && KC.products && KC.products[k];
      if (!D || typeof D.svg !== 'function' || !isObj(item.cfg)) return '';
      let s = String(D.svg(item.cfg, o || {}) || '');
      /* the kc drawings escape their own labels; this is the second lock before the string goes into the page as markup: no script, no event attribute, no javascript: link */
      s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '').replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '');
      if (o && o.small) s = s.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, '');
      return /^\s*<svg\b/i.test(s) ? s : '';
    } catch (e) { return ''; }
  }
  function photoCell(item, idx) {
    if (!isObj(item)) return '';
    const alt = 'Photo of ' + (trim(item.name) || 'the item');
    const img = src => '<div class="d7-thumb d7-thumb-photo"><img src="' + esc(src) + '" alt="' + esc(alt) + '" decoding="async"></div>';
    let src = linkedPhoto(idx);
    if (src) return img(src);
    const svg = drawing(item, { noTop: true, small: true });
    if (svg) return '<div class="d7-thumb d7-thumb-draw">' + svg + '</div>';
    src = safeSrc(item.photoUrl);
    if (src) return img(src);
    if (item.kcKind === 'custom') return '<div class="d7-thumb d7-nodraw no-print">No drawing</div>';
    return '';
  }

  /* ---------- the Workforce Copy (spec 3.13): the full drawing and the build detail, never a price ---------- */
  /* Q28: a build-detail line that holds a placeholder size ends "(pending Rene's review)": that mark, and any row marked staff only, never reach paper */
  function scrub(t) {
    t = str(t).replace(/\s*\(\s*pending\s+Rene\W{0,3}s\s+review\s*\)/gi, '');
    if (/pending\s+Rene/i.test(t)) t = t.split(/;\s*/).filter(s => !/pending\s+Rene/i.test(s)).join('; ');
    return t.replace(/\s+([.,;])/g, '$1').trim();
  }
  const mm = t => (window.KC && typeof KC.toMM === 'function') ? KC.toMM(String(t)) : String(t);

  function rowsTable(rows) {
    const ok = rows.filter(l => l && +l.q > 0);
    if (!ok.length) return '';
    return '<table class="d7-wf-t"><tbody>' + ok.map(l => '<tr><td class="m">' + esc(l.l || l.k || '') + '</td><td class="n">' + esc(nf2(l.q)) + '</td><td class="u">' + esc(l.u || '') + '</td></tr>').join('') + '</tbody></table>';
  }
  function kcWorkforce(item) {
    const D = window.KC && KC.products && KC.products[item.kcKind];
    if (!D || !isObj(item.cfg)) return '';
    const c = item.cfg;
    let pr = null; try { pr = KC.price(item.kcKind, c); } catch (e) { pr = null; }
    const lns = pr && Array.isArray(pr.lines) ? pr.lines : [];
    let desc = []; try { desc = typeof D.describe === 'function' ? arr(D.describe(c)) : []; } catch (e) { desc = []; }
    const labels = desc.map(r => r[0]), descMap = {};
    desc.forEach(r => { descMap[r[0]] = r[1]; });
    lns.forEach(l => { if (labels.indexOf(l.part) < 0) labels.push(l.part); });
    let body = '';
    labels.forEach(k => {
      const base = str(descMap[k]);
      const own = lns.filter(l => l.part === k);
      const swapped = own.filter(l => l.ek || l.extra != null).map(l => l.l);       // what the preparer changed by hand: it prints
      let text = /staff only/i.test(base) ? '' : base;                               // "Staff only, never printed" rows keep their sentence off paper
      if (swapped.length) text += (text ? '; ' : '') + 'uses ' + swapped.join(', ');
      text = scrub(mm(text));
      const tbl = rowsTable(own);
      if (!text && !tbl) return;
      body += '<div class="d7-wf-part"><div class="d7-wf-pl">' + esc(mm(k)) + '</div>' + (text ? '<div class="d7-wf-pt">' + esc(text) + '</div>' : '') + tbl + '</div>';
    });
    const svg = drawing(item, { noTop: false });
    if (!svg && !body) return '';
    return '<div class="d7-wf">' + (svg ? '<div class="d7-wf-draw">' + svg + '</div>' : '') + (body ? '<div class="d7-wf-h">Build detail</div>' + body : '') + '</div>';
  }
  function customWorkforce(item) {
    const c = isObj(item.cfg) ? item.cfg : {};
    const P = (window.KC && KC.P) || {};
    const rows = arr(c.rows).filter(r => r && P[r.k]).map(r => ({ l: P[r.k].l, q: +r.q || 0, u: P[r.k].u }));
    const tbl = rowsTable(rows);
    return tbl ? '<div class="d7-wf"><div class="d7-wf-h">Build detail</div><div class="d7-wf-part"><div class="d7-wf-pl">Materials</div>' + tbl + '</div></div>' : '';
  }
  function workforceBlock(item /*, idx */) {
    if (!isObj(item) || !item.kcKind) return '';       // a catalogue line prints as today: its D5 block is already in the cell
    try { return item.kcKind === 'custom' ? customWorkforce(item) : kcWorkforce(item); } catch (e) { return ''; }
  }

  /* ---------- "Our standard" (M8) ---------- */
  function standardBullets() {
    if (typeof items === 'undefined' || !window.KC || typeof KC.productList !== 'function') return [];
    const kinds = {};
    items.forEach(i => { if (i && i.kcKind && i.kcKind !== 'custom') kinds[i.kcKind] = 1; });
    const std = [];
    KC.productList().forEach(D => {
      if (!kinds[D.id]) return;
      const s = typeof D.std === 'function' ? trim(D.std()) : trim(D.std);
      if (s && std.indexOf(s) < 0) std.push(s);
    });
    return std.length ? [{ title: 'Standard construction', text: std.join(' ') }] : [];
  }

  /* ---------- the summary strip (E22) ---------- */
  /* QBSpecSheet.summaryStrip says "65% down payment, balance on completion"; the owner wording is "65% downpayment, 35% upon delivery".  Only a plain
     percentage with the balance in one lump is rewritten: milestones, a custom amount, staggered payments and installments keep what the helper printed. */
  function pct(n) { return String(Math.round(n * 100) / 100); }
  function summaryStrip(text, state) {
    const s = isObj(state) ? state : {};
    if (!(parseInt(s.milestones, 10) > 0) && !s.downCustom && s.balanceMode === 'lump') {
      const n = parseFloat(s.downPct);
      if (isFinite(n) && n > 0 && n < 100) {
        const from = pct(n) + '% down payment, balance on completion';
        if (str(text).indexOf(from) >= 0) return str(text).replace(from, pct(n) + '% downpayment, ' + pct(100 - n) + '% upon delivery');
      }
    }
    return '';
  }

  /* ---------- the Use pills ---------- */
  function setUse(idx, use) {
    if (typeof items === 'undefined') return;
    const it = items[idx];
    if (!it || (use !== 'commercial' && use !== 'institutional' && use !== 'residential')) return;
    it.use = use;
    if (isObj(it.doc)) it.doc.use = use.charAt(0).toUpperCase() + use.slice(1);   // a stored snapshot follows (the print block reads it)
  }

  /* =============================================================================================================================================================
     FORMS STANDARD (owner Round 5, 2026-11-19; the live spec 3.7, as changed by Addendum 1 A5 and by the header ruling of that evening).  A KC-mode quotation only: every function that touches the page
     asks d7on() first, so Brilliance Steel and a legacy quote keep the original letterhead, the original buttons and no extra DOM at all.
       Header   top left the horizontal Barro Industries logo on white with the company lines UNDER it; top right QUOTATION, the quote number exactly as it is (its R suffix is the revision: there is no
                separate "Rev." label) and the date; on a Barro Kitchens quote only, the small Barro Kitchens company tile (about 40 px high) sits above QUOTATION.  Barro Industries quotes have no tile.
       Signatures  today's signature row stays (Conforme, Reviewed and Approved by) with its dividers; one box is added to it, Prepared by (the salesperson).  The thank-you and company footer stays as it is.
       Download PDF  writes a FILE named "<quote number>.pdf" through window.FormsPdf (js/forms-pdf.js, the form engine of the Sales flow): downloadPdf() lays the document out on explicit A4 page containers
                (794 x 1123 CSS px, every line item whole on one page, the signatures with the last terms) and hands the container to FormsPdf.download(container, fileName).  Without the engine, or when it
                fails, the print dialog opens instead and a toast says so in plain words.
       Navy #1F3A5F for headings and rules.  Never either of the two other document titles the office uses for receipts and invoices.
     HOOK  header(state)   the HTML that replaces the letterhead block of a KC quote, or '' (the old letterhead then stays).  The page calls it from applyLetterheadHeader() with the same facts it hands the
                           letterhead engine: { docNumber, extraMeta, dateLabel, co }.  As a safety net this file also wraps applyLetterheadHeader() itself and puts the same header in when the page has not (idempotent).
     ============================================================================================================================================================= */
  const FS = Object.freeze({
    logo: 'icons/barro-industries-horizontal.png',     // relative, on white: the horizontal Barro Industries mark (the file of the Sales flow branch)
    tile: 'icons/barro-kitchens.png',                  // the small Barro Kitchens company tile (the page's CO.BK.logo says the same); Barro Kitchens quotes only
    name: 'Barro Industries OPC',
    lines: Object.freeze(['21 Capricorn St., Tandang Sora, Quezon City', '0927 683 6300 · hello@barroindustries.com · barroindustries@gmail.com']),
    title: 'QUOTATION',
    prepared: 'Prepared by',
    preparedRole: 'Sales',
    dl: 'Download PDF',
    dlTitle: 'Download the quotation as an A4 PDF file, named by its quote number. The quote must be filed first.'
  });
  /* the A4 page of the PDF in CSS px (96 dpi): 210 x 297 mm.  The margins are the print margins (10 mm sides, 11 mm top) with a 13 mm foot that holds the running line "<number> - <client>   Page n of N". */
  const A4 = Object.freeze({ w: 794, h: 1123, left: 38, right: 38, top: 42, bottom: 50 });
  const warned = Object.create(null);
  const warn = (name, err) => { if (!warned[name]) { warned[name] = 1; try { console.error('D7 doc: ' + name + ' failed', err); } catch (e) { /* no console */ } } };
  const d7on = () => { try { return typeof d7On === 'function' && !!d7On(); } catch (e) { return false; } };
  const byId = id => document.getElementById(id);
  const val = id => { const e = byId(id); return e && typeof e.value === 'string' ? e.value.trim() : ''; };
  const msg = err => String((err && err.message) || err || 'unknown');

  /* "November 18, 2026" from a date (YYYY-MM-DD or an ISO time); today when it is empty or unreadable */
  function dateLabel(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(trim(iso));
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : new Date();
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  /* the quote number as it prints, characters a file name cannot hold taken out; the PDF is "<that>.pdf".  The R suffix of a revised quote is part of the number, so a revision never overwrites the original. */
  function fileName(no) {
    const n = trim(no != null ? no : val('quoteNo')).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return n || 'Quotation';
  }
  function pdfName(no) { return fileName(no) + '.pdf'; }

  /* ---------- the header: top left the logo with the company lines under it; top right the tile (Barro Kitchens only), QUOTATION, the number as it is, the date ---------- */
  function tileSrc(co) {
    co = co != null && trim(co) ? trim(co) : (typeof currentCo !== 'undefined' ? String(currentCo) : '');
    if (co !== 'BK') return '';                                                  // Barro Industries quotes have no tile
    let src = '';
    try { src = safeSrc(typeof CO !== 'undefined' && CO && CO.BK ? CO.BK.logo : ''); } catch (e) { src = ''; }
    return src || FS.tile;
  }
  function headerHtml(o) {
    o = isObj(o) ? o : {};
    const no = trim(o.no), tags = list(o.tags), tile = tileSrc(o.co);
    return '<div class="d7-lh">'
      + '<div class="d7-lh-id"><img class="d7-lh-logo" src="' + esc(FS.logo) + '" alt="Barro Industries OPC" width="160" height="53" onerror="this.style.display=\'none\'">'
      + '<div class="d7-lh-co"><div class="d7-lh-name">' + esc(FS.name) + '</div>' + FS.lines.map(l => '<div class="d7-lh-line">' + esc(l) + '</div>').join('') + '</div></div>'
      + '<div class="d7-lh-doc">' + (tile ? '<img class="d7-lh-tile" src="' + esc(tile) + '" alt="Barro Kitchens" height="40" onerror="this.style.display=\'none\'">' : '')
      + '<div class="d7-lh-title">' + esc(FS.title) + '</div><div class="d7-lh-no">' + esc(no) + '</div><div class="d7-lh-date">' + esc(dateLabel(o.date)) + '</div>'
      + tags.map(t => '<div class="lh-docmeta">' + esc(t) + '</div>').join('') + '</div>'
      + '</div>';
  }
  /* what the page hands the letterhead engine becomes the header of a KC quote ('' for anything else: the old letterhead stays) */
  function header(state) {
    if (!d7on()) return '';
    const o = isObj(state) ? state : {};
    try { syncSigs(true); ensureDocBar(true); } catch (err) { warn('header.chrome', err); }       // the Prepared by box and the doc bar follow the same render points as the header (print, preview, company switch)
    return headerHtml({ no: o.docNumber != null && trim(o.docNumber) ? o.docNumber : (o.no != null ? o.no : val('quoteNo')), date: val('quoteDate') || trim(o.date), tags: o.extraMeta != null ? o.extraMeta : o.tags, co: o.co });
  }

  /* ---------- the signature row: today's two boxes stay exactly as the page draws them; Prepared by (the salesperson) is added as the first box, in the same look ---------- */
  function prepBoxHtml(name) {
    return '<div class="sig-box d7-sig-prep"><div class="sig-role">' + esc(FS.prepared) + '</div><div style="height:34px;"></div>'
      + '<div class="sig-name">' + esc(name) + '</div><small>' + esc(FS.preparedRole) + '</small></div>';
  }
  function syncSigs(on) {                         // true when the row changed (the Client preview is a clone made before this ran)
    const row = document.querySelector('#termsSection > .sig-row');
    if (!row) return false;
    let box = null;
    for (let i = 0; i < row.children.length; i++) { if (row.children[i].classList.contains('d7-sig-prep')) { box = row.children[i]; break; } }
    if (!on) { if (box) { box.remove(); row.classList.remove('d7-sig3'); return true; } return false; }
    const name = val('salesperson');
    if (box) {
      const nm = box.querySelector('.sig-name');
      if (nm && nm.textContent !== name) { nm.textContent = name; return true; }
      return false;
    }
    const t = document.createElement('template'); t.innerHTML = prepBoxHtml(name);
    row.insertBefore(t.content.firstElementChild, row.firstChild);
    row.classList.add('d7-sig3');
    return true;
  }

  /* ---------- the KC-only chrome: put in the page when the quote is a KC one, taken out when it is not ---------- */
  const ORIG = new WeakMap();     // a relabelled button -> what it said before (restored byte for byte)
  function relabel(btn, on, title) {
    if (!btn) return;
    if (on) {
      if (!ORIG.has(btn)) ORIG.set(btn, { html: btn.innerHTML, title: btn.getAttribute('title') });
      const html = ORIG.get(btn).html.replace(/Save PDF/, FS.dl);       // the icon the button already has stays
      if (btn.innerHTML !== html) btn.innerHTML = html;
      if (title && btn.getAttribute('title') !== title) btn.setAttribute('title', title);
      if (btn.getAttribute('data-d7-dl') !== '1') btn.setAttribute('data-d7-dl', '1');   // the click handler below answers every [data-d7-dl]: the old inline doPrint() never runs
    } else if (ORIG.has(btn)) {
      const o = ORIG.get(btn);
      btn.innerHTML = o.html;
      if (o.title == null) btn.removeAttribute('title'); else btn.setAttribute('title', o.title);
      btn.removeAttribute('data-d7-dl');
      ORIG.delete(btn);
    }
  }
  function dlButton(cls) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn d7-dl ' + cls; b.setAttribute('data-d7-dl', '1'); b.title = FS.dlTitle; b.textContent = FS.dl;
    return b;
  }
  function ensureFormButton(on) {                 // on the quote: next to Preview document in the Client Data bar
    const bar = byId('clientFormBar'), have = bar && bar.querySelector('[data-d7-dl]');
    if (!on) { if (have) { have.remove(); return true; } return false; }
    if (!bar || have) return false;
    const prev = byId('clientPreviewBtn'), b = dlButton('btn-accent btn-sm');
    if (prev) prev.insertAdjacentElement('afterend', b); else bar.insertBefore(b, bar.firstChild);
    return true;
  }
  function docBarName() { return 'PDF file name: ' + pdfName(); }
  function ensureDocBar(on) {                     // on the preview: a bar above the document (the preview itself is rebuilt on every render, so the bar is its sibling)
    let bar = byId('d7DocBar');
    if (!on) { if (bar) { bar.remove(); return true; } return false; }
    if (bar) { const nm = bar.querySelector('.d7-docbar-name'); if (nm && nm.textContent !== docBarName()) nm.textContent = docBarName(); return false; }
    const sheet = byId('qbDocSheet');
    if (!sheet || !sheet.parentNode) return false;
    bar = document.createElement('div'); bar.id = 'd7DocBar'; bar.className = 'd7-docbar no-print';
    const nm = document.createElement('span'); nm.className = 'd7-docbar-name'; nm.textContent = docBarName();
    const hint = document.createElement('span'); hint.className = 'd7-docbar-hint'; hint.textContent = 'A4. The quote must be filed before it can be downloaded.';
    bar.appendChild(dlButton('btn-accent')); bar.appendChild(nm); bar.appendChild(hint);
    sheet.parentNode.insertBefore(bar, sheet);
    return true;
  }
  function mobileRow() { return document.querySelector('#mtbSheet .mtb-row[onclick="mtbRun(\'doPrint\')"]') || document.querySelector('#mtbSheet .mtb-row[data-d7-dl]'); }
  /* opt.refresh: when the Prepared by box changed while the Client preview is drawn, draw it again (it is a clone made before this ran) */
  function syncChrome(opt) {
    const on = d7on();
    let sigs = false;
    try { relabel(byId('btnPrint'), on, FS.dlTitle); relabel(mobileRow(), on, null); } catch (err) { warn('chrome.labels', err); }
    try { ensureFormButton(on); ensureDocBar(on); } catch (err) { warn('chrome.buttons', err); }
    try { sigs = syncSigs(on); } catch (err) { warn('chrome.sigs', err); }
    if (sigs && opt && opt.refresh) {
      try { const sheet = byId('qbDocSheet'); if (sheet && sheet.firstElementChild && typeof renderClientPreview === 'function') renderClientPreview(); } catch (err) { warn('chrome.preview', err); }
    }
    return on;
  }

  /* =============================================================================================================================================================
     THE A4 PAGES.  The document is cloned from the Client preview (renderClientPreview(): the same read-only clone, after the same print-facing renders), cut into UNITS and packed onto explicit
     794 x 1123 px page containers, so the PDF engine gets pages and not one tall block that it would have to slice at an arbitrary height:
       a unit is a thing that is never split: one row of the items table (so a line item is whole on one page; the column headings repeat on every page), one block of the terms, one paragraph block...
       a heading (section title, category row, "Our standard" / annex title) goes with the unit after it; the signature row, the totals and the thank-you footer go with the unit before them, so the signatures
       sit on the page that holds the last of the terms (and the totals never start a page alone);  "Our standard" and the photo annex start a page of their own, as on paper.
     paginate() is the pure packing step (unit tests); the rest reads sizes from the browser, so it is checked in a browser.  The page layout of the pages is d7-doc.css section 9; it is written in the units of
     the print CSS and is not affected by the width of the phone it runs on.
     ============================================================================================================================================================= */
  const KEEP_NEXT = '.sec-title,.std-hdr,.photo-annex-hdr,tr.cat-row,tr.opt-sub-row';     // stays with the unit after it
  const KEEP_PREV = '.sig-row,.print-footer,.totals-box,.summary-strip,.doc-notes';        // stays with the unit before it
  const OWN_PAGE = '.has-std,.has-photos';                                                  // starts a page of its own (the Standard page, the photo annex)
  const px = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

  /* units: [{ h, keep, keepPrev, brk, frames: [{ id, ov }] }] in document order (h = height incl. margins, px).  A frame is a container that is cut across pages (a section, the items table): when the page of a
     unit opens a frame its previous unit did not have open, the frame's own height (padding, rules, the table's heading row: ov) is added.  Returns { pages: [[unit index]], overflow } (overflow = a unit taller than a page). */
  function paginate(units, pageH) {
    const list = Array.isArray(units) ? units : [];
    const H = Number(pageH) > 0 ? Number(pageH) : 1;
    const overhead = (u, p) => {
      const f = Array.isArray(u.frames) ? u.frames : [], pf = p && Array.isArray(p.frames) ? p.frames : [];
      let d = 0, s = 0;
      while (d < f.length && d < pf.length && f[d].id === pf[d].id) d++;
      for (let i = d; i < f.length; i++) s += Number(f[i].ov) || 0;
      return s;
    };
    const costOf = (u, p) => (Number(u.h) || 0) + overhead(u, p);
    const groups = [];
    list.forEach((u, i) => {
      if (groups.length && !u.brk && (list[i - 1].keep || u.keepPrev)) groups[groups.length - 1].push(i); else groups.push([i]);
    });
    const pages = []; let cur = [], used = 0, overflow = false;
    const last = () => (cur.length ? list[cur[cur.length - 1]] : null);
    const push = i => { used += costOf(list[i], last()); cur.push(i); };
    const newPage = () => { if (cur.length) pages.push(cur); cur = []; used = 0; };
    const groupCost = (g, prev) => { let c = 0, p = prev; g.forEach(i => { c += costOf(list[i], p); p = list[i]; }); return c; };
    groups.forEach(g => {
      if (list[g[0]].brk) newPage();
      if (used + groupCost(g, last()) <= H) { g.forEach(push); return; }
      if (cur.length && groupCost(g, null) <= H) { newPage(); g.forEach(push); return; }
      g.forEach(i => {                                         // a group taller than a page: unit by unit
        if (cur.length && used + costOf(list[i], last()) > H) newPage();
        if (costOf(list[i], null) > H) overflow = true;
        push(i);
      });
    });
    newPage();
    return { pages: pages.length ? pages : [[]], overflow };
  }

  /* cut the cloned document into units (browser only) */
  function collectUnits(flow, avail) {
    const units = []; let fid = 0, brkNext = false;
    const hidden = el => getComputedStyle(el).display === 'none';
    const heightOf = el => { const cs = getComputedStyle(el); return el.getBoundingClientRect().height + px(cs.marginTop) + px(cs.marginBottom); };
    const frameOf = (el, isTable) => {
      const cs = getComputedStyle(el), headEl = isTable ? (el.tHead || null) : null;
      const ov = px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth) + px(cs.marginTop) + px(cs.marginBottom)
        + (headEl ? headEl.getBoundingClientRect().height : 0) + (isTable ? 3 : 0);
      return { id: ++fid, el, table: !!isTable, headEl, ov };
    };
    const emit = (el, chain, h) => {
      if (!(h > 0)) return;
      units.push({ el, h, frames: chain.slice(), keep: el.matches(KEEP_NEXT), keepPrev: el.matches(KEEP_PREV), brk: brkNext });
      brkNext = false;
    };
    const cols = el => { const t = getComputedStyle(el).gridTemplateColumns; return t && t !== 'none' ? Math.max(1, t.split(/\s+/).length) : 1; };
    (function walk(parent, chain) {
      Array.prototype.slice.call(parent.children).forEach(el => {
        if (hidden(el)) return;
        if (el.matches(OWN_PAGE)) brkNext = true;
        if (el.tagName === 'TABLE' && el.classList.contains('items-table')) {                   // the items table: a unit per row, the column headings repeat on every page
          const c2 = chain.concat([frameOf(el, true)]);
          Array.prototype.slice.call(el.rows).forEach(tr => { if (tr.parentNode && tr.parentNode.tagName === 'TBODY' && !hidden(tr)) emit(tr, c2, heightOf(tr)); });
          return;
        }
        if (el.matches('.section,.has-std,.has-photos') || el.querySelector(':scope > table.items-table')) { walk(el, chain.concat([frameOf(el, false)])); return; }
        if (el.matches('.terms-grid,.photo-annex-grid') && heightOf(el) > avail) {               // a grid taller than a page: its blocks one by one (a row holds several of them: share the row)
          const n = cols(el), fr = frameOf(el, false);
          Array.prototype.slice.call(el.children).forEach(k => { if (!hidden(k)) emit(k, chain.concat([fr]), heightOf(k) / n); });
          return;
        }
        emit(el, chain, heightOf(el));
      });
    })(flow, []);
    return units;
  }

  /* put the units on page containers: each page is a 794 x 1123 box with its body (the same classes as the flow it was measured in) and a running foot.  A frame that is cut across pages is drawn again on the
     next page as an empty shell of the same element (a table: with its heading row). */
  function materialize(doc, units, pageIdx, run) {
    Array.prototype.slice.call(doc.querySelectorAll('.d7-a4-page')).forEach(p => p.remove());
    const n = pageIdx.length, pages = [];
    pageIdx.forEach((idxs, pi) => {
      const page = document.createElement('div'); page.className = 'd7-a4-page';
      const body = document.createElement('div'); body.className = 'qb-doc-sheet d7-a4-body';
      page.appendChild(body);
      const stack = [];
      idxs.forEach(i => {
        const u = units[i];
        let d = 0;
        while (d < stack.length && d < u.frames.length && stack[d].id === u.frames[d].id) d++;
        stack.length = d;
        for (let k = d; k < u.frames.length; k++) {
          const f = u.frames[k], parent = k ? stack[k - 1].host : body, shell = f.el.cloneNode(false);
          parent.appendChild(shell);
          let host = shell;
          if (f.table) { if (f.headEl) shell.appendChild(f.headEl.cloneNode(true)); host = document.createElement('tbody'); shell.appendChild(host); }
          stack.push({ id: f.id, host });
        }
        (stack.length ? stack[stack.length - 1].host : body).appendChild(u.el);
      });
      const foot = document.createElement('div'); foot.className = 'd7-a4-foot';
      const a = document.createElement('span'); a.className = 'd7-a4-run'; a.textContent = run;
      const b = document.createElement('span'); b.className = 'd7-a4-pg'; b.textContent = 'Page ' + (pi + 1) + ' of ' + n;
      foot.appendChild(a); foot.appendChild(b); page.appendChild(foot);
      doc.appendChild(page); pages.push(page);
    });
    return pages;
  }
  /* how far the tallest page body runs past its box, px (0 or less: every page holds its content) */
  function overflowOf(pages) {
    let worst = -1;
    pages.forEach(p => { const b = p.firstElementChild; if (b) worst = Math.max(worst, b.scrollHeight - b.clientHeight); });
    return worst;
  }
  /* every image of the clone (the logo, the tile, the photos) and the fonts are ready before anything is measured; a slow one is not waited for more than 6 seconds */
  function settle(root) {
    const waits = [];
    Array.prototype.forEach.call(root.querySelectorAll('img'), img => {
      if (!img.complete) waits.push(new Promise(res => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); }));
    });
    const imgs = waits.length ? Promise.race([Promise.all(waits), new Promise(res => setTimeout(res, 6000))]) : Promise.resolve();
    const fonts = document.fonts && document.fonts.ready ? Promise.resolve(document.fonts.ready).catch(() => {}) : Promise.resolve();
    return Promise.all([imgs, fonts]);
  }

  /* the container for the PDF engine: .d7-a4-doc (off screen, laid out) holding one .d7-a4-page per page, abutting, each exactly 794 x 1123 px.  { ok, node, pages, dispose } or { ok: false, error }.
     dispose() takes the container out of the page again (downloadPdf does it when the engine has finished). */
  async function buildA4() {
    const fail = error => ({ ok: false, error });
    if (!d7on() || !document.body) return fail('This quote does not use the new builder.');
    let doc = null;
    const dispose = () => { try { if (doc && doc.parentNode) doc.parentNode.removeChild(doc); } catch (e) { /* gone */ } };
    try {
      if (typeof renderClientPreview === 'function') renderClientPreview();                        // freshens every print-facing render, then clones the sections in print order
      const sheet = byId('qbDocSheet');
      if (!sheet || !sheet.children.length) return fail('There is nothing to print yet.');
      doc = document.createElement('div'); doc.className = 'd7-a4-doc'; doc.setAttribute('aria-hidden', 'true');
      const flow = document.createElement('div'); flow.className = 'qb-doc-sheet d7-a4-body d7-a4-flow';
      Array.prototype.forEach.call(sheet.children, c => flow.appendChild(c.cloneNode(true)));
      Array.prototype.forEach.call(flow.querySelectorAll('img'), i => { i.loading = 'eager'; });   // an image far off screen is not lazy here: the engine needs it now
      doc.appendChild(flow); document.body.appendChild(doc);
      await settle(flow);
      const avail = A4.h - A4.top - A4.bottom, run = [val('quoteNo'), val('clientName')].filter(Boolean).join(' — ');
      const units = collectUnits(flow, avail);
      let shrink = 0, first = true;
      for (let attempt = 0; attempt < 4; attempt++) {                                              // a measure that was a little short is corrected by repacking with a smaller page
        const res = (typeof D7.doc.paginate === 'function' ? D7.doc.paginate : paginate)(units, avail - 2 - shrink);       // through the namespace: a check can hand it a packer that measures wrong, to see the repack
        if (res.overflow) { dispose(); return fail('A line of the quote is taller than a page.'); }
        const pages = materialize(doc, units, res.pages, run);
        if (first) { flow.remove(); first = false; }
        const over = overflowOf(pages);
        if (over <= 0.5) return { ok: true, node: doc, pages: pages.length, dispose };
        shrink += over + 6;
      }
      dispose(); return fail('The pages of the PDF would not fit.');
    } catch (err) { warn('pdf.build', err); dispose(); return fail(msg(err)); }
  }

  /* ---------- Download PDF ---------- */
  /* the gates of the page's doPrint(), in the same order and with the same words where they apply: no priced quote from the offline catalogue; a client copy (never the agent or workforce state); the letterhead
     and the run footer are rebuilt; the quote must be filed.  Returns '' when the PDF may be made, else the reason (a toast has said it). */
  function pdfGate() {
    try {
      if (typeof DB !== 'undefined' && DB && DB.pricesUnavailable) { D7.toast('Prices are unavailable: this is the offline catalogue. Reconnect and reload the database before making a priced quote.', 'error'); return 'offline'; }
      document.body.classList.remove('body-agent'); document.body.classList.remove('body-workforce');
      const tag = byId('phAgentTag'); if (tag) tag.style.display = 'none';
      if (typeof applyLetterheadHeader === 'function') applyLetterheadHeader();
      if (typeof updatePrintRunFooter === 'function') updatePrintRunFooter();
      if (typeof quoteStatus !== 'undefined' && quoteStatus !== 'filed') {
        D7.toast('Please file this quote before downloading the PDF: tap "Verify & File" first.', 'error');
        if (typeof doVerifyAndFile === 'function') doVerifyAndFile();
        return 'unfiled';
      }
    } catch (err) { warn('pdf.gate', err); }
    return '';
  }
  function markBusy(on) {
    try { Array.prototype.forEach.call(document.querySelectorAll('[data-d7-dl]'), b => { b.classList.toggle('d7-dl-busy', !!on); b.setAttribute('aria-busy', on ? 'true' : 'false'); }); } catch (e) { /* no buttons */ }
  }
  function printInstead(why) {
    D7.toast(why + ' The print dialog opens instead: choose "Save as PDF" there.');
    try { window.print(); } catch (err) { warn('pdf.print', err); }
  }
  let pdfBusy = false;
  /* D7.doc.downloadPdf(): the one function behind every Download PDF button.  Resolves { ok, fileName, error? } and never throws. */
  async function downloadPdf() {
    const name = pdfName();
    if (!d7on()) return { ok: false, fileName: name, error: 'This quote does not use the new builder.' };
    if (pdfBusy) return { ok: false, fileName: name, error: 'The PDF is already being made.' };
    if (pdfGate()) return { ok: false, fileName: name, error: 'The quote is not ready to download yet.' };
    pdfBusy = true; markBusy(true);
    let built = null;
    try {
      if (!(window.FormsPdf && typeof window.FormsPdf.download === 'function')) {
        printInstead('The PDF maker is not available here.');
        return { ok: false, fileName: name, error: 'The PDF maker is not available.' };
      }
      D7.toast('Making the PDF. This takes a few seconds.');
      built = await D7.doc.buildA4();
      if (!built || !built.node) { printInstead('The pages of the PDF could not be laid out.'); return { ok: false, fileName: name, error: (built && built.error) || 'The pages could not be laid out.' }; }
      let res = null;
      try { res = await window.FormsPdf.download(built.node, name); } catch (err) { res = { ok: false, error: msg(err) }; }
      if (res && res.ok) { const saved = trim(res.fileName) || name; D7.toast('PDF saved: ' + saved + '.'); return { ok: true, fileName: saved }; }
      printInstead('The PDF file could not be made.');
      return { ok: false, fileName: name, error: trim(res && res.error) || 'The PDF maker did not finish.' };
    } catch (err) {
      warn('pdf', err);
      printInstead('The PDF file could not be made.');
      return { ok: false, fileName: name, error: msg(err) };
    } finally {
      try { if (built && typeof built.dispose === 'function') built.dispose(); } catch (e) { /* gone */ }
      pdfBusy = false; markBusy(false);
    }
  }
  /* one click handler for every Download PDF button (the Client Data bar, the preview bar, the top bar's relabelled Save PDF, the phone menu row): it runs before the button's own inline handler and stops it */
  function onDlClick(e) {
    try {
      const t = e && e.target && e.target.closest ? e.target.closest('[data-d7-dl]') : null;
      if (!t || !d7on()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (typeof closeMobileSheet === 'function' && t.closest && t.closest('#mtbOverlay')) closeMobileSheet();
      Promise.resolve(D7.doc.downloadPdf()).catch(err => warn('download', err));
    } catch (err) { warn('download.click', err); }
  }

  /* ---------- the PDF name in the print dialog.  Every client copy of a KC quote is named by its quote number: window.print is wrapped, so the old Save PDF path, the fallback of Download PDF and the preview all
     agree, whether or not the page's doPrint() calls the doc.print hook.  The title is held until afterprint (or 60 s) and then put back.  Agent and Workforce copies keep their own names. ---------- */
  function wrapPrint() {
    const native = window.print;
    if (typeof native !== 'function' || native.d7wrapped) return;
    const wrapped = function () {
      let prev = null, done = false, timer = 0;
      const restore = () => { if (done) return; done = true; try { window.removeEventListener('afterprint', restore); } catch (e) { /* gone */ } clearTimeout(timer); if (prev != null) document.title = prev; };
      try {
        const cls = document.body && document.body.classList;
        if (d7on() && !(cls && (cls.contains('body-agent') || cls.contains('body-workforce')))) {
          prev = document.title; document.title = fileName();
          window.addEventListener('afterprint', restore); timer = setTimeout(restore, 60000);
        }
      } catch (err) { warn('print.name', err); }
      try { return native.apply(this, arguments); } catch (err) { restore(); throw err; }
    };
    wrapped.d7wrapped = true; wrapped.d7orig = native;
    window.print = wrapped;
  }
  /* the hook the page's doPrint() may call after its own gates (the D7 prototype's doc.print): printing is all it does, the name is the wrapper's */
  function printPdf() { window.print(); return fileName(); }

  /* ---------- the letterhead.  The page builds its print header (and the Client preview clones it) in applyLetterheadHeader(), which asks D7.h('doc.header', ...).  This safety net does the same when
     the page has not: after the page's own function has run, a KC quote's #lhPrintHeader gets the Forms Standard header, unless it already has it. ---------- */
  function wrapLetterheadFallback() {
    const orig = window.applyLetterheadHeader;
    if (typeof orig !== 'function' || orig.d7wrapped) return;
    const wrapped = function () {
      const out = orig.apply(this, arguments);
      try {
        if (d7on()) {
          const box = byId('lhPrintHeader');
          if (box && !(box.querySelector && box.querySelector('.d7-lh'))) {
            const cls = document.body && document.body.classList;
            const tags = cls && cls.contains('body-agent') ? ['AGENT COPY — CONFIDENTIAL'] : (cls && cls.contains('body-workforce') ? ['WORKFORCE COPY — NO PRICES'] : []);
            box.innerHTML = header({ docNumber: val('quoteNo'), extraMeta: tags });
          }
        }
      } catch (err) { warn('letterhead.fallback', err); }
      return out;
    };
    wrapped.d7wrapped = true; wrapped.d7orig = orig;
    window.applyLetterheadHeader = wrapped;
  }
  /* the page calls updatePrintHeader() whenever a field of the header changes (salesperson, client name, quote number, a loaded quote): the Prepared by box and the bar's file name follow */
  function wrapPrintHeader() {
    const orig = window.updatePrintHeader;
    if (typeof orig !== 'function' || orig.d7wrapped) return;
    const wrapped = function () {
      const out = orig.apply(this, arguments);
      try { if (d7on()) { syncSigs(true); ensureDocBar(true); } } catch (err) { warn('printheader', err); }
      return out;
    };
    wrapped.d7wrapped = true; wrapped.d7orig = orig;
    window.updatePrintHeader = wrapped;
  }
  function watch() {
    if (!document.body) return;
    let last = null;
    const check = () => { const on = d7on(); if (on === last) return; last = on; syncChrome({ refresh: true }); };
    if (typeof MutationObserver === 'function') new MutationObserver(check).observe(document.body, { attributes: true, attributeFilter: ['class'] });   // body.d7-on flips with the company and with a legacy quote
    syncChrome(); last = d7on();
  }
  function install() {
    try { wrapPrint(); wrapLetterheadFallback(); wrapPrintHeader(); } catch (err) { warn('install', err); }
    try { document.addEventListener('click', onDlClick, true); } catch (err) { warn('install.click', err); }
    try { watch(); } catch (err) { warn('watch', err); }
  }
  /* the page's own functions exist once its inline script has run, which is before the deferred scripts and before DOMContentLoaded */
  try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install(); } catch (err) { warn('install', err); }

  Object.assign(D7.doc, { parts, blockHtml, lines, printBlock, screenBlock, photoCell, workforceBlock, standardBullets, summaryStrip, setUse, drawing, safeSrc,
    header, headerHtml, fileName, pdfName, print: printPdf, sync: syncChrome, downloadPdf, buildA4, paginate });
})();
