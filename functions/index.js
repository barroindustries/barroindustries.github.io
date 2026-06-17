const functions = require('firebase-functions');
const admin     = require('firebase-admin');
admin.initializeApp();

/**
 * Fires whenever a notification doc is written to notifications/{uid}/items/{itemId}.
 * Looks up the user's FCM token and sends a device push.
 */
exports.sendPushOnNotification = functions.firestore
  .document('notifications/{uid}/items/{itemId}')
  .onCreate(async (snap, context) => {
    const { uid } = context.params;
    const { title, body, type } = snap.data();

    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) return null;
    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) return null;

    const { itemId } = context.params;
    const message = {
      token: fcmToken,
      notification: {
        title: title || 'Barro Industries',
        body:  body  || 'You have a new notification.',
      },
      // Pass type + unique ID as data so the SW can use them
      data: {
        type:    type    || 'general',
        notifId: itemId,               // unique per notification doc
        uid:     uid,
      },
      webpush: {
        notification: {
          icon:     '/icons/icon-192.png',
          badge:    '/icons/barro-logo.png',
          tag:      itemId,            // unique → notifications stack, not replace
          renotify: true,              // vibrate/sound even if same tag unlikely
        },
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
