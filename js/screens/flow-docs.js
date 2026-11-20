// ═══════════════════════════════════════════════════════════════════════════
//  js/screens/flow-docs.js — Production's turnover screens + the J9 close (specs/SALES-FLOW-SPEC-2026-11-19.md §5.4 J8 / J9, §5.8, §13.2 Phase 4).
//
//  LAZY: loaded through window.ensureScript('js/screens/flow-docs.js') by js/screens/production.js (job detail + the J8 guard),
//  js/payment-claims-ui.js (afterConfirm) and js/contract-ui.js (afterApply, refund). It is NOT in index.html's app-kit; it is in sw.js PRECACHE.
//  It loads js/flow-core.js on demand (the core needs window.SalesFlow, js/sales-flow-core.js, eager).
//
//  Screens (Production, flow-2 jobs only — flowVersion >= 2; NO pesos anywhere on them):
//    • Client acceptance — upload the signed acceptance (window.Drive.renderUploadArea), who signed, the date.
//      Writes job_projects.acceptance { url, name, signedBy, date, by, byName, at }.
//    • Punch list — add / edit / tick items { text, location, raisedDate, done, doneDate, by }; "Mark all cleared" writes
//      punchList.clearedAt / clearedBy. Editing a cleared list takes the "cleared" mark off again (an item added after clearing must be cleared too).
//    Field shapes are the ones js/forms-core.js reads for the punch_list and client_acceptance forms, so those forms print filled.
//
//  closeIfSettled(projectId, who) — J9. Re-reads the job INSIDE a transaction and closes it (FlowCore.planClose) only when FlowCore.shouldClose
//  says so, so two writers racing close it once and Neil hears once. Best-effort by contract: it never throws and never undoes the write that
//  called it. Flow-2 jobs only; a legacy job is left exactly as it was.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  // firebase-config.js declares `const db` at top level: a global binding every classic script can read, but NOT window.db (undefined in the real app).
  const fsDb = function () { return (typeof db !== 'undefined' && db) || window.db; };

  const esc = function (s) { return window.escHtml ? window.escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const toast = function (m, t) { try { window.Notifs.showToast(m, t || 'info'); } catch (_) {} };
  const FV = function () { return window.firebase.firestore.FieldValue; };
  const BTN = 'min-height:44px';
  const FIELD = 'padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text);min-height:44px;font-family:inherit';

  function whoName() { return (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || ''; }
  function myUid() { return (window.currentUser && window.currentUser.uid) || ''; }
  function isFlow2(p) { return !!p && Number(p.flowVersion) >= 2; }
  function canEdit() { return typeof window.canEditDept === 'function' && window.canEditDept('Production'); }
  // The turnover paperwork is open while the job is on its way out and until it closes.
  const DOC_STAGES = ['for_delivery', 'delivered', 'completed'];

  async function loadCore() {
    await window.ensureScript('js/flow-core.js');
    if (!window.FlowCore) throw new Error('The flow engine did not load.');
  }
  async function readProject(id) {
    const s = await fsDb().collection('job_projects').doc(id).get();
    return s.exists ? Object.assign({ id: s.id }, s.data()) : null;
  }
  function invalidate() { try { if (typeof window.dbCacheInvalidate === 'function') window.dbCacheInvalidate('job_projects'); } catch (_) {} }
  const jobLabel = function (p) { return (p && (p.projectNo || p.joNumber)) || 'the job'; };

  // ── J9: close the job when it is settled ──────────────────────────────────────────────────────────────────────────
  // Resolves true only when THIS call closed the job. Called after every write that can make FlowCore.shouldClose true.
  async function closeIfSettled(projectId, who) {
    try {
      if (!projectId) return false;
      await loadCore();
      const ref = fsDb().collection('job_projects').doc(projectId);
      const nowIso = new Date().toISOString();
      let closed = null;
      await fsDb().runTransaction(async function (tx) {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const pj = snap.data();
        if (!isFlow2(pj)) return;
        const plan = window.FlowCore.planClose(pj, { nowIso: nowIso, who: who || whoName() });
        if (!plan) return;
        tx.update(ref, Object.assign({}, plan.fields, { updatedAt: FV().serverTimestamp(), timeline: FV().arrayUnion(plan.timelineEvent) }));
        closed = pj;
      });
      if (!closed) return false;
      invalidate();
      try { if (window.logAudit) window.logAudit('update', 'project', projectId, { stage: 'paid', autoClosed: true }); } catch (_) {}
      try {
        await window.Notifs.sendToOwner({ title: '✅ Job closed — ' + jobLabel(closed) + ' · ' + (closed.clientName || ''), body: 'The client accepted the work and the job is fully paid, so it closed by itself.', icon: '✅', type: 'project_paid', link: 'projects-lifecycle', dedupKey: 'jobclosed-' + projectId });
      } catch (_) {}
      return true;
    } catch (e) { try { console.warn('[flow] close check failed', e); } catch (_) {} return false; }
  }

  // ── writers (the sheets are thin around these) ───────────────────────────────────────────────────────────────────
  // saveAcceptance(projectId, { url, name, signedBy, date }) -> { ok, code?, message? }
  async function saveAcceptance(projectId, a) {
    a = a || {};
    const url = String(a.url || '').trim(), signedBy = String(a.signedBy || '').trim(), date = String(a.date || '').trim();
    if (!url) return { ok: false, code: 'no-file', message: 'Attach the signed acceptance (a photo or PDF).' };
    if (!signedBy) return { ok: false, code: 'no-signer', message: 'Enter who signed for the client.' };
    if (!date) return { ok: false, code: 'no-date', message: 'Enter the date of the acceptance.' };
    const p = await readProject(projectId);
    if (!p) return { ok: false, code: 'no-job', message: 'This job no longer exists.' };
    if (!isFlow2(p)) return { ok: false, code: 'legacy', message: 'This screen is for jobs created through the new sales flow.' };
    if (p.stage === 'paid' || p.stage === 'cancelled') return { ok: false, code: 'closed', message: 'The job is closed.' };
    const who = whoName(), nowIso = new Date().toISOString();
    const acceptance = { url: url, name: String(a.name || '').trim() || null, signedBy: signedBy, date: date, by: myUid(), byName: who, at: nowIso };
    await fsDb().collection('job_projects').doc(projectId).update({
      acceptance: acceptance, updatedAt: FV().serverTimestamp(),
      timeline: FV().arrayUnion({ at: nowIso, event: 'Client acceptance attached — signed by ' + signedBy, by: who }),
    });
    invalidate();
    try { if (window.logAudit) window.logAudit('update', 'project', projectId, { acceptanceAttached: true }); } catch (_) {}
    return { ok: true, acceptance: acceptance };
  }

  // Normalises one row. Existing rows keep who raised them and when; a row newly ticked gets today's date, a row un-ticked loses it.
  function cleanItems(items, prev, who, today) {
    const old = Array.isArray(prev) ? prev : [];
    return (Array.isArray(items) ? items : []).map(function (x, i) {
      const text = String((x && (x.text || x.note)) || '').trim();
      if (!text) return null;
      const was = old[i] || {};
      const done = !!(x && x.done);
      const row = { text: text, location: String((x && x.location) || '').trim(), raisedDate: (x && x.raisedDate) || was.raisedDate || today, done: done, by: (x && x.by) || was.by || who };
      if (done) row.doneDate = (x && x.doneDate) || was.doneDate || today;
      return row;
    }).filter(Boolean);
  }
  // savePunchList(projectId, items, { clear }) -> { ok, code?, message?, items }. clear: tick every item and write clearedAt / clearedBy.
  async function savePunchList(projectId, items, opts) {
    opts = opts || {};
    const p = await readProject(projectId);
    if (!p) return { ok: false, code: 'no-job', message: 'This job no longer exists.' };
    if (!isFlow2(p)) return { ok: false, code: 'legacy', message: 'This screen is for jobs created through the new sales flow.' };
    if (p.stage === 'paid' || p.stage === 'cancelled') return { ok: false, code: 'closed', message: 'The job is closed.' };
    const who = whoName(), nowIso = new Date().toISOString(), today = (window.today && window.today()) || nowIso.slice(0, 10);
    const prev = p.punchList && !Array.isArray(p.punchList) ? p.punchList.items : (Array.isArray(p.punchList) ? p.punchList : []);
    let rows = cleanItems(items, prev, who, today);
    if (opts.clear) rows = rows.map(function (r) { return Object.assign({}, r, { done: true, doneDate: r.doneDate || today }); });
    const punchList = { items: rows };
    if (opts.clear) { punchList.clearedAt = nowIso; punchList.clearedBy = who; }
    await fsDb().collection('job_projects').doc(projectId).update({
      punchList: punchList, updatedAt: FV().serverTimestamp(),
      timeline: FV().arrayUnion({ at: nowIso, event: opts.clear ? 'Punch list cleared' : 'Punch list updated', by: who }),
    });
    invalidate();
    try { if (window.logAudit) window.logAudit('update', 'project', projectId, { punchList: opts.clear ? 'cleared' : 'updated', items: rows.length }); } catch (_) {}
    return { ok: true, items: rows, cleared: !!opts.clear };
  }

  // ── Client acceptance sheet ──────────────────────────────────────────────────────────────────────────────────────
  async function openAcceptance(project, onDone) {
    if (!canEdit()) { toast('Only Production can attach the client acceptance.', 'error'); return; }
    let p;
    try { p = (await readProject(project.id)) || project; } catch (_) { p = project; }
    if (!isFlow2(p)) { toast('This screen is for jobs created through the new sales flow.', 'error'); return; }
    const a = (p.acceptance && typeof p.acceptance === 'object') ? p.acceptance : {};
    let file = a.url ? { url: a.url, name: a.name || '' } : null;
    const body =
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Upload the client acceptance form once the client has signed it. Print it from the job (Client acceptance form).</div>' +
      (a.url ? '<div style="margin-bottom:10px;font-size:12px">Attached: <a target="_blank" rel="noopener" href="' + esc(window.safeHttpUrl ? window.safeHttpUrl(a.url) : a.url) + '">' + esc(a.name || 'signed acceptance') + '</a>. Upload again to replace it.</div>' : '') +
      '<div id="fa-upload" style="margin-bottom:12px"></div>' +
      '<div class="form-group"><label>Signed by (client)</label><input id="fa-signer" type="text" autocomplete="off" style="' + FIELD + '" value="' + esc(a.signedBy || '') + '"></div>' +
      '<div class="form-group"><label>Date of acceptance</label><input id="fa-date" type="date" style="' + FIELD + '" value="' + esc(a.date || (window.today ? window.today() : '')) + '"></div>' +
      '<div id="fa-err" class="error-msg hidden"></div>';
    const footer = '<button class="btn-primary" id="fa-save" style="' + BTN + '">Save acceptance</button><button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Cancel</button>';
    const panel = window.openPage('Client acceptance — ' + esc(p.clientName || ''), body, footer);
    const $ = function (id) { return panel.querySelector('#' + id); };
    if (window.Drive && window.Drive.renderUploadArea) window.Drive.renderUploadArea('fa-upload', function (r) { file = r; }, { label: 'Upload signed acceptance (photo/PDF)', accept: 'image/*,.pdf', dept: 'Production', subfolder: 'Acceptance' });
    $('fa-save').addEventListener('click', function () {
      return window.busy($('fa-save'), async function () {
        const err = $('fa-err');
        const fail = function (m) { err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        if (parseInt($('fa-upload') && $('fa-upload').dataset && $('fa-upload').dataset.busy, 10) > 0) { toast('Wait for the upload to finish', 'error'); return; }
        try {
          const res = await saveAcceptance(p.id, { url: file && file.url, name: file && file.name, signedBy: $('fa-signer').value, date: $('fa-date').value });
          if (!res.ok) { fail(res.message); return; }
          window.closeModal();
          toast('Client acceptance saved', 'success');
          if (onDone) onDone();
        } catch (ex) { fail('Failed: ' + (ex.message || ex.code)); }
      });
    });
  }

  // ── Punch list sheet ─────────────────────────────────────────────────────────────────────────────────────────────
  async function openPunchList(project, onDone) {
    if (!canEdit()) { toast('Only Production can edit the punch list.', 'error'); return; }
    let p;
    try { p = (await readProject(project.id)) || project; } catch (_) { p = project; }
    if (!isFlow2(p)) { toast('This screen is for jobs created through the new sales flow.', 'error'); return; }
    const pl = p.punchList && !Array.isArray(p.punchList) ? p.punchList : { items: Array.isArray(p.punchList) ? p.punchList : [] };
    let items = (Array.isArray(pl.items) ? pl.items : []).map(function (x) { return Object.assign({}, x); });
    const footer = '<button class="btn-primary" id="pl-save" style="' + BTN + '">Save</button><button class="btn-success" id="pl-clear" style="' + BTN + '">Mark all cleared</button><button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Close</button>';
    const panel = window.openPage('Punch list — ' + esc(p.clientName || ''), '<div id="pl-body"></div>', footer);
    const $ = function (id) { return panel.querySelector('#' + id); };
    const host = $('pl-body');
    // Keeps what the person typed in the rows before every repaint (add / remove must not lose an edit).
    const harvest = function () {
      items = items.map(function (it, i) {
        const t = panel.querySelector('#pl-text-' + i), l = panel.querySelector('#pl-loc-' + i), d = panel.querySelector('#pl-done-' + i);
        return Object.assign({}, it, t ? { text: t.value } : {}, l ? { location: l.value } : {}, d ? { done: !!d.checked } : {});
      });
    };
    const paint = function () {
      host.innerHTML =
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">List what the client wants fixed or finished. Tick an item when it is done. When every item is done, press Mark all cleared. A list with no items also needs Mark all cleared before the job can be completed.</div>' +
        (pl.clearedAt && items.every(function (x) { return x.done; }) ? '<div class="badge badge-green" style="margin-bottom:10px">Cleared</div>' : '') +
        items.map(function (it, i) {
          return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
            '<input type="checkbox" id="pl-done-' + i + '" ' + (it.done ? 'checked ' : '') + 'style="width:22px;height:22px;flex:none">' +
            '<input id="pl-text-' + i + '" type="text" placeholder="What needs doing" style="' + FIELD + ';flex:2" value="' + esc(it.text || '') + '">' +
            '<input id="pl-loc-' + i + '" type="text" placeholder="Where" style="' + FIELD + ';flex:1" value="' + esc(it.location || '') + '">' +
            '<button type="button" class="btn-secondary btn-sm pl-rm" data-i="' + i + '" style="' + BTN + '" aria-label="Remove item">✕</button></div>';
        }).join('') +
        '<button type="button" class="btn-secondary" id="pl-add" style="' + BTN + ';margin-top:4px">+ Add item</button>' +
        '<div id="pl-err" class="error-msg hidden" style="margin-top:8px"></div>';
      const add = panel.querySelector('#pl-add');
      if (add) add.addEventListener('click', function () { harvest(); items.push({ text: '', location: '', done: false }); paint(); });
      Array.prototype.forEach.call(panel.querySelectorAll('.pl-rm') || [], function (b) { b.addEventListener('click', function () { harvest(); items.splice(Number(b.dataset.i), 1); paint(); }); });
    };
    paint();
    const run = function (btn, clear) {
      return window.busy(btn, async function () {
        harvest();
        const err = panel.querySelector('#pl-err');
        const fail = function (m) { if (err) { err.textContent = m; err.classList.remove('hidden'); } else toast(m, 'error'); };
        try {
          const res = await savePunchList(p.id, items, { clear: clear });
          if (!res.ok) { fail(res.message); return; }
          window.closeModal();
          toast(clear ? 'Punch list cleared' : 'Punch list saved', 'success');
          if (onDone) onDone();
        } catch (ex) { fail('Failed: ' + (ex.message || ex.code)); }
      });
    };
    $('pl-save').addEventListener('click', function () { return run($('pl-save'), false); });
    $('pl-clear').addEventListener('click', function () { return run($('pl-clear'), true); });
  }

  // ── the job-detail block: where each screen is reached from ───────────────────────────────────────────────────────
  // host: #jpd-flowdocs in the job detail panel. Silent for a legacy job or a stage the paperwork does not apply to.
  async function renderJobDocs(host, project, repaint) {
    if (!host || !isFlow2(project) || DOC_STAGES.indexOf(project.stage) < 0) return;
    try { await loadCore(); } catch (_) { return; }
    const FC = window.FlowCore;
    const a = (project.acceptance && typeof project.acceptance === 'object') ? project.acceptance : null;
    const pl = project.punchList && !Array.isArray(project.punchList) ? project.punchList : null;
    const items = pl && Array.isArray(pl.items) ? pl.items : [];
    const open = items.filter(function (x) { return x && !x.done; }).length;
    const cleared = !!(pl && pl.clearedAt) && open === 0;
    const editable = canEdit();
    const accLine = a && a.url ? 'Signed by ' + esc(a.signedBy || '') + (a.date ? ' on ' + esc(a.date) : '') + '.' : 'Not attached yet.';
    const plLine = cleared ? 'Cleared (' + items.length + ' item' + (items.length === 1 ? '' : 's') + ').' : (items.length ? open + ' of ' + items.length + ' still open.' : 'Not cleared yet.');
    host.innerHTML =
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">Turnover</div>' +
      '<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px;font-size:12px">' +
      '<div style="margin-bottom:8px"><strong>Client acceptance</strong> — ' + accLine + (editable ? ' <button type="button" class="btn-secondary btn-sm fd-acc" style="' + BTN + '">' + (a && a.url ? 'Replace' : 'Attach') + '</button>' : '') + '</div>' +
      '<div><strong>Punch list</strong> — ' + plLine + (editable ? ' <button type="button" class="btn-secondary btn-sm fd-pl" style="' + BTN + '">Open</button>' : '') + '</div>' +
      (FC.canComplete(project) ? '' : '<div style="margin-top:8px;color:var(--text-muted)">Both are needed before the job can be marked Completed.</div>') +
      '</div></div>';
    const again = function () { if (repaint) repaint(); };
    const b1 = host.querySelector('.fd-acc'), b2 = host.querySelector('.fd-pl');
    if (b1) b1.addEventListener('click', function () { return openAcceptance(project, again); });
    if (b2) b2.addEventListener('click', function () { return openPunchList(project, again); });
  }

  // ── the J8 refusal: what is missing, with a button to each screen ──────────────────────────────────────────────────
  // blockers = FlowCore.completeBlockers(project). Opens a small page; each button opens the matching sheet.
  function showCompleteBlocked(project, blockers, onDone) {
    const need = [];
    if (blockers.indexOf('acceptance') >= 0) need.push('the signed client acceptance (upload it, with who signed and the date)');
    if (blockers.indexOf('punch_list') >= 0) need.push('the punch list marked cleared (even with no items, press Mark all cleared)');
    const body = '<div style="font-size:13px">This job cannot be marked Completed yet. Still needed: ' + need.map(esc).join('; and ') + '.</div><div id="fb-err" class="error-msg hidden"></div>';
    const footer =
      (blockers.indexOf('acceptance') >= 0 ? '<button class="btn-primary" id="fb-acc" style="' + BTN + '">Client acceptance</button>' : '') +
      (blockers.indexOf('punch_list') >= 0 ? '<button class="btn-primary" id="fb-pl" style="' + BTN + '">Punch list</button>' : '') +
      '<button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Close</button>';
    const panel = window.openPage('Not ready to complete — ' + esc(project.clientName || ''), body, footer);
    const acc = panel.querySelector('#fb-acc'), pl = panel.querySelector('#fb-pl');
    if (acc) acc.addEventListener('click', function () { return openAcceptance(project, onDone); });
    if (pl) pl.addEventListener('click', function () { return openPunchList(project, onDone); });
    return panel;
  }

  window.FlowDocs = {
    closeIfSettled: closeIfSettled,
    saveAcceptance: saveAcceptance,
    savePunchList: savePunchList,
    openAcceptance: openAcceptance,
    openPunchList: openPunchList,
    renderJobDocs: renderJobDocs,
    showCompleteBlocked: showCompleteBlocked,
  };
})();
