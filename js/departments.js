/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Department Modules
   departments.js
═══════════════════════════════════════════════════ */

'use strict';

// ── Shared helpers ────────────────────────────────
function deptContainer() { return document.getElementById('page-content'); }
function fmt(n) { return Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function today() { return (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10)); }
function priorityBadge(p) { return {high:'badge-red',medium:'badge-orange',low:'badge-green',urgent:'badge-red'}[p]||'badge-gray'; }

// Returns true if user is an admin role OR is a member of the given department.
// Use this for write-access checks inside department modules so that dept members
// can manage their own content regardless of their system role.
function canEditDept(dept) {
  const role = window.currentRole || '';
  // 'secretary' (Corporate Secretary) gets manager-level edit access across the company.
  if (['president','owner','manager','secretary'].includes(role)) return true;
  // Accountant (finance role): full edit rights to the FINANCE department only — not
  // other departments. Deletes still route through President approval (financeDelete).
  if (role === 'finance') return dept === 'Finance';
  return (window.currentDepts || []).includes(dept);
}
// Shorthand for Finance-specific privilege (Payroll, HR Profiles, etc.)
function isFinancePriv() { return canEditDept('Finance'); }

// Wrap a click handler so Firestore/JS errors surface as a toast + console.error
// instead of failing silently (the button just looks like it "did nothing").
function onClickSafe(btn, fn) {
  btn.addEventListener('click', async () => {
    try { await fn(); }
    catch (e) {
      console.error('[action failed]', e);
      Notifs.showToast(`Action failed: ${e.message||e}`, 'error');
    }
  });
}

// Best-effort notification send — never throw. A failed push/notification must
// not make an already-successful approve/deny/delete look like it failed.
async function safeNotify(fn) {
  try { await fn(); }
  catch (e) { console.warn('[notification failed, action itself still succeeded]', e); }
}

// ════════════════════════════════════════════════════════════════
//  PROJECTS — unified read layer over the two physical collections
//  `job_projects` (Sales/Production lifecycle) and `projects` (Design board)
//  stay SEPARATE on disk (different security models + schemas), but views that
//  need "all projects" read them through one normalized shape here. Writes still
//  go through each collection's own functions. No destructive migration.
// ════════════════════════════════════════════════════════════════
window.Projects = (function() {
  function sumPayments(d) { return (d.payments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0); }
  // Canonical shape: {id, kind, no, name, clientName, contractAmount, collected,
  // arBalance, stage, payments, invoices, jobProjectId, partnerUid, createdAt, raw}
  function normalize(doc, kind) {
    const d = doc.data ? doc.data() : doc;
    const id = doc.id || d.id;
    const contract  = Number(d.contractAmount) || 0;
    const collected = (kind === 'job' && d.amountCollected != null) ? Number(d.amountCollected) : sumPayments(d);
    const arBalance = (kind === 'job' && d.arBalance != null) ? Number(d.arBalance) : Math.max(0, contract - collected);
    return {
      id, kind,
      no:        kind === 'job' ? (d.projectNo || '') : (d.no || ''),
      name:      d.name || d.clientName || '(untitled)',
      clientName: d.clientName || d.client || '',
      contractAmount: contract, collected, arBalance,
      stage:     kind === 'job' ? (d.stage || '') : (d.status || ''),
      payments:  d.payments || [], invoices: d.invoices || [],
      jobProjectId: d.jobProjectId || null,
      partnerUid: d.partnerUid || null,
      createdAt: d.createdAt || null,
      raw: d
    };
  }
  // listAll(scope): scope.partner skips the internal Design board; scope.partnerUid
  // filters job projects to that partner (mirrors the job_projects rule).
  async function listAll(scope) {
    scope = scope || {};
    const fetch = async () => {
      const jobSnap = await db.collection('job_projects').get().catch(() => ({ docs: [] }));
      const desSnap = scope.partner ? { docs: [] } : await db.collection('projects').get().catch(() => ({ docs: [] }));
      let jobs = jobSnap.docs.map(d => normalize(d, 'job'));
      if (scope.partnerUid) jobs = jobs.filter(j => j.partnerUid === scope.partnerUid);
      const designs = desSnap.docs.map(d => normalize(d, 'design'));
      return [...jobs, ...designs];
    };
    // Only the internal full list is cached (key invalidated on any project write);
    // partner-scoped reads bypass the cache to avoid leaking across scopes.
    if (scope.partner || scope.partnerUid) return fetch();
    return (typeof dbCachedGet === 'function') ? dbCachedGet('projects-unified', fetch, 30000) : fetch();
  }
  return { normalize, listAll, sumPayments };
})();

// One-time (re-runnable) tag of existing docs with a `kind` field so the two
// collections are queryable/identifiable. Idempotent — skips docs already tagged.
window.backfillProjectKind = async function() {
  const [jp, pr] = await Promise.all([
    db.collection('job_projects').get().catch(() => ({ docs: [] })),
    db.collection('projects').get().catch(() => ({ docs: [] }))
  ]);
  const tagMissing = async (docs, kind) => {
    let n = 0, pending = [];
    for (const d of docs) {
      if (d.data().kind) continue;
      pending.push(d.ref); n++;
      if (pending.length === 400) { const b = db.batch(); pending.forEach(r => b.update(r, { kind })); await b.commit(); pending = []; }
    }
    if (pending.length) { const b = db.batch(); pending.forEach(r => b.update(r, { kind })); await b.commit(); }
    return n;
  };
  const jobs = await tagMissing(jp.docs, 'job');
  const designs = await tagMissing(pr.docs, 'design');
  return { jobs, designs, tagged: jobs + designs };
};

window.runProjectKindBackfill = async function() {
  if (!(await confirmDialog({message:'Tag existing projects with their kind (job / design)?\n\nSafe to run repeatedly — already-tagged projects are skipped.'}))) return;
  try {
    const r = await window.backfillProjectKind();
    Notifs.showToast(`Tagged ✓ ${r.jobs} job + ${r.designs} design projects.`);
  } catch (e) { Notifs.showToast('Tagging failed: ' + (e.message || e), 'error'); }
};

// ════════════════════════════════════════════════════════════════
//  FINANCE — edit anything, delete only with President approval
//  Finance staff may edit every finance record. Deletes are gated:
//  the President deletes immediately; everyone else files a request the
//  President approves in the Approvals tab. The same rule is enforced in
//  firestore.rules (delete → president only), so the gate can't be bypassed
//  from the client. All finance delete buttons route through financeDelete().
// ════════════════════════════════════════════════════════════════

// Cascade cleanup that must accompany the ACTUAL delete of certain finance
// docs (their linked ledger entries / CA balances). Runs in the deleter's
// context — always the President — so these ledger writes are permitted.
async function financeDeleteCascade(collection, docId) {
  let d = null;
  try { const s = await db.collection(collection).doc(docId).get(); d = s.exists ? s.data() : null; } catch(_) {}
  if (!d) return;
  if (collection === 'salary_history') {
    const ref = `PAY-${d.month}-${d.userId||''}`;
    const ls = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>({docs:[]}));
    if (ls.docs.length) await ls.docs[0].ref.delete().catch(()=>{});
    // v12 WS20/21: the employer-share debit leg this employee's line posted
    // (gross-with-liability-legs booking). NOTE: the aggregate SSSPAY-/PHPAY-/
    // HDMFPAY-/WHTPAY-/NETPAY-{month} credit legs (shared across the WHOLE
    // run, not per-employee) are NOT adjusted here — they'd need re-deriving
    // from every other still-standing line for that month. Known gap, left
    // for whoever builds WS39 (BIR/remittance reports, the eventual owner of
    // these legs) since a wrong partial fix is worse than an honest one.
    const lsEr = await db.collection('ledger').where('refNumber','==',ref+'-ER').limit(1).get().catch(()=>({docs:[]}));
    if (lsEr.docs.length) await lsEr.docs[0].ref.delete().catch(()=>{});
    // Restore any cash-advance balances this payroll run deducted, so deleting the
    // run doesn't leave an employee's loan wrongly marked paid.
    if (Array.isArray(d.caDeductions)) {
      for (const cd of d.caDeductions) {
        if (cd && cd.caId && cd.amount > 0) {
          // v12 WS22 fix: every reader filters status==='approved' for an
          // outstanding balance — 'active' was never a recognized status and
          // made a reversed CA invisible to Compute's balance aggregation.
          await db.collection('cash_advances').doc(cd.caId).update({
            balance: firebase.firestore.FieldValue.increment(cd.amount),
            status: 'approved', paidAt: firebase.firestore.FieldValue.delete()
          }).catch(()=>{});
        }
      }
    }
  } else if (collection === 'payslips') {
    const ca = d.deductions?.other?.cashAdvance || 0;
    if (ca > 0 && d.workerId) await db.collection('worker_profiles').doc(d.workerId).update({ caBalance: firebase.firestore.FieldValue.increment(ca) }).catch(()=>{});
    const ls = await db.collection('ledger').where('refNumber','==',`WPAY-${docId}`).limit(1).get().catch(()=>({docs:[]}));
    if (ls.docs.length) await ls.docs[0].ref.delete().catch(()=>{});
  } else if (collection === 'cash_receipt_journal' || collection === 'cash_disbursement_journal' || collection === 'expenses') {
    // Remove the mirrored ledger row (CRJ-/CDJ-/EXP-<id>) so deleting the source
    // entry doesn't leave the books overstated.
    const prefix = collection === 'cash_receipt_journal' ? 'CRJ' : collection === 'cash_disbursement_journal' ? 'CDJ' : 'EXP';
    const ls = await db.collection('ledger').where('refNumber','==',`${prefix}-${docId}`).limit(1).get().catch(()=>({docs:[]}));
    if (ls.docs.length) await ls.docs[0].ref.delete().catch(()=>{});
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
  }
}

// Perform the real delete (cascade first, then the doc). Used by the President's
// direct delete AND by the Approvals screen when a request is approved.
window.financeExecuteDelete = async function(collection, docId) {
  await financeDeleteCascade(collection, docId);
  await db.collection(collection).doc(docId).delete();
};

// President → delete now (with confirm). Anyone else → file a delete request for
// the President to approve. `label` is a human description of the record.
// Resolves to 'deleted' | 'requested' | 'cancelled'. onDone(outcome) optional.
window.financeDelete = function(opts) {
  const { collection, docId, label } = opts;
  const onDone = opts.onDone || (()=>{});
  const u = window.currentUser || (typeof auth !== 'undefined' && auth.currentUser) || {};
  return new Promise(async (resolve) => {
    if (typeof isRealPresident === 'function' && isRealPresident()) {
      if (!(await confirmDialog({ message: `Delete ${escHtml(label)}? This cannot be undone.`, danger:true, html:true }))) { resolve('cancelled'); return; }
      window.financeExecuteDelete(collection, docId)
        .then(() => { Notifs.showToast('Deleted.'); onDone('deleted'); resolve('deleted'); })
        .catch(e => { Notifs.showToast('Delete failed: '+(e.message||e),'error'); resolve('cancelled'); });
      return;
    }
    openModal('Request Deletion — President Approval', `
      <p style="margin-bottom:12px;color:var(--text-muted);font-size:13px">Deleting <strong>${escHtml(label)}</strong> needs the President's approval. The record stays until it's approved.</p>
      <div class="form-group"><label>Reason for deletion</label><input id="fdr-reason" placeholder="e.g. Duplicate entry, wrong amount…"/></div>
    `, `<button class="btn-primary" id="fdr-submit">Submit for Approval</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    const submitBtn = document.getElementById('fdr-submit');
    submitBtn && submitBtn.addEventListener('click', async () => {
      const reason = (document.getElementById('fdr-reason').value||'').trim();
      if (!reason) { Notifs.showToast('Please enter a reason.','error'); return; }
      try {
        await db.collection('finance_delete_requests').add({
          collection, docId, label, reason,
          requestedBy:     u.uid || '',
          requestedByName: window.userProfile?.displayName || u.email || 'Finance',
          status:          'pending',
          createdAt:       firebase.firestore.FieldValue.serverTimestamp()
        });
        await safeNotify(() => Notifs.sendToOwner({
          title: '🗑 Finance Delete Request',
          body:  `${window.userProfile?.displayName || u.email || 'Finance'} requested deletion of ${label}. Reason: ${reason}`,
          icon: '🗑', type: 'finance_delete_request'
        }));
        closeModal();
        Notifs.showToast('Deletion request sent to the President for approval.');
        onDone('requested'); resolve('requested');
      } catch(e) {
        Notifs.showToast('Could not send request: '+(e.message||e),'error');
      }
    });
  });
};

// Delete a quote record WITH APPROVAL (never a silent hard delete). Roles that
// can file a finance delete request (president/manager/secretary/finance) route
// through financeDelete (President deletes now; others file a request the
// President approves in Approvals → Finance Requests). A non-admin quote CREATOR
// can't write finance_delete_requests, so they flag their own quote
// (deleteRequested) which the President actions in Approvals → All Requests.
// collection is 'bk_quotes' or 'bs_quotes'.
window.requestQuoteDelete = async function(collection, docId, label, createdBy, onDone) {
  onDone = onDone || (()=>{});
  const role = window.currentRole || '';
  const u = window.currentUser || (typeof auth !== 'undefined' && auth.currentUser) || {};
  if (['president','manager','secretary','finance'].includes(role)) {
    return window.financeDelete({ collection, docId, label, onDone });
  }
  if (createdBy && u.uid === createdBy) {
    const reason = ((await promptDialog({message:'Reason for deleting this quote? (sent to the President for approval)', required:true, multiline:true})) || '').trim();
    return db.collection(collection).doc(docId).update({
      deleteRequested: true, deleteReason: reason,
      deleteRequestedBy: u.uid, deleteRequestedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(async () => {
      await safeNotify(() => Notifs.sendToOwner({
        title: '🗑 Quote Delete Requested',
        body: `${(window.userProfile && window.userProfile.displayName) || u.email || 'A user'} requests deleting ${label}.${reason?' Reason: '+reason:''}`,
        icon: '🗑', type: 'quote_delete_request'
      }));
      Notifs.showToast('Delete request sent to the President.'); onDone('requested');
    }).catch(e => Notifs.showToast('Request failed: '+(e.message||e),'error'));
  }
  Notifs.showToast('You can only request deletion of your own quotes.', 'error');
  return Promise.resolve('denied');
};

// Generic edit modal for simple finance records. `fields` describe the form:
//   { key, label, type:'text'|'number'|'date'|'select'|'textarea', options?, full? }
// On save it .update()s the doc with the typed values + an edit audit stamp.
window.financeEditModal = function({ collection, docId, title, fields, onSaved }) {
  const u = window.currentUser || (typeof auth !== 'undefined' && auth.currentUser) || {};
  const selStyle = 'padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)';
  const taStyle  = 'width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)';
  const fieldHtml = f => {
    const v = f.value == null ? '' : f.value;
    if (f.type === 'select')   return `<div class="form-group"><label>${f.label}</label><select id="fe-${f.key}" style="${selStyle}">${(f.options||[]).map(o=>`<option ${String(o)===String(v)?'selected':''}>${escHtml(o)}</option>`).join('')}</select></div>`;
    if (f.type === 'textarea') return `<div class="form-group"><label>${f.label}</label><textarea id="fe-${f.key}" rows="2" style="${taStyle}">${escHtml(v)}</textarea></div>`;
    const t = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
    return `<div class="form-group"><label>${f.label}</label><input id="fe-${f.key}" type="${t}" ${f.type==='number'?'step="0.01" inputmode="decimal"':''} value="${escHtml(v)}"/></div>`;
  };
  // Pack into 2-up rows, except fields flagged full:true which get their own row.
  let body = '', buf = [];
  const flush = () => { if (!buf.length) return; body += buf.length===2 ? `<div class="form-row">${buf.join('')}</div>` : buf[0]; buf = []; };
  fields.forEach(f => { if (f.full) { flush(); body += fieldHtml(f); } else { buf.push(fieldHtml(f)); if (buf.length===2) flush(); } });
  flush();
  openPage('Edit '+title, body, `<button class="btn-primary" id="fe-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  document.getElementById('fe-save').addEventListener('click', async () => {
    const upd = {};
    fields.forEach(f => {
      const el = document.getElementById('fe-'+f.key);
      if (!el) return;
      upd[f.key] = f.type === 'number' ? (parseFloat(el.value)||0) : (typeof el.value === 'string' ? el.value.trim() : el.value);
    });
    upd.editedBy     = u.uid || '';
    upd.editedByName = window.userProfile?.displayName || u.email || '';
    upd.editedAt     = firebase.firestore.FieldValue.serverTimestamp();
    try {
      await db.collection(collection).doc(docId).update(upd);
      closeModal(); Notifs.showToast('Updated.'); onSaved && onSaved();
    } catch(e) { Notifs.showToast('Update failed: '+(e.message||e),'error'); }
  });
};

// ── Task Status System ─────────────────────────────
const TASK_STATUSES = [
  { value:'backlog',      label:'Backlog',               badge:'badge-gray'   },
  { value:'brainstorm',   label:'Brainstorming',         badge:'badge-purple' },
  { value:'in-progress',  label:'In Progress',           badge:'badge-blue'   },
  { value:'submitted',    label:'Submitted for Review',  badge:'badge-orange' },
  { value:'review',       label:'In Review',             badge:'badge-orange' }, // alias for submitted
  { value:'returned',     label:'Returned for Revision', badge:'badge-red'    },
  { value:'approved',     label:'Approved',              badge:'badge-green'  },
  { value:'done',         label:'Done',                  badge:'badge-green'  },
  { value:'on-hold',      label:'On Hold',               badge:'badge-orange' },
  { value:'archived',     label:'Archived',              badge:'badge-gray'   },
];
const EMP_STATUSES   = ['backlog','brainstorm','in-progress','submitted'];
const DONE_STATUSES  = ['approved','archived'];
const SCORE_STATUSES = ['approved','on-hold','archived'];

function statusBadge(s) {
  const ts = TASK_STATUSES.find(x=>x.value===s);
  if (ts) return ts.badge;
  return {open:'badge-blue',done:'badge-green',pending:'badge-orange',draft:'badge-gray',sent:'badge-blue',accepted:'badge-green',reviewing:'badge-purple',rejected:'badge-red',approved:'badge-green'}[s]||'badge-gray';
}
function statusLabel(s) {
  const ts = TASK_STATUSES.find(x=>x.value===s);
  return ts?ts.label:({open:'Open',done:'Done',pending:'Pending'}[s]||s||'—');
}
function normTask(data,id) {
  const t={id,...data};
  if (!Array.isArray(t.assignedTo))      t.assignedTo      = t.assignedTo     ?[t.assignedTo]     :[];
  if (!Array.isArray(t.assignedToNames)) t.assignedToNames = t.assignedToName ?[t.assignedToName] :[];
  if (!Array.isArray(t.followUps))       t.followUps       = [];
  if (typeof t.openFollowUpCount!=='number') t.openFollowUpCount = t.followUps.filter(f=>f&&f.status!=='addressed').length;
  return t;
}
// Format a follow-up timestamp in Manila time (display only). Stored values are
// Firestore Timestamps (absolute instants), so en-PH + Asia/Manila is safe here.
function fuTime(ts){
  try{
    const d = ts && ts.toDate ? ts.toDate() : (ts && ts.seconds ? new Date(ts.seconds*1000) : null);
    if(!d) return '';
    return d.toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }catch(e){ return ''; }
}
// Inner HTML of the "Follow-up Requests" card. Pure (no DOM lookups / no handlers)
// so the task panel can re-render it in place after each request/addressed action.
// flags: { isAdmin, isAssignee, isCreator }. Returns '' when the viewer shouldn't
// see the card at all.
function followUpCardInner(t, flags){
  const isAdmin=flags.isAdmin, isAssignee=flags.isAssignee, isCreator=flags.isCreator;
  const fus=(t.followUps||[]).slice().sort((a,b)=>((b.at&&b.at.seconds)||0)-((a.at&&a.at.seconds)||0));
  const openFu=fus.filter(f=>f.status!=='addressed').length;
  if(!(isAdmin||isAssignee||isCreator||fus.length)) return '';
  return `
    <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted)">📣 Follow-up Requests</div>
        ${openFu?`<span class="badge badge-orange" style="font-size:10px">${openFu} pending</span>`:''}
      </div>
      ${fus.length ? `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:${isAdmin?'10px':'0'}">
        ${fus.map(fu=>{
          const pending=fu.status!=='addressed';
          return `<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ${pending?'var(--warning,#ff9f0a)':'var(--success,#34c759)'};border-radius:8px;padding:8px 10px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
              <span class="badge ${pending?'badge-orange':'badge-green'}" style="font-size:9px">${pending?'PENDING':'ADDRESSED'}</span>
              <span style="font-size:11px;color:var(--text-muted)">${escHtml(fu.byName||'')}${fuTime(fu.at)?' · '+fuTime(fu.at):''}</span>
            </div>
            <div style="font-size:13px;color:var(--text);line-height:1.4;white-space:pre-wrap">${escHtml(fu.message||'Update requested')}</div>
            ${!pending&&fu.addressedByName?`<div style="font-size:11px;color:var(--success,#34c759);margin-top:4px">✓ ${escHtml(fu.addressedByName)}${fuTime(fu.addressedAt)?' · '+fuTime(fu.addressedAt):''}</div>`:''}
            ${pending&&(isAdmin||isAssignee)?`<button class="btn-success btn-sm fu-addr-btn" data-fu="${escHtml(fu.id||'')}" style="margin-top:6px">✓ Mark addressed</button>`:''}
          </div>`;
        }).join('')}
      </div>` : `<div style="font-size:12px;color:var(--text-muted);margin-bottom:${isAdmin?'10px':'0'}">No follow-ups yet.</div>`}
      ${isAdmin?`<div style="display:flex;gap:6px">
        <input id="fu-input" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)" placeholder="Ask the assignee for an update…"/>
        <button class="btn-primary btn-sm" id="fu-request-btn">📣 Request</button>
      </div>`:''}
    </div>`;
}
// Sync the 📣 follow-up badge on any matching task card in the current list view,
// so the list reflects a new count immediately after an action (no full re-render).
function updateCardFollowUpBadge(taskId, count){
  document.querySelectorAll(`.item-card[data-id="${taskId}"] .item-badges`).forEach(badges=>{
    const existing=badges.querySelector('.fu-card-badge');
    if(count>0){
      const label=`📣 ${count} follow-up${count>1?'s':''}`;
      if(existing) existing.textContent=label;
      else { const s=document.createElement('span'); s.className='badge badge-orange fu-card-badge'; s.textContent=label; badges.appendChild(s); }
    } else if(existing){ existing.remove(); }
  });
}
function assigneeChips(t) {
  if (!t.assignedToNames?.length) return '';
  const chips=t.assignedToNames.slice(0,3).map(n=>`<span style="font-size:11px;background:var(--primary-light);color:#fff;padding:2px 8px;border-radius:10px">${escHtml(n)}</span>`).join('');
  return chips+(t.assignedToNames.length>3?`<span style="font-size:11px;color:var(--text-muted)">+${t.assignedToNames.length-3}</span>`:'');
}
function taskCard(t) {
  const inactive=DONE_STATUSES.includes(t.status)||t.status==='archived';
  return `<div class="item-card priority-${t.priority||'medium'}${inactive?' status-done':''}" data-id="${t.id}">
    <div class="item-top">
      <div class="item-title">${escHtml(t.title)}</div>
      <div class="item-badges">
        <span class="badge ${priorityBadge(t.priority)}">${t.priority||'med'}</span>
        <span class="badge ${statusBadge(t.status)}">${statusLabel(t.status)}</span>
        ${(t.openFollowUpCount||0)>0?`<span class="badge badge-orange fu-card-badge">📣 ${t.openFollowUpCount} follow-up${t.openFollowUpCount>1?'s':''}</span>`:''}
      </div>
    </div>
    <div class="item-meta" style="gap:6px;flex-wrap:wrap">
      ${assigneeChips(t)}
      ${t.dueDate?`<span>📅 ${t.dueDate}</span>`:''}
      ${t.department?`<span>🗂 ${t.department}</span>`:''}
    </div>
  </div>`;
}
async function notifyTaskInvolved(task,notifData,skipUid) {
  const dataWithTask = { ...notifData, taskId: task.id };
  const involved=new Set([...(task.assignedTo||[]),task.createdBy].filter(Boolean));
  involved.delete(skipUid);
  await Promise.all(Array.from(involved).map(uid=>Notifs.send(uid,dataWithTask)));
  await Notifs.sendToOwner(dataWithTask);
}

// ── Dept Tasks subtab (shared) ────────────────────
async function renderDeptTasks(container, deptName, currentUser, currentRole) {
  const isAdmin = canEditDept(deptName);
  container.innerHTML = '<div class="loading-placeholder">Loading tasks…</div>';
  try {
    let snap = await db.collection('tasks').where('department','==',deptName).get()
      .catch(()=>({docs:[]}));
    let tasks = snap.docs.map(d=>normTask(d.data(),d.id));
    // Non-dept-members only see tasks they're involved in
    if (!isAdmin) {
      tasks = tasks.filter(t=>(t.assignedTo||[]).includes(currentUser.uid)||t.createdBy===currentUser.uid);
    }
    tasks.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

    if (!tasks.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><h4>No tasks for ${deptName}</h4></div>`;
      return;
    }

    // Group by status order
    const groups = TASK_STATUSES.map(s=>({
      ...s,
      items: tasks.filter(t=>t.status===s.value)
    })).filter(g=>g.items.length);
    // Tasks with unknown/legacy status
    const known = new Set(TASK_STATUSES.map(s=>s.value));
    const other = tasks.filter(t=>!known.has(t.status));
    if (other.length) groups.push({value:'other',label:'Other',badge:'badge-gray',items:other});

    const canAdd = isAdmin;
    container.innerHTML = `
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px">
        <button class="btn-secondary btn-sm" id="dept-tasks-csv">⬇ CSV</button>
        ${canAdd?`<button class="btn-primary btn-sm" id="dept-add-task-btn">+ New Task</button>`:''}
      </div>
      ${groups.map(g=>`
        <div style="margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span class="badge ${g.badge}">${g.label}</span>
            <span style="font-size:12px;color:var(--text-muted)">${g.items.length} task${g.items.length!==1?'s':''}</span>
          </div>
          <div class="item-list">
            ${g.items.map(t=>taskCard(t)).join('')}
          </div>
        </div>
      `).join('')}
    `;
    container.querySelector('#dept-tasks-csv')?.addEventListener('click',()=>window.exportCSV(deptName+'-tasks', tasks, [
      {key:'title',label:'Title'},{key:'status',label:'Status',get:t=>(typeof statusLabel==='function'?statusLabel(t.status):t.status)},
      {key:'priority',label:'Priority'},{key:'department',label:'Department'},{key:'dueDate',label:'Due'},{key:'createdByName',label:'Created By'}]));
    container.querySelectorAll('.item-card').forEach(card=>
      card.addEventListener('click',()=>openTaskDetail(card.dataset.id,currentUser,currentRole))
    );
    if (canAdd) {
      container.querySelector('#dept-add-task-btn')?.addEventListener('click',()=>openAddTaskModal(currentUser,currentRole,deptName));
    }
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>Error loading tasks</h4></div>`;
    console.error('renderDeptTasks error',e);
  }
}

// ══════════════════════════════════════════════════
//  TASKS (shared across all departments)
// ══════════════════════════════════════════════════
window.renderTasks = async function(currentUser, currentRole, currentDept) {
  const c = deptContainer();
  const isAdmin = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance';

  if (currentRole === 'president' || currentRole === 'owner' || currentRole === 'finance') {
    c.innerHTML = `
      <div class="page-header">
        <h2>✅ Tasks</h2>
        <button class="btn-primary btn-sm" id="add-task-btn">+ New Task</button>
      </div>
      <div class="subtab-bar">
        <button class="subtab-btn active" data-sub="departmental">📂 Departmental</button>
        <button class="subtab-btn" data-sub="overdue">🔴 Overdue</button>
        <button class="subtab-btn" data-sub="neardue">🟡 Near Due</button>
        <button class="subtab-btn" data-sub="mine">👤 My Tasks</button>
      </div>
      <div id="tasks-subtab-content"></div>
    `;
    loadPresidentTasks('departmental', currentUser, currentRole);
    c.querySelectorAll('.subtab-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        c.querySelectorAll('.subtab-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        loadPresidentTasks(btn.dataset.sub,currentUser,currentRole);
      });
    });
    document.getElementById('add-task-btn').onclick = () => openAddTaskModal(currentUser,currentRole);
    return;
  }

  const hasDept = (window.currentDepts||[]).length > 0;
  c.innerHTML = `
    <div class="page-header">
      <h2>✅ Tasks</h2>
      <div class="page-actions">
        <select id="task-filter" class="select-sm">
          <option value="mine">My Tasks</option>
          ${isAdmin?'<option value="all">All Tasks</option>':''}
          ${hasDept||isAdmin?`<option value="dept">📂 Dept Tasks</option>`:''}
          ${TASK_STATUSES.map(s=>`<option value="${s.value}">${s.label}</option>`).join('')}
        </select>
        <button class="btn-primary btn-sm" id="add-task-btn">+ New Task</button>
      </div>
    </div>
    <div id="tasks-list" class="item-list"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadTasksList(currentUser,currentRole,currentDept);
  document.getElementById('task-filter').onchange = () => loadTasksList(currentUser,currentRole,currentDept);
  document.getElementById('add-task-btn').onclick  = () => openAddTaskModal(currentUser,currentRole);
};

async function loadPresidentTasks(sub, currentUser, currentRole) {
  const wrap = document.getElementById('tasks-subtab-content');
  if (!wrap) return;

  if (sub === 'overdue' || sub === 'neardue') {
    wrap.innerHTML = '<div class="loading-placeholder">Loading…</div>';
    const todayStr = today();
    const in3d = new Date(); in3d.setDate(in3d.getDate() + 3);
    const in3Str   = window.bizDate ? window.bizDate(in3d) : in3d.toISOString().slice(0, 10);
    const snap = typeof dbCachedGet==='function'
      ? await dbCachedGet('tasks-all', ()=>db.collection('tasks').get(), 30000).catch(()=>({docs:[]}))
      : await db.collection('tasks').get().catch(()=>({docs:[]}));
    let tasks = snap.docs.map(d=>normTask(d.data(),d.id)).filter(t=>!DONE_STATUSES.includes(t.status)&&t.status!=='archived');
    if (sub === 'overdue') {
      tasks = tasks.filter(t=>t.dueDate && t.dueDate < todayStr)
        .sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
      if (!tasks.length) { wrap.innerHTML='<div class="empty-state"><div class="empty-icon">✅</div><h4>No overdue tasks</h4></div>'; return; }
      wrap.innerHTML = `<div style="margin-bottom:10px"><span class="badge badge-red" style="font-size:13px">${tasks.length} overdue task${tasks.length>1?'s':''}</span></div><div class="item-list">${tasks.map(t=>taskCard(t)).join('')}</div>`;
    } else {
      tasks = tasks.filter(t=>t.dueDate && t.dueDate >= todayStr && t.dueDate <= in3Str)
        .sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
      if (!tasks.length) { wrap.innerHTML='<div class="empty-state"><div class="empty-icon">🟡</div><h4>No tasks due in the next 3 days</h4></div>'; return; }
      wrap.innerHTML = `<div style="margin-bottom:10px"><span class="badge badge-orange" style="font-size:13px">${tasks.length} task${tasks.length>1?'s':''} due within 3 days</span></div><div class="item-list">${tasks.map(t=>taskCard(t)).join('')}</div>`;
    }
    wrap.querySelectorAll('.item-card').forEach(card=>card.addEventListener('click',()=>openTaskDetail(card.dataset.id,currentUser,currentRole)));
    return;
  }

  if (sub === 'mine') {
    wrap.innerHTML = `
      <div style="display:flex;justify-content:flex-end;padding:8px 0">
        <select id="pres-mine-filter" class="select-sm">
          <option value="all">All Statuses</option>
          ${TASK_STATUSES.map(s=>`<option value="${s.value}">${s.label}</option>`).join('')}
        </select>
      </div>
      <div id="pres-mine-list" class="item-list"><div class="loading-placeholder">Loading…</div></div>
    `;
    const renderMine = async () => {
      const list   = document.getElementById('pres-mine-list');
      const filter = document.getElementById('pres-mine-filter')?.value||'all';
      const snap   = await db.collection('tasks').where('assignedTo','array-contains',currentUser.uid).get()
        .catch(()=>db.collection('tasks').where('assignedTo','==',currentUser.uid).get());
      let tasks = snap.docs.map(d=>normTask(d.data(),d.id)).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      if (filter!=='all') tasks = tasks.filter(t=>t.status===filter);
      if (!tasks.length) { list.innerHTML='<div class="empty-state"><div class="empty-icon">✅</div><h4>No tasks</h4></div>'; return; }
      list.innerHTML = tasks.map(t=>taskCard(t)).join('');
      list.querySelectorAll('.item-card').forEach(card=>card.addEventListener('click',()=>openTaskDetail(card.dataset.id,currentUser,currentRole)));
    };
    renderMine();
    document.getElementById('pres-mine-filter')?.addEventListener('change',renderMine);
    return;
  }

  wrap.innerHTML = '<div class="loading-placeholder">Loading…</div>';
  try {
    const snap  = typeof dbCachedGet==='function'
      ? await dbCachedGet('tasks-all', ()=>db.collection('tasks').get(), 30000)
      : await db.collection('tasks').get();
    const tasks = snap.docs.map(d=>normTask(d.data(),d.id)).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    if (!tasks.length) { wrap.innerHTML='<div class="empty-state"><div class="empty-icon">✅</div><h4>No tasks yet</h4></div>'; return; }

    const deptGroups={};
    tasks.forEach(t=>{ const d=t.department||'Unassigned'; if(!deptGroups[d])deptGroups[d]=[]; deptGroups[d].push(t); });

    wrap.innerHTML = Object.entries(deptGroups).map(([dept,dTasks])=>{
      const cfg  = window.DEPARTMENTS?.[dept]||{icon:'🗂️',color:'var(--primary-light)'};
      const open = dTasks.filter(t=>!DONE_STATUSES.includes(t.status)&&t.status!=='archived').length;
      const done = dTasks.filter(t=>DONE_STATUSES.includes(t.status)).length;
      return `<div class="card" style="margin-bottom:12px">
        <div class="card-header" style="border-left:4px solid ${cfg.color||'var(--primary-light)'}">
          <h3>${emojiIcon(cfg.lucideIcon||cfg.icon,20)} ${dept}</h3>
          <div style="display:flex;gap:8px"><span class="badge badge-blue">${open} open</span><span class="badge badge-green">${done} done</span></div>
        </div>
        <div class="item-list" style="padding:0 12px 12px">
          ${dTasks.map(t=>`<div style="margin-top:8px">${taskCard(t)}</div>`).join('')}
        </div>
      </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    wrap.querySelectorAll('.item-card').forEach(card=>card.addEventListener('click',()=>openTaskDetail(card.dataset.id,currentUser,currentRole)));
  } catch(err) {
    wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><h4>${err.message}</h4></div>`;
  }
}

async function loadTasksList(currentUser, currentRole, currentDept) {
  const list   = document.getElementById('tasks-list');
  const filter = document.getElementById('task-filter')?.value||'mine';
  list.innerHTML = '<div class="loading-placeholder">Loading…</div>';
  const isPriv = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance';

  const userDepts = window.currentDepts || [];
  let snap;
  if (filter==='mine') {
    snap = await db.collection('tasks').where('assignedTo','array-contains',currentUser.uid).get()
      .catch(()=>db.collection('tasks').where('assignedTo','==',currentUser.uid).get());
  } else if (isPriv||filter==='all') {
    snap = typeof dbCachedGet==='function'
      ? await dbCachedGet('tasks-all', ()=>db.collection('tasks').get(), 30000)
      : await db.collection('tasks').get();
  } else if (filter==='dept') {
    // Show all tasks from the user's departments
    snap = typeof dbCachedGet==='function'
      ? await dbCachedGet('tasks-all', ()=>db.collection('tasks').get(), 30000)
      : await db.collection('tasks').get();
  } else {
    // Status filter — fetch all dept tasks so employees can see overdue etc. across their dept
    snap = typeof dbCachedGet==='function'
      ? await dbCachedGet('tasks-all', ()=>db.collection('tasks').get(), 30000)
      : await db.collection('tasks').get();
  }

  let tasks = snap.docs.map(d=>normTask(d.data(),d.id)).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  // For non-admin: filter to dept tasks or their own tasks
  if (!isPriv && filter!=='mine') {
    tasks = tasks.filter(t=>
      userDepts.includes(t.department) ||
      (t.assignedTo||[]).includes(currentUser.uid) ||
      t.createdBy===currentUser.uid
    );
  }
  if (filter!=='mine'&&filter!=='all'&&filter!=='dept') tasks=tasks.filter(t=>t.status===filter);
  if (!tasks.length) { list.innerHTML=`<div class="empty-state"><div class="empty-icon">✅</div><h4>No tasks found</h4></div>`; return; }

  // For employees in "My Tasks" view, group into active and completed sections
  const COMPLETED_STATUSES = ['approved','archived','on-hold'];
  if (filter==='mine' && !isPriv) {
    const active    = tasks.filter(t=>!COMPLETED_STATUSES.includes(t.status));
    const completed = tasks.filter(t=>COMPLETED_STATUSES.includes(t.status));
    list.innerHTML = `
      ${active.length ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:8px">Active (${active.length})</div>
        <div class="item-list" style="margin-bottom:20px">${active.map(t=>taskCard(t)).join('')}</div>
      ` : '<div class="empty-state" style="padding:16px"><div class="empty-icon">✅</div><p>No active tasks</p></div>'}
      ${completed.length ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:8px;margin-top:8px">Completed / On Hold (${completed.length})</div>
        <div class="item-list">${completed.map(t=>taskCard(t)).join('')}</div>
      ` : ''}
    `;
  } else {
    list.innerHTML = tasks.map(t=>taskCard(t)).join('');
  }
  list.querySelectorAll('.item-card').forEach(card=>card.addEventListener('click',()=>openTaskDetail(card.dataset.id,currentUser,currentRole)));
}

function closeTaskPanel() {
  const panel = document.getElementById('task-fullscreen-panel');
  if (!panel) return;
  panel.style.transform = 'translateY(100%)';
  panel.style.opacity = '0';
  setTimeout(() => panel.remove(), 320);
}
window.closeTaskPanel = closeTaskPanel;
window.openTaskDetail = openTaskDetail;

async function openTaskDetail(taskId, currentUser, currentRole) {
  const snap = await db.collection('tasks').doc(taskId).get();
  if (!snap.exists) { Notifs.showToast('Task not found','error'); return; }
  const t       = normTask(snap.data(),snap.id);
  // Task edit gating: admin/finance roles — this MUST match the Firestore tasks
  // update rule (assignee-or-finance-or-admin → isFinanceOrAdmin()). Dept
  // membership alone does NOT grant task edit/reassign/score/follow-up (that would
  // surface buttons the backend rejects). 'owner' is legacy/unused in ROLES.
  const isAdmin = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance';
  const isAssignee = t.assignedTo.includes(currentUser.uid);
  const isCreator  = t.createdBy===currentUser.uid;
  const canEdit    = isAdmin||isAssignee||isCreator;
  const canSubmit  = isAssignee&&!['submitted','review','approved','on-hold','archived'].includes(t.status);
  const allowedStatuses = isAdmin?TASK_STATUSES:TASK_STATUSES.filter(s=>EMP_STATUSES.includes(s.value));

  // Follow-up requests — admin asks the assignee(s) for an update; assignees (or
  // admins) mark them addressed. Wrapped in #fu-section so the panel can refresh it
  // in place after each action (no full teardown). HTML built by followUpCardInner.
  const fuFlags = { isAdmin, isAssignee, isCreator };
  const followUpSectionHtml = `<div id="fu-section">${followUpCardInner(t, fuFlags)}</div>`;

  // Remove existing panel
  document.getElementById('task-fullscreen-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'task-fullscreen-panel';
  panel.style.cssText = `
    position:fixed;
    top:calc(var(--topbar-h) + env(safe-area-inset-top,0px));
    left:0;right:0;bottom:0;
    background:var(--bg);
    z-index:4000;
    display:flex;flex-direction:column;
    transform:translateY(100%);
    opacity:0;
    transition:transform 0.32s cubic-bezier(.4,0,.2,1),opacity 0.32s;
    overflow:hidden;
  `;

  panel.innerHTML = `
    <!-- Top bar inside panel -->
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0">
      <button id="task-panel-back" style="background:none;border:none;color:var(--primary-light);font-size:22px;cursor:pointer;padding:0 4px;line-height:1">‹</button>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(t.title)}</div>
        <div style="display:flex;gap:6px;margin-top:3px;flex-wrap:wrap">
          <span class="badge ${priorityBadge(t.priority)}" style="font-size:10px">${t.priority||'medium'}</span>
          <span class="badge ${statusBadge(t.status)}" style="font-size:10px">${statusLabel(t.status)}</span>
          ${t.department?`<span class="badge badge-gray" style="font-size:10px">🗂 ${t.department}</span>`:''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${canSubmit?`<button class="btn-success btn-sm" id="submit-task-btn">📤 Submit</button>`:''}
        ${canEdit?`<button class="btn-secondary btn-sm" id="edit-task-btn">✎</button>`:''}
        ${isAdmin||isCreator?`<button class="btn-danger btn-sm" id="del-task-btn">${emojiIcon('trash-2',14)}</button>`:''}
      </div>
    </div>

    <!-- Scrollable content + messaging below -->
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <!-- Task info section (scrollable) -->
      <div style="flex:0 0 auto;overflow-y:auto;max-height:42%;padding:16px;border-bottom:1px solid var(--border)" id="task-info-scroll">

        <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap">
          ${t.assignedToNames?.length?`<span>👥 <strong>${escHtml(t.assignedToNames.join(', '))}</strong></span>`:''}
          ${t.dueDate?`<span>📅 Due: <strong style="color:${t.dueDate<today()?'var(--danger)':'inherit'}">${t.dueDate}</strong></span>`:''}
          ${t.createdByName?`<span>🖊 By: ${escHtml(t.createdByName)}</span>`:''}
        </div>

        ${t.description?`<p style="font-size:14px;line-height:1.6;margin-bottom:12px;white-space:pre-wrap;color:var(--text)">${escHtml(t.description)}</p>`:''}

        ${Array.isArray(t.attachments)&&t.attachments.length?`
        <div style="margin-bottom:12px">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted);margin-bottom:6px">📎 Attachments</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${t.attachments.map(a=>{const isLink=a&&(a.source==='link'||a.kind==='link');const url=a&&(a.url||a.driveUrl)||'';return url?`<a href="${escHtml(url)}" target="_blank" rel="noopener" class="file-chip">${isLink?'🔗':'📎'} <span>${escHtml(a.name||(isLink?'Link':'File'))}</span></a>`:'';}).join('')}
          </div>
        </div>`:''}

        <!-- Current Standing -->
        <div style="background:rgba(255,159,10,0.08);border:1.5px solid rgba(255,159,10,0.28);border-radius:10px;padding:12px 14px;margin-bottom:12px">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:rgba(255,159,10,0.9);margin-bottom:6px">📍 Current Standing</div>
          ${t.currentStanding
            ? `<p style="font-size:13px;line-height:1.5;margin:0 0 ${canEdit?'10px':'0'};color:var(--text)">${escHtml(t.currentStanding)}</p>`
            : `<p style="font-size:12px;color:var(--text-muted);margin:0 0 ${canEdit?'10px':'0'}">No standing set yet.</p>`}
          ${canEdit?`<div style="display:flex;gap:6px">
            <input id="cs-input" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)"
              placeholder="e.g. Awaiting materials from supplier…"
              value="${(t.currentStanding||'').replace(/"/g,'&quot;')}"/>
            <button class="btn-primary btn-sm" id="cs-save-btn">Set</button>
          </div>`:''}
        </div>

        ${canEdit?`<div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:10px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:8px">Change Status</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="status-sel" style="flex:1;min-width:160px;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)">
              ${allowedStatuses.map(s=>`<option value="${s.value}"${t.status===s.value?' selected':''}>${s.label}</option>`).join('')}
            </select>
            <button class="btn-primary btn-sm" id="update-status-btn">Update</button>
          </div>
        </div>`:''}

        ${isAdmin?`<div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:10px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px">👥 Add Assignee</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="reassign-sel" style="flex:1;min-width:180px;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)">
              <option value="">— Loading… —</option>
            </select>
            <button class="btn-primary btn-sm" id="designate-btn">+ Add</button>
          </div>
          <input id="task-instruction" placeholder="Note for assignee (optional)…" style="width:100%;margin-top:8px;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)"/>
        </div>`:''}

        ${followUpSectionHtml}

        ${currentRole==='president'&&SCORE_STATUSES.includes(t.status)?`<div style="background:var(--surface2);border:1.5px solid var(--primary-light);border-radius:10px;padding:12px;margin-bottom:10px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--primary-light);margin-bottom:8px">🔒 President Score</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input id="pres-score" type="number" min="1" max="10" step="0.5" value="${t.presidentScore||''}" placeholder="1–10" style="width:80px;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);color:var(--text)" inputmode="decimal"/>
            <span style="font-size:12px;color:var(--text-muted)">/ 10</span>
            <button class="btn-primary btn-sm" id="save-score-btn">Save</button>
          </div>
          ${t.presidentScore?`<div style="margin-top:6px;font-size:12px;color:var(--text-muted)">Current: <strong>${t.presidentScore}/10</strong></div>`:''}
        </div>`:''}
      </div>

      <!-- Messaging section fills remaining space -->
      <div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
        <div id="task-comments-wrap" style="height:100%;display:flex;flex-direction:column"></div>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  if (window.lucide) lucide.createIcons({ nodes: [panel] });
  // Trigger animation
  requestAnimationFrame(() => {
    panel.style.transform = 'translateY(0)';
    panel.style.opacity = '1';
  });
  // v12 WS10 — a real history entry so device/browser Back closes this panel
  // (drill-in detail view) instead of leaving the app or changing pages.
  window.Overlay.push('task', () => window.closeTaskPanel());

  renderComments('tasks',taskId,'task-comments-wrap',currentUser);

  document.getElementById('task-panel-back').addEventListener('click', () => window.Overlay.dismissTop());

  // Current Standing save
  document.getElementById('cs-save-btn')?.addEventListener('click', async () => {
    const val = document.getElementById('cs-input').value.trim();
    const uSnap = await db.collection('users').doc(currentUser.uid).get();
    const actorName = uSnap.exists ? uSnap.data().displayName : currentUser.email;
    await db.collection('tasks').doc(taskId).update({
      currentStanding: val,
      lastModifiedBy: currentUser.uid, lastModifiedByName: actorName,
      lastModifiedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    await notifyTaskInvolved(t, {
      title: '📍 Task Standing Updated',
      body: `"${t.title}" — ${val||'(cleared)'}`,
      icon: '📍', type: 'task_standing', taskId: taskId
    }, currentUser.uid);
    Notifs.showToast('Standing updated!');
    closeTaskPanel(); renderTasks(currentUser, currentRole, t.department);
  });

  // Load employees for designate
  if (isAdmin) {
    db.collection('users').get().then(empSnap=>{
      const sel=document.getElementById('reassign-sel'); if(!sel)return;
      const emps=empSnap.docs.map(d=>({id:d.id,...d.data()})).filter(e=>!t.assignedTo.includes(e.id)).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
      sel.innerHTML=`<option value="">— Select employee —</option>`+emps.map(e=>`<option value="${e.id}" data-name="${escHtml(e.displayName||e.email)}">${escHtml(e.displayName||e.email)}</option>`).join('');
    });
  }

  document.getElementById('update-status-btn')?.addEventListener('click', async()=>{
    const newStatus=document.getElementById('status-sel').value;
    if (newStatus===t.status) { Notifs.showToast('Status unchanged','error'); return; }
    const uSnap=await db.collection('users').doc(currentUser.uid).get();
    const actorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
    await db.collection('tasks').doc(taskId).update({status:newStatus,lastModifiedBy:currentUser.uid,lastModifiedByName:actorName,lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp()});
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    await notifyTaskInvolved(t,{title:'📋 Task Status Updated',body:`"${t.title}" → ${statusLabel(newStatus)} (${actorName})`,icon:'📋',type:'task_status',taskId},currentUser.uid);
    Notifs.showToast(`Status → ${statusLabel(newStatus)}`);
    closeTaskPanel(); renderTasks(currentUser,currentRole,t.department);
  });

  document.getElementById('submit-task-btn')?.addEventListener('click', async()=>{
    const uSnap=await db.collection('users').doc(currentUser.uid).get();
    const actorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
    await db.collection('tasks').doc(taskId).update({status:'review',submittedBy:currentUser.uid,submittedByName:actorName,submittedAt:firebase.firestore.FieldValue.serverTimestamp(),lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp()});
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    await notifyTaskInvolved(t,{title:'📤 Task Submitted for Review',body:`"${t.title}" submitted by ${actorName}`,icon:'📤',type:'task_submitted',taskId},currentUser.uid);
    Notifs.showToast('Submitted for review!');
    closeTaskPanel(); renderTasks(currentUser,currentRole,t.department);
  });

  document.getElementById('edit-task-btn')?.addEventListener('click',()=>{ closeTaskPanel(); openEditTaskModal(taskId,t,currentUser,currentRole); });

  document.getElementById('del-task-btn')?.addEventListener('click', async()=>{
    if (!(await confirmDialog({message:'Delete this task?', danger:true}))) return;
    await db.collection('tasks').doc(taskId).delete();
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    closeTaskPanel(); renderTasks(currentUser,currentRole,t.department);
  });

  document.getElementById('designate-btn')?.addEventListener('click', async()=>{
    const sel=document.getElementById('reassign-sel');
    const newUid=sel.value; const newName=sel.options[sel.selectedIndex]?.dataset.name||'';
    const note=document.getElementById('task-instruction')?.value.trim();
    if (!newUid) { Notifs.showToast('Select an employee','error'); return; }
    const uSnap=await db.collection('users').doc(currentUser.uid).get();
    const actorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
    const update={assignedTo:[...t.assignedTo,newUid],assignedToNames:[...t.assignedToNames,newName],lastModifiedBy:currentUser.uid,lastModifiedByName:actorName,lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp()};
    if (note) update.description=(t.description||'')+`\n\n📝 ${actorName}: ${note}`;
    await db.collection('tasks').doc(taskId).update(update);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    await Notifs.send(newUid,{title:'🎯 Task Assigned to You',body:`"${t.title}" assigned by ${actorName}${note?' — '+note:''}`,icon:'🎯',type:'task_designated',taskId});
    await Notifs.sendToOwner({title:'👥 Task Assignee Added',body:`${actorName} added ${newName} to "${t.title}"`,icon:'👥',type:'task_modified',taskId});
    Notifs.showToast(`${newName} added`);
    closeTaskPanel(); renderTasks(currentUser,currentRole,t.department);
  });

  // Follow-up requests — re-render the #fu-section in place after each action
  // (no panel teardown) and keep the list-card badge in sync.
  async function reloadFollowUps(){
    try{
      const fresh=await db.collection('tasks').doc(taskId).get();
      if(fresh.exists){ const ft=normTask(fresh.data(),taskId); t.followUps=ft.followUps; t.openFollowUpCount=ft.openFollowUpCount; }
    }catch(e){ console.warn('[followups] reload failed',e); }
    const sec=document.getElementById('fu-section');
    if(sec){ sec.innerHTML=followUpCardInner(t,fuFlags); bindFollowUps(); }
    updateCardFollowUpBadge(taskId, t.openFollowUpCount||0);
  }

  // Admin → assignee: record a follow-up request. Re-fetches first so a concurrent
  // follow-up isn't clobbered, and notifies against the freshest assignee set.
  async function onRequestFollowUp(){
    const input=document.getElementById('fu-input');
    const msg=(input?.value||'').trim();
    const btn=document.getElementById('fu-request-btn'); if(btn) btn.disabled=true;
    try{
      const uSnap=await db.collection('users').doc(currentUser.uid).get();
      const actorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
      const entry={
        id:db.collection('tasks').doc().id, // collision-free auto-id (join key for "addressed")
        message:msg||'Please provide an update.',
        byUid:currentUser.uid, byName:actorName,
        at:firebase.firestore.Timestamp.now(), status:'pending'
      };
      const fresh=await db.collection('tasks').doc(taskId).get();
      const ft=fresh.exists?normTask(fresh.data(),taskId):t;
      const followUps=[...(ft.followUps||[]),entry];
      await db.collection('tasks').doc(taskId).update({
        followUps,
        openFollowUpCount: followUps.filter(f=>f.status!=='addressed').length,
        lastFollowUpAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastFollowUpByName: actorName,
        lastModifiedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('tasks-all');
      await notifyTaskInvolved(ft,{title:'📣 Follow-up Requested',body:`"${ft.title}" — ${actorName}: ${entry.message}`,icon:'📣',type:'task_followup',taskId},currentUser.uid);
      if(input) input.value='';
      Notifs.showToast('Follow-up sent');
      await reloadFollowUps();
    }catch(e){
      console.error('[followups] request failed',e);
      Notifs.showToast('Could not send follow-up','error');
      if(btn) btn.disabled=false;
    }
  }

  // Assignee or admin: mark a follow-up addressed. Re-fetches so a concurrent
  // follow-up isn't clobbered; pings the requester + owner audit on resolution.
  async function onAddressFollowUp(fuId){
    try{
      const uSnap=await db.collection('users').doc(currentUser.uid).get();
      const actorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
      const fresh=await db.collection('tasks').doc(taskId).get();
      const arr=(fresh.exists?(fresh.data().followUps||[]):[]).map(f=>f.id===fuId?{...f,status:'addressed',addressedByUid:currentUser.uid,addressedByName:actorName,addressedAt:firebase.firestore.Timestamp.now()}:f);
      const target=arr.find(f=>f.id===fuId);
      await db.collection('tasks').doc(taskId).update({
        followUps:arr,
        openFollowUpCount:arr.filter(f=>f.status!=='addressed').length,
        lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('tasks-all');
      if (target&&target.byUid&&target.byUid!==currentUser.uid) {
        await Notifs.send(target.byUid,{title:'✅ Follow-up Addressed',body:`${actorName} addressed your follow-up on "${t.title}"`,icon:'✅',type:'task_followup_done',taskId});
      }
      await Notifs.sendToOwner({title:'✅ Follow-up Addressed',body:`${actorName} addressed a follow-up on "${t.title}"`,icon:'✅',type:'task_followup_done',taskId});
      Notifs.showToast('Marked addressed');
      await reloadFollowUps();
    }catch(e){
      console.error('[followups] mark-addressed failed',e);
      Notifs.showToast('Could not update follow-up','error');
    }
  }

  function bindFollowUps(){
    document.getElementById('fu-request-btn')?.addEventListener('click', onRequestFollowUp);
    document.querySelectorAll('#fu-section .fu-addr-btn').forEach(b=>b.addEventListener('click', ()=>onAddressFollowUp(b.dataset.fu)));
  }
  bindFollowUps();

  document.getElementById('save-score-btn')?.addEventListener('click', async()=>{
    const score=parseFloat(document.getElementById('pres-score').value);
    if (!score||score<1||score>10) { Notifs.showToast('Enter 1–10','error'); return; }
    await db.collection('tasks').doc(taskId).update({presidentScore:score});
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    for (const uid of t.assignedTo) await recomputePresidentTaskScore(uid);
    Notifs.showToast('Score saved & KPI updated!');
    closeTaskPanel(); renderTasks(currentUser,currentRole,t.department);
  });
}

async function recomputePresidentTaskScore(uid) {
  try {
    const snap = await db.collection('tasks').where('assignedTo','array-contains',uid).get()
      .catch(()=>db.collection('tasks').where('assignedTo','==',uid).get());
    const scored = snap.docs.map(d=>d.data()).filter(t=>typeof t.presidentScore==='number');
    if (!scored.length) return;
    const avg = Math.round(scored.reduce((s,t)=>s+t.presidentScore,0)/scored.length*10)/10;
    await db.collection('kpi_evals').doc(uid).set({presidentGradeFromTasks:avg,presidentScoreTaskCount:scored.length},{merge:true});
  } catch(e) { console.warn('[recomputePresidentTaskScore]',e); }
}

async function openEditTaskModal(taskId, t, currentUser, currentRole) {
  // Task edit gating: admin roles only — MUST match the Firestore tasks update
  // rule (assignee-or-admin), so we don't render an assignment dropdown the
  // backend will reject for a non-admin dept member.
  const isAdmin = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance';
  let employees=[];
  if (isAdmin) {
    const empSnap = await dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]}));
    employees = empSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  }
  const deptOptions = Object.keys(window.DEPARTMENTS||{}).map(k=>`<option value="${k}"${t.department===k?' selected':''}>${k}</option>`).join('');
  const allowedStatuses = isAdmin?TASK_STATUSES:TASK_STATUSES.filter(s=>EMP_STATUSES.includes(s.value));

  openPage('Edit Task', `
    <div class="form-group"><label>Title</label><input id="et-title" value="${(t.title||'').replace(/"/g,'&quot;')}"/></div>
    <div class="form-group"><label>Description</label><textarea id="et-desc" rows="3">${escHtml(t.description||'')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Priority</label>
        <select id="et-priority">
          ${['low','medium','high','urgent'].map(p=>`<option value="${p}"${t.priority===p?' selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Due Date</label><input id="et-due" type="date" value="${t.dueDate||today()}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Status</label>
        <select id="et-status">
          ${allowedStatuses.map(s=>`<option value="${s.value}"${t.status===s.value?' selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Department</label>
        <select id="et-dept"><option value="">— None —</option>${deptOptions}</select>
      </div>
    </div>
    ${isAdmin?`<div class="form-group">
      <label>Assignees (remove: click chip; add: select below)</label>
      <div id="assignee-chips" style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap">
        ${t.assignedToNames.map((name,i)=>`<span class="badge badge-blue" style="cursor:pointer" data-uid="${t.assignedTo[i]}">${escHtml(name)} ✕</span>`).join('')}
      </div>
      <select id="et-add-assignee" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="">— Add assignee —</option>
        ${employees.filter(e=>!t.assignedTo.includes(e.id)).map(e=>`<option value="${e.id}" data-name="${escHtml(e.displayName||e.email)}">${escHtml(e.displayName||e.email)}</option>`).join('')}
      </select>
    </div>`:''}
  `, `<button class="btn-primary" id="save-edit-btn">Save Changes</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  let curAssignees=t.assignedTo.map((uid,i)=>({uid,name:t.assignedToNames[i]||uid}));
  document.getElementById('assignee-chips')?.querySelectorAll('.badge').forEach(chip=>{
    chip.addEventListener('click',()=>{ curAssignees=curAssignees.filter(a=>a.uid!==chip.dataset.uid); chip.remove(); });
  });
  document.getElementById('et-add-assignee')?.addEventListener('change',e=>{
    const uid=e.target.value; const name=e.target.options[e.target.selectedIndex]?.dataset.name||'';
    if (!uid||curAssignees.some(a=>a.uid===uid)){e.target.value='';return;}
    curAssignees.push({uid,name});
    const chips=document.getElementById('assignee-chips');
    const chip=document.createElement('span'); chip.className='badge badge-blue'; chip.style.cursor='pointer'; chip.dataset.uid=uid;
    chip.textContent=`${name} ✕`;
    chip.addEventListener('click',()=>{ curAssignees=curAssignees.filter(a=>a.uid!==uid); chip.remove(); });
    chips?.appendChild(chip); e.target.value='';
  });

  document.getElementById('save-edit-btn').addEventListener('click', async()=>{
    const title=document.getElementById('et-title').value.trim();
    if (!title){Notifs.showToast('Title required','error');return;}
    const uSnap=await db.collection('users').doc(currentUser.uid).get();
    const actorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
    const update={
      title,
      description:document.getElementById('et-desc').value.trim(),
      priority:document.getElementById('et-priority').value,
      dueDate:document.getElementById('et-due').value,
      status:document.getElementById('et-status').value,
      department:document.getElementById('et-dept').value,
      lastModifiedBy:currentUser.uid,lastModifiedByName:actorName,
      lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp()
    };
    if (isAdmin){update.assignedTo=curAssignees.map(a=>a.uid);update.assignedToNames=curAssignees.map(a=>a.name);}
    await db.collection('tasks').doc(taskId).update(update);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    const updatedTask={...t,assignedTo:update.assignedTo||t.assignedTo};
    // Build a SPECIFIC change summary so the notification says what actually changed
    const changes=[];
    if ((t.title||'')!==title) changes.push('renamed');
    if ((t.status||'')!==update.status) changes.push(`status → ${statusLabel(update.status)}`);
    if ((t.priority||'')!==update.priority) changes.push(`priority → ${update.priority}`);
    if ((t.dueDate||'')!==(update.dueDate||'')) changes.push(`due date → ${update.dueDate||'none'}`);
    if ((t.department||'')!==(update.department||'')) changes.push(`dept → ${update.department||'none'}`);
    if ((t.description||'')!==update.description) changes.push('description updated');
    if (isAdmin){
      const oldA=(t.assignedTo||[]).slice().sort().join(','), newA=(update.assignedTo||[]).slice().sort().join(',');
      if (oldA!==newA) changes.push('assignees changed');
    }
    const summary = changes.length ? changes.join(', ') : 'edited';
    await notifyTaskInvolved(updatedTask,{title:'✏️ Task Updated',body:`"${title}" — ${summary} (by ${actorName})`,icon:'✏️',type:'task_edited',taskId},currentUser.uid);
    Notifs.showToast('Task updated!');
    closeModal(); renderTasks(currentUser,currentRole,update.department||t.department);
  });
}

async function openAddTaskModal(currentUser, currentRole, defaultDept) {
  const empSnap  = await dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]}));
  const employees= empSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const deptOptions = Object.keys(window.DEPARTMENTS||{}).map(k=>`<option value="${k}"${k===defaultDept?' selected':''}>${k}</option>`).join('');

  openPage('New Task', `
    <div class="form-group"><label>Title</label><input id="t-title" placeholder="Task name"/></div>
    <div class="form-group"><label>Description</label><textarea id="t-desc" rows="3" placeholder="Details…"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Priority</label>
        <select id="t-priority">
          <option value="low">🟢 Low</option><option value="medium" selected>🟡 Medium</option>
          <option value="high">🔴 High</option><option value="urgent">🚨 Urgent</option>
        </select>
      </div>
      <div class="form-group"><label>Status</label>
        <select id="t-status">
          ${TASK_STATUSES.map(s=>`<option value="${s.value}"${s.value==='backlog'?' selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Due Date</label><input id="t-due" type="date" value="${today()}"/></div>
      <div class="form-group"><label>Department</label>
        <select id="t-dept"><option value="">— Select —</option>${deptOptions}</select>
      </div>
    </div>
    <div class="form-group">
      <label>Assign To (can add multiple)</label>
      <select id="t-assignee-sel" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="">— Add assignee —</option>
        ${employees.map(e=>`<option value="${e.id}" data-name="${escHtml(e.displayName||e.email)}">${escHtml(e.displayName||e.email)}${e.email?' ('+escHtml(e.email)+')':''}</option>`).join('')}
      </select>
      <div id="new-assignee-chips" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"></div>
    </div>
    <div class="form-group"><label>Notes / Instructions</label>
      <textarea id="t-notes" rows="2" placeholder="Additional notes for assignees…"></textarea>
    </div>
    <div id="task-attach-area"></div>
  `, `<button class="btn-primary" id="create-task-btn">Create Task</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  let taskAttachments=[];
  Drive.renderUploadArea('task-attach-area',r=>{taskAttachments.push(r);},{label:'📎 Attach file or link',dept:'tasks',subfolder:'attachments'});

  let newAssignees=[];
  document.getElementById('t-assignee-sel').addEventListener('change',e=>{
    const uid=e.target.value; const name=e.target.options[e.target.selectedIndex]?.dataset.name||'';
    if (!uid||newAssignees.some(a=>a.uid===uid)){e.target.value='';return;}
    newAssignees.push({uid,name});
    const chips=document.getElementById('new-assignee-chips');
    const chip=document.createElement('span'); chip.className='badge badge-blue'; chip.style.cursor='pointer';
    chip.textContent=`${name} ✕`;
    chip.addEventListener('click',()=>{ newAssignees=newAssignees.filter(a=>a.uid!==uid); chip.remove(); });
    chips.appendChild(chip); e.target.value='';
  });

  document.getElementById('create-task-btn').addEventListener('click', async()=>{
    const title=document.getElementById('t-title').value.trim();
    if (!title){Notifs.showToast('Enter a task title','error');return;}
    const uSnap=await db.collection('users').doc(currentUser.uid).get();
    const creatorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
    const desc=document.getElementById('t-desc').value.trim();
    const notes=document.getElementById('t-notes').value.trim();
    const taskRef = await db.collection('tasks').add({
      title, description:notes?`${desc}\n\n📝 Instructions: ${notes}`:desc,
      priority:document.getElementById('t-priority').value,
      status:document.getElementById('t-status').value,
      dueDate:document.getElementById('t-due').value,
      department:document.getElementById('t-dept').value,
      assignedTo:newAssignees.map(a=>a.uid),
      assignedToNames:newAssignees.map(a=>a.name),
      attachments:taskAttachments,
      createdBy:currentUser.uid,createdByName:creatorName,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    const taskId = taskRef.id;
    for (const a of newAssignees) {
      await Notifs.send(a.uid,{title:'📌 New Task Assigned',body:`"${title}" assigned by ${creatorName}`,icon:'📌',type:'task_assigned',taskId,dedupKey:`task-assigned-${taskId}-${a.uid}`});
    }
    await Notifs.sendToOwner({title:'📌 New Task Created',body:`${creatorName} created "${title}"`,icon:'📌',type:'task_created',dedupKey:`task-created-${taskId}`});
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    closeModal(); Notifs.showToast('Task created!');
    renderTasks(currentUser,currentRole,document.getElementById('t-dept')?.value||'');
  });
}


// ══════════════════════════════════════════════════
//  SUBMISSIONS
// ══════════════════════════════════════════════════
window.renderSubmissions = async function(currentUser, currentRole, currentDept) {
  const c = deptContainer();
  c.innerHTML = `
    <div class="page-header">
      <h2>${emojiIcon('clipboard-list',20)} Submissions</h2>
      <button class="btn-primary btn-sm" id="add-sub-btn">+ New Submission</button>
    </div>
    <div id="subs-list" class="item-list"><div class="loading-placeholder">Loading…</div></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadSubsList(currentUser, currentRole, currentDept);
  document.getElementById('add-sub-btn').onclick = () => openAddSubModal(currentUser);
};

async function loadSubsList(currentUser, currentRole, currentDept) {
  const list = document.getElementById('subs-list');
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager' || currentRole === 'finance';
  const snap = isPrivileged
    ? await db.collection('submissions').get()
    : await db.collection('submissions').where('createdBy','==',currentUser.uid).get();

  const subs = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  if (!subs.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><h4>No submissions yet</h4></div>`; return; }

  list.innerHTML = subs.map(s => `
    <div class="item-card" data-id="${s.id}">
      <div class="item-top">
        <div class="item-title">${escHtml(s.title)}</div>
        <span class="badge ${statusBadge(s.status)}">${s.status||'pending'}</span>
      </div>
      <div class="item-meta">
        <span class="badge badge-gray">${escHtml(s.type||'General')}</span>
        ${s.submittedByName?`<span>👤 ${escHtml(s.submittedByName)}</span>`:''}
        ${s.createdAt?`<span>📅 ${new Date(s.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => openSubDetail(card.dataset.id, currentUser, currentRole));
  });
}

async function openSubDetail(subId, currentUser, currentRole) {
  const snap = await db.collection('submissions').doc(subId).get();
  const s = {id:snap.id,...snap.data()};
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager' || currentRole === 'finance';

  openModal(s.title, `
    <div style="margin-bottom:10px">
      <span class="badge ${statusBadge(s.status)}">${s.status||'pending'}</span>
      <span class="badge badge-gray" style="margin-left:6px">${escHtml(s.type||'General')}</span>
    </div>
    <p style="font-size:14px;line-height:1.6;margin-bottom:12px">${escHtml(s.description||'No details.')}</p>
    ${s.fileUrl?`<a href="${escHtml(s.fileUrl)}" target="_blank" rel="noopener" class="btn-secondary" style="display:inline-flex;gap:6px;margin-bottom:14px">${s.fileSource==='link'?'🔗':'📎'} ${escHtml(s.fileName||(s.fileSource==='link'?'Open Link':'View Attachment'))}</a>`:''}
    ${isPrivileged?`<div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn-success" id="approve-btn" data-id="${s.id}">✅ Approve</button>
      <button class="btn-danger" id="reject-btn" data-id="${s.id}">❌ Reject</button>
    </div>`:''}
    <hr class="divider"/>
    <div id="sub-comments-wrap"></div>
  `, `<button class="btn-secondary" onclick="closeModal()">Close</button>`);

  renderComments('submissions', subId, 'sub-comments-wrap', currentUser);
  document.getElementById('approve-btn')?.addEventListener('click', async e => {
    await db.collection('submissions').doc(e.currentTarget.dataset.id).update({status:'approved'});
    if (s.createdBy) await Notifs.send(s.createdBy, {title:'✅ Submission Approved',body:`"${s.title}" was approved.`,icon:'✅',type:'submission_reviewed'});
    closeModal(); renderSubmissions(currentUser, currentRole, '');
  });
  document.getElementById('reject-btn')?.addEventListener('click', async e => {
    await db.collection('submissions').doc(e.currentTarget.dataset.id).update({status:'rejected'});
    if (s.createdBy) await Notifs.send(s.createdBy, {title:'❌ Submission Rejected',body:`"${s.title}" was rejected.`,icon:'❌',type:'submission_reviewed'});
    closeModal(); renderSubmissions(currentUser, currentRole, '');
  });
}

function openAddSubModal(currentUser) {
  openPage('New Submission', `
    <div class="form-group"><label>Title</label><input id="s-title" placeholder="Submission title"/></div>
    <div class="form-group"><label>Type</label>
      <select id="s-type">
        <option>Leave Request</option><option>Expense Report</option>
        <option>Overtime Request</option><option>Report</option>
        <option>Purchase Request</option><option>Other</option>
      </select>
    </div>
    <div class="form-group"><label>Details</label><textarea id="s-desc" rows="4" placeholder="Describe your submission…"></textarea></div>
    <div id="sub-file-upload"></div>
  `, `<button class="btn-primary" id="create-sub-btn">Submit</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  let uploadedFile = null;
  Drive.renderUploadArea('sub-file-upload', (result) => { uploadedFile = result; }, { label:'Attach a file or link (optional)', accept:'*' });

  document.getElementById('create-sub-btn').addEventListener('click', async () => {
    const snap = await db.collection('users').doc(currentUser.uid).get();
    const name = snap.exists ? snap.data().displayName : currentUser.email;
    await db.collection('submissions').add({
      title:           document.getElementById('s-title').value.trim(),
      type:            document.getElementById('s-type').value,
      description:     document.getElementById('s-desc').value.trim(),
      status:          'pending',
      createdBy:       currentUser.uid,
      submittedByName: name,
      fileUrl:         uploadedFile?.url || null,
      fileName:        uploadedFile?.name || null,
      fileSource:      uploadedFile?.source || null,
      createdAt:       firebase.firestore.FieldValue.serverTimestamp()
    });
    // Notify owner
    await Notifs.sendToOwner({ title:'📋 New Submission', body:`${name} submitted: "${document.getElementById('s-title').value.trim()}"`, icon:'📋', type:'submission_new' });
    closeModal();
    Notifs.showToast('Submission sent!');
    renderSubmissions(currentUser, window.currentRole || '', (window.currentDepts||[])[0] || '');
  });
}

// ══════════════════════════════════════════════════
//  CASH / EXPENSE MODULE
// ══════════════════════════════════════════════════
window.renderCash = async function(currentUser, currentRole) {
  const c = deptContainer();
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'finance';

  c.innerHTML = `
    <div class="page-header"><h2>💸 Cash & Expenses</h2>
      <button class="btn-primary btn-sm" id="add-expense-btn">+ Add Expense</button>
    </div>
    ${isPrivileged?`
      <div class="subtab-bar">
        <button class="subtab-btn active" data-sub="my-expenses">My Expenses</button>
        <button class="subtab-btn" data-sub="all-expenses">All Expenses</button>
        <button class="subtab-btn" data-sub="summary">Summary</button>
      </div>
    `:''}
    <div id="cash-content"><div class="loading-placeholder">Loading…</div></div>
  `;

  loadCashContent(currentUser, currentRole, 'my-expenses');
  document.getElementById('add-expense-btn').onclick = () => openAddExpenseModal(currentUser);

  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadCashContent(currentUser, currentRole, btn.dataset.sub);
    });
  });
};

async function loadCashContent(currentUser, currentRole, sub) {
  const content = document.getElementById('cash-content');
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'finance';
  content.innerHTML = '<div class="loading-placeholder">Loading…</div>';

  if (sub === 'my-expenses' || !isPrivileged) {
    const snap = await db.collection('expenses').where('createdBy','==',currentUser.uid).get();
    const expenses = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    if (!expenses.length) { content.innerHTML = `<div class="empty-state"><div class="empty-icon">💸</div><h4>No expenses yet</h4></div>`; return; }
    content.innerHTML = expenseTable(expenses, isPrivileged);
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    bindExpenseActions(content, currentUser, currentRole, sub);
  } else if (sub === 'all-expenses') {
    const snap = await db.collection('expenses').get().catch(()=>({docs:[]}));
    const expenses = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    content.innerHTML = expenseTable(expenses, true);
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    bindExpenseActions(content, currentUser, currentRole, sub);
  } else if (sub === 'summary') {
    const snap = await db.collection('expenses').get().catch(()=>({docs:[]}));
    const expenses = snap.docs.map(d => d.data());
    const total     = expenses.reduce((s,e) => s + (e.amount||0), 0);
    const approved  = expenses.filter(e => e.status==='approved').reduce((s,e) => s + (e.amount||0), 0);
    const pending   = expenses.filter(e => e.status==='pending').reduce((s,e) => s + (e.amount||0), 0);
    content.innerHTML = `
      <div class="kpi-row">
        <div class="kpi-card"><div class="kpi-label">Total Submitted</div><div class="kpi-value">₱${fmt(total)}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Approved</div><div class="kpi-value">₱${fmt(approved)}</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Pending</div><div class="kpi-value">₱${fmt(pending)}</div></div>
      </div>
    `;
  }
}

function expenseTable(expenses, showActions) {
  return `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Description</th><th>Category</th><th>Amount</th><th>Date</th><th>By</th><th>Status</th>${showActions?'<th></th>':''}</tr></thead>
          <tbody>
            ${expenses.map(e => `
              <tr>
                <td>${escHtml(e.description)}</td>
                <td><span class="badge badge-gray">${escHtml(e.category||'General')}</span></td>
                <td>₱${fmt(e.amount)}</td>
                <td>${e.date||'—'}</td>
                <td>${escHtml(e.submittedByName||'—')}</td>
                <td><span class="badge ${statusBadge(e.status)}">${e.status||'pending'}</span></td>
                ${showActions?`<td>
                  ${e.status==='pending'?`<button class="btn-icon approve-expense" data-id="${e.id}">${emojiIcon('check-circle',14)}</button><button class="btn-icon reject-expense" data-id="${e.id}">${emojiIcon('x-circle',14)}</button>`:''}
                  ${e.fileUrl?`<a href="${safeHttpUrl(e.fileUrl)}" target="_blank" class="btn-icon">📎</a>`:''}
                </td>`:''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Post an approved expense into the ledger as a debit (idempotent, keyed EXP-<id>).
// Shared by the approve action and the one-time backfill. Returns true if it posted.
async function postExpenseToLedger(expId, e) {
  const ref = `EXP-${expId}`;
  const existing = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>({docs:[]}));
  if (existing.docs.length) return false;
  const date = e.date || today();
  await window.assertPeriodOpen(date);
  const category = e.category || 'General Expense';
  await db.collection('ledger').add({
    date, type: 'debit',
    accountType: 'expense', account: category,
    description: `Expense — ${e.description||''}${e.submittedByName?` (${e.submittedByName})`:''}`,
    amount:      e.amount || 0,
    category,
    refNumber:   ref,
    source:      'Expense',
    addedBy:     window.currentUser?.uid || null,
    addedByName: window.userProfile?.displayName || window.currentUser?.email || '',
    createdAt:   firebase.firestore.FieldValue.serverTimestamp()
  });
  if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('ledger'); dbCacheInvalidate('expenses'); }
  return true;
}

// New income from a cash receipt = Sales Revenue + Sundry income. AR collections
// are EXCLUDED — that money was already booked as income when the sale was recorded.
function crjLedgerIncome(e) { return (e.creditSalesRevenue||0) + (e.creditSundryAmount||0); }
async function postCRJToLedger(crjId, e) {
  const ref = `CRJ-${crjId}`;
  const existing = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>({docs:[]}));
  if (existing.docs.length) return false;
  const income = crjLedgerIncome(e);
  if (income <= 0) return false; // pure A/R collection — already counted at sale time
  const date = e.date || today();
  await window.assertPeriodOpen(date);
  const category = (e.creditSalesRevenue||0) >= (e.creditSundryAmount||0) ? 'Sales Revenue' : (e.creditSundryAcct||'Other Income');
  await db.collection('ledger').add({
    date, type: 'credit',
    accountType: 'income', account: category,
    description: `Cash receipt — ${e.customer||''}${e.reference?` (${e.reference})`:''}`,
    amount: income,
    category,
    refNumber: ref, source: 'Cash Receipt',
    addedBy:     window.currentUser?.uid || null,
    addedByName: window.userProfile?.displayName || window.currentUser?.email || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
  return true;
}

// New expense from a disbursement = Material + Labor + Sundry. A/P settlements are
// EXCLUDED — that cost was already expensed when the payable was incurred.
// debitAccount (v12 WS13): 'inventory' (stock materials — posts as an ASSET, not
// an expense, until Production consumes it) vs 'material'/'sundry' (still direct
// expense, e.g. a purchase that never touches stock). This is the fix for the
// double-material-expensing bug — see consumeProductionMaterials for the other half.
function cdjLedgerExpense(e) { return (e.debitMaterial||0) + (e.debitLabor||0) + (e.debitSundryAmount||0); }
async function postCDJToLedger(cdjId, e) {
  const ref = `CDJ-${cdjId}`;
  const existing = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>({docs:[]}));
  if (existing.docs.length) return false;
  const expense = cdjLedgerExpense(e);
  if (expense <= 0) return false; // pure A/P settlement — already expensed when incurred
  const date = e.date || today();
  await window.assertPeriodOpen(date);
  let category;
  const mat = e.debitMaterial||0, lab = e.debitLabor||0, sun = e.debitSundryAmount||0;
  if (mat >= lab && mat >= sun) category = 'COS – Direct Material';
  else if (lab >= sun) category = 'COS – Direct Labor';
  else category = e.debitSundryAcct || 'Other Expense';
  const isInventory = e.debitAccount === 'inventory';
  const accountType = isInventory ? 'asset' : 'expense';
  const account = isInventory ? 'Inventory' : category;
  if (isInventory) category = 'Inventory – Materials';
  await db.collection('ledger').add({
    date, type: 'debit',
    accountType, account,
    description: `Disbursement — ${e.payee||''}${e.reference?` (${e.reference})`:''}`,
    amount: expense, category, refNumber: ref, source: 'Cash Disbursement',
    // input VAT (reclaimable) carried through for the Net VAT Payable computation
    inputVat: e.vatAmount || 0,
    addedBy:     window.currentUser?.uid || null,
    addedByName: window.userProfile?.displayName || window.currentUser?.email || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
  return true;
}

// Re-sync the mirrored ledger row after a source doc (expense / CRJ / CDJ) is
// EDITED, so the ledger never drifts from the journal. Updates the amount/type/
// category in place, creates the row if it should now exist, or deletes it if the
// entry no longer qualifies (e.g. expense un-approved, or income/expense → 0).
async function resyncLedgerForSource(collection, docId) {
  try {
    const snap = await db.collection(collection).doc(docId).get();
    if (!snap.exists) return;
    const e = snap.data();
    let ref, type, amount, category, description, inputVat = null, accountType, account;
    if (collection === 'expenses') {
      ref = `EXP-${docId}`;
      if (e.status !== 'approved') { await _deleteLedgerByRef(ref); return; }
      type = 'debit'; amount = e.amount || 0; category = e.category || 'General Expense';
      description = `Expense — ${e.description || ''}${e.submittedByName ? ` (${e.submittedByName})` : ''}`;
      accountType = 'expense'; account = category;
    } else if (collection === 'cash_receipt_journal') {
      ref = `CRJ-${docId}`; type = 'credit'; amount = crjLedgerIncome(e);
      category = (e.creditSalesRevenue || 0) >= (e.creditSundryAmount || 0) ? 'Sales Revenue' : (e.creditSundryAcct || 'Other Income');
      description = `Cash receipt — ${e.customer || ''}${e.reference ? ` (${e.reference})` : ''}`;
      accountType = 'income'; account = category;
      if (amount <= 0) { await _deleteLedgerByRef(ref); return; }
    } else if (collection === 'cash_disbursement_journal') {
      ref = `CDJ-${docId}`; type = 'debit'; amount = cdjLedgerExpense(e);
      const mat = e.debitMaterial || 0, lab = e.debitLabor || 0, sun = e.debitSundryAmount || 0;
      category = (mat >= lab && mat >= sun) ? 'COS – Direct Material' : (lab >= sun ? 'COS – Direct Labor' : (e.debitSundryAcct || 'Other Expense'));
      description = `Disbursement — ${e.payee || ''}${e.reference ? ` (${e.reference})` : ''}`;
      inputVat = e.vatAmount || 0;
      // Carries the debitAccount choice through on edit (v12 WS13) — an edited
      // disbursement must keep its asset/Inventory tag, not silently drift back
      // to expense-tagged.
      const isInventory = e.debitAccount === 'inventory';
      accountType = isInventory ? 'asset' : 'expense';
      account = isInventory ? 'Inventory' : category;
      if (isInventory) category = 'Inventory – Materials';
      if (amount <= 0) { await _deleteLedgerByRef(ref); return; }
    } else return;
    const existing = await db.collection('ledger').where('refNumber', '==', ref).limit(1).get().catch(() => ({ docs: [] }));
    const patch = { amount, type, category, description, accountType, account };
    if (inputVat != null) patch.inputVat = inputVat;
    if (existing.docs.length) await existing.docs[0].ref.update(patch);
    else if (collection === 'expenses') await postExpenseToLedger(docId, e);
    else if (collection === 'cash_receipt_journal') await postCRJToLedger(docId, e);
    else await postCDJToLedger(docId, e);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
  } catch (err) { console.warn('[ledger resync]', err?.message || err); }
}
async function _deleteLedgerByRef(ref) {
  const ls = await db.collection('ledger').where('refNumber', '==', ref).limit(1).get().catch(() => ({ docs: [] }));
  if (ls.docs.length) { await ls.docs[0].ref.delete().catch(() => {}); if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger'); }
}

// One-time (re-runnable) backfill: post existing approved expenses + all cash
// receipt / disbursement journal entries into the ledger so the books are complete
// before reports switch to ledger-only. Idempotent — each post* helper skips rows
// already mirrored (keyed by EXP-/CRJ-/CDJ-<id>), so running twice is harmless.
window.backfillLedgerFromJournals = async function() {
  const [expSnap, crjSnap, cdjSnap] = await Promise.all([
    db.collection('expenses').where('status','==','approved').get().catch(()=>({docs:[]})),
    db.collection('cash_receipt_journal').get().catch(()=>({docs:[]})),
    db.collection('cash_disbursement_journal').get().catch(()=>({docs:[]}))
  ]);
  // Pre-check closed months so a bulk backfill over historical data never spams
  // the period-closed toast once per row — soft-skip and report a count instead
  // (same convention as backfillPayrollLedger's month-skip).
  let exp=0, crj=0, cdj=0, skipped=0;
  for (const d of expSnap.docs) {
    const e = d.data();
    if (await window.isPeriodClosed(e.date || today())) { skipped++; continue; }
    if (await postExpenseToLedger(d.id, e).catch(()=>false)) exp++;
  }
  for (const d of crjSnap.docs) {
    const e = d.data();
    if (await window.isPeriodClosed(e.date || today())) { skipped++; continue; }
    if (await postCRJToLedger(d.id, e).catch(()=>false)) crj++;
  }
  for (const d of cdjSnap.docs) {
    const e = d.data();
    if (await window.isPeriodClosed(e.date || today())) { skipped++; continue; }
    if (await postCDJToLedger(d.id, e).catch(()=>false)) cdj++;
  }
  if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('ledger'); dbCacheInvalidate('expenses'); }
  return { exp, crj, cdj, skipped };
};

// Recreate missing PAY-{month}-{uid} ledger rows from salary_history. Covers months
// computed while the Compute crash (v11, 'existing' ReferenceError) blocked ledger
// posting — salary_history committed before the crash, so it is the recovery source.
// Idempotent: skips any month+user whose PAY- ref already exists.
window.backfillPayrollLedger = async function() {
  const sh = await db.collection('salary_history').get().catch(()=>({docs:[]}));
  let posted = 0, skipped = 0;
  for (const d of sh.docs) {
    const h = d.data();
    const month = h.month, uid = h.userId || (d.id.includes('_') ? d.id.split('_')[0] : null);
    const net = (h.finalPay != null ? h.finalPay : h.netPay) || 0;
    if (!month || !uid || net <= 0) continue;
    // Soft-skip closed months (v12 WS12) — a bulk recovery tool must never spam
    // a per-row toast; report the count instead.
    if (await window.isPeriodClosed(month + '-01')) { skipped++; continue; }
    const ref = `PAY-${month}-${uid}`;
    const ex = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>null);
    if (!ex || ex.docs.length) continue;   // exists, or read failed — never risk a duplicate
    await db.collection('ledger').add({
      date:        month + '-01',
      type:        'debit',
      accountType: 'expense', account: 'Payroll Expense',
      description: `Payslip — ${h.userName||'?'} (${new Date(month+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'})})`,
      amount:      net,
      category:    'Payroll Expense',
      source:      'Finance',
      refNumber:   ref,
      addedBy:     currentUser.uid,
      addedByName: 'Payroll backfill',
      createdAt:   firebase.firestore.FieldValue.serverTimestamp()
    });
    posted++;
  }
  return { posted, skipped };
};

window.runLedgerBackfill = async function() {
  if (!(await confirmDialog({message:'Sync approved expenses and the cash receipt / disbursement journals into the ledger?\n\nSafe to run repeatedly — already-synced entries are skipped.'}))) return;
  Notifs.showToast('Syncing journals to ledger…');
  try {
    const r = await window.backfillLedgerFromJournals();
    const pay = await window.backfillPayrollLedger();
    const skippedTotal = (r.skipped||0) + (pay.skipped||0);
    Notifs.showToast(`Synced ✓ ${r.exp} expenses, ${r.crj} receipts, ${r.cdj} disbursements${pay.posted?`, ${pay.posted} payroll rows`:''} posted.${skippedTotal?` (${skippedTotal} skipped — closed months)`:''}`);
    const el = document.getElementById('fin-content');
    if (el) window.renderFinancialReports(el, window.currentUser, window.currentRole, 'all');
  } catch (e) { Notifs.showToast('Sync failed: ' + (e.message||e), 'error'); }
};

// Wire the approve / reject buttons in the expense table (previously unbound — the
// buttons did nothing). Approving posts the expense to the ledger.
function bindExpenseActions(content, currentUser, currentRole, sub) {
  content.querySelectorAll('.approve-expense').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const id = btn.dataset.id;
      const snap = await db.collection('expenses').doc(id).get();
      const e = snap.exists ? snap.data() : null;
      if (e && e.status === 'approved') { Notifs.showToast('Already approved.'); return; }
      // Check the period BEFORE flipping status — otherwise a closed month leaves
      // the expense stuck 'approved' with no matching ledger row (v12 WS12).
      if (e) await window.assertPeriodOpen(e.date || today());
      await db.collection('expenses').doc(id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
      if (e) await postExpenseToLedger(id, e);
      Notifs.showToast('Expense approved & posted to ledger ✓');
      loadCashContent(currentUser, currentRole, sub);
    } catch (err) { Notifs.showToast('Approve failed: ' + (err.message||err), 'error'); btn.disabled = false; }
  }));
  content.querySelectorAll('.reject-expense').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await confirmDialog({message:'Reject this expense?'}))) return;
    try {
      await db.collection('expenses').doc(btn.dataset.id).update({ status:'rejected', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
      Notifs.showToast('Expense rejected.');
      loadCashContent(currentUser, currentRole, sub);
    } catch (err) { Notifs.showToast('Reject failed: ' + (err.message||err), 'error'); }
  }));
}

function openAddExpenseModal(currentUser) {
  openPage('Add Expense / Receipt', `
    <div class="form-group"><label>Description</label><input id="e-desc" placeholder="What was this expense for?"/></div>
    <div class="form-row">
      <div class="form-group"><label>Amount (₱)</label><input id="e-amount" type="number" step="0.01" placeholder="0.00" inputmode="decimal"/></div>
      <div class="form-group"><label>Date</label><input id="e-date" type="date" value="${today()}"/></div>
    </div>
    <div class="form-group"><label>Category</label>
      <select id="e-cat">
        <option>Office Supplies</option><option>Transportation</option><option>Meals</option>
        <option>Materials</option><option>Utilities</option><option>Other</option>
      </select>
    </div>
    <div id="expense-file-upload"></div>
  `, `<button class="btn-primary" id="save-expense-btn">Submit Expense</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  let uploadedFile = null;
  Drive.renderUploadArea('expense-file-upload', (result) => { uploadedFile = result; }, { label:'Upload Receipt (photo or PDF)', accept:'image/*,.pdf', dept:'Finance', subfolder:'Receipts' });

  document.getElementById('save-expense-btn').addEventListener('click', async () => {
    const snap = await db.collection('users').doc(currentUser.uid).get();
    const name = snap.exists ? snap.data().displayName : currentUser.email;
    await db.collection('expenses').add({
      description:     document.getElementById('e-desc').value.trim(),
      amount:          parseFloat(document.getElementById('e-amount').value)||0,
      date:            document.getElementById('e-date').value,
      category:        document.getElementById('e-cat').value,
      status:          'pending',
      createdBy:       currentUser.uid,
      submittedByName: name,
      fileUrl:         uploadedFile?.url||null,
      fileName:        uploadedFile?.name||null,
      createdAt:       firebase.firestore.FieldValue.serverTimestamp()
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('expenses');
    window.logAudit && window.logAudit('create','expense',null,{ amount:parseFloat(document.getElementById('e-amount').value)||0, description:document.getElementById('e-desc').value.trim() });
    await Notifs.sendToOwner({ title:'💸 New Expense Submitted', body:`${name} submitted an expense of ₱${document.getElementById('e-amount').value}`, icon:'💸', type:'expense_new' });
    closeModal();
    Notifs.showToast('Expense submitted!');
    renderCash(currentUser, '');
  });
}

// ══════════════════════════════════════════════════
//  COMMENTS — Messenger-style UI with seen receipts
// ══════════════════════════════════════════════════
window.renderComments = async function(collection, docId, containerId, currentUser) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const isAdmin = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager' || currentRole === 'finance';
  const isImage = url => url && /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(url);

  // Fetch comments + readers in parallel
  const [snap, readersSnap] = await Promise.all([
    db.collection(collection).doc(docId).collection('comments').orderBy('createdAt').get(),
    collection === 'tasks'
      ? db.collection(collection).doc(docId).collection('readers').get().catch(()=>({docs:[]}))
      : Promise.resolve({docs:[]})
  ]);
  const comments = snap.docs.map(d => ({id:d.id,...d.data()}));
  const readers  = readersSnap.docs.map(d=>({id:d.id,...d.data()}));

  // Mark current user as read (tasks only)
  if (collection === 'tasks') {
    const myName = userProfile?.displayName || currentUser.email;
    db.collection(collection).doc(docId).collection('readers').doc(currentUser.uid).set({
      uid: currentUser.uid, name: myName,
      readAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:true}).catch(()=>{});
  }

  // Build seen-by label per comment
  const getSeenBy = (comment) => {
    if (!comment.createdAt) return [];
    const commentMs = comment.createdAt.toMillis?.() || 0;
    return readers.filter(r => r.uid !== comment.authorId && (r.readAt?.toMillis?.() || 0) >= commentMs);
  };

  const initials = name => (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const timeLabel = ts => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    const diffH = (now - d) / 3600000;
    if (diffH < 24) return d.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
    return d.toLocaleDateString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  };

  container.innerHTML = `
    <div class="messenger-wrap">
      <div class="messenger-header">
        <span style="font-weight:700">💬 Messages</span>
        <span style="font-size:11px;color:var(--text-muted)">${comments.length} message${comments.length!==1?'s':''}</span>
      </div>
      <div class="messenger-body" id="msbody-${docId}">
        ${!comments.length ? `<div class="messenger-empty">No messages yet. Be the first to say something!</div>` :
          comments.map((c, idx) => {
            const isMine = c.authorId === currentUser.uid;
            const seenBy = getSeenBy(c);
            const isLast = idx === comments.length - 1;
            const canEdit   = c.authorId === currentUser.uid;
            const canDelete = canEdit || isAdmin;
            return `
            <div class="ms-row ${isMine?'ms-row-mine':'ms-row-theirs'}" data-cid="${c.id}">
              ${!isMine ? `<div class="ms-avatar" title="${escHtml(c.authorName||'User')}">${c.photoUrl?`<img src="${c.photoUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:initials(c.authorName||'U')}</div>` : ''}
              <div class="ms-bubble-wrap">
                ${!isMine ? `<div class="ms-name">${escHtml(c.authorName||'User')}</div>` : ''}
                <div class="ms-bubble ${isMine?'ms-bubble-mine':'ms-bubble-theirs'}">
                  ${c.text?`<div class="ms-text">${escHtml(c.text).replace(/\n/g,'<br/>')}</div>`:''}
                  ${c.fileUrl ? (c.fileSource!=='link' && isImage(c.fileUrl)
                    ? `<div style="margin-top:${c.text?'6':'0'}px"><img src="${safeHttpUrl(c.fileUrl)}" alt="${escHtml(c.fileName||'img')}" style="max-width:200px;max-height:160px;border-radius:8px;cursor:pointer" onclick="window.open('${safeHttpUrl(c.fileUrl)}','_blank')"/></div>`
                    : `<a href="${safeHttpUrl(c.fileUrl)}" target="_blank" rel="noopener" class="ms-file-chip">${c.fileSource==='link'?'🔗':'📎'} ${escHtml(c.fileName||'Attachment')}</a>`
                  ) : ''}
                  <div class="ms-meta">
                    <span class="ms-time">${timeLabel(c.createdAt)}</span>
                    ${c.editedAt?'<span class="ms-edited">(edited)</span>':''}
                  </div>
                </div>
                ${canEdit||canDelete ? `<div class="ms-actions">
                  ${canEdit?`<button class="ms-act-btn comment-edit-btn" data-id="${c.id}">✎</button>`:''}
                  ${canDelete?`<button class="ms-act-btn ms-del-btn comment-del-btn" data-id="${c.id}">${emojiIcon('trash-2',14)}</button>`:''}
                </div>` : ''}
                ${isLast && seenBy.length ? `<div class="ms-seen">Seen by ${escHtml(seenBy.map(r=>r.name.split(' ')[0]).join(', '))}</div>` : ''}
              </div>
              ${isMine ? `<div class="ms-avatar ms-avatar-mine" title="You">${userProfile?.photoUrl?`<img src="${userProfile.photoUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:initials(userProfile?.displayName||currentUser.email)}</div>` : ''}
            </div>`;
          }).join('')}
      </div>
      <div id="ms-file-preview-${docId}" style="font-size:11px;color:var(--primary-light);padding:0 12px 4px;min-height:16px"></div>
      <div class="messenger-input-row">
        <label for="comment-file-${docId}" class="ms-attach-btn" title="Attach file">📎</label>
        <input type="file" id="comment-file-${docId}" style="display:none" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"/>
        <button type="button" class="ms-attach-btn" id="comment-link-${docId}" title="Attach link">${emojiIcon('link',14)}</button>
        <input id="comment-in-${docId}" class="ms-input" placeholder="Type a message…"/>
        <button class="ms-send-btn" id="comment-send-${docId}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  // Scroll to bottom
  const body = document.getElementById(`msbody-${docId}`);
  if (body) body.scrollTop = body.scrollHeight;

  // File attach preview
  let pendingLink = null;
  document.getElementById(`comment-file-${docId}`)?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) pendingLink = null;   // a file replaces a pending link
    const prev = document.getElementById(`ms-file-preview-${docId}`);
    if (prev) prev.textContent = f ? `📎 ${f.name}` : '';
  });

  // Link attach
  document.getElementById(`comment-link-${docId}`)?.addEventListener('click', async () => {
    let url = ((await promptDialog({message:'Paste a link to attach:'})) || '').trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    pendingLink = url;
    const fileInp = document.getElementById(`comment-file-${docId}`);
    if (fileInp) fileInp.value = '';   // a link replaces a pending file
    const prev = document.getElementById(`ms-file-preview-${docId}`);
    if (prev) prev.textContent = `🔗 ${url}`;
  });

  // Edit message
  container.querySelectorAll('.comment-edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = btn.dataset.id;
      const c   = comments.find(x=>x.id===cid);
      const newText = await promptDialog({message:'Edit message:', value:c?.text||'', multiline:true});
      if (newText === null || newText === (c?.text||'')) return;
      await db.collection(collection).doc(docId).collection('comments').doc(cid).update({
        text: newText.trim(), editedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      renderComments(collection, docId, containerId, currentUser);
    });
  });

  // Delete message
  container.querySelectorAll('.comment-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await confirmDialog({message:'Delete this message?', danger:true}))) return;
      await db.collection(collection).doc(docId).collection('comments').doc(btn.dataset.id).delete();
      renderComments(collection, docId, containerId, currentUser);
    });
  });

  const sendComment = async () => {
    const input   = document.getElementById(`comment-in-${docId}`);
    const fileInp = document.getElementById(`comment-file-${docId}`);
    const text    = input.value.trim();
    const file    = fileInp?.files?.[0];
    if (!text && !file && !pendingLink) return;

    const sendBtn = document.getElementById(`comment-send-${docId}`);
    if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = '.5'; }

    const myName = userProfile?.displayName || currentUser.email;

    let fileUrl = null, fileName = null, fileSource = null;
    if (file) {
      try {
        const path = `task-comments/${docId}/${Date.now()}_${file.name}`;
        const ref  = storage.ref(path);
        await ref.put(file);
        fileUrl  = await ref.getDownloadURL();
        fileName = file.name;
      } catch(err) {
        Notifs.showToast('File upload failed','error');
        if(sendBtn){sendBtn.disabled=false;sendBtn.style.opacity='1';}
        return;
      }
    } else if (pendingLink) {
      fileUrl = pendingLink;
      try { fileName = new URL(pendingLink).hostname.replace(/^www\./,''); } catch(_) { fileName = pendingLink; }
      fileSource = 'link';
    }

    await db.collection(collection).doc(docId).collection('comments').add({
      text: text||'', authorId: currentUser.uid, authorName: myName,
      fileUrl: fileUrl||null, fileName: fileName||null, fileSource: fileSource||null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Notify task assignees + creator (tasks only)
    if (collection === 'tasks') {
      try {
        const taskSnap = await db.collection('tasks').doc(docId).get();
        if (taskSnap.exists) {
          const task = taskSnap.data();
          const involved = new Set([...(task.assignedTo||[]), task.createdBy].filter(Boolean));
          involved.delete(currentUser.uid);
          const preview = text ? (text.length>60?text.slice(0,60)+'…':text) : `${fileSource==='link'?'🔗':'📎'} ${fileName||'File'}`;
          for (const uid of involved) {
            await Notifs.send(uid, {
              title: `💬 New message on "${task.title}"`,
              body: `${myName}: ${preview}`,
              icon: '💬', type: 'task_message'
            });
          }
        }
      } catch(e) { console.warn('Notif failed', e); }
    }

    input.value = '';
    if (fileInp) fileInp.value = '';
    pendingLink = null;
    const prev = document.getElementById(`ms-file-preview-${docId}`);
    if (prev) prev.textContent = '';
    renderComments(collection, docId, containerId, currentUser);
  };

  document.getElementById(`comment-send-${docId}`)?.addEventListener('click', sendComment);
  document.getElementById(`comment-in-${docId}`)?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); }
  });
};

// ══════════════════════════════════════════════════
//  MARKETING DEPARTMENT
// ══════════════════════════════════════════════════
window.renderMarketing = async function(currentUser, currentRole, subtab = 'Advertising') {
  const c = deptContainer();
  c.innerHTML = `
    <div class="page-header"><h2>📢 Marketing</h2></div>
    ${window.sopPanel('How Marketing works', [
      'Advertising and Marketing Designs hold the creative asset libraries.',
      'Plan and Budgeting cover campaign planning and spend; Proposals stores pitches.',
      'Tasks is the department board.'
    ])}
    ${window.chipTabs(['Advertising','Marketing Designs','Plan','Budgeting','Proposals','Tasks'].map(s=>({key:s,label:s})), subtab)}
    <div id="mkt-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadMarketingContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => loadMarketingContent(currentUser, currentRole, key));
};

async function loadMarketingContent(currentUser, currentRole, sub) {
  const content = document.getElementById('mkt-content');
  switch(sub) {
    case 'Advertising':
      content.innerHTML = renderFileCollection('Advertising Materials', 'mkt-ads', currentRole);
      bindFileCollection('mkt-ads', currentUser, 'Marketing', 'Advertising');
      break;
    case 'Marketing Designs':
      content.innerHTML = renderFileCollection('Marketing Designs', 'mkt-designs', currentRole);
      bindFileCollection('mkt-designs', currentUser, 'Marketing', 'Designs');
      break;
    case 'Plan':
      await renderDocCollection(content, 'marketing_plans', 'Marketing Plans', currentUser, currentRole, { icon:'📅', color:'#880e4f', dept:'Marketing' });
      break;
    case 'Budgeting':
      await renderBudgeting(content, currentUser, currentRole, 'Marketing');
      break;
    case 'Proposals':
      await renderDocCollection(content, 'marketing_proposals', 'Marketing Proposals', currentUser, currentRole, { icon:'📝', color:'#880e4f', dept:'Marketing' });
      break;
    case 'Tasks':
      await renderDeptTasks(content, 'Marketing', currentUser, currentRole);
      break;
  }
}

// ══════════════════════════════════════════════════
//  FINANCE DEPARTMENT
// ══════════════════════════════════════════════════
window.renderFinance = async function(currentUser, currentRole, subtab = window.initialSubtab('Overview')) {
  const c = deptContainer();
  // Finance tools vs HR tools — visually separated
  const finTabs = ['Overview','Reports','Sales Orders','Ledger','Cash Receipts','Cash Disbursements','Purchases','Inventory','Records','Taxes','SSS / Gov','Tasks'];
  const hrTabs  = ['Payroll','HR Profiles','Cash Advances'];
  const allTabs = [...finTabs, ...hrTabs];
  c.innerHTML = `
    <div class="page-header"><h2>💰 Finance & HR</h2></div>
    ${window.sopPanel('How Finance works', [
      'The ledger is the single source of truth — approved expenses, cash journals and payroll all post into it automatically.',
      'Record income/expense via the Accounting, Cash Receipts and Cash Disbursements tabs; Reports reads the ledger for the P&L and VAT.',
      'Payroll runs through Compute → Verify → Disburse; HR Profiles handles weekly worker payslips.',
      'Deleting any finance record needs President approval (the 🗑 button files a request).'
    ])}
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--text-muted);padding:0 4px 4px;text-transform:uppercase">Finance</div>
    ${window.chipTabs(finTabs.map(s=>({key:s,label:s})), subtab)}
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--text-muted);padding:4px 4px;text-transform:uppercase">HR</div>
    ${window.chipTabs(hrTabs.map(s=>({key:s,label:s})), subtab)}
    <div id="fin-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadFinanceContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => { window.setSubroute(key); loadFinanceContent(currentUser, currentRole, key); });
};

async function loadFinanceContent(currentUser, currentRole, sub) {
  const content = document.getElementById('fin-content');
  switch(sub) {
    case 'Overview':     await renderFinanceOverview(content, currentUser, currentRole); break;
    case 'Reports':      await renderFinancialReports(content, currentUser, currentRole); break;
    case 'Payroll':      await renderPayrollManagement(content, currentUser, currentRole); break;
    case 'Taxes':        await renderTaxesTab(content, currentUser, currentRole); break;
    case 'Ledger':       await renderLedgerTab(content, currentUser, currentRole); break;
    case 'Cash Receipts':       await renderCashReceiptJournal(content, currentUser, currentRole); break;
    case 'Cash Disbursements':  await renderCashDisbursementJournal(content, currentUser, currentRole); break;
    case 'Sales Orders':        await window.renderSalesOrders(content); break;
    case 'Inventory':           await window.renderInventory(content, 'Stock'); break;
    case 'Records':      await renderRecordsTab(content, currentUser, currentRole); break;
    case 'Purchases':
      // View-only window into the Purchasing department's purchase requests.
      // Purchasing creates RFQs → prices → converts to Purchase Requests; Finance
      // sees the committed purchases here but cannot edit them (write-gated in rules).
      await renderPurchaseRequests(content, currentUser, currentRole, { viewOnly:true, financeView:true });
      break;
    case 'SSS / Gov':
      content.innerHTML = renderFileCollection('SSS & Government Documents', 'fin-sss', currentRole);
      bindFileCollection('fin-sss', currentUser, 'Finance', 'SSS');
      break;
    case 'HR Profiles':
      await renderFinanceHRProfiles(content, currentUser, currentRole);
      break;
    case 'Cash Advances':
      await renderFinanceCA(content, currentUser, currentRole);
      break;
    case 'Tasks':
      await renderDeptTasks(content, 'Finance', currentUser, currentRole);
      break;
  }
}

// ── Salary Raise (shared by Payroll + HR Profiles) ─
// Applies a raise immediately and logs it to salary_raises (old→new, %, effective
// date, reason, who granted it). Finance/admin only; an affected app-user can read
// their own raise records (firestore.rules mirrors the salary_history gate).
function openSalaryRaiseModal({ subjectType, subjectId, subjectName, fieldLabel, targetField, current }, currentUser, onDone) {
  const cur = parseFloat(current) || 0;
  const _isPres = typeof isRealPresident === 'function' && isRealPresident();
  openPage(`💸 Give Raise — ${escHtml(subjectName||'')}`, `
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
      Current ${escHtml(fieldLabel)}: <strong style="color:var(--text)">₱${fmt(cur)}</strong>
    </div>
    <div class="form-row">
      <div class="form-group"><label>New ${escHtml(fieldLabel)} (₱) *</label>
        <input id="raise-new" type="number" inputmode="decimal" step="0.01" min="0" value="${cur}"/></div>
      <div class="form-group"><label>Quick increase</label>
        <div style="display:flex;gap:6px">
          <input id="raise-amt" type="number" inputmode="decimal" placeholder="+ ₱" style="flex:1;min-width:0"/>
          <input id="raise-pct" type="number" inputmode="decimal" placeholder="+ %" style="width:64px"/>
        </div>
      </div>
    </div>
    <div id="raise-preview" style="font-size:13px;font-weight:700;margin:-2px 0 12px;min-height:18px"></div>
    <div class="form-row">
      <div class="form-group"><label>Effective Date</label><input id="raise-eff" type="date" value="${today()}"/></div>
      <div class="form-group"><label>Reason / Notes</label><input id="raise-reason" placeholder="e.g. Annual increase, promotion"/></div>
    </div>
    ${!_isPres?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Raises are approval-routed — this will be sent to the President.</div>`:''}
  `, `<button class="btn-primary" id="raise-save-btn">${_isPres?'Apply Raise':'Request Raise'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const newInp = document.getElementById('raise-new');
  const amtInp = document.getElementById('raise-amt');
  const pctInp = document.getElementById('raise-pct');
  const prev   = document.getElementById('raise-preview');
  // Button text is date/role aware (v12 WS23): a future-dated raise SCHEDULES
  // rather than applies, even for the President.
  const _btnLabel = () => {
    const effM = (document.getElementById('raise-eff')?.value || today()).slice(0,7);
    if (!_isPres) return 'Request Raise';
    return effM <= today().slice(0,7) ? 'Apply Raise' : 'Schedule Raise';
  };
  const refresh = () => {
    const nv = parseFloat(newInp.value) || 0;
    const diff = nv - cur;
    const pct = cur > 0 ? (diff / cur * 100) : null;
    if (!diff) { prev.textContent = ''; return; }
    prev.style.color = diff > 0 ? 'var(--success)' : 'var(--danger)';
    prev.textContent = `${diff > 0 ? '▲ +' : '▼ '}₱${fmt(Math.abs(diff))}${pct!=null?`  (${pct>=0?'+':''}${pct.toFixed(1)}%)`:''}`;
  };
  amtInp.addEventListener('input', () => { if (amtInp.value !== '') { newInp.value = (cur + (parseFloat(amtInp.value)||0)).toFixed(2); pctInp.value = ''; } refresh(); });
  pctInp.addEventListener('input', () => { if (pctInp.value !== '') { newInp.value = (cur * (1 + (parseFloat(pctInp.value)||0)/100)).toFixed(2); amtInp.value = ''; } refresh(); });
  newInp.addEventListener('input', () => { amtInp.value = ''; pctInp.value = ''; refresh(); });
  document.getElementById('raise-eff').addEventListener('change', () => {
    const b = document.getElementById('raise-save-btn'); if (b) b.textContent = _btnLabel();
  });

  document.getElementById('raise-save-btn').addEventListener('click', async () => {
    const nv = parseFloat(newInp.value) || 0;
    if (nv <= 0)    { Notifs.showToast('Enter a valid new amount','error'); return; }
    if (nv === cur) { Notifs.showToast('New amount is unchanged','error'); return; }
    const reason = document.getElementById('raise-reason').value.trim();
    const eff    = document.getElementById('raise-eff').value || today();
    const btn = document.getElementById('raise-save-btn');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const res = await window.RaiseFlow.submitRaise(
        { subjectType, subjectId, subjectName, fieldLabel, targetField, current: cur },
        { newAmount: nv, effectiveDate: eff, reason }
      );
      closeModal();
      if (res.outcome === 'requested')
        Notifs.showToast('Raise sent to the President for approval.');
      else
        Notifs.showToast(`Raise ${eff.slice(0,7) <= today().slice(0,7) ? 'applied' : 'scheduled'}: ₱${fmt(cur)} → ₱${fmt(nv)}`);
      onDone && onDone();
    } catch (e) {
      console.error('raise failed', e);
      btn.disabled = false; btn.textContent = _isPres ? 'Apply Raise' : 'Request Raise';
      Notifs.showToast('Failed to submit raise','error');
    }
  });
}

// Read-only log of past raises (finance/admin). Optionally filter to one subject.
async function openRaiseHistory(opts = {}) {
  const snap = await db.collection('salary_raises').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
  let list = snap.docs.map(d=>({id:d.id,...d.data()}));
  if (opts.subjectId) list = list.filter(r => r.subjectId === opts.subjectId);
  const rows = !list.length
    ? '<div class="empty-state" style="padding:30px"><div class="empty-icon">💸</div><p>No salary raises recorded yet.</p></div>'
    : `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Effective</th><th>Employee</th><th>Type</th><th>Old → New</th><th>Change</th><th>Reason</th><th>By</th></tr></thead>
        <tbody>${list.map(r=>{
          const up = (r.changeAmount||0) >= 0;
          return `<tr>
            <td style="white-space:nowrap;font-size:12px">${escHtml(r.effectiveDate||'—')}</td>
            <td style="font-weight:600">${escHtml(r.subjectName||'—')}</td>
            <td><span class="badge ${r.subjectType==='payroll'?'badge-blue':'badge-purple'}">${r.subjectType==='payroll'?'Payroll':'Worker'}</span></td>
            <td style="white-space:nowrap">₱${fmt(r.oldAmount||0)} → <strong>₱${fmt(r.newAmount||0)}</strong></td>
            <td style="white-space:nowrap;color:${up?'var(--success)':'var(--danger)'};font-weight:700">${up?'+':''}₱${fmt(r.changeAmount||0)}${r.changePct!=null?` (${r.changePct>=0?'+':''}${r.changePct}%)`:''}</td>
            <td style="font-size:12px">${escHtml(r.reason||'—')}</td>
            <td style="font-size:12px;color:var(--text-muted)">${escHtml(r.grantedByName||'—')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  openModal(`💸 Salary Raise History${opts.subjectName?` — ${escHtml(opts.subjectName)}`:''}`, rows,
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
}

// ── Raise lifecycle service (v12 WS23) — schedule → approve → materialize ──
// pending_raises holds the schedule/approval; salary_raises stays the
// immutable APPLIED audit log (unchanged shape, written only at materialize).
// President acts immediately; everyone else files a pending_approval request.
window.RaiseFlow = (function () {
  const nowMonth = () => today().slice(0, 7);            // today() wraps window.bizDate() → 'YYYY-MM-DD'

  // Create a raise. President → 'scheduled' (+ apply now if due). Others → 'pending_approval'.
  async function submitRaise(desc, { newAmount, effectiveDate, reason }) {
    const u = window.currentUser || auth.currentUser || {};
    const cur = parseFloat(desc.current) || 0;
    const eff = effectiveDate || today();
    const effMonth = eff.slice(0, 7);
    const isPres = typeof isRealPresident === 'function' && isRealPresident();
    const base = {
      subjectType: desc.subjectType, subjectId: desc.subjectId, subjectName: desc.subjectName || '',
      field: desc.fieldLabel, targetField: desc.targetField,
      oldAmount: cur, newAmount,
      changeAmount: +(newAmount - cur).toFixed(2),
      changePct: cur > 0 ? +((newAmount - cur) / cur * 100).toFixed(2) : null,
      effectiveDate: eff, effectiveMonth: effMonth, reason: reason || '',
      requestedBy: u.uid || '', requestedByName: window.userProfile?.displayName || u.email || '',
      appliedAt: null, appliedInMonth: null, salaryRaiseId: null,
      rejectedBy: null, rejectedByName: null, rejectedAt: null, rejectReason: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (isPres) {
      const ref = await db.collection('pending_raises').add({
        ...base, status: 'scheduled',
        approvedBy: u.uid, approvedByName: base.requestedByName,
        approvedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (effMonth <= nowMonth()) await materialize(ref.id);   // same-day/back-dated → apply now
      return { outcome: 'applied-or-scheduled', id: ref.id };
    }
    const ref = await db.collection('pending_raises').add({
      ...base, status: 'pending_approval', approvedBy: null, approvedByName: null, approvedAt: null
    });
    await safeNotify(() => Notifs.sendToOwner({
      title: '💸 Raise Approval Request',
      body: `${base.requestedByName} requested a raise for ${base.subjectName}: ₱${fmt(cur)} → ₱${fmt(newAmount)} (eff ${eff}).`,
      icon: '💸', type: 'raise_request'
    }));
    return { outcome: 'requested', id: ref.id };
  }

  // Materialize a scheduled raise: write base-of-record + salary_raises audit + status→applied.
  // Idempotent: guarded on status=='scheduled'; salary_raises id == pending_raises id (merge).
  async function materialize(raiseId) {
    const snap = await db.collection('pending_raises').doc(raiseId).get();
    if (!snap.exists) return;
    const r = snap.data();
    if (r.status !== 'scheduled') return;                    // re-entrancy / already applied
    let liveOld = r.oldAmount;
    if (r.subjectType === 'payroll') {
      const p = await db.collection('payroll').doc(r.subjectId).get();
      liveOld = (p.exists && typeof p.data().salary === 'number') ? p.data().salary : r.oldAmount;
      await db.collection('payroll').doc(r.subjectId).set({ salary: r.newAmount }, { merge: true });
    } else { // worker_profile — scale hourly from LIVE values (rate may have moved since schedule)
      const wp = await db.collection('worker_profiles').doc(r.subjectId).get();
      const curDaily = (wp.exists && wp.data().dailyRate) || 0;
      const curHourly = (wp.exists && wp.data().hourlyRate) || 0;
      liveOld = curDaily || r.oldAmount;
      const newHourly = curDaily > 0 ? +((curHourly * (r.newAmount / curDaily))).toFixed(2) : +(r.newAmount / 8).toFixed(2);
      await db.collection('worker_profiles').doc(r.subjectId).update({
        dailyRate: r.newAmount, hourlyRate: newHourly,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    // Audit log — deterministic id so a retried sweep overwrites instead of duplicating.
    await db.collection('salary_raises').doc(raiseId).set({
      subjectType: r.subjectType, subjectId: r.subjectId, subjectName: r.subjectName || '',
      field: r.field, oldAmount: liveOld, newAmount: r.newAmount,
      changeAmount: +(r.newAmount - liveOld).toFixed(2),
      changePct: liveOld > 0 ? +((r.newAmount - liveOld) / liveOld * 100).toFixed(2) : null,
      effectiveDate: r.effectiveDate, reason: r.reason || '',
      grantedBy: r.approvedBy || r.requestedBy || '', grantedByName: r.approvedByName || r.requestedByName || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await db.collection('pending_raises').doc(raiseId).update({
      status: 'applied', appliedAt: firebase.firestore.FieldValue.serverTimestamp(),
      appliedInMonth: nowMonth(), salaryRaiseId: raiseId
    });
    window.logAudit && window.logAudit('raise-apply', r.subjectType, r.subjectId, { from: liveOld, to: r.newAmount });
    if (r.subjectType === 'payroll' && r.subjectId) {
      await safeNotify(() => Notifs.send(r.subjectId, {
        title: '💸 Salary Update',
        body: `Your ${r.field} changed from ₱${fmt(liveOld)} to ₱${fmt(r.newAmount)}, effective ${r.effectiveDate}.`,
        icon: '💸', type: 'raise_applied'
      }));
    }
    if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('users'); dbCacheInvalidate('payroll'); }
  }

  // Screen-load sweep: apply every scheduled raise whose month has arrived. Month-gated so
  // future-dated raises never leak into any Compute. Single-field query → no composite index.
  async function applyDueRaises(subjectType) {
    const nm = nowMonth();
    const snap = await db.collection('pending_raises').where('status', '==', 'scheduled').get().catch(() => ({ docs: [] }));
    const due = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.subjectType === subjectType && (r.effectiveMonth || r.effectiveDate.slice(0, 7)) <= nm);
    for (const r of due) { try { await materialize(r.id); } catch (e) { console.error('applyDueRaises', r.id, e); } }
    return due.length;
  }

  // President approves a pending_approval request → schedule (+ apply if already due).
  async function approve(raiseId) {
    const ref = db.collection('pending_raises').doc(raiseId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== 'pending_approval') return 'stale'; // re-entrancy guard
    const u = window.currentUser || auth.currentUser || {};
    await ref.update({
      status: 'scheduled', approvedBy: u.uid,
      approvedByName: window.userProfile?.displayName || u.email || 'President',
      approvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const r = snap.data();
    await safeNotify(() => Notifs.send(r.requestedBy, { title: '✅ Raise Approved',
      body: `Your raise request for ${r.subjectName} was approved.`, icon: '✅', type: 'raise_request' }));
    if ((r.effectiveMonth || r.effectiveDate.slice(0, 7)) <= nowMonth()) await materialize(raiseId);
    return 'approved';
  }

  async function reject(raiseId, reason) {
    const ref = db.collection('pending_raises').doc(raiseId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== 'pending_approval') return 'stale';
    const u = window.currentUser || auth.currentUser || {};
    await ref.update({ status: 'rejected', rejectedBy: u.uid,
      rejectedByName: window.userProfile?.displayName || u.email || 'President',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(), rejectReason: reason || '' });
    const r = snap.data();
    await safeNotify(() => Notifs.send(r.requestedBy, { title: '❌ Raise Declined',
      body: `Your raise request for ${r.subjectName} was declined.${reason ? ' Reason: ' + reason : ''}`,
      icon: '❌', type: 'raise_request' }));
    return 'rejected';
  }

  return { submitRaise, materialize, applyDueRaises, approve, reject };
})();

// Admin list of scheduled + pending-approval raises (the SCHEDULE half of the
// lifecycle — openRaiseHistory above stays the immutable APPLIED log).
window.openScheduledRaises = async function() {
  const snap = await db.collection('pending_raises').where('status','in',['scheduled','pending_approval']).get().catch(()=>({docs:[]}));
  const list = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.effectiveDate||'').localeCompare(b.effectiveDate||''));
  const isPres = typeof isRealPresident === 'function' && isRealPresident();
  const render = () => {
    const rows = !list.length
      ? '<div class="empty-state" style="padding:30px"><div class="empty-icon">💸</div><p>No scheduled or pending raises.</p></div>'
      : `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Effective</th><th>Employee</th><th>Old → New</th><th>Status</th><th>By</th><th></th></tr></thead>
          <tbody>${list.map(r=>`<tr data-id="${r.id}">
            <td style="white-space:nowrap;font-size:12px">${escHtml(r.effectiveDate||'—')}</td>
            <td style="font-weight:600">${escHtml(r.subjectName||'—')}</td>
            <td style="white-space:nowrap">₱${fmt(r.oldAmount||0)} → <strong>₱${fmt(r.newAmount||0)}</strong></td>
            <td><span class="badge ${r.status==='scheduled'?'badge-blue':'badge-orange'}">${r.status==='scheduled'?'Scheduled':'Pending Approval'}</span></td>
            <td style="font-size:12px;color:var(--text-muted)">${escHtml(r.requestedByName||'—')}</td>
            <td style="white-space:nowrap">
              ${(r.status==='pending_approval'&&isPres)?`<button class="btn-success btn-sm sr-approve-btn" data-id="${r.id}">✓ Approve</button> <button class="btn-danger btn-sm sr-reject-btn" data-id="${r.id}">✗ Reject</button>`:''}
            </td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    openModal('💸 Scheduled &amp; Pending Raises', rows, `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    document.querySelectorAll('.sr-approve-btn').forEach(btn=>btn.addEventListener('click', async ()=>{
      const r = await window.RaiseFlow.approve(btn.dataset.id);
      Notifs.showToast(r==='approved'?'Raise approved.':'Already resolved.');
      window.openScheduledRaises();
    }));
    document.querySelectorAll('.sr-reject-btn').forEach(btn=>btn.addEventListener('click', async ()=>{
      const reason = (await promptDialog({message:'Reason for declining (optional):', multiline:true}))||'';
      await window.RaiseFlow.reject(btn.dataset.id, reason);
      Notifs.showToast('Raise declined.');
      window.openScheduledRaises();
    }));
  };
  render();
};

// ── Payroll Management ───────────────────────────
// ── HR department hub ──────────────────────────────────────────────────
// Brings the people-side of the company into one place: role/department
// assignment, the monthly payroll run, weekly worker payslips, leave, and
// attendance. Each card opens the existing screen (no duplicated logic).
// Sensitive — management & finance only.
window.renderHR = async function(currentUser, currentRole){
  const c = deptContainer();
  const role = window.currentRole || currentRole || '';
  if (!['president','manager','secretary','finance'].includes(role)) {
    c.innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><h4>HR is management &amp; finance only</h4></div>';
    return;
  }
  const cards = [
    { icon:'👥', title:'People & Roles', desc:'Assign roles, departments & employee class', go:()=>navigateTo('team-directory') },
    { icon:'💰', title:'Payroll',        desc:'Monthly run — Compute → Verify → Disburse', go:()=>window.renderFinance(currentUser, currentRole, 'Payroll') },
    { icon:'👷', title:'Worker Payslips',desc:'Weekly Production payslips & profiles',      go:()=>window.renderFinance(currentUser, currentRole, 'HR Profiles') },
    { icon:'🌴', title:'Leave',          desc:'Requests, approvals & balances',             go:()=>window.renderLeavePage && window.renderLeavePage() },
    { icon:'🕐', title:'Attendance',     desc:'Daily attendance & time-extension requests', go:()=>navigateTo('attendance') },
  ];
  c.innerHTML = `
    <div class="page-header"><h2>👥 Human Resources</h2></div>
    ${window.sopPanel('How HR works', [
      'People & Roles — set each person’s role, department(s) and employee class (Regular monthly vs Production weekly).',
      'Payroll — run the monthly cycle: Compute the figures, Verify them, then mark Disbursed once salaries are released (finalize by the 5th).',
      'Worker Payslips — generate weekly payslips for Production workers (hourly attendance, fixed weekly rate).',
      'Leave — employees request leave; finance/admin approve and balances update automatically.',
      'Attendance — review daily attendance and approve time-in extension requests.'
    ])}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
      ${cards.map((card,i)=>`
        <button class="hr-card" data-i="${i}" style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;padding:16px;background:var(--surface);border:1.5px solid var(--border);border-radius:14px;cursor:pointer;transition:border-color .15s,background .15s">
          <span style="font-size:26px">${card.icon}</span>
          <strong style="font-size:14px">${card.title}</strong>
          <span style="font-size:12px;color:var(--text-muted)">${card.desc}</span>
        </button>`).join('')}
    </div>`;
  c.querySelectorAll('.hr-card').forEach(b=>{
    b.addEventListener('click', ()=>cards[+b.dataset.i].go());
    b.addEventListener('mouseenter', ()=>{ b.style.borderColor='var(--primary-light)'; b.style.background='var(--surface2)'; });
    b.addEventListener('mouseleave', ()=>{ b.style.borderColor='var(--border)'; b.style.background='var(--surface)'; });
  });
};

// ═══════════════════════════════════════════════════════════
//  ONE PAYROLL ENGINE (v12 WS20) — Compute → Verify → Disburse
//  computePayLine: pure per-employee math (no writes, no reads).
//  computePayRun:  read-heavy, freezes lines[] onto pay_runs/{month}, no
//                  money-moving side effects — safe to re-run before Verify.
//  disbursePayRun: THE single mutating step — CA balances decrement, ledger
//                  posts, salary_history mirrors write, employees notified.
// ═══════════════════════════════════════════════════════════
window.computePayLine = function(emp, ctx) {
  const policy = ctx.policy || 'flat';
  const base   = emp.salary || 0;
  const allowance = emp.allowance || 0;
  const otherDeductions = emp.deductions || 0;
  const gross = base + allowance; // nominal — statutory brackets key off THIS, not the performance-adjusted figure

  // Statutory: a hand-typed non-zero value on payroll/{uid} always wins over the
  // WS21 table suggestion (Finance can override real edge cases); er (employer
  // share) is never hand-typed — always computed and frozen.
  const stat = window.computeStatutory
    ? window.computeStatutory({ grossPay: gross, year: window.bizYear ? window.bizYear() : new Date().getFullYear() })
    : null;
  const sss        = emp.sss        || (stat ? stat.ee.sss : 0);
  const philhealth = emp.philhealth || (stat ? stat.ee.philhealth : 0);
  const pagibig    = emp.pagibig    || (stat ? stat.ee.pagibig : 0);
  const tax        = emp.tax        || (stat ? stat.ee.tax : 0);
  const er         = stat ? stat.er : { sss:0, philhealth:0, pagibig:0 };
  const statutoryTotal = sss + philhealth + pagibig + tax;

  const kpiScore   = ctx.kpiScore != null ? ctx.kpiScore : 1;
  const attScore   = ctx.attScore != null ? ctx.attScore : 1;
  const perfFactor = Math.min(1, Math.max(0, kpiScore*0.7 + attScore*0.3));

  const caPlan    = ctx.caPlan || [];
  const caPlanned = caPlan.reduce((s,p)=>s+(p.amount||0), 0);
  const caBalance = ctx.caBalance != null ? ctx.caBalance : caPlanned;

  // policy 'flat'        = exactly Path A today (unification changes no one's pay).
  // policy 'performance' = allowance scales by perfFactor; BASE WAGE is never
  // docked (PH labor-safe) — inert until the President flips payPolicy on a run.
  const netBeforeCA = policy === 'performance'
    ? (base - statutoryTotal - otherDeductions + allowance*perfFactor)
    : (gross - statutoryTotal - otherDeductions);
  const finalPay = netBeforeCA - caPlanned;
  // The TRUE economic cost of this line (what disbursePayRun's ledger debit
  // legs must balance against) — equals nominal `gross` under 'flat', but
  // correctly reflects a performance-scaled allowance under 'performance'
  // (an unearned allowance withholding is not a real company expense).
  const effectiveGross = netBeforeCA + statutoryTotal + otherDeductions;

  return {
    uid: emp.id, name: emp.displayName||emp.email, payClass: emp.payClass==='production'?'production':'regular',
    base, allowance, otherDeductions,
    sss, philhealth, pagibig, tax, er,
    kpiScore, attScore, perfFactor, policy,
    caBalance, caPlanned, caPlan,
    gross, effectiveGross, statutoryTotal, netBeforeCA, finalPay
  };
};

window.computePayRun = async function(month, { policy } = {}) {
  const usersSnap = await fetchUsersWithPayroll();
  const isExternalPartner = (u) => {
    if (u.role === 'partner') return true;
    if (typeof u.title === 'string' && u.title.trim().toLowerCase() === 'partner') return true;
    const depts = Array.isArray(u.departments) ? u.departments : (u.department ? [u.department] : []);
    return depts.length === 1 && depts[0] === 'Brilliant Steel';
  };
  const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>!isExternalPartner(u));

  // A regular-payroll uid can ALSO be paid weekly via a worker_profiles doc
  // (v12 WS20 D3, structural bridge — worker_profiles.linkedUid). Hard-skip
  // both routes into the monthly run so nobody is paid twice.
  const wpSnap = await db.collection('worker_profiles').get().catch(()=>({docs:[]}));
  const linkedUids = new Set(
    wpSnap.docs.map(d=>d.data()).filter(p=>p.status!=='inactive' && p.linkedUid).map(p=>p.linkedUid)
  );

  const skipped = [];
  const employees = [];
  for (const u of allStaff) {
    if (u.payClass === 'production')  { skipped.push({ uid:u.id, name:u.displayName||u.email, reason:'production' }); continue; }
    if (linkedUids.has(u.id))         { skipped.push({ uid:u.id, name:u.displayName||u.email, reason:'linked-worker-profile' }); continue; }
    employees.push(u);
  }
  employees.sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));

  // Bulk-fetch once — avoids N+1 reads across the whole run.
  const [tasksSnap, kpiTargetsSnap] = await Promise.all([
    db.collection('tasks').get().catch(()=>({docs:[]})),
    db.collection('kpi_targets').get().catch(()=>({docs:[]}))
  ]);
  const allTasks = tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
  const kpiTargetsMap = Object.fromEntries(kpiTargetsSnap.docs.map(d=>[d.id, d.data()]));
  const DONE_ST = ['done','approved','archived'];
  const runPolicy = policy || 'flat';

  const lines = await Promise.all(employees.map(async (emp) => {
    const userTasks = allTasks.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(emp.id) : t.assignedTo === emp.id);
    // KPI floor fix (v12 WS20 D2): zero assigned tasks ⇒ kpi = 1.0. Path B's old
    // 0.5 floor punished people for not being assigned work — wrong.
    let kpiScore = 1;
    if (userTasks.length) {
      const taskScore  = Math.min(1, userTasks.filter(t=>DONE_ST.includes(t.status)).length/userTasks.length);
      const kpiTargetD = kpiTargetsMap[emp.id] || {};
      const delivScore = typeof kpiTargetD.deliverableScore === 'number' ? Math.min(1, kpiTargetD.deliverableScore/100) : 1;
      kpiScore = taskScore*0.7 + delivScore*0.3;
    }
    const attScore = window.getAttendanceScore ? await window.getAttendanceScore(emp.id) : 1;
    const planResult = window.CashAdvance ? await window.CashAdvance.planFor(emp.id, month) : { plan: [] };
    return window.computePayLine(emp, { month, policy: runPolicy, kpiScore, attScore, caPlan: planResult.plan, caBalance: planResult.caBalance });
  }));

  const totalNet = lines.reduce((s,l)=>s+l.finalPay, 0);
  const currentUser = window.currentUser;
  await db.collection('pay_runs').doc(month).set({
    month, state:'computed', payPolicy: runPolicy,
    employeeCount: lines.length, totalNet, lines, skipped,
    computedBy: currentUser?.uid, computedByName: window.userProfile?.displayName || currentUser?.email,
    computedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });

  return { lines, totals: { totalNet, employeeCount: lines.length }, skipped };
};

window.disbursePayRun = async function(month) {
  // Fail fast, before any write — firestore.rules only rejects the FINAL
  // state-flip to 'disbursed' for a non-president, which would otherwise let
  // the CA deductions/ledger posts below succeed first (a partial disburse).
  if (typeof isRealPresident === 'function' && !isRealPresident()) {
    Notifs.showToast('Only the President can disburse payroll.','error'); return;
  }
  const runRef  = db.collection('pay_runs').doc(month);
  const runSnap = await runRef.get();
  if (!runSnap.exists) { Notifs.showToast('No pay run found for this month.','error'); return; }
  const run = runSnap.data();
  if (run.state !== 'verified') { Notifs.showToast(`Run must be Verified before Disburse (currently ${run.state||'draft'}).`,'error'); return; }
  const lines = run.lines || [];
  if (!lines.length) { Notifs.showToast('This run has no computed lines.','error'); return; }

  // Checked once, before any write — a closed month can't be disbursed (v12 WS12).
  await window.assertPeriodOpen(month + '-01');

  const currentUser = window.currentUser;
  const monthLabel  = new Date(month+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'});

  // ── 1. Freeze the salary_history mirror (owner-readable, unlike pay_runs) ──
  const shBatch = db.batch();
  for (const line of lines) {
    const shRef = db.collection('salary_history').doc(`${line.uid}_${month}`);
    shBatch.set(shRef, {
      userId: line.uid, userName: line.name, month,
      salary: line.base, allowance: line.allowance, deductions: line.otherDeductions,
      sss: line.sss, philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax,
      philHealth: line.philhealth, pagIbig: line.pagibig, // legacy mixed-case mirror (transition — v12 WS21 decision 6)
      er: line.er, kpiScore: line.kpiScore, attScore: line.attScore, perfFactor: line.perfFactor,
      policy: line.policy, runMonth: month,
      caDeducted: line.caPlanned, netPay: line.netBeforeCA, finalPay: line.finalPay,
      recordedBy: currentUser?.uid, recordedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });
  }
  await shBatch.commit();

  // ── 2. Cash-advance deductions — THE only balance mutation, via the one
  //       shared service. financeDeleteCascade reverses caDeductions[] later.
  for (const line of lines) {
    if (line.caPlan && line.caPlan.length) {
      const res = await window.CashAdvance.deduct(line.uid, month, line.caPlan, currentUser?.uid);
      if (res.length) await db.collection('salary_history').doc(`${line.uid}_${month}`)
        .set({ caDeductions: res }, { merge:true }).catch(()=>{});
    }
  }

  // ── 3. Ledger — gross-with-liability-legs (v12 WS21 decision 11). Per-employee
  //       Payroll Expense debits (cost-center granularity); aggregate per-agency
  //       payable + cash credits (remittance/bank-transfer granularity). Balances:
  //       Σ(effectiveGross)+Σ(erShare) == Σ(statutory+er)+Σ(effectiveGross-statutory).
  const _payLedgerByRef = {};
  const _prefetch = await db.collection('ledger')
    .where('refNumber','>=',`PAY-${month}-`)
    .where('refNumber','<', `PAY-${month}-` + String.fromCharCode(0xf8ff))
    .get().catch(()=>({docs:[]}));
  _prefetch.docs.forEach(d => { const r = d.data().refNumber; if (r) _payLedgerByRef[r] = d.ref; });

  const upsertLedger = async (ref, entry) => {
    let existingRef = _payLedgerByRef[ref] || null;
    if (!existingRef) {
      const _ex = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>({docs:[]}));
      existingRef = _ex.docs.length ? _ex.docs[0].ref : null;
    }
    if (existingRef) await existingRef.update({ amount: entry.amount });
    else await db.collection('ledger').add(entry);
  };
  const addedByName = window.userProfile?.displayName || currentUser?.email;

  let sssAgg=0, phAgg=0, piAgg=0, taxAgg=0, netCashAgg=0;
  for (const line of lines) {
    sssAgg += (line.sss||0) + (line.er?.sss||0);
    phAgg  += (line.philhealth||0) + (line.er?.philhealth||0);
    piAgg  += (line.pagibig||0) + (line.er?.pagibig||0);
    taxAgg += (line.tax||0);
    netCashAgg += (line.effectiveGross||0) - (line.statutoryTotal||0);

    await upsertLedger(`PAY-${month}-${line.uid}`, {
      date: month+'-01', type:'debit', accountType:'expense', account:'Payroll Expense',
      description: `Payslip — ${line.name} (${monthLabel})`, amount: line.effectiveGross,
      category:'Payroll Expense', source:'Finance', refNumber:`PAY-${month}-${line.uid}`,
      addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const erTotal = (line.er?.sss||0)+(line.er?.philhealth||0)+(line.er?.pagibig||0);
    if (erTotal > 0) await upsertLedger(`PAY-${month}-${line.uid}-ER`, {
      date: month+'-01', type:'debit', accountType:'expense', account:'Payroll Expense',
      description: `Employer statutory share — ${line.name} (${monthLabel})`, amount: erTotal,
      category:'Payroll Expense', source:'Finance', refNumber:`PAY-${month}-${line.uid}-ER`,
      addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  // Remove any old aggregate PAY-{month} leftover from pre-WS13 code (comment
  // preserved from the original: an aggregate on top of per-employee rows
  // double-counts payroll in every view that sums debits).
  const _oldAgg = await db.collection('ledger').where('refNumber','==',`PAY-${month}`).limit(1).get().catch(()=>({docs:[]}));
  if (_oldAgg.docs.length) await _oldAgg.docs[0].ref.delete().catch(()=>{});

  const aggLeg = async (ref, account, amount) => {
    if (amount <= 0) return;
    await upsertLedger(ref, {
      date: month+'-01', type:'credit', accountType:'liability', account,
      description: `${account} — ${monthLabel} payroll`, amount,
      category:'Payroll Expense', source:'Finance', refNumber: ref,
      addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  };
  await aggLeg(`SSSPAY-${month}`,  'SSS Payable',        sssAgg);
  await aggLeg(`PHPAY-${month}`,   'PhilHealth Payable', phAgg);
  await aggLeg(`HDMFPAY-${month}`, 'Pag-IBIG Payable',   piAgg);
  await aggLeg(`WHTPAY-${month}`,  'Withholding Tax Payable', taxAgg);
  if (netCashAgg > 0) await upsertLedger(`NETPAY-${month}`, {
    date: month+'-01', type:'credit', accountType:'asset', account:'Cash',
    description: `Net payroll cash — ${monthLabel}`, amount: netCashAgg,
    category:'Payroll Expense', source:'Finance', refNumber:`NETPAY-${month}`,
    addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');

  // ── 4. Notify ────────────────────────────────────────────────────────
  await Promise.all(lines.map(line => Notifs.send(line.uid, {
    title: '💰 Payroll Disbursed', body: `Your ${monthLabel} pay of ₱${fmt(line.finalPay)} has been disbursed.`,
    icon: '💰', type: 'payroll', dedupKey: `payroll-disbursed-${line.uid}-${month}`
  })));

  // ── 5. Flip state — TERMINAL from here (v12 WS20 D5: no reopen, no recompute) ──
  await runRef.set({
    state:'disbursed', disbursedBy: currentUser?.uid, disbursedByName: addedByName,
    disbursedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });
  window.logAudit && window.logAudit('disburse-payrun','pay_run', month, { totalNet: run.totalNet, employeeCount: lines.length });
};

// President-only: verified → computed (undoes an in-progress run before it's
// disbursed). disbursed is terminal — there is no reopen from there.
window.reopenPayRun = async function(month) {
  const ref  = db.collection('pay_runs').doc(month);
  const snap = await ref.get();
  if (!snap.exists || snap.data().state !== 'verified') { Notifs.showToast('Only a Verified run can be reopened.','error'); return; }
  const currentUser = window.currentUser;
  await ref.set({
    state:'computed', reopenedBy: currentUser?.uid, reopenedByName: window.userProfile?.displayName||currentUser?.email,
    reopenedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });
  window.logAudit && window.logAudit('reopen-payrun','pay_run', month, {});
  Notifs.showToast(`${month} payroll reopened — Compute is available again.`);
};

async function renderPayrollManagement(container, currentUser, currentRole) {
  // v12 WS23 — apply any due-dated raise BEFORE the base salary is read, so
  // Compute/the table preview always see the current base. Safe to re-run.
  await window.RaiseFlow.applyDueRaises('payroll').catch(()=>{});
  const [usersSnap, histSnap, delReqSnap] = await Promise.all([
    fetchUsersWithPayroll(),
    db.collection('salary_history').orderBy('month','desc').limit(200).get().catch(()=>({docs:[]})),
    db.collection('payroll_delete_requests').where('status','==','pending').get().catch(()=>({docs:[]}))
  ]);
  // Exclude ALL external partners from the monthly run — they are not Barro
  // payroll. A partner can present as role 'partner', a Brilliant-Steel-only
  // member (the partner company), OR a user titled "Partner" whose role is still
  // 'employee'/'agent' (which is why the old role-only filter let them through).
  const isExternalPartner = (u) => {
    if (u.role === 'partner') return true;
    if (typeof u.title === 'string' && u.title.trim().toLowerCase() === 'partner') return true;
    const depts = Array.isArray(u.departments) ? u.departments : (u.department ? [u.department] : []);
    return depts.length === 1 && depts[0] === 'Brilliant Steel';
  };
  const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>!isExternalPartner(u));
  // Production-class staff are paid WEEKLY via Worker Payslips (HR → Payslips),
  // NOT in the monthly run. Excluding them here is the single-source fix that
  // stops a production worker being paid both weekly AND monthly (double pay).
  const productionStaff = allStaff.filter(u=>u.payClass==='production');
  const employees = allStaff.filter(u=>u.payClass!=='production')
    .sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const history   = histSnap.docs.map(d=>({id:d.id,...d.data()}));
  const delReqs   = delReqSnap.docs.map(d=>({id:d.id,...d.data()}));
  const pendingDelIds = new Set(delReqs.map(r=>r.historyId));
  const canFinance = isFinancePriv();
  const isPres     = isRealPresident(currentUser);
  const months    = [...new Set(history.map(h=>h.month))].sort().reverse();
  const thisMonth = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10)).slice(0,7); // Manila YYYY-MM

  // v12 WS23 — scheduled/pending raise counts for the banner below.
  const _prSnap = await db.collection('pending_raises').where('status','in',['scheduled','pending_approval']).get().catch(()=>({docs:[]}));
  const _nm = thisMonth;
  const _upcomingRaises = _prSnap.docs.filter(d=>d.data().status==='scheduled' && (d.data().effectiveMonth||'') > _nm).length;
  const _pendingRaises  = _prSnap.docs.filter(d=>d.data().status==='pending_approval').length;
  const raiseBanner = (_upcomingRaises||_pendingRaises)
    ? `<div class="info-banner" style="margin:8px 0">💸 ${_upcomingRaises} scheduled raise(s) upcoming${_pendingRaises?` · ${_pendingRaises} awaiting President approval`:''}. <button class="btn-secondary btn-sm" id="pr-view-raises">View</button></div>`
    : '';

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <select id="pr-month-sel" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px">
        <option value="${thisMonth}">${new Date(thisMonth+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'})} (Current)</option>
        ${months.filter(m=>m!==thisMonth).map(m=>`<option value="${m}">${new Date(m+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'})}</option>`).join('')}
      </select>
      <div style="display:flex;gap:8px">
        <button class="btn-primary btn-sm" id="gen-payroll-btn">Compute Payroll</button>
        <button class="btn-secondary btn-sm" id="raise-history-btn">💸 Raise History</button>
        <button class="btn-secondary btn-sm" id="print-payroll-btn">🖨 Print All</button>
      </div>
    </div>
    ${raiseBanner}
    <div id="pay-run-strip" style="margin-bottom:14px"></div>
    ${productionStaff.length?`<div style="font-size:12px;color:var(--text-2);background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:12px">🏭 <strong>${productionStaff.length}</strong> production-class worker${productionStaff.length!==1?'s are':' is'} paid <strong>weekly</strong> via Worker Payslips (HR → Payslips) and ${productionStaff.length!==1?'are':'is'} excluded from this monthly run to avoid double payment.</div>`:''}
    <div class="card">
      <div class="card-body" style="padding:0">
        <div class="table-wrap">
          <table class="data-table" id="payroll-table">
            <thead><tr>
              <th>Photo</th><th>Employee</th><th>ID</th><th>Department</th>
              <th>Base</th><th>Allowance</th><th>Deductions</th>
              <th>SSS</th><th>PhilHealth</th><th>Pag-IBIG</th>
              <th>Tax</th><th>Cash Adv</th><th>Net Pay</th><th></th>
            </tr></thead>
            <tbody id="payroll-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
    ${isPres && delReqs.length ? `
    <div class="card" style="margin-top:14px;border:2px solid var(--danger)">
      <div class="card-header" style="background:rgba(220,53,69,0.08)"><h3 style="color:var(--danger)">⚠️ Pending Payroll Delete Approvals (${delReqs.length})</h3></div>
      <div class="card-body" style="padding:0">
        <div class="table-wrap"><table class="data-table" id="del-req-table">
          <thead><tr><th>Month</th><th>Employee</th><th>Requested By</th><th>Reason</th><th></th></tr></thead>
          <tbody>${delReqs.map(r=>`<tr>
            <td>${r.month||'—'}</td>
            <td>${escHtml(r.userName||'—')}</td>
            <td style="font-size:11px">${escHtml(r.requestedByName||'—')}</td>
            <td style="font-size:11px;color:var(--text-muted)">${escHtml(r.reason||'—')}</td>
            <td style="white-space:nowrap">
              <button class="btn-primary btn-sm del-req-approve" data-req-id="${r.id}" data-hist-id="${r.historyId}" title="Approve deletion">✓ Approve</button>
              <button class="btn-secondary btn-sm del-req-deny" data-req-id="${r.id}" data-req-by="${r.requestedBy}" style="margin-left:4px" title="Deny">✕ Deny</button>
            </td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>` : ''}
    <div class="card" style="margin-top:14px">
      <div class="card-header"><h3>Payroll History</h3></div>
      <div class="card-body" style="padding:0">
        ${!history.length?'<div class="empty-state" style="padding:20px"><p>No payroll records yet.</p></div>':
          `<div class="table-wrap"><table class="data-table" id="payroll-history-table">
            <thead><tr><th>Month</th><th>Employee</th><th>Base</th><th>Allowance</th><th>Deductions</th><th>Net Pay</th><th>Final Pay</th><th>Ledger</th>${canFinance?'<th></th>':''}</tr></thead>
            <tbody>${history.slice(0,50).map(h=>`<tr>
              <td>${h.month||'—'}</td>
              <td>${escHtml(h.userName||'—')}</td>
              <td>₱${fmt(h.salary)}</td>
              <td style="color:var(--success)">+₱${fmt(h.allowance)}</td>
              <td style="color:var(--danger)">-₱${fmt(h.deductions)}</td>
              <td>₱${fmt(h.netPay)}</td>
              <td><strong>₱${fmt(h.finalPay)}</strong></td>
              <td><span class="badge badge-blue" style="font-size:10px">Expense</span></td>
              ${canFinance?`<td style="white-space:nowrap">
                <button class="btn-secondary btn-sm hist-edit-btn" data-id="${h.id}" title="Edit">✎</button>
                ${pendingDelIds.has(h.id)
                  ? `<button class="btn-secondary btn-sm" style="margin-left:4px;opacity:0.6;cursor:default" disabled title="Awaiting president approval">⏳</button>`
                  : `<button class="btn-danger btn-sm hist-del-btn" data-id="${h.id}" data-name="${escHtml(h.userName||'')}" data-month="${h.month||''}" title="${isPres?'Delete':'Request deletion'}" style="margin-left:4px">${isPres?'✕':'🗑'}</button>`
                }
              </td>`:''}
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;

  // ── History edit (Finance & above) ──────────────
  if (canFinance) {
    container.querySelectorAll('.hist-edit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hid = btn.dataset.id;
        const rec = history.find(h => h.id === hid);
        if (!rec) return;
        openPage(`Edit Payroll Record — ${rec.userName||'?'} (${rec.month||'?'})`, `
          <div class="form-row">
            <div class="form-group"><label>Base Salary</label><input id="hpe-salary" type="number" value="${rec.salary||0}" inputmode="decimal"/></div>
            <div class="form-group"><label>Allowance</label><input id="hpe-allow" type="number" value="${rec.allowance||0}" inputmode="decimal"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Deductions</label><input id="hpe-deduct" type="number" value="${rec.deductions||0}" inputmode="decimal"/></div>
            <div class="form-group"><label>Net Pay</label><input id="hpe-net" type="number" value="${rec.netPay||0}" inputmode="decimal"/></div>
          </div>
          <div class="form-group"><label>Final Pay</label><input id="hpe-final" type="number" value="${rec.finalPay||0}" inputmode="decimal"/></div>
          <div class="form-group"><label>Notes (optional)</label><input id="hpe-notes" type="text" value="${escHtml(rec.notes||'')}" placeholder="e.g. 13th month included"/></div>
        `, `<button class="btn-primary" id="save-hpe-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

        document.getElementById('save-hpe-btn').addEventListener('click', async () => {
          const salary    = parseFloat(document.getElementById('hpe-salary').value)||0;
          const allowance = parseFloat(document.getElementById('hpe-allow').value)||0;
          const deductions= parseFloat(document.getElementById('hpe-deduct').value)||0;
          const netPay    = parseFloat(document.getElementById('hpe-net').value)||0;
          const finalPay  = parseFloat(document.getElementById('hpe-final').value)||0;
          const notes     = document.getElementById('hpe-notes').value.trim();
          await db.collection('salary_history').doc(hid).update({
            salary, allowance, deductions, netPay, finalPay,
            ...(notes ? { notes } : {}),
            editedBy: currentUser.uid,
            editedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          // Keep ledger entry in sync
          const ledgerRef = `PAY-${rec.month}-${rec.userId}`;
          const ledgerSnap = await db.collection('ledger').where('refNumber','==',ledgerRef).limit(1).get().catch(()=>({docs:[]}));
          if (!ledgerSnap.docs.length && rec.userId) {
            // Individual entry didn't exist yet — create it
            await db.collection('ledger').add({
              date: rec.month + '-01',
              type: 'debit',
              description: `Payslip — ${rec.userName||'?'} (${new Date(rec.month+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'})})`,
              amount: finalPay,
              category: 'Payroll Expense',
              source: 'Finance',
              refNumber: ledgerRef,
              addedBy: currentUser.uid,
              addedByName: window.userProfile?.displayName || currentUser.email,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } else if (ledgerSnap.docs.length) {
            await ledgerSnap.docs[0].ref.update({ amount: finalPay });
          }
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
          closeModal();
          Notifs.showToast('Payroll record updated!');
          loadFinanceContent(currentUser, currentRole, 'Payroll');
        });
      });
    });

    // ── Delete: president deletes directly; finance requests approval ──
    container.querySelectorAll('.hist-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hid   = btn.dataset.id;
        const name  = btn.dataset.name;
        const month = btn.dataset.month;

        if (isPres) {
          if (!(await confirmDialog({message:`Delete payroll record for ${escHtml(name||'?')} (${month||'?'})? This cannot be undone.`, danger:true, html:true}))) return;
          // Cascade handles the linked PAY- ledger entry AND restores any cash-advance
          // balances this run deducted (reads the doc's own fields — no fragile split).
          await window.financeExecuteDelete('salary_history', hid);
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
          Notifs.showToast('Record deleted');
          loadFinanceContent(currentUser, currentRole, 'Payroll');
        } else {
          // Finance requests president approval
          openModal('Request Payroll Record Deletion', `
            <p style="margin-bottom:12px;color:var(--text-muted);font-size:13px">You are requesting deletion of the payroll record for <strong>${escHtml(name)}</strong> (${month}). The President must approve before it is deleted.</p>
            <div class="form-group"><label>Reason for deletion</label><input id="del-reason" placeholder="e.g. Duplicate entry, incorrect data…"/></div>
          `, `<button class="btn-primary" id="submit-del-req-btn">Submit for Approval</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
          document.getElementById('submit-del-req-btn').addEventListener('click', async () => {
            const reason = document.getElementById('del-reason').value.trim();
            if (!reason) { Notifs.showToast('Please enter a reason.','error'); return; }
            const rec = history.find(h => h.id === hid);
            await db.collection('payroll_delete_requests').add({
              historyId:       hid,
              userId:          rec?.userId || '',
              userName:        name,
              month,
              reason,
              requestedBy:     currentUser.uid,
              requestedByName: window.userProfile?.displayName || currentUser.email,
              status:          'pending',
              createdAt:       firebase.firestore.FieldValue.serverTimestamp()
            });
            await Notifs.sendToOwner({
              title: '🗑 Payroll Delete Request',
              body:  `${window.userProfile?.displayName||currentUser.email} requested deletion of ${name}'s ${month} payroll record. Reason: ${reason}`,
              icon: '🗑', type: 'payroll_delete_request'
            });
            closeModal();
            Notifs.showToast('Deletion request sent to President for approval.');
            loadFinanceContent(currentUser, currentRole, 'Payroll');
          });
        }
      });
    });

    // ── President: approve or deny pending delete requests ──────────
    if (isPres) {
      container.querySelectorAll('.del-req-approve').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reqId  = btn.dataset.reqId;
          const histId = btn.dataset.histId;
          const req    = delReqs.find(r => r.id === reqId);
          if (!(await confirmDialog({message:`Approve deletion of ${escHtml(req?.userName||'?')} (${req?.month||'?'}) payroll record?`, danger:true, html:true}))) return;
          btn.disabled = true;
          // Guard against re-running an already-resolved request.
          const _chk = await db.collection('payroll_delete_requests').doc(reqId).get().catch(()=>null);
          if (_chk && _chk.exists && _chk.data().status !== 'pending') { Notifs.showToast('Already handled.'); loadFinanceContent(currentUser, currentRole, 'Payroll'); return; }
          // Cascade removes the PAY- ledger debit and restores deducted cash advances.
          await window.financeExecuteDelete('salary_history', histId);
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
          await db.collection('payroll_delete_requests').doc(reqId).update({ status:'approved', resolvedAt: firebase.firestore.FieldValue.serverTimestamp() });
          if (req?.requestedBy) {
            await Notifs.send(req.requestedBy, {
              title: '✅ Payroll Delete Approved',
              body: `Your request to delete ${req.userName}'s ${req.month} payroll record has been approved.`,
              icon: '✅', type: 'payroll_delete_approved'
            });
          }
          Notifs.showToast('Record deleted and requester notified.');
          loadFinanceContent(currentUser, currentRole, 'Payroll');
        });
      });

      container.querySelectorAll('.del-req-deny').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reqId  = btn.dataset.reqId;
          const reqBy  = btn.dataset.reqBy;
          const req    = delReqs.find(r => r.id === reqId);
          await db.collection('payroll_delete_requests').doc(reqId).update({ status:'denied', resolvedAt: firebase.firestore.FieldValue.serverTimestamp() });
          if (reqBy) {
            await Notifs.send(reqBy, {
              title: '❌ Payroll Delete Denied',
              body: `Your request to delete ${req?.userName||'?'}'s ${req?.month||'?'} payroll record was denied by the President.`,
              icon: '❌', type: 'payroll_delete_denied'
            });
          }
          Notifs.showToast('Request denied and requester notified.');
          loadFinanceContent(currentUser, currentRole, 'Payroll');
        });
      });
    }
  }

  // Per-employee CA plan (WS22's CashAdvance.planFor), read by both the table
  // preview and the Edit Payroll modal — one shared computation, not two.
  let _planByUser = {};

  async function loadPayrollTable(month) {
    const tbody = document.getElementById('payroll-tbody');
    tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:20px">Loading…</td></tr>';

    const statYear = window.bizYear ? window.bizYear() : new Date().getFullYear();
    const plans = await Promise.all(employees.map(u => window.CashAdvance
      ? window.CashAdvance.planFor(u.id, month)
      : Promise.resolve({ caBalance:0, mode:'full', caPlanned:0, plan:[] })));
    _planByUser = {};
    employees.forEach((u,i) => { _planByUser[u.id] = plans[i]; });

    tbody.innerHTML = employees.map(u => {
      const depts    = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—';
      const base     = u.salary||0;
      const allow    = u.allowance||0;
      const gross    = base + allow;
      // Hand-typed value wins; otherwise WS21's statutory table suggests the amount
      // (the "Auto-computed if 0" placeholder text is finally backed by real math).
      const sug      = window.computeStatutory ? window.computeStatutory({ grossPay: gross, year: statYear }) : null;
      const sss      = u.sss        || (sug ? sug.ee.sss : 0);
      const ph       = u.philhealth || (sug ? sug.ee.philhealth : 0);
      const pagibig  = u.pagibig    || (sug ? sug.ee.pagibig : 0);
      const tax      = u.tax        || (sug ? sug.ee.tax : 0);
      const plan     = _planByUser[u.id] || { caBalance:0, mode:'full', caPlanned:0, plan:[] };
      const caBalance= plan.caBalance;
      const caAdv    = plan.caPlanned;
      const deduct   = (u.deductions||0) + sss + ph + pagibig + tax;
      const net      = gross - deduct - caAdv;
      const modeTag  = { installment:'installment', 'custom-request':'custom', 'legacy-override':'custom', full:'full' }[plan.mode];
      const caCell   = caBalance > 0
        ? `<div style="color:var(--danger);white-space:nowrap">-₱${fmt(caAdv)}${modeTag?` <span style="font-size:10px;background:var(--primary-light);color:#fff;border-radius:4px;padding:1px 5px">${modeTag}</span>`:''}</div>
           <div style="font-size:10px;color:var(--text-muted)">bal ₱${fmt(caBalance)}</div>`
        : '<span style="color:var(--text-muted)">—</span>';
      return `<tr>
        <td style="text-align:center">
          <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:14px;margin:0 auto">
            ${u.photoUrl?`<img src="${u.photoUrl}" style="width:100%;height:100%;object-fit:cover"/>`:((u.displayName||'?')[0])}
          </div>
        </td>
        <td><strong>${escHtml(u.displayName||u.email)}</strong><div style="font-size:11px;color:var(--text-muted)">${escHtml(u.title||ROLES[u.role]?.label||u.role)}</div></td>
        <td><code>${u.employeeId||'—'}</code></td>
        <td>${depts}</td>
        <td>₱${fmt(base)}</td>
        <td style="color:var(--success)">+₱${fmt(allow)}</td>
        <td style="color:var(--danger)">-₱${fmt(u.deductions||0)}</td>
        <td style="color:var(--danger)">-₱${fmt(sss)}</td>
        <td style="color:var(--danger)">-₱${fmt(ph)}</td>
        <td style="color:var(--danger)">-₱${fmt(pagibig)}</td>
        <td style="color:var(--danger)">-₱${fmt(tax)}</td>
        <td>${caCell}</td>
        <td><strong style="color:${net>=0?'var(--success)':'var(--danger)'}">₱${fmt(net)}</strong></td>
        <td>
          <button class="btn-secondary btn-sm edit-emp-pay-btn" data-uid="${u.id}" title="Edit">✎</button>
          ${canFinance ? `<button class="btn-secondary btn-sm raise-emp-btn" data-uid="${u.id}" title="Give raise">${emojiIcon('banknote',14)}</button>` : ''}
          <button class="btn-secondary btn-sm print-slip-btn" data-uid="${u.id}" title="Payslip">🖨</button>
        </td>
      </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons({ nodes: [tbody] });

    tbody.querySelectorAll('.raise-emp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const emp = employees.find(u=>u.id===btn.dataset.uid);
        if (!emp) return;
        openSalaryRaiseModal({
          subjectType: 'payroll',
          subjectId:   emp.id,
          subjectName: emp.displayName || emp.email,
          fieldLabel:  'Base Salary',
          targetField: 'salary',
          current:     emp.salary || 0
        }, currentUser, () => loadPayrollTable(month));
      });
    });

    tbody.querySelectorAll('.edit-emp-pay-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid  = btn.dataset.uid;
        const emp  = employees.find(u=>u.id===uid);
        const plan = _planByUser[uid] || { caBalance:0, mode:'full', caPlanned:0, plan:[] };
        const caBalance = plan.caBalance;
        if (!emp) return;

        const statYear = window.bizYear ? window.bizYear() : new Date().getFullYear();
        const sug = window.computeStatutory ? window.computeStatutory({ grossPay: (emp.salary||0)+(emp.allowance||0), year: statYear }) : null;
        const unverifiedBadge = sug && sug.unverified ? ` <span style="font-size:10px;color:var(--warning)">⚠ unverified rates</span>` : '';
        const inst = plan.plan[0]; // first CA in the plan, for the "installment N of M" label

        const _payClass = emp.payClass==='production' ? 'production' : 'regular';
        openPage(`Edit Payroll — ${emp.displayName}`, `
          <div class="form-group"><label>Employee Class</label>
            <select id="ep-class" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
              <option value="regular" ${_payClass==='regular'?'selected':''}>Regular — monthly (KPI + attendance)</option>
              <option value="production" ${_payClass==='production'?'selected':''}>Production — weekly, fixed rate (hourly attendance, 8-hr day)</option>
            </select>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Regular staff are paid monthly here; Production workers are paid weekly via the Payslip generator.</div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>${_payClass==='production'?'Weekly Rate':'Base Salary'}</label>
              <div style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface));color:var(--text-muted)">
                ₱${fmt(emp.salary||0)} · <span style="font-size:11px">change via 💸 Give Raise (approval-routed)</span>
              </div>
            </div>
            <div class="form-group"><label>Allowance</label><input id="ep-allow" type="number" value="${emp.allowance||0}" inputmode="decimal"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Other Deductions</label><input id="ep-deduct" type="number" value="${emp.deductions||0}" inputmode="decimal"/></div>
            <div class="form-group"><label>SSS${unverifiedBadge}</label><input id="ep-sss" type="number" value="${emp.sss||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.sss):'0.00'}" inputmode="decimal"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>PhilHealth</label><input id="ep-ph" type="number" value="${emp.philhealth||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.philhealth):'0.00'}" inputmode="decimal"/></div>
            <div class="form-group"><label>Pag-IBIG</label><input id="ep-pi" type="number" value="${emp.pagibig||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.pagibig):'0.00'}" inputmode="decimal"/></div>
          </div>
          <div class="form-group"><label>Tax</label><input id="ep-tax" type="number" value="${emp.tax||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.tax):'0.00'}" inputmode="decimal"/></div>
          ${caBalance > 0 ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <label style="font-weight:600">💳 Cash Advance — Outstanding ₱${fmt(caBalance)}${inst?` · Installment ${inst.installmentNo} of ${inst.terms}`:''}</label>
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                <input type="radio" name="ep-ca-mode" value="installment" ${plan.mode!=='full'?'checked':''}/>
                This month's installment — ₱${fmt(plan.caPlanned)}
              </label>
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                <input type="radio" name="ep-ca-mode" value="full" ${plan.mode==='full'?'checked':''}/>
                Pay off full balance — ₱${fmt(caBalance)}
              </label>
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                <input type="radio" name="ep-ca-mode" value="custom"/>
                Custom amount
                <input id="ep-ca-custom" type="number" min="0" max="${caBalance}" step="0.01" style="width:120px;margin-left:4px" placeholder="0.00"/>
              </label>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Remaining after this payroll: ₱<span id="ep-ca-remaining">${fmt(Math.max(0,caBalance-plan.caPlanned))}</span></div>
          </div>` : ''}
        `, `<button class="btn-primary" id="save-ep-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

        if (caBalance > 0) {
          const updateRemaining = () => {
            const mode   = document.querySelector('input[name="ep-ca-mode"]:checked')?.value || 'installment';
            const custom = parseFloat(document.getElementById('ep-ca-custom')?.value)||0;
            const amt    = mode==='full' ? caBalance : mode==='custom' ? Math.min(custom, caBalance) : plan.caPlanned;
            document.getElementById('ep-ca-remaining').textContent = fmt(Math.max(0, caBalance-amt));
          };
          document.querySelectorAll('input[name="ep-ca-mode"]').forEach(r=>r.addEventListener('change', updateRemaining));
          document.getElementById('ep-ca-custom')?.addEventListener('input', () => {
            const radio = document.querySelector('input[name="ep-ca-mode"][value="custom"]');
            if (radio) radio.checked = true;
            updateRemaining();
          });
        }

        document.getElementById('save-ep-btn').addEventListener('click', async () => {
          // All pay — base, allowance, and government deductions — lives in the
          // protected payroll/{uid} doc (finance/admin write), not the users doc.
          // v12 WS23 — base salary is NOT writable here (approval-routed via 💸
          // Give Raise instead); this modal only edits allowance/deductions/statutory.
          await db.collection('payroll').doc(uid).set({
            payClass:   document.getElementById('ep-class')?.value === 'production' ? 'production' : 'regular',
            allowance:  parseFloat(document.getElementById('ep-allow').value)||0,
            deductions: parseFloat(document.getElementById('ep-deduct').value)||0,
            sss:        parseFloat(document.getElementById('ep-sss').value)||0,
            philhealth: parseFloat(document.getElementById('ep-ph').value)||0,
            pagibig:    parseFloat(document.getElementById('ep-pi').value)||0,
            tax:        parseFloat(document.getElementById('ep-tax').value)||0,
          }, {merge:true});
          if (emp) emp.payClass = document.getElementById('ep-class')?.value === 'production' ? 'production' : 'regular';
          window.logAudit && window.logAudit('update','payroll',uid,{ allowance:parseFloat(document.getElementById('ep-allow').value)||0 });

          // Override tracking (v12 WS21 decision 4) — flag divergence from the
          // computed suggestion for later audit review; never blocks the save.
          if (sug) {
            [['sss',sug.ee.sss,'ep-sss'],['philhealth',sug.ee.philhealth,'ep-ph'],['pagibig',sug.ee.pagibig,'ep-pi'],['tax',sug.ee.tax,'ep-tax']]
              .forEach(([field, computed, elId]) => {
                const typed = parseFloat(document.getElementById(elId).value)||0;
                if (typed && Math.abs(typed-computed) > 0.01) {
                  window.logAudit && window.logAudit('statutory-override','payroll',uid,{ field, computed, entered: typed });
                }
              });
          }

          // Cash-advance choice for THIS run (v12 WS22). Writes payroll_ca_overrides
          // as the transition mechanism — CashAdvance.planFor() reads it ahead of
          // WS20's frozen pay_runs.lines[i].caPlan on the next Compute.
          if (caBalance > 0) {
            const mode = document.querySelector('input[name="ep-ca-mode"]:checked')?.value || 'installment';
            const overrideRef = db.collection('payroll_ca_overrides').doc(`${uid}_${month}`);
            if (mode === 'installment') {
              await overrideRef.delete().catch(()=>{}); // revert to the plan default
            } else {
              const amount = mode === 'full' ? caBalance : Math.min(parseFloat(document.getElementById('ep-ca-custom')?.value)||0, caBalance);
              await overrideRef.set({ userId:uid, month, amount, setBy:currentUser.uid, setAt:firebase.firestore.FieldValue.serverTimestamp() });
            }
          }

          closeModal(); Notifs.showToast('Payroll updated!');
          loadPayrollTable(month);
        });
      });
    });
  }

  // ── Pay-run workflow: Compute → Verify → Disburse (per month) ──────────
  // Explicit, auditable states wrapping the existing salary computation (which
  // is unchanged). A pay_runs/{YYYY-MM} doc tracks the state + who/when. Compute
  // = the Generate button; Verify = finance/admin sign-off; Disburse = President
  // marks salaries actually released. Grace period: finalize by the 5th.
  const PR_STATES = ['draft','computed','verified','disbursed'];
  const PR_LABEL  = { draft:'Draft', computed:'Computed', verified:'Verified', disbursed:'Disbursed' };
  async function loadPayRunStrip(month){
    const wrap = document.getElementById('pay-run-strip'); if(!wrap) return;
    const doc  = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const data = (doc && doc.exists) ? doc.data() : {};
    const state = PR_STATES.includes(data.state) ? data.state : 'draft';
    const idx   = PR_STATES.indexOf(state);
    const day   = parseInt((window.bizDate?window.bizDate():'0000-00-00').slice(8,10),10) || 0;
    const isCurrent = month === thisMonth;
    const grace = (isCurrent && idx < 2)
      ? `Finalize this run by the <strong>5th</strong>${day>5?` — <span style="color:var(--danger)">overdue (day ${day})</span>`:` (today is day ${day})`}.`
      : '';
    wrap.innerHTML = `
      <div class="card"><div class="card-body" style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${PR_STATES.map((s,i)=>`<span class="badge ${i<idx?'badge-blue':i===idx?'badge-green':'badge-gray'}" style="font-size:11px">${i<=idx?'✓ ':''}${PR_LABEL[s]}</span>${i<PR_STATES.length-1?'<span style="color:var(--text-muted)">→</span>':''}`).join('')}
          <span style="flex:1"></span>
          ${data.totalNet!=null?`<span style="font-size:12px;color:var(--text-muted)">Net ₱${fmt(data.totalNet)} · ${data.employeeCount||0} staff</span>`:''}
        </div>
        ${grace?`<div style="font-size:12px;color:var(--text-muted)">⏳ ${grace}</div>`:''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${(canFinance && state==='computed')?`<button class="btn-secondary btn-sm" id="pr-verify-btn">✓ Mark Verified</button>`:''}
          ${(isPres && state==='verified')?`<button class="btn-primary btn-sm" id="pr-disburse-btn">💵 Disburse</button><button class="btn-secondary btn-sm" id="pr-reopen-btn">↺ Reopen</button>`:''}
          ${state==='draft'?`<span style="font-size:12px;color:var(--text-muted)">Use <strong>Compute Payroll</strong> to start this month's run.</span>`:''}
          ${state==='disbursed'&&data.disbursedAt?`<span style="font-size:12px;color:var(--success)">💵 Disbursed${data.disbursedByName?` by ${escHtml(data.disbursedByName)}`:''}</span>`:''}
        </div>
      </div></div>`;
    // Verify — only from 'computed' (re-checked here, not just hidden by the UI,
    // since a stale page could still fire a click after someone else acted).
    document.getElementById('pr-verify-btn')?.addEventListener('click', async ()=>{
      const chk = await db.collection('pay_runs').doc(month).get().catch(()=>null);
      if (!chk || !chk.exists || chk.data().state !== 'computed') { Notifs.showToast('Run must be Computed before Verify.','error'); loadPayRunStrip(month); return; }
      if(!(await confirmDialog({message:`Mark ${month} payroll as VERIFIED? This confirms the computed amounts have been checked.`}))) return;
      await db.collection('pay_runs').doc(month).set({ state:'verified', verifiedBy:currentUser.uid, verifiedByName:window.userProfile?.displayName||currentUser.email, verifiedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      window.logAudit && window.logAudit('update','pay_run',month,{state:'verified'});
      Notifs.showToast('Payroll marked verified.'); loadPayRunStrip(month);
    });
    // Disburse — v12 WS20 D6: THE single mutating step (CA deducted, ledger
    // posted, salary_history frozen, employees notified). Terminal afterward.
    document.getElementById('pr-disburse-btn')?.addEventListener('click', async ()=>{
      const chk  = await db.collection('pay_runs').doc(month).get().catch(()=>null);
      const data2 = (chk && chk.exists) ? chk.data() : {};
      if(!(await confirmDialog({message:`Disburse ${month} payroll — ₱${fmt(data2.totalNet||0)} to ${data2.employeeCount||0} staff? This deducts cash advances, posts the ledger, and notifies employees. This cannot be undone.`, danger:true}))) return;
      const dbtn = document.getElementById('pr-disburse-btn');
      dbtn.disabled = true; dbtn.textContent = 'Disbursing…';
      try {
        await window.disbursePayRun(month);
        Notifs.showToast('Payroll disbursed!');
      } catch (err) {
        Notifs.showToast(err.message || 'Could not disburse payroll.', 'error');
      }
      loadPayRunStrip(month);
      loadFinanceContent(currentUser, currentRole, 'Payroll');
    });
    // Reopen — president-only, verified → computed (v12 WS20 D5).
    document.getElementById('pr-reopen-btn')?.addEventListener('click', async ()=>{
      if(!(await confirmDialog({message:`Reopen ${month} payroll for editing? This returns it to Computed — Verify again before Disburse.`}))) return;
      await window.reopenPayRun(month);
      loadPayRunStrip(month);
    });
  }

  loadPayrollTable(thisMonth);
  loadPayRunStrip(thisMonth);
  document.getElementById('pr-month-sel').addEventListener('change', e => { loadPayrollTable(e.target.value); loadPayRunStrip(e.target.value); });
  document.getElementById('raise-history-btn')?.addEventListener('click', () => openRaiseHistory());
  document.getElementById('pr-view-raises')?.addEventListener('click', () => window.openScheduledRaises());

  document.getElementById('gen-payroll-btn').addEventListener('click', async () => {
    const month = document.getElementById('pr-month-sel').value;

    // Compute is allowed only in draft/computed — once Verified, the President
    // must Reopen first (v12 WS20 D5: kills the old silent disburse→computed
    // regression, where Compute could be re-clicked after Verify/Disburse).
    const runSnap  = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const runState = (runSnap && runSnap.exists) ? (runSnap.data().state||'draft') : 'draft';
    if (['verified','disbursed'].includes(runState)) {
      Notifs.showToast(`Run is ${runState} — President must Reopen first.`, 'error');
      return;
    }
    if (!(await confirmDialog({message:`Compute payroll for ${new Date(month+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'})}? Safe to re-run before Verify — no money moves until Disburse.`}))) return;
    // Checked once, before any write — a closed month can't be (re)computed
    // (v12 WS12; toast shown by assertPeriodOpen if blocked).
    try { await window.assertPeriodOpen(month + '-01'); } catch (e) { return; }

    const btn = document.getElementById('gen-payroll-btn');
    btn.disabled = true; btn.textContent = 'Computing…';
    try {
      await window.computePayRun(month);
      Notifs.showToast('Payroll computed!');
    } catch (err) {
      Notifs.showToast(err.message || 'Could not compute payroll.', 'error');
    }
    loadFinanceContent(currentUser, currentRole, 'Payroll');
  });

  // v12 WS24 — the two print buttons were dead UI (no handler ever attached).
  // Delegated on the tbody since rows re-render on every loadPayrollTable call.
  document.getElementById('payroll-tbody').addEventListener('click', async (e) => {
    const b = e.target.closest('.print-slip-btn'); if (!b) return;
    const month = document.getElementById('pr-month-sel').value;
    const runDoc = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const line = runDoc?.exists ? (runDoc.data().lines||[]).find(l=>l.uid===b.dataset.uid) : null;
    let model;
    if (line) {
      model = window.toPayslipModel({...line, month}, 'monthly');
      model.official = runDoc.data().state === 'disbursed';
      model.payDateLabel = runDoc.data().disbursedAt ? new Date(runDoc.data().disbursedAt.toDate()).toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}) : '';
    } else {
      // Interim projection — no computed line for this month yet.
      const emp = employees.find(u=>u.id===b.dataset.uid);
      if (!emp) return;
      model = window.toPayslipModel({ ...emp, uid:emp.id, month, base:emp.salary }, 'monthly');
      model.official = false;
    }
    model.ytd = await window.payslipYtdMonthly(b.dataset.uid, window.bizYear?window.bizYear():new Date().getFullYear());
    window.renderPayslipPage(model, () => window.renderFinance(currentUser, currentRole, 'Payroll'));
  });
  document.getElementById('print-payroll-btn').addEventListener('click', async () => {
    const month = document.getElementById('pr-month-sel').value;
    const runDoc = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const lines = runDoc?.exists ? (runDoc.data().lines||[]) : [];
    if (!lines.length) { Notifs.showToast('No computed pay run for this month yet.','error'); return; }
    const year = window.bizYear ? window.bizYear() : new Date().getFullYear();
    const official = runDoc.data().state === 'disbursed';
    const models = await Promise.all(lines.map(async l => {
      const mdl = window.toPayslipModel({...l, month}, 'monthly');
      mdl.official = official;
      mdl.ytd = await window.payslipYtdMonthly(l.uid, year);
      return mdl;
    }));
    const host = document.getElementById('page-content');
    host.innerHTML = `
      <div class="no-print" style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
        <button class="btn-secondary btn-sm" id="ps-back-btn">← Back</button>
        <button class="btn-primary btn-sm" onclick="window.print()">🖨 Print All</button>
      </div>
      ${models.map(mdl => `<div class="payslip-print" style="page-break-after:always">${window.buildPayslipHTML(mdl)}</div>`).join('')}`;
    document.getElementById('ps-back-btn').addEventListener('click', () => window.renderFinance(currentUser, currentRole, 'Payroll'));
  });
}

// ── Taxes Tab ───────────────────────────────────
async function renderTaxesTab(container, currentUser, currentRole) {
  const snap = await db.collection('tax_records').orderBy('createdAt','desc').limit(50).get().catch(()=>({docs:[]}));
  const records = snap.docs.map(d=>({id:d.id,...d.data()}));
  const isPriv = isFinancePriv();
  container.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button class="btn-primary btn-sm" id="add-tax-btn">+ Add Tax Record</button>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        ${!records.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">📊</div><h4>No tax records yet</h4></div>':
          `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Period</th><th>Type</th><th>Amount</th><th>Status</th><th>Due Date</th><th>Filed By</th><th></th></tr></thead>
            <tbody>${records.map(r=>`<tr>
              <td>${escHtml(r.period||'—')}</td>
              <td><span class="badge badge-blue">${escHtml(r.type||'BIR')}</span></td>
              <td><strong>₱${fmt(r.amount)}</strong></td>
              <td><span class="badge ${r.status==='filed'?'badge-green':r.status==='paid'?'badge-blue':'badge-orange'}">${r.status||'pending'}</span></td>
              <td>${r.dueDate||'—'}</td>
              <td>${escHtml(r.filedBy||'—')}</td>
              <td style="white-space:nowrap">
                ${isPriv?`<button class="btn-secondary btn-sm tax-edit-btn" data-id="${r.id}">✎</button>`:''}
                ${isPriv?`<button class="btn-danger btn-sm tax-del-btn" data-id="${r.id}" data-label="${escHtml((r.type||'Tax')+' — '+(r.period||r.id.slice(-5)))}" style="margin-left:4px">${emojiIcon('trash-2',14)}</button>`:''}
                ${r.fileUrl?`<a href="${safeHttpUrl(r.fileUrl)}" target="_blank" class="btn-secondary btn-sm" style="margin-left:4px">📎</a>`:''}
              </td>
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  document.getElementById('add-tax-btn').addEventListener('click', () => {
    openPage('Add Tax Record', `
      <div class="form-row">
        <div class="form-group"><label>Period</label><input id="tax-period" placeholder="e.g. Q1 2026"/></div>
        <div class="form-group"><label>Type</label>
          <select id="tax-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option>BIR - Quarterly</option><option>BIR - Annual ITR</option>
            <option>VAT</option><option>Withholding Tax</option><option>Percentage Tax</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Amount (₱)</label><input id="tax-amount" type="number" step="0.01" inputmode="decimal"/></div>
        <div class="form-group"><label>Due Date</label><input id="tax-due" type="date"/></div>
      </div>
      <div class="form-group"><label>Status</label>
        <select id="tax-status" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="pending">Pending</option><option value="filed">Filed</option><option value="paid">Paid</option>
        </select>
      </div>
      <div id="tax-file-area"></div>
    `, `<button class="btn-primary" id="save-tax-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let taxFile = null;
    Drive.renderUploadArea('tax-file-area', r=>{taxFile=r;},{label:'Attach BIR receipt/form',dept:'Finance',subfolder:'Taxes'});
    document.getElementById('save-tax-btn').addEventListener('click', async () => {
      await db.collection('tax_records').add({
        period:   document.getElementById('tax-period').value.trim(),
        type:     document.getElementById('tax-type').value,
        amount:   parseFloat(document.getElementById('tax-amount').value)||0,
        dueDate:  document.getElementById('tax-due').value,
        status:   document.getElementById('tax-status').value,
        fileUrl:  taxFile?.url||null, fileName: taxFile?.name||null,
        filedBy:  currentUser.uid, filedByName: userProfile?.displayName||currentUser.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); Notifs.showToast('Tax record saved!');
      renderTaxesTab(container, currentUser, currentRole);
    });
  });

  // Edit (finance) / Delete (President approval)
  if (isPriv) {
    container.querySelectorAll('.tax-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const r = records.find(x=>x.id===btn.dataset.id); if (!r) return;
      window.financeEditModal({ collection:'tax_records', docId:r.id, title:'Tax Record', onSaved:()=>renderTaxesTab(container,currentUser,currentRole), fields:[
        { key:'period', label:'Period', type:'text', value:r.period },
        { key:'type',   label:'Type',   type:'select', value:r.type, options:['BIR - Quarterly','BIR - Annual ITR','VAT','Withholding Tax','Percentage Tax'] },
        { key:'amount', label:'Amount (₱)', type:'number', value:r.amount },
        { key:'dueDate',label:'Due Date', type:'date', value:r.dueDate },
        { key:'status', label:'Status', type:'select', value:r.status||'pending', options:['pending','filed','paid'] }
      ]});
    }));
    container.querySelectorAll('.tax-del-btn').forEach(btn => btn.addEventListener('click', () => {
      window.financeDelete({ collection:'tax_records', docId:btn.dataset.id, label:`tax record "${btn.dataset.label}"`, onDone:()=>renderTaxesTab(container,currentUser,currentRole) });
    }));
  }
}

// Export the currently-shown report period's ledger rows to CSV (accountant/BIR).
window.exportFinReportCSV = function() {
  const rows = window._finReportRows || [];
  const slug = (window._finReportLabel || 'ledger').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  window.exportCSV('ledger-' + slug, rows, [
    { key:'date', label:'Date' },
    { key:'type', label:'Type' },
    { key:'category', label:'Category' },
    { key:'description', label:'Description' },
    { key:'refNumber', label:'Reference', get:r=>r.refNumber||'' },
    { key:'amount', label:'Amount', get:r=>r.amount||0 },
    { key:'vatAmount', label:'Output VAT', get:r=>r.vatAmount||0 },
    { key:'inputVat', label:'Input VAT', get:r=>r.inputVat||0 },
    { key:'source', label:'Source', get:r=>r.source||'' }
  ]);
};

// ── Financial Reports (Income Statement + VAT/BIR reference) ─────
// Computed from the ledger (ledgerKind() = income/expense, v12 WS13 chart-of-
// accounts aware) + general journal. Read-only summary for finance/admin;
// print-ready for filing. Period picker (v12 WS12) supports any month/quarter/
// year, not just This-Month/YTD/All — see window.Period in config.js.
window.renderFinancialReports = async function(container, currentUser, currentRole, range='month') {
  container.innerHTML = '<div class="loading-placeholder">Building report…</div>';
  const [ledgerSnap, gjSnap] = await Promise.all([
    db.collection('ledger').orderBy('date','desc').limit(3000).get().catch(()=>({docs:[]})),
    db.collection('general_journal').orderBy('date','desc').limit(3000).get().catch(()=>({docs:[]}))
  ]);
  const led = ledgerSnap.docs.map(d=>d.data());
  const gj  = gjSnap.docs.flatMap(d=>{ const e=d.data(); const rows=[];
    if (e.debit)  rows.push({date:e.date, type:'debit',  amount:e.debit,  category:'Journal Entry'});
    if (e.credit) rows.push({date:e.date, type:'credit', amount:e.credit, category:'Journal Entry'});
    return rows; });
  let all = [...led, ...gj];

  // 'year' (legacy Reports spelling) is a Period alias for 'ytd' — same math.
  const periodKey = (range === 'year') ? 'ytd' : range;
  const pParsed = window.Period.parse(periodKey);
  all = all.filter(e => window.Period.match(e.date, pParsed));
  const label = pParsed.type === 'all' ? 'All Time' : (periodKey === 'ytd' ? 'YTD ' + bizYear() : pParsed.label);
  // Stash the period's rows so the CSV export button (inline onclick) can reach them.
  window._finReportRows = all.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  window._finReportLabel = label;

  const income  = all.filter(e=>ledgerKind(e)==='income');
  const expense = all.filter(e=>ledgerKind(e)==='expense');
  const totIncome  = income.reduce((s,e)=>s+(e.amount||0),0);
  const totExpense = expense.reduce((s,e)=>s+(e.amount||0),0);
  const net = totIncome - totExpense;
  const byCat = arr => { const m={}; arr.forEach(e=>{const k=e.category||'Other'; m[k]=(m[k]||0)+(e.amount||0);}); return Object.entries(m).sort((a,b)=>b[1]-a[1]); };
  const incCats = byCat(income), expCats = byCat(expense);
  const salesRows = income.filter(e=>(e.category||'')==='Sales Revenue');
  const sales = salesRows.reduce((s,e)=>s+(e.amount||0),0);
  // Output VAT = sum of each sale's stored vatAmount (respects its per-entry VAT
  // treatment: inclusive / exclusive / exempt). Legacy rows with no vatAmount fall
  // back to the VAT-inclusive split (amount − amount/1.12).
  const outputVat = salesRows.reduce((s,e)=>{
    if (e.vatAmount != null) return s + e.vatAmount;
    const amt = e.amount||0; return s + (amt - amt/1.12);
  }, 0);
  // Input VAT = reclaimable VAT on VATable purchases/disbursements (stored as
  // inputVat on the expense ledger rows). Net VAT Payable = output − input.
  const inputVat = expense.reduce((s,e)=>s+(e.inputVat||0),0);
  const netVat = outputVat - inputVat;
  const isPres = (typeof isPresident==='function') && isPresident();
  const isClosableMonth = pParsed.type==='month' && pParsed.key !== 'month:'+bizDate().slice(0,7);
  let periodClosed = false;
  if (isClosableMonth) periodClosed = await window.isPeriodClosed(pParsed.start).catch(()=>false);

  container.innerHTML = `
    <div id="finrep-period">${window.periodPicker(periodKey, {})}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;color:var(--text-muted)">${label}${periodClosed?' &nbsp;<span class="badge badge-gray">🔒 Closed</span>':''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${isFinancePriv()?`<button class="btn-secondary btn-sm" onclick="window.runLedgerBackfill()" title="Post approved expenses + cash journals into the ledger">🔄 Sync to ledger</button>`:''}
        ${isPres?`<button class="btn-secondary btn-sm" onclick="window.runTagAccountTypes()" title="Backfill accountType on legacy ledger rows">🏷 Tag account types</button>`:''}
        ${isPres?`<button class="btn-secondary btn-sm" onclick="window.runRestateMaterialCosts()" title="Fix the double material-expensing bug on historical rows">🧾 Restate material costs</button>`:''}
        ${isPres?`<button class="btn-secondary btn-sm" onclick="window.runFixUndatedRows()" title="Repair ledger rows with a missing/malformed date">🩹 Fix undated rows</button>`:''}
        ${isPres&&isClosableMonth?(periodClosed
            ? `<button class="btn-secondary btn-sm" id="finrep-reopen-btn" data-month="${pParsed.key.slice(6)}">🔓 Reopen ${pParsed.label}</button>`
            : `<button class="btn-secondary btn-sm" id="finrep-close-btn" data-month="${pParsed.key.slice(6)}" data-label="${escHtml(pParsed.label)}">🔒 Close ${pParsed.label}</button>`
          ):''}
        <button class="btn-secondary btn-sm" onclick="window.exportFinReportCSV()" title="Export this period's ledger to CSV">⬇ CSV</button>
        <button class="btn-secondary btn-sm" onclick="window.print()">🖨 Print</button>
      </div>
    </div>
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card green"><div class="kpi-label">Total Income</div><div class="kpi-value">₱${fmt(totIncome)}</div></div>
      <div class="kpi-card red"><div class="kpi-label">Total Expenses</div><div class="kpi-value">₱${fmt(totExpense)}</div></div>
      <div class="kpi-card ${net>=0?'accent':'red'}"><div class="kpi-label">Net Income</div><div class="kpi-value">₱${fmt(net)}</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>📈 Income Statement</h3></div>
      <div class="card-body" style="padding:0"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account / Category</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          <tr><td colspan="2" style="font-weight:800;color:var(--success);background:rgba(48,209,88,0.06)">INCOME</td></tr>
          ${incCats.length?incCats.map(([k,v])=>`<tr><td style="padding-left:24px">${escHtml(k)}</td><td style="text-align:right">₱${fmt(v)}</td></tr>`).join(''):'<tr><td style="padding-left:24px;color:var(--text-muted)">No income recorded</td><td style="text-align:right">₱0.00</td></tr>'}
          <tr><td style="font-weight:700">Total Income</td><td style="text-align:right;font-weight:700;color:var(--success)">₱${fmt(totIncome)}</td></tr>
          <tr><td colspan="2" style="font-weight:800;color:var(--danger);background:rgba(255,69,58,0.06)">EXPENSES</td></tr>
          ${expCats.length?expCats.map(([k,v])=>`<tr><td style="padding-left:24px">${escHtml(k)}</td><td style="text-align:right">₱${fmt(v)}</td></tr>`).join(''):'<tr><td style="padding-left:24px;color:var(--text-muted)">No expenses recorded</td><td style="text-align:right">₱0.00</td></tr>'}
          <tr><td style="font-weight:700">Total Expenses</td><td style="text-align:right;font-weight:700;color:var(--danger)">₱${fmt(totExpense)}</td></tr>
          <tr style="border-top:2px solid var(--border)"><td style="font-weight:800;font-size:14px">NET INCOME</td><td style="text-align:right;font-weight:800;font-size:14px;color:${net>=0?'var(--success)':'var(--danger)'}">₱${fmt(net)}</td></tr>
        </tbody>
      </table></div></div>
    </div>

    <div class="card">
      <div class="card-header"><h3>🧾 Tax / VAT Reference</h3></div>
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span>Sales Revenue (recorded total)</span><strong>₱${fmt(sales)}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span>Output VAT (on sales)</span><strong>₱${fmt(outputVat)}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span>Less: Input VAT (on purchases)</span><strong style="color:var(--success)">−₱${fmt(inputVat)}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid var(--border);font-weight:800"><span>Net VAT ${netVat>=0?'Payable':'Creditable'}</span><strong style="color:${netVat>=0?'var(--danger)':'var(--success)'}">₱${fmt(Math.abs(netVat))}</strong></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.5">Output VAT is summed per sale's VAT treatment (inclusive / exclusive / exempt); input VAT from VATable purchases is netted off. Confirm with your accountant before BIR filing; attach official BIR forms via <em>Taxes</em>.</div>
      </div>
    </div>
  `;
  window.bindPeriodPicker(document.getElementById('finrep-period'), (newKey) => {
    // periodPicker/Period use canonical keys; renderFinancialReports keeps its
    // legacy 'year' spelling for the YTD case so its own external callers
    // (and the CSV/print title) read naturally — everything else passes through.
    renderFinancialReports(container, currentUser, currentRole, newKey === 'ytd' ? 'year' : newKey);
  }, { activeKey: periodKey });
  document.getElementById('finrep-close-btn')?.addEventListener('click', async () => {
    const mk = document.getElementById('finrep-close-btn').dataset.month;
    if (!(await confirmDialog({message:`Close the books for ${document.getElementById('finrep-close-btn').dataset.label}?\n\nNo new entries can post to this month until it's reopened.`}))) return;
    await window.closeFinancePeriod(mk);
    renderFinancialReports(container, currentUser, currentRole, range);
  });
  document.getElementById('finrep-reopen-btn')?.addEventListener('click', async () => {
    const mk = document.getElementById('finrep-reopen-btn').dataset.month;
    if (!(await confirmDialog({message:`Reopen ${mk} for editing?`}))) return;
    await window.reopenFinancePeriod(mk);
    renderFinancialReports(container, currentUser, currentRole, range);
  });
};

// ── Period close/reopen (v12 WS12) — president-only, audit-logged ────────
window.closeFinancePeriod = async function(monthKey) {
  await db.collection('finance_periods').doc(monthKey).set({
    closed: true, closedBy: currentUser.uid,
    closedByName: window.userProfile?.displayName || currentUser.email,
    closedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });
  window.logAudit && window.logAudit('close-period','finance_periods',monthKey,{});
  dbCacheInvalidate('finperiod-'+monthKey);
  Notifs.showToast(`${monthKey} closed — no new entries can post until reopened.`);
};
window.reopenFinancePeriod = async function(monthKey) {
  await db.collection('finance_periods').doc(monthKey).set({
    closed: false, reopenedBy: currentUser.uid,
    reopenedByName: window.userProfile?.displayName || currentUser.email,
    reopenedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });
  window.logAudit && window.logAudit('reopen-period','finance_periods',monthKey,{});
  dbCacheInvalidate('finperiod-'+monthKey);
  Notifs.showToast(`${monthKey} reopened.`);
};

// ── One-time maintenance: Tag account types (v12 WS13, president, idempotent) ──
// Backfills accountType/account onto every ledger row that predates the chart
// of accounts, via ledgerKind()'s legacy-derivation rule. Re-runnable — skips
// rows that already have accountType.
window.runTagAccountTypes = async function() {
  if (!(await confirmDialog({message:'Backfill accountType on every legacy ledger row?\n\nSafe to run repeatedly.'}))) return;
  Notifs.showToast('Tagging account types…');
  try {
    const snap = await db.collection('ledger').get();
    const todo = snap.docs.filter(d => typeof d.data().accountType !== 'string');
    let batch = db.batch(), inBatch = 0, tagged = 0;
    for (const d of todo) {
      const row = d.data();
      batch.update(d.ref, { accountType: ledgerKind(row), account: row.category || null });
      inBatch++; tagged++;
      if (inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch) await batch.commit();
    dbCacheInvalidate('ledger');
    window.logAudit && window.logAudit('tag-account-types','ledger',null,{tagged});
    Notifs.showToast(`Tagged ${tagged} row${tagged===1?'':'s'} ✓`);
  } catch (e) { Notifs.showToast('Tagging failed: '+(e.message||e),'error'); }
};

// ── One-time maintenance: Restate material costs (v12 WS13, president) ───
// Fixes the double-material-expensing bug: (a) reclassifies historical
// purchase-side CDJ mirrors that came from Purchasing (purchaseRef set,
// debitMaterial>0) to asset/Inventory; (b) backfills the missing
// POCOS-<id>-INV contra leg for every existing consumption row. Idempotent
// (keyed by refNumber) — safe to re-run.
window.runRestateMaterialCosts = async function() {
  if (!(await confirmDialog({message:'Restate historical material costs?\n\nThis corrects the double-counted purchase+consumption expense bug. Expense totals for past periods WILL change — this is a deliberate one-time restatement. Safe to run repeatedly.'}))) return;
  Notifs.showToast('Restating material costs…');
  try {
    let reclassified = 0, invLegsAdded = 0;
    // (a) purchase-side CDJ mirrors that should have been asset/Inventory
    const cdjSnap = await db.collection('cash_disbursement_journal').get().catch(()=>({docs:[]}));
    for (const d of cdjSnap.docs) {
      const e = d.data();
      if (!e.purchaseRef || !(e.debitMaterial > 0)) continue;
      const ref = `CDJ-${d.id}`;
      const lSnap = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>({docs:[]}));
      if (!lSnap.docs.length) continue;
      const lRow = lSnap.docs[0];
      if (lRow.data().accountType === 'asset') continue; // already restated
      await lRow.ref.update({ accountType:'asset', account:'Inventory', category:'Inventory – Materials' });
      reclassified++;
    }
    // (b) missing POCOS-<id>-INV contra legs
    const allLedger = await db.collection('ledger').get().catch(()=>({docs:[]}));
    const pocosRows = allLedger.docs.filter(d => {
      const ref = d.data().refNumber || '';
      return ref.startsWith('POCOS-') && !ref.endsWith('-INV');
    });
    const existingInv = new Set(allLedger.docs.filter(d=>(d.data().refNumber||'').endsWith('-INV')).map(d=>d.data().refNumber));
    for (const d of pocosRows) {
      const row = d.data();
      const refInv = row.refNumber + '-INV';
      if (existingInv.has(refInv)) continue;
      if (!(row.amount > 0)) continue;
      await db.collection('ledger').add({
        date: row.date || today(), type: 'credit',
        accountType: 'asset', account: 'Inventory', category: 'Inventory – Materials',
        description: `Inventory consumed — ${(row.description||'').replace(/^COS.*?—\s*/,'') || row.refNumber}`,
        amount: row.amount, refNumber: refInv, source: 'Production',
        projectId: row.projectId || null,
        addedBy: currentUser.uid, addedByName: 'Restatement',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      invLegsAdded++;
    }
    dbCacheInvalidate('ledger');
    window.logAudit && window.logAudit('restate-materials','ledger',null,{reclassified, invLegsAdded});
    Notifs.showToast(`Restated ${reclassified} purchase${reclassified===1?'':'s'}, added ${invLegsAdded} inventory leg${invLegsAdded===1?'':'s'} ✓`);
    const el = document.getElementById('fin-content');
    if (el) window.renderFinancialReports(el, window.currentUser, window.currentRole, 'all');
  } catch (e) { Notifs.showToast('Restatement failed: '+(e.message||e),'error'); }
};

// ── One-time maintenance: Fix undated rows (v12 WS12, president, idempotent) ──
// orderBy('date') silently DROPS any row with a missing/malformed date — this
// repairs historical rows so they reappear in every report. Re-runnable.
window.runFixUndatedRows = async function() {
  if (!(await confirmDialog({message:"Repair ledger + journal rows with a missing or malformed date?\n\nSafe to run repeatedly."}))) return;
  Notifs.showToast('Scanning for undated rows…');
  try {
    const dateRe = /^\d{4}-\d{2}(-\d{2})?$/;
    const manilaDateOf = (ts) => {
      try {
        const d = ts && ts.toDate ? ts.toDate() : (ts && ts.seconds ? new Date(ts.seconds*1000) : null);
        return d ? window.bizDate(d) : today();
      } catch(_) { return today(); }
    };
    let fixed = 0;
    for (const collName of ['ledger','general_journal']) {
      const snap = await db.collection(collName).get().catch(()=>({docs:[]}));
      const bad = snap.docs.filter(d => !dateRe.test(String(d.data().date||'')));
      let batch = db.batch(), inBatch = 0;
      for (const d of bad) {
        const newDate = manilaDateOf(d.data().createdAt);
        batch.update(d.ref, { date: newDate });
        inBatch++; fixed++;
        if (inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
      }
      if (inBatch) await batch.commit();
    }
    dbCacheInvalidate('ledger');
    window.logAudit && window.logAudit('fix-undated','ledger',null,{fixed});
    Notifs.showToast(`Fixed ${fixed} undated row${fixed===1?'':'s'} ✓`);
    const el = document.getElementById('fin-content');
    if (el) window.renderFinancialReports(el, window.currentUser, window.currentRole, 'all');
  } catch (e) { Notifs.showToast('Fix failed: '+(e.message||e),'error'); }
};

// ── Ledger Tab (includes merged General Journal entries) ─────
async function renderLedgerTab(container, currentUser, currentRole) {
  const [ledgerSnap, gjSnap] = await Promise.all([
    db.collection('ledger').orderBy('date','desc').limit(100).get().catch(()=>({docs:[]})),
    db.collection('general_journal').orderBy('date','desc').limit(100).get().catch(()=>({docs:[]}))
  ]);

  // Normalize ledger entries
  const ledgerEntries = ledgerSnap.docs.map(d => ({id:d.id, _src:'ledger', ...d.data()}));

  // Normalize general journal entries to ledger shape
  const gjEntries = gjSnap.docs.flatMap(d => {
    const e = {id:d.id, _src:'journal', ...d.data()};
    const rows = [];
    if (e.debit)  rows.push({...e, type:'debit',  amount:e.debit,  description:e.accountTitle||'—', category:'Journal Entry', refNumber:e.reference, source:'Journal'});
    if (e.credit) rows.push({...e, type:'credit', amount:e.credit, description:e.accountTitle||'—', category:'Journal Entry', refNumber:e.reference, source:'Journal'});
    return rows;
  });

  // Merge and sort by date desc
  const entries = [...ledgerEntries, ...gjEntries].sort((a,b)=>(b.date||'').localeCompare(a.date||''));

  const totalDebit  = entries.filter(e=>e.type==='debit').reduce((s,e)=>s+(e.amount||0),0);
  const totalCredit = entries.filter(e=>e.type==='credit').reduce((s,e)=>s+(e.amount||0),0);
  const balance     = totalCredit - totalDebit;
  const canFin      = isFinancePriv();

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card green"><div class="kpi-label">Total Credits</div><div class="kpi-value">₱${fmt(totalCredit)}</div></div>
      <div class="kpi-card red"><div class="kpi-label">Total Debits</div><div class="kpi-value">₱${fmt(totalDebit)}</div></div>
      <div class="kpi-card ${balance>=0?'accent':'red'}"><div class="kpi-label">Balance</div><div class="kpi-value">₱${fmt(balance)}</div></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px">
      ${entries.length?'<button class="btn-secondary btn-sm" id="ledger-csv-btn">⬇ CSV</button>':''}
      <button class="btn-primary btn-sm" id="add-ledger-btn">+ New Entry</button>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        ${!entries.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">📒</div><h4>No ledger entries yet</h4></div>':
          `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Date</th><th>Description / Account</th><th>Category</th><th>Source</th><th>Debit</th><th>Credit</th><th>Ref #</th><th>By</th>${canFin?'<th></th>':''}</tr></thead>
            <tbody>${entries.map(e=>`<tr>
              <td>${e.date||'—'}</td>
              <td>${escHtml(e.description||'—')}</td>
              <td><span class="badge badge-blue">${escHtml(e.category||'General')}</span></td>
              <td style="font-size:11px">${e.source&&e.source!=='Finance'?`<span class="badge badge-gray">${escHtml(e.source)}</span>`:'<span style="color:var(--text-muted)">Finance</span>'}</td>
              <td style="color:var(--danger)">${e.type==='debit'?'₱'+fmt(e.amount):'-'}</td>
              <td style="color:var(--success)">${e.type==='credit'?'₱'+fmt(e.amount):'-'}</td>
              <td><code>${escHtml(e.refNumber||'—')}</code></td>
              <td style="font-size:11px">${escHtml(e.addedByName||'—')}</td>
              ${canFin?`<td style="white-space:nowrap">
                <button class="btn-secondary btn-sm led-edit-btn" data-id="${e.id}" data-src="${e._src}">✎</button>
                <button class="btn-danger btn-sm led-del-btn" data-id="${e.id}" data-src="${e._src}" data-label="${escHtml((e.description||'entry')+' — ₱'+fmt(e.amount))}" style="margin-left:4px">${emojiIcon('trash-2',14)}</button>
              </td>`:''}
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  document.getElementById('ledger-csv-btn')?.addEventListener('click', () => window.exportCSV('ledger', entries, [
    {key:'date',label:'Date'},{key:'description',label:'Description'},{key:'category',label:'Category'},
    {key:'source',label:'Source',get:e=>e.source||'Finance'},
    {key:'debit',label:'Debit',get:e=>e.type==='debit'?(e.amount||0):''},
    {key:'credit',label:'Credit',get:e=>e.type==='credit'?(e.amount||0):''},
    {key:'refNumber',label:'Ref #'},{key:'addedByName',label:'By'}]));
  document.getElementById('add-ledger-btn').addEventListener('click', () => {
    // Account-type-aware account picker (v12 WS13) — grouped from window.COA,
    // defaulting from the credit/debit direction. This is the single easiest
    // place to accidentally post into a closed period (free date, no ref) —
    // highest-priority guard of the whole ledger surface (v12 WS12).
    const acctOptsFor = (accountType) => (window.COA[accountType]||[])
      .map(a => `<option value="${escHtml(a)}">${escHtml(a)}</option>`).join('');
    openPage('New Ledger Entry', `
      <div class="form-row">
        <div class="form-group"><label>Date</label><input id="led-date" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Type</label>
          <select id="led-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="credit">Credit (Income)</option><option value="debit">Debit (Expense)</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Description / Account Title</label><input id="led-desc" placeholder="e.g. Client payment — ABC Corp, or Accumulated Depreciation"/></div>
      <div class="form-row">
        <div class="form-group"><label>Amount (₱)</label><input id="led-amount" type="number" step="0.01" inputmode="decimal"/></div>
        <div class="form-group"><label>Account Type</label>
          <select id="led-accttype" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="income">Income</option><option value="expense" selected>Expense</option>
            <option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Account</label>
        <select id="led-account" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${acctOptsFor('expense')}</select>
      </div>
      <div class="form-group"><label>Reference Number</label><input id="led-ref" placeholder="OR #, Invoice #, JE #, etc."/></div>
      <div id="led-file-area"></div>
    `, `<button class="btn-primary" id="save-led-btn">Save Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let ledFile = null;
    Drive.renderUploadArea('led-file-area', r=>{ledFile=r;},{label:'Attach receipt/invoice',dept:'Finance',subfolder:'Ledger'});
    const typeSel = document.getElementById('led-type'), acctTypeSel = document.getElementById('led-accttype'), acctSel = document.getElementById('led-account');
    typeSel.addEventListener('change', () => {
      acctTypeSel.value = typeSel.value === 'credit' ? 'income' : 'expense';
      acctSel.innerHTML = acctOptsFor(acctTypeSel.value);
    });
    acctTypeSel.addEventListener('change', () => { acctSel.innerHTML = acctOptsFor(acctTypeSel.value); });
    document.getElementById('save-led-btn').addEventListener('click', async () => {
      const date = document.getElementById('led-date').value;
      try { await window.assertPeriodOpen(date); } catch (e) { return; } // toast already shown
      await db.collection('ledger').add({
        date,
        type:       typeSel.value,
        accountType: acctTypeSel.value, account: acctSel.value,
        description:document.getElementById('led-desc').value.trim(),
        amount:     parseFloat(document.getElementById('led-amount').value)||0,
        category:   acctSel.value,
        refNumber:  document.getElementById('led-ref').value.trim(),
        fileUrl:    ledFile?.url||null,
        addedBy:    currentUser.uid,
        addedByName:userProfile?.displayName||currentUser.email,
        createdAt:  firebase.firestore.FieldValue.serverTimestamp()
      });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
      closeModal(); Notifs.showToast('Ledger entry saved!');
      renderLedgerTab(container, currentUser, currentRole);
    });
  });

  // Edit (finance) / Delete (President approval) — a row is either a Finance
  // ledger entry or one leg of a General-Journal entry (data-src tells which).
  if (canFin) {
    const redo = () => renderLedgerTab(container, currentUser, currentRole);
    container.querySelectorAll('.led-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const e = entries.find(x=>x.id===btn.dataset.id && x._src===btn.dataset.src); if (!e) return;
      if (btn.dataset.src === 'journal') {
        window.financeEditModal({ collection:'general_journal', docId:e.id, title:'Journal Entry', onSaved:redo, fields:[
          { key:'date', label:'Date', type:'date', value:e.date },
          { key:'accountTitle', label:'Account Title', type:'text', value:e.accountTitle||e.description, full:true },
          { key:'debit',  label:'Debit (₱)',  type:'number', value:e.debit||0 },
          { key:'credit', label:'Credit (₱)', type:'number', value:e.credit||0 },
          { key:'reference', label:'Reference', type:'text', value:e.reference||e.refNumber, full:true }
        ]});
      } else {
        window.financeEditModal({ collection:'ledger', docId:e.id, title:'Ledger Entry', onSaved:redo, fields:[
          { key:'date', label:'Date', type:'date', value:e.date },
          { key:'type', label:'Type', type:'select', value:e.type, options:['credit','debit'] },
          { key:'description', label:'Description / Account', type:'text', value:e.description, full:true },
          { key:'amount', label:'Amount (₱)', type:'number', value:e.amount },
          { key:'category', label:'Category', type:'select', value:e.category||'Other', options:['Sales Revenue','Operating Expense','Payroll','Tax','Materials','Utilities','Journal Entry (Non-cash)','Other'] },
          { key:'refNumber', label:'Reference Number', type:'text', value:e.refNumber, full:true }
        ]});
      }
    }));
    container.querySelectorAll('.led-del-btn').forEach(btn => btn.addEventListener('click', () => {
      const coll = btn.dataset.src === 'journal' ? 'general_journal' : 'ledger';
      window.financeDelete({ collection:coll, docId:btn.dataset.id, label:`ledger entry "${btn.dataset.label}"`, onDone:redo });
    }));
  }
}

// ── Cash Receipt Journal (for cash-based receipts only) ──
async function renderCashReceiptJournal(container, currentUser, currentRole) {
  const snap = await db.collection('cash_receipt_journal').orderBy('date','desc').limit(100).get().catch(()=>({docs:[]}));
  const entries = snap.docs.map(d=>({id:d.id,...d.data()}));
  const totalCash = entries.reduce((s,e)=>s+(e.debitCash||0),0);
  const isPriv = isFinancePriv();

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card green"><div class="kpi-label">Total Cash Received</div><div class="kpi-value">₱${fmt(totalCash)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Entries</div><div class="kpi-value">${entries.length}</div></div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button class="btn-primary btn-sm" id="add-crj-btn">+ New Receipt Entry</button>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        ${!entries.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">🧾</div><h4>No cash receipt entries yet</h4></div>':
          `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Reference</th><th>Date</th><th>Customer</th><th>Debit Cash</th><th>Debit Sales Discount</th><th>Credit A/R</th><th>Credit Sales Revenue</th><th>Credit Sundry (Acct)</th><th>Credit Sundry (Amount)</th>${isPriv?'<th></th>':''}</tr></thead>
            <tbody>${entries.map(e=>`<tr>
              <td><code>${escHtml(e.reference||'—')}</code></td>
              <td>${e.date||'—'}</td>
              <td>${escHtml(e.customer||'—')}</td>
              <td style="color:var(--success)">₱${fmt(e.debitCash)}</td>
              <td>${e.debitSalesDiscount?'₱'+fmt(e.debitSalesDiscount):'—'}</td>
              <td>${e.creditAR?'₱'+fmt(e.creditAR):'—'}</td>
              <td>${e.creditSalesRevenue?'₱'+fmt(e.creditSalesRevenue):'—'}</td>
              <td>${escHtml(e.creditSundryAcct||'—')}</td>
              <td>${e.creditSundryAmount?'₱'+fmt(e.creditSundryAmount):'—'}</td>
              ${isPriv?`<td style="white-space:nowrap">
                <button class="btn-secondary btn-sm crj-edit-btn" data-id="${e.id}">✎</button>
                <button class="btn-danger btn-sm crj-del-btn" data-id="${e.id}" data-label="${escHtml((e.customer||'receipt')+' — ₱'+fmt(e.debitCash))}" style="margin-left:4px">${emojiIcon('trash-2',14)}</button>
              </td>`:''}
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  document.getElementById('add-crj-btn').addEventListener('click', () => {
    openPage('New Cash Receipt Entry', `
      <div class="form-row">
        <div class="form-group"><label>Reference</label><input id="crj-ref" placeholder="OR #, Receipt #…"/></div>
        <div class="form-group"><label>Date</label><input id="crj-date" type="date" value="${today()}"/></div>
      </div>
      <div class="form-group"><label>Customer</label><input id="crj-customer" placeholder="Customer name"/></div>
      <div class="form-row">
        <div class="form-group"><label>Debit: Cash (₱)</label><input id="crj-cash" type="number" step="0.01" value="0" inputmode="decimal"/></div>
        <div class="form-group"><label>Debit: Sales Discount (₱)</label><input id="crj-discount" type="number" step="0.01" value="0" inputmode="decimal"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Credit: Accounts Receivable (₱)</label><input id="crj-ar" type="number" step="0.01" value="0" inputmode="decimal"/></div>
        <div class="form-group"><label>Credit: Sales Revenue (₱)</label><input id="crj-revenue" type="number" step="0.01" value="0" inputmode="decimal"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Credit: Sundry Account</label><input id="crj-sundry-acct" placeholder="e.g. Other Income"/></div>
        <div class="form-group"><label>Credit: Sundry Amount (₱)</label><input id="crj-sundry-amt" type="number" step="0.01" value="0" inputmode="decimal"/></div>
      </div>
    `, `<button class="btn-primary" id="save-crj-btn">Save Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('save-crj-btn').addEventListener('click', async () => {
      const customer = document.getElementById('crj-customer').value.trim();
      const debitCash = parseFloat(document.getElementById('crj-cash').value)||0;
      if (!customer) { Notifs.showToast('Enter a customer name.','error'); return; }
      if (!debitCash) { Notifs.showToast('Enter the cash amount received.','error'); return; }
      const crjData = {
        reference:           document.getElementById('crj-ref').value.trim(),
        date:                document.getElementById('crj-date').value,
        customer,
        debitCash,
        debitSalesDiscount:  parseFloat(document.getElementById('crj-discount').value)||0,
        creditAR:            parseFloat(document.getElementById('crj-ar').value)||0,
        creditSalesRevenue:  parseFloat(document.getElementById('crj-revenue').value)||0,
        creditSundryAcct:    document.getElementById('crj-sundry-acct').value.trim(),
        creditSundryAmount:  parseFloat(document.getElementById('crj-sundry-amt').value)||0,
        addedBy:    currentUser.uid,
        addedByName: window.userProfile?.displayName || currentUser.email,
        createdAt:  firebase.firestore.FieldValue.serverTimestamp()
      };
      try {
        await window.assertPeriodOpen(crjData.date);
      } catch (e) { return; } // toast already shown by assertPeriodOpen
      const crjDoc = await db.collection('cash_receipt_journal').add(crjData);
      await postCRJToLedger(crjDoc.id, crjData); // mirror new income into the ledger
      closeModal(); Notifs.showToast('Cash receipt entry saved!');
      renderCashReceiptJournal(container, currentUser, currentRole);
    });
  });

  if (isPriv) {
    const redo = () => renderCashReceiptJournal(container, currentUser, currentRole);
    container.querySelectorAll('.crj-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const e = entries.find(x=>x.id===btn.dataset.id); if (!e) return;
      window.financeEditModal({ collection:'cash_receipt_journal', docId:e.id, title:'Cash Receipt', onSaved:()=>{ resyncLedgerForSource('cash_receipt_journal', e.id).then(redo); }, fields:[
        { key:'reference', label:'Reference', type:'text', value:e.reference },
        { key:'date', label:'Date', type:'date', value:e.date },
        { key:'customer', label:'Customer', type:'text', value:e.customer, full:true },
        { key:'debitCash', label:'Debit: Cash (₱)', type:'number', value:e.debitCash },
        { key:'debitSalesDiscount', label:'Debit: Sales Discount (₱)', type:'number', value:e.debitSalesDiscount },
        { key:'creditAR', label:'Credit: A/R (₱)', type:'number', value:e.creditAR },
        { key:'creditSalesRevenue', label:'Credit: Sales Revenue (₱)', type:'number', value:e.creditSalesRevenue },
        { key:'creditSundryAcct', label:'Credit: Sundry Account', type:'text', value:e.creditSundryAcct },
        { key:'creditSundryAmount', label:'Credit: Sundry Amount (₱)', type:'number', value:e.creditSundryAmount }
      ]});
    }));
    container.querySelectorAll('.crj-del-btn').forEach(btn => btn.addEventListener('click', () => {
      window.financeDelete({ collection:'cash_receipt_journal', docId:btn.dataset.id, label:`cash receipt "${btn.dataset.label}"`, onDone:redo });
    }));
  }
}

// ── Cash Disbursement Journal (for cash-based expenses only) ──
async function renderCashDisbursementJournal(container, currentUser, currentRole) {
  const snap = await db.collection('cash_disbursement_journal').orderBy('date','desc').limit(100).get().catch(()=>({docs:[]}));
  const entries = snap.docs.map(d=>({id:d.id,...d.data()}));
  const totalCash = entries.reduce((s,e)=>s+(e.creditCash||0),0);
  const isPriv = isFinancePriv();

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card red"><div class="kpi-label">Total Cash Disbursed</div><div class="kpi-value">₱${fmt(totalCash)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Entries</div><div class="kpi-value">${entries.length}</div></div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button class="btn-primary btn-sm" id="add-cdj-btn">+ New Disbursement Entry</button>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        ${!entries.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">🧾</div><h4>No cash disbursement entries yet</h4></div>':
          `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Reference</th><th>Date</th><th>Payee</th><th>Credit Cash</th><th>Debit COS–Direct Material</th><th>Debit Accounts Payable</th><th>Debit COS–Direct Labor</th><th>Debit Sundry (Acct)</th><th>Debit Sundry (Amount)</th>${isPriv?'<th></th>':''}</tr></thead>
            <tbody>${entries.map(e=>`<tr>
              <td><code>${escHtml(e.reference||'—')}</code></td>
              <td>${e.date||'—'}</td>
              <td>${escHtml(e.payee||'—')}</td>
              <td style="color:var(--danger)">₱${fmt(e.creditCash)}</td>
              <td>${e.debitMaterial?'₱'+fmt(e.debitMaterial):'—'}</td>
              <td>${e.debitAP?'₱'+fmt(e.debitAP):'—'}</td>
              <td>${e.debitLabor?'₱'+fmt(e.debitLabor):'—'}</td>
              <td>${escHtml(e.debitSundryAcct||'—')}</td>
              <td>${e.debitSundryAmount?'₱'+fmt(e.debitSundryAmount):'—'}</td>
              ${isPriv?`<td style="white-space:nowrap">
                <button class="btn-secondary btn-sm cdj-edit-btn" data-id="${e.id}">✎</button>
                <button class="btn-danger btn-sm cdj-del-btn" data-id="${e.id}" data-label="${escHtml((e.payee||'disbursement')+' — ₱'+fmt(e.creditCash))}" style="margin-left:4px">${emojiIcon('trash-2',14)}</button>
              </td>`:''}
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  document.getElementById('add-cdj-btn').addEventListener('click', () => {
    openPage('New Cash Disbursement Entry', `
      <div class="form-row">
        <div class="form-group"><label>Reference</label><input id="cdj-ref" placeholder="Voucher #, Check #…"/></div>
        <div class="form-group"><label>Date</label><input id="cdj-date" type="date" value="${today()}"/></div>
      </div>
      <div class="form-group"><label>Payee</label><input id="cdj-payee" placeholder="Payee name"/></div>
      <div class="form-group"><label>Credit: Cash (₱)</label><input id="cdj-cash" type="number" step="0.01" value="0" inputmode="decimal"/></div>
      <div class="form-row">
        <div class="form-group"><label>Debit: COS – Direct Material (₱)</label><input id="cdj-material" type="number" step="0.01" value="0" inputmode="decimal"/></div>
        <div class="form-group"><label>Debit: Accounts Payable (₱)</label><input id="cdj-ap" type="number" step="0.01" value="0" inputmode="decimal"/></div>
      </div>
      <div class="form-group"><label>Debit: COS – Direct Labor (₱)</label><input id="cdj-labor" type="number" step="0.01" value="0" inputmode="decimal"/></div>
      <div class="form-row">
        <div class="form-group"><label>Debit: Sundry Account</label><input id="cdj-sundry-acct" placeholder="e.g. Utilities Expense"/></div>
        <div class="form-group"><label>Debit: Sundry Amount (₱)</label><input id="cdj-sundry-amt" type="number" step="0.01" value="0" inputmode="decimal"/></div>
      </div>
      <div class="form-group"><label>Input VAT</label>
        <select id="cdj-vat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="inclusive" selected>VATable — 12% input VAT in the cash amount (claimable)</option>
          <option value="exempt">No input VAT (exempt / non-VAT)</option>
        </select>
      </div>
    `, `<button class="btn-primary" id="save-cdj-btn">Save Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('save-cdj-btn').addEventListener('click', async () => {
      const payee = document.getElementById('cdj-payee').value.trim();
      const creditCash = parseFloat(document.getElementById('cdj-cash').value)||0;
      if (!payee) { Notifs.showToast('Enter a payee name.','error'); return; }
      if (!creditCash) { Notifs.showToast('Enter the cash amount disbursed.','error'); return; }
      // Input VAT only applies to VATable purchases (material + sundry). Direct labor
      // carries no input VAT, so it's excluded from the VAT base.
      const _cdjVatBase = (parseFloat(document.getElementById('cdj-material').value)||0)
        + (parseFloat(document.getElementById('cdj-sundry-amt').value)||0);
      const _cdjInputVat = document.getElementById('cdj-vat').value === 'exempt' ? 0 : window.vatSplit(_cdjVatBase,'inclusive').vat;
      const cdjData = {
        reference:         document.getElementById('cdj-ref').value.trim(),
        date:              document.getElementById('cdj-date').value,
        payee,
        creditCash,
        debitMaterial:     parseFloat(document.getElementById('cdj-material').value)||0,
        debitAP:           parseFloat(document.getElementById('cdj-ap').value)||0,
        debitLabor:        parseFloat(document.getElementById('cdj-labor').value)||0,
        debitSundryAcct:   document.getElementById('cdj-sundry-acct').value.trim(),
        debitSundryAmount: parseFloat(document.getElementById('cdj-sundry-amt').value)||0,
        vatAmount: _cdjInputVat, vatTreatment: document.getElementById('cdj-vat').value,
        addedBy:    currentUser.uid,
        addedByName: window.userProfile?.displayName || currentUser.email,
        createdAt:  firebase.firestore.FieldValue.serverTimestamp()
      };
      try {
        await window.assertPeriodOpen(cdjData.date);
      } catch (e) { return; } // toast already shown by assertPeriodOpen
      const cdjDoc = await db.collection('cash_disbursement_journal').add(cdjData);
      await postCDJToLedger(cdjDoc.id, cdjData); // mirror the expense into the ledger
      closeModal(); Notifs.showToast('Cash disbursement entry saved!');
      renderCashDisbursementJournal(container, currentUser, currentRole);
    });
  });

  if (isPriv) {
    const redo = () => renderCashDisbursementJournal(container, currentUser, currentRole);
    container.querySelectorAll('.cdj-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const e = entries.find(x=>x.id===btn.dataset.id); if (!e) return;
      window.financeEditModal({ collection:'cash_disbursement_journal', docId:e.id, title:'Cash Disbursement', onSaved:()=>{ resyncLedgerForSource('cash_disbursement_journal', e.id).then(redo); }, fields:[
        { key:'reference', label:'Reference', type:'text', value:e.reference },
        { key:'date', label:'Date', type:'date', value:e.date },
        { key:'payee', label:'Payee', type:'text', value:e.payee, full:true },
        { key:'creditCash', label:'Credit: Cash (₱)', type:'number', value:e.creditCash },
        { key:'debitMaterial', label:'Debit: COS – Direct Material (₱)', type:'number', value:e.debitMaterial },
        { key:'debitAP', label:'Debit: Accounts Payable (₱)', type:'number', value:e.debitAP },
        { key:'debitLabor', label:'Debit: COS – Direct Labor (₱)', type:'number', value:e.debitLabor },
        { key:'debitSundryAcct', label:'Debit: Sundry Account', type:'text', value:e.debitSundryAcct },
        { key:'debitSundryAmount', label:'Debit: Sundry Amount (₱)', type:'number', value:e.debitSundryAmount }
      ]});
    }));
    container.querySelectorAll('.cdj-del-btn').forEach(btn => btn.addEventListener('click', () => {
      window.financeDelete({ collection:'cash_disbursement_journal', docId:btn.dataset.id, label:`cash disbursement "${btn.dataset.label}"`, onDone:redo });
    }));
  }
}

// ── Records & Receipts Tab ──────────────────────
async function renderRecordsTab(container, currentUser, currentRole) {
  const snap = await db.collection('finance_records').orderBy('createdAt','desc').limit(100).get().catch(()=>({docs:[]}));
  const records = snap.docs.map(d=>({id:d.id,...d.data()}));
  const isPriv = isFinancePriv();
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="display:flex;gap:8px">
        <select id="rec-filter" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px">
          <option value="">All Types</option>
          <option>Receipt</option><option>Invoice</option><option>Voucher</option>
          <option>Contract</option><option>Official Receipt</option><option>Other</option>
        </select>
      </div>
      <button class="btn-primary btn-sm" id="add-rec-btn">+ Encode Record</button>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        ${!records.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">🧾</div><h4>No records yet</h4></div>':
          `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th><th>From/To</th><th>File</th><th>By</th>${isPriv?'<th></th>':''}</tr></thead>
            <tbody id="rec-tbody">${records.map(r=>`<tr>
              <td>${r.date||'—'}</td>
              <td><span class="badge badge-blue">${escHtml(r.type||'—')}</span></td>
              <td>${escHtml(r.description||'—')}</td>
              <td>₱${fmt(r.amount)}</td>
              <td>${escHtml(r.party||'—')}</td>
              <td>${r.fileUrl?`<a href="${safeHttpUrl(r.fileUrl)}" target="_blank" class="btn-secondary btn-sm">📎 View</a>`:'-'}</td>
              <td style="font-size:11px">${escHtml(r.encodedByName||'—')}</td>
              ${isPriv?`<td style="white-space:nowrap">
                <button class="btn-secondary btn-sm rec-edit-btn" data-id="${r.id}">✎</button>
                <button class="btn-danger btn-sm rec-del-btn" data-id="${r.id}" data-label="${escHtml((r.type||'record')+' — '+(r.description||r.id.slice(-5)))}" style="margin-left:4px">${emojiIcon('trash-2',14)}</button>
              </td>`:''}
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  document.getElementById('add-rec-btn').addEventListener('click', () => {
    openPage('Encode Record / Receipt', `
      <div class="form-row">
        <div class="form-group"><label>Date</label><input id="rec-date" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Type</label>
          <select id="rec-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option>Receipt</option><option>Invoice</option><option>Official Receipt</option>
            <option>Voucher</option><option>Contract</option><option>Other</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Description</label><input id="rec-desc" placeholder="What is this for?"/></div>
      <div class="form-row">
        <div class="form-group"><label>Amount (₱)</label><input id="rec-amount" type="number" step="0.01" inputmode="decimal"/></div>
        <div class="form-group"><label>From / To</label><input id="rec-party" placeholder="Supplier, client, or payee"/></div>
      </div>
      <div class="form-group"><label>Notes</label><textarea id="rec-notes" rows="2" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)"></textarea></div>
      <div id="rec-file-area"></div>
    `, `<button class="btn-primary" id="save-rec-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let recFile = null;
    Drive.renderUploadArea('rec-file-area', r=>{recFile=r;},{label:'Attach receipt scan / photo',dept:'Finance',subfolder:'Records'});
    document.getElementById('save-rec-btn').addEventListener('click', async () => {
      await db.collection('finance_records').add({
        date:         document.getElementById('rec-date').value,
        type:         document.getElementById('rec-type').value,
        description:  document.getElementById('rec-desc').value.trim(),
        amount:       parseFloat(document.getElementById('rec-amount').value)||0,
        party:        document.getElementById('rec-party').value.trim(),
        notes:        document.getElementById('rec-notes').value.trim(),
        fileUrl:      recFile?.url||null, fileName: recFile?.name||null,
        encodedBy:    currentUser.uid,
        encodedByName:userProfile?.displayName||currentUser.email,
        createdAt:    firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); Notifs.showToast('Record saved!');
      renderRecordsTab(container, currentUser, currentRole);
    });
  });

  if (isPriv) {
    const redo = () => renderRecordsTab(container, currentUser, currentRole);
    container.querySelectorAll('.rec-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const r = records.find(x=>x.id===btn.dataset.id); if (!r) return;
      window.financeEditModal({ collection:'finance_records', docId:r.id, title:'Record', onSaved:redo, fields:[
        { key:'date', label:'Date', type:'date', value:r.date },
        { key:'type', label:'Type', type:'select', value:r.type, options:['Receipt','Invoice','Official Receipt','Voucher','Contract','Other'] },
        { key:'description', label:'Description', type:'text', value:r.description, full:true },
        { key:'amount', label:'Amount (₱)', type:'number', value:r.amount },
        { key:'party', label:'From / To', type:'text', value:r.party },
        { key:'notes', label:'Notes', type:'textarea', value:r.notes, full:true }
      ]});
    }));
    container.querySelectorAll('.rec-del-btn').forEach(btn => btn.addEventListener('click', () => {
      window.financeDelete({ collection:'finance_records', docId:btn.dataset.id, label:`record "${btn.dataset.label}"`, onDone:redo });
    }));
  }

  // ── Accounting Documents (file archive) ──────────────
  const acctSection = document.createElement('div');
  acctSection.style.marginTop = '24px';
  acctSection.innerHTML = renderFileCollection('Accounting Documents', 'fin-acct', currentRole);
  container.appendChild(acctSection);
  bindFileCollection('fin-acct', currentUser, 'Finance', 'Accounting');
}

// ── CA data repair (v12 WS22 migration) — dry-runnable, idempotent, president-
// gated one-time fix for live inconsistencies the pre-service code produced:
// (1) 'active' status (financeDeleteCascade's old bug — never a real status,
//     invisible to every status==='approved' filter incl. payroll's own),
// (2) interest silently dropped by paths B/C (approved with raw amount instead
//     of totalPayable) — restored ONLY for untouched loans (no payments yet);
//     mid-repayment matches are listed for Neil's own call, not auto-fixed,
// (3) legacy no-terms docs (the old app.js dead form) get an explicit
//     single-payment plan {terms:1, monthlyPayment:balance} — same behavior,
//     now explicit instead of undefined.
window.runCADataRepair = async function(dryRun = true) {
  const snap = await db.collection('cash_advances').get().catch(()=>({docs:[]}));
  const docs = snap.docs.map(d=>({ id:d.id, ref:d.ref, ...d.data() }));
  const report = { normalizedActive:[], interestRestored:[], midRepaymentFlagged:[], legacyTermsBackfilled:[] };
  const batch = db.batch();
  let writeCount = 0;

  for (const d of docs) {
    if (d.status === 'active') {
      report.normalizedActive.push({ id:d.id, userName:d.userName||'?' });
      if (!dryRun) { batch.update(d.ref, { status:'approved' }); writeCount++; }
    }
    const paidSoFar = (d.payments||[]).reduce((s,p)=>s+(p.amount||0),0);
    if (d.interestCharged && d.status==='approved' && d.totalPayable!=null && d.totalPayable!==d.amount) {
      if (!d.payments || !d.payments.length) {
        if (d.balance === d.amount) {
          report.interestRestored.push({ id:d.id, userName:d.userName||'?', from:d.balance, to:d.totalPayable });
          if (!dryRun) { batch.update(d.ref, { balance:d.totalPayable }); writeCount++; }
        }
      } else if (Math.abs((d.balance+paidSoFar)-d.amount) < 1 && Math.abs((d.balance+paidSoFar)-d.totalPayable) > 1) {
        // Mid-repayment with the same signature — retro-charging interest on a
        // partially repaid loan is a policy decision, not a data repair.
        report.midRepaymentFlagged.push({ id:d.id, userName:d.userName||'?', balance:d.balance, paidSoFar, totalPayable:d.totalPayable });
      }
    }
    if (d.status !== 'rejected' && d.status !== 'pending' && d.terms == null) {
      report.legacyTermsBackfilled.push({ id:d.id, userName:d.userName||'?' });
      if (!dryRun) { batch.update(d.ref, { terms:1, monthlyPayment: d.balance!=null ? d.balance : d.amount }); writeCount++; }
    }
  }

  if (!dryRun && writeCount) await batch.commit();
  window.logAudit && window.logAudit(dryRun?'ca-repair-dry-run':'ca-repair-apply','cash_advances','bulk',{ writeCount });
  return report;
};

function openCADataRepairModal(onDone) {
  window.runCADataRepair(true).then(report => {
    const total = report.normalizedActive.length + report.interestRestored.length + report.legacyTermsBackfilled.length;
    const listRows = (arr, cols) => arr.length
      ? arr.map(r => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">${escHtml(r.userName)} — ${cols(r)}</div>`).join('')
      : `<div style="font-size:12px;color:var(--text-muted)">None found.</div>`;
    openModal('🔄 Cash Advance Data Repair — Dry Run', `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Scanned every cash_advances record. Nothing has been written yet.</p>
      <div style="margin-bottom:14px"><strong>Status 'active' → 'approved'</strong> (${report.normalizedActive.length})${listRows(report.normalizedActive, r=>`will be normalized`)}</div>
      <div style="margin-bottom:14px"><strong>Interest restored</strong> (${report.interestRestored.length})${listRows(report.interestRestored, r=>`₱${fmt(r.from)} → ₱${fmt(r.to)}`)}</div>
      <div style="margin-bottom:14px"><strong>⚠️ Mid-repayment — needs your call, NOT auto-fixed</strong> (${report.midRepaymentFlagged.length})${listRows(report.midRepaymentFlagged, r=>`balance ₱${fmt(r.balance)}, paid ₱${fmt(r.paidSoFar)}, totalPayable ₱${fmt(r.totalPayable)}`)}</div>
      <div style="margin-bottom:14px"><strong>Legacy docs — explicit single-payment plan</strong> (${report.legacyTermsBackfilled.length})${listRows(report.legacyTermsBackfilled, r=>`terms:1 added`)}</div>
    `, total
      ? `<button class="btn-primary" id="ca-repair-apply-btn">Apply ${total} Fix${total>1?'es':''}</button><button class="btn-secondary" onclick="closeModal()">Close</button>`
      : `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    document.getElementById('ca-repair-apply-btn')?.addEventListener('click', async () => {
      if (!(await confirmDialog({message:`Apply ${total} cash-advance data fix(es)? This writes to live records.`}))) return;
      await window.runCADataRepair(false);
      closeModal();
      Notifs.showToast('CA data repair applied.');
      if (onDone) onDone();
    });
  });
}

async function renderFinanceCA(container, currentUser, currentRole) {
  const isPrivileged = isFinancePriv();
  container.innerHTML = '<div class="loading-placeholder">Loading cash advances…</div>';

  const snap = await db.collection('cash_advances').get().catch(()=>({docs:[]}));
  const all  = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
    const ta = a.createdAt?.toMillis?.() || 0;
    const tb = b.createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  const pending  = all.filter(a=>a.status==='pending');
  const active   = all.filter(a=>a.status==='approved'&&(a.balance||0)>0);
  const settled  = all.filter(a=>a.status==='approved'&&(a.balance||0)<=0);
  const rejected = all.filter(a=>a.status==='rejected');
  const totalOutstanding = active.reduce((s,a)=>s+(a.balance||0),0);

  container.innerHTML = `
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card red"><div class="kpi-label">Outstanding</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalOutstanding)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Pending</div><div class="kpi-value">${pending.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Active Loans</div><div class="kpi-value">${active.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Settled</div><div class="kpi-value">${settled.length}</div></div>
    </div>
    ${isPrivileged?`<div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn-primary btn-sm" id="fin-ca-add-btn">+ Add CA Record</button>
      ${isRealPresident()?`<button class="btn-secondary btn-sm" id="fin-ca-repair-btn">🔄 Data Repair</button>`:''}
    </div>`:''}
    <div class="subtab-bar" id="fin-ca-tabs" style="margin-bottom:14px">
      <button class="subtab-btn active" data-sub="pending">Pending (${pending.length})</button>
      <button class="subtab-btn" data-sub="active">Active (${active.length})</button>
      <button class="subtab-btn" data-sub="all">All Records</button>
    </div>
    <div id="fin-ca-list"></div>
  `;

  const renderFinCAList = (records) => {
    const list = document.getElementById('fin-ca-list');
    if (!records.length) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">💸</div><p>None.</p></div>'; return; }
    list.innerHTML = records.map(a=>`
      <div class="ca-card" data-id="${a.id}">
        <div class="ca-card-header">
          <div class="ca-card-name">${escHtml(a.userName||'Unknown')} <span style="font-size:11px;color:var(--text-muted)">${escHtml(a.employeeId||'')}</span></div>
          <span class="badge ${statusBadge(a.status)}">${a.status}</span>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--text-muted);margin-bottom:10px">
          <span>Amount: <strong>₱${fmt(a.amount)}</strong></span>
          <span>Balance: <strong style="color:${(a.balance||0)>0?'var(--danger)':'var(--success)'}">₱${fmt(a.balance||0)}</strong></span>
          ${a.monthlyPayment?`<span>Monthly: <strong>₱${fmt(a.monthlyPayment)}</strong></span>`:''}
          <span>Date: ${a.date||'—'}</span>
        </div>
        ${a.reason?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${escHtml(a.reason)}</div>`:''}
        ${a.status==='pending'&&isPrivileged?`
        <div style="display:flex;gap:8px">
          <button class="btn-success btn-sm fin-ca-approve" data-id="${a.id}" data-uid="${a.userId}" data-amount="${a.amount}" data-name="${escHtml(a.userName||'')}">✓ Approve</button>
          <button class="btn-danger btn-sm fin-ca-reject" data-id="${a.id}" data-uid="${a.userId}" data-name="${escHtml(a.userName||'')}">✗ Reject</button>
        </div>`:''}
        ${a.status==='approved'&&(a.balance||0)>0&&isPrivileged?`
        <button class="btn-secondary btn-sm fin-ca-pay" data-id="${a.id}" data-balance="${a.balance||0}" data-monthly="${a.monthlyPayment||0}" data-uid="${a.userId||''}" data-name="${escHtml(a.userName||'')}">💳 Record Payment</button>`:''}
        ${isPrivileged?`<button class="btn-secondary btn-sm fin-ca-edit" data-id="${a.id}" style="margin-left:4px" title="Edit">✎</button>`:''}
        ${isPrivileged?`<button class="btn-secondary btn-sm fin-ca-del" data-id="${a.id}" data-label="${escHtml((a.userName||'CA')+' — ₱'+fmt(a.amount))}" style="color:var(--danger);margin-left:4px" title="${isRealPresident()?'Delete':'Request deletion'}">${emojiIcon('trash-2',14)}</button>`:''}
      </div>`).join('');
    if (window.lucide) lucide.createIcons({ nodes: [list] });

    // v12 WS22 — all three actions route through the one shared CashAdvance
    // service (fixes: this approve used to ignore totalPayable/interest, and
    // this payment path had no transaction guard).
    list.querySelectorAll('.fin-ca-approve').forEach(btn=>btn.addEventListener('click',e=>{
      window.CashAdvance.openApproveModal(e.currentTarget.dataset.id, () => renderFinanceCA(container,currentUser,currentRole));
    }));
    list.querySelectorAll('.fin-ca-reject').forEach(btn=>btn.addEventListener('click',async e=>{
      try { await window.CashAdvance.reject(e.currentTarget.dataset.id); Notifs.showToast(`Rejected for ${e.currentTarget.dataset.name}`); }
      catch (err) { Notifs.showToast(err.message||'Could not reject.','error'); }
      renderFinanceCA(container,currentUser,currentRole);
    }));
    list.querySelectorAll('.fin-ca-pay').forEach(btn=>btn.addEventListener('click',e=>{
      window.CashAdvance.openPaymentModal(e.currentTarget.dataset.id, () => renderFinanceCA(container,currentUser,currentRole));
    }));
    list.querySelectorAll('.fin-ca-edit').forEach(btn=>btn.addEventListener('click',()=>{
      const a = records.find(x=>x.id===btn.dataset.id) || all.find(x=>x.id===btn.dataset.id);
      if(!a) return;
      window.financeEditModal({ collection:'cash_advances', docId:a.id, title:'Cash Advance', onSaved:()=>renderFinanceCA(container,currentUser,currentRole), fields:[
        { key:'amount', label:'Amount (₱)', type:'number', value:a.amount },
        { key:'monthlyPayment', label:'Monthly Payment (₱)', type:'number', value:a.monthlyPayment },
        { key:'date', label:'Date', type:'date', value:a.date },
        { key:'reason', label:'Reason', type:'textarea', value:a.reason, full:true }
      ]});
    }));
    list.querySelectorAll('.fin-ca-del').forEach(btn=>btn.addEventListener('click',()=>{
      window.financeDelete({ collection:'cash_advances', docId:btn.dataset.id, label:`cash advance "${btn.dataset.label}"`, onDone:()=>renderFinanceCA(container,currentUser,currentRole) });
    }));
  };

  let currentSub='pending';
  const showSub=(sub)=>{
    currentSub=sub;
    const map={pending,active,all};
    renderFinCAList(sub==='all'?all:(map[sub]||[]));
  };
  showSub('pending');

  container.querySelectorAll('#fin-ca-tabs .subtab-btn').forEach(btn=>btn.addEventListener('click',()=>{
    container.querySelectorAll('#fin-ca-tabs .subtab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    showSub(btn.dataset.sub);
  }));

  if(isPrivileged){
    document.getElementById('fin-ca-add-btn')?.addEventListener('click',()=>{
      window.renderCashAdvancePage && window.openPresidentCashAdvanceModal ? window.openPresidentCashAdvanceModal() : navigateTo('cash-advance');
    });
    document.getElementById('fin-ca-repair-btn')?.addEventListener('click', () => {
      openCADataRepairModal(() => renderFinanceCA(container, currentUser, currentRole));
    });
  }
}

// ── HR Profiles + Payslip Generator ─────────────────
async function renderFinanceHRProfiles(container, currentUser, currentRole) {
  const isPriv = isFinancePriv();
  container.innerHTML = '<div class="loading-placeholder">Loading worker profiles…</div>';
  // v12 WS23 — same due-raise sweep as the monthly Payroll screen, for the
  // worker_profile subjectType (dailyRate/hourlyRate).
  await window.RaiseFlow.applyDueRaises('worker_profile').catch(()=>{});

  const now = new Date();
  const monthStr = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10)).slice(0,7); // Manila YYYY-MM

  const [profilesSnap, payslipsSnap] = await Promise.all([
    db.collection('worker_profiles').orderBy('name').get().catch(()=>({docs:[]})),
    db.collection('payslips').where('payPeriodMonth','==',monthStr).get().catch(()=>({docs:[]}))
  ]);
  const profiles = profilesSnap.docs.map(d=>({id:d.id,...d.data()}));
  const payslips = payslipsSnap.docs.map(d=>({id:d.id,...d.data()}));
  const totalDisbursed = payslips.reduce((s,p)=>s+(p.netPay||0),0);

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Worker Profiles</div><div class="kpi-value">${profiles.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Payslips This Month</div><div class="kpi-value">${payslips.length}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Disbursed (${now.toLocaleString('en-PH',{month:'short'})})</div><div class="kpi-value" style="font-size:16px">₱${fmt(totalDisbursed)}</div></div>
    </div>
    ${isPriv?`<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn-primary btn-sm" id="hrp-add-btn">+ Add Worker Profile</button>
      <button class="btn-secondary btn-sm" id="hrp-payslip-history-btn">📄 All Payslips</button>
      <button class="btn-secondary btn-sm" id="hrp-raise-history-btn">💸 Raise History</button>
    </div>`:''}
    <div class="card">
      <div class="card-header"><h3>👷 Worker Profiles</h3></div>
      <div class="card-body" style="padding:0">
        ${!profiles.length ? '<div class="empty-state" style="padding:30px"><div class="empty-icon">👷</div><p>No worker profiles yet. Add one to start generating payslips.</p></div>' :
        `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Job Title</th><th>Dept</th><th>Type</th><th>Daily Rate</th><th>CA Balance</th><th>Payroll</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${profiles.map(p=>`<tr>
              <td style="font-weight:600">${escHtml(p.name||'—')}</td>
              <td>${escHtml(p.jobTitle||'—')}</td>
              <td><span class="badge badge-blue">${escHtml(p.department||'—')}</span></td>
              <td><span class="badge badge-purple">${escHtml(p.employmentType||'—')}</span></td>
              <td>₱${fmt(p.dailyRate||0)}</td>
              <td>${p.caBalance>0?`<span style="color:var(--danger)">₱${fmt(p.caBalance)}</span>`:'<span style="color:var(--text-muted)">—</span>'}</td>
              <td><span class="badge ${p.includeInPayroll!==false?'badge-green':'badge-gray'}">${p.includeInPayroll!==false?'Included':'Excluded'}</span></td>
              <td><span class="badge ${p.status==='active'?'badge-green':'badge-gray'}">${p.status||'active'}</span></td>
              <td style="white-space:nowrap">
                <button class="btn-primary btn-sm hrp-gen-btn" data-id="${p.id}" style="margin-right:4px">📄 Payslip</button>
                ${isPriv?`<button class="btn-secondary btn-sm hrp-raise-btn" data-id="${p.id}" title="Give raise" style="margin-right:4px">💸 Raise</button>`:''}
                ${isPriv?`<button class="btn-secondary btn-sm hrp-edit-btn" data-id="${p.id}">✎ Edit</button>`:''}
                ${isPriv?`<button class="btn-danger btn-sm hrp-del-btn" data-id="${p.id}" data-label="${escHtml(p.name||p.id.slice(-5))}" style="margin-left:4px">${emojiIcon('trash-2',14)}</button>`:''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  // Add profile
  if (isPriv) {
    document.getElementById('hrp-add-btn')?.addEventListener('click', () => openHRProfileForm(null, currentUser, currentRole, ()=>renderFinanceHRProfiles(container,currentUser,currentRole)));
    document.getElementById('hrp-payslip-history-btn')?.addEventListener('click', () => openPayslipHistory(currentUser, currentRole));
    document.getElementById('hrp-raise-history-btn')?.addEventListener('click', () => openRaiseHistory());

    container.querySelectorAll('.hrp-raise-btn').forEach(btn => {
      const profile = profiles.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', () => {
        if (!profile) return;
        openSalaryRaiseModal({
          subjectType: 'worker_profile',
          subjectId:   profile.id,
          subjectName: profile.name || 'Worker',
          fieldLabel:  'Daily Rate',
          targetField: 'dailyRate',
          current:     profile.dailyRate || 0
        }, currentUser, () => renderFinanceHRProfiles(container,currentUser,currentRole));
      });
    });

    container.querySelectorAll('.hrp-edit-btn').forEach(btn => {
      const profile = profiles.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', () => openHRProfileForm(profile, currentUser, currentRole, ()=>renderFinanceHRProfiles(container,currentUser,currentRole)));
    });
    container.querySelectorAll('.hrp-del-btn').forEach(btn => btn.addEventListener('click', () => {
      window.financeDelete({ collection:'worker_profiles', docId:btn.dataset.id, label:`worker profile "${btn.dataset.label}"`, onDone:()=>renderFinanceHRProfiles(container,currentUser,currentRole) });
    }));
  }

  // Generate payslip
  container.querySelectorAll('.hrp-gen-btn').forEach(btn => {
    const profile = profiles.find(p=>p.id===btn.dataset.id);
    btn.addEventListener('click', () => openPayslipGenerator(profile, currentUser, currentRole));
  });
}

function openHRProfileForm(profile, currentUser, currentRole, onSave) {
  const isEdit = !!profile;
  const depts = ['Barro Kitchens','Barro Industries','Brilliant Steel','Finance','HR','Operations','General'];
  const empTypes = ['Regular','Part-time','Contractual','Project-based'];
  const workTypes = ['Onsite','Online','Hybrid','Remote'];

  openPage(`${isEdit?'Edit':'Add'} Worker Profile`, `
    <div class="form-row">
      <div class="form-group"><label>Full Name *</label><input id="hrp-name" value="${escHtml(profile?.name||'')}"/></div>
      <div class="form-group"><label>ID Number</label><input id="hrp-id" value="${escHtml(profile?.idNumber||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Job Title</label><input id="hrp-title" value="${escHtml(profile?.jobTitle||'')}"/></div>
      <div class="form-group"><label>Department</label><select id="hrp-dept">
        ${depts.map(d=>`<option value="${d}" ${profile?.department===d?'selected':''}>${d}</option>`).join('')}
        <option value="${escHtml(profile?.department||'')}" ${!depts.includes(profile?.department||'')?'selected':''}>Other</option>
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Employment Type</label><select id="hrp-emptype">
        ${empTypes.map(t=>`<option value="${t}" ${profile?.employmentType===t?'selected':''}>${t}</option>`).join('')}
      </select></div>
      <div class="form-group"><label>Work Setup</label><select id="hrp-worktype">
        ${workTypes.map(t=>`<option value="${t}" ${profile?.workType===t?'selected':''}>${t}</option>`).join('')}
      </select></div>
    </div>
    <div class="form-row">
      ${isEdit ? `
      <div class="form-group"><label>Hourly Rate (₱)</label>
        <div style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface));color:var(--text-muted)">₱${fmt(profile?.hourlyRate||(profile?.dailyRate?profile.dailyRate/8:0))}</div>
      </div>
      <div class="form-group"><label>Daily Rate (₱)</label>
        <div style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface));color:var(--text-muted)">₱${fmt(profile?.dailyRate||0)} · <span style="font-size:11px">change via 💸 Raise (approval-routed)</span></div>
      </div>` : `
      <div class="form-group"><label>Hourly Rate (₱) <span style="font-size:9px;color:var(--text-muted);font-weight:400">used to compute pay</span></label><input id="hrp-hourly" type="number" inputmode="decimal" step="0.01" value="0"/></div>
      <div class="form-group"><label>Daily Rate (₱) <span style="font-size:9px;color:var(--text-muted);font-weight:400">reference</span></label><input id="hrp-daily" type="number" inputmode="decimal" value="0"/></div>`}
    </div>
    <div class="form-row">
      <div class="form-group"><label>Food Allowance (₱) <span style="font-size:9px;color:var(--text-muted);font-weight:400">auto-added per day &gt;4 hrs</span></label><input id="hrp-food" type="number" inputmode="decimal" value="${profile?.foodAllowance||0}"/></div>
      <div class="form-group"><label>Issued On</label><input id="hrp-issued" type="date" value="${profile?.issuedOn||today()}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Transport Allowance</label><input id="hrp-transport" type="number" inputmode="decimal" value="${profile?.allowances?.transport||0}"/></div>
      <div class="form-group"><label>Meal Allowance <span style="font-size:9px;color:var(--text-muted);font-weight:400">fixed extra</span></label><input id="hrp-meal" type="number" inputmode="decimal" value="${profile?.allowances?.meal||0}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>SSS Number</label><input id="hrp-sss" value="${escHtml(profile?.ssNum||'')}"/></div>
      <div class="form-group"><label>PhilHealth</label><input id="hrp-ph" value="${escHtml(profile?.phNum||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Pag-IBIG</label><input id="hrp-pib" value="${escHtml(profile?.pagibigNum||'')}"/></div>
      <div class="form-group"><label>TIN</label><input id="hrp-tin" value="${escHtml(profile?.tinNum||'')}"/></div>
    </div>
    <div class="form-group"><label>Address</label><input id="hrp-addr" value="${escHtml(profile?.address||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Contact</label><input id="hrp-phone" value="${escHtml(profile?.phone||'')}"/></div>
      <div class="form-group"><label>Status</label><select id="hrp-status">
        <option value="active" ${profile?.status!=='inactive'?'selected':''}>Active</option>
        <option value="inactive" ${profile?.status==='inactive'?'selected':''}>Inactive</option>
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Cash Advance Balance (₱)</label><input id="hrp-ca-balance" type="number" value="${profile?.caBalance||0}" inputmode="decimal"/></div>
      <div class="form-group" style="display:flex;align-items:center;padding-top:22px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
          <input type="checkbox" id="hrp-include-payroll" ${profile?.includeInPayroll!==false?'checked':''} style="width:18px;height:18px"/>
          Include in Payroll
        </label>
      </div>
    </div>
    <div class="form-group">
      <label>Linked Login Account (uid) — optional</label>
      <input id="hrp-linked-uid" value="${escHtml(profile?.linkedUid||'')}" placeholder="Only if this worker ALSO has a users/ login account"/>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">v12 WS20: set this if the worker is paid weekly here AND has a regular-staff login — the monthly payroll run hard-skips this uid to prevent double pay.</div>
    </div>
  `, `<button class="btn-primary" id="hrp-save-btn">${isEdit?'Update':'Save'} Profile</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  document.getElementById('hrp-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('hrp-name').value.trim();
    if (!name) { Notifs.showToast('Name is required','error'); return; }
    const data = {
      name,
      idNumber: document.getElementById('hrp-id').value.trim(),
      jobTitle: document.getElementById('hrp-title').value.trim(),
      department: document.getElementById('hrp-dept').value,
      employmentType: document.getElementById('hrp-emptype').value,
      workType: document.getElementById('hrp-worktype').value,
      // v12 WS23 — dailyRate/hourlyRate are read-only in edit mode (change via
      // 💸 Raise instead); the inputs don't exist in the DOM then, so omit them
      // from the write entirely rather than reading a null element.
      ...(isEdit ? {} : {
        dailyRate: parseFloat(document.getElementById('hrp-daily').value)||0,
        hourlyRate: parseFloat(document.getElementById('hrp-hourly').value)||0,
      }),
      foodAllowance: parseFloat(document.getElementById('hrp-food').value)||0,
      issuedOn: document.getElementById('hrp-issued').value,
      allowances: {
        meal: parseFloat(document.getElementById('hrp-meal').value)||0,
        transport: parseFloat(document.getElementById('hrp-transport').value)||0,
      },
      ssNum: document.getElementById('hrp-sss').value.trim(),
      phNum: document.getElementById('hrp-ph').value.trim(),
      pagibigNum: document.getElementById('hrp-pib').value.trim(),
      tinNum: document.getElementById('hrp-tin').value.trim(),
      address: document.getElementById('hrp-addr').value.trim(),
      phone: document.getElementById('hrp-phone').value.trim(),
      status: document.getElementById('hrp-status').value,
      caBalance: parseFloat(document.getElementById('hrp-ca-balance').value)||0,
      includeInPayroll: document.getElementById('hrp-include-payroll').checked,
      linkedUid: document.getElementById('hrp-linked-uid').value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!isEdit) { data.createdAt = firebase.firestore.FieldValue.serverTimestamp(); data.createdBy = currentUser.uid; }
    if (isEdit) { await db.collection('worker_profiles').doc(profile.id).update(data); }
    else         { await db.collection('worker_profiles').add(data); }
    closeModal();
    Notifs.showToast(isEdit ? 'Profile updated!' : 'Worker profile created!');
    onSave();
  });
}

// Payslip workflow: draft → verified → filed → submitted (sequential, no skipping)
const PAYSLIP_STAGES = ['draft','verified','filed','submitted'];
function payslipStageBadge(status) {
  return { draft:'badge-gray', verified:'badge-blue', filed:'badge-orange', submitted:'badge-green' }[status] || 'badge-gray';
}

async function openPayslipHistory(currentUser, currentRole) {
  const canAct = ['president','owner','manager','finance'].includes(currentRole);
  const snap = await db.collection('payslips').orderBy('createdAt','desc').limit(100).get().catch(()=>({docs:[]}));
  const list = snap.docs.map(d=>({id:d.id,...d.data()}));

  const renderRows = () => list.map(p=>{
    const status = p.status || 'draft';
    const stageIdx = PAYSLIP_STAGES.indexOf(status);
    const nextStage = PAYSLIP_STAGES[stageIdx+1];
    const nextLabel = { verified:'✓ Verify', filed:'📁 File', submitted:'📤 Submit' }[nextStage];
    return `<tr>
      <td style="font-weight:600">${escHtml(p.workerName||'—')}</td>
      <td style="font-size:12px">${p.payPeriodStart||''} – ${p.payPeriodEnd||''}</td>
      <td><strong>₱${fmt(p.netPay||0)}</strong></td>
      <td><span class="badge ${payslipStageBadge(status)}">${status}</span></td>
      <td style="white-space:nowrap">
        <button class="btn-secondary btn-sm ps-view-btn" data-id="${p.id}" style="font-size:11px">View</button>
        ${canAct && nextStage ? `<button class="btn-success btn-sm ps-advance-btn" data-id="${p.id}" data-next="${nextStage}" style="font-size:11px;margin-left:4px">${nextLabel}</button>` : ''}
        ${canAct ? `<button class="btn-secondary btn-sm ps-edit-btn" data-id="${p.id}" style="font-size:11px;margin-left:4px" title="Edit amounts">✎</button>` : ''}
        ${canAct && status!=='draft' ? `<button class="btn-secondary btn-sm ps-override-btn" data-id="${p.id}" style="font-size:11px;margin-left:4px" title="Manually set status">${emojiIcon('settings',14)}</button>` : ''}
        ${canAct ? `<button class="btn-danger btn-sm ps-del-btn" data-id="${p.id}" style="font-size:11px;margin-left:4px" title="Delete">${emojiIcon('trash-2',14)}</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  const renderModal = () => {
    const totalNet = list.reduce((s,p)=>s+(p.netPay||0),0);
    const filedCount = list.filter(p=>['filed','submitted'].includes(p.status)).length;
    openModal('📄 Payslip Summary', `
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;font-size:12px;color:var(--text-muted)">
        <span><strong style="color:var(--text)">${list.length}</strong> payslips</span>
        <span><strong style="color:var(--text)">${filedCount}</strong> filed/submitted</span>
        <span>Total net pay: <strong style="color:var(--success)">₱${fmt(totalNet)}</strong></span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Worker</th><th>Period</th><th>Net Pay</th><th>Status</th><th></th></tr></thead>
          <tbody>${!list.length ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No payslips yet</td></tr>' : renderRows()}</tbody>
        </table>
      </div>
    `);
    if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('modal-body')] });
    bindRows();
  };

  const bindRows = () => {
    document.querySelectorAll('.ps-view-btn').forEach(btn => {
      const ps = list.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', async () => {
        if (!ps) return;
        const model = window.toPayslipModel(ps, 'weekly');
        model.ytd = await window.payslipYtdWeekly(ps.workerId, (ps.payPeriodStart||'').slice(0,4) || (window.bizYear?window.bizYear():new Date().getFullYear()));
        window.renderPayslipPage(model, () => renderFinanceHRProfiles(deptContainer(), currentUser, currentRole));
      });
    });
    document.querySelectorAll('.ps-advance-btn').forEach(btn => onClickSafe(btn, async () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        const next = btn.dataset.next;
        if (!ps || !next) return;
        if (!(await confirmDialog({message:`Mark ${escHtml(ps.workerName)}'s payslip (${ps.payPeriodStart} – ${ps.payPeriodEnd}) as "${next}"?`, html:true}))) return;
        const fieldPrefix = { verified:'verified', filed:'filed', submitted:'submitted' }[next];
        const payDate = ps.payDate || ps.payPeriodEnd || today();
        // Check the period BEFORE flipping status — Submit is the ledger-posting
        // transition, so a closed month must not leave the payslip stuck
        // 'submitted' with no matching ledger row (v12 WS12).
        if (next === 'submitted') await window.assertPeriodOpen(payDate);
        await db.collection('payslips').doc(ps.id).update({
          status: next,
          [`${fieldPrefix}By`]: currentUser.uid,
          [`${fieldPrefix}At`]: firebase.firestore.FieldValue.serverTimestamp()
        });
        // On Submit, post the payslip to the general ledger (Finance → Ledger)
        if (next === 'submitted') {
          const lref = `WPAY-${ps.id}`;
          const exist = await db.collection('ledger').where('refNumber','==',lref).limit(1).get().catch(()=>({docs:[]}));
          const entry = {
            date:        payDate,
            type:        'debit',
            accountType: 'expense', account: 'Payroll Expense',
            description: `Worker Payslip — ${ps.workerName||'?'} (${ps.payPeriodStart||''}–${ps.payPeriodEnd||''})`,
            amount:      ps.netPay || 0,
            category:    'Payroll Expense',
            source:      'Finance',
            refNumber:   lref,
            addedBy:     currentUser.uid,
            addedByName: window.userProfile?.displayName || currentUser.email,
            createdAt:   firebase.firestore.FieldValue.serverTimestamp()
          };
          if (exist.docs.length) await exist.docs[0].ref.update({ amount: entry.amount, description: entry.description });
          else await db.collection('ledger').add(entry);
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
          Notifs.showToast('Submitted & posted to General Ledger.');
        } else {
          Notifs.showToast(`Payslip marked as ${next}.`);
        }
        ps.status = next;
        renderModal();
    }));
    document.querySelectorAll('.ps-edit-btn').forEach(btn => onClickSafe(btn, () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        if (ps) openPayslipEdit(ps, currentUser, () => renderModal());
    }));
    document.querySelectorAll('.ps-del-btn').forEach(btn => onClickSafe(btn, async () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        if (!ps) return;
        // President deletes immediately; finance staff file a request. The CA
        // reversal + linked ledger cleanup run centrally in financeDeleteCascade.
        const outcome = await window.financeDelete({
          collection:'payslips', docId:ps.id,
          label:`payslip — ${ps.workerName||'?'} (${ps.payPeriodStart||''} – ${ps.payPeriodEnd||''})`
        });
        if (outcome === 'deleted') {
          const idx = list.findIndex(p=>p.id===ps.id);
          if (idx>=0) list.splice(idx,1);
          renderModal();
        }
    }));
    document.querySelectorAll('.ps-override-btn').forEach(btn => onClickSafe(btn, async () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        if (!ps) return;
        const choice = await promptDialog({title:'Manual override', message:`Set status for ${escHtml(ps.workerName)}'s payslip.\nOptions: ${PAYSLIP_STAGES.join(', ')}`, value:ps.status||'draft', html:true});
        if (!choice || !PAYSLIP_STAGES.includes(choice)) { if (choice) Notifs.showToast('Invalid status','error'); return; }
        await db.collection('payslips').doc(ps.id).update({
          status: choice, overriddenBy: currentUser.uid, overriddenAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        ps.status = choice;
        Notifs.showToast(`Status manually set to "${choice}".`);
        renderModal();
    }));
  };

  renderModal();
}

// Compact edit of a filed payslip's amounts (recomputes net; keeps ledger in sync).
function openPayslipEdit(ps, currentUser, onSave) {
  const r = ps.regular||{}, ot = ps.overtime||{}, al = ps.allowances||{}, g = ps.deductions?.govt||{}, o = ps.deductions?.other||{};
  openPage(`✎ Edit Payslip — ${escHtml(ps.workerName||'')}`, `
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${ps.payPeriodStart||''} – ${ps.payPeriodEnd||''}</div>
    <div class="form-row">
      <div class="form-group"><label>Rate / HR (₱)</label><input id="pe-rph" type="number" step="0.01" value="${r.ratePerHr||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>Hours Worked</label><input id="pe-hrs" type="number" step="0.01" value="${r.hrsWorked||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Overtime Pay (₱)</label><input id="pe-ot" type="number" value="${ot.total||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>Allowances total (₱)</label><input id="pe-allow" type="number" value="${al.total||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>SSS</label><input id="pe-sss" type="number" value="${g.sss||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>PhilHealth</label><input id="pe-ph" type="number" value="${g.philhealth||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Pag-IBIG</label><input id="pe-pib" type="number" value="${g.pagibig||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>Cash Advance</label><input id="pe-ca" type="number" value="${o.cashAdvance||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Other / Loans</label><input id="pe-loans" type="number" value="${o.loans||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>Taxes</label><input id="pe-tax" type="number" value="${o.taxes||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-group"><label>Amount Already Paid (₱)</label><input id="pe-paid" type="number" value="${ps.paid||0}" inputmode="decimal"/></div>
    <div id="pe-net" style="text-align:right;font-weight:800;font-size:14px;margin-top:6px">Net: ₱${fmt(ps.netPay||0)}</div>
  `, `<button class="btn-primary" id="pe-save-btn">Save Changes</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const num = id => parseFloat(document.getElementById(id).value)||0;
  const recompute = () => {
    const gross = num('pe-rph')*num('pe-hrs') + num('pe-ot') + num('pe-allow');
    const ded = num('pe-sss')+num('pe-ph')+num('pe-pib')+num('pe-ca')+num('pe-loans')+num('pe-tax');
    document.getElementById('pe-net').textContent = 'Net: ₱'+fmt(gross - ded - num('pe-paid'));
  };
  ['pe-rph','pe-hrs','pe-ot','pe-allow','pe-sss','pe-ph','pe-pib','pe-ca','pe-loans','pe-tax','pe-paid']
    .forEach(id => document.getElementById(id).addEventListener('input', recompute));

  document.getElementById('pe-save-btn').addEventListener('click', async () => {
    const rph=num('pe-rph'), hrs=num('pe-hrs'), otT=num('pe-ot'), alT=num('pe-allow');
    const sss=num('pe-sss'), ph=num('pe-ph'), pib=num('pe-pib'), ca=num('pe-ca'), loans=num('pe-loans'), tax=num('pe-tax'), paid=num('pe-paid');
    const reg = parseFloat((rph*hrs).toFixed(2));
    const govTotal=sss+ph+pib, otherTotal=ca+loans+tax;
    const grossPay = reg+otT+alT, totalDeductions = govTotal+otherTotal;
    const totalPay = grossPay-totalDeductions, netPay = totalPay-paid;
    await db.collection('payslips').doc(ps.id).update({
      'regular.ratePerHr':rph, 'regular.hrsWorked':hrs, 'regular.dailyRate':parseFloat((rph*8).toFixed(2)), 'regular.total':reg,
      'overtime.total':otT, 'allowances.total':alT, 'allowances.meal':alT,
      'deductions.govt.sss':sss, 'deductions.govt.philhealth':ph, 'deductions.govt.pagibig':pib, 'deductions.govt.total':govTotal,
      'deductions.other.cashAdvance':ca, 'deductions.other.loans':loans, 'deductions.other.taxes':tax, 'deductions.other.total':otherTotal,
      grossPay, totalDeductions, totalPay, paid, netPay,
      editedBy: currentUser.uid, editedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Keep the general-ledger entry in sync if it was already posted
    const lsnap = await db.collection('ledger').where('refNumber','==',`WPAY-${ps.id}`).limit(1).get().catch(()=>({docs:[]}));
    if (lsnap.docs.length) await lsnap.docs[0].ref.update({ amount: netPay });
    // Reconcile the worker's running CA balance for any change in the cash-advance
    // deduction. Creation deducted the original CA from caBalance, and delete reverses
    // whatever is current (financeDeleteCascade), so an edit that doesn't adjust by the
    // delta leaves the running balance permanently wrong.
    const _oldCa = ps.deductions?.other?.cashAdvance || 0;
    if (ca !== _oldCa && ps.workerId) {
      // v12 WS22 — routed through the shared, transaction-guarded service. A
      // negative delta here correctly INCREASES caBalance (deductWorker's
      // clamp only floors at 0, it never blocks restoring balance an edit gave back).
      await window.CashAdvance.deductWorker(ps.workerId, ca - _oldCa, { reason:'payslip-edit-reconcile', payslipId: ps.id }).catch(()=>{});
    }
    // Mutate the in-memory copy so the summary reflects changes immediately
    ps.regular   = {...(ps.regular||{}), ratePerHr:rph, hrsWorked:hrs, dailyRate:parseFloat((rph*8).toFixed(2)), total:reg};
    ps.overtime  = {...(ps.overtime||{}), total:otT};
    ps.allowances= {...(ps.allowances||{}), total:alT, meal:alT};
    ps.deductions= { govt:{sss,philhealth:ph,pagibig:pib,total:govTotal}, other:{cashAdvance:ca,loans,taxes:tax,total:otherTotal} };
    ps.grossPay=grossPay; ps.totalDeductions=totalDeductions; ps.totalPay=totalPay; ps.paid=paid; ps.netPay=netPay;
    closeModal();
    Notifs.showToast('Payslip updated.');
    onSave && onSave();
  });
}

function openPayslipGenerator(profile, currentUser, currentRole) {
  // Weekly cycle: Mon–Sat, paid each Saturday — anchored to Manila business calendar.
  // (Raw new Date().getDay()/toISOString() lands on the wrong day for the first 8h of
  //  each Manila day and corrupted pay periods.)
  const todayISO = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
  const dow = window.bizDow ? window.bizDow() : new Date().getDay();   // 0 Sun .. 6 Sat (Manila)
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return window.bizDate ? window.bizDate(d) : d.toISOString().slice(0,10); };
  const periodEnd   = addDays(todayISO, (6 - dow + 7) % 7);  // upcoming/this Saturday
  const periodStart = addDays(periodEnd, -5);                // Monday of that pay week

  openPage(`📄 Generate Payslip — ${profile.name}`, `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="form-group"><label>Pay Period Start</label><input id="ps-start" type="date" value="${periodStart}"/></div>
      <div class="form-group"><label>Pay Period End (Sat)</label><input id="ps-end" type="date" value="${periodEnd}"/></div>
      <div class="form-group"><label>Pay Date</label><input id="ps-date" type="date" value="${periodEnd}"/></div>
      <div class="form-group"><label>Business / Company Name</label><input id="ps-company" value="Barro Kitchens"/></div>
    </div>

    <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Daily Time Log</div>
        <span style="font-size:10px;color:var(--text-muted)">Auto-computes hours · −1hr lunch if shift spans 12–1PM</span>
      </div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <thead><tr>
          <th style="text-align:left;padding:4px">Day</th><th style="padding:4px">Time In</th><th style="padding:4px">Time Out</th><th style="padding:4px">Hours</th>
        </tr></thead>
        <tbody>
          ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>`<tr>
            <td style="padding:4px">${d}</td>
            <td style="padding:4px"><input id="ps-tin-${i}" type="time" class="ps-time-input" value="${d==='Sun'?'':'07:00'}" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text)"/></td>
            <td style="padding:4px"><input id="ps-tout-${i}" type="time" class="ps-time-input" value="${d==='Sun'?'':(d==='Sat'?'18:00':'16:00')}" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text)"/></td>
            <td style="padding:4px;text-align:center;font-weight:600" id="ps-dayhrs-${i}">0.00</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;font-size:12px">
        Computed Total: <strong style="margin-left:6px" id="ps-computed-total">0.00</strong>&nbsp;hrs
      </div>
    </div>

    <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Earnings</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:6px"><label>Rate/HR <span style="font-size:9px;color:var(--text-muted);font-weight:400">× hours = pay</span></label><input id="ps-rph" type="number" step="0.01" value="${(profile.hourlyRate||(profile.dailyRate/8)||0).toFixed ? (profile.hourlyRate||(profile.dailyRate/8)||0).toFixed(2) : profile.hourlyRate||0}" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>Daily Rate <span style="font-size:9px;color:var(--text-muted);font-weight:400">ref</span></label><input id="ps-daily" type="number" value="${profile.dailyRate||0}" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:6px">
          <label>Hours Worked <span style="font-size:9px;color:var(--text-muted);font-weight:400">(auto, editable)</span></label>
          <input id="ps-hrs" type="number" value="0" inputmode="decimal"/>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:6px"><label>OT Rate/HR <span style="font-size:9px;color:var(--text-muted);font-weight:400">(regular rate)</span></label><input id="ps-ot-rate" type="number" value="${(profile.dailyRate/8).toFixed(2)}" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>OT Hours</label><input id="ps-ot-hrs" type="number" value="0" inputmode="decimal"/></div>
        <div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:0"><label>Food Allow <span style="font-size:9px;color:var(--text-muted);font-weight:400">auto, &gt;4h/day</span></label><input id="ps-meal" type="number" value="${profile.allowances?.meal||0}" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:0"><label>Transport Allow</label><input id="ps-transport" type="number" value="${profile.allowances?.transport||0}" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:0"><label>Rent Allow</label><input id="ps-rent" type="number" value="0" inputmode="decimal"/></div>
      </div>
    </div>

    <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Deductions</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:6px"><label>SSS</label><input id="ps-sss" type="number" value="0" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>PhilHealth</label><input id="ps-ph" type="number" value="0" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>Pag-IBIG</label><input id="ps-pib" type="number" value="0" inputmode="decimal"/></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:0">
          <label>Cash Advance Deduction</label>
          <input id="ps-ca" type="number" value="0" inputmode="decimal"/>
          <div style="font-size:10px;color:var(--text-muted);margin-top:3px">Balance: ₱<span id="ps-ca-balance-display">${fmt(profile.caBalance||0)}</span> · Remaining after deduction: ₱<span id="ps-ca-remaining-display" style="font-weight:700">${fmt(profile.caBalance||0)}</span></div>
        </div>
        <div class="form-group" style="margin-bottom:0"><label>Other Deduction (Loans, etc.)</label><input id="ps-loans" type="number" value="0" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:0"><label>Taxes</label><input id="ps-tax" type="number" value="0" inputmode="decimal"/></div>
      </div>
    </div>

    <div class="form-group">
      <label>Amount Already Paid (₱)</label><input id="ps-paid" type="number" value="0" inputmode="decimal"/>
    </div>
    <div class="form-group">
      <label>Prepared By</label><input id="ps-preparer" value="${escHtml(currentUser?.displayName||'')}"/>
    </div>
    <div class="form-group">
      <label>Attach Transfer Proof (optional)</label>
      <div id="ps-proof-area"></div>
    </div>
  `, `
    <button class="btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn-secondary" id="ps-preview-btn">👁 Preview</button>
    <button class="btn-primary" id="ps-save-btn">💾 Save &amp; Generate</button>
  `);

  // Bind proof upload area
  let proofFile = null;
  if (window.Drive?.renderUploadArea) {
    Drive.renderUploadArea('ps-proof-area', r => { proofFile = r; }, { label:'Upload transfer screenshot/photo', dept:'Finance', subfolder:'payslips' });
  }

  // ── Auto-compute hours from daily time log (−1hr lunch if shift spans 12–1PM) ──
  let foodEdited = false;
  document.getElementById('ps-meal')?.addEventListener('input', () => { foodEdited = true; });
  const recomputeHours = () => {
    let total = 0, daysOver4 = 0;
    for (let i = 0; i < 7; i++) {
      const hrs = computeDayHours(
        document.getElementById(`ps-tin-${i}`)?.value,
        document.getElementById(`ps-tout-${i}`)?.value
      );
      const cell = document.getElementById(`ps-dayhrs-${i}`);
      if (cell) cell.textContent = hrs.toFixed(2);
      total += hrs;
      if (hrs > 4) daysOver4++;
    }
    const totalEl = document.getElementById('ps-computed-total');
    if (totalEl) totalEl.textContent = total.toFixed(2);
    const hrsInput = document.getElementById('ps-hrs');
    if (hrsInput) hrsInput.value = total.toFixed(2);
    // Food allowance: profile rate × number of days exceeding 4 hrs (unless manually overridden)
    const foodInput = document.getElementById('ps-meal');
    if (foodInput && !foodEdited) foodInput.value = ((profile.foodAllowance||0) * daysOver4).toFixed(2);
  };
  document.querySelectorAll('.ps-time-input').forEach(inp => inp.addEventListener('input', recomputeHours));
  recomputeHours();

  // ── Live CA remaining-balance preview ──
  const updateCaRemaining = () => {
    const balance = profile.caBalance || 0;
    const deduct  = parseFloat(document.getElementById('ps-ca')?.value) || 0;
    const remain  = Math.max(0, balance - deduct);
    const el = document.getElementById('ps-ca-remaining-display');
    if (el) el.textContent = fmt(remain);
  };
  document.getElementById('ps-ca')?.addEventListener('input', updateCaRemaining);

  document.getElementById('ps-preview-btn').addEventListener('click', async () => {
    const d = collectPayslipData(profile, currentUser);
    if (!d) return;
    const model = window.toPayslipModel(d, 'weekly');
    model.official = false; // never yet saved — a draft/projection by construction
    model.ytd = await window.payslipYtdWeekly(profile.id, (d.payPeriodStart||'').slice(0,4) || (window.bizYear?window.bizYear():new Date().getFullYear()));
    window.renderPayslipPage(model, () => renderFinanceHRProfiles(deptContainer(), currentUser, currentRole));
  });

  document.getElementById('ps-save-btn').addEventListener('click', async () => {
    const d = collectPayslipData(profile, currentUser);
    if (!d) return;
    d.proofUrl = proofFile?.url || null;
    d.status = 'draft';
    d.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    d.createdBy = currentUser.uid;
    const ref = await db.collection('payslips').add(d);
    // Apply CA deduction to the worker's running balance — transaction-guarded
    // re-read (v12 WS22), instead of trusting the balance the modal opened with.
    if (d.deductions.other.cashAdvance > 0) {
      await window.CashAdvance.deductWorker(profile.id, d.deductions.other.cashAdvance, { reason:'weekly-payslip', payslipId: ref.id }).catch(()=>{});
    }
    // Note: the general-ledger entry is posted when the payslip is "Submitted" (see openPayslipHistory).
    closeModal();
    Notifs.showToast('Payslip saved as draft! Verify and file it from Payslip History.');
    const model = window.toPayslipModel({...d, id: ref.id}, 'weekly');
    model.ytd = await window.payslipYtdWeekly(profile.id, (d.payPeriodStart||'').slice(0,4) || (window.bizYear?window.bizYear():new Date().getFullYear()));
    setTimeout(() => window.renderPayslipPage(model, () => renderFinanceHRProfiles(deptContainer(), currentUser, currentRole)), 400);
  });
}

// Hours between two "HH:MM" time strings, minus a flat 1hr lunch deduction
// if the shift overlaps the 12:00–13:00 lunch window. Handles overnight shifts.
function computeDayHours(timeIn, timeOut) {
  if (!timeIn || !timeOut) return 0;
  const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  let inM = toMin(timeIn), outM = toMin(timeOut);
  if (outM <= inM) outM += 24*60; // overnight shift
  let mins = outM - inM;
  const lunchStart = 12*60, lunchEnd = 13*60;
  if (inM < lunchEnd && outM > lunchStart) mins -= 60; // shift spans 12–1PM lunch
  return Math.max(0, mins/60);
}

function collectPayslipData(profile, currentUser) {
  const daily    = parseFloat(document.getElementById('ps-daily').value)||0;
  const rph      = parseFloat(document.getElementById('ps-rph').value)||0;
  const hrs      = parseFloat(document.getElementById('ps-hrs').value)||0;
  const regTotal = parseFloat((rph * hrs).toFixed(2));  // hourly rate × hours worked
  const otRate   = parseFloat(document.getElementById('ps-ot-rate').value)||0;
  const otHrs    = parseFloat(document.getElementById('ps-ot-hrs').value)||0;
  const otTotal  = parseFloat((otRate * otHrs).toFixed(2));
  const meal     = parseFloat(document.getElementById('ps-meal').value)||0;
  const transport= parseFloat(document.getElementById('ps-transport').value)||0;
  const rent     = parseFloat(document.getElementById('ps-rent').value)||0;
  const allowTotal = meal + transport + rent;
  const grossPay = regTotal + otTotal + allowTotal;

  const sss   = parseFloat(document.getElementById('ps-sss').value)||0;
  const ph    = parseFloat(document.getElementById('ps-ph').value)||0;
  const pib   = parseFloat(document.getElementById('ps-pib').value)||0;
  const ca    = parseFloat(document.getElementById('ps-ca').value)||0;
  const loans = parseFloat(document.getElementById('ps-loans').value)||0;
  const tax   = parseFloat(document.getElementById('ps-tax').value)||0;
  const govTotal   = sss + ph + pib;
  const otherTotal = ca + loans + tax;
  const totalDeductions = govTotal + otherTotal;
  const totalPay = grossPay - totalDeductions;
  const paid     = parseFloat(document.getElementById('ps-paid').value)||0;
  const netPay   = totalPay - paid;

  const periodStart = document.getElementById('ps-start').value;
  const periodEnd   = document.getElementById('ps-end').value;
  if (!periodStart || !periodEnd) { Notifs.showToast('Set pay period dates','error'); return null; }

  const caBalanceBefore = profile.caBalance || 0;
  const caBalanceAfter  = Math.max(0, caBalanceBefore - ca);

  const timeLog = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>({
    day: d,
    timeIn:  document.getElementById(`ps-tin-${i}`)?.value || '',
    timeOut: document.getElementById(`ps-tout-${i}`)?.value || '',
    hours: computeDayHours(document.getElementById(`ps-tin-${i}`)?.value, document.getElementById(`ps-tout-${i}`)?.value)
  }));

  return {
    workerId: profile.id,
    workerName: profile.name,
    workerIdNum: profile.idNumber||'',
    jobTitle: profile.jobTitle||'',
    department: profile.department||'',
    tinNum: profile.tinNum||'',
    ssNum: profile.ssNum||'',
    phNum: profile.phNum||'',
    pagibigNum: profile.pagibigNum||'',
    payPeriodStart: periodStart,
    payPeriodEnd: periodEnd,
    payPeriodMonth: periodStart.slice(0,7),
    payDate: document.getElementById('ps-date').value,
    company: document.getElementById('ps-company').value||'Barro Kitchens',
    preparedBy: document.getElementById('ps-preparer').value||currentUser?.displayName||'',
    regular: { dailyRate: daily, ratePerHr: rph, hrsWorked: hrs, total: regTotal },
    overtime: { ratePerHr: otRate, hours: otHrs, total: otTotal },
    allowances: { meal, transport, rent, total: allowTotal },
    grossPay,
    deductions: {
      govt: { sss, philhealth: ph, pagibig: pib, total: govTotal },
      other: { cashAdvance: ca, loans, taxes: tax, total: otherTotal }
    },
    employerShare: null, // v12 WS24 decision 3 — weekly ER manual-only for now; WS21/WS39 may populate later
    caBalanceBefore,
    caBalanceAfter,
    totalDeductions,
    totalPay,
    paid,
    netPay,
    schedule: timeLog
  };
}

// ═══════════════════════════════════════════════════════════
//  THE PAYSLIP — ONE branded template (v12 WS24)
//  toPayslipModel normalizes either cycle's raw source into ONE PayslipModel;
//  buildPayslipHTML renders that model; renderPayslipPage hosts it in-app
//  (no pop-ups — same-document window.print(), per the owner's directive).
// ═══════════════════════════════════════════════════════════
window.toPayslipModel = function(source, kind) {
  const g = (o,a,b)=> (o?.[a] ?? o?.[b] ?? 0);            // casing-tolerant getter (WS21 D6 canonical lowercase)
  if (kind === 'monthly') {
    // source = a frozen pay_runs line OR a salary_history mirror doc (same field set)
    const base = source.base ?? source.salary ?? 0;
    const allowance = source.allowance ?? 0;
    const ee = { sss:g(source,'sss'), philhealth:g(source,'philhealth','philHealth'),
                 pagibig:g(source,'pagibig','pagIbig'), tax:source.tax??0 };
    const er = source.er ? { sss:source.er.sss||0, philhealth:source.er.philhealth||0, pagibig:source.er.pagibig||0 } : null;
    const gross = base + allowance;
    const eeTotal = ee.sss+ee.philhealth+ee.pagibig+ee.tax;
    const other = source.otherDeductions ?? source.deductions ?? 0;
    const caBefore = source.caBalance ?? source.caBalanceBefore ?? 0;
    const caInst = source.caPlanned ?? source.caDeducted ?? 0;
    return {
      kind:'monthly', official:true,
      docNumber:`PS-${source.month || source.runMonth}-${source.uid || source.userId}`,
      periodLabel:new Date((source.month||source.runMonth)+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'}),
      payDateLabel: source.payDateLabel || '',
      employee:{ name:source.name||source.userName||'', idNumber:source.employeeId||'',
                 jobTitle:source.title||'', department:source.department||'',
                 tin:'', sss:'', philhealth:'', pagibig:'' },
      earnings:{ base, allowance, overtime:0, gross },
      statutory:{ ee, er },
      otherDeductions:other,
      ca:{ before:caBefore, installment:caInst, after:Math.max(0, caBefore-caInst) },
      net: source.finalPay ?? (gross - eeTotal - other - caInst),
      ytd:{ gross:0, net:0, thirteenthAccrual:0 },   // filled by caller (needs the year query)
      performance: (source.kpiScore!=null||source.perfFactor!=null)
        ? { kpi:source.kpiScore||0, att:source.attScore||0, perfFactor:source.perfFactor??1, policy:source.policy||'flat' } : null,
      timeLog:null,
      signatures:[{label:'Prepared by',name:'',title:'Finance'},{label:'Verified by',name:'',title:'HR'},{label:'Approved by',name:(window.BRAND&&window.BRAND.legal.signatory.name)||'',title:'President'}],
      proofUrl:''
    };
  }
  // kind === 'weekly'  (source = a payslips/{id} doc)
  const dg = source.deductions?.govt || {};
  const ee = { sss:dg.sss||0, philhealth:g(dg,'philhealth')||0, pagibig:g(dg,'pagibig')||0, tax:source.deductions?.other?.taxes||0 };
  const er = source.employerShare ? { sss:source.employerShare.sss||0, philhealth:source.employerShare.philhealth||0, pagibig:source.employerShare.pagibig||0 } : null;
  return {
    kind:'weekly', official:true, docNumber:source.id||'',
    periodLabel:`${source.payPeriodStart||''} – ${source.payPeriodEnd||''}`,
    payDateLabel:source.payDate||'',
    employee:{ name:source.workerName||'', idNumber:source.workerIdNum||'', jobTitle:source.jobTitle||'',
               department:source.department||'', tin:source.tinNum||'', sss:source.ssNum||'',
               philhealth:source.phNum||'', pagibig:source.pagibigNum||'' },
    earnings:{ base:source.regular?.total||0, allowance:source.allowances?.total||0, overtime:source.overtime?.total||0,
               gross:source.grossPay||0 },
    statutory:{ ee, er },
    otherDeductions:(source.deductions?.other?.loans||0),
    ca:{ before:source.caBalanceBefore||0, installment:source.deductions?.other?.cashAdvance||0, after:source.caBalanceAfter||0 },
    net:source.netPay||0,
    ytd:{ gross:0, net:0, thirteenthAccrual:0 },   // filled by caller (weekly year query)
    performance:null,
    timeLog:source.schedule||[],
    signatures:[{label:'Prepared by',name:source.preparedBy||'',title:'Finance'},{label:'Verified by',name:'',title:'HR'},{label:'Approved by',name:(window.BRAND&&window.BRAND.legal.signatory.name)||'',title:'President'}],
    proofUrl:source.proofUrl||''
  };
};

// YTD helpers — display-computed each render, never stored on the payslip.
window.payslipYtdMonthly = async function(uid, year) {
  const snap = await db.collection('salary_history').where('userId','==',uid)
    .where('month','>=',`${year}-01`).where('month','<=',`${year}-12`).get().catch(()=>({docs:[]}));
  let gross=0, net=0, baseSum=0;
  snap.docs.forEach(d=>{ const r=d.data(); const b=r.base??r.salary??0;
    baseSum+=b; gross+=b+(r.allowance||0); net+=(r.finalPay??r.netPay??0); });
  return { gross, net, thirteenthAccrual: Math.round((baseSum/12)*100)/100 };   // WS21 D7
};
window.payslipYtdWeekly = async function(workerId, year) {
  const snap = await db.collection('payslips').where('workerId','==',workerId)
    .where('payPeriodStart','>=',`${year}-01-01`).where('payPeriodStart','<=',`${year}-12-31`).get().catch(()=>({docs:[]}));
  let gross=0, net=0, baseSum=0;
  snap.docs.forEach(d=>{ const r=d.data(); baseSum+=r.regular?.total||0; gross+=r.grossPay||0; net+=r.netPay||0; });
  return { gross, net, thirteenthAccrual: Math.round((baseSum/12)*100)/100 };
};

// The ONE branded template — renders a PayslipModel to inner HTML (no <html>
// wrapper; hosted by renderPayslipPage inside #page-content).
window.buildPayslipHTML = function(model) {
  const f = n => (parseFloat(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const m = model, s = m.statutory, er = s.er;
  const erCell = k => er ? f(er[k]) : '—';
  const badge = m.official ? '' : `<div class="ps-badge-proj">PROJECTION — not yet disbursed</div>`;
  // Payslips are BIR/DOLE-facing — DTI trade name + real TIN (matches what this
  // template has always printed, and WS14's own resolution for this doc type).
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'PAYSLIP', entity: window.brandEntity ? window.brandEntity('bir') : null,
    accent: '#1a237e', docNumber: m.docNumber, dateLabel: m.periodLabel,
    signatures: m.signatures,
    footerNote: 'System-generated payslip · ' + escHtml(m.docNumber) + ' · ' + escHtml(m.periodLabel)
  }) : null;
  const perf = m.performance ? `
    <div class="ps-sec-h">Performance</div>
    <table class="ps-t">
      <tr><td>Task KPI (70%)</td><td class="num">${Math.round(m.performance.kpi*100)}%</td></tr>
      <tr><td>Attendance (30%)</td><td class="num">${Math.round(m.performance.att*100)}%</td></tr>
      <tr class="ps-sub"><td>Performance factor (policy: ${escHtml(m.performance.policy)})</td><td class="num">${m.performance.perfFactor.toFixed(2)}×</td></tr>
    </table>` : '';
  const timelog = (m.timeLog && m.timeLog.length) ? `
    <div class="ps-sec-h">Daily Time Log</div>
    <table class="ps-t"><thead><tr><th>Day</th><th>Time In</th><th>Time Out</th><th class="num">Hours</th></tr></thead>
    <tbody>${m.timeLog.map(r=>`<tr><td>${escHtml(r.day)}</td><td>${escHtml(r.timeIn||'—')}</td><td>${escHtml(r.timeOut||'—')}</td><td class="num">${(r.hours||0).toFixed(2)}</td></tr>`).join('')}</tbody></table>` : '';
  return `
  ${_lh ? `<style>${_lh.printCSS}</style>` : ''}
  ${_lh ? _lh.headerHTML : `<div class="lh-head"><div class="lh-name">${escHtml((window.BRAND&&window.BRAND.legal.dtiName)||'')}</div><div class="lh-doc"><div class="lh-title">PAYSLIP</div><div class="lh-no">${escHtml(m.docNumber)}</div><div class="lh-date">${escHtml(m.periodLabel)}</div></div></div>`}
  ${badge}
  <div class="ps-sec-h">Employee</div>
  <table class="ps-t">
    <tr><td class="lbl">Name</td><td>${escHtml(m.employee.name)}</td><td class="lbl">TIN</td><td>${escHtml(m.employee.tin)}</td></tr>
    <tr><td class="lbl">ID</td><td>${escHtml(m.employee.idNumber)}</td><td class="lbl">SSS</td><td>${escHtml(m.employee.sss)}</td></tr>
    <tr><td class="lbl">Job Title</td><td>${escHtml(m.employee.jobTitle)}</td><td class="lbl">PhilHealth</td><td>${escHtml(m.employee.philhealth)}</td></tr>
    <tr><td class="lbl">Department</td><td>${escHtml(m.employee.department)}</td><td class="lbl">Pag-IBIG</td><td>${escHtml(m.employee.pagibig)}</td></tr>
    <tr><td class="lbl">Pay Period</td><td>${escHtml(m.periodLabel)}</td><td class="lbl">Pay Date</td><td>${escHtml(m.payDateLabel||'—')}</td></tr>
  </table>

  <div class="ps-sec-h">Earnings</div>
  <table class="ps-t">
    <tr><td>Basic Pay</td><td class="num">${f(m.earnings.base)}</td></tr>
    <tr><td>Allowances</td><td class="num">${f(m.earnings.allowance)}</td></tr>
    ${m.earnings.overtime?`<tr><td>Overtime</td><td class="num">${f(m.earnings.overtime)}</td></tr>`:''}
    <tr class="ps-gross"><td>Gross Pay</td><td class="num">${f(m.earnings.gross)}</td></tr>
  </table>

  <div class="ps-sec-h">Deductions &amp; Contributions</div>
  <table class="ps-t">
    <thead><tr><th>Contribution</th><th class="num">Employee</th><th class="num">Employer</th></tr></thead>
    <tbody>
      <tr><td>SSS</td><td class="num">${f(s.ee.sss)}</td><td class="num">${erCell('sss')}</td></tr>
      <tr><td>PhilHealth</td><td class="num">${f(s.ee.philhealth)}</td><td class="num">${erCell('philhealth')}</td></tr>
      <tr><td>Pag-IBIG</td><td class="num">${f(s.ee.pagibig)}</td><td class="num">${erCell('pagibig')}</td></tr>
      <tr><td>Withholding Tax</td><td class="num">${f(s.ee.tax)}</td><td class="num">—</td></tr>
      ${m.otherDeductions?`<tr><td>Other Deductions</td><td class="num">${f(m.otherDeductions)}</td><td class="num">—</td></tr>`:''}
    </tbody>
  </table>

  <div class="ps-sec-h">Cash Advance</div>
  <table class="ps-t">
    <tr><td>Balance (before)</td><td class="num">${f(m.ca.before)}</td></tr>
    <tr><td>Installment this period</td><td class="num">${f(m.ca.installment)}</td></tr>
    <tr class="ps-sub"><td>Balance (after)</td><td class="num">${f(m.ca.after)}</td></tr>
  </table>

  ${perf}

  <table class="ps-t ps-net-t">
    <tr class="ps-net"><td>NET PAY</td><td class="num">₱${f(m.net)}</td></tr>
  </table>

  <div class="ps-sec-h">Year to Date (${escHtml(String((window.bizYear?window.bizYear():new Date().getFullYear())))})</div>
  <table class="ps-t">
    <tr><td>YTD Gross</td><td class="num">${f(m.ytd.gross)}</td></tr>
    <tr><td>YTD Net</td><td class="num">${f(m.ytd.net)}</td></tr>
    <tr class="ps-sub"><td>13th-Month Accrual (est.)</td><td class="num">${f(m.ytd.thirteenthAccrual)}</td></tr>
  </table>

  ${timelog}

  ${_lh ? _lh.footerHTML : `<div class="ps-sigs">${m.signatures.map(sig=>`<div class="ps-sig"><div class="ps-sig-line">${escHtml(sig.name||'')}</div><div class="ps-sig-lbl">${escHtml(sig.label)}${sig.title?` — ${escHtml(sig.title)}`:''}</div></div>`).join('')}</div>`}
  `;
};

// Full in-app page, no pop-ups (owner directive) — prints via same-document window.print().
window.renderPayslipPage = function(model, backFn) {
  const host = document.getElementById('page-content');
  host.innerHTML = `
    <div class="no-print" style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn-secondary btn-sm" id="ps-back-btn">← Back</button>
      <button class="btn-primary btn-sm" onclick="window.print()">🖨 Print / Save PDF</button>
      <button class="btn-secondary btn-sm" id="ps-jpeg-btn">📷 Save as JPEG</button>
      ${model.proofUrl?`<a class="btn-secondary btn-sm" href="${safeHttpUrl(model.proofUrl)}" target="_blank">📎 Transfer Proof</a>`:''}
    </div>
    <div class="payslip-print">${buildPayslipHTML(model)}</div>`;
  document.getElementById('ps-back-btn').addEventListener('click', ()=> (backFn ? backFn() : history.back()));
  document.getElementById('ps-jpeg-btn')?.addEventListener('click', () => window.downloadPayslipJPEG(model));
  if (window.lucide) lucide.createIcons();
};

// JPEG export — migrated from the old popup's inline script to the in-page container.
window.downloadPayslipJPEG = async function(model) {
  const btn = document.getElementById('ps-jpeg-btn');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
  if (!window.html2canvas) {
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  }
  const el = document.querySelector('.payslip-print');
  const canvas = await html2canvas(el, { scale:2, useCORS:true, backgroundColor:'#fff', logging:false });
  const link = document.createElement('a');
  link.download = `payslip-${(model.employee.name||'employee').replace(/\s+/g,'-')}-${(model.docNumber||'').replace(/[^a-zA-Z0-9-]/g,'')}.jpg`;
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
  if (btn) { btn.textContent = '📷 Save as JPEG'; btn.disabled = false; }
};

// ── Finance Overview ──────────────────────────────
async function renderFinanceOverview(container, currentUser, currentRole) {
  // These collection-wide reads are only permitted for finance/admin by the
  // Firestore rules. A non-finance user who merely belongs to the Finance dept
  // can open this tab, so degrade gracefully instead of crashing the screen.
  // Totals come from the LEDGER (single source of truth). The expenses collection
  // is still read for the pending-approval queue + the recent-expenses list, but it
  // no longer feeds the headline totals (approved expenses are posted to the ledger).
  const [pendSnap, recentSnap, ledSnap] = await Promise.all([
    dbCachedGet('expenses-pending', () => db.collection('expenses').where('status','==','pending').get().catch(()=>({docs:[]})), 45000),
    dbCachedGet('expenses-recent',  () => db.collection('expenses').orderBy('date','desc').limit(50).get().catch(()=>({docs:[]})), 45000),
    dbCachedGet('ledger',           () => db.collection('ledger').get().catch(()=>({docs:[]})), 45000),  // ALL-TIME totals — shared TTL; WS13 replaces with finance_rollup
  ]);
  const pendingExpDocs = pendSnap.docs.map(d => ({id:d.id,...d.data()}));
  const expenses       = recentSnap.docs.map(d => ({id:d.id,...d.data()}));  // for the Recent Expenses card
  const ledger         = ledSnap.docs.map(d => d.data());
  const isPriv     = isFinancePriv();
  const ledIncome  = ledger.filter(e => ledgerKind(e)==='income').reduce((s,e) => s + (e.amount||0), 0);
  const ledExpense = ledger.filter(e => ledgerKind(e)==='expense').reduce((s,e) => s + (e.amount||0), 0);
  const pendingExp = pendingExpDocs.reduce((s,e) => s + (e.amount||0), 0);

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card green"><div class="kpi-label">Total Income</div><div class="kpi-value">₱${fmt(ledIncome)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Total Expenses</div><div class="kpi-value">₱${fmt(ledExpense)}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Pending Expenses</div><div class="kpi-value">₱${fmt(pendingExp)}</div></div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center"><h3>Recent Expenses</h3>${expenses.length?'<button class="btn-secondary btn-sm" id="exp-csv-btn">⬇ CSV</button>':''}</div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Description</th><th>Amount</th><th>By</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${expenses.slice(0,10).map(e => `<tr>
                <td>${escHtml(e.description)}</td><td>₱${fmt(e.amount)}</td>
                <td>${escHtml(e.submittedByName||'—')}</td>
                <td><span class="badge ${statusBadge(e.status)}">${e.status||'pending'}</span></td>
                <td style="white-space:nowrap">${e.fileUrl?`<a href="${safeHttpUrl(e.fileUrl)}" target="_blank" class="btn-icon">📎</a>`:''}${isPriv?`<button class="btn-secondary btn-sm exp-edit-btn" data-id="${e.id}" style="margin-left:4px">✎</button><button class="btn-danger btn-sm exp-del-btn" data-id="${e.id}" data-label="${escHtml(e.description||e.id.slice(-5))}" style="margin-left:4px">${emojiIcon('trash-2',14)}</button>`:''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  document.getElementById('exp-csv-btn')?.addEventListener('click', () => window.exportCSV('expenses', expenses, [
    {key:'date',label:'Date'},{key:'description',label:'Description'},{key:'category',label:'Category'},
    {key:'amount',label:'Amount',get:e=>e.amount||0},{key:'submittedByName',label:'By'},{key:'status',label:'Status',get:e=>e.status||'pending'},{key:'fileUrl',label:'Receipt'}]));

  if (isPriv) {
    const redo = () => renderFinanceOverview(container, currentUser, currentRole);
    container.querySelectorAll('.exp-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const e = expenses.find(x=>x.id===btn.dataset.id); if (!e) return;
      window.financeEditModal({ collection:'expenses', docId:e.id, title:'Expense', onSaved:()=>{ resyncLedgerForSource('expenses', e.id).then(redo); }, fields:[
        { key:'description', label:'Description', type:'text', value:e.description, full:true },
        { key:'amount', label:'Amount (₱)', type:'number', value:e.amount },
        { key:'category', label:'Category', type:'text', value:e.category },
        { key:'status', label:'Status', type:'select', value:e.status||'pending', options:['pending','approved','rejected','paid'] }
      ]});
    }));
    container.querySelectorAll('.exp-del-btn').forEach(btn => btn.addEventListener('click', () => {
      window.financeDelete({ collection:'expenses', docId:btn.dataset.id, label:`expense "${btn.dataset.label}"`, onDone:redo });
    }));
  }
}

// ══════════════════════════════════════════════════
//  SALES — BARRO KITCHENS
// ══════════════════════════════════════════════════
// Consolidated Sales portal (2026-07 declutter): 10 tabs → 6. The three quote
// entry points (Quick Estimate, the Builder, and the filed Records) collapse
// into one **Quotes** tab; the two partner tabs into **Partner**; the two file
// collections into **Files**. Revisions + records live inside Records untouched.
window.renderSales = async function(currentUser, currentRole, subtab = window.initialSubtab('Clients')) {
  window._bkCurrentUser = currentUser;
  window._bkCurrentRole = currentRole;
  const c = deptContainer();
  const salesTabs = ['Clients','Quotes','Partner','Files','SOP','Tasks'];
  // Legacy deep-link keys → new consolidated tab.
  const alias = { 'BK Quotes':'Quotes', 'Quotations':'Quotes', 'Quick Estimate':'Quotes',
                  'Partner Quotes':'Partner', 'Partner Files':'Partner',
                  'Work Plans':'Files', 'Proposals':'Files' };
  subtab = alias[subtab] || (salesTabs.includes(subtab) ? subtab : 'Clients');
  c.innerHTML = `
    <div class="page-header">
      <div>
        <h2>🍽️ Barro Kitchens — Sales</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">One-stop kitchen design &amp; build · Inquiry → Quote → Order</p>
      </div>
    </div>
    ${window.chipTabs(salesTabs.map(s=>({key:s,label:s})), subtab)}
    <div id="sales-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadSalesContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => { window.setSubroute(key); loadSalesContent(currentUser, currentRole, key); });
};

// Scoped inner sub-nav (chip toggle) for a consolidated Sales tab. Binds ONLY
// its own buttons (not the outer Sales chip bar, nor any chips a sub-view
// renders) by querying inside the dedicated `.sales-subnav` bar element.
function salesSubNav(content, keys, active, headerHtml, onSelect) {
  const chips = keys.map(k =>
    `<button type="button" class="chip-tab${k===active?' active':''}" data-chip="${escHtml(k)}">${escHtml(k)}</button>`
  ).join('');
  content.innerHTML = `
    ${headerHtml || ''}
    <div class="chip-tabs sales-subnav" style="margin-bottom:12px">${chips}</div>
    <div id="sales-subview"><div class="loading-placeholder">Loading…</div></div>`;
  const bar = content.querySelector('.sales-subnav');
  const view = content.querySelector('#sales-subview');
  bar.querySelectorAll('.chip-tab').forEach(btn => btn.addEventListener('click', () => {
    bar.querySelectorAll('.chip-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onSelect(btn.dataset.chip, view);
  }));
  onSelect(active, view);
}

async function loadSalesContent(currentUser, currentRole, sub) {
  const content = document.getElementById('sales-content');
  if (!content) return;
  switch(sub) {
    case 'Clients':
      await renderClientProfiles(content, currentUser, currentRole, 'barro');
      break;

    case 'Quotes': {
      // One tab, all three quote paths. "＋ New Quotation" opens the full
      // builder; Quick Estimate is a fast price-check that hands off to it;
      // Records lists everything filed (with New Revision / Reopen).
      const header = `
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px">
          <button class="btn-primary btn-sm" onclick="navigateTo('bk-quote-builder')">＋ New Quotation</button>
          <span style="font-size:12px;color:var(--text-muted)">Build a full quote, or use <strong>Quick Estimate</strong> for a fast price check. Filed &amp; revised quotes live under <strong>Records</strong>.</span>
        </div>`;
      salesSubNav(content, ['Records','Quick Estimate'], 'Records', header, (key, view) => {
        if (key === 'Quick Estimate') renderQuickEstimate(view, currentUser, currentRole);
        else renderBKQuotationsSummary(view, currentUser, currentRole);
      });
      break;
    }

    case 'Partner':
      salesSubNav(content, ['Quotes','Files'], 'Quotes',
        `<div style="font-size:12px;color:var(--text-muted);background:rgba(15,108,189,.06);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:12px">🤝 Brilliant Steel partner — quotes &amp; files shared with Sales for coordination.</div>`,
        (key, view) => {
          if (key === 'Files') renderBSFiles(view, currentUser, currentRole);
          else renderSalesPartnerQuotes(view, currentUser, currentRole);
        });
      break;

    case 'Files':
      salesSubNav(content, ['Work Plans','Proposals'], 'Work Plans', '', (key, view) => {
        if (key === 'Proposals') {
          view.innerHTML = renderFileCollection('Proposals', 'sales-props', currentRole);
          bindFileCollection('sales-props', currentUser, 'Sales', 'Proposals');
        } else {
          renderDocCollection(view, 'work_plans', 'Work Plans', currentUser, currentRole, { icon:'📋', color:'#e65100', dept:'Sales' });
        }
      });
      break;

    case 'SOP':
      renderSalesSOP(content);
      break;

    case 'Tasks':
      await renderDeptTasks(content, 'Sales', currentUser, currentRole);
      break;
  }
}

// ══════════════════════════════════════════════════
//  SALES — QUICK ESTIMATE
//  Fast price-check calculator over the SAME products-database.json the full
//  Quote Builder uses. Add many lines, see a live total, then (optionally)
//  hand the whole basket off to the Quote Builder as a formal quotation draft.
//  Pricing mirrors quote-builder-v2.html computePrice() so estimates match.
// ══════════════════════════════════════════════════
const qePeso = n => '₱' + Math.round(Number(n) || 0).toLocaleString('en-PH');
const qeNum  = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
window._qeItems = window._qeItems || [];   // basket persists within the session

async function qeLoadDB() {
  if (window._qeDB) return window._qeDB;
  try {
    const r = await fetch('products-database.json?v=' + Date.now());
    window._qeDB = await r.json();
  } catch (e) {
    console.warn('Quick Estimate: products DB load failed', e);
    window._qeDB = { categories: [], products: [], constants: {} };
  }
  return window._qeDB;
}

// Unit price for product `p` given the chosen dims/specs — faithful port of the
// Quote Builder's computePrice() so the two tools never disagree on a number.
function qeUnitPrice(p, ctx) {
  if (!p) return 0;
  ctx = ctx || {};
  const consts  = (window._qeDB && window._qeDB.constants) || {};
  const matMult = consts.materialPriceIndexMultiplier || 1.0;
  const dd = p.defaultDimensions || {};
  let price = p.basePrice || 0;

  if (p.formulaType === 'per_length' && p.formula) {
    const W = qeNum(ctx.W, dd.W != null ? dd.W : 900);
    const base = p.formula.baseLengthMm || 900;
    const ppm = p.formula.pricePerExtraMm || 0;
    price = (p.basePrice || 0) + Math.max(0, W - base) * ppm;
  } else if (p.formulaType === 'per_area' && p.formula) {
    const W = qeNum(ctx.W, dd.W != null ? dd.W : 1000);
    const H = qeNum(ctx.H, dd.H != null ? dd.H : 1000);
    price = ((W * H) / 1e6) * (p.formula.pricePerSqm || 0);
  } else if (p.formulaType === 'per_run' && p.formula) {
    const runs = qeNum(ctx.runs, 1) || 1;
    price = (p.formula.pricePerRun || p.basePrice || 0) * runs;
  }

  price *= matMult;

  if (p.specs && p.specs.length && Array.isArray(ctx.specIdx)) {
    p.specs.forEach((s, i) => {
      const oi = parseInt(ctx.specIdx[i] || 0);
      const adder = (s.priceAdder && s.priceAdder[oi]) ? s.priceAdder[oi] : 0;
      price += adder;
    });
  }
  return Math.max(0, Math.round(price));
}

// Read the current picker form into a {W,H,runs,specIdx} context object
function qeReadCtx(p) {
  const ctx = { specIdx: [] };
  const w = document.getElementById('qe-dim-W'); if (w) ctx.W = w.value;
  const h = document.getElementById('qe-dim-H'); if (h) ctx.H = h.value;
  const r = document.getElementById('qe-dim-runs'); if (r) ctx.runs = r.value;
  if (p && p.specs) p.specs.forEach((s, i) => {
    const sel = document.getElementById('qe-spec-' + i);
    ctx.specIdx[i] = sel ? parseInt(sel.value || 0) : 0;
  });
  return ctx;
}

function qeSelectedProduct() {
  const sel = document.getElementById('qe-product');
  if (!sel || !sel.value) return null;
  return (window._qeDB.products || []).find(p => p.id === sel.value) || null;
}

// Dimension / spec inputs shown depend on the selected product's formula
function qeRenderDims() {
  const box = document.getElementById('qe-dims');
  const p = qeSelectedProduct();
  if (!box) return;
  if (!p) { box.innerHTML = ''; return; }
  const dd = p.defaultDimensions || {};
  let html = '';
  const inputStyle = 'width:90px;padding:7px 9px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px';
  const wrap = (label, inner) => `<div style="display:flex;flex-direction:column;gap:3px"><label style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.03em">${label}</label>${inner}</div>`;

  if (p.formulaType === 'per_length') {
    html += wrap('Width (mm)', `<input type="number" id="qe-dim-W" value="${dd.W != null ? dd.W : 900}" oninput="qePreview()" style="${inputStyle}">`);
  } else if (p.formulaType === 'per_area') {
    html += wrap('Width (mm)', `<input type="number" id="qe-dim-W" value="${dd.W != null ? dd.W : 1000}" oninput="qePreview()" style="${inputStyle}">`);
    html += wrap('Height (mm)', `<input type="number" id="qe-dim-H" value="${dd.H != null ? dd.H : 1000}" oninput="qePreview()" style="${inputStyle}">`);
  } else if (p.formulaType === 'per_run') {
    html += wrap('Runs / sections', `<input type="number" id="qe-dim-runs" value="1" min="1" oninput="qePreview()" style="${inputStyle}">`);
  }
  if (p.specs && p.specs.length) {
    p.specs.forEach((s, i) => {
      const opts = (s.options || []).map((o, oi) => `<option value="${oi}">${escHtml(o)}</option>`).join('');
      html += wrap(escHtml(s.label || ('Option ' + (i + 1))), `<select id="qe-spec-${i}" onchange="qePreview()" style="${inputStyle};width:auto;min-width:120px">${opts}</select>`);
    });
  }
  if (p.formulaType === 'configurable') {
    html += `<div style="align-self:flex-end;font-size:10px;color:var(--text-muted);max-width:180px">Configurable item — base price shown; fine-tune in the full builder.</div>`;
  }
  box.innerHTML = html;
}

// Live unit-price preview for the product currently in the picker
function qePreview() {
  const p = qeSelectedProduct();
  const out = document.getElementById('qe-unit-price');
  const lead = document.getElementById('qe-lead');
  if (!out) return;
  if (!p) { out.textContent = '₱0'; if (lead) lead.textContent = ''; return; }
  const unit = qeUnitPrice(p, qeReadCtx(p));
  out.textContent = qePeso(unit);
  if (lead) lead.textContent = p.leadTime ? ('Lead time: ' + p.leadTime) : '';
}

function qeOnProductChange() { qeRenderDims(); qePreview(); }

function qeAddItem() {
  const p = qeSelectedProduct();
  if (!p) { Notifs.showToast('Pick a product first', 'info'); return; }
  const ctx = qeReadCtx(p);
  const qty = Math.max(1, parseInt(document.getElementById('qe-qty')?.value || 1));
  const unitPrice = qeUnitPrice(p, ctx);

  // dims display string + spec snapshot (matches the builder's line-item shape
  // so the formal-quote handoff loads cleanly)
  const dimParts = [];
  if (ctx.W != null && document.getElementById('qe-dim-W')) dimParts.push('W' + qeNum(ctx.W, 0));
  if (ctx.H != null && document.getElementById('qe-dim-H')) dimParts.push('H' + qeNum(ctx.H, 0));
  if (ctx.runs != null && document.getElementById('qe-dim-runs')) dimParts.push(qeNum(ctx.runs, 1) + ' run(s)');
  const specSnapshot = [];
  if (p.specs) p.specs.forEach((s, i) => specSnapshot.push({ label: s.label, value: (s.options || [])[ctx.specIdx[i] || 0] || '' }));
  const specStr = specSnapshot.map(s => s.value).filter(Boolean).join(', ');

  window._qeItems.push({
    id: p.id, category: p.category, name: p.name,
    dims: dimParts.join(' × '),
    specs: specSnapshot, specStr,
    qty, unit: p.unit || 'pc',
    unitPrice, amount: unitPrice * qty,
    leadTime: p.leadTime || '—',
    laborHours: p.laborHours || null,
    capitalMaterials: p.capitalMaterials || 0,
    capitalLabor: p.capitalLabor || 0,
    formulaType: p.formulaType,
  });
  qeRenderItems();
}

function qeRemoveItem(i) { window._qeItems.splice(i, 1); qeRenderItems(); }
function qeSetQty(i, v) {
  const it = window._qeItems[i]; if (!it) return;
  it.qty = Math.max(1, parseInt(v || 1));
  it.amount = it.unitPrice * it.qty;
  qeRenderItems();
}
async function qeClearAll() {
  if (!window._qeItems.length) return;
  if (!(await confirmDialog({message:'Clear all items from this estimate?', danger:true}))) return;
  window._qeItems = []; qeRenderItems();
}

function qeRenderItems() {
  const wrap = document.getElementById('qe-items');
  if (!wrap) return;
  const items = window._qeItems;
  if (!items.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:28px 12px;color:var(--text-muted);font-size:13px;border:1.5px dashed var(--border);border-radius:12px">No items yet — pick a product above and tap <strong>Add to estimate</strong>.</div>`;
    qeRenderTotals(); return;
  }
  const rows = items.map((it, i) => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 6px">
        <div style="font-weight:700;font-size:12.5px;color:var(--text)">${escHtml(it.name)}</div>
        <div style="font-size:10.5px;color:var(--text-muted)">${escHtml([it.dims, it.specStr].filter(Boolean).join(' · ') || it.unit)}</div>
      </td>
      <td style="padding:8px 6px;text-align:right;white-space:nowrap">${qePeso(it.unitPrice)}</td>
      <td style="padding:8px 6px;text-align:center">
        <input type="number" min="1" value="${it.qty}" onchange="qeSetQty(${i}, this.value)"
          style="width:54px;padding:5px 6px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:12px;text-align:center">
      </td>
      <td style="padding:8px 6px;text-align:right;font-weight:700;white-space:nowrap">${qePeso(it.amount)}</td>
      <td style="padding:8px 2px;text-align:center">
        <button onclick="qeRemoveItem(${i})" title="Remove" style="background:none;border:none;cursor:pointer;color:var(--danger,#e53935);font-size:15px;line-height:1">✕</button>
      </td>
    </tr>`).join('');
  wrap.innerHTML = `
    <div class="table-wrap"><table style="width:100%;border-collapse:collapse;min-width:340px">
      <thead><tr style="border-bottom:2px solid var(--border);font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">
        <th style="padding:6px;text-align:left">Item</th>
        <th style="padding:6px;text-align:right">Unit ₱</th>
        <th style="padding:6px;text-align:center">Qty</th>
        <th style="padding:6px;text-align:right">Amount</th>
        <th style="padding:6px"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  qeRenderTotals();
}

function qeRenderTotals() {
  const box = document.getElementById('qe-totals');
  if (!box) return;
  const items = window._qeItems;
  const subtotal = items.reduce((s, it) => s + (it.amount || 0), 0);
  const vatRate = ((window._qeDB && window._qeDB.constants && window._qeDB.constants.vat) || 0.12);
  const showVat = !!(document.getElementById('qe-vat') && document.getElementById('qe-vat').checked);
  const vatAmt = showVat ? subtotal * vatRate : 0;
  const grand = subtotal + vatAmt;
  const count = items.reduce((s, it) => s + (it.qty || 0), 0);
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-bottom:4px"><span>Subtotal (${count} pc${count===1?'':'s'}, ${items.length} line${items.length===1?'':'s'})</span><span>${qePeso(subtotal)}</span></div>
    ${showVat ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-bottom:4px"><span>VAT (${Math.round(vatRate*100)}%)</span><span>${qePeso(vatAmt)}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800;color:var(--text);border-top:1.5px solid var(--border);padding-top:8px;margin-top:4px"><span>Total</span><span>${qePeso(grand)}</span></div>`;
}

// Hand the whole basket to the full Quote Builder as a fresh draft. Uses the
// same _qbReopenState mechanism the Quotations "Reopen" action uses.
function qeCreateFormalQuote() {
  if (!window._qeItems.length) { Notifs.showToast('Add at least one item first', 'info'); return; }
  const client = (document.getElementById('qe-client') || {}).value || '';
  window._qbReopenState = {
    currentCo: 'BK',
    clientName: client.trim(),
    items: window._qeItems.map(it => ({ ...it })),
  };
  window._qbReopenAsRevision = false;
  Notifs.showToast('Opening Quote Builder with your ' + window._qeItems.length + ' item(s)…', 'success');
  navigateTo('bk-quote-builder');
}

async function renderQuickEstimate(container, currentUser, currentRole) {
  container.innerHTML = `<div class="loading-placeholder">Loading products…</div>`;
  const db = await qeLoadDB();
  const cats = db.categories || [];
  const products = (db.products || []).slice();

  // group products under category optgroups
  const byCat = {};
  products.forEach(p => { (byCat[p.category] = byCat[p.category] || []).push(p); });
  const catLabel = id => { const c = cats.find(x => x.id === id); return c ? `${c.icon || ''} ${c.label}` : id; };
  const optgroups = Object.keys(byCat).map(cid => `
    <optgroup label="${escHtml(catLabel(cid))}">
      ${byCat[cid].map(p => `<option value="${p.id}">${escHtml(p.shortName || p.name)}</option>`).join('')}
    </optgroup>`).join('');

  const ctrlStyle = 'padding:9px 11px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px';

  container.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);background:rgba(230,81,0,.07);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:14px">
      ⚡ <strong>Quick Estimate</strong> — check & total prices fast using the live product database. Add as many items as you like, then create a formal quotation when the client is ready.
    </div>

    <!-- Picker -->
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:14px;margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:200px">
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.03em">Product</label>
          <select id="qe-product" onchange="qeOnProductChange()" style="${ctrlStyle}">
            <option value="">— Select a product —</option>
            ${optgroups}
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.03em">Qty</label>
          <input type="number" id="qe-qty" value="1" min="1" style="${ctrlStyle};width:70px">
        </div>
      </div>
      <div id="qe-dims" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px"></div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
        <div>
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Unit price</div>
          <div id="qe-unit-price" style="font-size:22px;font-weight:800;color:var(--primary,#e65100)">₱0</div>
          <div id="qe-lead" style="font-size:10.5px;color:var(--text-muted)"></div>
        </div>
        <button class="btn-primary" onclick="qeAddItem()" style="padding:11px 20px;font-weight:700">＋ Add to estimate</button>
      </div>
    </div>

    <!-- Basket -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <h3 style="font-size:14px;font-weight:800;color:var(--text);margin:0">Estimate Items</h3>
      <button onclick="qeClearAll()" class="btn-secondary btn-sm">Clear all</button>
    </div>
    <div id="qe-items" style="margin-bottom:14px"></div>

    <!-- Totals -->
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:14px;margin-bottom:14px">
      <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text);margin-bottom:10px;cursor:pointer">
        <input type="checkbox" id="qe-vat" onchange="qeRenderTotals()"> Add VAT (12%)
      </label>
      <div id="qe-totals"></div>
    </div>

    <!-- Client + handoff -->
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:14px">
      <label style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.03em">Client name (optional — carried into the quote)</label>
      <input type="text" id="qe-client" placeholder="e.g. Juan Dela Cruz / ABC Restaurant" style="${ctrlStyle};width:100%;margin:5px 0 12px;box-sizing:border-box">
      <button class="btn-primary" onclick="qeCreateFormalQuote()" style="width:100%;padding:13px;font-weight:800;font-size:14px">📄 Create Formal Quotation →</button>
      <p style="font-size:11px;color:var(--text-muted);margin:8px 0 0;text-align:center">Opens the full Quote Builder pre-filled with these items, where you can refine, file, and export a PDF.</p>
    </div>
  `;

  qeRenderItems();   // render any items already in the session basket
}

// ── Sales SOP — Inquiry → Sales Order ─────────────
// Editable playbook. Persisted to settings/sales_sop (President-only write per
// firestore.rules → settings); falls back to DEFAULT_SALES_SOP when no doc exists.
// Body text supports lightweight **bold** markup; everything is escaped first.
const SALES_SOP_ORANGE = '#e65100';
const DEFAULT_SALES_SOP = {
  intro: "The standard end-to-end process every Sales staff and agent follows. Each step shows who owns it and which tab to use. Follow the steps in order — don't skip review or confirmation.",
  steps: [
    { short:'Inquiry', title:'Inquiry Received', owner:'Sales Agent / Sales Staff', tab:'Clients',
      desc:'Capture every incoming inquiry the moment it arrives — walk-in, phone, email, Facebook / Messenger, website, or referral.',
      actions:[
        'Greet the customer and acknowledge the inquiry within the day.',
        'Log the lead in **Sales → Clients**: name, contact number, email, source, and what they are asking for.',
        'Note the product line of interest — Barro Kitchen build, appliances, or steel.'
      ], out:'New client / lead record created.' },
    { short:'Qualify', title:'Qualify the Inquiry', owner:'Sales Agent / Sales Staff', tab:'Clients',
      desc:'Understand the requirement before spending time on a quote.',
      actions:[
        'Confirm scope: standard product, or custom design & build?',
        'Identify budget range, target timeline, and the decision-maker.',
        'Flag delivery location (affects freight / installation).',
        'Disqualify or park leads that are not a real fit — keep the pipeline clean.'
      ], out:'Qualified requirement with clear scope.' },
    { short:'Site Visit', title:'Site Visit & Measurement', owner:'Sales + Design', tab:'Clients · Files',
      desc:'For custom kitchen builds or fabricated steel — gather exact requirements on site. Skip for off-the-shelf items.',
      actions:[
        'Schedule the visit; take measurements, photos, and the customer brief.',
        'Coordinate with **Design** for drawings / layout where a design is required.',
        'Record findings as a Work Plan in **Sales → Files → Work Plans**.'
      ], out:'Site data & design brief ready for pricing.' },
    { short:'Quote', title:'Prepare the Quotation', owner:'Sales Agent / Sales Staff', tab:'Quotes',
      desc:'Build the priced quotation using the system, not a manual computation.',
      actions:[
        'Open **Sales → Quotes → ＋ New Quotation** to price products, materials, labor, delivery, and installation (use **Quick Estimate** for a fast price check first).',
        'Apply correct unit prices, quantities, and any approved discounts.',
        'State validity period and payment terms (e.g. 50% down payment, balance before delivery).'
      ], out:'Draft quotation saved.' },
    { short:'Approve', title:'Internal Review & Approval', owner:'Sales Manager / Finance', tab:'Quotes → Records',
      desc:'No quotation leaves the company without a margin check.',
      actions:[
        'Manager / Finance reviews pricing, margin, discounts, and terms in **Sales → Quotes → Records**.',
        'Correct any error or under-priced line before it reaches the client — send back with **New Revision** if needed.',
        'Approve the quotation to release it.'
      ], out:'Approved quotation, cleared to send.' },
    { short:'Send', title:'Send Quotation to Client', owner:'Sales Agent / Sales Staff', tab:'Quotes → Records',
      desc:'Deliver the approved quote and record that it went out.',
      actions:[
        'Export the quotation to PDF and send via the agreed channel.',
        'Mark the quotation as **Sent** in **Sales → Quotes → Records** with the date.',
        'Confirm the client received it.'
      ], out:'Quotation sent and logged.' },
    { short:'Follow-up', title:'Follow-up & Negotiation', owner:'Sales Agent / Sales Staff', tab:'Quotes → Records',
      desc:'Most deals are won in the follow-up. Stay on it.',
      actions:[
        'Follow up within 2–3 working days of sending.',
        'Handle questions, revisions, and price / term negotiation — use **New Revision** to keep every version on record.',
        'Re-route any revised pricing back through review (Step 5) before re-sending.',
        'Keep the quotation status current (Sent → Negotiating → Won / Lost).'
      ], out:'Clear client decision.' },
    { short:'Confirm', title:'Client Confirmation & Down Payment', owner:'Sales + Finance', tab:'Quotes → Records',
      desc:'A verbal "yes" is not an order. Secure the commitment.',
      actions:[
        'Obtain written confirmation: signed quotation, contract, or Purchase Order.',
        'Collect the agreed down payment.',
        '**Finance** verifies the payment before the order is created.'
      ], out:'Confirmed, paid order — ready to convert.' },
    { short:'Sales Order', title:'Create the Sales Order', owner:'Sales Agent / Sales Staff', tab:'Sales Orders',
      desc:'Convert the won quotation into a formal Sales Order in the system.',
      actions:[
        'Open **Sales Orders** and create the order from the agreed quotation.',
        'Record final items, quantities, total amount, agreed delivery date, and payment terms.',
        'Attach the signed quote / PO and proof of down payment.'
      ], out:'Sales Order recorded in the system.' },
    { short:'Production', title:'Handoff to Production / Fulfillment', owner:'Sales → Production', tab:'Sales Orders · Production',
      desc:'Close the loop — hand the order to the team that builds and delivers it.',
      actions:[
        'Transfer the Sales Order to **Production** from the Sales Orders tab.',
        'Notify Design / Production and confirm the schedule.',
        'Keep the client updated on production and delivery status.'
      ], out:'Order in production. Sales cycle complete.' },
  ],
  rules: [
    'Log **every** inquiry — an unlogged lead is a lost lead.',
    'No quotation goes out without internal review & approval (Step 5).',
    'No Sales Order is created without written confirmation and verified down payment (Step 8).',
    'Keep quotation & order status current so the pipeline reflects reality.',
    'Respond within the day; follow up within 2–3 working days.'
  ]
};

// Escape, then apply tiny **bold** markup. Safe for President-entered content.
function sopFmt(s){ return (window.escHtml?escHtml(s):String(s==null?'':s)).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>'); }
function sopFmtDate(ts){
  try{
    const d = ts && ts.toDate ? ts.toDate()
      : (ts instanceof Date ? ts
      : (ts && ts.seconds ? new Date(ts.seconds*1000)
      : (typeof ts==='string' ? new Date(ts) : null)));
    return d ? d.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric'}) : '';
  }catch(_){ return ''; }
}

async function renderSalesSOP(container) {
  container.innerHTML = '<div class="loading-placeholder">Loading SOP…</div>';
  let data = null;
  try {
    const doc = await db.collection('settings').doc('sales_sop').get();
    if (doc.exists) data = doc.data();
  } catch(_){}
  if (!data || !Array.isArray(data.steps) || !data.steps.length) data = DEFAULT_SALES_SOP;
  window._salesSopData = data;
  renderSalesSOPView(container, data);
}

function renderSalesSOPView(container, data) {
  const O = SALES_SOP_ORANGE;
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const canEdit = (typeof isPresident==='function' && isPresident());
  const updated = data.updatedAt
    ? `<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">Updated ${sopFmtDate(data.updatedAt)}${data.updatedBy?(' · '+escHtml(data.updatedBy)):''}</div>`
    : '';

  container.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(230,81,0,.14),rgba(230,81,0,.04));border:1px solid rgba(230,81,0,.35);border-radius:14px;padding:16px 18px;margin-bottom:16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:24px">📖</span>
          <h3 style="margin:0;font-size:17px;color:var(--text)">Sales SOP — Inquiry to Sales Order</h3>
        </div>
        ${canEdit?`<button class="btn-secondary btn-sm" id="sop-edit-btn" style="flex-shrink:0">✏️ Edit SOP</button>`:''}
      </div>
      <p style="margin:0;font-size:12.5px;color:var(--text-muted);line-height:1.6">${sopFmt(data.intro||'')}</p>
      ${updated}
    </div>

    <!-- At-a-glance pipeline -->
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:20px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px">
      ${steps.map((s,i)=>`
        <span style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:999px;padding:5px 11px;font-size:11px;font-weight:700;color:var(--text)">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:${O};color:#fff;font-size:10px">${i+1}</span>
          ${escHtml(s.short||s.title||'')}
        </span>
        ${i<steps.length-1?`<span style="color:${O};font-weight:800">›</span>`:''}
      `).join('')}
    </div>

    <!-- Steps -->
    <div style="display:flex;flex-direction:column;gap:12px">
      ${steps.map((s,i)=>`
        <div style="display:flex;gap:14px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;border-left:4px solid ${O}">
          <div style="flex-shrink:0;width:38px;height:38px;border-radius:50%;background:${O};color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800">${i+1}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:4px">
              <h4 style="margin:0;font-size:15px;color:var(--text)">${escHtml(s.title||'')}</h4>
              ${s.owner?`<span style="font-size:10.5px;font-weight:700;color:${O};background:rgba(230,81,0,.12);border:1px solid rgba(230,81,0,.3);border-radius:999px;padding:2px 9px">👤 ${escHtml(s.owner)}</span>`:''}
              ${s.tab?`<span style="font-size:10.5px;font-weight:700;color:var(--text-muted);background:var(--surface2);border:1px solid var(--border);border-radius:999px;padding:2px 9px">📍 ${escHtml(s.tab)}</span>`:''}
            </div>
            ${s.desc?`<p style="margin:0 0 8px;font-size:12.5px;color:var(--text-muted);line-height:1.55">${sopFmt(s.desc)}</p>`:''}
            ${(Array.isArray(s.actions)&&s.actions.length)?`<ul style="margin:0 0 10px;padding-left:18px;font-size:12.5px;color:var(--text);line-height:1.7">
              ${s.actions.map(a=>`<li>${sopFmt(a)}</li>`).join('')}
            </ul>`:''}
            ${s.out?`<div style="font-size:11.5px;color:var(--success);font-weight:700;background:rgba(48,209,88,.1);border-radius:8px;padding:6px 10px;display:inline-block">✓ Output: ${sopFmt(s.out)}</div>`:''}
          </div>
        </div>
      `).join('')}
    </div>

    ${rules.length?`<!-- Golden rules -->
    <div style="margin-top:18px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px">
      <h4 style="margin:0 0 10px;font-size:14px;color:var(--text)">⭐ Golden Rules</h4>
      <ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--text);line-height:1.8">
        ${rules.map(r=>`<li>${sopFmt(r)}</li>`).join('')}
      </ul>
    </div>`:''}

    <p style="text-align:center;font-size:11px;color:var(--text-muted);margin:16px 0 4px">
      Barro Industries · Sales Department · Standard Operating Procedure
    </p>
  `;

  if (canEdit) document.getElementById('sop-edit-btn')?.addEventListener('click', () => renderSalesSOPEditor(container, data));
}

// ── SOP editor (President only) ───────────────────
function renderSalesSOPEditor(container, data) {
  // Deep-clone into a working draft so Cancel discards unsaved edits.
  window._salesSopDraft = {
    intro: data.intro || '',
    steps: (data.steps || []).map(s => ({
      short:s.short||'', title:s.title||'', owner:s.owner||'', tab:s.tab||'',
      desc:s.desc||'', actions:Array.isArray(s.actions)?s.actions.slice():[], out:s.out||''
    })),
    rules: Array.isArray(data.rules) ? data.rules.slice() : []
  };
  drawSalesSOPEditor(container);
}

function drawSalesSOPEditor(container) {
  const d = window._salesSopDraft;
  const O = SALES_SOP_ORANGE;
  const fld = 'width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px;box-sizing:border-box;font-family:inherit';
  const lbl = 'display:block;font-size:10.5px;font-weight:700;color:var(--text-muted);margin:8px 0 3px;text-transform:uppercase;letter-spacing:.04em';

  const stepCard = (s,i) => `
    <div class="sop-step-edit" data-si="${i}" style="background:var(--surface);border:1px solid var(--border);border-left:4px solid ${O};border-radius:12px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-weight:800;color:${O};font-size:13px">Step ${i+1}</span>
        <span style="display:flex;gap:5px">
          <button class="btn-secondary btn-sm sop-mv-up" data-i="${i}" title="Move up" ${i===0?'disabled':''}>↑</button>
          <button class="btn-secondary btn-sm sop-mv-down" data-i="${i}" title="Move down" ${i===d.steps.length-1?'disabled':''}>↓</button>
          <button class="btn-secondary btn-sm sop-rm-step" data-i="${i}" title="Remove step" style="color:#ff6b6b">${emojiIcon('trash-2',14)}</button>
        </span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><label style="${lbl}">Title</label><input data-f="title" value="${escHtml(s.title)}" style="${fld}"/></div>
        <div><label style="${lbl}">Pipeline label (short)</label><input data-f="short" value="${escHtml(s.short)}" placeholder="e.g. Quote" style="${fld}"/></div>
        <div><label style="${lbl}">Owner / Role</label><input data-f="owner" value="${escHtml(s.owner)}" style="${fld}"/></div>
        <div><label style="${lbl}">System tab</label><input data-f="tab" value="${escHtml(s.tab)}" style="${fld}"/></div>
      </div>
      <label style="${lbl}">Description</label>
      <textarea data-f="desc" rows="2" style="${fld};resize:vertical">${escHtml(s.desc)}</textarea>
      <label style="${lbl}">Actions (one per line)</label>
      <textarea data-f="actions" rows="3" style="${fld};resize:vertical">${escHtml((s.actions||[]).join('\n'))}</textarea>
      <label style="${lbl}">Output</label>
      <input data-f="out" value="${escHtml(s.out)}" style="${fld}"/>
    </div>`;

  container.innerHTML = `
    <div style="background:rgba(230,81,0,.08);border:1px solid rgba(230,81,0,.3);border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--text-muted)">
      ✏️ <b style="color:var(--text)">Editing Sales SOP.</b> Changes are visible to everyone once saved. Use <code>**bold**</code> for emphasis.
    </div>

    <label style="${lbl}">Intro</label>
    <textarea id="sop-intro" rows="3" style="${fld};resize:vertical">${escHtml(d.intro)}</textarea>

    <div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 8px">
      <h4 style="margin:0;font-size:14px;color:var(--text)">Steps (${d.steps.length})</h4>
      <button class="btn-secondary btn-sm" id="sop-add-step">+ Add step</button>
    </div>
    <div id="sop-steps-edit" style="display:flex;flex-direction:column;gap:12px">
      ${d.steps.map((s,i)=>stepCard(s,i)).join('')}
    </div>

    <label style="${lbl};margin-top:18px">Golden Rules (one per line)</label>
    <textarea id="sop-rules" rows="6" style="${fld};resize:vertical">${escHtml((d.rules||[]).join('\n'))}</textarea>

    <div style="display:flex;gap:8px;margin-top:18px;position:sticky;bottom:0;background:var(--bg);padding:10px 0">
      <button class="btn-primary btn-sm" id="sop-save">💾 Save SOP</button>
      <button class="btn-secondary btn-sm" id="sop-cancel">Cancel</button>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  document.getElementById('sop-add-step')?.addEventListener('click', () => {
    salesSopGatherDOM();
    d.steps.push({ short:'', title:'New Step', owner:'', tab:'', desc:'', actions:[], out:'' });
    drawSalesSOPEditor(container);
  });
  document.getElementById('sop-save')?.addEventListener('click', () => salesSopSave(container));
  document.getElementById('sop-cancel')?.addEventListener('click', () => renderSalesSOPView(container, window._salesSopData || DEFAULT_SALES_SOP));
  container.querySelectorAll('.sop-rm-step').forEach(b => b.addEventListener('click', () => {
    salesSopGatherDOM(); d.steps.splice(+b.dataset.i, 1); drawSalesSOPEditor(container);
  }));
  container.querySelectorAll('.sop-mv-up').forEach(b => b.addEventListener('click', () => {
    salesSopGatherDOM(); const i=+b.dataset.i; if(i>0){ const t=d.steps[i-1]; d.steps[i-1]=d.steps[i]; d.steps[i]=t; } drawSalesSOPEditor(container);
  }));
  container.querySelectorAll('.sop-mv-down').forEach(b => b.addEventListener('click', () => {
    salesSopGatherDOM(); const i=+b.dataset.i; if(i<d.steps.length-1){ const t=d.steps[i+1]; d.steps[i+1]=d.steps[i]; d.steps[i]=t; } drawSalesSOPEditor(container);
  }));
}

// Read the editor inputs back into the working draft (preserves edits across redraws).
function salesSopGatherDOM() {
  const d = window._salesSopDraft; if (!d) return;
  const introEl = document.getElementById('sop-intro'); if (introEl) d.intro = introEl.value;
  const rulesEl = document.getElementById('sop-rules'); if (rulesEl) d.rules = rulesEl.value.split('\n').map(x=>x.trim()).filter(Boolean);
  document.querySelectorAll('.sop-step-edit').forEach(card => {
    const i = +card.dataset.si; const st = d.steps[i]; if (!st) return;
    card.querySelectorAll('[data-f]').forEach(inp => {
      const f = inp.dataset.f;
      if (f === 'actions') st.actions = inp.value.split('\n').map(x=>x.trim()).filter(Boolean);
      else st[f] = inp.value;
    });
  });
}

async function salesSopSave(container) {
  salesSopGatherDOM();
  const d = window._salesSopDraft;
  // Drop fully-empty steps.
  d.steps = (d.steps||[]).filter(s => (s.title||'').trim() || (s.desc||'').trim() || (s.actions||[]).length);
  const btn = document.getElementById('sop-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await db.collection('settings').doc('sales_sop').set({
      intro: d.intro||'', steps: d.steps, rules: d.rules||[],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: (typeof currentUser!=='undefined' && currentUser && currentUser.email) || ''
    }, { merge:true });
    const fresh = { intro:d.intro||'', steps:d.steps, rules:d.rules||[],
      updatedAt: new Date(), updatedBy: (typeof currentUser!=='undefined' && currentUser && currentUser.email) || '' };
    window._salesSopData = fresh;
    window.Notifs?.showToast?.('SOP saved');
    renderSalesSOPView(container, fresh);
  } catch(e) {
    window.Notifs?.showToast?.('Save failed — ' + (e?.message||e));
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save SOP'; }
  }
}

// ── BK Quote List ────────────────────────────────
function renderBKQuoteList(container, currentUser, currentRole) {
  const isPrivileged = ['president','manager','finance'].includes(currentRole);
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div id="bk-quote-stats" style="font-size:13px;color:var(--text-muted)"></div>
      <button class="btn-primary btn-sm" id="new-bk-quote-btn">+ New BK Quote</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <select id="bk-filter-status" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px">
        <option value="">All Status</option>
        <option value="draft">Draft</option>
        <option value="sent">Sent</option>
        <option value="accepted">Accepted</option>
        <option value="rejected">Rejected</option>
      </select>
    </div>
    <div id="bk-quote-list"><div class="loading-placeholder">Loading quotes…</div></div>
  `;

  const loadBKQuotes = async () => {
    const wrap = document.getElementById('bk-quote-list');
    const filterStatus = document.getElementById('bk-filter-status')?.value || '';
    let q = db.collection('bk_quotes').orderBy('createdAt','desc');
    if (!isPrivileged) q = q.where('createdBy','==',currentUser.uid);
    const snap = await q.get().catch(()=>({docs:[]}));
    let quotes = snap.docs.map(d=>({id:d.id,...d.data()}));
    if (filterStatus) quotes = quotes.filter(q=>q.status===filterStatus);

    const statsEl = document.getElementById('bk-quote-stats');
    if (statsEl) {
      const total = quotes.reduce((s,q)=>s+(q.total||0),0);
      const accepted = quotes.filter(q=>q.status==='accepted').length;
      statsEl.textContent = `${quotes.length} quote${quotes.length!==1?'s':''} · ₱${fmt(total)} · ${accepted} accepted`;
    }

    if (!quotes.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🍽️</div><h4>No BK quotes yet</h4><p>Create your first Barro Kitchens quote</p></div>`;
      return;
    }
    wrap.innerHTML = `<div class="item-list">${quotes.map(q=>`
      <div class="item-card bk-quote-item" data-id="${q.id}" style="cursor:pointer">
        <div class="item-top">
          <div class="item-title">BK-${q.quoteNumber||q.id.slice(-6).toUpperCase()} — ${escHtml(q.clientName||'Unnamed')}</div>
          <span class="badge ${statusBadge(q.status)}">${q.status||'draft'}</span>
        </div>
        <div class="item-meta">
          <span>💰 ₱${fmt(q.total||0)}</span>
          <span>📦 ${escHtml(q.packageName||q.scope||'Custom')}</span>
          <span>👤 ${escHtml(q.agentName||'—')}</span>
          ${q.createdAt?`<span>📅 ${new Date(q.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
        </div>
        ${q.notes?`<div style="font-size:12px;color:var(--text-muted);margin-top:6px;white-space:pre-line">${escHtml(q.notes.slice(0,80))}${q.notes.length>80?'…':''}</div>`:''}
      </div>`).join('')}</div>`;

    wrap.querySelectorAll('.bk-quote-item').forEach(item => {
      item.addEventListener('click', async () => {
        const s = await db.collection('bk_quotes').doc(item.dataset.id).get();
        openBKQuoteEditor(currentUser, currentRole, {id:s.id,...s.data()}, loadBKQuotes);
      });
    });
  };

  loadBKQuotes();
  document.getElementById('new-bk-quote-btn').onclick = () => openBKQuoteEditor(currentUser, currentRole, null, loadBKQuotes);
  document.getElementById('bk-filter-status')?.addEventListener('change', loadBKQuotes);
}

// ── BK Quote Editor ──────────────────────────────
const BK_CATEGORIES = ['Cabinets & Storage','Countertops','Backsplash & Tiles','Appliances','Hardware & Fixtures','Ventilation / Hood','Lighting','Plumbing','Labor & Installation','Delivery & Logistics','Other'];

function openBKQuoteEditor(currentUser, currentRole, existing, onSave) {
  let lines = existing ? JSON.parse(JSON.stringify(existing.lineItems||[])) : [{category:'Cabinets & Storage',description:'',qty:1,unit:'set',price:0}];

  const lineHTML = (l,i) => `
    <div class="bk-line-row" data-i="${i}" style="display:grid;grid-template-columns:130px 1fr 60px 60px 100px 34px;gap:5px;align-items:center;margin-bottom:6px">
      <select data-i="${i}" data-f="category" style="padding:5px 6px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:12px">
        ${BK_CATEGORIES.map(c=>`<option ${c===l.category?'selected':''}>${c}</option>`).join('')}
      </select>
      <input type="text" value="${escHtml(l.description||'')}" data-i="${i}" data-f="description" placeholder="Item description" style="padding:5px 8px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:13px;width:100%"/>
      <input type="number" value="${l.qty||1}" data-i="${i}" data-f="qty" min="1" style="padding:5px 6px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:13px;width:100%" inputmode="numeric"/>
      <select data-i="${i}" data-f="unit" style="padding:5px 4px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:11px">
        ${['pc','set','lm','sqm','hr','lot','unit'].map(u=>`<option ${u===l.unit?'selected':''}>${u}</option>`).join('')}
      </select>
      <input type="number" value="${l.price||0}" data-i="${i}" data-f="price" min="0" step="0.01" placeholder="Unit price" style="padding:5px 8px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:13px;width:100%" inputmode="decimal"/>
      <button class="btn-icon" data-rm="${i}" style="color:#ff453a;font-size:16px;padding:4px 7px">${emojiIcon('trash-2',16)}</button>
    </div>`;

  openPage(existing ? `Edit Quote BK-${existing.quoteNumber||''}` : '🍽️ New Barro Kitchens Quote', `
    <div class="form-row">
      <div class="form-group"><label>Client Name</label><input id="bkq-client" value="${escHtml(existing?.clientName||'')}"/></div>
      <div class="form-group"><label>Client Contact</label><input id="bkq-contact" value="${escHtml(existing?.clientContact||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Client Address</label><input id="bkq-address" value="${escHtml(existing?.clientAddress||'')}"/></div>
      <div class="form-group"><label>Scope of Work</label>
        <select id="bkq-scope" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          ${['One-Stop-Shop (Design • Fabricate • Install)','Supply & Install','Supply Only','Fabrication Only','Custom Quote'].map(s=>`<option ${s===(existing?.scope||'One-Stop-Shop (Design • Fabricate • Install)')?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Quote Date</label><input id="bkq-date" type="date" value="${existing?.date||today()}"/></div>
      <div class="form-group"><label>Valid Until</label><input id="bkq-valid" type="date" value="${existing?.validUntil||''}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:0 0 140px"><label>VAT</label>
        <select id="bkq-vat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="0" ${(existing?.vatRate||0)==0?'selected':''}>No VAT</option>
          <option value="12" ${(existing?.vatRate||0)==12?'selected':''}>12% VAT</option>
        </select>
      </div>
      <div class="form-group" style="flex:0 0 140px"><label>Discount (₱)</label>
        <input id="bkq-discount" type="number" min="0" value="${existing?.discount||0}" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)" inputmode="decimal"/>
      </div>
      <div class="form-group"><label>Status</label>
        <select id="bkq-status" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="draft" ${(existing?.status||'draft')==='draft'?'selected':''}>Draft</option>
          <option value="sent" ${existing?.status==='sent'?'selected':''}>Sent to Client</option>
          <option value="accepted" ${existing?.status==='accepted'?'selected':''}>Accepted</option>
          <option value="rejected" ${existing?.status==='rejected'?'selected':''}>Rejected</option>
        </select>
      </div>
    </div>
    <hr class="divider"/>
    <div class="table-wrap"><div style="min-width:420px">
    <div style="display:grid;grid-template-columns:130px 1fr 60px 60px 100px 34px;gap:5px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:var(--text-muted)">CATEGORY</div>
      <div style="font-size:11px;font-weight:700;color:var(--text-muted)">DESCRIPTION</div>
      <div style="font-size:11px;font-weight:700;color:var(--text-muted)">QTY</div>
      <div style="font-size:11px;font-weight:700;color:var(--text-muted)">UNIT</div>
      <div style="font-size:11px;font-weight:700;color:var(--text-muted)">UNIT PRICE</div>
      <div></div>
    </div>
    <div id="bkq-lines"></div>
    </div></div>
    <button class="btn-secondary btn-sm" id="bkq-add-line" style="margin-top:6px;margin-bottom:8px">+ Add Line</button>
    <div id="bkq-totals" class="quote-total" style="text-align:right;font-size:13px;line-height:1.8"></div>
    <hr class="divider"/>
    <div class="form-group"><label>Notes / Terms</label><textarea id="bkq-notes" rows="3" placeholder="Payment terms, delivery notes, etc.">${escHtml(existing?.notes||'')}</textarea></div>
  `, `
    <button class="btn-secondary" id="bkq-print-btn">🖨 Print / PDF</button>
    <button class="btn-primary" id="bkq-save-btn">💾 Save Quote</button>
    <button class="btn-secondary" onclick="closeModal()">Cancel</button>
  `);

  const calcTotals = () => {
    const sub = lines.reduce((s,l) => s + (parseFloat(l.qty)||0)*(parseFloat(l.price)||0), 0);
    const disc = parseFloat(document.getElementById('bkq-discount')?.value||0)||0;
    const vatRate = parseFloat(document.getElementById('bkq-vat')?.value||0)||0;
    const afterDisc = Math.max(sub - disc, 0);
    const vat = afterDisc * vatRate / 100;
    const grand = afterDisc + vat;
    const el = document.getElementById('bkq-totals');
    if (el) el.innerHTML = `
      <span>Subtotal: ₱${fmt(sub)}</span><br>
      ${disc>0?`<span>Discount: — ₱${fmt(disc)}</span><br>`:''}
      ${vatRate>0?`<span>VAT (${vatRate}%): ₱${fmt(vat)}</span><br>`:''}
      <strong style="font-size:16px">Total: ₱${fmt(grand)}</strong>`;
    return grand;
  };

  const renderLines = () => {
    const cont = document.getElementById('bkq-lines');
    if (!cont) return;
    cont.innerHTML = lines.map((l,i)=>lineHTML(l,i)).join('');
    if (window.lucide) lucide.createIcons({ nodes: [cont] });
    cont.querySelectorAll('input,select').forEach(inp => {
      inp.addEventListener('input', e => {
        const i=parseInt(e.target.dataset.i), f=e.target.dataset.f;
        if (!f||i===undefined||isNaN(i)) return;
        lines[i][f] = ['qty','price'].includes(f) ? (parseFloat(e.target.value)||0) : e.target.value;
        calcTotals();
      });
    });
    cont.querySelectorAll('[data-rm]').forEach(btn => {
      btn.onclick = () => { lines.splice(parseInt(btn.dataset.rm),1); renderLines(); };
    });
    calcTotals();
  };

  renderLines();
  document.getElementById('bkq-add-line').onclick = () => { lines.push({category:'Cabinets & Storage',description:'',qty:1,unit:'pc',price:0}); renderLines(); };
  document.getElementById('bkq-discount')?.addEventListener('input', calcTotals);
  document.getElementById('bkq-vat')?.addEventListener('change', calcTotals);

  document.getElementById('bkq-save-btn').onclick = async () => {
    const grand = calcTotals();
    const chosenStatus = document.getElementById('bkq-status')?.value;
    if (chosenStatus === 'accepted' && existing?.status !== 'accepted'
        && !(await confirmDialog({message:`Mark this quote as ACCEPTED (₱${fmt(grand)})? This signals the client has agreed.`}))) return;
    const sub    = lines.reduce((s,l)=>s+(parseFloat(l.qty)||0)*(parseFloat(l.price)||0),0);
    const disc   = parseFloat(document.getElementById('bkq-discount')?.value||0)||0;
    const vatRate= parseFloat(document.getElementById('bkq-vat')?.value||0)||0;
    const uSnap  = await db.collection('users').doc(currentUser.uid).get();
    const agentName = uSnap.exists ? uSnap.data().displayName : currentUser.email;
    const data = {
      clientName:    document.getElementById('bkq-client').value.trim(),
      clientContact: document.getElementById('bkq-contact').value.trim(),
      clientAddress: document.getElementById('bkq-address').value.trim(),
      scope:         document.getElementById('bkq-scope').value,
      date:          document.getElementById('bkq-date').value,
      validUntil:    document.getElementById('bkq-valid').value,
      vatRate,
      discount:      disc,
      subtotal:      sub,
      total:         grand,
      status:        document.getElementById('bkq-status').value,
      notes:         document.getElementById('bkq-notes').value.trim(),
      lineItems:     lines,
      agentName,     createdBy: currentUser.uid,
      brand:         'barro-kitchens',
      updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
    };
    if (existing) {
      await db.collection('bk_quotes').doc(existing.id).update(data);
      Notifs.showToast('Quote updated!');
    } else {
      // A collection-wide count is only readable by finance/admin (rules); for
      // other creators (e.g. agents) fall back to a collision-resistant
      // time-based suffix so the quote still saves instead of silently failing.
      let seq;
      try {
        const count = (await db.collection('bk_quotes').get()).size;
        seq = String(count+1).padStart(4,'0');
      } catch(e) {
        seq = String(Date.now()).slice(-4);
      }
      data.quoteNumber = `BK${String(window.bizYear ? window.bizYear() : new Date().getFullYear()).slice(-2)}${seq}`;
      data.createdAt   = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('bk_quotes').add(data);
      Notifs.showToast('BK Quote saved!');
    }
    closeModal();
    if (onSave) onSave();
  };

  document.getElementById('bkq-print-btn').onclick = () => printBKQuote(lines, {
    clientName:    document.getElementById('bkq-client').value,
    clientContact: document.getElementById('bkq-contact').value,
    clientAddress: document.getElementById('bkq-address').value,
    scope:         document.getElementById('bkq-scope').value,
    date:          document.getElementById('bkq-date').value,
    validUntil:    document.getElementById('bkq-valid').value,
    discount:      parseFloat(document.getElementById('bkq-discount')?.value||0),
    vatRate:       parseFloat(document.getElementById('bkq-vat')?.value||0),
    notes:         document.getElementById('bkq-notes').value,
    quoteNumber:   existing?.quoteNumber||'—'
  });
}

function printBKQuote(lines, q) {
  const sub   = lines.reduce((s,l)=>s+(parseFloat(l.qty)||0)*(parseFloat(l.price)||0),0);
  const disc  = q.discount||0;
  const vatR  = q.vatRate||0;
  const after = Math.max(sub-disc,0);
  const vat   = after*vatR/100;
  const grand = after+vat;
  const byCategory = {};
  lines.forEach(l => { if(!byCategory[l.category]) byCategory[l.category]=[]; byCategory[l.category].push(l); });

  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Barro Kitchens — Quote ${escHtml(q.quoteNumber)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;padding:36px;color:#222;background:#fff;font-size:13px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #c8a45a}
    .brand{font-size:22px;font-weight:900;color:#c8a45a;letter-spacing:-0.5px}
    .brand-sub{font-size:11px;color:#666;margin-top:2px}
    .q-info{text-align:right;font-size:12px;color:#555;line-height:1.6}
    .q-no{font-size:16px;font-weight:800;color:#222}
    .client-box{background:#f9f7f2;border:1px solid #e8d9b5;border-radius:8px;padding:12px 16px;margin-bottom:20px}
    .client-label{font-size:10px;font-weight:700;color:#c8a45a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
    .client-name{font-size:15px;font-weight:700}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}
    .cat-header td{background:#f9f7f2;font-size:11px;font-weight:700;color:#c8a45a;text-transform:uppercase;letter-spacing:0.5px;padding:8px 10px;border-top:1px solid #e8d9b5}
    th{background:#c8a45a;color:#fff;padding:8px 10px;text-align:left;font-size:11px}
    td{padding:7px 10px;border-bottom:1px solid #f0ebe0;vertical-align:top}
    .text-right{text-align:right}
    .totals{width:280px;margin-left:auto;border:1px solid #e8d9b5;border-radius:8px;overflow:hidden}
    .totals td{padding:6px 14px;border-bottom:1px solid #f0ebe0;font-size:12px}
    .totals .grand td{background:#c8a45a;color:#fff;font-weight:800;font-size:14px;border:none}
    .notes{margin-top:20px;font-size:11px;color:#666;border-top:1px solid #eee;padding-top:12px}
    .footer{margin-top:28px;font-size:10px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:10px}
  </style>
  </head><body>
  <div class="header">
    <div>
      <div class="brand">🍽️ Barro Kitchens</div>
      <div class="brand-sub">A Trademark of Barro Industries OPC</div>
      <div class="brand-sub">One-stop kitchen design & build solution</div>
    </div>
    <div class="q-info">
      <div class="q-no">Quote ${escHtml(q.quoteNumber)}</div>
      <div>Date: ${escHtml(q.date)}</div>
      <div>Valid Until: ${escHtml(q.validUntil||'—')}</div>
      ${q.scope&&q.scope!=='Custom Quote'?`<div>Scope: <strong>${escHtml(q.scope)}</strong></div>`:''}
    </div>
  </div>
  <div class="client-box">
    <div class="client-label">Quote For</div>
    <div class="client-name">${escHtml(q.clientName||'—')}</div>
    ${q.clientContact?`<div style="font-size:12px;margin-top:2px;color:#555">${escHtml(q.clientContact)}</div>`:''}
    ${q.clientAddress?`<div style="font-size:12px;margin-top:2px;color:#555">📍 ${escHtml(q.clientAddress)}</div>`:''}
  </div>
  <table>
    <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th class="text-right">Unit Price</th><th class="text-right">Amount</th></tr></thead>
    <tbody>
    ${Object.entries(byCategory).map(([cat,catLines])=>`
      <tr class="cat-header"><td colspan="5">${cat}</td></tr>
      ${catLines.map(l=>`<tr>
        <td>${escHtml(l.description||'—')}</td>
        <td>${l.qty}</td>
        <td>${escHtml(l.unit||'pc')}</td>
        <td class="text-right">₱${fmt(l.price)}</td>
        <td class="text-right">₱${fmt((parseFloat(l.qty)||0)*(parseFloat(l.price)||0))}</td>
      </tr>`).join('')}
    `).join('')}
    </tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td class="text-right">₱${fmt(sub)}</td></tr>
    ${disc>0?`<tr><td>Discount</td><td class="text-right">— ₱${fmt(disc)}</td></tr>`:''}
    ${vatR>0?`<tr><td>VAT (${vatR}%)</td><td class="text-right">₱${fmt(after*vatR/100)}</td></tr>`:''}
    <tr class="grand"><td>TOTAL</td><td class="text-right">₱${fmt(grand)}</td></tr>
  </table>
  ${q.notes?`<div class="notes"><strong>Notes / Terms:</strong><br>${escHtml(q.notes)}</div>`:''}
  <div class="footer">Barro Kitchens · Barro Industries OPC · This quotation is valid until ${q.validUntil||'the stated date'}</div>
  <script>window.print();<\/script></body></html>`);
}

// ── BK Quotations Summary ────────────────────────
// Group quotes into revision lineages — base quote number (sans the -Rn suffix)
// + client — and keep only the LATEST revision of each. Returns the deduped
// `latest` array + a Set of superseded (older-revision) ids, so KPI totals stop
// double-counting R1 + R2 + … of the same quote.
window.latestQuoteRevisions = function(quotes){
  const revOf = q => { const m=String(q.quoteNumber||q.editableState?.quoteNo||'').match(/-R(\d+)\s*$/i); return m?parseInt(m[1],10):1; };
  const lineageOf = q => {
    const base = String(q.quoteNumber||q.editableState?.quoteNo||'').replace(/-R\d+\s*$/i,'').trim();
    const client = (q.clientName||'').trim().toLowerCase();
    return base ? (base+'||'+client) : ('id::'+q.id);   // unnumbered → its own lineage (no dedup)
  };
  const best = new Map();
  (quotes||[]).forEach(q => {
    const k = lineageOf(q), cur = best.get(k);
    const better = !cur || revOf(q) > revOf(cur) ||
      (revOf(q)===revOf(cur) && (q.createdAt?.seconds||0) >= (cur.createdAt?.seconds||0));
    if (better) best.set(k, q);
  });
  const latest = [...best.values()];
  const keep = new Set(latest.map(q=>q.id));
  const supersededIds = new Set((quotes||[]).filter(q=>!keep.has(q.id)).map(q=>q.id));
  return { latest, supersededIds };
};

async function renderBKQuotationsSummary(container, currentUser, currentRole) {
  const isPrivileged = ['president','manager','finance'].includes(currentRole);
  const isAdmin = ['president','manager','secretary'].includes(currentRole);
  container.innerHTML = '<div class="loading-placeholder">Loading…</div>';
  const q = isPrivileged
    ? db.collection('bk_quotes').orderBy('createdAt','desc')
    : db.collection('bk_quotes').where('createdBy','==',currentUser.uid).orderBy('createdAt','desc');
  const snap = await q.get().catch(()=>({docs:[]}));
  const quotes = snap.docs.map(d=>({id:d.id,...d.data()}));

  // KPI totals count only the LATEST revision of each quote — older revisions
  // (R1 when an R2 exists) are superseded and must not inflate the value/counts.
  const { latest: activeQuotes, supersededIds } = window.latestQuoteRevisions(quotes);
  const total      = activeQuotes.reduce((s,q)=>s+(q.total||0),0);
  const accepted   = activeQuotes.filter(q=>q.status==='accepted');
  const acceptedT  = accepted.reduce((s,q)=>s+(q.total||0),0);
  const sent       = activeQuotes.filter(q=>q.status==='sent').length;
  const draft      = activeQuotes.filter(q=>q.status==='draft').length;

  // Single quote card — reused by both the flat list and the by-customer view.
  const quoteCard = (q) => {
    const superseded = supersededIds.has(q.id);
    const wonish = !superseded && ['filed','accepted','won','approved'].includes(q.status);
    const canDel = isAdmin || currentRole==='finance' || q.createdBy===currentUser.uid;
    const label  = `BK quote ${q.quoteNumber||q.id.slice(-6).toUpperCase()} (${q.clientName||'Unnamed'})`;
    return `
      <div class="item-card" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap${superseded?';opacity:.6':''}">
        <div style="flex:1;min-width:160px">
          <div class="item-title" style="font-size:13px">BK-${q.quoteNumber||q.id.slice(-6).toUpperCase()} — ${escHtml(q.clientName||'Unnamed')}${superseded?' <span class="badge badge-gray" style="font-size:9px">superseded</span>':''}</div>
          <div class="item-meta" style="margin-top:4px">
            <span>${escHtml(q.scope||'Custom')}</span>
            <span>${escHtml(q.agentName||'—')}</span>
            ${q.date?`<span>${q.date}</span>`:''}
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700${superseded?';text-decoration:line-through;color:var(--text-muted)':''}">₱${fmt(q.total||0)}</div>
          <span class="badge ${statusBadge(q.status)}" style="margin-top:4px">${q.salesOrderId?'won':q.status||'draft'}</span>
          ${q.deleteRequested?`<span class="badge badge-red" style="font-size:10px;margin-left:4px">🗑 del req</span>`:''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;width:100%;justify-content:flex-end">
          ${q.editableState?`<button class="btn-secondary btn-sm bk-reopen-btn" data-id="${q.id}">↻ Reopen</button>`:''}
          ${q.editableState?`<button class="btn-secondary btn-sm bk-rev-btn" data-id="${q.id}" title="Start a new revision (R2, R3…) for this client with today's date">⎘ New Revision</button>`:''}
          ${wonish?`<button class="btn-success btn-sm bk-so-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" data-client="${escHtml(q.clientName||'')}" data-total="${q.total||0}" data-co="BK" ${q.salesOrderId?'disabled':''}>${q.salesOrderId?'✓ Ordered':'🧾 Sales Order'}</button>`:''}
          ${(canDel && !q.deleteRequested)?`<button class="btn-secondary btn-sm bk-del-btn" data-id="${q.id}" data-label="${escHtml(label)}" data-by="${q.createdBy||''}">🗑 Delete</button>`:''}
        </div>
      </div>`;
  };

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-card"><div class="stat-num">${activeQuotes.length}</div><div class="stat-label">Total Quotes${supersededIds.size?` <span style="font-size:9px;color:var(--text-muted)">(+${supersededIds.size} rev)</span>`:''}</div></div>
      <div class="stat-card"><div class="stat-num">₱${fmt(total)}</div><div class="stat-label">Quote Value</div></div>
      <div class="stat-card"><div class="stat-num">${accepted.length}</div><div class="stat-label">Accepted</div></div>
      <div class="stat-card"><div class="stat-num">₱${fmt(acceptedT)}</div><div class="stat-label">Accepted Value</div></div>
      <div class="stat-card"><div class="stat-num">${sent}</div><div class="stat-label">Sent</div></div>
      <div class="stat-card"><div class="stat-num">${draft}</div><div class="stat-label">Drafts</div></div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <h4 style="font-weight:700;margin:0">All Quotations</h4>
      ${window.chipTabs([{key:'list',label:'List'},{key:'customer',label:'By Customer'}],'list',{cls:'bkq-view'})}
    </div>
    <div id="bkq-body"></div>
  `;

  const bindCardActions = () => {
    container.querySelectorAll('.bk-so-btn').forEach(b=>b.addEventListener('click', e=>openSalesOrderModal(e.currentTarget.dataset, currentUser, currentRole, container)));
    container.querySelectorAll('.bk-reopen-btn').forEach(b=>b.addEventListener('click', async e=>{
      try { const s=await db.collection('bk_quotes').doc(e.currentTarget.dataset.id).get(); const qq=s.data()||{};
        if(!qq.editableState){ Notifs.showToast('No editable snapshot','error'); return; }
        window._qbReopenState=qq.editableState; navigateTo('bk-quote-builder');
      } catch(ex){ Notifs.showToast('Reopen failed','error'); }
    }));
    container.querySelectorAll('.bk-rev-btn').forEach(b=>b.addEventListener('click', e=>
      window.newRevisionFromDoc('bk_quotes', e.currentTarget.dataset.id, 'bk-quote-builder')));
    container.querySelectorAll('.bk-del-btn').forEach(b=>b.addEventListener('click', e=>{
      const d=e.currentTarget.dataset;
      window.requestQuoteDelete('bk_quotes', d.id, d.label, d.by, ()=>renderBKQuotationsSummary(container, currentUser, currentRole));
    }));
  };

  const renderBody = (view) => {
    const body = container.querySelector('#bkq-body');
    if (!body) return;
    if (!quotes.length) { body.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><h4>No quotations yet</h4></div>`; return; }
    if (view === 'customer') {
      const groups = {};
      quotes.forEach(q=>{ const k=((q.clientName||'').trim())||'Unnamed'; (groups[k]=groups[k]||[]).push(q); });
      body.innerHTML = Object.keys(groups).sort((a,b)=>a.localeCompare(b)).map(name=>{
        const gq=groups[name];
        // Customer total = latest revisions only (superseded ones don't add up).
        const active=gq.filter(x=>!supersededIds.has(x.id)); const gt=active.reduce((s,x)=>s+(x.total||0),0);
        return `<details open style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:8px 12px;margin-bottom:10px">
          <summary style="cursor:pointer;font-weight:700;font-size:13px;display:flex;align-items:center;gap:8px">
            <span style="flex:1">${escHtml(name)} <span class="badge badge-gray" style="font-size:10px">${active.length}${gq.length!==active.length?` +${gq.length-active.length}`:''}</span></span>
            <span style="font-weight:700;color:var(--text-muted)">₱${fmt(gt)}</span>
          </summary>
          <div class="item-list" style="margin-top:8px">${gq.map(quoteCard).join('')}</div>
        </details>`;
      }).join('');
    } else {
      body.innerHTML = `<div class="item-list">${quotes.map(quoteCard).join('')}</div>`;
    }
    bindCardActions();
  };

  window.bindChipTabs(container.querySelector('.bkq-view'), (key)=>renderBody(key));
  renderBody('list');
}

// ── Partner Quotes (read-only window into Brilliant Steel quotes) ──
// One-way visibility: internal Sales can see partner quotes; partners never see
// Barro Kitchens quotes. Backed by the bs_quotes read rule (non-partner staff).
async function renderSalesPartnerQuotes(container, currentUser, currentRole) {
  container.innerHTML = '<div class="loading-placeholder">Loading partner quotes…</div>';
  const snap = await db.collection('bs_quotes').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
  const quotes = snap.docs.map(d=>({id:d.id,...d.data()}));
  const total = quotes.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
  const accepted = quotes.filter(q=>['accepted','filed','approved'].includes(q.status));
  container.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);background:rgba(10,132,255,.07);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:14px">
      🤝 Read-only view of <strong>Brilliant Steel</strong> partner quotes (50/50 collaborative projects). Sales can see these for coordination; partners cannot see Barro Kitchens quotes.
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-card"><div class="stat-num">${quotes.length}</div><div class="stat-label">Partner Quotes</div></div>
      <div class="stat-card"><div class="stat-num">₱${fmt(total)}</div><div class="stat-label">Total Value</div></div>
      <div class="stat-card"><div class="stat-num">${accepted.length}</div><div class="stat-label">Accepted / Filed</div></div>
    </div>
    <div class="item-list">
      ${!quotes.length
        ? `<div class="empty-state"><div class="empty-icon">📋</div><h4>No partner quotes yet</h4><p>Brilliant Steel quotes will appear here as they're created.</p></div>`
        : quotes.map(q=>`
        <div class="item-card" style="display:flex;align-items:center;gap:12px">
          <div style="flex:1;min-width:0">
            <div class="item-title" style="font-size:13px">${escHtml(q.quoteNumber||q.id.slice(-6).toUpperCase())} — ${escHtml(q.clientName||'Unnamed')}</div>
            <div class="item-meta" style="margin-top:4px">
              <span>👤 ${escHtml(q.createdByName||q.agentName||'Partner')}</span>
              ${q.date?`<span>${escHtml(q.date)}</span>`:''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-weight:700">₱${fmt(q.total||q.grandTotal||0)}</div>
            <span class="badge ${statusBadge(q.status)}" style="margin-top:4px">${escHtml(q.status||'draft')}</span>
          </div>
        </div>`).join('')}
    </div>`;
}

// ── BK Package Presets ───────────────────────────
const BK_PACKAGES = [
  {
    name: '🥉 Basic Kitchen Package',
    desc: 'Standard kitchen setup for small kitchens up to 8 sqm',
    color: '#cd7f32',
    items: [
      {category:'Cabinets & Storage',description:'Base cabinets (melamine board)',qty:1,unit:'set',price:45000},
      {category:'Cabinets & Storage',description:'Wall cabinets (melamine board)',qty:1,unit:'set',price:30000},
      {category:'Countertops',description:'Granite countertop 2cm',qty:5,unit:'lm',price:3500},
      {category:'Hardware & Fixtures',description:'Cabinet handles (stainless)',qty:1,unit:'set',price:4500},
      {category:'Labor & Installation',description:'Installation & carpentry works',qty:1,unit:'lot',price:25000},
    ]
  },
  {
    name: '🥈 Standard Kitchen Package',
    desc: 'Full kitchen for 10-15 sqm, includes sink & hood',
    color: '#aaa',
    items: [
      {category:'Cabinets & Storage',description:'Base cabinets (18mm plywood + PVC)',qty:1,unit:'set',price:75000},
      {category:'Cabinets & Storage',description:'Wall cabinets + island',qty:1,unit:'set',price:55000},
      {category:'Countertops',description:'Engineered quartz countertop',qty:7,unit:'lm',price:5500},
      {category:'Backsplash & Tiles',description:'Subway tile backsplash',qty:8,unit:'sqm',price:2200},
      {category:'Appliances',description:'Kitchen sink (double bowl SS)',qty:1,unit:'pc',price:8500},
      {category:'Ventilation / Hood',description:'Chimney range hood 90cm',qty:1,unit:'unit',price:18000},
      {category:'Hardware & Fixtures',description:'Premium hardware set',qty:1,unit:'set',price:9500},
      {category:'Labor & Installation',description:'Full installation & leveling',qty:1,unit:'lot',price:40000},
    ]
  },
  {
    name: '🥇 Premium Kitchen Package',
    desc: 'High-end kitchen with imported materials, full appliances',
    color: '#c8a45a',
    items: [
      {category:'Cabinets & Storage',description:'Custom solid wood base cabinets',qty:1,unit:'set',price:150000},
      {category:'Cabinets & Storage',description:'Overhead cabinets + tall pantry',qty:1,unit:'set',price:95000},
      {category:'Countertops',description:'Calacatta marble countertop',qty:8,unit:'lm',price:12000},
      {category:'Backsplash & Tiles',description:'Large format porcelain tiles',qty:10,unit:'sqm',price:3800},
      {category:'Appliances',description:'Farmhouse sink (fireclay)',qty:1,unit:'pc',price:28000},
      {category:'Appliances',description:'Built-in dishwasher (60cm)',qty:1,unit:'unit',price:45000},
      {category:'Ventilation / Hood',description:'Island range hood (designer)',qty:1,unit:'unit',price:55000},
      {category:'Hardware & Fixtures',description:'Soft-close premium hardware',qty:1,unit:'set',price:22000},
      {category:'Lighting',description:'LED under-cabinet lighting strip',qty:1,unit:'lot',price:12000},
      {category:'Labor & Installation',description:'Full premium installation',qty:1,unit:'lot',price:80000},
    ]
  }
];

function renderBKPackages(container, currentUser, currentRole) {
  container.innerHTML = `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Click any package to create a pre-filled BK quote. You can edit all items after.</p>
    <div style="display:flex;flex-direction:column;gap:16px">
      ${BK_PACKAGES.map((pkg,i)=>`
        <div class="item-card" style="border-left:4px solid ${pkg.color};padding:14px 16px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
            <div>
              <div style="font-weight:700;font-size:15px">${pkg.name}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${pkg.desc}</div>
            </div>
            <button class="btn-primary btn-sm use-pkg-btn" data-pkg="${i}" style="margin-left:12px;white-space:nowrap">Use Package</button>
          </div>
          <div style="font-size:12px;color:var(--text-muted)">
            <strong>Estimated total:</strong> ₱${fmt(pkg.items.reduce((s,l)=>s+l.qty*l.price,0))}
          </div>
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
            ${pkg.items.map(l=>`<span style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:11px">${l.category}</span>`).join('')}
          </div>
        </div>`).join('')}
    </div>
  `;
  container.querySelectorAll('.use-pkg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pkg = BK_PACKAGES[parseInt(btn.dataset.pkg)];
      // We need currentUser/currentRole — grab from outer scope
      openBKQuoteEditor(
        currentUser,
        currentRole,
        { scope: pkg.name.replace(/^[^\s]+ /,''), lineItems: pkg.items.map(i=>({...i})) },
        () => { Notifs.showToast('Quote created from package!'); }
      );
    });
  });
}

// ══════════════════════════════════════════════════
//  DESIGN DEPARTMENT
// ══════════════════════════════════════════════════
window.renderDesign = async function(currentUser, currentRole, subtab = 'Projects') {
  const c = deptContainer();
  c.innerHTML = `
    <div class="page-header"><h2>🎨 Design</h2></div>
    ${window.sopPanel('How Design works', [
      'Projects tracks each design job; Drawings holds the working files.',
      'Clients keeps the design client book; Product Designs and References are the asset libraries.',
      'Tasks is the department board for design work in progress.'
    ])}
    ${window.chipTabs(['Projects','Drawings','Clients','Product Designs','References','Tasks'].map(s=>({key:s,label:s})), subtab)}
    <div id="design-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadDesignContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => loadDesignContent(currentUser, currentRole, key));
};

async function loadDesignContent(currentUser, currentRole, sub) {
  const content = document.getElementById('design-content');
  switch(sub) {
    case 'Projects':    await renderProjects(content, currentUser, currentRole); break;
    case 'Drawings':    await renderDrawingsDashboard(content, currentUser, currentRole); break;
    case 'Clients':     await renderClientProfiles(content, currentUser, currentRole, 'design'); break;
    case 'Product Designs':
      content.innerHTML = renderFileCollection('Product Designs', 'design-files', currentRole);
      bindFileCollection('design-files', currentUser, 'Design', 'Product Designs');
      break;
    case 'References':
      content.innerHTML = renderFileCollection('Reference Files', 'design-refs', currentRole);
      bindFileCollection('design-refs', currentUser, 'Design', 'References');
      break;
    case 'Tasks':
      await renderDeptTasks(content, 'Design', currentUser, currentRole);
      break;
  }
}

// Sum of recorded payments on a project.
function projectPaid(p) {
  return (p.payments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

async function renderProjects(container, currentUser, currentRole) {
  const snap = await db.collection('projects').orderBy('createdAt','desc').get().catch(()=>({docs:[],empty:true}));
  const projects = snap.docs.map(d => ({id:d.id,...d.data()}));
  const canAdd = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager';
  const canBill = ['president','owner','manager','finance'].includes(currentRole) || canEditDept('Finance');

  container.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      ${canAdd?`<button class="btn-primary btn-sm" id="add-project-btn">+ New Project</button>`:''}
    </div>
    <div class="item-list">
      ${!projects.length
        ? `<div class="empty-state"><div class="empty-icon">🎨</div><h4>No projects yet</h4></div>`
        : projects.map(p => {
          const contract = Number(p.contractAmount) || 0;
          const paid     = projectPaid(p);
          const balance  = contract - paid;
          return `
          <div class="item-card" data-id="${p.id}" style="cursor:pointer">
            <div class="item-top">
              <div class="item-title">${escHtml(p.name)}</div>
              <span class="badge ${statusBadge(p.status)}">${p.status||'active'}</span>
            </div>
            <div class="item-meta">
              ${p.client?`<span>👤 ${escHtml(p.client)}</span>`:''}
              ${p.dueDate?`<span>📅 ${p.dueDate}</span>`:''}
            </div>
            ${contract>0?`<div class="item-meta" style="margin-top:6px">
              <span>💰 Contract ₱${fmt(contract)}</span>
              <span>✅ Paid ₱${fmt(paid)}</span>
              <span style="font-weight:700;color:${balance>0.005?'#FF453A':'#30D158'}">${balance>0.005?`Balance ₱${fmt(balance)}`:'Fully Paid'}</span>
            </div>`:''}
          </div>`;}).join('')}
    </div>
  `;

  container.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => {
      const p = projects.find(x => x.id === card.dataset.id);
      if (p) openProjectDetail(p, currentUser, currentRole, canBill);
    });
  });

  document.getElementById('add-project-btn')?.addEventListener('click', () => {
    openPage('New Project', `
      <div class="form-group"><label>Project Name</label><input id="proj-name" placeholder="e.g. Kitchen Design — ABC Corp"/></div>
      <div class="form-group"><label>Client</label><input id="proj-client" placeholder="Client name"/></div>
      <div class="form-row">
        <div class="form-group"><label>Start Date</label><input id="proj-start" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Due Date</label><input id="proj-due" type="date"/></div>
      </div>
      <div class="form-group"><label>Contract Amount (₱)</label><input id="proj-contract" type="number" step="0.01" min="0" placeholder="Total project value (optional)" inputmode="decimal"/></div>
      <div class="form-group"><label>Notes</label><textarea id="proj-notes" rows="3"></textarea></div>
    `, `<button class="btn-primary" id="save-proj-btn">Save Project</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('save-proj-btn').addEventListener('click', async () => {
      await db.collection('projects').add({
        name:           document.getElementById('proj-name').value.trim(),
        client:         document.getElementById('proj-client').value.trim(),
        startDate:      document.getElementById('proj-start').value,
        dueDate:        document.getElementById('proj-due').value,
        contractAmount: parseFloat(document.getElementById('proj-contract').value) || 0,
        notes:          document.getElementById('proj-notes').value.trim(),
        status:         'active',
        createdBy:      currentUser.uid,
        createdAt:      firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); renderDesign(currentUser, currentRole, 'Projects');
    });
  });
}

// ══════════════════════════════════════════════════
//  DESIGN — drawings (DWG/PDF/2D/3D) with revision control
// ══════════════════════════════════════════════════
const DRAWING_TYPES = ['DWG','PDF','Drawing','3D','Render'];
const DRAWING_STATUSES = [
  { id:'draft',      label:'Draft',      badge:'badge-gray'   },
  { id:'for_review', label:'For Review', badge:'badge-orange' },
  { id:'approved',   label:'Approved',   badge:'badge-blue'   },
  { id:'released',   label:'Released',   badge:'badge-green'  },
  { id:'superseded', label:'Superseded', badge:'badge-gray'   },
];
function drawingStatus(id){ return DRAWING_STATUSES.find(s=>s.id===id) || DRAWING_STATUSES[0]; }
function nextRev(letter){ return letter ? String.fromCharCode((''+letter).toUpperCase().charCodeAt(0)+1) : 'A'; }
function drawingTypeIcon(t){ return ({DWG:'📐',PDF:'📄',Drawing:'✏️','3D':'🧊',Render:'🖼'})[t] || '📄'; }
// Forward status transitions offered in the drawing detail (manager-gated).
function drawingTransitions(status){
  switch(status){
    case 'draft':      return [{to:'for_review',label:'Submit for Review',cls:'btn-primary'}];
    case 'for_review': return [{to:'approved',label:'✅ Approve',cls:'btn-success'},{to:'draft',label:'Back to Draft',cls:'btn-secondary'}];
    case 'approved':   return [{to:'released',label:'🚀 Release',cls:'btn-success'},{to:'for_review',label:'Back to Review',cls:'btn-secondary'}];
    case 'released':   return [{to:'superseded',label:'Supersede',cls:'btn-secondary'}];
    case 'superseded': return [{to:'draft',label:'Reactivate',cls:'btn-secondary'}];
    default:           return [];
  }
}
function drawingCard(d){
  const st = drawingStatus(d.status);
  return `<div class="item-card" data-dwg="${d.id}" style="cursor:pointer">
    <div class="item-top">
      <div class="item-title">${drawingTypeIcon(d.type)} ${escHtml(d.title||'Untitled')}${d.drawingNo?` <span style="font-size:11px;color:var(--text-muted)">${escHtml(d.drawingNo)}</span>`:''}</div>
      <div class="item-badges"><span class="badge badge-gray">Rev ${escHtml(d.currentRev||'A')}</span><span class="badge ${st.badge}">${st.label}</span></div>
    </div>
    <div class="item-meta" style="gap:6px;flex-wrap:wrap">
      <span>${escHtml(d.type||'File')}</span>
      ${d.projectName?`<span>🗂 ${escHtml(d.projectName)}</span>`:''}
      ${d.assignedToName?`<span>👤 ${escHtml(d.assignedToName)}</span>`:''}
      ${d.fileName?`<span>📎 ${escHtml(d.fileName)}</span>`:''}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════
//  Project detail — tabbed hub (Overview / Drawings / Tasks / Financials / Activity)
//  Same global name + signature as before (renderProjects calls it with 4 args);
//  the optional 5th arg lets sub-modals re-open onto a specific tab.
//  NOTE: deliberately distinct from openJobProjectDetail (job_projects lifecycle).
// ══════════════════════════════════════════════════
window.openProjectDetail = function(p, currentUser, currentRole, canBill, initialTab) {
  initialTab = initialTab || 'Overview';
  const tabs = ['Overview','Drawings','Tasks','Financials','Activity'];
  openModal(escHtml(p.name||'Project'), `
    <div class="item-meta" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <span class="badge ${statusBadge(p.status)}">${escHtml(p.status||'active')}</span>
      ${p.client?`<span>👤 ${escHtml(p.client)}</span>`:''}
      ${p.dueDate?`<span>📅 Due ${escHtml(p.dueDate)}</span>`:''}
      ${p.jobProjectNo?`<span class="badge badge-blue" title="Linked job project">🔗 ${escHtml(p.jobProjectNo)}</span>`:''}
    </div>
    <div class="subtab-bar" id="pd-tabs" style="margin-bottom:12px">
      ${tabs.map(t=>`<button class="subtab-btn ${t===initialTab?'active':''}" data-pd="${t}">${t}</button>`).join('')}
    </div>
    <div id="pd-tab-body"><div class="loading-placeholder">Loading…</div></div>
  `, `<button class="btn-secondary" onclick="closeModal()">Close</button>`);

  const showTab = (t) => {
    document.querySelectorAll('#pd-tabs .subtab-btn').forEach(b=>b.classList.toggle('active', b.dataset.pd===t));
    const host = document.getElementById('pd-tab-body');
    if (!host) return;
    if      (t==='Overview')   renderProjOverview(host, p, currentUser, currentRole, canBill);
    else if (t==='Drawings')   renderProjectDrawings(host, p, currentUser, currentRole, canBill);
    else if (t==='Tasks')      renderProjectTasks(host, p, currentUser, currentRole, canBill);
    else if (t==='Financials') renderProjFinancials(host, p, currentUser, currentRole, canBill);
    else if (t==='Activity')   renderProjActivity(host, p, currentUser, currentRole);
  };
  document.querySelectorAll('#pd-tabs .subtab-btn').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.pd)));
  showTab(initialTab);
};

// ── Overview tab ──
function renderProjOverview(host, p, currentUser, currentRole, canBill){
  const canManage = canEditDept('Design');
  const team = p.teamNames || [];
  host.innerHTML = `
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:12px 14px;font-size:13px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px">
      <span style="color:var(--text-muted)">Client</span><span>${p.client?escHtml(p.client):'<span style="color:var(--text-muted)">—</span>'}</span>
      <span style="color:var(--text-muted)">Status</span><span><span class="badge ${statusBadge(p.status)}">${escHtml(p.status||'active')}</span></span>
      <span style="color:var(--text-muted)">Start</span><span>${escHtml(p.startDate||'—')}</span>
      <span style="color:var(--text-muted)">Due</span><span>${escHtml(p.dueDate||'—')}</span>
      <span style="color:var(--text-muted)">Design Lead</span><span>${p.designLeadName?escHtml(p.designLeadName):'<span style="color:var(--text-muted)">Unassigned</span>'}</span>
      <span style="color:var(--text-muted)">Job Project</span><span>${p.jobProjectNo?`<span class="badge badge-blue">🔗 ${escHtml(p.jobProjectNo)}</span>`:'<span style="color:var(--text-muted)">Not linked</span>'}</span>
    </div></div>
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:12px 14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">👥 Team</div>
      ${team.length?`<div style="display:flex;gap:6px;flex-wrap:wrap">${team.map(n=>`<span class="badge badge-blue">${escHtml(n)}</span>`).join('')}</div>`:'<div style="font-size:12px;color:var(--text-muted)">No members delegated yet.</div>'}
    </div></div>
    ${p.notes?`<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:12px 14px;font-size:13px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">📝 Notes</div>${escHtml(p.notes)}</div></div>`:''}
    ${canManage?`<button class="btn-primary btn-sm" id="proj-edit-btn">✏️ Edit / Link / Delegate</button>`:''}
  `;
  document.getElementById('proj-edit-btn')?.addEventListener('click',()=>openProjectEditModal(p, currentUser, currentRole, canBill));
}

// ── Financials tab (logic lifted verbatim from the original project detail) ──
function renderProjFinancials(host, p, currentUser, currentRole, canBill){
  const contract = Number(p.contractAmount) || 0;
  const paid     = projectPaid(p);
  const balance  = contract - paid;
  const payments = (p.payments || []).slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const invoices = (p.invoices || []).slice().reverse();
  const reopen   = () => openProjectDetail(p, currentUser, currentRole, canBill, 'Financials');

  host.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${canBill && contract>0 ? `<button class="btn-primary btn-sm" id="proj-invoice-btn">🧾 Create Billing Invoice</button>` : ''}
      ${canBill ? `<button class="btn-secondary btn-sm" id="proj-payment-btn">+ Record Payment</button>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div class="kpi-card"><div class="kpi-label">Contract</div><div class="kpi-value" style="font-size:15px">₱${fmt(contract)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Paid</div><div class="kpi-value" style="font-size:15px;color:#30D158">₱${fmt(paid)}</div></div>
      <div class="kpi-card ${balance>0.005?'warn':''}"><div class="kpi-label">Balance</div><div class="kpi-value" style="font-size:15px;color:${balance>0.005?'#FF453A':'#30D158'}">₱${fmt(balance)}</div></div>
    </div>
    <h4 style="margin:0 0 8px;font-size:13px">Payments</h4>
    ${payments.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Method</th><th>Note</th><th style="text-align:right">Amount</th></tr></thead><tbody>
      ${payments.map(x=>`<tr><td>${escHtml(x.date||'')}</td><td>${escHtml(x.method||'—')}</td><td>${escHtml(x.note||'')}</td><td style="text-align:right">₱${fmt(x.amount)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">No payments recorded yet.</div>`}
    <h4 style="margin:16px 0 8px;font-size:13px">Billing Invoices</h4>
    ${invoices.length ? `<div class="item-list">${invoices.map(inv=>`
      <div class="item-card" style="cursor:pointer" data-inv="${escHtml(inv.no)}">
        <div class="item-top"><div class="item-title" style="font-size:13px">🧾 ${escHtml(inv.no)}</div><span>₱${fmt(inv.amount)}</span></div>
        <div class="item-meta"><span>📅 ${escHtml(inv.date||'')}</span>${inv.due?`<span>Due ${escHtml(inv.due)}</span>`:''}<span>${escHtml(inv.desc||'')}</span></div>
      </div>`).join('')}</div>` : `<div style="font-size:12px;color:var(--text-muted)">No invoices issued yet.</div>`}
  `;

  // Re-open a previously issued invoice (printable)
  host.querySelectorAll('.item-card[data-inv]').forEach(card => {
    card.addEventListener('click', () => {
      const inv = (p.invoices || []).find(i => i.no === card.dataset.inv);
      if (inv) openBillingInvoice(p, inv);
    });
  });

  // Record a payment
  document.getElementById('proj-payment-btn')?.addEventListener('click', () => {
    openPage('Record Payment', `
      <div class="form-group"><label>Amount (₱)</label><input id="pay-amt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"/></div>
      <div class="form-group"><label>Date</label><input id="pay-date" type="date" value="${today()}"/></div>
      <div class="form-group"><label>Method</label><input id="pay-method" placeholder="e.g. Bank transfer, Cash, Cheque"/></div>
      <div class="form-group"><label>Reference / Note</label><input id="pay-note" placeholder="OR no., remarks"/></div>
    `, `<button class="btn-primary" id="save-pay-btn">Save Payment</button><button class="btn-secondary" id="pay-back-btn">Cancel</button>`);
    document.getElementById('pay-back-btn').addEventListener('click', reopen);
    document.getElementById('save-pay-btn').addEventListener('click', async () => {
      const amt = parseFloat(document.getElementById('pay-amt').value) || 0;
      if (amt <= 0) { Notifs.showToast('Enter a valid amount','error'); return; }
      const payment = {
        amount: amt,
        date:   document.getElementById('pay-date').value || today(),
        method: document.getElementById('pay-method').value.trim(),
        note:   document.getElementById('pay-note').value.trim(),
        byName: currentUser.displayName || currentUser.email || '',
        by:     currentUser.uid
      };
      if (!(await confirmDialog({message:`Record payment of ₱${fmt(amt)} for "${escHtml(p.name)}"? This updates the project balance.`, html:true}))) return;
      try {
        const ref = db.collection('projects').doc(p.id);
        const saved = await db.runTransaction(async tx => {
          const doc  = await tx.get(ref);
          const cur  = (doc.exists && Array.isArray(doc.data().payments)) ? doc.data().payments : [];
          const next = [...cur, payment];
          tx.update(ref, { payments: next });
          return next;
        });
        p.payments = saved;
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
        // Post the income to the Finance ledger so Design collections aren't invisible
        // to the books. Best-effort: if the biller is a non-finance Design member who
        // can't write the ledger (rules), the payment is still recorded on the project.
        try {
          // Checked first (v12 WS12) so a closed-period block shows its own clear
          // toast rather than being silently absorbed by this catch the same way
          // a permission-denied failure is today.
          await window.assertPeriodOpen(payment.date);
          const vatRate = 12, net = +(amt/(1+vatRate/100)).toFixed(2), vatAmount = +(amt-net).toFixed(2);
          // Deterministic ref (project id + payment index) → idempotent on retry/backfill.
          const dref = `DPROJ-${p.id}-${Math.max(0, saved.length - 1)}`;
          const dDupe = await db.collection('ledger').where('refNumber','==',dref).limit(1).get().catch(()=>({empty:true}));
          if (dDupe.empty) {
            await db.collection('ledger').add({
              date: payment.date, description: `Design project — ${p.name||p.id}${payment.note?' ('+payment.note+')':''}`,
              category: 'Sales Revenue', accountType: 'income', account: 'Sales Revenue',
              type: 'credit', amount: amt, net, vatAmount,
              refNumber: dref, source: 'Design', projectId: p.id,
              addedBy: currentUser.uid,
              addedByName: window.userProfile?.displayName || currentUser.email,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
          }
        } catch (ledErr) { console.warn('[design payment] ledger post skipped:', ledErr?.message||ledErr); }
        Notifs.showToast('Payment recorded','success');
        reopen();
      } catch(e) { console.warn(e); Notifs.showToast('Could not save payment','error'); }
    });
  });

  // Create a billing invoice for collection of balance
  document.getElementById('proj-invoice-btn')?.addEventListener('click', () => {
    const bal = (Number(p.contractAmount)||0) - projectPaid(p);
    openPage('Billing Invoice — Collection of Balance', `
      <div class="form-group"><label>Bill To</label><input id="inv-billto" value="${escHtml(p.client||'')}"/></div>
      <div class="form-row">
        <div class="form-group"><label>Invoice Date</label><input id="inv-date" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Due Date</label><input id="inv-due" type="date"/></div>
      </div>
      <div class="form-group"><label>Particulars</label><input id="inv-desc" value="Collection of outstanding balance"/></div>
      <div class="form-group"><label>Amount to Collect (₱)</label><input id="inv-amt" type="number" inputmode="decimal" step="0.01" min="0" value="${bal>0?bal.toFixed(2):'0.00'}"/></div>
      <div class="form-group"><label>Notes / Payment Instructions</label><textarea id="inv-notes" rows="3">Kindly settle the amount due on or before the due date. Payable to NEILBARRO STEEL & METAL FABRICATION SERVICES.</textarea></div>
    `, `<button class="btn-primary" id="gen-inv-btn">Generate Invoice</button><button class="btn-secondary" id="inv-back-btn">Cancel</button>`);
    document.getElementById('inv-back-btn').addEventListener('click', reopen);
    document.getElementById('gen-inv-btn').addEventListener('click', async () => {
      const amt = parseFloat(document.getElementById('inv-amt').value) || 0;
      if (amt <= 0) { Notifs.showToast('Enter a valid amount','error'); return; }
      const contractC = Number(p.contractAmount) || 0;
      const paidC     = projectPaid(p);
      const seq = ((p.invoices || []).length + 1);
      const inv = {
        no:             'INV-' + today().replace(/-/g,'') + '-' + String(seq).padStart(3,'0'),
        date:           document.getElementById('inv-date').value || today(),
        due:            document.getElementById('inv-due').value || '',
        billTo:         document.getElementById('inv-billto').value.trim(),
        desc:           document.getElementById('inv-desc').value.trim(),
        amount:         amt,
        notes:          document.getElementById('inv-notes').value.trim(),
        contractAmount: contractC,
        paidToDate:     paidC,
        balanceBefore:  contractC - paidC,
        projectName:    p.name || '',
        issuedBy:       currentUser.displayName || currentUser.email || '',
        createdAt:      today()
      };
      if (!(await confirmDialog({message:`Generate billing invoice ${inv.no} for ₱${fmt(amt)} (${escHtml(p.name||'')})?`, html:true}))) return;
      try {
        const ref = db.collection('projects').doc(p.id);
        const saved = await db.runTransaction(async tx => {
          const doc  = await tx.get(ref);
          const cur  = (doc.exists && Array.isArray(doc.data().invoices)) ? doc.data().invoices : [];
          const next = [...cur, inv];
          tx.update(ref, { invoices: next });
          return next;
        });
        p.invoices = saved;
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
      } catch(e) {
        console.warn('Invoice not saved to project record:', e);
        Notifs.showToast('Could not save invoice — not recorded','error');
        return;
      }
      openBillingInvoice(p, inv);
    });
  });
}

// ── Tasks tab — design tasks scoped to this project ──
async function renderProjectTasks(host, p, currentUser, currentRole, canBill){
  host.innerHTML = '<div class="loading-placeholder">Loading tasks…</div>';
  const canManage = canEditDept('Design');
  let tasks = [];
  try {
    const snap = await db.collection('tasks').where('projectId','==',p.id).get();
    tasks = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){ console.warn('project tasks load failed', e); }
  tasks.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  host.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      ${canManage?`<button class="btn-primary btn-sm" id="proj-add-task-btn">+ Delegate Task</button>`:''}
    </div>
    ${tasks.length?`<div class="item-list">${tasks.map(taskCard).join('')}</div>`:'<div class="empty-state" style="padding:20px"><div class="empty-icon">📋</div><h4>No tasks for this project</h4></div>'}
  `;
  host.querySelectorAll('.item-card[data-id]').forEach(card=>card.addEventListener('click',()=>openTaskDetail(card.dataset.id, currentUser, currentRole)));
  document.getElementById('proj-add-task-btn')?.addEventListener('click',()=>openAddProjectTaskModal(p, currentUser, currentRole, canBill));
}

// ── Activity tab — merged project + drawing timeline ──
async function renderProjActivity(host, p, currentUser, currentRole){
  host.innerHTML = '<div class="loading-placeholder">Loading activity…</div>';
  const events = [];
  (p.payments||[]).forEach(x=>events.push({at:x.date||'', html:`💵 Payment <strong>₱${fmt(x.amount)}</strong>`, by:x.byName||''}));
  (p.invoices||[]).forEach(x=>events.push({at:x.date||x.createdAt||'', html:`🧾 Invoice ${escHtml(x.no||'')} <strong>₱${fmt(x.amount)}</strong>`, by:x.issuedBy||''}));
  try {
    const snap = await db.collection('design_drawings').where('projectId','==',p.id).get();
    snap.docs.forEach(d=>{ const dr=d.data(); (dr.activity||[]).forEach(a=>events.push({at:a.at||'', html:`📐 ${escHtml(dr.title||'Drawing')}: ${escHtml(a.event||'')}`, by:a.byName||''})); });
  } catch(e){ console.warn(e); }
  events.sort((a,b)=>(''+(b.at)).localeCompare(''+(a.at)));
  host.innerHTML = events.length
    ? `<div style="font-size:12px">${events.map(e=>`<div style="padding:6px 0;border-bottom:1px solid var(--border)"><div>${e.html}</div><div style="font-size:11px;color:var(--text-muted)">${(''+(e.at||'')).slice(0,16).replace('T',' ')}${e.by?' · '+escHtml(e.by):''}</div></div>`).join('')}</div>`
    : '<div class="empty-state" style="padding:20px"><div class="empty-icon">🕘</div><h4>No activity yet</h4></div>';
}

// ── Edit project: rename, status, client link, team delegation, job-project link ──
async function openProjectEditModal(p, currentUser, currentRole, canBill){
  const [uSnap, cSnap, jSnap] = await Promise.all([
    db.collection('users').get().catch(()=>({docs:[]})),
    db.collection('design_clients').get().catch(()=>({docs:[]})),
    db.collection('job_projects').orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
  ]);
  const users   = uSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const clients = cSnap.docs.map(d=>({id:d.id,...d.data()}));
  const jobs    = jSnap.docs.map(d=>({id:d.id,...d.data()}));
  let team = (p.team||[]).map((uid,i)=>({uid, name:(p.teamNames||[])[i]||uid}));

  openPage('Edit Project', `
    <div class="form-group"><label>Project Name</label><input id="pe-name" value="${escHtml(p.name||'')}"/></div>
    <div class="form-group"><label>Client (link to Design CRM)</label>
      <select id="pe-client"><option value="">— None / free text —</option>
        ${clients.map(c=>`<option value="${c.id}" data-name="${escHtml(c.name||c.company||'')}" ${p.clientId===c.id?'selected':''}>${escHtml(c.name||c.company||'Client')}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Client name (display)</label><input id="pe-clientname" value="${escHtml(p.client||'')}" placeholder="Shown on cards & invoices"/></div>
    <div class="form-row">
      <div class="form-group"><label>Start Date</label><input id="pe-start" type="date" value="${escHtml(p.startDate||'')}"/></div>
      <div class="form-group"><label>Due Date</label><input id="pe-due" type="date" value="${escHtml(p.dueDate||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Status</label>
        <select id="pe-status">${['active','on-hold','completed','cancelled'].map(s=>`<option value="${s}" ${(p.status||'active')===s?'selected':''}>${s}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Contract (₱)</label><input id="pe-contract" type="number" step="0.01" min="0" value="${Number(p.contractAmount)||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-group"><label>Design Lead</label>
      <select id="pe-lead"><option value="">— Unassigned —</option>
        ${users.map(u=>`<option value="${u.id}" data-name="${escHtml(u.displayName||u.email)}" ${p.designLead===u.id?'selected':''}>${escHtml(u.displayName||u.email)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Team (delegate — add multiple)</label>
      <select id="pe-team-sel"><option value="">— Add member —</option>
        ${users.map(u=>`<option value="${u.id}" data-name="${escHtml(u.displayName||u.email)}">${escHtml(u.displayName||u.email)}</option>`).join('')}
      </select>
      <div id="pe-team-chips" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"></div>
    </div>
    <div class="form-group"><label>Link to Job Project (Sales/Production lifecycle)</label>
      <select id="pe-job"><option value="">— Not linked —</option>
        ${jobs.map(j=>`<option value="${j.id}" data-no="${escHtml(j.projectNo||'')}" ${p.jobProjectId===j.id?'selected':''}>${escHtml((j.projectNo||'')+' — '+(j.clientName||j.name||''))}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="pe-notes" rows="3">${escHtml(p.notes||'')}</textarea></div>
  `, `<button class="btn-primary" id="pe-save-btn">Save</button><button class="btn-secondary" id="pe-cancel-btn">Cancel</button>`);

  document.getElementById('pe-cancel-btn').addEventListener('click',()=>openProjectDetail(p, currentUser, currentRole, canBill, 'Overview'));

  const renderChips = () => {
    const wrap = document.getElementById('pe-team-chips');
    wrap.innerHTML = team.map(a=>`<span class="badge badge-blue team-chip" data-uid="${a.uid}" style="cursor:pointer">${escHtml(a.name)} ✕</span>`).join('');
    wrap.querySelectorAll('.team-chip').forEach(ch=>ch.addEventListener('click',()=>{ team=team.filter(x=>x.uid!==ch.dataset.uid); renderChips(); }));
  };
  renderChips();
  document.getElementById('pe-team-sel').addEventListener('change',e=>{
    const uid=e.target.value, name=e.target.options[e.target.selectedIndex]?.dataset.name||'';
    if (uid && !team.some(a=>a.uid===uid)) team.push({uid,name});
    e.target.value=''; renderChips();
  });

  document.getElementById('pe-save-btn').addEventListener('click', async () => {
    const prevTeam = new Set(p.team||[]);
    const prevJob  = p.jobProjectId || null;
    const clientSel = document.getElementById('pe-client');
    const leadSel   = document.getElementById('pe-lead');
    const jobSel    = document.getElementById('pe-job');
    const clientId  = clientSel.value || null;
    const clientNameSel = clientSel.options[clientSel.selectedIndex]?.dataset.name || '';
    const update = {
      name:           document.getElementById('pe-name').value.trim() || p.name || 'Project',
      client:         document.getElementById('pe-clientname').value.trim() || clientNameSel || '',
      clientId,
      startDate:      document.getElementById('pe-start').value,
      dueDate:        document.getElementById('pe-due').value,
      status:         document.getElementById('pe-status').value,
      contractAmount: parseFloat(document.getElementById('pe-contract').value) || 0,
      notes:          document.getElementById('pe-notes').value.trim(),
      designLead:     leadSel.value || null,
      designLeadName: leadSel.value ? (leadSel.options[leadSel.selectedIndex]?.dataset.name || null) : null,
      team:           team.map(a=>a.uid),
      teamNames:      team.map(a=>a.name),
      jobProjectId:   jobSel.value || null,
      jobProjectNo:   jobSel.value ? (jobSel.options[jobSel.selectedIndex]?.dataset.no || null) : null,
      updatedAt:      firebase.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await db.collection('projects').doc(p.id).update(update);
      Object.assign(p, update);
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
      const who = window.userProfile?.displayName || currentUser.email || '';
      // notify newly delegated team members
      for (const a of team) {
        if (!prevTeam.has(a.uid) && a.uid!==currentUser.uid) {
          try { await Notifs.send(a.uid,{title:'🎨 Added to a Design project',body:`You're on "${update.name}"`,icon:'🎨',type:'project_team',dedupKey:`projteam-${p.id}-${a.uid}`}); } catch(_){}
        }
      }
      // notify Finance when a job-project link is newly set
      if (update.jobProjectId && update.jobProjectId!==prevJob) {
        try { await Notifs.sendToDept('Finance',{title:'🔗 Design project linked',body:`"${update.name}" linked to job ${update.jobProjectNo||''}`,icon:'🔗',type:'project_link'}); } catch(_){}
      }
      Notifs.showToast('Project saved','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not save project','error'); return; }
    openProjectDetail(p, currentUser, currentRole, canBill, 'Overview');
  });
}

// ── Per-project Drawings ──
async function renderProjectDrawings(host, p, currentUser, currentRole, canBill){
  host.innerHTML = '<div class="loading-placeholder">Loading drawings…</div>';
  const canManage = canEditDept('Design');
  let drawings = [];
  try {
    const snap = await db.collection('design_drawings').where('projectId','==',p.id).get();
    drawings = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){ console.warn('drawings load failed', e); }
  const order = DRAWING_STATUSES.map(s=>s.id);
  drawings.sort((a,b)=>(order.indexOf(a.status)-order.indexOf(b.status)) || (''+(a.title||'')).localeCompare(''+(b.title||'')));
  host.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-size:12px;color:var(--text-muted)">${drawings.length} drawing${drawings.length===1?'':'s'}</span>
      ${canManage?`<button class="btn-primary btn-sm" id="proj-add-dwg-btn">+ New Drawing</button>`:''}
    </div>
    ${drawings.length?`<div class="item-list">${drawings.map(drawingCard).join('')}</div>`:'<div class="empty-state" style="padding:20px"><div class="empty-icon">📐</div><h4>No drawings yet</h4><p>Attach DWG, PDF or drawings to this project.</p></div>'}
  `;
  host.querySelectorAll('.item-card[data-dwg]').forEach(card=>card.addEventListener('click',()=>{
    const d = drawings.find(x=>x.id===card.dataset.dwg);
    if (d) openDrawingDetail(d, p, currentUser, currentRole, canBill);
  }));
  document.getElementById('proj-add-dwg-btn')?.addEventListener('click',()=>openDrawingCreateModal(p, currentUser, currentRole, canBill));
}

async function openDrawingCreateModal(project, currentUser, currentRole, canBill){
  const uSnap = await db.collection('users').get().catch(()=>({docs:[]}));
  const users = uSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  openPage('New Drawing', `
    <div class="form-group"><label>Title</label><input id="dw-title" placeholder="e.g. Ground Floor Plan"/></div>
    <div class="form-row">
      <div class="form-group"><label>Drawing No.</label><input id="dw-no" placeholder="e.g. A-101 (optional)"/></div>
      <div class="form-group"><label>Type</label><select id="dw-type">${DRAWING_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Assign Designer</label>
      <select id="dw-assignee"><option value="">— Unassigned —</option>
        ${users.map(u=>`<option value="${u.id}" data-name="${escHtml(u.displayName||u.email)}">${escHtml(u.displayName||u.email)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Notes (Rev A)</label><textarea id="dw-note" rows="2" placeholder="What this drawing covers / initial notes"></textarea></div>
    <div class="form-group"><label>File (DWG / PDF / drawing)</label><div id="dw-file"></div></div>
  `, `<button class="btn-primary" id="dw-save-btn">Create Drawing</button><button class="btn-secondary" id="dw-cancel-btn">Cancel</button>`);
  let uploaded = null;
  Drive.renderUploadArea('dw-file', r=>{ uploaded=r; }, {label:'Upload DWG/PDF/drawing', dept:'Design', subfolder:'Drawings'});
  document.getElementById('dw-cancel-btn').addEventListener('click',()=>openProjectDetail(project, currentUser, currentRole, canBill, 'Drawings'));
  document.getElementById('dw-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('dw-title').value.trim();
    if (!title){ Notifs.showToast('Enter a drawing title','error'); return; }
    const asel = document.getElementById('dw-assignee');
    const assignedTo = asel.value || null;
    const assignedToName = asel.value ? (asel.options[asel.selectedIndex]?.dataset.name || null) : null;
    const note = document.getElementById('dw-note').value.trim();
    const who = window.userProfile?.displayName || currentUser.email || '';
    const nowIso = new Date().toISOString();
    const rev0 = { rev:'A', status:'draft', fileUrl:uploaded?.url||null, fileName:uploaded?.name||null, driveUrl:uploaded?.driveUrl||null, note, by:currentUser.uid, byName:who, at:nowIso };
    try {
      const ref = await db.collection('design_drawings').add({
        projectId: project.id, projectName: project.name||'',
        title, drawingNo: document.getElementById('dw-no').value.trim(),
        type: document.getElementById('dw-type').value,
        status:'draft', currentRev:'A',
        fileUrl:uploaded?.url||null, fileName:uploaded?.name||null, driveUrl:uploaded?.driveUrl||null, fileSource:uploaded?.source||(uploaded?'firebase':null),
        assignedTo, assignedToName, reviewer:null, reviewerName:null, approver:null, approverName:null, approvedAt:null,
        revisions:[rev0],
        activity:[{ at:nowIso, event:'Drawing created (Rev A)', by:currentUser.uid, byName:who }],
        createdBy: currentUser.uid, createdByName: who,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (assignedTo && assignedTo!==currentUser.uid) {
        try { await Notifs.send(assignedTo,{title:'🎨 Drawing assigned',body:`"${title}" — ${project.name||''}`,icon:'🎨',type:'drawing_assigned',dedupKey:`dwg-assign-${ref.id}`}); } catch(_){}
      }
      window.logAudit && window.logAudit('create','design_drawing',ref.id,{project:project.name, title});
      Notifs.showToast('Drawing created','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not create drawing','error'); return; }
    openProjectDetail(project, currentUser, currentRole, canBill, 'Drawings');
  });
}

function openDrawingDetail(d, project, currentUser, currentRole, canBill){
  const st = drawingStatus(d.status);
  const canManage = canEditDept('Design');
  const revs = (d.revisions||[]).slice().reverse();
  const acts = (d.activity||[]).slice().reverse();
  const fileLink = d.fileUrl
    ? `<a href="${escHtml(d.fileUrl||d.driveUrl)}" target="_blank" class="btn-secondary btn-sm">⬇ ${escHtml(d.fileName||'Open file')}</a>`
    : '<span style="font-size:12px;color:var(--text-muted)">No file attached</span>';
  const trans = canManage ? drawingTransitions(d.status) : [];
  openModal(`${drawingTypeIcon(d.type)} ${escHtml(d.title||'Drawing')}`, `
    <div class="item-meta" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <span class="badge badge-gray">Rev ${escHtml(d.currentRev||'A')}</span>
      <span class="badge ${st.badge}">${st.label}</span>
      <span>${escHtml(d.type||'')}</span>
      ${d.drawingNo?`<span>🔖 ${escHtml(d.drawingNo)}</span>`:''}
    </div>
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:12px 14px;font-size:13px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px">
      <span style="color:var(--text-muted)">Project</span><span>${escHtml(d.projectName||project?.name||'')}</span>
      <span style="color:var(--text-muted)">Designer</span><span>${d.assignedToName?escHtml(d.assignedToName):'<span style="color:var(--text-muted)">Unassigned</span>'}</span>
      <span style="color:var(--text-muted)">Approved by</span><span>${d.approverName?escHtml(d.approverName):'<span style="color:var(--text-muted)">—</span>'}</span>
      <span style="color:var(--text-muted)">Current file</span><span>${fileLink}</span>
    </div></div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">📑 Revision History</div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Rev</th><th>Status</th><th>Note</th><th>By</th><th>Date</th><th>File</th></tr></thead><tbody>
      ${revs.length?revs.map(r=>`<tr><td><strong>${escHtml(r.rev||'')}</strong></td><td>${escHtml(drawingStatus(r.status).label)}</td><td style="font-size:11px">${escHtml(r.note||'')}</td><td style="font-size:11px">${escHtml(r.byName||'')}</td><td style="font-size:11px;color:var(--text-muted)">${(''+(r.at||'')).slice(0,10)}</td><td>${r.fileUrl?`<a href="${escHtml(r.fileUrl||r.driveUrl)}" target="_blank">⬇</a>`:'—'}</td></tr>`).join(''):'<tr><td colspan="6" style="font-size:12px;color:var(--text-muted)">No revisions.</td></tr>'}
    </tbody></table></div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:12px 0 4px">🕘 Activity</div>
    <div style="max-height:150px;overflow:auto;font-size:12px">${acts.length?acts.map(a=>`<div style="padding:5px 0;border-bottom:1px solid var(--border)"><strong>${escHtml(a.event||'')}</strong><div style="font-size:11px;color:var(--text-muted)">${(''+(a.at||'')).slice(0,16).replace('T',' ')} · ${escHtml(a.byName||'')}</div></div>`).join(''):'<div style="color:var(--text-muted)">No activity.</div>'}</div>
  `, `
    ${canManage?`<button class="btn-secondary btn-sm" id="dwg-rev-btn">+ New Revision</button>`:''}
    ${canManage?`<button class="btn-secondary btn-sm" id="dwg-edit-btn">✏️ Edit</button>`:''}
    ${trans.map(t=>`<button class="${t.cls} btn-sm dwg-trans-btn" data-to="${t.to}">${t.label}</button>`).join('')}
    <button class="btn-secondary" id="dwg-back-btn">Back</button>
  `);
  document.getElementById('dwg-back-btn').addEventListener('click',()=>openProjectDetail(project, currentUser, currentRole, canBill, 'Drawings'));
  document.getElementById('dwg-rev-btn')?.addEventListener('click',()=>openDrawingRevisionModal(d, project, currentUser, currentRole, canBill));
  document.getElementById('dwg-edit-btn')?.addEventListener('click',()=>openDrawingEditModal(d, project, currentUser, currentRole, canBill));
  document.querySelectorAll('.dwg-trans-btn').forEach(b=>b.addEventListener('click',()=>changeDrawingStatus(d, b.dataset.to, project, currentUser, currentRole, canBill)));
}

async function changeDrawingStatus(d, to, project, currentUser, currentRole, canBill){
  const who = window.userProfile?.displayName || currentUser.email || '';
  const nowIso = new Date().toISOString();
  const st = drawingStatus(to);
  const actEntry = { at:nowIso, event:`Status → ${st.label} (Rev ${d.currentRev||'A'})`, by:currentUser.uid, byName:who };
  const update = {
    status: to,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    activity: firebase.firestore.FieldValue.arrayUnion(actEntry),
  };
  if (to==='approved') { update.approver=currentUser.uid; update.approverName=who; update.approvedAt=firebase.firestore.FieldValue.serverTimestamp(); }
  try {
    await db.collection('design_drawings').doc(d.id).update(update);
    d.status = to;
    d.activity = [...(d.activity||[]), actEntry];
    if (to==='approved'){ d.approver=currentUser.uid; d.approverName=who; }
  } catch(e){ console.warn(e); Notifs.showToast('Could not update status','error'); return; }
  // Cross-department side effects — best-effort; never block the status change.
  try {
    if (to==='approved' && d.assignedTo && d.assignedTo!==currentUser.uid) {
      await Notifs.send(d.assignedTo,{title:'✅ Drawing approved',body:`"${d.title}" was approved`,icon:'✅',type:'drawing_approved',dedupKey:`dwg-appr-${d.id}-${d.currentRev}`});
    }
    if (to==='released') {
      await Notifs.sendToDept('Production',{title:'📐 Drawing released',body:`"${d.title}" (${project?.name||d.projectName||''}) is released for production`,icon:'📐',type:'drawing_released'});
      if (project?.jobProjectId) {
        await db.collection('job_projects').doc(project.jobProjectId).update({
          documents: firebase.firestore.FieldValue.arrayUnion({ type:'Drawing', ref:`${d.title} Rev ${d.currentRev||'A'}`, at:nowIso, by:who }),
          timeline:  firebase.firestore.FieldValue.arrayUnion({ at:nowIso, event:`Drawing released: ${d.title} Rev ${d.currentRev||'A'}`, by:who }),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  } catch(e){ console.warn('drawing release side-effect failed', e); }
  Notifs.showToast(`Drawing → ${st.label}`,'success');
  openDrawingDetail(d, project, currentUser, currentRole, canBill);
}

function openDrawingRevisionModal(d, project, currentUser, currentRole, canBill){
  const newRev = nextRev(d.currentRev||'A');
  openPage(`New Revision — Rev ${newRev}`, `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Cutting <strong>Rev ${escHtml(newRev)}</strong> of "${escHtml(d.title||'')}". The drawing returns to <strong>Draft</strong> for re-review.</div>
    <div class="form-group"><label>Change Note</label><textarea id="rv-note" rows="3" placeholder="What changed in this revision"></textarea></div>
    <div class="form-group"><label>Updated File (optional)</label><div id="rv-file"></div></div>
  `, `<button class="btn-primary" id="rv-save-btn">Save Rev ${newRev}</button><button class="btn-secondary" id="rv-cancel-btn">Cancel</button>`);
  let uploaded = null;
  Drive.renderUploadArea('rv-file', r=>{ uploaded=r; }, {label:'Upload updated DWG/PDF', dept:'Design', subfolder:'Drawings'});
  document.getElementById('rv-cancel-btn').addEventListener('click',()=>openDrawingDetail(d, project, currentUser, currentRole, canBill));
  document.getElementById('rv-save-btn').addEventListener('click', async () => {
    const note = document.getElementById('rv-note').value.trim();
    const who = window.userProfile?.displayName || currentUser.email || '';
    const nowIso = new Date().toISOString();
    const fileUrl  = uploaded?.url || d.fileUrl || null;
    const fileName = uploaded?.name || d.fileName || null;
    const driveUrl = uploaded ? (uploaded.driveUrl||null) : (d.driveUrl||null);
    const revEntry = { rev:newRev, status:'draft', fileUrl, fileName, driveUrl, note, by:currentUser.uid, byName:who, at:nowIso };
    const actEntry = { at:nowIso, event:`Rev ${newRev} created`, by:currentUser.uid, byName:who };
    try {
      await db.collection('design_drawings').doc(d.id).update({
        currentRev:newRev, status:'draft',
        fileUrl, fileName, driveUrl, fileSource: uploaded?.source || d.fileSource || null,
        approver:null, approverName:null, approvedAt:null,
        revisions: firebase.firestore.FieldValue.arrayUnion(revEntry),
        activity:  firebase.firestore.FieldValue.arrayUnion(actEntry),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      Object.assign(d, { currentRev:newRev, status:'draft', fileUrl, fileName, driveUrl, approver:null, approverName:null });
      d.revisions = [...(d.revisions||[]), revEntry];
      d.activity  = [...(d.activity||[]), actEntry];
      Notifs.showToast(`Rev ${newRev} saved`,'success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not save revision','error'); return; }
    openDrawingDetail(d, project, currentUser, currentRole, canBill);
  });
}

async function openDrawingEditModal(d, project, currentUser, currentRole, canBill){
  const uSnap = await db.collection('users').get().catch(()=>({docs:[]}));
  const users = uSnap.docs.map(u=>({id:u.id,...u.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  openPage('Edit Drawing', `
    <div class="form-group"><label>Title</label><input id="de-title" value="${escHtml(d.title||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Drawing No.</label><input id="de-no" value="${escHtml(d.drawingNo||'')}"/></div>
      <div class="form-group"><label>Type</label><select id="de-type">${DRAWING_TYPES.map(t=>`<option value="${t}" ${d.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Assign Designer</label>
      <select id="de-assignee"><option value="">— Unassigned —</option>
        ${users.map(u=>`<option value="${u.id}" data-name="${escHtml(u.displayName||u.email)}" ${d.assignedTo===u.id?'selected':''}>${escHtml(u.displayName||u.email)}</option>`).join('')}
      </select>
    </div>
  `, `<button class="btn-primary" id="de-save-btn">Save</button><button class="btn-secondary" id="de-cancel-btn">Cancel</button>`);
  document.getElementById('de-cancel-btn').addEventListener('click',()=>openDrawingDetail(d, project, currentUser, currentRole, canBill));
  document.getElementById('de-save-btn').addEventListener('click', async () => {
    const asel = document.getElementById('de-assignee');
    const assignedTo = asel.value || null;
    const assignedToName = asel.value ? (asel.options[asel.selectedIndex]?.dataset.name || null) : null;
    const prevAssignee = d.assignedTo || null;
    const who = window.userProfile?.displayName || currentUser.email || '';
    const update = {
      title:     document.getElementById('de-title').value.trim() || d.title,
      drawingNo: document.getElementById('de-no').value.trim(),
      type:      document.getElementById('de-type').value,
      assignedTo, assignedToName,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await db.collection('design_drawings').doc(d.id).update(update);
      Object.assign(d, update);
      if (assignedTo && assignedTo!==prevAssignee && assignedTo!==currentUser.uid) {
        try { await Notifs.send(assignedTo,{title:'🎨 Drawing assigned',body:`"${update.title}" — ${project?.name||''}`,icon:'🎨',type:'drawing_assigned',dedupKey:`dwg-reassign-${d.id}-${assignedTo}`}); } catch(_){}
      }
      Notifs.showToast('Drawing saved','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not save','error'); return; }
    openDrawingDetail(d, project, currentUser, currentRole, canBill);
  });
}

// Delegate a Design task scoped to a project (writes department:'Design' + projectId).
async function openAddProjectTaskModal(project, currentUser, currentRole, canBill){
  const uSnap = await db.collection('users').get().catch(()=>({docs:[]}));
  const users = uSnap.docs.map(u=>({id:u.id,...u.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  openPage('Delegate Task — '+escHtml(project.name||''), `
    <div class="form-group"><label>Title</label><input id="pt-title" placeholder="Task name"/></div>
    <div class="form-group"><label>Description</label><textarea id="pt-desc" rows="2"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Priority</label><select id="pt-priority"><option value="low">🟢 Low</option><option value="medium" selected>🟡 Medium</option><option value="high">🔴 High</option><option value="urgent">🚨 Urgent</option></select></div>
      <div class="form-group"><label>Due Date</label><input id="pt-due" type="date" value="${today()}"/></div>
    </div>
    <div class="form-group"><label>Assign To (add multiple)</label>
      <select id="pt-assignee-sel"><option value="">— Add assignee —</option>${users.map(u=>`<option value="${u.id}" data-name="${escHtml(u.displayName||u.email)}">${escHtml(u.displayName||u.email)}</option>`).join('')}</select>
      <div id="pt-chips" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"></div>
    </div>
  `, `<button class="btn-primary" id="pt-save-btn">Create Task</button><button class="btn-secondary" id="pt-cancel-btn">Cancel</button>`);
  document.getElementById('pt-cancel-btn').addEventListener('click',()=>openProjectDetail(project, currentUser, currentRole, canBill, 'Tasks'));
  let picks = [];
  const renderPicks = () => {
    const wrap = document.getElementById('pt-chips');
    wrap.innerHTML = picks.map(a=>`<span class="badge badge-blue pt-chip" data-uid="${a.uid}" style="cursor:pointer">${escHtml(a.name)} ✕</span>`).join('');
    wrap.querySelectorAll('.pt-chip').forEach(ch=>ch.addEventListener('click',()=>{ picks=picks.filter(x=>x.uid!==ch.dataset.uid); renderPicks(); }));
  };
  document.getElementById('pt-assignee-sel').addEventListener('change',e=>{
    const uid=e.target.value, name=e.target.options[e.target.selectedIndex]?.dataset.name||'';
    if (uid && !picks.some(a=>a.uid===uid)) picks.push({uid,name});
    e.target.value=''; renderPicks();
  });
  document.getElementById('pt-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('pt-title').value.trim();
    if (!title){ Notifs.showToast('Enter a task title','error'); return; }
    const who = window.userProfile?.displayName || currentUser.email || '';
    try {
      const ref = await db.collection('tasks').add({
        title, description: document.getElementById('pt-desc').value.trim(),
        priority: document.getElementById('pt-priority').value, status:'backlog',
        dueDate: document.getElementById('pt-due').value,
        department:'Design', projectId:project.id, projectName:project.name||'',
        assignedTo:picks.map(a=>a.uid), assignedToNames:picks.map(a=>a.name),
        createdBy:currentUser.uid, createdByName:who,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      for (const a of picks) {
        if (a.uid!==currentUser.uid) {
          try { await Notifs.send(a.uid,{title:'📌 New Task Assigned',body:`"${title}" — ${project.name||''}`,icon:'📌',type:'task_assigned',taskId:ref.id,dedupKey:`task-assigned-${ref.id}-${a.uid}`}); } catch(_){}
        }
      }
      try { await Notifs.sendToOwner({title:'📌 New Task Created',body:`${who} created "${title}"`,icon:'📌',type:'task_created',dedupKey:`task-created-${ref.id}`}); } catch(_){}
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
      Notifs.showToast('Task created','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not create task','error'); return; }
    openProjectDetail(project, currentUser, currentRole, canBill, 'Tasks');
  });
}

// ── Cross-project Drawings dashboard (Design subtab) ──
async function renderDrawingsDashboard(container, currentUser, currentRole){
  container.innerHTML = '<div class="loading-placeholder">Loading drawings…</div>';
  let drawings = [];
  try {
    const snap = await db.collection('design_drawings').orderBy('createdAt','desc').get();
    drawings = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){ console.warn('drawings dashboard load failed', e); }
  const projMap = {};
  try { const ps = await db.collection('projects').get(); ps.docs.forEach(d=>projMap[d.id]={id:d.id,...d.data()}); } catch(_){}
  const counts = {}; DRAWING_STATUSES.forEach(s=>counts[s.id]=0);
  drawings.forEach(d=>{ if (counts[d.status]!=null) counts[d.status]++; });
  const designers = [...new Set(drawings.map(d=>d.assignedToName).filter(Boolean))].sort();
  const projects  = [...new Set(drawings.map(d=>d.projectName).filter(Boolean))].sort();
  let fStatus='All', fDesigner='All', fProject='All';
  const selStyle = 'padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px';

  const renderList = () => {
    const showing = drawings.filter(d=>
      (fStatus==='All'||d.status===fStatus) &&
      (fDesigner==='All'||d.assignedToName===fDesigner) &&
      (fProject==='All'||d.projectName===fProject)
    );
    const listEl = document.getElementById('dwg-dash-list');
    listEl.innerHTML = showing.length
      ? `<div class="item-list">${showing.map(drawingCard).join('')}</div>`
      : '<div class="empty-state" style="padding:20px"><div class="empty-icon">📐</div><h4>No drawings match</h4></div>';
    listEl.querySelectorAll('.item-card[data-dwg]').forEach(card=>card.addEventListener('click',()=>{
      const d = drawings.find(x=>x.id===card.dataset.dwg);
      if (d) openDrawingDetail(d, projMap[d.projectId] || {id:d.projectId, name:d.projectName}, currentUser, currentRole, false);
    }));
  };

  container.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      ${DRAWING_STATUSES.map(s=>`<div class="kpi-card"><div class="kpi-label">${s.label}</div><div class="kpi-value">${counts[s.id]||0}</div></div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <select id="dwg-f-status" style="${selStyle}"><option value="All">All statuses</option>${DRAWING_STATUSES.map(s=>`<option value="${s.id}">${s.label}</option>`).join('')}</select>
      <select id="dwg-f-designer" style="${selStyle}"><option value="All">All designers</option>${designers.map(n=>`<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('')}</select>
      <select id="dwg-f-project" style="${selStyle}"><option value="All">All projects</option>${projects.map(n=>`<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('')}</select>
    </div>
    <div id="dwg-dash-list"></div>
  `;
  document.getElementById('dwg-f-status').addEventListener('change',e=>{ fStatus=e.target.value; renderList(); });
  document.getElementById('dwg-f-designer').addEventListener('change',e=>{ fDesigner=e.target.value; renderList(); });
  document.getElementById('dwg-f-project').addEventListener('change',e=>{ fProject=e.target.value; renderList(); });
  renderList();
}

// Open a billing invoice in a printable window
window.openBillingInvoice = function(p, inv) {
  const html = buildBillingInvoiceHTML(p, inv);
  const win = window.open('','_blank','width=900,height=700');
  if (!win) { Notifs.showToast('Allow popups to view the invoice','error'); return; }
  win.document.write(html);
  win.document.close();
};

function buildBillingInvoiceHTML(p, inv) {
  const f = n => (parseFloat(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtD = s => { if(!s) return '—'; const dt=new Date(s); return isNaN(dt.getTime())?s:dt.toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}); };
  const balanceAfter = (Number(inv.balanceBefore)||0) - (Number(inv.amount)||0);
  const safeName = (inv.no||'invoice').replace(/[^a-zA-Z0-9-]/g,'');
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'BILLING INVOICE',
    entity: window.brandEntity ? window.brandEntity('bir') : null,
    accent: '#1a237e',
    dateLabel: 'Invoice Date: ' + fmtD(inv.date),
    signatures: [
      { label: 'Issued by',   name: inv.issuedBy || '', title: (window.BRAND && window.BRAND.name) || 'Barro Industries' },
      { label: 'Received by', name: '', title: 'Client' }
    ],
    footerNote: 'System-generated invoice · ' + ((window.BRAND && window.BRAND.name) || 'Barro Industries') + ' · ' + new Date().toLocaleString('en-PH')
  }) : null;

  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<title>Billing Invoice — ${escHtml(inv.no||'')}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color:#000; background:#f0f0f0; }
  .page { width:210mm; min-height:297mm; margin:0 auto; background:#fff; padding:14mm; }
  table { width:100%; border-collapse:collapse; }
  td, th { border:1px solid #000; padding:5px 7px; vertical-align:middle; font-size:11px; }
  .header-top { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
  .company-logo { width:64px; height:64px; object-fit:contain; border:2px solid #000; padding:2px; flex-shrink:0; }
  .company-name { font-size:24px; font-weight:900; letter-spacing:1px; }
  .company-sub { font-size:9px; line-height:1.6; }
  .doc-title { background:#1a237e; color:#fff; text-align:center; font-size:18px; font-weight:800; letter-spacing:2px; padding:8px; margin:8px 0 12px; }
  .meta-grid { display:flex; gap:12px; margin-bottom:12px; }
  .meta-box { flex:1; border:1px solid #000; padding:8px 10px; font-size:11px; line-height:1.7; }
  .meta-box .lbl { font-weight:700; text-transform:uppercase; font-size:9px; color:#333; }
  .section-header { background:#1a237e; color:#fff; font-weight:700; font-size:11px; padding:5px 7px; text-transform:uppercase; letter-spacing:.05em; }
  .number-cell { text-align:right; }
  .muted-row td { background:#f5f5f5; }
  .due-row td { font-weight:900; font-size:15px; background:#ffeb3b; color:#000; }
  .notes-box { border:1px solid #000; border-top:none; padding:10px; font-size:10px; line-height:1.6; }
  .export-bar { position:fixed; top:0; left:0; right:0; background:#1a237e; color:#fff; padding:10px 20px; display:flex; gap:10px; align-items:center; z-index:999; }
  .export-bar button { background:#fff; color:#1a237e; border:none; padding:6px 16px; border-radius:6px; font-weight:700; font-size:12px; cursor:pointer; }
  .export-bar button:hover { background:#e3f2fd; }
  @media print {
    .export-bar { display:none !important; }
    body { background:#fff; }
    .page { padding:10mm; }
  }
${_lh ? _lh.printCSS : ''}
</style>
</head><body>
<div class="export-bar">
  <span style="font-weight:700">🧾 Billing Invoice — ${escHtml(inv.no||'')}</span>
  <button onclick="window.print()">🖨 Save as PDF / Print</button>
  <button onclick="downloadJPEG()">📷 Save as JPEG</button>
  <button onclick="window.close()" style="margin-left:auto;background:rgba(255,255,255,0.15);color:#fff">✕ Close</button>
</div>
<div style="height:48px"></div>
<div class="page" id="invoice-page">
  ${_lh ? _lh.headerHTML : `
  <div class="header-top">
    <img src="icons/barro-industries.png" class="company-logo" onerror="this.style.display='none'" alt=""/>
    <div>
      <div class="company-name">BARRO INDUSTRIES</div>
      <div class="company-sub">
        NEILBARRO STEEL &amp; METAL FABRICATION SERVICES<br/>
        PUROK 6, CARLATAN, 2500, CITY OF SAN FERNANDO, LA UNION, PHILIPPINES<br/>
        CONTACT: NEIL BARRO, 0927-683-6300<br/>
        TIN: 951-145-613-000
      </div>
    </div>
  </div>
  <div class="doc-title">BILLING INVOICE</div>`}

  <div class="meta-grid">
    <div class="meta-box">
      <div class="lbl">Bill To</div>
      <div style="font-weight:700;font-size:13px">${escHtml(inv.billTo||'—')}</div>
      ${inv.projectName?`<div style="font-size:10px;color:#333">Project: ${escHtml(inv.projectName)}</div>`:''}
    </div>
    <div class="meta-box">
      <div><span class="lbl">Invoice No:</span> ${escHtml(inv.no||'')}</div>
      <div><span class="lbl">Invoice Date:</span> ${fmtD(inv.date)}</div>
      <div><span class="lbl">Due Date:</span> ${inv.due?fmtD(inv.due):'Upon receipt'}</div>
    </div>
  </div>

  <div class="section-header">Account Summary</div>
  <table>
    <tr class="muted-row"><td style="width:70%">Total Contract Amount</td><td class="number-cell">₱${f(inv.contractAmount)}</td></tr>
    <tr class="muted-row"><td>Less: Payments Received to Date</td><td class="number-cell">(₱${f(inv.paidToDate)})</td></tr>
    <tr><td style="font-weight:700">Outstanding Balance</td><td class="number-cell" style="font-weight:700">₱${f(inv.balanceBefore)}</td></tr>
  </table>

  <div class="section-header" style="margin-top:12px">This Invoice</div>
  <table>
    <thead><tr><th style="width:70%">Particulars</th><th class="number-cell">Amount</th></tr></thead>
    <tbody>
      <tr><td>${escHtml(inv.desc||'Collection of outstanding balance')}</td><td class="number-cell">₱${f(inv.amount)}</td></tr>
      <tr class="due-row"><td style="text-align:right">AMOUNT DUE</td><td class="number-cell">₱${f(inv.amount)}</td></tr>
      <tr><td style="font-size:10px;color:#333">Remaining balance after this invoice is settled</td><td class="number-cell" style="font-size:10px;color:#333">₱${f(balanceAfter)}</td></tr>
    </tbody>
  </table>

  ${inv.notes?`<div class="section-header" style="margin-top:12px">Notes</div><div class="notes-box">${escHtml(inv.notes)}</div>`:''}

  ${_lh ? _lh.footerHTML : `
  <table style="margin-top:24px;border:none">
    <tr>
      <td style="border:none;padding:24px 10px 6px;text-align:center;width:50%">
        <div style="border-top:1px solid #000;padding-top:4px">${escHtml(inv.issuedBy||'')}</div>
        <div style="font-size:9px;color:#555">Issued By</div>
      </td>
      <td style="border:none;padding:24px 10px 6px;text-align:center;width:50%">
        <div style="border-top:1px solid #000;padding-top:4px">&nbsp;</div>
        <div style="font-size:9px;color:#555">Received By / Date</div>
      </td>
    </tr>
  </table>`}
</div>
<script>
async function downloadJPEG() {
  const btn = document.querySelector('.export-bar button:nth-child(3)');
  if(btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
  if (!window.html2canvas) {
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  }
  const el = document.getElementById('invoice-page');
  const canvas = await html2canvas(el, { scale:2, useCORS:true, backgroundColor:'#fff', logging:false });
  const link = document.createElement('a');
  link.download = '${safeName}.jpg';
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
  if(btn) { btn.textContent = '📷 Save as JPEG'; btn.disabled = false; }
}
<\/script>
</body></html>`;
}

// ══════════════════════════════════════════════════
//  IT DEPARTMENT
// ══════════════════════════════════════════════════
window.renderIT = async function(currentUser, currentRole, subtab = 'Overview') {
  const c = deptContainer();
  const canEdit = canEditDept('IT');
  // it_access / it_network are admin-read-only (Firestore rules). Hide those
  // subtabs from non-admins so they don't see a misleadingly-empty table for
  // records they simply aren't permitted to read.
  const itAdmin = currentRole === 'president' || currentRole === 'manager';
  const subtabs = itAdmin
    ? ['Overview','IT Tickets','Assets','Software','Access Control','Network','Tasks']
    : ['Overview','IT Tickets','Assets','Software','Tasks'];
  if (!itAdmin && (subtab === 'Access Control' || subtab === 'Network')) subtab = 'Overview';
  c.innerHTML = `
    <div class="page-header"><h2>💻 IT Department</h2></div>
    ${window.sopPanel('How IT works', [
      'Staff raise issues in IT Tickets; IT works them to resolution.',
      'Assets and Software track company hardware and licences.',
      'Access Control and Network hold credentials/config — admin-only.'
    ])}
    ${window.chipTabs(subtabs.map(s=>({key:s,label:s})), subtab)}
    <div id="it-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadITContent(currentUser, currentRole, subtab, canEdit);
  window.bindChipTabs(c, (key) => loadITContent(currentUser, currentRole, key, canEdit));
};

async function loadITContent(currentUser, currentRole, sub, canEdit) {
  const content = document.getElementById('it-content');
  if (!content) return;

  // ── Overview ──────────────────────────────────────
  if (sub === 'Overview') {
    const [ticketsSnap, assetsSnap] = await Promise.all([
      db.collection('it_tickets').get().catch(()=>({docs:[]})),
      db.collection('it_assets').get().catch(()=>({docs:[]}))
    ]);
    const tickets  = ticketsSnap.docs.map(d=>({id:d.id,...d.data()}));
    const assets   = assetsSnap.docs.map(d=>({id:d.id,...d.data()}));
    const openT    = tickets.filter(t=>t.status==='open').length;
    const inProgT  = tickets.filter(t=>t.status==='in-progress').length;
    const totalA   = assets.length;
    const activeA  = assets.filter(a=>a.status==='active').length;
    content.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:20px">
        <div class="card" style="text-align:center;padding:16px">
          <div style="font-size:28px;margin-bottom:4px">🎫</div>
          <div style="font-size:22px;font-weight:700;color:var(--accent)">${openT}</div>
          <div style="font-size:12px;color:var(--text-muted)">Open Tickets</div>
        </div>
        <div class="card" style="text-align:center;padding:16px">
          <div style="font-size:28px;margin-bottom:4px">⏳</div>
          <div style="font-size:22px;font-weight:700;color:#FF9F0A">${inProgT}</div>
          <div style="font-size:12px;color:var(--text-muted)">In Progress</div>
        </div>
        <div class="card" style="text-align:center;padding:16px">
          <div style="font-size:28px;margin-bottom:4px">🖥️</div>
          <div style="font-size:22px;font-weight:700;color:var(--text)">${totalA}</div>
          <div style="font-size:12px;color:var(--text-muted)">Total Assets</div>
        </div>
        <div class="card" style="text-align:center;padding:16px">
          <div style="font-size:28px;margin-bottom:4px">✅</div>
          <div style="font-size:22px;font-weight:700;color:#30D158">${activeA}</div>
          <div style="font-size:12px;color:var(--text-muted)">Active Assets</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Recent Open Tickets</h3></div>
        <div class="item-list" style="padding:8px 12px 12px">
          ${tickets.filter(t=>t.status==='open').slice(0,5).map(t=>`
            <div class="item-card">
              <div class="item-top">
                <div class="item-title">${escHtml(t.title||'Untitled')}</div>
                <span class="badge ${t.priority==='high'?'badge-red':t.priority==='medium'?'badge-orange':'badge-gray'}">${t.priority||'low'}</span>
              </div>
              <div class="item-meta">
                <span>${escHtml(t.category||'General')}</span>
                ${t.requestedBy?`<span>👤 ${escHtml(t.requestedBy)}</span>`:''}
                ${t.createdAt?`<span>${new Date(t.createdAt.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric'})}</span>`:''}
              </div>
            </div>`).join('') || '<div class="empty-state" style="padding:16px"><div class="empty-icon">✅</div><p>No open tickets</p></div>'}
        </div>
      </div>`;
    return;
  }

  // ── IT Tickets ────────────────────────────────────
  if (sub === 'IT Tickets') {
    const snap = await db.collection('it_tickets').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
    const tickets = snap.docs.map(d=>({id:d.id,...d.data()}));
    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <select id="it-ticket-filter" class="select-sm">
          <option value="all">All Tickets</option>
          <option value="open">Open</option>
          <option value="in-progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <button class="btn-primary btn-sm" id="new-it-ticket-btn">+ New Ticket</button>
      </div>
      <div id="it-ticket-list" class="item-list"></div>`;
    function renderTickets(filter) {
      const list = document.getElementById('it-ticket-list');
      const shown = filter==='all' ? tickets : tickets.filter(t=>t.status===filter);
      if (!shown.length) { list.innerHTML='<div class="empty-state"><div class="empty-icon">🎫</div><h4>No tickets</h4></div>'; return; }
      list.innerHTML = shown.map(t=>`
        <div class="item-card it-ticket-card" data-id="${t.id}" style="cursor:pointer">
          <div class="item-top">
            <div class="item-title">${escHtml(t.title||'Untitled')}</div>
            <span class="badge ${t.status==='open'?'badge-orange':t.status==='in-progress'?'badge-blue':t.status==='resolved'?'badge-green':'badge-gray'}">${t.status||'open'}</span>
          </div>
          <div class="item-meta">
            <span class="badge badge-blue" style="font-size:10px">${escHtml(t.category||'General')}</span>
            <span class="badge ${t.priority==='high'?'badge-red':t.priority==='medium'?'badge-orange':'badge-gray'}" style="font-size:10px">${t.priority||'low'} priority</span>
            ${t.requestedBy?`<span>👤 ${escHtml(t.requestedBy)}</span>`:''}
            ${t.assignedTo?`<span>🔧 ${escHtml(t.assignedTo)}</span>`:''}
          </div>
        </div>`).join('');
      list.querySelectorAll('.it-ticket-card').forEach(card => {
        card.addEventListener('click', () => {
          const t = tickets.find(x=>x.id===card.dataset.id);
          if (t) openITTicketModal(t, currentUser, canEdit, ()=>loadITContent(currentUser, currentRole, 'IT Tickets', canEdit));
        });
      });
    }
    renderTickets('all');
    document.getElementById('it-ticket-filter').onchange = e => renderTickets(e.target.value);
    document.getElementById('new-it-ticket-btn')?.addEventListener('click', () => {
      openPage('New IT Ticket', `
        <div class="form-group"><label>Title</label><input id="it-t-title" placeholder="Brief description of issue"/></div>
        <div class="form-row">
          <div class="form-group"><label>Category</label>
            <select id="it-t-cat"><option>Hardware</option><option>Software</option><option>Network</option><option>Access / Accounts</option><option>Printer</option><option>Other</option></select>
          </div>
          <div class="form-group"><label>Priority</label>
            <select id="it-t-pri"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
          </div>
        </div>
        <div class="form-group"><label>Description</label><textarea id="it-t-desc" rows="4" placeholder="What's happening? Include any error messages."></textarea></div>
        <div class="form-group"><label>Requested By</label><input id="it-t-req" value="${escHtml(currentUser.displayName||'')}"/></div>
      `, `<button class="btn-primary" id="save-it-ticket-btn">Submit Ticket</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-it-ticket-btn').addEventListener('click', async () => {
        const title = document.getElementById('it-t-title').value.trim();
        if (!title) { Notifs.showToast('Please enter a title.','error'); return; }
        await db.collection('it_tickets').add({
          title, category: document.getElementById('it-t-cat').value,
          priority: document.getElementById('it-t-pri').value,
          description: document.getElementById('it-t-desc').value.trim(),
          requestedBy: document.getElementById('it-t-req').value.trim(),
          status: 'open', createdBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal(); loadITContent(currentUser, currentRole, 'IT Tickets', canEdit);
      });
    });
    return;
  }

  // ── Assets ────────────────────────────────────────
  if (sub === 'Assets') {
    const snap = await db.collection('it_assets').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
    const assets = snap.docs.map(d=>({id:d.id,...d.data()}));
    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <select id="it-asset-filter" class="select-sm">
          <option value="all">All Assets</option>
          <option value="active">Active</option>
          <option value="maintenance">In Maintenance</option>
          <option value="retired">Retired</option>
        </select>
        ${canEdit?`<button class="btn-primary btn-sm" id="new-asset-btn">+ Add Asset</button>`:''}
      </div>
      <div class="card"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>Type</th><th>Serial / ID</th><th>Assigned To</th><th>Status</th><th>Purchased</th>${canEdit?'<th></th>':''}</tr></thead>
        <tbody id="it-asset-tbody">
          ${!assets.length?`<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No assets recorded</td></tr>`
            :assets.map(a=>`<tr>
              <td>${escHtml(a.name||'—')}</td>
              <td>${escHtml(a.type||'—')}</td>
              <td><code style="font-size:11px">${escHtml(a.serial||'—')}</code></td>
              <td>${escHtml(a.assignedTo||'—')}</td>
              <td><span class="badge ${a.status==='active'?'badge-green':a.status==='maintenance'?'badge-orange':'badge-gray'}">${a.status||'active'}</span></td>
              <td>${a.purchasedDate||'—'}</td>
              ${canEdit?`<td><button class="btn-icon edit-asset-btn" data-id="${a.id}"><i data-lucide="pencil" style="width:14px;height:14px"></i></button></td>`:''}
            </tr>`).join('')}
        </tbody>
      </table></div></div>`;
    if (canEdit) {
      document.getElementById('new-asset-btn')?.addEventListener('click', () => {
        openPage('Add Asset', `
          <div class="form-row">
            <div class="form-group"><label>Asset Name</label><input id="a-name" placeholder="e.g. Dell Laptop 01"/></div>
            <div class="form-group"><label>Type</label>
              <select id="a-type"><option>Laptop</option><option>Desktop</option><option>Monitor</option><option>Printer</option><option>Network Device</option><option>Phone</option><option>Tablet</option><option>Server</option><option>Other</option></select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Serial / Asset ID</label><input id="a-serial" placeholder="SN-XXXXX"/></div>
            <div class="form-group"><label>Assigned To</label><input id="a-assigned" placeholder="Employee name"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Purchase Date</label><input id="a-date" type="date"/></div>
            <div class="form-group"><label>Status</label>
              <select id="a-status"><option value="active">Active</option><option value="maintenance">In Maintenance</option><option value="retired">Retired</option></select>
            </div>
          </div>
          <div class="form-group"><label>Notes</label><textarea id="a-notes" rows="2"></textarea></div>
        `, `<button class="btn-primary" id="save-asset-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
        document.getElementById('save-asset-btn').addEventListener('click', async () => {
          await db.collection('it_assets').add({
            name: document.getElementById('a-name').value.trim(),
            type: document.getElementById('a-type').value,
            serial: document.getElementById('a-serial').value.trim(),
            assignedTo: document.getElementById('a-assigned').value.trim(),
            purchasedDate: document.getElementById('a-date').value,
            status: document.getElementById('a-status').value,
            notes: document.getElementById('a-notes').value.trim(),
            createdBy: currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          closeModal(); loadITContent(currentUser, currentRole, 'Assets', canEdit);
        });
      });
      document.querySelectorAll('.edit-asset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const asset = assets.find(a=>a.id===btn.dataset.id);
          if (!asset) return;
          openPage('Edit Asset', `
            <div class="form-row">
              <div class="form-group"><label>Asset Name</label><input id="ea-name" value="${escHtml(asset.name||'')}"/></div>
              <div class="form-group"><label>Assigned To</label><input id="ea-assigned" value="${escHtml(asset.assignedTo||'')}"/></div>
            </div>
            <div class="form-group"><label>Status</label>
              <select id="ea-status">
                <option value="active" ${asset.status==='active'?'selected':''}>Active</option>
                <option value="maintenance" ${asset.status==='maintenance'?'selected':''}>In Maintenance</option>
                <option value="retired" ${asset.status==='retired'?'selected':''}>Retired</option>
              </select>
            </div>
            <div class="form-group"><label>Notes</label><textarea id="ea-notes" rows="2">${escHtml(asset.notes||'')}</textarea></div>
          `, `<button class="btn-primary" id="upd-asset-btn">Update</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
          document.getElementById('upd-asset-btn').addEventListener('click', async () => {
            await db.collection('it_assets').doc(asset.id).update({
              name: document.getElementById('ea-name').value.trim(),
              assignedTo: document.getElementById('ea-assigned').value.trim(),
              status: document.getElementById('ea-status').value,
              notes: document.getElementById('ea-notes').value.trim(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            closeModal(); loadITContent(currentUser, currentRole, 'Assets', canEdit);
          });
        });
      });
      if (window.lucide) lucide.createIcons({ nodes: [content] });
    }
    return;
  }

  // ── Software ──────────────────────────────────────
  if (sub === 'Software') {
    const snap = await db.collection('it_software').orderBy('name','asc').get().catch(()=>({docs:[]}));
    const items = snap.docs.map(d=>({id:d.id,...d.data()}));
    content.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        ${canEdit?`<button class="btn-primary btn-sm" id="new-sw-btn">+ Add Software</button>`:''}
      </div>
      <div class="card"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Software</th><th>Vendor</th><th>License Type</th><th>License Key / ID</th><th>Seats</th><th>Expiry</th><th>Status</th>${canEdit?'<th></th>':''}</tr></thead>
        <tbody>
          ${!items.length?`<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px">No software records</td></tr>`
            :items.map(s=>{
              const expiry = s.expiryDate ? new Date(s.expiryDate) : null;
              const isExp  = expiry && expiry < new Date();
              const isSoon = expiry && !isExp && (expiry - new Date()) < 30*24*3600*1000;
              return `<tr>
                <td>${escHtml(s.name||'—')}</td>
                <td>${escHtml(s.vendor||'—')}</td>
                <td>${escHtml(s.licenseType||'—')}</td>
                <td><code style="font-size:10px">${escHtml(s.licenseKey||'—')}</code></td>
                <td>${s.seats||'—'}</td>
                <td style="color:${isExp?'var(--danger)':isSoon?'#FF9F0A':'inherit'}">${s.expiryDate||'—'}${isExp?' ⚠️':isSoon?' 🔔':''}</td>
                <td><span class="badge ${s.status==='active'?'badge-green':s.status==='expired'?'badge-red':'badge-gray'}">${s.status||'active'}</span></td>
                ${canEdit?`<td><button class="btn-icon edit-sw-btn" data-id="${s.id}"><i data-lucide="pencil" style="width:14px;height:14px"></i></button></td>`:''}
              </tr>`;
            }).join('')}
        </tbody>
      </table></div></div>`;
    document.getElementById('new-sw-btn')?.addEventListener('click', () => {
      openPage('Add Software / License', `
        <div class="form-row">
          <div class="form-group"><label>Software Name</label><input id="sw-name" placeholder="e.g. Adobe Creative Cloud"/></div>
          <div class="form-group"><label>Vendor</label><input id="sw-vendor" placeholder="e.g. Adobe"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>License Type</label>
            <select id="sw-ltype"><option>Subscription</option><option>Perpetual</option><option>Open Source</option><option>Trial</option><option>Volume</option></select>
          </div>
          <div class="form-group"><label>Seats / Users</label><input id="sw-seats" type="number" inputmode="numeric" placeholder="1"/></div>
        </div>
        <div class="form-group"><label>License Key / ID</label><input id="sw-key" placeholder="XXXX-XXXX-XXXX"/></div>
        <div class="form-row">
          <div class="form-group"><label>Purchase Date</label><input id="sw-bought" type="date"/></div>
          <div class="form-group"><label>Expiry Date</label><input id="sw-exp" type="date"/></div>
        </div>
        <div class="form-group"><label>Notes</label><textarea id="sw-notes" rows="2"></textarea></div>
      `, `<button class="btn-primary" id="save-sw-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-sw-btn').addEventListener('click', async () => {
        const name = document.getElementById('sw-name').value.trim();
        if (!name) { Notifs.showToast('Enter a name.','error'); return; }
        await db.collection('it_software').add({
          name, vendor: document.getElementById('sw-vendor').value.trim(),
          licenseType: document.getElementById('sw-ltype').value,
          seats: parseInt(document.getElementById('sw-seats').value)||1,
          licenseKey: document.getElementById('sw-key').value.trim(),
          purchasedDate: document.getElementById('sw-bought').value,
          expiryDate: document.getElementById('sw-exp').value,
          notes: document.getElementById('sw-notes').value.trim(),
          status: 'active', createdBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal(); loadITContent(currentUser, currentRole, 'Software', canEdit);
      });
    });
    content.querySelectorAll('.edit-sw-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sw = items.find(x=>x.id===btn.dataset.id);
        if (!sw) return;
        openPage('Edit Software / License', `
          <div class="form-row">
            <div class="form-group"><label>Software Name</label><input id="esw-name" value="${escHtml(sw.name||'')}"/></div>
            <div class="form-group"><label>Vendor</label><input id="esw-vendor" value="${escHtml(sw.vendor||'')}"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>License Type</label>
              <select id="esw-ltype">
                ${['Subscription','Perpetual','Open Source','Trial','Volume'].map(t=>`<option ${sw.licenseType===t?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Seats / Users</label><input id="esw-seats" type="number" inputmode="numeric" value="${sw.seats||1}"/></div>
          </div>
          <div class="form-group"><label>License Key / ID</label><input id="esw-key" value="${escHtml(sw.licenseKey||'')}"/></div>
          <div class="form-row">
            <div class="form-group"><label>Purchase Date</label><input id="esw-bought" type="date" value="${escHtml(sw.purchasedDate||'')}"/></div>
            <div class="form-group"><label>Expiry Date</label><input id="esw-exp" type="date" value="${escHtml(sw.expiryDate||'')}"/></div>
          </div>
          <div class="form-group"><label>Status</label>
            <select id="esw-status">
              <option value="active" ${sw.status==='active'?'selected':''}>Active</option>
              <option value="expired" ${sw.status==='expired'?'selected':''}>Expired</option>
              <option value="retired" ${sw.status==='retired'?'selected':''}>Retired</option>
            </select>
          </div>
          <div class="form-group"><label>Notes</label><textarea id="esw-notes" rows="2">${escHtml(sw.notes||'')}</textarea></div>
        `, `<button class="btn-primary" id="upd-sw-btn">Update</button><button class="btn-danger" id="del-sw-btn">Delete</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
        document.getElementById('upd-sw-btn').addEventListener('click', async () => {
          const name = document.getElementById('esw-name').value.trim();
          if (!name) { Notifs.showToast('Enter a name.','error'); return; }
          await db.collection('it_software').doc(sw.id).update({
            name, vendor: document.getElementById('esw-vendor').value.trim(),
            licenseType: document.getElementById('esw-ltype').value,
            seats: parseInt(document.getElementById('esw-seats').value)||1,
            licenseKey: document.getElementById('esw-key').value.trim(),
            purchasedDate: document.getElementById('esw-bought').value,
            expiryDate: document.getElementById('esw-exp').value,
            status: document.getElementById('esw-status').value,
            notes: document.getElementById('esw-notes').value.trim(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentUser.uid
          });
          closeModal(); loadITContent(currentUser, currentRole, 'Software', canEdit);
        });
        document.getElementById('del-sw-btn').addEventListener('click', async () => {
          if (!(await confirmDialog({message:`Delete software record "${escHtml(sw.name||'')}"? This cannot be undone.`, danger:true, html:true}))) return;
          await db.collection('it_software').doc(sw.id).delete();
          closeModal(); loadITContent(currentUser, currentRole, 'Software', canEdit);
        });
      });
    });
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    return;
  }

  // ── Access Control ────────────────────────────────
  if (sub === 'Access Control') {
    const snap = await db.collection('it_access').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
    const records = snap.docs.map(d=>({id:d.id,...d.data()}));
    content.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        ${canEdit?`<button class="btn-primary btn-sm" id="new-access-btn">+ Add Record</button>`:''}
      </div>
      <div class="card"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Employee</th><th>System / App</th><th>Access Level</th><th>Status</th><th>Granted By</th><th>Date</th>${canEdit?'<th></th>':''}</tr></thead>
        <tbody>
          ${!records.length?`<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No access records</td></tr>`
            :records.map(r=>`<tr>
              <td>${escHtml(r.employee||'—')}</td>
              <td>${escHtml(r.system||'—')}</td>
              <td><span class="badge badge-blue">${escHtml(r.level||'Read')}</span></td>
              <td><span class="badge ${r.status==='active'?'badge-green':'badge-gray'}">${r.status||'active'}</span></td>
              <td>${escHtml(r.grantedBy||'—')}</td>
              <td>${r.date||'—'}</td>
              ${canEdit?`<td><button class="btn-sm btn-danger revoke-access-btn" data-id="${r.id}" data-emp="${escHtml(r.employee||'this user')}" style="font-size:11px;padding:3px 8px">Revoke</button></td>`:''}
            </tr>`).join('')}
        </tbody>
      </table></div></div>`;
    document.getElementById('new-access-btn')?.addEventListener('click', () => {
      openPage('Grant Access', `
        <div class="form-row">
          <div class="form-group"><label>Employee Name</label><input id="ac-emp" placeholder="Full name"/></div>
          <div class="form-group"><label>System / App</label><input id="ac-sys" placeholder="e.g. Google Workspace, Firebase"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Access Level</label>
            <select id="ac-lvl"><option>Read</option><option>Write</option><option>Admin</option><option>Owner</option></select>
          </div>
          <div class="form-group"><label>Date Granted</label><input id="ac-date" type="date" value="${today()}"/></div>
        </div>
        <div class="form-group"><label>Notes</label><textarea id="ac-notes" rows="2"></textarea></div>
      `, `<button class="btn-primary" id="save-access-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-access-btn').addEventListener('click', async () => {
        await db.collection('it_access').add({
          employee: document.getElementById('ac-emp').value.trim(),
          system: document.getElementById('ac-sys').value.trim(),
          level: document.getElementById('ac-lvl').value,
          date: document.getElementById('ac-date').value,
          grantedBy: currentUser.displayName||currentUser.uid,
          notes: document.getElementById('ac-notes').value.trim(),
          status: 'active', createdBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal(); loadITContent(currentUser, currentRole, 'Access Control', canEdit);
      });
    });
    content.querySelectorAll('.revoke-access-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await confirmDialog({message:`Revoke access for ${escHtml(btn.dataset.emp)}?`, danger:true, html:true}))) return;
        await db.collection('it_access').doc(btn.dataset.id).update({ status:'revoked', revokedAt: firebase.firestore.FieldValue.serverTimestamp(), revokedBy: currentUser.uid });
        loadITContent(currentUser, currentRole, 'Access Control', canEdit);
      });
    });
    return;
  }

  // ── Network ───────────────────────────────────────
  if (sub === 'Network') {
    const snap = await db.collection('it_network').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
    const notes = snap.docs.map(d=>({id:d.id,...d.data()}));
    const NET_TYPES = ['WiFi','Router / Modem','IP Config','VPN','ISP Details','Server','General'];
    content.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        ${canEdit?`<button class="btn-primary btn-sm" id="new-net-btn">+ Add Network Note</button>`:''}
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${!notes.length?`<div class="empty-state"><div class="empty-icon">🌐</div><h4>No network notes yet</h4></div>`
          :notes.map(n=>`
            <div class="card">
              <div class="card-header">
                <h3>🌐 ${escHtml(n.title||'Untitled')}</h3>
                <span class="badge badge-blue" style="font-size:10px">${escHtml(n.type||'General')}</span>
              </div>
              <div style="padding:0 16px 16px;font-size:13px;white-space:pre-wrap;color:var(--text)">${escHtml(n.content||'')}</div>
              ${n.updatedAt?`<div style="padding:0 16px 8px;font-size:11px;color:var(--text-muted)">Updated ${new Date(n.updatedAt.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</div>`:''}
              ${canEdit?`<div style="display:flex;gap:8px;padding:0 16px 14px">
                <button class="btn-sm btn-secondary edit-net-btn" data-id="${n.id}" style="font-size:11px;padding:3px 10px">Edit</button>
                <button class="btn-sm btn-danger del-net-btn" data-id="${n.id}" data-title="${escHtml(n.title||'this note')}" style="font-size:11px;padding:3px 10px">Delete</button>
              </div>`:''}
            </div>`).join('')}
      </div>`;
    const netModal = (existing) => {
      openPage(existing?'Edit Network Note':'Add Network Note', `
        <div class="form-row">
          <div class="form-group"><label>Title</label><input id="net-title" value="${escHtml(existing?.title||'')}" placeholder="e.g. Office WiFi Credentials"/></div>
          <div class="form-group"><label>Type</label>
            <select id="net-type">${NET_TYPES.map(t=>`<option ${existing?.type===t?'selected':''}>${t}</option>`).join('')}</select>
          </div>
        </div>
        <div class="form-group"><label>Content / Notes</label><textarea id="net-content" rows="6" placeholder="SSID, passwords, IPs, ports, etc.">${escHtml(existing?.content||'')}</textarea></div>
      `, `<button class="btn-primary" id="save-net-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-net-btn').addEventListener('click', async () => {
        const title = document.getElementById('net-title').value.trim();
        if (!title) { Notifs.showToast('Enter a title.','error'); return; }
        const payload = {
          title, type: document.getElementById('net-type').value,
          content: document.getElementById('net-content').value,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentUser.uid
        };
        if (existing) {
          await db.collection('it_network').doc(existing.id).update(payload);
        } else {
          await db.collection('it_network').add({ ...payload, createdBy: currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        closeModal(); loadITContent(currentUser, currentRole, 'Network', canEdit);
      });
    };
    document.getElementById('new-net-btn')?.addEventListener('click', () => netModal(null));
    content.querySelectorAll('.edit-net-btn').forEach(btn => {
      btn.addEventListener('click', () => { const n = notes.find(x=>x.id===btn.dataset.id); if (n) netModal(n); });
    });
    content.querySelectorAll('.del-net-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await confirmDialog({message:`Delete network note "${escHtml(btn.dataset.title)}"? This cannot be undone.`, danger:true, html:true}))) return;
        await db.collection('it_network').doc(btn.dataset.id).delete();
        loadITContent(currentUser, currentRole, 'Network', canEdit);
      });
    });
    return;
  }

  // ── Tasks ─────────────────────────────────────────
  if (sub === 'Tasks') {
    await renderDeptTasks(content, 'IT', currentUser, currentRole);
    return;
  }
}

function openITTicketModal(ticket, currentUser, canEdit, onRefresh) {
  const isAssigned = canEdit || ticket.createdBy === currentUser.uid;
  openPage(`🎫 ${escHtml(ticket.title||'Ticket')}`, `
    <div style="margin-bottom:12px">
      <div class="item-meta" style="gap:8px;margin-bottom:8px">
        <span class="badge ${ticket.status==='open'?'badge-orange':ticket.status==='in-progress'?'badge-blue':ticket.status==='resolved'?'badge-green':'badge-gray'}">${ticket.status||'open'}</span>
        <span class="badge ${ticket.priority==='high'?'badge-red':ticket.priority==='medium'?'badge-orange':'badge-gray'}">${ticket.priority||'low'} priority</span>
        <span class="badge badge-blue" style="font-size:10px">${escHtml(ticket.category||'General')}</span>
      </div>
      ${ticket.description?`<p style="font-size:13px;margin-bottom:12px;white-space:pre-wrap">${escHtml(ticket.description)}</p>`:''}
      ${ticket.requestedBy?`<div style="font-size:12px;color:var(--text-muted)">Requested by: ${escHtml(ticket.requestedBy)}</div>`:''}
    </div>
    ${canEdit?`
      <div class="form-row" style="margin-top:12px">
        <div class="form-group"><label>Status</label>
          <select id="it-t-status">
            <option value="open" ${ticket.status==='open'?'selected':''}>Open</option>
            <option value="in-progress" ${ticket.status==='in-progress'?'selected':''}>In Progress</option>
            <option value="resolved" ${ticket.status==='resolved'?'selected':''}>Resolved</option>
            <option value="closed" ${ticket.status==='closed'?'selected':''}>Closed</option>
          </select>
        </div>
        <div class="form-group"><label>Assigned To (IT)</label><input id="it-t-assign" value="${escHtml(ticket.assignedTo||'')}"/></div>
      </div>
      <div class="form-group"><label>Resolution Notes</label><textarea id="it-t-res" rows="3">${escHtml(ticket.resolutionNotes||'')}</textarea></div>
    `:'<p style="font-size:12px;color:var(--text-muted)">Only IT staff can update this ticket.</p>'}
  `, canEdit?`<button class="btn-primary" id="upd-ticket-btn">Update Ticket</button><button class="btn-secondary" onclick="closeModal()">Close</button>`
    :`<button class="btn-secondary" onclick="closeModal()">Close</button>`);
  document.getElementById('upd-ticket-btn')?.addEventListener('click', async () => {
    await db.collection('it_tickets').doc(ticket.id).update({
      status: document.getElementById('it-t-status').value,
      assignedTo: document.getElementById('it-t-assign').value.trim(),
      resolutionNotes: document.getElementById('it-t-res').value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser.uid
    });
    closeModal(); onRefresh?.();
  });
}

// ══════════════════════════════════════════════════
//  BRILLIANT STEEL
// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
//  BRILLIANT STEEL — Main Module (v3)
// ══════════════════════════════════════════════════

window.renderBrilliantSteel = async function(currentUser, currentRole, subtab = 'Quotations Summary') {
  const c = deptContainer();
  const tabs = ['Quote Builder','Quotations Summary','Client Data','Files'];
  c.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <span style="font-size:22px">⚙️</span>
      <div>
        <h2 style="font-size:18px;font-weight:800;color:#37474f">Brilliant Steel</h2>
        <p style="font-size:11px;color:var(--text-muted)">Partner Company Operations</p>
      </div>
    </div>
    <div class="subtab-bar" style="flex-wrap:wrap">
      ${tabs.map(s => `<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`).join('')}
    </div>
    <div id="bs-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadBSContent(currentUser, currentRole, subtab);
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadBSContent(currentUser, currentRole, btn.dataset.sub);
    });
  });
};

async function loadBSContent(currentUser, currentRole, sub) {
  const content = document.getElementById('bs-content');
  switch(sub) {
    case 'Quote Builder':      navigateTo('bs-quote-builder'); break;
    case 'Quotations Summary': await renderBSQuotationsSummary(content, currentUser, currentRole); break;
    case 'Client Data':        await renderBSClientData(content, currentUser, currentRole); break;
    case 'Files':              renderBSFiles(content, currentUser, currentRole); break;
  }
}

function renderBSFiles(container, currentUser, currentRole) {
  container.innerHTML = `
    <div class="subtab-bar" id="bs-files-tabs" style="margin-bottom:14px">
      <button class="subtab-btn active" data-sub="Quotations">📋 Quotations</button>
      <button class="subtab-btn" data-sub="Images">🖼 Images</button>
      <button class="subtab-btn" data-sub="Drawings">📐 Drawings</button>
      <button class="subtab-btn" data-sub="Documents">📄 Documents</button>
    </div>
    <div id="bs-files-content"></div>
  `;
  const load = async sub => {
    const fc = document.getElementById('bs-files-content');
    if (sub === 'Quotations') {
      await renderBSQuotationFiles(fc, currentUser, currentRole);
    } else {
      fc.innerHTML = renderFileCollection(`${sub}`, `bs-${sub.toLowerCase()}`, currentRole);
      bindFileCollection(`bs-${sub.toLowerCase()}`, currentUser, 'Brilliant Steel', sub);
    }
  };
  load('Quotations');
  container.querySelectorAll('#bs-files-tabs .subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#bs-files-tabs .subtab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      load(btn.dataset.sub);
    });
  });
}

async function renderBSQuotationFiles(container, currentUser, currentRole) {
  container.innerHTML = '<div class="loading-placeholder">Loading quotation files…</div>';
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager' || currentRole === 'employee';
  try {
    const snap = isPrivileged
      ? await db.collection('bs_quotes').orderBy('createdAt','desc').get()
      : await db.collection('bs_quotes').where('createdBy','==',currentUser.uid).orderBy('createdAt','desc').get();
    const quotes = snap.docs.map(d=>({id:d.id,...d.data()}));

    // Group quotes by client name (folder per client)
    const clientFolders = {};
    quotes.forEach(q => {
      const key = (q.clientName||'').trim() || 'Unknown Client';
      if (!clientFolders[key]) clientFolders[key] = [];
      clientFolders[key].push(q);
    });

    const folders = Object.entries(clientFolders).sort((a,b) => {
      const latestA = Math.max(...a[1].map(q=>q.createdAt?.seconds||0));
      const latestB = Math.max(...b[1].map(q=>q.createdAt?.seconds||0));
      return latestB - latestA;
    });

    if (!folders.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><h4>No quotation files yet</h4><p style="color:var(--text-muted);font-size:13px">Filed quotations will appear here, organized by client.</p></div>';
      return;
    }

    container.innerHTML = `
      <div style="margin-bottom:12px">
        <input id="bs-qfile-search" placeholder="Search client or quote number…" class="ms-input" style="max-width:300px"/>
      </div>
      <div id="bs-qfile-folders" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px"></div>
    `;

    const renderFolders = (list) => {
      const grid = container.querySelector('#bs-qfile-folders');
      if (!list.length) { grid.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No results.</p>'; return; }
      grid.innerHTML = list.map(([clientName, qs]) => {
        const total = qs.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
        const latestDate = qs[0].createdAt?.toDate?.()?.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})||'';
        return `
          <div class="card bs-qfolder-card" style="cursor:pointer" onclick="this.querySelector('.bs-qfolder-body').style.display=this.querySelector('.bs-qfolder-body').style.display==='block'?'none':'block'">
            <div class="card-header" style="gap:10px">
              <div style="font-size:28px;flex-shrink:0">📁</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(clientName)}</div>
                <div style="font-size:11px;color:var(--text-muted)">${qs.length} file${qs.length!==1?'s':''} · ₱${total.toLocaleString()} · Last: ${latestDate}</div>
              </div>
            </div>
            <div class="bs-qfolder-body" style="display:none;padding:10px 16px 14px;border-top:1px solid var(--border)">
              ${qs.map(q => {
                const ts = q.createdAt?.toDate?.()?.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})||'';
                const status = q.status||q.approvalStatus||'draft';
                const badge = status==='filed'||status==='approved'?'badge-green':status==='pending_approval'||status==='pending_review'||status==='sent'?'badge-orange':status==='rejected'?'badge-red':'badge-gray';
                return `
                  <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                    <span style="font-size:18px">📄</span>
                    <div style="flex:1;min-width:0">
                      <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(q.quoteNumber||q.id.slice(-8))}</div>
                      <div style="font-size:11px;color:var(--text-muted)">${ts}${isPrivileged&&q.agentName?' · '+escHtml(q.agentName):''}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                      <div style="font-size:12px;font-weight:700">₱${(q.total||q.grandTotal||0).toLocaleString()}</div>
                      <span class="badge ${badge}" style="font-size:10px">${status}</span>
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>`;
      }).join('');
    };

    renderFolders(folders);

    container.querySelector('#bs-qfile-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      renderFolders(q ? folders.filter(([name, qs]) =>
        name.toLowerCase().includes(q) ||
        qs.some(qt => (qt.quoteNumber||'').toLowerCase().includes(q))
      ) : folders);
    });
  } catch(err) {
    container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}

async function renderBSDashboard(container, currentUser, currentRole) {
  const [snap, projSnap] = await Promise.all([
    db.collection('bs_quotes').get(),
    db.collection('job_projects').get().catch(()=>({docs:[]}))
  ]);
  const quotes = snap.docs.map(d=>({id:d.id,...d.data()}));
  const total   = quotes.reduce((s,q)=>s+(q.total||0),0);
  const pending = quotes.filter(q=>q.approvalStatus==='pending_review').length;
  const approved= quotes.filter(q=>q.approvalStatus==='approved').length;
  // 50/50 partner earnings, aggregated across ALL shared projects (company-wide view)
  const shared = projSnap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>p.split&&p.split.isShared&&p.stage!=='cancelled');
  const partnerShare = (p)=>{ const pct=(p.split&&typeof p.split.partnerPct==='number')?p.split.partnerPct:50; return Math.max(0,(p.contractAmount||0)-(p.capital||0))*(pct/100); };
  const expected = shared.reduce((s,p)=>s+partnerShare(p),0);
  const realized = shared.filter(p=>p.stage==='paid').reduce((s,p)=>s+partnerShare(p),0);
  const pendingShare = Math.max(0, expected-realized);
  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Total Quotes</div><div class="kpi-value">${quotes.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Pipeline Value</div><div class="kpi-value">₱${fmt(total)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Pending Approval</div><div class="kpi-value">${pending}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Approved</div><div class="kpi-value">${approved}</div></div>
    </div>
    ${shared.length?`<div class="card" style="margin-bottom:14px;border:2px solid var(--primary)">
      <div class="card-header"><h3>💰 Partner Earnings (50/50 Split)</h3><span style="font-size:11px;color:var(--text-muted)">From sales orders</span></div>
      <div class="card-body"><div class="kpi-row">
        <div class="kpi-card accent"><div class="kpi-label">Shared Projects</div><div class="kpi-value">${shared.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Expected ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(expected)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Realized ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(realized)}</div></div>
        <div class="kpi-card" style="border-color:var(--warning)"><div class="kpi-label">Pending ₱</div><div class="kpi-value" style="font-size:15px;color:var(--warning)">₱${fmt(pendingShare)}</div></div>
      </div></div>
    </div>`:''}
    <div class="card">
      <div class="card-header"><h3>Recent Quotes</h3><button class="btn-primary btn-sm" onclick="loadBSContent(window.__bsUser,window.__bsRole,'Quote Builder')">+ New Quote</button></div>
      <div class="card-body">
        ${!quotes.length?'<div class="empty-state"><p>No quotes yet</p></div>':
          `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Quote #</th><th>Client</th><th>Total</th><th>Status</th><th>Agent</th></tr></thead>
            <tbody>${quotes.slice(0,8).map(q=>`<tr>
              <td><code>${escHtml(q.quoteNumber||q.id.slice(-8))}</code></td>
              <td>${escHtml(q.clientName||'—')}</td>
              <td>₱${fmt(q.total)}</td>
              <td><span class="badge ${statusBadge(q.approvalStatus||q.status)}">${q.approvalStatus||q.status||'draft'}</span></td>
              <td>${escHtml(q.agentName||'—')}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  window.__bsUser = currentUser;
  window.__bsRole = currentRole;
}

// ── Brilliant Steel Quote Builder ─────────────────
function renderBSQuoteBuilder(container, currentUser, currentRole) {
  container.innerHTML = `
  <style>
  .bs-qb{font-family:var(--font-family,'Segoe UI',system-ui,sans-serif);color:var(--text);}
  .bs-section{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin-bottom:12px;}
  .bs-sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#37474f;margin-bottom:12px;border-bottom:2px solid #cfd8dc;padding-bottom:7px;}
  .bs-fg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;}
  .bs-fg{display:flex;flex-direction:column;gap:3px;}
  .bs-fg.full{grid-column:1/-1;}
  .bs-fg label{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;}
  .bs-fg input,.bs-fg select,.bs-fg textarea{border:1.5px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;width:100%;background:var(--surface);color:var(--text);}
  .bs-qno-row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;}
  .bs-qno-box{background:#cfd8dc;border-radius:7px;padding:8px 14px;font-size:15px;font-weight:800;color:#1a237e;letter-spacing:.8px;white-space:nowrap;align-self:flex-end;}
  .bs-add-panel{display:grid;grid-template-columns:2fr 70px 70px 70px 80px 120px auto;gap:8px;align-items:end;background:#eceff1;border-radius:9px;padding:12px 14px;margin-bottom:10px;}
  @media (max-width:640px){ .bs-add-panel{grid-template-columns:1fr 1fr;} .bs-add-panel>*:first-child{grid-column:1/-1;} }
  .bs-search-wrap{position:relative;}
  .bs-search-dropdown{position:absolute;top:calc(100% + 2px);left:0;right:0;background:var(--surface);border:1.5px solid #37474f;border-radius:7px;z-index:400;max-height:260px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,.15);display:none;}
  .bs-search-dropdown.open{display:block;}
  .bs-sd-group{font-size:10px;font-weight:700;color:#37474f;text-transform:uppercase;letter-spacing:.6px;padding:6px 10px 3px;background:#eceff1;}
  .bs-sd-item{padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);}
  .bs-sd-item:hover{background:#eceff1;}
  .bs-sd-price{float:right;color:#37474f;font-weight:700;font-size:12px;}
  .bs-items-table{width:100%;border-collapse:collapse;}
  .bs-items-table th{background:#37474f;color:white;text-align:left;padding:7px 8px;font-size:11px;font-weight:700;text-transform:uppercase;}
  .bs-items-table td{padding:8px 8px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:middle;}
  .bs-cat-row td{background:#cfd8dc;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#37474f;padding:5px 8px;}
  .bs-subtotal-row td{background:#e8eaf6;font-weight:700;font-size:12px;color:#1a237e;text-align:right;padding:5px 8px;border-bottom:2px solid #37474f;}
  .bs-totals-box{display:flex;justify-content:flex-end;margin-top:10px;}
  .bs-totals-tbl{min-width:290px;}
  .bs-totals-tbl td{padding:5px 11px;font-size:13px;}
  .bs-totals-tbl td:last-child{text-align:right;}
  .bs-totals-tbl tr.grand td{font-weight:700;font-size:16px;border-top:2px solid #37474f;padding-top:9px;}
  .bs-terms-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .bs-terms-block{background:var(--surface2);border-radius:7px;padding:10px 13px;}
  .bs-terms-block h4{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#37474f;margin-bottom:5px;}
  .bs-terms-block p{font-size:12px;color:var(--text);line-height:1.5;}
  .bs-sig-row{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:14px;}
  .bs-sig-box{border-top:1.5px solid var(--border);padding-top:10px;text-align:center;}
  .bs-sig-name{font-weight:700;font-size:14px;}
  .bs-req-approval{background:#e65100;color:#fff;border:none;border-radius:8px;padding:12px 24px;font-size:15px;font-weight:700;cursor:pointer;width:100%;margin-top:10px;}
  .bs-req-approval:hover{background:#bf360c;}
  @media print{
    .bs-qb .no-print{display:none!important;}
    .bs-section{box-shadow:none;border:none;border-bottom:1px solid #ddd;margin-bottom:6px;padding:8px 0;border-radius:0;}
    .bs-qb{padding:0;}
    .bs-print-header{display:flex!important;justify-content:space-between;align-items:flex-start;margin-bottom:12px;padding-bottom:10px;border-bottom:2.5px solid #37474f;}
    @page{margin:13mm 11mm 8mm;}
  }
  .bs-print-header{display:none;}
  </style>

  <div class="bs-qb" id="bs-qb-root">
    <!-- Print Header -->
    <div class="bs-print-header" id="bs-ph">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <img src="icons/barro-industries.png" style="height:50px;flex-shrink:0" onerror="this.style.display='none'"/>
        <div>
          <div style="font-size:16pt;font-weight:900;color:#37474f;letter-spacing:.4px">BRILLIANT STEEL</div>
          <div style="font-size:9pt;color:#555;margin-top:2px">Steel Fabrication &amp; Design</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:14pt;font-weight:900;color:#37474f;letter-spacing:1px">PRICE QUOTATION</div>
        <div id="bs-ph-qno" style="font-size:11pt;font-weight:700;color:#333;margin-top:4px"></div>
        <div id="bs-ph-date" style="font-size:10pt;color:#555;margin-top:2px"></div>
        <div id="bs-ph-agent" style="font-size:10pt;color:#555;margin-top:1px"></div>
      </div>
    </div>

    <!-- Quote Number -->
    <div class="bs-section no-print">
      <div class="bs-sec-title">Quote Number</div>
      <div class="bs-qno-row" id="bs-qno-row">
        <div class="bs-fg"><label>Co.</label><input value="BS" style="width:55px;font-weight:700;text-align:center;background:#eceff1" readonly/></div>
        <span style="padding-bottom:9px;font-size:16px;font-weight:700;color:var(--text-muted)">-</span>
        <div class="bs-fg"><label>Location</label>
          <select id="bs-qno-loc">
            <option value="LU">LU — La Union</option><option value="BG">BG — Baguio</option>
            <option value="ML">ML — Manila</option><option value="SB">SB — Subic</option>
            <option value="CL">CL — Clark</option><option value="DA">DA — Davao</option>
            <option value="CB">CB — Cebu</option><option value="IG">IG — Ilocos</option>
            <option value="OT">OT — Other</option>
          </select>
        </div>
        <span style="padding-bottom:9px;font-size:16px;font-weight:700;color:var(--text-muted)">-</span>
        <div class="bs-fg"><label>Lead Source</label>
          <select id="bs-qno-method">
            <option value="FB">FB — Facebook</option><option value="VB">VB — Viber</option>
            <option value="OF">OF — In Office</option><option value="RF">RF — Referral</option>
            <option value="IG">IG — Instagram</option><option value="WB">WB — Website</option>
            <option value="EM">EM — Email</option><option value="TK">TK — TikTok</option>
            <option value="EX">EX — Exhibition</option>
          </select>
        </div>
        <span style="padding-bottom:9px;font-size:16px;font-weight:700;color:var(--text-muted)">-</span>
        <div class="bs-fg"><label>Date</label><input type="date" id="bs-qno-date" style="max-width:165px"/></div>
        <span style="padding-bottom:9px;font-size:16px;font-weight:700;color:var(--text-muted)">-</span>
        <div class="bs-fg"><label>Client #</label><input type="number" id="bs-qno-seq" value="1" min="1" max="999" style="max-width:70px;text-align:center" inputmode="numeric"/></div>
        <span style="padding-bottom:9px;font-size:16px;font-weight:700;color:var(--text-muted)">→</span>
        <div class="bs-qno-box" id="bs-qno-preview">BS-LU-FB-YYMMDD-001</div>
      </div>
      <div style="display:flex;gap:10px;align-items:flex-end;margin-top:10px;flex-wrap:wrap">
        <div class="bs-fg" style="flex:1;max-width:320px"><label>Quote Number</label>
          <input type="text" id="bs-quote-no" placeholder="Auto-generated" readonly style="background:var(--surface2)"/>
        </div>
        <div class="bs-fg"><label>Salesperson</label><input type="text" id="bs-salesperson" placeholder="Name"/></div>
        <div class="bs-fg"><label>Project Type</label>
          <select id="bs-purpose">
            <option>Fabrication</option><option>Installation</option><option>Repair / Maintenance</option>
            <option>Custom Design</option><option>Government / Bidding</option><option>Other</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Client Info -->
    <div class="bs-section">
      <div class="bs-sec-title">Client Information</div>
      <div class="bs-fg-grid">
        <div class="bs-fg full"><label>Client Name</label><input id="bs-client-name" placeholder="Full name"/></div>
        <div class="bs-fg full"><label>Company / Business Name</label><input id="bs-client-company" placeholder="Company name (if applicable)"/></div>
        <div class="bs-fg full"><label>Project Address / Site</label><input id="bs-client-address" placeholder="Full address"/></div>
        <div class="bs-fg"><label>Phone / Email</label><input id="bs-client-contact" placeholder="Contact details"/></div>
        <div class="bs-fg"><label>TIN (optional)</label><input id="bs-client-tin" placeholder="Tax identification number"/></div>
      </div>
    </div>

    <!-- Add Item -->
    <div class="bs-section no-print">
      <div class="bs-sec-title">Add Item</div>
      <div class="bs-add-panel">
        <div class="bs-fg">
          <label>Search Product</label>
          <div class="bs-search-wrap">
            <input type="text" id="bs-product-search" placeholder="Type to search…" autocomplete="off"/>
            <div class="bs-search-dropdown" id="bs-search-dd"></div>
          </div>
          <input type="hidden" id="bs-selected-code"/>
        </div>
        <div class="bs-fg"><label>W (mm)</label><input type="number" id="bs-dim-w" placeholder="—" inputmode="decimal"/></div>
        <div class="bs-fg"><label>D (mm)</label><input type="number" id="bs-dim-d" placeholder="—" inputmode="decimal"/></div>
        <div class="bs-fg"><label>H (mm)</label><input type="number" id="bs-dim-h" placeholder="—" inputmode="decimal"/></div>
        <div class="bs-fg"><label>Qty</label><input type="number" id="bs-dim-qty" value="1" min="1" inputmode="numeric"/></div>
        <div class="bs-fg"><label>Unit Price (₱)</label>
          <input type="number" id="bs-unit-price" placeholder="Auto" style="background:#fffbf0;border-color:#f0d080" inputmode="decimal"/>
          <div id="bs-price-preview" style="font-size:10px;color:#37474f;font-weight:600;margin-top:2px"></div>
        </div>
        <div class="bs-fg"><label>&nbsp;</label><button class="btn-primary" id="bs-add-item-btn">+ Add</button></div>
      </div>
      <p style="font-size:11px;color:var(--text-muted)">💡 Leave Unit Price blank for auto-calc from dimensions × base rate, or enter to override.</p>
    </div>

    <!-- Items Table -->
    <div class="bs-section">
      <div class="bs-sec-title" style="display:flex;justify-content:space-between">
        <span>Quotation Items</span>
        <span id="bs-item-count" style="font-size:11px;background:#cfd8dc;color:#37474f;padding:2px 8px;border-radius:10px;font-weight:700">0 items</span>
      </div>
      <div id="bs-empty-state" style="text-align:center;padding:28px;color:var(--text-muted)">No items added yet.</div>
      <div id="bs-table-wrap" style="display:none;overflow-x:auto">
        <table class="bs-items-table">
          <thead><tr>
            <th style="width:4%">#</th>
            <th style="width:42%">Description</th>
            <th style="width:13%">Dimensions</th>
            <th style="width:5%;text-align:center">Qty</th>
            <th style="width:8%;text-align:center">Unit</th>
            <th style="width:13%;text-align:right">Unit Price</th>
            <th style="width:13%;text-align:right">Amount</th>
            <th style="width:4%" class="no-print"></th>
          </tr></thead>
          <tbody id="bs-items-body"></tbody>
        </table>
      </div>
      <!-- Totals -->
      <div id="bs-totals-wrap" style="display:none">
        <div class="bs-totals-box">
          <table class="bs-totals-tbl">
            <tr><td>Subtotal</td><td id="bs-subtotal-display">₱0</td></tr>
            <tr id="bs-disc-row" style="display:none"><td style="color:#e65100;font-weight:600">Discount (<span id="bs-disc-pct-lbl">0</span>%)</td><td id="bs-disc-display" style="color:#e65100;font-weight:600">–₱0</td></tr>
            <tr id="bs-vat-row" style="display:none"><td>VAT (12%)</td><td id="bs-vat-display">₱0</td></tr>
            <tr class="grand"><td>GRAND TOTAL</td><td id="bs-grand-display">₱0</td></tr>
            <tr><td style="color:#2e7d32;font-weight:600">Downpayment (<span id="bs-dp-pct">65</span>%)</td><td id="bs-dp-display" style="color:#2e7d32;font-weight:600">₱0</td></tr>
            <tr><td style="color:var(--text-muted)">Balance on Delivery</td><td id="bs-bal-display" style="color:var(--text-muted)">₱0</td></tr>
          </table>
        </div>
        <div class="no-print" style="display:flex;gap:14px;align-items:center;margin-top:7px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
            <input type="checkbox" id="bs-vat-check"/> Apply VAT (12%)
          </label>
          <div style="display:flex;align-items:center;gap:5px;font-size:12px">
            Discount:
            <select id="bs-disc-sel" style="width:75px;padding:3px;font-size:12px">
              <option value="0">None</option><option value="5">5%</option>
              <option value="10">10%</option><option value="15">15%</option>
              <option value="20">20%</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:5px;font-size:12px">
            DP %: <input type="number" id="bs-dp-pct-input" value="65" min="0" max="100" style="width:55px;padding:3px;font-size:12px" inputmode="decimal"/>
          </div>
        </div>
      </div>
    </div>

    <!-- Terms -->
    <div class="bs-section">
      <div class="bs-sec-title">Terms &amp; Conditions</div>
      <div class="bs-terms-grid">
        <div class="bs-terms-block">
          <h4>Payment Terms</h4>
          <p contenteditable="true" id="bs-term-payment">65% downpayment required before production. Balance due upon delivery.</p>
        </div>
        <div class="bs-terms-block">
          <h4>Delivery</h4>
          <p contenteditable="true" id="bs-term-delivery">Delivery schedule to be confirmed after downpayment. Estimated 3–6 weeks from production start.</p>
        </div>
        <div class="bs-terms-block">
          <h4>Validity</h4>
          <p contenteditable="true" id="bs-term-validity">This quotation is valid for 30 days from date of issuance.</p>
        </div>
        <div class="bs-terms-block">
          <h4>Warranty</h4>
          <p contenteditable="true" id="bs-term-warranty">One (1) year warranty on fabrication workmanship. Excludes normal wear and misuse.</p>
        </div>
        <div class="bs-terms-block" style="grid-column:1/-1">
          <h4>Notes</h4>
          <p contenteditable="true" id="bs-term-notes">All prices are VAT-exclusive unless stated. Prices are subject to change without prior notice.</p>
        </div>
      </div>
      <!-- Signature -->
      <div class="bs-sig-row">
        <div class="bs-sig-box">
          <div class="bs-sig-name" contenteditable="true">AGENT NAME</div>
          <small>Sales Representative<br/>Brilliant Steel</small>
        </div>
        <div class="bs-sig-box">
          <div class="bs-sig-name" contenteditable="true">CLIENT NAME</div>
          <small>Conforme — Signature over Printed Name<br/>Date: _______________</small>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="bs-section no-print" style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-secondary" onclick="window.print()">🖨️ Print / Save PDF</button>
      <button class="btn-primary" id="bs-save-btn">💾 Save Draft</button>
      <button class="bs-req-approval" id="bs-request-approval-btn">📤 Request for Approval</button>
    </div>
  </div>
  `;

  // ── Quote Builder Logic ──────────────────────────
  let bsLines = [];
  let bsRowCount = 0;
  let allProds = []; // loaded from Firestore

  // Load products from Firestore (seeded by renderProductDatabase if empty)
  (async () => {
    try {
      const snap = await db.collection('products').get();
      allProds = snap.docs.map(d => ({ ...d.data(), cat: d.data().category || 'Other' }));
    } catch(e) { allProds = []; }
  })();

  // Quote number builder
  const buildQno = () => {
    const loc    = document.getElementById('bs-qno-loc')?.value || 'LU';
    const method = document.getElementById('bs-qno-method')?.value || 'FB';
    const dateEl = document.getElementById('bs-qno-date');
    const seq    = String(document.getElementById('bs-qno-seq')?.value || '1').padStart(3,'0');
    let datePart = 'YYMMDD';
    if (dateEl?.value) {
      const [y,m,d] = dateEl.value.split('-');
      datePart = `${y.slice(2)}${m}${d}`;
    }
    const qno = `BS-${loc}-${method}-${datePart}-${seq}`;
    const preview = document.getElementById('bs-qno-preview');
    const qnoField= document.getElementById('bs-quote-no');
    if (preview) preview.textContent = qno;
    if (qnoField) qnoField.value = qno;
    // update print header
    const phQno = document.getElementById('bs-ph-qno');
    if (phQno) phQno.textContent = qno;
    const phDate = document.getElementById('bs-ph-date');
    if (phDate) phDate.textContent = dateEl?.value ? new Date(dateEl.value+'T00:00:00').toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}) : '';
    const phAgent = document.getElementById('bs-ph-agent');
    if (phAgent) phAgent.textContent = document.getElementById('bs-salesperson')?.value || '';
    return qno;
  };

  // Set today's date
  document.getElementById('bs-qno-date').value = today();
  buildQno();

  ['bs-qno-loc','bs-qno-method','bs-qno-date','bs-qno-seq'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', buildQno);
    document.getElementById(id)?.addEventListener('change', buildQno);
  });
  document.getElementById('bs-salesperson')?.addEventListener('input', buildQno);

  // Product search
  const searchEl = document.getElementById('bs-product-search');
  const dd       = document.getElementById('bs-search-dd');

  const filterProds = (q) => {
    const term = q.toLowerCase();
    const matches = !term ? allProds : allProds.filter(p => p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term));
    if (!matches.length) { dd.innerHTML='<div style="padding:10px;color:var(--text-muted);font-size:12px">No products found</div>'; dd.classList.add('open'); return; }
    const byCat = {};
    matches.forEach(p => { if(!byCat[p.cat]) byCat[p.cat]=[]; byCat[p.cat].push(p); });
    dd.innerHTML = Object.entries(byCat).map(([cat,prods])=>
      `<div class="bs-sd-group">${escHtml(cat)}</div>` +
      prods.map(p=>`<div class="bs-sd-item" data-code="${escHtml(p.code)}" data-name="${escHtml(p.name)}" data-unit="${escHtml(p.unit)}" data-rate="${p.baseRate}">
        ${escHtml(p.name)} <span class="bs-sd-price">₱${p.baseRate.toLocaleString()}/${escHtml(p.unit)}</span></div>`).join('')
    ).join('');
    dd.classList.add('open');
    dd.querySelectorAll('.bs-sd-item').forEach(item => {
      item.addEventListener('click', () => {
        document.getElementById('bs-product-search').value = item.dataset.name;
        document.getElementById('bs-selected-code').value  = item.dataset.code;
        document.getElementById('bs-unit-price').placeholder = `Auto (₱${Number(item.dataset.rate).toLocaleString()}/${item.dataset.unit})`;
        document.getElementById('bs-unit-price').dataset.rate = item.dataset.rate;
        document.getElementById('bs-unit-price').dataset.unit = item.dataset.unit;
        dd.classList.remove('open');
        calcPreviewBS();
      });
    });
  };

  searchEl?.addEventListener('input', e => filterProds(e.target.value));
  searchEl?.addEventListener('focus', e => filterProds(e.target.value));
  document.addEventListener('click', e => { if(!e.target.closest('.bs-search-wrap')) dd.classList.remove('open'); });

  const calcPreviewBS = () => {
    const w = parseFloat(document.getElementById('bs-dim-w')?.value)||0;
    const d = parseFloat(document.getElementById('bs-dim-d')?.value)||0;
    const h = parseFloat(document.getElementById('bs-dim-h')?.value)||0;
    const qty = parseFloat(document.getElementById('bs-dim-qty')?.value)||1;
    const override = parseFloat(document.getElementById('bs-unit-price')?.value)||0;
    const rate     = parseFloat(document.getElementById('bs-unit-price')?.dataset?.rate)||0;
    let unitPrice = override || (rate && (w||d||h) ? (w*d*h/1e9)*rate + rate : rate);
    const preview = document.getElementById('bs-price-preview');
    if (preview) preview.textContent = unitPrice ? `≈ ₱${(unitPrice*qty).toLocaleString(undefined,{maximumFractionDigits:2})}` : '';
  };

  ['bs-dim-w','bs-dim-d','bs-dim-h','bs-dim-qty','bs-unit-price'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', calcPreviewBS)
  );

  const recalcBS = () => {
    // Group lines by category
    const catGroups = {};
    bsLines.forEach(line => {
      if (!catGroups[line.cat]) catGroups[line.cat] = [];
      catGroups[line.cat].push(line);
    });
    const tbody = document.getElementById('bs-items-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    let grand = 0;
    Object.entries(catGroups).forEach(([cat, lines]) => {
      // category header row
      const catTr = document.createElement('tr'); catTr.className='bs-cat-row';
      catTr.innerHTML=`<td colspan="8">${escHtml(cat)}</td>`;
      tbody.appendChild(catTr);
      let catSubtotal = 0;
      lines.forEach(line => {
        catSubtotal += line.amount;
        grand += line.amount;
        const tr = document.createElement('tr');
        tr.dataset.id = line.id;
        const dimStr = [line.w?`W${line.w}`:null, line.d?`D${line.d}`:null, line.h?`H${line.h}`:null].filter(Boolean).join(' × ');
        tr.innerHTML = `
          <td>${bsRowCount}</td>
          <td><div contenteditable="true" class="bs-desc-edit" data-id="${line.id}">${escHtml(line.name)}</div>${line.notes?`<div style="font-size:11px;color:var(--text-muted);margin-top:1px" contenteditable="true">${escHtml(line.notes)}</div>`:''}</td>
          <td style="font-size:11px">${dimStr||'—'}</td>
          <td style="text-align:center"><input type="number" class="bs-qty-inp" value="${line.qty}" min="1" data-id="${line.id}" style="width:50px;text-align:center;border:1.5px solid var(--border);border-radius:4px;padding:3px;font-size:12px" inputmode="decimal"/></td>
          <td style="text-align:center">${escHtml(line.unit)}</td>
          <td style="text-align:right">₱${fmt(line.unitPrice)}</td>
          <td style="text-align:right">₱${fmt(line.amount)}</td>
          <td class="no-print"><button class="btn-icon" style="color:#c62828;font-size:15px" data-del="${line.id}">✕</button></td>
        `;
        tbody.appendChild(tr);
        // qty change
        tr.querySelector('.bs-qty-inp').addEventListener('change', e => {
          const l = bsLines.find(x=>x.id===line.id);
          if (l) { l.qty=parseFloat(e.target.value)||1; l.amount=l.qty*l.unitPrice; recalcBS(); }
        });
        tr.querySelector('[data-del]').addEventListener('click', e => {
          bsLines = bsLines.filter(x=>x.id!==e.currentTarget.dataset.del); recalcBS();
        });
      });
      // subtotal row
      const stTr = document.createElement('tr'); stTr.className='bs-subtotal-row';
      stTr.innerHTML=`<td colspan="6">Subtotal — ${escHtml(cat)}</td><td>₱${fmt(catSubtotal)}</td><td class="no-print"></td>`;
      tbody.appendChild(stTr);
    });

    // update count
    document.getElementById('bs-item-count').textContent = `${bsLines.length} item${bsLines.length!==1?'s':''}`;
    const empty = document.getElementById('bs-empty-state');
    const tableWrap = document.getElementById('bs-table-wrap');
    const totalsWrap= document.getElementById('bs-totals-wrap');
    if (bsLines.length) { empty.style.display='none'; tableWrap.style.display=''; totalsWrap.style.display=''; }
    else { empty.style.display=''; tableWrap.style.display='none'; totalsWrap.style.display='none'; return; }

    // totals
    const discPct = parseFloat(document.getElementById('bs-disc-sel')?.value)||0;
    const vatCheck= document.getElementById('bs-vat-check')?.checked||false;
    const dpPct   = parseFloat(document.getElementById('bs-dp-pct-input')?.value)||65;
    const discount = grand * (discPct/100);
    const afterDisc = grand - discount;
    const vat = vatCheck ? afterDisc * 0.12 : 0;
    const grandTotal = afterDisc + vat;
    const dp  = grandTotal * (dpPct/100);
    const bal = grandTotal - dp;

    document.getElementById('bs-subtotal-display').textContent = `₱${fmt(grand)}`;
    document.getElementById('bs-disc-pct-lbl').textContent = discPct;
    document.getElementById('bs-disc-display').textContent  = `–₱${fmt(discount)}`;
    document.getElementById('bs-disc-row').style.display    = discPct>0?'':'none';
    document.getElementById('bs-vat-display').textContent   = `₱${fmt(vat)}`;
    document.getElementById('bs-vat-row').style.display     = vatCheck?'':'none';
    document.getElementById('bs-grand-display').textContent = `₱${fmt(grandTotal)}`;
    document.getElementById('bs-dp-pct').textContent        = dpPct;
    document.getElementById('bs-dp-display').textContent    = `₱${fmt(dp)}`;
    document.getElementById('bs-bal-display').textContent   = `₱${fmt(bal)}`;

    return grandTotal;
  };

  document.getElementById('bs-add-item-btn')?.addEventListener('click', () => {
    const name = document.getElementById('bs-product-search')?.value?.trim();
    const code = document.getElementById('bs-selected-code')?.value || '';
    const unitPrice = parseFloat(document.getElementById('bs-unit-price')?.value)
      || parseFloat(document.getElementById('bs-unit-price')?.dataset?.rate) || 0;
    const qty  = parseFloat(document.getElementById('bs-dim-qty')?.value)||1;
    const w    = document.getElementById('bs-dim-w')?.value || '';
    const d    = document.getElementById('bs-dim-d')?.value || '';
    const h    = document.getElementById('bs-dim-h')?.value || '';
    const unit = document.getElementById('bs-unit-price')?.dataset?.unit || 'unit';
    if (!name) { Notifs.showToast('Enter a product name','error'); return; }
    // find category
    const prod = allProds.find(p=>p.code===code);
    const cat  = prod?.cat || 'Custom';
    bsRowCount++;
    bsLines.push({ id: Date.now().toString(), name, code, cat, w, d, h, qty, unit, unitPrice, amount: qty*unitPrice, notes:'' });
    recalcBS();
    // clear
    document.getElementById('bs-product-search').value = '';
    document.getElementById('bs-selected-code').value  = '';
    document.getElementById('bs-unit-price').value     = '';
    document.getElementById('bs-unit-price').dataset.rate = '';
    document.getElementById('bs-unit-price').placeholder = 'Auto';
    document.getElementById('bs-dim-w').value='';
    document.getElementById('bs-dim-d').value='';
    document.getElementById('bs-dim-h').value='';
    document.getElementById('bs-dim-qty').value='1';
    document.getElementById('bs-price-preview').textContent='';
  });

  ['bs-vat-check','bs-disc-sel','bs-dp-pct-input'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', recalcBS)
  );

  // Save Draft
  document.getElementById('bs-save-btn')?.addEventListener('click', async () => {
    const qno = document.getElementById('bs-quote-no')?.value || buildQno();
    const clientName = document.getElementById('bs-client-name')?.value?.trim() || 'Client';
    const total = recalcBS() || 0;
    const s = await db.collection('users').doc(currentUser.uid).get();
    const agentName = s.exists ? s.data().displayName : currentUser.email;
    await db.collection('bs_quotes').add({
      quoteNumber: qno,
      clientName,
      clientCompany: document.getElementById('bs-client-company')?.value?.trim()||'',
      clientAddress: document.getElementById('bs-client-address')?.value?.trim()||'',
      clientContact: document.getElementById('bs-client-contact')?.value?.trim()||'',
      clientTin: document.getElementById('bs-client-tin')?.value?.trim()||'',
      salesperson: document.getElementById('bs-salesperson')?.value?.trim()||'',
      purpose: document.getElementById('bs-purpose')?.value||'',
      lines: bsLines,
      total,
      status: 'draft',
      approvalStatus: '',
      agentName,
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    Notifs.showToast('Quote saved as draft!');
  });

  // Request for Approval button
  document.getElementById('bs-request-approval-btn')?.addEventListener('click', async () => {
    const qno = document.getElementById('bs-quote-no')?.value || buildQno();
    const clientName = document.getElementById('bs-client-name')?.value?.trim();
    if (!clientName) { Notifs.showToast('Enter client name before requesting approval','error'); return; }
    if (!bsLines.length) { Notifs.showToast('Add at least one item','error'); return; }
    const total = recalcBS() || 0;
    const filename = `quotation_${clientName.replace(/\s+/g,'_')}_${qno}`;
    const s = await db.collection('users').doc(currentUser.uid).get();
    const agentName = s.exists ? s.data().displayName : currentUser.email;
    // Save quote with pending approval status
    const docRef = await db.collection('bs_quotes').add({
      quoteNumber: qno,
      clientName,
      clientCompany: document.getElementById('bs-client-company')?.value?.trim()||'',
      clientAddress: document.getElementById('bs-client-address')?.value?.trim()||'',
      clientContact: document.getElementById('bs-client-contact')?.value?.trim()||'',
      salesperson: document.getElementById('bs-salesperson')?.value?.trim()||'',
      purpose: document.getElementById('bs-purpose')?.value||'',
      lines: bsLines, total,
      status: 'sent',
      approvalStatus: 'pending_review',
      filename,
      agentName,
      createdBy: currentUser.uid,
      reviewRequestedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Create approval request record
    await db.collection('approval_requests').add({
      type: 'bs_quote',
      quoteId: docRef.id,
      quoteNumber: qno,
      clientName,
      total,
      filename,
      agentName,
      agentId: currentUser.uid,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Notify president
    await Notifs.sendToOwner({
      title: '⚙️ Brilliant Steel Quote — Approval Needed',
      body: `${agentName} submitted "${qno}" for ${clientName} — ₱${fmt(total)}`,
      icon: '⚙️', type: 'quote_review_request'
    });
    Notifs.showToast(`Approval request sent! File: ${filename}`);
    // Switch to Quotations Summary
    loadBSContent(currentUser, currentRole, 'Quotations Summary');
    const activeBtns = document.querySelectorAll('.subtab-btn');
    activeBtns.forEach(b => b.classList.toggle('active', b.dataset.sub === 'Quotations Summary'));
  });
}

// ── Brilliant Steel Quotations Summary ────────────
async function renderBSQuotationsSummary(container, currentUser, currentRole) {
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager';
  // Sales dept employees can see all quotes (including partner-filed); partners only see their own
  const canSeeAll = isPrivileged ||
    (currentRole === 'employee' && (window.currentDepts||[]).includes('Sales'));
  const isPartnerRole = currentRole === 'partner';
  const snap = canSeeAll
    ? await db.collection('bs_quotes').get()
    : await db.collection('bs_quotes').where('createdBy','==',currentUser.uid).get();
  const all = snap.docs.map(d=>({id:d.id,...d.data()}))
    // Partners cannot see records created by Sales (non-partner) users
    .filter(q => !isPartnerRole || q.createdBy === currentUser.uid)
    .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const forApproval   = all.filter(q=>q.status==='pending_approval'||q.approvalStatus==='pending_review'||q.status==='sent');
  const filed         = all.filter(q=>q.status==='filed'||q.approvalStatus==='approved');
  const drafts        = all.filter(q=>!q.status||q.status==='draft');
  const needsRevision = all.filter(q=>q.status==='needs_revision'||q.approvalStatus==='needs_revision');
  const rejected      = all.filter(q=>q.approvalStatus==='rejected'||q.status==='rejected');

  const renderList = (quotes) => !quotes.length
    ? '<div class="empty-state" style="padding:30px"><div class="empty-icon">📋</div><h4>No quotations here</h4></div>'
    : `<div class="card"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Quote #</th><th>Client</th><th>Total</th><th>Agent</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${quotes.map(q=>{
          const status = q.status||q.approvalStatus||'draft';
          const badge = status==='filed'||status==='approved'?'badge-green':status==='pending_approval'||status==='pending_review'||status==='sent'?'badge-orange':status==='rejected'?'badge-red':'badge-gray';
          const ts = q.createdAt?.toDate?q.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}):'';
          const canDeleteDirect = currentRole==='president'||currentRole==='owner'||currentRole==='manager';
          return `<tr>
            <td><code>${escHtml(q.quoteNumber||q.id.slice(-8))}</code></td>
            <td><strong>${escHtml(q.clientName||'—')}</strong><div style="font-size:11px;color:var(--text-muted)">${escHtml(q.clientCompany||'')}</div></td>
            <td>₱${fmt(q.total||q.grandTotal||0)}</td>
            <td>${escHtml(q.agentName||q.createdByName||'—')}</td>
            <td>
              <span class="badge ${badge}">${status}</span>
              ${q.deleteRequested?'<span class="badge badge-red" style="font-size:9px;margin-left:4px">🗑 del req</span>':''}
              <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${ts}</div>
            </td>
            <td style="white-space:nowrap;display:flex;gap:6px;flex-wrap:wrap">
              ${isPrivileged&&(status==='pending_approval'||status==='pending_review'||status==='sent')?`
                <button class="btn-primary btn-sm bs-approve-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${escHtml(q.clientName||'')}" data-qno="${escHtml(q.quoteNumber||'')}">✅ Approve</button>
                <button class="btn-danger btn-sm bs-reject-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${escHtml(q.clientName||'')}" data-qno="${escHtml(q.quoteNumber||'')}">❌ Reject</button>
                <button class="btn-secondary btn-sm bs-edit-return-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${escHtml(q.clientName||'')}" data-qno="${escHtml(q.quoteNumber||'')}">✎ Edit &amp; Return</button>
              `:''}
              ${(status==='filed'||status==='approved')?`<button class="btn-secondary btn-sm bs-reopen-btn" data-id="${q.id}" title="Open this quote in the builder to edit — re-filing saves a new copy">↻ Reopen</button>`:''}
              ${(status==='filed'||status==='approved')&&q.editableState?`<button class="btn-secondary btn-sm bs-rev-btn" data-id="${q.id}" title="Start a new revision (R2, R3…) for this client with today's date">⎘ New Revision</button>`:''}
              ${(status==='filed'||status==='approved')?`<button class="btn-success btn-sm bs-so-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" data-client="${escHtml(q.clientName||'')}" data-total="${q.total||q.grandTotal||0}" data-co="${escHtml(q.company||'BS')}" ${q.salesOrderId?'disabled':''}>${q.salesOrderId?'✓ Ordered':'🧾 Sales Order'}</button>`:''}
              ${canDeleteDirect
                ? `<button class="btn-secondary btn-sm bs-del-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" style="color:var(--danger)">🗑 Delete</button>`
                : `<button class="btn-secondary btn-sm bs-delreq-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" ${q.deleteRequested?'disabled':''}>${q.deleteRequested?'⏳ Requested':'🗑 Request Delete'}</button>`}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div></div>`;

  // ── Quote analytics ──
  // Successful = quotes that became SALES ORDERS (have salesOrderId). Pipeline =
  // overall amount of ALL quotes produced. Won = total of those converted to orders.
  // Count only the LATEST revision of each quote so R1+R2… don't inflate the
  // pipeline value / quote count (same dedup as the BK summary).
  const { latest: bsActive } = window.latestQuoteRevisions(all);
  const totalMade   = bsActive.length;
  const wonQuotes   = bsActive.filter(q=>q.salesOrderId);
  const successful  = wonQuotes.length;
  const winRate     = totalMade ? Math.round(successful/totalMade*100) : 0;
  const wonValue    = wonQuotes.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
  const pipelineVal = bsActive.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
  const analytics = `
    <div class="card" style="margin-bottom:14px;border:1.5px solid var(--primary)">
      <div class="card-header"><h3>📊 Quote Analytics</h3></div>
      <div class="card-body">
        <div class="kpi-row">
          <div class="kpi-card"><div class="kpi-label">Quotes Made</div><div class="kpi-value">${totalMade}</div></div>
          <div class="kpi-card green"><div class="kpi-label">Successful</div><div class="kpi-value">${successful}</div></div>
          <div class="kpi-card accent"><div class="kpi-label">Win Rate</div><div class="kpi-value">${winRate}%</div></div>
          <div class="kpi-card"><div class="kpi-label">Pipeline ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(pipelineVal)}</div></div>
          <div class="kpi-card green"><div class="kpi-label">Won ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(wonValue)}</div></div>
        </div>
      </div>
    </div>`;
  const kpiRow = `
    ${analytics}
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card warn"><div class="kpi-label">Pending Approval</div><div class="kpi-value">${forApproval.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Filed / Approved</div><div class="kpi-value">${filed.length}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Needs Revision</div><div class="kpi-value">${needsRevision.length}</div></div>
      <div class="kpi-card red"><div class="kpi-label">Rejected</div><div class="kpi-value">${rejected.length}</div></div>
    </div>`;

  container.innerHTML = `
    ${kpiRow}
    <div class="subtab-bar" style="margin-top:0;flex-wrap:wrap">
      <button class="subtab-btn active" data-qsub="filed">Filed / Approved (${filed.length})</button>
      <button class="subtab-btn" data-qsub="for-approval">Pending Approval (${forApproval.length})</button>
      ${needsRevision.length?`<button class="subtab-btn" data-qsub="needs-revision" style="border-color:var(--warning);color:var(--warning)">↩ Needs Revision (${needsRevision.length})</button>`:''}
      <button class="subtab-btn" data-qsub="drafts">Drafts (${drafts.length})</button>
      <button class="subtab-btn" data-qsub="rejected">Rejected (${rejected.length})</button>
    </div>
    <div id="qs-content">${renderList(filed)}</div>
  `;

  const qsContent = container.querySelector('#qs-content');
  container.querySelectorAll('[data-qsub]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-qsub]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const which = btn.dataset.qsub;
      const listMap = { 'filed': filed, 'for-approval': forApproval, 'drafts': drafts, 'rejected': rejected, 'needs-revision': needsRevision };
      qsContent.innerHTML = renderList(listMap[which]||[]);
      bindQuoteActions(qsContent, currentUser, currentRole, container);
    });
  });
  bindQuoteActions(qsContent, currentUser, currentRole, container);
}

// Show + copy the public client order-tracking link (reuses the shared modal).
// Short, on-brand tracking URL (own domain, short /t/ path + short code) — no
// third-party shortener (those read as suspicious). e.g. …ravenmails.com/t/?A1b2C3d4
window.orderTrackUrl = function(token){ return `${location.origin}/t/?${token}`; };

// Unguessable short code for a public tracking doc id. 8 chars from a 54-char
// unambiguous alphabet (no 0/O/1/I/l) ≈ 7×10¹³ combos — plenty for order status.
window.makeTrackCode = function(len){
  len = len || 8;
  var A = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', out = '';
  try { var a = new Uint32Array(len); (window.crypto||window.msCrypto).getRandomValues(a);
    for (var i=0;i<len;i++) out += A[a[i] % A.length];
  } catch(_) { for (var j=0;j<len;j++) out += A[Math.floor(Math.random()*A.length)]; }
  return out;
};
async function uniqueTrackCode(){
  for (let i=0;i<5;i++){
    const code = window.makeTrackCode(8);
    try { const s = await db.collection('order_tracking').doc(code).get(); if(!s.exists) return code; }
    catch(_){ return code; }   // read blocked → collision odds are negligible anyway
  }
  return window.makeTrackCode(11);
}
window.showOrderTrackModal = function(url, orderNo){
  openModal('🔗 Client Order-Tracking Link', `
    <p style="font-size:13px;color:var(--text-2);margin-bottom:12px">Share this link with the client for <strong>${escHtml(orderNo||'their order')}</strong>. They can open it any time — <strong>no login needed</strong> — to see their order status, dates and balance. Internal costs are never shown.</p>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="track-url" readonly value="${escHtml(url)}" style="flex:1;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px" onclick="this.select()"/>
      <button class="btn-primary btn-sm" id="track-copy" style="white-space:nowrap">Copy</button>
    </div>
    <div style="margin-top:12px"><a href="${escHtml(url)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--primary);font-weight:600">Preview the client view ↗</a></div>
  `, `<button class="btn-secondary" onclick="closeModal()">Done</button>`);
  const btn=document.getElementById('track-copy');
  btn?.addEventListener('click', async ()=>{
    const inp=document.getElementById('track-url');
    try{ await navigator.clipboard.writeText(inp.value); }catch(_){ inp.select(); try{document.execCommand('copy');}catch(__){} }
    btn.textContent='✓ Copied'; setTimeout(()=>{btn.textContent='Copy';},1600);
    Notifs.showToast('Tracking link copied','success');
  });
};

// Update a client's PUBLIC tracking doc (status advance, payment, dates). Keyed by
// the token stamped on the order/project. Best-effort — never blocks the caller.
// Passing `status` also stamps that stage's date (deep-merged, preserves history).
window.syncOrderTracking = async function(token, patch){
  if(!token || !patch) return;
  try{
    const upd = Object.assign({}, patch, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    if(patch.status){
      const day = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
      upd.stageStamps = { [patch.status]: day };   // set-merge deep-merges the map
    }
    await db.collection('order_tracking').doc(token).set(upd, { merge:true });
  }catch(_){ /* best-effort */ }
};

// Return the tracking token for a sales order, creating the public tracking doc
// on demand if it doesn't exist yet (e.g. orders made before this feature). Lets
// the "🔗 Link" button re-surface a shareable link for ANY order.
window.ensureOrderTracking = async function(o){
  if(o.trackingToken) return o.trackingToken;
  const dayStr = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
  let orderNo = o.quoteNumber || '';
  if(o.projectId){ try{ const ps=await db.collection('job_projects').doc(o.projectId).get(); if(ps.exists) orderNo = ps.data().projectNo || orderNo; }catch(_){} }
  const paid = o.recordedAmount || o.paymentReceived || 0;
  const tRef = db.collection('order_tracking').doc(await uniqueTrackCode());
  await tRef.set({
    orderId:o.id, projectId:o.projectId||null, orderNo:orderNo||('SO-'+o.id.slice(-6).toUpperCase()),
    clientName:o.clientName||'', company:(o.company==='BK'?'Barro Kitchens':'Brilliant Steel'), scope:o.project||'',
    status:(o.sentToProduction?'production':'confirmed'), stageStamps:{ confirmed:dayStr },
    contractAmount:o.contractAmount||0, paid, balance:Math.max(0,(o.contractAmount||0)-paid),
    orderDate:dayStr, expectedDate:null,
    publicNote:'Thank you for your order! This page updates as your order moves through production and delivery.',
    createdAt:firebase.firestore.FieldValue.serverTimestamp(), updatedAt:firebase.firestore.FieldValue.serverTimestamp()
  });
  try{ await db.collection('sales_orders').doc(o.id).update({ trackingToken:tRef.id }); }catch(_){}
  if(o.projectId){ try{ await db.collection('job_projects').doc(o.projectId).update({ trackingToken:tRef.id }); }catch(_){} }
  o.trackingToken = tRef.id;
  return tRef.id;
};

// Convert a won quote into a Sales Order: capture payment + receipt, route to Finance.
async function openSalesOrderModal(d, currentUser, currentRole, container){
  const total = parseFloat(d.total)||0;
  openPage('🧾 Create Sales Order', `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Client <strong>${escHtml(d.client||'')}</strong> · Quote ${escHtml(d.qno||'')}</div>
    <div class="form-group"><label>Project / Scope</label><input id="so-project" value="${escHtml((d.client||'')+' — '+(d.qno||''))}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Contract Amount (₱)</label><input id="so-contract" type="number" step="0.01" value="${total}" inputmode="decimal"/></div>
      <div class="form-group"><label>Payment Received (₱)</label><input id="so-paid" type="number" step="0.01" placeholder="e.g. downpayment" inputmode="decimal"/></div>
    </div>
    <div class="form-group"><label>Payment Method</label>
      <select id="so-method" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"><option>Bank Transfer</option><option>GCash</option><option>Cash</option><option>Cheque</option><option>Other</option></select>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="so-notes" rows="2" placeholder="Payment ref #, schedule, etc."></textarea></div>
    <div class="form-group"><label>Receipt / Proof of Payment</label><div id="so-receipt-upload"></div></div>
    <div id="so-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="so-save">Create &amp; Send to Finance</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  let receipt=null;
  if(window.Drive?.renderUploadArea) Drive.renderUploadArea('so-receipt-upload',(r)=>{receipt=r;},{label:'Upload receipt (photo/PDF)',accept:'image/*,.pdf',dept:'Finance',subfolder:'SalesOrders'});
  document.getElementById('so-save').addEventListener('click', async ()=>{
    const err=document.getElementById('so-err');
    const contract=parseFloat(document.getElementById('so-contract').value)||0;
    const paid=parseFloat(document.getElementById('so-paid').value)||0;
    const project=document.getElementById('so-project').value.trim();
    if(!project){ err.textContent='Project is required.'; err.classList.remove('hidden'); return; }
    try{
      // 1) create the master project (the spine that ties the whole job together)
      const proj = await createJobProject({ ...d, total:contract });
      // 2) sales order, linked to the project
      const ref=await db.collection('sales_orders').add({
        projectId:proj.id, quoteId:d.id, quoteNumber:d.qno||'', clientName:d.client||'', company:d.co||'BS',
        project, contractAmount:contract, paymentReceived:paid,
        paymentMethod:document.getElementById('so-method').value,
        notes:document.getElementById('so-notes').value.trim(),
        receiptUrl:receipt?.url||null, receiptName:receipt?.name||null,
        status:'pending', createdBy:currentUser.uid, createdByName:userProfile?.displayName||currentUser.email,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      // 3) stamp the back-links onto the quote IN THE CORRECT COLLECTION (BK or BS — was hardcoded to bs_quotes)
      const qc = (d.co==='BK') ? 'bk_quotes' : 'bs_quotes';
      try{ await db.collection(qc).doc(d.id).update({ salesOrderId:ref.id, projectId:proj.id, status:'won' }); }catch(_){}
      // 4) record the Sales Order on the project's document register + link the SO id
      try{ await db.collection('job_projects').doc(proj.id).update({ salesOrderId:ref.id,
        documents:firebase.firestore.FieldValue.arrayUnion({ type:'Sales Order', ref:proj.projectNo, at:new Date().toISOString(), by:userProfile?.displayName||currentUser.email }) }); }catch(_){}
      // 5) client order-tracking link — created once the downpayment is captured.
      //    Public, unguessable token; client-SAFE fields only (no cost/margin).
      let trackUrl='';
      try{
        const tRef = db.collection('order_tracking').doc(await uniqueTrackCode());
        const dayStr = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
        await tRef.set({
          orderId:ref.id, projectId:proj.id, orderNo:proj.projectNo, clientName:d.client||'',
          company:(d.co==='BK'?'Barro Kitchens':'Brilliant Steel'), scope:project,
          status:'confirmed', stageStamps:{ confirmed:dayStr },
          contractAmount:contract, paid:paid, balance:Math.max(0,contract-paid),
          orderDate:dayStr, expectedDate:null,
          publicNote:'Thank you for your order! This page updates as your order moves through production and delivery.',
          createdAt:firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('sales_orders').doc(ref.id).update({ trackingToken:tRef.id }).catch(()=>{});
        await db.collection('job_projects').doc(proj.id).update({ trackingToken:tRef.id }).catch(()=>{});
        trackUrl = window.orderTrackUrl(tRef.id);
      }catch(_){ /* tracking is best-effort — never block the order */ }
      window.logAudit&&window.logAudit('create','sales_order',ref.id,{client:d.client, contract, paid, projectNo:proj.projectNo});
      const who=userProfile?.displayName||currentUser.email;
      try{ await Notifs.sendToDept('Finance',{ title:'🧾 New Sales Order', body:`${who}: ${d.client} — ₱${contract.toLocaleString()} (₱${paid.toLocaleString()} received). Project ${proj.projectNo}. Record income + verify receipt.`, icon:'🧾', type:'sales_order', link:'sales-orders' }); }catch(_){}
      try{ await Notifs.sendToDept('Production',{ title:'🏭 New job to produce', body:`${d.client} (${proj.projectNo}) won — create the production order when ready.`, icon:'🏭', type:'project_stage', link:'projects-lifecycle' }, { fallbackToOwner:true }); }catch(_){}
      try{ await Notifs.sendToOwner({ title:'🤝 Quote won → Project '+proj.projectNo, body:`${d.client} — ₱${contract.toLocaleString()} closed by ${who}.`, icon:'🤝', type:'sales_order' }); }catch(_){}
      Notifs.showToast('Sales order + project '+proj.projectNo+' created');
      if (typeof container!=='undefined' && container) {
        if (d.co==='BK') renderBKQuotationsSummary(container, currentUser, currentRole);
        else renderBSQuotationsSummary(container, currentUser, currentRole);
      }
      // Surface the shareable client tracking link (falls back to just closing).
      if (trackUrl) window.showOrderTrackModal(trackUrl, proj.projectNo);
      else closeModal();
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
}

// Finance/admin view of incoming sales orders — record income to the ledger.
window.renderSalesOrders = async function(container){
  const c = container || deptContainer();
  // Anyone non-partner can SEE the list (read rule). Recording posts to the ledger,
  // which is open to finance/admin roles OR Finance-DEPARTMENT staff (matching the
  // canFinance() Firestore rule), so a Finance-dept member can register the sale.
  const isFin = ['president','owner','manager','finance'].includes(currentRole) || (window.currentDepts||[]).includes('Finance');
  c.innerHTML='<div class="loading-placeholder">Loading sales orders…</div>';
  const snap = await db.collection('sales_orders').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
  const orders = snap.docs.map(d=>({id:d.id,...d.data()}));
  const pending = orders.filter(o=>o.status!=='recorded');
  const totalContract = orders.reduce((s,o)=>s+(o.contractAmount||0),0);
  const totalRecorded = orders.filter(o=>o.status==='recorded').reduce((s,o)=>s+(o.recordedAmount||o.paymentReceived||0),0);
  c.innerHTML = `
    <div class="page-header"><h2>🧾 Sales Orders</h2><span style="font-size:12px;color:var(--text-muted)">Record the sale &amp; payment, then hand off to Production</span></div>
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Orders</div><div class="kpi-value">${orders.length}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">To Record</div><div class="kpi-value">${pending.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Contract ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalContract)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Recorded ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalRecorded)}</div></div>
    </div>
    <div class="card"><div class="card-body" style="padding:0">
    ${!orders.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">🧾</div><h4>No sales orders yet</h4><p>They appear here when a won quote is converted to a sales order.</p></div>':
    `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Date</th><th>Client / Project</th><th>Contract</th><th>Received</th><th>Method</th><th>Receipt</th><th>By</th><th>Status</th><th></th></tr></thead>
      <tbody>${orders.map(o=>`<tr>
        <td>${o.createdAt?.toDate?o.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric'}):''}</td>
        <td><strong>${escHtml(o.clientName||'')}</strong><div style="font-size:11px;color:var(--text-muted)">${escHtml(o.project||'')}${o.quoteNumber?' · '+escHtml(o.quoteNumber):''}</div></td>
        <td>₱${fmt(o.contractAmount||0)}</td>
        <td>₱${fmt(o.recordedAmount||o.paymentReceived||0)}</td>
        <td style="font-size:12px">${escHtml(o.paymentMethod||'')}</td>
        <td>${o.receiptUrl?`<a href="${escHtml(o.receiptUrl)}" target="_blank" class="btn-icon">📎</a>`:'—'}</td>
        <td style="font-size:11px">${escHtml(o.createdByName||'')}</td>
        <td><span class="badge ${o.status==='recorded'?'badge-green':'badge-orange'}">${escHtml(o.status||'pending')}</span>${o.sentToProduction?'<span class="badge badge-blue" style="font-size:9px;margin-left:4px">🏭 in production</span>':''}</td>
        <td style="white-space:nowrap"><button class="btn-secondary btn-sm so-link-btn" data-id="${o.id}" title="Copy the client order-tracking link">🔗 Link</button>${isFin?` ${o.status!=='recorded'?`<button class="btn-success btn-sm so-record-btn" data-id="${o.id}">Record Sale</button>`:(!o.sentToProduction?`<button class="btn-secondary btn-sm so-prod-btn" data-id="${o.id}">🏭 To Production</button>`:'✓')}`:''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`}
    </div></div>`;
  // Tracking link is available to every viewer of this list (non-partner).
  c.querySelectorAll('.so-link-btn').forEach(b=>b.addEventListener('click', async ()=>{
    const o = orders.find(x=>x.id===b.dataset.id); if(!o) return;
    const orig=b.textContent; b.disabled=true; b.textContent='…';
    try{ const tok = await window.ensureOrderTracking(o); window.showOrderTrackModal(window.orderTrackUrl(tok), o.clientName||o.project||''); }
    catch(e){ Notifs.showToast('Could not create link: '+(e.message||e.code),'error'); }
    b.disabled=false; b.textContent=orig;
  }));
  if(isFin){
    c.querySelectorAll('.so-record-btn').forEach(b=>b.addEventListener('click', ()=>{
      const o = orders.find(x=>x.id===b.dataset.id); if(o) openRecordSaleModal(o, container);
    }));
    c.querySelectorAll('.so-prod-btn').forEach(b=>b.addEventListener('click', async ()=>{
      const o = orders.find(x=>x.id===b.dataset.id); if(!o) return;
      await transferOrderToProduction(o); window.renderSalesOrders(container);
    }));
  }
};

// Split an entered amount into {recorded, net, vat} for a given VAT treatment.
// `recorded` is what hits the ledger + project balance (the cash figure); `net`
// is revenue net of VAT; `vat` is the output VAT. Used by the sale + project
// billing flows so each sale's VAT is stored per-entry (it varies by quote).
//   inclusive → the amount already contains 12% VAT
//   exclusive → 12% is added on top of the amount
//   exempt    → zero-rated / VAT-exempt, no VAT
window.vatSplit = function(entered, treatment) {
  const a = +entered || 0;
  if (treatment === 'exclusive') {
    const vat = +(a * 0.12).toFixed(2);
    return { recorded: +(a + vat).toFixed(2), net: +a.toFixed(2), vat };
  }
  if (treatment === 'exempt') {
    return { recorded: +a.toFixed(2), net: +a.toFixed(2), vat: 0 };
  }
  const net = +(a / 1.12).toFixed(2); // inclusive (default)
  return { recorded: +a.toFixed(2), net, vat: +(a - net).toFixed(2) };
};

// Finance records the sale + received payment, posts it to the ledger AND syncs the
// linked project's collected/AR, then optionally hands the job off to Production.
// This is the single bridge that was missing — previously "Record Income" only
// touched the ledger, so the Projects tab never reflected the money or the handoff.
function openRecordSaleModal(o, container){
  const contract = o.contractAmount||0;
  const salesNoted = o.paymentReceived||0;
  const defaultAmt = o.recordedAmount||salesNoted||0;
  openPage('💵 Register Sale — '+escHtml(o.clientName||''), `
    <div class="card" style="margin-bottom:12px"><div class="card-body" style="padding:10px 14px;font-size:12px">
      <div style="font-weight:700;margin-bottom:6px">📋 Sales Order Terms</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px">
        <span style="color:var(--text-muted)">Client / Project</span><span style="text-align:right">${escHtml(o.clientName||'')}${o.project?' · '+escHtml(o.project):''}</span>
        <span style="color:var(--text-muted)">Quote</span><span style="text-align:right">${escHtml(o.quoteNumber||'—')}</span>
        <span style="color:var(--text-muted)">Contract amount</span><span style="text-align:right;font-weight:700">₱${fmt(contract)}</span>
        <span style="color:var(--text-muted)">Payment noted by Sales</span><span style="text-align:right">₱${fmt(salesNoted)} ${o.paymentMethod?'· '+escHtml(o.paymentMethod):''}</span>
        ${o.notes?`<span style="color:var(--text-muted)">Terms / notes</span><span style="text-align:right">${escHtml(o.notes)}</span>`:''}
        ${o.receiptUrl?`<span style="color:var(--text-muted)">Receipt</span><span style="text-align:right"><a href="${escHtml(o.receiptUrl)}" target="_blank">📎 View proof</a></span>`:''}
      </div>
    </div></div>
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">✅ Approve the collected amount</div>
    <div class="form-row">
      <div class="form-group"><label>Approved collected (₱)</label><input id="rs-amount" type="number" step="0.01" min="0" value="${defaultAmt}" inputmode="decimal"/>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Confirm what Finance actually received per the order terms.</div></div>
      <div class="form-group"><label>Method</label><select id="rs-method" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        ${['Bank Transfer','GCash','Cash','Cheque','Other'].map(m=>`<option ${o.paymentMethod===m?'selected':''}>${m}</option>`).join('')}
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>VAT treatment</label>
        <select id="rs-vat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="inclusive" selected>VAT-inclusive — 12% already in the amount</option>
          <option value="exclusive">VAT-exclusive — add 12% on top</option>
          <option value="exempt">VAT-exempt / Zero-rated — no VAT</option>
        </select>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Pick what the quote/sales order specified — it varies per deal.</div>
      </div>
      <div class="form-group"><label>OR / Reference No.</label><input id="rs-ref" placeholder="Official Receipt no."/></div>
    </div>
    <div class="card" style="margin:6px 0"><div class="card-body" style="padding:8px 14px;font-size:12px;display:grid;grid-template-columns:1fr auto;gap:2px 12px">
      <span style="color:var(--text-muted)">Recorded total (to ledger &amp; project)</span><span id="rs-appr" style="text-align:right;font-weight:700;color:var(--success)">₱${fmt(defaultAmt)}</span>
      <span style="color:var(--text-muted)">Net of VAT</span><span id="rs-net" style="text-align:right">₱${fmt(+(defaultAmt/1.12).toFixed(2))}</span>
      <span style="color:var(--text-muted)">Output VAT (12%)</span><span id="rs-vatamt" style="text-align:right">₱${fmt(+(defaultAmt-defaultAmt/1.12).toFixed(2))}</span>
      <span style="color:var(--text-muted)">Balance after this</span><span id="rs-bal" style="text-align:right;font-weight:700">₱${fmt(Math.max(0,contract-defaultAmt))}</span>
    </div></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-top:4px;cursor:pointer">
      <input type="checkbox" id="rs-prod" checked style="width:16px;height:16px"/> Transfer to Production now (start the job)
    </label>
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Posts income to the ledger (with VAT split), updates the project's collected balance, and notifies Production.</div>
    <div id="rs-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="rs-save">Approve &amp; Record</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  const recompute=()=>{
    const entered=parseFloat(document.getElementById('rs-amount').value)||0;
    const t=document.getElementById('rs-vat').value;
    const { recorded, net, vat }=window.vatSplit(entered,t);
    document.getElementById('rs-appr').textContent='₱'+fmt(recorded);
    document.getElementById('rs-net').textContent='₱'+fmt(net);
    document.getElementById('rs-vatamt').textContent='₱'+fmt(vat);
    document.getElementById('rs-bal').textContent='₱'+fmt(Math.max(0,contract-recorded));
  };
  document.getElementById('rs-amount').addEventListener('input',recompute);
  document.getElementById('rs-vat').addEventListener('change',recompute);
  document.getElementById('rs-save').addEventListener('click', async ()=>{
    const err=document.getElementById('rs-err');
    const saveBtn=document.getElementById('rs-save');
    const entered=parseFloat(document.getElementById('rs-amount').value)||0;
    if(entered<0){ err.textContent='Amount cannot be negative.'; err.classList.remove('hidden'); return; }
    const method=document.getElementById('rs-method').value, orRef=document.getElementById('rs-ref').value.trim();
    const toProd=document.getElementById('rs-prod').checked;
    const who=userProfile?.displayName||currentUser.email;
    const vatTreatment=document.getElementById('rs-vat').value;
    // `amount` = recorded total (the cash figure that hits the ledger + project balance)
    const { recorded:amount, net, vat:vatAmount }=window.vatSplit(entered,vatTreatment);
    // Guard the common foot-gun: entering the VAT-inclusive contract price as
    // "exclusive" grosses it up 12% over the contract → phantom over-collection.
    if(contract>0 && amount > contract + 0.5 && !(await confirmDialog({message:`Recorded total ₱${fmt(amount)} exceeds the contract ₱${fmt(contract)} (VAT-${vatTreatment}). Record anyway?`}))){ return; }
    saveBtn.disabled=true; // guard against double-click double-posting
    try{
      // Idempotency: one Sales-Revenue credit per sales order. If this order was
      // already recorded (ledger row keyed by SO-<id> exists), don't post again.
      const ledgerRef=`SO-${o.id}`;
      const dupe=await db.collection('ledger').where('refNumber','==',ledgerRef).limit(1).get().catch(()=>({empty:true}));
      if(!dupe.empty){ closeModal(); Notifs.showToast('This sales order was already recorded.','error'); window.renderSalesOrders(container); return; }
      // 1) ledger credit (Sales Revenue → feeds Output-VAT base)
      let ledgerId=null;
      if(amount>0){
        const led=await db.collection('ledger').add({ date:today(), description:`Sales order — ${o.clientName}${o.quoteNumber?' ('+o.quoteNumber+')':''}`, category:'Sales Revenue', accountType:'income', account:'Sales Revenue', type:'credit', amount, net, vatAmount, vatTreatment, refNumber:ledgerRef, source:'Finance', projectId:o.projectId||null, addedBy:currentUser.uid, addedByName:who, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        ledgerId=led.id;
        if(typeof dbCacheInvalidate==='function') dbCacheInvalidate('ledger');
      }
      // 2) mark the sales order recorded
      await db.collection('sales_orders').doc(o.id).update({ status:'recorded', recordedAmount:amount, recordedAt:firebase.firestore.FieldValue.serverTimestamp(), recordedBy:who });
      // 3) sync the linked project's collected / AR so the Projects tab shows true values
      if(o.projectId && amount>0){
        try{
          const ps=await db.collection('job_projects').doc(o.projectId).get();
          if(ps.exists){
            const p=ps.data();
            const newCollected=(p.amountCollected||0)+amount;
            const newAR=Math.max(0,(p.contractAmount||contract)-newCollected);
            const upd={ amountCollected:newCollected, arBalance:newAR, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
              payments:firebase.firestore.FieldValue.arrayUnion({ type:'Sales Order Payment', amount, vatAmount, net, method, orRef, date:today(), by:who, ledgerId }),
              documents:firebase.firestore.FieldValue.arrayUnion({ type:'Official Receipt', ref:orRef||('₱'+amount.toLocaleString()), at:new Date().toISOString(), by:who }),
              timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:`Sale recorded ₱${amount.toLocaleString()} by Finance`, by:who }) };
            if(newAR<=0) upd.stage='paid';
            await db.collection('job_projects').doc(o.projectId).update(upd);
            if(o.trackingToken) window.syncOrderTracking(o.trackingToken, { paid:newCollected, balance:newAR });
          }
        }catch(_){}
      }
      window.logAudit&&window.logAudit('create','ledger',ledgerId,{source:'sales_order', amount, client:o.clientName});
      // 4) optional handoff to Production
      if(toProd) await transferOrderToProduction({ ...o, status:'recorded' });
      closeModal(); Notifs.showToast(toProd?'Sale recorded + sent to Production':'Sale recorded to ledger'); window.renderSalesOrders(container);
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); saveBtn.disabled=false; }
  });
}

// Advance the linked project to In Production and notify the Production team.
async function transferOrderToProduction(o){
  const who=userProfile?.displayName||currentUser.email;
  try{
    if(o.projectId){
      const ps=await db.collection('job_projects').doc(o.projectId).get();
      const stage=ps.exists?ps.data().stage:null;
      if(ps.exists && ['won'].includes(stage)){
        await db.collection('job_projects').doc(o.projectId).update({ stage:'in_production', updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
          timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Moved to In Production (sale recorded)', by:who }) });
      }
    }
    await db.collection('sales_orders').doc(o.id).update({ sentToProduction:true, sentToProductionAt:firebase.firestore.FieldValue.serverTimestamp() });
    if(o.trackingToken) window.syncOrderTracking(o.trackingToken, { status:'production' });
    try{ await Notifs.sendToDept('Production',{ title:'🏭 New job to produce', body:`${o.clientName} — sale recorded by Finance. Create the production order.`, icon:'🏭', type:'project_stage', link:'projects-lifecycle' }, { fallbackToOwner:true }); }catch(_){}
    window.logAudit&&window.logAudit('update','sales_order',o.id,{ sentToProduction:true });
  }catch(ex){ Notifs.showToast('Transfer failed: '+(ex.message||ex.code),'error'); }
}

function bindQuoteActions(el, currentUser, currentRole, container) {
  // Direct delete (president/manager only — Firestore rules enforce isAdmin)
  el.querySelectorAll('.bs-del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      if (!(await confirmDialog({message:`Delete quote "${escHtml(b.dataset.qno||b.dataset.id)}"? This cannot be undone.`, danger:true, html:true}))) return;
      try {
        await db.collection('bs_quotes').doc(b.dataset.id).delete();
        window.logAudit && window.logAudit('delete','quote',b.dataset.id,{ quoteNo:b.dataset.qno });
        Notifs.showToast('Quote deleted');
        renderBSQuotationsSummary(container, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Delete failed','error'); }
    });
  });
  // Request delete (partner / sales staff) — flags the quote + notifies the president
  el.querySelectorAll('.bs-delreq-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      const reason = (await promptDialog({message:'Reason for deleting this quote? (sent to the president for approval)', required:true, multiline:true}))||'';
      try {
        await db.collection('bs_quotes').doc(b.dataset.id).update({
          deleteRequested:true, deleteReason:reason,
          deleteRequestedBy:currentUser.uid, deleteRequestedAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        await Notifs.sendToOwner({ title:'🗑 Quote Delete Requested', body:`${userProfile?.displayName||currentUser.email} requests deleting quote "${b.dataset.qno}".${reason?' Reason: '+reason:''}`, icon:'🗑', type:'quote_delete_request' });
        Notifs.showToast('Delete request sent to president');
        renderBSQuotationsSummary(container, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Request failed: '+(ex.message||ex.code),'error'); }
    });
  });
  // Reopen a filed quote in the builder to edit — re-filing saves a new copy "(2)".
  el.querySelectorAll('.bs-reopen-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.currentTarget.dataset.id;
      try {
        const snap = await db.collection('bs_quotes').doc(id).get();
        const q = snap.data() || {};
        if (!q.editableState) { Notifs.showToast('No editable snapshot saved for this quote', 'error'); return; }
        window._qbReopenState = q.editableState;   // picked up by renderQuoteBuilderIframe
        navigateTo('bs-quote-builder');
      } catch (ex) { Notifs.showToast('Could not reopen: '+(ex.message||ex.code), 'error'); }
    });
  });
  // New revision (R2, R3…) of a filed quote — same client/items, today's date.
  el.querySelectorAll('.bs-rev-btn').forEach(btn => {
    btn.addEventListener('click', e =>
      window.newRevisionFromDoc('bs_quotes', e.currentTarget.dataset.id, 'bs-quote-builder'));
  });
  // Convert a won quote into a Sales Order (capture payment + receipt → finance)
  el.querySelectorAll('.bs-so-btn').forEach(btn => {
    btn.addEventListener('click', e => openSalesOrderModal(e.currentTarget.dataset, currentUser, currentRole, container));
  });
  el.querySelectorAll('.bs-approve-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      await db.collection('bs_quotes').doc(b.dataset.id).update({
        status: 'filed', approvalStatus: 'approved',
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(), approvedBy: currentUser.uid
      });
      await db.collection('approval_requests').where('quoteId','==',b.dataset.id).get().then(s => s.docs.forEach(d => d.ref.update({status:'approved'})));
      if (b.dataset.by) await Notifs.send(b.dataset.by, { title:'✅ Quote Approved!', body:`Quotation "${b.dataset.qno}" for ${b.dataset.name} was approved and filed.`, icon:'✅', type:'quote_approved' });
      Notifs.showToast('Quote approved and filed!');
      renderBSQuotationsSummary(container, currentUser, currentRole);
    });
  });
  el.querySelectorAll('.bs-reject-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      await db.collection('bs_quotes').doc(b.dataset.id).update({
        status: 'rejected', approvalStatus: 'rejected',
        rejectedAt: firebase.firestore.FieldValue.serverTimestamp(), rejectedBy: currentUser.uid
      });
      await db.collection('approval_requests').where('quoteId','==',b.dataset.id).get().then(s => s.docs.forEach(d => d.ref.update({status:'rejected'})));
      if (b.dataset.by) await Notifs.send(b.dataset.by, { title:'❌ Quote Not Approved', body:`Quotation "${b.dataset.qno}" for ${b.dataset.name} was not approved.`, icon:'❌', type:'quote_rejected' });
      Notifs.showToast('Quote rejected.');
      renderBSQuotationsSummary(container, currentUser, currentRole);
    });
  });
  el.querySelectorAll('.bs-edit-return-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      const snap = await db.collection('bs_quotes').doc(b.dataset.id).get();
      const q = snap.data();
      openPage(`✎ Edit Quote — ${b.dataset.qno}`, `
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Edit this quotation directly. You can approve after editing, or return it to the submitter.</p>
        <div class="form-group"><label>Client Name</label>
          <input id="pres-client" type="text" value="${(q.clientName||'').replace(/"/g,'&quot;')}" style="width:100%"/>
        </div>
        <div class="form-group"><label>Client Company</label>
          <input id="pres-company" type="text" value="${(q.clientCompany||'').replace(/"/g,'&quot;')}" style="width:100%"/>
        </div>
        <div class="form-group"><label>Scope / Description</label>
          <textarea id="pres-scope" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical">${escHtml(q.scope||q.description||'')}</textarea>
        </div>
        <div class="form-group"><label>Adjusted Total (₱)</label>
          <input id="pres-total" type="number" value="${q.total||q.grandTotal||0}" style="width:100%" inputmode="decimal"/>
        </div>
        <div class="form-group"><label>President's Notes / Feedback</label>
          <textarea id="pres-notes" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical" placeholder="Optional notes for the submitter…">${escHtml(q.presidentNotes||'')}</textarea>
        </div>
      `, `
        <button class="btn-success" id="pres-approve-edit-btn">✅ Save &amp; Approve</button>
        <button class="btn-primary" id="pres-return-btn">↩ Save &amp; Return</button>
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      `);

      const getEdits = () => ({
        clientName:    document.getElementById('pres-client').value.trim(),
        clientCompany: document.getElementById('pres-company').value.trim(),
        scope:         document.getElementById('pres-scope').value.trim(),
        total:         parseFloat(document.getElementById('pres-total').value)||q.total||0,
        presidentNotes: document.getElementById('pres-notes').value.trim(),
        editedByPresident: true,
        editedAt: firebase.firestore.FieldValue.serverTimestamp(),
        editedBy: currentUser.uid
      });

      document.getElementById('pres-approve-edit-btn').addEventListener('click', async () => {
        const edits = getEdits();
        await db.collection('bs_quotes').doc(b.dataset.id).update({
          ...edits, status: 'filed', approvalStatus: 'approved',
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(), approvedBy: currentUser.uid
        });
        await db.collection('approval_requests').where('quoteId','==',b.dataset.id).get().then(s => s.docs.forEach(d => d.ref.update({status:'approved'})));
        if (b.dataset.by) await Notifs.send(b.dataset.by, { title:'✅ Quote Approved!', body:`Quotation "${b.dataset.qno}" for ${edits.clientName||b.dataset.name} was approved and filed.`, icon:'✅', type:'quote_approved' });
        closeModal();
        Notifs.showToast('Quote edited, approved and filed!');
        renderBSQuotationsSummary(container, currentUser, currentRole);
      });

      document.getElementById('pres-return-btn').addEventListener('click', async () => {
        const edits = getEdits();
        await db.collection('bs_quotes').doc(b.dataset.id).update({
          ...edits, status: 'needs_revision', approvalStatus: 'needs_revision',
          returnedAt: firebase.firestore.FieldValue.serverTimestamp(), returnedBy: currentUser.uid
        });
        if (b.dataset.by) await Notifs.send(b.dataset.by, {
          title: '↩ Quote Returned for Revision',
          body: `"${b.dataset.qno}" for ${edits.clientName||b.dataset.name} was reviewed and returned. Please check the notes and re-submit.`,
          icon: '✎', type: 'quote_returned'
        });
        closeModal();
        Notifs.showToast('Quote updated and returned to submitter.');
        renderBSQuotationsSummary(container, currentUser, currentRole);
      });
    });
  });
}

// ── Brilliant Steel Client Data ────────────────────
async function renderBSClientData(container, currentUser, currentRole) {
  container.innerHTML = '<div class="loading-placeholder">Loading client data…</div>';
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager' || currentRole === 'employee';
  try {
    const snap = isPrivileged
      ? await db.collection('bs_quotes').orderBy('createdAt','desc').get()
      : await db.collection('bs_quotes').where('createdBy','==',currentUser.uid).orderBy('createdAt','desc').get();
    const quotes = snap.docs.map(d=>({id:d.id,...d.data()}));

    // Build unique client map
    const clientMap = {};
    quotes.forEach(q => {
      const key = (q.clientName||'').trim().toLowerCase() || q.id;
      if (!clientMap[key]) {
        clientMap[key] = {
          name: q.clientName||'Unnamed',
          company: q.clientCompany||'',
          address: q.clientAddress||'',
          contact: q.clientContact||q.clientPhone||'',
          email: q.clientEmail||'',
          tin: q.clientTin||'',
          quotes: [],
          totalValue: 0,
          lastActivity: q.createdAt?.seconds||0
        };
      }
      clientMap[key].quotes.push(q);
      clientMap[key].totalValue += (q.total||q.grandTotal||0);
      if ((q.createdAt?.seconds||0) > clientMap[key].lastActivity) {
        clientMap[key].lastActivity = q.createdAt?.seconds||0;
        clientMap[key].email = q.clientEmail || clientMap[key].email;
        clientMap[key].contact = q.clientContact||q.clientPhone || clientMap[key].contact;
        clientMap[key].company = q.clientCompany || clientMap[key].company;
        clientMap[key].address = q.clientAddress || clientMap[key].address;
        clientMap[key].tin = q.clientTin || clientMap[key].tin;
      }
    });

    const clients = Object.values(clientMap).sort((a,b) => b.lastActivity - a.lastActivity);

    if (!clients.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><h4>No client data yet</h4><p style="color:var(--text-muted);font-size:13px">Clients will appear here once quotations are filed.</p></div>';
      return;
    }

    let searchVal = '';
    const render = (list) => {
      const wrap = container.querySelector('#bs-client-list');
      if (!wrap) return;
      if (!list.length) { wrap.innerHTML = '<div class="empty-state"><p>No clients match your search.</p></div>'; return; }
      wrap.innerHTML = list.map((cl,i) => `
        <div class="card" style="margin-bottom:10px">
          <div class="card-header" style="cursor:pointer;user-select:none" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
            <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
              <div style="width:38px;height:38px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:800;color:white;font-size:15px;flex-shrink:0">${(cl.name[0]||'?').toUpperCase()}</div>
              <div style="min-width:0">
                <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(cl.name)}</div>
                ${cl.company?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(cl.company)}</div>`:''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
              <span class="badge badge-blue">${cl.quotes.length} quote${cl.quotes.length!==1?'s':''}</span>
              <span style="font-size:13px;font-weight:700;color:var(--success)">₱${cl.totalValue.toLocaleString()}</span>
              <span style="color:var(--text-muted);font-size:16px">›</span>
            </div>
          </div>
          <div class="card-body" style="display:none;padding-top:0">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:12px;padding-top:10px;border-top:1px solid var(--border)">
              ${cl.address?`<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.4px">Address</div><div style="font-size:13px;margin-top:2px">${escHtml(cl.address)}</div></div>`:''}
              ${cl.contact?`<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.4px">Contact</div><div style="font-size:13px;margin-top:2px">${escHtml(cl.contact)}</div></div>`:''}
              ${cl.email?`<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.4px">Email</div><div style="font-size:13px;margin-top:2px">${escHtml(cl.email)}</div></div>`:''}
              ${cl.tin?`<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.4px">TIN</div><div style="font-size:13px;margin-top:2px">${escHtml(cl.tin)}</div></div>`:''}
            </div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.4px;margin-bottom:8px">Quotation History</div>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Quote #</th><th>Amount</th><th>Status</th><th>Date</th>${isPrivileged?'<th>By</th>':''}<th></th></tr></thead>
              <tbody>${cl.quotes.map(q=>{
                const ts = q.createdAt?.toDate?q.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}):'';
                const status = q.status||q.approvalStatus||'draft';
                const badge = status==='filed'||status==='approved'?'badge-green':status==='pending_approval'||status==='pending_review'||status==='sent'?'badge-orange':status==='rejected'?'badge-red':'badge-gray';
                return `<tr>
                  <td><code>${escHtml(q.quoteNumber||q.id.slice(-8))}</code></td>
                  <td style="font-weight:600">₱${(q.total||q.grandTotal||0).toLocaleString()}</td>
                  <td><span class="badge ${badge}">${status}</span></td>
                  <td style="color:var(--text-muted);font-size:11px">${ts}</td>
                  ${isPrivileged?`<td style="font-size:12px;color:var(--text-muted)">${escHtml(q.agentName||q.createdByName||'—')}</td>`:''}
                  <td style="white-space:nowrap">${q.editableState?`<button class="btn-secondary btn-sm" onclick="event.stopPropagation();window.reopenQuoteFromDoc('bs_quotes','${q.id}','bs-quote-builder')" title="Open this quote in the builder to edit — re-filing saves a new copy">↻ Reopen &amp; Edit</button> <button class="btn-secondary btn-sm" onclick="event.stopPropagation();window.newRevisionFromDoc('bs_quotes','${q.id}','bs-quote-builder')" title="Start a new revision (R2, R3…) with today's date">⎘ New Revision</button>`:'<span style="font-size:10px;color:var(--text-muted)">no snapshot</span>'}</td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>
          </div>
        </div>
      `).join('');
    };

    container.innerHTML = `
      <div class="page-header" style="margin-bottom:14px">
        <h3 style="font-size:15px;font-weight:700">👤 Client Data <span style="font-size:12px;font-weight:400;color:var(--text-muted)">${clients.length} client${clients.length!==1?'s':''}</span></h3>
        <input id="bs-client-search" placeholder="Search clients…" class="ms-input" style="max-width:260px"/>
      </div>
      <div id="bs-client-list"></div>
    `;
    render(clients);

    container.querySelector('#bs-client-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      render(q ? clients.filter(cl =>
        cl.name.toLowerCase().includes(q) ||
        (cl.company||'').toLowerCase().includes(q) ||
        (cl.address||'').toLowerCase().includes(q)
      ) : clients);
    });
  } catch(err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading clients: ${err.message}</p></div>`;
  }
}

// ══════════════════════════════════════════════════
//  SHARED QUOTE BUILDER (Barro + Brilliant Steel)
// ══════════════════════════════════════════════════
function renderQuoteList(container, currentUser, currentRole, brand) {
  const collection = brand === 'brilliant-steel' ? 'bs_quotes' : 'quotes';
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager';

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div></div>
      <button class="btn-primary btn-sm" id="new-quote-btn">+ New Quote</button>
    </div>
    <div id="quote-list-wrap"><div class="loading-placeholder">Loading quotes…</div></div>
  `;

  const loadList = async () => {
    const wrap = document.getElementById('quote-list-wrap');
    const snap = isPrivileged
      ? await db.collection(collection).orderBy('createdAt','desc').get()
      : await db.collection(collection).where('createdBy','==',currentUser.uid).get();
    const quotes = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    if (!quotes.length) { wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">💼</div><h4>No quotes yet</h4></div>`; return; }
    wrap.innerHTML = `<div class="item-list">${quotes.map(q => `
      <div class="item-card quote-item" data-id="${q.id}">
        <div class="item-top">
          <div class="item-title">${brand==='brilliant-steel'?'BS':'Q'}-${q.quoteNumber||q.id.slice(-6).toUpperCase()} — ${escHtml(q.clientName||'Unnamed')}</div>
          <span class="badge ${statusBadge(q.status)}">${q.status||'draft'}</span>
        </div>
        <div class="item-meta">
          <span>💰 ₱${fmt(q.total)}</span>
          <span>👤 ${escHtml(q.agentName||'—')}</span>
          ${q.createdAt?`<span>📅 ${new Date(q.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
        </div>
      </div>`).join('')}</div>`;
    wrap.querySelectorAll('.quote-item').forEach(item => {
      item.addEventListener('click', async () => {
        const s = await db.collection(collection).doc(item.dataset.id).get();
        openQuoteEditor(currentUser, currentRole, brand, collection, {id:s.id,...s.data()}, loadList);
      });
    });
  };

  loadList();
  document.getElementById('new-quote-btn').onclick = () => openQuoteEditor(currentUser, currentRole, brand, collection, null, loadList);
}

function openQuoteEditor(currentUser, currentRole, brand, collection, existing, onSave) {
  let lines = existing ? [...(existing.lineItems||[])] : [{description:'',qty:1,price:0}];
  const isBS = brand === 'brilliant-steel';

  openPage(existing ? `Edit Quote` : 'New Quote', `
    <div class="form-row">
      <div class="form-group"><label>Client Name</label><input id="q-client" value="${escHtml(existing?.clientName||'')}"/></div>
      <div class="form-group"><label>Client Email</label><input id="q-client-email" type="email" value="${escHtml(existing?.clientEmail||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Quote Date</label><input id="q-date" type="date" value="${existing?.date||today()}"/></div>
      <div class="form-group"><label>Valid Until</label><input id="q-valid" type="date" value="${existing?.validUntil||''}"/></div>
    </div>
    ${!isBS?`
    <div class="form-group"><label>Product Line</label>
      <select id="q-line">
        <option>Barro Kitchens</option>
        <option>Steel Fabrication</option>
        <option>Fire Suppression</option>
        <option>HVAC / Ventilation</option>
        <option>General</option>
      </select>
    </div>`:''}
    <div class="form-group"><label>Notes</label><textarea id="q-notes" rows="2">${escHtml(existing?.notes||'')}</textarea></div>
    <hr class="divider"/>
    <div class="line-items-header"><span>Description</span><span>Qty</span><span>Unit Price</span><span></span></div>
    <div id="q-lines"></div>
    <button class="btn-secondary" id="add-line-btn" style="margin-top:8px">+ Add Line</button>
    <div id="q-total" class="quote-total"></div>
    <div class="form-group" style="margin-top:12px"><label>Status</label>
      <select id="q-status">
        <option value="draft" ${existing?.status==='draft'?'selected':''}>Draft</option>
        <option value="sent" ${existing?.status==='sent'?'selected':''}>Sent to Client</option>
        <option value="accepted" ${existing?.status==='accepted'?'selected':''}>Accepted</option>
        <option value="rejected" ${existing?.status==='rejected'?'selected':''}>Rejected</option>
      </select>
    </div>
  `, `
    <button class="btn-secondary" id="print-quote-btn">🖨 Print</button>
    <button class="btn-primary" id="save-quote-btn">💾 Save</button>
    <button class="btn-secondary" onclick="closeModal()">Cancel</button>
  `);

  const renderLines = () => {
    const cont = document.getElementById('q-lines');
    cont.innerHTML = lines.map((l,i) => `
      <div class="line-item-row">
        <input type="text" value="${escHtml(l.description)}" data-i="${i}" data-f="description" placeholder="Description"/>
        <input type="number" value="${l.qty}" data-i="${i}" data-f="qty" min="1" inputmode="numeric"/>
        <input type="number" value="${l.price}" data-i="${i}" data-f="price" min="0" step="0.01" inputmode="decimal"/>
        <button class="btn-icon" data-rm="${i}">${emojiIcon('trash-2',16)}</button>
      </div>`).join('');
    if (window.lucide) lucide.createIcons({ nodes: [cont] });
    cont.querySelectorAll('input').forEach(inp => {
      inp.oninput = e => { const i=parseInt(e.target.dataset.i),f=e.target.dataset.f; lines[i][f]=f==='description'?e.target.value:parseFloat(e.target.value)||0; updateTotal(); };
    });
    cont.querySelectorAll('[data-rm]').forEach(btn => { btn.onclick = () => { lines.splice(parseInt(btn.dataset.rm),1); renderLines(); }; });
    updateTotal();
  };

  const updateTotal = () => {
    const t = lines.reduce((s,l) => s + (l.qty*l.price), 0);
    const el = document.getElementById('q-total');
    if(el) el.textContent = `Total: ₱${fmt(t)}`;
  };

  renderLines();
  document.getElementById('add-line-btn').onclick = () => { lines.push({description:'',qty:1,price:0}); renderLines(); };

  document.getElementById('save-quote-btn').onclick = async () => {
    const total = lines.reduce((s,l) => s + l.qty*l.price, 0);
    const chosenStatus = document.getElementById('q-status').value;
    if (chosenStatus === 'accepted' && existing?.status !== 'accepted'
        && !(await confirmDialog({message:`Mark this quote as ACCEPTED (₱${fmt(total)})? This signals the client has agreed.`}))) return;
    const s = await db.collection('users').doc(currentUser.uid).get();
    const agentName = s.exists ? s.data().displayName : currentUser.email;
    const data = {
      clientName:   document.getElementById('q-client').value.trim(),
      clientEmail:  document.getElementById('q-client-email').value.trim(),
      date:         document.getElementById('q-date').value,
      validUntil:   document.getElementById('q-valid').value,
      notes:        document.getElementById('q-notes').value,
      productLine:  document.getElementById('q-line')?.value||'',
      lineItems:    lines, total,
      status:       document.getElementById('q-status').value,
      agentName, createdBy: currentUser.uid,
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
    };
    if (existing) {
      await db.collection(collection).doc(existing.id).update(data);
    } else {
      const count = (await db.collection(collection).get()).size;
      data.quoteNumber = String(count+1).padStart(4,'0');
      data.createdAt   = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection(collection).add(data);
    }
    closeModal(); Notifs.showToast('Quote saved!'); if(onSave) onSave();
  };

  document.getElementById('print-quote-btn').onclick = () => printQuote(lines, existing);
}

function printQuote(lines, q) {
  const total = lines.reduce((s,l) => s + l.qty*l.price, 0);
  const w = window.open('','_blank');
  w.document.write(`<html><head><title>Quote — Barro Industries</title>
  <style>body{font-family:sans-serif;padding:40px;color:#1a1d2e}h1{color:#1a237e}.logo{font-size:24px;font-weight:800;color:#1a237e}table{width:100%;border-collapse:collapse;margin:20px 0}th{background:#1a237e;color:#fff;padding:8px 12px;text-align:left}td{padding:8px 12px;border-bottom:1px solid #eee}.total{text-align:right;font-size:18px;font-weight:bold;margin-top:10px}.footer{margin-top:40px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:12px}</style>
  </head><body>
  <div class="logo">Barro Industries</div>
  <p style="margin:4px 0;font-size:12px;color:#666">Professional Kitchen, Steel & Engineering Solutions</p>
  <hr style="margin:14px 0;border:none;border-top:1px solid #eee"/>
  <p><strong>Quote for:</strong> ${escHtml(q?.clientName||'Client')} &nbsp;&nbsp; <strong>Date:</strong> ${escHtml(q?.date||today())}</p>
  <table><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr>
  ${lines.map(l=>`<tr><td>${escHtml(l.description)}</td><td>${l.qty}</td><td>₱${fmt(l.price)}</td><td>₱${fmt(l.qty*l.price)}</td></tr>`).join('')}
  </table>
  <div class="total">Total: ₱${fmt(total)}</div>
  <div class="footer">Valid until: ${escHtml(q?.validUntil||'N/A')} · ${escHtml(q?.notes||'')}</div>
  <script>window.print();<\/script></body></html>`);
}

// ══════════════════════════════════════════════════
//  OWNER — APPROVAL REQUESTS
// ══════════════════════════════════════════════════
window.renderApprovals = async function(currentUser) {
  const c = deptContainer();
  // ── Approval authority (oversight model) ──────────────────────────────
  // President + Manager can act on routine requests; the Corporate Secretary is
  // VIEW-ONLY (oversight). Approving a DELETE of a key record is President-only —
  // the same boundary firestore.rules enforces (delete → president). canAct hides
  // routine action buttons for the secretary; canDelete hides delete-approval
  // buttons for everyone but the President.
  const _role     = window.currentRole || '';
  // ── Per-approval-type capability map (two-tier oversight) ───────────────
  // The Corporate Secretary may act on MINOR, non-money items (sign-ups,
  // attendance, work submissions, review-tasks, leave). MAJOR / money-moving
  // items (cash advances, quote approvals, payroll & finance deletes, quote /
  // client deletions) stay President-only (manager keeps the routine set).
  // For major items the secretary sees a "Request President approval" action
  // instead of approve/deny. Mirrors firestore.rules (delete → president).
  const APPROVAL_CAPS = {
    'signup':         ['president','manager','secretary'],
    'attendance':     ['president','manager','secretary'],
    'submission':     ['president','manager','secretary'],
    'review-task':    ['president','manager','secretary'],
    'leave':          ['president','manager','secretary'],
    'ca':             ['president','manager'],
    'ca_deduct':      ['president','manager'], // v12 WS22 — employee's CA-deduction-for-this-run request
    'raise':          ['president'], // v12 WS23 — only the President approves/rejects a raise request
    'quote-approval': ['president','manager'],
    'finance-req':    ['president'],
    'finance-del':    ['president'],
    'delete-quote':   ['president'],
    'delete-client':  ['president'],
  };
  const canActOn   = (type) => (APPROVAL_CAPS[type] || ['president','manager']).includes(_role);
  const canEscalate = (type) => _role === 'secretary' && !canActOn(type);
  const canAct     = _role === 'president' || _role === 'manager';
  const canDelete  = (typeof isRealPresident === 'function') ? isRealPresident() : (_role === 'president');
  const _showGrading = (_role === 'president' || _role === 'manager');
  // Secretary escalation: ping the President to review a major item.
  const requestPresidentApproval = async (label) => {
    try {
      await Notifs.sendToOwner({
        title: '🙋 Approval Requested',
        body: `${(window.userProfile && window.userProfile.displayName) || 'The Corporate Secretary'} asks you to review: ${label}.`,
        icon: '🙋', type: 'approval_result'
      });
      Notifs.showToast('Sent to the President for approval.');
    } catch (e) { Notifs.showToast('Could not send request', 'error'); }
  };
  // Check pending counts for badges
  const [signupSnap, extSnap, caSnap, subsSnap, reviewTasksCountSnap, finReqSnap, finDelSnap, qApprSnap, delQSnap, delBKQSnap, delCSnap, leaveSnap] = await Promise.all([
    db.collection('signup_requests').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('attendance_extensions').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('cash_advances').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('submissions').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('tasks').where('status','==','review').get().catch(()=>({size:0,docs:[]})),
    db.collection('payroll_delete_requests').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('finance_delete_requests').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('approval_requests').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('bs_quotes').where('deleteRequested','==',true).get().catch(()=>({size:0,docs:[]})),
    db.collection('bk_quotes').where('deleteRequested','==',true).get().catch(()=>({size:0,docs:[]})),
    db.collection('bs_clients').where('deleteRequested','==',true).get().catch(()=>({size:0,docs:[]})),
    db.collection('leave_requests').where('status','==','pending').get().catch(()=>({size:0,docs:[]}))
  ]);
  const pendingSignups = signupSnap.size || 0;
  const pendingExt     = extSnap.size || 0;
  const pendingCA      = caSnap.size || 0;
  const pendingSubs    = subsSnap.size || 0;
  const pendingReview  = reviewTasksCountSnap.size || 0;
  const pendingFinReqs = (finReqSnap.size || 0) + (finDelSnap.size || 0);
  const pendingQApprovals = qApprSnap.size || 0;
  const pendingDeletes    = (delQSnap.size || 0) + (delBKQSnap.size || 0) + (delCSnap.size || 0);
  const pendingLeave      = leaveSnap.size || 0;
  const totalPending   = pendingSignups + pendingExt + pendingCA + pendingSubs + pendingReview + pendingFinReqs + pendingQApprovals + pendingDeletes + pendingLeave;

  // ── Grading queue count (President's grading subtab) ──────────────────
  // Completed/approved tasks awaiting a presidentScore + employees whose
  // monthly self-assessment awaits a president grade. Only fetched for the
  // roles that can see the Grading chip, to keep the page load lean.
  let pendingGrading = 0;
  if (_showGrading) {
    try {
      const [gtSnap, geSnap] = await Promise.all([
        db.collection('tasks').where('status','in',['approved','completed','done']).get().catch(()=>({docs:[]})),
        db.collection('kpi_evals').get().catch(()=>({docs:[]}))
      ]);
      const ungradedTasks = gtSnap.docs.filter(d=>typeof d.data().presidentScore !== 'number').length;
      const ungradedKpi   = geSnap.docs.filter(d=>{const x=d.data();return x.selfGrade!=null && x.presidentGrade==null;}).length;
      pendingGrading = ungradedTasks + ungradedKpi;
    } catch(_){}
  }

  const approvalChips = [
    { key:'all',              label:'All Requests',     icon:'📋', count: totalPending },
    _showGrading ? { key:'grading', label:'Grading',    icon:'⭐', count: pendingGrading } : null,
    { key:'review-tasks',     label:'Tasks for Review',            count: pendingReview },
    { key:'signups',          label:'Sign-ups',                    count: pendingSignups },
    { key:'attendance',       label:'Attendance',                  count: pendingExt },
    { key:'leave',            label:'Leave',            icon:'🌴', count: pendingLeave },
    { key:'ca',               label:'Cash Advances',               count: pendingCA },
    { key:'roa',              label:'Quote / ROA',                 count: pendingQApprovals },
    { key:'quote-files',      label:'Quote Files',      icon:'📁' },
    { key:'finance-requests', label:'Finance Requests', icon:'💼', count: pendingFinReqs },
  ].filter(Boolean);

  c.innerHTML = `
    <div class="page-header"><h2>✅ Approvals</h2>${totalPending>0?`<span class="badge badge-red" style="font-size:13px">${totalPending} pending</span>`:''}</div>
    ${_role==='secretary'?`<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>👁 <strong>Secretary oversight.</strong> You can approve everyday items (sign-ups, attendance, leave, submissions, task reviews); money-moving and deletion requests go to the President.</span></div>`
      :!canAct?`<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>👁 <strong>Oversight view.</strong> You can review every request here, but only the President approves.</span></div>`
      :!canDelete?`<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>ℹ️ Deletion of key records requires <strong>President</strong> approval.</span></div>`:''}
    ${window.chipTabs(approvalChips, 'all')}
    <div id="approvals-content"><div class="loading-placeholder">Loading…</div></div>
  `;

  const loadApprovalsSub = async (sub) => {
    const wrap = document.getElementById('approvals-content');
    if (!wrap) return;
    // Acting here mutates signup_requests / attendance_extensions / cash_advances /
    // approval_requests. Invalidate the dashboard's cached pending counts so badges
    // and lists don't keep showing already-actioned items for up to the 30s TTL.
    if (typeof dbCacheInvalidate === 'function')
      ['signups-pending','att-ext-pending','ca-pending','approvals-pending'].forEach(k => dbCacheInvalidate(k));
    wrap.innerHTML = '<div class="loading-placeholder">Loading…</div>';

    if (sub === 'all') {
      // ── All Pending Requests aggregated view ──
      // No .orderBy() here — combining it with .where() requires a Firestore composite
      // index per-collection. If that index isn't provisioned, the query is rejected and
      // silently swallowed by .catch(), making items vanish from "All Requests". We sort
      // client-side instead so a missing index can never hide pending items.
      const [sgSnap, atSnap, caSnap2, subSnap2, reviewTasksSnap, finReqSnap2, finDelSnap2, qApprSnap2, delQSnap2, delBKQSnap2, delCSnap2, leaveSnap2, raiseSnap2] = await Promise.all([
        db.collection('signup_requests').where('status','==','pending').get().catch(e=>{console.error('signup_requests query failed',e);return {docs:[]};}),
        db.collection('attendance_extensions').where('status','==','pending').get().catch(e=>{console.error('attendance_extensions query failed',e);return {docs:[]};}),
        db.collection('cash_advances').where('status','==','pending').get().catch(e=>{console.error('cash_advances query failed',e);return {docs:[]};}),
        db.collection('submissions').where('status','==','pending').get().catch(e=>{console.error('submissions query failed',e);return {docs:[]};}),
        db.collection('tasks').where('status','==','review').get().catch(e=>{console.error('tasks query failed',e);return {docs:[]};}),
        db.collection('payroll_delete_requests').where('status','==','pending').get().catch(e=>{console.error('payroll_delete_requests query failed',e);return {docs:[]};}),
        db.collection('finance_delete_requests').where('status','==','pending').get().catch(e=>{console.error('finance_delete_requests query failed',e);return {docs:[]};}),
        db.collection('approval_requests').where('status','==','pending').get().catch(e=>{console.error('approval_requests query failed',e);return {docs:[]};}),
        db.collection('bs_quotes').where('deleteRequested','==',true).get().catch(e=>{console.error('bs_quotes delete query failed',e);return {docs:[]};}),
        db.collection('bk_quotes').where('deleteRequested','==',true).get().catch(e=>{console.error('bk_quotes delete query failed',e);return {docs:[]};}),
        db.collection('bs_clients').where('deleteRequested','==',true).get().catch(e=>{console.error('bs_clients delete query failed',e);return {docs:[]};}),
        db.collection('leave_requests').where('status','==','pending').get().catch(e=>{console.error('leave_requests query failed',e);return {docs:[]};}),
        db.collection('pending_raises').where('status','==','pending_approval').get().catch(e=>{console.error('pending_raises query failed',e);return {docs:[]};})
      ]);

      const allPending = [
        ...sgSnap.docs.map(d=>({id:d.id,...d.data(),type:'signup',icon:'👤',label:'Sign-up Request',name:d.data().fullName||d.data().email||'Unknown',detail:d.data().email||'',ts:d.data().createdAt})),
        ...atSnap.docs.map(d=>({id:d.id,...d.data(),type:'attendance',icon:'⏰',label:'Attendance Extension',name:d.data().userName||'Unknown',detail:d.data().date||'',ts:d.data().requestedAt})),
        ...caSnap2.docs.map(d=>({id:d.id,...d.data(),type:'ca',icon:'💸',label:'Cash Advance',name:d.data().userName||'Unknown',detail:`₱${fmt(d.data().amount||0)}`,ts:d.data().createdAt})),
        ...subSnap2.docs.map(d=>({id:d.id,...d.data(),type:'submission',icon:'📤',label:'Work Submission',name:d.data().submittedByName||d.data().userName||d.data().authorName||'Unknown',detail:d.data().title||'',ts:d.data().createdAt})),
        ...reviewTasksSnap.docs.map(d=>({id:d.id,...d.data(),type:'review-task',icon:'📋',label:'Task for Review',name:d.data().title||'Untitled Task',detail:(()=>{const uids=Array.isArray(d.data().assignedTo)?d.data().assignedTo:[d.data().assignedTo].filter(Boolean);const nm=(d.data().assignedToNames||[]).join(', ');return uids.length&&nm?'by '+nm:'';})(),ts:d.data().lastModifiedAt||d.data().createdAt})),
        ...finReqSnap2.docs.map(d=>({id:d.id,...d.data(),type:'finance-req',icon:'💼',label:'Finance Request',name:`Delete: ${d.data().userName||'?'} (${d.data().month||'?'})`,detail:`by ${d.data().requestedByName||'?'} — ${d.data().reason||''}`,ts:d.data().createdAt})),
        ...finDelSnap2.docs.map(d=>{const x=d.data();return {id:d.id,...x,type:'finance-del',icon:'🗑',label:'Finance Delete',name:`Delete: ${x.label||'record'}`,detail:`by ${x.requestedByName||'?'}${x.reason?' — '+x.reason:''}`,ts:x.createdAt,recLabel:x.label};}),
        // Partner quote approvals (partner submitted a quote for the president to review/edit/return).
        // approval_requests also hosts v12 WS22's ca_deduct requests — split by
        // `type` so those don't get mislabeled as quote approvals.
        ...qApprSnap2.docs.filter(d=>d.data().type!=='ca_deduct').map(d=>({id:d.id,...d.data(),type:'quote-approval',icon:'📤',label:'Quote Approval',name:`${d.data().quoteNumber||'Quote'} — ${d.data().clientName||''}`,detail:`${d.data().agentName||'Partner'} · ₱${fmt(d.data().total||0)}`,ts:d.data().createdAt})),
        ...qApprSnap2.docs.filter(d=>d.data().type==='ca_deduct').map(d=>{const x=d.data();return {id:d.id,...x,type:'ca_deduct',icon:'💳',label:'CA Deduction Request',name:x.userName||'Employee',detail:`₱${fmt(x.amount||0)} this month${x.reason?' — '+x.reason:''}`,ts:x.createdAt};}),
        // Quote delete requests (partner bs_quotes + internal bk_quotes + client folder) — president approves or denies
        ...delQSnap2.docs.map(d=>({id:d.id,...d.data(),type:'delete-quote',coll:'bs_quotes',icon:'🗑',label:'Quote Delete Request',name:`Delete quote ${d.data().quoteNumber||d.id.slice(-6)}`,detail:`${d.data().clientName||''}${d.data().deleteReason?' — '+d.data().deleteReason:''}`,ts:d.data().deleteRequestedAt})),
        ...delBKQSnap2.docs.map(d=>({id:d.id,...d.data(),type:'delete-quote',coll:'bk_quotes',icon:'🗑',label:'BK Quote Delete Request',name:`Delete BK quote ${d.data().quoteNumber||d.id.slice(-6)}`,detail:`${d.data().clientName||''}${d.data().deleteReason?' — '+d.data().deleteReason:''}`,ts:d.data().deleteRequestedAt})),
        ...delCSnap2.docs.map(d=>({id:d.id,...d.data(),type:'delete-client',icon:'🗑',label:'Client Delete Request',name:`Delete client "${d.data().name||''}"`,detail:d.data().deleteReason||'',ts:d.data().deleteRequestedAt})),
        // Leave requests — surfaced here so every request type funnels through this page.
        ...leaveSnap2.docs.map(d=>{const x=d.data();return {id:d.id,...x,type:'leave',icon:'🌴',label:'Leave Request',name:x.userName||'Employee',detail:`${x.days||0}d ${x.type||'leave'} · ${x.startDate||''}→${x.endDate||''}${x.reason?' — '+x.reason:''}`,ts:x.createdAt};}),
        // v12 WS23 — raise requests from non-president finance/HR.
        ...raiseSnap2.docs.map(d=>{const x=d.data();return {id:d.id,...x,type:'raise',icon:'💸',label:'Raise Request',name:x.subjectName||'Employee',detail:`₱${fmt(x.oldAmount||0)} → ₱${fmt(x.newAmount||0)} · eff ${x.effectiveDate||''}${x.reason?' — '+x.reason:''}`,ts:x.createdAt};})
      ].sort((a,b)=>(b.ts?.seconds||0)-(a.ts?.seconds||0));

      if (!allPending.length) {
        wrap.innerHTML = '<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">✅</div><h4>All clear!</h4><p>No pending requests at the moment.</p></div>';
        return;
      }

      wrap.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          ${allPending.map(item => `
          <div class="item-card pending-req-card" data-type="${item.type}" data-id="${item.id}" style="cursor:default">
            <div class="item-top">
              <div class="item-title">${item.icon} ${escHtml(item.name)}</div>
              <span class="badge badge-warn">Pending</span>
            </div>
            <div class="item-meta" style="margin-top:4px">
              <span class="badge badge-blue" style="font-size:10px">${escHtml(item.label)}</span>
              ${item.detail?`<span style="font-size:12px;color:var(--text-muted)">${escHtml(item.detail)}</span>`:''}
              ${item.ts?`<span style="font-size:11px;color:var(--text-muted)">${new Date(item.ts.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`:''}
            </div>
            <div style="display:flex;gap:8px;margin-top:10px" class="req-actions">
              ${ canActOn(item.type) ? (item.type==='signup'?`
                <button class="btn-success btn-sm sg-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}" data-email="${escHtml(item.email||'')}" data-phone="${escHtml(item.phone||'')}">✓ Approve</button>
                <button class="btn-danger btn-sm sg-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✗ Reject</button>
              `:item.type==='attendance'?`
                <button class="btn-success btn-sm at-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✓ Approve</button>
                <button class="btn-danger btn-sm at-deny-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✗ Deny</button>
              `:item.type==='ca'?`
                <button class="btn-success btn-sm ca-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}" data-amount="${item.amount||0}" data-uid="${item.userId||''}">✓ Approve CA</button>
                <button class="btn-danger btn-sm ca-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✗ Reject</button>
              `:item.type==='ca_deduct'?`
                <button class="btn-success btn-sm cad-approve-btn" data-id="${item.id}">✓ Approve</button>
                <button class="btn-danger btn-sm cad-reject-btn" data-id="${item.id}">✗ Reject</button>
              `:item.type==='review-task'?`
                <button class="btn-primary btn-sm rt-view-btn" data-id="${item.id}">👁 View Task</button>
                <button class="btn-success btn-sm rt-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✓ Approve</button>
                <button class="btn-danger btn-sm rt-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✗ Send Back</button>
              `:item.type==='finance-req'?`
                <button class="btn-success btn-sm fr-approve-btn" data-id="${item.id}" data-hist-id="${item.historyId||''}" data-name="${escHtml(item.userName||'')}" data-month="${item.month||''}" data-req-by="${item.requestedBy||''}">✓ Approve Deletion</button>
                <button class="btn-danger btn-sm fr-deny-btn" data-id="${item.id}" data-name="${escHtml(item.userName||'')}" data-month="${item.month||''}" data-req-by="${item.requestedBy||''}">✗ Deny</button>
              `:item.type==='finance-del'?`
                <button class="btn-success btn-sm fdel-approve-btn" data-id="${item.id}" data-coll="${escHtml(item.collection||'')}" data-doc="${escHtml(item.docId||'')}" data-label="${escHtml(item.recLabel||'record')}" data-req-by="${item.requestedBy||''}">✓ Approve Deletion</button>
                <button class="btn-danger btn-sm fdel-deny-btn" data-id="${item.id}" data-label="${escHtml(item.recLabel||'record')}" data-req-by="${item.requestedBy||''}">✗ Deny</button>
              `:item.type==='quote-approval'?`
                <button class="btn-primary btn-sm qa-review-btn" data-id="${item.id}" data-quote="${item.quoteId||''}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">📝 Open &amp; Edit</button>
                <button class="btn-success btn-sm qa-approve-btn" data-id="${item.id}" data-quote="${item.quoteId||''}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">✓ Approve</button>
                <button class="btn-danger btn-sm qa-return-btn" data-id="${item.id}" data-quote="${item.quoteId||''}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">↩ Return to Partner</button>
              `:item.type==='delete-quote'?`
                <button class="btn-danger btn-sm dq-approve-btn" data-id="${item.id}" data-coll="${item.coll||'bs_quotes'}" data-qno="${escHtml(item.quoteNumber||'')}" data-by="${item.deleteRequestedBy||''}">✓ Approve Delete</button>
                <button class="btn-secondary btn-sm dq-deny-btn" data-id="${item.id}" data-coll="${item.coll||'bs_quotes'}" data-qno="${escHtml(item.quoteNumber||'')}" data-by="${item.deleteRequestedBy||''}">✗ Deny</button>
              `:item.type==='delete-client'?`
                <button class="btn-danger btn-sm dc-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name||'')}" data-by="${item.deleteRequestedBy||''}">✓ Approve Delete</button>
                <button class="btn-secondary btn-sm dc-deny-btn" data-id="${item.id}" data-name="${escHtml(item.name||'')}" data-by="${item.deleteRequestedBy||''}">✗ Deny</button>
              `:item.type==='raise'?`
                <button class="btn-success btn-sm rz-approve-btn" data-id="${item.id}">✓ Approve</button>
                <button class="btn-danger btn-sm rz-reject-btn" data-id="${item.id}">✗ Reject</button>
              `:item.type==='leave'?`
                <button class="btn-success btn-sm lv-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name||'')}">✓ Approve</button>
                <button class="btn-danger btn-sm lv-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name||'')}">✗ Reject</button>
              `:`
                <button class="btn-success btn-sm sub-approve-btn" data-id="${item.id}">✓ Approve</button>
                <button class="btn-danger btn-sm sub-reject-btn" data-id="${item.id}">✗ Reject</button>
              `) : ( canEscalate(item.type)
                ? `<button class="btn-secondary btn-sm esc-btn" data-label="${escHtml(item.label+' — '+item.name)}">🙋 Request President approval</button>`
                : `<span class="badge badge-gray" style="font-size:11px">🔒 ${['finance-req','finance-del','delete-quote','delete-client'].includes(item.type)?'President approval required':'President / Manager approves'}</span>`)}
            </div>
          </div>`).join('')}
        </div>`;

      // Signup approve
      wrap.querySelectorAll('.sg-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          const pwd = generatePassword(btn.dataset.name);
          const empCount = (await db.collection('users').get().catch(()=>({size:0}))).size;
          const empId = `BI-${window.bizYear ? window.bizYear() : new Date().getFullYear()}-${String(empCount+1).padStart(3,'0')}`;
          await db.collection('users').add({ displayName:btn.dataset.name, email:btn.dataset.email, phone:btn.dataset.phone, role:'employee', departments:[], employeeId:empId, photoUrl:'', startDate:today(), createdAt:firebase.firestore.FieldValue.serverTimestamp(), pendingPasswordSetup:true });
          await db.collection('signup_requests').doc(btn.dataset.id).update({ status:'approved', generatedPassword:pwd, approvedAt:firebase.firestore.FieldValue.serverTimestamp(), approvedBy:currentUser.uid });
          Notifs.showToast(`${btn.dataset.name} approved! Password: ${pwd}`);
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.sg-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({message:`Reject ${escHtml(btn.dataset.name)}?`, html:true}))) return;
          await db.collection('signup_requests').doc(btn.dataset.id).update({ status:'rejected', rejectedAt:firebase.firestore.FieldValue.serverTimestamp() });
          loadApprovalsSub('all');
      }));

      // Attendance approve/deny
      wrap.querySelectorAll('.at-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          const ext = new Date(); ext.setHours(ext.getHours()+2);
          await db.collection('attendance_extensions').doc(btn.dataset.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp(), expiresAt:firebase.firestore.Timestamp.fromDate(ext) });
          Notifs.showToast(`Extension approved for ${btn.dataset.name}`);
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.at-deny-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('attendance_extensions').doc(btn.dataset.id).update({ status:'denied', deniedBy:currentUser.uid, deniedAt:firebase.firestore.FieldValue.serverTimestamp() });
          Notifs.showToast(`Extension denied for ${btn.dataset.name}`);
          loadApprovalsSub('all');
      }));

      // CA approve/reject
      // v12 WS22 — routes through the shared service (fixes: this approve used
      // to ignore totalPayable/interest, collecting strictly less than the
      // Cash Advance tab's own approve path for the same request).
      wrap.querySelectorAll('.ca-approve-btn').forEach(btn => {
        btn.addEventListener('click', () => window.CashAdvance.openApproveModal(btn.dataset.id, () => loadApprovalsSub('all')));
      });
      wrap.querySelectorAll('.ca-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          await window.CashAdvance.reject(btn.dataset.id);
          loadApprovalsSub('all');
      }));

      // CA deduction-for-this-run request (v12 WS22 decision 9) — approving just
      // flips status; CashAdvance.planFor() picks it up as that month's custom
      // amount the next time Compute runs for that employee's month.
      wrap.querySelectorAll('.cad-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('approval_requests').doc(btn.dataset.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          Notifs.showToast('CA deduction request approved.');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.cad-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('approval_requests').doc(btn.dataset.id).update({ status:'rejected', rejectedBy:currentUser.uid, rejectedAt:firebase.firestore.FieldValue.serverTimestamp() });
          Notifs.showToast('CA deduction request rejected.');
          loadApprovalsSub('all');
      }));

      // Raise request approve/reject (v12 WS23) — re-entrancy guarded inside RaiseFlow itself.
      wrap.querySelectorAll('.rz-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          const r = await window.RaiseFlow.approve(btn.dataset.id);
          Notifs.showToast(r==='approved'?'Raise approved.':'Already resolved.');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.rz-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          const reason = (await promptDialog({message:'Reason for declining (optional):', multiline:true}))||'';
          await window.RaiseFlow.reject(btn.dataset.id, reason);
          Notifs.showToast('Raise declined.');
          loadApprovalsSub('all');
      }));

      // Submission approve/reject
      wrap.querySelectorAll('.sub-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('submissions').doc(btn.dataset.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          Notifs.showToast('Submission approved!');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.sub-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('submissions').doc(btn.dataset.id).update({ status:'rejected', rejectedBy:currentUser.uid });
          loadApprovalsSub('all');
      }));

      // Review task view/approve/reject
      wrap.querySelectorAll('.rt-view-btn').forEach(btn => {
        btn.addEventListener('click', () => openTaskDetail(btn.dataset.id, currentUser, currentRole));
      });
      wrap.querySelectorAll('.rt-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('tasks').doc(btn.dataset.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp(), lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
          const snap2=await db.collection('tasks').doc(btn.dataset.id).get();
          if(snap2.exists){const t2=normTask(snap2.data(),snap2.id);await safeNotify(() => notifyTaskInvolved(t2,{title:'✅ Task Approved',body:`"${btn.dataset.name}" has been approved!`,icon:'✅',type:'task_status'},currentUser.uid));}
          Notifs.showToast(`"${btn.dataset.name}" approved!`);
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.rt-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('tasks').doc(btn.dataset.id).update({ status:'in-progress', lastModifiedBy:currentUser.uid, lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
          const snap2=await db.collection('tasks').doc(btn.dataset.id).get();
          if(snap2.exists){const t2=normTask(snap2.data(),snap2.id);await safeNotify(() => notifyTaskInvolved(t2,{title:'🔁 Task Sent Back',body:`"${btn.dataset.name}" was sent back for revision.`,icon:'🔁',type:'task_status'},currentUser.uid));}
          Notifs.showToast(`"${btn.dataset.name}" sent back for revision.`);
          loadApprovalsSub('all');
      }));

      // Finance request approve/deny (from "all" view)
      wrap.querySelectorAll('.fr-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({message:`Approve deletion of ${escHtml(btn.dataset.name)} (${btn.dataset.month}) payroll record?`, danger:true, html:true}))) return;
          btn.disabled = true;
          // Guard against a stale click / second President session re-running an already-resolved request.
          const _req = await db.collection('payroll_delete_requests').doc(btn.dataset.id).get().catch(()=>null);
          if (_req && _req.exists && _req.data().status !== 'pending') { Notifs.showToast('Already handled.'); loadApprovalsSub('all'); return; }
          if (btn.dataset.histId) {
            // Cascade removes the PAY- ledger debit and restores deducted cash advances.
            await window.financeExecuteDelete('salary_history', btn.dataset.histId);
            if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
          }
          await db.collection('payroll_delete_requests').doc(btn.dataset.id).update({ status:'approved', resolvedBy:currentUser.uid, resolvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.reqBy) await safeNotify(() => Notifs.send(btn.dataset.reqBy, { title:'✅ Payroll Delete Approved', body:`Your request to delete ${btn.dataset.name}'s ${btn.dataset.month} payroll record has been approved.`, icon:'✅', type:'payroll_delete_approved' }));
          Notifs.showToast('Record deleted and requester notified.');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.fr-deny-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('payroll_delete_requests').doc(btn.dataset.id).update({ status:'denied', resolvedBy:currentUser.uid, resolvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.reqBy) await safeNotify(() => Notifs.send(btn.dataset.reqBy, { title:'❌ Payroll Delete Denied', body:`Your request to delete ${btn.dataset.name}'s ${btn.dataset.month} payroll record was denied by the President.`, icon:'❌', type:'payroll_delete_denied' }));
          Notifs.showToast('Request denied and requester notified.');
          loadApprovalsSub('all');
      }));

      // Generic finance delete request approve/deny (from "all" view)
      wrap.querySelectorAll('.fdel-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({message:`Approve deletion of ${escHtml(btn.dataset.label)}? This permanently deletes it.`, danger:true, html:true}))) return;
          btn.disabled = true;
          // Guard: a stale click or a second President session must not re-run an
          // already-resolved request (would double-apply a payslip's CA reversal).
          const reqSnap = await db.collection('finance_delete_requests').doc(btn.dataset.id).get().catch(()=>null);
          if (reqSnap && reqSnap.exists && reqSnap.data().status !== 'pending') { Notifs.showToast('Already handled.'); loadApprovalsSub('all'); return; }
          if (btn.dataset.coll && btn.dataset.doc) await window.financeExecuteDelete(btn.dataset.coll, btn.dataset.doc);
          await db.collection('finance_delete_requests').doc(btn.dataset.id).update({ status:'approved', resolvedBy:currentUser.uid, resolvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.reqBy) await safeNotify(() => Notifs.send(btn.dataset.reqBy, { title:'✅ Delete Approved', body:`Your request to delete ${btn.dataset.label} was approved.`, icon:'✅', type:'finance_delete_approved' }));
          Notifs.showToast('Deleted and requester notified.');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.fdel-deny-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('finance_delete_requests').doc(btn.dataset.id).update({ status:'denied', resolvedBy:currentUser.uid, resolvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.reqBy) await safeNotify(() => Notifs.send(btn.dataset.reqBy, { title:'❌ Delete Denied', body:`Your request to delete ${btn.dataset.label} was denied by the President.`, icon:'❌', type:'finance_delete_denied' }));
          Notifs.showToast('Request denied and requester notified.');
          loadApprovalsSub('all');
      }));

      // ── Partner quote approvals — open & edit, approve, or return to partner ──
      wrap.querySelectorAll('.qa-review-btn').forEach(btn => onClickSafe(btn, () => {
        openQuoteApprovalReview({ quoteId:btn.dataset.quote, agentId:btn.dataset.by, quoteNumber:btn.dataset.qno, clientName:btn.dataset.name }, ()=>loadApprovalsSub('all'));
      }));
      wrap.querySelectorAll('.qa-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        await approveQuoteApproval(btn.dataset.quote, btn.dataset.by, btn.dataset.qno, btn.dataset.name);
        loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.qa-return-btn').forEach(btn => onClickSafe(btn, async () => {
        const notes = (await promptDialog({message:'Notes for the partner (what to revise)?', multiline:true}))||'';
        await returnQuoteToPartner(btn.dataset.quote, btn.dataset.by, btn.dataset.qno, btn.dataset.name, notes);
        loadApprovalsSub('all');
      }));

      // ── Quote delete requests — approve (delete) or deny (clear flag) ──
      // Collection-aware: bs_quotes (partner) and bk_quotes (internal Sales).
      wrap.querySelectorAll('.dq-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        if (!(await confirmDialog({message:`Approve deletion of quote ${btn.dataset.qno}? This permanently removes it.`, danger:true}))) return;
        const coll = btn.dataset.coll || 'bs_quotes';
        try {
          await db.collection(coll).doc(btn.dataset.id).delete();
          window.logAudit && window.logAudit('delete','quote',btn.dataset.id,{ quoteNo:btn.dataset.qno, coll, viaApproval:true });
          if (btn.dataset.by) await safeNotify(()=>Notifs.send(btn.dataset.by, { title:'🗑 Quote Deletion Approved', body:`Your request to delete quote ${btn.dataset.qno} was approved.`, icon:'✅', type:'delete_approved' }));
          Notifs.showToast('Quote deleted.'); loadApprovalsSub('all');
        } catch(ex){ Notifs.showToast('Delete failed: '+(ex.message||ex.code),'error'); }
      }));
      wrap.querySelectorAll('.dq-deny-btn').forEach(btn => onClickSafe(btn, async () => {
        const coll = btn.dataset.coll || 'bs_quotes';
        try {
          await db.collection(coll).doc(btn.dataset.id).update({ deleteRequested:firebase.firestore.FieldValue.delete(), deleteReason:firebase.firestore.FieldValue.delete() });
          if (btn.dataset.by) await safeNotify(()=>Notifs.send(btn.dataset.by, { title:'Quote Deletion Denied', body:`Your request to delete quote ${btn.dataset.qno} was denied.`, icon:'❌', type:'delete_denied' }));
          Notifs.showToast('Delete request denied.'); loadApprovalsSub('all');
        } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
      }));
      wrap.querySelectorAll('.dc-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        if (!(await confirmDialog({message:`Approve deletion of client "${escHtml(btn.dataset.name)}"? This permanently removes the client folder.`, danger:true, html:true}))) return;
        try {
          await db.collection('bs_clients').doc(btn.dataset.id).delete();
          window.logAudit && window.logAudit('delete','client',btn.dataset.id,{ name:btn.dataset.name, viaApproval:true });
          if (btn.dataset.by) await safeNotify(()=>Notifs.send(btn.dataset.by, { title:'🗑 Client Deletion Approved', body:`Your request to delete client "${btn.dataset.name}" was approved.`, icon:'✅', type:'delete_approved' }));
          Notifs.showToast('Client deleted.'); loadApprovalsSub('all');
        } catch(ex){ Notifs.showToast('Delete failed: '+(ex.message||ex.code),'error'); }
      }));
      wrap.querySelectorAll('.dc-deny-btn').forEach(btn => onClickSafe(btn, async () => {
        try {
          await db.collection('bs_clients').doc(btn.dataset.id).update({ deleteRequested:firebase.firestore.FieldValue.delete(), deleteReason:firebase.firestore.FieldValue.delete() });
          if (btn.dataset.by) await safeNotify(()=>Notifs.send(btn.dataset.by, { title:'Client Deletion Denied', body:`Your request to delete client "${btn.dataset.name}" was denied.`, icon:'❌', type:'delete_denied' }));
          Notifs.showToast('Delete request denied.'); loadApprovalsSub('all');
        } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
      }));

      // Leave approve/reject — uses the helpers exposed by modules.js so leave
      // balances are debited consistently with the Leave Management screen.
      wrap.querySelectorAll('.lv-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        await window.approveLeaveRequest(btn.dataset.id);
        Notifs.showToast(`Leave approved for ${btn.dataset.name}`);
        loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.lv-reject-btn').forEach(btn => onClickSafe(btn, async () => {
        const reason = (await promptDialog({message:'Reason for rejection (optional):', multiline:true}))||'';
        await window.rejectLeaveRequest(btn.dataset.id, reason);
        Notifs.showToast(`Leave rejected for ${btn.dataset.name}`);
        loadApprovalsSub('all');
      }));

      // Secretary escalation — ping the President to review a major item.
      wrap.querySelectorAll('.esc-btn').forEach(btn => onClickSafe(btn, async () => {
        btn.disabled = true;
        await requestPresidentApproval(btn.dataset.label || 'a request');
      }));
      return;
    }

    if (sub === 'grading') {
      // ── President's grading queue ──────────────────────────────────────
      // Two things await the President's grade, consolidated here:
      //  1. Completed/approved tasks with no presidentScore (quality 1–10).
      //  2. Employees whose monthly self-assessment (selfGrade) awaits the
      //     president's KPI grade (presidentGrade).
      if (!_showGrading) { wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><h4>Grading is President / Manager only</h4></div>'; return; }
      const [taskSnap, evalSnap, usersSnap] = await Promise.all([
        db.collection('tasks').where('status','in',['approved','completed','done']).get().catch(()=>({docs:[]})),
        db.collection('kpi_evals').get().catch(()=>({docs:[]})),
        dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]}))
      ]);
      const userName = {};
      (usersSnap.docs||[]).forEach(d=>{ const u=d.data(); userName[d.id] = u.displayName || u.email || 'Employee'; });
      const ungradedTasks = (taskSnap.docs||[])
        .map(d=>({id:d.id,...d.data()}))
        .filter(t=>typeof t.presidentScore !== 'number')
        .sort((a,b)=>((b.approvedAt||b.lastModifiedAt)?.seconds||0)-((a.approvedAt||a.lastModifiedAt)?.seconds||0));
      const ungradedKpi = (evalSnap.docs||[])
        .map(d=>({uid:d.id,...d.data()}))
        .filter(e=>e.selfGrade!=null && e.presidentGrade==null);

      if (!ungradedTasks.length && !ungradedKpi.length) {
        wrap.innerHTML = '<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">⭐</div><h4>Nothing to grade</h4><p>All completed tasks are scored and every self-assessment is graded.</p></div>';
        return;
      }
      const canGrade = (_role === 'president'); // KPI grade write is President's call
      wrap.innerHTML = `
        ${ungradedKpi.length?`
        <h4 style="margin:4px 0 8px;font-size:14px">📊 Self-assessments awaiting your grade (${ungradedKpi.length})</h4>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
          ${ungradedKpi.map(e=>`
            <div class="item-card" style="cursor:default">
              <div class="item-top">
                <div class="item-title">📊 ${escHtml(userName[e.uid]||'Employee')}</div>
                <span class="badge badge-warn">Self: ${escHtml(e.selfGrade)}/10</span>
              </div>
              <div class="item-meta" style="margin-top:4px">
                ${e.selfNotes?`<span style="font-size:12px;color:var(--text-muted)">${escHtml(e.selfNotes)}</span>`:'<span style="font-size:12px;color:var(--text-muted)">No notes</span>'}
              </div>
              ${canGrade?`<div style="margin-top:10px"><button class="btn-primary btn-sm grade-kpi-btn" data-uid="${e.uid}" data-name="${escHtml(userName[e.uid]||'Employee')}">⭐ Grade</button></div>`:''}
            </div>`).join('')}
        </div>`:''}
        ${ungradedTasks.length?`
        <h4 style="margin:4px 0 8px;font-size:14px">📋 Completed tasks awaiting a score (${ungradedTasks.length})</h4>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${ungradedTasks.map(t=>{
            const names = (t.assignedToNames||[]).join(', ') || 'Unassigned';
            return `<div class="item-card" style="cursor:default">
              <div class="item-top">
                <div class="item-title">📋 ${escHtml(t.title||'Untitled Task')}</div>
                <span class="badge badge-gray">Unscored</span>
              </div>
              <div class="item-meta" style="margin-top:4px;gap:6px">
                ${t.department?`<span class="badge badge-blue" style="font-size:10px">${escHtml(t.department)}</span>`:''}
                <span style="font-size:12px;color:var(--text-muted)">by ${escHtml(names)}</span>
              </div>
              <div style="margin-top:10px"><button class="btn-primary btn-sm grade-task-btn" data-id="${t.id}">⭐ Open &amp; Score</button></div>
            </div>`;
          }).join('')}
        </div>`:''}`;

      wrap.querySelectorAll('.grade-task-btn').forEach(btn=>btn.addEventListener('click',()=>openTaskDetail(btn.dataset.id, currentUser, _role)));
      wrap.querySelectorAll('.grade-kpi-btn').forEach(btn=>btn.addEventListener('click',()=>{
        const { uid, name } = btn.dataset;
        openPage(`⭐ Grade: ${name}`, `
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Assign a performance grade for ${escHtml(name)} (1 = poor, 10 = outstanding). Development areas are shown to the employee.</p>
          <div class="form-group"><label>President Grade (1–10)</label>
            <input id="ap-grade-input" type="number" inputmode="numeric" min="1" max="10" step="1" placeholder="e.g. 8"/></div>
          <div class="form-group"><label>General Notes (internal only)</label>
            <textarea id="ap-grade-notes" rows="2" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical" placeholder="Internal remarks…"></textarea></div>
          <div class="form-group"><label>📝 Development Areas <span style="font-size:11px;color:var(--primary-light)">(shown to employee)</span></label>
            <textarea id="ap-improve-input" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical" placeholder="What should this employee focus on improving?"></textarea></div>
        `, `<button class="btn-primary" id="ap-save-grade-btn">Save Grade</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
        document.getElementById('ap-save-grade-btn')?.addEventListener('click', async ()=>{
          const grade   = parseInt(document.getElementById('ap-grade-input').value);
          const notes   = document.getElementById('ap-grade-notes').value.trim();
          const improve = document.getElementById('ap-improve-input').value.trim();
          if (!grade || grade < 1 || grade > 10) { Notifs.showToast('Enter 1–10.','error'); return; }
          await db.collection('kpi_evals').doc(uid).set({
            presidentGrade: grade, presidentNotes: notes, presidentImprovements: improve,
            presidentId: currentUser.uid, presidentUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('kpi-evals');
          await safeNotify(()=>Notifs.send(uid, { title:'📊 KPI Grade Updated', body: improve?`The president graded your performance: ${grade}/10. See your Personal Finance page for development areas.`:`The president graded your performance: ${grade}/10.`, icon:'📊', type:'kpi_grade' }));
          closeModal(); Notifs.showToast(`Grade ${grade}/10 saved for ${name}.`);
          loadApprovalsSub('grading');
        });
      }));
      return;
    }

    if (sub === 'finance-requests') {
      const [psnap, fsnap] = await Promise.all([
        db.collection('payroll_delete_requests').orderBy('createdAt','desc').limit(100).get().catch(e=>{console.error('payroll_delete_requests query failed',e);return {docs:[]};}),
        db.collection('finance_delete_requests').orderBy('createdAt','desc').limit(100).get().catch(e=>{console.error('finance_delete_requests query failed',e);return {docs:[]};})
      ]);
      const reqs = [
        ...psnap.docs.map(d=>({id:d.id,kind:'payroll',...d.data()})),
        ...fsnap.docs.map(d=>({id:d.id,kind:'finance',...d.data()}))
      ].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      const pending = reqs.filter(r=>r.status==='pending');
      const resolved = reqs.filter(r=>r.status!=='pending');

      const titleOf = r => r.kind==='payroll'
        ? `🗑 Delete Payroll Record — ${escHtml(r.userName||'?')} (${r.month||'?'})`
        : `🗑 Delete — ${escHtml(r.label||'record')}`;
      const actionsOf = r => r.kind==='payroll'
        ? `<button class="btn-success btn-sm fr-approve-btn" data-id="${r.id}" data-hist-id="${r.historyId||''}" data-name="${escHtml(r.userName||'')}" data-month="${r.month||''}" data-req-by="${r.requestedBy||''}">✓ Approve Deletion</button>
           <button class="btn-danger btn-sm fr-deny-btn" data-id="${r.id}" data-name="${escHtml(r.userName||'')}" data-month="${r.month||''}" data-req-by="${r.requestedBy||''}">✗ Deny</button>`
        : `<button class="btn-success btn-sm fdel-approve-btn" data-id="${r.id}" data-coll="${escHtml(r.collection||'')}" data-doc="${escHtml(r.docId||'')}" data-label="${escHtml(r.label||'record')}" data-req-by="${r.requestedBy||''}">✓ Approve Deletion</button>
           <button class="btn-danger btn-sm fdel-deny-btn" data-id="${r.id}" data-label="${escHtml(r.label||'record')}" data-req-by="${r.requestedBy||''}">✗ Deny</button>`;
      const reqCard = (r, showActions) => `
        <div class="item-card" style="cursor:default">
          <div class="item-top">
            <div class="item-title">${titleOf(r)}</div>
            <span class="badge ${r.status==='pending'?'badge-warn':r.status==='approved'?'badge-green':'badge-red'}">${r.status==='pending'?'Pending':r.status==='approved'?'Approved':'Denied'}</span>
          </div>
          <div class="item-meta" style="margin-top:4px;flex-wrap:wrap;gap:6px">
            <span class="badge badge-blue" style="font-size:10px">${r.kind==='payroll'?'Payroll Delete':'Finance Delete'}</span>
            <span style="font-size:12px;color:var(--text-muted)">Requested by: <strong>${escHtml(r.requestedByName||'?')}</strong></span>
            ${r.reason?`<span style="font-size:12px;color:var(--text-muted)">Reason: ${escHtml(r.reason)}</span>`:''}
            ${r.createdAt?`<span style="font-size:11px;color:var(--text-muted)">${new Date(r.createdAt.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`:''}
          </div>
          ${showActions?`<div style="display:flex;gap:8px;margin-top:10px">${actionsOf(r)}</div>`:''}
        </div>`;

      wrap.innerHTML = `
        ${!pending.length && !resolved.length ? '<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">💼</div><h4>No finance requests</h4></div>' : ''}
        ${pending.length ? `<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Pending (${pending.length})</h4>
          <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
            ${pending.map(r=>reqCard(r,canDelete)).join('')}
          </div>` : ''}
        ${resolved.length ? `<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">History</h4>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${resolved.slice(0,20).map(r=>reqCard(r,false)).join('')}
          </div>` : ''}
      `;

      wrap.querySelectorAll('.fr-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({message:`Approve deletion of ${escHtml(btn.dataset.name)} (${btn.dataset.month}) payroll record?`, danger:true, html:true}))) return;
          btn.disabled = true;
          // Guard against a stale click / second President session re-running an already-resolved request.
          const _req = await db.collection('payroll_delete_requests').doc(btn.dataset.id).get().catch(()=>null);
          if (_req && _req.exists && _req.data().status !== 'pending') { Notifs.showToast('Already handled.'); loadApprovalsSub('all'); return; }
          if (btn.dataset.histId) {
            // Cascade removes the PAY- ledger debit and restores deducted cash advances.
            await window.financeExecuteDelete('salary_history', btn.dataset.histId);
            if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
          }
          await db.collection('payroll_delete_requests').doc(btn.dataset.id).update({ status:'approved', resolvedBy:currentUser.uid, resolvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.reqBy) await safeNotify(() => Notifs.send(btn.dataset.reqBy, { title:'✅ Payroll Delete Approved', body:`Your request to delete ${btn.dataset.name}'s ${btn.dataset.month} payroll record has been approved.`, icon:'✅', type:'payroll_delete_approved' }));
          Notifs.showToast('Record deleted and requester notified.');
          loadApprovalsSub('finance-requests');
      }));
      wrap.querySelectorAll('.fr-deny-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('payroll_delete_requests').doc(btn.dataset.id).update({ status:'denied', resolvedBy:currentUser.uid, resolvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.reqBy) await safeNotify(() => Notifs.send(btn.dataset.reqBy, { title:'❌ Payroll Delete Denied', body:`Your request to delete ${btn.dataset.name}'s ${btn.dataset.month} payroll record was denied.`, icon:'❌', type:'payroll_delete_denied' }));
          Notifs.showToast('Request denied.');
          loadApprovalsSub('finance-requests');
      }));
      wrap.querySelectorAll('.fdel-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({message:`Approve deletion of ${escHtml(btn.dataset.label)}? This permanently deletes it.`, danger:true, html:true}))) return;
          btn.disabled = true;
          // Guard: a stale click or a second President session must not re-run an
          // already-resolved request (would double-apply a payslip's CA reversal).
          const reqSnap = await db.collection('finance_delete_requests').doc(btn.dataset.id).get().catch(()=>null);
          if (reqSnap && reqSnap.exists && reqSnap.data().status !== 'pending') { Notifs.showToast('Already handled.'); loadApprovalsSub('finance-requests'); return; }
          if (btn.dataset.coll && btn.dataset.doc) await window.financeExecuteDelete(btn.dataset.coll, btn.dataset.doc);
          await db.collection('finance_delete_requests').doc(btn.dataset.id).update({ status:'approved', resolvedBy:currentUser.uid, resolvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.reqBy) await safeNotify(() => Notifs.send(btn.dataset.reqBy, { title:'✅ Delete Approved', body:`Your request to delete ${btn.dataset.label} was approved.`, icon:'✅', type:'finance_delete_approved' }));
          Notifs.showToast('Deleted and requester notified.');
          loadApprovalsSub('finance-requests');
      }));
      wrap.querySelectorAll('.fdel-deny-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('finance_delete_requests').doc(btn.dataset.id).update({ status:'denied', resolvedBy:currentUser.uid, resolvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.reqBy) await safeNotify(() => Notifs.send(btn.dataset.reqBy, { title:'❌ Delete Denied', body:`Your request to delete ${btn.dataset.label} was denied by the President.`, icon:'❌', type:'finance_delete_denied' }));
          Notifs.showToast('Request denied and requester notified.');
          loadApprovalsSub('finance-requests');
      }));
      return;
    }

    if (sub === 'leave') {
      const snap = await db.collection('leave_requests').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
      const reqs = snap.docs.map(d=>({id:d.id,...d.data()}));
      const pending = reqs.filter(r=>r.status==='pending');
      const resolved = reqs.filter(r=>r.status!=='pending');
      const card = (r, showActions) => `
        <div class="item-card" style="cursor:default">
          <div class="item-top">
            <div class="item-title">🌴 ${escHtml(r.userName||'Employee')}</div>
            <span class="badge ${r.status==='pending'?'badge-warn':r.status==='approved'?'badge-green':'badge-red'}">${r.status==='pending'?'Pending':r.status==='approved'?'Approved':'Rejected'}</span>
          </div>
          <div class="item-meta" style="margin-top:4px;flex-wrap:wrap;gap:6px">
            <span class="badge badge-blue" style="font-size:10px">${escHtml(r.type||'leave')}</span>
            <span style="font-size:12px;color:var(--text-muted)">${r.days||0} day${(r.days||0)!==1?'s':''} · ${escHtml(r.startDate||'')} → ${escHtml(r.endDate||'')}</span>
            ${r.reason?`<span style="font-size:12px;color:var(--text-muted)">${escHtml(r.reason)}</span>`:''}
          </div>
          ${showActions?`<div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn-success btn-sm lv-approve-btn" data-id="${r.id}" data-name="${escHtml(r.userName||'')}">✓ Approve</button>
            <button class="btn-danger btn-sm lv-reject-btn" data-id="${r.id}" data-name="${escHtml(r.userName||'')}">✗ Reject</button>
          </div>`:''}
        </div>`;
      wrap.innerHTML = `
        ${!pending.length && !resolved.length ? '<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">🌴</div><h4>No leave requests</h4></div>' : ''}
        ${pending.length?`<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Pending (${pending.length})</h4>
          <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">${pending.map(r=>card(r,canAct)).join('')}</div>`:''}
        ${resolved.length?`<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">History</h4>
          <div style="display:flex;flex-direction:column;gap:10px">${resolved.slice(0,20).map(r=>card(r,false)).join('')}</div>`:''}`;
      wrap.querySelectorAll('.lv-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        await window.approveLeaveRequest(btn.dataset.id);
        Notifs.showToast(`Leave approved for ${btn.dataset.name}`);
        loadApprovalsSub('leave');
      }));
      wrap.querySelectorAll('.lv-reject-btn').forEach(btn => onClickSafe(btn, async () => {
        const reason = (await promptDialog({message:'Reason for rejection (optional):', multiline:true}))||'';
        await window.rejectLeaveRequest(btn.dataset.id, reason);
        Notifs.showToast(`Leave rejected for ${btn.dataset.name}`);
        loadApprovalsSub('leave');
      }));
      return;
    }

    if (sub === 'review-tasks') {
      const snap = await db.collection('tasks').where('status','==','review').orderBy('lastModifiedAt','desc').get().catch(()=>({docs:[]}));
      const tasks = snap.docs.map(d=>({id:d.id,...d.data()}));
      if (!tasks.length) {
        wrap.innerHTML = '<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">✅</div><h4>No tasks awaiting review</h4></div>';
        return;
      }
      wrap.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
        ${tasks.map(t=>{
          const names = (t.assignedToNames||[]).join(', ') || (Array.isArray(t.assignedTo)?t.assignedTo:[t.assignedTo]).filter(Boolean).join(', ') || 'Unassigned';
          const dept  = t.department || '';
          const ts    = t.lastModifiedAt||t.createdAt;
          return `<div class="item-card" style="cursor:default">
            <div class="item-top">
              <div class="item-title">📋 ${escHtml(t.title||'Untitled Task')}</div>
              <span class="badge badge-warn">For Review</span>
            </div>
            <div class="item-meta" style="margin-top:4px;gap:6px">
              ${dept?`<span class="badge badge-blue" style="font-size:10px">${escHtml(dept)}</span>`:''}
              <span style="font-size:12px;color:var(--text-muted)">by ${escHtml(names)}</span>
              ${ts?`<span style="font-size:11px;color:var(--text-muted)">${new Date(ts.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric'})}</span>`:''}
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn-primary btn-sm rt-view-btn" data-id="${t.id}">👁 View</button>
              ${canActOn('review-task')?`<button class="btn-success btn-sm rt-approve-btn" data-id="${t.id}" data-name="${escHtml(t.title||'Task')}">✓ Approve</button>
              <button class="btn-danger btn-sm rt-reject-btn" data-id="${t.id}" data-name="${escHtml(t.title||'Task')}">✗ Send Back</button>`:''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
      wrap.querySelectorAll('.rt-view-btn').forEach(btn=>btn.addEventListener('click',()=>openTaskDetail(btn.dataset.id,currentUser,window.currentRole||'president')));
      wrap.querySelectorAll('.rt-approve-btn').forEach(btn=>btn.addEventListener('click',async()=>{
        if (!(await confirmDialog({message:`Approve "${escHtml(btn.dataset.name)}"?`, html:true}))) return;
        await db.collection('tasks').doc(btn.dataset.id).update({status:'approved',approvedAt:firebase.firestore.FieldValue.serverTimestamp(),approvedBy:currentUser.uid});
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
        Notifs.showToast(`"${btn.dataset.name}" approved!`,'success');
        loadApprovalsSub('review-tasks');
      }));
      wrap.querySelectorAll('.rt-reject-btn').forEach(btn=>btn.addEventListener('click',async()=>{
        if (!(await confirmDialog({message:`Send "${escHtml(btn.dataset.name)}" back for revision?`, html:true}))) return;
        await db.collection('tasks').doc(btn.dataset.id).update({status:'in-progress',sentBackAt:firebase.firestore.FieldValue.serverTimestamp(),sentBackBy:currentUser.uid});
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
        Notifs.showToast(`"${btn.dataset.name}" sent back for revision.`,'info');
        loadApprovalsSub('review-tasks');
      }));
      return;
    }

    if (sub === 'signups') {
      // Sign-up Requests
      const snap = await db.collection('signup_requests').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
      const items = snap.docs.map(d=>({id:d.id,...d.data()}));
      if (!items.length) {
        wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h4>No signup requests yet</h4></div>';
        return;
      }
      const pending = items.filter(i=>i.status==='pending');
      wrap.innerHTML = `
        ${pending.length?`<div class="alert-banner alert-warn" style="margin-bottom:12px">⚠️ ${pending.length} pending request${pending.length>1?'s':''}</div>`:''}
        <div class="item-list">
          ${items.map(item=>`
          <div class="item-card" data-id="${item.id}">
            <div class="item-top">
              <div class="item-title">👤 ${escHtml(item.fullName||'Unknown')}</div>
              <span class="badge ${item.status==='approved'?'badge-green':item.status==='rejected'?'badge-red':'badge-warn'}">${item.status||'pending'}</span>
            </div>
            <div class="item-meta">
              <span>✉️ ${escHtml(item.email||'—')}</span>
              <span>📱 ${escHtml(item.phone||'—')}</span>
              ${item.createdAt?`<span>📅 ${new Date(item.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
            </div>
            ${item.generatedPassword?`<div style="font-size:12px;margin-top:8px;padding:8px 10px;background:rgba(48,209,88,.1);border:1px solid rgba(48,209,88,.3);border-radius:8px;font-family:monospace">🔑 Generated Password: <strong>${escHtml(item.generatedPassword)}</strong><br><span style="font-size:10px;color:var(--text-muted)">Create Firebase Auth user with this password</span></div>`:''}
            ${(item.status==='pending'&&canActOn('signup'))?`
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-success signup-approve" data-id="${item.id}" data-name="${escHtml(item.fullName)}" data-email="${escHtml(item.email)}" data-phone="${escHtml(item.phone||'')}">✓ Approve & Generate Password</button>
              <button class="btn-danger signup-reject" data-id="${item.id}" data-name="${escHtml(item.fullName)}">✗ Reject</button>
            </div>`:''}
          </div>`).join('')}
        </div>`;

      wrap.querySelectorAll('.signup-approve').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id    = btn.dataset.id;
          const name  = btn.dataset.name;
          const email = btn.dataset.email;
          const phone = btn.dataset.phone;
          const pwd   = generatePassword(name);
          // Create Firestore user profile (no uid yet — president creates Firebase Auth manually)
          const empCount = (await db.collection('users').get().catch(()=>({size:0}))).size;
          const empId    = `BI-${window.bizYear ? window.bizYear() : new Date().getFullYear()}-${String(empCount+1).padStart(3,'0')}`;
          await db.collection('users').add({
            displayName: name, email, phone,
            role: 'employee', departments: [],
            employeeId: empId,
            photoUrl: '', startDate: today(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            pendingPasswordSetup: true
          });
          await db.collection('signup_requests').doc(id).update({
            status: 'approved',
            generatedPassword: pwd,
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedBy: currentUser.uid
          });
          openModal('✓ Approved — Action Required', `
            <p style="margin-bottom:14px;font-size:14px">Profile created for <strong>${escHtml(name)}</strong>.</p>
            <div style="padding:14px;background:rgba(48,209,88,.1);border:1.5px solid rgba(48,209,88,.4);border-radius:10px;margin-bottom:14px">
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Generated Password</div>
              <div style="font-size:22px;font-weight:800;font-family:monospace;letter-spacing:2px;color:var(--text)">${escHtml(pwd)}</div>
            </div>
            <p style="font-size:13px;color:var(--text-muted)">Next steps:</p>
            <ol style="font-size:13px;color:var(--text-muted);line-height:2;padding-left:18px">
              <li>Go to <strong>Firebase Console → Authentication → Add User</strong></li>
              <li>Email: <strong>${escHtml(email)}</strong></li>
              <li>Password: <strong>${escHtml(pwd)}</strong></li>
              <li>Share this password with ${escHtml(name)} via phone or message</li>
              <li>They can change it after first login</li>
            </ol>
          `, `<button class="btn-primary" onclick="closeModal()">Done</button>`);
          Notifs.showToast(`${name} approved!`);
          loadApprovalsSub('signups');
        });
      });

      wrap.querySelectorAll('.signup-reject').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!(await confirmDialog({message:`Reject ${escHtml(btn.dataset.name)}'s request?`, html:true}))) return;
          await db.collection('signup_requests').doc(btn.dataset.id).update({
            status: 'rejected', rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          Notifs.showToast('Request rejected.');
          loadApprovalsSub('signups');
        });
      });
      return;
    }

    if (sub === 'attendance') {
      // Attendance Extension Requests
      const snap = await db.collection('attendance_extensions').orderBy('requestedAt','desc').get().catch(()=>({docs:[]}));
      const items = snap.docs.map(d=>({id:d.id,...d.data()}));
      const pending = items.filter(i=>i.status==='pending');

      if (!items.length) {
        wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">⏰</div><h4>No extension requests</h4></div>';
        return;
      }
      wrap.innerHTML = `
        ${pending.length?`<div class="alert-banner alert-warn" style="margin-bottom:12px">⚠️ ${pending.length} pending request${pending.length>1?'s':''}</div>`:''}
        <div class="item-list">
          ${items.map(item=>`
          <div class="item-card" data-id="${item.id}">
            <div class="item-top">
              <div class="item-title">⏰ ${escHtml(item.userName||'Unknown')}</div>
              <span class="badge ${item.status==='approved'?'badge-green':item.status==='denied'?'badge-red':'badge-warn'}">${item.status||'pending'}</span>
            </div>
            <div class="item-meta">
              <span>📅 ${item.date||'—'}</span>
              ${item.requestedAt?`<span>Requested: ${new Date(item.requestedAt.toDate()).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</span>`:''}
              ${item.status==='approved'&&item.expiresAt?`<span>Expires: ${new Date(item.expiresAt.toDate()).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</span>`:''}
            </div>
            ${(item.status==='pending'&&canActOn('attendance'))?`
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-success ext-approve" data-id="${item.id}" data-uid="${item.uid}" data-name="${escHtml(item.userName||'')}">✓ Approve (6-hr)</button>
              <button class="btn-danger ext-deny" data-id="${item.id}" data-uid="${item.uid}" data-name="${escHtml(item.userName||'')}">✗ Deny</button>
            </div>`:''}
          </div>`).join('')}
        </div>
      `;

      wrap.querySelectorAll('.ext-approve').forEach(btn => {
        btn.addEventListener('click', async e => {
          const { id, uid, name } = e.currentTarget.dataset;
          const expiresAt = new Date(); expiresAt.setHours(expiresAt.getHours() + 6);
          await db.collection('attendance_extensions').doc(id).update({
            status: 'approved',
            approvedBy: currentUser.uid,
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt)
          });
          await Notifs.send(uid, {
            title: '✅ Extension Approved',
            body: `Your time extension has been approved. You have 6 hours from now to time in.`,
            icon: '✅', type: 'att_extension'
          });
          Notifs.showToast(`Extension approved for ${name}`);
          loadApprovalsSub('attendance');
        });
      });

      wrap.querySelectorAll('.ext-deny').forEach(btn => {
        btn.addEventListener('click', async e => {
          const { id, uid, name } = e.currentTarget.dataset;
          await db.collection('attendance_extensions').doc(id).update({ status: 'denied' });
          await Notifs.send(uid, {
            title: '❌ Extension Denied',
            body: 'Your attendance extension request was not approved.',
            icon: '❌', type: 'att_extension'
          });
          Notifs.showToast(`Extension denied for ${name}`);
          loadApprovalsSub('attendance');
        });
      });
      return;
    }

    if (sub === 'ca') {
      // Cash Advances
      const snap = await db.collection('cash_advances').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
      const items = snap.docs.map(d=>({id:d.id,...d.data()}));
      const pending = items.filter(i=>i.status==='pending');

      if (!items.length) { wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">💸</div><h4>No cash advance requests</h4></div>'; return; }
      wrap.innerHTML = `
        ${pending.length?`<p style="font-size:12px;color:var(--warning);font-weight:600;margin-bottom:12px">⚠️ ${pending.length} pending request${pending.length>1?'s':''}</p>`:''}
        <div class="item-list">
          ${items.map(item=>`
          <div class="item-card" data-id="${item.id}">
            <div class="item-top">
              <div class="item-title">💸 Cash Advance — ${escHtml(item.userName||'Unknown')}</div>
              <span class="badge ${statusBadge(item.status)}">${item.status||'pending'}</span>
            </div>
            <div class="item-meta">
              <span>₱${fmt(item.amount)}</span>
              <span>Date: ${item.date||'—'}</span>
              <span>Repay: ${item.repayDate||'—'}</span>
            </div>
            ${item.reason?`<div style="font-size:12px;color:var(--text-muted);margin-top:6px;padding:8px 10px;background:var(--surface2);border-radius:6px">${escHtml(item.reason)}</div>`:''}
            ${(item.status==='pending'&&canActOn('ca'))?`
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-success ca-approve" data-id="${item.id}" data-uid="${item.userId}" data-name="${escHtml(item.userName)}" data-amount="${item.amount}">Approve</button>
              <button class="btn-danger ca-reject" data-id="${item.id}" data-uid="${item.userId}" data-name="${escHtml(item.userName)}">Reject</button>
            </div>`:''}
          </div>`).join('')}
        </div>
      `;

      // v12 WS22 — this was the site with the "balance never set" bug: it flipped
      // status to 'approved' without ever writing a balance, so an advance
      // approved here stayed invisible to every downstream balance filter.
      wrap.querySelectorAll('.ca-approve').forEach(btn => {
        btn.addEventListener('click', e => window.CashAdvance.openApproveModal(e.currentTarget.dataset.id, () => loadApprovalsSub('ca')));
      });
      wrap.querySelectorAll('.ca-reject').forEach(btn => {
        btn.addEventListener('click', async e => {
          try { await window.CashAdvance.reject(e.currentTarget.dataset.id); Notifs.showToast('Request rejected.'); }
          catch (err) { Notifs.showToast(err.message||'Could not reject.','error'); }
          loadApprovalsSub('ca');
        });
      });

    } else if (sub === 'quote-files') {
      await renderBSQuotationFiles(wrap, currentUser, window.currentRole || 'president');
    } else {
      // Quote / ROA approvals
      const snap = await db.collection('approval_requests').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
      const items = snap.docs.map(d => ({id:d.id,...d.data()}));
      if (!items.length) { wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">✔️</div><h4>No quote approvals</h4></div>'; return; }

      wrap.innerHTML = `<div class="item-list">${items.map(item => `
        <div class="item-card" data-id="${item.id}">
          <div class="item-top">
            <div class="item-title">${item.type==='bs_quote'?'Brilliant Steel Quote':'Quote'} — ${escHtml(item.clientName||'')}</div>
            <span class="badge ${statusBadge(item.status)}">${item.status||'pending'}</span>
          </div>
          <div class="item-meta">
            <span>${escHtml(item.agentName||'—')}</span>
            <span>₱${fmt(item.total)}</span>
            ${item.createdAt?`<span>${new Date(item.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
          </div>
          ${(item.status==='pending'&&canActOn('quote-approval'))?`
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn-success approve-approval" data-id="${item.id}" data-agent="${item.agentId}" data-client="${escHtml(item.clientName)}">Approve</button>
            <button class="btn-danger reject-approval"  data-id="${item.id}" data-agent="${item.agentId}" data-client="${escHtml(item.clientName)}">Reject</button>
          </div>`:''}
        </div>`).join('')}</div>`;

      wrap.querySelectorAll('.approve-approval').forEach(btn => {
        btn.addEventListener('click', async e => {
          const { id, agent: agentId, client } = e.currentTarget.dataset;
          await db.collection('approval_requests').doc(id).update({ status: 'approved' });
          await Notifs.send(agentId, { title:'Quote Approved', body:`Your quote for ${client} was approved.`, icon:'✅', type:'approval_result' });
          Notifs.showToast('Quote approved!'); loadApprovalsSub('roa');
        });
      });
      wrap.querySelectorAll('.reject-approval').forEach(btn => {
        btn.addEventListener('click', async e => {
          const { id, agent: agentId, client } = e.currentTarget.dataset;
          await db.collection('approval_requests').doc(id).update({ status: 'rejected' });
          await Notifs.send(agentId, { title:'Quote Rejected', body:`Your quote for ${client} was not approved.`, icon:'❌', type:'approval_result' });
          Notifs.showToast('Quote rejected.'); loadApprovalsSub('roa');
        });
      });
    }
  };

  window.bindChipTabs(c, (key) => loadApprovalsSub(key));

  loadApprovalsSub('all');
};

// ── Partner quote-approval helpers (shared by Approvals page) ──────────
// Approve a partner-submitted quote: file it + resolve its approval request + notify.
async function approveQuoteApproval(quoteId, agentId, qno, name){
  if(!quoteId){ Notifs.showToast('Quote not found','error'); return; }
  try{
    await db.collection('bs_quotes').doc(quoteId).update({ status:'filed', approvalStatus:'approved', approvedAt:firebase.firestore.FieldValue.serverTimestamp(), approvedBy:currentUser.uid });
    await db.collection('approval_requests').where('quoteId','==',quoteId).get().then(s=>Promise.all(s.docs.map(d=>d.ref.update({status:'approved'}))));
    if(agentId) await Notifs.send(agentId, { title:'✅ Quote Approved!', body:`Quotation "${qno}" for ${name} was approved and filed.`, icon:'✅', type:'quote_approved' });
    window.logAudit && window.logAudit('update','quote',quoteId,{ approved:true });
    Notifs.showToast('Quote approved and filed!');
  }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
}
// Return a partner quote for revision: mark needs_revision + notify the partner.
async function returnQuoteToPartner(quoteId, agentId, qno, name, notes){
  if(!quoteId){ Notifs.showToast('Quote not found','error'); return; }
  try{
    const upd={ status:'needs_revision', approvalStatus:'needs_revision', returnedAt:firebase.firestore.FieldValue.serverTimestamp(), returnedBy:currentUser.uid };
    if(notes) upd.presidentNotes=notes;
    await db.collection('bs_quotes').doc(quoteId).update(upd);
    await db.collection('approval_requests').where('quoteId','==',quoteId).get().then(s=>Promise.all(s.docs.map(d=>d.ref.update({status:'returned'}))));
    if(agentId) await Notifs.send(agentId, { title:'↩ Quote Returned for Revision', body:`"${qno}" for ${name} was reviewed and returned.${notes?' Notes: '+notes:''} Please revise and re-submit.`, icon:'✎', type:'quote_returned' });
    window.logAudit && window.logAudit('update','quote',quoteId,{ returned:true });
    Notifs.showToast('Quote returned to partner.');
  }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
}
// Open the full review modal: open in builder, edit key fields, then approve/return.
async function openQuoteApprovalReview(ctx, onDone){
  const { quoteId, agentId, quoteNumber, clientName } = ctx;
  if(!quoteId){ Notifs.showToast('Quote not found','error'); return; }
  const snap = await db.collection('bs_quotes').doc(quoteId).get().catch(()=>null);
  if(!snap || !snap.exists){ Notifs.showToast('Quote not found','error'); return; }
  const q = snap.data();
  const ta = 'width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical';
  const hasSnapshot = !!q.editableState;
  openPage(`📝 Review Quote — ${escHtml(quoteNumber||q.quoteNumber||'')}`, `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Open the full quote in the builder to review/edit line items (saved back to the partner's quote), or adjust the key fields below, then approve or return it to the partner.</p>
    <button class="btn-secondary btn-sm" id="qar-open-builder" style="margin-bottom:14px" ${hasSnapshot?'':'disabled title="No editable snapshot for this quote"'}>🔧 Open full quote in Builder${hasSnapshot?'':' (no snapshot)'}</button>
    <div class="form-group"><label>Client Name</label><input id="qar-client" value="${(q.clientName||'').replace(/"/g,'&quot;')}"/></div>
    <div class="form-group"><label>Scope / Description</label><textarea id="qar-scope" rows="3" style="${ta}">${escHtml(q.scope||q.description||'')}</textarea></div>
    <div class="form-group"><label>Adjusted Total (₱)</label><input id="qar-total" type="number" value="${q.total||q.grandTotal||0}" inputmode="decimal"/></div>
    <div class="form-group"><label>Notes for Partner</label><textarea id="qar-notes" rows="2" placeholder="What to revise, or why approved…" style="${ta}">${escHtml(q.presidentNotes||'')}</textarea></div>
  `, `<button class="btn-success" id="qar-approve">✅ Save &amp; Approve</button><button class="btn-primary" id="qar-return">↩ Save &amp; Return to Partner</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  if (hasSnapshot) document.getElementById('qar-open-builder').addEventListener('click', ()=>{
    window._qbReviewContext = { quoteId, partnerUid: agentId, quoteNumber: quoteNumber||q.quoteNumber, clientName: q.clientName||clientName };
    closeModal();
    window.reopenQuoteFromDoc('bs_quotes', quoteId, 'bs-quote-builder');
  });
  const getEdits = ()=>({ clientName:document.getElementById('qar-client').value.trim(), scope:document.getElementById('qar-scope').value.trim(), total:parseFloat(document.getElementById('qar-total').value)||q.total||0, presidentNotes:document.getElementById('qar-notes').value.trim(), editedByPresident:true, editedAt:firebase.firestore.FieldValue.serverTimestamp(), editedBy:currentUser.uid });
  document.getElementById('qar-approve').addEventListener('click', async ()=>{
    const e=getEdits();
    try{
      await db.collection('bs_quotes').doc(quoteId).update({ ...e, status:'filed', approvalStatus:'approved', approvedAt:firebase.firestore.FieldValue.serverTimestamp(), approvedBy:currentUser.uid });
      await db.collection('approval_requests').where('quoteId','==',quoteId).get().then(s=>Promise.all(s.docs.map(d=>d.ref.update({status:'approved'}))));
      if(agentId) await Notifs.send(agentId, { title:'✅ Quote Approved!', body:`Quotation "${quoteNumber}" for ${e.clientName||clientName} was approved and filed.`, icon:'✅', type:'quote_approved' });
      window.logAudit && window.logAudit('update','quote',quoteId,{ approved:true, edited:true });
      closeModal(); Notifs.showToast('Quote edited, approved and filed!'); onDone&&onDone();
    }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
  document.getElementById('qar-return').addEventListener('click', async ()=>{
    const e=getEdits();
    try{
      await db.collection('bs_quotes').doc(quoteId).update({ ...e, status:'needs_revision', approvalStatus:'needs_revision', returnedAt:firebase.firestore.FieldValue.serverTimestamp(), returnedBy:currentUser.uid });
      await db.collection('approval_requests').where('quoteId','==',quoteId).get().then(s=>Promise.all(s.docs.map(d=>d.ref.update({status:'returned'}))));
      if(agentId) await Notifs.send(agentId, { title:'↩ Quote Returned for Revision', body:`"${quoteNumber}" for ${e.clientName||clientName} was reviewed and returned.${e.presidentNotes?' Notes: '+e.presidentNotes:''}`, icon:'✎', type:'quote_returned' });
      window.logAudit && window.logAudit('update','quote',quoteId,{ returned:true, edited:true });
      closeModal(); Notifs.showToast('Quote updated and returned to partner.'); onDone&&onDone();
    }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
}

// ══════════════════════════════════════════════════
//  SHARED: Client Profiles
// ══════════════════════════════════════════════════
// CRM lifecycle stages (shared by all three client CRMs).
const CRM_STAGES = [
  { key:'lead',     label:'Lead',     color:'#8e8e93',               icon:'🌱' },
  { key:'prospect', label:'Prospect', color:'#FFAA00',               icon:'🔥' },
  { key:'won',      label:'Won',      color:'var(--success,#30D158)', icon:'✅' },
  { key:'lost',     label:'Lost',     color:'var(--danger,#e5484d)',  icon:'✖️' },
];
function crmStageOf(cl){ return ['lead','prospect','won','lost'].includes(cl && cl.stage) ? cl.stage : 'lead'; }
function crmStageMeta(k){ return CRM_STAGES.find(s=>s.key===k) || CRM_STAGES[0]; }

async function renderClientProfiles(container, currentUser, currentRole, brand) {
  const collection = brand === 'brilliant-steel' ? 'bs_clients' : (brand === 'design' ? 'design_clients' : 'sales_clients');
  const snap = await db.collection(collection).orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
  const clients = snap.docs.map(d => ({id:d.id,...d.data()}));
  const canAdd = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='agent';
  const canDeleteDirect = currentRole==='president'||currentRole==='owner'||currentRole==='manager';
  const quoteColl  = brand==='brilliant-steel' ? 'bs_quotes' : 'bk_quotes';
  const builderNav = brand==='brilliant-steel' ? 'bs-quote-builder' : 'bk-quote-builder';
  const today = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10));

  const counts = { all: clients.length, lead:0, prospect:0, won:0, lost:0 };
  clients.forEach(c=>counts[crmStageOf(c)]++);
  const isOpen = c => { const s=crmStageOf(c); return s!=='won' && s!=='lost'; };
  const dueFollowups = clients.filter(c=>c.followUpDate && c.followUpDate <= today && isOpen(c)).length;
  let stageFilter = 'all';

  const chips = [{key:'all',label:'All',count:counts.all}, ...CRM_STAGES.map(s=>({key:s.key,label:s.label,icon:s.icon,count:counts[s.key]}))];

  container.innerHTML = `
    ${dueFollowups?`<div class="alert-banner alert-warn" style="margin-bottom:10px"><span>⏰ <strong>${dueFollowups}</strong> follow-up${dueFollowups>1?'s':''} due</span></div>`:''}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      ${window.chipTabs(chips, 'all', {cls:'cl-stage-tabs'})}
      ${canAdd?`<button class="btn-primary btn-sm" id="add-client-btn">+ Add Client</button>`:''}
    </div>
    <div id="cl-list"></div>
  `;

  const clientCard = cl => {
    const st = crmStageMeta(crmStageOf(cl));
    const fu = cl.followUpDate || '';
    const fuOverdue = fu && fu <= today && isOpen(cl);
    return `<div class="item-card cl-card" data-id="${cl.id}" data-name="${escHtml(cl.name||'')}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;cursor:pointer">
      <div style="flex:1;min-width:0">
        <div class="item-title">${escHtml(cl.name)} <span class="badge" style="font-size:9px;background:${st.color};color:#fff">${st.icon} ${st.label}</span>${cl.deleteRequested?' <span class="badge badge-red" style="font-size:9px">🗑 del req</span>':''}</div>
        <div class="item-meta">
          ${cl.company?`<span>🏢 ${escHtml(cl.company)}</span>`:''}
          ${cl.email?`<span>✉️ ${escHtml(cl.email)}</span>`:''}
          ${cl.phone?`<span>📞 ${escHtml(cl.phone)}</span>`:''}
          ${cl.lastQuoteNumber?`<span>📄 ${escHtml(cl.lastQuoteNumber)}</span>`:''}
          ${fu?`<span style="color:${fuOverdue?'var(--danger)':'var(--text-muted)'}">⏰ ${escHtml(fu)}${fuOverdue?' · due':''}</span>`:''}
        </div>
        <div style="font-size:11px;color:var(--primary);margin-top:4px">📄 View quotes / reopen →</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        ${canAdd?`<button class="btn-secondary btn-sm cl-edit-btn" data-id="${cl.id}" title="Edit / set stage">✎</button>`:''}
        ${canDeleteDirect
          ? `<button class="btn-secondary btn-sm cl-del-btn" data-id="${cl.id}" data-name="${escHtml(cl.name||'')}" style="color:var(--danger)">${emojiIcon('trash-2',14)}</button>`
          : `<button class="btn-secondary btn-sm cl-delreq-btn" data-id="${cl.id}" data-name="${escHtml(cl.name||'')}" ${cl.deleteRequested?'disabled':''}>${cl.deleteRequested?'⏳':emojiIcon('trash-2',14)}</button>`}
      </div>
    </div>`;
  };

  const openClientEditor = (cl) => {
    const e = cl || {};
    openPage(cl?'Edit Client':'Add Client', `
      <div class="form-group"><label>Name</label><input id="cl-name" value="${escHtml(e.name||'')}" placeholder="Client full name"/></div>
      <div class="form-group"><label>Company</label><input id="cl-company" value="${escHtml(e.company||'')}" placeholder="Company name"/></div>
      <div class="form-row">
        <div class="form-group"><label>Email</label><input id="cl-email" type="email" value="${escHtml(e.email||'')}"/></div>
        <div class="form-group"><label>Phone</label><input id="cl-phone" type="tel" value="${escHtml(e.phone||'')}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Stage</label><select id="cl-stage" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${CRM_STAGES.map(s=>`<option value="${s.key}" ${crmStageOf(e)===s.key?'selected':''}>${s.icon} ${s.label}</option>`).join('')}</select></div>
        <div class="form-group"><label>Follow-up date</label><input id="cl-followup" type="date" value="${escHtml(e.followUpDate||'')}"/></div>
      </div>
      <div class="form-group"><label>Address</label><textarea id="cl-address" rows="2">${escHtml(e.address||'')}</textarea></div>
      <div class="form-group"><label>Notes</label><textarea id="cl-notes" rows="2">${escHtml(e.notes||'')}</textarea></div>
    `, `<button class="btn-primary" id="save-client-btn">${cl?'Save':'Save Client'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-client-btn').addEventListener('click', async () => {
      const name = document.getElementById('cl-name').value.trim();
      if (!name) { Notifs.showToast('Name is required.','error'); return; }
      const data = {
        name, company: document.getElementById('cl-company').value.trim(),
        email: document.getElementById('cl-email').value.trim(),
        phone: document.getElementById('cl-phone').value.trim(),
        address: document.getElementById('cl-address').value.trim(),
        notes: document.getElementById('cl-notes').value.trim(),
        stage: document.getElementById('cl-stage').value,
        followUpDate: document.getElementById('cl-followup').value || '',
        lastContact: today,
      };
      try {
        if (cl) { await db.collection(collection).doc(cl.id).update(data); window.logAudit&&window.logAudit('update','client',cl.id,{name,stage:data.stage}); }
        else { data.addedBy=currentUser.uid; data.createdAt=firebase.firestore.FieldValue.serverTimestamp(); await db.collection(collection).add(data); }
        closeModal(); Notifs.showToast('Client saved'); renderClientProfiles(container, currentUser, currentRole, brand);
      } catch(ex){ Notifs.showToast('Save failed: '+(ex.message||ex.code),'error'); }
    });
  };

  const bindCards = () => {
    container.querySelectorAll('.cl-card').forEach(card => card.addEventListener('click', (e) => {
      if (e.target.closest('.cl-del-btn, .cl-delreq-btn, .cl-edit-btn')) return;
      const cl = clients.find(c=>c.id===card.dataset.id); if(!cl) return;
      openClientQuotesModal(cl, quoteColl, builderNav);
    }));
    container.querySelectorAll('.cl-edit-btn').forEach(b => b.addEventListener('click', () => openClientEditor(clients.find(c=>c.id===b.dataset.id))));
    container.querySelectorAll('.cl-del-btn').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog({message:`Delete client "${escHtml(b.dataset.name)}"? This cannot be undone.`, danger:true, html:true}))) return;
      try { await db.collection(collection).doc(b.dataset.id).delete(); window.logAudit&&window.logAudit('delete','client',b.dataset.id,{name:b.dataset.name}); Notifs.showToast('Client deleted'); renderClientProfiles(container, currentUser, currentRole, brand); }
      catch(ex){ Notifs.showToast('Delete failed','error'); }
    }));
    container.querySelectorAll('.cl-delreq-btn').forEach(b => b.addEventListener('click', async () => {
      const reason = (await promptDialog({message:'Reason for deleting this client folder? (sent to the president for approval)', required:true, multiline:true}))||'';
      try {
        await db.collection(collection).doc(b.dataset.id).update({ deleteRequested:true, deleteReason:reason, deleteRequestedBy:currentUser.uid, deleteRequestedAt:firebase.firestore.FieldValue.serverTimestamp() });
        await Notifs.sendToOwner({ title:'🗑 Client Delete Requested', body:`${userProfile?.displayName||currentUser.email} requests deleting client "${b.dataset.name}".${reason?' Reason: '+reason:''}`, icon:'🗑', type:'client_delete_request' });
        Notifs.showToast('Delete request sent to president'); renderClientProfiles(container, currentUser, currentRole, brand);
      } catch(ex){ Notifs.showToast('Request failed: '+(ex.message||ex.code),'error'); }
    }));
  };

  const renderList = () => {
    const shown = stageFilter==='all' ? clients : clients.filter(c=>crmStageOf(c)===stageFilter);
    const el = document.getElementById('cl-list'); if(!el) return;
    el.innerHTML = !shown.length
      ? `<div class="empty-state"><div class="empty-icon">👤</div><h4>No clients${stageFilter!=='all'?' in this stage':' yet'}</h4></div>`
      : `<div class="item-list">${shown.map(clientCard).join('')}</div>`;
    if (window.lucide) lucide.createIcons({ nodes: [el] });
    bindCards();
  };

  window.bindChipTabs(container.querySelector('.cl-stage-tabs'), (key)=>{ stageFilter=key; renderList(); });
  document.getElementById('add-client-btn')?.addEventListener('click', ()=>openClientEditor(null));
  renderList();
}

// Show one client's quote history with a Reopen action per quote.
async function openClientQuotesModal(cl, quoteColl, builderNav){
  openModal(`👤 ${escHtml(cl.name||'Client')}`, '<div class="loading-placeholder">Loading client…</div>',
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
  const body = document.getElementById('modal-body');
  // A partner may only read their OWN bs_quotes, so the query must be scoped to
  // them (an unscoped clientName query would be rejected by Firestore rules).
  const role = window.currentRole||'';
  const isPartnerU = role==='partner' || ((window.currentDepts||[]).length===1 && (window.currentDepts||[])[0]==='Brilliant Steel');
  const myUid = auth.currentUser?.uid;
  let docs = [];
  try {
    let q = db.collection(quoteColl).where('clientName','==',cl.name);
    if (isPartnerU && myUid) q = q.where('createdBy','==',myUid);
    const snap = await q.get();
    docs = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(_) {}
  if (!docs.length) {
    // fallback: scan recent quotes and match the name client-side
    try {
      let q = db.collection(quoteColl);
      if (isPartnerU && myUid) q = q.where('createdBy','==',myUid);
      const snap = await q.orderBy('createdAt','desc').limit(200).get();
      docs = snap.docs.map(d=>({id:d.id,...d.data()})).filter(q=>(q.clientName||'').trim().toLowerCase()===(cl.name||'').trim().toLowerCase());
    } catch(_) {}
  }
  docs.sort((a,b)=>((b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)));
  if (!body) return;
  const toMs = v => { if(!v) return 0; if (typeof v==='string'){ const t=Date.parse(v); return isNaN(t)?0:t; } if (v.seconds) return v.seconds*1000; if (v.toDate){ try{return v.toDate().getTime();}catch(_){return 0;} } return 0; };
  const fmtD = ms => ms ? new Date(ms).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '';
  const statusBadge = (q)=>{
    const s = q.status||q.approvalStatus||'draft';
    const map = { won:'badge-green', filed:'badge-blue', approved:'badge-green', pending_approval:'badge-amber', pending_review:'badge-amber', needs_revision:'badge-amber', rejected:'badge-red', sent:'badge-blue', draft:'badge-gray' };
    return `<span class="badge ${map[s]||'badge-gray'}" style="font-size:9px">${escHtml(s)}</span>`;
  };
  const st = (typeof crmStageMeta==='function') ? crmStageMeta(crmStageOf(cl)) : {icon:'',label:'',color:'#8e8e93'};
  const today = (window.bizDate?window.bizDate():new Date().toISOString().slice(0,10));
  const fuOverdue = cl.followUpDate && cl.followUpDate<=today && crmStageOf(cl)!=='won' && crmStageOf(cl)!=='lost';
  const totalQuoted = docs.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
  const wonVal = docs.filter(q=>q.salesOrderId||['won','filed','approved','accepted'].includes(q.status)).reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
  // Activity timeline — built from client fields + quotes (no extra reads).
  const events = [];
  if (cl.createdAt)   events.push({ ts:toMs(cl.createdAt),   icon:'➕', text:'Client added' });
  if (cl.lastContact) events.push({ ts:toMs(cl.lastContact), icon:'📞', text:'Contact logged' });
  docs.forEach(q=>{ const num=escHtml(q.quoteNumber||q.id.slice(-8)); events.push({ ts:toMs(q.createdAt), icon:'📄', text:`Quote ${num} · ₱${fmt(q.total||q.grandTotal||0)} · ${escHtml(q.status||q.approvalStatus||'draft')}` }); if (q.salesOrderId) events.push({ ts:toMs(q.wonAt||q.approvedAt||q.createdAt), icon:'✅', text:`Quote ${num} → Sales Order` }); });
  events.sort((a,b)=>b.ts-a.ts);
  body.innerHTML = `
    <div class="item-card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <span class="badge" style="font-size:10px;background:${st.color};color:#fff">${st.icon} ${st.label}</span>
        ${cl.company?`<span style="font-size:12px;color:var(--text-muted)">🏢 ${escHtml(cl.company)}</span>`:''}
      </div>
      <div class="item-meta">
        ${cl.email?`<span>✉️ ${escHtml(cl.email)}</span>`:''}
        ${cl.phone?`<span>📞 ${escHtml(cl.phone)}</span>`:''}
        ${cl.address?`<span>📍 ${escHtml(cl.address)}</span>`:''}
      </div>
      ${cl.followUpDate?`<div style="font-size:12px;margin-top:6px;color:${fuOverdue?'var(--danger)':'var(--text-muted)'}">⏰ Follow-up: <strong>${escHtml(cl.followUpDate)}</strong>${fuOverdue?' · due':''}</div>`:''}
      ${cl.notes?`<div style="font-size:12px;color:var(--text-muted);margin-top:6px">📝 ${escHtml(cl.notes)}</div>`:''}
      <div style="display:flex;gap:14px;margin-top:8px;font-size:12px;border-top:1px solid var(--border);padding-top:8px;flex-wrap:wrap">
        <span>Quotes: <strong>${docs.length}</strong></span>
        <span>Quoted: <strong>₱${fmt(totalQuoted)}</strong></span>
        <span>Won: <strong style="color:var(--success)">₱${fmt(wonVal)}</strong></span>
      </div>
    </div>
    ${events.length?`<h4 style="font-size:13px;margin:0 0 6px">🕓 Activity</h4>
    <div style="border-left:2px solid var(--border);margin:0 0 14px 6px;padding-left:12px;display:flex;flex-direction:column;gap:8px">
      ${events.map(e=>`<div style="display:flex;gap:8px;align-items:baseline"><span style="flex-shrink:0">${e.icon}</span><span style="font-size:12px;flex:1">${e.text}</span><span style="font-size:11px;color:var(--text-muted);flex-shrink:0">${fmtD(e.ts)}</span></div>`).join('')}
    </div>`:''}
    <h4 style="font-size:13px;margin:0 0 6px">📄 Quotes (${docs.length})</h4>
    ${!docs.length?'<div class="empty-state" style="padding:18px"><p>No quotes recorded for this client yet.</p></div>':`<div style="display:flex;flex-direction:column;gap:8px">
      ${docs.map(q=>`<div class="item-card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;font-family:monospace">${escHtml(q.quoteNumber||q.id.slice(-8))}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">₱${fmt(q.total||q.grandTotal||0)} ${statusBadge(q)} ${q.salesOrderId?'<span class="badge badge-green" style="font-size:9px">→ Sales Order</span>':''} ${q.createdAt?'· '+fmtD(toMs(q.createdAt)):''}</div>
        </div>
        ${q.editableState?`<div style="display:flex;gap:6px;flex-shrink:0"><button class="btn-secondary btn-sm clq-reopen" data-id="${q.id}">↻ Reopen</button><button class="btn-secondary btn-sm clq-rev" data-id="${q.id}" title="Start a new revision (R2, R3…) with today's date">⎘ New Revision</button></div>`:'<span style="font-size:10px;color:var(--text-muted);flex-shrink:0">no snapshot</span>'}
      </div>`).join('')}
    </div>`}
  `;
  body.querySelectorAll('.clq-reopen').forEach(btn=>btn.addEventListener('click',()=>{
    closeModal();
    window.reopenQuoteFromDoc(quoteColl, btn.dataset.id, builderNav);
  }));
  body.querySelectorAll('.clq-rev').forEach(btn=>btn.addEventListener('click',()=>{
    closeModal();
    window.newRevisionFromDoc(quoteColl, btn.dataset.id, builderNav);
  }));
}

// ══════════════════════════════════════════════════
//  SHARED: Generic Document Collection
// ══════════════════════════════════════════════════
async function renderDocCollection(container, collection, title, currentUser, currentRole, opts = {}) {
  const snap = await db.collection(collection).orderBy('createdAt','desc').get().catch(() => ({ docs: [] }));
  const docs = snap.docs.map(d => ({id:d.id,...d.data()}));
  const canAdd = opts.dept ? canEditDept(opts.dept)
    : (currentRole==='owner'||currentRole==='manager'||currentRole==='president'||currentRole==='finance');

  container.innerHTML = `
    ${canAdd?`<div style="text-align:right;margin-bottom:12px"><button class="btn-primary btn-sm" id="add-doc-btn">+ Add ${title.slice(0,-1)}</button></div>`:''}
    <div class="policy-grid">
      ${!docs.length
        ? `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">${opts.icon||'📄'}</div><h4>No ${title} yet</h4></div>`
        : docs.map(d => `
          <div class="policy-card">
            <div class="policy-icon">${opts.icon||'📄'}</div>
            <div class="policy-title">${escHtml(d.title)}</div>
            <div class="policy-desc">${escHtml(d.description||'')}</div>
            ${d.fileUrl?`<a href="${safeHttpUrl(d.fileUrl)}" target="_blank" class="btn-link" style="font-size:12px;margin-top:8px;display:block">📎 Open File</a>`:''}
            ${opts.editable&&canAdd?`<div style="display:flex;gap:6px;margin-top:10px">
              <button class="btn-secondary btn-sm doc-edit-btn" data-id="${d.id}">✎ Edit</button>
              <button class="btn-danger btn-sm doc-del-btn" data-id="${d.id}" data-label="${escHtml(d.title||'item')}">${emojiIcon('trash-2',14)}</button>
            </div>`:''}
          </div>`).join('')}
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  document.getElementById('add-doc-btn')?.addEventListener('click', () => {
    openPage(`Add to ${title}`, `
      <div class="form-group"><label>Title</label><input id="doc-title" placeholder="Document title"/></div>
      <div class="form-group"><label>Description</label><textarea id="doc-desc" rows="2"></textarea></div>
      <div id="doc-file-upload"></div>
    `, `<button class="btn-primary" id="save-doc-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    let uploadedFile = null;
    Drive.renderUploadArea('doc-file-upload', (result) => { uploadedFile = result; }, { label:'Attach file (optional)', accept:'*' });

    document.getElementById('save-doc-btn').addEventListener('click', async () => {
      await db.collection(collection).add({
        title:       document.getElementById('doc-title').value.trim(),
        description: document.getElementById('doc-desc').value.trim(),
        fileUrl:     uploadedFile?.url||null,
        fileName:    uploadedFile?.name||null,
        addedBy:     currentUser.uid,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); renderDocCollection(container, collection, title, currentUser, currentRole, opts);
    });
  });

  // Opt-in edit/delete (currently used by Finance → Purchasing). Deletes in a
  // Finance collection route through President approval; others delete directly.
  if (opts.editable && canAdd) {
    const redo = () => renderDocCollection(container, collection, title, currentUser, currentRole, opts);
    const singular = title.replace(/s$/,'');
    document.querySelectorAll('.doc-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const d = docs.find(x=>x.id===btn.dataset.id); if (!d) return;
      window.financeEditModal({ collection, docId:d.id, title:singular, onSaved:redo, fields:[
        { key:'title', label:'Title', type:'text', value:d.title, full:true },
        { key:'description', label:'Description', type:'textarea', value:d.description, full:true }
      ]});
    }));
    document.querySelectorAll('.doc-del-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (opts.dept === 'Finance') {
        window.financeDelete({ collection, docId:btn.dataset.id, label:`${singular.toLowerCase()} "${btn.dataset.label}"`, onDone:redo });
      } else {
        if (!(await confirmDialog({message:`Delete "${escHtml(btn.dataset.label)}"? This cannot be undone.`, danger:true, html:true}))) return;
        try { await db.collection(collection).doc(btn.dataset.id).delete(); Notifs.showToast('Deleted.'); redo(); }
        catch(e) { Notifs.showToast('Delete failed: '+(e.message||e),'error'); }
      }
    }));
  }
}

// ══════════════════════════════════════════════════
//  SHARED: File Collection (upload/view)
// ══════════════════════════════════════════════════
function renderFileCollection(title, id, currentRole) {
  const canUpload = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance'||currentRole==='employee'||currentRole==='agent';
  return `
    <div class="card">
      <div class="card-header"><h3>${title}</h3></div>
      <div class="card-body">
        ${canUpload?`<div id="${id}-upload" style="margin-bottom:16px"></div>`:''}
        <div id="${id}-files" class="item-list"><div class="loading-placeholder">Loading files…</div></div>
      </div>
    </div>
  `;
}

function bindFileCollection(id, currentUser, dept, subfolder) {
  const filesDiv = document.getElementById(`${id}-files`);
  // Root collection, name computed at runtime — no backup registration needed:
  // scripts/monthly-backup.js discovers every root collection via db.listCollections().
  const collection = `files_${id.replace(/-/g,'_')}`;
  const role = window.currentRole || '';
  const canDelete = role === 'president' || role === 'owner' || role === 'manager';
  const canRequestDelete = role === 'finance';

  const reloadFiles = () => {
  db.collection(collection).orderBy('createdAt','desc').get().then(snap => {
    const files = snap.docs.map(d => ({id:d.id,...d.data()}));
    if (!files.length) { filesDiv.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon">📁</div><p>No files uploaded yet</p></div>`; return; }
    filesDiv.innerHTML = files.map(f => `
      <div class="item-card" data-file-id="${f.id}">
        <div class="item-top">
          <div class="item-title">📄 ${escHtml(f.name)}</div>
          <div style="display:flex;gap:6px;align-items:center">
            ${f.url?`<a href="${safeHttpUrl(f.url)}" target="_blank" class="btn-primary btn-sm">Open</a>`:''}
            ${canDelete ? `<button class="btn-danger btn-sm file-delete-btn" data-id="${f.id}" data-name="${(f.name||'').replace(/"/g,'&quot;')}" style="font-size:11px">Delete</button>` : ''}
            ${canRequestDelete ? `<button class="btn-secondary btn-sm file-req-delete-btn" data-id="${f.id}" data-name="${(f.name||'').replace(/"/g,'&quot;')}" style="font-size:11px;color:var(--danger)">Request Delete</button>` : ''}
          </div>
        </div>
        <div class="item-meta">
          <span>👤 ${escHtml(f.uploadedByName||'—')}</span>
          ${f.createdAt?`<span>${new Date(f.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
          ${f.deleteRequested?`<span style="color:var(--danger);font-size:11px;font-weight:600">⏳ Delete requested</span>`:''}
        </div>
      </div>`).join('');

    // Direct delete (president/manager)
    filesDiv.querySelectorAll('.file-delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!(await confirmDialog({message:`Delete "${escHtml(btn.dataset.name)}"? This cannot be undone.`, danger:true, html:true}))) return;
        await db.collection(collection).doc(btn.dataset.id).delete();
        Notifs.showToast('File deleted.');
        reloadFiles();
      });
    });

    // Request delete (finance — notifies president)
    filesDiv.querySelectorAll('.file-req-delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!(await confirmDialog({message:`Request deletion of "${escHtml(btn.dataset.name)}"? The president will be notified to approve.`, danger:true, html:true}))) return;
        await db.collection(collection).doc(btn.dataset.id).update({ deleteRequested: true, deleteRequestedBy: currentUser.uid });
        // Notify president
        const presSnap = await db.collection('users').where('role','==','president').limit(1).get().catch(()=>({empty:true}));
        if (!presSnap.empty) {
          const requesterName = window.userProfile?.displayName || currentUser.email;
          await Notifs.send(presSnap.docs[0].id, {
            title: '🗑️ File Deletion Request',
            body: `${requesterName} is requesting to delete "${btn.dataset.name}". Go to Files to approve.`,
            icon: '🗑️', type: 'file_delete_request'
          });
        }
        Notifs.showToast('Deletion request sent to president.');
        reloadFiles();
      });
    });
  });
  };
  reloadFiles();

  // Bind upload
  const uploadDiv = document.getElementById(`${id}-upload`);
  if (!uploadDiv) return;
  Drive.renderUploadArea(`${id}-upload`, async (result, file) => {
    const s = await db.collection('users').doc(currentUser.uid).get();
    const name = s.exists ? s.data().displayName : currentUser.email;
    await db.collection(collection).add({
      name: file.name, url: result.url, source: result.source,
      uploadedBy: currentUser.uid, uploadedByName: name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    bindFileCollection(id, currentUser, dept, subfolder);
  }, { label: 'Upload file to Drive', dept, subfolder });
}

// ══════════════════════════════════════════════════
//  SHARED: Budgeting
// ══════════════════════════════════════════════════
async function renderBudgeting(container, currentUser, currentRole, dept) {
  // Root collection, name computed at runtime — no backup registration needed:
  // scripts/monthly-backup.js discovers every root collection via db.listCollections().
  const collection = `budgets_${dept.toLowerCase().replace(/\s+/g,'_')}`;
  // Allow: admins, finance, president, and members of this dept
  const isDeptMember = (window.currentDepts||[]).includes(dept);
  const canEdit = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance'||isDeptMember;
  // The shared ledger (actual spend) is finance/admin-only per Firestore rules.
  // Dept members who aren't finance can still see + edit budget allocations, but
  // not the spend figures — show those as "—" rather than a misleading ₱0.
  const canSeeSpend = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance';

  // Load budget lines + dept expenses from shared ledger
  const [budgetSnap, ledgerSnap] = await Promise.all([
    db.collection(collection).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
    canSeeSpend
      ? db.collection('ledger').where('dept','==',dept).limit(100).get().catch(()=>({docs:[]}))
      : Promise.resolve({docs:[]})
  ]);

  const items    = budgetSnap.docs.map(d=>({id:d.id,...d.data()}));
  const expenses = ledgerSnap.docs.map(d=>({id:d.id,...d.data()}))
    .sort((a,b)=>(b.date||'').localeCompare(a.date||''));

  // Compute spent per budget line from ledger entries
  items.forEach(item => {
    item.spent = expenses
      .filter(e=>e.budgetLineId===item.id && ledgerKind(e)==='expense')
      .reduce((s,e)=>s+(e.amount||0),0);
  });

  const totalBudget = items.reduce((s,i)=>s+(i.budget||0),0);
  const totalSpent  = expenses.filter(e=>ledgerKind(e)==='expense').reduce((s,e)=>s+(e.amount||0),0);
  const totalIncome = expenses.filter(e=>ledgerKind(e)==='income').reduce((s,e)=>s+(e.amount||0),0);

  container.innerHTML = `
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Total Budget</div><div class="kpi-value">₱${fmt(totalBudget)}</div></div>
      <div class="kpi-card red"><div class="kpi-label">Total Spent</div><div class="kpi-value">${canSeeSpend?'₱'+fmt(totalSpent):'—'}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Remaining</div><div class="kpi-value">${canSeeSpend?'₱'+fmt(totalBudget-totalSpent):'—'}</div></div>
      ${canSeeSpend&&totalIncome>0?`<div class="kpi-card accent"><div class="kpi-label">Income</div><div class="kpi-value">₱${fmt(totalIncome)}</div></div>`:''}
    </div>
    ${!canSeeSpend?`<div style="font-size:11px;color:var(--text-muted);margin:-6px 0 12px;display:flex;align-items:center;gap:6px"><span>💡</span> Spend tracking is visible to Finance &amp; Management.</div>`:''}
    ${canEdit?`<div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px">
      <button class="btn-secondary btn-sm" id="add-budget-line-btn">+ Budget Line</button>
      <button class="btn-primary btn-sm" id="log-expense-btn">📤 Log Expense / Income</button>
    </div>`:''}

    <!-- Budget allocations -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>📊 Budget Allocation</h3></div>
      <div class="card-body" style="padding:0">
        ${!items.length?'<div class="empty-state" style="padding:20px"><div class="empty-icon">📊</div><p>No budget lines yet.</p></div>':
          `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Item</th><th>Allocated</th><th>Spent</th><th>Remaining</th><th>%</th></tr></thead>
            <tbody>
              ${items.map(i=>{
                const pct = i.budget>0?Math.min(Math.round(i.spent/i.budget*100),100):0;
                const rem = i.budget-i.spent;
                return `<tr>
                  <td style="font-weight:600">${escHtml(i.name)}</td>
                  <td>₱${fmt(i.budget)}</td>
                  <td style="color:var(--danger)">${canSeeSpend?'₱'+fmt(i.spent):'—'}</td>
                  <td style="color:${rem<0?'var(--danger)':'var(--success)'}">${canSeeSpend?'₱'+fmt(rem):'—'}</td>
                  <td>
                    ${canSeeSpend?`<div style="display:flex;align-items:center;gap:6px;min-width:80px">
                      <div style="flex:1;height:6px;background:var(--surface2);border-radius:3px">
                        <div style="width:${pct}%;height:100%;border-radius:3px;background:${pct>=90?'var(--danger)':pct>=70?'var(--warning,#ff9f0a)':'var(--primary-light)'}"></div>
                      </div>
                      <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${pct}%</span>
                    </div>`:'<span style="font-size:11px;color:var(--text-muted)">—</span>'}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>`}
      </div>
    </div>

    <!-- Expense log (synced with Finance Ledger) -->
    <div class="card">
      <div class="card-header">
        <h3>🧾 Expense / Income Log</h3>
        <span style="font-size:11px;color:var(--text-muted)">Synced with Finance Ledger</span>
      </div>
      <div class="card-body" style="padding:0">
        ${!expenses.length?'<div class="empty-state" style="padding:20px"><div class="empty-icon">🧾</div><p>No expenses logged yet.</p></div>':
          `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Date</th><th>Description</th><th>Line Item</th><th>Type</th><th>Amount</th><th>By</th></tr></thead>
            <tbody>
              ${expenses.map(e=>`<tr>
                <td style="font-size:12px">${e.date||'—'}</td>
                <td style="font-size:12px">${escHtml(e.description||'—')}</td>
                <td style="font-size:11px;color:var(--text-muted)">${escHtml(e.budgetLineName||'—')}</td>
                <td><span class="badge ${e.type==='credit'?'badge-green':'badge-red'}">${e.type==='credit'?'Income':'Expense'}</span></td>
                <td style="color:${e.type==='credit'?'var(--success)':'var(--danger)'};font-weight:600">₱${fmt(e.amount)}</td>
                <td style="font-size:11px;color:var(--text-muted)">${escHtml(e.addedByName||'—')}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>`}
      </div>
    </div>
  `;

  // Add budget line
  document.getElementById('add-budget-line-btn')?.addEventListener('click', () => {
    openPage('Add Budget Line', `
      <div class="form-group"><label>Item Name</label><input id="bg-name" placeholder="e.g. Social Media Ads"/></div>
      <div class="form-group"><label>Allocated Budget (₱)</label><input id="bg-budget" type="number" step="0.01" min="0" inputmode="decimal"/></div>
    `, `<button class="btn-primary" id="save-bg-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-bg-btn').addEventListener('click', async () => {
      const name = document.getElementById('bg-name').value.trim();
      if (!name) { Notifs.showToast('Enter item name','error'); return; }
      await db.collection(collection).add({
        name,
        budget: parseFloat(document.getElementById('bg-budget').value)||0,
        dept,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); renderBudgeting(container, currentUser, currentRole, dept);
    });
  });

  // Log expense / income → writes to shared Finance ledger
  document.getElementById('log-expense-btn')?.addEventListener('click', () => {
    const lineOptions = items.map(i=>`<option value="${i.id}" data-name="${escHtml(i.name)}">${escHtml(i.name)}</option>`).join('');
    openPage('Log Expense / Income', `
      <div class="form-row">
        <div class="form-group"><label>Date</label><input id="exp-date" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Type</label>
          <select id="exp-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="debit">Expense (Debit)</option>
            <option value="credit">Income (Credit)</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Description</label><input id="exp-desc" placeholder="e.g. Facebook Ads payment"/></div>
      <div class="form-row">
        <div class="form-group"><label>Amount (₱)</label><input id="exp-amount" type="number" step="0.01" min="0" inputmode="decimal"/></div>
        <div class="form-group"><label>Budget Line</label>
          <select id="exp-line" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="">— None / General —</option>
            ${lineOptions}
          </select>
        </div>
      </div>
      <div class="form-group"><label>Reference # (optional)</label><input id="exp-ref" placeholder="OR #, Invoice #…"/></div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding:10px;background:rgba(155,168,255,0.08);border-radius:8px;font-size:12px;color:var(--text-muted)">
        🔗 This entry will also appear in Finance → Ledger
      </div>
    `, `<button class="btn-primary" id="save-exp-btn">Save & Sync to Finance</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('save-exp-btn').addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('exp-amount').value)||0;
      const desc   = document.getElementById('exp-desc').value.trim();
      if (!desc) { Notifs.showToast('Enter a description','error'); return; }
      if (!amount) { Notifs.showToast('Enter an amount','error'); return; }
      const type = document.getElementById('exp-type').value;
      const lineId = document.getElementById('exp-line').value;
      const lineSel = document.getElementById('exp-line');
      const lineName = lineId ? lineSel.options[lineSel.selectedIndex].dataset.name : null;
      const uName = userProfile?.displayName || currentUser.email;
      const expDate = document.getElementById('exp-date').value || today();
      try { await window.assertPeriodOpen(expDate); } catch (e) { return; } // toast already shown
      const category = dept + (type==='credit'?' Income':' Expense');

      // Write to shared Finance ledger with dept tag
      await db.collection('ledger').add({
        date:          expDate,
        type,
        accountType:   type==='credit' ? 'income' : 'expense', account: category,
        description:   desc,
        amount,
        category,
        dept,
        budgetLineId:  lineId || null,
        budgetLineName:lineName || null,
        refNumber:     document.getElementById('exp-ref').value.trim() || null,
        addedBy:       currentUser.uid,
        addedByName:   uName,
        source:        dept, // Finance can see which dept this came from
        createdAt:     firebase.firestore.FieldValue.serverTimestamp()
      });

      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');

      // Notify finance dept
      await Notifs.sendToDept('Finance', {
        title: `💸 ${dept} logged a ${type==='debit'?'expense':'income'}`,
        body:  `${uName}: ${desc} — ₱${amount.toLocaleString()}`,
        icon:  type==='debit'?'📤':'📥',
        type:  'finance_entry'
      }).catch(()=>{});

      closeModal();
      Notifs.showToast('Entry saved and synced to Finance!');
      renderBudgeting(container, currentUser, currentRole, dept);
    });
  });
}

// ══════════════════════════════════════════════════
//  FILES MODULE — shared helper
// ══════════════════════════════════════════════════
window.renderFileCollection = function(title, containerId, currentRole) {
  return `
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:6px">
        <h3>📁 ${title}</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-secondary btn-sm" id="newfolder-btn-${containerId}">📁 New Folder</button>
          <button class="btn-secondary btn-sm" id="addlink-btn-${containerId}">🔗 Add Link</button>
          <button class="btn-primary btn-sm" id="upload-btn-${containerId}">+ Upload File</button>
        </div>
      </div>
      <div class="card-body" id="files-list-${containerId}">
        <div class="loading-placeholder">Loading files…</div>
      </div>
    </div>
  `;
};

window.bindFileCollection = function(containerId, currentUser, dept, scope, filterUid) {
  const listEl = document.getElementById(`files-list-${containerId}`);
  const uploadBtn = document.getElementById(`upload-btn-${containerId}`);
  const newFolderBtn = document.getElementById(`newfolder-btn-${containerId}`);
  const addLinkBtn = document.getElementById(`addlink-btn-${containerId}`);
  // Root collection, name computed at runtime — no backup registration needed:
  // scripts/monthly-backup.js discovers every root collection via db.listCollections().
  const collection = `files_${scope.toLowerCase().replace(/\s+/g,'_')}`;
  let allFiles = [];
  let activeFolder = 'All';

  const renderList = () => {
    // folder markers (empty folders) are tracked but never shown as rows
    const markers = allFiles.filter(f=>f.isFolderMarker);
    const realFiles = allFiles.filter(f=>!f.isFolderMarker);
    const folders = [...new Set([
      ...realFiles.filter(f=>!f.archived).map(f=>f.folder||'General'),
      ...markers.map(m=>m.folder).filter(Boolean)
    ])].sort();
    const archivedCount = realFiles.filter(f=>f.archived).length;
    const showing = activeFolder==='__archived__'
      ? realFiles.filter(f=>f.archived)
      : realFiles.filter(f=>!f.archived && (activeFolder==='All' || (f.folder||'General')===activeFolder));
    const chipBar = `<div class="subtab-bar" style="margin-bottom:10px">
      ${['All',...folders].map(c=>`<button class="subtab-btn file-folder-chip ${activeFolder===c?'active':''}" data-folder="${escHtml(c)}">📁 ${escHtml(c)}</button>`).join('')}
      ${archivedCount?`<button class="subtab-btn file-folder-chip ${activeFolder==='__archived__'?'active':''}" data-folder="__archived__">🗄 Archived (${archivedCount})</button>`:''}
    </div>`;
    const rows = showing.length ? showing.map(f=>{
      const isLink = f.kind==='link';
      return `<tr>
        <td><a href="${escHtml(f.url)}" target="_blank" style="color:var(--primary);font-weight:600">${isLink?'🔗 ':'📄 '}${escHtml(f.name||'File')}</a>${f.description?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHtml(f.description)}</div>`:''}</td>
        <td><span class="badge badge-gray">${escHtml(f.folder||'General')}</span></td>
        <td>${escHtml(f.uploaderName||'—')}</td>
        <td style="font-size:11px;color:var(--text-muted)">${f.createdAt?new Date(f.createdAt.toDate()).toLocaleDateString('en-PH'):''}</td>
        <td style="white-space:nowrap"><a href="${escHtml(f.url)}" target="_blank" class="btn-secondary btn-sm" title="${isLink?'Open link':'Download'}">${isLink?'↗':'⬇'}</a>
          <button class="btn-secondary btn-sm file-arch-btn" data-id="${f.id}" data-arch="${f.archived?'0':'1'}" title="${f.archived?'Restore':'Archive'}">${f.archived?'♻️':'🗄'}</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="5"><div class="empty-state" style="padding:18px"><div class="empty-icon">📁</div><h4>${activeFolder!=='All'&&activeFolder!=='__archived__'?'This folder is empty':'No files here'}</h4></div></td></tr>`;
    listEl.innerHTML = chipBar + `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Name</th><th>Folder</th><th>Added By</th><th>Date</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    listEl.querySelectorAll('.file-folder-chip').forEach(b=>b.addEventListener('click',()=>{ activeFolder=b.dataset.folder; renderList(); }));
    listEl.querySelectorAll('.file-arch-btn').forEach(b=>b.addEventListener('click', async ()=>{
      try {
        await db.collection(collection).doc(b.dataset.id).update({ archived: b.dataset.arch==='1' });
        const f = allFiles.find(x=>x.id===b.dataset.id); if (f) f.archived = b.dataset.arch==='1';
        renderList();
      } catch(e) { Notifs.showToast('Only the uploader or an admin can archive this file','error'); }
    }));
  };

  const loadFiles = async () => {
    listEl.innerHTML = '<div class="loading-placeholder">Loading…</div>';
    let snap;
    if (filterUid) snap = await db.collection(collection).where('uploadedBy','==',filterUid).get().catch(()=>({docs:[]}));
    else           snap = await db.collection(collection).where('department','==',dept).get().catch(()=>({docs:[]}));
    allFiles = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    renderList();
  };

  loadFiles();

  uploadBtn?.addEventListener('click', () => {
    const existingFolders = [...new Set(allFiles.map(f=>f.folder||'General'))];
    const prefill = (activeFolder!=='All' && activeFolder!=='__archived__') ? activeFolder : '';
    openPage('Upload File', `
      <div class="form-group"><label>File Name / Title</label><input id="fn-title" placeholder="Descriptive name"/></div>
      <div class="form-group"><label>File Type</label>
        <select id="fn-type"><option>Document</option><option>Image</option><option>Spreadsheet</option><option>PDF</option><option>Other</option></select>
      </div>
      <div class="form-group"><label>Folder</label>
        <input id="fn-folder" list="fn-folder-list" placeholder="General" value="${escHtml(prefill)}"/>
        <datalist id="fn-folder-list">${existingFolders.map(f=>`<option value="${escHtml(f)}"></option>`).join('')}</datalist>
      </div>
      <div id="fn-upload-area"></div>
    `, `<button class="btn-primary" id="save-fn-btn">Upload</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let uploadedFile = null;
    Drive.renderUploadArea('fn-upload-area', r => { uploadedFile = r; }, { label: 'Choose file', dept, subfolder: 'Files' });
    document.getElementById('save-fn-btn').addEventListener('click', async () => {
      const s = await db.collection('users').doc(currentUser.uid).get();
      const uploaderName = s.exists ? s.data().displayName : currentUser.email;
      await db.collection(collection).add({
        name: document.getElementById('fn-title').value.trim() || (uploadedFile?.name||'File'),
        fileType: document.getElementById('fn-type').value,
        folder: document.getElementById('fn-folder').value.trim() || 'General',
        archived: false,
        url: uploadedFile?.url || '',
        department: dept,
        scope,
        uploadedBy: currentUser.uid,
        uploaderName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); loadFiles();
    });
  });

  // ── Create an (empty) folder ──────────────────────
  newFolderBtn?.addEventListener('click', () => {
    openModal('New Folder', `
      <div class="form-group"><label>Folder Name</label><input id="nf-name" placeholder="e.g. Contracts, 2026 Projects"/></div>
      <div style="font-size:11px;color:var(--text-muted)">Create a folder now, then upload files or add links into it.</div>
    `, `<button class="btn-primary" id="save-nf-btn">Create Folder</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-nf-btn').addEventListener('click', async () => {
      const name = document.getElementById('nf-name').value.trim();
      if (!name) { Notifs.showToast('Enter a folder name','error'); return; }
      if (name==='__archived__') { Notifs.showToast('Reserved name','error'); return; }
      const s = await db.collection('users').doc(currentUser.uid).get();
      const uploaderName = s.exists ? s.data().displayName : currentUser.email;
      await db.collection(collection).add({
        isFolderMarker: true, folder: name, name: `📁 ${name}`,
        archived: false, department: dept, scope,
        uploadedBy: currentUser.uid, uploaderName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); activeFolder = name; loadFiles();
    });
  });

  // ── Attach a link (URL) with title + description ──
  addLinkBtn?.addEventListener('click', () => {
    const existingFolders = [...new Set(allFiles.map(f=>f.folder||'General'))];
    const prefill = (activeFolder!=='All' && activeFolder!=='__archived__') ? activeFolder : '';
    openPage('Add Link', `
      <div class="form-group"><label>Title</label><input id="lk-title" placeholder="e.g. Google Drive folder, Spec sheet"/></div>
      <div class="form-group"><label>URL</label><input id="lk-url" type="url" placeholder="https://…"/></div>
      <div class="form-group"><label>Description</label><textarea id="lk-desc" rows="2" placeholder="Optional notes about this link"></textarea></div>
      <div class="form-group"><label>Folder</label>
        <input id="lk-folder" list="lk-folder-list" placeholder="General" value="${escHtml(prefill)}"/>
        <datalist id="lk-folder-list">${existingFolders.map(f=>`<option value="${escHtml(f)}"></option>`).join('')}</datalist>
      </div>
      <div id="lk-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="save-lk-btn">Add Link</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-lk-btn').addEventListener('click', async () => {
      const err = document.getElementById('lk-err');
      const title = document.getElementById('lk-title').value.trim();
      let url = document.getElementById('lk-url').value.trim();
      if (!title) { err.textContent='Enter a title.'; err.classList.remove('hidden'); return; }
      if (!url)   { err.textContent='Enter a URL.'; err.classList.remove('hidden'); return; }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;  // tolerate bare domains
      const s = await db.collection('users').doc(currentUser.uid).get();
      const uploaderName = s.exists ? s.data().displayName : currentUser.email;
      await db.collection(collection).add({
        kind: 'link', name: title, description: document.getElementById('lk-desc').value.trim(),
        folder: document.getElementById('lk-folder').value.trim() || 'General',
        archived: false, url, department: dept, scope,
        uploadedBy: currentUser.uid, uploaderName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); loadFiles();
    });
  });
};

// ── Shared doc collection helper ──────────────────
window.renderDocCollection = function(container, collection, title, currentUser, currentRole, cfg) {
  const canAdd = cfg?.dept ? canEditDept(cfg.dept)
    : (currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance');
  // Government Biddings gets a full lifecycle (view/edit, status change, move between
  // PhilGEPS / Active Bids / Archive buckets, delete). Other collections that share
  // this renderer keep the original read-only-card behaviour.
  const isGov = cfg?.dept === 'Government Biddings';
  const canManageGov = isGov && canEditDept('Government Biddings');
  const GOV_BUCKETS = [
    { label:'PhilGEPS',    collection:'gov_philgeps' },
    { label:'Active Bids', collection:'gov_active_bids' },
    { label:'Archive',     collection:'gov_archive' },
  ];
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div></div>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-doc-btn-${collection}">+ Add</button>`:''}
    </div>
    <div id="doc-list-${collection}"><div class="loading-placeholder">Loading…</div></div>
  `;
  const loadDocs = async () => {
    const snap = await db.collection(collection).get().catch(() => ({ docs: [] }));
    const docs = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const list = document.getElementById(`doc-list-${collection}`);
    if (!docs.length) { list.innerHTML=`<div class="empty-state" style="padding:20px"><div class="empty-icon">${cfg?.icon||'📄'}</div><h4>No ${title} yet</h4></div>`; return; }
    list.innerHTML = `<div class="item-list">${docs.map(d=>`
      <div class="item-card"${isGov?` data-gov-id="${d.id}" style="cursor:pointer"`:''}>
        <div class="item-top"><div class="item-title">${escHtml(d.title||d.name||'Untitled')}</div>
          <span class="badge ${statusBadge(d.status)}">${d.status||'active'}</span>
        </div>
        <div class="item-meta">
          ${d.description?`<span>${escHtml(d.description)}</span>`:''}
          ${d.fileUrl?`<a href="${safeHttpUrl(d.fileUrl)}" target="_blank" class="btn-link" style="font-size:11px" onclick="event.stopPropagation()">📎 View File</a>`:''}
          ${d.createdAt?`<span style="font-size:11px;color:var(--text-muted)">${new Date(d.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
        </div>
      </div>`).join('')}</div>`;
    if (isGov) {
      list.querySelectorAll('.item-card[data-gov-id]').forEach(card => {
        card.addEventListener('click', () => {
          const d = docs.find(x=>x.id===card.dataset.govId);
          if (d) openGovBidDetail(d);
        });
      });
    }
  };

  // ── Gov bidding detail / edit / move / delete ───────────────────────
  function openGovBidDetail(d) {
    const GOV_STATUSES = ['active','submitted','won','lost','cancelled','archived'];
    const body = canManageGov ? `
      <div class="form-group"><label>Title</label><input id="gb-title" value="${escHtml(d.title||d.name||'')}"/></div>
      <div class="form-group"><label>Description</label><textarea id="gb-desc" rows="3">${escHtml(d.description||'')}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Status</label>
          <select id="gb-status">${GOV_STATUSES.map(s=>`<option value="${s}" ${(d.status||'active')===s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Bucket</label>
          <select id="gb-bucket">${GOV_BUCKETS.map(b=>`<option value="${b.collection}" ${b.collection===collection?'selected':''}>${b.label}</option>`).join('')}</select>
        </div>
      </div>
      ${d.fileUrl?`<a href="${safeHttpUrl(d.fileUrl)}" target="_blank" class="btn-link" style="font-size:12px;display:block;margin-bottom:8px">📎 View File</a>`:''}
    ` : `
      <div style="margin-bottom:10px"><span class="badge ${statusBadge(d.status)}">${d.status||'active'}</span></div>
      <p style="font-size:14px;line-height:1.6;margin-bottom:10px">${escHtml(d.description||'No details.')}</p>
      ${d.fileUrl?`<a href="${safeHttpUrl(d.fileUrl)}" target="_blank" class="btn-link" style="font-size:12px;display:block">📎 View File</a>`:''}
    `;
    openPage(escHtml(d.title||d.name||'Bidding'), body,
      canManageGov
        ? `<button class="btn-primary" id="gb-save">Save</button><button class="btn-danger" id="gb-del">Delete</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`
        : `<button class="btn-secondary" onclick="closeModal()">Close</button>`);

    document.getElementById('gb-save')?.addEventListener('click', async () => {
      const title = document.getElementById('gb-title').value.trim();
      if (!title) { Notifs.showToast('Enter a title.','error'); return; }
      const targetCol = document.getElementById('gb-bucket').value;
      const payload = {
        title,
        description: document.getElementById('gb-desc').value.trim(),
        status: document.getElementById('gb-status').value,
        fileUrl: d.fileUrl||null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentUser.uid
      };
      if (targetCol !== collection) {
        if (!(await confirmDialog({message:`Move "${escHtml(title)}" to ${GOV_BUCKETS.find(b=>b.collection===targetCol)?.label||targetCol}?`, html:true}))) return;
        // Move = create in the target bucket + delete from current (atomic batch).
        const { id:_omitId, ...rest } = d;
        const batch = db.batch();
        const newRef = db.collection(targetCol).doc();
        batch.set(newRef, { ...rest, ...payload, addedBy: d.addedBy||currentUser.uid, createdAt: d.createdAt||firebase.firestore.FieldValue.serverTimestamp() });
        batch.delete(db.collection(collection).doc(d.id));
        await batch.commit();
        Notifs.showToast('Bid moved.');
      } else {
        await db.collection(collection).doc(d.id).update(payload);
        Notifs.showToast('Bid updated.');
      }
      closeModal(); loadDocs();
    });
    document.getElementById('gb-del')?.addEventListener('click', async () => {
      if (!(await confirmDialog({message:`Delete "${escHtml(d.title||d.name||'this bid')}"? This cannot be undone.`, danger:true, html:true}))) return;
      await db.collection(collection).doc(d.id).delete();
      closeModal(); Notifs.showToast('Bid deleted.'); loadDocs();
    });
  }

  loadDocs();
  document.getElementById(`add-doc-btn-${collection}`)?.addEventListener('click', () => {
    openPage(`Add ${title}`, `
      <div class="form-group"><label>Title</label><input id="gd-title"/></div>
      <div class="form-group"><label>Description</label><textarea id="gd-desc" rows="3"></textarea></div>
      <div id="gd-file-area"></div>
    `, `<button class="btn-primary" id="save-gd-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let uploadedFile = null;
    Drive.renderUploadArea('gd-file-area', r => { uploadedFile = r; }, { label: 'Attach file', dept: title, subfolder: collection });
    document.getElementById('save-gd-btn').addEventListener('click', async () => {
      await db.collection(collection).add({
        title: document.getElementById('gd-title').value.trim(),
        description: document.getElementById('gd-desc').value.trim(),
        fileUrl: uploadedFile?.url || null,
        status: 'active',
        addedBy: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); loadDocs();
    });
  });
};

// ═══════════════════════════════════════════════════
//  PRODUCTION DEPARTMENT — shop-floor work orders
// ═══════════════════════════════════════════════════
const PROD_STAGES = [
  { id:'queued',    label:'Queued',      icon:'📋', color:'#78909c' },
  { id:'cutting',   label:'Cutting',     icon:'✂️', color:'#5c6bc0' },
  { id:'welding',   label:'Welding / Fab', icon:'🔧', color:'#7e57c2' },
  { id:'assembly',  label:'Assembly',    icon:'🛠️', color:'#26a69a' },
  { id:'finishing', label:'Finishing',   icon:'✨', color:'#26c6da' },
  { id:'qc',        label:'QC',          icon:'🔍', color:'#ffa726' },
  { id:'ready',     label:'Ready',       icon:'📦', color:'#66bb6a' },
  { id:'delivered', label:'Delivered',   icon:'🚚', color:'#43a047' },
];
function prodStage(id){ return PROD_STAGES.find(s=>s.id===id) || PROD_STAGES[0]; }

// ═══════════════════════════════════════════════════
//  PROJECT LIFECYCLE — the spine tying quote → sales order → production →
//  delivery → completion → billing/payment into ONE job_projects record.
//  Every downstream doc references it via projectId. (Named job_projects to
//  avoid the unrelated Design 'projects' board.)
// ═══════════════════════════════════════════════════
const JOB_STAGES = [
  { id:'won',           label:'Won',           icon:'🤝', color:'#26a69a', dept:'Sales' },
  { id:'in_production', label:'In Production', icon:'🏭', color:'#7e57c2', dept:'Production' },
  { id:'for_delivery',  label:'For Delivery',  icon:'📦', color:'#26c6da', dept:'Production' },
  { id:'delivered',     label:'Delivered',     icon:'🚚', color:'#42a5f5', dept:'Production' },
  { id:'completed',     label:'Completed',     icon:'✅', color:'#66bb6a', dept:'Sales' },
  { id:'paid',          label:'Paid / Closed', icon:'💰', color:'#43a047', dept:'Finance' },
  { id:'cancelled',     label:'Cancelled',     icon:'✖️', color:'#ef5350', dept:'Sales' },
];
function jobStage(id){ return JOB_STAGES.find(s=>s.id===id) || JOB_STAGES[0]; }
const _isFinAdmin = () => ['president','owner','manager','finance'].includes(window.currentRole) || (window.currentDepts||[]).includes('Finance');

// Create the master project when a quote is won (called from the Sales Order flow).
async function createJobProject(d){
  let seq='001';
  try { const cnt=(await db.collection('job_projects').get()).size; seq=String(cnt+1).padStart(3,'0'); } catch(_) { seq=String(Date.now()).slice(-3); }
  const ym=(window.bizDate?window.bizDate():new Date().toISOString().slice(0,10)).slice(2,7).replace('-','');
  const projectNo=`JP-${ym}-${seq}`;
  const contract=parseFloat(d.total)||0;
  const company=d.co||'BS';
  const who=userProfile?.displayName||currentUser.email;
  // For shared (BS) projects, remember the partner who originated the quote so
  // their portal can read the project + compute their 50% expected earnings.
  const partnerUid = (company==='BS') ? (d.partnerUid||d.createdBy||null) : null;
  const ref=await db.collection('job_projects').add({
    projectNo, company, name:((d.client||'Client')+' — '+(d.qno||'')).trim(),
    clientName:d.client||'', stage:'won',
    quoteId:d.id||null, quoteNumber:d.qno||'', quoteCollection: company==='BK'?'bk_quotes':'bs_quotes',
    contractAmount:contract, amountCollected:0, arBalance:contract, vatRate:12, capital:0,
    partnerUid,
    split:{ isShared: company==='BS', barroPct:50, partnerPct:50 },
    documents:[{ type:'Quotation', ref:d.qno||'', at:new Date().toISOString(), by:who }],
    timeline:[{ at:new Date().toISOString(), event:'Project created — quote won', by:who }],
    payments:[], productionOrderIds:[],
    createdBy:currentUser.uid, createdByName:who,
    createdAt:firebase.firestore.FieldValue.serverTimestamp(), updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
  });
  window.logAudit && window.logAudit('create','project',ref.id,{ client:d.client, contract });
  return { id:ref.id, projectNo };
}

window.renderProjectLifecycle = async function(){
  const c = deptContainer(); if(!c) return;
  c.innerHTML='<div class="loading-placeholder">Loading projects…</div>';
  const isPartnerU = currentRole==='partner' || (currentDepts||[]).length===1 && currentDepts[0]==='Brilliant Steel';
  const snap = await db.collection('job_projects').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
  let projects = snap.docs.map(d=>({id:d.id,...d.data()}));
  if (isPartnerU) projects = projects.filter(p=>p.createdBy===currentUser.uid || p.partnerUid===currentUser.uid); // partners: own + shared
  // Design-board projects (separate collection) shown read-only below, so this page
  // is the single place to see ALL projects. Partners never see the internal board.
  let designList = [];
  if (!isPartnerU) {
    const dsnap = await db.collection('projects').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
    designList = dsnap.docs.map(d=>window.Projects.normalize(d,'design'));
  }
  const canTagProjects = ['president','owner','manager','secretary'].includes(currentRole);
  const active = projects.filter(p=>!['paid','cancelled'].includes(p.stage));
  const inProd = projects.filter(p=>p.stage==='in_production').length;
  const forDel = projects.filter(p=>p.stage==='for_delivery'||p.stage==='delivered').length;
  // AR is DERIVED (contract − collected) rather than the stored arBalance field, so
  // the KPI is always correct even if a project's stored arBalance drifted.
  const collected = projects.reduce((s,p)=>s+(p.amountCollected||0),0);
  const arTotal = projects.reduce((s,p)=>s+Math.max(0,(p.contractAmount||0)-(p.amountCollected||0)),0);
  const byStage={}; active.forEach(p=>{ (byStage[p.stage]=byStage[p.stage]||[]).push(p); });
  const done = projects.filter(p=>['paid','cancelled'].includes(p.stage));

  const card = (p)=>{ const st=jobStage(p.stage); return `<div class="item-card proj-card" data-id="${p.id}" style="cursor:pointer;border-left:3px solid ${st.color}">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px">${escHtml(p.clientName||p.name||'Project')}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px"><span style="font-family:monospace">${escHtml(p.projectNo||'')}</span> · ${escHtml(p.quoteNumber||'')} · <span class="badge ${p.company==='BK'?'badge-orange':'badge-gray'}" style="font-size:9px">${p.company||''}</span>${p.split?.isShared?' <span class="badge badge-blue" style="font-size:9px">50/50</span>':''}</div>
        <div style="font-size:11px;margin-top:3px">Contract ₱${fmt(p.contractAmount||0)} · <span style="color:${Math.max(0,(p.contractAmount||0)-(p.amountCollected||0))>0?'var(--warning)':'var(--success)'}">AR ₱${fmt(Math.max(0,(p.contractAmount||0)-(p.amountCollected||0)))}</span></div>
      </div>
      <span class="badge" style="background:${st.color};color:#fff;flex-shrink:0">${st.icon} ${st.label}</span>
    </div></div>`; };

  c.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>📈 Projects</h2><div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--text-muted)">Quote → Order → Production → Delivery → Paid</span>${canTagProjects?`<button class="btn-secondary btn-sm" onclick="window.runProjectKindBackfill()" title="Tag projects with kind (job/design)">🔖 Tag</button>`:''}</div></div>
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Active</div><div class="kpi-value">${active.length}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">In Production</div><div class="kpi-value">${inProd}</div></div>
      <div class="kpi-card"><div class="kpi-label">For Delivery</div><div class="kpi-value">${forDel}</div></div>
      <div class="kpi-card ${arTotal>0?'warn':''}"><div class="kpi-label">Receivables ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(arTotal)}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Collected ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(collected)}</div></div>
    </div>
    ${!projects.length?'<div class="empty-state" style="padding:30px"><div class="empty-icon">📈</div><h4>No projects yet</h4><p>A project is created when a quote is converted to a Sales Order.</p></div>':''}
    ${JOB_STAGES.filter(s=>!['paid','cancelled'].includes(s.id) && (byStage[s.id]||[]).length).map(s=>`
      <div class="card" style="margin-bottom:12px"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center"><h3 style="font-size:13px">${s.icon} ${s.label}</h3><span class="badge" style="background:${s.color};color:#fff">${(byStage[s.id]||[]).length}</span></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:8px">${(byStage[s.id]||[]).map(card).join('')}</div></div>`).join('')}
    ${done.length?`<details style="margin-top:6px"><summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--text-muted);padding:6px 0">💰 Paid / Closed (${done.length})</summary><div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${done.slice(0,30).map(card).join('')}</div></details>`:''}
    ${designList.length?`<details style="margin-top:10px" open><summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--text-muted);padding:6px 0">🎨 Design Projects (${designList.length})</summary>
      <div style="font-size:11px;color:var(--text-muted);margin:2px 0 8px">From the Design board — manage in Design → Projects.</div>
      <div style="display:flex;flex-direction:column;gap:8px">${designList.map(d=>`<div class="item-card" style="border-left:3px solid #4a148c">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13px">${escHtml(d.name||'Design project')}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHtml(d.clientName||'—')}${d.stage?` · ${escHtml(d.stage)}`:''}</div>
            <div style="font-size:11px;margin-top:3px">Contract ₱${fmt(d.contractAmount)} · Collected ₱${fmt(d.collected)} · <span style="color:${d.arBalance>0?'var(--warning)':'var(--success)'}">AR ₱${fmt(d.arBalance)}</span></div>
          </div>
          <span class="badge badge-purple" style="font-size:9px;flex-shrink:0">DESIGN</span>
        </div></div>`).join('')}</div></details>`:''}`;
  c.querySelectorAll('.proj-card').forEach(el=>el.addEventListener('click',()=>openJobProjectDetail(projects.find(p=>p.id===el.dataset.id))));
};

// NOTE: named openJobProjectDetail (not openProjectDetail) deliberately. The Design
// board defines window.openProjectDetail; in this shared global script a bare
// `openProjectDetail` would resolve to that Design modal and shadow this one.
function openJobProjectDetail(p){
  if(!p) return;
  const st=jobStage(p.stage);
  const isPartnerU = currentRole==='partner' || (currentDepts||[]).length===1 && currentDepts[0]==='Brilliant Steel';
  const ownerDept = st.dept;
  const canAdvance = !isPartnerU && (canEditDept(ownerDept) || canEditDept('Sales'));
  const idx = JOB_STAGES.findIndex(s=>s.id===p.stage);
  const next = (p.stage==='paid'||p.stage==='cancelled') ? null : JOB_STAGES[Math.min(idx+1, JOB_STAGES.length-2)];
  const stepper = JOB_STAGES.filter(s=>s.id!=='cancelled').map(s=>{const i=JOB_STAGES.findIndex(x=>x.id===s.id);const dn=i<idx,cur=s.id===p.stage;return `<span style="font-size:10px;padding:3px 7px;border-radius:10px;white-space:nowrap;${cur?`background:${s.color};color:#fff;font-weight:700`:dn?'background:var(--success);color:#fff':'background:var(--surface2);color:var(--text-muted)'}">${s.icon} ${s.label}</span>`;}).join('<span style="color:var(--text-muted)">›</span>');
  openModal(`${st.icon} ${escHtml(p.clientName||p.name||'Project')}`, `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px"><span style="font-family:monospace">${escHtml(p.projectNo||'')}</span> · Quote ${escHtml(p.quoteNumber||'')} · ${p.company||''}${p.split?.isShared?' · 50/50 split':''}</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:12px">${stepper}</div>
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Contract</div><div class="kpi-value" style="font-size:14px">₱${fmt(p.contractAmount||0)}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Collected</div><div class="kpi-value" style="font-size:14px">₱${fmt(p.amountCollected||0)}</div></div>
      <div class="kpi-card ${Math.max(0,(p.contractAmount||0)-(p.amountCollected||0))>0?'warn':''}"><div class="kpi-label">Balance (AR)</div><div class="kpi-value" style="font-size:14px">₱${fmt(Math.max(0,(p.contractAmount||0)-(p.amountCollected||0)))}</div></div>
    </div>
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:12px">💰 Margin &amp; Split</strong>${(!isPartnerU && (canEditDept('Sales')||_isFinAdmin()))?`<button class="btn-secondary btn-sm" id="proj-margin-btn">Edit factors</button>`:''}</div>
      <div style="font-size:12px;margin-top:6px;display:grid;grid-template-columns:1fr auto;gap:3px 12px">
        <span style="color:var(--text-muted)">Contract</span><span style="text-align:right">₱${fmt(p.contractAmount||0)}</span>
        <span style="color:var(--text-muted)">Capital (cost)</span><span style="text-align:right">₱${fmt(p.capital||0)}</span>
        <span style="color:var(--text-muted)">Margin</span><span style="text-align:right;font-weight:700">₱${fmt((p.contractAmount||0)-(p.capital||0))}</span>
        ${p.split?.isShared?`<span style="color:var(--text-muted)">Partner share (${p.split?.partnerPct||50}%)</span><span style="text-align:right;font-weight:700;color:var(--success)">₱${fmt(((p.contractAmount||0)-(p.capital||0))*((p.split?.partnerPct||50)/100))}</span>`:''}
      </div>
    </div></div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">📄 Document Register</div>
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:0">
      ${(p.documents||[]).length?`<div class="table-wrap"><table class="data-table"><tbody>${(p.documents||[]).map(dc=>`<tr><td style="font-weight:600;font-size:12px">${escHtml(dc.type||'')}</td><td style="font-size:11px">${escHtml(dc.ref||'')}</td><td style="font-size:11px;color:var(--text-muted)">${dc.at?new Date(dc.at).toLocaleDateString('en-PH',{month:'short',day:'numeric'}):''} · ${escHtml(dc.by||'')}</td></tr>`).join('')}</tbody></table></div>`:'<div style="padding:12px;font-size:12px;color:var(--text-muted)">No documents yet.</div>'}
    </div></div>
    ${(p.invoices||[]).length?`
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">🧾 Billing Invoices</div>
    <div class="item-list" style="margin-bottom:10px">${(p.invoices||[]).slice().reverse().map(inv=>`
      <div class="item-card jinv-card" style="cursor:pointer" data-inv="${escHtml(inv.no)}">
        <div class="item-top"><div class="item-title" style="font-size:13px">🧾 ${escHtml(inv.no)}</div><span>₱${fmt(inv.amount)}</span></div>
        <div class="item-meta"><span>📅 ${escHtml(inv.date||'')}</span>${inv.due?`<span>Due ${escHtml(inv.due)}</span>`:''}${inv.desc?`<span>${escHtml(inv.desc)}</span>`:''}</div>
      </div>`).join('')}</div>`:''}
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">🕘 Timeline</div>
    <div style="max-height:160px;overflow:auto;font-size:12px">${(p.timeline||[]).slice().reverse().map(t=>`<div style="padding:5px 0;border-bottom:1px solid var(--border)"><strong>${escHtml(t.event||'')}</strong><div style="font-size:11px;color:var(--text-muted)">${t.at?new Date(t.at).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''} · ${escHtml(t.by||'')}</div></div>`).join('')||'<div style="color:var(--text-muted)">No activity yet.</div>'}</div>
    <div id="proj-detail-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `
    ${_isFinAdmin()&&!isPartnerU?'<button class="btn-primary" id="proj-bill-btn">💵 Record Payment</button>':''}
    ${_isFinAdmin()&&!isPartnerU&&(Number(p.contractAmount)||0)>0?'<button class="btn-secondary" id="proj-invoice-btn">🧾 Billing Invoice</button>':''}
    ${!isPartnerU && (canEditDept('Production')||canEditDept('Sales')) && ['won','in_production'].includes(p.stage)?'<button class="btn-secondary" id="proj-job-btn">🏭 Job Order</button>':''}
    ${canAdvance&&next?`<button class="btn-success" id="proj-advance-btn">Advance → ${next.label}</button>`:''}
    <button class="btn-secondary" onclick="closeModal()">Close</button>`);
  document.getElementById('proj-advance-btn')?.addEventListener('click',()=>advanceProjectStage(p, next.id));
  document.getElementById('proj-bill-btn')?.addEventListener('click',()=>openProjectBillingModal(p));
  document.getElementById('proj-invoice-btn')?.addEventListener('click',()=>openJobBillingInvoiceModal(p));
  document.getElementById('proj-margin-btn')?.addEventListener('click',()=>openProjectMarginModal(p));
  document.getElementById('proj-job-btn')?.addEventListener('click',()=>{ closeModal(); prodOrderModal(null, currentUser, currentRole, ()=>window.renderProjectLifecycle&&window.renderProjectLifecycle(), p.id); });
  // Re-open a previously issued billing invoice (printable)
  document.querySelectorAll('#modal-body .jinv-card').forEach(card=>card.addEventListener('click',()=>{
    const inv=(p.invoices||[]).find(i=>i.no===card.dataset.inv);
    if(inv) window.openBillingInvoice(p, inv);
  }));
}

// Edit the profit factors (capital cost + partner split %) on a project.
// Gated to president / Sales / Finance per the user's request; partner cannot edit.
function openProjectMarginModal(p){
  const isShared = !!(p.split&&p.split.isShared);
  const pct = (p.split&&typeof p.split.partnerPct==='number')?p.split.partnerPct:50;
  openPage('💰 Edit Profit Factors — '+(escHtml(p.clientName||p.projectNo||'Project')), `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Contract value <strong>₱${fmt(p.contractAmount||0)}</strong>. Expected earnings = (Contract − Capital) × split%.</div>
    <div class="form-group"><label>Capital / cost (₱)</label><input id="pm-capital" type="number" step="0.01" min="0" value="${p.capital||0}" inputmode="decimal"/>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Total material + labor + overhead to produce this job.</div></div>
    ${isShared?`<div class="form-group"><label>Partner split (%)</label><input id="pm-pct" type="number" step="1" min="0" max="100" value="${pct}" inputmode="decimal"/>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Brilliant Steel's share of the margin (50/50 default). Barro keeps the rest.</div></div>`:''}
    <div class="card" style="margin-top:6px"><div class="card-body" style="padding:10px 14px;font-size:12px;display:grid;grid-template-columns:1fr auto;gap:3px 12px">
      <span style="color:var(--text-muted)">Margin</span><span id="pm-margin" style="text-align:right;font-weight:700">₱${fmt((p.contractAmount||0)-(p.capital||0))}</span>
      ${isShared?`<span style="color:var(--text-muted)">Partner share</span><span id="pm-share" style="text-align:right;font-weight:700;color:var(--success)">₱${fmt(((p.contractAmount||0)-(p.capital||0))*(pct/100))}</span>
      <span style="color:var(--text-muted)">Barro share</span><span id="pm-barro" style="text-align:right;font-weight:700">₱${fmt(((p.contractAmount||0)-(p.capital||0))*((100-pct)/100))}</span>`:''}
    </div></div>
    <div id="pm-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="pm-save">Save Factors</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  const recompute=()=>{
    const cap=parseFloat(document.getElementById('pm-capital').value)||0;
    const margin=(p.contractAmount||0)-cap;
    document.getElementById('pm-margin').textContent='₱'+fmt(margin);
    if(isShared){
      const pp=Math.max(0,Math.min(100,parseFloat(document.getElementById('pm-pct').value)||0));
      document.getElementById('pm-share').textContent='₱'+fmt(margin*(pp/100));
      document.getElementById('pm-barro').textContent='₱'+fmt(margin*((100-pp)/100));
    }
  };
  document.getElementById('pm-capital').addEventListener('input',recompute);
  document.getElementById('pm-pct')?.addEventListener('input',recompute);
  document.getElementById('pm-save').addEventListener('click', async ()=>{
    const err=document.getElementById('pm-err');
    const cap=parseFloat(document.getElementById('pm-capital').value)||0;
    if(cap<0){ err.textContent='Capital cannot be negative.'; err.classList.remove('hidden'); return; }
    const who=userProfile?.displayName||currentUser.email;
    const update={ capital:cap, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
      timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:`Profit factors updated (capital ₱${cap.toLocaleString()})`, by:who }) };
    if(isShared){
      let pp=Math.max(0,Math.min(100,parseFloat(document.getElementById('pm-pct').value)||0));
      update['split.partnerPct']=pp; update['split.barroPct']=100-pp;
    }
    try{
      await db.collection('job_projects').doc(p.id).update(update);
      window.logAudit && window.logAudit('update','project',p.id,{ capital:cap, partnerPct:update['split.partnerPct'] });
      // reflect locally so the reopened detail shows fresh numbers
      p.capital=cap; if(isShared){ p.split=p.split||{}; p.split.partnerPct=update['split.partnerPct']; p.split.barroPct=update['split.barroPct']; }
      closeModal(); Notifs.showToast('Profit factors saved'); window.renderProjectLifecycle&&window.renderProjectLifecycle();
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
}

async function advanceProjectStage(p, nextId){
  const who=userProfile?.displayName||currentUser.email;
  const ns=jobStage(nextId);
  try{
    await db.collection('job_projects').doc(p.id).update({
      stage:nextId, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
      timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Moved to '+ns.label, by:who })
    });
    // keep the client's public tracker in step with the internal lifecycle
    const _trkStage = { won:'confirmed', in_production:'production', qc:'qc', for_delivery:'ready', ready:'ready', delivered:'delivered', paid:'delivered' }[nextId];
    if(p.trackingToken && _trkStage) window.syncOrderTracking(p.trackingToken, { status:_trkStage });
    // hand off to the owning department of the new stage
    const dept=ns.dept;
    try{ if(dept&&dept!=='Sales') await Notifs.sendToDept(dept,{ title:`📈 ${ns.label}: ${p.clientName||p.projectNo}`, body:`Project ${p.projectNo} is now "${ns.label}". Your team's action is needed.`, icon:ns.icon, type:'project_stage', link:'projects-lifecycle' }, { fallbackToOwner:true }); }catch(_){}
    if(nextId==='delivered') { try{ await Notifs.sendToDept('Finance',{ title:'📦 Ready to bill balance', body:`${p.clientName} (${p.projectNo}) delivered — collect balance ₱${fmt(p.arBalance||0)}.`, icon:'💵', type:'project_stage', link:'projects-lifecycle' }); }catch(_){} }
    if(nextId==='paid') { try{ await Notifs.sendToOwner({ title:'💰 Project paid', body:`${p.clientName} (${p.projectNo}) fully collected.`, icon:'💰', type:'project_paid' }); }catch(_){} }
    window.logAudit && window.logAudit('update','project',p.id,{ stage:nextId });
    Notifs.showToast('Moved to '+ns.label); closeModal(); window.renderProjectLifecycle();
  }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
}

function openProjectBillingModal(p){
  const bal=p.arBalance||0;
  openPage('💵 Record Payment — '+(p.clientName||''), `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Contract ₱${fmt(p.contractAmount||0)} · Collected ₱${fmt(p.amountCollected||0)} · <strong>Balance ₱${fmt(bal)}</strong></div>
    <div class="form-row">
      <div class="form-group"><label>Payment Type</label><select id="pb-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"><option>Downpayment</option><option>Progress Billing</option><option>Final Balance</option></select></div>
      <div class="form-group"><label>Amount (₱)</label><input id="pb-amount" type="number" inputmode="decimal" step="0.01" value="${bal>0?bal:''}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>VAT treatment</label>
        <select id="pb-vat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="inclusive" selected>VAT-inclusive — 12% already in the amount</option>
          <option value="exclusive">VAT-exclusive — add 12% on top</option>
          <option value="exempt">VAT-exempt / Zero-rated — no VAT</option>
        </select></div>
      <div class="form-group"><label>Method</label><select id="pb-method" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"><option>Bank Transfer</option><option>GCash</option><option>Cash</option><option>Cheque</option></select></div>
    </div>
    <div class="card" style="margin:6px 0"><div class="card-body" style="padding:8px 14px;font-size:12px;display:grid;grid-template-columns:1fr auto;gap:2px 12px">
      <span style="color:var(--text-muted)">Recorded total</span><span id="pb-rec" style="text-align:right;font-weight:700;color:var(--success)">₱0.00</span>
      <span style="color:var(--text-muted)">Net of VAT</span><span id="pb-net" style="text-align:right">₱0.00</span>
      <span style="color:var(--text-muted)">Output VAT</span><span id="pb-vatamt" style="text-align:right">₱0.00</span>
    </div></div>
    <div class="form-group"><label>OR / Reference No.</label><input id="pb-ref" placeholder="Official Receipt no."/></div>
    <div class="form-group"><label>Receipt (proof)</label><div id="pb-receipt-upload"></div></div>
    <div id="pb-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="pb-save">Record + Post to Ledger</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  let receipt=null;
  if(window.Drive?.renderUploadArea) Drive.renderUploadArea('pb-receipt-upload',(r)=>{receipt=r;},{label:'Upload OR / proof',accept:'image/*,.pdf',dept:'Finance',subfolder:'Collections'});
  const pbRecompute=()=>{
    const { recorded, net, vat }=window.vatSplit(parseFloat(document.getElementById('pb-amount').value)||0, document.getElementById('pb-vat').value);
    document.getElementById('pb-rec').textContent='₱'+fmt(recorded);
    document.getElementById('pb-net').textContent='₱'+fmt(net);
    document.getElementById('pb-vatamt').textContent='₱'+fmt(vat);
  };
  document.getElementById('pb-amount').addEventListener('input',pbRecompute);
  document.getElementById('pb-vat').addEventListener('change',pbRecompute);
  pbRecompute();
  document.getElementById('pb-save').addEventListener('click', async ()=>{
    const err=document.getElementById('pb-err');
    const saveBtn=document.getElementById('pb-save');
    const entered=parseFloat(document.getElementById('pb-amount').value)||0;
    if(entered<=0){ err.textContent='Enter an amount.'; err.classList.remove('hidden'); return; }
    const vatTreatment=document.getElementById('pb-vat').value;
    const { recorded:amount, net, vat:vatAmount }=window.vatSplit(entered,vatTreatment);
    const newCollected=(p.amountCollected||0)+amount;
    const newAR=Math.max(0,(p.contractAmount||0)-newCollected);
    const who=userProfile?.displayName||currentUser.email;
    const type=document.getElementById('pb-type').value, method=document.getElementById('pb-method').value, orRef=document.getElementById('pb-ref').value.trim();
    saveBtn.disabled=true; // guard against double-click double-posting (payments are legitimately multiple)
    try{
      // 1) post income credit to the ledger (category 'Sales Revenue' so it feeds the Output-VAT base)
      // Deterministic ref (project id + payment index) so a retry/backfill can't duplicate it.
      const projLedgerRef=`PROJ-${p.id}-${(p.payments?.length||0)}`;
      const projDupe=await db.collection('ledger').where('refNumber','==',projLedgerRef).limit(1).get().catch(()=>({empty:true}));
      if(!projDupe.empty){ closeModal(); Notifs.showToast('This payment was already posted.','error'); window.renderProjectLifecycle(); return; }
      const led=await db.collection('ledger').add({ date:today(), description:`Project ${p.projectNo} — ${p.clientName} (${type})`, category:'Sales Revenue', accountType:'income', account:'Sales Revenue', type:'credit', amount, net, vatAmount, vatTreatment, refNumber:projLedgerRef, source:'Finance', projectId:p.id, addedBy:currentUser.uid, addedByName:who, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      if(typeof dbCacheInvalidate==='function') dbCacheInvalidate('ledger');
      // 2) update the project: payment, collected, AR, OR document, timeline
      const payment={ type, amount, vatAmount, net, method, orRef, receiptUrl:receipt?.url||null, date:today(), by:who, ledgerId:led.id };
      const update={ amountCollected:newCollected, arBalance:newAR, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
        payments:firebase.firestore.FieldValue.arrayUnion(payment),
        documents:firebase.firestore.FieldValue.arrayUnion({ type:'Official Receipt', ref:orRef||('₱'+amount.toLocaleString()), at:new Date().toISOString(), by:who }),
        timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:`Payment ₱${amount.toLocaleString()} (${type})`, by:who }) };
      if(newAR<=0) update.stage='paid';
      await db.collection('job_projects').doc(p.id).update(update);
      window.logAudit && window.logAudit('create','payment',p.id,{ amount, type, projectNo:p.projectNo });
      if(newAR<=0){ try{ await Notifs.sendToOwner({ title:'💰 Project fully paid', body:`${p.clientName} (${p.projectNo}) — ₱${(p.contractAmount||0).toLocaleString()} collected in full.`, icon:'💰', type:'project_paid' }); }catch(_){} }
      closeModal(); Notifs.showToast('Payment recorded + posted to ledger'); window.renderProjectLifecycle();
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); saveBtn.disabled=false; }
  });
}

// Finance issues a printable billing invoice against a job_projects record (the
// sales-record spine). Issuing an invoice only documents what's owed — it does NOT
// move money (that's "Record Payment"), so AR/Collected are untouched here.
function openJobBillingInvoiceModal(p){
  const contract = Number(p.contractAmount)||0;
  const paid     = Number(p.amountCollected)||0;
  const bal      = Math.max(0, contract - paid);
  openPage('🧾 Billing Invoice — '+escHtml(p.clientName||''), `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Contract ₱${fmt(contract)} · Collected ₱${fmt(paid)} · <strong>Balance ₱${fmt(bal)}</strong></div>
    <div class="form-group"><label>Bill To</label><input id="jinv-billto" value="${escHtml(p.clientName||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Invoice Date</label><input id="jinv-date" type="date" value="${today()}"/></div>
      <div class="form-group"><label>Due Date</label><input id="jinv-due" type="date"/></div>
    </div>
    <div class="form-group"><label>Particulars</label><input id="jinv-desc" value="Collection of outstanding balance"/></div>
    <div class="form-group"><label>Amount to Collect (₱)</label><input id="jinv-amt" type="number" inputmode="decimal" step="0.01" min="0" value="${bal>0?bal.toFixed(2):'0.00'}"/></div>
    <div class="form-group"><label>Notes / Payment Instructions</label><textarea id="jinv-notes" rows="3">Kindly settle the amount due on or before the due date. Payable to NEILBARRO STEEL & METAL FABRICATION SERVICES.</textarea></div>
    <div id="jinv-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="jinv-gen">Generate Invoice</button><button class="btn-secondary" id="jinv-back">Cancel</button>`);
  document.getElementById('jinv-back').addEventListener('click', ()=>openJobProjectDetail(p));
  document.getElementById('jinv-gen').addEventListener('click', async ()=>{
    const err=document.getElementById('jinv-err');
    const amt=parseFloat(document.getElementById('jinv-amt').value)||0;
    if(amt<=0){ err.textContent='Enter a valid amount.'; err.classList.remove('hidden'); return; }
    const seq=((p.invoices||[]).length+1);
    const who=userProfile?.displayName||currentUser.email||'';
    const inv={
      no:             'INV-'+today().replace(/-/g,'')+'-'+String(seq).padStart(3,'0'),
      date:           document.getElementById('jinv-date').value||today(),
      due:            document.getElementById('jinv-due').value||'',
      billTo:         document.getElementById('jinv-billto').value.trim(),
      desc:           document.getElementById('jinv-desc').value.trim(),
      amount:         amt,
      notes:          document.getElementById('jinv-notes').value.trim(),
      contractAmount: contract,
      paidToDate:     paid,
      balanceBefore:  bal,
      projectName:    p.name||p.projectNo||'',
      projectNo:      p.projectNo||'',
      issuedBy:       who,
      createdAt:      today()
    };
    if(!(await confirmDialog({message:`Generate billing invoice ${inv.no} for ₱${fmt(amt)} (${escHtml(p.clientName||'')})?`, html:true}))) return;
    try{
      // Atomic append so a concurrent edit can't clobber the invoice list.
      const ref=db.collection('job_projects').doc(p.id);
      const saved=await db.runTransaction(async tx=>{
        const doc=await tx.get(ref);
        const cur=(doc.exists && Array.isArray(doc.data().invoices))?doc.data().invoices:[];
        const next=[...cur, inv];
        tx.update(ref, {
          invoices:next,
          documents:firebase.firestore.FieldValue.arrayUnion({ type:'Billing Invoice', ref:inv.no, at:new Date().toISOString(), by:who }),
          timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:`Billing invoice ${inv.no} issued (₱${amt.toLocaleString()})`, by:who }),
          updatedAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        return next;
      });
      p.invoices=saved;
      window.logAudit && window.logAudit('create','invoice',p.id,{ no:inv.no, amount:amt, projectNo:p.projectNo });
      closeModal();
      Notifs.showToast('Billing invoice generated','success');
      window.openBillingInvoice(p, inv);
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
}

window.renderProductionDept = async function(currentUser, currentRole, subtab = 'Orders') {
  const c = deptContainer();
  const subs = ['Orders','Materials','Inventory','Count Form','Tasks','Files'];
  c.innerHTML = `
    <div class="page-header">
      <div>
        <h2>🏭 Production</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">Shop-floor work orders, materials & output</p>
      </div>
    </div>
    ${window.sopPanel('How Production works', [
      'Orders is the shop-floor pipeline: Queued → Cutting → Welding → Assembly → Finishing → QC → Ready → Delivered.',
      'Materials and Inventory track raw stock; "Consume → stock & COS" deducts inventory and posts material cost.',
      'Count Form records physical counts; Tasks and Files hold the department board and documents.'
    ])}
    ${window.chipTabs(subs.map(s=>({key:s,label:s})), subtab)}
    <div id="prod-content"><div class="loading-placeholder">Loading…</div></div>`;
  loadProdContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => loadProdContent(currentUser, currentRole, key));
};

function loadProdContent(currentUser, currentRole, sub) {
  const el = document.getElementById('prod-content');
  if (sub==='Materials') return renderProdMaterials(el, currentRole);
  if (sub==='Inventory') return window.renderInventory(el, 'Stock');
  if (sub==='Count Form') return renderProdInventoryForm(el, currentRole);
  if (sub==='Tasks')     return renderDeptTasks(el, 'Production', currentUser, currentRole);
  if (sub==='Files')   { el.innerHTML = renderFileCollection('Production Files', 'production-files', currentRole);
                         bindFileCollection('production-files', currentUser, 'Production', 'Files'); return; }
  return renderProdOrders(el, currentUser, currentRole);
}

async function renderProdOrders(el, currentUser, currentRole) {
  const canEdit = canEditDept('Production');
  el.innerHTML = '<div class="loading-placeholder">Loading orders…</div>';
  const [snap, projSnap] = await Promise.all([
    db.collection('production_orders').orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
    db.collection('job_projects').orderBy('createdAt','desc').get().catch(()=>({docs:[]}))
  ]);
  const orders = snap.docs.map(d=>({id:d.id,...d.data()}));
  // Incoming jobs = won / in-production projects that don't yet have a work order.
  // These are sales already handed to Production (via the Sales Order flow) but
  // never turned into a shop-floor order — they previously lived ONLY in the
  // Projects lifecycle, so the Production team never saw them here and reported
  // "not receiving orders". Surface them so they can start a work order in one tap.
  const incoming = projSnap.docs.map(d=>({id:d.id,...d.data()}))
    .filter(p=>['won','in_production'].includes(p.stage) && !(Array.isArray(p.productionOrderIds) && p.productionOrderIds.length));
  const active = orders.filter(o=>o.stage!=='delivered');
  const todayStr = today();
  const weekAhead = (()=>{ const d=new Date(); d.setDate(d.getDate()+7); return (window.bizDate?window.bizDate(d):d.toISOString().slice(0,10)); })();
  const overdue = active.filter(o=>o.dueDate && o.dueDate < todayStr);
  const dueSoon = active.filter(o=>o.dueDate && o.dueDate >= todayStr && o.dueDate <= weekAhead);

  // Group active orders by stage (in pipeline order), delivered shown collapsed at end
  const byStage = {};
  active.forEach(o=>{ (byStage[o.stage||'queued'] ||= []).push(o); });
  const delivered = orders.filter(o=>o.stage==='delivered');

  const orderCard = (o)=>{
    const od = o.dueDate && o.dueDate < todayStr && o.stage!=='delivered';
    const pr = (o.priority||'medium');
    return `<div class="item-card prod-order" data-id="${o.id}" style="cursor:pointer;border-left:3px solid ${prodStage(o.stage).color}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">${escHtml(o.title||'Untitled')} ${o.qty?`<span style="color:var(--text-muted);font-weight:500">×${escHtml(String(o.qty))}</span>`:''}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            ${o.orderNo?`<span style="font-family:monospace">${escHtml(o.orderNo)}</span> · `:''}${escHtml(o.client||'—')}${o.quoteRef?` · ${escHtml(o.quoteRef)}`:''}
          </div>
          <div style="font-size:11px;margin-top:3px;display:flex;gap:8px;flex-wrap:wrap">
            ${o.dueDate?`<span style="color:${od?'var(--danger)':'var(--text-muted)'}">📅 ${escHtml(o.dueDate)}${od?' ⚠️':''}</span>`:''}
            ${o.team?`<span style="color:var(--text-muted)">👷 ${escHtml(o.team)}</span>`:''}
            <span class="badge ${pr==='high'||pr==='urgent'?'badge-red':pr==='low'?'badge-green':'badge-orange'}" style="font-size:9px">${pr}</span>
          </div>
        </div>
        ${canEdit?`<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          ${o.stage!=='delivered'?`<button class="btn-success btn-sm prod-advance" data-id="${o.id}">Advance →</button>`:''}
          <button class="btn-secondary btn-sm prod-edit" data-id="${o.id}">Edit</button>
        </div>`:''}
      </div>
    </div>`;
  };

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card" style="${incoming.length?'border-color:var(--warning)':''}"><div class="kpi-label">Incoming</div><div class="kpi-value" style="${incoming.length?'color:var(--warning)':''}">${incoming.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Active Orders</div><div class="kpi-value">${active.length}</div></div>
      <div class="kpi-card ${dueSoon.length?'':''}" style="${dueSoon.length?'border-color:var(--warning)':''}"><div class="kpi-label">Due ≤7 days</div><div class="kpi-value" style="${dueSoon.length?'color:var(--warning)':''}">${dueSoon.length}</div></div>
      <div class="kpi-card ${overdue.length?'red':''}"><div class="kpi-label">Overdue</div><div class="kpi-value">${overdue.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Delivered</div><div class="kpi-value">${delivered.length}</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span style="font-size:12px;color:var(--text-muted);flex:1;min-width:180px">Pipeline: Queued → Cutting → Fab → Assembly → Finishing → QC → Ready → Delivered</span>
      <button class="btn-secondary btn-sm" id="prod-csv" style="flex-shrink:0;white-space:nowrap">⬇ CSV</button>
      ${canEdit?'<button class="btn-primary btn-sm" id="prod-add-btn" style="flex-shrink:0;white-space:nowrap">＋ New Order</button>':''}
    </div>
    ${incoming.length?`
      <div class="card" style="margin-bottom:12px;border:1.5px solid var(--warning)">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
          <h3 style="font-size:13px">📥 Incoming jobs — needs a work order</h3>
          <span class="badge badge-orange">${incoming.length}</span>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
          ${incoming.map(p=>`<div class="item-card" style="border-left:3px solid var(--warning)">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:13px">${escHtml(p.clientName||p.name||'Project')}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px"><span style="font-family:monospace">${escHtml(p.projectNo||'')}</span>${p.quoteNumber?` · ${escHtml(p.quoteNumber)}`:''} · <span class="badge ${p.stage==='in_production'?'badge-blue':'badge-green'}" style="font-size:9px">${escHtml(jobStage(p.stage).label)}</span></div>
                <div style="font-size:11px;margin-top:3px;color:var(--text-muted)">Contract ₱${fmt(p.contractAmount||0)}</div>
              </div>
              ${canEdit?`<button class="btn-primary btn-sm prod-start" data-id="${p.id}" style="flex-shrink:0;white-space:nowrap">＋ Start work order</button>`:''}
            </div>
          </div>`).join('')}
        </div>
      </div>`:''}
    ${!active.length && !delivered.length && !incoming.length ? '<div class="empty-state" style="padding:30px"><div class="empty-icon">🏭</div><h4>No production orders yet</h4><p>Create a work order to track a job through the shop floor.</p></div>' : ''}
    ${PROD_STAGES.filter(s=>s.id!=='delivered' && (byStage[s.id]||[]).length).map(s=>`
      <div class="card" style="margin-bottom:12px">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
          <h3 style="font-size:13px">${s.icon} ${s.label}</h3>
          <span class="badge" style="background:${s.color};color:#fff">${(byStage[s.id]||[]).length}</span>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
          ${(byStage[s.id]||[]).map(orderCard).join('')}
        </div>
      </div>`).join('')}
    ${delivered.length?`
      <details style="margin-top:6px">
        <summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--text-muted);padding:6px 0">🚚 Delivered (${delivered.length})</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${delivered.slice(0,30).map(orderCard).join('')}</div>
      </details>`:''}
  `;

  document.getElementById('prod-csv')?.addEventListener('click', ()=>window.exportCSV('production-orders', orders, [
    {key:'orderNo',label:'Order #'},{key:'title',label:'Product'},{key:'client',label:'Client'},{key:'qty',label:'Qty'},
    {key:'stage',label:'Stage',get:o=>prodStage(o.stage).label},{key:'priority',label:'Priority'},{key:'team',label:'Team'},{key:'dueDate',label:'Due'},{key:'quoteRef',label:'Quote Ref'}]));
  if (canEdit) {
    document.getElementById('prod-add-btn')?.addEventListener('click', ()=>prodOrderModal(null, currentUser, currentRole, ()=>renderProdOrders(el, currentUser, currentRole)));
    el.querySelectorAll('.prod-start').forEach(b=>b.addEventListener('click', (e)=>{
      e.stopPropagation();
      prodOrderModal(null, currentUser, currentRole, ()=>renderProdOrders(el, currentUser, currentRole), b.dataset.id);
    }));
    el.querySelectorAll('.prod-edit').forEach(b=>b.addEventListener('click', (e)=>{
      e.stopPropagation();
      prodOrderModal(orders.find(o=>o.id===b.dataset.id), currentUser, currentRole, ()=>renderProdOrders(el, currentUser, currentRole));
    }));
    el.querySelectorAll('.prod-advance').forEach(b=>b.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const o = orders.find(x=>x.id===b.dataset.id); if(!o) return;
      const idx = PROD_STAGES.findIndex(s=>s.id===(o.stage||'queued'));
      const next = PROD_STAGES[Math.min(idx+1, PROD_STAGES.length-1)];
      b.disabled = true;
      try {
        await db.collection('production_orders').doc(o.id).update({
          stage: next.id, stageUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        // Keep the parent project's lifecycle stage in sync with production progress —
        // but only move it FORWARD. Never regress a job that's already further along
        // (e.g. delivered/paid) just because an early production sub-stage advanced.
        if (o.projectId) {
          const projStage = next.id==='delivered' ? 'delivered' : next.id==='ready' ? 'for_delivery' : 'in_production';
          try {
            const jdoc = await db.collection('job_projects').doc(o.projectId).get();
            const cur = jdoc.exists ? jdoc.data().stage : null;
            const ord = s => JOB_STAGES.findIndex(x => x.id === s);
            const evt = { at:new Date().toISOString(), event:`Production: ${next.label}`, by:userProfile?.displayName||currentUser.email };
            const advance = cur !== 'paid' && cur !== 'cancelled' && ord(projStage) > ord(cur);
            await db.collection('job_projects').doc(o.projectId).update({
              ...(advance ? { stage: projStage } : {}),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              timeline: firebase.firestore.FieldValue.arrayUnion(evt) });
            // reflect the milestone on the client's public tracker (forward only)
            const _tok = jdoc.exists ? jdoc.data().trackingToken : null;
            if(_tok){ const _trk = ({qc:'qc',ready:'ready',delivered:'delivered'})[next.id] || (advance ? 'production' : null);
              if(_trk) window.syncOrderTracking(_tok, { status:_trk }); }
          } catch(_) {}
        }
        Notifs.showToast(`Moved to ${next.label}`);
        renderProdOrders(el, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Update failed','error'); b.disabled=false; }
    }));
  }
  el.querySelectorAll('.prod-order').forEach(card=>card.addEventListener('click', ()=>{
    if(!canEdit) return;
    prodOrderModal(orders.find(o=>o.id===card.dataset.id), currentUser, currentRole, ()=>renderProdOrders(el, currentUser, currentRole));
  }));
}

// Consume a production order's materials: decrement inventory stock, post COS to
// the ledger (idempotent, keyed POCOS-<id>), add the cost to the linked job's
// capital (for margin), and flag the order. Stock + flag commit atomically.
async function consumeProductionMaterials(order) {
  const mats = (order.materials || []).filter(m => m.itemId && (Number(m.qty) || 0) > 0);
  if (!mats.length) return { ok: false, reason: 'No materials listed.' };
  if (order.materialsConsumed) return { ok: false, reason: 'Already consumed.' };
  // Resolve current unit costs from inventory
  const snaps = await Promise.all(mats.map(m => db.collection('inventory_items').doc(m.itemId).get().catch(() => null)));
  let cos = 0;
  const batch = db.batch();
  mats.forEach((m, i) => {
    const s = snaps[i];
    const unitCost = (s && s.exists) ? (Number(s.data().unitCost) || 0) : (Number(m.unitCost) || 0);
    cos += unitCost * (Number(m.qty) || 0);
    if (s && s.exists) batch.update(db.collection('inventory_items').doc(m.itemId), { qty: firebase.firestore.FieldValue.increment(-(Number(m.qty) || 0)) });
  });
  batch.update(db.collection('production_orders').doc(order.id), {
    materialsConsumed: true,
    materialsConsumedAt: firebase.firestore.FieldValue.serverTimestamp(),
    materialsCost: cos
  });
  await batch.commit(); // stock + flag atomic — can't double-decrement
  // Post COS to the ledger, idempotent by ref. Best-effort: the ledger is
  // finance-write-gated, so a plain Production employee can't post it — stock is
  // still deducted and materialsCost is recorded on the order for finance to see.
  // Also posts the Inventory contra leg (v12 WS13) — the asset decrease that
  // nets against the asset booked at purchase time, fixing the double-counted
  // material expense (purchase debit + consumption debit, no netting).
  const ref = `POCOS-${order.id}`;
  const refInv = `POCOS-${order.id}-INV`;
  let cosPosted = false;
  if (cos > 0) {
    try {
      const existing = await db.collection('ledger').where('refNumber', '==', ref).limit(1).get().catch(() => ({ docs: [] }));
      if (!existing.docs.length) {
        await db.collection('ledger').add({
          date: today(), type: 'debit',
          accountType: 'expense', account: 'COS – Direct Material',
          description: `COS — ${order.title || order.orderNo || ''}${order.client ? ` (${order.client})` : ''}`,
          category: 'COS – Direct Material', amount: cos, refNumber: ref, source: 'Production',
          projectId: order.projectId || null,
          addedByName: window.userProfile?.displayName || window.currentUser?.email || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      // Contra leg — its own idempotency check; skip (don't risk a duplicate) if
      // the read fails rather than the write.
      const existingInv = await db.collection('ledger').where('refNumber', '==', refInv).limit(1).get().catch(() => null);
      if (existingInv && !existingInv.docs.length) {
        await db.collection('ledger').add({
          date: today(), type: 'credit',
          accountType: 'asset', account: 'Inventory', category: 'Inventory – Materials',
          description: `Inventory consumed — ${order.orderNo || order.id}`,
          amount: cos, refNumber: refInv, source: 'Production',
          projectId: order.projectId || null,
          addedByName: window.userProfile?.displayName || window.currentUser?.email || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      cosPosted = true;
    } catch (ledErr) { console.warn('[production COS] ledger post skipped (needs finance rights):', ledErr?.message || ledErr); }
  }
  // Roll the material cost into the linked job's capital so margin reflects it
  if (order.projectId && cos > 0) await db.collection('job_projects').doc(order.projectId)
    .update({ capital: firebase.firestore.FieldValue.increment(cos) }).catch(() => {});
  if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('ledger'); dbCacheInvalidate('inventory_items'); dbCacheInvalidate('projects-unified'); }
  return { ok: true, cos, count: mats.length, cosPosted };
}

async function prodOrderModal(order, currentUser, currentRole, onSaved, prefillProjectId) {
  const e = order || {};
  // Load active projects so this work order can be linked to a job (the spine)
  let projs = [];
  let projOpts = '<option value="">— None —</option>';
  try {
    // Dropdown population only (the actual stock deduction on consume uses atomic
    // increment()), so a short cache is safe and saves a full read per modal open.
    const psnap = await dbCachedGet('job_projects', ()=>db.collection('job_projects').get(), 30000);
    projs = psnap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>!['paid','cancelled'].includes(p.stage)).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const selP = e.projectId || prefillProjectId || '';
    projOpts += projs.map(p=>`<option value="${p.id}" data-client="${escHtml(p.clientName||'')}" ${selP===p.id?'selected':''}>${escHtml(p.projectNo||'')} — ${escHtml(p.clientName||p.name||'')}</option>`).join('');
  } catch(_) {}
  // Load raw materials for the consumption picker
  let invItems = [];
  try {
    const isnap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
    invItems = isnap.docs.map(d=>({id:d.id,...d.data()})).filter(i=>(i.kind||'material')==='material').sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  } catch(_) {}
  const matItemOpts = (sel='') => '<option value="">— Select material —</option>' + invItems.map(i=>`<option value="${i.id}" data-name="${escHtml(i.name||'')}" data-cost="${Number(i.unitCost)||0}" ${sel===i.id?'selected':''}>${escHtml(i.name||'')} (${Number(i.qty||0).toLocaleString('en-PH')} ${escHtml(i.unit||'')} @ ₱${fmt(i.unitCost||0)})</option>`).join('');
  // Starting a work order from an incoming job: prefill client + quote from the project.
  const pf = (!order && prefillProjectId) ? projs.find(p=>p.id===prefillProjectId) : null;
  const dfClient = e.client || pf?.clientName || '';
  const dfQuote  = e.quoteRef || pf?.quoteNumber || '';
  openPage(order ? `Edit Order ${e.orderNo||''}` : '🏭 New Production Order', `
    <div class="form-group"><label>Linked Project (job)</label>
      <select id="po-project" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${projOpts}</select>
    </div>
    <div class="form-group"><label>Product / Work Description</label><input id="po-title" value="${escHtml(e.title||'')}" placeholder="e.g. SS Baker's Worktable 1500mm ×4"/></div>
    <div class="form-row">
      <div class="form-group"><label>Client / Project</label><input id="po-client" value="${escHtml(dfClient)}" placeholder="e.g. Gerry's Grill — Bulacan"/></div>
      <div class="form-group" style="flex:0 0 90px"><label>Qty</label><input id="po-qty" type="number" min="1" value="${e.qty||1}" inputmode="numeric"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Linked Quote (optional)</label><input id="po-quote" value="${escHtml(dfQuote)}" placeholder="BK-LU-FB-…"/></div>
      <div class="form-group"><label>Assigned Team</label><input id="po-team" value="${escHtml(e.team||'')}" placeholder="e.g. Fab Team A"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Stage</label>
        <select id="po-stage" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          ${PROD_STAGES.map(s=>`<option value="${s.id}" ${ (e.stage||'queued')===s.id?'selected':''}>${s.icon} ${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Priority</label>
        <select id="po-priority" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          ${['low','medium','high','urgent'].map(p=>`<option value="${p}" ${(e.priority||'medium')===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Target Date</label><input id="po-due" type="date" value="${e.dueDate||''}"/></div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="po-notes" rows="2" placeholder="Special instructions, etc.">${escHtml(e.notes||'')}</textarea></div>
    <label style="font-size:12px;font-weight:700;display:block;margin:8px 0 4px">Materials consumed ${e.materialsConsumed?'<span style="color:var(--success);font-weight:600">· ✓ consumed</span>':'(optional)'}</label>
    <div id="po-mats"></div>
    ${e.materialsConsumed
      ? `<div style="font-size:11px;color:var(--success);margin-top:6px">✓ Stock deducted · COS ₱${fmt(e.materialsCost||0)} posted to ledger.</div>`
      : `<button class="btn-secondary btn-sm" id="po-add-mat" type="button" style="margin-top:6px">+ Add material</button>
         ${order?`<button class="btn-primary btn-sm" id="po-consume" type="button" style="margin-top:6px;margin-left:6px">📦 Consume → stock & COS</button>`:'<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Save the order first, then reopen to consume materials.</div>'}`}
    <div id="po-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="po-save">Save</button>${order?'<button class="btn-danger" id="po-del">Delete</button>':''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  // Materials editor (dynamic rows)
  const matsWrap = document.getElementById('po-mats');
  const consumed = !!e.materialsConsumed;
  const addMatRow = (itemId='', qty='') => {
    if (!matsWrap) return;
    const row = document.createElement('div');
    row.className = 'po-mat-row';
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
    row.innerHTML = `
      <select class="pm-item" ${consumed?'disabled':''} style="flex:1;min-width:0;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">${matItemOpts(itemId)}</select>
      <input class="pm-qty" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Qty" value="${qty}" ${consumed?'disabled':''} style="flex:0 0 70px;width:70px"/>
      ${consumed?'':'<button class="btn-danger btn-sm pm-del" type="button">✕</button>'}`;
    row.querySelector('.pm-del')?.addEventListener('click', ()=>row.remove());
    matsWrap.appendChild(row);
  };
  (e.materials||[]).forEach(m=>addMatRow(m.itemId, m.qty));
  if (!consumed && !(e.materials||[]).length) addMatRow();
  document.getElementById('po-add-mat')?.addEventListener('click', ()=>addMatRow());

  const collectMaterials = () => [...matsWrap.querySelectorAll('.po-mat-row')].map(r=>{
    const sel = r.querySelector('.pm-item'); const opt = sel.options[sel.selectedIndex];
    return { itemId: sel.value, name: opt?.dataset.name||'', unitCost: parseFloat(opt?.dataset.cost||0)||0, qty: parseFloat(r.querySelector('.pm-qty').value)||0 };
  }).filter(m=>m.itemId && m.qty>0);

  document.getElementById('po-consume')?.addEventListener('click', async ()=>{
    const materials = collectMaterials();
    if (!materials.length) { Notifs.showToast('Add at least one material with a quantity.','error'); return; }
    if (!(await confirmDialog({message:`Consume these materials? This deducts stock and posts COS to the ledger (one-time).`, danger:true}))) return;
    const btn = document.getElementById('po-consume'); btn.disabled = true;
    try {
      await db.collection('production_orders').doc(order.id).update({ materials });
      const res = await consumeProductionMaterials({ ...e, id: order.id, materials });
      if (res.ok) Notifs.showToast(res.cosPosted
        ? `Consumed ${res.count} material${res.count>1?'s':''} · COS ₱${fmt(res.cos)} posted to ledger.`
        : `Stock deducted (COS ₱${fmt(res.cos)} recorded; ask Finance to post it to the ledger).`);
      else Notifs.showToast(res.reason||'Nothing to consume.','error');
      closeModal(); onSaved && onSaved();
    } catch(ex){ Notifs.showToast('Consume failed: '+(ex.message||ex),'error'); btn.disabled=false; }
  });

  document.getElementById('po-save').addEventListener('click', async ()=>{
    const title = document.getElementById('po-title').value.trim();
    const err = document.getElementById('po-err');
    if(!title){ err.textContent='Product / work description is required.'; err.classList.remove('hidden'); return; }
    const projSel = document.getElementById('po-project');
    const projectId = projSel?.value || '';
    const data = {
      title, client: document.getElementById('po-client').value.trim(),
      qty: parseInt(document.getElementById('po-qty').value)||1,
      quoteRef: document.getElementById('po-quote').value.trim(),
      projectId: projectId || null,
      team: document.getElementById('po-team').value.trim(),
      stage: document.getElementById('po-stage').value,
      priority: document.getElementById('po-priority').value,
      dueDate: document.getElementById('po-due').value,
      notes: document.getElementById('po-notes').value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (!e.materialsConsumed) data.materials = collectMaterials(); // lock once consumed
    try {
      if(order){ await db.collection('production_orders').doc(order.id).update(data); window.logAudit&&window.logAudit('update','production_order',order.id,{title:data.title,stage:data.stage}); }
      else {
        // order number PO-YYMM-### (best-effort sequential; falls back to time suffix)
        let seq = '001';
        try { const cnt = (await db.collection('production_orders').get()).size; seq = String(cnt+1).padStart(3,'0'); }
        catch(_) { seq = String(Date.now()).slice(-3); }
        const ym = (window.bizDate?window.bizDate():new Date().toISOString().slice(0,10)).slice(2,7).replace('-','');
        data.orderNo = `PO-${ym}-${seq}`;
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        data.createdBy = currentUser.uid;
        data.createdByName = userProfile?.displayName || currentUser.email || '';
        const _po = await db.collection('production_orders').add(data);
        window.logAudit&&window.logAudit('create','production_order',data.orderNo,{title:data.title,client:data.client||''});
        // Link back to the project: register the order, move it into production, add to the doc register
        if (projectId) { try { await db.collection('job_projects').doc(projectId).update({
          stage:'in_production', updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
          productionOrderIds:firebase.firestore.FieldValue.arrayUnion(_po.id),
          documents:firebase.firestore.FieldValue.arrayUnion({ type:'Job Order', ref:data.orderNo, at:new Date().toISOString(), by:data.createdByName }),
          timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Production order '+data.orderNo+' created', by:data.createdByName }) }); } catch(_) {}
        }
      }
      closeModal(); Notifs.showToast('Order saved'); onSaved && onSaved();
    } catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
  document.getElementById('po-del')?.addEventListener('click', async ()=>{
    if(!(await confirmDialog({message:'Delete this production order?', danger:true}))) return;
    try { await db.collection('production_orders').doc(order.id).delete(); window.logAudit&&window.logAudit('delete','production_order',order.id,{orderNo:order.orderNo||''}); closeModal(); Notifs.showToast('Deleted'); onSaved && onSaved(); }
    catch(ex){ Notifs.showToast('Delete failed (admin only)','error'); }
  });
}

// ── Inventory Count Form — editable, printable physical stock-take sheet ──
// Pre-fills one row per inventory_items doc (with its system on-hand qty) and
// lets the team key the physical count → live variance + remarks on screen,
// then print a clean A4 form (filled, or blank to count by hand). Entries
// autosave to localStorage so a long count survives a refresh or subtab switch.
// No Firestore writes — this is a working/print document, not a stock mutation.
const PROD_COUNT_DRAFT_KEY = 'bi-prod-count-draft';
function loadCountDraft(){ try { return JSON.parse(localStorage.getItem(PROD_COUNT_DRAFT_KEY) || '{}') || {}; } catch(e){ return {}; } }
function saveCountDraft(d){ try { localStorage.setItem(PROD_COUNT_DRAFT_KEY, JSON.stringify(d)); } catch(e){} }

async function renderProdInventoryForm(el, currentRole, kindFilter='all'){
  el.innerHTML = '<div class="loading-placeholder">Loading items…</div>';
  const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
  const items = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const shown = items.filter(i=> kindFilter==='all' || (i.kind||'material')===kindFilter);

  const draft  = loadCountDraft();
  draft.header = draft.header || {};
  draft.counts = draft.counts || {};
  draft.extras = Array.isArray(draft.extras) ? draft.extras : [];
  const h = draft.header, counts = draft.counts;
  const todayStr = (window.bizDate ? window.bizDate() : today());
  if (!h.formNo)        h.formNo = 'IC-' + todayStr.replace(/-/g,'');
  if (h.date == null)   h.date = todayStr;
  if (h.countedBy==null)h.countedBy = (typeof userProfile!=='undefined' && userProfile?.displayName) || currentUser?.email || '';
  saveCountDraft(draft);

  const varOf = (sys, phys) => (phys==='' || phys==null || isNaN(parseFloat(phys))) ? null : (parseFloat(phys) - Number(sys||0));
  const varHtml = v => v==null ? '<span style="color:var(--text-muted)">—</span>'
    : `<span style="font-weight:700;color:${v===0?'var(--success)':v<0?'var(--danger)':'var(--warning)'}">${v>0?'+':''}${Number(v).toLocaleString('en-PH')}</span>`;
  const counted = shown.filter(i=>{ const c=counts[i.id]; return c && c.physical!=='' && c.physical!=null; }).length;
  const withVar = shown.filter(i=>{ const c=counts[i.id]; const v=c?varOf(i.qty,c.physical):null; return v!=null && v!==0; }).length;

  const inEl = (cls,id,val,ph='',type='text') =>
    `<input class="${cls}" data-id="${id}" type="${type}" ${type==='number'?'inputmode="decimal" step="any"':''} value="${escHtml(val==null?'':val)}" placeholder="${ph}" style="width:100%;padding:5px 7px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--surface);color:var(--text)"/>`;

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Items</div><div class="kpi-value">${shown.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Counted</div><div class="kpi-value">${counted}</div></div>
      <div class="kpi-card ${withVar?'red':''}"><div class="kpi-label">With Variance</div><div class="kpi-value">${withVar}</div></div>
    </div>

    <div class="card" style="margin-bottom:12px"><div class="card-body">
      <div class="form-row">
        <div class="form-group"><label>Form No.</label><input id="cf-formno" value="${escHtml(h.formNo)}"/></div>
        <div class="form-group"><label>Count Date</label><input id="cf-date" type="date" value="${escHtml(h.date||'')}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Warehouse / Location</label><input id="cf-loc" value="${escHtml(h.location||'')}" placeholder="e.g. Main Warehouse — Bulacan"/></div>
        <div class="form-group"><label>Counted By</label><input id="cf-by" value="${escHtml(h.countedBy||'')}"/></div>
      </div>
      <div class="form-group"><label>Verified By</label><input id="cf-verified" value="${escHtml(h.verifiedBy||'')}" placeholder="Supervisor / checker"/></div>
    </div></div>

    <div class="subtab-bar" style="margin-bottom:10px;flex-wrap:wrap;gap:6px">
      ${[['all','All'],['material','Raw Materials'],['product','Finished Goods']].map(([k,l])=>`<button class="subtab-btn cf-kind-chip ${kindFilter===k?'active':''}" data-kind="${k}">${l}</button>`).join('')}
      <button class="btn-secondary btn-sm" id="cf-clear" style="margin-left:auto">↺ Clear</button>
      <button class="btn-secondary btn-sm" id="cf-addrow">＋ Blank row</button>
      <button class="btn-primary btn-sm" id="cf-print">🖨 Print / PDF</button>
    </div>

    <div class="card"><div class="card-body" style="padding:0">
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th style="width:32px">#</th><th>Item</th><th>Unit</th>
          <th style="text-align:right">System Qty</th><th style="width:120px">Physical Count</th>
          <th style="text-align:right;width:90px">Variance</th><th style="width:24%">Remarks</th>
        </tr></thead>
        <tbody>
          ${!shown.length && !draft.extras.length ? `<tr><td colspan="7"><div class="empty-state" style="padding:24px"><div class="empty-icon">📦</div><h4>No items in inventory</h4><p>Add items in the Inventory module, or use “＋ Blank row” for a write-in sheet.</p></div></td></tr>` :
          shown.map((i,idx)=>{
            const c = counts[i.id] || {};
            return `<tr>
              <td style="color:var(--text-muted)">${idx+1}</td>
              <td style="font-weight:600">${escHtml(i.name||'—')}${i.category?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(i.category)}</div>`:''}</td>
              <td style="font-size:12px">${escHtml(i.unit||'')}</td>
              <td style="text-align:right;font-weight:600">${Number(i.qty||0).toLocaleString('en-PH')}</td>
              <td>${inEl('cf-pc',i.id,c.physical,'',  'number')}</td>
              <td style="text-align:right"><span class="cf-var" data-id="${i.id}">${varHtml(varOf(i.qty,c.physical))}</span></td>
              <td>${inEl('cf-rm',i.id,c.remarks||'','note')}</td>
            </tr>`;
          }).join('')}
          ${draft.extras.map((r,ei)=>`<tr>
              <td style="color:var(--text-muted)">${shown.length+ei+1}</td>
              <td>${inEl('cf-ex-name',ei,r.name||'','Item name')}</td>
              <td>${inEl('cf-ex-unit',ei,r.unit||'','unit')}</td>
              <td style="text-align:right;color:var(--text-muted)">—</td>
              <td>${inEl('cf-ex-pc',ei,r.physical||'','','number')}</td>
              <td style="text-align:right;color:var(--text-muted)">—</td>
              <td>${inEl('cf-ex-rm',ei,r.remarks||'','note')}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </div></div>
    <p style="font-size:11px;color:var(--text-muted);margin-top:8px">Entries autosave on this device. “Print / PDF” opens a clean A4 form with whatever you’ve entered — print it blank to count by hand, or fill it in first.</p>`;

  const persist = () => saveCountDraft(draft);
  const hb = (id,key)=>{ const n=document.getElementById(id); n && n.addEventListener('input',()=>{ draft.header[key]=n.value; persist(); }); };
  hb('cf-formno','formNo'); hb('cf-date','date'); hb('cf-loc','location'); hb('cf-by','countedBy'); hb('cf-verified','verifiedBy');

  el.querySelectorAll('.cf-pc').forEach(n=>n.addEventListener('input',()=>{
    const id=n.dataset.id; (draft.counts[id] ||= {}).physical = n.value; persist();
    const item = shown.find(x=>x.id===id), cell = el.querySelector(`.cf-var[data-id="${id}"]`);
    if (cell && item) cell.innerHTML = varHtml(varOf(item.qty, n.value));
  }));
  el.querySelectorAll('.cf-rm').forEach(n=>n.addEventListener('input',()=>{ (draft.counts[n.dataset.id] ||= {}).remarks = n.value; persist(); }));

  const exBind=(cls,key)=>el.querySelectorAll(cls).forEach(n=>n.addEventListener('input',()=>{ (draft.extras[n.dataset.id] ||= {})[key]=n.value; persist(); }));
  exBind('.cf-ex-name','name'); exBind('.cf-ex-unit','unit'); exBind('.cf-ex-pc','physical'); exBind('.cf-ex-rm','remarks');

  el.querySelectorAll('.cf-kind-chip').forEach(b=>b.addEventListener('click',()=>renderProdInventoryForm(el,currentRole,b.dataset.kind)));
  document.getElementById('cf-addrow')?.addEventListener('click',()=>{ draft.extras.push({}); persist(); renderProdInventoryForm(el,currentRole,kindFilter); });
  document.getElementById('cf-clear')?.addEventListener('click', async ()=>{
    if(!(await confirmDialog({message:'Clear all counts, remarks and header fields on this form?', danger:true}))) return;
    localStorage.removeItem(PROD_COUNT_DRAFT_KEY); Notifs.showToast('Form cleared'); renderProdInventoryForm(el,currentRole,kindFilter);
  });
  document.getElementById('cf-print')?.addEventListener('click',()=>openInventoryCountForm(shown, loadCountDraft(), kindFilter));
}

// Open the filled (or blank) inventory count form in a clean, printable window.
function openInventoryCountForm(items, draft, kindFilter){
  const h = draft.header||{}, counts = draft.counts||{}, extras = Array.isArray(draft.extras)?draft.extras:[];
  const e = s => escHtml(s);
  const num = n => Number(n||0).toLocaleString('en-PH');
  const fmtDate = s => { if(!s) return ''; const dt=new Date(s+'T00:00:00'); return isNaN(dt.getTime())?s:dt.toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}); };
  const kindLabel = kindFilter==='material'?'Raw Materials':kindFilter==='product'?'Finished Goods':'All Items';
  const varCell = (sys,phys)=>{ if(phys===''||phys==null||isNaN(parseFloat(phys))) return ''; const v=parseFloat(phys)-Number(sys||0); return (v>0?'+':'')+num(v); };
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'INVENTORY COUNT FORM',
    docNumber: h.formNo || '',
    dateLabel: 'Count Date: ' + fmtDate(h.date),
    extraMeta: [kindLabel],
    signatures: [
      { label: 'Counted by',  name: h.countedBy || '', title: '' },
      { label: 'Verified by', name: h.verifiedBy || '', title: '' },
      { label: 'Approved by', name: '', title: '' }
    ],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH') + ' · Physical count supersedes system quantity upon approval.'
  }) : null;

  const rows = items.map((i,idx)=>{ const c=counts[i.id]||{}; return `<tr>
      <td class="c">${idx+1}</td>
      <td>${e(i.name||'')}${i.category?`<div class="sub">${e(i.category)}</div>`:''}</td>
      <td class="c">${e(i.unit||'')}</td>
      <td class="r">${num(i.qty||0)}</td>
      <td class="r b">${c.physical!=null&&c.physical!==''?num(c.physical):''}</td>
      <td class="r">${varCell(i.qty,c.physical)}</td>
      <td>${e(c.remarks||'')}</td></tr>`; }).join('');
  const extraRows = extras.map((r,ei)=>`<tr>
      <td class="c">${items.length+ei+1}</td>
      <td>${e(r.name||'')}</td>
      <td class="c">${e(r.unit||'')}</td>
      <td class="r">—</td>
      <td class="r b">${r.physical!=null&&r.physical!==''?num(r.physical):''}</td>
      <td class="r"></td>
      <td>${e(r.remarks||'')}</td></tr>`).join('');
  const filled = items.length + extras.length;
  const pad = filled < 12 ? 12 - filled : 2;
  let blanks=''; for(let k=0;k<pad;k++) blanks += `<tr class="blank"><td class="c">${filled+k+1}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Inventory Count Form — ${e(h.formNo||'')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;background:#e8e8e8}
  .page{width:297mm;min-height:210mm;margin:0 auto;background:#fff;padding:12mm}
  .htop{display:flex;align-items:center;gap:12px;border-bottom:3px solid #1a237e;padding-bottom:10px;margin-bottom:10px}
  .logo{width:58px;height:58px;object-fit:contain;flex-shrink:0}
  .cname{font-size:22px;font-weight:900;letter-spacing:.5px;color:#1a237e}
  .csub{font-size:10px;color:#555;margin-top:2px}
  .title{margin-left:auto;text-align:right}
  .title .t{display:inline-block;background:#1a237e;color:#fff;font-size:13px;font-weight:800;letter-spacing:1px;padding:5px 12px;border-radius:4px;text-transform:uppercase}
  .title .scope{font-size:10px;color:#666;margin-top:5px}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
  .mbox{border:1px solid #999;border-radius:5px;padding:6px 9px}
  .mbox .l{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700}
  .mbox .v{font-size:12px;font-weight:700;margin-top:2px;min-height:15px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #444;padding:5px 7px;font-size:11px;vertical-align:top}
  th{background:#1a237e;color:#fff;font-size:9px;text-transform:uppercase;letter-spacing:.04em}
  td.c{text-align:center}td.r{text-align:right}td.b{font-weight:700}
  td .sub{font-size:9px;color:#777}
  tr.blank td{height:22px}
  .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:34px}
  .sline{border-top:1px solid #000;padding-top:5px;text-align:center;font-size:10px;color:#444}
  .foot{margin-top:18px;border-top:1px solid #ddd;padding-top:8px;font-size:9px;color:#999;text-align:center}
  .bar{position:fixed;top:0;left:0;right:0;background:#1a237e;color:#fff;padding:9px 18px;display:flex;gap:10px;align-items:center;z-index:99}
  .bar button{background:#fff;color:#1a237e;border:none;padding:6px 15px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer}
  @page{size:A4 landscape;margin:8mm}
  @media print{ .bar,.barpad{display:none!important} body{background:#fff} .page{padding:0;width:auto;min-height:0} }
${_lh ? _lh.printCSS : ''}
</style></head><body>
<div class="bar">
  <span style="font-weight:700">📋 Inventory Count Form — ${e(h.formNo||'')}</span>
  <button onclick="window.print()">🖨 Print / Save as PDF</button>
  <button onclick="window.close()" style="margin-left:auto;background:rgba(255,255,255,.15);color:#fff">✕ Close</button>
</div>
<div class="barpad" style="height:46px"></div>
<div class="page">
  ${_lh ? _lh.headerHTML : `
  <div class="htop">
    <img src="${location.origin + location.pathname.replace(/[^/]*$/,'') + 'icons/barro-industries.png'}" class="logo" onerror="this.style.display='none'" alt=""/>
    <div><div class="cname">BARRO INDUSTRIES</div><div class="csub">Physical Inventory Count Form</div></div>
    <div class="title"><div class="t">Inventory Count</div><div class="scope">${e(kindLabel)}</div></div>
  </div>`}
  <div class="meta">
    <div class="mbox"><div class="l">Form No.</div><div class="v">${e(h.formNo||'')}</div></div>
    <div class="mbox"><div class="l">Count Date</div><div class="v">${e(fmtDate(h.date))}</div></div>
    <div class="mbox"><div class="l">Warehouse / Location</div><div class="v">${e(h.location||'')}</div></div>
    <div class="mbox"><div class="l">Counted By</div><div class="v">${e(h.countedBy||'')}</div></div>
  </div>
  <table>
    <thead><tr>
      <th style="width:30px">#</th><th>Item / Description</th><th style="width:60px">Unit</th>
      <th style="width:80px">System Qty</th><th style="width:90px">Physical Count</th>
      <th style="width:70px">Variance</th><th style="width:24%">Remarks</th>
    </tr></thead>
    <tbody>${rows}${extraRows}${blanks}</tbody>
  </table>
  ${_lh ? _lh.footerHTML : `
  <div class="sign">
    <div class="sline">Counted by${h.countedBy?` — ${e(h.countedBy)}`:''}</div>
    <div class="sline">Verified by${h.verifiedBy?` — ${e(h.verifiedBy)}`:''}</div>
    <div class="sline">Approved by</div>
  </div>
  <div class="foot">Barro Industries Operating System · Generated ${new Date().toLocaleString('en-PH')} · Physical count supersedes system quantity upon approval.</div>`}
</div>
</body></html>`;

  const win = window.open('','_blank','width=1000,height=720');
  if(!win){ Notifs.showToast('Allow pop-ups to open the printable form','error'); return; }
  win.document.write(html); win.document.close();
}

async function renderProdMaterials(el, currentRole) {
  el.innerHTML = '<div class="loading-placeholder">Loading materials…</div>';
  const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
  const mats = snap.docs.map(d=>({id:d.id,...d.data()})).filter(i=>(i.kind||'material')==='material').sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const low = mats.filter(i=>(i.reorderLevel||0)>0 && (i.qty||0) <= (i.reorderLevel||0));
  const stockValue = mats.reduce((s,i)=>s+(Number(i.qty)||0)*(Number(i.unitCost)||0),0);
  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Raw Materials</div><div class="kpi-value">${mats.length}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Stock Value</div><div class="kpi-value" style="font-size:15px">₱${fmt(stockValue)}</div></div>
      <div class="kpi-card ${low.length?'red':''}"><div class="kpi-label">Low Stock</div><div class="kpi-value">${low.length}</div></div>
    </div>
    ${low.length?`<div class="alert-banner alert-warn"><span>⚠️ <strong>${low.length} material${low.length>1?'s':''}</strong> at or below reorder level — flag Purchasing.</span></div>`:''}
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button class="btn-secondary btn-sm" onclick="navigateTo('inventory')">Open full Inventory →</button>
    </div>
    <div class="card"><div class="card-body" style="padding:0">
      ${!mats.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">📦</div><h4>No materials in inventory yet</h4><p>Add raw materials in the Inventory module.</p></div>':
      `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Material</th><th>On Hand</th><th>Reorder</th><th>Unit Cost</th><th>Supplier</th></tr></thead>
        <tbody>${mats.map(i=>{
          const lowItem=(i.reorderLevel||0)>0 && (i.qty||0)<=(i.reorderLevel||0);
          return `<tr>
            <td style="font-weight:600">${escHtml(i.name||'—')}${i.category?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(i.category)}</div>`:''}</td>
            <td style="font-weight:700;color:${lowItem?'var(--danger)':'inherit'}">${Number(i.qty||0).toLocaleString('en-PH')} ${escHtml(i.unit||'')}${lowItem?' ⚠️':''}</td>
            <td style="font-size:12px;color:var(--text-muted)">${Number(i.reorderLevel||0).toLocaleString('en-PH')}</td>
            <td>₱${fmt(i.unitCost||0)}</td>
            <td style="font-size:12px">${escHtml(i.supplier||'—')}</td>
          </tr>`;}).join('')}</tbody>
      </table></div>`}
    </div></div>`;
}

// ══════════════════════════════════════════════════
//  PURCHASING DEPARTMENT
//  Flow: create a Request for Quotation (RFQ) → enter supplier prices →
//  convert it into a Purchase Request (PR). Both stages live in ONE
//  collection (purchase_requisitions) keyed by `stage` ('rfq' | 'pr') so the
//  conversion preserves the line items + history. Finance gets a read-only
//  window into the committed purchase requests (Finance → Purchases tab).
// ══════════════════════════════════════════════════
function purchTotal(items) {
  return (items || []).reduce((s, it) =>
    s + (it.unitPrice != null ? (Number(it.unitPrice) || 0) * (Number(it.qty) || 0) : 0), 0);
}

window.renderPurchasing = async function(currentUser, currentRole, subtab = 'Request for Quotation') {
  const c = deptContainer();
  const tabs = ['Request for Quotation', 'Purchase Requests', 'Tasks'];
  c.innerHTML = `
    <div class="page-header"><h2>🛒 Purchasing</h2></div>
    ${window.sopPanel('How Purchasing works', [
      'Raise a Request for Quotation (or pre-fill one "From low stock"); enter supplier prices.',
      'Convert the RFQ to a Purchase Request, print the branded PO, and submit it to Finance.',
      'Received materials auto-match to Inventory on receive.'
    ])}
    ${window.chipTabs(tabs.map(s=>({key:s,label:s})), subtab)}
    <div id="purch-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadPurchasingContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => loadPurchasingContent(currentUser, currentRole, key));
};

async function loadPurchasingContent(currentUser, currentRole, sub) {
  const content = document.getElementById('purch-content');
  try {
    if (sub === 'Tasks') return await renderDeptTasks(content, 'Purchasing', currentUser, currentRole);
    if (sub === 'Purchase Requests') return await renderPurchaseRequests(content, currentUser, currentRole);
    return await renderRFQs(content, currentUser, currentRole);
  } catch (e) {
    console.error('Purchasing load error', e);
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>Couldn't load</h4><p>${escHtml(e.message||String(e))}</p></div>`;
  }
}

// ── RFQ list (stage === 'rfq') ────────────────────
async function renderRFQs(content, currentUser, currentRole) {
  const canEdit = canEditDept('Purchasing');
  const snap = await db.collection('purchase_requisitions').orderBy('createdAt','desc').get();
  const rfqs = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(d => (d.stage||'rfq') === 'rfq');

  content.innerHTML = `
    ${canEdit ? `<div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:8px;flex-wrap:wrap"><button class="btn-secondary btn-sm" id="rfq-lowstock-btn">📉 From low stock</button><button class="btn-primary btn-sm" id="new-rfq-btn">+ New RFQ</button></div>` : ''}
    <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px">Create a Request for Quotation, enter the supplier's prices, then convert it into a Purchase Request.</p>
    ${!rfqs.length
      ? `<div class="empty-state"><div class="empty-icon">📋</div><h4>No open RFQs</h4><p>Create one to request supplier pricing.</p></div>`
      : rfqs.map(r => purchRfqCard(r, canEdit)).join('')}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [content] });
  if (canEdit) {
    document.getElementById('new-rfq-btn')?.addEventListener('click', () =>
      openRfqModal(currentUser, () => renderRFQs(content, currentUser, currentRole)));
    document.getElementById('rfq-lowstock-btn')?.addEventListener('click', async () => {
      const isnap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
      const low = isnap.docs.map(d => d.data())
        .filter(i => (i.kind || 'material') === 'material' && (i.reorderLevel || 0) > 0 && (i.qty || 0) <= (i.reorderLevel || 0));
      if (!low.length) { Notifs.showToast('No materials are at or below reorder level. 👍'); return; }
      // Suggested order qty brings stock up to ~2× the reorder level.
      const items = low.map(i => ({ desc: i.name || '', qty: Math.max(Math.round((i.reorderLevel || 0) * 2 - (i.qty || 0)), i.reorderLevel || 0), unit: i.unit || '' }));
      openRfqModal(currentUser, () => renderRFQs(content, currentUser, currentRole), {
        title: `Reorder — ${low.length} low-stock material${low.length > 1 ? 's' : ''}`,
        items
      });
    });
    rfqs.forEach(r => bindRfqCard(r, currentUser, currentRole, content));
  }
}

function purchRfqCard(r, canEdit) {
  const items = r.items || [];
  return `
  <div class="card" data-rfq="${r.id}" style="margin-bottom:12px"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div>
        <div style="font-weight:700">${escHtml(r.title || 'Untitled RFQ')}</div>
        <div style="font-size:12px;color:var(--text-muted)">${escHtml(r.rfqNo || '')} · Supplier: ${escHtml(r.supplier || '—')}</div>
        <div style="font-size:12px;color:var(--text-muted)">Requesting: ${escHtml(r.requestingDept || '—')}${r.neededBy ? ` · Needed by ${escHtml(r.neededBy)}` : ''}</div>
        ${r.deliverTo ? `<div style="font-size:12px;color:var(--text-muted)">Deliver to: ${escHtml(r.deliverTo)}</div>` : ''}
      </div>
      ${canEdit ? `<button class="btn-danger btn-sm rfq-del" data-id="${r.id}" data-label="${escHtml(r.title || 'RFQ')}">${emojiIcon('trash-2',14)}</button>` : ''}
    </div>
    ${r.notes ? `<div style="font-size:12px;margin-top:6px">${escHtml(r.notes)}</div>` : ''}
    <div class="table-wrap" style="margin-top:10px"><table class="data-table">
      <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th style="width:120px">Unit Price ₱</th><th style="text-align:right">Line Total</th></tr></thead>
      <tbody>
        ${items.map((it, i) => `<tr>
          <td>${escHtml(it.desc || '—')}</td>
          <td>${Number(it.qty || 0)}</td>
          <td>${escHtml(it.unit || '')}</td>
          <td>${canEdit
            ? `<input type="number" inputmode="decimal" step="0.01" min="0" class="rfq-price" data-i="${i}" value="${it.unitPrice != null ? it.unitPrice : ''}" style="width:100%" placeholder="—"/>`
            : (it.unitPrice != null ? fmt(it.unitPrice) : '—')}</td>
          <td style="text-align:right" class="rfq-line" data-i="${i}">${it.unitPrice != null ? '₱' + fmt((it.unitPrice || 0) * (it.qty || 0)) : '—'}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-weight:700" class="rfq-total">₱${fmt(purchTotal(items))}</td></tr></tfoot>
    </table></div>
    ${canEdit ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
      <button class="btn-secondary btn-sm rfq-save" data-id="${r.id}">Save Prices</button>
      <button class="btn-primary btn-sm rfq-convert" data-id="${r.id}">Convert to Purchase Request →</button>
    </div>` : ''}
  </div></div>`;
}

function bindRfqCard(r, currentUser, currentRole, content) {
  const cardEl = content.querySelector(`.card[data-rfq="${r.id}"]`);
  if (!cardEl) return;
  const items = (r.items || []).map(x => ({ ...x }));

  const recalc = () => {
    let total = 0;
    cardEl.querySelectorAll('.rfq-price').forEach(inp => {
      const i = +inp.dataset.i;
      const price = inp.value === '' ? null : (parseFloat(inp.value) || 0);
      items[i].unitPrice = price;
      const lineEl = cardEl.querySelector(`.rfq-line[data-i="${i}"]`);
      const lt = price != null ? price * (Number(items[i].qty) || 0) : null;
      if (lineEl) lineEl.textContent = lt != null ? '₱' + fmt(lt) : '—';
      if (lt != null) total += lt;
    });
    const tEl = cardEl.querySelector('.rfq-total');
    if (tEl) tEl.textContent = '₱' + fmt(total);
  };
  cardEl.querySelectorAll('.rfq-price').forEach(inp => inp.addEventListener('input', recalc));

  cardEl.querySelector('.rfq-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      recalc();
      await db.collection('purchase_requisitions').doc(r.id).update({
        items, total: purchTotal(items),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      Notifs.showToast('Prices saved.');
    } catch (err) { Notifs.showToast('Save failed: ' + (err.message || err), 'error'); }
    finally { btn.disabled = false; }
  });

  cardEl.querySelector('.rfq-convert')?.addEventListener('click', async (e) => {
    recalc();
    if (!items.length || items.some(it => it.unitPrice == null || isNaN(it.unitPrice))) {
      Notifs.showToast('Enter a price for every item before converting.', 'error');
      return;
    }
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const prNo = (r.rfqNo || '').replace(/^RFQ/, 'PR') || ('PR-' + today());
      await db.collection('purchase_requisitions').doc(r.id).update({
        items, total: purchTotal(items), stage: 'pr', status: 'pending', prNo,
        convertedAt: firebase.firestore.FieldValue.serverTimestamp(),
        convertedBy: currentUser.uid,
        convertedByName: window.userProfile?.displayName || currentUser.email
      });
      Notifs.showToast('Converted to Purchase Request ✓');
      renderRFQs(content, currentUser, currentRole);
    } catch (err) { Notifs.showToast('Convert failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  });

  cardEl.querySelector('.rfq-del')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmDialog({message:`Delete RFQ "${escHtml(btn.dataset.label)}"? This cannot be undone.`, danger:true, html:true}))) return;
    try {
      await db.collection('purchase_requisitions').doc(btn.dataset.id).delete();
      Notifs.showToast('Deleted.');
      renderRFQs(content, currentUser, currentRole);
    } catch (err) { Notifs.showToast('Delete failed: ' + (err.message || err), 'error'); }
  });
}

function openRfqModal(currentUser, onDone, prefill) {
  prefill = prefill || {};
  const deptOpts = Object.keys(window.DEPARTMENTS || {})
    .filter(k => k !== 'Brilliant Steel' && k !== 'Partners')
    .map(k => `<option>${escHtml(k)}</option>`).join('');
  openPage('🛒 New Request for Quotation', `
    <div class="form-row">
      <div class="form-group"><label>Title / Purpose *</label><input id="rfq-title" value="${escHtml(prefill.title||'')}" placeholder="e.g. Steel sheets for Job #123"/></div>
      <div class="form-group"><label>Supplier</label><input id="rfq-supplier" placeholder="Supplier name (optional)"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Requesting Department</label><select id="rfq-dept">${deptOpts}</select></div>
      <div class="form-group"><label>Needed By</label><input id="rfq-needed" type="date"/></div>
    </div>
    <div class="form-group"><label>Deliver To (address / site)</label><input id="rfq-deliver" placeholder="e.g. Barro Industries — La Union Plant, Brgy. …"/></div>
    <div class="form-group"><label>Notes</label><textarea id="rfq-notes" rows="2" placeholder="Optional"></textarea></div>
    <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Items</label>
    <div id="rfq-items"></div>
    <button class="btn-secondary btn-sm" id="rfq-add-item" type="button" style="margin-top:6px">+ Add item</button>
  `, `<button class="btn-primary" id="rfq-save">Create RFQ</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const itemsWrap = document.getElementById('rfq-items');
  const addRow = (desc = '', qty = '', unit = '') => {
    const row = document.createElement('div');
    row.className = 'rfq-item-row';
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
    row.innerHTML = `
      <input class="ri-desc" placeholder="Item description" value="${escHtml(desc)}" style="flex:2;min-width:0"/>
      <input class="ri-qty" type="number" inputmode="decimal" min="0" placeholder="Qty" value="${qty}" style="flex:0 0 60px;width:60px"/>
      <input class="ri-unit" placeholder="Unit" value="${escHtml(unit)}" style="flex:0 0 64px;width:64px"/>
      <button class="btn-danger btn-sm ri-del" type="button" title="Remove">✕</button>`;
    row.querySelector('.ri-del').addEventListener('click', () => row.remove());
    itemsWrap.appendChild(row);
  };
  if (Array.isArray(prefill.items) && prefill.items.length) prefill.items.forEach(it => addRow(it.desc, it.qty, it.unit));
  else { addRow(); addRow(); }
  document.getElementById('rfq-add-item').addEventListener('click', () => addRow());

  document.getElementById('rfq-save').addEventListener('click', async () => {
    const title = document.getElementById('rfq-title').value.trim();
    if (!title) { Notifs.showToast('Enter a title.', 'error'); return; }
    const items = [...itemsWrap.querySelectorAll('.rfq-item-row')].map(row => ({
      desc: row.querySelector('.ri-desc').value.trim(),
      qty: parseFloat(row.querySelector('.ri-qty').value) || 0,
      unit: row.querySelector('.ri-unit').value.trim(),
      unitPrice: null
    })).filter(it => it.desc);
    if (!items.length) { Notifs.showToast('Add at least one item.', 'error'); return; }
    const btn = document.getElementById('rfq-save'); btn.disabled = true;
    try {
      const yr = window.bizYear ? window.bizYear() : new Date().getFullYear();
      const rfqNo = `RFQ-${yr}-${String(Date.now()).slice(-4)}`;
      await db.collection('purchase_requisitions').add({
        rfqNo, title,
        supplier: document.getElementById('rfq-supplier').value.trim(),
        requestingDept: document.getElementById('rfq-dept').value,
        neededBy: document.getElementById('rfq-needed').value,
        deliverTo: document.getElementById('rfq-deliver').value.trim(),
        notes: document.getElementById('rfq-notes').value.trim(),
        items, stage: 'rfq', total: 0, status: 'quoting',
        createdBy: currentUser.uid,
        createdByName: window.userProfile?.displayName || currentUser.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal();
      Notifs.showToast('RFQ created.');
      onDone && onDone();
    } catch (err) { Notifs.showToast('Create failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  });
}

// ── Purchase Request list (stage === 'pr') ────────
// Shared by the Purchasing dept (editable status) and the Finance → Purchases
// tab (opts.viewOnly hides controls; Firestore rules also block Finance writes).
const PURCH_STAT = {
  pending:  { label: 'Pending',  badge: 'badge-orange' },
  ordered:  { label: 'Ordered',  badge: 'badge-blue' },
  received: { label: 'Received', badge: 'badge-green' }
};

// Export all purchase requests (one row per PR) to CSV for records / finance.
window.exportPurchasesCSV = function() {
  const prs = window._purchPRs || [];
  const tot = p => p.total != null ? p.total : (typeof purchTotal === 'function' ? purchTotal(p.items) : 0);
  const dt = p => p.convertedAt?.toDate ? window.bizDate(p.convertedAt.toDate()) : (p.createdAt?.toDate ? window.bizDate(p.createdAt.toDate()) : '');
  window.exportCSV('purchase-requests', prs, [
    { key:'prNo', label:'PO No', get:p=>p.prNo||p.rfqNo||'' },
    { key:'date', label:'Date', get:dt },
    { key:'supplier', label:'Supplier', get:p=>p.supplier||'' },
    { key:'title', label:'Title', get:p=>p.title||'' },
    { key:'requestingDept', label:'Requesting Dept', get:p=>p.requestingDept||'' },
    { key:'status', label:'Status', get:p=>p.status||'pending' },
    { key:'total', label:'Total', get:tot },
    { key:'submittedToFinance', label:'Sent to Finance', get:p=>p.submittedToFinance?'yes':'no' },
    { key:'recordedToFinance', label:'Recorded', get:p=>p.recordedToFinance?'yes':'no' }
  ]);
};

async function renderPurchaseRequests(content, currentUser, currentRole, opts = {}) {
  const canEdit = !opts.viewOnly && canEditDept('Purchasing');
  const canRecord = !!opts.financeView && isFinancePriv(); // Finance/admin may post to the books
  const snap = await db.collection('purchase_requisitions').orderBy('createdAt','desc').get();
  const prs = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(d => d.stage === 'pr');

  // ── Spend summary ──
  const totOf = p => p.total != null ? p.total : purchTotal(p.items);
  const totalSpend = prs.reduce((s,p)=>s+totOf(p),0);
  const openSpend = prs.filter(p=>p.status!=='received').reduce((s,p)=>s+totOf(p),0);
  const ym = (window.bizDate?window.bizDate():new Date().toISOString().slice(0,10)).slice(0,7);
  const dateOf = p => (p.convertedAt?.toDate ? window.bizDate(p.convertedAt.toDate()) : (p.createdAt?.toDate ? window.bizDate(p.createdAt.toDate()) : ''));
  const monthSpend = prs.filter(p=>dateOf(p).slice(0,7)===ym).reduce((s,p)=>s+totOf(p),0);
  const bySupplier = {}; prs.forEach(p=>{ const k=(p.supplier||'—').trim()||'—'; bySupplier[k]=(bySupplier[k]||0)+totOf(p); });
  const topSup = Object.entries(bySupplier).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const supMax = topSup.reduce((m,[,v])=>Math.max(m,v),0)||1;
  window._purchPRs = prs; // for CSV export
  const summary = prs.length ? `
    <div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button class="btn-secondary btn-sm" onclick="window.exportPurchasesCSV()" title="Export all purchase requests to CSV">⬇ CSV</button></div>
    <div class="kpi-row" style="margin-bottom:10px">
      <div class="kpi-card"><div class="kpi-label">Purchase Requests</div><div class="kpi-value">${prs.length}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Open (not received)</div><div class="kpi-value" style="font-size:15px">₱${fmt(openSpend)}</div></div>
      <div class="kpi-card green"><div class="kpi-label">This Month</div><div class="kpi-value" style="font-size:15px">₱${fmt(monthSpend)}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Total Committed</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalSpend)}</div></div>
    </div>
    ${topSup.length?`<div class="card" style="margin-bottom:12px"><div class="card-header"><h3 style="font-size:13px">Top Suppliers by Spend</h3></div><div class="card-body">
      ${topSup.map(([k,v])=>`<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>${escHtml(k)}</span><span style="font-weight:700">₱${fmt(v)}</span></div>
        <div style="height:7px;background:var(--surface2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.round(v/supMax*100)}%;background:var(--primary);border-radius:4px"></div></div>
      </div>`).join('')}
    </div></div>`:''}` : '';

  const filterBar = prs.length > 3 ? `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <div class="subtab-bar" style="margin:0">
        ${['all','pending','ordered','received'].map(s=>`<button class="subtab-btn pr-filter ${s==='all'?'active':''}" data-f="${s}">${s==='all'?'All':PURCH_STAT[s].label}</button>`).join('')}
      </div>
      <input id="pr-search" placeholder="Search supplier / title / PO#" style="flex:1;min-width:140px;padding:7px 11px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)"/>
    </div>` : '';

  content.innerHTML = `
    ${summary}
    ${opts.financeView ? `<p style="font-size:12px;color:var(--text-muted);margin:0 0 12px">Purchases raised by the Purchasing department. Use <strong>Record as Disbursement</strong> to post one into the Cash Disbursement Journal.</p>` : ''}
    ${filterBar}
    <div id="pr-empty-note" style="display:none;font-size:12px;color:var(--text-muted);padding:12px">No purchase requests match.</div>
    ${!prs.length
      ? `<div class="empty-state"><div class="empty-icon">🧾</div><h4>No purchase requests yet</h4><p>${canEdit ? 'Convert a priced RFQ into a purchase request.' : 'None have been raised yet.'}</p></div>`
      : prs.map(p => {
        const st = PURCH_STAT[p.status || 'pending'] || PURCH_STAT.pending;
        const searchStr = ((p.title||'')+' '+(p.supplier||'')+' '+(p.prNo||p.rfqNo||'')+' '+(p.requestingDept||'')).toLowerCase().replace(/"/g,'');
        return `<div class="card pr-row" data-pr="${p.id}" data-status="${p.status||'pending'}" data-search="${escHtml(searchStr)}" style="margin-bottom:12px"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <div style="font-weight:700">${escHtml(p.title || 'Purchase Request')}</div>
              <div style="font-size:12px;color:var(--text-muted)">${escHtml(p.prNo || p.rfqNo || '')} · Supplier: ${escHtml(p.supplier || '—')}</div>
              <div style="font-size:12px;color:var(--text-muted)">Requesting: ${escHtml(p.requestingDept || '—')}${p.neededBy ? ` · Needed by ${escHtml(p.neededBy)}` : ''}</div>
              ${p.deliverTo ? `<div style="font-size:12px;color:var(--text-muted)">Deliver to: ${escHtml(p.deliverTo)}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span class="badge ${st.badge}">${st.label}</span>
              ${p.submittedToFinance ? `<span class="badge badge-green" style="font-size:9px">🧾 Sent to Finance</span>` : ''}
            </div>
          </div>
          <div class="table-wrap" style="margin-top:10px"><table class="data-table">
            <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Line Total</th></tr></thead>
            <tbody>${(p.items || []).map(it => `<tr>
              <td>${escHtml(it.desc || '—')}</td>
              <td>${Number(it.qty || 0)}</td>
              <td>${escHtml(it.unit || '')}</td>
              <td style="text-align:right">₱${fmt(it.unitPrice || 0)}</td>
              <td style="text-align:right">₱${fmt((it.unitPrice || 0) * (it.qty || 0))}</td>
            </tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-weight:700">₱${fmt(p.total != null ? p.total : purchTotal(p.items))}</td></tr></tfoot>
          </table></div>
          ${p.notes ? `<div style="font-size:12px;margin-top:6px;color:var(--text-muted)">${escHtml(p.notes)}</div>` : ''}
          ${p.submittedToFinance && p.submittedToFinanceByName ? `<div style="font-size:11px;margin-top:6px;color:var(--success,#1b8a3a)">🧾 Submitted to Finance by ${escHtml(p.submittedToFinanceByName)}${p.submittedToFinanceAt && p.submittedToFinanceAt.toDate ? ` · ${p.submittedToFinanceAt.toDate().toLocaleDateString('en-PH')}` : ''}</div>` : ''}
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
            <button class="btn-secondary btn-sm pr-print" data-id="${p.id}">🖨 Print PO</button>
            ${canEdit ? `
              ${p.status !== 'ordered' && p.status !== 'received' ? `<button class="btn-secondary btn-sm pr-stat" data-id="${p.id}" data-stat="ordered">Mark Ordered</button>` : ''}
              ${p.status !== 'received' ? `<button class="btn-primary btn-sm pr-stat" data-id="${p.id}" data-stat="received">Mark Received</button>` : ''}
              ${(p.status === 'ordered' || p.status === 'received') && !p.submittedToFinance ? `<button class="btn-primary btn-sm pr-submit-fin" data-id="${p.id}">📩 Submit to Finance</button>` : ''}
            ` : ''}
            ${canRecord && !p.recordedToFinance ? `<button class="btn-primary btn-sm pr-record" data-id="${p.id}">🧾 Record as Disbursement</button>` : ''}
            ${p.recordedToFinance ? `<span style="font-size:11px;color:var(--success,#1b8a3a);align-self:center">✓ Recorded in journal</span>` : ''}
          </div>
        </div></div>`;
      }).join('')}
  `;

  content.querySelectorAll('.pr-print').forEach(btn => btn.addEventListener('click', () => {
    const p = prs.find(x => x.id === btn.dataset.id);
    if (p) printPurchaseOrder(p);
  }));

  // ── Filter + search (client-side show/hide) ──
  let _prFilter = 'all';
  const applyPrFilter = () => {
    const q = (content.querySelector('#pr-search')?.value || '').trim().toLowerCase();
    let shown = 0;
    content.querySelectorAll('.pr-row').forEach(row => {
      const okStatus = _prFilter === 'all' || (row.dataset.status || 'pending') === _prFilter;
      const okSearch = !q || (row.dataset.search || '').includes(q);
      const vis = okStatus && okSearch;
      row.style.display = vis ? '' : 'none';
      if (vis) shown++;
    });
    const note = content.querySelector('#pr-empty-note');
    if (note) note.style.display = shown ? 'none' : '';
  };
  content.querySelectorAll('.pr-filter').forEach(btn => btn.addEventListener('click', () => {
    content.querySelectorAll('.pr-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); _prFilter = btn.dataset.f; applyPrFilter();
  }));
  content.querySelector('#pr-search')?.addEventListener('input', applyPrFilter);

  const redo = () => renderPurchaseRequests(content, currentUser, currentRole, opts);

  // Purchasing → hand the completed purchase to Finance for recordkeeping.
  if (canEdit) content.querySelectorAll('.pr-submit-fin').forEach(btn => btn.addEventListener('click', async () => {
    const p = prs.find(x => x.id === btn.dataset.id); if (!p) return;
    if (!(await confirmDialog({message:`Submit "${escHtml(p.title || p.prNo)}" (₱${fmt(p.total != null ? p.total : purchTotal(p.items))}) to Finance for recordkeeping?`, html:true}))) return;
    btn.disabled = true;
    try {
      await db.collection('purchase_requisitions').doc(p.id).update({
        submittedToFinance: true,
        submittedToFinanceAt: firebase.firestore.FieldValue.serverTimestamp(),
        submittedToFinanceBy: currentUser.uid,
        submittedToFinanceByName: window.userProfile?.displayName || currentUser.email
      });
      await notifyFinanceTeam({
        title: '🧾 Purchase for Recordkeeping',
        body: `${p.prNo || p.rfqNo || 'A purchase'} — ${p.supplier || 'supplier'} · ₱${fmt(p.total != null ? p.total : purchTotal(p.items))}. See Finance → Purchases.`,
        icon: '🧾', type: 'purchase_submitted', dedupKey: `pr-fin-${p.id}`
      });
      Notifs.showToast('Submitted to Finance ✓');
      redo();
    } catch (err) { Notifs.showToast('Submit failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  }));

  // Finance → post the purchase into the cash disbursement journal.
  if (canRecord) content.querySelectorAll('.pr-record').forEach(btn => btn.addEventListener('click', () => {
    const p = prs.find(x => x.id === btn.dataset.id); if (!p) return;
    recordPurchaseDisbursement(p, currentUser, redo);
  }));

  if (canEdit) content.querySelectorAll('.pr-stat').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const p = prs.find(x => x.id === btn.dataset.id);
      await db.collection('purchase_requisitions').doc(btn.dataset.id).update({
        status: btn.dataset.stat,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // On receive, auto-match the purchased lines into inventory by name (once).
      if (btn.dataset.stat === 'received' && p && !p.receivedToInventory) {
        const res = await receivePurchaseIntoInventory(p).catch(e => { console.warn('[receive→inventory]', e); return null; });
        if (res) {
          await db.collection('purchase_requisitions').doc(p.id).update({ receivedToInventory: true }).catch(()=>{});
          Notifs.showToast(res.matched
            ? `Received. ${res.matched} item${res.matched>1?'s':''} added to inventory${res.unmatched.length?`; ${res.unmatched.length} not matched`:''}.`
            : 'Received. No inventory items matched by name.');
        } else { Notifs.showToast('Status updated.'); }
      } else {
        Notifs.showToast('Status updated.');
      }
      renderPurchaseRequests(content, currentUser, currentRole, opts);
    } catch (err) { Notifs.showToast('Update failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  }));
}

// Auto-match a received purchase's line items into inventory by name (case-insensitive,
// trimmed). Matched items get qty incremented + unit cost refreshed to the purchase
// price + supplier filled if blank. Unmatched lines are returned so the user is told.
async function receivePurchaseIntoInventory(p) {
  const items = (p.items || []).filter(it => it.desc && (Number(it.qty)||0) > 0);
  if (!items.length) return { matched: 0, unmatched: [] };
  const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
  const byName = {};
  snap.docs.forEach(d => { const n = (d.data().name||'').trim().toLowerCase(); if (n) byName[n] = d; });
  const batch = db.batch();
  let matched = 0; const unmatched = [];
  items.forEach(it => {
    const hit = byName[(it.desc||'').trim().toLowerCase()];
    if (!hit) { unmatched.push(it.desc); return; }
    const upd = {
      qty: firebase.firestore.FieldValue.increment(Number(it.qty)||0),
      lastReceivedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // Refresh to the latest purchase cost, but only for a real positive price —
    // never let a blank/zero line wipe the stored unit cost.
    if (it.unitPrice != null && (Number(it.unitPrice)||0) > 0) upd.unitCost = Number(it.unitPrice);
    if (p.supplier && !(hit.data().supplier||'').trim()) upd.supplier = p.supplier;
    batch.update(hit.ref, upd);
    matched++;
  });
  if (matched) {
    await batch.commit();
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('inventory_items');
  }
  return { matched, unmatched };
}

// Notify the Finance team (Finance-dept members + Accountant role) and the
// President/owner. De-duplicated by uid so nobody is double-pinged.
async function notifyFinanceTeam(data) {
  const uids = new Set();
  const snaps = await Promise.all([
    db.collection('users').where('department', '==', 'Finance').get().catch(() => ({ docs: [] })),
    db.collection('users').where('departments', 'array-contains', 'Finance').get().catch(() => ({ docs: [] })),
    db.collection('users').where('role', '==', 'finance').get().catch(() => ({ docs: [] }))
  ]);
  snaps.forEach(s => s.docs.forEach(d => uids.add(d.id)));
  await Promise.all([...uids].map(uid => safeNotify(() => Notifs.send(uid, data))));
  await safeNotify(() => Notifs.sendToOwner(data));
}

// Finance posts a submitted purchase into the cash disbursement journal.
// Pre-fills from the purchase request; the PR's PO number becomes the reference
// so a double-entry is easy to spot.
function recordPurchaseDisbursement(p, currentUser, onDone) {
  const total = p.total != null ? p.total : purchTotal(p.items);
  const ref = p.prNo || p.rfqNo || '';
  openPage('🧾 Record Purchase — Cash Disbursement', `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Posting <strong>${escHtml(p.title || ref)}</strong> to the Cash Disbursement Journal.</div>
    <div class="form-row">
      <div class="form-group"><label>Reference</label><input id="rec-ref" value="${escHtml(ref)}"/></div>
      <div class="form-group"><label>Date</label><input id="rec-date" type="date" value="${today()}"/></div>
    </div>
    <div class="form-group"><label>Payee / Supplier</label><input id="rec-payee" value="${escHtml(p.supplier || '')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Amount — Credit: Cash (₱)</label><input id="rec-amt" type="number" step="0.01" inputmode="decimal" value="${total}"/></div>
      <div class="form-group"><label>Debit Account</label><select id="rec-acct">
        <option value="inventory" selected>Inventory – Materials (asset)</option>
        <option value="material">COS – Direct Material (direct-to-job, skips stock)</option>
        <option value="ap">Accounts Payable</option>
        <option value="sundry">Sundry / Other</option>
      </select></div>
    </div>
    <div class="form-group" id="rec-sundry-wrap" style="display:none"><label>Sundry Account Name</label><input id="rec-sundry" placeholder="e.g. Office Supplies Expense"/></div>
    <div class="form-group"><label>Input VAT</label>
      <select id="rec-vat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="inclusive" selected>VATable — 12% input VAT in the amount (claimable)</option>
        <option value="exempt">No input VAT (exempt / non-VAT supplier)</option>
      </select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px"><span id="rec-vat-preview"></span></div>
    </div>
  `, `<button class="btn-primary" id="rec-save">Post Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const acctSel = document.getElementById('rec-acct');
  acctSel.addEventListener('change', () => {
    document.getElementById('rec-sundry-wrap').style.display = acctSel.value === 'sundry' ? '' : 'none';
  });
  const recVatPreview = () => {
    const amt = parseFloat(document.getElementById('rec-amt').value) || 0;
    const vat = document.getElementById('rec-vat').value === 'exempt' ? 0 : window.vatSplit(amt,'inclusive').vat;
    document.getElementById('rec-vat-preview').textContent = vat > 0 ? `Input VAT ₱${fmt(vat)} reclaimable` : 'No input VAT';
  };
  document.getElementById('rec-amt').addEventListener('input', recVatPreview);
  document.getElementById('rec-vat').addEventListener('change', recVatPreview);
  recVatPreview();

  document.getElementById('rec-save').addEventListener('click', async () => {
    const reference = document.getElementById('rec-ref').value.trim();
    const payee = document.getElementById('rec-payee').value.trim();
    const amt = parseFloat(document.getElementById('rec-amt').value) || 0;
    const acct = acctSel.value;
    if (!payee) { Notifs.showToast('Enter a payee.', 'error'); return; }
    if (!amt) { Notifs.showToast('Enter the amount.', 'error'); return; }
    const saveBtn = document.getElementById('rec-save'); saveBtn.disabled = true;
    try {
      if (reference) {
        const dupe = await db.collection('cash_disbursement_journal').where('reference', '==', reference).limit(1).get().catch(() => ({ empty: true }));
        if (!dupe.empty && !(await confirmDialog({message:`A disbursement with reference "${escHtml(reference)}" already exists. Post another?`, html:true}))) { saveBtn.disabled = false; return; }
      }
      const dueDate = document.getElementById('rec-date').value;
      await window.assertPeriodOpen(dueDate);
      const vatTreatment = document.getElementById('rec-vat').value;
      const inputVat = vatTreatment === 'exempt' ? 0 : window.vatSplit(amt,'inclusive').vat;
      // acct==='inventory' still writes the amount into debitMaterial (so legacy
      // readers of the CDJ doc keep summing correctly); debitAccount is what
      // tells postCDJToLedger to tag the mirrored ledger row as an asset instead
      // of an expense (v12 WS13 — fixes double material expensing).
      const cdjData = {
        reference, date: dueDate, payee,
        creditCash: amt,
        debitMaterial:     (acct === 'material' || acct === 'inventory') ? amt : 0,
        debitAP:           acct === 'ap' ? amt : 0,
        debitLabor:        0,
        debitSundryAcct:   acct === 'sundry' ? document.getElementById('rec-sundry').value.trim() : '',
        debitSundryAmount: acct === 'sundry' ? amt : 0,
        debitAccount:      acct,
        vatAmount: inputVat, vatTreatment,
        purchaseRef:       p.id,
        addedBy: currentUser.uid,
        addedByName: window.userProfile?.displayName || currentUser.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      const cdjRef = await db.collection('cash_disbursement_journal').add(cdjData);
      await postCDJToLedger(cdjRef.id, cdjData); // also mirror into the ledger (unless pure A/P)
      // Stamp the purchase as recorded so it can't be silently double-posted.
      // (Rules let Finance write only these bookkeeping fields.)
      await db.collection('purchase_requisitions').doc(p.id).update({
        recordedToFinance: true,
        recordedToFinanceAt: firebase.firestore.FieldValue.serverTimestamp(),
        recordedBy: currentUser.uid,
        recordedByName: window.userProfile?.displayName || currentUser.email,
        cdjEntryId: cdjRef.id
      }).catch(() => {}); // journal post already succeeded — don't fail the action on the flag write
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
      closeModal();
      Notifs.showToast('Posted to Cash Disbursement Journal ✓');
      onDone && onDone();
    } catch (err) { Notifs.showToast('Post failed: ' + (err.message || err), 'error'); saveBtn.disabled = false; }
  });
}

// ── Printable Purchase Order (forward to supplier) ────────────────
// Opens a clean, branded PO document in a new window — same navy letterhead
// look as the quote builder / inventory count form. Print or "Save as PDF"
// from the browser dialog to email to the supplier.
function printPurchaseOrder(p) {
  const e = s => escHtml(s == null ? '' : String(s));
  const items = p.items || [];
  const total = p.total != null ? p.total : purchTotal(items);
  const issued = p.convertedAt && p.convertedAt.toDate ? p.convertedAt.toDate() : new Date();
  const issuedStr = issued.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
  const preparedBy = p.convertedByName || p.createdByName || '';
  const _sig = (window.BRAND && window.BRAND.legal.signatory) || { name: 'NEIL BARRO', title: 'President, Barro Industries OPC' };
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'PURCHASE ORDER',
    docNumber: p.prNo || p.rfqNo || '',
    dateLabel: 'Date: ' + issuedStr,
    extraMeta: p.neededBy ? ['Needed by: ' + p.neededBy] : [],
    signatures: [
      { label: 'Prepared by', name: preparedBy, title: 'Purchasing' },
      { label: 'Approved by', name: _sig.name, title: _sig.title }
    ],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH')
  }) : null;

  const rows = items.map((it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${e(it.desc || '—')}</td>
      <td class="c">${Number(it.qty || 0).toLocaleString('en-PH')}</td>
      <td class="c">${e(it.unit || '')}</td>
      <td class="r">₱${fmt(it.unitPrice || 0)}</td>
      <td class="r b">₱${fmt((it.unitPrice || 0) * (it.qty || 0))}</td>
    </tr>`).join('');
  const filled = items.length;
  let blanks = ''; for (let k = filled; k < Math.max(filled + 1, 6); k++) blanks += `<tr class="blank"><td class="c">${k + 1}</td><td></td><td></td><td></td><td></td><td></td></tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Purchase Order — ${e(p.prNo || p.rfqNo || '')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;background:#e8e8e8}
  .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:14mm}
  .htop{display:flex;align-items:center;gap:12px;border-bottom:3px solid #1E3A5F;padding-bottom:10px;margin-bottom:12px}
  .logo{width:58px;height:58px;object-fit:contain;flex-shrink:0}
  .cname{font-size:22px;font-weight:900;letter-spacing:.5px;color:#1E3A5F}
  .csub{font-size:9px;color:#555;margin-top:3px;line-height:1.5}
  .title{margin-left:auto;text-align:right}
  .title .t{display:inline-block;background:#1E3A5F;color:#fff;font-size:14px;font-weight:800;letter-spacing:1px;padding:6px 14px;border-radius:4px;text-transform:uppercase}
  .title .no{font-size:12px;font-weight:800;color:#333;margin-top:6px}
  .title .dt{font-size:10px;color:#666;margin-top:2px}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
  .pbox{border:1px solid #999;border-radius:6px;padding:8px 11px}
  .pbox .l{font-size:8px;text-transform:uppercase;letter-spacing:.6px;color:#1E3A5F;font-weight:800;margin-bottom:3px}
  .pbox .v{font-size:12px;font-weight:700;min-height:15px}
  .pbox .s{font-size:10px;color:#555;font-weight:400;margin-top:2px;line-height:1.45}
  table{width:100%;border-collapse:collapse;margin-bottom:10px}
  th,td{border:1px solid #444;padding:5px 7px;font-size:11px;vertical-align:top}
  th{background:#1E3A5F;color:#fff;font-size:9px;text-transform:uppercase;letter-spacing:.04em}
  td.c{text-align:center}td.r{text-align:right}td.b{font-weight:700}
  tr.blank td{height:22px}
  tfoot td{font-weight:700;background:#f0f4ff}
  .note{font-size:10px;color:#444;margin:4px 0 10px;line-height:1.5}
  .note b{color:#1E3A5F}
  .terms{border:1px solid #DDE2EC;background:#F5F6FA;border-radius:6px;padding:9px 12px;margin-bottom:14px}
  .terms h4{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#1E3A5F;margin-bottom:4px}
  .terms p{font-size:9.5px;color:#444;line-height:1.5}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:34px}
  .sline{border-top:1px solid #000;padding-top:5px;text-align:center;font-size:10px;color:#444}
  .sline b{display:block;font-size:11px;color:#000}
  .foot{margin-top:18px;border-top:1px solid #ddd;padding-top:8px;font-size:9px;color:#999;text-align:center}
  .bar{position:fixed;top:0;left:0;right:0;background:#1E3A5F;color:#fff;padding:9px 18px;display:flex;gap:10px;align-items:center;z-index:99}
  .bar button{background:#fff;color:#1E3A5F;border:none;padding:6px 15px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer}
  @page{size:A4 portrait;margin:9mm}
  @media print{ .bar,.barpad{display:none!important} body{background:#fff} .page{padding:0;width:auto;min-height:0} }
${_lh ? _lh.printCSS : ''}
</style></head><body>
<div class="bar">
  <span style="font-weight:700">🛒 Purchase Order — ${e(p.prNo || p.rfqNo || '')}</span>
  <button onclick="window.print()">🖨 Print / Save as PDF</button>
  <button onclick="window.close()" style="margin-left:auto;background:rgba(255,255,255,.15);color:#fff">✕ Close</button>
</div>
<div class="barpad" style="height:46px"></div>
<div class="page">
  ${_lh ? _lh.headerHTML : `
  <div class="htop">
    <img src="${location.origin + location.pathname.replace(/[^/]*$/, '') + 'icons/barro-industries.png'}" class="logo" onerror="this.style.display='none'" alt=""/>
    <div>
      <div class="cname">BARRO INDUSTRIES</div>
      <div class="csub">Barro Industries OPC · DTI / BIR Registered<br>hello@barroindustries.com · 0927 683 6300 · La Union | Baguio | Manila</div>
    </div>
    <div class="title">
      <div class="t">Purchase Order</div>
      <div class="no">${e(p.prNo || p.rfqNo || '')}</div>
      <div class="dt">Date: ${e(issuedStr)}${p.neededBy ? `<br>Needed by: ${e(p.neededBy)}` : ''}</div>
    </div>
  </div>`}
  <div class="parties">
    <div class="pbox">
      <div class="l">Supplier / Vendor</div>
      <div class="v">${e(p.supplier || '—')}</div>
      <div class="s">${e(p.title || '')}</div>
    </div>
    <div class="pbox">
      <div class="l">Deliver To</div>
      <div class="v">${e(p.deliverTo || 'Barro Industries OPC')}</div>
      <div class="s">Attn: ${e(p.requestingDept || 'Purchasing')} Department</div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th style="width:32px">#</th><th>Item / Description</th>
      <th style="width:60px">Qty</th><th style="width:64px">Unit</th>
      <th style="width:100px">Unit Price</th><th style="width:110px">Line Total</th>
    </tr></thead>
    <tbody>${rows}${blanks}</tbody>
    <tfoot><tr><td colspan="5" class="r">TOTAL (PHP)</td><td class="r">₱${fmt(total)}</td></tr></tfoot>
  </table>
  ${p.notes ? `<div class="note"><b>Notes:</b> ${e(p.notes)}</div>` : ''}
  <div class="terms">
    <h4>Terms &amp; Conditions</h4>
    <p>Please supply the items listed above at the agreed prices. Reference this PO number on your delivery receipt and invoice. Deliver to the address above on or before the date indicated. Any discrepancy in quantity, price, or specification must be confirmed in writing before fulfilment.</p>
  </div>
  ${_lh ? _lh.footerHTML : `
  <div class="sign">
    <div class="sline"><b>${e(preparedBy)}</b>Prepared by — Purchasing</div>
    <div class="sline"><b>${e(_sig.name)}</b>Approved by — ${e(_sig.title)}</div>
  </div>
  <div class="foot">Barro Industries Operating System · Generated ${new Date().toLocaleString('en-PH')}</div>`}
</div>
</body></html>`;

  const win = window.open('', '_blank', 'width=900,height=720');
  if (!win) { Notifs.showToast('Allow pop-ups to open the printable PO', 'error'); return; }
  win.document.write(html); win.document.close();
}
