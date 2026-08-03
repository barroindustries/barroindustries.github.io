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
let selectedLoginType = null; // 'admin' | 'employee' | 'partner' — set on login card click

// Role → login type mapping
const ROLE_TYPE_MAP = {
  president: 'admin', owner: 'admin', manager: 'admin', secretary: 'admin',
  // Finance (Accountant) is an employee-tier account everywhere else — employee
  // dashboard, employee sidebar/bottom nav — so it logs in via the Employee portal.
  employee:  'employee', agent: 'employee', finance: 'employee',
  partner:   'partner'
};
const LOGIN_TYPE_LABELS = { admin: 'Admin', employee: 'Employee', partner: 'Partner' };

// ── Session lifecycle registry (Phase 65) ─────────
// Central place for anything tied to the signed-in session — timers, live
// listeners, DOM handlers — so sign-out (or a different user signing back in)
// can't leave stale work running in the background. Call addCleanup(fn) right
// after starting anything session-scoped; runCleanups() fires on every path
// that ends a session (explicit Sign Out, inactivity auto-logout, force-logout,
// and the auth.onAuthStateChanged null-user branch that catches all of them).
window.Session = {
  _cleanups: [],
  addCleanup(fn) { if (typeof fn === 'function') this._cleanups.push(fn); },
  runCleanups() {
    while (this._cleanups.length) {
      const fn = this._cleanups.pop();
      try { fn(); } catch (e) { console.warn('[Session.runCleanups]', e); }
    }
  }
};

// ── Boot ──────────────────────────────────────────
// Tracks the uid we've already run the full disruptive bootstrap for, so token
// refreshes (which re-fire onAuthStateChanged for the SAME user) don't yank the
// user back to the dashboard / rebuild nav mid-task.
let _bootstrappedUid = null;
document.addEventListener('DOMContentLoaded', () => {
  // A cosmetic failure in theme/login init must never block the auth listener
  // below from attaching — that would strand the app on the splash screen.
  try { initTheme(); } catch(e) { console.error('initTheme failed', e); }
  try { initLogin(); } catch(e) { console.error('initLogin failed', e); }
  try { Notifs.initToggle(); } catch(e) { console.error('Notifs.initToggle failed', e); }
  try { window.Keymap.init(); } catch(e) { console.error('Keymap.init failed', e); }
  auth.onAuthStateChanged(async user => {
    if (user) {
      currentUser = user;
      await loadUserProfile(user);

      // ── Idempotency guard ─────────────────────────
      // Same signed-in user that is already bootstrapped (e.g. token refresh):
      // refresh auth state but SKIP the disruptive re-bootstrap.
      if (_bootstrappedUid === user.uid) {
        return;
      }

      // ── Login type gate ───────────────────────────
      // If user picked a login type, enforce it matches their actual role.
      // selectedLoginType is null when auth restores from a previous session (no gate).
      if (selectedLoginType) {
        const expectedType = ROLE_TYPE_MAP[currentRole] || 'employee';
        if (expectedType !== selectedLoginType) {
          const actualLabel   = LOGIN_TYPE_LABELS[expectedType]   || expectedType;
          const selectedLabel = LOGIN_TYPE_LABELS[selectedLoginType] || selectedLoginType;
          // Wrong portal — sign out and show error in login form.
          // Defensive reset (re-audit 2026-08-03): nothing else has run yet on
          // this path today, but zero the nav-depth counter here so this
          // branch stays self-contained regardless of future edits earlier in
          // the success path above it.
          window._navDepth = 0;
          await auth.signOut();
          showLogin();
          // Keep form wrap visible (not role picker) so the error element is shown
          document.getElementById('login-role-picker')?.classList.add('hidden');
          const formWrap = document.getElementById('login-form-wrap');
          formWrap?.classList.remove('hidden');
          // Clear password so they can't retry; keep email pre-filled
          document.getElementById('password').value = '';
          setLoginLoading(false);
          setTimeout(() => {
            showLoginError(`${emojiIcon('⚠️',16)} Wrong login portal. This account is an ${actualLabel} account — please use ${actualLabel} login.`);
          }, 80);
          selectedLoginType = null;
          return;
        }
        selectedLoginType = null; // clear after successful check
      }

      showApp();
      Notifs.startListener(user.uid);
      Notifs.initPush(user.uid);
      Notifs.checkDeadlines(user.uid);
      if (userProfile.role !== 'partner') Notifs.checkAttendanceReminder(user.uid, userProfile.displayName);
      Notifs.checkLowStock?.(user.uid, userProfile.role);
      Notifs.checkAECFollowups?.(user.uid, userProfile.role);
      checkPayrollDuties(user);
      checkCAReminder(user);
      buildNav();
      // v12 WS10 — deep-link/refresh survives: land wherever the hash points,
      // not hardcoded dashboard. replace:true so this doesn't push a 2nd entry.
      { const r = parseHash(); navigateTo(r.page, { subtab: r.subtab, replace: true }); }
      startAutoLogout();
      startPresenceHeartbeat(user.uid);
      startForceLogoutListener(user.uid);
      startClaimsListener(user.uid);
      // Belt-and-braces: navigateTo() already tears down Chat's inbox listener
      // whenever the page changes away from 'chat', but a sign-out that happens
      // WHILE the chat page is open (no navigateTo call in between) would leave
      // it running otherwise.
      Session.addCleanup(() => { if (window.Chat?.teardownInbox) window.Chat.teardownInbox(); });
      checkBackupHealth();
      try { window.Keymap.maybeShowFirstRunHint(); } catch(_){}
      try { if (typeof loadHolidayOverrides==='function') loadHolidayOverrides(); } catch(_){}
      // Mark this uid as fully bootstrapped so subsequent token-refresh fires
      // for the same user are treated as no-ops above.
      _bootstrappedUid = user.uid;
      // Pull fresh custom claims onto the token if they're stale (the forced
      // refresh re-fires onAuthStateChanged, now a no-op via _bootstrappedUid).
      ensureClaimsFresh(user);
      // Prompt for phone number if missing
      if (!userProfile.phone) {
        const _phoneTimer = setTimeout(_promptPhoneNumber, 2000);
        Session.addCleanup(() => clearTimeout(_phoneTimer));
      }
    } else {
      _bootstrappedUid = null;
      stopClaimsListener();
      Session.runCleanups();
      showLogin();
    }
  });
});

// ── Presence Heartbeat ────────────────────────────
let _presenceInterval = null;
let _presenceVisHandler = null;
let _presencePagehideHandler = null;
function startPresenceHeartbeat(uid) {
  if (_presenceInterval) clearInterval(_presenceInterval);
  if (_presenceVisHandler) { document.removeEventListener('visibilitychange', _presenceVisHandler); window.removeEventListener('focus', _presenceVisHandler); }
  if (_presencePagehideHandler) { window.removeEventListener('pagehide', _presencePagehideHandler); }
  let _lastPing = 0;
  const ping = () => {
    _lastPing = Date.now();
    db.collection('users').doc(uid).update({ lastSeen: firebase.firestore.FieldValue.serverTimestamp(), online: true }).catch(()=>{});
  };
  ping();
  // Timer keeps it fresh while the tab is foregrounded; browsers throttle/pause
  // setInterval in background tabs, so ALSO ping the moment the tab becomes
  // visible or regains focus — that's when presence accuracy matters most.
  _presenceVisHandler = () => { if (document.visibilityState === 'visible' && Date.now() - _lastPing > 15000) ping(); };
  document.addEventListener('visibilitychange', _presenceVisHandler);
  window.addEventListener('focus', _presenceVisHandler);
  _presenceInterval = setInterval(() => { if (document.visibilityState === 'visible') ping(); }, 60000); // every 60s while visible
  // Re-audit 2026-08-03 — this heartbeat only ever POSITIVELY signals presence
  // (bumps lastSeen); it never explicitly clears it, so every consumer has to
  // infer "gone" purely from timestamp staleness, with no real-time offline
  // signal when a tab/app is actually closed. 'pagehide' fires reliably on tab
  // close, navigation away, and app backgrounding on mobile (unlike
  // 'beforeunload', which mobile Safari/PWA contexts often skip); write
  // online:false as a best-effort last gasp over the still-open connection —
  // not guaranteed to land, but strictly better than no signal at all. Actual
  // sign-out/auto-logout/force-logout already route through the
  // Session.addCleanup below, which also flips it explicitly.
  _presencePagehideHandler = () => {
    try { db.collection('users').doc(uid).update({ online: false }).catch(()=>{}); } catch(_){}
  };
  window.addEventListener('pagehide', _presencePagehideHandler);
  Session.addCleanup(() => {
    if (_presenceInterval) { clearInterval(_presenceInterval); _presenceInterval = null; }
    if (_presenceVisHandler) { document.removeEventListener('visibilitychange', _presenceVisHandler); window.removeEventListener('focus', _presenceVisHandler); _presenceVisHandler = null; }
    if (_presencePagehideHandler) { window.removeEventListener('pagehide', _presencePagehideHandler); _presencePagehideHandler = null; }
    db.collection('users').doc(uid).update({ online: false }).catch(()=>{});
  });
}

// ── Force Logout (president-triggered) ───────────
let _forceLogoutUnsub = null;
function startForceLogoutListener(uid) {
  if (_forceLogoutUnsub) _forceLogoutUnsub();
  // Change-detection instead of wall-clock comparison — comparing client
  // Date.now() against the server forceLogoutAt timestamp is unreliable on
  // clock-skewed devices. Capture the FIRST snapshot's forceLogoutAt as a
  // baseline (no clocks involved), then only sign out when a LATER snapshot
  // reports a strictly greater value — i.e. a force-logout event that
  // arrived after this listener attached.
  let baselineFL = undefined;
  _forceLogoutUnsub = db.collection('settings').doc('system').onSnapshot(snap => {
    const data = snap.data();
    const flTime = data?.forceLogoutAt?.toDate?.()?.getTime?.() || 0;
    // First snapshot just establishes the baseline — never sign out on it.
    if (baselineFL === undefined) {
      baselineFL = flTime;
      return;
    }
    if (flTime > baselineFL) {
      baselineFL = flTime;
      if (data?.excludeUid !== uid) {
        Notifs.stopListener();
        auth.signOut();
        Notifs.showToast('You have been signed out by an administrator.', 'info');
      }
    }
  }, () => {});
  Session.addCleanup(() => { if (_forceLogoutUnsub) { _forceLogoutUnsub(); _forceLogoutUnsub = null; } });
}

// ── Backup/sync health banner (finance/admin only) ───────────────────────
async function checkBackupHealth() {
  try {
    if (!['president','manager','secretary','finance'].includes(window.currentRole)) return;
    const now = Date.now();
    const CHECKS = [
      { id: 'daily_sync',     label: 'Daily file sync',  staleMs: 30 * 3600 * 1000 },
      { id: 'monthly_backup', label: 'Monthly backup',   staleMs: 34 * 24 * 3600 * 1000 },
    ];
    const problems = [];
    for (const c of CHECKS) {
      // Perf: these heartbeat docs are only ever written once daily/monthly by
      // GitHub Actions, so a live read on every single login is pure waste —
      // cache for an hour (well under the 30h/34d staleness thresholds below,
      // so a real outage is still caught the same day it's checked).
      const snap = await window.dbCachedGet(
        `system_health:${c.id}`,
        () => db.collection('system_health').doc(c.id).get(),
        3600000
      ).catch(() => null);
      const d = snap && snap.exists ? snap.data() : null;
      const last = d?.lastRunAt?.toDate?.()?.getTime?.() || 0;
      if (!last || (now - last) > c.staleMs) {
        problems.push(`${c.label} has not reported in — last run ${last ? new Date(last).toLocaleString('en-PH') : 'never'}.`);
      } else if (d.lastStatus === 'error') {
        problems.push(`${c.label} last run had ${d.errors} error(s) (${d.label||''}).`);
      }
    }
    if (!problems.length) return;
    renderBackupHealthBanner(problems);
    // Notify the President once per distinct problem (deduped).
    // Re-audit 2026-08-03: window.PRESIDENT_UID never existed as a global (only
    // a module-scoped EMAIL const of the same name in js/modules.js), so this
    // push branch was permanently skipped and the alert only ever reached
    // whoever happened to already be logged in as admin/finance when the
    // banner rendered. Notifs.sendToOwner() (already used elsewhere in this
    // file, e.g. the quote-filed/quote-review notifications below) queries
    // users where role in ('president','owner') and fans out — no uid lookup
    // needed.
    if (window.Notifs?.sendToOwner) {
      window.Notifs.sendToOwner({
        title: '⚠️ Backup/sync needs attention',
        body: problems.join(' '),
        icon: '🗄️', type: 'system',
        dedupKey: 'backup-health-' + problems.join('|').slice(0, 80),
      }).catch(() => {});
    }
  } catch (_) { /* monitoring must never break the app */ }
}

function renderBackupHealthBanner(problems) {
  if (document.getElementById('backup-health-banner')) return;
  const div = document.createElement('div');
  div.id = 'backup-health-banner';
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:var(--z-system-banner, 9995);background:#b91c1c;color:var(--white,#fff);padding:calc(10px + env(safe-area-inset-top,0px)) calc(44px + env(safe-area-inset-right,0px)) 10px calc(14px + env(safe-area-inset-left,0px));font-size:13px;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  div.innerHTML = `${emojiIcon('🗄️',16)} <strong>Records durability alert.</strong> ${problems.map(p => escHtml(p)).join(' ')}`
    + `<button aria-label="Dismiss" style="position:absolute;right:calc(10px + env(safe-area-inset-right,0px));top:calc(8px + env(safe-area-inset-top,0px));background:none;border:none;color:var(--white,#fff);font-size:18px;cursor:pointer">×</button>`;
  if (window.lucide) lucide.createIcons({ nodes: [div] });
  div.querySelector('button').onclick = () => div.remove();
  document.body.appendChild(div);
}

// ── System Health drill-down page (Phase 90, president + finance) ───────
// checkBackupHealth() above is the at-a-glance banner (daily_sync +
// monthly_backup only). This page is the full drill-down across every
// system_health/{jobId} heartbeat doc plus a 7-day error_log summary.
const SYSTEM_HEALTH_JOBS = [
  { id: 'daily_sync',                  label: 'Daily file sync',            cadence: 'daily',   staleMs: 36 * 3600 * 1000 },
  { id: 'monthly_backup',              label: 'Monthly backup',             cadence: 'monthly', staleMs: 40 * 24 * 3600 * 1000 },
  { id: 'monthly_backup_size_guard',   label: 'Monthly backup size guard',  cadence: 'monthly', staleMs: 40 * 24 * 3600 * 1000 },
  { id: 'daily_digest',                label: 'Daily ops digest',           cadence: 'daily',   staleMs: 36 * 3600 * 1000 },
  { id: 'scheduledAttendanceReminder', label: 'Attendance reminder',        cadence: 'daily',   staleMs: 36 * 3600 * 1000 },
  { id: 'scheduledDailyDigestChecks',  label: 'Daily digest checks',        cadence: 'daily',   staleMs: 36 * 3600 * 1000 },
  { id: 'executeApprovalOnUpdate',     label: 'Approval execution trigger', cadence: 'daily',   staleMs: 36 * 3600 * 1000 },
  { id: 'sendNotificationQuota',       label: 'Notification send quota',    cadence: 'daily',   staleMs: 36 * 3600 * 1000 },
];

// renderSystemHealth — moved verbatim to js/screens/dashboards.js (Wave 7
// Pass 9, 2026-08-03). Uses this file's SYSTEM_HEALTH_JOBS/checkBackupHealth
// constant (stays here, shared with the boot-time backup-health banner) by
// bare-global name at runtime only, never at parse time. The 'system-health'
// case in navigateTo below still calls renderSystemHealth() unqualified.

// ── Custom-claims token refresh ───────────────────
// Cloud Storage Security Rules gate sensitive folders (Finance/payslips,
// receipts, department uploads) on request.auth.token.role / .departments,
// which the syncUserClaims Cloud Function mints from users/{uid}. A token
// issued before claims changed is stale, so we refresh it two ways:
//   • ensureClaimsFresh — once per sign-in, force a refresh if the token's
//     claims don't match the freshly-loaded profile (covers first-ever login
//     and claims set/changed while the user was away).
//   • startClaimsListener — a live listener on the user's own doc that
//     force-refreshes whenever the function stamps claimsUpdatedAt (covers a
//     role/department change made mid-session, e.g. removed from Finance).
// A forced refresh re-fires onAuthStateChanged for the same uid, but that's
// caught by the _bootstrappedUid guard, so the UI isn't disrupted.
let _claimsCheckedUid = null;
let _claimsUnsub = null;
let _claimsBaselineStamp = null;

async function ensureClaimsFresh(user) {
  if (!user || _claimsCheckedUid === user.uid) return;   // once per sign-in → no refresh loop
  _claimsCheckedUid = user.uid;
  try {
    const res = await user.getIdTokenResult();
    const claimRole  = res.claims.role || '';
    const claimDepts = Array.isArray(res.claims.departments)
      ? [...res.claims.departments].sort().join('|') : '';
    const profRole   = userProfile.role || '';
    const profDepts  = (currentDepts || []).slice().sort().join('|');
    if (claimRole !== profRole || claimDepts !== profDepts) {
      await user.getIdToken(true);   // pull latest claims from the server (once)
    }
  } catch (e) { /* non-fatal — rules fall back to deny on sensitive folders */ }
}

let _claimsBaselineRole = null;
let _claimsBaselineDepts = null;
function startClaimsListener(uid) {
  if (_claimsUnsub) { _claimsUnsub(); _claimsUnsub = null; }
  _claimsBaselineStamp = null;
  _claimsBaselineRole = null;
  _claimsBaselineDepts = null;
  _claimsUnsub = db.collection('users').doc(uid).onSnapshot(snap => {
    if (!snap.exists) return;
    const data = snap.data();
    const ts = data.claimsUpdatedAt;
    const ms = (ts && ts.toMillis) ? ts.toMillis() : 0;
    const role  = data.role || '';
    const depts = (data.departments || []).slice().sort().join('|');
    // First snapshot just establishes a baseline (claims already on the token).
    if (_claimsBaselineStamp === null) {
      _claimsBaselineStamp = ms; _claimsBaselineRole = role; _claimsBaselineDepts = depts;
      return;
    }
    if (ms > _claimsBaselineStamp) {
      _claimsBaselineStamp = ms;
      // Only role/departments actually differing counts as an access-relevant
      // change — a claimsUpdatedAt bump from an unrelated field write must not
      // re-trigger the re-gate below (loop guard).
      const roleOrDeptsChanged = role !== _claimsBaselineRole || depts !== _claimsBaselineDepts;
      _claimsBaselineRole = role; _claimsBaselineDepts = depts;
      if (auth.currentUser) {
        const refreshP = auth.currentUser.getIdToken(true).catch(() => {});
        // Phase 50/65 re-gate: a role/department change made mid-session (e.g.
        // removed from Finance) can leave the currently-open page showing content
        // the user no longer has access to. Chain off the SAME token-refresh
        // promise and explicitly await loadUserProfile() (the function that
        // actually repopulates currentRole/currentDepts) before re-running the
        // page's access gate — replaces a blind setTimeout(...,800) guess that
        // could race slow networks and let navigateTo fire against stale
        // currentRole/currentDepts, briefly showing a stale over-privileged page.
        if (roleOrDeptsChanged && window.currentPage) {
          refreshP
            .then(() => auth.currentUser ? loadUserProfile(auth.currentUser) : null)
            .then(() => { if (window.currentPage) navigateTo(window.currentPage, { replace: true }); });
        }
      }
    }
  }, () => {});
  Session.addCleanup(stopClaimsListener);
}

function stopClaimsListener() {
  if (_claimsUnsub) { _claimsUnsub(); _claimsUnsub = null; }
  _claimsCheckedUid = null;
  _claimsBaselineStamp = null;
  _claimsBaselineRole = null;
  _claimsBaselineDepts = null;
}

// ── Auto-Logout ───────────────────────────────────
function startAutoLogout() {
  resetLogoutTimer();
  ['click','keydown','mousemove','touchstart','scroll'].forEach(e =>
    document.addEventListener(e, resetLogoutTimer, { passive: true })
  );
  Session.addCleanup(() => {
    clearTimeout(logoutTimer);
    logoutTimer = null;
    ['click','keydown','mousemove','touchstart','scroll'].forEach(e =>
      document.removeEventListener(e, resetLogoutTimer, { passive: true })
    );
  });
}
function resetLogoutTimer() {
  clearTimeout(logoutTimer);
  logoutTimer = setTimeout(() => {
    Notifs.stopListener();
    auth.signOut();
    Notifs.info('Signed out due to inactivity.');
  }, window.AUTO_LOGOUT_MS);
}

// ── Payroll Duties Check ─────────────────────────
// Sends at most 2 reminders per month: day before month-end, and on the 1st.
// Uses localStorage dedup so repeated logins on the same day don't re-send.
async function checkPayrollDuties(user) {
  try {
    // loadUserProfile(user) is always awaited earlier in the same
    // onAuthStateChanged handler and already populates window.currentRole from
    // this exact users/{uid} doc — re-fetching it here was a pure duplicate
    // read fired on every single sign-in (re-audit 2026-08-03).
    const role = window.currentRole;
    if (role === 'president' || role === 'owner' || role === 'partner') return;

    const todayStr = bizDate();
    const year   = parseInt(todayStr.slice(0,4),10);
    const month  = parseInt(todayStr.slice(5,7),10) - 1;
    const day    = parseInt(todayStr.slice(8,10),10);
    const monthEnd     = new Date(year, month+1, 0).getDate();
    const currentMonth = todayStr.slice(0,7);

    // Only fire on the last day of the month (1-day-before reminder) or the 1st (day-of)
    const isLastDay  = day === monthEnd;
    const isFirstDay = day === 1;
    if (!isLastDay && !isFirstDay) return;

    // Dedup: only send once per day
    const dedupKey = `bi-selfassess-remind-${user.uid}-${todayStr}`;
    if (localStorage.getItem(dedupKey)) return;

    const evalDoc = await db.collection('kpi_evals').doc(user.uid).get().catch(()=>null);
    const selfAssessMonth = evalDoc?.exists ? evalDoc.data().selfAssessMonth : null;
    if (selfAssessMonth === currentMonth) return; // already done this month

    const monthLabel = new Date(year, month, 1).toLocaleString('en-PH',{month:'long',year:'numeric'});
    const isUrgent = isFirstDay;
    await Notifs.send(user.uid, {
      title: isUrgent ? `${emojiIcon('🚨',16)} Self-Assessment Due Today` : `${emojiIcon('📋',16)} Self-Assessment Reminder`,
      body: isUrgent
        ? `Please complete your self-assessment for ${monthLabel} today before payroll is finalized.`
        : `Reminder: Your self-assessment for ${monthLabel} is due tomorrow. Go to Personal Finance → Self Evaluate.`,
      icon: isUrgent ? `${emojiIcon('🚨',16)}` : `${emojiIcon('📋',16)}`, type: 'payroll_reminder',
      dedupKey: `selfassess-${user.uid}-${currentMonth}`
    });
    localStorage.setItem(dedupKey, '1');
  } catch(e) { console.warn('[checkPayrollDuties]', e); }
}

// ── CA Deduction Reminder ─────────────────────────
// 7 days before the 25th (payday), remind employees with an active CA
// to submit their preferred deduction amount for the upcoming payroll.
async function checkCAReminder(user) {
  try {
    const todayStr = bizDate();
    const day    = parseInt(todayStr.slice(8,10),10);
    const PAYDAY = 25;
    if (day !== PAYDAY - 7) return; // only fires on the 18th

    const dedupKey = `bi-ca-remind-${user.uid}-${todayStr}`;
    if (localStorage.getItem(dedupKey)) return;

    const snap = await db.collection('cash_advances')
      .where('userId','==',user.uid).where('status','==','approved').get().catch(()=>({docs:[]}));
    const activeCA = snap.docs.filter(d=>(d.data().balance||0)>0);
    if (!activeCA.length) return;

    const totalBalance = activeCA.reduce((s,d)=>s+(d.data().balance||0),0);
    await Notifs.send(user.uid, {
      title: '💳 Payroll in 7 Days — CA Deduction',
      body: `You have ₱${totalBalance.toLocaleString('en-PH')} outstanding CA. Go to Personal Finance to set your preferred deduction amount for this payroll.`,
      icon: '💳', type: 'ca_deduct_remind',
      dedupKey: `ca-remind-${todayStr}`
    });
    localStorage.setItem(dedupKey, '1');
  } catch(e) { console.warn('[checkCAReminder]', e); }
}

// ── Splash ────────────────────────────────────────
const _splashStart = Date.now();
const _SPLASH_MIN_MS = 1600;
function hideSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash || splash.classList.contains('hiding')) return;
  const wait = Math.max(0, _SPLASH_MIN_MS - (Date.now() - _splashStart));
  setTimeout(() => {
    splash.classList.add('hiding');
    setTimeout(() => { splash.style.display = 'none'; }, 420);
  }, wait);
}

// ── Screens ───────────────────────────────────────
function showLogin() {
  hideSplash();
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}
let _ptrInit = false;
function showApp() {
  hideSplash();
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  // a11y (Phase 188): explicit landmark roles on the shell — additive only,
  // the underlying elements already are semantic <header>/<nav>/<main> tags in
  // index.html, but explicit role+aria-label gives older/stricter AT a clean
  // read (e.g. two <nav>s need distinguishing labels). Static index.html
  // markup is a separate follow-up pass — this covers it via JS on load.
  document.getElementById('topbar')?.setAttribute('role', 'banner');
  document.getElementById('sidebar-nav')?.setAttribute('role', 'navigation');
  document.getElementById('sidebar-nav')?.setAttribute('aria-label', 'Primary');
  document.getElementById('bottom-nav')?.setAttribute('role', 'navigation');
  document.getElementById('bottom-nav')?.setAttribute('aria-label', 'Bottom');
  document.getElementById('top-nav-strip')?.setAttribute('role', 'navigation');
  document.getElementById('top-nav-strip')?.setAttribute('aria-label', 'Bottom');
  document.getElementById('page-content')?.setAttribute('role', 'main');
  // Init Lucide icons for static topbar elements
  if (window.lucide) lucide.createIcons();
  // Reset any iOS zoom that happened during login input
  _resetViewportZoom();
  // Pull-to-refresh (init once)
  if (!_ptrInit) { _ptrInit = true; initPullToRefresh(); }
}

// ── Pull-to-Refresh ───────────────────────────────
function initPullToRefresh() {
  // v14 (owner: "it keeps refreshing when I quickly scroll back up") —
  // pull-to-refresh DISABLED. A fast upward flick that overshoots the top
  // kept arming a refresh, and after two retunes it still misfired. The app
  // is real-time (Firestore listeners), so manual refresh is redundant; the
  // gesture is removed entirely rather than tuned again. The #ptr-indicator
  // is hidden below. To re-enable, delete this early return.
  const _ind = document.getElementById('ptr-indicator');
  if (_ind) _ind.style.display = 'none';
  return;
  /* eslint-disable no-unreachable */
  const mc  = document.getElementById('main-content');
  const ind = document.getElementById('ptr-indicator');
  if (!mc || !ind) return;

  // v14 accidental-touch retune (owner report): the G4 values were too easy
  // to trip while scrolling. Bigger dead zone + higher commits + momentum
  // guard + vertical axis-lock below = only a deliberate pull refreshes.
  const DEAD_ZONE    = 80;   // px ignored at the start of the drag
  const THRESHOLD    = 150;  // px past dead zone → soft refresh (navigateTo)
  const HARD_THRESH  = 280;  // px past dead zone → hard refresh (location.reload)
  const MAX_PULL     = 450;  // visual cap

  // SVG ring: circumference of r=14 circle = 2π×14 ≈ 87.96
  const CIRC = 2 * Math.PI * 14;
  const arc  = ind.querySelector('.ptr-ring-arc');
  const icon = ind.querySelector('.ptr-ring-icon');
  const lbl  = ind.querySelector('.ptr-label');

  let startY = 0, startTime = 0, pulling = false, refreshing = false, lastDy = 0, wasReady = false, wasHard = false;

  function setArc(pct) {
    if (!arc) return;
    // dashoffset: CIRC = empty, 0 = full ring
    arc.style.strokeDashoffset = String(CIRC * (1 - Math.min(pct, 1)));
  }

  function updateInd(dist) {
    const softPct = Math.min(dist / THRESHOLD, 1);
    const hard    = dist >= HARD_THRESH;
    const ready   = dist >= THRESHOLD;

    if (ready && !wasReady) window.haptic && window.haptic('light');   // v14 G2 — crossed soft (refresh) threshold
    if (hard && !wasHard) window.haptic && window.haptic('medium');    // v14 G2 — crossed hard (full reload) threshold
    wasReady = ready; wasHard = hard;

    // Slide in — travels further the more you pull
    const travel = Math.min(dist * 0.48, 52);
    ind.style.transform = `translateX(-50%) translateY(${travel}px)`;
    ind.style.opacity   = String(Math.min(softPct * 1.8, 1));

    setArc(softPct);
    ind.classList.toggle('ptr-ready', ready);
    ind.classList.toggle('ptr-hard',  hard);
    ind.classList.remove('ptr-refreshing');

    if (icon) icon.textContent = ready ? '↑' : '↓';
    if (lbl)  lbl.textContent  = hard ? '🔄 Release for full reload' : ready ? 'Release to refresh' : 'Pull to refresh';
  }

  function hideInd() {
    ind.style.transition = 'transform .30s cubic-bezier(0.25,0.46,0.45,0.94), opacity .30s ease';
    ind.style.transform  = 'translateX(-50%) translateY(-90px)';
    ind.style.opacity    = '0';
    setTimeout(() => {
      ind.style.transition = '';
      ind.classList.remove('ptr-ready','ptr-hard','ptr-refreshing');
      setArc(0);
      if (icon) icon.textContent = '↓';
    }, 320);
  }

  let _lastMcScrollAt = 0;
  mc.addEventListener('scroll', () => { _lastMcScrollAt = Date.now(); }, { passive: true });
  mc.addEventListener('touchstart', e => {
    if (refreshing || mc.scrollTop > 2) return;
    // momentum guard: a touch landing during/just after scroll momentum is a
    // scroll-stop, never the start of a deliberate pull
    if (Date.now() - _lastMcScrollAt < 200) return;
    startY    = e.touches[0].clientY;
    startTime = Date.now();
    lastDy    = 0;
    pulling   = true;
    wasReady = false; wasHard = false;
  }, { passive: true });

  mc.addEventListener('touchmove', e => {
    if (!pulling || refreshing) return;
    const raw = e.touches[0].clientY - startY;
    if (raw <= 0) { pulling = false; hideInd(); return; }
    const dy = Math.max(0, raw - DEAD_ZONE);
    lastDy = dy;
    if (dy === 0) return;
    const elapsed = Date.now() - startTime;
    if (dy < 30 && elapsed < 120) return;
    updateInd(Math.min(dy, MAX_PULL));
  }, { passive: true });

  mc.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    if (lastDy < THRESHOLD) { hideInd(); return; }

    const doHardReload = lastDy >= HARD_THRESH;
    refreshing = true;
    ind.classList.add('ptr-refreshing');
    if (lbl) lbl.textContent = doHardReload ? 'Reloading…' : 'Refreshing…';
    setArc(1); // fill ring completely

    if (doHardReload) {
      await new Promise(r => setTimeout(r, 500));
      location.reload();
      return;
    }
    try { await navigateTo(currentPage); } catch(e) { /* ignore */ }
    await new Promise(r => setTimeout(r, 400));
    hideInd();
    setTimeout(() => { refreshing = false; }, 340);
  }, { passive: true });
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
    // Perf: the payroll/{uid} doc is keyed by the already-known user.uid, so
    // it doesn't actually depend on the users-doc read below — fire both in
    // parallel instead of paying two sequential Firestore round trips on every
    // cold boot. .catch(()=>null) here (rather than letting it throw into the
    // outer try/catch) preserves the original "no own payroll doc yet → pay
    // reads as 0" behavior for the merge step further down.
    const payrollPromise = db.collection('payroll').doc(user.uid).get().catch(() => null);
    let snap = await db.collection('users').doc(user.uid).get();
    if (!snap.exists) {
      const counterRef = db.collection('_counters').doc('employees');
      const empId = await db.runTransaction(async t => {
        const c = await t.get(counterRef);
        const next = (c.exists ? c.data().count : 0) + 1;
        t.set(counterRef, { count: next }, { merge: true });
        return `BI-${bizYear()}-${String(next).padStart(3,'0')}`;
      });
      const profile  = {
        uid: user.uid, email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        role: 'employee', departments: [], title: '',
        employeeId: empId,
        photoUrl: '', startDate: bizDate(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection('users').doc(user.uid).set(profile);
      dbCacheInvalidate && dbCacheInvalidate('users');
      snap = await db.collection('users').doc(user.uid).get();
    }
    userProfile  = { id: snap.id, ...snap.data() };
    // Merge the user's OWN pay (salary/allowance/deductions) from the protected
    // payroll/{uid} doc — pay no longer lives on the world-readable users doc.
    try {
      const paySnap = await payrollPromise;
      if (paySnap && paySnap.exists) userProfile = { ...userProfile, ...paySnap.data() };
    } catch(e) { /* no own payroll doc yet → pay reads as 0 */ }
    currentRole  = userProfile.role || 'employee';
    // Support both old string 'department' and new array 'departments'
    if (Array.isArray(userProfile.departments) && userProfile.departments.length) {
      currentDepts = userProfile.departments;
    } else if (userProfile.department) {
      currentDepts = [userProfile.department];
    } else {
      currentDepts = [];
    }
    // Expose state on window so inline onclick handlers in templates can access them
    window.currentUser  = currentUser;
    window.currentRole  = currentRole;
    window.currentDepts = currentDepts;
    window.userProfile  = userProfile;
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
    // On mobile the avatar IS the profile menu (Facebook-style) — tapping your
    // picture opens the drawer (settings, notification prefs, sign out, and a
    // "View My Profile →" link). This lets us drop the redundant second
    // hamburger from the top bar. On desktop it jumps straight to the page.
    ta.onclick = () => {
      const mobile = window.matchMedia ? window.matchMedia('(max-width:768px)').matches : window.innerWidth <= 768;
      if (mobile && typeof openProfileDrawer === 'function') openProfileDrawer();
      else navigateTo('my-profile');
    };
  }
  const mb = document.getElementById('topbar-menu-btn');
  if (mb) mb.onclick = openProfileDrawer;
  const sa = document.getElementById('sidebar-avatar');
  if (sa) sa.innerHTML = userProfile.photoUrl ? `<img src="${userProfile.photoUrl}"/>` : initial;
  const sn = document.getElementById('sidebar-user-name');
  if (sn) sn.textContent = userProfile.displayName || userProfile.email;
  const sr = document.getElementById('sidebar-user-role');
  if (sr) sr.textContent = roleName;
  const sd = document.getElementById('sidebar-user-dept');
  if (sd) sd.textContent = currentDepts.join(' · ') || '';

  // Profile photo is MANDATORY for non-partners — it's required to issue the
  // Barro Industries company ID. External partners are exempt (no company ID).
  // Show a blocking gate until a photo is set; it's idempotent + self-guards.
  if (!userProfile.photoUrl && currentRole && currentRole !== 'partner') {
    setTimeout(requireProfilePhoto, 800);
  }
}

// Blocking gate: a non-partner with no profile photo must upload one before
// using the app, because the digital company ID can't be generated without it.
function requireProfilePhoto() {
  if (!userProfile || userProfile.photoUrl) return;       // already set
  if (currentRole === 'partner' || !currentRole) return;  // partners exempt
  if (document.getElementById('req-photo-overlay')) return;
  const ov = document.createElement('div');
  ov.id = 'req-photo-overlay';
  // Wave 6 D1: mandatory blocking gate — must outrank dialogs (var(--z-dialog)
  // is only 5000) AND the new toast/system-banner tiers, so it reuses the
  // highest existing token (--z-splash) rather than var(--z-dialog). This
  // preserves the pre-existing "always on top of literally everything"
  // behavior (was a raw 100000 literal) instead of letting a dialog, toast,
  // or system banner render over a screen the user cannot dismiss without
  // uploading a required photo.
  ov.style.cssText = 'position:fixed;inset:0;z-index:var(--z-splash, 9999);background:rgba(8,11,20,0.92);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `
    <div style="max-width:380px;width:100%;background:var(--surface,#1e2433);border:1px solid var(--border);border-radius:18px;padding:26px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.5)">
      <div style="width:84px;height:84px;border-radius:50%;background:var(--surface2,#252b3b);display:flex;align-items:center;justify-content:center;font-size:40px;margin:0 auto 14px">${emojiIcon('📷',40)}</div>
      <h3 style="margin:0 0 8px;font-size:18px;color:var(--text)">Profile photo required</h3>
      <p style="font-size:13px;color:var(--text-muted);line-height:1.6;margin:0 0 18px">A clear photo of yourself is needed to generate your <strong>Barro Industries company ID</strong>. Please upload one to continue.</p>
      <button id="req-photo-btn" class="btn-primary" style="width:100%">${emojiIcon('📤',16)} Upload Photo</button>
      <div id="req-photo-status" style="font-size:12px;color:var(--text-muted);margin-top:10px"></div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [ov] });
  document.body.appendChild(ov);
  document.getElementById('req-photo-btn').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const st = document.getElementById('req-photo-status');
      if (st) st.textContent = 'Uploading…';
      try {
        const url = await Drive.uploadProfilePhoto(file, currentUser.uid);
        await db.collection('users').doc(currentUser.uid).update({ photoUrl: url });
        userProfile.photoUrl = url;
        applyUserUI();
        ov.remove();
        Notifs.success('Photo saved — your company ID is ready!');
      } catch (err) {
        if (st) st.textContent = 'Upload failed — please try again.';
        else Notifs.showToast('Upload failed','error');
      }
    };
    input.click();
  };
}

// showPhotoPrompt (non-blocking "Add a profile photo" corner banner) —
// DELETED, Wave 7 Pass 10 cleanup (2026-08-03). Verified zero callers
// (grepped clean; only match anywhere was its own definition line):
// superseded by requireProfilePhoto() above, the actual blocking gate wired
// to applyUserUI() via setTimeout(requireProfilePhoto, 800).

// ── Login ─────────────────────────────────────────
function initLogin() {
  // Pre-fill saved email
  const savedEmail = localStorage.getItem('bi-saved-email');
  if (savedEmail) {
    document.getElementById('email').value = savedEmail;
    document.getElementById('remember-me').checked = true;
  }
  // Legacy guest login was removed from index.html — clear its stale key. (A device
  // still holding 'bi-guest-name' used to throw here on the missing #guest-name
  // element, which blocked the auth listener from attaching → app stuck on splash.)
  localStorage.removeItem('bi-guest-name');

  // Role picker cards (admin / employee / partner)
  document.querySelectorAll('.login-role-card[data-type]').forEach(card => {
    card.addEventListener('click', () => {
      const type = card.dataset.type;
      selectedLoginType = type; // store for post-login role check
      document.getElementById('login-type-pill').textContent = LOGIN_TYPE_LABELS[type] || type;
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
    selectedLoginType = null; // reset so restored sessions aren't gated
  });

  document.getElementById('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    setLoginLoading(true); clearLoginError();
    try {
      let input = document.getElementById('email').value.trim();
      let emailToUse = input;

      // Username login: no @ means it's a username, look up their auth email.
      // v12 WS19: resolves via the public usernames/{u} map instead of querying
      // /users directly — that query ran pre-auth (request.auth is still null
      // here), and /users' read rule requires isAuth(), so this always denied
      // before the map existed (worker username login was silently broken).
      if (!input.includes('@')) {
        const unameDoc = await db.collection('usernames').doc(input.toLowerCase()).get();
        if (!unameDoc.exists) {
          showLoginError('No account found with that username. Contact HR.');
          setLoginLoading(false); return;
        }
        emailToUse = unameDoc.data().email;
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
  const rand   = crypto.getRandomValues(new Uint32Array(2));
  const digits = String((rand[0] % 900) + 100); // 3 digits, cryptographically random
  const syms   = ['!', '@', '#', '$', '%', '&'];
  const sym    = syms[rand[1] % syms.length];
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
    'auth/user-not-found':          'No account found. Contact HR.',
    'auth/wrong-password':          'Incorrect password.',
    'auth/invalid-email':           'Invalid email or username.',
    'auth/too-many-requests':       'Too many attempts. Try later.',
    'auth/invalid-credential':      'Incorrect username or password.',
    // Re-audit 2026-08-03 — these three fall-through cases each need a
    // different response (retry vs. contact HR vs. try again shortly), but
    // all silently rendered the same generic 'Sign-in failed.' before this.
    'auth/network-request-failed':  'No internet connection. Check your network and try again.',
    'auth/user-disabled':           'This account has been disabled. Contact HR.',
    'auth/internal-error':          'Something went wrong on our end. Please try again in a moment.'
  }[code] || 'Sign-in failed.';
}

// ── Theme (WS42 Phase 4 — Light / Dark / Astral + Auto) ──────────────────
const THEMES = {
  auto:   { label: 'Auto',   cls: () => matchMedia('(prefers-color-scheme: dark)').matches ? 'theme-dark' : 'light' },
  light:  { label: 'Light',  cls: 'light' },
  dark:   { label: 'Dark',   cls: 'theme-dark' },
  astral: { label: 'Astral', cls: 'theme-astral' },
};
// cls may now be a string | null | function → string|null. Resolve everywhere via _themeCls().
function _themeCls(t){ const c = THEMES[t] && THEMES[t].cls; return typeof c === 'function' ? c() : c; }

// Pre-WS42 stored values migrate onto the new 3-theme set, once, in place.
const THEME_MIGRATION = { office: 'light', pink: 'light', grey: 'light', midnight: 'dark' };

function initTheme() {
  // Default is Light (decided 2026-07-08, reaffirmed WS42). Users who already
  // picked a theme keep their choice — old theme names migrate transparently.
  let stored = localStorage.getItem('bi-theme');
  if (stored && THEME_MIGRATION[stored]) {
    stored = THEME_MIGRATION[stored];
    localStorage.setItem('bi-theme', stored);
  }
  setTheme(stored || 'light', false);
  // When 'auto' is active, follow the OS scheme instantly (no reload).
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onOsScheme = () => { if ((localStorage.getItem('bi-theme') || 'light') === 'auto') setTheme('auto', false); };
  mq.addEventListener ? mq.addEventListener('change', onOsScheme) : mq.addListener(onOsScheme);
}

function setTheme(theme, persist = true) {
  if (THEME_MIGRATION[theme]) theme = THEME_MIGRATION[theme]; // defensive — old callers/links may still pass a legacy key
  if (!THEMES[theme]) theme = 'light';
  const html = document.documentElement;
  // strip every class any theme (current + legacy) could add
  ['light','theme-office','theme-midnight','theme-pink','theme-grey','theme-dark','theme-astral'].forEach(c => html.classList.remove(c));
  const cls = _themeCls(theme);
  if (cls) cls.split(' ').forEach(c => html.classList.add(c));
  if (persist) localStorage.setItem('bi-theme', theme);
  _syncThemeColorMeta();          // keep <meta name=theme-color> in step with the rendered theme
  // v12 WS40 — lets any open chart-bearing screen (Analytics) re-render its
  // chrome colors live, including the 'auto' matchMedia flip (initTheme already
  // routes that through setTheme('auto', false), so no second listener needed).
  window.dispatchEvent(new CustomEvent('bi-theme-change'));
}
// Read the resolved --theme-color (falls back to --bg) and write it to the meta tag.
function _syncThemeColorMeta(){
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  const cs = getComputedStyle(document.documentElement);
  const c = (cs.getPropertyValue('--theme-color') || cs.getPropertyValue('--bg') || '').trim();
  if (c) meta.setAttribute('content', c);
}

function getTheme() {
  const stored = localStorage.getItem('bi-theme');
  return (stored && THEME_MIGRATION[stored]) || stored || 'light';
}

// ── Navigation ────────────────────────────────────
function buildNav() {
  buildSidebarNav(); buildBottomNav(); buildTopNavStrip();
  // Global search is internal-only — show the topbar magnifier for everyone except partners / Brilliant-Steel-only
  const gs = document.getElementById('global-search-btn');
  if (gs) { gs.style.display = (isPartner() || isBrilliantOnly()) ? 'none' : ''; gs.setAttribute('aria-label', 'Global search'); }
  // v12 WS42 nav-consolidation — the standalone topbar-depts-btn (grid icon)
  // and topbar-chat-btn were removed: Chat is already a center top-nav-strip
  // tab, and departments stay reachable via the persistent sidebar (each of
  // currentDepts is listed there; admins get an explicit "All Departments"
  // entry in getSidebarItems). deptsForSwitcher()/buildDeptsPanel() and the
  // #depts-panel/#depts-list/#depts-backdrop markup they drove were DELETED,
  // Wave 7 Pass 10 cleanup (2026-08-03) — verified zero callers (their only
  // caller was the removed topbar-depts-btn, which no longer exists in
  // index.html either).
  // a11y: label icon-only topbar nav controls.
  document.getElementById('menu-toggle')?.setAttribute('aria-label', 'Open menu');
  placeTopbarActions();
}

function isPresident() { return currentRole === 'president'; }
function isPartner() { return currentRole === 'partner'; }
// Type-B (Production, weekly) self-service worker — payClass lives on
// payroll/{uid} and is merged onto window.userProfile by loadUserProfile()
// above (own-uid read, firestore.rules payroll/{uid}). Set via js/screens/
// hr.js's "Employee Type" selector (Edit Payroll). See js/screens/worker.js's
// file header for the full Type-B architecture (worker_profiles.linkedUid
// bridge, attendance_worker schema, geofencing).
function isTypeBWorker() { return !!(window.userProfile && userProfile.payClass === 'production'); }
function isBrilliantOnly() { return currentDepts.length === 1 && currentDepts[0] === 'Brilliant Steel'; }
// A Brilliant Steel partner gets the BS-locked portal (their pricing, client book,
// 50/50 split). A generic partner is any other company doing projects WITH Barro —
// they get a company-branded portal: their affiliated projects + quote generation.
function isBrilliantPartner() { return isPartner() && currentDepts.includes('Brilliant Steel'); }
function isGenericPartner()   { return isPartner() && !currentDepts.includes('Brilliant Steel'); }
// Display name of the partner's own company (set by the President on the user doc).
function partnerCompanyName() {
  return (window.userProfile && userProfile.company) ||
         (currentDepts.includes('Brilliant Steel') ? 'Brilliant Steel' : 'Partner');
}

// v14 C1 — which NAV_REGISTRY variant bucket the signed-in user's chrome comes
// from. SAME branch order as the pre-C1 getSidebarItems/_primaryNavItems
// (admin → generic-partner → partner → brilliant-only → staff) so every
// existing role/dept combination resolves to the identical bucket it did before.
function _navVariant() {
  const pres = isPresident() || currentRole === 'manager' || currentRole === 'secretary';
  if (pres) return 'admin';
  const partner = isPartner();
  if (partner && isGenericPartner()) return 'genericPartner';
  if (partner) return 'partnerBS';
  if (isBrilliantOnly()) return 'bsOnly';
  // Type-B (Production, weekly self-service worker) — checked after the
  // admin/partner branches above (an admin or partner never resolves here in
  // practice, but this keeps the same "higher tiers win" order the rest of
  // this function already follows) so their own chrome is never downgraded
  // to the minimal Home/Chat/Profile bar meant for a production floor worker.
  if (isTypeBWorker()) return 'workerB';
  return 'staff';
}
// Evaluate a NAV_REGISTRY predicate by name (live state, not baked into the
// registry — see config.js NAV_REGISTRY comment).
function _navPredicateOk(name) {
  const fn = window.NAV_REGISTRY && window.NAV_REGISTRY.predicates && window.NAV_REGISTRY.predicates[name];
  return typeof fn === 'function' ? !!fn() : false;
}
// Departments — appear ABOVE the Management section, in the 'staff' sidebar
// variant only. The Accountant (finance role) always sees the Finance
// department even when she isn't explicitly assigned to it; Finance is her one
// department (Sales Orders, Payroll, Ledger, etc. all live inside the Finance
// hub as tabs). Per-user data, not static nav config — NAV_REGISTRY's 'staff'
// list marks WHERE this goes with a `{deptLoop:true}` placeholder; this is
// that block, unchanged from the pre-C1 inline version.
function _pushDeptNavItems(items) {
  const navDepts = (currentRole === 'finance' && !currentDepts.includes('Finance'))
    ? ['Finance', ...currentDepts]
    : currentDepts;
  navDepts.forEach((dept, i) => {
    const cfg = DEPARTMENTS[dept];
    // v12 WS42 Phase 21 — dept nav items get their own harmonized color tile
    // (inline background override beats the generic `dept:*` orange CSS rule).
    if (cfg) items.push({ icon: cfg.icon, iconHtml: `<span class="nav-icon" style="background:${cfg.gradient}">${emojiIcon(cfg.lucideIcon||cfg.icon,18)}</span>`, label: dept, page: `dept:${dept}`, section: i === 0, sectionLabel: 'My Departments' });
  });
}
function getSidebarItems() {
  const reg = window.NAV_REGISTRY;
  const variant = _navVariant();
  const items = [];
  (reg.sidebarUniversal || []).forEach(e => {
    items.push({ icon: e.icon, label: e.label, page: e.page });
  });
  (reg.sidebar[variant] || []).forEach(e => {
    if (e.deptLoop) { _pushDeptNavItems(items); return; }
    if (e.when && !_navPredicateOk(e.when)) return;
    const item = { icon: e.icon, label: e.label, page: e.page };
    if (e.section) item.section = true;
    if (e.sectionLabel) item.sectionLabel = e.sectionLabel;
    items.push(item);
  });
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
    // v12 WS42 Phase 15: label wrapped in .nav-label (was a bare text node) so the
    // 820–1023px icon-rail tier can hide it via CSS; title="" gives that tier a
    // native hover tooltip for free — no new tooltip JS needed.
    return `${secLabel}<button class="nav-item pressable" data-page="${item.page}" title="${escHtml(item.label)}">${item.iconHtml || _navIcon(item.icon)}<span class="nav-label">${item.label}</span></button>`;
  }).join('');
  nav.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Matches the bottom-nav-item/More-sheet-row tap haptic (re-audit
      // 2026-08-03) — the sidebar is reachable by touch (off-canvas drawer,
      // tablet-rail widths), so it shouldn't be the one primary-nav surface
      // that stays silent.
      window.haptic && window.haptic('light');
      navigateTo(btn.dataset.page);
      // navigateTo() already runs Overlay.clearAll() (tearing down + consuming
      // the sidebar's history entry if one is open); this is a harmless no-op
      // safety net for any path that reaches here without an Overlay entry.
      requestCloseSidebar();
    });
  });
  if (window.lucide) lucide.createIcons({ nodes: [nav] });
}

// Primary navigation items for the current role, minus Profile (Profile lives
// on the top-bar avatar → 'my-profile', so a duplicate tab is redundant).
// v14 C1 — reads NAV_REGISTRY.bottom[variant] directly (same variant resolution
// as the sidebar via _navVariant()) instead of picking between the 5 hand-rolled
// *_BOTTOM_NAV globals; those globals still exist (config.js), now derived FROM
// the registry, kept only for back-compat.
function _primaryNavItems() {
  const items = (window.NAV_REGISTRY.bottom[_navVariant()] || []);
  return items.filter(item => item.page !== 'my-profile');
}

// v14 mobile-shell batch (ruled decision N3, never implemented until now) —
// cap the bar at 5 tabs: the first 4 items in today's order + a 'More' tab
// whenever a variant has more than 5 (today that's 'admin' and 'bsOnly';
// 'genericPartner'/'partnerBS'/'staff' already sit at exactly 5 after
// _primaryNavItems() strips Profile, so they render unchanged — no More tab,
// nothing collapses, and every item keeps its own roomy column).
function _bottomNavSplit(items) {
  if (items.length <= 5) return { visible: items, more: [] };
  return { visible: items.slice(0, 4), more: items.slice(4) };
}
// The only known nav-badge source today is Chat's unread-conversation count
// (chat.js paints `.bottom-nav-item[data-page="chat"] .bn-badge` directly and
// caches the same number in localStorage — see chat.js _updateChatNavBadge /
// _chatBadgeStorageKey). Chat sits in the visible 4 for every current
// NAV_REGISTRY.bottom variant, so this is normally a no-op; it exists so the
// badge doesn't silently vanish if a future variant/layout ever pushes 'chat'
// into the collapsed "More" set — the count follows the item onto the More
// tab (and into its sheet row) instead.
function _moreNavBadgeCount(morePages) {
  if (!morePages.includes('chat')) return 0;
  try {
    const uid = (window.currentUser && currentUser.uid) || '';
    const raw = uid && localStorage.getItem('bi-chat-unread-count-' + uid);
    return raw ? (parseInt(raw, 10) || 0) : 0;
  } catch (_) { return 0; }
}
// The 'More' tab's bottom sheet — tappable rows (icon + label + chevron).
// Deliberately NOT the sidebar's _navIcon() tile: that hardcodes stroke:#fff
// for its colored gradient backgrounds and renders invisible on this row's
// plain surface — .more-nav-row-icon (styles.css) uses currentColor instead.
// openModal() IS a bottom sheet on mobile (.modal-box mobile CSS:
// align-self:flex-end, top corners rounded, swipe-to-dismiss via gestures.js
// sheetHandleEl) — no separate sheet implementation needed.
function openMoreNavSheet(items) {
  const rows = items.map(item => {
    const badge = item.page === 'chat' ? _moreNavBadgeCount(['chat']) : 0;
    return `<button class="more-nav-row pressable${item.page === window.currentPage ? ' active' : ''}" data-page="${item.page}">
      <span class="more-nav-row-icon"><i data-lucide="${item.icon}"></i></span>
      <span class="more-nav-row-label">${item.label}</span>
      ${badge > 0 ? `<span class="more-nav-row-badge">${badge > 99 ? '99+' : badge}</span>` : ''}
      <i data-lucide="chevron-right" class="more-nav-row-chevron"></i>
    </button>`;
  }).join('');
  window.openModal('More', `<div class="more-nav-sheet">${rows}</div>`, '', {});
  document.querySelectorAll('#modal-body .more-nav-row').forEach(btn => {
    btn.addEventListener('click', () => {
      window.haptic && window.haptic('light');
      window.Overlay.dismissTop();
      navigateTo(btn.dataset.page);
    });
  });
}

// Messenger/Facebook-style: primary tabs live in a full-width BOTTOM bar on
// mobile (owner request 2026-07-12 — the crammed top tab strip was replaced by
// this + a clean top bar). setActiveNav() highlights .bottom-nav-item by page.
function buildBottomNav() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const { visible, more } = _bottomNavSplit(_primaryNavItems());
  const morePages = more.map(m => m.page);
  const moreBadge = _moreNavBadgeCount(morePages);
  nav.innerHTML = visible.map(item =>
    `<button class="bottom-nav-item pressable" data-page="${item.page}">
       <span class="bn-icon-wrap" style="position:relative;display:inline-flex">
         ${_bnIcon(item.icon)}
         ${item.badge ? `<span class="bn-badge" style="display:none">0</span>` : ''}
       </span>
       <span class="bn-label">${item.label}</span>
     </button>`
  ).join('') + (more.length ? `
    <button class="bottom-nav-item pressable" id="bottom-nav-more" data-page="__more__" data-more-pages="${morePages.join(',')}">
       <span class="bn-icon-wrap" style="position:relative;display:inline-flex">
         ${_bnIcon('menu')}
         ${moreBadge > 0 ? `<span class="bn-badge">${moreBadge > 99 ? '99+' : moreBadge}</span>` : ''}
       </span>
       <span class="bn-label">More</span>
     </button>` : '');
  nav.querySelectorAll('[data-page]').forEach(btn => {
    if (btn.id === 'bottom-nav-more') { btn.addEventListener('click', () => { window.haptic && window.haptic('light'); openMoreNavSheet(more); }); return; }
    btn.addEventListener('click', () => { window.haptic && window.haptic('light'); navigateTo(btn.dataset.page); }); // v14 G2 — bottom-nav tap
  });
  if (window.lucide) lucide.createIcons({ nodes: [nav] });
}

// The mobile top strip is now just a brand wordmark (left) + the relocated
// action icons (#tn-actions: search/notif/menu/avatar, moved in by
// placeTopbarActions). No page tabs here anymore — those are the bottom bar.
function buildTopNavStrip() {
  const tabs = document.getElementById('tn-tabs');
  if (!tabs) return;
  tabs.innerHTML = `<span class="tn-brand">Barro Industries</span>`;
}

// v12 WS42 nav-consolidation — the mobile top strip absorbs the standalone
// topbar row (owner decision: "one slim top bar"). Rather than duplicating
// markup/handlers, physically relocate the real topbar control nodes
// (menu-toggle/nav-back-btn on the left, search/notif/menu/avatar on the
// right) into the strip's pinned zones on mobile, and restore them to the
// topbar on desktop/tablet-rail widths. All existing ids/handlers
// (applyUserUI, buildNav, notifications.js initToggle) are untouched since
// they resolve elements by getElementById regardless of DOM parent.
const TOPBAR_MOBILE_MQ = (() => { try { return window.matchMedia('(max-width: 768px)'); } catch (_) { return null; } })();
function placeTopbarActions() {
  const topbar  = document.getElementById('topbar');
  const lead    = document.getElementById('tn-lead');
  const actions = document.getElementById('tn-actions');
  if (!topbar || !lead || !actions) return;
  const logoArea = topbar.querySelector('.topbar-logo-area');
  const mobile = TOPBAR_MOBILE_MQ ? TOPBAR_MOBILE_MQ.matches : window.innerWidth <= 768;
  const leadIds    = ['menu-toggle', 'nav-back-btn'];
  const actionIds  = ['global-search-btn', 'notif-btn', 'topbar-menu-btn', 'topbar-avatar'];
  if (mobile) {
    leadIds.forEach(id => { const el = document.getElementById(id); if (el && el.parentElement !== lead) lead.appendChild(el); });
    actionIds.forEach(id => { const el = document.getElementById(id); if (el && el.parentElement !== actions) actions.appendChild(el); });
  } else {
    leadIds.forEach(id => { const el = document.getElementById(id); if (el && el.parentElement !== topbar) topbar.insertBefore(el, logoArea || topbar.firstChild); });
    actionIds.forEach(id => { const el = document.getElementById(id); const right = topbar.querySelector('.topbar-right'); if (el && right && el.parentElement !== right) right.appendChild(el); });
  }
}
window.placeTopbarActions = placeTopbarActions;
if (TOPBAR_MOBILE_MQ) {
  const _onMqChange = () => placeTopbarActions();
  if (TOPBAR_MOBILE_MQ.addEventListener) TOPBAR_MOBILE_MQ.addEventListener('change', _onMqChange);
  else if (TOPBAR_MOBILE_MQ.addListener) TOPBAR_MOBILE_MQ.addListener(_onMqChange); // Safari <14 fallback
}
document.addEventListener('DOMContentLoaded', placeTopbarActions);

// deptsForSwitcher/buildDeptsPanel (topbar department-switcher dropdown,
// driven by the now-removed topbar-depts-btn grid icon) — DELETED, Wave 7
// Pass 10 cleanup (2026-08-03). Verified zero callers (grepped clean across
// the whole tree for both names as call sites). See buildNav()'s comment
// above for the v12 WS42 nav-consolidation context.

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || !sidebar.classList.contains('open')) return;
  sidebar.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.add('hidden');
  document.body.classList.remove('sidebar-open');
}
window.closeSidebar = closeSidebar;

// v13 Phase 105 -- open the off-canvas mobile sidebar and, on mobile/overlay
// mode only, register it with the Overlay history stack so device Back closes
// it instead of leaving it open while the page behind it navigates. The
// desktop sidebar is persistent (CSS never applies the off-canvas transform
// outside the <=768px breakpoint, see .menu-toggle{display:block} there) so
// it must never push -- gated on the same breakpoint the CSS uses.
function isMobileSidebarMode() {
  try { return window.matchMedia('(max-width: 768px)').matches; } catch (_) { return window.innerWidth <= 768; }
}
function openSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.classList.contains('open')) return;
  sidebar.classList.add('open');
  document.getElementById('sidebar-overlay')?.classList.remove('hidden');
  document.body.classList.add('sidebar-open');
  if (window.Overlay && isMobileSidebarMode()) window.Overlay.push('sidebar', () => closeSidebar());
}
window.openSidebar = openSidebar;
// Close path used by scrim/swipe/nav — routes through Overlay when the
// sidebar owns the top of the stack so Back-consuming stays in sync;
// falls back to a direct close for desktop (never pushed) or stale state.
function requestCloseSidebar() {
  if (window.Overlay && window.Overlay._stack.length &&
      window.Overlay._stack[window.Overlay._stack.length - 1].kind === 'sidebar') {
    window.Overlay.dismissTop();
  } else {
    closeSidebar();
  }
}
window.requestCloseSidebar = requestCloseSidebar;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar?.classList.contains('open')) requestCloseSidebar(); else openSidebar();
  });
  document.getElementById('sidebar-overlay')?.addEventListener('click', requestCloseSidebar);

  // v13 Phase 64 — left-edge OPEN swipe now lives solely in gestures.js's edge
  // handler (window.Overlay.isOpen() → dismissTop covers CLOSE for an open
  // sidebar, since openSidebar() pushes it onto the Overlay stack in mobile
  // mode). initSidebarSwipe (the old 22px-edge open/close tracker) is removed
  // to avoid two listeners racing on the same left-edge gesture.
  //
  // What gestures.js's edge handler does NOT reproduce: dragging LEFT while
  // already inside the open sidebar to close it (the edge handler only tracks
  // rightward drags, dx>0). That's a distinct, non-edge gesture scoped to the
  // sidebar element itself, so it's kept here as a minimal standalone listener
  // rather than bolting leftward-drag logic onto the edge-swipe-back handler.
  (function initSidebarCloseSwipe() {
    const CLOSE_DIST = 72;
    const MAX_TRAVEL  = 260;
    let sx = 0, sy = 0, tracking = false;
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.addEventListener('touchstart', e => {
      if (!sidebar.classList.contains('open')) { tracking = false; return; }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY;
      tracking = true;
    }, { passive: true });

    sidebar.addEventListener('touchmove', e => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - sx;
      const dy = Math.abs(e.touches[0].clientY - sy);
      if (dy > Math.abs(dx) + 8) { tracking = false; return; }
      if (Math.abs(dx) > MAX_TRAVEL) { tracking = false; return; }
      if (dx <= -CLOSE_DIST) {
        tracking = false;
        requestCloseSidebar();
      }
    }, { passive: true });

    sidebar.addEventListener('touchend', () => { tracking = false; }, { passive: true });
  })();
});

// Pull-to-refresh removed — navigation handled via top nav strip on mobile.

// ── Notifications Page ───────────────────────────
function renderNotificationsPage() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:18px;font-weight:800;color:var(--text)">${emojiIcon('🔔',18)} Notifications</h2>
    </div>
    <div id="notif-page-list" class="notif-list" style="max-height:none;overflow:visible">
      <div class="empty-state">No notifications</div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  window.Notifs?.renderPage?.();
}

// ── Quote Builder fullscreen (mobile) ────────────
// Mirrors chat.js's chat-fullscreen mechanism (owner req #2): a body class
// hides the app chrome (top strip + bottom nav) and the iframe covers the
// viewport edge-to-edge; safe-area clearance is handled entirely by CSS
// (see body.qb-fullscreen in styles.css) — no getBoundingClientRect
// measuring needed, unlike the old per-resize fitFrame() hack this replaces.
// Same ≤768px breakpoint the rest of the mobile shell uses (top-nav-strip /
// bottom-nav / sidebar), not the old one-off 700px check.
const QB_FULLSCREEN_MQ = '(max-width: 768px)';
function _qbIsMobile() { return !!(window.matchMedia && window.matchMedia(QB_FULLSCREEN_MQ).matches); }
let _qbExitPill = null;
function _qbBuildExitPill() {
  if (_qbExitPill && _qbExitPill.isConnected) return _qbExitPill;
  const btn = document.createElement('button');
  btn.id = 'qb-fullscreen-exit';
  btn.className = 'qb-exit-pill';
  btn.setAttribute('aria-label', 'Exit Quote Builder fullscreen');
  btn.innerHTML = '<i data-lucide="x"></i>';
  btn.addEventListener('click', () => { window.haptic && window.haptic('light'); window.Overlay ? window.Overlay.dismissTop() : exitQbFullscreen(); });
  document.body.appendChild(btn);
  if (window.lucide) lucide.createIcons({ nodes: [btn] });
  _qbExitPill = btn;
  return btn;
}
// Overlay-registered so device Back exits fullscreen (staying on the Quote
// Builder page) instead of leaving the app or navigating away — same
// lightweight "push a teardown, no visible panel" pattern notifications.js
// uses for its push-permission prompt card.
function enterQbFullscreen() {
  if (!_qbIsMobile()) return;
  if (document.body.classList.contains('qb-fullscreen')) return; // already entered — idempotent
  document.body.classList.add('qb-fullscreen');
  _qbBuildExitPill();
  if (window.Overlay) window.Overlay.push('qb-fullscreen', () => exitQbFullscreen());
}
function exitQbFullscreen() {
  document.body.classList.remove('qb-fullscreen');
  if (_qbExitPill) { _qbExitPill.remove(); _qbExitPill = null; }
}

// ── Quote Builder iframe ─────────────────────────
function renderQuoteBuilderIframe() {
  // Render the builder INSIDE the normal content area so the app's top bar and
  // navigation stay visible (navigateTo replaces this when leaving the builder).
  const c = document.getElementById('page-content');
  if (!c) return;
  // Partners / Brilliant-Steel-only users get a locked-down builder (no Admin/labor).
  // BS partners stay locked to Brilliant Steel pricing; a generic company partner
  // gets a builder branded to THEIR company with a Barro Kitchens header toggle.
  const partnerMode = (typeof isPartner === 'function' && isPartner()) ||
                      (typeof isBrilliantOnly === 'function' && isBrilliantOnly());
  let qbSrc = 'quote-builder-v2.html' + (partnerMode ? '?portal=partner' : '');
  if (typeof isGenericPartner === 'function' && isGenericPartner()) {
    const p = window.userProfile || {};
    const qs = new URLSearchParams({
      portal: 'partner',
      pcoName: (p.company || 'Partner'),
      pcoContact: (p.phone || ''),
      pcoSig: (p.displayName || '')
    });
    qbSrc = 'quote-builder-v2.html?' + qs.toString();
  }
  // A "Reopen" action from the Quotations list stashes the quote's editable
  // snapshot here — load it into the builder once the iframe is ready.
  const reopenState = window._qbReopenState; window._qbReopenState = null;
  // Owner report 2026-08-03: a stale localStorage draft's Resume banner could
  // override the loaded revision ("new revision opens the first draft").
  // Reopen/revision loads are AUTHORITATIVE: flag them in the URL so the
  // builder suppresses the draft-resume banner entirely for this boot.
  // Re-audit 2026-08-03: gate strictly on sourceDocId — reopenQuoteFromDoc/
  // newRevisionFromDoc (below) always stamp one onto a REAL reopen/revision of
  // an existing filed quote, but other _qbReopenState writers (e.g. Quick
  // Estimate's "Create Formal Quotation →" handoff in sales.js, which hands
  // off a fresh, never-filed basket) don't. Without this gate, reopen=1 fired
  // for ANY caller and silently suppressed the draft-resume prompt for a
  // genuinely different unsaved draft sitting in localStorage.
  if (reopenState && reopenState.sourceDocId) qbSrc += (qbSrc.includes('?') ? '&' : '?') + 'reopen=1';
  const reopenAsRevision = window._qbReopenAsRevision; window._qbReopenAsRevision = false;
  // President-review mode: editing a partner's quote to hand it back. The edits
  // are saved to the SAME (partner-owned) quote doc, not a new president copy.
  const reviewCtx = window._qbReviewContext; window._qbReviewContext = null;
  const reviewBanner = reviewCtx ? `
    <div id="qb-review-bar" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:linear-gradient(135deg,rgba(255,159,10,.12),transparent);border:1.5px solid var(--warning,#ff9f0a);border-radius:12px;padding:10px 14px;margin-bottom:10px">
      <div style="flex:1;min-width:180px;font-size:12px"><strong>Reviewing ${escHtml(reviewCtx.quoteNumber||'partner quote')}</strong> for ${escHtml(reviewCtx.clientName||'')} — edit the line items, then save it back to the partner.</div>
      <button class="btn-primary btn-sm" id="qb-return-edit">${emojiIcon('↩',16)} Save edits &amp; Return to Partner</button>
      <button class="btn-success btn-sm" id="qb-approve-edit">${emojiIcon('✅',16)} Save edits &amp; Approve</button>
    </div>` : '';
  // On phones/tablets (≤768px), drop the redundant "Quote Builder" heading (the
  // builder shows its own header) and go fullscreen via body.qb-fullscreen —
  // no inline sizing needed there, styles.css covers the viewport edge-to-edge.
  // Desktop keeps the heading + the old inline-sized layout.
  const isMobile = _qbIsMobile();
  const chrome = (reviewCtx ? 60 : 0) + 200;
  c.innerHTML = `
    ${reviewBanner}
    ${isMobile ? '' : `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
      <h2 style="font-size:16px;font-weight:800;color:var(--text)">${emojiIcon('🧮',16)} Quote Builder${reviewCtx?' <span style="font-size:12px;font-weight:600;color:var(--warning,#ff9f0a)">(reviewing a partner quote)</span>':reopenState?` <span style="font-size:12px;font-weight:600;color:var(--text-muted)">(${reopenAsRevision?'new revision':'editing a copy'})</span>`:''}</h2>
    </div>`}
    <iframe id="qb-frame" src="${qbSrc}" allow="print"
      style="${isMobile ? '' : `width:100%;height:calc(100dvh - ${chrome}px);min-height:460px;border:none;border-radius:12px;background:#f5f6fa`}"></iframe>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  // Enter/exit fullscreen fresh on every render — navigateTo() always tears
  // down any previous Overlay entry (Overlay.clearAll()) before this runs, so
  // there's never a stale 'qb-fullscreen' entry left on the stack to double up.
  exitQbFullscreen();
  if (isMobile) enterQbFullscreen();
  if (reopenState) {
    // Wave 3 Q2 — READY handshake replaces the old blind 450ms setTimeout race
    // (the iframe's 'load' event fires before its own script has attached its
    // message listener, so a fixed-delay guess could still lose the message).
    // The builder posts {type:'QB_READY'} once its listener is live; send
    // LOAD_QUOTE right then. Belt-and-braces: also send after 2s regardless,
    // in case QB_READY is somehow missed (e.g. listener attached before this
    // handler runs — the postMessage would be lost with no queue on our side).
    const frame = document.getElementById('qb-frame');
    let qbSent = false;
    const sendLoadQuote = () => {
      if (qbSent || !frame?.contentWindow) return;
      qbSent = true;
      try { frame.contentWindow.postMessage({ type:'LOAD_QUOTE', payload:{ editableState: reopenState, asRevision: reopenAsRevision } }, '*'); } catch(_){}
    };
    const onQbReady = (ev) => {
      if (ev.origin !== window.location.origin) return;
      if (!frame || ev.source !== frame.contentWindow) return;
      if (!ev.data || ev.data.type !== 'QB_READY') return;
      window.removeEventListener('message', onQbReady);
      sendLoadQuote();
    };
    window.addEventListener('message', onQbReady);
    setTimeout(() => { window.removeEventListener('message', onQbReady); sendLoadQuote(); }, 2000);
  }
  if (reviewCtx) {
    document.getElementById('qb-return-edit')?.addEventListener('click', () => saveReviewedPartnerQuote(reviewCtx, 'return'));
    document.getElementById('qb-approve-edit')?.addEventListener('click', () => saveReviewedPartnerQuote(reviewCtx, 'approve'));
  }
}

// Ask the builder iframe for its current edited state (resolves with the payload).
function requestBuilderState(frame, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    if (!frame || !frame.contentWindow) return reject(new Error('Builder not ready'));
    const to = setTimeout(() => { window.removeEventListener('message', h); reject(new Error('Builder did not respond')); }, timeoutMs);
    function h(ev) { if (ev.origin !== window.location.origin) return; if (ev.data && ev.data.type === 'QUOTE_STATE') { clearTimeout(to); window.removeEventListener('message', h); resolve(ev.data.payload || {}); } }
    window.addEventListener('message', h);
    try { frame.contentWindow.postMessage({ type: 'REQUEST_STATE' }, '*'); } catch (e) { clearTimeout(to); window.removeEventListener('message', h); reject(e); }
  });
}

// Save the president's edits back onto the partner's OWN quote doc (not a new copy),
// then approve it or return it for revision, and notify the partner.
async function saveReviewedPartnerQuote(ctx, action) {
  const frame = document.getElementById('qb-frame');
  let payload;
  try { payload = await requestBuilderState(frame); }
  catch (e) { Notifs.showToast('Could not read the edited quote — try again', 'error'); return; }
  const notes = action === 'return'
    ? ((await promptDialog({message:'Notes for the partner (what changed / what to confirm)?', multiline:true})) || '')
    : '';
  const update = {
    clientName:    payload.clientName || ctx.clientName || '',
    clientCompany: payload.clientCompany || '',
    clientAddress: payload.clientAddress || '',
    clientPhone:   payload.clientPhone || '',
    clientEmail:   payload.clientEmail || '',
    items:         payload.items || [],
    total:         payload.total || payload.grandTotal || 0,
    grandTotal:    payload.grandTotal || payload.total || 0,
    editableState: payload.editableState || null,
    editedByPresident: true,
    editedAt: firebase.firestore.FieldValue.serverTimestamp(),
    editedBy: currentUser.uid,
  };
  if (action === 'approve') {
    Object.assign(update, window.quoteStateFields('approved'));
    update.approvedAt = firebase.firestore.FieldValue.serverTimestamp(); update.approvedBy = currentUser.uid;
  } else {
    Object.assign(update, window.quoteStateFields('needs_revision'));
    update.presidentNotes = notes;
    update.returnedAt = firebase.firestore.FieldValue.serverTimestamp(); update.returnedBy = currentUser.uid;
  }
  try {
    await db.collection(ctx.quoteColl || 'bs_quotes').doc(ctx.quoteId).update(update);
    await db.collection('approval_requests').where('quoteId','==',ctx.quoteId).get()
      .then(s => Promise.all(s.docs.map(d => d.ref.update({ status: action === 'approve' ? 'approved' : 'returned' }))))
      .catch(()=>{});
    dbCacheInvalidate && dbCacheInvalidate('all-quotes');
    dbCacheInvalidate && dbCacheInvalidate('approvals-pending');
    if (ctx.partnerUid) {
      await Notifs.send(ctx.partnerUid, action === 'approve'
        ? { title:'✅ Quote Approved!', body:`The president edited and approved "${ctx.quoteNumber}" for ${update.clientName}. It is now filed.`, icon:'✅', type:'quote_approved' }
        : { title:'↩ Quote Revised & Returned', body:`The president edited "${ctx.quoteNumber}" for ${update.clientName} and returned it.${notes?' Notes: '+notes:''} Open it to review the changes.`, icon:'✎', type:'quote_returned' }).catch(()=>{});
    }
    window.logAudit && window.logAudit('update','quote',ctx.quoteId,{ presidentEdited:true, action });
    Notifs.success(action === 'approve' ? 'Approved with edits + partner notified' : 'Edited & returned to partner');
    navigateTo('approvals');
  } catch (ex) { Notifs.showToast('Save failed: '+(ex.message||ex.code), 'error'); }
}

// Reopen a filed quote into the builder from anywhere (Quotations list, Client
// data view, etc.). Loads the quote's editable snapshot and navigates to the
// matching builder. Re-filing then saves a NEW versioned copy (per the SOP).
window.reopenQuoteFromDoc = async function(collection, id, navTarget, opts){
  try {
    const snap = await db.collection(collection).doc(id).get();
    const q = snap.data() || {};
    if (!q.editableState) { Notifs.showToast('No editable snapshot saved for this quote', 'error'); return; }
    // Wave 3 Q4/Q5 — stamp the source doc + its place in the revision chain onto
    // the editableState we hand the builder, so the File flow can offer
    // "update original" (QUOTE_UPDATE) vs "file as new revision" (QUOTE_FILED),
    // and so a new revision correctly inherits the chain's root id.
    // Bridge-side safeguard: always hand the builder a real base quote number.
    // editableState.quoteNo is normally present (buildQuotePayload always sets
    // it), but older/partial snapshots could lack it — if we passed that
    // through blank, loadEditableState()'s `if(state.quoteNo){...}` guard
    // would skip setting #quoteNo, leaving the builder in auto-number mode,
    // which regenerates a FRESH (today-dated) number instead of preserving the
    // original. Fall back to the doc's own top-level quoteNumber field so the
    // base number is always frozen/correct, never builder-regenerated.
    const qNo = q.editableState.quoteNo || q.quoteNumber || '';
    window._qbReopenState = { ...q.editableState, quoteNo: qNo, sourceDocId: id, sourceCollection: collection, rootQuoteId: q.rootQuoteId || id };
    window._qbReopenAsRevision = !!(opts && opts.asRevision);
    navigateTo(navTarget || (collection==='bk_quotes' ? 'bk-quote-builder' : 'bs-quote-builder'));
  } catch (ex) { Notifs.showToast('Could not reopen: '+(ex.message||ex.code), 'error'); }
};
// "New Revision" action. Opens the builder pre-filled with the client's LATEST
// quote (latest items / pricing / terms — not necessarily the card that was
// clicked), bumps the -Rn suffix from the highest revision on record, and resets
// it to a fresh draft dated today so the user just tweaks and re-files.
window.newRevisionFromDoc = async function(collection, id, navTarget){
  try {
    const snap = await db.collection(collection).doc(id).get();
    const clicked = { id, ...(snap.data() || {}) };
    // Re-audit 2026-08-03 (HIGH) — this used to pool candidates by client NAME
    // string match alone. Two different clients sharing a name (common in the
    // Philippines, e.g. "Juan Dela Cruz") got pooled together, so New Revision
    // for one client could silently inherit an unrelated client's pricing;
    // renaming a client between revisions also dropped earlier revisions out
    // of the pool. Pool by rootQuoteId first — the exact key buildQuoteChains/
    // latestQuoteRevisions (sales.js) already use for the same chain — falling
    // back to clientId, and using client NAME only as a last-resort fallback
    // for legacy docs that predate BOTH ids. Scoped .where() queries (not a
    // full collection read) also fix the read-cost issue flagged alongside
    // this: cost now scales with the one client's chain, not total quote volume.
    const rootId   = clicked.rootQuoteId || clicked.id;
    const clientId = clicked.clientId || '';
    const clientKey = (clicked.clientName || '').trim().toLowerCase();

    // Gather every quote in the SAME revision chain so the revision continues
    // from the most recent one. Reading with scoped queries can fail for
    // scoped roles (e.g. partners) — fall back to just the clicked quote in
    // that case.
    let pool = [clicked];
    try {
      let mine = [];
      const byRoot = await db.collection(collection).where('rootQuoteId', '==', rootId).get();
      mine = byRoot.docs.map(d => ({ id: d.id, ...d.data() })).filter(q => q.editableState);
      // The clicked doc itself may BE the chain's root (no rootQuoteId field
      // stamped on it, or it predates Wave 3's chain-linking) — always keep it
      // as a candidate even if the query above didn't return it.
      if (clicked.editableState && !mine.some(q => q.id === clicked.id)) mine.push(clicked);
      // clientId fallback: only used if the rootQuoteId query found nothing
      // beyond the clicked doc itself (e.g. a legacy chain never stamped).
      if (mine.length < 2 && clientId) {
        const byClient = await db.collection(collection).where('clientId', '==', clientId).get();
        const viaClient = byClient.docs.map(d => ({ id: d.id, ...d.data() })).filter(q => q.editableState);
        if (viaClient.length > mine.length) mine = viaClient;
      }
      // Legacy name-based fallback — ONLY for docs lacking both rootQuoteId
      // and clientId (pre-Wave-3 quotes), and only matched against other docs
      // that ALSO lack both ids, so a modern, properly-linked quote can never
      // be pulled in by a same-name coincidence.
      if (mine.length < 2 && clientKey && !clientId && !clicked.rootQuoteId) {
        const all = await db.collection(collection).get();
        const viaName = all.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(q => !q.clientId && !q.rootQuoteId && (q.clientName || '').trim().toLowerCase() === clientKey && q.editableState);
        if (viaName.length > mine.length) mine = viaName;
      }
      if (mine.length) pool = mine;
    } catch(_) {}

    const revOf = q => {
      const m = String(q.quoteNumber || q.editableState?.quoteNo || '').match(/-R(\d+)\s*$/i);
      return m ? parseInt(m[1], 10) : 1;
    };
    // Latest = highest revision number, tie-broken by most recent filing time.
    pool.sort((a, b) => (revOf(b) - revOf(a)) || ((b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    const latest = pool.find(q => q.editableState) || clicked;

    if (!latest.editableState) { Notifs.showToast('No editable snapshot saved for this quote', 'error'); return; }
    // Wave 3 Q5 — same chain-linking as reopenQuoteFromDoc above.
    // Same bridge-side safeguard as reopenQuoteFromDoc: guarantee a real base
    // quote number is passed through so loadEditableState's asRevision branch
    // has something to bump (-Rn only) instead of the builder falling back to
    // auto-generating a fresh, today-dated number. The builder itself (see
    // quote-builder-v2.html loadEditableState) now bumps only the -Rn suffix
    // and no longer re-syncs the date into the number — this just ensures the
    // base number it bumps is never blank/stale.
    const qNo = latest.editableState.quoteNo || latest.quoteNumber || '';
    window._qbReopenState = { ...latest.editableState, quoteNo: qNo, sourceDocId: latest.id, sourceCollection: collection, rootQuoteId: latest.rootQuoteId || latest.id };
    window._qbReopenAsRevision = true;
    navigateTo(navTarget || (collection === 'bk_quotes' ? 'bk-quote-builder' : 'bs-quote-builder'));
  } catch (ex) { Notifs.showToast('Could not start revision: ' + (ex.message || ex.code), 'error'); }
};

// ── Product Database (president only) ────────────
// Single source of truth for the quote builders. Seeded once from
// products-database.json, then lives entirely in Firestore so president
// edits (title, measurement, specs, price, capital) sync live everywhere.
// One-time, additive: imports the full 153-item catalog (with measurement/
// formula data) the first time the page loads. Gated on productMeta/config
// rather than the products collection being empty, since older builds had
// already seeded a handful of placeholder products (Steel Fabrication, etc.)
// under a legacy schema — those are left untouched and just display via the
// legacy-field fallback in normalizeProduct() below, migrating to the new
// schema automatically the next time someone edits and saves them.
// Build a Firestore product doc from a products-database.json entry. Carries the
// rich fields (specs config, SS304 material, labor hours, lead time, formula) so
// the quote builder can price + describe accurately. Material spec is folded into
// the specifications string so it surfaces in the editor and on quotes.
function catalogDocFromJson(p) {
  const m = p.material || null;
  const matLine = m ? ('Material: ' + [m.grade, m.topGauge && ('top ' + m.topGauge), m.bodyGauge && ('body ' + m.bodyGauge), m.finish].filter(Boolean).join(', ')) : '';
  const specifications = [p.notes || '', matLine].filter(Boolean).join(' · ');
  return {
    title: p.name,
    category: p.category,
    unit: p.unit || 'unit',
    basePrice: p.basePrice || 0,
    measurement: p.defaultDimensions || {},
    specifications,
    material: m || null,
    specs: Array.isArray(p.specs) ? p.specs : [],
    laborHours: p.laborHours || null,
    leadTime: p.leadTime || '',
    // v14 re-audit HIGH fix — cost fields no longer go on the products doc at
    // all (firestore.rules' `allow create` on /products rejects a doc that
    // carries capitalMaterials/capitalLabor/bom). A freshly-seeded/imported
    // product simply has no product_costs doc yet either, so
    // normalizeProduct()'s `?? 0` fallback already shows ₱0 for it — exactly
    // the same value these two lines used to hard-code here.
    formulaType: p.formulaType || 'fixed',
    formula: p.formula || {},
  };
}

// Fetch + parse products-database.json (strips JS-style comments first).
async function fetchCatalogFile() {
  const r = await fetch('products-database.json?v=' + Date.now());
  const text = await r.text();
  const clean = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(clean);
}

// v14 re-audit HIGH fix — capitalMaterials/capitalLabor/bom (Barro's cost
// basis) no longer live on the products doc (see firestore.rules + the
// migrateProductCostsOut migration in js/migrations.js); they live in
// product_costs/{docId}, readable only by finance/admin (never partner).
// This cache is refreshed by seedCatalogIfNeeded() below every time the
// (isPresident()-gated) Product Database screen loads, and normalizeProduct()
// merges it in. A non-finance/admin session simply gets a permission-denied
// here, caught below, leaving the cache empty — normalizeProduct() then falls
// back to any legacy cost field still on the products doc itself (harmless;
// during rollout, before migrateProductCostsOut() has run, or for a doc that
// was never migrated), or 0.
window._productCostsCache = window._productCostsCache || {};
async function loadProductCostsCache() {
  try {
    const snap = await db.collection('product_costs').limit(2000).get();
    const map = {};
    snap.docs.forEach(d => { map[d.id] = d.data(); });
    window._productCostsCache = map;
  } catch (e) {
    // Permission-denied (not finance/admin) or offline — leave whatever was
    // cached before untouched rather than blanking it out from under a
    // concurrently-open Product Database render.
    console.warn('[product_costs] cache load skipped', e.code || e.message || e);
  }
}

async function seedCatalogIfNeeded() {
  await loadProductCostsCache();
  const metaSnap = await db.collection('productMeta').doc('config').get();
  if (metaSnap.exists) return;
  try {
    const seedDb = await fetchCatalogFile();
    const existing = await db.collection('products').limit(1000).get();
    const existingIds = new Set(existing.docs.map(d => d.id));
    const batch = db.batch();
    seedDb.products.forEach(p => {
      if (existingIds.has(p.id)) return; // never overwrite an existing doc
      batch.set(db.collection('products').doc(p.id), {
        ...catalogDocFromJson(p),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    batch.set(db.collection('productMeta').doc('config'), {
      categories: seedDb.categories || [],
      laborRoles: seedDb.laborRoles || [],
      constants: seedDb.constants || {},
    });
    await batch.commit();
  } catch (e) {
    console.warn('[products] seed from products-database.json failed', e);
  }
}

// Additive import — adds any catalog products NOT already in Firestore (by id)
// and merges any new categories into productMeta. Never overwrites existing
// product docs, so President edits are preserved. Returns # of products added.
async function importNewCatalogItems() {
  const fileDb = await fetchCatalogFile();
  const [existing, metaSnap] = await Promise.all([
    db.collection('products').limit(2000).get(),
    db.collection('productMeta').doc('config').get(),
  ]);
  const existingIds = new Set(existing.docs.map(d => d.id));
  const toAdd = (fileDb.products || []).filter(p => !existingIds.has(p.id));

  // Merge categories (existing first, append any new ids from the file)
  const meta = metaSnap.exists ? metaSnap.data() : {};
  const cats = [...(meta.categories || [])];
  const haveCat = new Set(cats.map(c => c.id));
  (fileDb.categories || []).forEach(c => { if (!haveCat.has(c.id)) { cats.push(c); haveCat.add(c.id); } });

  // Firestore batches cap at 500 writes — chunk to be safe.
  for (let i = 0; i < toAdd.length; i += 400) {
    const batch = db.batch();
    toAdd.slice(i, i + 400).forEach(p => {
      batch.set(db.collection('products').doc(p.id), {
        ...catalogDocFromJson(p),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }
  await db.collection('productMeta').doc('config').set(
    { categories: cats, laborRoles: fileDb.laborRoles || meta.laborRoles || [], constants: { ...(meta.constants || {}), ...(fileDb.constants || {}) } },
    { merge: true }
  );
  return toAdd.length;
}

function pdbCategoryLabel(catId, categories) {
  return categories.find(c => c.id === catId)?.label || catId || 'Uncategorized';
}

// Legacy docs (pre-rich-schema) only have {name, baseRate, code, category}.
// Fall back to those so old placeholder products still display correctly
// until they're next edited and saved under the new schema.
function normalizeProduct(p) {
  // v14 re-audit HIGH fix — product_costs FIRST, legacy field on the products
  // doc itself as the rollout fallback (see loadProductCostsCache above).
  // `??` (not `||`) so a real, deliberate ₱0 cost in product_costs is kept
  // instead of falling through to a stale legacy value.
  const costs = window._productCostsCache && window._productCostsCache[p.id];
  return {
    ...p,
    title: p.title || p.name || '',
    basePrice: p.basePrice ?? p.baseRate ?? 0,
    measurement: p.measurement || {},
    specifications: p.specifications || p.notes || '',
    capitalMaterials: (costs && costs.capitalMaterials) ?? p.capitalMaterials ?? 0,
    capitalLabor: (costs && costs.capitalLabor) ?? p.capitalLabor ?? 0,
    bom: (costs && costs.bom) || p.bom || [],
    formulaType: p.formulaType || 'fixed',
    formula: p.formula || {},
  };
}

// ── Audit Log viewer (president only) ─────────────
// ── One-time security backfill (v12 WS19, president, idempotent) ──────────
// Seeds the usernames/{u} -> {email, uid} login map from every existing users
// doc that has a username, so worker username-login works immediately after
// deploy (new accounts are kept in sync going forward by openCreateWorkerModal
// — see js/app.js's Create Worker Account handler). Re-runnable: overwrites
// with the current source-of-truth values each time, so it's always safe.
window.runSecurityBackfill = async function() {
  if (!isPresident()) return;
  if (!await confirmDialog({ message: 'Backfill the username login map from existing user accounts?\n\nSafe to run repeatedly.' })) return;
  Notifs.info('Backfilling usernames…');
  try {
    const snap = await db.collection('users').get();
    let batch = db.batch(), inBatch = 0, seeded = 0;
    for (const d of snap.docs) {
      const u = d.data();
      const uname = (u.username || '').toLowerCase().trim();
      if (!uname) continue;
      const email = u.authEmail || u.email;
      if (!email) continue;
      batch.set(db.collection('usernames').doc(uname), { email, uid: d.id });
      inBatch++; seeded++;
      if (inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch) await batch.commit();
    window.logAudit && window.logAudit('security-backfill', 'usernames', null, { seeded });
    Notifs.success(`Seeded ${seeded} username${seeded===1?'':'s'} ✓`);
  } catch (e) { Notifs.showToast('Backfill failed: ' + (e.message||e), 'error'); }
};

// renderAuditLog + renderProductDatabase (president tools) — moved verbatim
// to js/screens/dashboards.js (Wave 7 Pass 9, 2026-08-03). The 'audit-log' /
// 'product-database' cases in navigateTo below still call them as bare
// global identifiers, same runtime-only resolution as every other pass.

// ── Navigate ──────────────────────────────────────
// Top-bar back button — shows only when there's somewhere to go back to.
// ── v12 WS10 — hash router (History API) ─────────────────────────────────
// Hash-based, not pushState paths: GitHub Pages has no server rewrite / no
// 404.html, and hash never leaves the client — survives refresh/deep-link
// with zero server plumbing.
function hashFor(page, subtab) {
  const segs = String(page).startsWith('dept:')
    ? ['dept', page.slice(5)].concat(subtab ? [subtab] : [])
    : [page].concat(subtab ? [subtab] : []);
  return '#/' + segs.map(encodeURIComponent).join('/');
}
window.hashFor = hashFor;
function parseHash(h) {
  h = (h == null ? location.hash : h).replace(/^#\/?/, '');
  if (!h) return { page: 'dashboard', subtab: null };
  const s = h.split('/').map(decodeURIComponent);
  if (s[0] === 'dept' && s[1]) return { page: 'dept:' + s[1], subtab: s[2] || null };
  return { page: s[0] || 'dashboard', subtab: s[1] || null };
}

function updateNavBackBtn() {
  const b = document.getElementById('nav-back-btn');
  // Real history now backs this: show the button whenever we've navigated at
  // least once within the app (depth>0) and we're not sitting on the dashboard root.
  if (b) b.style.display = ((window._navDepth||0) > 0 && window.currentPage !== 'dashboard') ? '' : 'none';
}
window.navBack = function() { history.back(); };   // the top-bar chevron === device Back

function navigateTo(page, opts) {
  opts = opts || {};
  const subtab = (opts.subtab !== undefined) ? opts.subtab : null;

  // If overlays are open and this is a real (non-history) navigation, tear them
  // down first so a nav click from inside a modal/page doesn't leave a dangling panel.
  if (!opts.fromHistory && window.Overlay && window.Overlay.isOpen()) window.Overlay.clearAll();

  // Sync the URL + history entry (skip when we're rendering FROM history).
  if (!opts.fromHistory) {
    // v14 hotfix (iOS): when clearAll() just tore down overlays it leaves
    // their history entries in place (no async go(-n) — see config.js).
    // Absorb the topmost stale overlay entry by REPLACING it with the new
    // page — synchronous, no popstate, no race.
    const absorbStale = !!(window.Overlay && window.Overlay._pendingRewind);
    if (absorbStale) window.Overlay._pendingRewind = 0;
    const useReplace = opts.replace || absorbStale;
    const st = { t:'page', page, subtab, d: (useReplace ? (window._navDepth||0) : (window._navDepth = (window._navDepth||0) + (page===window.currentPage?0:1))) };
    const url = hashFor(page, subtab);
    try { useReplace ? history.replaceState(st,'',url) : history.pushState(st,'',url); } catch(_){}
  }

  currentPage = page;
  window.currentPage = page;
  window.currentSubtab = subtab;          // screens read this via initialSubtab()
  setActiveNav(page);
  updateNavBackBtn();
  // Close task fullscreen panel if open
  if (typeof window.closeTaskPanel === 'function') window.closeTaskPanel();
  // Team Chat (WS37): the inbox listener is page-scoped, not Overlay-scoped —
  // detach it whenever any page other than chat renders. (The THREAD listeners
  // are Overlay-scoped and already torn down by Overlay.clearAll() above.)
  if (page !== 'chat' && window.Chat?.teardownInbox) window.Chat.teardownInbox();
  // Quote Builder fullscreen (mobile): Overlay.clearAll() above already tears
  // this down whenever it was pushed, but guard explicitly too (same pattern
  // as the Chat teardown line above) in case a future path ever reaches here
  // without going through the Overlay stack.
  if (page !== 'bs-quote-builder' && page !== 'bk-quote-builder') exitQbFullscreen();
  const c = document.getElementById('page-content');
  // Destroy any Chart.js instances before wiping the DOM to prevent memory leaks
  if (window.Chart) {
    c.querySelectorAll('canvas').forEach(canvas => {
      const existing = Chart.getChart(canvas);
      if (existing) existing.destroy();
    });
  }
  c.innerHTML = window.skeletonHtml('rows');

  // dept: prefix for dual dept tabs
  if (page.startsWith('dept:')) {
    const dept = page.slice(5);
    renderDeptModule(dept);
    _devCheckIconIntegrity(page);
    if (typeof window.devCheckStacking === 'function') window.devCheckStacking();
    return;
  }

  switch(page) {
    // Type-B (Production, weekly self-service worker) — their whole
    // "dashboard" is the Time In/Out + calendar + finance screen in
    // js/screens/worker.js, not renderDashboard()'s role-branch dispatcher
    // (js/screens/dashboards.js, owned by another pass — this is the one
    // safe interception point, same pattern renderDeptModule/the dept:
    // prefix above already uses to redirect before the switch's normal case).
    case 'dashboard':        (isTypeBWorker() && window.renderWorkerHome) ? window.renderWorkerHome() : renderDashboard(); break;
    case 'company':          renderCompany(); break;
    case 'tasks':            renderTasks(currentUser, currentRole, currentDepts[0]||''); break;
    case 'submissions':      renderSubmissions(currentUser, currentRole, currentDepts[0]||''); break;
    case 'files':            renderFiles(currentUser, currentRole); break;
    case 'files-hub':        window.renderFilesHub?.(); break;
    // case 'cash' (legacy renderCash screen) — DELETED, Wave 7 Pass 10 cleanup
    // (2026-08-03). Verified zero callers into this case: no nav item, bottom-nav
    // entry, deep link, or notification payload ever set page:'cash' (grepped
    // clean, including seeds). Falls through to the switch's default branch like
    // any other unmatched page string — unaffected by this removal.
    case 'personal-finance': renderPersonalFinance(currentUser, currentRole); break;
    case 'my-dept':          renderMyDepartment(); break;
    case 'departments':      renderDepartments(); break;
    case 'analytics':        renderAnalytics(); break;
    case 'approvals':        renderApprovals(currentUser); break;
    case 'team':             renderTeam(); break;
    case 'progress':         renderProgressReports(); break;
    case 'bs-quote-builder': renderQuoteBuilderIframe(); break;
    case 'bk-quote-builder': renderQuoteBuilderIframe(); break;
    case 'partner-projects': renderPartnerProjects(); break;
    case 'notifications':    renderNotificationsPage(); break;
    case 'bs-quotations':    renderBrilliantSteel(currentUser, currentRole, 'Quotations Summary'); break;
    case 'bs-clients':       renderBrilliantSteel(currentUser, currentRole, 'Client Data'); break;
    case 'bs-files':         renderBrilliantSteel(currentUser, currentRole, 'Files'); break;
    case 'bk-quotations':    window.renderSales?.(currentUser, currentRole, 'Quotes'); break;
    case 'help':             renderHelp(); break;
    case 'sops':             renderSOPs(); break;
    // ── New modules ──
    case 'posts':            window.renderPosts?.(); break;
    case 'memos':            window.renderMemosPage?.(); break;
    case 'team-directory':   window.renderTeamTab?.(); break;
    case 'chat':             window.renderChatPage?.(); break;
    case 'my-profile':       window.renderMyProfile?.(); break;
    case 'attendance':       window.renderAttendancePage?.(); break;
    case 'cash-advances':    window.renderCashAdvancePage?.(); break;
    case 'leave':            window.renderLeavePage?.(); break;
    case 'holidays':         window.renderHolidaysAdmin?.(); break;
    case 'inventory':        window.renderInventory?.(); break;
    case 'product-database': isPresident() ? renderProductDatabase() : (c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔒',44)}</div><h4>Access Denied</h4></div>`, window.lucide && lucide.createIcons({ nodes: [c] })); break;
    case 'audit-log':        isPresident() ? renderAuditLog() : (c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔒',44)}</div><h4>Access Denied</h4></div>`, window.lucide && lucide.createIcons({ nodes: [c] })); break;
    case 'system-health':    (isPresident() || currentRole==='finance') ? renderSystemHealth() : (c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔒',44)}</div><h4>Access Denied</h4></div>`, window.lucide && lucide.createIcons({ nodes: [c] })); break;
    case 'search':           window.renderGlobalSearch?.(); break;
    case 'sales-orders':     window.renderSalesOrders?.(); break;
    case 'projects-lifecycle': window.renderProjectLifecycle?.(); break;
    default: c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔍',44)}</div><h4>Page not found</h4></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
  }
  _devCheckIconIntegrity(page);
  if (typeof window.devCheckStacking === 'function') window.devCheckStacking();
}

// ── Phase 129: icon integrity dev-check ──────────
// Most render* functions above are async/fire-and-forget, so this can't run
// synchronously right after the switch — give the render a beat to finish,
// then scan for <i data-lucide> tags Lucide never hydrated into an <svg>
// (unmapped icon name, or a template that forgot the createIcons() call).
// Dev-only (localStorage 'bi-dev'==='1') so production users never pay for it.
function _devCheckIconIntegrity(page) {
  if (localStorage.getItem('bi-dev') !== '1') return;
  setTimeout(() => {
    const c = document.getElementById('page-content');
    if (!c) return;
    const tags = c.querySelectorAll('i[data-lucide]');
    let empty = 0;
    tags.forEach(el => { if (el.childElementCount === 0) empty++; });
    if (empty > 0) console.warn(`[icon-integrity] ${page}: ${empty} unhydrated <i data-lucide> tag(s) of ${tags.length}`);
  }, 400);
}

function setActiveNav(page) {
  document.querySelectorAll('.nav-item, .bottom-nav-item, .top-nav-item').forEach(el => {
    const isActive = el.dataset.page === page;
    el.classList.toggle('active', isActive);
    // a11y: mark the active nav target for assistive tech.
    if (isActive) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  // The 'More' tab (v14 mobile-shell batch) collapses several pages into a
  // sheet, so its own data-page is a non-navigable "__more__" sentinel that
  // never matches the loop above. Show it active when the current page lives
  // inside its collapsed set instead (data-more-pages, set by buildBottomNav).
  const moreBtn = document.getElementById('bottom-nav-more');
  if (moreBtn) {
    const isMoreActive = (moreBtn.dataset.morePages || '').split(',').includes(page);
    moreBtn.classList.toggle('active', isMoreActive);
    if (isMoreActive) moreBtn.setAttribute('aria-current', 'page');
    else moreBtn.removeAttribute('aria-current');
  }
}

// getAllQuotes + renderDashboard (role dispatcher) + liveDateTime +
// renderPresidentDashboard/renderManagerDashboard/renderSecretaryDashboard/
// renderFinanceDashboard/renderEmployeeDashboard — moved verbatim to
// js/screens/dashboards.js (Wave 7 Pass 9, 2026-08-03). renderPartnerDashboard
// (Pass 6, partners.js) and the isBrilliantOnly() branch (renderBrilliantSteel,
// partners.js) were already out of this file before this pass — confirmed.
// The 'dashboard' case in navigateTo below still calls renderDashboard() as a
// bare global; departments.js/people.js reach forward into getAllQuotes the
// same way (typeof-guarded, already defensive before this move).

// Called by notifications.js when all notifications checked — upgrades attendance to 100%
// Must time in AND read all notifications before 9:00 AM
window.tryUpgradeAttendanceOnNotifRead = async function() {
  if (!currentUser) return;
  const todayStr = bizDate();
  const now = new Date();
  // Honor an approved extension: its expiresAt replaces the flat 9:00 AM cutoff.
  const extSnap = await db.collection('attendance_extensions')
    .doc(`${currentUser.uid}_${todayStr}`).get().catch(()=>({exists:false,data:()=>({})}));
  const ext = window.attExtActive(extSnap.exists ? extSnap.data() : null, now);
  const pastDeadline = ext.active ? (now >= ext.expiresAt) : (bizHour() >= 9);
  if (pastDeadline) {
    const dl = ext.active
      ? ext.expiresAt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',timeZone:window.BIZ_TZ})
      : '9:00 AM';
    Notifs.showToast(`⏰ Deadline passed — notifications must be checked before ${dl} for full attendance.`, 'error');
    return;
  }
  const todaySnap = await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).get();
  if (!todaySnap.exists || !todaySnap.data().loginTime) return; // must have timed in first
  const current = todaySnap.data();
  if ((current.attendanceScore||0) >= 1.0) return;              // already full
  if (current.editedBy) return;                                // admin-set day — never self-override (also WS19-denied)
  try {
    await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
      attendanceScore: 1.0, fullTime: true,
      fullTimeAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    Notifs.success('✅ Full attendance (100%) — all notifications checked!');
  } catch(e) { /* WS19 rule denied (admin-edited day) — silently ignore */ }
};

window.approveAttendanceExtension = async function(extId, uid, name) {
  const approvedAt = new Date();
  const expiresAt  = new Date(approvedAt.getTime() + window.ATT_EXT_HOURS * 60 * 60 * 1000);
  await db.collection('attendance_extensions').doc(extId).update({
    status: 'approved',
    approvedBy: currentUser.uid,
    approvedByName: userProfile?.displayName || currentUser.email,
    approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
    expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt)
  });
  const dl = expiresAt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',timeZone:window.BIZ_TZ});
  await Notifs.send(uid, {
    title: '✅ Attendance Extension Approved',
    body:  `Your Time In extension is approved. You have until ${dl} to time in and check all notifications.`,
    icon: '✅', type: 'att_extension_approved'
  });
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('att-ext-pending');
  return expiresAt;
};
window.denyAttendanceExtension = async function(extId, uid, name) {
  await db.collection('attendance_extensions').doc(extId).update({
    status: 'denied', deniedBy: currentUser.uid,
    deniedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await Notifs.send(uid, {
    title: '❌ Attendance Extension Denied',
    body:  'Your attendance extension request was not approved.',
    icon: '❌', type: 'att_extension_denied'
  });
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('att-ext-pending');
};

// ── ID verify token minting + public-safe projection ──────────────
// Builds the ONLY fields that may live in the public id_verify/{token} doc.
function buildIdVerifyDoc(kind, src, uidOrNull) {
  const B = window.BRAND || {};
  const dept = Array.isArray(src.departments) && src.departments.length
    ? src.departments.join(', ') : (src.department || '');
  return {
    kind,                                            // 'employee' | 'worker'
    name:           src.displayName || src.name || '',
    photoUrl:       src.photoUrl || '',
    idNumber:       src.employeeId || src.idNumber || '',
    department:     dept,
    jobTitle:       src.title || src.jobTitle || '',
    employmentType: src.employmentType || '',
    company:        B.name || 'Barro Industries',
    status:         (src.status === 'inactive') ? 'inactive' : 'active',
    issuedOn:       src.issuedOn || src.startDate || (window.bizDate ? bizDate() : ''),
    uid:            uidOrNull || null,               // employee kind only (rules check)
    updatedAt:      firebase.firestore.FieldValue.serverTimestamp()
  };
}

// Ensure the LOGGED-IN employee's own verify token exists; idempotent (reuses
// an existing token so reprinted QR codes stay stable). Returns the token.
async function ensureEmployeeVerifyToken(u) {
  if (u.verifyToken) {
    // refresh the public projection in case name/photo/dept changed
    db.collection('id_verify').doc(u.verifyToken)
      .set(buildIdVerifyDoc('employee', u, currentUser.uid), { merge: true }).catch(()=>{});
    return u.verifyToken;
  }
  const token = window.makeTrackCode(10);
  await db.collection('id_verify').doc(token)
    .set(buildIdVerifyDoc('employee', u, currentUser.uid));
  await db.collection('users').doc(currentUser.uid)
    .set({ verifyToken: token }, { merge: true });      // not a frozen field → self-write OK
  u.verifyToken = token;
  if (window.userProfile && userProfile.id === currentUser.uid) userProfile.verifyToken = token;
  return token;
}

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
        <img src="${(window.BRAND && window.BRAND.logo && window.BRAND.logo.print) || 'icons/barro-kitchens.png'}" alt="Barro Industries" class="id-card-logo" onerror="this.style.display='none'"/>
        <div>
          <div class="id-card-company">BARRO INDUSTRIES</div>
          <div class="id-card-company-sub">DIGITAL COMPANY ID</div>
        </div>
      </div>
      <div class="id-card-body">
        <div class="id-card-photo" style="cursor:default">
          ${u.photoUrl?`<img src="${escHtml(u.photoUrl)}" alt="Photo"/>`:`<span style="font-size:32px">${emojiIcon('👤',32)}</span>`}
        </div>
        <div class="id-card-info">
          <div class="id-card-name">${escHtml(u.displayName||u.email)}</div>
          <div class="id-card-title">${escHtml(roleLabel)}</div>
          <div class="id-card-detail"><span>${emojiIcon('🗂',16)}</span><strong>${escHtml(deptLabel)}</strong></div>
          <div class="id-card-detail"><span>${emojiIcon('✉️',16)}</span>${escHtml(u.email)}</div>
          ${u.phone?`<div class="id-card-detail"><span>${emojiIcon('📞',16)}</span>${escHtml(u.phone)}</div>`:''}
          ${empType?`<div class="id-card-detail"><span>${emojiIcon('💼',16)}</span>${escHtml(empType)}${workMode?' · '+escHtml(workMode):''}</div>`:''}
          ${issuedOn?`<div class="id-card-detail"><span>${emojiIcon('📅',16)}</span>Issued: ${escHtml(issuedOn)}</div>`:''}
        </div>
      </div>
      <div class="id-card-footer">
        <div class="id-card-id">${escHtml(u.employeeId||'BI-0000')}</div>
        <div class="id-card-status">${(u.status==='inactive')?'INACTIVE':'ACTIVE'}</div>
      </div>
      <div class="id-card-qr" id="id-qr-${containerId}" title="Scan to verify"></div>
    </div>`;

  // Back / calling face — class-driven so the theme controls light vs dark.
  const callingHTML = `
    <div class="id-card id-card--calling">
      <div class="idc-photo">${u.photoUrl?`<img src="${escHtml(u.photoUrl)}" alt=""/>`:`<span>${emojiIcon('👤',16)}</span>`}</div>
      <div class="idc-name">${escHtml(u.displayName||u.email)}</div>
      <div class="idc-role">${escHtml(roleLabel)}</div>
      <div class="idc-dept">${escHtml(deptLabel)}</div>
      <div class="idc-divider"></div>
      <div class="idc-contact">${emojiIcon('✉️',16)} ${escHtml(u.email)}</div>
      ${u.phone?`<div class="idc-contact">${emojiIcon('📞',16)} ${escHtml(u.phone)}</div>`:''}
      <div class="idc-brand">BARRO INDUSTRIES</div>
    </div>`;

  // Build the full flip scene once (no re-render on flip)
  el.innerHTML = `
    <div class="id-flip-scene" id="id-flip-scene-${containerId}">
      <div class="id-flip-inner" id="id-flip-inner-${containerId}">
        <div class="id-flip-front">${idHTML}</div>
        <div class="id-flip-back">${callingHTML}</div>
      </div>
      <div class="id-flip-dots">
        <div class="id-flip-dot active" id="id-dot0-${containerId}"></div>
        <div class="id-flip-dot"        id="id-dot1-${containerId}"></div>
      </div>
      <div class="id-flip-hint">
        <span>⟵</span>swipe to flip<span>⟶</span>
      </div>
    </div>`;

  const scene = document.getElementById(`id-flip-scene-${containerId}`);
  const inner = document.getElementById(`id-flip-inner-${containerId}`);
  const dot0  = document.getElementById(`id-dot0-${containerId}`);
  const dot1  = document.getElementById(`id-dot1-${containerId}`);

  function setFlipped(flipped) {
    showingID = !flipped;
    inner.classList.toggle('is-flipped', flipped);
    dot0.classList.toggle('active', !flipped);
    dot1.classList.toggle('active', flipped);
  }

  // Touch swipe
  let startX = 0, startTime = 0;
  scene.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startTime = Date.now();
  }, { passive: true });
  scene.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dt = Date.now() - startTime;
    // Fast swipe (velocity) or long drag
    if (Math.abs(dx) > 35 || (Math.abs(dx) > 18 && dt < 200)) {
      setFlipped(dx < 0 ? true : false);
    }
  }, { passive: true });

  // Click to toggle (desktop)
  scene.addEventListener('click', () => setFlipped(showingID));

  // Print / Save-PDF button (rendered once, below the flip scene)
  const printBtn = document.createElement('button');
  printBtn.className = 'btn-secondary btn-sm';
  printBtn.style.marginTop = '12px';
  printBtn.innerHTML = `${emojiIcon('🖨',16)} Print / Save PDF`;
  if (window.lucide) lucide.createIcons({ nodes: [printBtn] });
  el.appendChild(printBtn);

  // Mint/refresh the verify token, then draw the on-card QR and wire printing.
  ensureEmployeeVerifyToken(u).then(token => {
    const url = (window.BRAND?.verifyBase || '/v/') + '?' + encodeURIComponent(token);
    const qrEl = document.getElementById(`id-qr-${containerId}`);
    if (qrEl) qrEl.innerHTML = window.buildQRSVG ? window.buildQRSVG(url, 64) : '';
    printBtn.addEventListener('click', () => window.printIDCards([buildIdVerifyDoc('employee', u, currentUser.uid)], token ? [token] : ['']));
  }).catch(() => {
    printBtn.addEventListener('click', () => window.printIDCards([buildIdVerifyDoc('employee', u, currentUser.uid)], ['']));
  });
}

// ── CR80 ID-card print (new-window document.write; front+back per card) ──
window.printIDCards = function(data, tokens) {
  const B = window.BRAND || {};
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const logoAbs = (location.origin||'') + '/' + ((B.logo && B.logo.print) || 'icons/barro-kitchens.png');
  const navy = B.navy || '#1E3A5F';

  const cardFront = (d, tok) => {
    const url = (B.verifyBase || (location.origin+'/v/')) + '?' + encodeURIComponent(tok||'');
    const qr = (window.buildQRSVG && tok) ? window.buildQRSVG(url, 84) : '';
    const photo = d.photoUrl
      ? `<img class="p" src="${esc(d.photoUrl)}" alt=""/>`
      : `<div class="p ph">${emojiIcon('👤',16)}</div>`;
    return `<div class="cr80 front">
      <div class="top"><img class="logo" src="${esc(logoAbs)}" onerror="this.style.display='none'"/>
        <div><div class="co">${esc(B.name||'BARRO INDUSTRIES')}</div><div class="cosub">COMPANY ID</div></div></div>
      <div class="mid">${photo}
        <div class="info"><div class="nm">${esc(d.name||'')}</div>
          <div class="rl">${esc(d.jobTitle||d.department||'')}</div>
          <div class="dt">${esc(d.department||'')}</div>
          <div class="dt">ID: <b>${esc(d.idNumber||'')}</b></div>
          ${d.employmentType?`<div class="dt">${esc(d.employmentType)}</div>`:''}
        </div>
        <div class="qr">${qr||`<div class="qrfb">${esc(url)}</div>`}</div>
      </div>
      <div class="bot"><span>${esc(d.status==='inactive'?'INACTIVE':'ACTIVE')}</span><span>Issued ${esc(d.issuedOn||'')}</span></div>
    </div>`;
  };
  const cardBack = (d) => `<div class="cr80 back">
      <div class="bkco">${esc(B.name||'BARRO INDUSTRIES')}</div>
      <div class="bktag">${esc(B.tagline||'')}</div>
      <div class="bkrule"></div>
      <div class="bknote">This card is property of ${esc((B.legal && B.legal.opcName) || B.name || 'the company')}. If found, please return to the company. Scan the QR on the front to verify the holder.</div>
      <div class="bkbrand">${esc((B.legal && B.legal.opcName) || '')}</div>
    </div>`;

  const body = data.map((d,i)=>cardFront(d, (tokens||[])[i]) + cardBack(d)).join('');
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to print ID cards.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>ID Cards — Barro Industries</title><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,Arial,sans-serif;background:#eee;padding:12px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
    .cr80{width:85.6mm;height:53.98mm;background:#fff;color:#111;border-radius:3mm;overflow:hidden;padding:4mm;position:relative;box-shadow:0 1px 4px rgba(0,0,0,.2)}
    .front{border-top:3mm solid ${navy}}
    .top{display:flex;align-items:center;gap:2mm;margin-bottom:2mm}
    .logo{height:8mm;width:8mm;object-fit:contain}
    .co{font-size:10pt;font-weight:800;color:${navy};letter-spacing:.3px}
    .cosub{font-size:6pt;letter-spacing:2px;color:#777}
    .mid{display:flex;gap:3mm;align-items:flex-start}
    .p{width:18mm;height:22mm;object-fit:cover;border:0.4mm solid #ccc;border-radius:1.5mm;flex:0 0 auto}
    .ph{display:flex;align-items:center;justify-content:center;font-size:20pt;background:#f2f2f2}
    .info{flex:1;min-width:0}
    .nm{font-size:11pt;font-weight:800;line-height:1.1}
    .rl{font-size:7.5pt;color:#555;margin:.5mm 0}
    .dt{font-size:7pt;color:#444;line-height:1.4}
    .qr{width:20mm;height:20mm;flex:0 0 auto}.qr svg{width:100%;height:100%}
    .qrfb{font-size:4pt;word-break:break-all;color:#333}
    .bot{position:absolute;left:4mm;right:4mm;bottom:2.5mm;display:flex;justify-content:space-between;font-size:6.5pt;color:#666;border-top:0.3mm solid #eee;padding-top:1mm}
    .back{border-top:3mm solid ${navy};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
    .bkco{font-size:11pt;font-weight:800;color:${navy}}
    .bktag{font-size:6.5pt;color:#666;margin-top:.5mm}
    .bkrule{width:60%;height:0.3mm;background:#ddd;margin:2mm 0}
    .bknote{font-size:6.5pt;color:#555;line-height:1.5;max-width:70mm}
    .bkbrand{font-size:6pt;color:#999;margin-top:2mm;letter-spacing:.5px}
    @page{size:auto;margin:6mm}
    @media print{body{background:#fff;padding:0;gap:4mm}.cr80{box-shadow:none;page-break-inside:avoid;break-inside:avoid}}
  </style></head><body>${body}
  <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
  </body></html>`);
  w.document.close();
};

// ── My Department (supports dual) ─────────────────
function renderMyDepartment() {
  if (!currentDepts.length) {
    document.getElementById('page-content').innerHTML = `
      <div class="access-denied"><div class="ad-icon">${emojiIcon('🗂️',16)}</div>
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
    <div class="page-header"><h2>${emojiIcon('🗂️',20)} My Departments</h2></div>
    <div class="dept-grid">
      ${currentDepts.map(dept => {
        const cfg = DEPARTMENTS[dept]||{icon:'🗂️',color:'var(--primary-light)',lucideIcon:'folder-open'};
        return `<div class="dept-card" style="border-top-color:${cfg.color};cursor:pointer" onclick="navigateTo('dept:${dept}')">
          <div class="dept-name" style="margin-bottom:6px">${window.deptIconTile(cfg, 36)}</div>
          <div class="dept-name">${dept}</div>
          <div class="dept-head" style="margin-top:6px">Tap to open →</div>
        </div>`;
      }).join('')}
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
}

function renderDeptModule(dept) {
  switch(dept) {
    case 'Marketing':                  renderMarketing(currentUser, currentRole); break;
    case 'Finance':                    renderFinance(currentUser, currentRole); break;
    case 'HR':                         window.renderHR?.(currentUser, currentRole); break;
    case 'Sales': renderSales(currentUser, currentRole); break;
    case 'CRM':                        window.renderCRM?.(currentUser, currentRole); break;
    case 'IT':                         window.renderIT?.(currentUser, currentRole); break;
    case 'Design':                     renderDesign(currentUser, currentRole); break;
    case 'Production':                 window.renderProductionDept?.(currentUser, currentRole); break;
    case 'Purchasing':                 window.renderPurchasing?.(currentUser, currentRole); break;
    case 'Brilliant Steel':            renderBrilliantSteel(currentUser, currentRole); break;
    case 'Government Biddings':        renderGovBiddings(); break;
    case 'Partners':                   renderPartnersDept(); break;
    default:                           renderGenericDept(dept); break;
  }
}

// Partners department (renderPartnersDept, loadPartnersDeptTab) — moved
// verbatim to js/screens/partners.js (Wave 7 Pass 6, 2026-08-03).
// renderDeptModule's 'Partners' case above still calls renderPartnersDept()
// as a bare global identifier — same cross-file, runtime-only resolution
// every other pass documents. See partners.js's header for the full
// contents list and the parity-audit findings across the 3 partner portal
// variants (bsOnly/partnerBS/genericPartner).

// Partner Deal Modal (_showAddDealModal) — moved verbatim to
// js/screens/partners.js (Wave 7 Pass 6, 2026-08-03), next to
// loadPartnersDeptTab's 'deals' chip, its only caller.

// renderSOPs + openSOPEditor — moved verbatim to js/screens/dashboards.js
// (Wave 7 Pass 9, 2026-08-03). The 'sops' case in navigateTo below still
// calls renderSOPs() as a bare global identifier at runtime only.

// renderGovBiddings — moved verbatim to js/screens/govit.js (Wave 7 Pass 5,
// 2026-08-03), along with the canonical window.GOV_BUCKETS bucket list (it
// used to be re-derived here AND separately hardcoded inside departments.js's
// window.renderDocCollection — see that file's stub comment + govit.js's
// header for the dedupe). Still a bare top-level `function` (not window.*),
// so the 'Government Biddings' case below keeps calling it unqualified —
// resolves fine as a global regardless of which script defines it, same as
// every other bare-global forward-reference this wave's passes document.

function renderGenericDept(dept) {
  const cfg = DEPARTMENTS[dept];
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;gap:10px">${window.deptIconTile(cfg||dept, 32)}<h2 style="margin:0">${dept}</h2></div>
    <div class="card"><div class="card-body"><div class="empty-state">${window.deptIconTile(cfg||dept, 44)}<h4>${dept}</h4><p>Module coming soon.</p></div></div></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
}

// ── Files (employee tab) ──────────────────────────
window.renderFiles = async function(currentUser, currentRole) {
  const c = document.getElementById('page-content');
  const dept = currentDepts[0] || 'General';
  const fileTabs = [{key:'My Files',label:'My Files'},{key:'Department',label:'Department Files'}];
  if (isPresident()||currentRole==='manager') fileTabs.push({key:'All',label:'All Files'});
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('📁',20)} Files</h2></div>
    ${window.chipTabs(fileTabs, 'My Files', {cls:'files-tabs'})}
    <div id="files-content"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
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
  window.bindChipTabs(c.querySelector('.files-tabs'), (key)=>loadFiles(key));
};

// renderPersonalFinance + the KPI/attendance-score cluster (getKpiScore,
// countWorkDays, _attRecScore, getAttendanceScore, openEmpStandingsModal,
// openWorkerProfilePanel, renderWorkerProfileTab) + renderProgressReports +
// renderCompany/renderCompanyBiOps/renderCompanyOverview/renderCompanyMemos +
// openMemoDetailModal/openMemoById/deleteMemo/renderMemosPage +
// renderCompanyPolicies/renderCompanyDownloads/renderCompanyHandbook +
// renderDepartments + renderAnalytics + renderTeam (accounts admin) +
// openAddEmployeeModal/_getWorkerAuth/openCreateWorkerModal/
// openEditEmployeeModal — moved verbatim to js/screens/dashboards.js (Wave 7
// Pass 9, 2026-08-03), a single contiguous cut. departments.js's
// window.getAttendanceScore guard and people.js's typeof getKpiScore/
// getAttendanceScore/countWorkDays guards already tolerated these being
// undefined before this move — unaffected, resolve fine as bare/window.*
// globals at runtime once dashboards.js has loaded. The 'personal-finance',
// 'progress', 'company', 'memos', 'departments', 'analytics', 'team' cases
// in navigateTo below, and notifications.js's openMemoById deep-link, still
// call these as bare/window.* identifiers, same runtime-only resolution.

// ── Profile Drawer ────────────────────────────────
// v14 Batch5 A3 — KEEP as openModal: a quick single-field boot-time prompt
// (setTimeout-fired at login, app.js:128) opened over the base dashboard with
// no other surface on the stack — not detail/history content.
function _promptPhoneNumber() {
  openModal(`${emojiIcon('📞',16)} Add Your Phone Number`,
    `<p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Your phone number appears on your Digital ID and Calling Card so colleagues can reach you.</p>
     <div class="form-group">
       <label>Mobile Number</label>
       <input id="phone-prompt-input" type="tel" placeholder="e.g. 09171234567" style="font-size:16px"/>
     </div>`,
    `<button class="btn-primary" id="phone-prompt-save">Save</button>
     <button class="btn-secondary" onclick="closeModal()">Skip</button>`
  );
  document.getElementById('phone-prompt-save')?.addEventListener('click', async () => {
    const phone = (document.getElementById('phone-prompt-input')?.value || '').trim();
    if (!phone) return;
    await db.collection('users').doc(currentUser.uid).update({ phone });
    userProfile.phone = phone;
    window.userProfile = userProfile;
    closeModal();
    Notifs.success('📞 Phone number saved!');
  });
}

function openProfileDrawer() {
  const drawer=document.getElementById('profile-drawer');
  const overlay=document.getElementById('drawer-overlay');
  const body=document.getElementById('profile-body');
  const u=userProfile;
  const depts=(Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'Unassigned';
  body.innerHTML=`
    <!-- ── Avatar hero ── -->
    <div class="profile-hero">
      <div id="profile-photo-wrap" class="profile-avatar-wrap">
        ${u.photoUrl
          ? `<img src="${escHtml(u.photoUrl)}" class="profile-avatar-img"/>`
          : `<span class="profile-avatar-initials">${(u.displayName||'?')[0].toUpperCase()}</span>`}
        <div class="profile-avatar-edit-badge"><i data-lucide="camera"></i></div>
      </div>
      <div class="profile-hero-name">${escHtml(u.displayName||'User')}</div>
      <div class="profile-hero-role">${escHtml(ROLES[u.role]?.label||u.role||'Employee')} · ${escHtml(depts)}</div>
      ${u.employeeId?`<div class="profile-hero-id">${escHtml(u.employeeId)}</div>`:''}
      <button class="btn-secondary btn-sm" style="margin-top:10px"
        onclick="closeProfileDrawer(); navigateTo('my-profile')">View My Profile →</button>
    </div>

    <!-- ── Edit name ── -->
    <div class="profile-section-label">DISPLAY NAME</div>
    <div class="profile-inset-card">
      <div class="profile-row-edit">
        <input id="profile-name" class="profile-inline-input" value="${escHtml(u.displayName||'')}" placeholder="Your name"/>
        <button class="btn-primary btn-sm" id="save-name-btn">Save</button>
      </div>
    </div>

    <!-- ── Info rows ── -->
    <div class="profile-section-label">ACCOUNT</div>
    <div class="profile-inset-card">
      <div class="profile-info-row"><span class="pir-label">Email</span><span class="pir-value">${escHtml(u.email||'—')}</span></div>
      <div class="profile-info-row"><span class="pir-label">Employee ID</span><span class="pir-value pir-mono">${escHtml(u.employeeId||'—')}</span></div>
      <div class="profile-info-row"><span class="pir-label">Role</span><span class="pir-value">${escHtml(ROLES[u.role]?.label||u.role||'—')}</span></div>
      <div class="profile-info-row no-border"><span class="pir-label">Department</span><span class="pir-value">${escHtml(depts)}</span></div>
    </div>

    <!-- ── Settings ── -->
    <div class="profile-section-label">SETTINGS</div>
    <div class="profile-inset-card">
      <div class="profile-info-row no-border" style="flex-direction:column;align-items:stretch;gap:10px">
        <span class="pir-label">Appearance</span>
        <div class="theme-picker" id="drawer-theme-picker">
          <button class="theme-card" data-theme="light" title="Light">
            <span class="theme-card-mock" style="background:#F7F8FA">
              <span class="theme-card-mock-card" style="background:#FFFFFF;border-color:rgba(16,24,40,0.10)"></span>
              <span class="theme-card-mock-dot" style="background:#0866FF"></span>
            </span>
            <span class="theme-card-label"><i data-lucide="sun"></i>Light</span>
          </button>
          <button class="theme-card" data-theme="dark" title="Dark">
            <span class="theme-card-mock" style="background:#0F1114">
              <span class="theme-card-mock-card" style="background:#1A1D21;border-color:rgba(255,255,255,0.09)"></span>
              <span class="theme-card-mock-dot" style="background:#4599FF"></span>
            </span>
            <span class="theme-card-label"><i data-lucide="moon"></i>Dark</span>
          </button>
          <button class="theme-card" data-theme="astral" title="Astral">
            <span class="theme-card-mock" style="background:#070710">
              <span class="theme-card-mock-card" style="background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.16)"></span>
              <span class="theme-card-mock-dot" style="background:#9BA8FF"></span>
            </span>
            <span class="theme-card-label"><i data-lucide="sparkles"></i>Astral</span>
          </button>
          <button class="theme-card theme-card-auto" data-theme="auto" title="Match system">
            <span class="theme-card-mock theme-card-mock-auto">
              <span class="theme-card-mock-card"></span>
              <span class="theme-card-mock-dot"></span>
            </span>
            <span class="theme-card-label"><i data-lucide="monitor"></i>Auto</span>
          </button>
        </div>
      </div>
      ${u.phone
        ? `<div class="profile-info-row no-border"><span class="pir-label">Phone</span><span class="pir-value pir-phone">${escHtml(u.phone)}<button class="btn-secondary btn-sm" id="edit-phone-btn" style="margin-left:10px">Edit</button></span></div>`
        : `<div class="profile-info-row no-border">
            <div style="width:100%">
              <div class="pir-label" style="margin-bottom:8px">Phone Number</div>
              <div style="display:flex;gap:8px"><input id="profile-phone" type="tel" placeholder="09171234567" class="profile-inline-input"/><button class="btn-primary btn-sm" id="save-phone-btn">Save</button></div>
            </div>
           </div>`}
    </div>

    <!-- ── More / Shortcuts (moved out of the main nav to declutter) ── -->
    <div class="profile-section-label">MORE</div>
    <div class="profile-inset-card" style="padding:4px 8px">
      ${(() => {
        const isPartnerU = (typeof isPartner==='function' && isPartner()) || (typeof isBrilliantOnly==='function' && isBrilliantOnly());
        const isHolidaysAdmin = ['president','manager','secretary','finance'].includes(currentRole);
        const links = [
          { icon:'🌴', label:'Leave', page:'leave', hide: isPartnerU },
          { icon:'📅', label:'Attendance', page:'attendance', hide: isPartnerU },
          { icon:'🗓️', label:'Holidays Admin', page:'holidays', hide: !isHolidaysAdmin },
          { icon:'📖', label:'SOPs', page:'sops' },
          { icon:'❓', label:'Help & Guide', page:'help' },
        ].filter(l => !l.hide);
        return links.map(l=>`<button class="profile-shortcut-btn" data-page="${l.page}" style="display:flex;align-items:center;gap:12px;width:100%;background:none;border:none;border-bottom:1px solid var(--border);padding:13px 6px;cursor:pointer;color:var(--text);font-size:14px;text-align:left"><span style="font-size:18px;width:22px;text-align:center">${emojiIcon(l.icon,18)}</span>${l.label}</button>`).join('');
      })()}
    </div>

    <!-- ── Notification Settings ── -->
    <div class="profile-section-label">NOTIFICATIONS</div>
    <div class="profile-inset-card" id="notif-settings-card">
      ${(()=>{
        const ns = u.notifSettings || {};
        const toggle = (key, label, desc='') => `
          <div class="profile-info-row" style="align-items:flex-start;padding:12px 0">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--text)">${label}</div>
              ${desc?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${desc}</div>`:''}
            </div>
            <label class="notif-toggle-wrap" style="flex-shrink:0;margin-left:12px">
              <input type="checkbox" class="notif-toggle" data-key="${key}" ${ns[key]!==false?'checked':''}>
              <span class="notif-toggle-slider"></span>
            </label>
          </div>`;
        return [
          toggle('push',         'Push Notifications',   'Browser / device alerts'),
          toggle('tasks',        'Task Updates',          'Assignments, status changes, approvals'),
          toggle('payroll',      'Payroll & Salary',      'Payslips, CA deductions, payroll alerts'),
          toggle('finance',      'Finance Alerts',        'Ledger, expense reports, request outcomes'),
          toggle('attendance',   'Attendance Reminders',  'Clock-in / clock-out reminders'),
          toggle('deadlines',    'Deadline Alerts',       'Upcoming and overdue task deadlines'),
          toggle('announcements','Announcements',         'Company-wide posts and news'),
        ].join('');
      })()}
    </div>

    <!-- ── Sign out ── -->
    <div style="padding:0 0 calc(24px + env(safe-area-inset-bottom,0px))">
      <button class="btn-danger profile-signout-btn" onclick="auth.signOut()">Sign Out</button>
    </div>
  `;
  const wasOpen = drawer.classList.contains('open');
  drawer.classList.remove('hidden');
  setTimeout(()=>drawer.classList.add('open'),10);
  overlay.classList.remove('hidden'); overlay.classList.add('active');
  // v13 Phase 105 -- register with the Overlay history stack so device/browser
  // Back closes the drawer instead of leaving it open while the page behind it
  // navigates. openProfileDrawer() is also called to *re-render* the drawer
  // in place (save-phone-btn handlers above) while it's already open+pushed --
  // guard against double-pushing a second history entry in that case.
  if (window.Overlay && !wasOpen) window.Overlay.push('drawer', () => closeProfileDrawer());
  if (window.lucide) lucide.createIcons({ nodes: [drawer] });
  document.getElementById('profile-photo-wrap').addEventListener('click',()=>{
    const input=document.createElement('input'); input.type='file'; input.accept='image/*';
    input.onchange=async e=>{const file=e.target.files[0];if(!file)return;Notifs.info('Uploading…');try{const url=await Drive.uploadProfilePhoto(file,currentUser.uid);await db.collection('users').doc(currentUser.uid).update({photoUrl:url});userProfile.photoUrl=url;applyUserUI();document.getElementById('profile-photo-wrap').innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover"/>`;Notifs.success('Photo updated!');}catch(err){Notifs.showToast('Upload failed','error');}};
    input.click();
  });
  document.getElementById('save-name-btn').addEventListener('click',async()=>{const name=document.getElementById('profile-name').value.trim();if(!name)return;await db.collection('users').doc(currentUser.uid).update({displayName:name});userProfile.displayName=name;applyUserUI();Notifs.success('Name updated!');});

  // Theme picker
  const themePicker = document.getElementById('drawer-theme-picker');
  if (themePicker) {
    const updateActive = () => {
      const current = getTheme();
      themePicker.querySelectorAll('.theme-card').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === current);
      });
    };
    updateActive();
    // Buttons render as .theme-card (WS42 rename) — the old .theme-swatch
    // selector matched nothing, leaving the whole theme picker dead.
    themePicker.querySelectorAll('.theme-card').forEach(btn => {
      btn.addEventListener('click', () => { setTheme(btn.dataset.theme); updateActive(); });
    });
  }

  // Phone number
  const savePhoneBtn = document.getElementById('save-phone-btn');
  if (savePhoneBtn) {
    savePhoneBtn.addEventListener('click', async () => {
      const phone = (document.getElementById('profile-phone')?.value || '').trim();
      if (!phone) return;
      await db.collection('users').doc(currentUser.uid).update({ phone });
      userProfile.phone = phone;
      Notifs.success('Phone number saved!');
      openProfileDrawer(); // re-render drawer
    });
  }
  const editPhoneBtn = document.getElementById('edit-phone-btn');
  if (editPhoneBtn) {
    editPhoneBtn.addEventListener('click', () => {
      const wrap = editPhoneBtn.closest('div[style]');
      if (wrap) wrap.innerHTML = `<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:6px">${emojiIcon('📞',13)} Phone Number</div><div style="display:flex;gap:8px"><input id="profile-phone" type="tel" value="${escHtml(userProfile.phone||'')}" style="flex:1;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px"/><button class="btn-primary btn-sm" id="save-phone-btn2">Save</button></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
      document.getElementById('save-phone-btn2')?.addEventListener('click', async () => {
        const phone = (document.getElementById('profile-phone')?.value || '').trim();
        if (!phone) return;
        await db.collection('users').doc(currentUser.uid).update({ phone });
        userProfile.phone = phone;
        Notifs.success('Phone number saved!');
        openProfileDrawer();
      });
    });
  }

  // Notification setting toggles
  document.querySelectorAll('.notif-toggle').forEach(chk => {
    chk.addEventListener('change', async () => {
      const key = chk.dataset.key;
      const val = chk.checked;
      const update = {};
      update[`notifSettings.${key}`] = val;
      await db.collection('users').doc(currentUser.uid).update(update);
      if (!userProfile.notifSettings) userProfile.notifSettings = {};
      userProfile.notifSettings[key] = val;
      window.userProfile = userProfile;
    });
  });

  document.getElementById('profile-close').onclick=requestCloseProfileDrawer;
  overlay.addEventListener('click',requestCloseProfileDrawer);
  drawer.querySelectorAll('.profile-shortcut-btn').forEach(b => b.onclick = () => { requestCloseProfileDrawer(); navigateTo(b.dataset.page); });
}

function closeProfileDrawer() {
  const drawer=document.getElementById('profile-drawer');
  const overlay=document.getElementById('drawer-overlay');
  if (!drawer || !drawer.classList.contains('open')) return;
  drawer.classList.remove('open');
  overlay.classList.remove('active'); overlay.classList.add('hidden');
  setTimeout(()=>drawer.classList.add('hidden'),300);
}
window.closeProfileDrawer = closeProfileDrawer;
// Close path used by the X button / scrim / shortcut links -- routes through
// Overlay when the drawer owns the top of the stack so Back-consuming stays
// in sync; falls back to a direct close if it's stale/unpushed.
function requestCloseProfileDrawer() {
  if (window.Overlay && window.Overlay._stack.length &&
      window.Overlay._stack[window.Overlay._stack.length - 1].kind === 'drawer') {
    window.Overlay.dismissTop();
  } else {
    closeProfileDrawer();
  }
}
window.requestCloseProfileDrawer = requestCloseProfileDrawer;

// ── Focus trap / focus-return helpers (v13 Phase 125/144 — modal & page-panel a11y) ──
// One implementation shared by openModal/openPage: capture the trigger on open,
// move focus inside the overlay, trap Tab/Shift+Tab within it, and restore focus
// to the trigger on every teardown path (X button, backdrop, Escape, device Back,
// Overlay.clearAll()) since all of those tear down via the Overlay.push() callback.
const FOCUSABLE_SEL = 'a[href],button:not([disabled]),textarea:not([disabled]),' +
  'input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
function _focusableEls(container){
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SEL))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}
function _focusTrapAttach(container){
  if (!container) return;
  _focusTrapDetach(container); // guard: never stack two listeners on the same container
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    const items = _focusableEls(container);
    if (!items.length){ e.preventDefault(); container.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  };
  container._focusTrapHandler = handler;
  container.addEventListener('keydown', handler);
}
function _focusTrapDetach(container){
  if (container && container._focusTrapHandler){
    container.removeEventListener('keydown', container._focusTrapHandler);
    container._focusTrapHandler = null;
  }
}
function _focusEnter(container){
  if (!container) return;
  const items = _focusableEls(container);
  if (items.length) items[0].focus();
  else { if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex','-1'); container.focus(); }
}
function _focusReturn(trigger){
  if (trigger && document.contains(trigger) && typeof trigger.focus === 'function') {
    try { trigger.focus(); } catch(_){}
  }
}

// ── Modal / Page panel (v12 WS10/WS11 — Overlay-registered, device Back closes) ──
// opts.size: 'wide' (~920px) or 'full' (up to 1200px / 94dvh) for content-heavy
// popups so they don't render as a cramped small dialog. Default stays compact.
// Modal/page titles render as plain TEXT (they can embed user data — never
// innerHTML them), but ~44 call sites prefix the title with emojiIcon()/
// lucideIconHtml() output, which is HTML and used to show up on screen as
// literal "<i data-lucide=...>" code. Extract that icon markup, render the
// remainder as text, and prepend a real icon element instead.
function _setPanelTitle(el, title){
  title = String(title ?? '');
  let iconName = null;
  title = title.replace(/<i\s+data-lucide="([a-z0-9-]+)"[^>]*>\s*<\/i>/gi, (_, n) => { iconName = iconName || n; return ' '; });
  title = title.replace(/<span class="emoji-icon">([^<]*)<\/span>/gi, '$1');
  el.textContent = title.replace(/\s+/g, ' ').trim();
  if (iconName) {
    const i = document.createElement('i');
    i.setAttribute('data-lucide', iconName);
    i.style.cssText = 'width:18px;height:18px;vertical-align:-3px;margin-right:6px';
    el.prepend(i);
    if (el.isConnected && window.lucide) lucide.createIcons({ nodes: [el] });
    // (detached panels get icons from the caller's later createIcons() pass)
  }
}
window.openModal=function(title,bodyHTML,footerHTML='',opts){
  opts = opts || {};
  const _trigger = document.activeElement;
  if (title !== 'Keyboard shortcuts') window._cheatSheetOpen = false;
  _setPanelTitle(document.getElementById('modal-title'), title);
  const modalBody=document.getElementById('modal-body');
  modalBody.innerHTML=bodyHTML;
  const footer=document.getElementById('modal-footer');
  footer.innerHTML=footerHTML;
  footer.classList.toggle('hidden',!footerHTML);
  // Render any <i data-lucide> the caller put in the body/footer — many call
  // sites relied on this and their icons showed as blank gaps (openPage
  // already does a createIcons pass; openModal never did).
  if (window.lucide) lucide.createIcons({ nodes: [modalBody, footer] });
  const box=document.getElementById('modal-box');
  if(box){ box.classList.remove('modal-wide','modal-full');
    if(opts.size==='wide') box.classList.add('modal-wide');
    else if(opts.size==='full') box.classList.add('modal-full');
    box.setAttribute('role','dialog'); box.setAttribute('aria-modal','true');
    box.setAttribute('aria-labelledby','modal-title'); }
  const ov = document.getElementById('modal-overlay');
  ov.classList.remove('hidden');
  ov.classList.add('active');
  _focusTrapAttach(box);
  requestAnimationFrame(() => _focusEnter(box));
  // Reset _cheatSheetOpen in the teardown itself (not just closeModal) so it clears
  // on EVERY dismissal path — Escape, backdrop click, and Overlay.clearAll() all
  // tear a modal down via this callback without necessarily going through closeModal().
  const teardown = () => {
    ov.classList.add('hidden'); ov.classList.remove('active'); window._cheatSheetOpen = false;
    _focusTrapDetach(box); _focusReturn(_trigger);
  };
  // v14 Batch1 1b — modal-over-modal: swap content in place instead of pushing
  // a second history entry, so one Back always closes the (top) modal. The
  // single static #modal-overlay DOM is reused either way; only the Overlay
  // bookkeeping differs. 1c gives the modal its stacking-order z here too, so
  // a modal opened from a pushed page (openPage) renders above it.
  if (window.Overlay.topKind() === 'modal') {
    window.Overlay.replaceTop('modal', teardown, ov);
  } else {
    window.Overlay.push('modal', teardown, ov);
  }
};
// ── v14 Batch1 1a — true page stack ─────────────────────────────────────────
// _pageStack holds every currently-open page panel, bottom to top. Opening a
// new page over an existing one hides the old one (page-under: visibility
// hidden, stays in the DOM — scroll position/form state preserved) instead of
// destroying it, and pushes ONE new Overlay entry. Back therefore pops pages
// one at a time, Apple push/pop style, instead of destroying+recreating.
//
// NOTE for the Batch 2 (CSS) agent: `.page-under` should become a real CSS
// class (`visibility:hidden`) — this batch can only edit JS files, so the
// hide is applied as an inline style (el.style.visibility) below. The class
// name is still added for a future selector hook; it carries no rule yet.
window._pageStack = window._pageStack || [];
let _pageSeq = 0;
// Full-screen routed panel — SAME signature as openModal. Forms swap openModal→openPage.
// New (all optional, backward-compatible) opts:
//   headerRightHTML — string rendered right of the title (caller wires listeners
//     on the RETURNED element); replace='' (default) → the header keeps its old
//     40px spacer so existing callers render identically.
//   onClose — called at teardown start, before DOM/focus teardown, for callers
//     that own listeners/timers scoped to the page's lifetime.
//   replace — swap the CURRENT top page in place (same history depth) instead
//     of pushing a new one; used by multi-step flows. No-op (falls back to a
//     normal push) if there is no page currently on top.
// Returns the panel element (previously returned undefined).
window.openPage = function(title, bodyHTML, footerHTML='', opts){
  opts = opts || {};
  const _trigger = document.activeElement;
  const stack = window._pageStack;
  const doReplace = opts.replace === true && stack.length > 0;

  let prevTop = null;
  if (doReplace) {
    // Tear down the CURRENT top panel's DOM directly — NOT via history.back()
    // (that would consume a history entry; replace keeps depth unchanged).
    prevTop = stack.pop() || null;
    if (prevTop) {
      try { if (typeof prevTop._onClose === 'function') prevTop._onClose(); } catch(_){}
      _focusTrapDetach(prevTop);
      if (prevTop.isConnected) prevTop.remove();
    }
  } else {
    prevTop = stack[stack.length - 1] || null;
  }

  const seq = ++_pageSeq;
  const titleId = 'page-panel-title-' + seq;
  const p = document.createElement('div');
  p.id = 'page-panel-' + seq; p.className = 'page-panel overlay-active';
  p.setAttribute('role','dialog'); p.setAttribute('aria-modal','true');
  p.setAttribute('aria-labelledby', titleId);
  const headerRight = opts.headerRightHTML || '';
  p.innerHTML = `
    <div class="page-panel-head">
      <button class="page-panel-back" aria-label="Back"><i data-lucide="arrow-left"></i></button>
      <h3 class="page-panel-title" id="${titleId}"></h3>
      <div class="page-panel-head-right" style="min-width:40px;display:flex;align-items:center;justify-content:flex-end;gap:8px">${headerRight}</div>
    </div>
    <div class="page-panel-body"></div>
    <div class="page-panel-foot"></div>`;
  _setPanelTitle(p.querySelector('.page-panel-title'), title);
  p.querySelector('.page-panel-body').innerHTML = bodyHTML;
  const foot = p.querySelector('.page-panel-foot');
  foot.innerHTML = footerHTML; foot.classList.toggle('hidden', !footerHTML);
  p._onClose = (typeof opts.onClose === 'function') ? opts.onClose : null;

  // Hide (not destroy) the page we're stacking over — skipped on `replace`,
  // since that path already tore the old top down above.
  if (!doReplace && prevTop && prevTop.isConnected) {
    prevTop.classList.add('page-under');
    prevTop.style.visibility = 'hidden';
  }
  stack.push(p);

  document.body.appendChild(p);
  p.querySelector('.page-panel-back').addEventListener('click', () => window.Overlay.dismissTop());
  window.lucide?.createIcons();
  requestAnimationFrame(() => { p.classList.add('open'); _focusEnter(p); });
  _focusTrapAttach(p);

  const teardown = () => {
    p.classList.remove('open'); _focusTrapDetach(p); _focusReturn(_trigger);
    if (p._onClose) { try { p._onClose(); } catch(_){} }
    const idx = stack.indexOf(p);
    if (idx !== -1) stack.splice(idx, 1);
    setTimeout(() => { if (p.isConnected) p.remove(); }, 300);
    // Reveal whatever's now on top of the page stack, if anything (guarded —
    // clearAll() can invoke every teardown back-to-back while elements are
    // mid-removal, so isConnected is checked before touching style/class).
    const newTop = stack[stack.length - 1];
    if (newTop && newTop.isConnected) {
      newTop.classList.remove('page-under');
      newTop.style.visibility = '';
    }
  };

  if (doReplace) {
    window.Overlay.replaceTop('page', teardown, p);
  } else {
    window.Overlay.push('page', teardown, p);
  }
  return p;
};
// Generic dismiss — closes whatever overlay is on top (dialog | modal | page | panel).
window.closeModal=function(){ window.Overlay.dismissTop(); };
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('modal-close')?.addEventListener('click',() => window.Overlay.dismissTop());
  document.getElementById('modal-overlay')?.addEventListener('click',e=>{if(e.target===document.getElementById('modal-overlay')) window.Overlay.dismissTop();});
});

// ── v14 Batch1 1e — dev-only z-index stacking lint ──────────────────────────
// Cheap by design (must stay <5ms): every dynamically-mounted overlay/panel in
// this app (#modal-overlay, #dialog-overlay, #drawer-overlay, openPage panels,
// the task/worker-profile/toast/offline-banner surfaces, the gesture pill…) is
// appended directly to document.body, so scanning body's direct children finds
// them all without a full-tree querySelectorAll. Flags any `position:fixed`
// child whose computed z-index isn't one of: a --z-* token value, the dynamic
// 300–398 tier (1c), 5000 (--z-dialog), or >=9000 (toast/splash/push tier).
// Logged once per element via a WeakSet so a re-render doesn't spam the console.
const _Z_TOKEN_VALUES = [85,90,94,95,96,100,101,140,150,180,190,195,198,200,210,5000,9999];
const _zLintFlagged = new WeakSet();
window.devCheckStacking = function () {
  let isDev = false;
  try {
    isDev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ||
      new URLSearchParams(location.search).has('dev');
  } catch(_) { return; }
  if (!isDev || !document.body) return;
  const kids = document.body.children;
  for (let i = 0; i < kids.length; i++) {
    const el = kids[i];
    if (_zLintFlagged.has(el)) continue;
    let cs;
    try { cs = getComputedStyle(el); } catch(_) { continue; }
    if (cs.position !== 'fixed') continue;
    const z = parseInt(cs.zIndex, 10);
    if (!Number.isFinite(z)) continue; // 'auto' — not participating in explicit stacking
    const ok = _Z_TOKEN_VALUES.indexOf(z) !== -1 || (z >= 300 && z <= 398) || z === 5000 || z >= 9000;
    if (!ok) {
      _zLintFlagged.add(el);
      console.error('[stacking] off-scale z-index', el);
    }
  }
};

// ── v12 WS10 — router wiring (Back/Forward/hash edits/Esc) ───────────────
window.addEventListener('popstate', (e) => {
  // Overlay open? A Back press dismisses the top overlay and consumes the event.
  if (window.Overlay && window.Overlay.isOpen()) { window.Overlay._popOne(); return; }
  window._navDepth = Math.max(0, (window._navDepth||0) - 1);
  const s = e.state || parseHash();
  const st = (s.t === 'overlay') ? s.base : s;        // stale overlay entry → render its underlying page
  navigateTo(st.page || 'dashboard', { subtab: st.subtab || null, fromHistory: true });
});
window.addEventListener('hashchange', () => {         // user typed/edited the URL hash
  const p = parseHash();
  if (p.page === window.currentPage && p.subtab === (window.currentSubtab||null)) return;
  navigateTo(p.page, { subtab: p.subtab, replace: true });
});
// ── v12 WS18 — global keyboard shortcuts ──────────────────────────────────
// Reconciliation note: the WS18 spec (fable-workplan/18-shortcuts.md) was written
// assuming a standalone window.OverlayEsc DOM-probe registry with its own Escape
// keydown listener. By the time this was implemented, WS10-11's window.Overlay
// (a History-API-backed LIFO stack) already owned Escape-to-dismiss for
// modal/page-panel/task-panel/dialog via the single listener that lived here.
// Running both would race two independent "close on Escape" systems against the
// same keypress, so this folds WS18's shortcuts into that ONE listener instead of
// adding a second: the 'escape' entry below calls Overlay.dismissTop() first, and
// only falls back to a DOM-class check as a defensive last resort. (v13 Phase 105:
// profile drawer and mobile sidebar now push their own Overlay entries on open --
// see openProfileDrawer/openSidebar -- so the dismissTop() branch handles them too;
// the DOM-class fallback below is now purely a safety net, not the primary path.)
window.Keymap = (function () {
  let _inited = false;

  function isTextInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (el.readOnly || el.disabled) return false;
      return true;
    }
    return !!el.isContentEditable;
  }

  function openSearch(e) {
    // THIRD entry point into the search page (topbar button + renderGlobalSearch's
    // own guard are the other two) — repeat the partner/BS-only block here too.
    const blocked = (typeof isPartner === 'function' && isPartner()) ||
                    (typeof isBrilliantOnly === 'function' && isBrilliantOnly());
    if (blocked) return false;
    if (e) e.preventDefault();
    navigateTo('search');
    return true;
  }

  function navByIndex(n) {
    let items = [];
    try { items = (typeof getSidebarItems === 'function') ? getSidebarItems() : []; } catch (_) { return false; }
    const it = items[n - 1];
    if (!it || !it.page) return false;
    navigateTo(it.page);
    return true;
  }

  function closeTopOverlay() {
    // v13 Phase 105 -- profile drawer and mobile sidebar now push Overlay
    // entries on open, so the isOpen()/dismissTop() branch above handles
    // Escape for them in the normal case. These direct-class checks remain
    // only as a defensive fallback (e.g. a surface left open without a
    // matching Overlay entry after a code path we haven't covered).
    if (window.Overlay && window.Overlay.isOpen()) { window.Overlay.dismissTop(); return true; }
    const drawer = document.getElementById('profile-drawer');
    if (drawer && drawer.classList.contains('open')) {
      if (typeof closeProfileDrawer === 'function') closeProfileDrawer();
      return true;
    }
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
      if (typeof requestCloseSidebar === 'function') requestCloseSidebar();
      return true;
    }
    return false;
  }

  function buildCheatSheetHTML() {
    const esc = window.escHtml || (s => (s == null ? '' : String(s)));
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    const cmd = isMac ? '⌘' : 'Ctrl';
    const rows = [
      ['Esc', 'Close dialog / drawer / panel'],
      [cmd + ' K', 'Open search'],
      ['/', 'Open search'],
      ['?', 'Show this cheat sheet'],
      ['n', 'New item (context-aware)'],
      ['[ / ]', 'Previous / next subtab'],
      ['g d', 'Go to Dashboard'],
      ['g t', 'Go to Tasks'],
      ['g a', 'Go to Approvals'],
      ['g c', 'Go to Chat'],
      ['g p', 'Go to Posts'],
      [cmd + ' Enter', 'Submit focused modal form'],
    ];
    let items = [];
    try { items = (typeof getSidebarItems === 'function') ? getSidebarItems() : []; } catch (_) {}
    const navRows = items.slice(0, 9).map((it, i) =>
      `<tr><td class="kbd-cell"><kbd>Alt</kbd> + <kbd>${i + 1}</kbd></td><td>${esc(it.label || it.page)}</td></tr>`).join('');
    const coreRows = rows.map(([k, d]) =>
      `<tr><td class="kbd-cell"><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('');
    return `<div class="kbd-cheatsheet">
      <table class="kbd-table"><tbody>${coreRows}</tbody></table>
      ${navRows ? `<h4 class="kbd-subhead">Jump to</h4><table class="kbd-table"><tbody>${navRows}</tbody></table>` : ''}
    </div>`;
  }

  function toggleCheatSheet(e) {
    if (e) e.preventDefault();
    if (window._cheatSheetOpen && document.getElementById('modal-overlay')?.classList.contains('active')) {
      window.closeModal(); return;
    }
    window.openModal('Keyboard shortcuts', buildCheatSheetHTML());
    window._cheatSheetOpen = true;
  }

  // v13 Phase 145 — Keymap expansion. No pageAction registry exists yet
  // (Phase 132 not built), so 'n' uses a small ordered selector list of real
  // "+Add" button ids gathered across the major screens instead.
  // Re-audit 2026-08-03: '#add-expense-btn' never existed anywhere in the
  // codebase (the Finance/Ledger tab's actual add button is #add-ledger-btn,
  // already listed below) — it silently no-opped on the Finance screen while
  // the cheat sheet still advertised 'n' as working everywhere. Removed.
  const NEW_ITEM_SELECTOR = '[data-key-new], #add-task-btn, ' +
    '#add-client-btn, #add-ledger-btn, #add-deal-btn, #add-ca-for-btn';

  function contextNew() {
    const el = document.querySelector(NEW_ITEM_SELECTOR);
    if (!el || el.offsetParent === null) return false; // not present / not visible
    el.click();
    return true;
  }

  function chipTabStep(dir) {
    const active = document.querySelector('#page-content .chip-tab.active');
    if (!active) return false;
    const sib = dir > 0 ? active.nextElementSibling : active.previousElementSibling;
    if (!sib || !sib.classList || !sib.classList.contains('chip-tab')) return false;
    sib.click();
    return true;
  }

  function submitFocusedModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay || !overlay.classList.contains('active')) return false;
    const btn = document.querySelector('#modal-footer .btn-primary');
    if (!btn) return false;
    btn.click();
    return true;
  }

  // 'g' two-key go-to sequences (g d / g t / g a / g c / g p): tiny pending-key
  // state with a 1.5s window, cleared on any other keydown or timeout.
  let _gPending = false, _gTimer = null;
  const GO_TO_MAP = { d: 'dashboard', t: 'tasks', a: 'approvals', c: 'chat', p: 'posts' };

  function clearGPending() {
    _gPending = false;
    if (_gTimer) { clearTimeout(_gTimer); _gTimer = null; }
  }

  function startGPending() {
    _gPending = true;
    if (_gTimer) clearTimeout(_gTimer);
    _gTimer = setTimeout(clearGPending, 1500);
  }

  function tryGoToSequence(e) {
    if (_gPending) {
      const key = (e.key || '').toLowerCase();
      clearGPending();
      const page = GO_TO_MAP[key];
      if (!page) return false;
      e.preventDefault();
      navigateTo(page);
      return true;
    }
    if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      startGPending();
      return true; // consumed as the lead key of a possible sequence
    }
    return false;
  }

  // Each entry: match(e) predicate, allowInInput (fire even while a text field is
  // focused?), and run(e). Escape and Ctrl/⌘K are allowed in inputs; bare '/', '?'
  // and Alt+N are suppressed while typing. Alt+digit uses e.code (Option+digit on
  // macOS mangles e.key into a special char, but e.code stays 'Digit1'..'Digit9').
  const KEYMAP = [
    { id: 'escape',
      allowInInput: true,
      match: e => e.key === 'Escape',
      run:   () => closeTopOverlay() },

    { id: 'search-cmdk',
      allowInInput: true,
      match: e => (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey,
      run:   e => openSearch(e) },

    { id: 'search-slash',
      allowInInput: false,
      match: e => e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey,
      run:   e => openSearch(e) },

    { id: 'cheatsheet',
      allowInInput: false,
      match: e => e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey,
      run:   e => toggleCheatSheet(e) },

    { id: 'nav-alt-digit',
      allowInInput: false,
      match: e => e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code),
      run:   e => navByIndex(parseInt(e.code.slice(5), 10)) },

    // v13 Phase 145 additions ------------------------------------------------
    { id: 'context-new',
      allowInInput: false,
      match: e => (e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey,
      run:   () => contextNew() },

    { id: 'chip-tab-prev',
      allowInInput: false,
      match: e => e.key === '[' && !e.ctrlKey && !e.metaKey && !e.altKey,
      run:   () => chipTabStep(-1) },

    { id: 'chip-tab-next',
      allowInInput: false,
      match: e => e.key === ']' && !e.ctrlKey && !e.metaKey && !e.altKey,
      run:   () => chipTabStep(1) },

    { id: 'modal-submit-cmdenter',
      allowInInput: true, // must fire from inside a focused modal form field
      match: e => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey,
      run:   e => { const acted = submitFocusedModal(); if (acted) e.preventDefault(); return acted; } },
  ];

  function onKeydown(e) {
    if (e.defaultPrevented) return;
    const typing = isTextInputFocused();

    // 'g d' / 'g t' / 'g a' / 'g c' / 'g p' go-to sequences: stateful two-key
    // combo, so it's handled ahead of the single-shot KEYMAP table. Suppressed
    // while typing like the other bare-letter shortcuts.
    if (!typing) {
      let gHandled = false; try { gHandled = tryGoToSequence(e); } catch (_) {}
      if (gHandled) { if (e.key !== 'g' && e.key !== 'G') e.preventDefault(); return; }
    } else if (_gPending) {
      clearGPending(); // typing into a field cancels a pending 'g' sequence
    }

    for (const entry of KEYMAP) {
      let ok = false; try { ok = entry.match(e); } catch (_) {}
      if (!ok) continue;
      if (typing && !entry.allowInInput) return;
      const acted = entry.run(e);
      if (entry.id === 'escape') { if (acted) e.preventDefault(); return; }
      return;
    }
  }

  function maybeShowFirstRunHint() {
    try {
      if (localStorage.getItem('bi-kbd-hint-seen')) return;
      const blocked = (typeof isPartner === 'function' && isPartner()) ||
                      (typeof isBrilliantOnly === 'function' && isBrilliantOnly());
      if (blocked) return;
      if (window.Notifs && Notifs.showToast) Notifs.showToast('Tip: press ? for keyboard shortcuts', 'success');
      localStorage.setItem('bi-kbd-hint-seen', '1');
    } catch (_) {}
  }

  function init() {
    if (_inited) return;
    _inited = true;
    document.addEventListener('keydown', onKeydown);   // non-passive: we may preventDefault
  }

  return { init, isTextInputFocused, openSearch, navByIndex, toggleCheatSheet, buildCheatSheetHTML,
           maybeShowFirstRunHint };
})();

// ── KPI value auto-fit ────────────────────────────
// The CSS clamp sizes by VIEWPORT, so a long peso figure can still clip inside a
// narrow card. This shrinks each .kpi-value from its natural size until it fits
// its own card width (content-aware), with a readable floor. Runs on any content
// change (observer) + resize, so it covers every dashboard without per-card edits.
window.fitKpiValues = function(root){
  const scope = (root && root.querySelectorAll) ? root : document;
  const FLOOR = 11;
  // Phase 1 — READ pass across every matched element first (natural font size +
  // container clientWidth), before any element's font-size is written. Doing
  // this element-by-element interleaved with writes (the old approach) forces
  // a synchronous layout recompute between every single element's write and
  // the next element's read; capturing all the "how wide is this card" reads
  // up front lets the browser batch them instead.
  const jobs = [];
  scope.querySelectorAll('.kpi-value, .stat-num').forEach(el=>{
    el.style.whiteSpace = 'nowrap';
    // Capture the natural (CSS/inline) size once per element, then always re-fit
    // from it so resizing back up works too.
    if(!el.dataset.maxFs){ el.dataset.maxFs = parseFloat(getComputedStyle(el).fontSize) || 24; }
    jobs.push({ el, maxFs: parseFloat(el.dataset.maxFs), clientWidth: el.clientWidth });
  });
  // Phase 2 — per element, binary-search the largest integer font size in
  // [FLOOR, maxFs] whose scrollWidth still fits clientWidth. This still needs
  // a write-then-read per probe (unavoidable — the browser only knows the
  // resulting text width after the font-size is applied), but converges in
  // ~log2(range) probes (~5-6 for a typical 11-40px range) instead of the old
  // linear 1px decrement (up to 40 probes). Same floor, same final pixel
  // value as the old loop — just fewer forced layouts to get there.
  jobs.forEach(({ el, maxFs, clientWidth }) => {
    el.style.fontSize = maxFs + 'px';
    if (maxFs <= FLOOR || el.scrollWidth <= clientWidth + 1) return; // already fits (or at floor)
    let lo = FLOOR, hi = maxFs - 1, best = FLOOR;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      el.style.fontSize = mid + 'px';
      if (el.scrollWidth > clientWidth + 1) {
        hi = mid - 1;
      } else {
        best = mid;
        lo = mid + 1;
      }
    }
    el.style.fontSize = best + 'px';
  });
};
(function(){
  let t; const run = () => { clearTimeout(t); t = setTimeout(() => {
    try { window.fitKpiValues(document.getElementById('page-content') || document); } catch(_){}
  }, 60); };
  const start = () => {
    const pc = document.getElementById('page-content');
    // Observe node additions (NOT attributes) so our own font-size writes don't loop.
    if(pc && 'MutationObserver' in window){ new MutationObserver(run).observe(pc, {childList:true, subtree:true}); }
    window.addEventListener('resize', run);
    run();
  };
  if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', start); } else { start(); }
})();

// The Mini Calendar (_calMonthOffset/renderMiniCal), renderAccessDenied,
// formatNum, the Suggestion Box (renderSuggestionBox/loadSuggestions), and
// Help (renderHelp/renderHelpAdmin/renderHelpEmployee/renderHelpPartner) —
// moved verbatim to js/screens/dashboards.js (Wave 7 Pass 9, 2026-08-03).
// renderPresidentDashboard/renderEmployeeDashboard (also in dashboards.js)
// call renderMiniCal by bare name; renderProgressReports/renderDepartments/
// renderAnalytics/renderTeam (all in dashboards.js) call renderAccessDenied
// and formatNum the same way — all same-file now, still bare-global style
// per this wave's convention. The 'help' case in navigateTo below still
// calls renderHelp() as a bare global identifier.

// ── Quote Builder iframe → Firestore bridge ───────
window.addEventListener('message', async (e) => {
  if (e.origin !== window.location.origin) return;  // same-origin only — but that alone doesn't prove it came from the builder
  // Re-audit 2026-08-03: same-origin was checked but e.source never was —
  // any same-origin context able to call window.postMessage could forge
  // QUOTE_FILED/QUOTE_UPDATE/QUOTE_DRAFT and have it processed as a real
  // quote-builder submission. The narrower QB_READY/REQUEST_STATE handlers
  // elsewhere in this file already check e.source against the tracked
  // #qb-frame iframe — do the same here for defense-in-depth.
  const qbFrame = document.getElementById('qb-frame');
  if (!qbFrame || e.source !== qbFrame.contentWindow) return;
  const { type, payload, docId, collection } = e.data || {};
  if (!payload || !currentUser || !db) return;

  // Wave 3 Q6 — cloud draft. Debounced (5s idle, builder-side) autosave into a
  // single deterministic slot per user per collection, so a closed tab doesn't
  // lose unfiled work. NOTE: requires firestore.rules to allow this user to
  // create/update/delete their own draft_{uid} doc in bk_quotes/bs_quotes —
  // that rule is deployed separately by the main session, so this whole branch
  // is wrapped to fail silently (nothing else in the app breaks) until then.
  if (type === 'QUOTE_DRAFT') {
    try {
      const coll = (payload.company === 'BK') ? 'bk_quotes' : 'bs_quotes';
      await db.collection(coll).doc('draft_' + currentUser.uid).set({
        ...payload,
        status: 'draft',
        draftBy: currentUser.uid,
        draftAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      try { e.source && e.source.postMessage({ type: 'QUOTE_DRAFT_SAVED', at: Date.now() }, e.origin); } catch(_){}
    } catch (err) {
      console.warn('[QB bridge] QUOTE_DRAFT save failed (draft_{uid} firestore.rules likely not deployed yet)', err);
    }
    return;
  }

  // Wave 3 Q4 — edit-in-place. Builder-driven equivalent of the president's
  // saveReviewedPartnerQuote() .update() path above: the user reopened an
  // existing quote and chose "update original" at File time instead of filing
  // a new copy. Only known quote collections are ever touched.
  if (type === 'QUOTE_UPDATE') {
    try {
      if (!docId || (collection !== 'bk_quotes' && collection !== 'bs_quotes')) return;
      const agentName = userProfile?.displayName || currentUser.email;
      const update = {
        quoteNumber:    payload.quoteNumber || '',
        clientId:       payload.clientId || null,
        clientName:     payload.clientName || '',
        clientCompany:  payload.clientCompany || '',
        clientAddress:  payload.clientAddress || '',
        clientPhone:    payload.clientPhone || '',
        clientEmail:    payload.clientEmail || '',
        salesperson:    payload.salesperson || agentName,
        purpose:        payload.purpose || '',
        subject:        payload.subject || '',
        location:       payload.location || '',
        leadSource:     payload.leadSource || '',
        quoteDate:      payload.quoteDate || '',
        items:          payload.items || [],
        photos:         payload.photos || [],
        subtotal:       payload.subtotal || 0,
        total:          payload.total || 0,
        grandTotal:     payload.grandTotal || 0,
        vatIncluded:    payload.vatIncluded || false,
        vatAmount:      payload.vatAmount || 0,
        discountPct:    payload.discountPct || 0,
        discountAmount: payload.discountAmount || 0,
        netAmount:      payload.netAmount || 0,
        deliveryInstall:payload.deliveryInstall || null,
        timeline:       payload.timeline || null,
        remarks:        payload.remarks || '',
        bankDetails:    payload.bankDetails || '',
        validUntil:     payload.validUntil || '',
        commissionPct:  payload.commissionPct || 0,
        commissionAmount:payload.commissionAmount || 0,
        payment:        payload.payment || null,
        editableState:  payload.editableState || null,
        // rootQuoteId/parentQuoteId are deliberately NOT touched here — this is
        // the SAME doc being edited, its place in the revision chain doesn't change.
        editedAt:       firebase.firestore.FieldValue.serverTimestamp(),
        editedBy:       currentUser.uid,
        editedByName:   agentName,
      };
      await db.collection(collection).doc(docId).update(update);
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('all-quotes');
      window.logAudit && window.logAudit('update', 'quote', docId, { source: 'quote-builder-v2', inPlaceEdit: true });
      if (typeof Notifs?.success === 'function') Notifs.success('Quote updated in place.');
    } catch (err) {
      console.error('[QB bridge] QUOTE_UPDATE failed', err);
      Notifs?.showToast && Notifs.showToast('Update failed: ' + (err.message || err.code), 'error');
    }
    return;
  }

  if (type !== 'QUOTE_FILED' && type !== 'QUOTE_APPROVAL_REQUESTED') return;

  try {
    const agentName = userProfile?.displayName || currentUser.email;
    const data = {
      quoteNumber:    payload.quoteNumber || '',
      company:        payload.company || 'BK',
      clientId:       payload.clientId || null,
      clientName:     payload.clientName || '',
      clientCompany:  payload.clientCompany || '',
      clientAddress:  payload.clientAddress || '',
      clientPhone:    payload.clientPhone || '',
      clientEmail:    payload.clientEmail || '',
      salesperson:    payload.salesperson || agentName,
      purpose:        payload.purpose || '',
      subject:        payload.subject || '',
      location:       payload.location || '',
      leadSource:     payload.leadSource || '',
      quoteDate:      payload.quoteDate || '',
      items:          payload.items || [],
      photos:         payload.photos || [],
      subtotal:       payload.subtotal || 0,
      total:          payload.total || 0,
      grandTotal:     payload.grandTotal || 0,
      vatIncluded:    payload.vatIncluded || false,
      vatAmount:      payload.vatAmount || 0,
      discountPct:    payload.discountPct || 0,
      discountAmount: payload.discountAmount || 0,
      netAmount:      payload.netAmount || 0,
      deliveryInstall:payload.deliveryInstall || null,
      timeline:       payload.timeline || null,
      remarks:        payload.remarks || '',
      bankDetails:    payload.bankDetails || '',
      validUntil:     payload.validUntil || '',
      commissionPct:  payload.commissionPct || 0,
      commissionAmount:payload.commissionAmount || 0,
      payment:        payload.payment || null,
      // Full editable snapshot — lets the quote be re-opened and edited from the Quotations tab
      editableState:  payload.editableState || null,
      // Wave 3 Q5 — revision-chain links. parentQuoteId is null for a
      // from-scratch quote. rootQuoteId is patched to the new doc's own id
      // below when this is the first-ever filing in its chain (payload didn't
      // carry one from a reopened quote).
      parentQuoteId:  payload.parentQuoteId || null,
      rootQuoteId:    payload.rootQuoteId || null,
      source:         'quote-builder-v2',
      agentName,
      createdBy:      currentUser.uid,
      createdByName:  agentName,
      createdByRole:  currentRole || 'partner',
      createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
    };

    // Route by company so Barro Kitchens quotes land in bk_quotes (visible in the
    // Sales → Quotations summary) and Brilliant Steel quotes in bs_quotes.
    const coll = (data.company === 'BK') ? 'bk_quotes' : 'bs_quotes';

    // Versioning: if THIS user re-files a quote with the same number, save a new
    // version named "<quoteNo> (2)", "(3)"… instead of silently duplicating.
    let version = 1;
    try {
      const mine = await db.collection(coll).where('createdBy','==',currentUser.uid).get();
      version = mine.docs.filter(d => (d.data().quoteNumber||'') === data.quoteNumber).length + 1;
    } catch(_) {}
    data.version = version;
    data.fileName = data.quoteNumber + (version > 1 ? ` (${version})` : '');

    // Upsert into the UNIFIED client book and return the clientId to stamp on the
    // quote (decision 3). Partners never write the internal CRM (decision 10) —
    // their client names surface via the hub's "From quotes" section instead.
    const upsertClient = async () => {
      if (typeof isPartner === 'function' && isPartner()) return null;
      return await window.Clients.upsertFromQuote(data);
    };

    // Wave 3 Q5 — a fresh (never-reopened) quote has no rootQuoteId yet; once
    // Firestore assigns the doc its id, that id becomes the chain's root.
    // Reopened quotes already carried a resolved rootQuoteId in the payload
    // (see reopenQuoteFromDoc/newRevisionFromDoc), so this only fires once
    // per chain, on its very first filing.
    const stampRoot = async (docRef) => {
      if (!data.rootQuoteId) { try { await docRef.update({ rootQuoteId: docRef.id }); } catch(_){} }
    };
    // Wave 3 Q6 — filing (either path) replaces the need for the cloud draft
    // slot; best-effort cleanup, never blocks the file itself.
    const deleteDraftSlot = async () => { try { await db.collection(coll).doc('draft_' + currentUser.uid).delete(); } catch(_){} };

    if (type === 'QUOTE_FILED') {
      Object.assign(data, window.quoteStateFields('filed'));
      data.filedAt = firebase.firestore.FieldValue.serverTimestamp();
      data.clientId = await upsertClient();        // FK stamped BEFORE the quote is written
      const docRef = await db.collection(coll).add(data);
      await stampRoot(docRef);
      await deleteDraftSlot();
      // Notify president so they're aware of filed quotes
      await Notifs.sendToOwner({
        title: '📋 Quote Filed',
        body: `${agentName} filed "${data.fileName}" for ${payload.clientName} — ₱${window.fmtN2(payload.total||0)}`,
        icon: '📋', type: 'quote_filed'
      });
      if (typeof Notifs?.success === 'function') Notifs.success(`Quote filed${version>1?` as version ${version}`:''} + client saved!`);
    } else {
      // QUOTE_APPROVAL_REQUESTED — route by company like QUOTE_FILED (v12 WS31:
      // fixes "BK quotes stranded in bs_quotes"); the approval_requests doc
      // records WHICH collection the quote lives in so the approve/return
      // handlers update the right doc.
      Object.assign(data, window.quoteStateFields('pending_approval'));
      data.reviewRequestedAt = firebase.firestore.FieldValue.serverTimestamp();
      data.clientId = await upsertClient();        // FK stamped BEFORE the quote is written
      const docRef = await db.collection(coll).add(data);
      await stampRoot(docRef);
      await deleteDraftSlot();
      await db.collection('approval_requests').add({
        type: 'bs_quote',            // legacy type value kept — readers filter on it
        quoteId: docRef.id,
        quoteColl: coll,             // NEW (WS31 decision 14) — 'bk_quotes' | 'bs_quotes'
        quoteNumber: payload.quoteNumber,
        clientName: payload.clientName,
        total: payload.total || 0,
        agentName,
        agentId: currentUser.uid,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await Notifs.sendToOwner({
        title: '📤 Quote Awaiting Approval',
        body: `${agentName} submitted "${payload.quoteNumber}" for ${payload.clientName} — ₱${window.fmtN2(payload.total||0)} — please review.`,
        icon: '📤', type: 'quote_review_request'
      });
      if (typeof Notifs?.success === 'function') Notifs.success('Sent for approval!');
    }
  } catch(err) {
    console.error('[QB bridge]', err);
  }
});

// One-click, idempotent: moves bs_quotes docs misfiled with company:'BK' (the old
// QUOTE_APPROVAL_REQUESTED hardcode) into bk_quotes, PRESERVING each doc id so
// sales_orders.quoteId / approval_requests.quoteId / clients joins stay valid.
// company:'PT' rows are deliberately NOT moved (bs_quotes is the non-BK bucket).
window.migrateStrandedBKQuotes = async function () {
  const FV = firebase.firestore.FieldValue;
  const out = { moved: 0, reqsPatched: 0 };
  const snap = await db.collection('bs_quotes').where('company', '==', 'BK').get();
  for (const d of snap.docs) {
    await db.collection('bk_quotes').doc(d.id).set({ ...d.data(),
      migratedFrom: 'bs_quotes', migratedAt: FV.serverTimestamp() });
    const reqs = await db.collection('approval_requests').where('quoteId', '==', d.id).get().catch(() => ({ docs: [] }));
    for (const r of reqs.docs) { await r.ref.update({ quoteColl: 'bk_quotes' }); out.reqsPatched++; }
    await db.collection('bs_quotes').doc(d.id).delete();   // copy-first ordering: a crash mid-loop leaves a duplicate (re-run cleans it), never a loss
    out.moved++;
  }
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('all-quotes');
  return out;
};

// ── Service Worker ────────────────────────────────
// A new SW is installed in the background whenever CACHE_VER bumps. Rather than
// swapping code out from under a live session (silent mid-session breakage — H14),
// we let it sit "waiting" and prompt the user to reload — unless nobody's signed
// in yet (login screen), in which case there's no session to disrupt.
// No "update available" banner (owner preference). New versions apply silently
// at the login screen (no session to disrupt); mid-session, the new SW simply
// waits and activates on the next natural full load — the network-first strategy
// already serves fresh JS/CSS on navigation, so the user is never nagged and
// never interrupted by a forced mid-work reload.
let _swReloading = false; // set only when WE trigger a silent login-screen apply
function _atLoginScreen() {
  const s = document.getElementById('login-screen');
  return s && !s.classList.contains('hidden');
}
// Re-audit 2026-08-03 (item d) — "Mid-session: do nothing" above meant a
// long-lived kiosk session (up to the 10-day AUTO_LOGOUT_MS window, per
// firebase-config.js's LOCAL auth persistence) that never revisits the login
// screen NEVER got a chance to apply a waiting update — the ONLY apply path
// was gated behind _atLoginScreen(). This adds a small, non-blocking,
// dismissible pill for that case: tap to apply+reload now, or ignore and it
// still applies silently next time the login screen IS reached. Never
// auto-reloads on its own — same "never interrupt a mid-task user" intent the
// v14: mid-session SW-update PILL removed (owner: no update banner —
// silent updates, standing preference from commit c554c09). Updates apply
// silently on the next login-screen visit / reload; no mid-session prompt.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    // A new SW that finished installing before this page loaded is already waiting.
    if (reg.waiting && navigator.serviceWorker.controller) {
      if (_atLoginScreen()) {
        _swReloading = true;
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      // else mid-session: do nothing — the update applies silently at the next
      // login-screen visit / reload (owner preference: no update banner).
    }
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        // installed + already controlled → an UPDATE (not first install).
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          if (_atLoginScreen()) {
            _swReloading = true;
            newWorker.postMessage({ type: 'SKIP_WAITING' }); // silent apply, login only
          }
          // else mid-session: silent — applies at next login/reload (no banner).
        }
      });
    });
  }).catch(console.warn);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Reload only for OUR silent login-screen apply. A controllerchange we didn't
    // initiate (a waiting SW activating later, e.g. after other tabs close) must NOT
    // force-reload a user who may be mid-task.
    if (_swReloading) location.reload();
  });
}
