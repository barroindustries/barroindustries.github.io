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
  let _threadPanelEl = null;                 // v14 Phase2b — the openPage-returned panel element.
                                              // The soft-keyboard re-pin (_onViewportResize) uses it as
                                              // its liveness guard, and _buildThreadPanel binds the
                                              // panel-level 'focusin' re-pin to it — never an id lookup.
  let _kbRepinTimers = [];                   // 2026-08 mobile-window model — the pending post-focus
                                              // re-pin timers scheduled by _scheduleKbRepin. Cleared by
                                              // teardownThread so a keyboard that opens as the panel is
                                              // closing can't scroll a thread that no longer exists.
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
  // ── Reaction-picker popover state (owner report 2026-08: "options are
  //    getting cut off"). The picker is now a fixed-position popover rather
  //    than an inline row inside the bubble column — see _openPickerFor. ──
  let _openPickerMid = null;      // data-mid of the ONE open picker, or null
  let _pickerDismissWired = false;// document/window dismiss listeners currently bound?
  let _pickerRaf = 0;             // pending coalesced reposition (rAF handle), 0 = none
  const PICKER_EDGE_MARGIN = 10;  // px kept clear of every edge of the clamp band
  const PICKER_GAP = 6;           // px between the bubble and the popover
  // Cancels the in-flight long-press timer of whichever thread scroller is
  // currently wired (_wireThreadDelegation installs it; teardownThread calls
  // it). The timer is a closure local of that function and the scroller is
  // rebuilt per thread, so without this handle a press started 400ms before a
  // thread close still fired 100ms after the panel was gone.
  let _cancelThreadPress = null;
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

  // Wave2 practicality batch — in-thread search (P0). Client-side over the
  // currently-loaded window (_earlier + _msgs) + on-demand loadEarlier() pages,
  // no separate index. _threadSearchCurrentMid (not a numeric index) survives
  // a loadEarlier() prepend cleanly — the match array is recomputed but the
  // "which message is the active hit" identity doesn't need to shift.
  let _threadSearchOpen = false, _threadSearchQ = '';
  let _threadSearchMatches = [];      // message ids, chronological (oldest→newest), within the loaded window
  let _threadSearchCurrentMid = null; // id of the currently-focused hit, or null
  // Wave2 practicality batch — offline/failed attachment sends (P1). Reuses
  // the existing _pending/_retryPending machinery byte-for-byte; only adds a
  // distinct 'offline' status (vs. 'failed') and an automatic retry on the
  // browser's 'online' event. See _markPendingOffline/doSend's catch below.
  // (The old HEIC_RE name sniff lived here. It only drove a "may not display
  // for recipients" toast, which _compressImage's always-transcode-to-JPEG rule
  // has made untrue — a decodable HEIC now leaves this device as a JPEG.)

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

  // ── Photo delivery: hand the sender's OWN pixels to the confirmed bubble ──
  // The sender already has the bytes. The optimistic bubble was showing an
  // object URL of the chosen file, and _reconcilePending revoked it the instant
  // the message doc echoed back — at which point the confirmed bubble
  // re-rendered pointing at the Storage DOWNLOAD url, a url this device has
  // never fetched (the upload was a PUT to a different endpoint). So the photo
  // the sender was already looking at went blank and had to come back DOWN the
  // same congested link it had just gone up. On mobile data that is the whole
  // "photos keep lagging" complaint.
  //
  // This map hands the local pixels over instead: Storage download url -> an
  // object URL for the EXACT blob that was uploaded to it. _mediaGridHtml
  // prefers it, so the confirmed bubble paints from memory with zero network.
  //
  // Deliberately NO eager warm-fetch of the remote url: warming would re-download
  // every photo the sender just uploaded, doubling their mobile data for no
  // visible gain. The blob simply stays until one of the bounded releases below.
  //
  // Lifetime (a leak here is a real memory cost on a long thread):
  //   - thread teardown / conversation switch  -> release all
  //   - more than LOCAL_PREVIEW_CAP entries    -> release oldest first
  // Release always repoints any live <img> at the remote url BEFORE revoking,
  // so an eviction can never blank a tile that is currently on screen.
  const LOCAL_PREVIEW_CAP = 12;
  const _localPreviews = new Map();          // remoteUrl -> { objUrl }
  function _localPreviewSrc(remoteUrl) {
    const e = _localPreviews.get(remoteUrl);
    // Only ever emit a blob: url this module itself minted — never anything
    // that arrived on a Firestore doc.
    return (e && typeof e.objUrl === 'string' && e.objUrl.slice(0, 5) === 'blob:') ? e.objUrl : '';
  }
  // `repoint` — swap live <img>s onto the remote url before revoking, so
  // releasing can never blank a photo that is on screen. TRUE for cap-eviction
  // (the bubble stays mounted and must keep showing something); FALSE at
  // teardown, where the DOM is being destroyed anyway.
  //
  // That distinction is not cosmetic, it is mobile data. openPage fires _onClose
  // BEFORE removing the panel (removal is deferred 300ms), and openConversation
  // tears down the outgoing thread while it is still mounted — so a blanket
  // repoint at teardown starts a remote fetch for every photo still on screen.
  // Measured at 3G, closing a thread holding six just-sent photos: 6 requests
  // started, 0 completed, 888 KB of a possible 1388 KB actually pulled, because
  // the browser does not abort promptly. That is the exact warm-fetch this
  // feature set out to avoid, just deferred to close, and it fired on every
  // close and every conversation switch.
  function _releaseLocalPreview(remoteUrl, repoint) {
    const e = _localPreviews.get(remoteUrl);
    if (!e) return;
    _localPreviews.delete(remoteUrl);
    const remote = repoint === false ? '' : safeHttpUrl(remoteUrl);
    // Repoint every live <img> at the remote url BEFORE revoking, so releasing
    // can never blank a photo that is currently on screen.
    // This one query is deliberately document-wide rather than panel-scoped:
    // the same blob can legitimately be showing in three different panels at
    // once (thread bubble, Shared Media thumb, lightbox), and the selector
    // matches on the exact object-URL string this module minted — it cannot
    // touch anything else on the page.
    if (remote) {
      try {
        document.querySelectorAll(`img[src="${e.objUrl}"]`).forEach(img => img.setAttribute('src', remote));
      } catch (_) { /* malformed selector — fall through to the revoke */ }
    }
    try { URL.revokeObjectURL(e.objUrl); } catch (_) {}
  }
  function _clearLocalPreviews() {
    // repoint:false — teardown. Also note Array#forEach passes the INDEX as the
    // second argument, so passing the function bare here would have handed
    // `repoint` a number (0 = falsy for the first entry, truthy after) — a bug
    // that would have looked intermittent. Wrapped deliberately.
    Array.from(_localPreviews.keys()).forEach(k => _releaseLocalPreview(k, false));
  }
  // `blob` is the COMPRESSED blob that was actually uploaded (not the original
  // file): identical bytes to what every reader will get, and ~10x less memory
  // to hold than the camera original.
  function _rememberLocalPreview(remoteUrl, blob) {
    if (!remoteUrl || !blob || _localPreviews.has(remoteUrl)) return;
    let objUrl;
    try { objUrl = URL.createObjectURL(blob); } catch (_) { return; }
    while (_localPreviews.size >= LOCAL_PREVIEW_CAP) {
      _releaseLocalPreview(_localPreviews.keys().next().value, true);   // still on screen — repoint
    }
    _localPreviews.set(remoteUrl, { objUrl });
  }

  // ── Upload progress + real cancel ──
  // storage.ref().put() returns an UploadTask that emits state_changed with
  // bytesTransferred/totalBytes. This file used to await the task and use NONE
  // of them, so a multi-hundred-KB upload over mobile data showed a static ⏳
  // with no indication anything was happening, and the ✕ "cancel" could only
  // hide the bubble (the byte pump kept running to completion).
  // Keyed by clientKey so one message's photos aggregate into ONE bar.
  const _uploadTasks = new Map();      // clientKey -> [UploadTask]
  const _uploadProgress = new Map();   // clientKey -> Map(partIdx -> {loaded,total})
  function _uploadPct(clientKey) {
    const parts = _uploadProgress.get(clientKey);
    if (!parts || !parts.size) return null;
    let loaded = 0, total = 0;
    parts.forEach(p => { loaded += p.loaded; total += p.total; });
    if (!total) return null;
    return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
  }
  // Paints the bar in place — a full _renderPendingTail() on every progress
  // event would rebuild the bubble's innerHTML dozens of times per upload.
  function _paintUploadProgress(clientKey) {
    const pct = _uploadPct(clientKey);
    if (pct === null) return;
    const tail = document.getElementById('chat-pending-tail');
    if (!tail) return;
    tail.querySelectorAll('.ms-pending-bar').forEach(bar => {
      if (bar.dataset.clientKey !== clientKey) return;
      const fill = bar.firstElementChild;
      if (fill) fill.style.width = pct + '%';
    });
  }
  function _forgetUpload(clientKey) {
    _uploadTasks.delete(clientKey);
    _uploadProgress.delete(clientKey);
  }
  function _cancelUploads(clientKey) {
    (_uploadTasks.get(clientKey) || []).forEach(t => { try { t.cancel(); } catch (_) {} });
    _forgetUpload(clientKey);
  }
  // put() wrapper that keeps the task reference and reports bytes. Awaiting the
  // returned task behaves exactly like awaiting put() did.
  function _putTracked(sref, blob, metadata, clientKey, partIdx) {
    const task = sref.put(blob, metadata);
    if (clientKey) {
      const list = _uploadTasks.get(clientKey) || [];
      list.push(task);
      _uploadTasks.set(clientKey, list);
      const parts = _uploadProgress.get(clientKey) || new Map();
      parts.set(partIdx, { loaded: 0, total: (blob && blob.size) || 0 });
      _uploadProgress.set(clientKey, parts);
      try {
        task.on('state_changed', snap => {
          const p = _uploadProgress.get(clientKey);
          if (!p) return;                                  // canceled / already reconciled
          p.set(partIdx, { loaded: snap.bytesTransferred || 0, total: snap.totalBytes || (blob && blob.size) || 0 });
          _paintUploadProgress(clientKey);
        }, () => { /* errors surface via the awaited promise below */ });
      } catch (_) { /* progress is a nicety — never let it break the upload */ }
    }
    return task;
  }
  function dmIdFor(a, b) { return 'dm_' + [a, b].sort().join('_'); }
  // Wave2 practicality batch (P1) — "Recents" for the dept-grouped New Message
  // picker: last N distinct people the CURRENT uid has opened a DM with,
  // most-recent-first, persisted to localStorage (login-scoped key, same
  // pattern as the chat nav badge's own per-uid storage key above). Recorded
  // from openDM() itself — the ONE chokepoint every "start/reopen a DM" path
  // in this file already goes through (New Message picker today; any future
  // caller inherits this for free too).
  const RECENT_DM_CAP = 10;
  function _recentDmKey() {
    const uid = (window.currentUser && currentUser.uid) || '';
    return uid ? ('bi-chat-recent-dms-' + uid) : null;
  }
  function _recordRecentDm(otherUid) {
    const key = _recentDmKey();
    if (!key || !otherUid) return;
    try {
      let list = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(list)) list = [];
      list = [otherUid, ...list.filter(u => u !== otherUid)].slice(0, RECENT_DM_CAP);
      localStorage.setItem(key, JSON.stringify(list));
    } catch (_) { /* best-effort — a missing/corrupt entry just means no Recents section */ }
  }
  function _recentDmIds() {
    const key = _recentDmKey();
    if (!key) return [];
    try {
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
  }
  function deptChannelKeys() {
    return Object.keys(window.DEPARTMENTS || {})
      .filter(d => !DEPARTMENTS[d].isSeparate && !DEPARTMENTS[d].isPartnerDept);
  }
  // Is THIS dept channel closed to a user holding THIS role? Takes the role as
  // an argument rather than reading window.currentRole, because the two callers
  // below ask about OTHER people (who to notify, who to offer as an @mention),
  // not about the signed-in user. Reads SECRETARY_BLOCKED_DEPTS
  // (js/departments.js) so the whole client keeps one definition of the set.
  function _deptChannelClosedToRole(role, department) {
    return role === 'secretary'
      && (window.SECRETARY_BLOCKED_DEPTS || ['Finance', 'IT']).includes(department);
  }
  function myDeptChannels() {
    if (typeof isPartner === 'function' && isPartner()) return [];  // partners NEVER
    // ⚠ CARVE-OUT GAP (2026-08-09). _isAdminRole() includes 'secretary', so the
    // Corporate Secretary's inbox listed EVERY department channel — including
    // # Finance and # IT, the two the owner explicitly closed to them
    // ("corporate secretary can access all departments except finance, and
    // IT"). Neither SECRETARY_BLOCKED_DEPTS nor canIt() reached chat.
    //
    // THE RULES HALF SHIPPED (2026-08-09) — this filter is now defence in
    // depth, not the only control. firestore.rules defines deptChannelOpen(d)
    // (= !isSecretary() || d is neither Finance nor IT) and applies it on all
    // three verbs of the dept-membership branch: memberOfDoc(), convMember()
    // and the dept-channel create rule. A direct read or post to
    // conversations/dept_Finance BY THAT BRANCH is refused at the boundary.
    // Keep this filter anyway: it stops the UI listing a channel the boundary
    // would then deny, which reads to the user as a broken app.
    //
    // The rules-side hole this used to describe is CLOSED (2026-08-10). For the
    // record, because the shape is worth remembering: memberOfDoc() tests
    // `uid in participants` first and unconditionally, and the conversations
    // update rule had a group-management branch gated on
    // `createdBy == uid || isAdmin()` — isAdmin() includes 'secretary' — that
    // allowed `participants` with NO membership precondition. Since a dept doc
    // id is deterministic ('dept_' + name), one write of {participants:[myUid]}
    // to conversations/dept_Finance made that first disjunct true and handed
    // over the whole thread, straight past deptChannelOpen().
    //
    // It was closed on the WRITE side, which is the only side that can be
    // closed: that branch now requires memberOfDoc() and refuses to touch
    // participants/participantNames on a type=='dept' doc, so a dept
    // conversation's participants array can never become non-empty (create
    // already pins it to []). Fencing the READ instead was tried and reverted
    // the same day — `allow read` also serves LIST, a list rule must be
    // provable from the query alone, and the inbox query
    // (participants array-contains uid) cannot prove a type field, so the fence
    // denied every inbox for every role.
    //
    // The filter below therefore remains what it always was: the client half,
    // so the channels never appear. It is not load-bearing for security.
    const blocked = (window.currentRole === 'secretary')
      ? (window.SECRETARY_BLOCKED_DEPTS || ['Finance', 'IT'])
      : [];
    return (_isAdminRole() ? deptChannelKeys()
      : deptChannelKeys().filter(d => (currentDepts || []).includes(d)))
      .filter(d => !blocked.includes(d));
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
    // Same "discard optimistic state" rule for the handed-off photo blobs and
    // any upload bookkeeping — this is the backstop that makes the local-preview
    // map incapable of leaking past a thread close.
    _clearLocalPreviews();
    _clearMeetingSubs();   // a listener must never outlive the thread that opened it
    _uploadTasks.clear(); _uploadProgress.clear();
    _threadOpenReadAtMs = 0; _threadInitialScrollDone = false; _scrollFabUnseen = 0;
    _replyTarget = null; _swipe = null;      // Wave5 M2 — reply-arm + in-flight swipe never survive a thread close
    // The reaction popover is fixed-positioned and its dismiss listeners live
    // on document/window, so neither dies with the panel element the way an
    // in-flow child would. _closePicker() is what unbinds them (and is a
    // no-op when nothing is open, so this stays idempotent like the rest of
    // this function).
    // The in-flight LONG-PRESS timer has to die first, for the same reason and
    // in this order: it lives in _wireThreadDelegation's closure, so it
    // survives the scroller element being replaced, and firing it after the
    // _closePicker() below would re-open a popover on a detached panel and
    // re-bind the dismiss listeners we are about to unbind (it also buzzes
    // navigator.vibrate ~350ms after the chat closed). Nulled so a second,
    // defensive teardown is a no-op like everything else here.
    if (_cancelThreadPress) { _cancelThreadPress(); _cancelThreadPress = null; }
    _closePicker();
    // Wave2 practicality batch — in-thread search never carries into the next
    // thread-open (matches _initialMarkReadPending's own reset just below).
    _threadSearchOpen = false; _threadSearchQ = ''; _threadSearchMatches = []; _threadSearchCurrentMid = null;
    document.getElementById('chat-thread-scroll')?.removeEventListener('scroll', _onThreadScroll);
    if (_presenceTimer)     { clearInterval(_presenceTimer);     _presenceTimer = null; }
    if (_typingExpireTimer) { clearInterval(_typingExpireTimer); _typingExpireTimer = null; }
    if (_markReadTimer)     { clearTimeout(_markReadTimer);      _markReadTimer = null; }
    // BOTH visualViewport signals, mirroring the add in _buildThreadPanel. This
    // used to remove 'resize' only; now that 'scroll' is bound too (a pure iOS
    // pan fires nothing else — see _onViewportResize), forgetting it here would
    // strand a live listener holding this module's closure past the thread's
    // own lifetime, and let a later pan scroll a torn-down thread.
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', _onViewportResize);
      window.visualViewport.removeEventListener('scroll', _onViewportResize);
    }
    // The panel-level 'focusin' listener needs no removal — it is bound to the
    // panel element itself, which openPage's teardown removes from the DOM. Its
    // in-flight timers do, though: they outlive the element.
    _kbRepinTimers.forEach(t => clearTimeout(t)); _kbRepinTimers = [];
    if (_emojiMenuOpen) document.removeEventListener('click', _emojiOutsideClick, true);   // Wave5 M2
    _emojiMenuOpen = false;
    _initialMarkReadPending = false;          // Wave1 P1 fix #7 — never carries into the next thread-open
    // NOTE (2026-08 mobile-window model): there is deliberately no chrome
    // restore and no CSS-variable cleanup left here. The old bespoke mechanism
    // (a chat-only full-screen body class plus a chat-only keyboard-offset
    // custom property on <html>, both owned by this file — grep the 2026-08
    // window-model commit if you need the retired names) is retired: an open
    // thread is now just a page on the generic window stack, so hiding and
    // restoring the topbar/nav is Overlay's job
    // (body.page-open, driven by Overlay._sync) and the visual-viewport
    // variables belong to window.ViewportSync in js/config.js, which is
    // app-lifetime, not thread-lifetime, and must not be cleared from here.
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
    // Wave2 practicality batch (P2 stretch) — announcement channels are a
    // group-shaped conv (participants array, no department) with restricted
    // posting; title resolution mirrors 'group' exactly.
    if (cv.type === 'announcement') return cv.name || 'Announcement';
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
      // Wave2 practicality batch — the "Groups" chip also surfaces announcement
      // channels (group-shaped membership, just restricted posting); no
      // separate filter chip added for a P2-stretch feature.
      : _filter === 'group' ? nonArchived.filter(cv => cv.type === 'group' || cv.type === 'announcement')
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
      let dmSubtitle = '';   // owner request — DM rows show the other person's role/dept under their name
      if (cv.type === 'dm') {
        const otherUid = (cv.participants || []).find(u => u !== myUid);
        const otherUser = _presenceByUid[otherUid];   // Wave5-cache users doc (photoUrl) — no extra read
        const pres = _presenceBucket(otherUser?.lastSeen);
        const dotColor = { green: '#30D158', orange: '#FF9F0A', gray: '#8E8E93' }[pres.dot] || '#8E8E93';
        avatarHtml = otherUser?.photoUrl
          ? `<div class="ms-avatar ms-avatar-lg" style="position:relative;flex-shrink:0;padding:0"><img src="${escHtml(otherUser.photoUrl)}" alt="${escHtml(title)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/><span class="ms-presence-dot" style="background:${dotColor}"></span></div>`
          : `<div class="ms-avatar ms-avatar-lg" style="position:relative;flex-shrink:0;background:${_avatarColorFor(otherUid||title)}">${initials(title)}<span class="ms-presence-dot" style="background:${dotColor}"></span></div>`;
        // Same role/dept resolution the Team directory + New Message picker
        // already use (window.ROLES[u.role].label, departments[] || department).
        if (otherUser) {
          const roleLabel = window.ROLES?.[otherUser.role]?.label || otherUser.role || '';
          const depts = Array.isArray(otherUser.departments) && otherUser.departments.length
            ? otherUser.departments
            : (otherUser.department ? [otherUser.department] : []);
          dmSubtitle = [roleLabel, depts.join(' · ')].filter(Boolean).join(' · ');
        }
      } else if (cv.type === 'group' || cv.type === 'announcement') {
        // Wave5 M4 — group avatar renders conv.photoUrl (set via the info
        // page's About section, creator/admin only) with initials fallback.
        // Wave2 practicality batch — announcement channels share this exact
        // rendering (see _convTitle above for the same 'group'-shaped treatment).
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
            ${dmSubtitle ? `<div class="chat-inbox-row-title">${escHtml(dmSubtitle)}</div>` : ''}
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
    _recordRecentDm(otherUid);   // Wave2 practicality batch (P1) — Recents for the New Message picker
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
    } else if (conv.type === 'group' || conv.type === 'announcement') {
      // Wave2 practicality batch — announcement channels are group-shaped
      // (see _convTitle/the inbox avatar branch above for the same rationale).
      title = conv.name || (conv.type === 'announcement' ? 'Announcement' : 'Group');
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
  // stay together with its button.
  //
  // ONE HEADER PER WINDOW (2026-08 mobile-window model) — this comment used to
  // end by flagging an unresolved defect: openPage's native header bar rendered
  // ABOVE .ms-thread-header, an extra slim bar that didn't exist before the
  // Phase2b rebuild, and fixing it needed a CSS change that was "out of scope
  // for a js/chat.js-only batch — flagged for the CSS owner". That fix has
  // shipped. styles.css now carries `#chat-thread-panel .page-panel-head
  // { display: none }` — unconditionally, at every width, not gated on a phone
  // media query — so .ms-thread-header is the window's single header on phone
  // and desktop alike, and nothing in THIS file hides that bar any more (the
  // old inline `genericHead.style.display='none'` stopgap is gone too).
  //
  // The `title` argument is still passed to openPage even though the element
  // that displays it is display:none: openPage puts it in .page-panel-title and
  // points the panel's aria-labelledby at that node, and a node referenced by
  // aria-labelledby contributes its text to the accessible name even when it is
  // hidden. So the panel keeps its accessible name for free — do not "clean up"
  // the argument.
  function _buildThreadPanel(conv) {
    const { title, avatarHtml } = _headerTitleAndAvatar(conv);
    const memberCount = (conv.participants || []).length;
    const subtitleHtml = conv.type === 'dm'
      ? `<span id="chat-presence-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:transparent;margin-right:4px"></span><span id="chat-presence-label" style="font-size:11px;color:var(--text-muted)"></span>`
      : conv.type === 'group'
        ? `<span style="font-size:11px;color:var(--text-muted)">${memberCount} member${memberCount!==1?'s':''}</span>`
        // Wave2 practicality batch (P2 stretch) — announcement channel: same
        // member-count line, plus a label so a read-only member knows why the
        // composer is hidden (see the ms-announcement-readonly banner below).
        : conv.type === 'announcement'
          ? `<span style="font-size:11px;color:var(--text-muted)">${memberCount} member${memberCount!==1?'s':''} · Announcements</span>`
          : `<span style="font-size:11px;color:var(--text-muted)">Department channel</span>`;
    // Messenger restyle Fix 4 — slim header: back + avatar + name/members +
    // (i) ONLY. Leave (group-only) and the wallpaper ⋮ preset picker used to
    // live here; both RELOCATED into the info page (_openMediaTab's About
    // section) — Leave as a red row at the bottom, wallpaper as an inline
    // "Chat wallpaper" row that expands the SAME WALLPAPERS preset list
    // in place. Reachable via the exact same (i) button as before.
    const infoBtnHtml = `<button id="chat-info-btn" class="ms-thread-menu-btn" title="Shared media, files &amp; links" aria-label="Shared media, files and links">${emojiIcon('info', 18)}</button>`;
    // Wave2 practicality batch (P0) — in-thread search trigger, right beside
    // the (i) info button (same .ms-thread-menu-btn treatment).
    const searchBtnHtml = `<button id="chat-search-btn" class="ms-thread-menu-btn" title="Search in this chat" aria-label="Search in this chat">${emojiIcon('search', 18)}</button>`;
    // Wave2 practicality batch (P2 stretch) — announcement channel: only the
    // creator or an admin may post; everyone else gets a read-only banner
    // instead of the composer. The composer markup below is ALWAYS rendered
    // (kept simple/safe — every existing wiring call below still finds its
    // element) but hidden via CSS + disabled attributes when canPost is false;
    // doSend() itself also short-circuits on !canPost as a defense-in-depth
    // guard (see below). Server-side enforcement is the firestore.rules text
    // in this batch's report — the UI gate alone is never the real wall.
    const canPost = conv.type !== 'announcement' || _canManageConv(conv);
    const readonlyBannerHtml = !canPost
      ? `<div class="ms-announcement-readonly">${emojiIcon('megaphone', 15)}<span>Only admins can post in this channel.</span></div>`
      : '';
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
        ${searchBtnHtml}
        ${infoBtnHtml}
      </div>
      <div id="chat-search-bar" class="ms-thread-search-bar hidden">
        <button type="button" id="chat-search-prev" class="ms-thread-search-nav" title="Previous match" aria-label="Previous match">${emojiIcon('chevron-up', 15)}</button>
        <button type="button" id="chat-search-next" class="ms-thread-search-nav" title="Next match" aria-label="Next match">${emojiIcon('chevron-down', 15)}</button>
        <input id="chat-search-input-thread" class="ms-thread-search-input" placeholder="Search in this chat"/>
        <span id="chat-search-count" class="ms-thread-search-count"></span>
        <button type="button" id="chat-search-close" class="ms-thread-search-nav" title="Close search" aria-label="Close search">${emojiIcon('x', 15)}</button>
      </div>
      <div id="chat-pinned-bar" class="ms-pinned-bar hidden"></div>
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
      ${readonlyBannerHtml}
      <div class="messenger-input-row${canPost ? '' : ' ms-composer-hidden'}">
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
          <button type="button" class="ms-attach-btn" id="chat-attach-ref" title="Attach a task, quote or bidding">${emojiIcon('link-2',18)}</button>
          <button type="button" class="ms-attach-btn" id="chat-attach-meeting" title="Schedule a meeting">${emojiIcon('calendar-plus',18)}</button>
        </div>
        <button type="button" class="ms-attach-btn" id="chat-emoji-btn" title="Emoji">${emojiIcon('smile',18)}</button>
        <textarea id="chat-input" class="ms-input" rows="1" placeholder="Type a message…" ${canPost ? '' : 'disabled'}></textarea>
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
    p.id = 'chat-thread-panel';   // preserve the id: styles.css keys the generic
                                  // head hide, the phone thread-header notch
                                  // inset, the >=1024px two-pane left offset AND
                                  // the .messenger-body max-height:none override
                                  // off this exact "#chat-thread-panel" id.
    _threadPanelEl = p;           // liveness guard + focusin host for the soft-keyboard
                                  // re-pin below — never an id lookup

    // openPage's generic .page-panel-body is padded + its own overflow:auto
    // scroll container; the messenger layout owns its OWN internal scroll
    // region (#chat-thread-scroll/.messenger-body) and needs to fill the
    // full available height edge-to-edge like the old fixed shell did.
    // Neutralize the two conflicting properties via inline style (no CSS
    // file in scope) while keeping the flex:1 sizing that makes it fill
    // the panel.
    const bodyEl = p.querySelector('.page-panel-body');
    if (bodyEl) bodyEl.style.cssText = 'flex:1;min-height:0;overflow:hidden;padding:0;display:flex;flex-direction:column;';

    // Chat renders its own messenger header (avatar/presence/search/info), so
    // the generic .page-panel-head would be a duplicate bar. It is hidden by
    // CSS now (`#chat-thread-panel .page-panel-head { display:none }`, see the
    // ONE HEADER PER WINDOW note above) rather than by an inline style from
    // here — all that's left is routing the messenger header's own back chevron
    // through the window stack, so Back/Esc/swipe-back/the chevron are one path.
    document.getElementById('chat-panel-back')
      ?.addEventListener('click', () => window.Overlay.dismissTop());

    _applyWallpaper(conv);
    // (No fullscreen toggle here any more — see teardownThread's note. A thread
    // is a page on the generic window stack, and the <=768px shell rules cover
    // it exactly like every other page.)
    // Leave-group and the wallpaper preset picker are wired inside
    // _openMediaTab's About section now (Fix 4) — nothing to bind here.

    // Wave5 M3 (J4) — ⓘ Shared Media/Files/Links info page.
    document.getElementById('chat-info-btn')?.addEventListener('click', () => _openMediaTab(conv));

    // Wave2 practicality batch (P0) — in-thread search wiring. The heavy
    // lifting (match computation, highlight, scroll-to-hit, paged
    // loadEarlier() on demand) lives in the module-level _threadSearch*
    // helpers below; this just wires the header button + collapsible bar.
    document.getElementById('chat-search-btn')?.addEventListener('click', () => _toggleThreadSearch());
    document.getElementById('chat-search-close')?.addEventListener('click', () => _toggleThreadSearch(false));
    document.getElementById('chat-search-prev')?.addEventListener('click', () => _threadSearchStep(-1));
    document.getElementById('chat-search-next')?.addEventListener('click', () => _threadSearchStep(1));
    let _threadSearchDebTimer = null;
    document.getElementById('chat-search-input-thread')?.addEventListener('input', e => {
      const v = e.target.value;
      clearTimeout(_threadSearchDebTimer);
      _threadSearchDebTimer = setTimeout(() => _setThreadSearchQuery(v), 150);
    });
    document.getElementById('chat-search-input-thread')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _threadSearchStep(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { _toggleThreadSearch(false); }
    });

    // Wave2 practicality batch (P2 stretch) — pinned-messages bar: NOT painted
    // here — at this point in the call sequence _openConv is still the
    // PREVIOUS thread's value (openConversation assigns it only after this
    // function returns; see that function's own comment on why). Painted from
    // openConversation itself right after _openConv is (re)assigned, and again
    // from the messages listener once _msgs/_earlier resolve (so a pinned
    // message's snippet/author show up as soon as the loaded window can
    // resolve them — a generic "Pinned message" fallback renders until then).

    // composer wiring: send → Chat.sendMessage({text, file, images, link}) then
    // clear input/attachment/preview (NO re-render call — the messages
    // listener repaints). pendingImages/pendingFile/pendingLink are mutually
    // exclusive "what's currently attached" slots, same as the pre-M3
    // file/link exclusivity — attaching one clears the other two. pendingRef
    // (Wave2 practicality batch, P0 record-link) is INDEPENDENT of that group
    // — a task/quote/bidding reference is plain metadata, not a competing
    // upload, so it can ride alongside a photo/file/link/text in the same send.
    // pendingMeeting is independent for the same reason as pendingRef: a
    // meeting pointer is metadata, not a competing upload, so it rides
    // alongside text/photo/file in one send.
    let pendingFile = null, pendingLink = null, pendingImages = [], pendingRef = null, pendingMeeting = null;
    const fileInp = document.getElementById('chat-file');
    const cameraInp = document.getElementById('chat-camera');
    const filePreview = document.getElementById('chat-file-preview');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    // Wave2 practicality batch — filePreview now composes from up to 2
    // independent slots (the file/image/link group, plus pendingRef), joined
    // with a middle dot when both are present.
    const updateFilePreview = () => {
      // Wave2 practicality batch — this moved from textContent to innerHTML
      // (to fit the emoji-icon glyphs), so every dynamic value below (file
      // name, link, ref label — all user/attacker-influenceable) MUST be
      // escHtml'd explicitly now; textContent used to do that for free.
      const parts = [];
      if (pendingFile) parts.push(`${emojiIcon('paperclip',12)} ${escHtml(pendingFile.name || 'file')}`);
      else if (pendingImages.length) parts.push(`${emojiIcon('camera',12)} ${pendingImages.length} photo${pendingImages.length > 1 ? 's' : ''} selected`);
      else if (pendingLink) parts.push(`${emojiIcon('link',12)} ${escHtml(pendingLink)}`);
      if (pendingRef) parts.push(`${emojiIcon(pendingRef.kind === 'task' ? 'clipboard-list' : pendingRef.kind === 'quote' ? 'file-text' : pendingRef.kind === 'post' ? 'megaphone' : 'landmark', 12)} ${escHtml(pendingRef.label)}`);
      // innerHTML sink — the title is user-authored, so escHtml is mandatory.
      if (pendingMeeting) parts.push(`${emojiIcon('calendar-days',12)} ${escHtml(pendingMeeting.title)}`);
      filePreview.innerHTML = parts.join(' &nbsp;·&nbsp; ');
      if (window.lucide) lucide.createIcons({ nodes: [filePreview] });
    };
    const updateSendState = () => { sendBtn.disabled = !((input.value || '').trim() || pendingFile || pendingImages.length || pendingLink || pendingRef || pendingMeeting); };
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
      updateFilePreview();
      updateSendState();
      setAttachExpanded(false);
      // Wave2 practicality batch (P1) — an undecodable image (typically HEIC/
      // HEIF on a browser with no built-in decoder) can't be transcoded via
      // canvas: canvas.drawImage() needs a successfully DECODED source in the
      // first place, so if the browser's own <img> can't decode it, there's
      // nothing to draw FROM. _compressImage already has this exact fallback
      // (its img.onerror resolves with the original file rather than
      // rejecting) — the gap this closes is that fallback being SILENT. Probe
      // async, fire-and-forget (never blocks attaching): warn instead of
      // quietly uploading a photo some recipients' browsers won't render.
      add.forEach(f => {
        _probeImageDecodable(f).then(ok => {
          if (ok) return;
          // Chat photo-lag fix — this used to only TOAST and then upload
          // anyway. Measured in Chromium: an undecodable HEIC takes
          // _compressImage's fallback and the full original is uploaded
          // unchanged (1.5MB in the test, real ones run 2-4MB), stored under a
          // ".jpg" name with no contentType, and renders as a permanently
          // broken image for every reader — minutes of mobile data spent on a
          // photo nobody can see. A photo this device cannot decode cannot be
          // transcoded either (canvas.drawImage needs a decoded source), so
          // there is no version of this send worth making: drop it here, while
          // the user is still standing in the composer and can pick another.
          const i = pendingImages.indexOf(f);
          // Still in the composer? Drop it. Already gone (the user sent or
          // removed it while this probe was in flight) — say nothing: a "can't
          // be sent" toast for a message already on its way would just be wrong.
          if (i === -1) return;
          pendingImages.splice(i, 1);
          updateFilePreview();
          updateSendState();
          Notifs.showToast(`"${f.name || 'photo'}" can't be opened on this device, so it can't be sent — save it as JPEG or PNG and try again`, 'error');
        });
        // NOTE: the old "HEIC may not display for recipients" warning is gone
        // on purpose. It is no longer true: a HEIC this device CAN decode is
        // now always transcoded to JPEG before upload (see _compressImage's
        // srcIsWebSafe rule), so recipients on any device get a JPEG.
      });
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
      updateFilePreview();
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
      updateFilePreview();
      updateSendState();
      setAttachExpanded(false);
    });
    // Wave2 practicality batch (P0) — "Attach a record" picker (task/quote/
    // bidding). Independent of the file/image/link group above — see
    // pendingRef's own comment at declaration.
    document.getElementById('chat-attach-ref')?.addEventListener('click', () => {
      _openRefPicker(ref => {
        pendingRef = ref;
        updateFilePreview();
        updateSendState();
        setAttachExpanded(false);
      });
    });

    // Owner request — "Can we make meeting appointments as well on chat".
    // Scheduling FROM a thread pre-fills the invitee list with that thread's
    // real members, which for a department channel is NOT conv.participants:
    // dept channels are created with participants:[] and membership is derived
    // from each user's department, so reading participants here would invite
    // NOBODY. _targetsFor is the one function that resolves this correctly.
    document.getElementById('chat-attach-meeting')?.addEventListener('click', async () => {
      setAttachExpanded(false);
      if (typeof window.openMeetingEditor !== 'function') { Notifs.error('Calendar unavailable'); return; }
      let invitees = [];
      try { invitees = await _targetsFor(conv); } catch (_) {}
      invitees = Array.from(new Set(invitees.concat([currentUser.uid])));
      window.openMeetingEditor(null, { convId: conv.id, invitees }, async (id) => {
        // Attach a POINTER, never the meeting's mutable state — the deployed
        // message rules allow exactly three shapes of message update and none
        // of them would let an RSVP be written onto the message doc.
        let title = 'Meeting';
        try { const m = await window.Meetings.get(id); if (m && m.title) title = m.title; } catch (_) {}
        pendingMeeting = { id, title };
        updateFilePreview();
        updateSendState();
      });
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
      // Wave2 practicality batch (P2 stretch) — announcement channel:
      // defense-in-depth guard (the composer is already hidden/disabled via
      // CSS when !canPost — see the bodyHtml above). Server-side enforcement
      // is the firestore.rules text in this batch's report.
      if (!canPost) return;
      const text = (input.value || '').trim();
      const file = pendingFile, link = pendingLink, images = pendingImages.slice();   // Wave5 M3 — snapshot before clearing
      const ref = pendingRef;                               // Wave2 — snapshot before clearing, same pattern
      const meeting = pendingMeeting;                       // same pattern again
      const replyTo = _replyTarget;                        // Wave5 M2 — captured BEFORE clearing below
      const mentions = _computeMentions(text, conv);        // Wave5 M2
      if (!text && !file && !link && !images.length && !ref && !meeting) return;
      _isSending = true;
      sendBtn.disabled = true;
      const clientKey = _newClientKey();
      const savedText = input.value;
      input.value = ''; _autoGrow(input);
      fileInp.value = ''; pendingFile = null; pendingLink = null; pendingImages = []; pendingRef = null; pendingMeeting = null;
      updateFilePreview();
      _replyTarget = null; _renderReplyChip();               // Wave5 M2 — clears on optimistic send, like the composer text
      document.getElementById('chat-mention-dd')?.classList.add('hidden');
      clearTimeout(_draftSaveTimer); _clearDraft(conv.id);
      updateSendState();
      _addPendingMessage({ clientKey, text, file, images, link, replyTo, ref, meeting });
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
        await window.Chat.sendMessage({ text, file, images, link, clientKey, replyTo, mentions, ref, meeting });
      } catch (e) {
        // v14 chat re-audit fix — canceled via the pending bubble's ✕ while
        // the send was in flight (_cancelPendingMessage): it's already gone
        // from _pending and the user has moved on, so don't resurrect the
        // composer text/attachment/draft or toast an error for a send they
        // explicitly dismissed.
        if (_canceledClientKeys.delete(clientKey)) return;
        // Wave2 practicality batch (P1) — robust offline attachment retry: an
        // image/file send that fails while the browser is OFFLINE is queued
        // (kept in _pending with the blob still attached, per
        // _addPendingMessage) rather than restored to the composer as a
        // regular "failed, edit and retry" bubble — the composer already
        // moved on (Wave1 P1 fix #6, above), so there's nothing to "restore
        // into" for the user to look at; the bubble itself IS the record, and
        // the 'online' listener below retries it automatically the moment
        // connectivity returns (also tap-to-retry, same as 'failed').
        // A generic upload failure with an active connection keeps the exact
        // pre-existing behavior: restore composer state, mark 'failed'.
        const isAttachmentSend = !!(file || images.length);
        if (isAttachmentSend && typeof navigator !== 'undefined' && navigator.onLine === false) {
          _markPendingOffline(clientKey);
          Notifs.info('You’re offline — this will send automatically once you’re back online.');
          return;
        }
        input.value = savedText; _autoGrow(input);
        if (file) pendingFile = file;
        else if (images.length) pendingImages = images;
        else if (link) pendingLink = link;
        if (ref) pendingRef = ref;
        if (meeting) pendingMeeting = meeting;
        if (file || images.length || link || ref || meeting) updateFilePreview();
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

    // (The composer 'blur' handler that used to live here is gone. It existed
    // solely to force the retired keyboard-offset custom property back to 0 and
    // zero the panel's inline `bottom` when a blur raced ahead of — or fired
    // instead of — the keyboard's own visualViewport 'resize'. Neither value
    // exists any more: the panel no
    // longer carries an inline bottom, so there is nothing that can get stuck
    // lifted. Enter-to-send is unaffected — that is the separate 'keydown'
    // listener above, and the typing beacon's own blur/idle handling lives in
    // onComposerInput/_clearOwnTyping.)

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

    // On-screen-keyboard handling (Phase 19, re-based on the 2026-08 window
    // model): keep the LAST MESSAGE visible when the keyboard opens or closes.
    // Three signals feed the one handler, because which of them iOS actually
    // fires for a keyboard is not something this codebase has measured on the
    // target device (an iPhone installed to the home screen), and
    // window.ViewportSync (js/config.js) publishes CSS variables rather than an
    // event we could subscribe to — it exposes only .refresh(). So chat keeps
    // its OWN listeners, now purely for the scroll re-pin:
    //   • vv 'resize' — the keyboard shrinks the visual viewport. The only
    //     signal the old handler bound.
    //   • vv 'scroll' — a PURE PAN: iOS slides the layout viewport up to reveal
    //     the caret without resizing anything, so offsetTop changes and 'resize'
    //     never fires at all. This is the case the old handler missed outright.
    //   • 'focusin' on the panel, re-fired at +250ms/+700ms (_scheduleKbRepin),
    //     because iOS standalone is known to swallow vv events around the
    //     keyboard's show/hide animation — the same belt-and-braces pattern
    //     ViewportSync itself uses, for the same reason.
    // The handler is idempotent and read-mostly (it no-ops unless the reader was
    // already at the bottom), so firing more often than strictly necessary costs
    // nothing.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', _onViewportResize, { passive: true });
      window.visualViewport.addEventListener('scroll', _onViewportResize, { passive: true });
    }
    // 'focusin', not 'focus': focus doesn't bubble, and this one panel-level
    // listener has to cover the composer textarea, the in-thread search input
    // (which never had any keyboard handling of its own) and anything added
    // later. Bound to the panel element, so it is removed with it.
    p.addEventListener('focusin', _scheduleKbRepin);
  }

  // WS42 Phase 19 — auto-grow the composer textarea up to a 5-line cap (the
  // cap itself lives in CSS as `.ms-input { max-height }`; this just measures
  // scrollHeight so it grows/shrinks with content, transform/opacity untouched).
  function _autoGrow(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }
  // ── (Retired 2026-08: the bespoke full-screen mechanism that used to live
  // here — _isPhoneWidth()/_enterFullscreenIfPhone()/_exitFullscreen(), toggling
  // a chat-only body class at a one-off 640px breakpoint. It predated the generic
  // window model and duplicated it badly: its own breakpoint (640 vs the shell's
  // 768, so 641-768px phones-in-landscape got the app chrome AND a full-cover
  // thread), its own chrome-hiding rules, and its own keyboard geometry. All
  // three are now generic — the <=768px .page-panel rules cover an open thread
  // exactly like an open task detail, isPhoneShell() (js/config.js) is the one
  // phone-tier check, and Overlay owns body.page-open. Deleted rather than
  // re-pointed at 768px: nothing chat-specific was left in it. ──
  // Wave1 P1 fix #7 / P2 fix #17 — shared "is the reader at/near the bottom
  // of the thread" check (same 60px threshold _renderThread's own atBottom
  // calc uses), reused by the read-receipt gate, the image-decode re-snap,
  // and the keyboard/viewport re-snap below.
  function _isNearBottomEl(el) {
    return !!el && (el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }
  // Soft-keyboard / visual-viewport handler. PANEL GEOMETRY IS NO LONGER THIS
  // FILE'S BUSINESS. It used to write two things here — a keyboard-offset
  // custom property on <html> (consumed by a now-deleted phone-only
  // `#chat-thread-panel { bottom: var(...) !important }` rule) and a matching
  // inline `panel.style.bottom` for the widths that rule didn't cover. Both are
  // gone: the window model anchors every open page to the VISUAL viewport
  // (`top: var(--vv-top); height: var(--vvh)`) from ViewportSync's variables,
  // which is strictly better than lifting a bottom edge — it fixes the top edge
  // sliding under the status bar during an iOS pan, which no amount of `bottom`
  // ever could — and it is one rule for every window instead of a chat-only
  // special case. Chat writing its own geometry on top of that would fight it.
  //
  // What CSS genuinely cannot do is the reason this handler still exists: the
  // message list is a scroll container, and shortening it (keyboard up) or
  // growing it back (keyboard down) leaves a reader who was pinned to the newest
  // message staring at the middle of the thread instead. So all that is left
  // here is the re-pin.
  function _onViewportResize() {
    // Liveness guard (Phase2b #3): a vv event can land after teardownThread has
    // run but before the panel element is off the DOM, and during an
    // opts.replace swap two panels briefly coexist.
    if (!_threadPanelEl || !_threadPanelEl.isConnected) return;
    const scroll = document.getElementById('chat-thread-scroll');
    // Wave1 P2 fix #17 — only re-pin to the bottom if the reader was ALREADY
    // there before the keyboard/viewport change; otherwise this silently
    // yanked anyone scrolled up reading older history back down every time
    // the soft keyboard opened or closed.
    if (scroll && _isNearBottomEl(scroll)) scroll.scrollTop = scroll.scrollHeight;
  }
  // Re-run the re-pin ACROSS the keyboard's own show/hide animation. A single
  // synchronous pass at focus time measures the pre-keyboard layout and achieves
  // nothing, and iOS standalone is known to swallow the visualViewport events
  // that would otherwise cover the gap. Offsets mirror ViewportSync's
  // (js/config.js) deliberately — same failure, same remedy. Bounded at two
  // pending timers: each call cancels the previous pair, so rapid re-focus
  // (composer -> search -> composer) cannot pile them up, and teardownThread
  // clears whatever is still pending.
  function _scheduleKbRepin() {
    _kbRepinTimers.forEach(t => clearTimeout(t));
    _kbRepinTimers = [setTimeout(_onViewportResize, 250), setTimeout(_onViewportResize, 700)];
    _onViewportResize();
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
    // Wave2 practicality batch (P2 stretch) — pinned-messages bar: safe to
    // paint now that _openConv points at the conv actually being opened (the
    // #chat-pinned-bar DOM already exists — _buildThreadPanel injected it
    // just above). Repainted again once the messages listener resolves (see
    // its onSnapshot callback below) so snippets fill in as the window loads.
    _renderPinnedBar();
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
    _clearLocalPreviews();
    _clearMeetingSubs();   // a listener must never outlive the thread that opened it
    _uploadTasks.clear(); _uploadProgress.clear();
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
        // Wave2 practicality batch (P0) — recompute search matches against the
        // freshly-loaded window (a new incoming message might match the
        // active query) and refresh the pinned bar's snippet resolution now
        // that more of _msgs is available (see _renderPinnedBar's own comment).
        if (_threadSearchQ.trim()) { _computeThreadSearchMatches(); _updateThreadSearchUI(); }
        _renderPinnedBar();
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
  // Wave2 practicality batch (P1) — cheap decode probe used ONLY to decide
  // whether to warn the sender at attach-time (see _addPendingImages above).
  // Deliberately NOT reused by _compressImage itself — that function's own
  // img.onerror fallback (below) already has to run the real compress
  // attempt regardless, so a separate up-front probe there would just be a
  // second decode of the same bytes for no benefit.
  function _probeImageDecodable(file) {
    return new Promise(resolve => {
      if (!file || !/^image\//.test(file.type || '')) { resolve(true); return; }
      let url;
      try { url = URL.createObjectURL(file); } catch (_) { resolve(true); return; }
      const img = new Image();
      const done = ok => { try { URL.revokeObjectURL(url); } catch (_) {} resolve(ok); };
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = url;
    });
  }
  // Chat photo-lag fix. Four changes from the original, each load-bearing:
  //
  // 1. ALWAYS resolves real pixel dimensions for a decodable image. The old
  //    code returned w/h = null on BOTH the <300KB skip and the decode-fail
  //    fallback, and null w/h is what collapses the receiving tile to 0px tall
  //    (see _mediaGridHtml) — an empty bubble until the bytes land.
  // 2. Compressed for a MESSAGE, not an archive: 1280px long edge / q=0.72
  //    instead of 1600/0.85. Measured on real 12MP camera photos in WebKit
  //    (= the encoder iPhones actually use): 649/611/611 KB -> 351/318/311 KB,
  //    about -47%. 1280px still far over-serves a bubble that is at most 260
  //    CSS px wide even at 3x DPR, and holds up in the lightbox.
  // 3. The blanket "<300KB: upload verbatim" skip is gone — it uploaded full
  //    bytes AND produced the 0px tile. It is replaced by a NEVER-INFLATE rule,
  //    which is what the skip was really groping for: re-encoding an
  //    already-small image can make it BIGGER (measured: a 208KB 1200px photo
  //    came back 300KB at 1280/0.72 on WebKit), so keep whichever blob is
  //    smaller — but keep the true dimensions either way.
  // 4. Decodes from an object URL instead of a FileReader data URL. Same
  //    decoder, but it no longer materialises the whole file as a base64
  //    string first (~4MB for a 12MP photo, ~21MB for a 48MP one) — that
  //    string was pure peak-memory risk on iOS. _probeImageDecodable already
  //    decodes these same files this way in production, so the path is proven.
  //
  // Resolves { blob, width, height, transcoded }:
  //   width/height — true pixel size OF `blob` (null only if undecodable)
  //   transcoded   — true when `blob` is a freshly encoded JPEG, false when it
  //                  is the original file's own bytes (the caller needs this to
  //                  pick the stored extension and contentType).
  const CHAT_IMG_MAX_DIM = 1280;
  const CHAT_IMG_QUALITY = 0.72;
  // Formats every recipient's browser can render. Anything else (HEIC/HEIF and
  // friends) is ALWAYS transcoded when we can decode it, even if that makes the
  // file bigger — interoperability beats bytes for a photo half the office
  // otherwise cannot see at all.
  const WEB_SAFE_IMG_TYPE = /^image\/(jpeg|jpg|png|gif|webp)$/i;
  const WEB_SAFE_IMG_EXT = /\.(jpe?g|png|gif|webp)$/i;
  function _compressImage(file) {
    return new Promise(resolve => {
      const asIs = (w, h) => resolve({ blob: file, width: w || null, height: h || null, transcoded: false });
      if (!file || !/^image\//.test(file.type || '')) { asIs(); return; }
      let objUrl = null;
      try { objUrl = URL.createObjectURL(file); } catch (_) {}
      if (!objUrl) { asIs(); return; }
      const img = new Image();
      const done = () => { try { URL.revokeObjectURL(objUrl); } catch (_) {} };
      img.onload = () => {
        const natW = img.naturalWidth || img.width, natH = img.naturalHeight || img.height;
        if (!natW || !natH) { done(); asIs(); return; }
        // An animated GIF would come out of the canvas as a single still frame.
        // Keep the original bytes — but now WITH dimensions, so it still gets a
        // properly reserved tile.
        if (/^image\/gif$/i.test(file.type || '')) { done(); asIs(natW, natH); return; }
        let width = natW, height = natH;
        if (width > CHAT_IMG_MAX_DIM || height > CHAT_IMG_MAX_DIM) {
          const scale = CHAT_IMG_MAX_DIM / Math.max(width, height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }
        let canvas;
        try {
          canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        } catch (_) { done(); asIs(natW, natH); return; }   // e.g. out of memory on a huge source
        canvas.toBlob(blob => {
          done();
          const srcIsWebSafe = WEB_SAFE_IMG_TYPE.test(file.type || '') || WEB_SAFE_IMG_EXT.test(file.name || '');
          if (blob && (blob.size < file.size || !srcIsWebSafe)) {
            resolve({ blob, width, height, transcoded: true });
          } else {
            asIs(natW, natH);
          }
        }, 'image/jpeg', CHAT_IMG_QUALITY);
      };
      img.onerror = () => { done(); asIs(); };
      img.src = objUrl;
    });
  }
  // Stored-object extension for an image we did NOT transcode. The old code
  // appended ".jpg" to EVERYTHING, so an undecodable HEIC was stored as
  // "...jpg" while actually containing HEIC bytes — _isImageUrl then matched
  // the name, the renderer confidently emitted an <img>, and every reader got a
  // permanently broken image.
  function _imgExtFor(file) {
    const m = /\.([a-z0-9]{1,5})$/i.exec((file && file.name) || '');
    if (m && WEB_SAFE_IMG_EXT.test('.' + m[1])) return m[1].toLowerCase();
    const t = ((file && file.type) || '').toLowerCase();
    if (t === 'image/png') return 'png';
    if (t === 'image/gif') return 'gif';
    if (t === 'image/webp') return 'webp';
    return 'jpg';
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
  async function sendMessage({ text, file, images, link, clientKey, replyTo, forwardedFrom, mentions, ref, meeting,
                                conv: convParam, fileUrl: preFileUrl, fileName: preFileName, fileSource: preFileSource,
                                media: preMedia }) {
    const conv = convParam || _openConv; if (!conv) return;
    const FV = firebase.firestore.FieldValue;
    let fileUrl = null, fileName = null, fileSource = null, media = null;
    if (images && images.length) {
      // Wave5 M3 (J4) — multi-photo: compress EACH image (1280px/0.72, see
      // _compressImage), upload in parallel, and write ONE message carrying
      // media:[{url,name,w,h}] — never fileUrl. Cap (6/message) is already
      // enforced by the composer (_addPendingImages); re-sliced here too as a
      // defensive floor in case a future caller (e.g. a retry path) doesn't.
      // A failure on ANY photo throws so the WHOLE optimistic bubble
      // fails/retries as one unit — same "throw, don't silently drop" rule
      // Phase 63 #1 established for the single-file path below.
      try {
        media = await Promise.all(images.slice(0, 6).map(async (f, i) => {
          const { blob, width, height, transcoded } = await _compressImage(f);
          // Storage PATH is unchanged: chat-files/{convId}/{fileName}. Only the
          // fileName part changes — a real extension instead of an unconditional
          // ".jpg" (see _imgExtFor), and the base name is now restricted to
          // filename-safe characters. A name containing "/" used to nest a
          // subfolder, which storage.rules' {fileName} segment does not match,
          // so that upload was silently denied.
          const rawName = (f.name || 'photo').replace(/\.[^./\\]+$/, '');
          const baseName = rawName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'photo';
          const ext = transcoded ? 'jpg' : _imgExtFor(f);
          const sref = storage.ref(`chat-files/${conv.id}/${Date.now()}_${i}_${baseName}.${ext}`);
          // contentType was never set before, so Storage inferred it from the
          // blob — which is how HEIC bytes ended up served under a .jpg name.
          // cacheControl was never set either: object names are timestamped and
          // never mutate, so without it every reader re-downloaded every photo
          // on every single thread open.
          await _putTracked(sref, blob, {
            contentType: transcoded ? 'image/jpeg' : (f.type || 'image/jpeg'),
            cacheControl: 'public, max-age=31536000, immutable',
            customMetadata: { uploadedBy: (window.currentUser && currentUser.uid) || '' }
          }, clientKey, i);
          const url = await sref.getDownloadURL();
          // Hand THESE bytes to the confirmed bubble so the sender's own photo
          // never has to be downloaded back off the network.
          _rememberLocalPreview(url, blob);
          return { url, name: f.name || 'photo', w: width || null, h: height || null };
        }));
      } catch (_) {
        throw new Error('Photo upload failed — message not sent.');
      } finally {
        _forgetUpload(clientKey);
      }
    } else if (file) {
      try {
        const sref = storage.ref(`chat-files/${conv.id}/${Date.now()}_${file.name}`);
        // Same two additions as the photo path: a progress-reporting put (the
        // ⏳ was static before) and a cacheControl so the attachment isn't
        // re-fetched on every thread open. contentType is deliberately left to
        // Storage's own inference from the File here — this branch carries
        // arbitrary documents, and storage.rules' isValidDocument() denylist
        // keys off that inferred type.
        await _putTracked(sref, file, {
          cacheControl: 'public, max-age=31536000, immutable',
          customMetadata: { uploadedBy: (window.currentUser && currentUser.uid) || '' }
        }, clientKey, 0); fileUrl = await sref.getDownloadURL(); fileName = file.name;
      } catch (_) {
        // Phase 63 #1: THROW instead of silently returning — a silent return
        // here used to let the caller (doSend) clear the input/attachment as
        // if the send had succeeded (silent data loss). All user-facing
        // messaging for a failed send happens once, in doSend's catch.
        throw new Error('File upload failed — message not sent.');
      } finally {
        _forgetUpload(clientKey);
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
    // Wave2 practicality batch (P0) — record-link chip: {kind, id, label,
    // collection?}. `collection` disambiguates WHICH quote collection
    // (bk_quotes/bs_quotes) or gov bucket (gov_philgeps/gov_active_bids/
    // gov_archive) the id lives in — absent for kind:'task' (one collection).
    // Set-once-at-create, like replyTo/forwardedFrom/mentions above (never
    // mutated afterward), so it's deliberately excluded from _msgRev too.
    if (ref && ref.kind && ref.id) {
      msgDoc.ref = { kind: ref.kind, id: ref.id, label: (ref.label || 'Linked record').slice(0, 140) };
      if (ref.collection) msgDoc.ref.collection = ref.collection;
    }
    // Meeting pointer — an ID and a title snapshot, nothing mutable. RSVP and
    // times are read live from meetings/{id}; they can NOT live here, because
    // the deployed message rules allow exactly three shapes of update (author
    // edit with authorId/createdAt frozen, admin tombstone, reactions-only) and
    // an rsvp write onto a message doc would be denied outright.
    // OMITTED entirely when absent — that is this file's stated backward-compat
    // contract, so there is no migration and no message-rules change.
    if (meeting && meeting.id) {
      msgDoc.meeting = { id: meeting.id, title: String(meeting.title || 'Meeting').slice(0, 140) };
    }
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
                         : fileUrl ? `📎 ${fileName || 'File'}`
                         // Wave2 practicality batch (P0) — a ref-only send (no text/
                         // file/media/link, just a task/quote/bidding chip) needs its
                         // own preview branch — the old fallback (`📎 ${fileName||'File'}`)
                         // would otherwise misreport it as a generic attachment.
                         // The glyph here MUST stay a PLAIN emoji — this
                         // string is written to conv.lastMessageText AND used
                         // as the FCM push body, neither of which interprets
                         // HTML, so emojiIcon() (which returns `<i data-lucide>`)
                         // would display as literal markup. See the block
                         // comment above.
                         // PLAIN emoji — see the block comment above. This
                         // string is conv.lastMessageText AND the FCM push body.
                         : msgDoc.meeting ? `📅 ${msgDoc.meeting.title}`
                         : (msgDoc.ref ? `${msgDoc.ref.kind === 'post' ? '📣' : '🔗'} ${msgDoc.ref.label}` : '');
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
        // Owner ruling 3: a department ASSIGNMENT must never beat the role
        // decision. A Corporate Secretary whose profile lists Finance or IT is
        // a member by this filter, but the rules refuse them the channel
        // (deptChannelOpen, firestore.rules) — so notifying them would deliver
        // the message preview, in-app AND on the lock screen, for a thread that
        // then will not open. Same reasoning as the partner guard in
        // _forwardBlockReason below: a push notification never passes through
        // the conversation rules, so the SENDER's client is the only place this
        // can be stopped.
        .filter(u => !_deptChannelClosedToRole(u.role, conv.department))
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
    // Same reasoning as the quote above, for the meeting card: the pointer on
    // the message never changes, so without this the card's time and RSVP
    // counts would be frozen at send time forever.
    const mt = m.meeting && m.meeting.id ? '|m:' + _meetingRev(m.meeting.id) : '';
    return JSON.stringify(m.reactions || {}) + '|' + (m.text || '') + '|' +
      (m.deleted ? 1 : 0) + '|' + (m.editedAt ? 1 : 0) + '|' + (m.fileUrl || '') + '|' +
      JSON.stringify(m.media || []) + q + mt;
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
  // Wave2 practicality batch (P0) — record-link chip. Shared by the confirmed-
  // message renderer (_renderMessagePart) and the optimistic pending bubble
  // (_renderPendingBubble), same "one markup, two callers" pattern as
  // _replyQuoteHtml above. `ref` is `{kind, id, label, collection?}` — absent
  // on every message that isn't a record-link, rendering nothing.
  // Reuses .ms-file-chip's existing visual language (rounded pill, icon +
  // label) rather than adding new CSS — a plain <div role="button"> instead
  // of an <a> since this triggers an in-app opener (_openRefChip), not a URL.
  // ── Meeting cards: keeping them LIVE ──────────────────────────────────
  // The message carries only {id, title} and never changes, so _patchThread —
  // which repaints a row only when _msgRev(m) changes — would freeze the card
  // at whatever the counts were when it was sent. Same shape of problem as a
  // reply quote whose original gets edited, so the same solution: hold the
  // live doc in a cache, subscribe to it, and fold its state into the row's
  // rev hash. One listener per visible meeting (not an `in` query) because a
  // multi-doc query fails WHOLESALE if the reader may not see one of the docs,
  // and a thread can easily contain a meeting you were never invited to.
  const _meetingCache = new Map();     // id -> doc data, or null when unreadable
  const _meetingSubs  = new Map();     // id -> unsubscribe
  const MEETING_SUB_CAP = 12;
  function _meetingRev(id) {
    const m = _meetingCache.get(id);
    if (m === undefined) return '?';
    if (m === null) return 'x';
    return (m.status || '') + ':' + (m.title || '') + ':' +
      (m.startAt && m.startAt.toMillis ? m.startAt.toMillis() : 0) + ':' +
      JSON.stringify(m.rsvp || {});
  }
  function _syncMeetingSubs(list) {
    const want = [];
    (list || []).forEach(m => { if (m && m.meeting && m.meeting.id && want.indexOf(m.meeting.id) === -1) want.push(m.meeting.id); });
    const keep = new Set(want.slice(-MEETING_SUB_CAP));   // newest messages win the cap
    _meetingSubs.forEach((un, id) => { if (!keep.has(id)) { try { un(); } catch (_) {} _meetingSubs.delete(id); } });
    keep.forEach(id => {
      if (_meetingSubs.has(id)) return;
      try {
        const un = db.collection('meetings').doc(id).onSnapshot(
          d => { _meetingCache.set(id, d.exists ? d.data() : null); _renderThread(); },
          _ => { _meetingCache.set(id, null); _renderThread(); }   // denied/offline — say so, never guess
        );
        _meetingSubs.set(id, un);
      } catch (_) { _meetingCache.set(id, null); }
    });
  }
  function _clearMeetingSubs() {
    _meetingSubs.forEach(un => { try { un(); } catch (_) {} });
    _meetingSubs.clear(); _meetingCache.clear();
  }
  // ONE markup, TWO callers (_renderMessagePart and _renderPendingBubble) —
  // the same contract _refChipHtml/_replyQuoteHtml follow.
  function _meetingCardHtml(mt) {
    if (!mt || !mt.id) return '';
    const live = _meetingCache.get(mt.id);
    const M = window.Meetings;
    let when = '', where = '', counts = '', cancelled = false;
    if (live && M) {
      const h = M._h;
      when = `${h.dayOf(live.startAt)} · ${h.hhmm(live.startAt)}` + (live.endAt ? '–' + h.hhmm(live.endAt) : '');
      where = live.location || '';
      const c = { yes: 0, no: 0, maybe: 0 };
      Object.values(live.rsvp || {}).forEach(v => { if (c[v] != null) c[v]++; });
      counts = `${c.yes} going · ${c.maybe} maybe · ${c.no} declined`;
      cancelled = live.status === 'cancelled';
    } else if (live === null) {
      when = 'Not shown — you are not on this meeting';
    }
    const title = (live && live.title) || mt.title || 'Meeting';
    return `<div class="ms-file-chip chat-meeting-tap" role="button" tabindex="0"
        style="margin-top:5px;cursor:pointer;flex-direction:column;align-items:flex-start;gap:2px"
        data-meeting-id="${escHtml(mt.id)}">
      <div style="display:flex;align-items:center;gap:6px">${emojiIcon('calendar-days',14)}<span style="font-weight:700">${escHtml(title)}</span></div>
      ${cancelled ? `<span style="font-size:11px;color:var(--danger,#c00);font-weight:700">Cancelled</span>` : ''}
      ${when   ? `<span style="font-size:11px;opacity:.85">${escHtml(when)}</span>` : ''}
      ${where  ? `<span style="font-size:11px;opacity:.85">${escHtml(where)}</span>` : ''}
      ${counts ? `<span style="font-size:11px;opacity:.7">${escHtml(counts)}</span>` : ''}
    </div>`;
  }

  function _refChipHtml(ref) {
    if (!ref || !ref.kind || !ref.id) return '';
    // 'post' uses the SAME icon NAV_REGISTRY gives the Posts page ('megaphone',
    // js/config.js) so the chip reads as "a Post" at a glance. Without an arm
    // here a post chip would fall through to 'landmark' — this ternary has no
    // default branch of its own.
    const icon = ref.kind === 'task' ? 'clipboard-list'
      : ref.kind === 'quote' ? 'file-text'
      : ref.kind === 'post' ? 'megaphone'
      : 'landmark';
    return `<div class="ms-file-chip chat-ref-tap" role="button" tabindex="0" style="margin-top:5px;cursor:pointer"
        data-kind="${escHtml(ref.kind)}" data-id="${escHtml(ref.id)}" data-collection="${escHtml(ref.collection || '')}" data-label="${escHtml(ref.label || '')}">
      ${emojiIcon(icon, 14)}<span>${escHtml(ref.label || 'Linked record')}</span>
    </div>`;
  }
  // Opens the record a ref chip points at. navigateTo() (js/app.js) has no
  // record-level deep-link — confirmed by recon: it only ever dispatches to a
  // whole PAGE (`case 'tasks': renderTasks(...)`), never a specific doc. The
  // real per-record entry points are dedicated globals a couple of screens
  // already expose for exactly this ("open one record") purpose:
  //   - tasks:   window.openTaskDetail(id, currentUser, currentRole) — already
  //     used this way by js/notifications.js's own deep-link handler.
  //   - quotes:  window.reopenQuoteFromDoc(collection, id) — loads the quote
  //     into the quote-builder iframe (its OWN internal navigateTo call); only
  //     works if the doc has an editableState snapshot, else it toasts itself.
  //   - biddings: no equivalent exists — openGovBidDetail(d) is a private
  //     closure inside departments.js's renderDocCollection, never exposed on
  //     window, and takes an already-fetched doc object rather than an id.
  //     Best available fallback without editing departments.js: land on the
  //     whole Government Biddings page (navigateTo('dept:Government
  //     Biddings')) — flagged as a follow-up in this batch's report (a small
  //     `window.openGovBidDetailById(bucket, id)` export would close this gap).
  function _openRefChip(ref) {
    if (!ref || !ref.kind || !ref.id) return;
    try {
      if (ref.kind === 'task') {
        if (typeof window.openTaskDetail === 'function') {
          window.openTaskDetail(ref.id, window.currentUser, window.currentRole);
        } else if (typeof window.navigateTo === 'function') {
          window.navigateTo('tasks');
        }
      } else if (ref.kind === 'quote') {
        if (typeof window.reopenQuoteFromDoc === 'function') {
          window.reopenQuoteFromDoc(ref.collection || 'bk_quotes', ref.id);
        } else {
          Notifs.showToast('Quote viewer unavailable', 'error');
        }
      } else if (ref.kind === 'post') {
        // window.openPostById (js/screens/people.js) fetches the ONE post doc
        // and renders it into its own page — deliberately NOT the feed, which
        // opens on General with .limit(30) and therefore cannot reach a shared
        // department post or anything older than the 30 most recent. Guarded by
        // typeof: people.js and chat.js load in a fixed order and neither
        // exists at the other's parse time. openPostById handles denied /
        // deleted itself (toast, never a thrown rejection).
        if (typeof window.openPostById === 'function') {
          window.openPostById(ref.id);
        } else {
          Notifs.showToast('That post is no longer available', 'error');
        }
      } else if (ref.kind === 'bidding') {
        if (typeof window.navigateTo === 'function') window.navigateTo('dept:Government Biddings');
        Notifs.info(`Opening Government Biddings — find "${ref.label || 'the record'}" in the list`);
      }
    } catch (_) { Notifs.showToast('Could not open that record', 'error'); }
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
  // Longest edge a photo bubble is ever displayed at. MUST stay in sync with
  // css/styles.css's .ms-media-grid max-width / .ms-media-1 max-height (260px)
  // — this is what makes the reserved box identical to the loaded box.
  const MEDIA_BOX_PX = 260;
  function _mediaGridHtml(m, opts) {
    const media = m.media || [];
    if (!media.length) return '';
    const shown = media.slice(0, 6);
    const extra = media.length - shown.length;
    const cls = shown.length === 1 ? 'ms-media-1' : shown.length === 2 ? 'ms-media-2' : 'ms-media-grid3';
    // The newest few messages are the ones the reader is actually looking at:
    // don't put them behind the lazy-loading heuristic, and ask for the very
    // first tile at high priority.
    const eager = !!(opts && opts.eager);
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
      // An inline aspect-ratio ALONE reserved nothing. Measured in WebKit at
      // iPhone width: every photo bubble — with w/h, without w/h, single or
      // grid — reserved 0x0 while the image was downloading, leaving a 16px
      // bubble containing just the timestamp and tick. That is the empty
      // bubble in the owner's screenshot.
      // The reason is that the whole chain (.ms-row -> .ms-bubble-wrap ->
      // .ms-bubble -> .ms-media-grid) is shrink-to-fit, so an un-loaded 0x0
      // <img> makes the grid column 0 wide, and an aspect-ratio resolved
      // against a 0 width is 0 tall. A definite WIDTH is what was missing:
      //   single photo  -> the exact box the loaded image will occupy,
      //                    computed here from w/h (.ms-tile-sized)
      //   2+ photos     -> a fixed 260px grid width in CSS
      //   no w/h        -> a min-size floor in CSS (.ms-tile-unsized)
      // Verified: the reserved box now equals the loaded box exactly, so the
      // photo fades in without moving anything under the reader's thumb.
      let tileCls = 'ms-media-tile', tileStyle = '', dimAttrs = '';
      if (hasWH) {
        dimAttrs = ` width="${item.w}" height="${item.h}"`;
        if (shown.length === 1) {
          const scale = Math.min(MEDIA_BOX_PX / item.w, MEDIA_BOX_PX / item.h, 1);
          tileCls += ' ms-tile-sized';
          tileStyle = ` style="width:${Math.round(item.w * scale)}px;aspect-ratio:${item.w}/${item.h}"`;
        }
      } else if (shown.length === 1) {
        tileCls += ' ms-tile-unsized';
      }
      // Prefer the sender's own already-in-memory bytes over a round trip.
      const src = _localPreviewSrc(item.url) || safeHttpUrl(item.url);
      const loadAttrs = eager
        ? (i === 0 ? ' fetchpriority="high"' : '')
        : ' loading="lazy"';
      return `<div class="${tileCls}"${tileStyle}>
        <img class="chat-img-tap" data-mid="${escHtml(m.id)}" data-idx="${i}" src="${src}" alt="${escHtml(item.name || 'photo')}"${dimAttrs}${loadAttrs} decoding="async"/>
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
    // Wave2 practicality batch (P2 stretch) — Pin/Unpin joins the same picker
    // (conv creator/admin only — _canManageConv mirrors the pinnedMsgIds
    // firestore.rules text in this batch's report). _openConv is always the
    // currently-open thread's conv, same module-state read _isAdminRole()/etc.
    // already rely on throughout this renderer.
    const isPinnedMsg = !!(_openConv && (_openConv.pinnedMsgIds || []).includes(m.id));
    const canPin = _canManageConv(_openConv);
    const pinBtnHtml = canPin
      ? `<button class="chat-pin-btn ms-act-btn" data-mid="${escHtml(m.id)}" title="${isPinnedMsg ? 'Unpin' : 'Pin'}">${emojiIcon(isPinnedMsg ? 'pin-off' : 'pin', 14)}</button>`
      : '';
    // The container carries ONLY `display:none` inline now. Everything that
    // used to be inline here (gap / margin-top / align-items) moved to the
    // .chat-reaction-picker stylesheet rule: the picker is no longer a row in
    // the bubble column, it is a floating popover (see _openPickerFor), and an
    // inline declaration would outrank — and silently fight — the rule that
    // owns its look. _openPickerFor/_positionPicker set GEOMETRY inline
    // (position/left/top/max-width/flex-wrap/z-index) and nothing else.
    const pickerHtml = `<div class="chat-reaction-picker" data-mid="${escHtml(m.id)}" style="display:none">${
      REACTIONS.map(e => `<button class="chat-pick-emoji" data-mid="${escHtml(m.id)}" data-emoji="${e}" style="font-size:16px;background:none;border:none;cursor:pointer;padding:2px 4px">${e}</button>`).join('')
    }<button class="chat-copy-btn ms-act-btn" data-mid="${escHtml(m.id)}" title="Copy" style="border-left:1px solid var(--border);padding-left:6px;margin-left:2px">${emojiIcon('copy',14)}</button><button class="chat-forward-btn ms-act-btn" data-mid="${escHtml(m.id)}" title="Forward">${emojiIcon('forward',14)}</button>${pinBtnHtml}${touchActionsHtml}</div>`;
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
    // Wave2 practicality batch (P0) — in-thread search highlight. Runs AFTER
    // mention-highlighting (both operate on already-escHtml'd text, same
    // "safe to layer" contract _highlightMentions documents above) so a
    // search hit inside an @mention still highlights correctly. Absent/empty
    // _threadSearchQ is a no-op passthrough — zero cost when search isn't open.
    let textHtml = m.text ? _highlightMentions(escHtml(m.text).replace(/\n/g,'<br/>'), m.mentions) : '';
    if (textHtml && _threadSearchQ.trim()) textHtml = _highlightSearchMatch(textHtml, _threadSearchQ, m.id === _threadSearchCurrentMid);
    // Wave2 practicality batch (P0) — record-link chip (task/quote/bidding).
    const refHtml = _refChipHtml(m.ref) + _meetingCardHtml(m.meeting);

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
            ${textHtml ? `<div class="ms-text">${textHtml}</div>` : ''}
            ${m.media && m.media.length ? _mediaGridHtml(m, { eager: idx >= list.length - 3 })
              : m.fileUrl ? (m.fileSource!=='link' && _isImageUrl(m.fileUrl)
                // Wave5 M3 (J1) — legacy single-image docs (fileUrl, no media[])
                // render IDENTICALLY to before (same size/radius), except the
                // click target: the old inline onclick="window.open(...)" is
                // replaced by the SAME .chat-img-tap delegated-click contract
                // the new media grid uses (data-mid + data-idx="0"), so one
                // image tap — old doc shape or new — opens the SAME in-app
                // lightbox instead of a new browser tab.
                // .ms-legacy-img gives this a min-size floor: these docs have no
                // stored w/h at all, so before the fix it measured 0px tall
                // while downloading — the same empty bubble as the media grid.
                ? `<div style="margin-top:${m.text?'6':'0'}px"><img class="chat-img-tap ms-legacy-img" data-mid="${escHtml(m.id)}" data-idx="0" src="${_localPreviewSrc(m.fileUrl) || safeHttpUrl(m.fileUrl)}" alt="${escHtml(m.fileName||'img')}" decoding="async" style="max-width:200px;max-height:160px;border-radius:var(--r-sm,10px);cursor:pointer"/></div>`
                : `<a href="${safeHttpUrl(m.fileUrl)}" target="_blank" rel="noopener" class="ms-file-chip">${emojiIcon(m.fileSource==='link'?'link':'paperclip',14)}<span>${escHtml(m.fileName||'Attachment')}</span></a>`
              ) : ''}
            ${refHtml}
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
    _syncMeetingSubs(list);   // keeps every visible meeting card live
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
  // ── Reaction picker — a FIXED-POSITION POPOVER ──────────────────────────
  // Owner report (2026-08): "options are getting cut off". The picker used to
  // render as an inline `display:flex` row INSIDE .ms-bubble-wrap, i.e. inside
  // a column whose width is the BUBBLE's (.ms-row is max-width:72%, 85% under
  // 400px; .ms-bubble-wrap is max-width:100% of that). With 6 reaction emoji +
  // Copy + Forward + conditional Pin + up to three touch-only action buttons
  // on ONE non-wrapping line, the tail simply ran off the end of a ~150px
  // bubble on a 375px phone, and #chat-thread-scroll (overflow-y:auto,
  // overflow-x:hidden) plus .page-panel (overflow:hidden) clipped whatever
  // crossed their edges.
  //
  // The node STAYS exactly where the renderer put it (still a child of the
  // message row). That is deliberate and load-bearing: every button inside it
  // is wired by the ONE delegated click listener on #chat-thread-scroll
  // (_wireThreadDelegation), so re-parenting the popover to <body> would
  // silently unwire the emoji, Copy, Forward, Pin, Edit and both Deletes.
  // Only its GEOMETRY changes — position:fixed + computed top/left — which
  // escapes every ancestor's overflow without touching the DOM tree or a
  // single handler.
  //
  // CONTAINING BLOCK (the subtle part): .page-panel carries
  // `transform:translateX(...)` in BOTH states (100% closed, 0 when open —
  // never `none`), and a transformed ancestor is the containing block for any
  // position:fixed descendant. So `top/left` here are NOT viewport
  // coordinates, and the panel's own overflow:hidden still clips us.
  // _positionPicker handles both empirically — it measures where left:0/top:0
  // actually lands instead of assuming, and clamps into the INTERSECTION of
  // the visual viewport and the panel box.
  function _openPickerFor(el, mid) {
    // One picker at a time — the same ownership this function always had (it
    // used to hide every sibling picker), now routed through _closePicker so
    // the dismiss listeners a previous open wired get unwired with it.
    if (_openPickerMid && _openPickerMid !== mid) _closePicker();
    const picker = el.querySelector(`.chat-reaction-picker[data-mid="${CSS.escape(mid)}"]`);
    const bubble = el.querySelector(`.chat-bubble-tap[data-mid="${CSS.escape(mid)}"]`);
    if (!picker || !bubble) return;
    picker.style.position = 'fixed';
    // Small LOCAL z-index inside .page-panel's stacking context (the panel is
    // transformed AND z-indexed, so this can never become a new top-of-app
    // layer) — same convention as .ms-mention-dd (5) / .ms-wallpaper-menu (20).
    // It has to exist at all because .messenger-input-row is position:relative
    // and comes LATER in the DOM: at `auto` the composer paints over us.
    picker.style.zIndex = '20';
    picker.style.display = 'flex';
    // Wrapping is CONTAINMENT, not decoration — it is what makes "never cut
    // off" true in the one case clamping alone cannot fix: 10+ buttons that
    // still don't fit the clamped max-width. Set here rather than left to CSS
    // so the guarantee survives any restyle. Everything else about the look
    // (background, radius, shadow, gap, padding, button sizing) belongs to the
    // .chat-reaction-picker stylesheet rule.
    picker.style.flexWrap = 'wrap';
    _ensurePickerSkin(picker);           // BEFORE measuring — it can change padding/size
    _positionPicker(picker, bubble);
    _openPickerMid = mid;
    _wirePickerDismiss();
  }
  // Places the popover in the viewport: preferred ABOVE the bubble, flipped
  // BELOW when there isn't room, always clamped inside the usable band.
  function _positionPicker(picker, bubble) {
    const M = PICKER_EDGE_MARGIN;
    const de = document.documentElement;
    const vv = window.visualViewport;
    // The VISUAL viewport, not window.innerHeight: with the soft keyboard up
    // the usable strip is much shorter, and a popover clamped to innerHeight
    // can land underneath the keyboard. window.ViewportSync (js/config.js) is
    // the single owner of these values and publishes them on <html> as inline
    // custom properties, so read them straight off the style attribute (no
    // getComputedStyle round-trip); fall back to visualViewport, then to the
    // layout viewport, for the pre-ViewportSync/no-vv case.
    const cssPx = name => { const n = parseFloat(de.style.getPropertyValue(name)); return Number.isFinite(n) ? n : null; };
    const varTop = cssPx('--vv-top'), varH = cssPx('--vvh');
    const vTop = varTop !== null ? varTop : (vv ? vv.offsetTop : 0);
    const vH   = varH   !== null && varH > 0 ? varH : (vv ? vv.height : window.innerHeight);
    let bandTop = vTop, bandBottom = vTop + vH;
    let bandLeft = vv ? vv.offsetLeft : 0, bandRight = (vv ? vv.offsetLeft + vv.width : de.clientWidth);
    // Intersect with the panel: it is BOTH our fixed containing block (it is
    // transformed) and a clipper (overflow:hidden), so anything outside its
    // box is invisible no matter what the visual viewport says. On the phone
    // the panel already IS the visual viewport (top:var(--vv-top);
    // height:var(--vvh)), so this only bites on desktop, where the panel
    // starts below the topbar.
    const panel = picker.closest('.page-panel');
    if (panel) {
      const pr = panel.getBoundingClientRect();
      bandTop = Math.max(bandTop, pr.top);   bandBottom = Math.min(bandBottom, pr.bottom);
      bandLeft = Math.max(bandLeft, pr.left); bandRight = Math.min(bandRight, pr.right);
    }
    // Cap the width first so the measurement below reflects the wrapped size.
    // box-sizing is set explicitly, not inherited from the global
    // `*{box-sizing:border-box}` reset: under content-box a max-width caps the
    // CONTENT box only, so the picker's own padding and border are ADDED on
    // top and it overflows the clamp by exactly that much. Measured on a
    // 375px viewport with a two-row wrapped picker: 365px rendered against a
    // 355px cap, i.e. 10px straight through the right edge — the very defect
    // this batch exists to fix, reintroduced by a stylesheet the geometry does
    // not control. Declared here so the cap is authoritative whatever the
    // reset does.
    picker.style.boxSizing = 'border-box';
    picker.style.maxWidth = Math.max(0, Math.round((bandRight - bandLeft) - M * 2)) + 'px';
    // Park at the containing block's origin and MEASURE. Two things come out
    // of this one read: the popover's real rendered size (after wrapping —
    // never assume a single row) and, because left/top are 0, the containing
    // block's origin in viewport coordinates. That second value is what makes
    // this engine- and layout-agnostic: whatever ancestor happens to be the
    // fixed containing block (today .page-panel's transform, tomorrow
    // something else, or nothing at all) is measured rather than assumed.
    picker.style.left = '0px'; picker.style.top = '0px';
    const pk = picker.getBoundingClientRect();
    const w = pk.width, h = pk.height, originX = pk.left, originY = pk.top;
    const b = bubble.getBoundingClientRect();
    // Horizontal: centre on the bubble, then clamp to the band. minX wins when
    // the band is narrower than the popover (only reachable if a stylesheet
    // overrode our max-width with !important) — better flush-left than
    // negative-width maths.
    const minX = bandLeft + M, maxX = bandRight - M - w;
    let x = b.left + b.width / 2 - w / 2;
    x = maxX < minX ? minX : Math.min(Math.max(x, minX), maxX);
    // Vertical: above by preference (that is where a thumb ISN'T), flipped
    // below when the bubble is too close to the top of the band, and finally
    // pinned to the bottom of the band when neither side fits (a bubble taller
    // than the visible strip).
    let y = b.top - PICKER_GAP - h;
    if (y < bandTop + M) {
      const below = b.bottom + PICKER_GAP;
      y = (below + h <= bandBottom - M) ? below : Math.max(bandTop + M, bandBottom - M - h);
    }
    picker.style.left = Math.round(x - originX) + 'px';
    picker.style.top  = Math.round(y - originY) + 'px';
  }
  // Re-anchors the OPEN popover to its bubble. Everything _positionPicker
  // consumes — --vvh/--vv-top, the panel box, the bubble's rect — is live
  // geometry, so re-running it is all a viewport or layout change needs.
  //
  // Closes only on the two things a reposition genuinely cannot fix:
  //   • the picker or its bubble is gone from the DOM (a _patchThread rewrite,
  //     an unsend, a thread close) — there is nothing left to anchor to;
  //   • the bubble has scrolled entirely out of the thread's own visible box,
  //     so the popover would be pointing at a message the reader can't see.
  function _repositionOpenPicker() {
    if (!_openPickerMid) return;
    const sel = `[data-mid="${CSS.escape(_openPickerMid)}"]`;
    const scroll = document.getElementById('chat-thread-scroll');
    const scope = scroll || document;
    const picker = scope.querySelector(`.chat-reaction-picker${sel}`);
    const bubble = scope.querySelector(`.chat-bubble-tap${sel}`);
    if (!picker || !bubble || !picker.isConnected || !bubble.isConnected) { _closePicker(); return; }
    if (scroll) {
      const sr = scroll.getBoundingClientRect(), br = bubble.getBoundingClientRect();
      if (br.bottom <= sr.top || br.top >= sr.bottom) { _closePicker(); return; }
    }
    _positionPicker(picker, bubble);
  }
  // Coalesces every reposition signal (visual-viewport resize/scroll, window
  // resize, thread scroll) into ONE measure-and-write per frame. _positionPicker
  // writes then reads a rect, i.e. it forces a synchronous layout; a raw
  // per-event call on the thread-scroll path would do that repeatedly during
  // momentum scrolling. The scheduler is a no-op when no picker is open, so the
  // scroll path costs a single truthiness test in the normal case.
  function _schedulePickerReposition() {
    if (!_openPickerMid || _pickerRaf) return;
    _pickerRaf = requestAnimationFrame(() => { _pickerRaf = 0; _repositionOpenPicker(); });
  }
  // Minimal appearance FALLBACK, applied only when .chat-reaction-picker has
  // no painted background of its own. Until this batch the picker had no
  // stylesheet rule at all — every visual came from the inline style attribute
  // the renderer emitted, which this batch removed in favour of the class. Now
  // that the picker floats OVER the thread instead of sitting in the bubble
  // column, a missing rule is not "plain but readable", it is transparent
  // buttons overlapping other people's messages. When the rule IS present this
  // returns immediately, so it can never fight the stylesheet's design.
  function _ensurePickerSkin(picker) {
    const bg = getComputedStyle(picker).backgroundColor;
    const transparent = !bg || bg === 'transparent' || /,\s*0\s*\)$/.test(bg);
    if (!transparent) return;
    picker.style.gap = '4px';
    picker.style.alignItems = 'center';
    picker.style.padding = '6px 8px';
    picker.style.background = 'var(--modal-bg, var(--surface, #fff))';
    picker.style.border = '1px solid var(--border)';
    picker.style.borderRadius = 'var(--r, 14px)';
    picker.style.boxShadow = 'var(--sh-lg, 0 8px 24px rgba(0,0,0,.18))';
  }
  // Closes whichever picker is open and unwires its dismiss listeners.
  // Idempotent — safe to call from teardownThread, from a scroll, and from a
  // pointerdown in the same tick.
  function _closePicker() {
    const mid = _openPickerMid;
    _openPickerMid = null;
    if (_pickerRaf) { cancelAnimationFrame(_pickerRaf); _pickerRaf = 0; }
    _unwirePickerDismiss();
    if (!mid) return;
    // Re-query rather than hold a node reference: _patchThread replaces a
    // row's outerHTML on any rev change, and picking a reaction FROM this very
    // picker is exactly such a change — the node captured at open time is
    // routinely already detached by the time we close. A replaced row renders
    // its picker `display:none`, so "not found" is a correct no-op.
    document.querySelectorAll(`.chat-reaction-picker[data-mid="${CSS.escape(mid)}"]`).forEach(p => {
      // The renderer emits exactly `style="display:none"`, so dropping the
      // whole attribute and re-hiding restores the authored state byte-for-
      // byte — no need to enumerate every property _openPickerFor /
      // _positionPicker / _ensurePickerSkin may have set.
      p.removeAttribute('style');
      p.style.display = 'none';
    });
  }
  // Dismiss ownership. Every listener below is bound when a picker opens and
  // removed when it closes — nothing stays bound between opens, and
  // teardownThread's _closePicker() call is what guarantees neither an orphan
  // popover nor an orphan listener survives a thread close.
  function _wirePickerDismiss() {
    if (_pickerDismissWired) return;
    _pickerDismissWired = true;
    // pointerdown, NOT click. The picker opens WHILE THE FINGER IS STILL DOWN
    // (the 500ms timer fires mid-touch) and, on desktop, mid-right-click — so
    // the gesture that opened it has ALREADY delivered its pointerdown and the
    // next one is necessarily a new interaction. A click-based outside-listener
    // would instead be hit by the very touchend/click that ENDS the opening
    // long press and would close the picker the instant it appeared.
    if (window.PointerEvent) document.addEventListener('pointerdown', _onPickerOutsidePointer, true);
    else { document.addEventListener('touchstart', _onPickerOutsidePointer, true);
           document.addEventListener('mousedown',  _onPickerOutsidePointer, true); }
    // Viewport changes REPOSITION. These used to close, which made the picker
    // unusable on a phone in the single most common state there is: the
    // composer holds focus almost all the time (sending a message leaves it
    // focused, and _armReply focuses it explicitly), so the soft keyboard is
    // up; the picker opens at 500ms with the finger still down; the lift is a
    // tap OUTSIDE the composer, which blurs #chat-input and retracts the
    // keyboard; visualViewport fires resize; the popover was destroyed in the
    // same breath it appeared — indistinguishable from "long press is not
    // working". Nothing about that sequence invalidates the popover: the
    // bubble is still there, the geometry is a pure function of --vvh /
    // --vv-top and the bubble's rect, so re-running it is the correct answer.
    // 'scroll' is bound too because an iOS visual-viewport pan fires nothing
    // else (same reason _onViewportResize listens to both).
    window.addEventListener('resize', _schedulePickerReposition);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', _schedulePickerReposition, { passive: true });
      window.visualViewport.addEventListener('scroll', _schedulePickerReposition, { passive: true });
    }
    // ROTATION still closes. It is the one viewport change a reposition can't
    // be trusted through: orientationchange fires BEFORE the visual-viewport
    // metrics and ViewportSync's --vvh/--vv-top settle, so the maths would run
    // on pre-rotation numbers; the thread relayouts to a different width and
    // re-pins to the bottom underneath us, so the bubble is somewhere else
    // entirely; and the above/below flip decision changes with it. A wrong
    // answer here is worse than one extra long press.
    window.addEventListener('orientationchange', _closePicker);
  }
  function _unwirePickerDismiss() {
    if (!_pickerDismissWired) return;
    _pickerDismissWired = false;
    document.removeEventListener('pointerdown', _onPickerOutsidePointer, true);
    document.removeEventListener('touchstart', _onPickerOutsidePointer, true);
    document.removeEventListener('mousedown',  _onPickerOutsidePointer, true);
    window.removeEventListener('resize', _schedulePickerReposition);
    window.removeEventListener('orientationchange', _closePicker);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', _schedulePickerReposition);
      window.visualViewport.removeEventListener('scroll', _schedulePickerReposition);
    }
  }
  function _onPickerOutsidePointer(e) {
    // A pointerdown ON the popover must not close it: hiding the node here
    // would cancel the click that its own buttons are delegated on.
    const t = e.target;
    if (t && t.closest && t.closest('.chat-reaction-picker')) return;
    _closePicker();
  }
  // Messenger restyle Fix 3 — LONG-PRESS (500ms) on a bubble still opens the
  // full 6-emoji picker (unchanged). The old "or the heart" branch is gone
  // along with the heart button itself.
  // touchstart/touchend timing covers mobile; mousedown/mouseup + contextmenu
  // (right-click / long-press-as-contextmenu on some browsers) covers desktop.
  const LONG_PRESS_MS = 500;
  // Owner report (2026-08): "long press is not working well". Cause: the
  // touchmove listener below used to call clearPress() on ANY movement, with
  // ZERO tolerance — and a finger held deliberately still on a phone still
  // jitters a pixel or three, so the timer was cancelled long before it could
  // fire and the picker never opened. A press now survives up to this much
  // travel from its touchstart point.
  //
  // 10px, chosen against the three gestures it has to co-exist with:
  //   • FINGER JITTER while holding still measures ~1-4px — comfortably inside.
  //   • A SCROLL crosses it almost immediately: even a slow, deliberate
  //     200px/s drag passes 10px in ~50ms, i.e. one tenth of LONG_PRESS_MS, so
  //     "scroll cancels the press promptly" still holds by a wide margin.
  //   • The SWIPE-TO-REPLY axis latch is SWIPE_AXIS_THRESH = 24px of combined
  //     travel (above). 10 < 24 means a swipe that STARTS as a swipe kills the
  //     press timer at 10px, long before it can commit at 24 — so the
  //     deliberate swipe wins cleanly there without knowing about the press.
  //     It does NOT make the two mutually exclusive, and an earlier revision of
  //     this comment wrongly claimed it did: at 500ms a still finger has
  //     travelled 0px, the picker opens, and the 24px accrues afterwards.
  //     Press-then-swipe is handled explicitly in _onSwipeMove instead.
  // It also matches the slop iOS itself allows on a system long-press, which
  // is why LONG_PRESS_MS stays at 500: the defect was cancellation, not
  // duration, and shortening the timer would start firing the picker during
  // the still moment at the beginning of a slow scroll.
  const LONG_PRESS_MOVE_TOL = 10;   // px of travel a press may survive
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
  // How long after the finger LIFTS a completed long press still owns the
  // click. The "a long press happened" flag exists to swallow exactly one
  // click — the one that ends the press — but plenty of gestures open the
  // picker and then never produce a click at all: a sideways flick past the
  // browser's own tap slop (D2), or a file-chip press whose click navigates
  // the page away (D3). Left latched, the flag ate an unrelated tap later on.
  // Timed from the RELEASE, not from when the picker opened, so holding for
  // three seconds and then lifting is still swallowed correctly; 800ms clears
  // even the slow 300ms-tap-delay path with room to spare.
  const LONG_PRESS_CLICK_MS = 800;
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
    let pressTimer = null, longPressed = false, longPressedAt = 0, pressMid = null, pressPt = null;
    let bubbleTapTimer = null, lastBubbleTap = { mid: null, at: 0 };   // double-tap-to-heart state
    const clearPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      pressPt = null;
      // Start the click-swallow window at the RELEASE — see LONG_PRESS_CLICK_MS.
      // (Harmless on the cancel paths: longPressed is false there.)
      if (longPressed) longPressedAt = Date.now();
    };
    // Consumes the "a long press just completed" flag. Returns true when this
    // click is the one that ended the press and nothing else may act on it —
    // and ALWAYS clears the flag, on every path, so a stale one can never
    // survive into an unrelated tap. longPressedAt === 0 means the finger has
    // not lifted yet, so the click can only be the terminating one.
    const takeLongPress = () => {
      if (!longPressed) return false;
      const ownsClick = !longPressedAt || (Date.now() - longPressedAt) <= LONG_PRESS_CLICK_MS;
      longPressed = false; longPressedAt = 0;
      return ownsClick;
    };
    const startPress = (target, e) => {
      const holder = target.closest('.chat-bubble-tap');
      if (!holder) return;
      clearPress();                                    // nulls pressPt — record the origin AFTER it
      const pt = (e.touches && e.touches[0]) || e;     // touch or mouse, same clientX/Y shape
      pressPt = { x: pt.clientX, y: pt.clientY };
      pressMid = holder.dataset.mid; longPressed = false; longPressedAt = 0;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        // Defence in depth for the teardown race (_cancelThreadPress is the
        // primary fix): if this scroller is already off the DOM, the thread it
        // belonged to is gone — opening a popover on it would re-bind the
        // dismiss listeners teardown just unbound and buzz the phone for a
        // chat that is no longer on screen.
        if (!el.isConnected) return;
        longPressed = true; longPressedAt = 0;
        _openPickerFor(el, pressMid);
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
      }, LONG_PRESS_MS);
    };
    // D4 — the only handle teardownThread has on the timer above. Clears the
    // completed-press flag too, so a press that fired just before the close
    // can't swallow the first click of the NEXT thread.
    _cancelThreadPress = () => { longPressed = false; longPressedAt = 0; clearPress(); };
    // Movement tolerance — see LONG_PRESS_MOVE_TOL. Compared as squared
    // distance so there is no sqrt on a per-touchmove path. Only ever CANCELS;
    // it can never start or complete a press, so a stray mousemove on desktop
    // is harmless.
    const pressMoved = e => {
      if (!pressTimer || !pressPt) return;
      const pt = (e.touches && e.touches[0]) || e;
      if (!pt || typeof pt.clientX !== 'number') return;
      const dx = pt.clientX - pressPt.x, dy = pt.clientY - pressPt.y;
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_TOL * LONG_PRESS_MOVE_TOL) clearPress();
    };
    el.addEventListener('touchstart', e => startPress(e.target, e), { passive: true });
    el.addEventListener('touchend', clearPress);
    el.addEventListener('touchcancel', clearPress);
    // passive: this listener never calls preventDefault (the swipe-to-reply
    // handler, bound separately below with passive:false, is the only one that
    // does) — so it must not hold up scrolling while it decides.
    el.addEventListener('touchmove', pressMoved, { passive: true });
    el.addEventListener('mousedown', e => { if (e.button === 0) startPress(e.target, e); });
    el.addEventListener('mouseup', clearPress);
    el.addEventListener('mouseleave', clearPress);
    // Desktop drag = a text selection, not a press. Same tolerance, same
    // cancel — previously only mouseleave/mouseup could stop a desktop press,
    // so dragging to select text inside a bubble popped the picker at 500ms.
    el.addEventListener('mousemove', pressMoved);
    el.addEventListener('contextmenu', e => {
      const holder = e.target.closest('.chat-bubble-tap');
      // Right-click opens the picker directly. It goes through the exact same
      // _openPickerFor, so desktop gets the identical clamped popover — the
      // old inline row could run off the edge of a narrow window here too.
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
      // Every picker button is a ONE-SHOT action, so the popover dismisses as
      // soon as one fires. This used to happen for free: picking a reaction
      // changes the message's rev, _patchThread rewrites the row, and the
      // fresh markup renders the picker `display:none` again. Copy / Forward /
      // Pin / Edit / Delete write nothing that changes the rev, and while the
      // picker was an inline row tucked under its own bubble a lingering one
      // was harmless. A popover floating over the middle of the thread is not.
      // Closing FIRST is safe: _closePicker only rewrites the container's
      // style attribute — no node is detached, so the branches below still
      // resolve e.target.closest(...) and read data-mid exactly as before.
      if (e.target.closest('.chat-reaction-picker')) _closePicker();
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
      // Wave2 practicality batch (P2 stretch) — Pin/Unpin (picker button).
      const pinBtn = e.target.closest('.chat-pin-btn');
      if (pinBtn) { e.stopPropagation(); _togglePinMessage(pinBtn.dataset.mid); return; }
      // Wave2 practicality batch (P0) — record-link chip tap.
      const refChip = e.target.closest('.chat-ref-tap');
      if (refChip) { e.stopPropagation(); _openRefChip({ kind: refChip.dataset.kind, id: refChip.dataset.id, collection: refChip.dataset.collection || null, label: refChip.dataset.label || '' }); return; }
      const mtCard = e.target.closest?.('.chat-meeting-tap');
      if (mtCard) { e.stopPropagation(); if (typeof window.openMeetingView === 'function') window.openMeetingView(mtCard.dataset.meetingId); return; }
      // Wave5 M3 (J1) — any message image (legacy single fileUrl OR a new
      // media-grid tile) opens the in-app lightbox instead of the old
      // window.open(). Checked BEFORE the generic bubble-tap-toggle below so
      // a long-press that already opened the reaction picker doesn't ALSO
      // pop the lightbox (longPressed guard, same pattern used throughout).
      const imgTap = e.target.closest('.chat-img-tap');
      if (imgTap) {
        e.stopPropagation();
        if (takeLongPress()) return;
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
        // A COMPLETED long press swallows the click that ends it, whatever it
        // landed on — checked FIRST, before every other branch in here.
        // It used to sit below the reply-quote branch (long-press on a bubble
        // carrying a quote opened the picker AND jumped to the quoted
        // message), and then below the link/image bail-out — which was worse,
        // because _renderMessagePart puts an `<a target="_blank">` file chip
        // INSIDE the bubble for every attachment and every fileSource:'link'.
        // A long press on one fell straight through to `return`, so the picker
        // opened AND Safari navigated to the file, and the flag was never
        // consumed. (New this batch: the old zero-tolerance touchmove meant the
        // timer essentially never fired, and -webkit-touch-callout:none now
        // suppresses the iOS long-press-on-link sheet that used to eat the
        // gesture.) The anchor's default navigation has to be cancelled
        // explicitly — returning early stops OUR handling, not the browser's.
        if (takeLongPress()) { if (e.target.closest('a')) e.preventDefault(); return; }
        // A SHORT tap on a file chip / image still belongs to the element, not
        // to the bubble: no preventDefault, so the link opens exactly as before.
        if (e.target.closest('a') || e.target.closest('img')) return;
        // Wave5 M2 (J3) — tapping the quoted-reply block scrolls to (+
        // flashes) the original instead of toggling the timestamp line.
        const quote = e.target.closest('.ms-reply-quote');
        if (quote) { _scrollToMessage(quote.dataset.targetMid); return; }
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
    // The reaction popover is still a DOM child of its .ms-row (only its
    // GEOMETRY escaped — see _openPickerFor), so a drag starting on it would
    // otherwise swipe a row it is no longer visually attached to, and the
    // translateX that swipe applies would drag the fixed popover with it (a
    // transformed ancestor becomes its containing block). Neither is wanted:
    // the popover floats free of the thread, so it is not a swipe handle.
    if (e.target.closest && e.target.closest('.chat-reaction-picker')) return;
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
    if (!_swipe) return;
    // Travel is measured BEFORE the aborted bail-out (which now sits below the
    // picker branch) for two reasons: the picker branch needs it to decide, and
    // it needs it even on an ALREADY-aborted drag — _onSwipeStart's
    // momentum-scroll guard aborts at touchstart while the long-press timer
    // keeps running, so a picker can open on top of an aborted swipe and must
    // still be dismissable by the same drag.
    const t = e.touches && e.touches[0]; if (!t) return;
    const dx = t.clientX - _swipe.startX, dy = t.clientY - _swipe.startY;
    // A PICKER OPENED DURING THIS DRAG → the drag dismisses it and arms
    // nothing. The build assumed the two gestures were mutually exclusive
    // because LONG_PRESS_MOVE_TOL (10) < SWIPE_AXIS_THRESH (24); they are not.
    // At 500ms the finger has travelled 0px, so the picker OPENS; the 24px only
    // accrues afterwards, and clearing an already-fired timer un-opens nothing.
    // Order is what matters: swipe-then-press is genuinely safe (the press
    // timer dies at 10px, long before the swipe can commit), press-then-swipe
    // was not — it armed a reply AND translateX'd .ms-row, which, being a
    // transformed ancestor, becomes the fixed popover's containing block and
    // flung it hundreds of px off-screen (measured 539 -> 1189.7px top on an
    // 812px viewport) into a clipping scroller.
    //
    // DISMISS, not reply: with a popover open the user's model is "a menu is
    // up", and a flick is the universal "get rid of it" — arming a reply they
    // cannot even see (the composer is behind the popover) is not what that
    // gesture asks for. Aborting rather than merely closing is also what keeps
    // the transform from ever being written, which is the half of this defect
    // that closing alone would not fix.
    //
    // Reachable ONLY when the picker opened mid-drag: any pre-existing picker
    // was already closed by _onPickerOutsidePointer on this touch's own
    // pointerdown/touchstart (document, capture phase — it runs before the
    // scroller's own touchstart). So a normal swipe-to-reply never sees this.
    //
    // TWO SEPARATE DECISIONS. Collapsing them into one guard is exactly what
    // the previous revision got wrong (`if (_openPickerMid) { _closePicker();
    // _swipe.aborted = true; return; }` — zero tolerance, so the FIRST
    // touchmove of ANY size closed it; measured dismissal at dx = 1px):
    //   • ABORT the swipe — UNCONDITIONAL, from the first touchmove. This is
    //     the safety property, and it must not wait for a threshold: it is what
    //     guarantees translateX is never written on a row that carries an open
    //     picker (measured consequence when it was: the fixed popover took the
    //     transformed row as its containing block and was flung from (10,434)
    //     to (311,979), off-screen and then clipped by #chat-thread-scroll).
    //   • CLOSE the picker — only once travel genuinely exceeds
    //     LONG_PRESS_MOVE_TOL (10px). That constant is REUSED rather than given
    //     a twin because it answers the identical question about the identical
    //     finger on the identical gesture: how much travel still counts as
    //     "holding still"? It was measured against the ~1-4px of jitter a
    //     deliberately-still finger produces (see its comment above), and the
    //     picker opens with that finger STILL DOWN — so the opened picker faces
    //     the very same jitter the opening press was given slop for, and got
    //     none. Symmetry is the rule: movement too small to have CANCELLED the
    //     press is too small to dismiss what the press produced. Deliberately
    //     NOT SWIPE_AXIS_THRESH (24): 10 < 24 keeps the close strictly earlier
    //     than the point at which a swipe could ever latch an axis, so no
    //     window exists where a committed swipe and an open picker coexist
    //     (belt-and-braces behind the unconditional abort), and a real sideways
    //     flick still clears the menu within the first frames of motion instead
    //     of after 24px of visible finger travel.
    if (_openPickerMid) {
      _swipe.aborted = true;
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_TOL * LONG_PRESS_MOVE_TOL) _closePicker();
      return;
    }
    if (_swipe.aborted) return;
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
  function _addPendingMessage({ clientKey, text, file, images, link, replyTo, ref, meeting }) {
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
    // Wave2 practicality batch — `ref` rides the pending bubble the same way
    // (it's plain data, already-existing-record metadata — no upload needed,
    // so the chip is tappable even before the message doc lands).
    _pending.push({ clientKey, text: text || '', file: file || null, images: images || [], previewUrl, previewUrls,
      link: link || null, status: 'sending', replyTo: replyTo || null, ref: ref || null,
      meeting: meeting || null });
    _renderThread();
  }
  function _markPendingFailed(clientKey) {
    const p = _pending.find(x => x.clientKey === clientKey);
    if (p) { p.status = 'failed'; _renderPendingTail(); }
  }
  // Wave2 practicality batch (P1) — offline-queued attachment send: distinct
  // from 'failed' (a real, still-connected send error the sender must
  // manually retry). This status shows "will send when back online" instead
  // of "tap to retry", and the module-scope 'online' listener below retries
  // it automatically — tap-to-retry still works too (see
  // _wirePendingTailDelegation's selector, extended to include this class).
  function _markPendingOffline(clientKey) {
    const p = _pending.find(x => x.clientKey === clientKey);
    if (p) { p.status = 'offline'; _renderPendingTail(); }
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
      await sendMessage({ text: p.text, file: p.file, images: p.images, link: p.link, clientKey, replyTo: p.replyTo, mentions, ref: p.ref });
    } catch (e) {
      // v14 chat re-audit fix — canceled out from under this retry — don't
      // flip a bubble that's no longer even in `_pending` back to 'failed',
      // and don't toast an error for a send the user already dismissed.
      if (_canceledClientKeys.delete(clientKey)) return;
      // Wave2 practicality batch (P1) — a retry that STILL fails while
      // offline stays queued (rather than flipping to 'failed' and toasting
      // an error every time the 'online' listener's auto-retry loop happens
      // to fire before connectivity is actually usable) — quietly re-arms
      // for the next 'online' event / manual tap.
      const isAttachmentSend = !!(p.file || (p.images && p.images.length));
      if (isAttachmentSend && typeof navigator !== 'undefined' && navigator.onLine === false) {
        p.status = 'offline';
        _renderPendingTail();
        return;
      }
      p.status = 'failed';
      _renderPendingTail();
      Notifs.error((e && e.message) || 'Message not sent — retry.');
    }
  }
  // Wave2 practicality batch (P1) — automatic reconnect retry: fires whenever
  // the browser regains connectivity, and retries every offline-queued
  // attachment bubble for the CURRENTLY open thread (offline-queued bubbles
  // from a thread the user has since navigated away from are already gone —
  // teardownThread clears _pending, same as every other pending-bubble state;
  // see this batch's report for that scope note). Wired once at module load
  // (mirrors the existing visibilitychange/pagehide listeners just below),
  // not per thread-open — _pending is simply empty when no thread is open, so
  // this is a safe no-op then.
  window.addEventListener('online', () => {
    _pending.filter(p => p.status === 'offline').forEach(p => _retryPending(p.clientKey));
  });
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
    // This is now a REAL network abort, not just a UI dismiss: the UploadTask
    // reference is kept (see _putTracked), so cancelling stops the byte pump
    // instead of letting it run to completion in the background. The rejected
    // put() propagates as the usual "Photo upload failed" throw, which
    // _canceledClientKeys then swallows in doSend/_retryPending's catch.
    _cancelUploads(clientKey);
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
      // Wave2 practicality batch (P0) — a pending bubble's ref chip (if any)
      // is tappable too — it points at an already-existing record, not
      // something that needs the send to land first.
      const refChip = e.target.closest('.chat-ref-tap');
      if (refChip) { e.stopPropagation(); _openRefChip({ kind: refChip.dataset.kind, id: refChip.dataset.id, collection: refChip.dataset.collection || null, label: refChip.dataset.label || '' }); return; }
      const mtCard = e.target.closest?.('.chat-meeting-tap');
      if (mtCard) { e.stopPropagation(); if (typeof window.openMeetingView === 'function') window.openMeetingView(mtCard.dataset.meetingId); return; }
      // Wave2 practicality batch (P1) — tap-to-retry also covers the offline-
      // queued state (manual retry alongside the automatic 'online' one).
      const failed = e.target.closest('.ms-bubble-failed, .ms-bubble-offline');
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
    const offline = p.status === 'offline';   // Wave2 practicality batch (P1)
    const hasUpload = !!(p.file || (p.images && p.images.length));
    const pct = _uploadPct(p.clientKey);
    // v14 chat re-audit fix — a 'sending' bubble now carries its own small
    // ✕ cancel affordance (wired in _wirePendingTailDelegation) instead of
    // being tappable ONLY once it flips to 'failed'. Inline-styled (no CSS
    // file in scope for this batch) to match the existing ⏳/⚠ status glyphs.
    const statusHtml = failed
      ? `<span class="ms-pending-status">${emojiIcon('⚠',12)}</span><span class="ms-pending-retry-label">Tap to retry</span>`
      // Wave2 practicality batch (P1) — offline-queued: a distinct, non-
      // alarming label (this isn't an error the sender needs to fix, just
      // connectivity) — auto-retries on 'online', tap-to-retry also works.
      : offline
        ? `<span class="ms-pending-status">${emojiIcon('wifi-off',11)}</span><span class="ms-pending-offline-label">Will send when back online</span>`
        // Determinate upload progress. put() has always returned an UploadTask
        // emitting state_changed; this file used none of it, so a 350KB upload
        // over mobile data showed a motionless ⏳ and the sender had no way to
        // tell a slow send from a stuck one.
        : `<span class="ms-pending-status">${emojiIcon('⏳',11)}</span>` +
        (hasUpload ? `<span class="ms-pending-bar" data-client-key="${escHtml(p.clientKey)}"><i style="width:${pct === null ? 0 : pct}%"></i></span>` : '') +
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
          // ms-tile-unsized on the single-photo case so the preview has a
          // reserved box for the frame or two before the blob decodes — same
          // floor the confirmed bubble now gets.
          p.previewUrls.slice(0, 6).map(u => `<div class="ms-media-tile${previewCount === 1 ? ' ms-tile-unsized' : ''}"><img src="${u}" alt="" decoding="async"/></div>`).join('')
        }</div>`
      : p.previewUrl
        ? `<div style="margin-top:${p.text?'6':'0'}px"><img src="${p.previewUrl}" alt="" style="max-width:200px;max-height:160px;border-radius:var(--r-sm,10px);opacity:.75"/></div>`
        : (p.file ? `<div class="ms-file-chip">${emojiIcon('paperclip',14)}<span>${escHtml(p.file.name)}</span></div>` : '');
    const linkHtml = (p.link && !p.file) ? `<div class="ms-file-chip">${emojiIcon('link',14)}<span>${escHtml(p.link)}</span></div>` : '';
    // Wave2 practicality batch (P0) — same ref-chip markup/contract the
    // confirmed-message renderer uses (see _renderMessagePart) so both wire
    // through the SAME .chat-ref-tap delegated click.
    const refHtml = _refChipHtml(p.ref) + _meetingCardHtml(p.meeting);
    return `
      <div class="ms-row ms-row-mine ms-grp-single">
        <div class="ms-bubble-wrap" style="align-items:flex-end">
          <div class="ms-bubble-row">
            <div class="ms-bubble ms-bubble-mine ms-grp-single ${failed?'ms-bubble-failed':offline?'ms-bubble-offline':'ms-bubble-pending'}" data-client-key="${escHtml(p.clientKey)}">
              ${_replyQuoteHtml(p.replyTo)}
              ${p.text ? `<div class="ms-text">${escHtml(p.text).replace(/\n/g,'<br/>')}</div>` : ''}
              ${mediaHtml}${linkHtml}${refHtml}
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
    // The reaction popover is position:fixed, so it does NOT travel with the
    // thread — left alone it would hover over an unrelated message. It used to
    // be closed outright here; it now RE-ANCHORS to its bubble, and
    // _repositionOpenPicker closes it once that bubble has scrolled out of the
    // thread's visible box (so a deliberate scroll-away still dismisses it,
    // just one bubble-height later).
    //
    // Closing outright could not stay: the keyboard retraction of D1 re-pins
    // this scroller to the bottom (_onViewportResize), which fires a scroll
    // event — so "reposition on visualViewport resize" alone would have been
    // undone one task later by a close from here, and the D1 defect would have
    // survived its own fix. A programmatic re-pin and a finger-drag are the
    // same event; treating both as "follow the bubble" needs no way to tell
    // them apart. (Opening one cannot re-enter here: _openPickerFor sets
    // position:fixed and display in the same task, so the picker never
    // occupies layout space and never shifts the scroller.)
    if (_openPickerMid) _schedulePickerReposition();
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

  // ── Wave2 practicality batch (P0) — in-thread message search ──
  // Client-side over the currently-loaded window (_earlier + _msgs) + an
  // on-demand loadEarlier() page when stepping "prev" past the oldest loaded
  // match — no separate index, no extra Firestore query shape. Match state
  // lives at module scope (like _replyTarget/_swipe) so it survives the
  // thread's normal re-renders; teardownThread resets it (see above).
  function _escRegExpChars(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Operates on an ALREADY-escHtml'd string (same contract _highlightMentions
  // documents) — the query itself is escHtml'd too before being turned into a
  // regex source, so it can only ever match/insert already-neutralized text;
  // it can't introduce markup that wasn't already safely escaped.
  function _highlightSearchMatch(escapedHtml, query, isActiveMsg) {
    const q = (query || '').trim();
    if (!q) return escapedHtml;
    const escQ = escHtml(q);
    let re;
    try { re = new RegExp(_escRegExpChars(escQ), 'gi'); } catch (_) { return escapedHtml; }
    let first = true;
    return escapedHtml.replace(re, match => {
      const cls = 'ms-search-hit' + (isActiveMsg && first ? ' ms-search-hit-active' : '');
      first = false;
      return `<mark class="${cls}">${match}</mark>`;
    });
  }
  function _computeThreadSearchMatches() {
    const q = _threadSearchQ.trim().toLowerCase();
    if (!q) { _threadSearchMatches = []; return; }
    _threadSearchMatches = [..._earlier, ..._msgs]
      .filter(m => !m.deleted && (m.text || '').toLowerCase().includes(q))
      .map(m => m.id);
  }
  function _updateThreadSearchUI() {
    const countEl = document.getElementById('chat-search-count');
    if (!countEl) return;
    if (!_threadSearchQ.trim()) { countEl.textContent = ''; return; }
    if (!_threadSearchMatches.length) { countEl.textContent = 'No matches'; return; }
    const idx = _threadSearchCurrentMid ? _threadSearchMatches.indexOf(_threadSearchCurrentMid) : -1;
    countEl.textContent = `${idx + 1} of ${_threadSearchMatches.length}`;
  }
  function _scrollToActiveSearchHit() {
    if (!_threadSearchCurrentMid) return;
    const el = document.getElementById('chat-thread-scroll');
    const row = el && el.querySelector(`.ms-row[data-mid="${CSS.escape(_threadSearchCurrentMid)}"]`);
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  // Re-runs the query against the currently-loaded window and forces a FULL
  // thread rebuild (resetting _lastRenderOrder) — search-highlight state
  // isn't part of _msgRev (it's external UI state, not message data), so the
  // normal patch-diff path (_patchThread) would never repaint existing rows
  // for a query-only change. Cheap enough here: the loaded window is capped
  // (PAGE_SIZE + EARLIER_CAP) and this only runs on input (debounced) / nav.
  function _setThreadSearchQuery(q) {
    _threadSearchQ = q || '';
    _computeThreadSearchMatches();
    _threadSearchCurrentMid = _threadSearchMatches.length ? _threadSearchMatches[_threadSearchMatches.length - 1] : null;
    _lastRenderOrder = null;
    _renderThread();
    _scrollToActiveSearchHit();
    _updateThreadSearchUI();
  }
  function _toggleThreadSearch(force) {
    const bar = document.getElementById('chat-search-bar');
    const open = typeof force === 'boolean' ? force : !_threadSearchOpen;
    _threadSearchOpen = open;
    if (bar) bar.classList.toggle('hidden', !open);
    if (open) {
      document.getElementById('chat-search-input-thread')?.focus();
    } else {
      const input = document.getElementById('chat-search-input-thread');
      if (input) input.value = '';
      _setThreadSearchQuery('');   // clears matches/highlight and forces a clean re-render
    }
  }
  // dir: -1 = older/prev match, +1 = newer/next match. Pages in an older
  // batch via loadEarlier() on demand when stepping prev past the oldest
  // loaded match (spec: "paged fetch of older ones on demand") — "next" never
  // needs that since _msgs is always the live tail already.
  async function _threadSearchStep(dir) {
    if (!_threadSearchQ.trim() || !_threadSearchMatches.length) return;
    let idx = _threadSearchCurrentMid ? _threadSearchMatches.indexOf(_threadSearchCurrentMid) : -1;
    let target = idx + dir;
    if (target < 0 && !_earlierExhausted) {
      await loadEarlier();               // its own _renderThread already re-applies the current query's highlight
      _computeThreadSearchMatches();
      idx = _threadSearchCurrentMid ? _threadSearchMatches.indexOf(_threadSearchCurrentMid) : -1;
      target = idx + dir;
    }
    if (target < 0 || target >= _threadSearchMatches.length) { _updateThreadSearchUI(); return; }
    _threadSearchCurrentMid = _threadSearchMatches[target];
    _lastRenderOrder = null;
    _renderThread();
    _scrollToActiveSearchHit();
    _updateThreadSearchUI();
  }

  // ── Wave2 practicality batch (P2 stretch) — pinned messages ──
  // Pins are `conv.pinnedMsgIds: [messageId]`, written by the conv's creator
  // or an admin (see _canManageConv and this batch's report for the exact
  // firestore.rules text). _openConv is a one-time snapshot taken at thread-
  // open (see openConversation) — a pin/unpin from ANOTHER viewer while this
  // viewer has the thread open won't show live here until it's reopened; see
  // the report's "known limitations" note.
  async function _togglePinMessage(mid) {
    if (!_openConvId || !_openConv) return;
    const pinned = new Set(_openConv.pinnedMsgIds || []);
    const willPin = !pinned.has(mid);
    const FV = firebase.firestore.FieldValue;
    try {
      await db.collection('conversations').doc(_openConvId)
        .update({ pinnedMsgIds: willPin ? FV.arrayUnion(mid) : FV.arrayRemove(mid) });
      if (willPin) pinned.add(mid); else pinned.delete(mid);
      _openConv.pinnedMsgIds = Array.from(pinned);
      _renderPinnedBar();
      _lastRenderOrder = null;   // pin state isn't part of _msgRev — force the picker's Pin/Unpin label to repaint
      _renderThread();
      Notifs.success(willPin ? 'Pinned' : 'Unpinned');
    } catch (_) { Notifs.showToast('Could not update pin', 'error'); }
  }
  function _wirePinnedBarDelegation(bar) {
    if (bar.dataset.wired) return;
    bar.dataset.wired = '1';
    bar.addEventListener('click', e => {
      const summary = e.target.closest('#chat-pinned-summary');
      if (summary) { document.getElementById('chat-pinned-list')?.classList.toggle('hidden'); return; }
      const unpinBtn = e.target.closest('.ms-pinned-row-unpin');
      if (unpinBtn) { e.stopPropagation(); _togglePinMessage(unpinBtn.dataset.mid); return; }
      const row = e.target.closest('.ms-pinned-row');
      if (row) { _scrollToMessage(row.dataset.mid); document.getElementById('chat-pinned-list')?.classList.add('hidden'); }
    });
  }
  function _renderPinnedBar() {
    const bar = document.getElementById('chat-pinned-bar');
    if (!bar) return;
    const ids = (_openConv && _openConv.pinnedMsgIds) || [];
    if (!ids.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    const list = [..._earlier, ..._msgs];
    // A pinned message that's since been unsent (tombstoned) would otherwise
    // fall through to the generic 'Attachment' fallback below (unsend clears
    // text/fileUrl/media alike) — call it out explicitly instead.
    const snippetFor = m => m.deleted ? 'Message removed'
      : (m.text || m.fileName || ((m.media && m.media.length) ? 'Photo' : 'Attachment') || '').slice(0, 80);
    const lastMsg = list.find(m => m.id === ids[ids.length - 1]);
    const summaryLabel = lastMsg ? snippetFor(lastMsg) : 'Pinned message';
    const canPin = _canManageConv(_openConv);
    bar.classList.remove('hidden');
    bar.innerHTML = `
      <button type="button" id="chat-pinned-summary" class="ms-pinned-summary">
        ${emojiIcon('pin', 13)}
        <span class="ms-pinned-count">${ids.length > 1 ? ids.length + ' pinned' : 'Pinned'}</span>
        <span class="ms-pinned-snippet">${escHtml(summaryLabel)}</span>
      </button>
      <div id="chat-pinned-list" class="ms-pinned-list hidden">
        ${ids.slice().reverse().map(mid => {
          const m = list.find(x => x.id === mid);
          const info = m ? _authorInfo(m.authorId, m.authorName) : null;
          const snip = m ? snippetFor(m) : 'Message not loaded';
          return `<div class="ms-pinned-row" data-mid="${escHtml(mid)}">
            <div class="ms-pinned-row-body">
              ${info ? `<div class="ms-pinned-row-author">${escHtml(info.name)}</div>` : ''}
              <div class="ms-pinned-row-snippet">${escHtml(snip)}</div>
            </div>
            ${canPin ? `<button type="button" class="ms-pinned-row-unpin" data-mid="${escHtml(mid)}" title="Unpin">${emojiIcon('x', 12)}</button>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    _wirePinnedBarDelegation(bar);
    if (window.lucide) lucide.createIcons({ nodes: [bar] });
  }

  // ── Wave5 M2 (J6) — @mentions: composer-side candidate list + detection ──
  // Group/dept ONLY (spec) — a dm returns [] here, so every mention code path
  // (typeahead, _computeMentions) is naturally a no-op there without a
  // separate conv.type guard at every call site.
  function _mentionCandidatesFor(conv) {
    // Wave2 practicality batch — announcement channels are group-shaped
    // (participants array), so they get @mentions the same way a group does.
    if (!conv || (conv.type !== 'group' && conv.type !== 'dept' && conv.type !== 'announcement')) return [];
    if (conv.type === 'group' || conv.type === 'announcement') {
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
      // …but 'secretary' is a channel admin everywhere EXCEPT # Finance and
      // # IT, which the owner closed to them and firestore.rules'
      // deptChannelOpen() now refuses. Without this they stayed offerable in
      // the typeahead, and a mention is AUTHORITATIVE for delivery
      // (_notifyRecipients merges the mention set on top of membership) — so
      // one @tag would have pushed a Finance message preview to the one role
      // that must not receive it, linked to a thread they cannot open.
      if (_deptChannelClosedToRole(u.role, conv.department)) return null;
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

  // ══════════════════════════════════════════════════════════════════════
  //  Partner containment — the ONE hard rule for shared record chips
  // ══════════════════════════════════════════════════════════════════════
  // A record chip copies up to 140 characters of the source record VERBATIM
  // into the message doc's `ref.label` (see sendMessage's persist block). For a
  // shared POST that is the post's own title/body — internal content an
  // external partner has no read access to. The post DOC stays protected (a
  // partner tapping the chip gets PERMISSION_DENIED from firestore.rules'
  // posts rule, and openPostById toasts), but the LABEL is already denormalised
  // into three places a partner reads, none of which the rules can fence:
  //
  //   1. conversations/{id}/messages/{id}.ref.label
  //      `allow read: if isAuth() && convMember()` (firestore.rules ~859) —
  //      no per-field restriction of any kind.
  //   2. conv.lastMessageText — sendMessage's ref-only preview branch writes
  //      `📣 <label>` / `🔗 <label>` there: the partner's INBOX ROW.
  //   3. the FCM push body — _notifyRecipients interpolates that same preview,
  //      and functions/index.js forwards it verbatim: their phone LOCK SCREEN.
  //
  // Partners are legitimate DM targets (dmCandidates returns literally
  // "everyone" for an internal user, so every partner sits in every employee's
  // picker), which is exactly why this cannot be left to the rules or to
  // convention. It is enforced in JS at BOTH points: conversations containing a
  // partner are excluded FROM THE PICKER, and the target is RE-CHECKED against
  // fresh data immediately before the send, because the picker list is a
  // snapshot and group membership/roles can change under it.
  //
  // Partner-ness is decided the way the rest of the app decides it —
  // `u.role === 'partner'` (dmCandidates above, js/screens/people.js's Team
  // card, firestore.rules' own isPartner()) — but compared CASE-INSENSITIVELY:
  // production carries role-case drift ("Partner"), and over-counting someone
  // as a partner is the safe direction for this particular check.
  // The VIEWER test, deliberately separate from the global isPartner().
  // js/app.js's isPartner() is `currentRole === 'partner'` — CASE-SENSITIVE — and
  // production contains role drift ('Partner' with a capital P). A drifted viewer
  // therefore passes that check and could share. For DM/group that self-heals
  // (their own uid is in participants and the target test below is
  // case-insensitive), but a dept channel has no participants to catch them on.
  // Being MORE cautious about who counts as a partner is the safe direction, so
  // every share/forward refusal routes through here.
  function _viewerIsPartner() {
    try { return _roleIsPartner(window.currentRole); } catch (_) { return true; }
  }
  function _roleIsPartner(role) {
    return String(role == null ? '' : role).trim().toLowerCase() === 'partner';
  }
  // `fresh` bypasses every cache — the send-time re-check must, because it IS
  // the security boundary. The picker's own pass may use a short-TTL cache.
  //
  // Deliberately NOT the shared 'users' key: dbCachedGet force-substitutes
  // window.fetchUsersWithPayroll for that key (js/config.js), which returns
  // `{...userDoc, ...payrollDoc}` — a payroll doc carrying a `role` field would
  // silently OVERWRITE the user's real role in the merged object, and role is
  // the exact field this guard decides on. A distinct key gets the raw users
  // docs with no merge; a short TTL keeps repeat opens cheap.
  async function _usersByIdMap(fresh) {
    const snap = fresh
      ? await db.collection('users').get()
      : await dbCachedGet('chat-share-users', () => db.collection('users').get(), 15000);
    const map = {};
    snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
    return map;
  }
  // null   → safe to share into.
  // string → why it is excluded. Phrased about the CHAT, never about a person.
  function _partnerBlockReason(cv, usersById) {
    // ── DEPT CHANNELS: participants is EMPTY BY RULE, so inspecting it alone
    // waves every dept channel straight through. firestore.rules enforces
    // `participants == []` on dept create and derives membership from each
    // user's own department instead.
    //
    // An earlier version of this guard reasoned that dept channels are safe
    // because the rules fence their membership branch behind !isPartner(), so
    // no partner can read the conversation or the message. That is TRUE, and it
    // closes the message-doc and inbox-row sinks — but it does NOT close the
    // third one, and the third one is the loudest: push notifications never
    // pass through conversation rules at all. The SENDER's client computes the
    // recipient set with _targetsFor() and writes into each recipient's own
    // notifications inbox, and that filter has no role test whatsoever. So a
    // partner whose profile lists an internal department (the invite form
    // offers every department to every role, unfiltered) receives the post
    // title in-app AND on their lock screen, from a channel they cannot open.
    //
    // Resolve membership the SAME way _targetsFor does, so the guard and the
    // notification fan-out can never disagree about who is in the room.
    if (cv && cv.type === 'dept') {
      const dept = cv.department;
      const members = Object.keys(usersById).map(k => usersById[k]).filter(u =>
        u && (u.department === dept ||
              (Array.isArray(u.departments) && u.departments.indexOf(dept) !== -1)));
      for (let i = 0; i < members.length; i++) {
        if (_roleIsPartner(members[i].role)) return 'A partner is in this department';
      }
      // Distinguish "the read failed" from "this department is genuinely empty".
      // If usersById is empty the read failed (or was denied) and we cannot show
      // that nobody external is listening — fail closed. If it resolved but this
      // department matched nobody, the channel truly has no members: _targetsFor
      // would notify nobody, so there is nothing to leak and refusing would be a
      // false alarm.
      if (!Object.keys(usersById || {}).length) return 'Cannot confirm who is in this channel';
      return null;
    }
    const parts = (cv && Array.isArray(cv.participants)) ? cv.participants : [];
    // A non-dept conversation with no participants is unverifiable, not empty.
    if (!parts.length) return 'Cannot confirm everyone here is internal';
    for (let i = 0; i < parts.length; i++) {
      const u = usersById[parts[i]];
      // An unresolvable participant is not proof of safety — fail closed.
      if (!u) return 'Cannot confirm everyone here is internal';
      if (_roleIsPartner(u.role)) return 'Includes an external partner';
    }
    return null;
  }

  // ── Conversation picker (extracted from _openForwardPicker) ─────────────
  // _openForwardPicker ALREADY was this picker; its list-build, page and row
  // wiring are lifted out here verbatim so Share (from the Posts feed) reuses
  // exactly the same code path. Forward passes no `filter`, so every row is
  // enabled and behaves precisely as before — zero behaviour change for
  // Forward is the regression-safety property of this extraction.
  //
  // opts:
  //   title   — openPage title
  //   exclude — a conversation id to leave out (Forward: the source thread)
  //   filter  — (cv) => null | 'reason'. A reason renders the row DISABLED with
  //             the reason shown beside it; rows are never silently dropped.
  //   onPick  — async (cv) => …, called with the picked conversation row
  async function _openConvPicker(opts) {
    opts = opts || {};
    // COLD START (real bug this extraction has to fix). `_convs` is assigned in
    // exactly ONE place — _runInboxRefresh — fed by _attachInbox, which is
    // called from exactly one place: the end of renderChatPage. navigateTo()
    // calls teardownInbox() on every non-chat page (js/app.js), and that
    // unsubscribes the listener but does NOT clear _convs. So opened from the
    // Posts feed this list is either EMPTY (Chat never opened this session —
    // the picker would show dept channels only) or FROZEN-STALE (Chat opened
    // earlier, listener since detached). Do a one-shot load whenever the live
    // listener is not currently attached.
    let convs = _convs;
    if (!convs.length || !_inboxUnsub) {
      const snap = await dbCachedGet('chat-picker-convs',
        () => db.collection('conversations').where('participants', 'array-contains', currentUser.uid).get(),
        15000).catch(() => null);
      if (snap) convs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    const deptRows = myDeptChannels().map(d => {
      const existing = _deptConvs.find(cv => cv.department === d);
      return existing || { id: 'dept_' + d, type: 'dept', department: d, name: d, participants: [], lastMessageAt: null, _unprovisioned: true };
    });
    const all = [...convs, ...deptRows].filter(cv => !opts.exclude || cv.id !== opts.exclude);
    const sorted = all.slice().sort((a, b) => (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0));
    const initials = s => escHtml((s || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2));
    const reasons = {};
    if (typeof opts.filter === 'function') sorted.forEach(cv => { reasons[cv.id] = opts.filter(cv) || null; });
    const blocked = sorted.filter(cv => reasons[cv.id]).length;
    const rowHtml = cv => {
      const title = _convTitle(cv);
      const why = reasons[cv.id];
      if (why) {
        return `<div class="item-card chat-conv-target-blocked" data-cid="${escHtml(cv.id)}" aria-disabled="true" style="display:flex;align-items:center;gap:10px;padding:8px;opacity:.55;cursor:not-allowed">
          <div class="ms-avatar ms-avatar-md">${initials(title)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${escHtml(title)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${escHtml(why)}</div>
          </div>
        </div>`;
      }
      return `<div class="item-card chat-conv-target pressable" data-cid="${escHtml(cv.id)}" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px">
        <div class="ms-avatar ms-avatar-md">${initials(title)}</div>
        <div style="flex:1;min-width:0;font-weight:600">${escHtml(title)}</div>
      </div>`;
    };
    // Excluded conversations are SHOWN with their reason, not hidden — a chat
    // that silently vanishes from a picker reads as a bug.
    const note = blocked
      ? `<div style="font-size:12px;color:var(--text-muted);padding:2px 2px 12px;line-height:1.45">${blocked} chat${blocked > 1 ? 's are' : ' is'} unavailable here — internal posts are not shared into chats that include someone outside the company.</div>`
      : '';
    const body = note + `<div id="chat-conv-picker-list" class="item-list">${
      sorted.map(rowHtml).join('') || '<div class="empty-state" style="padding:16px"><p>No conversations yet.</p></div>'
    }</div>`;
    // Scoped to the RETURNED panel element, never document.getElementById —
    // several panels can be stacked and ids are not unique across them.
    const panel = window.openPage(opts.title || 'Send to…', body);
    if (!panel) return;
    panel.querySelectorAll('.chat-conv-target').forEach(row => {
      row.addEventListener('click', async () => {
        const target = sorted.find(x => x.id === row.dataset.cid);
        if (!target) return;
        window.Overlay.dismissTop();
        if (typeof opts.onPick === 'function') await opts.onPick(target);
      });
    });
  }

  // ── Wave5 M2 (J3) — Forward ──
  // Conversation picker = "my conversations, sorted recent" (dm/group/dept —
  // the SAME merged+sorted list _renderInbox builds, reusing _convTitle for
  // row labels), reached via openPage like every other secondary chat screen
  // (New Message, per renderChatPage). Selecting a row writes a FRESH message
  // to that conversation via the SAME sendMessage({conv}) machinery every
  // other send uses — the target's lastMessage* preview bump and
  // _notifyRecipients both come along for free, nothing duplicated here.
  // The list/page/row-wiring half now lives in _openConvPicker above (shared
  // with Share); the send callback below is unchanged.
  async function _openForwardPicker(mid) {
    const m = [..._earlier, ..._msgs].find(x => x.id === mid);
    if (!m || m.deleted) return;
    const sourceConvId = _openConvId;
    if (!sourceConvId) return;
    // Forward carries `ref` along verbatim (see the sendMessage call below). For
    // a POST ref that is the post's own title/body — the exact string the share
    // flow refuses to place in front of an external partner — so Forward has to
    // honour the SAME block, otherwise it is simply a second, unguarded route to
    // the same leak: share a post into an internal thread, then forward it out.
    //
    // Deliberately scoped to kind 'post' ONLY. Forwarding text/photos/files/
    // links and task/quote/bidding refs behaves exactly as it did before this
    // batch (those carry the pre-existing, separately-tracked F64 exposure and
    // narrowing them is not this batch's mandate).
    const guardPostRef = !!(m.ref && m.ref.kind === 'post');
    let usersById = null;
    if (guardPostRef) {
      if (_viewerIsPartner()) {
        Notifs.showToast('Forwarding a post is available to internal staff only.', 'error');
        return;
      }
      try { usersById = await _usersByIdMap(false); } catch (_) { usersById = null; }
      if (!usersById || !Object.keys(usersById).length) {   // fail closed
        Notifs.showToast('Could not check who is in your chats — try again in a moment.', 'error');
        return;
      }
    }
    await _openConvPicker({
      title: 'Forward to…',
      exclude: sourceConvId,
      filter: guardPostRef ? (cv => _partnerBlockReason(cv, usersById)) : null,
      onPick: async target => {
        if (guardPostRef) {
          // Same fresh-data re-check the share flow runs, for the same reason:
          // the picker list is a snapshot.
          const guard = await _assertShareTargetSafe(target);
          if (!guard.ok) { Notifs.showToast(guard.reason, 'error'); return; }
          target = guard.conv;   // already provisioned + freshly re-read
        }
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
            media: m.media || null,   // Wave5 M3 — forwarding a media message reuses its uploaded photo URLs, no re-upload
            ref: m.ref || null        // Wave2 practicality batch — a forwarded record-link chip rides along too
          });
          Notifs.success('Forwarded');
        } catch (_) {
          Notifs.showToast('Forward failed', 'error');
        }
      }
    });
  }

  // ── Share a record into a conversation (window.Chat.shareToChat) ────────
  // `payload` is the SAME {kind, id, label} shape sendMessage's `ref` argument
  // already takes, so a shared post rides the existing record-link machinery
  // end to end — persist block, chip render, tap-to-open — with no new message
  // shape and (verified) no firestore.rules change: message create has no
  // keys().hasOnly() allowlist, only convMember() + authorId + the announcement
  // restriction (firestore.rules ~860-866).
  //
  // Today's only caller is the Posts feed's Share button (js/screens/people.js).
  async function shareToChat(payload) {
    if (!payload || !payload.kind || !payload.id) return;
    // Every conversation an external partner is in contains an external partner
    // — including their own — so a partner has nothing they could share into.
    // Say so plainly rather than opening a picker where every row is blocked.
    if (_viewerIsPartner()) {
      Notifs.showToast('Sharing to chat is available to internal staff only.', 'error');
      return;
    }
    let usersById = null;
    try { usersById = await _usersByIdMap(false); } catch (_) { usersById = null; }
    // FAIL CLOSED: with no users list there is no way to tell a partner
    // conversation from an internal one, so the picker must not open at all.
    if (!usersById || !Object.keys(usersById).length) {
      Notifs.showToast('Could not check who is in your chats — try again in a moment.', 'error');
      return;
    }
    await _openConvPicker({
      title: 'Share to…',
      filter: cv => _partnerBlockReason(cv, usersById),
      onPick: async target => {
        // SECOND enforcement point. The picker list is a snapshot: someone can
        // be added to a group, or have their role changed to partner, between
        // it painting and this tap. Re-verified against FRESH reads here.
        const guard = await _assertShareTargetSafe(target);
        if (!guard.ok) { Notifs.showToast(guard.reason, 'error'); return; }
        try {
          await sendMessage({ text: '', clientKey: _newClientKey(), conv: guard.conv, ref: payload });
          Notifs.success('Shared to chat');
        } catch (_) {
          Notifs.showToast('Could not share that — nothing was sent.', 'error');
        }
      }
    });
  }
  // The send-time half of the partner block. EVERY branch fails closed: any
  // thrown read, any missing conversation doc, any unresolvable participant,
  // and any partner participant all refuse the send.
  async function _assertShareTargetSafe(target) {
    if (!target || !target.id) return { ok: false, reason: 'Nothing was shared — that chat is unavailable.' };
    // A dept channel nobody has opened yet has no Firestore doc for the re-read
    // below to check. Provision it first (the same lazy-create Forward does),
    // and only for a channel this user is actually a member of.
    if (target._unprovisioned && target.type === 'dept'
        && myDeptChannels().indexOf(target.department) !== -1) {
      await _ensureDeptDocExists(target.department);
    }
    let snap = null;
    try { snap = await db.collection('conversations').doc(target.id).get(); }
    catch (_) { return { ok: false, reason: 'Could not verify who is in that chat — nothing was shared.' }; }
    if (!snap || !snap.exists) return { ok: false, reason: 'That chat no longer exists — nothing was shared.' };
    const conv = { id: snap.id, ...snap.data() };
    let fresh = null;
    try { fresh = await _usersByIdMap(true); } catch (_) { fresh = null; }
    if (!fresh || !Object.keys(fresh).length) {
      return { ok: false, reason: 'Could not verify who is in that chat — nothing was shared.' };
    }
    const why = _partnerBlockReason(conv, fresh);
    if (why) return { ok: false, reason: 'Not shared — ' + why.charAt(0).toLowerCase() + why.slice(1) + '.' };
    return { ok: true, conv };
  }

  // ── Wave2 practicality batch (P0) — "Attach a record" picker ──
  // Task / Quote / Bidding tabs (chipTabs, same pattern the Shared Media page
  // uses), a search box, and a scrollable shortlist. Every collection read
  // goes through .catch(()=>({docs:[]})) per spec — a denied read (e.g. a
  // partner against bk_quotes/gov_*, see this batch's report for the exact
  // per-collection rules) just contributes zero rows for that source rather
  // than throwing, so the picker degrades to "fewer results" instead of
  // erroring for any role. `onPick(ref)` is called with `{kind, id, label,
  // collection?}` once the caller taps a row.
  async function _openRefPicker(onPick) {
    const tabs = [{ key: 'task', label: 'Task' }, { key: 'quote', label: 'Quote' }, { key: 'bidding', label: 'Bidding' }];
    const body = `
      <div id="chat-ref-tabs"></div>
      <input id="chat-ref-search" class="ms-input" placeholder="Search…" style="width:100%;margin:10px 0"/>
      <div id="chat-ref-list" class="item-list"><div class="loading-placeholder">Loading…</div></div>`;
    window.openPage('Attach a record', body);
    document.getElementById('chat-ref-tabs').innerHTML = window.chipTabs(tabs, 'task');

    let allRows = [];   // current tab's rows: [{kind,id,label,collection?}]

    function renderRows(query) {
      const listEl = document.getElementById('chat-ref-list');
      if (!listEl) return;
      const q = (query || '').trim().toLowerCase();
      const filtered = q ? allRows.filter(r => r.label.toLowerCase().includes(q)) : allRows;
      listEl.innerHTML = filtered.length
        ? filtered.slice(0, 100).map(r => `<div class="item-card chat-ref-pick-row pressable" data-id="${escHtml(r.id)}" style="cursor:pointer;padding:10px">${escHtml(r.label)}</div>`).join('')
        : `<div class="empty-state" style="padding:16px"><p>No matches.</p></div>`;
      listEl.querySelectorAll('.chat-ref-pick-row').forEach(row => {
        row.addEventListener('click', () => {
          const r = filtered.find(x => x.id === row.dataset.id);
          if (!r) return;
          window.Overlay.dismissTop();
          onPick(r);
        });
      });
    }

    async function loadTab(kind) {
      const listEl = document.getElementById('chat-ref-list');
      if (listEl) listEl.innerHTML = '<div class="loading-placeholder">Loading…</div>';
      let rows = [];
      if (kind === 'task') {
        const snap = await dbCachedGet('chat-ref-tasks', () => db.collection('tasks').get(), 30000).catch(() => ({ docs: [] }));
        rows = snap.docs.map(d => ({ kind: 'task', id: d.id, label: d.data().title || '(untitled task)' }));
      } else if (kind === 'quote') {
        const [bk, bs] = await Promise.all([
          dbCachedGet('chat-ref-bk-quotes', () => db.collection('bk_quotes').get(), 30000).catch(() => ({ docs: [] })),
          dbCachedGet('chat-ref-bs-quotes', () => db.collection('bs_quotes').get(), 30000).catch(() => ({ docs: [] }))
        ]);
        rows = [
          // bk_quotes holds BOTH Barro Kitchens and Barro Industries quotes
          // (owner's filing ruling), so the prefix comes from the doc's own
          // company code, not from the collection name.
          ...bk.docs.map(d => { const q = d.data(); return { kind: 'quote', id: d.id, collection: 'bk_quotes',
            label: `${q.company || 'BK'} ${q.quoteNumber || d.id.slice(-6).toUpperCase()} — ${q.clientName || 'Unnamed'}` }; }),
          ...bs.docs.map(d => { const q = d.data(); return { kind: 'quote', id: d.id, collection: 'bs_quotes',
            label: `BS ${q.quoteNumber || d.id.slice(-6).toUpperCase()} — ${q.clientName || 'Unnamed'}` }; })
        ];
      } else if (kind === 'bidding') {
        // window.GOV_BUCKETS (js/screens/govit.js) is the canonical bucket
        // list; a hardcoded fallback covers the (unlikely, load-order) case
        // it hasn't parsed yet — same 3 collection names confirmed via recon.
        const buckets = (window.GOV_BUCKETS && window.GOV_BUCKETS.length) ? window.GOV_BUCKETS
          : [{ collection: 'gov_philgeps', label: 'PhilGEPS' }, { collection: 'gov_active_bids', label: 'Active Bids' }, { collection: 'gov_archive', label: 'Archive' }];
        const snaps = await Promise.all(buckets.map(b =>
          dbCachedGet('chat-ref-' + b.collection, () => db.collection(b.collection).get(), 30000).catch(() => ({ docs: [] }))
        ));
        rows = snaps.flatMap((snap, i) => snap.docs.map(d => { const g = d.data(); return { kind: 'bidding', id: d.id, collection: buckets[i].collection,
          label: `${g.title || g.name || 'Untitled'} (${buckets[i].label})` }; }));
      }
      allRows = rows;
      renderRows(document.getElementById('chat-ref-search')?.value || '');
    }

    window.bindChipTabs(document.getElementById('chat-ref-tabs'), key => loadTab(key));
    document.getElementById('chat-ref-search')?.addEventListener('input', e => renderRows(e.target.value));
    loadTab('task');
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
      // Opening your OWN just-sent photo shouldn't pull it back down the wire:
      // if the uploaded bytes are still in memory, show those. The download
      // link stays on the real Storage url — a blob: href would hand the user a
      // dead link the moment the preview is released.
      const local = _localPreviewSrc(it.url);
      // If the local blob is released while this lightbox is open (cap
      // eviction), fall back to the real url once rather than showing a broken
      // image. Guarded so a genuinely dead remote url can't loop.
      img.onerror = local ? () => { img.onerror = null; if (u) img.src = u; } : null;
      img.src = local || u; img.alt = it.name || '';
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
    // Wave2 practicality batch — announcement channels reuse the "group
    // management" surface (rename/photo/add-members/leave, all in _openMediaTab's
    // About section) verbatim; same creator-or-admin gate as a normal group.
    return (conv.type === 'group' || conv.type === 'announcement') && (conv.createdBy === currentUser.uid || _isAdminRole());
  }
  // Wave2 practicality batch (P2 stretch) — who may pin/unpin a message and who
  // may post in an announcement channel share the SAME gate: the conv's
  // creator, or an admin role. Mirrors the firestore.rules text in this
  // batch's report (pinnedMsgIds folded into the existing creator/admin
  // disjunct; message-create gated the same way for type:'announcement').
  function _canManageConv(conv) {
    return !!conv && (conv.createdBy === currentUser.uid || _isAdminRole());
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
          `<div class="chat-mediatab-thumb" data-idx="${i}"><img src="${_localPreviewSrc(it.url) || safeHttpUrl(it.url)}" loading="lazy" decoding="async" alt="${escHtml(it.name||'photo')}"/></div>`).join('')}</div>`
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
          // Wave2 practicality batch (P2 stretch) — announcement channel reuses
          // the group-shaped About section verbatim (see _isGroupAdmin above).
          : conv.type === 'announcement' ? `${memberCount} member${memberCount!==1?'s':''} · Announcements`
          : conv.type === 'dept' ? 'Department channel'
          : 'Direct message'
        }</div>
        ${(conv.type === 'group' || conv.type === 'announcement') ? `
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
          ${(conv.type === 'group' || conv.type === 'announcement') ? `
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
           _attachGlobalBadgeListener, _detachGlobalBadgeListener,
           // 2026-08 "share posts to chat" — called by the Posts feed's Share
           // button (js/screens/people.js). The partner block lives INSIDE it,
           // at both the picker and the pre-send re-check, so no caller can
           // route around it.
           shareToChat,
           // Test seams for the partner block (headless harness only — nothing
           // in the app calls these). Exposed so the guard can be exercised
           // against a constructed partner conversation without a production
           // sign-in.
           _partnerBlockReason, _roleIsPartner, _viewerIsPartner, _assertShareTargetSafe,
           _recentDmIds };   // Wave2 practicality batch — read by renderChatPage's New Message picker
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
    // Wave2 practicality batch (P1) — dept-grouped picker with a "Recents"
    // section. deptLabel mirrors _targetsFor's own dept-membership rule
    // (single `department` field, first entry of a `departments` array as a
    // fallback) so grouping reads the SAME field the rest of chat.js already
    // treats as canonical. Recents = window.Chat._recentDmIds(), filtered to
    // candidates still eligible today (a partner whose company changed, or a
    // deactivated account, silently drops out rather than dead-ending).
    const byUid = {}; candidates.forEach(u => { byUid[u.id] = u; });
    const deptLabel = u => u.department || (Array.isArray(u.departments) && u.departments[0]) || 'Other';
    const recentIds = (window.Chat._recentDmIds ? window.Chat._recentDmIds() : []).filter(id => byUid[id]);
    // buildListHtml re-derives the grouped/recents markup from the CURRENT
    // search query — called once for the initial render and again on every
    // debounced keystroke (wireRows re-binds afterward either way, same
    // "rebuild + rebind" pattern _renderInbox already uses for its own rows).
    const buildListHtml = query => {
      const q = (query || '').trim().toLowerCase();
      const matches = u => !q
        || (u.displayName || u.email || '').toLowerCase().includes(q)
        || (u.role || '').toLowerCase().includes(q)
        || deptLabel(u).toLowerCase().includes(q);   // Wave2 — search also matches department
      let html = '';
      const recentUsers = recentIds.map(id => byUid[id]).filter(Boolean).filter(matches);
      if (recentUsers.length) {
        html += `<div class="ms-picker-group-label">${emojiIcon('clock',12)} Recent</div>` + recentUsers.map(rowHtml).join('');
      }
      const recentSet = new Set(recentUsers.map(u => u.id));
      const groups = {};
      candidates.filter(u => !recentSet.has(u.id)).filter(matches).forEach(u => {
        const g = deptLabel(u);
        (groups[g] = groups[g] || []).push(u);
      });
      Object.keys(groups).sort((a, b) => a.localeCompare(b)).forEach(g => {
        html += `<div class="ms-picker-group-label">${escHtml(g)}</div>` + groups[g].map(rowHtml).join('');
      });
      return html || '<div class="empty-state" style="padding:16px"><p>No matches.</p></div>';
    };

    const body = `
      <input id="chat-pick-search" class="ms-input" placeholder="Search people or department…" style="width:100%;margin-bottom:10px"/>
      <div id="chat-pick-list" class="item-list">${candidates.length ? buildListHtml('') : '<div class="empty-state" style="padding:16px"><p>No one to message yet.</p></div>'}</div>
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
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer">
          <input type="checkbox" id="chat-group-announcement-cb"/>
          <span style="font-size:12px;color:var(--text-muted)">Announcement channel — only you and admins can post</span>
        </label>
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
      const listEl = document.getElementById('chat-pick-list');
      if (listEl) listEl.innerHTML = buildListHtml(e.target.value);
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
      // Wave2 practicality batch (P2 stretch) — announcement channel: same
      // group-shaped doc, just a different `type` — firestore.rules' create
      // rule needs 'announcement' added alongside 'dm'/'group' (see this
      // batch's report); message-create there is what actually enforces
      // "only admin/creator may post" server-side.
      const isAnnouncement = !!document.getElementById('chat-group-announcement-cb')?.checked;
      try {
        const ref = await db.collection('conversations').add({
          type: isAnnouncement ? 'announcement' : 'group', participants, participantNames, name,
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
