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
  c.innerHTML = `
    <div class="page-header">
      <h2>✅ Tasks</h2>
      <div class="page-actions">
        <select id="task-filter" class="select-sm">
          <option value="mine">My Tasks</option>
          <option value="all">All Tasks</option>
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

async function loadTasksList(currentUser, currentRole, currentDept) {
  const list   = document.getElementById('tasks-list');
  const filter = document.getElementById('task-filter')?.value || 'mine';
  list.innerHTML = '<div class="loading-placeholder">Loading…</div>';

  let snap;
  if (filter === 'mine') {
    snap = await db.collection('tasks').where('assignedTo','==',currentUser.uid).get();
  } else if (currentRole === 'owner' || currentRole === 'manager') {
    snap = await db.collection('tasks').orderBy('createdAt','desc').get();
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
  openModal(t.title, `
    <div style="margin-bottom:12px">
      <span class="badge ${priorityBadge(t.priority)}">${t.priority||'medium'} priority</span>
      <span class="badge ${statusBadge(t.status)}" style="margin-left:6px">${t.status||'open'}</span>
    </div>
    <p style="font-size:14px;line-height:1.6;margin-bottom:12px">${t.description||'No description.'}</p>
    <div class="text-muted" style="margin-bottom:14px">
      ${t.assignedToName?`Assigned to: <strong>${t.assignedToName}</strong> &nbsp;`:''}
      ${t.dueDate?`Due: <strong>${t.dueDate}</strong>`:''}
    </div>
    <hr class="divider"/>
    <div id="task-comments-wrap"></div>
  `, `
    ${t.status!=='done'?`<button class="btn-success" id="mark-done-btn">✅ Mark Done</button>`:''}
    ${(currentRole==='owner'||t.createdBy===currentUser.uid)?`<button class="btn-danger" id="del-task-btn">Delete</button>`:''}
    <button class="btn-secondary" onclick="closeModal()">Close</button>
  `);
  renderComments('tasks', taskId, 'task-comments-wrap', currentUser);
  document.getElementById('mark-done-btn')?.addEventListener('click', async () => {
    await db.collection('tasks').doc(taskId).update({status:'done'});
    closeModal(); renderTasks(currentUser, currentRole, t.department);
  });
  document.getElementById('del-task-btn')?.addEventListener('click', async () => {
    if (confirm('Delete task?')) { await db.collection('tasks').doc(taskId).delete(); closeModal(); renderTasks(currentUser, currentRole, t.department); }
  });
}

function openAddTaskModal(currentUser, currentRole) {
  openModal('New Task', `
    <div class="form-group"><label>Title</label><input id="t-title" placeholder="Task name"/></div>
    <div class="form-group"><label>Description</label><textarea id="t-desc" rows="3" placeholder="Details…"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Priority</label>
        <select id="t-priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select>
      </div>
      <div class="form-group"><label>Due Date</label><input id="t-due" type="date" value="${today()}"/></div>
    </div>
    <div class="form-group"><label>Assign To (Name)</label><input id="t-assign" placeholder="Team member name"/></div>
    <div class="form-group"><label>Assign To (UID — optional)</label><input id="t-uid" placeholder="Paste UID for notifications"/></div>
    <div class="form-group"><label>Department</label><input id="t-dept" placeholder="Department"/></div>
  `, `<button class="btn-primary" id="create-task-btn">Create Task</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  document.getElementById('create-task-btn').addEventListener('click', async () => {
    const assignedTo  = document.getElementById('t-uid').value.trim();
    const assignedName= document.getElementById('t-assign').value.trim();
    const dept        = document.getElementById('t-dept').value.trim();
    const snap        = await db.collection('users').doc(currentUser.uid).get();
    const creatorName = snap.exists ? snap.data().displayName : '';

    await db.collection('tasks').add({
      title:          document.getElementById('t-title').value.trim(),
      description:    document.getElementById('t-desc').value.trim(),
      priority:       document.getElementById('t-priority').value,
      dueDate:        document.getElementById('t-due').value,
      assignedTo,
      assignedToName: assignedName,
      department:     dept,
      status:         'open',
      createdBy:      currentUser.uid,
      createdByName:  creatorName,
      createdAt:      firebase.firestore.FieldValue.serverTimestamp()
    });

    if (assignedTo) {
      await Notifs.send(assignedTo, {
        title: '📌 New Task Assigned',
        body:  `"${document.getElementById('t-title').value.trim()}" assigned by ${creatorName}`,
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
  const isPrivileged = currentRole === 'owner' || currentRole === 'manager' || currentRole === 'finance';
  const snap = isPrivileged
    ? await db.collection('submissions').orderBy('createdAt','desc').get()
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
  const isPrivileged = currentRole === 'owner' || currentRole === 'manager' || currentRole === 'finance';

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
  const isPrivileged = currentRole === 'owner' || currentRole === 'finance';

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
  const isPrivileged = currentRole === 'owner' || currentRole === 'finance';
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
  const canAdd = currentRole === 'owner' || currentRole === 'manager';

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
window.renderBrilliantSteel = async function(currentUser, currentRole, subtab = 'Quote Builder') {
  const c = deptContainer();
  c.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <span style="font-size:22px">⚙️</span>
      <div>
        <h2 style="font-size:18px;font-weight:800;color:#37474f">Brilliant Steel</h2>
        <p style="font-size:11px;color:var(--text-muted)">Partner Company Operations</p>
      </div>
    </div>
    <div class="subtab-bar">
      ${['Quote Builder','Quote History','Client Records','Request Approval'].map(s =>
        `<button class="subtab-btn ${s===subtab?'active':''}" data-sub="${s}">${s}</button>`
      ).join('')}
    </div>
    <div id="bs-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadBSContent(currentUser, currentRole, subtab);
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => { c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); loadBSContent(currentUser, currentRole, btn.dataset.sub); });
  });
};

let bsQuoteLines = [];
let bsActiveQuoteId = null;

async function loadBSContent(currentUser, currentRole, sub) {
  const content = document.getElementById('bs-content');
  switch(sub) {
    case 'Quote Builder':
      renderQuoteList(content, currentUser, currentRole, 'brilliant-steel');
      break;
    case 'Quote History':
      await renderBSHistory(content, currentUser, currentRole);
      break;
    case 'Client Records':
      await renderClientProfiles(content, currentUser, currentRole, 'brilliant-steel');
      break;
    case 'Request Approval':
      await renderApprovalRequest(content, currentUser);
      break;
  }
}

async function renderBSHistory(container, currentUser, currentRole) {
  const isPrivileged = currentRole === 'owner' || currentRole === 'manager';
  const snap = isPrivileged
    ? await db.collection('bs_quotes').orderBy('createdAt','desc').get()
    : await db.collection('bs_quotes').where('createdBy','==',currentUser.uid).get();
  const quotes = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

  container.innerHTML = `
    <div class="item-list">
      ${!quotes.length
        ? `<div class="empty-state"><div class="empty-icon">📜</div><h4>No quote history</h4></div>`
        : quotes.map(q => `
          <div class="item-card">
            <div class="item-top">
              <div class="item-title">BS-${q.quoteNumber||q.id.slice(-6).toUpperCase()} — ${q.clientName||'Client'}</div>
              <span class="badge ${statusBadge(q.status)}">${q.status||'draft'}</span>
            </div>
            <div class="item-meta">
              <span>💰 ₱${fmt(q.total)}</span>
              <span>👤 ${q.agentName||'—'}</span>
              ${q.approvalStatus?`<span class="badge ${q.approvalStatus==='approved'?'badge-green':'badge-orange'}">${q.approvalStatus}</span>`:''}
            </div>
          </div>`).join('')}
    </div>
  `;
}

async function renderApprovalRequest(container, currentUser) {
  const snap = await db.collection('bs_quotes').where('createdBy','==',currentUser.uid).get();
  const quotes = snap.docs.map(d => ({id:d.id,...d.data()})).filter(q => q.status === 'sent');

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>🔍 Request Owner Review</h3></div>
      <div class="card-body">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Select a quote to send for owner approval. The owner will receive a notification and can approve or reject it.</p>
        ${!quotes.length
          ? `<p style="color:var(--text-muted)">No sent quotes available for approval request.</p>`
          : quotes.map(q => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:8px">
              <div>
                <strong>BS-${q.quoteNumber||q.id.slice(-6)} — ${q.clientName}</strong>
                <div class="text-muted">₱${fmt(q.total)}</div>
              </div>
              <button class="btn-primary btn-sm request-approval-btn" data-id="${q.id}" data-name="${q.clientName}" data-total="${q.total}">Request Review</button>
            </div>`).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.request-approval-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id    = e.currentTarget.dataset.id;
      const name  = e.currentTarget.dataset.name;
      const total = e.currentTarget.dataset.total;
      const s = await db.collection('users').doc(currentUser.uid).get();
      const agentName = s.exists ? s.data().displayName : currentUser.email;

      await db.collection('bs_quotes').doc(id).update({ approvalStatus: 'pending_review', reviewRequestedAt: firebase.firestore.FieldValue.serverTimestamp() });
      await db.collection('approval_requests').add({
        type:       'bs_quote',
        quoteId:    id,
        clientName: name,
        total:      parseFloat(total),
        agentName,
        agentId:    currentUser.uid,
        status:     'pending',
        createdAt:  firebase.firestore.FieldValue.serverTimestamp()
      });
      await Notifs.sendToOwner({
        title: '⚙️ Brilliant Steel Quote Review Requested',
        body:  `${agentName} requests review of quote for ${name} — ₱${fmt(total)}`,
        icon:  '⚙️', type: 'quote_review_request'
      });
      Notifs.showToast('Review request sent to owner!');
      renderBrilliantSteel(currentUser, '', 'Request Approval');
    });
  });
}

// ══════════════════════════════════════════════════
//  SHARED QUOTE BUILDER (Barro + Brilliant Steel)
// ══════════════════════════════════════════════════
function renderQuoteList(container, currentUser, currentRole, brand) {
  const collection = brand === 'brilliant-steel' ? 'bs_quotes' : 'quotes';
  const isPrivileged = currentRole === 'owner' || currentRole === 'manager';

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
    <div class="page-header"><h2>✔️ Approval Requests</h2></div>
    <div id="approvals-list" class="item-list"><div class="loading-placeholder">Loading…</div></div>
  `;
  const snap = await db.collection('approval_requests').orderBy('createdAt','desc').get();
  const items = snap.docs.map(d => ({id:d.id,...d.data()}));
  const list  = document.getElementById('approvals-list');

  if (!items.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">✔️</div><h4>No pending approvals</h4></div>`; return; }
  list.innerHTML = items.map(item => `
    <div class="item-card" data-id="${item.id}">
      <div class="item-top">
        <div class="item-title">⚙️ ${item.type==='bs_quote'?'Brilliant Steel Quote':'Request'} — ${item.clientName||''}</div>
        <span class="badge ${statusBadge(item.status)}">${item.status||'pending'}</span>
      </div>
      <div class="item-meta">
        <span>👤 ${item.agentName}</span>
        <span>💰 ₱${fmt(item.total)}</span>
        ${item.createdAt?`<span>📅 ${new Date(item.createdAt.toDate()).toLocaleDateString()}</span>`:''}
      </div>
      ${item.status==='pending'?`
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn-success approve-approval" data-id="${item.id}" data-agent="${item.agentId}" data-client="${item.clientName}">✅ Approve</button>
        <button class="btn-danger reject-approval"  data-id="${item.id}" data-agent="${item.agentId}" data-client="${item.clientName}">❌ Reject</button>
      </div>`:''}
    </div>
  `).join('');

  list.querySelectorAll('.approve-approval').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.currentTarget.dataset.id; const agentId = e.currentTarget.dataset.agent; const client = e.currentTarget.dataset.client;
      await db.collection('approval_requests').doc(id).update({ status: 'approved' });
      await Notifs.send(agentId, { title:'✅ Quote Approved', body:`Your quote for ${client} was approved by the owner.`, icon:'✅', type:'approval_result' });
      Notifs.showToast('Quote approved!'); renderApprovals(currentUser);
    });
  });
  list.querySelectorAll('.reject-approval').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.currentTarget.dataset.id; const agentId = e.currentTarget.dataset.agent; const client = e.currentTarget.dataset.client;
      await db.collection('approval_requests').doc(id).update({ status: 'rejected' });
      await Notifs.send(agentId, { title:'❌ Quote Rejected', body:`Your quote for ${client} was not approved. Please revise.`, icon:'❌', type:'approval_result' });
      Notifs.showToast('Quote rejected.'); renderApprovals(currentUser);
    });
  });
};

// ══════════════════════════════════════════════════
//  SHARED: Client Profiles
// ══════════════════════════════════════════════════
async function renderClientProfiles(container, currentUser, currentRole, brand) {
  const collection = brand === 'brilliant-steel' ? 'bs_clients' : (brand === 'design' ? 'design_clients' : 'sales_clients');
  const snap = await db.collection(collection).orderBy('createdAt','desc').get();
  const clients = snap.docs.map(d => ({id:d.id,...d.data()}));
  const canAdd = currentRole==='owner'||currentRole==='manager'||currentRole==='agent';

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
  const canUpload = currentRole==='owner'||currentRole==='manager'||currentRole==='employee'||currentRole==='agent';
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
