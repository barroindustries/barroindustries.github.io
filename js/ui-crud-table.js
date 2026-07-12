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
//     columns: [{ header, style?, cell(r) => html }],
//     actionsMode: 'always' | 'privOnly',   // 'always' = actions <td> always rendered (buttons conditional inside);
//                                            // 'privOnly' = whole actions column only exists when isFinancePriv()
//     actionsExtra(r),                      // optional extra html inside the actions cell (e.g. file link)
//     editFields(r) => [...] ,              // fields for window.financeEditModal
//     editTitle,                            // title for financeEditModal
//     deleteLabel(r) => string,             // label for window.financeDelete
//     addModal: {
//       title, bodyHtml, footerHtml,
//       afterOpen(ctx),                     // called after openPage(); ctx.setFile(f) helper provided
//       buildDoc(ctx) => object,             // fields to .add() (createdAt/filedBy etc already merged by caller if needed)
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

  function actionsCellHtml(r) {
    const editBtn = isPriv ? `<button class="btn-secondary btn-sm crud-edit-btn" data-id="${r.id}">${emojiIcon('✎',16)}</button>` : '';
    const delBtn = isPriv ? `<button class="btn-danger btn-sm crud-del-btn" data-id="${r.id}" data-label="${escHtml(cfg.deleteLabel(r))}" style="margin-left:4px">${emojiIcon('trash-2',14)}</button>` : '';
    const extra = cfg.actionsExtra ? cfg.actionsExtra(r) : '';
    return `<td style="white-space:nowrap">${editBtn}${delBtn}${extra}</td>`;
  }

  function rowHtml(r) {
    const tds = cfg.columns.map(c => `<td${c.style ? ` style="${c.style}"` : ''}>${c.cell(r)}</td>`).join('');
    const actionsTd = showActionsCol ? actionsCellHtml(r) : '';
    return `<tr>${tds}${actionsTd}</tr>`;
  }

  const headerRow = `<tr>${cfg.columns.map(c => `<th>${c.header}</th>`).join('')}${showActionsCol ? '<th></th>' : ''}</tr>`;

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div>${cfg.headerExtra ? cfg.headerExtra() : ''}</div>
      <button class="btn-primary btn-sm" id="crud-add-btn">${cfg.addBtnLabel}</button>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        ${!records.length
          ? `<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon(cfg.emptyIcon,44)}</div><h4>${cfg.emptyLabel}</h4></div>`
          : `<div class="table-wrap"><table class="data-table">
              <thead>${headerRow}</thead>
              <tbody id="crud-tbody">${records.map(rowHtml).join('')}</tbody>
            </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  function bindRowActions(scopeEl) {
    if (!isPriv) return;
    scopeEl.querySelectorAll('.crud-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const r = records.find(x => x.id === btn.dataset.id); if (!r) return;
      window.financeEditModal({ collection, docId: r.id, title: cfg.editTitle, onSaved: redo, fields: cfg.editFields(r) });
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
      bindRowActions(tbody);
    });
  }

  document.getElementById('crud-add-btn').addEventListener('click', () => {
    openPage(cfg.addModal.title, cfg.addModal.bodyHtml, cfg.addModal.footerHtml);
    let uploadedFile = null;
    const ctx = { setFile: (f) => { uploadedFile = f; }, getFile: () => uploadedFile, currentUser, currentRole };
    if (cfg.addModal.afterOpen) cfg.addModal.afterOpen(ctx);
    const saveBtn = document.getElementById(cfg.addModal.saveBtnId);
    saveBtn && saveBtn.addEventListener('click', () => window.busy(saveBtn, async () => {
      const doc = cfg.addModal.buildDoc(ctx);
      await db.collection(collection).add(doc);
      closeModal();
      Notifs.success(cfg.addModal.successMsg);
      redo();
    }));
  });

  if (cfg.afterRender) cfg.afterRender(container, records);
};
