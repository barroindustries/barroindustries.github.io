/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Quote review page (QUOTE-APPROVAL-LINK-SPEC-2026-11-20)
   js/screens/quote-approval.js — the page behind `#/quote-approval/<co>.<docId>`: one quote that was sent for approval, shown whole to the
   person who has to decide on it. Lazy (js/config.js PAGE_SCRIPTS['quote-approval'], with approvals.js, forms-core.js and qb-spec-sheet.js);
   never an app-kit script.

   WHAT IT SHOWS  The header (number, status, client, dates, who sent it, why it needs approval), every line with its photo, code, size, specs, quantity
   and prices, the options table, the totals, the terms, a President-only "Cost and margin" panel, the comment thread, and a sticky action bar
   (Approve / Return / Comment for the President; Send reply / Revise in builder for the person who sent it).

   THE PRESIDENT'S FIGURES (QUOTE-PRESIDENT-FIGURES-SPEC-2026-11-20)  Beside each line's price the President may type his own unit price and a note. The totals at his prices are NOT worked out here: the page
   hosts the quote builder in a hidden frame (the engine, spec 2.1), proves it reproduced the stored quote (P1) and landed exactly the figures asked for (P2), and shows what it answers. Approve at my figures
   stores the builder's own totals; Return with my figures stores his prices and notes for Sales to apply. window.QuoteFigures (js/quote-figures-core.js) holds the pure rules and the three proofs.

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
  // a pure section-header row: the builder's "Add section" placeholder. The rule lives in js/quote-figures-core.js (spec 12: it moved there; the page calls it there).
  const QF = () => W().QuoteFigures;
  function isHeaderRow(it) { const f = QF(); return !!(f && f.isHeaderRow(it)); }
  const isPresPrice = (it) => isObj(it.priceBy) && it.priceBy.role === 'president';
  function chipsOf(it) {
    const c = [];
    if (it.needsPrice) c.push('No price yet');
    if (it.needsReview && !it.reviewed) c.push('Needs review' + (arr(it.reviewReasons).length ? ': ' + arr(it.reviewReasons).map(str).join(', ') : ''));
    if (typeof it.reviewed === 'string' && it.reviewed) c.push('Reviewed by ' + it.reviewed);
    if (it.priceBasis === 'manual' && !isPresPrice(it)) c.push('Price typed by hand');
    if (n0(it.volumeBreakPct) > 0) c.push('Volume break ' + it.volumeBreakPct + '%');
    return c;
  }
  // what the President set on THIS doc for this line (presidentFigures.lines, matched by index and name): shown to him and to the person who sent the quote
  function presFor(q, i, it) {
    const pf = isObj(q.presidentFigures) ? q.presidentFigures : null;
    if (!pf) return null;
    const r = arr(pf.lines).find((x) => isObj(x) && x.i === i && str(x.name) === str(it.name).slice(0, 120));
    return r ? { to: num(r.to), from: num(r.from), note: trim(r.note), byName: trim(pf.byName), when: fmtTs(pf.at) } : null;
  }
  // a line that is already at his price (the builder stamped priceBy): a chip, with who and the price it replaced in the tooltip
  function byPresOf(it) {
    if (!isPresPrice(it)) return null;
    const p = it.priceBy;
    return p.held ? { label: 'Price held', title: 'Held at the price Sales set, because another line changed.' }
      : { label: "President's price", title: "Sales' price was " + money(p.salesPrice) + (trim(p.name) ? '. Set by ' + trim(p.name) : '') + (p.at ? ' on ' + fmtDay(p.at) : '') + '.' };
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
      pres: presFor(q, i, it), byPres: byPresOf(it), fig: null,
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
  const KIND_LABEL = { submitted: 'Sent for approval', returned: 'Returned', approved: 'Approved', figures: 'Prices and notes', applied: "Applied the President's prices" };
  // entries: QuoteThread.list rows (oldest first). The President's note on a quote that predates the thread is shown as a synthetic first entry (view-only: never written).
  function threadModel(q, entries, ctx) {
    ctx = isObj(ctx) ? ctx : {};
    if (ctx.commentsOff) return { off: true, items: [], empty: false };
    const id = str(ctx.id), here = rawNo(q, id), now = ctx.now, lineNo = isObj(ctx.lineNo) ? ctx.lineNo : {};
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
        // the per-line rows of his entry (prices and notes). `no` is the printed number of that line on THIS doc, only when the entry belongs to this doc (a revision's lines may have moved)
        rows: arr(e.lines).filter(isObj).map((r) => ({ no: str(e.quoteId) === id && lineNo[r.i] != null ? str(lineNo[r.i]) : '', name: trim(r.name), from: num(r.from), to: num(r.to), note: trim(r.note) })),
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
      + (t.rows && t.rows.length ? '<ul class="qa-entry-rows">' + t.rows.map((r) => '<li>' + (r.no ? '<span class="qa-row-no">' + e(r.no) + '</span> · ' : '') + '<strong>' + e(r.name || 'Item') + '</strong>'
        + (r.to != null ? ': ' + e(money(r.from)) + ' to ' + e(money(r.to)) : '') + (r.note ? '<div class="qa-row-note">' + e(r.note) + '</div>' : '') + '</li>').join('') + '</ul>' : '')
      + '</div>').join('');
  }

  // ── the President's figures: the pure model (spec 6.1) ────────────────────────────────────────────────────────────────
  const NO_ENGINE_SENTENCE = 'Totals at your figures cannot be worked out for this quote here.';
  const WARN_TEXT = { 'below-cost': { text: 'Below cost', cls: 'qa-fig-below' }, 'big-cut': { text: "That is less than half of Sales' price.", cls: 'qa-fig-warn' }, 'big-raise': { text: "That is more than double Sales' price.", cls: 'qa-fig-warn' } };
  // the key a result is filed under: the valid figures it was worked out for (the page compares it with the current ones; a result for other figures is stale)
  function figKey(rows) { return JSON.stringify(arr(rows).filter((r) => isObj(r) && r.to != null).map((r) => [r.i, r.to])); }
  // inputs: { [lineIndex]: { price: <text>, note: <text> } }; engine: { phase: 'none' | 'loading' | 'ready' | 'unavailable', reason, result: { key, payload, costSidecar, held } | null }.
  // -> { rows, prices, notes, anyError, belowCost, state, reason, summary, options, held, noFig }; also sets L.fig on every line of `lines` and updates the margin of a line he priced.
  function figuresModel(q, lines, inputs, engine, sc, hasDoc) {
    const F = QF();
    const parsed = {};
    let anyError = false, candidates = 0;
    lines.forEach(({ L, it }) => {
      const raw = isObj(inputs[L.idx]) ? inputs[L.idx] : {};
      const can = F.eligible(it);
      const fig = { can, value: str(raw.price), note: str(raw.note), error: '', warns: [], amount: '', to: null, over: false };
      let to = null;
      const text = str(raw.price).trim();
      if (can && text) {
        const p = F.parse(text);
        const v = F.validate(p, it, L.costFull > 0 ? L.costFull : null);
        if (!v.ok) { fig.error = v.error; anyError = true; }
        else if (!v.same && !v.empty) { to = p; fig.warns = arr(v.warn).slice(); }
      }
      const note = trim(raw.note);
      if (to !== null || note) {
        candidates += 1;
        if (candidates > F.MAX_ROWS) { fig.error = 'Too many lines for one decision. Return it with a note.'; fig.over = true; anyError = true; to = null; }
        else parsed[L.idx] = { to, note: str(raw.note) };
      }
      fig.to = to;
      if (to !== null) {
        const qty = L.qty == null ? 1 : L.qty;
        fig.amount = qty + ' × ' + money(to) + ' = ' + money(to * qty);
        if (L.cost && !L.cost.none) L.cost = lineCost(Object.assign({}, L, { unitPrice: to }), sc ? rowFor(sc, it, L.idx) : null);   // his price, the same one subtraction
      }
      L.fig = fig;
    });
    const rows = F.rows(q, parsed);
    const c = F.counts(rows);
    const belowCost = lines.filter(({ L }) => L.fig && L.fig.to !== null && L.fig.warns.indexOf('below-cost') >= 0).length;
    const noFig = c.prices === 0;
    let state = 'idle', reason = '', summary = null, options = null, held = 0;
    if (!noFig) {
      if (!hasDoc) { state = 'unavailable'; reason = 'no-snapshot'; }
      else if (engine.phase === 'unavailable') { state = 'unavailable'; reason = str(engine.reason) || 'mismatch'; }
      else if (engine.phase === 'ready' && isObj(engine.result) && engine.result.key === figKey(rows)) state = 'exact';
      else state = (engine.phase === 'loading' || engine.phase === 'ready') ? 'loading' : 'idle';
      if (state === 'exact') {
        const b = F.summary(q), a = F.summary(engine.result.payload);
        summary = [['Subtotal', 'subtotal'], ['Discount', 'discountAmount'], ['Net', 'netAmount'], ['VAT', 'vatAmount'], ['Grand total', 'total'], ['Down payment', 'downPayment'], ['Balance', 'balance']]
          .filter((r) => b[r[1]] !== null || a[r[1]] !== null)
          .map((r) => ({ label: r[0], key: r[1], before: b[r[1]] === null ? '' : money(b[r[1]]), after: a[r[1]] === null ? '' : money(a[r[1]]), changed: b[r[1]] !== a[r[1]] }));
        const pay = engine.result.payload;
        if (q.optionsMode && Array.isArray(q.options) && isObj(pay) && Array.isArray(pay.options)) {
          options = pay.options.filter(isObj).map((o, k) => ({ label: trim(o.label), before: isObj(q.options[k]) ? money(q.options[k].total) : '', after: money(o.total), basis: !!o.key && o.key === pay.optionsBasis }));
        }
        held = arr(engine.result.held).length;
      }
    }
    return { rows, prices: c.prices, notes: c.notes, anyError, belowCost, noFig, state, reason, summary, options, held };
  }
  const DISCOUNT_RATE_TOL = 0.001;   // a drop in the effective discount rate of more than 0.1 percentage points is read as "the discount was capped"
  // the confirm sentences of Approve at my figures / Return with my figures (spec 6.3); pure so the test can read them
  function confirmText(kind, vm) {
    const f = vm.fig || {};
    const no = vm.number, client = vm.client || 'the client';
    const ln = (n) => n + ' ' + (n === 1 ? 'line' : 'lines');
    if (kind === 'return') {
      return 'Return ' + no + ' with your prices on ' + ln(f.prices) + '? Sales applies them and re-sends. ' + (f.carry
        ? 'A re-send at or above your prices is filed without coming back to you.' : 'The re-send will come back to you for approval.');
    }
    const parts = ['Approve ' + no + ' for ' + client + ' at your prices? ' + ln(f.prices) + ' change.'];
    const ch = f.change || {};
    if (ch.total) parts.push('Grand total ' + ch.total[0] + ' becomes ' + ch.total[1] + '.');
    if (ch.downPayment) parts.push('Down payment ' + ch.downPayment[0] + ' becomes ' + ch.downPayment[1] + '.');
    if (ch.discount) parts.push('Discount ' + ch.discount[0] + ' becomes ' + ch.discount[1] + '.' + (ch.capped ? ' The discount was capped at the project cost.' : ''));
    if (f.held) parts.push(f.held + (f.held === 1 ? ' other line is' : ' other lines are') + ' held at the prices shown.');
    if (f.belowCost) parts.push(f.belowCost + (f.belowCost === 1 ? ' line is' : ' lines are') + ' below cost.');
    return parts.join(' ');
  }
  // before -> after of the headline numbers, from the engine's result against the stored quote ([money, money] or null); capped = the effective discount rate fell (a rate comparison: the cap itself lives in the builder's computeTotals)
  function changeOf(q, payload) {
    const F = QF();
    const b = F.summary(q), a = F.summary(payload);
    const pair = (k) => (b[k] !== null && a[k] !== null && b[k] !== a[k]) ? [money(b[k]), money(a[k])] : null;
    const discount = pair('discountAmount');
    let capped = false;
    if (discount) {
      const rb = b.subtotal > 0 ? b.discountAmount / b.subtotal : 0, ra = a.subtotal > 0 ? a.discountAmount / a.subtotal : 0;
      capped = n0(q.discountPct) > 0 && ra < rb - DISCOUNT_RATE_TOL;
    }
    return { total: pair('total'), downPayment: pair('downPayment'), discount, capped };
  }

  // the cost card: at his prices when the engine answered (the stored quote overlaid with the engine's money fields and cost record), else the stored margin, marked "at Sales' prices" while he has typed a price
  function costAt(q, sc, lines, fig, engine) {
    const priced = lines.map((L) => (L.fig && L.fig.to !== null && L.fig.to !== undefined) ? Object.assign({}, L, { unitPrice: L.fig.to }) : L);
    if (fig && !fig.noFig && fig.state === 'exact' && isObj(engine.result) && isObj(engine.result.payload)) {
      const overlay = Object.assign({}, q, QF().moneyEdits(engine.result.payload));
      return Object.assign(costModel(overlay, isObj(engine.result.costSidecar) ? engine.result.costSidecar : sc, priced), { label: 'at your prices' });   // (a card with no cost record stays "none")
    }
    const c = costModel(q, sc, priced);
    return (fig && !fig.noFig) ? Object.assign(c, { label: "at Sales' prices" }) : c;
  }

  // ── the view model ─────────────────────────────────────────────────────────────────────────────────────────────────
  // q: the quote doc's data.  ctx: { coll, id, ref, role, uid, sidecar, comments, newer: { ref, number }, parent: { number }, commentsOff, offline, now, companyLabel, lib: { FormsCore, QBSpecSheet },
  //       figures: { inputs: { [lineIndex]: { price, note } }, engine: { phase, reason, result } } }   (the President's figures: the page's in-memory state, so this stays a function of its arguments)
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
    const hasNewer = isObj(ctx.newer) && !!ctx.newer.ref;
    // his boxes (spec 6.1): only the President, only while the quote waits for him, not when a newer revision exists (its banner says so), not when the thread cannot be written (no immutable record), and only with the core loaded
    const figuresOn = isApprover && state === 'pending' && !hasNewer && !ctx.commentsOff && !!QF();
    const figIn = isObj(ctx.figures) ? ctx.figures : {};
    const pf = isObj(q.presidentFigures) ? q.presidentFigures : null;
    const pfPrices = pf ? arr(pf.lines).filter((r) => isObj(r) && r.to != null).length : 0;

    // banners, in this order
    const banners = [];
    if (ctx.offline) banners.push({ kind: 'offline', text: 'You are offline. Showing the last saved copy.' });
    if (hasNewer) banners.push({ kind: 'newer', text: 'A newer revision, ' + str(ctx.newer.number) + ', was sent for approval.', ref: str(ctx.newer.ref) });
    const nPrices = (n) => n + ' ' + (n === 1 ? 'line' : 'lines');
    if (state === 'approved' && q.approvalCarriedKind === 'figures') {
      const on = fmtDay(q.approvalCarriedOn || q.approvalCarriedAt);
      banners.push({ kind: 'state', text: 'Filed under the prices the President set' + (on ? ' on ' + on : '') + '.' });
    } else if (state === 'approved') {
      const who = arr(ctx.comments).filter((e) => isObj(e) && e.kind === 'approved' && trim(e.authorName)).map((e) => trim(e.authorName)).pop();
      const at = fmtTs(q.approvedAt);
      banners.push({ kind: 'state', text: 'Approved by ' + (who || 'the President') + (at ? ' on ' + at : '') + (pf && pf.mode === 'approve' && pfPrices > 0 ? ' at his own prices on ' + nPrices(pfPrices) : '') + '.' });
    } else if (state === 'returned' && pf && pf.mode === 'return' && pfPrices > 0) {
      const at = fmtTs(q.returnedAt);
      banners.push({ kind: 'state', text: 'Returned' + (at ? ' on ' + at : '') + " with the President's prices on " + nPrices(pfPrices) + '. Waiting for Sales to apply them and re-send.' });
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
    // the President's figures: each line's box, the rows to store, the live summary
    const lineNo = {};
    lines.forEach(({ L }) => { lineNo[L.idx] = L.no; });
    let fig = null;
    if (figuresOn) fig = figuresModel(q, lines, isObj(figIn.inputs) ? figIn.inputs : {}, isObj(figIn.engine) ? figIn.engine : {}, sc, !!q.editableState);
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
    const warranty = plan === 'service6' ? '12-month service warranty' : plan === 'kitchenshield12' ? '12-month service warranty · KitchenShield PMS at a discount' : '';   // owner 2026-11-20: 12 months; Full kitchen = the same warranty + PMS at a discount
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
    const actions = { compose: false, placeholder: '', buttons: [], fig: null };
    if (isApprover) {
      actions.placeholder = 'Comment, or what to change before it can be approved';
      if (state === 'pending') {
        actions.compose = true; actions.buttons.push('approve');
        if (figuresOn) {
          actions.buttons.push('approveFig', 'returnFig');
          const why = () => fig.anyError ? 'Fix the price marked in red first.' : fig.noFig ? 'Type a price beside a line first.' : '';
          actions.fig = {
            noFig: fig.noFig,
            approveFig: { disabled: true, title: '' }, returnFig: { disabled: !!why(), title: why() },
          };
          const a = actions.fig.approveFig;
          if (why()) a.title = why();
          else if (!hasDoc) a.title = 'This quote was filed before the builder kept an editable copy.';
          else if (fig.state === 'unavailable') a.title = NO_ENGINE_SENTENCE;
          else if (fig.state !== 'exact') a.title = 'Working out the totals at your prices.';
          else a.disabled = false;
        }
        actions.buttons.push('return');
      }
      if (!commentsOff) { actions.compose = true; actions.buttons.push('comment'); }
      if (!actions.buttons.length) actions.compose = false;
    } else if (isSubmitter) {
      actions.placeholder = 'Reply to the President';
      if (!commentsOff) { actions.compose = true; actions.buttons.push('comment'); }
      if (state === 'returned' && hasDoc) actions.buttons.push(pfPrices > 0 ? 'applyFig' : 'revise');
    }
    const commentLabel = isApprover ? 'Comment' : 'Send reply';

    return {
      ref: str(ctx.ref), coll, id, role, isApprover, isSubmitter, readOnly, state, number, client, hasDoc,
      banners, header, why: whyModel(q, sc, isApprover), groups, photoSets, other, options, totals, grand, terms,
      cost: isApprover ? costAt(q, sc, lines.map(({ L }) => L), fig, isObj(figIn.engine) ? figIn.engine : {}) : null,
      thread: threadModel(q, ctx.comments, { commentsOff, id, now: ctx.now, lineNo }),
      actions, commentLabel,
      figuresOn, fig, pfPrices,
      figSummary: (fig && !fig.noFig) ? { state: fig.state, reason: fig.reason, changed: fig.prices, notes: fig.notes, rows: fig.summary || [], options: fig.options, held: fig.held, belowCost: fig.belowCost } : null,
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
  // the notices under a price box: the error, else the warnings (below cost in red); every string is ours, never data
  function figNoticeHtml(f, e) {
    if (f.error) return '<span class="qa-fig-error">' + e(f.error) + '</span>';
    return arr(f.warns).filter((w) => WARN_TEXT[w]).map((w) => '<span class="' + WARN_TEXT[w].cls + '">' + e(WARN_TEXT[w].text) + '</span>').join(' ');
  }
  // one line's boxes (spec 6.2): Your price (a unit price) and a Note; a line that cannot take a figure (an additional cost) shows the note box only
  function figBoxHtml(L, e) {
    const f = L.fig;
    if (!f) return '';
    const i = e(L.idx);
    const note = '<textarea class="qa-fig-note" id="qa-fn-' + i + '" rows="1" maxlength="500" data-i="' + i + '" aria-label="Note for this line" placeholder="Note for this line">' + e(f.note) + '</textarea>';
    if (!f.can) return '<div class="qa-fig qa-fig-noprice" data-fig-i="' + i + '"><div class="qa-fig-hint">Additional costs: return with a note.</div>' + note + '</div>';
    return '<div class="qa-fig" data-fig-i="' + i + '">'
      + '<label class="qa-fig-label" for="qa-fp-' + i + '">Your price (per ' + e(L.unit || 'unit') + ')</label>'
      + '<div class="qa-fig-row"><input class="qa-fig-price" id="qa-fp-' + i + '" inputmode="decimal" autocomplete="off" data-i="' + i + '" placeholder="' + e(money(L.unitPrice)) + '" value="' + e(f.value) + '">'
      + '<span class="qa-fig-amount">' + e(f.amount) + '</span>'
      + '<button type="button" class="qa-fig-clear" aria-label="Clear your price"' + (f.value.trim() ? '' : ' hidden') + '>✕</button></div>'
      + '<div class="qa-fig-err" role="alert">' + figNoticeHtml(f, e) + '</div>'
      + note + '</div>';
  }
  function presHtml(L, e) {
    const p = L.pres;
    if (!p || (p.to == null && !p.note)) return '';
    return '<div class="qa-pres">' + (p.to != null ? 'President: ' + e(money(p.to)) + (p.from != null ? " (Sales' price " + e(money(p.from)) + ')' : '') + (p.note ? ' · ' : '') : "President's note: ")
      + (p.note ? '"' + e(p.note) + '"' : '') + '</div>';
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
      + ((L.chips.length || L.byPres) ? '<div class="qa-chips">' + L.chips.map((c) => '<span class="qa-chip qa-chip-flag">' + e(c) + '</span>').join('')
        + (L.byPres ? '<span class="qa-chip qa-chip-pres" title="' + e(L.byPres.title) + '">' + e(L.byPres.label) + '</span>' : '') + '</div>' : '')
      + '<div class="qa-calc"><span>' + e(qtyText) + '</span> × <span>' + e(money(L.unitPrice)) + '</span> = <strong>' + e(money(L.amount)) + '</strong></div>'
      + presHtml(L, e) + figBoxHtml(L, e)
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
    const fb = a.fig || null;
    const figAttrs = (k) => (fb && fb[k].disabled ? ' disabled' : '') + (fb && fb[k].title ? ' title="' + e(fb[k].title) + '"' : '');
    const B = {
      approve: '<button type="button" class="btn-success qa-btn" id="qa-approve">Approve</button>',
      return: '<button type="button" class="btn-primary qa-btn" id="qa-return">Return</button>',
      comment: '<button type="button" class="btn-secondary qa-btn" id="qa-comment">' + e(vm.commentLabel) + '</button>',
      revise: '<button type="button" class="btn-primary qa-btn" id="qa-revise">Revise in builder</button>',
      approveFig: fb ? '<button type="button" class="btn-success qa-btn qa-btn-fig" id="qa-approve-fig"' + figAttrs('approveFig') + '>Approve at my figures</button>' : '',
      returnFig: fb ? '<button type="button" class="btn-primary qa-btn qa-btn-fig" id="qa-return-fig"' + figAttrs('returnFig') + '>Return with my figures</button>' : '',
      applyFig: '<button type="button" class="btn-primary qa-btn" id="qa-apply-fig">Apply President\'s figures</button>',
    };
    // his two own-figures buttons are the primary row of a phone bar and are hidden there until a price is typed (CSS .qa-nofig); on a desktop all of them sit on one row
    if (fb) {
      const first = a.buttons.filter((k) => k === 'approveFig' || k === 'returnFig'), rest = a.buttons.filter((k) => k !== 'approveFig' && k !== 'returnFig');
      return '<div class="qa-actionbar qa-actionbar-fig' + (fb.noFig ? ' qa-nofig' : '') + '"><div class="qa-bar-row qa-bar-primary">' + first.map((k) => B[k]).join('') + '</div><div class="qa-bar-row">' + rest.map((k) => B[k] || '').join('') + '</div></div>';
    }
    return '<div class="qa-actionbar">' + a.buttons.map((k) => B[k] || '').join('') + '</div>';
  }
  function composeHtml(vm, e) {
    if (!vm.actions.compose) return '';
    return '<div class="qa-compose"><textarea id="qa-text" rows="3" maxlength="2000" placeholder="' + e(vm.actions.placeholder) + '"></textarea>'
      + '<div class="qa-compose-meta"><span id="qa-err" class="qa-err" role="alert"></span><span id="qa-count" class="qa-count">0/2000</span></div>'
      + (vm.figuresOn ? '<label class="qa-fig-seefirst" id="qa-fig-seefirst-wrap"' + (vm.fig && !vm.fig.noFig ? '' : ' hidden') + '><input type="checkbox" id="qa-fig-seefirst"> Show me the re-send before it is filed</label>' : '')
      + '</div>';
  }
  // the "At your prices" card: shown while at least one valid price is typed (spec 6.2). Idle / loading / the live before-and-after / the sentence when the builder cannot work the totals out.
  function figSumHtml(vm, e) {
    const f = vm.figSummary;
    if (!f) return '';
    let body;
    if (f.state === 'unavailable') body = '<div class="qa-thread-note">' + e(NO_ENGINE_SENTENCE) + (f.reason ? ' <span class="qa-note">(' + e(f.reason) + ')</span>' : '') + '</div>';
    else if (f.state !== 'exact') body = '<div class="qa-figsum-wait"><span class="qa-spin" aria-hidden="true"></span> Working out the totals at your prices…</div>';
    else {
      body = '<table class="qa-figsum-tbl"><thead><tr><th></th><th>Sales\' prices</th><th>Your prices</th></tr></thead><tbody>'
        + f.rows.map((r) => '<tr' + (r.changed ? ' class="qa-changed"' : '') + '><td>' + e(r.label) + '</td><td>' + e(r.before) + '</td><td>' + e(r.after) + '</td></tr>').join('') + '</tbody></table>'
        + (f.options && f.options.length ? '<div class="qa-sub-h">Options at your prices</div><table class="qa-figsum-tbl"><tbody>' + f.options.map((o) => '<tr><td>' + e(o.label) + (o.basis ? ' <span class="qa-chip">Basis of the total</span>' : '') + '</td><td>' + e(o.before) + '</td><td>' + e(o.after) + '</td></tr>').join('') + '</tbody></table>' : '')
        + (f.held ? '<div class="qa-note">' + e(f.held + (f.held === 1 ? ' other line is' : ' other lines are') + ' held at the price shown.') + '</div>' : '');
    }
    return '<section class="qa-card qa-figsum" id="qa-figsum"><h4 class="qa-h">At your prices</h4>' + body + '</section>';
  }
  function costHtml(vm, e) {
    if (!vm.cost) return '';
    return '<section class="qa-card qa-cost"><h4 class="qa-h">Cost and margin' + (vm.cost.label ? ' <span class="qa-note">' + e(vm.cost.label) + '</span>' : '') + '</h4>'
      + (vm.cost.none ? '<div class="qa-thread-note">No cost record was saved with this quote.</div>'
        : '<dl class="qa-kv">' + vm.cost.rows.map((r) => '<dt class="' + (r.tone ? 'qa-' + e(r.tone) : '') + '">' + e(r.label) + '</dt><dd>' + e(r.value) + '</dd>').join('') + '</dl>')
      + '</section>';
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
        + vm.other.map((p, i) => '<figure class="qa-photo-fig"><button type="button" class="qa-thumb" data-set="other" data-i="' + i + '" aria-label="View photo"><img class="qa-img" src="' + e(p.url) + '" alt="" loading="lazy" decoding="async"></button>'
          + (p.caption ? '<figcaption>' + e(p.caption) + '</figcaption>' : '') + '</figure>').join('') + '</div></section>');
    }
    if (vm.options) {
      out.push('<section class="qa-card"><h4 class="qa-h">Options</h4><table class="qa-opts"><thead><tr><th>Option</th><th>Items</th><th>Total</th></tr></thead><tbody>'
        + vm.options.rows.map((r) => '<tr' + (r.basis ? ' class="qa-opt-basis"' : '') + '><td>' + e(r.label) + (r.basis ? ' <span class="qa-chip">Basis of the total</span>' : '') + '</td><td>' + e(r.count) + '</td><td>' + e(r.total) + '</td></tr>').join('')
        + '</tbody></table><div class="qa-note">' + e(vm.options.note) + '</div></section>');
    }
    out.push('<div class="qa-host" id="qa-figsum-host">' + figSumHtml(vm, e) + '</div>');
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
    out.push('<div class="qa-host" id="qa-cost-host">' + costHtml(vm, e) + '</div>');
    out.push('<section class="qa-card qa-thread" id="qa-thread"><h4 class="qa-h">Comments</h4><div id="qa-thread-list">' + threadHtml(vm.thread, e) + '</div>' + composeHtml(vm, e) + '</section>');
    out.push(actionBarHtml(vm, e));
    out.push('</div>');
    return out.join('');
  }

  const QA = { viewModel, html, safeImg, thread: threadModel, threadHtml, figSumHtml, costHtml, actionBarHtml, figNoticeHtml, figKey, confirmText, changeOf, NO_ENGINE_SENTENCE, _tsMs: tsMs };
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
    box.innerHTML = QA.threadHtml(QA.thread(S.q, r.entries, { commentsOff: r.off, id: S.id, lineNo: S.lineNo }), ESC);
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

    // the President's figures: the boxes' text (kept in sessionStorage across a reload against the fresh doc), the engine's state (a frame is created lazily, see ensureEngine)
    const fig = newFigState(ref, q);
    const ctx = {
      coll: r.coll, id: r.id, ref, role: currentRole, uid: currentUser.uid, sidecar, comments: thread.entries, commentsOff: thread.off,
      newer, parent: parentDoc ? { number: parentDoc.quoteNumber || '' } : null, offline: !online(),
      companyLabel: window.quoteCompanyLabel ? window.quoteCompanyLabel(q.company || 'BK') : '',
      lib: { FormsCore: window.FormsCore, QBSpecSheet: window.QBSpecSheet },
      figures: { inputs: fig.inputs, engine: fig.engine },
    };
    const vm = QA.viewModel(q, ctx);
    c.innerHTML = QA.html(vm, ESC);
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    const lineNo = {}; vm.groups.forEach((g) => g.lines.forEach((L) => { lineNo[L.idx] = L.no; }));
    _cur = { ref, coll: r.coll, id: r.id, q, vm, ctx, commentsOff: thread.off, comments: thread.entries, fig, lineNo };
    wire(c, _cur);
    if (vm.figuresOn && vm.fig && !vm.fig.noFig) runEngine(_cur);   // prices restored from this session: work the totals out again
    if (!_visBound) {
      _visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && window.currentPage === 'quote-approval' && _cur) refreshThread(_cur);
      });
    }
  };

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  The President's figures: state, the hidden engine frame, the proofs (QUOTE-PRESIDENT-FIGURES-SPEC-2026-11-20 §2, §6.3)
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const ENGINE_BOOT_MS = 15000, ENGINE_APPLY_MS = 5000, FIG_DEBOUNCE_MS = 400;
  const storeKey = (ref) => 'qaFig:' + ref;

  // inputs: { [lineIndex]: { price, note, n, q } } — n and q (name and quantity of the line when typed) let a reload against a CHANGED quote drop a figure that no longer belongs to its line
  function readStored(ref, q) {
    const out = {};
    try {
      const raw = JSON.parse(sessionStorage.getItem(storeKey(ref)) || 'null');
      if (!raw || typeof raw !== 'object') return out;
      Object.keys(raw).forEach((k) => {
        const r = raw[k], it = arr(q.items)[Number(k)];
        if (isObj(r) && isObj(it) && str(r.n) === str(it.name).slice(0, 120) && n0(r.q) === n0(it.qty)) out[k] = { price: str(r.price), note: str(r.note), n: str(r.n), q: n0(r.q) };
      });
    } catch (_) { /* no storage: the boxes simply start empty */ }
    return out;
  }
  function writeStored(S) {
    try {
      const keep = {};
      Object.keys(S.fig.inputs).forEach((k) => { const r = S.fig.inputs[k]; if (r && (str(r.price).trim() || str(r.note).trim())) keep[k] = r; });
      if (Object.keys(keep).length) sessionStorage.setItem(storeKey(S.ref), JSON.stringify(keep)); else sessionStorage.removeItem(storeKey(S.ref));
    } catch (_) { /* storage blocked: the boxes still work, they are just not kept across a reload */ }
  }
  function clearStored(ref) { try { sessionStorage.removeItem(storeKey(ref)); } catch (_) { /* nothing to clear */ } }
  function newFigState(ref, q) {
    return { inputs: isObj(q) && arr(q.items).length ? readStored(ref, q) : {}, engine: { phase: 'none', reason: '', result: null, base: null, units: null }, seq: 0, timer: null, host: null, waiters: [], audited: false, seeFirst: false };
  }

  // settle: whoever awaits the engine's answer (a decision that flushed a pending run) is let go when the answer, a failure or a timeout lands
  function settle(S) { const w = S.fig.waiters; S.fig.waiters = []; w.forEach((f) => f()); }
  function engineDown(S, reason, detail) {
    const F = S.fig, h = F.host;
    F.engine.phase = 'unavailable'; F.engine.reason = reason; F.engine.result = null; F.engine.pending = null;
    if (h) { clearTimeout(h.bootTimer); clearTimeout(h.applyTimer); try { window.removeEventListener('message', h.listener); } catch (_) { /* gone */ } try { h.frame.remove(); } catch (_) { /* gone */ } F.host = null; }
    if (_cur !== S) { settle(S); return; }   // the page was left or redrawn meanwhile: nothing to paint or log
    if (!F.audited) { F.audited = true; try { window.logAudit && window.logAudit('update', 'quote', S.id, { figuresEngine: reason + (detail ? ':' + detail : '') }); } catch (_) { /* the audit line is best-effort */ } }
    paintFigures(S); settle(S);
  }
  function post(h, msg) { try { h.frame.contentWindow.postMessage(msg, window.location.origin); return true; } catch (_) { return false; } }

  // the frame is created the FIRST time the President focuses a price box (a quote he only reads never loads the builder); it lives in #page-content, so leaving the page removes it
  function ensureEngine(S) {
    const F = S.fig;
    if (F.host) return F.host;
    if (F.engine.phase === 'unavailable') return null;
    if (!S.q.editableState) { F.engine.phase = 'unavailable'; F.engine.reason = 'no-snapshot'; return null; }
    const c = document.getElementById('page-content');
    if (!c) return null;
    const frame = document.createElement('iframe');
    frame.id = 'qa-engine';
    frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('tabindex', '-1'); frame.setAttribute('title', 'Quote engine');
    frame.src = 'quote-builder-v2.html?v=' + encodeURIComponent(window.APP_VERSION) + '&engine=1&reopen=1';
    const h = { frame, bootTimer: null, applyTimer: null, listener: null, sent: false };
    h.listener = (ev) => onEngineMessage(S, h, ev);
    window.addEventListener('message', h.listener);
    h.bootTimer = setTimeout(() => { if (F.engine.phase === 'loading') engineDown(S, 'timeout', 'boot'); }, ENGINE_BOOT_MS);
    F.host = h; F.engine.phase = 'loading';
    c.appendChild(frame);
    return h;
  }
  async function onEngineMessage(S, h, ev) {
    const F = S.fig;
    if (!h.frame.isConnected) { clearTimeout(h.bootTimer); clearTimeout(h.applyTimer); try { window.removeEventListener('message', h.listener); } catch (_) { /* gone */ } return; }
    if (!ev || ev.origin !== window.location.origin || ev.source !== h.frame.contentWindow) return;   // only the frame this page created (a builder page elsewhere is ignored)
    const d = ev.data || {};
    if (F.host !== h) return;
    if (d.type === 'QB_READY') {
      if (h.sent) return; h.sent = true;
      let state = null;
      try { state = typeof window.qbStateForDoc === 'function' ? await window.qbStateForDoc(S.coll, S.id, S.q) : null; } catch (_) { state = null; }
      if (F.host !== h) return;
      if (!state) { engineDown(S, 'no-snapshot'); return; }
      post(h, { type: 'LOAD_QUOTE', payload: { editableState: state, asRevision: false } });
    } else if (d.type === 'ENGINE_READY') {
      if (F.engine.phase !== 'loading') return;
      clearTimeout(h.bootTimer);
      F.engine.base = d.base; F.engine.units = d.units;
      const p1 = QF().baselineMatches(S.q, d.base, d.units);   // P1: before any figure the builder must reproduce what was stored
      if (!p1.ok) { engineDown(S, 'mismatch', 'P1 ' + p1.reason); return; }
      F.engine.phase = 'ready';
      runEngine(S);
    } else if (d.type === 'FIGURES_RESULT') {
      const pend = F.engine.pending;
      if (!pend || d.seq !== F.seq || d.seq !== pend.seq) return;   // a result for an older request is dropped
      clearTimeout(h.applyTimer);
      F.engine.pending = null;
      if (!d.ok) { engineDown(S, d.error === 'unstable' ? 'unstable' : 'mismatch', 'engine ' + str(d.error)); return; }
      const p2 = QF().verifyResult(S.q, d.payload, pend.figs);   // P2: every figure landed, nothing else moved
      if (!p2.ok) { engineDown(S, 'mismatch', 'P2 ' + p2.reason); return; }
      F.engine.result = { key: pend.key, payload: d.payload, costSidecar: d.costSidecar || null, held: arr(d.held), applied: arr(d.applied), summary: d.summary || null };
      paintFigures(S); settle(S);
    }
  }
  // the current view model (the page's in-memory state through the pure half)
  function vmOf(S) {
    S.ctx.figures = { inputs: S.fig.inputs, engine: S.fig.engine };
    S.vm = QA.viewModel(S.q, S.ctx);
    return S.vm;
  }
  // work the totals out at the valid figures now typed. Cheap to call: it does nothing without a valid figure, and waits for ENGINE_READY (which calls it again) while the frame boots.
  function runEngine(S) {
    const F = S.fig;
    clearTimeout(F.timer); F.timer = null;
    const vm = vmOf(S);
    if (!vm.figuresOn || !vm.fig || vm.fig.noFig || vm.fig.anyError) { F.engine.result = null; paintFigures(S); settle(S); return; }
    const figs = vm.fig.rows.filter((r) => r.to != null).map((r) => ({ i: r.i, to: r.to }));
    const h = ensureEngine(S);
    if (!h) { paintFigures(S); settle(S); return; }
    if (F.engine.phase !== 'ready') { paintFigures(S); return; }
    const key = QA.figKey(vm.fig.rows);
    if (F.engine.result && F.engine.result.key === key) { paintFigures(S); settle(S); return; }
    const seq = ++F.seq;
    F.engine.pending = { seq, key, figs };
    F.engine.result = null;
    post(h, { type: 'APPLY_FIGURES', seq, figures: figs, by: { uid: currentUser.uid, name: who() }, at: new Date().toISOString() });
    clearTimeout(h.applyTimer);
    h.applyTimer = setTimeout(() => { if (F.engine.pending && F.engine.pending.seq === seq) engineDown(S, 'timeout', 'apply'); }, ENGINE_APPLY_MS);
    paintFigures(S);
  }
  // a decision that needs the answer for the figures as typed NOW: a pending debounce runs at once, and the call waits for the result (or the failure / timeout that ends the wait)
  async function flushEngine(S) {
    const F = S.fig;
    let vm = vmOf(S);
    if (!vm.figuresOn || !vm.fig || vm.fig.noFig) return vm;
    if (F.timer || vm.figSummary.state === 'loading' || vm.figSummary.state === 'idle') {
      const wait = new Promise((res) => { F.waiters.push(res); });
      runEngine(S);
      if (vmOf(S).figSummary && vmOf(S).figSummary.state === 'loading') await wait; else settle(S);
    }
    return vmOf(S);
  }

  // repaint ONLY what the figures change: each typed line's amount / notices, the "At your prices" card, the cost card, the tick and the action bar. Never the boxes themselves (focus must not move).
  function paintFigures(S) {
    if (!_cur || _cur !== S) return;
    const c = document.getElementById('page-content');
    if (!c) return;
    const vm = vmOf(S);
    if (!vm.figuresOn) return;
    vm.groups.forEach((g) => g.lines.forEach((L) => {
      const box = c.querySelector('[data-fig-i="' + L.idx + '"]');
      if (!box || !L.fig) return;
      const amt = box.querySelector('.qa-fig-amount'), err = box.querySelector('.qa-fig-err'), clr = box.querySelector('.qa-fig-clear');
      if (amt) amt.textContent = L.fig.amount;
      if (err) err.innerHTML = QA.figNoticeHtml(L.fig, ESC);
      if (clr) clr.hidden = !L.fig.value.trim();
    }));
    const sum = c.querySelector('#qa-figsum-host'), cost = c.querySelector('#qa-cost-host'), tick = c.querySelector('#qa-fig-seefirst-wrap');
    if (sum) sum.innerHTML = QA.figSumHtml(vm, ESC);
    if (cost) cost.innerHTML = QA.costHtml(vm, ESC);
    if (tick) tick.hidden = !(vm.fig && !vm.fig.noFig);
    const bar = c.querySelector('.qa-actionbar');
    if (bar) {
      const t = document.createElement('div');
      t.innerHTML = QA.actionBarHtml(vm, ESC);
      if (t.firstElementChild) { bar.replaceWith(t.firstElementChild); if (S.rewireBar) S.rewireBar(); }
    }
  }
  function onFigField(S, el) {
    const i = el.dataset.i, it = arr(S.q.items)[Number(i)];
    if (!isObj(it)) return;
    const row = S.fig.inputs[i] || (S.fig.inputs[i] = { price: '', note: '', n: str(it.name).slice(0, 120), q: n0(it.qty) });
    if (el.classList.contains('qa-fig-price')) row.price = el.value; else row.note = el.value;
    writeStored(S);
    paintFigures(S);                                   // validation, the amount and the buttons follow at once
    clearTimeout(S.fig.timer);
    S.fig.timer = setTimeout(() => runEngine(S), FIG_DEBOUNCE_MS);   // the totals follow when he pauses
  }

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
  const TYPED_PRICES_SENTENCE = 'You typed prices. Use Approve at my figures or Return with my figures, or clear them.';
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
    // a taken (or already taken) decision clears the boxes and redraws the quote; a refused one because the quote CHANGED redraws too (the boxes come back from the session, checked against the fresh quote)
    const afterDecision = (res) => {
      if (res && (res.ok || res.reason === 'state')) { clearStored(S.ref); if (ta) ta.value = ''; window.renderQuoteApproval(S.ref); }
      else if (res && res.reason === 'changed') window.renderQuoteApproval(S.ref);
    };
    const common = { coll: S.coll, quoteId: S.id, agentId: S.q.createdBy, quoteNumber: S.q.quoteNumber, clientName: S.q.clientName };

    // the boxes: typing validates and recomputes at once; the first focus on a price box creates the engine frame
    const root = $('.qa-page');
    if (root) {
      root.addEventListener('input', (ev) => { const el = ev.target; if (el && el.matches && el.matches('.qa-fig-price, .qa-fig-note')) onFigField(S, el); });
      root.addEventListener('focusin', (ev) => { const el = ev.target; if (el && el.matches && el.matches('.qa-fig-price') && S.vm.figuresOn) ensureEngine(S); });
      root.addEventListener('click', (ev) => {
        const b = ev.target && ev.target.closest ? ev.target.closest('.qa-fig-clear') : null;
        if (!b) return;
        const inp = b.closest('.qa-fig').querySelector('.qa-fig-price');
        if (inp) { inp.value = ''; onFigField(S, inp); inp.focus(); }
      });
    }

    // his line notes without prices ride along with a plain decision (and nothing is added to the call when there are none: today's call, byte for byte)
    const plainFigures = (mode) => {
      const vm = vmOf(S);
      const rows = vm.fig ? vm.fig.rows : [];
      return rows.length ? { mode, lines: rows, changed: 0, totals: null, exact: false, carry: false } : null;
    };
    const pick = (x) => ({ subtotal: x.subtotal, netAmount: x.netAmount, total: x.total });

    // (the buttons are read once per bar: an event's currentTarget is gone after the first await; the bar is redrawn while he types, so this runs again on every redraw)
    const bindBar = () => {
      const approveBtn = $('#qa-approve'), returnBtn = $('#qa-return'), commentBtn = $('#qa-comment'), approveFigBtn = $('#qa-approve-fig'), returnFigBtn = $('#qa-return-fig');
      approveBtn?.addEventListener('click', async () => {
        if (offline()) return;
        const vm = vmOf(S);
        if (vm.fig && vm.fig.prices > 0) { showErr(TYPED_PRICES_SENTENCE); return; }
        const ok = await window.confirmDialog({ message: 'Approve ' + S.vm.number + ' for ' + (S.vm.client || 'the client') + '? It will be filed and Sales will be told.' });
        if (!ok) return;
        const figures = plainFigures('approve');
        afterDecision(await window.busy(approveBtn, () => window.decideQuoteApproval({ ...common, action: 'approve', notes: text(), ...(figures ? { figures } : {}) })));
      });
      returnBtn?.addEventListener('click', async () => {
        const vm = vmOf(S);
        if (vm.fig && vm.fig.prices > 0) { showErr(TYPED_PRICES_SENTENCE); return; }
        const figures = plainFigures('return');
        if (!text() && !figures) { showErr('Write what to change before you return it.'); return; }
        if (offline()) return;
        afterDecision(await window.busy(returnBtn, () => window.decideQuoteApproval({ ...common, action: 'return', notes: text(), ...(figures ? { figures } : {}) })));
      });
      commentBtn?.addEventListener('click', async () => {
        const vm = vmOf(S);
        const noteRows = (vm.fig ? vm.fig.rows : []).filter((r) => r.note).map((r) => Object.assign({}, r, { to: null }));   // typed prices are NOT sent: they stay in their boxes
        if (!text() && !noteRows.length) { showErr('Write a comment first.'); return; }
        if (offline()) return;
        const body = text();
        const isPres = S.vm.isApprover;
        const res = await window.busy(commentBtn, () => window.QuoteThread.add({ coll: S.coll, quoteId: S.id, q: S.q, kind: noteRows.length ? 'figures' : 'comment', text: body, uid: currentUser.uid, name: who(), role: currentRole,
          ...(noteRows.length ? { lines: noteRows } : {}) }));
        if (!res || !res.ok) { Notifs.showToast('The comment was not saved. Try again.', 'error'); return; }
        notifyComment(S, body, res.id, isPres, noteRows.length);
        if (ta) { ta.value = ''; if (cnt) cnt.textContent = '0/2000'; }
        if (noteRows.length) {   // the notes were sent: their boxes empty, the prices stay
          noteRows.forEach((r) => { const row = S.fig.inputs[r.i]; if (row) row.note = ''; const box = c.querySelector('#qa-fn-' + r.i); if (box) box.value = ''; });
          writeStored(S); paintFigures(S);
        }
        refreshThread(S);
      });
      // Approve at my figures: the engine must be exact for the figures as typed now (a pending debounce runs first), then the confirm with the totals, then ONE decision carrying the builder's own money fields
      approveFigBtn?.addEventListener('click', async () => {
        if (offline() || S.fig.busy) return;
        S.fig.busy = true;
        try {
          const vm = await flushEngine(S);
          if (!vm.fig || vm.fig.noFig || vm.fig.anyError || vm.figSummary.state !== 'exact') { paintFigures(S); return; }
          const rs0 = S.fig.engine.result;
          const ok = await window.confirmDialog({ message: QA.confirmText('approve', { number: vm.number, client: vm.client, fig: { prices: vm.fig.prices, held: vm.figSummary.held, belowCost: vm.fig.belowCost, change: QA.changeOf(S.q, rs0.payload) } }) });
          if (!ok) return;
          const vm2 = vmOf(S), rs = S.fig.engine.result;
          if (vm2.figSummary.state !== 'exact' || !rs || QA.figKey(vm2.fig.rows) !== rs.key) { Notifs.showToast('Your prices changed while you were confirming. Check them and try again.', 'info'); return; }
          const F = QF(), FV = firebase.firestore.FieldValue;
          afterDecision(await window.busy(approveFigBtn, () => window.decideQuoteApproval({ ...common, action: 'approve', notes: text(),
            edits: { ...F.moneyEdits(rs.payload), editedByPresident: true, editedAt: FV.serverTimestamp(), editedBy: currentUser.uid },
            figures: { mode: 'approve', lines: vm2.fig.rows, changed: vm2.fig.prices, totals: { before: pick(F.summary(S.q)), after: pick(F.summary(rs.payload)) }, exact: true, carry: false, held: arr(rs.held) },
            expectSig: F.sig(S.q), costSidecar: rs.costSidecar || null })));
        } finally { S.fig.busy = false; }
      });
      // Return with my figures: the bottom box may be empty (the figures are the instruction). A re-send at or above his prices is filed without coming back to him only when the engine proved the totals and the tick is off.
      returnFigBtn?.addEventListener('click', async () => {
        if (offline() || S.fig.busy) return;
        S.fig.busy = true;
        try {
          const vm = await flushEngine(S);
          if (!vm.fig || vm.fig.noFig || vm.fig.anyError) { paintFigures(S); return; }
          const seeFirst = !!($('#qa-fig-seefirst') && $('#qa-fig-seefirst').checked);
          const exact0 = vm.figSummary.state === 'exact';
          const ok = await window.confirmDialog({ message: QA.confirmText('return', { number: vm.number, client: vm.client, fig: { prices: vm.fig.prices, carry: exact0 && !seeFirst } }) });
          if (!ok) return;
          const vm2 = vmOf(S), rs = S.fig.engine.result;
          const exact = vm2.figSummary.state === 'exact' && !!rs && QA.figKey(vm2.fig.rows) === rs.key;
          if (exact !== exact0) { Notifs.showToast('Your prices changed while you were confirming. Check them and try again.', 'info'); return; }
          const F = QF();
          afterDecision(await window.busy(returnFigBtn, () => window.decideQuoteApproval({ ...common, action: 'return', notes: text(),
            figures: { mode: 'return', lines: vm2.fig.rows, changed: vm2.fig.prices, totals: exact ? { before: pick(F.summary(S.q)), after: pick(F.summary(rs.payload)) } : null, exact, carry: exact && !seeFirst },
            expectSig: F.sig(S.q) })));
        } finally { S.fig.busy = false; }
      });
      $('#qa-apply-fig')?.addEventListener('click', () => { window._qbFiguresAutoApply = true; window.reopenQuoteFromDoc(S.coll, S.id, window.quoteBuilderPageFor(S.q.company)); });
      $('#qa-revise')?.addEventListener('click', () => window.reopenQuoteFromDoc(S.coll, S.id, window.quoteBuilderPageFor(S.q.company)));
    };
    S.rewireBar = bindBar;
    bindBar();
  }

  // The other side hears about a comment (best-effort: the comment stays saved if this fails). The President's comment goes to the person who sent the quote; the sender's reply goes to the President.
  // A President's entry with line notes (kind figures) says how many lines, never what is on them (QUOTE-PRESIDENT-FIGURES-SPEC §9).
  async function notifyComment(S, body, commentId, byPresident, noteCount) {
    const ref = window.quoteApprovalRefOf(S.coll, S.id);
    const link = ref ? 'quote-approval/' + ref : 'approvals';
    const no = S.vm.number, client = S.vm.client || 'the client';
    try {
      if (byPresident) {
        if (S.q.createdBy && S.q.createdBy !== currentUser.uid) {
          if (noteCount > 0) {
            await Notifs.send(S.q.createdBy, { title: '💬 The President left notes on your quote', body: ('"' + no + '" for ' + client + ': notes on ' + noteCount + (noteCount === 1 ? ' line.' : ' lines.') + (body ? ' ' + body.slice(0, 300) : '')), icon: '💬', type: 'quote_comment', link });
          } else {
            await Notifs.send(S.q.createdBy, { title: '💬 The President commented on your quote', body: ('"' + no + '" for ' + client + ': ' + body.slice(0, 300)), icon: '💬', type: 'quote_comment', link });
          }
        }
      } else {
        await Notifs.sendToOwner({ title: '💬 Reply on a quote awaiting your approval', body: (who() + ' on "' + no + '": ' + body.slice(0, 300)), icon: '💬', type: 'quote_comment', link, dedupKey: 'quote_comment|' + commentId });
      }
    } catch (err) { console.warn('[quote-approval] the comment notification was not sent', err); }
  }
})();
