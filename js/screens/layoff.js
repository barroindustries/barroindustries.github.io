/* ═══════════════════════════════════════════════════
   LAYOFF (LAYOFF-SPEC 2026-08-19) — js/screens/layoff.js
   - window.canLayoffAdmin()            write-authority predicate
   - window.LayoffSvc                   place/lift/claim/decide/pay/file-request service
   - window.renderLayoffDashboard()     the laid-off employee's whole dashboard
   - window.renderLayoffAdmin()         HR hub screen (list + place + history)
   - window.openLayoffDetail(layoff)    HR per-employee detail (SoA + file requests)
   Collections: layoffs, layoff_expenses, layoff_file_requests (+ the
   users/{uid}.layoff pointer). See LAYOFF-SPEC.md — implemented verbatim.

   Parcel B — single owner of this file. Everything else (nav/router lockdown,
   dashboard dispatch, HR entry card, chat scope, notification metadata,
   status-badge domains, firestore.rules) is other parcels' work, reached only
   through runtime window.* lookups here so a partial landing never throws.
═══════════════════════════════════════════════════ */

(function () {

  // ── §3.2 write-authority predicate ──────────────────────────────────────
  // Ruling 2 (2026-08-19): HR-department members plus President/Manager place
  // and lift layoffs — no approval step. Mirrors firestore.rules' write gate
  // (isSeniorAdmin() || isHrDept()). Deliberately NARROWER than isHrPriv()
  // (js/screens/hr.js) — secretary/finance keep SIGHT via canHrView-backed
  // reads but never the pen. Partners are excluded outright.
  window.canLayoffAdmin = function () {
    const role = window.currentRole || '';
    if (role === 'partner') return false;
    return ['president', 'manager'].includes(role)
        || (window.currentDepts || []).includes('HR');
  };

  // ── Shared small helpers (private to this file) ─────────────────────────
  function actorUid() { return (window.currentUser && window.currentUser.uid) || null; }
  function actorName() {
    return (window.userProfile && window.userProfile.displayName)
        || (window.currentUser && window.currentUser.email) || '';
  }
  function money(n) { return window.fmtPeso ? window.fmtPeso(n) : ('₱' + (Number(n) || 0).toFixed(2)); }
  function fv() { return firebase.firestore.FieldValue; }

  // ── §3.3 LayoffSvc — service layer ───────────────────────────────────────
  // All writes are called by callers wrapped in window.busy(btn, fn). Every
  // function throws on failure; callers toast err.message||err.code. Every
  // mutation calls window.logAudit(...) after the write per the spec.
  window.LayoffSvc = {

    // Sum peso amounts without float drift: accumulate in integer centavos.
    sumPesos(nums) {
      return (nums || []).reduce((s, n) => s + Math.round((Number(n) || 0) * 100), 0) / 100;
    },

    // ── place — HR puts an employee on layoff, effective immediately ──────
    async place({ uid, userName, employeeId, reason, effectiveDate } = {}) {
      if (!uid) throw new Error('Select an employee.');
      const reasonTrimmed = (reason || '').trim();
      if (!reasonTrimmed) throw new Error('A reason is required — the employee will see this word-for-word.');
      if (reasonTrimmed.length > 2000) throw new Error('Reason is too long (max 2000 characters).');
      const eff = effectiveDate || today();

      // Guard read — mirrors the rules-side refusals so the employee gets a
      // clear message instead of a raw PERMISSION_DENIED.
      const uref = db.collection('users').doc(uid);
      const usnap = await uref.get();
      const udata = usnap.exists ? (usnap.data() || {}) : {};
      if (udata.layoff && udata.layoff.active === true) throw new Error('This person is already on layoff.');
      if (udata.removed === true) throw new Error('This person is removed from the system.');
      if (udata.role === 'president') throw new Error('The president cannot be placed on layoff.');

      const by = actorUid(), byName = actorName();
      const ref = db.collection('layoffs').doc();
      const batch = db.batch();
      batch.set(ref, {
        uid, userName: userName || udata.displayName || '', employeeId: employeeId || udata.employeeId || '',
        reason: reasonTrimmed, status: 'active', effectiveDate: eff,
        placedBy: by, placedByName: byName,
        createdAt: fv().serverTimestamp(),
        liftedAt: null, liftedBy: null, liftedByName: null, liftNote: null
      });
      // Two different rule branches (layoffs create + the users hasOnly(['layoff'])
      // branch), both allowed for HR-tier — the batch commits atomically.
      batch.update(uref, { layoff: { active: true, id: ref.id, reason: reasonTrimmed, at: eff, byName } });
      await batch.commit();

      if (window.dbCacheInvalidate) window.dbCacheInvalidate('users');

      await Notifs.send(uid, {
        title: '🔒 You have been placed on layoff',
        body: 'Reason: ' + reasonTrimmed.slice(0, 180) + ' — open your dashboard for your statement of account.',
        icon: '🔒', type: 'layoff_placed', link: 'dashboard', dedupKey: 'layoff-placed-' + ref.id
      });
      window.logAudit && window.logAudit('layoff_place', 'layoff', ref.id, { uid, userName, effectiveDate: eff });
      return ref.id;
    },

    // ── lift — HR restores full access; history is retained ───────────────
    // confirmDialog is the CALLER's job — this just writes.
    async lift(layoff, { liftNote } = {}) {
      const by = actorUid(), byName = actorName();
      const batch = db.batch();
      batch.update(db.collection('layoffs').doc(layoff.id), {
        status: 'lifted', liftedAt: fv().serverTimestamp(),
        liftedBy: by, liftedByName: byName, liftNote: liftNote || ''
      });
      batch.update(db.collection('users').doc(layoff.uid), { layoff: null });
      await batch.commit();

      if (window.dbCacheInvalidate) window.dbCacheInvalidate('users');

      await Notifs.send(layoff.uid, {
        title: '✅ Your layoff has been lifted',
        body: 'Welcome back — your full access is restored.',
        icon: '✅', type: 'layoff_lifted', link: 'dashboard', dedupKey: 'layoff-lifted-' + layoff.id
      });
      window.logAudit && window.logAudit('layoff_lift', 'layoff', layoff.id, { uid: layoff.uid });
    },

    // ── submitClaim — employee files a Statement-of-Account line ──────────
    // `receipt` is the Drive.renderUploadArea result object, or null.
    async submitClaim({ layoffId, description, amount, expenseDate, receipt } = {}) {
      const desc = (description || '').trim();
      if (!desc) throw new Error('Description is required.');
      if (desc.length > 1000) throw new Error('Description is too long (max 1000 characters).');
      const amt = Math.round((Number(amount) || 0) * 100) / 100;
      if (!Number.isFinite(amt) || amt < 0) throw new Error('Enter a valid amount.');
      const expDate = expenseDate || today();
      const uid = actorUid(), userName = actorName();

      const ref = await db.collection('layoff_expenses').add({
        layoffId, uid, userName, description: desc, amount: amt, expenseDate: expDate,
        receiptUrl: receipt ? ((window.Drive && window.Drive.resolveUrl(receipt)) || null) : null,
        receiptName: receipt ? (receipt.name || null) : null,
        receiptKind: receipt ? (receipt.source === 'link' ? 'link' : 'file') : null,
        status: 'pending', approvedAmount: null, hrNote: null,
        decidedAt: null, decidedBy: null, decidedByName: null,
        paidAt: null, paidDate: null, paidBy: null, paidByName: null, paidMethod: null,
        createdAt: fv().serverTimestamp(), updatedAt: fv().serverTimestamp()
      });

      await Notifs.sendToDept('HR', {
        title: '🧾 Layoff expense claim',
        body: userName + ' claims ' + money(amt) + ' — ' + desc.slice(0, 120),
        icon: '🧾', type: 'layoff_expense', link: 'dept:HR', dedupKey: 'layoff-exp-' + ref.id
      }, { fallbackToOwner: true });
      window.logAudit && window.logAudit('create', 'layoff_expense', ref.id, { layoffId, amount: amt });
      return ref.id;
    },

    // ── approveClaim — HR approves (optionally adjusting the amount) ──────
    async approveClaim(claim, { approvedAmount, hrNote } = {}) {
      const amt = (approvedAmount === undefined || approvedAmount === '' || approvedAmount === null)
        ? (Number(claim.amount) || 0)
        : Math.round((Number(approvedAmount) || 0) * 100) / 100;
      if (!Number.isFinite(amt) || amt < 0) throw new Error('Enter a valid approved amount.');
      const by = actorUid(), byName = actorName();
      await db.collection('layoff_expenses').doc(claim.id).update({
        status: 'approved', approvedAmount: amt, hrNote: hrNote || null,
        decidedAt: fv().serverTimestamp(), decidedBy: by, decidedByName: byName,
        updatedAt: fv().serverTimestamp()
      });
      await Notifs.send(claim.uid, {
        title: '✅ Expense approved',
        body: money(amt) + ' approved for: ' + (claim.description || '').slice(0, 120),
        icon: '✅', type: 'layoff_expense_approved', link: 'dashboard', dedupKey: 'layoff-exp-app-' + claim.id
      });
      window.logAudit && window.logAudit('approve', 'layoff_expense', claim.id, { amount: claim.amount, approvedAmount: amt });
    },

    // ── rejectClaim — hrNote is REQUIRED; the employee must see why ───────
    async rejectClaim(claim, { hrNote } = {}) {
      const note = (hrNote || '').trim();
      if (!note) throw new Error('A reason is required so the employee understands why.');
      const by = actorUid(), byName = actorName();
      await db.collection('layoff_expenses').doc(claim.id).update({
        status: 'rejected', approvedAmount: null, hrNote: note,
        decidedAt: fv().serverTimestamp(), decidedBy: by, decidedByName: byName,
        updatedAt: fv().serverTimestamp()
      });
      await Notifs.send(claim.uid, {
        title: '❌ Expense rejected',
        body: (claim.description || '').slice(0, 100) + ' — ' + note.slice(0, 120),
        icon: '❌', type: 'layoff_expense_rejected', link: 'dashboard', dedupKey: 'layoff-exp-rej-' + claim.id
      });
      window.logAudit && window.logAudit('reject', 'layoff_expense', claim.id, {});
    },

    // ── markPaid — only valid from 'approved' (rules enforce too) ─────────
    async markPaid(claim, { paidDate, paidMethod } = {}) {
      if (claim.status !== 'approved') throw new Error('Only an approved claim can be marked paid.');
      const by = actorUid(), byName = actorName();
      await db.collection('layoff_expenses').doc(claim.id).update({
        status: 'paid', paidAt: fv().serverTimestamp(),
        paidDate: paidDate || today(), paidBy: by, paidByName: byName,
        paidMethod: paidMethod || null, updatedAt: fv().serverTimestamp()
      });
      await Notifs.send(claim.uid, {
        title: '💰 Reimbursement paid',
        body: money(claim.approvedAmount) + ' paid' + (paidMethod ? ' via ' + paidMethod : '') + ' for: ' + (claim.description || '').slice(0, 100),
        icon: '💰', type: 'layoff_expense_paid', link: 'dashboard', dedupKey: 'layoff-exp-paid-' + claim.id
      });
      window.logAudit && window.logAudit('pay', 'layoff_expense', claim.id, { approvedAmount: claim.approvedAmount });
    },

    // ── createFileRequest — HR asks the employee for a document ───────────
    async createFileRequest({ layoffId, uid, userName, description, dueDate, allowLink } = {}) {
      const desc = (description || '').trim();
      if (!desc) throw new Error('Description is required.');
      if (desc.length > 1000) throw new Error('Description is too long (max 1000 characters).');
      const by = actorUid(), byName = actorName();
      const ref = await db.collection('layoff_file_requests').add({
        layoffId, uid, userName: userName || '', description: desc,
        dueDate: dueDate || null, allowLink: allowLink !== false,
        status: 'open', createdAt: fv().serverTimestamp(),
        createdBy: by, createdByName: byName,
        fulfilledAt: null, hubFileId: null, fileUrl: null, fileName: null, fileKind: null,
        updatedAt: fv().serverTimestamp()
      });
      await Notifs.send(uid, {
        title: '📎 HR requested a document',
        body: desc.slice(0, 150) + (dueDate ? ' · due ' + dueDate : ''),
        icon: '📎', type: 'layoff_file_request', link: 'dashboard', dedupKey: 'layoff-req-' + ref.id
      });
      window.logAudit && window.logAudit('create', 'layoff_file_request', ref.id, { uid, description: desc.slice(0, 80) });
      return ref.id;
    },

    // ── fulfilRequest — employee delivers; also lands in the Files Hub ─────
    // Two writes, sequential: if the hub_files write throws, abort — the
    // request stays open (§3.3).
    async fulfilRequest(req, uploadResult, file) {
      const FV = fv(), nowIso = new Date().toISOString();
      // WS38 Spec-1 shape, verbatim (js/departments.js:1353-1366) — see
      // LAYOFF-SPEC §6.3. visibility:'private' + an explicit share to the HR
      // tier, expanded to uids now (the FilesHub.share precedent, js/drive.js
      // — dept/role targets are always expanded client-side because rules
      // prove sharing with uid arrays only).
      const usersSnap = await (window.dbCachedGet
        ? window.dbCachedGet('users', () => db.collection('users').get(), 30000)
        : db.collection('users').get());
      const hrUids = (usersSnap.docs || []).map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.role !== 'partner' && (
          ['president', 'manager'].includes(u.role) ||
          u.department === 'HR' || (u.departments || []).includes('HR')))
        .map(u => u.id);

      const hubRef = await db.collection('hub_files').add({
        name: uploadResult.name, description: ('Layoff document — ' + (req.description || '')).slice(0, 300),
        fileType: 'Other',
        kind: uploadResult.source === 'link' ? 'link' : 'file',
        scope: 'hr_layoff', department: 'HR', folderId: null,
        url: uploadResult.url, driveUrl: null,
        size: (file && file.size) || null, contentType: (file && file.type) || null,
        source: uploadResult.source || 'firebase', currentV: 1,
        versions: [{
          v: 1, url: uploadResult.url, name: uploadResult.name, size: (file && file.size) || null,
          contentType: (file && file.type) || null, note: '', by: currentUser.uid,
          byName: (userProfile && userProfile.displayName) || currentUser.email, at: nowIso
        }],
        archived: false, deleted: false, deletedAt: null, deletedBy: null,
        visibility: 'private',
        sharedUserIds: hrUids, editorUserIds: [],
        shares: [{
          type: 'role', id: 'hr-tier', label: 'HR & Management', perm: 'view',
          by: currentUser.uid, byName: (userProfile && userProfile.displayName) || currentUser.email, at: nowIso
        }],
        uploadedBy: currentUser.uid, uploaderName: (userProfile && userProfile.displayName) || currentUser.email,
        createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
      });

      await db.collection('layoff_file_requests').doc(req.id).update({
        status: 'fulfilled', fulfilledAt: FV.serverTimestamp(), hubFileId: hubRef.id,
        fileUrl: (window.Drive && window.Drive.resolveUrl(uploadResult)) || null,
        fileName: uploadResult.name || null,
        fileKind: uploadResult.source === 'link' ? 'link' : 'file',
        updatedAt: FV.serverTimestamp()
      });

      await Notifs.sendToDept('HR', {
        title: '📥 Layoff document received',
        body: (req.userName || '') + ' sent: ' + (uploadResult.name || req.description || '').slice(0, 120),
        icon: '📥', type: 'layoff_file_fulfilled', link: 'dept:HR', dedupKey: 'layoff-req-done-' + req.id
      }, { fallbackToOwner: true });
      window.logAudit && window.logAudit('fulfil', 'layoff_file_request', req.id, {});
    }
  };

  // ── §3.4 window.renderLayoffDashboard() — the laid-off employee's screen ─
  // Paints #page-content (a dashboard, not an overlay).
  window.renderLayoffDashboard = async function () {
    const c = document.getElementById('page-content');
    if (!c) return;
    c.innerHTML = window.skeletonHtml ? window.skeletonHtml('cards') : '';

    const L = (window.userProfile && window.userProfile.layoff) || null;
    if (!L || L.active !== true) {
      // Defensive — the profile says this user is not (or no longer) laid
      // off; bounce to the real dashboard instead of showing a stale view.
      if (typeof navigateTo === 'function') navigateTo('dashboard', { replace: true });
      return;
    }

    const uid = currentUser.uid;
    const [expSnap, reqSnap] = await Promise.all([
      db.collection('layoff_expenses').where('uid', '==', uid).where('layoffId', '==', L.id).get().catch(() => ({ docs: [] })),
      db.collection('layoff_file_requests').where('uid', '==', uid).where('layoffId', '==', L.id).get().catch(() => ({ docs: [] }))
    ]);
    const expenses = expSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const requests = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    const Svc = window.LayoffSvc;
    const pendingTotal = Svc.sumPesos(expenses.filter(x => x.status === 'pending').map(x => x.amount));
    const owedTotal = Svc.sumPesos(expenses.filter(x => x.status === 'approved').map(x => x.approvedAmount));
    const paidTotal = Svc.sumPesos(expenses.filter(x => x.status === 'paid').map(x => x.approvedAmount));
    const claimedTotal = Svc.sumPesos(expenses.filter(x => x.status !== 'rejected').map(x => x.amount));

    const badge = (domain, id) => window.statusBadge2 ? window.statusBadge2(domain, id) : '';
    const tile = (name, a, b) => window.iconTile ? window.iconTile(name, a, b, 28) : '';

    function expenseRow(x) {
      const approvedDiffers = (x.status === 'approved' || x.status === 'paid')
        && x.approvedAmount != null && Number(x.approvedAmount) !== Number(x.amount);
      return `
        <div class="item-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="font-weight:700;font-size:13px">${escHtml(x.description || '')}</div>
            ${badge('layoff_expense', x.status)}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
            ${escHtml(x.expenseDate || '')} · claimed ${money(x.amount)}${
              approvedDiffers ? ` · approved ${money(x.approvedAmount)}` : ''
            }${
              x.status === 'paid' ? ` · paid ${escHtml(x.paidDate || '')}${x.paidMethod ? ` via ${escHtml(x.paidMethod)}` : ''}` : ''
            }
          </div>
          ${x.hrNote ? `<div style="font-size:12px;color:var(--text-muted);font-style:italic;margin-top:2px">HR: ${escHtml(x.hrNote)}</div>` : ''}
          ${x.receiptUrl ? `<a href="${escHtml(safeHttpUrl(x.receiptUrl))}" target="_blank" rel="noopener" class="file-chip" style="margin-top:6px">
              <i data-lucide="${x.receiptKind === 'link' ? 'link-2' : 'file-text'}"></i><span>${escHtml(x.receiptName || 'Receipt')}</span>
            </a>` : ''}
          ${x.status === 'pending' ? `<div style="margin-top:8px;display:flex;gap:8px">
              <button type="button" class="btn-secondary btn-sm lo-exp-edit" data-id="${escHtml(x.id)}">Edit</button>
              <button type="button" class="btn-secondary btn-sm lo-exp-withdraw" data-id="${escHtml(x.id)}">Withdraw</button>
            </div>` : ''}
        </div>`;
    }

    const docsCard = requests.length ? `
      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3>${emojiIcon('📎', 20)} Documents HR asked for</h3></div>
        <div class="card-body">
          ${requests.map(r => `
            <div class="item-card">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div style="font-weight:700;font-size:13px">${escHtml(r.description || '')}</div>
                ${badge('layoff_request', r.status)}
              </div>
              ${r.dueDate ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">Due ${escHtml(r.dueDate)}</div>` : ''}
              ${r.status === 'open'
                ? `<div id="lo-req-up-${r.id}" style="margin-top:8px"></div>`
                : `<a href="${escHtml(safeHttpUrl(r.fileUrl))}" target="_blank" rel="noopener" class="file-chip" style="margin-top:8px">
                     <i data-lucide="${r.fileKind === 'link' ? 'link-2' : 'file-text'}"></i><span>${escHtml(r.fileName || 'Submitted')}</span>
                   </a><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Sent to HR ✓</div>`}
            </div>`).join('')}
        </div>
      </div>` : '';

    c.innerHTML = `
      <div class="page-header"><h2>${emojiIcon('🔒', 20)} Layoff Notice</h2></div>
      <div class="alert-banner alert-danger" style="cursor:default;display:block">
        <span>${emojiIcon('⚠️', 16)} <strong>You are on layoff until further notice</strong>
          · since ${escHtml(L.at || '')}${L.byName ? ` · placed by ${escHtml(L.byName)}` : ''}</span>
        <div style="margin-top:6px;font-size:13px;white-space:pre-wrap">${escHtml(L.reason || '')}</div>
      </div>
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="kpi-card">
          <div class="kpi-card-top"><div class="kpi-label">Submitted</div>${tile('receipt', 'var(--warning)', null)}</div>
          <div class="kpi-value" style="font-size:15px">${money(pendingTotal)}</div>
        </div>
        <div class="kpi-card ${owedTotal > 0 ? 'accent' : ''}">
          <div class="kpi-card-top"><div class="kpi-label">Owed to you</div>${tile('hand-coins', 'var(--primary)', null)}</div>
          <div class="kpi-value" style="font-size:15px">${money(owedTotal)}</div>
        </div>
        <div class="kpi-card green">
          <div class="kpi-card-top"><div class="kpi-label">Paid</div>${tile('check-circle-2', 'var(--success)', null)}</div>
          <div class="kpi-value" style="font-size:15px">${money(paidTotal)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-card-top"><div class="kpi-label">Total claimed</div>${tile('wallet', 'var(--text-muted)', null)}</div>
          <div class="kpi-value" style="font-size:15px">${money(claimedTotal)}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <h3>${emojiIcon('🧾', 20)} Statement of Account</h3>
          <button type="button" class="btn-primary btn-sm" id="lo-add-claim">＋ Add expense</button>
        </div>
        <div class="card-body">
          ${expenses.length ? expenses.map(expenseRow).join('') :
            (window.renderEmptyState ? window.renderEmptyState({ icon: '🧾', title: 'No expense claims yet', hint: 'Add every expense you made that the company should reimburse.' }) : '')}
        </div>
      </div>
      ${docsCard}
      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3>While you are on layoff</h3></div>
        <div class="card-body" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn-primary" id="lo-msg-hr">💬 Message HR</button>
          <button type="button" class="btn-secondary" id="lo-my-payslips">🧾 My payslips</button>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [c] });

    const rerender = () => window.renderLayoffDashboard();

    // ── Add / edit expense form — the openPage idiom (CashAdvance.openRequestForm) ─
    function openClaimForm(existing) {
      let pendingReceipt = null;
      const isEdit = !!existing;
      const panel = openPage(isEdit ? 'Edit expense' : 'Add expense', `
        <div class="form-group"><label>Description</label>
          <textarea id="lo-claim-desc" rows="3" placeholder="What was the expense for?">${isEdit ? escHtml(existing.description || '') : ''}</textarea>
        </div>
        <div class="form-group"><label>Amount (₱)</label>
          <input id="lo-claim-amt" type="number" min="0" step="0.01" value="${isEdit ? Number(existing.amount || 0) : ''}"/>
        </div>
        <div class="form-group"><label>Date</label>
          <input id="lo-claim-date" type="date" value="${isEdit ? escHtml(existing.expenseDate || today()) : today()}"/>
        </div>
        <div class="form-group"><label>Receipt (optional)</label>
          <div id="lo-claim-up"></div>
          ${isEdit && existing.receiptUrl ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px">Current: ${escHtml(existing.receiptName || 'Receipt')} — uploading a new one replaces it.</div>` : ''}
        </div>
      `, `<button type="button" class="btn-primary" id="lo-claim-submit">${isEdit ? 'Save changes' : 'Submit'}</button><button type="button" class="btn-secondary" id="lo-claim-cancel">Cancel</button>`);

      // ⚠ SCOPED TO THIS PANEL — openPage keeps a closing panel alive ~300ms.
      const $ = (id) => panel.querySelector('#' + id);
      Drive.renderUploadArea('lo-claim-up', (result) => { pendingReceipt = result; },
        { dept: 'HR', subfolder: 'Layoff Receipts', allowLinks: true, label: 'Attach receipt (optional)' });
      $('lo-claim-cancel').addEventListener('click', () => closeModal());
      $('lo-claim-submit').addEventListener('click', async (ev) => {
        await window.busy(ev.currentTarget, async () => {
          try {
            const description = $('lo-claim-desc').value;
            const amount = $('lo-claim-amt').value;
            const expenseDate = $('lo-claim-date').value;
            if (isEdit) {
              const desc = (description || '').trim();
              if (!desc) throw new Error('Description is required.');
              const amt = Math.round((Number(amount) || 0) * 100) / 100;
              if (!Number.isFinite(amt) || amt < 0) throw new Error('Enter a valid amount.');
              const upd = { description: desc, amount: amt, expenseDate: expenseDate || today(), updatedAt: fv().serverTimestamp() };
              if (pendingReceipt) {
                upd.receiptUrl = (window.Drive && window.Drive.resolveUrl(pendingReceipt)) || null;
                upd.receiptName = pendingReceipt.name || null;
                upd.receiptKind = pendingReceipt.source === 'link' ? 'link' : 'file';
              }
              await db.collection('layoff_expenses').doc(existing.id).update(upd);
              window.logAudit && window.logAudit('update', 'layoff_expense', existing.id, {});
              Notifs.success('Expense claim updated');
            } else {
              await window.LayoffSvc.submitClaim({ layoffId: L.id, description, amount, expenseDate, receipt: pendingReceipt });
              Notifs.success('Expense claim submitted');
            }
            closeModal();
            rerender();
          } catch (err) {
            Notifs.showToast((isEdit ? 'Could not update: ' : 'Could not submit: ') + (err.message || err.code), 'error');
          }
        });
      });
    }

    c.querySelector('#lo-add-claim')?.addEventListener('click', () => openClaimForm(null));
    c.querySelector('#lo-msg-hr')?.addEventListener('click', () => navigateTo('chat'));
    c.querySelector('#lo-my-payslips')?.addEventListener('click', () => navigateTo('personal-finance'));
    c.querySelectorAll('.lo-exp-edit').forEach(btn => btn.addEventListener('click', () => {
      const claim = expenses.find(x => x.id === btn.dataset.id);
      if (claim) openClaimForm(claim);
    }));
    c.querySelectorAll('.lo-exp-withdraw').forEach(btn => btn.addEventListener('click', async () => {
      const claim = expenses.find(x => x.id === btn.dataset.id);
      if (!claim) return;
      if (!(await confirmDialog({ title: 'Withdraw claim', message: 'Withdraw this expense claim? This cannot be undone.', confirmLabel: 'Withdraw', danger: true }))) return;
      await window.busy(btn, async () => {
        try {
          await db.collection('layoff_expenses').doc(claim.id).delete();
          Notifs.success('Claim withdrawn');
          rerender();
        } catch (e) {
          Notifs.showToast('Could not withdraw: ' + (e.message || e.code), 'error');
        }
      });
    }));
    requests.filter(r => r.status === 'open').forEach(r => {
      Drive.renderUploadArea('lo-req-up-' + r.id, (result, file) => {
        window.LayoffSvc.fulfilRequest(r, result, file)
          .then(() => { Notifs.success('Sent to HR'); rerender(); })
          .catch(e => Notifs.showToast('Could not submit: ' + (e.message || e.code), 'error'));
      }, { dept: 'HR', subfolder: 'Layoff', allowLinks: r.allowLink !== false, label: 'Upload for HR' });
    });
  };

  // ── §3.5 window.renderLayoffAdmin() — HR hub screen ──────────────────────
  window.renderLayoffAdmin = async function () {
    const c = deptContainer();
    if (!c) return;
    if (!(window.isHrPriv && window.isHrPriv())) {
      c.innerHTML = window.renderEmptyState ? window.renderEmptyState({ icon: '🔒', title: 'You do not have access to this page' }) : '';
      if (window.lucide) lucide.createIcons({ nodes: [c] });
      return;
    }
    c.innerHTML = window.skeletonHtml ? window.skeletonHtml('rows') : '';

    const canWrite = !!(window.canLayoffAdmin && window.canLayoffAdmin());
    const [activeSnap, historySnap] = await Promise.all([
      db.collection('layoffs').where('status', '==', 'active').get().catch(() => ({ docs: [] })),
      db.collection('layoffs').where('status', '==', 'lifted').get().catch(() => ({ docs: [] }))
    ]);
    const activeRows = activeSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const historyRows = historySnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.liftedAt?.seconds || b.createdAt?.seconds || 0) - (a.liftedAt?.seconds || a.createdAt?.seconds || 0));

    function rowHtml(x, isHistory) {
      const reasonShort = (x.reason || '').slice(0, 120) + ((x.reason || '').length > 120 ? '…' : '');
      const liftedLabel = x.liftedAt && x.liftedAt.toDate ? x.liftedAt.toDate().toLocaleDateString('en-PH') : '';
      return `
        <div class="item-card lo-row" data-id="${escHtml(x.id)}" style="cursor:pointer">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <div style="font-weight:700;font-size:13px">${escHtml(x.userName || '')}${x.employeeId ? ` <span style="color:var(--text-muted);font-weight:400">· ${escHtml(x.employeeId)}</span>` : ''}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${isHistory ? `lifted ${escHtml(liftedLabel)}` : `since ${escHtml(x.effectiveDate || '')}`}</div>
            </div>
            ${window.statusBadge2 ? window.statusBadge2('layoff', isHistory ? 'lifted' : 'active') : ''}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${escHtml(reasonShort)}</div>
        </div>`;
    }

    c.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h2>${emojiIcon('🔒', 20)} Layoff${canWrite ? '' : ' <span class="badge badge-gray" style="font-size:10px;vertical-align:middle">view only</span>'}</h2>
        ${canWrite ? `<button type="button" class="btn-primary" id="lo-place-btn">＋ Place on layoff</button>` : ''}
      </div>
      <button type="button" class="btn-secondary btn-sm" id="lo-back-hr" style="margin-bottom:12px">← HR</button>
      ${window.sopPanel ? window.sopPanel('How layoff works', [
        'Place staff on layoff with a written reason the employee sees immediately.',
        'While on layoff, the employee files reimbursable expenses (a Statement of Account).',
        'HR approves, adjusts, or rejects each expense line, then marks approved lines paid.',
        'Lift the layoff when they return — the full history is kept.'
      ]) : ''}
      ${window.chipTabs ? window.chipTabs([{ key: 'active', label: 'On Layoff' }, { key: 'history', label: 'History' }], 'active') : ''}
      <div id="lo-pane-active">${activeRows.length ? activeRows.map(x => rowHtml(x, false)).join('') :
        (window.renderEmptyState ? window.renderEmptyState({ icon: '✅', title: 'Nobody is on layoff' }) : '')}</div>
      <div id="lo-pane-history" class="hidden">${historyRows.length ? historyRows.map(x => rowHtml(x, true)).join('') :
        (window.renderEmptyState ? window.renderEmptyState({ icon: '🗂️', title: 'No layoff history yet' }) : '')}</div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [c] });

    if (window.bindChipTabs) {
      window.bindChipTabs(c, (key) => {
        c.querySelector('#lo-pane-active')?.classList.toggle('hidden', key !== 'active');
        c.querySelector('#lo-pane-history')?.classList.toggle('hidden', key !== 'history');
      });
    }
    c.querySelector('#lo-back-hr')?.addEventListener('click', () => window.renderHR && window.renderHR(currentUser, currentRole));
    c.querySelectorAll('.lo-row').forEach(row => row.addEventListener('click', () => {
      const rec = [...activeRows, ...historyRows].find(x => x.id === row.dataset.id);
      if (rec) window.openLayoffDetail(rec);
    }));

    if (canWrite) {
      c.querySelector('#lo-place-btn')?.addEventListener('click', async () => {
        const usersSnap = await (window.dbCachedGet
          ? window.dbCachedGet('users', () => db.collection('users').get(), 30000)
          : db.collection('users').get());
        const eligible = (usersSnap.docs || []).map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.role !== 'partner' && u.role !== 'president' && u.removed !== true && !(u.layoff && u.layoff.active === true));
        const options = eligible.map(u =>
          `<option value="${escHtml(u.id)}">${escHtml((u.displayName || u.email || u.id) + ' — ' + (u.employeeId || u.role || ''))}</option>`
        ).join('');

        const panel = openPage('Place on layoff', `
          <div class="form-group"><label>Employee</label>
            <select id="lo-place-uid" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
              <option value="">Select an employee…</option>
              ${options}
            </select>
          </div>
          <div class="form-group"><label>Reason</label>
            <textarea id="lo-place-reason" rows="4" placeholder="Explain why…"></textarea>
            <p style="font-size:11px;color:var(--text-muted);margin-top:4px">This is shown to the employee word-for-word.</p>
          </div>
          <div class="form-group"><label>Effective date</label>
            <input id="lo-place-date" type="date" value="${today()}"/>
          </div>
        `, `<button type="button" class="btn-primary" id="lo-place-submit">Place on layoff</button><button type="button" class="btn-secondary" id="lo-place-cancel">Cancel</button>`);

        const $ = (id) => panel.querySelector('#' + id);
        $('lo-place-cancel').addEventListener('click', () => closeModal());
        $('lo-place-submit').addEventListener('click', async (ev) => {
          await window.busy(ev.currentTarget, async () => {
            try {
              const uid = $('lo-place-uid').value;
              if (!uid) throw new Error('Select an employee.');
              const uObj = eligible.find(u => u.id === uid) || {};
              const reason = $('lo-place-reason').value;
              const effectiveDate = $('lo-place-date').value;
              await window.LayoffSvc.place({
                uid, userName: uObj.displayName || uObj.email || '', employeeId: uObj.employeeId || '',
                reason, effectiveDate
              });
              closeModal();
              Notifs.success('Placed on layoff');
              window.renderLayoffAdmin();
            } catch (err) {
              Notifs.showToast('Could not place on layoff: ' + (err.message || err.code), 'error');
            }
          });
        });
      });
    }
  };

  // ── §3.6 window.openLayoffDetail(layoff) — HR per-employee detail ────────
  window.openLayoffDetail = async function (layoff) {
    const canWrite = !!(window.canLayoffAdmin && window.canLayoffAdmin());
    const panel = openPage('🔒 ' + (layoff.userName || ''),
      `<div id="lo-detail-body">${window.skeletonHtml ? window.skeletonHtml('rows') : ''}</div>`,
      `<button type="button" class="btn-secondary" id="lo-detail-close">Close</button>`);
    panel.querySelector('#lo-detail-close').addEventListener('click', () => closeModal());

    async function paint() {
      const body = panel.querySelector('#lo-detail-body');
      if (!body) return;

      const [expSnap, reqSnap] = await Promise.all([
        db.collection('layoff_expenses').where('layoffId', '==', layoff.id).get().catch(() => ({ docs: [] })),
        db.collection('layoff_file_requests').where('layoffId', '==', layoff.id).get().catch(() => ({ docs: [] }))
      ]);
      const expenses = expSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      const requests = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      const Svc = window.LayoffSvc;
      const pendingTotal = Svc.sumPesos(expenses.filter(x => x.status === 'pending').map(x => x.amount));
      const owedTotal = Svc.sumPesos(expenses.filter(x => x.status === 'approved').map(x => x.approvedAmount));
      const paidTotal = Svc.sumPesos(expenses.filter(x => x.status === 'paid').map(x => x.approvedAmount));
      const claimedTotal = Svc.sumPesos(expenses.filter(x => x.status !== 'rejected').map(x => x.amount));
      const badge = (domain, id) => window.statusBadge2 ? window.statusBadge2(domain, id) : '';
      const tile = (name, a, b) => window.iconTile ? window.iconTile(name, a, b, 28) : '';

      function expRow(x) {
        const approvedDiffers = (x.status === 'approved' || x.status === 'paid')
          && x.approvedAmount != null && Number(x.approvedAmount) !== Number(x.amount);
        let actions = '';
        if (canWrite) {
          if (x.status === 'pending') actions = `<button type="button" class="btn-primary btn-sm lo-appr" data-id="${escHtml(x.id)}">Approve</button> <button type="button" class="btn-secondary btn-sm lo-rej" data-id="${escHtml(x.id)}">Reject</button>`;
          else if (x.status === 'approved') actions = `<button type="button" class="btn-primary btn-sm lo-pay" data-id="${escHtml(x.id)}">Mark paid</button>`;
        }
        return `
          <div class="item-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div style="font-weight:700;font-size:13px">${escHtml(x.description || '')}</div>
              ${badge('layoff_expense', x.status)}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
              ${escHtml(x.expenseDate || '')} · claimed ${money(x.amount)}${
                approvedDiffers ? ` · approved ${money(x.approvedAmount)}` : ''
              }${
                x.status === 'paid' ? ` · paid ${escHtml(x.paidDate || '')}${x.paidMethod ? ` via ${escHtml(x.paidMethod)}` : ''}` : ''
              }
            </div>
            ${x.hrNote ? `<div style="font-size:12px;color:var(--text-muted);font-style:italic;margin-top:2px">HR: ${escHtml(x.hrNote)}</div>` : ''}
            ${x.receiptUrl ? `<a href="${escHtml(safeHttpUrl(x.receiptUrl))}" target="_blank" rel="noopener" class="file-chip" style="margin-top:6px">
                <i data-lucide="${x.receiptKind === 'link' ? 'link-2' : 'file-text'}"></i><span>${escHtml(x.receiptName || 'Receipt')}</span>
              </a>` : ''}
            ${actions ? `<div style="margin-top:8px;display:flex;gap:8px">${actions}</div>` : ''}
          </div>`;
      }

      function reqRow(r) {
        return `
          <div class="item-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div style="font-weight:700;font-size:13px">${escHtml(r.description || '')}</div>
              ${badge('layoff_request', r.status)}
            </div>
            ${r.dueDate ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">Due ${escHtml(r.dueDate)}</div>` : ''}
            ${r.status === 'fulfilled' ? `<a href="${escHtml(safeHttpUrl(r.fileUrl))}" target="_blank" rel="noopener" class="file-chip" style="margin-top:6px">
                <i data-lucide="${r.fileKind === 'link' ? 'link-2' : 'file-text'}"></i><span>${escHtml(r.fileName || 'Submitted')}</span>
              </a>` : ''}
          </div>`;
      }

      body.innerHTML = `
        <div class="card-body" style="padding:0 0 12px">
          <div style="font-size:13px;white-space:pre-wrap">${escHtml(layoff.reason || '')}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:6px">Effective ${escHtml(layoff.effectiveDate || '')} · placed by ${escHtml(layoff.placedByName || '')}</div>
          ${layoff.status === 'lifted' ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">Lifted by ${escHtml(layoff.liftedByName || '')}${layoff.liftNote ? ` — ${escHtml(layoff.liftNote)}` : ''}</div>` : ''}
        </div>
        <div class="kpi-row" style="margin-bottom:16px">
          <div class="kpi-card">
            <div class="kpi-card-top"><div class="kpi-label">Submitted</div>${tile('receipt', 'var(--warning)', null)}</div>
            <div class="kpi-value" style="font-size:15px">${money(pendingTotal)}</div>
          </div>
          <div class="kpi-card ${owedTotal > 0 ? 'accent' : ''}">
            <div class="kpi-card-top"><div class="kpi-label">Owed</div>${tile('hand-coins', 'var(--primary)', null)}</div>
            <div class="kpi-value" style="font-size:15px">${money(owedTotal)}</div>
          </div>
          <div class="kpi-card green">
            <div class="kpi-card-top"><div class="kpi-label">Paid</div>${tile('check-circle-2', 'var(--success)', null)}</div>
            <div class="kpi-value" style="font-size:15px">${money(paidTotal)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-card-top"><div class="kpi-label">Total claimed</div>${tile('wallet', 'var(--text-muted)', null)}</div>
            <div class="kpi-value" style="font-size:15px">${money(claimedTotal)}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>${emojiIcon('🧾', 20)} Statement of Account</h3></div>
          <div class="card-body">${expenses.length ? expenses.map(expRow).join('') :
            (window.renderEmptyState ? window.renderEmptyState({ icon: '🧾', title: 'No expense claims yet' }) : '')}</div>
        </div>
        <div class="card" style="margin-top:16px">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <h3>${emojiIcon('📎', 20)} Documents requested</h3>
            ${canWrite ? `<button type="button" class="btn-primary btn-sm" id="lo-new-req">＋ Request a document</button>` : ''}
          </div>
          <div class="card-body">${requests.length ? requests.map(reqRow).join('') :
            (window.renderEmptyState ? window.renderEmptyState({ icon: '📎', title: 'No documents requested yet' }) : '')}</div>
        </div>
        ${canWrite && layoff.status === 'active' ? `<div class="card-body" style="margin-top:16px"><button type="button" class="btn-secondary" id="lo-lift-btn" style="color:var(--danger)">Lift layoff</button></div>` : ''}
      `;
      if (window.lucide) lucide.createIcons({ nodes: [body] });

      if (canWrite) {
        body.querySelectorAll('.lo-appr').forEach(btn => btn.addEventListener('click', () => {
          const claim = expenses.find(x => x.id === btn.dataset.id);
          if (claim) openApproveModal(claim);
        }));
        body.querySelectorAll('.lo-rej').forEach(btn => btn.addEventListener('click', async () => {
          const claim = expenses.find(x => x.id === btn.dataset.id);
          if (!claim) return;
          const hrNote = await promptDialog({ title: 'Reject expense', message: 'Reason shown to the employee', required: true });
          if (hrNote == null) return;
          await window.busy(btn, async () => {
            try { await window.LayoffSvc.rejectClaim(claim, { hrNote }); Notifs.success('Expense rejected'); await paint(); }
            catch (e) { Notifs.showToast('Could not reject: ' + (e.message || e.code), 'error'); }
          });
        }));
        body.querySelectorAll('.lo-pay').forEach(btn => btn.addEventListener('click', () => {
          const claim = expenses.find(x => x.id === btn.dataset.id);
          if (claim) openMarkPaidModal(claim);
        }));
        body.querySelector('#lo-new-req')?.addEventListener('click', () => openFileRequestModal());
        body.querySelector('#lo-lift-btn')?.addEventListener('click', async () => {
          if (!(await confirmDialog({ title: 'Lift layoff', message: `${layoff.userName || 'This person'} will immediately regain full access. Continue?`, confirmLabel: 'Lift layoff', danger: true }))) return;
          const liftNote = await promptDialog({ title: 'Lift note (optional)', message: 'Add a note about the return, if useful.' });
          const btn2 = body.querySelector('#lo-lift-btn');
          await window.busy(btn2, async () => {
            try {
              await window.LayoffSvc.lift(layoff, { liftNote: liftNote || '' });
              Notifs.success('Layoff lifted');
              closeModal();
              window.renderLayoffAdmin();
            } catch (e) { Notifs.showToast('Could not lift: ' + (e.message || e.code), 'error'); }
          });
        });
      }
    }

    // ── HR action modals (§3.6) — the standard modal is a DOM singleton (one
    // #modal-body/#modal-footer), so plain document.getElementById is the
    // established convention for content INSIDE it (js/screens/hr.js), unlike
    // openPage's per-panel ids which must be scoped to avoid the ~300ms
    // dying-panel race.
    function openApproveModal(claim) {
      window.openModal('Approve expense', `
        <p style="font-size:13px;margin-bottom:10px">${escHtml(claim.description || '')} — claimed ${money(claim.amount)}</p>
        <div class="form-group"><label>Approved amount (₱)</label>
          <input id="lo-appr-amt" type="number" min="0" step="0.01" value="${Number(claim.amount || 0)}"/>
        </div>
        <div class="form-group"><label>Note (optional)</label>
          <input id="lo-appr-note" placeholder="e.g. adjusted per receipt"/>
        </div>
      `, `<button type="button" class="btn-primary" id="lo-appr-go">Approve</button><button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('lo-appr-go').addEventListener('click', async (ev) => {
        await window.busy(ev.currentTarget, async () => {
          try {
            const approvedAmount = document.getElementById('lo-appr-amt').value;
            const hrNote = document.getElementById('lo-appr-note').value;
            await window.LayoffSvc.approveClaim(claim, { approvedAmount, hrNote });
            Notifs.success('Expense approved');
            closeModal();
            await paint();
          } catch (err) { Notifs.showToast('Could not approve: ' + (err.message || err.code), 'error'); }
        });
      });
    }

    function openMarkPaidModal(claim) {
      window.openModal('Mark as paid', `
        <p style="font-size:13px;margin-bottom:10px">${escHtml(claim.description || '')} — approved ${money(claim.approvedAmount)}</p>
        <div class="form-group"><label>Date paid</label><input id="lo-paid-date" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Method (optional)</label><input id="lo-paid-method" placeholder="e.g. GCash, Cash, bank transfer"/></div>
      `, `<button type="button" class="btn-primary" id="lo-paid-go">Mark paid</button><button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('lo-paid-go').addEventListener('click', async (ev) => {
        await window.busy(ev.currentTarget, async () => {
          try {
            const paidDate = document.getElementById('lo-paid-date').value;
            const paidMethod = document.getElementById('lo-paid-method').value;
            await window.LayoffSvc.markPaid(claim, { paidDate, paidMethod });
            Notifs.success('Marked paid');
            closeModal();
            await paint();
          } catch (err) { Notifs.showToast('Could not mark paid: ' + (err.message || err.code), 'error'); }
        });
      });
    }

    function openFileRequestModal() {
      window.openModal('Request a document', `
        <div class="form-group"><label>What do you need?</label>
          <textarea id="lo-req-desc" rows="3" placeholder="e.g. Signed clearance form"></textarea>
        </div>
        <div class="form-group"><label>Due date (optional)</label><input id="lo-req-due" type="date"/></div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px">
          <input id="lo-req-allowlink" type="checkbox" checked/>
          <label for="lo-req-allowlink" style="margin:0">Allow a link instead of a file</label>
        </div>
      `, `<button type="button" class="btn-primary" id="lo-req-go">Send request</button><button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('lo-req-go').addEventListener('click', async (ev) => {
        await window.busy(ev.currentTarget, async () => {
          try {
            const description = document.getElementById('lo-req-desc').value;
            if (!(description || '').trim()) throw new Error('Description is required.');
            const dueDate = document.getElementById('lo-req-due').value || null;
            const allowLink = document.getElementById('lo-req-allowlink').checked;
            await window.LayoffSvc.createFileRequest({ layoffId: layoff.id, uid: layoff.uid, userName: layoff.userName, description, dueDate, allowLink });
            Notifs.success('Document request sent');
            closeModal();
            await paint();
          } catch (err) { Notifs.showToast('Could not send request: ' + (err.message || err.code), 'error'); }
        });
      });
    }

    await paint();
  };

})();
