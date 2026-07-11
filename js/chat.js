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

  // ── Listener state — the ONLY live listeners this feature owns ──
  let _inboxUnsub = null;                    // (1) conversations array-contains
  let _threadUnsubs = [];                    // (2-4) messages/readers/typing for the ONE open thread
  let _openConvId = null, _openConv = null;
  let _convs = [], _deptConvs = [], _myReads = {};   // inbox state
  let _msgs = [], _earlier = [], _readers = [], _typing = [];  // thread state
  let _presenceTimer = null, _typingExpireTimer = null, _markReadTimer = null;
  let _lastTypingWrite = 0, _filter = 'all';
  let _presenceByUid = {}, _usersByUid = {};  // small local caches (NOT extra listeners)
  const _notifLastSent = {};                 // `${convId}_${uid}` → ms epoch

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
  }
  function teardownThread() {                // Overlay teardown callback — NEVER calls dismissTop
    if (_openConvId) _clearOwnTyping();      // Decision 8: beacon cleared on panel-close too
    _threadUnsubs.forEach(u => { try { u(); } catch(_){} });
    _threadUnsubs = []; _openConvId = null; _openConv = null;
    _msgs = []; _earlier = []; _readers = []; _typing = [];
    if (_presenceTimer)     { clearInterval(_presenceTimer);     _presenceTimer = null; }
    if (_typingExpireTimer) { clearInterval(_typingExpireTimer); _typingExpireTimer = null; }
    if (_markReadTimer)     { clearTimeout(_markReadTimer);      _markReadTimer = null; }
    const p = document.getElementById('chat-thread-panel');
    if (p) { p.style.transform = 'translateY(100%)'; p.style.opacity = '0';
             setTimeout(() => p.remove(), 320); }          // mirrors closeTaskPanel
  }

  // ── Inbox ──
  function _attachInbox() {
    teardownInbox();
    _inboxUnsub = db.collection('conversations')
      .where('participants', 'array-contains', currentUser.uid)
      .onSnapshot(async snap => {
        _convs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        await _refreshDeptChannels();        // deterministic-ID direct gets
        await _refreshMyReads();             // one own-reader-doc get per conversation
        await _refreshPresence();            // DM row presence dots (users-presence cache)
        _renderInbox();
      }, () => { const el = document.getElementById('chat-inbox');
                 if (el) el.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><h4>Chat unavailable</h4></div>'; });
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
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><h4>No conversations yet</h4><p>Tap "+ New Message" to start one.</p></div>`;
      return;
    }
    const myUid = currentUser.uid;
    const initials = s => escHtml((s || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    el.innerHTML = '<div class="item-list">' + sorted.map(cv => {
      const unread = _isUnread(cv);
      let title, avatarHtml;
      if (cv.type === 'dm') {
        const otherUid = (cv.participants || []).find(u => u !== myUid);
        title = (cv.participantNames && cv.participantNames[otherUid]) || 'User';
        const pres = _presenceBucket(_presenceByUid[otherUid]?.lastSeen);
        const dotColor = { green: '#30D158', orange: '#FF9F0A', gray: '#8E8E93' }[pres.dot] || '#8E8E93';
        avatarHtml = `<div class="ms-avatar" style="position:relative;flex-shrink:0">${initials(title)}<span style="position:absolute;bottom:-1px;right:-1px;width:9px;height:9px;border-radius:50%;background:${dotColor};border:1.5px solid var(--surface)"></span></div>`;
      } else if (cv.type === 'group') {
        title = cv.name || 'Group';
        avatarHtml = `<div class="ms-avatar" style="flex-shrink:0">${initials(title)}</div>`;
      } else {
        const cfg = (window.DEPARTMENTS || {})[cv.department] || {};
        title = cv.name || cv.department || 'Channel';
        avatarHtml = `<div class="ms-avatar" style="flex-shrink:0;background:${cfg.color || 'var(--primary-light)'}">${cfg.icon || '💬'}</div>`;
      }
      const preview = cv.lastMessageText ? escHtml(cv.lastMessageText) : 'No messages yet';
      const ago = cv.lastMessageAt ? _timeAgo(cv.lastMessageAt) : '';
      return `
      <div class="item-card chat-inbox-row" data-cid="${escHtml(cv.id)}" data-unprov="${cv._unprovisioned?'1':''}" data-dept="${escHtml(cv.department||'')}" style="display:flex;align-items:center;gap:10px;cursor:pointer">
        ${avatarHtml}
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-weight:${unread?'700':'500'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(title)}</span>
            ${unread ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--primary-light);flex-shrink:0"></span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</div>
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
      avatarHtml = `<div class="ms-avatar">${initials(title)}</div>`;
    } else if (conv.type === 'group') {
      title = conv.name || 'Group';
      avatarHtml = `<div class="ms-avatar">${initials(title)}</div>`;
    } else {
      const cfg = (window.DEPARTMENTS || {})[conv.department] || {};
      title = conv.name || conv.department || 'Channel';
      avatarHtml = `<div class="ms-avatar" style="background:${cfg.color || 'var(--primary-light)'}">${cfg.icon || '💬'}</div>`;
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
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0">
        <button id="chat-panel-back" style="background:none;border:none;color:var(--primary-light);font-size:22px;cursor:pointer;padding:0 4px;line-height:1">‹</button>
        ${avatarHtml}
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(title)}</div>
          <div>${subtitleHtml}</div>
        </div>
        ${leaveBtnHtml}
      </div>
      <div id="chat-thread-scroll" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 14px"></div>
      <div id="chat-typing-row" style="min-height:16px;font-size:11px;color:var(--text-muted);padding:0 14px"></div>
      <div id="chat-file-preview" style="font-size:11px;color:var(--primary-light);padding:0 14px 4px;min-height:16px"></div>
      <div class="messenger-input-row">
        <label for="chat-file" class="ms-attach-btn" title="Attach file">📎</label>
        <input type="file" id="chat-file" style="display:none" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"/>
        <button type="button" class="ms-attach-btn" id="chat-link" title="Attach link">${emojiIcon('link',14)}</button>
        <input id="chat-input" class="ms-input" placeholder="Type a message…"/>
        <button class="ms-send-btn" id="chat-send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>`;
    document.body.appendChild(p);
    if (window.lucide) lucide.createIcons({ nodes: [p] });
    requestAnimationFrame(() => { p.style.transform = 'translateY(0)'; p.style.opacity = '1'; });
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

    // composer wiring: send → Chat.sendMessage({text, file, link}) then clear
    // input/file/preview (NO re-render call — the messages listener repaints)
    let pendingFile = null, pendingLink = null;
    const fileInp = document.getElementById('chat-file');
    const filePreview = document.getElementById('chat-file-preview');
    fileInp.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) pendingLink = null;   // a file replaces a pending link
      pendingFile = f || null;
      filePreview.textContent = f ? `📎 ${f.name}` : '';
    });
    document.getElementById('chat-link').addEventListener('click', async () => {
      let url = ((await promptDialog({ message: 'Paste a link to attach:' })) || '').trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      pendingLink = url; pendingFile = null;   // a link replaces a pending file
      fileInp.value = '';
      filePreview.textContent = `🔗 ${url}`;
    });
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const doSend = async () => {
      const text = (input.value || '').trim();
      const file = pendingFile, link = pendingLink;
      if (!text && !file && !link) return;
      sendBtn.disabled = true; sendBtn.style.opacity = '.5';
      await window.Chat.sendMessage({ text, file, link });
      input.value = '';
      fileInp.value = '';
      pendingFile = null; pendingLink = null;
      filePreview.textContent = '';
      sendBtn.disabled = false; sendBtn.style.opacity = '1';
    };
    input.addEventListener('input', () => window.Chat.onComposerInput());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    sendBtn.addEventListener('click', doSend);
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
        await sref.put(file); fileUrl = await sref.getDownloadURL(); fileName = file.name;
      } catch (_) { Notifs.showToast('File upload failed', 'error'); return; }
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
                         : (fileSource === 'link' ? '🔗 Link' : `📎 ${fileName || 'File'}`);
    // Second write — passes the affectedKeys([lastMessage*]) member branch.
    await db.collection('conversations').doc(conv.id).update({
      lastMessageAt: FV.serverTimestamp(), lastMessageText: preview,
      lastMessageBy: currentUser.uid, lastMessageByName: _myName()
    }).catch(() => {});
    _markRead(); _clearOwnTyping();
    _notifyRecipients(conv, preview);       // fire-and-forget
  }

  // ── Message-arrived notifications (Decision 6 — NOT dedupKey) ──
  async function _notifyRecipients(conv, preview) {
    let targets;
    if (conv.type === 'dept') {
      const snap = await dbCachedGet('users', () => db.collection('users').get(), 60000);
      targets = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.department === conv.department ||
                     (Array.isArray(u.departments) && u.departments.includes(conv.department)))
        .map(u => u.id);                    // actual members only — NOT implicit admins
    } else {
      targets = (conv.participants || []).slice();
    }
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
  function _renderTypingRow() {
    const el = document.getElementById('chat-typing-row'); if (!el) return;
    const now = Date.now();
    const names = _typing.filter(t => t.uid !== currentUser.uid
        && t.at?.toMillis && (now - t.at.toMillis()) < TYPING_TTL_MS)
      .map(t => escHtml((t.name || '').split(' ')[0]));
    el.innerHTML = names.length
      ? `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…` : '';
  }

  // ── Pagination — one-shot older page, prepended (static; not live) ──
  async function loadEarlier() {
    const anchor = (_earlier[0] || _msgs[0]); if (!anchor || !anchor._snap) return;
    const s = await db.collection('conversations').doc(_openConvId).collection('messages')
      .orderBy('createdAt', 'desc').startAfter(anchor._snap).limit(PAGE_SIZE).get()
      .catch(() => ({ docs: [] }));
    _earlier = [...s.docs.map(d => ({ id: d.id, ...d.data(), _snap: d })).reverse(), ..._earlier];
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
  function _threadHtml(list) {
    if (!list.length) return '<div class="messenger-empty">No messages yet. Say hello!</div>';
    const showEarlierBtn = (_earlier.length + _msgs.length) >= PAGE_SIZE;
    const initials = name => escHtml((name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    const isImage = url => url && /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(url);

    let html = showEarlierBtn
      ? `<div style="text-align:center;margin-bottom:10px"><button class="btn-secondary btn-sm" id="chat-load-earlier-btn">↑ Load earlier</button></div>`
      : '';
    let lastDay = null;
    list.forEach((m, idx) => {
      const day = _manilaDay(m.createdAt);
      if (day && day !== lastDay) {
        html += `<div style="text-align:center;margin:14px 0 8px"><span style="font-size:11px;font-weight:700;color:var(--text-muted);background:var(--surface2);padding:3px 12px;border-radius:20px">${escHtml(_dayLabel(day))}</span></div>`;
        lastDay = day;
      }
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
              return `<button class="chat-reaction-chip" data-mid="${escHtml(m.id)}" data-emoji="${escHtml(emoji)}" style="font-size:12px;border-radius:12px;padding:1px 7px;border:1px solid ${mine?'var(--primary-light)':'var(--border)'};background:${mine?'rgba(10,132,255,0.12)':'var(--surface2)'};cursor:pointer">${emoji} ${uids.length}</button>`;
            }).join('')
          }</div>`
        : '';
      const pickerHtml = `<div class="chat-reaction-picker" data-mid="${escHtml(m.id)}" style="display:none;gap:4px;margin-top:4px">${
        REACTIONS.map(e => `<button class="chat-pick-emoji" data-mid="${escHtml(m.id)}" data-emoji="${e}" style="font-size:16px;background:none;border:none;cursor:pointer;padding:2px 4px">${e}</button>`).join('')
      }</div>`;

      const isLast = idx === list.length - 1;
      const seenBy = isLast ? _readers.filter(r => r.uid !== m.authorId && r.uid !== currentUser.uid
        && r.readAt?.toMillis && m.createdAt?.toMillis && r.readAt.toMillis() >= m.createdAt.toMillis()) : [];
      const seenHtml = seenBy.length
        ? `<div class="ms-seen" style="display:flex;align-items:center;gap:3px" title="${escHtml(seenBy.map(r=>r.name).join(', '))}">${
            seenBy.slice(0,5).map(r => `<span class="ms-avatar" style="width:16px;height:16px;font-size:8px">${initials(r.name)}</span>`).join('')
          }${seenBy.length>5?`<span style="font-size:10px;color:var(--text-muted)">+${seenBy.length-5}</span>`:''}</div>`
        : '';

      html += `
      <div class="ms-row ${isMine?'ms-row-mine':'ms-row-theirs'}" data-mid="${escHtml(m.id)}">
        ${!isMine ? `<div class="ms-avatar" title="${escHtml(info.name)}">${info.photoUrl?`<img src="${escHtml(info.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:initials(info.name)}</div>` : ''}
        <div class="ms-bubble-wrap">
          ${!isMine ? `<div class="ms-name">${escHtml(info.name)}</div>` : ''}
          <div class="ms-bubble ${isMine?'ms-bubble-mine':'ms-bubble-theirs'} chat-bubble-tap" data-mid="${escHtml(m.id)}">
            ${m.text ? `<div class="ms-text">${escHtml(m.text).replace(/\n/g,'<br/>')}</div>` : ''}
            ${m.fileUrl ? (m.fileSource!=='link' && isImage(m.fileUrl)
              ? `<div style="margin-top:${m.text?'6':'0'}px"><img src="${safeHttpUrl(m.fileUrl)}" alt="${escHtml(m.fileName||'img')}" style="max-width:200px;max-height:160px;border-radius:8px;cursor:pointer" onclick="window.open('${safeHttpUrl(m.fileUrl)}','_blank')"/></div>`
              : `<a href="${safeHttpUrl(m.fileUrl)}" target="_blank" rel="noopener" class="ms-file-chip">${m.fileSource==='link'?'🔗':'📎'} ${escHtml(m.fileName||'Attachment')}</a>`
            ) : ''}
            <div class="ms-meta">
              <span class="ms-time">${timeLabel}</span>
              ${m.editedAt?'<span class="ms-edited">(edited)</span>':''}
            </div>
          </div>
          ${reactionsHtml}
          ${pickerHtml}
          ${canEdit||canDelete ? `<div class="ms-actions">
            ${canEdit?`<button class="ms-act-btn chat-msg-edit-btn" data-mid="${escHtml(m.id)}">✎</button>`:''}
            ${canDelete?`<button class="ms-act-btn ms-del-btn chat-msg-del-btn" data-mid="${escHtml(m.id)}">${emojiIcon('trash-2',14)}</button>`:''}
          </div>` : ''}
          ${seenHtml}
        </div>
        ${isMine ? `<div class="ms-avatar ms-avatar-mine" title="You">${userProfile?.photoUrl?`<img src="${escHtml(userProfile.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:initials(userProfile?.displayName||currentUser.email)}</div>` : ''}
      </div>`;
    });
    return html;
  }

  function _renderThread(opts) {
    opts = opts || {};
    const el = document.getElementById('chat-thread-scroll');
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    const prevScrollHeight = el.scrollHeight, prevScrollTop = el.scrollTop;
    el.innerHTML = _threadHtml([..._earlier, ..._msgs]);
    if (window.lucide) lucide.createIcons({ nodes: [el] });

    document.getElementById('chat-load-earlier-btn')?.addEventListener('click', loadEarlier);

    // Tapping a bubble toggles its 6-emoji reaction picker row.
    el.querySelectorAll('.chat-bubble-tap').forEach(b => {
      b.addEventListener('click', e => {
        if (e.target.closest('a') || e.target.closest('img')) return;
        const mid = b.dataset.mid;
        const picker = Array.from(el.querySelectorAll('.chat-reaction-picker')).find(x => x.dataset.mid === mid);
        if (picker) picker.style.display = (picker.style.display === 'flex') ? 'none' : 'flex';
      });
    });
    // Existing reaction chips + picker emoji both call toggleReaction (tap-again clears/changes).
    el.querySelectorAll('.chat-reaction-chip, .chat-pick-emoji').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); toggleReaction(b.dataset.mid, b.dataset.emoji); });
    });
    // Own message → promptDialog edit / confirmDialog delete; admin → delete.
    // NO manual re-render calls here — the messages listener repaints.
    el.querySelectorAll('.chat-msg-edit-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const mid = btn.dataset.mid;
        const m = [..._earlier, ..._msgs].find(x => x.id === mid);
        const newText = await promptDialog({ message: 'Edit message:', value: m?.text || '', multiline: true });
        if (newText === null || newText === (m?.text || '')) return;
        await db.collection('conversations').doc(_openConvId).collection('messages').doc(mid)
          .update({ text: newText.trim(), editedAt: firebase.firestore.FieldValue.serverTimestamp() })
          .catch(() => Notifs.showToast('Edit failed', 'error'));
      });
    });
    el.querySelectorAll('.chat-msg-del-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!(await confirmDialog({ message: 'Delete this message?', danger: true }))) return;
        await db.collection('conversations').doc(_openConvId).collection('messages').doc(btn.dataset.mid).delete()
          .catch(() => Notifs.showToast('Delete failed', 'error'));
      });
    });

    if (opts.keepScrollAnchor) {
      el.scrollTop = el.scrollHeight - prevScrollHeight + prevScrollTop;   // preserve visual anchor
    } else if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }

  return { openDM, openConversation, openDeptChannel, sendMessage, toggleReaction,
           loadEarlier, onComposerInput, teardownInbox, teardownThread,
           dmIdFor, myDeptChannels, dmCandidates, setFilter, _attachInbox };
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
        <div class="page-header"><h2>💬 Chat</h2>
          <button class="btn-primary btn-sm" id="chat-new-btn">+ New Message</button></div>
        <div id="chat-filter"></div>
        <div id="chat-inbox"><div class="loading-placeholder">Loading…</div></div>
      </div>
    </div>`;
  const chips = [{ key: 'all', label: 'All' }, { key: 'dm', label: 'DMs' },
                 { key: 'group', label: 'Groups' }];
  if (window.Chat.myDeptChannels().length) chips.push({ key: 'dept', label: 'Channels' });
  document.getElementById('chat-filter').innerHTML = window.chipTabs(chips, 'all');
  window.bindChipTabs(document.getElementById('chat-filter'),
    k => window.Chat?.setFilter(k));
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
        <div class="ms-avatar">${u.photoUrl?`<img src="${escHtml(u.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:escHtml(initials)}</div>
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
        <div style="font-weight:700;margin-bottom:8px">👥 New Group</div>
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
