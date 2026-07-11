/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Notifications
   notifications.js
   Handles: in-app bell, push (FCM), email (EmailJS)
═══════════════════════════════════════════════════ */

window.Notifs = (() => {
  let unsubscribe = null;
  let _fcmLoadingPromise = null; // serialises concurrent _registerPush calls

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
    // Update top-nav-strip badge for notifications item
    const tnBadge = document.querySelector('.top-nav-item[data-page="notifications"] .tn-badge');
    if (tnBadge) {
      tnBadge.textContent = count > 99 ? '99+' : count;
      tnBadge.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  // ── Panel ─────────────────────────────────────
  let _lastItems = [], _lastUid = null;

  function renderPanel(items, uid) {
    _lastItems = items; _lastUid = uid;
    _renderIntoList(document.getElementById('notif-list'), items, uid);
    _renderIntoList(document.getElementById('notif-page-list'), items, uid);
  }

  function renderPage() {
    _renderIntoList(document.getElementById('notif-page-list'), _lastItems, _lastUid);
  }

  async function markAllRead() {
    if (!_lastUid || _lastItems.length === 0) return;
    const unread = _lastItems.filter(n => !n.read);
    await Promise.all(unread.map(n => markRead(_lastUid, n.id)));
  }

  function _navigateFromNotif(type, taskId, chatId) {
    document.getElementById('notif-panel')?.classList.add('hidden');
    document.getElementById('notif-backdrop')?.classList.add('hidden');
    if (type === 'chat_message') {
      if (typeof navigateTo === 'function') navigateTo('chat');
      if (chatId && window.Chat?.openConversation) window.Chat.openConversation(chatId);
      return;
    }
    if (taskId || type?.startsWith('task')) {
      if (taskId && typeof window.openTaskDetail === 'function') {
        window.openTaskDetail(taskId, window.currentUser, window.currentRole);
      } else if (typeof navigateTo === 'function') navigateTo('tasks');
    } else if (type === 'cash_advance' || type === 'ca_approved') {
      if (typeof navigateTo === 'function') navigateTo('personal-finance');
    } else if (type?.startsWith('att')) {
      if (typeof navigateTo === 'function') navigateTo('attendance');
    } else if (type === 'post' || type === 'post_approval') {
      if (typeof navigateTo === 'function') navigateTo('posts');
    } else if (type === 'memo') {
      if (typeof navigateTo === 'function') navigateTo('memos');
    } else if (type === 'approval_result') {
      if (typeof navigateTo === 'function') navigateTo('approvals');
    } else if (type === 'payroll' || type === 'kpi_grade' || type === 'self_assessment') {
      if (typeof navigateTo === 'function') navigateTo('personal-finance');
    }
  }

  function _renderIntoList(list, items, uid) {
    if (!list) return;
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">🔔</div><p>No notifications</p></div>';
      _updatePanelHint(0, 0);
      return;
    }

    const unreadCount = items.filter(n => !n.read).length;
    _updatePanelHint(unreadCount, items.length);

    const NAV_TYPES = new Set(['task_assigned','task_status','task_message','task_comment','cash_advance','ca_approved','att_extension_approved','att_extension_denied','attendance','post','post_approval','memo','approval_result','payroll','kpi_grade','self_assessment','chat_message']);
    const isNavigable = n => n.taskId || NAV_TYPES.has(n.type) || n.type?.startsWith('task') || n.type?.startsWith('att');

    // Many notifications set BOTH an icon AND a title that starts with the same
    // emoji (e.g. icon '💸' + title '💸 New Expense') — which rendered the icon
    // twice. Strip a leading emoji from the title (the emoji column shows it),
    // and fall back to that emoji as the icon when none was set.
    const LEAD_EMOJI = /^[\p{Extended_Pictographic}️‍♀♂]+\s*/u;
    list.innerHTML = items.map(n => {
      const nav = isNavigable(n);
      const hasActions = !n.read || nav;
      const rawTitle = n.title || '';
      const lead = (rawTitle.match(LEAD_EMOJI) || [''])[0].trim();
      const titleText = rawTitle.replace(LEAD_EMOJI, '').trim() || rawTitle;
      const icon = n.icon || lead || 'bell';
      return `
      <div class="notif-item ${n.read ? 'read' : 'unread'}" data-id="${escHtml(n.id)}" data-type="${escHtml(n.type||'')}" data-task-id="${escHtml(n.taskId||'')}" data-chat-id="${escHtml(n.chatId||'')}">
        <div class="notif-item-main">
          <div class="notif-item-emoji">${window.emojiIcon(icon, 20)}</div>
          <div class="notif-item-text">
            <div class="notif-item-title">${escHtml(titleText)}</div>
            <div class="notif-item-body">${escHtml(n.body || '')}</div>
            <div class="notif-item-time">${timeAgo(n.createdAt)}</div>
          </div>
        </div>
        <div class="notif-item-actions">
          ${!n.read
            ? `<button class="notif-action-btn notif-read-btn" data-id="${n.id}" title="Mark as read" aria-label="Mark as read">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span class="notif-btn-label">Mark Read</span>
               </button>`
            : `<button class="notif-action-btn notif-unread-btn" data-id="${n.id}" title="Mark as unread" aria-label="Mark as unread">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/></svg>
                <span class="notif-btn-label">Unread</span>
               </button>`}
          ${nav ? `<button class="notif-action-btn notif-view-btn" title="Open" aria-label="Open">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            <span class="notif-btn-label">Open</span>
          </button>` : ''}
        </div>
      </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons({ nodes: [list] });

    // Mark-as-read buttons
    list.querySelectorAll('.notif-read-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const item = btn.closest('.notif-item');
        item?.classList.remove('unread');
        item?.classList.add('read');
        await markRead(uid, btn.dataset.id);
        // Swap to unread button without full re-render
        btn.outerHTML = `<button class="notif-action-btn notif-unread-btn" data-id="${btn.dataset.id}" title="Mark as unread" aria-label="Mark as unread">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/></svg>
          <span class="notif-btn-label">Unread</span>
        </button>`;
        // Re-attach unread listener to the new button
        item?.querySelector('.notif-unread-btn')?.addEventListener('click', async e2 => {
          e2.stopPropagation();
          const nb = e2.currentTarget;
          item.classList.remove('read');
          item.classList.add('unread');
          await markUnread(uid, nb.dataset.id);
          nb.outerHTML = `<button class="notif-action-btn notif-read-btn" data-id="${nb.dataset.id}" title="Mark as read" aria-label="Mark as read">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span class="notif-btn-label">Mark Read</span>
          </button>`;
          item.querySelector('.notif-read-btn')?.addEventListener('click', async e3 => {
            e3.stopPropagation();
            const rb = e3.currentTarget;
            item.classList.remove('unread'); item.classList.add('read');
            await markRead(uid, rb.dataset.id);
            rb.outerHTML = `<button class="notif-action-btn notif-unread-btn" data-id="${rb.dataset.id}" title="Mark as unread"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/></svg><span class="notif-btn-label">Unread</span></button>`;
          });
          const remaining2 = list.querySelectorAll('.notif-item.unread').length;
          _updatePanelHint(remaining2, items.length);
        });
        const remaining = list.querySelectorAll('.notif-item.unread').length;
        _updatePanelHint(remaining, items.length);
        if (remaining === 0 && typeof window.tryUpgradeAttendanceOnNotifRead === 'function') {
          window.tryUpgradeAttendanceOnNotifRead();
        }
      });
    });

    // Mark-as-unread buttons (for already-read items)
    list.querySelectorAll('.notif-unread-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const item = btn.closest('.notif-item');
        item?.classList.remove('read');
        item?.classList.add('unread');
        await markUnread(uid, btn.dataset.id);
        btn.outerHTML = `<button class="notif-action-btn notif-read-btn" data-id="${btn.dataset.id}" title="Mark as read" aria-label="Mark as read">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span class="notif-btn-label">Mark Read</span>
        </button>`;
        item?.querySelector('.notif-read-btn')?.addEventListener('click', async e2 => {
          e2.stopPropagation();
          const rb = e2.currentTarget;
          item.classList.remove('unread'); item.classList.add('read');
          await markRead(uid, rb.dataset.id);
          rb.outerHTML = `<button class="notif-action-btn notif-unread-btn" data-id="${rb.dataset.id}" title="Mark as unread"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/></svg><span class="notif-btn-label">Unread</span></button>`;
          const remaining3 = list.querySelectorAll('.notif-item.unread').length;
          _updatePanelHint(remaining3, items.length);
        });
        const remaining = list.querySelectorAll('.notif-item.unread').length;
        _updatePanelHint(remaining, items.length);
      });
    });

    // View/open buttons
    list.querySelectorAll('.notif-view-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const item = btn.closest('.notif-item');
        const type = item?.dataset.type || '';
        const taskId = item?.dataset.taskId || '';
        const chatId = item?.dataset.chatId || '';
        // Auto mark as read on view
        if (item?.classList.contains('unread')) {
          item.classList.remove('unread');
          item.classList.add('read');
          item.querySelector('.notif-read-btn')?.remove();
          await markRead(uid, item.dataset.id);
        }
        _navigateFromNotif(type, taskId, chatId);
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
  async function send(targetUid, { title, body, icon = '🔔', type = 'general', link = null, dedupKey = null, taskId = null, chatId = null } = {}) {
    // If a dedupKey is provided, skip if a notif with that key already exists today
    if (dedupKey) {
      // Single-field query — no composite index required
      const existing = await db.collection('notifications').doc(targetUid).collection('items')
        .where('dedupKey', '==', dedupKey).limit(1).get().catch(()=>({empty:true}));
      if (!existing.empty) return;
    }
    const data = {
      title, body, icon, type, link,
      read:      false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      ...(dedupKey ? { dedupKey } : {}),
      ...(taskId ? { taskId } : {}),
      ...(chatId ? { chatId } : {})
    };
    await db.collection('notifications').doc(targetUid).collection('items').add(data);

    // Email notification (if configured)
    if (window.EMAIL_CONFIG?.ENABLED) {
      sendEmail(targetUid, title, body);
    }
  }

  // ── Send to department ────────────────────────
  async function sendToDept(department, notifData, opts = {}) {
    const [snap1, snap2] = await Promise.all([
      db.collection('users').where('department', '==', department).get().catch(()=>({docs:[]})),
      db.collection('users').where('departments', 'array-contains', department).get().catch(()=>({docs:[]}))
    ]);
    const seen = new Set();
    const allDocs = [...snap1.docs, ...snap2.docs].filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; });
    // No user is assigned to this department — the alert would otherwise vanish.
    // For critical handoffs (opts.fallbackToOwner), route it to the owner/president
    // instead so e.g. a job sent to Production with no Production user is never lost.
    if (!allDocs.length) {
      if (opts.fallbackToOwner) {
        await sendToOwner({ ...notifData, body: `[no ${department} user assigned] ${notifData.body || ''}`.slice(0, 2000) });
      }
      return;
    }
    // Use batch writes — avoids per-user dedupKey read + stays under Firestore write limits
    const docs = allDocs.slice();
    while (docs.length) {
      const chunk = docs.splice(0, 499);
      const batch = db.batch();
      chunk.forEach(doc => {
        const ref = db.collection('notifications').doc(doc.id).collection('items').doc();
        batch.set(ref, { ...notifData, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }
  }

  // ── Send to all users ────────────────────────
  async function sendToAll(notifData) {
    const snap = await db.collection('users').get();
    const docs = snap.docs.slice();
    while (docs.length) {
      const chunk = docs.splice(0, 499);
      const batch = db.batch();
      chunk.forEach(doc => {
        const ref = db.collection('notifications').doc(doc.id).collection('items').doc();
        batch.set(ref, { ...notifData, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }
  }

  // ── Send to president / owner ─────────────────
  async function sendToOwner(notifData) {
    const [presSnap, ownerSnap] = await Promise.all([
      db.collection('users').where('role','==','president').get().catch(()=>({docs:[]})),
      db.collection('users').where('role','==','owner').get().catch(()=>({docs:[]}))
    ]);
    const allDocs = [...presSnap.docs, ...ownerSnap.docs];
    if (!allDocs.length) return;
    const batch = db.batch();
    allDocs.forEach(d => {
      const ref = db.collection('notifications').doc(d.id).collection('items').doc();
      batch.set(ref, { ...notifData, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
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

  // Push notification permission prompt — full-screen card style
  function _showPushPrompt(uid, vapidKey) {
    if (document.getElementById('push-prompt-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'push-prompt-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
      z-index:9100;display:flex;align-items:flex-end;justify-content:center;
      padding-bottom:calc(env(safe-area-inset-bottom,0px) + 16px);
      animation:fadeIn .22s ease;
    `;
    overlay.innerHTML = `
      <div style="
        background:rgba(20,30,55,0.72);
        backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
        border:1px solid rgba(255,255,255,0.12);
        border-radius:22px 22px 16px 16px;
        padding:28px 24px 24px;
        width:min(440px,96vw);
        box-shadow:0 -6px 40px rgba(0,0,0,0.4),0 0 0 0.5px rgba(255,255,255,0.06) inset;
        animation:slideUp .28s cubic-bezier(.22,.68,0,1.2);
      ">
        <div style="text-align:center;margin-bottom:20px">
          <div style="font-size:44px;margin-bottom:10px">🔔</div>
          <div style="font-size:18px;font-weight:800;color:var(--text,#e8eaf0);margin-bottom:8px">Allow Notifications</div>
          <div style="font-size:13px;color:var(--text-muted,#8a9bc0);line-height:1.6">
            Please allow notifications so you can receive alerts for:
          </div>
          <div style="margin:14px 0;display:flex;flex-direction:column;gap:8px;text-align:left">
            ${[
              ['✅','Task assignments & status updates'],
              ['💬','New messages & comments'],
              ['📋','Self-assessment & payroll reminders'],
              ['⏰','Attendance & deadline alerts'],
              ['💸','Cash advance approvals'],
            ].map(([icon,text])=>`
              <div style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text,#e8eaf0)">
                <span style="font-size:16px;flex-shrink:0">${icon}</span>${text}
              </div>`).join('')}
          </div>
        </div>
        <button id="push-allow-btn" style="
          width:100%;padding:14px;background:var(--primary-light,#3d5afe);color:#fff;
          border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;
          margin-bottom:10px;letter-spacing:.02em;
        ">🔔 Allow Notifications</button>
        <button id="push-deny-btn" style="
          width:100%;padding:11px;background:transparent;color:var(--text-muted,#8a9bc0);
          border:1.5px solid var(--border,#2a3a52);border-radius:12px;font-size:13px;cursor:pointer;
        ">Not now</button>
      </div>
    `;

    // Inject animations once
    if (!document.getElementById('push-prompt-styles')) {
      const s = document.createElement('style');
      s.id = 'push-prompt-styles';
      s.textContent = `
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes slideUp { from{transform:translateY(60px);opacity:0} to{transform:translateY(0);opacity:1} }
      `;
      document.head.appendChild(s);
    }

    document.body.appendChild(overlay);

    document.getElementById('push-allow-btn').onclick = async () => {
      overlay.remove();
      const permission = await Notification.requestPermission();
      if (permission === 'granted') await _registerPush(uid, vapidKey);
    };
    document.getElementById('push-deny-btn').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    setTimeout(() => overlay.remove(), 60000);
  }

  async function _registerPush(uid, vapidKey) {
    try {
      // Service workers require HTTPS — skip on file://
      if (location.protocol === 'file:') {
        console.warn('[FCM] Push notifications require HTTPS hosting. In-app notifications will still work.');
        showToast('ℹ️ Device push requires HTTPS hosting. In-app notifications are active.', 'info');
        return;
      }

      // Lazy-load messaging SDK — one shared promise so concurrent callers don't race
      if (!window._fcmLoaded) {
        if (!_fcmLoadingPromise) {
          _fcmLoadingPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js';
            s.onload = () => { window._fcmLoaded = true; resolve(); };
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        await _fcmLoadingPromise;
      }

      const swReg = await navigator.serviceWorker.register('firebase-messaging-sw.js')
        .catch(err => { console.warn('[FCM] SW register failed:', err); return null; });
      if (!swReg) return;

      const messaging = firebase.messaging();
      const token = await messaging.getToken({ vapidKey, serviceWorkerRegistration: swReg });
      if (token) {
        await db.collection('users').doc(uid).update({ fcmToken: token });
        console.log('[FCM] Push token registered for', uid);
      }
      // Show in-app toast for foreground messages. Messages are data-only now
      // (see functions/index.js), so read title/body from payload.data — and
      // attach the handler only once so re-registration doesn't stack toasts.
      if (!window._fcmOnMessageBound) {
        window._fcmOnMessageBound = true;
        messaging.onMessage(payload => {
          const d = payload.data || payload.notification || {};
          const { title, body } = d;
          if (title) showToast(`${title}${body ? ': '+body : ''}`);
        });
      }
    } catch (err) {
      console.warn('[FCM] Push registration failed:', err);
    }
  }

  // ── Toast ─────────────────────────────────────
  // WS42 Phase 10: pill = --surface + border + --sh-lg; the colored bit is now a
  // small 10px status dot, not the whole pill background (perf/legibility —
  // matches the Light/Dark/Astral token system instead of a hardcoded color block).
  function showToast(message, type = 'info') {
    const existing = document.getElementById('bi-toast');
    if (existing) existing.remove();

    // Theme-aware colors via CSS custom properties (with safe fallbacks if unset).
    const root = document.documentElement;
    const cssVar = (name, fallback) => {
      const v = getComputedStyle(root).getPropertyValue(name).trim();
      return v || fallback;
    };
    const kind = type === 'success'
      ? 'success'
      : (type === 'error' || type === 'danger') ? 'error' : 'info';
    const iconColor = {
      success: cssVar('--toast-success', '#30D158'),
      error:   cssVar('--toast-error',   '#FF453A'),
      info:    cssVar('--toast-info',    '#0A84FF'),
    }[kind];
    const bg     = cssVar('--toast-bg',     cssVar('--surface', '#1A1D21'));
    const border = cssVar('--toast-border', cssVar('--border', 'rgba(255,255,255,0.10)'));
    const fg     = cssVar('--toast-text',   cssVar('--text', '#fff'));
    const shadow = cssVar('--sh-lg', '0 12px 32px rgba(0,0,0,0.40)');

    const toast = document.createElement('div');
    toast.id = 'bi-toast';
    // Mobile (no bottom-nav) gets a smaller offset; desktop reserves bottom-nav space.
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    const bottom = isMobile
      ? 'calc(16px + env(safe-area-inset-bottom,0px))'
      : 'calc(16px + 52px + 16px + env(safe-area-inset-bottom,0px))';
    toast.style.cssText = `
      position:fixed; bottom:${bottom}; left:50%; transform:translateX(-50%);
      display:flex; align-items:center; gap:9px;
      background:${bg}; border:1px solid ${border};
      color:${fg}; padding:10px 18px; border-radius:999px;
      font-size:13px; font-weight:600; z-index:9999;
      box-shadow:${shadow};
      animation:toastIn 0.3s ease; white-space:nowrap; max-width:90vw; overflow:hidden; text-overflow:ellipsis;
    `;
    const dot = document.createElement('span');
    dot.style.cssText = `flex-shrink:0; width:10px; height:10px; border-radius:50%; background:${iconColor};`;
    const label = document.createElement('span');
    label.style.cssText = 'overflow:hidden; text-overflow:ellipsis;';
    label.textContent = message;
    toast.appendChild(dot);
    toast.appendChild(label);
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  // ── Deadline checker (runs once per day per task) ──
  async function checkDeadlines(uid) {
    const todayStr    = window.bizDate();
    const tomorrowStr = window.bizDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

    const DONE_STATUSES = ['done','approved','archived'];
    const [tomorrowSnap, todaySnap] = await Promise.all([
      db.collection('tasks').where('assignedTo','array-contains',uid).where('dueDate','==',tomorrowStr).get().catch(()=>({docs:[]})),
      db.collection('tasks').where('assignedTo','array-contains',uid).where('dueDate','==',todayStr).get().catch(()=>({docs:[]}))
    ]);

    const toNotify = [];
    tomorrowSnap.docs.forEach(d => {
      const task = { id: d.id, ...d.data() };
      if (DONE_STATUSES.includes(task.status)) return;
      // Date embedded in key — no composite index needed, fires exactly once per task per day
      toNotify.push({ task, key: `deadline-tmrw-${task.id}-${tomorrowStr}`, title: '⏰ Due Tomorrow', body: `"${task.title}" is due tomorrow.` });
    });
    todaySnap.docs.forEach(d => {
      const task = { id: d.id, ...d.data() };
      if (DONE_STATUSES.includes(task.status)) return;
      toNotify.push({ task, key: `deadline-today-${task.id}-${todayStr}`, title: '🚨 Due Today', body: `"${task.title}" is due today! Complete and submit it.` });
    });

    for (const { task, key, title, body } of toNotify) {
      // dedupKey checked in Firestore — safe across devices and sessions
      await send(uid, { title, body, icon: '⏰', type: 'deadline', taskId: task.id, dedupKey: key });
    }
  }

  // ── Attendance morning reminder ────────────────
  async function checkAttendanceReminder(uid, displayName) {
    const hour = window.bizHour();
    const dow  = window.bizDow(); // 0=Sun, Manila time
    if (dow === 0 || hour < 7 || hour >= 9) return; // Mon–Sat, 7:00–8:59 AM Manila only

    const todayStr = window.bizDate();
    const dedupKey = `bi-att-remind-${uid}-${todayStr}`;

    // Skip if already timed in
    try {
      const rec = await db.collection('attendance').doc(uid).collection('records').doc(todayStr).get();
      if (rec.exists) return;
    } catch {}

    const name = displayName || 'there';
    // dedupKey in Firestore prevents duplicate reminders across devices/sessions
    await send(uid, {
      title: `🌅 Good morning, ${name}!`,
      body:  "Don't forget to time in today. Wishing you a productive day! 💪",
      icon:  '🌅', type: 'att_morning_remind',
      dedupKey
    });
  }

  // ── Low-stock daily digest (admins only) ───────
  // One batched notification per admin per day listing items at/below reorder
  // level. Deduped by day (owner prefers a daily digest, not per-event spam).
  async function checkLowStock(uid, role) {
    // Admins who read inventory get a daily digest; Purchasing-dept members get one
    // too (so they can raise an RFQ), with a tailored link + hint.
    const isPurchasing = (window.currentDepts || []).includes('Purchasing');
    if (!['president','manager','finance'].includes(role) && !isPurchasing) return;
    try {
      const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
      const low = snap.docs.map(d => d.data())
        .filter(i => (i.reorderLevel||0) > 0 && (i.qty||0) <= (i.reorderLevel||0));
      if (!low.length) return;
      const names = low.slice(0,5).map(i => i.name).filter(Boolean).join(', ');
      const more  = low.length > 5 ? ` +${low.length-5} more` : '';
      const todayStr = window.bizDate();
      await send(uid, {
        title: `📦 ${low.length} item${low.length>1?'s':''} low on stock`,
        body:  isPurchasing
          ? `At/below reorder level: ${names}${more}. Open Purchasing → RFQ → “From low stock”.`
          : `At/below reorder level: ${names}${more}. Tap to review Inventory.`,
        icon:  '📦', type: 'low_stock', link: isPurchasing ? 'dept:Purchasing' : 'inventory',
        dedupKey: `lowstock-${uid}-${todayStr}`,
      });
    } catch (_) { /* inventory read denied / offline — skip silently */ }
  }

  // ── AEC follow-up daily digest (Sales + admins) ─
  // One batched notification per user per day: contacts whose followUpDate has
  // arrived and whose stage isn't terminal. Mirrors checkLowStock's shape:
  // role/dept-scoped, dedupKey'd by day, silent on permission errors.
  async function checkAECFollowups(uid, role) {
    const isSales = (window.currentDepts || []).includes('Sales');
    if (!['president','manager'].includes(role) && !isSales) return;
    try {
      const snap = await dbCachedGet('aec_contacts', () => db.collection('aec_contacts').get().catch(()=>({docs:[]})), 45000);
      const todayStr  = window.bizDate();
      const terminal  = window.AEC_TERMINAL || ['partner','dormant'];  // defensive: departments.js defines it
      const due = snap.docs.map(d => d.data())
        .filter(c => c.followUpDate && c.followUpDate <= todayStr && !terminal.includes(c.stage || 'new'));
      if (!due.length) return;
      const names = due.slice(0,5).map(c => c.company || c.contactPerson).filter(Boolean).join(', ');
      const more  = due.length > 5 ? ` +${due.length-5} more` : '';
      await send(uid, {
        title: `📇 ${due.length} AEC follow-up${due.length>1?'s':''} due`,
        body:  `Overdue: ${names}${more}. Open Sales → AEC to follow up.`,
        icon:  '📇', type: 'aec_followup', link: 'dept:Sales',
        dedupKey: `aec-fu-${uid}-${todayStr}`,
      });
    } catch (_) { /* read denied / offline — skip silently */ }
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

  // Panel toggle — on mobile navigates to the notifications page; on desktop shows the dropdown
  function initToggle() {
    const btn      = document.getElementById('notif-btn');
    const panel    = document.getElementById('notif-panel');
    const backdrop = document.getElementById('notif-backdrop');

    const closePanel = () => {
      panel?.classList.add('hidden');
      backdrop?.classList.add('hidden');
    };
    const openPanel = () => {
      panel?.classList.remove('hidden');
      backdrop?.classList.remove('hidden');
    };
    const isPanelOpen = () => panel && !panel.classList.contains('hidden');

    btn?.addEventListener('click', e => {
      e.stopPropagation();
      if (window.innerWidth <= 768) {
        // Mobile: toggle between notifications page and previous page
        if (window.currentPage === 'notifications') {
          if (typeof navigateTo === 'function') navigateTo('dashboard');
        } else {
          if (typeof navigateTo === 'function') navigateTo('notifications');
        }
      } else {
        // Desktop: toggle dropdown panel open/closed
        if (isPanelOpen()) {
          closePanel();
        } else {
          openPanel();
        }
      }
    });
    backdrop?.addEventListener('click', closePanel);
  }

  return { startListener, stopListener, send, sendToDept, sendToAll, sendToOwner, showToast, initPush, checkDeadlines, checkAttendanceReminder, checkLowStock, checkAECFollowups, initToggle, renderPage, markAllRead,
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
