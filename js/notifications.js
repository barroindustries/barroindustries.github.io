/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Notifications
   notifications.js
   Handles: in-app bell, push (FCM), email (EmailJS)
═══════════════════════════════════════════════════ */

window.Notifs = (() => {
  let unsubscribe = null;
  let _fcmLoadingPromise = null; // serialises concurrent _registerPush calls
  let _unreadDebounceTimer = null;

  // ── Start listener ────────────────────────────
  function startListener(uid) {
    if (unsubscribe) unsubscribe();
    unsubscribe = db.collection('notifications').doc(uid)
      .collection('items')
      .orderBy('createdAt', 'desc')
      .limit(30)
      .onSnapshot(snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderPanel(all, uid);
        // Badge must reflect true unread count, not just the 30-item live
        // window (Phase 66 / U-M3) — a burst of >30 unread items would
        // otherwise cap the badge at ~30 while more sit unseen. Debounced
        // so a flurry of listener fires (bulk sends, mark-read taps) only
        // triggers one extra read.
        _scheduleUnreadRefresh(uid);
      });
  }

  // ── True unread count (not window-limited) ─────
  function _scheduleUnreadRefresh(uid) {
    if (_unreadDebounceTimer) clearTimeout(_unreadDebounceTimer);
    _unreadDebounceTimer = setTimeout(() => _refreshUnreadCount(uid), 400);
  }

  async function _refreshUnreadCount(uid) {
    try {
      // Firestore compat SDK doesn't reliably expose count() aggregation on
      // all deployed versions here, so fall back to a capped read: 100 docs
      // is enough to distinguish "a lot" from "an exact small number", and
      // updateBadge() already renders anything over 99 as '99+'.
      const snap = await db.collection('notifications').doc(uid)
        .collection('items')
        .where('read', '==', false)
        .limit(100)
        .get();
      updateBadge(snap.size);
    } catch (e) {
      console.error('unread count query failed', e);
    }
  }

  function stopListener() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (_unreadDebounceTimer) { clearTimeout(_unreadDebounceTimer); _unreadDebounceTimer = null; }
  }

  // ── Badge ─────────────────────────────────────
  function updateBadge(count) {
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.toggle('hidden', count === 0);
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
    if (!_lastUid) return;
    // Mark EVERY unread item read — not just the ~30 in the live panel window.
    // The badge counts true unread (up to 100), so clearing only the visible
    // window left older unread items keeping the badge lit even after the user
    // "read them all" (they've read everything they can see). Query unread
    // directly and drain it in 400-doc batches (Firestore's 500-op cap).
    try {
      updateBadge(0);   // optimistic clear — the listener refresh confirms it
      for (;;) {
        const snap = await db.collection('notifications').doc(_lastUid)
          .collection('items').where('read', '==', false).limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach(d => batch.update(d.ref, { read: true }));
        await batch.commit();
        if (snap.size < 400) break;
      }
    } catch (e) {
      console.error('markAllRead failed', e);
    }
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

  // ── Phase 186: per-type icon + accent registry ─────────────────
  // Enumerated by grepping every `Notifs.send*(...,{ type: '...' })` call
  // site across js/*.js (task/finance/payroll/chat/quote/inventory/AEC/HR/
  // drawing/leave families). Exact hits get a tuned icon+accent; anything
  // outside this list falls through _typeMeta()'s prefix rules below so a
  // future new `type` string still renders sensibly instead of a bare bell.
  const NOTIF_TYPE_META = {
    // Tasks
    task_assigned:{icon:'✅',accent:'#3B5BDB'}, task_status:{icon:'📌',accent:'#3B5BDB'},
    task_message:{icon:'💬',accent:'#1C7ED6'}, task_comment:{icon:'💬',accent:'#1C7ED6'},
    task_created:{icon:'✨',accent:'#3B5BDB'}, task_designated:{icon:'📋',accent:'#3B5BDB'},
    task_modified:{icon:'✏️',accent:'#3B5BDB'}, task_standing:{icon:'📋',accent:'#3B5BDB'},
    task_followup:{icon:'🔔',accent:'#3B5BDB'}, task_followup_done:{icon:'✅',accent:'#3B5BDB'},
    task_submitted:{icon:'📤',accent:'#3B5BDB'},
    deadline:{icon:'⏰',accent:'#E8590C'},
    // Chat
    chat_message:{icon:'💬',accent:'#0866FF'},
    // Cash advance / payroll
    cash_advance:{icon:'💸',accent:'#F76707'}, ca_deduct:{icon:'💸',accent:'#F76707'},
    ca_deduct_remind:{icon:'💸',accent:'#F76707'}, ca_deduct_req:{icon:'💸',accent:'#F76707'},
    ca_approved:{icon:'💸',accent:'#F76707'},
    payroll:{icon:'💰',accent:'#2F9E44'}, payroll_reminder:{icon:'💰',accent:'#2F9E44'},
    payroll_delete_request:{icon:'🗑️',accent:'#D92D20'}, payroll_delete_approved:{icon:'🗑️',accent:'#2F9E44'},
    payroll_delete_denied:{icon:'🗑️',accent:'#D92D20'},
    raise_request:{icon:'📈',accent:'#2F9E44'}, raise_applied:{icon:'📈',accent:'#2F9E44'},
    kpi_grade:{icon:'🎯',accent:'#E64980'}, self_assessment:{icon:'📝',accent:'#E64980'},
    payslip:{icon:'🧾',accent:'#2F9E44'},
    // Finance
    finance_entry:{icon:'🧾',accent:'#2F9E44'}, expense_new:{icon:'🧾',accent:'#2F9E44'},
    finance_delete_request:{icon:'🗑️',accent:'#D92D20'}, finance_delete_approved:{icon:'🗑️',accent:'#2F9E44'},
    finance_delete_denied:{icon:'🗑️',accent:'#D92D20'},
    // Attendance
    attendance:{icon:'📅',accent:'#0CA678'}, att_morning_remind:{icon:'🌅',accent:'#0CA678'},
    att_extension:{icon:'⏱️',accent:'#0CA678'}, att_extension_approved:{icon:'✅',accent:'#0CA678'},
    att_extension_denied:{icon:'❌',accent:'#D92D20'},
    leave:{icon:'🌴',accent:'#0CA678'},
    // Posts / memos / company
    post:{icon:'📣',accent:'#D6336C'}, post_approval:{icon:'📣',accent:'#D6336C'}, memo:{icon:'📄',accent:'#7048E8'},
    award:{icon:'🏆',accent:'#F59F00'}, nudge:{icon:'👋',accent:'#7048E8'},
    // Approvals / deletes (generic)
    approval_result:{icon:'✅',accent:'#2F9E44'}, delete_approved:{icon:'🗑️',accent:'#2F9E44'},
    delete_denied:{icon:'🗑️',accent:'#D92D20'}, client_delete_request:{icon:'🗑️',accent:'#D92D20'},
    quote_delete_request:{icon:'🗑️',accent:'#D92D20'},
    // Sales / quotes / partners
    quote_filed:{icon:'📄',accent:'#1C7ED6'}, quote_returned:{icon:'↩️',accent:'#E8590C'},
    quote_review_request:{icon:'👀',accent:'#1C7ED6'}, quote_approved:{icon:'✅',accent:'#2F9E44'},
    quote_rejected:{icon:'❌',accent:'#D92D20'}, bs_quote:{icon:'📄',accent:'#1C7ED6'},
    sales_order:{icon:'🛒',accent:'#1C7ED6'}, lead_handoff:{icon:'🤝',accent:'#1C7ED6'},
    partner_deal:{icon:'🤝',accent:'#1C7ED6'},
    // Purchasing / inventory
    po_approval:{icon:'🧮',accent:'#F76707'}, po_approval_result:{icon:'🧮',accent:'#2F9E44'},
    purchase_submitted:{icon:'🧮',accent:'#F76707'}, low_stock:{icon:'📦',accent:'#E8590C'},
    // AEC / Sales pipeline
    aec_followup:{icon:'📇',accent:'#1C7ED6'},
    // Drawings / design
    drawing_for_review:{icon:'📐',accent:'#7048E8'}, drawing_assigned:{icon:'📐',accent:'#7048E8'},
    drawing_approved:{icon:'✅',accent:'#7048E8'}, drawing_released:{icon:'📐',accent:'#7048E8'},
    // Projects
    project_link:{icon:'🔗',accent:'#1C7ED6'}, project_paid:{icon:'💰',accent:'#2F9E44'},
    project_stage:{icon:'📊',accent:'#1C7ED6'}, project_team:{icon:'👥',accent:'#1C7ED6'},
    // Submissions / suggestions
    submission_new:{icon:'📥',accent:'#1C7ED6'}, submission_reviewed:{icon:'✅',accent:'#2F9E44'},
    suggestion:{icon:'💡',accent:'#F59F00'},
    // System / general
    system:{icon:'⚙️',accent:'var(--text-muted)'}, general:{icon:'🔔',accent:'var(--primary)'},
  };
  // Prefix fallback so an unenumerated/legacy `type` (or a future one) still
  // gets a sensible family icon instead of a bare bell.
  function _typeMeta(type) {
    if (type && NOTIF_TYPE_META[type]) return NOTIF_TYPE_META[type];
    const t = type || '';
    if (t.startsWith('task'))     return {icon:'✅',accent:'#3B5BDB'};
    if (t.startsWith('att'))      return {icon:'📅',accent:'#0CA678'};
    if (t.startsWith('ca_') || t === 'cash_advance') return {icon:'💸',accent:'#F76707'};
    if (t.startsWith('payroll'))  return {icon:'💰',accent:'#2F9E44'};
    if (t.startsWith('finance'))  return {icon:'🧾',accent:'#2F9E44'};
    if (t.startsWith('quote'))    return {icon:'📄',accent:'#1C7ED6'};
    if (t.startsWith('drawing'))  return {icon:'📐',accent:'#7048E8'};
    if (t.startsWith('project'))  return {icon:'📊',accent:'#1C7ED6'};
    if (t.startsWith('po_') || t.startsWith('purchase')) return {icon:'🧮',accent:'#F76707'};
    if (t.startsWith('delete'))   return {icon:'🗑️',accent:'#D92D20'};
    if (t.startsWith('submission')) return {icon:'📥',accent:'#1C7ED6'};
    return NOTIF_TYPE_META.general;
  }

  // ── Phase 186: Manila day grouping ──────────────────────────────
  // Reimplemented locally (mirrors chat.js's _manilaDay pattern) rather than
  // sharing code across files — small enough to duplicate, keeps this file
  // self-contained per the task boundary.
  function _manilaDayLabel(ts) {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const day = window.bizDate ? window.bizDate(date) : date.toISOString().slice(0,10);
    const today = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
    const yesterday = window.bizDate ? window.bizDate(new Date(Date.now() - 24*60*60*1000)) : '';
    if (day === today) return 'Today';
    if (day === yesterday) return 'Yesterday';
    try {
      return date.toLocaleDateString('en-PH', { month:'short', day:'numeric', year: (day.slice(0,4) !== today.slice(0,4)) ? 'numeric' : undefined, timeZone:'Asia/Manila' });
    } catch (_) { return day; }
  }

  function _groupByDay(items) {
    const groups = [];
    let cur = null;
    items.forEach(n => {
      const label = _manilaDayLabel(n.createdAt);
      if (!cur || cur.label !== label) { cur = { label, items: [] }; groups.push(cur); }
      cur.items.push(n);
    });
    return groups;
  }

  function _renderIntoList(list, items, uid) {
    if (!list) return;
    if (items.length === 0) {
      list.innerHTML = window.renderEmptyState
        ? window.renderEmptyState({ icon:'🎉', title:"You're all caught up", hint:'New notifications will show up here.' })
        : `<div class="empty-state" style="padding:30px"><div class="empty-icon">${emojiIcon('🎉',44)}</div><p>You're all caught up</p></div>`;
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

    // Group by Manila calendar day (Today / Yesterday / date) — cheap enough
    // to do for both the panel dropdown and the full page (items.length is
    // capped at the 30-item live window or one page of the paginated list).
    const groups = _groupByDay(items);
    const rowHtml = n => {
      const nav = isNavigable(n);
      const rawTitle = n.title || '';
      const lead = (rawTitle.match(LEAD_EMOJI) || [''])[0].trim();
      const titleText = rawTitle.replace(LEAD_EMOJI, '').trim() || rawTitle;
      const meta = _typeMeta(n.type);
      const icon = n.icon || lead || meta.icon;
      const tileIcon = window.LUCIDE_EMOJI_MAP[icon] || (/^[a-z0-9-]+$/.test(icon) ? icon : (window.LUCIDE_EMOJI_MAP[meta.icon] || 'bell'));
      const tileColor = meta.accent || 'var(--primary)';
      const absTime = window.fmtManila ? window.fmtManila(n.createdAt) : '';
      // v13 Phase 66: unread rows get a small accent dot + heavier title weight,
      // inlined (not a styles.css class) per this file's existing toast precedent.
      const unreadDot = !n.read ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${tileColor};margin-right:6px;flex-shrink:0;vertical-align:middle"></span>` : '';
      return `
      <div class="notif-item ${n.read ? 'read' : 'unread'}" data-id="${escHtml(n.id)}" data-type="${escHtml(n.type||'')}" data-task-id="${escHtml(n.taskId||'')}" data-chat-id="${escHtml(n.chatId||'')}">
        <div class="notif-item-main">
          <div class="notif-item-emoji">${window.iconTile(tileIcon, tileColor, window.lightenHex(tileColor,18), 32)}</div>
          <div class="notif-item-text">
            <div class="notif-item-title" style="${n.read ? '' : 'font-weight:700'}">${unreadDot}${escHtml(titleText)}</div>
            <div class="notif-item-body">${escHtml(n.body || '')}</div>
            <div class="notif-item-time" title="${escHtml(absTime)}">${timeAgo(n.createdAt)}</div>
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
    };
    const caughtUpBanner = unreadCount === 0
      ? `<div class="notif-caughtup" style="text-align:center;padding:8px 12px;font-size:12px;color:var(--success,#2F9E44);font-weight:600">${emojiIcon('🎉',14)} All caught up</div>`
      : '';
    list.innerHTML = caughtUpBanner + groups.map(g => `
      <div class="notif-day-group">
        <div class="notif-day-header" style="padding:8px 12px 4px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em">${escHtml(g.label)}</div>
        ${g.items.map(rowHtml).join('')}
      </div>`).join('');
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
  async function send(targetUid, { title, body, icon = `${emojiIcon('🔔',16)}`, type = 'general', link = null, dedupKey = null, taskId = null, chatId = null } = {}) {
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
      ...(window.currentUser && window.currentUser.uid ? { senderUid: window.currentUser.uid } : {}),
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

  // ── Delete notifications generated by a since-deleted chat message ────
  // (owner req #4). `messageId` is NOT in firestore.rules' notifications
  // create allowlist (title/body/icon/type/link/read/createdAt/dedupKey/
  // taskId/chatId/senderUid only, see firestore.rules ~line 220) — adding it
  // to the create() write here would fail validation. Until a paired rules
  // change adds `messageId` to that hasOnly([...]) list (giving exact
  // targeting), this matches on chatId + a tight createdAt window around the
  // message's own timestamp: the chat notif is written moments after the
  // message doc (same sendMessage() call), so a window of a few seconds is
  // enough to isolate it without over-deleting a still-live message's notif.
  const DELETE_FOR_MESSAGE_WINDOW_MS = 15000;
  async function deleteForMessage(chatId, messageCreatedAtMs, recipientUids) {
    if (!chatId || !messageCreatedAtMs || !Array.isArray(recipientUids)) return;
    await Promise.all(recipientUids.map(async uid => {
      try {
        const snap = await db.collection('notifications').doc(uid).collection('items')
          .where('chatId', '==', chatId).where('type', '==', 'chat_message').get();
        const matches = snap.docs.filter(d => {
          const ts = d.data().createdAt?.toMillis?.();
          return ts != null && Math.abs(ts - messageCreatedAtMs) <= DELETE_FOR_MESSAGE_WINDOW_MS;
        });
        await Promise.all(matches.map(d => d.ref.delete().catch(() => {})));
      } catch (_) { /* best-effort — a stray undeleted notif is harmless */ }
    }));
  }

  // ── Dedup helpers (Phase 30 item 1) ────────────
  // send() dedups via a per-recipient query (where dedupKey == ...) before add().
  // That's fine for single-recipient sends, but doing a query-per-recipient for
  // broadcast fan-out (dept/all/owner) would blow the batch-write efficiency the
  // comments below already call out. Instead: derive a deterministic Firestore
  // doc id from the dedupKey and use batch.set() (idempotent) instead of
  // batch.set() with an auto-id — re-running the same broadcast the same day
  // overwrites the same doc rather than creating a duplicate.
  function _defaultDedupKey(notifData) {
    const day = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10);
    return [notifData.type || 'notif', notifData.title || '', day].join('|');
  }
  function _dedupDocId(dedupKey) {
    // Firestore doc ids can't contain '/'; keep it deterministic + safe.
    return 'dedup_' + dedupKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 400);
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
    // Use batch writes — avoids per-user dedupKey read + stays under Firestore write limits.
    // Idempotency comes from a deterministic doc id (derived from dedupKey) instead of a
    // per-recipient exists-check query: set() on the same id is a no-op re-write, not a dup.
    const dedupKey = notifData.dedupKey || _defaultDedupKey(notifData);
    const docId = _dedupDocId(dedupKey);
    const senderUid = (window.currentUser && window.currentUser.uid) ? { senderUid: window.currentUser.uid } : {};
    const docs = allDocs.slice();
    while (docs.length) {
      const chunk = docs.splice(0, 499);
      const batch = db.batch();
      chunk.forEach(doc => {
        const ref = db.collection('notifications').doc(doc.id).collection('items').doc(docId);
        batch.set(ref, { ...notifData, dedupKey, ...senderUid, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }
  }

  // ── Send to all users ────────────────────────
  async function sendToAll(notifData) {
    const snap = await db.collection('users').get();
    const dedupKey = notifData.dedupKey || _defaultDedupKey(notifData);
    const docId = _dedupDocId(dedupKey);
    const senderUid = (window.currentUser && window.currentUser.uid) ? { senderUid: window.currentUser.uid } : {};
    const docs = snap.docs.slice();
    while (docs.length) {
      const chunk = docs.splice(0, 499);
      const batch = db.batch();
      chunk.forEach(doc => {
        const ref = db.collection('notifications').doc(doc.id).collection('items').doc(docId);
        batch.set(ref, { ...notifData, dedupKey, ...senderUid, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
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
    const dedupKey = notifData.dedupKey || _defaultDedupKey(notifData);
    const docId = _dedupDocId(dedupKey);
    const senderUid = (window.currentUser && window.currentUser.uid) ? { senderUid: window.currentUser.uid } : {};
    const batch = db.batch();
    allDocs.forEach(d => {
      const ref = db.collection('notifications').doc(d.id).collection('items').doc(docId);
      batch.set(ref, { ...notifData, dedupKey, ...senderUid, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
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
  const PUSH_SNOOZE_KEY   = 'bi_push_snooze_until';   // ms epoch; don't re-ask before this
  const PUSH_SNOOZE_MS    = 3 * 24 * 3600 * 1000;     // 3 days after a dismissal
  const PUSH_IOS_HINT_KEY = 'bi_push_ios_hint_shown'; // '1' once the install hint was shown

  // Web push needs all three. iOS Safari exposes Notification but push only
  // actually works from an installed (Home Screen) PWA — see _isIOS/_isStandalone.
  function _pushSupported() {
    return ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
  }
  function _isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
  }
  function _isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }
  function _pushSnoozed() {
    try { return Date.now() < (+localStorage.getItem(PUSH_SNOOZE_KEY) || 0); } catch (_) { return false; }
  }
  function _snoozePush() {
    try { localStorage.setItem(PUSH_SNOOZE_KEY, String(Date.now() + PUSH_SNOOZE_MS)); } catch (_) {}
  }
  function _clearPushSnooze() {
    try { localStorage.removeItem(PUSH_SNOOZE_KEY); } catch (_) {}
  }

  async function initPush(uid) {
    const vapidKey = window.FCM_CONFIG?.VAPID_KEY;
    if (!vapidKey || vapidKey === 'YOUR_VAPID_KEY_HERE') return;
    try {
      if (!_pushSupported()) return;

      // iOS delivers web push ONLY from an installed Home-Screen PWA. In a plain
      // Safari tab requestPermission() can never grant, so prompting on every
      // launch just nags without ever working. Show a one-time install hint and
      // stop — no permission card. (Once installed, _isStandalone() is true and
      // the normal flow below runs.)
      if (_isIOS() && !_isStandalone()) {
        _maybeShowIosInstallHint();
        return;
      }

      if (Notification.permission === 'denied') return;

      // Already granted — register silently every launch (token can rotate).
      if (Notification.permission === 'granted') {
        _clearPushSnooze();
        await _registerPush(uid, vapidKey);
        return;
      }

      // permission === 'default' — ask, but never more than once per session and
      // not again for a few days after the user dismisses.
      if (window._pushPromptShownThisSession || _pushSnoozed()) return;
      window._pushPromptShownThisSession = true;
      _showPushPrompt(uid, vapidKey);
    } catch (err) {
      console.warn('[FCM] Push init failed:', err);
    }
  }

  // iOS-Safari-only, at most once ever: nudge the user to install the PWA so
  // notifications become available. Deliberately gentle (a toast, not a card).
  function _maybeShowIosInstallHint() {
    try {
      if (localStorage.getItem(PUSH_IOS_HINT_KEY) === '1') return;
      localStorage.setItem(PUSH_IOS_HINT_KEY, '1');
    } catch (_) { return; }
    setTimeout(() => showToast('To get notifications on iPhone, tap Share → “Add to Home Screen”, then open the app from there.', 'info'), 2500);
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
          <div style="font-size:44px;margin-bottom:10px">${emojiIcon('🔔',44)}</div>
          <div style="font-size:18px;font-weight:800;color:var(--text,#e8eaf0);margin-bottom:8px">Allow Notifications</div>
          <div style="font-size:13px;color:var(--text-muted,#8a9bc0);line-height:1.6">
            Please allow notifications so you can receive alerts for:
          </div>
          <div style="margin:14px 0;display:flex;flex-direction:column;gap:8px;text-align:left">
            ${[
              [`${emojiIcon('✅',16)}`,'Task assignments & status updates'],
              [`${emojiIcon('💬',16)}`,'New messages & comments'],
              [`${emojiIcon('📋',16)}`,'Self-assessment & payroll reminders'],
              [`${emojiIcon('⏰',16)}`,'Attendance & deadline alerts'],
              [`${emojiIcon('💸',16)}`,'Cash advance approvals'],
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
        ">${emojiIcon('🔔',16)} Allow Notifications</button>
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
      if (permission === 'granted') { _clearPushSnooze(); await _registerPush(uid, vapidKey); }
      else { _snoozePush(); }   // 'denied' or 'default' (iOS quirk) — don't re-ask next launch
    };
    // Any dismissal snoozes the prompt so it doesn't reappear on every open.
    const dismiss = () => { _snoozePush(); overlay.remove(); };
    document.getElementById('push-deny-btn').onclick = dismiss;
    overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });
    setTimeout(() => { if (document.body.contains(overlay)) dismiss(); }, 60000);
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
      } else {
        // Permission granted but no token — usually a VAPID-key mismatch or the
        // messaging SW failing to activate. Surface it so it's not a silent no-op.
        console.warn('[FCM] getToken returned empty — no push token issued (check VAPID key / SW activation).');
      }
      // Show in-app toast for foreground messages. Messages are data-only now
      // (see functions/index.js), so read title/body from payload.data — and
      // attach the handler only once so re-registration doesn't stack toasts.
      if (!window._fcmOnMessageBound) {
        window._fcmOnMessageBound = true;
        messaging.onMessage(payload => {
          const d = payload.data || payload.notification || {};
          const { title, body } = d;
          if (title) showToast(`${title}${body ? ': '+body : ''}`, 'info');
        });
      }
      // Push-click deep-link: the background SW (firebase-messaging-sw.js)
      // focuses this tab and postMessages PUSH_NAV; route it through the same
      // in-app navigation the panel uses. Bound once.
      if (!window._fcmNavBound && navigator.serviceWorker) {
        window._fcmNavBound = true;
        navigator.serviceWorker.addEventListener('message', ev => {
          const m = ev.data || {};
          if (m.type !== 'PUSH_NAV') return;
          try { _navigateFromNotif(m.notifType, m.taskId, m.chatId); }
          catch (e) { if (m.link && typeof navigateTo === 'function') navigateTo(m.link); }
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
  function showToast(message, type) {
    if (type === undefined) {
      console.warn('[Notifs] showToast without a type — use Notifs.success/error/info', String(message).slice(0, 60));
    }
    type = type || 'info';
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
    toast.setAttribute('role', 'status');       // v13 Phase 188: screen-reader
    toast.setAttribute('aria-live', 'polite');  // announces toast text
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

    document.getElementById('notif-see-all-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      closePanel();
      if (typeof navigateTo === 'function') navigateTo('notifications');
    });

    // Phase 186 item 4: settings surface. The real per-type reminder toggles
    // already live in the profile drawer (js/app.js openProfileDrawer, the
    // NOTIFICATIONS section) — not rebuilt here. Just surface a gear
    // affordance in the panel footer that opens that existing drawer, since
    // it was otherwise buried behind profile → scroll. index.html/styles.css
    // are out of scope for this file, so the button is created and inserted
    // here rather than hand-added to the static markup.
    const footer = document.querySelector('#notif-panel .notif-footer');
    if (footer && !document.getElementById('notif-settings-gear-btn')) {
      const gear = document.createElement('button');
      gear.type = 'button';
      gear.id = 'notif-settings-gear-btn';
      gear.title = 'Notification settings';
      gear.setAttribute('aria-label', 'Notification settings');
      gear.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;line-height:0';
      gear.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
      footer.style.position = 'relative';
      footer.appendChild(gear);
      gear.addEventListener('click', e => {
        e.stopPropagation();
        closePanel();
        if (typeof window.openProfileDrawer === 'function') window.openProfileDrawer();
        else if (typeof navigateTo === 'function') navigateTo('my-profile');
      });
    }
  }

  // ── Toast semantics (Phase 117) — typed convenience wrappers around showToast ──
  function success(message) { showToast(message, 'success'); }
  function error(message)   { showToast(message, 'error'); }
  function info(message)    { showToast(message, 'info'); }

  return { startListener, stopListener, send, sendToDept, sendToAll, sendToOwner, deleteForMessage, showToast, success, error, info, initPush, checkDeadlines, checkAttendanceReminder, checkLowStock, checkAECFollowups, initToggle, renderPage, markAllRead,
    requestPushPermission: (uid) => {
      const vapidKey = window.FCM_CONFIG?.VAPID_KEY;
      if (!vapidKey || vapidKey === 'YOUR_VAPID_KEY_HERE') { showToast('Push notifications not configured yet.','error'); return; }
      if (!_pushSupported()) { showToast('This browser doesn’t support push notifications.','error'); return; }
      // Manual enable is a user gesture, so it bypasses the launch-time snooze —
      // but on iOS Safari it still can't work until the app is installed.
      if (_isIOS() && !_isStandalone()) {
        showToast('On iPhone, first tap Share → “Add to Home Screen”, then open the app from your home screen to enable notifications.','info');
        return;
      }
      if (Notification.permission === 'granted') { _clearPushSnooze(); _registerPush(uid, vapidKey); }
      else if (Notification.permission !== 'denied') { window._pushPromptShownThisSession = true; _showPushPrompt(uid, vapidKey); }
      else { showToast('Notifications are blocked in your browser. Check site settings to re-enable.','error'); }
    }
  };
})();

// Toast animation
const toastStyle = document.createElement('style');
toastStyle.textContent = `@keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`;
document.head.appendChild(toastStyle);
