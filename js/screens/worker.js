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
// per failure mode (never a fake success — see the file header's rule). ──
function _getPosition() {
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
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
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
    const cleanupListeners = () => {
      window.removeEventListener('focus', onSignal);
      document.removeEventListener('visibilitychange', onSignal);
    };
    const finish = file => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
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
      if (document && 'visibilityState' in document && document.visibilityState !== 'visible') return;
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
  const todaySnap = await todayRef.get();
  const todayData = todaySnap.exists ? todaySnap.data() : null;
  if (todayData && todayData.timeIn && !todayData.timeOut) {
    return { dateStr: todayStr, ref: todayRef, data: todayData };
  }
  if (!todayData || !todayData.timeIn) {
    const yestStr = window.bizDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const yestRef = base.doc(yestStr);
    const yestSnap = await yestRef.get();
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

  const badge = hasOut ? `<span class="badge badge-green">Timed Out</span>`
    : hasIn ? `<span class="badge badge-orange">Timed In</span>`
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

// ── The Time In / Time Out flow: geolocation → geofence check → (blocking
// OUTSIDE result, OR selfie capture → compress → upload → write record). ──
async function _handleClock(kind, profile) {
  const btn = document.getElementById(kind === 'in' ? 'wb-timein-btn' : 'wb-timeout-btn');
  const statusEl = document.getElementById('wb-clock-status');
  const setStatus = (msg, isErr) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isErr ? 'var(--danger)' : 'var(--text-muted)';
  };
  if (btn) btn.disabled = true;

  // ── 0. Resolve which day-doc this action targets. Time In always starts a
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
      // whole Time Out flow; the read-modify-write in step 5 re-checks anyway.
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
      }
    }
  }

  // ── 1. Location ──
  setStatus('Getting your location…');
  let pos;
  try { pos = await _getPosition(); }
  catch (err) {
    setStatus(err.message, true);
    Notifs.showToast(err.message, 'error');
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

  // ── 3. Geofence check (js/geo-core.js) ──
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
    // logged). Never writes timeIn/timeOut/inValid on an invalid attempt.
    ref.set({
      workerId: profile.id, date: recordDateStr,
      attempts: firebase.firestore.FieldValue.arrayUnion({
        kind, lat: pos.lat, lng: pos.lng,
        distanceM: nearest ? Math.round(nearest.distanceM) : null,
        siteId: nearest ? nearest.siteId : null,
        valid: false, atClient: new Date().toISOString()
      })
    }, { merge: true }).catch(() => {});
    if (btn) btn.disabled = false;
    return;
  }

  // ── 4. Selfie ──
  setStatus('Location verified — opening camera…');
  const file = await _captureSelfie();
  if (!file) {
    setStatus(`Selfie was cancelled — Time ${kind === 'in' ? 'In' : 'Out'} was NOT recorded.`, true);
    if (btn) btn.disabled = false;
    return;
  }

  setStatus('Uploading selfie…');
  let selfieUrl;
  try {
    const blob = await _compressSelfie(file);
    const path = `attendance-selfies/${currentUser.uid}/${recordDateStr}-${kind}.jpg`;
    const sref = storage.ref(path);
    await sref.put(blob, { customMetadata: { uploadedBy: currentUser.uid } });
    selfieUrl = await sref.getDownloadURL();
  } catch (err) {
    setStatus(`Selfie upload failed — Time ${kind === 'in' ? 'In' : 'Out'} was NOT recorded: ${err.message || err}`, true);
    Notifs.showToast('Selfie upload failed: ' + (err.message || err), 'error');
    if (btn) btn.disabled = false;
    return;
  }

  // ── 5. Write the record (own-uid write of a doc keyed by worker_profiles
  // docId — see the Storage/Firestore rule requirements in the final report;
  // this write is EXPECTED to be denied until those rules ship). ──
  const timeStr = _workerBizTimeHM();
  const distanceM = Math.round(match.nearest.distanceM);
  setStatus('Saving…');
  try {
    // Time Out needs timeIn (already on the doc) to compute hoursWorked —
    // read-modify-write, same computeDayHours the kiosk/payslip paths use.
    // Re-fetch (rather than trusting step 0's curData) since GPS + selfie
    // capture + upload can take a while and this must reflect the latest state.
    const cur = await ref.get();
    const freshData = cur.exists ? cur.data() : {};
    const fields = kind === 'in'
      ? { timeIn: timeStr, inLat: pos.lat, inLng: pos.lng, inDistanceM: distanceM, inSiteId: match.nearest.siteId, inSelfieUrl: selfieUrl, inValid: true, inAt: firebase.firestore.FieldValue.serverTimestamp() }
      : { timeOut: timeStr, outLat: pos.lat, outLng: pos.lng, outDistanceM: distanceM, outSiteId: match.nearest.siteId, outSelfieUrl: selfieUrl, outValid: true, outAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (kind === 'out') {
      const calcFn = (typeof computeDayHours === 'function') ? computeDayHours : null;
      fields.hoursWorked = calcFn ? calcFn(freshData.timeIn, timeStr) : 0;
    }
    await ref.set({
      workerId: profile.id, date: recordDateStr,
      recordedBy: currentUser.uid,
      recordedByName: (window.userProfile && userProfile.displayName) || currentUser.email,
      recordedAt: firebase.firestore.FieldValue.serverTimestamp(),
      ...fields
    }, { merge: true });
  } catch (err) {
    setStatus(`Could not save Time ${kind === 'in' ? 'In' : 'Out'}: ${err.message || err}`, true);
    Notifs.showToast(`Time ${kind === 'in' ? 'In' : 'Out'} failed to save: ` + (err.message || err), 'error');
    if (btn) btn.disabled = false;
    return;
  }

  Notifs.success(kind === 'in'
    ? `✅ Timed in at ${timeStr} — ${match.nearest.name}`
    : `👋 Timed out at ${timeStr}`);
  _loadClockCard(profile);
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

  const firstDay = window.bizDow(new Date(`${monthStart}T12:00:00`));
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
    const dow = window.bizDow(new Date(`${dateStr}T12:00:00`));
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
  try {
    [weekSnap, monthSnap, payslipSnap, ytd] = await Promise.all([
      db.collection('attendance_worker').doc(profile.id).collection('records')
        .where(firebase.firestore.FieldPath.documentId(), '>=', weekStart)
        .where(firebase.firestore.FieldPath.documentId(), '<=', weekEnd).get(),
      db.collection('attendance_worker').doc(profile.id).collection('records')
        .where(firebase.firestore.FieldPath.documentId(), '>=', monthStart)
        .where(firebase.firestore.FieldPath.documentId(), '<=', todayStr).get(),
      db.collection('payslips').where('workerId', '==', profile.id).orderBy('createdAt', 'desc').limit(5).get(),
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
        ${!payslips.length ? `<div class="empty-state" style="padding:20px"><p>No payslips issued yet.</p></div>` :
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
