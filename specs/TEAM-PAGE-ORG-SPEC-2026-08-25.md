# TEAM-PAGE-ORG-SPEC — 2026-08-25

Owner request (Neil, 2026-08-25), three asks on the **Team directory** (`renderTeamTab`, js/screens/people.js):

1. **Aspirational org section** — the team he aspires to build by January, shown at the BOTTOM of the Team page, separated by a divider, as VACANT positions ("employment not yet open"), each with a description and the department(s) it holds.
2. **Color-code each current employee by type of employment.**
3. **Fabricators belong on the team** and should have their own accounts — account creation/management must live IN THE APP (never the Firebase console), controlled by designated personnel, "preferably HR and IT".

A ChatGPT link Neil shared for extra context was unreachable (chatgpt.com blocked by browsing policy) — descriptions below are authored from his message; they live in ONE config array so wording swaps are trivial.

## Ground truth from recon (do not re-derive)

- Team directory = `window.renderTeamTab` (js/screens/people.js:573) + `renderTeamCards` (people.js:1184). Cards already color the ROLE line via a role→color map (people.js:1204). `canManageAccounts` (people.js:1197) = president/manager OR HR-dept membership; drives Remove/Reinstate only.
- "+ Invite Member" gate `pres` = president/manager/finance (people.js:575,583). Email path; secondary Firebase app; writes users/{uid}.
- **Create Worker Account** = `openCreateWorkerModal` (js/screens/dashboards.js:6616) — THE one path minting a real Auth uid from a username+password (no email). Writes users/{uid} (+`hrManagedAccount:true`), usernames/{username}, payroll/{uid} (declared payClass), and for payClass 'production': worker_profiles.doc(uid) (linkedUid:uid) + worker_directory.doc(uid) mirror. Reached from renderTeam (dashboards.js:6455, gate president/manager ONLY at :6456) and HR hub → Accounts & Logins card (hr.js:481, gate `canAccounts` = president/manager OR HR dept, hr.js:439).
- `dbCachedGet('users', …)` force-substitutes `fetchUsersWithPayroll` (config.js:885,937): users docs arrive MERGED with payroll ({salary, payClass…}) but **payroll list is DENIED for non-money viewers** → merged pay absent; `snap.payrollDenied` flags it. So payClass is NOT a universally readable signal.
- worker_profiles: read money-tier or own-linkedUid; create/update money-tier; HR-dept update restricted to reinstate fields (rules:3323). **worker_directory** (rules:3362): assignment-safe projection (name, idNumber, jobTitle, department, status, photoUrl), read = any internal (!isPartner), write money-tier.
- users create rule (rules:414-429): president | seniorAdmin(role∈manager,secretary,employee,agent,finance,partner) | isAdmin(employee/agent + `noPrivilegedDeptOnCreate()` — Finance/Design/Ventures/IT frozen) | self-signup. usernames write = isAdmin (rules:555).
- Cloud Functions (functions/index.js): `adminResetPassword` (:434) caller ∈ president/manager/finance, target must be `hrManagedAccount` and non-admin-tier. `setUserDisabled` (:515) offboard = president/manager; HR dept = reinstate direction only (owner ruling 2026-08-12 — asymmetric on purpose; DO NOT TOUCH).
- Owner ruling 2026-08-08: "a department dropdown must never hand out a tier — membership buys the door, not the money behind it." So we must NOT grant account powers to whole departments. Hence the **designated-flag** design below, which matches Neil's own wording ("designated personnel").
- EMPLOYMENT_STATUSES + employmentStatusMeta exist (config.js:474-487): training/probationary/regular/resigned/terminated with badge classes.
- Perf-wave1: people.js/dashboards.js are lazy-loaded (PAGE_SCRIPTS). No new files in this build — nothing to add to PRECACHE/PAGE_SCRIPTS. Version/CACHE_VER auto-bump on commit — never hand-edit.
- Panel discipline: EVERY lookup inside an openPage/openModal panel must be `panel.querySelector`, never document.getElementById (app's largest defect class — see dashboards.js:6705).
- Escape all user content with escHtml(); dates via bizDate(); icons via emojiIcon()/lucide.

---

## Part 1 — config.js additions (all attached to window; config.js loads eagerly)

### 1a. `window.TEAM_TYPES` — employment-type registry (single source for colors/labels)

```js
window.TEAM_TYPES = {
  office:     { label: 'Office Team',            sub: 'Monthly payroll',  color: '#0A84FF' },
  operations: { label: 'Fabricator · Operations', sub: 'Weekly payroll',   color: '#FF9F0A' },
  agent:      { label: 'Sales Agent',            sub: 'Commission-based', color: '#FFD60A' },
  partner:    { label: 'Partner',                sub: 'External company', color: '#FF6B6B' },
};
```

### 1b. `window.teamTypeOf(u)` — classification with legacy fallback

Priority order (first hit wins):
1. `u.team` if it's a key of TEAM_TYPES (explicit stamp — new accounts get it, see Part 3).
2. `u.role === 'partner'` → 'partner'; `u.role === 'agent'` → 'agent'.
3. `u.payClass === 'production'` → 'operations' (works for money-priv viewers via merged payroll).
4. `u.hrManagedAccount === true` → 'operations' (visible to everyone; worker accounts are HR-minted).
5. default → 'office'.

Return the KEY. Add `window.teamTypeMeta(u)` returning the TEAM_TYPES entry (never undefined; fall back to office).

### 1c. `window.isAccountAdmin()` — the "designated personnel" predicate (client side)

```js
window.isAccountAdmin = function () {
  return ['president','manager'].includes(window.currentRole || '')
      || !!(window.userProfile && window.userProfile.accountAdmin === true);
};
```

Semantics: Neil (President) flags specific people — his HR and IT staff — via the Edit Employee modal (Part 3d). The flag, not department membership, carries the power (owner ruling 2026-08-08 preserved).

### 1d. `window.ASPIRATIONAL_POSITIONS` — the January target org

Array of `{ key, title, officer, depts:[], icon, desc }`. Use existing DEPARTMENTS keys only (read `window.DEPARTMENTS` in config.js and use exact key strings; if a listed dept doesn't exist as a key, put the name in prose only). Content:

| title | officer | depts | icon | desc |
|---|---|---|---|---|
| Factory Coordinator 1 | Architectural Operations Officer | Design, Production* | 📐 | Runs the factory's architectural side — turns approved designs into fabrication plans, and coordinates measurements, materials and installation schedules between Design and the shop floor. |
| Factory Coordinator 2 | Technical Operations Officer | Production*, IT | 🔧 | Owns the technical side of the factory — machine upkeep, fabrication methods, quality checks and process improvements across every production stage. |
| Administrative Coordinator 1 | Business Development Officer | Admin, Sales, Government Biddings | 📈 | Grows the business — partnerships, dealer and distributor accounts, government biddings, and new product lines from first contact to signed contract. |
| Administrative Coordinator 2 | Commercial & Marketing Officer | Admin, Marketing | 📣 | Owns how Barro sells and looks — pricing and commercial terms, campaigns and catalogues, and the brand across every channel. |
| Foreman | Production Head | Production* | 👷 | Leads the fabricators on the floor — assigns daily work per production stage, tracks hours and output, and enforces safety and workmanship standards. |
| Accountant | Finance & Compliance Officer | Finance, HR | 🧾 | Keeps the books and the government happy — ledger and reports, BIR / SSS / PhilHealth / Pag-IBIG filings, payroll compliance and audit readiness. |

*If there is no 'Production' key in DEPARTMENTS, use the closest existing key (check for 'Operations'/'Production') or drop it from the depts array and keep it in desc.

Also export `window.ASPIRATIONAL_TARGET_LABEL = 'Target: January'`.

## Part 2 — Team directory (js/screens/people.js)

All of this is **hidden from partner viewers** (`viewingAsPartner`) — internal org info.

### 2a. Employment-type color coding (renderTeamCards)

- Each card: left accent border (`border-left:3px solid <type color>`, or box-shadow inset if the card style fights a border) + a small type pill `<span>` with the TEAM_TYPES label, colored text/dot. Use `teamTypeMeta(u)`.
- Keep the existing role-line coloring as is (role ≠ employment type).
- If `u.employmentStatus` is set and not 'regular', ALSO show the existing `employmentStatusMeta(u.employmentStatus)` badge (Training/Probationary/Resigned/Terminated) — tiny, next to the type pill.
- Legend: one row of chips above the grid (inside `#team-grid`'s parent, rendered once in renderTeamTab, not per search re-render): a colored dot + label per TEAM_TYPES entry. Muted, small (11-12px), non-interactive.

### 2b. Fabricators without logins appear on the team

In `renderTeamTab` (non-partner only), alongside the users fetch:

```js
const wdSnap = await dbCachedGet('worker_directory',
  () => db.collection('worker_directory').get(), 60000).catch(() => ({docs:[]}));
```

- Build `fabricators` = wdSnap docs where `status === 'active'`, AND doc.id is not in the users id set, AND `!d.linkedUid` (linkedUid mirrored going forward, Part 3b — legacy docs won't have it, the id check covers uid-keyed ones).
- Render them under the main grid in their own block: divider + heading `👷 Fabricators — Operations Team` and a masonry grid of simplified cards: avatar initials (photoUrl if present), name, jobTitle, department, 'operations' type pill (same color coding), plus a muted `No app login yet` pill.
- No DM/nudge/calling-card/remove buttons (no uid). If `window.isAccountAdmin()`: one button per card — `Create login` → `window.openCreateWorkerModal({ linkWorker: { id, name, jobTitle, department } })` (Part 3b). Guard with `typeof openCreateWorkerModal === 'function'` (dashboards.js is lazy; if absent, `navigateTo('team')`).
- Team search (the debounced input) must also filter fabricator cards on name/jobTitle/department — factor fabricator rendering into a `renderFabricatorCards(list, q)` called from both initial render and the search handler.
- If the list read is denied/empty → render nothing (no empty-state for this block).

### 2c. Vacant / aspirational section (bottom of the page)

After the fabricator block (always AFTER the real people — "above are the current team"):

- Divider: full-width rule with centered label `🎯 The team we're building · Target: January`, then one muted sub-line: `These positions are planned — employment for them is not yet open.`
- Grid of vacant cards from `window.ASPIRATIONAL_POSITIONS`: dashed 1.5px border (var(--border)), slightly reduced opacity, NO avatar photo — a dashed-circle placeholder with the icon emoji. Contents: **title** (bold), officer designation (the parenthetical, as the role line), dept chips (small badges per dept name), the description (12px, muted), and a status pill `Vacant — hiring not yet open` (badge-gray / muted background, NOT a hot color).
- Cards are non-interactive (no click handlers). Static config render — no Firestore.

### 2d. Invite gate widening

`pres` (people.js:575) becomes `... || window.isAccountAdmin()`. Inside the invite panel, when the viewer is a flag-only account admin (i.e. `window.isAccountAdmin()` true but role NOT president/manager and role NOT finance):
- Role select: only `employee` and `agent` options (rules will deny anything else).
- Department checkboxes: omit Finance, Design, Ventures, IT (rules `noPrivilegedDeptOnCreate`).
A one-line muted note in the panel: "As an account admin you can create Employee and Agent accounts."

### 2e. users doc stamps on invite

Invite save (people.js:736) additionally writes `team`: `'partner'` if role partner, `'agent'` if role agent, else `'office'`.

## Part 3 — dashboards.js + hr.js

### 3a. renderTeam gate + pay display honesty (dashboards.js:6455-6541)

- Gate (:6456) becomes: `if(!isPresident() && currentRole!=='manager' && !window.isAccountAdmin())`.
- When `snap.payrollDenied` (the fetch already returns it): render `—` in Base and Net cells instead of confident ₱0, and omit Base/Allowance/Deductions/Net from the CSV export. One muted note above the table: "Pay figures are not shown to you."
- "Logout All" stays on its existing president/IT gate. "+ Add Employee Profile" (openAddEmployeeModal) — leave its button visible; its users `.add()` write will be denied for flag-only admins by rules (random-id doc, role branch) — actually simpler: hide `add-emp-btn` for flag-only account admins (it's the legacy record-only path; account admins should use the account path anyway).

### 3b. openCreateWorkerModal — link-existing-worker mode + team stamp (dashboards.js:6616)

- Signature: `openCreateWorkerModal(opts)` with optional `opts.linkWorker = { id, name, jobTitle, department }` (worker_directory doc). When present:
  - Prefill Full Name / Job Title / Primary Department; force Employee Type select to `production` (Operations) and disable changing it; show a muted banner: "Linking a login to existing worker record <name> — no duplicate profile will be created."
  - On save, INSTEAD of `worker_profiles.doc(uid).set({...})`: `worker_profiles.doc(opts.linkWorker.id).update({ linkedUid: uid })` and `worker_directory.doc(opts.linkWorker.id).set({ linkedUid: uid }, { merge: true })`. Do NOT touch rates/status (rules enforce set-once linkedUid for account admins; money-tier admins pass anyway). Skip `nextWorkerIdNumber()`.
  - Everything else (users doc, usernames map, payroll doc, credentials modal) unchanged. users doc for linked mode still gets `hrManagedAccount:true`.
- Both modes: users doc gains `team: payClass === 'production' ? 'operations' : 'office'`.
- New-worker mode (existing behavior) worker_directory mirror: include `linkedUid: uid` in the mirrored doc (:6821).
- `openAddEmployeeModal` (:6551): stamp `team` with same derivation (role/agent/partner else office).
- Invalidate `dbCacheInvalidate('worker_directory')` wherever worker_directory is written (both modes) and after profile syncs if trivially reachable.

### 3c. hr.js Accounts door

`canAccounts` (hr.js:439) becomes `['president','manager'].includes(role) || (…HR dept…) || window.isAccountAdmin()`. Card desc stays accurate.

### 3d. Edit Employee modal — Team select + Account-admin toggle (openEditEmployeeModal, dashboards.js:6866)

- Add a **Team / employment type** select (TEAM_TYPES entries, plus "— auto —" empty option) writing `team` on save (senior admins only see this modal already).
- Add, **visible ONLY when `isPresident()`**, a checkbox: `Account admin — may create logins, invite members and reset worker passwords` bound to `u.accountAdmin`, saved as boolean `accountAdmin`. (Rules make it president-only writable; hide the control from managers so it isn't a dead checkbox.)
- Any existing UI that calls the `adminResetPassword` callable (search dashboards.js/hr.js for `adminResetPassword`): widen its visibility gate with `|| window.isAccountAdmin()`.

## Part 4 — firestore.rules

Mirror existing style/comment discipline. Every `.get()` on possibly-absent fields uses a default (missing-field throws → error-denies the whole rule).

### 4a. Helper (top, near isAdmin/getRole; copy getRole()'s exact null-safety idiom)

```
function isAccountAdminFlag() {
  return isAuth() && getUserData().get('accountAdmin', false) == true;
}
```
(If there's no getUserData() helper, replicate however getRole() reads users/$(request.auth.uid) — same doc, same pattern.)

### 4b. users/{uid}

- **create** (rules:414-429): add a branch
  `|| (isAccountAdminFlag() && request.resource.data.get('role','employee') in ['employee','agent'] && noPrivilegedDeptOnCreate())`.
- **update**: `accountAdmin` becomes a PRESIDENT-ONLY mutable field: in the isSeniorAdmin branch add `accountAdminUnchanged()` (`isPresident() || request.resource.data.get('accountAdmin', null) == resource.data.get('accountAdmin', null)`) exactly parallel to the existing `hrFlagUnchanged()` (:466). Add `'accountAdmin'`, `'team'` to `userPrivilegedFieldsUnchanged()`'s frozen list (:245) so self-updates and non-senior-admin edits can never touch them. VERIFY the secretary/isAdmin edit branch routes through userPrivilegedFieldsUnchanged (it does per :435 comments) — if any branch bypasses it, freeze accountAdmin there explicitly too.

### 4c. usernames/{username} (:555)

`allow create: if isAuth() && (isAdmin() || isAccountAdminFlag());` — update/delete stay isAdmin().

### 4d. payroll/{uid} (:1573)

Add **create-only** for account admins alongside whatever exists: `isAccountAdminFlag()` may CREATE (doc must not exist — create verb guarantees it) with `request.resource.data.get('payClass','regular') in ['regular','production']` and numeric salary/allowance/deductions ≥ 0 (reuse the block's existing validators if present). Read/update/delete unchanged (money-tier). Rationale: setting the INITIAL pay record is part of hiring; reading everyone's pay is not.

### 4e. worker_profiles/{docId} (:3323)

- `allow create: if isAuth() && (isMoneyAdmin() || isAccountAdminFlag());`
- Add an account-admin **link-only** update branch, parallel to the HR reinstate branch:
  ```
  allow update: if isAuth() && isAccountAdminFlag()
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['linkedUid'])
    && resource.data.get('linkedUid','') == ''
    && request.resource.data.get('linkedUid','') is string
    && request.resource.data.get('linkedUid','') != '';
  ```
  Set-once: an existing link can never be re-pointed by an account admin (re-pointing would hand rates-read + punch rights to another uid; that stays money-tier via the general update rule).

### 4f. worker_directory/{docId} (:3362)

`allow create, update: if isAuth() && (isMoneyAdmin() || isAccountAdminFlag());` — delete stays money-tier.

## Part 5 — functions/index.js

`adminResetPassword` (:434) caller gate only:

```js
const callerIsAccountAdmin = callerSnap.exists && callerSnap.data().accountAdmin === true;
if (!['president','manager','finance'].includes(callerRole) && !callerIsAccountAdmin) { …deny… }
```

All target-side guards (hrManagedAccount only, never admin/finance-tier targets) UNCHANGED. `setUserDisabled` UNCHANGED entirely. Audit-log write already records actor — fine.

## Part 6 — What this build does NOT do (say so in the summary to Neil)

- No blanket power to the HR/IT departments — Neil designates individuals via the president-only Account-admin toggle (his 2026-08-08 ruling kept intact).
- Offboarding asymmetry untouched: account admins can create/reset, NOT remove (president/manager offboard; HR reinstates).
- Vacant positions are display-only config — no Firestore collection, no hiring workflow.
- Legacy worker accounts without a `team` stamp classify via fallback (hrManagedAccount→operations); Neil/money viewers get exact payClass-based classification. A rare create-race with the createUserDocOnAuthCreate trigger can make a flag-only admin's users-doc write fail (same class as the existing secretary path) — retry or senior admin fixes; not worth engineering around.

## Part 7 — Implementation partitioning (one agent per file-set; NEVER two agents in one file)

- **S1**: js/config.js + js/screens/people.js (Parts 1, 2)
- **S2**: js/screens/dashboards.js + js/screens/hr.js (Part 3)
- **S3**: firestore.rules + functions/index.js (Parts 4, 5)

## Part 8 — Verification (main session, before commit)

1. `node --check` on config.js, people.js, dashboards.js, hr.js, functions/index.js.
2. Preview (launch config `app`, port 3838): boot clean, no console errors; eval-test `window.teamTypeOf({role:'agent'})==='agent'`, `teamTypeOf({hrManagedAccount:true})==='operations'`, `TEAM_TYPES`, `ASPIRATIONAL_POSITIONS.length===6`, `typeof isAccountAdmin==='function'`.
3. Rules: `~/.npm-global/bin/firebase deploy --only firestore:rules` — **re-`git diff firestore.rules` immediately before** (concurrent-session rule). Deploy rules BEFORE/WITH the code push.
4. Functions: `cd functions && npm run deploy` (only if Part 5 changed).
5. Commit (pre-commit hook bumps version + CACHE_VER + precache manifest — never `--no-verify`), push origin master.
