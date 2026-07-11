# Workstream 37 — Team Chat (DMs, group/dept channels, presence, reactions, push)

## DECIDED — architecture spec (Fable, 2026-07-10)

*(Grounding research — current state, data model, constraints, risks — is preserved
below this section. Every citation there was re-verified against the live checkout
before deciding. One NEW fact found during decision-review that the brief missed:
the WS19-hardened `notifications` create rule (firestore.rules ~188) has a
`keys().hasOnly([...])` field allowlist — so the new `chatId` notification field
REQUIRES a rules edit (Spec 2c) — and `Notifs.send`'s `dedupKey` pre-check is
silently a NO-OP for cross-user sends (the sender's query against the TARGET's
inbox is rules-denied and `.catch(()=>({empty:true}))` makes it always-send,
notifications.js:256-258) — so chat anti-spam CANNOT use `dedupKey` (Decision 6).)*

### Resolved decisions (one line each + rationale)

1. **Data model → ONE top-level `conversations` collection, `type: 'dm'|'group'|'dept'`, with `messages`/`readers`/`typing` subcollections.** The per-department-collection scheme (`chat_<dept>` + a `coll.matches()` wildcard rule) is REJECTED — the brief's own constraint says prefer one well-known collection with explicit rules, matching how `tasks`/`submissions` are modeled. DM doc ID is deterministic: `dm_{uidA}_{uidB}` (uids sorted lexicographically) — kills duplicate DM threads with zero `_counters` transactions; groups get auto-IDs; dept channels get `dept_{DeptKey}` (spaces in keys like `Government Biddings` are legal in doc IDs).
2. **Dept-channel membership → DERIVED, never stored.** Rules-side: the existing `inDept(d)` helper (firestore.rules:72-75) OR `isAdmin()`; client-side: `currentDepts.includes(dept)` OR role in president/manager/secretary. `participants` stays `[]` on dept docs (no array to drift when HR reassigns departments). Channels exist ONLY for the 10 internal departments — `Object.keys(DEPARTMENTS).filter(d => !DEPARTMENTS[d].isSeparate && !DEPARTMENTS[d].isPartnerDept)` — i.e. **`Brilliant Steel` and `Partners` get NO channels, ever**, which structurally eliminates the cross-partner-company leak the brief flags. Channels are lazily created on first open by any member (no admin setup step).
3. **Partner wall → participant-scoped everywhere + stricter-than-`renderTeamTab` recipient picker.** A partner can read/write ONLY conversations whose `participants` array contains them (same conditional shape as `tasks/comments`), and can NEVER pass the dept branch (`!isPartner()` is explicit in the rule). Client picker for a partner = **same-company partners (`users.company` match) + president/manager only** — deliberately stricter than `renderTeamTab`'s "all partners" filter (modules.js:372-376), because an undifferentiated partner pool is exactly the cross-company leak risk the brief names. Note chat is STRICTER than tasks for internal users too: internal staff may read any task, but may NOT read a DM/group they're not in. Creation-side (a partner client-forging a conversation with arbitrary participants) is client-gated only — acceptable residual: the wall protects READS; a forged conversation exposes nothing and is visible/deletable by the President.
4. **Live delivery → a hard 4-listener budget with page/Overlay-tied lifecycle; no global chat listener.** (a) INBOX: one `where('participants','array-contains', uid)` `onSnapshot` — attached in `renderChatPage`, detached by a one-line hook in `navigateTo` (Spec 6c); **no `orderBy` → no composite index → no firestore.indexes.json change**; client sorts by `lastMessageAt`. Dept channels enter the inbox via deterministic-ID direct `.get()`s (a `where('type','==','dept')` list query would be rules-unprovable for non-admins — direct gets are provable per-doc). (b) THREAD (max one open at a time): `messages.orderBy('createdAt','desc').limit(50)` + `readers` + `typing` snapshots, ALL torn down in the `Overlay.push('chat', teardown)` callback. Pagination: "Load earlier" = one-shot `.startAfter(oldestSnap).limit(50).get()` (older pages are static — edits/reactions on them don't live-update; accepted). Unread = **boolean dot** (`lastMessageAt > my readers/{uid}.readAt`), not per-message counts (counts would need message reads per conversation per inbox render).
5. **Full page with Back → fork the `task-fullscreen-panel` pattern (departments.js:703-852) for the thread view; `openPage()` only for one-shot forms** (New Message picker / New Group). The task panel is the proven "panel hosting a live-updating child region + Overlay-registered Back" template; `openPage`'s static-bodyHTML contract can't host a self-updating thread. The chat INBOX is a normal router page (`case 'chat'` in `navigateTo`), like `team-directory`.
6. **Notifications → per-recipient `Notifs.send` loop (the `task_message` precedent, departments.js:1915-1931) with a new `type:'chat_message'` + new `chatId` field; push rides `sendPushOnNotification` with ZERO `functions/` changes.** Anti-spam is sender-side, NOT `dedupKey` (cross-user dedup is rules-broken, see header note): (a) skip recipients whose live `readers/{uid}.readAt` is <45s old (they're looking at the thread — zero extra reads, the open thread's readers snapshot already has this), (b) in-memory 60s throttle per `(conversation, recipient)`. Dept-channel sends notify **actual dept members only** (both `department` string AND `departments` array, mirroring `sendToDept`'s duality handling) — implicit admin members are NOT notified (the President must not get pushed for all 10 channels). Opening a conversation marks that conversation's `chat_message` notifs read (single-field `where('chatId','==',convId)` on your OWN inbox — owner-allowed, no index). OS-level push tap just focuses the app (firebase-messaging-sw.js:73-83 has no deep-linking) — routing happens from the in-app bell via the new `_navigateFromNotif` branch; this is exact parity with `task_message`, do NOT add push-SW deep-linking.
7. **Presence → read `users/{uid}.lastSeen` through the existing `'users-presence'` 8s-TTL cache and `getPresence()` buckets (app.js:6800-6814); NO new heartbeat, NO per-user `onSnapshot`.** DM thread header shows the dot/label, refreshed by a 30s `setInterval` (cleared in thread teardown). Honors WS16 D10.
8. **Typing → `conversations/{id}/typing/{uid}` beacon docs `{uid, name, at}`:** write throttled to ≥4s apart while keystrokes occur, deleted on send/panel-close (best-effort `.catch`); readers show "X is typing…" for beacons <6s old, re-evaluated by a 2s interval so stale beacons expire without snapshots. Deliberately separate from the presence heartbeat (WS16 D10 forbids tightening it).
9. **Reactions → a `reactions` map field ON the message doc (`{uid: emoji}`, one reaction per user, tap-again to clear/change),** guarded by a `Map.diff().affectedKeys().hasOnly([request.auth.uid])` rule so a member can only ever touch their OWN key. Rides the existing messages listener — zero extra listeners/reads. (A reactions subcollection was rejected: N extra listeners.)
10. **Attachments → new Storage path `chat-files/{convId}/{ts}_{filename}`, posture (b) from the brief + a no-list hardening:** access truth lives on the Firestore-gated message doc carrying the URL; Storage allows `get` to any signed-in user but **`list: if false`** — mandatory because DM convIds are DERIVABLE from uids (`dm_{a}_{b}`, and `users` is world-readable to authed users), so enumeration must be blocked; the `Date.now()`-prefixed filename keeps full paths unguessable. Write = signed-in + `isValidDocument()` (≤25MB), partners included (they may attach in their own DMs). `chat-files` is ADDED to `isReservedTop` (storage.rules:103-108). Do NOT reuse the partner-open `task-comments/` block.
11. **Code home → NEW file `js/chat.js` (a `window.Chat` IIFE + `window.renderChatPage`), loaded LAST (after modules.js)** in index.html AND appended to sw.js `PRECACHE`. All cross-file references (`escHtml`, `Notifs`, `Overlay`, `navigateTo`, `dbCachedGet`, `DEPARTMENTS`, `currentUser`/`currentRole`/`currentDepts`/`userProfile` — shared classic-script global scope) resolve at runtime only; `navigateTo` calls it via optional chaining (`window.renderChatPage?.()`), same as modules.js pages.
12. **`renderComments` is NOT touched.** Chat forks its markup/CSS (`.messenger-wrap`/`.ms-*` classes in css/styles.css) and its attach/link/edit/delete UX into chat.js's own live renderer. Task/submission threads keep their fetch-once behavior (upgrading them is out of scope, per the brief's risk note).
13. **Nav/entry points → new page key `'chat'`:** sidebar entry in all five role branches of `getSidebarItems`, `{icon:'message-circle',label:'Chat',page:'chat'}` added to all five `*_BOTTOM_NAV` arrays, a 💬 button on Team directory cards (`renderTeamCards`) that calls `Chat.openDM(uid)`, and the notification-tap route.
14. **Retention/deletion → messages: author-or-admin delete (parity with comments rules); conversations: President-only delete; no pruning** (owner "records kept forever" directive). Reading own missing/denied docs is always `.catch`-wrapped per repo convention.

**Cross-workstream:** WS38 (Files Hub) — `chat-files/` is chat-private (message-doc-gated); if WS38 ships a general share mechanism, chat attachments stay as-is (a chat attachment is part of a conversation, not a library document) — coordinate only on the `isReservedTop` list, where both add segments. WS16 (perf) — the 4-listener budget + `.limit(50)` + page-scoped inbox listener is the cost posture; nothing here polls.

---

### Spec 1 — Data shapes (annotated literals)

```js
// conversations/{convId}   — NEW top-level collection.
//   convId: 'dm_{uidA}_{uidB}' (sorted) | auto-ID (group) | 'dept_{DeptKey}'
{ type: 'dm',                        // REQUIRED 'dm'|'group'|'dept'
  participants: ['uidA','uidB'],     // REQUIRED. dm: exactly 2, sorted; group: 2+ incl. creator; dept: [] ALWAYS (field present, empty — membership derived via inDept()/isAdmin())
  participantNames: {uidA:'Neil B'}, // denormalized display map (dm/group); {} for dept
  name: null,                        // group: REQUIRED string; dept: the department key; dm: null (derive other party)
  department: null,                  // dept only: a DEPARTMENTS key; else null
  createdBy: 'uidA', createdByName: 'Neil B',
  createdAt: serverTimestamp,
  lastMessageAt: null,               // Timestamp|null — inbox sort key (client-side sort; NO index)
  lastMessageText: null,             // string|null — ≤80-char preview ('🔗 Link' / '📎 name' for attachments)
  lastMessageBy: null, lastMessageByName: null }

// conversations/{convId}/messages/{autoId}   — mirrors tasks/{id}/comments + reactions
{ text: '',                          // string, may be '' when attachment-only
  authorId: 'uid',                   // REQUIRED == request.auth.uid at create
  authorName: 'Neil B',
  fileUrl: null, fileName: null,     // string|null — Storage download URL or pasted link
  fileSource: null,                  // 'link'|null (null = uploaded file)
  createdAt: serverTimestamp,
  editedAt: serverTimestamp,         // OPTIONAL — set only on edit
  reactions: { uid1:'👍', uid2:'❤️' } }  // OPTIONAL map — ONE emoji per uid; absent until first reaction

// conversations/{convId}/readers/{readerUid}  — verbatim tasks/{id}/readers shape
{ uid: 'readerUid', name: 'Neil B', readAt: serverTimestamp }

// conversations/{convId}/typing/{typerUid}    — short-lived beacon (client deletes; readers expire >6s)
{ uid: 'typerUid', name: 'Neil B', at: serverTimestamp }

// notifications/{uid}/items/{autoId}          — EXISTING; ONE new optional field
{ ..., type: 'chat_message', chatId: '<convId>' }   // chatId REQUIRES the Spec 2c rules edit
```
Avatars/photos are NOT denormalized onto messages — the thread renderer resolves `photoUrl` from the shared `dbCachedGet('users', ...)` cache (60s TTL; note config.js:354-356 hard-wires this key to the payroll-merged fetcher — accepted, it's the standard shared cache).

### Spec 2 — firestore.rules diff (deploy: `~/.npm-global/bin/firebase deploy --only firestore:rules`, separate from `git push`; re-`git diff` first per the concurrent-edit memory)

**2a — NEW `conversations` family. Insert immediately AFTER the `tasks/{taskId}` block (after firestore.rules:327's closing brace).** Uses the proven `tasks` shapes: participant-conditional partner wall, per-viewer-owned reader docs, and a `taskAssignee()`-style re-read helper for subcollections (rules do NOT cascade).

```
    // ── Team Chat (v12 WS37) — conversations + messages/readers/typing ──
    // One collection, three types: 'dm' | 'group' | 'dept'.
    //  • dm/group: membership = the participants array. A partner may read/write
    //    ONLY conversations they're a participant of (conditional wall, same
    //    semantics as tasks/comments) — and unlike tasks, internal staff are
    //    participant-scoped too (nobody reads a DM they're not in).
    //  • dept: membership derived live via isAdmin() || inDept(department);
    //    partners NEVER pass this branch. participants stays [] on dept docs.
    // Rules do NOT cascade — messages/readers/typing each get an explicit match.
    match /conversations/{convId} {
      // Membership vs THIS doc (parent reads/updates — no extra get()).
      function memberOfDoc() {
        return (request.auth.uid in resource.data.get('participants', []))
          || (resource.data.get('type','') == 'dept' && !isPartner()
              && (isAdmin() || inDept(resource.data.get('department',''))));
      }
      // Membership via re-read, for subcollections (mirrors taskAssignee()).
      function convMember() {
        let c = get(/databases/$(database)/documents/conversations/$(convId)).data;
        return (request.auth.uid in c.get('participants', []))
          || (c.get('type','') == 'dept' && !isPartner()
              && (isAdmin() || inDept(c.get('department',''))));
      }

      // get: any member. list: the inbox query is participants array-contains,
      // provable from the first disjunct; dept docs are fetched by direct get.
      allow read: if isAuth() && memberOfDoc();

      // dm/group: creator must include themself. dept: lazy-create by any member;
      // the doc ID must be exactly 'dept_<department>' and participants must be [].
      allow create: if isAuth() && (
        ( request.resource.data.get('type','') in ['dm','group']
          && request.resource.data.get('createdBy','') == request.auth.uid
          && request.auth.uid in request.resource.data.get('participants', []) )
        ||
        ( request.resource.data.get('type','') == 'dept' && !isPartner()
          && (isAdmin() || inDept(request.resource.data.get('department','')))
          && convId == 'dept_' + request.resource.data.get('department','')
          && request.resource.data.get('participants', []).size() == 0 )
      );

      // Any member may bump ONLY the lastMessage* preview fields (the second
      // write of every send). Creator/admin manage the doc (rename, members).
      // A participant may remove exactly themself ("leave group").
      allow update: if isAuth() && (
        ( memberOfDoc() && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['lastMessageAt','lastMessageText','lastMessageBy','lastMessageByName']) )
        || resource.data.get('createdBy','') == request.auth.uid
        || isAdmin()
        || ( request.resource.data.diff(resource.data).affectedKeys().hasOnly(['participants'])
             && request.resource.data.get('participants', [])
                == resource.data.get('participants', []).removeAll([request.auth.uid]) )
      );

      allow delete: if isAuth() && isPresident();   // records kept forever

      match /messages/{messageId} {
        allow read:   if isAuth() && convMember();
        allow create: if isAuth() && convMember()
          && request.resource.data.get('authorId','') == request.auth.uid;
        // Author edits own message; admin moderates; any member may toggle
        // their OWN key inside the reactions map — and nothing else.
        allow update: if isAuth() && (
          resource.data.get('authorId','') == request.auth.uid
          || isAdmin()
          || ( convMember()
               && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactions'])
               && request.resource.data.get('reactions', {})
                    .diff(resource.data.get('reactions', {})).affectedKeys()
                    .hasOnly([request.auth.uid]) )
        );
        allow delete: if isAuth()
          && (resource.data.get('authorId','') == request.auth.uid || isAdmin());
      }
      // Read receipts — per-viewer-writes-own-doc, verbatim tasks/readers shape
      // (+ convMember so a non-participant can't plant a receipt).
      match /readers/{readerUid} {
        allow read:  if isAuth() && convMember();
        allow write: if isAuth() && isOwner(readerUid) && convMember();
      }
      // Typing beacons — own doc only (write covers create/update/delete).
      match /typing/{typerUid} {
        allow read:  if isAuth() && convMember();
        allow write: if isAuth() && isOwner(typerUid) && convMember();
      }
    }
```
Notes for Sonnet: `let` in rule functions, `Map.diff().affectedKeys()`, `List.removeAll()`, and string `+` are all rules-v2 features (the file is already `rules_version = '2'`; `let` is used at firestore.rules:37). Every field read uses `.get(field, default)` per the missing-field-throws memory. A `get` on a NONEXISTENT conversation doc evaluates `resource == null` → throws → denies — the client's lazy-create paths `.catch()` that and proceed to create (Spec 4).

**2b — no firestore.indexes.json change.** Inbox = array-contains only; messages = single-field orderBy. State this explicitly so nobody "helpfully" adds one.

**2c — `notifications` create rule (firestore.rules ~188) — BEFORE → AFTER (add `chatId` to the allowlist):**
```
// BEFORE
        && request.resource.data.keys().hasOnly(['title','body','icon','type','link','read','createdAt','dedupKey','taskId'])
// AFTER
        && request.resource.data.keys().hasOnly(['title','body','icon','type','link','read','createdAt','dedupKey','taskId','chatId'])
```
Without this, every chat notification write is silently denied (the send loop's `.catch` would eat it and chat pushes would just never arrive).

### Spec 3 — storage.rules diff (deploy: `~/.npm-global/bin/firebase deploy --only storage:rules`, separate step)

**3a — `isReservedTop` (storage.rules:103-108) — BEFORE → AFTER:**
```
// BEFORE
    function isReservedTop(seg) {
      return seg == 'Finance'
        || seg == 'tasks' || seg == 'posts'
        || seg == 'general' || seg == 'General'
        || seg == 'profile-photos' || seg == 'task-comments';
    }
// AFTER
    function isReservedTop(seg) {
      return seg == 'Finance'
        || seg == 'tasks' || seg == 'posts'
        || seg == 'general' || seg == 'General'
        || seg == 'profile-photos' || seg == 'task-comments'
        || seg == 'chat-files';
    }
```

**3b — NEW block, insert directly after the `task-comments` block (storage.rules:139-144):**
```
    // ── Team Chat attachments (v12 WS37) ─────────────
    // Storage rules cannot read Firestore, so per-conversation participant
    // checks are impossible here. Model: access truth lives on the Firestore-
    // gated message doc that carries the URL. Direct GET is open to any
    // signed-in user, but LIST is forbidden — DM conversation ids are
    // derivable from uids (dm_{a}_{b}), so enumeration must be blocked; the
    // Date.now()-prefixed filename keeps full paths unguessable.
    match /chat-files/{convId}/{fileName} {
      allow get:  if isSignedIn();
      allow list: if false;
      allow write: if isSignedIn()
        && (request.resource == null || isValidDocument());
    }
```

### Spec 4 — NEW file `js/chat.js` (window.Chat IIFE + renderChatPage)

Skeleton with every load-bearing body spelled out. Markup not shown verbatim reuses the `.messenger-wrap`/`.ms-row`/`.ms-bubble`/`.ms-avatar`/`.ms-seen`/`.messenger-input-row` classes and the attach/link/edit/delete UX forked from `renderComments` (departments.js:1775-1826, 1833-1875) — same `escHtml`/`safeHttpUrl` discipline at every interpolation.

```js
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
        .catch(() => null)             // read on missing doc is rules-denied → treat as unprovisioned? No: denied ≠ missing; drop it
    ))).filter(Boolean);
  }
  async function _refreshMyReads() {
    const all = [..._convs, ..._deptConvs];
    await Promise.all(all.map(cv =>
      db.collection('conversations').doc(cv.id).collection('readers').doc(currentUser.uid).get()
        .then(s => { _myReads[cv.id] = s.exists ? (s.data().readAt?.toMillis?.() || 0) : 0; })
        .catch(() => { _myReads[cv.id] = 0; })));
  }
  function _isUnread(cv) {
    const last = cv.lastMessageAt?.toMillis?.() || 0;
    return last > 0 && cv.lastMessageBy !== currentUser.uid && last > (_myReads[cv.id] || 0);
  }
  // _renderInbox(): merge _convs + _deptConvs, filter by _filter chip
  // ('all'|'dm'|'group'|'dept'), sort by lastMessageAt desc (nulls last),
  // rows: avatar/initials (dm: other party via participantNames + presence dot
  // from the users-presence cache; group: name; dept: DEPARTMENTS[d].icon + name),
  // bold title + unread dot when _isUnread, muted lastMessageText preview
  // (escHtml), timeAgo on the right. Row click → cv._unprovisioned
  // ? openDeptChannel(cv.department) : openConversation(cv.id, cv).

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

  // ── Presence header (Decision 7 — reuses users-presence cache, NO listener) ──
  function _startPresenceHeader(conv) {
    const otherUid = (conv.participants || []).find(u => u !== currentUser.uid);
    const paint = async () => {
      const el = document.getElementById('chat-presence-label'); if (!el || !otherUid) return;
      const snap = await dbCachedGet('users-presence', fetchUsersWithPayroll, 8000).catch(() => null);
      const u = snap && snap.docs.map(d => ({ id: d.id, ...d.data() })).find(x => x.id === otherUid);
      // getPresence bucket logic (app.js:6805-6814): <3min green 'Online',
      // <30min orange 'Xm ago', else gray 'Xh/Xd ago' / 'Unknown'.
      /* set dot colour + label exactly per those buckets */
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

  // _renderThread({keepScrollAnchor}): re-renders ONLY #chat-thread-scroll
  // (composer lives OUTSIDE it → input value survives every snapshot):
  //   const el = document.getElementById('chat-thread-scroll'); if (!el) return;
  //   const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  //   el.innerHTML = _threadHtml([..._earlier, ..._msgs]);   // day dividers via
  //     _manilaDay/_dayLabel; bubbles fork renderComments markup (mine/theirs,
  //     avatar from users cache, inline image via the isImage regex +
  //     safeHttpUrl, file/link chips, (edited) tag); reaction chips grouped by
  //     emoji with count (own = highlighted, click → toggleReaction); tapping a
  //     bubble toggles a 6-emoji REACTIONS picker row for that message;
  //     ✎/🗑 actions: own message → promptDialog edit / confirmDialog delete,
  //     admin → delete (NO manual re-render calls — the listener repaints);
  //     "Seen by" avatar stack under the LAST message: _readers where
  //     uid != lastMsg.authorId && uid != currentUser.uid && readAt >=
  //     lastMsg.createdAt (max 5 mini-initials + "+N", title = full names);
  //     a "↑ Load earlier" button at top when (_earlier.length + _msgs.length)
  //     >= PAGE_SIZE → loadEarlier().
  //   if (atBottom && !keepScrollAnchor) el.scrollTop = el.scrollHeight;

  return { openDM, openConversation, openDeptChannel, sendMessage, toggleReaction,
           loadEarlier, onComposerInput, teardownInbox, teardownThread,
           dmIdFor, myDeptChannels, dmCandidates, _attachInbox };
})();

// ── Inbox page (router target: case 'chat') ──
window.renderChatPage = async function() {
  const c = document.getElementById('page-content'); if (!c) return;
  c.innerHTML = `
    <div class="page-header"><h2>💬 Chat</h2>
      <button class="btn-primary btn-sm" id="chat-new-btn">+ New Message</button></div>
    <div id="chat-filter"></div>
    <div id="chat-inbox"><div class="loading-placeholder">Loading…</div></div>`;
  const chips = [{ key: 'all', label: 'All' }, { key: 'dm', label: 'DMs' },
                 { key: 'group', label: 'Groups' }];
  if (window.Chat.myDeptChannels().length) chips.push({ key: 'dept', label: 'Channels' });
  document.getElementById('chat-filter').innerHTML = window.chipTabs(chips, 'all');
  window.bindChipTabs(document.getElementById('chat-filter'),
    k => window.Chat && (window.Chat._filter = k, undefined));  // Sonnet: route via a setFilter(k) export that re-renders
  document.getElementById('chat-new-btn').addEventListener('click', () => {
    // openPage('New Message', body) — Decision 5: openPage for one-shot forms.
    // Body: search input + dmCandidates(users) rows (avatar/name/role; escHtml)
    //   → click = Overlay.dismissTop() then Chat.openDM(uid);
    // + a "👥 New Group" section (partners: HIDDEN — partner group creation is
    //   out of scope v1): name input + member checkbox list from dmCandidates →
    //   create {type:'group', participants: sorted unique picked + self,
    //   participantNames, name, createdBy/…, lastMessage*: null} via
    //   .add(), then Overlay.dismissTop() + Chat.openConversation(newId).
  });
  window.Chat._attachInbox();
};
```
(The two commented render bodies — `_renderInbox` and `_threadHtml` — are deliberately prose-specified: pure markup with all behavior, ids, data flow, escaping, and event wiring pinned above; no judgment calls remain.)

### Spec 5 — Thread panel (fork of `task-fullscreen-panel`, departments.js:727-850)

`_buildThreadPanel(conv)` — exact structural contract:

```js
function _buildThreadPanel(conv) {
  document.getElementById('chat-thread-panel')?.remove();
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
      <!-- avatar/initials · title (escHtml: DM = other party's name from
           participantNames; group = conv.name; dept = DEPARTMENTS icon + name)
           · subtitle: DM → <span id="chat-presence-dot"></span><span id="chat-presence-label"></span>
                       group/dept → member count -->
    </div>
    <div id="chat-thread-scroll" style="flex:1;overflow-y:auto;padding:12px 14px"></div>
    <div id="chat-typing-row" style="min-height:16px;font-size:11px;color:var(--text-muted);padding:0 14px"></div>
    <div id="chat-file-preview" style="font-size:11px;color:var(--primary-light);padding:0 14px 4px;min-height:16px"></div>
    <!-- composer: .messenger-input-row fork — 📎 file input #chat-file
         (same accept list as departments.js:1818), link btn #chat-link
         (promptDialog, https:// coercion, replaces pending file — mirrors
         departments.js:1843-1852), #chat-input .ms-input
         (input → Chat.onComposerInput; Enter-no-shift → send),
         #chat-send .ms-send-btn (disable while sending) -->`;
  document.body.appendChild(p);
  if (window.lucide) lucide.createIcons({ nodes: [p] });
  requestAnimationFrame(() => { p.style.transform = 'translateY(0)'; p.style.opacity = '1'; });
  window.Overlay.push('chat', () => window.Chat.teardownThread());   // ONE history entry
  document.getElementById('chat-panel-back')
    .addEventListener('click', () => window.Overlay.dismissTop());   // Back = history.back()
  // composer wiring: send → Chat.sendMessage({text, file, link}) then clear
  // input/file/preview (NO re-render call — the messages listener repaints)
}
```
Lifecycle guarantees this buys for free (config.js:526-548 + app.js:7417-7424): device/browser Back, Esc, and any `navigateTo` (which calls `Overlay.clearAll()`, app.js:1956) all run `teardownThread()` → every thread listener detaches; there is NO code path that leaves a chat `onSnapshot` running on another page. The inbox listener is the one non-Overlay surface, handled by the Spec 6c hook.

### Spec 6 — Edits to EXISTING files (before → after, anchored)

**6a — notifications.js:252 `send()` — accept + persist `chatId`:**
```js
// BEFORE
  async function send(targetUid, { title, body, icon = '🔔', type = 'general', link = null, dedupKey = null, taskId = null } = {}) {
// AFTER
  async function send(targetUid, { title, body, icon = '🔔', type = 'general', link = null, dedupKey = null, taskId = null, chatId = null } = {}) {
```
```js
// BEFORE (notifications.js:264-266)
      ...(dedupKey ? { dedupKey } : {}),
      ...(taskId ? { taskId } : {})
    };
// AFTER
      ...(dedupKey ? { dedupKey } : {}),
      ...(taskId ? { taskId } : {}),
      ...(chatId ? { chatId } : {})
    };
```

**6b — notifications.js:67 `_navigateFromNotif` — new FIRST branch + plumb `chatId`:**
```js
// BEFORE
  function _navigateFromNotif(type, taskId) {
    document.getElementById('notif-panel')?.classList.add('hidden');
    document.getElementById('notif-backdrop')?.classList.add('hidden');
    if (taskId || type?.startsWith('task')) {
// AFTER
  function _navigateFromNotif(type, taskId, chatId) {
    document.getElementById('notif-panel')?.classList.add('hidden');
    document.getElementById('notif-backdrop')?.classList.add('hidden');
    if (type === 'chat_message') {
      if (typeof navigateTo === 'function') navigateTo('chat');
      if (chatId && window.Chat?.openConversation) window.Chat.openConversation(chatId);
      return;
    }
    if (taskId || type?.startsWith('task')) {
```
Plus three mechanical companions: (i) NAV_TYPES (notifications.js:100) gains `'chat_message'`; (ii) the notif-item template (notifications.js:116) gains `data-chat-id="${escHtml(n.chatId||'')}"` beside `data-task-id`; (iii) the view-btn handler (notifications.js:213-227) reads `const chatId = item?.dataset.chatId || '';` and calls `_navigateFromNotif(type, taskId, chatId);`.

**6c — app.js `navigateTo` — teardown hook + router case:**
```js
// BEFORE (app.js:1970-1971)
  // Close task fullscreen panel if open
  if (typeof window.closeTaskPanel === 'function') window.closeTaskPanel();
// AFTER
  // Close task fullscreen panel if open
  if (typeof window.closeTaskPanel === 'function') window.closeTaskPanel();
  // Team Chat (WS37): the inbox listener is page-scoped, not Overlay-scoped —
  // detach it whenever any page other than chat renders. (The THREAD listeners
  // are Overlay-scoped and already torn down by Overlay.clearAll() above.)
  if (page !== 'chat' && window.Chat?.teardownInbox) window.Chat.teardownInbox();
```
```js
// BEFORE (app.js:2020)
    case 'team-directory':   window.renderTeamTab?.(); break;
// AFTER
    case 'team-directory':   window.renderTeamTab?.(); break;
    case 'chat':             window.renderChatPage?.(); break;
```

**6d — app.js `getSidebarItems` — one insertion per role branch** (`{ icon:'message-circle', label:'Chat', page:'chat' }`): admin branch after Posts (app.js:929); generic-partner branch after Posts (951); Brilliant-partner branch after Posts (959); bsOnly branch after 'My Projects' (968 — these are INTERNAL BS-only staff, they chat); employee branch after Posts (976).

**6e — config.js bottom-nav arrays (279-321)** — append `{ icon: 'message-circle', label: 'Chat', page: 'chat' }` to ALL FIVE arrays (`BOTTOM_NAV_ITEMS`, `PRESIDENT_BOTTOM_NAV`, `PARTNER_BOTTOM_NAV`, `PARTNER_GENERIC_BOTTOM_NAV`, `BRILLIANT_BOTTOM_NAV`), positioned directly after the 'Posts' item where present, else after 'Projects'. (The top-nav strip renders these — 6 items is accepted.)

**6f — modules.js `renderTeamCards` (~849-851) — DM entry point.** In `.team-card-actions`, after the nudge button:
```js
${!isMe && (!(typeof isPartner==='function'&&isPartner()) || u.role==='partner'&&(u.company||'').trim()===(window.userProfile?.company||'').trim())
  ? `<button class="team-card-btn chat-dm-btn" data-uid="${u.id}" title="Message ${escHtml(u.displayName||u.email)}">💬</button>` : ''}
```
Wiring (next to the nudge wiring, ~modules.js:862):
```js
  grid.querySelectorAll('.chat-dm-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); window.Chat?.openDM?.(btn.dataset.uid); });
  });
```

**6g — index.html + sw.js.** index.html: `<script defer src="js/chat.js"></script>` inserted AFTER the modules.js tag (line 323 — chat.js loads last). sw.js: add `'/js/chat.js'` to `PRECACHE` after `'/js/modules.js'` (line 33). `CACHE_VER` (sw.js:11, currently `bi-ops-v174`): the pre-commit hook auto-bumps per the sw-cache-bump memory — verify the bump landed in the commit diff; if not, bump by hand.

**6h — functions/index.js: NO CHANGES.** `sendPushOnNotification` fires on any `notifications/{uid}/items` doc and forwards only title/body/type/notifId/uid (functions/index.js:45-60) — chat pushes ride it as-is. Confirmed: no group-fan-out server logic is needed (the client loop + batched Notifs writes cover ≤ dept-size recipients), and `chatId` intentionally does NOT ride the FCM payload (push tap focuses the app; routing is the in-app bell's job — parity with `task_message`).

### Spec 7 — Migration / rollout checklist (ordered)

1. **Deploy rules FIRST**, both services, separately: `~/.npm-global/bin/firebase deploy --only firestore:rules` (Spec 2a + 2c) and `--only storage:rules` (Spec 3). Re-`git diff` both files immediately before each deploy (concurrent-session memory). Old clients are unaffected (they never read the new collections).
2. **No data migration, no backfill** — the feature is greenfield: DMs and groups are created on first use; dept channels lazy-provision on first open (Spec 4 `openDeptChannel`); `_counters` untouched.
3. **Ship the JS in one commit:** new js/chat.js, plus the Spec 6 edits (notifications.js, app.js, config.js, modules.js, index.html, sw.js PRECACHE). `node --check` each edited/created js file; APP_VERSION/CACHE_VER auto-bump via pre-commit hook (verify CACHE_VER moved).
4. **Backup coverage:** `scripts/monthly-backup.js` auto-discovers ROOT collections (`conversations` is covered automatically) but exports subcollections only where special-cased (attendance records, scripts/monthly-backup.js:164) — add a matching `conversations/{id}/messages` subcollection export in the same style, same commit. `readers`/`typing` are ephemeral receipts/beacons: explicitly NOT backed up.
5. **Smoke-test rules in the console before announcing** (Spec 8 items 1-2 as a minimum), since a rules mistake here fails silently into `.catch` branches.
6. **Announce via `Notifs.sendToAll`** ("💬 Team Chat is live — find it in your sidebar") — optional, President's call.

### Spec 8 — Manual test checklist (no automated suite)

1. **Inbox query passes rules:** sign in as an employee → Chat page loads with no console permission errors (the array-contains list + `.get()`-form participants rule is the one provability risk — if `list` is denied, swap the rule's first disjunct to bare `request.auth.uid in resource.data.participants`; safe because every conversation doc writes `participants` explicitly, including `[]` on dept docs).
2. **Partner wall:** as a partner — (a) Chat shows no Channels chip and no dept rows; (b) console `db.collection('conversations').doc('dept_Sales').get()` → DENIED; (c) `db.collection('conversations').where('participants','array-contains', myUid)` → only own DMs/groups; (d) New Message picker lists ONLY same-company partners + president/manager; (e) a DM with the president works both directions, attachments included.
3. **DM dedupe:** A opens a DM with B, sends "hi"; B opens a DM with A → SAME conversation (`dm_` sorted id), no duplicate thread.
4. **Live delivery:** two browsers, same DM open → a message appears on the other screen without any refresh; sender's bubble right-aligned, recipient's left with avatar.
5. **Seen avatars:** B opens the thread → A sees B's mini-avatar under the last message within ~2s (readers listener). B navigates away, A sends again → no fresh "seen" until B reopens.
6. **Typing:** B types → A sees "B is typing…" within ~4s; B stops (no send) → the row clears within ~6-8s; B sends → beacon clears immediately.
7. **Reactions:** B long-taps/clicks A's bubble, picks ❤️ → chip appears live for both; B taps ❤️ again → removed. Console negative test: B `update({['reactions.'+A_uid]:'👍'})` on A's behalf → DENIED (map-diff rule); B editing A's `text` → DENIED; A editing own text → allowed, "(edited)" renders.
8. **Notifications:** B has the thread CLOSED → A's message creates one `chat_message` notif (with `chatId`) for B; bell badge bumps; tapping Open routes into the exact conversation; opening the thread marks that conversation's notifs read. A sends 5 messages in 30s → B gets ONE notif (60s throttle). B has the thread OPEN → no notif at all (fresh-reader suppression). Push arrives on a backgrounded device with **zero functions deploys**.
9. **Dept channel:** a Sales member opens Channels → #Sales lazily creates; a second Sales member sees the same doc (no duplicate); a message notifies Sales members only — verify the president gets NO notif but sees the unread dot on next Chat open; a legacy `department:'Sales'` (string-only) user IS notified.
10. **Group leave:** a non-creator member leaves → allowed (removeAll branch); console attempt to remove SOMEONE ELSE from participants as a plain member → DENIED.
11. **Pagination:** seed >50 messages → thread opens showing the newest 50 with "Load earlier"; loading prepends the older page and preserves the scroll anchor.
12. **Lifecycle/back:** device Back and Esc both close the thread panel (Overlay); navigating to Dashboard mid-thread tears down panel + ALL listeners (verify: no further `onSnapshot` console logging / network frames); returning to Chat re-attaches exactly one inbox listener.
13. **Storage wall:** as any signed-in user, `storage.ref('chat-files/<someConvId>').listAll()` → DENIED (`list:false`); a message's inline image renders for a participant (token URL GET works).
14. **Manila dividers:** messages from yesterday/today straddle a "Yesterday"/"Today" divider correctly against Manila midnight, not UTC (test near 08:00 Manila = UTC midnight).

### Flags for Neil

- **‼️ Notification granularity:** spec throttles to ≥1 notification per conversation per recipient per 60s (not one per message) and suppresses pushes while the recipient is actively reading. If you want raw per-message pushes, delete the two suppression checks in `_notifyRecipients` — one-line change, but expect noisy inboxes.
- **‼️ Partner DM scope:** partners can DM same-company partners + president/manager only. Say the word to widen (e.g. any staff member assigned to their projects) — it's a `dmCandidates()` filter change only; rules already permit any participant set.
- **Group edit powers:** only the group creator or an admin can rename/add members (v1). Member-initiated adds can be granted later by widening one rules branch.

---

*Grounding research below — facts current as of 2026-07-10; verified line numbers may drift after implementation.*

## Current state

Plan text (V12-PLAN.md:214-216, under "### PHASE 4 — Operations & departments"): "37. Team
Chat — Messenger-grade: DMs + named group chats + dept channels; reactions, online presence,
Seen avatars, typing…, inline photos/files; live listeners + push; full page with Back;
participant-scoped rules; partner walled off." V12-PLAN.md's own Build Log (line 1074-1084)
flags Phase 4 (workstreams 28-40, including this one) as having **zero grounding briefs or
DECIDED specs** — this document is the first research pass against the current v12 checkout.

1) THE CLOSEST EXISTING ANALOG IS `window.renderComments` (js/departments.js:1732-1946), a
generic messenger-style thread renderer already used for two parents: `tasks/{taskId}/comments`
(called from `openTaskDetail`, departments.js:848: `renderComments('tasks',taskId,'task-comments-wrap',currentUser)`)
and `submissions/{docId}/comments` (departments.js:1284: `renderComments('submissions', subId,
'sub-comments-wrap', currentUser)`). It renders a `.messenger-wrap`/`.ms-bubble`/`.ms-avatar`
CSS-class UI (bubbles left/right by `authorId===currentUser.uid`, avatar initials or `photoUrl`,
inline image preview for image attachments via `isImage()` regex, a file-chip for non-image
attachments, a "Seen by" line under the last message, edit/delete buttons scoped to the author
(delete also allowed for `isAdmin`)) — this is a strong UI/UX precedent for Team Chat's message
bubble, avatar, and "Seen" requirements.

**CRITICAL CORRECTION to the task's framing — `renderComments` is NOT live/real-time.** It reads
once with `.get()` (departments.js:1740-1741: `db.collection(collection).doc(docId).collection('comments').orderBy('createdAt').get()`),
builds the HTML once, and after every send/edit/delete it manually calls
`renderComments(collection, docId, containerId, currentUser)` again (departments.js:1864, 1873,
1939) to redraw from a fresh `.get()`. **There is no `onSnapshot` anywhere in this feature.**
Confirmed by grepping `onSnapshot` across every `js/*.js` file in the repo: it appears in
exactly **three** places, none of them a multi-party message thread:
`js/app.js:141` (`db.collection('settings').doc('system').onSnapshot(...)`, the president-triggered
force-logout broadcast), `js/app.js:242` (`db.collection('users').doc(uid).onSnapshot(...)`, the
custom-claims-freshness listener), and `js/notifications.js:18` (the notification inbox listener,
detailed below). **So "live listeners" for Team Chat is not an extension of an existing pattern —
it is a genuinely new architecture for this codebase**, with only the single-user notification
inbox listener as a (thin) precedent for listener lifecycle (`unsubscribe()`/`stopListener()`
pattern, notifications.js:8, 12-13, 26).

Read-receipt precedent (**this one DOES generalize well**): `tasks/{taskId}/readers/{readerUid}`
— on every `renderComments('tasks', ...)` call, the current viewer's own reader doc is
upserted (departments.js:1750-1756: `{uid, name, readAt: serverTimestamp()}`, `.set(...,
{merge:true})`), and `getSeenBy(comment)` (departments.js:1759-1763) filters all readers whose
`readAt` is at/after a given comment's `createdAt` and whose `uid` isn't the comment's own
author, to build the "Seen by X, Y" line shown only under the *last* message
(departments.js:1809). This is a per-viewer-writes-their-own-doc pattern (matches
firestore.rules:321-326, `allow write: if isAuth() && isOwner(readerUid)`), not a per-message
read receipt — i.e. today's "Seen" is thread-level ("has this person opened the thread since
this message"), not message-level. `collection === 'tasks'` gates whether readers are even
fetched/written at all (departments.js:1742-1744, 1750) — the `submissions` parent never gets a
readers subcollection, so that codepath has zero Seen-by support today.

Attachments: an uploaded file goes to Storage path `task-comments/${docId}/${Date.now()}_${file.name}`
(departments.js:1892) regardless of which `collection` argument was passed (i.e. a
`submissions`-thread attachment is ALSO physically stored under the literal `task-comments/`
prefix — a naming quirk, not a bug, since the storage rule for that path is collaborative-open
already). A comment can instead carry a pasted link (`fileSource:'link'`) via a `promptDialog`
(departments.js:1843-1852) rather than a file. `storage.rules:139-144` (quoted verbatim): `match
/task-comments/{docId}/{fileName} { allow read: if isSignedIn(); allow write: if isSignedIn() &&
(request.resource == null || isValidDocument()); }` — **any signed-in user, including a
partner, can read or write into this path; there is no `!isPartnerClaim()` exclusion here**,
unlike most department storage folders. `isValidDocument()` (storage.rules:60-62) only checks
size (`<=25MB`), not content-type — so any file type up to 25MB is accepted; images get inline
preview via extension-sniffing on the client (`isImage`, departments.js:1737), not by
`contentType`.

Firestore rules for the two existing comment threads (firestore.rules:279-327, `tasks` block,
quoted verbatim — see also the near-identical `submissions` variant at firestore.rules:523-544):
```
    match /tasks/{taskId} {
      allow read: if isAuth() && (!isPartner() || request.auth.uid in resource.data.get('assignedTo', []));
      allow create: if isAuth() && ( isAdmin() || (isDesignDept() && request.resource.data.get('department', '') == 'Design') );
      allow update: if isAuth() && ( (request.auth.uid in resource.data.assignedTo) || isFinanceOrAdmin() );
      allow delete: if isAuth() && (isAdmin() || resource.data.get('createdBy', '') == request.auth.uid);

      // In-app "messaging" thread on a task. Rules do NOT inherit to
      // subcollections, so this needs explicit coverage...
      function taskAssignee() {
        return request.auth.uid in get(/databases/$(database)/documents/tasks/$(taskId)).data.get('assignedTo', []);
      }
      match /comments/{commentId} {
        allow read:   if isAuth() && (!isPartner() || taskAssignee());
        allow create: if isAuth() && request.resource.data.authorId == request.auth.uid;
        allow update, delete: if isAuth() && ( resource.data.authorId == request.auth.uid || isAdmin() );
      }
      match /readers/{readerUid} {
        allow read:  if isAuth() && (!isPartner() || taskAssignee());
        allow write: if isAuth() && isOwner(readerUid);
      }
    }
```
This is the exact **participant-scoped, partner-conditionally-walled** shape the mandate is
asking for ("partner walled off" + "participant-scoped rules") — a partner may read a
comment/readers subcollection ONLY if they pass the same membership test as the parent
document (`taskAssignee()` re-derives membership by reading the parent doc inside the rule,
because — per this repo's own comment, confirmed again here — **rules do not cascade to
subcollections**; every new collection/subcollection Team Chat introduces needs its own
explicit `match` block, no exceptions).

Sending a task-comment notifies participants via `Notifs.send` in a loop (departments.js:1915-1931):
`involved = new Set([...(task.assignedTo||[]), task.createdBy])`, self-uid removed, each gets
`{title:'💬 New message on "..."', body:'{author}: {preview}', icon:'💬', type:'task_message'}`.
`task_message` is already one of the `NAV_TYPES` the notification panel treats as navigable
(notifications.js:100), routed by `_navigateFromNotif` (notifications.js:67-87) to
`window.openTaskDetail(taskId, ...)` when a `taskId` is present. **This is the one existing,
working example of "a chat message → a push/in-app notification → tapping it opens the
thread"** — Team Chat's message-arrived notification should almost certainly follow this exact
shape (per-participant `Notifs.send` loop with a `type` your `_navigateFromNotif` knows how to
route), not invent a new delivery mechanism.

2) `window.Notifs` (js/notifications.js) IS THE FULLY-BUILT, ALREADY-WORKING in-app + push
infrastructure and should almost certainly be Team Chat's ONLY delivery mechanism — there is no
separate "chat push" system to build. Its public API (returned object, notifications.js:674-682):
`startListener(uid)`, `stopListener()`, `send(targetUid, {title, body, icon, type, link,
dedupKey, taskId})`, `sendToDept(department, notifData, opts)`, `sendToAll(notifData)`,
`sendToOwner(notifData)`, `showToast(message, type)`, `initPush(uid)`,
`checkDeadlines(uid)`, `checkAttendanceReminder(uid, displayName)`, `checkLowStock(uid, role)`,
`initToggle()`, `renderPage()`, `markAllRead()`, `requestPushPermission(uid)`.

- `send()` (notifications.js:252-273) writes one doc to `notifications/{targetUid}/items/{autoId}`:
  `{title, body, icon='🔔', type='general', link=null, read:false, createdAt:serverTimestamp(),
  ...(dedupKey?{dedupKey}:{}), ...(taskId?{taskId}:{})}`, then fires an EmailJS email if
  `window.EMAIL_CONFIG?.ENABLED`. `dedupKey`, if given, is checked via a single-field `.where('dedupKey','==',...)
  .limit(1)` query BEFORE writing (no composite index needed) so a caller can safely re-invoke
  the same "would-be-duplicate" notification (used today for daily reminders/digests) — a
  useful pattern if Team Chat wants to dedupe, e.g., "N unread messages in Group X" digest
  pushes instead of one-per-message spam.
- `sendToDept(department, notifData, opts)` (notifications.js:276-303) queries BOTH the legacy
  singular `users.department` field and the current `users.departments` array-contains, unions
  and dedupes by doc id, then **batch-writes** (499-doc chunks) one notif doc per member — this
  is the exact mechanism a "dept channel" message-arrived notification should reuse (it already
  handles the `department` (string) vs `departments` (array) schema duality that DEPARTMENTS-keyed
  screens must handle everywhere in this codebase). It supports `opts.fallbackToOwner` to route to
  the president if a dept has zero members — worth considering for an empty/orphaned channel.
- `sendToAll(notifData)` / `sendToOwner(notifData)` are the same batched-write pattern for "every
  user" / "president+owner-role only" broadcasts.
- **`link` is accepted by `send()` and written onto the notif doc, but it is DEAD — never read.**
  Grepped every use of `n.link`/`.link` in notifications.js and app.js: zero. `_navigateFromNotif(type,
  taskId)` (notifications.js:67-87) dispatches purely on the `type` string (and a raw `taskId`
  field) via a big if/else chain to `navigateTo(...)` calls — it has NO generic "follow this
  `link` URL/route" fallback. **Team Chat cannot rely on passing `link:'chat:{conversationId}'`
  and expecting it to navigate anywhere — `_navigateFromNotif` would need a new branch added
  for whatever `type` values chat messages use, exactly the same way `task_message`/`att_*`/`memo`/
  `post`/`payroll` etc. each got their own explicit branch.**
- `startListener(uid)` (notifications.js:12-24) is the ONE onSnapshot-based live listener in the
  whole notification system: `db.collection('notifications').doc(uid).collection('items')
  .orderBy('createdAt','desc').limit(30).onSnapshot(snap => { ...updateBadge...renderPanel... })`
  — capped at the 30 most recent notification docs, single-user-scoped (each user only listens to
  their OWN inbox). This is a reasonable low-risk pattern to imitate for something like "my
  unread-message badge count," but it is NOT a precedent for listening to a shared/multi-party
  document (a group chat's message list would be a many-readers-one-stream listener, structurally
  different from one-user-one-stream).
- Push (FCM): `initPush(uid)` lazy-loads `firebase-messaging-compat.js` only on demand, shows a
  custom in-app permission-prompt UI (`_showPushPrompt`, notifications.js:378-451) rather than the
  raw browser dialog, and on grant calls `_registerPush` (notifications.js:453-500) which writes
  `users/{uid}.fcmToken` and wires `messaging.onMessage(...)` to `showToast(...)` for
  foreground pushes. The actual OS-level push delivery is server-side: `functions/index.js`'s
  single `sendPushOnNotification` trigger (per CLAUDE.md) fires on ANY new
  `notifications/{uid}/items/{itemId}` doc and sends the FCM web-push using that user's
  `fcmToken`, pruning invalid tokens. **This means Team Chat gets push-notification delivery for
  FREE the instant it writes through `Notifs.send`/`sendToDept` — no new Cloud Function, no new
  FCM wiring, is needed**, so long as messages are delivered via this existing per-user
  subcollection rather than a bespoke chat-specific notification path the Cloud Function doesn't
  know about.
- `showToast(message, type)` is the generic toast (bottom-center, 3.5s auto-dismiss,
  success/error/info color variants) used throughout the app for ephemeral feedback
  (`Notifs.showToast(...)` is called from dozens of sites, e.g. departments.js:1898, 1931 in
  `renderComments` itself) — the natural choice for any "message sent"/"upload failed" feedback in
  Team Chat's own composer, exactly as `renderComments`'s send handler already does.

3) PRESENCE HEARTBEAT — `startPresenceHeartbeat(uid)` (js/app.js:117-133, quoted verbatim):
```js
let _presenceInterval = null;
let _presenceVisHandler = null;
function startPresenceHeartbeat(uid) {
  if (_presenceInterval) clearInterval(_presenceInterval);
  if (_presenceVisHandler) { document.removeEventListener('visibilitychange', _presenceVisHandler); window.removeEventListener('focus', _presenceVisHandler); }
  let _lastPing = 0;
  const ping = () => {
    _lastPing = Date.now();
    db.collection('users').doc(uid).update({ lastSeen: firebase.firestore.FieldValue.serverTimestamp() }).catch(()=>{});
  };
  ping();
  _presenceVisHandler = () => { if (document.visibilityState === 'visible' && Date.now() - _lastPing > 15000) ping(); };
  document.addEventListener('visibilitychange', _presenceVisHandler);
  window.addEventListener('focus', _presenceVisHandler);
  _presenceInterval = setInterval(() => { if (document.visibilityState === 'visible') ping(); }, 60000);
}
```
Called once per sign-in at app.js:90 (`startPresenceHeartbeat(user.uid)`, inside the
`auth.onAuthStateChanged` bootstrap). It writes ONLY `users/{uid}.lastSeen` (a server
timestamp) — no "online"/"away"/"offline" enum field exists, presence is entirely derived
client-side from how stale `lastSeen` is. Per this session's own WS16 (perf) audit
(fable-workplan/16-perf.md:127, decision **D10**, quoted verbatim): *"Presence heartbeat: no
change (already throttled). Why: startPresenceHeartbeat (app.js:111-127) already pings only
every 60s and only while `document.visibilityState==='visible'`, with a 15s-debounced
visibility/focus ping. That is already a conservative write rate. Optional future bump to 90s
is noted but not worth a code change this pass."* (Line numbers have since shifted slightly to
117-133 on the current checkout, content identical.) **Team Chat should read this SAME
`users/{uid}.lastSeen` field for its "online presence" requirement — it must NOT introduce a
second, competing heartbeat/presence-write mechanism.**

The one existing UI consumer of this field, `renderTeam()`'s presence dots
(js/app.js:6800-6814, logic reproduced with only the two `hrs`/`days` declarations joined onto
one line for brevity — everything else verbatim):
```js
const snap = await dbCachedGet('users-presence', fetchUsersWithPayroll, 8000);
...
const onlineThresholdMs = 3 * 60 * 1000;   // 3 min = online (green)
const recentThresholdMs = 30 * 60 * 1000;  // 30 min = recently active (orange, "Xm ago")
function getPresence(u) {
  const ls = u.lastSeen?.toDate ? u.lastSeen.toDate() : null;
  if (!ls) return { dot: 'gray', label: 'Unknown' };
  const diff = now - ls.getTime();
  if (diff < onlineThresholdMs) return { dot: 'green', label: 'Online' };
  if (diff < recentThresholdMs) return { dot: 'orange', label: Math.floor(diff/60000)+'m ago' };
  const hrs = Math.floor(diff/3600000); const days = Math.floor(diff/86400000);
  return { dot: 'gray', label: days>0?days+'d ago':hrs+'h ago' };
}
```
The `'users-presence'` `dbCachedGet` key is DELIBERATELY separate from the shared `'users'`
cache key, with an explicit short TTL of **8000ms** (app.js:6795-6798 comment: *"Short TTL here
so the online/offline presence dots reflect 'now', not a stale snapshot left by another
screen... Must use the payroll-aware fetcher..."*), and WS16's audit (fable-workplan/16-perf.md:57-58,
123) independently confirmed this is intentional and should stay separate, and that it IS
correctly invalidated alongside `'users'`/`'users-payroll'` at every user-edit call site
(app.js:6893, 7022, 7084 in the current checkout). **This 8-second-TTL cached-poll model (not
`onSnapshot`) is how "presence" is read today — a Team Chat "online" dot next to a DM
recipient's name could reuse this exact `getPresence()`-style bucket logic and either poll the
same way or (if a true live green-dot is wanted) open a light `onSnapshot` on that one user's
doc, which is new territory (see Risks).**

4) CONFIRMED GENUINELY GREENFIELD FOR THE MESSAGING DATA MODEL ITSELF. Grepped `chat`, `Chat`,
`messages` across `firestore.rules` and `storage.rules`: the only hit is a code COMMENT at
firestore.rules:305 ("...so their messages are too" — referring to the tasks/comments
subcollection, not a chat feature). Grepped `reaction`/`Reaction`/`typing`/`Typing`/emoji-react
patterns across every `js/*.js` file: zero feature hits (the only "typing" hits are unrelated —
a keyboard-shortcut helper checking `isTextInputFocused()` at app.js:7554/7558). **No
reactions, no typing indicators, no message-reaction data shape, and no chat/conversation/DM
collection of any kind exists anywhere in this codebase today** — this part of the workstream is
100% new architecture, not a migration or extension.

5) "PARTNER WALLED OFF" — `isPartner()` exists on BOTH sides already and is the established
gating primitive to reuse, not reinvent:
- **Firestore rules** (firestore.rules:29): `function isPartner() { return getRole() ==
  'partner'; }`. It is used as `!isPartner()` (deny partner, allow everyone else) on roughly
  30 collections throughout the file (dashboards, tasks, submissions, sales/design clients,
  files_*/budgets_* wildcard families, etc. — grepped, too many to list individually), and as
  the conditional-participant shape `!isPartner() || <membership check>` specifically on the
  `tasks`/`tasks/comments`/`tasks/readers` blocks quoted above — **this conditional shape is the
  exact pattern to copy for Team Chat's participant-scoped rules** (a partner should be able to
  read/write a DM or group chat they're genuinely a participant in, but not enumerate/read
  everyone else's).
- **Client-side** (js/app.js): `function isPartner() { return currentRole === 'partner'; }`
  (app.js:901), plus the finer-grained `isBrilliantPartner()` (app.js:906, `isPartner() &&
  currentDepts.includes('Brilliant Steel')`) and `isGenericPartner()` (app.js:907, `isPartner()
  && !currentDepts.includes('Brilliant Steel')`) — the codebase already distinguishes the
  Brilliant Steel partner (deep CRM/quote-builder integration) from any other "generic partner"
  company (per the generic-partner-portal memory). Any Team Chat entry point/nav gating should
  reuse these exact functions, not re-derive `currentRole==='partner'` inline.
- **Existing UI precedent for a partner-scoped audience list**: `window.renderTeamTab`'s
  directory (js/modules.js:348-386) already filters its user list by partner-ness —
  `viewingAsPartner = isPartner()` (modules.js:351), then (modules.js:372-376): *"if
  (viewingAsPartner) { // Partners only see other partners; return u.role === 'partner'; }
  // Admin/employees see the full team (including partners) // Hide Brilliant Steel-only staff"*
  — i.e. a partner's "who can I talk to" list is ALREADY narrowed to other partners only, while
  internal staff see everyone including partners (minus a Brilliant-Steel-only-staff filter for
  internal viewers). **This is the closest existing precedent for who a partner's DM-recipient
  picker / dept-channel-membership list should include, and Fable should decide whether Team
  Chat's audience-narrowing mirrors this exact filter or is intentionally stricter (e.g., a
  partner may only DM staff explicitly assigned to their account, similar to the
  `tasks.assignedTo` narrowing).**

6) "FULL PAGE WITH BACK" — there are actually **two** distinct, both-real, both-Overlay-integrated
patterns in this codebase, and Fable must pick (or explicitly reconcile) between them, not
assume there's only one:

**(a) `window.openPage(title, bodyHTML, footerHTML='', opts)`** (js/app.js:7387-7408, quoted
verbatim):
```js
window.openPage = function(title, bodyHTML, footerHTML='', opts){
  opts = opts || {};
  document.getElementById('page-panel')?.remove();
  const p = document.createElement('div');
  p.id = 'page-panel'; p.className = 'page-panel overlay-active';
  p.innerHTML = `
    <div class="page-panel-head">
      <button class="page-panel-back" aria-label="Back"><i data-lucide="arrow-left"></i></button>
      <h3 class="page-panel-title"></h3><div style="width:40px"></div>
    </div>
    <div class="page-panel-body"></div>
    <div class="page-panel-foot"></div>`;
  p.querySelector('.page-panel-title').textContent = title;
  p.querySelector('.page-panel-body').innerHTML = bodyHTML;
  const foot = p.querySelector('.page-panel-foot');
  foot.innerHTML = footerHTML; foot.classList.toggle('hidden', !footerHTML);
  document.body.appendChild(p);
  p.querySelector('.page-panel-back').addEventListener('click', () => window.Overlay.dismissTop());
  window.lucide?.createIcons();
  requestAnimationFrame(() => p.classList.add('open'));
  window.Overlay.push('page', () => { p.classList.remove('open'); setTimeout(()=>p.remove(), 300); });
};
```
This is a generic **title + static bodyHTML string + optional footerHTML** container — every
existing caller (grepped 13 call sites, e.g. app.js:4173 "Edit SOP", 4373 "Grade: {name}", 4744
"Self-Assessment — {month}", 6854 "Add Employee Profile", 6918 "Create Worker Account", 7045
"Edit: {name}") passes a ONE-SHOT rendered HTML string for a form/detail view — none of them
re-render their body in place after the initial call the way a live chat thread would need to
(new incoming messages, typing indicator, read receipts all changing after the panel is
already open). `openPage`'s signature has no notion of "this body updates itself" — a caller
would have to manually reach back into `#page-panel .page-panel-body` DOM to patch it, which
no existing caller does today.

**(b) The custom `task-fullscreen-panel` used by `openTaskDetail`** (js/departments.js:703-852)
is structurally a much closer analog to a live chat screen: it hand-builds its own fixed-position
panel (departments.js:727-740, `position:fixed; z-index:4000`, its own slide-up
transform/opacity transition), with a **top bar containing an explicit Back chevron button**
(departments.js:745: `<button id="task-panel-back">‹</button>`), a **scrollable info section that
occupies a bounded max-height (42%)**, and — critically — **a nested live-updating child region**:
`<div id="task-comments-wrap" style="height:100%;...">` (departments.js:832) which is populated
AFTER the panel is mounted via a separate call, `renderComments('tasks',taskId,'task-comments-wrap',currentUser)`
(departments.js:848), and which THAT function re-renders in place on every send/edit/delete
(again: via a fresh `.get()` + full re-render, not `onSnapshot`). The panel registers itself with
the Overlay stack exactly like `openPage` does — `window.Overlay.push('task', () =>
window.closeTaskPanel())` (departments.js:846) — and its dedicated Back button calls
`window.Overlay.dismissTop()` (departments.js:850), same as `openPage`'s. `closeTaskPanel()`
(departments.js:693-699) just slides the panel out and removes it after 320ms. **This hand-rolled
panel — not `openPage()` — is the pattern actually built for "a full page with Back that hosts a
live-feeling message thread inside it," and is the more honest template for Team Chat's main
conversation-view screen; `openPage()` is the better fit for secondary/one-shot screens (e.g. a
"New Group Chat" creation form, "Add Members" picker).**

Both patterns push through the SAME shared history-backed stack, `window.Overlay`
(js/config.js:521-548, quoted verbatim):
```js
window.Overlay = {
  _stack: [], _seq: 0, _closing: false,
  isOpen(){ return this._stack.length > 0; },
  push(kind, teardown){
    const id = ++this._seq;
    this._stack.push({ id, kind, teardown });
    const base = { page: window.currentPage || 'dashboard', subtab: window.currentSubtab || null };
    try { history.pushState({ t:'overlay', kind, oid:id, base, d:(window._navDepth||0) }, '', location.hash); } catch(_){}
    return id;
  },
  dismissTop(){ if (this._stack.length) history.back(); },   // → popstate → _popOne
  _popOne(){ const top = this._stack.pop(); if (!top) return; this._closing = true; try { top.teardown(); } catch(_){} this._closing = false; },
  clearAll(){ ... }   // tears down every entry + history.go(-n)
};
```
Every push is one real `history.pushState` entry; `Overlay.dismissTop()` universally calls
`history.back()` (never removes from `_stack` directly) so the single global `popstate` listener
(js/app.js:7417-7424) is the ONLY teardown trigger for ANY dismissable surface — this is also
what makes the device/browser Back button (and Escape, wired through the same `closeTopOverlay()`
helper at app.js:7475-7476) close a Team Chat panel exactly like it closes a task detail panel or
a modal, with zero extra plumbing, AS LONG AS Team Chat's panel calls `window.Overlay.push(kind,
teardown)` on open and routes its own Back button through `window.Overlay.dismissTop()` — not a
bespoke `history.back()`/`popstate` handler of its own.

## Data model

`notifications/{uid}/items/{autoId}` (existing, top-level per-user subcollection; Team Chat's
message-arrived alerts should write here via `Notifs.send`/`sendToDept`, not a new collection):
`title, body, icon (default '🔔'), type (default 'general'), link (accepted, WRITTEN, NEVER READ
— see Current State §2), read: bool, createdAt: serverTimestamp, dedupKey?: string, taskId?:
string`. Rules not directly re-derived here (out of this brief's grep scope) but behaviorally
each user only ever queries their own `uid` subpath, matching the owner-scoped pattern used
throughout this repo.

`tasks/{taskId}/comments/{commentId}` (existing, the message-shape precedent): `text: string
(may be ''), authorId: string (uid), authorName: string, fileUrl: string|null, fileName:
string|null, fileSource: 'link'|null (null = uploaded file, not a pasted link), createdAt:
serverTimestamp, editedAt?: serverTimestamp (set only on edit)`. Rules (firestore.rules:313-319):
read gated `!isPartner() || taskAssignee()`; create requires `authorId == request.auth.uid`
(anyone who can read can post, no separate participant-write check on create — relies on the
parent `read` gate already having been passed by the client); update/delete gated to the author
or `isAdmin()`.

`tasks/{taskId}/readers/{readerUid}` (existing, the Seen-by precedent): `uid: string, name:
string, readAt: serverTimestamp`. Rules (firestore.rules:321-326): read same `!isPartner() ||
taskAssignee()` gate; write is strictly `isOwner(readerUid)` — nobody may write another user's
read-receipt doc, including admins.

`users/{uid}` (existing, relevant fields only): `lastSeen: serverTimestamp (written every ≤60s
while foregrounded, by startPresenceHeartbeat)`, `role: one of ROLES keys` (`president`,
`manager`, `secretary`, `employee`, `agent`, `finance`, `partner` — js/config.js:207-215),
`department: string (legacy)` / `departments: string[] (current)`, `displayName`, `photoUrl`,
`email`, `fcmToken` (written by `_registerPush`). `window.DEPARTMENTS` (js/config.js:124-175) is
the authoritative department-key list a "dept channel" feature would iterate/gate against:
`Admin, Finance, HR, Sales, Marketing, Government Biddings, IT, Design, Production, Purchasing,
Brilliant Steel (isSeparate:true), Partners (isPartnerDept:true)` — 12 keys total, each with an
`icon`/`lucideIcon`/`color`/`subtabs`/`navOrder`. Note `Brilliant Steel` and `Partners` are
flagged specially (`isSeparate`, `isPartnerDept`) — a "dept channel per department" design must
decide whether these two get channels too and, if so, how their existing partner-vs-internal
membership split (per `isGenericPartner`/`isBrilliantPartner`) maps onto channel membership.

Storage precedent paths (existing): `task-comments/{docId}/{Date.now()}_{filename}` (any
signed-in user, no partner exclusion, `isValidDocument()` size-only check ≤25MB — see storage.rules:139-144)
and `profile-photos/{uid}` (owner-scoped, `isValidImage()` ≤15MB, storage.rules:110-124). A new
chat-attachments path should NOT reuse `task-comments/` verbatim (that block has no partner
wall) — it needs its own `match` block with an explicit participant/partner check analogous to
`worker-id-photos/{profileId}` (storage.rules ~118-127, `isFinanceClaim()`-gated) or a
role/claim-based exclusion consistent with whatever Firestore participant model Team Chat picks
(custom claims cannot read Firestore, so a Storage rule can only check `request.auth.token.role`/
`.departments`, NOT an arbitrary chat's participant list — see Constraints).

Cache-key precedent (`window.dbCachedGet`/`dbCacheInvalidate`, js/config.js:350-370, ~379+):
generic `key → {data, ts, pending}` in-memory store with per-call TTL (default 30000ms); the
`'users'` key is hard-coded to always use the payroll-merged fetcher regardless of caller
(config.js:354-356) — a gotcha if Team Chat ever calls `dbCachedGet('users', ...)` expecting a
lighter-weight fetch, it will silently get the heavier payroll-joined one. `'users-presence'`
(8000ms TTL) is the existing precedent for "read presence-ish data with a short, deliberate TTL"
(see Current State §3).

`_counters/{docId}` (existing, e.g. `_counters/employees`) is the established atomic-transaction
ID-minting precedent (`db.runTransaction`, read-increment-write) — cited here only as a pattern
Fable could reuse IF Team Chat wants human-friendly deterministic doc IDs (e.g. a DM keyed by
sorted-uid-pair rather than an autoID) — Firestore auto-IDs remain the simpler default for
message docs themselves.

## Constraints — must respect

- **No `onSnapshot` precedent exists for a multi-party/shared document stream** — the only three
  live listeners in the codebase (`settings/system`, `users/{uid}` claims, one user's own
  `notifications/{uid}/items`) are all single-document or single-user-scoped. Introducing
  `onSnapshot` on a chat's message subcollection (potentially read by N participants
  simultaneously) is new listener-cost territory this codebase has never exercised — WS16's perf
  audit (fable-workplan/16-perf.md) exists specifically because ad hoc re-fetch patterns already
  caused staleness/cost problems with the TTL-cache model; a poorly-scoped `onSnapshot` (e.g. no
  `.limit()`, no pagination) risks a worse version of the same class of problem, at higher
  ongoing cost (a live listener bills reads continuously, unlike a TTL-cache).
- **Firestore rules do not cascade to subcollections and do not match by prefix** (confirmed
  again here, per the repo-wide `firestore-rules-collection-coverage` memory and this brief's own
  grep): every new collection AND subcollection (a chat's messages, its readers, its
  reactions if modeled as a subcollection, a `chats`/`conversations` parent doc, a
  `dept_channels` collection, etc.) needs its own explicit `match` block or it silently denies
  (blank screen unless the client wraps the read in `.catch()`, the pattern used everywhere in
  this repo, e.g. `.catch(()=>({docs:[]}))`). There IS a documented wildcard-by-name-prefix
  workaround already in use at the tail of firestore.rules (`match /{coll}/{docId} { ... if
  coll.matches('files_.*') ... }` and `'budgets_.*'`) for genuinely dynamic, runtime-named
  collections — relevant only if Team Chat's design mints one Firestore collection per
  department/group (e.g. `chat_<deptname>`) rather than a single `chats` collection with a `type`/
  `department` field; otherwise prefer one well-known collection name with explicit rules, which
  is simpler to reason about and matches how `tasks`/`submissions` are modeled today.
- **Rules must read fields via `.get(field, default)`, never bare access** — a missing field
  throws and DENIES the whole rule (confirmed by this repo's own `getRole()` helper comment,
  firestore.rules:9-14, and the dedicated `firestore-rules-missing-field-throws` memory). Any
  participant-list check on a new chat doc (e.g. `resource.data.get('participants', [])`) must
  follow this defensively, especially since early/legacy chat docs may be missing fields as the
  schema evolves.
- **escHtml() discipline** — every existing message-thread renderer (`renderComments`) and
  every other messaging-adjacent surface (`renderTeamTab`, `renderIDCard`, etc.) escapes all
  user-controlled text before `innerHTML` interpolation (`escHtml`, defined js/modules.js:9-13,
  aliased defensively in several other files via `window.escHtml||...` fallbacks). `safeHttpUrl()`
  (js/modules.js:18-24) is the matching allow-list guard `renderComments` already applies to
  attachment/link URLs before using them as an `href`/`src` or `window.open` target — reuse both
  for message text and any pasted-link attachments in Team Chat, exactly as `renderComments`
  already does (departments.js:1795, 1797-1798).
- **Manila-time discipline** — any "last seen Xm/Xh/Xd ago" or "sent at HH:MM" formatting must
  key off `window.bizDate()/bizHour()/bizDow()` where day-boundary logic matters (per the
  `manila-time-helpers` memory); the existing `getPresence()` and `renderComments`'s
  `timeLabel()` (departments.js:1766-1773) both currently do raw `new Date()`/`toLocaleTimeString('en-PH',...)`
  arithmetic on elapsed milliseconds (timezone-agnostic, since they're diffing two absolute
  instants, not deriving a calendar day) — safe as-is, but any NEW logic that buckets by calendar
  day (e.g. "Today" / "Yesterday" date dividers in a chat thread, which Messenger-style UIs
  typically have and which neither `renderComments` nor anything else in this codebase currently
  implements) must go through `bizDate()`, not a raw UTC date compare.
- **Script load order is fixed and load-bearing** (index.html: firebase-config.js →
  config.js → qrcode.js → statutory-tables.js → letterhead.js → drive.js → notifications.js →
  departments.js → app.js → modules.js, all `defer`, all `window.*` globals, no ES modules per
  CLAUDE.md). `window.Overlay`/`chipTabs`/`dbCachedGet`/`escHtml` all live in files that load
  before `app.js`/`departments.js`/`modules.js` need them; a new Team Chat file (if one is
  created) must be positioned correctly in BOTH `index.html`'s script list and `sw.js`'s
  `PRECACHE` array, and must not call a `window.*` helper defined in a file that loads AFTER it.
- **CACHE_VER must be bumped** (`sw.js:11`, currently `'bi-ops-v173'`) on every JS/CSS edit —
  confirmed still a required manual step per CLAUDE.md's workflow rule (the pre-commit hook only
  auto-bumps `window.APP_VERSION`/the `vX.Y.Z` strings in index.html, not `CACHE_VER`).
- **Storage rules' `isReservedTop(seg)` exclusion list** (storage.rules ~104-108) enumerates
  top-level path segments handled by their own dedicated rule blocks so the broad
  `{department}/{subfolder}` catch-all doesn't accidentally loosen them (currently: `Finance,
  tasks, posts, general, General, profile-photos, task-comments`). If Team Chat introduces a new
  top-level Storage path for chat attachments (e.g. `chat-files/{conversationId}/{file}`), that
  segment name must be ADDED to `isReservedTop` or the generic department-folder rule may
  unexpectedly union-permit access to it (Firebase Storage/Firestore rules OR overlapping
  matches together — a documented gotcha this file already calls out for exactly this reason).
- **Storage rules cannot read Firestore** — they only see custom claims minted onto the Auth
  token by the `syncUserClaims` Cloud Function (`request.auth.token.role`/`.departments`, per
  `storage.rules`'s own header comment and the `storage-custom-claims` memory). This means a
  Storage rule CANNOT check "is this uid a participant in chat doc X" the way a Firestore rule
  can (`get(/databases/.../documents/chats/$(chatId)).data.get('participants',[])` — Storage
  rules have no `get()` cross-service read). Any per-conversation attachment access control
  therefore either (a) relies on unguessable path segments (an "if you have the download URL you
  can see it" model, like `order_tracking`'s public-token pattern) plus a broad
  role/department-claim gate, or (b) is enforced only at the Firestore-message-doc level (the
  attachment URL is just a string field on a Firestore-gated message doc; Storage itself stays
  broadly `isSignedIn()`-readable, same posture as `task-comments/` today) — Fable must pick
  one explicitly, since "true per-conversation Storage-level access control" is not achievable
  with the claims this repo currently mints.
- **`Notifs.send`'s `link` field is accepted but dead** (see Current State §2) — routing a
  chat-message notification to the right open conversation requires adding a new branch to
  `_navigateFromNotif` (notifications.js:67-87) keyed on a new `type` (and probably a new field
  analogous to `taskId`, e.g. `chatId`), not just passing `link`.
- **`sendToDept` already resolves the `department` (string) vs `departments` (array) duality** —
  any dept-channel notification fan-out must query both the same way, or department members on
  the legacy singular field will silently miss channel notifications.
- **CACHE_VER/PRECACHE + rules deploy are separate deploy steps from `git push`** — `git push
  origin master` auto-deploys the static frontend via GitHub Pages, but `firestore.rules`/
  `storage.rules` changes require `firebase deploy --only firestore:rules` /
  `--only storage:rules` run separately (per CLAUDE.md and the `firebase-deploy-rules` memory);
  re-`git diff` immediately before any full-file rules deploy since this repo is edited by
  concurrent sessions (per the `deploy-recheck-full-file-diff` memory).

## Risks / cross-workstream interactions

- ⚠️ **This is the first feature in the codebase requiring a genuinely live, multi-reader
  document stream.** Every existing "real-time-ish" UI (`renderComments`, the Team presence
  dots, Analytics) is actually a TTL-cached or fetch-then-manually-re-render pattern; only the
  single-user notification inbox uses `onSnapshot`. Fable's spec needs to explicitly decide (and
  Sonnet needs explicit instructions for) listener lifecycle: where listeners are created,
  where/when they're torn down (on `Overlay` teardown callback, matching the existing
  `stopListener()` pattern in notifications.js), and how many concurrent listeners a single
  session may reasonably hold open (one per open conversation? one per visible channel in a
  sidebar list? all of this is undecided territory with zero in-repo precedent to fall back on).
- ⚠️ **`renderComments` cannot simply be "extended" — it would need to be forked or
  substantially rewritten.** Its current model (fetch-once, mutate, full-container re-render) is
  fundamentally the OPPOSITE of "live listeners." Reusing its markup/CSS classes
  (`.messenger-wrap`/`.ms-bubble`/etc.) and its attachment/link/edit/delete UX is low-risk and
  recommended; reusing its data-fetch mechanism as "the real-time layer" is not — Fable should
  decide whether Team Chat forks a new renderer or whether `renderComments` itself is refactored
  to accept a live-listener data source (which would also silently upgrade task-comments/
  submissions-comments to live updates, a behavior change outside this workstream's stated scope
  unless deliberately chosen).
- ⚠️ **Cross-workstream collision with 38 (Files Hub, "Drive-style" file browser riding Storage +
  the nightly Drive mirror):** both workstreams introduce/extend inline file-attachment UX. If
  38 lands a generalized attachment/share mechanism, Team Chat's own attachment path (whichever
  Storage prefix Fable picks) should be checked against 38's scheme to avoid two divergent
  "attach a file to X" implementations, mirroring the exact "two sources of truth" problem this
  repo already has elsewhere per the `finance-reporting-open-items` memory.
- ⚠️ **Presence granularity is coarse (60s heartbeat, 3-minute "online" bucket) — not fine enough
  for a typing indicator.** `startPresenceHeartbeat` intentionally throttles to protect write
  costs (WS16 D10 explicitly declined to tighten it). A "typing…" indicator implies sub-second-
  latency, per-conversation, per-user ephemeral state — structurally a different (and much
  higher-frequency) write pattern than the presence heartbeat, and reusing `lastSeen`/the
  `users-presence` cache for it would not work. Fable must design a separate, deliberately
  short-lived, low-cost typing-state mechanism (e.g. a debounced write to a small
  `chats/{id}/typing/{uid}` doc with a TTL-like client-side expiry) rather than bolting it onto
  the existing presence write path.
- ⚠️ **`task-comments` Storage path has NO partner exclusion today** — if Team Chat's
  implementation is tempted to reuse that exact Storage match block for chat attachments (since
  the path names are superficially similar), it would directly violate the "partner walled off"
  requirement; a new, explicitly-gated Storage block is required (see Constraints).
- ⚠️ **No pagination anywhere in the existing comment-thread precedent** — `renderComments`'s
  fetch is `orderBy('createdAt').get()` with no `.limit()`, unlike the notification listener's
  explicit `.limit(30)`. A long-lived group chat or department channel with months of history
  would load its entire message history on every open under this pattern — Fable's spec should
  decide on a bounded/paginated read strategy for Team Chat rather than copying the unbounded
  task-comments query verbatim.
- ⚠️ **Reactions and typing indicators are 100% new schema/UX — no fallback pattern to fall back
  on if under-specified.** Unlike presence (has `lastSeen` to build on) or push (has `Notifs` to
  route through) or Seen-avatars (has the `readers` subcollection to extend), "reactions" and
  "typing…" have zero existing data shape or UI anywhere in this codebase (confirmed by grep —
  see Current State §4); Fable's spec must invent both from scratch, which raises the
  implementation risk/ambiguity for these two sub-features specifically relative to the rest of
  the mandate.
- ⚠️ **Dept-channel membership model is unresolved by precedent.** `DEPARTMENTS` users can belong
  to multiple departments (`departments: string[]`), and role-based dashboards already do
  ad hoc, per-screen membership checks (`canEditDept(dept)`, `isMemberOf`-equivalents scattered
  across departments.js) rather than a single canonical "who is in department X" function. A
  dept-channel's participant list (and its Firestore-rule membership check) needs one canonical
  definition Fable specifies explicitly — copying the WRONG existing ad hoc membership check
  (there are several slightly different ones in this codebase, per the general pattern already
  flagged in other workstreams' briefs for similarly-scattered logic) would under- or
  over-expose a channel.
- ⚠️ **`Brilliant Steel` and `Partners` are structurally special departments** (`isSeparate:true`,
  `isPartnerDept:true` respectively) whose membership already forks along the
  `isBrilliantPartner()`/`isGenericPartner()` line (per the `generic-partner-portal` memory). A
  naive "one channel per DEPARTMENTS key" implementation would need explicit handling for these
  two, since a generic (non-Brilliant-Steel) partner and a Brilliant Steel partner already see
  meaningfully different portals elsewhere in the app — an undifferentiated "Partners" channel
  could leak one partner company's chat to another partner company's users if membership isn't
  scoped per-partner-company, not just per-role.

## Files likely touched

`js/departments.js — window.renderComments (1732-1946, UI/UX precedent to fork or extend for
message bubbles/attachments/edit-delete), openTaskDetail's task-fullscreen-panel (703-852) and
closeTaskPanel (693-700) as the full-page-with-Back precedent, storage upload call site pattern
(~1888-1901)`, `js/app.js — startPresenceHeartbeat (117-133, DO NOT duplicate — read
users/{uid}.lastSeen instead), renderTeam's getPresence()/users-presence cache usage
(~6795-6814) as the presence-bucket UI precedent, window.Overlay-integrated openPage (7387-7408)
and the Overlay stack itself if reused directly from config.js, isPartner/isGenericPartner/
isBrilliantPartner (901, 906-907), getSidebarItems/buildSidebarNav/buildBottomNav (914, 1016,
1041) and the navigateTo switch (1950+, ~2020 area) for wiring a new nav entry/page key,
popstate/hashchange wiring (7417-7429) that any new page key must be compatible with`,
`js/notifications.js — window.Notifs (whole file, 1-689): send/sendToDept/sendToAll/sendToOwner
as the ONLY push/in-app delivery mechanism Team Chat should use; _navigateFromNotif (67-87)
needs a new branch for chat-message notification types; startListener (12-24) as the one
onSnapshot lifecycle precedent`, `js/config.js — window.Overlay (521-548), dbCachedGet/
dbCacheInvalidate (350-380+), chipTabs/bindChipTabs (491, 510) if a DMs/Groups/Channels sub-tab
UI is used, window.DEPARTMENTS (124-175) and window.ROLES (207-215) for channel/audience
scoping, escHtml usages/fallback pattern`, `js/modules.js — escHtml (9-13) and safeHttpUrl
(18-24) canonical definitions, window.renderTeamTab (348-386) as the partner-scoped
audience-list precedent (and possible DM-launch entry point)`, `firestore.rules — new
collection(s) for conversations/messages/participants/readers/reactions/typing (none exist
today; needs entirely new match blocks, likely modeled closely on the tasks/{taskId}/comments +
readers pattern at 279-327), users/{uid} (102+, unchanged — lastSeen already writable by the
owner via the existing update rule, confirm this covers the presence heartbeat's own write
path), the tail-of-file dynamic-collection wildcard section if a per-department-collection
naming scheme is chosen instead of one shared collection`, `storage.rules — new match block(s)
for chat attachments (must NOT reuse the partner-open task-comments/ block as-is; must be added
to isReservedTop if given a new top-level segment name)`, `functions/index.js — likely
UNCHANGED (sendPushOnNotification already fires generically on any new
notifications/{uid}/items doc; confirm no chat-specific server-side logic, e.g. group fan-out
beyond what sendToDept/a manual per-participant loop can already do client-side, is actually
needed before adding a new trigger)`, `sw.js — CACHE_VER bump (currently bi-ops-v173) on any
JS/CSS edit; PRECACHE array update if a new js file is introduced`, `index.html — script tag
insertion if a new dedicated chat.js file is created, respecting the fixed load order`.

## Expected deliverable format

> A numbered build spec Sonnet can execute without further judgment calls, covering at minimum:
> one, the resolved data model — exact collection/subcollection names and field-by-field shapes
> for conversations (DM/group/dept-channel, however unified or split), messages, participants/
> membership, read-receipts, reactions, and typing-state, each annotated with type and whether
> it's required/optional, in the same annotated-literal style as this brief's sibling documents.
> Two, the exact `firestore.rules` diff (new match blocks, before/after where any existing block
> such as `users/{uid}` needs touching) using the SAME `!isPartner() || <membership-check
> function>` shape already proven at `tasks/comments`/`tasks/readers`, plus the exact
> `storage.rules` diff for attachments (including any `isReservedTop` update) — both stated
> explicitly as needing separate `firebase deploy --only firestore:rules` / `--only
> storage:rules` runs per repo convention. Three, an explicit decision + code sketch for the
> live-delivery mechanism (which reads become `onSnapshot`, with what `.limit()`/pagination
> bound, and how/where each listener is torn down via the `Overlay` teardown callback) — since,
> per this brief, there is no existing multi-party live-listener precedent to silently inherit.
> Four, the exact wiring into `Notifs.send`/`sendToDept` for message-arrived notifications
> (including the new `type` value(s) and the corresponding new branch needed in
> `_navigateFromNotif`), explicitly confirming push delivery rides the existing
> `sendPushOnNotification` Cloud Function with no server-side changes. Five, the exact
> presence-read code (reusing `users/{uid}.lastSeen`, not a new heartbeat) and a separate,
> explicitly-scoped typing-indicator mechanism with its own low-cost write/expiry design. Six,
> the exact full-page-with-Back implementation choice — either adapt the
> `task-fullscreen-panel`/`Overlay.push('task', ...)` pattern verbatim (recommended given its
> nested-live-content precedent) or justify using `openPage()` instead — with a concrete
> before/after code block anchored to file:line citations in this brief. Seven, an explicit
> statement of dept-channel membership derivation (which of the existing ad hoc membership
> checks, if any, is the canonical one to reuse) and explicit handling for the `Brilliant
> Steel`/`Partners` special departments so partner-to-partner chat isolation is never
> under-scoped to "any partner."
