/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Tasks + Submissions screens
   js/screens/tasks.js

   Wave 7 Pass 1 — split out of js/departments.js verbatim, 2026-08-03,
   following the Wave 2 (design.js) extraction protocol. Still plain
   `window.*`-attached globals, no ESM, no bundler — this file is a
   physical split only, not a module.

   Contents: the Task Status System (TASK_STATUSES/EMP_STATUSES/
   DONE_STATUSES/SCORE_STATUSES + normTask/fuTime/followUpCardInner/
   updateCardFollowUpBadge/assigneeChips/taskCard/notifyTaskInvolved),
   the shared department Tasks subtab (renderDeptTasks), the Tasks board
   (renderTasks/loadPresidentTasks/loadTasksList/openTaskDetail/
   openEditTaskModal/openAddTaskModal/closeTaskPanel/
   recomputePresidentTaskScore), and Submissions (renderSubmissions/
   loadSubsList/openSubDetail/openAddSubModal).

   DELIBERATELY LEFT IN departments.js (shared helpers — grepped for
   outside callers before this move; see that file's "Task Status
   System" comment near the top):
     - statusBadge / statusLabel — genuinely cross-domain (quotes, gov
       biddings, expenses, POs, attendance all read them too, not just
       tasks), same as the Wave 2 precedent that kept statusBadge behind
       for design.js. Both still special-case the Tasks status table,
       but now read it via window.TASK_STATUSES (see the two-line edit
       in departments.js) since the TASK_STATUSES const itself moved
       here with the rest of the Tasks status system.
     - renderApprovals (+ approveQuoteApproval/returnQuoteToPartner/
       openQuoteApprovalReview) — left in place this pass (see pass
       report); it calls this file's normTask/notifyTaskInvolved/
       openTaskDetail/renderDeptTasks as plain global identifiers at
       runtime, which resolves fine regardless of file — exactly the
       same forward-reference pattern design.js's header documents for
       departments.js's shared helpers, just in the other direction.
     - priorityBadge, safeNotify, today(), canEditDept, deptContainer,
       openPage/closeModal/openPage, Notifs, Drive, db — generic
       app-wide helpers untouched by this split.

   LOAD-ORDER CONTRACT (see index.html + CLAUDE.md "Script load order
   is load-bearing"):
     - Loads AFTER js/departments.js and js/screens/design.js. Every
       function in this file is invoked only at runtime (click handlers,
       navigateTo() dispatch, promise callbacks) — never at parse time —
       so it is safe for departments.js's shared helpers to still be
       undefined at the moment THIS file's top-level code runs, and
       equally safe for departments.js's renderApprovals (which loads
       BEFORE this file but only calls into it later, at runtime) to
       reference this file's globals.
     - window.renderTasks and window.renderSubmissions are the entry
       points called from outside this file (js/app.js navigateTo()
       switch, cases 'tasks' / 'submissions').
     - window.openTaskDetail / window.closeTaskPanel are also
       window-attached for external callers (js/app.js, js/modules.js,
       js/notifications.js, js/screens/design.js's taskCard usage).
     - window.TASK_STATUSES is re-exported here (was already exported
       from departments.js pre-move; ui-status-meta.js's lazy
       `task: () => window.TASK_STATUSES || []` passthrough still
       resolves correctly regardless of which file sets it, since it's
       only dereferenced at call time).
     - TASK_STATUSES / EMP_STATUSES / DONE_STATUSES / SCORE_STATUSES are
       plain top-level `const`s (script-scoped, NOT window properties in
       a browser — const/let at a script's top level never become
       globalThis/window props, same caveat design.js documents for
       DRAWING_STATUSES). They must stay in THIS file alongside every
       function that reads them.
   ═══════════════════════════════════════════════════ */

// ── Task Status System ─────────────────────────────
const TASK_STATUSES = [
  { value:'backlog',      label:'Backlog',               badge:'badge-gray'   },
  { value:'brainstorm',   label:'Brainstorming',         badge:'badge-purple' },
  { value:'in-progress',  label:'In Progress',           badge:'badge-blue'   },
  { value:'submitted',    label:'In Review',             badge:'badge-orange' }, // 'review' is canonical; kept for read-compat with stragglers
  { value:'review',       label:'In Review',             badge:'badge-orange' },
  { value:'returned',     label:'Returned for Revision', badge:'badge-red'    },
  { value:'approved',     label:'Approved',              badge:'badge-green'  },
  { value:'done',         label:'Done',                  badge:'badge-green'  },
  { value:'on-hold',      label:'On Hold',               badge:'badge-orange' },
  { value:'archived',     label:'Archived',              badge:'badge-gray'   },
];
window.TASK_STATUSES = TASK_STATUSES; // v13: STATUS_META 'task' passthrough
const EMP_STATUSES   = ['backlog','brainstorm','in-progress','submitted'];
// Re-audit 2026-08-03: TASK_STATUSES deliberately carries BOTH 'submitted' and
// 'review' mapped to the same "In Review" label (read-compat with legacy
// docs), but rendered verbatim every status-SETTING <select> showed two
// indistinguishable "In Review" options. 'review' is canonical for anything
// picked going forward; this trims 'submitted' out of the choices UNLESS a
// task's live status is already literally 'submitted' (so its own row stays
// selectable/visible instead of silently defaulting to a different option).
function selectableTaskStatuses(list, currentStatus) {
  return list.filter(s => s.value !== 'submitted' || currentStatus === 'submitted');
}
// Re-audit 2026-08-03: was missing 'done' even though TASK_STATUSES lists it as
// a distinct terminal status and dashboards.js's own CLOSED_STATUSES already
// includes it — a task marked Done stayed visible under Overdue/Near-Due here.
const DONE_STATUSES  = ['done','approved','archived'];
const SCORE_STATUSES = ['approved','on-hold','archived'];

// ── Task authority — ONE predicate for every privilege gate in this file ─────
// Mirrors firestore.rules' isOpsAdmin() (president | manager | secretary |
// finance), which is the tier the tasks UPDATE rule admits BESIDES the assignee
// (firestore.rules:815-817), and which isAdmin() — create/delete — is a subset
// of. Until 2026-08-10 this file spelled that set out as a literal
// `president|owner|manager|finance` in FIVE separate places, every one of them
// written against isFinanceOrAdmin(), a rules helper that was DELETED in the
// 2026-08-09 split. Its successor on this verb, isOpsAdmin(), added 'secretary'
// — so all five literals silently withheld company-wide task authority from the
// Corporate Secretary while the rules granted it and their own dashboard counted
// every task in the company. Five copies is how that happened; there is one now.
//
// Delegates to window.isOpsPriv() (js/departments.js) rather than re-listing the
// roles, so the client mirror of the rule lives in exactly one place. isOpsPriv()
// reads window.currentRole, which is the session role every caller in this file
// is handed. president/owner are honoured explicitly first only because one
// external caller passes a literal 'president' fallback for the moment
// window.currentRole is unset (js/screens/approvals.js, the review-task list);
// both are inside isOpsPriv()'s set anyway, so this never widens it.
function taskOpsPriv(role) {
  if (role === 'president' || role === 'owner') return true;
  return typeof window.isOpsPriv === 'function' && window.isOpsPriv();
}

// ⚠ THE DEPARTMENT WALL, APPLIED TO EVERY OVERSIGHT TASK LIST.
// Putting the Corporate Secretary on the oversight LAYOUT (see the branch in
// renderTasks) is correct — their own dashboard already counts company-wide
// open and overdue tasks. But the lists behind that layout read the tasks
// collection UNFILTERED and group by department, so without this they would
// see every # Finance and # IT task: title, description and assignee. That is
// the exact boundary the owner drew twice ("all departments except finance,
// and IT"), reopened from a direction nobody was watching.
//
// This is a UI-layer scope, deliberately. The rules cannot express it without
// breaking the list query — tasks are read as one full-collection get, and a
// per-document department test is not provable from that query, which is how
// the conversations inbox was nearly broken on this same pass. The read is
// permitted; what we owe is not to SHOW it.
function scopeTasksToRole(tasks) {
  const blocked = window.SECRETARY_BLOCKED_DEPTS || ['Finance', 'IT'];
  if ((window.currentRole || '') !== 'secretary') return tasks;
  return tasks.filter(t => !blocked.includes(t.department || ''));
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
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted)">${emojiIcon('📣',16)} Follow-up Requests</div>
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
            ${!pending&&fu.addressedByName?`<div style="font-size:11px;color:var(--success,#34c759);margin-top:4px">${emojiIcon('✓',11)} ${escHtml(fu.addressedByName)}${fuTime(fu.addressedAt)?' · '+fuTime(fu.addressedAt):''}</div>`:''}
            ${pending&&(isAdmin||isAssignee)?`<button class="btn-success btn-sm fu-addr-btn" data-fu="${escHtml(fu.id||'')}" style="margin-top:6px">${emojiIcon('✓',16)} Mark addressed</button>`:''}
          </div>`;
        }).join('')}
      </div>` : `<div style="font-size:12px;color:var(--text-muted);margin-bottom:${isAdmin?'10px':'0'}">No follow-ups yet.</div>`}
      ${isAdmin?`<div style="display:flex;gap:6px">
        <input id="fu-input" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)" placeholder="Ask the assignee for an update…"/>
        <button class="btn-primary btn-sm" id="fu-request-btn">${emojiIcon('📣',16)} Request</button>
      </div>`:''}
    </div>`;
}
// Sync the 📣 follow-up badge on any matching task card in the current list view,
// so the list reflects a new count immediately after an action (no full re-render).
function updateCardFollowUpBadge(taskId, count){
  document.querySelectorAll(`.item-card[data-id="${taskId}"] .item-badges`).forEach(badges=>{
    const existing=badges.querySelector('.fu-card-badge');
    if(count>0){
      const label=`${emojiIcon('📣',16)} ${count} follow-up${count>1?'s':''}`;
      if(existing) existing.textContent=label;
      else { const s=document.createElement('span'); s.className='badge badge-orange fu-card-badge'; s.textContent=label; badges.appendChild(s); }
    } else if(existing){ existing.remove(); }
  });
}
function assigneeChips(t) {
  if (!t.assignedToNames?.length) return '';
  const chips=t.assignedToNames.slice(0,3).map(n=>`<span style="font-size:11px;background:var(--primary-light);color:var(--on-primary);padding:2px 8px;border-radius:10px">${escHtml(n)}</span>`).join('');
  return chips+(t.assignedToNames.length>3?`<span style="font-size:11px;color:var(--text-muted)">+${t.assignedToNames.length-3}</span>`:'');
}
function taskCard(t) {
  const inactive=DONE_STATUSES.includes(t.status)||t.status==='archived';
  return `<div class="item-card priority-${t.priority||'medium'}${inactive?' status-done':''}" data-id="${t.id}">
    <div class="item-top">
      <div class="item-title">${escHtml(t.title)}</div>
      <div class="item-badges">
        <span class="badge ${priorityBadge(t.priority)}">${t.priority||'med'}</span>
        ${window.statusBadge2 ? window.statusBadge2('task', t.status) : `<span class="badge ${statusBadge(t.status)}">${statusLabel(t.status)}</span>`}
        ${(t.openFollowUpCount||0)>0?`<span class="badge badge-orange fu-card-badge">${emojiIcon('📣',16)} ${t.openFollowUpCount} follow-up${t.openFollowUpCount>1?'s':''}</span>`:''}
      </div>
    </div>
    <div class="item-meta" style="gap:6px;flex-wrap:wrap">
      ${assigneeChips(t)}
      ${t.dueDate?`<span>${emojiIcon('📅',16)} ${t.dueDate}</span>`:''}
      ${t.department?`<span>${emojiIcon('🗂',16)} ${t.department}</span>`:''}
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
  container.innerHTML = window.skeletonHtml('rows');
  try {
    let snap = await db.collection('tasks').where('department','==',deptName).get()
      .catch(()=>({docs:[]}));
    let tasks = scopeTasksToRole(snap.docs.map(d=>normTask(d.data(),d.id)));
    // Non-dept-members only see tasks they're involved in
    if (!isAdmin) {
      tasks = tasks.filter(t=>(t.assignedTo||[]).includes(currentUser.uid)||t.createdBy===currentUser.uid);
    }
    tasks.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

    if (!tasks.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('✅',44)}</div><h4>No tasks for ${deptName}</h4></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [container] });
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
        <button class="btn-secondary btn-sm" id="dept-tasks-csv">${emojiIcon('⬇',16)} CSV</button>
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
    if (window.lucide) lucide.createIcons({ nodes: [container] });
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
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Error loading tasks</h4></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    console.error('renderDeptTasks error',e);
  }
}

// ══════════════════════════════════════════════════
//  TASKS (shared across all departments)
// ══════════════════════════════════════════════════
window.renderTasks = async function(currentUser, currentRole, currentDept) {
  const c = deptContainer();
  const isAdmin = taskOpsPriv(currentRole);   // see taskOpsPriv() — was a literal that omitted 'secretary'

  // The oversight LAYOUT (Departmental / Overdue / Near Due / My Tasks) rather
  // than the employee filter dropdown. 'secretary' joins it because the
  // Corporate Secretary's own dashboard already paints company-wide Open Tasks
  // and Overdue tiles off the unfiltered tasks collection — sending them to the
  // employee list next to those tiles is the contradiction this fixes, and the
  // Overdue chip here is the screen those tiles were pointing at all along.
  // (The read is the same full-collection get the rules already allow every
  // internal role: firestore.rules:793.)
  if (currentRole === 'president' || currentRole === 'owner' || currentRole === 'finance' || currentRole === 'secretary') {
    c.innerHTML = `
      <div class="page-header">
        <h2>${emojiIcon('✅',20)} Tasks</h2>
        <button class="btn-primary btn-sm" id="add-task-btn">+ New Task</button>
      </div>
      ${window.sopPanel('How Tasks works', [
        'Departmental groups every task by department; Overdue and Near Due surface anything with a due date at risk.',
        'My Tasks lists everything assigned to you, across departments.',
        'Open a task to change its status, add assignees, request a follow-up, or leave comments.'
      ])}
      ${window.chipTabs([
        { key:'departmental', label:'Departmental', icon:emojiIcon('📂',14) },
        { key:'overdue',      label:'Overdue',      icon:emojiIcon('🔴',14) },
        { key:'neardue',      label:'Near Due',     icon:emojiIcon('🟡',14) },
        { key:'mine',         label:'My Tasks',     icon:emojiIcon('👤',14) },
      ], 'departmental')}
      <div id="tasks-subtab-content">${window.skeletonHtml('rows')}</div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    loadPresidentTasks('departmental', currentUser, currentRole);
    window.bindChipTabs(c, (key) => loadPresidentTasks(key, currentUser, currentRole));
    document.getElementById('add-task-btn').onclick = () => openAddTaskModal(currentUser,currentRole);
    return;
  }

  const hasDept = (window.currentDepts||[]).length > 0;
  c.innerHTML = `
    <div class="page-header">
      <h2>${emojiIcon('✅',20)} Tasks</h2>
      <div class="page-actions">
        <select id="task-filter" class="select-sm">
          <option value="mine">My Tasks</option>
          ${isAdmin?'<option value="all">All Tasks</option>':''}
          ${hasDept||isAdmin?`<option value="dept">${emojiIcon('📂',16)} Dept Tasks</option>`:''}
          ${TASK_STATUSES.map(s=>`<option value="${s.value}">${s.label}</option>`).join('')}
        </select>
        <button class="btn-primary btn-sm" id="add-task-btn">+ New Task</button>
      </div>
    </div>
    ${window.sopPanel('How Tasks works', [
      'My Tasks lists everything assigned to you; use the filter to switch to dept-wide or status views.',
      'Open a task to submit it for review, leave comments, or check its follow-up requests.'
    ])}
    <div id="tasks-list" class="item-list">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadTasksList(currentUser,currentRole,currentDept);
  document.getElementById('task-filter').onchange = () => loadTasksList(currentUser,currentRole,currentDept);
  document.getElementById('add-task-btn').onclick  = () => openAddTaskModal(currentUser,currentRole);
};

async function loadPresidentTasks(sub, currentUser, currentRole) {
  const wrap = document.getElementById('tasks-subtab-content');
  if (!wrap) return;

  if (sub === 'overdue' || sub === 'neardue') {
    wrap.innerHTML = window.skeletonHtml('rows');
    const todayStr = today();
    const in3d = new Date(todayStr + 'T12:00:00Z'); in3d.setUTCDate(in3d.getUTCDate() + 3);
    const in3Str   = in3d.toISOString().slice(0, 10);
    const snap = typeof dbCachedGet==='function'
      ? await dbCachedGet('tasks-all', ()=>db.collection('tasks').get(), 30000).catch(()=>({docs:[]}))
      : await db.collection('tasks').get().catch(()=>({docs:[]}));
    let tasks = scopeTasksToRole(snap.docs.map(d=>normTask(d.data(),d.id))).filter(t=>!DONE_STATUSES.includes(t.status)&&t.status!=='archived');
    if (sub === 'overdue') {
      tasks = tasks.filter(t=>t.dueDate && t.dueDate < todayStr)
        .sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
      if (!tasks.length) { wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">${emojiIcon('✅',44)}</div><h4>No overdue tasks</h4></div>`; if (window.lucide) lucide.createIcons({ nodes: [wrap] }); return; }
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
      wrap.innerHTML = `<div style="margin-bottom:10px"><span class="badge badge-red" style="font-size:13px">${tasks.length} overdue task${tasks.length>1?'s':''}</span></div><div class="item-list">${tasks.map(t=>taskCard(t)).join('')}</div>`;
    } else {
      tasks = tasks.filter(t=>t.dueDate && t.dueDate >= todayStr && t.dueDate <= in3Str)
        .sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
      if (!tasks.length) { wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">${emojiIcon('🟡',44)}</div><h4>No tasks due in the next 3 days</h4></div>`; if (window.lucide) lucide.createIcons({ nodes: [wrap] }); return; }
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
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
      <div id="pres-mine-list" class="item-list">${window.skeletonHtml('rows')}</div>
    `;
    const renderMine = async () => {
      const list   = document.getElementById('pres-mine-list');
      const filter = document.getElementById('pres-mine-filter')?.value||'all';
      const snap   = await db.collection('tasks').where('assignedTo','array-contains',currentUser.uid).get()
        .catch(()=>db.collection('tasks').where('assignedTo','==',currentUser.uid).get());
      let tasks = scopeTasksToRole(snap.docs.map(d=>normTask(d.data(),d.id))).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      if (filter!=='all') tasks = tasks.filter(t=>t.status===filter);
      if (!tasks.length) { list.innerHTML=`<div class="empty-state"><div class="empty-icon">${emojiIcon('✅',44)}</div><h4>No tasks</h4></div>`; if (window.lucide) lucide.createIcons({ nodes: [list] }); return; }
      if (window.lucide) lucide.createIcons({ nodes: [list] });
      list.innerHTML = tasks.map(t=>taskCard(t)).join('');
      list.querySelectorAll('.item-card').forEach(card=>card.addEventListener('click',()=>openTaskDetail(card.dataset.id,currentUser,currentRole)));
    };
    renderMine();
    document.getElementById('pres-mine-filter')?.addEventListener('change',renderMine);
    return;
  }

  wrap.innerHTML = window.skeletonHtml('rows');
  try {
    const snap  = typeof dbCachedGet==='function'
      ? await dbCachedGet('tasks-all', ()=>db.collection('tasks').get(), 30000)
      : await db.collection('tasks').get();
    const tasks = scopeTasksToRole(snap.docs.map(d=>normTask(d.data(),d.id))).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    if (!tasks.length) { wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">${emojiIcon('✅',44)}</div><h4>No tasks yet</h4></div>`; if (window.lucide) lucide.createIcons({ nodes: [wrap] }); return; }
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });

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
    wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>${err.message}</h4></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
  }
}

async function loadTasksList(currentUser, currentRole, currentDept) {
  const list   = document.getElementById('tasks-list');
  const filter = document.getElementById('task-filter')?.value||'mine';
  list.innerHTML = window.skeletonHtml('rows');
  const isPriv = taskOpsPriv(currentRole);   // see taskOpsPriv() — was a literal that omitted 'secretary'

  const userDepts = window.currentDepts || [];
  let snap;
  if (filter==='mine') {
    snap = await db.collection('tasks').where('assignedTo','array-contains',currentUser.uid).get()
      .catch(()=>db.collection('tasks').where('assignedTo','==',currentUser.uid).get());
  } else if (isPriv||filter==='all') {
    snap = typeof dbCachedGet==='function'
      ? await dbCachedGet('tasks-all', ()=>db.collection('tasks').get(), 30000).catch(()=>({docs:[]}))
      : await db.collection('tasks').get().catch(()=>({docs:[]}));
  } else if (filter==='dept') {
    // Show all tasks from the user's departments
    snap = typeof dbCachedGet==='function'
      ? await dbCachedGet('tasks-all', ()=>db.collection('tasks').get(), 30000).catch(()=>({docs:[]}))
      : await db.collection('tasks').get().catch(()=>({docs:[]}));
  } else {
    // Status filter — fetch all dept tasks so employees can see overdue etc. across their dept
    snap = typeof dbCachedGet==='function'
      ? await dbCachedGet('tasks-all', ()=>db.collection('tasks').get(), 30000).catch(()=>({docs:[]}))
      : await db.collection('tasks').get().catch(()=>({docs:[]}));
  }

  let tasks = scopeTasksToRole(snap.docs.map(d=>normTask(d.data(),d.id))).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  // For non-admin: filter to dept tasks or their own tasks
  if (!isPriv && filter!=='mine') {
    tasks = tasks.filter(t=>
      userDepts.includes(t.department) ||
      (t.assignedTo||[]).includes(currentUser.uid) ||
      t.createdBy===currentUser.uid
    );
  }
  if (filter!=='mine'&&filter!=='all'&&filter!=='dept') tasks=tasks.filter(t=>t.status===filter);
  if (!tasks.length) { list.innerHTML=`<div class="empty-state"><div class="empty-icon">${emojiIcon('✅',44)}</div><h4>No tasks found</h4></div>`; if (window.lucide) lucide.createIcons({ nodes: [list] }); return; }
  if (window.lucide) lucide.createIcons({ nodes: [list] });

  // For employees in "My Tasks" view, group into active and completed sections
  // Re-audit 2026-08-03: was missing 'done' — an employee who marked their own
  // task Done still saw it filed under Active instead of Completed here.
  const COMPLETED_STATUSES = ['done','approved','archived','on-hold'];
  if (filter==='mine' && !isPriv) {
    const active    = tasks.filter(t=>!COMPLETED_STATUSES.includes(t.status));
    const completed = tasks.filter(t=>COMPLETED_STATUSES.includes(t.status));
    list.innerHTML = `
      ${active.length ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:8px">Active (${active.length})</div>
        <div class="item-list" style="margin-bottom:20px">${active.map(t=>taskCard(t)).join('')}</div>
      ` : `<div class="empty-state" style="padding:16px"><div class="empty-icon">${emojiIcon('✅',44)}</div><p>No active tasks</p></div>`}
      ${completed.length ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:8px;margin-top:8px">Completed / On Hold (${completed.length})</div>
        <div class="item-list">${completed.map(t=>taskCard(t)).join('')}</div>
      ` : ''}
    `;
    if (window.lucide) lucide.createIcons({ nodes: [list] });
  } else {
    list.innerHTML = tasks.map(t=>taskCard(t)).join('');
  }
  list.querySelectorAll('.item-card').forEach(card=>card.addEventListener('click',()=>openTaskDetail(card.dataset.id,currentUser,currentRole)));
}

// v14 Phase 2a: the task detail panel is now a real window.openPage() page (see
// openTaskDetail below) — it owns its own Overlay entry/teardown/animation, so
// there's no DOM to tear down here anymore. _activeTaskPanelEl tracks whichever
// panel element openTaskDetail last pushed, purely so this shim can tell whether
// the task page is actually the thing on top before touching the stack.
let _activeTaskPanelEl = null;
function closeTaskPanel() {
  // Kept only for the still-live external caller in app.js (navigateTo's
  // defensive "close task panel on nav" line) — do NOT remove. Safe to call
  // any time: a no-op unless the task page is currently the top of the stack.
  if (window.Overlay && window.Overlay.topEl && window.Overlay.topEl() === _activeTaskPanelEl) {
    window.Overlay.dismissTop();
  }
}
window.closeTaskPanel = closeTaskPanel;
window.openTaskDetail = openTaskDetail;

// ── Instant-window inversion (v14 smoothness pass, 2026-08-06) ───────────────
// Shared by openTaskDetail and openSubDetail below. openPage() takes a FINISHED
// html string, so the historical shape of every drill-down in this file was
// `await <read>` → build html → openPage(): between finger-up and the read
// landing, ZERO pixels changed. The press state had already released and there
// was no window in the DOM to animate, which is most of what "the clicks feel
// slow" was actually measuring. The inverted shape pushes the window
// synchronously in the tap frame with a skeleton body, then fills it when the
// read lands. Nothing about WHAT is fetched or rendered changes — only when.
//
// THE HAZARD, stated once for both: every listener must now be wired AFTER the
// fill. Pre-inversion the code could wire straight after openPage() returned,
// because the real markup was already inside the panel. It is not any more, so
// any wiring that runs before the fill binds nothing and fails silently. That
// is why the entire post-read half of each drill-down now lives in its own
// paint* function that is called only once the data is in hand.
//
// Titles are the one thing that cannot be right in the tap frame — both panels
// title themselves from the fetched doc. They open on a neutral noun ('Task' /
// 'Submission') and are retitled on fill through app.js's _setPanelTitle, so
// the icon-extraction + whitespace normalisation it does stays in exactly one
// place (it is a top-level function declaration in a classic script, therefore
// a real global; the fallback below only matters if that ever stops holding).
function setLoadedPanelTitle(panel, title) {
  const el = panel && panel.querySelector('.page-panel-title');
  if (!el) return;
  if (typeof window._setPanelTitle === 'function') { window._setPanelTitle(el, title); return; }
  el.textContent = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
}

// ── "Is this panel still worth filling?" ─────────────────────────────────────
// CLOSED-MID-FLIGHT is the one hazard the inversion actually creates: the user
// can now press Back while the read is still in the air, because there is a real
// window with a real back button from the tap frame onwards.
//
// `panel.isConnected` is the obvious test and it is NOT sufficient — measured
// in-browser against the real openPage teardown (2026-08-06, localhost:3838,
// MutationObserver on the detach so the numbers do not depend on timer
// clamping): dismissTop() → teardown/onClose at t+7ms, element actually removed
// from the DOM at t+367ms. openPage detaches on a deliberate 300ms delay
// (`setTimeout(() => { if (p.isConnected) p.remove(); }, 300)`, js/app.js) so
// the exit transition can finish. For that whole ~360ms a fully dismissed panel
// still reports isConnected === true — longer still on a throttled tab, where
// the same probe saw it attached ~1s after onClose. A read landing in that
// window sails straight past an isConnected-only guard.
//
// Nothing would be visible — the panel is mid-exit and about to be deleted —
// but it is not free either: the fill calls renderComments(), which reads the
// comments AND readers subcollections and then WRITES a read receipt
// (`readers/{uid}.readAt`, js/departments.js). Marking a task read inside a
// window the user closed before it ever painted is exactly the "must not
// resurrect a closed window" case.
//
// So every openPage call converted in this file stamps `_fillAbandoned` from
// its own onClose, which openPage guarantees to invoke on EVERY teardown path
// (real Back, replaced-away, Overlay.clearAll). isConnected is kept as a second
// line of defence for anything that removes a panel without a teardown.
function pageStillLive(panel) {
  return !!panel && panel.isConnected && !panel._fillAbandoned;
}

async function openTaskDetail(taskId, currentUser, currentRole) {
  // The window goes up FIRST, holding a skeleton. openPage() hands back the
  // panel element, and that element is what makes the deferred fill safe: the
  // painter targets THIS panel rather than "whatever page is on top" by the
  // time the read resolves (which may be a different window entirely, or none).
  //
  // onClose clears our top-of-stack bookkeeping (used by the closeTaskPanel
  // shim) whenever this panel tears down — real Back, replaced-away, or
  // Overlay.clearAll(). `panel` is assigned right below; by the time this
  // fires (always later, on teardown) the const has long since initialized.
  const panel = window.openPage('Task', window.skeletonHtml('rows'), '', {
    onClose: () => {
      panel._fillAbandoned = true;   // see pageStillLive() above
      if (_activeTaskPanelEl === panel) _activeTaskPanelEl = null;
    }
  });
  _activeTaskPanelEl = panel;   // set BEFORE the read, so closeTaskPanel()/
                                // navigateTo() can still close a still-loading panel
  const bodyEl = panel.querySelector('.page-panel-body');
  // withLoadingAndError (js/ui-states.js) owns the rest of the lifecycle: it
  // re-asserts the same skeleton (same tick as openPage, before paint — no
  // flash), awaits the read, calls the painter, and on a REJECTED read paints
  // its own error block with a Retry button it wires itself, which re-runs this
  // exact fetcher/painter pair against this same panel. That last part is why
  // the read is handed over as a fetcher instead of being awaited here: a failed
  // task read used to mean no window at all and an unhandled rejection, and an
  // open window must never be left sitting on an eternal skeleton.
  await window.withLoadingAndError(
    bodyEl,
    () => db.collection('tasks').doc(taskId).get(),
    (snap) => paintTaskDetail(panel, bodyEl, taskId, snap, currentUser, currentRole),
    { skeleton: 'rows' }
  );
}

// Everything from the read onwards, moved out of openTaskDetail verbatim — same
// markup, same handlers, same order. Only the panel/body it writes into and the
// two guards at the top are new.
function paintTaskDetail(panel, bodyEl, taskId, snap, currentUser, currentRole) {
  // CLOSED MID-FLIGHT — see pageStillLive() for why this is not just an
  // isConnected check. Filling a dismissed panel would resurrect nothing the
  // user can see, but it would still fire renderComments()'s reads and read
  // receipt, and the document.getElementById() wiring further down would bind
  // into a panel on its way out of the DOM. Bail: no throw, no zombie window.
  if (!pageStillLive(panel)) return;
  if (!snap.exists) {
    // Pre-inversion this toasted and simply never opened a window, and that is
    // still the right outcome: a deleted task has nothing to show and this panel
    // ships NO footer (openPage was called with footerHTML=''), so an in-place
    // not-found body is a full-screen window whose only affordance is the header
    // Back arrow. The window cannot be un-opened — it went up in the tap frame,
    // which is the whole point of the inversion — so it is taken back OFF
    // instead, leaving the user on the list they tapped from, exactly as before.
    //
    // Overlay.dismissTop() is the only close path that leaves no debris. It is
    // history.back() → popstate → _popOne → teardown (js/config.js), i.e. the
    // very Back press the user would otherwise have had to make themselves, so:
    // it CONSUMES the history entry openPage pushed (a tap on a deleted task
    // costs no stray Back later), it runs the real teardown — exit transition,
    // focus returned to the card that was tapped, the panel underneath revealed
    // with its scroll memo restored — and it fires our own onClose, whose only
    // two effects (mark this panel abandoned, drop the _activeTaskPanelEl
    // handle) are precisely what closing should do here. Removing the node by
    // hand would strand the Overlay entry AND its history state, which is the
    // stray-entry problem this is avoiding.
    //
    // Guarded on topEl() — the same test closeTaskPanel() above uses — because
    // dismissTop closes whatever is on TOP, not whatever we point at. If some
    // other surface pushed above us while the read was in the air, backing out
    // would close THAT one and leave this panel buried. In that (rare) case we
    // cannot leave the body empty either, since it will be revealed once the
    // surface above it closes, so it keeps a real message and is given a real
    // Close button — the same shape the other converted not-found panel uses
    // (openQuoteApprovalReview, js/screens/approvals.js).
    Notifs.showToast('Task not found','error');
    if (window.Overlay && window.Overlay.topEl() === panel) { window.Overlay.dismissTop(); return; }
    bodyEl.innerHTML = window.renderEmptyState({
      icon: '🔍', title: 'Task not found',
      hint: 'It may have been deleted since this list was loaded.'
    });
    const foot = panel.querySelector('.page-panel-foot');
    // openPage hides an empty footer; un-hide it now that it has a control.
    // closeModal() is Overlay.dismissTop(), and by the time this button is
    // reachable at all (nothing covering it) this panel is the top entry again.
    if (foot) { foot.innerHTML = `<button class="btn-secondary" onclick="closeModal()">Close</button>`; foot.classList.remove('hidden'); }
    // Panel-wide, not body-wide: withLoadingAndError's trailing sweep is scoped
    // to the container it was handed (bodyEl) and would never see that footer.
    window.lucide?.createIcons({ nodes: [panel] });
    return;
  }
  const t       = normTask(snap.data(),snap.id);
  // Task edit gating: this MUST match the Firestore tasks UPDATE rule
  // (assignee-or-isOpsAdmin() → firestore.rules:815-817, whose own comment calls
  // that clause load-bearing for the Corporate Secretary). It used to name
  // isFinanceOrAdmin(), which no longer exists — it was split into isOpsAdmin()/
  // isMoneyAdmin() on 2026-08-09 and the successor on THIS verb re-admits
  // 'secretary'. Dept membership alone still does NOT grant task edit/reassign/
  // score/follow-up (that would surface buttons the backend rejects).
  // 'owner' is legacy/unused in ROLES.
  const isAdmin = taskOpsPriv(currentRole);
  const isAssignee = t.assignedTo.includes(currentUser.uid);
  const isCreator  = t.createdBy===currentUser.uid;
  const canEdit    = isAdmin||isAssignee||isCreator;
  // Re-audit 2026-08-03: was missing 'done' — an assignee whose task was already
  // marked Done could still click Submit and re-open it into the review queue.
  const canSubmit  = isAssignee&&!['submitted','review','approved','done','on-hold','archived'].includes(t.status);
  const allowedStatuses = isAdmin?selectableTaskStatuses(TASK_STATUSES, t.status):TASK_STATUSES.filter(s=>EMP_STATUSES.includes(s.value));

  // Follow-up requests — admin asks the assignee(s) for an update; assignees (or
  // admins) mark them addressed. Wrapped in #fu-section so the panel can refresh it
  // in place after each action (no full teardown). HTML built by followUpCardInner.
  const fuFlags = { isAdmin, isAssignee, isCreator };
  const followUpSectionHtml = `<div id="fu-section">${followUpCardInner(t, fuFlags)}</div>`;

  // v14 Phase 2a — header action buttons move to openPage's opts.headerRightHTML
  // (the title slot only takes plain text; back-button + Overlay push/teardown
  // are now owned by openPage itself, so none of that is hand-rolled here).
  // NOTE for the next reader: Delete's gate below is WIDER than the boundary.
  // tasks delete is isAdmin() (firestore.rules:820) = president|manager|
  // secretary, so the 'finance' leg of isAdmin here — and `isCreator` for a
  // plain employee — still show a trash button Firestore refuses. That
  // asymmetry predates the secretary work and is left alone deliberately:
  // narrowing it changes what finance and task authors can do, which is an
  // owner call, not a role-scoping fix. The secretary IS in the rule's
  // isAdmin(), so for them this button is now correct rather than merely
  // visible.
  const headerRightHTML = `
    ${canSubmit?`<button class="btn-success btn-sm" id="submit-task-btn">${emojiIcon('📤',16)} Submit</button>`:''}
    ${canEdit?`<button class="btn-secondary btn-sm" id="edit-task-btn" aria-label="Edit task">${emojiIcon('✎',16)}</button>`:''}
    ${isAdmin||isCreator?`<button class="btn-danger btn-sm" id="del-task-btn" aria-label="Delete task">${emojiIcon('trash-2',14)}</button>`:''}
  `;

  // Priority/status/department chips used to sit under the title inside the
  // panel's own header; openPage's title slot is plain text only, so they move
  // to the top of the scrollable info section instead — same info, same markup.
  // OWNER REPORT (2026-08-08) — "description cut off mid-word" + "big empty
  // space below the composer" were ONE defect: the three properties removed
  // from this div (flex:0 0 auto / overflow-y:auto / max-height:42%) were
  // leftovers of the OLD forced split layout, which the switch to a single
  // natural scroll region (see the bodyEl.style.cssText note below, and the
  // sibling comment on the messaging section) never cleaned up.
  //   .page-panel-body is a BLOCK with overflow-y:auto, so `flex:0 0 auto` here
  //   was inert — but `max-height:42%` was NOT. Measured at 375x812: this
  //   region was pinned to 311px while its own content wanted 870px, i.e. 559px
  //   of the task hidden behind a nested scroller nobody could see was there,
  //   with the description's last line sliced 4.5px below the cut. Meanwhile the
  //   two children totalled 574.7px inside a 743px body, so 168.4px of unfilled
  //   height sat under the composer — the panel had slack and the section that
  //   wanted room was the one being capped.
  // Dropping all three makes the info region take its natural height, so
  // .page-panel-body is the single scroller (its own `overflow-y:auto`), the
  // description renders in full, and the content now exceeds the body height —
  // which is what removes the dead space rather than merely hiding it.
  // border-bottom is kept: it is the seam between the task info and Messages.
  const bodyHTML = `
    <div style="padding:16px;border-bottom:1px solid var(--border)" id="task-info-scroll">

      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
        <span class="badge ${priorityBadge(t.priority)}" style="font-size:10px">${t.priority||'medium'}</span>
        <span class="badge ${statusBadge(t.status)}" style="font-size:10px">${statusLabel(t.status)}</span>
        ${t.department?`<span class="badge badge-gray" style="font-size:10px">${emojiIcon('🗂',10)} ${t.department}</span>`:''}
      </div>

      <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap">
        ${t.assignedToNames?.length?`<span>${emojiIcon('👥',16)} <strong>${escHtml(t.assignedToNames.join(', '))}</strong></span>`:''}
        ${t.dueDate?`<span>${emojiIcon('📅',16)} Due: <strong style="color:${t.dueDate<today()?'var(--danger)':'inherit'}">${t.dueDate}</strong></span>`:''}
        ${t.createdByName?`<span>${emojiIcon('🖊',16)} By: ${escHtml(t.createdByName)}</span>`:''}
      </div>

      ${t.description?`<p style="font-size:14px;line-height:1.6;margin-bottom:12px;white-space:pre-wrap;color:var(--text)">${escHtml(t.description)}</p>`:''}

      ${Array.isArray(t.attachments)&&t.attachments.length?`
      <div style="margin-bottom:12px">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted);margin-bottom:6px">${emojiIcon('📎',16)} Attachments</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${t.attachments.map(a=>{const isLink=a&&(a.source==='link'||a.kind==='link');const url=a&&(a.url||a.driveUrl)||'';return url?`<a href="${escHtml(url)}" target="_blank" rel="noopener" class="file-chip">${isLink?`${emojiIcon('🔗',16)}`:`${emojiIcon('📎',16)}`} <span>${escHtml(a.name||(isLink?'Link':'File'))}</span></a>`:'';}).join('')}
        </div>
      </div>`:''}

      <!-- Current Standing -->
      <div style="background:rgba(255,159,10,0.08);border:1.5px solid rgba(255,159,10,0.28);border-radius:10px;padding:12px 14px;margin-bottom:12px">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:rgba(255,159,10,0.9);margin-bottom:6px">${emojiIcon('📍',16)} Current Standing</div>
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
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px">${emojiIcon('👥',16)} Add Assignee</div>
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
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--primary-light);margin-bottom:8px">${emojiIcon('🔒',16)} President Score</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="pres-score" type="number" min="1" max="10" step="0.5" value="${t.presidentScore||''}" placeholder="1–10" style="width:80px;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);color:var(--text)" inputmode="decimal"/>
          <span style="font-size:12px;color:var(--text-muted)">/ 10</span>
          <button class="btn-primary btn-sm" id="save-score-btn">Save</button>
        </div>
        ${t.presidentScore?`<div style="margin-top:6px;font-size:12px;color:var(--text-muted)">Current: <strong>${t.presidentScore}/10</strong></div>`:''}
      </div>`:''}
    </div>

    <!-- Messaging section — natural height (owner: "so much space below").
         The old flex:1 filled the whole panel, so with few messages the
         composer sat at the bottom of a tall empty region. Now it sizes to
         content and the panel body scrolls as one column. -->
    <div style="display:flex;flex-direction:column">
      <div id="task-comments-wrap" style="display:flex;flex-direction:column"></div>
    </div>
  `;

  // ── FILL — the window has been on screen since the tap ────────────────────
  // Title, header actions and body all read from the doc that just landed, so
  // all three are written here; the neutral 'Task' the panel opened with is
  // replaced by the real title now that there is one.
  setLoadedPanelTitle(panel, (t.title||''));
  const headRight = panel.querySelector('.page-panel-head-right');
  if (headRight) headRight.innerHTML = headerRightHTML;
  bodyEl.innerHTML = bodyHTML;
  // page-panel-body is styled overflow-y:auto/padded by default; the only thing
  // overridden for this panel instance is the padding, because this body's own
  // sections (#task-info-scroll, the messenger) carry their own. The scroller
  // itself is the default one — see the 2026-08-08 note on #task-info-scroll
  // above for why the old 42%-cap split layout is gone and must not come back.
  // Applied on FILL rather than at open (where it used to sit): padding:0 is
  // right for this body's own internally-padded sections, but it would have
  // pressed the loading skeleton flat against the panel edges. Nothing here
  // touches opacity, so the 140ms .page-panel-body entrance is untouched — that
  // transition is class-driven off .page-panel.open in css/styles.css, not
  // inline, so cssText cannot clobber it.
  // Single natural scroll region (info + comments + composer flow together),
  // instead of the old forced split that left a gap below short message lists.
  // display:FLEX, not the default block. With block, .page-panel-body has a
  // DEFINITE height (flex:1 in the panel column) but nothing owns the leftover,
  // so on a task with a long description and few messages ~139px of the panel
  // sat empty BELOW the composer — measured at 375x812. As a flex column the
  // comments region absorbs that slack instead (see .task-detail-body in
  // css/styles.css), while a long description still overflows and scrolls the
  // body exactly as before.
  bodyEl.classList.add('task-detail-body');
  bodyEl.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0';
  // One icon sweep for the whole panel. openPage's own sweep already ran, back
  // in the tap frame, when this panel held nothing but a skeleton. It has to
  // cover `panel` and not `bodyEl` because the header action buttons and the
  // title glyph live OUTSIDE the body, and withLoadingAndError's trailing sweep
  // is guarded on the container it was handed — it would never see them. After
  // this call that guard (`[data-lucide]:not(svg)`) finds nothing left to
  // hydrate and skips, so this is one sweep total, not two.
  window.lucide?.createIcons({ nodes: [panel] });

  renderComments('tasks',taskId,'task-comments-wrap',currentUser);

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
    Notifs.success('Standing updated!');
    window.Overlay.dismissTop(); renderTasks(currentUser, currentRole, t.department);
  });

  // Load employees for designate
  if (isAdmin) {
    dbCachedGet('users', ()=>db.collection('users').get(), 60000).then(empSnap=>{
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
    const _statusUpd={status:newStatus,lastModifiedBy:currentUser.uid,lastModifiedByName:actorName,lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp()};
    // Payroll recall spec §A3.1 — stamp/clear completedAt so month-scoped KPI
    // (window.computeKpiForMonth via taskDoneMonth) can resolve which calendar
    // month this task actually finished in, instead of only "however its
    // status stands today" (the bug that made recomputing an old payroll
    // month silently score TODAY's task state).
    if (DONE_STATUSES.includes(newStatus)) _statusUpd.completedAt=firebase.firestore.FieldValue.serverTimestamp();
    else if (DONE_STATUSES.includes(t.status)) _statusUpd.completedAt=firebase.firestore.FieldValue.delete();
    await db.collection('tasks').doc(taskId).update(_statusUpd);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    await notifyTaskInvolved(t,{title:'📋 Task Status Updated',body:`"${t.title}" → ${statusLabel(newStatus)} (${actorName})`,icon:'📋',type:'task_status',taskId},currentUser.uid);
    Notifs.success(`Status → ${statusLabel(newStatus)}`);
    window.Overlay.dismissTop(); renderTasks(currentUser,currentRole,t.department);
  });

  document.getElementById('submit-task-btn')?.addEventListener('click', async()=>{
    const uSnap=await db.collection('users').doc(currentUser.uid).get();
    const actorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
    await db.collection('tasks').doc(taskId).update({status:'review',submittedBy:currentUser.uid,submittedByName:actorName,submittedAt:firebase.firestore.FieldValue.serverTimestamp(),lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp()});
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    await notifyTaskInvolved(t,{title:'📤 Task Submitted for Review',body:`"${t.title}" submitted by ${actorName}`,icon:'📤',type:'task_submitted',taskId},currentUser.uid);
    Notifs.success('Submitted for review!');
    window.Overlay.dismissTop(); renderTasks(currentUser,currentRole,t.department);
  });

  // v14 Phase 2a — Edit now opens directly ON TOP of the task detail page
  // instead of closing it first: openPage() pushes a real stack entry (no
  // history.back() involved), so there's no dismissTop()/popstate race to dodge
  // any more (see the deleted v13 Phase 105 workaround). Back from Edit reveals
  // this task detail exactly as the user left it.
  document.getElementById('edit-task-btn')?.addEventListener('click',()=>{
    openEditTaskModal(taskId,t,currentUser,currentRole);
  });

  document.getElementById('del-task-btn')?.addEventListener('click', async()=>{
    if (!(await confirmDialog({message:'Delete this task?', danger:true}))) return;
    await db.collection('tasks').doc(taskId).delete();
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    window.Overlay.dismissTop(); renderTasks(currentUser,currentRole,t.department);
  });

  document.getElementById('designate-btn')?.addEventListener('click', async()=>{
    const sel=document.getElementById('reassign-sel');
    const newUid=sel.value; const newName=sel.options[sel.selectedIndex]?.dataset.name||'';
    const note=document.getElementById('task-instruction')?.value.trim();
    if (!newUid) { Notifs.showToast('Select an employee','error'); return; }
    const uSnap=await db.collection('users').doc(currentUser.uid).get();
    const actorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
    const update={assignedTo:[...t.assignedTo,newUid],assignedToNames:[...t.assignedToNames,newName],lastModifiedBy:currentUser.uid,lastModifiedByName:actorName,lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp()};
    // PLAIN emoji, never emojiIcon() — `description` is a STORED Firestore field
    // rendered through escHtml() (~line 705). emojiIcon() returns HTML
    // (`<i data-lucide="file-pen-line" style="width:16px;height:16px"></i>`), so
    // building the string with it persisted that markup into the document and
    // the escaped render then showed the tag to the user as literal text. See
    // the fuller note on the create path below (openAddTaskModal).
    if (note) update.description=(t.description||'')+`\n\n📝 ${actorName}: ${note}`;
    await db.collection('tasks').doc(taskId).update(update);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
    await Notifs.send(newUid,{title:'🎯 Task Assigned to You',body:`"${t.title}" assigned by ${actorName}${note?' — '+note:''}`,icon:'🎯',type:'task_designated',taskId});
    await Notifs.sendToOwner({title:'👥 Task Assignee Added',body:`${actorName} added ${newName} to "${t.title}"`,icon:'👥',type:'task_modified',taskId});
    Notifs.success(`${newName} added`);
    window.Overlay.dismissTop(); renderTasks(currentUser,currentRole,t.department);
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
      Notifs.success('Follow-up sent');
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
      Notifs.success('Marked addressed');
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
    Notifs.success('Score saved & KPI updated!');
    window.Overlay.dismissTop(); renderTasks(currentUser,currentRole,t.department);
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
  // rule (assignee-or-isOpsAdmin(), firestore.rules:815-817), so we don't render
  // an assignment dropdown the backend will reject for a non-admin dept member.
  // Same predicate as paintTaskDetail above; see taskOpsPriv().
  const isAdmin = taskOpsPriv(currentRole);
  // Window first, content second — see the inversion note above openTaskDetail.
  // Note the shape this one had: the `await` below is INSIDE `if (isAdmin)`, so
  // for a non-admin this function never suspended and already opened in the tap
  // frame. Only the admin path was paying a round trip with a dead screen.
  //
  // Hand-rolled instead of withLoadingAndError because this read cannot fail
  // into an error state: it is already `.catch()`-swallowed to an empty docs
  // list (unchanged below), so the worst case is the same form with nobody to
  // add as an assignee — never a stuck skeleton, and never an error surface
  // this code did not have before.
  //
  // The footer is static, so it ships with the panel in the tap frame — but
  // Save is born disabled. Its listener is wired at the bottom of this function,
  // i.e. after the fill, so in the gap it would otherwise be a live-looking
  // button that silently does nothing. Re-enabled the instant the form is real.
  const panel = openPage('Edit Task', window.skeletonHtml('rows'),
    `<button class="btn-primary" id="save-edit-btn" disabled>Save Changes</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`,
    { onClose: () => { panel._fillAbandoned = true; } });   // see pageStillLive()
  const bodyEl = panel.querySelector('.page-panel-body');
  // SCOPED LOOKUPS — do NOT use document.getElementById here. openPage appends
  // a NEW panel to <body> per call and keeps buried ones in the DOM
  // (.page-under), plus teardown defers removal by 300ms — so two panels can
  // carry these same ids at once and a global lookup resolves to the FIRST in
  // document order, i.e. the wrong (invisible) one. That is exactly how
  // "create task not working" happened: the enable+bind landed on a buried
  // button and the visible Create stayed disabled and dead. Reproduced.
  const $p = (id) => panel.querySelector('#' + id);
  let employees=[];
  if (isAdmin) {
    const empSnap = await dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]}));
    employees = empSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  }
  // CLOSED MID-FLIGHT — Back during the users read; filling the form would be
  // pointless and the getElementById() wiring below would bind into a panel
  // that is already on its way out. (pageStillLive, not isConnected — see there.)
  if (!pageStillLive(panel)) return;
  const deptOptions = Object.keys(window.DEPARTMENTS||{}).map(k=>`<option value="${k}"${t.department===k?' selected':''}>${k}</option>`).join('');
  const allowedStatuses = isAdmin?selectableTaskStatuses(TASK_STATUSES, t.status):TASK_STATUSES.filter(s=>EMP_STATUSES.includes(s.value));

  bodyEl.innerHTML = `
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
        ${t.assignedToNames.map((name,i)=>`<span class="badge badge-blue" style="cursor:pointer" data-uid="${t.assignedTo[i]}">${escHtml(name)} ${emojiIcon('✕',16)}</span>`).join('')}
      </div>
      <select id="et-add-assignee" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="">— Add assignee —</option>
        ${employees.filter(e=>!t.assignedTo.includes(e.id)).map(e=>`<option value="${e.id}" data-name="${escHtml(e.displayName||e.email)}">${escHtml(e.displayName||e.email)}</option>`).join('')}
      </select>
    </div>`:''}
  `;
  // Hydrates the ✕ glyphs on the assignee chips — openPage's own sweep ran in
  // the tap frame, before any of this markup existed.
  window.lucide?.createIcons({ nodes: [bodyEl] });
  const saveEditBtn = $p('save-edit-btn');
  if (saveEditBtn) saveEditBtn.disabled = false;

  let curAssignees=t.assignedTo.map((uid,i)=>({uid,name:t.assignedToNames[i]||uid}));
  $p('assignee-chips')?.querySelectorAll('.badge').forEach(chip=>{
    chip.addEventListener('click',()=>{ curAssignees=curAssignees.filter(a=>a.uid!==chip.dataset.uid); chip.remove(); });
  });
  $p('et-add-assignee')?.addEventListener('change',e=>{
    const uid=e.target.value; const name=e.target.options[e.target.selectedIndex]?.dataset.name||'';
    if (!uid||curAssignees.some(a=>a.uid===uid)){e.target.value='';return;}
    curAssignees.push({uid,name});
    const chips=$p('assignee-chips');
    const chip=document.createElement('span'); chip.className='badge badge-blue'; chip.style.cursor='pointer'; chip.dataset.uid=uid;
    chip.textContent=`${name} ✕`;
    chip.addEventListener('click',()=>{ curAssignees=curAssignees.filter(a=>a.uid!==uid); chip.remove(); });
    chips?.appendChild(chip); e.target.value='';
  });

  $p('save-edit-btn').addEventListener('click', async()=>{
    const title=$p('et-title').value.trim();
    if (!title){Notifs.showToast('Title required','error');return;}
    const uSnap=await db.collection('users').doc(currentUser.uid).get();
    const actorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
    const update={
      title,
      description:$p('et-desc').value.trim(),
      priority:$p('et-priority').value,
      dueDate:$p('et-due').value,
      status:$p('et-status').value,
      department:$p('et-dept').value,
      lastModifiedBy:currentUser.uid,lastModifiedByName:actorName,
      lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp()
    };
    if (isAdmin){update.assignedTo=curAssignees.map(a=>a.uid);update.assignedToNames=curAssignees.map(a=>a.name);}
    // Payroll recall spec §A3.1 — same completedAt stamp/clear rule as the
    // status-select handler above; this edit path can also move a task
    // across the DONE_STATUSES boundary via the Status dropdown.
    if (DONE_STATUSES.includes(update.status)) update.completedAt=firebase.firestore.FieldValue.serverTimestamp();
    else if (DONE_STATUSES.includes(t.status)) update.completedAt=firebase.firestore.FieldValue.delete();
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
    Notifs.success('Task updated!');
    // v14 Phase 2a — this page now opens ON TOP of the task detail page (which
    // is no longer closed before Edit opens), so a single closeModal() would
    // only pop Edit and reveal the now-stale task detail underneath. The
    // pre-stack behavior was "Save exits all the way back to the board,
    // refreshed" — preserve that intended refresh with clearAll() (tears down
    // both stacked pages via their teardowns, one history.go, no dismissTop()
    // race) instead of teaching task detail how to refresh itself in place.
    window.Overlay.clearAll(); renderTasks(currentUser,currentRole,update.department||t.department);
  });
}

async function openAddTaskModal(currentUser, currentRole, defaultDept) {
  // Window first, content second — see the inversion note above openTaskDetail.
  // Same reasoning as openEditTaskModal: hand-rolled because the users read is
  // already `.catch()`-swallowed to an empty docs list and so cannot fail into
  // an error state, and Create ships disabled because its listener is wired
  // after the fill. Unlike Edit, this one suspended on EVERY open (no isAdmin
  // branch), so "+ New Task" was a dead tap on any cold `users` cache.
  const panel = openPage('New Task', window.skeletonHtml('rows'),
    `<button class="btn-primary" id="create-task-btn" disabled>Create Task</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`,
    { onClose: () => { panel._fillAbandoned = true; } });   // see pageStillLive()
  const bodyEl = panel.querySelector('.page-panel-body');
  // SCOPED LOOKUPS — do NOT use document.getElementById here. openPage appends
  // a NEW panel to <body> per call and keeps buried ones in the DOM
  // (.page-under), plus teardown defers removal by 300ms — so two panels can
  // carry these same ids at once and a global lookup resolves to the FIRST in
  // document order, i.e. the wrong (invisible) one. That is exactly how
  // "create task not working" happened: the enable+bind landed on a buried
  // button and the visible Create stayed disabled and dead. Reproduced.
  const $p = (id) => panel.querySelector('#' + id);
  const empSnap  = await dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]}));
  // CLOSED MID-FLIGHT — bail before touching a dead panel, and before
  // Drive.renderUploadArea() below mounts an uploader into nothing.
  if (!pageStillLive(panel)) return;
  const employees= empSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const deptOptions = Object.keys(window.DEPARTMENTS||{}).map(k=>`<option value="${k}"${k===defaultDept?' selected':''}>${k}</option>`).join('');

  bodyEl.innerHTML = `
    <div class="form-group"><label>Title</label><input id="t-title" placeholder="Task name"/></div>
    <div class="form-group"><label>Description</label><textarea id="t-desc" rows="3" placeholder="Details…"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Priority</label>
        <select id="t-priority">
          <option value="low">${emojiIcon('🟢',16)} Low</option><option value="medium" selected>${emojiIcon('🟡',16)} Medium</option>
          <option value="high">${emojiIcon('🔴',16)} High</option><option value="urgent">${emojiIcon('🚨',16)} Urgent</option>
        </select>
      </div>
      <div class="form-group"><label>Status</label>
        <select id="t-status">
          ${selectableTaskStatuses(TASK_STATUSES).map(s=>`<option value="${s.value}"${s.value==='backlog'?' selected':''}>${s.label}</option>`).join('')}
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
  `;
  // Hydrates the priority/📎 glyphs — openPage's own sweep ran in the tap frame,
  // before any of this markup existed.
  window.lucide?.createIcons({ nodes: [bodyEl] });
  const createTaskBtn = $p('create-task-btn');
  if (createTaskBtn) createTaskBtn.disabled = false;

  let taskAttachments=[];
  Drive.renderUploadArea('task-attach-area',r=>{taskAttachments.push(r);},{label:`${emojiIcon('📎',16)} Attach file or link`,dept:'tasks',subfolder:'attachments'});

  let newAssignees=[];
  $p('t-assignee-sel').addEventListener('change',e=>{
    const uid=e.target.value; const name=e.target.options[e.target.selectedIndex]?.dataset.name||'';
    if (!uid||newAssignees.some(a=>a.uid===uid)){e.target.value='';return;}
    newAssignees.push({uid,name});
    const chips=$p('new-assignee-chips');
    const chip=document.createElement('span'); chip.className='badge badge-blue'; chip.style.cursor='pointer';
    chip.textContent=`${name} ✕`;
    chip.addEventListener('click',()=>{ newAssignees=newAssignees.filter(a=>a.uid!==uid); chip.remove(); });
    chips.appendChild(chip); e.target.value='';
  });

  $p('create-task-btn').addEventListener('click', async()=>{
    const title=$p('t-title').value.trim();
    if (!title){Notifs.showToast('Enter a task title','error');return;}
    // Re-audit 2026-08-03: an empty Department silently dropped the task into an
    // invisible "Unassigned" bucket — never matched by a Manager Dashboard's
    // depts.includes(t.department) scoping, excluded from renderDeptTasks
    // entirely — even though it may still have named assignees.
    if (!$p('t-dept').value){Notifs.showToast('Select a department','error');return;}
    const uSnap=await db.collection('users').doc(currentUser.uid).get();
    const creatorName=uSnap.exists?uSnap.data().displayName:currentUser.email;
    const desc=$p('t-desc').value.trim();
    const notes=$p('t-notes').value.trim();
    const taskRef = await db.collection('tasks').add({
      // ── VISIBLE-CODE DEFECT, owner screenshot 2026-08-08 ────────────────────
      // This line is the generator. It used to read
      //   `${desc}\n\n${emojiIcon('📝',16)} Instructions: ${notes}`
      // and `description` is not a render string — it is a STORED Firestore
      // field on the task document. emojiIcon() (js/config.js) returns HTML, so
      // every task created through this modal with an Instructions note had
      //   <i data-lucide="file-pen-line" style="width:16px;height:16px"></i>
      // written into its description, verbatim, in the database. The detail
      // panel renders the field with escHtml() — which is CORRECT for user
      // content and must stay — so the stored tag was escaped and displayed to
      // the user as literal text ("<i data-lucide=... Instructions: ...").
      // The owner's "Organize CRM List" screenshot is that exact string.
      // PLAIN emoji here, per the house rule: emojiIcon() output may only ever
      // reach an innerHTML sink, never a stored field or an escaped/textContent
      // one. This stops NEW pollution only — rows already written keep the
      // markup until a one-off backfill rewrites them.
      title, description:notes?`${desc}\n\n📝 Instructions: ${notes}`:desc,
      priority:$p('t-priority').value,
      status:$p('t-status').value,
      dueDate:$p('t-due').value,
      department:$p('t-dept').value,
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
    closeModal(); Notifs.success('Task created!');
    renderTasks(currentUser,currentRole,$p('t-dept')?.value||'');
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
    <div id="subs-list" class="item-list">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadSubsList(currentUser, currentRole, currentDept);
  document.getElementById('add-sub-btn').onclick = () => openAddSubModal(currentUser);
};

async function loadSubsList(currentUser, currentRole, currentDept) {
  const list = document.getElementById('subs-list');
  const isPrivileged = taskOpsPriv(currentRole);
  const snap = isPrivileged
    ? await db.collection('submissions').get().catch(()=>({docs:[]}))
    : await db.collection('submissions').where('createdBy','==',currentUser.uid).get().catch(()=>({docs:[]}));

  const subs = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  if (!subs.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('📋',44)}</div><h4>No submissions yet</h4></div>`; return; }
  if (window.lucide) lucide.createIcons({ nodes: [list] });

  list.innerHTML = subs.map(s => `
    <div class="item-card" data-id="${s.id}">
      <div class="item-top">
        <div class="item-title">${escHtml(s.title)}</div>
        <span class="badge ${statusBadge(s.status)}">${s.status||'pending'}</span>
      </div>
      <div class="item-meta">
        <span class="badge badge-gray">${escHtml(s.type||'General')}</span>
        ${s.submittedByName?`<span>${emojiIcon('👤',16)} ${escHtml(s.submittedByName)}</span>`:''}
        ${s.createdAt?`<span>${emojiIcon('📅',16)} ${new Date(s.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
      </div>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons({ nodes: [list] });
  list.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => openSubDetail(card.dataset.id, currentUser, currentRole));
  });
}

async function openSubDetail(subId, currentUser, currentRole) {
  // Window first, content second — see the inversion note above openTaskDetail.
  // The footer is static (a Close button on the shared inline closeModal()), so
  // it ships in the tap frame and works immediately, skeleton or not.
  const panel = openPage('Submission', window.skeletonHtml('rows'),
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`,
    { onClose: () => { panel._fillAbandoned = true; } });   // see pageStillLive()
  const bodyEl = panel.querySelector('.page-panel-body');
  // withLoadingAndError here (unlike the two task forms) because this read is
  // NOT error-swallowed: it had no .catch() at all, so a failure used to mean
  // no window plus an unhandled rejection. Now it means a visible error state
  // with a working Retry, inside the window that is already open.
  await window.withLoadingAndError(
    bodyEl,
    () => db.collection('submissions').doc(subId).get(),
    (snap) => paintSubDetail(panel, bodyEl, subId, snap, currentUser, currentRole),
    { skeleton: 'rows' }
  );
}

// Everything from the read onwards, moved out of openSubDetail verbatim.
// Deliberately NOT given a `!snap.exists` branch: this flow never had one (a
// missing doc spreads to `{id}` and renders the "No details." body), and the
// brief was to change when the window appears, not what it renders.
function paintSubDetail(panel, bodyEl, subId, snap, currentUser, currentRole) {
  // CLOSED MID-FLIGHT — see pageStillLive(); same reasoning, same bail.
  if (!pageStillLive(panel)) return;
  const s = {id:snap.id,...snap.data()};
  const isPrivileged = taskOpsPriv(currentRole);

  setLoadedPanelTitle(panel, (s.title||''));
  bodyEl.innerHTML = `
    <div style="margin-bottom:10px">
      <span class="badge ${statusBadge(s.status)}">${s.status||'pending'}</span>
      <span class="badge badge-gray" style="margin-left:6px">${escHtml(s.type||'General')}</span>
    </div>
    <p style="font-size:14px;line-height:1.6;margin-bottom:12px">${escHtml(s.description||'No details.')}</p>
    ${s.fileUrl?`<a href="${escHtml(s.fileUrl)}" target="_blank" rel="noopener" class="btn-secondary" style="display:inline-flex;gap:6px;margin-bottom:14px">${s.fileSource==='link'?`${emojiIcon('🔗',16)}`:`${emojiIcon('📎',16)}`} ${escHtml(s.fileName||(s.fileSource==='link'?'Open Link':'View Attachment'))}</a>`:''}
    ${isPrivileged?`<div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn-success" id="approve-btn" data-id="${s.id}">${emojiIcon('✅',16)} Approve</button>
      <button class="btn-danger" id="reject-btn" data-id="${s.id}">${emojiIcon('❌',16)} Reject</button>
    </div>`:''}
    <hr class="divider"/>
    <div id="sub-comments-wrap"></div>
  `;
  // Body icons only — this panel has no header actions and its title carries no
  // glyph, so withLoadingAndError's own trailing sweep would in fact have caught
  // everything here. Kept explicit so the fill does not depend on that wrapper
  // detail, matching paintTaskDetail.
  window.lucide?.createIcons({ nodes: [bodyEl] });

  renderComments('submissions', subId, 'sub-comments-wrap', currentUser);
  document.getElementById('approve-btn')?.addEventListener('click', async e => {
    await db.collection('submissions').doc(e.currentTarget.dataset.id).update({status:'approved'});
    if (s.createdBy) await Notifs.send(s.createdBy, {title:'✅ Submission Approved',body:`"${s.title}" was approved.`,icon:'✅',type:'submission_reviewed',link:'submissions'});
    closeModal(); renderSubmissions(currentUser, currentRole, '');
  });
  document.getElementById('reject-btn')?.addEventListener('click', async e => {
    await db.collection('submissions').doc(e.currentTarget.dataset.id).update({status:'rejected'});
    if (s.createdBy) await Notifs.send(s.createdBy, {title:'❌ Submission Rejected',body:`"${s.title}" was rejected.`,icon:'❌',type:'submission_reviewed',link:'submissions'});
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
    await Notifs.sendToOwner({ title:'📋 New Submission', body:`${name} submitted: "${document.getElementById('s-title').value.trim()}"`, icon:'📋', type:'submission_new', link:'submissions' });
    closeModal();
    Notifs.success('Submission sent!');
    renderSubmissions(currentUser, window.currentRole || '', (window.currentDepts||[])[0] || '');
  });
}
