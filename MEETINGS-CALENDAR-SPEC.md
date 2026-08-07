# Meetings & In-System Calendar — build spec (2026-08-07)

Owner request, verbatim:
> "Can we make meeting appointments as well on chat with reminders / Send meeting
> appointments that sync with calendar / Send reminders and follow ups"

Owner correction when asked how invites should reach a phone calendar:
> "but its supposed to be the in system calendar / but we can do the first one too"

**So the primary deliverable is a calendar INSIDE the Operations System.** Exporting
to Apple/Google/Outlook is a secondary convenience on top, not the point.

Owner also chose: **morning-of reminders now, exact-time later** (Phase 2).

---

## 0. Scope

**PHASE 1 (this spec, ship as one unit)**
1. `meetings/{id}` collection + rules + index
2. In-system **Calendar screen** — month grid + day agenda (the primary surface)
3. Create/edit a meeting (from the calendar, and from a chat thread)
4. A meeting card in chat carrying an immutable pointer, with RSVP
5. Morning-of reminders folded into the **already-deployed** daily job (no new cron)
6. "Add to phone calendar" `.ics` export
7. Follow-ups: post-meeting notes + an optional follow-up date that lands back on
   the calendar

**PHASE 2 (NOT this spec)** — exact-time reminders (a new `*/5` scheduled function),
and pulling task deadlines / gov-bidding dates into the calendar view.

---

## 1. Data model — `meetings/{meetingId}`

A **top-level** collection, not a subcollection of `conversations`. Two reasons,
both verified: rules do not cascade into subcollections, and the chat thread only
holds the last 50 messages (`PAGE_SIZE`, js/chat.js:10), so a calendar could never
be built by scanning threads — it needs its own indexed query.

```
meetings/{meetingId}
  title            string        required, bounded
  agenda           string        optional
  location         string        optional, free text ("Zoom link" goes here)
  startAt          Timestamp     required
  endAt            Timestamp     required
  organizerUid     string        required
  organizerName    string
  invitees         [uid]         required, includes organizer
  inviteeNames     {uid: name}   denormalised for display without a users read
  convId           string|null   the chat thread it was created from, if any
  rsvp             {uid: 'yes'|'no'|'maybe'}
  remindersSent    {"morning": true, ...}   SERVER-WRITTEN ONLY
  status           'scheduled' | 'cancelled'
  notes            string        optional, post-meeting follow-up notes
  followUpAt       Timestamp|null  optional; renders on the calendar as a follow-up
  createdAt        serverTimestamp()
  updatedAt        serverTimestamp()
```

### Time handling — this is where this repo has been burned before

Store `startAt`/`endAt` as real Firestore `Timestamp`s.
Build the Date from the form's two inputs using the established idiom
(js/screens/worker.js:299):

```js
const startAt = new Date(`${dateStr}T${timeHM}:00+08:00`);
```

The explicit `+08:00` is the house pattern (also js/config.js `bizDow`,
`fmtMonthLabel`, functions/index.js). **Never** `new Date(d + ' ' + t)` and
**never** raw `toISOString()` for a calendar day — that bug already broke
attendance and payroll once.

- Inputs: `<input type="date">` + `<input type="time">` (there is no
  `datetime-local` anywhere in the repo; the HR kiosk pair at js/screens/hr.js:3124
  is the precedent).
- Display: `window.fmtManila(v)` (js/config.js) — the ONLY existing formatter that
  passes `timeZone:'Asia/Manila'`. Do **not** copy `liveDateTime()` or `fmtTs()`
  from dashboards.js; both omit the timezone and render the device clock.
- Month/day bucketing in the calendar grid must use the Manila helpers
  (`bizDate`/`bizYear`), never UTC getters.

---

## 2. Calendar screen — `window.renderCalendarPage` (THE primary surface)

New page, wired into the `navigateTo` switch in js/app.js and into the nav
builders + the relevant `*_BOTTOM_NAV` arrays in js/config.js.

**Layout**
- Month grid, Mon-first (PH convention), with the Manila "today" cell marked.
- Each day cell shows up to 3 meeting chips (time + truncated title) and a
  "+N more" affordance.
- Tapping a day opens a **day agenda** listing that day's meetings in full, each
  with time, title, location, organizer and RSVP state.
- `‹ ›` month navigation + a "Today" button.
- A `+ New meeting` button.
- Empty state that says what the calendar will hold, not just "nothing here".

**Scoping** — a user sees meetings where they are in `invitees`, plus (for
president/manager/secretary) everything, matching how the rest of the app tiers
visibility. Query by a bounded month window, never the whole collection:

```js
db.collection('meetings')
  .where('invitees','array-contains', uid)
  .where('startAt','>=', monthStart)
  .where('startAt','<=', monthEnd)
```

Needs a composite index — see §7.

**Mobile.** This is a phone-first app. The month grid must fit 375px without
horizontal scroll; use the existing chip/panel conventions and `openPage` for the
day agenda so it behaves as its own window (see the mobile window model). Follow
the `--sab-eff` safe-area convention for any bottom-anchored control.

---

## 3. Chat integration — an immutable pointer, nothing mutable on the message

**This is forced by the deployed rules, not a preference.** firestore.rules:684-704
allows exactly three shapes of message update: an author edit with
`authorId`/`createdAt` frozen, an admin tombstone, and
`affectedKeys().hasOnly(['reactions'])`. **Writing `rsvp` onto a message doc would
be DENIED.**

So the message carries only:

```js
// js/chat.js sendMessage(), beside the existing ref block
if (meeting && meeting.id) {
  msgDoc.meeting = { id: meeting.id, title: String(meeting.title||'').slice(0,140) };
}
```

Omit the field entirely when absent — that is the stated backward-compat contract
(js/chat.js:1994-2001), so there is zero migration and **no message-rules change**.

Clone the existing `#chat-attach-ref` structured-attachment path, which is the
working template. All seven touchpoints:

1. Composer button — sibling of `#chat-attach-ref` in `#chat-attach-expand`
2. Compose sheet — model on `_openRefPicker(onPick)`
3. Pending slot — `pendingMeeting` beside `pendingRef`; extend `updateFilePreview()`
   (**innerHTML sink — escHtml everything**) and `updateSendState()`
4. Send plumbing — snapshot/clear/restore exactly as `ref` does, through
   `_addPendingMessage` and `Chat.sendMessage`
5. Inbox preview — one branch in the ladder; **plain emoji only** (`📅 ${title}`).
   This is a PLAIN-TEXT sink: `emojiIcon()` returns `<i data-lucide>` markup and
   would render as literal code (known past defect)
6. Render — `_meetingCardHtml(m)` modelled on `_refChipHtml(ref)`; call from BOTH
   `_renderMessagePart` and `_renderPendingBubble` ("one markup, two callers")
7. Tap — BOTH delegation sites; opener modelled on `_openRefChip`

**Keeping the card live.** `_patchThread` only repaints a row when
`_msgRev(m)` changes, and the meeting pointer never changes — so RSVP counts would
freeze. Reuse the mechanism already in the file for exactly this shape of problem:
`_msgRev` folds the quoted original's live state into the row's hash. Do the same —
a module-level `_meetingCache`, one `onSnapshot` over the meeting ids visible in
`_msgs`, and one extra clause in `_msgRev`.

**Invitees** — use `_targetsFor(conv)` (js/chat.js:2072-2081). Department channels
are created with `participants: []` and membership is derived from each user's
department, so reading `conv.participants` directly would invite **nobody**.
Respect the announcement-channel post gate too.

---

## 4. Reminders — Phase 1 rides the job that already exists

**Verified: reminders already reach a phone with the app closed.**
`exports.scheduledDailyDigestChecks` (functions/index.js:706-709) runs
`.pubsub.schedule('30 8 * * *').timeZone('Asia/Manila')`, writes notification docs,
and `sendPushOnNotification` relays them as FCM web push. No tab required.

Phase 1 adds a **section inside that existing job** — no new Scheduler job, no new
cron, no added cost:

- Query meetings with `status=='scheduled'` and `startAt` inside the Manila day.
- For each invitee, one notification: "You have N meetings today" or the single
  meeting's time + title.
- `dedupKey: meet-day-${meetingId}-${manilaDateStr}`; write via `commitInChunks`
  to the deterministic `dedupDocId(key)`, so a re-run is a same-id `set()` → no
  `onCreate` → **no duplicate push**.
- Server-side dates MUST go through `manilaDate()` (functions/index.js:589-593) —
  Cloud Functions v1 always run in UTC; `.timeZone()` only controls when Scheduler
  fires.

**Notification payload — one small rules edit is required.** firestore.rules:313 is
a hard `hasOnly()` allowlist and a `meetingId` field is rejected outright. Add
`'meetingId'` to that list plus a bounded-string check, extend `Notifs.send()`, add
`meetingId` to the FCM data payload, and add a `meeting_*` branch to
`_navigateFromNotif`. Register the new type in `NOTIF_TYPE_META` or it renders as a
bare bell.

Send invites via `Notifs.send` **directly** — NOT through `_notifyRecipients`,
which applies a 60s throttle and per-conversation mute that would silently swallow
an invite.

Watch: js/notifications.js:1023 calls `_navigateFromNotif(type, taskId, chatId)`
with only three args, so `link` is undefined on the push-tap path. Use the
type-based branch; widening that call site is the cleaner fix.

---

## 5. "Add to phone calendar" — `.ics`, the only path without new OAuth

Verified: there is **no browser-side Google OAuth of any kind**. Login is
`signInWithEmailAndPassword` only; no `GoogleAuthProvider`, no `gapi`, no tokens
anywhere under `js/`. js/drive.js:11 states the intent outright — *"No Google OAuth
required from employees."* Google credentials are server-side, Drive-scoped, never
Calendar. So Calendar **API** sync is not buildable on anything that exists.

Generate a VEVENT blob instead:
- Blob → `URL.createObjectURL` → hidden `<a download>` → click → `revokeObjectURL`.
  Copy the mechanics from `window.exportCSV` (js/config.js:1097), swapping
  `text/csv` for `text/calendar`.
- **iPhone/PWA**: a plain anchor download is unreliable. Copy the ladder from
  `_downloadDocJPEG` (js/print-docs.js:330-348): build a `File`, try
  `navigator.canShare({files})` + `navigator.share(...)`, treat `AbortError` as
  user-cancel, else fall back to the Blob-URL anchor. This repo learned that the
  hard way (commit f571b1c).
- `DTSTART`/`DTEND` as UTC `...Z` derived from the stored Timestamp, with a stable
  `UID` (the meetingId) so a re-issued file updates rather than duplicates.
- Escape `,` `;` `\` and newlines per RFC 5545, and fold lines at 75 octets.

---

## 6. Follow-ups

After `endAt` passes, the organizer's meeting view offers "Add notes / set
follow-up". `notes` is free text; `followUpAt` is an optional Timestamp that
renders on the calendar as a distinct follow-up chip and is picked up by the same
morning-of digest section.

---

## 7. Rules, indexes, load order

**firestore.rules** — new `match /meetings/{id}` block:
- `read`: signed in AND (`uid in resource.data.invitees` OR admin tier)
- `create`: signed in AND `organizerUid == uid` AND `uid in invitees` AND bounded
  strings AND `status == 'scheduled'`
- `update`: organizer (full) OR an invitee limited to
  `affectedKeys().hasOnly(['rsvp'])` with only their own key changed — mirror the
  reactions pattern at firestore.rules:684-704
- `delete`: organizer or admin
- **`remindersSent` must be server-only** — reject it in client create/update
- Use `.get(field, default)` for ANYTHING not guaranteed on every doc. Reading an
  absent field THROWS and denies the whole rule — this has already broken
  presence/status in this repo once.

**firestore.indexes.json** — composite: `invitees ARRAY_CONTAINS` + `startAt ASC`.
Also `status ASC + startAt ASC` for the digest query.

**Load order** — new `js/meetings.js` exposing `window.Meetings` +
`window.renderCalendarPage`:
- `index.html`: immediately **after** `js/notifications.js` in the fixed `defer`
  order
- add to `PRECACHE` in `sw.js`
- may reference other globals at **runtime only**, never at parse time
- `case 'calendar':` in the `navigateTo` switch; nav entry in js/config.js

---

## 8. House rules

- Escape ALL user content with `escHtml()` before `innerHTML`.
- Icons via `<i data-lucide>` + `lucide.createIcons()` after injection — except in
  plain-text sinks (see §3.5).
- Scope every DOM lookup inside a panel to that panel
  (`panel.querySelector('#x')`), never `document.getElementById`. Unscoped lookups
  are the app's single largest defect class: a buried or dying panel with the same
  id wins, and the visible control is dead.
- Never `git stash` / `reset --hard` / `checkout --` / `clean` — multiple agents
  edit this tree live.
- Never hand-edit `APP_VERSION`, index.html version strings, or `CACHE_VER`.
