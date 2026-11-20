/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Quote review page (QUOTE-APPROVAL-LINK-SPEC-2026-11-20)
   js/screens/quote-approval.js — the page behind `#/quote-approval/<co>.<docId>`: one quote that was sent for approval, shown whole to the
   person who has to decide on it. Lazy (js/config.js PAGE_SCRIPTS['quote-approval'], with approvals.js, forms-core.js and qb-spec-sheet.js);
   never an app-kit script.

   WHAT IT SHOWS  The header (number, status, client, dates, who sent it, why it needs approval), every line with its photo, code, size, specs, quantity
   and prices, the options table, the totals, the terms, a President-only "Cost and margin" panel, the comment thread, and a sticky action bar
   (Approve / Return / Comment for the President; Send reply / Revise in builder for the person who sent it).

   TWO HALVES
     1. PURE (window.QuoteApproval) — viewModel(q, ctx) turns the stored quote doc into a plain object, html(vm, esc) turns that into markup. They read no
        global except what ctx hands them (FormsCore and QBSpecSheet through ctx.lib), so tests/quote-approval-link.test.mjs runs them against the real
        helper files. Every interpolated string goes through `esc`. COST NEVER LEAVES THE PRESIDENT'S MODEL: viewModel builds `vm.cost` only for
        ctx.role === 'president' and html() prints the cost panel and the per-line cost rows only from it (D4; cost privacy from Sales is a UI rule, as everywhere).
     2. DOM (window.renderQuoteApproval) — reads the quote (and, for the President only, its cost sidecar), the thread and the revision siblings, paints,
        and wires the buttons. The decision itself is window.decideQuoteApproval (js/screens/approvals.js): the one Approve / Return function.
   ═══════════════════════════════════════════════════ */
'use strict';
(function () {

  // ── small total helpers ──────────────────────────────────────────────────────────────────────────────────────────────
  const W = () => (typeof window !== 'undefined' ? window : globalThis);
  const str = (v) => (v == null ? '' : String(v));
  const trim = (v) => str(v).trim();
  const arr = (v) => (Array.isArray(v) ? v : []);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return isFinite(n) ? n : null; };
  const n0 = (v) => { const n = num(v); return n == null ? 0 : n; };
  const defaultEsc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmtN2 = (n) => { const w = W(); return (w && typeof w.fmtN2 === 'function') ? w.fmtN2(n) : Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const money = (n) => '₱' + fmtN2(n);
  const pct1 = (n) => (Math.round(n * 10) / 10).toFixed(1) + '%';

  // ── timestamps: a Firestore Timestamp, {seconds}, a Date, a number or an ISO string -> ms, a Manila date and a relative age ──────────
  function tsMs(t) {
    if (t == null || t === '') return null;
    if (typeof t === 'number') return isFinite(t) ? t : null;
    if (typeof t === 'object') {
      if (typeof t.toMillis === 'function') { try { return t.toMillis(); } catch (_) { return null; } }
      if (typeof t.toDate === 'function') { try { return t.toDate().getTime(); } catch (_) { return null; } }
      if (typeof t.seconds === 'number') return t.seconds * 1000;
    }
    const ms = (Object.prototype.toString.call(t) === '[object Date]' ? t : new Date(t)).getTime();
    return isFinite(ms) ? ms : null;
  }
  function fmtTs(t) {
    const ms = tsMs(t); if (ms == null) return '';
    try { return new Date(ms).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }); } catch (_) { return new Date(ms).toISOString(); }
  }
  function fmtDay(t) {
    const ms = tsMs(t); if (ms == null) return '';
    try { return new Date(ms).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }); } catch (_) { return new Date(ms).toISOString().slice(0, 10); }
  }
  function relTime(t, now) {
    const ms = tsMs(t); if (ms == null) return '';
    const s = Math.floor(((now == null ? Date.now() : now) - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
    return fmtDay(t);
  }

  // ── the quote's own number, as the Quotes list shows it (window.quoteDisplayNo lives in the lazy sales.js: its three-line rule is copied here) ──
  function displayNo(q, id) {
    const co = str((q && q.company) || 'BK');
    const no = str((q && q.quoteNumber) || (id ? String(id).slice(-6).toUpperCase() : ''));
    return no.toUpperCase().startsWith(co.toUpperCase()) ? no : co + '-' + no;
  }
  // the raw number a thread entry carries (js/svc-approvals.js QuoteThread.entry uses the same rule): the revision tag compares against it
  function rawNo(q, id) { return str((q && q.quoteNumber) || (id ? String(id).slice(-6).toUpperCase() : '')); }

  // 'pending' (waiting for the President) | 'approved' | 'returned' | 'other'
  function stateOf(q) {
    const ap = str(q.approvalStatus), st = str(q.status);
    if (ap === 'pending_review' || st === 'pending_approval') return 'pending';
    if (ap === 'approved') return 'approved';
    if (ap === 'needs_revision' || st === 'needs_revision') return 'returned';
    return 'other';
  }
  function badgeOf(q, state) {
    if (state === 'pending') return { label: 'Pending approval', cls: 'badge-orange' };
    if (state === 'approved') return { label: 'Approved', cls: 'badge-green' };
    if (state === 'returned') return { label: 'Returned', cls: 'badge-orange' };
    const st = str(q.approvalStatus || q.status);
    if (st === 'filed') return { label: 'Filed', cls: 'badge-blue' };
    if (st === 'rejected') return { label: 'Rejected', cls: 'badge-red' };
    return { label: st ? st.charAt(0).toUpperCase() + st.slice(1).replace(/_/g, ' ') : 'Not sent for approval', cls: 'badge-gray' };
  }

  // ── photos ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  // A photo URL is data from a Firestore document: only https on the Firebase Storage hosts, or a same-site relative path, reaches an <img src>.
  function safeImg(url) {
    const u = trim(url);
    if (!u) return '';
    if (/^https:\/\//i.test(u)) {
      let host = '';
      try { host = new URL(u).hostname.toLowerCase(); } catch (_) { return ''; }
      return (host === 'firebasestorage.googleapis.com' || /\.firebasestorage\.app$/.test(host) || /\.appspot\.com$/.test(host)) ? u : '';
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.slice(0, 2) === '//' || u.charAt(0) === '\\') return '';
    return /^[^\s"'<>\\]+$/.test(u) ? u : '';
  }
  // the photos linked to one line (quote photo entries carry itemIndex), else its catalogue photo
  function linePhotos(q, i, it) {
    const linked = arr(q.photos).filter((p) => isObj(p) && p.itemIndex === i).map((p) => ({ url: safeImg(p.url), caption: trim(p.caption) })).filter((p) => p.url);
    if (linked.length) return linked;
    const u = safeImg(it && it.photoUrl);
    return u ? [{ url: u, caption: '' }] : [];
  }

  // ── lines ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // a pure section-header row: the builder's "Add section" placeholder (id CUSTOM, unnamed or still "New item", no price, no configurator kind)
  function isHeaderRow(it) {
    return !!it && it.id === 'CUSTOM' && (!trim(it.name) || trim(it.name) === 'New item') && n0(it.amount) === 0 && !it.kcKind;
  }
  function chipsOf(it) {
    const c = [];
    if (it.needsPrice) c.push('No price yet');
    if (it.needsReview && !it.reviewed) c.push('Needs review' + (arr(it.reviewReasons).length ? ': ' + arr(it.reviewReasons).map(str).join(', ') : ''));
    if (typeof it.reviewed === 'string' && it.reviewed) c.push('Reviewed by ' + it.reviewed);
    if (it.priceBasis === 'manual') c.push('Price typed by hand');
    if (n0(it.volumeBreakPct) > 0) c.push('Volume break ' + it.volumeBreakPct + '%');
    return c;
  }
  function lineVm(q, it, i, no, lib) {
    const FC = lib.FormsCore || {}, SS = lib.QBSpecSheet || {};
    const kc = !!(it.kcKind && isObj(it.doc));
    const doc = isObj(it.doc) ? it.doc : {};
    const line = {
      idx: i, no,
      code: typeof FC.itemCode === 'function' ? str(FC.itemCode(it)) : '',
      name: trim(it.name), sub: trim(doc.sub),
      material: trim(doc.material), use: trim(doc.use),
      dims: trim(it.dims),
      specText: '', specRows: [], includes: [], excludes: [],
      notes: trim(it.notes), lead: (() => { const l = trim(it.leadTime); return (l && l !== '—') ? l : ''; })(),
      qty: num(it.qty), unit: trim(it.unit), unitPrice: num(it.unitPrice), amount: num(it.amount),
      chips: chipsOf(it),
      photos: linePhotos(q, i, it), cost: null,
    };
    if (line.amount == null && line.unitPrice != null) line.amount = line.unitPrice * (line.qty == null ? 1 : line.qty);
    if (kc) {
      line.specText = trim(doc.specs);
      const inc = arr(doc.includes), exc = arr(doc.excludes);
      line.includes = (inc.length ? inc : arr(it.includes)).map(trim).filter(Boolean);
      line.excludes = (exc.length ? exc : arr(it.excludes)).map(trim).filter(Boolean);
    } else {
      // the spec sheet of a catalogue / custom line; Size, the ruled lead time and the notes are printed on their own (below), so they are left out of the rows
      const rows = typeof SS.rows === 'function' ? arr(SS.rows(it)) : [];
      line.specRows = rows.filter((r) => r && r.kind !== 'size' && r.kind !== 'lead' && r.kind !== 'note').map((r) => ({ label: str(r.label), value: str(r.value) }));
      if (!line.specRows.length && trim(it.specStr)) line.specText = trim(it.specStr);
    }
    return line;
  }

  // ── cost (President only) ────────────────────────────────────────────────────────────────────────────────────────────
  // a sidecar row belongs to line i when its index and name (the first 120 characters) match; two configurator ids that both exist decide it instead of the name
  function rowFor(sc, it, i) {
    return arr(sc && sc.items).find((r) => {
      if (!isObj(r) || r.i !== i) return false;
      if (isObj(r.kc) && r.kc.kcId && it.kcId) return String(r.kc.kcId) === String(it.kcId);
      return str(r.n) === str(it.name).slice(0, 120);
    }) || null;
  }
  // -> { cost, full, materialsOnly }: a configurator row's project cost; a catalogue row's capital materials + labor; else materials alone (costMat, or the bill of materials)
  function unitCostOf(row) {
    if (!row) return { cost: null, full: false, materialsOnly: false };
    if (isObj(row.kc) && n0(row.kc.projectCost) > 0) return { cost: num(row.kc.projectCost), full: true, materialsOnly: false };
    const cap = n0(row.capitalMaterials) + n0(row.capitalLabor);
    if (cap > 0) return { cost: cap, full: true, materialsOnly: false };
    let mat = num(row.costMat);
    if (mat == null && arr(row.bom).length) mat = arr(row.bom).reduce((s, b) => s + (isObj(b) ? n0(b.qty) * n0(b.unitPrice) : 0), 0);
    if (mat != null && mat > 0) return { cost: mat, full: false, materialsOnly: true };
    return { cost: null, full: false, materialsOnly: false };
  }
  function lineCost(line, row) {
    const u = unitCostOf(row);
    if (u.cost == null) return { none: true, label: 'No cost on file' };
    const price = line.unitPrice == null ? 0 : line.unitPrice;
    const out = { none: false, unitCost: money(u.cost), unitMargin: money(price - u.cost), marginPct: '', label: u.materialsOnly ? 'Materials only (labor not costed)' : '' };
    if (u.full && price > 0) out.marginPct = pct1((price - u.cost) / price * 100);
    return out;
  }
  function costModel(q, sc, lines) {
    if (!isObj(sc)) return { none: true, rows: [] };
    const rows = [];
    const ks = isObj(sc.kcSummary) ? sc.kcSummary : null;
    if (ks) {
      const net = num(ks.net), pc = num(ks.projectCost), std = num(ks.standardTotal);
      if (net != null) rows.push({ label: 'Net selling', value: money(net) });
      if (ks.costKnown === true && pc != null && net != null) {
        rows.push({ label: 'Project cost', value: money(pc) });
        rows.push({ label: 'Margin', value: money(net - pc) + (net > 0 ? ' (' + pct1((net - pc) / net * 100) + ' of net)' : '') });
      } else {
        rows.push({ label: 'Cost is not complete for this quote', value: '', tone: 'note' });
      }
      if (std != null) rows.push({ label: 'Standard total', value: money(std) });
      if (num(ks.markup) != null) rows.push({ label: 'Markup', value: String(ks.markup) });
      if (ks.floorMode === 'list') rows.push({ label: 'Basis', value: 'list prices' });
      else if (ks.floorMode === 'formula') rows.push({ label: 'Basis', value: 'cost × markup' });
      if (net != null && std != null && net < std) rows.push({ label: 'Below standard by ' + money(std - net), value: '', tone: 'bad' });
    } else {
      const priced = lines.filter((l) => l.unitPrice != null && l.unitPrice > 0);
      const costed = priced.filter((l) => l.costFull);
      const known = costed.reduce((s, l) => s + l.costFull * (l.qty == null ? 1 : l.qty), 0);
      const missing = priced.length - costed.length;
      rows.push({ label: missing ? 'Known cost (Partial: ' + costed.length + ' of ' + priced.length + ' lines have a cost)' : 'Total cost', value: money(known) });
      const base = n0(q.netAmount) || n0(q.subtotal);
      if (!missing && priced.length && base > 0) rows.push({ label: 'Margin', value: money(base - known) + ' (' + pct1((base - known) / base * 100) + ' of net)' });
    }
    if (sc.markupOvr != null && (typeof sc.markupOvr === 'number' || typeof sc.markupOvr === 'string') && str(sc.markupOvr)) rows.push({ label: 'Markup set for this quote', value: str(sc.markupOvr) });
    if (isObj(sc.approval) && num(sc.approval.lastApprovedNet) != null) {
      const a = sc.approval;
      rows.push({ label: 'Last approved at net ' + money(a.lastApprovedNet) + (a.approvedAt ? ' on ' + fmtTs(a.approvedAt) : '') + (trim(a.approvedByName) ? ' by ' + trim(a.approvedByName) : ''), value: '' });
    }
    if (n0(q.commissionAmount) > 0 || n0(q.commissionPct) > 0) rows.push({ label: 'Commission', value: (n0(q.commissionPct) > 0 ? q.commissionPct + '% · ' : '') + money(q.commissionAmount) });
    return { none: false, rows };
  }

  // ── why this quote needs approval ──────────────────────────────────────────────────────────────────────────────────
  const WHY_WORDS = { review: 'A line needs review', 'below-standard': 'The quote sells below its standard price', 'approve-all': 'Every quote goes to the President for approval' };
  function whyModel(q, sc, isApprover) {
    const w = isObj(q.approvalWhy) ? q.approvalWhy : null;
    if (w) {
      const bullets = arr(w.reasons).filter((c) => Object.prototype.hasOwnProperty.call(WHY_WORDS, c)).map((c) => WHY_WORDS[c]);
      if (!bullets.length && w.ticked === true) bullets.push('The preparer asked for approval');
      const text = trim(w.text);
      return (bullets.length || text) ? { bullets, text } : null;
    }
    // a quote sent before the reason was stored: only the President, and only what the cost record can tell
    if (!isApprover) return null;
    const bullets = [];
    const ks = isObj(sc && sc.kcSummary) ? sc.kcSummary : null;
    if (ks && num(ks.net) != null && num(ks.standardTotal) != null && ks.net < ks.standardTotal) bullets.push('Below its standard price');
    if (arr(q.items).some((it) => isObj(it) && it.needsReview && !it.reviewed)) bullets.push('A line needs review');
    return bullets.length ? { bullets, text: '' } : null;
  }

  // ── the comment thread ─────────────────────────────────────────────────────────────────────────────────────────────
  const KIND_LABEL = { submitted: 'Sent for approval', returned: 'Returned', approved: 'Approved' };
  // entries: QuoteThread.list rows (oldest first). The President's note on a quote that predates the thread is shown as a synthetic first entry (view-only: never written).
  function threadModel(q, entries, ctx) {
    ctx = isObj(ctx) ? ctx : {};
    if (ctx.commentsOff) return { off: true, items: [], empty: false };
    const id = str(ctx.id), here = rawNo(q, id), now = ctx.now;
    const items = [];
    const list = arr(entries).filter(isObj);
    const note = trim(q.presidentNotes);
    if (note && !list.some((e) => (e.kind === 'returned' || e.kind === 'approved') && str(e.quoteId) === id && trim(e.text) === note)) {
      const st = stateOf(q);
      const at = q.returnedAt || q.approvedAt || null;
      items.push({ who: 'The President', role: 'President', kind: st === 'approved' ? 'Approved' : st === 'returned' ? 'Returned' : '', rev: '', text: note, rel: relTime(at, now), abs: fmtTs(at), synthetic: true });
    }
    list.forEach((e) => {
      items.push({
        who: trim(e.authorName) || (e.authorRole === 'president' ? 'The President' : 'Sales'),
        role: e.authorRole === 'president' ? 'President' : 'Sales',
        kind: KIND_LABEL[e.kind] || '',
        rev: (trim(e.quoteNumber) && trim(e.quoteNumber) !== here) ? trim(e.quoteNumber) : '',
        text: str(e.text), rel: relTime(e.createdAt, now), abs: fmtTs(e.createdAt), synthetic: false,
      });
    });
    return { off: false, items, empty: !items.length };
  }
  function threadHtml(th, esc) {
    const e = typeof esc === 'function' ? esc : defaultEsc;
    if (th.off) return '<div class="qa-thread-note">Comments are not available yet.</div>';
    if (th.empty) return '<div class="qa-thread-note">No comments yet.</div>';
    return th.items.map((t) =>
      '<div class="qa-entry' + (t.role === 'President' ? ' qa-entry-pres' : '') + '">'
      + '<div class="qa-entry-head"><strong class="qa-entry-who">' + e(t.who) + '</strong>'
      + '<span class="qa-chip qa-chip-role">' + e(t.role) + '</span>'
      + (t.kind ? '<span class="qa-chip qa-chip-kind">' + e(t.kind) + '</span>' : '')
      + (t.rev ? '<span class="qa-chip qa-chip-rev">' + e(t.rev) + '</span>' : '')
      + (t.rel ? '<span class="qa-entry-time" title="' + e(t.abs) + '">' + e(t.rel) + '</span>' : '')
      + '</div>'
      + (t.text ? '<div class="qa-entry-text">' + e(t.text) + '</div>' : '')
      + '</div>').join('');
  }

  // ── the view model ─────────────────────────────────────────────────────────────────────────────────────────────────
  // q: the quote doc's data.  ctx: { coll, id, ref, role, uid, sidecar, comments, newer: { ref, number }, parent: { number }, commentsOff, offline, now, companyLabel, lib: { FormsCore, QBSpecSheet } }
  function viewModel(q, ctx) {
    q = isObj(q) ? q : {};
    ctx = isObj(ctx) ? ctx : {};
    const lib = isObj(ctx.lib) ? ctx.lib : {};
    const FC = lib.FormsCore || {};
    const role = str(ctx.role), uid = str(ctx.uid), coll = str(ctx.coll), id = str(ctx.id);
    const isApprover = role === 'president';
    const isSubmitter = !isApprover && !!q.createdBy && q.createdBy === uid;
    const readOnly = !isApprover && !isSubmitter;
    const state = stateOf(q);
    const number = displayNo(q, id);
    const client = trim(q.clientName);
    const sc = (isApprover && isObj(ctx.sidecar)) ? ctx.sidecar : null;

    // banners, in this order
    const banners = [];
    if (ctx.offline) banners.push({ kind: 'offline', text: 'You are offline. Showing the last saved copy.' });
    if (isObj(ctx.newer) && ctx.newer.ref) banners.push({ kind: 'newer', text: 'A newer revision, ' + str(ctx.newer.number) + ', was sent for approval.', ref: str(ctx.newer.ref) });
    if (state === 'approved') {
      const who = arr(ctx.comments).filter((e) => isObj(e) && e.kind === 'approved' && trim(e.authorName)).map((e) => trim(e.authorName)).pop();
      const at = fmtTs(q.approvedAt);
      banners.push({ kind: 'state', text: 'Approved by ' + (who || 'the President') + (at ? ' on ' + at : '') + '.' });
    } else if (state === 'returned') {
      const at = fmtTs(q.returnedAt);
      banners.push({ kind: 'state', text: 'Returned' + (at ? ' on ' + at : '') + '. Waiting for Sales to revise.' });
    } else if (state === 'other') {
      banners.push({ kind: 'state', text: 'This quote is not waiting for approval.' });
    }
    if (readOnly) banners.push({ kind: 'readonly', text: 'Only the President approves quotes.' });

    // lines, grouped by section in document order
    const items = arr(q.items);
    const groups = [];
    const photoSets = {};
    let cur = null, last = null, no = 0;
    const lines = [];
    items.forEach((it, i) => {
      if (!isObj(it)) return;
      const label = typeof FC.sectionLabel === 'function' ? str(FC.sectionLabel(it)) : '';
      if (!cur || label !== last) { cur = { heading: label, lines: [] }; groups.push(cur); last = label; }
      if (isHeaderRow(it)) return;
      no += 1;
      const L = lineVm(q, it, i, no, lib);
      if (L.photos.length) photoSets[String(i)] = L.photos;
      cur.lines.push(L); lines.push({ L, it });
    });
    // President only: the cost of each line, from the sidecar row that belongs to it
    if (isApprover) {
      lines.forEach(({ L, it }) => {
        const row = sc ? rowFor(sc, it, L.idx) : null;
        if (sc) L.cost = lineCost(L, row);
        const u = unitCostOf(row);
        L.costFull = u.full ? u.cost : 0;
      });
    }
    // photos that belong to no line
    const other = arr(q.photos).filter((p) => isObj(p) && !(p.itemIndex != null && isObj(items[p.itemIndex]) && !isHeaderRow(items[p.itemIndex])))
      .map((p) => ({ url: safeImg(p.url), caption: trim(p.caption) })).filter((p) => p.url);
    if (other.length) photoSets.other = other;

    // options
    let options = null;
    if (q.optionsMode && Array.isArray(q.options)) {
      options = { rows: q.options.filter(isObj).map((o) => ({ label: trim(o.label), count: n0(o.itemCount), total: money(o.total), basis: !!o.key && o.key === q.optionsBasis })),
        note: 'The client picks one option. The total below is the marked option.' };
    }

    // totals
    const totals = [];
    totals.push({ label: 'Subtotal', value: money(q.subtotal) });
    const disc = n0(q.discountAmount);
    if (disc > 0) {
      totals.push({ label: 'Discount' + (n0(q.discountPct) > 0 ? ' (' + q.discountPct + '%)' : ''), value: '−' + money(disc) });
      totals.push({ label: 'Net', value: money(q.netAmount) });
    }
    if (n0(q.vatAmount) > 0) totals.push({ label: q.vatIncluded ? 'VAT (included in the total)' : 'VAT', value: money(q.vatAmount) });
    const di = isObj(q.deliveryInstall) ? q.deliveryInstall : null;
    if (di && (n0(di.amount) > 0 || di.free || trim(di.method) || trim(di.notes))) {
      totals.push({ label: 'Delivery and installation', value: di.free ? 'Free' : money(di.amount),
        note: [di.includedInTotal ? 'Included in the total' : '', trim(di.method), trim(di.notes)].filter(Boolean).join(' · ') });
    }
    const grand = money(q.grandTotal || q.total);

    // terms
    const pay = isObj(q.payment) ? q.payment : {};
    const payRows = [];
    if (arr(pay.milestones).length) {
      arr(pay.milestones).filter(isObj).forEach((m) => payRows.push({ label: (n0(m.pct) ? m.pct + '% — ' : '') + trim(m.label) + (trim(m.date) ? ' (' + trim(m.date) + ')' : ''), value: money(m.amount) }));
    } else {
      const modeOf = (m) => { m = trim(m); return m ? ' (' + m + (/^\d+(\.\d+)?$/.test(m) ? '%' : '') + ')' : ''; };
      if (n0(pay.downPayment) > 0) payRows.push({ label: 'Down payment' + modeOf(pay.downPaymentMode), value: money(pay.downPayment) });
      if (n0(pay.balance) > 0) payRows.push({ label: 'Balance' + (trim(pay.balanceMode) ? ' (' + trim(pay.balanceMode) + ')' : ''), value: money(pay.balance) });
      if (n0(pay.interestRate) > 0) payRows.push({ label: 'Interest', value: pay.interestRate + '%' });
    }
    const tl = isObj(q.timeline) ? q.timeline : {};
    const timeline = [];
    if (trim(tl.startDate)) timeline.push({ label: 'Start', value: trim(tl.startDate) });
    if (n0(tl.leadDays) > 0) timeline.push({ label: 'Lead time', value: tl.leadDays + ' days' });
    if (trim(tl.completionDate)) timeline.push({ label: 'Completion', value: trim(tl.completionDate) });
    const plan = isObj(q.editableState) && isObj(q.editableState.pricing) ? q.editableState.pricing.warrantyPlan : '';
    const warranty = plan === 'service6' ? '6-month service warranty' : plan === 'kitchenshield12' ? '6-month service warranty + 12-month PMS with KitchenShield' : '';
    const terms = { payment: payRows, timeline, validUntil: trim(q.validUntil), warranty, remarks: trim(q.remarks) };

    // header
    const sentBy = trim(q.agentName) || trim(q.createdByName) || trim(q.salesperson);
    const chips = [];
    if (q.parentQuoteId && isObj(ctx.parent) && trim(ctx.parent.number)) chips.push('Revision of ' + trim(ctx.parent.number));
    if (q.editedByPresident) chips.push('Edited by the President');
    const badge = badgeOf(q, state);
    const hasDoc = !!q.editableState;
    const header = {
      number, badge, company: trim(ctx.companyLabel) || str(q.company || 'BK'),
      clientName: client, clientCompany: trim(q.clientCompany), location: trim(q.location),
      quoteDate: trim(q.quoteDate), validUntil: trim(q.validUntil), subject: trim(q.subject), purpose: trim(q.purpose),
      sentBy, sentOn: fmtTs(q.reviewRequestedAt), chips,
      viewDoc: readOnly ? null : { enabled: hasDoc, title: hasDoc ? '' : 'This quote was filed before the builder kept an editable copy.' },
      copyLink: isApprover || isSubmitter,
    };

    // what the viewer can do
    const commentsOff = !!ctx.commentsOff;
    const actions = { compose: false, placeholder: '', buttons: [] };
    if (isApprover) {
      actions.placeholder = 'Comment, or what to change before it can be approved';
      if (state === 'pending') { actions.compose = true; actions.buttons.push('approve', 'return'); }
      if (!commentsOff) { actions.compose = true; actions.buttons.push('comment'); }
      if (!actions.buttons.length) actions.compose = false;
    } else if (isSubmitter) {
      actions.placeholder = 'Reply to the President';
      if (!commentsOff) { actions.compose = true; actions.buttons.push('comment'); }
      if (state === 'returned' && hasDoc) actions.buttons.push('revise');
    }
    const commentLabel = isApprover ? 'Comment' : 'Send reply';

    return {
      ref: str(ctx.ref), coll, id, role, isApprover, isSubmitter, readOnly, state, number, client, hasDoc,
      banners, header, why: whyModel(q, sc, isApprover), groups, photoSets, other, options, totals, grand, terms,
      cost: isApprover ? costModel(q, sc, lines.map(({ L }) => L)) : null,
      thread: threadModel(q, ctx.comments, { commentsOff, id, now: ctx.now }),
      actions, commentLabel,
    };
  }

  // ── the markup ─────────────────────────────────────────────────────────────────────────────────────────────────────
  function kv(rows, e) {
    return rows.length ? '<dl class="qa-kv">' + rows.map((r) => '<dt>' + e(r.label) + '</dt><dd>' + e(r.value) + (r.note ? '<div class="qa-note">' + e(r.note) + '</div>' : '') + '</dd>').join('') + '</dl>' : '';
  }
  function thumbHtml(set, key, e) {
    if (!set || !set.length) return '<div class="qa-thumb qa-thumb-empty" aria-hidden="true"><i data-lucide="image"></i></div>';
    return '<button type="button" class="qa-thumb" data-set="' + e(key) + '" data-i="0" aria-label="View photos">'
      + '<img class="qa-img" src="' + e(set[0].url) + '" alt="" loading="lazy" decoding="async">'
      + (set.length > 1 ? '<span class="qa-thumb-more">+' + (set.length - 1) + '</span>' : '') + '</button>';
  }
  function lineHtml(L, set, e) {
    const specs = L.specText ? '<div class="qa-specs qa-preline">' + e(L.specText) + '</div>'
      : (L.specRows.length ? '<dl class="qa-kv qa-kv-spec">' + L.specRows.map((r) => (r.label ? '<dt>' + e(r.label) + '</dt><dd>' : '<dt></dt><dd>') + e(r.value) + '</dd>').join('') + '</dl>' : '');
    const list = (title, xs) => xs.length ? '<div class="qa-incl"><strong>' + e(title) + ':</strong> ' + e(xs.join('; ')) + '</div>' : '';
    const qtyText = (L.qty == null ? '' : L.qty) + (L.unit ? ' ' + L.unit : '');
    return '<article class="qa-line">'
      + thumbHtml(set, String(L.idx), e)
      + '<div class="qa-line-main">'
      + '<div class="qa-line-top"><span class="qa-no">' + e(L.no) + '</span>' + (L.code ? '<span class="qa-code">' + e(L.code) + '</span>' : '') + '</div>'
      + '<div class="qa-name">' + e(L.name || 'Item') + '</div>'
      + (L.sub ? '<div class="qa-sub">' + e(L.sub) + '</div>' : '')
      + ((L.material || L.use) ? '<div class="qa-sub">' + e([L.material, L.use].filter(Boolean).join(' · ')) + '</div>' : '')
      + (L.dims ? '<div class="qa-dims"><span>Size</span> ' + e(L.dims) + '</div>' : '')
      + specs + list('Includes', L.includes) + list('Not included', L.excludes)
      + (L.notes ? '<div class="qa-incl"><strong>Notes:</strong> <span class="qa-preline">' + e(L.notes) + '</span></div>' : '')
      + (L.lead ? '<div class="qa-incl"><strong>Lead time:</strong> ' + e(L.lead) + '</div>' : '')
      + (L.chips.length ? '<div class="qa-chips">' + L.chips.map((c) => '<span class="qa-chip qa-chip-flag">' + e(c) + '</span>').join('') + '</div>' : '')
      + '<div class="qa-calc"><span>' + e(qtyText) + '</span> × <span>' + e(money(L.unitPrice)) + '</span> = <strong>' + e(money(L.amount)) + '</strong></div>'
      + (L.cost ? (L.cost.none ? '<div class="qa-cost-row qa-cost-none">No cost on file</div>'
        : '<div class="qa-cost-row"><span>Unit cost <strong>' + e(L.cost.unitCost) + '</strong></span><span>Unit margin <strong>' + e(L.cost.unitMargin) + '</strong></span>'
          + (L.cost.marginPct ? '<span>Margin <strong>' + e(L.cost.marginPct) + '</strong></span>' : '') + (L.cost.label ? '<span class="qa-note">' + e(L.cost.label) + '</span>' : '') + '</div>') : '')
      + '</div></article>';
  }
  function bannersHtml(bs, e) {
    return bs.map((b) => '<div class="qa-banner qa-banner-' + e(b.kind) + '"><span>' + e(b.text) + '</span>'
      + (b.kind === 'newer' ? '<button type="button" class="btn-secondary btn-sm" id="qa-open-newer" data-ref="' + e(b.ref) + '">Open it</button>' : '') + '</div>').join('');
  }
  function headHtml(vm, e) {
    const h = vm.header;
    const meta = [['Client', h.clientName], ['Company', h.clientCompany], ['Location', h.location], ['Quote date', h.quoteDate], ['Valid until', h.validUntil], ['Subject', h.subject], ['Purpose', h.purpose],
      ['Sent by', h.sentBy], ['Sent on', h.sentOn]].filter((r) => r[1]).map((r) => ({ label: r[0], value: r[1] }));
    return '<section class="qa-card qa-head">'
      + '<div class="qa-head-top"><div class="qa-title">' + e(h.number) + '</div><span class="badge ' + e(h.badge.cls) + '">' + e(h.badge.label) + '</span></div>'
      + '<div class="qa-company">' + e(h.company) + '</div>'
      + (h.chips.length ? '<div class="qa-chips">' + h.chips.map((c) => '<span class="qa-chip">' + e(c) + '</span>').join('') + '</div>' : '')
      + kv(meta, e)
      + ((h.viewDoc || h.copyLink) ? '<div class="qa-head-btns">'
        + (h.viewDoc ? '<button type="button" class="btn-secondary btn-sm" id="qa-view-doc"' + (h.viewDoc.enabled ? '' : ' disabled title="' + e(h.viewDoc.title) + '"') + '>View the quotation document</button>' : '')
        + (h.copyLink ? '<button type="button" class="btn-secondary btn-sm" id="qa-copy-link">Copy approval link</button>' : '') + '</div>' : '')
      + '</section>';
  }
  function actionBarHtml(vm, e) {
    const a = vm.actions;
    if (!a.buttons.length) return '';
    const B = {
      approve: '<button type="button" class="btn-success qa-btn" id="qa-approve">Approve</button>',
      return: '<button type="button" class="btn-primary qa-btn" id="qa-return">Return</button>',
      comment: '<button type="button" class="btn-secondary qa-btn" id="qa-comment">' + e(vm.commentLabel) + '</button>',
      revise: '<button type="button" class="btn-primary qa-btn" id="qa-revise">Revise in builder</button>',
    };
    return '<div class="qa-actionbar">' + a.buttons.map((k) => B[k] || '').join('') + '</div>';
  }
  function composeHtml(vm, e) {
    if (!vm.actions.compose) return '';
    return '<div class="qa-compose"><textarea id="qa-text" rows="3" maxlength="2000" placeholder="' + e(vm.actions.placeholder) + '"></textarea>'
      + '<div class="qa-compose-meta"><span id="qa-err" class="qa-err" role="alert"></span><span id="qa-count" class="qa-count">0/2000</span></div></div>';
  }
  function html(vm, esc) {
    const e = typeof esc === 'function' ? esc : defaultEsc;
    const out = ['<div class="qa-page">'];
    out.push(bannersHtml(vm.banners, e));
    out.push(headHtml(vm, e));
    if (vm.why) {
      out.push('<section class="qa-card qa-why"><h4 class="qa-h">Why this needs approval</h4>'
        + (vm.why.bullets.length ? '<ul>' + vm.why.bullets.map((b) => '<li>' + e(b) + '</li>').join('') + '</ul>' : '')
        + (vm.why.text ? '<p class="qa-why-text">' + e(vm.why.text) + '</p>' : '') + '</section>');
    }
    out.push('<section class="qa-lines">');
    vm.groups.forEach((g) => {
      if (!g.heading && !g.lines.length) return;
      out.push('<div class="qa-group">' + (g.heading ? '<h4 class="qa-group-title">' + e(g.heading) + '</h4>' : '') + g.lines.map((L) => lineHtml(L, vm.photoSets[String(L.idx)], e)).join('') + '</div>');
    });
    if (!vm.groups.some((g) => g.lines.length)) out.push('<div class="qa-thread-note">This quote has no lines.</div>');
    out.push('</section>');
    if (vm.other.length) {
      out.push('<section class="qa-card"><h4 class="qa-h">Other photos</h4><div class="qa-other">'
        + vm.other.map((p, i) => '<figure class="qa-fig"><button type="button" class="qa-thumb" data-set="other" data-i="' + i + '" aria-label="View photo"><img class="qa-img" src="' + e(p.url) + '" alt="" loading="lazy" decoding="async"></button>'
          + (p.caption ? '<figcaption>' + e(p.caption) + '</figcaption>' : '') + '</figure>').join('') + '</div></section>');
    }
    if (vm.options) {
      out.push('<section class="qa-card"><h4 class="qa-h">Options</h4><table class="qa-opts"><thead><tr><th>Option</th><th>Items</th><th>Total</th></tr></thead><tbody>'
        + vm.options.rows.map((r) => '<tr' + (r.basis ? ' class="qa-opt-basis"' : '') + '><td>' + e(r.label) + (r.basis ? ' <span class="qa-chip">Basis of the total</span>' : '') + '</td><td>' + e(r.count) + '</td><td>' + e(r.total) + '</td></tr>').join('')
        + '</tbody></table><div class="qa-note">' + e(vm.options.note) + '</div></section>');
    }
    out.push('<section class="qa-card qa-totals"><h4 class="qa-h">Totals</h4>' + kv(vm.totals, e)
      + '<div class="qa-grand"><span>Grand total</span><strong>' + e(vm.grand) + '</strong></div></section>');
    const t = vm.terms;
    out.push('<section class="qa-card qa-terms"><h4 class="qa-h">Terms</h4>'
      + (t.payment.length ? '<div class="qa-sub-h">Payment</div>' + kv(t.payment, e) : '')
      + (t.timeline.length ? '<div class="qa-sub-h">Timeline</div>' + kv(t.timeline, e) : '')
      + kv([t.validUntil && { label: 'Valid until', value: t.validUntil }, t.warranty && { label: 'Warranty', value: t.warranty }].filter(Boolean), e)
      + (t.remarks ? '<div class="qa-sub-h">Remarks</div><div class="qa-preline">' + e(t.remarks) + '</div>' : '')
      + (!(t.payment.length || t.timeline.length || t.validUntil || t.warranty || t.remarks) ? '<div class="qa-thread-note">No terms were stored with this quote.</div>' : '')
      + '</section>');
    if (vm.cost) {
      out.push('<section class="qa-card qa-cost"><h4 class="qa-h">Cost and margin</h4>'
        + (vm.cost.none ? '<div class="qa-thread-note">No cost record was saved with this quote.</div>'
          : '<dl class="qa-kv">' + vm.cost.rows.map((r) => '<dt class="' + (r.tone ? 'qa-' + e(r.tone) : '') + '">' + e(r.label) + '</dt><dd>' + e(r.value) + '</dd>').join('') + '</dl>')
        + '</section>');
    }
    out.push('<section class="qa-card qa-thread" id="qa-thread"><h4 class="qa-h">Comments</h4><div id="qa-thread-list">' + threadHtml(vm.thread, e) + '</div>' + composeHtml(vm, e) + '</section>');
    out.push(actionBarHtml(vm, e));
    out.push('</div>');
    return out.join('');
  }

  const QA = { viewModel, html, safeImg, thread: threadModel, threadHtml, _tsMs: tsMs };
  W().QuoteApproval = QA;

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  The DOM half: reads, paints, wires. (Nothing below runs at load time.)
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const ESC = (s) => (typeof window.escHtml === 'function' ? window.escHtml(s) : defaultEsc(s));
  const online = () => !(typeof navigator !== 'undefined' && navigator.onLine === false);
  let _cur = null;            // what is on screen: { ref, coll, id, q, vm, commentsOff }
  let _visBound = false;      // the visibilitychange listener is added once

  function emptyState(c, title, hint, action, onAction) {
    c.innerHTML = window.renderEmptyState({ icon: '🔗', title, hint, action: action ? { id: 'qa-empty-btn', label: action } : undefined });
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    const b = c.querySelector('#qa-empty-btn');
    if (b && onAction) b.addEventListener('click', onAction);
  }
  const who = () => ((typeof userProfile !== 'undefined' && userProfile && userProfile.displayName) || currentUser.email || '');

  async function readComments(coll, q, id) {
    try { return { entries: await window.QuoteThread.list(coll, q, id), off: false }; }
    catch (err) {
      if (err && err.code === 'permission-denied') return { entries: [], off: true };
      console.warn('[quote-approval] the thread could not be read', err);
      return { entries: [], off: false };
    }
  }

  // only the thread section: after a comment, and when the tab comes back to the front
  async function refreshThread(S) {
    if (!S || S.commentsOff || window.currentPage !== 'quote-approval') return;
    const r = await readComments(S.coll, S.q, S.id);
    if (!_cur || _cur.id !== S.id || window.currentPage !== 'quote-approval') return;
    const box = document.getElementById('qa-thread-list');
    if (!box) return;
    S.commentsOff = r.off; S.comments = r.entries;
    box.innerHTML = QA.threadHtml(QA.thread(S.q, r.entries, { commentsOff: r.off, id: S.id }), ESC);
  }

  window.renderQuoteApproval = async function (ref) {
    const c = document.getElementById('page-content');
    if (!c) return;
    const tok = window.navToken();
    c.innerHTML = window.skeletonHtml('rows', 6);
    const r = window.parseQuoteApprovalRef(ref);
    if (!r) { emptyState(c, 'This approval link is not valid.', '', 'Go to Approvals', () => navigateTo('approvals')); return; }

    let snap;
    try { snap = await db.collection(r.coll).doc(r.id).get(); }
    catch (err) {
      if (window.navStale(tok)) return;
      if (err && err.code === 'permission-denied') {
        emptyState(c, 'You do not have access to this quote.', 'Ask the person who made it, or the President.', 'Go to dashboard', () => navigateTo('dashboard'));
      } else {
        console.error('[quote-approval] the quote could not be read', r.coll, r.id, err);
        emptyState(c, 'This quote could not be loaded.', 'Check your connection and try again.', 'Retry', () => window.renderQuoteApproval(ref));
      }
      return;
    }
    if (window.navStale(tok)) return;
    if (!snap || !snap.exists) { emptyState(c, 'This quote no longer exists.', 'It may have been deleted.', 'Go to Approvals', () => navigateTo('approvals')); return; }
    const q = snap.data() || {};

    // The cost sidecar is read for the approver only; the thread and the revision siblings each fail on their own, never the page.
    const isApprover = currentRole === 'president';
    const staff = ['president', 'manager', 'secretary'].indexOf(currentRole) >= 0;
    const root = q.rootQuoteId || r.id;
    let sidecar = null;
    const loads = [];
    if (isApprover) {
      loads.push(db.collection('quote_costs').doc(r.coll + '_' + r.id).get().then((s) => { sidecar = s.exists ? (s.data() || null) : null; }).catch((err) => console.warn('[quote-approval] no cost record', err)));
    }
    let thread = { entries: [], off: false };
    loads.push(readComments(r.coll, q, r.id).then((x) => { thread = x; }));
    let sibs = [];
    loads.push((async () => {
      try {
        let sq = db.collection(r.coll).where('rootQuoteId', '==', root);
        if (!staff) sq = sq.where('createdBy', '==', currentUser.uid);
        const ss = await sq.get();
        sibs = ss.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => (s.status || '') !== 'draft' && String(s.id).indexOf('draft_') !== 0);
      } catch (err) { console.warn('[quote-approval] revisions could not be listed', err); }
    })());
    await Promise.all(loads);
    if (window.navStale(tok)) return;

    // a newer revision: the latest sibling that is not this doc and was created after it
    const mine = QA._tsMs(q.createdAt);
    const later = sibs.filter((s) => s.id !== r.id && QA._tsMs(s.createdAt) != null && mine != null && QA._tsMs(s.createdAt) > mine)
      .sort((a, b) => QA._tsMs(b.createdAt) - QA._tsMs(a.createdAt))[0];
    const newer = later ? { ref: window.quoteApprovalRefOf(r.coll, later.id), number: later.quoteNumber || later.id } : null;
    const parentDoc = q.parentQuoteId ? sibs.find((s) => s.id === q.parentQuoteId) : null;

    const ctx = {
      coll: r.coll, id: r.id, ref, role: currentRole, uid: currentUser.uid, sidecar, comments: thread.entries, commentsOff: thread.off,
      newer, parent: parentDoc ? { number: parentDoc.quoteNumber || '' } : null, offline: !online(),
      companyLabel: window.quoteCompanyLabel ? window.quoteCompanyLabel(q.company || 'BK') : '',
      lib: { FormsCore: window.FormsCore, QBSpecSheet: window.QBSpecSheet },
    };
    const vm = QA.viewModel(q, ctx);
    c.innerHTML = QA.html(vm, ESC);
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    _cur = { ref, coll: r.coll, id: r.id, q, vm, commentsOff: thread.off, comments: thread.entries };
    wire(c, _cur);
    if (!_visBound) {
      _visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && window.currentPage === 'quote-approval' && _cur) refreshThread(_cur);
      });
    }
  };

  // ── the photo viewer: one Overlay entry (Back and Escape close it, as in the chat's), previous / next, caption and count ───────────
  function openLightbox(photos, start) {
    if (!photos || !photos.length) return;
    let idx = Math.max(0, Math.min(start || 0, photos.length - 1));
    const el = document.createElement('div');
    el.className = 'qa-lightbox';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Photo viewer');
    el.innerHTML = '<div class="qa-lightbox-top"><button type="button" class="qa-lightbox-close" aria-label="Close">✕</button><div class="qa-lightbox-count"></div></div>'
      + '<div class="qa-lightbox-stage"><img class="qa-lightbox-img" alt=""/>'
      + '<button type="button" class="qa-lightbox-nav qa-lightbox-prev" aria-label="Previous photo">‹</button>'
      + '<button type="button" class="qa-lightbox-nav qa-lightbox-next" aria-label="Next photo">›</button></div>'
      + '<div class="qa-lightbox-cap"></div>';
    document.body.appendChild(el);
    const img = el.querySelector('.qa-lightbox-img'), count = el.querySelector('.qa-lightbox-count'), cap = el.querySelector('.qa-lightbox-cap');
    const prev = el.querySelector('.qa-lightbox-prev'), next = el.querySelector('.qa-lightbox-next');
    const multi = photos.length > 1;
    if (!multi) el.classList.add('qa-lightbox-single');
    const show = () => { img.src = photos[idx].url; count.textContent = multi ? (idx + 1) + ' / ' + photos.length : ''; cap.textContent = photos[idx].caption || ''; };
    const go = (d) => { idx = (idx + d + photos.length) % photos.length; show(); };
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    el.querySelector('.qa-lightbox-close').addEventListener('click', () => window.Overlay.dismissTop());
    el.addEventListener('click', (ev) => { if (ev.target === el || ev.target.classList.contains('qa-lightbox-stage')) window.Overlay.dismissTop(); });
    const onKey = (ev) => { if (ev.key === 'ArrowLeft' && multi) go(-1); else if (ev.key === 'ArrowRight' && multi) go(1); };   // Escape belongs to the Overlay stack
    document.addEventListener('keydown', onKey);
    window.Overlay.push('lightbox', () => { document.removeEventListener('keydown', onKey); el.remove(); }, el);
    show();
  }

  // ── wiring ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  function wire(c, S) {
    const $ = (sel) => c.querySelector(sel);
    // a picture that cannot load (expired link, blocked host) falls back to the placeholder
    const swap = (img) => {
      const holder = img.closest('.qa-thumb');
      const ph = document.createElement('i');
      ph.setAttribute('data-lucide', 'image');
      img.replaceWith(ph);
      if (holder) holder.classList.add('qa-thumb-broken');
      if (window.lucide) lucide.createIcons({ nodes: [holder || c] });
    };
    c.querySelectorAll('img.qa-img').forEach((img) => { img.addEventListener('error', () => swap(img)); if (img.complete && img.src && img.naturalWidth === 0) swap(img); });
    c.querySelectorAll('.qa-thumb[data-set]').forEach((b) => b.addEventListener('click', () => openLightbox(S.vm.photoSets[b.dataset.set] || [], Number(b.dataset.i) || 0)));
    $('#qa-open-newer')?.addEventListener('click', (ev) => navigateTo('quote-approval', { subtab: ev.currentTarget.dataset.ref }));
    $('#qa-copy-link')?.addEventListener('click', () => window.showQuoteApprovalLink({ coll: S.coll, id: S.id, quoteNumber: S.q.fileName || S.q.quoteNumber, clientName: S.q.clientName }));
    $('#qa-view-doc')?.addEventListener('click', () => {
      if (!S.q.editableState) return;
      // the President on a quote that waits for him opens the builder in REVIEW mode (its bar: Save edits & Approve / Return); everyone else opens a plain copy
      if (S.vm.isApprover && S.vm.state === 'pending' && typeof window.openQuoteInBuilderReview === 'function') window.openQuoteInBuilderReview(S.coll, S.id, S.q);
      else window.reopenQuoteFromDoc(S.coll, S.id, window.quoteBuilderPageFor(S.q.company));
    });
    const ta = $('#qa-text'), err = $('#qa-err'), cnt = $('#qa-count');
    const showErr = (m) => { if (err) err.textContent = m; if (ta) ta.focus(); };
    if (ta) ta.addEventListener('input', () => { if (cnt) cnt.textContent = ta.value.length + '/2000'; if (err) err.textContent = ''; });
    const text = () => (ta ? ta.value.trim() : '');
    const offline = () => { if (online()) return false; Notifs.showToast('You are offline. Connect to approve or return a quote.', 'error'); return true; };
    const afterDecision = (res) => { if (res && (res.ok || res.reason === 'state')) { if (ta) ta.value = ''; window.renderQuoteApproval(S.ref); } };
    const common = { coll: S.coll, quoteId: S.id, agentId: S.q.createdBy, quoteNumber: S.q.quoteNumber, clientName: S.q.clientName };

    // (the buttons are read once: an event's currentTarget is gone after the first await)
    const approveBtn = $('#qa-approve'), returnBtn = $('#qa-return'), commentBtn = $('#qa-comment');
    approveBtn?.addEventListener('click', async () => {
      if (offline()) return;
      const ok = await window.confirmDialog({ message: 'Approve ' + S.vm.number + ' for ' + (S.vm.client || 'the client') + '? It will be filed and Sales will be told.' });
      if (!ok) return;
      afterDecision(await window.busy(approveBtn, () => window.decideQuoteApproval({ ...common, action: 'approve', notes: text() })));
    });
    returnBtn?.addEventListener('click', async () => {
      if (!text()) { showErr('Write what to change before you return it.'); return; }
      if (offline()) return;
      afterDecision(await window.busy(returnBtn, () => window.decideQuoteApproval({ ...common, action: 'return', notes: text() })));
    });
    commentBtn?.addEventListener('click', async () => {
      if (!text()) { showErr('Write a comment first.'); return; }
      if (offline()) return;
      const body = text();
      const isPres = S.vm.isApprover;
      const res = await window.busy(commentBtn, () => window.QuoteThread.add({ coll: S.coll, quoteId: S.id, q: S.q, kind: 'comment', text: body, uid: currentUser.uid, name: who(), role: currentRole }));
      if (!res || !res.ok) { Notifs.showToast('The comment was not saved. Try again.', 'error'); return; }
      notifyComment(S, body, res.id, isPres);
      if (ta) { ta.value = ''; if (cnt) cnt.textContent = '0/2000'; }
      refreshThread(S);
    });
    $('#qa-revise')?.addEventListener('click', () => window.reopenQuoteFromDoc(S.coll, S.id, window.quoteBuilderPageFor(S.q.company)));
  }

  // The other side hears about a comment (best-effort: the comment stays saved if this fails). The President's comment goes to the person who sent the quote; the sender's reply goes to the President.
  async function notifyComment(S, body, commentId, byPresident) {
    const ref = window.quoteApprovalRefOf(S.coll, S.id);
    const link = ref ? 'quote-approval/' + ref : 'approvals';
    const no = S.vm.number, client = S.vm.client || 'the client';
    try {
      if (byPresident) {
        if (S.q.createdBy && S.q.createdBy !== currentUser.uid) {
          await Notifs.send(S.q.createdBy, { title: '💬 The President commented on your quote', body: ('"' + no + '" for ' + client + ': ' + body.slice(0, 300)), icon: '💬', type: 'quote_comment', link });
        }
      } else {
        await Notifs.sendToOwner({ title: '💬 Reply on a quote awaiting your approval', body: (who() + ' on "' + no + '": ' + body.slice(0, 300)), icon: '💬', type: 'quote_comment', link, dedupKey: 'quote_comment|' + commentId });
      }
    } catch (err) { console.warn('[quote-approval] the comment notification was not sent', err); }
  }
})();
