/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Forms engine (window.Forms)
   js/forms.js — specs/SALES-FLOW-SPEC-2026-11-19.md §9.3. The names and signatures below are a CONTRACT: the Sales-flow quick-fixes session
   codes against them (Generate SO & JO, the Sales Orders row, payment confirmation).
   ═══════════════════════════════════════════════════
   LAZY (CLAUDE.md "app-kit" rule: never a <script> in index.html; in sw.js PRECACHE):   await window.ensureScript('js/forms.js')
   On load it starts loading js/forms-core.js (the pure registry, guards and page builder — also what the tests run in Node); each form then
   loads its own body set (js/forms-set-1.js) and, for the job-based forms, js/screens/production.js (joDoc, jobOrderNoFor, JO_STAGE_COLS).
   The header is the owner's own layout, built in forms-core — js/letterhead.js is not used.

   READY-WHEN-AWAITED. The loader QF copies is  ensureScript('js/forms.js').then(() => window.Forms)  and resolves the moment THIS file has run,
   long before forms-core.js has arrived; `buttonHtml` and `canOpen` are synchronous and need the registry. So window.Forms is a thenable:
   a promise handler that returns it (or an `await`) waits for forms-core.js, then receives the same API as a plain object
   (no `then`, so it is not adopted again). After `await flowForms()` every method is safe to call. Direct calls to the async methods never need
   the wait: they load what they need themselves. (forms-core.js has to be there for the registry, hence the wait.)

   THE FORMAT is the quote builder's printed Quotation (owner rulings 2026-11-19): the header (horizontal logo, company line, title/number/date, the
   BK tile on Barro Kitchens documents), sections, signature dividers and footer come from FormsCore.compose(); the page is handed to
   window.openPrintableDoc (js/print-docs.js) with  downloadPdf:true  → Download PDF · Print · JPEG. The PDF itself is js/forms-pdf.js (window.FormsPdf),
   the one standalone PDF path — print-docs.js loads it on demand, and the quote builder uses the same file.  */
(function () {
  'use strict';

  const esc = (s) => (window.escHtml ? window.escHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const toast = (msg, type) => { try { if (window.Notifs && window.Notifs.showToast) window.Notifs.showToast(msg, type || 'error'); } catch (_) { /* never fail a caller over a toast */ } };
  const Forms = {};

  // ── dependencies ─────────────────────────────────────────────────────────────────────────────────────────
  let depsPromise = null;
  function loadDeps() {
    if (window.FormsCore) return Promise.resolve();
    if (!depsPromise) {
      depsPromise = window.ensureScript('js/forms-core.js')
        .then(() => { if (!window.FormsCore) throw new Error('The forms engine could not load.'); })
        .catch((e) => { depsPromise = null; throw e; });         // a failed load is retried by the next call
    }
    return depsPromise;
  }
  const ensureNeeds = (entry) => Promise.all((entry.needs || []).map((src) => window.ensureScript(src)));
  const ensureFor = (entry) => Promise.all([ensureNeeds(entry), entry.bodySet ? window.ensureScript(entry.bodySet) : null]);

  function currentViewer() {
    const p = window.userProfile || {};
    return window.FormsCore.viewer({
      uid: window.currentUser && window.currentUser.uid, role: window.currentRole || p.role,
      depts: window.currentDepts || p.departments || (p.department ? [p.department] : []),
      name: p.displayName || (window.currentUser && window.currentUser.email),
    });
  }
  const today = () => (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10));
  // `db` is firebase-config.js's top-level `const` — a global binding every classic script can read, but NOT window.db.
  const getDb = () => (typeof db !== 'undefined' ? db : null);

  // ── the records a form needs, read fresh (§9.3: sales_orders → projectId → job_projects) ───────────────────
  // ref: { orderId?, projectId?, claimId?, quoteId?, quoteColl?, docId?, record? }. Optional PRELOADED docs — used instead of a read, which is how a
  // form is previewed with a made-up record: record (the form's source doc), order, project, claim, client, quote, preparer, workOrders, drawings.
  // Everything beyond the form's own record is read SOFTLY: a refused or missing read leaves that part of the page out, never fails the form.
  async function loadCtx(entry, ref) {
    ref = ref || {};
    const fdb = getDb();
    const rec = await window.FormsCore.loadRecords(fdb, entry, ref);
    const ctx = { order: rec.order, project: rec.project, claim: rec.claim, client: ref.client || null, quote: ref.quote || null, preparer: ref.preparer || null,
      workOrders: Array.isArray(ref.workOrders) ? ref.workOrders : [], drawings: Array.isArray(ref.drawings) ? ref.drawings : [], today: today(), viewer: currentViewer() };
    const soft = async (fn) => { try { return await fn(); } catch (_) { return null; } };
    const get = async (coll, id) => { if (!fdb || !id) return null; const s = await fdb.collection(coll).doc(String(id)).get(); return s.exists ? Object.assign({ id: s.id }, s.data()) : null; };
    const main = ctx.order || ctx.claim || ctx.project || {};
    const clientId = [ctx.order, ctx.claim, ctx.project].map((r) => r && r.clientId).filter(Boolean)[0];
    const jobs = [];
    if (!ctx.client && clientId) jobs.push(soft(() => get('clients', clientId)).then((c) => { ctx.client = c; }));
    // the filed quote: its Subject line, totals ladder, payment terms and timeline
    const quoteId = ref.quoteId || [ctx.order, ctx.project, ctx.claim].map((r) => r && r.quoteId).filter(Boolean)[0];
    const quoteColl = ref.quoteColl || (ctx.project && ctx.project.quoteCollection) || (window.quoteCollectionFor ? window.quoteCollectionFor(main.company || 'BK') : 'bk_quotes');
    if (!ctx.quote && quoteId) jobs.push(soft(() => get(quoteColl, quoteId)).then((q) => { ctx.quote = q; }));
    // who prepared it, with the job title on their profile (users/{uid}.title)
    const preparerUid = (ctx.order && ctx.order.createdBy) || (ctx.project && ctx.project.createdBy);
    if (!ctx.preparer && preparerUid) jobs.push(soft(() => get('users', preparerUid)).then((u) => { if (u) ctx.preparer = { name: u.displayName || u.name || '', title: u.title || u.jobTitle || '' }; }));
    if ((entry.id === 'job_order' || entry.id === 'handoff_pack') && fdb && ctx.project && ctx.project.id && !ref.workOrders) {
      jobs.push(soft(async () => (await fdb.collection('production_orders').where('projectId', '==', ctx.project.id).get()).docs.map((d) => Object.assign({ id: d.id }, d.data())))
        .then((l) => { ctx.workOrders = l || []; }));
    }
    if ((entry.id === 'job_order' || entry.id === 'handoff_pack') && fdb && ctx.project && ctx.project.designProjectId && !ref.drawings) {
      jobs.push(soft(async () => (await fdb.collection('design_drawings').where('projectId', '==', ctx.project.designProjectId).get()).docs.map((d) => Object.assign({ id: d.id }, d.data())))
        .then((l) => { ctx.drawings = l || []; }));
    }
    await Promise.all(jobs);
    return ctx;
  }

  // Everything up to (not including) showing it. → { error } or { prep, composed }
  async function build(formId, ref, opts) {
    await loadDeps();
    const FC = window.FormsCore;
    const entry = FC.get(formId);
    if (!entry) return { error: 'That document is not available.' };
    if (!FC.canOpen(entry, currentViewer())) return { error: 'You do not have access to this document.' };
    await ensureFor(entry);
    let ctx;
    try { ctx = await loadCtx(entry, ref); }
    catch (e) { return { error: e && e.code === 'not-found' ? 'We could not find that record.' : 'Could not load the record. Check your connection and try again.' }; }
    const prep = FC.prepare(formId, ctx, opts);
    if (!prep.ok) { if (prep.detail) console.error('Forms: ' + formId + ' could not be built', prep.detail); return { error: prep.error }; }
    try { return { prep, composed: FC.compose(prep, FC.renderSections(prep)) }; }
    catch (e) { console.error('Forms: ' + formId + ' could not be rendered', e); return { error: 'This document could not be built.' }; }
  }
  const pageOpts = (c) => ({ title: c.title, pageId: c.pageId, bodyHtml: c.bodyHtml, pageCss: c.pageCss, accent: c.accent, fileName: c.fileName, pdfQuality: 0.85 });

  // ── the contract (§9.3) ──────────────────────────────────────────────────────────────────────────────────
  // Opens the A4 preview with Download PDF · Print · JPEG. → { ok, number, fileName, error? }   opts: { rev?, autoDownload? }
  Forms.open = async function (formId, ref, opts) {
    opts = opts || {};
    try {
      const r = await build(formId, ref, opts);
      if (r.error) { toast(r.error); return { ok: false, error: r.error }; }
      const c = r.composed;
      const panel = window.openPrintableDoc(Object.assign(pageOpts(c), {
        barLabel: (window.emojiIcon ? window.emojiIcon('🧾', 16) + ' ' : '') + c.barLabelText, watermark: c.watermark, downloadPdf: true }));
      if (opts.autoDownload && panel) setTimeout(() => { const b = panel.querySelector('#pd-pdf-btn'); if (b) b.click(); }, 350);
      return { ok: true, number: r.prep.number, rev: r.prep.rev, fileName: c.fileName };
    } catch (e) {
      console.error('Forms.open failed', e);
      toast('This document could not be opened.');
      return { ok: false, error: 'This document could not be opened.' };
    }
  };

  // The same build, straight to the PDF file (share sheet on a phone, a file save on a computer) without showing the preview. → { ok, fileName, error? }
  Forms.downloadPdf = async function (formId, ref, opts) {
    try {
      const r = await build(formId, ref, opts);
      if (r.error) { toast(r.error); return { ok: false, error: r.error }; }
      if (typeof window.exportPrintableDocPdf !== 'function') { toast('The PDF export is not available.'); return { ok: false, error: 'The PDF export is not available.' }; }
      const res = await window.exportPrintableDocPdf(Object.assign(pageOpts(r.composed), { watermark: r.composed.watermark }));
      if (!res.ok) toast(res.error);
      return { ok: !!res.ok, fileName: r.composed.fileName, error: res.error };
    } catch (e) {
      console.error('Forms.downloadPdf failed', e);
      toast('The PDF could not be made.');
      return { ok: false, error: 'The PDF could not be made.' };
    }
  };

  // Stores any missing serial and returns { [formId]: number }. Safe to call twice. NEVER throws — a number that cannot be written comes back as the
  // fallback (§9.5) and nothing fails; if the engine itself cannot load, every requested id comes back as '' (a string, never a missing key).
  // Only fields the viewer may write under today's firestore.rules are attempted (FormsCore.canStoreNumber).
  Forms.assignNumbers = async function (formIds, ref) {
    const ids = Array.isArray(formIds) ? formIds : [];
    try {
      await loadDeps();
      // joNumber's FALLBACK reads jobOrderNoFor (production.js): a failed load costs only that fallback, never the serial, so it is not fatal here
      await Promise.all(ids.map((id) => { const e = window.FormsCore.get(id); return e ? ensureNeeds(e).catch(() => null) : null; }));
      return await window.FormsCore.assignWith(getDb(), ids, ref || {}, currentViewer());
    } catch (_) { const blank = {}; ids.forEach((id) => { blank[String(id)] = ''; }); return blank; }
  };

  // The next serial of a series, 'PA' → 'PA-0031' (§9.5: counter form_PA, continuous, never reset). A number burned by a failed step is a gap, not an error.
  // The sales order and the job order are ONE serial (SO-0012 / JO-0012): 'JO' draws from the sales order's counter, form_SO (FormsCore.counterName).
  Forms.nextNumber = async function (series) {
    await loadDeps();
    const FC = window.FormsCore, s = String(series);
    return window.nextCounterId(FC.counterName(s), null, (n) => FC.fmtNumber(s, n));
  };

  Forms.canOpen = function (formId) { const FC = window.FormsCore; return !!FC && FC.canOpen(formId, currentViewer()); };

  // The standard button: btn-secondary btn-sm with data-form / data-ref, or '' when the viewer is outside the form's audience. Forms.bind() wires it.
  // opts: { label?, rev? }. Only the ids of `ref` travel in the markup (a preloaded doc cannot).
  const REF_KEYS = ['orderId', 'projectId', 'claimId', 'quoteId', 'quoteColl', 'docId'];
  Forms.buttonHtml = function (formId, ref, opts) {
    const FC = window.FormsCore;
    const entry = FC && FC.get(formId);
    if (!entry || !FC.canOpen(entry, currentViewer())) return '';
    opts = opts || {};
    const slim = {};
    REF_KEYS.forEach((k) => { if (ref && ref[k]) slim[k] = ref[k]; });
    return `<button type="button" class="btn-secondary btn-sm" data-form="${esc(formId)}" data-ref="${esc(JSON.stringify(slim))}"` +
      `${opts.rev != null ? ` data-rev="${esc(String(opts.rev))}"` : ''}>${esc(opts.label || FC.titleCase(entry.title))}</button>`;
  };
  Forms.bind = function (container) {
    if (!container || container._formsBound || typeof container.addEventListener !== 'function') return;
    container._formsBound = true;
    container.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-form]') : null;
      if (!btn || !container.contains(btn)) return;
      ev.preventDefault(); ev.stopPropagation();
      let ref = {};
      try { ref = JSON.parse(btn.getAttribute('data-ref') || '{}') || {}; } catch (_) { ref = {}; }
      const rev = btn.getAttribute('data-rev');
      const run = () => Forms.open(btn.getAttribute('data-form'), ref, rev != null ? { rev: Number(rev) } : {});
      if (window.busy) window.busy(btn, run); else run();
    });
  };

  // "Documents ready": one row per form the viewer may open — title, number, View, Download PDF.
  Forms.offer = async function (formIds, ref, opts) {
    try {
      await loadDeps();
      const FC = window.FormsCore, viewer = currentViewer();
      const rows = [];
      for (const id of Array.isArray(formIds) ? formIds : []) {
        const entry = FC.get(id);
        if (!entry || !FC.canOpen(entry, viewer)) continue;
        let number = '';
        try {
          await ensureNeeds(entry);
          const ctx = await FC.loadRecords(getDb(), entry, ref);
          const res = FC.resolveNumber(entry, ctx);
          number = FC.withRev(res.number, res.currentRev);
        } catch (_) { /* the row still shows; the number is on the document */ }
        rows.push({ id, title: FC.titleCase(entry.title), number });
      }
      if (!rows.length || typeof window.openModal !== 'function') return;
      window.openModal('Documents ready', `<div class="forms-offer" style="display:flex;flex-direction:column;gap:8px">` + rows.map((r) =>
        `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--border);border-radius:8px">` +
        `<div style="min-width:0"><div style="font-weight:700">${esc(r.title)}</div><div style="font-size:12px;color:var(--text-muted)">${esc(r.number)}</div></div>` +
        `<div style="display:flex;gap:6px"><button type="button" class="btn-secondary btn-sm" data-forms-act="view" data-form="${esc(r.id)}">View</button>` +
        `<button type="button" class="btn-primary btn-sm" data-forms-act="pdf" data-form="${esc(r.id)}">Download PDF</button></div></div>`).join('') + `</div>`);
      const wrap = document.querySelector('#modal-body .forms-offer');    // a fresh node per sheet, so listeners never pile up on the reused modal body
      if (wrap) wrap.addEventListener('click', (ev) => {
        const b = ev.target && ev.target.closest ? ev.target.closest('[data-forms-act]') : null;
        if (!b) return;
        const act = b.getAttribute('data-forms-act'), id = b.getAttribute('data-form');
        const run = () => (act === 'pdf' ? Forms.downloadPdf(id, ref, opts) : Forms.open(id, ref, opts));
        if (window.busy) window.busy(b, run); else run();
      });
    } catch (_) { /* a form problem never fails the caller */ }
  };

  // ── ready-when-awaited (see the header) ──────────────────────────────────────────────────────────────────
  Forms.whenReady = () => loadDeps().then(() => settled);
  const settled = Object.create(Forms, { then: { value: undefined } });       // the same API, not a thenable
  Object.defineProperty(Forms, 'then', { configurable: true, enumerable: false, value: function (onOk, onErr) { return Forms.whenReady().then(onOk, onErr); } });

  window.Forms = Forms;
  loadDeps().catch(() => { /* retried by the first real call */ });
})();
