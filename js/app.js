/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Core App v3
   app.js
═══════════════════════════════════════════════════ */
'use strict';

// ── State ──────────────────────────────────────────
let currentUser  = null;
let currentRole  = null;
let currentDepts = [];   // array — supports dual department
let currentPage  = 'dashboard';
let userProfile  = {};
let logoutTimer  = null;

// ── Boot ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
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
      startAutoLogout();
    } else {
      showLogin();
    }
  });
});

// ── Auto-Logout ───────────────────────────────────
function startAutoLogout() {
  resetLogoutTimer();
  ['click','keydown','mousemove','touchstart','scroll'].forEach(e =>
    document.addEventListener(e, resetLogoutTimer, { passive: true })
  );
}
function resetLogoutTimer() {
  clearTimeout(logoutTimer);
  logoutTimer = setTimeout(() => {
    Notifs.stopListener();
    auth.signOut();
    Notifs.showToast('Signed out due to inactivity.');
  }, window.AUTO_LOGOUT_MS);
}

// ── Screens ───────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}
function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  // Init Lucide icons for static topbar elements
  if (window.lucide) lucide.createIcons();
  // Apply correct theme toggle icon
  _applyThemeIcon(localStorage.getItem('bi-theme') || 'dark');
}

// ── User Profile ──────────────────────────────────
async function loadUserProfile(user) {
  try {
    let snap = await db.collection('users').doc(user.uid).get();
    if (!snap.exists) {
      const empCount = (await db.collection('users').get()).size;
      const empId    = `BI-${new Date().getFullYear()}-${String(empCount+1).padStart(3,'0')}`;
      const profile  = {
        uid: user.uid, email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        role: 'employee', departments: [], title: '',
        employeeId: empId, salary: 0, allowance: 0, deductions: 0,
        photoUrl: '', startDate: new Date().toISOString().slice(0,10),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection('users').doc(user.uid).set(profile);
      snap = await db.collection('users').doc(user.uid).get();
    }
    userProfile  = { id: snap.id, ...snap.data() };
    currentRole  = userProfile.role || 'employee';
    // Support both old string 'department' and new array 'departments'
    if (Array.isArray(userProfile.departments) && userProfile.departments.length) {
      currentDepts = userProfile.departments;
    } else if (userProfile.department) {
      currentDepts = [userProfile.department];
    } else {
      currentDepts = [];
    }
    applyUserUI();
  } catch(err) {
    console.error('Profile load error:', err);
    currentRole  = 'employee';
    currentDepts = [];
    userProfile  = { displayName: user.email, role: 'employee', departments: [], email: user.email };
    applyUserUI();
  }
}

function applyUserUI() {
  const initial  = (userProfile.displayName||'?')[0].toUpperCase();
  const roleName = ROLES[currentRole]?.label || currentRole;
  const ta = document.getElementById('topbar-avatar');
  if (ta) {
    ta.innerHTML = userProfile.photoUrl
      ? `<img src="${userProfile.photoUrl}" style="width:34px;height:34px;border-radius:50%;object-fit:cover"/>`
      : initial;
    ta.onclick = openProfileDrawer;
  }
  const sa = document.getElementById('sidebar-avatar');
  if (sa) sa.innerHTML = userProfile.photoUrl ? `<img src="${userProfile.photoUrl}"/>` : initial;
  const sn = document.getElementById('sidebar-user-name');
  if (sn) sn.textContent = userProfile.displayName || userProfile.email;
  const sr = document.getElementById('sidebar-user-role');
  if (sr) sr.textContent = roleName;
  const sd = document.getElementById('sidebar-user-dept');
  if (sd) sd.textContent = currentDepts.join(' · ') || '';
}

// ── Login ─────────────────────────────────────────
function initLogin() {
  // Role picker cards
  document.querySelectorAll('.login-role-card').forEach(card => {
    card.addEventListener('click', () => {
      const type = card.dataset.type;
      const labels = { admin:'Admin', employee:'Employee', partner:'Partner' };
      document.getElementById('login-type-pill').textContent = labels[type] || type;
      document.getElementById('login-role-picker').classList.add('hidden');
      const fw = document.getElementById('login-form-wrap');
      fw.classList.remove('hidden');
      fw.classList.add('login-form-slide-in');
      document.getElementById('email').focus();
      if (window.lucide) lucide.createIcons({ nodes: [fw] });
    });
  });

  // Back button
  document.getElementById('login-back-btn')?.addEventListener('click', () => {
    document.getElementById('login-form-wrap').classList.add('hidden');
    document.getElementById('login-role-picker').classList.remove('hidden');
    clearLoginError();
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
  });

  document.getElementById('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    setLoginLoading(true); clearLoginError();
    try {
      await auth.signInWithEmailAndPassword(
        document.getElementById('email').value.trim(),
        document.getElementById('password').value
      );
    } catch(err) { showLoginError(friendlyError(err.code)); setLoginLoading(false); }
  });
  document.getElementById('forgot-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    if (!email) { showLoginError('Enter your email first.'); return; }
    try {
      await auth.sendPasswordResetEmail(email);
      document.getElementById('reset-sent').classList.remove('hidden');
    } catch(err) { showLoginError(friendlyError(err.code)); }
  });
  document.getElementById('pw-toggle')?.addEventListener('click', () => {
    const pw = document.getElementById('password');
    pw.type = pw.type === 'password' ? 'text' : 'password';
    const icon = pw.type === 'password' ? 'eye' : 'eye-off';
    document.getElementById('pw-toggle').innerHTML = `<i data-lucide="${icon}"></i>`;
    if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('pw-toggle')] });
  });
  document.getElementById('logout-btn')?.addEventListener('click', () => { Notifs.stopListener(); auth.signOut(); });
  document.getElementById('sidebar-profile-btn')?.addEventListener('click', openProfileDrawer);
  // Render Lucide icons in login screen
  if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('login-screen')] });
}
function setLoginLoading(on) {
  document.getElementById('login-btn-text').textContent = on ? 'Signing in…' : 'Sign In';
  document.getElementById('login-spinner').classList.toggle('hidden', !on);
  document.getElementById('login-btn').disabled = on;
}
function showLoginError(msg) { const el=document.getElementById('login-error'); el.textContent=msg; el.classList.remove('hidden'); }
function clearLoginError() { document.getElementById('login-error').classList.add('hidden'); document.getElementById('reset-sent')?.classList.add('hidden'); }
function friendlyError(code) {
  return {'auth/user-not-found':'No account with that email.','auth/wrong-password':'Incorrect password.','auth/invalid-email':'Invalid email.','auth/too-many-requests':'Too many attempts. Try later.','auth/invalid-credential':'Invalid email or password.'}[code]||'Sign-in failed.';
}

// ── Theme ─────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('bi-theme') || 'dark';
  document.documentElement.classList.toggle('light', saved === 'light');
  _applyThemeIcon(saved);
}

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  const theme = isLight ? 'light' : 'dark';
  localStorage.setItem('bi-theme', theme);
  _applyThemeIcon(theme);
}

function _applyThemeIcon(theme) {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;
  const iconName = theme === 'light' ? 'moon' : 'sun';
  btn.innerHTML = `<i data-lucide="${iconName}"></i>`;
  if (window.lucide) lucide.createIcons({ nodes: [btn] });
}

// ── Navigation ────────────────────────────────────
function buildNav() { buildSidebarNav(); buildBottomNav(); }

function isPresident() { return currentRole === 'president'; }
function isBrilliantOnly() { return currentDepts.length === 1 && currentDepts[0] === 'Brilliant Steel'; }

function getSidebarItems() {
  const pres   = isPresident() || currentRole === 'manager';
  const bsOnly = isBrilliantOnly();
  const items  = [];

  items.push({ icon:'home', label:'Dashboard', page:'dashboard' });

  if (pres) {
    // ── Admin / President Command Center ──
    items.push({ icon:'check-square',  label:'Tasks',            page:'tasks',      section:false });
    items.push({ icon:'shield-check',  label:'Approvals',        page:'approvals',  section:true  });
    items.push({ icon:'trending-up',   label:'Progress Reports', page:'progress'                  });
    items.push({ icon:'users',         label:'Team & Payroll',   page:'team',       section:true  });
    items.push({ icon:'credit-card',   label:'Finance View',     page:'personal-finance'          });
    items.push({ icon:'layout-grid',   label:'Departments',      page:'departments'               });
    items.push({ icon:'bar-chart-2',   label:'Analytics',        page:'analytics',  section:true  });
    items.push({ icon:'building-2',    label:'Company',          page:'company'                   });
  } else if (bsOnly) {
    // ── Partner — Brilliant Steel ──
    items.push({ icon:'calculator',  label:'Quote Builder', page:'bs-quote-builder' });
    items.push({ icon:'file-text',   label:'Quotations',    page:'bs-quotations'    });
    items.push({ icon:'book-open',   label:'Client Data',   page:'bs-clients'       });
    items.push({ icon:'folder',      label:'Files',         page:'files'            });
  } else {
    // ── Employee Personal ──
    items.push({ icon:'check-square', label:'My Tasks',         page:'tasks',             section:false });
    items.push({ icon:'credit-card',  label:'Personal Finance', page:'personal-finance',  section:true  });
    items.push({ icon:'banknote',     label:'Cash & Expenses',  page:'cash'                            });
    items.push({ icon:'folder',       label:'Files',            page:'files'                           });
    items.push({ icon:'building-2',   label:'Company',          page:'company',           section:true  });
    currentDepts.forEach(dept => {
      const cfg = DEPARTMENTS[dept];
      if (cfg) items.push({ icon: cfg.icon, label: dept, page: `dept:${dept}`, section: true });
    });
  }
  return items;
}

function _navIcon(icon) {
  // Lucide icon names are lowercase kebab-case; emoji/dept icons are not
  if (icon && /^[a-z][a-z0-9-]*$/.test(icon)) {
    return `<span class="nav-icon"><i data-lucide="${icon}"></i></span>`;
  }
  return `<span class="nav-icon emoji-icon">${icon}</span>`;
}
function _bnIcon(icon) {
  if (icon && /^[a-z][a-z0-9-]*$/.test(icon)) {
    return `<span class="bn-icon"><i data-lucide="${icon}"></i></span>`;
  }
  return `<span class="bn-icon emoji-icon">${icon}</span>`;
}

function buildSidebarNav() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  const items = getSidebarItems();
  let lastSection = false;
  nav.innerHTML = items.map(item => {
    const secLabel = item.section && !lastSection ? '<div class="nav-section-label">Management</div>' : '';
    if (item.section) lastSection = true;
    return `${secLabel}<button class="nav-item" data-page="${item.page}">${_navIcon(item.icon)}${item.label}</button>`;
  }).join('');
  nav.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.page);
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay')?.classList.add('hidden');
    });
  });
  if (window.lucide) lucide.createIcons({ nodes: [nav] });
}

function buildBottomNav() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const items = isPresident() ? window.PRESIDENT_BOTTOM_NAV
    : isBrilliantOnly() ? window.BRILLIANT_BOTTOM_NAV
    : window.BOTTOM_NAV_ITEMS;
  nav.innerHTML = items.map(item =>
    `<button class="bottom-nav-item" data-page="${item.page}">
       ${_bnIcon(item.icon)}
       <span class="bn-label">${item.label}</span>
     </button>`
  ).join('');
  nav.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
  if (window.lucide) lucide.createIcons({ nodes: [nav] });
}

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

  // dept: prefix for dual dept tabs
  if (page.startsWith('dept:')) {
    const dept = page.slice(5);
    renderDeptModule(dept);
    return;
  }

  switch(page) {
    case 'dashboard':        renderDashboard(); break;
    case 'company':          renderCompany(); break;
    case 'tasks':            renderTasks(currentUser, currentRole, currentDepts[0]||''); break;
    case 'submissions':      renderSubmissions(currentUser, currentRole, currentDepts[0]||''); break;
    case 'files':            renderFiles(currentUser, currentRole); break;
    case 'cash':             renderCash(currentUser, currentRole); break;
    case 'personal-finance': renderPersonalFinance(currentUser, currentRole); break;
    case 'my-dept':          renderMyDepartment(); break;
    case 'departments':      renderDepartments(); break;
    case 'analytics':        renderAnalytics(); break;
    case 'approvals':        renderApprovals(currentUser); break;
    case 'team':             renderTeam(); break;
    case 'progress':         renderProgressReports(); break;
    case 'bs-quote-builder': renderBrilliantSteel(currentUser, currentRole, 'Quote Builder'); break;
    case 'bs-quotations':    renderBrilliantSteel(currentUser, currentRole, 'Quotations Summary'); break;
    case 'bs-clients':       renderBrilliantSteel(currentUser, currentRole, 'Client Data'); break;
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
  if (isPresident() || currentRole === 'manager') {
    await renderPresidentDashboard();
  } else if (isBrilliantOnly()) {
    renderBrilliantSteel(currentUser, currentRole, 'Dashboard');
  } else {
    await renderEmployeeDashboard();
  }
}

function liveDateTime(elId) {
  const update = () => {
    const el = document.getElementById(elId);
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleString('en-PH', {
      weekday:'long', year:'numeric', month:'long', day:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
  };
  update();
  return setInterval(update, 1000);
}

async function renderPresidentDashboard() {
  const c = document.getElementById('page-content');
  c.innerHTML = '<div class="loading-placeholder">Loading dashboard…</div>';
  try {
    const safeGet = async (q) => { try { return await q.get(); } catch(e) { return { docs:[], size:0 }; } };
    const todayStr = new Date().toISOString().slice(0,10);
    const [usersSnap, tasksSnap, subsSnap, quotesSnap, approvalsSnap, caSnap] = await Promise.all([
      safeGet(db.collection('users')),
      safeGet(db.collection('tasks')),
      safeGet(db.collection('submissions')),
      safeGet(db.collection('quotes')),
      safeGet(db.collection('approval_requests').where('status','==','pending')),
      safeGet(db.collection('cash_advances').where('status','==','pending'))
    ]);

    const users       = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const allTasks    = tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
    const openTasks   = allTasks.filter(t=>t.status!=='done');
    const doneTasks   = allTasks.filter(t=>t.status==='done');
    const overdueTasks= openTasks.filter(t=>t.dueDate && t.dueDate < todayStr);
    const highPriority= openTasks.filter(t=>t.priority==='high').length;
    const pendingSubs = subsSnap.docs.filter(d=>d.data().status==='pending').length;
    const totalQuotes = quotesSnap.docs.reduce((s,d)=>s+(d.data().total||0),0);
    const pendingApprovals = approvalsSnap.size;
    const pendingCA   = caSnap.size;

    // Total payroll burn (sum of net pay of all employees)
    const payrollBurn = users.reduce((s,u)=>(s+(u.salary||0)+(u.allowance||0)-(u.deductions||0)),0);

    // Sort open tasks: overdue first, then by priority (high→medium→low), then by dueDate
    const priorityOrder = { high:0, medium:1, low:2 };
    const sortedOpen = [...openTasks].sort((a,b)=>{
      const aOvr = a.dueDate && a.dueDate < todayStr ? 0 : 1;
      const bOvr = b.dueDate && b.dueDate < todayStr ? 0 : 1;
      if (aOvr !== bOvr) return aOvr - bOvr;
      const ap = priorityOrder[a.priority]??2, bp = priorityOrder[b.priority]??2;
      if (ap !== bp) return ap - bp;
      return (a.dueDate||'').localeCompare(b.dueDate||'');
    });

    const taskBadge = (t) => {
      const isOverdue = t.dueDate && t.dueDate < todayStr;
      if (isOverdue) return `<span class="badge badge-red">Overdue</span>`;
      if (t.status==='done') return `<span class="badge badge-green">Done</span>`;
      if (t.priority==='high') return `<span class="badge badge-red">High</span>`;
      return `<span class="badge badge-blue">${t.status||'open'}</span>`;
    };

    c.innerHTML = `
      <div class="page-header">
        <h2>Command Center</h2>
        <span class="badge badge-blue">${ROLES[currentRole]?.label||'President'}</span>
      </div>
      <div id="live-clock" class="live-clock-line"></div>

      <div id="pres-id-card-wrap" style="margin-bottom:20px"></div>

      ${overdueTasks.length>0?`
      <div class="alert-banner alert-danger" onclick="navigateTo('tasks')">
        <span>⚠️ <strong>${overdueTasks.length} overdue task${overdueTasks.length>1?'s':''}</strong> need immediate attention</span>
        <span class="alert-chevron">›</span>
      </div>`:''}

      ${pendingApprovals>0||pendingCA>0?`
      <div class="alert-banner alert-warn" onclick="navigateTo('approvals')">
        <span>📋 ${pendingApprovals} approval${pendingApprovals!==1?'s':''} · ${pendingCA} cash advance${pendingCA!==1?'s':''} pending</span>
        <span class="alert-chevron">›</span>
      </div>`:''}

      <div class="kpi-row">
        <div class="kpi-card">
          <div class="kpi-icon-wrap" style="background:rgba(10,132,255,0.12)"><i data-lucide="users" style="stroke:#0A84FF;width:18px"></i></div>
          <div class="kpi-label">Team</div>
          <div class="kpi-value">${users.length}</div>
        </div>
        <div class="kpi-card ${openTasks.length>0?'accent':''}">
          <div class="kpi-icon-wrap" style="background:rgba(155,168,255,0.12)"><i data-lucide="check-square" style="stroke:#9BA8FF;width:18px"></i></div>
          <div class="kpi-label">Open Tasks</div>
          <div class="kpi-value">${openTasks.length}</div>
          <div class="kpi-sub">${doneTasks.length} done · ${highPriority} high</div>
        </div>
        <div class="kpi-card ${overdueTasks.length>0?'red':''}">
          <div class="kpi-icon-wrap" style="background:rgba(255,69,58,0.12)"><i data-lucide="alert-triangle" style="stroke:#FF453A;width:18px"></i></div>
          <div class="kpi-label">Overdue</div>
          <div class="kpi-value">${overdueTasks.length}</div>
        </div>
        <div class="kpi-card green">
          <div class="kpi-icon-wrap" style="background:rgba(48,209,88,0.12)"><i data-lucide="trending-up" style="stroke:#30D158;width:18px"></i></div>
          <div class="kpi-label">Quote Pipeline</div>
          <div class="kpi-value" style="font-size:15px">₱${formatNum(totalQuotes)}</div>
        </div>
        <div class="kpi-card warn">
          <div class="kpi-icon-wrap" style="background:rgba(255,170,0,0.12)"><i data-lucide="banknote" style="stroke:#FFAA00;width:18px"></i></div>
          <div class="kpi-label">Monthly Payroll</div>
          <div class="kpi-value" style="font-size:15px">₱${formatNum(payrollBurn)}</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header">
            <h3>Live Task Feed</h3>
            <button class="btn-primary btn-sm" onclick="navigateTo('tasks')">All Tasks</button>
          </div>
          <div class="card-body" style="padding:0">
            ${!sortedOpen.length
              ? '<div class="empty-state" style="padding:24px"><div class="empty-icon">✅</div><p>All tasks done!</p></div>'
              : sortedOpen.slice(0,8).map(t=>{
                  const isOverdue = t.dueDate && t.dueDate < todayStr;
                  return `<div class="task-feed-item ${isOverdue?'task-overdue':''}">
                    <div class="task-feed-dot priority-dot-${t.priority||'medium'}"></div>
                    <div style="flex:1;min-width:0">
                      <div class="task-feed-title">${t.title}</div>
                      <div class="task-feed-meta">
                        ${t.assignedToName||'Unassigned'}
                        ${t.dueDate?` · <span style="color:${isOverdue?'var(--danger)':'var(--text-muted)'}">Due ${t.dueDate}</span>`:''}
                        ${t.department?` · ${t.department}`:''}
                      </div>
                    </div>
                    ${taskBadge(t)}
                  </div>`;
                }).join('')}
          </div>
        </div>

        <div>
          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><h3>📅 Calendar</h3></div>
            <div class="card-body" id="mini-cal"></div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Quick Actions</h3></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
              <button class="quick-action-btn" onclick="navigateTo('tasks')">
                <i data-lucide="plus-circle"></i> New Task
              </button>
              <button class="quick-action-btn" onclick="navigateTo('approvals')">
                <i data-lucide="shield-check"></i> Review Approvals
                ${pendingApprovals>0?`<span class="badge badge-red" style="margin-left:auto">${pendingApprovals}</span>`:''}
              </button>
              <button class="quick-action-btn" onclick="navigateTo('team')">
                <i data-lucide="users"></i> Team & Payroll
              </button>
              <button class="quick-action-btn" onclick="navigateTo('progress')">
                <i data-lucide="trending-up"></i> Progress Reports
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    renderIDCard('pres-id-card-wrap', userProfile);
    liveDateTime('live-clock');
    renderMiniCal();
    if (window.lucide) lucide.createIcons({ nodes: [c] });
  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>Dashboard error</h4><p style="font-size:12px;color:var(--text-muted)">${err.message}</p></div>`;
  }
}

async function renderEmployeeDashboard() {
  const c = document.getElementById('page-content');
  c.innerHTML = '<div class="loading-placeholder">Loading…</div>';
  try {
    const todayStr = new Date().toISOString().slice(0,10);
    const [myTasksSnap, attSnap, caSnap] = await Promise.all([
      db.collection('tasks').where('assignedTo','==',currentUser.uid).get(),
      db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).get(),
      db.collection('cash_advances').where('employeeId','==',currentUser.uid).orderBy('createdAt','desc').limit(3).get().catch(()=>({docs:[]}))
    ]);

    const myTasks    = myTasksSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const openTasks  = myTasks.filter(t=>t.status!=='done');
    const doneTasks  = myTasks.filter(t=>t.status==='done');
    const overdue    = openTasks.filter(t=>t.dueDate && t.dueDate < todayStr);
    const u = userProfile;
    const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);

    // Attendance
    const attData  = attSnap.exists ? attSnap.data() : {};
    const hasLogin = !!attData.loginTime;
    const hasFull  = !!attData.fullTime;

    // KPI computation
    const taskScore = myTasks.length > 0 ? Math.round((doneTasks.length / myTasks.length) * 100) : 0;
    const kpiProfile = await db.collection('kpi_targets').doc(currentUser.uid).get().catch(()=>null);
    const kpiTarget  = kpiProfile?.exists ? kpiProfile.data() : {};
    const targetScore = kpiTarget.targetScore || 80;
    const kpiColor = taskScore >= targetScore ? 'var(--success)' : taskScore >= 60 ? 'var(--warning)' : 'var(--danger)';

    // Recent CA
    const recentCA = caSnap.docs.map(d=>({id:d.id,...d.data()}));

    const attBadgeClass = hasFull?'badge-green':hasLogin?'badge-orange':'badge-gray';
    const attLabel      = hasFull ? 'Full Day ✅' : hasLogin ? 'Half Day 🕐' : 'Not Logged In';

    c.innerHTML = `
      <div class="page-header"><h2>👋 Hi, ${(u.displayName||'').split(' ')[0]}!</h2></div>
      <div id="live-clock" class="live-clock-line"></div>

      <div id="emp-id-card-wrap" style="margin-bottom:20px"></div>

      ${overdue.length>0?`<div class="alert-banner alert-danger"><span>⚠️ <strong>${overdue.length} overdue task${overdue.length>1?'s':''}</strong></span><span class="alert-chevron">›</span></div>`:''}

      <!-- Attendance Card -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3>Attendance</h3>
          <span class="badge ${attBadgeClass}">${attLabel}</span>
        </div>
        <div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap">
          ${!hasLogin?`<button class="btn-primary" id="login-att-btn"><i data-lucide="log-in" style="width:14px;margin-right:6px"></i>Log In (Half Day)</button>`:''}
          ${hasLogin&&!hasFull?`<button class="btn-secondary" id="fullday-att-btn"><i data-lucide="check" style="width:14px;margin-right:6px"></i>Mark Full Day</button>`:''}
          ${hasFull?`<p style="font-size:13px;color:var(--success);font-weight:600">Full attendance recorded today.</p>`:''}
        </div>
      </div>

      <div class="kpi-row">
        <div class="kpi-card green">
          <div class="kpi-label">Net Pay</div>
          <div class="kpi-value" style="font-size:16px">₱${formatNum(net)}</div>
          <div class="kpi-sub">Base ₱${formatNum(u.salary)}</div>
        </div>
        <div class="kpi-card accent">
          <div class="kpi-label">Open Tasks</div>
          <div class="kpi-value">${openTasks.length}</div>
          <div class="kpi-sub">${doneTasks.length} done</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Task KPI</div>
          <div class="kpi-value" style="color:${kpiColor}">${taskScore}%</div>
          <div class="kpi-sub">Target: ${targetScore}%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Department</div>
          <div class="kpi-value" style="font-size:12px;line-height:1.3">${currentDepts.join(', ')||'Unassigned'}</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header">
            <h3>My Tasks</h3>
            <button class="btn-primary btn-sm" onclick="navigateTo('tasks')">View All</button>
          </div>
          <div class="card-body" style="padding:0">
            ${!myTasks.length
              ? '<div class="empty-state" style="padding:20px"><div class="empty-icon">✅</div><p>No tasks assigned yet</p></div>'
              : openTasks.slice(0,5).map(t=>{
                  const isOverdue = t.dueDate && t.dueDate < todayStr;
                  return `<div class="task-feed-item ${isOverdue?'task-overdue':''}">
                    <div class="task-feed-dot priority-dot-${t.priority||'medium'}"></div>
                    <div style="flex:1;min-width:0">
                      <div class="task-feed-title">${t.title}</div>
                      ${t.dueDate?`<div class="task-feed-meta" style="color:${isOverdue?'var(--danger)':'var(--text-muted)'}">Due ${t.dueDate}</div>`:''}
                    </div>
                    <span class="badge ${isOverdue?'badge-red':t.priority==='high'?'badge-red':'badge-blue'}">${isOverdue?'Overdue':t.priority||'open'}</span>
                  </div>`;
                }).join('')}
          </div>
        </div>

        <div>
          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><h3>KPI Breakdown</h3></div>
            <div class="card-body">
              <div style="margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
                  <span>Task Completion</span><strong style="color:${kpiColor}">${taskScore}%</strong>
                </div>
                <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${taskScore}%;background:${kpiColor}"></div></div>
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:10px">
                ${doneTasks.length} of ${myTasks.length} tasks completed · Target: ${targetScore}%
              </div>
              <button class="btn-secondary btn-sm" style="margin-top:12px;width:100%" onclick="navigateTo('personal-finance')">
                View Full Payslip →
              </button>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3>📅 Calendar</h3></div>
            <div class="card-body" id="mini-cal"></div>
          </div>
        </div>
      </div>
    `;

    renderIDCard('emp-id-card-wrap', u);
    liveDateTime('live-clock');
    renderMiniCal();
    if (window.lucide) lucide.createIcons({ nodes: [c] });

    // Attendance buttons
    document.getElementById('login-att-btn')?.addEventListener('click', async () => {
      await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
        loginTime: firebase.firestore.FieldValue.serverTimestamp(), uid: currentUser.uid, date: todayStr, fullTime: false
      }, { merge: true });
      Notifs.showToast('Half-day attendance logged!');
      renderEmployeeDashboard();
    });
    document.getElementById('fullday-att-btn')?.addEventListener('click', async () => {
      await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
        fullTime: true, fullTimeAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      Notifs.showToast('Full day attendance recorded!');
      renderEmployeeDashboard();
    });

    // Auto full attendance if no new notifs today
    if (hasLogin && !hasFull) autoCheckFullAttendance(todayStr);

  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>${err.message}</h4></div>`;
  }
}

async function autoCheckFullAttendance(todayStr) {
  // If all today's notifications are read, mark full attendance automatically
  const todayStart = new Date(todayStr).getTime();
  const snap = await db.collection('notifications').doc(currentUser.uid).collection('items')
    .where('createdAt', '>=', new firebase.firestore.Timestamp(Math.floor(todayStart/1000), 0)).get();
  const todayNotifs = snap.docs.map(d=>d.data());
  if (todayNotifs.length === 0 || todayNotifs.every(n=>n.read)) {
    await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
      fullTime: true, fullTimeAt: firebase.firestore.FieldValue.serverTimestamp(), autoMarked: true
    }, { merge: true });
    Notifs.showToast('✅ Full attendance auto-recorded (no pending notifications).');
    renderEmployeeDashboard();
  }
}

// ── Employee ID Card ──────────────────────────────
function renderIDCard(containerId, u) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="id-card">
      <div class="id-card-top">
        <img src="icons/barro-logo.png" alt="BI" class="id-card-logo" onerror="this.style.display='none'"/>
        <div>
          <div class="id-card-company">BARRO INDUSTRIES</div>
          <div class="id-card-company-sub">DIGITAL COMPANY ID</div>
        </div>
      </div>
      <div class="id-card-body">
        <div class="id-card-photo" id="id-card-photo-btn" title="Click to upload photo">
          ${u.photoUrl?`<img src="${u.photoUrl}" alt="Photo"/>`:`<span style="font-size:32px">👤</span>`}
          <div class="id-card-photo-hint">📷 Change</div>
        </div>
        <div class="id-card-info">
          <div class="id-card-name">${u.displayName||u.email}</div>
          <div class="id-card-title">${(u.title&&u.title!==u.role?u.title:null)||ROLES[u.role]?.label||u.role||'Employee'}</div>
          <div class="id-card-detail"><span>🗂</span><strong>${Array.isArray(u.departments)&&u.departments.length?u.departments.join(', '):(u.department||'—')}</strong></div>
          <div class="id-card-detail"><span>✉️</span>${u.email}</div>
          ${u.startDate?`<div class="id-card-detail"><span>📅</span>Since ${u.startDate}</div>`:''}
        </div>
      </div>
      <div class="id-card-footer">
        <div class="id-card-id">${u.employeeId||'BI-0000'}</div>
        <div class="id-card-status">ACTIVE</div>
      </div>
    </div>
  `;
  document.getElementById('id-card-photo-btn')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type='file'; input.accept='image/*';
    input.onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      Notifs.showToast('Uploading photo…');
      try {
        const url = await Drive.uploadProfilePhoto(file, currentUser.uid);
        await db.collection('users').doc(currentUser.uid).update({ photoUrl: url });
        userProfile.photoUrl = url; applyUserUI();
        renderIDCard(containerId, {...u, photoUrl:url});
        Notifs.showToast('Photo updated!');
      } catch(err) { Notifs.showToast('Upload failed: '+err.message,'error'); }
    };
    input.click();
  });
}

// ── My Department (supports dual) ─────────────────
function renderMyDepartment() {
  if (!currentDepts.length) {
    document.getElementById('page-content').innerHTML = `
      <div class="access-denied"><div class="ad-icon">🗂️</div>
        <h3>No Department Assigned</h3>
        <p>Contact the President to set your department.</p>
      </div>`;
    return;
  }
  if (currentDepts.length > 1) {
    renderDualDeptPicker();
  } else {
    renderDeptModule(currentDepts[0]);
  }
}

function renderDualDeptPicker() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header"><h2>🗂️ My Departments</h2></div>
    <div class="dept-grid">
      ${currentDepts.map(dept => {
        const cfg = DEPARTMENTS[dept]||{icon:'🗂️',color:'var(--primary-light)'};
        return `<div class="dept-card" style="border-top-color:${cfg.color};cursor:pointer" onclick="renderDeptModule('${dept}')">
          <div class="dept-name" style="font-size:20px;margin-bottom:6px">${cfg.icon}</div>
          <div class="dept-name">${dept}</div>
          <div class="dept-head" style="margin-top:6px">Tap to open →</div>
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderDeptModule(dept) {
  switch(dept) {
    case 'Marketing':                  renderMarketing(currentUser, currentRole); break;
    case 'Finance':                    renderFinance(currentUser, currentRole); break;
    case 'Sales and Client Relations': renderSales(currentUser, currentRole); break;
    case 'Design':                     renderDesign(currentUser, currentRole); break;
    case 'Brilliant Steel':            renderBrilliantSteel(currentUser, currentRole); break;
    case 'Government Biddings':        renderGovBiddings(); break;
    default:                           renderGenericDept(dept); break;
  }
}

function renderGovBiddings() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header"><h2>🏛️ Government Biddings</h2></div>
    <div class="subtab-bar">
      ${['PhilGEPS','Active Bids','Archive'].map(s=>`<button class="subtab-btn ${s==='PhilGEPS'?'active':''}" data-sub="${s}">${s}</button>`).join('')}
    </div>
    <div id="gov-content"></div>
  `;
  const loadGov = sub => renderDocCollection(document.getElementById('gov-content'), `gov_${sub.toLowerCase().replace(/\s+/g,'_')}`, sub, currentUser, currentRole, {icon:'🏛️'});
  loadGov('PhilGEPS');
  c.querySelectorAll('.subtab-btn').forEach(btn => btn.addEventListener('click', () => { c.querySelectorAll('.subtab-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); loadGov(btn.dataset.sub); }));
}

function renderGenericDept(dept) {
  const cfg = DEPARTMENTS[dept];
  document.getElementById('page-content').innerHTML = `
    <div class="page-header"><h2>${cfg?.icon||'🗂️'} ${dept}</h2></div>
    <div class="card"><div class="card-body"><div class="empty-state"><div class="empty-icon">${cfg?.icon||'🗂️'}</div><h4>${dept}</h4><p>Module coming soon.</p></div></div></div>`;
}

// ── Files (employee tab) ──────────────────────────
window.renderFiles = async function(currentUser, currentRole) {
  const c = document.getElementById('page-content');
  const dept = currentDepts[0] || 'General';
  c.innerHTML = `
    <div class="page-header"><h2>📁 Files</h2></div>
    <div class="subtab-bar">
      <button class="subtab-btn active" data-sub="My Files">My Files</button>
      <button class="subtab-btn" data-sub="Department">Department Files</button>
      ${isPresident()||currentRole==='manager'?'<button class="subtab-btn" data-sub="All">All Files</button>':''}
    </div>
    <div id="files-content"></div>
  `;
  const loadFiles = (sub) => {
    const fc = document.getElementById('files-content');
    if (sub === 'My Files') {
      fc.innerHTML = renderFileCollection('My Uploaded Files', 'my-files', currentRole);
      bindFileCollection('my-files', currentUser, dept, 'Personal', currentUser.uid);
    } else if (sub === 'Department') {
      fc.innerHTML = renderFileCollection(`${dept} Files`, 'dept-files', currentRole);
      bindFileCollection('dept-files', currentUser, dept, 'Shared');
    } else {
      fc.innerHTML = renderFileCollection('All Company Files', 'all-files', currentRole);
      bindFileCollection('all-files', currentUser, 'General', 'All');
    }
  };
  loadFiles('My Files');
  c.querySelectorAll('.subtab-btn').forEach(btn => btn.addEventListener('click', () => { c.querySelectorAll('.subtab-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); loadFiles(btn.dataset.sub); }));
};

// ── Personal Finance ──────────────────────────────
window.renderPersonalFinance = async function(currentUser, currentRole) {
  const c = document.getElementById('page-content');
  const pres = isPresident() || currentRole === 'manager';

  if (pres) {
    // President sees all employees' finance
    c.innerHTML = `
      <div class="page-header"><h2>💳 Personal Finance — Team</h2></div>
      <div id="pf-content"><div class="loading-placeholder">Loading…</div></div>
    `;
    const snap = await db.collection('users').get();
    const users = snap.docs.map(d=>({id:d.id,...d.data()}));
    const userRows = await Promise.all(users.map(async u => {
      const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);
      const kpi = await getKpiScore(u.id);
      const att = await getAttendanceScore(u.id);
      const computed = net * (kpi*0.5 + att*0.5);
      const depts = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—';
      return `<tr>
        <td>${u.displayName||u.email}</td>
        <td><code>${u.employeeId||'—'}</code></td>
        <td>${depts}</td>
        <td>₱${formatNum(u.salary)}</td>
        <td>₱${formatNum(u.allowance)}</td>
        <td>₱${formatNum(u.deductions)}</td>
        <td>₱${formatNum(net)}</td>
        <td>${Math.round(kpi*100)}%</td>
        <td>${Math.round(att*100)}%</td>
        <td><strong>₱${formatNum(computed)}</strong></td>
      </tr>`;
    }));
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const monthLabel = now.toLocaleString('en-PH',{month:'long',year:'numeric'});
    document.getElementById('pf-content').innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3>Team Payroll — ${monthLabel}</h3>
          <button class="btn-primary btn-sm" id="record-payroll-btn">Record Payroll</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Employee</th><th>ID</th><th>Dept</th><th>Base</th><th>Allowance</th><th>Deductions</th><th>Net Pay</th><th>KPI</th><th>Attendance</th><th>Computed</th></tr></thead>
            <tbody>${userRows.join('')}</tbody>
          </table>
        </div>
      </div>
    `;
    document.getElementById('record-payroll-btn')?.addEventListener('click', () => {
      openModal('Record Monthly Payroll', `
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">This records current salary data as a payroll entry for all employees for the selected month.</p>
        <div class="form-group"><label>Month</label><input id="pr-month" type="month" value="${defaultMonth}"/></div>
      `, `<button class="btn-primary" id="save-pr-btn">Record for All Employees</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-pr-btn').addEventListener('click', async () => {
        const month = document.getElementById('pr-month').value;
        if (!month) { Notifs.showToast('Select a month.','error'); return; }
        const batch = db.batch();
        const usersSnap2 = await db.collection('users').get();
        for (const doc of usersSnap2.docs) {
          const u2 = doc.data();
          const net2 = (u2.salary||0)+(u2.allowance||0)-(u2.deductions||0);
          const kpi2 = await getKpiScore(doc.id);
          const att2 = await getAttendanceScore(doc.id);
          const finalPay = net2 * (kpi2*0.5 + att2*0.5);
          const ref = db.collection('salary_history').doc(`${doc.id}_${month}`);
          batch.set(ref, {
            userId: doc.id, userName: u2.displayName||u2.email,
            month, salary: u2.salary||0, allowance: u2.allowance||0,
            deductions: u2.deductions||0, netPay: net2,
            kpiScore: kpi2, attScore: att2, finalPay,
            recordedBy: currentUser.uid, recordedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
        await batch.commit();
        closeModal();
        Notifs.showToast(`Payroll recorded for ${month}!`);
      });
    });
    return;
  }

  // Employee sees their own
  const u = userProfile;
  const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);
  const [kpi, att, cashAdvSnap, salaryHistSnap] = await Promise.all([
    getKpiScore(currentUser.uid),
    getAttendanceScore(currentUser.uid),
    db.collection('cash_advances').where('userId','==',currentUser.uid).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
    db.collection('salary_history').where('userId','==',currentUser.uid).orderBy('month','desc').limit(12).get().catch(()=>({docs:[]}))
  ]);
  const cashAdvances  = cashAdvSnap.docs.map(d=>({id:d.id,...d.data()}));
  const salaryHistory = salaryHistSnap.docs.map(d=>({id:d.id,...d.data()}));
  const totalAdvance  = cashAdvances.filter(a=>a.status==='approved').reduce((s,a)=>s+(a.amount||0),0);
  const computed      = net * (kpi*0.5 + att*0.5);

  // YTD calculation
  const thisYear = new Date().getFullYear().toString();
  const ytdPay   = salaryHistory.filter(h=>h.month?.startsWith(thisYear)).reduce((s,h)=>s+(h.netPay||0),0);

  const now = new Date();
  const monthLabel = now.toLocaleString('en-PH',{month:'long',year:'numeric'});

  const kpiColor = kpi>=0.8?'var(--success)':kpi>=0.6?'var(--warning)':'var(--danger)';
  const attColor = att>=0.85?'var(--success)':att>=0.6?'var(--warning)':'var(--danger)';

  c.innerHTML = `
    <div class="page-header">
      <h2>Personal Finance</h2>
      <button class="btn-primary btn-sm" id="req-advance-btn">+ Cash Advance</button>
    </div>

    <div class="kpi-row">
      <div class="kpi-card green">
        <div class="kpi-label">Net Pay / Month</div>
        <div class="kpi-value" style="font-size:16px">₱${formatNum(net)}</div>
        <div class="kpi-sub">YTD: ₱${formatNum(ytdPay)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Task KPI</div>
        <div class="kpi-value" style="color:${kpiColor}">${Math.round(kpi*100)}%</div>
        <div class="kpi-sub">70% weight</div>
      </div>
      <div class="kpi-card accent">
        <div class="kpi-label">Attendance</div>
        <div class="kpi-value" style="color:${attColor}">${Math.round(att*100)}%</div>
        <div class="kpi-sub">This month</div>
      </div>
      <div class="kpi-card ${computed<net*0.9?'red':'green'}">
        <div class="kpi-label">Computed Pay</div>
        <div class="kpi-value" style="font-size:16px">₱${formatNum(computed)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3>Payroll Summary — ${monthLabel}</h3></div>
      <div class="card-body">
        <div class="payslip-row"><span>Base Salary</span><strong>₱${formatNum(u.salary)}</strong></div>
        <div class="payslip-row"><span>Allowances</span><span style="color:var(--success)">+₱${formatNum(u.allowance)}</span></div>
        <div class="payslip-row"><span>Deductions</span><span style="color:var(--danger)">-₱${formatNum(u.deductions)}</span></div>
        <div class="payslip-row"><span>Net Pay</span><strong>₱${formatNum(net)}</strong></div>
        <div style="height:1px;background:var(--border);margin:10px 0"></div>
        <div class="payslip-row"><span>KPI Factor (${Math.round(kpi*100)}% tasks · 70%)</span><span style="color:${kpiColor}">${Math.round(kpi*70)}pts</span></div>
        <div class="payslip-row"><span>Attendance Factor (${Math.round(att*100)}% · 30%)</span><span style="color:${attColor}">${Math.round(att*30)}pts</span></div>
        <div class="payslip-row"><span>KPI×Attendance Multiplier</span><span>${(kpi*0.5+att*0.5).toFixed(2)}×</span></div>
        <div class="payslip-row" style="background:var(--surface2);border-radius:8px;padding:10px 14px;margin-top:8px">
          <span>Cash Advance Balance</span><span style="color:var(--danger)">-₱${formatNum(totalAdvance)}</span>
        </div>
        <div class="payslip-row" style="font-size:16px;font-weight:800;margin-top:8px;padding-top:8px;border-top:2px solid var(--border)">
          <span>Final Take-Home</span><span>₱${formatNum(Math.max(0,computed-totalAdvance))}</span>
        </div>
        <button class="btn-secondary" style="margin-top:14px;width:100%" onclick="printPayslip()">Generate Payslip PDF</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3>Salary History</h3></div>
      <div class="card-body" style="padding:0">
        ${!salaryHistory.length
          ? '<div class="empty-state" style="padding:20px"><p style="font-size:13px;color:var(--text-muted)">No history yet. Records are added monthly by admin.</p></div>'
          : `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Month</th><th>Base</th><th>Allowance</th><th>Deductions</th><th>Net Pay</th><th>KPI</th><th>Final</th></tr></thead>
              <tbody>${salaryHistory.map(h=>`<tr>
                <td>${h.month||'—'}</td>
                <td>₱${formatNum(h.salary)}</td>
                <td style="color:var(--success)">+₱${formatNum(h.allowance)}</td>
                <td style="color:var(--danger)">-₱${formatNum(h.deductions)}</td>
                <td>₱${formatNum(h.netPay)}</td>
                <td>${h.kpiScore?Math.round(h.kpiScore*100)+'%':'—'}</td>
                <td><strong>₱${formatNum(h.finalPay)}</strong></td>
              </tr>`).join('')}</tbody>
            </table></div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Cash Advances</h3>
        <span class="badge badge-orange">${cashAdvances.filter(a=>a.status==='pending').length} pending</span>
      </div>
      <div class="card-body" style="padding:0">
        ${!cashAdvances.length
          ? '<div class="empty-state" style="padding:20px"><p>No cash advances requested yet.</p></div>'
          : `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Date</th><th>Amount</th><th>Repay By</th><th>Reason</th><th>Status</th></tr></thead>
              <tbody>${cashAdvances.map(a=>`<tr>
                <td>${a.date||'—'}</td>
                <td>₱${formatNum(a.amount)}</td>
                <td>${a.repayDate||'—'}</td>
                <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.reason||'—'}</td>
                <td><span class="badge ${a.status==='approved'?'badge-green':a.status==='rejected'?'badge-red':'badge-orange'}">${a.status}</span></td>
              </tr>`).join('')}</tbody>
            </table></div>`}
      </div>
    </div>
  `;

  document.getElementById('req-advance-btn')?.addEventListener('click', () => {
    openModal('Request Cash Advance', `
      <div class="form-group"><label>Amount Needed (₱)</label><input id="ca-amount" type="number" step="100" placeholder="0.00" min="0"/></div>
      <div class="form-group"><label>Date Needed</label><input id="ca-date" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
      <div class="form-group"><label>Repayment Date</label><input id="ca-repay" type="date"/></div>
      <div class="form-group"><label>Reason / Purpose</label><textarea id="ca-reason" rows="3" placeholder="e.g., Medical emergency, family need…" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical"></textarea></div>
    `, `<button class="btn-primary" id="save-ca-btn">Submit Request</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-ca-btn').addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('ca-amount').value)||0;
      if (!amount) { Notifs.showToast('Enter an amount.', 'error'); return; }
      const name = userProfile.displayName || currentUser.email;
      await db.collection('cash_advances').add({
        userId: currentUser.uid, userName: name, employeeId: currentUser.uid,
        amount, date: document.getElementById('ca-date').value,
        repayDate: document.getElementById('ca-repay').value,
        reason: document.getElementById('ca-reason').value.trim(),
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await Notifs.sendToOwner({ title:'Cash Advance Request', body:`${name} requests ₱${formatNum(amount)} cash advance.`, icon:'💸', type:'cash_advance' });
      closeModal(); Notifs.showToast('Request submitted! Waiting for approval.');
      renderPersonalFinance(currentUser, currentRole);
    });
  });
};

async function getKpiScore(uid) {
  try {
    // Task completion score (70% weight)
    const taskSnap = await db.collection('tasks').where('assignedTo','==',uid).get();
    const tasks = taskSnap.docs.map(d=>d.data());
    const taskScore = tasks.length ? Math.min(1, tasks.filter(t=>t.status==='done').length / tasks.length) : 0.5;

    // Deliverable quality score (30% weight) — read from kpi_targets collection
    let delivScore = 0.5;
    try {
      const kpiDoc = await db.collection('kpi_targets').doc(uid).get();
      if (kpiDoc.exists) {
        const d = kpiDoc.data();
        delivScore = typeof d.deliverableScore === 'number' ? Math.min(1, d.deliverableScore / 100) : 0.5;
      }
    } catch {}

    return taskScore * 0.7 + delivScore * 0.3;
  } catch { return 0.5; }
}

async function getAttendanceScore(uid) {
  try {
    const now = new Date();
    // Only count current month records
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const days = 22; // avg work days in a month
    const snap = await db.collection('attendance').doc(uid).collection('records')
      .where(firebase.firestore.FieldPath.documentId(), '>=', monthStart).get();
    const records = snap.docs.map(d=>d.data());
    const fullDays = records.filter(r=>r.fullTime).length;
    const halfDays = records.filter(r=>r.loginTime&&!r.fullTime).length;
    return Math.min(1, (fullDays + halfDays*0.5) / days);
  } catch { return 0.5; }
}

function printPayslip() {
  const u = userProfile;
  const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);
  const w = window.open('','_blank');
  w.document.write(`<html><head><title>Payslip — ${u.displayName}</title>
  <style>body{font-family:sans-serif;padding:40px;color:#1a1d2e}.logo{font-size:22px;font-weight:800;color:#1a237e}table{width:100%;border-collapse:collapse;margin:16px 0}td{padding:8px 12px;border-bottom:1px solid #eee}.total{font-weight:bold;font-size:16px;background:#f0f2f8}.footer{margin-top:30px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:10px}</style>
  </head><body>
  <div class="logo">Barro Industries</div>
  <h3 style="margin:4px 0">Payslip — ${new Date().toLocaleDateString('en-PH',{month:'long',year:'numeric'})}</h3>
  <p>Employee: <strong>${u.displayName}</strong> &nbsp; ID: <strong>${u.employeeId||'—'}</strong></p>
  <table>
    <tr><td>Base Salary</td><td style="text-align:right">₱${formatNum(u.salary)}</td></tr>
    <tr><td>Allowances</td><td style="text-align:right;color:green">+₱${formatNum(u.allowance)}</td></tr>
    <tr><td>Deductions</td><td style="text-align:right;color:red">-₱${formatNum(u.deductions)}</td></tr>
    <tr class="total"><td><strong>Net Pay</strong></td><td style="text-align:right"><strong>₱${formatNum(net)}</strong></td></tr>
  </table>
  <div class="footer">Generated: ${new Date().toLocaleString('en-PH')} · Barro Industries</div>
  <script>window.print();<\/script></body></html>`);
}

// ── Progress Reports ──────────────────────────────
async function renderProgressReports() {
  if (!isPresident() && currentRole !== 'manager') {
    document.getElementById('page-content').innerHTML = renderAccessDenied('Progress Reports');
    return;
  }
  const c = document.getElementById('page-content');
  c.innerHTML = '<div class="loading-placeholder">Loading progress reports…</div>';
  try {
    const safeGet = async (q) => { try { return await q.get(); } catch(e) { return {docs:[],size:0}; } };
    const [usersSnap, tasksSnap, attSnap] = await Promise.all([
      safeGet(db.collection('users')),
      safeGet(db.collection('tasks')),
      safeGet(db.collection('attendance'))
    ]);
    const users = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const tasks = tasksSnap.docs.map(d=>d.data());

    // Group by dept
    const deptMap = {};
    users.forEach(u => {
      const depts = Array.isArray(u.departments)&&u.departments.length ? u.departments : u.department ? [u.department] : ['Unassigned'];
      depts.forEach(dept => {
        if (!deptMap[dept]) deptMap[dept] = { members:[], tasks:[] };
        deptMap[dept].members.push(u);
      });
    });
    tasks.forEach(t => { if (t.department && deptMap[t.department]) deptMap[t.department].tasks.push(t); });

    // Current month filter
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const monthLabel = now.toLocaleString('en-PH',{month:'long',year:'numeric'});
    const monthTasks = tasks.filter(t => {
      const ts = t.createdAt?.seconds ? new Date(t.createdAt.seconds*1000) : null;
      return ts && `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}` === monthStr;
    });

    c.innerHTML = `
      <div class="page-header"><h2>📈 Progress Reports & KPIs</h2><span class="badge badge-blue">${monthLabel}</span></div>
      <div class="kpi-row">
        <div class="kpi-card accent"><div class="kpi-label">All Tasks (Total)</div><div class="kpi-value">${tasks.length}</div><div class="kpi-sub">${tasks.filter(t=>t.status==='done').length} done</div></div>
        <div class="kpi-card green"><div class="kpi-label">This Month Tasks</div><div class="kpi-value">${monthTasks.length}</div><div class="kpi-sub">${monthTasks.filter(t=>t.status==='done').length} done</div></div>
        <div class="kpi-card"><div class="kpi-label">Overall KPI</div><div class="kpi-value">${tasks.length?Math.round(tasks.filter(t=>t.status==='done').length/tasks.length*100):0}%</div></div>
      </div>
    `;
    Object.entries(deptMap).forEach(([dept, data]) => {
      const cfg = DEPARTMENTS[dept]||{icon:'🗂️',color:'var(--primary-light)'};
      const total = data.tasks.length;
      const done  = data.tasks.filter(t=>t.status==='done').length;
      const pct   = total ? Math.round(done/total*100) : 0;
      // month-only stats for this dept
      const mTasks = data.tasks.filter(t => {
        const ts = t.createdAt?.seconds ? new Date(t.createdAt.seconds*1000) : null;
        return ts && `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}` === monthStr;
      });
      const mDone = mTasks.filter(t=>t.status==='done').length;
      const mPct  = mTasks.length ? Math.round(mDone/mTasks.length*100) : 0;
      c.innerHTML += `
        <div class="card" style="margin-bottom:12px">
          <div class="card-header" style="border-left:4px solid ${cfg.color}">
            <h3>${cfg.icon} ${dept}</h3>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="badge ${mPct>=80?'badge-green':mPct>=50?'badge-orange':'badge-red'}" title="This month KPI">📅 ${mPct}%</span>
              <span class="badge ${pct>=80?'badge-green':pct>=50?'badge-orange':'badge-red'}" title="All-time KPI">Overall ${pct}%</span>
            </div>
          </div>
          <div class="card-body">
            <div class="progress-bar-wrap" style="margin-bottom:8px"><div class="progress-bar-fill" style="width:${pct}%;background:${cfg.color}"></div></div>
            <div style="display:flex;gap:20px;font-size:12px;color:var(--text-muted);margin-bottom:12px">
              <span>👥 ${data.members.length} members</span>
              <span>✅ ${done}/${total} tasks done (all time)</span>
              <span>📅 ${mDone}/${mTasks.length} done this month</span>
            </div>
            <div class="subtab-bar" style="margin-bottom:8px">
              <button class="subtab-btn active" data-dt="${dept}-tasks">All Tasks</button>
              <button class="subtab-btn" data-dt="${dept}-members">By Member</button>
            </div>
            <div id="prog-${dept.replace(/\s+/g,'_')}-content">
              <div class="table-wrap"><table class="data-table">
                <thead><tr><th>Task</th><th>Assigned To</th><th>Status</th><th>Due</th></tr></thead>
                <tbody>
                  ${data.tasks.slice(0,10).map(t=>`<tr>
                    <td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.title}</td>
                    <td style="font-size:12px">${t.assignedToName||'—'}</td>
                    <td><span class="badge ${t.status==='done'?'badge-green':'badge-blue'}">${t.status||'open'}</span></td>
                    <td style="font-size:11px;color:var(--text-muted)">${t.dueDate||'—'}</td>
                  </tr>`).join('')}
                  ${data.tasks.length>10?`<tr><td colspan="4" style="font-size:12px;color:var(--text-muted);text-align:center">+ ${data.tasks.length-10} more tasks</td></tr>`:''}
                </tbody>
              </table></div>
            </div>
            <div id="prog-${dept.replace(/\s+/g,'_')}-members" style="display:none">
              <div class="table-wrap"><table class="data-table">
                <thead><tr><th>Member</th><th>All Tasks Done</th><th>This Month</th><th>KPI</th></tr></thead>
                <tbody>
                  ${data.members.map(u=>{
                    const uDone  = tasks.filter(t=>t.assignedTo===u.id&&t.status==='done').length;
                    const uTotal = tasks.filter(t=>t.assignedTo===u.id).length;
                    const uMDone = monthTasks.filter(t=>t.assignedTo===u.id&&t.status==='done').length;
                    const uMTotal= monthTasks.filter(t=>t.assignedTo===u.id).length;
                    const uPct   = uTotal ? Math.round(uDone/uTotal*100) : 0;
                    return `<tr>
                      <td>${u.displayName||u.email}</td>
                      <td>${uDone}/${uTotal}</td>
                      <td>${uMDone}/${uMTotal}</td>
                      <td><span class="badge ${uPct>=80?'badge-green':uPct>=50?'badge-orange':'badge-red'}">${uPct}%</span></td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table></div>
            </div>
          </div>
        </div>`;
    });

    // Wire up subtab toggles inside progress cards
    c.querySelectorAll('[data-dt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key  = btn.dataset.dt;
        const dept = key.replace(/-tasks$|-members$/,'');
        const deptId = dept.replace(/\s+/g,'_');
        const isTask = key.endsWith('-tasks');
        btn.closest('.card').querySelectorAll('.subtab-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`prog-${deptId}-content`).style.display = isTask  ? '' : 'none';
        document.getElementById(`prog-${deptId}-members`).style.display = isTask  ? 'none' : '';
      });
    });
  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>${err.message}</h4></div>`;
  }
}

// ── Company ───────────────────────────────────────
async function renderCompany() {
  const c = document.getElementById('page-content');
  const canAdd = isPresident();
  c.innerHTML = `
    <div class="page-header"><h2>🏢 Company</h2>${canAdd?`<button class="btn-primary btn-sm" id="add-policy-btn">+ Add Policy</button>`:''}</div>
    <div class="policy-grid" id="policy-grid"><div class="loading-placeholder">Loading…</div></div>
  `;
  const snap = await db.collection('policies').orderBy('createdAt','desc').get();
  const policies = snap.docs.map(d=>({id:d.id,...d.data()}));
  const grid = document.getElementById('policy-grid');
  if (!policies.length) { grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📄</div><h4>No policies yet</h4></div>`; return; }
  grid.innerHTML = policies.map(p=>`
    <div class="policy-card" data-id="${p.id}">
      <div class="policy-icon">${p.icon||'📄'}</div>
      <div class="policy-title">${p.title}</div>
      <div class="policy-desc">${p.description||''}</div>
      ${p.fileUrl?`<a href="${p.fileUrl}" target="_blank" class="btn-link" style="font-size:12px;margin-top:6px;display:block">📎 View Document</a>`:''}
    </div>`).join('');
  grid.querySelectorAll('.policy-card').forEach(card=>{
    card.addEventListener('click',e=>{
      if(e.target.tagName==='A') return;
      const p=policies.find(x=>x.id===card.dataset.id);
      openModal(p.title,`<p style="font-size:14px;line-height:1.7;white-space:pre-wrap">${p.content||'No content.'}</p>${p.fileUrl?`<a href="${p.fileUrl}" target="_blank" class="btn-secondary" style="display:inline-block;margin-top:14px">📎 Open File</a>`:''}${canAdd?`<hr class="divider"/><button class="btn-danger" id="del-policy-btn" data-id="${p.id}">Delete</button>`:''}`);
      document.getElementById('del-policy-btn')?.addEventListener('click',async e2=>{if(confirm('Delete?')){await db.collection('policies').doc(e2.currentTarget.dataset.id).delete();closeModal();renderCompany();}});
    });
  });
  document.getElementById('add-policy-btn')?.addEventListener('click',()=>{
    openModal('Add Policy',`
      <div class="form-group"><label>Title</label><input id="pol-title"/></div>
      <div class="form-group"><label>Icon</label><input id="pol-icon" placeholder="📄" maxlength="4"/></div>
      <div class="form-group"><label>Description</label><input id="pol-desc"/></div>
      <div class="form-group"><label>Content</label><textarea id="pol-content" rows="6"></textarea></div>
      <div id="pol-file-upload"></div>
    `,`<button class="btn-primary" id="save-pol-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let uploadedFile=null;
    Drive.renderUploadArea('pol-file-upload',r=>{uploadedFile=r;},{label:'Attach document',dept:'Admin',subfolder:'Policies'});
    document.getElementById('save-pol-btn').addEventListener('click',async()=>{
      await db.collection('policies').add({title:document.getElementById('pol-title').value.trim(),icon:document.getElementById('pol-icon').value.trim()||'📄',description:document.getElementById('pol-desc').value.trim(),content:document.getElementById('pol-content').value,fileUrl:uploadedFile?.url||null,addedBy:currentUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal();renderCompany();
    });
  });
}

// ── Departments ───────────────────────────────────
async function renderDepartments() {
  if (!isPresident()&&currentRole!=='manager') { document.getElementById('page-content').innerHTML=renderAccessDenied('Departments'); return; }
  const c=document.getElementById('page-content');
  c.innerHTML=`<div class="page-header"><h2>🗂️ Departments</h2><button class="btn-primary btn-sm" id="add-dept-btn">+ Add</button></div><div class="dept-grid" id="dept-grid"><div class="loading-placeholder">Loading…</div></div>`;
  const snap=await db.collection('departments').get();
  const depts=snap.docs.map(d=>({id:d.id,...d.data()}));
  const grid=document.getElementById('dept-grid');
  if(!depts.length){grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🗂️</div><h4>No departments yet</h4></div>`;return;}
  grid.innerHTML=depts.map(d=>{const cfg=DEPARTMENTS[d.name]||{};return `<div class="dept-card" style="border-top-color:${cfg.color||'var(--primary-light)'}"><div class="dept-name">${cfg.icon||'🗂️'} ${d.name}</div><div class="dept-head">Head: ${d.head||'Unassigned'}</div><div class="dept-members">${(d.members||[]).map(m=>`<div class="member-chip">👤 ${m}</div>`).join('')||'<span class="text-muted">No members</span>'}</div></div>`;}).join('');
  document.getElementById('add-dept-btn')?.addEventListener('click',()=>{
    openModal('Add Department',`
      <div class="form-group"><label>Name</label><select id="dept-name-sel"><option value="">-- Select --</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}<option value="custom">Custom…</option></select></div>
      <div class="form-group hidden" id="dept-custom-wrap"><label>Custom Name</label><input id="dept-custom-name"/></div>
      <div class="form-group"><label>Department Head</label><input id="dept-head"/></div>
      <div class="form-group"><label>Members (comma-separated)</label><textarea id="dept-members" rows="3"></textarea></div>
    `,`<button class="btn-primary" id="save-dept-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('dept-name-sel').onchange=function(){document.getElementById('dept-custom-wrap').classList.toggle('hidden',this.value!=='custom');};
    document.getElementById('save-dept-btn').addEventListener('click',async()=>{
      const sel=document.getElementById('dept-name-sel').value;
      const name=sel==='custom'?document.getElementById('dept-custom-name').value.trim():sel;
      if(!name) return;
      const members=document.getElementById('dept-members').value.split(',').map(s=>s.trim()).filter(Boolean);
      await db.collection('departments').add({name,head:document.getElementById('dept-head').value.trim(),members,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal();renderDepartments();
    });
  });
}

// ── Analytics ─────────────────────────────────────
async function renderAnalytics() {
  if(!isPresident()&&currentRole!=='manager'){document.getElementById('page-content').innerHTML=renderAccessDenied('Analytics');return;}
  const c=document.getElementById('page-content');
  c.innerHTML='<div class="loading-placeholder">Loading analytics…</div>';
  const safeGet = async (q) => { try { return await q.get(); } catch(e) { return {docs:[],size:0}; } };
  const [usersSnap,tasksSnap,quotesSnap,subsSnap,expSnap]=await Promise.all([safeGet(db.collection('users')),safeGet(db.collection('tasks')),safeGet(db.collection('quotes')),safeGet(db.collection('submissions')),safeGet(db.collection('expenses'))]);
  const users=usersSnap.docs.map(d=>({id:d.id,...d.data()}));
  const tasks=tasksSnap.docs.map(d=>d.data());
  const quotes=quotesSnap.docs.map(d=>d.data());
  const subs=subsSnap.docs.map(d=>d.data());
  const expenses=expSnap.docs.map(d=>d.data());
  const totalPayroll=users.reduce((s,u)=>s+(u.salary||0)+(u.allowance||0)-(u.deductions||0),0);
  const won=quotes.filter(q=>q.status==='accepted').reduce((s,q)=>s+(q.total||0),0);
  const totalExp=expenses.filter(e=>e.status==='approved').reduce((s,e)=>s+(e.amount||0),0);
  c.innerHTML=`
    <div class="page-header"><h2>📊 Analytics & Performance</h2></div>
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Team Size</div><div class="kpi-value">${users.length}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Monthly Payroll</div><div class="kpi-value">₱${formatNum(totalPayroll)}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Revenue Won</div><div class="kpi-value">₱${formatNum(won)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Approved Expenses</div><div class="kpi-value">₱${formatNum(totalExp)}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="card"><div class="card-header"><h3>Quote Status</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="q-chart"></canvas></div></div></div>
      <div class="card"><div class="card-header"><h3>Submissions</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="s-chart"></canvas></div></div></div>
    </div>
    <div class="card"><div class="card-header"><h3>Team Performance</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table">
      <thead><tr><th>Name</th><th>Role</th><th>Dept</th><th>Tasks Done</th><th>Net Pay</th></tr></thead>
      <tbody>${users.map(u=>{const done=tasks.filter(t=>t.assignedTo===u.id&&t.status==='done').length;const net=(u.salary||0)+(u.allowance||0)-(u.deductions||0);return `<tr><td>${u.displayName||u.email}</td><td><span class="badge badge-blue">${ROLES[u.role]?.label||u.role}</span></td><td>${(Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—'}</td><td>${done}</td><td>₱${formatNum(net)}</td></tr>`;}).join('')}</tbody>
    </table></div></div></div>
  `;
  new Chart(document.getElementById('q-chart'),{type:'bar',data:{labels:['Draft','Sent','Accepted','Rejected'],datasets:[{data:['draft','sent','accepted','rejected'].map(s=>quotes.filter(q=>q.status===s).length),backgroundColor:['#9e9e9e','#1565c0','#2e7d32','#c62828']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}});
  new Chart(document.getElementById('s-chart'),{type:'pie',data:{labels:['Pending','Approved','Rejected'],datasets:[{data:[subs.filter(s=>!s.status||s.status==='pending').length,subs.filter(s=>s.status==='approved').length,subs.filter(s=>s.status==='rejected').length],backgroundColor:['#f57f17','#2e7d32','#c62828']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});
}

// ── Team / Payroll ────────────────────────────────
async function renderTeam() {
  if(!isPresident()&&currentRole!=='manager'){document.getElementById('page-content').innerHTML=renderAccessDenied('Team');return;}
  const c=document.getElementById('page-content');
  c.innerHTML=`<div class="page-header"><h2>👥 Team & Payroll</h2><button class="btn-primary btn-sm" id="add-emp-btn">+ Add Employee</button></div><div id="team-table"><div class="loading-placeholder">Loading…</div></div>`;
  const snap=await db.collection('users').get();
  const users=snap.docs.map(d=>({id:d.id,...d.data()}));
  document.getElementById('team-table').innerHTML=`<div class="card"><div class="table-wrap"><table class="data-table">
    <thead><tr><th>Employee</th><th>ID</th><th>Role</th><th>Departments</th><th>Base</th><th>Allowance</th><th>Deductions</th><th>Net</th><th></th></tr></thead>
    <tbody>${users.map(u=>{const net=(u.salary||0)+(u.allowance||0)-(u.deductions||0);const depts=(Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—';return `<tr><td>${u.displayName||u.email}</td><td><code style="font-size:11px">${u.employeeId||'—'}</code></td><td><span class="badge badge-blue">${ROLES[u.role]?.label||u.role}</span></td><td>${depts}</td><td>₱${formatNum(u.salary)}</td><td>₱${formatNum(u.allowance)}</td><td>₱${formatNum(u.deductions)}</td><td><strong>₱${formatNum(net)}</strong></td><td><button class="btn-icon edit-emp-btn" data-uid="${u.id}"><i data-lucide="pencil" style="width:14px;height:14px;stroke:currentColor"></i></button></td></tr>`;}).join('')}</tbody>
  </table></div></div>`;
  document.querySelectorAll('.edit-emp-btn').forEach(btn=>btn.addEventListener('click',()=>{const u=users.find(x=>x.id===btn.dataset.uid);if(u)openEditEmployeeModal(u);}));
  document.getElementById('add-emp-btn').addEventListener('click',openAddEmployeeModal);
  if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('team-table')] });
}

function openAddEmployeeModal() {
  openModal('Add Employee',`
    <p style="font-size:12px;color:var(--text-muted);background:var(--surface2);padding:10px;border-radius:8px;margin-bottom:14px">⚠️ Create their login in Firebase Console → Authentication first, then add profile here.</p>
    <div class="form-group"><label>Display Name</label><input id="emp-name"/></div>
    <div class="form-group"><label>Email</label><input id="emp-email" type="email"/></div>
    <div class="form-group"><label>Employee ID</label><input id="emp-eid" placeholder="e.g. BI-2026-001"/></div>
    <div class="form-row">
      <div class="form-group"><label>Role</label><select id="emp-role">${Object.entries(ROLES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></div>
      <div class="form-group"><label>Primary Dept</label><select id="emp-dept"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Secondary Dept (if dual)</label><select id="emp-dept2"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}</select></div>
    <div class="form-group"><label>Job Title</label><input id="emp-title"/></div>
    <div class="form-row">
      <div class="form-group"><label>Base Salary (₱)</label><input id="emp-salary" type="number" value="0"/></div>
      <div class="form-group"><label>Allowance (₱)</label><input id="emp-allow" type="number" value="0"/></div>
    </div>
    <div class="form-group"><label>Deductions (₱)</label><input id="emp-deduct" type="number" value="0"/></div>
    <div class="form-group"><label>Start Date</label><input id="emp-start" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
  `,`<button class="btn-primary" id="save-emp-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  document.getElementById('save-emp-btn').addEventListener('click',async()=>{
    const dept1=document.getElementById('emp-dept').value;
    const dept2=document.getElementById('emp-dept2').value;
    const depts=[dept1,dept2].filter(Boolean);
    await db.collection('users').add({
      displayName:document.getElementById('emp-name').value.trim(),
      email:document.getElementById('emp-email').value.trim(),
      employeeId:document.getElementById('emp-eid').value.trim(),
      role:document.getElementById('emp-role').value,
      departments:depts, department:depts[0]||'',
      title:document.getElementById('emp-title').value.trim(),
      salary:parseFloat(document.getElementById('emp-salary').value)||0,
      allowance:parseFloat(document.getElementById('emp-allow').value)||0,
      deductions:parseFloat(document.getElementById('emp-deduct').value)||0,
      startDate:document.getElementById('emp-start').value,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    closeModal();renderTeam();
  });
}

function openEditEmployeeModal(u) {
  const curDepts = Array.isArray(u.departments)&&u.departments.length ? u.departments : u.department ? [u.department] : [];
  openModal(`Edit: ${u.displayName||u.email}`,`
    <div class="form-group"><label>Display Name</label><input id="eu-name" value="${u.displayName||''}"/></div>
    <div class="form-group"><label>Employee ID</label><input id="eu-eid" value="${u.employeeId||''}"/></div>
    <div class="form-group"><label>Job Title</label><input id="eu-title" value="${u.title||''}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Role</label><select id="eu-role">${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${u.role===k?'selected':''}>${v.label}</option>`).join('')}</select></div>
      <div class="form-group"><label>Primary Dept</label><select id="eu-dept"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}" ${curDepts[0]===k?'selected':''}>${k}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Secondary Dept</label><select id="eu-dept2"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}" ${curDepts[1]===k?'selected':''}>${k}</option>`).join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Base Salary (₱)</label><input id="eu-salary" type="number" value="${u.salary||0}"/></div>
      <div class="form-group"><label>Allowance (₱)</label><input id="eu-allow" type="number" value="${u.allowance||0}"/></div>
    </div>
    <div class="form-group"><label>Deductions (₱)</label><input id="eu-deduct" type="number" value="${u.deductions||0}"/></div>
  `,`<button class="btn-primary" id="save-eu-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  document.getElementById('save-eu-btn').addEventListener('click',async()=>{
    const dept1=document.getElementById('eu-dept').value;
    const dept2=document.getElementById('eu-dept2').value;
    const depts=[dept1,dept2].filter(Boolean);
    await db.collection('users').doc(u.id).update({
      displayName:document.getElementById('eu-name').value.trim(),
      employeeId:document.getElementById('eu-eid').value.trim(),
      title:document.getElementById('eu-title').value.trim(),
      role:document.getElementById('eu-role').value,
      departments:depts, department:depts[0]||'',
      salary:parseFloat(document.getElementById('eu-salary').value)||0,
      allowance:parseFloat(document.getElementById('eu-allow').value)||0,
      deductions:parseFloat(document.getElementById('eu-deduct').value)||0,
    });
    closeModal();renderTeam();
  });
}

// ── Profile Drawer ────────────────────────────────
function openProfileDrawer() {
  const drawer=document.getElementById('profile-drawer');
  const overlay=document.getElementById('drawer-overlay');
  const body=document.getElementById('profile-body');
  const u=userProfile;
  const net=(u.salary||0)+(u.allowance||0)-(u.deductions||0);
  const depts=(Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'Unassigned';
  body.innerHTML=`
    <div style="text-align:center;margin-bottom:20px">
      <div id="profile-photo-wrap" style="width:80px;height:80px;border-radius:50%;overflow:hidden;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#fff;cursor:pointer;margin:0 auto 10px">
        ${u.photoUrl?`<img src="${u.photoUrl}" style="width:100%;height:100%;object-fit:cover"/>`:(u.displayName||'?')[0].toUpperCase()}
      </div>
      <p style="font-size:11px;color:var(--text-muted)">Click photo to change</p>
    </div>
    <div class="form-group"><label>Display Name</label>
      <div style="display:flex;gap:8px"><input id="profile-name" value="${u.displayName||''}" style="flex:1;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px"/>
      <button class="btn-primary btn-sm" id="save-name-btn">Save</button></div>
    </div>
    <div class="form-group"><label>Email</label><input value="${u.email||''}" disabled style="background:var(--surface2);padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;width:100%"/></div>
    <div class="form-group"><label>Employee ID</label><input value="${u.employeeId||'—'}" disabled style="background:var(--surface2);padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;width:100%;font-family:monospace"/></div>
    <div class="form-group"><label>Role</label><input value="${ROLES[u.role]?.label||u.role}" disabled style="background:var(--surface2);padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;width:100%"/></div>
    <div class="form-group"><label>Departments</label><input value="${depts}" disabled style="background:var(--surface2);padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;width:100%"/></div>
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
  setTimeout(()=>drawer.classList.add('open'),10);
  overlay.classList.remove('hidden'); overlay.classList.add('active');
  if (window.lucide) lucide.createIcons({ nodes: [drawer] });
  document.getElementById('profile-photo-wrap').addEventListener('click',()=>{
    const input=document.createElement('input'); input.type='file'; input.accept='image/*';
    input.onchange=async e=>{const file=e.target.files[0];if(!file)return;Notifs.showToast('Uploading…');try{const url=await Drive.uploadProfilePhoto(file,currentUser.uid);await db.collection('users').doc(currentUser.uid).update({photoUrl:url});userProfile.photoUrl=url;applyUserUI();document.getElementById('profile-photo-wrap').innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover"/>`;Notifs.showToast('Photo updated!');}catch(err){Notifs.showToast('Upload failed','error');}};
    input.click();
  });
  document.getElementById('save-name-btn').addEventListener('click',async()=>{const name=document.getElementById('profile-name').value.trim();if(!name)return;await db.collection('users').doc(currentUser.uid).update({displayName:name});userProfile.displayName=name;applyUserUI();Notifs.showToast('Name updated!');});
  document.getElementById('profile-close').onclick=closeProfileDrawer;
  overlay.addEventListener('click',closeProfileDrawer);
}

function closeProfileDrawer() {
  const drawer=document.getElementById('profile-drawer');
  const overlay=document.getElementById('drawer-overlay');
  drawer.classList.remove('open');
  overlay.classList.remove('active'); overlay.classList.add('hidden');
  setTimeout(()=>drawer.classList.add('hidden'),300);
}

// ── Modal ─────────────────────────────────────────
window.openModal=function(title,bodyHTML,footerHTML=''){
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-body').innerHTML=bodyHTML;
  const footer=document.getElementById('modal-footer');
  footer.innerHTML=footerHTML;
  footer.classList.toggle('hidden',!footerHTML);
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.add('active');
};
window.closeModal=function(){
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('active');
};
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('modal-close')?.addEventListener('click',closeModal);
  document.getElementById('modal-overlay')?.addEventListener('click',e=>{if(e.target===document.getElementById('modal-overlay'))closeModal();});
});

// ── Mini Calendar ─────────────────────────────────
function renderMiniCal() {
  const el=document.getElementById('mini-cal'); if(!el) return;
  const now=new Date();const year=now.getFullYear();const month=now.getMonth();
  const firstDay=new Date(year,month,1).getDay();const days=new Date(year,month+1,0).getDate();
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  el.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-weight:700;font-size:14px"><span>${months[month]} ${year}</span></div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">
      ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<div style="font-size:10px;font-weight:700;color:var(--text-muted);padding:4px">${d}</div>`).join('')}
      ${Array(firstDay).fill('<div></div>').join('')}
      ${Array.from({length:days},(_,i)=>{const day=i+1;const isToday=day===now.getDate();return `<div style="padding:5px 2px;border-radius:50%;font-size:12px;${isToday?'background:var(--primary);color:#fff;font-weight:700':''}">${day}</div>`;}).join('')}
    </div>`;
}

// ── Helpers ───────────────────────────────────────
function renderAccessDenied(section) {
  return `<div class="access-denied"><div class="ad-icon">🔒</div><h3>Access Restricted</h3><p>You don't have access to ${section}.</p></div>`;
}
function formatNum(n) { return Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ── Service Worker ────────────────────────────────
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);
