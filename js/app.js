/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Core App
   app.js — Auth, Navigation, Dashboard, Profile, ID Card
═══════════════════════════════════════════════════ */

'use strict';

// ── State ──────────────────────────────────────────
let currentUser   = null;
let currentRole   = null;
let currentDept   = null;
let currentPage   = 'dashboard';
let userProfile   = {};

// ── Boot ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  Notifs.initToggle();

  auth.onAuthStateChanged(async user => {
    if (user) {
      currentUser = user;
      await loadUserProfile(user);
      showApp();
      Notifs.startListener(user.uid);
      Notifs.initPush(user.uid);
      Notifs.checkDeadlines(user.uid);
      buildNav();
      navigateTo('dashboard');
    } else {
      showLogin();
    }
  });
});

// ── Screens ───────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('active');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('active');
}

// ── User Profile ──────────────────────────────────
async function loadUserProfile(user) {
  try {
    let snap = await db.collection('users').doc(user.uid).get();
    if (!snap.exists) {
      const empCount = (await db.collection('users').get()).size;
      const empId    = `BI-${new Date().getFullYear()}-${String(empCount+1).padStart(3,'0')}`;
      const profile  = {
        uid:         user.uid,
        email:       user.email,
        displayName: user.displayName || user.email.split('@')[0],
        role:        'employee',
        department:  '',
        title:       '',
        employeeId:  empId,
        salary:      0, allowance: 0, deductions: 0,
        photoUrl:    '',
        startDate:   new Date().toISOString().slice(0,10),
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection('users').doc(user.uid).set(profile);
      snap = await db.collection('users').doc(user.uid).get();
    }
    userProfile = { id: snap.id, ...snap.data() };
    currentRole = userProfile.role || 'employee';
    currentDept = userProfile.department || '';
    applyUserUI();
  } catch(err) {
    console.error('Profile load error:', err);
    currentRole = 'employee';
    userProfile = { displayName: user.email, role: 'employee', department: '', email: user.email };
    applyUserUI();
  }
}

function applyUserUI() {
  const initial = (userProfile.displayName||'?')[0].toUpperCase();
  const roleName = ROLES[currentRole]?.label || currentRole;

  // Topbar
  const ta = document.getElementById('topbar-avatar');
  if (ta) {
    if (userProfile.photoUrl) {
      ta.innerHTML = `<img src="${userProfile.photoUrl}" style="width:34px;height:34px;border-radius:50%;object-fit:cover"/>`;
    } else { ta.textContent = initial; }
    ta.onclick = openProfileDrawer;
  }

  // Sidebar
  const sa = document.getElementById('sidebar-avatar');
  if (sa) {
    if (userProfile.photoUrl) { sa.innerHTML = `<img src="${userProfile.photoUrl}"/>`; }
    else { sa.textContent = initial; }
  }
  const sn = document.getElementById('sidebar-user-name');
  if (sn) sn.textContent = userProfile.displayName || userProfile.email;
  const sr = document.getElementById('sidebar-user-role');
  if (sr) sr.textContent = roleName;
  const sd = document.getElementById('sidebar-user-dept');
  if (sd) sd.textContent = currentDept || '';
}

// ── Login ─────────────────────────────────────────
function initLogin() {
  const form = document.getElementById('login-form');
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    setLoginLoading(true);
    clearLoginError();
    try {
      await auth.signInWithEmailAndPassword(
        document.getElementById('email').value.trim(),
        document.getElementById('password').value
      );
    } catch(err) {
      showLoginError(friendlyError(err.code));
      setLoginLoading(false);
    }
  });

  document.getElementById('forgot-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    if (!email) { showLoginError('Enter your email address first.'); return; }
    try {
      await auth.sendPasswordResetEmail(email);
      document.getElementById('reset-sent').classList.remove('hidden');
    } catch(err) { showLoginError(friendlyError(err.code)); }
  });

  // Password toggle
  document.getElementById('pw-toggle')?.addEventListener('click', () => {
    const pw = document.getElementById('password');
    pw.type = pw.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('logout-btn')?.addEventListener('click', () => {
    Notifs.stopListener();
    auth.signOut();
  });

  document.getElementById('sidebar-profile-btn')?.addEventListener('click', openProfileDrawer);
}

function setLoginLoading(on) {
  document.getElementById('login-btn-text').textContent = on ? 'Signing in…' : 'Sign In';
  document.getElementById('login-spinner').classList.toggle('hidden', !on);
  document.getElementById('login-btn').disabled = on;
}
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; el.classList.remove('hidden');
}
function clearLoginError() {
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('reset-sent')?.classList.add('hidden');
}
function friendlyError(code) {
  return { 'auth/user-not-found':'No account with that email.','auth/wrong-password':'Incorrect password.','auth/invalid-email':'Invalid email.','auth/too-many-requests':'Too many attempts. Try later.','auth/invalid-credential':'Invalid email or password.' }[code] || 'Sign-in failed.';
}

// ── Navigation ────────────────────────────────────
function buildNav() {
  buildSidebarNav();
  buildBottomNav();
}

function getSidebarItems() {
  const isOwner   = currentRole === 'owner';
  const isManager = currentRole === 'manager';
  const dept      = currentDept;

  const items = [];

  // Always visible
  items.push({ icon:'🏠', label:'Dashboard', page:'dashboard' });
  items.push({ icon:'🏢', label:'Company', page:'company' });
  items.push({ icon:'✅', label:'Tasks', page:'tasks' });
  items.push({ icon:'📋', label:'Submissions', page:'submissions' });

  // Cash (not for Brilliant Steel)
  if (dept !== 'Brilliant Steel') {
    items.push({ icon:'💸', label:'Cash & Expenses', page:'cash' });
  }

  // Department tab
  if (dept) {
    const deptConfig = DEPARTMENTS[dept];
    if (deptConfig) {
      items.push({ icon: deptConfig.icon, label: dept, page: 'my-dept', section: true });
    }
  }

  // Owner/Manager extra
  if (isOwner || isManager) {
    items.push({ icon:'🗂️', label:'Departments', page:'departments', section: isOwner });
    items.push({ icon:'📈', label:'Analytics', page:'analytics', section: isOwner });
    items.push({ icon:'✔️', label:'Approvals', page:'approvals', section: isOwner });
    items.push({ icon:'👥', label:'Team / Payroll', page:'team', section: isOwner });
  }

  return items;
}

function buildSidebarNav() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  const items = getSidebarItems();
  nav.innerHTML = items.map(item =>
    `${item.section ? '<div class="nav-section-label">Management</div>' : ''}
     <button class="nav-item" data-page="${item.page}">
       <span class="nav-icon">${item.icon}</span>${item.label}
     </button>`
  ).join('');

  nav.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.page);
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay')?.classList.add('hidden');
    });
  });
}

function buildBottomNav() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const items = currentRole === 'owner' ? window.OWNER_BOTTOM_NAV : window.BOTTOM_NAV_ITEMS;
  nav.innerHTML = items.map(item =>
    `<button class="bottom-nav-item" data-page="${item.page}">
       <span class="bn-icon">${item.icon}</span>
       <span class="bn-label">${item.label}</span>
     </button>`
  ).join('');
  nav.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

// Mobile sidebar toggle
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay')?.classList.toggle('hidden');
  });
  document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.add('hidden');
  });
});

// ── Navigate ──────────────────────────────────────
function navigateTo(page) {
  currentPage = page;
  setActiveNav(page);

  const c = document.getElementById('page-content');
  c.innerHTML = '<div class="loading-placeholder">Loading…</div>';

  switch(page) {
    case 'dashboard':    renderDashboard(); break;
    case 'company':      renderCompany(); break;
    case 'tasks':        renderTasks(currentUser, currentRole, currentDept); break;
    case 'submissions':  renderSubmissions(currentUser, currentRole, currentDept); break;
    case 'cash':         renderCash(currentUser, currentRole); break;
    case 'my-dept':      renderMyDepartment(); break;
    case 'departments':  renderDepartments(); break;
    case 'analytics':    renderAnalytics(); break;
    case 'approvals':    renderApprovals(currentUser); break;
    case 'team':         renderTeam(); break;
    default: c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><h4>Page not found</h4></div>`;
  }
}

function setActiveNav(page) {
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

// ── DASHBOARD ─────────────────────────────────────
async function renderDashboard() {
  if (currentRole === 'owner' || currentRole === 'manager') {
    await renderOwnerDashboard();
  } else {
    await renderEmployeeDashboard();
  }
}

async function renderOwnerDashboard() {
  const c = document.getElementById('page-content');
  c.innerHTML = '<div class="loading-placeholder">Loading dashboard…</div>';
  try {
    const [usersSnap, tasksSnap, subsSnap, quotesSnap, approvalsSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('tasks').get(),
      db.collection('submissions').get(),
      db.collection('quotes').get(),
      db.collection('approval_requests').where('status','==','pending').get()
    ]);
    const users     = usersSnap.docs.map(d => d.data());
    const tasks     = tasksSnap.docs.map(d => d.data());
    const openTasks = tasks.filter(t => t.status !== 'done').length;
    const doneTasks = tasks.filter(t => t.status === 'done').length;
    const pendingSubs = subsSnap.docs.filter(d => d.data().status === 'pending').length;
    const totalQuotes = quotesSnap.docs.reduce((s,d) => s + (d.data().total||0), 0);
    const pendingApprovals = approvalsSnap.size;

    c.innerHTML = `
      <div class="page-header">
        <h2>👋 Welcome, ${(userProfile.displayName||'').split(' ')[0]}!</h2>
        <span class="text-muted">${new Date().toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</span>
      </div>

      <div class="kpi-row">
        <div class="kpi-card">
          <div class="kpi-label">Team Members</div>
          <div class="kpi-value">${users.length}</div>
          <div class="kpi-sub">Active users</div>
        </div>
        <div class="kpi-card accent">
          <div class="kpi-label">Open Tasks</div>
          <div class="kpi-value">${openTasks}</div>
          <div class="kpi-sub">${doneTasks} done</div>
        </div>
        <div class="kpi-card warn">
          <div class="kpi-label">Pending Submissions</div>
          <div class="kpi-value">${pendingSubs}</div>
          <div class="kpi-sub">Awaiting review</div>
        </div>
        <div class="kpi-card green">
          <div class="kpi-label">Quote Pipeline</div>
          <div class="kpi-value">₱${formatNum(totalQuotes)}</div>
          <div class="kpi-sub">${quotesSnap.size} quotes</div>
        </div>
        ${pendingApprovals>0?`<div class="kpi-card red"><div class="kpi-label">Pending Approvals</div><div class="kpi-value">${pendingApprovals}</div><div class="kpi-sub">Needs your review</div></div>`:''}
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header"><h3>Task Overview</h3></div>
          <div class="card-body"><div class="chart-wrap"><canvas id="task-chart"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>📅 ${new Date().toLocaleString('default',{month:'long',year:'numeric'})}</h3></div>
          <div class="card-body" id="mini-cal"></div>
        </div>
      </div>

      ${pendingApprovals>0?`
        <div class="card">
          <div class="card-header" style="background:#fff3e0">
            <h3>⚠️ ${pendingApprovals} Pending Approval${pendingApprovals>1?'s':''}</h3>
            <button class="btn-primary btn-sm" onclick="navigateTo('approvals')">Review</button>
          </div>
        </div>`:''}
    `;

    renderMiniCal();
    new Chart(document.getElementById('task-chart'), {
      type:'doughnut', data: { labels:['Open','Done'], datasets:[{data:[openTasks||0,doneTasks||0],backgroundColor:['#3949ab','#43a047'],borderWidth:2}] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} }
    });
  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>Error loading dashboard</h4><p>${err.message}</p></div>`;
  }
}

async function renderEmployeeDashboard() {
  const c = document.getElementById('page-content');
  c.innerHTML = '<div class="loading-placeholder">Loading…</div>';
  try {
    const [myTasksSnap] = await Promise.all([
      db.collection('tasks').where('assignedTo','==',currentUser.uid).get()
    ]);
    const myTasks  = myTasksSnap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const openTasks = myTasks.filter(t => t.status!=='done').length;
    const u = userProfile;
    const net = (u.salary||0) + (u.allowance||0) - (u.deductions||0);

    c.innerHTML = `
      <div class="page-header">
        <h2>👋 Hi, ${(u.displayName||'').split(' ')[0]}!</h2>
      </div>

      <!-- Employee ID Card -->
      <div id="emp-id-card-wrap" style="margin-bottom:20px"></div>

      <div class="kpi-row">
        <div class="kpi-card green"><div class="kpi-label">Net Pay</div><div class="kpi-value">₱${formatNum(net)}</div><div class="kpi-sub">This month</div></div>
        <div class="kpi-card accent"><div class="kpi-label">My Open Tasks</div><div class="kpi-value">${openTasks}</div><div class="kpi-sub">${myTasks.length-openTasks} done</div></div>
        <div class="kpi-card"><div class="kpi-label">Department</div><div class="kpi-value" style="font-size:15px">${u.department||'Unassigned'}</div></div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header"><h3>My Tasks</h3><button class="btn-primary btn-sm" onclick="navigateTo('tasks')">View All</button></div>
          <div class="card-body">
            ${myTasks.length===0
              ? '<div class="empty-state" style="padding:20px"><div class="empty-icon">✅</div><p>No tasks assigned</p></div>'
              : myTasks.slice(0,5).map(t => `
                <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
                  <span style="font-size:18px">${t.status==='done'?'✅':'🔵'}</span>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.title}</div>
                    ${t.dueDate?`<div style="font-size:11px;color:var(--text-muted)">Due: ${t.dueDate}</div>`:''}
                  </div>
                  <span class="badge ${t.status==='done'?'badge-green':'badge-blue'}">${t.status||'open'}</span>
                </div>`).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>📅 Calendar</h3></div>
          <div class="card-body" id="mini-cal"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>💰 Salary Breakdown</h3></div>
        <div class="card-body">
          <table class="data-table">
            <tr><td>Base Salary</td><td><strong>₱${formatNum(u.salary)}</strong></td></tr>
            <tr><td>Allowances</td><td style="color:var(--success)">+₱${formatNum(u.allowance)}</td></tr>
            <tr><td>Deductions</td><td style="color:var(--danger)">-₱${formatNum(u.deductions)}</td></tr>
            <tr style="background:var(--surface2)"><td><strong>Net Pay</strong></td><td><strong style="font-size:16px">₱${formatNum(net)}</strong></td></tr>
          </table>
        </div>
      </div>
    `;

    renderIDCard('emp-id-card-wrap', u);
    renderMiniCal();
  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>${err.message}</h4></div>`;
  }
}

// ── Employee ID Card ──────────────────────────────
function renderIDCard(containerId, u) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div class="id-card">
        <div class="id-card-top">
          <img src="icons/barro-logo.png" alt="BI" class="id-card-logo" onerror="this.style.display='none'"/>
          <div>
            <div class="id-card-company">BARRO INDUSTRIES</div>
            <div class="id-card-company-sub">EMPLOYEE IDENTIFICATION</div>
          </div>
        </div>
        <div class="id-card-body">
          <div class="id-card-photo" id="id-card-photo-btn" title="Click to upload photo">
            ${u.photoUrl
              ? `<img src="${u.photoUrl}" alt="Photo"/>`
              : `<span style="font-size:32px">👤</span>`}
            <div class="id-card-photo-hint">📷 Change</div>
          </div>
          <div class="id-card-info">
            <div class="id-card-name">${u.displayName||u.email}</div>
            <div class="id-card-title">${u.title||u.role||'Employee'}</div>
            <div class="id-card-detail"><span>🗂</span><strong>${u.department||'—'}</strong></div>
            <div class="id-card-detail"><span>✉️</span>${u.email}</div>
            ${u.startDate?`<div class="id-card-detail"><span>📅</span>Since ${u.startDate}</div>`:''}
          </div>
        </div>
        <div class="id-card-footer">
          <div class="id-card-id">${u.employeeId||'BI-0000'}</div>
          <div class="id-card-status">ACTIVE</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('id-card-photo-btn')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      Notifs.showToast('Uploading photo…');
      try {
        const url = await Drive.uploadProfilePhoto(file, currentUser.uid);
        await db.collection('users').doc(currentUser.uid).update({ photoUrl: url });
        userProfile.photoUrl = url;
        applyUserUI();
        renderIDCard(containerId, { ...u, photoUrl: url });
        Notifs.showToast('Photo updated!');
      } catch(err) { Notifs.showToast('Upload failed: ' + err.message, 'error'); }
    };
    input.click();
  });
}

// ── My Department ─────────────────────────────────
function renderMyDepartment() {
  if (!currentDept) {
    document.getElementById('page-content').innerHTML = `
      <div class="access-denied">
        <div class="ad-icon">🗂️</div>
        <h3>No Department Assigned</h3>
        <p>You haven't been assigned to a department yet. Contact the owner to set your department.</p>
      </div>`;
    return;
  }

  switch(currentDept) {
    case 'Marketing':                 renderMarketing(currentUser, currentRole); break;
    case 'Finance':                   renderFinance(currentUser, currentRole); break;
    case 'Sales and Client Relations':renderSales(currentUser, currentRole); break;
    case 'Design':                    renderDesign(currentUser, currentRole); break;
    case 'Brilliant Steel':           renderBrilliantSteel(currentUser, currentRole); break;
    case 'Government Biddings':       renderGovBiddings(); break;
    default:                          renderGenericDept(currentDept); break;
  }
}

function renderGovBiddings() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header"><h2>🏛️ Government Biddings</h2></div>
    <div class="subtab-bar">
      <button class="subtab-btn active" data-sub="PhilGEPS">PhilGEPS</button>
      <button class="subtab-btn" data-sub="Active Bids">Active Bids</button>
      <button class="subtab-btn" data-sub="Archive">Archive</button>
    </div>
    <div id="gov-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  const loadGov = (sub) => {
    renderDocCollection(document.getElementById('gov-content'), `gov_${sub.toLowerCase().replace(/\s+/g,'_')}`, sub, currentUser, currentRole, {icon:'🏛️'});
  };
  loadGov('PhilGEPS');
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => { c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); loadGov(btn.dataset.sub); });
  });
}

function renderGenericDept(dept) {
  const deptConfig = DEPARTMENTS[dept];
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header"><h2>${deptConfig?.icon||'🗂️'} ${dept}</h2></div>
    <div class="card">
      <div class="card-body">
        <div class="empty-state"><div class="empty-icon">${deptConfig?.icon||'🗂️'}</div><h4>${dept} Department</h4><p>Department module coming soon.</p></div>
      </div>
    </div>
  `;
}

// ── Company (Policies) ────────────────────────────
async function renderCompany() {
  const c = document.getElementById('page-content');
  const canAdd = currentRole === 'owner';
  c.innerHTML = `
    <div class="page-header">
      <h2>🏢 Company</h2>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-policy-btn">+ Add Policy</button>`:''}
    </div>
    <div class="policy-grid" id="policy-grid"><div class="loading-placeholder">Loading…</div></div>
  `;

  const snap = await db.collection('policies').orderBy('createdAt','desc').get();
  const policies = snap.docs.map(d => ({id:d.id,...d.data()}));
  const grid = document.getElementById('policy-grid');

  if (!policies.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📄</div><h4>No policies yet</h4></div>`;
  } else {
    grid.innerHTML = policies.map(p => `
      <div class="policy-card" data-id="${p.id}">
        <div class="policy-icon">${p.icon||'📄'}</div>
        <div class="policy-title">${p.title}</div>
        <div class="policy-desc">${p.description||''}</div>
        ${p.fileUrl?`<a href="${p.fileUrl}" target="_blank" class="btn-link" style="font-size:12px;margin-top:6px;display:block">📎 View Document</a>`:''}
      </div>`).join('');
    grid.querySelectorAll('.policy-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.tagName==='A') return;
        const p = policies.find(x => x.id === card.dataset.id);
        openModal(p.title, `
          <p style="font-size:14px;line-height:1.7;white-space:pre-wrap">${p.content||'No content.'}</p>
          ${p.fileUrl?`<a href="${p.fileUrl}" target="_blank" class="btn-secondary" style="display:inline-block;margin-top:14px">📎 Open File</a>`:''}
          ${canAdd?`<hr class="divider"/><button class="btn-danger" id="del-policy-btn" data-id="${p.id}">Delete Policy</button>`:''}
        `);
        document.getElementById('del-policy-btn')?.addEventListener('click', async e2 => {
          if(confirm('Delete this policy?')) { await db.collection('policies').doc(e2.currentTarget.dataset.id).delete(); closeModal(); renderCompany(); }
        });
      });
    });
  }

  document.getElementById('add-policy-btn')?.addEventListener('click', () => {
    openModal('Add Policy / Document', `
      <div class="form-group"><label>Title</label><input id="pol-title" placeholder="e.g. Code of Conduct"/></div>
      <div class="form-group"><label>Icon (emoji)</label><input id="pol-icon" placeholder="📄" maxlength="4"/></div>
      <div class="form-group"><label>Description</label><input id="pol-desc" placeholder="Brief summary"/></div>
      <div class="form-group"><label>Full Content</label><textarea id="pol-content" rows="6" placeholder="Paste policy text here…"></textarea></div>
      <div id="pol-file-upload"></div>
    `, `<button class="btn-primary" id="save-pol-btn">Save Policy</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    let uploadedFile = null;
    Drive.renderUploadArea('pol-file-upload', (result) => { uploadedFile = result; }, { label:'Attach document (optional)', accept:'*', dept:'Admin', subfolder:'Policies' });

    document.getElementById('save-pol-btn').addEventListener('click', async () => {
      await db.collection('policies').add({
        title:       document.getElementById('pol-title').value.trim(),
        icon:        document.getElementById('pol-icon').value.trim()||'📄',
        description: document.getElementById('pol-desc').value.trim(),
        content:     document.getElementById('pol-content').value,
        fileUrl:     uploadedFile?.url||null,
        addedBy:     currentUser.uid,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); renderCompany();
    });
  });
}

// ── Departments (owner/manager) ───────────────────
async function renderDepartments() {
  const c = document.getElementById('page-content');
  const canAdd = currentRole === 'owner' || currentRole === 'manager';
  c.innerHTML = `
    <div class="page-header">
      <h2>🗂️ Departments</h2>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-dept-btn">+ Add Department</button>`:''}
    </div>
    <div class="dept-grid" id="dept-grid"><div class="loading-placeholder">Loading…</div></div>
  `;

  const snap = await db.collection('departments').get();
  const depts = snap.docs.map(d => ({id:d.id,...d.data()}));
  const grid  = document.getElementById('dept-grid');
  if (!depts.length) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🗂️</div><h4>No departments yet</h4></div>`; return; }

  grid.innerHTML = depts.map(d => {
    const config = DEPARTMENTS[d.name]||{};
    return `<div class="dept-card" style="border-top-color:${config.color||'var(--primary-light)'}">
      <div class="dept-name">${config.icon||'🗂️'} ${d.name}</div>
      <div class="dept-head">Head: ${d.head||'Unassigned'}</div>
      <div class="dept-members">${(d.members||[]).map(m=>`<div class="member-chip">👤 ${m}</div>`).join('')||'<span class="text-muted">No members</span>'}</div>
    </div>`;
  }).join('');

  document.getElementById('add-dept-btn')?.addEventListener('click', () => {
    openModal('Add Department', `
      <div class="form-group"><label>Department Name</label>
        <select id="dept-name-sel"><option value="">-- Select --</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}<option value="custom">Custom…</option></select>
      </div>
      <div class="form-group hidden" id="dept-custom-wrap"><label>Custom Name</label><input id="dept-custom-name"/></div>
      <div class="form-group"><label>Department Head</label><input id="dept-head" placeholder="Name"/></div>
      <div class="form-group"><label>Members (comma-separated)</label><textarea id="dept-members" rows="3" placeholder="John, Maria, Carlos"></textarea></div>
    `, `<button class="btn-primary" id="save-dept-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('dept-name-sel').onchange = function() {
      document.getElementById('dept-custom-wrap').classList.toggle('hidden', this.value !== 'custom');
    };
    document.getElementById('save-dept-btn').addEventListener('click', async () => {
      const sel = document.getElementById('dept-name-sel').value;
      const name = sel === 'custom' ? document.getElementById('dept-custom-name').value.trim() : sel;
      if (!name) return;
      const members = document.getElementById('dept-members').value.split(',').map(s=>s.trim()).filter(Boolean);
      await db.collection('departments').add({ name, head: document.getElementById('dept-head').value.trim(), members, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      closeModal(); renderDepartments();
    });
  });
}

// ── Analytics (owner) ─────────────────────────────
async function renderAnalytics() {
  if (currentRole !== 'owner' && currentRole !== 'manager') {
    document.getElementById('page-content').innerHTML = renderAccessDenied('Analytics');
    return;
  }
  const c = document.getElementById('page-content');
  c.innerHTML = '<div class="loading-placeholder">Loading analytics…</div>';

  const [usersSnap, tasksSnap, quotesSnap, subsSnap, expensesSnap] = await Promise.all([
    db.collection('users').get(), db.collection('tasks').get(),
    db.collection('quotes').get(), db.collection('submissions').get(),
    db.collection('expenses').get()
  ]);

  const users    = usersSnap.docs.map(d => ({id:d.id,...d.data()}));
  const tasks    = tasksSnap.docs.map(d => d.data());
  const quotes   = quotesSnap.docs.map(d => d.data());
  const subs     = subsSnap.docs.map(d => d.data());
  const expenses = expensesSnap.docs.map(d => d.data());

  const totalPayroll = users.reduce((s,u) => s+(u.salary||0)+(u.allowance||0)-(u.deductions||0), 0);
  const won          = quotes.filter(q => q.status==='accepted').reduce((s,q) => s+(q.total||0), 0);
  const totalExp     = expenses.filter(e => e.status==='approved').reduce((s,e) => s+(e.amount||0), 0);

  c.innerHTML = `
    <div class="page-header"><h2>📈 Analytics & Performance</h2></div>
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Team Size</div><div class="kpi-value">${users.length}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Monthly Payroll</div><div class="kpi-value">₱${formatNum(totalPayroll)}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Revenue (Quotes Won)</div><div class="kpi-value">₱${formatNum(won)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Approved Expenses</div><div class="kpi-value">₱${formatNum(totalExp)}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="card"><div class="card-header"><h3>Quote Status</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="q-chart"></canvas></div></div></div>
      <div class="card"><div class="card-header"><h3>Submissions</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="s-chart"></canvas></div></div></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Team Performance</h3></div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Role</th><th>Dept</th><th>Tasks Done</th><th>Net Pay</th></tr></thead>
            <tbody>
              ${users.map(u => {
                const done = tasks.filter(t => t.assignedTo===u.id && t.status==='done').length;
                const net  = (u.salary||0)+(u.allowance||0)-(u.deductions||0);
                return `<tr>
                  <td>${u.displayName||u.email}</td>
                  <td><span class="badge badge-blue">${ROLES[u.role]?.label||u.role}</span></td>
                  <td>${u.department||'—'}</td>
                  <td>${done}</td>
                  <td><strong>₱${formatNum(net)}</strong></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  new Chart(document.getElementById('q-chart'), {
    type:'bar', data:{ labels:['Draft','Sent','Accepted','Rejected'], datasets:[{data:['draft','sent','accepted','rejected'].map(s=>quotes.filter(q=>q.status===s).length), backgroundColor:['#9e9e9e','#1565c0','#2e7d32','#c62828']}] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} }
  });
  new Chart(document.getElementById('s-chart'), {
    type:'pie', data:{ labels:['Pending','Approved','Rejected'], datasets:[{data:[subs.filter(s=>!s.status||s.status==='pending').length, subs.filter(s=>s.status==='approved').length, subs.filter(s=>s.status==='rejected').length], backgroundColor:['#f57f17','#2e7d32','#c62828']}] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} }
  });
}

// ── Team / Payroll (owner) ────────────────────────
async function renderTeam() {
  if (currentRole !== 'owner' && currentRole !== 'manager') {
    document.getElementById('page-content').innerHTML = renderAccessDenied('Team Management');
    return;
  }
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <h2>👥 Team & Payroll</h2>
      <button class="btn-primary btn-sm" id="add-emp-btn">+ Add Employee</button>
    </div>
    <div id="team-table"><div class="loading-placeholder">Loading…</div></div>
  `;

  const snap = await db.collection('users').get();
  const users = snap.docs.map(d => ({id:d.id,...d.data()}));
  const table = document.getElementById('team-table');

  table.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Employee</th><th>ID</th><th>Role</th><th>Dept</th><th>Base</th><th>Allowance</th><th>Deductions</th><th>Net</th><th></th></tr></thead>
          <tbody>
            ${users.map(u => {
              const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);
              return `<tr>
                <td>${u.displayName||u.email}</td>
                <td><code style="font-size:11px">${u.employeeId||'—'}</code></td>
                <td><span class="badge badge-blue">${ROLES[u.role]?.label||u.role}</span></td>
                <td>${u.department||'—'}</td>
                <td>₱${formatNum(u.salary)}</td>
                <td>₱${formatNum(u.allowance)}</td>
                <td>₱${formatNum(u.deductions)}</td>
                <td><strong>₱${formatNum(net)}</strong></td>
                <td><button class="btn-icon edit-emp-btn" data-uid="${u.id}">✏️</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  table.querySelectorAll('.edit-emp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = users.find(x => x.id === btn.dataset.uid);
      if (u) openEditEmployeeModal(u);
    });
  });

  document.getElementById('add-emp-btn').addEventListener('click', openAddEmployeeModal);
}

function openAddEmployeeModal() {
  openModal('Add Employee Account', `
    <p style="font-size:12px;color:var(--text-muted);background:var(--surface2);padding:10px;border-radius:8px;margin-bottom:14px">⚠️ First create their login account in Firebase Console → Authentication → Add user. Then add their profile here.</p>
    <div class="form-group"><label>Display Name</label><input id="emp-name"/></div>
    <div class="form-group"><label>Email</label><input id="emp-email" type="email"/></div>
    <div class="form-group"><label>Employee ID</label><input id="emp-eid" placeholder="e.g. BI-2026-001"/></div>
    <div class="form-row">
      <div class="form-group"><label>Role</label>
        <select id="emp-role">${Object.entries(ROLES).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Department</label>
        <select id="emp-dept"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-group"><label>Job Title</label><input id="emp-title" placeholder="e.g. Sales Executive"/></div>
    <div class="form-row">
      <div class="form-group"><label>Base Salary (₱)</label><input id="emp-salary" type="number" value="0"/></div>
      <div class="form-group"><label>Allowance (₱)</label><input id="emp-allow" type="number" value="0"/></div>
    </div>
    <div class="form-group"><label>Deductions (₱)</label><input id="emp-deduct" type="number" value="0"/></div>
    <div class="form-group"><label>Start Date</label><input id="emp-start" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
  `, `<button class="btn-primary" id="save-emp-btn">Save Employee</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  document.getElementById('save-emp-btn').addEventListener('click', async () => {
    await db.collection('users').add({
      displayName: document.getElementById('emp-name').value.trim(),
      email:       document.getElementById('emp-email').value.trim(),
      employeeId:  document.getElementById('emp-eid').value.trim(),
      role:        document.getElementById('emp-role').value,
      department:  document.getElementById('emp-dept').value,
      title:       document.getElementById('emp-title').value.trim(),
      salary:      parseFloat(document.getElementById('emp-salary').value)||0,
      allowance:   parseFloat(document.getElementById('emp-allow').value)||0,
      deductions:  parseFloat(document.getElementById('emp-deduct').value)||0,
      startDate:   document.getElementById('emp-start').value,
      createdAt:   firebase.firestore.FieldValue.serverTimestamp()
    });
    closeModal(); renderTeam();
  });
}

function openEditEmployeeModal(u) {
  openModal(`Edit: ${u.displayName||u.email}`, `
    <div class="form-group"><label>Display Name</label><input id="eu-name" value="${u.displayName||''}"/></div>
    <div class="form-group"><label>Employee ID</label><input id="eu-eid" value="${u.employeeId||''}"/></div>
    <div class="form-group"><label>Job Title</label><input id="eu-title" value="${u.title||''}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Role</label>
        <select id="eu-role">${Object.entries(ROLES).map(([k,v]) => `<option value="${k}" ${u.role===k?'selected':''}>${v.label}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Department</label>
        <select id="eu-dept"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}" ${u.department===k?'selected':''}>${k}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Base Salary (₱)</label><input id="eu-salary" type="number" value="${u.salary||0}"/></div>
      <div class="form-group"><label>Allowance (₱)</label><input id="eu-allow" type="number" value="${u.allowance||0}"/></div>
    </div>
    <div class="form-group"><label>Deductions (₱)</label><input id="eu-deduct" type="number" value="${u.deductions||0}"/></div>
  `, `<button class="btn-primary" id="save-eu-btn">Save Changes</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  document.getElementById('save-eu-btn').addEventListener('click', async () => {
    await db.collection('users').doc(u.id).update({
      displayName: document.getElementById('eu-name').value.trim(),
      employeeId:  document.getElementById('eu-eid').value.trim(),
      title:       document.getElementById('eu-title').value.trim(),
      role:        document.getElementById('eu-role').value,
      department:  document.getElementById('eu-dept').value,
      salary:      parseFloat(document.getElementById('eu-salary').value)||0,
      allowance:   parseFloat(document.getElementById('eu-allow').value)||0,
      deductions:  parseFloat(document.getElementById('eu-deduct').value)||0,
    });
    closeModal(); renderTeam();
  });
}

// ── Profile Drawer ────────────────────────────────
function openProfileDrawer() {
  const drawer  = document.getElementById('profile-drawer');
  const overlay = document.getElementById('drawer-overlay');
  const body    = document.getElementById('profile-body');
  const u = userProfile;
  const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);

  body.innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div id="profile-photo-wrap" style="width:80px;height:80px;border-radius:50%;overflow:hidden;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#fff;cursor:pointer;margin:0 auto 10px">
        ${u.photoUrl?`<img src="${u.photoUrl}" style="width:100%;height:100%;object-fit:cover"/>`:(u.displayName||'?')[0].toUpperCase()}
        </div>
      <p style="font-size:11px;color:var(--text-muted)">Click photo to change</p>
    </div>

    <div class="form-group"><label>Display Name</label>
      <div style="display:flex;gap:8px">
        <input id="profile-name" value="${u.displayName||''}" style="flex:1;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px"/>
        <button class="btn-primary btn-sm" id="save-name-btn">Save</button>
      </div>
    </div>

    <div class="form-group"><label>Email</label><input value="${u.email||''}" disabled style="background:var(--surface2);padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;width:100%"/></div>
    <div class="form-group"><label>Employee ID</label><input value="${u.employeeId||'—'}" disabled style="background:var(--surface2);padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;width:100%;font-family:monospace"/></div>
    <div class="form-group"><label>Role</label><input value="${ROLES[u.role]?.label||u.role}" disabled style="background:var(--surface2);padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;width:100%"/></div>
    <div class="form-group"><label>Department</label><input value="${u.department||'Unassigned'}" disabled style="background:var(--surface2);padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;width:100%"/></div>

    <div class="card" style="margin-top:10px">
      <div class="card-header"><h3>💰 My Salary</h3></div>
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>Base</span><strong>₱${formatNum(u.salary)}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>Allowance</span><span style="color:var(--success)">+₱${formatNum(u.allowance)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>Deductions</span><span style="color:var(--danger)">-₱${formatNum(u.deductions)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:16px;font-weight:800"><span>Net Pay</span><span>₱${formatNum(net)}</span></div>
      </div>
    </div>

    <button class="btn-danger" style="width:100%;margin-top:14px" onclick="auth.signOut()">🚪 Sign Out</button>
  `;

  drawer.classList.remove('hidden');
  setTimeout(() => drawer.classList.add('open'), 10);
  overlay.classList.remove('hidden');
  overlay.classList.add('active');

  // Photo change
  document.getElementById('profile-photo-wrap').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      Notifs.showToast('Uploading…');
      try {
        const url = await Drive.uploadProfilePhoto(file, currentUser.uid);
        await db.collection('users').doc(currentUser.uid).update({ photoUrl: url });
        userProfile.photoUrl = url; applyUserUI();
        document.getElementById('profile-photo-wrap').innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover"/>`;
        Notifs.showToast('Photo updated!');
      } catch(err) { Notifs.showToast('Upload failed', 'error'); }
    };
    input.click();
  });

  // Save name
  document.getElementById('save-name-btn').addEventListener('click', async () => {
    const name = document.getElementById('profile-name').value.trim();
    if (!name) return;
    await db.collection('users').doc(currentUser.uid).update({ displayName: name });
    userProfile.displayName = name; applyUserUI();
    Notifs.showToast('Name updated!');
  });

  document.getElementById('profile-close').onclick = closeProfileDrawer;
  overlay.addEventListener('click', closeProfileDrawer);
}

function closeProfileDrawer() {
  const drawer  = document.getElementById('profile-drawer');
  const overlay = document.getElementById('drawer-overlay');
  drawer.classList.remove('open');
  overlay.classList.remove('active');
  overlay.classList.add('hidden');
  setTimeout(() => drawer.classList.add('hidden'), 300);
}

// ── Modal ─────────────────────────────────────────
window.openModal = function(title, bodyHTML, footerHTML = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML    = bodyHTML;
  const footer = document.getElementById('modal-footer');
  footer.innerHTML = footerHTML;
  footer.classList.toggle('hidden', !footerHTML);
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.add('active');
};

window.closeModal = function() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('active');
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
});

// ── Mini Calendar ─────────────────────────────────
function renderMiniCal() {
  const el = document.getElementById('mini-cal');
  if (!el) return;
  const now = new Date(); const year = now.getFullYear(); const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const days     = new Date(year, month+1, 0).getDate();
  const months   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  el.innerHTML = `
    <div class="mini-cal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-weight:700;font-size:14px">
      <span>${months[month]} ${year}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">
      ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<div style="font-size:10px;font-weight:700;color:var(--text-muted);padding:4px">${d}</div>`).join('')}
      ${Array(firstDay).fill('<div></div>').join('')}
      ${Array.from({length:days},(_,i)=>{ const day=i+1; const isToday=day===now.getDate(); return `<div style="padding:5px 2px;border-radius:50%;font-size:12px;${isToday?'background:var(--primary);color:#fff;font-weight:700':''}">${day}</div>`; }).join('')}
    </div>
  `;
}

// ── Access Denied ─────────────────────────────────
function renderAccessDenied(section) {
  return `<div class="access-denied"><div class="ad-icon">🔒</div><h3>Access Restricted</h3><p>You don't have access to ${section}. Contact your administrator.</p></div>`;
}

// ── Helpers ───────────────────────────────────────
function formatNum(n) { return Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ── Service Worker ────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.warn);
}
