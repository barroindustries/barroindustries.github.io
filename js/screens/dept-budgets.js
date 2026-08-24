/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Department Budgets
   js/screens/dept-budgets.js

   DEPT-BUDGETS-SPEC-2026-08-11 — release / spend / confirm / reimburse.

   New collections (root, deliberately NOT prefixed budgets_ or files_ — see
   firestore.rules for the union-permit trap this dodges):
     dept_budget_releases  — the money-truth. Finance releases a CASH FLOAT
                              (posts to the ledger immediately) or a CEILING
                              (memo only; every confirmed spend against it
                              becomes a reimbursement).
     dept_budget_requests  — a department asking Finance for a release.
     dept_spend_logs       — a department member's logged spend, with proof.
                              Reduces the dept's own remaining balance the
                              instant it is logged; posts to /ledger only when
                              Finance confirms it.

   Departments NEVER write /ledger directly — every ledger posting here goes
   through window.Ledger (finance-ledger.js) with a deterministic ref, so a
   double-tap/retry/re-confirm cannot post twice:
     DBR-<releaseId>       float release → cash out, asset leg
     DSP-<spendId>          confirmed spend → expense leg (always)
     DSP-<spendId>-FLT      confirmed spend → float drawdown (float only)
     DSP-<spendId>-PAY      confirmed spend → reimbursement payable (ceiling:
                             full amount; float: only the over-float excess)
     DRP-<spendId>          reimbursement paid → payable settled
     DBC-<releaseId>        float closed → unspent cash returned

   File-scope bindings use `var`/`function` only — never top-level const/let
   (a second evaluation of a classic script must not throw).

   Cross-file calls (window.renderBudgeting, window.Ledger, Drive, Notifs,
   escHtml, fmt, today, openPage, busy, confirmDialog, promptDialog,
   chipTabs/bindChipTabs, sopPanel, BankAccounts, vatFieldHTML/readVatField,
   isPresident, onClickSafe) resolve at click/render time — the standard
   runtime forward-reference convention this codebase uses throughout
   (index.html's load-order comments). Loaded after departments.js and
   finance-ledger.js (index.html), so all of the above are already defined by
   the time any handler in this file actually runs.
   ═══════════════════════════════════════════════════ */

'use strict';

// Departments that get Budgeting (§8 rollout). Ventures (documentation-only by
// design), Brilliant Steel and Partners (external) are excluded — owner-
// confirmed (spec §13.4). Admin gets a signpost row, not chip tabs, but IS
// eligible to receive a release (Finance's own operating budget is 'Finance'
// itself, picked inside this same surface).
var DEPT_BUDGET_ELIGIBLE = ['Admin','Finance','HR','Sales','CRM','Marketing',
  'Government Biddings','IT','Design','Production','Purchasing'];

function _dbUserName(currentUser) {
  return (typeof userProfile !== 'undefined' && userProfile && userProfile.displayName) || currentUser.email || '';
}

// Members of `dept` — string `department` OR array `departments` — same
// two-query merge Notifs.sendToDept uses, so "who can be a custodian" can
// never disagree with "who gets the release notification".
async function _dbFetchDeptMembers(dept) {
  const [s1, s2] = await Promise.all([
    db.collection('users').where('department', '==', dept).get().catch(() => ({ docs: [] })),
    db.collection('users').where('departments', 'array-contains', dept).get().catch(() => ({ docs: [] }))
  ]);
  const seen = new Set(), out = [];
  [...s1.docs, ...s2.docs].forEach(d => { if (seen.has(d.id)) return; seen.add(d.id); out.push({ id: d.id, ...d.data() }); });
  return out.sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''));
}

function _dbEsc(s) { return (window.escHtml || escHtml)(s); }

// ── Ledger row builders (spec §5 — plain-word account names, owner-bound) ──
function _dbFloatReleaseEntry(rel) {
  return {
    ref: `DBR-${rel.id}`, date: rel.date || today(), kind: 'debit',
    accountType: 'asset', account: `Cash Float — ${rel.dept}`, category: `Cash Float — ${rel.dept}`,
    description: `Cash float released to ${rel.custodianName || ''} — ${rel.title || ''}`,
    amount: rel.amount, dept: rel.dept, source: 'Finance',
    extra: { ...(window.BankAccounts ? window.BankAccounts.tag(
      { bankAccountId: rel.bankAccountId, bankAccountName: rel.bankAccountName }, 'out') : {}) }
  };
}

// ══════════════════════════════════════════════════
//  §6.2 — Log a Spend (department members + Finance tier)
// ══════════════════════════════════════════════════
window.openLogSpendForm = function(dept, releases, lines, onDone) {
  const active = (releases || []).filter(r => r.status === 'active');
  if (!active.length) {
    Notifs.showToast('No active budget for this department yet — file a budget request instead.', 'error');
    return;
  }
  const lineOptions = (lines || []).map(l => `<option value="${l.id}" data-name="${_dbEsc(l.name)}">${_dbEsc(l.name)}</option>`).join('');
  const relOptions = active.map(r => {
    const kindTag = r.type === 'float' ? ' (cash float)' : ' (spending limit)';
    return `<option value="${r.id}" ${active.length === 1 ? 'selected' : ''}>${_dbEsc(r.title)} — ₱${fmt(Math.max(r._remaining, 0))} left${kindTag}</option>`;
  }).join('');

  const _panel = openPage(`Log a Spend — ${dept}`, `
    <div class="form-group">
      <label>Release</label>
      <select id="ls-release" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        ${relOptions}
      </select>
      <div id="ls-context" style="font-size:12px;color:var(--text-muted);margin-top:4px"></div>
    </div>
    <div id="ls-overspend-warning"></div>
    <div class="form-row">
      <div class="form-group"><label>Date</label><input id="ls-date" type="date" value="${today()}"/></div>
      <div class="form-group"><label>Amount ₱</label><input id="ls-amount" type="number" step="0.01" min="0" inputmode="decimal"/></div>
    </div>
    <div class="form-group"><label>Description</label><input id="ls-desc" placeholder="e.g. Facebook Ads payment"/></div>
    <div class="form-row">
      <div class="form-group"><label>Budget Line (optional)</label>
        <select id="ls-line" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="">— None / General —</option>
          ${lineOptions}
        </select>
      </div>
      <div class="form-group"><label>Reference # (optional)</label><input id="ls-ref" placeholder="OR #, Invoice #…"/></div>
    </div>
    <div class="form-group">
      <label>Receipt / proof</label>
      <input id="ls-files" type="file" multiple accept="image/*,.pdf"/>
      <div id="ls-file-list" style="font-size:12px;color:var(--text-muted);margin-top:4px"></div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
      <input type="checkbox" id="ls-noreceipt"/>
      <label for="ls-noreceipt" style="margin:0">No receipt available</label>
    </div>
    <div id="ls-noreceipt-wrap" style="display:none;margin-top:8px">
      <div class="form-group"><label>Why is there no receipt?</label><textarea id="ls-noreceipt-reason" rows="2"></textarea></div>
      <div style="font-size:11px;color:var(--warning,#ff9f0a)">Spends without a receipt are flagged to Finance and may be questioned.</div>
    </div>
  `, `<button class="btn-primary" id="ls-save-btn">Save Spend</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const $ = (id) => _panel.querySelector('#' + id);
  const relById = (id) => active.find(r => r.id === id);

  const updateContext = () => {
    const rel = relById($('ls-release').value);
    const ctx = $('ls-context');
    if (!rel) { ctx.innerHTML = ''; return; }
    ctx.innerHTML = rel.type === 'float'
      ? `${emojiIcon('💵',14)} This is company cash held by ${_dbEsc(rel.custodianName || '—')}.`
      : `${emojiIcon('🧾',14)} You're spending your own money — Finance pays you back after confirming.`;
  };
  const updateOverspend = () => {
    const rel = relById($('ls-release').value);
    const amount = parseFloat($('ls-amount').value) || 0;
    const warn = $('ls-overspend-warning');
    if (!rel || amount <= 0 || amount <= Math.max(rel._remaining, 0)) { warn.innerHTML = ''; return; }
    const over = amount - Math.max(rel._remaining, 0);
    warn.innerHTML = `<div style="background:rgba(255,0,0,0.08);border:1px solid var(--danger);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--danger);margin-bottom:8px">
      ⚠ Over budget — this takes '${_dbEsc(rel.title)}' ₱${fmt(over)} past its limit. It will still be recorded, and Finance will see it flagged.
    </div>`;
  };
  $('ls-release').addEventListener('change', () => { updateContext(); updateOverspend(); });
  $('ls-amount').addEventListener('input', updateOverspend);
  updateContext(); updateOverspend();

  let pickedFiles = [];
  $('ls-files').addEventListener('change', (e) => {
    pickedFiles = Array.from(e.target.files || []);
    $('ls-file-list').textContent = pickedFiles.map(f => f.name).join(', ');
  });
  $('ls-noreceipt').addEventListener('change', (e) => {
    $('ls-noreceipt-wrap').style.display = e.target.checked ? '' : 'none';
  });

  $('ls-save-btn').addEventListener('click', () => window.busy($('ls-save-btn'), async () => {
    const rel = relById($('ls-release').value);
    const desc = $('ls-desc').value.trim();
    const amount = parseFloat($('ls-amount').value) || 0;
    const noReceipt = $('ls-noreceipt').checked;
    const noReceiptReason = $('ls-noreceipt-reason').value.trim();
    if (!rel) { Notifs.showToast('Select a release', 'error'); return; }
    if (!desc) { Notifs.showToast('Enter a description', 'error'); return; }
    if (!amount || amount <= 0) { Notifs.showToast('Enter an amount', 'error'); return; }
    if (!pickedFiles.length && !(noReceipt && noReceiptReason)) {
      Notifs.showToast('Attach the receipt or explain why there isn\'t one', 'error'); return;
    }
    const overBudget = amount > Math.max(rel._remaining, 0);
    if (overBudget) {
      const ok = await confirmDialog({ message: 'This spend is over budget. Record it anyway?', danger: true });
      if (!ok) return;
    }
    let attachments = [];
    if (pickedFiles.length) {
      try {
        for (const f of pickedFiles) {
          const r = await Drive.uploadFile(f, 'Finance', 'BudgetProofs');
          attachments.push({ name: r.name, url: r.url, path: r.id });
        }
      } catch (err) {
        Notifs.showToast(Drive.uploadErrorMessage ? Drive.uploadErrorMessage(err, 'file') : 'Upload failed — please try again.', 'error');
        return; // abort — keep the form open, nothing written
      }
    }
    const lineSel = $('ls-line');
    const lineId = lineSel.value || null;
    const lineName = lineId ? (lineSel.options[lineSel.selectedIndex].dataset.name || null) : null;
    const uName = _dbUserName(currentUser);
    const doc = {
      dept, releaseId: rel.id, releaseTitle: rel.title,
      date: $('ls-date').value || today(),
      description: desc, amount,
      budgetLineId: lineId, budgetLineName: lineName,
      refNumber: $('ls-ref').value.trim() || null,
      attachments, noReceipt, noReceiptReason: noReceipt ? noReceiptReason : '',
      paidByUid: currentUser.uid, paidByName: uName,
      overspendAtLog: overBudget,
      status: 'pending',
      loggedBy: currentUser.uid, loggedByName: uName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: null,
      decidedBy: null, decidedByName: null, decidedAt: null, rejectReason: null,
      ledgerRefs: null, reimbStatus: null, reimbAmount: null,
      reimbPaidAt: null, reimbPaidBy: null, reimbLedgerRef: null
    };
    await db.collection('dept_spend_logs').add(doc);
    await Notifs.sendToDept('Finance', {
      title: `💸 ${dept} logged a spend`,
      body: `${uName}: ${desc} — ₱${window.fmtN2(amount)}${overBudget ? ` · OVER BUDGET by ₱${window.fmtN2(amount - Math.max(rel._remaining, 0))}` : ''}${noReceipt ? ' · NO RECEIPT' : ''}`,
      type: 'budget_spend', link: 'dept:Finance'
    }).catch(() => {});
    closeModal();
    Notifs.success('Spend logged — Finance will confirm it. Your remaining balance is updated now.');
    onDone && onDone();
  }));
};

// Edit & resubmit — same form shape, prefilled, updates the existing doc.
window.openEditSpendForm = function(spend, releases, lines, onDone) {
  const active = (releases || []).filter(r => r.status === 'active' || r.id === spend.releaseId);
  const lineOptions = (lines || []).map(l => `<option value="${l.id}" data-name="${_dbEsc(l.name)}" ${l.id===spend.budgetLineId?'selected':''}>${_dbEsc(l.name)}</option>`).join('');
  const relOptions = active.map(r => `<option value="${r.id}" ${r.id===spend.releaseId?'selected':''}>${_dbEsc(r.title)} — ₱${fmt(Math.max(r._remaining,0))} left${r.type==='float'?' (cash float)':' (spending limit)'}</option>`).join('');
  const existing = spend.attachments || [];

  const _panel = openPage('Edit & Resubmit Spend', `
    <div class="form-group"><label>Release</label>
      <select id="es-release" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${relOptions}</select>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Date</label><input id="es-date" type="date" value="${spend.date||today()}"/></div>
      <div class="form-group"><label>Amount ₱</label><input id="es-amount" type="number" step="0.01" min="0" inputmode="decimal" value="${spend.amount||0}"/></div>
    </div>
    <div class="form-group"><label>Description</label><input id="es-desc" value="${_dbEsc(spend.description||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Budget Line (optional)</label>
        <select id="es-line" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="">— None / General —</option>${lineOptions}
        </select></div>
      <div class="form-group"><label>Reference # (optional)</label><input id="es-ref" value="${_dbEsc(spend.refNumber||'')}"/></div>
    </div>
    <div class="form-group">
      <label>Existing attachments</label>
      <div id="es-existing">${existing.map((a,i)=>`<div data-i="${i}" style="display:flex;align-items:center;gap:6px;font-size:12px"><a href="${safeHttpUrl(a.url)}" target="_blank" rel="noopener">${_dbEsc(a.name)}</a><button type="button" class="btn-link es-remove-att" data-i="${i}">✕</button></div>`).join('') || '<span style="font-size:12px;color:var(--text-muted)">None</span>'}</div>
    </div>
    <div class="form-group"><label>Add more proof</label>
      <input id="es-files" type="file" multiple accept="image/*,.pdf"/>
      <div id="es-file-list" style="font-size:12px;color:var(--text-muted);margin-top:4px"></div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
      <input type="checkbox" id="es-noreceipt" ${spend.noReceipt?'checked':''}/>
      <label for="es-noreceipt" style="margin:0">No receipt available</label>
    </div>
    <div id="es-noreceipt-wrap" style="display:${spend.noReceipt?'':'none'};margin-top:8px">
      <div class="form-group"><label>Why is there no receipt?</label><textarea id="es-noreceipt-reason" rows="2">${_dbEsc(spend.noReceiptReason||'')}</textarea></div>
    </div>
  `, `<button class="btn-primary" id="es-save-btn">Save &amp; Resubmit</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const $ = (id) => _panel.querySelector('#' + id);
  let removedIdx = new Set();
  let addedFiles = [];
  $('es-existing').querySelectorAll('.es-remove-att').forEach(btn => btn.addEventListener('click', () => {
    removedIdx.add(+btn.dataset.i);
    btn.closest('div[data-i]').style.display = 'none';
  }));
  $('es-files').addEventListener('change', (e) => {
    addedFiles = Array.from(e.target.files || []);
    $('es-file-list').textContent = addedFiles.map(f => f.name).join(', ');
  });
  $('es-noreceipt').addEventListener('change', (e) => { $('es-noreceipt-wrap').style.display = e.target.checked ? '' : 'none'; });

  $('es-save-btn').addEventListener('click', () => window.busy($('es-save-btn'), async () => {
    const desc = $('es-desc').value.trim();
    const amount = parseFloat($('es-amount').value) || 0;
    const noReceipt = $('es-noreceipt').checked;
    const noReceiptReason = $('es-noreceipt-reason').value.trim();
    if (!desc) { Notifs.showToast('Enter a description', 'error'); return; }
    if (!amount || amount <= 0) { Notifs.showToast('Enter an amount', 'error'); return; }
    let attachments = existing.filter((_, i) => !removedIdx.has(i));
    if (!attachments.length && addedFiles.length === 0 && !(noReceipt && noReceiptReason)) {
      Notifs.showToast('Attach the receipt or explain why there isn\'t one', 'error'); return;
    }
    if (addedFiles.length) {
      try {
        for (const f of addedFiles) {
          const r = await Drive.uploadFile(f, 'Finance', 'BudgetProofs');
          attachments.push({ name: r.name, url: r.url, path: r.id });
        }
      } catch (err) {
        Notifs.showToast(Drive.uploadErrorMessage ? Drive.uploadErrorMessage(err, 'file') : 'Upload failed — please try again.', 'error');
        return;
      }
    }
    if (!attachments.length && !(noReceipt && noReceiptReason)) {
      Notifs.showToast('Attach the receipt or explain why there isn\'t one', 'error'); return;
    }
    const lineSel = $('es-line');
    const lineId = lineSel.value || null;
    const lineName = lineId ? (lineSel.options[lineSel.selectedIndex].dataset.name || null) : null;
    const relId = $('es-release').value;
    const relTitleOpt = $('es-release').options[$('es-release').selectedIndex];
    await db.collection('dept_spend_logs').doc(spend.id).update({
      date: $('es-date').value || today(), description: desc, amount,
      budgetLineId: lineId, budgetLineName: lineName,
      refNumber: $('es-ref').value.trim() || null,
      attachments, noReceipt, noReceiptReason: noReceipt ? noReceiptReason : '',
      overspendAtLog: false, releaseId: relId, releaseTitle: relTitleOpt ? relTitleOpt.textContent.split(' — ')[0] : spend.releaseTitle,
      status: 'pending', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeModal();
    Notifs.success('Spend resubmitted — Finance will confirm it.');
    onDone && onDone();
  }));
};

// ══════════════════════════════════════════════════
//  §7 — Request a Budget
// ══════════════════════════════════════════════════
window.openBudgetRequestForm = function(dept, onDone) {
  const _panel = openPage(`Request a Budget — ${dept}`, `
    <div class="form-group"><label>What is it for</label><input id="br-title" placeholder="e.g. Trade show booth"/></div>
    <div class="form-group"><label>Amount ₱</label><input id="br-amount" type="number" step="0.01" min="0" inputmode="decimal"/></div>
    <div class="form-group"><label>Details</label><textarea id="br-reason" rows="4" placeholder="Why this is needed, timing, breakdown…"></textarea></div>
    <div class="form-group"><label>Supporting documents (optional)</label>
      <input id="br-files" type="file" multiple accept="image/*,.pdf"/>
      <div id="br-file-list" style="font-size:12px;color:var(--text-muted);margin-top:4px"></div>
    </div>
  `, `<button class="btn-primary" id="br-save-btn">Send Request</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const $ = (id) => _panel.querySelector('#' + id);
  let pickedFiles = [];
  $('br-files').addEventListener('change', (e) => {
    pickedFiles = Array.from(e.target.files || []);
    $('br-file-list').textContent = pickedFiles.map(f => f.name).join(', ');
  });

  $('br-save-btn').addEventListener('click', () => window.busy($('br-save-btn'), async () => {
    const title = $('br-title').value.trim();
    const amount = parseFloat($('br-amount').value) || 0;
    const reason = $('br-reason').value.trim();
    if (!title) { Notifs.showToast('Enter what this is for', 'error'); return; }
    if (!amount || amount <= 0) { Notifs.showToast('Enter an amount', 'error'); return; }
    if (!reason) { Notifs.showToast('Enter the details', 'error'); return; }
    let attachments = [];
    if (pickedFiles.length) {
      try {
        for (const f of pickedFiles) {
          const r = await Drive.uploadFile(f, 'Finance', 'BudgetProofs');
          attachments.push({ name: r.name, url: r.url, path: r.id });
        }
      } catch (err) {
        Notifs.showToast(Drive.uploadErrorMessage ? Drive.uploadErrorMessage(err, 'file') : 'Upload failed — please try again.', 'error');
        return;
      }
    }
    const uName = _dbUserName(currentUser);
    await db.collection('dept_budget_requests').add({
      dept, title, amount, reason, attachments,
      requestedBy: currentUser.uid, requestedByName: uName,
      status: 'pending', reviewedBy: null, reviewedByName: null, reviewNote: null,
      releaseId: null, createdAt: firebase.firestore.FieldValue.serverTimestamp(), decidedAt: null
    });
    await Notifs.sendToDept('Finance', {
      title: `🙋 ${dept} requests a budget`,
      body: `${uName}: ${title} — ₱${window.fmtN2(amount)}`,
      type: 'budget_request', link: 'dept:Finance'
    }).catch(() => {});
    closeModal();
    Notifs.success('Request sent to Finance.');
    onDone && onDone();
  }));
};

// ══════════════════════════════════════════════════
//  §6.3a — Release a Budget (Finance) — reused by Releases tab's
//  [+ Release Budget], renderBudgeting's finance-tier header button
//  (pre-set to that dept), and the Requests tab's Approve action
//  (prefilled dept/title/amount + linked requestId).
// ══════════════════════════════════════════════════
window.openReleaseBudgetForm = function(opts, onDone) {
  opts = opts || {};
  const deptOptions = DEPT_BUDGET_ELIGIBLE.map(d => `<option value="${_dbEsc(d)}" ${d===opts.dept?'selected':''}>${_dbEsc(d)}</option>`).join('');

  const _panel = openPage('Release a Budget', `
    <div class="form-group"><label>Department</label>
      <select id="rb-dept" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${deptOptions}</select>
    </div>
    <div class="form-group"><label>Type</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label class="rb-type-card" data-type="float" style="flex:1;min-width:220px;border:1.5px solid var(--border);border-radius:12px;padding:12px;cursor:pointer;display:block">
          <input type="radio" name="rb-type" value="float" checked style="margin-right:6px"/>
          ${emojiIcon('💵',16)} Cash float — we hand the money to a custodian now. Posts to the books as cash out into 'Cash Float — &lt;Dept&gt;'.
        </label>
        <label class="rb-type-card" data-type="ceiling" style="flex:1;min-width:220px;border:1.5px solid var(--border);border-radius:12px;padding:12px;cursor:pointer;display:block">
          <input type="radio" name="rb-type" value="ceiling" style="margin-right:6px"/>
          ${emojiIcon('🧾',16)} Spending limit — no cash moves now. People pay out of pocket and are reimbursed per confirmed receipt.
        </label>
      </div>
    </div>
    <div class="form-group"><label>Title</label><input id="rb-title" value="${_dbEsc(opts.title||'')}" placeholder="e.g. Q3 campaign budget"/></div>
    <div class="form-group"><label>Amount ₱</label><input id="rb-amount" type="number" step="0.01" min="0" inputmode="decimal" value="${opts.amount||''}"/></div>
    <div id="rb-float-fields">
      <div class="form-group"><label>Custodian</label>
        <select id="rb-custodian" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"><option value="">Loading…</option></select>
      </div>
      <div class="form-group"><label>Bank account (optional)</label>
        <select id="rb-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"><option value="">— no account —</option></select>
      </div>
    </div>
    <div class="form-group"><label>Note (optional)</label><textarea id="rb-note" rows="2"></textarea></div>
  `, `<button class="btn-primary" id="rb-save-btn">Save Release</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const $ = (id) => _panel.querySelector('#' + id);

  const paintTypeCards = () => {
    _panel.querySelectorAll('.rb-type-card').forEach(card => {
      const on = card.querySelector('input').checked;
      card.style.borderColor = on ? 'var(--primary)' : 'var(--border)';
      card.style.background = on ? 'var(--surface2)' : '';
    });
    $('rb-float-fields').style.display = ($('rb-custodian') && _panel.querySelector('input[name=rb-type]:checked').value === 'float') ? '' : 'none';
  };
  _panel.querySelectorAll('input[name=rb-type]').forEach(r => r.addEventListener('change', paintTypeCards));
  paintTypeCards();

  async function loadCustodians() {
    const dept = $('rb-dept').value;
    const sel = $('rb-custodian');
    sel.innerHTML = '<option value="">Loading…</option>';
    const members = await _dbFetchDeptMembers(dept);
    sel.innerHTML = '<option value="">— select —</option>' +
      members.map(m => `<option value="${m.id}" data-name="${_dbEsc(m.displayName||m.email||'')}">${_dbEsc(m.displayName||m.email||'')}</option>`).join('');
  }
  async function loadBanks() {
    const sel = $('rb-bank');
    sel.innerHTML = await (window.BankAccounts ? window.BankAccounts.optionsHTML() : Promise.resolve('<option value="">— no account —</option>'));
  }
  loadCustodians(); loadBanks();
  $('rb-dept').addEventListener('change', loadCustodians);

  $('rb-save-btn').addEventListener('click', () => window.busy($('rb-save-btn'), async () => {
    const dept = $('rb-dept').value;
    const type = _panel.querySelector('input[name=rb-type]:checked').value;
    const title = $('rb-title').value.trim();
    const amount = parseFloat($('rb-amount').value) || 0;
    const note = $('rb-note').value.trim();
    if (!dept) { Notifs.showToast('Select a department', 'error'); return; }
    if (!title) { Notifs.showToast('Enter a title', 'error'); return; }
    if (!amount || amount <= 0) { Notifs.showToast('Enter an amount', 'error'); return; }
    let custodianUid = null, custodianName = null;
    if (type === 'float') {
      const custSel = $('rb-custodian');
      custodianUid = custSel.value || '';
      if (!custodianUid) { Notifs.showToast('Select a custodian for a cash float', 'error'); return; }
      custodianName = custSel.options[custSel.selectedIndex].dataset.name || '';
    }
    // Approving a request creates a release AND decides the request in one
    // flow — a fresh re-read guards the two-Finance-users-same-request race
    // (unlike the ledger legs below, .add()-ing a second release doc has no
    // ref to dedupe on).
    if (opts.requestId) {
      const freshReq = await db.collection('dept_budget_requests').doc(opts.requestId).get();
      if (!freshReq.exists || freshReq.data().status !== 'pending') {
        Notifs.showToast('This request was already decided by someone else.', 'info');
        closeModal(); onDone && onDone(); return;
      }
    }
    const bankId = $('rb-bank').value || null;
    const bankPick = bankId && window.BankAccounts ? await window.BankAccounts.pick(bankId) : { bankAccountId: null, bankAccountName: null };
    const uName = _dbUserName(currentUser);

    const relRef = await db.collection('dept_budget_releases').add({
      dept, type, title, amount, note,
      date: today(), status: 'active',
      custodianUid, custodianName,
      bankAccountId: type === 'float' ? bankPick.bankAccountId : null,
      bankAccountName: type === 'float' ? bankPick.bankAccountName : null,
      requestId: opts.requestId || null,
      releasedBy: currentUser.uid, releasedByName: uName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      confirmedTotal: 0,
      closedAt: null, closedBy: null, returnedAmount: null,
      ledgerRef: null
    });

    if (type === 'float') {
      try {
        await window.Ledger.upsertByRef(`DBR-${relRef.id}`, () => _dbFloatReleaseEntry({
          id: relRef.id, dept, title, amount, date: today(), custodianName,
          bankAccountId: bankPick.bankAccountId, bankAccountName: bankPick.bankAccountName
        }));
        await relRef.update({ ledgerRef: `DBR-${relRef.id}` });
      } catch (e) {
        Notifs.showToast('Release saved but could not post to the ledger yet — reopen it from Releases and tap Repost.', 'error');
      }
    }

    if (opts.requestId) {
      await db.collection('dept_budget_requests').doc(opts.requestId).update({
        status: 'approved', releaseId: relRef.id,
        reviewedBy: currentUser.uid, reviewedByName: uName,
        decidedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await Notifs.send(opts.requestedBy || '', {
        title: '✅ Budget request approved',
        body: `${title} — released as a ${type === 'float' ? 'cash float' : 'spending limit'} of ₱${fmt(amount)}.`
      }).catch(() => {});
    }

    await Notifs.sendToDept(dept, {
      title: `💰 Budget released to ${dept}`,
      body: type === 'float'
        ? `₱${fmt(amount)} cash float — ${title}. Custodian: ${custodianName}.`
        : `₱${fmt(amount)} spending limit — ${title}. Pay first, then log receipts for reimbursement.`,
      type: 'budget_release', link: `dept:${dept}`
    }).catch(() => {});

    closeModal();
    Notifs.success('Budget released.');
    onDone && onDone();
  }));
};

// Re-run the same deterministic post for a float release whose initial post
// failed — the ref makes the retry safe (no duplicate row).
window.repostFloatRelease = async function(rel, onDone) {
  try {
    await window.Ledger.upsertByRef(`DBR-${rel.id}`, () => _dbFloatReleaseEntry(rel));
    await db.collection('dept_budget_releases').doc(rel.id).update({ ledgerRef: `DBR-${rel.id}` });
    Notifs.success('Posted to the ledger.');
    onDone && onDone();
  } catch (e) {
    Notifs.showToast('Still could not post: ' + (e.message || e), 'error');
  }
};

// ══════════════════════════════════════════════════
//  §6.3e — Close a float
// ══════════════════════════════════════════════════
window.openCloseFloatModal = async function(rel, onDone) {
  const pendingSnap = await db.collection('dept_spend_logs')
    .where('releaseId', '==', rel.id).where('status', '==', 'pending').get().catch(() => ({ docs: [] }));
  if (pendingSnap.docs.length) {
    Notifs.showToast(`${pendingSnap.docs.length} spend(s) still awaiting confirmation — decide them first.`, 'error');
    return;
  }
  const confirmedTotal = rel.confirmedTotal || 0;
  const Z = Math.max((rel.amount || 0) - confirmedTotal, 0);
  const owedExcess = Math.max(confirmedTotal - (rel.amount || 0), 0);

  const _panel = openPage(`Close Float — ${_dbEsc(rel.title)}`, `
    <div style="font-size:13px;line-height:1.8">
      Released ₱${fmt(rel.amount)} · Confirmed spends ₱${fmt(confirmedTotal)} · Float balance ₱${fmt(Z)}
    </div>
    ${owedExcess > 0 ? `<div style="margin-top:8px;padding:8px 12px;background:rgba(255,0,0,0.08);border-radius:8px;font-size:12px;color:var(--danger)">₱${fmt(owedExcess)} of the overspend is owed to whoever fronted it — settle it under Reimbursements.</div>` : ''}
    ${Z > 0 ? `<div class="form-group" style="margin-top:12px"><label>Bank account (return of cash)</label>
      <select id="cf-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"><option value="">Loading…</option></select>
    </div>` : ''}
  `, `<button class="btn-primary" id="cf-save-btn">${Z > 0 ? 'Confirm Return &amp; Close' : 'Close Float'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const $ = (id) => _panel.querySelector('#' + id);
  if (Z > 0 && window.BankAccounts) $('cf-bank').innerHTML = await window.BankAccounts.optionsHTML();

  $('cf-save-btn').addEventListener('click', () => window.busy($('cf-save-btn'), async () => {
    if (Z > 0) {
      const bankId = $('cf-bank') ? $('cf-bank').value : '';
      if (!bankId) { Notifs.showToast('Select the bank account the cash is returned to', 'error'); return; }
      const ok = await confirmDialog({ message: `Custodian returns ₱${fmt(Z)}?` });
      if (!ok) return;
      const bankPick = await window.BankAccounts.pick(bankId);
      try {
        await window.Ledger.upsertByRef(`DBC-${rel.id}`, () => ({
          ref: `DBC-${rel.id}`, date: today(), kind: 'credit',
          accountType: 'asset', account: `Cash Float — ${rel.dept}`, category: `Cash Float — ${rel.dept}`,
          description: `Float returned by ${rel.custodianName || ''} — ${rel.title || ''}`,
          amount: Z, dept: rel.dept, source: 'Finance',
          extra: { ...window.BankAccounts.tag(bankPick, 'in') }
        }));
      } catch (e) {
        Notifs.showToast('Could not post the return to the ledger: ' + (e.message || e), 'error');
        return;
      }
    }
    await db.collection('dept_budget_releases').doc(rel.id).update({
      status: 'closed', closedAt: firebase.firestore.FieldValue.serverTimestamp(),
      closedBy: currentUser.uid, returnedAmount: Z
    });
    closeModal();
    Notifs.success('Float closed.');
    onDone && onDone();
  }));
};

// ══════════════════════════════════════════════════
//  §6.3b — Review / Confirm / Reject a spend
// ══════════════════════════════════════════════════
async function _dbOpenSpendReview(spend, currentRole, onDone) {
  const relSnap = await db.collection('dept_budget_releases').doc(spend.releaseId).get();
  const rel = relSnap.exists ? { id: relSnap.id, ...relSnap.data() } : null;

  let splitPreview = '';
  if (rel) {
    if (rel.type === 'float') {
      const floatRemaining = Math.max((rel.amount || 0) - (rel.confirmedTotal || 0), 0);
      const floatPortion = Math.min(spend.amount, floatRemaining);
      const payablePortion = spend.amount - floatPortion;
      splitPreview = `₱${fmt(floatPortion)} from the float` + (payablePortion > 0 ? ` · ₱${fmt(payablePortion)} becomes owed to ${_dbEsc(spend.paidByName)} (float exceeded)` : '');
    } else {
      splitPreview = `₱${fmt(spend.amount)} becomes owed to ${_dbEsc(spend.paidByName)} once confirmed`;
    }
  }

  const attHtml = (spend.attachments || []).map(a => `<a href="${safeHttpUrl(a.url)}" target="_blank" rel="noopener" style="display:block;font-size:12px">${_dbEsc(a.name)}</a>`).join('') || '<span style="font-size:12px;color:var(--text-muted)">None</span>';

  const _panel = openPage('Review Spend', `
    <div style="font-size:13px;line-height:1.9">
      <div><strong>${_dbEsc(spend.dept)}</strong> — ${_dbEsc(spend.description)}</div>
      <div>Amount: ₱${fmt(spend.amount)} · Date: ${_dbEsc(spend.date)}</div>
      <div>Logged by: ${_dbEsc(spend.loggedByName)} · Paid by: ${_dbEsc(spend.paidByName)}</div>
      <div>Release: ${_dbEsc(spend.releaseTitle)} (${rel ? (rel.type === 'float' ? 'cash float' : 'spending limit') : '—'})</div>
      ${spend.overspendAtLog ? `<div style="color:var(--danger)">${emojiIcon('🔺',14)} Over budget when logged</div>` : ''}
      ${spend.noReceipt ? `<div style="color:var(--danger)">${emojiIcon('🚩',14)} No receipt — reason: ${_dbEsc(spend.noReceiptReason)}</div>` : ''}
      ${splitPreview ? `<div style="margin-top:8px;padding:8px 12px;background:var(--surface2);border-radius:8px">${splitPreview}</div>` : ''}
    </div>
    <div class="form-group" style="margin-top:10px"><label>Attachments</label>${attHtml}</div>
    <div id="dsp-vat-wrap">${window.vatFieldHTML ? window.vatFieldHTML('dsp-vat', 'exempt') : ''}</div>
  `, `<button class="btn-primary" id="dsp-confirm-btn">Confirm &amp; Post to Ledger</button><button class="btn-danger" id="dsp-reject-btn">Reject</button><button class="btn-secondary" onclick="closeModal()">Close</button>`);

  const $ = (id) => _panel.querySelector('#' + id);

  $('dsp-confirm-btn').addEventListener('click', () => window.busy($('dsp-confirm-btn'), async () => {
    try {
      await _dbConfirmSpend(spend, currentRole);
    } catch (e) {
      if (String((e && e.message) || '').indexOf('period-closed:') === 0) {
        Notifs.showToast('That month is closed — reopen the period or fix the spend date first.', 'error');
      } else if ((e && e.message) === 'already-decided') {
        Notifs.showToast('Already handled by someone else.', 'info');
        closeModal();
        onDone && onDone();
      } else {
        Notifs.showToast('Could not confirm: ' + (e.message || e), 'error');
      }
      return;
    }
    closeModal();
    Notifs.success('Spend confirmed and posted.');
    onDone && onDone();
  }));

  $('dsp-reject-btn').addEventListener('click', () => window.busy($('dsp-reject-btn'), async () => {
    const reason = await promptDialog({ title: 'Reject Spend', message: 'Why is this spend being rejected?', required: true, multiline: true });
    if (reason == null) return;
    // Same replay guard as confirm — a stale Review page must not flip an
    // already-confirmed (ledger-posted) spend back to 'rejected'.
    const freshSnap = await db.collection('dept_spend_logs').doc(spend.id).get();
    if (!freshSnap.exists || freshSnap.data().status !== 'pending') {
      Notifs.showToast('Already handled by someone else.', 'info');
      closeModal(); onDone && onDone(); return;
    }
    const uName = _dbUserName(currentUser);
    await db.collection('dept_spend_logs').doc(spend.id).update({
      status: 'rejected', rejectReason: reason,
      decidedBy: currentUser.uid, decidedByName: uName,
      decidedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:dept_spend_logs-pending'); // PERF-WAVE1
    await Notifs.send(spend.loggedBy, {
      title: '❌ Spend rejected',
      body: `${spend.description} — ₱${window.fmtN2(spend.amount)}. Reason: ${reason}. Edit it and resubmit.`,
      type: 'budget_spend_result', link: `dept:${spend.dept}`
    }).catch(() => {});
    closeModal();
    Notifs.success('Spend rejected.');
    onDone && onDone();
  }));
}

// Confirm sequence (spec §6.3b) — order matters for idempotence:
//  0. re-read the SPEND fresh — a stale Review page (already confirmed/
//     rejected by someone else, e.g. two Finance users on the same queue) must
//     not re-post ledger legs (Ledger.postMulti dedupes those for free by ref)
//     NOR re-run the confirmedTotal increment, which is NOT itself ref-deduped
//     and would double-count a float drawdown that the ledger dedupe alone
//     would silently hide (no new row, but the release's own book still
//     moved). Aborting here is what makes "replaying it" in the spec's
//     verification checklist (§14.7) actually true rather than assumed.
//  1. re-read the release fresh, compute the float split.
//  2. Ledger.postMulti(legs) — one transaction, per-ref dedupe, period-checked.
//     Throws -> abort, spend stays pending (caller's catch handles the toast).
//  3. ONE db.batch(): spend -> confirmed (+ ledgerRefs/reimb fields), release ->
//     confirmedTotal += amount. A crash between 2 and 3 is safe: re-running
//     this re-posts (all refs exist -> no-op) then completes the batch.
//  4. notify the logger.
async function _dbConfirmSpend(spend, currentRole) {
  const freshSpendSnap = await db.collection('dept_spend_logs').doc(spend.id).get();
  if (!freshSpendSnap.exists) throw new Error('Spend not found');
  if (freshSpendSnap.data().status !== 'pending') {
    throw new Error('already-decided'); // someone else confirmed/rejected it first — no-op
  }

  const relSnap = await db.collection('dept_budget_releases').doc(spend.releaseId).get();
  if (!relSnap.exists) throw new Error('Release not found');
  const rel = { id: relSnap.id, ...relSnap.data() };

  const expenseRef = `DSP-${spend.id}`;
  const legs = [{
    ref: expenseRef, date: spend.date || today(), kind: 'debit',
    accountType: 'expense', account: `${spend.dept} Expense`, category: `${spend.dept} Expense`,
    description: spend.description, amount: spend.amount, dept: spend.dept, source: 'Finance',
    extra: {
      budgetLineId: spend.budgetLineId || null, budgetLineName: spend.budgetLineName || null,
      deptSpendId: spend.id,
      ...(window.readVatField ? window.readVatField('dsp-vat', spend.amount) : {})
    }
  }];

  let floatPortion = 0, payablePortion = 0;
  if (rel.type === 'float') {
    const floatRemaining = Math.max((rel.amount || 0) - (rel.confirmedTotal || 0), 0);
    floatPortion = Math.min(spend.amount, floatRemaining);
    payablePortion = spend.amount - floatPortion;
    if (floatPortion > 0) {
      legs.push({
        ref: `${expenseRef}-FLT`, date: spend.date || today(), kind: 'credit',
        accountType: 'asset', account: `Cash Float — ${spend.dept}`, category: `Cash Float — ${spend.dept}`,
        description: `Float drawdown — ${spend.description}`, amount: floatPortion, dept: spend.dept, source: 'Finance'
      });
    }
  } else {
    payablePortion = spend.amount;
  }
  if (payablePortion > 0) {
    legs.push({
      ref: `${expenseRef}-PAY`, date: spend.date || today(), kind: 'credit',
      accountType: 'liability', account: 'Reimbursement Payable', category: 'Reimbursement Payable',
      description: `Owed to ${spend.paidByName} — ${spend.description}`, amount: payablePortion, dept: spend.dept, source: 'Finance',
      extra: { payeeUid: spend.paidByUid, payeeName: spend.paidByName }
    });
  }

  await window.Ledger.postMulti(legs); // throws -> caller aborts, spend stays pending

  const uName = _dbUserName(currentUser);
  const vatFields = (window.readVatField ? window.readVatField('dsp-vat', spend.amount) : {});
  const spendUpdate = {
    status: 'confirmed', decidedBy: currentUser.uid, decidedByName: uName,
    decidedAt: firebase.firestore.FieldValue.serverTimestamp(),
    ledgerRefs: legs.map(l => l.ref), ...vatFields
  };
  if (payablePortion > 0) { spendUpdate.reimbStatus = 'owed'; spendUpdate.reimbAmount = payablePortion; }
  const batch = db.batch();
  batch.update(db.collection('dept_spend_logs').doc(spend.id), spendUpdate);
  batch.update(db.collection('dept_budget_releases').doc(rel.id), {
    confirmedTotal: firebase.firestore.FieldValue.increment(spend.amount)
  });
  await batch.commit();
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:dept_spend_logs-pending'); // PERF-WAVE1

  await Notifs.send(spend.loggedBy, {
    title: '✅ Spend confirmed',
    body: `${spend.description} — ₱${window.fmtN2(spend.amount)} is now in the books.` +
      (payablePortion > 0 ? ` Finance owes you ₱${fmt(payablePortion)} — reimbursement is on its way.` : ''),
    type: 'budget_spend_result'
  }).catch(() => {});
}

// ══════════════════════════════════════════════════
//  §6.3d — Mark a reimbursement paid
// ══════════════════════════════════════════════════
async function _dbOpenMarkPaidModal(spend, onDone) {
  const _panel = openPage('Mark Reimbursement Paid', `
    <div style="font-size:13px;margin-bottom:10px">${_dbEsc(spend.paidByName)} — ${_dbEsc(spend.description)} — ₱${fmt(spend.reimbAmount)}</div>
    <div class="form-group"><label>Bank account</label>
      <select id="mp-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"><option value="">Loading…</option></select>
    </div>
    <div class="form-group"><label>Date</label><input id="mp-date" type="date" value="${today()}"/></div>
  `, `<button class="btn-primary" id="mp-save-btn">Mark Paid</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const $ = (id) => _panel.querySelector('#' + id);
  if (window.BankAccounts) $('mp-bank').innerHTML = await window.BankAccounts.optionsHTML();

  $('mp-save-btn').addEventListener('click', () => window.busy($('mp-save-btn'), async () => {
    const bankId = $('mp-bank').value;
    if (!bankId) { Notifs.showToast('Select the paying bank account', 'error'); return; }
    const date = $('mp-date').value || today();
    const bankPick = await window.BankAccounts.pick(bankId);
    await window.Ledger.upsertByRef(`DRP-${spend.id}`, () => ({
      ref: `DRP-${spend.id}`, date, kind: 'debit',
      accountType: 'liability', account: 'Reimbursement Payable', category: 'Reimbursement Payable',
      description: `Reimbursed ${spend.paidByName} — ${spend.description}`,
      amount: spend.reimbAmount, dept: spend.dept, source: 'Finance',
      extra: { ...window.BankAccounts.tag(bankPick, 'out') }
    }));
    await db.collection('dept_spend_logs').doc(spend.id).update({
      reimbStatus: 'paid', reimbPaidAt: firebase.firestore.FieldValue.serverTimestamp(),
      reimbPaidBy: currentUser.uid, reimbLedgerRef: `DRP-${spend.id}`
    });
    await Notifs.send(spend.paidByUid, {
      title: '💵 Reimbursement paid',
      body: `₱${fmt(spend.reimbAmount)} for ${spend.description}.`
    }).catch(() => {});
    closeModal();
    Notifs.success('Reimbursement paid.');
    onDone && onDone();
  }));
}

// ══════════════════════════════════════════════════
//  §6.3c — Requests tab helpers
// ══════════════════════════════════════════════════
async function _dbDeclineRequest(req, onDone) {
  const note = await promptDialog({ title: 'Decline Request', message: 'Reason for declining?', required: true, multiline: true });
  if (note == null) return;
  // Same replay guard as the Approve path (openReleaseBudgetForm) — a second
  // Finance user's stale Requests tab must not decline an already-decided request.
  const freshReq = await db.collection('dept_budget_requests').doc(req.id).get();
  if (!freshReq.exists || freshReq.data().status !== 'pending') {
    Notifs.showToast('This request was already decided by someone else.', 'info');
    onDone && onDone(); return;
  }
  const uName = _dbUserName(currentUser);
  await db.collection('dept_budget_requests').doc(req.id).update({
    status: 'declined', reviewNote: note,
    reviewedBy: currentUser.uid, reviewedByName: uName,
    decidedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await Notifs.send(req.requestedBy, {
    title: '❌ Budget request declined',
    body: `${req.title}: ${note}`
  }).catch(() => {});
  onDone && onDone();
}

// ══════════════════════════════════════════════════
//  §6.3 — Finance surface: window.renderDeptBudgetsAdmin
// ══════════════════════════════════════════════════
window.renderDeptBudgetsAdmin = async function(content, currentUser2, currentRole) {
  content.innerHTML = window.skeletonHtml('rows');
  const [pendingSpendSnap, pendingReqSnap, owedSnap] = await Promise.all([
    db.collection('dept_spend_logs').where('status', '==', 'pending').get().catch(() => ({ docs: [] })),
    db.collection('dept_budget_requests').where('status', '==', 'pending').get().catch(() => ({ docs: [] })),
    db.collection('dept_spend_logs').where('reimbStatus', '==', 'owed').get().catch(() => ({ docs: [] }))
  ]);
  const initial = window.initialSubtab ? window.initialSubtab('to-confirm') : 'to-confirm';
  const tabs = [
    { key: 'to-confirm', label: 'To Confirm', count: pendingSpendSnap.docs.length },
    { key: 'releases', label: 'Releases' },
    { key: 'requests', label: 'Requests', count: pendingReqSnap.docs.length },
    { key: 'reimbursements', label: 'Reimbursements', count: owedSnap.docs.length }
  ];
  content.innerHTML = `
    ${window.sopPanel('How department budgets work', [
      'Finance releases a budget to a department — either a cash float (someone there is holding company cash) or a spending limit (they pay first, then get paid back).',
      'A logged spend appears in the department’s own view immediately; it reaches the company books once you confirm it here.',
      'Under a float the company has already paid — a confirmed spend only draws down the float. Under a ceiling the company has not paid — every confirmed spend creates a debt to the person who paid. Departments are never owed money; every payable is owed to a named person.'
    ])}
    ${window.chipTabs(tabs, initial)}
    <div id="dba-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [content] });
  const load = (key) => _dbLoadAdminTab(content, currentUser2, currentRole, key);
  load(initial);
  window.bindChipTabs(content, (key) => { window.setSubroute && window.setSubroute(key); load(key); });
};

async function _dbLoadAdminTab(content, currentUser, currentRole, sub) {
  const wrap = content.querySelector('#dba-content');
  if (!wrap) return;
  wrap.innerHTML = window.skeletonHtml('rows');

  if (sub === 'releases') {
    const [snap, liveSpendSnap] = await Promise.all([
      db.collection('dept_budget_releases').orderBy('createdAt', 'desc').get().catch(() => ({ docs: [] })),
      // Cross-dept — the same live-spend math renderBudgeting does per dept,
      // done once here across every release so "remaining"/"OVER BY" show in
      // the Finance list too (spec §6.3a: "each with remaining, custodian…").
      db.collection('dept_spend_logs').where('status', 'in', ['pending', 'confirmed']).get().catch(() => ({ docs: [] }))
    ]);
    const releases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const loggedByRelease = {};
    liveSpendSnap.docs.forEach(d => {
      const s = d.data();
      loggedByRelease[s.releaseId] = (loggedByRelease[s.releaseId] || 0) + (s.amount || 0);
    });
    releases.forEach(r => {
      r._logged = loggedByRelease[r.id] || 0;
      r._remaining = (r.amount || 0) - r._logged;
    });
    const depts = ['all', ...Array.from(new Set(releases.map(r => r.dept)))];
    let activeFilter = 'all';
    const paint = () => {
      const shown = activeFilter === 'all' ? releases : releases.filter(r => r.dept === activeFilter);
      wrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          ${window.chipTabs(depts.map(d => ({ key: d, label: d === 'all' ? 'All' : d })), activeFilter, { cls: 'dba-dept-filter' })}
          <button class="btn-primary btn-sm" id="dba-new-release-btn">${emojiIcon('➕',14)} Release Budget</button>
        </div>
        ${!shown.length ? window.renderEmptyState({icon:'💰',title:'No releases yet'}) : shown.map(r => _dbReleaseCardHtml(r, true)).join('')}
      `;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
      window.bindChipTabs(wrap.querySelector('.dba-dept-filter') || wrap, (key) => { activeFilter = key; paint(); });
      wrap.querySelector('#dba-new-release-btn')?.addEventListener('click', () => {
        window.openReleaseBudgetForm({}, () => _dbLoadAdminTab(content, currentUser, currentRole, 'releases'));
      });
      wrap.querySelectorAll('.dba-repost-btn').forEach(btn => onClickSafe(btn, async () => {
        const r = releases.find(x => x.id === btn.dataset.id);
        if (r) await window.repostFloatRelease(r, () => _dbLoadAdminTab(content, currentUser, currentRole, 'releases'));
      }));
      wrap.querySelectorAll('.dba-close-float-btn').forEach(btn => onClickSafe(btn, async () => {
        const r = releases.find(x => x.id === btn.dataset.id);
        if (r) await window.openCloseFloatModal(r, () => _dbLoadAdminTab(content, currentUser, currentRole, 'releases'));
      }));
    };
    paint();
    return;
  }

  if (sub === 'to-confirm') {
    const snap = await db.collection('dept_spend_logs').where('status', '==', 'pending').orderBy('createdAt', 'asc').get().catch(() => ({ docs: [] }));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    wrap.innerHTML = !rows.length ? window.renderEmptyState({icon:'💸',title:'Nothing waiting on confirmation'}) : `
      <div class="table-wrap"><table class="data-table table-cards">
        <thead><tr><th>Date</th><th>Dept</th><th>Description</th><th>Amount</th><th>By</th><th>Flags</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td data-label="Date">${_dbEsc(r.date)}</td>
            <td data-label="Dept">${_dbEsc(r.dept)}</td>
            <td data-label="Description">${_dbEsc(r.description)}</td>
            <td data-label="Amount">₱${fmt(r.amount)}</td>
            <td data-label="By">${_dbEsc(r.loggedByName)}</td>
            <td data-label="Flags">${r.noReceipt?`<span class="badge badge-red">${emojiIcon('🚩',12)} No receipt</span>`:''} ${r.overspendAtLog?`<span class="badge badge-orange">${emojiIcon('🔺',12)} Over budget</span>`:''}</td>
            <td><button class="btn-secondary btn-sm dba-review-btn" data-id="${r.id}">Review</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    wrap.querySelectorAll('.dba-review-btn').forEach(btn => btn.addEventListener('click', () => {
      const spend = rows.find(x => x.id === btn.dataset.id);
      if (spend) _dbOpenSpendReview(spend, currentRole, () => _dbLoadAdminTab(content, currentUser, currentRole, 'to-confirm'));
    }));
    return;
  }

  if (sub === 'requests') {
    const snap = await db.collection('dept_budget_requests').where('status', '==', 'pending').orderBy('createdAt', 'desc').get().catch(() => ({ docs: [] }));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    wrap.innerHTML = !rows.length ? window.renderEmptyState({icon:'🙋',title:'No pending requests'}) : rows.map(r => `
      <div class="item-card" data-id="${r.id}" style="margin-bottom:10px">
        <div class="item-top"><div class="item-title">${_dbEsc(r.dept)} — ${_dbEsc(r.title)}</div><span class="badge badge-warn">Pending</span></div>
        <div class="item-meta">₱${fmt(r.amount)} · ${_dbEsc(r.requestedByName)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;white-space:pre-wrap">${_dbEsc(r.reason)}</div>
        ${(r.attachments||[]).length ? `<div style="margin-top:6px">${r.attachments.map(a=>`<a href="${safeHttpUrl(a.url)}" target="_blank" rel="noopener" style="display:block;font-size:12px">${_dbEsc(a.name)}</a>`).join('')}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn-success btn-sm dba-approve-req" data-id="${r.id}">Approve</button>
          <button class="btn-danger btn-sm dba-decline-req" data-id="${r.id}">Decline</button>
        </div>
      </div>`).join('');
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    wrap.querySelectorAll('.dba-approve-req').forEach(btn => btn.addEventListener('click', () => {
      const req = rows.find(x => x.id === btn.dataset.id);
      if (req) window.openReleaseBudgetForm({ dept: req.dept, title: req.title, amount: req.amount, requestId: req.id, requestedBy: req.requestedBy },
        () => _dbLoadAdminTab(content, currentUser, currentRole, 'requests'));
    }));
    wrap.querySelectorAll('.dba-decline-req').forEach(btn => onClickSafe(btn, async () => {
      const req = rows.find(x => x.id === btn.dataset.id);
      if (req) await _dbDeclineRequest(req, () => _dbLoadAdminTab(content, currentUser, currentRole, 'requests'));
    }));
    return;
  }

  if (sub === 'reimbursements') {
    const snap = await db.collection('dept_spend_logs').where('reimbStatus', '==', 'owed').orderBy('createdAt', 'asc').get().catch(() => ({ docs: [] }));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const byPerson = {};
    rows.forEach(r => { (byPerson[r.paidByName || '—'] = byPerson[r.paidByName || '—'] || []).push(r); });
    wrap.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Owed to people, not departments.</div>
      ${!rows.length ? window.renderEmptyState({icon:'💵',title:'Nothing owed right now'}) : Object.keys(byPerson).map(name => {
        const list = byPerson[name];
        const subtotal = list.reduce((s, r) => s + (r.reimbAmount || 0), 0);
        return `<div class="card" style="margin-bottom:12px">
          <div class="card-header"><h3 style="font-size:13px">${_dbEsc(name)}</h3><span class="badge badge-orange">₱${fmt(subtotal)}</span></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
            ${list.map(r => `<div class="item-card" data-id="${r.id}">
              <div class="item-top"><div class="item-title">${_dbEsc(r.dept)} — ${_dbEsc(r.description)}</div><span>₱${fmt(r.reimbAmount)}</span></div>
              <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn-primary btn-sm dba-mark-paid" data-id="${r.id}">Mark paid</button></div>
            </div>`).join('')}
          </div>
        </div>`;
      }).join('')}
    `;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    wrap.querySelectorAll('.dba-mark-paid').forEach(btn => btn.addEventListener('click', () => {
      const spend = rows.find(x => x.id === btn.dataset.id);
      if (spend) _dbOpenMarkPaidModal(spend, () => _dbLoadAdminTab(content, currentUser, currentRole, 'reimbursements'));
    }));
    return;
  }
}

function _dbReleaseCardHtml(r, financeView) {
  const remaining = r.status === 'active' ? (r._remaining != null ? r._remaining : null) : null;
  const over = remaining != null && remaining < 0;
  const notPosted = r.type === 'float' && r.status === 'active' && !r.ledgerRef;
  return `<div class="card" style="margin-bottom:10px">
    <div class="card-body">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div>
          <span class="badge ${r.type==='float'?'badge-blue':'badge-orange'}">${r.type==='float'?`${emojiIcon('💵',12)} Cash float`:`${emojiIcon('🧾',12)} Spending limit`}</span>
          <span class="badge ${r.status==='active'?'badge-green':'badge-gray'}" style="margin-left:6px">${r.status==='active'?'Active':'Closed'}</span>
          <div style="font-weight:700;margin-top:4px">${_dbEsc(r.dept)} — ${_dbEsc(r.title)}</div>
          <div style="font-size:12px;color:var(--text-muted)">${r.type==='float'?`Custodian: ${_dbEsc(r.custodianName||'—')} — holding company cash`:'Pay out of pocket, then log the receipt to get paid back.'}</div>
        </div>
        <div style="text-align:right">
          <div>₱${fmt(r.amount)}</div>
          <div style="font-size:11px;color:var(--text-muted)">Released ${_dbEsc(r.date)}</div>
          ${remaining!=null?`<div style="font-weight:700;color:${over?'var(--danger)':'var(--success)'}">${over?`OVER BY ₱${fmt(Math.abs(remaining))}`:`Remaining ₱${fmt(remaining)}`}</div>`:''}
        </div>
      </div>
      ${notPosted ? `<div style="margin-top:8px;padding:8px 12px;background:rgba(255,0,0,0.08);border-radius:8px;font-size:12px;color:var(--danger);display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>${emojiIcon('⚠️',14)} Not yet posted — tap Repost</span>
        ${financeView ? `<button class="btn-danger btn-sm dba-repost-btn" data-id="${r.id}">Repost</button>` : ''}
      </div>` : ''}
      ${financeView && r.type==='float' && r.status==='active' ? `<div style="margin-top:8px;text-align:right"><button class="btn-secondary btn-sm dba-close-float-btn" data-id="${r.id}">Close float</button></div>` : ''}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════
//  §7 — HR/Admin signpost entry point (no chip-tab switch of their own)
// ══════════════════════════════════════════════════
window.renderDeptBudgetingPage = function(dept) {
  const c = deptContainer();
  c.innerHTML = `<div class="page-header"><h2>${_dbEsc(dept)} — Budgeting</h2></div><div id="dbp-content">${window.skeletonHtml('rows')}</div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  window.renderBudgeting(c.querySelector('#dbp-content'), window.currentUser, window.currentRole, dept);
};
