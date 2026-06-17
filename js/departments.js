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
  if (['president','owner','manager','finance'].includes(role)) return true;
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
  return t;
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
    const todayStr = new Date().toISOString().slice(0, 10);
    const in3Days  = new Date(); in3Days.setDate(in3Days.getDate() + 3);
    const in3Str   = in3Days.toISOString().slice(0, 10);
    const snap = await db.collection('tasks').get().catch(()=>({docs:[]}));
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
          <h3>${cfg.icon||'🗂️'} ${dept}</h3>
          <div style="display:flex;gap:8px"><span class="badge badge-blue">${open} open</span><span class="badge badge-green">${done} done</span></div>
        </div>
        <div class="item-list" style="padding:0 12px 12px">
          ${dTasks.map(t=>`<div style="margin-top:8px">${taskCard(t)}</div>`).join('')}
        </div>
      </div>`;
    }).join('');
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
  const isAdmin = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance';
  const isAssignee = t.assignedTo.includes(currentUser.uid);
  const isCreator  = t.createdBy===currentUser.uid;
  const canEdit    = isAdmin||isAssignee||isCreator;
  const canSubmit  = isAssignee&&!['submitted','review','approved','on-hold','archived'].includes(t.status);
  const allowedStatuses = isAdmin?TASK_STATUSES:TASK_STATUSES.filter(s=>EMP_STATUSES.includes(s.value));

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
        ${isAdmin||isCreator?`<button class="btn-danger btn-sm" id="del-task-btn">🗑</button>`:''}
      </div>
    </div>

    <!-- Scrollable content + messaging below -->
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <!-- Task info section (scrollable) -->
      <div style="flex:0 0 auto;overflow-y:auto;max-height:42%;padding:16px;border-bottom:1px solid var(--border)" id="task-info-scroll">

        <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap">
          ${t.assignedToNames?.length?`<span>👥 <strong>${escHtml(t.assignedToNames.join(', '))}</strong></span>`:''}
          ${t.dueDate?`<span>📅 Due: <strong style="color:${t.dueDate<new Date().toISOString().slice(0,10)?'var(--danger)':'inherit'}">${t.dueDate}</strong></span>`:''}
          ${t.createdByName?`<span>🖊 By: ${escHtml(t.createdByName)}</span>`:''}
        </div>

        ${t.description?`<p style="font-size:14px;line-height:1.6;margin-bottom:12px;white-space:pre-wrap;color:var(--text)">${escHtml(t.description)}</p>`:''}

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

        ${currentRole==='president'&&SCORE_STATUSES.includes(t.status)?`<div style="background:var(--surface2);border:1.5px solid var(--primary-light);border-radius:10px;padding:12px;margin-bottom:10px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--primary-light);margin-bottom:8px">🔒 President Score</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input id="pres-score" type="number" min="1" max="10" step="0.5" value="${t.presidentScore||''}" placeholder="1–10" style="width:80px;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);color:var(--text)"/>
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
  // Trigger animation
  requestAnimationFrame(() => {
    panel.style.transform = 'translateY(0)';
    panel.style.opacity = '1';
  });

  renderComments('tasks',taskId,'task-comments-wrap',currentUser);

  document.getElementById('task-panel-back').addEventListener('click', closeTaskPanel);

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
    if (!confirm('Delete this task?')) return;
    await db.collection('tasks').doc(taskId).delete();
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
    await Notifs.send(newUid,{title:'🎯 Task Assigned to You',body:`"${t.title}" assigned by ${actorName}${note?' — '+note:''}`,icon:'🎯',type:'task_designated',taskId});
    await Notifs.sendToOwner({title:'👥 Task Assignee Added',body:`${actorName} added ${newName} to "${t.title}"`,icon:'👥',type:'task_modified',taskId});
    Notifs.showToast(`${newName} added`);
    closeTaskPanel(); renderTasks(currentUser,currentRole,t.department);
  });

  document.getElementById('save-score-btn')?.addEventListener('click', async()=>{
    const score=parseFloat(document.getElementById('pres-score').value);
    if (!score||score<1||score>10) { Notifs.showToast('Enter 1–10','error'); return; }
    await db.collection('tasks').doc(taskId).update({presidentScore:score});
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
  const isAdmin = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance';
  let employees=[];
  if (isAdmin) {
    const empSnap = await db.collection('users').get();
    employees = empSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  }
  const deptOptions = Object.keys(window.DEPARTMENTS||{}).map(k=>`<option value="${k}"${t.department===k?' selected':''}>${k}</option>`).join('');
  const allowedStatuses = isAdmin?TASK_STATUSES:TASK_STATUSES.filter(s=>EMP_STATUSES.includes(s.value));

  openModal('Edit Task', `
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
  const empSnap  = await db.collection('users').get();
  const employees= empSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const deptOptions = Object.keys(window.DEPARTMENTS||{}).map(k=>`<option value="${k}"${k===defaultDept?' selected':''}>${k}</option>`).join('');

  openModal('New Task', `
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

  let taskAttachment=null;
  Drive.renderUploadArea('task-attach-area',r=>{taskAttachment=r;},{label:'📎 Attach file',dept:'tasks',subfolder:'attachments'});

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
      attachments:taskAttachment?[taskAttachment]:[],
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
      <h2>📋 Submissions</h2>
      <button class="btn-primary btn-sm" id="add-sub-btn">+ New Submission</button>
    </div>
    <div id="subs-list" class="item-list"><div class="loading-placeholder">Loading…</div></div>
  `;
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
        ${s.createdAt?`<span>📅 ${new Date(s.createdAt.toDate()).toLocaleDateString()}</span>`:''}
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
    ${s.fileUrl?`<a href="${s.fileUrl}" target="_blank" class="btn-secondary" style="display:inline-flex;gap:6px;margin-bottom:14px">📎 View Attachment</a>`:''}
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
  openModal('New Submission', `
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
  Drive.renderUploadArea('sub-file-upload', (result) => { uploadedFile = result; }, { label:'Attach supporting document (optional)', accept:'*' });

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
      createdAt:       firebase.firestore.FieldValue.serverTimestamp()
    });
    // Notify owner
    await Notifs.sendToOwner({ title:'📋 New Submission', body:`${name} submitted: "${document.getElementById('s-title').value.trim()}"`, icon:'📋', type:'submission_new' });
    closeModal();
    Notifs.showToast('Submission sent!');
    renderSubmissions(currentUser, '', '');
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
  } else if (sub === 'all-expenses') {
    const snap = await db.collection('expenses').get();
    const expenses = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    content.innerHTML = expenseTable(expenses, true);
  } else if (sub === 'summary') {
    const snap = await db.collection('expenses').get();
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
                  ${e.status==='pending'?`<button class="btn-icon approve-expense" data-id="${e.id}">✅</button><button class="btn-icon reject-expense" data-id="${e.id}">❌</button>`:''}
                  ${e.fileUrl?`<a href="${e.fileUrl}" target="_blank" class="btn-icon">📎</a>`:''}
                </td>`:''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function openAddExpenseModal(currentUser) {
  openModal('Add Expense / Receipt', `
    <div class="form-group"><label>Description</label><input id="e-desc" placeholder="What was this expense for?"/></div>
    <div class="form-row">
      <div class="form-group"><label>Amount (₱)</label><input id="e-amount" type="number" step="0.01" placeholder="0.00"/></div>
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
                  ${c.fileUrl ? (isImage(c.fileUrl)
                    ? `<div style="margin-top:${c.text?'6':'0'}px"><img src="${c.fileUrl}" alt="${escHtml(c.fileName||'img')}" style="max-width:200px;max-height:160px;border-radius:8px;cursor:pointer" onclick="window.open('${c.fileUrl}','_blank')"/></div>`
                    : `<a href="${c.fileUrl}" target="_blank" class="ms-file-chip">📎 ${escHtml(c.fileName||'Attachment')}</a>`
                  ) : ''}
                  <div class="ms-meta">
                    <span class="ms-time">${timeLabel(c.createdAt)}</span>
                    ${c.editedAt?'<span class="ms-edited">(edited)</span>':''}
                  </div>
                </div>
                ${canEdit||canDelete ? `<div class="ms-actions">
                  ${canEdit?`<button class="ms-act-btn comment-edit-btn" data-id="${c.id}">✎</button>`:''}
                  ${canDelete?`<button class="ms-act-btn ms-del-btn comment-del-btn" data-id="${c.id}">🗑</button>`:''}
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
        <input id="comment-in-${docId}" class="ms-input" placeholder="Type a message…"/>
        <button class="ms-send-btn" id="comment-send-${docId}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>
    </div>
  `;

  // Scroll to bottom
  const body = document.getElementById(`msbody-${docId}`);
  if (body) body.scrollTop = body.scrollHeight;

  // File attach preview
  document.getElementById(`comment-file-${docId}`)?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    const prev = document.getElementById(`ms-file-preview-${docId}`);
    if (prev) prev.textContent = f ? `📎 ${f.name}` : '';
  });

  // Edit message
  container.querySelectorAll('.comment-edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = btn.dataset.id;
      const c   = comments.find(x=>x.id===cid);
      const newText = prompt('Edit message:', c?.text||'');
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
      if (!confirm('Delete this message?')) return;
      await db.collection(collection).doc(docId).collection('comments').doc(btn.dataset.id).delete();
      renderComments(collection, docId, containerId, currentUser);
    });
  });

  const sendComment = async () => {
    const input   = document.getElementById(`comment-in-${docId}`);
    const fileInp = document.getElementById(`comment-file-${docId}`);
    const text    = input.value.trim();
    const file    = fileInp?.files?.[0];
    if (!text && !file) return;

    const sendBtn = document.getElementById(`comment-send-${docId}`);
    if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = '.5'; }

    const myName = userProfile?.displayName || currentUser.email;

    let fileUrl = null, fileName = null;
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
    }

    await db.collection(collection).doc(docId).collection('comments').add({
      text: text||'', authorId: currentUser.uid, authorName: myName,
      fileUrl: fileUrl||null, fileName: fileName||null,
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
          const preview = text ? (text.length>60?text.slice(0,60)+'…':text) : `📎 ${fileName||'File'}`;
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
    <div class="subtab-bar">
      ${['Advertising','Marketing Designs','Plan','Budgeting','Proposals','Tasks'].map(s =>
        `<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`
      ).join('')}
    </div>
    <div id="mkt-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadMarketingContent(currentUser, currentRole, subtab);
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => { c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); loadMarketingContent(currentUser, currentRole, btn.dataset.sub); });
  });
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
window.renderFinance = async function(currentUser, currentRole, subtab = 'Overview') {
  const c = deptContainer();
  // Finance tools vs HR tools — visually separated
  const finTabs = ['Overview','Reports','Ledger','Cash Receipts','Cash Disbursements','Purchasing','Records','Taxes','SSS / Gov','Tasks'];
  const hrTabs  = ['Payroll','HR Profiles','Cash Advances'];
  const allTabs = [...finTabs, ...hrTabs];
  c.innerHTML = `
    <div class="page-header"><h2>💰 Finance & HR</h2></div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--text-muted);padding:0 4px 4px;text-transform:uppercase">Finance</div>
    <div class="subtab-bar" style="flex-wrap:wrap;margin-bottom:4px">
      ${finTabs.map(s =>
        `<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`
      ).join('')}
    </div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--text-muted);padding:4px 4px;text-transform:uppercase">HR</div>
    <div class="subtab-bar" style="flex-wrap:wrap;margin-bottom:12px">
      ${hrTabs.map(s =>
        `<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`
      ).join('')}
    </div>
    <div id="fin-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadFinanceContent(currentUser, currentRole, subtab);
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadFinanceContent(currentUser, currentRole, btn.dataset.sub);
    });
  });
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
    case 'Records':      await renderRecordsTab(content, currentUser, currentRole); break;
    case 'Purchasing':
      await renderDocCollection(content, 'purchase_orders', 'Purchase Orders', currentUser, currentRole, { icon:'🛒', color:'#1b5e20', dept:'Finance' });
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

// ── Payroll Management ───────────────────────────
async function renderPayrollManagement(container, currentUser, currentRole) {
  const [usersSnap, histSnap, delReqSnap] = await Promise.all([
    fetchUsersWithPayroll(),
    db.collection('salary_history').orderBy('month','desc').limit(200).get().catch(()=>({docs:[]})),
    db.collection('payroll_delete_requests').where('status','==','pending').get().catch(()=>({docs:[]}))
  ]);
  const employees = usersSnap.docs.map(d=>({id:d.id,...d.data()}))
    .filter(u=>u.role!=='partner')
    .sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const history   = histSnap.docs.map(d=>({id:d.id,...d.data()}));
  const delReqs   = delReqSnap.docs.map(d=>({id:d.id,...d.data()}));
  const pendingDelIds = new Set(delReqs.map(r=>r.historyId));
  const canFinance = isFinancePriv();
  const isPres     = isRealPresident(currentUser);
  const months    = [...new Set(history.map(h=>h.month))].sort().reverse();
  const now       = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <select id="pr-month-sel" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px">
        <option value="${thisMonth}">${new Date(thisMonth+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'})} (Current)</option>
        ${months.filter(m=>m!==thisMonth).map(m=>`<option value="${m}">${new Date(m+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'})}</option>`).join('')}
      </select>
      <div style="display:flex;gap:8px">
        <button class="btn-primary btn-sm" id="gen-payroll-btn">Generate Payroll</button>
        <button class="btn-secondary btn-sm" id="print-payroll-btn">🖨 Print All</button>
      </div>
    </div>
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
        openModal(`Edit Payroll Record — ${rec.userName||'?'} (${rec.month||'?'})`, `
          <div class="form-row">
            <div class="form-group"><label>Base Salary</label><input id="hpe-salary" type="number" value="${rec.salary||0}"/></div>
            <div class="form-group"><label>Allowance</label><input id="hpe-allow" type="number" value="${rec.allowance||0}"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Deductions</label><input id="hpe-deduct" type="number" value="${rec.deductions||0}"/></div>
            <div class="form-group"><label>Net Pay</label><input id="hpe-net" type="number" value="${rec.netPay||0}"/></div>
          </div>
          <div class="form-group"><label>Final Pay</label><input id="hpe-final" type="number" value="${rec.finalPay||0}"/></div>
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
          if (!confirm(`Delete payroll record for ${name||'?'} (${month||'?'})? This cannot be undone.`)) return;
          await db.collection('salary_history').doc(hid).delete();
          // Remove matching ledger entry if any
          const lSnap = await db.collection('ledger').where('refNumber','==',`PAY-${month}-${hid.split('_')[0]}`).limit(1).get().catch(()=>({docs:[]}));
          if (lSnap.docs.length) await lSnap.docs[0].ref.delete();
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
          if (!confirm(`Approve deletion of ${req?.userName||'?'} (${req?.month||'?'}) payroll record?`)) return;
          await db.collection('salary_history').doc(histId).delete();
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

  // Shared state for gen-payroll to use after loadPayrollTable runs
  let _caByUser = {}, _caDocsByUser = {}, _caOverrideByUser = {};

  async function loadPayrollTable(month) {
    const tbody = document.getElementById('payroll-tbody');
    tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:20px">Loading…</td></tr>';

    const [caSnap, overrideSnap] = await Promise.all([
      db.collection('cash_advances').where('status','==','approved').get().catch(()=>({docs:[]})),
      db.collection('payroll_ca_overrides').where('month','==',month).get().catch(()=>({docs:[]}))
    ]);

    // Build CA totals + per-doc list per user
    _caByUser = {}; _caDocsByUser = {};
    caSnap.docs.forEach(d => {
      const a = d.data();
      _caByUser[a.userId] = (_caByUser[a.userId]||0) + (a.balance||0);
      (_caDocsByUser[a.userId] = _caDocsByUser[a.userId]||[]).push({id:d.id,...a});
    });

    // Build override map: userId → { amount, docId }
    _caOverrideByUser = {};
    overrideSnap.docs.forEach(d => {
      const o = d.data();
      _caOverrideByUser[o.userId] = { amount: o.amount, docId: d.id };
    });

    tbody.innerHTML = employees.map(u => {
      const depts    = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—';
      const base     = u.salary||0;
      const allow    = u.allowance||0;
      const gross    = base + allow;
      const sss      = u.sss || 0;
      const ph       = u.philhealth || 0;
      const pagibig  = u.pagibig || 0;
      const tax      = u.tax || 0;
      const caBalance= _caByUser[u.id]||0;
      const hasOverride = _caOverrideByUser[u.id] !== undefined;
      const caAdv    = hasOverride ? _caOverrideByUser[u.id].amount : caBalance;
      const deduct   = (u.deductions||0) + sss + ph + pagibig + tax;
      const net      = gross - deduct - caAdv;
      const caCell   = caBalance > 0
        ? `<div style="color:var(--danger);white-space:nowrap">-₱${fmt(caAdv)}${hasOverride?` <span style="font-size:10px;background:var(--primary-light);color:#fff;border-radius:4px;padding:1px 5px">custom</span>`:''}</div>
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
          <button class="btn-secondary btn-sm edit-emp-pay-btn"
            data-uid="${u.id}"
            data-ca-balance="${caBalance}"
            data-ca-override="${hasOverride ? _caOverrideByUser[u.id].amount : ''}"
            title="Edit">✎</button>
          <button class="btn-secondary btn-sm print-slip-btn" data-uid="${u.id}" title="Payslip">🖨</button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.edit-emp-pay-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid        = btn.dataset.uid;
        const emp        = employees.find(u=>u.id===uid);
        const caBalance  = parseFloat(btn.dataset.caBalance)||0;
        const caOverride = btn.dataset.caOverride; // '' means no override
        if (!emp) return;

        openModal(`Edit Payroll — ${emp.displayName}`, `
          <div class="form-row">
            <div class="form-group"><label>Base Salary</label><input id="ep-salary" type="number" value="${emp.salary||0}"/></div>
            <div class="form-group"><label>Allowance</label><input id="ep-allow" type="number" value="${emp.allowance||0}"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Other Deductions</label><input id="ep-deduct" type="number" value="${emp.deductions||0}"/></div>
            <div class="form-group"><label>SSS</label><input id="ep-sss" type="number" value="${emp.sss||0}" placeholder="Auto-computed if 0"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>PhilHealth</label><input id="ep-ph" type="number" value="${emp.philhealth||0}" placeholder="Auto-computed if 0"/></div>
            <div class="form-group"><label>Pag-IBIG</label><input id="ep-pi" type="number" value="${emp.pagibig||0}"/></div>
          </div>
          <div class="form-group"><label>Tax</label><input id="ep-tax" type="number" value="${emp.tax||0}"/></div>
          ${caBalance > 0 ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <label style="font-weight:600">💳 Cash Advance Deduction This Month</label>
            <div style="font-size:12px;color:var(--text-muted);margin:4px 0 8px">Outstanding balance: <strong>₱${fmt(caBalance)}</strong></div>
            <input id="ep-ca-deduct" type="number" min="0" max="${caBalance}" step="0.01"
              value="${caOverride}"
              placeholder="Leave blank = deduct full ₱${fmt(caBalance)}"/>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Enter a partial amount to defer the rest to next month. Clear field to revert to full balance.</div>
          </div>` : ''}
        `, `<button class="btn-primary" id="save-ep-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

        document.getElementById('save-ep-btn').addEventListener('click', async () => {
          // All pay — base, allowance, and government deductions — lives in the
          // protected payroll/{uid} doc (finance/admin write), not the users doc.
          await db.collection('payroll').doc(uid).set({
            salary:     parseFloat(document.getElementById('ep-salary').value)||0,
            allowance:  parseFloat(document.getElementById('ep-allow').value)||0,
            deductions: parseFloat(document.getElementById('ep-deduct').value)||0,
            sss:        parseFloat(document.getElementById('ep-sss').value)||0,
            philhealth: parseFloat(document.getElementById('ep-ph').value)||0,
            pagibig:    parseFloat(document.getElementById('ep-pi').value)||0,
            tax:        parseFloat(document.getElementById('ep-tax').value)||0,
          }, {merge:true});
          window.logAudit && window.logAudit('update','payroll',uid,{ salary:parseFloat(document.getElementById('ep-salary').value)||0 });

          // Save / clear CA deduction override
          if (caBalance > 0) {
            const caInput = document.getElementById('ep-ca-deduct');
            const rawVal  = caInput?.value.trim();
            const overrideRef = db.collection('payroll_ca_overrides').doc(`${uid}_${month}`);
            if (rawVal !== '' && rawVal !== null && rawVal !== undefined) {
              const amount = Math.min(parseFloat(rawVal)||0, caBalance);
              await overrideRef.set({ userId:uid, month, amount, setBy:currentUser.uid, setAt:firebase.firestore.FieldValue.serverTimestamp() });
            } else {
              await overrideRef.delete().catch(()=>{});
            }
          }

          closeModal(); Notifs.showToast('Payroll updated!');
          loadPayrollTable(month);
        });
      });
    });
  }

  loadPayrollTable(thisMonth);
  document.getElementById('pr-month-sel').addEventListener('change', e => loadPayrollTable(e.target.value));

  document.getElementById('gen-payroll-btn').addEventListener('click', async () => {
    const month = document.getElementById('pr-month-sel').value;
    if (!confirm(`Generate and save payroll for ${new Date(month+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'})}?`)) return;

    // 1. Write salary_history
    const batch = db.batch();
    for (const u of employees) {
      const base     = u.salary||0;
      const allow    = u.allowance||0;
      const caBalance= _caByUser[u.id]||0;
      const hasOvr   = _caOverrideByUser[u.id] !== undefined;
      const caAdv    = hasOvr ? _caOverrideByUser[u.id].amount : caBalance;
      const gross    = base + allow;
      const sss      = u.sss || 0;
      const ph       = u.philhealth || 0;
      const pagibig  = u.pagibig || 0;
      const tax      = u.tax || 0;
      const deduct   = (u.deductions||0) + sss + ph + pagibig + tax;
      const net      = gross - deduct - caAdv;
      const ref      = db.collection('salary_history').doc(`${u.id}_${month}`);
      batch.set(ref, {
        userId:u.id, userName:u.displayName||u.email, month,
        salary:base, allowance:allow, deductions:u.deductions||0,
        sss, philHealth:ph, pagIbig:pagibig, tax,
        caDeducted:caAdv, netPay:net, finalPay:net,
        recordedBy:currentUser.uid,
        recordedAt:firebase.firestore.FieldValue.serverTimestamp()
      }, {merge:true});
    }
    await batch.commit();

    // 2. Auto-write per-employee ledger debit entries (Payroll Expense)
    const monthLabel = new Date(month+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'});
    let totalNetPay = 0;
    for (const u of employees) {
      const base   = u.salary||0, allow = u.allowance||0;
      const caAdv  = (_caOverrideByUser[u.id]?.amount ?? _caByUser[u.id]) || 0;
      const deduct = (u.deductions||0)+(u.sss||0)+(u.philhealth||0)+(u.pagibig||0)+(u.tax||0);
      const empNet = base + allow - deduct - caAdv;
      totalNetPay += empNet;
      const ledgerRef = `PAY-${month}-${u.id}`;
      // Upsert so re-generating the same month doesn't duplicate
      const existing = await db.collection('ledger').where('refNumber','==',ledgerRef).limit(1).get().catch(()=>({docs:[]}));
      const entry = {
        date:        month + '-01',
        type:        'debit',
        description: `Payslip — ${u.displayName||u.email} (${monthLabel})`,
        amount:      empNet,
        category:    'Payroll Expense',
        source:      'Finance',
        refNumber:   ledgerRef,
        addedBy:     currentUser.uid,
        addedByName: window.userProfile?.displayName || currentUser.email,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      };
      if (existing.docs.length) {
        await existing.docs[0].ref.update({ amount: empNet });
      } else {
        await db.collection('ledger').add(entry);
      }
    }
    // Also write/update the aggregate summary entry
    if (totalNetPay > 0) {
      const aggRef  = `PAY-${month}`;
      const aggSnap = await db.collection('ledger').where('refNumber','==',aggRef).limit(1).get().catch(()=>({docs:[]}));
      const aggEntry = {
        date:        month + '-01',
        type:        'debit',
        description: `Payroll Total — ${monthLabel} (${employees.length} employees)`,
        amount:      totalNetPay,
        category:    'Payroll',
        source:      'Finance',
        refNumber:   aggRef,
        addedBy:     currentUser.uid,
        addedByName: window.userProfile?.displayName || currentUser.email,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      };
      if (aggSnap.docs.length) {
        await aggSnap.docs[0].ref.update({ amount: totalNetPay, description: aggEntry.description });
      } else {
        await db.collection('ledger').add(aggEntry);
      }
    }

    // 4. Apply CA deductions to actual cash_advance balances
    for (const u of employees) {
      const caBalance = _caByUser[u.id]||0;
      if (caBalance <= 0) continue;
      const hasOvr    = _caOverrideByUser[u.id] !== undefined;
      const deductAmt = hasOvr ? _caOverrideByUser[u.id].amount : caBalance;
      if (deductAmt <= 0) continue;

      let remaining = deductAmt;
      const caDocs  = _caDocsByUser[u.id] || [];
      const caBatch = db.batch();
      for (const caDoc of caDocs) {
        if (remaining <= 0) break;
        const docBal   = caDoc.balance||0;
        const toDeduct = Math.min(docBal, remaining);
        const newBal   = Math.max(0, docBal - toDeduct);
        caBatch.update(db.collection('cash_advances').doc(caDoc.id), {
          balance: newBal,
          ...(newBal <= 0 ? { status:'paid', paidAt:firebase.firestore.FieldValue.serverTimestamp() } : {})
        });
        remaining -= toDeduct;
      }
      await caBatch.commit();

      // Notify employee about CA deduction
      await Notifs.send(u.id, {
        title: '💳 Cash Advance Deducted from Payroll',
        body: `₱${fmt(deductAmt)} was deducted from your ${month} payroll. Remaining CA balance: ₱${fmt(Math.max(0, caBalance-deductAmt))}.`,
        icon: '💳', type: 'cash_advance'
      });
    }

    Notifs.showToast('Payroll generated!');
    loadFinanceContent(currentUser, currentRole, 'Payroll');
  });
}

// ── Taxes Tab ───────────────────────────────────
async function renderTaxesTab(container, currentUser, currentRole) {
  const snap = await db.collection('tax_records').orderBy('createdAt','desc').limit(50).get().catch(()=>({docs:[]}));
  const records = snap.docs.map(d=>({id:d.id,...d.data()}));
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
              <td>
                <button class="btn-secondary btn-sm tax-edit-btn" data-id="${r.id}">✎</button>
                ${r.fileUrl?`<a href="${r.fileUrl}" target="_blank" class="btn-secondary btn-sm">📎</a>`:''}
              </td>
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  document.getElementById('add-tax-btn').addEventListener('click', () => {
    openModal('Add Tax Record', `
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
        <div class="form-group"><label>Amount (₱)</label><input id="tax-amount" type="number" step="0.01"/></div>
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
}

// ── Financial Reports (Income Statement + VAT/BIR reference) ─────
// Computed from the ledger (type credit = income, debit = expense) + general
// journal. Read-only summary for finance/admin; print-ready for filing.
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

  const todayStr = bizDate(), yr = String(bizYear());
  let label;
  if (range==='month') { const m=todayStr.slice(0,7); all=all.filter(e=>(e.date||'').slice(0,7)===m); label='This Month — '+m; }
  else if (range==='year') { all=all.filter(e=>(e.date||'').slice(0,4)===yr); label='Year to Date — '+yr; }
  else { label='All Time'; }

  const income  = all.filter(e=>e.type==='credit');
  const expense = all.filter(e=>e.type==='debit');
  const totIncome  = income.reduce((s,e)=>s+(e.amount||0),0);
  const totExpense = expense.reduce((s,e)=>s+(e.amount||0),0);
  const net = totIncome - totExpense;
  const byCat = arr => { const m={}; arr.forEach(e=>{const k=e.category||'Other'; m[k]=(m[k]||0)+(e.amount||0);}); return Object.entries(m).sort((a,b)=>b[1]-a[1]); };
  const incCats = byCat(income), expCats = byCat(expense);
  const sales = income.filter(e=>(e.category||'')==='Sales Revenue').reduce((s,e)=>s+(e.amount||0),0);
  const outputVat = sales * 0.12;            // VAT-exclusive assumption
  const rangeBtn = (r,t)=>`<button class="subtab-btn ${range===r?'active':''}" onclick="renderFinancialReports(document.getElementById('fin-content'),window.currentUser,window.currentRole,'${r}')">${t}</button>`;

  container.innerHTML = `
    <div class="subtab-bar" style="margin-bottom:12px">${rangeBtn('month','This Month')}${rangeBtn('year','Year to Date')}${rangeBtn('all','All Time')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:12px;color:var(--text-muted)">${label}</div>
      <button class="btn-secondary btn-sm" onclick="window.print()">🖨 Print</button>
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
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span>Sales Revenue (VATable base)</span><strong>₱${fmt(sales)}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span>Estimated Output VAT (12%)</span><strong>₱${fmt(outputVat)}</strong></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.5">⚠️ Estimate only — assumes VAT-exclusive sales and does not net input VAT on purchases. Confirm exact figures with your accountant before BIR filing. For official forms, attach BIR receipts via <em>Taxes</em>.</div>
      </div>
    </div>
  `;
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
            <thead><tr><th>Date</th><th>Description / Account</th><th>Category</th><th>Source</th><th>Debit</th><th>Credit</th><th>Ref #</th><th>By</th></tr></thead>
            <tbody>${entries.map(e=>`<tr>
              <td>${e.date||'—'}</td>
              <td>${escHtml(e.description||'—')}</td>
              <td><span class="badge badge-blue">${escHtml(e.category||'General')}</span></td>
              <td style="font-size:11px">${e.source&&e.source!=='Finance'?`<span class="badge badge-gray">${escHtml(e.source)}</span>`:'<span style="color:var(--text-muted)">Finance</span>'}</td>
              <td style="color:var(--danger)">${e.type==='debit'?'₱'+fmt(e.amount):'-'}</td>
              <td style="color:var(--success)">${e.type==='credit'?'₱'+fmt(e.amount):'-'}</td>
              <td><code>${escHtml(e.refNumber||'—')}</code></td>
              <td style="font-size:11px">${escHtml(e.addedByName||'—')}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  document.getElementById('ledger-csv-btn')?.addEventListener('click', () => window.exportCSV('ledger', entries, [
    {key:'date',label:'Date'},{key:'description',label:'Description'},{key:'category',label:'Category'},
    {key:'source',label:'Source',get:e=>e.source||'Finance'},
    {key:'debit',label:'Debit',get:e=>e.type==='debit'?(e.amount||0):''},
    {key:'credit',label:'Credit',get:e=>e.type==='credit'?(e.amount||0):''},
    {key:'refNumber',label:'Ref #'},{key:'addedByName',label:'By'}]));
  document.getElementById('add-ledger-btn').addEventListener('click', () => {
    openModal('New Ledger Entry', `
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
        <div class="form-group"><label>Amount (₱)</label><input id="led-amount" type="number" step="0.01"/></div>
        <div class="form-group"><label>Category</label>
          <select id="led-cat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option>Sales Revenue</option><option>Operating Expense</option><option>Payroll</option>
            <option>Tax</option><option>Materials</option><option>Utilities</option>
            <option>Journal Entry (Non-cash)</option><option>Other</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Reference Number</label><input id="led-ref" placeholder="OR #, Invoice #, JE #, etc."/></div>
      <div id="led-file-area"></div>
    `, `<button class="btn-primary" id="save-led-btn">Save Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let ledFile = null;
    Drive.renderUploadArea('led-file-area', r=>{ledFile=r;},{label:'Attach receipt/invoice',dept:'Finance',subfolder:'Ledger'});
    document.getElementById('save-led-btn').addEventListener('click', async () => {
      await db.collection('ledger').add({
        date:       document.getElementById('led-date').value,
        type:       document.getElementById('led-type').value,
        description:document.getElementById('led-desc').value.trim(),
        amount:     parseFloat(document.getElementById('led-amount').value)||0,
        category:   document.getElementById('led-cat').value,
        refNumber:  document.getElementById('led-ref').value.trim(),
        fileUrl:    ledFile?.url||null,
        addedBy:    currentUser.uid,
        addedByName:userProfile?.displayName||currentUser.email,
        createdAt:  firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); Notifs.showToast('Ledger entry saved!');
      renderLedgerTab(container, currentUser, currentRole);
    });
  });
}

// ── Cash Receipt Journal (for cash-based receipts only) ──
async function renderCashReceiptJournal(container, currentUser, currentRole) {
  const snap = await db.collection('cash_receipt_journal').orderBy('date','desc').limit(100).get().catch(()=>({docs:[]}));
  const entries = snap.docs.map(d=>({id:d.id,...d.data()}));
  const totalCash = entries.reduce((s,e)=>s+(e.debitCash||0),0);

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
            <thead><tr><th>Reference</th><th>Date</th><th>Customer</th><th>Debit Cash</th><th>Debit Sales Discount</th><th>Credit A/R</th><th>Credit Sales Revenue</th><th>Credit Sundry (Acct)</th><th>Credit Sundry (Amount)</th></tr></thead>
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
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;

  document.getElementById('add-crj-btn').addEventListener('click', () => {
    openModal('New Cash Receipt Entry', `
      <div class="form-row">
        <div class="form-group"><label>Reference</label><input id="crj-ref" placeholder="OR #, Receipt #…"/></div>
        <div class="form-group"><label>Date</label><input id="crj-date" type="date" value="${today()}"/></div>
      </div>
      <div class="form-group"><label>Customer</label><input id="crj-customer" placeholder="Customer name"/></div>
      <div class="form-row">
        <div class="form-group"><label>Debit: Cash (₱)</label><input id="crj-cash" type="number" step="0.01" value="0"/></div>
        <div class="form-group"><label>Debit: Sales Discount (₱)</label><input id="crj-discount" type="number" step="0.01" value="0"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Credit: Accounts Receivable (₱)</label><input id="crj-ar" type="number" step="0.01" value="0"/></div>
        <div class="form-group"><label>Credit: Sales Revenue (₱)</label><input id="crj-revenue" type="number" step="0.01" value="0"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Credit: Sundry Account</label><input id="crj-sundry-acct" placeholder="e.g. Other Income"/></div>
        <div class="form-group"><label>Credit: Sundry Amount (₱)</label><input id="crj-sundry-amt" type="number" step="0.01" value="0"/></div>
      </div>
    `, `<button class="btn-primary" id="save-crj-btn">Save Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('save-crj-btn').addEventListener('click', async () => {
      const customer = document.getElementById('crj-customer').value.trim();
      const debitCash = parseFloat(document.getElementById('crj-cash').value)||0;
      if (!customer) { Notifs.showToast('Enter a customer name.','error'); return; }
      if (!debitCash) { Notifs.showToast('Enter the cash amount received.','error'); return; }
      await db.collection('cash_receipt_journal').add({
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
      });
      closeModal(); Notifs.showToast('Cash receipt entry saved!');
      renderCashReceiptJournal(container, currentUser, currentRole);
    });
  });
}

// ── Cash Disbursement Journal (for cash-based expenses only) ──
async function renderCashDisbursementJournal(container, currentUser, currentRole) {
  const snap = await db.collection('cash_disbursement_journal').orderBy('date','desc').limit(100).get().catch(()=>({docs:[]}));
  const entries = snap.docs.map(d=>({id:d.id,...d.data()}));
  const totalCash = entries.reduce((s,e)=>s+(e.creditCash||0),0);

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
            <thead><tr><th>Reference</th><th>Date</th><th>Payee</th><th>Credit Cash</th><th>Debit COS–Direct Material</th><th>Debit Accounts Payable</th><th>Debit COS–Direct Labor</th><th>Debit Sundry (Acct)</th><th>Debit Sundry (Amount)</th></tr></thead>
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
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;

  document.getElementById('add-cdj-btn').addEventListener('click', () => {
    openModal('New Cash Disbursement Entry', `
      <div class="form-row">
        <div class="form-group"><label>Reference</label><input id="cdj-ref" placeholder="Voucher #, Check #…"/></div>
        <div class="form-group"><label>Date</label><input id="cdj-date" type="date" value="${today()}"/></div>
      </div>
      <div class="form-group"><label>Payee</label><input id="cdj-payee" placeholder="Payee name"/></div>
      <div class="form-group"><label>Credit: Cash (₱)</label><input id="cdj-cash" type="number" step="0.01" value="0"/></div>
      <div class="form-row">
        <div class="form-group"><label>Debit: COS – Direct Material (₱)</label><input id="cdj-material" type="number" step="0.01" value="0"/></div>
        <div class="form-group"><label>Debit: Accounts Payable (₱)</label><input id="cdj-ap" type="number" step="0.01" value="0"/></div>
      </div>
      <div class="form-group"><label>Debit: COS – Direct Labor (₱)</label><input id="cdj-labor" type="number" step="0.01" value="0"/></div>
      <div class="form-row">
        <div class="form-group"><label>Debit: Sundry Account</label><input id="cdj-sundry-acct" placeholder="e.g. Utilities Expense"/></div>
        <div class="form-group"><label>Debit: Sundry Amount (₱)</label><input id="cdj-sundry-amt" type="number" step="0.01" value="0"/></div>
      </div>
    `, `<button class="btn-primary" id="save-cdj-btn">Save Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('save-cdj-btn').addEventListener('click', async () => {
      const payee = document.getElementById('cdj-payee').value.trim();
      const creditCash = parseFloat(document.getElementById('cdj-cash').value)||0;
      if (!payee) { Notifs.showToast('Enter a payee name.','error'); return; }
      if (!creditCash) { Notifs.showToast('Enter the cash amount disbursed.','error'); return; }
      await db.collection('cash_disbursement_journal').add({
        reference:         document.getElementById('cdj-ref').value.trim(),
        date:              document.getElementById('cdj-date').value,
        payee,
        creditCash,
        debitMaterial:     parseFloat(document.getElementById('cdj-material').value)||0,
        debitAP:           parseFloat(document.getElementById('cdj-ap').value)||0,
        debitLabor:        parseFloat(document.getElementById('cdj-labor').value)||0,
        debitSundryAcct:   document.getElementById('cdj-sundry-acct').value.trim(),
        debitSundryAmount: parseFloat(document.getElementById('cdj-sundry-amt').value)||0,
        addedBy:    currentUser.uid,
        addedByName: window.userProfile?.displayName || currentUser.email,
        createdAt:  firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); Notifs.showToast('Cash disbursement entry saved!');
      renderCashDisbursementJournal(container, currentUser, currentRole);
    });
  });
}

// ── Records & Receipts Tab ──────────────────────
async function renderRecordsTab(container, currentUser, currentRole) {
  const snap = await db.collection('finance_records').orderBy('createdAt','desc').limit(100).get().catch(()=>({docs:[]}));
  const records = snap.docs.map(d=>({id:d.id,...d.data()}));
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
            <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th><th>From/To</th><th>File</th><th>By</th></tr></thead>
            <tbody id="rec-tbody">${records.map(r=>`<tr>
              <td>${r.date||'—'}</td>
              <td><span class="badge badge-blue">${escHtml(r.type||'—')}</span></td>
              <td>${escHtml(r.description||'—')}</td>
              <td>₱${fmt(r.amount)}</td>
              <td>${escHtml(r.party||'—')}</td>
              <td>${r.fileUrl?`<a href="${r.fileUrl}" target="_blank" class="btn-secondary btn-sm">📎 View</a>`:'-'}</td>
              <td style="font-size:11px">${escHtml(r.encodedByName||'—')}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  document.getElementById('add-rec-btn').addEventListener('click', () => {
    openModal('Encode Record / Receipt', `
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
        <div class="form-group"><label>Amount (₱)</label><input id="rec-amount" type="number" step="0.01"/></div>
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

  // ── Accounting Documents (file archive) ──────────────
  const acctSection = document.createElement('div');
  acctSection.style.marginTop = '24px';
  acctSection.innerHTML = renderFileCollection('Accounting Documents', 'fin-acct', currentRole);
  container.appendChild(acctSection);
  bindFileCollection('fin-acct', currentUser, 'Finance', 'Accounting');
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
        ${isRealPresident()?`<button class="btn-secondary btn-sm fin-ca-del" data-id="${a.id}" style="color:var(--danger);margin-left:4px">🗑</button>`:''}
      </div>`).join('');

    list.querySelectorAll('.fin-ca-approve').forEach(btn=>btn.addEventListener('click',async e=>{
      const {id,uid,name,amount}=e.currentTarget.dataset;
      await db.collection('cash_advances').doc(id).update({status:'approved',balance:parseFloat(amount),approvedAt:firebase.firestore.FieldValue.serverTimestamp(),approvedBy:currentUser.uid});
      await Notifs.send(uid,{title:'Cash Advance Approved',body:`Your ₱${fmt(parseFloat(amount))} request was approved.`,icon:'✅',type:'cash_advance',dedupKey:`ca-approved-${id}`});
      Notifs.showToast(`Approved for ${name}`);
      renderFinanceCA(container,currentUser,currentRole);
    }));
    list.querySelectorAll('.fin-ca-reject').forEach(btn=>btn.addEventListener('click',async e=>{
      const {id,uid,name}=e.currentTarget.dataset;
      await db.collection('cash_advances').doc(id).update({status:'rejected'});
      await Notifs.send(uid,{title:'Cash Advance Rejected',body:'Your request was not approved.',icon:'❌',type:'cash_advance',dedupKey:`ca-rejected-${id}`});
      Notifs.showToast(`Rejected for ${name}`);
      renderFinanceCA(container,currentUser,currentRole);
    }));
    list.querySelectorAll('.fin-ca-pay').forEach(btn=>btn.addEventListener('click',async e=>{
      const {id,balance,monthly,uid,name}=e.currentTarget.dataset;
      openModal('Record Payment — '+name,`
        <div class="ca-detail" style="margin-bottom:12px"><span>Balance:</span><strong>₱${fmt(parseFloat(balance))}</strong></div>
        <div class="form-group"><label>Amount Paid</label><input id="fin-pay-amt" type="number" value="${monthly}" min="0" max="${balance}"/></div>
        <div class="form-group"><label>Date</label><input id="fin-pay-date" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
      `,`<button class="btn-primary" id="fin-pay-save">Record</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('fin-pay-save').addEventListener('click',async()=>{
        const paid=parseFloat(document.getElementById('fin-pay-amt').value)||0;
        const date=document.getElementById('fin-pay-date').value;
        const newBal=Math.max(0,(parseFloat(balance)||0)-paid);
        const caSnap=await db.collection('cash_advances').doc(id).get();
        const payments=[...(caSnap.data().payments||[]),{amount:paid,date,recordedBy:currentUser.uid}];
        await db.collection('cash_advances').doc(id).update({balance:newBal,payments,status:newBal===0?'paid':'approved',lastPaymentAt:firebase.firestore.FieldValue.serverTimestamp()});
        if(uid) await Notifs.send(uid,{title:'💳 CA Payment Recorded',body:`₱${fmt(paid)} payment recorded. Remaining: ₱${fmt(newBal)}`,icon:'💳',type:'cash_advance'});
        closeModal();
        Notifs.showToast('Payment recorded!');
        renderFinanceCA(container,currentUser,currentRole);
      });
    }));
    list.querySelectorAll('.fin-ca-del').forEach(btn=>btn.addEventListener('click',async e=>{
      if(!confirm('Delete this record permanently?'))return;
      await db.collection('cash_advances').doc(btn.dataset.id).delete();
      Notifs.showToast('Deleted.');
      renderFinanceCA(container,currentUser,currentRole);
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
  }
}

// ── HR Profiles + Payslip Generator ─────────────────
async function renderFinanceHRProfiles(container, currentUser, currentRole) {
  const isPriv = isFinancePriv();
  container.innerHTML = '<div class="loading-placeholder">Loading worker profiles…</div>';

  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

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
                ${isPriv?`<button class="btn-secondary btn-sm hrp-edit-btn" data-id="${p.id}">✎ Edit</button>`:''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
    </div>
  `;

  // Add profile
  if (isPriv) {
    document.getElementById('hrp-add-btn')?.addEventListener('click', () => openHRProfileForm(null, currentUser, currentRole, ()=>renderFinanceHRProfiles(container,currentUser,currentRole)));
    document.getElementById('hrp-payslip-history-btn')?.addEventListener('click', () => openPayslipHistory(currentUser, currentRole));

    container.querySelectorAll('.hrp-edit-btn').forEach(btn => {
      const profile = profiles.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', () => openHRProfileForm(profile, currentUser, currentRole, ()=>renderFinanceHRProfiles(container,currentUser,currentRole)));
    });
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

  openModal(`${isEdit?'Edit':'Add'} Worker Profile`, `
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
      <div class="form-group"><label>Daily Rate (₱)</label><input id="hrp-daily" type="number" value="${profile?.dailyRate||0}"/></div>
      <div class="form-group"><label>Issued On</label><input id="hrp-issued" type="date" value="${profile?.issuedOn||new Date().toISOString().slice(0,10)}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Meal Allowance</label><input id="hrp-meal" type="number" value="${profile?.allowances?.meal||0}"/></div>
      <div class="form-group"><label>Transport Allowance</label><input id="hrp-transport" type="number" value="${profile?.allowances?.transport||0}"/></div>
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
      <div class="form-group"><label>Cash Advance Balance (₱)</label><input id="hrp-ca-balance" type="number" value="${profile?.caBalance||0}"/></div>
      <div class="form-group" style="display:flex;align-items:center;padding-top:22px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
          <input type="checkbox" id="hrp-include-payroll" ${profile?.includeInPayroll!==false?'checked':''} style="width:18px;height:18px"/>
          Include in Payroll
        </label>
      </div>
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
      dailyRate: parseFloat(document.getElementById('hrp-daily').value)||0,
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
        ${canAct && status!=='draft' ? `<button class="btn-secondary btn-sm ps-override-btn" data-id="${p.id}" style="font-size:11px;margin-left:4px" title="Manually set status">⚙ Override</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  const renderModal = () => {
    openModal('📄 Payslip History', `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Worker</th><th>Period</th><th>Net Pay</th><th>Status</th><th></th></tr></thead>
          <tbody>${!list.length ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No payslips yet</td></tr>' : renderRows()}</tbody>
        </table>
      </div>
    `);
    bindRows();
  };

  const bindRows = () => {
    document.querySelectorAll('.ps-view-btn').forEach(btn => {
      const ps = list.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', () => ps && renderPayslipPreview(ps));
    });
    document.querySelectorAll('.ps-advance-btn').forEach(btn => onClickSafe(btn, async () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        const next = btn.dataset.next;
        if (!ps || !next) return;
        if (!confirm(`Mark ${ps.workerName}'s payslip (${ps.payPeriodStart} – ${ps.payPeriodEnd}) as "${next}"?`)) return;
        const fieldPrefix = { verified:'verified', filed:'filed', submitted:'submitted' }[next];
        await db.collection('payslips').doc(ps.id).update({
          status: next,
          [`${fieldPrefix}By`]: currentUser.uid,
          [`${fieldPrefix}At`]: firebase.firestore.FieldValue.serverTimestamp()
        });
        ps.status = next;
        Notifs.showToast(`Payslip marked as ${next}.`);
        renderModal();
    }));
    document.querySelectorAll('.ps-override-btn').forEach(btn => onClickSafe(btn, async () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        if (!ps) return;
        const choice = prompt(`Manual override — set status for ${ps.workerName}'s payslip.\nOptions: ${PAYSLIP_STAGES.join(', ')}`, ps.status||'draft');
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

function openPayslipGenerator(profile, currentUser, currentRole) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0,10);
  // Compute default period: start of current week Mon
  const dayOfWeek = now.getDay();
  const monday = new Date(now); monday.setDate(now.getDate() - (dayOfWeek===0?6:dayOfWeek-1));
  const periodStart = monday.toISOString().slice(0,10);

  openModal(`📄 Generate Payslip — ${profile.name}`, `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="form-group"><label>Pay Period Start</label><input id="ps-start" type="date" value="${periodStart}"/></div>
      <div class="form-group"><label>Pay Period End</label><input id="ps-end" type="date" value="${todayStr}"/></div>
      <div class="form-group"><label>Pay Date</label><input id="ps-date" type="date" value="${todayStr}"/></div>
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
        <div class="form-group" style="margin-bottom:6px"><label>Daily Rate</label><input id="ps-daily" type="number" value="${profile.dailyRate||0}"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>Rate/HR</label><input id="ps-rph" type="number" value="${(profile.dailyRate/8).toFixed(2)}"/></div>
        <div class="form-group" style="margin-bottom:6px">
          <label>Hours Worked <span style="font-size:9px;color:var(--text-muted);font-weight:400">(auto, editable)</span></label>
          <input id="ps-hrs" type="number" value="0"/>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:6px"><label>OT Rate/HR <span style="font-size:9px;color:var(--text-muted);font-weight:400">(regular rate)</span></label><input id="ps-ot-rate" type="number" value="${(profile.dailyRate/8).toFixed(2)}"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>OT Hours</label><input id="ps-ot-hrs" type="number" value="0"/></div>
        <div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:0"><label>Meal Allow</label><input id="ps-meal" type="number" value="${profile.allowances?.meal||0}"/></div>
        <div class="form-group" style="margin-bottom:0"><label>Transport Allow</label><input id="ps-transport" type="number" value="${profile.allowances?.transport||0}"/></div>
        <div class="form-group" style="margin-bottom:0"><label>Rent Allow</label><input id="ps-rent" type="number" value="0"/></div>
      </div>
    </div>

    <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Deductions</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:6px"><label>SSS</label><input id="ps-sss" type="number" value="0"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>PhilHealth</label><input id="ps-ph" type="number" value="0"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>Pag-IBIG</label><input id="ps-pib" type="number" value="0"/></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:0">
          <label>Cash Advance Deduction</label>
          <input id="ps-ca" type="number" value="0"/>
          <div style="font-size:10px;color:var(--text-muted);margin-top:3px">Balance: ₱<span id="ps-ca-balance-display">${fmt(profile.caBalance||0)}</span> · Remaining after deduction: ₱<span id="ps-ca-remaining-display" style="font-weight:700">${fmt(profile.caBalance||0)}</span></div>
        </div>
        <div class="form-group" style="margin-bottom:0"><label>Other Deduction (Loans, etc.)</label><input id="ps-loans" type="number" value="0"/></div>
        <div class="form-group" style="margin-bottom:0"><label>Taxes</label><input id="ps-tax" type="number" value="0"/></div>
      </div>
    </div>

    <div class="form-group">
      <label>Amount Already Paid (₱)</label><input id="ps-paid" type="number" value="0"/>
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
  const recomputeHours = () => {
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const hrs = computeDayHours(
        document.getElementById(`ps-tin-${i}`)?.value,
        document.getElementById(`ps-tout-${i}`)?.value
      );
      const cell = document.getElementById(`ps-dayhrs-${i}`);
      if (cell) cell.textContent = hrs.toFixed(2);
      total += hrs;
    }
    const totalEl = document.getElementById('ps-computed-total');
    if (totalEl) totalEl.textContent = total.toFixed(2);
    const hrsInput = document.getElementById('ps-hrs');
    if (hrsInput) hrsInput.value = total.toFixed(2);
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

  document.getElementById('ps-preview-btn').addEventListener('click', () => {
    const d = collectPayslipData(profile, currentUser);
    if (d) previewPayslip(d);
  });

  document.getElementById('ps-save-btn').addEventListener('click', async () => {
    const d = collectPayslipData(profile, currentUser);
    if (!d) return;
    d.proofUrl = proofFile?.url || null;
    d.status = 'draft';
    d.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    d.createdBy = currentUser.uid;
    const ref = await db.collection('payslips').add(d);
    // Apply CA deduction to the worker's running balance
    if (d.deductions.other.cashAdvance > 0) {
      await db.collection('worker_profiles').doc(profile.id).update({ caBalance: d.caBalanceAfter });
    }
    // Log to ledger
    await db.collection('ledger_entries').add({
      type: 'payroll',
      description: `Payslip — ${profile.name} (${d.payPeriodStart} to ${d.payPeriodEnd})`,
      amount: d.netPay,
      category: 'Payroll Expense',
      workerId: profile.id,
      workerName: profile.name,
      payslipId: ref.id,
      date: d.payDate,
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeModal();
    Notifs.showToast('Payslip saved as draft! Verify and file it from Payslip History.');
    setTimeout(() => renderPayslipPreview({...d, id: ref.id}, true), 400);
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
  const regTotal = parseFloat((daily * (hrs/8)).toFixed(2));
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
    caBalanceBefore,
    caBalanceAfter,
    totalDeductions,
    totalPay,
    paid,
    netPay,
    schedule: timeLog
  };
}

function previewPayslip(data) {
  const html = buildPayslipHTML(data);
  const win = window.open('','_blank','width=900,height=700');
  if (!win) { Notifs.showToast('Allow popups to preview','error'); return; }
  win.document.write(html);
  win.document.close();
}

function renderPayslipPreview(ps, showExport = false) {
  const html = buildPayslipHTML(ps);
  const win = window.open('','_blank','width=900,height=700');
  if (!win) { Notifs.showToast('Allow popups to view payslip','error'); return; }
  win.document.write(html);
  win.document.close();
}

function buildPayslipHTML(d) {
  const f = n => (parseFloat(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtD = s => { if(!s) return '—'; const dt=new Date(s); return dt.toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}); };
  const co = d.company || 'Barro Kitchens';
  const sched = d.schedule || [];

  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<title>Payslip — ${escHtml(d.workerName)}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #000; background: #f0f0f0; }
  .page { width:210mm; min-height:297mm; margin:0 auto; background:#fff; padding:12mm; }
  table { width:100%; border-collapse:collapse; }
  td, th { border:1px solid #000; padding:3px 5px; vertical-align:middle; font-size:10px; }
  .header-top { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
  .company-logo { width:60px; height:60px; object-fit:contain; border:2px solid #000; padding:2px; flex-shrink:0; }
  .company-name { font-size:22px; font-weight:900; letter-spacing:1px; }
  .company-sub { font-size:9px; line-height:1.6; }
  .section-header { background:#1a237e; color:#fff; font-weight:700; font-size:10px; padding:4px 6px; text-transform:uppercase; letter-spacing:.05em; }
  .field-label { font-weight:700; font-size:9px; text-transform:uppercase; color:#333; }
  .value-cell { font-weight:600; }
  .number-cell { text-align:right; }
  .total-row td { font-weight:700; background:#e3f2fd; }
  .gross-row td { font-weight:800; font-size:12px; background:#1a237e; color:#fff; }
  .net-row td { font-weight:800; font-size:13px; background:#ffeb3b; color:#000; }
  .section-divider { background:#e0e0e0; }
  .no-border td, .no-border th { border:none; }
  .sig-line { border-top:1px solid #000; margin-top:30px; font-size:9px; text-align:center; }
  .export-bar { position:fixed; top:0; left:0; right:0; background:#1a237e; color:#fff; padding:10px 20px; display:flex; gap:10px; align-items:center; z-index:999; }
  .export-bar button { background:#fff; color:#1a237e; border:none; padding:6px 16px; border-radius:6px; font-weight:700; font-size:12px; cursor:pointer; }
  .export-bar button:hover { background:#e3f2fd; }
  @media print {
    .export-bar { display:none !important; }
    body { background:#fff; }
    .page { padding:8mm; }
  }
</style>
</head><body>
<div class="export-bar">
  <span style="font-weight:700">📄 Payslip — ${escHtml(d.workerName)}</span>
  <button onclick="window.print()">🖨 Save as PDF / Print</button>
  <button onclick="downloadJPEG()">📷 Save as JPEG</button>
  ${d.proofUrl ? `<a href="${d.proofUrl}" target="_blank" style="color:#FFD60A;font-weight:600;margin-left:8px">📎 Transfer Proof</a>` : ''}
  <button onclick="window.close()" style="margin-left:auto;background:rgba(255,255,255,0.15);color:#fff">✕ Close</button>
</div>
<div style="height:48px"></div>
<div class="page" id="payslip-page">
  <!-- Header -->
  <div class="header-top">
    <img src="icons/barro-industries.png" class="company-logo" onerror="this.style.display='none'" alt=""/>
    <div>
      <div class="company-name">${escHtml(co.toUpperCase())}</div>
      <div class="company-sub">
        NEILBARRO STEEL &amp; METAL FABRICATION SERVICES<br/>
        PUROK 6, CARLATAN, 2500, CITY OF SAN FERNANDO, LA UNION, PHILIPPINES<br/>
        CONTACT: NEIL BARRO, 0927-683-6300<br/>
        TIN: 951-145-613-000
      </div>
    </div>
  </div>
  <div style="border:2px solid #000;padding:0;margin-top:4px">

    <!-- Employee Information -->
    <div class="section-header">Employee Information</div>
    <table>
      <tr>
        <td class="field-label" style="width:15%">Full Name</td>
        <td class="value-cell" style="width:35%">${escHtml(d.workerName||'')}</td>
        <td class="field-label" style="width:10%">TIN</td>
        <td style="width:40%">${escHtml(d.tinNum||'')}</td>
      </tr>
      <tr>
        <td class="field-label">ID Number</td><td>${escHtml(d.workerIdNum||'')}</td>
        <td class="field-label">PhilHealth</td><td>${escHtml(d.phNum||'')}</td>
      </tr>
      <tr>
        <td class="field-label">Job Title</td><td>${escHtml(d.jobTitle||'')}</td>
        <td class="field-label">SSS</td><td>${escHtml(d.ssNum||'')}</td>
      </tr>
      <tr>
        <td class="field-label">Department</td><td>${escHtml(d.department||'')}</td>
        <td class="field-label">PAG IBIG</td><td>${escHtml(d.pagibigNum||'')}</td>
      </tr>
    </table>

    <!-- Pay Period -->
    <div class="section-header">Pay Period Details</div>
    <table>
      <tr>
        <td class="field-label" style="width:20%">Pay Period Covered</td>
        <td style="width:30%">${fmtD(d.payPeriodStart)} – ${fmtD(d.payPeriodEnd)}</td>
        <td class="field-label" style="width:15%">Pay Date</td>
        <td>${fmtD(d.payDate)}</td>
      </tr>
    </table>

    <!-- Earnings -->
    <div class="section-header">Earnings</div>
    <table>
      <tr>
        <th style="width:22%;text-align:center">Regular</th>
        <th style="width:10%;text-align:right"></th>
        <th style="width:16%;text-align:center">Overtime</th>
        <th style="width:10%;text-align:right"></th>
        <th style="width:22%;text-align:center">Allowances:</th>
        <th style="width:10%;text-align:right"></th>
      </tr>
      <tr>
        <td class="field-label">Daily Rate</td>
        <td class="number-cell">${f(d.regular?.dailyRate)}</td>
        <td class="field-label">OT Rate/hr</td>
        <td class="number-cell">${f(d.overtime?.ratePerHr)}</td>
        <td class="field-label">Transport</td>
        <td class="number-cell">${(d.allowances?.transport||0)>0?f(d.allowances.transport):'-'}</td>
      </tr>
      <tr>
        <td class="field-label">Rate/HR</td>
        <td class="number-cell">${f(d.regular?.ratePerHr)}</td>
        <td class="field-label">OT Hours</td>
        <td class="number-cell">${(d.overtime?.hours||0)>0?f(d.overtime.hours):'-'}</td>
        <td class="field-label">Meal</td>
        <td class="number-cell">${(d.allowances?.meal||0)>0?f(d.allowances.meal):'-'}</td>
      </tr>
      <tr>
        <td class="field-label">HRS Worked</td>
        <td class="number-cell">${f(d.regular?.hrsWorked)}</td>
        <td class="field-label" colspan="2"></td>
        <td class="field-label">Rent</td>
        <td class="number-cell">${(d.allowances?.rent||0)>0?f(d.allowances.rent):'-'}</td>
      </tr>
      <tr class="total-row">
        <td>Total:</td><td class="number-cell">${f(d.regular?.total)}</td>
        <td>Total:</td><td class="number-cell">${(d.overtime?.total||0)>0?f(d.overtime.total):'-'}</td>
        <td>Total:</td><td class="number-cell">${(d.allowances?.total||0)>0?f(d.allowances.total):'-'}</td>
      </tr>
      <tr class="gross-row">
        <td colspan="2" style="text-align:right">Total Gross Pay</td>
        <td colspan="4" style="text-align:center;font-size:14px">${f(d.grossPay)}</td>
      </tr>
    </table>

    <!-- Deductions -->
    <div class="section-header">Deductions</div>
    <table>
      <tr>
        <th style="width:22%;text-align:center">Government Mandatory</th>
        <th style="width:10%"></th>
        <th style="width:28%;text-align:center" colspan="2">Other Deductions:</th>
        <th style="width:20%;text-align:center">Company Charges</th>
        <th style="width:10%"></th>
      </tr>
      <tr>
        <td class="field-label">SSS</td>
        <td class="number-cell">${(d.deductions?.govt?.sss||0)>0?f(d.deductions.govt.sss):''}</td>
        <td class="field-label">Cash Advance</td>
        <td class="number-cell">${(d.deductions?.other?.cashAdvance||0)>0?f(d.deductions.other.cashAdvance):''}</td>
        <td class="field-label">Company Charges</td>
        <td></td>
      </tr>
      <tr>
        <td class="field-label">PhilHealth</td>
        <td class="number-cell">${(d.deductions?.govt?.philhealth||0)>0?f(d.deductions.govt.philhealth):''}</td>
        <td class="field-label">Loans</td>
        <td class="number-cell">${(d.deductions?.other?.loans||0)>0?f(d.deductions.other.loans):''}</td>
        <td class="field-label">Taxes</td>
        <td class="number-cell">${(d.deductions?.other?.taxes||0)>0?f(d.deductions.other.taxes):''}</td>
      </tr>
      <tr>
        <td class="field-label">Pag-IBIG</td>
        <td class="number-cell">${(d.deductions?.govt?.pagibig||0)>0?f(d.deductions.govt.pagibig):''}</td>
        <td colspan="4"></td>
      </tr>
      <tr class="total-row">
        <td>Total</td><td class="number-cell">${(d.deductions?.govt?.total||0)>0?f(d.deductions.govt.total):'-'}</td>
        <td>Total</td><td class="number-cell">${(d.deductions?.other?.total||0)>0?f(d.deductions.other.total):'-'}</td>
        <td colspan="2"></td>
      </tr>
    </table>
    <table>
      <tr class="total-row">
        <td style="width:30%;font-weight:700">Total Deductions</td>
        <td class="number-cell">${f(d.totalDeductions)}</td>
        <td colspan="2"></td>
      </tr>
      <tr style="background:#bbdefb;">
        <td style="font-weight:800;font-size:12px">TOTAL PAY</td>
        <td class="number-cell" style="font-weight:800;font-size:12px">${f(d.totalPay)}</td>
        <td colspan="2"></td>
      </tr>
      <tr>
        <td class="field-label">PAID</td>
        <td class="number-cell">${(d.paid||0)>0?f(d.paid):'-'}</td>
        <td colspan="2"></td>
      </tr>
      <tr class="net-row">
        <td>NET PAY:</td>
        <td class="number-cell">${f(d.netPay)}</td>
        <td colspan="2"></td>
      </tr>
    </table>

    <!-- Signatures -->
    <table style="margin-top:4px">
      <tr>
        <td style="padding:24px 10px 6px;text-align:center;width:33%">
          <div style="border-top:1px solid #000;padding-top:4px">${escHtml(d.workerName||'')}</div>
          <div style="font-size:9px;color:#555">Acknowledged By</div>
        </td>
        <td style="padding:24px 10px 6px;width:34%"></td>
        <td style="padding:24px 10px 6px;text-align:center;width:33%">
          <div style="border-top:1px solid #000;padding-top:4px">${escHtml(d.preparedBy||'')}</div>
          <div style="font-size:9px;color:#555">Prepared By</div>
        </td>
      </tr>
    </table>

    <!-- Schedule -->
    <div class="section-header" style="margin-top:4px">Daily Time Log</div>
    <table>
      <tr>${(d.schedule||[]).map(s=>`<th style="text-align:center;font-size:9px">${s.day}</th>`).join('')}</tr>
      <tr>${(d.schedule||[]).map(s=>`<td style="text-align:center;font-size:8px">${s.timeIn&&s.timeOut?`${s.timeIn}–${s.timeOut}`:'REST'}</td>`).join('')}</tr>
      <tr>${(d.schedule||[]).map(s=>`<td style="text-align:center;font-size:9px;font-weight:700">${(s.hours||0).toFixed?s.hours.toFixed(2):s.hours} hrs</td>`).join('')}</tr>
    </table>
    ${d.proofUrl ? `<div style="margin-top:8px;padding:6px;background:#f5f5f5;border:1px solid #ccc;border-radius:4px;font-size:10px">
      📎 Transfer proof on file: <a href="${d.proofUrl}" target="_blank">${d.proofUrl}</a>
    </div>` : ''}
  </div>
</div>
<script>
async function downloadJPEG() {
  const btn = document.querySelector('.export-bar button:nth-child(3)');
  if(btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
  // Load html2canvas from CDN
  if (!window.html2canvas) {
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  }
  const el = document.getElementById('payslip-page');
  const canvas = await html2canvas(el, { scale:2, useCORS:true, backgroundColor:'#fff', logging:false });
  const link = document.createElement('a');
  link.download = 'payslip-${(d.workerName||'worker').replace(/\\s+/g,'-')}-${d.payPeriodStart||''}.jpg';
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
  if(btn) { btn.textContent = '📷 Save as JPEG'; btn.disabled = false; }
}
<\/script>
</body></html>`;
}

// ── Finance Overview ──────────────────────────────
async function renderFinanceOverview(container, currentUser, currentRole) {
  // These collection-wide reads are only permitted for finance/admin by the
  // Firestore rules. A non-finance user who merely belongs to the Finance dept
  // can open this tab, so degrade gracefully instead of crashing the screen.
  const [expSnap, salSnap] = await Promise.all([
    db.collection('expenses').get().catch(()=>({docs:[]})),
    fetchUsersWithPayroll().catch(()=>({docs:[]}))
  ]);
  const expenses   = expSnap.docs.map(d => d.data());
  const users      = salSnap.docs.map(d => d.data());
  const totalExp   = expenses.reduce((s,e) => s + (e.amount||0), 0);
  const pendingExp = expenses.filter(e => e.status==='pending').reduce((s,e) => s + (e.amount||0), 0);
  const payroll    = users.reduce((s,u) => s + (u.salary||0) + (u.allowance||0) - (u.deductions||0), 0);

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Monthly Payroll</div><div class="kpi-value">₱${fmt(payroll)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Total Expenses</div><div class="kpi-value">₱${fmt(totalExp)}</div></div>
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
                <td>${e.fileUrl?`<a href="${e.fileUrl}" target="_blank" class="btn-icon">📎</a>`:''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  document.getElementById('exp-csv-btn')?.addEventListener('click', () => window.exportCSV('expenses', expenses, [
    {key:'date',label:'Date'},{key:'description',label:'Description'},{key:'category',label:'Category'},
    {key:'amount',label:'Amount',get:e=>e.amount||0},{key:'submittedByName',label:'By'},{key:'status',label:'Status',get:e=>e.status||'pending'},{key:'fileUrl',label:'Receipt'}]));
}

// ══════════════════════════════════════════════════
//  SALES — BARRO KITCHENS
// ══════════════════════════════════════════════════
window.renderSales = async function(currentUser, currentRole, subtab = 'BK Quotes') {
  window._bkCurrentUser = currentUser;
  window._bkCurrentRole = currentRole;
  const c = deptContainer();
  const isPriv = ['president','owner','manager','finance'].includes(currentRole);
  const tools = [
    { icon:'📝', label:'BK Quotes',      sub:'BK Quotes'      },
    { icon:'📊', label:'Quotations',     sub:'Quotations'     },
    { icon:'🤝', label:'Partner Quotes', sub:'Partner Quotes' },
    { icon:'👤', label:'Clients',        sub:'Clients'        },
    { icon:'📋', label:'Work Plans',     sub:'Work Plans'     },
    { icon:'📄', label:'Proposals',      sub:'Proposals'      },
  ];
  c.innerHTML = `
    <div class="page-header">
      <div>
        <h2>🍽️ Barro Kitchens — Sales</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">One-stop kitchen design & build</p>
      </div>
    </div>
    <!-- Work Tools Quick Launch -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      ${tools.map(t=>`
        <button class="sales-tool-btn" data-sub="${t.sub}" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 8px;background:var(--surface);border:1.5px solid var(--border);border-radius:14px;cursor:pointer;transition:all 0.18s;font-size:11px;font-weight:700;color:var(--text);letter-spacing:.02em">
          <span style="font-size:22px">${t.icon}</span>
          ${t.label}
        </button>`).join('')}
    </div>
    <div class="subtab-bar">
      ${['BK Quotes','Quotations','Partner Quotes','Clients','Work Plans','Proposals','Tasks'].map(s =>
        `<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`
      ).join('')}
    </div>
    <div id="sales-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadSalesContent(currentUser, currentRole, subtab);

  // Tool button clicks jump to that subtab
  c.querySelectorAll('.sales-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      c.querySelector(`.subtab-btn[data-sub="${btn.dataset.sub}"]`)?.classList.add('active');
      loadSalesContent(currentUser, currentRole, btn.dataset.sub);
      // Scroll to content
      document.getElementById('sales-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = 'var(--primary-light)';
      btn.style.background  = 'var(--surface2)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = 'var(--border)';
      btn.style.background  = 'var(--surface)';
    });
  });

  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSalesContent(currentUser, currentRole, btn.dataset.sub);
    });
  });
};

async function loadSalesContent(currentUser, currentRole, sub) {
  const content = document.getElementById('sales-content');
  switch(sub) {
    case 'BK Quotes':
      // Full standalone quote builder (iframe)
      content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <span style="font-size:13px;color:var(--text-muted)">Use the builder below to create quotes. Print/PDF when ready.</span>
          <button class="btn-secondary btn-sm" onclick="document.getElementById('bk-qb-frame').contentWindow.print()">🖨 Print / PDF</button>
        </div>
        <iframe id="bk-qb-frame" src="quote-builder-v2.html"
          style="width:100%;height:calc(100dvh - 200px);min-height:500px;border:none;border-radius:12px;background:#f5f6fa;"
          allow="print" loading="lazy"></iframe>`;
      break;
    case 'Quotations':
      renderBKQuotationsSummary(content, currentUser, currentRole);
      break;
    case 'Partner Quotes':
      renderSalesPartnerQuotes(content, currentUser, currentRole);
      break;
    case 'Clients':
      await renderClientProfiles(content, currentUser, currentRole, 'barro');
      break;
    case 'Work Plans':
      await renderDocCollection(content, 'work_plans', 'Work Plans', currentUser, currentRole, { icon:'📋', color:'#e65100', dept:'Sales' });
      break;
    case 'Proposals':
      content.innerHTML = renderFileCollection('Proposals', 'sales-props', currentRole);
      bindFileCollection('sales-props', currentUser, 'Sales', 'Proposals');
      break;
    case 'Tasks':
      await renderDeptTasks(content, 'Sales', currentUser, currentRole);
      break;
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
      <input type="number" value="${l.qty||1}" data-i="${i}" data-f="qty" min="1" style="padding:5px 6px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:13px;width:100%"/>
      <select data-i="${i}" data-f="unit" style="padding:5px 4px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:11px">
        ${['pc','set','lm','sqm','hr','lot','unit'].map(u=>`<option ${u===l.unit?'selected':''}>${u}</option>`).join('')}
      </select>
      <input type="number" value="${l.price||0}" data-i="${i}" data-f="price" min="0" step="0.01" placeholder="Unit price" style="padding:5px 8px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:13px;width:100%"/>
      <button class="btn-icon" data-rm="${i}" style="color:#ff453a;font-size:16px;padding:4px 7px">🗑</button>
    </div>`;

  openModal(existing ? `Edit Quote BK-${existing.quoteNumber||''}` : '🍽️ New Barro Kitchens Quote', `
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
        <input id="bkq-discount" type="number" min="0" value="${existing?.discount||0}" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"/>
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
    <div style="display:grid;grid-template-columns:130px 1fr 60px 60px 100px 34px;gap:5px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:var(--text-muted)">CATEGORY</div>
      <div style="font-size:11px;font-weight:700;color:var(--text-muted)">DESCRIPTION</div>
      <div style="font-size:11px;font-weight:700;color:var(--text-muted)">QTY</div>
      <div style="font-size:11px;font-weight:700;color:var(--text-muted)">UNIT</div>
      <div style="font-size:11px;font-weight:700;color:var(--text-muted)">UNIT PRICE</div>
      <div></div>
    </div>
    <div id="bkq-lines"></div>
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
      data.quoteNumber = `BK${new Date().getFullYear().toString().slice(-2)}${seq}`;
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
  w.document.write(`<!DOCTYPE html><html><head><title>Barro Kitchens — Quote ${q.quoteNumber}</title>
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
      <div class="q-no">Quote ${q.quoteNumber}</div>
      <div>Date: ${q.date}</div>
      <div>Valid Until: ${q.validUntil||'—'}</div>
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
async function renderBKQuotationsSummary(container, currentUser, currentRole) {
  const isPrivileged = ['president','manager','finance'].includes(currentRole);
  container.innerHTML = '<div class="loading-placeholder">Loading…</div>';
  const q = isPrivileged
    ? db.collection('bk_quotes').orderBy('createdAt','desc')
    : db.collection('bk_quotes').where('createdBy','==',currentUser.uid).orderBy('createdAt','desc');
  const snap = await q.get().catch(()=>({docs:[]}));
  const quotes = snap.docs.map(d=>({id:d.id,...d.data()}));

  const total      = quotes.reduce((s,q)=>s+(q.total||0),0);
  const accepted   = quotes.filter(q=>q.status==='accepted');
  const acceptedT  = accepted.reduce((s,q)=>s+(q.total||0),0);
  const sent       = quotes.filter(q=>q.status==='sent').length;
  const draft      = quotes.filter(q=>q.status==='draft').length;

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-card"><div class="stat-num">${quotes.length}</div><div class="stat-label">Total Quotes</div></div>
      <div class="stat-card"><div class="stat-num">₱${fmt(total)}</div><div class="stat-label">Quote Value</div></div>
      <div class="stat-card"><div class="stat-num">${accepted.length}</div><div class="stat-label">Accepted</div></div>
      <div class="stat-card"><div class="stat-num">₱${fmt(acceptedT)}</div><div class="stat-label">Accepted Value</div></div>
      <div class="stat-card"><div class="stat-num">${sent}</div><div class="stat-label">Sent</div></div>
      <div class="stat-card"><div class="stat-num">${draft}</div><div class="stat-label">Drafts</div></div>
    </div>
    <h4 style="font-weight:700;margin-bottom:10px">All Quotations</h4>
    <div class="item-list">
      ${!quotes.length
        ? `<div class="empty-state"><div class="empty-icon">📋</div><h4>No quotations yet</h4></div>`
        : quotes.map(q=>`
        <div class="item-card" style="display:flex;align-items:center;gap:12px">
          <div style="flex:1">
            <div class="item-title" style="font-size:13px">BK-${q.quoteNumber||q.id.slice(-6).toUpperCase()} — ${escHtml(q.clientName||'Unnamed')}</div>
            <div class="item-meta" style="margin-top:4px">
              <span>${escHtml(q.scope||'Custom')}</span>
              <span>${escHtml(q.agentName||'—')}</span>
              ${q.date?`<span>${q.date}</span>`:''}
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700">₱${fmt(q.total||0)}</div>
            <span class="badge ${statusBadge(q.status)}" style="margin-top:4px">${q.status||'draft'}</span>
          </div>
        </div>`).join('')}
    </div>
  `;
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
    <div class="subtab-bar">
      ${['Projects','Clients','Product Designs','References','Tasks'].map(s =>
        `<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`
      ).join('')}
    </div>
    <div id="design-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadDesignContent(currentUser, currentRole, subtab);
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => { c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); loadDesignContent(currentUser, currentRole, btn.dataset.sub); });
  });
};

async function loadDesignContent(currentUser, currentRole, sub) {
  const content = document.getElementById('design-content');
  switch(sub) {
    case 'Projects':    await renderProjects(content, currentUser, currentRole); break;
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

async function renderProjects(container, currentUser, currentRole) {
  const snap = await db.collection('projects').orderBy('createdAt','desc').get();
  const projects = snap.docs.map(d => ({id:d.id,...d.data()}));
  const canAdd = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager';

  container.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      ${canAdd?`<button class="btn-primary btn-sm" id="add-project-btn">+ New Project</button>`:''}
    </div>
    <div class="item-list">
      ${!projects.length
        ? `<div class="empty-state"><div class="empty-icon">🎨</div><h4>No projects yet</h4></div>`
        : projects.map(p => `
          <div class="item-card" data-id="${p.id}">
            <div class="item-top">
              <div class="item-title">${escHtml(p.name)}</div>
              <span class="badge ${statusBadge(p.status)}">${p.status||'active'}</span>
            </div>
            <div class="item-meta">
              ${p.client?`<span>👤 ${escHtml(p.client)}</span>`:''}
              ${p.dueDate?`<span>📅 ${p.dueDate}</span>`:''}
            </div>
          </div>`).join('')}
    </div>
  `;

  document.getElementById('add-project-btn')?.addEventListener('click', () => {
    openModal('New Project', `
      <div class="form-group"><label>Project Name</label><input id="proj-name" placeholder="e.g. Kitchen Design — ABC Corp"/></div>
      <div class="form-group"><label>Client</label><input id="proj-client" placeholder="Client name"/></div>
      <div class="form-row">
        <div class="form-group"><label>Start Date</label><input id="proj-start" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Due Date</label><input id="proj-due" type="date"/></div>
      </div>
      <div class="form-group"><label>Notes</label><textarea id="proj-notes" rows="3"></textarea></div>
    `, `<button class="btn-primary" id="save-proj-btn">Save Project</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('save-proj-btn').addEventListener('click', async () => {
      await db.collection('projects').add({
        name:      document.getElementById('proj-name').value.trim(),
        client:    document.getElementById('proj-client').value.trim(),
        startDate: document.getElementById('proj-start').value,
        dueDate:   document.getElementById('proj-due').value,
        notes:     document.getElementById('proj-notes').value.trim(),
        status:    'active',
        createdBy: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); renderDesign(currentUser, currentRole, 'Projects');
    });
  });
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
    <div class="subtab-bar" style="flex-wrap:wrap">
      ${subtabs.map(s =>
        `<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`
      ).join('')}
    </div>
    <div id="it-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadITContent(currentUser, currentRole, subtab, canEdit);
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadITContent(currentUser, currentRole, btn.dataset.sub, canEdit);
    });
  });
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
      openModal('New IT Ticket', `
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
        openModal('Add Asset', `
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
          openModal('Edit Asset', `
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
      openModal('Add Software / License', `
        <div class="form-row">
          <div class="form-group"><label>Software Name</label><input id="sw-name" placeholder="e.g. Adobe Creative Cloud"/></div>
          <div class="form-group"><label>Vendor</label><input id="sw-vendor" placeholder="e.g. Adobe"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>License Type</label>
            <select id="sw-ltype"><option>Subscription</option><option>Perpetual</option><option>Open Source</option><option>Trial</option><option>Volume</option></select>
          </div>
          <div class="form-group"><label>Seats / Users</label><input id="sw-seats" type="number" placeholder="1"/></div>
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
      openModal('Grant Access', `
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
        if (!confirm(`Revoke access for ${btn.dataset.emp}?`)) return;
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
            </div>`).join('')}
      </div>`;
    document.getElementById('new-net-btn')?.addEventListener('click', () => {
      openModal('Add Network Note', `
        <div class="form-row">
          <div class="form-group"><label>Title</label><input id="net-title" placeholder="e.g. Office WiFi Credentials"/></div>
          <div class="form-group"><label>Type</label>
            <select id="net-type"><option>WiFi</option><option>Router / Modem</option><option>IP Config</option><option>VPN</option><option>ISP Details</option><option>Server</option><option>General</option></select>
          </div>
        </div>
        <div class="form-group"><label>Content / Notes</label><textarea id="net-content" rows="6" placeholder="SSID, passwords, IPs, ports, etc."></textarea></div>
      `, `<button class="btn-primary" id="save-net-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-net-btn').addEventListener('click', async () => {
        const title = document.getElementById('net-title').value.trim();
        if (!title) { Notifs.showToast('Enter a title.','error'); return; }
        await db.collection('it_network').add({
          title, type: document.getElementById('net-type').value,
          content: document.getElementById('net-content').value,
          createdBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal(); loadITContent(currentUser, currentRole, 'Network', canEdit);
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
  openModal(`🎫 ${ticket.title||'Ticket'}`, `
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

window.renderBrilliantSteel = async function(currentUser, currentRole, subtab = 'Dashboard') {
  const c = deptContainer();
  const tabs = ['Dashboard','Quotations Summary','Client Data','Files'];
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
    case 'Dashboard':          await renderBSDashboard(content, currentUser, currentRole); break;
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
  const snap = await db.collection('bs_quotes').get();
  const quotes = snap.docs.map(d=>({id:d.id,...d.data()}));
  const total   = quotes.reduce((s,q)=>s+(q.total||0),0);
  const pending = quotes.filter(q=>q.approvalStatus==='pending_review').length;
  const approved= quotes.filter(q=>q.approvalStatus==='approved').length;
  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Total Quotes</div><div class="kpi-value">${quotes.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Pipeline Value</div><div class="kpi-value">₱${fmt(total)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Pending Approval</div><div class="kpi-value">${pending}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Approved</div><div class="kpi-value">${approved}</div></div>
    </div>
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
        <div class="bs-fg"><label>Client #</label><input type="number" id="bs-qno-seq" value="1" min="1" max="999" style="max-width:70px;text-align:center"/></div>
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
        <div class="bs-fg"><label>W (mm)</label><input type="number" id="bs-dim-w" placeholder="—"/></div>
        <div class="bs-fg"><label>D (mm)</label><input type="number" id="bs-dim-d" placeholder="—"/></div>
        <div class="bs-fg"><label>H (mm)</label><input type="number" id="bs-dim-h" placeholder="—"/></div>
        <div class="bs-fg"><label>Qty</label><input type="number" id="bs-dim-qty" value="1" min="1"/></div>
        <div class="bs-fg"><label>Unit Price (₱)</label>
          <input type="number" id="bs-unit-price" placeholder="Auto" style="background:#fffbf0;border-color:#f0d080"/>
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
            DP %: <input type="number" id="bs-dp-pct-input" value="65" min="0" max="100" style="width:55px;padding:3px;font-size:12px"/>
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
          <td style="text-align:center"><input type="number" class="bs-qty-inp" value="${line.qty}" min="1" data-id="${line.id}" style="width:50px;text-align:center;border:1.5px solid var(--border);border-radius:4px;padding:3px;font-size:12px"/></td>
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
              ${canSeeAll&&(status==='pending_approval'||status==='pending_review'||status==='sent')?`
                <button class="btn-primary btn-sm bs-approve-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${escHtml(q.clientName||'')}" data-qno="${escHtml(q.quoteNumber||'')}">✅ Approve</button>
                <button class="btn-danger btn-sm bs-reject-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${escHtml(q.clientName||'')}" data-qno="${escHtml(q.quoteNumber||'')}">❌ Reject</button>
                <button class="btn-secondary btn-sm bs-edit-return-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${escHtml(q.clientName||'')}" data-qno="${escHtml(q.quoteNumber||'')}">✎ Edit &amp; Return</button>
              `:''}
              ${(status==='filed'||status==='approved')?`<button class="btn-success btn-sm bs-so-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" data-client="${escHtml(q.clientName||'')}" data-total="${q.total||q.grandTotal||0}" data-co="${escHtml(q.company||'BS')}" ${q.salesOrderId?'disabled':''}>${q.salesOrderId?'✓ Ordered':'🧾 Sales Order'}</button>`:''}
              ${canDeleteDirect
                ? `<button class="btn-secondary btn-sm bs-del-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" style="color:var(--danger)">🗑 Delete</button>`
                : `<button class="btn-secondary btn-sm bs-delreq-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" ${q.deleteRequested?'disabled':''}>${q.deleteRequested?'⏳ Requested':'🗑 Request Delete'}</button>`}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div></div>`;

  // ── Quote analytics: made vs successful ──
  const totalMade   = all.length;
  const successful  = filed.length;                       // filed/approved = won
  const winRate     = totalMade ? Math.round(successful/totalMade*100) : 0;
  const wonValue    = filed.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
  const pipelineVal = all.filter(q=>!(q.status==='rejected'||q.approvalStatus==='rejected'))
                         .reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
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

// Convert a won quote into a Sales Order: capture payment + receipt, route to Finance.
async function openSalesOrderModal(d, currentUser, currentRole, container){
  const total = parseFloat(d.total)||0;
  openModal('🧾 Create Sales Order', `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Client <strong>${escHtml(d.client||'')}</strong> · Quote ${escHtml(d.qno||'')}</div>
    <div class="form-group"><label>Project / Scope</label><input id="so-project" value="${escHtml((d.client||'')+' — '+(d.qno||''))}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Contract Amount (₱)</label><input id="so-contract" type="number" step="0.01" value="${total}"/></div>
      <div class="form-group"><label>Payment Received (₱)</label><input id="so-paid" type="number" step="0.01" placeholder="e.g. downpayment"/></div>
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
      const ref=await db.collection('sales_orders').add({
        quoteId:d.id, quoteNumber:d.qno||'', clientName:d.client||'', company:d.co||'BS',
        project, contractAmount:contract, paymentReceived:paid,
        paymentMethod:document.getElementById('so-method').value,
        notes:document.getElementById('so-notes').value.trim(),
        receiptUrl:receipt?.url||null, receiptName:receipt?.name||null,
        status:'pending', createdBy:currentUser.uid, createdByName:userProfile?.displayName||currentUser.email,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      try{ await db.collection('bs_quotes').doc(d.id).update({salesOrderId:ref.id}); }catch(_){}
      window.logAudit&&window.logAudit('create','sales_order',ref.id,{client:d.client, contract, paid});
      const who=userProfile?.displayName||currentUser.email;
      try{ await Notifs.sendToDept('Finance',{ title:'🧾 New Sales Order', body:`${who}: ${d.client} — ₱${contract.toLocaleString()} (₱${paid.toLocaleString()} received). Record income + verify receipt.`, icon:'🧾', type:'sales_order', link:'sales-orders' }); }catch(_){}
      try{ await Notifs.sendToOwner({ title:'🧾 New Sales Order', body:`${d.client} — ₱${contract.toLocaleString()} closed by ${who}.`, icon:'🧾', type:'sales_order' }); }catch(_){}
      closeModal(); Notifs.showToast('Sales order created — sent to Finance');
      renderBSQuotationsSummary(container, currentUser, currentRole);
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
}

// Finance/admin view of incoming sales orders — record income to the ledger.
window.renderSalesOrders = async function(){
  const c = deptContainer();
  const isFin = ['president','owner','manager','finance'].includes(currentRole) || (window.currentDepts||[]).includes('Finance');
  c.innerHTML='<div class="loading-placeholder">Loading sales orders…</div>';
  const snap = await db.collection('sales_orders').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
  const orders = snap.docs.map(d=>({id:d.id,...d.data()}));
  const pending = orders.filter(o=>o.status!=='recorded');
  const totalContract = orders.reduce((s,o)=>s+(o.contractAmount||0),0);
  const totalPaid = orders.reduce((s,o)=>s+(o.paymentReceived||0),0);
  c.innerHTML = `
    <div class="page-header"><h2>🧾 Sales Orders</h2></div>
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Orders</div><div class="kpi-value">${orders.length}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">To Record</div><div class="kpi-value">${pending.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Contract ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalContract)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Received ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalPaid)}</div></div>
    </div>
    <div class="card"><div class="card-body" style="padding:0">
    ${!orders.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">🧾</div><h4>No sales orders yet</h4><p>They appear here when a won quote is converted to a sales order.</p></div>':
    `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Date</th><th>Client / Project</th><th>Contract</th><th>Received</th><th>Method</th><th>Receipt</th><th>By</th><th>Status</th>${isFin?'<th></th>':''}</tr></thead>
      <tbody>${orders.map(o=>`<tr>
        <td>${o.createdAt?.toDate?o.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric'}):''}</td>
        <td><strong>${escHtml(o.clientName||'')}</strong><div style="font-size:11px;color:var(--text-muted)">${escHtml(o.project||'')}${o.quoteNumber?' · '+escHtml(o.quoteNumber):''}</div></td>
        <td>₱${fmt(o.contractAmount||0)}</td>
        <td>₱${fmt(o.paymentReceived||0)}</td>
        <td style="font-size:12px">${escHtml(o.paymentMethod||'')}</td>
        <td>${o.receiptUrl?`<a href="${escHtml(o.receiptUrl)}" target="_blank" class="btn-icon">📎</a>`:'—'}</td>
        <td style="font-size:11px">${escHtml(o.createdByName||'')}</td>
        <td><span class="badge ${o.status==='recorded'?'badge-green':'badge-orange'}">${escHtml(o.status||'pending')}</span></td>
        ${isFin?`<td>${o.status!=='recorded'?`<button class="btn-success btn-sm so-record-btn" data-id="${o.id}" data-amt="${o.paymentReceived||0}" data-client="${escHtml(o.clientName||'')}">Record Income</button>`:'✓'}</td>`:''}
      </tr>`).join('')}</tbody>
    </table></div>`}
    </div></div>`;
  if(isFin){
    c.querySelectorAll('.so-record-btn').forEach(b=>b.addEventListener('click', async ()=>{
      const amt=parseFloat(b.dataset.amt)||0;
      if(!confirm(`Record ₱${amt.toLocaleString()} from ${b.dataset.client} as income to the ledger?`)) return;
      try{
        await db.collection('ledger').add({ date: today(), description:'Sales order — '+b.dataset.client, category:'Sales', type:'credit', amount:amt, source:'Finance', addedByName:userProfile?.displayName||currentUser.email, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        await db.collection('sales_orders').doc(b.dataset.id).update({status:'recorded', recordedAt:firebase.firestore.FieldValue.serverTimestamp()});
        window.logAudit&&window.logAudit('create','ledger',null,{source:'sales_order', amount:amt});
        Notifs.showToast('Income recorded to ledger');
        window.renderSalesOrders();
      }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
    }));
  }
};

function bindQuoteActions(el, currentUser, currentRole, container) {
  // Direct delete (president/manager only — Firestore rules enforce isAdmin)
  el.querySelectorAll('.bs-del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      if (!confirm(`Delete quote "${b.dataset.qno||b.dataset.id}"? This cannot be undone.`)) return;
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
      const reason = prompt('Reason for deleting this quote? (sent to the president for approval)')||'';
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
      openModal(`✎ Edit Quote — ${b.dataset.qno}`, `
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
          <input id="pres-total" type="number" value="${q.total||q.grandTotal||0}" style="width:100%"/>
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
              <thead><tr><th>Quote #</th><th>Amount</th><th>Status</th><th>Date</th>${isPrivileged?'<th>By</th>':''}</tr></thead>
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
          ${q.createdAt?`<span>📅 ${new Date(q.createdAt.toDate()).toLocaleDateString()}</span>`:''}
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

  openModal(existing ? `Edit Quote` : 'New Quote', `
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
        <input type="number" value="${l.qty}" data-i="${i}" data-f="qty" min="1"/>
        <input type="number" value="${l.price}" data-i="${i}" data-f="price" min="0" step="0.01"/>
        <button class="btn-icon" data-rm="${i}">🗑</button>
      </div>`).join('');
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
  <p><strong>Quote for:</strong> ${escHtml(q?.clientName||'Client')} &nbsp;&nbsp; <strong>Date:</strong> ${q?.date||today()}</p>
  <table><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr>
  ${lines.map(l=>`<tr><td>${escHtml(l.description)}</td><td>${l.qty}</td><td>₱${fmt(l.price)}</td><td>₱${fmt(l.qty*l.price)}</td></tr>`).join('')}
  </table>
  <div class="total">Total: ₱${fmt(total)}</div>
  <div class="footer">Valid until: ${q?.validUntil||'N/A'} · ${escHtml(q?.notes||'')}</div>
  <script>window.print();<\/script></body></html>`);
}

// ══════════════════════════════════════════════════
//  OWNER — APPROVAL REQUESTS
// ══════════════════════════════════════════════════
window.renderApprovals = async function(currentUser) {
  const c = deptContainer();
  // Check pending counts for badges
  const [signupSnap, extSnap, caSnap, subsSnap, reviewTasksCountSnap, finReqSnap] = await Promise.all([
    db.collection('signup_requests').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('attendance_extensions').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('cash_advances').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('submissions').where('status','==','pending').get().catch(()=>({size:0,docs:[]})),
    db.collection('tasks').where('status','==','review').get().catch(()=>({size:0,docs:[]})),
    db.collection('payroll_delete_requests').where('status','==','pending').get().catch(()=>({size:0,docs:[]}))
  ]);
  const pendingSignups = signupSnap.size || 0;
  const pendingExt     = extSnap.size || 0;
  const pendingCA      = caSnap.size || 0;
  const pendingSubs    = subsSnap.size || 0;
  const pendingReview  = reviewTasksCountSnap.size || 0;
  const pendingFinReqs = finReqSnap.size || 0;
  const totalPending   = pendingSignups + pendingExt + pendingCA + pendingSubs + pendingReview + pendingFinReqs;

  c.innerHTML = `
    <div class="page-header"><h2>✅ Approvals</h2>${totalPending>0?`<span class="badge badge-red" style="font-size:13px">${totalPending} pending</span>`:''}</div>
    <div class="subtab-bar" style="flex-wrap:wrap">
      <button class="subtab-btn active" data-sub="all">
        📋 All Requests${totalPending>0?` <span class="nav-badge">${totalPending}</span>`:''}
      </button>
      <button class="subtab-btn" data-sub="review-tasks">
        Tasks for Review${pendingReview>0?` <span class="nav-badge">${pendingReview}</span>`:''}
      </button>
      <button class="subtab-btn" data-sub="signups">
        Sign-ups${pendingSignups>0?` <span class="nav-badge">${pendingSignups}</span>`:''}
      </button>
      <button class="subtab-btn" data-sub="attendance">
        Attendance${pendingExt>0?` <span class="nav-badge">${pendingExt}</span>`:''}
      </button>
      <button class="subtab-btn" data-sub="roa">Quote / ROA</button>
      <button class="subtab-btn" data-sub="quote-files">📁 Quote Files</button>
      <button class="subtab-btn" data-sub="ca">
        Cash Advances${pendingCA>0?` <span class="nav-badge">${pendingCA}</span>`:''}
      </button>
      <button class="subtab-btn" data-sub="finance-requests">
        💼 Finance Requests${pendingFinReqs>0?` <span class="nav-badge">${pendingFinReqs}</span>`:''}
      </button>
    </div>
    <div id="approvals-content"><div class="loading-placeholder">Loading…</div></div>
  `;

  const loadApprovalsSub = async (sub) => {
    const wrap = document.getElementById('approvals-content');
    if (!wrap) return;
    wrap.innerHTML = '<div class="loading-placeholder">Loading…</div>';

    if (sub === 'all') {
      // ── All Pending Requests aggregated view ──
      // No .orderBy() here — combining it with .where() requires a Firestore composite
      // index per-collection. If that index isn't provisioned, the query is rejected and
      // silently swallowed by .catch(), making items vanish from "All Requests". We sort
      // client-side instead so a missing index can never hide pending items.
      const [sgSnap, atSnap, caSnap2, subSnap2, reviewTasksSnap, finReqSnap2] = await Promise.all([
        db.collection('signup_requests').where('status','==','pending').get().catch(e=>{console.error('signup_requests query failed',e);return {docs:[]};}),
        db.collection('attendance_extensions').where('status','==','pending').get().catch(e=>{console.error('attendance_extensions query failed',e);return {docs:[]};}),
        db.collection('cash_advances').where('status','==','pending').get().catch(e=>{console.error('cash_advances query failed',e);return {docs:[]};}),
        db.collection('submissions').where('status','==','pending').get().catch(e=>{console.error('submissions query failed',e);return {docs:[]};}),
        db.collection('tasks').where('status','==','review').get().catch(e=>{console.error('tasks query failed',e);return {docs:[]};}),
        db.collection('payroll_delete_requests').where('status','==','pending').get().catch(e=>{console.error('payroll_delete_requests query failed',e);return {docs:[]};})
      ]);

      const allPending = [
        ...sgSnap.docs.map(d=>({id:d.id,...d.data(),type:'signup',icon:'👤',label:'Sign-up Request',name:d.data().fullName||d.data().email||'Unknown',detail:d.data().email||'',ts:d.data().createdAt})),
        ...atSnap.docs.map(d=>({id:d.id,...d.data(),type:'attendance',icon:'⏰',label:'Attendance Extension',name:d.data().userName||'Unknown',detail:d.data().date||'',ts:d.data().requestedAt})),
        ...caSnap2.docs.map(d=>({id:d.id,...d.data(),type:'ca',icon:'💸',label:'Cash Advance',name:d.data().userName||'Unknown',detail:`₱${fmt(d.data().amount||0)}`,ts:d.data().createdAt})),
        ...subSnap2.docs.map(d=>({id:d.id,...d.data(),type:'submission',icon:'📤',label:'Work Submission',name:d.data().userName||d.data().authorName||'Unknown',detail:d.data().title||'',ts:d.data().createdAt})),
        ...reviewTasksSnap.docs.map(d=>({id:d.id,...d.data(),type:'review-task',icon:'📋',label:'Task for Review',name:d.data().title||'Untitled Task',detail:(()=>{const uids=Array.isArray(d.data().assignedTo)?d.data().assignedTo:[d.data().assignedTo].filter(Boolean);return uids.length?'by '+d.data().assignedToNames?.join(', '):'';})(),ts:d.data().lastModifiedAt||d.data().createdAt})),
        ...finReqSnap2.docs.map(d=>({id:d.id,...d.data(),type:'finance-req',icon:'💼',label:'Finance Request',name:`Delete: ${d.data().userName||'?'} (${d.data().month||'?'})`,detail:`by ${d.data().requestedByName||'?'} — ${d.data().reason||''}`,ts:d.data().createdAt}))
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
              ${item.type==='signup'?`
                <button class="btn-success btn-sm sg-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}" data-email="${escHtml(item.email||'')}" data-phone="${escHtml(item.phone||'')}">✓ Approve</button>
                <button class="btn-danger btn-sm sg-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✗ Reject</button>
              `:item.type==='attendance'?`
                <button class="btn-success btn-sm at-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✓ Approve</button>
                <button class="btn-danger btn-sm at-deny-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✗ Deny</button>
              `:item.type==='ca'?`
                <button class="btn-success btn-sm ca-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}" data-amount="${item.amount||0}" data-uid="${item.userId||''}">✓ Approve CA</button>
                <button class="btn-danger btn-sm ca-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✗ Reject</button>
              `:item.type==='review-task'?`
                <button class="btn-primary btn-sm rt-view-btn" data-id="${item.id}">👁 View Task</button>
                <button class="btn-success btn-sm rt-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✓ Approve</button>
                <button class="btn-danger btn-sm rt-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">✗ Send Back</button>
              `:item.type==='finance-req'?`
                <button class="btn-success btn-sm fr-approve-btn" data-id="${item.id}" data-hist-id="${item.historyId||''}" data-name="${escHtml(item.userName||'')}" data-month="${item.month||''}" data-req-by="${item.requestedBy||''}">✓ Approve Deletion</button>
                <button class="btn-danger btn-sm fr-deny-btn" data-id="${item.id}" data-name="${escHtml(item.userName||'')}" data-month="${item.month||''}" data-req-by="${item.requestedBy||''}">✗ Deny</button>
              `:`
                <button class="btn-success btn-sm sub-approve-btn" data-id="${item.id}">✓ Approve</button>
                <button class="btn-danger btn-sm sub-reject-btn" data-id="${item.id}">✗ Reject</button>
              `}
            </div>
          </div>`).join('')}
        </div>`;

      // Signup approve
      wrap.querySelectorAll('.sg-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          const pwd = generatePassword(btn.dataset.name);
          const empCount = (await db.collection('users').get().catch(()=>({size:0}))).size;
          const empId = `BI-${new Date().getFullYear()}-${String(empCount+1).padStart(3,'0')}`;
          await db.collection('users').add({ displayName:btn.dataset.name, email:btn.dataset.email, phone:btn.dataset.phone, role:'employee', departments:[], employeeId:empId, photoUrl:'', startDate:new Date().toISOString().slice(0,10), createdAt:firebase.firestore.FieldValue.serverTimestamp(), pendingPasswordSetup:true });
          await db.collection('signup_requests').doc(btn.dataset.id).update({ status:'approved', generatedPassword:pwd, approvedAt:firebase.firestore.FieldValue.serverTimestamp(), approvedBy:currentUser.uid });
          Notifs.showToast(`${btn.dataset.name} approved! Password: ${pwd}`);
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.sg-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!confirm(`Reject ${btn.dataset.name}?`)) return;
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
      wrap.querySelectorAll('.ca-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('cash_advances').doc(btn.dataset.id).update({ status:'approved', balance:parseFloat(btn.dataset.amount)||0, approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.uid) await safeNotify(() => Notifs.send(btn.dataset.uid, { title:'Cash Advance Approved', body:`Your CA of ₱${fmt(parseFloat(btn.dataset.amount)||0)} has been approved.`, icon:'💸', type:'ca_approved' }));
          Notifs.showToast(`CA approved for ${btn.dataset.name}`);
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.ca-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('cash_advances').doc(btn.dataset.id).update({ status:'rejected', rejectedBy:currentUser.uid, rejectedAt:firebase.firestore.FieldValue.serverTimestamp() });
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
          if (!confirm(`Approve deletion of ${btn.dataset.name} (${btn.dataset.month}) payroll record?`)) return;
          if (btn.dataset.histId) await db.collection('salary_history').doc(btn.dataset.histId).delete();
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
      return;
    }

    if (sub === 'finance-requests') {
      const snap = await db.collection('payroll_delete_requests').orderBy('createdAt','desc').limit(100).get().catch(e=>{console.error('payroll_delete_requests query failed',e);return {docs:[]};});
      const reqs = snap.docs.map(d=>({id:d.id,...d.data()}));
      const pending = reqs.filter(r=>r.status==='pending');
      const resolved = reqs.filter(r=>r.status!=='pending');

      const reqCard = (r, showActions) => `
        <div class="item-card" style="cursor:default">
          <div class="item-top">
            <div class="item-title">🗑 Delete Payroll Record — ${escHtml(r.userName||'?')} (${r.month||'?'})</div>
            <span class="badge ${r.status==='pending'?'badge-warn':r.status==='approved'?'badge-green':'badge-red'}">${r.status==='pending'?'Pending':r.status==='approved'?'Approved':'Denied'}</span>
          </div>
          <div class="item-meta" style="margin-top:4px;flex-wrap:wrap;gap:6px">
            <span class="badge badge-blue" style="font-size:10px">Payroll Delete</span>
            <span style="font-size:12px;color:var(--text-muted)">Requested by: <strong>${escHtml(r.requestedByName||'?')}</strong></span>
            ${r.reason?`<span style="font-size:12px;color:var(--text-muted)">Reason: ${escHtml(r.reason)}</span>`:''}
            ${r.createdAt?`<span style="font-size:11px;color:var(--text-muted)">${new Date(r.createdAt.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`:''}
          </div>
          ${showActions?`<div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn-success btn-sm fr-approve-btn" data-id="${r.id}" data-hist-id="${r.historyId||''}" data-name="${escHtml(r.userName||'')}" data-month="${r.month||''}" data-req-by="${r.requestedBy||''}">✓ Approve Deletion</button>
            <button class="btn-danger btn-sm fr-deny-btn" data-id="${r.id}" data-name="${escHtml(r.userName||'')}" data-month="${r.month||''}" data-req-by="${r.requestedBy||''}">✗ Deny</button>
          </div>`:''}
        </div>`;

      wrap.innerHTML = `
        ${!pending.length && !resolved.length ? '<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">💼</div><h4>No finance requests</h4></div>' : ''}
        ${pending.length ? `<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Pending (${pending.length})</h4>
          <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
            ${pending.map(r=>reqCard(r,true)).join('')}
          </div>` : ''}
        ${resolved.length ? `<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">History</h4>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${resolved.slice(0,20).map(r=>reqCard(r,false)).join('')}
          </div>` : ''}
      `;

      wrap.querySelectorAll('.fr-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!confirm(`Approve deletion of ${btn.dataset.name} (${btn.dataset.month}) payroll record?`)) return;
          if (btn.dataset.histId) await db.collection('salary_history').doc(btn.dataset.histId).delete();
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
              <button class="btn-success btn-sm rt-approve-btn" data-id="${t.id}" data-name="${escHtml(t.title||'Task')}">✓ Approve</button>
              <button class="btn-danger btn-sm rt-reject-btn" data-id="${t.id}" data-name="${escHtml(t.title||'Task')}">✗ Send Back</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
      wrap.querySelectorAll('.rt-view-btn').forEach(btn=>btn.addEventListener('click',()=>openTaskDetail(btn.dataset.id,currentUser,window.currentRole||'president')));
      wrap.querySelectorAll('.rt-approve-btn').forEach(btn=>btn.addEventListener('click',async()=>{
        if (!confirm(`Approve "${btn.dataset.name}"?`)) return;
        await db.collection('tasks').doc(btn.dataset.id).update({status:'approved',approvedAt:firebase.firestore.FieldValue.serverTimestamp(),approvedBy:currentUser.uid});
        Notifs.showToast(`"${btn.dataset.name}" approved!`,'success');
        loadApprovalsSub('review-tasks');
      }));
      wrap.querySelectorAll('.rt-reject-btn').forEach(btn=>btn.addEventListener('click',async()=>{
        if (!confirm(`Send "${btn.dataset.name}" back for revision?`)) return;
        await db.collection('tasks').doc(btn.dataset.id).update({status:'in-progress',sentBackAt:firebase.firestore.FieldValue.serverTimestamp(),sentBackBy:currentUser.uid});
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
            ${item.status==='pending'?`
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
          const empId    = `BI-${new Date().getFullYear()}-${String(empCount+1).padStart(3,'0')}`;
          await db.collection('users').add({
            displayName: name, email, phone,
            role: 'employee', departments: [],
            employeeId: empId,
            photoUrl: '', startDate: new Date().toISOString().slice(0,10),
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
          if (!confirm(`Reject ${btn.dataset.name}'s request?`)) return;
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
            ${item.status==='pending'?`
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
            ${item.status==='pending'?`
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-success ca-approve" data-id="${item.id}" data-uid="${item.userId}" data-name="${escHtml(item.userName)}" data-amount="${item.amount}">Approve</button>
              <button class="btn-danger ca-reject" data-id="${item.id}" data-uid="${item.userId}" data-name="${escHtml(item.userName)}">Reject</button>
            </div>`:''}
          </div>`).join('')}
        </div>
      `;

      wrap.querySelectorAll('.ca-approve').forEach(btn => {
        btn.addEventListener('click', async e => {
          const { id, uid, name, amount } = e.currentTarget.dataset;
          await db.collection('cash_advances').doc(id).update({ status:'approved', approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
          await Notifs.send(uid, { title:'Cash Advance Approved', body:`Your ₱${fmt(parseFloat(amount))} request has been approved.`, icon:'💸', type:'cash_advance', dedupKey:`ca-approved-${id}` });
          Notifs.showToast(`Approved ₱${fmt(parseFloat(amount))} for ${name}`);
          loadApprovalsSub('ca');
        });
      });
      wrap.querySelectorAll('.ca-reject').forEach(btn => {
        btn.addEventListener('click', async e => {
          const { id, uid, name } = e.currentTarget.dataset;
          await db.collection('cash_advances').doc(id).update({ status:'rejected' });
          await Notifs.send(uid, { title:'Cash Advance Declined', body:'Your cash advance request was not approved this time.', icon:'💸', type:'cash_advance', dedupKey:`ca-rejected-${id}` });
          Notifs.showToast('Request rejected.');
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
          ${item.status==='pending'?`
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

  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('.subtab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      loadApprovalsSub(btn.dataset.sub);
    });
  });

  loadApprovalsSub('all');
};

// ══════════════════════════════════════════════════
//  SHARED: Client Profiles
// ══════════════════════════════════════════════════
async function renderClientProfiles(container, currentUser, currentRole, brand) {
  const collection = brand === 'brilliant-steel' ? 'bs_clients' : (brand === 'design' ? 'design_clients' : 'sales_clients');
  const snap = await db.collection(collection).orderBy('createdAt','desc').get();
  const clients = snap.docs.map(d => ({id:d.id,...d.data()}));
  const canAdd = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='agent';

  container.innerHTML = `
    ${canAdd?`<div style="text-align:right;margin-bottom:12px"><button class="btn-primary btn-sm" id="add-client-btn">+ Add Client</button></div>`:''}
    <div class="item-list">
      ${!clients.length
        ? `<div class="empty-state"><div class="empty-icon">👤</div><h4>No clients yet</h4></div>`
        : clients.map(cl => `
          <div class="item-card">
            <div class="item-title">${escHtml(cl.name)}</div>
            <div class="item-meta">
              ${cl.company?`<span>🏢 ${escHtml(cl.company)}</span>`:''}
              ${cl.email?`<span>✉️ ${escHtml(cl.email)}</span>`:''}
              ${cl.phone?`<span>📞 ${escHtml(cl.phone)}</span>`:''}
            </div>
          </div>`).join('')}
    </div>
  `;

  document.getElementById('add-client-btn')?.addEventListener('click', () => {
    openModal('Add Client', `
      <div class="form-group"><label>Name</label><input id="cl-name" placeholder="Client full name"/></div>
      <div class="form-group"><label>Company</label><input id="cl-company" placeholder="Company name"/></div>
      <div class="form-row">
        <div class="form-group"><label>Email</label><input id="cl-email" type="email"/></div>
        <div class="form-group"><label>Phone</label><input id="cl-phone" type="tel"/></div>
      </div>
      <div class="form-group"><label>Address</label><textarea id="cl-address" rows="2"></textarea></div>
      <div class="form-group"><label>Notes</label><textarea id="cl-notes" rows="2"></textarea></div>
    `, `<button class="btn-primary" id="save-client-btn">Save Client</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('save-client-btn').addEventListener('click', async () => {
      await db.collection(collection).add({
        name:      document.getElementById('cl-name').value.trim(),
        company:   document.getElementById('cl-company').value.trim(),
        email:     document.getElementById('cl-email').value.trim(),
        phone:     document.getElementById('cl-phone').value.trim(),
        address:   document.getElementById('cl-address').value.trim(),
        notes:     document.getElementById('cl-notes').value.trim(),
        addedBy:   currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); renderClientProfiles(container, currentUser, currentRole, brand);
    });
  });
}

// ══════════════════════════════════════════════════
//  SHARED: Generic Document Collection
// ══════════════════════════════════════════════════
async function renderDocCollection(container, collection, title, currentUser, currentRole, opts = {}) {
  const snap = await db.collection(collection).orderBy('createdAt','desc').get();
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
            ${d.fileUrl?`<a href="${d.fileUrl}" target="_blank" class="btn-link" style="font-size:12px;margin-top:8px;display:block">📎 Open File</a>`:''}
          </div>`).join('')}
    </div>
  `;

  document.getElementById('add-doc-btn')?.addEventListener('click', () => {
    openModal(`Add to ${title}`, `
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
            ${f.url?`<a href="${f.url}" target="_blank" class="btn-primary btn-sm">Open</a>`:''}
            ${canDelete ? `<button class="btn-danger btn-sm file-delete-btn" data-id="${f.id}" data-name="${(f.name||'').replace(/"/g,'&quot;')}" style="font-size:11px">Delete</button>` : ''}
            ${canRequestDelete ? `<button class="btn-secondary btn-sm file-req-delete-btn" data-id="${f.id}" data-name="${(f.name||'').replace(/"/g,'&quot;')}" style="font-size:11px;color:var(--danger)">Request Delete</button>` : ''}
          </div>
        </div>
        <div class="item-meta">
          <span>👤 ${escHtml(f.uploadedByName||'—')}</span>
          ${f.createdAt?`<span>${new Date(f.createdAt.toDate()).toLocaleDateString()}</span>`:''}
          ${f.deleteRequested?`<span style="color:var(--danger);font-size:11px;font-weight:600">⏳ Delete requested</span>`:''}
        </div>
      </div>`).join('');

    // Direct delete (president/manager)
    filesDiv.querySelectorAll('.file-delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`Delete "${btn.dataset.name}"? This cannot be undone.`)) return;
        await db.collection(collection).doc(btn.dataset.id).delete();
        Notifs.showToast('File deleted.');
        reloadFiles();
      });
    });

    // Request delete (finance — notifies president)
    filesDiv.querySelectorAll('.file-req-delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`Request deletion of "${btn.dataset.name}"? The president will be notified to approve.`)) return;
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
      .filter(e=>e.budgetLineId===item.id && e.type==='debit')
      .reduce((s,e)=>s+(e.amount||0),0);
  });

  const totalBudget = items.reduce((s,i)=>s+(i.budget||0),0);
  const totalSpent  = expenses.filter(e=>e.type==='debit').reduce((s,e)=>s+(e.amount||0),0);
  const totalIncome = expenses.filter(e=>e.type==='credit').reduce((s,e)=>s+(e.amount||0),0);

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
    openModal('Add Budget Line', `
      <div class="form-group"><label>Item Name</label><input id="bg-name" placeholder="e.g. Social Media Ads"/></div>
      <div class="form-group"><label>Allocated Budget (₱)</label><input id="bg-budget" type="number" step="0.01" min="0"/></div>
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
    openModal('Log Expense / Income', `
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
        <div class="form-group"><label>Amount (₱)</label><input id="exp-amount" type="number" step="0.01" min="0"/></div>
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

      // Write to shared Finance ledger with dept tag
      await db.collection('ledger').add({
        date:          document.getElementById('exp-date').value,
        type,
        description:   desc,
        amount,
        category:      dept + (type==='credit'?' Income':' Expense'),
        dept,
        budgetLineId:  lineId || null,
        budgetLineName:lineName || null,
        refNumber:     document.getElementById('exp-ref').value.trim() || null,
        addedBy:       currentUser.uid,
        addedByName:   uName,
        source:        dept, // Finance can see which dept this came from
        createdAt:     firebase.firestore.FieldValue.serverTimestamp()
      });

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
      <div class="card-header">
        <h3>📁 ${title}</h3>
        <button class="btn-primary btn-sm" id="upload-btn-${containerId}">+ Upload File</button>
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
  const collection = `files_${scope.toLowerCase().replace(/\s+/g,'_')}`;
  let allFiles = [];
  let activeFolder = 'All';

  const renderList = () => {
    const folders = [...new Set(allFiles.filter(f=>!f.archived).map(f=>f.folder||'General'))].sort();
    const archivedCount = allFiles.filter(f=>f.archived).length;
    const showing = activeFolder==='__archived__'
      ? allFiles.filter(f=>f.archived)
      : allFiles.filter(f=>!f.archived && (activeFolder==='All' || (f.folder||'General')===activeFolder));
    const chipBar = `<div class="subtab-bar" style="margin-bottom:10px">
      ${['All',...folders].map(c=>`<button class="subtab-btn file-folder-chip ${activeFolder===c?'active':''}" data-folder="${escHtml(c)}">📁 ${escHtml(c)}</button>`).join('')}
      ${archivedCount?`<button class="subtab-btn file-folder-chip ${activeFolder==='__archived__'?'active':''}" data-folder="__archived__">🗄 Archived (${archivedCount})</button>`:''}
    </div>`;
    const rows = showing.length ? showing.map(f=>`<tr>
        <td><a href="${escHtml(f.url)}" target="_blank" style="color:var(--primary);font-weight:600">${escHtml(f.name||'File')}</a></td>
        <td><span class="badge badge-gray">${escHtml(f.folder||'General')}</span></td>
        <td>${escHtml(f.uploaderName||'—')}</td>
        <td style="font-size:11px;color:var(--text-muted)">${f.createdAt?new Date(f.createdAt.toDate()).toLocaleDateString('en-PH'):''}</td>
        <td style="white-space:nowrap"><a href="${escHtml(f.url)}" target="_blank" class="btn-secondary btn-sm" title="Download">⬇</a>
          <button class="btn-secondary btn-sm file-arch-btn" data-id="${f.id}" data-arch="${f.archived?'0':'1'}" title="${f.archived?'Restore':'Archive'}">${f.archived?'♻️':'🗄'}</button></td>
      </tr>`).join('') : `<tr><td colspan="5"><div class="empty-state" style="padding:18px"><div class="empty-icon">📁</div><h4>No files here</h4></div></td></tr>`;
    listEl.innerHTML = chipBar + `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Name</th><th>Folder</th><th>Uploaded By</th><th>Date</th><th></th></tr></thead>
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
    if (!allFiles.length) { listEl.innerHTML='<div class="empty-state" style="padding:20px"><div class="empty-icon">📁</div><h4>No files yet</h4></div>'; return; }
    renderList();
  };

  loadFiles();

  uploadBtn?.addEventListener('click', () => {
    const existingFolders = [...new Set(allFiles.map(f=>f.folder||'General'))];
    const prefill = (activeFolder!=='All' && activeFolder!=='__archived__') ? activeFolder : '';
    openModal('Upload File', `
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
};

// ── Shared doc collection helper ──────────────────
window.renderDocCollection = function(container, collection, title, currentUser, currentRole, cfg) {
  const canAdd = cfg?.dept ? canEditDept(cfg.dept)
    : (currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance');
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div></div>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-doc-btn-${collection}">+ Add</button>`:''}
    </div>
    <div id="doc-list-${collection}"><div class="loading-placeholder">Loading…</div></div>
  `;
  const loadDocs = async () => {
    const snap = await db.collection(collection).get();
    const docs = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const list = document.getElementById(`doc-list-${collection}`);
    if (!docs.length) { list.innerHTML=`<div class="empty-state" style="padding:20px"><div class="empty-icon">${cfg?.icon||'📄'}</div><h4>No ${title} yet</h4></div>`; return; }
    list.innerHTML = `<div class="item-list">${docs.map(d=>`
      <div class="item-card">
        <div class="item-top"><div class="item-title">${escHtml(d.title||d.name||'Untitled')}</div>
          <span class="badge ${statusBadge(d.status)}">${d.status||'active'}</span>
        </div>
        <div class="item-meta">
          ${d.description?`<span>${escHtml(d.description)}</span>`:''}
          ${d.fileUrl?`<a href="${d.fileUrl}" target="_blank" class="btn-link" style="font-size:11px">📎 View File</a>`:''}
          ${d.createdAt?`<span style="font-size:11px;color:var(--text-muted)">${new Date(d.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
        </div>
      </div>`).join('')}</div>`;
  };
  loadDocs();
  document.getElementById(`add-doc-btn-${collection}`)?.addEventListener('click', () => {
    openModal(`Add ${title}`, `
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

window.renderProductionDept = async function(currentUser, currentRole, subtab = 'Orders') {
  const c = deptContainer();
  const subs = ['Orders','Materials','Tasks','Files'];
  c.innerHTML = `
    <div class="page-header">
      <div>
        <h2>🏭 Production</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">Shop-floor work orders, materials & output</p>
      </div>
    </div>
    <div class="subtab-bar">
      ${subs.map(s=>`<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`).join('')}
    </div>
    <div id="prod-content"><div class="loading-placeholder">Loading…</div></div>`;
  loadProdContent(currentUser, currentRole, subtab);
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('.subtab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      loadProdContent(currentUser, currentRole, btn.dataset.sub);
    });
  });
};

function loadProdContent(currentUser, currentRole, sub) {
  const el = document.getElementById('prod-content');
  if (sub==='Materials') return renderProdMaterials(el, currentRole);
  if (sub==='Tasks')     return renderDeptTasks(el, 'Production', currentUser, currentRole);
  if (sub==='Files')   { el.innerHTML = renderFileCollection('Production Files', 'production-files', currentRole);
                         bindFileCollection('production-files', currentUser, 'Production', 'Files'); return; }
  return renderProdOrders(el, currentUser, currentRole);
}

async function renderProdOrders(el, currentUser, currentRole) {
  const canEdit = canEditDept('Production');
  el.innerHTML = '<div class="loading-placeholder">Loading orders…</div>';
  const snap = await db.collection('production_orders').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
  const orders = snap.docs.map(d=>({id:d.id,...d.data()}));
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
    ${!active.length && !delivered.length ? '<div class="empty-state" style="padding:30px"><div class="empty-icon">🏭</div><h4>No production orders yet</h4><p>Create a work order to track a job through the shop floor.</p></div>' : ''}
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

function prodOrderModal(order, currentUser, currentRole, onSaved) {
  const e = order || {};
  openModal(order ? `Edit Order ${e.orderNo||''}` : '🏭 New Production Order', `
    <div class="form-group"><label>Product / Work Description</label><input id="po-title" value="${escHtml(e.title||'')}" placeholder="e.g. SS Baker's Worktable 1500mm ×4"/></div>
    <div class="form-row">
      <div class="form-group"><label>Client / Project</label><input id="po-client" value="${escHtml(e.client||'')}" placeholder="e.g. Gerry's Grill — Bulacan"/></div>
      <div class="form-group" style="flex:0 0 90px"><label>Qty</label><input id="po-qty" type="number" min="1" value="${e.qty||1}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Linked Quote (optional)</label><input id="po-quote" value="${escHtml(e.quoteRef||'')}" placeholder="BK-LU-FB-…"/></div>
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
    <div class="form-group"><label>Notes</label><textarea id="po-notes" rows="2" placeholder="Materials, special instructions, etc.">${escHtml(e.notes||'')}</textarea></div>
    <div id="po-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="po-save">Save</button>${order?'<button class="btn-danger" id="po-del">Delete</button>':''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  document.getElementById('po-save').addEventListener('click', async ()=>{
    const title = document.getElementById('po-title').value.trim();
    const err = document.getElementById('po-err');
    if(!title){ err.textContent='Product / work description is required.'; err.classList.remove('hidden'); return; }
    const data = {
      title, client: document.getElementById('po-client').value.trim(),
      qty: parseInt(document.getElementById('po-qty').value)||1,
      quoteRef: document.getElementById('po-quote').value.trim(),
      team: document.getElementById('po-team').value.trim(),
      stage: document.getElementById('po-stage').value,
      priority: document.getElementById('po-priority').value,
      dueDate: document.getElementById('po-due').value,
      notes: document.getElementById('po-notes').value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
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
      }
      closeModal(); Notifs.showToast('Order saved'); onSaved && onSaved();
    } catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
  document.getElementById('po-del')?.addEventListener('click', async ()=>{
    if(!confirm('Delete this production order?')) return;
    try { await db.collection('production_orders').doc(order.id).delete(); window.logAudit&&window.logAudit('delete','production_order',order.id,{orderNo:order.orderNo||''}); closeModal(); Notifs.showToast('Deleted'); onSaved && onSaved(); }
    catch(ex){ Notifs.showToast('Delete failed (admin only)','error'); }
  });
}

async function renderProdMaterials(el, currentRole) {
  el.innerHTML = '<div class="loading-placeholder">Loading materials…</div>';
  const snap = await db.collection('inventory_items').orderBy('name').get().catch(()=>({docs:[]}));
  const mats = snap.docs.map(d=>({id:d.id,...d.data()})).filter(i=>(i.kind||'material')==='material');
  const low = mats.filter(i=>(i.reorderLevel||0)>0 && (i.qty||0) <= (i.reorderLevel||0));
  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Raw Materials</div><div class="kpi-value">${mats.length}</div></div>
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
