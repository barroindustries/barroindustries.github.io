# SPEC — Employee Drawer Restructure, Announcements Regroup, and the new Notes feature
**Date:** 2026-08-12 · **Author:** Fable (planning tier) · **Status:** READY TO IMPLEMENT
**Audience:** an implementer who has NOT seen the owner conversation. Everything you need is in this file.

---

## ⚠ 0. FILE CONTENTION — READ FIRST

Another agent is editing these files RIGHT NOW for an unrelated pay-formula change:

> `js/screens/dashboards.js`, `js/payroll.js`, `js/screens/payroll.js`, `js/departments.js`, `js/money-core.js`, `index.html`, `sw.js`

Rules of engagement for this spec:

1. **Never anchor an edit by line number.** Every anchor below is a function name, a NAV_REGISTRY key, or a unique searchable string. Line numbers appear only as "was near line N at spec time" hints — re-locate by name before editing.
2. Three of the files this spec touches are contended: `index.html` and `sw.js` (one single-line insert each) and `js/screens/dashboards.js` (one small button insert inside `renderPersonalFinance`). Do those three edits **last**, as isolated single edits, and re-`git diff` each file immediately before and after (see memory: concurrent sessions + OneDrive edit this tree live; NEVER `git stash`/`reset --hard`/`checkout --`/`clean`).
3. The bulk of the work lives in **uncontended** files: `js/config.js`, `js/app.js`, `js/screens/people.js`, `js/screens/notes.js` (new), `firestore.rules`, `firestore.indexes.json`.
4. The pre-commit hook auto-bumps `APP_VERSION` and derives `CACHE_VER` — do not hand-edit versions. Run `bash scripts/ci-invariants.sh` before committing (it enforces the index.html ↔ sw.js PRECACHE pair).
5. `git push` deploys the app but **NOT** Firestore rules/indexes. After the code lands run `firebase deploy --only firestore` (CLI at `~/.npm-global/bin/firebase`), and re-`git diff firestore.rules firestore.indexes.json` right before deploying so you don't ship another session's uncommitted edits.

---

## 1. What the owner ruled (verbatim, so nobody re-litigates it)

- Employee drawer contents: *"Dashboard / Chats / Notes / Tasks / Announcements (this is the posts) — Departmental (only those they are in), Company / My Profile / Attendance / My Finance"* — the "Departmental / Company" parenthetical describes the **Announcements feed tabs**, not drawer rows.
- Asked if that was complete: *"Include team above company and tools these are calendar and files"*.
- Target drawer order: **Dashboard, Chats, Notes, Tasks, Announcements, Team, Company, Tools (Calendar + Files), My Profile, Attendance, My Finance.**
- Per-user department entries: *"Yes add the departmental entries"* (2026-08-12). This is an **owner ruling, not a default** — the `{ deptLoop:true }` block STAYS in `sidebar.staff`. Do not remove it on the grounds that his original list omitted it; he was asked and confirmed it.
- Notes, asked what it should be: *"Own notes that they can also share"* — private by default, shareable.
- Notes privacy (2026-08-12, asked directly whether the president may read employees' private notes): **"No — private means private."** This is a RULING, not a default: a note nobody has been shared on is readable by its author alone, enforced in `firestore.rules`, not merely hidden in the UI.
- Notes sharing (2026-08-12): *"named people, owner decided if they may edit or view only or comment"* — recipients are named individuals (department-wide sharing is thereby ruled OUT, not deferred), and the note's owner assigns each recipient one of three levels: **view**, **comment**, or **edit**.
- Standing history on this drawer (see the comment blocks above `NAV_REGISTRY.sidebar.admin` and `.staff` in `js/config.js`): it was cut from 23 items to eleven on 2026-08-10 ("theres way too mauch happening…", "lessen the icons there… priority only"). Section headings are **plain labels, never folding** (folding was tried and removed the same day). **A group of one means the group is wrong** — "Tools" with exactly two members is acceptable; never ship a one-member group.

Decisions already made upstream — implement, do not reopen:
- "Chat" relabels to **"Chats"**, "Posts" relabels to **"Announcements"** (labels only — page keys, routes, the `posts` collection, and the `dept:'General'` field value are all UNCHANGED).
- **Cash Advance loses its drawer row** and folds into My Finance (§3.4 says exactly how; the `cash-advances` page itself is untouched and stays routed).

---

## 2. Files touched — complete list

| File | Contended? | Change |
|---|---|---|
| `js/config.js` | no | `NAV_REGISTRY`: new `sidebar.staff`, label edits in `sidebarUniversal`, `bottom.staff`, `bottom.admin`, partner label renames; update the `staff` comment block |
| `js/app.js` | no | `navigateTo`: add `case 'notes'`; nothing else |
| `js/screens/people.js` | no | `renderPosts`: header + tab label copy; `openNewPostModal`: "General" option label |
| `js/screens/notes.js` | **NEW FILE** | the whole Notes screen (§5.4) |
| `index.html` | **YES** | ONE line: `<script defer src="js/screens/notes.js"></script>` immediately after the `js/screens/people.js` script tag |
| `sw.js` | **YES** | ONE line: `'/js/screens/notes.js',` immediately after `'/js/screens/people.js',` in `PRECACHE` |
| `js/screens/dashboards.js` | **YES** | ONE button inside `renderPersonalFinance` employee branch (§3.4) |
| `firestore.rules` | no | new `match /notes/{noteId}` block (§5.2) |
| `firestore.indexes.json` | no | two new `notes` composite indexes (§5.3) |

No CSS changes: the screen reuses `.page-header`, `.card`, `.chip-tabs`, `.empty-state`, `.btn-*` classes that already exist.

---

## 3. PART A — the employee drawer (`NAV_REGISTRY` in `js/config.js`)

### 3.1 `sidebarUniversal` — label rename only

In `window.NAV_REGISTRY.sidebarUniversal`, change the chat item's label:

```js
{ key:'chat', icon:'message-circle', label:'Chats', page:'chat' }
```

**Side effect, accepted deliberately:** `sidebarUniversal` is prepended to EVERY variant, so admins and partners also see "Chats" now. That is consistency, not scope creep — one label, one place. Do NOT fork the universal list per variant to preserve "Chat" for admins. (Chat screen internals — headers inside `renderChatPage` — are NOT renamed; the owner's wording covered the drawer.)

### 3.2 The complete new `sidebar.staff` — verbatim

Replace the entire `staff:` array inside `window.NAV_REGISTRY.sidebar` with this (and replace the stale parts of the comment block above it — it currently describes the 2026-08-10 grouping):

```js
    // ── Employee / Agent / Accountant ──
    // REBUILT 2026-08-12 to the owner's own list, in his order:
    //   "Dashboard / Chats / Notes / Tasks / Announcements … Team above
    //    Company and tools these are calendar and files … My Profile /
    //    Attendance / My Finance"
    // Dashboard + Chats come from sidebarUniversal, so this array starts at
    // Notes. Group headings are PLAIN LABELS (owner, 2026-08-10 — folding was
    // tried and removed the same day). A group of one means the group is wrong.
    //
    // { deptLoop:true } — OWNER RULING 2026-08-12: "Yes add the departmental
    // entries." Not a default someone may trim later; he was asked whether the
    // per-user department rows belong here and said yes. They expand to one
    // row per department the signed-in user is in (plus Finance for the
    // Accountant — _pushDeptNavItems, js/app.js), under their own
    // 'My Departments' heading which that function stamps on the first row.
    //
    // Cash Advance has NO row here anymore — it folds into My Finance
    // (renderPersonalFinance carries the entry point; the cash-advances page
    // itself is unchanged and still routed for deep links / notifications).
    staff: [
      // ── Every day (no header — the reasons the drawer gets opened)
      { key:'notes',    icon:'sticky-note',  label:'Notes',         page:'notes' },
      { key:'tasks',    icon:'check-square', label:'Tasks',         page:'tasks' },
      { key:'posts',    icon:'megaphone',    label:'Announcements', page:'posts' },

      // ── Their own departments, generated per user (heading comes from
      //    _pushDeptNavItems: 'My Departments')
      { deptLoop:true },

      // ── Company-wide
      { key:'team',     icon:'users',        label:'Team',          page:'team-directory', section:true, sectionLabel:'Company' },
      { key:'company',  icon:'building-2',   label:'Company',       page:'company' },

      // ── Tools (owner named this group and both members)
      { key:'calendar', icon:'calendar-days', label:'Calendar',     page:'calendar', section:true, sectionLabel:'Tools' },
      { key:'files',    icon:'folder',        label:'Files',        page:'files' },

      // ── Me
      { key:'profile',    icon:'circle-user', label:'My Profile',   page:'my-profile', section:true, sectionLabel:'Me' },
      { key:'attendance', icon:'calendar',    label:'Attendance',   page:'attendance' },
      { key:'my-finance', icon:'wallet',      label:'My Finance',   page:'personal-finance' },

      // ── Operational screens, each shown only to the departments that use
      // them. UNCHANGED from the 2026-08-10 list. The Accountant reaches HR
      // here (owner: "Allow accountant access to hr").
      { key:'projects',    icon:'trending-up', label:'Projects',     page:'projects-lifecycle', section:true, sectionLabel:'Operations', when:'hasProjectsDept' },
      { key:'sales-orders',icon:'receipt',     label:'Sales Orders', page:'sales-orders',  when:'hasSalesOrdersDept' },
      { key:'inventory',   icon:'boxes',       label:'Inventory',    page:'inventory',     when:'hasProductionDept' },
      { key:'hr',          icon:'user-cog',    label:'HR',           page:'dept:HR',       when:'isFinanceRole' },
      { key:'sys-health',  icon:'activity',    label:'System Health',page:'system-health', when:'isFinanceRole' }
    ]
```

**Design judgements recorded (so the owner can reverse each with one edit):**

- **Department rows sit between Announcements and Team.** Rationale: they are daily *work* destinations, so they belong with the every-day set, not below the personal items; `_pushDeptNavItems` already stamps its own 'My Departments' heading so the variable-length block (1 row for most staff, 4 for a four-department employee) reads as a bounded group rather than pushing unlabeled rows around. The personal "Me" group does sit lower for a many-department user — that is inherent to any placement above it, and the owner's own order already puts My Profile/Attendance/My Finance last. To move the block, relocate the single `{ deptLoop:true }` line.
- **Row count honesty:** a one-department employee sees 5 (universal + every-day) + 1 dept + 2 + 2 + 3 = **13 rows** plus up to 3 headings — heavier than the 2026-08-10 trim, but this list is the owner's own, item by item. If he later says "too many" again, the candidates he did NOT name are exactly the conditional Operations rows and nothing else; do not pre-emptively cut.
- **`hasProjectsDept`/`hasSalesOrdersDept`/`hasProductionDept`/`isFinanceRole` predicates and the Operations group are kept verbatim** — silently dropping them would cut the Accountant off from HR and System Health.
- Label change `'My Tasks'` → `'Tasks'`: the owner's list says Tasks; also matches the admin drawer.
- `getSidebarItems` (js/app.js) already carries a group heading forward when the first member of a group is filtered by `when` — the Operations group needs no special handling.
- Icon `sticky-note` is a stable Lucide name (do not use `notebook-pen` without verifying the bundled Lucide version has it — an unmapped name renders an empty box and `_devCheckIconIntegrity` will flag it).

### 3.3 `bottom.staff` — verbatim replacement

Bottom-bar labels are hidden by CSS (`.bottom-nav-item .bn-label { display:none }` in css/styles.css) — icons only in the bar — but labels DO show in the "More" sheet (`openMoreNavSheet`, js/app.js), so keep them accurate. `_bottomNavSplit` (js/app.js) shows the first 4 + a More tab when there are more than 5 items. Chat must stay inside the visible four (its unread badge is painted onto the visible tab — see `_moreNavBadgeCount`'s comment).

```js
    // Bottom Nav — Employee. Visible four: Home, Tasks, Announcements, Chats
    // (same muscle-memory slots as the old Home/Tasks/Posts/Chat). 'Cash' is
    // gone — Cash Advance folds into My Finance (renderPersonalFinance);
    // Finance, Notes and Profile ride in the More sheet.
    staff: [
      { icon:'home',           label:'Home',          page:'dashboard'        },
      { icon:'check-square',   label:'Tasks',         page:'tasks'            },
      { icon:'megaphone',      label:'Announcements', page:'posts'            },
      { icon:'message-circle', label:'Chats',         page:'chat'             },
      { icon:'wallet',         label:'My Finance',    page:'personal-finance' },
      { icon:'sticky-note',    label:'Notes',         page:'notes'            },
      { icon:'circle-user',    label:'Profile',       page:'my-profile'       }
    ],
```

### 3.4 Cash Advance folds into My Finance — exactly how

Three coordinated pieces (the page key `cash-advances`, its route in `navigateTo`, and `renderCashAdvancePage` in js/screens/people.js are ALL untouched — notification deep links keep working):

1. **Drawer row removed** — the new `sidebar.staff` above simply has no `cash` entry.
2. **Bottom nav** — `Cash` replaced by `My Finance` (§3.3).
3. **Entry point inside My Finance** — in `js/screens/dashboards.js` (⚠ CONTENDED — do last, smallest possible diff), function `window.renderPersonalFinance`, **employee branch** (the non-`pres` branch): locate the button `id="my-payslip-btn"` (label "Current Month Payslip") and insert directly after it, as a sibling:

```html
<button class="btn-secondary" style="margin-top:8px;width:100%" id="my-cash-adv-btn">${emojiIcon('💵',16)} Cash Advances</button>
```

   and next to the existing `my-payslip-btn` click-wiring in the same function:

```js
c.querySelector('#my-cash-adv-btn')?.addEventListener('click', () => navigateTo('cash-advances'));
```

   Note `c` is that function's own container (it may be an `opts.host` panel, not `#page-content`) — scope the lookup to `c`, never `document.getElementById`.
4. **Do NOT touch** `bottom.admin`'s absence of cash, `renderCashAdvancePage`, or the `cash_advances` rules — presentation move only.

### 3.5 Other variants — label ripple only

- `bottom.admin`: `label:'Posts'` → `label:'Announcements'` (icon/page unchanged).
- `sidebar.genericPartner` and `sidebar.partnerBS`: `label:'Posts'` → `label:'Announcements'` on their `posts` items — consistency with the feed's new name; partners keep seeing only the Partners feed (unchanged).
- After editing, grep for stragglers: `grep -rn "label:'Posts'\|label:'Chat'" js/config.js` must return zero rows. Do NOT rename the page key `'posts'`, route case, collection name, `dept` field values, or `posts-tabs`/`posts-content` DOM ids.

---

## 4. PART B — Announcements (rename + regroup of the existing Posts screen)

All in `window.renderPosts` / `openNewPostModal` / `postCardHtml` territory, `js/screens/people.js` (uncontended). This is presentation only: **no change to who can read or write a post; `firestore.rules /posts` is the boundary and stays byte-identical.**

### 4.1 Tab shape decision: ONE FLAT CHIP ROW (not two-level)

The tabs become: **Company | <each department> | Pending Approval** (Pending only for president/manager, exactly as `canApprove` already computes).

Chosen over a two-level "Company | Departmental ▸ picker" because:
- The chip row already horizontal-scrolls at ≤640px (`.chip-tabs` is nowrap + overflow-x:auto, with `_chipFollow` keeping the active chip in view — see `window.chipTabs`/`bindChipTabs` in js/config.js), so 375px never horizontally scrolls the *page*; the row scrolls inside itself. Measurable: `document.documentElement.scrollWidth === clientWidth` at 375px.
- Ordinary staff have 1–2 departments, so the flat row is 2–4 chips — a second level would bury a two-item list behind an extra tap, and the owner's drawer history is one long complaint about extra taps and folding.
- Admins see every department (long row), but they already do today and the row scrolls; nothing regresses.

### 4.2 Exact edits in `js/screens/people.js`

1. `renderPosts`, **partner branch** header: `Posts` → `Announcements` (the `<h2>${emojiIcon('📣',20)} Posts</h2>` template).
2. `renderPosts`, **staff branch** header: same rename.
3. `postTabs` first entry becomes `{key:'General', label:'Company'}`. **The key stays `'General'`** — `loadPosts('General')` queries `where('dept','==','General')` and the stored field value must not change. The initial `loadPosts('General')` call and `chipTabs(postTabs,'General',…)` active-key stay `'General'`.
4. Department chips: unchanged (`{key:d, label:d}`) — they ARE the owner's "Departmental (only those they are in)"; ordinary staff get exactly `currentDepts`, admins get all reachable, the Corporate Secretary's blocked departments stay subtracted. Do not add a "Departmental" heading chip — a non-tappable chip in a tap row is a trap.
5. `Pending Approval` chip: keep key, label, gating, and behaviour exactly as-is.
6. `openNewPostModal`: wherever the department dropdown renders the `General` choice, change the **visible option text** to `Company` (keep `value="General"`). Also rename any user-visible "Post"/"Posts" strings in that modal's title/buttons to "Announcement"/"Announcements" — but leave the toast/notification *field* names and doc shape alone.
7. Sweep for remaining user-visible copy: `grep -n "Posts\|New Post\|Submit Post" js/screens/people.js` — rename only strings a user sees (`+ New Post` → `+ New Announcement`, `Submit Post` → `Submit Announcement`, empty-state texts). Internal identifiers (`posts-tabs`, `posts-content`, `new-post-btn`, `postCardHtml`, collection `posts`) unchanged.
8. Out of scope (contended or unnecessary): any "Posts" wording inside `js/screens/dashboards.js` quick actions — leave it; flag in the PR description as a follow-up rename for after the payroll agent lands.

---

## 5. PART C — NOTES (new feature)

Owner rulings: *"Own notes that they can also share"*, *"No — private means private"* (president may NOT read private notes), and *"named people, owner decided if they may edit or view only or comment."* So: **a note is private to its author unless the author shares it with named co-workers, and the owner assigns each recipient a level — view, comment, or edit.**

### 5.0 Scope decisions (with reasons — reopen only with the owner)

| Decision | Choice | Why |
|---|---|---|
| Share target | **Named individuals only** (`sharedUids`/`sharedLevels`) | OWNER RULING ("named people…"). Department-wide sharing is ruled out, not deferred. Person-picking already has a pattern (chat DM picker, Team directory). |
| Recipient rights | **Per-recipient level: `view` \| `comment` \| `edit`, assigned by the owner alone** | OWNER RULING (verbatim above). View reads; comment reads + writes comments; edit reads + rewrites title/body. Nobody but the owner touches sharing, levels, or delete. |
| Admin/president visibility | **NONE — for private AND shared notes. This is a REQUIREMENT, not an open flag.** | OWNER RULING (2026-08-12, asked directly): **"No — private means private."** Enforced in `firestore.rules` — the block below deliberately contains no `isAdmin()`/`isPresident()` clause, and none may be added later "helpfully": people write honestly in a notepad they trust, and one they suspect is readable is worthless — they will use their phone's notes app instead, which is strictly worse for the company. Oversight of what the business actually runs on (tasks, announcements, files, chat) is unaffected. |
| Concurrent edits | **Last-write-wins, ADMITTED in the UI** | Two `edit` recipients will eventually save over each other. The honest minimum: every save stamps `updatedByName`, the note shows "Updated by X · HH:MM", and the editor warns before overwriting a save that landed while you were typing (§5.4). No silent loss. |
| Partners | Cannot create notes (`!isPartner()` on create); can read/participate only if explicitly shared with them | Employee-facing feature; matches the posts pattern. |
| Attachments | **NO in v1** | Two hard blockers: (a) `storage.rules` is scoped by Auth custom claims (role/dept — see memory `storage-custom-claims`) and cannot express a per-note ACL, so a "private" note's file would be readable beyond the share list — violating the privacy ruling at the storage layer; (b) the nightly Drive mirror (`window.Drive` → GitHub Action) copies uploads into a company Drive folder, republishing private notes to ops. Ship text-only; attachments = owner decision + a storage design of their own. |
| Offline/PWA | Whatever Firestore's IndexedDB persistence gives for free; nothing bespoke | Out of scope per brief. |
| Collection name | `notes` | Verified free: firestore.rules has `strategy_notes` (different collection) and `notes` only as a *field* name on meetings/finance docs; no `match /notes` exists; no `files_*`/`budgets_*` prefix collision. Client code has no `collection('notes')` call today. |

### 5.1 Data model — `notes/{noteId}` (auto-id)

```
ownerUid      string    auth uid of the author. Immutable after create.
ownerName     string    display name snapshot (for recipients' list rows without a users lookup).
title         string    1..200 chars, plain text.
body          string    0..20000 chars, plain text (newlines preserved; NO markdown/HTML).
sharedUids    array     SCALAR uid array. [] = private. Max 50. THE access gate:
                        the only sharing field rules membership-test and the only
                        one an array-contains query can use.
sharedLevels  map       { uid: 'view' | 'comment' | 'edit' } — the owner-assigned
                        permission per recipient.
updatedByName string    display name of whoever last saved title/body (the
                        last-write-wins stamp, §5.4).
createdAt     timestamp serverTimestamp() at create.
updatedAt     timestamp serverTimestamp() at create and every update. Sort key.
```

**Why TWO sharing fields:** rules cannot search an array of objects, and `array-contains` needs scalars — so a single `[{uid, level}]` array can carry neither the query nor the membership test. `sharedUids` is queryable/testable; `sharedLevels` carries the level.

**Consistency invariant (privacy-critical — a stale entry in one field must never out-grant the other):**
1. *Write-time, enforced by rules:* every create and every owner update must satisfy `sharedUids.toSet() == sharedLevels.keys().toSet()` and `sharedLevels.values().hasOnly(['view','comment','edit'])`. A write with a uid in one field but not the other, or an invented level, is **denied** — the invariant can never be broken through the API. The edit-recipient update tier cannot touch either field at all (`affectedKeys().hasOnly` in §5.2), so it cannot break it either.
2. *Read-time, fail-safe direction:* **access is decided by `sharedUids` membership ONLY**; `sharedLevels` is consulted only *after* `sharedUids` admits the uid, via `.get(uid, 'view')` — defaulting to the WEAKEST level. So even if the invariant were somehow violated (console write by the owner bypassing the client): a uid present in `sharedLevels` but not `sharedUids` has NO access at all, and a uid in `sharedUids` with no level entry degrades to view-only. Neither direction of staleness can grant more than the other field allows.
3. *Client-side:* the share panel changes both fields in **one** `update()` call with fully recomputed values (never `arrayUnion` on one field alone) — the post-state the rules validate is atomic.

Subcollection: `notes/{noteId}/comments/{commentId}` (§5.2a). No other fields — the rules `hasOnly` lists are the schema police; adding a field later means touching rules + this spec.

### 5.2 `firestore.rules` — exact block

Insert as a sibling of the other top-level matches (suggested: right after the `match /posts/{postId}` block so the two feed-adjacent features sit together). Repo rulings baked in below: rules do not cascade to subcollections (hence the explicit nested `comments` match) and never prefix-match; absent-field reads THROW, hence `.get(field, default)` everywhere.

```
    // ── Personal Notes (2026-08-12) — "Own notes that they can also share" ──
    // OWNER RULING (2026-08-12, asked directly whether the president may read
    // employees' private notes): "No — private means private." A note nobody
    // has been shared on is readable by its AUTHOR ALONE, enforced HERE, not
    // hidden in the UI. There is DELIBERATELY no isAdmin()/isPresident()
    // clause anywhere in this block — do not add one "helpfully": people
    // write honestly in a notepad they trust, and one they suspect is
    // readable is worthless — they'll use their phone's notes app instead,
    // which is strictly worse for the company. Oversight of what the business
    // actually runs on (tasks, announcements, files, chat) is unaffected.
    //
    // Sharing (same ruling: "named people, owner decided if they may edit or
    // view only or comment"): named individuals; the OWNER assigns each one
    // view | comment | edit. Two fields carry that (rules can't search an
    // array of objects, and array-contains needs scalars):
    //   sharedUids   — scalar uid array. THE access gate: the only field the
    //                  membership tests and array-contains queries use.
    //   sharedLevels — { uid: level }. Consulted only AFTER sharedUids admits
    //                  the uid; a missing entry degrades to 'view' (weakest).
    // Every owner write must keep the two exactly consistent (the toSet()
    // equality below), so a stale entry in one can never out-grant the other.
    //
    // List provability: the two client queries pin the read disjuncts
    // statically — where('ownerUid','==',uid) proves the first,
    // where('sharedUids','array-contains',uid) proves the second.
    function noteIsOwner(note)  { return note.data.get('ownerUid', '') == request.auth.uid; }
    function noteIsShared(note) { return request.auth.uid in note.data.get('sharedUids', []); }
    function noteLevel(note) {
      return note.data.get('sharedLevels', {}).get(request.auth.uid, 'view');
    }
    match /notes/{noteId} {
      allow read: if isAuth() && ( noteIsOwner(resource) || noteIsShared(resource) );

      allow create: if isAuth() && !isPartner()
        && request.resource.data.get('ownerUid', '') == request.auth.uid
        && request.resource.data.keys().hasOnly(
             ['ownerUid','ownerName','title','body','sharedUids','sharedLevels',
              'updatedByName','createdAt','updatedAt'])
        && request.resource.data.get('title', '') is string
        && request.resource.data.get('title', '').size() >= 1
        && request.resource.data.get('title', '').size() <= 200
        && request.resource.data.get('body', '') is string
        && request.resource.data.get('body', '').size() <= 20000
        && request.resource.data.get('sharedUids', []) is list
        && request.resource.data.get('sharedUids', []).size() <= 50
        && request.resource.data.get('sharedUids', []).toSet()
             == request.resource.data.get('sharedLevels', {}).keys().toSet()
        && request.resource.data.get('sharedLevels', {}).values()
             .hasOnly(['view', 'comment', 'edit']);

      // TWO update tiers. Only the OWNER may change sharing, levels, or
      // ownership; an 'edit' recipient may rewrite the TEXT and nothing else —
      // the affectedKeys().hasOnly() below denies outright any editor write
      // that touches ownerUid/sharedUids/sharedLevels, so a recipient can
      // never re-share the note, escalate their own level, or lock the owner
      // out. 'view' and 'comment' recipients match neither tier: denied.
      allow update: if isAuth() && (
        // ── owner: full control; schema + consistency re-proven every write
        ( noteIsOwner(resource)
          && request.resource.data.get('ownerUid', '') == resource.data.get('ownerUid', '')
          && request.resource.data.keys().hasOnly(
               ['ownerUid','ownerName','title','body','sharedUids','sharedLevels',
                'updatedByName','createdAt','updatedAt'])
          && request.resource.data.get('title', '') is string
          && request.resource.data.get('title', '').size() >= 1
          && request.resource.data.get('title', '').size() <= 200
          && request.resource.data.get('body', '') is string
          && request.resource.data.get('body', '').size() <= 20000
          && request.resource.data.get('sharedUids', []) is list
          && request.resource.data.get('sharedUids', []).size() <= 50
          && request.resource.data.get('sharedUids', []).toSet()
               == request.resource.data.get('sharedLevels', {}).keys().toSet()
          && request.resource.data.get('sharedLevels', {}).values()
               .hasOnly(['view', 'comment', 'edit']) )
        ||
        // ── edit-level recipient: title/body (+ the LWW stamp) only
        ( noteIsShared(resource)
          && noteLevel(resource) == 'edit'
          && request.resource.data.diff(resource.data).affectedKeys()
               .hasOnly(['title', 'body', 'updatedAt', 'updatedByName'])
          && request.resource.data.get('title', '') is string
          && request.resource.data.get('title', '').size() >= 1
          && request.resource.data.get('title', '').size() <= 200
          && request.resource.data.get('body', '') is string
          && request.resource.data.get('body', '').size() <= 20000 )
      );

      allow delete: if isAuth() && noteIsOwner(resource);

      // ── §5.2a Comments — SUBCOLLECTION, so it needs its OWN match: rules
      // NEVER cascade. Access rides entirely on the parent note's
      // sharedUids/sharedLevels, re-read via one get() per operation.
      // 'view' recipients can READ comments but not post; 'comment' and
      // 'edit' can post; only a comment's author or the NOTE owner deletes.
      // Comments are immutable (no update verb): delete + repost to fix.
      match /comments/{commentId} {
        function parentNote() {
          return get(/databases/$(database)/documents/notes/$(noteId));
        }
        // Anyone who can read the note can read its comments — president
        // and admins included ONLY if the note is shared with them, exactly
        // like the note itself.
        allow read: if isAuth() && (
             parentNote().data.get('ownerUid', '') == request.auth.uid
          || request.auth.uid in parentNote().data.get('sharedUids', []) );

        allow create: if isAuth()
          && request.resource.data.get('authorUid', '') == request.auth.uid
          && request.resource.data.keys().hasOnly(
               ['authorUid', 'authorName', 'text', 'createdAt'])
          && request.resource.data.get('text', '') is string
          && request.resource.data.get('text', '').size() >= 1
          && request.resource.data.get('text', '').size() <= 2000
          && ( parentNote().data.get('ownerUid', '') == request.auth.uid
               || ( request.auth.uid in parentNote().data.get('sharedUids', [])
                    && parentNote().data.get('sharedLevels', {})
                         .get(request.auth.uid, 'view') in ['comment', 'edit'] ) );

        allow delete: if isAuth() && (
             resource.data.get('authorUid', '') == request.auth.uid
          || parentNote().data.get('ownerUid', '') == request.auth.uid );
      }
    }
```

Notes for the implementer: helper names used (`isAuth`, `isPartner`) exist at the top of firestore.rules; the three `note*` helper functions are new — place them immediately above the `match /notes` block (rules allows function declarations at the documents-match level; `parentNote()` is declared inside the comments match, which is also legal). `Map.get(key, default)`, `Map.keys()`/`.values()`, `List.toSet()`, set `==`, and `List.hasOnly()` are all standard rules-language members. Notes are not finance documents — the `financeDelete` president-approval flow does NOT apply; owner-delete is correct here.

Comment doc shape — `notes/{noteId}/comments/{commentId}` (auto-id):

```
authorUid  string     the commenter. Immutable (comments have no update verb).
authorName string     display name snapshot.
text       string     1..2000 chars, plain text.
createdAt  timestamp  serverTimestamp(). Sort key (ascending).
```

Kept deliberately minimal: a flat comment list, not a thread — replies/reactions/edit-in-place would each need more rules surface on the most privacy-sensitive collection in the app, and nothing in the ruling asks for them.

### 5.3 `firestore.indexes.json` — exact entries

Append to the `indexes` array (both client queries in §5.4 need one):

```json
    {
      "collectionGroup": "notes",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerUid",  "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "notes",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sharedUids", "arrayConfig": "CONTAINS" },
        { "fieldPath": "updatedAt",  "order": "DESCENDING" }
      ]
    }
```

Comments need NO index entry: the only query is `notes/{id}/comments.orderBy('createdAt','asc')` within one parent — a single-field auto-index covers it.

Deploy with the rules: `firebase deploy --only firestore`.

### 5.4 The screen — `js/screens/notes.js` (NEW)

**⚠ XSS: this is the highest-XSS-risk feature in the app — and comments make it TWO free-text sinks.** Notes AND comments are free text typed by one employee and rendered into `innerHTML` in another employee's session (lists, panels, comment rows, toasts, share rows). EVERY interpolation of `title`, `body`, `ownerName`, `authorName`, comment `text`, or a picked user's name goes through `escHtml()` (js/modules.js) — no exceptions, including toast strings and `data-` attributes. Newlines in body/comment text: render as `escHtml(text).replace(/\n/g,'<br>')` — escape FIRST, then insert `<br>`. Never `emojiIcon()` into plain-text sinks (toasts/notification titles) — plain emoji characters only (memory: emojiIcon plain-text sinks).

**File conventions (hard constraints):**
- Classic script. `'use strict';` then ONE IIFE `(function(){ ... })();` exposing exactly one global: `window.renderNotesPage`. No top-level `const`/`let` outside the IIFE; inside, use `var`/`function` freely. Name-collision check done at spec time: `renderNotesPage` is unused across `js/` and `js/screens/` (`renderNotesFor` in dashboards.js is a strategy-notes local — unrelated); keep every other helper INSIDE the IIFE so no further global names are minted.
- Manila time: any date-only logic via `window.bizDate()`; display timestamps via `ts.toDate().toLocaleString('en-PH', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})` guarded with `?.toDate` like `postCardHtml` does.
- Icons: `<i data-lucide="...">` + `lucide.createIcons({ nodes:[container] })` after every injection.
- DOM scoping: the top-level screen renders into `document.getElementById('page-content')` (that is the screen pattern); **everything inside an `openPage` panel is looked up via the panel element that `openPage(...)` RETURNS** (`var panel = openPage(...); panel.querySelector('#nts-title')`) — never `document.getElementById` inside panels; a closing panel lingers ~300ms and stale-panel lookups are a known bug class here.
- Buttons that write: wrap handlers in `window.busy(btn, fn)`. Confirmations: `window.confirmDialog(opts)` (js/config.js). Toasts: `Notifs.showToast(msg, kind)`.

**Structure (all names internal to the IIFE):**

```
window.renderNotesPage = async function() { ... }   // the ONLY export
  – header:  <div class="page-header"><h2>{emojiIcon('🗒️',20)} Notes</h2>
              <button class="btn-primary btn-sm" id="nts-new-btn">+ New Note</button></div>
  – tabs:    window.chipTabs([{key:'mine', label:'My Notes'},
                              {key:'shared', label:'Shared with Me'}], 'mine', {cls:'nts-tabs'})
             + <div id="nts-list"></div>
  – bind:    window.bindChipTabs(c.querySelector('.nts-tabs'), key => loadList(key))
  – initial: loadList('mine')

loadList(tab)      // skeleton via window.skeletonHtml('rows') while fetching
  mine:   db.collection('notes').where('ownerUid','==',currentUser.uid)
            .orderBy('updatedAt','desc').limit(100).get()
  shared: db.collection('notes').where('sharedUids','array-contains',currentUser.uid)
            .orderBy('updatedAt','desc').limit(100).get()
  // Fresh queries each time, NOT dbCachedGet — private data, cheap query,
  // and a stale cache after save/share is worse than the read.

noteCardHtml(n, tab)
  – card row: escaped title (bold), snippet = escHtml(first ~120 chars of body),
    updated stamp (+ 'by {escHtml(updatedByName)}' when present);
    owned+shared notes show a badge
    `<span class="badge badge-gray"><i data-lucide="users"></i> Shared · N</span>`
    (N = sharedUids.length); tab==='shared' rows show
    `Shared by {escHtml(ownerName)} · {level label}` instead.
  – whole card tappable → openNote(id, tab)

myLevel(n)         // ONE helper, used by every capability test in the UI
  owner → 'owner'; else n.sharedLevels?.[uid] || 'view'
  // mirrors the rules' fail-safe: missing level entry degrades to view.
  // The UI is convenience only — firestore.rules is the boundary.

Level labels (exact copy, used everywhere a level shows):
  view → 'View only'   comment → 'Can comment'   edit → 'Can edit'

openNote(id, tab)  // fetch fresh doc; permission-denied → toast 'This note is no
                   // longer shared with you.' and reload list
  – var panel = openPage(escHtml(n.title), viewHtml, footerHtml)
  – view: body rendered escaped with <br> newlines; meta line
    'Updated {stamp}' (+ ' by {escHtml(updatedByName)}' when present).
    Recipient additionally sees, directly under the title:
    'Shared by {escHtml(ownerName)}' + a level badge with the label above —
    at a glance, what they may do with it.
    Owner additionally sees a 'Shared with' row: one chip per recipient,
    '{escHtml(name)} · {level label}' (tapping it opens openShare).
  – COMMENTS section under the body (all viewers):
    heading 'Comments', then notes/{id}/comments.orderBy('createdAt','asc')
    .get() rendered as rows: escaped authorName (bold), stamp, escaped text
    with <br> newlines, and an ✕ delete icon shown only when
    (comment.authorUid === uid) || (viewer is note owner).
    ✕ → confirmDialog({title:'Delete comment?', danger:true}) → delete →
    re-render the comment list (panel-scoped).
    Below the list, an input row `<input id="nts-comment-input">` + 'Post'
    button — rendered ONLY when myLevel is owner/comment/edit ('View only'
    sees the list but no input). Post via busy(): trim, 1..2000 chars,
    { authorUid, authorName, text, createdAt: serverTimestamp() }, then
    Notifs.send to the note OWNER (skip when commenter IS the owner):
    plain-text title 'New comment on your note', body
    '{authorName} commented on "{title}"', payload page:'notes'.
  – footer by capability:
      owner            → [Edit] [Share] [Delete]   (Delete = btn-danger)
      edit recipient   → [Edit]
      comment / view   → none (comment input above is their write surface)
  – Delete (owner only): confirmDialog({title:'Delete note?', message:
    '"{escaped title}" will be deleted permanently. Anyone it was shared with
    loses access.', danger:true}) → doc.delete() → toast 'Note deleted' →
    close panel, loadList
    // Client also best-effort deletes the comments subcollection docs it can
    // list (batched). Any stragglers are unreachable anyway: every comment
    // verb re-reads the parent note, and with the parent gone, parentNote()
    // throws → denied. Say this in a code comment; do not build a Cloud
    // Function for it.

openEditor(existing|null)   // reachable by the OWNER and by 'edit' recipients
  – var panel = openPage(existing ? 'Edit Note' : 'New Note',
      `<input id="nts-title" class="form-input" maxlength="200"
              placeholder="Title" value="{escaped}">
       <textarea id="nts-body" class="form-input" rows="12" maxlength="20000"
              placeholder="Write your note…">{escaped}</textarea>`,
      `<button class="btn-primary" id="nts-save-btn">Save</button>`)
  – when opening an existing note, remember the updatedAt it was opened at
    (closure var, millis).
  – save via busy(): trim; empty title → toast 'Give the note a title.' (error), abort
  – CONCURRENT-EDIT GUARD (honest last-write-wins — two 'edit' recipients WILL
    eventually collide; we admit it instead of silently losing writing):
    before writing, re-get the doc once; if its updatedAt is newer than the
    opened-at stamp → confirmDialog({ title:'Overwrite newer changes?',
    message:'{escHtml(updatedByName)} saved this note at {HH:MM} while you were
    editing. Saving now will replace their version.', okLabel:'Save anyway',
    danger:true }) — cancel keeps the editor open with the user's text intact.
    This is the specced minimum; no merge, no locking.
  – create: { ownerUid, ownerName: currentUser.displayName || currentUser.email,
              title, body, sharedUids: [], sharedLevels: {},
              updatedByName: currentUser.displayName || currentUser.email,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp() }
  – edit:   update({ title, body,
              updatedByName: currentUser.displayName || currentUser.email,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
    // identical update for owner and edit-recipient — it touches exactly the
    // four keys the rules' editor tier allows, and the owner tier allows a
    // superset. Never let a recipient's save path touch sharing fields.
  – toast 'Note saved' → close panel (Overlay.dismissTop()) → loadList(currentTab)

openShare(note)    // OWNER ONLY — one obvious action per person, not a matrix
  – var panel = openPage('Share Note', shareHtml, '')
  – people source: dbCachedGet('users', () => db.collection('users').get(), 30000)
    (the cached fetcher is fine here — it's the same directory the Team tab uses);
    filter out partners, the current user, and uids already in sharedUids;
    render a searchable list (simple <input> filter over rendered rows — reuse
    the team-directory row pattern, panel-scoped).
  – CURRENT RECIPIENTS listed first: each row = escaped name, a level
    `<select>` with options View only / Can comment / Can edit (current level
    selected), and an ✕ to remove. Changing the select saves immediately;
    no separate 'apply' step.
  – tapping a person in the picker ADDS them at 'view' (weakest default) and
    moves them into the recipients list, where the select sits right there to
    raise the level — one action to share, one optional tweak.
  – EVERY share mutation (add / remove / level change) is ONE update() that
    recomputes BOTH fields from the panel's in-memory state:
      update({ sharedUids: [...uids], sharedLevels: {...uidToLevel},
               updatedAt: serverTimestamp() })
    — never arrayUnion/arrayRemove on sharedUids alone: the rules' toSet()
    equality would reject the half-write, and half-writes are exactly the
    stale-entry privacy hole §5.1 exists to prevent.
  – on ADD, notify the recipient: Notifs.send(uid, { title:'Note shared with
    you', body:'{ownerName} shared "{title}" — {level label}', ... }) —
    PLAIN TEXT title/body (no markup, no emojiIcon() output), payload
    page:'notes' so the deep link lands on the Notes screen. Level changes
    and removals notify nobody (quiet corrections).
  – Recipients cannot remove themselves in v1 (sharing fields are owner-only
    in rules); do not render a 'Leave' control on shared-with-me notes.

Empty states (exact copy):
  – My Notes:        icon 🗒️  'No notes yet' / 'Your notes are private until you share them.'
  – Shared with Me:  icon 🤝  'Nothing shared with you yet' / 'Notes co-workers share with you will appear here.'
```

375px: cards are full-width stacked; the two-chip tab row cannot overflow; the editor textarea is `width:100%` within the panel padding — no horizontal scroll, no truncation (title ellipsis in the card row is allowed via existing card CSS, the full title always visible in the panel).

### 5.5 Wiring — routing and load order

1. **`js/app.js`**, function `navigateTo`, inside the `switch(page)` — add with the other "New modules" cases (anchor: the `case 'posts':` line):
   ```js
   case 'notes':            window.renderNotesPage?.(); break;
   ```
   No `_SKELETON_KIND` entry needed — the default `'rows'` is correct for a list screen (the map's own comment says unlisted pages defaulting to rows is by design).
2. **`index.html`** (⚠ contended): add `<script defer src="js/screens/notes.js"></script>` immediately after the `js/screens/people.js` script tag (before dashboards.js). Load-order rationale: notes.js only calls window globals defined earlier (config.js helpers, app.js openPage via runtime call, modules.js escHtml) and nothing calls INTO notes.js before `navigateTo('notes')` runs at click time — the same forward-reference convention every js/screens file documents.
3. **`sw.js`** (⚠ contended): add `'/js/screens/notes.js',` right after `'/js/screens/people.js',` in `PRECACHE`. Do not touch `CACHE_VER` — the pre-commit hook derives it.
4. Run `bash scripts/ci-invariants.sh` — it must pass (PRECACHE pair check + no new 4-digit z-index).

---

## 6. User-visible copy — single source of truth

| Where | Old | New |
|---|---|---|
| Drawer (all variants, universal item) | Chat | **Chats** |
| Drawer staff/partners + bottom admin/staff | Posts | **Announcements** |
| Drawer staff | My Tasks | **Tasks** |
| Drawer staff | Cash Advance (row) | *(removed — see My Finance)* |
| Drawer staff (new rows) | — | **Notes**, **Team**, **Company**, **Calendar**, **Files**, **My Profile**, **Attendance**, **My Finance** per §3.2 |
| Drawer staff section headings | Company / Me / Operations (2026-08-10 set) | **My Departments** (auto), **Company**, **Tools**, **Me**, **Operations** |
| Announcements screen header | 📣 Posts | 📣 **Announcements** |
| Announcements first tab | General | **Company** (key stays `General`) |
| Announcements buttons | + New Post / + Submit Post | + New Announcement / + Submit Announcement |
| New-announcement modal dept option | General | **Company** (value stays `General`) |
| My Finance (employee view) | — | **Cash Advances** button under "Current Month Payslip" |
| Notes screen | — | copy exactly as §5.4 (header, tabs, buttons, empty states, toasts, confirm) |
| Notes permission labels | — | **View only** / **Can comment** / **Can edit** (share-panel selects, recipient badge, share notification) |
| Notes meta line | — | 'Updated {stamp} by {name}' · recipient badge 'Shared by {name}' |
| Notes comments | — | 'Comments' heading; 'Post' button; confirm 'Delete comment?'; overwrite warning 'Overwrite newer changes?' / 'Save anyway' |

---

## 7. Flagged for the OWNER (do not guess; ship v1 without them)

RESOLVED since the first draft — no longer open, now requirements: president/admin access to notes (**ruled NO**, §5.0/§5.2 — "private means private"), department-wide sharing (**ruled OUT** — "named people"), and shared editing (**ruled** — per-recipient view/comment/edit levels, §5.2).

Still open:
1. **Recipient self-removal** ("leave a note shared with me") — sharing fields are owner-only in rules, so v1 has no Leave control; a recipient who wants out must ask the owner.
2. **Attachments on notes** — blocked on a storage-ACL design (§5.0); do not route through `window.Drive` as-is (nightly mirror would republish private notes to the company Drive).
3. Renaming "Posts" wording inside dashboard quick actions (contended file — deferred, §4.2.8).

---

## 8. Verification checklist (all measurable; run at 375×812 unless stated)

1. `bash scripts/ci-invariants.sh` exits 0.
2. `firebase deploy --only firestore` compiles and deploys rules + both new `notes` indexes (console shows them ENABLED; neither client query throws `failed-precondition`).
3. Employee (1 dept, e.g. Sales) drawer reads top-to-bottom exactly: Dashboard, Chats, Notes, Tasks, Announcements, [My Departments] Sales, [Company] Team, Company, [Tools] Calendar, Files, [Me] My Profile, Attendance, My Finance — and NO Cash Advance row, NO group with exactly one member (My Departments with one dept row is the sanctioned exception: its heading is generated, and a 2+ dept user gets 2+ rows).
4. Accountant (`finance` role) drawer additionally shows [Operations] Projects, Sales Orders, HR, System Health — HR opens.
5. A 4-department employee's drawer still renders every "Me" row reachable within one swipe of scroll at 375px, and no horizontal scroll anywhere (`document.documentElement.scrollWidth === document.documentElement.clientWidth`).
6. Admin drawer unchanged except the universal "Chats" label; secretary still sees no Finance entry.
7. Bottom nav (employee): 4 visible icons + More; More sheet lists My Finance, Notes, Profile with full labels un-truncated; chat unread badge still paints on the visible Chats tab.
8. Announcements screen: header "Announcements"; chips read Company | <depts> | (Pending Approval for pres/manager only); Company tab lists exactly the posts the old General tab listed (same query, verified by count against Firestore console); posting to "Company" writes `dept:'General'`.
9. Partner login: Announcements shows only the Partners tab, as before.
10. Notes CRUD as owner: create (appears top of My Notes, `createdAt`/`updatedAt` are server timestamps, `sharedUids:[]`/`sharedLevels:{}` present), edit (moves to top, `updatedByName` stamps), delete (confirm dialog → gone, and its comments become unreadable: a recipient's `comments` read after parent delete is denied).
11. Share at **View only**: share to user B → B gets a notification reading "… — View only" whose tap lands on Notes; note appears under B's "Shared with Me" with "Shared by …" + "View only" badge; B sees comments but NO comment input and NO Edit/Share/Delete; from B's console, a body `update()` AND a comment `add()` are both `permission-denied`.
12. Raise B to **Can comment** (owner's share panel select): B's reopened note now shows the comment input; B posts a comment (owner receives "New comment on your note"); B's console body `update()` still `permission-denied`.
13. Raise B to **Can edit**: B gets an [Edit] button and successfully saves title/body (card shows "by B"); from B's console, each of these is `permission-denied`: an update touching `sharedLevels` (self-escalation), one touching `sharedUids` (re-share), one touching `ownerUid`, and a `delete()`.
14. Consistency invariant negatives (owner's console): an update writing `sharedUids` without the matching `sharedLevels` key (half-write), one writing a `sharedLevels` entry whose uid is not in `sharedUids`, and one with level `'admin'` — all three `permission-denied`.
15. Privacy negatives — the ruling "private means private" (console, each principal): with a PRIVATE note id from user A — user B `get()` → `permission-denied`; **president** `get()` → `permission-denied`; president on a SHARED-to-others note `get()` → `permission-denied`; president `db.collection('notes').get()` (unscoped list) AND a `comments` read under A's note → `permission-denied`. Unshare B → B's next `get()` denied and the note leaves B's list on reload.
16. Comment moderation: comment author deletes their own comment; note owner deletes anyone's; a `comment`-level recipient's console delete of someone ELSE's comment → `permission-denied`; comment `update()` by anyone (author included) → `permission-denied` (immutable).
17. Concurrent edit is admitted, not silent: open the same note as owner and as an edit-recipient, save as owner, then save as recipient — the recipient gets "Overwrite newer changes?" naming the owner; cancel preserves the recipient's draft text in the editor; "Save anyway" wins and the note shows "Updated … by {recipient}".
18. XSS (both sinks): a note titled `<img src=x onerror=alert(1)>` with body `<script>alert(2)</script>`, AND a comment with the same payloads — all render as literal text in the list card, the open panel, comment rows, the share panel, and confirm dialogs; no dialog fires anywhere; the share/comment notifications carry literal text.
19. Rapid-close race: open a note panel, hit back, immediately open another — no console errors from stale-panel lookups (all lookups are `panel.querySelector`).
20. Icons: with `localStorage['bi-dev']='1'`, navigating Notes and the new drawer logs no `[icon-integrity]` warnings (i.e. `sticky-note` etc. all hydrate).
21. Deep links unchanged: an old cash-advance notification (`page:'cash-advances'`) still opens the Cash Advance screen; My Finance → Cash Advances button does the same.
22. After commit: `APP_VERSION` was bumped by the hook, `CACHE_VER` matches it, and a hard-refreshed device shows the new version banner before any "it didn't work" debugging (memory: deploy delivery pipeline).
