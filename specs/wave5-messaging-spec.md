# V14 WAVE 5 — MESSAGING v2 SPEC (Messenger/Viber parity)

_Fable-authored 2026-08-03. Companion to V14-OVERHAUL-PLAN.md Workstream J (J1–J10) — that section is normative; this file adds sequencing + file ownership. chat.js batches are SEQUENTIAL (single file). Rules/storage/functions edits + deploys = main session between batches. Keep the existing listener-lifecycle contract (teardownInbox/teardownThread), the send guard, keyed-patch rendering, and Manila-day discipline. Message docs are backed up via the generic subcollection walker — no backup work needed._

## Batch M1 — Core feel (owns: js/chat.js, css/styles.css)
- **Optimistic send** (J2): on doSend, immediately append a local pending bubble (`_pending[]`, clientKey), state ○→✓ when the snapshot echoes it (match by clientKey field written with the doc); on failure mark the bubble failed with tap-to-retry. The composer clears immediately (current clear-on-confirm swaps to clear-on-optimistic + restore-on-failure).
- **Per-conversation drafts** (J2): localStorage `bi-chat-draft-{convId}` saved on input, restored on open, cleared on send.
- **Unread counts** (J7 part): real numbers on inbox rows + total badge on the Chat nav item (derive from existing `_isUnread` data + lastMessage counts where feasible without new reads — count of convs is acceptable v1; per-message counts come with M4's reads map).
- **"New messages" divider** (J7): on open, insert the divider line above the first message newer than my readAt; auto-scroll to it (not bottom) when present.
- **Scroll-to-bottom FAB** (J7): appears when scrolled up >300px; badge = messages arrived while scrolled up; tap = smooth bottom.
- **Copy message** (J3): long-press/context menu gains Copy (navigator.clipboard, toast).
- **Unsend tombstone** (J3): _onDeleteMessage stops hard-deleting — sets `{deleted:true, text:'', fileUrl:null}` (author or admin); renderer shows italic "Message removed"; reactions/picker/actions hidden on tombstones. Keep the notif-cleanup call. (Hard delete remains ONLY for admins via a separate "Remove permanently" long-press action.)
- CSS: pending/failed bubble states, divider, FAB, tombstone styling.

## Batch M2 — Reply, forward, mentions, emoji (owns: js/chat.js, css/styles.css)
- **Reply-to** (J3): swipe-right on a bubble (touch; reuse gestures patterns locally — do NOT touch gestures.js) or hover "↩" action arms reply mode: composer shows the quoted snippet chip with ✕; sent doc carries `replyTo:{mid, author, snippet(80ch)}`; bubble renders the quote block above text; tapping the quote scrolls to + flashes the original (if loaded; else toast "Message not loaded").
- **Forward** (J3): action opens a conversation picker (openPage, reuse dmCandidates + inbox rows); writes a fresh message to the target with `forwardedFrom:{convId, author}`; renderer shows "Forwarded" label.
- **@mentions** (J6): in group/dept composers, "@" triggers an inline typeahead over participants; selection inserts `@Name`; doc carries `mentions:[uid]`; render highlights; `_notifyRecipients` BYPASSES the 60s throttle + READ_FRESH skip for mentioned uids.
- **Composer emoji picker** (J6): the existing REACTIONS set + a compact grid (~32 common emoji, static list, no library); inserts at cursor.

## Batch M3 — Media + lightbox (owns: js/chat.js, css/styles.css)
- **Compression** (J4): port the quote-builder compressPhoto approach (1600px/JPEG 0.85) for image files before upload.
- **Multi-photo** (J4): file input gains `multiple`; N images → one message with `media:[{url,name,w,h}]` (cap 6/message); Messenger-style grid bubble (1=full, 2=split, 3+=grid with +N overlay).
- **Camera**: second attach action with `capture="environment"` on mobile.
- **Paste/drag-drop** (desktop): paste image from clipboard into composer; drag-over highlight on the thread.
- **In-app lightbox** (J1): replaces the `window.open` image click — full-window overlay ON the Overlay stack (one entry, Back/Esc/swipe-down dismiss), swipe/arrow between the conversation's images, pinch-zoom (CSS touch-action + transform), Save-link. NO new z literals — use the dynamic stack.
- **Shared Media/Files/Links tab** (J4): info button on the thread header → openPage with 3 chips, built from a one-shot paged query of the conversation's messages having fileUrl/media (client-filtered is fine at current volumes).

## Batch M4 — Conversation management + cost (owns: js/chat.js, css/styles.css)
- **Pin/mute/archive** (J7): per-user maps on the conv doc (`pinnedBy:{uid:true}, mutedBy:{uid:true}, archivedBy:{uid:true}`). Inbox: pinned rail on top; muted = bell-off glyph + no in-app notif (and see push below); archived hidden behind an "Archived" filter chip. Surfaces: swipe row actions (mobile) + hover ⋯ menu (desktop).
- **Group admin** (J7): thread info page (from M3) gains: rename (creator/admin), add members (internal users picker; arrayUnion + participantNames update), group photo (compressed upload to chat-files, `photoUrl` on conv doc, avatar renders it).
- **Reads denormalization** (J9): send/`_markRead` also merge `reads.{uid}: serverTimestamp` onto the conv doc (keep the readers subcollection for the in-thread seen-avatars); inbox unread state + counts read `conv.reads` — the per-conversation reader-doc gets fetched ONLY inside an open thread. Delete `_refreshMyReads`'s N-reads loop.
- **Typing tightened** (J9): TYPING_WRITE_MS 4000→1500 (TTL unchanged).
- **App badge** (J7): `navigator.setAppBadge(totalUnread)` where supported, cleared on read.

## Main-session infra between batches
- **rules** (before M1 ships): conversations/messages update must allow the tombstone shape (author sets deleted:true; admins too) — read current messages rules first; conv doc update must allow `reads.*`, `pinnedBy/mutedBy/archivedBy.*`, `photoUrl`, `name` per the gates above. Deploy + test with the M-batch.
- **functions/index.js** (with M4): sendPushOnNotification consults `conversations/{chatId}.mutedBy[uid]` for chat_message-type notifications (skip push when muted); deploy functions.
- **storage.rules** (with M3): chat-files path already covered for uploads with uploadedBy — verify size/type limits accommodate images/audio; adjust if images >5MB blocked after compression (shouldn't be).
- **Voice messages (J5)** are DEFERRED to a post-v14.0 follow-up (MediaRecorder + storage + playback is self-contained; keeping Wave 5 shippable). Recorded in plan.

## Protocol
Per batch: node --check, tests 20/20, invariants pass, boot zero-error, commit+push. Chat has live users — every batch must keep old-message rendering backward compatible (docs without new fields render exactly as today).
