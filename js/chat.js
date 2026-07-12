/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Team Chat (v12 WS37)
   js/chat.js — loaded LAST (after modules.js). All cross-file globals
   (escHtml, safeHttpUrl, Notifs, Overlay, dbCachedGet, DEPARTMENTS,
   navigateTo, currentUser/currentRole/currentDepts/userProfile) are
   referenced at RUNTIME only — never at parse time.
═══════════════════════════════════════════════════ */
window.Chat = (() => {
  // ── Tunables ──
  const PAGE_SIZE         = 50;      // live window + "Load earlier" page size
  const TYPING_WRITE_MS   = 4000;    // min gap between own typing beacons
  const TYPING_TTL_MS     = 6000;    // beacon age still shown as "typing…"
  const READ_FRESH_MS     = 45000;   // recipient read this recently → skip notif
  const NOTIF_THROTTLE_MS = 60000;   // per (conversation, recipient) notif spacing
  const REACTIONS = ['👍','❤️','😂','😮','😢','🙏'];
  const GROUP_WINDOW_MS = 2 * 60 * 1000;     // WS42 Phase 17: consecutive-message grouping window
  const TIME_GAP_MS     = 20 * 60 * 1000;    // WS42 Phase 17: time-gap separator threshold
  // WS42 Phase 18 — chat wallpaper presets (pure CSS; keys map 1:1 to `.wp-<key>` on .messenger-body)
  const WALLPAPERS = [
    { key: 'default',         label: 'Default' },
    { key: 'doodle',          label: 'Doodle' },
    { key: 'gradient-blue',   label: 'Ocean Blue' },
    { key: 'gradient-sunset', label: 'Sunset' },
    { key: 'astral',          label: 'Astral' }
  ];

  // ── Listener state — the ONLY live listeners this feature owns ──
  let _inboxUnsub = null;                    // (1) conversations array-contains
  let _threadUnsubs = [];                    // (2-4) messages/readers/typing for the ONE open thread
  let _openConvId = null, _openConv = null;
  let _convs = [], _deptConvs = [], _myReads = {};   // inbox state
  let _msgs = [], _earlier = [], _readers = [], _typing = [];  // thread state
  let _presenceTimer = null, _typingExpireTimer = null, _markReadTimer = null;
  let _lastTypingWrite = 0, _filter = 'all', _searchQ = '';
  let _presenceByUid = {}, _usersByUid = {};  // small local caches (NOT extra listeners)
  const _notifLastSent = {};                 // `${convId}_${uid}` → ms epoch
  let _lastMsgIds = null;                    // WS42 Phase 19: which bubble ids already animated in (send pop-in)
  let _lastRenderOrder = null;               // Phase 63 #2: message-id order of the last DOM render (keyed-diff)
  let _earlierCapped = false;                // Phase 63 #3: true once _earlier has been trimmed to the cap
  let _wpMenuOpen = false;                   // WS42 Phase 18: wallpaper popover state
  let _isSending = false;                    // Phase 63 #1: shared guard — click AND Enter both route through doSend
  // Phase 63 #5: inbox refresh cascade debounce (leading-immediate, 2s trailing coalesce)
  let _inboxDebTimer = null, _inboxDebPendingSnap = null, _inboxWindowStart = 0;
  const EARLIER_CAP = 300;                   // Phase 63 #3

  const _isAdminRole = () => ['president','manager','secretary'].includes(currentRole);
  const _myName = () => (window.userProfile?.displayName || currentUser.email);
  function dmIdFor(a, b) { return 'dm_' + [a, b].sort().join('_'); }
  function deptChannelKeys() {
    return Object.keys(window.DEPARTMENTS || {})
      .filter(d => !DEPARTMENTS[d].isSeparate && !DEPARTMENTS[d].isPartnerDept);
  }
  function myDeptChannels() {
    if (typeof isPartner === 'function' && isPartner()) return [];  // partners NEVER
    return _isAdminRole() ? deptChannelKeys()
      : deptChannelKeys().filter(d => (currentDepts || []).includes(d));
  }
  // Decision 3: partner picker = same-company partners + president/manager.
  function dmCandidates(users) {
    if (typeof isPartner === 'function' && isPartner()) {
      const myCo = (window.userProfile?.company || '').trim();
      return users.filter(u => u.id !== currentUser.uid && (
        (u.role === 'partner' && (u.company || '').trim() === myCo) ||
        ['president','manager'].includes(u.role)));
    }
    return users.filter(u => u.id !== currentUser.uid);   // internal: everyone
  }

  // ── Teardown (exact lifecycle contract) ──
  function teardownInbox() {                 // called by navigateTo on ANY non-chat page
    if (_inboxUnsub) { try { _inboxUnsub(); } catch(_){} _inboxUnsub = null; }
    if (_inboxDebTimer) { clearTimeout(_inboxDebTimer); _inboxDebTimer = null; }
    _inboxDebPendingSnap = null; _inboxWindowStart = 0;
  }
  function teardownThread() {                // Overlay teardown callback — NEVER calls dismissTop
    if (_openConvId) _clearOwnTyping();      // Decision 8: beacon cleared on panel-close too
    _threadUnsubs.forEach(u => { try { u(); } catch(_){} });
    _threadUnsubs = []; _openConvId = null; _openConv = null;
    _msgs = []; _earlier = []; _readers = []; _typing = []; _lastMsgIds = null;
    _lastRenderOrder = null; _earlierCapped = false; _isSending = false;
    if (_presenceTimer)     { clearInterval(_presenceTimer);     _presenceTimer = null; }
    if (_typingExpireTimer) { clearInterval(_typingExpireTimer); _typingExpireTimer = null; }
    if (_markReadTimer)     { clearTimeout(_markReadTimer);      _markReadTimer = null; }
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', _onViewportResize);
    if (_wpMenuOpen) document.removeEventListener('click', _wpOutsideClick, true);
    _wpMenuOpen = false;
    _exitFullscreen();                       // owner req #2: restore app chrome on close
    const p = document.getElementById('chat-thread-panel');
    if (p) { p.style.transform = 'translateY(100%)'; p.style.opacity = '0'; p.style.bottom = '0';
             setTimeout(() => p.remove(), 320); }          // mirrors closeTaskPanel
  }

  // ── Inbox ──
  function _attachInbox() {
    teardownInbox();
    _inboxUnsub = db.collection('conversations')
      .where('participants', 'array-contains', currentUser.uid)
      .onSnapshot(snap => { _scheduleInboxRefresh(snap); },
        () => { const el = document.getElementById('chat-inbox');
                 if (el) el.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('💬',44)}</div><h4>Chat unavailable</h4></div>`; });
  }
  // Phase 63 #5 — dept channels + readers + presence all re-fetch on every
  // conversations snapshot; a burst of activity (several people posting, or
  // a batch of reader-doc writes) used to fire that whole cascade once per
  // snapshot. Leading-edge immediate (so the inbox never feels laggy on the
  // FIRST event of a burst), then coalesce any further snapshots into a
  // single trailing run at the end of a rolling 2s window.
  async function _runInboxRefresh(snap) {
    _convs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await _refreshDeptChannels();            // deterministic-ID direct gets
    await _refreshMyReads();                 // one own-reader-doc get per conversation
    await _refreshPresence();                // DM row presence dots (users-presence cache)
    _renderInbox();
  }
  function _scheduleInboxRefresh(snap) {
    const now = Date.now();
    if (!_inboxWindowStart || now - _inboxWindowStart >= 2000) {
      _inboxWindowStart = now;
      if (_inboxDebTimer) { clearTimeout(_inboxDebTimer); _inboxDebTimer = null; }
      _inboxDebPendingSnap = null;
      _runInboxRefresh(snap);
      return;
    }
    _inboxDebPendingSnap = snap;             // coalesce: keep only the latest snapshot
    if (_inboxDebTimer) return;              // a trailing run is already scheduled
    _inboxDebTimer = setTimeout(() => {
      _inboxDebTimer = null;
      _inboxWindowStart = Date.now();
      const s = _inboxDebPendingSnap; _inboxDebPendingSnap = null;
      if (s) _runInboxRefresh(s);
    }, 2000 - (now - _inboxWindowStart));
  }
  async function _refreshDeptChannels() {
    _deptConvs = (await Promise.all(myDeptChannels().map(d =>
      db.collection('conversations').doc('dept_' + d).get()
        .then(s => s.exists ? { id: s.id, ...s.data() }
          : { id: 'dept_' + d, type: 'dept', department: d, name: d,
              participants: [], _unprovisioned: true })
        .catch(() => null)             // read on missing doc is rules-denied? No: denied ≠ missing; drop it
    ))).filter(Boolean);
  }
  async function _refreshMyReads() {
    const all = [..._convs, ..._deptConvs];
    await Promise.all(all.map(cv =>
      db.collection('conversations').doc(cv.id).collection('readers').doc(currentUser.uid).get()
        .then(s => { _myReads[cv.id] = s.exists ? (s.data().readAt?.toMillis?.() || 0) : 0; })
        .catch(() => { _myReads[cv.id] = 0; })));
  }
  // DM inbox-row presence dots read the SAME 8s-TTL users-presence cache the
  // Team tab uses (Decision 7) — no new listener, just a local uid→doc map.
  async function _refreshPresence() {
    try {
      const snap = await dbCachedGet('users-presence', fetchUsersWithPayroll, 8000);
      const map = {};
      snap.docs.forEach(d => { map[d.id] = d.data(); });
      _presenceByUid = map;
    } catch (_) { /* keep the previous snapshot on a transient failure */ }
  }
  function _isUnread(cv) {
    const last = cv.lastMessageAt?.toMillis?.() || 0;
    return last > 0 && cv.lastMessageBy !== currentUser.uid && last > (_myReads[cv.id] || 0);
  }
  function _timeAgo(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff/60)}m`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h`;
    return `${Math.floor(diff/86400)}d`;
  }
  function setFilter(k) { _filter = k; _renderInbox(); }
  function setSearch(q) { _searchQ = (q || '').trim().toLowerCase(); _renderInbox(); }

  // Merge _convs (dm/group — the ONLY types the array-contains listener can
  // ever return, since dept docs keep participants:[]) with a dept-channel row
  // list DERIVED from myDeptChannels(), not solely from _deptConvs: a dept
  // channel nobody has opened yet is still a real membership the user should
  // see (and tap to lazily create) — but a get() on a dept_<X> doc that
  // doesn't exist is rules-DENIED (not "not found", see firestore.rules'
  // Spec 2a note), so _refreshDeptChannels's own catch(()=>null) silently
  // drops those. Re-deriving the row list from myDeptChannels() here keeps
  // every one of the user's channels visible regardless of whether anyone
  // has provisioned the Firestore doc yet.
  function _renderInbox() {
    const el = document.getElementById('chat-inbox');
    if (!el) return;
    const deptRows = myDeptChannels().map(d => {
      const existing = _deptConvs.find(cv => cv.department === d);
      return existing || { id: 'dept_' + d, type: 'dept', department: d, name: d,
        participants: [], lastMessageAt: null, lastMessageText: null,
        lastMessageBy: null, lastMessageByName: null, _unprovisioned: true };
    });
    const all = [..._convs, ...deptRows];
    const filtered = _filter === 'all' ? all : all.filter(cv => cv.type === _filter);
    const sorted = filtered.slice().sort((a, b) =>
      (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0));

    if (!sorted.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('💬',44)}</div><h4>No conversations yet</h4><p>Tap "+ New Message" to start one.</p></div>`;
      return;
    }
    const myUid = currentUser.uid;
    const initials = s => escHtml((s || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    // WS42 Phase 16 — resolve title first (search needs it before the row markup exists).
    const rows = sorted.map(cv => {
      let title;
      if (cv.type === 'dm') {
        const otherUid = (cv.participants || []).find(u => u !== myUid);
        title = (cv.participantNames && cv.participantNames[otherUid]) || 'User';
      } else if (cv.type === 'group') {
        title = cv.name || 'Group';
      } else {
        title = cv.name || cv.department || 'Channel';
      }
      return { cv, title };
    }).filter(r => !_searchQ || r.title.toLowerCase().includes(_searchQ));

    if (!rows.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔎',44)}</div><h4>No matches</h4></div>`;
      return;
    }
    el.innerHTML = '<div class="item-list">' + rows.map(({ cv, title }) => {
      const unread = _isUnread(cv);
      let avatarHtml;
      if (cv.type === 'dm') {
        const otherUid = (cv.participants || []).find(u => u !== myUid);
        const pres = _presenceBucket(_presenceByUid[otherUid]?.lastSeen);
        const dotColor = { green: '#30D158', orange: '#FF9F0A', gray: '#8E8E93' }[pres.dot] || '#8E8E93';
        avatarHtml = `<div class="ms-avatar ms-avatar-lg" style="position:relative;flex-shrink:0">${initials(title)}<span class="ms-presence-dot" style="background:${dotColor}"></span></div>`;
      } else if (cv.type === 'group') {
        avatarHtml = `<div class="ms-avatar ms-avatar-lg" style="flex-shrink:0">${initials(title)}</div>`;
      } else {
        const cfg = (window.DEPARTMENTS || {})[cv.department] || {};
        avatarHtml = `<div class="ms-avatar ms-avatar-lg" style="flex-shrink:0;background:${cfg.color || 'var(--primary)'}">${cfg.icon || `${emojiIcon('💬',16)}`}</div>`;
      }
      const preview = cv.lastMessageText ? escHtml(cv.lastMessageText) : 'No messages yet';
      const ago = cv.lastMessageAt ? _timeAgo(cv.lastMessageAt) : '';
      return `
      <div class="item-card chat-inbox-row pressable" data-cid="${escHtml(cv.id)}" data-unprov="${cv._unprovisioned?'1':''}" data-dept="${escHtml(cv.department||'')}" style="display:flex;align-items:center;gap:10px;cursor:pointer">
        ${avatarHtml}
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-weight:${unread?'700':'500'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(title)}</span>
            ${unread ? '<span class="ms-unread-dot"></span>' : ''}
          </div>
          <div style="font-size:12px;font-weight:${unread?'700':'400'};color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);flex-shrink:0">${ago}</div>
      </div>`;
    }).join('') + '</div>';
    el.querySelectorAll('.chat-inbox-row').forEach(row => {
      row.addEventListener('click', () => {
        const cid = row.dataset.cid;
        if (row.dataset.unprov) { openDeptChannel(row.dataset.dept); return; }
        const cv = sorted.find(x => x.id === cid);
        openConversation(cid, cv);
      });
    });
    if (window.lucide) lucide.createIcons({ nodes: [el] });
  }

  // ── Open / create ──
  async function openDM(otherUid) {
    const id = dmIdFor(currentUser.uid, otherUid);
    const ref = db.collection('conversations').doc(id);
    const snap = await ref.get().catch(() => null);
    if (!snap || !snap.exists) {
      const o = await db.collection('users').doc(otherUid).get().catch(() => null);
      const otherName = o?.exists ? (o.data().displayName || o.data().email) : 'User';
      await ref.set({
        type: 'dm', participants: [currentUser.uid, otherUid].sort(),
        participantNames: { [currentUser.uid]: _myName(), [otherUid]: otherName },
        name: null, department: null,
        createdBy: currentUser.uid, createdByName: _myName(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastMessageAt: null, lastMessageText: null, lastMessageBy: null, lastMessageByName: null
      });
    }
    if (window.currentPage !== 'chat') navigateTo('chat');   // clears any open overlays first
    openConversation(id);
  }
  async function openDeptChannel(dept) {
    const id = 'dept_' + dept, ref = db.collection('conversations').doc(id);
    const snap = await ref.get().catch(() => null);
    if (!snap || !snap.exists) {
      await ref.set({ type: 'dept', department: dept, name: dept, participants: [],
        participantNames: {},
        createdBy: currentUser.uid, createdByName: _myName(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastMessageAt: null, lastMessageText: null, lastMessageBy: null, lastMessageByName: null
      }).catch(() => {});
    }
    openConversation(id);
  }

  // ── Thread panel (fork of task-fullscreen-panel, Spec 5) ──
  function _headerTitleAndAvatar(conv) {
    const initials = s => escHtml((s || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    let title, avatarHtml;
    if (conv.type === 'dm') {
      const otherUid = (conv.participants || []).find(u => u !== currentUser.uid);
      title = (conv.participantNames && conv.participantNames[otherUid]) || 'User';
      avatarHtml = `<div class="ms-avatar ms-avatar-md">${initials(title)}</div>`;
    } else if (conv.type === 'group') {
      title = conv.name || 'Group';
      avatarHtml = `<div class="ms-avatar ms-avatar-md">${initials(title)}</div>`;
    } else {
      const cfg = (window.DEPARTMENTS || {})[conv.department] || {};
      title = conv.name || conv.department || 'Channel';
      avatarHtml = `<div class="ms-avatar ms-avatar-md" style="background:${cfg.color || 'var(--primary)'}">${cfg.icon || `${emojiIcon('💬',16)}`}</div>`;
    }
    return { title, avatarHtml };
  }

  function _buildThreadPanel(conv) {
    document.getElementById('chat-thread-panel')?.remove();
    const { title, avatarHtml } = _headerTitleAndAvatar(conv);
    const memberCount = (conv.participants || []).length;
    const subtitleHtml = conv.type === 'dm'
      ? `<span id="chat-presence-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:transparent;margin-right:4px"></span><span id="chat-presence-label" style="font-size:11px;color:var(--text-muted)"></span>`
      : conv.type === 'group'
        ? `<span style="font-size:11px;color:var(--text-muted)">${memberCount} member${memberCount!==1?'s':''}</span>`
        : `<span style="font-size:11px;color:var(--text-muted)">Department channel</span>`;
    // Leave Group (Decision 14/Spec 2a: a participant may remove exactly
    // themself). No entry point was specified for this in Spec 4/5's given
    // markup, but Spec 8 test #10 exercises it and the rule exists for it —
    // a small, self-contained addition, not an architecture call.
    const leaveBtnHtml = conv.type === 'group'
      ? `<button id="chat-leave-group-btn" class="btn-secondary btn-sm" style="flex-shrink:0">Leave</button>` : '';
    // WS42 Phase 18 — ⋮ wallpaper menu (participants can already update the
    // conv doc for lastMessage*; if a rules edge case denies it, the write
    // below is wrapped in .catch() and localStorage carries the preference).
    const wallpaperMenuHtml = `
      <button id="chat-wallpaper-btn" class="ms-thread-menu-btn" title="Chat wallpaper" aria-haspopup="menu">${emojiIcon('more-vertical', 18)}</button>
      <div id="chat-wallpaper-menu" class="ms-wallpaper-menu hidden" role="menu">
        <div class="ms-wallpaper-menu-title">Chat wallpaper</div>
        ${WALLPAPERS.map(w => `<button type="button" class="ms-wallpaper-opt" data-wp="${w.key}" role="menuitem">
            <span class="ms-wallpaper-swatch wp-${w.key}"></span>${escHtml(w.label)}
          </button>`).join('')}
      </div>`;
    const p = document.createElement('div');
    p.id = 'chat-thread-panel';
    p.style.cssText = `
      position:fixed;
      top:calc(var(--topbar-h) + env(safe-area-inset-top,0px));
      left:0;right:0;bottom:0;
      background:var(--bg); z-index:4000;
      display:flex;flex-direction:column;
      transform:translateY(100%); opacity:0;
      transition:transform 0.32s cubic-bezier(.4,0,.2,1),opacity 0.32s;
      overflow:hidden;`;                       // verbatim task-panel shell (departments.js:729-740)
    p.innerHTML = `
      <div class="ms-thread-header">
        <button id="chat-panel-back" class="ms-thread-back" title="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        ${avatarHtml}
        <div class="ms-thread-info">
          <div class="ms-thread-title">${escHtml(title)}</div>
          <div class="ms-thread-subtitle">${subtitleHtml}</div>
        </div>
        ${leaveBtnHtml}
        ${wallpaperMenuHtml}
      </div>
      <div id="chat-thread-scroll" class="messenger-body" style="padding:12px 14px"></div>
      <div id="chat-typing-row"></div>
      <div id="chat-file-preview" style="font-size:11px;color:var(--primary);padding:0 14px 4px;min-height:16px"></div>
      <div class="messenger-input-row">
        <label for="chat-file" class="ms-attach-btn" title="Attach file">${emojiIcon('paperclip', 18)}</label>
        <input type="file" id="chat-file" style="display:none" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"/>
        <button type="button" class="ms-attach-btn" id="chat-link" title="Attach link">${emojiIcon('link',18)}</button>
        <textarea id="chat-input" class="ms-input" rows="1" placeholder="Type a message…"></textarea>
        <button class="ms-send-btn" id="chat-send" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>`;
    document.body.appendChild(p);
    if (window.lucide) lucide.createIcons({ nodes: [p] });
    requestAnimationFrame(() => { p.style.transform = 'translateY(0)'; p.style.opacity = '1'; });
    _applyWallpaper(conv);
    _enterFullscreenIfPhone();               // owner req #2: Messenger-style full-screen on phone
    window.Overlay.push('chat', () => window.Chat.teardownThread());   // ONE history entry
    document.getElementById('chat-panel-back')
      .addEventListener('click', () => window.Overlay.dismissTop());   // Back = history.back()
    document.getElementById('chat-leave-group-btn')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ message: 'Leave this group?', danger: true }))) return;
      await db.collection('conversations').doc(conv.id)
        .update({ participants: firebase.firestore.FieldValue.arrayRemove(currentUser.uid) })
        .catch(() => Notifs.showToast('Could not leave group', 'error'));
      window.Overlay.dismissTop();
    });

    // Wallpaper popover — toggle + outside-click-to-close (Phase 18).
    const wpBtn = document.getElementById('chat-wallpaper-btn');
    const wpMenu = document.getElementById('chat-wallpaper-menu');
    wpBtn?.addEventListener('click', e => {
      e.stopPropagation();
      if (!wpMenu) return;
      const willOpen = wpMenu.classList.contains('hidden');
      wpMenu.classList.toggle('hidden');
      _wpMenuOpen = willOpen;
      if (willOpen) document.addEventListener('click', _wpOutsideClick, true);
      else document.removeEventListener('click', _wpOutsideClick, true);
    });
    wpMenu?.querySelectorAll('.ms-wallpaper-opt').forEach(btn => {
      btn.addEventListener('click', () => { _setWallpaper(btn.dataset.wp); _closeWallpaperMenu(); });
    });

    // composer wiring: send → Chat.sendMessage({text, file, link}) then clear
    // input/file/preview (NO re-render call — the messages listener repaints)
    let pendingFile = null, pendingLink = null;
    const fileInp = document.getElementById('chat-file');
    const filePreview = document.getElementById('chat-file-preview');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const updateSendState = () => { sendBtn.disabled = !((input.value || '').trim() || pendingFile || pendingLink); };
    fileInp.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) pendingLink = null;   // a file replaces a pending link
      pendingFile = f || null;
      filePreview.textContent = f ? `📎 ${f.name}` : '';
      updateSendState();
    });
    document.getElementById('chat-link').addEventListener('click', async () => {
      let url = ((await promptDialog({ message: 'Paste a link to attach:' })) || '').trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      pendingLink = url; pendingFile = null;   // a link replaces a pending file
      fileInp.value = '';
      filePreview.textContent = `🔗 ${url}`;
      updateSendState();
    });
    // Phase 63 #1 — _isSending is a MODULE-scoped guard (not local to this
    // panel instance) checked at the very top of doSend, before anything
    // else runs. Both routes into doSend (the click handler and the Enter
    // keydown handler below) call this SAME function, so one guard covers
    // both — a double-Enter or an Enter-then-click during an in-flight send
    // is a no-op rather than a duplicate message.
    // Input/attachment state is only cleared on CONFIRMED success; on
    // failure it's left exactly as the user typed it (no silent data loss),
    // the button re-enables, and one error toast is shown here (the only
    // place — sendMessage's own catches now just throw, no toast).
    const doSend = async () => {
      if (_isSending) return;
      const text = (input.value || '').trim();
      const file = pendingFile, link = pendingLink;
      if (!text && !file && !link) return;
      _isSending = true;
      sendBtn.disabled = true;
      try {
        await window.Chat.sendMessage({ text, file, link });
        // ONLY clear on confirmed success.
        input.value = '';
        _autoGrow(input);
        fileInp.value = '';
        pendingFile = null; pendingLink = null;
        filePreview.textContent = '';
      } catch (e) {
        Notifs.error((e && e.message) || 'Message not sent — retry.');
      } finally {
        _isSending = false;
        updateSendState();               // re-enables Send whenever there's still text/attachment to retry
      }
    };
    input.addEventListener('input', () => { _autoGrow(input); updateSendState(); window.Chat.onComposerInput(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    sendBtn.addEventListener('click', doSend);

    // On-screen-keyboard handling (Phase 19): keep the composer + last message
    // visible without a layout jump when visualViewport resizes (keyboard open/close).
    if (window.visualViewport) window.visualViewport.addEventListener('resize', _onViewportResize, { passive: true });
  }

  // WS42 Phase 19 — auto-grow the composer textarea up to a 5-line cap (the
  // cap itself lives in CSS as `.ms-input { max-height }`; this just measures
  // scrollHeight so it grows/shrinks with content, transform/opacity untouched).
  function _autoGrow(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }
  // ── Full-screen thread on phone (owner req #2, Messenger-style) — ≤640px
  // hides the app topbar/top-nav-strip/bottom-nav via a body class; CSS does
  // the rest (see .chat-fullscreen rules in styles.css). Desktop (>640px)
  // is untouched — the class is simply never applied there.
  function _isPhoneWidth() { return window.innerWidth <= 640; }
  function _enterFullscreenIfPhone() {
    if (_isPhoneWidth()) document.body.classList.add('chat-fullscreen');
  }
  function _exitFullscreen() {
    document.body.classList.remove('chat-fullscreen');
  }
  function _onViewportResize() {
    const vv = window.visualViewport; if (!vv) return;
    const panel = document.getElementById('chat-thread-panel'); if (!panel) return;
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    panel.style.bottom = offset + 'px';
    const scroll = document.getElementById('chat-thread-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  // ── Wallpaper (Phase 18) — conv-doc field first, localStorage fallback;
  // write attempts the conv doc and falls back silently on any denial. ──
  function _wallpaperKeyFor(conv) {
    if (conv && conv.wallpaper) return conv.wallpaper;
    try { const v = localStorage.getItem('bi-chat-wp-' + conv.id); if (v) return v; } catch (_) {}
    return 'default';
  }
  function _applyWallpaper(conv) {
    const el = document.getElementById('chat-thread-scroll'); if (!el) return;
    WALLPAPERS.forEach(w => el.classList.remove('wp-' + w.key));
    el.classList.add('wp-' + _wallpaperKeyFor(conv));
  }
  async function _setWallpaper(key) {
    if (!_openConvId || !_openConv) return;
    _openConv.wallpaper = key;                 // optimistic local update
    _applyWallpaper(_openConv);
    try { localStorage.setItem('bi-chat-wp-' + _openConvId, key); } catch (_) {}
    await db.collection('conversations').doc(_openConvId).update({ wallpaper: key })
      .catch(() => { /* rules denial or offline — localStorage already holds the fallback */ });
  }
  function _wpOutsideClick(e) {
    const menu = document.getElementById('chat-wallpaper-menu');
    const btn = document.getElementById('chat-wallpaper-btn');
    if (menu && !menu.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) _closeWallpaperMenu();
  }
  function _closeWallpaperMenu() {
    document.getElementById('chat-wallpaper-menu')?.classList.add('hidden');
    document.removeEventListener('click', _wpOutsideClick, true);
    _wpMenuOpen = false;
  }

  async function openConversation(convId, preloaded) {
    let conv = preloaded || null;
    if (!conv) {
      const snap = await db.collection('conversations').doc(convId).get().catch(() => null);
      if (!snap || !snap.exists) { Notifs.showToast('Conversation not found', 'error'); return; }
      conv = { id: snap.id, ...snap.data() };
    }
    teardownThread();                       // defensive idempotent reset
    _openConvId = convId; _openConv = conv;
    _buildThreadPanel(conv);                // Spec 5 — Overlay.push('chat', teardownThread)
    _refreshUsersCache().then(() => _renderThread());   // backfills avatar photos once cached
    const ref = db.collection('conversations').doc(convId);
    _threadUnsubs.push(ref.collection('messages')
      .orderBy('createdAt', 'desc').limit(PAGE_SIZE)
      .onSnapshot(s => {
        _msgs = s.docs.map(d => ({ id: d.id, ...d.data(), _snap: d })).reverse();
        _renderThread(); _scheduleMarkRead();
      }, () => {}));
    _threadUnsubs.push(ref.collection('readers')
      .onSnapshot(s => { _readers = s.docs.map(d => d.data()); _renderThread(); }, () => {}));
    _threadUnsubs.push(ref.collection('typing')
      .onSnapshot(s => { _typing = s.docs.map(d => d.data()); _renderTypingRow(); }, () => {}));
    _markRead(); _clearChatNotifs(convId);
    if (conv.type === 'dm') _startPresenceHeader(conv);
    _typingExpireTimer = setInterval(_renderTypingRow, 2000);
  }

  // ── Read receipts (mirrors departments.js:1750-1756) ──
  function _markRead() {
    if (!_openConvId) return;
    db.collection('conversations').doc(_openConvId).collection('readers')
      .doc(currentUser.uid).set({ uid: currentUser.uid, name: _myName(),
        readAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
      .catch(() => {});
  }
  function _scheduleMarkRead() {            // debounce: at most one receipt per 2s of arrivals
    if (_markReadTimer) return;
    _markReadTimer = setTimeout(() => { _markReadTimer = null; _markRead(); }, 2000);
  }
  async function _clearChatNotifs(convId) { // mark (not delete) my pending chat notifs read
    try {
      const snap = await db.collection('notifications').doc(currentUser.uid)
        .collection('items').where('chatId', '==', convId).get();
      await Promise.all(snap.docs.filter(d => !d.data().read)
        .map(d => d.ref.update({ read: true })));
    } catch (_) {}
  }

  // ── Send (message add → parent preview bump → own receipt → notify) ──
  async function sendMessage({ text, file, link }) {
    const conv = _openConv; if (!conv) return;
    const FV = firebase.firestore.FieldValue;
    let fileUrl = null, fileName = null, fileSource = null;
    if (file) {
      try {
        const sref = storage.ref(`chat-files/${conv.id}/${Date.now()}_${file.name}`);
        await sref.put(file, { customMetadata: { uploadedBy: (window.currentUser && currentUser.uid) || '' } }); fileUrl = await sref.getDownloadURL(); fileName = file.name;
      } catch (_) {
        // Phase 63 #1: THROW instead of silently returning — a silent return
        // here used to let the caller (doSend) clear the input/attachment as
        // if the send had succeeded (silent data loss). All user-facing
        // messaging for a failed send happens once, in doSend's catch.
        throw new Error('File upload failed — message not sent.');
      }
    } else if (link) {
      fileUrl = link; fileSource = 'link';
      try { fileName = new URL(link).hostname.replace(/^www\./, ''); } catch (_) { fileName = link; }
    }
    await db.collection('conversations').doc(conv.id).collection('messages').add({
      text: text || '', authorId: currentUser.uid, authorName: _myName(),
      fileUrl: fileUrl || null, fileName: fileName || null, fileSource: fileSource || null,
      createdAt: FV.serverTimestamp()
    });
    const preview = text ? (text.length > 80 ? text.slice(0, 80) + '…' : text)
                         : (fileSource === 'link' ? `${emojiIcon('🔗',16)} Link` : `${emojiIcon('📎',16)} ${fileName || 'File'}`);
    // Second write — passes the affectedKeys([lastMessage*]) member branch.
    await db.collection('conversations').doc(conv.id).update({
      lastMessageAt: FV.serverTimestamp(), lastMessageText: preview,
      lastMessageBy: currentUser.uid, lastMessageByName: _myName()
    }).catch(() => {});
    _markRead(); _clearOwnTyping();
    _notifyRecipients(conv, preview);       // fire-and-forget
  }

  // Recipient resolution shared by _notifyRecipients (send) and _onDeleteMessage
  // (delete-the-notif, owner req #4) — same membership rule either way.
  async function _targetsFor(conv) {
    if (conv.type === 'dept') {
      const snap = await dbCachedGet('users', () => db.collection('users').get(), 60000);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.department === conv.department ||
                     (Array.isArray(u.departments) && u.departments.includes(conv.department)))
        .map(u => u.id);                    // actual members only — NOT implicit admins
    }
    return (conv.participants || []).slice();
  }

  // ── Message-arrived notifications (Decision 6 — NOT dedupKey) ──
  async function _notifyRecipients(conv, preview) {
    const targets = await _targetsFor(conv);
    const now = Date.now();
    const label = conv.type === 'dm' ? _myName() : (conv.name || conv.department || 'Chat');
    for (const uid of targets) {
      if (uid === currentUser.uid) continue;
      const r = _readers.find(x => x.uid === uid);        // live snapshot — zero extra reads
      if (r && r.readAt?.toMillis && (now - r.readAt.toMillis()) < READ_FRESH_MS) continue;
      const k = `${conv.id}_${uid}`;
      if (_notifLastSent[k] && (now - _notifLastSent[k]) < NOTIF_THROTTLE_MS) continue;
      _notifLastSent[k] = now;
      await Notifs.send(uid, { title: `💬 ${label}`, body: `${_myName()}: ${preview}`,
        icon: '💬', type: 'chat_message', chatId: conv.id }).catch(() => {});
    }
  }

  // ── Reactions (Decision 9) ──
  async function toggleReaction(messageId, emoji) {
    const m = _msgs.find(x => x.id === messageId) || _earlier.find(x => x.id === messageId);
    const mine = m && m.reactions && m.reactions[currentUser.uid];
    await db.collection('conversations').doc(_openConvId).collection('messages').doc(messageId)
      .update({ ['reactions.' + currentUser.uid]:
        (mine === emoji) ? firebase.firestore.FieldValue.delete() : emoji })
      .catch(() => Notifs.showToast('Could not react', 'error'));
  }

  // ── Typing (Decision 8) ──
  function onComposerInput() {
    const now = Date.now();
    if (!_openConvId || now - _lastTypingWrite < TYPING_WRITE_MS) return;
    _lastTypingWrite = now;
    db.collection('conversations').doc(_openConvId).collection('typing').doc(currentUser.uid)
      .set({ uid: currentUser.uid, name: _myName(),
             at: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
  }
  function _clearOwnTyping() {
    if (!_openConvId) return;
    _lastTypingWrite = 0;
    db.collection('conversations').doc(_openConvId).collection('typing')
      .doc(currentUser.uid).delete().catch(() => {});
  }
  // Phase 63 #4 — typing docs were previously only cleaned by an explicit
  // _clearOwnTyping() call (blur, send, panel-close). Killing the tab
  // (closing it, navigating away, backgrounding on mobile) skipped all of
  // those and left an orphaned "typing" doc that only stopped SHOWING once
  // TYPING_TTL_MS elapsed (display-filtered) but never got deleted. These are
  // best-effort, fire-and-forget (no await — the page may already be gone by
  // the time the delete would resolve); residual orphans that still slip
  // through are harmless (display-filtered forever, not read anywhere else).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _clearOwnTyping();
  });
  window.addEventListener('pagehide', () => { _clearOwnTyping(); });
  // WS42 Phase 19 — typing indicator restyled as an incoming mini-bubble with
  // 3 bouncing dots (CSS animation, reduced-motion aware — see msTypingBounce).
  function _renderTypingRow() {
    const el = document.getElementById('chat-typing-row'); if (!el) return;
    const now = Date.now();
    const names = _typing.filter(t => t.uid !== currentUser.uid
        && t.at?.toMillis && (now - t.at.toMillis()) < TYPING_TTL_MS)
      .map(t => escHtml((t.name || '').split(' ')[0]));
    el.innerHTML = names.length
      ? `<div class="ms-row ms-row-theirs ms-typing-row">
           <div class="ms-avatar-spacer"></div>
           <div class="ms-bubble ms-bubble-theirs ms-typing-bubble">
             <span class="ms-typing-dot"></span><span class="ms-typing-dot"></span><span class="ms-typing-dot"></span>
           </div>
         </div>
         <div class="ms-typing-names">${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…</div>`
      : '';
  }

  // ── Pagination — one-shot older page, prepended (static; not live) ──
  async function loadEarlier() {
    const anchor = (_earlier[0] || _msgs[0]); if (!anchor || !anchor._snap) return;
    const s = await db.collection('conversations').doc(_openConvId).collection('messages')
      .orderBy('createdAt', 'desc').startAfter(anchor._snap).limit(PAGE_SIZE).get()
      .catch(() => ({ docs: [] }));
    _earlier = [...s.docs.map(d => ({ id: d.id, ...d.data(), _snap: d })).reverse(), ..._earlier];
    // Phase 63 #3 — _earlier only ever grows via "Load earlier" taps; without
    // a cap a long scroll-back session holds every page ever fetched in
    // memory/DOM forever. Trim to the newest EARLIER_CAP once exceeded (drop
    // the oldest page) and show a small inline notice instead of the button
    // — reopening the thread starts the window fresh from the live tail.
    if (_earlier.length > EARLIER_CAP) {
      _earlier = _earlier.slice(_earlier.length - EARLIER_CAP);
      _earlierCapped = true;
    }
    _renderThread({ keepScrollAnchor: true });
  }

  // ── Presence (Decision 7 — reuses users-presence cache, NO listener) ──
  // Same bucket thresholds as renderTeam's local getPresence() (app.js) — not
  // exported globally there, so replicated here rather than adding a second
  // competing heartbeat.
  function _presenceBucket(lastSeen) {
    const ls = lastSeen?.toDate ? lastSeen.toDate() : null;
    if (!ls) return { dot: 'gray', label: 'Unknown' };
    const diff = Date.now() - ls.getTime();
    if (diff < 3 * 60 * 1000) return { dot: 'green', label: 'Online' };
    if (diff < 30 * 60 * 1000) return { dot: 'orange', label: `${Math.floor(diff/60000)}m ago` };
    const hrs = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000);
    return { dot: 'gray', label: days > 0 ? `${days}d ago` : `${hrs}h ago` };
  }
  function _startPresenceHeader(conv) {
    const otherUid = (conv.participants || []).find(u => u !== currentUser.uid);
    const paint = async () => {
      const el = document.getElementById('chat-presence-label'); if (!el || !otherUid) return;
      const dotEl = document.getElementById('chat-presence-dot');
      const snap = await dbCachedGet('users-presence', fetchUsersWithPayroll, 8000).catch(() => null);
      const u = snap && snap.docs.map(d => ({ id: d.id, ...d.data() })).find(x => x.id === otherUid);
      const pres = _presenceBucket(u && u.lastSeen);
      const color = { green: '#30D158', orange: '#FF9F0A', gray: '#8E8E93' }[pres.dot] || '#8E8E93';
      if (dotEl) dotEl.style.background = color;
      el.textContent = pres.label;
    };
    paint(); _presenceTimer = setInterval(paint, 30000);
  }

  // ── Manila-day dividers (bizDate discipline for calendar-day bucketing) ──
  function _manilaDay(ts) {
    const d = ts?.toDate ? ts.toDate() : null;
    return d ? d.toLocaleDateString('en-CA', { timeZone: window.BIZ_TZ }) : '';
  }
  function _dayLabel(iso) {
    const today = window.bizDate();
    if (iso === today) return 'Today';
    const y = new Date(today + 'T12:00:00'); y.setDate(y.getDate() - 1);
    const yIso = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
    if (iso === yIso) return 'Yesterday';
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-PH',
      { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Users cache (avatar/photoUrl resolution — Spec 1 note) ──
  async function _refreshUsersCache() {
    try {
      const snap = await dbCachedGet('users', () => db.collection('users').get(), 60000);
      const map = {};
      snap.docs.forEach(d => { map[d.id] = d.data(); });
      _usersByUid = map;
    } catch (_) { /* keep the previous snapshot on a transient failure */ }
  }
  function _authorInfo(uid, fallbackName) {
    const u = _usersByUid[uid] || {};
    return { name: u.displayName || fallbackName || 'User', photoUrl: u.photoUrl || null };
  }

  // ── Thread rendering — re-renders ONLY #chat-thread-scroll (composer lives
  // OUTSIDE it → input value survives every snapshot) ──
  // WS42 Phase 17: consecutive same-sender messages within GROUP_WINDOW_MS form
  // a "group" (own bubbles get right-side flat corners, incoming get left-side
  // flat corners + the avatar shown only once, bottom-aligned). A day change or
  // a >20min gap always breaks the group, even for the same sender.
  function _withinGroup(a, b) {
    if (!a || !b || a.authorId !== b.authorId) return false;
    const ta = a.createdAt?.toMillis?.(), tb = b.createdAt?.toMillis?.();
    if (!ta || !tb) return false;
    return Math.abs(tb - ta) < GROUP_WINDOW_MS;
  }
  // Phase 63 #2 — cheap content hash for a message, stored as data-rev on its
  // row. Covers exactly what can change on an EXISTING message id: reactions,
  // text edits, delete, and attachment swaps. createdAt/authorId never change
  // for an existing doc, so they're deliberately excluded (day/gap/grouping
  // are therefore stable for any row already in the DOM — see _patchThread).
  function _msgRev(m) {
    return JSON.stringify(m.reactions || {}) + '|' + (m.text || '') + '|' +
      (m.deleted ? 1 : 0) + '|' + (m.editedAt ? 1 : 0) + '|' + (m.fileUrl || '');
  }

  // Renders ONE message: { sep, row }. `sep` is any day-divider/time-gap
  // divider that belongs immediately before this message (context-derived
  // from list[idx-1]/list[idx+1] only — no running "lastDay" state needed,
  // since messages are strictly chronological, comparing a message's day to
  // its immediate predecessor's day is equivalent to a running tracker).
  // `row` is the single top-level `.ms-row[data-mid]` element's HTML — the
  // unit _patchThread() replaces in place when only ITS content changed.
  function _renderMessagePart(list, idx, isNew) {
    const m = list[idx];
    const initials = name => escHtml((name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    const isImage = url => url && /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(url);
    const day = _manilaDay(m.createdAt);
    const prevM = idx > 0 ? list[idx - 1] : null;
    const nextM = idx < list.length - 1 ? list[idx + 1] : null;
    const prevDay = prevM ? _manilaDay(prevM.createdAt) : null;
    const nextDay = nextM ? _manilaDay(nextM.createdAt) : null;
    const isNewDay = !!day && day !== prevDay;
    const gapMs = (!isNewDay && prevM && m.createdAt?.toMillis && prevM.createdAt?.toMillis)
      ? m.createdAt.toMillis() - prevM.createdAt.toMillis() : Infinity;

    let sep = '';
    if (isNewDay) {
      sep = `<div class="ms-day-sep"><span>${escHtml(_dayLabel(day))}</span></div>`;
    } else if (idx > 0 && gapMs > TIME_GAP_MS) {
      const d0 = m.createdAt?.toDate ? m.createdAt.toDate() : null;
      const gapLabel = d0 ? d0.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', timeZone: window.BIZ_TZ }) : '';
      sep = `<div class="ms-time-sep">${escHtml(gapLabel)}</div>`;
    }

    const brokenBefore = isNewDay || gapMs > TIME_GAP_MS || !_withinGroup(prevM, m);
    const brokenAfter = !nextM || (nextDay && nextDay !== day) || !_withinGroup(m, nextM);
    const grpClass = brokenBefore && brokenAfter ? 'ms-grp-single'
      : brokenBefore ? 'ms-grp-first' : brokenAfter ? 'ms-grp-last' : 'ms-grp-mid';
    const showAvatar = grpClass === 'ms-grp-last' || grpClass === 'ms-grp-single';
    const showName = grpClass === 'ms-grp-first' || grpClass === 'ms-grp-single';

    const isMine = m.authorId === currentUser.uid;
    const info = _authorInfo(m.authorId, m.authorName);
    const canEdit = isMine;
    const canDelete = isMine || _isAdminRole();
    const d = m.createdAt?.toDate ? m.createdAt.toDate() : null;
    const timeLabel = d ? d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', timeZone: window.BIZ_TZ }) : '';

    const reactions = m.reactions || {};
    const grouped = {};
    Object.entries(reactions).forEach(([uid, emoji]) => { (grouped[emoji] = grouped[emoji] || []).push(uid); });
    const reactionsHtml = Object.keys(grouped).length
      ? `<div class="chat-reactions-row" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">${
          Object.entries(grouped).map(([emoji, uids]) => {
            const mine = uids.includes(currentUser.uid);
            return `<button class="chat-reaction-chip" data-mid="${escHtml(m.id)}" data-emoji="${escHtml(emoji)}" style="font-size:12px;border-radius:12px;padding:1px 7px;border:1px solid ${mine?'var(--primary)':'var(--border)'};background:${mine?'var(--primary-soft)':'var(--surface-2)'};cursor:pointer">${emoji} ${uids.length}</button>`;
          }).join('')
        }</div>`
      : '';
    const pickerHtml = `<div class="chat-reaction-picker" data-mid="${escHtml(m.id)}" style="display:none;gap:4px;margin-top:4px">${
      REACTIONS.map(e => `<button class="chat-pick-emoji" data-mid="${escHtml(m.id)}" data-emoji="${e}" style="font-size:16px;background:none;border:none;cursor:pointer;padding:2px 4px">${e}</button>`).join('')
    }</div>`;
    // Owner req #3 (Viber-style): a quick heart button beside the bubble —
    // tap = instant ❤️ toggle (via the SAME toggleReaction data model), while
    // long-press on the bubble OR the heart opens the full 6-emoji picker
    // above. Affordance-only change — reactions storage is untouched.
    const heartedByMe = reactions[currentUser.uid] === '❤️';
    const heartHtml = `<button class="ms-heart-btn${heartedByMe?' ms-heart-active':''}" data-mid="${escHtml(m.id)}" title="React ❤️">${heartedByMe?'❤️':'🤍'}</button>`;

    const isLast = idx === list.length - 1;
    const seenBy = isLast ? _readers.filter(r => r.uid !== m.authorId && r.uid !== currentUser.uid
      && r.readAt?.toMillis && m.createdAt?.toMillis && r.readAt.toMillis() >= m.createdAt.toMillis()) : [];
    // Read receipts: reader avatars once the last message has been read;
    // otherwise (own last message, unread) a single Lucide "check" (sent) —
    // the avatar itself stands in for the "check-check/read" state once read.
    const seenHtml = seenBy.length
      ? `<div class="ms-seen" title="${escHtml(seenBy.map(r=>r.name).join(', '))}">${
          seenBy.slice(0,5).map(r => `<span class="ms-avatar">${initials(r.name)}</span>`).join('')
        }${seenBy.length>5?`<span style="font-size:10px;color:var(--text-muted)">+${seenBy.length-5}</span>`:''}</div>`
      : (isLast && isMine ? `<div class="ms-status"><i data-lucide="check"></i></div>` : '');

    const rev = _msgRev(m);
    const row = `
      <div class="ms-row ${isMine?'ms-row-mine':'ms-row-theirs'} ${grpClass}" data-mid="${escHtml(m.id)}" data-rev="${escHtml(rev)}">
        ${!isMine ? (showAvatar
            ? `<div class="ms-avatar" title="${escHtml(info.name)}">${info.photoUrl?`<img src="${escHtml(info.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:initials(info.name)}</div>`
            : `<div class="ms-avatar-spacer"></div>`) : ''}
        <div class="ms-bubble-wrap">
          ${!isMine && showName ? `<div class="ms-name">${escHtml(info.name)}</div>` : ''}
          <div class="ms-bubble-row">
          ${isMine ? heartHtml : ''}
          <div class="ms-bubble ${isMine?'ms-bubble-mine':'ms-bubble-theirs'} ${grpClass} chat-bubble-tap ${isNew?'ms-pop-in':''}" data-mid="${escHtml(m.id)}">
            ${m.text ? `<div class="ms-text">${escHtml(m.text).replace(/\n/g,'<br/>')}</div>` : ''}
            ${m.fileUrl ? (m.fileSource!=='link' && isImage(m.fileUrl)
              ? `<div style="margin-top:${m.text?'6':'0'}px"><img src="${safeHttpUrl(m.fileUrl)}" alt="${escHtml(m.fileName||'img')}" style="max-width:200px;max-height:160px;border-radius:var(--r-sm,10px);cursor:pointer" onclick="window.open('${safeHttpUrl(m.fileUrl)}','_blank')"/></div>`
              : `<a href="${safeHttpUrl(m.fileUrl)}" target="_blank" rel="noopener" class="ms-file-chip">${emojiIcon(m.fileSource==='link'?'link':'paperclip',14)}<span>${escHtml(m.fileName||'Attachment')}</span></a>`
            ) : ''}
            <div class="ms-meta">
              <span class="ms-time">${timeLabel}</span>
              ${m.editedAt?'<span class="ms-edited">(edited)</span>':''}
            </div>
          </div>
          ${!isMine ? heartHtml : ''}
          </div>
          ${reactionsHtml}
          ${pickerHtml}
          ${canEdit||canDelete ? `<div class="ms-actions">
            ${canEdit?`<button class="ms-act-btn chat-msg-edit-btn" data-mid="${escHtml(m.id)}">${emojiIcon('✎',16)}</button>`:''}
            ${canDelete?`<button class="ms-act-btn ms-del-btn chat-msg-del-btn" data-mid="${escHtml(m.id)}">${emojiIcon('trash-2',14)}</button>`:''}
          </div>` : ''}
          ${seenHtml}
        </div>
        ${''/* owner req #1: own messages never show the sender's own avatar (Messenger style) */}
      </div>`;
    return { sep, row };
  }

  function _threadHtml(list) {
    if (!list.length) {
      _lastMsgIds = new Set(); _lastRenderOrder = [];
      return '<div class="messenger-empty">No messages yet. Say hello!</div>';
    }
    const showEarlierBtn = !_earlierCapped && (_earlier.length + _msgs.length) >= PAGE_SIZE;
    const isFirstRender = _lastMsgIds === null;
    const prevIds = _lastMsgIds || new Set();

    let html = _earlierCapped
      ? `<div style="text-align:center;margin-bottom:10px;font-size:11px;color:var(--text-muted)">Older messages hidden — reopen this chat to reload from the start</div>`
      : showEarlierBtn
        ? `<div style="text-align:center;margin-bottom:10px"><button class="btn-secondary btn-sm" id="chat-load-earlier-btn">↑ Load earlier</button></div>`
        : '';
    list.forEach((m, idx) => {
      const isNew = !isFirstRender && !prevIds.has(m.id);
      const { sep, row } = _renderMessagePart(list, idx, isNew);
      html += sep + row;
    });
    _lastMsgIds = new Set(list.map(m => m.id));
    _lastRenderOrder = list.map(m => m.id);
    return html;
  }

  // Phase 63 #2 — patches the DOM in place instead of rebuilding it, so an
  // open reaction picker / a tapped-open timestamp elsewhere in the thread
  // survives. Only called when the id ORDER of the previous render is an
  // exact prefix of the new order (i.e. the only change is messages added at
  // the tail — new sends, or reactions/edits on already-rendered messages;
  // see the caller for when this does/doesn't apply).
  function _patchThread(el, list, oldOrder) {
    const prevIds = _lastMsgIds || new Set();
    // Revise rows within the shared prefix: rev mismatch (reaction/edit/
    // delete/attachment change) OR the last old row specifically — its
    // grpClass can flip (a newly-appended tail message may now group with
    // it) and its seen-receipts can change from a readers-only snapshot,
    // neither of which is captured by _msgRev.
    for (let i = 0; i < oldOrder.length; i++) {
      const m = list[i];
      const rev = _msgRev(m);
      const node = el.querySelector(`.ms-row[data-mid="${CSS.escape(m.id)}"]`);
      if (!node) continue;                     // shouldn't happen — falls back to being a no-op patch
      if (node.dataset.rev !== rev || i === oldOrder.length - 1) {
        const { row } = _renderMessagePart(list, i, false);
        node.outerHTML = row;
      }
    }
    // Append any new tail messages (with their leading day/gap separators).
    let appendHtml = '';
    for (let i = oldOrder.length; i < list.length; i++) {
      const isNew = !prevIds.has(list[i].id);
      const { sep, row } = _renderMessagePart(list, i, isNew);
      appendHtml += sep + row;
    }
    if (appendHtml) el.insertAdjacentHTML('beforeend', appendHtml);
    _lastRenderOrder = list.map(m => m.id);
    _lastMsgIds = new Set(_lastRenderOrder);
  }

  // Event delegation (Phase 63 #2) — bound ONCE per thread-panel DOM element
  // (guarded by el.dataset.wired) rather than re-querySelectorAll+addEventListener
  // on every render. This is what makes the patch path (above) work with zero
  // extra wiring: new/replaced nodes are covered automatically because the
  // listener lives on the stable parent, not on the rows themselves.
  function _openPickerFor(el, mid) {
    el.querySelectorAll('.chat-reaction-picker').forEach(p => { if (p.dataset.mid !== mid) p.style.display = 'none'; });
    const picker = el.querySelector(`.chat-reaction-picker[data-mid="${CSS.escape(mid)}"]`);
    if (picker) picker.style.display = 'flex';
  }
  // Owner req #3 — Viber-style: tap the heart = instant ❤️ toggle; LONG-PRESS
  // (500ms) on the bubble OR the heart opens the full 6-emoji picker instead.
  // touchstart/touchend timing covers mobile; mousedown/mouseup + contextmenu
  // (right-click / long-press-as-contextmenu on some browsers) covers desktop.
  const LONG_PRESS_MS = 500;
  function _wireThreadDelegation(el) {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    let pressTimer = null, longPressed = false, pressMid = null;
    const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    const startPress = (target, e) => {
      const holder = target.closest('.chat-bubble-tap, .ms-heart-btn');
      if (!holder) return;
      pressMid = holder.dataset.mid; longPressed = false;
      clearPress();
      pressTimer = setTimeout(() => {
        longPressed = true;
        _openPickerFor(el, pressMid);
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
      }, LONG_PRESS_MS);
    };
    el.addEventListener('touchstart', e => startPress(e.target, e), { passive: true });
    el.addEventListener('touchend', clearPress);
    el.addEventListener('touchcancel', clearPress);
    el.addEventListener('touchmove', clearPress);
    el.addEventListener('mousedown', e => { if (e.button === 0) startPress(e.target, e); });
    el.addEventListener('mouseup', clearPress);
    el.addEventListener('mouseleave', clearPress);
    el.addEventListener('contextmenu', e => {
      const holder = e.target.closest('.chat-bubble-tap, .ms-heart-btn');
      if (holder) { e.preventDefault(); _openPickerFor(el, holder.dataset.mid); }
    });
    el.addEventListener('click', e => {
      if (e.target.closest('#chat-load-earlier-btn')) { loadEarlier(); return; }
      const chip = e.target.closest('.chat-reaction-chip, .chat-pick-emoji');
      if (chip) { e.stopPropagation(); toggleReaction(chip.dataset.mid, chip.dataset.emoji); return; }
      const editBtn = e.target.closest('.chat-msg-edit-btn');
      if (editBtn) { e.stopPropagation(); _onEditMessage(editBtn.dataset.mid); return; }
      const delBtn = e.target.closest('.chat-msg-del-btn');
      if (delBtn) { e.stopPropagation(); _onDeleteMessage(delBtn.dataset.mid); return; }
      const heartBtn = e.target.closest('.ms-heart-btn');
      if (heartBtn) {
        e.stopPropagation();
        if (longPressed) { longPressed = false; return; }   // long-press already opened the picker — don't also toggle
        toggleReaction(heartBtn.dataset.mid, '❤️');
        return;
      }
      // Tapping a bubble toggles its timestamp/status line. A short tap no
      // longer opens the picker (that's now long-press-only, req #3) — but a
      // long-press that just fired should also suppress the tap-toggle.
      const bubble = e.target.closest('.chat-bubble-tap');
      if (bubble) {
        if (e.target.closest('a') || e.target.closest('img')) return;
        if (longPressed) { longPressed = false; return; }
        bubble.classList.toggle('ms-time-shown');
      }
    });
  }
  // Own message → promptDialog edit; own/admin → confirmDialog delete. NO
  // manual re-render calls here — the messages listener repaints (patched, per #2).
  async function _onEditMessage(mid) {
    const m = [..._earlier, ..._msgs].find(x => x.id === mid);
    const newText = await promptDialog({ message: 'Edit message:', value: m?.text || '', multiline: true });
    if (newText === null || newText === (m?.text || '')) return;
    await db.collection('conversations').doc(_openConvId).collection('messages').doc(mid)
      .update({ text: newText.trim(), editedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(() => Notifs.showToast('Edit failed', 'error'));
  }
  async function _onDeleteMessage(mid) {
    if (!(await confirmDialog({ message: 'Delete this message?', danger: true }))) return;
    const m = [..._earlier, ..._msgs].find(x => x.id === mid);
    const conv = _openConv, convId = _openConvId;
    const createdAtMs = m?.createdAt?.toMillis?.();
    await db.collection('conversations').doc(convId).collection('messages').doc(mid).delete()
      .then(async () => {
        // owner req #4 — the notification(s) this message generated for
        // recipients must be removed along with it. Best-effort/fire-and-forget:
        // never blocks the delete UX on notif cleanup.
        if (conv && createdAtMs) {
          const targets = await _targetsFor(conv);
          window.Notifs?.deleteForMessage(convId, createdAtMs, targets).catch(() => {});
        }
      })
      .catch(() => Notifs.showToast('Delete failed', 'error'));
  }

  function _renderThread(opts) {
    opts = opts || {};
    const el = document.getElementById('chat-thread-scroll');
    if (!el) return;
    _wireThreadDelegation(el);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    const prevScrollHeight = el.scrollHeight, prevScrollTop = el.scrollTop;
    const list = [..._earlier, ..._msgs];
    const newOrder = list.map(m => m.id);
    const oldOrder = _lastRenderOrder;
    // Patch path applies only when the previous render's id order is an
    // exact PREFIX of the new order — i.e. nothing was inserted/removed
    // anywhere except possibly new ids appended at the very end. loadEarlier
    // prepends at the HEAD (opts.keepScrollAnchor is always set for it), so
    // it's deliberately excluded here and always gets a full rebuild.
    const canPatch = !opts.keepScrollAnchor && Array.isArray(oldOrder) && oldOrder.length > 0 &&
      newOrder.length >= oldOrder.length && oldOrder.every((id, i) => newOrder[i] === id);

    if (canPatch) {
      _patchThread(el, list, oldOrder);
    } else {
      el.innerHTML = _threadHtml(list);
    }
    if (window.lucide) lucide.createIcons({ nodes: [el] });

    if (opts.keepScrollAnchor) {
      el.scrollTop = el.scrollHeight - prevScrollHeight + prevScrollTop;   // preserve visual anchor
    } else if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }

  return { openDM, openConversation, openDeptChannel, sendMessage, toggleReaction,
           loadEarlier, onComposerInput, teardownInbox, teardownThread,
           dmIdFor, myDeptChannels, dmCandidates, setFilter, setSearch, _attachInbox };
})();

// ── Inbox page (router target: case 'chat') ──
window.renderChatPage = async function() {
  const c = document.getElementById('page-content'); if (!c) return;
  // v12 WS42 Phase 15: .chat-page wrapper is CSS-only two-pane *scaffolding* for
  // >=1024px (a left inbox column + reserved right column) — Batch D wires the
  // thread panel into the right column; this batch only lays the container down.
  // A wrapper div (not a class on #page-content itself) so it never leaks onto
  // the next page's render — it's discarded with the rest of this innerHTML.
  c.innerHTML = `
    <div class="chat-page">
      <div class="chat-page-inbox">
        <div class="page-header"><h2>${emojiIcon('💬',20)} Chat</h2>
          <button class="btn-primary btn-sm" id="chat-new-btn">+ New Message</button></div>
        <div class="ms-search-wrap"><input id="chat-search-input" class="ms-search-input" placeholder="Search chats" /></div>
        <div id="chat-filter"></div>
        <div id="chat-inbox"><div class="loading-placeholder">Loading…</div></div>
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  const chips = [{ key: 'all', label: 'All' }, { key: 'dm', label: 'DMs' },
                 { key: 'group', label: 'Groups' }];
  if (window.Chat.myDeptChannels().length) chips.push({ key: 'dept', label: 'Channels' });
  document.getElementById('chat-filter').innerHTML = window.chipTabs(chips, 'all');
  window.bindChipTabs(document.getElementById('chat-filter'),
    k => window.Chat?.setFilter(k));
  document.getElementById('chat-search-input')?.addEventListener('input', e => window.Chat?.setSearch(e.target.value));
  document.getElementById('chat-new-btn').addEventListener('click', async () => {
    const snap = await dbCachedGet('users', () => db.collection('users').get(), 60000)
      .catch(() => ({ docs: [] }));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const candidates = window.Chat.dmCandidates(users);
    const isPtnr = typeof isPartner === 'function' && isPartner();

    const rowHtml = u => {
      const initials = (u.displayName || u.email || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
      const roleLabel = window.ROLES?.[u.role]?.label || u.role || '';
      return `<div class="item-card chat-pick-user" data-uid="${escHtml(u.id)}" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px">
        <div class="ms-avatar ms-avatar-md">${u.photoUrl?`<img src="${escHtml(u.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:escHtml(initials)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${escHtml(u.displayName||u.email)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${escHtml(roleLabel)}</div>
        </div>
      </div>`;
    };

    const body = `
      <input id="chat-pick-search" class="ms-input" placeholder="Search people…" style="width:100%;margin-bottom:10px"/>
      <div id="chat-pick-list" class="item-list">${candidates.map(rowHtml).join('') || '<div class="empty-state" style="padding:16px"><p>No one to message yet.</p></div>'}</div>
      ${!isPtnr ? `
      <div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
        <div style="font-weight:700;margin-bottom:8px">${emojiIcon('👥',16)} New Group</div>
        <input id="chat-group-name" class="ms-input" placeholder="Group name" style="width:100%;margin-bottom:8px"/>
        <div id="chat-group-members" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
          ${candidates.map(u => `<label style="display:flex;align-items:center;gap:8px;padding:4px 2px;cursor:pointer">
            <input type="checkbox" class="chat-group-member-cb" value="${escHtml(u.id)}"/>
            <span>${escHtml(u.displayName||u.email)}</span>
          </label>`).join('')}
        </div>
        <button class="btn-primary btn-sm" id="chat-group-create-btn" style="margin-top:10px">Create Group</button>
        <div id="chat-group-err" class="error-msg hidden" style="margin-top:6px"></div>
      </div>` : ''}
    `;
    window.openPage('New Message', body);

    const wireRows = () => {
      document.getElementById('chat-pick-list')?.querySelectorAll('.chat-pick-user').forEach(row => {
        row.addEventListener('click', () => {
          const uid = row.dataset.uid;
          window.Overlay.dismissTop();
          window.Chat.openDM(uid);
        });
      });
    };
    wireRows();

    document.getElementById('chat-pick-search')?.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = candidates.filter(u =>
        (u.displayName||u.email||'').toLowerCase().includes(q) || (u.role||'').toLowerCase().includes(q));
      const listEl = document.getElementById('chat-pick-list');
      if (listEl) listEl.innerHTML = filtered.map(rowHtml).join('') || '<div class="empty-state" style="padding:16px"><p>No matches.</p></div>';
      wireRows();
    });

    document.getElementById('chat-group-create-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('chat-group-create-btn');
      const name = document.getElementById('chat-group-name')?.value.trim();
      const err = document.getElementById('chat-group-err');
      const picked = Array.from(document.querySelectorAll('.chat-group-member-cb:checked')).map(cb => cb.value);
      if (!name) { if (err) { err.textContent = 'Group name is required.'; err.classList.remove('hidden'); } return; }
      if (!picked.length) { if (err) { err.textContent = 'Pick at least one member.'; err.classList.remove('hidden'); } return; }
      const myUid = currentUser.uid;
      const myDisplayName = window.userProfile?.displayName || currentUser.email;
      const participants = Array.from(new Set([...picked, myUid])).sort();
      const participantNames = {};
      participants.forEach(uid => {
        if (uid === myUid) { participantNames[uid] = myDisplayName; return; }
        const u = candidates.find(x => x.id === uid);
        participantNames[uid] = u?.displayName || u?.email || 'User';
      });
      if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
      try {
        const ref = await db.collection('conversations').add({
          type: 'group', participants, participantNames, name,
          department: null, createdBy: myUid, createdByName: myDisplayName,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastMessageAt: null, lastMessageText: null, lastMessageBy: null, lastMessageByName: null
        });
        window.Overlay.dismissTop();
        window.Chat.openConversation(ref.id);
      } catch (_) {
        if (err) { err.textContent = 'Could not create group.'; err.classList.remove('hidden'); }
        if (btn) { btn.disabled = false; btn.textContent = 'Create Group'; }
      }
    });
  });
  window.Chat._attachInbox();
};
