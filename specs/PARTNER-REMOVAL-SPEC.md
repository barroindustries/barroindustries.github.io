# PARTNER-REMOVAL-SPEC — retire the external partner feature

_Written 2026-10-28 (Fable, planning tier). Owner: Neil Barro (president). Status: spec — nothing implemented._

Line numbers below were verified against the working tree on 2026-10-28 (v14.0.330 + uncommitted configurator work). Other sessions edit this tree live, so treat every number as "±10 lines — anchor on the quoted text, not the number".

---

## 0. Read this first

### 0.1 What is being removed, what stays

"Brilliant Steel" is two things in this code: an **internal department** that Barro staff sit in (`DEPARTMENTS['Brilliant Steel']`, `isSeparate:true`, the `bsOnly` nav variant, `renderBrilliantSteel`, the `bs-*` pages, `bs_quotes`, `CO.BS` in the quote builder), and the company the **external `partner` role** belonged to. Only the second thing goes.

| REMOVE (owner ruling) | KEEP (owner ruling) |
|---|---|
| role `partner` (`ROLES.partner`, `TEAM_TYPES.partner`, `ROLE_TYPE_MAP.partner`, login card) | internal Brilliant Steel dept + staff, `bsOnly` nav variant (minus its `partner-projects` entry) |
| `DEPARTMENTS['Partners']` (`isPartnerDept`) | `renderBrilliantSteel`, `loadBSContent`, `renderBSFiles`, `renderBSClientData`, `bs-quotations` / `bs-clients` / `bs-files` / `bs-quote-builder` pages |
| `renderPartnerProjects`, `renderPartnerDashboard`, `renderPartnersDept`, `loadPartnersDeptTab`, `_showAddDealModal`, `PARTNER_STAGE`, `partner_deals` | `bs_quotes` collection, `CO.BS` pill/letterhead, `QUOTE_COMPANIES.BS`, the BS pass-through tick |
| nav variants `genericPartner`, `partnerBS` (sidebar + bottom) | the Sales "Partner" subtab (renamed **"Brilliant Steel"**), `renderSalesPartnerQuotes` (renamed) |
| quote-builder partner mode: `PARTNER_MODE`, `GENERIC_PARTNER`, `PARTNER_CO_NAME`, `PARTNER_BLOCKED_COS`, `applyPartnerMode`, `?portal=partner`, runtime `CO.PT`, the ~55 guards | approvals review flow: `approveQuoteApproval`, `returnQuoteToPartner`, `openQuoteApprovalReview`, `saveReviewedPartnerQuote`, `_qbReviewContext` — logic kept, user-visible "partner" wording neutralised |
| `isPartner`, `isBrilliantPartner`, `isGenericPartner`, `partnerCompanyName`, `isExternalPartnerUser`, `PARTNER_VISIBLE_ROLES` and every caller branch | `partners/pmtc/chibabs/*`, `parterns/*`, `projects/chibabs/*`, robots.txt lines, and every "never name Brilliant Steel on the public site" guard (ci-invariants check 9, `scripts/build-catalogue.js` BRAND_RE, `build-downloads.js`, tests catalogue-public / site-public-surface / seo-* / content-assets / product-families / qb-configured) |
| `partnerUid` stamping + 50/50 `split` on NEW BS `job_projects`; partner scoping in `window.Projects.listAll` | existing docs keep their old fields (`partnerUid`, `split`, `company:'PT'`); nothing displays them after this work |
| partner terms in firestore.rules / storage.rules / firestore.indexes.json (Phase 3) | the AEC contact stage literal `'partner'` (`sales.js` AEC_STAGES/AEC_TERMINAL, `crm.js:106,178`, `notifications.js:1313`, `functions/index.js:1043`) — a CRM pipeline stage, unrelated |
| `partner_deals` entries in backup/sync scripts (Phase 3) | `isBrilliantOnly()` and the BS-only chrome isolation (see §0.3) |

### 0.2 "Brilliant Steel are Barro employees" (owner ruling)

BS-only staff must appear in **Payroll, HR, statutory, profiles, inventory** like any employee. `window.isExternalPartnerUser` and the four roster exclusions that call it are deleted (not softened). **This is a money change** — WS-D carries a mutation-tested test (§5.4). `js/money-core.js` is frozen/additive-only and is NOT touched by this spec.

### 0.3 Grey zone — BS-only *chrome* restrictions that are not money/HR

The ruling keeps the `bsOnly` nav variant, so BS-only staff keep their isolated chrome. These `isBrilliantOnly()` restrictions are therefore **kept as-is in this spec** (only the `isPartner()` half of each OR is dropped): global search hidden (`app.js:1685, 4781`, `people.js:2744`), Files Hub blocked (`people.js:2870`), Leave/Attendance links hidden in the profile More card (`app.js:3733-3737`), the first-run keyboard hint (`app.js:5010`), the dashboard landing on `renderBrilliantSteel` (`dashboards.js:918`), project lifecycle scoped to own/shared projects (`production.js:1503,1521,1711`), and BS Client Data showing the quote-derived accordion (`partners.js:216-221`). → **OWNER QUESTION Q2** (§7) asks whether these should also fall, since BS-only staff are now on attendance-paid payroll.

Exclusions that are **profile / roster / HR-shaped** DO fall under the ruling and are removed in WS-B/WS-D: Team directory hiding BS-only staff (`people.js:636`), the BS-only filter at `people.js:1061`, `dashboards.js:4329, 4710, 4994` (people pickers / org lists), the My Profile tab set (`people.js:3042-3062` — BS-only staff get the normal ID / Finance & Performance / Analytics / Tasks tabs, not the partner "Account" set), the `_isExternalPartner` local copy in `statutory-rates.js:258-268`, and the four `isExternalPartnerUser` callers.

### 0.4 Deliverable discipline (CLAUDE.md)

- Commit gates before **every** commit: `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`.
- Versions are hook-owned: never edit `APP_VERSION`, the `vX.Y.Z` strings, `CACHE_VER`, or `precache-manifest.json` by hand; never `--no-verify`.
- NEVER `git stash` / `reset --hard` / `checkout --` / `clean`. Verify in a scratch copy; read baselines with `git show HEAD:<path>`.
- Quote-builder edits must update its tutorial (`TUTORIAL_VERSION`, `WHATS_NEW`, tour copy) — WS-E §4.5.
- `escHtml()` for anything user-supplied that reaches `innerHTML`.
- Update `STATUS.md` (pending deploys + one-time actions) before ending any session that changes state — WS-G.

---

## 1. Verified code map (corrections to the recon map noted inline)

### 1.1 Predicates and registries (js/app.js, js/config.js)

| Site | Text to anchor on | Action |
|---|---|---|
| app.js:35 | `let selectedLoginType = null; // 'admin' \| 'employee' \| 'partner'` | comment only |
| app.js:38-45 | `ROLE_TYPE_MAP` has `partner: 'partner'`; `LOGIN_TYPE_LABELS` has `partner: 'Partner'` | delete both keys |
| app.js:170-200 | login type gate | keep; add the retired-role gate (§3.2) immediately before it |
| app.js:209 | `if (userProfile.role !== 'partner' && !(window.isLaidOff…` | drop the first term |
| app.js:578 | `if (role === 'president' \|\| role === 'owner' \|\| role === 'partner') return;` | drop `\|\| role === 'partner'` |
| app.js:1076-1098 | role-normalisation comment block mentions Partner drift | trim the partner sentences |
| app.js:1156-1160, 1164-1181 | mandatory-photo gate partner exemption | delete the `'partner'` terms; the gate's remaining guard is `!role` |
| app.js:1402 | comment `(admin / employee / partner)` | comment |
| app.js:1685 | `(isPartner() \|\| isBrilliantOnly() \|\| …)` **unguarded bare call** | drop `isPartner() \|\|` |
| app.js:1701 | `function isPartner() { return currentRole === 'partner'; }` | WS-A stubs to `return false`; WS-G deletes |
| app.js:1725-1734 | `isBrilliantPartner`, `isGenericPartner`, `partnerCompanyName` | WS-A stubs; WS-G deletes |
| app.js:1736-1757 | `_navVariant()` lines `const partner = isPartner(); if (partner && isGenericPartner()) return 'genericPartner'; if (partner) return 'partnerBS';` | delete the three lines; fix the comment |
| app.js:1894 | comment naming `'genericPartner'/'partnerBS'` | comment |
| app.js:2236-2258 | `renderQuoteBuilderIframe`: `partnerMode`, `?portal=partner`, generic-partner `pco*` params | `let qbSrc = 'quote-builder-v2.html';` and delete the block; rewrite the comment (recon said 2247-2258; the comment starts at 2236) |
| app.js:2278-2286, 2339-2340 | review banner copy "Save edits & Return to Partner" | copy → "Save edits & Return" |
| app.js:2355-2405 | `saveReviewedPartnerQuote` | keep logic; copy changes (§4.1.6) |
| app.js:2829 | `'partner-projects': 'cards'` in the skeleton map | delete entry |
| app.js:2975 | `else if (isPartner() \|\| isBrilliantOnly()) _pageScriptsKey = 'dashboard:partner';` **unguarded** | `else if (isBrilliantOnly()) _pageScriptsKey = 'dashboard:bsOnly';` |
| app.js:3038 | `case 'partner-projects': renderPartnerProjects(); break;` | delete |
| app.js:3482 | `case 'Partners': renderPartnersDept(); break;` | delete |
| app.js:3487-3498 | comments about the Partners dept move | delete |
| app.js:3733-3737 | `isPartnerU` = partner OR BS-only; hides Leave/Attendance | rename to `isBsOnlyU`, drop the `isPartner` term (§0.3) |
| app.js:4781, 5010 | `blocked = isPartner() \|\| isBrilliantOnly()` | drop the `isPartner` term |
| app.js:5090, 5105 | comments | trim |
| app.js:5141, 5192 | `if (typeof isPartner === 'function' && isPartner()) return false;` | delete the line |
| app.js:5217-5231 | `_qbPartner` BI refusal + comment | delete the whole block incl. `const _qbPartner` |
| app.js:5253 | `if (_qbPartner) return;` | delete |
| app.js:5454-5455 | `...((!_qbPartner && hasOwnProperty(payload,'sourceRef')) ? …)` | drop `!_qbPartner &&` |
| app.js:5466 | `linkQuoteToRequest(_qbPartner ? null : payload.sourceRef, …)` | `linkQuoteToRequest(payload.sourceRef, …)` |
| app.js:5547-5548 | `sourceRef: _qbPartner ? null : _qbCleanSourceRef(…)`, same for estimateCheck | drop the ternary |
| app.js:5559 | `createdByRole: currentRole \|\| 'partner',` | `createdByRole: currentRole \|\| 'unknown',` |
| app.js:5580-5584 | `upsertClient` partner early-return | delete the `if (… isPartner()) return null;` line |
| app.js:5759 | migration comment "company:'PT' rows are deliberately NOT moved" | leave (historical migration) |
| config.js:211, 307 | comments naming Partners | comment |
| config.js:241 | Sales `subtabs: […, 'Partner', …]` | `'Brilliant Steel'` |
| config.js:323-329 | `'Partners': { … isPartnerDept: true }` | delete the entry |
| config.js:332-368 | `window.isExternalPartnerUser` + its comment | delete entirely (WS-A) |
| config.js:468 | `ROLES.partner` | delete |
| config.js:512 | `TEAM_TYPES.partner` | delete |
| config.js:518, 528 | `teamTypeOf`: comment + `if (u.role === 'partner') return 'partner';` | delete |
| config.js:543-545 | `isAttendanceExempt` — freelancer only | no change |
| config.js:658 | `runAnnualAccrual`: `if (u.role === 'partner') { skipped++; continue; }` | replace with `if (u.removed === true) { skipped++; continue; }  // offboarded (incl. retired partner accounts) get no leave` |
| config.js:691 | comment listing variants | update |
| config.js:799-818 | sidebar `genericPartner`, `partnerBS` | delete both |
| config.js:819-825 | sidebar `bsOnly` | delete the `partner-projects` row only; fix the comment ("ISOLATED, single-dept non-partner user" → "internal staff whose only department is Brilliant Steel") |
| config.js:910-927 | bottom `genericPartner`, `partnerBS` | delete both |
| config.js:928-937 | bottom `bsOnly` | delete the `partner-projects` row; it drops from 7 to 6 items — `_bottomNavSplit` still caps at 5 + More, no other change |
| config.js:980-1010 | `PARTNER_VISIBLE_ROLES` + `fetchUsersWithPayroll` scoped-query branch | delete `PARTNER_VISIBLE_ROLES`, `scopedQ`, `viewerIsPartner`; the users read becomes `db.collection('users').get()` with **no** permission-denied fallback to a scoped query (it was partner-only). Keep the payroll half and `payrollDenied` untouched. Rewrite the comment. |
| config.js:1577 | `'dashboard:partner': ['js/screens/partners.js']` | rename key to `'dashboard:bsOnly'`; comment → `renderDashboard() -> renderBrilliantSteel()` |
| config.js:1648-1657 | PAGE_SCRIPTS BS + Partners block | delete `'dept:Partners'` and `'partner-projects'`; keep the four BS keys; fix the comment |
| config.js:1694 | comment "partner deals" | comment |
| config.js:2888, 2940-2941, 2957-2959 | CO.PT comments | comments; `QUOTE_COMPANIES.BS internal:false` stays |
| config.js:3422 | comment | comment |

**Bare-global usage (verified):** `isPartner(` / `isGenericPartner(` / `isBrilliantPartner(` / `partnerCompanyName(` / `isExternalPartnerUser(` appear in 14 files. **Unguarded** (no `typeof` guard, would throw ReferenceError once the definition is gone): `app.js:1685, 1728, 1729, 1746, 2975`; `dashboards.js:916, 7692`; the `isExternalPartnerUser` callers at `departments.js:2091`, `hr.js:1003`, `statutory-rates.js:989` (direct `window.` property reads — they return `undefined` and then throw "not a function"). `production.js` `isPartnerU` uses `currentRole==='partner'` directly (safe). Everything else is `typeof`-guarded.

### 1.2 Screens

**js/screens/partners.js (1043 lines)** — KEEP 186-385 (`renderBrilliantSteel`, `loadBSContent`, `renderBSFiles`, `renderBSClientData`). DELETE 386-1043 (`PARTNER_STAGE`, `renderPartnerProjects`, `renderPartnerDashboard`, `renderPartnersDept`, `loadPartnersDeptTab`, `_showAddDealModal`). Rewrite the header 1-185 (it is a Wave-7 provenance essay; replace with a ≤25-line header listing what the file holds and the shared helpers it calls as bare globals: `renderBSQuotationFiles`, `getBsQuotesOrdered`, `renderBSQuotationsSummary`, `renderClientProfiles`, `renderFileCollection`, `bindFileCollection`, `isBrilliantOnly`, `navigateTo`). Line 199 subtitle `Partner Company Operations` → `Brilliant Steel department`. Lines 216-221: `const partnerView = currentRole === 'partner' || (bs-only test)` → `const bsOnlyView = (typeof isBrilliantOnly === 'function') && isBrilliantOnly();` (§0.3 keeps the BS-only accordion). **Do not rename the file** (sw.js PRECACHE, PAGE_SCRIPTS, css comments all reference it; renaming buys nothing).

**js/screens/dashboards.js** — 916-917 `} else if (isPartner()) { await renderPartnerDashboard(); }` delete (unguarded). 930-937 comments delete. 1397 `users.filter(u=>u.role!=='partner')` → drop the filter (after purge no such users; keep `u.removed !== true` if present, else leave bare). 1862-1871 SOP card `'🤝 Partner Deal Process (50/50)'` → delete the whole card object. 1957 "for all staff and partners" → "for all staff". 3835, 4993 role filters → drop the `'partner'` term. 4210 "To our partners — thank you…" (company-history copy about business partners) → leave. 4329, 4710, 4994 BS-only hides → delete (§0.3 roster-shaped). 5434 `.filter(k => k !== 'Brilliant Steel')` dept key list → leave (dept chip list, not a person filter). 5618 `!(isPartner())` → drop. 7027 `team = empRole==='partner'?'partner':…` → drop the partner arm. 7689-7715 `renderHelp`: delete `extPartner`, `isAnyPartner`; `section = bsOnly ? 'bs' : pres ? 'admin' : 'employee'`; the chip arrays lose `{key:'partner',label:'Partner Guide'}` for admins; the BS-only branch gets `[{key:'bs',label:'Brilliant Steel Guide'},{suggestions}]`; `sections.bs = renderHelpBrilliantSteel`. 7958+ `renderHelpPartner` → rename `renderHelpBrilliantSteel`, rewrite its copy for internal BS staff (no "tap Partner on the login screen", no 50/50, no "partner portal"); keep the Quote Builder / Quotations / Client Data / Files walkthrough.

**js/screens/people.js** — 77-89 partner Posts view → delete the `if (partner)` branch. 397/406 `viewerIsPartner` → delete. 579-601, 630-646, 652, 677 `viewingAsPartner` → delete all branches (team tab renders the full internal view for everyone who reaches it). 636 BS-only hide → delete. 640 sort order drop `partner:5`. 741-742 company field + 761 `syncCompany` + 803 `team:` ternary partner arm → delete (the role select is `assignableRoles()` → `ROLES`, so the option disappears with `ROLES.partner`; delete `#inv-company-group`, `#inv-company`, `syncCompany`, and the `company:` key in the invite save). 1055, 1061 → drop the partner and BS-only terms. 1269 badge colour map `partner:'#FF6B6B'` → drop. 1325 DM button condition → `!isMe ? <button…> : ''`. 1678, 2238, 2545 `.filter(u => u.role !== 'partner')` → drop the term. 2744, 2870 → drop the `isPartner` half. 3037-3062 My Profile: `partner` const → delete; `tabs` is the non-partner array; `initial = window.initialSubtab('id')`; 3104-3110 the `account` sub-tab (partner-only read-only card with `partnerCompanyName()`) → delete. 3301-3311 `partner ? none : …` → always the real reads.

**js/chat.js** — 362 `.filter(d => !DEPARTMENTS[d].isSeparate && !DEPARTMENTS[d].isPartnerDept)` → drop the second term. 375 partner early-return → delete. 420-427 partner `dmCandidates` branch → delete; 434 `u.role !== 'partner'` → drop. 4783-4900 "partner containment" (`_viewerIsPartner`, `_roleIsPartner`, `_partnerBlockReason`, `_assertShareTargetSafe`) + 5004-5017, 5087-5101, 5139 call sites + 5943 test-seam exports → delete the whole mechanism (shared-chip label leakage only mattered for external readers). Check that nothing else consumes `_assertShareTargetSafe` (grep; it is exported only as a test seam and no test file references it — verified). 5999 `isPtnr` → delete and its uses.

**js/screens/production.js** — 1468-1470 `partnerUid` derivation → delete; 1488 `partnerUid,` → delete; 1489 `split:{ isShared: company==='BS', barroPct:50, partnerPct:50 }` → delete the key entirely (new docs carry no `split`). 1503, 1711 `isPartnerU = currentRole==='partner' || (bs-only)` → `isBsOnlyU = (typeof isBrilliantOnly==='function') && isBrilliantOnly()` and rename every use (1521, 1525, 1713, 1751, 1783-1784, 1836, 1859-1862). 1521 comment "partners: own + shared" → "BS-only staff: own + shared". 1841 "Partner share" row and 1991-2039 the Margin & Split modal's `partnerPct` input/share → delete the split UI (`pm-pct`, `pm-share`, `split.partnerPct`/`split.barroPct` updates, the `isShared` branches); the modal keeps `capital` only. 3598 `.filter(k => k !== 'Brilliant Steel' && k !== 'Partners')` → drop the Partners term.

**js/departments.js** — 132 comment, 148 `partnerUid: d.partnerUid || null,` in `Projects.normalize` → delete; 157-168 `listAll(scope)` → `listAll()` with no scope: single cached fetch of both collections (delete `scope.partner`, `scope.partnerUid`, the uncached branch). No caller passes a scope (verified by grep). 2086-2092 `buildPayRunLines`: delete the comment and the two lines `const isExternalPartner = …; const allStaff = …filter(…)` → `const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()}));` (`monthlyRunSkipReason` still skips `removed`, `production`, linked workers, period exclusions). 3915-3920 `editable: !(isPartner())` → `editable: true` (rewrite the comment). 5626 `if (r === 'secretary' \|\| r === 'partner') return false;` → drop the partner term.

**js/screens/sales.js** — 110 `salesTabs` `'Partner'` → `'Brilliant Steel'`; 113 aliases → `'Partner':'Brilliant Steel', 'Partner Quotes':'Brilliant Steel', 'Partner Files':'Brilliant Steel'` (keeps old deep links working). 130 help line → "Brilliant Steel is a read-only window into the department's quotes and files for coordination." 202-207 `case 'Partner':` → `case 'Brilliant Steel':`; banner copy → "Brilliant Steel — quotes & files shared with Sales for coordination."; `renderSalesPartnerQuotes` → rename `renderSalesBSQuotes` (1401, 1410, and the header comment at 18). 1409, 1426, 1448, 1462-1465, 1471 copy: "partner quotes" → "Brilliant Steel quotes", drop "(50/50 collaborative projects)" and "partners cannot see Barro Kitchens quotes", fallback name `'Partner'` → `'Brilliant Steel'`. 1947-1972 `isPartnerRole` + the `.filter(q => !isPartnerRole || …)` → delete (the `canSeeAll` query scoping stays). 2117 "partner quotations" → "Brilliant Steel quotations". 2594-2625 `resolveQuoteBrand` → **Phase 1: untouched** (PT docs may still be shared before the purge); **Phase 3 (WS-H)**: `const co = window.QUOTE_BRANDS[quote.company] ? quote.company : 'BS'; return { co, brand: window.QUOTE_BRANDS[co] };` and delete the PT synthesis. 2866 `window.currentRole !== 'partner' &&` → drop.

**js/screens/approvals.js** — keep all logic. Copy: 466/975 `d.data().agentName||'Partner'` → `'Staff'`; 538/1391 button "↩ Return to Partner" → "↩ Return"; 761/1431 prompt "Notes for the partner (what to revise)?" → "Notes for the submitter (what to revise)?"; 1497-1498, 1515 comments; 1529 `Notifs.error('Quote returned to partner.')` → `'Quote returned.'`; 1575 "Save & Return to Partner" → "Save & Return"; 1614 "saved back to the partner's quote… return it to the partner" → "saved back to the submitter's quote… or return it"; 1619 label "Notes for Partner" → "Notes for submitter"; 1642 `partnerUid: agentId` → `submitterUid: agentId` **only if** `app.js` `saveReviewedPartnerQuote` is updated in the same pass to read `ctx.submitterUid` (WS-A owns app.js; WS-C owns approvals.js — coordinate: **keep the key name `partnerUid`** to avoid cross-WS coupling; it is internal). 1678 "returned to partner" → "returned". Function names `returnQuoteToPartner`, `saveReviewedPartnerQuote` are **kept** (tests pin them; renaming is optional and NOT done in this spec). `svc-approvals.js:200` unchanged.

**Small sites (one-line each)** — `inventory.js:59` `if (currentRole === 'partner' || window.isExternalPartnerUser?.(window.userProfile)) return;` → delete the line and its comment (55-58); `inventory.js:66,121` drop the `'partner'` terms. `hr.js:1003-1004` → `const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()}));` and delete the comment 996-1002. `statutory-rates.js:255-262` delete `_isExternalPartner`; 268 drop the `.filter`; 985-989 drop `!window.isExternalPartnerUser(u) &&`, fix comment. `employee-profile.js:1190-1196` → `.map(...)` with no partner filter; fix comment. `layoff.js:27, 240, 578` drop the partner terms. `notes.js:561` delete the line. `drive.js:637` delete. `meetings.js:675` → `if (u.removed === true) return;`. `family-pricing.js:38` → `if (role === 'secretary') return false;` (and update `tests/family-staff.test.mjs:137-153` which asserts `can('partner', …) === false` — those assertions become trivially true with an unknown role; keep them, they still pass, but change the `it` titles that say "never a partner"). `payroll-backfill.js:221` drop `|| u.role === 'partner'`. `calendar-feed.js:22,155` comments. `notifications.js:245` `partner_deal:{icon:'🤝',accent:'#1C7ED6'}` → delete. `tasks.js:29`, `dept-budgets.js` comments. `crm.js:142` comment.

### 1.3 Login screen (index.html)

1371-1374: delete the `<button class="login-role-card" data-type="partner" …>` block. 140, 227, 1598 comments → leave (1598 describes `#deal-modal-close`, which disappears with `_showAddDealModal`; update that comment to say the `.modal-close` rules are now orphaned-but-harmless, or leave — either is fine). `css/styles.css:1412` `.nav-item[data-page="partner-projects"]` rule → delete (ci-invariants check 6 only demands a rule per NAV page; extra rules are harmless, but remove for hygiene); comments 1407, 2850, 8132-8204 → leave.

### 1.4 Quote builder (quote-builder-v2.html)

Definitions: 2176 `PARTNER_BLOCKED_COS`; 2671-2688 `PARTNER_MODE`, `_PQ`, `PARTNER_CO_NAME`, `GENERIC_PARTNER`, `CO.PT` synthesis; 2689-2760 `applyPartnerMode()`; 2769-2770 boot `setCompany(GENERIC_PARTNER ? 'PT' : (PARTNER_MODE ? 'BS' : 'BK')); applyPartnerMode();`; 2781 `if(PARTNER_MODE) setCompany(…)`; 2868 setCompany lock; 2893 `co==='BS'||co==='PT'`; 6552 `currentCo!=='PT'`.

Guard sites (55 non-comment lines, verified): 1872(comment) 2476 2516 2672 2677 2678 2690 2698 2710 2727 2749 2769 2781 2838 2868 2988 4033 4260 4311 4327 4338 4738 4756 4784 4801 4816 5016 5153 5313 5335 5356 5436 5452 5471 5486 5519 5535 6545 6955 7165 7228 7326 7379 7384 7452 7459 7496 7507 7575 8346 8360 8442 8799 9710 9842. Treat `PARTNER_MODE` and `GENERIC_PARTNER` as constant `false` (§4.5 rewrite rules).

Tutorial: `TUTORIAL_VERSION = 43` at 9403; `WHATS_NEW` at 9408; user-visible tour copy at ~9613 says "Partners never see this button." → must change (§4.5).

### 1.5 Rules, storage, indexes, functions, scripts

- `firestore.rules`: `isPartner()` defined at 25, **118 occurrences**. Partner-specific blocks: 73 (`isHrDept` role check), 138-139 (users `list` carve-out), 159 (users create allowlist contains `'partner'`), 248-249 (posts `dept=='Partners'` carve-out), 1282-1302 (`bs_quotes` comment + `!isPartner()` in read), 1385-1395 (`partner_deals`), 2217-2229 (`job_projects` `partnerUid` read term + `!isPartner()` update term).
- `storage.rules`: 126-128 `isPartnerClaim()`; uses at 289, 291, 373-374, 391-396, 404-411, 419; comments 18-51, 334-354.
- `firestore.indexes.json:161-171`: `partner_deals (partnerUid ASC, createdAt …)`.
- `functions/index.js:664-720` `syncUserClaims` mirrors `users/{uid}.role` + `departments` onto Auth custom claims on every users write (skips `pendingPasswordSetup`), and clears claims on doc delete. 3444, 4196 `if (uidRole.get(uid) === 'partner') return;` notification drops (pinned by `tests/quote-request.test.mjs:1174`, `cir-project-brief.test.mjs:588/637`, `quote-request-callables.test.mjs:84/539/722/747`).
- `scripts/check-backup-coverage.js:56` and `scripts/sync-to-drive.js:71` list `partner_deals`; `scripts/monthly-backup.js` enumerates collections dynamically (no literal).
- `sw.js:103` `/js/screens/partners.js` — stays (file stays).
- Pattern to mirror for the purge script: `scripts/flip-top-gauge-default.js` (pure transform exported + `run(db, opts)` + `parseArgs` + `main` that checks args BEFORE loading firebase-admin/reading `FIREBASE_SERVICE_ACCOUNT` via `require('./drive-lib').requireEnv`; `module.exports` + `require.main === module`). Its test `tests/flip-top-gauge.test.mjs` is the pattern for the purge test (in-memory fake db; spawnSync for the CLI arg check).
- Offboarding convention already in the app: `users/{uid}.removed === true` (+ `removedAt`, `removedBy`) — set by People → Remove; **app.js's auth gate blocks login on this flag** and `monthlyRunSkipReason` returns `'removed'` (departments.js:2001-2006). The purge reuses it (§4.6).

### 1.6 Recon-map corrections

- `app.js` `?portal=partner` block starts at 2236 (comment) / 2247 (code), not only 2247-2258.
- `departments.js` Projects service: `listAll(scope)` has no callers that pass a scope — the whole scope mechanism can go, not just the partner filter.
- The recon missed `config.js:658` (`runAnnualAccrual` partner skip), `config.js:241` (Sales subtab label), `notifications.js:245`, `dashboards.js:1862` (SOP card), `people.js:1055/1061/1269/1678/2238/2545`, `production.js:1991-2039` (split modal), `hr.js:3200` (a department NAME list for payslip grouping — keep), and the `removed:true` convention.
- `statutory-rates.js:258-262` is a *second*, hand-rolled copy of the exclusion (with the old `length === 1` test) — delete it too.
- `chat.js` partner containment is ~120 lines (4783-4900) plus three call sites, not a single line.

---

## 2. Phasing and deploy sequence

The constraint: CLAUDE.md says rules land BEFORE the code that needs them, but deleting the `!isPartner()` clauses while partner Auth accounts still exist would WIDEN those accounts' access. So the rules cleanup is the LAST phase, after the accounts are disabled.

| Phase | What ships | Rules deploy | Code deploy | Partner accounts during the phase |
|---|---|---|---|---|
| **1 — code removal** (WS-A…WS-E, WS-G) | all client/quote-builder/screen code; **one** tightening rules edit: remove `'partner'` from the users-create allowlist (rules:159) so no new partner account can be minted | `bash scripts/release.sh rules` BEFORE `release.sh push` | `release.sh push` (one commit, hook-bumped version) | still exist, still role `partner`; **cannot sign in** (§3.2 retired-role gate signs them out with a message); every `!isPartner()` rule still denies them server-side |
| **2 — data purge** (WS-F) | `scripts/partner-data-purge.js` committed with Phase 1 (code), **run** after the owner sees the dry-run counts and approves | none | none (script run locally by the owner/operator with `FIREBASE_SERVICE_ACCOUNT`) | disabled in Auth, claims cleared, users doc `removed:true` + `role:'removed'`; partner-made data deleted (backup JSON written first) |
| **3 — rules & scripts cleanup** (WS-H) | delete `isPartner()` + every clause, `partner_deals` rule + index, storage `isPartnerClaim`, backup/sync entries, functions notification-drop lines, `resolveQuoteBrand` PT fallback, test updates, docs | `release.sh rules` then `release.sh storage` then `cd functions && npm run deploy` (functions only if 3444/4196 are removed) | `release.sh push` | none remain with role `partner` (Phase 2 verified `count == 0`) |

Phase 3 is only safe once the purge's post-apply verification prints `users with role partner: 0` and `Auth accounts enabled with claim role partner: 0`. WS-H's first acceptance check is that line pasted into STATUS.md.

Deploy commands (existing): `bash scripts/release.sh` (drift report), `release.sh rules|storage|functions`, `release.sh push`, `release.sh verify`.

---

## 3. Cross-cutting mechanics

### 3.1 Stub-then-sweep for the bare globals

1. **WS-A (first, sequential)** replaces the four app.js predicates with constant stubs and a marker comment:
   ```js
   // PARTNER-REMOVAL-SPEC §3.1 — temporary stubs; WS-G deletes them once the gate test passes.
   function isPartner() { return false; }
   function isBrilliantPartner() { return false; }
   function isGenericPartner() { return false; }
   function partnerCompanyName() { return 'Brilliant Steel'; }
   ```
   and deletes `window.isExternalPartnerUser` **outright** (its three unguarded callers are all in WS-D's files, which WS-D edits in the same release; until WS-D lands, Payroll/HR/statutory would throw — acceptable inside one uncommitted release, NOT acceptable to commit. The commit gate test in §3.3 enforces this).
2. **WS-B…WS-E** sweep every caller (table in §1).
3. **WS-G** deletes the stubs and adds the gate test. Nothing may be committed while a stub exists (gate test asserts the marker comment is absent).

### 3.2 The retired-role login gate (Phase 1 → removed in Phase 3)

Removing `ROLE_TYPE_MAP.partner` means `ROLE_TYPE_MAP['partner'] || 'employee'` resolves to `'employee'`, so an existing partner account could sign in through the **Employee** portal during Phases 1-2 and receive staff chrome (`_navVariant()` → `'staff'` or `'bsOnly'`) while the rules deny most reads — confusing and leak-prone through anything the rules do allow. Close it in app.js's `onAuthStateChanged` success path, immediately **before** the login-type gate (~line 170), after `loadUserProfile` has set `currentRole`:

```js
// PARTNER-REMOVAL-SPEC §3.2 — the external partner feature is retired. Until the
// data purge (Phase 2) retires the accounts themselves, refuse the role here, the
// same way the users.removed flag is refused. Case-insensitive: production carries
// 'Partner' drift. WS-H deletes this block in Phase 3.
if (String(currentRole || '').trim().toLowerCase() === 'partner') {
  window._navDepth = 0; window._navFwd = 0; window._wantLogin = true;
  await auth.signOut();
  showLogin();
  document.getElementById('login-role-picker')?.classList.add('hidden');
  document.getElementById('login-form-wrap')?.classList.remove('hidden');
  const pw = document.getElementById('password'); if (pw) pw.value = '';
  setLoginLoading(false);
  setTimeout(() => showLoginError(`${emojiIcon('⚠️',16)} This partner account has been retired. Please contact Barro Industries.`), 80);
  selectedLoginType = null;
  return;
}
```
Mirror the existing `removed` gate's exact sequence — it is the `if (userProfile && userProfile.removed === true) { … }` block at app.js:156 (comment from 146), which already sits before the login-type gate; place the new block directly after it and copy its sign-out/show-login choreography rather than the sketch above if they differ. This is the ONE allowed `'partner'` role literal in `js/` during Phases 1-2 (gate test allowlist, §3.3).

### 3.3 Gate test — `tests/partner-removal.test.mjs` (WS-G, Phase 1; extended in WS-H)

Static, no Firestore. Reads files with `fs` like the other static tests. Assertions:

1. **Forbidden identifiers** in `js/**/*.js` (recursively, excluding `js/vendor/`), `quote-builder-v2.html`, `index.html`, `css/styles.css`, counting only non-comment lines (strip `//…` and `/* … */` the way `tests/quote-builder-static.test.mjs` does for `SCRIPT`): none of `isPartner(`, `isGenericPartner(`, `isBrilliantPartner(`, `partnerCompanyName(`, `isExternalPartnerUser`, `PARTNER_VISIBLE_ROLES`, `isPartnerDept`, `PARTNER_MODE`, `GENERIC_PARTNER`, `PARTNER_CO_NAME`, `PARTNER_BLOCKED_COS`, `applyPartnerMode`, `portal=partner`, `pcoName`, `partner-projects`, `partner_deals`, `renderPartnerProjects`, `renderPartnerDashboard`, `renderPartnersDept`, `loadPartnersDeptTab`, `_showAddDealModal`, `PARTNER_STAGE`, `renderHelpPartner`, `_qbPartner`, `genericPartner`, `partnerBS`, `dashboard:partner`, `dept:Partners`, `_partnerBlockReason`, `_roleIsPartner`, `_viewerIsPartner`, `'Partners'` (the dept key, quoted), `data-type="partner"`, `CO.PT`, `'PT'` inside `quote-builder-v2.html` (the pass-through chip label `'PT'` at ~7452 is the one legitimate hit — allow exactly that line by anchoring on `togglePassThrough`), the §3.1 stub marker comment.
2. **Role literal allowlist**: every non-comment occurrence of `'partner'` / `"partner"` / `=== 'partner'` in `js/**` must be on a line that matches one of: the §3.2 gate (`PARTNER-REMOVAL-SPEC §3.2` marker within 6 lines above), an AEC stage context (`sales.js` lines containing `AEC_STAGES`/`AEC_TERMINAL`/`aecStageOf`/`aecProspected`, `crm.js` lines containing `stage`, `notifications.js` line containing `AEC_TERMINAL`). Print every offending line. In WS-H the gate allowlist entry is removed (the gate itself is deleted).
3. **Registries**: evaluate `js/config.js` in a `vm` context with a stub `window` (pattern: `tests/contact-details.test.mjs` `pageScripts()`): `ROLES` has no `partner`; `TEAM_TYPES` has no `partner`; `DEPARTMENTS` has no `Partners` and `Brilliant Steel` still has `isSeparate:true`; `NAV_REGISTRY.sidebar` and `.bottom` have no `genericPartner`/`partnerBS`, `bsOnly` exists in both with no `page:'partner-projects'`; `PAGE_SCRIPTS` has `dashboard:bsOnly`, the four `bs-*`/`dept:Brilliant Steel` keys, and no `dashboard:partner`/`dept:Partners`/`partner-projects`; `QUOTE_COMPANIES.BS` still exists with `internal:false`; `QUOTE_COLLECTIONS` still `['bk_quotes','bs_quotes']`.
4. **index.html** has exactly two `login-role-card` buttons (`admin`, `employee`).
5. **partners.js** still defines `window.renderBrilliantSteel` and the strings `loadBSContent`, `renderBSFiles`, `renderBSClientData`; `app.js` still has `case 'bs-quotations'`, `case 'bs-clients'`, `case 'bs-files'`, `case 'Brilliant Steel':`.
6. **sw.js** PRECACHE still lists `/js/screens/partners.js`.
7. **Money (§5.4)** — see WS-D.
8. **Phase 3 additions (WS-H)**: `firestore.rules` contains no `isPartner`, no `partner_deals`, no `'Partners'`, no `partnerUid`; `storage.rules` contains no `isPartnerClaim`; `firestore.indexes.json` has no `partner_deals`; `scripts/check-backup-coverage.js` and `scripts/sync-to-drive.js` have no `partner_deals`; `functions/index.js` has no `=== 'partner'` (except the AEC stage at ~1043 — allow by `terminal` on the line).

### 3.4 check-ui-wiring / ci-invariants impacts

- **check-ui-wiring (hard fail class c)**: every inline `onclick="fn()"` must resolve to a window global. Deleting `renderPartnerProjects`, `_showAddDealModal`, `loadPartnersDeptTab`, `renderHelpPartner`, `applyPartnerMode`, `setCompany('PT')` string (`partners.js`, `dashboards.js`, `quote-builder-v2.html`) is safe ONLY if every template that references them is deleted in the same pass. The script scans `js/**` + `index.html` (+ two public pages), **not** `quote-builder-v2.html`. Run it after each WS.
- Class (a)/(b) warnings for ids that vanish (`deal-modal-close`, `inv-company`, `pm-pct`, `pm-share`, `help-content` stays) are warn-only; if any allowlist entry in `scripts/ui-wiring-allowlist.json` names a deleted id, remove the entry (a stale allowlist entry does not fail, but keep it clean).
- **ci-invariants check 2 / PAGE_SCRIPTS-exists**: unaffected as long as `js/screens/partners.js` stays and `PAGE_SCRIPTS` paths exist. Check 6 (drawer icons): the `bsOnly` variant loses `partner-projects`; no new page is added, so no new CSS rule is needed. Check 9 (public-site partner-brand guard): untouched; **do not** add the string "Brilliant Steel" to any public surface (index.html `<head>`/`#site`, `js/site.js`, catalogue, etc.) — the Sales-tab rename and help copy live in app screens, which check 9 does not scan (verify by running it). Check 11 (site view): untouched.
- **Precache manifest**: regenerated by the hook; never hand-edit.

### 3.5 Test-impact table (every test that breaks, and the fix)

| Test | Lines | Why it breaks | Fix (owner WS) |
|---|---|---|---|
| `tests/contact-details.test.mjs` | 246-250 | requires PAGE_SCRIPTS keys `dashboard:partner`, `dept:Partners`, `partner-projects` | list becomes `['dashboard:bsOnly','dept:Brilliant Steel','bs-quotations','bs-clients','bs-files']`; title → "no Brilliant Steel page loads it (the configurator is not offered on the BS pages)" (WS-G) |
| `tests/quote-link.test.mjs` | 104-105 (`currentRole: opts.partner ? 'partner' : 'employee'`, `isPartner`), 299-305 ("a partner session never links"), 388-395, 427-449 (regexes `_qbPartner ? null :`), 472-480, 529 (`isPartner`, `isGenericPartner` stubs), 534-538 (`?portal=partner&reopen=1`) | `_qbPartner` gone; `?portal=partner` gone | delete the three partner `it`s (299, 388, the partner half of 472-480); 427-449: regexes become `/linkQuoteToRequest\(payload\.sourceRef, \{ docId, coll: collection,/`, `/sourceRef:\s+_qbCleanSourceRef\(payload\.sourceRef\),/`, `/estimateCheck:\s+_qbCleanEstimateCheck\(payload\.estimateCheck\),/`; 534-538: assert `src="quote-builder-v2\.html\?reopen=1"` only and delete the `partner: true` run; remove `isPartner`/`isGenericPartner`/`opts.partner` from both harnesses (WS-G; the harness changes are mechanical) |
| `tests/approvals-quote-sync.test.mjs` | 32, 102 (function name — unchanged, passes), 285-293 (`/returned to partner/` toast regex), 352 (title only) | toast copy changes to "Quote returned." | 293: `/returned\./` ; 285/352 titles → "Return (list / registry)…", "a Brilliant Steel quote (bs_quotes, no sourceRef)…" (WS-C, since it owns approvals.js copy) |
| `tests/quote-builder-static.test.mjs` | 285-296 (anchor `if (!PARTNER_MODE) {`), 303-308 (`applyPartnerMode.toString()`), 660-664, 937-942, 1223-1228, 1312 (title only), 1646 (title only) | `PARTNER_MODE`/`applyPartnerMode` gone | 285-296: replace `branch` with the new marker comment the rewrite inserts (`// option sheets — internal sessions only` → after this spec simply `const branch = HTML.indexOf('const sheetSnap = await db.collection', from)` and keep `read > from && read < branchEnd`; drop the `branch > 0 && read > branch` clause); delete the `it` at 303, 660, 937, 1223's `p` half; retitle 1312/1646 to drop "a partner" (WS-E) |
| `tests/pricing-core.test.mjs` | 1020-1033 | same `if (!PARTNER_MODE) {` anchor | 1032-1033: assert the read sits between `from` and `to` and inside a `try {` (same as the static test) (WS-E) |
| `tests/family-staff.test.mjs` | 137-153 (`can('partner',…)` — still passes, retitle), 1115-1133, 1199-1203 (regexes `isAuth\(\) && !isPartner\(\) && …`) | Phase 3 rules cleanup removes `!isPartner()` | **Phase 3 only (WS-H)**: regexes become `/isAuth\(\) && \(isSeniorAdmin\(\) \|\| canFinance\(\)\)/`, `/isAuth\(\) && \(isSeniorAdmin\(\) \|\| canFinance\(\) \|\| cirWriter\(\)\)/`, `/allow read: if isAuth\(\);/`; delete 1131's `!isPartner` assertion; retitle. Until Phase 3 these pass unchanged. |
| `tests/quote-request.test.mjs` 1174, `tests/cir-project-brief.test.mjs` 588/637, `tests/quote-request-callables.test.mjs` 84/539/722/747 | pin `uidRole.get(uid) === 'partner'` and seed a `u_partner` user that must be dropped | **Phase 3 only (WS-H)** if the functions drop lines are removed | WS-H: delete the `u_partner` seeds and the "drops the partner" clauses; 1174 assertion removed. (Alternative: leave functions untouched in Phase 3 — the drop line is harmless dead code. **Recommended: remove**, so the gate test's functions rule holds.) |
| `tests/flip-top-gauge.test.mjs` | — | unaffected (pattern source only) | — |
| new `tests/partner-removal.test.mjs` | — | §3.3 | WS-G, extended by WS-H |
| new `tests/partner-data-purge.test.mjs` | — | §4.6 | WS-F |

Run `node --test tests/*.test.mjs` after each WS; the full suite must be green before the Phase 1 commit.

---

## 4. Workstreams

Execution order: **WS-A first (alone)**. Then **WS-B, WS-C, WS-D, WS-E, WS-F in parallel** (disjoint files). Then **WS-G** (gate, stub deletion, docs, STATUS). Phase 2 is an operator action. **WS-H** last (Phase 3). Each WS edits ONLY the files listed under it. If an implementer finds a partner reference in a file outside their list, they report it to the coordinator — they do not edit it.

### WS-A — predicates, registries, login, quote-builder bridge (Phase 1; sequential, first)

**Files:** `js/app.js`, `js/config.js`, `index.html`, `css/styles.css`.

Edits: every `app.js` and `config.js` row in §1.1 (stubs per §3.1, gate per §3.2), `index.html:1371-1374`, `css/styles.css:1412`. Specifics not already spelled out:

1. `fetchUsersWithPayroll` after the edit:
   ```js
   window.fetchUsersWithPayroll = async function() {
     const [uSnap, pSnap] = await Promise.all([
       db.collection('users').get(),
       db.collection('payroll').get().catch((e) => ({ docs: [], _denied: !!(e && e.code === 'permission-denied'), _error: e }))
     ]);
     … (unchanged merge + payrollDenied)
   };
   ```
   Keep the "SILENT-ZERO CHOKE POINT" comment on the payroll read verbatim.
2. `saveReviewedPartnerQuote` copy: prompt → `'Notes for the submitter (what changed / what to confirm)?'`; success toasts → `'Approved with edits + submitter notified'` / `'Edited & returned'`; banner (2283-2284) → "…then save it back." and button "Save edits & Return"; comment 2355-2356 → "Save the president's edits back onto the submitter's OWN quote doc…". Keep `ctx.partnerUid` as the key name (approvals.js sets it).
3. `renderQuoteBuilderIframe` comment 2236-2246 → three lines: "Every signed-in user gets the full builder. Internal staff whose only department is Brilliant Steel are Barro employees (owner ruling 2026-09-01). The external partner portal was retired (PARTNER-REMOVAL-SPEC)."
4. `_navVariant()` comment 1736-1739 → "(admin → brilliant-only → workerB → staff)".
5. `config.js:819` bsOnly comment: "Internal staff whose ONLY department is Brilliant Steel (owner ruling 2026-09-01: Barro employees; isolated chrome kept)".

Acceptance: `node --check js/app.js js/config.js` pass; `node scripts/check-ui-wiring.js` reports no new hard fail; `bash scripts/ci-invariants.sh` passes (check 2/6/9); `grep -c "partner-projects\|genericPartner\|partnerBS\|'Partners'" js/config.js` → 0; `grep -n "ROLE_TYPE_MAP" js/app.js` shows no partner; the §3.2 block exists; the four §3.1 stubs exist with the marker comment. Tests: `contact-details` will now fail on `dashboard:partner` — expected until WS-G.

### WS-B — partners.js, dashboards.js, people.js (Phase 1)

**Files:** `js/screens/partners.js`, `js/screens/dashboards.js`, `js/screens/people.js`.

Edits: §1.2 rows for the three files. Additional precision:
- `partners.js`: after deleting 386-1043, confirm no remaining reference to `partnerCompanyName`, `isGenericPartner`, `partner_deals`, `navigateTo('partner-projects')`, `#deal-modal-close`. The `renderBSClientData` accordion stays verbatim.
- `dashboards.js` `renderHelpBrilliantSteel` copy: hero "Brilliant Steel Guide — Quote builder, quotations, client data and files"; steps: Quote Builder (BS pill is preselected on the bs-quote-builder page — verify by reading `setCompany` boot logic after WS-E: the builder boots on `BK`; the BS page sets company via the parent bridge — read `app.js renderQuoteBuilderIframe` for how `bs-quote-builder` selects BS and describe that truthfully, or say "choose the Brilliant Steel pill"), Quotations Summary, Client Data, Files; approvals ("Send for approval → the President reviews → approved/returned with notes"); no money-split language.
- `people.js` invite form: after removing the company field, the save payload must not write `company:`; grep `inv-company` → 0.
- `people.js:3104-3110` delete the `account` sub-tab renderer; `initialSubtab('id')`.

Acceptance: `node --check` on the three files; `node scripts/check-ui-wiring.js` no hard fail (specifically no `onclick` pointing at `_showAddDealModal`, `loadPartnersDeptTab`, `renderHelpPartner`); `grep -n -i "partner" js/screens/partners.js` → only the file path in the header (or 0); `grep -n "isPartner()\|renderPartnerDashboard\|renderHelpPartner\|Partner Deal" js/screens/dashboards.js` → 0; `grep -n "viewingAsPartner\|viewerIsPartner\|partnerCompanyName\|inv-company\|'partner'" js/screens/people.js` → 0.

### WS-C — chat, production, sales, approvals (Phase 1)

**Files:** `js/chat.js`, `js/screens/production.js`, `js/screens/sales.js`, `js/screens/approvals.js`, `tests/approvals-quote-sync.test.mjs`.

Edits: §1.2 rows. Precision:
- `chat.js` 4783-4900: delete `_viewerIsPartner`, `_roleIsPartner`, `_partnerBlockReason`, `_assertShareTargetSafe` and the three call sites (5004-5017 `guardPostRef` filter → `filter: null`; 5087-5101 `filter: cv => …` → remove the key; 5139 `const why = _partnerBlockReason(conv, fresh); if (why) …` → delete the check). Remove the five names from the IIFE's return object at 5943. If `_assertShareTargetSafe` wraps a real safety check for non-partner reasons (read it first), keep that non-partner part.
- `production.js` split modal (1985-2040): remove `isShared`, `pm-pct`, `pm-share`, `split.*` writes, the audit `partnerPct` field; the modal becomes capital-only. 1836 card title "Margin & Split" → "Margin"; 1841 row deleted.
- `sales.js` `resolveQuoteBrand`: **do not touch in this WS** (Phase 3).
- `approvals-quote-sync.test.mjs:293` → `assert.ok(S.toasts.some((t) => t.t === 'error' && /returned\./.test(t.m)));` and the two titles.

Acceptance: `node --check` × 4; `node --test tests/approvals-quote-sync.test.mjs` green; `grep -n "partnerUid\|partnerPct\|isPartnerU" js/screens/production.js` → 0 (reads of legacy `p.split` are gone too); `grep -n -i "partner" js/chat.js` → 0 non-comment lines; `grep -n "isPartnerRole\|'Partner'" js/screens/sales.js` → only AEC lines (1494-1527, 1891-1933 "AEC PARTNER CONTACT SHEET" — that is a contact-sheet title about architects/engineers/contractors, keep); `grep -n -i "to partner\|for partner\|the partner" js/screens/approvals.js` → 0.

### WS-D — payroll / HR / statutory / profile / inventory rosters + project service (Phase 1, **money change**)

**Files:** `js/departments.js`, `js/screens/hr.js`, `js/screens/statutory-rates.js`, `js/screens/employee-profile.js`, `js/screens/inventory.js`, `js/screens/layoff.js`, `js/screens/notes.js`, `js/drive.js`, `js/meetings.js`, `js/screens/family-pricing.js`, `js/screens/payroll-backfill.js`, `js/calendar-feed.js`, `js/notifications.js`, `js/screens/crm.js` (comment), `js/screens/tasks.js` (comment), `js/screens/dept-budgets.js` (comment), `tests/family-staff.test.mjs` (titles at 130-153 only), and the money test in `tests/partner-removal-payroll.test.mjs` (new).

Edits: §1.2 "Small sites" + the `departments.js` rows. Precision for the money path:
- `buildPayRunLines` (departments.js:2053+): the roster is `usersSnap.docs.map(...)` with NO filter. Everything downstream (`monthlyRunSkipReason`: `removed`, `production`, linked worker profiles, period exclusions) is unchanged. The comment replacing 2086-2090: "Everyone on `users` is a candidate (owner ruling 2026-10-28: Brilliant Steel staff are Barro employees; the external partner role is retired). Who is actually paid is decided by monthlyRunSkipReason below, never by department."
- `hr.js:1003-1004`, `statutory-rates.js:255-268 & 985-989`, `employee-profile.js:1190-1196`: same shape — no department/role roster filter.

**Test (required, money):** `tests/partner-removal-payroll.test.mjs`, static + vm, mirroring the `piece()` extraction style of `tests/approvals-quote-sync.test.mjs`:
1. Extract `window.buildPayRunLines` from `js/departments.js` as text; assert it contains no `isExternalPartnerUser`, no `Brilliant Steel`, no `'partner'`, no `isSeparate`, and that the roster line is exactly `const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()}));`.
2. Extract `window.monthlyRunSkipReason` and run it in a vm: a user `{ id:'bs1', role:'employee', departments:['Brilliant Steel'] }` → returns a falsy reason (is paid); `{ …, removed:true }` → `'removed'`; `{ …, payClass:'production' }` → `'production'`. This pins that nothing else in the skip chain reintroduces a dept-based exclusion.
3. Same textual pin for `renderPayrollManagement` (hr.js), `renderStatutoryStatusSection` + `renderOfficeSplitSection` (statutory-rates.js), `_epLoadRoster` (employee-profile.js): no `isExternalPartnerUser`, no `_isExternalPartner`, no `Brilliant Steel` filter.
4. `js/config.js` evaluated in vm: `typeof window.isExternalPartnerUser === 'undefined'`.
**Mutation test (document in the test header, per CLAUDE.md):** in a scratch copy (never the shared tree) re-insert `.filter(u => !(u.departments||[]).includes('Brilliant Steel'))` on the roster line → assertion 1 fails; make `monthlyRunSkipReason` return `'external'` for a BS-only user → assertion 2 fails; re-add a `_isExternalPartner` helper in statutory-rates.js → assertion 3 fails. List the mutants and that each was killed.

Acceptance: `node --test tests/partner-removal-payroll.test.mjs tests/family-staff.test.mjs tests/statutory-status.test.mjs tests/payroll-*.test.mjs tests/weekly-*.test.mjs tests/basekpi-pay.test.mjs tests/taskbased-pay.test.mjs` green; `grep -rn "isExternalPartnerUser\|_isExternalPartner" js/` → 0; `grep -n "scope\.partner\|partnerUid" js/departments.js` → 0; `node --check` on every file touched.

### WS-E — quote builder (Phase 1)

**Files:** `quote-builder-v2.html`, `tests/quote-builder-static.test.mjs`, `tests/pricing-core.test.mjs`. (Skill contract: `.claude/skills/quote-builder-tutorial/SKILL.md` — read it first.)

Rewrite rules (apply mechanically, line by line, to the 55 sites in §1.4):
- `const PARTNER_MODE = …`, `const _PQ = …`, `const PARTNER_CO_NAME = …`, `const GENERIC_PARTNER = …`, the `if (GENERIC_PARTNER) { CO.PT = {…} }` block, `function applyPartnerMode(){…}` (2689-2760 inclusive), `const PARTNER_BLOCKED_COS=['BI'];` + its comment (2171-2176): **delete**. Note: `_PQ` must not be used elsewhere (grep; if `_PQ.get(` appears outside the deleted block, keep `const _PQ = new URLSearchParams(location.search);` alone).
- `if (PARTNER_MODE) return X;` / `if (GENERIC_PARTNER) return X;` / `if (typeof PARTNER_MODE!=='undefined' && PARTNER_MODE) return;` → delete the statement.
- `if (!PARTNER_MODE) { … }` / `if (typeof PARTNER_MODE!=='undefined' && !PARTNER_MODE && cond)` → unwrap the block (keep its body; keep `cond`).
- `PARTNER_MODE ? a : b` → `b`; `!PARTNER_MODE && cond` → `cond`; `PARTNER_MODE || cond` → `cond`; `CONFIGURATOR_ON && !PARTNER_MODE && …` → `CONFIGURATOR_ON && …`.
- `GENERIC_PARTNER ? 'PT' : (PARTNER_MODE ? 'BS' : 'BK')` → `'BK'` (boot 2769); delete 2770 `applyPartnerMode();`; delete 2781.
- 2868 setCompany lock → delete the statement and the 2860-2867 comment.
- 2893 `co==='BS'||co==='PT'` → `co==='BS'`.
- 2988 `if (!GENERIC_PARTNER) document.body.classList.toggle(…)` → unconditional toggle; delete the 2983-2987 comment.
- 2476/2516 `FAMILY_PRICING_STATE=PARTNER_MODE?'skipped':'offline'; CONFIGURATOR_ON=!PARTNER_MODE;` → `FAMILY_PRICING_STATE='offline'; CONFIGURATOR_ON=true;`; the `if (!PARTNER_MODE) {` at 2516 is unwrapped — the `try { const sheetSnap = await db.collection('product_pricing').get(); … }` stays inside `loadDatabase()` in its own `try`. Remove `'skipped'` from the `FAMILY_PRICING_STATE` comment at 2208.
- 5356 `if (GENERIC_PARTNER) return '';` → delete; fix the 5347-5353 comment ("internal staff on the BS toggle").
- 6552 `&&currentCo!=='PT'` → delete the term.
- 7452 `(PARTNER_MODE || (item.familyId && !item.passThrough)) ? '' : …` → `(item.familyId && !item.passThrough) ? '' : …` (the `'PT'` chip label stays).
- 9710 `if(typeof GENERIC_PARTNER==='undefined' || !GENERIC_PARTNER){ … }` → unwrap; 9842-9843 `genericPartnerTrap` → delete, `if(pillOk) setView(tourSavedView);`.
- Comments that explain the removed behaviour (1183, 1212, 1442, 1517, 1761, 1819, 2097, 2113, 2143, 2165, 2173, 2838 area, 3089-3136, 5124, 6620, 7225, 7319, 9578-9590): delete or trim to the non-partner sentence. Leave `CO.BS` and every BS comment.
- **Tutorial**: `TUTORIAL_VERSION = 44`; prepend to `WHATS_NEW`: `'The external partner portal is retired. Brilliant Steel staff use the same builder as everyone else: pick the Brilliant Steel pill for a BS quote — every BS line still carries the pass-through tick. Nothing changes for Barro Kitchens or Barro Industries quotes.'`; tour body at ~9613 drop "Partners never see this button."; ~9630 WHATS_NEW historical entries mentioning partners (27, 30 in the `awk` listing) stay as history. Sync the Help copy per the skill.

Tests: §3.5 rows for `quote-builder-static` and `pricing-core`. Add one new `it` in `quote-builder-static.test.mjs`: "the partner portal is gone: no PARTNER_MODE / GENERIC_PARTNER / applyPartnerMode / CO.PT in the script, `?portal=partner` boots as a plain internal session (BK selected, Admin button present, configurator available)" — `makeEnv({ search: '?portal=partner' })` then assert `currentCo === 'BK'` (or whatever the boot default is after the rewrite), `document.getElementById('btnAdmin')` exists, `CONFIGURATOR_ON === true`.

Acceptance: `grep -c "PARTNER_MODE\|GENERIC_PARTNER\|applyPartnerMode\|PARTNER_CO_NAME\|PARTNER_BLOCKED_COS\|CO\.PT\|portal=partner" quote-builder-v2.html` → 0; `grep -n "'PT'" quote-builder-v2.html` → only the `togglePassThrough` chip line; `node --test tests/quote-builder-static.test.mjs tests/pricing-core.test.mjs tests/qb-configured.test.mjs tests/quote-link.test.mjs` — the first two green, quote-link expected red until WS-G; the builder still boots in the browser (`npx serve -p 3737 .`, open `/quote-builder-v2.html`, `/quote-builder-v2.html?portal=partner`): BK/BI/BS pills present, Admin button present, BS pill shows the pass-through tick, no console ReferenceError.

### WS-F — `scripts/partner-data-purge.js` + test (committed in Phase 1, RUN in Phase 2)

**Files:** `scripts/partner-data-purge.js` (new), `tests/partner-data-purge.test.mjs` (new). Mirror `scripts/flip-top-gauge-default.js` structure exactly (pure selection exported, `run(deps, opts)`, `parseArgs`, `main` that validates args before loading firebase-admin, `requireEnv('FIREBASE_SERVICE_ACCOUNT')` from `./drive-lib`, `module.exports`, `require.main === module`).

**CLI**
```
node scripts/partner-data-purge.js                      # DRY RUN: counts only, writes nothing
node scripts/partner-data-purge.js --backup <dir>       # dry run + writes a JSON export of every doc it would touch
node scripts/partner-data-purge.js --backup <dir> --apply   # applies; REFUSES without --backup in the same invocation
node scripts/partner-data-purge.js --help
```
`--apply` without `--backup` → exit 1 before any credential is read. Unknown option → exit 1. `--backup` dir is created; refuse if it already contains a `manifest.json` (no accidental overwrite).

**Selection (pure, exported, tested)** — `select(snapshots)` takes plain arrays (`users`, `bs_quotes`, `partner_deals`, `approval_requests`, `posts`, `conversations`, `job_projects`, `notificationsByUid` optional) and returns `{ partnerUids, users, bsQuotes, partnerDeals, approvalRequests, posts, conversationsWhollyPartner, conversationsMixed, jobProjectsTagged, notifications }`:
- `partnerUids` = users whose `String(role).trim().toLowerCase() === 'partner'` **or** `team === 'partner'` **or** `title` lower-trimmed `=== 'partner'` **or** `departments` includes `'Partners'` (or `department === 'Partners'`). Any user matching only the title/dept arm but with role `president`/`manager`/`secretary`/`finance` is **excluded and reported under `needsLook`** (never disable an admin by accident).
- `bsQuotes` = docs where `createdByRole === 'partner'` **or** `createdBy ∈ partnerUids` **or** `company === 'PT'`; `draft_<uid>` ids for `uid ∈ partnerUids` are included too.
- `partnerDeals` = every doc in `partner_deals`.
- `approvalRequests` = docs whose `agentId ∈ partnerUids` **or** `quoteId ∈ ids(bsQuotes)`.
- `posts` = `dept === 'Partners'` **or** `authorId ∈ partnerUids`.
- `conversationsWhollyPartner` = conversations whose member set (`members`/`participants` — read the conversations schema in chat.js first and use the real field) minus `partnerUids` is empty, or `type === 'dept' && dept === 'Partners'`. `conversationsMixed` = any other conversation with ≥1 partner member — **reported only, never deleted** (OWNER QUESTION Q4).
- `jobProjectsTagged` = `partnerUid ∈ partnerUids` — **reported only, never deleted or edited** (real Barro projects keep their legacy fields).
- `notifications` = every doc in `notifications/{uid}/items` for `uid ∈ partnerUids`.
Everything is id-keyed; the function never mutates its inputs.

**Dry-run output**: counts per bucket, the `partnerUids` list with `displayName` + `email`, the `needsLook` list, the `conversationsMixed` count, `jobProjectsTagged` count. **Never** a quote total, price, item, client name, phone, or message body.

**Backup** (`--backup`): `<dir>/manifest.json` (counts, timestamp, project id, selection version), plus one JSON file per collection holding `{ id, data }` for every doc to be touched (quotes, deals, approval requests, posts, wholly-partner conversations **with their `messages` subcollection**, notification items, and the full users docs), plus `auth-users.json` (uid, email, disabled, customClaims) for the partner uids. Firestore Timestamps serialised as ISO strings with a `__ts` marker (`restore-from-backup.js` conventions — read it and match).

**Apply** (only with `--backup` in the same run, after the backup is fully written and `manifest.json` fsynced):
1. Users: for each partner uid `users/{uid}.update({ role:'removed', prevRole:<raw role>, removed:true, removedAt:<serverTimestamp>, removedBy:'scripts/partner-data-purge.js', removedReason:'partner-feature-retired', departments:[], department:'' })`. `syncUserClaims` re-mints claims as `{role:'removed', departments:[]}`; the script ALSO calls `admin.auth().setCustomUserClaims(uid, { role:'removed', departments:[] })` and `admin.auth().updateUser(uid, { disabled:true })` itself (belt and braces; tolerate `auth/user-not-found`).
2. Delete in batched writes of ≤400: notification items, posts, approval requests, bs_quotes, partner_deals, wholly-partner conversations (messages subcollection first, then the conversation doc).
3. Post-apply verification re-queries and prints: `users with role partner: N`, `partner_deals: N`, `bs_quotes partner-made: N`, `Auth accounts enabled with claim role partner: N`. All must be 0; non-zero → exit 2 with the list.

**Why disable + `removed:true` rather than hard-delete (recommendation):** (a) `bs_quotes`/`job_projects`/audit docs join to `users/{createdBy}` for display names — deleting the users doc turns history into "Unknown"; (b) the app already treats `removed:true` as "cannot sign in, not on payroll" (app.js auth gate, `monthlyRunSkipReason`), so no new convention is needed; (c) `role:'removed'` matches no `getRole()` literal in the rules → server denies everything even if a token survived; (d) `syncUserClaims` clears the `partner` claim so storage.rules' `isPartnerClaim()` is moot before Phase 3; (e) Auth `disabled:true` is reversible, a hard delete is not. The Auth accounts can be hard-deleted later in the Firebase console once the owner is satisfied.

**Test (`tests/partner-data-purge.test.mjs`)**, no Firestore: `select()` with fixtures (lowercase/capitalised role, `team:'partner'`, title-only, dept-only, an admin with title "Partner" → `needsLook`, quotes by role / by uid / by `PT` / a `draft_<uid>` / a staff BS quote that must NOT be selected, a staff `bk_quotes`-style doc not in the input, mixed vs wholly-partner conversations, tagged job projects reported only); `run()` with an in-memory fake: dry run writes nothing and prints counts only (assert the log contains no fixture client name / total); `--backup` writes the manifest and one file per bucket; `--apply` without a backup in the same run throws before touching the fake; apply disables the Auth fake, sets the users fields listed above, deletes exactly the selected ids and nothing else, and the verification query returns zeros. CLI: `spawnSync` for `--apply` alone (exit 1, no credential read), unknown flag, `--help`. Document the mutants killed (≥12: each selection arm removed, the admin guard removed, staff BS quote selected, apply without backup allowed, users deleted instead of updated, Auth not disabled, a bucket skipped, a non-selected doc deleted, counts printing a total, verification skipped).

Acceptance: both files exist, `node --test tests/partner-data-purge.test.mjs` green, `node scripts/partner-data-purge.js --apply` exits 1 with the "needs --backup" message and no credential prompt.

### WS-G — gate test, stub deletion, remaining test fixes, docs, STATUS (Phase 1, after A-F)

**Files:** `tests/partner-removal.test.mjs` (new), `js/app.js` (delete the §3.1 stubs ONLY), `tests/contact-details.test.mjs`, `tests/quote-link.test.mjs`, `CLAUDE.md`, `STATUS.md`, `scripts/ui-wiring-allowlist.json` (only if a deleted id is listed).

1. Write the gate test (§3.3 items 1-6).
2. Delete the four stubs and the marker comment in app.js.
3. Fix `contact-details` and `quote-link` per §3.5.
4. `CLAUDE.md`: line 9 "…and an external partner (Brilliant Steel) sign in to role- and department-scoped tabs" → "…sign in to role- and department-scoped tabs"; roles list (line ~55) drop `partner`; departments list drop `Partners`; "The login screen enforces a portal/role match (admin/employee/partner)" → "(admin/employee)".
5. `STATUS.md`: a dated entry at the top (what shipped, what is pending); under "Pending deploys & one-time actions": **(1)** Phase 1 rules deploy (`release.sh rules` — users-create allowlist tightening) BEFORE push; **(2)** Phase 2: run `node scripts/partner-data-purge.js` dry run → paste counts to the owner → owner approves → `--backup <dir> --apply` → paste the verification zeros; **(3)** Phase 3: WS-H. Under "Open rulings": the §7 questions.
6. Run the full gates: `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`. Then a browser smoke (`npx serve -p 3838 .`): login screen shows two cards; sign in as the president → Sales tab has a "Brilliant Steel" subtab that lists BS quotes; Approvals → a pending quote's "Return" button works and the toast says "Quote returned."; Brilliant Steel dept → Quote Builder / Quotations Summary / Client Data / Files; Help has no Partner Guide; People → Invite has no Company field; no console `ReferenceError`.

**Phase 1 commit**: one commit, message `feat(partners): retire the external partner feature (code) — PARTNER-REMOVAL-SPEC phase 1`, hook bumps the version. Then `release.sh rules` → `release.sh push` → `release.sh verify`.

### WS-H — Phase 3 rules, storage, indexes, scripts, functions, docs (after the purge verification shows zeros)

**Files:** `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `scripts/check-backup-coverage.js`, `scripts/sync-to-drive.js`, `functions/index.js`, `js/app.js` (delete the §3.2 gate only), `js/screens/sales.js` (`resolveQuoteBrand` only), `tests/family-staff.test.mjs`, `tests/quote-request.test.mjs`, `tests/cir-project-brief.test.mjs`, `tests/quote-request-callables.test.mjs`, `tests/partner-removal.test.mjs` (extend per §3.3 item 8), `docs/firestore-rules-notes.md`, `STATUS.md`.

1. `firestore.rules`: delete line 25; delete every `!isPartner() &&` / `&& !isPartner()` / `( !isPartner() || …)` clause (118 sites) — where a rule becomes `isAuth() && (resource.data.createdBy == request.auth.uid || true …)` simplify to `isAuth()`; 73 → `return u.get('department','') == 'HR' || …`; 138-139 → `allow list: if isAuth();`; 248-249 → `allow read: if isAuth();`; 1282-1302 `bs_quotes` → read `isAuth()`, create/update/delete unchanged; 1385-1395 `partner_deals` block deleted (no rule → deny-all, which is what we want for a deleted collection); 2220 → `allow read: if isAuth();`, 2225 `(resource.data.createdBy == request.auth.uid || !isPartner())` → drop the whole parenthesis (`isAuth() && (!affectedKeys… || canFinance())`). Keep the ci-invariants check-8 size headroom (deleting only shrinks it). Each `[RN-n]` marker whose note explains a partner clause → update the paragraph in `docs/firestore-rules-notes.md` (99 hits; trim the partner sentences, do not renumber anchors).
2. `storage.rules`: delete `isPartnerClaim()` and every `!isPartnerClaim() &&` / `(!isPartnerClaim() || isMemberOf(department))` → `isMemberOf(department)` **only if** that was the intent for internal users — read the comments at 334-354 first: for `/{department}/{subfolder}/{fileName}` the partner clause widened access for internal users (any signed-in non-partner could reach any department folder). Keep the internal behaviour unchanged: `(!isPartnerClaim() || isMemberOf(department))` → delete the term entirely (internal users were already allowed). Trim comments 18-51.
3. `firestore.indexes.json`: delete the `partner_deals` index object.
4. `scripts/check-backup-coverage.js:56`, `scripts/sync-to-drive.js:71`: remove `partner_deals`.
5. `functions/index.js:3444, 4196`: delete the drop lines (and the comment at 3404-3408 sentences about partners). Update the three functions tests per §3.5. Deploy functions.
6. `js/app.js`: delete the §3.2 gate block.
7. `js/screens/sales.js` `resolveQuoteBrand`: per §1.2.
8. `tests/family-staff.test.mjs` per §3.5; extend `tests/partner-removal.test.mjs` with §3.3 item 8 and remove the §3.2 allowlist.
9. `STATUS.md`: record the three deploys with timestamps; close the "pending" items.

Deploy order for Phase 3: `release.sh rules` → `release.sh storage` → `cd functions && npm run deploy` → `release.sh push` → `release.sh verify`. (Rules shrink access for nobody and widen only for signed-in internal users on the carve-outs that were partner-specific; no code in the push depends on the new rules, so the order is just the house rule.)

---

## 5. Acceptance summary per phase

**Phase 1 done when:** all gates green; `tests/partner-removal.test.mjs` and `tests/partner-removal-payroll.test.mjs` exist and pass; `grep -rn "isPartner(" js/ quote-builder-v2.html` → 0; the §3.2 gate exists; `firestore.rules:159` allowlist has no `'partner'`; rules deployed before the push; STATUS.md updated; browser smoke done.

**Phase 2 done when:** the owner has approved the dry-run counts in writing; `--backup <dir> --apply` ran; the verification printed four zeros; `<dir>/manifest.json` exists and its path is recorded in STATUS.md; a monthly-backup-style Drive copy of `<dir>` is made (operator step).

**Phase 3 done when:** rules/storage/functions deployed; `tests/partner-removal.test.mjs` extended checks pass; `grep -rn -i "isPartner\|partner_deals\|isPartnerClaim" firestore.rules storage.rules firestore.indexes.json scripts/*.js functions/index.js` → 0; STATUS.md closes the item.

### 5.4 Money-change requirement (CLAUDE.md)

WS-D's payroll roster change is the only money path touched. `js/money-core.js` is not edited. The test in WS-D is mandatory and must be mutation-tested in a scratch copy (list the mutants in the test header). A payroll run after Phase 1 will, for the first time, include BS-only staff who have a `payroll/{uid}` doc; staff without one compute with `salary || 0` exactly as any other employee without a payroll doc (the existing `payrollDenied`/silent-zero handling is unchanged). → OWNER QUESTION Q3.

---

## 6. Out of scope (deliberately)

- Renaming `js/screens/partners.js`, `returnQuoteToPartner`, `saveReviewedPartnerQuote`, `_qbReviewContext.partnerUid`, `renderSalesPartnerQuotes` beyond what §1.2 says (only `renderSalesPartnerQuotes` → `renderSalesBSQuotes`).
- Backfilling or stripping `partnerUid` / `split` / `company:'PT'` on existing `job_projects` / `bs_quotes` that survive the purge (staff-made BS quotes never carry PT; tagged job projects keep their fields).
- Hard-deleting Firebase Auth accounts (console action after the owner is satisfied).
- ROADMAP.md (frozen history) and historical specs under `specs/` — not edited.
- The public-site partner-brand guards — not touched, and the word "Brilliant Steel" must not be added to any public surface by any WS.

---

## 7. OWNER QUESTIONS (answer before the relevant WS starts; defaults in brackets are what the spec implements if unanswered)

- **Q1 — Account disposition.** Disable + claims cleared + `users/{uid}` → `role:'removed', removed:true` (recommended, §4.6), or hard-delete the Auth user and the users doc? [Disable + removed.]
- **Q2 — BS-only chrome restrictions (§0.3).** Now that BS-only staff are employees on payroll, should global search, Files Hub, the Leave/Attendance links, the keyboard-hint, the BS-only dashboard landing, the own/shared project scoping and the BS Client Data accordion ALSO open up to them (i.e. drop `isBrilliantOnly()` from those gates too), or keep the isolated chrome exactly as today? [Keep as today; only the `isPartner()` halves are dropped. Attendance reminders already run for them (app.js:209 after the edit), so if they are attendance-paid the Attendance link should probably come back — flagging explicitly.]
- **Q3 — Payroll inclusion effect.** After Phase 1 the next monthly run lists BS-only staff. Do all of them already have `payroll/{uid}` docs with a salary set, or should Finance review the roster before the next Compute? [Spec adds a one-line note to STATUS.md; no code.]
- **Q4 — Mixed conversations.** DM threads between staff and a partner: delete (loses the staff side) or keep (partner side becomes a disabled account; the thread stays readable to staff)? [Keep; reported only.]
- **Q5 — Partner-made `approval_requests` and the quotes they point to.** The purge deletes both. Any history Finance wants preserved beyond the JSON backup? [Delete; backup is the record.]
- **Q6 — Functions notification-drop lines** (`functions/index.js:3444, 4196`). Remove in Phase 3 (needs a functions deploy + three test edits) or leave as dead code? [Remove.]
- **Q7 — `job_projects` 50/50 split UI.** The Margin & Split modal and "Partner share" row are removed for NEW and OLD projects alike (old docs keep `split` but nothing shows it). Confirm nobody needs to read the historical split on-screen. [Remove.]

## 8. OWNER ANSWERS (2026-10-28) — these override the bracketed defaults in §7

- **Q1 → HARD-DELETE.** The purge `--apply` deletes partner Auth users (`admin.auth().deleteUser`) and their `users/{uid}` docs (plus any per-user subcollections/docs keyed by those uids that the backup captured, e.g. `notifications/{uid}`, `payroll/{uid}` if present). Not reversible except from the JSON backup — the `--backup` precondition is therefore mandatory. Old records may show an unknown author; UI must tolerate a missing user doc without throwing.
- **Q2 → KEEP AS TODAY.** All `isBrilliantOnly()` restrictions stay; only `isPartner()` halves are dropped.
- **Q3 → "There are no BS staff."** The only Brilliant-Steel-only accounts are the partner's. WS-D still removes the BS exclusion (future BS hires are employees) and keeps its mandatory mutation-tested test, but no roster reminder is needed. The purge dry run must ALSO report (count only) any account whose departments are exactly ['Brilliant Steel'] but whose role is not 'partner', so the owner can confirm none exist — such accounts are NOT deleted.
- **Q4 → DELETE** mixed staff–partner conversations as well (and their messages subcollections), in addition to wholly-partner ones. Backed up first.
- **Q5, Q6, Q7 → defaults** (delete; remove; remove).
