const functions = require('firebase-functions');
const admin     = require('firebase-admin');
admin.initializeApp();

// v14 re-audit fix — real per-sender enforcement (see the block inside
// sendPushOnNotification below). Kept in its OWN bucket collection
// (notif_push_quota), separate from sendNotificationQuota's observe-only
// notif_quota bucket further down this file — both functions trigger on the
// SAME onCreate event, and Cloud Functions gives no ordering guarantee
// between two independent triggers on one document, so sharing one counter
// would double-count every notification.
const NOTIF_PUSH_QUOTA_PER_HOUR = 200;

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
    const title  = asStr(raw.title).slice(0, 200);
    const body   = asStr(raw.body).slice(0, 1000);
    const type   = asStr(raw.type).slice(0, 64);
    const link   = asStr(raw.link).slice(0, 300);
    const chatId = asStr(raw.chatId).slice(0, 200);
    const taskId = asStr(raw.taskId).slice(0, 200);

    // Malformed doc (no real content) — nothing worth pushing.
    if (!title.trim() && !body.trim()) {
      console.warn('[FCM] Skipping malformed notification (empty title and body) for', uid);
      return null;
    }

    // v14 re-audit fix — REAL enforcement of the per-sender send rate, not
    // just an observed warning (sendNotificationQuota further down this file
    // logs but never blocked anything). A signed-in account attributed via
    // senderUid that blows past a sane per-hour rate has THIS notification
    // deleted and its push skipped — stopping a real-device push-bomb of
    // another user. senderUid is optional/attacker-omittable on the doc
    // itself (system/scheduled sends never set it), so this only throttles
    // attributed sends; every real client call site (js/notifications.js
    // send/sendToDept/sendToAll/sendToOwner) always includes it when the
    // caller has a live session, which is the case for any account capable of
    // triggering this in the first place. Fails OPEN on a bucket-read/write
    // error — a quota-check bug must never block a legitimate push.
    const senderUid = raw.senderUid || raw.fromUid || raw.createdBy || raw.senderId || raw.authorUid || null;
    if (senderUid) {
      try {
        const hourBucket = manilaDate().replace(/-/g, '') + '_' + new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
        const bucketRef = admin.firestore().collection('notif_push_quota').doc(`${senderUid}_${hourBucket}`);
        const count = await admin.firestore().runTransaction(async (tx) => {
          const doc = await tx.get(bucketRef);
          const next = (doc.exists ? (doc.data().count || 0) : 0) + 1;
          tx.set(bucketRef, {
            senderUid, hourBucket, count: next,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          return next;
        });
        if (count > NOTIF_PUSH_QUOTA_PER_HOUR) {
          console.warn(`[sendPushOnNotification] sender ${senderUid} exceeded push quota (${count}/${NOTIF_PUSH_QUOTA_PER_HOUR} in ${hourBucket}) — blocking push and removing notification ${uid}/${context.params.itemId}`);
          await snap.ref.delete().catch(() => {});
          await admin.firestore().collection('system_health').doc('sendPushOnNotification').set({
            job: 'sendPushOnNotification',
            lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            lastStatus: 'warn',
            errors: 0, notified: 0,
            label: `sender ${senderUid} blocked at ${count}/${NOTIF_PUSH_QUOTA_PER_HOUR} in ${hourBucket} (enforced)`
          }, { merge: true }).catch(() => {});
          return null;
        }
      } catch (e) {
        console.error('[sendPushOnNotification] quota check failed (failing open):', e.message);
      }
    }

    // Collapse tag: bursts of the same "kind" of push should collapse into one
    // OS notification instead of stacking N of them. Default is per-type
    // ('deadline', 'low_stock', ...). Chat messages are the obvious exception —
    // different conversations must stack separately, so tag by chatId when
    // present. The SW (firebase-messaging-sw.js) uses data.tag verbatim.
    const tag = chatId ? `chat-${chatId}` : (type.trim() || 'general');

    // v14 wave5 M4: per-conversation mute — a chat push is skipped when the
    // recipient has muted that conversation (conversations/{chatId}.mutedBy[uid]).
    // Best-effort: a failed/missing conv read never blocks the push.
    if (chatId && type === 'chat_message') {
      try {
        const conv = await admin.firestore().collection('conversations').doc(chatId).get();
        if (conv.exists && conv.data().mutedBy && conv.data().mutedBy[uid] === true) {
          console.log('[FCM] Skipping muted-conversation push for', uid, 'conv', chatId);
          return null;
        }
      } catch (e) { /* fall through — deliver rather than silently drop */ }
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
        // Everything the SW needs for click-through — data-only messages mean
        // the SW owns display AND click handling, so the deep-link target and
        // collapse tag both have to ride in `data` (no top-level `notification`
        // block; see the comment above on why that must stay true).
        link:    link,                 // in-app nav target, e.g. 'projects-lifecycle', 'dept:Sales' — same string js/notifications.js already writes on the doc
        chatId:  chatId,               // present for chat message notifs — lets the SW/app open the right conversation
        taskId:  taskId,               // present for task/deadline notifs
        tag:     tag,                  // OS-level collapse key: per-type by default, per-conversation for chat
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
  // v14 re-audit fix — hrManagedAccount alone is not sufficient proof the
  // target is a low-privilege worker account: firestore.rules previously let
  // any isAdmin() (manager/secretary) flip that flag onto an ALREADY-EXISTING
  // doc via a plain update (now closed separately — see
  // userPrivilegedFieldsUnchanged() in firestore.rules), which combined with
  // this function's caller list (president/manager/finance) would have let a
  // manager silently reset the President's own password. Defense-in-depth:
  // never let this callable touch an admin/finance-tier account regardless of
  // the flag, since "HR-managed worker account" is never legitimately one of
  // these roles in the first place.
  const targetRole = targetSnap.data().role;
  if (['president', 'manager', 'secretary', 'finance'].includes(targetRole)) {
    throw new functions.https.HttpsError('permission-denied', 'This function cannot reset passwords for admin/finance-tier accounts.');
  }

  await admin.auth().updateUser(targetUid, { password: newPassword });

  // v14 re-audit fix — a successful reset used to leave zero trace anywhere
  // in the app's own data model (no audit_log entry, no notice to the
  // affected user). Best-effort: never let a logging failure undo an
  // already-completed password reset.
  try {
    await admin.firestore().collection('audit_log').add({
      ts: admin.firestore.FieldValue.serverTimestamp(),
      action: 'password-reset',
      entity: 'user',
      entityId: targetUid,
      details: { targetRole: targetRole || null, targetEmail: targetSnap.data().email || null },
      actorUid: context.auth.uid,
      actorName: callerSnap.exists ? (callerSnap.data().displayName || callerSnap.data().email || 'unknown') : 'unknown',
      actorRole: callerRole,
    });
  } catch (e) {
    console.error('[adminResetPassword] audit log write failed:', e.message);
  }

  return { ok: true };
});

/**
 * setUserDisabled — AUTHORITATIVE offboarding / reinstatement.
 *
 * The client "removed" gate (js/app.js showRemovedUserScreen) only flips a
 * Firestore flag. But a removed user's EXISTING session keeps a valid ID token
 * (auth persistence is LOCAL / 10-day), so they could bypass the client screen
 * by hitting Firestore directly or disabling the page JS — for up to 10 days.
 * The only authoritative lock is DISABLING the Firebase Auth account (blocks
 * token refresh + re-login) plus revoking refresh tokens (kills any live
 * session within ~1h). This callable performs BOTH the auth disable/enable AND
 * the users/{uid} flag write in one server-side admin-SDK action, so offboarding
 * can never land half-applied (flag set but account still usable, or vice-versa).
 */
exports.setUserDisabled = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
  }
  // Caller role verified server-side (never trusted from the client).
  const callerSnap = await admin.firestore().collection('users').doc(context.auth.uid).get();
  const callerRole = callerSnap.exists ? callerSnap.data().role : null;
  if (!['president', 'manager'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to offboard accounts.');
  }

  const targetUid = (data && typeof data.targetUid === 'string') ? data.targetUid.trim() : '';
  const disabled  = !!(data && data.disabled);
  if (!targetUid) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid is required.');
  }
  if (targetUid === context.auth.uid) {
    throw new functions.https.HttpsError('failed-precondition', 'You cannot offboard your own account.');
  }

  const targetSnap = await admin.firestore().collection('users').doc(targetUid).get();
  if (!targetSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found.');
  }
  const targetRole = targetSnap.data().role;
  // The President account can never be locked out.
  if (targetRole === 'president') {
    throw new functions.https.HttpsError('permission-denied', 'The President account cannot be offboarded.');
  }
  // A manager can offboard regular employees but NOT lateral admin/finance
  // peers — only the President may offboard an admin/finance-tier account.
  if (callerRole !== 'president' && ['manager', 'secretary', 'finance'].includes(targetRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Only the President can offboard admin/finance-tier accounts.');
  }

  // 1. Authoritative auth lock (idempotent). Tolerate a user doc with no
  //    matching Auth account (placeholder/imported record) — the Firestore
  //    flag below is still the app-visible gate.
  let authNote = null;
  try {
    await admin.auth().updateUser(targetUid, { disabled });
    if (disabled) await admin.auth().revokeRefreshTokens(targetUid);
  } catch (e) {
    if (e && e.code === 'auth/user-not-found') {
      authNote = 'no-auth-account';
    } else {
      throw new functions.https.HttpsError('internal', 'Could not update the auth account: ' + (e.message || e.code));
    }
  }

  // 2. App-visible flag (admin SDK — bypasses rules), so the client gate and
  //    Firestore rules see the same state the auth lock enforces.
  const flag = disabled
    ? { removed: true,  removedAt: admin.firestore.FieldValue.serverTimestamp(), removedBy: context.auth.uid }
    : { removed: false, reinstatedAt: admin.firestore.FieldValue.serverTimestamp(), reinstatedBy: context.auth.uid };
  await admin.firestore().collection('users').doc(targetUid).set(flag, { merge: true });

  // 3. Audit (best-effort — never undo a completed offboarding over a log write).
  try {
    await admin.firestore().collection('audit_log').add({
      ts: admin.firestore.FieldValue.serverTimestamp(),
      action: disabled ? 'offboard-user' : 'reinstate-user',
      entity: 'user',
      entityId: targetUid,
      details: { targetRole: targetRole || null, targetEmail: targetSnap.data().email || null, authNote },
      actorUid: context.auth.uid,
      actorName: callerSnap.exists ? (callerSnap.data().displayName || callerSnap.data().email || 'unknown') : 'unknown',
      actorRole: callerRole,
    });
  } catch (e) {
    console.error('[setUserDisabled] audit log write failed:', e.message);
  }

  return { ok: true, authNote };
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

/** Deterministic item id from a dedupKey (mirrors the client's _dedupDocId /
 *  scripts/daily-digest.js writeDigest). Scheduled triggers are at-least-once
 *  (and get re-run by hand), so a random .doc() id would mint a brand-new item
 *  each run — a genuinely new onCreate → a duplicate push to every recipient.
 *  Same-id set() is an overwrite: no onCreate, no duplicate. */
function dedupDocId(key) {
  return 'dedup_' + String(key).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 400);
}

/** Firestore batches cap at 500 writes; chunk and commit in groups of <=500. */
async function commitInChunks(db, refs, dataFn, chunkSize = 499) {
  const items = refs.slice();
  let written = 0;
  while (items.length) {
    const chunk = items.splice(0, chunkSize);
    const batch = db.batch();
    chunk.forEach(({ ref, notifData }) => {
      const target = (notifData && notifData.dedupKey)
        ? ref.parent.doc(dedupDocId(notifData.dedupKey))
        : ref;
      batch.set(target, {
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
      ...(stats.govBidsFlagged !== undefined ? { govBidsFlagged: stats.govBidsFlagged } : {}),
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

    // ── 4. Gov bidding deadlines (Phase 76) — 7/3/1 days out, dept-targeted ──
    // Schema note: gov_philgeps/gov_active_bids/gov_archive docs today only
    // carry {title, description, status, fileUrl, addedBy, createdAt} — no
    // closing/deadline date field exists yet (that lands with the Phase 76
    // PhilGEPS parse-paste helper, which is NOT part of this change). This
    // check reads `closingDate` (falling back to `deadline`) defensively so
    // it activates automatically once that field starts being written, and
    // is a safe no-op (0 notified) until then. Accepts either a Firestore
    // Timestamp or a 'YYYY-MM-DD' string, per the instruction to handle both.
    // Bids "in play" live in gov_philgeps (intake/tracked) and gov_active_bids
    // (actively pursued) — gov_archive is closed/done and excluded.
    let govDeadlineCount = 0;
    try {
      const GOV_COLLECTIONS = ['gov_philgeps', 'gov_active_bids'];
      const TERMINAL_GOV_STATUSES = ['won', 'lost', 'cancelled', 'archived'];
      const DAY_MS = 24 * 60 * 60 * 1000;

      const toDateStr = (v) => {
        if (!v) return null;
        if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
        if (typeof v.toDate === 'function') return manilaDate(v.toDate());
        if (v instanceof Date) return manilaDate(v);
        return null;
      };
      const daysBetween = (fromStr, toStr) => {
        const from = new Date(fromStr + 'T00:00:00Z').getTime();
        const to = new Date(toStr + 'T00:00:00Z').getTime();
        return Math.round((to - from) / DAY_MS);
      };

      const [usersSnap, ...govSnaps] = await Promise.all([
        db.collection('users').get(),
        ...GOV_COLLECTIONS.map(c => db.collection(c).get())
      ]);

      const recipients = usersSnap.docs.filter(doc => {
        const u = doc.data();
        if (u.status === 'inactive' || u.pendingPasswordSetup) return false;
        const depts = Array.isArray(u.departments) ? u.departments
          : (typeof u.department === 'string' && u.department ? [u.department] : []);
        return ['president', 'manager'].includes(u.role) || depts.includes('Government Biddings');
      });

      GOV_COLLECTIONS.forEach((colName, ci) => {
        govSnaps[ci].docs.forEach(d => {
          const bid = { id: d.id, ...d.data() };
          if (TERMINAL_GOV_STATUSES.includes(bid.status)) return;
          const closingStr = toDateStr(bid.closingDate) || toDateStr(bid.deadline);
          if (!closingStr) return;
          const daysOut = daysBetween(todayStr, closingStr);
          if (![7, 3, 1].includes(daysOut)) return;
          const bidName = bid.title || bid.name || 'Untitled bid';
          govDeadlineCount++;
          recipients.forEach(doc => {
            toNotify.push({
              ref: db.collection('notifications').doc(doc.id).collection('items').doc(),
              notifData: {
                title: `🏛️ Bid closing in ${daysOut} day${daysOut > 1 ? 's' : ''}`,
                body: `"${bidName}" closes ${closingStr}. Open Government Biddings to review.`,
                icon: '🏛️', type: 'gov_deadline', link: 'dept:Government Biddings',
                dedupKey: `gov-deadline-${bid.id}-${daysOut}-${todayStr}`
              }
            });
          });
        });
      });
    } catch (e) {
      stats.errors++;
      console.error('[scheduledDailyDigestChecks] gov bidding deadlines failed:', e.message);
    }

    // ── 5. Quote-expiry follow-ups — LATEST-revision, in-play (filed/approved,
    //      not yet converted) quotes whose validUntil is within HORIZON_DAYS
    //      (or already lapsed), so Sales chases them before they die — with
    //      priority messaging for ones shared via the /q/ client page that the
    //      client hasn't answered. Ports js/screens/sales.js latestQuoteRevisions
    //      (window.* unavailable here) with the dash-OPTIONAL /-?R\d+/ so the
    //      compact "…013R1" numbers group correctly and superseded R1s are
    //      excluded. Dept-targeted: president/manager + Sales.
    let quoteFollowupCount = 0;
    try {
      const HORIZON_DAYS = 3;
      const horizonStr = new Date(Date.parse(todayStr + 'T00:00:00Z') + HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const IN_PLAY = ['filed', 'approved'];
      const revOf = q => { const m = String(q.quoteNumber || (q.editableState && q.editableState.quoteNo) || '').match(/-?R(\d+)\s*$/i); return m ? parseInt(m[1], 10) : 1; };
      const lineageOf = q => {
        const base = String(q.quoteNumber || (q.editableState && q.editableState.quoteNo) || '').replace(/-?R\d+\s*$/i, '').trim();
        const client = (q.clientName || '').trim().toLowerCase();
        return base ? (base + '||' + client) : ('id::' + q.id);
      };
      const latestOf = (quotes) => {
        const best = new Map();
        quotes.forEach(q => {
          const k = lineageOf(q), cur = best.get(k);
          const better = !cur || revOf(q) > revOf(cur) ||
            (revOf(q) === revOf(cur) && ((q.createdAt && q.createdAt.seconds) || 0) >= ((cur.createdAt && cur.createdAt.seconds) || 0));
          if (better) best.set(k, q);
        });
        return [...best.values()];
      };

      const [qUsersSnap, bsSnap, bkSnap] = await Promise.all([
        db.collection('users').get(),
        db.collection('bs_quotes').get(),
        db.collection('bk_quotes').get()
      ]);
      const allQuotes = [...bsSnap.docs, ...bkSnap.docs].map(d => ({ id: d.id, ...d.data() }));
      const due = latestOf(allQuotes).filter(q =>
        IN_PLAY.includes(q.status) &&
        typeof q.validUntil === 'string' && /^\d{4}-\d{2}-\d{2}/.test(q.validUntil) &&
        q.validUntil <= horizonStr &&   // expiring within the horizon (or already past)
        !q.salesOrderId                  // not already converted to an order
      );
      quoteFollowupCount = due.length;

      if (due.length) {
        const awaiting = due.filter(q => q.shareToken && (!q.clientResponse || q.clientResponse.status === 'pending'));
        const label = q => `${q.quoteNumber || String(q.id).slice(-6).toUpperCase()} · ${q.clientName || 'client'}`;
        const shown = (awaiting.length ? awaiting : due).slice(0, 4).map(label).join(', ');
        const more = due.length > 4 ? ` +${due.length - 4} more` : '';
        const title = `🔔 ${due.length} quote${due.length > 1 ? 's' : ''} to follow up`;
        const body = awaiting.length
          ? `${awaiting.length} shared quote${awaiting.length > 1 ? 's' : ''} awaiting a client reply & expiring soon: ${shown}${more}. Follow up before they lapse.`
          : `${due.length} quote${due.length > 1 ? 's' : ''} expiring soon: ${shown}${more}. Follow up or re-quote.`;
        qUsersSnap.docs.forEach(doc => {
          const u = doc.data();
          if (u.status === 'inactive' || u.pendingPasswordSetup) return;
          const depts = Array.isArray(u.departments) ? u.departments
            : (typeof u.department === 'string' && u.department ? [u.department] : []);
          if (!['president', 'manager'].includes(u.role) && !depts.includes('Sales')) return;
          toNotify.push({
            ref: db.collection('notifications').doc(doc.id).collection('items').doc(),
            notifData: {
              title, body, icon: '🔔', type: 'quote_followup', link: 'dept:Sales',
              dedupKey: `quote-fu-${doc.id}-${todayStr}`
            }
          });
        });
      }
    } catch (e) {
      stats.errors++;
      console.error('[scheduledDailyDigestChecks] quote follow-ups failed:', e.message);
    }

    // ── 6. AR aging — job_projects with a PAST-DUE billing invoice (invoice.due
    //      before today) and a still-outstanding balance, so Finance chases
    //      collection instead of letting receivables silently age. AR is DERIVED
    //      (contractAmount − amountCollected, clamped ≥0) — never the stored
    //      arBalance, which is known to drift (see production.js renderProject-
    //      Lifecycle). Dept-targeted: president/manager/finance + Finance dept.
    //      Links to projects-lifecycle, where Record Payment lives.
    let arAgingCount = 0;
    try {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const [arUsersSnap, projSnap] = await Promise.all([
        db.collection('users').get(),
        db.collection('job_projects').get()
      ]);
      const overdue = [];
      projSnap.docs.forEach(d => {
        const p = { id: d.id, ...d.data() };
        if (p.stage === 'cancelled') return;
        const ar = Math.max(0, (Number(p.contractAmount) || 0) - (Number(p.amountCollected) || 0));
        if (ar <= 0) return;
        const pastDues = (Array.isArray(p.invoices) ? p.invoices : [])
          .map(iv => (iv && typeof iv.due === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iv.due)) ? iv.due.slice(0, 10) : null)
          .filter(due => due && due < todayStr);
        if (!pastDues.length) return;
        const oldest = pastDues.sort()[0];
        const daysOverdue = Math.round((Date.parse(todayStr + 'T00:00:00Z') - Date.parse(oldest + 'T00:00:00Z')) / DAY_MS);
        overdue.push({ p, ar, daysOverdue });
      });

      arAgingCount = overdue.length;
      if (overdue.length) {
        overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
        const totalAr = overdue.reduce((s, o) => s + o.ar, 0);
        const label = o => `${o.p.clientName || o.p.projectNo || 'project'} (₱${(Number(o.ar) || 0).toLocaleString('en-PH')}, ${o.daysOverdue}d)`;
        const shown = overdue.slice(0, 4).map(label).join(', ');
        const more = overdue.length > 4 ? ` +${overdue.length - 4} more` : '';
        const title = `💰 ${overdue.length} overdue receivable${overdue.length > 1 ? 's' : ''}`;
        const body = `₱${totalAr.toLocaleString('en-PH')} past due across ${overdue.length} project${overdue.length > 1 ? 's' : ''}: ${shown}${more}. Open Projects to record collection.`;
        arUsersSnap.docs.forEach(doc => {
          const u = doc.data();
          if (u.status === 'inactive' || u.pendingPasswordSetup) return;
          const depts = Array.isArray(u.departments) ? u.departments
            : (typeof u.department === 'string' && u.department ? [u.department] : []);
          if (!['president', 'manager', 'finance'].includes(u.role) && !depts.includes('Finance')) return;
          toNotify.push({
            ref: db.collection('notifications').doc(doc.id).collection('items').doc(),
            notifData: {
              title, body, icon: '💰', type: 'ar_aging', link: 'projects-lifecycle',
              dedupKey: `ar-aging-${doc.id}-${todayStr}`
            }
          });
        });
      }
    } catch (e) {
      stats.errors++;
      console.error('[scheduledDailyDigestChecks] AR aging failed:', e.message);
    }

    try {
      stats.notified = await commitInChunks(db, toNotify, null);
      console.log(`[scheduledDailyDigestChecks] ${stats.notified} notification(s) queued for ${todayStr} (gov bids flagged: ${govDeadlineCount}, quotes to follow up: ${quoteFollowupCount}, overdue receivables: ${arAgingCount})`);
    } catch (err) {
      stats.errors++;
      console.error('[scheduledDailyDigestChecks] commit failed:', err);
    }
    stats.govBidsFlagged = govDeadlineCount;
    await reportHealth(db, 'scheduledDailyDigestChecks', stats, 'Server-side deadline/low-stock/AEC/gov-bid digest');
    return null;
  });

/**
 * Phase 68 (V13-PLAN Part E, H3 completion) — server-side approval execution
 * for ca_deduct requests.
 *
 * Client-side, CashAdvance.planFor() (js/config.js ~L1663) reads the most
 * recent approved `approval_requests` doc of type 'ca_deduct' for
 * {userId, month} and trusts that doc's own `amount` field (clamped against
 * the user's live cash_advances balance at read time) to build the payroll
 * deduction plan. That is a request-doc field, not an authoritative
 * server-derived number — this trigger re-derives it the moment the request
 * flips to 'approved' and stamps the outcome back onto the request so a
 * tampered/stale `amount` can never reach payroll un-checked.
 *
 * ca_deduct request docs (client-created, js/departments.js Approvals flow)
 * carry no caId — CashAdvance.planFor() itself resolves the user's advances
 * by querying cash_advances where userId==uid && status=='approved' and
 * summing `balance` across them (oldest-first). We mirror that exact lookup
 * here rather than trusting any caId on the request.
 *
 * Idempotency: guarded by `appliedBy`. Once set (to 'server'), a re-fire of
 * this trigger (e.g. an unrelated field update on the same doc, or a retry)
 * is a no-op — the deduction is never re-applied or re-evaluated.
 */
exports.executeApprovalOnUpdate = functions
  .region('asia-east1')
  .firestore
  .document('approval_requests/{id}')
  .onUpdate(async (change, context) => {
    const db = admin.firestore();
    const { id } = context.params;
    const before = change.before.data() || {};
    const after  = change.after.data() || {};
    const stats  = { errors: 0, notified: 0 };

    try {
      // Only act on a fresh approval of a ca_deduct request that hasn't
      // already been server-applied.
      const justApproved = before.status !== 'approved' && after.status === 'approved';
      if (!justApproved || after.type !== 'ca_deduct' || after.appliedBy) {
        return null;
      }

      const uid   = after.userId;
      const month = after.month;
      const requestedAmount = Number(after.amount) || 0;

      if (!uid || !requestedAmount) {
        // Nothing sane to apply — flag for human review, but still guard so
        // we don't keep re-firing on this malformed doc.
        await change.after.ref.update({
          status: 'needs-review',
          appliedBy: 'server',
          appliedAmount: 0,
          appliedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewNote: 'ca_deduct approved with missing userId/amount — server declined to apply.'
        });
        stats.errors++;
        await reportHealth(db, 'executeApprovalOnUpdate', stats, 'ca_deduct server re-derivation');
        return null;
      }

      // Re-derive the authoritative balance the same way
      // CashAdvance.planFor() does: every approved cash_advances doc for
      // this user, balance summed (no caId trust).
      const caSnap = await db.collection('cash_advances')
        .where('userId', '==', uid).where('status', '==', 'approved').get();
      const caBalance = caSnap.docs.reduce((s, d) => s + (Number(d.data().balance) || 0), 0);
      const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

      if (requestedAmount > caBalance + 0.01) {
        // Requested more than the authoritative balance covers — reject
        // rather than over-deduct. Reviewer can re-submit a corrected amount.
        await change.after.ref.update({
          status: 'rejected',
          appliedBy: 'server',
          appliedAmount: 0,
          appliedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewNote: `Auto-rejected: requested ₱${requestedAmount.toFixed(2)} exceeds authoritative CA balance ₱${caBalance.toFixed(2)} for ${month || 'this month'}.`
        });
        console.warn(`[executeApprovalOnUpdate] ${id} rejected — requested ${requestedAmount} > balance ${caBalance} (uid ${uid})`);
      } else {
        const appliedAmount = round2(Math.min(requestedAmount, caBalance));
        await change.after.ref.update({
          appliedBy: 'server',
          appliedAmount,
          appliedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        stats.notified = 1;
        console.log(`[executeApprovalOnUpdate] ${id} applied ${appliedAmount} for uid ${uid} (${month || 'no month'})`);
      }
    } catch (e) {
      stats.errors++;
      console.error(`[executeApprovalOnUpdate] ${id} failed:`, e.message);
    }
    await reportHealth(db, 'executeApprovalOnUpdate', stats, 'ca_deduct server re-derivation');
    return null;
  });

/**
 * Phase 68 item 3 (Phase 30's deferred server half) — per-sender notification
 * rate observation.
 *
 * js/notifications.js `send()` (~L296) writes notifications/{targetUid}/items
 * docs with {title, body, icon, type, link, read, createdAt, dedupKey?,
 * taskId?, chatId?} — there is currently no sender/fromUid/createdBy field on
 * the doc itself, so per-sender attribution isn't available from the
 * notification doc alone in this release. We check a handful of plausible
 * field names defensively (senderUid/fromUid/createdBy/senderId/authorUid)
 * so this activates automatically if a future change adds one, and no-op
 * quietly otherwise rather than guessing.
 *
 * This release is observe-only: it counts sends into an hourly bucket doc
 * per sender and logs a system_health warning past the threshold. It does
 * NOT delete or block notifications — enforcement is an explicit follow-up
 * so we don't risk breaking legitimate broadcasts (digests, approvals) on a
 * first pass.
 */
const NOTIF_QUOTA_PER_HOUR = 200;

exports.sendNotificationQuota = functions
  .region('asia-east1')
  .firestore
  .document('notifications/{uid}/items/{itemId}')
  .onCreate(async (snap, context) => {
    const db = admin.firestore();
    const data = snap.data() || {};
    const stats = { errors: 0, notified: 0 };
    const senderUid = data.senderUid || data.fromUid || data.createdBy || data.senderId || data.authorUid || null;

    if (!senderUid) {
      // No sender attribution on this doc shape yet — nothing to rate-limit.
      return null;
    }

    try {
      const hourBucket = manilaDate().replace(/-/g, '') + '_' + new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
      const bucketRef = db.collection('notif_quota').doc(`${senderUid}_${hourBucket}`);

      const count = await db.runTransaction(async (tx) => {
        const doc = await tx.get(bucketRef);
        const next = (doc.exists ? (doc.data().count || 0) : 0) + 1;
        tx.set(bucketRef, {
          senderUid, hourBucket, count: next,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return next;
      });

      if (count > NOTIF_QUOTA_PER_HOUR) {
        stats.errors = 0; // not a job error — a usage warning
        console.warn(`[sendNotificationQuota] sender ${senderUid} sent ${count} notifications in bucket ${hourBucket} (threshold ${NOTIF_QUOTA_PER_HOUR})`);
        await db.collection('system_health').doc('sendNotificationQuota').set({
          job: 'sendNotificationQuota',
          lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
          lastStatus: 'warn',
          errors: 0,
          notified: 0,
          label: `sender ${senderUid} over quota: ${count}/${NOTIF_QUOTA_PER_HOUR} in ${hourBucket} (observe-only, not blocked)`
        }, { merge: true });
      } else {
        stats.notified = 1;
      }
    } catch (e) {
      stats.errors++;
      console.error('[sendNotificationQuota] failed:', e.message);
      await reportHealth(db, 'sendNotificationQuota', stats, 'Per-sender notification rate observation');
    }
    return null;
  });

/**
 * Phase 74 (V13-PLAN, ROADMAP item 4) — quote acceptance -> job costing.
 *
 * Design constraint documented in ROADMAP.md item 4: `job_costs` read is
 * finance/admin-only (margins) and `bk_quotes`/`bs_quotes` read is
 * creator-or-admin only, so a sales user accepting a quote can neither
 * dedup against job_costs nor would finance be able to read the quote
 * client-side. This trigger runs server-side (admin SDK bypasses rules)
 * so no client read friction is introduced and job_costs stays
 * finance-read-only.
 *
 * Won-status evidence (js/departments.js ~L9650, the Sales "Create Sales
 * Order" flow that is the actual quote-acceptance path):
 *   await db.collection(qc).doc(d.id).update({ salesOrderId, projectId, status:'won' })
 * `status: 'won'` is what gets WRITTEN on acceptance for both bk_quotes and
 * bs_quotes. `status === 'accepted'` also appears (js/config.js L512,
 * window.isQuoteWon) but per that same line's comment is "kept for legacy
 * `quotes` docs only" (a different, older collection) — so both values are
 * treated as terminal-win here defensively, matching the app's own
 * canonical isQuoteWon() definition, while 'won' is the one this trigger
 * will actually observe in practice.
 *
 * job_costs field names (js/modules.js jobModal/renderJobs, the only writer
 * of this collection today) are: project, quoteRef, revenue, materialsCost,
 * laborCost, otherCost. This trigger seeds those same field names so the
 * existing Job Costing UI renders the doc with no changes.
 *
 * Idempotency:
 *  - onUpdate guard: only fires when status transitions INTO won/accepted
 *    (before wasn't already won/accepted) - re-fires on unrelated field
 *    edits of an already-won quote are no-ops.
 *  - Finance-data preservation: reads the existing job_costs/{quoteId} doc
 *    first. If it already exists, this trigger updates ONLY the
 *    quote-derived descriptive fields (project/quoteRef/revenue/
 *    needsCosting) and never touches materialsCost/laborCost/otherCost, so
 *    a finance user's entered costs survive any re-fire or re-acceptance.
 *    If the doc doesn't exist yet, it seeds materialsCost/laborCost from
 *    the quote's capitalMaterials/capitalLabor fields when present (else 0,
 *    flagged needsCosting:true).
 */
function makeOnQuoteWonHandler(collectionName) {
  return async (change, context) => {
    const db = admin.firestore();
    const { id } = context.params;
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const stats = { errors: 0, notified: 0 };
    const WON_VALUES = ['won', 'accepted'];

    try {
      const wasWon = WON_VALUES.includes(before.status);
      const isWon = WON_VALUES.includes(after.status);
      if (wasWon || !isWon) {
        // Only act on a fresh transition INTO won/accepted.
        return null;
      }

      const jobCostsRef = db.collection('job_costs').doc(id);
      const existing = await jobCostsRef.get();

      const revenue = Number(after.total) || 0;
      const project = (after.client || '') + (after.qno ? ' — ' + after.qno : '');
      const quoteRef = after.qno || '';
      const hasCapital = (Number(after.capitalMaterials) || 0) > 0 || (Number(after.capitalLabor) || 0) > 0;

      if (existing.exists) {
        // Preserve any finance-entered costs — never touch cost fields on
        // an existing doc, only the quote-derived descriptive fields.
        await jobCostsRef.set({
          quoteId: id,
          quoteNumber: quoteRef,
          clientName: after.client || '',
          project,
          quoteRef,
          revenue,
          source: 'quote-accept',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        // No existing doc — seed it, including cost fields (0 / from
        // capital fields if the quote carries them).
        await jobCostsRef.set({
          quoteId: id,
          quoteNumber: quoteRef,
          clientName: after.client || '',
          project,
          quoteRef,
          revenue,
          materialsCost: hasCapital ? (Number(after.capitalMaterials) || 0) : 0,
          laborCost: hasCapital ? (Number(after.capitalLabor) || 0) : 0,
          otherCost: 0,
          needsCosting: !hasCapital,
          source: 'quote-accept',
          createdFrom: collectionName,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      stats.notified = 1;
      console.log(`[onQuoteWon:${collectionName}] ${id} -> job_costs/${id} (${existing.exists ? 'preserved existing costs' : 'seeded new doc'})`);
    } catch (e) {
      stats.errors++;
      console.error(`[onQuoteWon:${collectionName}] ${id} failed:`, e.message);
    }
    await reportHealth(db, 'onQuoteWon', stats, `Quote acceptance -> job_costs (${collectionName})`);
    return null;
  };
}

exports.onBkQuoteWon = functions
  .region('asia-east1')
  .firestore
  .document('bk_quotes/{id}')
  .onUpdate(makeOnQuoteWonHandler('bk_quotes'));

exports.onBsQuoteWon = functions
  .region('asia-east1')
  .firestore
  .document('bs_quotes/{id}')
  .onUpdate(makeOnQuoteWonHandler('bs_quotes'));

// ──────────────────────────────────────────────────────────────────────────
//  respondToQuote — CLIENT-QUOTE-PAGE-SPEC.md §4.2.
//
//  The public client-facing quote page (/q/?<token>) has NO login and NO
//  Firebase Auth session at all — not even anonymous auth. This callable is
//  therefore the ONLY write path for a client's Accept / Request-changes
//  response: firestore.rules' public_quotes block (see the match block next
//  to order_tracking) has no public create/update/delete rule anywhere, by
//  design (spec §4.1) — a rules-based public write could only ever touch the
//  mirror doc, but this feature also needs the INTERNAL bs_quotes/bk_quotes
//  doc's status flipped and Sales notified, both impossible for an anonymous
//  client under any rules. The Admin SDK bypasses rules entirely, so this one
//  function does all three server-side: validate+clamp untrusted input
//  (mirrors sendPushOnNotification's defensive style above — this is the
//  first Firestore-facing value written by a fully anonymous stranger
//  anywhere in this codebase), a Firestore TRANSACTION on the mirror doc for
//  a database-enforced once-only/replay guard (not just a UI-level check),
//  then a best-effort sync onto the internal quote + notifications.
//
//  Client call site: /q/index.html, via
//    firebase.app().functions('asia-east1').httpsCallable('respondToQuote')({token, action, name, note})
//  The region argument on the client is MANDATORY — without it the SDK
//  targets us-central1 (where this function does not exist) and every call
//  fails. No context.auth check here on purpose: the caller is, by design,
//  never signed in.
// ──────────────────────────────────────────────────────────────────────────
exports.respondToQuote = functions
  .region('asia-east1')
  .https.onCall(async (data, context) => {
    // 1. Validate & clamp. token is the public_quotes/{token} doc id — same
    // 8-24 char unambiguous-alphabet shape /q/index.html itself validates
    // client-side (spec §3.1: 8-24 so a future token-length change never
    // strands an already-shared link).
    const token  = (data && typeof data.token === 'string') ? data.token : '';
    const action = (data && typeof data.action === 'string') ? data.action : '';
    if (!/^[2-9a-zA-Z]{8,24}$/.test(token)) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid or missing token.');
    }
    if (action !== 'accept' && action !== 'request_changes') {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid action.');
    }
    const name = ((data && typeof data.name === 'string') ? data.name : '').trim().slice(0, 120);
    // Strip real control characters only (keep \n/\r/\t — this is a
    // free-text note, not a single-line field) then clamp length.
    const stripControlChars = (s) => String(s == null ? '' : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    const note = stripControlChars((data && typeof data.note === 'string') ? data.note : '').slice(0, 2000).trim();
    if (action === 'request_changes' && !note) {
      throw new functions.https.HttpsError('invalid-argument', 'A note is required to request changes.');
    }

    const db = admin.firestore();
    const mirrorRef = db.collection('public_quotes').doc(token);
    const newStatus = action === 'accept' ? 'accepted' : 'changes_requested';

    // 2. Transaction on the mirror — not-exists / already-responded / expired
    // are all checked and written atomically so a replayed/parallel call can
    // never double-record a response (the once-only guard lives HERE, at the
    // database, not in the UI).
    let mirrorData;
    try {
      mirrorData = await db.runTransaction(async (tx) => {
        const snap = await tx.get(mirrorRef);
        if (!snap.exists) {
          throw new functions.https.HttpsError('not-found', 'This quote link is no longer available.');
        }
        const cur = snap.data() || {};
        const curResponseStatus = (cur.clientResponse && cur.clientResponse.status) || 'pending';
        if (curResponseStatus !== 'pending') {
          throw new functions.https.HttpsError('failed-precondition', 'A response was already recorded for this quotation.');
        }
        // Accept is blocked past validUntil (server-enforced — client-side
        // hiding of the button is cosmetic only). Request-changes stays open
        // past expiry on purpose: "please re-quote" is exactly the message an
        // expired client sends.
        if (action === 'accept' && cur.validUntil) {
          const todayStr = manilaDate();
          if (todayStr > cur.validUntil) {
            throw new functions.https.HttpsError('failed-precondition', 'This quotation has expired — please request an updated quote.');
          }
        }
        // Reveal-on-accept (go-live decision) — bankDetails are NEVER on the
        // mirror pre-accept (buildPublicQuoteDoc writes ''), so a link-holder
        // cannot read the deposit account from the raw doc before accepting.
        // On ACCEPT only, pull them from the source quote and write them onto
        // the mirror in this same atomic step. Both reads (mirror above, source
        // here) precede the write — valid transaction ordering. shareToken must
        // still match, so a stale/re-shared mirror can't reveal a moved quote's
        // account.
        let revealedBank = '';
        if (action === 'accept') {
          const src = cur.src || {};
          const scoll = (src.coll === 'bs_quotes' || src.coll === 'bk_quotes') ? src.coll : null;
          if (scoll && src.id) {
            const qSnap = await tx.get(db.collection(scoll).doc(src.id));
            if (qSnap.exists && qSnap.data().shareToken === token) revealedBank = qSnap.data().bankDetails || '';
          }
        }
        const mirrorUpdate = {
          status: newStatus,
          clientResponse: { status: newStatus, name, note, respondedAt: admin.firestore.FieldValue.serverTimestamp() },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (revealedBank) mirrorUpdate.bankDetails = revealedBank;
        tx.update(mirrorRef, mirrorUpdate);
        return { ...cur, _revealedBank: revealedBank };
      });
    } catch (e) {
      if (e instanceof functions.https.HttpsError) throw e;
      console.error('[respondToQuote] transaction failed:', e.message);
      throw new functions.https.HttpsError('internal', 'Could not record your response — please try again.');
    }

    // 3. Best-effort: sync the internal quote + notify Sales/president. Never
    // rolled into the client's response — the transaction above already
    // committed, so any failure here is logged, not surfaced to the caller.
    try {
      const src = (mirrorData && mirrorData.src) || {};
      // Never trust src.coll as a raw path segment — allowlist first.
      const coll = (src.coll === 'bs_quotes' || src.coll === 'bk_quotes') ? src.coll : null;
      const quoteId = (typeof src.id === 'string' && src.id) ? src.id : '';
      if (coll && quoteId) {
        const qRef = db.collection(coll).doc(quoteId);
        const qSnap = await qRef.get();
        // Only flip the internal quote if it still points at THIS mirror — a
        // stale mirror left over from a re-share/revision must never touch a
        // quote that has since moved on.
        if (qSnap.exists && qSnap.data().shareToken === token) {
          const internalStatus = newStatus === 'accepted' ? 'accepted' : 'needs_revision';
          const clientResponse = { status: newStatus, name, note, respondedAt: admin.firestore.FieldValue.serverTimestamp() };
          await qRef.update({
            status: internalStatus,
            clientResponse,
            clientRespondedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Notify: quote creator + the president (if different).
          const notifyUids = new Set();
          const createdBy = qSnap.data().createdBy;
          if (createdBy) notifyUids.add(createdBy);
          try {
            const presSnap = await db.collection('users').where('role', '==', 'president').limit(1).get();
            presSnap.docs.forEach((d) => notifyUids.add(d.id));
          } catch (e) {
            console.error('[respondToQuote] president lookup failed:', e.message);
          }

          const title = newStatus === 'accepted' ? 'Quote accepted 🎉' : 'Changes requested';
          const clientName = mirrorData.clientName || name || 'Client';
          const quoteNumber = mirrorData.quoteNumber || quoteId;
          const total = Number(mirrorData.total) || 0;
          const noteSuffix = note ? (' — ' + note.slice(0, 140)) : '';
          const body = `${clientName} · ${quoteNumber} · ₱${total.toLocaleString('en-PH')}${noteSuffix}`;

          // Exact Notifs.send shape (js/notifications.js) so the existing
          // in-app inbox/toast pipeline + sendPushOnNotification (above) pick
          // this up with zero client-side changes.
          await Promise.all(Array.from(notifyUids).map((uid) =>
            db.collection('notifications').doc(uid).collection('items').add({
              title, body,
              icon: newStatus === 'accepted' ? '🎉' : '✏️',
              type: 'quote_response',
              link: null,
              read: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }).catch((e) => console.error('[respondToQuote] notify failed for', uid, e.message))
          ));
        }
      }
    } catch (e) {
      console.error('[respondToQuote] internal quote sync failed (client response was already recorded):', e.message);
    }

    // 5. Return.
    return { ok: true, status: newStatus, bankDetails: (mirrorData && mirrorData._revealedBank) || '' };
  });

// ──────────────────────────────────────────────────────────────────────────
//  recordAttendancePunch (v14 P0 attendance-integrity fix)
//
//  THE PROBLEM THIS CLOSES: js/screens/worker.js's Type-B self-service
//  Time In/Out used to write inValid/outValid/timeIn/timeOut/hoursWorked
//  DIRECTLY from the client after doing its own geofence check in the
//  browser. firestore.rules' old self-service write rule trusted that
//  client-computed verdict outright (defaulting inValid/outValid to true with
//  no independent check) and had no server-side bound on which calendar date
//  a record could be written to. A worker with devtools (or a Fake-GPS app)
//  could therefore assert an on-site, valid-looking, or even BACKDATED shift
//  from anywhere — this is real pay, so that trust boundary was the actual
//  bug. This callable moves EVERY decision that determines whether a shift
//  gets paid onto the server, using the Admin SDK (which bypasses
//  firestore.rules entirely, so it works correctly regardless of what the
//  client-side rules currently allow — see the deploy-order note in the
//  accompanying report):
//    • Re-resolves the caller's worker_profiles doc server-side (linkedUid ==
//      auth uid), rejecting if none exists or the profile is inactive — the
//      client's own uid/profile pairing is never trusted as-is.
//    • RECOMPUTES the haversine geofence against geo_sites (active==true)
//      itself (see serverSiteMatch below — a hand-synced mirror of
//      js/geo-core.js's siteMatch/haversineMeters; Cloud Functions deploy
//      only bundles the functions/ directory per firebase.json, so this file
//      can't require() that sibling file directly).
//    • Rejects a GPS accuracy that's missing, non-positive, or coarser than
//      GEO_ACCURACY_FLOOR_M — a fix this unreliable can't be trusted to prove
//      anything about a geofence, no matter what distance it implies.
//    • Verifies the selfie: the URL must parse as this exact worker's own
//      attendance-selfies/{uid}/ Storage path, AND the object must actually
//      exist in the bucket (not just a well-formed URL) — fails CLOSED (an
//      unverifiable selfie is treated as invalid, not waved through) since
//      this is the core anti-fraud check, unlike the lower-stakes
//      fail-open quota checks elsewhere in this file.
//    • Bounds the record to a SERVER-computed Manila calendar day: Time In
//      always targets today; Time Out targets whichever shift the server
//      itself finds still open (today's, or an unclosed prior day's — see
//      resolveActiveRecordServer, a server-side twin of worker.js's
//      _resolveActiveRecord). The device clock is never consulted for either.
//    • Derives hoursWorked for Time Out from its OWN immutable server
//      timestamps (inAt/outAt, both admin.firestore.Timestamp.now() at the
//      moment each call runs) — never the device clock — and stamps
//      needsReview:true whenever the result exceeds MAX_SHIFT_HOURS (a
//      forgotten-clockout style shift is still recorded, but flagged before
//      it can reach payroll unchecked; the sibling HR "Load Kiosk Hours" view
//      surfaces this exact field).
//    • Is the SOLE writer of inValid/outValid/timeIn/timeOut/hoursWorked —
//      js/screens/worker.js's direct client write of these fields has been
//      REMOVED (not kept as a fallback); the only client-direct writes left
//      on this doc are the pre-punch audit `attempts` array and an advisory
//      `pendingPunch` marker for the offline queue UI (see report for the
//      accompanying firestore.rules tightening that makes this enforced,
//      not just voluntary).
//
//  Client call site: js/screens/worker.js _finishClockSubmission, via
//  firebase.functions().httpsCallable('recordAttendancePunch')({kind, lat,
//  lng, accuracy, selfieUrl, recordDate}). No .region() is set here (default
//  us-central1), matching this file's other onCall exports (adminResetPassword,
//  backfillUserClaims) and the client's own un-regioned httpsCallable() calls.
// ──────────────────────────────────────────────────────────────────────────

// Mirrors js/geo-core.js's GEO_ACCURACY_FLOOR_M — kept in sync by hand (see
// that file's own comment on why this can't be a shared import across the
// functions/ deploy boundary).
const GEO_ACCURACY_FLOOR_M = 100;

// A shift still open past this many hours is almost certainly a forgotten
// clock-out, not a real 16+ hour shift — recorded, but flagged for HR review
// rather than silently trusted for pay. Mirrors js/screens/worker.js's
// WB_MAX_SHIFT_HOURS (that copy only gates a client-side confirm dialog; THIS
// copy is what actually determines needsReview on the paid record).
const MAX_SHIFT_HOURS = 16;

// v14 P1.x offline-punch-time fix (OFFLINE-PUNCH-SPEC.md) — the
// `queuedPunchAt` trust contract. Oldest on-site instant a queued offline
// replay may claim. Matches the resolver depth (effective day + 1 prior day
// ≈ 48h): older punches can't land on a resolvable record anyway, and a
// >2-day self-served backdate is an HR manual-entry case, never a
// self-service one.
const QUEUED_PUNCH_MAX_AGE_MS = 48 * 60 * 60 * 1000;
// Device clocks (source of queuedAt = Date.now()) may skew slightly ahead
// of the server. Within this grace the claim is clamped to server-now;
// beyond it the claim is discarded as implausible (see classification).
const QUEUED_PUNCH_FUTURE_GRACE_MS = 2 * 60 * 1000;

// Same great-circle formula as js/geo-core.js's window.haversineMeters,
// hand-copied — see the comment block above on why this file can't
// require() that sibling module.
function haversineMetersServer(lat1, lng1, lat2, lng2) {
  lat1 = Number(lat1); lng1 = Number(lng1); lat2 = Number(lat2); lng2 = Number(lng2);
  if ([lat1, lng1, lat2, lng2].some((n) => !Number.isFinite(n))) return NaN;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c; // WGS-84 mean Earth radius, meters
}

// Same "nearest-site-wins, accuracy is an anti-fraud-safe margin" semantics
// as js/geo-core.js's window.siteMatch (see that file's header) — hand-synced
// server twin, not a shared import (see comment block above).
function serverSiteMatch(lat, lng, accuracy, sites) {
  const active = (Array.isArray(sites) ? sites : []).filter((s) => s && s.active);
  const withDistance = active.map((s) => ({
    siteId: s.id,
    name: s.name || '',
    distanceM: haversineMetersServer(lat, lng, s.lat, s.lng),
    radiusM: Number(s.radiusM) || 0
  })).filter((s) => Number.isFinite(s.distanceM));
  if (!withDistance.length) return { inRange: false, nearest: null };
  const inRangeSites = withDistance.filter((s) => (s.distanceM + accuracy) <= s.radiusM);
  const pool = inRangeSites.length ? inRangeSites : withDistance;
  const nearest = pool.reduce((best, s) => (!best || s.distanceM < best.distanceM) ? s : best, null);
  return { inRange: inRangeSites.length > 0, nearest };
}

// Manila "HH:MM" — same UTC+8 shift-then-read trick as manilaDate() above
// (Asia/Manila has no DST, so a fixed offset never drifts). Mirrors
// js/screens/worker.js's _workerBizTimeHM.
function manilaTimeHM(date) {
  const shifted = new Date((date || new Date()).getTime() + 8 * 60 * 60 * 1000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Extract the attendance-selfies object path from a Storage download URL and
// confirm it belongs to THIS uid's own folder — never trust a client-supplied
// selfieUrl string at face value. Returns the decoded object path, or null if
// the URL doesn't parse as a Firebase Storage download URL under
// attendance-selfies/{uid}/.
function parseOwnSelfiePath(url, uid) {
  try {
    const u = new URL(url);
    if (!/(^|\.)firebasestorage\.googleapis\.com$/i.test(u.hostname)
      && !/(^|\.)storage\.googleapis\.com$/i.test(u.hostname)) {
      return null;
    }
    const m = u.pathname.match(/\/o\/([^/?]+(?:%2F[^/?]+)*)/i) || u.pathname.match(/\/o\/(.+)$/);
    if (!m) return null;
    const objectPath = decodeURIComponent(m[1]);
    const expectedPrefix = `attendance-selfies/${uid}/`;
    return objectPath.startsWith(expectedPrefix) ? objectPath : null;
  } catch (e) {
    return null;
  }
}

// Server-side twin of js/screens/worker.js's _resolveActiveRecord — same
// cross-midnight semantics, same reasoning (see that function's header):
// Time Out must close whichever shift is still open, today's or an unclosed
// prior day's, or the Manila-day boundary silently splits one shift into two
// broken records.
async function resolveActiveRecordServer(base, todayStr) {
  const todayRef = base.doc(todayStr);
  const todaySnap = await todayRef.get();
  const todayData = todaySnap.exists ? todaySnap.data() : null;
  if (todayData && todayData.timeIn && !todayData.timeOut) {
    return { dateStr: todayStr, ref: todayRef, data: todayData };
  }
  if (!todayData || !todayData.timeIn) {
    // v14 P1.x offline-punch-time fix — "yesterday" must be relative to the
    // EFFECTIVE day (todayStr, which for a queued replay can itself be a
    // past Manila day), never the server's own clock. Pure calendar-string
    // decrement, TZ-independent (Asia/Manila has no DST). For a live punch
    // todayStr === the server's own Manila day, so this yields the identical
    // result as the old Date.now()-based computation — one code path, no
    // branch needed.
    const yestStr = new Date(Date.parse(todayStr + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    const yestRef = base.doc(yestStr);
    const yestSnap = await yestRef.get();
    const yestData = yestSnap.exists ? yestSnap.data() : null;
    if (yestData && yestData.timeIn && !yestData.timeOut) {
      return { dateStr: yestStr, ref: yestRef, data: yestData };
    }
  }
  return { dateStr: todayStr, ref: todayRef, data: todayData || {} };
}

exports.recordAttendancePunch = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
  }
  const uid = context.auth.uid;
  const db = admin.firestore();

  const kind = data && data.kind;
  if (kind !== 'in' && kind !== 'out') {
    throw new functions.https.HttpsError('invalid-argument', 'kind must be "in" or "out".');
  }

  // v14 P1.x offline-punch-time fix (OFFLINE-PUNCH-SPEC.md §1.2) —
  // `queuedPunchAt` trust contract. Parsed/classified immediately, BEFORE any
  // Firestore/Storage work, so a hard reject (too-old) costs nothing. Exactly
  // one of four states: absent (live punch — byte-identical to pre-fix
  // behavior), valid, degraded (malformed/future — claim discarded, punch
  // kept), too-old (hard reject, nothing written).
  const rawQueuedAt = data && data.queuedPunchAt;          // epoch ms, optional
  const nowMs = Date.now();                                 // one server "now" for classification

  let queuedReplay = false;      // true for BOTH valid and degraded claims
  let effectiveMs = nowMs;       // the instant that gets RECORDED
  let claimDegraded = null;      // 'malformed' | 'future' | null

  if (rawQueuedAt !== undefined && rawQueuedAt !== null) {
    queuedReplay = true;
    const isPositiveFiniteNumber = typeof rawQueuedAt === 'number' && Number.isFinite(rawQueuedAt) && rawQueuedAt > 0;

    if (isPositiveFiniteNumber && rawQueuedAt < nowMs - QUEUED_PUNCH_MAX_AGE_MS) {
      // too-old — HARD REJECT before any doc writes. Honoring it is a 48h+
      // backdating hole; recording it at server-now would fabricate a shift
      // on today's date the worker never punched. HR kiosk hand-entry is the
      // designed correction path.
      throw new functions.https.HttpsError('failed-precondition',
        'This queued punch is more than 48 hours old and can no longer be self-submitted — ask HR/Finance to enter this shift manually.',
        { permanent: true, reason: 'queued-punch-too-old' });
    }

    if (isPositiveFiniteNumber && rawQueuedAt <= nowMs + QUEUED_PUNCH_FUTURE_GRACE_MS) {
      // valid — never a future time (future-skew clamp).
      effectiveMs = Math.min(rawQueuedAt, nowMs);
    } else {
      // degraded — malformed (non-number/NaN/±Infinity/<=0) or >2min future.
      // Why not reject: rejecting turns a client bug / bad device clock into
      // a lost punch for an honest worker, while accepting-at-server-now
      // gives an attacker exactly what they'd get with no parameter at all —
      // nothing. Never backdates.
      claimDegraded = isPositiveFiniteNumber ? 'future' : 'malformed';
      effectiveMs = nowMs;
    }
  }

  // Derived values used everywhere below. For a live punch (queuedReplay ===
  // false) effectiveTs is a fresh Timestamp.now() — same call, same spot,
  // same behavior as before this fix; the live path is unchanged.
  const effectiveTs = queuedReplay ? admin.firestore.Timestamp.fromMillis(effectiveMs)
                                    : admin.firestore.Timestamp.now();
  const lagMin = queuedReplay ? Math.max(0, Math.round((nowMs - effectiveMs) / 60000)) : 0;

  const lat = Number(data && data.lat);
  const lng = Number(data && data.lng);
  const accuracy = Number(data && data.accuracy);
  const selfieUrl = (data && typeof data.selfieUrl === 'string') ? data.selfieUrl.trim() : '';
  // NOTE: the client also sends `data.recordDate` (a UX hint matching what its
  // own clock card is showing) — deliberately never read here. The whole
  // point of this function is that the record's date is a SERVER-derived
  // value (see resolveActiveRecordServer/manilaDate below), never a
  // client-supplied one; trusting it would reopen the exact backdating hole
  // this callable exists to close.

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid position is required.');
  }
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > GEO_ACCURACY_FLOOR_M) {
    throw new functions.https.HttpsError('failed-precondition', 'GPS accuracy too weak to verify — move to open air and try again.');
  }
  if (!selfieUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'A selfie is required.');
  }

  // Selfie must be this worker's OWN attendance-selfies object, and must
  // actually exist in the bucket — fails CLOSED on any doubt (see header).
  const objectPath = parseOwnSelfiePath(selfieUrl, uid);
  if (!objectPath) {
    throw new functions.https.HttpsError('invalid-argument', 'Selfie is missing or not recognized as yours.');
  }
  try {
    const [exists] = await admin.storage().bucket().file(objectPath).exists();
    if (!exists) {
      throw new functions.https.HttpsError('invalid-argument', 'Selfie upload could not be verified — try again.');
    }
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('[recordAttendancePunch] storage existence check failed:', e.message);
    throw new functions.https.HttpsError('internal', 'Could not verify the selfie upload — try again.');
  }

  // Resolve the caller's linked, active worker_profiles doc — the
  // linkedUid bridge documented in js/screens/worker.js's file header.
  const profSnap = await db.collection('worker_profiles').where('linkedUid', '==', uid).limit(1).get();
  if (profSnap.empty) {
    throw new functions.https.HttpsError('failed-precondition', 'Your account is not linked to a Worker Profile. Ask HR to link it.');
  }
  const profileDoc = profSnap.docs[0];
  const profileId = profileDoc.id;
  const profile = profileDoc.data();
  if (profile.status === 'inactive') {
    throw new functions.https.HttpsError('permission-denied', 'Your worker profile is inactive.');
  }

  // RECOMPUTE the geofence server-side — the client's own verdict (which ran
  // this same check first, for fast UI feedback) is never trusted as final.
  const sitesSnap = await db.collection('geo_sites').where('active', '==', true).get();
  const sites = sitesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!sites.length) {
    throw new functions.https.HttpsError('failed-precondition', 'No active work sites are configured.');
  }
  const match = serverSiteMatch(lat, lng, accuracy, sites);
  if (!match.inRange) {
    const msg = match.nearest
      ? `You are ${Math.round(match.nearest.distanceM)}m from ${match.nearest.name} — outside the allowed radius.`
      : 'Not within range of any active work site.';
    throw new functions.https.HttpsError('failed-precondition', msg);
  }

  const base = db.collection('attendance_worker').doc(profileId).collection('records');
  // v14 P1.x offline-punch-time fix — serverTodayStr is the server's own
  // Manila calendar day (for guards/audit); todayStr is the punch's
  // EFFECTIVE Manila day and drives all record targeting. For a live punch
  // these are identical (effectiveTs === a fresh Timestamp.now()), so the
  // live path is unchanged. For a queued replay, todayStr can be up to 2
  // calendar days before serverTodayStr and never after it (future clamp).
  const serverTodayStr = manilaDate();
  const todayStr = manilaDate(effectiveTs.toDate());

  let targetDateStr, targetRef, existingData;
  let laterShiftOpen = false;
  let outBeforeIn = false;
  if (kind === 'in') {
    // Block a second concurrent Time In while a shift — today's, or an
    // unclosed prior day's — is already open. Evaluated against the
    // EFFECTIVE day, so a queued past-day replay is checked against ITS own
    // day, not the server's calendar today. Covers the duplicate-replay case
    // too: if a replay's first attempt actually landed server-side but the
    // client saw a network error and retries, the retry hits this guard and
    // the client drops the dupe (worker.js §3.3).
    const active = await resolveActiveRecordServer(base, todayStr);
    if (active.data && active.data.timeIn && !active.data.timeOut) {
      throw new functions.https.HttpsError('failed-precondition',
        `You already have an open shift from ${active.dateStr} (timed in ${active.data.timeIn}) — time out first.`,
        { permanent: true, reason: 'shift-already-open' });
    }

    // NEW (OFFLINE-PUNCH-SPEC §1.5.2) — already-recorded guard: a Time In
    // already on file for the effective day, open OR closed, can never be
    // overwritten by a second 'in' — otherwise a crafted queued replay could
    // move an already-recorded timeIn EARLIER (the clobber-backdate attack).
    // Reuses this read as existingData below rather than re-fetching after
    // field assembly. Applied to live punches too — deliberate tightening
    // that also fixes the latent quirk where a second live 'in' on a
    // completed day silently overwrote timeIn.
    targetDateStr = todayStr;
    targetRef = base.doc(todayStr);
    const freshSnap = await targetRef.get();
    existingData = freshSnap.exists ? freshSnap.data() : {};
    if (existingData.timeIn) {
      throw new functions.https.HttpsError('failed-precondition',
        `A Time In is already recorded for ${todayStr}.`,
        { permanent: true, reason: 'already-recorded' });
    }

    // NEW (OFFLINE-PUNCH-SPEC §1.5.3) — later-open-shift check, queued
    // past-day 'in' only: a queued 'in' landing on a PAST effective day must
    // not be rejected just because the worker has since punched in again
    // live on a later day — that's real, separate history (e.g. Monday's
    // queued 'in' never synced; Tuesday's live 'in' is legitimate).
    // needsReview is already forced for a queued claim, so HR sees the
    // dangling open pair. Never redirects the target — the record still
    // lands on todayStr (the effective day). At most 2 doc reads (48h max
    // window).
    if (queuedReplay && todayStr < serverTodayStr) {
      let cursor = todayStr;
      while (cursor < serverTodayStr) {
        cursor = new Date(Date.parse(cursor + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
        const laterSnap = await base.doc(cursor).get();
        const laterData = laterSnap.exists ? laterSnap.data() : null;
        if (laterData && laterData.timeIn && !laterData.timeOut) { laterShiftOpen = true; break; }
      }
    }
  } else {
    // Effective todayStr — a punch queued 23:50 that replays 00:10 next
    // Manila day has effective day = the PRIOR day and resolves that day's
    // open shift directly; a shift that crossed midnight before the punch
    // still resolves via the resolver's own prior-day branch (now
    // effective-relative, see resolveActiveRecordServer above).
    const active = await resolveActiveRecordServer(base, todayStr);
    if (!active.data || !active.data.timeIn || active.data.timeOut) {
      throw new functions.https.HttpsError('failed-precondition', 'No open shift found to time out.',
        { permanent: true, reason: 'no-open-shift' });
    }
    targetDateStr = active.dateStr;
    targetRef = active.ref;
    existingData = active.data;
  }

  // effectiveTs (classified above) is used for BOTH the stored inAt/outAt and
  // the hoursWorked math below — a concrete Timestamp value (not the
  // FieldValue.serverTimestamp() sentinel) because we need its actual value
  // immediately, in this same invocation, not just once Firestore resolves
  // the write. For a live punch it's the same Timestamp.now() this used to
  // be inline here; nowMs (classification-time Date.now()) is the separate
  // provenance/audit "now" used below.
  const timeStr = manilaTimeHM(effectiveTs.toDate());
  const distanceM = Math.round(match.nearest.distanceM);
  const accuracyRounded = Math.round(accuracy);

  const fields = { pendingPunch: admin.firestore.FieldValue.delete() };
  let needsReview = false;
  let hoursWorked = null;

  if (kind === 'in') {
    fields.timeIn = timeStr;
    fields.inLat = lat;
    fields.inLng = lng;
    fields.inDistanceM = distanceM;
    fields.inAccuracyM = accuracyRounded;
    fields.inSiteId = match.nearest.siteId;
    fields.inSelfieUrl = selfieUrl;
    fields.inValid = true;
    fields.inAt = effectiveTs;
    if (queuedReplay) {
      // Per-kind provenance (OFFLINE-PUNCH-SPEC §1.7) — absent entirely on
      // live punches (see the `if (queuedReplay)` guard).
      fields.inPunchSource = 'queued';
      fields.inSyncLagMin = lagMin;
      if (claimDegraded) fields.inClaimDegraded = claimDegraded;
    }
  } else {
    fields.timeOut = timeStr;
    fields.outLat = lat;
    fields.outLng = lng;
    fields.outDistanceM = distanceM;
    fields.outAccuracyM = accuracyRounded;
    fields.outSiteId = match.nearest.siteId;
    fields.outSelfieUrl = selfieUrl;
    fields.outValid = true;
    fields.outAt = effectiveTs;
    if (queuedReplay) {
      fields.outPunchSource = 'queued';
      fields.outSyncLagMin = lagMin;
      if (claimDegraded) fields.outClaimDegraded = claimDegraded;
    }

    // hoursWorked from IMMUTABLE SERVER timestamps — never the device clock.
    let inMs = null;
    if (existingData.inAt && typeof existingData.inAt.toMillis === 'function') {
      inMs = existingData.inAt.toMillis();
    } else if (existingData.timeIn) {
      // Legacy/pre-fix open shift with no server inAt (predates this
      // deploy) — fall back to the device-clock HH:MM the old client wrote,
      // anchored to the shift's own date. Lower-trust input, so always
      // flagged for review regardless of the resulting duration.
      const fallback = new Date(`${targetDateStr}T${existingData.timeIn}:00+08:00`);
      if (!isNaN(fallback.getTime())) { inMs = fallback.getTime(); needsReview = true; }
    }
    if (inMs != null) {
      hoursWorked = Math.max(0, (effectiveTs.toMillis() - inMs) / 3600000);
      // Claimed out before the recorded in (OFFLINE-PUNCH-SPEC §1.6) — the
      // Math.max(0, …) above already clamps to 0 hours (can never overpay);
      // this just flags it for HR. Review is already forced whenever this
      // matters (queuedReplay), but the flag is harmless to compute either way.
      if (effectiveTs.toMillis() < inMs) outBeforeIn = true;
    } else {
      hoursWorked = 0;
      needsReview = true; // couldn't derive a trustworthy in-time at all
    }
    if (hoursWorked > MAX_SHIFT_HOURS) needsReview = true;
    fields.hoursWorked = Math.round(hoursWorked * 100) / 100;
    if (needsReview) fields.needsReview = true;
  }

  // Forced review (OFFLINE-PUNCH-SPEC §1.7) — ANY claimed time, both kinds,
  // is always lower-trust: every request carrying queuedPunchAt gets
  // needsReview:true, even a 30-second lag. Never set to false here — this
  // only ever ADDS the flag, never clobbers a prior true from the branch
  // above.
  if (queuedReplay) fields.needsReview = true;

  const writeFields = { ...fields };
  if (queuedReplay) {
    // Server-written audit entry (OFFLINE-PUNCH-SPEC §1.7) — appended to the
    // same attempts[] array the client and geofence-failure paths already
    // use, inside this one write. ISO strings only — FieldValue.
    // serverTimestamp() is illegal inside arrayUnion, never a sentinel here.
    const corroborated = !!(existingData && existingData.pendingPunch &&
      existingData.pendingPunch.queuedAt === rawQueuedAt);
    writeFields.attempts = admin.firestore.FieldValue.arrayUnion({
      kind, valid: true, queuedReplay: true,
      claimedPunchAt: new Date(effectiveMs).toISOString(),      // what got recorded
      rawQueuedPunchAt: Number.isFinite(rawQueuedAt) ? new Date(rawQueuedAt).toISOString() : String(rawQueuedAt),
      serverSyncAt: new Date(nowMs).toISOString(),
      syncLagMin: lagMin,
      ...(claimDegraded ? { claimDegraded } : {}),
      ...(laterShiftOpen ? { laterShiftOpen: true } : {}),
      ...(outBeforeIn ? { outBeforeIn: true } : {}),
      // Soft corroboration only — an HR signal, never gates acceptance (the
      // client's advisory pendingPunch marker write is best-effort and can
      // legitimately be absent).
      corroborated,
      note: 'Offline queued replay — recorded at the claimed on-site time; flagged for HR review.',
      atServer: new Date(nowMs).toISOString()
    });
  }

  await targetRef.set({
    workerId: profileId,
    date: targetDateStr,
    recordedBy: uid,
    recordedByName: profile.name || '',
    recordedAt: admin.firestore.FieldValue.serverTimestamp(),
    // v14 attendance — explicit provenance: a record written by THIS callable is
    // geofence+selfie server-verified (js/screens/hr.js _hrVerifiedBadge reads it).
    // HR-kiosk hand-entries never set it, so they correctly show no verified badge.
    serverVerified: true,
    ...writeFields
  }, { merge: true });

  let message = kind === 'in'
    ? `Timed in at ${timeStr} — ${match.nearest.name}`
    : `Timed out at ${timeStr}`;
  if (queuedReplay) {
    message += ` (${targetDateStr}, synced ${lagMin} min late — flagged for HR review)`;
  }

  return {
    ok: true,
    message,
    timeStr,
    siteName: match.nearest.name,
    hoursWorked: kind === 'out' ? fields.hoursWorked : null,
    needsReview: !!fields.needsReview,
    queuedReplay,
    lagMin,
    recordedDate: targetDateStr,
    ...(claimDegraded ? { claimDegraded } : {})
  };
});
