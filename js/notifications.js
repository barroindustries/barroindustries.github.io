/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Notifications
   notifications.js
   Handles: in-app bell, push (FCM), email (EmailJS)
═══════════════════════════════════════════════════ */

window.Notifs = (() => {
  let unsubscribe = null;

  // ── Start listener ────────────────────────────
  function startListener(uid) {
    if (unsubscribe) unsubscribe();
    unsubscribe = db.collection('notifications').doc(uid)
      .collection('items')
      .orderBy('createdAt', 'desc')
      .limit(30)
      .onSnapshot(snap => {
        const all    = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const unread = all.filter(n => !n.read).length;
        updateBadge(unread);
        renderPanel(all, uid);
      });
  }

  function stopListener() { if (unsubscribe) { unsubscribe(); unsubscribe = null; } }

  // ── Badge ─────────────────────────────────────
  function updateBadge(count) {
    const badge = document.getElementById('notif-badge');
    const bn    = document.getElementById('bn-notif-badge');
    if (badge) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.toggle('hidden', count === 0);
    }
    if (bn) {
      bn.textContent = count;
      bn.style.display = count > 0 ? 'block' : 'none';
    }
  }

  // ── Panel ─────────────────────────────────────
  function renderPanel(items, uid) {
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">🔔</div><p>No notifications</p></div>';
      return;
    }
    list.innerHTML = items.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
        <div class="notif-item-title">${n.icon || '🔔'} ${n.title}</div>
        <div class="notif-item-body">${n.body || ''}</div>
        <div class="notif-item-time">${timeAgo(n.createdAt)}</div>
      </div>
    `).join('');

    list.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', () => markRead(uid, item.dataset.id));
    });

    document.getElementById('mark-all-read')?.addEventListener('click', () => markAllRead(uid, items));
  }

  async function markRead(uid, notifId) {
    await db.collection('notifications').doc(uid).collection('items').doc(notifId).update({ read: true });
  }

  async function markAllRead(uid, items) {
    const batch = db.batch();
    items.filter(n => !n.read).forEach(n => {
      batch.update(db.collection('notifications').doc(uid).collection('items').doc(n.id), { read: true });
    });
    await batch.commit();
  }

  // ── Send notification ─────────────────────────
  async function send(targetUid, { title, body, icon = '🔔', type = 'general', link = null } = {}) {
    const data = {
      title, body, icon, type, link,
      read:      false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('notifications').doc(targetUid).collection('items').add(data);

    // Email notification (if configured)
    if (window.EMAIL_CONFIG?.ENABLED) {
      sendEmail(targetUid, title, body);
    }
  }

  // ── Send to department ────────────────────────
  async function sendToDept(department, notifData) {
    const snap = await db.collection('users').where('department', '==', department).get();
    const promises = snap.docs.map(d => send(d.id, notifData));
    await Promise.all(promises);
  }

  // ── Send to president / owner ─────────────────
  async function sendToOwner(notifData) {
    const [presSnap, ownerSnap] = await Promise.all([
      db.collection('users').where('role','==','president').get(),
      db.collection('users').where('role','==','owner').get()
    ]);
    const allDocs = [...presSnap.docs, ...ownerSnap.docs];
    const promises = allDocs.map(d => send(d.id, notifData));
    await Promise.all(promises);
  }

  // ── Email (EmailJS) ───────────────────────────
  async function sendEmail(uid, subject, body) {
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return;
      const email = snap.data().email;
      if (!email) return;

      if (typeof emailjs === 'undefined') return;
      await emailjs.send(
        EMAIL_CONFIG.SERVICE_ID,
        EMAIL_CONFIG.TEMPLATE_ID,
        { to_email: email, subject, message: body, company: 'Barro Industries' },
        EMAIL_CONFIG.PUBLIC_KEY
      );
    } catch (err) {
      console.warn('Email notification failed:', err);
    }
  }

  // ── Push (FCM) ────────────────────────────────
  async function initPush(uid) {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'denied') return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      // FCM needs to be initialized in the service worker
      // Token saved to Firestore for server-side sending
      // (requires Firebase Cloud Functions for full push — in-app works without it)
      const messaging = firebase.messaging();
      const token = await messaging.getToken({ vapidKey: window.FCM_CONFIG?.VAPID_KEY });
      if (token) {
        await db.collection('users').doc(uid).update({ fcmToken: token });
      }

      messaging.onMessage(payload => {
        const { title, body } = payload.notification || {};
        if (title) showToast(`${title}: ${body}`);
      });
    } catch (err) {
      console.warn('Push notification init failed:', err);
    }
  }

  // ── Toast ─────────────────────────────────────
  function showToast(message, type = 'info') {
    const existing = document.getElementById('bi-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'bi-toast';
    toast.style.cssText = `
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:${type === 'error' ? '#c62828' : '#1a237e'};
      color:#fff; padding:10px 20px; border-radius:30px;
      font-size:13px; font-weight:600; z-index:9999;
      box-shadow:0 4px 20px rgba(0,0,0,0.3);
      animation:toastIn 0.3s ease; white-space:nowrap; max-width:90vw; overflow:hidden; text-overflow:ellipsis;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  // ── Deadline checker ──────────────────────────
  async function checkDeadlines(uid) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const snap = await db.collection('tasks')
      .where('assignedTo', '==', uid)
      .where('dueDate', '==', tomorrowStr)
      .where('status', '!=', 'done')
      .get();

    snap.docs.forEach(d => {
      const task = d.data();
      send(uid, {
        title: '⏰ Task Due Tomorrow',
        body:  `"${task.title}" is due tomorrow.`,
        icon:  '⏰',
        type:  'deadline'
      });
    });
  }

  // ── Helpers ───────────────────────────────────
  function timeAgo(ts) {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60)   return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  // Panel toggle
  function initToggle() {
    const btn      = document.getElementById('notif-btn');
    const panel    = document.getElementById('notif-panel');
    const backdrop = document.getElementById('notif-backdrop');

    btn?.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.toggle('hidden');
      backdrop.classList.toggle('hidden');
    });
    backdrop?.addEventListener('click', () => {
      panel.classList.add('hidden');
      backdrop.classList.add('hidden');
    });
  }

  return { startListener, stopListener, send, sendToDept, sendToOwner, showToast, initPush, checkDeadlines, initToggle };
})();

// Toast animation
const toastStyle = document.createElement('style');
toastStyle.textContent = `@keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`;
document.head.appendChild(toastStyle);
