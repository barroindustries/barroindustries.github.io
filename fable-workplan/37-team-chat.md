# Workstream 37 — Team Chat (DMs, group/dept channels, presence, reactions, push)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

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
