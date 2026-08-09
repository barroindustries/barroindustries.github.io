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

// Wave1 P0 fix #3 — nudges the OS app badge on a chat push while the app is
// backgrounded/closed (badges otherwise only ever updated while a chat.js
// listener was alive in a foregrounded tab). This is a SW-local, best-effort
// counter, not a real unread count — it resets on the next notificationclick
// and js/chat.js's own login-scoped listener (js/notifications.js's
// startListener → Chat._attachGlobalBadgeListener) recomputes the EXACT
// count the moment the app is foregrounded again, so this only needs to be
// directionally right (badge is lit / grows) in the meantime.
let _bgChatBadgeCount = 0;

// Handle background messages. Messages are now DATA-ONLY (see functions/index.js),
// so this handler is the single place a notification is rendered — the FCM SDK
// no longer auto-displays a second copy.
messaging.onBackgroundMessage(payload => {
  const data = payload.data || {};
  // BRAND MIRROR — window.BRAND.name in js/config.js (this file is worker-scope,
  // no `window`, so it can't read it directly — keep this literal in sync by hand).
  const notifTitle = data.title || 'Barro Industries';
  const notifBody  = data.body  || 'You have a new notification.';
  const notifId    = data.notifId || '';

  // Drop duplicate deliveries of the same notification doc.
  if (notifId) {
    if (_shownNotifIds.has(notifId)) return;
    _shownNotifIds.add(notifId);
    setTimeout(() => _shownNotifIds.delete(notifId), 60000);
  }

  // Wave1 P0 fix #3 — best-effort OS badge nudge for a chat push (see
  // _bgChatBadgeCount above). Feature-detected — not every browser/engine
  // implements the Badging API inside a service worker.
  if ((data.type || '') === 'chat_message' && self.navigator && 'setAppBadge' in self.navigator) {
    _bgChatBadgeCount++;
    self.navigator.setAppBadge(_bgChatBadgeCount).catch(() => {});
  }

  // Collapse tag: the relay (functions/index.js sendPushOnNotification) now
  // computes this server-side — per-type by default, per-conversation
  // (`chat-${chatId}`) for chat messages, so a burst of chat notifications
  // from different conversations stacks while messages in the SAME
  // conversation collapse into one OS notification. Fall back to the old
  // per-doc/per-type scheme if an older relay payload lacks `data.tag`.
  const tag = data.tag || notifId || ('bi-' + (data.type || 'general'));

  // No badge asset exists yet (icons/ only has full-color app icons, no
  // small monochrome badge) — FOLLOW-UP: add icons/badge-72.png (a
  // transparent-background monochrome glyph) for a proper Android status-bar
  // badge. Using the 192 icon for both icon and badge in the meantime.
  self.registration.getNotifications({ tag }).then(existing => {
    // Belt-and-suspenders: close any already-visible notification with this
    // tag before showing, so a redelivery can never leave two on screen.
    existing.forEach(n => n.close());
    self.registration.showNotification(notifTitle, {
      body:     notifBody,
      icon:     '/icons/icon-192.png',
      badge:    '/icons/icon-192.png',
      tag:      tag,
      // renotify: true — a replaced notification (new message on a
      // conversation/type that already had one showing) still alerts
      // (sound/vibrate/heads-up) instead of silently updating in place.
      renotify: true,
      data:     { link: data.link || '', type: data.type || '', chatId: data.chatId || '', taskId: data.taskId || '', notifId },
      vibrate:  [200, 100, 200],
      actions:  [{ action: 'open', title: 'Open App' }]
    });
  });
});

// When user taps the notification: close it, then try to focus an existing
// app tab and hand it the deep-link target via postMessage — the app-side
// listener (js/notifications.js) is a follow-up, see notes below. If no tab
// is open, fall back to opening one. The app has no URL/hash router (all
// in-app navigation goes through window.navigateTo(page) — see js/app.js),
// so there is no real "#route" to open a fresh window at; we can only pass
// the link to a tab that is alive to receive postMessage.
self.addEventListener('notificationclick', event => {
  const data = event.notification.data || {};
  const link = data.link || '';
  event.notification.close();
  // Wave1 P0 fix #3 — opening the app resyncs the badge for real almost
  // immediately (js/chat.js's login-scoped listener is already running);
  // clear this SW-local best-effort counter so it doesn't keep compounding
  // across background sessions.
  if (self.navigator && 'setAppBadge' in self.navigator) {
    _bgChatBadgeCount = 0;
    (self.navigator.clearAppBadge ? self.navigator.clearAppBadge() : self.navigator.setAppBadge(0)).catch(() => {});
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          // App-side follow-up (js/notifications.js, OWNED by another agent):
          // listen for this and route via navigateTo()/Chat.openConversation()
          // the same way _navigateFromNotif() already does for in-app clicks.
          client.postMessage({ type: 'PUSH_NAV', link, notifType: data.type || '', chatId: data.chatId || '', taskId: data.taskId || '', meetingId: data.meetingId || '', notifId: data.notifId || '' });
          return client;
        }
      }
      // No app tab open — open one at the root. There is no hash route to
      // target (see comment above), so a cold-start deep link is a follow-up:
      // js/notifications.js could stash {link,chatId,taskId} e.g. in
      // sessionStorage keyed by notifId and consume it on first load, or the
      // app could add a lightweight query-param router. Not done here since
      // js/notifications.js is out of scope for this change.
      return clients.openWindow('/');
    })
  );
});
