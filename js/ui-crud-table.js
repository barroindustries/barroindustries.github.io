// js/ui-crud-table.js — v13 Phase 45: generic finance CRUD table component.
// Fetch → table → add modal → edit (financeEditModal) → delete (financeDelete) → optional CSV.
// Each caller supplies a config; this file contains no per-screen business logic.
//
// window.renderFinanceCrudTable(container, cfg)
//   cfg = {
//     collection, currentUser, currentRole,
//     orderBy: [field, dir='desc'], limit,
//     emptyIcon, emptyLabel,               // empty-state icon + heading
//     headerExtra(),                        // optional: html for extra controls left of Add button (e.g. a filter select)
//     addBtnLabel,                          // "+ Add X"
//     columns: [{ header, style?, cell(r) => html, mobile? }],
//                                            // mobile (v14 Wave 6 B2) — optional role for the ≤700px .table-cards
//                                            // layout (see the .table-cards comment in styles.css): 'name' | 'net' |
//                                            // 'avatar' | 'detail' (default 'detail'). The component emits the
//                                            // matching tc-* class + data-label + tap-to-expand wiring; callers never
//                                            // touch markup. BACKWARD COMPATIBLE: if no column sets `mobile`, a
//                                            // heuristic applies instead — first column becomes tc-name, the LAST
//                                            // column whose header matches /amount|total|net|balance|debit|credit|
//                                            // cash|pay|price|value/i becomes tc-net (falling back to the actual last
//                                            // column if none match), everything else is tc-detail.
//     actionsMode: 'always' | 'privOnly',   // 'always' = actions <td> always rendered (buttons conditional inside);
//                                            // 'privOnly' = whole actions column only exists when isFinancePriv()
//     actionsExtra(r),                      // optional extra html inside the actions cell (e.g. file link)
//     editFields(r) => [...] ,              // fields for window.financeEditModal
//     editTitle,                            // title for financeEditModal
//     editTransform(r) => (upd)=>{...},     // optional: per-record `transform` fn passed to financeEditModal
//                                            // (e.g. CDJ recomputing vatAmount from edited legs)
//     editOnSaved(r, redo) => fn,           // optional: custom onSaved for financeEditModal instead of the
//                                            // default `redo` (e.g. CRJ/CDJ chaining resyncLedgerForSource(...).then(redo))
//     periodField,                          // optional: name of the record's finance-period date field (e.g. 'date').
//                                            // OPT-IN — set it ONLY for a collection whose firestore.rules update rule
//                                            // actually carries the period-close gate (today: cash_receipt_journal,
//                                            // cash_disbursement_journal). Setting it on an ungated collection
//                                            // (tax_records, finance_records) would invent a client-only denial with no
//                                            // rule behind it. When set, the ✎ button checks BOTH months — the row's
//                                            // CURRENT one before opening the modal (the OUT direction) and the NEW one
//                                            // on save (financeEditModal's own periodField, the IN direction) — so the
//                                            // user gets the standard "books are closed" toast instead of a raw
//                                            // permission error. This is the DIAGNOSTIC layer only; enforcement lives in
//                                            // firestore.rules (journalUpdatePeriodOk). Same pair .led-edit-btn and
//                                            // .exp-edit-btn already use (js/screens/finance.js).
//     deleteLabel(r) => string,             // label for window.financeDelete
//     kpiHtml(records) => html,             // optional: KPI row rendered above the Add-button row
//     addModal: {
//       title,
//       bodyHtml | bodyHtml(preData),        // string, or fn(preData) if beforeOpen is used
//       footerHtml,
//       beforeOpen() => Promise<preData>,    // optional: runs BEFORE openPage() (e.g. await BankAccounts.optionsHTML())
//                                             // so bodyHtml can embed async-fetched markup with no loading flash
//       afterOpen(ctx, preData),             // called after openPage(); ctx.setFile(f) helper provided
//       buildDoc(ctx, preData) => object|Promise<object|null>,
//                                             // fields to .add(); may be async. Return null/undefined to ABORT the
//                                             // save silently (button re-enables, modal stays open) — used for
//                                             // inline validation + assertPeriodOpen (which shows its own toast)
//       afterSave(docId, doc, ctx, preData), // optional async hook run AFTER .add() succeeds, BEFORE closeModal/toast
//                                             // (e.g. CRJ/CDJ mirroring the new doc into the ledger via postMulti)
//       successMsg
//     },
//     afterRender(container, records)       // optional: append extra sections (e.g. file archive) after building the table
//   }
window.renderFinanceCrudTable = async function(container, cfg) {
  const { collection, currentUser, currentRole } = cfg;
  let q = db.collection(collection);
  if (cfg.orderBy) q = q.orderBy(cfg.orderBy[0], cfg.orderBy[1] || 'desc');
  if (cfg.limit) q = q.limit(cfg.limit);
  const snap = await q.get().catch(() => ({ docs: [] }));
  const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const isPriv = isFinancePriv();
  const actionsAlways = cfg.actionsMode === 'always';
  const showActionsCol = actionsAlways || isPriv;

  const redo = () => window.renderFinanceCrudTable(container, cfg);

  // v14 Wave 6 B2 — resolve each column's ≤700px .table-cards role (see the
  // cfg doc above + the .table-cards comment in styles.css). Explicit
  // cfg.columns[i].mobile wins if ANY column sets one; otherwise fall back to
  // the heuristic (first col = name, last money-ish-header col = net, rest =
  // detail) so pre-existing callers render sensibly with zero changes.
  const MONEY_HEADER_RE = /(amount|total|net|balance|debit|credit|cash|pay|price|value)/i;
  function resolveMobileRoles(columns) {
    if (columns.some(c => c.mobile)) return columns.map(c => c.mobile || 'detail');
    const roles = columns.map(() => 'detail');
    if (columns.length) roles[0] = 'name';
    let netIdx = -1;
    for (let i = columns.length - 1; i > 0; i--) {
      if (MONEY_HEADER_RE.test(columns[i].header || '')) { netIdx = i; break; }
    }
    if (netIdx === -1 && columns.length > 1) netIdx = columns.length - 1;
    if (netIdx > 0) roles[netIdx] = 'net';
    return roles;
  }
  const mobileRoles = resolveMobileRoles(cfg.columns);

  function actionsCellHtml(r) {
    const editBtn = isPriv ? `<button class="btn-secondary btn-sm crud-edit-btn" data-id="${r.id}">${emojiIcon('✎',16)}</button>` : '';
    const delBtn = isPriv ? `<button class="btn-danger btn-sm crud-del-btn" data-id="${r.id}" data-label="${escHtml(cfg.deleteLabel(r))}" style="margin-left:4px">${emojiIcon('trash-2',14)}</button>` : '';
    const extra = cfg.actionsExtra ? cfg.actionsExtra(r) : '';
    return `<td class="tc-actions" style="white-space:nowrap">${editBtn}${delBtn}${extra}</td>`;
  }

  function rowHtml(r) {
    const tds = cfg.columns.map((c, i) => {
      const role = mobileRoles[i];
      const cls = role === 'detail' ? 'tc-detail' : `tc-${role}`;
      const labelAttr = role === 'detail' ? ` data-label="${escHtml(c.header)}"` : '';
      const caret = role === 'name' ? ` <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i>` : '';
      return `<td class="${cls}"${c.style ? ` style="${c.style}"` : ''}${labelAttr}>${c.cell(r)}${caret}</td>`;
    }).join('');
    const actionsTd = showActionsCol ? actionsCellHtml(r) : '';
    return `<tr class="crud-row">${tds}${actionsTd}</tr>`;
  }

  const headerRow = `<tr>${cfg.columns.map(c => `<th>${c.header}</th>`).join('')}${showActionsCol ? '<th></th>' : ''}</tr>`;

  container.innerHTML = `
    ${cfg.kpiHtml ? cfg.kpiHtml(records) : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div>${cfg.headerExtra ? cfg.headerExtra() : ''}</div>
      <button class="btn-primary btn-sm" id="crud-add-btn">${cfg.addBtnLabel}</button>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        ${!records.length
          ? `<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon(cfg.emptyIcon,44)}</div><h4>${cfg.emptyLabel}</h4></div>`
          : `<div class="table-wrap"><table class="data-table table-cards">
              <thead>${headerRow}</thead>
              <tbody id="crud-tbody">${records.map(rowHtml).join('')}</tbody>
            </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  // Card view (≤700px) — tap a row (outside buttons/links) to reveal the
  // tc-detail breakdown. Class toggle only, same markup/values at every
  // width (see the .table-cards comment in styles.css). No-op at desktop
  // widths since tc-detail is only ever hidden inside that max-width query.
  function bindRowToggle(scopeEl) {
    scopeEl.querySelectorAll('tr.crud-row').forEach(tr => {
      tr.addEventListener('click', (ev) => {
        if (ev.target.closest('button, a')) return;
        tr.classList.toggle('tc-expanded');
      });
    });
  }
  bindRowToggle(container);

  function bindRowActions(scopeEl) {
    if (!isPriv) return;
    scopeEl.querySelectorAll('.crud-edit-btn').forEach(btn => btn.addEventListener('click', async () => {
      const r = records.find(x => x.id === btn.dataset.id); if (!r) return;
      // v14 re-audit ROUND 3 — guard the row's CURRENT month (cfg.periodField
      // above explains why this is opt-in). The rules now refuse to move a CRJ/
      // CDJ row OUT of a closed month as well as into one, and this handler is
      // the ONLY ✎ button that had neither half of the guard — .led-edit-btn
      // and .exp-edit-btn got theirs in round 2. Without it the user's save
      // fails with a raw "permission-denied" AFTER the modal has closed.
      // President is exempt, matching firestore.rules' periodOpenFor() bypass;
      // a non-string/absent stored date is skipped, matching the rules'
      // journalMonthOpen() fail-open on a date that buckets to no period.
      if (cfg.periodField && typeof r[cfg.periodField] === 'string' && r[cfg.periodField]
          && !(typeof isPresident === 'function' && isPresident()) && window.assertPeriodOpen) {
        // assertPeriodOpen shows its own toast and throws — swallow it so the
        // click is simply a no-op instead of an unhandled rejection.
        try { await window.assertPeriodOpen(r[cfg.periodField]); } catch (_e) { return; }
      }
      window.financeEditModal({
        collection, docId: r.id, title: cfg.editTitle,
        onSaved: cfg.editOnSaved ? cfg.editOnSaved(r, redo) : redo,
        fields: cfg.editFields(r),
        transform: cfg.editTransform ? cfg.editTransform(r) : undefined,
        periodField: cfg.periodField
      });
    }));
    scopeEl.querySelectorAll('.crud-del-btn').forEach(btn => btn.addEventListener('click', () => {
      window.financeDelete({ collection, docId: btn.dataset.id, label: btn.dataset.label, onDone: redo });
    }));
  }
  bindRowActions(container);

  // Optional live filter (Records tab): headerExtra() renders the <select>, cfg.filter wires it.
  if (cfg.filter) {
    const filterEl = document.getElementById(cfg.filter.id);
    filterEl && filterEl.addEventListener('change', e => {
      const fv = e.target.value;
      const filtered = fv ? records.filter(r => cfg.filter.matches(r, fv)) : records;
      const tbody = document.getElementById('crud-tbody');
      if (!tbody) return;
      tbody.innerHTML = filtered.map(rowHtml).join('');
      if (window.lucide) lucide.createIcons({ nodes: [tbody] });
      bindRowToggle(tbody);
      bindRowActions(tbody);
    });
  }

  document.getElementById('crud-add-btn').addEventListener('click', async () => {
    try {
      // beforeOpen runs BEFORE openPage() so async-fetched markup (e.g. a bank-account
      // <select>) is already in bodyHtml with no loading flash — matches the pre-migration
      // pattern of `const bankOpts = await BankAccounts.optionsHTML(); openPage(...)`.
      const preData = cfg.addModal.beforeOpen ? await cfg.addModal.beforeOpen() : null;
      const body = typeof cfg.addModal.bodyHtml === 'function' ? cfg.addModal.bodyHtml(preData) : cfg.addModal.bodyHtml;
      // Capture the panel and hand it to ctx. buildDoc implementations read
      // their form fields back by id, and without a panel to scope to they had
      // to go through document — which during openPage's teardown window reads
      // the PREVIOUS record's values and writes them onto this one. These are
      // the finance journals (Cash Receipts, Cash Disbursements, Taxes,
      // Records), so that is a wrong-amount bug, not a cosmetic one.
      // ctx.$ is the scoped accessor; ctx.panel is there for anything that
      // needs the element itself.
      const _panel = openPage(cfg.addModal.title, body, cfg.addModal.footerHtml);
      let uploadedFile = null;
      const ctx = { setFile: (f) => { uploadedFile = f; }, getFile: () => uploadedFile, currentUser, currentRole,
                    panel: _panel, $: (id) => _panel.querySelector('#' + id) };
      if (cfg.addModal.afterOpen) cfg.addModal.afterOpen(ctx, preData);
      const saveBtn = _panel.querySelector('#' + cfg.addModal.saveBtnId);
      saveBtn && saveBtn.addEventListener('click', () => window.busy(saveBtn, async () => {
        try {
          const doc = await cfg.addModal.buildDoc(ctx, preData);
          if (!doc) return; // validation / assertPeriodOpen aborted — toast already shown by the caller
          const ref = await db.collection(collection).add(doc);
          if (cfg.addModal.afterSave) await cfg.addModal.afterSave(ref.id, doc, ctx, preData);
          closeModal();
          Notifs.success(cfg.addModal.successMsg);
          redo();
        } catch (err) {
          Notifs.showToast('Save failed: ' + (err && err.message || err), 'error');
        }
      }));
    } catch (err) {
      Notifs.showToast('Could not open the form: ' + (err && err.message || err), 'error');
      return;
    }
  });

  if (cfg.afterRender) cfg.afterRender(container, records);
};
