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
