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
      checkPayrollDuties(user);
      buildNav();
      navigateTo('dashboard');
      startAutoLogout();
      startPresenceHeartbeat(user.uid);
    } else {
      showLogin();
    }
  });
});

// ── Presence Heartbeat ────────────────────────────
let _presenceInterval = null;
function startPresenceHeartbeat(uid) {
  if (_presenceInterval) clearInterval(_presenceInterval);
  const ping = () => db.collection('users').doc(uid).update({ lastSeen: firebase.firestore.FieldValue.serverTimestamp() }).catch(()=>{});
  ping();
  _presenceInterval = setInterval(ping, 60000); // every 60s
}

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

// ── Payroll Duties Check ─────────────────────────
// Called on every login. If it's the 1st-3rd of the month and employee hasn't
// done their self-assessment for this month, send them a reminder notification.
async function checkPayrollDuties(user) {
  try {
    const uDoc = await db.collection('users').doc(user.uid).get();
    if (!uDoc.exists) return;
    const role = uDoc.data().role;
    if (role === 'president' || role === 'owner' || role === 'partner') return;

    const now = new Date();
    const day = now.getDate();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    // Remind on 1st–7th of the month (payroll window)
    if (day > 7) return;

    const evalDoc = await db.collection('kpi_evals').doc(user.uid).get().catch(()=>null);
    const selfAssessMonth = evalDoc?.exists ? evalDoc.data().selfAssessMonth : null;
    if (selfAssessMonth === currentMonth) return; // already done

    const monthLabel = now.toLocaleString('en-PH',{month:'long',year:'numeric'});
    await Notifs.send(user.uid, {
      title: '📋 Self-Assessment Required',
      body: `Please complete your self-assessment for ${monthLabel}. Go to Personal Finance → Self Evaluate.`,
      icon: '📋', type: 'payroll_reminder'
    });
  } catch(e) { console.warn('[checkPayrollDuties]', e); }
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
  // Reset any iOS zoom that happened during login input
  _resetViewportZoom();
}

function _resetViewportZoom() {
  // Briefly force initial-scale=1 to snap iOS back to normal zoom,
  // then restore the original viewport (which allows user pinch-zoom).
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.content;
  meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover';
  setTimeout(() => { meta.content = original; }, 300);
}

// ── User Profile ──────────────────────────────────
async function loadUserProfile(user) {
  try {
    let snap = await db.collection('users').doc(user.uid).get();
    if (!snap.exists) {
      const empCount = (await dbCachedGet('users', () => db.collection('users').get(), 60000)).size;
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
  // Pre-fill saved email
  const savedEmail = localStorage.getItem('bi-saved-email');
  if (savedEmail) {
    document.getElementById('email').value = savedEmail;
    document.getElementById('remember-me').checked = true;
  }
  // Pre-fill saved guest name
  const savedGuest = localStorage.getItem('bi-guest-name');
  if (savedGuest) {
    document.getElementById('guest-name').value = savedGuest;
    document.getElementById('guest-save-name').checked = true;
  }

  // Role picker cards (admin / employee / partner)
  document.querySelectorAll('.login-role-card[data-type]').forEach(card => {
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

  // Sign Up button
  document.getElementById('signup-btn')?.addEventListener('click', () => {
    document.getElementById('login-role-picker').classList.add('hidden');
    const sfw = document.getElementById('signup-form-wrap');
    sfw.classList.remove('hidden');
    document.getElementById('signup-name').focus();
    if (window.lucide) lucide.createIcons({ nodes: [sfw] });
  });

  // Sign Up back
  document.getElementById('signup-back-btn')?.addEventListener('click', () => {
    document.getElementById('signup-form-wrap').classList.add('hidden');
    document.getElementById('login-role-picker').classList.remove('hidden');
    document.getElementById('signup-error').classList.add('hidden');
    document.getElementById('signup-success').classList.add('hidden');
  });

  // Sign Up submit
  document.getElementById('signup-submit-btn')?.addEventListener('click', async () => {
    const name  = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const phone = document.getElementById('signup-phone').value.trim();
    const errEl = document.getElementById('signup-error');
    errEl.classList.add('hidden');
    if (!name)  { errEl.textContent = 'Full name is required.'; errEl.classList.remove('hidden'); return; }
    if (!email) { errEl.textContent = 'Email address is required.'; errEl.classList.remove('hidden'); return; }
    if (!phone) { errEl.textContent = 'Phone number is required.'; errEl.classList.remove('hidden'); return; }
    document.getElementById('signup-btn-text').textContent = 'Submitting…';
    document.getElementById('signup-spinner').classList.remove('hidden');
    document.getElementById('signup-submit-btn').disabled = true;
    try {
      await db.collection('signup_requests').add({
        fullName: name, email, phone,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      document.getElementById('signup-success').classList.remove('hidden');
      document.getElementById('signup-name').value = '';
      document.getElementById('signup-email').value = '';
      document.getElementById('signup-phone').value = '';
    } catch(e) {
      errEl.textContent = 'Submission failed. Check your connection.';
      errEl.classList.remove('hidden');
    }
    document.getElementById('signup-btn-text').textContent = 'Submit Application';
    document.getElementById('signup-spinner').classList.add('hidden');
    document.getElementById('signup-submit-btn').disabled = false;
  });

  // Back button (regular login)
  document.getElementById('login-back-btn')?.addEventListener('click', () => {
    document.getElementById('login-form-wrap').classList.add('hidden');
    document.getElementById('login-role-picker').classList.remove('hidden');
    clearLoginError();
    document.getElementById('password').value = '';
  });

  document.getElementById('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    setLoginLoading(true); clearLoginError();
    try {
      let input = document.getElementById('email').value.trim();
      let emailToUse = input;

      // Username login: no @ means it's a username, look up their auth email
      if (!input.includes('@')) {
        const snap = await db.collection('users')
          .where('username', '==', input.toLowerCase())
          .limit(1).get();
        if (snap.empty) {
          showLoginError('No account found with that username. Contact HR.');
          setLoginLoading(false); return;
        }
        const uData = snap.docs[0].data();
        emailToUse = uData.authEmail || uData.email;
        if (!emailToUse) {
          showLoginError('Account not configured. Contact HR.');
          setLoginLoading(false); return;
        }
      }

      await auth.signInWithEmailAndPassword(emailToUse, document.getElementById('password').value);
      if (document.getElementById('remember-me').checked) {
        localStorage.setItem('bi-saved-email', input);
      } else {
        localStorage.removeItem('bi-saved-email');
      }
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
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    Notifs.stopListener(); auth.signOut();
  });
  if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('login-screen')] });
}

// ── Password Generator ────────────────────────────
function generatePassword(fullName) {
  const parts  = fullName.trim().split(/\s+/);
  const base   = parts[parts.length - 1] || parts[0]; // last name preferred
  const digits = String(Math.floor(Math.random() * 900) + 100); // 3 digits
  const syms   = ['!', '@', '#', '$', '%', '&'];
  const sym    = syms[Math.floor(Math.random() * syms.length)];
  return base + digits + sym;
}
function setLoginLoading(on) {
  document.getElementById('login-btn-text').textContent = on ? 'Signing in…' : 'Sign In';
  document.getElementById('login-spinner').classList.toggle('hidden', !on);
  document.getElementById('login-btn').disabled = on;
}
function showLoginError(msg) { const el=document.getElementById('login-error'); el.textContent=msg; el.classList.remove('hidden'); }
function clearLoginError() { document.getElementById('login-error').classList.add('hidden'); document.getElementById('reset-sent')?.classList.add('hidden'); }
function friendlyError(code) {
  return {
    'auth/user-not-found':    'No account found. Contact HR.',
    'auth/wrong-password':    'Incorrect password.',
    'auth/invalid-email':     'Invalid email or username.',
    'auth/too-many-requests': 'Too many attempts. Try later.',
    'auth/invalid-credential':'Incorrect username or password.'
  }[code] || 'Sign-in failed.';
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
function isPartner() { return currentRole === 'partner'; }
function isBrilliantOnly() { return currentDepts.length === 1 && currentDepts[0] === 'Brilliant Steel'; }

function getSidebarItems() {
  const pres   = isPresident() || currentRole === 'manager';
  const bsOnly = isBrilliantOnly();
  const partner = isPartner();
  const items  = [];

  items.push({ icon:'home', label:'Dashboard', page:'dashboard' });

  if (pres) {
    // ── Admin / President Command Center ──
    items.push({ icon:'bar-chart-2',   label:'Analytics',        page:'analytics',       section:false });
    items.push({ icon:'check-square',  label:'Tasks',            page:'tasks'                          });
    items.push({ icon:'megaphone',     label:'Posts',            page:'posts'                          });
    items.push({ icon:'shield-check',  label:'Approvals',        page:'approvals',       section:true  });
    items.push({ icon:'trending-up',   label:'Progress Reports', page:'progress'                       });
    items.push({ icon:'users',         label:'Team Directory',   page:'team-directory',  section:true  });
    items.push({ icon:'calendar',      label:'Attendance',       page:'attendance'                     });
    items.push({ icon:'layout-grid',   label:'Departments',      page:'departments'                    });
    items.push({ icon:'building-2',    label:'Company',          page:'company'                        });
    items.push({ icon:'help-circle',   label:'Help & Setup',     page:'help',            section:true  });
  } else if (partner) {
    // ── Partner role ──
    items.push({ icon:'check-square', label:'My Tasks', page:'tasks' });
    items.push({ icon:'megaphone',    label:'Posts',    page:'posts' });
    items.push({ icon:'users',        label:'Team',     page:'team-directory', section:true, sectionLabel:'Directory' });
    items.push({ icon:'folder',       label:'Files',    page:'files' });
    items.push({ icon:'help-circle',  label:'Help',     page:'help',  section:true, sectionLabel:'Support' });
  } else if (bsOnly) {
    // ── Partner — Brilliant Steel (ISOLATED) ──
    items.push({ icon:'calculator',  label:'Quote Builder', page:'bs-quote-builder' });
    items.push({ icon:'file-text',   label:'Quotations',    page:'bs-quotations'    });
    items.push({ icon:'book-open',   label:'Client Data',   page:'bs-clients'       });
    items.push({ icon:'folder',      label:'Files',         page:'bs-files'         });
    items.push({ icon:'help-circle', label:'Help / Guide',  page:'help'             });
  } else {
    // ── Employee / Agent / Finance ──
    items.push({ icon:'check-square', label:'My Tasks', page:'tasks' });
    items.push({ icon:'megaphone',    label:'Posts',    page:'posts' });
    // Departments — appear ABOVE management section
    currentDepts.forEach((dept, i) => {
      const cfg = DEPARTMENTS[dept];
      if (cfg) items.push({ icon: cfg.icon, label: dept, page: `dept:${dept}`, section: i === 0, sectionLabel: 'My Departments' });
    });
    // Management section below
    items.push({ icon:'users',       label:'Team',             page:'team-directory',    section:true, sectionLabel:'Management' });
    items.push({ icon:'calendar',    label:'Attendance',       page:'attendance'                       });
    items.push({ icon:'credit-card', label:'Personal Finance', page:'personal-finance'                 });
    items.push({ icon:'folder',      label:'Files',            page:'files'                            });
    if (currentRole !== 'agent') {
      items.push({ icon:'building-2', label:'Company', page:'company' });
    }
    items.push({ icon:'help-circle', label:'Help / Guide', page:'help', section:true, sectionLabel:'Support' });
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
  let lastSectionLabel = null;
  nav.innerHTML = items.map(item => {
    let secLabel = '';
    if (item.section) {
      const label = item.sectionLabel || 'Management';
      if (label !== lastSectionLabel) {
        secLabel = `<div class="nav-section-label">${label}</div>`;
        lastSectionLabel = label;
      }
    }
    return `${secLabel}<button class="nav-item" data-page="${item.page}">${_navIcon(item.icon)}${item.label}</button>`;
  }).join('');
  nav.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.page);
      closeSidebar();
    });
  });
  if (window.lucide) lucide.createIcons({ nodes: [nav] });
}

function buildBottomNav() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const items = isPresident() ? window.PRESIDENT_BOTTOM_NAV
    : isPartner() ? (window.PARTNER_BOTTOM_NAV || window.BOTTOM_NAV_ITEMS)
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

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.add('hidden');
  document.body.classList.remove('sidebar-open');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    const isOpen = document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay')?.classList.toggle('hidden', !isOpen);
    document.body.classList.toggle('sidebar-open', isOpen);
  });
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);
});

// ── Navigate ──────────────────────────────────────
function navigateTo(page) {
  currentPage = page;
  setActiveNav(page);
  // Close task fullscreen panel if open
  if (typeof window.closeTaskPanel === 'function') window.closeTaskPanel();
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
    case 'bs-files':         renderBrilliantSteel(currentUser, currentRole, 'Files'); break;
    case 'help':             renderHelp(); break;
    // ── New modules ──
    case 'posts':            window.renderPosts?.(); break;
    case 'team-directory':   window.renderTeamTab?.(); break;
    case 'attendance':       window.renderAttendancePage?.(); break;
    case 'cash-advances':    window.renderCashAdvancePage?.(); break;
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
  } else if (isPartner()) {
    await renderPartnerDashboard();
  } else if (isBrilliantOnly()) {
    renderBrilliantSteel(currentUser, currentRole, 'Dashboard');
  } else {
    await renderEmployeeDashboard();
  }
}

async function renderPartnerDashboard() {
  const c = document.getElementById('page-content');
  const u = userProfile;
  c.innerHTML = `
    <div class="page-header"><h2>👋 Welcome, ${(u.displayName||'Partner').split(' ')[0]}!</h2></div>
    <div id="live-clock" class="live-clock-line"></div>
    <div style="background:linear-gradient(135deg,rgba(155,168,255,0.1),rgba(10,132,255,0.08));border:1.5px solid rgba(155,168,255,0.2);border-radius:16px;padding:20px;margin-bottom:20px;text-align:center">
      <div style="font-size:32px;margin-bottom:8px">🤝</div>
      <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">Partner Portal</div>
      <div style="font-size:13px;color:var(--text-muted)">Welcome to Barro Industries partner access. Use the menu to navigate tasks, posts, and shared files.</div>
    </div>
    <div class="kpi-row" style="margin-bottom:16px" id="partner-kpi"></div>
    <div id="partner-tasks-card"></div>
  `;
  liveDateTime('live-clock');
  // Partner tasks
  try {
    const tasksSnap = await db.collection('tasks').where('assignedTo','array-contains',currentUser.uid).get()
      .catch(()=>db.collection('tasks').where('assignedTo','==',currentUser.uid).get());
    const tasks = tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
    const open = tasks.filter(t=>!['done','approved','archived'].includes(t.status));
    const done = tasks.filter(t=>['done','approved','archived'].includes(t.status));
    document.getElementById('partner-kpi').innerHTML = `
      <div class="kpi-card accent"><div class="kpi-label">Open Tasks</div><div class="kpi-value">${open.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Completed</div><div class="kpi-value">${done.length}</div></div>
    `;
    const todayStr = new Date().toISOString().slice(0,10);
    document.getElementById('partner-tasks-card').innerHTML = `
      <div class="card"><div class="card-header"><h3>My Tasks</h3><button class="btn-primary btn-sm" onclick="navigateTo('tasks')">All Tasks</button></div>
      <div class="card-body" style="padding:0">
        ${!open.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">✅</div><p>No open tasks</p></div>':
          open.slice(0,6).map(t=>{
            const isOverdue = t.dueDate && t.dueDate < todayStr;
            return `<div class="task-feed-item ${isOverdue?'task-overdue':''}">
              <div class="task-feed-dot priority-dot-${t.priority||'medium'}"></div>
              <div style="flex:1;min-width:0"><div class="task-feed-title">${t.title}</div>${t.dueDate?`<div class="task-feed-meta" style="color:${isOverdue?'var(--danger)':'var(--text-muted)'}">Due ${t.dueDate}</div>`:''}</div>
              <span class="badge ${isOverdue?'badge-red':'badge-blue'}">${isOverdue?'Overdue':t.status||'open'}</span>
            </div>`;
          }).join('')}
      </div></div>`;
  } catch(e) { /* non-critical */ }
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
    const [usersSnap, tasksSnap, subsSnap, quotesSnap, approvalsSnap, caSnap, extSnap, signupSnap] = await Promise.all([
      dbCachedGet('users', () => db.collection('users').get(), 60000),
      safeGet(db.collection('tasks')),
      safeGet(db.collection('submissions')),
      safeGet(db.collection('quotes')),
      safeGet(db.collection('approval_requests').where('status','==','pending')),
      safeGet(db.collection('cash_advances').where('status','==','pending')),
      safeGet(db.collection('attendance_extensions').where('status','==','pending')),
      safeGet(db.collection('signup_requests').where('status','==','pending')),
    ]);

    const users       = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const allTasks    = tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
    const CLOSED_STATUSES = ['done','approved','archived'];
    const openTasks   = allTasks.filter(t=>!CLOSED_STATUSES.includes(t.status));
    const doneTasks   = allTasks.filter(t=>CLOSED_STATUSES.includes(t.status));
    const overdueTasks= openTasks.filter(t=>t.dueDate && t.dueDate < todayStr);
    const highPriority= openTasks.filter(t=>t.priority==='high').length;
    const pendingSubs = subsSnap.docs.filter(d=>d.data().status==='pending').length;
    const totalQuotes = quotesSnap.docs.reduce((s,d)=>s+(d.data().total||0),0);
    const pendingApprovals = approvalsSnap.size;
    const pendingCA   = caSnap.size;
    const pendingExtensions = extSnap.size || 0;
    const pendingSignups = signupSnap.size || 0;
    const totalPending = pendingApprovals + pendingCA + pendingExtensions + pendingSubs + pendingSignups;

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
    const getAssignedNames = (t) => {
      const uids = Array.isArray(t.assignedTo) ? t.assignedTo : (t.assignedTo ? [t.assignedTo] : []);
      if (!uids.length) return 'Unassigned';
      return uids.map(uid => users.find(u=>u.id===uid)?.displayName || '?').join(', ');
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

      ${totalPending>0?`
      <div class="alert-banner alert-warn" onclick="navigateTo('approvals')">
        <span>📋 <strong>${totalPending} pending</strong> — ${[pendingSignups>0?pendingSignups+' signup'+(pendingSignups!==1?'s':''):'', pendingApprovals>0?pendingApprovals+' approval'+(pendingApprovals!==1?'s':''):'', pendingCA>0?pendingCA+' CA'+(pendingCA!==1?'s':''):'', pendingExtensions>0?pendingExtensions+' extension'+(pendingExtensions!==1?'s':''):'', pendingSubs>0?pendingSubs+' submission'+(pendingSubs!==1?'s':''):''].filter(Boolean).join(' · ')}</span>
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
                        ${getAssignedNames(t)}
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
    const now      = new Date();
    const todayStr = now.toISOString().slice(0,10);
    const [myTasksSnap, attSnap, caSnap, extSnap] = await Promise.all([
      db.collection('tasks').where('assignedTo','array-contains',currentUser.uid).get()
        .catch(()=>db.collection('tasks').where('assignedTo','==',currentUser.uid).get()),
      db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).get(),
      db.collection('cash_advances').where('userId','==',currentUser.uid).get().catch(()=>({docs:[]})),
      db.collection('attendance_extensions').doc(`${currentUser.uid}_${todayStr}`).get().catch(()=>({exists:false,data:()=>({})}))
    ]);

    const DONE_TASK_STATUSES = ['approved','archived','done'];
    const myTasks    = myTasksSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const openTasks  = myTasks.filter(t=>!DONE_TASK_STATUSES.includes(t.status));
    const doneTasks  = myTasks.filter(t=>DONE_TASK_STATUSES.includes(t.status));
    const overdue    = openTasks.filter(t=>t.dueDate && t.dueDate < todayStr);
    const u = userProfile;
    const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);

    // Holiday / Sunday check
    const phHolidays = typeof getPHHolidays === 'function' ? getPHHolidays(now.getFullYear()) : {};
    const todayHoliday = phHolidays[todayStr];
    const isSundayToday = now.getDay() === 0;
    const isNoWorkDay = isSundayToday || !!todayHoliday;

    // Attendance — new model: 0 / 0.5 / 1.0
    const attData     = attSnap.exists ? attSnap.data() : {};
    const hasLogin    = !!attData.loginTime;
    const attScore    = typeof attData.attendanceScore === 'number'
                          ? attData.attendanceScore
                          : (attData.fullTime ? 1.0 : hasLogin ? 0.5 : 0);
    const hasFull     = attScore >= 1.0;

    // Attendance window: 7:00–9:00 AM (or approved extension)
    const nowHour      = now.getHours();
    const inWindow     = nowHour >= 7 && nowHour < 9;   // normal 2-hr window
    const beforeWindow = nowHour < 7;
    const afterWindow  = nowHour >= 9;
    const extData      = extSnap.exists ? extSnap.data() : null;
    const extApproved  = extData?.status === 'approved' && extData?.expiresAt
                           && now < extData.expiresAt.toDate();
    const extPending   = extData?.status === 'pending';
    const extDenied    = extData?.status === 'denied';
    const extExpired   = extData?.status === 'approved'
                           && (!extData?.expiresAt || now >= extData.expiresAt.toDate());
    const canTimeIn    = !hasLogin && (inWindow || extApproved);
    const extExpiresStr = extApproved
      ? extData.expiresAt.toDate().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})
      : '';

    // KPI computation
    const taskScore = myTasks.length > 0 ? Math.round((doneTasks.length / myTasks.length) * 100) : 0;
    const kpiProfile = await db.collection('kpi_targets').doc(currentUser.uid).get().catch(()=>null);
    const kpiTarget  = kpiProfile?.exists ? kpiProfile.data() : {};
    const targetScore = kpiTarget.targetScore || 80;
    const kpiColor = taskScore >= targetScore ? 'var(--success)' : taskScore >= 60 ? 'var(--warning)' : 'var(--danger)';

    // Recent CA
    const recentCA = caSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
      const ta = a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toMillis?.() || 0;
      return tb - ta;
    });

    // Monthly attendance for Current Standing card
    const monthAttScore = await getAttendanceScore(currentUser.uid);
    const daysElapsedDash = now.getDate();
    const workDaysDash = Math.max(1, daysElapsedDash);
    const attDaysFull = Math.round(monthAttScore * workDaysDash);
    const caBalance = recentCA.filter(a=>a.status==='approved'&&(a.balance||0)>0).reduce((s,a)=>s+(a.balance||0),0);

    const attBadgeClass = isNoWorkDay ? 'badge-gray' : hasFull ? 'badge-green' : hasLogin ? 'badge-orange' : 'badge-gray';
    const attLabel      = isNoWorkDay ? (isSundayToday?'Sunday':'Holiday') : hasFull ? '100% Full ✅' : hasLogin ? '50% Timed In 🟡' : 'Not Timed In';

    // Dept quick tab buttons
    const deptTabsHTML = currentDepts.length ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3>My Departments</h3></div>
        <div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap;padding-top:6px">
          ${currentDepts.map(dept => {
            const cfg = DEPARTMENTS[dept] || {};
            return `<button class="dept-quick-tab" onclick="renderDeptModule('${dept}')">
              <span style="font-size:18px">${cfg.icon||'🗂️'}</span>
              <span>${dept}</span>
            </button>`;
          }).join('')}
        </div>
      </div>` : '';

    const taskOutcomeMet = myTasks.length > 0 && taskScore >= targetScore;

    c.innerHTML = `
      <div class="page-header">
        <h2>👋 Hi, ${(u.displayName||'').split(' ')[0]}!</h2>
      </div>
      <div id="live-clock" class="live-clock-line"></div>

      <div id="emp-id-card-wrap" style="margin-bottom:16px"></div>

      ${overdue.length>0?`<div class="alert-banner alert-danger" onclick="navigateTo('tasks')"><span>⚠️ <strong>${overdue.length} overdue task${overdue.length>1?'s':''}</strong></span><span class="alert-chevron">›</span></div>`:''}

      <!-- Departmental Tabs -->
      ${deptTabsHTML}

      <!-- KPI Stats Row -->
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="kpi-card ${openTasks.length>0?'accent':''}">
          <div class="kpi-label">Open Tasks</div>
          <div class="kpi-value">${openTasks.length}</div>
          <div class="kpi-sub">${doneTasks.length} done · ${overdue.length} overdue</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Task KPI</div>
          <div class="kpi-value" style="color:${kpiColor}">${taskScore}%</div>
          <div class="kpi-sub">${taskOutcomeMet?'✅ Target met':'❌ Below target'} (${targetScore}%)</div>
        </div>
        <div class="kpi-card green">
          <div class="kpi-label">Net Pay</div>
          <div class="kpi-value" style="font-size:15px">₱${formatNum(net)}</div>
          <div class="kpi-sub">Base ₱${formatNum(u.salary)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Department</div>
          <div class="kpi-value" style="font-size:11px;line-height:1.4">${currentDepts.join(', ')||'Unassigned'}</div>
        </div>
      </div>

      <!-- Current Standing Card -->
      <div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,var(--surface),var(--surface2));border:1.5px solid var(--primary-light)">
        <div class="card-header">
          <h3>📊 Current Standing — ${now.toLocaleDateString('en-PH',{month:'long',year:'numeric'})}</h3>
        </div>
        <div class="card-body" style="display:flex;gap:16px;flex-wrap:wrap;padding:12px 16px">
          <div style="flex:1;min-width:120px;text-align:center;padding:10px;background:rgba(48,209,88,0.08);border-radius:10px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:4px">Attendance</div>
            <div style="font-size:22px;font-weight:800;color:${monthAttScore>=0.9?'var(--success)':monthAttScore>=0.6?'var(--warning)':'var(--danger)'}">${Math.round(monthAttScore*100)}%</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">~${attDaysFull} / ${workDaysDash} days</div>
          </div>
          <div style="flex:1;min-width:120px;text-align:center;padding:10px;background:rgba(10,132,255,0.08);border-radius:10px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:4px">Task KPI</div>
            <div style="font-size:22px;font-weight:800;color:${kpiColor}">${taskScore}%</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${doneTasks.length}/${myTasks.length} tasks done</div>
          </div>
          <div style="flex:1;min-width:120px;text-align:center;padding:10px;background:rgba(255,100,0,0.08);border-radius:10px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:4px">CA Balance</div>
            <div style="font-size:22px;font-weight:800;color:${caBalance>0?'var(--danger)':'var(--success)'}">₱${formatNum(caBalance)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${caBalance>0?'Outstanding':'No balance'}</div>
          </div>
        </div>
      </div>

      <!-- Attendance Card -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3>Today's Attendance <span style="font-size:12px;font-weight:400;color:var(--text-muted)">${now.toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'})}</span></h3>
          <span class="badge ${attBadgeClass}">${attLabel}</span>
        </div>
        <div class="card-body">
          ${isNoWorkDay ? `
            <div style="display:flex;align-items:center;gap:14px;padding:4px 0">
              <div style="font-size:32px">${isSundayToday?'😴':'🎌'}</div>
              <div>
                <div style="font-size:14px;font-weight:700;color:var(--text)">${isSundayToday?'It\'s Sunday — rest day!':todayHoliday.name}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">No attendance required today. Enjoy your ${isSundayToday?'day off':'holiday'}!</div>
              </div>
            </div>`
          : hasFull ? `
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:40px;height:40px;border-radius:50%;background:rgba(48,209,88,0.15);display:flex;align-items:center;justify-content:center;font-size:20px">✅</div>
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--success)">Full attendance — 100%</div>
                <div style="font-size:11px;color:var(--text-muted)">Timed in + all notifications checked ✓</div>
              </div>
            </div>`
          : hasLogin ? `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
              <div style="width:40px;height:40px;border-radius:50%;background:rgba(255,159,10,0.15);display:flex;align-items:center;justify-content:center;font-size:20px">🟡</div>
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--warning)">50% — Timed In</div>
                <div style="font-size:11px;color:var(--text-muted)">${extApproved?'Check notifications before '+extExpiresStr+' → 100%':'Check notifications anytime today → 100%'}</div>
              </div>
            </div>
            ${!hasFull?`<div style="background:var(--surface2);border-radius:10px;padding:12px;font-size:12px;color:var(--text-muted)">
              Tap the 🔔 bell → check <em>every</em> notification anytime today${extApproved?' (before '+extExpiresStr+')':''} → 100%.
            </div>`:''}
          ` : canTimeIn ? `
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
              ${extApproved?`<span style="color:var(--warning)">⏰ Extension approved — expires ${extExpiresStr}</span><br>`:''}
              <strong>Step 1:</strong> Time in = 50%.<br>
              <strong>Step 2:</strong> Check every notification anytime today = 100%.
            </p>
            <button class="btn-primary" id="check-in-btn" style="width:100%">
              <i data-lucide="log-in" style="width:14px;margin-right:6px"></i>Time In (Step 1)
            </button>`
          : beforeWindow ? `
            <div style="text-align:center;padding:10px 0;color:var(--text-muted);font-size:13px">
              <div style="font-size:24px;margin-bottom:6px">⏳</div>
              Time In window opens at <strong>7:00 AM</strong>
            </div>`
          : extPending ? `
            <div style="display:flex;align-items:center;gap:10px;padding:4px 0">
              <div style="font-size:24px">⏳</div>
              <div>
                <div style="font-size:13px;font-weight:600">Extension requested</div>
                <div style="font-size:11px;color:var(--text-muted)">Waiting for president to approve. Refresh to check status.</div>
              </div>
            </div>`
          : extDenied ? `
            <div style="display:flex;align-items:center;gap:10px;padding:4px 0">
              <div style="font-size:24px">❌</div>
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--danger)">Extension denied</div>
                <div style="font-size:11px;color:var(--text-muted)">Attendance marked absent for today.</div>
              </div>
            </div>`
          : extExpired ? `
            <div style="display:flex;align-items:center;gap:10px;padding:4px 0">
              <div style="font-size:24px">⌛</div>
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text-muted)">Extension expired</div>
                <div style="font-size:11px;color:var(--text-muted)">The 6-hour window has closed.</div>
              </div>
            </div>`
          : `
            <div style="padding:4px 0">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                <div style="font-size:24px">⚠️</div>
                <div>
                  <div style="font-size:13px;font-weight:600;color:var(--warning)">Time window missed</div>
                  <div style="font-size:11px;color:var(--text-muted)">Time In window was 7:00–9:00 AM. You can request an extension.</div>
                </div>
              </div>
              <button class="btn-secondary" id="req-ext-btn" style="width:100%">⏰ Request Time Extension</button>
            </div>`}
        </div>
      </div>

      <!-- Management row: Tasks + KPI -->
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
            <div class="card-header"><h3>KPI Summary</h3></div>
            <div class="card-body">
              <div style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px">
                  <span>Task Completion</span><strong style="color:${kpiColor}">${doneTasks.length}/${myTasks.length} (${taskScore}%)</strong>
                </div>
                <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${taskScore}%;background:${kpiColor}"></div></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:8px">
                <span style="color:var(--text-muted)">Expected Outcome</span>
                <strong style="color:${taskOutcomeMet?'var(--success)':'var(--danger)'}">${taskOutcomeMet?'✅ Met':'❌ Not Met'}</strong>
              </div>
              <button class="btn-secondary btn-sm" style="margin-top:12px;width:100%" onclick="navigateTo('personal-finance')">
                Full Payslip & KPI →
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

    // Attendance buttons — new model
    document.getElementById('check-in-btn')?.addEventListener('click', async () => {
      // Check if no new notifs today (or all already read) → auto 100%
      const todayStart = new Date(todayStr).getTime();
      let autoFull = false;
      try {
        const now8am = new Date(); now8am.setHours(8,0,0,0);
        const notifSnap = await db.collection('notifications').doc(currentUser.uid).collection('items')
          .where('createdAt', '>=', new firebase.firestore.Timestamp(Math.floor(todayStart/1000), 0)).get();
        const todayNotifs = notifSnap.docs.map(d => d.data());
        autoFull = todayNotifs.length === 0 || todayNotifs.every(n => n.read);
      } catch {}
      await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
        loginTime: firebase.firestore.FieldValue.serverTimestamp(),
        uid: currentUser.uid, date: todayStr,
        attendanceScore: autoFull ? 1.0 : 0.5,
        fullTime: autoFull,
        autoFull
      }, { merge: true });
      Notifs.showToast(autoFull
        ? '✅ Full attendance (100%) — no unchecked notifications!'
        : `🟡 Timed in (50%). Open 🔔 and check off each notification anytime today for 100%.`);
      renderEmployeeDashboard();
    });

    // Request extension button
    document.getElementById('req-ext-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('req-ext-btn');
      btn.disabled = true; btn.textContent = 'Requesting…';
      try {
        await db.collection('attendance_extensions').doc(`${currentUser.uid}_${todayStr}`).set({
          uid:         currentUser.uid,
          userName:    userProfile.displayName || currentUser.email,
          date:        todayStr,
          status:      'pending',
          requestedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Notify president
        await Notifs.sendToOwner({
          title: '⏰ Attendance Extension Requested',
          body:  `${userProfile.displayName||currentUser.email} missed the 7–9am window on ${todayStr} and is requesting an extension.`,
          icon:  '⏰', type: 'att_extension',
          link:  'attendance'
        });
        Notifs.showToast('Extension requested — waiting for president approval.');
        renderEmployeeDashboard();
      } catch(err) {
        btn.disabled = false; btn.textContent = '⏰ Request Time Extension';
        Notifs.showToast('Failed to submit request','error');
      }
    });

  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h4>${err.message}</h4></div>`;
  }
}

// Called by notifications.js when all notifications checked — upgrades attendance to 100%
// Allowed anytime during the day as long as employee has already timed in (7–9am window)
window.tryUpgradeAttendanceOnNotifRead = async function() {
  if (!currentUser) return;
  const now      = new Date();
  const todayStr = now.toISOString().slice(0,10);

  const todaySnap = await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).get();
  if (!todaySnap.exists || !todaySnap.data().loginTime) return; // must have timed in first
  const current = todaySnap.data();
  if ((current.attendanceScore||0) >= 1.0) return; // already full
  await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
    attendanceScore: 1.0, fullTime: true,
    fullTimeAt: firebase.firestore.FieldValue.serverTimestamp(), notifReadAnytime: true
  }, { merge: true });
  Notifs.showToast('✅ Full attendance (100%) — all notifications checked!');
};

// ── Employee ID Card + Calling Card toggle ────────
function renderIDCard(containerId, u) {
  const el = document.getElementById(containerId);
  if (!el) return;

  let showingID = true;

  const issuedOn = u.issuedOn || u.startDate || '';
  const empType  = u.employmentType || '';
  const workMode = u.workMode || '';
  const roleLabel = (u.title&&u.title!==u.role?u.title:null)||ROLES[u.role]?.label||u.role||'Employee';
  const deptLabel = Array.isArray(u.departments)&&u.departments.length?u.departments.join(', '):(u.department||'—');

  const idHTML = `
    <div class="id-card id-card--digital">
      <div class="id-card-top">
        <img src="icons/barro-logo.png" alt="BI" class="id-card-logo" onerror="this.style.display='none'"/>
        <div>
          <div class="id-card-company">BARRO INDUSTRIES</div>
          <div class="id-card-company-sub">DIGITAL COMPANY ID</div>
        </div>
      </div>
      <div class="id-card-body">
        <div class="id-card-photo" style="cursor:default">
          ${u.photoUrl?`<img src="${u.photoUrl}" alt="Photo"/>`:`<span style="font-size:32px">👤</span>`}
        </div>
        <div class="id-card-info">
          <div class="id-card-name">${u.displayName||u.email}</div>
          <div class="id-card-title">${roleLabel}</div>
          <div class="id-card-detail"><span>🗂</span><strong>${deptLabel}</strong></div>
          <div class="id-card-detail"><span>✉️</span>${u.email}</div>
          ${u.phone?`<div class="id-card-detail"><span>📞</span>${u.phone}</div>`:''}
          ${empType?`<div class="id-card-detail"><span>💼</span>${empType}${workMode?' · '+workMode:''}</div>`:''}
          ${issuedOn?`<div class="id-card-detail"><span>📅</span>Issued: ${issuedOn}</div>`:''}
        </div>
      </div>
      <div class="id-card-footer">
        <div class="id-card-id">${u.employeeId||'BI-0000'}</div>
        <div class="id-card-status">ACTIVE</div>
      </div>
    </div>`;

  const callingHTML = `
    <div class="id-card id-card--calling" style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);text-align:center;padding:24px 20px;display:flex;flex-direction:column;align-items:center;gap:8px">
      ${u.photoUrl?`<img src="${u.photoUrl}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.3);margin-bottom:4px" alt=""/>`:
        `<div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:36px;margin-bottom:4px">👤</div>`}
      <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:.5px">${u.displayName||u.email}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.7);font-weight:600;text-transform:uppercase;letter-spacing:.08em">${roleLabel}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px">${deptLabel}</div>
      <div style="width:100%;height:1px;background:rgba(255,255,255,0.15);margin:10px 0"></div>
      <div style="font-size:12px;color:rgba(255,255,255,0.8)">✉️ ${u.email}</div>
      ${u.phone?`<div style="font-size:12px;color:rgba(255,255,255,0.8)">📞 ${u.phone}</div>`:''}
      <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:8px;letter-spacing:.1em">BARRO INDUSTRIES</div>
    </div>`;

  function render() {
    el.innerHTML = `
      <div style="position:relative;overflow:hidden;touch-action:pan-y">
        <div id="id-card-inner" style="transition:transform 0.35s cubic-bezier(.4,0,.2,1)">
          ${showingID ? idHTML : callingHTML}
        </div>
        <div style="display:flex;justify-content:center;gap:6px;margin-top:10px;align-items:center">
          <div style="width:20px;height:4px;border-radius:2px;background:${showingID?'var(--primary-light)':'rgba(255,255,255,0.2)'};transition:background 0.3s"></div>
          <div style="width:20px;height:4px;border-radius:2px;background:${!showingID?'var(--primary-light)':'rgba(255,255,255,0.2)'};transition:background 0.3s"></div>
        </div>
        <div style="text-align:center;font-size:10px;color:var(--text-muted);margin-top:4px">swipe to flip</div>
      </div>`;

    // Swipe gesture
    const inner = el.querySelector('[id="id-card-inner"]');
    let startX = 0, isDragging = false;
    inner.addEventListener('touchstart', e => { startX = e.touches[0].clientX; isDragging = true; }, { passive:true });
    inner.addEventListener('touchend', e => {
      if (!isDragging) return;
      isDragging = false;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) { showingID = dx > 0; render(); }
    }, { passive:true });
    // Also allow click to toggle (for desktop)
    inner.style.cursor = 'pointer';
    inner.addEventListener('click', () => { showingID = !showingID; render(); });
  }

  render();
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
    case 'Sales': renderSales(currentUser, currentRole); break;
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
    const snap = await dbCachedGet('users', () => db.collection('users').get(), 60000);
    const users = snap.docs.map(d=>({id:d.id,...d.data()}));
    const now2 = new Date();
    const daysElapsed2 = now2.getDate();
    const daysInMonth2 = new Date(now2.getFullYear(), now2.getMonth()+1, 0).getDate();
    const defaultMonth2 = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,'0')}`;
    const userRows = await Promise.all(users.map(async u => {
      const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);
      const kpi = await getKpiScore(u.id);
      const att = await getAttendanceScore(u.id);
      const mult = kpi*0.7 + att*0.3;
      const computed = net * mult * (daysElapsed2 / daysInMonth2);
      const depts = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—';
      // Task completion
      const DONE_ST = ['done','approved','archived'];
      const taskSnap2 = await db.collection('tasks').where('assignedTo','array-contains',u.id).get()
        .catch(()=>db.collection('tasks').where('assignedTo','==',u.id).get()).catch(()=>({docs:[]}));
      const tasksDone = taskSnap2.docs.filter(d=>DONE_ST.includes(d.data().status)).length;
      const tasksTotal = taskSnap2.docs.length;
      // Eval
      const evalDoc = await db.collection('kpi_evals').doc(u.id).get().catch(()=>null);
      const evalD = evalDoc?.exists ? evalDoc.data() : {};
      const selfDone2 = evalD.selfAssessMonth === defaultMonth2;
      return { uid:u.id, name:u.displayName||u.email, depts, net, kpi, att, computed, tasksDone, tasksTotal, evalD, selfDone: selfDone2, row: `<tr>
        <td>${u.displayName||u.email}</td>
        <td>${depts}</td>
        <td>₱${formatNum(net)}</td>
        <td>${Math.round(kpi*100)}%<br><span style="font-size:10px;color:var(--text-muted)">${tasksDone}/${tasksTotal} tasks</span></td>
        <td>${Math.round(att*100)}%</td>
        <td><strong style="color:var(--primary-light)">₱${formatNum(computed)}</strong><br><span style="font-size:10px;color:var(--text-muted)">${daysElapsed2}/${daysInMonth2} days</span></td>
        <td style="text-align:center">
          ${selfDone2
            ? `<span style="font-weight:700">${evalD.selfGrade!=null?evalD.selfGrade+'<small>/10</small>':'✅'}</span>
               ${evalD.selfNotes?`<div style="font-size:10px;color:var(--text-muted);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${evalD.selfNotes}</div>`:''}`
            : `<span style="color:var(--danger);font-size:11px;font-weight:700">⚠️ Pending</span>`
          }
        </td>
        <td style="text-align:center">
          <span style="font-weight:700;color:var(--success)">${evalD.presidentGrade!=null?evalD.presidentGrade+'<small>/10</small>':evalD.presidentGradeFromTasks!=null?evalD.presidentGradeFromTasks+'<small>/10 🔒</small>':'—'}</span>
        </td>
        <td><button class="btn-secondary btn-sm grade-emp-btn" data-uid="${u.id}" data-name="${u.displayName||u.email}" data-presgrade="${evalD.presidentGrade||''}" data-presnotes="${(evalD.presidentNotes||'').replace(/"/g,'&quot;')}" data-presimprove="${(evalD.presidentImprovements||'').replace(/"/g,'&quot;')}">Grade</button></td>
      </tr>` };
    }));
    const defaultMonth = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,'0')}`;
    const monthLabel = now2.toLocaleString('en-PH',{month:'long',year:'numeric'});
    document.getElementById('pf-content').innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3>Team Payroll — ${monthLabel}</h3>
          <button class="btn-primary btn-sm" id="record-payroll-btn">Record Payroll</button>
        </div>
        <div style="font-size:12px;color:var(--text-muted);padding:8px 16px">Computed earnings based on ${daysElapsed2} of ${daysInMonth2} days elapsed this month</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Employee</th><th>Dept</th><th>Net Pay</th><th>Task KPI</th><th>Attendance</th><th>Earned So Far</th><th>Self /10</th><th>Pres /10</th><th></th></tr></thead>
            <tbody>${userRows.map(r=>r.row).join('')}</tbody>
          </table>
        </div>
      </div>
    `;
    // Grade buttons
    document.querySelectorAll('.grade-emp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const { uid, name, presgrade, presnotes, presimprove } = btn.dataset;
        openModal(`Grade: ${name}`, `
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Assign a performance grade for ${name} (1 = poor, 10 = outstanding). Improvement areas are visible to the employee.</p>
          <div class="form-group"><label>President Grade (1–10)</label>
            <input id="pres-grade-input" type="number" min="1" max="10" step="1" value="${presgrade||''}" placeholder="e.g. 8"/>
          </div>
          <div class="form-group"><label>General Notes (internal only)</label>
            <textarea id="pres-grade-notes" rows="2" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical" placeholder="Internal remarks…">${(presnotes||'')}</textarea>
          </div>
          <div class="form-group">
            <label>📝 Development Areas <span style="font-size:11px;color:var(--primary-light)">(shown to employee)</span></label>
            <textarea id="pres-improve-input" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:2px solid var(--primary-light);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical" placeholder="What should this employee focus on improving? They will see this.">${(presimprove||'')}</textarea>
          </div>
        `, `<button class="btn-primary" id="save-pres-grade-btn">Save Grade</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
        document.getElementById('save-pres-grade-btn')?.addEventListener('click', async () => {
          const grade   = parseInt(document.getElementById('pres-grade-input').value);
          const notes   = document.getElementById('pres-grade-notes').value.trim();
          const improve = document.getElementById('pres-improve-input').value.trim();
          if (!grade || grade < 1 || grade > 10) { Notifs.showToast('Enter 1–10.','error'); return; }
          await db.collection('kpi_evals').doc(uid).set({
            presidentGrade: grade, presidentNotes: notes,
            presidentImprovements: improve,
            presidentId: currentUser.uid,
            presidentUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          // Notify employee
          const notifBody = improve
            ? `The president graded your performance: ${grade}/10. Check your Personal Finance page for development areas.`
            : `The president graded your performance: ${grade}/10.`;
          await Notifs.send(uid, { title:'📊 KPI Grade Updated', body: notifBody, icon:'📊', type:'kpi_grade' });
          closeModal(); Notifs.showToast(`Grade ${grade}/10 saved for ${name}.`);
          window.renderPersonalFinance(currentUser, currentRole);
        });
      });
    });
    document.getElementById('record-payroll-btn')?.addEventListener('click', () => {
      // Show self-assessment status in modal
      const pendingSelf = userRows.filter(r => !r.selfDone).map(r => r.name);
      const pendingHtml = pendingSelf.length
        ? `<div style="background:#fff3e0;border:1px solid #ff8f00;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px">
            <strong>⚠️ ${pendingSelf.length} employee${pendingSelf.length>1?'s have':'has'} not submitted self-assessment:</strong>
            <div style="color:#e65100;margin-top:4px">${pendingSelf.join(', ')}</div>
           </div>`
        : `<div style="background:#e8f5e9;border:1px solid #2e7d32;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#2e7d32">✅ All employees have completed their self-assessment.</div>`;
      openModal('Record Monthly Payroll', `
        ${pendingHtml}
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Records salary computation for all employees. Employees will be notified when payroll is recorded.</p>
        <div class="form-group"><label>Month</label><input id="pr-month" type="month" value="${defaultMonth}"/></div>
      `, `<button class="btn-primary" id="save-pr-btn">Record for All Employees</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-pr-btn').addEventListener('click', async () => {
        const month = document.getElementById('pr-month').value;
        if (!month) { Notifs.showToast('Select a month.','error'); return; }
        const btn2 = document.getElementById('save-pr-btn');
        btn2.disabled = true; btn2.textContent = 'Recording…';
        const batch = db.batch();
        const usersSnap2 = await dbCachedGet('users', () => db.collection('users').get(), 60000);
        const empDocs = usersSnap2.docs.filter(d => !['partner'].includes(d.data().role));
        for (const doc of empDocs) {
          const u2 = doc.data();
          const net2 = (u2.salary||0)+(u2.allowance||0)-(u2.deductions||0);
          const kpi2 = await getKpiScore(doc.id);
          const att2 = await getAttendanceScore(doc.id);
          const finalPay = net2 * (kpi2*0.7 + att2*0.3);
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
        // Notify all employees
        const monthLabel2 = new Date(month+'-02').toLocaleString('en-PH',{month:'long',year:'numeric'});
        for (const doc of empDocs) {
          await Notifs.send(doc.id, {
            title: '💰 Payroll Recorded',
            body: `Your payroll for ${monthLabel2} has been recorded. Check Personal Finance for your breakdown.`,
            icon: '💰', type: 'payroll'
          });
        }
        closeModal();
        Notifs.showToast(`Payroll recorded for ${month}!`);
        window.renderPersonalFinance(currentUser, currentRole);
      });
    });
    return;
  }

  // Employee sees their own
  const u = userProfile;
  const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);
  const now = new Date();
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();

  const [kpi, att, cashAdvSnap, salaryHistSnap, evalSnap, myTasksSnap] = await Promise.all([
    getKpiScore(currentUser.uid),
    getAttendanceScore(currentUser.uid),
    db.collection('cash_advances').where('userId','==',currentUser.uid).get().catch(()=>({docs:[]})),
    db.collection('salary_history').where('userId','==',currentUser.uid).orderBy('month','desc').limit(12).get().catch(()=>({docs:[]})),
    db.collection('kpi_evals').doc(currentUser.uid).get().catch(()=>null),
    db.collection('tasks').where('assignedTo','array-contains',currentUser.uid).get()
      .catch(()=>db.collection('tasks').where('assignedTo','==',currentUser.uid).get()).catch(()=>({docs:[]}))
  ]);

  const cashAdvances  = cashAdvSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
    const ta = a.createdAt?.toMillis?.() || 0;
    const tb = b.createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  const salaryHistory = salaryHistSnap.docs.map(d=>({id:d.id,...d.data()}));
  const totalAdvance  = cashAdvances.filter(a=>a.status==='approved'&&(a.balance||0)>0).reduce((s,a)=>s+(a.balance||0),0);

  const evalData       = evalSnap?.exists ? evalSnap.data() : {};
  const selfGrade      = evalData.selfGrade ?? null;
  // presidentGrade: manual override first, then auto-averaged from task scores
  // Employees see only the averaged grade (presidentGradeFromTasks), and only on the 1st of the month
  const isFirstOfMonth = now.getDate() === 1;
  const presGrade      = isFirstOfMonth ? (evalData.presidentGradeFromTasks ?? null) : null;
  const selfNotes      = evalData.selfNotes || '';
  const presidentImprovements = evalData.presidentImprovements || '';
  const currentMonth   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const selfAssessMonth = evalData.selfAssessMonth || null;
  const selfDoneThisMonth = selfAssessMonth === currentMonth;
  const isPayrollWindow = now.getDate() <= 7;

  const DONE_TASK_STATUSES_PR = ['done','approved','archived'];
  const myTasks  = myTasksSnap.docs.map(d=>d.data());
  const doneTasks= myTasks.filter(t=>DONE_TASK_STATUSES_PR.includes(t.status));
  const taskPct  = myTasks.length ? Math.round(doneTasks.length/myTasks.length*100) : 0;
  const kpiProfile = await db.collection('kpi_targets').doc(currentUser.uid).get().catch(()=>null);
  const targetScore   = kpiProfile?.exists ? (kpiProfile.data().targetScore||80) : 80;
  const outcomeMet    = taskPct >= targetScore;

  // Computed earnings based on days covered so far (not full month)
  const multiplier    = kpi*0.7 + att*0.3;
  const computedMonth = net * multiplier; // full month projected
  const earnedSoFar   = computedMonth * (daysElapsed / daysInMonth); // prorated

  // YTD = completed months from salary history + current month earned so far
  const thisYear  = now.getFullYear().toString();
  const ytdHistory= salaryHistory.filter(h=>h.month?.startsWith(thisYear));
  const ytdPay    = ytdHistory.reduce((s,h)=>s+(h.finalPay||h.netPay||0),0) + earnedSoFar;

  const monthLabel = now.toLocaleString('en-PH',{month:'long',year:'numeric'});
  const kpiColor  = kpi>=0.8?'var(--success)':kpi>=0.6?'var(--warning)':'var(--danger)';
  const attColor  = att>=0.85?'var(--success)':att>=0.6?'var(--warning)':'var(--danger)';

  c.innerHTML = `
    <div class="page-header">
      <h2>Personal Finance</h2>
      <button class="btn-primary btn-sm" id="req-advance-btn">+ Cash Advance</button>
    </div>

    ${isPayrollWindow && !selfDoneThisMonth ? `
    <div style="background:linear-gradient(135deg,#b71c1c,#c62828);color:#fff;border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <span style="font-size:24px">⚠️</span>
      <div style="flex:1">
        <div style="font-weight:800;font-size:14px;margin-bottom:2px">Self-Assessment Required for ${monthLabel}</div>
        <div style="font-size:12px;opacity:0.9">Complete your self-evaluation before payroll is finalized. Click <strong>Self Evaluate</strong> in the KPI card below.</div>
      </div>
    </div>` : ''}

    ${presidentImprovements ? `
    <div style="background:linear-gradient(135deg,var(--surface2),var(--surface));border:2px solid var(--primary-light);border-radius:12px;padding:14px 18px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--primary-light);margin-bottom:6px">📝 Your Development Areas — from President</div>
      <div style="font-size:13px;line-height:1.6;color:var(--text);white-space:pre-wrap">${presidentImprovements}</div>
    </div>` : ''}

    <!-- Top KPI stats -->
    <div class="kpi-row">
      <div class="kpi-card green">
        <div class="kpi-label">Earned So Far</div>
        <div class="kpi-value" style="font-size:15px">₱${formatNum(earnedSoFar)}</div>
        <div class="kpi-sub">${daysElapsed} of ${daysInMonth} days · YTD ₱${formatNum(ytdPay)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Task KPI</div>
        <div class="kpi-value" style="color:${kpiColor}">${taskPct}%</div>
        <div class="kpi-sub">${doneTasks.length}/${myTasks.length} done</div>
      </div>
      <div class="kpi-card accent">
        <div class="kpi-label">Attendance</div>
        <div class="kpi-value" style="color:${attColor}">${Math.round(att*100)}%</div>
        <div class="kpi-sub">${daysElapsed} days elapsed</div>
      </div>
      <div class="kpi-card ${computedMonth<net*0.9?'red':'green'}">
        <div class="kpi-label">Projected Full Month</div>
        <div class="kpi-value" style="font-size:14px">₱${formatNum(computedMonth)}</div>
        <div class="kpi-sub">Base ₱${formatNum(net)}</div>
      </div>
    </div>

    <!-- KPI Evaluation Card -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <h3>📊 KPI Evaluation — ${monthLabel}</h3>
        <button class="btn-secondary btn-sm" id="self-eval-btn">Self Evaluate</button>
      </div>
      <div class="card-body">
        <!-- Tasks section -->
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px">
            <span style="font-weight:600">Tasks Completed</span>
            <strong style="color:${kpiColor}">${doneTasks.length} of ${myTasks.length}</strong>
          </div>
          <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${taskPct}%;background:${kpiColor}"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:var(--text-muted)">
            <span>Target: ${targetScore}%</span>
            <strong style="color:${outcomeMet?'var(--success)':'var(--danger)'}">
              ${outcomeMet?'✅ Expected Outcome Met':'❌ Expected Outcome Not Met'}
            </strong>
          </div>
        </div>
        <!-- Grades -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px">
          <div style="background:var(--s2);border-radius:10px;padding:12px;border:1.5px solid var(--border)">
            <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:6px">Self Evaluation</div>
            <div style="font-size:28px;font-weight:800;color:${selfGrade?'var(--primary-light)':'var(--text-muted)'}">
              ${selfGrade!=null?selfGrade:'—'}<span style="font-size:14px;font-weight:400">/10</span>
            </div>
            ${selfNotes?`<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic">"${selfNotes}"</div>`:''}
          </div>
          <div style="background:var(--s2);border-radius:10px;padding:12px;border:1.5px solid var(--border)">
            <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:6px">Performance Grade</div>
            <div style="font-size:28px;font-weight:800;color:${presGrade!=null?'var(--success)':'var(--text-muted)'}">
              ${presGrade!=null?presGrade:'—'}<span style="font-size:14px;font-weight:400">/10</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${presGrade!=null?'Avg. from completed tasks':'Available on the 1st of each month'}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Payroll Breakdown -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3>Payroll Breakdown — ${monthLabel}</h3></div>
      <div class="card-body">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          Days covered: ${daysElapsed} of ${daysInMonth} days this month
        </div>
        <div class="payslip-row"><span>Base Salary</span><strong>₱${formatNum(u.salary)}</strong></div>
        <div class="payslip-row"><span>Allowances</span><span style="color:var(--success)">+₱${formatNum(u.allowance)}</span></div>
        <div class="payslip-row"><span>Deductions</span><span style="color:var(--danger)">-₱${formatNum(u.deductions)}</span></div>
        <div class="payslip-row"><span>Net Pay (Full Month)</span><strong>₱${formatNum(net)}</strong></div>
        <div style="height:1px;background:var(--border);margin:12px 0"></div>
        <div style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:8px;letter-spacing:0.5px">Performance Multiplier</div>
        <div class="payslip-row">
          <span>Task KPI (70%) — ${taskPct}% completion</span>
          <span style="color:${kpiColor}">${(kpi*0.7).toFixed(2)}×</span>
        </div>
        <div class="payslip-row">
          <span>Attendance (30%) — ${Math.round(att*100)}% rate (${daysElapsed} days)</span>
          <span style="color:${attColor}">${(att*0.3).toFixed(2)}×</span>
        </div>
        <div class="payslip-row" style="font-weight:700">
          <span>Combined Multiplier</span>
          <span>${multiplier.toFixed(2)}×</span>
        </div>
        <div style="height:1px;background:var(--border);margin:12px 0"></div>
        <div class="payslip-row">
          <span>Projected Full Month (₱${formatNum(net)} × ${multiplier.toFixed(2)})</span>
          <strong>₱${formatNum(computedMonth)}</strong>
        </div>
        <div class="payslip-row">
          <span>Earned So Far (${daysElapsed}/${daysInMonth} days)</span>
          <strong style="color:var(--primary-light)">₱${formatNum(earnedSoFar)}</strong>
        </div>
        <div class="payslip-row" style="background:var(--surface2);border-radius:8px;padding:10px 14px;margin-top:8px">
          <span>Cash Advance Balance</span><span style="color:var(--danger)">-₱${formatNum(totalAdvance)}</span>
        </div>
        <div class="payslip-row" style="font-size:16px;font-weight:800;margin-top:8px;padding-top:8px;border-top:2px solid var(--border)">
          <span>Take-Home So Far</span><span style="color:var(--success)">₱${formatNum(Math.max(0,earnedSoFar-totalAdvance))}</span>
        </div>
        <button class="btn-secondary" style="margin-top:14px;width:100%" onclick="printPayslip()">Generate Payslip PDF</button>
      </div>
    </div>

    <!-- Salary History -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3>Salary History</h3></div>
      <div class="card-body" style="padding:0">
        ${!salaryHistory.length
          ? '<div class="empty-state" style="padding:20px"><p style="font-size:13px;color:var(--text-muted)">No history yet. Records are added monthly by admin.</p></div>'
          : `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Month</th><th>Base</th><th>Allowance</th><th>Deductions</th><th>Net</th><th>KPI</th><th>Att</th><th>Final</th></tr></thead>
              <tbody>${salaryHistory.map(h=>`<tr>
                <td>${h.month||'—'}</td>
                <td>₱${formatNum(h.salary)}</td>
                <td style="color:var(--success)">+₱${formatNum(h.allowance)}</td>
                <td style="color:var(--danger)">-₱${formatNum(h.deductions)}</td>
                <td>₱${formatNum(h.netPay)}</td>
                <td>${h.kpiScore?Math.round(h.kpiScore*100)+'%':'—'}</td>
                <td>${h.attScore?Math.round(h.attScore*100)+'%':'—'}</td>
                <td><strong>₱${formatNum(h.finalPay)}</strong></td>
              </tr>`).join('')}</tbody>
            </table></div>`}
      </div>
    </div>

    <!-- Cash Advances -->
    <div class="card">
      <div class="card-header">
        <h3>Cash Advances</h3>
        ${cashAdvances.filter(a=>a.status==='pending').length?`<span class="badge badge-orange">${cashAdvances.filter(a=>a.status==='pending').length} pending</span>`:''}
      </div>
      ${totalAdvance>0?`<div style="background:rgba(255,100,0,0.08);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;gap:20px;font-size:13px">
        <span>Outstanding Balance: <strong style="color:var(--danger)">₱${formatNum(totalAdvance)}</strong></span>
        <span>Monthly Due: <strong>₱${formatNum(cashAdvances.filter(a=>a.status==='approved'&&(a.balance||0)>0).reduce((s,a)=>s+(a.monthlyPayment||0),0))}</strong></span>
      </div>`:''}
      <div class="card-body" style="padding:0">
        ${!cashAdvances.length
          ? '<div class="empty-state" style="padding:20px"><p>No cash advances yet.</p></div>'
          : `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Date</th><th>Amount</th><th>Balance</th><th>Monthly</th><th>Reason</th><th>Status</th></tr></thead>
              <tbody>${cashAdvances.map(a=>`<tr>
                <td>${a.date||'—'}</td>
                <td>₱${formatNum(a.amount)}</td>
                <td style="color:${(a.balance||0)>0?'var(--danger)':'var(--success)'}">₱${formatNum(a.balance||0)}</td>
                <td>${a.monthlyPayment?'₱'+formatNum(a.monthlyPayment):'—'}</td>
                <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.reason||'—'}</td>
                <td><span class="badge ${a.status==='approved'?'badge-green':a.status==='rejected'?'badge-red':a.status==='paid'?'badge-green':'badge-orange'}">${a.status}</span></td>
              </tr>`).join('')}</tbody>
            </table></div>`}
      </div>
    </div>
  `;

  // Self Evaluation button
  document.getElementById('self-eval-btn')?.addEventListener('click', () => {
    openModal(`Self-Assessment — ${monthLabel}`, `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">
        This is <strong>required for payroll</strong> every 1st of the month. Be honest — the president also grades you.
      </p>
      <div class="form-group">
        <label>Self Grade (1–10) <span style="color:var(--danger)">*</span></label>
        <input id="self-grade-input" type="number" min="1" max="10" step="1" value="${selfGrade!=null?selfGrade:''}" placeholder="e.g. 7"/>
      </div>
      <div class="form-group">
        <label>What did you accomplish this month? <span style="color:var(--danger)">*</span></label>
        <textarea id="self-notes-input" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical" placeholder="List your key accomplishments and contributions…">${selfNotes}</textarea>
      </div>
      <div class="form-group">
        <label>What can you improve? <span style="color:var(--danger)">*</span></label>
        <textarea id="self-improve-input" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical" placeholder="Be specific about areas you want to work on…">${evalData.selfImprovements||''}</textarea>
      </div>
    `, `<button class="btn-primary" id="save-self-eval-btn">Submit Assessment</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-self-eval-btn')?.addEventListener('click', async () => {
      const grade    = parseInt(document.getElementById('self-grade-input').value);
      const notes    = document.getElementById('self-notes-input').value.trim();
      const improve  = document.getElementById('self-improve-input').value.trim();
      if (!grade || grade < 1 || grade > 10) { Notifs.showToast('Enter a grade between 1 and 10.','error'); return; }
      if (!notes)   { Notifs.showToast('Please describe your accomplishments.','error'); return; }
      if (!improve) { Notifs.showToast('Please describe your improvement areas.','error'); return; }
      await db.collection('kpi_evals').doc(currentUser.uid).set({
        selfGrade: grade, selfNotes: notes, selfImprovements: improve,
        selfAssessMonth: currentMonth,
        selfUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        userId: currentUser.uid, userName: userProfile.displayName || currentUser.email
      }, { merge: true });
      // Notify president
      await Notifs.sendToOwner({
        title: '📋 Self-Assessment Submitted',
        body: `${userProfile.displayName||currentUser.email} submitted their self-assessment for ${monthLabel}.`,
        icon: '📋', type: 'self_assessment'
      });
      closeModal();
      Notifs.showToast('Self-assessment submitted!');
      window.renderPersonalFinance(currentUser, currentRole);
    });
  });

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
    const DONE_STATUSES = ['done','approved','archived'];
    const taskSnap = await db.collection('tasks').where('assignedTo','array-contains',uid).get()
      .catch(()=>db.collection('tasks').where('assignedTo','==',uid).get());
    const tasks = taskSnap.docs.map(d=>d.data());
    const taskScore = tasks.length ? Math.min(1, tasks.filter(t=>DONE_STATUSES.includes(t.status)).length / tasks.length) : 0.5;

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
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const daysElapsed = now.getDate(); // days so far this month (not a fixed 22)
    const snap = await db.collection('attendance').doc(uid).collection('records')
      .where(firebase.firestore.FieldPath.documentId(), '>=', monthStart).get();
    const records = snap.docs.map(d => d.data());
    const totalScore = records.reduce((sum, r) => {
      // New model: attendanceScore field (0, 0.5, 1.0)
      // Fallback to legacy fullTime/loginTime model
      const score = typeof r.attendanceScore === 'number'
        ? r.attendanceScore
        : (r.fullTime ? 1.0 : r.loginTime ? 0.5 : 0);
      return sum + score;
    }, 0);
    return Math.min(1, totalScore / daysElapsed);
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

// ── Employee Standings Modal ───────────────────────
async function openEmpStandingsModal(uid, name, preloaded) {
  window.openModal(`📊 ${name} — Standings`, '<div class="loading-placeholder" style="padding:30px;text-align:center">Loading standings…</div>');
  const body = document.getElementById('modal-body');

  try {
    const now      = new Date();
    const monthLabel = now.toLocaleString('en-PH', { month: 'long', year: 'numeric' });
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

    const [attScore, caSnap, attRecSnap] = await Promise.all([
      getAttendanceScore(uid),
      db.collection('cash_advances').where('userId','==',uid).get().catch(()=>({docs:[]})),
      db.collection('attendance').doc(uid).collection('records')
        .where(firebase.firestore.FieldPath.documentId(), '>=', monthStart).get()
        .catch(()=>({docs:[]}))
    ]);

    const caList  = caSnap.docs.map(d=>({id:d.id,...d.data()}));
    const caBalance = caList.filter(a=>a.status==='approved'&&(a.balance||0)>0).reduce((s,a)=>s+(a.balance||0),0);
    const caActive  = caList.filter(a=>a.status==='approved'&&(a.balance||0)>0).length;

    const net    = preloaded.salary + preloaded.allowance - preloaded.deductions;
    const kpiPct = preloaded.mTotal ? Math.round(preloaded.mDone / preloaded.mTotal * 100) : 0;
    const attPct = Math.round(attScore * 100);
    const attColor = attPct >= 80 ? 'var(--success,#30d158)' : attPct >= 50 ? 'var(--warning,#ffa040)' : 'var(--danger,#ff4444)';
    const kpiColor = kpiPct >= 80 ? 'var(--success,#30d158)' : kpiPct >= 50 ? 'var(--warning,#ffa040)' : 'var(--danger,#ff4444)';

    // Build attendance day grid
    const attRecords = {};
    attRecSnap.docs.forEach(d => { attRecords[d.id] = d.data(); });
    const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    const dayBoxes = [];
    for (let d = 1; d <= Math.min(now.getDate(), daysInMonth); d++) {
      const ds = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const rec = attRecords[ds];
      const dow = new Date(ds).getDay(); // 0=Sun
      if (dow === 0) { dayBoxes.push(`<div class="att-day-box" style="background:rgba(100,100,100,0.15);border:1px solid rgba(100,100,100,0.2);opacity:0.5" title="${ds} — Sunday"><span style="font-size:9px;color:var(--text-muted)">${d}</span><br><span style="font-size:10px">✗</span></div>`); continue; }
      const score = rec ? (typeof rec.attendanceScore === 'number' ? rec.attendanceScore : rec.fullTime ? 1.0 : rec.loginTime ? 0.5 : 0) : 0;
      const bg = score >= 1 ? 'rgba(48,209,88,0.18)' : score >= 0.5 ? 'rgba(255,160,64,0.18)' : 'rgba(255,68,68,0.12)';
      const bc = score >= 1 ? 'rgba(48,209,88,0.4)' : score >= 0.5 ? 'rgba(255,160,64,0.4)' : 'rgba(255,68,68,0.25)';
      const mark = score >= 1 ? '✓' : score >= 0.5 ? '½' : '✗';
      const markColor = score >= 1 ? '#30d158' : score >= 0.5 ? '#ffa040' : '#ff6b6b';
      const attLabel = score >= 1 ? 'Full' : score >= 0.5 ? 'Half' : 'Absent';
      dayBoxes.push(`<div class="att-day-box" style="background:${bg};border:1px solid ${bc};border-radius:5px;padding:3px 4px;text-align:center;min-width:28px" title="${ds} — ${attLabel}"><span style="font-size:9px;color:var(--text-muted)">${d}</span><br><span style="font-size:11px;color:${markColor};font-weight:700">${mark}</span></div>`);
    }

    body.innerHTML = `
      <div style="padding:4px 0 16px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;text-align:center">${monthLabel}</div>

        <!-- KPI Row -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px">
          <div style="background:var(--surface2,rgba(255,255,255,0.05));border-radius:12px;padding:14px;text-align:center">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Attendance</div>
            <div style="font-size:26px;font-weight:800;color:${attColor}">${attPct}%</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${attRecSnap.docs.length} days logged</div>
          </div>
          <div style="background:var(--surface2,rgba(255,255,255,0.05));border-radius:12px;padding:14px;text-align:center">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Task KPI</div>
            <div style="font-size:26px;font-weight:800;color:${kpiColor}">${kpiPct}%</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${preloaded.mDone}/${preloaded.mTotal} done</div>
          </div>
          <div style="background:var(--surface2,rgba(255,255,255,0.05));border-radius:12px;padding:14px;text-align:center">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">CA Balance</div>
            <div style="font-size:22px;font-weight:800;color:${caBalance>0?'var(--danger,#ff4444)':'var(--success,#30d158)'}">${caBalance>0?'₱'+formatNum(caBalance):'₱0'}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${caActive} active loan${caActive!==1?'s':''}</div>
          </div>
        </div>

        <!-- Salary Breakdown -->
        <div style="background:var(--surface2,rgba(255,255,255,0.05));border-radius:12px;padding:14px;margin-bottom:18px">
          <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Salary Computation</div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:13px">Base Salary</span><span style="font-size:13px;font-weight:600">₱${formatNum(preloaded.salary)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:13px;color:var(--success,#30d158)">+ Allowances</span><span style="font-size:13px;font-weight:600;color:var(--success,#30d158)">₱${formatNum(preloaded.allowance)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:13px;color:var(--danger,#ff4444)">− Deductions</span><span style="font-size:13px;font-weight:600;color:var(--danger,#ff4444)">₱${formatNum(preloaded.deductions)}</span></div>
          ${caBalance > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:13px;color:var(--danger,#ff4444)">− CA Outstanding</span><span style="font-size:13px;font-weight:600;color:var(--danger,#ff4444)">₱${formatNum(caBalance)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0;margin-top:2px"><span style="font-size:14px;font-weight:700">Net Pay</span><span style="font-size:16px;font-weight:800;color:var(--primary-light,#6c8ef5)">₱${formatNum(Math.max(0, net - caBalance))}</span></div>
          ${caBalance > 0 ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">* Net deducted by CA outstanding balance</div>` : ''}
        </div>

        <!-- Attendance Grid -->
        <div style="background:var(--surface2,rgba(255,255,255,0.05));border-radius:12px;padding:14px">
          <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Attendance This Month</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${dayBoxes.join('')}</div>
          <div style="display:flex;gap:12px;margin-top:10px;font-size:11px;color:var(--text-muted)">
            <span><span style="color:#30d158;font-weight:700">✓</span> Full</span>
            <span><span style="color:#ffa040;font-weight:700">½</span> Half</span>
            <span><span style="color:#ff6b6b;font-weight:700">✗</span> Absent</span>
            <span style="opacity:.6">✗ Sundays</span>
          </div>
        </div>
      </div>
    `;
  } catch(err) {
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
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

    // Helper to check assignedTo array
    const isAssigned = (t, uid) => Array.isArray(t.assignedTo) ? t.assignedTo.includes(uid) : t.assignedTo === uid;

    c.innerHTML = `
      <div class="page-header"><h2>📈 Progress Reports & KPIs</h2><span class="badge badge-blue">${monthLabel}</span></div>
      <div class="kpi-row">
        <div class="kpi-card accent"><div class="kpi-label">All Tasks (Total)</div><div class="kpi-value">${tasks.length}</div><div class="kpi-sub">${tasks.filter(t=>t.status==='done').length} done</div></div>
        <div class="kpi-card green"><div class="kpi-label">This Month Tasks</div><div class="kpi-value">${monthTasks.length}</div><div class="kpi-sub">${monthTasks.filter(t=>t.status==='done').length} done</div></div>
        <div class="kpi-card"><div class="kpi-label">Overall KPI</div><div class="kpi-value">${tasks.length?Math.round(tasks.filter(t=>t.status==='done').length/tasks.length*100):0}%</div></div>
      </div>
      <div class="subtab-bar" id="progress-top-tabs" style="margin-bottom:16px">
        <button class="subtab-btn active" data-ptab="dept">By Department</button>
        <button class="subtab-btn" data-ptab="members">All Members</button>
      </div>
      <div id="progress-dept-view"></div>
      <div id="progress-members-view" style="display:none">
        <div class="card">
          <div class="card-header"><h3>👥 All Members Progress</h3></div>
          <div class="card-body" style="padding:0">
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Member</th><th>Department</th><th>This Month</th><th>All Time</th><th>KPI</th><th></th></tr></thead>
              <tbody>
                ${users.filter(u=>u.role!=='partner').map(u=>{
                  const uDone   = tasks.filter(t=>isAssigned(t,u.id)&&t.status==='done').length;
                  const uTotal  = tasks.filter(t=>isAssigned(t,u.id)).length;
                  const uMDone  = monthTasks.filter(t=>isAssigned(t,u.id)&&t.status==='done').length;
                  const uMTotal = monthTasks.filter(t=>isAssigned(t,u.id)).length;
                  const uPct    = uTotal ? Math.round(uDone/uTotal*100) : 0;
                  const depts   = Array.isArray(u.departments)&&u.departments.length ? u.departments.join(', ') : u.department||'—';
                  return `<tr>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px">
                        <div style="width:32px;height:32px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0">
                          ${u.photoUrl?`<img src="${u.photoUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:(u.displayName||'?')[0].toUpperCase()}
                        </div>
                        <div>
                          <div style="font-size:13px;font-weight:600">${u.displayName||u.email}</div>
                          <div style="font-size:11px;color:var(--text-muted)">${u.role||''}</div>
                        </div>
                      </div>
                    </td>
                    <td style="font-size:12px;color:var(--text-muted)">${depts}</td>
                    <td style="font-size:12px"><strong>${uMDone}</strong>/${uMTotal}</td>
                    <td style="font-size:12px"><strong>${uDone}</strong>/${uTotal}</td>
                    <td><span class="badge ${uPct>=80?'badge-green':uPct>=50?'badge-orange':'badge-red'}">${uPct}%</span></td>
                    <td><button class="btn-sm btn-outline emp-standings-btn" data-uid="${u.id}" data-name="${encodeURIComponent(u.displayName||u.email)}" data-mdone="${uMDone}" data-mtotal="${uMTotal}" data-salary="${u.salary||0}" data-allowance="${u.allowance||0}" data-deductions="${u.deductions||0}" style="font-size:11px;padding:3px 8px">📊 View</button></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table></div>
          </div>
        </div>
      </div>
    `;
    const deptView = document.getElementById('progress-dept-view');
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
      deptView.innerHTML += `
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
                <thead><tr><th>Member</th><th>All Tasks Done</th><th>This Month</th><th>KPI</th><th></th></tr></thead>
                <tbody>
                  ${data.members.map(u=>{
                    const uDone  = tasks.filter(t=>isAssigned(t,u.id)&&t.status==='done').length;
                    const uTotal = tasks.filter(t=>isAssigned(t,u.id)).length;
                    const uMDone = monthTasks.filter(t=>isAssigned(t,u.id)&&t.status==='done').length;
                    const uMTotal= monthTasks.filter(t=>isAssigned(t,u.id)).length;
                    const uPct   = uTotal ? Math.round(uDone/uTotal*100) : 0;
                    return `<tr>
                      <td>${u.displayName||u.email}</td>
                      <td>${uDone}/${uTotal}</td>
                      <td>${uMDone}/${uMTotal}</td>
                      <td><span class="badge ${uPct>=80?'badge-green':uPct>=50?'badge-orange':'badge-red'}">${uPct}%</span></td>
                      <td><button class="btn-sm btn-outline emp-standings-btn" data-uid="${u.id}" data-name="${encodeURIComponent(u.displayName||u.email)}" data-mdone="${uMDone}" data-mtotal="${uMTotal}" data-salary="${u.salary||0}" data-allowance="${u.allowance||0}" data-deductions="${u.deductions||0}" style="font-size:11px;padding:3px 8px">📊 View</button></td>
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

    // Wire up top-level tabs (By Department / All Members)
    c.querySelectorAll('[data-ptab]').forEach(btn => {
      btn.addEventListener('click', () => {
        c.querySelectorAll('[data-ptab]').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.ptab;
        document.getElementById('progress-dept-view').style.display    = tab==='dept'    ? '' : 'none';
        document.getElementById('progress-members-view').style.display = tab==='members' ? '' : 'none';
      });
    });

    // Wire up employee standings modal buttons (in both views)
    c.querySelectorAll('.emp-standings-btn').forEach(btn => {
      btn.addEventListener('click', () => openEmpStandingsModal(
        btn.dataset.uid,
        decodeURIComponent(btn.dataset.name),
        { mDone: +btn.dataset.mdone, mTotal: +btn.dataset.mtotal,
          salary: +btn.dataset.salary, allowance: +btn.dataset.allowance, deductions: +btn.dataset.deductions }
      ));
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
    <div class="page-header"><h2>🏢 Company</h2></div>
    <div class="subtab-bar" id="company-tabs" style="flex-wrap:wrap">
      <button class="subtab-btn active" data-tab="overview">Overview</button>
      <button class="subtab-btn" data-tab="memos">Memos</button>
      <button class="subtab-btn" data-tab="policies">Policies</button>
      <button class="subtab-btn" data-tab="downloads">Downloads</button>
      <button class="subtab-btn" data-tab="handbook">Handbook</button>
    </div>
    <div id="company-tab-content"></div>
  `;
  function switchCompanyTab(tab) {
    c.querySelectorAll('.subtab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
    const ct = document.getElementById('company-tab-content');
    if (tab==='overview')        renderCompanyOverview(ct, canAdd);
    else if (tab==='memos')      renderCompanyMemos(ct, canAdd);
    else if (tab==='policies')   renderCompanyPolicies(ct, canAdd);
    else if (tab==='downloads')  renderCompanyDownloads(ct, canAdd);
    else if (tab==='handbook')   renderCompanyHandbook(ct, canAdd);
  }
  c.querySelectorAll('.subtab-btn').forEach(b=>b.addEventListener('click',()=>switchCompanyTab(b.dataset.tab)));
  switchCompanyTab('overview');
}

// ── Company: Overview ─────────────────────────────
async function renderCompanyOverview(ct, canAdd) {
  // Always show Neil Barro as president — fetch his Firestore profile by email
  let photoURL = '';
  const presidentName = 'Neil Barro';
  try {
    const presSnap = await db.collection('users').where('email','==','neilbarro870@gmail.com').limit(1).get();
    if (!presSnap.empty) {
      const pd = presSnap.docs[0].data();
      photoURL = pd.photoUrl || pd.photoURL || '';
    }
  } catch(e) { /* non-critical */ }
  const initials = 'NB';
  ct.innerHTML = `
    <!-- Hero Banner -->
    <div class="co-hero">
      <div class="co-hero-bg"></div>
      <img src="icons/barro-industries.png" class="co-hero-logo" alt="Barro Industries" onerror="this.style.display='none'"/>
      <div class="co-hero-text">
        <h1 class="co-hero-title">BARRO INDUSTRIES</h1>
        <p class="co-hero-tagline">Building the Future, Brick by Brick.</p>
      </div>
    </div>

    <!-- About -->
    <div class="co-section">
      <h3 class="co-section-title">About the Company</h3>
      <p class="co-body">
        <strong>Barro Industries OPC</strong> is a manufacturing company built on precision, quality, and a commitment to
        long-term growth. We design and produce products that meet the demands of today's market while laying the groundwork
        for tomorrow's innovations. Our ambition extends beyond current operations — with a clear direction toward research
        and development as we continue to scale and evolve.
      </p>
      <p class="co-body" style="margin-top:10px">
        Driven by a lean, capable team and a culture of accountability, Barro Industries OPC operates with the discipline
        of a company that builds for the long run — not just the next quarter.
      </p>
    </div>

    <!-- Trademark -->
    <div class="co-section">
      <h3 class="co-section-title">Our Brand</h3>
      <div class="co-biz-grid">
        <div class="co-biz-card">
          <img src="icons/barro-industries.png" class="co-biz-logo" alt="Barro Industries OPC" onerror="this.style.display='none'"/>
          <div class="co-biz-info">
            <div class="co-biz-name">Barro Industries OPC</div>
            <div class="co-biz-desc">The company. A manufacturing business focused on building quality products and systems, with a long-term vision toward research and development.</div>
            <span class="badge badge-gold">Company</span>
          </div>
        </div>
        <div class="co-biz-card">
          <img src="icons/barrokit.png" class="co-biz-logo" alt="Barro Kitchens" onerror="this.style.display='none'"/>
          <div class="co-biz-info">
            <div class="co-biz-name">Barro Kitchens™</div>
            <div class="co-biz-desc">A registered trademark of Barro Industries OPC. One-stop shop for kitchen design and build — from concept to completion, residential and commercial.</div>
            <span class="badge badge-blue">Trademark</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Vision -->
    <div class="co-section">
      <h3 class="co-section-title">Where We're Headed</h3>
      <div class="co-biz-grid" style="grid-template-columns:1fr 1fr">
        <div class="co-value-card">
          <div class="co-value-icon" style="background:rgba(255,214,10,0.12)"><i data-lucide="factory" style="width:20px;height:20px;stroke:var(--gold)"></i></div>
          <div class="co-value-name">Manufacturing</div>
          <div class="co-value-desc">Our foundation. We build with precision and hold our products to the highest standard.</div>
        </div>
        <div class="co-value-card">
          <div class="co-value-icon" style="background:rgba(10,132,255,0.10)"><i data-lucide="flask-conical" style="width:20px;height:20px;stroke:#0A84FF"></i></div>
          <div class="co-value-name">R&amp;D (Future Direction)</div>
          <div class="co-value-desc">We are building toward a research and development capability — innovating products and processes for sustainable, scalable growth.</div>
        </div>
      </div>
    </div>

    <!-- President's Message -->
    <div class="co-section">
      <h3 class="co-section-title">Message from the President</h3>
      <div class="co-president-card">
        <div class="co-president-left">
          ${photoURL
            ? `<img src="${photoURL}" class="co-president-photo" alt="President"/>`
            : `<div class="co-president-initials">${initials}</div>`
          }
          <div class="co-president-name">${presidentName}</div>
          <div class="co-president-title">President<br>Barro Industries</div>
        </div>
        <div class="co-president-msg">
          <div class="co-quote-mark">"</div>
          <p>
            Every business we build, every team we grow, and every decision we make is driven by one
            conviction: that we are here to create something that lasts. Barro Industries was not built
            overnight, and it will not stop growing anytime soon.
          </p>
          <p>
            To every member of this team — your work matters. Each task you complete, each client you
            serve, and each day you show up is a brick in the foundation of something bigger than any
            one of us. I ask you to bring your best, stay accountable, and take ownership of your role
            in this company's story.
          </p>
          <p>
            To our partners — thank you for trusting us. Our relationship is built on quality and
            reliability, and we intend to keep it that way.
          </p>
          <p style="margin-top:16px;font-style:normal;font-weight:600;color:var(--gold)">
            — Building the Future, Brick by Brick.
          </p>
        </div>
      </div>
    </div>

    <!-- Core Values -->
    <div class="co-section">
      <h3 class="co-section-title">Our Core Values</h3>
      <div class="co-values-grid">
        <div class="co-value-card">
          <div class="co-value-icon" style="background:rgba(255,214,10,0.12)"><i data-lucide="star" style="width:20px;height:20px;stroke:var(--gold)"></i></div>
          <div class="co-value-name">Excellence</div>
          <div class="co-value-desc">We do not settle for good enough. Every output is a reflection of our brand.</div>
        </div>
        <div class="co-value-card">
          <div class="co-value-icon" style="background:rgba(52,199,89,0.10)"><i data-lucide="shield-check" style="width:20px;height:20px;stroke:#34C759"></i></div>
          <div class="co-value-name">Integrity</div>
          <div class="co-value-desc">We operate with transparency and do what we say we will do.</div>
        </div>
        <div class="co-value-card">
          <div class="co-value-icon" style="background:rgba(10,132,255,0.10)"><i data-lucide="users" style="width:20px;height:20px;stroke:#0A84FF"></i></div>
          <div class="co-value-name">People First</div>
          <div class="co-value-desc">Our team and our clients are at the center of every decision we make.</div>
        </div>
        <div class="co-value-card">
          <div class="co-value-icon" style="background:rgba(255,149,0,0.10)"><i data-lucide="trending-up" style="width:20px;height:20px;stroke:#FF9500"></i></div>
          <div class="co-value-name">Growth</div>
          <div class="co-value-desc">We invest in continuous improvement — for the business and for each individual.</div>
        </div>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [ct] });
}

// ── Company: Memos ────────────────────────────────
async function renderCompanyMemos(ct, canAdd) {
  ct.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted)">Official memos from management</div>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-memo-btn">+ New Memo</button>`:''}
    </div>
    <div id="memos-list"><div class="loading-placeholder">Loading…</div></div>
  `;
  const snap = await db.collection('memos').orderBy('createdAt','desc').get();
  const memos = snap.docs.map(d=>({id:d.id,...d.data()}));
  const list = document.getElementById('memos-list');
  if (!memos.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><h4>No memos yet</h4><p>Management memos will appear here.</p></div>`;
  } else {
    list.innerHTML = memos.map(m=>{
      const d = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
      return `<div class="co-doc-card" data-id="${m.id}">
        <div class="co-doc-icon" style="background:rgba(10,132,255,0.10)"><i data-lucide="file-text" style="width:18px;height:18px;stroke:#0A84FF"></i></div>
        <div class="co-doc-body">
          <div class="co-doc-title">${m.title}</div>
          <div class="co-doc-meta">From: ${m.from||'Management'} &nbsp;·&nbsp; ${d.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'})}</div>
          <div class="co-doc-preview">${(m.content||'').slice(0,120)}${m.content?.length>120?'…':''}</div>
        </div>
        ${canAdd?`<button class="btn-icon co-del-btn" data-id="${m.id}" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px;stroke:var(--danger)"></i></button>`:''}
      </div>`;
    }).join('');
    list.querySelectorAll('.co-doc-card').forEach(card=>{
      card.addEventListener('click', e=>{
        if(e.target.closest('.co-del-btn')) return;
        const m=memos.find(x=>x.id===card.dataset.id);
        const d=m.createdAt?.toDate?m.createdAt.toDate():new Date();
        openModal(m.title,`
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">From: ${m.from||'Management'} &nbsp;·&nbsp; ${d.toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}</div>
          <p style="font-size:14px;line-height:1.8;white-space:pre-wrap;color:var(--text-2)">${m.content||''}</p>
          ${m.fileUrl?`<a href="${m.fileUrl}" target="_blank" class="btn-secondary" style="display:inline-block;margin-top:14px">📎 Open Attachment</a>`:''}
          ${canAdd?`<hr class="divider"/><button class="btn-danger" id="del-memo-btn" data-id="${m.id}">Delete Memo</button>`:''}
        `);
        document.getElementById('del-memo-btn')?.addEventListener('click',async e2=>{if(confirm('Delete this memo?')){await db.collection('memos').doc(e2.currentTarget.dataset.id).delete();closeModal();renderCompanyMemos(ct,canAdd);}});
      });
    });
    list.querySelectorAll('.co-del-btn').forEach(btn=>{
      btn.addEventListener('click',async e=>{e.stopPropagation();if(confirm('Delete this memo?')){await db.collection('memos').doc(btn.dataset.id).delete();renderCompanyMemos(ct,canAdd);}});
    });
    if(window.lucide) lucide.createIcons({nodes:[list]});
  }
  document.getElementById('add-memo-btn')?.addEventListener('click',()=>{
    openModal('New Memo',`
      <div class="form-group"><label>Memo Title</label><input id="memo-title" placeholder="e.g. Updated Leave Policy"/></div>
      <div class="form-group"><label>From</label><input id="memo-from" placeholder="Management / HR / Finance" value="${currentUser?.displayName||'Management'}"/></div>
      <div class="form-group"><label>Content</label><textarea id="memo-content" rows="8" placeholder="Write the memo here…"></textarea></div>
      <div id="memo-file-upload"></div>
    `,`<button class="btn-primary" id="save-memo-btn">Publish Memo</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let uploadedFile=null;
    Drive.renderUploadArea('memo-file-upload',r=>{uploadedFile=r;},{label:'Attach document (optional)',dept:'Admin',subfolder:'Memos'});
    document.getElementById('save-memo-btn').addEventListener('click',async()=>{
      const title=document.getElementById('memo-title').value.trim();
      if(!title) return;
      await db.collection('memos').add({title,from:document.getElementById('memo-from').value.trim(),content:document.getElementById('memo-content').value,fileUrl:uploadedFile?.url||null,addedBy:currentUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal(); renderCompanyMemos(ct,canAdd);
    });
  });
  if(window.lucide) lucide.createIcons({nodes:[ct]});
}

// ── Company: Policies ─────────────────────────────
async function renderCompanyPolicies(ct, canAdd) {
  ct.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted)">Company rules, regulations, and official policies</div>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-policy-btn">+ Add Policy</button>`:''}
    </div>
    <div class="policy-grid" id="policy-grid"><div class="loading-placeholder">Loading…</div></div>
  `;
  const snap = await db.collection('policies').orderBy('createdAt','desc').get();
  const policies = snap.docs.map(d=>({id:d.id,...d.data()}));
  const grid = document.getElementById('policy-grid');
  if (!policies.length) {
    grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📄</div><h4>No policies yet</h4><p>Add company policies and they'll appear here.</p></div>`;
  } else {
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
        openModal(p.title,`<p style="font-size:14px;line-height:1.7;white-space:pre-wrap;color:var(--text-2)">${p.content||'No content.'}</p>${p.fileUrl?`<a href="${p.fileUrl}" target="_blank" class="btn-secondary" style="display:inline-block;margin-top:14px">📎 Open File</a>`:''}${canAdd?`<hr class="divider"/><button class="btn-danger" id="del-policy-btn" data-id="${p.id}">Delete</button>`:''}`);
        document.getElementById('del-policy-btn')?.addEventListener('click',async e2=>{if(confirm('Delete?')){await db.collection('policies').doc(e2.currentTarget.dataset.id).delete();closeModal();renderCompanyPolicies(ct,canAdd);}});
      });
    });
  }
  document.getElementById('add-policy-btn')?.addEventListener('click',()=>{
    openModal('Add Policy',`
      <div class="form-group"><label>Title</label><input id="pol-title"/></div>
      <div class="form-group"><label>Icon</label><input id="pol-icon" placeholder="📄" maxlength="4"/></div>
      <div class="form-group"><label>Short Description</label><input id="pol-desc"/></div>
      <div class="form-group"><label>Full Content</label><textarea id="pol-content" rows="6"></textarea></div>
      <div id="pol-file-upload"></div>
    `,`<button class="btn-primary" id="save-pol-btn">Save Policy</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let uploadedFile=null;
    Drive.renderUploadArea('pol-file-upload',r=>{uploadedFile=r;},{label:'Attach document',dept:'Admin',subfolder:'Policies'});
    document.getElementById('save-pol-btn').addEventListener('click',async()=>{
      const title=document.getElementById('pol-title').value.trim(); if(!title) return;
      await db.collection('policies').add({title,icon:document.getElementById('pol-icon').value.trim()||'📄',description:document.getElementById('pol-desc').value.trim(),content:document.getElementById('pol-content').value,fileUrl:uploadedFile?.url||null,addedBy:currentUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal(); renderCompanyPolicies(ct,canAdd);
    });
  });
}

// ── Company: Downloads ────────────────────────────
async function renderCompanyDownloads(ct, canAdd) {
  ct.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted)">Forms, templates, and official documents for download</div>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-dl-btn">+ Upload Resource</button>`:''}
    </div>
    <div id="downloads-list"><div class="loading-placeholder">Loading…</div></div>
  `;
  const snap = await db.collection('resources').orderBy('createdAt','desc').get();
  const docs = snap.docs.map(d=>({id:d.id,...d.data()}));
  const list = document.getElementById('downloads-list');

  const catIcons = { Forms:'file-plus', Templates:'layout-template', Reports:'bar-chart-2', Others:'folder' };
  const catColors = { Forms:'#34C759', Templates:'#0A84FF', Reports:'#FF9500', Others:'#9e9e9e' };

  if (!docs.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📥</div><h4>No downloads yet</h4><p>Upload forms, templates, and documents for the team.</p></div>`;
  } else {
    // Group by category
    const cats = [...new Set(docs.map(d=>d.category||'Others'))];
    list.innerHTML = cats.map(cat=>{
      const items = docs.filter(d=>(d.category||'Others')===cat);
      const icon = catIcons[cat]||'folder';
      const color = catColors[cat]||'#9e9e9e';
      return `<div style="margin-bottom:20px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:10px">${cat}</div>
        ${items.map(d=>`
          <a href="${d.fileUrl||'#'}" target="_blank" rel="noopener" class="co-dl-row" data-id="${d.id}">
            <div class="co-dl-icon" style="background:${color}18"><i data-lucide="${icon}" style="width:16px;height:16px;stroke:${color}"></i></div>
            <div class="co-dl-info">
              <div class="co-dl-name">${d.title}</div>
              <div class="co-dl-desc">${d.description||''}</div>
            </div>
            <i data-lucide="download" style="width:16px;height:16px;stroke:var(--text-muted);flex-shrink:0"></i>
            ${canAdd?`<button class="btn-icon co-del-btn" data-id="${d.id}" style="margin-left:4px" title="Delete"><i data-lucide="trash-2" style="width:13px;height:13px;stroke:var(--danger)"></i></button>`:''}
          </a>`).join('')}
      </div>`;
    }).join('');
    list.querySelectorAll('.co-del-btn').forEach(btn=>{
      btn.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();if(confirm('Remove this resource?')){await db.collection('resources').doc(btn.dataset.id).delete();renderCompanyDownloads(ct,canAdd);}});
    });
  }
  if(window.lucide) lucide.createIcons({nodes:[list]});

  document.getElementById('add-dl-btn')?.addEventListener('click',()=>{
    openModal('Upload Resource',`
      <div class="form-group"><label>Title</label><input id="dl-title" placeholder="e.g. Daily Time Record Form"/></div>
      <div class="form-group"><label>Category</label>
        <select id="dl-cat"><option value="Forms">Forms</option><option value="Templates">Templates</option><option value="Reports">Reports</option><option value="Others">Others</option></select>
      </div>
      <div class="form-group"><label>Description (optional)</label><input id="dl-desc" placeholder="Short description"/></div>
      <div id="dl-file-upload"></div>
    `,`<button class="btn-primary" id="save-dl-btn">Upload</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let uploadedFile=null;
    Drive.renderUploadArea('dl-file-upload',r=>{uploadedFile=r;},{label:'Select file to upload',dept:'Admin',subfolder:'Resources'});
    document.getElementById('save-dl-btn').addEventListener('click',async()=>{
      const title=document.getElementById('dl-title').value.trim(); if(!title||!uploadedFile) return;
      await db.collection('resources').add({title,category:document.getElementById('dl-cat').value,description:document.getElementById('dl-desc').value.trim(),fileUrl:uploadedFile.url,source:uploadedFile.source,addedBy:currentUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal(); renderCompanyDownloads(ct,canAdd);
    });
  });
}

// ── Company: Handbook ─────────────────────────────
async function renderCompanyHandbook(ct, canAdd) {
  // Try to load a custom handbook from Firestore; fall back to built-in default
  const snap = await db.collection('handbook').orderBy('order','asc').get().catch(()=>({docs:[]}));
  const sections = snap.docs.map(d=>({id:d.id,...d.data()}));

  const defaultSections = [
    { title:'Welcome to Barro Industries', icon:'home', content:`You are now part of a team committed to building something great. At Barro Industries, we believe that people are our most important asset. This handbook is your guide to understanding how we work, what we expect, and how we take care of each other.\n\nRead it thoroughly. Keep it as a reference. And if you ever have questions, your manager is always the first point of contact.` },
    { title:'Work Hours & Attendance', icon:'clock', content:`Office hours are Monday to Friday, 8:00 AM – 5:00 PM, unless otherwise stated by your department head.\n\n• Full Day: 8 hours of work, logged in the Operations System.\n• Half Day: 4 hours, also logged in the system.\n• Overtime must be pre-approved by your manager.\n• Attendance is logged daily through the Operations app — this affects your KPI score.\n• Three unexcused absences in a month will be reviewed by HR.` },
    { title:'Code of Conduct', icon:'shield-check', content:`All employees are expected to:\n\n• Treat every colleague, client, and partner with respect.\n• Maintain confidentiality of company information.\n• Avoid conflicts of interest and disclose any that arise.\n• Use company resources responsibly and only for work purposes.\n• Report any unethical behavior to your manager immediately.\n\nViolations of this code may result in disciplinary action up to and including termination.` },
    { title:'Performance & KPI', icon:'trending-up', content:`Your performance is evaluated monthly using the KPI system:\n\n• Task Score (70%) — based on tasks completed vs assigned.\n• Deliverable Score (30%) — quality assessment set by the president.\n\nKPI scores affect your monthly final pay. Employees with consistently high KPI scores are prioritized for salary increases and promotions.\n\nKPI results are visible in the Operations System under Personal Finance.` },
    { title:'Salary & Benefits', icon:'credit-card', content:`Salary is processed monthly. Your payslip breakdown is available in the app under Personal Finance:\n\n• Base Salary — your fixed monthly rate.\n• Allowances — transportation, meal, or other allowances as applicable.\n• Deductions — SSS, PhilHealth, Pag-IBIG, withholding tax.\n• KPI Adjustment — bonus or adjustment based on your monthly KPI score.\n• Final Pay — your take-home amount.\n\nYear-to-Date (YTD) totals are visible in the app.` },
    { title:'Leave Policy', icon:'calendar', content:`Employees are entitled to:\n\n• Vacation Leave: 15 days per year (prorated for new hires)\n• Sick Leave: 15 days per year\n• Special Leave as required by law (maternity, paternity, solo parent, etc.)\n\nLeave requests must be filed at least 2 business days in advance except for emergencies. Submit leave requests through your manager. Unused vacation leave may be converted to cash at year-end subject to company guidelines.` },
    { title:'Cash Advance Policy', icon:'banknote', content:`Employees may request a cash advance through the Operations System.\n\n• Maximum CA is 50% of monthly net salary.\n• Must specify repayment date (typically deducted from next salary).\n• Requires management approval before disbursement.\n• Only one active CA per employee at a time.\n• Repeated CAs without full repayment may be declined.\n\nSubmit requests through Personal Finance → Cash Advance in the app.` },
    { title:'Confidentiality', icon:'lock', content:`All company information — client data, financial records, pricing, strategies, and internal communications — is confidential.\n\n• Do not share internal information with unauthorized parties.\n• Do not discuss client projects on personal social media.\n• Confidentiality obligations continue even after employment ends.\n\nViolation of this policy is grounds for immediate termination and may result in legal action.` },
  ];

  const displaySections = sections.length ? sections : defaultSections;
  ct.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted)">Employee Handbook — policies, conduct, and benefits</div>
      ${canAdd?`<button class="btn-secondary btn-sm" id="add-handbook-btn">+ Add Section</button>`:''}
    </div>
    <div class="handbook-accordion" id="handbook-content">
      ${displaySections.map((s,i)=>`
        <div class="handbook-item" data-idx="${i}">
          <button class="handbook-header">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="handbook-icon"><i data-lucide="${s.icon||'file-text'}" style="width:15px;height:15px;stroke:var(--gold)"></i></div>
              <span>${s.title}</span>
            </div>
            <i data-lucide="chevron-down" class="handbook-chevron" style="width:16px;height:16px;stroke:var(--text-muted)"></i>
          </button>
          <div class="handbook-body hidden"><pre class="handbook-text">${s.content||''}</pre></div>
        </div>
      `).join('')}
    </div>
  `;
  ct.querySelectorAll('.handbook-header').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const item=btn.closest('.handbook-item');
      const body=item.querySelector('.handbook-body');
      const chev=item.querySelector('.handbook-chevron');
      const open=!body.classList.contains('hidden');
      body.classList.toggle('hidden',open);
      chev.style.transform=open?'':'rotate(180deg)';
    });
  });
  if(window.lucide) lucide.createIcons({nodes:[ct]});

  document.getElementById('add-handbook-btn')?.addEventListener('click',()=>{
    openModal('Add Handbook Section',`
      <div class="form-group"><label>Section Title</label><input id="hb-title"/></div>
      <div class="form-group"><label>Icon (Lucide name)</label><input id="hb-icon" placeholder="e.g. file-text, clock, shield-check" value="file-text"/></div>
      <div class="form-group"><label>Content</label><textarea id="hb-content" rows="8" placeholder="Write section content…"></textarea></div>
    `,`<button class="btn-primary" id="save-hb-btn">Add Section</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-hb-btn').addEventListener('click',async()=>{
      const title=document.getElementById('hb-title').value.trim(); if(!title) return;
      const order = sections.length + defaultSections.length;
      await db.collection('handbook').add({title,icon:document.getElementById('hb-icon').value.trim()||'file-text',content:document.getElementById('hb-content').value,order,addedBy:currentUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal(); renderCompanyHandbook(ct,canAdd);
    });
  });
}

// ── Departments ───────────────────────────────────
async function renderDepartments() {
  if (!isPresident() && currentRole !== 'manager') {
    document.getElementById('page-content').innerHTML = renderAccessDenied('Departments');
    return;
  }
  const c = document.getElementById('page-content');

  // All known departments from config + Brilliant Steel
  const allDepts = Object.keys(DEPARTMENTS).filter(k => k !== 'Brilliant Steel');

  c.innerHTML = `
    <div class="page-header">
      <h2>🗂️ Departments</h2>
      <button class="btn-primary btn-sm" id="add-dept-btn">+ Add</button>
    </div>
    <div class="dept-grid" id="dept-grid">
      ${allDepts.map(name => {
        const cfg = DEPARTMENTS[name] || {};
        const subtabs = (cfg.subtabs || []).slice(0, 4);
        return `
          <div class="dept-card dept-card-clickable" data-dept="${name}" style="border-top-color:${cfg.color||'var(--primary-light)'}; cursor:pointer">
            <div class="dept-icon-large">${cfg.icon||'🗂️'}</div>
            <div class="dept-name" style="font-weight:700;font-size:14px;margin:4px 0">${name}</div>
            <div class="dept-subtabs-preview">
              ${subtabs.map(s => `<span class="dept-subtab-chip">${s}</span>`).join('')}
            </div>
            <div class="dept-open-hint">Tap to open →</div>
          </div>`;
      }).join('')}
    </div>
  `;

  // Click → open full department module
  c.querySelectorAll('.dept-card-clickable').forEach(card => {
    card.addEventListener('click', () => renderDeptModule(card.dataset.dept));
  });

  document.getElementById('add-dept-btn')?.addEventListener('click', () => {
    openModal('Add Department', `
      <div class="form-group"><label>Name</label>
        <select id="dept-name-sel">
          <option value="">-- Select --</option>
          ${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}
          <option value="custom">Custom…</option>
        </select>
      </div>
      <div class="form-group hidden" id="dept-custom-wrap"><label>Custom Name</label><input id="dept-custom-name"/></div>
      <div class="form-group"><label>Department Head</label><input id="dept-head"/></div>
      <div class="form-group"><label>Members (comma-separated)</label><textarea id="dept-members" rows="3"></textarea></div>
    `, `<button class="btn-primary" id="save-dept-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('dept-name-sel').onchange = function() {
      document.getElementById('dept-custom-wrap').classList.toggle('hidden', this.value !== 'custom');
    };
    document.getElementById('save-dept-btn').addEventListener('click', async () => {
      const sel  = document.getElementById('dept-name-sel').value;
      const name = sel === 'custom' ? document.getElementById('dept-custom-name').value.trim() : sel;
      if (!name) return;
      const members = document.getElementById('dept-members').value.split(',').map(s=>s.trim()).filter(Boolean);
      await db.collection('departments').add({
        name, head: document.getElementById('dept-head').value.trim(),
        members, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); renderDepartments();
    });
  });
}

// ── Analytics ─────────────────────────────────────
async function renderAnalytics() {
  if(!isPresident()&&currentRole!=='manager'&&currentRole!=='finance'){document.getElementById('page-content').innerHTML=renderAccessDenied('Analytics');return;}
  const c=document.getElementById('page-content');
  c.innerHTML='<div class="loading-placeholder">Loading analytics…</div>';
  const safeGet = async (q) => { try { return await q.get(); } catch(e) { return {docs:[],size:0}; } };

  // Fetch all data upfront
  const [usersSnap,tasksSnap,quotesSnap,subsSnap,expSnap,caSnap,payslipSnap,ledgerSnap,govSnap] = await Promise.all([
    safeGet(db.collection('users')),
    safeGet(db.collection('tasks')),
    safeGet(db.collection('quotes')),
    safeGet(db.collection('submissions')),
    safeGet(db.collection('expenses')),
    safeGet(db.collection('cash_advances')),
    safeGet(db.collection('payslips')),
    safeGet(db.collection('ledger_entries')),
    safeGet(db.collection('gov_biddings').orderBy('createdAt','desc')).catch(()=>({docs:[]})),
  ]);
  const users=usersSnap.docs.map(d=>({id:d.id,...d.data()}));
  const tasks=tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
  const quotes=quotesSnap.docs.map(d=>({id:d.id,...d.data()}));
  const subs=subsSnap.docs.map(d=>({id:d.id,...d.data()}));
  const expenses=expSnap.docs.map(d=>({id:d.id,...d.data()}));
  const cas=caSnap.docs.map(d=>({id:d.id,...d.data()}));
  const payslips=payslipSnap.docs.map(d=>({id:d.id,...d.data()}));
  const ledger=ledgerSnap.docs.map(d=>({id:d.id,...d.data()}));
  const govBids=govSnap.docs.map(d=>({id:d.id,...d.data()}));

  const fmt=n=>isNaN(n)?'0':Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const now=new Date(), thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const inMonth=(obj,field='createdAt')=>{
    const v=obj[field];
    if(!v) return false;
    const d=v.toDate?v.toDate():new Date(v);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === thisMonth;
  };

  const SUBTABS = [
    {id:'overview',label:'📊 Overview'},
    {id:'sales',label:'🛒 Sales'},
    {id:'marketing',label:'📣 Marketing'},
    {id:'finance',label:'💰 Finance'},
    {id:'production',label:'🏭 Production'},
    {id:'government',label:'🏛️ Gov. Biddings'},
  ];

  c.innerHTML=`
    <div class="page-header"><h2>📊 Analytics & Performance</h2></div>
    <div class="subtab-bar" id="analytics-subtabs">
      ${SUBTABS.map((t,i)=>`<button class="subtab-btn${i===0?' active':''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="analytics-content"></div>
  `;

  const renderOverview = () => {
    const totalPayroll=users.reduce((s,u)=>s+(u.salary||0)+(u.allowance||0)-(u.deductions||0),0);
    const won=quotes.filter(q=>q.status==='accepted').reduce((s,q)=>s+(q.total||0),0);
    const totalExp=expenses.filter(e=>e.status==='approved').reduce((s,e)=>s+(e.amount||0),0);
    const doneTasks=tasks.filter(t=>['done','approved','archived'].includes(t.status));
    const taskRate=tasks.length?Math.round(doneTasks.length/tasks.length*100):0;
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card"><div class="kpi-label">Team Size</div><div class="kpi-value">${users.length}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Monthly Payroll</div><div class="kpi-value">₱${fmt(totalPayroll)}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Revenue Won</div><div class="kpi-value">₱${fmt(won)}</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Approved Expenses</div><div class="kpi-value">₱${fmt(totalExp)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Task Completion</div><div class="kpi-value">${taskRate}%</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Quote Pipeline</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="q-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Submissions</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="s-chart"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Team Performance</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>Role</th><th>Dept</th><th>Tasks Done</th><th>Net Pay</th></tr></thead>
        <tbody>${users.map(u=>{
          const done=tasks.filter(t=>(Array.isArray(t.assignedTo)?t.assignedTo.includes(u.id):t.assignedTo===u.id)&&['done','approved','archived'].includes(t.status)).length;
          const net=(u.salary||0)+(u.allowance||0)-(u.deductions||0);
          return `<tr><td>${u.displayName||u.email||'—'}</td><td><span class="badge badge-blue">${ROLES[u.role]?.label||u.role||'—'}</span></td><td>${(Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—'}</td><td>${done}</td><td>₱${fmt(net)}</td></tr>`;
        }).join('')}</tbody>
      </table></div></div></div>
    `;
    new Chart(document.getElementById('q-chart'),{type:'bar',data:{labels:['Draft','Sent','Accepted','Rejected'],datasets:[{data:['draft','sent','accepted','rejected'].map(s=>quotes.filter(q=>q.status===s).length),backgroundColor:['#636366','#0A84FF','#30D158','#FF453A']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:'#ebebf5bb'},grid:{color:'#ffffff18'}},x:{ticks:{color:'#ebebf5bb'},grid:{display:false}}}}});
    new Chart(document.getElementById('s-chart'),{type:'doughnut',data:{labels:['Pending','Approved','Rejected'],datasets:[{data:[subs.filter(s=>!s.status||s.status==='pending').length,subs.filter(s=>s.status==='approved').length,subs.filter(s=>s.status==='rejected').length],backgroundColor:['#FF9F0A','#30D158','#FF453A'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#ebebf5bb'}}}}});
  };

  const renderSales = () => {
    const salesQuotes=quotes.filter(q=>q.department==='Sales'||q.type==='sales'||!q.department);
    const won2=salesQuotes.filter(q=>q.status==='accepted').reduce((s,q)=>s+(q.total||0),0);
    const pipeline=salesQuotes.filter(q=>q.status==='sent').reduce((s,q)=>s+(q.total||0),0);
    const wonCount=salesQuotes.filter(q=>q.status==='accepted').length;
    const lostCount=salesQuotes.filter(q=>q.status==='rejected').length;
    const winRate=wonCount+lostCount>0?Math.round(wonCount/(wonCount+lostCount)*100):0;
    const salesSubs=subs.filter(s=>s.department==='Sales'||s.type?.includes('sales'));
    const salesTasks=tasks.filter(t=>t.department==='Sales'||t.category==='Sales');
    const doneSalesTasks=salesTasks.filter(t=>['done','approved','archived'].includes(t.status));
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card green"><div class="kpi-label">Revenue Won</div><div class="kpi-value">₱${fmt(won2)}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Pipeline Value</div><div class="kpi-value">₱${fmt(pipeline)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Win Rate</div><div class="kpi-value">${winRate}%</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Total Quotes</div><div class="kpi-value">${salesQuotes.length}</div></div>
        <div class="kpi-card"><div class="kpi-label">Tasks Done</div><div class="kpi-value">${doneSalesTasks.length}/${salesTasks.length}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Quote Status Breakdown</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="sq-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Monthly Quote Volume</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="sq2-chart"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Recent Quotes</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Client</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${salesQuotes.slice(0,20).map(q=>{
          const d=q.createdAt?.toDate?q.createdAt.toDate():new Date(q.createdAt||0);
          const statusColor={draft:'#636366',sent:'#0A84FF',accepted:'#30D158',rejected:'#FF453A'}[q.status]||'#636366';
          return `<tr><td>${q.clientName||q.client||'—'}</td><td>₱${fmt(q.total||q.amount||0)}</td><td><span style="color:${statusColor};font-weight:600">${q.status||'draft'}</span></td><td>${d.toLocaleDateString()}</td></tr>`;
        }).join('')}</tbody>
      </table></div></div></div>
    `;
    const statuses=['draft','sent','accepted','rejected'];
    new Chart(document.getElementById('sq-chart'),{type:'bar',data:{labels:statuses.map(s=>s.charAt(0).toUpperCase()+s.slice(1)),datasets:[{data:statuses.map(s=>salesQuotes.filter(q=>q.status===s).length),backgroundColor:['#636366','#0A84FF','#30D158','#FF453A']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:'#ebebf5bb'},grid:{color:'#ffffff18'}},x:{ticks:{color:'#ebebf5bb'},grid:{display:false}}}}});
    // last 6 months volume
    const months=[],counts=[];
    for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push(d.toLocaleString('default',{month:'short'}));counts.push(salesQuotes.filter(q=>{const qd=q.createdAt?.toDate?q.createdAt.toDate():new Date(q.createdAt||0);return qd.getMonth()===d.getMonth()&&qd.getFullYear()===d.getFullYear();}).length);}
    new Chart(document.getElementById('sq2-chart'),{type:'line',data:{labels:months,datasets:[{label:'Quotes',data:counts,borderColor:'#0A84FF',backgroundColor:'#0A84FF22',fill:true,tension:0.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:'#ebebf5bb'},grid:{color:'#ffffff18'}},x:{ticks:{color:'#ebebf5bb'},grid:{display:false}}}}});
  };

  const renderMarketing = () => {
    const mktTasks=tasks.filter(t=>t.department==='Marketing'||t.category==='Marketing');
    const doneMkt=mktTasks.filter(t=>['done','approved','archived'].includes(t.status));
    const mktSubs=subs.filter(s=>s.department==='Marketing');
    const mktExp=expenses.filter(e=>e.department==='Marketing'&&e.status==='approved').reduce((s,e)=>s+(e.amount||0),0);
    const mktUsers=users.filter(u=>(Array.isArray(u.departments)?u.departments:u.department?[u.department]:[]).includes('Marketing'));
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card"><div class="kpi-label">Team Members</div><div class="kpi-value">${mktUsers.length}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Tasks</div><div class="kpi-value">${mktTasks.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Completed</div><div class="kpi-value">${doneMkt.length}</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Budget Used</div><div class="kpi-value">₱${fmt(mktExp)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Submissions</div><div class="kpi-value">${mktSubs.length}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Task Completion Rate</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="mkt-task-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Task Status Breakdown</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="mkt-status-chart"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Marketing Team</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>Role</th><th>Tasks Done</th><th>Tasks Active</th></tr></thead>
        <tbody>${mktUsers.map(u=>{
          const uTasks=mktTasks.filter(t=>Array.isArray(t.assignedTo)?t.assignedTo.includes(u.id):t.assignedTo===u.id);
          const uDone=uTasks.filter(t=>['done','approved','archived'].includes(t.status)).length;
          const uActive=uTasks.filter(t=>['todo','in-progress','review'].includes(t.status)).length;
          return `<tr><td>${u.displayName||u.email||'—'}</td><td><span class="badge badge-blue">${ROLES[u.role]?.label||u.role}</span></td><td>${uDone}</td><td>${uActive}</td></tr>`;
        }).join('')}</tbody>
      </table></div></div></div>
    `;
    const taskStatuses=['todo','in-progress','review','done','approved','archived'];
    const statusCounts=taskStatuses.map(s=>mktTasks.filter(t=>t.status===s).length);
    new Chart(document.getElementById('mkt-task-chart'),{type:'doughnut',data:{labels:['Done','Active'],datasets:[{data:[doneMkt.length,mktTasks.length-doneMkt.length],backgroundColor:['#30D158','#636366'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#ebebf5bb'}}}}});
    new Chart(document.getElementById('mkt-status-chart'),{type:'bar',data:{labels:taskStatuses.map(s=>s.charAt(0).toUpperCase()+s.slice(1)),datasets:[{data:statusCounts,backgroundColor:'#FF9F0A'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:'#ebebf5bb'},grid:{color:'#ffffff18'}},x:{ticks:{color:'#ebebf5bb',font:{size:10}},grid:{display:false}}}}});
  };

  const renderFinanceAnalytics = () => {
    const totalPayroll=users.reduce((s,u)=>s+(u.salary||0)+(u.allowance||0)-(u.deductions||0),0);
    const disbursed=ledger.filter(l=>l.type==='payslip').reduce((s,l)=>s+(l.amount||0),0);
    const disbursedThisMonth=ledger.filter(l=>l.type==='payslip'&&inMonth(l)).reduce((s,l)=>s+(l.amount||0),0);
    const caTotal=cas.filter(a=>a.status==='approved').reduce((s,a)=>s+(a.amount||0),0);
    const caPending=cas.filter(a=>a.status==='pending').length;
    const totalExp=expenses.filter(e=>e.status==='approved').reduce((s,e)=>s+(e.amount||0),0);
    const expThisMonth=expenses.filter(e=>e.status==='approved'&&inMonth(e)).reduce((s,e)=>s+(e.amount||0),0);
    const payslipsThisMonth=payslips.filter(p=>inMonth(p));
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card accent"><div class="kpi-label">Total Payroll (Est.)</div><div class="kpi-value">₱${fmt(totalPayroll)}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Disbursed This Month</div><div class="kpi-value">₱${fmt(disbursedThisMonth)}</div></div>
        <div class="kpi-card warn"><div class="kpi-label">CA Outstanding</div><div class="kpi-value">₱${fmt(caTotal)}</div></div>
        <div class="kpi-card"><div class="kpi-label">CA Pending</div><div class="kpi-value">${caPending}</div></div>
        <div class="kpi-card"><div class="kpi-label">Expenses This Month</div><div class="kpi-value">₱${fmt(expThisMonth)}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Expense Categories</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="fin-exp-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Cash Advance Status</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="fin-ca-chart"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Payslips — This Month (${payslipsThisMonth.length})</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Worker</th><th>Pay Period</th><th>Gross</th><th>Net</th><th>Prepared By</th></tr></thead>
        <tbody>${payslipsThisMonth.slice(0,20).map(p=>`<tr><td>${p.workerName||'—'}</td><td>${p.periodLabel||p.payPeriod||'—'}</td><td>₱${fmt(p.grossPay||0)}</td><td>₱${fmt(p.netPay||0)}</td><td>${p.preparedBy||'—'}</td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No payslips this month</td></tr>'}</tbody>
      </table></div></div></div>
    `;
    const cats=[...new Set(expenses.map(e=>e.category||'Other'))].slice(0,6);
    const catAmts=cats.map(cat=>expenses.filter(e=>e.category===cat&&e.status==='approved').reduce((s,e)=>s+(e.amount||0),0));
    new Chart(document.getElementById('fin-exp-chart'),{type:'bar',data:{labels:cats,datasets:[{data:catAmts,backgroundColor:'#0A84FF'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:'#ebebf5bb'},grid:{color:'#ffffff18'}},x:{ticks:{color:'#ebebf5bb',font:{size:10}},grid:{display:false}}}}});
    new Chart(document.getElementById('fin-ca-chart'),{type:'doughnut',data:{labels:['Approved','Pending','Rejected'],datasets:[{data:[cas.filter(a=>a.status==='approved').length,cas.filter(a=>a.status==='pending').length,cas.filter(a=>a.status==='rejected').length],backgroundColor:['#30D158','#FF9F0A','#FF453A'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#ebebf5bb'}}}}});
  };

  const renderProduction = () => {
    const prodTasks=tasks.filter(t=>t.department==='Production'||t.category==='Production');
    const doneProd=prodTasks.filter(t=>['done','approved','archived'].includes(t.status));
    const prodUsers=users.filter(u=>(Array.isArray(u.departments)?u.departments:u.department?[u.department]:[]).includes('Production'));
    const prodSubs=subs.filter(s=>s.department==='Production');
    const prodDoneMonth=prodTasks.filter(t=>['done','approved','archived'].includes(t.status)&&inMonth(t,'updatedAt'));
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card"><div class="kpi-label">Team Size</div><div class="kpi-value">${prodUsers.length}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Total Tasks</div><div class="kpi-value">${prodTasks.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Completed</div><div class="kpi-value">${doneProd.length}</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Done This Month</div><div class="kpi-value">${prodDoneMonth.length}</div></div>
        <div class="kpi-card"><div class="kpi-label">Submissions</div><div class="kpi-value">${prodSubs.length}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Task Status</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="prod-status-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Output Per Member</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="prod-member-chart"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Production Tasks</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Task</th><th>Status</th><th>Assigned</th><th>Priority</th></tr></thead>
        <tbody>${prodTasks.slice(0,20).map(t=>{
          const assignedNames=(Array.isArray(t.assignedTo)?t.assignedTo:[t.assignedTo]).map(uid=>users.find(u=>u.id===uid)?.displayName||'?').join(', ');
          const sc={todo:'#636366','in-progress':'#0A84FF',review:'#FF9F0A',done:'#30D158',approved:'#30D158',archived:'#636366'}[t.status]||'#636366';
          return `<tr><td>${t.title||'—'}</td><td><span style="color:${sc};font-weight:600">${t.status||'—'}</span></td><td>${assignedNames||'—'}</td><td>${t.priority||'—'}</td></tr>`;
        }).join('')}</tbody>
      </table></div></div></div>
    `;
    const taskStatuses=['todo','in-progress','review','done','approved'];
    new Chart(document.getElementById('prod-status-chart'),{type:'doughnut',data:{labels:taskStatuses.map(s=>s.charAt(0).toUpperCase()+s.slice(1)),datasets:[{data:taskStatuses.map(s=>prodTasks.filter(t=>t.status===s).length),backgroundColor:['#636366','#0A84FF','#FF9F0A','#30D158','#34C759'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#ebebf5bb'}}}}});
    const topMembers=prodUsers.slice(0,8);
    new Chart(document.getElementById('prod-member-chart'),{type:'bar',data:{labels:topMembers.map(u=>(u.displayName||u.email||'?').split(' ')[0]),datasets:[{label:'Done',data:topMembers.map(u=>prodTasks.filter(t=>(Array.isArray(t.assignedTo)?t.assignedTo.includes(u.id):t.assignedTo===u.id)&&['done','approved','archived'].includes(t.status)).length),backgroundColor:'#30D158'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:'#ebebf5bb'},grid:{color:'#ffffff18'}},x:{ticks:{color:'#ebebf5bb',font:{size:10}},grid:{display:false}}}}});
  };

  const renderGovernment = () => {
    const wonBids=govBids.filter(b=>b.status==='won');
    const lostBids=govBids.filter(b=>b.status==='lost');
    const pendingBids=govBids.filter(b=>!b.status||b.status==='pending'||b.status==='submitted');
    const totalWon=wonBids.reduce((s,b)=>s+(b.contractAmount||b.bidAmount||0),0);
    const totalBid=govBids.reduce((s,b)=>s+(b.bidAmount||b.contractAmount||0),0);
    const winRate=wonBids.length+lostBids.length>0?Math.round(wonBids.length/(wonBids.length+lostBids.length)*100):0;
    // fallback if govBids is empty — show from tasks tagged as gov
    const govTasks=tasks.filter(t=>t.department==='Government Biddings'||t.category==='Government'||t.category==='Gov Biddings');
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card green"><div class="kpi-label">Contracts Won</div><div class="kpi-value">₱${fmt(totalWon)}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Total Bids</div><div class="kpi-value">${govBids.length}</div></div>
        <div class="kpi-card"><div class="kpi-label">Win Rate</div><div class="kpi-value">${winRate}%</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Pending / Submitted</div><div class="kpi-value">${pendingBids.length}</div></div>
        <div class="kpi-card"><div class="kpi-label">Gov Tasks</div><div class="kpi-value">${govTasks.length}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Bid Outcomes</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="gov-outcome-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Gov Department Tasks</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="gov-task-chart"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Bidding Records</h3></div><div class="card-body">${govBids.length?`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Project</th><th>Agency</th><th>Bid Amount</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${govBids.slice(0,20).map(b=>{
          const d=b.createdAt?.toDate?b.createdAt.toDate():new Date(b.createdAt||0);
          const sc={won:'#30D158',lost:'#FF453A',pending:'#FF9F0A',submitted:'#0A84FF'}[b.status]||'#636366';
          return `<tr><td>${b.projectName||b.title||'—'}</td><td>${b.agency||'—'}</td><td>₱${fmt(b.bidAmount||b.contractAmount||0)}</td><td><span style="color:${sc};font-weight:600">${b.status||'pending'}</span></td><td>${d.toLocaleDateString()}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`:`<p style="color:var(--text-muted);padding:16px;text-align:center">No bidding records found. Add records to the <code>gov_biddings</code> collection in Firestore.</p>`}</div></div>
    `;
    new Chart(document.getElementById('gov-outcome-chart'),{type:'doughnut',data:{labels:['Won','Lost','Pending'],datasets:[{data:[wonBids.length,lostBids.length,pendingBids.length],backgroundColor:['#30D158','#FF453A','#FF9F0A'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#ebebf5bb'}}}}});
    const govStatuses=['todo','in-progress','review','done'];
    new Chart(document.getElementById('gov-task-chart'),{type:'bar',data:{labels:govStatuses.map(s=>s.charAt(0).toUpperCase()+s.slice(1)),datasets:[{data:govStatuses.map(s=>govTasks.filter(t=>t.status===s).length),backgroundColor:'#9BA8FF'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:'#ebebf5bb'},grid:{color:'#ffffff18'}},x:{ticks:{color:'#ebebf5bb'},grid:{display:false}}}}});
  };

  const TAB_RENDERERS = {
    overview: renderOverview,
    sales: renderSales,
    marketing: renderMarketing,
    finance: renderFinanceAnalytics,
    production: renderProduction,
    government: renderGovernment,
  };

  // Wire subtab clicks
  document.getElementById('analytics-subtabs').querySelectorAll('.subtab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('#analytics-subtabs .subtab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      TAB_RENDERERS[btn.dataset.tab]?.();
    });
  });

  // Load initial tab
  renderOverview();
}

// ── Team / Payroll ────────────────────────────────
async function renderTeam() {
  if(!isPresident()&&currentRole!=='manager'){document.getElementById('page-content').innerHTML=renderAccessDenied('Team');return;}
  const c=document.getElementById('page-content');
  c.innerHTML=`
    <div class="page-header">
      <h2>👥 Team & Payroll</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary btn-sm" id="add-worker-btn">👷 Create Worker Account</button>
        <button class="btn-primary btn-sm" id="add-emp-btn">+ Add Employee Profile</button>
      </div>
    </div>
    <div id="team-table"><div class="loading-placeholder">Loading…</div></div>`;
  const snap=await dbCachedGet('users', () => db.collection('users').get(), 60000);
  const users=snap.docs.map(d=>({id:d.id,...d.data()}));
  document.getElementById('team-table').innerHTML=`<div class="card"><div class="table-wrap"><table class="data-table">
    <thead><tr><th>Employee</th><th>Username</th><th>ID</th><th>Role</th><th>Departments</th><th>Base</th><th>Net</th><th></th></tr></thead>
    <tbody>${users.map(u=>{const net=(u.salary||0)+(u.allowance||0)-(u.deductions||0);const depts=(Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—';return `<tr>
      <td>${u.displayName||u.email}</td>
      <td>${u.username?`<code style="font-size:11px">${u.username}</code>`:'<span style="color:var(--text-muted);font-size:11px">email login</span>'}</td>
      <td><code style="font-size:11px">${u.employeeId||'—'}</code></td>
      <td><span class="badge badge-blue">${ROLES[u.role]?.label||u.role}</span></td>
      <td>${depts}</td>
      <td>₱${formatNum(u.salary)}</td>
      <td><strong>₱${formatNum(net)}</strong></td>
      <td><button class="btn-icon edit-emp-btn" data-uid="${u.id}"><i data-lucide="pencil" style="width:14px;height:14px;stroke:currentColor"></i></button></td>
    </tr>`;}).join('')}</tbody>
  </table></div></div>`;
  document.querySelectorAll('.edit-emp-btn').forEach(btn=>btn.addEventListener('click',()=>{const u=users.find(x=>x.id===btn.dataset.uid);if(u)openEditEmployeeModal(u);}));
  document.getElementById('add-emp-btn').addEventListener('click', openAddEmployeeModal);
  document.getElementById('add-worker-btn').addEventListener('click', openCreateWorkerModal);
  if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('team-table')] });
}

function openAddEmployeeModal() {
  openModal('Add Employee Profile',`
    <p style="font-size:12px;color:var(--text-muted);background:var(--surface2);padding:10px;border-radius:8px;margin-bottom:14px">Adds a profile record only. Use <strong>👷 Create Worker Account</strong> to also create a username login.</p>
    <div class="form-group"><label>Display Name</label><input id="emp-name"/></div>
    <div class="form-group"><label>Email (if they have one)</label><input id="emp-email" type="email"/></div>
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
    dbCacheInvalidate('users'); closeModal(); renderTeam();
  });
}

// ── Secondary Firebase app — used only for creating/updating worker accounts
//    so HR's own session is never interrupted
function _getWorkerAuth() {
  try { return firebase.app('worker-admin').auth(); }
  catch { return firebase.initializeApp(window.firebaseConfig, 'worker-admin').auth(); }
}

// ── Create Worker Account (username + password, no email required) ────────
function openCreateWorkerModal() {
  const suggestUsername = () => {
    const name = document.getElementById('cw-name')?.value.trim() || '';
    const parts = name.toLowerCase().replace(/[^a-z0-9 ]/g,'').split(/\s+/).filter(Boolean);
    let uname = '';
    if (parts.length >= 2) uname = parts[0][0] + parts[parts.length-1]; // e.g. jdelacruz
    else if (parts.length === 1) uname = parts[0];
    const el = document.getElementById('cw-username');
    if (el && !el._edited) el.value = uname;
  };

  const initialPw = generatePassword('worker');

  openModal('👷 Create Worker Account', `
    <p style="font-size:12px;color:var(--text-muted);background:var(--surface2);padding:10px;border-radius:8px;margin-bottom:14px">
      Creates a username + password login. The worker does <strong>not</strong> need an email address.
      HR manages all credentials.
    </p>
    <div class="form-row">
      <div class="form-group"><label>Full Name <span style="color:var(--danger)">*</span></label><input id="cw-name" placeholder="e.g. Juan dela Cruz"/></div>
      <div class="form-group"><label>Employee ID</label><input id="cw-eid" placeholder="BI-2026-001"/></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Username <span style="color:var(--danger)">*</span></label>
        <input id="cw-username" placeholder="e.g. jdelacruz" autocomplete="off" style="text-transform:lowercase"/>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Letters and numbers only. Auto-suggested from name.</div>
      </div>
      <div class="form-group">
        <label>Initial Password <span style="color:var(--danger)">*</span></label>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="cw-password" value="${initialPw}" autocomplete="off" style="flex:1"/>
          <button type="button" class="btn-secondary btn-sm" id="cw-regen-pw" title="Generate new password">🔄</button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Role</label><select id="cw-role">${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${k==='employee'?'selected':''}>${v.label}</option>`).join('')}</select></div>
      <div class="form-group"><label>Primary Department</label><select id="cw-dept"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Job Title</label><input id="cw-title" placeholder="e.g. Machine Operator"/></div>
    <div class="form-row">
      <div class="form-group"><label>Base Salary (₱)</label><input id="cw-salary" type="number" value="0"/></div>
      <div class="form-group"><label>Allowance (₱)</label><input id="cw-allow" type="number" value="0"/></div>
    </div>
    <div class="form-group"><label>Start Date</label><input id="cw-start" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
    <div id="cw-error" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="cw-save-btn">Create Account</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  // Auto-suggest username from name
  document.getElementById('cw-name').addEventListener('input', suggestUsername);
  document.getElementById('cw-username').addEventListener('input', () => {
    document.getElementById('cw-username')._edited = true;
  });
  document.getElementById('cw-username').addEventListener('input', e => {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'');
  });
  document.getElementById('cw-regen-pw').addEventListener('click', () => {
    document.getElementById('cw-password').value = generatePassword('worker' + Date.now());
  });

  document.getElementById('cw-save-btn').addEventListener('click', async () => {
    const btn  = document.getElementById('cw-save-btn');
    const errEl= document.getElementById('cw-error');
    errEl.classList.add('hidden');

    const name     = document.getElementById('cw-name').value.trim();
    const username = document.getElementById('cw-username').value.trim().toLowerCase();
    const password = document.getElementById('cw-password').value.trim();
    const role     = document.getElementById('cw-role').value;
    const dept     = document.getElementById('cw-dept').value;
    const title    = document.getElementById('cw-title').value.trim();
    const salary   = parseFloat(document.getElementById('cw-salary').value)||0;
    const allow    = parseFloat(document.getElementById('cw-allow').value)||0;
    const eid      = document.getElementById('cw-eid').value.trim();
    const start    = document.getElementById('cw-start').value;

    if (!name)     { errEl.textContent='Full name is required.'; errEl.classList.remove('hidden'); return; }
    if (!username) { errEl.textContent='Username is required.'; errEl.classList.remove('hidden'); return; }
    if (!password) { errEl.textContent='Password is required.'; errEl.classList.remove('hidden'); return; }

    // Check username uniqueness
    const existing = await db.collection('users').where('username','==',username).limit(1).get();
    if (!existing.empty) { errEl.textContent='Username already taken. Choose another.'; errEl.classList.remove('hidden'); return; }

    btn.disabled = true; btn.textContent = 'Creating…';

    // Auth email is synthetic — worker never needs to see or use this
    const authEmail = `${username}@bi.barroindustries`;
    try {
      // Create Firebase Auth account via secondary app (doesn't affect HR's session)
      const workerAuth = _getWorkerAuth();
      const cred = await workerAuth.createUserWithEmailAndPassword(authEmail, password);
      const uid  = cred.user.uid;
      await workerAuth.signOut();

      // Write Firestore profile using the Auth UID as the doc ID
      await db.collection('users').doc(uid).set({
        displayName: name,
        username:    username,
        authEmail:   authEmail,
        email:       authEmail,        // fallback for any email display
        employeeId:  eid,
        role, department: dept, departments: dept ? [dept] : [],
        title, salary, allowance: allow, deductions: 0,
        startDate:   start,
        hrManagedAccount: true,
        hrPwToken:   btoa(password),   // HR recovery token (base64, for reset only)
        createdBy:   currentUser.uid,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      });

      dbCacheInvalidate('users');

      // Show credentials to HR — only time the password is displayed in full
      openModal('✅ Worker Account Created', `
        <p style="margin-bottom:12px">Hand these credentials to <strong>${name}</strong>:</p>
        <div style="background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;padding:16px;font-family:monospace;font-size:15px;line-height:2">
          <div>Username: <strong style="color:var(--primary-light)">${username}</strong></div>
          <div>Password: <strong style="color:var(--primary-light)">${password}</strong></div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:10px">⚠️ Write this down now. The password won't be shown again in plain text.</p>
      `, `<button class="btn-primary" onclick="closeModal();renderTeam()">Done</button>`);
    } catch(err) {
      btn.disabled = false; btn.textContent = 'Create Account';
      errEl.textContent = err.code === 'auth/email-already-in-use'
        ? 'Username already registered. Choose another.'
        : (err.message || 'Account creation failed.');
      errEl.classList.remove('hidden');
    }
  });
}

function openEditEmployeeModal(u) {
  const curDepts = Array.isArray(u.departments)&&u.departments.length ? u.departments : u.department ? [u.department] : [];
  openModal(`Edit: ${u.displayName||u.email}`,`
    ${u.username ? `
    <div style="background:var(--surface2);border-radius:8px;padding:10px 12px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:13px">👷 Worker account — login: <strong style="color:var(--primary-light)">${u.username}</strong></span>
      <button class="btn-secondary btn-sm" id="eu-reset-pw-btn" style="margin-left:auto">🔑 Reset Password</button>
    </div>` : ''}
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
    dbCacheInvalidate('users'); closeModal(); renderTeam();
  });

  // Reset Password (worker accounts only)
  document.getElementById('eu-reset-pw-btn')?.addEventListener('click', () => {
    const newPw = generatePassword(u.displayName||'worker');
    openModal('🔑 Reset Password', `
      <p style="margin-bottom:10px">Set a new password for <strong>${u.displayName}</strong> (username: <code>${u.username}</code>).</p>
      <div class="form-group">
        <label>New Password</label>
        <div style="display:flex;gap:6px">
          <input id="rp-newpw" value="${newPw}" style="flex:1" autocomplete="off"/>
          <button type="button" class="btn-secondary btn-sm" id="rp-regen">🔄</button>
        </div>
      </div>
      <div id="rp-error" class="error-msg hidden" style="margin-top:8px"></div>
    `, `<button class="btn-primary" id="rp-save-btn">Set Password</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('rp-regen').addEventListener('click', () => {
      document.getElementById('rp-newpw').value = generatePassword(u.displayName||'worker'+Date.now());
    });

    document.getElementById('rp-save-btn').addEventListener('click', async () => {
      const errEl  = document.getElementById('rp-error');
      const saveBtn= document.getElementById('rp-save-btn');
      errEl.classList.add('hidden');
      const newPassword = document.getElementById('rp-newpw').value.trim();
      if (!newPassword || newPassword.length < 6) {
        errEl.textContent = 'Password must be at least 6 characters.'; errEl.classList.remove('hidden'); return;
      }
      if (!u.hrPwToken) {
        errEl.textContent = 'No stored recovery token. Password must be reset via Firebase Console.'; errEl.classList.remove('hidden'); return;
      }

      saveBtn.disabled = true; saveBtn.textContent = 'Resetting…';
      try {
        const currentPw  = atob(u.hrPwToken);
        const workerAuth = _getWorkerAuth();
        const cred = await workerAuth.signInWithEmailAndPassword(u.authEmail, currentPw);
        await cred.user.updatePassword(newPassword);
        await workerAuth.signOut();
        await db.collection('users').doc(u.id).update({ hrPwToken: btoa(newPassword) });

        openModal('✅ Password Reset', `
          <p style="margin-bottom:12px">New credentials for <strong>${u.displayName}</strong>:</p>
          <div style="background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;padding:16px;font-family:monospace;font-size:15px;line-height:2">
            <div>Username: <strong style="color:var(--primary-light)">${u.username}</strong></div>
            <div>Password: <strong style="color:var(--primary-light)">${newPassword}</strong></div>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-top:10px">⚠️ Write this down and hand it to the employee.</p>
        `, `<button class="btn-primary" onclick="closeModal()">Done</button>`);
      } catch(err) {
        saveBtn.disabled = false; saveBtn.textContent = 'Set Password';
        if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
          errEl.textContent = 'Stored credentials have changed (worker may have updated their password). Use Firebase Console to reset.';
        } else {
          errEl.textContent = err.message || 'Reset failed.';
        }
        errEl.classList.remove('hidden');
      }
    });
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

// ── Suggestion Box ────────────────────────────────
async function renderSuggestionBox(wrap) {
  const pres = isRealPresident();
  wrap.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header" style="display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">💡</span>
        <div>
          <h3 style="margin:0">Suggestion Box</h3>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Share ideas, feedback, or concerns — ${pres ? 'all submissions shown below' : 'submitted anonymously to the president'}</div>
        </div>
      </div>
      <div class="card-body">
        <div class="form-group" style="margin-bottom:10px">
          <label style="font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.4px">Category</label>
          <select id="sug-category" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text);font-size:14px">
            <option value="General">General</option>
            <option value="Operations">Operations</option>
            <option value="Payroll & Benefits">Payroll & Benefits</option>
            <option value="Work Environment">Work Environment</option>
            <option value="Tools & Systems">Tools & Systems</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label style="font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.4px">Your Suggestion</label>
          <textarea id="sug-text" rows="4" placeholder="Type your suggestion or feedback here…" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);color:var(--text);resize:vertical;box-sizing:border-box"></textarea>
        </div>
        <button class="btn-primary" id="sug-submit-btn" style="width:100%">Submit Anonymously</button>
        <div id="sug-msg" style="margin-top:10px;font-size:13px;text-align:center;display:none"></div>
      </div>
    </div>
    ${pres ? `<div class="card"><div class="card-header"><h3>All Submissions</h3></div><div class="card-body" id="sug-list"><div class="loading-placeholder">Loading…</div></div></div>` : ''}
  `;

  document.getElementById('sug-submit-btn').addEventListener('click', async () => {
    const text = document.getElementById('sug-text').value.trim();
    const category = document.getElementById('sug-category').value;
    const msg = document.getElementById('sug-msg');
    if (!text) { msg.style.display='block'; msg.style.color='var(--danger)'; msg.textContent='Please write something first.'; return; }
    document.getElementById('sug-submit-btn').disabled = true;
    await db.collection('suggestions').add({
      text,
      category,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await Notifs.sendToOwner({ title:'💡 New Suggestion', body:`New "${category}" suggestion submitted.`, icon:'💡', type:'suggestion' });
    document.getElementById('sug-text').value = '';
    msg.style.display = 'block'; msg.style.color = 'var(--success)';
    msg.textContent = '✓ Submitted! Thank you for your feedback.';
    document.getElementById('sug-submit-btn').disabled = false;
    if (pres) loadSuggestions();
  });

  if (pres) loadSuggestions();
}

async function loadSuggestions() {
  const list = document.getElementById('sug-list');
  if (!list) return;
  const snap = await db.collection('suggestions').orderBy('createdAt','desc').limit(50).get();
  if (snap.empty) { list.innerHTML = '<div class="empty-state" style="padding:24px 0">No suggestions yet.</div>'; return; }
  list.innerHTML = snap.docs.map(d => {
    const s = d.data();
    const ts = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    return `
    <div style="padding:14px;background:var(--s2);border-radius:10px;margin-bottom:10px;border:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--primary-light)">${s.category||'General'}</span>
        <span style="font-size:11px;color:var(--text-muted)">${ts}</span>
      </div>
      <div style="font-size:14px;color:var(--text);line-height:1.55;white-space:pre-wrap">${s.text||''}</div>
      <button class="btn-secondary btn-sm sug-delete-btn" data-id="${d.id}" style="margin-top:8px;color:var(--danger);font-size:11px">Delete</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.sug-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this suggestion?')) return;
    await db.collection('suggestions').doc(btn.dataset.id).delete();
    loadSuggestions();
  }));
}

// ── Help / Guide ──────────────────────────────────
function renderHelp() {
  const c = document.getElementById('page-content');
  const bsOnly  = isBrilliantOnly();
  const pres    = isPresident() || currentRole === 'manager';
  const section = bsOnly ? 'partner' : pres ? 'admin' : 'employee';

  const sections = {
    admin:    renderHelpAdmin,
    employee: renderHelpEmployee,
    partner:  renderHelpPartner
  };

  c.innerHTML = `
    <div class="page-header">
      <h2>Help &amp; Guide</h2>
    </div>
    <div class="subtab-bar" id="help-tabs">
      ${pres
        ? `<button class="subtab-btn active" data-sub="admin">Admin Guide</button>
           <button class="subtab-btn" data-sub="employee">Employee Guide</button>
           <button class="subtab-btn" data-sub="partner">Partner Guide</button>
           <button class="subtab-btn" data-sub="storage">Storage Setup</button>
           <button class="subtab-btn" data-sub="suggestions">💡 Suggestion Box</button>`
        : bsOnly
          ? `<button class="subtab-btn active" data-sub="partner">Partner Guide</button>
             <button class="subtab-btn" data-sub="suggestions">💡 Suggestion Box</button>`
          : `<button class="subtab-btn active" data-sub="employee">Your Guide</button>
             <button class="subtab-btn" data-sub="suggestions">💡 Suggestion Box</button>`}
    </div>
    <div id="help-content"></div>
  `;

  const load = (sub) => {
    const wrap = document.getElementById('help-content');
    if (sub === 'storage') {
      wrap.innerHTML = `<div class="card"><div class="card-body">
        <h3 style="margin-bottom:14px;font-size:16px">Storage System</h3>
        <div id="storage-status-wrap"></div>
        <div style="margin-top:20px;padding:16px;background:var(--s2);border-radius:var(--r);font-size:13px;line-height:1.7">
          <p style="font-weight:700;margin-bottom:8px">To activate Google Drive storage:</p>
          <ol style="padding-left:18px;color:var(--text-2)">
            <li>Go to <strong>console.cloud.google.com</strong></li>
            <li>Create a project → Enable <strong>Google Drive API</strong></li>
            <li>Create an <strong>API Key</strong> + <strong>OAuth 2.0 Client ID</strong></li>
            <li>Create a folder in Drive named <strong>BI-Operations</strong></li>
            <li>Paste credentials into <code>js/config.js</code> and set <code>DRIVE_ENABLED: true</code></li>
            <li>Redeploy to Netlify</li>
          </ol>
          <p style="margin-top:12px;color:var(--text-muted)">Full step-by-step instructions are in <code>GOOGLE_DRIVE_SETUP.md</code> in your project folder.</p>
        </div>
      </div></div>`;
      Drive.renderStorageStatus('storage-status-wrap');
    } else if (sub === 'suggestions') {
      renderSuggestionBox(wrap);
    } else if (sections[sub]) {
      wrap.innerHTML = sections[sub]();
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    }
  };

  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      load(btn.dataset.sub);
    });
  });

  load(section);
}

function renderHelpAdmin() {
  return `
  <div class="help-guide">
    <div class="help-hero">
      <div class="help-hero-icon" style="background:rgba(255,45,120,0.10)"><i data-lucide="shield" style="stroke:var(--pink);width:28px;height:28px"></i></div>
      <div><h2>Admin / President Guide</h2><p>Full command-center access to all features</p></div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="log-in" class="help-h-icon"></i> Logging In</h3>
      <ol class="help-steps">
        <li>Open the app on your phone or browser</li>
        <li>Tap <strong>Admin</strong> on the login screen</li>
        <li>Enter your email and password → tap <strong>Sign In</strong></li>
        <li>You'll land on your <strong>Command Center</strong> dashboard</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="home" class="help-h-icon"></i> Command Center Dashboard</h3>
      <p>Your dashboard shows real-time business metrics at a glance:</p>
      <ul class="help-list">
        <li><strong>Red banner</strong> — overdue tasks that need immediate action. Tap to go straight to tasks.</li>
        <li><strong>Amber banner</strong> — pending approvals and cash advance requests waiting for your review.</li>
        <li><strong>KPI cards</strong> — team size, open tasks, overdue count, quote pipeline value, monthly payroll burn.</li>
        <li><strong>Live Task Feed</strong> — all open tasks sorted by urgency (overdue first → high priority). Tap "All Tasks" to manage them.</li>
        <li><strong>Quick Actions</strong> — one-tap shortcuts to New Task, Approvals, Team, and Progress Reports.</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="check-square" class="help-h-icon"></i> Managing Tasks</h3>
      <ol class="help-steps">
        <li>Tap <strong>Tasks</strong> in the sidebar → <strong>Departmental</strong> tab to see all team tasks</li>
        <li>Use the <strong>My Tasks</strong> tab for tasks assigned to you personally</li>
        <li>Tap <strong>+ New Task</strong> → fill in title, assignee, department, priority, due date</li>
        <li>Tasks with red dots = high priority. Tasks in red = overdue.</li>
        <li>Tap any task card to update status, add notes, or mark done</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="shield-check" class="help-h-icon"></i> Approvals</h3>
      <ul class="help-list">
        <li><strong>Quote / ROA tab</strong> — Brilliant Steel quote requests from agents. Review total, client name, agent. Tap Approve or Reject.</li>
        <li><strong>Cash Advances tab</strong> — Employee CA requests. See amount, repayment date, reason. Approve sends a notification to the employee.</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="users" class="help-h-icon"></i> Team &amp; Payroll</h3>
      <ol class="help-steps">
        <li>Go to <strong>Team &amp; Payroll</strong> in the sidebar</li>
        <li>See all employees with their salary breakdown (base, allowance, deductions, net)</li>
        <li>Tap ✏️ to edit any employee's details, role, or pay</li>
        <li>Tap <strong>+ Add Employee</strong> → fill in their profile (create their login in Firebase Console first)</li>
        <li>Tap <strong>Record Payroll</strong> → select month → saves salary history for all employees</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="trending-up" class="help-h-icon"></i> Progress Reports</h3>
      <p>See each department's task completion rate, member KPIs, and attendance for the current month. Use the subtabs to drill into individual department members.</p>
    </div>

    <div class="help-section">
      <h3><i data-lucide="bar-chart-2" class="help-h-icon"></i> Analytics</h3>
      <p>Charts for task completion by department, team performance table, and monthly trends. Use this to spot underperforming departments or employees.</p>
    </div>

    <div class="help-section">
      <h3><i data-lucide="hard-drive" class="help-h-icon"></i> Files &amp; Storage</h3>
      <ul class="help-list">
        <li>All files uploaded in the app go to <strong>Google Drive</strong> (if configured) or <strong>Firebase Cloud Storage</strong></li>
        <li>Files are organized by department folder automatically</li>
        <li>Every file becomes a shareable link — tap the link to open in Drive viewer</li>
        <li>To set up Google Drive, tap the <strong>Storage Setup</strong> tab above</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="moon" class="help-h-icon"></i> Tips</h3>
      <ul class="help-list">
        <li>Tap the <strong>sun/moon icon</strong> in the topbar to toggle light/dark mode</li>
        <li>Tap your <strong>avatar</strong> in the topbar to update your profile photo and display name</li>
        <li>The app works offline — cached data loads even without signal</li>
        <li>Add to your home screen on iPhone: Safari → Share → Add to Home Screen</li>
      </ul>
    </div>
  </div>`;
}

function renderHelpEmployee() {
  return `
  <div class="help-guide">
    <div class="help-hero">
      <div class="help-hero-icon" style="background:rgba(10,132,255,0.10)"><i data-lucide="user" style="stroke:var(--blue);width:28px;height:28px"></i></div>
      <div><h2>Employee Guide</h2><p>Your personal dashboard for tasks, attendance, and pay</p></div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="log-in" class="help-h-icon"></i> How to Log In</h3>
      <ol class="help-steps">
        <li>Open the app link your admin gave you (save it to your phone's home screen!)</li>
        <li>On the login screen, tap <strong>Employee</strong></li>
        <li>Enter your company email (e.g. <em>yourname@barroindustries.com</em>)</li>
        <li>Enter your password → tap <strong>Sign In</strong></li>
        <li>If you forgot your password → tap <strong>Forgot password?</strong> to get a reset email</li>
      </ol>
      <div class="help-tip">💡 <strong>Tip:</strong> On iPhone, go to Safari → Share button → "Add to Home Screen" to install the app like a native app.</div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="home" class="help-h-icon"></i> Your Dashboard</h3>
      <p>When you log in, you see your personal dashboard with:</p>
      <ul class="help-list">
        <li><strong>Attendance card</strong> — log your attendance for today (see below)</li>
        <li><strong>Net Pay</strong> — your current monthly take-home amount</li>
        <li><strong>Open Tasks</strong> — how many tasks are assigned to you right now</li>
        <li><strong>Task KPI</strong> — your performance score (tasks completed vs. total). Your target is shown below the percentage.</li>
        <li><strong>Task list</strong> — your most urgent open tasks. Red = overdue, orange = high priority.</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="calendar" class="help-h-icon"></i> Logging Attendance</h3>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Attendance is worth <strong>30%</strong> of your monthly pay. Both steps must be completed within the <strong>7:00–8:00 AM window</strong> each workday.</p>
      <ol class="help-steps">
        <li><strong>Step 1 — Time In (50%) · 7:00–8:00 AM:</strong> Open the app between 7am and 8am and tap <strong>Time In</strong> on your dashboard. This records that you showed up for work.</li>
        <li><strong>Step 2 — Check Notifications (100%) · before 8:00 AM:</strong> While still in the window, tap the 🔔 bell icon. Each notification has a checkbox — <strong>check every one individually.</strong> Once all are checked before 8am, your attendance automatically upgrades to 100%.</li>
        <li>Your attendance badge turns green (✅) when both steps are done.</li>
        <li><strong>Missed the window?</strong> If it is already past 8am and you have not yet timed in, tap <strong>⏰ Request Time Extension</strong> on your dashboard. This sends a request to the president.</li>
        <li><strong>Extension approval:</strong> If the president approves, you will receive a notification and your dashboard will show a Time In button with an expiry time. You have <strong>6 hours from the time of approval</strong> to complete both steps.</li>
        <li><strong>Extension denied or expired:</strong> The day is recorded as absent. Maintain the habit of opening the app before 8am to avoid this.</li>
      </ol>
      <div class="help-tip">⚠️ <strong>Key rules:</strong> The Time In window is <em>7:00–8:00 AM only</em>. You cannot time in before 7am or after 8am without an approved extension. Always check each notification individually — there is no "mark all" shortcut.</div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="check-square" class="help-h-icon"></i> Managing Your Tasks</h3>
      <ol class="help-steps">
        <li>Tap <strong>My Tasks</strong> in the bottom nav or sidebar</li>
        <li>You'll see all tasks assigned to you, sorted by urgency</li>
        <li>Tap any task to see the full details (description, due date, priority)</li>
        <li>When you finish a task, tap <strong>Mark Done</strong> — this improves your KPI score</li>
        <li>Use the filter dropdown to view open, done, or all tasks</li>
        <li>Tap <strong>+ New Task</strong> to create a task yourself</li>
      </ol>
      <div class="help-tip">💡 <strong>Your KPI score</strong> = tasks completed ÷ total tasks assigned. Higher score = higher computed pay.</div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="credit-card" class="help-h-icon"></i> Personal Finance &amp; Payslip</h3>
      <ol class="help-steps">
        <li>Tap <strong>Personal Finance</strong> in the sidebar</li>
        <li>See your <strong>base salary, allowances, deductions,</strong> and <strong>net pay</strong></li>
        <li>Your <strong>KPI</strong> and <strong>attendance scores</strong> are shown with progress bars</li>
        <li>The <strong>Computed Pay</strong> card shows your actual take-home after KPI adjustment</li>
        <li>Tap <strong>Generate Payslip PDF</strong> to print or save your payslip</li>
        <li><strong>Salary History</strong> section shows all past months' records</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="banknote" class="help-h-icon"></i> Requesting a Cash Advance</h3>
      <ol class="help-steps">
        <li>Go to <strong>Personal Finance</strong></li>
        <li>Tap <strong>+ Cash Advance</strong> in the top-right</li>
        <li>Enter the <strong>amount needed</strong>, <strong>date needed</strong>, <strong>repayment date</strong>, and <strong>reason</strong></li>
        <li>Tap <strong>Submit Request</strong></li>
        <li>Your request goes to the president for approval</li>
        <li>You'll receive an in-app notification when approved or declined</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="folder" class="help-h-icon"></i> Files</h3>
      <ul class="help-list">
        <li>Tap <strong>Files</strong> to see your department's shared files</li>
        <li>Tap the upload area to attach a file — it saves to Google Drive (or cloud storage) automatically</li>
        <li>Every uploaded file becomes a link — tap to open it</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="user" class="help-h-icon"></i> Your Profile</h3>
      <ul class="help-list">
        <li>Tap your <strong>avatar/initials</strong> in the top-right corner</li>
        <li>Tap your photo to upload a new profile picture</li>
        <li>You can update your display name here</li>
        <li>Your employee ID, role, and department are shown (not editable by you)</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="moon" class="help-h-icon"></i> Tips &amp; Shortcuts</h3>
      <ul class="help-list">
        <li>Use the <strong>bottom navigation bar</strong> for quick access to your most-used pages</li>
        <li>Tap the <strong>sun/moon icon</strong> to switch between dark and light mode</li>
        <li>The app works on any phone or computer browser — no app store needed</li>
        <li>You'll get push notifications for task deadlines and approval results</li>
      </ul>
    </div>
  </div>`;
}

function renderHelpPartner() {
  return `
  <div class="help-guide">
    <div class="help-hero">
      <div class="help-hero-icon" style="background:rgba(255,214,10,0.10)"><i data-lucide="handshake" style="stroke:var(--gold);width:28px;height:28px"></i></div>
      <div><h2>Partner Guide — Brilliant Steel</h2><p>Quote builder, client management, and file sharing</p></div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="log-in" class="help-h-icon"></i> How to Log In</h3>
      <ol class="help-steps">
        <li>Open the app link provided by Barro Industries admin</li>
        <li>On the login screen, tap <strong>Partner</strong></li>
        <li>Enter your Brilliant Steel email address</li>
        <li>Enter your password → tap <strong>Sign In</strong></li>
        <li>Your account must be set up by Barro Industries admin first — contact them if you can't log in</li>
      </ol>
      <div class="help-tip">💡 <strong>Tip:</strong> Save the app link to your phone's home screen for quick access. On iPhone: Safari → Share → "Add to Home Screen".</div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="home" class="help-h-icon"></i> Your Dashboard</h3>
      <p>After logging in, you'll see your Brilliant Steel dashboard with:</p>
      <ul class="help-list">
        <li><strong>Quote pipeline value</strong> — total value of all quotes you've built</li>
        <li><strong>Quick access</strong> to Quote Builder, Quotations, and Client Data</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="calculator" class="help-h-icon"></i> Building a Quote</h3>
      <ol class="help-steps">
        <li>Tap <strong>Quotes</strong> in the bottom nav or <strong>Quote Builder</strong> in the sidebar</li>
        <li>Select or create a <strong>client</strong> from your client list</li>
        <li>Add <strong>line items</strong> — description, quantity, unit price. The total calculates automatically.</li>
        <li>Add any <strong>notes or terms</strong> at the bottom</li>
        <li>Tap <strong>Save Draft</strong> to save without sending</li>
        <li>When ready, tap <strong>Submit for Approval</strong> — this sends the quote to Barro Industries president for review</li>
        <li>You'll receive a notification when it's approved or returned for revision</li>
      </ol>
      <div class="help-tip">⚠️ <strong>Note:</strong> Quotes are not final until approved by the Barro Industries president.</div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="file-text" class="help-h-icon"></i> Quotations Summary</h3>
      <ul class="help-list">
        <li>See all your quotes with their current status: Draft, Sent, Accepted, Rejected</li>
        <li>Use the filter tabs to find quotes by status</li>
        <li>Tap any quote to view or edit it (drafts only)</li>
        <li>Approved quotes can be downloaded or shared as PDF</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="book-open" class="help-h-icon"></i> Client Data</h3>
      <ol class="help-steps">
        <li>Tap <strong>Clients</strong> in the sidebar</li>
        <li>See all your saved clients with contact information</li>
        <li>Tap <strong>+ Add Client</strong> to add a new client (name, company, email, phone)</li>
        <li>Tap any client to view their history and quotes</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="folder" class="help-h-icon"></i> Files</h3>
      <ul class="help-list">
        <li>Tap <strong>Files</strong> to access shared documents with Barro Industries</li>
        <li>Upload product specs, drawings, or documents — they save to the shared Google Drive folder</li>
        <li>Files from Barro Industries for you will also appear here</li>
        <li>All files become shareable links — tap to open in your browser</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="bell" class="help-h-icon"></i> Notifications</h3>
      <ul class="help-list">
        <li>Tap the <strong>bell icon</strong> in the top-right to see all notifications</li>
        <li>You'll be notified when a quote is approved, rejected, or needs revision</li>
        <li>Tap a notification to go directly to the relevant item</li>
        <li>Tap <strong>Mark all read</strong> to clear the badge count</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="help-circle" class="help-h-icon"></i> Need Help?</h3>
      <ul class="help-list">
        <li>Contact Barro Industries admin for account issues, password resets, or access problems</li>
        <li>For quote questions, use the in-app notification to message back on a quote</li>
      </ul>
    </div>
  </div>`;
}

// ── Service Worker ────────────────────────────────
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);
