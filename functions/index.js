const functions = require('firebase-functions');
const admin     = require('firebase-admin');
admin.initializeApp();

/**
 * Fires whenever a notification doc is written to notifications/{uid}/items/{itemId}.
 * Looks up the user's FCM token and sends a device push.
 */
exports.sendPushOnNotification = functions
  .region('asia-east1')
  .firestore
  .document('notifications/{uid}/items/{itemId}')
  .onCreate(async (snap, context) => {
    const { uid } = context.params;
    const raw = snap.data() || {};

    // Defensive coercion/clamping: a forged or oversized notification doc
    // must not spam users or push an oversized FCM payload. Coerce to strings,
    // clamp to sane lengths, and treat an empty title+body as malformed.
    const asStr = (v) => (v == null ? '' : String(v));
    const title = asStr(raw.title).slice(0, 200);
    const body  = asStr(raw.body).slice(0, 1000);
    const type  = asStr(raw.type).slice(0, 64);

    // Malformed doc (no real content) — nothing worth pushing.
    if (!title.trim() && !body.trim()) {
      console.warn('[FCM] Skipping malformed notification (empty title and body) for', uid);
      return null;
    }

    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) return null;
    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) return null;

    const { itemId } = context.params;
    // DATA-ONLY message — no top-level `notification` block.
    //
    // If a `notification` block is present, the FCM web SDK auto-displays a
    // notification AND firebase-messaging-sw.js's onBackgroundMessage ALSO
    // calls showNotification() → the same alert rendered twice per delivery.
    // FCM is at-least-once, so redeliveries multiplied that into the
    // "same notif up to 5x" the user was seeing on mobile. Sending data-only
    // makes the service worker the single render path; it dedupes by notifId.
    const message = {
      token: fcmToken,
      data: {
        // BRAND MIRROR — window.BRAND.name in js/config.js (keep in sync by hand;
        // this deploys separately via `cd functions && npm run deploy`).
        title:   title.trim() || 'Barro Industries',
        body:    body.trim()  || 'You have a new notification.',
        type:    type.trim()  || 'general',
        notifId: itemId,               // unique per notification doc — SW dedupes on this
        uid:     uid,
      },
      webpush: {
        headers: { Urgency: 'high' },
        fcmOptions: { link: '/' }
      }
    };

    try {
      await admin.messaging().send(message);
    } catch (err) {
      if (err.code === 'messaging/registration-token-not-registered' ||
          err.code === 'messaging/invalid-registration-token') {
        // Stale/invalid token — remove it so we don't keep retrying
        await admin.firestore()
          .collection('users').doc(uid)
          .update({ fcmToken: admin.firestore.FieldValue.delete() });
      } else {
        // Re-throw transient errors (network, quota) so Cloud Functions
        // retries with its built-in exponential backoff
        console.error('[FCM] Send error:', err.code, err.message);
        throw err;
      }
    }
    return null;
  });

/**
 * Fires whenever a new Firebase Auth account is created — including accounts
 * added by hand in the Firebase Console → Authentication. Mirrors the
 * first-sign-in bootstrap in loadUserProfile() (js/app.js) so a Firestore
 * users/{uid} doc exists immediately, instead of only after the person logs in.
 *
 * Idempotent: the whole thing runs in a transaction that no-ops if the doc
 * already exists, so it never clobbers the richer docs written by the in-app
 * "Invite Team Member" / "Create Worker Account" flows (which create the Auth
 * account and the users doc back-to-back). Firestore's optimistic transactions
 * also detect a concurrent client write and retry, so there is no race.
 *
 * Signup-approval reconciliation: the approvals screen (js/departments.js)
 * approves a signup by writing a PLACEHOLDER users doc with a random id and
 * `pendingPasswordSetup: true` (no uid yet), then tells the admin to create the
 * Auth account by hand. Without this, that console step would leave TWO docs
 * for one person. So before falling back to a default doc, we look for a pending
 * placeholder matching this email and "claim" it: copy its fields onto
 * users/{uid} (reusing its already-allocated employeeId) and delete the orphan.
 */
exports.createUserDocOnAuthCreate = functions.auth.user().onCreate(async (user) => {
  const db = admin.firestore();
  const userRef    = db.collection('users').doc(user.uid);
  const counterRef = db.collection('_counters').doc('employees');
  const email = (user.email || '').trim();

  try {
    // Look for a pending placeholder doc for this email (single-field equality →
    // no composite index needed; we filter the pending flag in code). Done
    // outside the transaction; the ref is re-read inside it to stay consistent.
    let pendingRef = null;
    if (email) {
      const matches = await db.collection('users')
        .where('email', '==', email)
        .limit(10)
        .get();
      const hit = matches.docs.find(d => d.id !== user.uid && d.data().pendingPasswordSetup === true);
      if (hit) pendingRef = hit.ref;
    }

    await db.runTransaction(async (t) => {
      const existing = await t.get(userRef);
      if (existing.exists) {
        // Real doc already created by an in-app flow. If a stale pending
        // placeholder also exists, drop it so we don't leave a duplicate.
        if (pendingRef) t.delete(pendingRef);
        return;
      }

      // Path A — claim an approved signup placeholder (preserves role/depts/
      // employeeId set at approval time; no counter burn).
      if (pendingRef) {
        const pendingSnap = await t.get(pendingRef);
        if (pendingSnap.exists && pendingSnap.data().pendingPasswordSetup === true) {
          const p = pendingSnap.data();
          delete p.pendingPasswordSetup;
          t.set(userRef, {
            ...p,
            uid: user.uid,
            email: email || p.email || '',
            createdAt: p.createdAt || admin.firestore.FieldValue.serverTimestamp(),
            claimedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdVia: 'signup-approval'
          });
          t.delete(pendingRef);
          return;
        }
      }

      // Path B — brand-new account (e.g. added straight in the Auth console):
      // mint a default employee profile with a fresh employee id.
      const counter = await t.get(counterRef);
      const next = (counter.exists ? counter.data().count : 0) + 1;
      const empId = `BI-${new Date().getFullYear()}-${String(next).padStart(3, '0')}`;
      t.set(counterRef, { count: next }, { merge: true });
      t.set(userRef, {
        uid: user.uid,
        email,
        displayName: user.displayName || (email ? email.split('@')[0] : 'New Employee'),
        role: 'employee',
        departments: [],
        title: '',
        employeeId: empId,
        photoUrl: '',
        startDate: new Date().toISOString().slice(0, 10),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdVia: 'auth-trigger'
      });
    });
  } catch (err) {
    console.error('[createUserDocOnAuthCreate] failed for', user.uid, err);
  }
  return null;
});

/**
 * Callable: lets an admin/finance user reset an HR-managed worker's password
 * WITHOUT the app ever storing a recoverable copy of any password.
 *
 * Replaces the old client-side flow that stashed btoa(password) in a
 * world-readable `hrPwToken` field on the user doc (effectively plaintext
 * passwords readable by every signed-in user). The Admin SDK can set a new
 * password directly, so nothing sensitive is ever persisted.
 */
exports.adminResetPassword = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
  }
  // Caller must hold an admin/finance role (verified server-side, not trusted from client).
  const callerSnap = await admin.firestore().collection('users').doc(context.auth.uid).get();
  const callerRole = callerSnap.exists ? callerSnap.data().role : null;
  if (!['president', 'manager', 'finance'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to reset passwords.');
  }

  const targetUid   = (data && typeof data.targetUid === 'string') ? data.targetUid.trim() : '';
  const newPassword = (data && typeof data.newPassword === 'string') ? data.newPassword : '';
  if (!targetUid) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid is required.');
  }
  if (newPassword.length < 6) {
    throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters.');
  }

  // Only reset HR-managed worker accounts (defense-in-depth: don't let this
  // become a way to take over arbitrary auth accounts).
  const targetSnap = await admin.firestore().collection('users').doc(targetUid).get();
  if (!targetSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found.');
  }
  if (!targetSnap.data().hrManagedAccount) {
    throw new functions.https.HttpsError('failed-precondition', 'Only HR-managed worker accounts can be reset here.');
  }

  await admin.auth().updateUser(targetUid, { password: newPassword });
  return { ok: true };
});

// ──────────────────────────────────────────────────────────────────────────
//  CUSTOM CLAIMS — carry role + departments onto the Firebase Auth token
//
//  Cloud Storage Security Rules CANNOT call get()/exists() against Firestore,
//  so they can't read a user's role/department from users/{uid}. The only way
//  to gate storage by role/dept is to mint those values as Firebase Auth custom
//  claims (request.auth.token.role / .departments) and check them in
//  storage.rules. These two functions keep the claims in sync with the users
//  doc and let an admin backfill every existing account once.
// ──────────────────────────────────────────────────────────────────────────

// Departments can be stored as the array `departments` (current) or the legacy
// string `department`. Normalize to a string array for the claim.
function deptsOf(data) {
  if (!data) return [];
  if (Array.isArray(data.departments)) return data.departments.filter(d => typeof d === 'string');
  if (typeof data.department === 'string' && data.department) return [data.department];
  return [];
}

/**
 * Mirror users/{uid}.role + .departments onto that user's Auth custom claims so
 * storage.rules can scope sensitive folders (Finance/payslips, receipts) and
 * department folders by request.auth.token.role / .departments.
 *
 * Fires on every users/{uid} write, but only re-mints claims when the
 * claim-relevant fields actually changed (so routine profile edits — lastSeen
 * heartbeat, photo, phone — don't burn Admin SDK calls). After updating claims
 * it stamps `claimsUpdatedAt` so the owner's client can force an ID-token
 * refresh (getIdToken(true)) and pick up the new claims without re-login.
 *
 * No infinite loop: stamping claimsUpdatedAt re-fires this trigger, but on that
 * pass role/departments are unchanged, so it returns before writing again.
 */
exports.syncUserClaims = functions
  .region('asia-east1')
  .firestore
  .document('users/{uid}')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    const before = change.before.exists ? change.before.data() : null;
    const after  = change.after.exists  ? change.after.data()  : null;

    // Doc deleted — best-effort clear of claims (the Auth user may already be
    // gone, in which case setCustomUserClaims throws; that's fine).
    if (!after) {
      try { await admin.auth().setCustomUserClaims(uid, null); }
      catch (e) { /* auth user already removed — nothing to clear */ }
      return null;
    }

    // Approval placeholders use a random doc id with no matching Auth account
    // (see createUserDocOnAuthCreate). setCustomUserClaims would throw, and the
    // real doc gets claims when the account is claimed — so skip placeholders.
    if (after.pendingPasswordSetup === true) return null;

    const role  = typeof after.role === 'string' ? after.role : '';
    const depts = deptsOf(after);

    // Only act when role/departments changed (or this is the first write).
    if (before) {
      const sameRole  = role === (typeof before.role === 'string' ? before.role : '');
      const sameDepts = JSON.stringify([...depts].sort()) === JSON.stringify([...deptsOf(before)].sort());
      if (sameRole && sameDepts) return null;
    }

    try {
      await admin.auth().setCustomUserClaims(uid, { role, departments: depts });
      // Signal the owner's client to refresh its ID token (picks up new claims
      // live, no re-login). Unchanged role/departments on the re-fire → no loop.
      await admin.firestore().collection('users').doc(uid).update({
        claimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      // A users doc can legitimately exist with no Auth account yet (e.g. a
      // worker profile created before the login account). Log, don't crash.
      console.error('[syncUserClaims] failed for', uid, err.code || err.message);
    }
    return null;
  });

/**
 * One-time backfill: stamp custom claims onto EVERY existing user (the onWrite
 * trigger only covers docs written after deploy). President-only. Idempotent —
 * safe to run repeatedly. Stamps claimsUpdatedAt so any signed-in client
 * refreshes its token without re-login.
 *
 * Run once after deploy, signed in as president, e.g. from the browser console:
 *   firebase.functions().httpsCallable('backfillUserClaims')().then(r => console.log(r.data));
 */
exports.backfillUserClaims = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
  }
  const callerSnap = await admin.firestore().collection('users').doc(context.auth.uid).get();
  if (!callerSnap.exists || callerSnap.data().role !== 'president') {
    throw new functions.https.HttpsError('permission-denied', 'President only.');
  }

  const snap = await admin.firestore().collection('users').get();
  let ok = 0, skipped = 0, failed = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.pendingPasswordSetup === true) { skipped++; continue; }
    const role  = typeof d.role === 'string' ? d.role : '';
    const depts = deptsOf(d);
    try {
      await admin.auth().setCustomUserClaims(doc.id, { role, departments: depts });
      await doc.ref.update({ claimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp() });
      ok++;
    } catch (e) {
      // No Auth account for this users doc (worker profile, stale doc) — skip.
      failed++;
    }
  }
  return { total: snap.size, ok, skipped, failed };
});

// ──────────────────────────────────────────────────────────────────────────
//  SCHEDULED REMINDERS (v13 Phase 67) — H11: reminders fire whether or not a
//  tab is open. These write notification docs to notifications/{uid}/items/*;
//  sendPushOnNotification (above) picks up each new doc and relays the FCM
//  push, so these functions never touch messaging directly.
//
//  DEPLOY NOTE (loud, per instructions): these are net-new `functions.pubsub
//  .schedule(...)` (v1) exports. They are NOT live until Neil runs
//  `cd functions && npm run deploy` (== `firebase deploy --only functions`).
//  On first deploy, Cloud Scheduler auto-creates one job per schedule in the
//  GCP project (asia-east1), named:
//    - firebase-schedule-scheduledAttendanceReminder-asia-east1
//    - firebase-schedule-scheduledDailyDigestChecks-asia-east1
//  Verify them under Cloud Scheduler in GCP console (or `gcloud scheduler jobs
//  list`) after deploy, and watch the first firing in Cloud Functions logs.
//
//  DEDUP CONTRACT: js/notifications.js's client-side checks (checkDeadlines,
//  checkAttendanceReminder, checkLowStock, checkAECFollowups) stay in place
//  for one release as belt-and-braces. `send()` there dedups by querying
//  `.where('dedupKey', '==', dedupKey)` before writing — it does NOT depend
//  on a particular doc id. So as long as the *value* written to the
//  `dedupKey` field matches exactly what the client computes, client and
//  server can never double-send regardless of which one runs first or what
//  doc id either uses. The functions below reproduce each client dedupKey
//  string byte-for-byte:
//    - attendance reminder : `bi-att-remind-${uid}-${todayStr}`
//    - deadline (tomorrow) : `deadline-tmrw-${task.id}-${tomorrowStr}`
//    - deadline (today)    : `deadline-today-${task.id}-${todayStr}`
//    - low stock digest    : `lowstock-${uid}-${todayStr}`
//    - AEC follow-up digest: `aec-fu-${uid}-${todayStr}`
//  where todayStr/tomorrowStr are Manila "YYYY-MM-DD" (see manilaDate() below,
//  matching window.bizDate() in js/config.js).
// ──────────────────────────────────────────────────────────────────────────

/**
 * Manila-local calendar date as "YYYY-MM-DD", independent of the Cloud
 * Functions runner's own timezone (Cloud Functions run in UTC). Mirrors
 * window.bizDate() in js/config.js: standard shift-then-slice using a fixed
 * +08:00 offset (Asia/Manila has no DST, so this never drifts).
 *
 * RUNNER TZ ASSUMPTION: Cloud Functions v1 always execute in UTC regardless
 * of the `timeZone()` set on the pubsub schedule — that setting only controls
 * *when* Cloud Scheduler fires the job, not what `new Date()` returns inside
 * it. So every date computation in these functions must go through this
 * helper rather than a bare `new Date().toISOString()`.
 */
function manilaDate(date) {
  const d = date || new Date();
  const shifted = new Date(d.getTime() + 8 * 60 * 60 * 1000); // UTC+8, no DST
  return shifted.toISOString().slice(0, 10);
}

/** Firestore batches cap at 500 writes; chunk and commit in groups of <=500. */
async function commitInChunks(db, refs, dataFn, chunkSize = 499) {
  const items = refs.slice();
  let written = 0;
  while (items.length) {
    const chunk = items.splice(0, chunkSize);
    const batch = db.batch();
    chunk.forEach(({ ref, notifData }) => {
      batch.set(ref, {
        ...notifData,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

/** Heartbeat write, mirrors scripts/sync-to-drive.js's reportHealth() shape. */
async function reportHealth(db, job, stats, label) {
  try {
    await db.collection('system_health').doc(job).set({
      job, lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      lastStatus: stats.errors > 0 ? 'error' : 'ok',
      errors: stats.errors || 0, notified: stats.notified || 0,
      label: label || ''
    }, { merge: true });
  } catch (e) { console.warn(`[${job}] system_health write failed:`, e.message); }
}

/**
 * Daily (Mon–Sat) 07:30 Manila — attendance morning reminder.
 * Ports js/notifications.js checkAttendanceReminder() server-side: find every
 * non-partner, non-inactive user with no attendance/{uid}/records/{today} doc,
 * and write a reminder notification. dedupKey matches the client's exactly
 * (`bi-att-remind-${uid}-${todayStr}`) so re-runs — and the still-live client
 * check firing between 7-9am on an open tab — are no-ops on the loser side.
 */
exports.scheduledAttendanceReminder = functions
  .region('asia-east1')
  .pubsub.schedule('30 7 * * 1-6')
  .timeZone('Asia/Manila')
  .onRun(async () => {
    const db = admin.firestore();
    const stats = { errors: 0, notified: 0 };
    try {
      const todayStr = manilaDate();
      const usersSnap = await db.collection('users').get();
      const candidates = usersSnap.docs.filter(d => {
        const u = d.data();
        return u.role !== 'partner' && u.status !== 'inactive' && !u.pendingPasswordSetup;
      });

      // Attendance records live at attendance/{uid}/records/{date} — no
      // collection-group query available for "has no record today" without
      // scanning, so check each candidate's record doc individually.
      const toNotify = [];
      for (const doc of candidates) {
        try {
          const rec = await db.collection('attendance').doc(doc.id)
            .collection('records').doc(todayStr).get();
          if (rec.exists) continue;
          const u = doc.data();
          const name = u.displayName || 'there';
          toNotify.push({
            ref: db.collection('notifications').doc(doc.id).collection('items').doc(),
            notifData: {
              title: `🌅 Good morning, ${name}!`,
              body: "Don't forget to time in today. Wishing you a productive day! 💪",
              icon: '🌅', type: 'att_morning_remind', link: null,
              dedupKey: `bi-att-remind-${doc.id}-${todayStr}`
            }
          });
        } catch (e) {
          stats.errors++;
          console.error('[scheduledAttendanceReminder] attendance read failed for', doc.id, e.message);
        }
      }

      stats.notified = await commitInChunks(db, toNotify, null);
      console.log(`[scheduledAttendanceReminder] ${stats.notified} reminder(s) queued for ${todayStr}`);
    } catch (err) {
      stats.errors++;
      console.error('[scheduledAttendanceReminder] failed:', err);
    }
    await reportHealth(db, 'scheduledAttendanceReminder', stats, 'Server-side attendance reminders');
    return null;
  });

/**
 * Daily 08:30 Manila — deadline / low-stock / AEC follow-up digest.
 * Ports checkDeadlines, checkLowStock, checkAECFollowups from
 * js/notifications.js server-side, each reusing the client's exact dedupKey
 * scheme so the still-live client-side checks (fired on next login/open tab)
 * are no-ops when this job already sent the same notification.
 */
exports.scheduledDailyDigestChecks = functions
  .region('asia-east1')
  .pubsub.schedule('30 8 * * *')
  .timeZone('Asia/Manila')
  .onRun(async () => {
    const db = admin.firestore();
    const stats = { errors: 0, notified: 0 };
    const toNotify = [];
    const todayStr = manilaDate();
    const tomorrowStr = manilaDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

    // ── 1. Deadlines — port of checkDeadlines(uid) per assignee ──
    try {
      const DONE_STATUSES = ['done', 'approved', 'archived'];
      const [tomorrowSnap, todaySnap] = await Promise.all([
        db.collection('tasks').where('dueDate', '==', tomorrowStr).get(),
        db.collection('tasks').where('dueDate', '==', todayStr).get()
      ]);
      const pushTaskNotifs = (snap, when, key, title, bodyFn) => {
        snap.docs.forEach(d => {
          const task = { id: d.id, ...d.data() };
          if (DONE_STATUSES.includes(task.status)) return;
          const assignees = Array.isArray(task.assignedTo) ? task.assignedTo : [];
          assignees.forEach(uid => {
            toNotify.push({
              ref: db.collection('notifications').doc(uid).collection('items').doc(),
              notifData: {
                title, body: bodyFn(task), icon: '⏰', type: 'deadline', taskId: task.id, link: null,
                dedupKey: `${key}-${task.id}-${when}`
              }
            });
          });
        });
      };
      pushTaskNotifs(tomorrowSnap, tomorrowStr, 'deadline-tmrw', '⏰ Due Tomorrow',
        (task) => `"${task.title}" is due tomorrow.`);
      pushTaskNotifs(todaySnap, todayStr, 'deadline-today', '🚨 Due Today',
        (task) => `"${task.title}" is due today! Complete and submit it.`);
    } catch (e) {
      stats.errors++;
      console.error('[scheduledDailyDigestChecks] deadlines failed:', e.message);
    }

    // ── 2. Low stock — port of checkLowStock(uid, role): daily digest to
    //      president/manager/finance and Purchasing-dept members ──
    try {
      const [invSnap, usersSnap] = await Promise.all([
        db.collection('inventory_items').get(),
        db.collection('users').get()
      ]);
      const low = invSnap.docs.map(d => d.data())
        .filter(i => (i.reorderLevel || 0) > 0 && (i.qty || 0) <= (i.reorderLevel || 0));
      if (low.length) {
        const names = low.slice(0, 5).map(i => i.name).filter(Boolean).join(', ');
        const more = low.length > 5 ? ` +${low.length - 5} more` : '';
        usersSnap.docs.forEach(doc => {
          const u = doc.data();
          if (u.status === 'inactive' || u.pendingPasswordSetup) return;
          const depts = Array.isArray(u.departments) ? u.departments
            : (typeof u.department === 'string' && u.department ? [u.department] : []);
          const isPurchasing = depts.includes('Purchasing');
          if (!['president', 'manager', 'finance'].includes(u.role) && !isPurchasing) return;
          toNotify.push({
            ref: db.collection('notifications').doc(doc.id).collection('items').doc(),
            notifData: {
              title: `📦 ${low.length} item${low.length > 1 ? 's' : ''} low on stock`,
              body: isPurchasing
                ? `At/below reorder level: ${names}${more}. Open Purchasing → RFQ → "From low stock".`
                : `At/below reorder level: ${names}${more}. Tap to review Inventory.`,
              icon: '📦', type: 'low_stock', link: isPurchasing ? 'dept:Purchasing' : 'inventory',
              dedupKey: `lowstock-${doc.id}-${todayStr}`
            }
          });
        });
      }
    } catch (e) {
      stats.errors++;
      console.error('[scheduledDailyDigestChecks] low stock failed:', e.message);
    }

    // ── 3. AEC follow-ups — port of checkAECFollowups(uid, role): daily
    //      digest to president/manager and Sales-dept members ──
    try {
      const [aecSnap, usersSnap] = await Promise.all([
        db.collection('aec_contacts').get(),
        db.collection('users').get()
      ]);
      const terminal = ['partner', 'dormant'];
      const due = aecSnap.docs.map(d => d.data())
        .filter(c => c.followUpDate && c.followUpDate <= todayStr && !terminal.includes(c.stage || 'new'));
      if (due.length) {
        const names = due.slice(0, 5).map(c => c.company || c.contactPerson).filter(Boolean).join(', ');
        const more = due.length > 5 ? ` +${due.length - 5} more` : '';
        usersSnap.docs.forEach(doc => {
          const u = doc.data();
          if (u.status === 'inactive' || u.pendingPasswordSetup) return;
          const depts = Array.isArray(u.departments) ? u.departments
            : (typeof u.department === 'string' && u.department ? [u.department] : []);
          const isSales = depts.includes('Sales');
          if (!['president', 'manager'].includes(u.role) && !isSales) return;
          toNotify.push({
            ref: db.collection('notifications').doc(doc.id).collection('items').doc(),
            notifData: {
              title: `📇 ${due.length} AEC follow-up${due.length > 1 ? 's' : ''} due`,
              body: `Overdue: ${names}${more}. Open Sales → AEC to follow up.`,
              icon: '📇', type: 'aec_followup', link: 'dept:Sales',
              dedupKey: `aec-fu-${doc.id}-${todayStr}`
            }
          });
        });
      }
    } catch (e) {
      stats.errors++;
      console.error('[scheduledDailyDigestChecks] AEC follow-ups failed:', e.message);
    }

    try {
      stats.notified = await commitInChunks(db, toNotify, null);
      console.log(`[scheduledDailyDigestChecks] ${stats.notified} notification(s) queued for ${todayStr}`);
    } catch (err) {
      stats.errors++;
      console.error('[scheduledDailyDigestChecks] commit failed:', err);
    }
    await reportHealth(db, 'scheduledDailyDigestChecks', stats, 'Server-side deadline/low-stock/AEC digest');
    return null;
  });
