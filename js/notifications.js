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
      _updatePanelHint(0, 0);
      return;
    }

    const unreadCount = items.filter(n => !n.read).length;
    _updatePanelHint(unreadCount, items.length);

    list.innerHTML = items.map(n => {
      const isNavigable = n.taskId || n.type?.startsWith('task') || n.type?.startsWith('att') || n.type === 'cash_advance' || n.type === 'ca_approved' || n.type === 'post';
      return `
      <div class="notif-item ${n.read ? 'read' : 'unread'}" data-id="${n.id}" data-type="${n.type||''}" data-task-id="${n.taskId||''}">
        <div style="display:flex;align-items:flex-start;gap:10px;width:100%">
          <input type="checkbox" class="notif-checkbox" data-id="${n.id}"
            ${n.read ? 'checked' : ''}
            style="margin-top:3px;width:16px;height:16px;accent-color:var(--primary-light);flex-shrink:0;cursor:pointer"/>
          <div style="flex:1;min-width:0;cursor:${isNavigable?'pointer':'default'}" class="notif-body-link">
            <div class="notif-item-title">${n.icon || '🔔'} ${n.title}</div>
            <div class="notif-item-body">${n.body || ''}</div>
            <div class="notif-item-time">${timeAgo(n.createdAt)}${isNavigable?` <span style="color:var(--primary-light);font-size:10px">Tap to open →</span>`:''}</div>
          </div>
        </div>
      </div>`;
    }).join('');

    // Bind checkbox — toggle read/unread
    list.querySelectorAll('.notif-checkbox').forEach(cb => {
      cb.addEventListener('change', async () => {
        const item = cb.closest('.notif-item');
        if (cb.checked) {
          item?.classList.remove('unread');
          item?.classList.add('read');
          await markRead(uid, cb.dataset.id);
        } else {
          item?.classList.remove('read');
          item?.classList.add('unread');
          await markUnread(uid, cb.dataset.id);
        }
        // Re-count unchecked for attendance upgrade
        const remaining = list.querySelectorAll('.notif-checkbox:not(:checked)').length;
        _updatePanelHint(remaining, items.length);
        if (remaining === 0 && typeof window.tryUpgradeAttendanceOnNotifRead === 'function') {
          window.tryUpgradeAttendanceOnNotifRead();
        }
      });
    });

    // Bind nav links — click body to navigate to relevant item
    list.querySelectorAll('.notif-body-link').forEach(link => {
      link.addEventListener('click', async () => {
        const item = link.closest('.notif-item');
        const type = item.dataset.type || '';
        const taskId = item.dataset.taskId || '';
        // Mark as read
        const cb = item.querySelector('.notif-checkbox');
        if (cb && !cb.checked) { cb.checked = true; await markRead(uid, item.dataset.id); }
        // Close notification panel
        document.getElementById('notif-panel')?.classList.add('hidden');
        // Navigate
        if (taskId || type.startsWith('task')) {
          if (taskId && typeof window.openTaskDetail === 'function') {
            const currentUser = window.currentUser;
            const currentRole = window.currentRole;
            window.openTaskDetail(taskId, currentUser, currentRole);
          } else {
            if (typeof navigateTo === 'function') navigateTo('tasks');
          }
        } else if (type === 'cash_advance' || type === 'ca_approved') {
          if (typeof navigateTo === 'function') navigateTo('personal-finance');
        } else if (type === 'att_extension_approved' || type === 'att_extension_denied' || type === 'attendance') {
          if (typeof navigateTo === 'function') navigateTo('attendance');
        } else if (type === 'post' || type === 'post_approval') {
          if (typeof navigateTo === 'function') navigateTo('posts');
        } else if (type === 'approval_result') {
          if (typeof navigateTo === 'function') navigateTo('approvals');
        }
      });
    });
  }

  function _updatePanelHint(unread, total) {
    const hint = document.getElementById('notif-panel-hint');
    if (!hint) return;
    if (unread === 0) {
      hint.textContent = total > 0 ? '✅ All checked' : '';
      hint.style.color = 'var(--success, #30d158)';
    } else {
      hint.textContent = `${unread} unchecked`;
      hint.style.color = 'var(--text-muted)';
    }
  }

  async function markRead(uid, notifId) {
    await db.collection('notifications').doc(uid).collection('items').doc(notifId).update({ read: true });
  }

  async function markUnread(uid, notifId) {
    await db.collection('notifications').doc(uid).collection('items').doc(notifId).update({ read: false });
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

  // ── Push (FCM) — lazy-loads messaging SDK only when needed ──
  async function initPush(uid) {
    const vapidKey = window.FCM_CONFIG?.VAPID_KEY;
    if (!vapidKey || vapidKey === 'YOUR_VAPID_KEY_HERE') return;
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'denied') return;

      // If not yet asked, show our own prompt button instead of the browser dialog
      if (Notification.permission === 'default') {
        _showPushPrompt(uid, vapidKey);
        return;
      }

      // Already granted — register silently
      await _registerPush(uid, vapidKey);
    } catch (err) {
      console.warn('Push notification init failed:', err);
    }
  }

  // Show a soft prompt banner asking user to enable push notifications
  function _showPushPrompt(uid, vapidKey) {
    if (document.getElementById('push-prompt-bar')) return; // already showing
    const bar = document.createElement('div');
    bar.id = 'push-prompt-bar';
    bar.style.cssText = `
      position:fixed;bottom:70px;left:50%;transform:translateX(-50%);
      background:var(--surface,#1e2a3a);border:1.5px solid var(--primary-light,#3d5afe);
      border-radius:14px;padding:12px 18px;display:flex;align-items:center;gap:12px;
      z-index:8888;box-shadow:0 6px 24px rgba(0,0,0,0.35);max-width:92vw;
    `;
    bar.innerHTML = `
      <span style="font-size:22px">🔔</span>
      <div style="flex:1;font-size:13px;color:var(--text,#e0e0e0)">
        <strong>Enable push notifications</strong><br>
        <span style="font-size:11px;opacity:.8">Get notified about tasks, payroll & more on this device</span>
      </div>
      <button id="push-allow-btn" style="background:var(--primary-light,#3d5afe);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer">Allow</button>
      <button id="push-deny-btn" style="background:transparent;color:var(--text-muted,#90a4ae);border:none;font-size:18px;cursor:pointer;padding:0 4px">✕</button>
    `;
    document.body.appendChild(bar);

    document.getElementById('push-allow-btn').onclick = async () => {
      bar.remove();
      const permission = await Notification.requestPermission();
      if (permission === 'granted') await _registerPush(uid, vapidKey);
    };
    document.getElementById('push-deny-btn').onclick = () => bar.remove();

    // Auto-dismiss after 30 seconds
    setTimeout(() => bar.remove(), 30000);
  }

  async function _registerPush(uid, vapidKey) {
    try {
      // Lazy-load messaging SDK
      if (!window._fcmLoaded) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js';
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
        window._fcmLoaded = true;
      }

      // Use the firebase-messaging-sw.js for background handling
      const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' })
        .catch(() => navigator.serviceWorker.ready);

      const messaging = firebase.messaging();
      const token = await messaging.getToken({ vapidKey, serviceWorkerRegistration: swReg });
      if (token) {
        await db.collection('users').doc(uid).update({ fcmToken: token });
        console.log('[FCM] Push token registered for', uid);
      }
      // Show in-app toast for foreground messages
      messaging.onMessage(payload => {
        const { title, body } = payload.notification || {};
        if (title) showToast(`${title}${body ? ': '+body : ''}`);
      });
    } catch (err) {
      console.warn('[FCM] Push registration failed:', err);
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

    const DONE_STATUSES = ['done','approved','archived'];
    const snap = await db.collection('tasks')
      .where('assignedTo', 'array-contains', uid)
      .where('dueDate', '==', tomorrowStr)
      .get().catch(() => ({ docs: [] }));

    snap.docs.forEach(d => {
      const task = d.data();
      if (DONE_STATUSES.includes(task.status)) return; // skip completed tasks
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

  return { startListener, stopListener, send, sendToDept, sendToOwner, showToast, initPush, checkDeadlines, initToggle,
    requestPushPermission: (uid) => {
      const vapidKey = window.FCM_CONFIG?.VAPID_KEY;
      if (!vapidKey || vapidKey === 'YOUR_VAPID_KEY_HERE') { showToast('Push notifications not configured yet.','error'); return; }
      if (Notification.permission === 'granted') { _registerPush(uid, vapidKey); }
      else if (Notification.permission !== 'denied') { _showPushPrompt(uid, vapidKey); }
      else { showToast('Notifications are blocked in your browser. Check site settings to re-enable.','error'); }
    }
  };
})();

// Toast animation
const toastStyle = document.createElement('style');
toastStyle.textContent = `@keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`;
document.head.appendChild(toastStyle);
