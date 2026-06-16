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

// Handle background messages (app closed or in background tab)
messaging.onBackgroundMessage(payload => {
  const { title, body, icon } = payload.notification || {};
  const data = payload.data || {};
  const notifTitle = title || 'Barro Industries';
  const notifBody  = body  || 'You have a new notification.';

  // Use unique notifId so each notification shows independently (not replace-on-same-tag)
  const tag = data.notifId || (data.type + '-' + Date.now());

  self.registration.showNotification(notifTitle, {
    body:    notifBody,
    icon:    icon || '/icons/icon-192.png',
    badge:   '/icons/barro-logo.png',
    tag:     tag,
    data:    data,
    vibrate: [200, 100, 200],
    actions: [{ action: 'open', title: 'Open App' }]
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
