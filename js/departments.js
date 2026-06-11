/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Department Modules
   departments.js
═══════════════════════════════════════════════════ */

'use strict';

// ── Shared helpers ────────────────────────────────
function deptContainer() { return document.getElementById('page-content'); }
function fmt(n) { return Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function today() { return new Date().toISOString().slice(0,10); }
function priorityBadge(p) { return {high:'badge-red',medium:'badge-orange',low:'badge-green'}[p]||'badge-gray'; }
function statusBadge(s) { return {open:'badge-blue',done:'badge-green',pending:'badge-orange',approved:'badge-green',rejected:'badge-red',draft:'badge-gray',sent:'badge-blue',accepted:'badge-green',reviewing:'badge-purple'}[s]||'badge-gray'; }

// ══════════════════════════════════════════════════
//  TASKS (shared across all departments)
// ══════════════════════════════════════════════════
window.renderTasks = async function(currentUser, currentRole, currentDept) {
  const c = deptContainer();
  const isPresMgr = currentRole==='president'||currentRole==='owner'||currentRole==='manager';

  if (currentRole === 'president' || currentRole === 'owner') {
    // President view: Departmental / My Tasks subtabs
    c.innerHTML = `
      <div class="page-header">
        <h2>✅ Tasks</h2>
        <button class="btn-primary btn-sm" id="add-task-btn">+ New Task</button>
      </div>
      <div class="subtab-bar">
        <button class="subtab-btn active" data-sub="departmental">📂 Departmental</button>
        <button class="subtab-btn" data-sub="mine">👤 My Tasks</button>
      </div>
      <div id="tasks-subtab-content"></div>
    `;
    loadPresidentTasks('departmental', currentUser, currentRole);
    c.querySelectorAll('.subtab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadPresidentTasks(btn.dataset.sub, currentUser, currentRole);
      });
    });
    document.getElementById('add-task-btn').onclick = () => openAddTaskModal(currentUser, currentRole);
    return;
  }

  // Regular employee/manager view
  c.innerHTML = `
    <div class="page-header">
      <h2>✅ Tasks</h2>
      <div class="page-actions">
        <select id="task-filter" class="select-sm">
          <option value="mine">My Tasks</option>
          ${isPresMgr?'<option value="all">All Tasks</option>':''}
          <option value="open">Open</option>
          <option value="done">Done</option>
        </select>
        <button class="btn-primary btn-sm" id="add-task-btn">+ New Task</button>
      </div>
    </div>
    <div id="tasks-list" class="item-list"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadTasksList(currentUser, currentRole, currentDept);
  document.getElementById('task-filter').onchange = () => loadTasksList(currentUser, currentRole, currentDept);
  document.getElementById('add-task-btn').onclick  = () => openAddTaskModal(currentUser, currentRole);
};

async function loadPresidentTasks(sub, currentUser, currentRole) {
  const wrap = document.getElementById('tasks-subtab-content');
  if (!wrap) return;

  if (sub === 'mine') {
    // My Tasks tab — tasks assigned to president
    wrap.innerHTML = `
      <div style="display:flex;justify-content:flex-end;padding:8px 0">
        <select id="pres-mine-filter" class="select-sm">
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="done">Done</option>
        </select>
      </div>
      <div id="pres-mine-list" class="item-list"><div class="loading-placeholder">Loading…</div></div>
    `;
    const renderMine = async () => {
      const list = document.getElementById('pres-mine-list');
      const filter = document.getElementById('pres-mine-filter')?.value || 'all';
      const snap = await db.collection('tasks').where('assignedTo','==',currentUser.uid).get();
      let tasks = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      if (filter === 'open') tasks = tasks.filter(t=>t.status!=='done');
      if (filter === 'done') tasks = tasks.filter(t=>t.status==='done');
      if (!tasks.length) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><h4>No tasks assigned to you</h4></div>'; return; }
      list.innerHTML = tasks.map(t=>`
        <div class="item-card priority-${t.priority||'medium'} ${t.status==='done'?'status-done':''}" data-id="${t.id}">
          <div class="item-top">
            <div class="item-title">${t.status==='done'?'✅ ':''}${t.title}</div>
            <div class="item-badges">
              <span class="badge ${priorityBadge(t.priority)}">${t.priority||'med'}</span>
              <span class="badge ${statusBadge(t.status)}">${t.status||'open'}</span>
            </div>
          </div>
          <div class="item-meta">
            ${t.dueDate?`<span>📅 ${t.dueDate}</span>`:''}
            ${t.department?`<span>🗂 ${t.department}</span>`:''}
          </div>
        </div>`).join('');
      list.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', () => openTaskDetail(card.dataset.id, currentUser, currentRole));
      });
    };
    renderMine();
    document.getElementById('pres-mine-filter')?.addEventListener('change', renderMine);
    return;
  }

  // Departmental tab — all tasks grouped by department
  wrap.innerHTML = '<div class="loading-placeholder">Loading…</div>';
  try {
    const snap = await db.collection('tasks').get();
    const tasks = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

    const deptGroups = {};
    tasks.forEach(t => {
      const dept = t.department || 'Unassigned';
      if (!deptGroups[dept]) deptGroups[dept] = [];
      deptGroups[dept].push(t);
    });

    if (!tasks.length) { wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><h4>No tasks yet</h4></div>'; return; }

    wrap.innerHTML = Object.entries(deptGroups).map(([dept, dTasks]) => {
      const cfg = window.DEPARTMENTS?.[dept] || {icon:'🗂️', color:'var(--primary-light)'};
      const open = dTasks.filter(t=>t.status!=='done').length;
      const done = dTasks.filter(t=>t.status==='done').length;
      return `
        <div class="card" style="margin-bottom:12px">
          <div class="card-header" style="border-left:4px solid ${cfg.color||'var(--primary-light)'}">
            <h3>${cfg.icon||'🗂️'} ${dept}</h3>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="badge badge-blue">${open} open</span>
              <span class="badge badge-green">${done} done</span>
            </div>
          </div>
          <div class="item-list" style="padding:0 12px 12px">
            ${dTasks.map(t=>`
              <div class="item-card priority-${t.priority||'medium'} ${t.status==='done'?'status-done':''}" data-id="${t.id}" style="margin-top:8px;cursor:pointer">
                <div class="item-top">
                  <div class="item-title">${t.status==='done'?'✅ ':''}${t.title}</div>
                  <div class="item-badges">
                    <span class="badge ${priorityBadge(t.priority)}">${t.priority||'med'}</span>
                    <span class="badge ${statusBadge(t.status)}">${t.status||'open'}</span>
                  </div>
                </div>
                <div class="item-meta">
                  ${t.assignedToName?`<span>👤 ${t.assignedToName}</span>`:''}
                  ${t.dueDate?`<span>📅 ${t.dueDate}</span>`:''}
                </div>
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');

    wrap.querySelectorAll('.item-card').forEach(card => {
      card.addEventListener('click', () => openTaskDetail(card.dataset.id, currentUser, currentRole));
    });
  } catch(err) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>${err.message}</h4></div>`;
  }
}

async function loadTasksList(currentUser, currentRole, currentDept) {
  const list   = document.getElementById('tasks-list');
  const filter = document.getElementById('task-filter')?.value || 'mine';
  list.innerHTML = '<div class="loading-placeholder">Loading…</div>';

  let snap;
  if (filter === 'mine') {
    snap = await db.collection('tasks').where('assignedTo','==',currentUser.uid).get();
  } else if (currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager') {
    snap = await db.collection('tasks').get();
  } else {
    snap = await db.collection('tasks').where('department','==',currentDept).get();
  }

  let tasks = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  if (filter === 'open') tasks = tasks.filter(t => t.status !== 'done');
  if (filter === 'done') tasks = tasks.filter(t => t.status === 'done');

  if (!tasks.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><h4>No tasks found</h4></div>`;
    return;
  }
  list.innerHTML = tasks.map(t => `
    <div class="item-card priority-${t.priority||'medium'} ${t.status==='done'?'status-done':''}" data-id="${t.id}">
      <div class="item-top">
        <div class="item-title">${t.status==='done'?'✅ ':''}${t.title}</div>
        <div class="item-badges">
          <span class="badge ${priorityBadge(t.priority)}">${t.priority||'med'}</span>
          <span class="badge ${statusBadge(t.status)}">${t.status||'open'}</span>
        </div>
      </div>
      <div class="item-meta">
        ${t.assignedToName?`<span>👤 ${t.assignedToName}</span>`:''}
        ${t.dueDate?`<span>📅 ${t.dueDate}</span>`:''}
        ${t.department?`<span>🗂 ${t.department}</span>`:''}
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => openTaskDetail(card.dataset.id, currentUser, currentRole));
  });
}

async function openTaskDetail(taskId, currentUser, currentRole) {
  const snap = await db.collection('tasks').doc(taskId).get();
  const t = {id:snap.id,...snap.data()};
  const canManage = currentRole==='president'||currentRole==='owner'||currentRole==='manager';

  // Load employees for reassignment dropdown
  const empSnap = await db.collection('users').get();
  const employees = empSnap.docs.map(d=>({id:d.id,...d.data()}))
    .sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));

  openModal(t.title, `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span class="badge ${priorityBadge(t.priority)}">${t.priority||'medium'}</span>
      <span class="badge ${statusBadge(t.status)}">${t.status||'open'}</span>
      ${t.department?`<span class="badge badge-gray">🗂 ${t.department}</span>`:''}
    </div>
    <p style="font-size:14px;line-height:1.6;margin-bottom:12px;white-space:pre-wrap">${t.description||'No description.'}</p>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;display:flex;gap:16px;flex-wrap:wrap">
      ${t.assignedToName?`<span>👤 <strong>${t.assignedToName}</strong></span>`:''}
      ${t.assignedEmail?`<span>✉️ ${t.assignedEmail}</span>`:''}
      ${t.dueDate?`<span>📅 Due: <strong>${t.dueDate}</strong></span>`:''}
      ${t.createdByName?`<span>🖊 Created by: ${t.createdByName}</span>`:''}
    </div>

    ${canManage ? `
    <div style="background:var(--surface2);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px">🎯 Designate / Reassign</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="reassign-sel" style="flex:1;min-width:180px;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)">
          <option value="">— Select employee —</option>
          ${employees.map(e=>`<option value="${e.id}" data-name="${e.displayName||e.email}" data-email="${e.email||''}" ${e.id===t.assignedTo?'selected':''}>${e.displayName||e.email} (${e.email||'no email'})</option>`).join('')}
        </select>
        <button class="btn-primary btn-sm" id="designate-btn">Designate ✓</button>
      </div>
      <div style="margin-top:10px">
        <input id="task-instruction" placeholder="Add instruction or note for assignee…" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)" value=""/>
      </div>
    </div>` : ''}

    <hr class="divider"/>
    <div id="task-comments-wrap"></div>
  `, `
    ${t.status!=='done'?`<button class="btn-success" id="mark-done-btn">✅ Mark Done</button>`:'<span style="color:var(--success);font-size:13px;font-weight:600">✅ Completed</span>'}
    ${canManage||t.createdBy===currentUser.uid?`<button class="btn-danger" id="del-task-btn">Delete</button>`:''}
    <button class="btn-secondary" onclick="closeModal()">Close</button>
  `);

  renderComments('tasks', taskId, 'task-comments-wrap', currentUser);

  document.getElementById('mark-done-btn')?.addEventListener('click', async () => {
    await db.collection('tasks').doc(taskId).update({ status:'done' });
    closeModal(); renderTasks(currentUser, currentRole, t.department);
  });

  document.getElementById('del-task-btn')?.addEventListener('click', async () => {
    if (!confirm('Delete this task?')) return;
    await db.collection('tasks').doc(taskId).delete();
    closeModal(); renderTasks(currentUser, currentRole, t.department);
  });

  document.getElementById('designate-btn')?.addEventListener('click', async () => {
    const sel          = document.getElementById('reassign-sel');
    const newUid       = sel.value;
    const newName      = sel.options[sel.selectedIndex]?.dataset.name || '';
    const newEmail     = sel.options[sel.selectedIndex]?.dataset.email || '';
    const instruction  = document.getElementById('task-instruction')?.value.trim();
    if (!newUid) { Notifs.showToast('Select an employee first', 'error'); return; }

    const creatorSnap  = await db.collection('users').doc(currentUser.uid).get();
    const creatorName  = creatorSnap.exists ? creatorSnap.data().displayName : currentUser.email;

    const update = {
      assignedTo: newUid, assignedToName: newName, assignedEmail: newEmail,
      lastModifiedBy: currentUser.uid, lastModifiedByName: creatorName,
      lastModifiedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (instruction) update.description = (t.description||'') + `\n\n📝 ${creatorName}: ${instruction}`;

    await db.collection('tasks').doc(taskId).update(update);

    // Notify new assignee
    await Notifs.send(newUid, {
      title: '🎯 Task Designated to You',
      body:  `"${t.title}" was designated to you by ${creatorName}${instruction?' — '+instruction:''}`,
      icon:  '🎯', type: 'task_designated'
    });

    // Notify previous assignee if different
    if (t.assignedTo && t.assignedTo !== newUid) {
      await Notifs.send(t.assignedTo, {
        title: '🔄 Task Reassigned',
        body:  `"${t.title}" was reassigned by ${creatorName}`,
        icon:  '🔄', type: 'task_modified'
      });
    }

    Notifs.showToast(`Designated to ${newName}`);
    closeModal(); renderTasks(currentUser, currentRole, t.department);
  });
}

async function openAddTaskModal(currentUser, currentRole) {
  // Load employees for dropdown
  const empSnap = await db.collection('users').get();
  const employees = empSnap.docs.map(d => ({id: d.id, ...d.data()}))
    .sort((a,b) => (a.displayName||'').localeCompare(b.displayName||''));

  const deptOptions = Object.keys(window.DEPARTMENTS||{})
    .map(k => `<option value="${k}">${k}</option>`).join('');

  openModal('New Task', `
    <div class="form-group"><label>Title</label><input id="t-title" placeholder="Task name"/></div>
    <div class="form-group"><label>Description</label><textarea id="t-desc" rows="3" placeholder="Details…"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Priority</label>
        <select id="t-priority">
          <option value="low">🟢 Low</option>
          <option value="medium" selected>🟡 Medium</option>
          <option value="high">🔴 High</option>
          <option value="urgent">🚨 Urgent</option>
        </select>
      </div>
      <div class="form-group"><label>Due Date</label><input id="t-due" type="date" value="${today()}"/></div>
    </div>
    <div class="form-group">
      <label>Assign To</label>
      <select id="t-assignee-sel">
        <option value="">— Select employee —</option>
        ${employees.map(e => `<option value="${e.id}" data-name="${e.displayName||e.email}" data-email="${e.email||''}">${e.displayName||e.email} ${e.email?'('+e.email+')':''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Department</label>
      <select id="t-dept">
        <option value="">— Select department —</option>
        ${deptOptions}
      </select>
    </div>
    <div class="form-group"><label>Notes / Instructions</label>
      <textarea id="t-notes" rows="2" placeholder="Additional notes for the assignee…"></textarea>
    </div>
  `, `<button class="btn-primary" id="create-task-btn">Create Task</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  document.getElementById('create-task-btn').addEventListener('click', async () => {
    const title   = document.getElementById('t-title').value.trim();
    const desc    = document.getElementById('t-desc').value.trim();
    const notes   = document.getElementById('t-notes').value.trim();
    const priority= document.getElementById('t-priority').value;
    const dueDate = document.getElementById('t-due').value;
    const dept    = document.getElementById('t-dept').value;

    const sel     = document.getElementById('t-assignee-sel');
    const assignedTo   = sel.value;
    const assignedName = sel.options[sel.selectedIndex]?.dataset.name || '';
    const assignedEmail= sel.options[sel.selectedIndex]?.dataset.email || '';

    if (!title) { Notifs.showToast('Enter a task title', 'error'); return; }

    const creatorSnap  = await db.collection('users').doc(currentUser.uid).get();
    const creatorName  = creatorSnap.exists ? creatorSnap.data().displayName : currentUser.email;

    const fullDesc = notes ? `${desc}\n\n📝 Instructions: ${notes}` : desc;

    // 1. Save to Firestore
    const docRef = await db.collection('tasks').add({
      title, description: fullDesc, priority, dueDate,
      assignedTo, assignedToName: assignedName, assignedEmail,
      department: dept, status: 'open',
      createdBy: currentUser.uid, createdByName: creatorName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2. Notify assigned employee
    if (assignedTo) {
      await Notifs.send(assignedTo, {
        title: '📌 New Task Assigned',
        body:  `"${title}" was assigned to you by ${creatorName}${dept?' ('+dept+')':''}`,
        icon:  '📌', type: 'task_assigned'
      });
    }

    closeModal();
    Notifs.showToast('Task created!');
    renderTasks(currentUser, currentRole, dept);
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
        <div class="item-title">${s.title}</div>
        <span class="badge ${statusBadge(s.status)}">${s.status||'pending'}</span>
      </div>
      <div class="item-meta">
        <span class="badge badge-gray">${s.type||'General'}</span>
        ${s.submittedByName?`<span>👤 ${s.submittedByName}</span>`:''}
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
      <span class="badge badge-gray" style="margin-left:6px">${s.type||'General'}</span>
    </div>
    <p style="font-size:14px;line-height:1.6;margin-bottom:12px">${s.description||'No details.'}</p>
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
                <td>${e.description}</td>
                <td><span class="badge badge-gray">${e.category||'General'}</span></td>
                <td>₱${fmt(e.amount)}</td>
                <td>${e.date||'—'}</td>
                <td>${e.submittedByName||'—'}</td>
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
    await Notifs.sendToOwner({ title:'💸 New Expense Submitted', body:`${name} submitted an expense of ₱${document.getElementById('e-amount').value}`, icon:'💸', type:'expense_new' });
    closeModal();
    Notifs.showToast('Expense submitted!');
    renderCash(currentUser, '');
  });
}

// ══════════════════════════════════════════════════
//  COMMENTS (shared)
// ══════════════════════════════════════════════════
window.renderComments = async function(collection, docId, containerId, currentUser) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const snap = await db.collection(collection).doc(docId).collection('comments').orderBy('createdAt').get();
  const comments = snap.docs.map(d => ({id:d.id,...d.data()}));

  container.innerHTML = `
    <div class="comments-section">
      <h4>💬 Comments (${comments.length})</h4>
      <div class="comment-list" id="clist-${docId}">
        ${comments.length===0
          ? '<div style="font-size:13px;color:var(--text-muted);padding:8px">No comments yet.</div>'
          : comments.map(c => `
            <div class="comment-item">
              <div class="comment-header">
                <span class="comment-author">${c.authorName||'User'}</span>
                <span class="comment-time">${c.createdAt?new Date(c.createdAt.toDate()).toLocaleString():''}</span>
              </div>
              <div class="comment-text">${c.text}</div>
            </div>`).join('')}
      </div>
      <div class="comment-input-row">
        <input id="comment-in-${docId}" placeholder="Write a comment…"/>
        <button class="btn-primary btn-sm" id="comment-send-${docId}">Send</button>
      </div>
    </div>
  `;

  const sendComment = async () => {
    const input = document.getElementById(`comment-in-${docId}`);
    const text = input.value.trim();
    if (!text) return;
    const s = await db.collection('users').doc(currentUser.uid).get();
    const name = s.exists ? s.data().displayName : currentUser.email;
    await db.collection(collection).doc(docId).collection('comments').add({
      text, authorId: currentUser.uid, authorName: name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    input.value = '';
    renderComments(collection, docId, containerId, currentUser);
  };

  document.getElementById(`comment-send-${docId}`)?.addEventListener('click', sendComment);
  document.getElementById(`comment-in-${docId}`)?.addEventListener('keydown', e => { if(e.key==='Enter') sendComment(); });
};

// ══════════════════════════════════════════════════
//  MARKETING DEPARTMENT
// ══════════════════════════════════════════════════
window.renderMarketing = async function(currentUser, currentRole, subtab = 'Advertising') {
  const c = deptContainer();
  c.innerHTML = `
    <div class="page-header"><h2>📢 Marketing</h2></div>
    <div class="subtab-bar">
      ${['Advertising','Marketing Designs','Plan','Budgeting','Proposals'].map(s =>
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
      await renderDocCollection(content, 'marketing_plans', 'Marketing Plans', currentUser, currentRole, { icon:'📅', color:'#880e4f' });
      break;
    case 'Budgeting':
      await renderBudgeting(content, currentUser, currentRole, 'Marketing');
      break;
    case 'Proposals':
      await renderDocCollection(content, 'marketing_proposals', 'Marketing Proposals', currentUser, currentRole, { icon:'📝', color:'#880e4f' });
      break;
  }
}

// ══════════════════════════════════════════════════
//  FINANCE DEPARTMENT
// ══════════════════════════════════════════════════
window.renderFinance = async function(currentUser, currentRole, subtab = 'Overview') {
  const c = deptContainer();
  c.innerHTML = `
    <div class="page-header"><h2>💰 Finance</h2></div>
    <div class="subtab-bar">
      ${['Overview','Accounting','Purchasing','SSS / Gov'].map(s =>
        `<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`
      ).join('')}
    </div>
    <div id="fin-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadFinanceContent(currentUser, currentRole, subtab);
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => { c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); loadFinanceContent(currentUser, currentRole, btn.dataset.sub); });
  });
};

async function loadFinanceContent(currentUser, currentRole, sub) {
  const content = document.getElementById('fin-content');
  switch(sub) {
    case 'Overview':
      await renderFinanceOverview(content, currentUser, currentRole);
      break;
    case 'Accounting':
      content.innerHTML = renderFileCollection('Accounting Documents', 'fin-acct', currentRole);
      bindFileCollection('fin-acct', currentUser, 'Finance', 'Accounting');
      break;
    case 'Purchasing':
      await renderDocCollection(content, 'purchase_orders', 'Purchase Orders', currentUser, currentRole, { icon:'🛒', color:'#1b5e20' });
      break;
    case 'SSS / Gov':
      content.innerHTML = renderFileCollection('SSS & Government Documents', 'fin-sss', currentRole);
      bindFileCollection('fin-sss', currentUser, 'Finance', 'SSS');
      break;
  }
}

async function renderFinanceOverview(container, currentUser, currentRole) {
  const [expSnap, salSnap] = await Promise.all([
    db.collection('expenses').get(),
    db.collection('users').get()
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
      <div class="card-header"><h3>Recent Expenses</h3></div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Description</th><th>Amount</th><th>By</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${expenses.slice(0,10).map(e => `<tr>
                <td>${e.description}</td><td>₱${fmt(e.amount)}</td>
                <td>${e.submittedByName||'—'}</td>
                <td><span class="badge ${statusBadge(e.status)}">${e.status||'pending'}</span></td>
                <td>${e.fileUrl?`<a href="${e.fileUrl}" target="_blank" class="btn-icon">📎</a>`:''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════
//  SALES DEPARTMENT
// ══════════════════════════════════════════════════
window.renderSales = async function(currentUser, currentRole, subtab = 'Quote Builder') {
  const c = deptContainer();
  c.innerHTML = `
    <div class="page-header"><h2>🤝 Sales & Client Relations</h2></div>
    <div class="subtab-bar">
      ${['Quote Builder','Client Profiles','Work Plans','Proposals'].map(s =>
        `<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`
      ).join('')}
    </div>
    <div id="sales-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadSalesContent(currentUser, currentRole, subtab);
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => { c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); loadSalesContent(currentUser, currentRole, btn.dataset.sub); });
  });
};

async function loadSalesContent(currentUser, currentRole, sub) {
  const content = document.getElementById('sales-content');
  switch(sub) {
    case 'Quote Builder':
      renderQuoteList(content, currentUser, currentRole, 'barro');
      break;
    case 'Client Profiles':
      await renderClientProfiles(content, currentUser, currentRole, 'barro');
      break;
    case 'Work Plans':
      await renderDocCollection(content, 'work_plans', 'Work Plans', currentUser, currentRole, { icon:'📋', color:'#e65100' });
      break;
    case 'Proposals':
      content.innerHTML = renderFileCollection('Proposals', 'sales-props', currentRole);
      bindFileCollection('sales-props', currentUser, 'Sales and Client Relations', 'Proposals');
      break;
  }
}

// ══════════════════════════════════════════════════
//  DESIGN DEPARTMENT
// ══════════════════════════════════════════════════
window.renderDesign = async function(currentUser, currentRole, subtab = 'Projects') {
  const c = deptContainer();
  c.innerHTML = `
    <div class="page-header"><h2>🎨 Design</h2></div>
    <div class="subtab-bar">
      ${['Projects','Clients','Product Designs','References'].map(s =>
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
              <div class="item-title">${p.name}</div>
              <span class="badge ${statusBadge(p.status)}">${p.status||'active'}</span>
            </div>
            <div class="item-meta">
              ${p.client?`<span>👤 ${p.client}</span>`:''}
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
//  BRILLIANT STEEL
// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
//  BRILLIANT STEEL — Main Module (v3)
// ══════════════════════════════════════════════════

window.renderBrilliantSteel = async function(currentUser, currentRole, subtab = 'Dashboard') {
  const c = deptContainer();
  const tabs = ['Dashboard','Quote Builder','Quotations Summary','Client Data'];
  c.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <span style="font-size:22px">⚙️</span>
      <div>
        <h2 style="font-size:18px;font-weight:800;color:#37474f">Brilliant Steel</h2>
        <p style="font-size:11px;color:var(--text-muted)">Partner Company Operations</p>
      </div>
    </div>
    <div class="subtab-bar">
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
    case 'Quote Builder':      renderBSQuoteBuilder(content, currentUser, currentRole); break;
    case 'Quotations Summary': await renderBSQuotationsSummary(content, currentUser, currentRole); break;
    case 'Client Data':        renderBSClientData(content); break;
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
              <td><code>${q.quoteNumber||q.id.slice(-8)}</code></td>
              <td>${q.clientName||'—'}</td>
              <td>₱${fmt(q.total)}</td>
              <td><span class="badge ${statusBadge(q.approvalStatus||q.status)}">${q.approvalStatus||q.status||'draft'}</span></td>
              <td>${q.agentName||'—'}</td>
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
        <img src="icons/barro-logo.png" style="height:50px;flex-shrink:0" onerror="this.style.display='none'"/>
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
  const BS_PRODUCTS = {
    'Steel Fabrication': [
      { code:'SF-001', name:'Custom Steel Counter', unit:'unit', baseRate:4500 },
      { code:'SF-002', name:'Steel Work Table',     unit:'unit', baseRate:3800 },
      { code:'SF-003', name:'Steel Shelving Unit',  unit:'unit', baseRate:2200 },
      { code:'SF-004', name:'Steel Cabinet',        unit:'unit', baseRate:5500 },
      { code:'SF-005', name:'Steel Frame Structure',unit:'set',  baseRate:8000 },
    ],
    'Stainless Products': [
      { code:'SS-001', name:'Stainless Steel Sink',      unit:'unit', baseRate:6000 },
      { code:'SS-002', name:'Stainless Hood / Exhaust',  unit:'unit', baseRate:7500 },
      { code:'SS-003', name:'Stainless Wall Panel',      unit:'sqm',  baseRate:1200 },
      { code:'SS-004', name:'Stainless Prep Table',      unit:'unit', baseRate:4200 },
      { code:'SS-005', name:'Stainless Grease Trap',     unit:'unit', baseRate:3000 },
    ],
    'Aluminum Works': [
      { code:'AL-001', name:'Aluminum Partition',  unit:'sqm',  baseRate:950  },
      { code:'AL-002', name:'Aluminum Door Frame', unit:'unit', baseRate:4800 },
      { code:'AL-003', name:'Aluminum Window',     unit:'unit', baseRate:3500 },
    ],
    'Installation': [
      { code:'IN-001', name:'Installation — Standard',  unit:'lot', baseRate:5000  },
      { code:'IN-002', name:'Installation — Heavy',     unit:'lot', baseRate:12000 },
      { code:'IN-003', name:'Site Survey / Inspection', unit:'trip',baseRate:1500  },
    ],
  };

  let bsLines = [];
  let bsRowCount = 0;

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
  const allProds = Object.entries(BS_PRODUCTS).flatMap(([cat,prods]) => prods.map(p=>({...p,cat})));

  const filterProds = (q) => {
    const term = q.toLowerCase();
    const matches = !term ? allProds : allProds.filter(p => p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term));
    if (!matches.length) { dd.innerHTML='<div style="padding:10px;color:var(--text-muted);font-size:12px">No products found</div>'; dd.classList.add('open'); return; }
    const byCat = {};
    matches.forEach(p => { if(!byCat[p.cat]) byCat[p.cat]=[]; byCat[p.cat].push(p); });
    dd.innerHTML = Object.entries(byCat).map(([cat,prods])=>
      `<div class="bs-sd-group">${cat}</div>` +
      prods.map(p=>`<div class="bs-sd-item" data-code="${p.code}" data-name="${p.name}" data-unit="${p.unit}" data-rate="${p.baseRate}">
        ${p.name} <span class="bs-sd-price">₱${p.baseRate.toLocaleString()}/${p.unit}</span></div>`).join('')
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
      catTr.innerHTML=`<td colspan="8">${cat}</td>`;
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
          <td><div contenteditable="true" class="bs-desc-edit" data-id="${line.id}">${line.name}</div>${line.notes?`<div style="font-size:11px;color:var(--text-muted);margin-top:1px" contenteditable="true">${line.notes}</div>`:''}</td>
          <td style="font-size:11px">${dimStr||'—'}</td>
          <td style="text-align:center"><input type="number" class="bs-qty-inp" value="${line.qty}" min="1" data-id="${line.id}" style="width:50px;text-align:center;border:1.5px solid var(--border);border-radius:4px;padding:3px;font-size:12px"/></td>
          <td style="text-align:center">${line.unit}</td>
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
      stTr.innerHTML=`<td colspan="6">Subtotal — ${cat}</td><td>₱${fmt(catSubtotal)}</td><td class="no-print"></td>`;
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
  const snap = isPrivileged
    ? await db.collection('bs_quotes').get()
    : await db.collection('bs_quotes').where('createdBy','==',currentUser.uid).get();
  const all = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const forApproval = all.filter(q=>q.approvalStatus==='pending_review'||q.status==='sent');
  const approved    = all.filter(q=>q.approvalStatus==='approved');
  const rejected    = all.filter(q=>q.approvalStatus==='rejected');

  const renderList = (quotes) => !quotes.length
    ? '<div class="empty-state" style="padding:30px"><div class="empty-icon">📋</div><h4>No quotations here</h4></div>'
    : `<div class="card"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Quote #</th><th>Client</th><th>Total</th><th>Agent</th><th>Status</th>${isPrivileged?'<th>Action</th>':''}</tr></thead>
        <tbody>${quotes.map(q=>`<tr>
          <td><code>${q.quoteNumber||q.id.slice(-8)}</code></td>
          <td><strong>${q.clientName||'—'}</strong><div style="font-size:11px;color:var(--text-muted)">${q.clientCompany||''}</div></td>
          <td>₱${fmt(q.total)}</td>
          <td>${q.agentName||'—'}</td>
          <td><span class="badge ${q.approvalStatus==='approved'?'badge-green':q.approvalStatus==='rejected'?'badge-red':'badge-orange'}">${q.approvalStatus||q.status||'draft'}</span></td>
          ${isPrivileged?`<td style="display:flex;gap:6px">
            ${q.approvalStatus==='pending_review'?`
              <button class="btn-primary btn-sm bs-approve-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${q.clientName}" data-qno="${q.quoteNumber}">✅ Approve</button>
              <button class="btn-danger btn-sm bs-reject-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${q.clientName}" data-qno="${q.quoteNumber}">❌ Reject</button>
            `:q.approvalStatus==='approved'?'<span style="color:var(--success);font-size:12px">Approved</span>':'<span style="color:var(--danger);font-size:12px">Rejected</span>'}
          </td>`:''}
        </tr>`).join('')}</tbody>
      </table></div></div>`;

  container.innerHTML = `
    <div class="subtab-bar" style="margin-top:0">
      <button class="subtab-btn active" data-qsub="for-approval">For Approval (${forApproval.length})</button>
      <button class="subtab-btn" data-qsub="approved">Approved (${approved.length})</button>
      <button class="subtab-btn" data-qsub="rejected">Rejected (${rejected.length})</button>
    </div>
    <div id="qs-content">${renderList(forApproval)}</div>
  `;

  const qsContent = container.querySelector('#qs-content');
  container.querySelectorAll('[data-qsub]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-qsub]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const which = btn.dataset.qsub;
      qsContent.innerHTML = renderList(which==='for-approval'?forApproval:which==='approved'?approved:rejected);
      bindQuoteActions(qsContent, currentUser, currentRole, container);
    });
  });
  bindQuoteActions(qsContent, currentUser, currentRole, container);
}

function bindQuoteActions(el, currentUser, currentRole, container) {
  el.querySelectorAll('.bs-approve-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      await db.collection('bs_quotes').doc(b.dataset.id).update({ approvalStatus: 'approved', approvedAt: firebase.firestore.FieldValue.serverTimestamp(), approvedBy: currentUser.uid });
      await db.collection('approval_requests').where('quoteId','==',b.dataset.id).get().then(s => s.docs.forEach(d => d.ref.update({status:'approved'})));
      if (b.dataset.by) await Notifs.send(b.dataset.by, { title:'✅ Quote Approved!', body:`Quotation "${b.dataset.qno}" for ${b.dataset.name} was approved.`, icon:'✅', type:'quote_approved' });
      Notifs.showToast('Quote approved!');
      renderBSQuotationsSummary(container, currentUser, currentRole);
    });
  });
  el.querySelectorAll('.bs-reject-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      await db.collection('bs_quotes').doc(b.dataset.id).update({ approvalStatus: 'rejected', rejectedAt: firebase.firestore.FieldValue.serverTimestamp() });
      await db.collection('approval_requests').where('quoteId','==',b.dataset.id).get().then(s => s.docs.forEach(d => d.ref.update({status:'rejected'})));
      if (b.dataset.by) await Notifs.send(b.dataset.by, { title:'❌ Quote Not Approved', body:`Quotation "${b.dataset.qno}" for ${b.dataset.name} was not approved.`, icon:'❌', type:'quote_rejected' });
      Notifs.showToast('Quote rejected.');
      renderBSQuotationsSummary(container, currentUser, currentRole);
    });
  });
}

// ── Brilliant Steel Client Data ────────────────────
function renderBSClientData(container) {
  const sheetId = window.SHEETS_CONFIG?.SPREADSHEET_ID;
  const sheetUrl = sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit?usp=sharing` : '';
  container.innerHTML = `
    <div class="page-header"><h2>👤 Client Data</h2>
      ${sheetUrl?`<a href="${sheetUrl}" target="_blank" class="btn-primary btn-sm">↗ Open in Google Sheets</a>`:''}
    </div>
    ${sheetUrl?`
      <div class="card" style="margin-bottom:14px">
        <div class="card-body" style="padding:0;border-radius:10px;overflow:hidden;position:relative">
          <iframe src="${sheetUrl.replace('/edit','/htmlview')}&rm=minimal"
            style="width:100%;height:480px;border:none"
            title="Brilliant Steel Clients"></iframe>
        </div>
      </div>
      <p style="font-size:12px;color:var(--text-muted);text-align:center">Data from Google Sheets · <a href="${sheetUrl}" target="_blank">Edit directly in Sheets ↗</a></p>
    `:`
      <div class="card"><div class="card-body">
        <div class="empty-state"><div class="empty-icon">📊</div>
          <h4>Google Sheets Not Configured</h4>
          <p>Set <code>SPREADSHEET_ID</code> in js/config.js and enable <code>SHEETS_CONFIG.ENABLED = true</code>.</p>
        </div>
      </div></div>
    `}
  `;
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
          <div class="item-title">${brand==='brilliant-steel'?'BS':'Q'}-${q.quoteNumber||q.id.slice(-6).toUpperCase()} — ${q.clientName||'Unnamed'}</div>
          <span class="badge ${statusBadge(q.status)}">${q.status||'draft'}</span>
        </div>
        <div class="item-meta">
          <span>💰 ₱${fmt(q.total)}</span>
          <span>👤 ${q.agentName||'—'}</span>
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
      <div class="form-group"><label>Client Name</label><input id="q-client" value="${existing?.clientName||''}"/></div>
      <div class="form-group"><label>Client Email</label><input id="q-client-email" type="email" value="${existing?.clientEmail||''}"/></div>
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
    <div class="form-group"><label>Notes</label><textarea id="q-notes" rows="2">${existing?.notes||''}</textarea></div>
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
        <input type="text" value="${l.description}" data-i="${i}" data-f="description" placeholder="Description"/>
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
  <p><strong>Quote for:</strong> ${q?.clientName||'Client'} &nbsp;&nbsp; <strong>Date:</strong> ${q?.date||today()}</p>
  <table><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr>
  ${lines.map(l=>`<tr><td>${l.description}</td><td>${l.qty}</td><td>₱${fmt(l.price)}</td><td>₱${fmt(l.qty*l.price)}</td></tr>`).join('')}
  </table>
  <div class="total">Total: ₱${fmt(total)}</div>
  <div class="footer">Valid until: ${q?.validUntil||'N/A'} · ${q?.notes||''}</div>
  <script>window.print();<\/script></body></html>`);
}

// ══════════════════════════════════════════════════
//  OWNER — APPROVAL REQUESTS
// ══════════════════════════════════════════════════
window.renderApprovals = async function(currentUser) {
  const c = deptContainer();
  c.innerHTML = `
    <div class="page-header"><h2>Approvals</h2></div>
    <div class="subtab-bar">
      <button class="subtab-btn active" data-sub="roa">Quote / ROA</button>
      <button class="subtab-btn" data-sub="ca">Cash Advances</button>
    </div>
    <div id="approvals-content"><div class="loading-placeholder">Loading…</div></div>
  `;

  const loadApprovalsSub = async (sub) => {
    const wrap = document.getElementById('approvals-content');
    if (!wrap) return;
    wrap.innerHTML = '<div class="loading-placeholder">Loading…</div>';

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
              <div class="item-title">💸 Cash Advance — ${item.userName||'Unknown'}</div>
              <span class="badge ${statusBadge(item.status)}">${item.status||'pending'}</span>
            </div>
            <div class="item-meta">
              <span>₱${fmt(item.amount)}</span>
              <span>Date: ${item.date||'—'}</span>
              <span>Repay: ${item.repayDate||'—'}</span>
            </div>
            ${item.reason?`<div style="font-size:12px;color:var(--text-muted);margin-top:6px;padding:8px 10px;background:var(--surface2);border-radius:6px">${item.reason}</div>`:''}
            ${item.status==='pending'?`
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-success ca-approve" data-id="${item.id}" data-uid="${item.userId}" data-name="${item.userName}" data-amount="${item.amount}">Approve</button>
              <button class="btn-danger ca-reject" data-id="${item.id}" data-uid="${item.userId}" data-name="${item.userName}">Reject</button>
            </div>`:''}
          </div>`).join('')}
        </div>
      `;

      wrap.querySelectorAll('.ca-approve').forEach(btn => {
        btn.addEventListener('click', async e => {
          const { id, uid, name, amount } = e.currentTarget.dataset;
          await db.collection('cash_advances').doc(id).update({ status:'approved', approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
          await Notifs.send(uid, { title:'Cash Advance Approved', body:`Your ₱${fmt(parseFloat(amount))} request has been approved.`, icon:'💸', type:'cash_advance' });
          Notifs.showToast(`Approved ₱${fmt(parseFloat(amount))} for ${name}`);
          loadApprovalsSub('ca');
        });
      });
      wrap.querySelectorAll('.ca-reject').forEach(btn => {
        btn.addEventListener('click', async e => {
          const { id, uid, name } = e.currentTarget.dataset;
          await db.collection('cash_advances').doc(id).update({ status:'rejected' });
          await Notifs.send(uid, { title:'Cash Advance Declined', body:'Your cash advance request was not approved this time.', icon:'💸', type:'cash_advance' });
          Notifs.showToast('Request rejected.');
          loadApprovalsSub('ca');
        });
      });

    } else {
      // Quote / ROA approvals
      const snap = await db.collection('approval_requests').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
      const items = snap.docs.map(d => ({id:d.id,...d.data()}));
      if (!items.length) { wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">✔️</div><h4>No quote approvals</h4></div>'; return; }

      wrap.innerHTML = `<div class="item-list">${items.map(item => `
        <div class="item-card" data-id="${item.id}">
          <div class="item-top">
            <div class="item-title">${item.type==='bs_quote'?'Brilliant Steel Quote':'Quote'} — ${item.clientName||''}</div>
            <span class="badge ${statusBadge(item.status)}">${item.status||'pending'}</span>
          </div>
          <div class="item-meta">
            <span>${item.agentName||'—'}</span>
            <span>₱${fmt(item.total)}</span>
            ${item.createdAt?`<span>${new Date(item.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
          </div>
          ${item.status==='pending'?`
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn-success approve-approval" data-id="${item.id}" data-agent="${item.agentId}" data-client="${item.clientName}">Approve</button>
            <button class="btn-danger reject-approval"  data-id="${item.id}" data-agent="${item.agentId}" data-client="${item.clientName}">Reject</button>
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

  loadApprovalsSub('roa');
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
            <div class="item-title">${cl.name}</div>
            <div class="item-meta">
              ${cl.company?`<span>🏢 ${cl.company}</span>`:''}
              ${cl.email?`<span>✉️ ${cl.email}</span>`:''}
              ${cl.phone?`<span>📞 ${cl.phone}</span>`:''}
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
  const canAdd = currentRole==='owner'||currentRole==='manager';

  container.innerHTML = `
    ${canAdd?`<div style="text-align:right;margin-bottom:12px"><button class="btn-primary btn-sm" id="add-doc-btn">+ Add ${title.slice(0,-1)}</button></div>`:''}
    <div class="policy-grid">
      ${!docs.length
        ? `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">${opts.icon||'📄'}</div><h4>No ${title} yet</h4></div>`
        : docs.map(d => `
          <div class="policy-card">
            <div class="policy-icon">${opts.icon||'📄'}</div>
            <div class="policy-title">${d.title}</div>
            <div class="policy-desc">${d.description||''}</div>
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
  const canUpload = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='employee'||currentRole==='agent';
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

  // Load files
  db.collection(collection).orderBy('createdAt','desc').get().then(snap => {
    const files = snap.docs.map(d => ({id:d.id,...d.data()}));
    if (!files.length) { filesDiv.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon">📁</div><p>No files uploaded yet</p></div>`; return; }
    filesDiv.innerHTML = files.map(f => `
      <div class="item-card">
        <div class="item-top">
          <div class="item-title">📄 ${f.name}</div>
          ${f.url?`<a href="${f.url}" target="_blank" class="btn-primary btn-sm">Open</a>`:''}
        </div>
        <div class="item-meta">
          <span>👤 ${f.uploadedByName||'—'}</span>
          ${f.createdAt?`<span>${new Date(f.createdAt.toDate()).toLocaleDateString()}</span>`:''}
        </div>
      </div>`).join('');
  });

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
  const snap = await db.collection(collection).get();
  const items = snap.docs.map(d => ({id:d.id,...d.data()}));
  const total    = items.reduce((s,i) => s+(i.budget||0), 0);
  const spent    = items.reduce((s,i) => s+(i.spent||0), 0);
  const canEdit  = currentRole==='owner'||currentRole==='manager'||currentRole==='finance';

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Total Budget</div><div class="kpi-value">₱${fmt(total)}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Total Spent</div><div class="kpi-value">₱${fmt(spent)}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Remaining</div><div class="kpi-value">₱${fmt(total-spent)}</div></div>
    </div>
    ${canEdit?`<div style="text-align:right;margin-bottom:12px"><button class="btn-primary btn-sm" id="add-budget-btn">+ Add Budget Line</button></div>`:''}
    <div class="card">
      <div class="card-body">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Item</th><th>Budget</th><th>Spent</th><th>Remaining</th></tr></thead>
            <tbody>
              ${items.map(i => `<tr>
                <td>${i.name}</td>
                <td>₱${fmt(i.budget)}</td>
                <td>₱${fmt(i.spent)}</td>
                <td style="color:${i.budget-i.spent<0?'var(--danger)':'var(--success)'}">₱${fmt(i.budget-i.spent)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('add-budget-btn')?.addEventListener('click', () => {
    openModal('Add Budget Line', `
      <div class="form-group"><label>Item Name</label><input id="bg-name" placeholder="e.g. Social Media Ads"/></div>
      <div class="form-row">
        <div class="form-group"><label>Budget (₱)</label><input id="bg-budget" type="number" step="0.01"/></div>
        <div class="form-group"><label>Spent So Far (₱)</label><input id="bg-spent" type="number" step="0.01" value="0"/></div>
      </div>
    `, `<button class="btn-primary" id="save-bg-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-bg-btn').addEventListener('click', async () => {
      await db.collection(collection).add({
        name:   document.getElementById('bg-name').value.trim(),
        budget: parseFloat(document.getElementById('bg-budget').value)||0,
        spent:  parseFloat(document.getElementById('bg-spent').value)||0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); renderBudgeting(container, currentUser, currentRole, dept);
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

  const loadFiles = async () => {
    listEl.innerHTML = '<div class="loading-placeholder">Loading…</div>';
    let snap;
    if (filterUid) {
      snap = await db.collection(collection).where('uploadedBy','==',filterUid).get();
    } else {
      snap = await db.collection(collection).where('department','==',dept).get();
    }
    const files = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    if (!files.length) { listEl.innerHTML='<div class="empty-state" style="padding:20px"><div class="empty-icon">📁</div><h4>No files yet</h4></div>'; return; }
    listEl.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Name</th><th>Type</th><th>Uploaded By</th><th>Date</th><th></th></tr></thead>
      <tbody>${files.map(f=>`<tr>
        <td><a href="${f.url}" target="_blank" style="color:var(--primary);font-weight:600">${f.name||'File'}</a></td>
        <td>${f.fileType||'—'}</td>
        <td>${f.uploaderName||'—'}</td>
        <td style="font-size:11px;color:var(--text-muted)">${f.createdAt?new Date(f.createdAt.toDate()).toLocaleDateString('en-PH'):''}</td>
        <td><a href="${f.url}" target="_blank" class="btn-secondary btn-sm">⬇ Download</a></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  };

  loadFiles();

  uploadBtn?.addEventListener('click', () => {
    openModal('Upload File', `
      <div class="form-group"><label>File Name / Title</label><input id="fn-title" placeholder="Descriptive name"/></div>
      <div class="form-group"><label>File Type</label>
        <select id="fn-type"><option>Document</option><option>Image</option><option>Spreadsheet</option><option>PDF</option><option>Other</option></select>
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
  const canAdd = currentRole==='president'||currentRole==='owner'||currentRole==='manager';
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
        <div class="item-top"><div class="item-title">${d.title||d.name||'Untitled'}</div>
          <span class="badge ${statusBadge(d.status)}">${d.status||'active'}</span>
        </div>
        <div class="item-meta">
          ${d.description?`<span>${d.description}</span>`:''}
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
