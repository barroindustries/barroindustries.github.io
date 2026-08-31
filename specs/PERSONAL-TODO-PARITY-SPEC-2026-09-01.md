# Personal To-Do — board-parity upgrade (spec, 2026-09-01)

Owner ask: the Personal To-Do that shipped v14.0.251 (`js/screens/todo.js`, commit 9a4d29a)
is a plain text+done checklist. Neil's actual request was to port his **Barro Kitchens job
board** artifact into the app: tasks with **areas, rush flags, notes, sub-task checklists**,
plus a **one-time Import** of the tasks he already entered on the board (the board now has an
"Export tasks" button that copies its state JSON). This spec upgrades the shipped screen to
parity. Written by the planning session; implemented by an executor agent.

## Scope — files touched

| File | Change |
|---|---|
| `js/screens/todo.js` | Extend to areas/rush/notes/subs + import panel + backup-parent-doc fix + `--card-bg` token fix |
| `firestore.rules` | Widen the `personal_todos` items rule; add a parent-doc rule |
| `scripts/monthly-backup.js` | Add `'items'` to `KNOWN_SUBCOLLECTIONS` (around line 300 — read first) |
| `scripts/check-backup-coverage.js` | Add `'personal_todos'` to `BASELINE` (lines 42–67, keep alphabetical) |

**Nothing else.** NAV_REGISTRY entry, drawer-icon CSS, PAGE_SCRIPTS, sw.js PRECACHE, and the
`navigateTo` case all already exist for `personal-todo` — do not touch them. Do NOT edit
versions (hook-owned), do NOT commit, do NOT run `git stash`/`reset`/`checkout --`/`clean`
(live shared tree). If the Edit tool fails "modified since read" twice (OneDrive mtime race),
batch remaining edits via a python exact-match replace script.

## 1. Data model (Firestore)

Collection stays `personal_todos/{uid}/items/{itemId}`. Item doc fields:

| Field | Type | Rule |
|---|---|---|
| `text` | string | required, 1..500 (existing) |
| `done` | bool | existing |
| `createdAt` | ISO string | existing |
| `doneAt` | ISO string or `''` | existing |
| `updatedAt` | ISO string | existing |
| `cat` | string | NEW — one of `production, sales, design, purchasing, delivery, general`; absent = `general` |
| `rush` | bool | NEW — absent = false |
| `note` | string | NEW — 0..2000; absent = `''` |
| `subs` | array of `{id, text, done}` maps | NEW — max 60 entries; absent = `[]` |

Legacy docs (text/done/dates only) must keep working: normalize on load
(`cat:'general', rush:false, note:'', subs:[]` defaults in JS). Updates write the full
merged doc through rules fine since all fields are in the allowed set.

**Backup-gap fix (real defect):** the `{uid}` parent doc is never created, so
`monthly-backup.js`'s `db.collection('personal_todos').get()` returns zero docs and the
`items` subcollection is never walked — items are currently NOT backed up. Fix: in todo.js,
once per session before the first successful write (add/import), run
`db.collection('personal_todos').doc(currentUser.uid).set({ owner: currentUser.uid, createdAt: <ISO now> }, { merge: true })`
guarded by a module flag `_todoParentEnsured` (and `.catch(()=>{})` — a failure here must not
block the item write; clear the flag on failure so it retries).

## 2. firestore.rules — replace the whole personal_todos block

Replace lines 743–755 (the comment + `match /personal_todos/{uid}/items/{itemId}` block) with:

```
    // ── Personal To-Do (owner ruling 2026-09-01: president-only drawer entry,
    // "add as personal to-do") — same privacy stance as Notes: OWNER ALONE,
    // enforced here, keyed by uid. The president-only part is the NAV entry;
    // these rules are deliberately per-owner so opening the feature to staff
    // later is a UI change, not a rules change.
    // 2026-09-01 board parity: items carry area/rush/note/sub-steps (ported
    // from the Barro Kitchens job-board artifact). The {uid} parent doc
    // exists ONLY so monthly-backup's collection .get() surfaces the uid and
    // walks the items subcollection (missing parents are invisible to .get()).
    match /personal_todos/{uid} {
      allow read, delete: if isAuth() && request.auth.uid == uid;
      allow create, update: if isAuth() && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['owner','createdAt']);
    }
    match /personal_todos/{uid}/items/{itemId} {
      allow read, delete: if isAuth() && request.auth.uid == uid;
      allow create, update: if isAuth() && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(
             ['text','done','createdAt','doneAt','updatedAt','cat','rush','note','subs'])
        && request.resource.data.get('text', '') is string
        && request.resource.data.get('text', '').size() >= 1
        && request.resource.data.get('text', '').size() <= 500
        && request.resource.data.get('note', '') is string
        && request.resource.data.get('note', '').size() <= 2000
        && request.resource.data.get('cat', 'general') in
             ['production','sales','design','purchasing','delivery','general']
        && request.resource.data.get('subs', []) is list
        && request.resource.data.get('subs', []).size() <= 60;
    }
```

Use `.get(field, default)` exactly as written — a bare read of an absent field throws and
silently denies (documented repo footgun). Keep the block in the same file position.

## 3. js/screens/todo.js — UI contract

Keep the file's existing conventions: window-attached handlers called from inline
`onclick`/`onchange`/`onkeydown`/`oninput`, template-string HTML with **every** interpolation
through `escHtml()`, inline styles using CSS tokens, optimistic paint + rollback on write
failure, toasts via `window.Notifs?.showToast`. Keep the existing header comment and extend
it with the parity note. Keep existing function names working (`todoAdd`, `todoToggle`,
`todoDelete`, `todoClearDone`).

### Constants

```js
const TODO_CATS = {
  production: { label: 'Production', c: '#7FA0C4' },
  sales:      { label: 'Sales',      c: '#3FB9A5' },
  design:     { label: 'Design',     c: '#A78BE8' },
  purchasing: { label: 'Purchasing', c: '#D0A03C' },
  delivery:   { label: 'Delivery',   c: '#DD8AB5' },
  general:    { label: 'General',    c: '#93A0B0' }
};
```
(Mid-saturation hexes chosen to read on dark, light, and astral grounds. Tag chip style:
`background: color-mix(in srgb, <c> 16%, transparent); color: <c>;` with a plain
`border:1px solid color-mix(in srgb, <c> 35%, transparent)`.)

### State

`_todoItems` as now (normalized per §1), plus module-level:
`_todoFilter = 'all'` (area filter), `_todoExpanded = {}` (id → true, per-view),
`_todoNoteTimers = {}` (id → timeout), `_todoParentEnsured = false`,
`_todoImportOpen = false`.

### Layout (max-width 640 wrapper, as now)

1. **Header row**: `✅ My To-Do` h2 + subtitle (keep both) + right-aligned open-count
   (`<n> open`, `font-variant-numeric:tabular-nums`, muted) + a small text-link button
   `⇪ Import` (`todoImportToggle()`).
2. **Import panel** (hidden unless `_todoImportOpen`): a card with one short line —
   "Paste the JSON from the board's **Export tasks** button, then Import. Items are added
   as new (running it twice duplicates)." — a `<textarea id="todoImportBox">`
   (mono font, ~90px), and buttons `Import` (`todoImportRun()`, btn-primary btn-sm) and
   `Cancel` (`todoImportToggle()`).
3. **Add bar**: text input (as now, Enter adds, maxlength 500) + `<select id="todoNewCat">`
   with the 6 areas (default General, keep the last-used selection across paints via a
   module var) + Add button. Fix the shipped bug: input background must be
   `var(--surface)` — `--card-bg` does not exist in tokens.css.
4. **Area chips**: use `window.chipTabs(items, activeKey)` + `bindChipTabs` (config.js
   helpers — the sanctioned pattern) with `all` + the 6 areas; `count` = OPEN items per
   area (omit count when 0). On select: set `_todoFilter`, repaint. Re-bind after every
   paint (bindChipTabs is safe to re-call).
5. **Open list** (filtered by `_todoFilter`): sort rush-first, then `createdAt` DESC
   (newest on top — board parity; the shipped ASC order changes deliberately).
6. **Done section** (filtered too): header `Done (n)` + `Clear completed` (keep), rows
   sorted `doneAt` DESC.
7. Empty states: keep the current friendly lines; when a filter hides everything, say
   `Nothing in <Area> — switch chips or add above.`

### Task row

Keep the card row (checkbox → body → controls) and add:

- **Rush stripe**: when `rush && !done`, card gets `box-shadow: inset 3px 0 0 var(--warning)`.
- **Body** (click → `todoExpand('<id>')`, `cursor:pointer`): text line (strike when done, as
  now), then a meta line: area tag chip, short date (`createdAt`, or `doneAt` when done —
  `en-PH`, `{month:'short', day:'numeric'}`), a 📝 marker when `note` non-empty, a
  `k/n` sub-step counter when `subs.length` (muted; `var(--success)` when k===n), and a
  chevron `▾` (rotated when expanded).
- **RUSH toggle** (open items only): small bordered pill button `RUSH`
  (`todoRush('<id>')`); active = filled `var(--warning)` with dark text.
- **Delete ✕**: keep.

### Expanded detail (rendered when `_todoExpanded[id]`, indented under the checkbox)

- **Note**: `<textarea>` (placeholder "Notes — measurements, client details, blockers…",
  maxlength 2000, `oninput="todoNoteInput('<id>', this)"`). Handler: update
  `it.note` immediately, then debounce 800 ms per id (`_todoNoteTimers`) before
  `.update({ note, updatedAt })`. NO repaint on keystroke (focus must survive). Rollback
  toast on failure. Auto-grow: set `style.height` from `scrollHeight` on input and after
  paint.
- **Steps**: list of subs — small checkbox (`todoSubToggle('<id>','<subId>')`),
  text (strike when done), ✕ (`todoSubDelete('<id>','<subId>')`). Below: input
  (placeholder "Add a step", maxlength 200, Enter → `todoSubAdd('<id>')`, id
  `todoSubNew-<id>`) + small Add button. After adding, repaint and re-focus that item's
  step input. Every sub mutation writes the whole `subs` array + `updatedAt` (optimistic,
  rollback on failure). Cap: refuse (toast) beyond 60 steps.
- Marking the parent done clears `rush` (board behaviour) — keep sub states untouched.

### Import (`todoImportRun`)

Accepts the board's export JSON: `{"v":2,"updated":<ms>,"tasks":[{id,text,cat,rush,done,created:<ms>,doneAt:<ms|null>,note,subs:[{id,text,done}]}]}`.
Also accept a bare array of tasks. Mapping per task →
`{ text: String(text).trim().slice(0,500), done: !!done, cat: (cat in TODO_CATS ? cat : 'general'), rush: !!rush, note: String(note||'').slice(0,2000), subs: (Array.isArray(subs)?subs:[]).slice(0,60).map(s=>({id:String(s.id||Math.random().toString(36).slice(2)),text:String(s.text||'').slice(0,200),done:!!s.done})), createdAt: new Date(created||Date.now()).toISOString(), doneAt: (done && doneAt) ? new Date(doneAt).toISOString() : '', updatedAt: <ISO now> }`.
Skip tasks with empty text. Ensure the parent doc (§1) first. Write with a Firestore
`db.batch()` (`_todoCol().doc()` refs; the board holds far fewer than 500 — if >450,
chunk into multiple batches). On success: toast `Imported <n> tasks`, close the panel,
re-fetch via `renderPersonalTodo()`. On parse failure: toast
`Couldn't read that — paste the exact Export text from the board.` and leave the panel open.

## 4. scripts

- `scripts/monthly-backup.js`: find `KNOWN_SUBCOLLECTIONS` (~line 300); add `'items'` the
  way existing entries are written (read the structure first — it may be a per-collection
  map or a flat list; follow it).
- `scripts/check-backup-coverage.js`: add `'personal_todos'` to `BASELINE` alphabetically.

## 5. Verification (executor runs, reports honestly)

1. `node --check js/screens/todo.js` (and any other edited JS).
2. `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js` — all three must pass.
3. Confirm every `onclick`/`onchange`/`oninput` name in the rendered HTML is
   `window.`-attached in the file (check-ui-wiring does NOT scan js/screens/).
4. Confirm every interpolation into HTML goes through `escHtml` (note/subs text included)
   and that ids injected into inline handlers are escHtml'd as the shipped code does.
5. Do NOT deploy rules, do NOT commit/push — the reviewing session does that
   (rules deploy happens BEFORE the code push).

Report: files changed, gate output summary, anything ambiguous you had to decide.
