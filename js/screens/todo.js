/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Personal To-Do
   js/screens/todo.js

   NEW 2026-09-01 (owner: "can this be added on the barro system — its in
   president only — add as personal to-do — should be on the app drawer").
   A private personal checklist, distinct from the department Tasks boards
   the system already has. The drawer entry is president-only (NAV_REGISTRY
   when:'isPresident'); the data is OWNER-only either way — firestore.rules
   scopes personal_todos/{uid}/items to request.auth.uid == uid, same
   privacy stance as Notes, so opening the feature to staff later is a nav
   change, not a rules change.

   Free text is rendered via innerHTML — every interpolation goes through
   escHtml(). Items live under the signed-in uid; the one query is
   owner-scoped so it is provable under the rules with no composite index
   (single orderBy createdAt).
   ═══════════════════════════════════════════════════ */

let _todoItems = [];        // [{id, text, done, createdAt, doneAt}]
let _todoLoaded = false;

function _todoCol() {
  return db.collection('personal_todos').doc(currentUser.uid).collection('items');
}

window.renderPersonalTodo = async function () {
  const c = document.getElementById('page-content');
  if (!c) return;
  if (!(typeof isPresident === 'function' && isPresident())) {
    c.innerHTML = renderAccessDenied('Personal To-Do');
    return;
  }
  c.innerHTML = window.skeletonHtml('rows');
  try {
    const snap = await _todoCol().orderBy('createdAt', 'asc').get();
    _todoItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _todoLoaded = true;
  } catch (e) {
    _todoItems = []; _todoLoaded = false;
    c.innerHTML = `<div class="card" style="padding:22px;text-align:center;color:var(--text-muted)">
      Could not load your to-do list (${escHtml((e && e.message) || 'error')}). Check the connection and reopen.</div>`;
    return;
  }
  _todoPaint();
};

function _todoPaint() {
  const c = document.getElementById('page-content');
  if (!c) return;
  const open = _todoItems.filter(i => !i.done);
  const done = _todoItems.filter(i => i.done);
  const row = (i) => `
    <div class="card" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:8px;${i.done ? 'opacity:.62' : ''}">
      <input type="checkbox" ${i.done ? 'checked' : ''} onchange="todoToggle('${escHtml(i.id)}')" style="width:18px;height:18px;flex-shrink:0" aria-label="Done">
      <div style="flex:1;min-width:0;font-size:14px;${i.done ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${escHtml(i.text || '')}</div>
      <button type="button" onclick="todoDelete('${escHtml(i.id)}')" title="Delete" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:15px;padding:2px 6px">✕</button>
    </div>`;
  c.innerHTML = `
    <div style="max-width:640px;margin:0 auto">
      <h2 style="font-size:17px;font-weight:800;margin-bottom:2px">${emojiIcon('✅', 18)} My To-Do</h2>
      <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px">Private to you — separate from the department Tasks boards.</div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <input id="todoNewText" placeholder="Add a to-do… (Enter to add)" maxlength="500"
          style="flex:1;border:1.5px solid var(--border,#d5dbe3);border-radius:8px;padding:9px 12px;font-size:14px;background:var(--card-bg,transparent);color:var(--text)"
          onkeydown="if(event.key==='Enter')todoAdd()">
        <button class="btn-primary btn-sm" onclick="todoAdd()">＋ Add</button>
      </div>
      ${open.length ? open.map(row).join('') : `<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:18px 0">${done.length ? 'All done 🎉' : 'Nothing here yet — add your first to-do above.'}</div>`}
      ${done.length ? `
        <div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 8px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)">Done (${done.length})</div>
          <button type="button" onclick="todoClearDone()" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:12px;text-decoration:underline">Clear completed</button>
        </div>
        ${done.map(row).join('')}` : ''}
    </div>`;
  const inp = document.getElementById('todoNewText');
  if (inp) inp.focus();
}

window.todoAdd = async function () {
  const inp = document.getElementById('todoNewText');
  const text = (inp && inp.value || '').trim();
  if (!text) return;
  const item = { text, done: false, createdAt: new Date().toISOString(), doneAt: '', updatedAt: new Date().toISOString() };
  try {
    const ref = await _todoCol().add(item);
    _todoItems.push({ id: ref.id, ...item });
    _todoPaint();
  } catch (e) {
    window.Notifs?.showToast && Notifs.showToast('Could not save — ' + ((e && e.message) || 'error'), 'error');
  }
};

window.todoToggle = async function (id) {
  const it = _todoItems.find(x => x.id === id);
  if (!it) return;
  it.done = !it.done;
  it.doneAt = it.done ? new Date().toISOString() : '';
  it.updatedAt = new Date().toISOString();
  _todoPaint();
  try {
    await _todoCol().doc(id).update({ done: it.done, doneAt: it.doneAt, updatedAt: it.updatedAt });
  } catch (e) {
    it.done = !it.done; _todoPaint();
    window.Notifs?.showToast && Notifs.showToast('Could not update — ' + ((e && e.message) || 'error'), 'error');
  }
};

window.todoDelete = async function (id) {
  const idx = _todoItems.findIndex(x => x.id === id);
  if (idx < 0) return;
  const [removed] = _todoItems.splice(idx, 1);
  _todoPaint();
  try {
    await _todoCol().doc(id).delete();
  } catch (e) {
    _todoItems.splice(idx, 0, removed); _todoPaint();
    window.Notifs?.showToast && Notifs.showToast('Could not delete — ' + ((e && e.message) || 'error'), 'error');
  }
};

window.todoClearDone = async function () {
  const done = _todoItems.filter(i => i.done);
  if (!done.length) return;
  _todoItems = _todoItems.filter(i => !i.done);
  _todoPaint();
  try {
    await Promise.all(done.map(i => _todoCol().doc(i.id).delete()));
  } catch (e) {
    window.Notifs?.showToast && Notifs.showToast('Some items could not be cleared — reopen to re-sync.', 'error');
    window.renderPersonalTodo();
  }
};
