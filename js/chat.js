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
  const TYPING_WRITE_MS   = 1500;    // Wave5 M4 (J9): tightened from 4000 — min gap between own typing beacons
  const TYPING_TTL_MS     = 6000;    // beacon age still shown as "typing…"
  const READ_FRESH_MS     = 45000;   // recipient read this recently → skip notif
  const NOTIF_THROTTLE_MS = 60000;   // per (conversation, recipient) notif spacing
  // v14 chat re-audit fix — non-image chat attachments (pdf/doc/xls/zip/etc,
  // see the #chat-file accept list) had NO client-side size guard; they
  // uploaded straight to Storage and only failed once the write hit
  // storage.rules' isValidDocument() cap (25MB — storage.rules ~line 67).
  // Mirrors that cap exactly: a file that WOULD upload is never blocked
  // client-side, and one that WOULDN'T never starts (immediate toast instead
  // of a slow-connection wait followed by a generic failure).
  const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;
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
  let _threadPanelEl = null;                 // v14 Phase2b — the openPage-returned panel element
                                              // (visualViewport handler targets THIS, not an id lookup)
  let _convs = [], _deptConvs = [], _myReads = {};   // inbox state
  let _msgs = [], _earlier = [], _readers = [], _typing = [];  // thread state
  let _presenceTimer = null, _typingExpireTimer = null, _markReadTimer = null;
  let _lastTypingWrite = 0, _filter = 'all', _searchQ = '';
  let _presenceByUid = {}, _usersByUid = {};  // small local caches (NOT extra listeners)
  // Wave1 P2 fix #16 — debounced idle-stop for the OWN typing beacon: reset on
  // every keystroke (see onComposerInput), fires _clearOwnTyping if the user
  // simply stops typing without sending/blurring/closing the panel.
  let _typingIdleTimer = null;
  // Wave1 P0 fix #3 — login-scoped (NOT page-scoped) conversations listener
  // that keeps the chat nav/OS badge correct regardless of which page is
  // currently open. Attached/detached by notifications.js's own
  // startListener/stopListener (see _attachGlobalBadgeListener below) —
  // js/chat.js has no auth-state hook of its own (that's app.js, out of
  // scope for this batch).
  let _globalBadgeUnsub = null, _globalBadgeConvs = [];
  // Wave1 P1 fix #7 — set once the FIRST messages snapshot for a thread-open
  // has painted; gates the one-time _markRead()/_clearChatNotifs() so merely
  // calling openConversation() and backing out before anything renders no
  // longer marks the thread read (see openConversation/the messages listener).
  let _initialMarkReadPending = false;
  const _notifLastSent = {};                 // `${convId}_${uid}` → ms epoch
  // v14 chat re-audit fix — clientKeys explicitly canceled out of a stuck
  // 'sending' pending bubble (see _cancelPendingMessage). The real send may
  // still be in flight in the background (no true network-abort — the
  // storage.ref().put() UploadTask isn't kept around for that); this set
  // just tells doSend's / _retryPending's catch blocks "don't resurrect the
  // composer text or toast an error, the user already dismissed this one."
  const _canceledClientKeys = new Set();
  // v14 chat re-audit fix — conv ids for which a one-time legacy readers-doc
  // fetch has already been kicked off by _myReadAtMs's migration fallback
  // (below), so a burst of inbox re-renders doesn't refire it per row.
  const _legacyReadFetching = new Set();
  let _lastMsgIds = null;                    // WS42 Phase 19: which bubble ids already animated in (send pop-in)
  let _lastRenderOrder = null;               // Phase 63 #2: message-id order of the last DOM render (keyed-diff)
  let _earlierCapped = false;                // Phase 63 #3: true once _earlier has been trimmed to the cap
  let _earlierExhausted = false;             // v14 chat fix — true once loadEarlier() gets back a short/empty
                                              // page (no older history left); lets the lightbox tell "nothing
                                              // more to load" apart from "just haven't tried loading it yet"
  let _isSending = false;                    // Phase 63 #1: shared guard — click AND Enter both route through doSend
  // Phase 63 #5: inbox refresh cascade debounce (leading-immediate, 2s trailing coalesce)
  let _inboxDebTimer = null, _inboxDebPendingSnap = null, _inboxWindowStart = 0;
  const EARLIER_CAP = 300;                   // Phase 63 #3
  // Wave5 Batch M1 — optimistic send / drafts / unread-divider / scroll-FAB state.
  let _pending = [];                         // optimistic bubbles, keyed by clientKey — UI-only, never persisted
  let _threadOpenReadAtMs = 0;               // my readAt CAPTURED AT OPEN, from _myReads (already-fetched inbox
                                              // data, BEFORE _markRead() overwrites it) — drives the new-msg divider
  let _threadInitialScrollDone = false;      // true once THIS thread-open's first populated render placed scroll
  let _scrollFabUnseen = 0;                  // messages that arrived while scrolled up (scroll-to-bottom FAB badge)
  // Wave5 Batch M2 — reply / forward / mentions / emoji state.
  let _replyTarget = null;                   // {mid, author, snippet} armed on the composer; rides the NEXT send
                                              // (optimistic bubble AND the real doc), cleared on send/✕/thread-close.
  let _swipe = null;                         // active swipe-to-reply touch-drag (see _onSwipeStart/Move/End)
  let _emojiMenuOpen = false;                // composer emoji-grid popover open state (outside-click cleanup, mirrors _wpMenuOpen)
  const SWIPE_REPLY_ARM = 56, SWIPE_REPLY_CAP = 64;   // px thresholds for the reply-swipe gesture
  // gesture-conflict fix 2026-08 — replaces the old 8px noise-floor + 0.6
  // slope guard, which let moderately-diagonal drags (e.g. a scroll that
  // starts slightly rightward) commit to the reply-swipe and race
  // gestures.js's page-swipe-back + native scroll for the same touch. These
  // gate ONLY axis detection (which way did the finger move) — they are
  // unrelated to SWIPE_REPLY_ARM/CAP above, which gate the visual drag
  // amount and the commit-to-reply amount once already on the horizontal axis.
  const SWIPE_AXIS_THRESH = 24;   // px combined travel before we decide the axis at all
  const SWIPE_SLOPE = 1.8;        // |dx| must exceed this multiple of |dy| to latch "horizontal"
  let _lastThreadScrollAt = 0;    // set by _onThreadScroll — momentum-scroll guard for _onSwipeStart
  // Composer emoji grid (J6): REACTIONS + ~26 more common emoji, static list, no library.
  const EMOJI_GRID = [...REACTIONS, '😀','😁','😅','😊','🙂','😉','😍','🤔','😴','😎','🥳','😭',
    '😡','👏','🙌','🔥','🎉','✅','❌','💯','🤗','🤝','👀','💪','⭐','🚀'];
  // Wave5 M4 — inbox row swipe-to-reveal (Pin/Mute/Archive) state, a local
  // re-implementation of the SAME slope-guard principle as _onSwipeStart/Move/
  // End above (touch-only; desktop uses the hover ⋯ menu instead). One active
  // drag at a time; reveal width matches .ms-inbox-swipe-actions' CSS width.
  let _inboxSwipe = null;
  const INBOX_SWIPE_REVEAL = 132;
  let _inboxMenuOutsideWired = false;   // document click-away listener, wired once

  const _isAdminRole = () => ['president','manager','secretary'].includes(currentRole);
  const _myName = () => (window.userProfile?.displayName || currentUser.email);
  // Wave5 M3 — shared image-URL sniff, hoisted out of _renderMessagePart (was
  // a local const there) so _collectAllImages/_mediaGridHtml/_openMediaTab can
  // all use the exact same rule for "is this attachment an image".
  const _isImageUrl = url => !!url && /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(url);
  // Messenger restyle — colored initials fallback (inbox rows, Fix 1): a
  // stable per-contact/per-group background color instead of always the same
  // --bubble-out-bg gradient, so a photo-less avatar still reads as visually
  // distinct at a glance (same idea as Messenger's own colored circles).
  // Plain hex literals (not CSS custom properties) — mirrors this file's own
  // existing dotColor map convention (see the presence-dot color lookups
  // below) rather than depending on --pink/--blue/etc., which aren't defined
  // as real tokens anywhere in styles.css.
  const AVATAR_PALETTE = ['#0866FF','#7C3AED','#FF6B9D','#FF9F0A','#30D158','#FF3B30','#5AC8FA','#AF52DE','#34C759','#FF375F'];
  function _avatarColorFor(seed) {
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
  }
  // Wave5 M3 — a pending bubble can hold a SINGLE preview object URL
  // (previewUrl, legacy single-file path) and/or an ARRAY of them
  // (previewUrls, multi-photo path) — revoke whichever this bubble actually
  // has. Shared by every "discard optimistic state" site (teardownThread,
  // openConversation's pre-open reset, _reconcilePending) so the revoke logic
  // can't drift between them.
  function _revokePendingPreviews(p) {
    if (p.previewUrl) { try { URL.revokeObjectURL(p.previewUrl); } catch (_) {} }
    (p.previewUrls || []).forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
  }
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
  // v14 Phase2b — wired as openPage's opts.onClose, so this now fires FROM
  // openPage/Overlay's own teardown (Back, Esc, swipe-back, navigateTo's
  // Overlay.clearAll(), and opts.replace's direct-swap path all call it that
  // way). It no longer owns the panel DOM: openPage created the panel, so
  // openPage's teardown owns removing it (with its own close animation /
  // instant removal on replace). This fn is ONLY module-state cleanup, and
  // stays idempotent — openConversation still calls it defensively before
  // opening, AND opts.replace's swap can invoke it a second time synchronously
  // (see openConversation) — every branch below is a no-op on a second call.
  function teardownThread() {                // NEVER calls dismissTop/history.back()
    if (_openConvId) _clearOwnTyping();      // Decision 8: beacon cleared on panel-close too
    _threadUnsubs.forEach(u => { try { u(); } catch(_){} });
    _threadUnsubs = []; _openConvId = null; _openConv = null;
    _msgs = []; _earlier = []; _readers = []; _typing = []; _lastMsgIds = null;
    _lastRenderOrder = null; _earlierCapped = false; _isSending = false;
    // Wave5 M1 — discard optimistic UI state (the underlying Firestore writes,
    // if still in flight, complete in the background regardless — same
    // fire-and-forget posture as the rest of this file's teardown).
    _pending.forEach(_revokePendingPreviews);
    _pending = [];
    _threadOpenReadAtMs = 0; _threadInitialScrollDone = false; _scrollFabUnseen = 0;
    _replyTarget = null; _swipe = null;      // Wave5 M2 — reply-arm + in-flight swipe never survive a thread close
    document.getElementById('chat-thread-scroll')?.removeEventListener('scroll', _onThreadScroll);
    if (_presenceTimer)     { clearInterval(_presenceTimer);     _presenceTimer = null; }
    if (_typingExpireTimer) { clearInterval(_typingExpireTimer); _typingExpireTimer = null; }
    if (_markReadTimer)     { clearTimeout(_markReadTimer);      _markReadTimer = null; }
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', _onViewportResize);
    if (_emojiMenuOpen) document.removeEventListener('click', _emojiOutsideClick, true);   // Wave5 M2
    _emojiMenuOpen = false;
    // Wave1 P0 fix #1 — don't leak the keyboard-offset var onto <html> past
    // this thread's own lifetime (harmless elsewhere today, but it's a
    // document-level custom property, not scoped to this panel).
    document.documentElement.style.removeProperty('--kb-offset');
    _initialMarkReadPending = false;          // Wave1 P1 fix #7 — never carries into the next thread-open
    _exitFullscreen();                       // owner req #2: restore app chrome on close
    _threadPanelEl = null;
  }

  // ── Inbox ──
  function _attachInbox() {
    teardownInbox();
    _sweepStaleDeptDrafts();   // v14 chat re-audit fix — GC dept-channel drafts on every chat-page visit
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
    // v14 chat re-audit fix — this used to be a raw .get() per department on
    // EVERY debounced inbox-refresh burst (unlike _refreshPresence/-Users,
    // which already route through dbCachedGet). For an admin role
    // (myDeptChannels() == every department) a busy chat re-reads every
    // dept_<X> conv doc repeatedly with no TTL — real, avoidable read cost
    // that scales with department count × message frequency. Per-department
    // cache key, short TTL (channel docs rarely change shape — name/
    // wallpaper/photo — so brief staleness there is a non-issue). dbCachedGet's
    // own negative-cache (config.js FAIL_TTL) also covers the "denied ≠
    // missing" unprovisioned-doc case below for free.
    _deptConvs = (await Promise.all(myDeptChannels().map(d =>
      dbCachedGet('dept-conv-' + d, () => db.collection('conversations').doc('dept_' + d).get(), 5000)
        .then(s => s.exists ? { id: s.id, ...s.data() }
          : { id: 'dept_' + d, type: 'dept', department: d, name: d,
              participants: [], _unprovisioned: true })
        .catch(() => null)             // read on missing doc is rules-denied? No: denied ≠ missing; drop it
    ))).filter(Boolean);
  }
  // Wave5 M4 (J9) — the old per-conversation "N readers-doc gets on every
  // inbox refresh" loop (_refreshMyReads) is GONE: unread state now reads the
  // denormalized `conv.reads.{uid}` map that rides in on the SAME
  // conversations listener snapshot that already feeds _convs (zero extra
  // reads). `_myReads` is kept only as the migration-safe fallback _isUnread
  // falls back to when a conv doc predates this batch and doesn't carry
  // `reads` yet — nothing populates it anymore, so that fallback is 0 until
  // the user opens the conversation once (which self-heals it via _markRead's
  // new conv-doc merge below). The one place a SINGLE own-reader-doc get still
  // happens is thread-open (_myReadAtForOpen), for the "New messages" divider.
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
  // Wave5 M4 (J9) — my readAt for THIS conversation, preferring the
  // denormalized `conv.reads.{uid}` (Firestore Timestamp, arrives for free on
  // the conversations snapshot) and falling back to the legacy `_myReads`
  // value (see the comment above _refreshPresence — that map is no longer
  // populated by a loop, so this fallback is 0 for any conv that predates
  // this batch and hasn't been opened since) — migration-safe: never throws,
  // never crashes on an absent field, and self-heals the first time the
  // conversation is opened (_markRead's new conv-doc merge).
  // v14 chat re-audit fix — `_myReads` used to be a genuinely dead fallback:
  // nothing anywhere in this file ever wrote to it, so a conv doc that
  // predates the reads-map migration (or simply has no entry yet for MY uid
  // — e.g. I read it via the old readers-subcollection-only path before this
  // migration shipped, and haven't reopened it since) always read back 0
  // here, showing unread in the inbox/badge forever rather than "until
  // reopened once" as originally intended. Fixed by actually populating
  // `_myReads`: on a cache miss, kick off a ONE-TIME (per conv id, deduped
  // via _legacyReadFetching) background get() of the legacy readers/{uid}
  // doc, cache whatever it finds, and re-render the inbox once it resolves.
  // A conv that's already migrated (has reads.{uid}) never takes this path;
  // a genuinely-never-read conv still resolves to 0 (no behavior change there).
  function _myReadAtMs(cv) {
    const r = cv.reads && cv.reads[currentUser.uid];
    if (r && typeof r.toMillis === 'function') return r.toMillis();
    if (_myReads[cv.id] == null && cv.id && !_legacyReadFetching.has(cv.id)) {
      _legacyReadFetching.add(cv.id);
      db.collection('conversations').doc(cv.id).collection('readers').doc(currentUser.uid).get()
        .then(s => {
          _myReads[cv.id] = s.exists ? (s.data().readAt?.toMillis?.() || 0) : 0;
          _renderInbox();       // self-heal: repaint once the legacy readAt is known
        })
        .catch(() => { _myReads[cv.id] = 0; });   // rules-denied (e.g. unprovisioned dept doc) or offline — same 0 as before
    }
    return _myReads[cv.id] || 0;
  }
  function _isUnread(cv) {
    const last = cv.lastMessageAt?.toMillis?.() || 0;
    return last > 0 && cv.lastMessageBy !== currentUser.uid && last > _myReadAtMs(cv);
  }
  // Wave5 M4 (J7) — per-user pin/mute/archive maps on the conv doc. Absent
  // map or absent own key both read as "not set" — every conv doc written
  // before this batch renders identically to today (no pin rail, no mute
  // glyph, nothing hidden behind Archived).
  function _isPinned(cv)   { return !!(cv.pinnedBy   && cv.pinnedBy[currentUser.uid]); }
  function _isMuted(cv)    { return !!(cv.mutedBy    && cv.mutedBy[currentUser.uid]); }
  function _isArchived(cv) { return !!(cv.archivedBy && cv.archivedBy[currentUser.uid]); }

  // ── Wave5 M1 — Chat nav badge (count of unread CONVERSATIONS, not messages;
  // per-message counts are M4's reads-map work). Drives the SAME visual
  // mechanism app.js already ships for other nav items (bn-badge span inside
  // .bottom-nav-item, positioned via the existing CSS rule) — but since no
  // NAV_REGISTRY item currently sets badge:true for 'chat' (app.js/config.js
  // are out of scope for this batch), the span is created here on demand
  // rather than by buildBottomNav(). Sidebar (desktop) has no badge slot at
  // all today, so a matching span + CSS rule is added for .nav-item too.
  // Persisted per-uid to localStorage so a page reload paints the last-known
  // count immediately, before the inbox listener (which only runs while the
  // Chat page itself is open — see teardownInbox's contract) has a chance to
  // recompute it live.
  function _chatBadgeStorageKey() {
    const uid = (window.currentUser && currentUser.uid) || '';
    return uid ? ('bi-chat-unread-count-' + uid) : null;
  }
  function _updateChatNavBadge(count) {
    const key = _chatBadgeStorageKey();
    if (key) { try { localStorage.setItem(key, String(count)); } catch (_) {} }
    _paintChatNavBadge(count);
    _updateAppBadge(count);
  }
  // Wave5 M4 (J7) — OS-level app badge (the little number on the PWA's home-
  // screen/taskbar icon). Feature-detected — Safari/older Chrome/Firefox
  // simply don't have `navigator.setAppBadge`, and this is a no-op there, not
  // an error. Fed the SAME unread-conversation count as the in-app nav badge
  // (same call site, per spec) — no separate computation, no extra reads.
  function _updateAppBadge(count) {
    if (!('setAppBadge' in navigator)) return;
    try {
      if (count > 0) navigator.setAppBadge(count).catch(() => {});
      else (navigator.clearAppBadge ? navigator.clearAppBadge() : navigator.setAppBadge(0)).catch(() => {});
    } catch (_) {}
  }
  function _paintChatNavBadge(count) {
    const n = count > 99 ? '99+' : String(count);
    const bnItem = document.querySelector('.bottom-nav-item[data-page="chat"]');
    if (bnItem) {
      const wrap = bnItem.querySelector('.bn-icon-wrap');
      if (wrap) {
        let b = wrap.querySelector('.bn-badge');
        if (!b) { b = document.createElement('span'); b.className = 'bn-badge hidden'; wrap.appendChild(b); }
        b.textContent = n;
        b.classList.toggle('hidden', count <= 0);
      }
    }
    const sbItem = document.querySelector('.nav-item[data-page="chat"]');
    if (sbItem) {
      let b = sbItem.querySelector('.bn-badge');
      if (!b) { b = document.createElement('span'); b.className = 'bn-badge hidden'; sbItem.appendChild(b); }
      b.textContent = n;
      b.classList.toggle('hidden', count <= 0);
    }
  }
  // ── Wave1 P0 fix #3 — login-scoped unread-conversation badge ──────────────
  // _attachInbox's own _inboxUnsub (above) only lives while the Chat PAGE
  // itself is open (teardownInbox's documented contract — see its own
  // comment), so the nav/OS badge used to go stale the instant the user
  // navigated anywhere else and a new message arrived. This listener runs for
  // the WHOLE SESSION instead, independent of _convs/_deptConvs/_myReads
  // (those stay page-scoped inbox state). js/chat.js has no auth-state hook
  // of its own — Firebase auth wiring lives in app.js, out of scope for this
  // batch — so notifications.js (already invoked at exactly the right two
  // moments: right after login/profile-load, and on every sign-out path)
  // forwards into these two functions instead.
  function _attachGlobalBadgeListener(uid) {
    _detachGlobalBadgeListener();
    if (!uid) return;
    _globalBadgeUnsub = db.collection('conversations')
      .where('participants', 'array-contains', uid)
      .onSnapshot(snap => {
        _globalBadgeConvs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _recomputeGlobalBadge();
      }, () => {});
  }
  function _detachGlobalBadgeListener() {
    if (_globalBadgeUnsub) { try { _globalBadgeUnsub(); } catch (_) {} _globalBadgeUnsub = null; }
    _globalBadgeConvs = [];
  }
  async function _recomputeGlobalBadge() {
    // The Chat page's own _renderInbox already owns the badge while it's the
    // current page (richer computation: search/filter state, presence, dept-
    // channel merge) — skip here so the two never race to paint the same
    // span with two independently-timed counts ("reconcile so they don't
    // fight" per the batch brief).
    if (window.currentPage === 'chat') return;
    let deptRows = [];
    try {
      deptRows = (await Promise.all(myDeptChannels().map(d =>
        dbCachedGet('dept-conv-' + d, () => db.collection('conversations').doc('dept_' + d).get(), 5000)
          .then(s => s.exists ? { id: s.id, ...s.data() } : null)
          .catch(() => null)
      ))).filter(Boolean);
    } catch (_) { /* best-effort — a DM/group-only count still beats a stale badge */ }
    const all = [..._globalBadgeConvs, ...deptRows];
    const nonArchived = all.filter(cv => !_isArchived(cv));
    _updateChatNavBadge(nonArchived.filter(_isUnread).length);
  }
  // Best-effort seed from the last count this uid saw, so the badge isn't
  // blank on every fresh page load until the user opens Chat. Bounded retry —
  // the nav DOM (built once at login by app.js's buildNav()) and currentUser
  // both arrive asynchronously after this module parses.
  (function _seedChatNavBadgeFromCache() {
    let tries = 0;
    const attempt = () => {
      tries++;
      const uid = (window.currentUser && currentUser.uid) || '';
      const navReady = document.querySelector('.bottom-nav-item[data-page="chat"]') ||
                        document.querySelector('.nav-item[data-page="chat"]');
      if (uid && navReady) {
        try {
          const cached = localStorage.getItem('bi-chat-unread-count-' + uid);
          if (cached != null) _paintChatNavBadge(parseInt(cached, 10) || 0);
        } catch (_) {}
        return;
      }
      if (tries > 40) return;   // ~10s of retrying, then give up — a real _renderInbox call will paint it
      setTimeout(attempt, 250);
    };
    attempt();
  })();

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

  // Wave5 M2 — extracted from _renderInbox's inline title resolution (was
  // duplicated ad hoc) so the Forward conversation picker (reuses "my
  // conversations, sorted recent") can resolve the same row titles without
  // re-deriving the dm/group/dept branching a second time.
  function _convTitle(cv) {
    if (cv.type === 'dm') {
      const otherUid = (cv.participants || []).find(u => u !== currentUser.uid);
      return (cv.participantNames && cv.participantNames[otherUid]) || 'User';
    }
    if (cv.type === 'group') return cv.name || 'Group';
    return cv.name || cv.department || 'Channel';
  }

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
    const myUid = currentUser.uid;
    const deptRows = myDeptChannels().map(d => {
      const existing = _deptConvs.find(cv => cv.department === d);
      return existing || { id: 'dept_' + d, type: 'dept', department: d, name: d,
        participants: [], lastMessageAt: null, lastMessageText: null,
        lastMessageBy: null, lastMessageByName: null, _unprovisioned: true };
    });
    const all = [..._convs, ...deptRows];
    // Wave5 M4 (J7) — archived-by-me conversations are hidden from every list
    // EXCEPT the 'Archived' filter chip itself (Messenger-style); the total
    // unread badge (nav + M4's OS app badge) is likewise computed over the
    // non-archived set so an archived-and-forgotten thread doesn't keep the
    // badge lit.
    const nonArchived = all.filter(cv => !_isArchived(cv));
    _updateChatNavBadge(nonArchived.filter(_isUnread).length);
    const filtered = _filter === 'archived' ? all.filter(_isArchived)
      : _filter === 'all' ? nonArchived
      : nonArchived.filter(cv => cv.type === _filter);
    const sorted = filtered.slice().sort((a, b) =>
      (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0));

    if (!sorted.length) {
      el.innerHTML = _filter === 'archived'
        ? `<div class="empty-state"><div class="empty-icon">${emojiIcon('archive',44)}</div><h4>No archived chats</h4></div>`
        : `<div class="empty-state"><div class="empty-icon">${emojiIcon('💬',44)}</div><h4>No conversations yet</h4><p>Tap "+ New Message" to start one.</p></div>`;
      return;
    }
    const initials = s => escHtml((s || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    // WS42 Phase 16 — resolve title first (search needs it before the row markup exists).
    // Wave1 P2 fix #12 — also match the inbox preview text (lastMessageText),
    // not just the conversation title, so searching for something someone
    // actually SAID finds the thread.
    const rows = sorted.map(cv => ({ cv, title: _convTitle(cv) }))
      .filter(r => !_searchQ || r.title.toLowerCase().includes(_searchQ) ||
        (r.cv.lastMessageText || '').toLowerCase().includes(_searchQ));

    if (!rows.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔎',44)}</div><h4>No matches</h4></div>`;
      return;
    }
    // Wave5 M4 (J7) — pinned rail: pinned rows float to the top of whatever
    // list is currently showing (respects the active filter/search), each
    // tagged with a pin glyph; a small "Pinned" label separates the two
    // groups whenever both are non-empty.
    const pinnedRows = rows.filter(r => _isPinned(r.cv));
    const restRows = rows.filter(r => !_isPinned(r.cv));

    // Messenger restyle Fix 1 — flat, borderless, full-bleed rows: 52px round
    // avatar (photo when available, colored initials fallback — see
    // _avatarColorFor), name semibold, 'preview · 2h' as one inline second
    // line, unread = bold name/preview + a small blue dot on the right (no
    // numeric badge, no bordered .item-card shell — see the CSS rewrite of
    // .chat-inbox-row/.ms-avatar-lg). The ⋯ button stays in the DOM for the
    // desktop hover affordance but is CSS-hidden on touch (swipe reveals the
    // same actions there instead).
    const rowHtml = ({ cv, title }) => {
      const unread = _isUnread(cv), pinned = _isPinned(cv), muted = _isMuted(cv), archived = _isArchived(cv);
      let avatarHtml;
      if (cv.type === 'dm') {
        const otherUid = (cv.participants || []).find(u => u !== myUid);
        const otherUser = _presenceByUid[otherUid];   // Wave5-cache users doc (photoUrl) — no extra read
        const pres = _presenceBucket(otherUser?.lastSeen);
        const dotColor = { green: '#30D158', orange: '#FF9F0A', gray: '#8E8E93' }[pres.dot] || '#8E8E93';
        avatarHtml = otherUser?.photoUrl
          ? `<div class="ms-avatar ms-avatar-lg" style="position:relative;flex-shrink:0;padding:0"><img src="${escHtml(otherUser.photoUrl)}" alt="${escHtml(title)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/><span class="ms-presence-dot" style="background:${dotColor}"></span></div>`
          : `<div class="ms-avatar ms-avatar-lg" style="position:relative;flex-shrink:0;background:${_avatarColorFor(otherUid||title)}">${initials(title)}<span class="ms-presence-dot" style="background:${dotColor}"></span></div>`;
      } else if (cv.type === 'group') {
        // Wave5 M4 — group avatar renders conv.photoUrl (set via the info
        // page's About section, creator/admin only) with initials fallback.
        avatarHtml = cv.photoUrl
          ? `<div class="ms-avatar ms-avatar-lg" style="flex-shrink:0;padding:0"><img src="${escHtml(cv.photoUrl)}" alt="${escHtml(title)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/></div>`
          : `<div class="ms-avatar ms-avatar-lg" style="flex-shrink:0;background:${_avatarColorFor(cv.id||title)}">${initials(title)}</div>`;
      } else {
        const cfg = (window.DEPARTMENTS || {})[cv.department] || {};
        avatarHtml = `<div class="ms-avatar ms-avatar-lg" style="flex-shrink:0;background:${cfg.color || 'var(--primary)'}">${cfg.icon || `${emojiIcon('💬',16)}`}</div>`;
      }
      const preview = cv.lastMessageText ? escHtml(cv.lastMessageText) : 'No messages yet';
      const ago = cv.lastMessageAt ? _timeAgo(cv.lastMessageAt) : '';
      const previewLine = ago ? `${preview} · ${ago}` : preview;
      const cid = escHtml(cv.id);
      // Dept channels: pin/mute work, archive is disabled (membership is
      // derived from department, not owned by the user — nothing to "put
      // away" independently of leaving the department itself).
      const canArchive = cv.type !== 'dept';
      return `
      <div class="ms-inbox-row-wrap${pinned?' ms-inbox-pinned':''}" data-cid="${cid}">
        <div class="ms-inbox-swipe-actions" data-cid="${cid}">
          <button type="button" class="ms-inbox-act ms-inbox-act-pin" data-act="pin" data-cid="${cid}" title="${pinned?'Unpin':'Pin'}">${emojiIcon('pin',16)}</button>
          <button type="button" class="ms-inbox-act ms-inbox-act-mute" data-act="mute" data-cid="${cid}" title="${muted?'Unmute':'Mute'}">${emojiIcon(muted?'bell':'bell-off',16)}</button>
          ${canArchive?`<button type="button" class="ms-inbox-act ms-inbox-act-archive" data-act="archive" data-cid="${cid}" title="${archived?'Unarchive':'Archive'}">${emojiIcon('archive',16)}</button>`:''}
        </div>
        <div class="chat-inbox-row pressable${unread?' ms-inbox-unread':''}" data-cid="${cid}" data-unprov="${cv._unprovisioned?'1':''}" data-dept="${escHtml(cv.department||'')}">
          ${avatarHtml}
          <div class="chat-inbox-row-body">
            <div class="chat-inbox-row-name">
              ${pinned?`<i data-lucide="pin" class="ms-inbox-pin-glyph"></i>`:''}
              <span class="chat-inbox-row-name-text">${escHtml(title)}</span>
              ${muted?`<i data-lucide="bell-off" class="ms-inbox-mute-glyph"></i>`:''}
            </div>
            <div class="chat-inbox-row-preview">${previewLine}</div>
          </div>
          ${unread ? '<span class="ms-unread-dot" aria-label="Unread"></span>' : ''}
          <button type="button" class="ms-row-more-btn" data-cid="${cid}" title="More options" aria-haspopup="menu">${emojiIcon('more-vertical',16)}</button>
        </div>
        <div class="ms-row-menu hidden" data-cid="${cid}" role="menu">
          <button type="button" class="ms-row-menu-item" data-act="pin" data-cid="${cid}">${pinned?'Unpin':'Pin'}</button>
          <button type="button" class="ms-row-menu-item" data-act="mute" data-cid="${cid}">${muted?'Unmute':'Mute'}</button>
          ${canArchive
            ? `<button type="button" class="ms-row-menu-item" data-act="archive" data-cid="${cid}">${archived?'Unarchive':'Archive'}</button>`
            : `<div class="ms-row-menu-note">Archive isn't available for department channels.</div>`}
        </div>
      </div>`;
    };

    const pinnedHtml = pinnedRows.length
      ? `<div class="ms-inbox-pinned-label">${emojiIcon('pin',12)} Pinned</div>` + pinnedRows.map(rowHtml).join('')
      : '';
    el.innerHTML = '<div class="item-list">' + pinnedHtml + restRows.map(rowHtml).join('') + '</div>';

    // Row tap → open conversation (guarded off the ⋯ button; a row mid-swipe
    // closes instead of navigating, matching common swipe-action UX).
    el.querySelectorAll('.chat-inbox-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.ms-row-more-btn')) return;
        const wrap = row.closest('.ms-inbox-row-wrap');
        if (wrap && wrap.classList.contains('ms-inbox-swiped')) {
          wrap.classList.remove('ms-inbox-swiped'); row.style.transform = ''; return;
        }
        const cid = row.dataset.cid;
        if (row.dataset.unprov) { openDeptChannel(row.dataset.dept); return; }
        const cv = sorted.find(x => x.id === cid);
        openConversation(cid, cv);
      });
    });
    // Desktop hover ⋯ menu — toggle THIS row's menu, close any other open one.
    el.querySelectorAll('.ms-row-more-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cid = btn.dataset.cid;
        el.querySelectorAll('.ms-row-menu').forEach(m => { if (m.dataset.cid !== cid) m.classList.add('hidden'); });
        el.querySelector(`.ms-row-menu[data-cid="${CSS.escape(cid)}"]`)?.classList.toggle('hidden');
      });
    });
    // Pin/Mute/Archive — same handler for both the swipe-revealed buttons and
    // the ⋯ dropdown items (identical data-act/data-cid contract).
    el.querySelectorAll('.ms-row-menu-item, .ms-inbox-act').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const { act, cid } = btn.dataset;
        el.querySelectorAll('.ms-row-menu').forEach(m => m.classList.add('hidden'));
        const wrap = btn.closest('.ms-inbox-row-wrap');
        if (wrap) {
          wrap.classList.remove('ms-inbox-swiped');
          const content = wrap.querySelector('.chat-inbox-row');
          if (content) content.style.transform = '';
        }
        if (act === 'pin') _toggleConvFlag(cid, 'pinnedBy');
        else if (act === 'mute') _toggleConvFlag(cid, 'mutedBy');
        else if (act === 'archive') _toggleConvFlag(cid, 'archivedBy');
      });
    });
    // Mobile swipe-left row actions (Wave5 M4) — slope-guarded exactly like
    // the in-thread swipe-to-reply gesture (_onSwipeStart/Move/End above).
    el.querySelectorAll('.ms-inbox-row-wrap').forEach(wrap => {
      const content = wrap.querySelector('.chat-inbox-row');
      if (!content) return;
      content.addEventListener('touchstart', _onInboxSwipeStart, { passive: true });
      content.addEventListener('touchmove', _onInboxSwipeMove, { passive: false });
      content.addEventListener('touchend', _onInboxSwipeEnd);
      content.addEventListener('touchcancel', _onInboxSwipeEnd);
      // Wave1 P2 fix #18 — swipe-to-reveal is the ONLY path to Pin/Mute/
      // Archive on touch (the ⋯ button is CSS-hidden there — see
      // .ms-row-more-btn's @media(hover:none) rule) and it's completely
      // unhinted. Add a long-press fallback (same 500ms threshold the
      // message-bubble reaction picker already uses — see LONG_PRESS_MS)
      // that opens the SAME .ms-row-menu dropdown the desktop ⋯ button
      // toggles — identical data-act/data-cid contract, so no new action
      // wiring is needed. Any movement cancels the press timer, same as the
      // bubble long-press pattern, so it never fights the swipe gesture
      // (which takes over the instant the drag axis commits horizontal).
      let lpTimer = null;
      const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
      content.addEventListener('touchstart', () => {
        clearLp();
        lpTimer = setTimeout(() => {
          lpTimer = null;
          const cid = content.dataset.cid;
          el.querySelectorAll('.ms-row-menu').forEach(m => { if (m.dataset.cid !== cid) m.classList.add('hidden'); });
          el.querySelector(`.ms-row-menu[data-cid="${CSS.escape(cid)}"]`)?.classList.toggle('hidden');
          if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
        }, LONG_PRESS_MS);
      }, { passive: true });
      content.addEventListener('touchend', clearLp);
      content.addEventListener('touchcancel', clearLp);
      content.addEventListener('touchmove', clearLp);
    });
    // Outside-tap closes any open ⋯ menu AND any swiped-open row (wired once —
    // _renderInbox rebuilds #chat-inbox wholesale on every refresh, so a
    // per-render listener would leak; this one lives on `document` forever
    // and re-queries #chat-inbox fresh on every click).
    if (!_inboxMenuOutsideWired) {
      document.addEventListener('click', e => {
        const inboxEl = document.getElementById('chat-inbox'); if (!inboxEl) return;
        if (!inboxEl.contains(e.target) || (!e.target.closest('.ms-row-more-btn') && !e.target.closest('.ms-row-menu'))) {
          inboxEl.querySelectorAll('.ms-row-menu').forEach(m => m.classList.add('hidden'));
        }
        if (!inboxEl.contains(e.target)) {
          inboxEl.querySelectorAll('.ms-inbox-row-wrap.ms-inbox-swiped').forEach(w => {
            w.classList.remove('ms-inbox-swiped');
            const c = w.querySelector('.chat-inbox-row'); if (c) c.style.transform = '';
          });
        }
      });
      _inboxMenuOutsideWired = true;
    }
    if (window.lucide) lucide.createIcons({ nodes: [el] });
  }
  // Wave5 M4 (J7) — swipe-left-to-reveal Pin/Mute/Archive on an inbox row.
  function _onInboxSwipeStart(e) {
    const wrap = e.currentTarget.closest('.ms-inbox-row-wrap'); if (!wrap) return;
    const t = e.touches && e.touches[0]; if (!t) return;
    document.querySelectorAll('.ms-inbox-row-wrap.ms-inbox-swiped').forEach(w => {
      if (w !== wrap) { w.classList.remove('ms-inbox-swiped'); const c = w.querySelector('.chat-inbox-row'); if (c) c.style.transform = ''; }
    });
    const already = wrap.classList.contains('ms-inbox-swiped');
    _inboxSwipe = { wrap, startX: t.clientX, startY: t.clientY, dx: 0, committed: false, aborted: false,
                    baseOffset: already ? -INBOX_SWIPE_REVEAL : 0 };
  }
  function _onInboxSwipeMove(e) {
    if (!_inboxSwipe || _inboxSwipe.aborted) return;
    const t = e.touches && e.touches[0]; if (!t) return;
    const dx = t.clientX - _inboxSwipe.startX, dy = t.clientY - _inboxSwipe.startY;
    if (!_inboxSwipe.committed) {
      // gesture-conflict fix 2026-08 — same true axis-lock as _onSwipeMove
      // (reuses SWIPE_AXIS_THRESH/SWIPE_SLOPE), mirrored for LEFTWARD motion
      // since this gesture reveals on a leftward drag instead of rightward.
      // Stops vertical inbox-list scrolling from ever accidentally revealing
      // the Pin/Mute/Archive actions.
      if (Math.abs(dx) < SWIPE_AXIS_THRESH && Math.abs(dy) < SWIPE_AXIS_THRESH) return;   // undecided — keep waiting
      if (!(dx < 0 && Math.abs(dx) > SWIPE_SLOPE * Math.abs(dy))) { _inboxSwipe.aborted = true; return; }  // vertical-dominant or rightward — permanently abort
      _inboxSwipe.committed = true;
    }
    e.preventDefault();
    const raw = Math.min(0, Math.max(-INBOX_SWIPE_REVEAL, _inboxSwipe.baseOffset + dx));
    _inboxSwipe.dx = raw;
    const content = _inboxSwipe.wrap.querySelector('.chat-inbox-row');
    if (content) content.style.transform = `translateX(${raw}px)`;
  }
  function _onInboxSwipeEnd() {
    if (!_inboxSwipe) return;
    const { wrap, dx, committed } = _inboxSwipe;
    if (committed) {
      const open = dx <= -INBOX_SWIPE_REVEAL / 2;
      wrap.classList.toggle('ms-inbox-swiped', open);
      const content = wrap.querySelector('.chat-inbox-row');
      if (content) content.style.transform = open ? `translateX(-${INBOX_SWIPE_REVEAL}px)` : '';
    }
    _inboxSwipe = null;
  }
  // Wave5 M4 (J7) — toggle MY OWN key inside pinnedBy/mutedBy/archivedBy.
  // Optimistic local flip (both cv objects the inbox currently holds a
  // reference to are mutated in place, same pattern as _setWallpaper) so the
  // row updates before the write round-trips; reverted + toasted on failure.
  // Dot-path update ([`${field}.${uid}`]) — the ONLY shape the deployed rule
  // allows: top-level affectedKeys must be a subset of
  // {pinnedBy,mutedBy,archivedBy}, and each map's own diff must touch only
  // the caller's uid (firestore.rules ~line 421-431).
  async function _toggleConvFlag(cid, field) {
    const cv = [..._convs, ..._deptConvs].find(c => c.id === cid);
    if (!cv) return;
    if (cv.type === 'dept' && cv._unprovisioned) { await _ensureDeptDocExists(cv.department); cv._unprovisioned = false; }
    const uid = currentUser.uid;
    const isSet = !!(cv[field] && cv[field][uid]);
    cv[field] = { ...(cv[field] || {}) };
    if (isSet) delete cv[field][uid]; else cv[field][uid] = true;
    _renderInbox();
    const FV = firebase.firestore.FieldValue;
    await db.collection('conversations').doc(cid)
      .update({ [`${field}.${uid}`]: isSet ? FV.delete() : true })
      .catch(() => {
        if (isSet) cv[field][uid] = true; else delete cv[field][uid];
        _renderInbox();
        Notifs.showToast('Could not update conversation', 'error');
      });
  }
  // Wave5 M4 — shared by openDeptChannel (opening) and _toggleConvFlag
  // (pin/mute on a channel nobody has opened yet): lazily provisions the
  // dept_<department> conv doc if it doesn't exist, same shape either way.
  async function _ensureDeptDocExists(dept) {
    const id = 'dept_' + dept, ref = db.collection('conversations').doc(id);
    const snap = await ref.get().catch(() => null);
    if (!snap || !snap.exists) {
      await ref.set({ type: 'dept', department: dept, name: dept, participants: [],
        participantNames: {}, createdBy: currentUser.uid, createdByName: _myName(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastMessageAt: null, lastMessageText: null, lastMessageBy: null, lastMessageByName: null
      }).catch(() => {});
    }
    return id;
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
    const id = await _ensureDeptDocExists(dept);   // Wave5 M4 — shared with _toggleConvFlag's dept lazy-provision
    openConversation(id);
  }

  // ── Thread panel (fork of task-fullscreen-panel, Spec 5) ──
  function _headerTitleAndAvatar(conv) {
    const initials = s => escHtml((s || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    let title, avatarHtml;
    if (conv.type === 'dm') {
      const otherUid = (conv.participants || []).find(u => u !== currentUser.uid);
      title = (conv.participantNames && conv.participantNames[otherUid]) || 'User';
      // Wave1 P2 fix #14 — the DM thread header used to always render a flat,
      // colorless generic avatar even though the SAME contact already gets a
      // photo (or a stable per-contact colored-initials fallback) on their
      // inbox row — see _renderInbox's otherUser/_avatarColorFor lookup.
      // Reuses the exact same _usersByUid cache (_authorInfo) here; id lets
      // openConversation's post-_refreshUsersCache patch (below) update this
      // node live if the cache was still cold at build time.
      const otherInfo = _authorInfo(otherUid, title);
      avatarHtml = otherInfo.photoUrl
        ? `<div class="ms-avatar ms-avatar-md" id="chat-thread-avatar"><img src="${escHtml(otherInfo.photoUrl)}" alt="${escHtml(title)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/></div>`
        : `<div class="ms-avatar ms-avatar-md" id="chat-thread-avatar" style="background:${_avatarColorFor(otherUid||title)}">${initials(title)}</div>`;
    } else if (conv.type === 'group') {
      title = conv.name || 'Group';
      // Wave5 M4 — group avatar renders conv.photoUrl with initials fallback;
      // id lets the About-section photo-upload handler (_openMediaTab) patch
      // this exact node live, without waiting for the next thread-open.
      avatarHtml = conv.photoUrl
        ? `<div class="ms-avatar ms-avatar-md" id="chat-thread-avatar"><img src="${escHtml(conv.photoUrl)}" alt="${escHtml(title)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/></div>`
        : `<div class="ms-avatar ms-avatar-md" id="chat-thread-avatar">${initials(title)}</div>`;
    } else {
      const cfg = (window.DEPARTMENTS || {})[conv.department] || {};
      title = conv.name || conv.department || 'Channel';
      avatarHtml = `<div class="ms-avatar ms-avatar-md" style="background:${cfg.color || 'var(--primary)'}">${cfg.icon || `${emojiIcon('💬',16)}`}</div>`;
    }
    return { title, avatarHtml };
  }

  // v14 Wave1 Phase2b — rebuilt on window.openPage (Batch1 page-stack
  // primitive) instead of a hand-rolled position:fixed z-4000 shell.
  //
  // HEADER CHOICE: the full .ms-thread-header block (avatar + title +
  // presence subtitle + Leave button + wallpaper ⋮ menu) is injected as the
  // FIRST element of the page BODY, verbatim, minus the old #chat-panel-back
  // button — openPage's own back chevron (in its native .page-panel-head)
  // replaces that. opts.headerRightHTML was NOT used: a DM's avatar image
  // and the presence subtitle line don't fit openPage's plain-text
  // .page-panel-title slot, and splitting the wallpaper trigger button into
  // headerRightHTML while its (CSS `position:relative`-parented) popover
  // menu stayed in the body would separate them across two DOM locations —
  // the popover is positioned relative to .ms-thread-header, so it needs to
  // stay together with its button. Net effect: openPage's native header bar
  // (back chevron + title text, title passed through for a11y/aria-labelledby)
  // now renders ABOVE .ms-thread-header — an extra slim bar that didn't exist
  // before, most visible in phone full-screen mode where the CSS previously
  // intended .ms-thread-header to be the ONLY chrome. Fixing that fully needs
  // a CSS change (hiding .page-panel-head under body.chat-fullscreen), which
  // is out of scope for a js/chat.js-only batch — flagged for the CSS owner.
  function _buildThreadPanel(conv) {
    const { title, avatarHtml } = _headerTitleAndAvatar(conv);
    const memberCount = (conv.participants || []).length;
    const subtitleHtml = conv.type === 'dm'
      ? `<span id="chat-presence-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:transparent;margin-right:4px"></span><span id="chat-presence-label" style="font-size:11px;color:var(--text-muted)"></span>`
      : conv.type === 'group'
        ? `<span style="font-size:11px;color:var(--text-muted)">${memberCount} member${memberCount!==1?'s':''}</span>`
        : `<span style="font-size:11px;color:var(--text-muted)">Department channel</span>`;
    // Messenger restyle Fix 4 — slim header: back + avatar + name/members +
    // (i) ONLY. Leave (group-only) and the wallpaper ⋮ preset picker used to
    // live here; both RELOCATED into the info page (_openMediaTab's About
    // section) — Leave as a red row at the bottom, wallpaper as an inline
    // "Chat wallpaper" row that expands the SAME WALLPAPERS preset list
    // in place. Reachable via the exact same (i) button as before.
    const infoBtnHtml = `<button id="chat-info-btn" class="ms-thread-menu-btn" title="Shared media, files &amp; links" aria-label="Shared media, files and links">${emojiIcon('info', 18)}</button>`;
    // Messenger body/typing row/composer markup below is byte-identical to
    // the old shell's innerHTML — only the outer wrapper (now openPage's
    // .page-panel) and the header (now injected, back-button-less) changed.
    const bodyHtml = `
      <div class="ms-thread-header">
        <button id="chat-panel-back" class="ms-thread-back" title="Back" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        ${avatarHtml}
        <div class="ms-thread-info">
          <div class="ms-thread-title">${escHtml(title)}</div>
          <div class="ms-thread-subtitle">${subtitleHtml}</div>
        </div>
        ${infoBtnHtml}
      </div>
      <div id="chat-thread-scroll-wrap" style="position:relative;flex:1;min-height:0;display:flex;flex-direction:column">
        <div id="chat-thread-scroll" class="messenger-body" style="padding:12px 14px"></div>
        <button id="chat-scroll-fab" class="ms-scroll-fab hidden" type="button" title="Scroll to latest" aria-label="Scroll to latest messages">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          <span id="chat-scroll-fab-badge" class="ms-scroll-fab-badge hidden">0</span>
        </button>
      </div>
      <div id="chat-typing-row"></div>
      <div id="chat-file-preview" style="font-size:11px;color:var(--primary);padding:0 14px 4px;min-height:16px"></div>
      <div id="chat-reply-chip" class="ms-reply-chip hidden"></div>
      <div class="messenger-input-row">
        <div id="chat-mention-dd" class="ms-mention-dd hidden" role="listbox"></div>
        <div id="chat-emoji-grid" class="ms-emoji-grid hidden" role="menu">${
          EMOJI_GRID.map(e => `<button type="button" class="ms-emoji-opt" data-emoji="${e}">${e}</button>`).join('')
        }</div>
        <button type="button" class="ms-attach-btn ms-attach-toggle" id="chat-attach-toggle" title="Attach" aria-haspopup="true" aria-expanded="false">
          <svg class="ms-attach-toggle-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <div id="chat-attach-expand" class="ms-attach-expand hidden">
          <label for="chat-file" class="ms-attach-btn" title="Attach file(s)">${emojiIcon('paperclip', 18)}</label>
          <input type="file" id="chat-file" multiple style="display:none" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"/>
          <label for="chat-camera" class="ms-attach-btn" title="Camera">${emojiIcon('camera', 18)}</label>
          <input type="file" id="chat-camera" accept="image/*" capture="environment" style="display:none"/>
          <button type="button" class="ms-attach-btn" id="chat-link" title="Attach link">${emojiIcon('link',18)}</button>
        </div>
        <button type="button" class="ms-attach-btn" id="chat-emoji-btn" title="Emoji">${emojiIcon('smile',18)}</button>
        <textarea id="chat-input" class="ms-input" rows="1" placeholder="Type a message…"></textarea>
        <button class="ms-send-btn" id="chat-send" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>`;

    // v14 Wave1 spec Phase2b #4 — if a chat thread page is ALREADY the top of
    // the page stack (switching conversations without leaving the chat page:
    // a different inbox row tapped, or a push-notif deep-link that calls
    // openConversation directly while a thread is open), swap it in place via
    // opts.replace so history depth doesn't grow per conversation switch. If
    // the top of the stack is something else (or the stack is empty) this is
    // a normal push — e.g. opening a thread from the "New Message" page.
    const stack = window._pageStack || [];
    const alreadyOpen = stack.length > 0 && stack[stack.length - 1].id === 'chat-thread-panel';

    const p = window.openPage(title, bodyHtml, '', {
      replace: alreadyOpen,
      onClose: () => window.Chat.teardownThread()
    });
    p.id = 'chat-thread-panel';   // preserve the id: styles.css keys the phone
                                  // chat-fullscreen top/z overrides AND the
                                  // .messenger-body max-height:none override
                                  // off this exact "#chat-thread-panel" id.
    _threadPanelEl = p;           // visualViewport handler targets this, not a lookup

    // openPage's generic .page-panel-body is padded + its own overflow:auto
    // scroll container; the messenger layout owns its OWN internal scroll
    // region (#chat-thread-scroll/.messenger-body) and needs to fill the
    // full available height edge-to-edge like the old fixed shell did.
    // Neutralize the two conflicting properties via inline style (no CSS
    // file in scope) while keeping the flex:1 sizing that makes it fill
    // the panel.
    const bodyEl = p.querySelector('.page-panel-body');
    if (bodyEl) bodyEl.style.cssText = 'flex:1;min-height:0;overflow:hidden;padding:0;display:flex;flex-direction:column;';

    // Chat renders its own messenger header (avatar/presence/wallpaper), so
    // the generic .page-panel-head would be a duplicate bar — hide it and
    // route the messenger header's own back chevron through the stack.
    const genericHead = p.querySelector('.page-panel-head');
    if (genericHead) genericHead.style.display = 'none';
    document.getElementById('chat-panel-back')
      ?.addEventListener('click', () => window.Overlay.dismissTop());

    _applyWallpaper(conv);
    _enterFullscreenIfPhone();               // owner req #2: Messenger-style full-screen on phone
    // Leave-group and the wallpaper preset picker are wired inside
    // _openMediaTab's About section now (Fix 4) — nothing to bind here.

    // Wave5 M3 (J4) — ⓘ Shared Media/Files/Links info page.
    document.getElementById('chat-info-btn')?.addEventListener('click', () => _openMediaTab(conv));

    // composer wiring: send → Chat.sendMessage({text, file, images, link}) then
    // clear input/attachment/preview (NO re-render call — the messages
    // listener repaints). pendingImages/pendingFile/pendingLink are mutually
    // exclusive "what's currently attached" slots, same as the pre-M3
    // file/link exclusivity — attaching one clears the other two.
    let pendingFile = null, pendingLink = null, pendingImages = [];
    const fileInp = document.getElementById('chat-file');
    const cameraInp = document.getElementById('chat-camera');
    const filePreview = document.getElementById('chat-file-preview');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const updateSendState = () => { sendBtn.disabled = !((input.value || '').trim() || pendingFile || pendingImages.length || pendingLink); };
    // Messenger restyle Fix 5 — the 3 attach controls (file/camera/link)
    // collapse into ONE ➕ button that expands them inline (Messenger-style)
    // when tapped, and auto-collapses once the composer has text (below, in
    // the input handler). The emoji button is untouched — it stays its own
    // persistent icon beside the input, per spec.
    const attachToggle = document.getElementById('chat-attach-toggle');
    const attachExpand = document.getElementById('chat-attach-expand');
    const setAttachExpanded = open => {
      if (!attachToggle || !attachExpand) return;
      attachExpand.classList.toggle('hidden', !open);
      attachToggle.classList.toggle('ms-attach-toggle-open', open);
      attachToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    attachToggle?.addEventListener('click', e => {
      e.stopPropagation();
      setAttachExpanded(!!attachExpand?.classList.contains('hidden'));
    });
    // Wave5 M1 — per-conversation draft restore (localStorage `bi-chat-draft-{convId}`).
    // Saved on input (debounced 300ms below), cleared on optimistic send,
    // re-saved if that send fails and the text is restored to the composer.
    const draft = _loadDraft(conv.id);
    if (draft) { input.value = draft; _autoGrow(input); }
    updateSendState();
    let _draftSaveTimer = null;
    // Wave5 M3 (J4) — shared by the multi-select file input's image branch,
    // the camera input, paste, and drag-drop: appends up to the 6/message cap
    // (toasting once if the selection had to be trimmed), and clears any
    // pending doc/link attachment (an image attachment replaces those, same
    // "one attachment kind at a time" rule the pre-M3 file/link toggle had).
    function _addPendingImages(files) {
      if (!files || !files.length) return;
      pendingFile = null; pendingLink = null;
      const room = 6 - pendingImages.length;
      if (room <= 0) { Notifs.showToast('Up to 6 photos per message', 'error'); return; }
      const add = files.slice(0, room);
      if (files.length > add.length) Notifs.showToast('Up to 6 photos per message — extra photos skipped', 'error');
      pendingImages.push(...add);
      filePreview.textContent = `📷 ${pendingImages.length} photo${pendingImages.length > 1 ? 's' : ''} selected`;
      updateSendState();
      setAttachExpanded(false);
    }
    fileInp.addEventListener('change', e => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';   // allow re-selecting the same file(s) later
      if (!files.length) return;
      const imgFiles = files.filter(f => /^image\//.test(f.type || ''));
      if (imgFiles.length) {
        _addPendingImages(imgFiles);
        // A mixed selection (photos + a doc in the same pick) isn't a shape
        // this batch's message doc can carry (media[] OR a single fileUrl,
        // never both) — the doc(s) are dropped, but never silently: same
        // "always tell the user, never lose data quietly" rule Phase 63 #1
        // established for upload failures.
        if (imgFiles.length < files.length) Notifs.showToast('Only photos support multi-select — other file(s) skipped', 'error');
        return;
      }
      // Non-image selection: unchanged single-doc pipeline (Non-image files
      // unchanged, per spec) — a doc attachment replaces images/link too.
      const f = files[0];
      // v14 chat re-audit fix — only images had a size floor
      // (_compressImage's 300KB compression threshold); a non-image
      // attachment went straight to Storage with no client-side size check,
      // only failing after a slow-connection wait once it hit
      // storage.rules' isValidDocument() cap (25MB — MAX_CHAT_FILE_BYTES
      // above mirrors that same limit). Reject and toast immediately instead.
      if (f && f.size > MAX_CHAT_FILE_BYTES) {
        Notifs.showToast(`"${f.name}" is too large to attach (max 25MB)`, 'error');
        return;
      }
      pendingImages = []; pendingLink = null;
      pendingFile = f || null;
      filePreview.textContent = f ? `📎 ${f.name}` : '';
      updateSendState();
      setAttachExpanded(false);
    });
    cameraInp?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) _addPendingImages([f]);
    });
    document.getElementById('chat-link').addEventListener('click', async () => {
      let url = ((await promptDialog({ message: 'Paste a link to attach:' })) || '').trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      pendingLink = url; pendingFile = null; pendingImages = [];   // a link replaces a pending file/images
      fileInp.value = '';
      filePreview.textContent = `🔗 ${url}`;
      updateSendState();
      setAttachExpanded(false);
    });

    // Wave5 M3 (J4) — paste an image from the clipboard directly into the
    // composer (desktop). Only preventDefault when an image was actually
    // found, so normal text paste is never intercepted.
    input.addEventListener('paste', e => {
      const items = e.clipboardData && e.clipboardData.items; if (!items) return;
      const imgFiles = [];
      for (const it of items) {
        if (it.kind === 'file' && /^image\//.test(it.type || '')) {
          const f = it.getAsFile(); if (f) imgFiles.push(f);
        }
      }
      if (imgFiles.length) { e.preventDefault(); _addPendingImages(imgFiles); }
    });
    // Wave5 M3 (J4) — drag-over highlight + drop-to-attach on the whole
    // thread panel (desktop). dragenter/dragleave use a depth counter because
    // both fire repeatedly as the pointer crosses child elements.
    let _dragDepth = 0;
    const _dragHasFiles = e => !!(e.dataTransfer && Array.prototype.includes.call(e.dataTransfer.types || [], 'Files'));
    p.addEventListener('dragenter', e => {
      if (!_dragHasFiles(e)) return;
      e.preventDefault(); _dragDepth++;
      p.classList.add('ms-drop-active');
    });
    p.addEventListener('dragover', e => { if (_dragHasFiles(e)) e.preventDefault(); });
    p.addEventListener('dragleave', () => {
      _dragDepth = Math.max(0, _dragDepth - 1);
      if (_dragDepth === 0) p.classList.remove('ms-drop-active');
    });
    p.addEventListener('drop', e => {
      _dragDepth = 0; p.classList.remove('ms-drop-active');
      const files = Array.from(e.dataTransfer?.files || []).filter(f => /^image\//.test(f.type || ''));
      if (files.length) { e.preventDefault(); _addPendingImages(files); }
    });

    // Wave5 M2 (J6) — composer emoji picker: toggle + outside-click-to-close
    // (same pattern as the wallpaper popover; _emojiMenuOpen/_emojiOutsideClick
    // are module-level so teardownThread can clean up the document listener
    // if the panel closes while the grid is open).
    document.getElementById('chat-emoji-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      const grid = document.getElementById('chat-emoji-grid'); if (!grid) return;
      const willOpen = grid.classList.contains('hidden');
      grid.classList.toggle('hidden');
      _emojiMenuOpen = willOpen;
      if (willOpen) document.addEventListener('click', _emojiOutsideClick, true);
      else document.removeEventListener('click', _emojiOutsideClick, true);
    });
    document.getElementById('chat-emoji-grid')?.addEventListener('click', e => {
      const opt = e.target.closest('.ms-emoji-opt'); if (!opt) return;
      _insertEmojiAtCursor(input, opt.dataset.emoji);
      updateSendState(); _autoGrow(input);
      _closeEmojiGrid();
    });

    // Wave5 M2 (J6) — @mention typeahead: selecting a candidate replaces the
    // in-progress "@query" token (from chat-mention-dd's data-atPos, set by
    // _updateMentionTypeahead) with "@DisplayName " and restores focus/caret.
    document.getElementById('chat-mention-dd')?.addEventListener('click', e => {
      const opt = e.target.closest('.ms-mention-opt'); if (!opt) return;
      const dd = document.getElementById('chat-mention-dd');
      const at = parseInt(dd.dataset.atPos || '-1', 10);
      if (at < 0) return;
      const pos = input.selectionStart;
      const before = input.value.slice(0, at), after = input.value.slice(pos);
      const insertion = '@' + opt.dataset.name + ' ';
      input.value = before + insertion + after;
      const newPos = (before + insertion).length;
      input.setSelectionRange(newPos, newPos);
      input.focus();
      dd.classList.add('hidden'); dd.innerHTML = '';
      _autoGrow(input); updateSendState();
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
    // Wave5 M1 (J2) — optimistic send. The composer/attachment state clears
    // IMMEDIATELY (not on confirmed success like before) and a local pending
    // bubble appears right away via _addPendingMessage; the real write still
    // happens in the background. Success is confirmed when the messages
    // snapshot echoes this clientKey (_reconcilePending, wired in
    // openConversation's onSnapshot). On failure everything the user had is
    // restored — composer text, attachment, and the per-conv draft — and the
    // pending bubble flips to a failed, tap-to-retry state (same clientKey,
    // handled by _retryPending). _isSending still serializes one send at a
    // time (Phase 63 #1's guard, unchanged) — the optimistic bubble is what
    // makes that feel instant, not a relaxation of the guard itself.
    const doSend = async () => {
      if (_isSending) return;
      const text = (input.value || '').trim();
      const file = pendingFile, link = pendingLink, images = pendingImages.slice();   // Wave5 M3 — snapshot before clearing
      const replyTo = _replyTarget;                        // Wave5 M2 — captured BEFORE clearing below
      const mentions = _computeMentions(text, conv);        // Wave5 M2
      if (!text && !file && !link && !images.length) return;
      _isSending = true;
      sendBtn.disabled = true;
      const clientKey = _newClientKey();
      const savedText = input.value, savedFilePreview = filePreview.textContent;
      input.value = ''; _autoGrow(input);
      fileInp.value = ''; pendingFile = null; pendingLink = null; pendingImages = [];
      filePreview.textContent = '';
      _replyTarget = null; _renderReplyChip();               // Wave5 M2 — clears on optimistic send, like the composer text
      document.getElementById('chat-mention-dd')?.classList.add('hidden');
      clearTimeout(_draftSaveTimer); _clearDraft(conv.id);
      updateSendState();
      _addPendingMessage({ clientKey, text, file, images, link, replyTo });
      // Wave1 P1 fix #6 — the optimistic bubble above IS the UI-complete
      // signal; the guard used to stay held until the underlying network
      // write resolved, which offline (or on a stalled upload — put() has no
      // explicit timeout here) can simply never happen, permanently freezing
      // the composer after exactly one queued message. Clearing it here lets
      // the user queue further sends immediately; clientKey dedupe
      // (_reconcilePending) still protects against any duplicate once the
      // real writes land, so this is a pure availability fix, not a
      // relaxation of what prevents double-sends.
      _isSending = false;
      updateSendState();
      try {
        await window.Chat.sendMessage({ text, file, images, link, clientKey, replyTo, mentions });
      } catch (e) {
        // v14 chat re-audit fix — canceled via the pending bubble's ✕ while
        // the send was in flight (_cancelPendingMessage): it's already gone
        // from _pending and the user has moved on, so don't resurrect the
        // composer text/attachment/draft or toast an error for a send they
        // explicitly dismissed.
        if (_canceledClientKeys.delete(clientKey)) return;
        input.value = savedText; _autoGrow(input);
        if (file) { pendingFile = file; filePreview.textContent = savedFilePreview; }
        else if (images.length) { pendingImages = images; filePreview.textContent = savedFilePreview; }
        else if (link) { pendingLink = link; filePreview.textContent = savedFilePreview; }
        if (replyTo) { _replyTarget = replyTo; _renderReplyChip(); }   // Wave5 M2 — restore reply-arm on failure too
        _saveDraft(conv.id, savedText);
        _markPendingFailed(clientKey);
        Notifs.error((e && e.message) || 'Message not sent — retry.');
        updateSendState();   // re-enables Send whenever there's still text/attachment to retry
      }
    };
    input.addEventListener('input', () => {
      _autoGrow(input); updateSendState(); window.Chat.onComposerInput();
      _updateMentionTypeahead(input, conv);   // Wave5 M2 (J6)
      if ((input.value || '').trim()) setAttachExpanded(false);   // Fix 5 — text typed collapses the ➕ expansion
      clearTimeout(_draftSaveTimer);
      _draftSaveTimer = setTimeout(() => _saveDraft(conv.id, input.value), 300);
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      // Wave1 P0 fix #2 — an IME candidate-confirm Enter (composing CJK/etc.)
      // must never fire a send — keyCode 229 is the historical fallback for
      // browsers/input methods that don't set isComposing on this event.
      if (e.isComposing || e.keyCode === 229) return;
      // Desktop (a real pointing device present) keeps Enter-to-send, Shift+
      // Enter for a newline — unchanged. Touch-only devices (no fine
      // pointer) get Return-inserts-newline like every native messaging app;
      // Send is the only way to commit there — Enter used to both block
      // multi-line composing AND, on some phone keyboards/IMEs, fire a send
      // mid-composition.
      const isDesktop = !!(window.matchMedia && window.matchMedia('(pointer:fine)').matches);
      if (!isDesktop || e.shiftKey) return;   // let Enter insert a newline
      e.preventDefault();
      doSend();
    });
    sendBtn.addEventListener('click', doSend);

    // Wave1 P0 fix #1 — force the keyboard-offset CSS var back to 0 on blur
    // too (not just the visualViewport 'resize' the keyboard's own close
    // normally fires), so a blur that races ahead of — or instead of — that
    // resize event never leaves the composer permanently lifted.
    input.addEventListener('blur', () => {
      document.documentElement.style.setProperty('--kb-offset', '0px');
      if (_threadPanelEl) _threadPanelEl.style.bottom = '0px';
    });

    // Wave5 M1 (J7) — scroll-to-bottom FAB: appears >300px up, badge tallies
    // messages that arrived while scrolled up (_renderThread), tap smooth-
    // scrolls to bottom and clears the tally.
    document.getElementById('chat-thread-scroll')?.addEventListener('scroll', _onThreadScroll, { passive: true });
    document.getElementById('chat-scroll-fab')?.addEventListener('click', () => {
      const scrollEl = document.getElementById('chat-thread-scroll');
      if (!scrollEl) return;
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
      _scrollFabUnseen = 0;
      _updateScrollFab(scrollEl);
    });

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
  // Wave1 P1 fix #7 / P2 fix #17 — shared "is the reader at/near the bottom
  // of the thread" check (same 60px threshold _renderThread's own atBottom
  // calc uses), reused by the read-receipt gate, the image-decode re-snap,
  // and the keyboard/viewport re-snap below.
  function _isNearBottomEl(el) {
    return !!el && (el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }
  function _onViewportResize() {
    const vv = window.visualViewport; if (!vv) return;
    const panel = _threadPanelEl; if (!panel || !panel.isConnected) return;   // openPage-returned panel (Phase2b #3)
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    // Wave1 P0 fix #1 — CSS var instead of a plain inline `bottom` write: the
    // phone chat-fullscreen rule (styles.css) used to pin `bottom:0!important`
    // unconditionally, which a plain inline style write can't reliably beat
    // on every engine, hiding the composer behind the open keyboard. The CSS
    // rule now reads `bottom:var(--kb-offset,0)!important`, so this var is
    // the real source of truth on phone; the direct inline write right after
    // still covers desktop/tablet, where that !important rule never applies.
    document.documentElement.style.setProperty('--kb-offset', offset + 'px');
    panel.style.bottom = offset + 'px';
    const scroll = document.getElementById('chat-thread-scroll');
    // Wave1 P2 fix #17 — only re-pin to the bottom if the reader was ALREADY
    // there before the keyboard/viewport change; otherwise this silently
    // yanked anyone scrolled up reading older history back down every time
    // the soft keyboard opened or closed.
    if (scroll && _isNearBottomEl(scroll)) scroll.scrollTop = scroll.scrollHeight;
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
  // Messenger restyle Fix 4 — the wallpaper trigger moved from a header ⋮
  // popover into an inline expand/collapse row inside the info page's About
  // section (see _openMediaTab's #chat-about-wallpaper-btn/-list wiring), so
  // the old outside-click popover machinery (_wpOutsideClick/_closeWallpaperMenu)
  // is gone — an inline row inside an already-scrollable page doesn't need
  // its own dismiss-on-outside-click handling.

  // Wave5 M4 (J9) — single-conversation readAt resolution for the "New
  // messages" divider on thread-open. Prefers the denormalized field already
  // on `conv`; only reaches for the readers subcollection (ONE get, not a
  // loop) when that's absent.
  async function _myReadAtForOpen(convId, conv) {
    const own = conv && conv.reads && conv.reads[currentUser.uid];
    if (own && typeof own.toMillis === 'function') return own.toMillis();
    try {
      const s = await db.collection('conversations').doc(convId).collection('readers').doc(currentUser.uid).get();
      return s.exists ? (s.data().readAt?.toMillis?.() || 0) : 0;
    } catch (_) { return 0; }
  }
  async function openConversation(convId, preloaded) {
    let conv = preloaded || null;
    if (!conv) {
      const snap = await db.collection('conversations').doc(convId).get().catch(() => null);
      if (!snap || !snap.exists) { Notifs.showToast('Conversation not found', 'error'); return; }
      conv = { id: snap.id, ...snap.data() };
    }
    teardownThread();                       // defensive idempotent reset
    // v14 Phase2b — _buildThreadPanel (via openPage's opts.replace path, when
    // switching straight from one open thread to another) can synchronously
    // re-invoke teardownThread() a second time from INSIDE this call (see
    // openPage's doReplace branch, which calls the outgoing panel's onClose
    // before this function returns). teardownThread() unconditionally nulls
    // _openConvId/_openConv, so they're assigned AFTER _buildThreadPanel
    // returns — assigning before would let that nested call clobber them
    // right back to null for the conversation we're about to open.
    _buildThreadPanel(conv);
    _openConvId = convId; _openConv = conv;
    // Wave5 M4 (J9) — capture "my readAt" preferring the denormalized
    // conv.reads.{uid} (zero extra reads — it rode in on `conv` itself,
    // whether that came from the inbox's live listener or the direct get()
    // above). Only when THAT'S absent (a conv doc that predates this batch,
    // or one this uid has genuinely never opened) does this fall back to a
    // SINGLE own-reader-doc get — not the old per-conversation-in-the-INBOX
    // loop (_refreshMyReads, deleted this batch), just one read for the ONE
    // conversation actually being opened. Must be captured BEFORE _markRead()
    // below overwrites my own readAt to "now". Frozen for the whole time this
    // thread stays open — it's a one-time "where was I" boundary, not a
    // live-recomputed value (see _renderThread's initial-scroll gating and
    // the divider note in _threadHtml).
    _threadOpenReadAtMs = await _myReadAtForOpen(convId, conv);
    _threadInitialScrollDone = false;
    _scrollFabUnseen = 0;
    _pending.forEach(_revokePendingPreviews);
    _pending = [];
    _replyTarget = null;   // Wave5 M2 — a reply armed in a PREVIOUS thread never leaks into this one
    _initialMarkReadPending = true;   // Wave1 P1 fix #7 — see the messages listener below
    _refreshUsersCache().then(() => {
      _renderThread();   // backfills avatar photos once cached
      // Wave1 P2 fix #14 — the header avatar is built once, synchronously, in
      // _buildThreadPanel (before this cache resolves); if it was cold at
      // that moment the DM header still showed plain initials with no photo/
      // color. Patch it live now that the cache is warm, same convId guard
      // every other post-await touch in this function uses.
      if (conv.type === 'dm' && _openConvId === convId) {
        const otherUid = (conv.participants || []).find(u => u !== currentUser.uid);
        const info = _authorInfo(otherUid, (conv.participantNames && conv.participantNames[otherUid]) || 'User');
        const avatarEl = document.getElementById('chat-thread-avatar');
        if (avatarEl && info.photoUrl && !avatarEl.querySelector('img')) {
          avatarEl.innerHTML = `<img src="${escHtml(info.photoUrl)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`;
        }
      }
    });
    const ref = db.collection('conversations').doc(convId);
    _threadUnsubs.push(ref.collection('messages')
      .orderBy('createdAt', 'desc').limit(PAGE_SIZE)
      .onSnapshot(s => {
        _msgs = s.docs.map(d => ({ id: d.id, ...d.data(), _snap: d })).reverse();
        _reconcilePending();     // drop any optimistic bubble the snapshot just echoed back
        _renderThread();
        // Wave1 P1 fix #7 — the old unconditional _markRead()/_clearChatNotifs()
        // right after wiring these listeners (below, now removed) fired the
        // instant openConversation() was called, even if the user backed out
        // before anything ever painted. Defer that ONE-TIME initial mark-read
        // to the thread's actual first paint (this callback); every snapshot
        // after that goes through the normal atBottom-gated _scheduleMarkRead.
        if (_initialMarkReadPending && _openConvId === convId) {
          _initialMarkReadPending = false;
          _markRead(); _clearChatNotifs(convId);
        } else {
          _scheduleMarkRead();
        }
      }, err => {
        // Wave1 P2 fix #16 — this was a silent no-op: a terminal listener
        // error (rules change mid-session, corrupted offline cache, etc.)
        // used to leave the thread frozen on stale data with no signal at all.
        console.error('[chat] messages listener error', err);
        Notifs.showToast('Lost connection to this chat — reopen it to retry.', 'error');
      }));
    _threadUnsubs.push(ref.collection('readers')
      .onSnapshot(s => { _readers = s.docs.map(d => d.data()); _renderThread(); },
        err => console.error('[chat] readers listener error', err)));
    _threadUnsubs.push(ref.collection('typing')
      .onSnapshot(s => { _typing = s.docs.map(d => d.data()); _renderTypingRow(); },
        err => console.error('[chat] typing listener error', err)));
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
    // Wave5 M4 (J9) — ALSO denormalize onto the conv doc itself (reads.{uid}),
    // so the inbox's unread state/counts never need a per-conversation
    // readers-doc get. Own-key dot-path write — matches the deployed rule's
    // "reads alone" disjunct (firestore.rules ~line 413-418) exactly.
    if (_openConv) {
      // Optimistic local echo so the inbox (visible simultaneously in the
      // desktop two-pane layout) reflects "read" immediately, not just once
      // the snapshot round-trips — same pattern _setWallpaper uses for
      // conv.wallpaper. A plain object with .toMillis() mimics enough of the
      // Firestore Timestamp interface for _myReadAtMs to consume it.
      _openConv.reads = _openConv.reads || {};
      _openConv.reads[currentUser.uid] = { toMillis: () => Date.now() };
    }
    db.collection('conversations').doc(_openConvId)
      .update({ [`reads.${currentUser.uid}`]: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(() => {});
    _renderInbox();
  }
  function _scheduleMarkRead() {            // debounce: at most one receipt per 2s of arrivals
    if (_markReadTimer) return;
    _markReadTimer = setTimeout(() => {
      _markReadTimer = null;
      // Wave1 P1 fix #7 — only mark-read while the reader is actually AT the
      // bottom of the thread (same threshold _renderThread's own atBottom
      // calc uses). A message that arrives while the reader is scrolled UP
      // into older history must not be silently marked seen just because a
      // snapshot happened to fire — _onThreadScroll (below) re-schedules
      // this once they actually scroll back down to it.
      if (_isNearBottomEl(document.getElementById('chat-thread-scroll'))) _markRead();
    }, 2000);
  }
  async function _clearChatNotifs(convId) { // mark (not delete) my pending chat notifs read
    try {
      const snap = await db.collection('notifications').doc(currentUser.uid)
        .collection('items').where('chatId', '==', convId).get();
      await Promise.all(snap.docs.filter(d => !d.data().read)
        .map(d => d.ref.update({ read: true })));
    } catch (_) {}
  }

  // ── Wave5 M3 (J4) — client-side image compression. Ported from
  // quote-builder-v2.html's compressPhoto (~line 2668; that file is NOT
  // touched by this batch — this is an independent copy) with THIS batch's
  // own params per spec: 1600px long edge / JPEG q=0.85 (the reference uses
  // 1400px/0.82 for its own use case). Resolves { blob, width, height } —
  // width/height are the POST-compression pixel dimensions, stored on the
  // media doc (media[].w/.h) for grid-aspect rendering. Mirrors the
  // reference's own skip rule (non-images, and images already under 300KB,
  // pass through untouched with null w/h) and its failure fallback (an
  // undecodable image, e.g. some HEIC the browser can't draw, still resolves
  // with the ORIGINAL file rather than rejecting — the upload proceeds with
  // the uncompressed original instead of losing the attachment entirely).
  function _compressImage(file) {
    return new Promise(resolve => {
      if (!file || !/^image\//.test(file.type || '') || file.size < 300 * 1024) {
        resolve({ blob: file, width: null, height: null }); return;
      }
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const maxDim = 1600;
          if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale); height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          canvas.toBlob(blob => resolve({ blob: blob || file, width, height }), 'image/jpeg', 0.85);
        };
        img.onerror = () => resolve({ blob: file, width: null, height: null });
        img.src = e.target.result;
      };
      reader.onerror = () => resolve({ blob: file, width: null, height: null });
      reader.readAsDataURL(file);
    });
  }

  // v14 chat re-audit fix — bounded-retry helper for the conv-doc preview
  // bump (see sendMessage below). 2 retries with linear backoff, then logs
  // and gives up — never throws (the caller awaits this, but the message
  // itself is already sent by the time it's called).
  async function _bumpConvPreview(convId, payload) {
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        await db.collection('conversations').doc(convId).update(payload);
        return;
      } catch (e) {
        if (attempt === 2) {
          console.error('[chat] conversation preview/read-receipt bump failed after retries — ' +
            'inbox preview, sort order, and the sender\'s own read receipt may be stale for conv', convId, e);
          return;
        }
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }

  // ── Send (message add → parent preview bump → own receipt → notify) ──
  // Wave5 M2 — factored to accept an EXPLICIT `conv` (used by Forward to write
  // into a conversation that may not be the one currently open) instead of
  // always reading module-state `_openConv`. Every M1 call site (doSend,
  // _retryPending) omits `conv`, so `conv = convParam || _openConv` keeps
  // their behavior byte-identical — this is purely additive. The one place
  // this changes existing behavior: `_markRead()`/`_clearOwnTyping()` used to
  // run unconditionally after every send; they're now gated on
  // `conv.id === _openConvId`, because for a Forward target that ISN'T the
  // open thread, "mark MY read receipt" / "clear MY typing beacon" would be
  // writing into the wrong conversation's subcollections. For every M1 caller
  // conv.id === _openConvId is always true (conv came from _openConv itself),
  // so nothing changes for them.
  async function sendMessage({ text, file, images, link, clientKey, replyTo, forwardedFrom, mentions,
                                conv: convParam, fileUrl: preFileUrl, fileName: preFileName, fileSource: preFileSource,
                                media: preMedia }) {
    const conv = convParam || _openConv; if (!conv) return;
    const FV = firebase.firestore.FieldValue;
    let fileUrl = null, fileName = null, fileSource = null, media = null;
    if (images && images.length) {
      // Wave5 M3 (J4) — multi-photo: compress EACH image (1600px/0.85, see
      // _compressImage), upload in parallel, and write ONE message carrying
      // media:[{url,name,w,h}] — never fileUrl. Cap (6/message) is already
      // enforced by the composer (_addPendingImages); re-sliced here too as a
      // defensive floor in case a future caller (e.g. a retry path) doesn't.
      // A failure on ANY photo throws so the WHOLE optimistic bubble
      // fails/retries as one unit — same "throw, don't silently drop" rule
      // Phase 63 #1 established for the single-file path below.
      try {
        media = await Promise.all(images.slice(0, 6).map(async (f, i) => {
          const { blob, width, height } = await _compressImage(f);
          const safeName = (f.name || 'photo').replace(/\.[^./\\]+$/, '');
          const sref = storage.ref(`chat-files/${conv.id}/${Date.now()}_${i}_${safeName}.jpg`);
          await sref.put(blob, { customMetadata: { uploadedBy: (window.currentUser && currentUser.uid) || '' } });
          const url = await sref.getDownloadURL();
          return { url, name: f.name || 'photo', w: width || null, h: height || null };
        }));
      } catch (_) {
        throw new Error('Photo upload failed — message not sent.');
      }
    } else if (file) {
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
    } else if (preMedia && preMedia.length) {
      // Wave5 M3 (Forward of a media message) — reuse the ALREADY-uploaded
      // photo URLs by reference, mirroring preFileUrl's reuse below. No
      // re-upload, no duplicate Storage objects.
      media = preMedia;
    } else if (preFileUrl) {
      // Wave5 M2 (Forward) — reuse an ALREADY-uploaded/-linked attachment by
      // reference (the forwarded message's own fileUrl/fileName/fileSource);
      // no re-upload, no duplicate Storage object.
      fileUrl = preFileUrl; fileName = preFileName || null; fileSource = preFileSource || null;
    }
    const msgDoc = {
      text: text || '', authorId: currentUser.uid, authorName: _myName(),
      fileUrl: fileUrl || null, fileName: fileName || null, fileSource: fileSource || null,
      clientKey: clientKey || null,   // Wave5 M1 (J2) — lets _reconcilePending match this doc to its optimistic bubble
      createdAt: FV.serverTimestamp()
    };
    // Wave5 M2/M3 — new fields are OMITTED entirely (not even written as null)
    // when absent, so every doc written before this batch, and every doc
    // written by this batch without a reply/forward/mention/media, is
    // byte-for-byte the same shape as before. The renderer's `m.replyTo &&` /
    // `m.forwardedFrom &&` / `(m.mentions||[]).length` / `m.media &&` guards
    // (see _renderMessagePart) are what make that safe to render identically
    // either way — this is the backward-compat contract, not just an
    // optimization.
    if (replyTo) msgDoc.replyTo = { mid: replyTo.mid, author: replyTo.author, snippet: replyTo.snippet };
    if (forwardedFrom) msgDoc.forwardedFrom = { convId: forwardedFrom.convId, authorName: forwardedFrom.authorName };
    if (mentions && mentions.length) msgDoc.mentions = mentions;
    if (media && media.length) msgDoc.media = media;
    await db.collection('conversations').doc(conv.id).collection('messages').add(msgDoc);
    // v14 chat re-audit fix — the Shared Media page (_openMediaTab) now
    // caches its up-to-500-message fetch; invalidate that cache key eagerly
    // when THIS message carries an attachment so opening Shared Media right
    // after sending a photo/file shows it immediately instead of waiting out
    // the TTL.
    if (((media && media.length) || fileUrl) && typeof dbCacheInvalidate === 'function') {
      dbCacheInvalidate('chat-media-' + conv.id);
    }
    // Notif/preview text sink — PLAIN emoji only, never emojiIcon() (which
    // returns `<i data-lucide>` HTML markup): this string lands in
    // conv.lastMessageText (rendered via escHtml, a plain-text sink — see
    // _renderInbox) AND in the push-notification body (Notifs.send below),
    // neither of which interprets HTML. Wave5 M3 also fixes the pre-existing
    // link/file branches here to match (they previously called emojiIcon(),
    // which would have shown literal "<i data-lucide...>" text — see the
    // MEMORY.md "emojiIcon plain-text sinks" note this batch was told to
    // respect for its OWN new media branch; the adjacent branches are the
    // same line, so fixed alongside rather than left inconsistent).
    const preview = text ? (text.length > 80 ? text.slice(0, 80) + '…' : text)
                         : media && media.length ? `📷 ${media.length > 1 ? media.length + ' photos' : 'Photo'}`
                         : fileSource === 'link' ? '🔗 Link'
                         : `📎 ${fileName || 'File'}`;
    // Second write — passes the affectedKeys([lastMessage*,reads]) member
    // branch. Wave5 M4 (J9): the sender's own reads.{uid} rides in the SAME
    // write as the preview bump — the deployed rule requires exactly that
    // pairing (or reads alone), never reads alongside anything else
    // (firestore.rules ~line 413-418). Sending a message implies you've read
    // up to your own message, so this keeps the sender's own row from ever
    // showing as unread to themself.
    //
    // v14 chat re-audit fix — this used to be a bare `.catch(() => {})`: if
    // it failed (transient error, offline flap) the message doc above had
    // already landed, so it'd be visible in the thread, but every
    // participant's inbox preview/sort order AND the sender's own read
    // receipt would silently go stale forever, with no retry and nothing
    // logged. _bumpConvPreview retries a couple of times with backoff before
    // giving up, and logs a final failure instead of swallowing it — still
    // fire-and-forget from the UI's perspective (the send itself already
    // succeeded once the message doc write above landed).
    await _bumpConvPreview(conv.id, {
      lastMessageAt: FV.serverTimestamp(), lastMessageText: preview,
      lastMessageBy: currentUser.uid, lastMessageByName: _myName(),
      [`reads.${currentUser.uid}`]: FV.serverTimestamp()
    });
    if (conv.id === _openConvId) { _markRead(); _clearOwnTyping(); }
    _notifyRecipients(conv, preview, mentions);       // fire-and-forget
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
  // Wave5 M2 (J6) — `mentions` (the uids the message @-tagged) BYPASS both the
  // READ_FRESH skip and the 60s NOTIF_THROTTLE: a mention is an explicit
  // "you, specifically" summon and must always land, even if the recipient
  // just read the thread or was already notified for this conversation in
  // the last minute. Non-mentioned recipients keep the exact M1 behavior.
  // Note: `_readers` is only ever populated for the CURRENTLY OPEN thread
  // (module-state, one listener). For a Forward send to a conv that isn't
  // open, `_readers.find` simply won't match any of that conv's uids, so the
  // READ_FRESH short-circuit is a no-op there and every non-mentioned target
  // falls through to the normal throttle check — i.e. it degrades to "notify
  // as usual," never to "silently skip." Full read-state for non-open
  // conversations is M4's reads-denormalization work, out of scope here.
  // v14 chat re-audit fix — was a sequential `for...await` loop, serializing
  // one Firestore write per recipient. Each recipient's send is already
  // independent and fire-and-forget from THIS function's own caller
  // (sendMessage doesn't await _notifyRecipients at all), so there was no
  // ordering requirement being preserved, only wall-clock latency being
  // lost. Promise.all parallelizes them; every per-uid skip rule (mute/
  // read-fresh/throttle) and the throttle-stamp timing (all read the SAME
  // `now` captured once, same as before) are unchanged.
  async function _notifyRecipients(conv, preview, mentions) {
    const byMembership = await _targetsFor(conv);
    // Wave1 P1 fix #9 — @mention must be AUTHORITATIVE for delivery: someone
    // explicitly tagged (e.g. the president mentioned in a dept channel they
    // don't belong to per _targetsFor's membership rule) still gets notified,
    // even though they'd otherwise never be in the by-membership target set.
    const targets = Array.from(new Set([...byMembership, ...(mentions || [])]));
    const mentionSet = new Set(mentions || []);
    const now = Date.now();
    const label = conv.type === 'dm' ? _myName() : (conv.name || conv.department || 'Chat');
    await Promise.all(targets.map(async uid => {
      if (uid === currentUser.uid) return;
      // Wave5 M4 (J7) — a recipient who has muted THIS conversation (own-key
      // mutedBy.{uid}, see _toggleConvFlag) gets no in-app notification at
      // all, checked BEFORE the mention/throttle logic — muting is an
      // explicit "don't tell me" a mention shouldn't override. Once
      // functions/index.js consults the same mutedBy map (main session, this
      // batch), this exact suppression carries through to push too.
      if (conv.mutedBy && conv.mutedBy[uid]) return;
      const isMentioned = mentionSet.has(uid);
      if (!isMentioned) {
        const r = _readers.find(x => x.uid === uid);        // live snapshot — zero extra reads
        if (r && r.readAt?.toMillis && (now - r.readAt.toMillis()) < READ_FRESH_MS) return;
        const k = `${conv.id}_${uid}`;
        if (_notifLastSent[k] && (now - _notifLastSent[k]) < NOTIF_THROTTLE_MS) return;
      }
      _notifLastSent[`${conv.id}_${uid}`] = now;
      await Notifs.send(uid, {
        title: `💬 ${label}`,
        body: isMentioned ? `${_myName()} mentioned you: ${preview}` : `${_myName()}: ${preview}`,
        icon: '💬', type: 'chat_message', chatId: conv.id }).catch(() => {});
    }));
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
    // Wave1 P2 fix #16 — debounced idle-stop: every keystroke re-arms a timer
    // that clears the beacon once the user simply STOPS typing (matches
    // TYPING_TTL_MS, the same window readers already use to consider a
    // beacon stale for display) instead of leaving the Firestore doc to rot
    // until some OTHER trigger (send/blur/panel-close/tab-hide) clears it.
    if (_openConvId) {
      clearTimeout(_typingIdleTimer);
      _typingIdleTimer = setTimeout(_clearOwnTyping, TYPING_TTL_MS);
    }
    if (!_openConvId || now - _lastTypingWrite < TYPING_WRITE_MS) return;
    _lastTypingWrite = now;
    db.collection('conversations').doc(_openConvId).collection('typing').doc(currentUser.uid)
      .set({ uid: currentUser.uid, name: _myName(),
             at: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
  }
  function _clearOwnTyping() {
    if (_typingIdleTimer) { clearTimeout(_typingIdleTimer); _typingIdleTimer = null; }
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
    const anchor = (_earlier[0] || _msgs[0]);
    // v14 chat re-audit fix — no anchor at all means nothing to page before
    // (empty/just-opened thread); flag exhausted so the lightbox's
    // load-more branch (below) doesn't keep retrying a no-op every swipe.
    if (!anchor || !anchor._snap) { _earlierExhausted = true; return; }
    const s = await db.collection('conversations').doc(_openConvId).collection('messages')
      .orderBy('createdAt', 'desc').startAfter(anchor._snap).limit(PAGE_SIZE).get()
      .catch(() => ({ docs: [] }));
    // v14 chat re-audit fix — a short page (fewer than PAGE_SIZE docs back)
    // means this WAS the last of the history; the lightbox's "swipe past the
    // oldest loaded photo" handler (_openLightbox's go()) uses this to know
    // when a wrap is really the end vs. just unfetched history.
    _earlierExhausted = s.docs.length < PAGE_SIZE;
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
    // Wave1 P1 fix #8 — a message that quotes another (m.replyTo) must be
    // re-rendered whenever the QUOTED ORIGINAL's own live state changes
    // (edited text, or tombstoned by unsend) — otherwise _patchThread's own
    // diff (based purely on THIS message's own fields, none of which changed)
    // would leave a stale quote in the DOM even though _replyQuoteHtml would
    // compute a fresh one if it actually re-ran. Folding the original's
    // current text/tombstone state into THIS row's rev hash forces exactly
    // that re-render the moment it changes.
    let q = '';
    if (m.replyTo) {
      const orig = _earlier.find(x => x.id === m.replyTo.mid) || _msgs.find(x => x.id === m.replyTo.mid);
      if (orig) q = '|q:' + (orig.deleted ? 'x' : (orig.text || '').slice(0, 80));
    }
    return JSON.stringify(m.reactions || {}) + '|' + (m.text || '') + '|' +
      (m.deleted ? 1 : 0) + '|' + (m.editedAt ? 1 : 0) + '|' + (m.fileUrl || '') + '|' +
      JSON.stringify(m.media || []) + q;
    // replyTo/forwardedFrom/mentions THEMSELVES deliberately excluded — like
    // createdAt/authorId, they're set once at message CREATE and never
    // mutated by any update() in this file, so they can never change for an
    // existing id (only the message they POINT AT can change — handled above).
    // media is included alongside fileUrl (Wave5 M3) — both DO mutate once,
    // on unsend (_onDeleteMessage sets both to null), so both need to be in
    // the hash for that one transition to be detected by _patchThread.
  }

  // Wave1 P1 fix #8 — a reply quote used to freeze the ORIGINAL message's
  // snippet forever at reply-send-time (replyTo.snippet, stored once on the
  // NEW message doc): editing or unsending the original afterward left every
  // quote of it showing the stale/deleted content forever — defeating unsend
  // outright (an "unsent" message's text kept living on in anyone's reply
  // quote of it). Re-resolves the original's LIVE state on every render:
  // current text if it's still in the loaded _earlier/_msgs window, "Original
  // message removed" if it's been tombstoned, or the frozen snapshot as a
  // last resort if the original has scrolled out of the loaded window
  // entirely (same constraint _scrollToMessage already has for jumping to it).
  function _resolveReplyQuote(replyTo) {
    const orig = _earlier.find(x => x.id === replyTo.mid) || _msgs.find(x => x.id === replyTo.mid);
    if (!orig) return { author: replyTo.author, snippet: replyTo.snippet, removed: false };
    if (orig.deleted) return { author: replyTo.author, snippet: '', removed: true };
    const live = orig.text || orig.fileName || ((orig.media && orig.media.length) ? 'Photo' : 'Attachment');
    return { author: replyTo.author, snippet: (live || '').slice(0, 80), removed: false };
  }
  // Wave5 M2 (J3) — shared by both the real-message renderer (_renderMessagePart)
  // and the optimistic pending bubble (_renderPendingBubble), so a reply rides
  // the SAME quote markup whether the doc has landed yet or not. `replyTo` is
  // `{mid, author, snippet}` — absent (undefined/null) on every message that
  // isn't a reply, in which case this renders nothing (backward-compat: old
  // docs, and non-reply new docs, are unaffected).
  function _replyQuoteHtml(replyTo) {
    if (!replyTo) return '';
    const r = _resolveReplyQuote(replyTo);
    return `<div class="ms-reply-quote" data-target-mid="${escHtml(replyTo.mid || '')}">
      <div class="ms-reply-quote-author">${escHtml(r.author || '')}</div>
      <div class="ms-reply-quote-snippet${r.removed ? ' ms-reply-quote-removed' : ''}">${r.removed ? 'Original message removed' : escHtml(r.snippet || '')}</div>
    </div>`;
  }
  // Wave5 M2 (J6) — highlights @mentions in an ALREADY-escHtml'd string. Takes
  // the message's `mentions:[uid]` array, resolves each uid to a display name
  // via the same _authorInfo the rest of the renderer uses, HTML-escapes that
  // name too, then does a plain substring split/join for "@EscapedName" →
  // "<span class=ms-mention>@EscapedName</span>". No RegExp, so there's no
  // metacharacter-escaping step to get wrong; it can only ever wrap text that
  // was already run through escHtml, so it cannot introduce markup that
  // wasn't already safely neutralized. Absent/empty `mentions` (every doc
  // before this batch, and any doc that isn't a mention) is a no-op passthrough.
  function _highlightMentions(escapedHtml, mentionUids) {
    if (!mentionUids || !mentionUids.length) return escapedHtml;
    let out = escapedHtml;
    mentionUids.forEach(uid => {
      const info = _authorInfo(uid, '');
      if (!info.name) return;
      const token = '@' + escHtml(info.name);
      if (out.indexOf(token) === -1) return;
      out = out.split(token).join(`<span class="ms-mention">${token}</span>`);
    });
    return out;
  }

  // Wave5 M3 (J4) — Messenger-style grid bubble for m.media[] (1=full-width,
  // 2=split, 3+=uniform grid; a "+N" overlay on the LAST shown tile when the
  // array exceeds the 6-tile display cap — the send-time cap already keeps
  // this at ≤6 for anything sent by this batch, but the render is defensive
  // regardless). Each tile is `.chat-img-tap` (data-mid + data-idx) — the
  // SAME class/attribute contract a legacy single fileUrl image uses (see the
  // caller below), so one delegated click handler (_wireThreadDelegation)
  // opens the lightbox for either shape.
  function _mediaGridHtml(m) {
    const media = m.media || [];
    if (!media.length) return '';
    const shown = media.slice(0, 6);
    const extra = media.length - shown.length;
    const cls = shown.length === 1 ? 'ms-media-1' : shown.length === 2 ? 'ms-media-2' : 'ms-media-grid3';
    const tiles = shown.map((item, i) => {
      const overlay = (i === shown.length - 1 && extra > 0) ? `<div class="ms-media-more">+${extra}</div>` : '';
      // Wave1 P2 fix #17 — reserve the tile's box from the STORED w/h
      // (captured at upload time by _compressImage) before the image itself
      // decodes, so a slow-loading photo doesn't jump the bubble/thread
      // layout once it finally paints. Only meaningful for the single-photo
      // (ms-media-1) layout — the 2+/3+ grid tiles are already a fixed
      // aspect-ratio:1 square crop in CSS regardless of source dimensions.
      // Number.isFinite guard (not just truthiness) — these values ride in
      // on a Firestore doc written by whoever authored the message, so a
      // non-numeric w/h must never be interpolated straight into an inline
      // style attribute unescaped.
      const hasWH = Number.isFinite(item.w) && Number.isFinite(item.h) && item.w > 0 && item.h > 0;
      const ratioStyle = (shown.length === 1 && hasWH) ? ` style="aspect-ratio:${item.w}/${item.h}"` : '';
      return `<div class="ms-media-tile"${ratioStyle}>
        <img class="chat-img-tap" data-mid="${escHtml(m.id)}" data-idx="${i}" src="${safeHttpUrl(item.url)}" alt="${escHtml(item.name || 'photo')}" loading="lazy"/>
        ${overlay}
      </div>`;
    }).join('');
    return `<div class="ms-media-grid ${cls}" style="margin-top:${m.text ? '6' : '0'}px">${tiles}</div>`;
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
    // Wave1 P2 fix #11 — the LAST bubble of a cluster (ms-grp-last/-single)
    // always shows a resting timestamp instead of relying purely on tap-to-
    // reveal/hover; mid-cluster bubbles (ms-grp-first/-mid) stay tap-to-
    // reveal, unchanged. A separate class from the tap-toggled `ms-time-shown`
    // (see _wireThreadDelegation) — both simply OR together in CSS — so a tap
    // on a resting-timestamp bubble still toggles its OWN state independently
    // without ever hiding the resting one.
    const isClusterLast = grpClass === 'ms-grp-last' || grpClass === 'ms-grp-single';

    const isMine = m.authorId === currentUser.uid;
    const info = _authorInfo(m.authorId, m.authorName);
    const isTombstone = !!m.deleted;                    // Wave5 M1 (J3)
    const canEdit = isMine && !isTombstone;
    const canDelete = (isMine || _isAdminRole()) && !isTombstone;
    const canHardDelete = _isAdminRole();                // admin-only "Remove permanently", live or already-tombstoned
    // gesture-conflict fix 2026-08 — .ms-actions below is CSS hover-revealed
    // (desktop only, see styles.css .ms-actions/.ms-row:hover .ms-actions).
    // Touchscreens have no real :hover — mobile Safari/Chrome "stick" the
    // hover state after a tap until the user taps elsewhere, so this row
    // appeared as permanent clutter under every bubble. On touch UIs these
    // buttons move into the long-press picker instead (touchActionsHtml
    // below, folded into pickerHtml) — same classes, so the existing
    // class-based click delegation in _wireThreadDelegation wires them for
    // free with no new handlers.
    const isTouchUI = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
    const touchActionsHtml = isTouchUI && (canEdit || canDelete || canHardDelete)
      ? `<span style="display:inline-flex;gap:4px;border-left:1px solid var(--border);padding-left:6px;margin-left:2px">${
          canEdit ? `<button class="ms-act-btn chat-msg-edit-btn" data-mid="${escHtml(m.id)}">${emojiIcon('✎',16)}</button>` : ''
        }${
          canDelete ? `<button class="ms-act-btn ms-del-btn chat-msg-del-btn" data-mid="${escHtml(m.id)}" title="Remove for everyone">${emojiIcon('trash-2',14)}</button>` : ''
        }${
          canHardDelete ? `<button class="ms-act-btn ms-del-btn chat-msg-harddel-btn" data-mid="${escHtml(m.id)}" title="Remove permanently">${emojiIcon('trash',14)}</button>` : ''
        }</span>`
      : '';
    const d = m.createdAt?.toDate ? m.createdAt.toDate() : null;
    const timeLabel = d ? d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', timeZone: window.BIZ_TZ }) : '';
    const rev = _msgRev(m);

    // Wave5 M1 (J3) — tombstone: italic "Message removed", no reactions/
    // picker/copy-affordance (none of those classes are emitted below, so
    // long-press/tap/double-tap on this bubble is a no-op —
    // _wireThreadDelegation's .closest('.chat-bubble-tap') simply finds
    // nothing here). Only an admin's "Remove permanently" action survives on
    // a tombstone.
    if (isTombstone) {
      const row = `
      <div class="ms-row ${isMine?'ms-row-mine':'ms-row-theirs'} ${grpClass}" data-mid="${escHtml(m.id)}" data-rev="${escHtml(rev)}">
        ${!isMine ? (showAvatar
            ? `<div class="ms-avatar" title="${escHtml(info.name)}">${info.photoUrl?`<img src="${escHtml(info.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:initials(info.name)}</div>`
            : `<div class="ms-avatar-spacer"></div>`) : ''}
        <div class="ms-bubble-wrap">
          ${!isMine && showName ? `<div class="ms-name">${escHtml(info.name)}</div>` : ''}
          <div class="ms-bubble-row">
            <div class="ms-bubble ms-bubble-tombstone ${isMine?'ms-bubble-mine':'ms-bubble-theirs'} ${grpClass}" data-mid="${escHtml(m.id)}">
              <div class="ms-text ms-tombstone-text">Message removed</div>
              <div class="ms-meta" style="display:flex"><span class="ms-time">${timeLabel}</span></div>
            </div>
          </div>
          ${canHardDelete ? `<div class="ms-actions" style="display:flex"><button class="ms-act-btn ms-del-btn chat-msg-harddel-btn" data-mid="${escHtml(m.id)}" title="Remove permanently">${emojiIcon('trash',14)}</button></div>` : ''}
        </div>
      </div>`;
      return { sep, row };
    }

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
    // Wave5 M1 (J3) — Copy joins the SAME long-press/context-menu picker as
    // the reactions (opened by _openPickerFor via startPress/contextmenu on
    // .chat-bubble-tap — unchanged), rather than a new menu.
    // Wave5 M2 — Forward joins the same picker (same long-press/right-click
    // reach, desktop AND mobile, so no separate hover-only affordance needed).
    const pickerHtml = `<div class="chat-reaction-picker" data-mid="${escHtml(m.id)}" style="display:none;gap:4px;margin-top:4px;align-items:center">${
      REACTIONS.map(e => `<button class="chat-pick-emoji" data-mid="${escHtml(m.id)}" data-emoji="${e}" style="font-size:16px;background:none;border:none;cursor:pointer;padding:2px 4px">${e}</button>`).join('')
    }<button class="chat-copy-btn ms-act-btn" data-mid="${escHtml(m.id)}" title="Copy" style="border-left:1px solid var(--border);padding-left:6px;margin-left:2px">${emojiIcon('copy',14)}</button><button class="chat-forward-btn ms-act-btn" data-mid="${escHtml(m.id)}" title="Forward">${emojiIcon('forward',14)}</button>${touchActionsHtml}</div>`;
    // Messenger restyle Fix 3 — the always-visible quick-heart button beside
    // every bubble is GONE (owner: single biggest clutter item). Reacting is
    // now DOUBLE-TAP the bubble = toggle ❤️ (same toggleReaction data model,
    // see _wireThreadDelegation's bubble click branch), LONG-PRESS = the full
    // 6-emoji picker above (unchanged). Reactions storage/rendering
    // (reactionsHtml above) is completely untouched — this only removes the
    // dedicated tap-target and its markup.
    // Wave5 M2 (J3) — hover-only reply button (desktop; touch uses the
    // swipe-right gesture wired in _wireThreadDelegation instead). Affordance-
    // only — no storage change here, the click handler arms _replyTarget via
    // _armReply().
    const replyBtnHtml = `<button class="ms-reply-btn" data-mid="${escHtml(m.id)}" title="Reply">${emojiIcon('corner-up-left',13)}</button>`;
    // Wave5 M2 (J3) — quote block rendered ABOVE the message content when
    // this doc carries replyTo (absent on every pre-M2 doc → renders exactly
    // as before). Tapping it scrolls-to + flashes the original (_scrollToMessage,
    // wired in _wireThreadDelegation) or toasts "Message not loaded" if the
    // original isn't in the currently-loaded window.
    const replyQuoteHtml = _replyQuoteHtml(m.replyTo);
    // Wave5 M2 (J3) — "Forwarded" label, absent on every doc without forwardedFrom.
    const forwardedHtml = m.forwardedFrom
      ? `<div class="ms-forwarded-label">${emojiIcon('forward',10)}<span>Forwarded</span></div>` : '';

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

    const row = `
      <div class="ms-row ${isMine?'ms-row-mine':'ms-row-theirs'} ${grpClass}" data-mid="${escHtml(m.id)}" data-rev="${escHtml(rev)}">
        ${!isMine ? (showAvatar
            ? `<div class="ms-avatar" title="${escHtml(info.name)}">${info.photoUrl?`<img src="${escHtml(info.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:initials(info.name)}</div>`
            : `<div class="ms-avatar-spacer"></div>`) : ''}
        <div class="ms-bubble-wrap">
          ${forwardedHtml}
          ${!isMine && showName ? `<div class="ms-name">${escHtml(info.name)}</div>` : ''}
          <div class="ms-bubble-row">
          ${isMine ? replyBtnHtml : ''}
          <div class="ms-bubble ${isMine?'ms-bubble-mine':'ms-bubble-theirs'} ${grpClass}${isClusterLast?' ms-time-rest':''} chat-bubble-tap ${isNew?'ms-pop-in':''}" data-mid="${escHtml(m.id)}">
            ${replyQuoteHtml}
            ${m.text ? `<div class="ms-text">${_highlightMentions(escHtml(m.text).replace(/\n/g,'<br/>'), m.mentions)}</div>` : ''}
            ${m.media && m.media.length ? _mediaGridHtml(m)
              : m.fileUrl ? (m.fileSource!=='link' && _isImageUrl(m.fileUrl)
                // Wave5 M3 (J1) — legacy single-image docs (fileUrl, no media[])
                // render IDENTICALLY to before (same size/radius), except the
                // click target: the old inline onclick="window.open(...)" is
                // replaced by the SAME .chat-img-tap delegated-click contract
                // the new media grid uses (data-mid + data-idx="0"), so one
                // image tap — old doc shape or new — opens the SAME in-app
                // lightbox instead of a new browser tab.
                ? `<div style="margin-top:${m.text?'6':'0'}px"><img class="chat-img-tap" data-mid="${escHtml(m.id)}" data-idx="0" src="${safeHttpUrl(m.fileUrl)}" alt="${escHtml(m.fileName||'img')}" style="max-width:200px;max-height:160px;border-radius:var(--r-sm,10px);cursor:pointer"/></div>`
                : `<a href="${safeHttpUrl(m.fileUrl)}" target="_blank" rel="noopener" class="ms-file-chip">${emojiIcon(m.fileSource==='link'?'link':'paperclip',14)}<span>${escHtml(m.fileName||'Attachment')}</span></a>`
              ) : ''}
            <div class="ms-meta">
              <span class="ms-time">${timeLabel}</span>
              ${m.editedAt?'<span class="ms-edited">(edited)</span>':''}
            </div>
          </div>
          ${!isMine ? replyBtnHtml : ''}
          </div>
          ${reactionsHtml}
          ${pickerHtml}
          ${!isTouchUI && (canEdit||canDelete||canHardDelete) ? `<div class="ms-actions">
            ${canEdit?`<button class="ms-act-btn chat-msg-edit-btn" data-mid="${escHtml(m.id)}">${emojiIcon('✎',16)}</button>`:''}
            ${canDelete?`<button class="ms-act-btn ms-del-btn chat-msg-del-btn" data-mid="${escHtml(m.id)}" title="Remove for everyone">${emojiIcon('trash-2',14)}</button>`:''}
            ${canHardDelete?`<button class="ms-act-btn ms-del-btn chat-msg-harddel-btn" data-mid="${escHtml(m.id)}" title="Remove permanently">${emojiIcon('trash',14)}</button>`:''}
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
      // Wave1 P2 fix #15 — reuse the same .empty-state markup every other
      // empty list in the app uses (inbox/notifications/tasks/etc.) instead
      // of this one-off .messenger-empty div, so a brand-new thread reads as
      // consistent chrome rather than a bespoke placeholder.
      return `<div class="empty-state"><div class="empty-icon">${emojiIcon('💬',44)}</div><h4>No messages yet</h4><p>Say hello!</p></div>`;
    }
    const showEarlierBtn = !_earlierCapped && (_earlier.length + _msgs.length) >= PAGE_SIZE;
    const isFirstRender = _lastMsgIds === null;
    const prevIds = _lastMsgIds || new Set();
    // Wave5 M1 (J7) — "New messages" divider: first message strictly newer
    // than _threadOpenReadAtMs (captured once, at open — see openConversation).
    // myReadAtMs==0 means "never read before" (brand-new/never-opened convo),
    // where a divider above message 0 would be meaningless — suppressed.
    const dividerIdx = _threadOpenReadAtMs > 0
      ? list.findIndex(m => m.createdAt?.toMillis && m.createdAt.toMillis() > _threadOpenReadAtMs)
      : -1;

    let html = _earlierCapped
      ? `<div style="text-align:center;margin-bottom:10px;font-size:11px;color:var(--text-muted)">Older messages hidden — reopen this chat to reload from the start</div>`
      : showEarlierBtn
        ? `<div style="text-align:center;margin-bottom:10px"><button class="btn-secondary btn-sm" id="chat-load-earlier-btn">↑ Load earlier</button></div>`
        : '';
    list.forEach((m, idx) => {
      const isNew = !isFirstRender && !prevIds.has(m.id);
      if (idx === dividerIdx) {
        html += `<div class="ms-new-divider" id="chat-new-divider"><span>New messages</span></div>`;
      }
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
    // Wave5 M1 — _threadOpenReadAtMs is frozen at open time, so dividerIdx
    // (if any) always falls within the shared PREFIX handled above, never in
    // this appended range; nothing extra needed here for it.
    let appendHtml = '';
    for (let i = oldOrder.length; i < list.length; i++) {
      const isNew = !prevIds.has(list[i].id);
      const { sep, row } = _renderMessagePart(list, i, isNew);
      appendHtml += sep + row;
    }
    if (appendHtml) {
      // Wave5 M1 — the pending-bubble tail container (if present) must stay
      // the LAST child of #chat-thread-scroll; insert new real messages
      // immediately before it instead of at the very end.
      const tail = document.getElementById('chat-pending-tail');
      if (tail && tail.parentElement === el) tail.insertAdjacentHTML('beforebegin', appendHtml);
      else el.insertAdjacentHTML('beforeend', appendHtml);
    }
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
  // Messenger restyle Fix 3 — LONG-PRESS (500ms) on a bubble still opens the
  // full 6-emoji picker (unchanged). The old "or the heart" branch is gone
  // along with the heart button itself.
  // touchstart/touchend timing covers mobile; mousedown/mouseup + contextmenu
  // (right-click / long-press-as-contextmenu on some browsers) covers desktop.
  const LONG_PRESS_MS = 500;
  // DOUBLE-TAP-TO-HEART decision (documented per the batch brief): a bubble
  // tap is DELAYED by DOUBLE_TAP_MS before it performs the timestamp toggle,
  // so a fast second tap on the SAME message can upgrade it into a double-tap
  // (❤️ toggle) instead. The rejected alternative — toggle the timestamp
  // instantly on tap 1 and let tap 2 toggle it right back — nets out to "no
  // visible change" for a genuine double-tap, which reads as a flicker bug
  // rather than a deliberate gesture, and can't distinguish "about to become
  // a double-tap" from "really was just one tap" ahead of time. 300ms is the
  // standard mobile double-tap window and isn't perceptible as lag for a
  // normal single tap.
  const DOUBLE_TAP_MS = 300;
  function _wireThreadDelegation(el) {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    // Wave1 P2 fix #17 — a photo that finishes decoding AFTER the initial
    // render/scroll-snap can grow the thread's scrollHeight and silently push
    // the view away from the bottom even though the reader WAS pinned there.
    // Re-snap only if they still are — never yanks someone scrolled up
    // reading history to make room for a newly-decoded image below. 'load'
    // doesn't bubble on <img>, hence the capture-phase listener here instead
    // of a plain delegated 'click'-style bind.
    el.addEventListener('load', e => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.classList.contains('chat-img-tap')) return;
      if (_isNearBottomEl(el)) el.scrollTop = el.scrollHeight;
    }, true);
    let pressTimer = null, longPressed = false, pressMid = null;
    let bubbleTapTimer = null, lastBubbleTap = { mid: null, at: 0 };   // double-tap-to-heart state
    const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    const startPress = (target, e) => {
      const holder = target.closest('.chat-bubble-tap');
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
      const holder = e.target.closest('.chat-bubble-tap');
      if (holder) { e.preventDefault(); _openPickerFor(el, holder.dataset.mid); }
    });
    // Wave5 M2 (J3) — swipe-right-to-reply, ADDITIVE alongside the long-press
    // listeners above (both sets fire off the same native touch events; this
    // one never calls stopPropagation so the long-press timer's own
    // touchmove→clearPress still runs too — any movement already meant "not a
    // long press" before this batch). Slope-guarded exactly like gestures.js's
    // own edge-swipe (DY_ABORT-style): nothing here calls preventDefault()
    // until a drag has COMMITTED to horizontal (dx dominant, rightward, past
    // an 8px noise floor) — so a vertical scroll gesture is never intercepted,
    // it just runs the browser's native scroll untouched from the first
    // pixel. gestures.js itself is not touched or reused directly (per spec);
    // this is a local re-implementation of the same slope-guard PRINCIPLE.
    el.addEventListener('touchstart', _onSwipeStart, { passive: true });
    el.addEventListener('touchmove', _onSwipeMove, { passive: false });
    el.addEventListener('touchend', _onSwipeEnd);
    el.addEventListener('touchcancel', _onSwipeEnd);
    el.addEventListener('click', e => {
      if (e.target.closest('#chat-load-earlier-btn')) { loadEarlier(); return; }
      const chip = e.target.closest('.chat-reaction-chip, .chat-pick-emoji');
      if (chip) { e.stopPropagation(); toggleReaction(chip.dataset.mid, chip.dataset.emoji); return; }
      const copyBtn = e.target.closest('.chat-copy-btn');
      if (copyBtn) { e.stopPropagation(); _copyMessage(copyBtn.dataset.mid); return; }
      const fwdBtn = e.target.closest('.chat-forward-btn');
      if (fwdBtn) { e.stopPropagation(); _openForwardPicker(fwdBtn.dataset.mid); return; }
      const replyBtn = e.target.closest('.ms-reply-btn');
      if (replyBtn) { e.stopPropagation(); _armReply(replyBtn.dataset.mid); return; }
      const editBtn = e.target.closest('.chat-msg-edit-btn');
      if (editBtn) { e.stopPropagation(); _onEditMessage(editBtn.dataset.mid); return; }
      const delBtn = e.target.closest('.chat-msg-del-btn');
      if (delBtn) { e.stopPropagation(); _onDeleteMessage(delBtn.dataset.mid); return; }
      const hardDelBtn = e.target.closest('.chat-msg-harddel-btn');
      if (hardDelBtn) { e.stopPropagation(); _onHardDeleteMessage(hardDelBtn.dataset.mid); return; }
      // Wave5 M3 (J1) — any message image (legacy single fileUrl OR a new
      // media-grid tile) opens the in-app lightbox instead of the old
      // window.open(). Checked BEFORE the generic bubble-tap-toggle below so
      // a long-press that already opened the reaction picker doesn't ALSO
      // pop the lightbox (longPressed guard, same pattern used throughout).
      const imgTap = e.target.closest('.chat-img-tap');
      if (imgTap) {
        e.stopPropagation();
        if (longPressed) { longPressed = false; return; }
        _openLightboxFor(imgTap.dataset.mid, parseInt(imgTap.dataset.idx || '0', 10));
        return;
      }
      // Messenger restyle Fix 3 — single tap toggles the timestamp/status
      // line (delayed by DOUBLE_TAP_MS, see the constant's comment above); a
      // second tap on the SAME bubble inside that window cancels the pending
      // toggle and fires a double-tap ❤️ instead (toggleReaction — identical
      // data model the old always-visible heart button used). Long-press
      // (already opened the picker) suppresses both.
      const bubble = e.target.closest('.chat-bubble-tap');
      if (bubble) {
        if (e.target.closest('a') || e.target.closest('img')) return;
        // Wave5 M2 (J3) — tapping the quoted-reply block scrolls to (+
        // flashes) the original instead of toggling the timestamp line.
        const quote = e.target.closest('.ms-reply-quote');
        if (quote) { _scrollToMessage(quote.dataset.targetMid); return; }
        if (longPressed) { longPressed = false; return; }
        const mid = bubble.dataset.mid;
        const now = Date.now();
        if (bubbleTapTimer && lastBubbleTap.mid === mid && (now - lastBubbleTap.at) < DOUBLE_TAP_MS) {
          clearTimeout(bubbleTapTimer); bubbleTapTimer = null;
          lastBubbleTap = { mid: null, at: 0 };
          toggleReaction(mid, '❤️');
          _flashHeartBurst(bubble);
          return;
        }
        lastBubbleTap = { mid, at: now };
        clearTimeout(bubbleTapTimer);
        bubbleTapTimer = setTimeout(() => {
          bubbleTapTimer = null;
          // Re-query rather than close over `bubble`: a snapshot repaint
          // (reaction/edit/etc.) can swap the underlying node's outerHTML
          // (see _patchThread) inside this window on a busy thread.
          const fresh = el.querySelector(`.chat-bubble-tap[data-mid="${CSS.escape(mid)}"]`);
          if (fresh) fresh.classList.toggle('ms-time-shown');
        }, DOUBLE_TAP_MS);
      }
    });
  }
  // Messenger restyle Fix 3 — brief floating ❤️ burst on a successful
  // double-tap-to-like: purely cosmetic feedback (no storage, no state),
  // mirrors the animation-driven cleanup pattern already used elsewhere in
  // this file (e.g. the "tap the quote to jump there" .ms-flash timeout).
  function _flashHeartBurst(bubbleEl) {
    if (!bubbleEl) return;
    const burst = document.createElement('span');
    burst.className = 'ms-heart-burst';
    burst.textContent = '❤️';
    burst.addEventListener('animationend', () => burst.remove());
    bubbleEl.appendChild(burst);
  }
  // Wave5 M2 (J3) — swipe-right-to-reply gesture. Tracks one active drag at a
  // time (module-scoped `_swipe`); reset defensively in teardownThread too.
  function _onSwipeStart(e) {
    const row = e.target.closest('.ms-row[data-mid]');   // pending/optimistic
    if (!row) return;                                    // rows have no data-mid — excluded by construction
    const t = e.touches && e.touches[0]; if (!t) return;
    _swipe = { row, mid: row.dataset.mid, startX: t.clientX, startY: t.clientY, dx: 0, committed: false, aborted: false };
    // gesture-conflict fix 2026-08 — a touchstart landing within 150ms of the
    // thread scroller's last scroll event is the user's tap to STOP momentum
    // scrolling, not a deliberate swipe. Still create the record (so
    // move/end don't need extra null-checks) but abort it immediately so it
    // can never commit to a reply-swipe.
    if (Date.now() - _lastThreadScrollAt < 150) _swipe.aborted = true;
  }
  function _onSwipeMove(e) {
    if (!_swipe || _swipe.aborted) return;
    const t = e.touches && e.touches[0]; if (!t) return;
    const dx = t.clientX - _swipe.startX, dy = t.clientY - _swipe.startY;
    if (!_swipe.committed) {
      // gesture-conflict fix 2026-08 — true axis-lock (replaces the old 8px
      // noise-floor + 0.6 slope guard). Wait for real combined travel before
      // deciding anything; once decided at the SWIPE_AXIS_THRESH point, the
      // axis is latched for the rest of the touch — a drag that reads
      // vertical-dominant here can never later commit to a reply-swipe even
      // if the finger straightens out horizontally, and vice versa.
      if (Math.abs(dx) < SWIPE_AXIS_THRESH && Math.abs(dy) < SWIPE_AXIS_THRESH) return;   // undecided — keep waiting
      if (!(dx > 0 && Math.abs(dx) > SWIPE_SLOPE * Math.abs(dy))) { _swipe.aborted = true; return; }  // vertical-dominant or leftward — permanently abort
      _swipe.committed = true;
      _swipe.row.classList.add('ms-row-swiping');
    }
    e.preventDefault();      // only reached once horizontal intent is committed
    _swipe.dx = Math.max(0, Math.min(dx, SWIPE_REPLY_CAP));
    _swipe.row.style.transform = `translateX(${_swipe.dx}px)`;
  }
  function _onSwipeEnd() {
    if (!_swipe) return;
    const { row, dx, mid, committed } = _swipe;
    if (committed) {
      row.classList.remove('ms-row-swiping');
      row.style.transform = '';
      if (dx >= SWIPE_REPLY_ARM) _armReply(mid);
    }
    _swipe = null;
  }
  // Own message → promptDialog edit; own/admin → confirmDialog delete. NO
  // manual re-render calls here — the messages listener repaints (patched, per #2).
  async function _onEditMessage(mid) {
    const m = [..._earlier, ..._msgs].find(x => x.id === mid);
    const newText = await promptDialog({ message: 'Edit message:', value: m?.text || '', multiline: true });
    if (newText === null) return;
    const trimmed = newText.trim();
    // Wave1 P2 fix #13 — an all-whitespace "edit" used to silently write a
    // blank/space-only text (indistinguishable from a real message once
    // trimmed for display) instead of routing through the dedicated unsend
    // flow; reject it instead.
    if (!trimmed) { Notifs.showToast("Message can't be empty — use Remove instead", 'error'); return; }
    if (trimmed === (m?.text || '')) return;
    const conv = _openConv, convId = _openConvId;
    const createdAtMs = m?.createdAt?.toMillis?.();
    await db.collection('conversations').doc(convId).collection('messages').doc(mid)
      .update({ text: trimmed, editedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .then(() => {
        // Wave1 P2 fix #13 — keep the inbox preview in sync with an edit to
        // the conversation's CURRENT latest message (mirrors the tombstone
        // rewrite _onDeleteMessage already does below for the same reason —
        // conv.lastMessageText is a frozen snapshot, not live-derived).
        const lastMs = conv?.lastMessageAt?.toMillis?.();
        if (conv && createdAtMs && lastMs && createdAtMs >= lastMs) {
          const preview = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed;
          db.collection('conversations').doc(convId).update({ lastMessageText: preview }).catch(() => {});
        }
      })
      .catch(() => Notifs.showToast('Edit failed', 'error'));
  }
  // Wave5 M1 (J3) — "delete" is now an unsend TOMBSTONE, not a hard delete.
  // Same author-or-admin gate as before (canDelete in _renderMessagePart);
  // rules already allow it — messages/update permits any field write when
  // authorId==caller or isAdmin(), no shape restriction (the "tombstone =
  // author-edit path" the batch brief points at). The renderer treats
  // `deleted:true` as a terminal state: italic "Message removed", no
  // reactions/picker/actions (see _renderMessagePart's early-return branch).
  async function _onDeleteMessage(mid) {
    if (!(await confirmDialog({ message: 'Remove this message for everyone?', danger: true }))) return;
    const m = [..._earlier, ..._msgs].find(x => x.id === mid);
    if (m && m.deleted) return;   // already a tombstone
    const conv = _openConv, convId = _openConvId;
    const createdAtMs = m?.createdAt?.toMillis?.();
    await db.collection('conversations').doc(convId).collection('messages').doc(mid)
      .update({ deleted: true, text: '', fileUrl: null, fileName: null, fileSource: null, media: null })
      .then(async () => {
        // owner req #4 — the notification(s) this message generated for
        // recipients must be removed along with it. Best-effort/fire-and-forget:
        // never blocks the delete UX on notif cleanup.
        // Wave1 P1 fix #9 — a mention notified someone OUTSIDE the by-
        // membership target set too (see _notifyRecipients); merge the
        // message's own m.mentions in here so their notif gets found/removed
        // along with everyone else's.
        if (conv && createdAtMs) {
          const targets = Array.from(new Set([...(await _targetsFor(conv)), ...(m?.mentions || [])]));
          window.Notifs?.deleteForMessage(convId, createdAtMs, targets).catch(() => {});
        }
        // Owner report 2026-08-03: the unsent TEXT stayed visible in the
        // inbox preview (conv.lastMessageText is a snapshot). If this was
        // the conversation's latest message, rewrite the preview to match
        // the tombstone. lastMessage* keys are member-writable per rules.
        const lastMs = conv?.lastMessageAt?.toMillis?.();
        if (conv && createdAtMs && lastMs && createdAtMs >= lastMs) {
          db.collection('conversations').doc(convId)
            .update({ lastMessageText: 'Message removed' }).catch(() => {});
        }
      })
      .catch(() => Notifs.showToast('Delete failed', 'error'));
  }
  // Wave5 M1 (J3) — the OLD hard-delete behavior, now a SEPARATE admin-only
  // action ("Remove permanently" in the long-press picker / .ms-actions on a
  // tombstone) rather than what the trash icon does by default.
  async function _onHardDeleteMessage(mid) {
    if (!_isAdminRole()) return;
    if (!(await confirmDialog({ message: 'Permanently remove this message? This cannot be undone.', danger: true }))) return;
    const m = [..._earlier, ..._msgs].find(x => x.id === mid);
    const conv = _openConv, convId = _openConvId;
    const createdAtMs = m?.createdAt?.toMillis?.();
    await db.collection('conversations').doc(convId).collection('messages').doc(mid).delete()
      .then(async () => {
        // Wave1 P1 fix #9 — see the tombstone path above: merge m.mentions
        // too, so a mention-only recipient's notif is still found/removed.
        if (conv && createdAtMs) {
          const targets = Array.from(new Set([...(await _targetsFor(conv)), ...(m?.mentions || [])]));
          window.Notifs?.deleteForMessage(convId, createdAtMs, targets).catch(() => {});
        }
        // Same inbox-preview rewrite as the tombstone path.
        const lastMs = conv?.lastMessageAt?.toMillis?.();
        if (conv && createdAtMs && lastMs && createdAtMs >= lastMs) {
          db.collection('conversations').doc(convId)
            .update({ lastMessageText: 'Message removed' }).catch(() => {});
        }
      })
      .catch(() => Notifs.showToast('Permanent delete failed', 'error'));
  }

  // ── Wave5 M1 (J2) — per-conversation drafts. localStorage only, plain text. ──
  function _draftKey(convId) { return 'bi-chat-draft-' + convId; }
  function _loadDraft(convId) { try { return localStorage.getItem(_draftKey(convId)) || ''; } catch (_) { return ''; } }
  function _saveDraft(convId, text) {
    try {
      if (text) localStorage.setItem(_draftKey(convId), text);
      else localStorage.removeItem(_draftKey(convId));
    } catch (_) {}
  }
  function _clearDraft(convId) { try { localStorage.removeItem(_draftKey(convId)); } catch (_) {} }
  // v14 chat re-audit fix — drafts were never garbage-collected: a draft
  // typed into a group later left, or a dept channel the user no longer
  // belongs to, stayed in localStorage forever (only cleared on a successful
  // send in THAT conversation). Two targeted cleanups instead of an
  // unbounded generic sweep:
  //  1. Dept-channel drafts: myDeptChannels() is synchronously derivable from
  //     currentDepts/role, so a `bi-chat-draft-dept_<X>` key for a
  //     department the user no longer belongs to can be swept for free. Run
  //     once per chat-page-visit (from _attachInbox), not on every render.
  //  2. Group-leave: cleared directly at the Leave-group button's handler
  //     (_openMediaTab) — that's the one place this file actually knows "I'm
  //     not a member of THIS conversation anymore."
  function _sweepStaleDeptDrafts() {
    try {
      const validIds = new Set(myDeptChannels().map(d => 'dept_' + d));
      const prefix = 'bi-chat-draft-dept_';
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const convId = key.slice('bi-chat-draft-'.length);
        if (!validIds.has(convId)) localStorage.removeItem(key);
      }
    } catch (_) {}
  }

  // ── Wave5 M1 (J2) — optimistic send bubbles ──
  // Rendered into a DEDICATED tail container (#chat-pending-tail), kept as the
  // LAST child of #chat-thread-scroll by _ensurePendingTailEl — never as part
  // of the keyed message list _threadHtml/_patchThread own. That's what lets
  // pending bubbles coexist with _patchThread's prefix-diff logic: a full
  // rebuild (el.innerHTML = _threadHtml(list)) recreates the tail container
  // fresh at the end; the incremental patch path inserts newly-arrived REAL
  // messages immediately BEFORE the tail (not after) so ordering stays
  // correct, and never touches the tail's own contents. Neither path ever
  // needs to know a pending bubble exists.
  function _newClientKey() {
    return (currentUser?.uid || 'u') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }
  function _addPendingMessage({ clientKey, text, file, images, link, replyTo }) {
    let previewUrl = null;
    if (file && /^image\//.test(file.type || '')) {
      try { previewUrl = URL.createObjectURL(file); } catch (_) {}
    }
    // Wave5 M3 (J4) — multi-photo local previews: one object URL per selected
    // image, shown (dimmed, same as the legacy single-preview treatment)
    // while the real compress+upload happens in the background.
    const previewUrls = (images || []).map(f => { try { return URL.createObjectURL(f); } catch (_) { return null; } }).filter(Boolean);
    // Wave5 M2 — replyTo rides the pending bubble too (spec requirement):
    // stored verbatim so _renderPendingBubble can show the SAME quote block
    // the confirmed message will render once the snapshot echoes it back.
    _pending.push({ clientKey, text: text || '', file: file || null, images: images || [], previewUrl, previewUrls,
      link: link || null, status: 'sending', replyTo: replyTo || null });
    _renderThread();
  }
  function _markPendingFailed(clientKey) {
    const p = _pending.find(x => x.clientKey === clientKey);
    if (p) { p.status = 'failed'; _renderPendingTail(); }
  }
  // Matches confirmed message docs (by clientKey) against _pending and drops
  // the ones the snapshot just echoed back — this is the "✓ when the snapshot
  // echoes it" reconciliation, called right after every messages snapshot.
  function _reconcilePending() {
    if (!_pending.length) return;
    const seen = new Set();
    _msgs.forEach(m => { if (m.clientKey) seen.add(m.clientKey); });
    _earlier.forEach(m => { if (m.clientKey) seen.add(m.clientKey); });
    if (!seen.size) return;
    _pending.filter(p => seen.has(p.clientKey)).forEach(_revokePendingPreviews);
    _pending = _pending.filter(p => !seen.has(p.clientKey));
  }
  // Tap-to-retry — reuses the SAME clientKey, so whenever it eventually
  // succeeds (first try or the Nth retry) reconciliation still matches it.
  async function _retryPending(clientKey) {
    const p = _pending.find(x => x.clientKey === clientKey);
    if (!p || p.status === 'sending') return;
    p.status = 'sending';
    _renderPendingTail();
    try {
      // Wave5 M2 — carry replyTo through the retry, and recompute mentions
      // from the stored text (the retry always targets the currently open
      // thread, same as the original send, so _openConv is the right conv).
      const mentions = _computeMentions(p.text, _openConv);
      await sendMessage({ text: p.text, file: p.file, images: p.images, link: p.link, clientKey, replyTo: p.replyTo, mentions });
    } catch (e) {
      // v14 chat re-audit fix — canceled out from under this retry — don't
      // flip a bubble that's no longer even in `_pending` back to 'failed',
      // and don't toast an error for a send the user already dismissed.
      if (_canceledClientKeys.delete(clientKey)) return;
      p.status = 'failed';
      _renderPendingTail();
      Notifs.error((e && e.message) || 'Message not sent — retry.');
    }
  }
  // v14 chat re-audit fix — a stuck 'sending' pending bubble (Storage upload
  // stalled on a slow/offline connection — put() has no explicit timeout in
  // this file) used to have NO affordance at all until it flipped to
  // 'failed'; this lets the user dismiss it from the UI at any time. This is
  // a best-effort UI-level cancel, not a network abort — sendMessage's
  // storage.ref().put() call doesn't keep its UploadTask reference around,
  // so there's nothing to actually cancel in flight; if that upload
  // eventually completes anyway, the message will simply appear as a normal
  // confirmed message once the snapshot echoes it back (never silently
  // lost, just no longer tracked as "mine, pending"). _canceledClientKeys
  // suppresses the resulting catch-block noise in doSend/_retryPending.
  function _cancelPendingMessage(clientKey) {
    const idx = _pending.findIndex(x => x.clientKey === clientKey);
    if (idx === -1) return;
    _canceledClientKeys.add(clientKey);
    _revokePendingPreviews(_pending[idx]);
    _pending.splice(idx, 1);
    _renderPendingTail();
    Notifs.info('Message canceled');
  }
  function _ensurePendingTailEl(el) {
    let tail = document.getElementById('chat-pending-tail');
    if (!tail || tail.parentElement !== el) {
      tail = document.createElement('div');
      tail.id = 'chat-pending-tail';
      el.appendChild(tail);
      _wirePendingTailDelegation(tail);
    } else if (el.lastElementChild !== tail) {
      el.appendChild(tail);   // re-append moves an already-wired node back to the end
    }
    return tail;
  }
  function _wirePendingTailDelegation(tail) {
    if (tail.dataset.wired) return;
    tail.dataset.wired = '1';
    tail.addEventListener('click', e => {
      // Wave5 M2 — the pending bubble's quote block (if any) is tappable too.
      const quote = e.target.closest('.ms-reply-quote');
      if (quote) { _scrollToMessage(quote.dataset.targetMid); return; }
      // v14 chat re-audit fix — cancel affordance on a still-'sending'
      // bubble (see _renderPendingBubble/_cancelPendingMessage), checked
      // before the failed-retry branch since the two states are exclusive.
      const cancelBtn = e.target.closest('.ms-pending-cancel');
      if (cancelBtn) { _cancelPendingMessage(cancelBtn.dataset.clientKey); return; }
      const failed = e.target.closest('.ms-bubble-failed');
      if (failed) _retryPending(failed.dataset.clientKey);
    });
  }
  function _renderPendingTail() {
    const tail = document.getElementById('chat-pending-tail');
    if (!tail) return;
    tail.innerHTML = _pending.map(_renderPendingBubble).join('');
    if (window.lucide) lucide.createIcons({ nodes: [tail] });
  }
  function _renderPendingBubble(p) {
    const failed = p.status === 'failed';
    // v14 chat re-audit fix — a 'sending' bubble now carries its own small
    // ✕ cancel affordance (wired in _wirePendingTailDelegation) instead of
    // being tappable ONLY once it flips to 'failed'. Inline-styled (no CSS
    // file in scope for this batch) to match the existing ⏳/⚠ status glyphs.
    const statusHtml = failed
      ? `<span class="ms-pending-status">${emojiIcon('⚠',12)}</span><span class="ms-pending-retry-label">Tap to retry</span>`
      : `<span class="ms-pending-status">${emojiIcon('⏳',11)}</span>` +
        `<button type="button" class="ms-pending-cancel" data-client-key="${escHtml(p.clientKey)}" ` +
        `title="Cancel sending" aria-label="Cancel sending" ` +
        `style="background:none;border:none;padding:2px;margin-left:4px;cursor:pointer;` +
        `color:inherit;opacity:.8;display:inline-flex;align-items:center;vertical-align:middle">` +
        `${emojiIcon('x',11)}</button>`;
    // Wave5 M3 (J4) — multi-photo local previews render through the SAME
    // .ms-media-grid layout the confirmed message will use, just dimmed
    // (opacity, mirroring the legacy single-preview treatment) and with no
    // click handler (the tail's delegated click only wires .ms-reply-quote/
    // .ms-bubble-failed — see _wirePendingTailDelegation — a still-uploading
    // preview has no lightbox-navigable identity yet).
    const previewCount = (p.previewUrls || []).length;
    const gridCls = previewCount === 1 ? 'ms-media-1' : previewCount === 2 ? 'ms-media-2' : 'ms-media-grid3';
    const mediaHtml = previewCount
      ? `<div class="ms-media-grid ${gridCls}" style="margin-top:${p.text?'6':'0'}px;opacity:.75">${
          p.previewUrls.slice(0, 6).map(u => `<div class="ms-media-tile"><img src="${u}" alt=""/></div>`).join('')
        }</div>`
      : p.previewUrl
        ? `<div style="margin-top:${p.text?'6':'0'}px"><img src="${p.previewUrl}" alt="" style="max-width:200px;max-height:160px;border-radius:var(--r-sm,10px);opacity:.75"/></div>`
        : (p.file ? `<div class="ms-file-chip">${emojiIcon('paperclip',14)}<span>${escHtml(p.file.name)}</span></div>` : '');
    const linkHtml = (p.link && !p.file) ? `<div class="ms-file-chip">${emojiIcon('link',14)}<span>${escHtml(p.link)}</span></div>` : '';
    return `
      <div class="ms-row ms-row-mine ms-grp-single">
        <div class="ms-bubble-wrap" style="align-items:flex-end">
          <div class="ms-bubble-row">
            <div class="ms-bubble ms-bubble-mine ms-grp-single ${failed?'ms-bubble-failed':'ms-bubble-pending'}" data-client-key="${escHtml(p.clientKey)}">
              ${_replyQuoteHtml(p.replyTo)}
              ${p.text ? `<div class="ms-text">${escHtml(p.text).replace(/\n/g,'<br/>')}</div>` : ''}
              ${mediaHtml}${linkHtml}
              <div class="ms-meta" style="display:flex">${statusHtml}</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── Wave5 M1 (J7) — scroll-to-bottom FAB ──
  function _updateScrollFab(el) {
    const fab = document.getElementById('chat-scroll-fab');
    if (!fab || !el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = distanceFromBottom > 300;
    fab.classList.toggle('hidden', !scrolledUp);
    if (!scrolledUp) _scrollFabUnseen = 0;
    const badge = document.getElementById('chat-scroll-fab-badge');
    if (badge) {
      badge.textContent = _scrollFabUnseen > 99 ? '99+' : String(_scrollFabUnseen);
      badge.classList.toggle('hidden', _scrollFabUnseen <= 0);
    }
  }
  function _onThreadScroll() {
    _lastThreadScrollAt = Date.now();   // gesture-conflict fix 2026-08 — feeds _onSwipeStart's momentum-scroll guard
    const el = document.getElementById('chat-thread-scroll');
    if (!el) return;
    _updateScrollFab(el);
    // Wave1 P1 fix #7 — catch up the read receipt once the reader scrolls
    // back down to the messages a prior (atBottom-gated) snapshot skipped.
    if (_isNearBottomEl(el)) _scheduleMarkRead();
  }

  // ── Wave5 M1 (J3) — Copy message ──
  async function _copyMessage(mid) {
    const m = [..._earlier, ..._msgs].find(x => x.id === mid);
    const text = m && !m.deleted ? (m.text || m.fileUrl || '') : '';
    if (!text) { Notifs.showToast('Nothing to copy', 'error'); return; }
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard api');
      await navigator.clipboard.writeText(text);
      Notifs.success('Copied');
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        Notifs.success('Copied');
      } catch (e2) {
        Notifs.showToast('Copy failed', 'error');
      }
    }
  }

  // ── Wave5 M2 (J3) — Reply-to ──
  // Arms `_replyTarget` from ANY entry point (swipe-commit, hover ↩ button,
  // long-press picker doesn't offer it — reply is swipe/hover only per spec).
  // Looks the message up in the currently-loaded window only (_earlier/_msgs)
  // — a message old enough to have scrolled out of that window can't be
  // replied to without loading it first, same constraint _scrollToMessage has.
  function _armReply(mid) {
    const m = [..._earlier, ..._msgs].find(x => x.id === mid);
    if (!m || m.deleted) return;
    const info = _authorInfo(m.authorId, m.authorName);
    const snippetSrc = (m.text || m.fileName || 'Attachment');
    _replyTarget = { mid: m.id, author: info.name, snippet: snippetSrc.slice(0, 80) };
    _renderReplyChip();
    document.getElementById('chat-input')?.focus();
  }
  // Renders the composer's quoted-snippet chip from `_replyTarget` module
  // state. Called on arm, on ✕, and on optimistic-send-clear/failure-restore
  // (see doSend in _buildThreadPanel) — never on every _renderThread repaint,
  // since the chip lives OUTSIDE the messages list (composer chrome).
  function _renderReplyChip() {
    const el = document.getElementById('chat-reply-chip');
    if (!el) return;
    if (!_replyTarget) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="ms-reply-chip-bar"></div>
      <div class="ms-reply-chip-body">
        <div class="ms-reply-chip-author">${escHtml(_replyTarget.author)}</div>
        <div class="ms-reply-chip-snippet">${escHtml(_replyTarget.snippet)}</div>
      </div>
      <button type="button" id="chat-reply-chip-close" class="ms-reply-chip-close" title="Cancel reply">✕</button>`;
    document.getElementById('chat-reply-chip-close')?.addEventListener('click', () => {
      _replyTarget = null; _renderReplyChip();
    });
  }
  // Tapping a quote block: scroll-to + flash if the original is in the
  // currently-loaded window, else toast (spec: "Message not loaded").
  function _scrollToMessage(mid) {
    if (!mid) return;
    const el = document.getElementById('chat-thread-scroll');
    const node = el && el.querySelector(`.ms-row[data-mid="${CSS.escape(mid)}"]`);
    if (!node) { Notifs.showToast('Message not loaded', 'error'); return; }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const bubble = node.querySelector('.ms-bubble');
    if (bubble) {
      bubble.classList.add('ms-flash');
      setTimeout(() => bubble.classList.remove('ms-flash'), 900);
    }
  }

  // ── Wave5 M2 (J6) — @mentions: composer-side candidate list + detection ──
  // Group/dept ONLY (spec) — a dm returns [] here, so every mention code path
  // (typeahead, _computeMentions) is naturally a no-op there without a
  // separate conv.type guard at every call site.
  function _mentionCandidatesFor(conv) {
    if (!conv || (conv.type !== 'group' && conv.type !== 'dept')) return [];
    if (conv.type === 'group') {
      return (conv.participants || []).filter(uid => uid !== currentUser.uid).map(uid => ({
        uid, name: (conv.participantNames && conv.participantNames[uid]) || _usersByUid[uid]?.displayName || 'User'
      }));
    }
    // dept — membership mirrors _targetsFor's dept branch (department OR
    // departments[] match), resolved from the SAME _usersByUid cache
    // _refreshUsersCache already keeps warm for avatar/author-name lookups.
    // Wave1 P1 fix #9 — a dept channel's admins (president/manager/
    // secretary) couldn't be @mentioned at all unless they ALSO happened to
    // be a member of that department — the same admins who can already read/
    // moderate every dept channel per firestore.rules. Included here even
    // when not a department match; _notifyRecipients' own merge (below) is
    // what actually lets the notification reach them despite not being a
    // by-membership target.
    return Object.keys(_usersByUid).filter(uid => uid !== currentUser.uid).map(uid => {
      const u = _usersByUid[uid];
      const inDept = u.department === conv.department || (Array.isArray(u.departments) && u.departments.includes(conv.department));
      const isChannelAdmin = ['president', 'manager', 'secretary'].includes(u.role);
      return (inDept || isChannelAdmin) ? { uid, name: u.displayName || u.email || 'User' } : null;
    }).filter(Boolean);
  }
  // Scans the RAW (unescaped) composer text for literal "@Name" occurrences
  // of each candidate's display name — the same literal-match convention the
  // renderer's _highlightMentions uses on the escaped side, so "what got
  // notified" and "what gets highlighted" can never disagree. Typing "@"
  // followed by a name that ISN'T selected from the typeahead simply never
  // matches here (no false-positive mention), matching Messenger's own
  // "mention = a real selected token" semantics without needing separate
  // insertion-position bookkeeping that free-form text edits could invalidate.
  //
  // Wave1 P1 fix #9 — a plain substring `indexOf` let a SHORTER candidate
  // name false-positive match inside a LONGER one that happens to share the
  // same prefix (e.g. "@Ana" matching inside "@Ananya", or inside "@Ana
  // Reyes" when BOTH "Ana" and "Ana Reyes" are real candidates), double- or
  // wrongly-mentioning someone the sender never actually tagged. Fixed with
  // two changes: (1) a word-boundary check — the character right after the
  // matched name must not continue a word — so "Ana" inside "Ananya" is
  // rejected outright; (2) longest-name-first + a claimed-position set — so
  // once "Ana Reyes" claims an "@" occurrence, "Ana" can't ALSO claim that
  // same occurrence (it can still match a genuinely separate "@Ana" written
  // elsewhere in the same message).
  function _computeMentions(text, conv) {
    if (!text) return [];
    const candidates = _mentionCandidatesFor(conv).filter(c => c.name);
    if (!candidates.length) return [];
    const sorted = candidates.slice().sort((a, b) => b.name.length - a.name.length);
    const claimedAt = new Set();
    const out = [];
    sorted.forEach(c => {
      const token = '@' + c.name;
      let from = 0, matched = false;
      for (;;) {
        const at = text.indexOf(token, from);
        if (at === -1) break;
        from = at + 1;
        if (claimedAt.has(at)) continue;                 // already attributed to a longer name here
        const after = text[at + token.length];
        if (after !== undefined && /\w/.test(after)) continue;   // mid-word — not a real mention boundary
        claimedAt.add(at);
        matched = true;
        break;   // one valid occurrence is enough to count this candidate as mentioned
      }
      if (matched) out.push(c.uid);
    });
    return out;
  }
  // Composer input handler (wired in _buildThreadPanel, which owns `input`/
  // `conv`) — detects an in-progress "@query" token ending at the caret and
  // repaints the typeahead dropdown, or hides it when there's no active token.
  function _updateMentionTypeahead(input, conv) {
    const dd = document.getElementById('chat-mention-dd');
    if (!dd) return;
    const candidates = _mentionCandidatesFor(conv);
    if (!candidates.length) { dd.classList.add('hidden'); dd.innerHTML = ''; return; }
    const pos = input.selectionStart;
    const uptoCaret = input.value.slice(0, pos);
    const at = uptoCaret.lastIndexOf('@');
    // A token only counts if the '@' starts a word (start-of-text or preceded
    // by whitespace) — "user@x" mid-word never triggers it.
    if (at === -1 || (at > 0 && !/\s/.test(uptoCaret[at - 1]))) { dd.classList.add('hidden'); dd.innerHTML = ''; return; }
    const query = uptoCaret.slice(at + 1);
    if (/\s/.test(query)) { dd.classList.add('hidden'); dd.innerHTML = ''; return; }   // a space ends the token
    const q = query.toLowerCase();
    const matches = candidates.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { dd.classList.add('hidden'); dd.innerHTML = ''; return; }
    dd.innerHTML = matches.map(c =>
      `<button type="button" class="ms-mention-opt" data-uid="${escHtml(c.uid)}" data-name="${escHtml(c.name)}">${escHtml(c.name)}</button>`
    ).join('');
    dd.dataset.atPos = String(at);
    dd.classList.remove('hidden');
  }

  // ── Wave5 M2 (J3) — Forward ──
  // Conversation picker = "my conversations, sorted recent" (dm/group/dept —
  // the SAME merged+sorted list _renderInbox builds, reusing _convTitle for
  // row labels), reached via openPage like every other secondary chat screen
  // (New Message, per renderChatPage). Selecting a row writes a FRESH message
  // to that conversation via the SAME sendMessage({conv}) machinery every
  // other send uses — the target's lastMessage* preview bump and
  // _notifyRecipients both come along for free, nothing duplicated here.
  async function _openForwardPicker(mid) {
    const m = [..._earlier, ..._msgs].find(x => x.id === mid);
    if (!m || m.deleted) return;
    const sourceConvId = _openConvId;
    if (!sourceConvId) return;
    const deptRows = myDeptChannels().map(d => {
      const existing = _deptConvs.find(cv => cv.department === d);
      return existing || { id: 'dept_' + d, type: 'dept', department: d, name: d, participants: [], lastMessageAt: null, _unprovisioned: true };
    });
    const all = [..._convs, ...deptRows].filter(cv => cv.id !== sourceConvId);
    const sorted = all.slice().sort((a, b) => (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0));
    const initials = s => escHtml((s || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    const rowHtml = cv => {
      const title = _convTitle(cv);
      return `<div class="item-card chat-forward-target pressable" data-cid="${escHtml(cv.id)}" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px">
        <div class="ms-avatar ms-avatar-md">${initials(title)}</div>
        <div style="flex:1;min-width:0;font-weight:600">${escHtml(title)}</div>
      </div>`;
    };
    const body = `<div id="chat-forward-list" class="item-list">${
      sorted.map(rowHtml).join('') || '<div class="empty-state" style="padding:16px"><p>No conversations yet.</p></div>'
    }</div>`;
    window.openPage('Forward to…', body);
    document.getElementById('chat-forward-list')?.querySelectorAll('.chat-forward-target').forEach(row => {
      row.addEventListener('click', async () => {
        let target = sorted.find(x => x.id === row.dataset.cid);
        if (!target) return;
        window.Overlay.dismissTop();
        try {
          if (target._unprovisioned) {   // lazy-create, mirrors openDeptChannel
            await db.collection('conversations').doc(target.id).set({
              type: 'dept', department: target.department, name: target.department, participants: [],
              participantNames: {}, createdBy: currentUser.uid, createdByName: _myName(),
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              lastMessageAt: null, lastMessageText: null, lastMessageBy: null, lastMessageByName: null
            }).catch(() => {});
          }
          const forwardedFrom = { convId: sourceConvId, authorName: _authorInfo(m.authorId, m.authorName).name };
          await sendMessage({
            text: m.text || '', clientKey: _newClientKey(), conv: target, forwardedFrom,
            fileUrl: m.fileUrl || null, fileName: m.fileName || null, fileSource: m.fileSource || null,
            media: m.media || null   // Wave5 M3 — forwarding a media message reuses its uploaded photo URLs, no re-upload
          });
          Notifs.success('Forwarded');
        } catch (_) {
          Notifs.showToast('Forward failed', 'error');
        }
      });
    });
  }

  // ── Wave5 M2 (J6) — composer emoji picker (REACTIONS + EMOJI_GRID; module-
  // level so its outside-click listener can be torn down from teardownThread). ──
  function _closeEmojiGrid() {
    document.getElementById('chat-emoji-grid')?.classList.add('hidden');
    document.removeEventListener('click', _emojiOutsideClick, true);
    _emojiMenuOpen = false;
  }
  function _emojiOutsideClick(e) {
    const grid = document.getElementById('chat-emoji-grid');
    const btn = document.getElementById('chat-emoji-btn');
    if (grid && !grid.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) _closeEmojiGrid();
  }
  // selectionStart-aware insert (spec) — works whether or not the textarea
  // currently has a selection (collapsed selection = plain cursor position).
  function _insertEmojiAtCursor(input, emoji) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
    const newPos = start + emoji.length;
    input.setSelectionRange(newPos, newPos);
    input.focus();
  }

  // ══════════════════════════════
  // Wave5 Batch M3 — media + lightbox
  // ══════════════════════════════

  // ── Wave5 M3 (J1) — lightbox image list ──
  // Flat, chronological list of every image across the CURRENTLY LOADED
  // thread window (_earlier + _msgs — "earlier+live windows" per spec;
  // an image that's back further than the loaded window only joins the list
  // once "Load earlier" pulls it in, the same constraint _scrollToMessage
  // already has for replies). Tombstoned messages are skipped (their
  // media/fileUrl are nulled on unsend anyway). Covers BOTH shapes: a
  // media[] grid (each item is one entry) and a legacy single fileUrl image
  // (one entry) — so navigating next/prev in the lightbox moves seamlessly
  // across old and new message shapes with no special-casing at the tap site.
  function _collectAllImages() {
    const out = [];
    [..._earlier, ..._msgs].forEach(m => {
      if (m.deleted) return;
      if (Array.isArray(m.media) && m.media.length) {
        m.media.forEach(mi => out.push({ url: mi.url, name: mi.name, mid: m.id }));
      } else if (m.fileUrl && m.fileSource !== 'link' && _isImageUrl(m.fileUrl)) {
        out.push({ url: m.fileUrl, name: m.fileName, mid: m.id });
      }
    });
    return out;
  }
  // Maps a tap on the Nth tile of message `mid` (data-idx, 0-based within
  // THAT message's own media) to its position in the flat conversation-wide
  // list built above, then opens the lightbox there.
  function _openLightboxFor(mid, localIdx) {
    const all = _collectAllImages();
    let seen = -1, flatIdx = 0;
    for (let i = 0; i < all.length; i++) {
      if (all[i].mid !== mid) continue;
      seen++;
      if (seen === localIdx) { flatIdx = i; break; }
    }
    // v14 chat re-audit fix — allowLoadMore:true only for THIS call site (a
    // tap inside the live thread). The Shared Media tab's lightbox (below,
    // `_openLightbox(mediaItems, idx)`) already opens off a one-shot
    // up-to-500-message fetch, so there's nothing further to page in there —
    // leaving that call site's default (false) keeps its old silent-wrap
    // behavior unchanged.
    _openLightbox(all, flatIdx, { allowLoadMore: true });
  }
  // ── Wave5 M3 (J1) — the lightbox itself. ONE Overlay entry (Back/Esc
  // dismiss come free: js/app.js's popstate handler calls Overlay._popOne()
  // and Keymap.closeTopOverlay() calls Overlay.dismissTop() whenever the
  // stack is non-empty — both already exist, nothing extra needed here for
  // those two paths). z-index is entirely Overlay's own dynamic tier
  // (push(kind, teardown, el) inline-sets el.style.zIndex) — no z-index
  // literal in this file or in the .ms-lightbox CSS. Swipe left/right moves
  // between every image _collectAllImages found; swipe down dismisses;
  // pinch (2-touch) and double-tap zoom via a hand-rolled transform (no
  // gesture library) — touch-action:none on the image hands full gesture
  // control to this code instead of fighting native browser panning/zoom.
  function _openLightbox(images, startIdx, opts) {
    if (!images || !images.length) return;
    opts = opts || {};
    let idx = Math.max(0, Math.min(startIdx || 0, images.length - 1));
    let scale = 1, tx = 0, ty = 0;                    // current image's zoom/pan
    let pinchStartDist = 0, pinchStartScale = 1;
    let panStartX = 0, panStartY = 0, panStartTx = 0, panStartTy = 0;
    let swipe = null;                                 // 1-finger, scale===1 drag (nav or dismiss)
    let lastTapAt = 0, lastTapX = 0, lastTapY = 0;     // double-tap-to-zoom detection
    let _loadingMore = false;                         // v14 chat re-audit fix — re-entrancy guard for go()'s load-more fetch

    const el = document.createElement('div');
    el.className = 'ms-lightbox';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Photo viewer');
    el.innerHTML = `
      <div class="ms-lightbox-top">
        <button type="button" class="ms-lightbox-close" title="Close" aria-label="Close">✕</button>
        <div class="ms-lightbox-count"></div>
        <a class="ms-lightbox-download" target="_blank" rel="noopener" title="Open in a new tab">${emojiIcon('download', 18)}</a>
      </div>
      <div class="ms-lightbox-stage">
        <img class="ms-lightbox-img" alt=""/>
        <button type="button" class="ms-lightbox-nav ms-lightbox-prev" aria-label="Previous photo">‹</button>
        <button type="button" class="ms-lightbox-nav ms-lightbox-next" aria-label="Next photo">›</button>
      </div>`;
    document.body.appendChild(el);
    if (window.lucide) lucide.createIcons({ nodes: [el] });

    const img = el.querySelector('.ms-lightbox-img');
    const stage = el.querySelector('.ms-lightbox-stage');
    const countEl = el.querySelector('.ms-lightbox-count');
    const dlEl = el.querySelector('.ms-lightbox-download');
    const prevBtn = el.querySelector('.ms-lightbox-prev');
    const nextBtn = el.querySelector('.ms-lightbox-next');
    const multi = images.length > 1;
    prevBtn.classList.toggle('ms-lightbox-multi', multi);
    nextBtn.classList.toggle('ms-lightbox-multi', multi);

    function resetZoom() {
      scale = 1; tx = 0; ty = 0;
      img.classList.remove('ms-lightbox-dragging');
      img.style.transform = ''; img.style.opacity = '';
    }
    function applyTransform() { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; }
    function render() {
      const it = images[idx];
      const u = safeHttpUrl(it.url);
      img.src = u; img.alt = it.name || '';
      dlEl.href = u; dlEl.setAttribute('download', it.name || '');
      countEl.textContent = multi ? `${idx + 1} / ${images.length}` : '';
      resetZoom();
    }
    // v14 chat re-audit fix — swiping/tapping "previous" from the oldest
    // photo THIS lightbox currently knows about used to silently wrap
    // (modulo) straight to the newest one, implying — wrongly, for a long
    // thread — that the visible set is the whole set. When this call site
    // opted in (opts.allowLoadMore, set only by _openLightboxFor's in-thread
    // tap), try a real "load earlier" page first and splice the freshly
    // discovered photos in before deciding there's genuinely nothing older.
    // _earlierExhausted (maintained by loadEarlier()) means "the last fetch
    // came back short — there's truly no more history," so this fires at
    // most once per still-untried older page, never in a loop.
    async function go(delta) {
      if (opts.allowLoadMore && delta < 0 && idx === 0 && !_earlierExhausted && !_loadingMore && _openConvId) {
        _loadingMore = true;
        const prevCount = images.length;
        countEl.textContent = 'Loading…';
        try { await loadEarlier(); } catch (_) {}
        _loadingMore = false;
        const fresh = _collectAllImages();
        if (fresh.length > prevCount) {
          const added = fresh.length - prevCount;   // newly-prepended older photos
          images = fresh;
          idx = added - 1;                          // land on the newest of the newly-loaded earlier photos
          render();
          return;
        }
        // That page had no new photos in it (e.g. all-text messages) — fall
        // through to the normal wrap below. Not a silent no-op: a real fetch
        // was attempted, and the next swipe-back will try the NEXT page
        // (unless loadEarlier() has since set _earlierExhausted).
      }
      idx = (idx + delta + images.length) % images.length;
      render();
    }

    el.querySelector('.ms-lightbox-close').addEventListener('click', () => window.Overlay.dismissTop());
    prevBtn.addEventListener('click', () => go(-1));
    nextBtn.addEventListener('click', () => go(1));
    el.addEventListener('click', e => { if (e.target === el || e.target === stage) window.Overlay.dismissTop(); });

    function onKey(e) {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      // Escape is handled globally by Keymap/Overlay already — not duplicated here.
    }
    document.addEventListener('keydown', onKey);

    function dist(t0, t1) { return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); }
    function onTouchStart(e) {
      if (e.touches.length === 2) {
        pinchStartDist = dist(e.touches[0], e.touches[1]);
        pinchStartScale = scale;
        swipe = null;
        return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const now = Date.now();
      const isDoubleTap = (now - lastTapAt < 300) &&
        Math.abs(t.clientX - lastTapX) < 30 && Math.abs(t.clientY - lastTapY) < 30;
      lastTapAt = isDoubleTap ? 0 : now; lastTapX = t.clientX; lastTapY = t.clientY;
      if (isDoubleTap) {
        if (scale > 1) resetZoom(); else { scale = 2; tx = 0; ty = 0; applyTransform(); }
      }
      if (scale > 1) {
        panStartX = t.clientX; panStartY = t.clientY; panStartTx = tx; panStartTy = ty;
        swipe = null;
      } else {
        swipe = { startX: t.clientX, startY: t.clientY, dx: 0, dy: 0, committed: false, axis: null };
      }
    }
    function onTouchMove(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const d = dist(e.touches[0], e.touches[1]);
        scale = Math.max(1, Math.min(4, pinchStartScale * (d / (pinchStartDist || d))));
        img.classList.add('ms-lightbox-dragging');
        applyTransform();
        return;
      }
      if (e.touches.length === 1 && scale > 1) {
        e.preventDefault();
        const t = e.touches[0];
        tx = panStartTx + (t.clientX - panStartX);
        ty = panStartTy + (t.clientY - panStartY);
        img.classList.add('ms-lightbox-dragging');
        applyTransform();
        return;
      }
      if (!swipe) return;
      const t = e.touches[0]; if (!t) return;
      const dx = t.clientX - swipe.startX, dy = t.clientY - swipe.startY;
      if (!swipe.committed) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;   // noise floor
        swipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        swipe.committed = true;
      }
      if (swipe.axis === 'x') {
        e.preventDefault();
        swipe.dx = dx;
        img.classList.add('ms-lightbox-dragging');
        img.style.transform = `translateX(${dx}px)`;
        img.style.opacity = String(Math.max(0.4, 1 - Math.abs(dx) / 400));
      } else if (dy > 0) {   // swipe DOWN only — dismiss gesture; an upward drag is a no-op (no content to reveal)
        e.preventDefault();
        swipe.dy = dy;
        img.classList.add('ms-lightbox-dragging');
        img.style.transform = `translateY(${dy}px)`;
        img.style.opacity = String(Math.max(0.3, 1 - dy / 300));
      }
    }
    function onTouchEnd() {
      if (swipe && swipe.committed) {
        if (swipe.axis === 'x' && Math.abs(swipe.dx) > 70) {
          go(swipe.dx > 0 ? -1 : 1);
        } else if (swipe.axis === 'y' && swipe.dy > 100) {
          swipe = null;
          window.Overlay.dismissTop();
          return;
        } else {
          img.classList.remove('ms-lightbox-dragging');
          img.style.opacity = '';
          applyTransform();
        }
      }
      swipe = null;
    }
    stage.addEventListener('touchstart', onTouchStart, { passive: true });
    stage.addEventListener('touchmove', onTouchMove, { passive: false });
    stage.addEventListener('touchend', onTouchEnd);
    stage.addEventListener('touchcancel', onTouchEnd);

    window.Overlay.push('lightbox', () => { document.removeEventListener('keydown', onKey); el.remove(); }, el);
    render();
  }

  // ── Wave5 M3 (J4) — Shared Media/Files/Links (thread-info page). A ONE-SHOT
  // query (not a live listener — no new listener-lifecycle contract for this
  // module to own), client-filtered per spec ("fine at current volumes").
  // Reached via the ⓘ button _buildThreadPanel wires next to the wallpaper
  // menu.
  // Wave5 M4 (J7) — Group admin. Rename/photo/add-members are gated to
  // creator-or-admin, matching the deployed conv-doc update rule's ONLY
  // unrestricted branch (resource.data.createdBy==uid || isAdmin() —
  // firestore.rules ~line 432-433, which has no affectedKeys shape
  // restriction at all, unlike every other update disjunct). dm/dept convs
  // never show these controls — dept membership is derived from department,
  // not owned by a creator, and a dm has no "group" identity to manage.
  function _isGroupAdmin(conv) {
    return conv.type === 'group' && (conv.createdBy === currentUser.uid || _isAdminRole());
  }
  // v14 chat re-audit fix — shared by the About section's initial render AND
  // _openAddMembersPicker's live patch-in-place, so the remove-member button
  // (admin-only, never on your own row — self-removal is Leave's job) can't
  // drift between the two render sites.
  function _memberRowHtml(uid, conv, isGroupAdmin) {
    const nm = (conv.participantNames && conv.participantNames[uid]) || 'User';
    const ini = s => escHtml((s || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    const canRemove = isGroupAdmin && uid !== currentUser.uid;
    return `<div class="chat-about-member-row">
      <div class="ms-avatar ms-avatar-md">${ini(nm)}</div>
      <span class="chat-about-member-name">${escHtml(nm)}</span>
      ${uid === conv.createdBy ? `<span class="chat-about-admin-tag">Admin</span>` : ''}
      ${canRemove ? `<button type="button" class="chat-about-member-remove" data-uid="${escHtml(uid)}" title="Remove from group" aria-label="Remove ${escHtml(nm)} from group" style="margin-left:auto;background:none;border:none;padding:4px;cursor:pointer;color:inherit;opacity:.7;display:inline-flex;align-items:center">${emojiIcon('x',14)}</button>` : ''}
    </div>`;
  }
  // Wave5 M4 — internal-users picker for "Add members" (creator/admin only).
  // Reuses dmCandidates for the same eligibility scoping "New Message"/
  // "New Group" already use (a partner sees only same-company partners +
  // president/manager), minus whoever's already a participant.
  async function _openAddMembersPicker(conv) {
    const snap = await dbCachedGet('users', () => db.collection('users').get(), 60000).catch(() => ({ docs: [] }));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const existing = new Set(conv.participants || []);
    const candidates = dmCandidates(users).filter(u => !existing.has(u.id));
    const rowHtml = u => {
      const ini = (u.displayName || u.email || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
      return `<label class="item-card" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px">
        <input type="checkbox" class="chat-addmember-cb" value="${escHtml(u.id)}"/>
        <div class="ms-avatar ms-avatar-md">${u.photoUrl?`<img src="${escHtml(u.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:escHtml(ini)}</div>
        <div style="flex:1;min-width:0;font-weight:600">${escHtml(u.displayName||u.email)}</div>
      </label>`;
    };
    const body = `
      <div id="chat-addmember-list" class="item-list">${
        candidates.map(rowHtml).join('') || '<div class="empty-state" style="padding:16px"><p>Everyone is already in this group.</p></div>'
      }</div>
      ${candidates.length ? `<button class="btn-primary btn-sm" id="chat-addmember-btn" style="margin-top:12px" disabled>Add selected</button>
      <div id="chat-addmember-err" class="error-msg hidden" style="margin-top:6px"></div>` : ''}`;
    window.openPage('Add members', body);
    const listEl = document.getElementById('chat-addmember-list');
    const btn = document.getElementById('chat-addmember-btn');
    listEl?.addEventListener('change', () => {
      if (btn) btn.disabled = !listEl.querySelectorAll('.chat-addmember-cb:checked').length;
    });
    btn?.addEventListener('click', async () => {
      const err = document.getElementById('chat-addmember-err');
      const picked = Array.from(document.querySelectorAll('.chat-addmember-cb:checked')).map(cb => cb.value);
      if (!picked.length) return;
      btn.disabled = true; btn.textContent = 'Adding…';
      const nameUpdates = {};
      picked.forEach(uid => {
        const u = candidates.find(x => x.id === uid);
        nameUpdates[`participantNames.${uid}`] = u?.displayName || u?.email || 'User';
      });
      try {
        await db.collection('conversations').doc(conv.id).update({
          participants: firebase.firestore.FieldValue.arrayUnion(...picked),
          ...nameUpdates
        });
        conv.participants = Array.from(new Set([...(conv.participants||[]), ...picked]));
        conv.participantNames = conv.participantNames || {};
        picked.forEach(uid => { conv.participantNames[uid] = nameUpdates[`participantNames.${uid}`]; });
        // Patch the "Shared Media" page's member list in place — it's the
        // page UNDER this picker (openPage hides, doesn't destroy, so it's
        // still in the DOM), and it won't otherwise refresh until reopened.
        const membersEl = document.querySelector('.chat-about-members');
        if (membersEl) {
          membersEl.innerHTML = conv.participants.map(uid => _memberRowHtml(uid, conv, _isGroupAdmin(conv))).join('');
          if (window.lucide) lucide.createIcons({ nodes: [membersEl] });   // v14 chat re-audit fix — remove-member ✕ icon needs a refresh on dynamic re-render
        }
        const subtitleEl = document.querySelector('.chat-about-subtitle');
        if (subtitleEl) subtitleEl.textContent = `${conv.participants.length} member${conv.participants.length!==1?'s':''}`;
        Notifs.success('Members added');
        window.Overlay.dismissTop();
      } catch (_) {
        if (err) { err.textContent = 'Could not add members.'; err.classList.remove('hidden'); }
        btn.disabled = false; btn.textContent = 'Add selected';
      }
    });
  }
  async function _openMediaTab(conv) {
    // v14 chat re-audit fix — was a fresh uncached .limit(500).get() on
    // EVERY tap of the ⓘ button (unlike the users/tasks/kpi/dept-conv reads
    // elsewhere in this file, which all route through dbCachedGet). Short
    // TTL keyed per-conversation — sendMessage eagerly invalidates this exact
    // key the moment a media/file attachment is sent, so a fresh attachment
    // still shows up immediately rather than waiting out the TTL.
    const snap = await dbCachedGet('chat-media-' + conv.id,
      () => db.collection('conversations').doc(conv.id).collection('messages')
        .orderBy('createdAt', 'desc').limit(500).get(),
      20000
    ).catch(() => ({ docs: [] }));
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => !m.deleted);
    const mediaItems = [], fileItems = [], linkItems = [];
    msgs.forEach(m => {
      if (Array.isArray(m.media) && m.media.length) {
        m.media.forEach(mi => mediaItems.push({ url: mi.url, name: mi.name }));
      } else if (m.fileUrl && m.fileSource === 'link') {
        linkItems.push({ url: m.fileUrl, name: m.fileName, date: m.createdAt });
      } else if (m.fileUrl) {
        if (_isImageUrl(m.fileUrl)) mediaItems.push({ url: m.fileUrl, name: m.fileName });
        else fileItems.push({ url: m.fileUrl, name: m.fileName, date: m.createdAt });
      }
    });
    const fmtDate = ts => {
      const d = ts?.toDate ? ts.toDate() : null;
      return d ? d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: window.BIZ_TZ }) : '';
    };
    const fileRowHtml = (it, icon) => `<a class="chat-mediatab-file-row" href="${safeHttpUrl(it.url)}" target="_blank" rel="noopener">
        ${emojiIcon(icon, 16)}<span class="chat-mediatab-file-name">${escHtml(it.name || it.url || 'File')}</span>
        <span class="chat-mediatab-file-date">${escHtml(fmtDate(it.date))}</span>
      </a>`;
    const mediaHtml = mediaItems.length
      ? `<div class="chat-mediatab-grid">${mediaItems.map((it, i) =>
          `<div class="chat-mediatab-thumb" data-idx="${i}"><img src="${safeHttpUrl(it.url)}" loading="lazy" alt="${escHtml(it.name||'photo')}"/></div>`).join('')}</div>`
      : `<div class="empty-state" style="padding:16px"><p>No photos yet.</p></div>`;
    const filesHtml = fileItems.length
      ? fileItems.map(it => fileRowHtml(it, 'paperclip')).join('')
      : `<div class="empty-state" style="padding:16px"><p>No files yet.</p></div>`;
    const linksHtml = linkItems.length
      ? linkItems.map(it => fileRowHtml(it, 'link')).join('')
      : `<div class="empty-state" style="padding:16px"><p>No links yet.</p></div>`;

    // Wave5 M4 (J7) — About section, placed ABOVE the Media/Files/Links chips
    // on this SAME page (choice: one info screen, no extra navigation hop —
    // the chips already scroll independently below it). Group: avatar/name
    // editable creator-or-admin-only, full member list, "Add members". dm/
    // dept: a plain read-only header so the info page still makes sense there
    // (no admin concept for either type).
    const isGroupAdmin = _isGroupAdmin(conv);
    const title = _convTitle(conv);
    const aboutInitials = s => escHtml((s || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    const memberCount = (conv.participants || []).length;
    const avatarInner = conv.photoUrl
      ? `<img src="${escHtml(conv.photoUrl)}" alt="${escHtml(title)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`
      : aboutInitials(title);
    const aboutHtml = `
      <div class="chat-about">
        <div class="chat-about-avatar-wrap">
          <div class="ms-avatar chat-about-avatar" id="chat-about-avatar"${isGroupAdmin ? ' title="Tap to change group photo"' : ''}>${avatarInner}</div>
          ${isGroupAdmin ? `<span class="chat-about-avatar-edit">${emojiIcon('camera',13)}</span><input type="file" id="chat-about-photo-input" accept="image/*" style="display:none"/>` : ''}
        </div>
        <div class="chat-about-title-row">
          <div class="chat-about-title">${escHtml(title)}</div>
          ${isGroupAdmin ? `<button type="button" id="chat-about-rename-btn" class="ms-thread-menu-btn" title="Rename group">${emojiIcon('pencil',15)}</button>` : ''}
        </div>
        <div class="chat-about-subtitle">${
          conv.type === 'group' ? `${memberCount} member${memberCount!==1?'s':''}`
          : conv.type === 'dept' ? 'Department channel'
          : 'Direct message'
        }</div>
        ${conv.type === 'group' ? `
        <div class="chat-about-members">${(conv.participants||[]).map(uid => _memberRowHtml(uid, conv, isGroupAdmin)).join('')}</div>
        ${isGroupAdmin ? `<button type="button" id="chat-about-addmember-btn" class="btn-secondary btn-sm" style="width:100%">${emojiIcon('users',14)} Add members</button>` : ''}
        ` : ''}
        <div class="chat-about-rows">
          <button type="button" id="chat-about-wallpaper-btn" class="chat-about-row" aria-haspopup="true" aria-expanded="false">
            <span class="chat-about-row-icon">${emojiIcon('image',16)}</span>
            <span class="chat-about-row-label">Chat wallpaper</span>
            <span class="chat-about-row-chevron">${emojiIcon('chevron-down',15)}</span>
          </button>
          <div id="chat-about-wallpaper-list" class="ms-wallpaper-menu ms-wallpaper-menu-inline hidden" role="menu">
            ${WALLPAPERS.map(w => `<button type="button" class="ms-wallpaper-opt" data-wp="${w.key}" role="menuitem">
                <span class="ms-wallpaper-swatch wp-${w.key}"></span>${escHtml(w.label)}
              </button>`).join('')}
          </div>
          ${conv.type === 'group' ? `
          <button type="button" id="chat-about-leave-btn" class="chat-about-row chat-about-row-danger">
            <span class="chat-about-row-icon">${emojiIcon('log-out',16)}</span>
            <span class="chat-about-row-label">Leave group</span>
          </button>` : ''}
        </div>
      </div>
      <div class="chat-about-divider"></div>`;

    const body = `
      ${aboutHtml}
      <div id="chat-mediatab-chips"></div>
      <div id="chat-mediatab-media">${mediaHtml}</div>
      <div id="chat-mediatab-files" class="hidden">${filesHtml}</div>
      <div id="chat-mediatab-links" class="hidden">${linksHtml}</div>`;
    window.openPage('Shared Media', body);
    const chipsEl = document.getElementById('chat-mediatab-chips');
    if (chipsEl) {
      chipsEl.innerHTML = window.chipTabs([
        { key: 'media', label: 'Media', count: mediaItems.length || null },
        { key: 'files', label: 'Files', count: fileItems.length || null },
        { key: 'links', label: 'Links', count: linkItems.length || null }
      ], 'media');
      window.bindChipTabs(chipsEl, key => {
        ['media', 'files', 'links'].forEach(k =>
          document.getElementById('chat-mediatab-' + k)?.classList.toggle('hidden', k !== key));
      });
    }
    document.getElementById('chat-mediatab-media')?.querySelectorAll('.chat-mediatab-thumb').forEach(t => {
      t.addEventListener('click', () => _openLightbox(mediaItems, parseInt(t.dataset.idx, 10)));
    });

    // Wave5 M4 — About section wiring (group creator/admin only; the markup
    // above omits these controls entirely for everyone else, so nothing here
    // has anything to bind to on a non-admin's page).
    if (isGroupAdmin) {
      document.getElementById('chat-about-rename-btn')?.addEventListener('click', async () => {
        const newName = await promptDialog({ message: 'Group name:', value: conv.name || '' });
        if (newName === null) return;
        const trimmed = newName.trim();
        if (!trimmed || trimmed === conv.name) return;
        try {
          await db.collection('conversations').doc(conv.id).update({ name: trimmed });
          conv.name = trimmed;
          const aboutTitleEl = document.querySelector('.chat-about-title');
          if (aboutTitleEl) aboutTitleEl.textContent = trimmed;
          const threadTitleEl = document.querySelector('.ms-thread-title');
          if (threadTitleEl) threadTitleEl.textContent = trimmed;
          Notifs.success('Group renamed');
        } catch (_) { Notifs.showToast('Rename failed', 'error'); }
      });
      document.getElementById('chat-about-avatar')?.addEventListener('click', () => {
        document.getElementById('chat-about-photo-input')?.click();
      });
      document.getElementById('chat-about-photo-input')?.addEventListener('change', async e => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f || !/^image\//.test(f.type || '')) return;
        try {
          const { blob } = await _compressImage(f);
          const sref = storage.ref(`chat-files/${conv.id}/group_photo_${Date.now()}.jpg`);
          await sref.put(blob, { customMetadata: { uploadedBy: currentUser.uid } });
          const url = await sref.getDownloadURL();
          await db.collection('conversations').doc(conv.id).update({ photoUrl: url });
          conv.photoUrl = url;
          const imgHtml = `<img src="${escHtml(url)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`;
          const aboutAvatarEl = document.getElementById('chat-about-avatar');
          if (aboutAvatarEl) aboutAvatarEl.innerHTML = imgHtml;
          // Wave5 M4 — patch the thread header's own avatar live too ("avatar
          // renders photoUrl everywhere" — the inbox row picks it up on its
          // own next refresh, once the conversations snapshot echoes back).
          const threadAvatarEl = document.getElementById('chat-thread-avatar');
          if (threadAvatarEl) threadAvatarEl.innerHTML = imgHtml;
          Notifs.success('Group photo updated');
        } catch (_) { Notifs.showToast('Photo upload failed', 'error'); }
      });
      document.getElementById('chat-about-addmember-btn')?.addEventListener('click', () => _openAddMembersPicker(conv));
      // v14 chat re-audit fix — group admin could Add members but had no
      // Remove-member control anywhere (the only way OFF the roster was the
      // self-only Leave button). Removing another participant falls under
      // firestore.rules' unrestricted conv-doc update branch (createdBy==uid
      // || isAdmin() — no affectedKeys shape restriction, see ~line 453-454),
      // the SAME branch rename/photo/add-members already rely on, so this
      // needs no rules change. Gated to isGroupAdmin, and never shown on the
      // admin's own row (self-removal is what Leave is for).
      document.querySelector('.chat-about-members')?.addEventListener('click', async e => {
        const btn = e.target.closest('.chat-about-member-remove'); if (!btn) return;
        const uid = btn.dataset.uid;
        const nm = (conv.participantNames && conv.participantNames[uid]) || 'this person';
        if (!(await confirmDialog({ message: `Remove ${nm} from the group?`, danger: true }))) return;
        btn.disabled = true;
        try {
          await db.collection('conversations').doc(conv.id).update({
            participants: firebase.firestore.FieldValue.arrayRemove(uid),
            [`participantNames.${uid}`]: firebase.firestore.FieldValue.delete()
          });
          conv.participants = (conv.participants || []).filter(x => x !== uid);
          if (conv.participantNames) delete conv.participantNames[uid];
          const membersEl = document.querySelector('.chat-about-members');
          if (membersEl) {
            membersEl.innerHTML = conv.participants.map(u => _memberRowHtml(u, conv, isGroupAdmin)).join('');
            if (window.lucide) lucide.createIcons({ nodes: [membersEl] });
          }
          const subtitleEl = document.querySelector('.chat-about-subtitle');
          if (subtitleEl) subtitleEl.textContent = `${conv.participants.length} member${conv.participants.length!==1?'s':''}`;
          Notifs.success('Member removed');
        } catch (_) {
          Notifs.showToast('Could not remove member', 'error');
          btn.disabled = false;
        }
      });
    }

    // Messenger restyle Fix 4 — wallpaper (any conv type) + Leave (group,
    // any member — unchanged gate from the old header button) now live here
    // instead of the thread header's ⋮ menu / Leave button. Wallpaper is an
    // inline expand/collapse row (the SAME WALLPAPERS preset list/markup the
    // old header popover used, just toggled in place on this page instead of
    // floating off a header button) rather than a popover — simpler and more
    // robust inside an already-scrollable page (no outside-click plumbing
    // needed). _setWallpaper is unchanged: it always targets whatever
    // conversation is currently open (_openConvId/_openConv), which is this
    // page's conv since the info page only ever opens from an open thread.
    document.getElementById('chat-about-wallpaper-btn')?.addEventListener('click', () => {
      const btn = document.getElementById('chat-about-wallpaper-btn');
      const list = document.getElementById('chat-about-wallpaper-list');
      if (!list || !btn) return;
      const willOpen = list.classList.contains('hidden');
      list.classList.toggle('hidden', !willOpen);
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      btn.classList.toggle('chat-about-row-open', willOpen);
    });
    document.getElementById('chat-about-wallpaper-list')?.querySelectorAll('.ms-wallpaper-opt').forEach(optBtn => {
      optBtn.addEventListener('click', () => {
        _setWallpaper(optBtn.dataset.wp);
        document.getElementById('chat-about-wallpaper-list')?.classList.add('hidden');
        const btn = document.getElementById('chat-about-wallpaper-btn');
        btn?.setAttribute('aria-expanded', 'false');
        btn?.classList.remove('chat-about-row-open');
      });
    });
    document.getElementById('chat-about-leave-btn')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ message: 'Leave this group?', danger: true }))) return;
      await db.collection('conversations').doc(conv.id)
        .update({ participants: firebase.firestore.FieldValue.arrayRemove(currentUser.uid) })
        .catch(() => Notifs.showToast('Could not leave group', 'error'));
      _clearDraft(conv.id);   // v14 chat re-audit fix — leaving is the one place this file KNOWS a draft is now orphaned
      // Leaving makes both this info page AND the thread behind it stale —
      // close the whole stack back to the inbox (same net effect the old
      // header Leave button had via a single dismissTop(), just one level
      // deeper now that Leave lives on a page pushed ON TOP of the thread).
      window.Overlay.clearAll();
    });
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

    // Wave5 M1 (J7) — scroll-FAB unseen tally: count ids newly appended by
    // THIS render while the user is scrolled up, computed from the pre-patch
    // id set (prevIds/newOrder), before the DOM mutates below.
    if (canPatch && !atBottom) {
      const prevIds = _lastMsgIds || new Set();
      const arrived = newOrder.filter(id => !prevIds.has(id)).length;
      if (arrived > 0) _scrollFabUnseen += arrived;
    }

    if (canPatch) {
      _patchThread(el, list, oldOrder);
    } else {
      el.innerHTML = _threadHtml(list);
    }
    // Wave5 M1 (J2) — the pending-bubble tail lives OUTSIDE the keyed message
    // list entirely (see _patchThread's comment): ensure it exists as the
    // last child (full rebuilds above wipe it, so it's recreated fresh every
    // time) and repaint its contents from _pending[].
    _ensurePendingTailEl(el);
    _renderPendingTail();
    if (window.lucide) lucide.createIcons({ nodes: [el] });

    if (opts.keepScrollAnchor) {
      el.scrollTop = el.scrollHeight - prevScrollHeight + prevScrollTop;   // preserve visual anchor
    } else if (!_threadInitialScrollDone && list.length > 0) {
      // Wave5 M1 (J7) — one-time initial placement for this thread-open: land
      // on the "New messages" divider if one was inserted, else the bottom
      // (old behavior). Subsequent re-renders fall through to the normal
      // atBottom-preserving branch below — they never re-snap to the divider.
      const divider = document.getElementById('chat-new-divider');
      if (divider) divider.scrollIntoView({ block: 'start' });
      else el.scrollTop = el.scrollHeight;
      _threadInitialScrollDone = true;
    } else if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
    _updateScrollFab(el);
  }

  return { openDM, openConversation, openDeptChannel, sendMessage, toggleReaction,
           loadEarlier, onComposerInput, teardownInbox, teardownThread,
           dmIdFor, myDeptChannels, dmCandidates, setFilter, setSearch, _attachInbox,
           _attachGlobalBadgeListener, _detachGlobalBadgeListener };
})();

// ── Inbox page (router target: case 'chat') ──
window.renderChatPage = async function() {
  const c = document.getElementById('page-content'); if (!c) return;
  // v12 WS42 Phase 15: .chat-page wrapper is CSS-only two-pane *scaffolding* for
  // >=1024px (a left inbox column + reserved right column) — Batch D wires the
  // thread panel into the right column; this batch only lays the container down.
  // A wrapper div (not a class on #page-content itself) so it never leaks onto
  // the next page's render — it's discarded with the rest of this innerHTML.
  // Messenger restyle Fix 2 — slim inbox header: no big page title / no big
  // "+ New Message" band. "Chats" wordmark-weight title left, a small round
  // compose-icon button right (same New Message picker as before, just a
  // different trigger). Search + filter chips are unchanged.
  c.innerHTML = `
    <div class="chat-page">
      <div class="chat-page-inbox">
        <div class="ms-inbox-header">
          <div class="ms-inbox-header-title">Chats</div>
          <button type="button" class="ms-thread-menu-btn ms-compose-btn" id="chat-new-btn" title="New message" aria-label="New message">${emojiIcon('pen-line',18)}</button>
        </div>
        <div class="ms-search-wrap"><input id="chat-search-input" class="ms-search-input" placeholder="Search chats" /></div>
        <div id="chat-filter"></div>
        <div id="chat-inbox"><div class="loading-placeholder">Loading…</div></div>
      </div>
      <div class="chat-page-empty-pane">
        <div class="empty-state">
          <div class="empty-icon">${emojiIcon('💬',44)}</div>
          <h4>Select a conversation</h4>
          <p>Pick a chat from the list to start messaging.</p>
        </div>
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  const chips = [{ key: 'all', label: 'All' }, { key: 'dm', label: 'DMs' },
                 { key: 'group', label: 'Groups' }];
  if (window.Chat.myDeptChannels().length) chips.push({ key: 'dept', label: 'Channels' });
  chips.push({ key: 'archived', label: 'Archived' });   // Wave5 M4 (J7)
  document.getElementById('chat-filter').innerHTML = window.chipTabs(chips, 'all');
  window.bindChipTabs(document.getElementById('chat-filter'),
    k => window.Chat?.setFilter(k));
  // Wave1 P2 fix #12 — debounce the search input ~150ms before rebuilding the
  // whole inbox list, instead of a full rebuild on every single keystroke.
  let _chatSearchDebTimer = null;
  document.getElementById('chat-search-input')?.addEventListener('input', e => {
    const v = e.target.value;
    clearTimeout(_chatSearchDebTimer);
    _chatSearchDebTimer = setTimeout(() => window.Chat?.setSearch(v), 150);
  });
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
