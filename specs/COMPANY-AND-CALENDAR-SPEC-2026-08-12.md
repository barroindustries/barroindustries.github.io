# COMPANY PAGE + UNIFIED CALENDAR — IMPLEMENTATION SPEC (2026-08-12)

Self-contained spec for an implementer who has NOT seen the originating conversation.
Three employee-facing pieces of work:

- **PART 1** — the Company page gains a "How We're Doing" (company health) section and a
  "What We're Working On" (projects) section. Owner, verbatim: *"under company, add the
  projects of the company and the health so everyone knows how we are doing"*.
  **Money ruling (owner, 2026-08-12, verbatim):** *"no dont show the money, show it at
  end of the year, where everyone can see how the company did that year and how they
  played a role in it"* → the year-round page carries **no peso figures for anyone**.
  **Second ruling, same day, after being shown the API-level exposure and offered a
  schema split (verbatim):** *"Nvm, just show comapny health, only percentages"* → the
  health section is **percentages only** (§1.4), and the schema split is **declined**
  (§1.2).
- **PART 1B** — a **Year in Review**: a President-published, once-a-year record where
  every employee sees the year's real figures (money included, deliberately) plus a
  personal "your part in it" panel built only from the viewer's own data.
- **PART 2** — one calendar data source feeding BOTH the dashboard mini calendar and the
  drawer Calendar page. Owner, verbatim: *"calendar should show the holidays, the deadlines
  etc etc"*, and earlier: *"the calendar on the dashboard, is the calendar on the drawer.
  the one on the drawer is just more detailed"* — which is NOT true today and is treated
  here as a live defect (details in §2.1).

**Anchor by FUNCTION NAME everywhere. Never by line number** — js/screens/dashboards.js,
js/config.js, js/screens/people.js and css/styles.css were all edited the day this spec
was written, and multiple agents edit this tree live.

---

## 0. Repo ground rules (bind on every edit in this spec)

1. Vanilla JS, classic `<script defer>` files, `window.*` globals, no build step.
   `var`/`function` at file scope — a new file wraps its internals in an IIFE
   (`;(function(){ 'use strict'; ... })();`), where `const`/`let` are fine (see
   js/meetings.js for the house pattern).
2. **Never** run `git stash`, `git reset --hard`, `git checkout -- <file>`, or `git clean`.
3. `CACHE_VER` in sw.js is derived from `APP_VERSION` and the pre-commit hook bumps it —
   do not hand-edit versions.
4. A NEW js file must be added in BOTH index.html (script tag, order matters — see §2.5)
   and the `PRECACHE` list in sw.js.
5. `escHtml()` on ALL user-originated content before it enters `innerHTML`
   (task titles, meeting titles, client names, bid titles, leave types — all of it).
6. Panel-scoped DOM lookups (`panel.querySelector`), never bare `document.getElementById`
   inside page renderers that can be torn down (`#mini-cal` lookup at the top of
   `renderMiniCal` is the existing pattern and stays).
7. Manila time via `window.bizDate()` / `window.bizDow()` — never raw `toISOString()`
   for day logic.
8. Forbidden words in ANY user-visible string: compute, verify, disburse, delta,
   reconciliation, draft, run, Type A, Type B.
9. Mobile 375 px: no horizontal scroll, no truncated text. Wide content scrolls inside
   its own container.
10. This spec adds **no new drawer entry**, therefore no new
    `.nav-item[data-page="…"] .nav-icon` gradient is needed and
    `scripts/ci-invariants.sh` check 6/6 is unaffected. If you deviate and add a nav
    entry, you MUST add the gradient in css/styles.css or CI fails the build.
11. `firestore.rules` reminders that apply if you touch rules (Part 1 needs **no** rules
    change — §1.7): rules do NOT cascade to subcollections, do NOT match by prefix, and
    reading an ABSENT field throws and denies — always `.get(field, default)`.

---

# PART 1 — Company page: projects + company health

## 1.1 What exists today

- Route: `navigateTo('company')` → `case 'company': renderCompany(); break;` in
  js/app.js. **The route itself has no role gate.**
- `renderCompany()` (js/screens/dashboards.js) renders chip tabs
  `overview / memos / policies / downloads / handbook / bi-ops` and calls
  `renderCompanyOverview(ct, canAdd)` for the Overview tab.
- `renderCompanyOverview(ct, canAdd)` (same file) currently renders, in order:
  Hero banner → "About the Company" → "Our Brand" → "Where We're Headed" →
  "Message from the President" → "Our Core Values". It performs exactly one Firestore
  read (president's users doc by role).
- Who reaches the page: the `admin` and `staff` drawer variants in
  `window.NAV_REGISTRY` (js/config.js) both carry `{ key:'company', page:'company' }`.
  **No partner variant** (`partnerBS`, `genericPartner`, `bsOnly`) has it. A partner can
  still deep-link (the route is ungated) — the new sections must degrade to hidden, never
  crash (§1.6).
- Project data: `job_projects` collection, created by `createJobProject(d)`
  (js/screens/production.js). Relevant fields per doc:
  `projectNo, company ('BS'|…), name ("Client — Qno"), clientName, stage, quoteNumber,
  contractAmount, amountCollected, arBalance, targetDate (ISO date|null), priority,
  items[], createdAt, updatedAt, createdBy, partnerUid, split, timeline[]`.
  Stages come from `JOB_STAGES` (same file):
  `won, in_design, in_production, for_delivery, delivered, completed, paid, cancelled` —
  each with label, emoji icon and color.
- Money-privacy precedent: `isProductionOnlyViewer()` (js/screens/production.js) — the
  shipped owner ruling that Production-dept staff see WHAT to build (name, items, stage,
  target date, priority) but never `contractAmount/arBalance/amountCollected/margin`.
  The finance tier there is `_isFinAdmin()` =
  `['president','owner','manager','finance'].includes(window.currentRole) ||
  (window.currentDepts||[]).includes('Finance')`.

## 1.2 The money ruling — REQUIREMENT, not a decision

The owner has ruled (2026-08-12): *"no dont show the money, show it at end of the year,
where everyone can see how the company did that year and how they played a role in it."*

Therefore, **requirements**:

- The year-round Company page shows **NO peso figures to anyone** — no contract values,
  no collections, no receivables, no margins, no revenue. There is **no finance-tier
  money row** on this page. Finance/admin see their money on the screens they already
  have (Finance, Projects, Analytics); this page is not a new door to any of it, and
  nothing is widened for them here either.
- The one deliberate place an ordinary employee sees company money is the
  **Year in Review** (PART 1B), and only after the President publishes it.

**RULED (2026-08-12) — schema split DECLINED, knowingly.** The owner was shown that the
current Firestore rule for `job_projects` (`match /job_projects/{docId}`):

```
allow read: if isAuth() && (resource.data.createdBy == request.auth.uid
                            || resource.data.partnerUid == request.auth.uid
                            || !isPartner());
```

lets every signed-in non-partner read the full doc — including `contractAmount`,
`amountCollected`, `arBalance` — at the API level (Firestore rules are per-document,
not per-field), and he was offered a finance-only schema split to close it. His answer:
*"Nvm, just show comapny health, only percentages."* The split is therefore declined —
**do not implement it, and do not re-raise it as open work.**

**Fact for future readers (state once, act never):** the money fields on `job_projects`
remain readable via the API by any employee; this page's money-free presentation is a
UI convention, consistent with the shipped `isProductionOnlyViewer` precedent, **not an
enforced boundary**. Do not cite this page as proof that staff cannot see those figures.

## 1.3 Placement and structure

Extend `renderCompanyOverview(ct, canAdd)` in js/screens/dashboards.js. Do NOT add a new
page or a new chip tab. Insert two new sections **between "About the Company" and
"Our Brand"**, in this order:

1. `<div class="co-section">` — **"How We're Doing"** (health tiles)
2. `<div class="co-section">` — **"What We're Working On"** (projects list)

Both sections render a skeleton/placeholder immediately and fill in asynchronously, so
the page's existing static content never waits on Firestore. Structure inside
`renderCompanyOverview`: after setting `ct.innerHTML` (which now includes two empty
host divs `<div id="co-health-host"></div>` and `<div id="co-projects-host"></div>`
inside their sections), call a new file-local helper
`_fillCompanyHealth(ct)` — one helper, both hosts, one data load. Scope all lookups to
`ct` (`ct.querySelector('#co-health-host')`), never `document.getElementById`.

## 1.4 Data, tiles, and exact copy

### Reads (total: 2 collection reads, both cached)
```js
const projSnap  = await dbCachedGet('job_projects',
                    () => db.collection('job_projects').get(), 300000);   // 5 min TTL
const usersSnap = await dbCachedGet('users',
                    () => db.collection('users').get(), 60000);           // 60 s TTL
```
Notes:
- The `'users'` key is force-routed through `fetchUsersWithPayroll` inside `dbCachedGet`
  (js/config.js) — non-admins get `payrollDenied` and NO pay data. That is fine; this
  section reads only headcount, never `u.salary`.
- The `'job_projects'` key is deliberately shared with Part 2's delivery-date source
  (§2.3.7) so the two features cost one read between them within the TTL.
- Wrap each in its own try/catch. A denied/failed `job_projects` read (e.g. a
  deep-linking partner, offline) hides BOTH new sections entirely — the page shows its
  existing content and nothing broken. A failed `users` read hides only the
  "Team members" tile.

### Definitions (all client-side, Manila month via `bizDate()`)
- `active` = `stage` NOT in `['completed','paid','cancelled']`.
- `inProduction` = `stage` in `['in_production','for_delivery']`.
- `onSchedule` = among ACTIVE projects that have a `targetDate`, those with
  `targetDate >= bizDate()` (ISO string compare). Denominator `withTarget` = active
  projects that have a `targetDate` at all.
- `newThisMonth` / `newPrior3Avg` = projects bucketed by the Manila `YYYY-MM` of
  `createdAt` (Timestamp → `createdAt.toDate().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})`,
  then slice to `YYYY-MM`): the current month's count, and the mean of the three prior
  months' counts. A project is created exactly when a quote is won (`createJobProject`),
  so this doubles as deal momentum without scanning any quotes collections.
- `finished` = `stage` in `['completed','paid']`; `takenOn` = all docs with
  `stage !== 'cancelled'`. Do NOT attempt an on-time-delivery rate: `job_projects` has
  no completion/delivery timestamp, and inventing one from `updatedAt` would lie.
  (Optional later enhancement, NOT in this spec: stamp `completedAt` on the stage change
  and add the rate then.)
- `teamSize` = count of users docs excluding `role === 'partner'`. Before shipping,
  check the Team directory renderer (`renderTeamDirectory`, js/screens/people.js /
  modules.js) for any additional exclusion it applies (e.g. a disabled/inactive flag)
  and mirror it exactly, so the two screens never disagree on headcount.

### "How We're Doing" — PERCENTAGES ONLY (owner ruling §1.2, every viewer)
Header: `How We're Doing`
Sub-line: `A live look at the company's momentum, straight from the projects board.`
Stat tiles in a responsive grid (2 columns at 375 px,
`repeat(auto-fit,minmax(150px,1fr))` above; reuse the `co-value-card` / stat-tile look
already on this page — no new layout system):

| Tile label (exact copy) | Value | Form | Small-sample guard |
|---|---|---|---|
| `On schedule` | `round(onSchedule / withTarget × 100)` + `%`, sub-caption `of projects with a target date` | percentage | omit tile when `withTarget < 3` |
| `In production` | `round(inProduction / active × 100)` + `%`, sub-caption `of what's on the board` | percentage | omit when `active < 3` |
| `Seen through` | `round(finished / takenOn × 100)` + `%`, sub-caption `of everything we've taken on` | percentage | omit when `takenOn < 5` |
| `Momentum` | `±N%` = `round((newThisMonth − newPrior3Avg) / newPrior3Avg × 100)`, sub-caption `new projects vs recent months` | percentage | omit when `newPrior3Avg < 1` |
| `Team members` | `teamSize` | **count — justified absolute** | always shown |

- **Why `Team members` stays a count:** headcount is not money and cannot be turned into
  money by any figure on this page; the full roster is already visible to every staffer
  on the Team page, so the number discloses nothing new; and a headcount "rate" would be
  meaningless without stored history. This is the ONLY absolute in the tile set.
- If the small-sample guards leave fewer than 2 tiles (young board), replace the whole
  tile grid with one muted line: `Not enough on the board yet to show trends — check back soon.`
  plus the `Team members` tile. Never render a lonely `0%` / `100%` wall.

**Reconstruction audit (checked as a SET, not tile by tile — re-run this reasoning if
you change any tile):** no tile is a peso amount and no tile is a percentage OF a peso
amount, so no combination of tiles can reconstruct a peso figure. The absolutes visible
anywhere on the page are `teamSize` (public roster) and the projects list's implicit
active count (§ below, `…and N more on the board`) — both are volume/headcount, and with
zero money-based percentages on the page there is nothing to multiply them against.
**Standing rule for future edits: never add a percentage whose base is a peso amount**
(e.g. "collected X% of contract value") — that single tile would let any visible count
or future absolute leak totals.

No peso sign appears anywhere in this block, **for any role** — the owner's ruling
(§1.2). There is no finance-tier money row; do not build one behind a gate "for later".
No forbidden vocabulary (§0.8) — the labels above are the approved copy; do not
improvise synonyms.

### "What We're Working On" — projects list (everyone)
Header: `What We're Working On`
Content: the active projects, sorted `createdAt` desc, first **6** shown, then
`…and N more on the board` as a muted line if more exist. Each row (a slim card or list
row, mobile-first single column):
- Project name — `escHtml(p.name)` (contains the client name; showing it matches the
  shipped production handoff, where Production-only viewers see the project name).
  → **OWNER DECISION D3** only if he objects to client names being company-visible;
  default is SHOW.
- Stage badge — label + color from `JOB_STAGES` via `jobStage(p.stage)`. `JOB_STAGES` is
  file-local to production.js; production.js and dashboards.js are both classic scripts,
  and top-level `const` in production.js means `JOB_STAGES` is NOT on `window`.
  **Check first**: if it is not reachable from dashboards.js at runtime, expose it once as
  `window.JOB_STAGES = JOB_STAGES;` next to its definition in production.js rather than
  duplicating the table.
- `Target: {targetDate}` (only when set; render the ISO date via
  `new Date(...).toLocaleDateString('en-PH')`).
- NO amounts, NO quote numbers beyond what `name` already carries, NO margins — for any
  viewer. Per-project money stays on the Projects screen for those who have it.
- If the viewer passes `hasProjectsDept` (the existing NAV_REGISTRY predicate — see
  `NAV_REGISTRY.predicates` in js/config.js) OR is president/manager/secretary, add one
  footer link: `Open the projects board →` → `navigateTo('projects-lifecycle')`.
  Everyone else gets no link (the target page would be a dead end for them).

### Empty states (never blank, never broken)
- `job_projects` read OK but zero docs: the small-sample guards (§ above) collapse the
  tile grid to the `Not enough on the board yet…` line + `Team members`; the projects
  section shows an `empty-state` block: icon 📋, `Nothing on the board yet`, sub-line
  `New projects appear here the moment a deal is won.`
- `job_projects` read failed/denied: both sections removed from the DOM (the two host
  divs stay empty and their `.co-section` wrappers are hidden via
  `host.closest('.co-section').style.display='none'`). No error banner on this page —
  it is a brochure page and a partner deep-link is the only realistic denial.
- `users` read failed: `Team members` tile omitted; grid reflows.

## 1.5 Permission matrix (Part 1 — year-round Company page)

| Viewer | Company nav entry | Health tiles | Projects list | Any peso figure |
|---|---|---|---|---|
| President | yes (admin drawer) | yes | yes + board link | **no** (owner ruling §1.2) |
| Manager | yes | yes | yes + board link | **no** |
| Corporate Secretary | yes | yes | yes + board link | **no** |
| Finance role / Finance-dept member | yes (staff drawer) | yes | yes (+link if `hasProjectsDept`) | **no** |
| Employee / Agent / Worker | yes (staff drawer) | yes | yes, no link unless `hasProjectsDept` | **no** |
| Partner (any) | no nav; deep-link only | hidden (read denied) | hidden (read denied) | no |

(The Year in Review — PART 1B — is the separate, deliberate money surface; its own
matrix is in §1B.6.)

## 1.6 Partner deep-link behaviour (must-hold)

A partner navigating to `#company` by hand gets the existing page exactly as today, with
the two new sections absent (their `job_projects` LIST query is denied wholesale — rules
are not filters — and the try/catch hides the sections). Verify this path explicitly
(checklist §4).

## 1.7 firestore.rules / indexes for Part 1

**No changes.** Checked: `match /job_projects/{docId}` already grants read to all
internal staff via the `!isPartner()` disjunct (block quoted in §1.2); `match /users/{uid}`
read paths are already exercised by the Team page via the same cached key. The
`.collection('job_projects').get()` full read needs no composite index. Do not deploy
rules for this work; if you find yourself editing firestore.rules for Part 1, stop —
you have diverged from the spec. (PART 1B **does** add one rules block — §1B.7 — that is
the only rules change in this entire spec.)

---

# PART 1B — Year in Review (President-published, money included, everyone sees it)

Owner's brief, verbatim: *"show it at end of the year, where everyone can see how the
company did that year and how they played a role in it."* Two halves on one screen:
**how the company did** (the year's real figures — the ONE place ordinary employees see
company money, deliberately) and **your part in it** (personalised to the viewer, own
data only).

> **⚠ SCOPE READING — FLAG FOR THE OWNER:** his "only percentages" ruling (2026-08-12)
> is read as governing the year-round Company page he was being asked about at the time,
> NOT this annual review — where his earlier same-day ruling ("show it at end of the
> year, where everyone can see how the company did") stands and real figures appear.
> If he meant percentages here too, he should say so — Half 1's peso/count tiles would
> then become rates, and nothing else in Part 1B changes.

## 1B.1 Publication is a deliberate act, not a date

Nothing appears automatically on 1 January. A year's review exists ONLY after the
President performs an explicit publish step that stores the figures into a record and
thereby makes them visible. Reasons (bind on the design): the figures must be final (a
year's books close after the year does); the President may want to read exactly what
everyone is about to read before they read it; and a screen that silently starts showing
company revenue because a clock ticked over is a disclosure that must never happen by
accident. **Before publication, employees see only the not-yet-published empty state
(§1B.8) — no live figures, no previews, nothing derived on the fly.**

## 1B.2 Where it lives

A new chip tab on the existing Company page — NOT a drawer entry (so ci-invariants
check 6/6 is untouched and no icon gradient is needed). In `renderCompany()`
(js/screens/dashboards.js), extend the `chipTabs` array with
`{key:'year', label:'Year in Review'}` between `overview` and `memos`, and add
`else if (tab==='year') renderCompanyYearReview(ct);` to `switchCompanyTab`.
`renderCompanyYearReview` is a new function in js/screens/dashboards.js next to the
other `renderCompany*` renderers. No new file.

## 1B.3 Stored record — collection `company_year_review/{year}`

Doc id = the 4-digit year string (`'2026'`). Created ONLY by the publish step. Shape:

```js
{
  year: 2026,                                // number, matches the doc id
  publishedAt: <serverTimestamp>,
  publishedBy: <uid>, publishedByName: '…',
  updatedAt: <serverTimestamp>,              // set on every correction
  headline: {                                // President-confirmed figures. null = omit tile.
    revenue: 12345678,                       // ₱ — contract value of deals won in the year
    projectsFinished: 12,
    projectsStarted: 18,
    clientsServed: 15,                       // distinct clients in the year's projects
    quotesWon: 18,
    teamSize: 22                             // headcount at year end
  },
  prior: { revenue: null, projectsFinished: null },  // last year's, for the growth line
  note: ''                                   // optional President's message for the year
}
```

- **A doc's existence IS publication.** There is no `status` field, no unpublished
  stored state (also keeps the forbidden-vocabulary rule trivially satisfied). To take a
  year down, the President deletes the doc. To correct it, the President re-opens the
  publish form (prefilled from the stored doc) and saves — `updatedAt` moves.
- **Individual pay data is BANNED from this record and this screen.** No salary, rate,
  payslip, allowance or deduction figure — anyone's — may appear in the doc shape, the
  publish form, or any render path. "How the company did" is not "what everyone earns".
  This is a hard boundary, not a default.
- Profit/margin fields are deliberately absent → **OWNER DECISION D11** (§3).

## 1B.4 Publish flow (President only)

On the Year in Review tab, `isPresident()` viewers see a `Publish {Y}` button (where
`Y` = last calendar year if unpublished, plus a year picker able to select any year —
he may backfill older years or, in December, choose the current year; the form is his,
the app only prefills). Clicking opens an `openPage` panel:

1. **Prefill** every `headline` field from app data so he edits rather than types from
   scratch — all client-side from the same cached reads Part 1 uses:
   - `revenue` = Σ `contractAmount` of `job_projects` with `createdAt` in year Y
     (a project is created exactly when a deal is won — `createJobProject`).
   - `projectsStarted` / `quotesWon` = count of those same docs.
   - `projectsFinished` = count with `stage` in `['completed','paid']` — **label the
     prefill clearly as an estimate** (`job_projects` has no completion timestamp; the
     count is "finished as of today", not "finished during Y"). The President corrects
     it; that is the point of the form.
   - `clientsServed` = distinct `clientId || clientName` over year-Y projects.
   - `teamSize` = the §1.4 headcount.
   - `prior` = auto-copied from `company_year_review/{Y-1}` if published, else blank
     fields he may fill by hand or leave null.
2. Every field is editable; any field cleared to blank stores `null` and renders no tile.
3. A live **preview** inside the panel renders the exact employee view (§1B.5 company
   half) from the form values before he commits.
4. Footer buttons: `Publish` (create/update the doc), `Cancel`. On an already-published
   year the panel opens prefilled from the STORED doc (not recomputed), and the footer
   gains `Take down` (deletes the doc after a confirm dialog:
   `Take down the {Y} Year in Review? Employees will no longer see it.`).
5. After any write: `dbCacheInvalidate('year-review')` and re-render the tab.

## 1B.5 What the screen shows (published year)

Default view = the most recent published year; if several years are published, a small
chip row of years (newest first) switches between them — the archive is simply every
published doc, readable by all staff.

**Half 1 — "How the company did"** (identical for every viewer):
- Big header: `{Y} — Year in Review`, sub-line `Published {date}` (from `publishedAt`).
- If `note` non-empty: the President's message card (escHtml, multi-line preserved).
- Stat tiles from `headline`, skipping nulls. Exact labels:
  `Revenue` (fmt ₱) · `Projects finished` · `Projects started` · `Clients served` ·
  `Quotes won` · `Team members`.
- Growth line when `prior.revenue` is non-null and > 0:
  `{±N}% vs {Y-1}` rendered under the Revenue tile (green up / red down, computed
  client-side, one decimal). Same pattern for `projectsFinished` when present.

**Half 2 — "Your part in it"** (personalised; ONLY the signed-in viewer's own data;
one person must never see another's panel — enforced by construction, because every
query below is scoped to `currentUser.uid` and no other user's panel is ever fetched or
rendered):
- Gated on the year being published — computed live at view time from the viewer's own
  records (no per-person snapshot fan-out; the publish act gates visibility, and own
  activity data is not something the President needs to pre-review).
- Header: `Your part in {Y}`. Tiles (each omitted, never zero-faked, when its source
  field doesn't exist — verify field names before shipping, listed per tile):
  - `Tasks finished` — the viewer's tasks (`assignedTo array-contains uid` — reuse the
    cached `tasks-cal-{uid}` snapshot, §2.6) with a done-ish status in year Y. Verify in
    js/screens/tasks.js which timestamp the done-marking code stamps (e.g. a
    completed/approved timestamp) and use it; if none exists, fall back to counting
    done/approved tasks whose `dueDate` falls in Y and keep the label `Tasks finished`.
  - `Deals you brought in` — `job_projects` with `createdBy == uid` and `createdAt` in Y
    (shared `'job_projects'` cache key). Shown only when count > 0 (sales-shaped metric;
    a zero would read as a reproach to non-sales staff).
  - `Projects you're on` — year-Y projects where the viewer appears in the doc's
    `timeline[].by` or `createdByName` matches their display name is NOT reliable —
    **skip this tile entirely unless a solid membership field exists**; check
    `job_projects` docs for any assignee/team field before attempting it. If nothing
    solid exists, omit (do not fuzzy-match names).
  - `Days present` — the viewer's own attendance records in Y. Verify the attendance
    collection name and per-user doc/field shape in `renderAttendancePage`
    (js/screens/people.js) and query own docs only; cache
    `dbCachedGet('yr-att-'+uid+'-'+Y, …, 300000)`. Omit the tile if own-year attendance
    is not cheaply queryable (a full-collection scan is NOT acceptable here).
  - `With the company since` — the viewer's own users/profile doc, only if a hire/start
    date field exists (verify on the users doc shape / `renderMyProfile`); renders as
    `Since {Month Year}` rather than a count.
- Footer line under the panel, exact copy:
  `These are your own numbers — every teammate sees their own here, next to the same company figures.`
- **No money in Half 2** for ordinary staff: `Deals you brought in` is a COUNT, never a
  peso sum. (The deal-value sum stays on the screens that already carry money.)

## 1B.6 Permission matrix (Part 1B)

| Viewer | See published years (Half 1, incl. Revenue) | Half 2 (own panel) | Publish / correct / take down |
|---|---|---|---|
| President | yes | yes (his own) | **yes — only role** |
| Manager / Secretary | yes | yes (own) | no |
| Finance role / dept | yes | yes (own) | no |
| Employee / Agent / Worker | yes | yes (own) | no |
| Partner (any) | **no** (rules-denied; internal disclosure) | no | no |

## 1B.7 firestore.rules — the ONE rules change in this spec

Add an explicit block (rules do not cascade and do not match by prefix — this is a new
top-level collection and must be enumerated):

```
    // ── Year in Review (owner ruling 2026-08-12: end-of-year figures every
    // employee may see; money included ON PURPOSE — this doc, once published,
    // is the deliberate disclosure). A doc's existence IS publication: it is
    // created only by the President's publish step, so read may be blanket
    // internal. Employees must NEVER be able to write it. Partner excluded —
    // internal disclosure. NO per-person pay data may ever be added to this
    // doc shape (see COMPANY-AND-CALENDAR-SPEC-2026-08-12.md §1B.3).
    match /company_year_review/{year} {
      allow read:   if isAuth() && !isPartner();
      allow create, update, delete: if isAuth() && isPresident();
    }
```

Deploy with `~/.npm-global/bin/firebase deploy --only firestore:rules` (the CLI is not
on PATH; `git push` does NOT deploy rules). Per the repo's live-tree rule: re-run
`git diff firestore.rules` immediately before deploying so a full-file deploy doesn't
ship another session's uncommitted rules edits. No `firestore.indexes.json` change:
reads are `get`-by-id and a tiny full-collection `list`; the per-user year queries in
§1B.5 are equality/array-contains shapes already exercised elsewhere (verify the
attendance query shape when you confirm its collection; if it needs a range on a date
field plus an equality on uid, THAT would need a composite index — add it to
firestore.indexes.json in the same commit and deploy `--only firestore` if so).

## 1B.8 Empty states, copy, and cost

- Year in Review tab, nothing published yet (what every employee sees):
  empty-state block — icon 🎖, header `The Year in Review isn't out yet`, sub-line
  `When the year closes, the President publishes how the company did — and you'll see
  your own part in it right here.` For `isPresident()` the same state additionally
  shows the `Publish {Y}` button.
- Partner deep-link to the tab: the read is rules-denied → render the SAME
  not-yet-published empty state (never an error banner on this page, and never a hint
  that published data exists).
- A published year whose `headline` fields are all null (President cleared everything):
  render the note (if any) + Half 2; if there is truly nothing, show the empty state —
  never a row of dashes.
- Cost: tab open = 1 cached collection read
  (`dbCachedGet('year-review', () => db.collection('company_year_review').get(), 300000)`
  — the collection holds one doc per published year, single digits for a decade), plus
  Half 2's own-data reads which reuse the `tasks-cal-{uid}` and `job_projects` cache
  keys (§2.6) and one own-attendance query. No fan-out.

---

# PART 2 — one calendar source for both surfaces

## 2.1 The defect being fixed (verified in code)

- `renderMiniCal()` (js/screens/dashboards.js) — the dashboard widget hosted by
  `renderPresidentDashboard()` and `renderEmployeeDashboard()` (both same file, each
  renders a `<div class="card-body" id="mini-cal">`). It queries **only** the `tasks`
  collection (`assignedTo array-contains uid`, open tasks with a `dueDate`, cached under
  key `tasks-cal-{uid}` for 30 s) and paints one undifferentiated dot per day.
- `window.renderCalendarPage` (js/meetings.js) — the drawer page paints **only** from
  `window.Meetings.loadMonth(monthKey)`: meetings (scoped) plus follow-up dates.

They are DISJOINT: a meeting produces no dot on the dashboard; a task deadline appears
nowhere on the drawer calendar. The owner believes one is the detailed view of the other.
After this work, that belief becomes true: **both surfaces render from one reader**.

## 2.2 The reader — `window.CalendarFeed`

**New file: `js/calendar-feed.js`** (see §2.5 for wiring). One IIFE exposing:

```js
window.CalendarFeed = {
  loadMonth(mk)     // mk = 'YYYY-MM' → Promise<MonthFeed>
  invalidate(kind?) // drop cached inputs; kind ∈ {'meetings','tasks','leave', undefined=all}
};
```

Return shape:

```js
MonthFeed = {
  monthKey: 'YYYY-MM',
  days: {                       // ONLY days that have entries appear as keys
    'YYYY-MM-DD': [ Entry, … ]  // sorted: holiday first, then timed entries by time,
  },                            //   then untimed (task due, leave, bidding, delivery)
  denied: { meetings:false, tasks:false, leave:false,
            biddings:false, deliveries:false }   // true = read failed by permission/error
};

Entry = {
  kind:  'holiday'|'meeting'|'followup'|'task'|'leave'|'bidding'|'delivery',
  date:  'YYYY-MM-DD',
  title: '…',            // PLAIN TEXT — renderers must escHtml() it
  time:  'HH:mm'|null,   // meetings only (Manila); everything else null
  id:    docId|null,     // holiday: null
  raw:   originalDocData|null   // meetings carry the full doc so the drawer page keeps
};                              //   RSVP/open behaviour; others may carry their doc
```

`loadMonth` fires all sources via `Promise.allSettled` — every source soft-fails
independently into the `denied` map; a broken source never blanks the calendar.
All date bucketing uses the Manila helpers already exported on `window.Meetings._h`
(`ymd/dayOf/monthStartIso/monthEndIso/monthKey`) — js/meetings.js loads before
js/calendar-feed.js (§2.5), so `H = () => window.Meetings._h` is safe at call time.

### 2.3 Sources — what is on the calendar, what is not, and why

Every candidate the app has is listed. Nothing silently omitted.

**IN:**

1. **PH holidays** — `getPHHolidays(year)` (js/screens/people.js — confirmed location;
   returns `{ 'YYYY-MM-DD': {name, type:'regular'|'special'} }`, already merged with the
   admin overrides prefetched into `window._holidayOverrides` from `settings_holidays/{year}`,
   whose rule is `allow read: if isAuth()` — everyone may read). Cost ≈ 0 (in-memory
   table; at most one 1-doc read per year per session via the existing prefetch —
   reuse the existing prefetch function in people.js; do not add a second fetcher).
   For a month spanning no year boundary one `getPHHolidays` call suffices; call it with
   the month's year. Entry: `kind:'holiday'`, `title: name` (+ ` (special)` suffix when
   `type==='special'`).
2. **Task deadlines** — the exact query `renderMiniCal` runs today, INCLUDING its
   cache key so the read is shared, not duplicated:
   `dbCachedGet('tasks-cal-'+uid, () => db.collection('tasks').where('assignedTo','array-contains',uid).get().catch(() => db.collection('tasks').where('assignedTo','==',uid).get()), 30000)`
   then filter `t.dueDate && !['done','approved','archived'].includes(t.status)` and
   `dueDate` within `mk`. **Own tasks only, for every role** — internal staff CAN read
   all tasks (rule: `allow read: if isAuth() && (!isPartner() || uid in assignedTo)`),
   but the calendar is a personal surface; showing every company task to admins is noise.
   → **OWNER DECISION D5** if he wants admins to see all task deadlines; default OWN.
3. **Meetings + follow-ups** — `window.Meetings.loadMonth(mk)`, wrapped in
   `dbCachedGet('cal-meetings-' + uid + '-' + mk, () => window.Meetings.loadMonth(mk), 60000)`.
   Skip `status==='cancelled'`; each `followUpAt` becomes a second entry
   `kind:'followup'`, `title: '↩ ' + meeting title` on its own day (mirrors the drawer
   page's existing behaviour).
4. **Own approved leave** — `db.collection('leave_requests').where('userId','==',uid).where('status','==','approved').get()`
   via `dbCachedGet('cal-leave-'+uid, …, 300000)`. Equality-only query → no composite
   index needed. Expand each doc's `startDate…endDate` inclusive range into per-day
   entries clipped to the month, `kind:'leave'`, `title: (type label) + ' leave'`
   (leave type labels come from `leaveType()` in js/screens/people.js — reuse, don't
   re-declare). Reason to include: an employee expects their own approved time off on
   their own calendar. Scope: OWN ONLY for everyone — the leave rule would let
   `canHrView()` read all, but surfacing colleagues' leave on every manager's calendar is
   a visibility change the owner has not asked for. → **OWNER DECISION D6** ("who's out
   this week" for managers/HR); default OUT.
5. **Government bidding deadlines** — `gov_biddings` docs' `deadline` field (ISO date,
   see the bid modal that populates `#gb-deadline` in js/departments.js). Rule:
   `allow read: if isAuth() && !isPartner()` — every internal staffer may read, but
   include entries only when the viewer is in the Government Biddings dept
   (`(window.currentDepts||[]).includes('Government Biddings')` — confirm the exact dept
   string against `DEPARTMENTS` in js/config.js) or is president/manager/secretary.
   Reason: it is a real deadline the team asked to track, but it is irrelevant noise for
   a Design or Production employee. Fetch via
   `dbCachedGet('gov_biddings-cal', () => db.collection('gov_biddings').get(), 300000)`,
   filter client-side to `deadline` within `mk`; before shipping, check the status values
   offered by the bid modal in js/departments.js and exclude clearly-terminal ones
   (won/lost/archived-style statuses) so dead bids don't haunt the calendar.
   `kind:'bidding'`, `title: bid title` — NEVER the ABC amount.
   → **OWNER DECISION D7** on the audience; default Gov-dept + admin tier.
6. **Delivery target dates** — active `job_projects` (stage not in
   `['completed','paid','cancelled']`) with a `targetDate` in `mk`. Audience: members of
   Production, Sales or Design depts, plus president/manager/secretary — the depts that
   act on a delivery date. Uses the SAME `dbCachedGet('job_projects', …, 300000)` key as
   Part 1, so within the TTL this source is free. `kind:'delivery'`,
   `title: 'Delivery — ' + p.name` (escaped at render). NEVER money fields.
   → **OWNER DECISION D8** on the audience; default as stated.

**OUT (each with the reason — do not add without an owner ruling):**

7. **Paydays** — OUT. Pay dates live inside pay run docs (`pay_runs`, finance-gated) and
   payroll files; there is NO stored company payday schedule to read, and per the payroll
   memory rules this repo never invents government/payroll dates. Publishing a payday
   schedule to all staff is also a policy statement only the owner can make.
   → **OWNER DECISION D9**: if he wants paydays shown, he must state the schedule; then
   it becomes a static table like holidays (trivial to add later).
8. **Cash-advance due dates** — OUT. Per-person money data in finance collections;
   surfacing it on a general calendar mixes a debt reminder into a scheduling tool.
9. **Attendance / shifts** — OUT. The Attendance page IS that calendar already
   (`renderAttendancePage`, js/screens/people.js); duplicating it here creates two
   sources of truth for the same day.
10. **Quote validity expiries** — OUT. Sales-internal churn; would dominate the calendar
    with dates nobody schedules around.
11. **Birthdays / work anniversaries** — OUT pending **OWNER DECISION D10** (and pending
    verification that users docs even carry a birthday field).
12. **Posts/announcements** — OUT. Posts have no event-date field.

### 2.4 Permissions must not widen (must-hold)

The merged reader adds NO read any surface could not already perform:
- Meetings scoping is inherited unchanged from `Meetings.loadMonth` — oversight tier
  (`isAdminTier()` in js/meetings.js = president/manager/secretary) reads the whole
  company; everyone else adds `invitees array-contains uid`. The server-side rule this
  relies on is in `match /meetings/{meetingId}`:
  `allow read: if isAuth() && !isPartner() && (isInvitee() || isOrganizer() || isAdmin());`
  (firestore.rules — `isAdmin()` = president/manager/secretary). The dashboard therefore
  can never show a meeting the drawer page (or a direct query) would not.
- Tasks: own-assigned only (narrower than the rule allows).
- Leave: own docs only (narrower than the rule allows).
- Biddings/deliveries: reads already permitted to all internal staff; the feed only
  narrows the audience further client-side.
- Partners: no calendar nav entry exists for partner variants; if a partner deep-links to
  `#calendar`, the meetings read is denied and the page shows its existing
  permission banner (unchanged behaviour); the feed's other sources soft-fail closed.

### 2.5 New file wiring

- Create `js/calendar-feed.js`.
- index.html: add `<script defer src="js/calendar-feed.js"></script>` **immediately after
  the `js/meetings.js` tag** (it consumes `window.Meetings._h`; meetings.js already loads
  before all js/screens/* files).
- sw.js: add `'js/calendar-feed.js'` to the `PRECACHE` list, adjacent to
  `'js/meetings.js'`.
- No nav changes, no CSS-gradient obligation (§0.10).

### 2.6 Caching & invalidation (the dashboard must not get slower)

| dbCachedGet key | Source | TTL | Notes |
|---|---|---|---|
| `tasks-cal-{uid}` | tasks | 30 000 | EXISTING key, reused verbatim — zero added cost |
| `cal-meetings-{uid}-{mk}` | meetings month | 60 000 | new |
| `cal-leave-{uid}` | own approved leave | 300 000 | new |
| `gov_biddings-cal` | gov biddings | 300 000 | new; only fetched for the D7 audience |
| `job_projects` | deliveries | 300 000 | SHARED with Part 1's Company page |
| (none) | holidays | session | in-memory table + existing `settings_holidays` prefetch |

Worst-case cold dashboard paint: 1 (tasks, already paid today) + 1 (meetings) + 1 (leave)
+ up to 2 dept-gated reads = **3–5 reads once, then 0 within TTLs**, vs 1 today. Month
navigation re-reads only `cal-meetings-*` for unseen months. Acceptable; anything beyond
this budget is out of spec.

Invalidation — add to js/meetings.js:
- In `save()`, `cancel()`, and `rsvp()` (inside the `window.Meetings` IIFE), after the
  write succeeds: `if (window.dbCacheInvalidate) dbCacheInvalidate('cal-meetings');`
- In js/config.js, extend the `_alias` map inside the dbCachedGet IIFE with
  `'cal-meetings': { prefixes: ['cal-meetings-'] },` so that single call clears every
  cached month for every uid. (The `_alias` map is the existing mechanism — see the
  `'ledger'` entry.)
- `CalendarFeed.invalidate()` simply forwards to `dbCacheInvalidate` for the keys above.
Leave filed by the user is `pending` (not on the calendar) until approved elsewhere, so
a 5-minute staleness on `cal-leave-*` is acceptable; no extra invalidation sites.

### 2.7 Mini calendar (`renderMiniCal`, js/screens/dashboards.js) — rewrite

Keep: the `#mini-cal` host contract, `_calMonthOffset` month nav, Manila month anchoring
via `bizDate()`, the "today" highlight (today cell keeps `background:var(--primary)` and
white text exactly as now), read-only behaviour.

Change:
1. Replace the direct tasks query with
   `const feed = await CalendarFeed.loadMonth(ym);` (guard:
   `typeof window.CalendarFeed !== 'undefined'`; if absent — stale SW mid-rollout —
   fall back to the current tasks-only path so the dashboard never blanks).
2. **Dots become kind-coloured.** Per day, render up to **3** dots of 4–5 px, one per
   DISTINCT kind present, chosen in priority order
   `holiday > meeting/followup > task > leave > bidding > delivery`. Colors (existing
   tokens): holiday `var(--gold)`, meeting/followup `var(--info)`, task `var(--danger)`,
   leave `var(--success)`, bidding `#7e57c2`, delivery `#FF9F0A`. On the today cell keep
   all dots white (contrast on the primary background; the tap detail disambiguates).
   Additionally a holiday tints its day NUMBER `var(--gold)` (+`font-weight:700`) so
   holidays read at a glance even at ~12 px cells.
3. Tap-a-day detail (`#cal-day-detail`, scoped inside the widget as today): list that
   day's entries, max 5, each prefixed by a kind emoji —
   🎉 holiday · 📅 meeting · ↩ follow-up · ⏰ task due · 🌴 leave · 🏛 bid closes ·
   📦 delivery — title `escHtml`ed, meetings with their `HH:mm`. Below the list, ONE
   link: `Open calendar →` → `navigateTo('calendar')`. This is the single route into the
   detailed page (requirement 5); no meeting creation, no other actions on the dashboard.
4. Cell dot markup: absolutely positioned row of dots (`display:flex;gap:2px`) centered
   at the cell bottom, replacing today's single dot span. At 375 px the 7-column grid
   cells are ≈44 px wide — three 4 px dots + 2 px gaps = 16 px, fits with no overflow.

### 2.8 Drawer page (`renderCalendarPage` / `paint()`, js/meetings.js) — merge in the feed

Keep: the Mon-first grid, `cal-bar` (prev/today/next/New meeting), `openDayAgenda`,
`openMeetingView`, RSVP flow, .ics export, the permission-denied banner, the meeting
empty-state, and ALL meeting-editing behaviour exactly as-is.

Change, inside `paint(root)`:
1. Replace `_cache = await window.Meetings.loadMonth(_mk)` with
   `const feed = await CalendarFeed.loadMonth(_mk)`; meetings for the existing logic are
   `feed` entries of kind `meeting`/`followup` (their `raw` docs reconstruct today's
   `_cache` semantics — keep a `_cache` of raw meeting docs so `openDayAgenda`'s meeting
   cards and RSVP badges work unmodified).
2. Non-meeting entries render as chips in the same `.cal-cell` buttons, using new
   modifier classes (§2.9): holidays first (chip text = holiday name, no time), then
   meetings (existing chip), then task/leave/bidding/delivery chips. Keep the existing
   "first 3 + `+N more`" overflow rule per cell, now counting ALL entries.
3. `openDayAgenda(iso, items, onChange)` receives the merged day list. Meeting items:
   unchanged card (Open button → `openMeetingView`). New item cards, read-only:
   - task: title + `Due today` sub-line; button `Open` →
     `window.openTaskDetail ? openTaskDetail(id) : navigateTo('tasks')` (confirm
     `openTaskDetail`'s exact global name/signature in js/screens/tasks.js before using).
   - holiday: name + `Regular holiday` / `Special non-working day` sub-line; no button.
   - leave: `Your approved leave` sub-line; no button.
   - bidding: bid title + `Bids close today`; button `Open` → `navigateTo('dept:Government Biddings')`
     (confirm the dept page key used by the gov nav entries in js/config.js).
   - delivery: project name + `Target delivery date`; button only for viewers passing
     `hasProjectsDept` → `navigateTo('projects-lifecycle')`.
4. Legend row between `.cal-bar` and `.cal-dow`: small color swatches + labels
   `Holiday · Meeting · Due · Leave · Bid · Delivery`, rendered ONLY for kinds the
   current viewer can ever receive (no Bid swatch for a viewer outside D7's audience).
   Horizontally wraps at 375 px (`flex-wrap:wrap`), never scrolls sideways.
5. `sopPanel` copy — replace the first bullet and add one:
   - `Meetings you organise or are invited to appear here — the President, a Manager and the Corporate Secretary see the whole company.` (unchanged)
   - NEW second bullet: `Philippine holidays, your task due dates and your approved leave show up alongside meetings — the small calendar on your dashboard shows the same things.`
6. The month empty-state text changes from `No meetings this month` to
   `Nothing on the calendar this month` with sub-line
   `Meetings, holidays, task due dates and your approved leave all show up here.`
   (Show it only when the merged month is truly empty — holidays make that rare.)
7. After `save`/`cancel`/`rsvp` callbacks repaint, the §2.6 invalidation guarantees the
   fresh meeting appears.

### 2.9 CSS (css/styles.css)

Extend the existing `.cal-chip` block (anchor: search for the `.cal-chip` ruleset near
`.cal-cell`) with kind modifiers — left-border + soft tint, dark/light safe via the
tokens already used in this file:

```
.cal-chip-hol   → border-left 3px var(--gold);   background: color-mix or the file's
.cal-chip-task  → border-left 3px var(--danger);   existing "-soft" token pattern
.cal-chip-leave → border-left 3px var(--success);  (--info-soft, --success-soft …)
.cal-chip-bid   → border-left 3px #7e57c2;
.cal-chip-del   → border-left 3px #FF9F0A;
(meeting chips keep the current default look; .cal-chip-fu stays)
.cal-legend / .cal-legend-swatch → the legend row (flex, wrap, 11px, muted)
.minical-dots / .minical-dot     → the mini grid dot row (4px circles, gap 2px)
```
Follow the file's existing dark/light token conventions; both themes must pass the
checklist's legibility check. No new drawer icon gradient is involved (§0.10).

### 2.10 firestore.rules / firestore.indexes.json for Part 2

**No rules changes.** Every query either already runs today (tasks, meetings) or is
equality-only / full-collection-cached (leave, biddings, job_projects) under existing
rules quoted above. **No index changes**: the meetings composite (startAt range +
invitees array-contains) already exists and is exercised daily by `loadMonth`;
`leave_requests` uses two equality filters (no composite needed); everything else is a
full read filtered client-side, matching how those screens already read the same data.
The only `firebase deploy` in this whole spec is Part 1B's rules block (§1B.7) — Part 2
must not add another.

---

## 3. Consolidated owner decisions (flag, don't guess)

**RULED (no longer open):**
- Money on the year-round Company page. Owner, 2026-08-12: *"no dont show the money,
  show it at end of the year…"* → no peso figures for anyone on the Company Overview
  (§1.2); the deliberate money surface is the President-published Year in Review
  (PART 1B).
- Health presentation + schema split. Owner, 2026-08-12, after being shown that
  `job_projects` money is API-readable by every signed-in non-partner and offered a
  finance-only schema split: *"Nvm, just show comapny health, only percentages"* →
  the health section is percentages only (§1.4) and the schema split is **declined,
  informed** — closed, not deferred (§1.2).

| # | Question | Default implemented by this spec |
|---|---|---|
| D3 | Client names visible in the company-wide projects list | Show (matches production handoff precedent) |
| **D11** | **Does profit/margin appear in the Year in Review?** Revenue and volume are safe disclosures; profit is a different one. | **Excluded** — the `headline` shape carries no profit field. If he wants it, it is one added field in §1B.3 + one tile + the same publish-form treatment. Ask him; do not add speculatively. |
| D5 | Admin tier sees ALL task deadlines on calendars, or own only | Own only |
| D6 | Managers/HR see team members' leave on the calendar | No — own leave only, for everyone |
| D7 | Who sees bidding deadlines | Gov Biddings dept + president/manager/secretary |
| D8 | Who sees delivery target dates | Production/Sales/Design depts + president/manager/secretary |
| D9 | Paydays on the calendar | Excluded — no stored schedule exists and this repo never invents payroll dates; owner must state the schedule first |
| D10 | Birthdays/anniversaries | Excluded pending owner interest (verify a birthday field even exists) |

---

## 4. Verification checklist (numbered, measurable)

Run at 1280 px and 375 px, light and dark themes, as: president, secretary, a
Finance-dept employee, a plain employee (no ops depts), and a partner (deep-links only).

1. Company → Overview as plain employee: every "How We're Doing" tile except
   `Team members` renders a `%` value; zero `₱` characters anywhere in the two new
   sections (grep the rendered DOM for `₱`); no other raw count appears in the tile
   grid.
2. Same page as PRESIDENT and as a Finance-dept employee: STILL zero `₱` characters in
   the two new sections — the owner's ruling applies to every role; no money row exists
   in the DOM for anyone (not display:none — absent).
3. Year in Review tab before any publish: every internal role sees the
   "isn't out yet" empty state; only the President additionally sees `Publish {Y}`;
   a partner deep-link shows the identical empty state with zero console errors.
4. Partner deep-link to `#company`: page renders exactly its pre-change sections; the two
   new section wrappers are hidden; zero console errors; no error banner.
5. With `job_projects` empty (or a test filter forcing zero): the small-sample guards
   collapse the tile grid to the `Not enough on the board yet…` line + `Team members`,
   and the projects section shows the "Nothing on the board yet" empty state — never a
   blank panel, and never a wall of `0%`/`100%` tiles.
6. Company page cold open performs ≤ 3 Firestore collection reads total (president doc +
   `job_projects` + `users`); reopening within 60 s performs 0 new reads for
   `users` and 0 for `job_projects` within 5 min (check the network tab / Firestore
   usage logging).
7. Dashboard mini calendar: a PH holiday day (e.g. Aug 21 — Ninoy Aquino Day) shows a
   gold day-number + gold dot with NO Firestore data present; today's cell keeps the
   primary-background highlight.
8. Create a meeting for tomorrow from the drawer page → within one dashboard revisit the
   mini shows a blue dot on that day (invalidation working); the drawer page shows it
   immediately after save.
9. A task with `dueDate` this month shows on BOTH the mini (red dot) and the drawer grid
   (red-edged chip) — the original defect is dead in both directions.
10. As a plain employee, sign in as a second user who has a meeting you are NOT invited
    to: that meeting appears on neither of your surfaces; as secretary it appears on
    both (scoping preserved, oversight tier intact).
11. Approved leave for the signed-in user spanning a month boundary renders on the
    correct days of BOTH months and only for that user.
12. Bidding deadline chips appear for a Gov Biddings member and do NOT appear for a
    Design-only employee on the same day/data.
13. Mini day-tap detail lists mixed kinds with correct emoji, max 5 + `Open calendar →`
    which lands on the drawer page; no create-meeting control exists anywhere in the
    widget.
14. 375 px: mini grid and drawer grid have no horizontal scroll (document.scrollingElement
    scrollWidth === clientWidth), legend wraps to two lines cleanly, chips truncate with
    the existing `.cal-chip-n` behaviour rather than overflowing.
15. Dashboard cold paint issues ≤ 5 reads (plain employee: tasks + meetings + leave = 3);
    navigating dashboard → tasks → dashboard within 30 s issues 0 new calendar reads.
16. Kill `js/calendar-feed.js` from the SW cache simulation (or block the file):
    `renderMiniCal` falls back to tasks-only and renders; no blank widget.
17. `scripts/ci-invariants.sh` passes all 6 checks (especially 6/6 — no nav entries were
    added; the PRECACHE and index.html both list `js/calendar-feed.js`).
18. Grep the diff's user-visible strings for the forbidden vocabulary (§0.8): zero hits.
19. `git diff firestore.rules` contains EXACTLY the `company_year_review` block (§1B.7)
    and nothing else; `firestore.indexes.json` unchanged unless the attendance query in
    §1B.5 forced a composite (in which case that index is present and deployed).
20. All new user-content sinks route through `escHtml` (audit: task/meeting/bid/project/
    leave titles in mini detail, chips, day agenda, Company projects list, the
    Year in Review note and every prefill echoed back into the publish form).
21. Publish flow: as President, publish last year with the prefilled figures edited —
    the tab immediately shows Half 1 with exactly the edited values (not the recomputed
    ones), and a plain employee sees the identical Half 1 within the 5-minute cache TTL
    (or immediately after their own tab re-render).
22. Snapshot, not live: after publishing, change a `job_projects` doc that would alter
    the prefill — the published Revenue tile does NOT move. Re-opening the publish form
    shows the STORED values.
23. Take down: President deletes the year via the confirm dialog — every role is back to
    the "isn't out yet" empty state; the doc is gone from Firestore.
24. Write lockout: as a manager and as a plain employee, a direct console write to
    `company_year_review/2026` (create, update, and delete) is permission-denied.
25. Half 2 isolation: sign in as two different employees viewing the same published
    year — each sees only their own numbers; the rendered DOM contains no other
    employee's name or figures anywhere on the screen.
26. Pay boundary: grep the Year in Review render output and the stored doc for any
    salary/allowance/deduction/rate value — zero hits by construction (no code path
    reads `payroll/*` or pay fields for this screen).
27. Reconstruction audit (§1.4) re-run against the SHIPPED page as a whole: list every
    absolute number visible anywhere on Company → Overview (expected: `teamSize` and the
    projects list's `…and N more`) and every percentage; confirm no percentage has a
    peso base, so no combination yields a peso figure.

---

## 5. File-by-file change summary

| File | Change |
|---|---|
| `js/calendar-feed.js` | NEW — `window.CalendarFeed` (§2.2–2.3, §2.6) |
| `index.html` | script tag for calendar-feed.js after js/meetings.js |
| `sw.js` | add `'js/calendar-feed.js'` to PRECACHE |
| `js/screens/dashboards.js` | `renderCompanyOverview` + new `_fillCompanyHealth` helper (§1.3–1.4 — percentages only, NO money and no unjustified counts, for any role); `renderCompany` gains the `year` chip tab; NEW `renderCompanyYearReview` + President publish panel (§1B.2–1B.5, 1B.8); `renderMiniCal` rewrite (§2.7) |
| `js/meetings.js` | `paint()`/`openDayAgenda` merge feed entries, legend, sopPanel + empty-state copy (§2.8); `dbCacheInvalidate('cal-meetings')` in `save`/`cancel`/`rsvp` (§2.6) |
| `js/config.js` | `_alias` map: `'cal-meetings': { prefixes:['cal-meetings-'] }` (§2.6) |
| `js/screens/production.js` | ONLY if needed: `window.JOB_STAGES = JOB_STAGES;` exposure (§1.4) |
| `css/styles.css` | `.cal-chip-*` kind modifiers, `.cal-legend*`, `.minical-dot*` (§2.9); any Year-in-Review tile styling reuses the page's existing `co-*` classes |
| `firestore.rules` | ONE addition: `match /company_year_review/{year}` (§1B.7) — deploy with `firebase deploy --only firestore:rules` |
| `firestore.indexes.json` | no change, UNLESS the §1B.5 attendance query needs a composite (then add + deploy) |
