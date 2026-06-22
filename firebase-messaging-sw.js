// ═══════════════════════════════════════════════════════
//  Barro Industries — Firebase Cloud Messaging Service Worker
//  Handles push notifications when the app is in the background
//  (phone, laptop, tablet/iPad — any device with a browser)
//
//  SETUP REQUIRED:
//  1. Go to Firebase Console → Project Settings → Cloud Messaging
//  2. Generate a Web Push certificate (VAPID key)
//  3. Copy the VAPID key into config.js → FCM_CONFIG.VAPID_KEY
// ═══════════════════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Must match the config in firebase-config.js
firebase.initializeApp({
  apiKey:            "AIzaSyA1-fDeMCxTsUm29O49l954Ez5BqbyHijk",
  authDomain:        "barro-industries.firebaseapp.com",
  projectId:         "barro-industries",
  storageBucket:     "barro-industries.firebasestorage.app",
  messagingSenderId: "700081895848",
  appId:             "1:700081895848:web:265511313b4ff74575459d"
});

const messaging = firebase.messaging();

// Remembers notifIds shown in the last minute so an at-least-once redelivery
// (or a Cloud Functions retry) of the SAME notification doesn't render again.
// The SW stays alive across a burst of duplicate pushes (they arrive within
// milliseconds), so this reliably collapses the "same notif up to 5x" case.
const _shownNotifIds = new Set();

// Handle background messages. Messages are now DATA-ONLY (see functions/index.js),
// so this handler is the single place a notification is rendered — the FCM SDK
// no longer auto-displays a second copy.
messaging.onBackgroundMessage(payload => {
  const data = payload.data || {};
  const notifTitle = data.title || 'Barro Industries';
  const notifBody  = data.body  || 'You have a new notification.';
  const notifId    = data.notifId || '';

  // Drop duplicate deliveries of the same notification doc.
  if (notifId) {
    if (_shownNotifIds.has(notifId)) return;
    _shownNotifIds.add(notifId);
    setTimeout(() => _shownNotifIds.delete(notifId), 60000);
  }

  // Stable tag (one per notification doc) → even if a duplicate slips past the
  // in-memory guard, the OS collapses it instead of stacking a second copy.
  const tag = notifId || ('bi-' + (data.type || 'general'));

  // Belt-and-suspenders: close any already-visible notification with this tag
  // before showing, so a redelivery can never leave two on screen.
  self.registration.getNotifications({ tag }).then(existing => {
    existing.forEach(n => n.close());
    self.registration.showNotification(notifTitle, {
      body:     notifBody,
      icon:     '/icons/icon-192.png',
      badge:    '/icons/barro-logo.png',
      tag:      tag,
      renotify: false,
      data:     data,
      vibrate:  [200, 100, 200],
      actions:  [{ action: 'open', title: 'Open App' }]
    });
  });
});

// When user taps the notification, open/focus the app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
