/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Type-B (Production / Weekly) self-service worker screens
   js/screens/worker.js

   WHO THIS IS FOR
   ----------------
   "Type B" = a Production-class employee, paid WEEKLY, who has a real
   Firebase Auth login (unlike the older HR-kiosk-only worker_profiles flow —
   see js/screens/hr.js openWorkerKioskModal — where the worker has no login
   at all and HR clocks them in from the office). Type B workers time
   themselves in/out from their own phone, with their location checked
   against admin-defined geofenced Work Sites (js/geo-core.js siteMatch) and
   a selfie captured on a valid Time In/Out.

   THE linkedUid BRIDGE (read this before changing any query here)
   ------------------------------------------------------------------
   The finance side of "Production, paid weekly" already exists and is fully
   built: worker_profiles (rate, CA balance, statutory IDs) + attendance_worker
   (hours) + payslips (weekly payslip docs, keyed by workerId ==
   worker_profiles docId) + payslipYtdWeekly/toPayslipModel('weekly') — all in
   hr.js, all keyed by the worker_profiles DOCUMENT ID, not by Firebase Auth
   uid (worker_profiles staff historically had no uid at all).
   worker_profiles already carries an optional `linkedUid` field (hr.js
   openHRProfileForm, "Linked Login Account (uid)") for exactly this case —
   and firestore.rules' attendance_worker/{workerId} comment explicitly
   anticipates it: "When WS27/WS20's worker_profiles.linkedUid lands, an
   additive owner-read clause can be added here without re-keying (workerId
   already == the worker_profiles docId)." THIS FILE is that landing.
   So: a Type-B self-service account = a `users` doc (payroll/{uid}.payClass
   === 'production', set via hr.js's Edit Payroll "Employee Type" selector)
   PLUS a worker_profiles doc whose `linkedUid` is that same uid (set via
   hr.js's HR Profile form). Every write in this file targets
   attendance_worker/{worker_profiles.id}/records/{date} — the SAME
   collection/doc shape openWorkerKioskModal already writes (workerId, date,
   timeIn, timeOut, hoursWorked, recordedBy, recordedByName, recordedAt) —
   plus the geofence/selfie fields this feature adds (inLat/inLng/
   inDistanceM/inSiteId/inSelfieUrl/inValid and the out* equivalents), and an
   `attempts` array logging every INVALID attempt for audit (never blocks a
   retry, just records it).
   If no worker_profiles doc has linkedUid pointing at the signed-in uid,
   renderWorkerHome shows an honest "ask HR to link your account" state — it
   never invents a profile or silently no-ops.

   ROUTING
   -------
   js/app.js's navigateTo() 'dashboard' case (not this file — see app.js)
   sends payClass:'production' users here instead of renderDashboard(). The
   NAV_REGISTRY 'workerB' bottom-nav variant (js/config.js) keeps their
   bottom bar to Home/Chat/Profile — this page IS their whole dashboard
   (clock card + calendar + finance), so nothing else is needed.

   MOBILE CAVEAT (documented, not verifiable headlessly — see report)
   --------------------------------------------------------------------
   _captureSelfie() opens the native camera/file picker via a synthetic
   <input type=file capture=user>.click() call. This runs after an `await`
   on the geolocation promise, so on some strict mobile browsers (notably
   iOS Safari, which time-boxes "user activation" after the triggering tap)
   the picker may occasionally fail to open if geolocation itself was slow.
   Trace this specific case on Neil's phone (see report) — if it reproduces,
   the fix is to request geolocation and file-picker permission in the SAME
   synchronous tap (a UX tradeoff: prompting the camera picker before we know
   the location is valid), which is out of scope to guess at blind.
═══════════════════════════════════════════════════ */

// ── Manila "HH:MM" helper (mirrors js/config.js bizDate/bizHour's
// Intl.DateTimeFormat-with-BIZ_TZ pattern) — feeds the SAME computeDayHours
// (js/screens/hr.js, bare global) the kiosk and payslip time-log already use,
// so hours math never drifts between self-service, kiosk, and manual entry.
function _workerBizTimeHM(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: window.BIZ_TZ, hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date || new Date());
  const h = (parts.find(p => p.type === 'hour') || {}).value || '00';
  const m = (parts.find(p => p.type === 'minute') || {}).value || '00';
  return `${h}:${m}`;
}

// ── Resolve the signed-in uid's linked worker_profiles doc (see file header
// re: the linkedUid bridge). Cached per-uid for the session — this rarely
// changes mid-session and every render of this page re-queries it otherwise. ──
let _workerProfileCache = null; // { uid, profile } | null
async function _resolveWorkerProfile(uid) {
  if (_workerProfileCache && _workerProfileCache.uid === uid) return _workerProfileCache.profile;
  const snap = await db.collection('worker_profiles').where('linkedUid', '==', uid).limit(1).get();
  const profile = snap.docs.length ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null;
  _workerProfileCache = { uid, profile };
  return profile;
}

// ── Selfie compression — ports js/chat.js _compressImage's canvas-downscale
// + toBlob(JPEG) APPROACH (not imported — chat.js's own copy is untouched),
// with this feature's own params per spec: ~1200px long edge, quality 0.8
// (chat.js uses 1600px/0.85 for its own use case; a face-only attendance
// selfie doesn't need that much resolution). Never rejects — an undecodable
// image still resolves with the original file so the upload proceeds rather
// than losing the Time In/Out attempt entirely (same fallback chat.js uses). ──
function _compressSelfie(file) {
  return new Promise(resolve => {
    if (!file || !/^image\//.test(file.type || '')) { resolve(file); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale); height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.8);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

// ── Geolocation, wrapped as a Promise with HONEST, specific error messages
// per failure mode (never a fake success — see the file header's rule).
// Accepts an options override (v14 P1 reliability fix — see
// _getPositionWithRetry below) so a first strict attempt can fall back to a
// relaxed one instead of failing outright on a cheap phone/weak signal. ──
function _getPosition(options) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: 'unsupported', message: 'This device/browser does not support location services.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => {
        const messages = {
          1: 'Location permission denied. Enable location access for this site in your phone settings, then try again.',
          2: 'Could not determine your location. Move to an open area (away from buildings/roofing) and try again.',
          3: 'Location request timed out. Try again.'
        };
        reject({ code: err.code, message: messages[err.code] || (err.message || 'Location failed.') });
      },
      options || { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

// ── One relaxed retry on POSITION_UNAVAILABLE (2) / TIMEOUT (3) — a cheap
// phone or a weak-signal spot can fail a strict high-accuracy request that a
// looser one (accept a slightly stale/coarser fix, wait longer) succeeds at.
// Never retries PERMISSION_DENIED (1) — that needs a settings change, not
// different GPS options, so retrying would just burn time before showing the
// same honest error. ──
async function _getPositionWithRetry() {
  try {
    return await _getPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  } catch (err) {
    if (err && (err.code === 2 || err.code === 3)) {
      return await _getPosition({ enableHighAccuracy: false, timeout: 20000, maximumAge: 30000 });
    }
    throw err;
  }
}

// ── Selfie capture — a fresh <input type=file accept=image/* capture=user>
// per call (no persistent DOM node). Resolves null (never throws) if the
// user cancels the native picker — the caller must treat null as "abort,
// write nothing", not as a failure to retry automatically.
//
// CANCEL-DETECTION HARDENING (was: single 'focus' event + flat 500ms) —
// neither 'focus' nor 'visibilitychange' is a reliable one-shot "user
// cancelled" signal: opening the native camera (or an intermediate
// Camera/Gallery chooser some Android skins show) can blur/refocus the
// window BEFORE a photo is taken, and loading a freshly-captured full-res
// JPEG/HEIC into input.files can itself take well over 500ms. Either case
// used to fire the old flat timer and discard a real photo as a "cancel"
// (the later 'change' became a silent no-op). Fix: widen the grace window
// to 2s AND re-arm it on every focus/visibility signal instead of
// committing on the first one — only if NEITHER fires again, nor does
// 'change', for a full 2s straight do we treat it as an actual cancel. ──
function _captureSelfie() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.capture = 'user';
    input.style.position = 'fixed'; input.style.left = '-9999px'; input.style.opacity = '0';
    document.body.appendChild(input);
    let settled = false;
    let graceTimer = null;
    const CANCEL_GRACE_MS = 2000;
    // v14 P1 reliability fix — a hard outer ceiling so this Promise can NEVER
    // hang forever (button stuck disabled) even in the pathological case
    // where neither 'change' nor a single focus/visibility signal ever fires
    // again (some in-app webviews / odd Android camera apps don't reliably
    // refocus the page). This is a backstop, not the normal path — the
    // focus/visibility grace timer above almost always resolves first.
    const HARD_TIMEOUT_MS = 3 * 60 * 1000;
    const hardTimer = setTimeout(() => finish(null), HARD_TIMEOUT_MS);
    const cleanupListeners = () => {
      window.removeEventListener('focus', onSignal);
      document.removeEventListener('visibilitychange', onSignal);
    };
    const finish = file => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      clearTimeout(hardTimer);
      cleanupListeners();
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => {
      finish(input.files && input.files[0] ? input.files[0] : null);
    });
    // No 'cancel' event exists for <input type=file>. Re-arm (don't commit)
    // on every focus/visibility return — an intermediate picker transition
    // just restarts the clock instead of instantly declaring a cancel.
    function onSignal() {
      if (settled) return;
      if (document && 'visibilityState' in document && document.visibilityState !== 'visible') {
        // v14 P1 fix — going hidden AGAIN (re-entering an intermediate
        // camera/gallery chooser, or the camera app itself regaining focus)
        // must CLEAR any grace timer a prior premature focus blip already
        // armed. Without this, that stale timer keeps ticking in the
        // background and can fire finish(null) — a false "cancel" — while
        // the worker is legitimately still in the camera taking the photo.
        // We only start counting toward "cancelled" once we're back AND stay
        // visible.
        if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
        return;
      }
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = setTimeout(() => finish(null), CANCEL_GRACE_MS);
    }
    window.addEventListener('focus', onSignal);
    document.addEventListener('visibilitychange', onSignal);
    input.click();
  });
}

// ── Shared 52px rounded/bordered selfie thumbnail markup — was duplicated
// inline across three render branches in _loadClockCard; one template now
// so a future sizing/style tweak is a one-line change instead of three. ──
function _selfieThumb(url, label) {
  if (!url) return '';
  return `<img src="${escHtml(url)}" alt="${escHtml(label)}" style="width:52px;height:52px;border-radius:10px;object-fit:cover;border:1px solid var(--border)"/>`;
}

// ── Resolve which attendance_worker day-doc is the ACTIVE one right now.
// Normally that's today, but a shift that started before midnight and has
// no timeOut yet is still open — Time Out (and the clock card's own state)
// must keep targeting THAT day's doc. Without this, window.bizDate() being
// recomputed fresh on every call meant Time In (11:50pm) and Time Out
// (12:10am) landed in TWO DIFFERENT day-docs: yesterday's doc stuck forever
// with timeIn/no timeOut, and today's doc getting a timeOut with no timeIn
// (computeDayHours(undefined, timeStr) => 0 hoursWorked). This also doubles
// as the double-Time-In guard: if _loadClockCard sees yesterday's shift is
// still open, it shows "TIME OUT" (not "TIME IN"), so a worker can't start a
// second concurrent shift while the first is unclosed. ──
async function _resolveActiveRecord(profileId) {
  const todayStr = window.bizDate();
  const base = db.collection('attendance_worker').doc(profileId).collection('records');
  const todayRef = base.doc(todayStr);
  // source:'server' — REQUIRED, and it must stay in lockstep with Firestore
  // offline persistence being enabled (js/firebase-config.js). These are the
  // only reads in the app where a read THROWING is load-bearing: the offline
  // punch queue detects offline from the rejection (_isNetworkish below), and
  // the double-Time-In guard documented above depends on seeing the SERVER's
  // record. With persistence on, a plain .get() offline resolves from cache
  // instead of rejecting — an empty or stale record — so the queue would never
  // arm and the guard would silently pass, letting a worker open a second
  // concurrent shift while the first is still unclosed. Pinning to the server
  // restores the pre-persistence behaviour on exactly this path: offline now
  // rejects with 'unavailable', which is what the existing queue already
  // handles. Both callers (_loadClockCard and the punch itself) want server
  // truth, so there is no path that wants the cached answer here.
  const todaySnap = await todayRef.get({ source: 'server' });
  const todayData = todaySnap.exists ? todaySnap.data() : null;
  if (todayData && todayData.timeIn && !todayData.timeOut) {
    return { dateStr: todayStr, ref: todayRef, data: todayData };
  }
  if (!todayData || !todayData.timeIn) {
    const yestStr = window.bizDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const yestRef = base.doc(yestStr);
    const yestSnap = await yestRef.get({ source: 'server' });   // same reason as todaySnap above
    const yestData = yestSnap.exists ? yestSnap.data() : null;
    if (yestData && yestData.timeIn && !yestData.timeOut) {
      return { dateStr: yestStr, ref: yestRef, data: yestData };
    }
  }
  return { dateStr: todayStr, ref: todayRef, data: todayData || {} };
}

// ── Minutes elapsed since an "HH:MM" time-in on a given Manila dateStr,
// vs. right now. Used only for the min-shift-length confirmation guard on
// Time Out — never blocks, just asks. ──
function _minutesSince(timeHM, dateStr) {
  if (!timeHM || !dateStr) return null;
  const then = new Date(`${dateStr}T${timeHM}:00+08:00`);
  if (isNaN(then.getTime())) return null;
  return (Date.now() - then.getTime()) / 60000;
}

// ── The Time In/Out card ─────────────────────────────────────────────────
async function _loadClockCard(profile) {
  const el = document.getElementById('wb-clock-card');
  if (!el) return;
  el.innerHTML = window.skeletonHtml('rows');
  let rec = {};
  try {
    const active = await _resolveActiveRecord(profile.id);
    rec = active.data || {};
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body"><div class="empty-state">
      <div class="empty-icon">${emojiIcon('⚠️', 44)}</div><h4>Could not load today's attendance</h4>
      <p style="font-size:12px;color:var(--text-muted)">${escHtml(err.message || String(err))}</p>
      <button type="button" class="btn-secondary btn-sm" id="wb-clock-retry" style="margin-top:10px">Retry</button>
    </div></div></div>`;
    document.getElementById('wb-clock-retry')?.addEventListener('click', () => _loadClockCard(profile));
    return;
  }

  const hasIn = !!(rec.timeIn && rec.inValid);
  const hasOut = !!(rec.timeOut && rec.outValid);
  const attempts = Array.isArray(rec.attempts) ? rec.attempts : [];
  const lastInvalid = !hasIn && attempts.length ? attempts[attempts.length - 1] : null;
  // v14 P1 offline-queue fix — a punch that cleared geofence+selfie but is
  // sitting in the local IndexedDB queue (see _queuePunch/_pqReplayAll) has an
  // advisory `pendingPunch` marker on this doc but has NOT yet set
  // timeIn/timeOut (that's function-only, applied when the queue replays).
  // Without this, the clock card would show the plain "not timed in"/"timed
  // in" state and its normal action button WHILE a punch of that exact kind
  // is already in flight — inviting a duplicate Time In/Out tap. ──
  const pendingKind = rec.pendingPunch && rec.pendingPunch.kind;
  const pendingQueuedIn = pendingKind === 'in' && !hasIn;
  const pendingQueuedOut = pendingKind === 'out' && hasIn && !hasOut;

  const badge = hasOut ? `<span class="badge badge-green">Timed Out</span>`
    : pendingQueuedOut ? `<span class="badge badge-orange">Syncing…</span>`
    : hasIn ? `<span class="badge badge-orange">Timed In</span>`
    : pendingQueuedIn ? `<span class="badge badge-gray">Syncing…</span>`
    : `<span class="badge badge-gray">Not Timed In</span>`;

  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>Today <span style="font-size:12px;font-weight:400;color:var(--text-muted)">${new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}</span></h3>
        ${badge}
      </div>
      <div class="card-body">
        ${lastInvalid ? `<div style="background:rgba(255,69,58,.08);border:1px solid rgba(255,69,58,.25);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--danger)">
          ${emojiIcon('⚠️', 14)} Last attempt was ${lastInvalid.distanceM != null ? `${lastInvalid.distanceM}m outside range` : 'outside range'} — move closer to the work site and try again.
        </div>` : ''}
        ${hasOut ? `
          <div style="display:flex;gap:12px;align-items:center">
            <div style="display:flex;gap:6px">
              ${_selfieThumb(rec.inSelfieUrl, 'Time In selfie')}
              ${_selfieThumb(rec.outSelfieUrl, 'Time Out selfie')}
            </div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--success)">${emojiIcon('✅', 16)} Done for today</div>
              <div style="font-size:12px;color:var(--text-muted)">In ${escHtml(rec.timeIn || '—')} · Out ${escHtml(rec.timeOut || '—')} · ${(rec.hoursWorked || 0).toFixed(1)}h logged</div>
            </div>
          </div>`
        : pendingQueuedOut ? `
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">
            ${_selfieThumb(rec.inSelfieUrl, 'Time In selfie')}
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--warning)">Timed in at ${escHtml(rec.timeIn || '—')}</div>
              <div style="font-size:11px;color:var(--text-muted)">${emojiIcon('🔄', 12)} Time Out queued — will submit automatically once you're back online.</div>
            </div>
          </div>`
        : hasIn ? `
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">
            ${_selfieThumb(rec.inSelfieUrl, 'Time In selfie')}
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--warning)">Timed in at ${escHtml(rec.timeIn || '—')}</div>
              <div style="font-size:11px;color:var(--text-muted)">${rec.inDistanceM != null ? `${rec.inDistanceM}m from site` : ''}</div>
            </div>
          </div>
          <button class="btn-primary" id="wb-timeout-btn" style="width:100%;font-size:16px;padding:16px">
            <i data-lucide="log-out" style="width:16px;margin-right:8px;vertical-align:-3px"></i>TIME OUT
          </button>`
        : pendingQueuedIn ? `
          <p style="font-size:13px;color:var(--text-muted)">${emojiIcon('🔄', 14)} Time In queued — will submit automatically once you're back online.</p>`
        : `
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Tap Time In — we'll check you're on-site, then open the camera for a quick selfie.</p>
          <button class="btn-primary" id="wb-timein-btn" style="width:100%;font-size:16px;padding:16px">
            <i data-lucide="log-in" style="width:16px;margin-right:8px;vertical-align:-3px"></i>TIME IN
          </button>`}
        <div id="wb-clock-status" style="font-size:12px;color:var(--text-muted);margin-top:10px;min-height:16px"></div>
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [el] });
  document.getElementById('wb-timein-btn')?.addEventListener('click', () => _handleClock('in', profile));
  document.getElementById('wb-timeout-btn')?.addEventListener('click', () => _handleClock('out', profile));
}

// ── Config (v14 P0/P1 attendance remediation) ───────────────────────────────
// > this many hours on an unclosed shift → confirm before Time Out (never
// auto-stamp "now"), and the server independently flags needsReview too (see
// functions/index.js recordAttendancePunch — this is a UX nicety on top of a
// server-enforced guarantee, not the safety mechanism itself).
const WB_MAX_SHIFT_HOURS = 16;

// v14 P1.x offline-punch-time fix (OFFLINE-PUNCH-SPEC.md) — the server now
// honors a queued replay's true on-site instant (queuedPunchAt) and records
// AT that time, not at replay time — so this is no longer a "your time got
// recorded wrong" threshold. It's purely toast-verbosity: below it, ordinary
// reconnect/upload latency is assumed and the worker just sees the plain
// "submitted" toast; at or above it (a real offline stretch), _pqReplayAll
// shows the fuller "synced N min late — recorded at your real on-site time,
// flagged for HR review" toast instead, since that's worth calling out even
// though the record itself is already correct.
const WB_QUEUE_LATE_SYNC_MIN = 2;

// ── Offline punch queue (v14 P1 reliability fix) ────────────────────────────
// A punch that clears the geofence + selfie steps but then can't reach the
// network (selfie upload or the recordAttendancePunch callable, see below)
// must never just be LOST — the worker already stood on-site and took the
// photo; the app owes them a durable "this still counts" receipt. Stored as a
// raw IndexedDB record — a captured selfie Blob can't round-trip through
// localStorage/JSON — keyed by an auto id, and replayed (upload if needed,
// then call the callable) on the next 'online' event or the next time this
// screen loads. Deliberately simple: replay always re-attempts the callable
// from scratch; it never trusts a maybe-partial prior attempt.
//
// PENDING-PUNCH SHAPE (IndexedDB, db 'bi-attendance-queue', store
// 'pending-punches', keyPath 'id' autoIncrement) — kept here so a future
// change to this shape has one obvious place to update both writer+reader:
//   { id, profileId, kind:'in'|'out', recordDateStr:'YYYY-MM-DD',
//     lat, lng, accuracy,
//     selfieBlob: Blob|null,   // set when the selfie was never uploaded
//     selfieUrl: string|null,  // set when upload succeeded but the callable
//                              // call itself then failed (don't re-upload)
//     queuedAt: <Date.now() ms> }  // the REAL on-site punch instant — captured
//     the moment this item is queued (right after geofence+selfie cleared),
//     NOT when it later replays. _pqReplayAll below is the only reader that
//     matters for pay accuracy: it must treat this as the punch's true time,
//     never let the replay's own "now" stand in for it silently.
const WB_PQ_DB_NAME = 'bi-attendance-queue';
const WB_PQ_STORE = 'pending-punches';

function _pqOpenDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB not supported')); return; }
    const req = indexedDB.open(WB_PQ_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const dbc = req.result;
      if (!dbc.objectStoreNames.contains(WB_PQ_STORE)) {
        dbc.createObjectStore(WB_PQ_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}
function _pqAdd(record) {
  return _pqOpenDb().then(dbc => new Promise((resolve, reject) => {
    const tx = dbc.transaction(WB_PQ_STORE, 'readwrite');
    tx.objectStore(WB_PQ_STORE).add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function _pqGetAll() {
  return _pqOpenDb().then(dbc => new Promise((resolve, reject) => {
    const tx = dbc.transaction(WB_PQ_STORE, 'readonly');
    const req = tx.objectStore(WB_PQ_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}
function _pqDelete(id) {
  return _pqOpenDb().then(dbc => new Promise((resolve, reject) => {
    const tx = dbc.transaction(WB_PQ_STORE, 'readwrite');
    tx.objectStore(WB_PQ_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

// Persist a punch the network couldn't take right now. Also best-effort
// stamps an advisory `pendingPunch` marker on the day-doc (never inValid/
// outValid/timeIn/timeOut/hoursWorked — those stay function-only per the
// tightened firestore.rules this ships alongside) purely so the worker/HR see
// "queued, not yet synced" if they look at the record before it replays.
async function _queuePunch({ profile, kind, recordDateStr, pos, blob, selfieUrl }) {
  const record = {
    profileId: profile.id, kind, recordDateStr,
    lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy,
    selfieBlob: blob || null, selfieUrl: selfieUrl || null,
    queuedAt: Date.now()
  };
  await _pqAdd(record);
  db.collection('attendance_worker').doc(profile.id).collection('records').doc(recordDateStr)
    .set({
      workerId: profile.id, date: recordDateStr, recordedBy: currentUser.uid,
      pendingPunch: { kind, queuedAt: record.queuedAt }
    }, { merge: true }).catch(() => {});
}

// Does this error look like a connectivity problem worth queueing for later,
// rather than a real rejection (bad input, permission, invalid geofence,
// etc.)? Queueing THOSE would just silently fail forever on every replay, so
// this is a conservative allowlist, not a catch-all. ──
function _isNetworkish(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const code = String((err && err.code) || '');
  const msg = String((err && err.message) || '');
  return /unavailable|deadline-exceeded|retry-limit-exceeded|network/i.test(code)
    || /network|offline|failed to fetch/i.test(msg);
}

// v14 P1.x offline-punch-time fix (OFFLINE-PUNCH-SPEC.md §3.3) — is this a
// PERMANENT rejection (the server will never accept this exact item, no
// matter how many times it's retried — e.g. already-recorded, shift-already-
// open, queued-punch-too-old, or a plain bad-input error) as opposed to a
// TRANSIENT one (connectivity, an unauthenticated blip, a server hiccup)?
// Retrying a permanent rejection forever is the poison-pill bug this fixes —
// see _pqReplayAll's catch block. 'unauthenticated', 'internal',
// 'unavailable', 'deadline-exceeded', 'resource-exhausted' are deliberately
// NOT in this list — those are transient.
function _pqIsPermanentRejection(err) {
  const code = String((err && err.code) || '').replace(/^functions\//, '');
  return !_isNetworkish(err) && [
    'invalid-argument', 'failed-precondition', 'permission-denied',
    'not-found', 'already-exists', 'out-of-range'
  ].includes(code);
}

let _wbLastProfile = null; // refreshed on every _loadClockCard call — lets the
// 'online' reconnect handler repaint the clock card without needing a profile
// argument threaded through a global event listener.
let _wbOnlineListenerAttached = false;

// Replay every queued punch once we're back online: re-upload the selfie if
// it wasn't already, call the SAME callable a live punch would, and drop the
// queue entry once the server has actually accepted OR permanently rejected
// it (see _pqIsPermanentRejection / §3.3 below) — a punch left queued forever
// on a rejection the server will never accept is a poison pill, not safety.
//
// v14 P1.x offline-punch-TIME fix (money-affecting — see OFFLINE-PUNCH-
// SPEC.md for the full server+client contract) — THE BUG: recordAttendance-
// Punch (functions/index.js) used to be the SOLE writer of timeIn/timeOut/
// hoursWorked and always stamped admin.firestore.Timestamp.now() — i.e. the
// instant the callable RUNS. For a live (online) punch that's the same
// instant as the on-site tap, so it's correct. But for a QUEUED punch
// replayed from here, "the instant the callable runs" used to be the instant
// connectivity came back and this loop got to it — which can be minutes or
// hours after the worker actually stood on-site (item.queuedAt, captured in
// _queuePunch at punch time — see the PENDING-PUNCH SHAPE comment above).
//
// THE FIX: item.queuedAt (the true on-site instant) is sent through as
// `queuedPunchAt` below, and the server now HONORS it under the strict trust
// contract in OFFLINE-PUNCH-SPEC.md — records at the claimed on-site time
// (clamped to server-now if it would be a future time, discarded in favor of
// server-now if malformed/implausible, hard-rejected only if >48h old), and
// ALWAYS forces needsReview:true plus its own server-written `attempts` audit
// entry on the record (functions/index.js recordAttendancePunch §1.7) — that
// server entry is now the authoritative note; this file no longer writes its
// own competing one for a successful replay (see the late-sync branch below).
// What this file still owns: (a) telling the worker plainly that a late sync
// was recorded at their real on-site time and flagged for review, and (b) on
// a REJECTED replay, the client-side attempts note + queue drop (§3.3).
async function _pqReplayAll() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  let items = [];
  try { items = await _pqGetAll(); } catch (err) { return; }
  if (!items.length) return;
  let anyDone = false;
  for (const item of items) {
    try {
      let selfieUrl = item.selfieUrl;
      if (!selfieUrl) {
        const path = `attendance-selfies/${currentUser.uid}/${item.recordDateStr}-${item.kind}-${item.queuedAt}.jpg`;
        const sref = storage.ref(path);
        await sref.put(item.selfieBlob, { contentType: 'image/jpeg', customMetadata: { uploadedBy: currentUser.uid, queued: 'true' } });
        selfieUrl = await sref.getDownloadURL();
      }
      const res = await firebase.functions().httpsCallable('recordAttendancePunch')({
        kind: item.kind, lat: item.lat, lng: item.lng, accuracy: item.accuracy,
        selfieUrl, recordDate: item.recordDateStr,
        // The REAL on-site punch instant (see PENDING-PUNCH SHAPE above).
        // The server honors this under the OFFLINE-PUNCH-SPEC.md contract
        // (functions/index.js recordAttendancePunch) — no payload change
        // needed here, this field was already being sent.
        queuedPunchAt: item.queuedAt
      });
      const replayedAtMs = Date.now();
      await _pqDelete(item.id);
      anyDone = true;

      // v14 P1.x offline-punch-time fix — pendingPunch cleanup on date drift
      // (OFFLINE-PUNCH-SPEC §3.2). The advisory marker _queuePunch wrote
      // lives on item.recordDateStr's doc, but the server may have targeted
      // a DIFFERENT (earlier) effective day — e.g. a punch queued 23:50 whose
      // effective day is the prior Manila day. The server only clears
      // pendingPunch on the doc it actually writes to, so without this the
      // originally-queued day's clock card would show "Syncing…" forever.
      // Best-effort: never blocks the toast/UI refresh below.
      const recordedDate = (res && res.data && res.data.recordedDate) || item.recordDateStr;
      if (recordedDate !== item.recordDateStr) {
        db.collection('attendance_worker').doc(item.profileId).collection('records').doc(item.recordDateStr)
          .set({ pendingPunch: firebase.firestore.FieldValue.delete() }, { merge: true }).catch(() => {});
      }

      const delayMin = Math.round((replayedAtMs - item.queuedAt) / 60000);
      const kindLabel = item.kind === 'in' ? 'In' : 'Out';
      if (delayMin >= WB_QUEUE_LATE_SYNC_MIN) {
        // Late sync. The server now honors queuedPunchAt (OFFLINE-PUNCH-
        // SPEC.md) — the time recorded IS the real on-site time, not the
        // sync time, and it's already flagged needsReview server-side with
        // its own audit entry. This toast is reassurance + a review-flag
        // notice, not a "your time got recorded wrong" warning (that used to
        // be true before the server honored this field — it no longer is).
        const onSiteTimeStr = _workerBizTimeHM(new Date(item.queuedAt));
        const lagMin = (res && res.data && res.data.lagMin != null) ? res.data.lagMin : delayMin;
        if (res && res.data && res.data.claimDegraded) {
          // The server couldn't trust the claimed instant (malformed device
          // clock, or a claim too far in the future) and recorded at
          // server-now instead — still flagged for review, but there is no
          // meaningful "on-site time" to show.
          const syncedTimeStr = res.data.timeStr || _workerBizTimeHM(new Date(replayedAtMs));
          Notifs.showToast(
            `Time ${kindLabel} synced, but its original time could not be verified — recorded at ${syncedTimeStr} and flagged for HR review.`,
            'info'
          );
        } else {
          Notifs.showToast(
            `Time ${kindLabel} from ${recordedDate}: synced ${lagMin} min late — recorded at your real on-site time ${onSiteTimeStr} and flagged for HR review.`,
            'info'
          );
        }
        // No client-side `attempts` write here anymore — the server's own
        // audit entry (functions/index.js recordAttendancePunch §1.7) is now
        // the authoritative note; a client copy would duplicate/contradict it.
      } else {
        Notifs.showToast(`Queued Time ${kindLabel} from ${item.recordDateStr} submitted.`, 'success');
      }
    } catch (err) {
      console.warn('[worker] queued punch replay failed:', err && err.message);
      if (_pqIsPermanentRejection(err)) {
        // Permanent rejection (OFFLINE-PUNCH-SPEC §3.3) — e.g. already-
        // recorded, shift-already-open, queued-punch-too-old. The server
        // will NEVER accept this exact item no matter how many times it's
        // retried, so leaving it queued is a poison pill that blocks every
        // later item from this worker forever. Drop it, leave a durable
        // client-side audit note (the server never got far enough to write
        // its own), and keep going — a dropped duplicate 'in' must not block
        // its paired 'out' from closing the real shift.
        await _pqDelete(item.id).catch(() => {});
        const onSitePunchTime = _workerBizTimeHM(new Date(item.queuedAt));
        db.collection('attendance_worker').doc(item.profileId).collection('records').doc(item.recordDateStr)
          .set({
            workerId: item.profileId, date: item.recordDateStr, recordedBy: currentUser.uid,
            attempts: firebase.firestore.FieldValue.arrayUnion({
              kind: item.kind, valid: false, queuedReplay: true,
              rejectedCode: String((err && err.code) || 'unknown'),
              rejectedMessage: String((err && err.message) || '').slice(0, 200),
              onSitePunchTime,
              atClient: new Date().toISOString()
            })
          }, { merge: true }).catch(() => {});
        Notifs.showToast(
          `Queued Time ${item.kind === 'in' ? 'In' : 'Out'} from ${item.recordDateStr} could not be submitted: ${(err && err.message) || 'rejected by server'}`,
          'error'
        );
        continue;
      }
      // Transient failure (offline again, server hiccup, auth blip) — STOP
      // the whole loop here rather than skipping ahead to the next item.
      // FIFO pairing is only safe if the loop halts at the first transient
      // failure: skipping ahead could replay an 'out' before its still-
      // queued 'in', which the server would then permanently reject
      // (no-open-shift). Left in the queue — retried on the next 'online'
      // event / page load.
      break;
    }
  }
  if (anyDone && _wbLastProfile) _loadClockCard(_wbLastProfile);
}

function _wbAttachOnlineListener() {
  if (_wbOnlineListenerAttached) return;
  _wbOnlineListenerAttached = true;
  window.addEventListener('online', () => _pqReplayAll());
}

// ── The Time In / Time Out flow: geolocation → geofence check → (blocking
// OUTSIDE result, OR selfie capture → compress → upload → server-verified
// write). See functions/index.js recordAttendancePunch — that callable, not
// this file, is now the sole writer of inValid/outValid/timeIn/timeOut/
// hoursWorked (P0 fix: those were previously entirely client-asserted). ──
async function _handleClock(kind, profile) {
  const btn = document.getElementById(kind === 'in' ? 'wb-timein-btn' : 'wb-timeout-btn');
  const statusEl = document.getElementById('wb-clock-status');
  const setStatus = (msg, isErr) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isErr ? 'var(--danger)' : 'var(--text-muted)';
  };
  if (btn) btn.disabled = true;
  _wbLastProfile = profile;
  _wbAttachOnlineListener();

  // ── 0. Kick off the selfie picker SYNCHRONOUSLY, in the SAME tap that
  // triggered this handler — before ANY `await` (geolocation, Firestore
  // reads, …) burns the browser's brief "recent user activation" window. On
  // some mobile browsers, opening a native camera/file picker after that
  // window lapses silently fails, which used to leave _captureSelfie()
  // hanging with the button stuck disabled (see file header). Accepted
  // tradeoff: the picker can appear before we know the worker is even inside
  // a geofence — harmless, since the captured file is simply discarded if the
  // geofence check below fails first (never uploaded, never written). ──
  const selfiePromise = _captureSelfie();
  selfiePromise.catch(() => {}); // _captureSelfie never rejects; guard anyway.

  // ── 0b. Resolve which day-doc this action targets. Time In always starts a
  // fresh shift dated today. Time Out must close whichever shift is still
  // OPEN — today's, or (a shift that crossed midnight) yesterday's — via
  // _resolveActiveRecord, or the Manila-day boundary silently splits one
  // shift into two broken records (see that function's header). ──
  const todayStr = window.bizDate();
  let recordDateStr = todayStr;
  let ref = db.collection('attendance_worker').doc(profile.id).collection('records').doc(todayStr);
  let curData = null;
  if (kind === 'out') {
    try {
      const active = await _resolveActiveRecord(profile.id);
      recordDateStr = active.dateStr;
      ref = active.ref;
      curData = active.data;
    } catch (err) {
      // Best-effort — fall back to today's doc rather than crashing the
      // whole Time Out flow; the server call re-resolves this itself anyway.
    }
    // ── Minimum-shift-length guard — an accidental double-tap of Time Out
    // seconds after Time In shouldn't silently record a near-zero-hour shift
    // with no confirmation. Never blocks, only asks. ──
    if (curData && curData.timeIn) {
      const elapsedMin = _minutesSince(curData.timeIn, recordDateStr);
      if (elapsedMin != null && elapsedMin >= 0 && elapsedMin < 2) {
        const proceed = await window.confirmDialog({
          title: 'Time Out so soon?',
          message: `You timed in at ${curData.timeIn} — that's only ${Math.max(0, Math.round(elapsedMin))} min ago. Time Out now?`,
          confirmLabel: 'Time Out anyway', cancelLabel: 'Not yet'
        });
        if (!proceed) { if (btn) btn.disabled = false; setStatus(''); return; }
      } else if (elapsedMin != null && elapsedMin >= WB_MAX_SHIFT_HOURS * 60) {
        // ── v14 P0 fix (CRITICAL #4) — a shift left open this long is very
        // likely a forgotten clock-out (see file header: this used to
        // silently auto-stamp "now" under a misleadingly-normal "Today"
        // header, booking ~22-24h). NEVER auto-stamp — force an explicit
        // confirm, and let the server (which independently re-derives
        // hoursWorked from its own immutable timestamps and applies this same
        // threshold) stamp needsReview:true so HR's kiosk hours view surfaces
        // it before it reaches payroll un-checked. ──
        const hoursAgo = (elapsedMin / 60).toFixed(1);
        const proceed = await window.confirmDialog({
          title: 'Very long shift — confirm Time Out',
          message: `You timed in at ${curData.timeIn} (${recordDateStr}) — that's about ${hoursAgo} hours ago.\n\nIf that's not right, DON'T tap Time Out — leave this open and ask HR/Finance to correct your record directly.\n\nTiming out now will record this as an unusually long shift and flag it for HR review before it's paid.`,
          confirmLabel: 'Time Out now (flag for review)', cancelLabel: "Don't time out"
        });
        if (!proceed) {
          setStatus("Left open — ask HR/Finance to correct this shift's times.", true);
          if (btn) btn.disabled = false;
          return;
        }
      }
    }
  }

  // ── 1. Location (one relaxed retry on POSITION_UNAVAILABLE/TIMEOUT) ──
  setStatus('Getting your location…');
  let pos;
  try { pos = await _getPositionWithRetry(); }
  catch (err) {
    setStatus(err.message, true);
    Notifs.showToast(err.message, 'error');
    if (btn) btn.disabled = false;
    return;
  }

  // ── 1b. GPS accuracy floor (v14 P1 fix) — a fix this coarse is too
  // unreliable to gate a geofence on at all, regardless of distance. ──
  const accuracyFloor = window.GEO_ACCURACY_FLOOR_M || 100;
  if (!Number.isFinite(pos.accuracy) || pos.accuracy > accuracyFloor) {
    const msg = `GPS reading too weak (±${Math.round(pos.accuracy || 0)}m) — move to open air (away from buildings/roofing) and try again.`;
    setStatus(msg, true);
    Notifs.showToast(msg, 'error');
    if (btn) btn.disabled = false;
    return;
  }

  // ── 2. Active Work Sites — short session cache (60s) via the app's own
  // dbCachedGet convention (js/config.js) so a worker who needs several
  // retries to get inside a tight radius isn't re-querying this mostly-static
  // collection from scratch every attempt. Position itself is intentionally
  // NEVER cached — re-requesting fresh GPS on every attempt is the whole
  // point of a retry (the worker may have physically moved closer), and
  // caching a geofence-gating position would defeat the check's purpose. ──
  let sites = [];
  try {
    const sitesSnap = window.dbCachedGet
      ? await window.dbCachedGet('geo_sites-active', () => db.collection('geo_sites').where('active', '==', true).get(), 60000)
      : await db.collection('geo_sites').where('active', '==', true).get();
    sites = sitesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    setStatus('Could not load work sites — check your connection and try again.', true);
    Notifs.showToast('Could not load work sites: ' + (err.message || err), 'error');
    if (btn) btn.disabled = false;
    return;
  }
  if (!sites.length) {
    setStatus('No work sites are configured yet — ask HR/Admin to add one.', true);
    Notifs.showToast('No work sites configured.', 'error');
    if (btn) btn.disabled = false;
    return;
  }

  // ── 3. Geofence check (js/geo-core.js — now accuracy-aware, see that
  // file's header). This is a fast client-side UX gate only; the server call
  // in step 5 independently RECOMPUTES this exact check and is the one that
  // actually decides validity — see functions/index.js recordAttendancePunch. ──
  const match = window.siteMatch(pos, sites);

  if (!match.inRange) {
    const nearest = match.nearest;
    const msg = nearest
      ? `You are ${Math.round(nearest.distanceM)}m from ${nearest.name} — move within range and try again.`
      : `You're not within range of any active work site.`;
    setStatus(msg, true);
    Notifs.showToast(msg, 'error');
    // Audit trail only — best-effort (a denied/offline write here must never
    // block the worker from retrying; it just means this one attempt isn't
    // logged). Never writes timeIn/timeOut/inValid/outValid/hoursWorked —
    // those are function-only fields per the tightened firestore.rules this
    // ships alongside (see report).
    ref.set({
      workerId: profile.id, date: recordDateStr,
      // v14 attendance fix — own the day-doc from the FIRST tap, even when this
      // attempt is out-of-range. Without recordedBy here the audit shell has no
      // owner, so the later in-range Time In (an UPDATE) is denied by the rule's
      // `resource.data.recordedBy == uid` anti-clobber clause — permanently
      // bricking an honest worker's real punch on the exact flaky-GPS / tight-
      // radius case this app runs in (they'd show Absent for a day they worked).
      recordedBy: currentUser.uid,
      attempts: firebase.firestore.FieldValue.arrayUnion({
        kind, lat: pos.lat, lng: pos.lng,
        accuracyM: Math.round(pos.accuracy || 0),
        distanceM: nearest ? Math.round(nearest.distanceM) : null,
        siteId: nearest ? nearest.siteId : null,
        valid: false, atClient: new Date().toISOString()
      })
    }, { merge: true }).catch(() => {});
    if (btn) btn.disabled = false;
    return;
  }

  // ── 4. Selfie — await the picker we already opened back in step 0. ──
  setStatus('Location verified — finishing selfie…');
  const file = await selfiePromise;
  if (!file) {
    setStatus(`Selfie was cancelled — Time ${kind === 'in' ? 'In' : 'Out'} was NOT recorded.`, true);
    if (btn) btn.disabled = false;
    return;
  }

  await _finishClockSubmission({ kind, profile, ref, recordDateStr, pos, match, file, btn, statusEl, setStatus });
}

// ── Compress → upload (with progress + Cancel) → call the server-verified
// recordAttendancePunch callable (js/functions/index.js) → success, OR queue
// for later on a network-flavored failure, OR offer a same-position "Retake
// selfie" retry on any other upload failure. Split out from _handleClock so a
// retake can re-enter here directly with a freshly-captured file WITHOUT
// re-running geolocation/geofence — reuses ctx.pos/ctx.match as-is. ──
async function _finishClockSubmission(ctx) {
  const { kind, profile, ref, recordDateStr, pos, match, file, btn, statusEl, setStatus } = ctx;

  setStatus('Compressing photo…');
  const blob = await _compressSelfie(file);

  // Already known offline — skip the network attempt entirely and queue
  // straight away rather than waiting out a doomed upload first.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    try {
      await _queuePunch({ profile, kind, recordDateStr, pos, blob });
      setStatus("Saved — you're offline. Will submit automatically once you're back online.", false);
      Notifs.showToast(`Time ${kind === 'in' ? 'In' : 'Out'} saved — will submit automatically once you're back online.`, 'info');
    } catch (err) {
      setStatus('Could not save this punch — try again once you have a connection.', true);
      Notifs.showToast('Could not queue this punch: ' + (err.message || err), 'error');
    }
    if (btn) btn.disabled = false;
    return;
  }

  // v14 attendance fix — unique filename per attempt (Date.now() suffix only,
  // never day-keying). Workers have create-only (admin-only update) on this
  // Storage path; a fixed name meant a partial retry after an upload landed
  // but the later write failed turned every retry into a denied UPDATE.
  const path = `attendance-selfies/${currentUser.uid}/${recordDateStr}-${kind}-${Date.now()}.jpg`;
  let selfieUrl;
  try {
    selfieUrl = await _uploadSelfieAndGetUrl(path, blob, statusEl);
  } catch (err) {
    if (err && err.cancelledByUser) {
      setStatus('Upload cancelled.', true);
      _offerRetake(ctx);
      if (btn) btn.disabled = false;
      return;
    }
    if (_isNetworkish(err)) {
      try {
        await _queuePunch({ profile, kind, recordDateStr, pos, blob });
        setStatus("Saved — you're offline. Will submit automatically once you're back online.", false);
        Notifs.showToast(`Time ${kind === 'in' ? 'In' : 'Out'} saved — will submit automatically once you're back online.`, 'info');
      } catch (qErr) {
        setStatus('Could not save this punch — try again once you have a connection.', true);
        Notifs.showToast('Could not queue this punch: ' + (qErr.message || qErr), 'error');
      }
      if (btn) btn.disabled = false;
      return;
    }
    const msg = _friendlyStorageError(err);
    setStatus(`Selfie upload failed — Time ${kind === 'in' ? 'In' : 'Out'} was NOT recorded: ${msg}`, true);
    Notifs.showToast('Selfie upload failed: ' + msg, 'error');
    _offerRetake(ctx);
    if (btn) btn.disabled = false;
    return;
  }

  // ── 5. Server-verified write. recordAttendancePunch (functions/index.js)
  // recomputes the geofence, re-checks GPS accuracy, bounds the record to the
  // server's own Manila-day, derives hoursWorked from immutable server
  // timestamps, and is the SOLE writer of inValid/outValid/timeIn/timeOut/
  // hoursWorked. This replaces the old direct client `ref.set(...)` write
  // entirely — see file header and the P0 report for why. ──
  setStatus('Saving…');
  try {
    // NEVER send queuedPunchAt here — live punches are server-stamped; the
    // field is exclusively for _pqReplayAll's queued replays (see
    // OFFLINE-PUNCH-SPEC.md).
    const res = await firebase.functions().httpsCallable('recordAttendancePunch')({
      kind, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy,
      selfieUrl, recordDate: recordDateStr
    });
    const timeStr = (res && res.data && res.data.timeStr) || _workerBizTimeHM();
    Notifs.success((kind === 'in' ? '✅ ' : '👋 ') + ((res && res.data && res.data.message) ||
      (kind === 'in' ? `Timed in at ${timeStr} — ${match.nearest.name}` : `Timed out at ${timeStr}`)));
    _loadClockCard(profile);
  } catch (err) {
    if (_isNetworkish(err)) {
      // Selfie already uploaded — queue with the URL we already have so
      // replay never re-uploads a duplicate image.
      try {
        await _queuePunch({ profile, kind, recordDateStr, pos, selfieUrl });
        setStatus("Saved — you're offline. Will submit automatically once you're back online.", false);
        Notifs.showToast(`Time ${kind === 'in' ? 'In' : 'Out'} saved — will submit automatically once you're back online.`, 'info');
      } catch (qErr) {
        setStatus('Could not save this punch — try again once you have a connection.', true);
        Notifs.showToast('Could not queue this punch: ' + (qErr.message || qErr), 'error');
      }
      if (btn) btn.disabled = false;
      return;
    }
    const msg = (err && err.message) || 'Could not save this punch — try again.';
    setStatus(`Could not save Time ${kind === 'in' ? 'In' : 'Out'}: ${msg}`, true);
    Notifs.showToast(`Time ${kind === 'in' ? 'In' : 'Out'} failed to save: ` + msg, 'error');
    if (btn) btn.disabled = false;
    return;
  }
}

// Upload with visible progress + a Cancel control (v14 P1 fix — the old
// `await sref.put(...)` had no timeout override and no way to tell if it was
// working or stuck; the Storage default retry window is ~10 minutes). Resolves
// the download URL, or rejects with `.cancelledByUser` set if the worker
// tapped Cancel (distinct from a real failure — see _finishClockSubmission). ──
function _uploadSelfieAndGetUrl(path, blob, statusEl) {
  return new Promise((resolve, reject) => {
    const sref = storage.ref(path);
    // Force image/jpeg regardless of the source blob's own reported type —
    // _compressSelfie's undecodable-image fallback can resolve with the
    // original captured file, whose MIME can come back empty/
    // application/octet-stream on some odd Android capture paths. Without an
    // explicit contentType override here, storage.rules' isValidImage()
    // (`contentType.matches('image/.*')`) would deny that upload outright.
    const task = sref.put(blob, { contentType: 'image/jpeg', customMetadata: { uploadedBy: currentUser.uid } });
    if (statusEl) {
      statusEl.innerHTML = `<span id="wb-upload-pct">Uploading selfie…</span> <button type="button" id="wb-upload-cancel" class="btn-secondary btn-sm" style="margin-left:8px;padding:2px 8px;font-size:11px">Cancel</button>`;
      const cancelBtn = document.getElementById('wb-upload-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', () => task.cancel());
    }
    task.on('state_changed', snap => {
      const pctEl = document.getElementById('wb-upload-pct');
      if (pctEl && snap.totalBytes) {
        pctEl.textContent = `Uploading selfie… ${Math.round((snap.bytesTransferred / snap.totalBytes) * 100)}%`;
      }
    }, err => {
      if (err && err.code === 'storage/canceled') {
        reject(Object.assign(new Error('Upload cancelled.'), { code: 'storage/canceled', cancelledByUser: true }));
      } else {
        reject(err);
      }
    }, () => {
      task.snapshot.ref.getDownloadURL().then(resolve, reject);
    });
  });
}

// Plain-English mapping for the raw Storage error codes a worker might
// actually hit — network-flavored ones are handled separately (queued) before
// this is ever called; this only needs to cover real, non-retryable failures.
function _friendlyStorageError(err) {
  const code = (err && err.code) || '';
  if (code === 'storage/unauthorized') return "You don't have permission to upload this selfie — contact HR/Admin.";
  if (code === 'storage/quota-exceeded') return 'Storage is full — contact Admin.';
  if (code === 'storage/retry-limit-exceeded') return 'Upload timed out repeatedly — check your connection and try again.';
  return (err && err.message) || 'Selfie upload failed.';
}

// A "Retake selfie" affordance for when the upload genuinely fails (not
// queued) — re-opens the camera and re-enters _finishClockSubmission with the
// SAME already-verified ctx.pos/ctx.match, so a retake never re-runs the
// geolocation/geofence round trip (v14 P1 fix). ──
function _offerRetake(ctx) {
  if (!ctx.statusEl) return;
  let retakeBtn = document.getElementById('wb-retake-btn');
  if (retakeBtn) retakeBtn.remove();
  retakeBtn = document.createElement('button');
  retakeBtn.type = 'button';
  retakeBtn.id = 'wb-retake-btn';
  retakeBtn.className = 'btn-secondary btn-sm';
  retakeBtn.style.marginTop = '8px';
  retakeBtn.textContent = 'Retake selfie';
  ctx.statusEl.insertAdjacentElement('afterend', retakeBtn);
  retakeBtn.addEventListener('click', async () => {
    retakeBtn.remove();
    if (ctx.btn) ctx.btn.disabled = true;
    const file = await _captureSelfie();
    if (!file) {
      ctx.setStatus(`Selfie was cancelled — Time ${ctx.kind === 'in' ? 'In' : 'Out'} was NOT recorded.`, true);
      if (ctx.btn) ctx.btn.disabled = false;
      return;
    }
    await _finishClockSubmission({ ...ctx, file });
  });
}

// ── Attendance calendar (adapted from js/screens/people.js
// renderAttendancePage's month grid — same .att-cal-grid/.att-cal-hdr/
// .att-cal-day CSS classes, reused as-is, no new CSS. Simpler status set than
// the Type-A calendar (no half-day/leave concepts for hourly production
// shifts): present = a record with timeIn exists; absent = a past workday
// with no record at all. ──
async function _loadWorkerCalendar(profile, viewYear, viewMonth) {
  const calEl = document.getElementById('wb-calendar');
  const labelEl = document.getElementById('wb-month-label');
  const sumEl = document.getElementById('wb-cal-summary');
  if (!calEl) return;
  calEl.innerHTML = window.skeletonHtml('rows');
  const label = new Date(viewYear, viewMonth).toLocaleString('en-PH', { month: 'long', year: 'numeric' });
  if (labelEl) labelEl.textContent = label;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const mm = String(viewMonth + 1).padStart(2, '0');
  const monthStart = `${viewYear}-${mm}-01`;
  const monthEnd = `${viewYear}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

  let snap;
  try {
    snap = await db.collection('attendance_worker').doc(profile.id).collection('records')
      .where(firebase.firestore.FieldPath.documentId(), '>=', monthStart)
      .where(firebase.firestore.FieldPath.documentId(), '<=', monthEnd).get();
  } catch (err) {
    calEl.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️', 44)}</div>
      <h4>Could not load attendance</h4><p style="font-size:12px;color:var(--text-muted)">${escHtml(err.message || String(err))}</p>
      <button type="button" class="btn-secondary btn-sm" id="wb-cal-retry" style="margin-top:10px">Retry</button></div>`;
    document.getElementById('wb-cal-retry')?.addEventListener('click', () => _loadWorkerCalendar(profile, viewYear, viewMonth));
    return;
  }
  const records = {};
  snap.docs.forEach(d => { records[d.id] = d.data(); });

  const firstDay = window.bizDow(monthStart);
  const todayStr = window.bizDate();
  const phHolidays = (typeof getPHHolidays === 'function') ? getPHHolidays(viewYear) : {};
  // Never fabricate an "Absent" mark for a day before the worker's own
  // hire/link date — a mid-month link/hire would otherwise paint every
  // prior day red with no real data behind it.
  const hireDateStr = profile.issuedOn || null;

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = `<div class="att-cal-grid">${dayLabels.map(d => `<div class="att-cal-hdr">${d}</div>`).join('')}${Array(firstDay).fill('<div></div>').join('')}`;

  let presentCount = 0, absentCount = 0, hoursTotal = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${viewYear}-${mm}-${String(day).padStart(2, '0')}`;
    const dow = window.bizDow(dateStr);
    const isSunday = dow === 0;
    const holiday = phHolidays[dateStr];
    const isNoWork = isSunday || !!holiday;
    const isPast = dateStr <= todayStr;
    const isBeforeHire = !!(hireDateStr && dateStr < hireDateStr);
    const rec = records[dateStr];
    let status = '';
    if (!isNoWork && isPast && !isBeforeHire) {
      if (rec && rec.timeIn) { status = 'present'; presentCount++; hoursTotal += (rec.hoursWorked || 0); }
      else if (dateStr < todayStr) { status = 'absent'; absentCount++; }
    }
    const cls = isSunday ? 'att-weekend' : holiday ? 'att-holiday' : status ? `att-${status}` : 'att-future';
    const isToday = dateStr === todayStr;
    const holidayTitle = holiday ? ` title="${escHtml(holiday.name)}"` : '';
    html += `<div class="att-cal-day ${cls} ${isToday ? 'att-today' : ''}" data-date="${dateStr}"${holidayTitle}>
      <span class="att-day-num">${day}</span>
      ${holiday ? `<span class="att-mark" style="font-size:9px;color:rgba(180,140,0,1)">${emojiIcon('🎌', 9)}</span>` :
        status === 'present' ? `<span class="att-mark">${emojiIcon('check', 14)}</span>` :
        status === 'absent' ? `<span class="att-mark">${emojiIcon('x', 14)}</span>` : ''}
    </div>`;
  }
  html += '</div>';
  calEl.innerHTML = html;
  if (window.lucide) lucide.createIcons({ nodes: [calEl] });

  if (sumEl) {
    sumEl.innerHTML = `<div class="kpi-row" style="margin:0">
      <div class="kpi-card green"><div class="kpi-label">Present</div><div class="kpi-value">${presentCount}</div></div>
      <div class="kpi-card red"><div class="kpi-label">Absent</div><div class="kpi-value">${absentCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Hours</div><div class="kpi-value">${hoursTotal.toFixed(1)}</div></div>
    </div>`;
  }
}

// ── Finance: current-week estimate + Month/YTD tiles + recent payslips.
// Reuses the EXISTING weekly payslip machinery verbatim — toPayslipModel /
// payslipYtdWeekly / renderPayslipPage (js/screens/hr.js) — same functions
// HR's own worker-payslip viewer calls. ──
async function _loadWorkerFinance(profile) {
  const el = document.getElementById('wb-finance');
  if (!el) return;
  el.innerHTML = window.skeletonHtml('rows');

  const todayStr = window.bizDate();
  const dow = window.bizDow(); // 0=Sun..6=Sat
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const monday = new Date(`${todayStr}T12:00:00+08:00`); monday.setDate(monday.getDate() - mondayOffset);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const weekStart = window.bizDate(monday);
  const weekEnd = window.bizDate(sunday);
  const monthStart = todayStr.slice(0, 7) + '-01';

  let weekSnap = { docs: [] }, monthSnap = { docs: [] }, payslipSnap = { docs: [] }, ytd = { gross: 0, net: 0 };
  // v14 re-audit fix — the payslips read is the ONE member of this Promise.all
  // that used to have no per-promise catch, so a single rejection took the
  // whole thing down and the catch below replaced #wb-finance — the ENTIRE
  // finance half of the only screen a Type-B worker has — with one error card.
  // That is exactly what happened while firestore.rules compared `workerId` (a
  // worker_profiles docId) to auth.uid: hours, the calendar and the clock card
  // all worked, and the money section went dark the moment Finance issued the
  // worker's first payslip. The rule is fixed (payslips read now resolves
  // ownership through worker_profiles.linkedUid), but the blast radius stays
  // fixed too: this one card degrades on its own instead of the section.
  let payslipErr = null;
  try {
    [weekSnap, monthSnap, payslipSnap, ytd] = await Promise.all([
      db.collection('attendance_worker').doc(profile.id).collection('records')
        .where(firebase.firestore.FieldPath.documentId(), '>=', weekStart)
        .where(firebase.firestore.FieldPath.documentId(), '<=', weekEnd).get(),
      db.collection('attendance_worker').doc(profile.id).collection('records')
        .where(firebase.firestore.FieldPath.documentId(), '>=', monthStart)
        .where(firebase.firestore.FieldPath.documentId(), '<=', todayStr).get(),
      db.collection('payslips').where('workerId', '==', profile.id).orderBy('createdAt', 'desc').limit(5).get()
        .catch(e => { payslipErr = e; return { docs: [] }; }),
      window.payslipYtdWeekly ? window.payslipYtdWeekly(profile.id, window.bizYear ? window.bizYear() : new Date().getFullYear()) : Promise.resolve({ gross: 0, net: 0 })
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body"><div class="empty-state">
      <div class="empty-icon">${emojiIcon('⚠️', 44)}</div><h4>Could not load finance data</h4>
      <p style="font-size:12px;color:var(--text-muted)">${escHtml(err.message || String(err))}</p>
      <button type="button" class="btn-secondary btn-sm" id="wb-fin-retry" style="margin-top:10px">Retry</button>
    </div></div></div>`;
    document.getElementById('wb-fin-retry')?.addEventListener('click', () => _loadWorkerFinance(profile));
    return;
  }

  const weekHours = weekSnap.docs.reduce((s, d) => s + (d.data().hoursWorked || 0), 0);
  const rph = profile.hourlyRate || (profile.dailyRate ? profile.dailyRate / 8 : 0);
  const weekEstimate = weekHours * rph;
  const monthDaysWorked = monthSnap.docs.filter(d => d.data().timeIn).length;
  const monthHours = monthSnap.docs.reduce((s, d) => s + (d.data().hoursWorked || 0), 0);
  const payslips = payslipSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3>${emojiIcon('💰', 20)} This Week (estimate)</h3></div>
      <div class="card-body">
        <div class="kpi-row" style="margin:0">
          <div class="kpi-card"><div class="kpi-label">Hours</div><div class="kpi-value">${weekHours.toFixed(1)}</div></div>
          <div class="kpi-card green"><div class="kpi-label">Estimate</div><div class="kpi-value" style="font-size:16px">₱${fmt(weekEstimate)}</div></div>
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px">Projection only, based on hours logged so far — the official amount is set when Finance issues your payslip.</p>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3>Month &amp; Year-to-Date</h3></div>
      <div class="card-body">
        <div class="kpi-row" style="margin:0">
          <div class="kpi-card"><div class="kpi-label">Days (mo.)</div><div class="kpi-value">${monthDaysWorked}</div></div>
          <div class="kpi-card"><div class="kpi-label">Hours (mo.)</div><div class="kpi-value">${monthHours.toFixed(1)}</div></div>
          <div class="kpi-card accent"><div class="kpi-label">YTD Gross</div><div class="kpi-value" style="font-size:15px">₱${fmt(ytd.gross || 0)}</div></div>
          <div class="kpi-card green"><div class="kpi-label">YTD Net</div><div class="kpi-value" style="font-size:15px">₱${fmt(ytd.net || 0)}</div></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Recent Payslips</h3></div>
      <div class="card-body" style="padding:0">
        ${payslipErr ? `<div class="empty-state" style="padding:20px">
            <p>Couldn't load your payslips.</p>
            <p style="font-size:11px;color:var(--text-muted)">${escHtml(payslipErr.message || String(payslipErr))}</p>
            <button type="button" class="btn-secondary btn-sm" id="wb-ps-retry" style="margin-top:10px">Retry</button>
          </div>` :
          !payslips.length ? `<div class="empty-state" style="padding:20px"><p>No payslips issued yet.</p></div>` :
          payslips.map(p => `<div class="wb-payslip-row" data-id="${p.id}" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer">
            <div>
              <div style="font-weight:600;font-size:13px">${escHtml(p.payPeriodStart || '')} – ${escHtml(p.payPeriodEnd || '')}</div>
              <div style="font-size:11px;color:var(--text-muted)">${escHtml(p.status || 'draft')}</div>
            </div>
            <strong>₱${fmt(p.netPay || 0)}</strong>
          </div>`).join('')}
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [el] });
  document.getElementById('wb-ps-retry')?.addEventListener('click', () => _loadWorkerFinance(profile));

  el.querySelectorAll('.wb-payslip-row').forEach(row => {
    row.addEventListener('click', () => {
      const p = payslips.find(x => x.id === row.dataset.id);
      if (!p || !window.toPayslipModel || !window.renderPayslipPage) return;
      const model = window.toPayslipModel(p, 'weekly');
      model.ytd = ytd;
      window.renderPayslipPage(model, () => window.renderWorkerHome());
    });
  });
}

// ── Entry point — js/app.js's navigateTo('dashboard') case routes here for
// payClass:'production' users instead of renderDashboard(). ──
window.renderWorkerHome = async function () {
  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('rows');

  let profile;
  try {
    profile = await _resolveWorkerProfile(currentUser.uid);
  } catch (err) {
    c.innerHTML = `<div class="empty-state" style="padding:40px 20px">
      <div class="empty-icon">${emojiIcon('⚠️', 44)}</div><h4>Could not load your worker profile</h4>
      <p style="color:var(--text-muted);font-size:13px">${escHtml(err.message || String(err))}</p>
      <button type="button" class="btn-secondary btn-sm" id="wb-home-retry" style="margin-top:10px">Retry</button>
    </div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    document.getElementById('wb-home-retry')?.addEventListener('click', () => window.renderWorkerHome());
    return;
  }

  if (!profile) {
    c.innerHTML = `<div class="empty-state" style="padding:40px 20px">
      <div class="empty-icon">${emojiIcon('🔗', 44)}</div><h4>Account not linked yet</h4>
      <p style="color:var(--text-muted);font-size:13px;max-width:360px;margin:0 auto">
        Your login is set to Production (Type B) but isn't linked to a Worker Profile yet.
        Ask HR to open your Worker Profile and set "Linked Login Account" to your account.
      </p>
    </div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    return;
  }

  _wbLastProfile = profile;
  _wbAttachOnlineListener();
  // Opportunistic replay — pick up any punch that got queued last session
  // (offline, or the tab was killed mid-upload) if we're online now. Never
  // awaited: this page must render immediately either way.
  _pqReplayAll();

  const bizToday = window.bizDate();
  let viewYear = parseInt(bizToday.slice(0, 4), 10);
  let viewMonth = parseInt(bizToday.slice(5, 7), 10) - 1;

  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('👋', 20)} Hi, ${escHtml((profile.name || '').split(' ')[0] || 'there')}!</h2></div>
    <div id="live-clock" class="live-clock-line"></div>
    <div id="wb-clock-card" style="margin-bottom:16px"></div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <h3>${emojiIcon('📅', 20)} Attendance Calendar</h3>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn-secondary btn-sm" id="wb-prev-month" aria-label="Previous month">‹</button>
          <span id="wb-month-label" style="font-weight:700;font-size:13px;min-width:110px;text-align:center"></span>
          <button class="btn-secondary btn-sm" id="wb-next-month" aria-label="Next month">›</button>
        </div>
      </div>
      <div class="card-body">
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;font-size:11px">
          <span><span class="att-dot att-present"></span> Present</span>
          <span><span class="att-dot att-absent"></span> Absent</span>
          <span><span class="att-dot att-holiday" style="background:rgba(255,214,0,0.6)"></span> Holiday</span>
          <span><span class="att-dot" style="background:var(--surface2);border:1px solid var(--border)"></span> Sunday</span>
        </div>
        <div id="wb-calendar"></div>
        <div id="wb-cal-summary" style="margin-top:12px"></div>
      </div>
    </div>
    <div id="wb-finance"></div>
  `;
  if (typeof liveDateTime === 'function') liveDateTime('live-clock');
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  const renderCal = () => _loadWorkerCalendar(profile, viewYear, viewMonth);
  // Don't let a worker page back past their own hire/link month — there's no
  // real attendance data before it (see _loadWorkerCalendar's isBeforeHire),
  // so a fabricated wall of "Absent" months is never a page-back away.
  const hireYear = profile.issuedOn ? parseInt(profile.issuedOn.slice(0, 4), 10) : null;
  const hireMonth = profile.issuedOn ? parseInt(profile.issuedOn.slice(5, 7), 10) - 1 : null;
  const atOrBeforeHireMonth = (y, m) => hireYear != null && (y < hireYear || (y === hireYear && m <= hireMonth));
  document.getElementById('wb-prev-month').addEventListener('click', () => {
    if (atOrBeforeHireMonth(viewYear, viewMonth)) { Notifs.showToast("You weren't hired yet before this month.", 'info'); return; }
    viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } renderCal();
  });
  document.getElementById('wb-next-month').addEventListener('click', () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } renderCal(); });

  await Promise.all([
    _loadClockCard(profile),
    renderCal(),
    _loadWorkerFinance(profile)
  ]);
};

if (typeof module !== 'undefined' && module.exports) {
  // Not required by tests today (this file is DOM/Firebase-dependent, unlike
  // js/geo-core.js) — the export exists only so a future headless smoke test
  // could require() it without throwing on `window`.
  module.exports = {};
}
