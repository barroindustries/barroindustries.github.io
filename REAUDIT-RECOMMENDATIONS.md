# V14 Post-Release Re-Audit — 223 recommendations

_10-agent full-system sweep · 2026-08-03 · v14.0.9 · zero duplicates · ranked by impact then effort._

**Impact:** 37 High · 99 Medium · 87 Low  
**Effort:** 158 Small · 64 Medium · 1 Large  
**Kind:** 65 bug · 57 quality · 24 ux · 23 security · 19 perf · 13 feature · 11 a11y · 11 data

20 items are High-impact + Small-effort — the priority queue.

---

### 1. Missing composite index breaks the Type-B worker home screen's finance section
`H-impact · S-effort · Bug · infra-pwa`  
js/screens/worker.js:484 runs `db.collection('payslips').where('workerId','==',profile.id).orderBy('createdAt','desc').limit(5)` inside a `Promise.all` (lines 477-486) with no per-query `.catch()`. firestore.indexes.json's only two payslips composite indexes are `(payPeriodMonth ASC, createdAt DESC)` and `(workerId ASC, payPeriodStart ASC)` — neither covers equality-on-workerId + orderBy-createdAt. Without that exact composite index provisioned in the live Firebase project, this query throws FAILED_PRECONDITION at runtime; because it's un-caught inside the Promise.all, the whole thing rejects and worker.js's outer try/catch (line 487-489) renders 'Could not load finance data' for the ENTIRE section — including the week/month attendance summaries fetched in the same Promise.all, not just the payslip history. Add the composite index to firestore.indexes.json and deploy it, and/or add a `.catch(()=>({docs:[]}))` to this specific query so an index gap degrades gracefully instead of blanking the screen.

### 2. scripts/check-backup-coverage.js's collection scanner is blind to js/screens/*.js — misses geo_sites, finance_config, and others
`H-impact · S-effort · Bug · infra-pwa`  
`scanRootCollections()` (scripts/check-backup-coverage.js) does `fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'))` with NO recursion into js/screens/. Ran the script directly: it reports only 60 root collections and completely misses `geo_sites` (only referenced in js/screens/hr.js:1686,1716,1790 and js/screens/worker.js:273) and `finance_config` (only in js/screens/finance.js:907,1130) — both real, actively-written collections. Since Wave 7 (2026-08-03, the same day as this review) moved 10 department screens into js/screens/*.js, this CI drift-detector has been silently broken for anything referenced only in those files since this morning. It won't crash (monthly-backup.js's actual runtime export uses `db.listCollections()` so real backups aren't affected), but the whole point of this CI job — nudging a human to review NEW collections for EXCLUDE/OVERRIDES treatment — no longer fires for roughly half the codebase. Fix: recurse into js/screens/ (and any future subdirectory) when building `scanned`.

### 3. Add a CI invariant asserting CACHE_VER's version suffix matches APP_VERSION
`H-impact · S-effort · Quality · infra-pwa`  
scripts/ci-invariants.sh already checks two invariants (z-index literals, PRECACHE completeness) but has no check that `CACHE_VER = 'bi-ops-vX.Y.Z'` in sw.js matches `APP_VERSION = 'X.Y.Z'` in js/config.js. Given finding #1, this is the exact place to catch drift from the stale hook, a bad manual edit, or a merge conflict that reverts one file but not the other — currently nothing would fail CI if they diverged.

### 4. CACHE_VER auto-derivation depends on a manual per-clone git config with no CI safety net
`H-impact · S-effort · Bug · infra-pwa`  
The live default hook `.git/hooks/pre-commit` (not tracked by git) still contains the OLD buggy bump logic: `SW_CUR=$(grep -o "bi-ops-v[0-9]*" sw.js | head -1 | grep -o "[0-9]*$")` captures only the digits immediately after 'v' (stops at the first '.'), so on 'bi-ops-v14.0.8' it captures '14', increments to '15', and rewrites the string to 'bi-ops-v15.0.8' — reproduced this exact behavior in a scratch test. Each subsequent commit repeats this, so CACHE_VER's fake 'major' climbs by 1 per commit while APP_VERSION correctly bumps its patch digit, and the two diverge completely (e.g. after 20 commits: CACHE_VER≈'bi-ops-v34.0.8' vs APP_VERSION='14.0.28'). The FIXED version lives only in the tracked `.githooks/pre-commit` and requires every clone/machine to run `git config core.hooksPath .githooks` once (confirmed set in this repo copy, currently in sync at 14.0.9/14.0.9) — but nothing enforces that config, and `scripts/ci-invariants.sh` never checks that CACHE_VER's suffix equals APP_VERSION. A fresh clone, CI runner, or teammate machine silently falls back to the broken hook with zero warning.

### 5. A manager can self-promote to President with a direct users/{uid} write
`H-impact · S-effort · Security · firestore.rules — users update rule`  
firestore.rules:139-143: `allow update: if isAuth() && (isSeniorAdmin() || (isOwner(uid) && userPrivilegedFieldsUnchanged()) || (isAdmin() && userPrivilegedFieldsUnchanged()))`. The first disjunct, `isSeniorAdmin()`, is true for role 'manager' and carries NO owner restriction and NO privileged-fields-unchanged check — unlike the other two branches. A manager can therefore write `role:'president'` (and department/employeeId/salary/username) onto their OWN user doc in one direct Firestore write, bypassing the President-only role-elevation intent the WS19 comments describe. The comment block claims this closed the self-escalation hole for secretary/isAdmin(), but the isSeniorAdmin() branch itself is still an open self-escalation path for 'manager'.

### 6. Manager/Secretary can hijack ANY account (incl. President) via hrManagedAccount + adminResetPassword
`H-impact · S-effort · Security · firestore-rules + functions/index.js (users update / adminResetPassword)`  
userPrivilegedFieldsUnchanged() (firestore.rules:86-99) freezes role/salary/allowance/deductions/department/departments/employeeId/username on non-senior-admin updates, but NOT `hrManagedAccount`. Any isAdmin() (manager OR secretary) can therefore update ANY existing user doc — including the President's — setting `hrManagedAccount: true` via the ordinary update rule at firestore.rules:139-143 (branch 3: `isAdmin() && userPrivilegedFieldsUnchanged()` passes because hrManagedAccount isn't checked). The caller (a manager, who is also in adminResetPassword's allowed-caller list) then calls the `adminResetPassword` callable (functions/index.js:216-248), whose only server-side precondition on the target is `targetSnap.data().hrManagedAccount === true` — no check that the target isn't more privileged than the caller. Net effect: a manager account can silently reset the President's (or any other manager's) Firebase Auth password and take over the account, with zero audit trail.

### 7. Error/success message colors never adapted for Light theme — likely fail contrast
`H-impact · S-effort · A11y · css-a11y`  
css/styles.css:393-402 `.error-msg`/`.success-msg` use hardcoded #FF7066-on-rgba(255,69,58,.08) and #4DE87A-on-rgba(48,209,88,.08). Neither selector is redefined anywhere in html.light (grep for 'html.light .error-msg' / '.success-msg' returns nothing), yet these colors were tuned for the near-black dark/astral canvas. Computed against a near-white Light background the pairs land around ~2.5:1, well under the 4.5:1 AA text minimum — meaning form-validation error/success text (used across every finance/payroll/quote form in the app) can be very hard to read for Light-theme users at exactly the moment it matters most.

### 8. Approvals 'All Requests' tab grants only a 2-hour attendance extension and skips the employee notification
`H-impact · S-effort · Bug · screens-misc`  
approvals.js:385-395 hand-writes attendance_extensions with a hardcoded `ext.setHours(ext.getHours()+2)` and only shows a local toast to the approver — never calling Notifs.send to the employee. The dedicated Attendance sub-tab (approvals.js:1057-1073, labelled 'Approve (6-hr)') instead calls the canonical window.approveAttendanceExtension (app.js:2017-2035), which grants window.ATT_EXT_HOURS=6 hours (config.js:131) and pushes a notification to the employee. Same action, same collection, two different outcomes depending on which tab the approver clicked from — an employee approved via 'All Requests' gets 1/3 the intended grace window and no heads-up.

### 9. Partner dashboard 'My Quotations' / pipeline totals double-count revised quotes
`H-impact · S-effort · Bug · screens-misc`  
partners.js:543-544 fetches bs_quotes for the partner with no window.latestQuoteRevisions dedup; totalQVal (:557), needsRevision/pendingApproval/filedQuotes (:596-598) all sum raw docs. A partner who revises one quote 3 times sees their own quote count, pipeline value, and 'Returned for Revision' badge inflated 3x on their own dashboard — same bug class as the just-fixed Sales analytics, but on the partner-facing surface.

### 10. President dashboard Quote Pipeline KPI double-counts revised quotes
`H-impact · S-effort · Bug · screens-misc`  
js/screens/dashboards.js:805-806,894 sums activeQuotes (bk_quotes+bs_quotes+legacy) with no chain-dedup, so a quote re-filed as R1/R2/R3 counts 2-3x toward 'Quote Pipeline'. sales.js:844 already ships window.latestQuoteRevisions() and renderSales (dashboards.js:4370-4402) was just fixed to use it ('Owner report 2026-08-03' comment) but this exec-facing Command Center KPI was never updated to match.

### 11. "Adjust Balance" overwrites leave balance instead of adding to it
`H-impact · S-effort · Data · people-chat`  
js/screens/people.js:2038-2039 the Vacation/Sick inputs in openGrantModal default to value="0" (not the employee's current balance), and the save handler (line 2050) does `leave_balances.doc(uid).set({vacation, sick, ...}, {merge:true})` — an absolute overwrite, not an increment. An admin who means "grant 2 more vacation days" and types 2 will silently wipe out any existing unused balance down to 2, with no confirmation and no display of what's being replaced.

### 12. recordPurchaseDisbursement shows an Inventory-overstatement warning but never blocks Save on it
`H-impact · S-effort · Bug · production`  
production.js:2521-2531 (`acctWarn()`) computes a real mismatch — e.g. 'Nothing from this PR landed in stock — booking it as an Inventory asset will overstate inventory' — but the `rec-save` click handler (line 2544 on) never reads that warning state. Finance can click straight through it and post a non-stocked purchase as an Inventory asset with zero confirmation gate.

### 13. Reopen buttons on both Quotations lists silently break the revision chain
`H-impact · S-effort · Bug · Revision-chain integrity`  
`.bk-reopen-btn` (sales.js:1025-1030, 1060) and `.bs-reopen-btn` (sales.js:1805-1816, and inside chain-history rows at 930) set `window._qbReopenState = q.editableState` directly and navigate, bypassing `window.reopenQuoteFromDoc` (app.js:1575-1588) which is the only path that stamps `sourceDocId`/`sourceCollection`/`rootQuoteId`. Because these fields are missing, refiling a quote reopened via these buttons always gets `parentQuoteId:null, rootQuoteId:null` (app.js:3392-3393) and self-stamps a brand-new `rootQuoteId` (app.js:3429-3431) — so `buildQuoteChains` (sales.js:878-892), the flagship Wave 7 revision-chain UI, never links the refiled copy back to the original's history. Only `newRevisionFromDoc`-driven 'New Revision' clicks chain correctly; 'Reopen' — the more commonly used action — never does. Fix by routing both buttons through `window.reopenQuoteFromDoc(collection, id, navTarget)`.

### 14. Missing Firestore composite index breaks every worker's own Recent Payslips tile
`H-impact · S-effort · Bug · hr-worker`  
js/screens/worker.js:484 queries db.collection('payslips').where('workerId','==',profile.id).orderBy('createdAt','desc').limit(5) inside the Promise.all in _loadWorkerFinance. firestore.indexes.json only defines (workerId ASC, payPeriodStart ASC) at lines 76-83 — there is no (workerId, createdAt DESC) index. Equality-filter + orderBy-on-a-different-field always needs an explicit composite index in Firestore, so this query throws 'the query requires an index' on every load, which the catch block (worker.js:487-495) turns into a permanent 'Could not load finance data' error card for every Type-B worker until the missing index is added to firestore.indexes.json and deployed.

### 15. Deactivating a worker_profiles doc (status:'inactive') does not stop self-service clock-in
`H-impact · S-effort · Security · hr-worker`  
js/screens/worker.js:82-88 (_resolveWorkerProfile) and firestore.rules:269-284 (isLinkedWorkerUid) never check `profile.status`; only payClass==='production' on the linked users/ doc gates routing (js/app.js:1013, 1884). HR's only offboarding affordance for a factory worker is toggling Status to 'inactive' in the profile form (hr.js:1545-1548) — which has zero effect on a linked account's ability to keep timing in/out, uploading selfies, and accruing attendance after termination. Terminating access requires disabling the users/ login separately, which isn't documented anywhere in this flow.

### 16. Ledger edit modal's Category dropdown silently corrupts almost every expense row's category on save
`H-impact · S-effort · Bug · finance`  
finance.js:1339's editFields for collection:'ledger' hardcodes options ['Sales Revenue','Operating Expense','Payroll','Tax','Materials','Utilities','Journal Entry (Non-cash)','Other'] — but real expense categories (js/config.js COA.expense, lines 1326-1328) are 'COS – Direct Material', 'COS – Direct Labor', 'Payroll Expense', 'Operating Expense', 'Utilities', 'Tax', 'Materials', 'General Expense', 'Other Expense'. financeEditModal's select renderer (finance.js:143) only marks an option `selected` on an exact string match; when none matches (true for Payroll Expense, both COS categories, General Expense, Other Expense — i.e. most real ledger rows), the browser defaults to the first option, and financeEditModal's save handler (finance.js:154-160) unconditionally writes upd.category from that select's current value. Result: opening the edit modal on e.g. a Payroll Expense row to fix a typo in the description, then saving, silently rewrites that row's category to 'Sales Revenue' — corrupting Income Statement category grouping (finance.js:735, keys off e.category first), Break-even classification, CSV exports and General Ledger sectioning for that row.

### 17. Cash-advance release ledger write bypasses window.Ledger, reintroducing the fail-open dedupe bug it was built to kill
`H-impact · S-effort · Bug · finance`  
config.js:1747-1766 (CashAdvance.approve) posts the CA-{id} 'Advances to Employees' debit via a raw db.collection('ledger').add() guarded by a manual `.where('refNumber','==',lref).limit(1).get().catch(()=>({docs:[]}))` dedupe query — exactly the fail-open pattern finance-ledger.js's header (KEY DESIGN DECISIONS #1) says the whole Ledger service exists to eliminate (a rules error or network blip silently returns 'empty' and double-posts). This is the one remaining money-posting call site never migrated onto Ledger.post/upsertByRef despite the Phase 13 migration map in finance-ledger.js documenting every other poster.

### 18. CashAdvance.request() has no floor validation for admin-issued amounts — negative amount slips through
`H-impact · S-effort · Bug · core-shell`  
js/config.js:1647-1651: `if (!amt || (!isAdminIssued && amt < 100)) throw ...`. For the admin-issued path (isAdminIssued=true, e.g. the president recording a CA for an employee), the ₱100 minimum is intentionally skipped, but there is no independent `amt > 0` check. `parseFloat('-500')` yields -500, which is truthy (`!amt` is false) and the `amt<100` branch is short-circuited by `!isAdminIssued` being false — so a negative amount passes validation entirely and writes a cash_advances doc with amount:-500, balance:0 (balance is hardcoded 0 at creation), status:'pending'. Once approved, CashAdvance.approve()'s interest math (`cur.amount * Math.pow(1+pct/100, terms)`) would compute a negative totalPayable/monthlyPayment, corrupting downstream payroll deduction plans.

### 19. Mandatory profile-photo gate can bury the critical backup/sync alert banner
`H-impact · S-effort · Bug · core-shell`  
renderBackupHealthBanner (js/app.js:237-247) renders at z-index var(--z-system-banner,9995), gated to president/manager/secretary/finance. requireProfilePhoto's blocking overlay (js/app.js:707-752) renders 800ms later at z-index var(--z-splash,9999) with `position:fixed;inset:0` and a 92%-opaque backdrop — covering the ENTIRE viewport including the banner. Any admin/finance user who is both missing a profile photo and has a stale backup/sync job (the exact audience the banner is meant to warn) will have the ops alert visually buried behind an undismissable full-screen photo prompt within a second of login, with no way to see or act on the alert until they upload a photo.

### 20. checkBackupHealth() can never actually push-notify the President — PRESIDENT_UID doesn't exist
`H-impact · S-effort · Bug · core-shell`  
js/app.js:219-233: window.Notifs.send(PREZ_UID, ...) is gated on `const PREZ_UID = window.PRESIDENT_UID`, which the same comment block admits doesn't exist as a real uid anywhere (js/modules.js:39 only has a module-scoped PRESIDENT_UID holding an EMAIL string, not a uid). So the push branch is permanently skipped and only the in-app banner (visible solely to whoever is currently logged in with an admin/finance role) ever fires. notifications.js already ships the exact role-based lookup this needs — Notifs.sendToOwner() (notifications.js:578-594) queries users where role in ('president','owner') and fans out — and is already used elsewhere in this same file (e.g. CashAdvance.request's owner ping). Swap the PREZ_UID branch for Notifs.sendToOwner(...) to actually wire the alert.

### 21. Service worker updates can never reach a long-lived kiosk session — only apply at the login screen
`H-impact · M-effort · UX · infra-pwa`  
js/app.js:3531-3543 gates the silent SW-apply-and-reload flow behind `_atLoginScreen()` — a new SW is only activated (via SKIP_WAITING) when the tab happens to be sitting on the login screen; otherwise it just waits indefinitely (comment at line 3544: 'Mid-session: do nothing'). firebase-config.js sets 10-day LOCAL auth persistence specifically so background push survives, and this app now ships geofenced Type-B worker attendance meant for shop-floor/kiosk-style use. A device that stays logged in for days (the obvious kiosk case) never revisits the login screen and therefore never picks up any of the 60+ same-day deploys — the network-first JS/CSS strategy (sw.js:126-130) only helps on an actual page reload, which a long-lived single-page session never does. Consider a non-blocking 'Update available — tap to refresh' banner outside the login-screen gate for sessions that stay open past some threshold.

### 22. Notification spam/push-bomb is unenforced — quota is observe-only, never blocks
`H-impact · M-effort · Security · firestore.rules notifications + functions/index.js sendNotificationQuota`  
firestore.rules:211-230 lets any signed-in user create into ANY other user's notifications inbox (by design, for broadcast helpers), bounded only by title/body length. functions/index.js:847-898 (sendNotificationQuota) only logs a warning past 200/hr — it never rejects or throttles the write. A single low-privilege compromised account can real-device-push-bomb any other user indefinitely (each doc triggers a genuine FCM push via sendPushOnNotification), or repeatedly forge a misleading `type`/`link` (unbounded fields — only title/body are capped at firestore.rules:223-224) to phish a target in-app.

### 23. Production can post fabricated COS ledger entries with no link to a real production order
`H-impact · M-effort · Security · firestore.rules — ledger create (Production leg)`  
firestore.rules:1145-1166: the Production-postable ledger leg only requires `source=='Production'`, a positive amount, `category=='COS – Direct Material'`, and `refNumber` matching `POCOS-.*` — it never checks the refNumber corresponds to an actual production_orders doc. A buggy or compromised Production-dept account can inject arbitrary material-cost debits (and the matching Inventory contra-credit) into the books with no traceability check, directly corrupting P&L given the app's 'tested money core' claim.

### 24. id_verify self-mint lets an employee forge their own public ID-verification card
`H-impact · M-effort · Security · firestore.rules — id_verify create/update`  
firestore.rules:1494-1503: the employee self-mint branch only checks `kind == 'employee'` and `uid == request.auth.uid` — it never validates that the written name/title/department/status/photo match the caller's real users/{uid} record. Since id_verify is a PUBLIC `get` (QR-scan target, e.g. security guards or third parties verifying identity/role), a regular employee can self-mint a card claiming `title: 'President'`, `department: 'Finance'`, `status: 'verified'`, defeating the entire purpose of the ID-verification feature.

### 25. Analytics metrics bag (buildMetricsSync) still feeds win-rate/revenue insights from undeduped quotes
`H-impact · M-effort · Bug · screens-misc`  
dashboards.js:4205-4213 (wonQuotesP, qStat/qPrevStat via salesQuotes) and :4272/:4293 (wonQuotesMonth, topClients fallback) never call window.latestQuoteRevisions, unlike renderSales's own chainQuotes fix a few lines below. M.q/M.qPrev feed config.js:957 winRateDrop() and the Conclusions/Strategy 'Insights' cards, so a revised-and-won quote can still trigger a false win-rate-drop insight or inflate the Cash-Flow/Top-Clients charts even though the sibling KPI on the same tab was just fixed.

### 26. Invite Team Member flow can leave an orphaned, unrecoverable auth account
`H-impact · M-effort · Bug · people-chat`  
js/screens/people.js:504-540 — createUserWithEmailAndPassword and the Firestore users/{uid}.set() both complete before the final `await auth.sendPasswordResetEmail(email)` call. If that last call fails (rate-limited, transient network error), the outer catch just toasts an error, but the Auth user and Firestore profile already exist. Re-submitting the same invite will then fail with auth/email-already-in-use, and there is no 'resend reset email' path anywhere in this screen — the invited employee is stuck with an account they can never log into without manual Firebase-console intervention.

### 27. Design project billing invoices can collide (non-atomic per-project numbering)
`H-impact · M-effort · Bug · production`  
design.js:404-406 mints invoice numbers as `'INV-'+today()+'-'+String((p.invoices||[]).length+1).padStart(3,'0')` — a per-project counter keyed only by date. Two different Design projects both invoicing for the first time on the same calendar day will both produce e.g. INV-20260803-001. Contrast with the parallel job_projects flow in production.js:825, which mints via the atomic `window.nextSerial('billing_invoice','INV')`. Duplicate invoice numbers break the BIR audit trail.

### 28. Product cost/margin data is exposed to partners despite explicit code intent to hide it
`H-impact · M-effort · Security · Partner-mode gating / cost data`  
firestore.rules:855-858 lets any authenticated user, including `partner` role, read the full `products` collection — the same doc fields (`capitalMaterials`/`capitalLabor`, e.g. app.js:1658-1659, quote-builder-v2.html:2201-2202) that quote-builder-v2.html:1416-1423 explicitly strips from the DOM for generic partners 'because a generic partner is a normal client and must not see Barro's cost basis.' That protection is UI-only: a generic partner can call `db.collection('products').get()` from devtools/console and read every product's real cost, fully defeating the stated intent. Needs server-side enforcement (a separate cost-basis collection/field gated to `!isPartner()`, or a Cloud Function projection) rather than client-side element removal.

### 29. New Revision picks the 'latest' quote by client-NAME string match, not client ID/rootQuoteId
`H-impact · M-effort · Bug · Revision-chain integrity`  
`window.newRevisionFromDoc` (app.js:1593-1626) pools candidate quotes with `(q.clientName||'').trim().toLowerCase() === clientKey` (app.js:1602-1608) rather than `clientId` or `rootQuoteId`. Two different clients who happen to share a name (common in the Philippines, e.g. 'Juan Dela Cruz') get pooled together, so New Revision for one client can silently inherit pricing/items from an unrelated client's higher-numbered revision. Conversely, correcting a client's name between revisions drops earlier entries out of the pool, so the 'latest' picked can revert to stale pricing. `buildQuoteChains` already solves this correctly via `rootQuoteId` (sales.js:883) — `newRevisionFromDoc` should use the same key.

### 30. Quick Estimate prices from a stale static JSON, not the live Firestore product DB
`H-impact · M-effort · Bug · Quick Estimate / product data source`  
sales.js:224-234 (qeLoadDB) fetches products-database.json directly and never touches Firestore, while the full Quote Builder's loadDatabase() (quote-builder-v2.html ~1309-1320) reads the live `products` Firestore collection first and only falls back to the JSON file if Firestore is empty/unreachable. The header comment at sales.js:215-218 claims Quick Estimate uses 'the SAME products-database.json the full Quote Builder uses' and that pricing 'matches' — true for the formula, false for the data source. Any price the President edits via the live Product Database screen never reaches Quick Estimate, so the two tools can silently quote different unit prices for the same SKU to the same client.

### 31. linkedUid is a raw, unvalidated free-text uid with no lookup or uniqueness check
`H-impact · M-effort · Data · hr-worker`  
hr.js:1560-1562/1620 lets HR paste an arbitrary Firebase Auth uid string into 'Linked Login Account' with no autocomplete-by-email/name, no existence check, and no uniqueness check across worker_profiles. A copy/paste mistake either silently breaks the bridge (worker sees 'Account not linked yet' forever, worker.js:572-582) or, worse, links to a different real employee's valid uid, letting that unrelated person see this worker's rate-derived estimate/calendar and clock in/out under this identity. Separately, if two worker_profiles docs are ever given the same linkedUid, _resolveWorkerProfile's `.where('linkedUid','==',uid).limit(1)` (worker.js:84) picks an arbitrary, not-guaranteed-stable one, so the same login could non-deterministically resolve to a different profile across sessions.

### 32. attendance_worker rule allows retroactive tampering of any past date's hours
`H-impact · M-effort · Security · hr-worker`  
firestore.rules:276-284 only checks workerId match, recordedBy==auth.uid, and that inValid/outValid aren't explicitly false — it never constrains `date`/docId to today, never requires resource==null before overwriting an existing valid record, and never validates hoursWorked against timeIn/timeOut. Because this is a plain browser JS app, a Type-B worker can call db.collection('attendance_worker').doc(id).collection('records').doc('<any past date>').set({...timeIn,timeOut,hoursWorked:99,inValid:true,outValid:true},{merge:true}) directly from devtools to fabricate or inflate ANY past day, which HR's 'Load Kiosk Hours' button (hr.js:2158-2171) then pulls straight into a payslip. This is a distinct gap from the already-known 'server-side geofence validation' item — it's a total lack of temporal/immutability constraint, independent of GPS spoofing.

### 33. Time In/Out crossing midnight splits one shift into two broken day-docs
`H-impact · M-effort · Bug · hr-worker`  
js/screens/worker.js:249-364 (_handleClock) recomputes `window.bizDate()` fresh on every call and writes to attendance_worker/{profileId}/records/{todayStr}. If a shift crosses midnight (e.g. a night-shift worker times in 11:50pm, times out 12:10am), Time In and Time Out land in TWO DIFFERENT day-docs. The prior day's doc is left forever with timeIn but no timeOut/hoursWorked (shows 'present' with 0h on the calendar, worker.js:431); the new day's doc gets a timeOut with no timeIn (computeDayHours(undefined, timeStr) returns 0 per hr.js:2217-2225, so hoursWorked=0). The exact workers most likely to hit this (production/night shifts) get silently under-paid hours.

### 34. 'Advances to Employees' ledger account is never credited back on CA repayment — permanently inflates the FS working-paper Balance Sheet
`H-impact · M-effort · Bug · finance`  
CashAdvance.deduct (config.js:1933-1963, called from payroll) and CashAdvance.recordPayment (config.js:1835-1858, the 'Record Payment' button) both only mutate cash_advances.balance — neither ever posts a ledger entry crediting 'Advances to Employees'. Only CashAdvance.approve debits it once at release (config.js:1754-1758). window.renderBirFS's provisional Balance Sheet (bir.js:743-764) derives Total Assets from a raw cumulative-ledger perAccount scan that includes this asset kind, so its Total Assets grows monotonically forever by the full historic sum of every CA ever released, never reduced by any repayment. (The newer dedicated Balance Sheet screen, birRenderBSBody in bir.js:910-914, sidesteps this by reading window.finCaReceivable() — the live cash_advances balance — instead, so only the older FS screen's Balance Sheet section is affected, but it is a real, silent, growing overstatement there.)

### 35. disbursePayRun's NETPAY cash-credit leg ignores caPlanned and otherDeductions
`H-impact · M-effort · Bug · finance`  
departments.js:1727 computes netCashAgg += effectiveGross - statutoryTotal, and the NETPAY-{month} ledger credit (departments.js:1772-1778) posts exactly that sum to Cash. But the money actually paid to each employee is finalPay = netBeforeCA - caPlanned (money-core.js:82-85), i.e. gross minus statutory minus otherDeductions minus caPlanned. Since otherDeductions (a real, HR-editable 'Other Deductions' field, see hr.js:980/1044) and caPlanned (cash-advance payroll deductions) are never subtracted from netCashAgg, every payroll run with any CA deduction or other-deduction overstates the ledger's Cash-out by exactly Σ(otherDeductions+caPlanned) for that run. Debits still equal credits (the comment at 1701-1702 only proves that tautology), but the Cash account itself is now wrong, and this compounds every month — permanently understating true bank cash in finCashAsOf/Balance Sheet/Bank Reconciliation relative to reality.

### 36. Auto-logout is purely a foreground JS timer — backgrounded/suspended PWA sessions never expire
`H-impact · M-effort · Security · core-shell`  
js/app.js:358-379 + config.js:182: AUTO_LOGOUT_MS is 10 days and enforcement is a single client-side `setTimeout` reset on activity events. Mobile OSes (notably iOS) fully suspend JS execution for backgrounded tabs/installed PWAs, so this timer simply doesn't run while the app sits backgrounded — it only resumes counting once the user reopens the app, at which point the resetLogoutTimer activity listeners immediately restart the full 10-day window again. Combined with Firebase Auth's LOCAL persistence (10-day sessions, per firebase-config.js) and no server-side idle-expiry equivalent, a lost/stolen device with the PWA installed (not force-quit) can remain authenticated indefinitely rather than being auto-logged-out after the intended idle window — undermining a stated security control.

### 37. requireProfilePhoto() is a hard app-wide lock with no skip path or offline handling
`H-impact · M-effort · UX · core-shell`  
js/app.js:707-752: the overlay has no close/X/'later' control, and its only exit is a successful Drive.uploadProfilePhoto() call. On failure (offline first launch, flaky network, no camera-ready photo on hand) the status just shows 'Upload failed — please try again' (line 746) and the user remains completely locked out of Tasks/Attendance/Chat/everything else. A first-day employee opening the freshly-created PWA on spotty office wifi has no way to use the app at all until the upload succeeds. Recommend at minimum a bounded 'Remind me later' escape hatch (e.g. N snoozes) and a clearer offline-specific message.

### 38. ci-invariants.sh's z-index STACKING check never scans css/*.css — and a raw 4-digit literal already exists there
`M-impact · S-effort · Quality · infra-pwa`  
scripts/ci-invariants.sh's `collect_js_files()` (lines 18-23) and the STACKING check description ('js/*.js and js/screens/*.js') never look at css/*.css, even though the whitelist comment explicitly frames the fix as 'use the existing z-index scale in css/tokens.css instead'. Confirmed there is already an un-whitelisted raw literal today: `css/styles.css:4103` has `z-index: 5000` — a 4-digit value that would trip the exact pattern this check is designed to catch, sitting completely outside its scan scope. Extend `collect_js_files`-equivalent logic (or add a parallel check) to scan css/*.css for the same STACK_PATTERN.

### 39. CI workflows use `npm install` instead of `npm ci` despite a committed lockfile
`M-impact · S-effort · Quality · infra-pwa`  
scripts/package-lock.json exists (lockfileVersion 3) but all four scripts-invoking workflows (.github/workflows/sync-to-drive.yml:23, monthly-backup.yml:24, restore.yml:15, daily-digest.yml 'Install dependencies' step) run `npm install`, not `npm ci`. `npm ci` is faster (skips dependency resolution), strictly reproducible against the lockfile, and fails loudly if package.json and the lockfile disagree — `npm install` can silently update transitive versions between runs of these unattended, scheduled, production-data-touching scripts.

### 40. ci.yml's node-version-pin job locks every workflow to Node 20, which is past LTS maintenance end
`M-impact · S-effort · Quality · infra-pwa`  
.github/workflows/ci.yml's `node-version-pin` job actively fails CI if any workflow file uses a node-version other than '20'. Node 20's LTS maintenance window ended April 2026 (today is 2026-08-03), so this project is deliberately CI-locked onto an EOL runtime for its own scripts/tests/backup jobs. Combine with finding #3 (the test-runner CLI behavior that differs on newer Node) — bump the pin to a currently-supported LTS (22 or 24) across ci.yml and all five other workflow files that set node-version: '20'.

### 41. `node --test tests/` (the documented command) throws MODULE_NOT_FOUND on current Node
`M-impact · S-effort · Bug · infra-pwa`  
Verified by direct repro on Node v24.16.0: `node --test tests/`, `node --test tests`, and `node --test ./tests/` all fail with `Error: Cannot find module '.../tests'`, while `node --test` (no positional arg, default recursive discovery) and `node --test tests/*.test.mjs` both correctly run all 38 tests. This exact command is what ci.yml's `money-math-tests` job runs and what both tests/*.test.mjs file headers tell developers to run locally ('Run with: node --test tests/'). Since ci.yml pins Node 20 for that job, it may currently pass in GitHub Actions, but the documented local command silently breaks for any developer on a newer Node — with a confusing MODULE_NOT_FOUND error that gives no hint it's a Node-version issue. Fix: change the command (and both file-header comments) to `node --test tests/*.test.mjs` or bare `node --test`, which are robust across versions.

### 42. adminResetPassword performs no audit logging of password resets
`M-impact · S-effort · Quality · functions/index.js — adminResetPassword`  
functions/index.js:216-248: a successful reset just returns `{ ok: true }` — there is no write to `audit_log` (which the app otherwise treats as the record of sensitive mutations, see firestore.rules:1370-1389) and no notification to the affected user that their password was changed. Combined with finding #1's escalation path, a hijacked account's password reset would leave literally zero trace anywhere in the app's own data model.

### 43. finance_rollup write has no field/shape constraint — Production can overwrite the entire monthly doc
`M-impact · S-effort · Security · firestore.rules — finance_rollup write`  
firestore.rules:1126-1129: `allow write: if isAuth() && (canFinance() || canProduction());` with no `affectedKeys()` fence, unlike the analogous Production ledger leg (:1148-1165) which is tightly scoped to specific fields/patterns. A Production-tier account's rollup write (intended only to bump the COS-linked aggregate) can instead replace any field of any month's finance_rollup doc, corrupting a value Finance's dashboards treat as authoritative between Rebuild-rollups runs.

### 44. design_drawings: any design-dept member can silently demote a released/approved drawing back to draft
`M-impact · S-effort · Quality · firestore.rules — design_drawings update`  
firestore.rules:957-964: the isPromotion() gate (isDrawingApprover() + two-party control) applies ONLY to transitions INTO approved/released. Any demotion — including released/approved → draft/for_review — falls into the ordinary `canDesign()` branch, so a regular design-dept member (not an approver, and possibly not even involved in that drawing) can revert a released drawing, undermining the 'full revision control' approval trail the WS35 comments describe as a deliberate two-party-control feature.

### 45. hub_files 'editor' grant can silently repoint a shared file's underlying content, not just its metadata
`M-impact · S-effort · Security · firestore.rules — hub_files update (editor branch)`  
firestore.rules:1638-1647: the editor-only update branch allows changing `url`,`driveUrl`,`contentType`,`size`,`versions`,`currentV` in addition to descriptive fields, even though the surrounding comment frames the editor grant as 'content & organization fields only'. Anyone with editor rights (not owner/admin) can therefore substitute the actual file a shared/company-visibility doc points to, and every other viewer (owner, sharedUserIds, or all non-partner staff on 'company' visibility) will open the new content believing it's the original.

### 46. error_log leaves page/version/ua unbounded; audit_log leaves details/action/entity unbounded
`M-impact · S-effort · Security · firestore.rules — error_log / audit_log create`  
firestore.rules:1400-1412 bounds only `message` (500) and `stack` (2000) on error_log create; `page`, `version`, `ua` have no isBoundedString cap. audit_log create (:1382-1386) validates keys/actorUid/actorRole/ts but places no size bound on `details`/`action`/`entity`/`entityId`. Either append-only, unrate-limited collection can be flooded with near-1MB documents by any signed-in account (or, for error_log, effectively unauthenticated-adjacent since it fires from window.onerror), inflating read costs on every admin dashboard load.

### 47. attendance_worker self-service records can silently overwrite an HR/admin correction, with no score/hours cap
`M-impact · S-effort · Security · firestore.rules — attendance_worker records`  
Compare firestore.rules:256-259 (attendance/{uid}/records: owner writes are capped to attendanceScore in [0,0.5,1.0] AND blocked once `resource.data.editedBy` is set by an admin) against :276-284 (attendance_worker/{workerId}/records: the linked-worker self-service branch only enforces `inValid==true`/`outValid==true`/workerId/recordedBy — no score/hours bound, and no protection against re-writing over an admin's correction). A linked Type-B worker can quietly revert an HR-entered 'Absent' back to a self-reported present day.

### 48. _counters write lets any employee reset a sequence to a lower/arbitrary value, risking ID collisions
`M-impact · S-effort · Data · firestore.rules — _counters`  
firestore.rules:167-170: `allow write: if isAuth() && !isPartner();` has no check that the new count is monotonically increasing — any internal signed-in user (not just HR/Production) can set e.g. `_counters/employees.count` back to 0, causing the next hire to be minted with an employeeId that collides with an existing employee.

### 49. isValidDocument() never checks contentType — any file type can be uploaded company-wide
`M-impact · S-effort · Security · storage.rules — isValidDocument()`  
storage.rules:66-68: `isValidDocument()` only enforces a 25MB size cap, unlike `isValidImage()` which also checks `contentType.matches('image/.*')`. Every 'document' upload path (Finance/*, tasks, posts, general/General, task-comments, chat-files, department folders) therefore accepts ANY MIME type, including HTML/SVG/executables, with no allow/deny list.

### 50. cash_advances create never validates `amount` is a non-negative number
`M-impact · S-effort · Security · firestore.rules — cash_advances create`  
firestore.rules:316-321 checks `userId==auth.uid`, `status=='pending'`, `balance==0` but never applies `isNonNegNumber()` (already defined at :108, used elsewhere e.g. approval_requests :815) to `amount`. An employee can submit a cash-advance request with a negative, non-numeric, or absurd amount; downstream payroll-deduction math (CashAdvance.planFor / executeApprovalOnUpdate) assumes sane positive balances.

### 51. attendance_extensions create has zero validation — including no partner exclusion
`M-impact · S-effort · Security · firestore.rules — attendance_extensions`  
firestore.rules:295-303: `allow create: if isAuth();` with no field constraints at all — unlike every sibling collection (leave_requests, cash_advances, approval_requests) which pin userId==auth.uid, status=='pending', and shape-validate. Notably `read` is gated `!isPartner()` but `create` has no partner exclusion, so an external Brilliant Steel partner account can write an attendance-extension request naming any employee, with arbitrary fields/status.

### 52. fcmToken isn't a privileged field — an admin can hijack another user's push notifications
`M-impact · S-effort · Security · firestore.rules — users update rule / fcmToken`  
Because `fcmToken` is absent from userPrivilegedFieldsUnchanged() (firestore.rules:86-99), any isAdmin() (manager/secretary) can update another user's users/{uid} doc setting `fcmToken` to their own device's token (all other privileged fields left unchanged, satisfying the update rule at :139-143). sendPushOnNotification (functions/index.js:54-57) looks up `fcmToken` from that same users doc and pushes every subsequent notification meant for the victim (payroll, DM previews, deadlines) to the attacker's device instead. This is a real interception vector distinct from finding #1/#2 — same root cause (incomplete privileged-field list).

### 53. No sr-only/visually-hidden utility class despite 89 aria-label call sites in JS
`M-impact · S-effort · A11y · css-a11y`  
grep across css/styles.css finds zero `.sr-only` / `.visually-hidden` class, while js/*.js uses `aria-label` 89 times and `aria-live` exactly once app-wide. Icon-only controls (modal-close, ms-attach-btn, etc.) rely entirely on aria-label with no CSS-supported way to also ship a real, focusable, visually-hidden text node for screen-reader users on components that need both a label and adjacent visible content (e.g. status changes, live chat message arrival). Add the standard clip-based `.sr-only` utility to styles.css so it's available; a chat/messaging app this size having a single `aria-live` region is also worth a follow-up audit — toasts (Notifs.showToast) and new chat messages likely aren't announced to screen readers at all today.

### 54. Employee name/ID on the ID card renders via background-clip:text with no forced-colors fallback
`M-impact · S-effort · A11y · css-a11y`  
css/styles.css:1547, 1573, 1588 (`.id-card-company`, `.id-card-name`, `.id-card-id`) render the employee's actual name, company, and ID number via `-webkit-background-clip: text; -webkit-text-fill-color: transparent;` gradient text, unconditionally (Dark/Astral, per the previous finding). There is no `@media (forced-colors: active)` rule anywhere in the stylesheet (grep confirms zero). In Windows High Contrast Mode, `-webkit-text-fill-color: transparent` combined with a suppressed background gradient can render this text fully invisible — meaning a low-vision employee using forced-colors could see a blank ID card where their name should be. 8 total gradient-text sites exist (also login-title, id-card-company-sub-adjacent elements); add a `forced-colors: active` fallback that sets a solid `color` and removes the clip.

### 55. Duplicate :focus-visible rule — line 111 is dead, and the surviving one uses brand pink, not the interactive-state color
`M-impact · S-effort · A11y · css-a11y`  
css/styles.css:111 sets a universal `:focus-visible { outline: 2px solid var(--primary); }` early in the file. A second universal `:focus-visible` block at 5899-5903 (labelled 'the universal rule, was a hand-curated allowlist') redeclares the same selector with `outline: 2px solid var(--brand-primary)`. Same specificity, later wins, so line 111 is dead. More importantly, `--brand-primary` = `--pink` (#FF2D78, never re-themed by Light/Dark) while every other 'active/selected' indicator in the app (nav-item, top-nav-item, subtab-btn, chip-tab) now correctly uses the theme-aware `--primary` (blue in Light/Dark). The result: tabbing through the UI flashes a hot-pink ring that doesn't match the blue used everywhere else for 'this is the active/focused thing' in Light and Dark themes, and on Light's white surfaces that pink computes to only ~3.5:1 (right at the WCAG 1.4.11 floor for non-text UI components).

### 56. Attendance edit button is hover-only — unreachable by keyboard
`M-impact · S-effort · A11y · css-a11y`  
css/styles.css:3419-3424: `.att-edit-btn { display:none; ... }` / `.att-cal-day:hover .att-edit-btn { display:block; }` has no `:focus-within` companion. Because it's `display:none` by default, the button isn't in the accessibility tree or tab order until a mouse hover toggles it on — a keyboard-only user can never reveal or activate it in this (non-`.att-edit-visible`) variant. Add `.att-cal-day:focus-within .att-edit-btn { display:block; }` alongside the hover rule.

### 57. --text-light token fails contrast for real text content in all 3 themes
`M-impact · S-effort · A11y · css-a11y`  
tokens.css:83 defines `--text-light` at 0.28 opacity (dark) / html.light redefines it at 0.32 opacity (line 2785) / html.theme-dark at 0.30 (line 2852). It's used for actual informational text, not decoration: nav-section-label (styles.css:1114, sidebar section headers like 'FINANCE'), notif-item-time (1015), comment-time (1957), login-version (553). Computed contrast lands around 2-2.3:1 against each theme's background — well under AA for any text size. Bump the opacity floor (or give it its own AA-checked value like text-muted-strong got) so sidebar section labels and timestamps are actually legible.

### 58. badge-teal has no Light-theme text-color override — unreadable on white
`M-impact · S-effort · A11y · css-a11y`  
css/styles.css:199 `.badge-teal { color: #00DDB8; ... }`. The Phase 187 AA pass explicitly re-tinted badge-blue/green/orange/red/purple for html.light (lines 2989-2993) but badge-teal was skipped. #00DDB8 on a white card computes to ~1.7:1 contrast — essentially invisible text — while every sibling badge got a proper dark Light-mode color.

### 59. Notification/nav count badges: white text on hot-pink fails contrast in every theme
`M-impact · S-effort · A11y · css-a11y`  
css/styles.css lines 927, 945, 1140, 1305, 4447, 5342 all set `background: var(--pink); color: #fff;` at 9-10px font sizes (0.5625rem/0.625rem) for badge counts (top-nav badge, sidebar bn-badge, bottom-nav badge, more-nav-row-badge, etc). `--pink` (#FF2D78, tokens.css:17) is never redefined by html.light or html.theme-dark, so these badges keep the same color in all three themes. White-on-#FF2D78 computes to ~3.5:1 contrast — under the ~4.5:1 needed for text this small (badge counts are numerals, not decorative dots) in every theme, not just Astral.

### 60. New Task form allows creating a task with no department, silently dropping it into 'Unassigned' bucketing
`M-impact · S-effort · Bug · screens-misc`  
tasks.js:923-924 defaults the Department select to '— Select —' (empty string) and the create-task-btn handler (tasks.js:956-974) only validates `title`, not `department`. An empty department means: it groups under 'Unassigned' in the President's Departmental view (tasks.js:372-373), never matches a Manager Dashboard's `depts.includes(t.department)` scoping (dashboards.js:1003), and is excluded from renderDeptTasks entirely — the task becomes effectively invisible to department-level oversight even though it was assigned to specific people.

### 61. Partners > Activity tab silently caps at the first 5 partner accounts
`M-impact · S-effort · Bug · screens-misc`  
partners.js:924 `partners.slice(0,5)` truncates the partner list BEFORE fetching notifications for the Activity tab, and the underlying users query (partners.js:714) has no orderBy, so which 5 partners get shown is arbitrary Firestore document order. As soon as Barro Industries has more than 5 active partner accounts, activity for every partner beyond the first 5 (by arbitrary order, not by recency or activity level) never appears in this admin view, with no indication that anything was cut off.

### 62. Product Database renders the product code (document ID) unescaped into innerHTML
`M-impact · S-effort · Security · screens-misc`  
dashboards.js:417 `<span ...>${p.id}</span>` inserts the product's Firestore doc ID — which is directly derived from the President-editable 'Code' input (dashboards.js:499, only `.trim().toUpperCase()`, no sanitization) — into innerHTML with no escHtml(), unlike the adjacent Title cell on the same row (dashboards.js:418, which does use escHtml). Since Product Database is viewed by every admin/finance user who opens it, a malicious or malformed Code value (e.g. containing `<img onerror=...>`) would execute in every subsequent viewer's session — violates the project's own 'always escHtml before innerHTML' convention (CLAUDE.md).

### 63. Every task status dropdown shows two indistinguishable 'In Review' options
`M-impact · S-effort · Bug · screens-misc`  
tasks.js:74-75 defines both `{value:'submitted', label:'In Review', ...}` and `{value:'review', label:'In Review', ...}` in TASK_STATUSES 'for read-compat with stragglers' — but TASK_STATUSES is rendered verbatim (unfiltered) into every status `<select>` in the app: New Task (tasks.js:917), Edit Task (tasks.js:821), and the task detail Change Status panel (tasks.js:552). A user creating or editing a task sees 'In Review' listed twice with no way to tell which value they're actually picking.

### 64. Task 'done' status is missing from the closed-status lists used by Overdue/Near-Due and My-Tasks completion splits
`M-impact · S-effort · Bug · screens-misc`  
tasks.js:84 `DONE_STATUSES = ['approved','archived']` and tasks.js:438 `COMPLETED_STATUSES = ['approved','archived','on-hold']` both omit 'done', even though TASK_STATUSES (tasks.js:70-81) lists 'done' as a distinct terminal status and dashboards.js:796 `CLOSED_STATUSES = ['done','approved','archived']` correctly includes it. Concretely: a task marked status='done' with a past due date still shows up under the President's 'Overdue' tab (tasks.js:318-322) and under 'Near Due', and an employee who marks their own task Done still sees it filed under 'Active' rather than 'Completed' in My Tasks (tasks.js:439-451) — while the same task is correctly excluded from the Dashboard's own Overdue KPI. Same underlying data disagrees between two screens.

### 65. Manager Dashboard's pending-approval count omits attendance extensions, undercounting what the manager can actually act on
`M-impact · S-effort · Bug · screens-misc`  
dashboards.js:1010-1011 computes deptPending from submissions + approval_requests + cash_advances only. But APPROVAL_CAPS in approvals.js:101-116 lists 'attendance' as manager-actionable, and the President/Secretary dashboards (dashboards.js:811, :1124) both include pending attendance extensions in their totals. A manager whose team member has a pending Time-In extension request sees no alert banner and no badge on the Approvals quick-action for it.

### 66. 'Tasks for Review' dedicated tab approve/reject skip the task-involved notification the 'All Requests' tab sends
`M-impact · S-effort · Bug · screens-misc`  
approvals.js:933-946 (the review-tasks subtab's own rt-approve/rt-reject handlers) update the task doc and only show a local Notifs.showToast — no notifyTaskInvolved call. The functionally-identical handlers in the 'All Requests' aggregated view (approvals.js:470-485) do call `safeNotify(() => notifyTaskInvolved(...))`. This is the exact duplicate-write-path problem svc-approvals.js was built to eliminate for other types, but review-task approve/reject was never migrated into Approvals.dispatch and still drifts between its two call sites — whether the task's assignee gets pinged depends on which Approvals tab was used.

### 67. Work-submission approve/reject in the aggregated Approvals view never notifies the submitter
`M-impact · S-effort · Bug · screens-misc`  
approvals.js:456-464 ('.sub-approve-btn'/'.sub-reject-btn') updates the submissions doc status but only toasts the approver, with no Notifs.send to the creator, and the button markup (approvals.js:359-360) never even carries a data-uid to notify with. The dedicated detail flow (tasks.js:1054-1063, openSubDetail) does call Notifs.send(s.createdBy, ...) on both approve and reject. Employees who submit leave/expense/overtime requests via 'New Submission' and get decided through the aggregated queue silently never hear back.

### 68. Partners dept admin hub (Overview/Quotes tabs) has the same un-deduped quote count bug
`M-impact · S-effort · Bug · screens-misc`  
partners.js:792 (totalQuoteVal), :877/:882/:885 (Total Quotes count, Pipeline Value) all reduce over raw bs_quotes with no revision-chain dedup, inflating the admin-facing Partners > Overview/Quotes KPIs whenever a partner's quote has multiple filed revisions.

### 69. Team card's DM button hides messaging to President/Manager for partners
`M-impact · S-effort · Bug · people-chat`  
js/screens/people.js:897-899 shows the chat-dm-btn to a partner viewer only when `u.role==='partner' && same company` — it never includes president/manager. But js/chat.js:121-129 dmCandidates() (used by Chat's own 'New Message' picker) explicitly allows a partner to DM president/manager. Result: a partner can message the President via Chat > New Message, but the Team tab's own card for the President shows no Message button at all — an inconsistent, confusing entry point across the same feature.

### 70. Files Hub search box silently does nothing outside the "All Scopes" tab
`M-impact · S-effort · UX · people-chat`  
js/screens/people.js:2320 renders one persistent #fh-hub-search input above the scope chip tabs, but its input handler (lines 2368-2371) only calls renderAllScope() when the active chip is '__all__' — on every other scope (Personal, Department, Advertising, etc.) typing into the visible, enabled search box produces no filtering and no indication that it's inert there.

### 71. Employee-of-the-Month attendance reads are uncached, run on every Team open
`M-impact · S-effort · Perf · people-chat`  
js/screens/people.js:726-736 computeEomStandings() issues one attendance range-query per eligible employee inside Promise.all, with no dbCachedGet wrapper — unlike the adjacent tasks-all/kpi-evals fetches in the same function (lines 710-715, which are cached 60s). Since this only runs for the President (canManage gate), it re-executes N attendance reads every single time the President opens the Team tab, however often that is in a session.

### 72. Cash advance record delete has no audit log entry
`M-impact · S-effort · Quality · people-chat`  
js/screens/people.js:1740-1746 — the ca-delete-btn handler permanently deletes a cash_advances doc with only a Notifs.success toast; unlike inventory delete (js/modules.js:265-269 calls window.logAudit) and leave approve/reject (people.js:2141/2152 call logAudit), this financial-record delete leaves no audit trail of who removed it or when.

### 73. Holidays Admin screen is fully built but unreachable from the UI
`M-impact · S-effort · Feature · people-chat`  
js/screens/people.js:1348-1362 renderHolidaysAdmin — the file's own header comment confirms: "not yet wired into navigateTo's switch / a nav entry." Finance/admin has a complete override-management screen (add/edit/remove PH holidays per year, used by getPHHolidays everywhere attendance/leave/payroll compute) that no one can currently open without manually invoking the function from a console.

### 74. Thread listeners swallow errors silently — no retry UI unlike the inbox
`M-impact · S-effort · Bug · people-chat`  
js/chat.js:1183-1193 — the messages/readers/typing onSnapshot error callbacks in openConversation are all empty `()=>{}`, whereas _attachInbox's own listener (line 176-177) renders a 'Chat unavailable' empty-state on error. A persistent listener failure inside an open thread (rules change mid-session, quota, sustained network issue) leaves the thread frozen on stale content with zero feedback to the user.

### 75. Shared Media page re-fetches up to 500 messages uncached on every open
`M-impact · S-effort · Perf · people-chat`  
js/chat.js:2862-2865 _openMediaTab() runs a fresh `.limit(500).get()` every time the ⓘ button is tapped, with no dbCachedGet wrapper (unlike the users/tasks/kpi caches used elsewhere in this file). Reopening the info page repeatedly (a plausible flow — check photos, close, check again) re-reads the same up-to-500 docs each time.

### 76. A stuck-"sending" pending bubble has no cancel affordance
`M-impact · S-effort · UX · people-chat`  
js/chat.js:2299-2333 (_renderPendingBubble) only makes a bubble tappable-to-retry once its status is 'failed' (_wirePendingTailDelegation, line 2282). If a Storage upload stalls (e.g. attaching a file while offline — put() has no explicit timeout in this code) the bubble stays in the 'sending' spinner state indefinitely with no way to cancel or force-retry.

### 77. No size/type guard before uploading a non-image chat attachment
`M-impact · S-effort · Bug · people-chat`  
js/chat.js:1317-1327 uploads any picked file (accept list includes .pdf/.doc/.docx/.xls/.xlsx/.zip) straight to Storage with zero client-side size check. Only images get the 300KB compression floor (_compressImage, line 1249). A large document attached on a slow connection has no warning before the upload starts and no visible progress, just the same generic pending-bubble spinner.

### 78. Inbox unread state falls back to a dead map instead of the readers doc
`M-impact · S-effort · Data · people-chat`  
js/chat.js:246-254 _myReadAtMs()/_isUnread() (drives the nav badge and bold/unbold inbox rows) falls back to `_myReads[cv.id]`, but nothing in the file ever populates `_myReads` (confirmed by grep — only declared at line 33 and read at 249) so the fallback is always 0. Meanwhile _myReadAtForOpen() (js/chat.js:1137-1144), used only at thread-open time, correctly falls back to a readers-subcollection get. Net effect: a conversation whose doc predates the reads-map migration and hasn't been reopened shows as unread in the inbox/badge even if it was actually read via the legacy path, until the user opens it once.

### 79. Dept-channel inbox refresh re-fetches every channel doc uncached
`M-impact · S-effort · Perf · people-chat`  
js/chat.js:209-217 _refreshDeptChannels() does a Promise.all of raw .get() calls (one per department) on every debounced conversations-snapshot burst, unlike _refreshPresence/_refreshUsersCache which route through dbCachedGet. For an admin role (myDeptChannels() returns every department), a burst of chat activity re-reads every dept_<X> conv doc repeatedly with no TTL cache — real, avoidable Firestore read cost that scales with department count and message frequency.

### 80. Design's Contract Amount can be edited below the amount already collected with no warning
`M-impact · S-effort · Bug · production`  
design.js's Edit Project save (around line 573, `contractAmount: parseFloat(...)||0`) applies no floor relative to `projectPaid(p)`. Since renderProjFinancials treats balance<=0.005 as 'Fully Paid' (line 309), lowering the contract below what's already been collected silently flips the project to 'Fully Paid' with no record that an over-collection now needs a refund or contract amendment.

### 81. Inventory Count Form draft autosaves to one global (non-per-user) localStorage key
`M-impact · S-effort · Data · production`  
production.js:1410, `PROD_COUNT_DRAFT_KEY = 'bi-prod-count-draft'` is a single fixed string with no uid namespace. Any shared shop-floor device/kiosk used by more than one person during the same count cycle will have one person's in-progress counts silently overwritten by the next person opening the Count Form.

### 82. Design's Record Payment never requires selecting a company bank account
`M-impact · S-effort · Bug · production`  
design.js's `save-pay-btn` handler (lines 344-356) lets `pay-bank` stay unselected with no validation, while the parallel job_projects flow (production.js:672-675) explicitly blocks Save with 'Select the company account that received this payment' whenever any bank accounts are registered. Design payments can land with zero bank-account attribution even when the registry is populated.

### 83. RFQ/PR numbers use Date.now() suffix instead of the atomic counter used everywhere else in this file
`M-impact · S-effort · Bug · production`  
production.js:1953 mints RFQ numbers as `RFQ-${yr}-${String(Date.now()).slice(-4)}` (repeats every 10s) and PR numbers (line 1856) are derived by regex-replacing that same non-unique suffix, unlike production orders/delivery receipts/billing invoices in the same file which all use `nextCounterId`/`nextSerial`. Two RFQs raised within the same 10-second window (plausible on a busy procurement day, or via the bulk 'From low stock' generator) collide, and the collision propagates into the CDJ reference used for duplicate-detection in recordPurchaseDisbursement (line 2557).

### 84. No double-submit guard on File, and a racy version-count let duplicate quotes get filed
`M-impact · S-effort · Bug · Concurrency / filing idempotency`  
`fileQuotation()` (quote-builder-v2.html:3312-3358) never disables `#fileBtn` (quote-builder-v2.html:1164) after the first click, and the app.js `QUOTE_FILED` handler's de-dup 'version' logic (app.js:3408-3414: `mine.docs.filter(...).length+1`) is a plain read-then-write, not a transaction. A quick double-tap sends two `QUOTE_FILED` postMessages; both reads can observe `version=1` before either write lands, producing two duplicate filed docs with the identical `quoteNumber`/`fileName` (no '(2)' suffix), each self-stamping its own disconnected `rootQuoteId` — a silent duplicate in Sales pipeline totals and the President's 'Quote Filed' notification firing twice.

### 85. newRevisionFromDoc reads the ENTIRE quotes collection on every click instead of a scoped query
`M-impact · S-effort · Perf · Performance / read cost`  
app.js:1604-1609 runs `db.collection(collection).get()` with no `.where()` filter, then filters by client name in JS, on every single 'New Revision' click. This re-reads every quote the company has ever filed (Firestore billed per document read) regardless of which client was clicked, instead of a `.where('clientName','==',clientKey)` (or better, `clientId`) query. Cost and latency both scale with total quote volume, not with the one client being revised — this will get worse as the chain-history feature encourages more revisions.

### 86. Quote line-item quantity has no lower-bound/sign guard, letting negative amounts silently reduce the quoted total
`M-impact · S-effort · Bug · Pricing math edge cases`  
`updateQty` (quote-builder-v2.html:2502) does `items[idx].qty=parseInt(el.value)||1` — this only guards against exactly `0` (falsy), not negatives: `parseInt('-5')||1` evaluates to `-5`. `addItemFromCalc`'s initial add (quote-builder-v2.html:2172-2211, qty read at line 2176) has no guard at all. A negative qty produces a negative `amount` that flows straight into `computeTotals()`'s `subtotal` (quote-builder-v2.html:2293) and ultimately `grand`, with nothing in `VERIFY_CHECKS` (quote-builder-v2.html:3221-3229) flagging it before filing. Contrast with Quick Estimate's own `qeSetQty`/`qeAddItem` (sales.js:369-374, 340), which correctly `Math.max(1, ...)` — the production builder is less defensive than its own fast-estimate sibling.

### 87. reopen=1 draft-suppression fires on the Quick-Estimate handoff, silently discarding an unrelated unsaved draft
`M-impact · S-effort · Bug · Draft lifecycle`  
`renderQuoteBuilderIframe` (app.js:1450) appends `?reopen=1` whenever `window._qbReopenState` is set, for ANY caller — including `qeCreateFormalQuote` (sales.js:437-448), which is not reopening an existing filed quote at all, just handing off a fresh Quick Estimate basket. `reopen=1` makes `loadFromStorage()` skip `checkDraftResume()` entirely (quote-builder-v2.html:3097), so if the user had a genuine unsaved draft for a different client sitting in localStorage, using 'Create Formal Quotation →' from Quick Estimate silently drops the resume prompt for that draft with no way to recover it — reintroducing, via a different call site, the exact 'stale draft clobbers a real load' bug this flag was built to fix (app.js:1446-1450). Fix: only set `reopen=1` when `reopenState.sourceDocId` is actually present.

### 88. Draft (unverified) payslip amounts shown to worker with no provisional indicator
`M-impact · S-effort · UX · hr-worker`  
worker.js:484 queries payslips with no status filter, and the row (worker.js:529-536) shows `p.status||'draft'` as plain small gray text — no badge, no warning — while the payslip detail page itself DOES show a 'PROJECTION — not yet disbursed' badge for unofficial models (hr.js buildPayslipHTML, badge var ~line 2454). Since finance can freely edit amounts on a payslip at ANY status via openPayslipEdit (hr.js:1902-1922, ps-edit-btn shown unconditionally), a worker can see a draft net-pay figure in Recent Payslips before HR verifies/files/submits it, with no clear signal the number is still provisional and may change.

### 89. Work Sites have no delete action despite rules explicitly granting it
`M-impact · S-effort · Feature · hr-worker`  
hr.js:1674-1728 (openWorkSitesPage/load) only offers Edit and Activate/Deactivate — there is no delete button anywhere in the UI — even though firestore.rules:291 explicitly grants `allow delete: if isAuth() && isPresident()`. A mis-entered site (typo'd name, wrong pasted coordinates) can never actually be removed, only marked 'Inactive' forever, so the list permanently accumulates clutter every admin has to scroll past.

### 90. 'Valid attendance' definition is inconsistent across the clock card, calendar and finance tile
`M-impact · S-effort · Quality · hr-worker`  
worker.js:193 (_loadClockCard) requires `rec.timeIn && rec.inValid` to treat a day as timed-in, but the calendar (worker.js:431) and the month/YTD finance summary (worker.js:500) both use bare `rec.timeIn` truthiness and ignore `inValid` entirely. Any record whose inValid is explicitly false (or missing on a hand-edited/legacy doc) shows 'Not Timed In' on the clock card but 'Present' on the calendar and counts toward Days/Hours Worked. Extract one shared isValidAttendance(rec) helper used by all three.

### 91. Attendance calendar marks pre-hire days as 'Absent' with no lower bound
`M-impact · S-effort · Bug · hr-worker`  
js/screens/worker.js:420-433 (_loadWorkerCalendar) marks every past weekday with no record as 'Absent' without ever consulting profile.issuedOn or any hire/link date. A worker linked to the app mid-month sees days before their actual start date marked Absent with a red X, and the prev-month button (worker.js:618) has no lower bound at all, so a worker can page back through months (even years) before they were ever hired and see the same fabricated absences.

### 92. Work Sites 'Add/Edit' buttons are shown to users the Firestore rules will reject
`M-impact · S-effort · Bug · hr-worker`  
hr.js:1675 gates the Add/Edit Work Site buttons on `canEdit = isFinancePriv()` = canEditDept('Finance') (js/departments.js:17-25), which returns true for ANY employee whose department membership includes 'Finance' regardless of role. firestore.rules:290 gates geo_sites create/update on isFinanceOrAdmin() (firestore.rules:22), which is role-based only (president/manager/secretary/finance) and ignores department membership. A rank-and-file employee tagged into the Finance department sees and can fill out the Add/Edit Work Site form, then gets a silent permission-denied failure on save with no explanation of why.

### 93. vatSplit has no test for a negative entered amount (credit memo / sales return)
`M-impact · S-effort · Quality · finance`  
money-core.js's header states vatSplit is used by 'the sale + project billing flows' (line 33), which in practice can include refunds/credit memos with negative amounts. None of the 7 vatSplit tests in tests/money.test.mjs (money.test.mjs:59-102) exercise a negative input, so today's actual behavior on a refund (e.g. vatSplit(-1120,'inclusive')) is unverified and undocumented.

### 94. Ledger tab's 'Balance' KPI is not a meaningful accounting figure
`M-impact · S-effort · UX · finance`  
renderLedgerTab (finance.js:1182-1184, 1191) computes `balance = totalCredit - totalDebit` across the ENTIRE ledger — income, expense, asset and liability rows all mixed together with no accountType filtering — and displays it as a prominent green/red KPI card. This number is neither cash on hand, net income, nor any standard accounting total; it will plausibly be misread by finance staff or the President as 'how much money we have' or 'our profit'. Either remove the card or clearly relabel it (e.g. 'Net credit/debit skew, all account types') and point users to the actual Balance Sheet / Income Statement screens for real totals.

### 95. Break-even's built-in keyword defaults miss the two most common overflow expense categories
`M-impact · S-effort · UX · finance`  
BE_DEFAULT_FIXED_KW / BE_DEFAULT_VARIABLE_KW (finance.js:848-849) contain no 'general' or 'other' substring, yet COA.expense's actual catch-all buckets are literally named 'General Expense' and 'Other Expense' (config.js:1326-1328) — the categories most day-to-day miscellaneous costs land in. Any ledger row posted under either bucket falls through to 'Unclassified' by default every single month until Finance manually classifies it via the Classify editor, so the '⚠ Unclassified — excluded from the math' warning is likely to appear on essentially every real Break-even run out of the box.

### 96. Break-even screen classifies pure-income categories, producing phantom ₱0.00 rows in Unclassified/Fixed/Variable
`M-impact · S-effort · Bug · finance`  
renderBreakevenTab builds `byCategory` by bumping BOTH income and expense arrays into the same map (finance.js:897-904), then passes every key in it (including 'Sales Revenue'/'Other Income', which only ever have an `income` field, never `expense`) to computeBreakeven. money-core.js:169-181 pushes every byCategory key into classifiedFixed/classifiedVariable/unclassified with no amt>0 filter, so a pure-income category with expense:0 still lands somewhere (usually Unclassified, since beDefaultGuess never matches 'sales'/'income'). Every real month's Break-even screen therefore shows a ₱0.00 'Sales Revenue' (or 'Other Income') row cluttering the Unclassified table and inflating its count, confusing users into thinking a revenue account needs a Fixed/Variable tag. Fix: build `categories`/`byCategory` for break-even from expense-only keys (or filter out zero-expense entries before classifying).

### 97. 1601-C reconciliation banner false-positives every month before the WHT remittance leg is posted
`M-impact · S-effort · Quality · finance`  
bir.js:521-528 computes `diff = recomputedTax - whtLeg` where whtLeg comes from a single WHTPAY-{month} ledger doc; before that remittance is actually recorded (normal timing — it happens after payroll, ahead of the BIR deadline, not at disburse time), whtLeg is 0 and the banner always fires, unconditionally blaming it on 'a deleted employee payroll (known financeDeleteCascade gap)' even when nothing was deleted. This makes a routine, expected state look like a data-integrity alarm every month, training users to ignore the banner (which also hides the case where a real deletion-caused mismatch occurs).

### 98. VAT worksheet's 'Prior-period creditable' input silently carries over when the period is switched
`M-impact · S-effort · Bug · finance`  
window._birVatState (bir.js:404) holds `priorCreditable` on the same state object across period-picker changes; bindPeriodPicker (bir.js:409-411) only updates state.period, never resets state.priorCreditable. Switching from e.g. June to July on the 2550 VAT worksheet keeps June's manually-typed prior-credit figure applied to July's Net VAT calculation (bir.js:428, 437-438) with no visual cue that it's stale — an accountant who doesn't notice and re-zero/re-enter it will file a wrong Net VAT Payable/Creditable number.

### 99. financeEditModal's select fields have no fallback for a stored value absent from the hardcoded options list
`M-impact · S-effort · Quality · finance`  
The Ledger-tab category bug above is one instance of a systemic footgun in the shared component (finance.js:137-170): any `type:'select'` field whose `options` array doesn't include the record's current value silently resets to the first option on save, with no warning to the editor. Recommend financeEditModal auto-append the current value as an extra (marked) option when it's missing from the declared list, so drift between a hardcoded dropdown and the real data becomes visible instead of silently overwriting.

### 100. Edge-swipe-back can exit the app entirely at the root page on tablet-width touch devices
`M-impact · S-effort · Bug · core-shell`  
gestures.js's doBack() (lines 99-107) falls through to a raw `history.back()` when Overlay isn't open AND the viewport isn't the mobile off-canvas-sidebar breakpoint (isMobileSidebarViewport(), max-width:768px) — i.e. on touch-capable tablets/2-in-1s in the 769px+ 'rail' tier. Unlike the topbar back chevron, which updateNavBackBtn() (app.js:1812-1817) hides whenever `_navDepth===0`, this gesture path has no depth guard. A user who lands on the dashboard root via an external link (e.g. from a shared link or another app) and performs the left-edge swipe-back gesture on such a device will navigate the browser tab away from the app entirely instead of the gesture being a no-op.

### 101. CashAdvance.deductWorker() lacks the positive-amount guard its sibling recordPayment() has
`M-impact · S-effort · Bug · core-shell`  
js/config.js:1970-1984: recordPayment() throws 'Enter a payment amount greater than ₱0' when paid<=0 (config.js:1837), but deductWorker() has no equivalent check on `amount`. Its transaction does `after = Math.max(0, before - amt)` — Math.max only clamps the floor, so a negative or garbage `amt` (before-amt) makes `after > before`, silently INCREASING the worker's caBalance instead of deducting it. Since this backs the weekly payslip generator/editor (per its own header comment), a bad input from that flow would misstate a Type-B worker's outstanding cash-advance balance with no error surfaced.

### 102. More-sheet and profile-drawer nav links race dismiss-then-navigate, can bounce back
`M-impact · S-effort · Bug · core-shell`  
openMoreNavSheet's row click (js/app.js:1187-1193) calls window.Overlay.dismissTop() (→ history.back(), async popstate) THEN navigateTo(btn.dataset.page) synchronously. navigateTo sees Overlay still open (the popstate hasn't fired yet), so it runs its own Overlay.clearAll()+replaceState absorption on the SAME top history slot the pending back() is about to consume. When that queued back() finally fires, it pops one MORE level and lands back on the page the user was on before opening the sheet, immediately re-navigating away from the page they just tapped. The profile-drawer's '.profile-shortcut-btn' handlers (app.js:2657) do the identical requestCloseProfileDrawer()-then-navigateTo() ordering and are exposed to the same race. Compare with buildSidebarNav's click handler (app.js:1120-1128), which correctly calls navigateTo() FIRST then requestCloseSidebar() second — that ordering is documented as safe ('harmless no-op safety net') precisely because clearAll() has already absorbed the overlay by the time the close call runs.

### 103. No unit tests for finance-ledger.js's finance_rollup delta/reconciliation math
`M-impact · M-effort · Quality · infra-pwa`  
js/finance-ledger.js:227-299 (the finance_rollup sync helpers) and the full-rescan rebuild logic (lines 599-660) directly move money-relevant aggregate figures shown on the Finance Overview screen, but unlike js/money-core.js (comprehensively covered by tests/money.test.mjs) and js/geo-core.js (tests/geo.test.mjs), there is no test file for finance-ledger.js at all. Given this module already needed a 'Rebuild rollups' recovery button (js/screens/finance.js:256) for drift, it's exactly the kind of aggregation logic that benefits most from pinned unit tests.

### 104. In-progress quote-builder drafts live only in localStorage — never in Firestore until explicitly filed
`M-impact · M-effort · Data · infra-pwa`  
quote-builder-v2.html autosaves quote state (`bkqb_status`, `bkqb_photos`, lines 3024-3027) purely to `localStorage`, and the autosave guard at line 3515 explicitly skips once `quoteStatus` is 'filed'/'pending_approval' — meaning up to that point, it's ONLY ever local. A cleared browser cache, private/incognito tab, or switching devices mid-quote loses all progress with zero recovery path, and it's structurally invisible to monthly-backup.js/Drive sync since it never became a Firestore doc. Given the quote builder is a long multi-step form (labor tables, photos, pricing) embedded via iframe for Sales/Brilliant Steel staff, this is a real work-loss risk, not just a corner case. Consider a debounced Firestore draft write (even a lightweight `bs_quotes/{draftId}` doc with status:'draft') so in-progress work survives a lost tab.

### 105. Every deploy re-downloads the entire ~48-file PRECACHE list, even for a one-line change
`M-impact · M-effort · Perf · infra-pwa`  
sw.js's install handler (lines 79-85) calls `cache.addAll(PRECACHE)` unconditionally into a brand-new CACHE_VER-named cache on every single deploy — there's no diffing against the previous cache's contents. Given the stated cadence of 60+ same-day deploys, an actively-open device can re-fetch the full app shell (JS/CSS/icons/products-database.json/quote-builder-v2.html) dozens of times a day even when only one file actually changed, which is real cellular-data cost for PH-based field/shop-floor users. Consider precaching only a minimal boot subset (index.html, config.js, app.js, tokens/styles.css) and letting the existing per-file network-first/stale-while-revalidate runtime strategies lazily populate the rest.

### 106. No Firebase App Check on the app's intentionally-public rule surfaces
`M-impact · M-effort · Security · firestore.rules / storage.rules — public surfaces`  
signup_requests create (firestore.rules:830-839), usernames get (:154-158), order_tracking get (:1481-1487), and id_verify get (:1494-1503) are all reachable with no authentication at all, and none of these paths — nor storage.rules — reference App Check anywhere. Field-shape checks limit what can be written, but there's no defense against scripted/automated abuse (bulk fake signups, enumeration attempts against the public GET endpoints via token-guessing bots) at the platform level.

### 107. Storage custom claims lag Firestore role/dept changes by up to ~1 hour
`M-impact · M-effort · Security · storage.rules + functions/index.js syncUserClaims`  
storage.rules relies entirely on Auth custom claims (claimRole()/hasClaimDept(), :74-98) minted by syncUserClaims (functions/index.js:284-329) on Firestore writes. A user's existing ID token keeps its OLD claims until the token naturally refreshes or the client calls getIdToken(true); Firestore rules, by contrast, do a live get() on every request. A user demoted out of Finance or from manager to employee therefore retains their old Storage-level access (e.g. Finance/* receipts) for up to an hour after the demotion, even though the equivalent Firestore rule is enforced immediately.

### 108. chat-files / task-comments Storage objects are readable by any signed-in user, bypassing Firestore's partner/participant isolation
`M-impact · M-effort · Security · storage.rules — chat-files / task-comments read`  
storage.rules:152-156 (task-comments) and :165-170 (chat-files) gate `read`/`get` on `isSignedIn()` alone — no conversation-membership or task-assignee check, unlike the corresponding Firestore rules (conversations :392-491 wall off non-participants; tasks/comments :369-375 wall off unassigned partners). The chat-files comment itself notes DM convIds are derivable as `dm_{uidA}_{uidB}` — so any signed-in account (including an excluded partner) that knows/derives a convId and the (Date.now()-prefixed) filename can fetch the raw attachment directly, sidestepping the participant model enforced at the Firestore layer.

### 109. Dark theme never got ID-card overrides — it silently keeps the Astral gold-glass look
`M-impact · M-effort · Quality · css-a11y`  
html.light has 12+ overrides for `.id-card*` (css/styles.css:1625-1667) that undo the gold gradient/glass treatment and swap in a flat white-card style. `html.theme-dark .id-card` has zero matches anywhere in the file (verified by grep). Since the base `.id-card-company`/`.id-card-name`/`.id-card-id` rules (lines ~1544-1590) use gold gradients, gold borders, and gold glow shadows unconditionally, Dark-theme users viewing their digital ID card get the leftover Astral cosmic/gold aesthetic — directly contradicting the Dark theme's own stated design intent ('Neutral dark, NOT the old glass/cosmic look', line 2795). This looks like Light got the WS42 treatment and Dark was simply missed for this one component.

### 110. Bottom-nav inactive icons use hardcoded per-page hex colors instead of the muted-text token
`M-impact · M-effort · Quality · css-a11y`  
css/styles.css:3482-3496 hardcodes a different saturated stroke color per nav item (`#FF6B6B`, `#40CFFF`, `#FF2D78`, `#FFD60A`, `#FF9F0A`, `#30D158`, `#5856D6`, `#8B5CF6`) for inactive bottom-nav icons, even though the base `.bottom-nav-item` rule (line 1284) sets `color: var(--text-muted)` — clearly intending a uniform muted inactive state (only overridden to var(--primary)/var(--brand-primary) once active, line 1300-1301). None of these hex values are redefined per-theme, so on Light theme's white/near-white surfaces the gold (#FFD60A cash-advances/approvals) and cyan (#40CFFF tasks/team) icons have poor contrast and visually contradict the 'flat, muted, iOS Settings' design language documented elsewhere in the file for Light/Dark. Either route these through theme-aware tokens or drop them for the intended var(--text-muted).

### 111. Manager Dashboard does an unbatched per-employee attendance read on every render
`M-impact · M-effort · Perf · screens-misc`  
dashboards.js:1021-1024 runs `Promise.all(team.map(u => db.collection('attendance').doc(u.id).collection('records').doc(todayStr).get()...))` on every single Manager Dashboard render, with no dbCachedGet wrapping (unlike every other read on the same dashboard). For a manager with a large team this is N Firestore reads per page view/re-render, adding latency and read-quota cost that scales with headcount for data that only changes a handful of times a day.

### 112. Posts feed hard-caps at 30 with no pagination or "load more"
`M-impact · M-effort · Feature · people-chat`  
js/screens/people.js:124 loadPosts() always queries `.limit(30)` per department/General tab with no cursor, no infinite scroll, and no way to see anything older. A busy General feed (all-staff announcements) or an active department tab will silently bury posts beyond the most recent 30 with zero way to retrieve them from this screen.

### 113. sendMessage's conv-doc preview bump is a silent, non-atomic second write
`M-impact · M-effort · Data · people-chat`  
js/chat.js:1382-1386 writes the message doc, then separately updates lastMessageAt/lastMessageText/lastMessageBy/reads on the conversation doc with a bare `.catch(() => {})`. If this second write fails (transient error, offline flap) the message is visible in the thread but the inbox row's preview/sort order and the sender's own read-receipt silently go stale for every participant, with no retry and no log of the failure.

### 114. Gov Biddings' 3-bucket model has no visible won/lost outcome distinction
`M-impact · M-effort · Feature · production`  
govit.js:110-124 defines only PhilGEPS/Active Bids/Archive, and the sopPanel copy states 'Won or closed bids move to Archive.' This screen offers no way to see win-rate or filter Archive by outcome — if the underlying doc has no explicit result field surfaced here, win/loss reporting is impossible from this dataset despite Gov Biddings being an obvious place to want a win-rate KPI.

### 115. Government Biddings has no KPI/summary row, unlike every sibling department screen
`M-impact · M-effort · UX · production`  
govit.js:116-132's renderGovBiddings jumps straight from the sopPanel to the raw bucket list. Production (production.js:955-960), Purchasing (2027-2032), and Projects (455-461) all show a `kpi-row` with counts/totals at the top; Gov Biddings — despite tracking potentially large contract values — surfaces zero at-a-glance metrics (bid count, total pipeline value, etc.).

### 116. Design's Projects/Drawings screens still swallow Firestore errors into a fake empty state
`M-impact · M-effort · Quality · production`  
design.js:94 (`.catch(()=>({docs:[],empty:true}))`), :451-453, :617-619, and :1016-1020 all try/catch reads with only `console.warn`, leaving arrays empty — a genuine permission error on `projects`, `design_drawings`, or `tasks` renders identically to 'no projects/drawings/tasks yet'. production.js's own header (lines 53-69) documents fixing exactly this anti-pattern for Production/Purchasing; design.js was not covered by that pass and still has it throughout.

### 117. "Post Variances" silently no-ops on a genuine same-day re-count
`M-impact · M-effort · Bug · production`  
production.js:1541 keys the idempotency-guard movement doc as `CNT_${formNo}_${itemId}`, and formNo defaults to a per-day string (`IC-YYYYMMDD`). If a team counts, posts, then re-counts the same item later the same day (formNo unchanged) and posts again, the transaction (line 1543-1549) returns early for every already-posted item with no distinguishing message — the toast just reports a lower 'posted' count, giving no indication a legitimate correction was dropped as a false 'duplicate'.

### 118. Design project payments hardcode 12%-inclusive VAT with no exemption option
`M-impact · M-effort · Bug · production`  
design.js:365 computes `vatRate=12, net=amt/(1+0.12)` unconditionally on every Record Payment, whereas the parallel job_projects flow (production.js openProjectBillingModal, lines 629-634) lets Finance choose VAT-inclusive/exclusive/exempt per payment. Any VAT-exempt or zero-rated Design client's collections get an incorrect output-VAT entry booked every time, with no way to override.

### 119. Regressing a production order's stage via Edit doesn't clear stale QC/delivery-receipt data
`M-impact · M-effort · Bug · production`  
production.js's Edit modal stage `<select>` allows moving an order backward (e.g. delivered → layouting) with no gate (only the forward Advance button and the Save-path checks at lines 1341-1344 are gated). Since `e.qc`/`e.deliveryReceipt` are never cleared on a manual regression, re-advancing the same order a second time silently reuses the OLD passed QC result / old delivery receipt instead of requiring a fresh inspection, undermining the QC gate's whole purpose.

### 120. Cloud draft (draft_{uid}) is write-only — nothing in the app ever reads it back
`M-impact · M-effort · Data · Draft lifecycle`  
The Wave 3 Q6 cloud-draft slot (`draft_{uid}`, app.js:3275-3289, firestore.rules:749-765) exists 'so a closed tab doesn't lose unfiled work,' but a full-repo grep shows only `.set()` (save) and `.delete()` (cleanup on file) call sites — no code anywhere reads `draft_{uid}` back into the builder. The only resume path, `checkDraftResume()` (quote-builder-v2.html:3116-3144), works off localStorage only, which is same-browser/same-device. If a tab crashes, storage is cleared, or the user switches devices, the cloud draft the feature was built to protect against exactly that scenario sits in Firestore forever, unreachable. Either wire a real read-back path (e.g. offer 'Resume your last unsaved quote' from the Quotes tab, sourced from `draft_{uid}`) or remove the write to stop paying for dead writes.

### 121. Auto quote-number sequence is per-user, not atomic — two agents can generate the same quote number
`M-impact · M-effort · Bug · Quote numbering`  
`autoComputeCustRev` (quote-builder-v2.html:1841-1857) computes `qnoSeq` by counting only the CURRENT user's own quotes today (`where('createdBy','==',auth.currentUser.uid)`, line 1848), not a shared atomic counter. Two different sales agents each starting their first quote for a new client on the same day both compute `_autoCust=1` (line 1853), producing an identical printed quote number (e.g. `BK-XX-XX-260803-001-R1`) for two different clients. The codebase already has the correct pattern for this exact problem — `nextAECNumber`'s `_counters` Firestore transaction (sales.js:1266-1274) — but the quote-number generator doesn't use it.

### 122. Denied clock-in 'attempts' audit trail is write-only — no HR screen ever reads it
`M-impact · M-effort · Feature · hr-worker`  
worker.js:300-311 appends a full audit record (kind/lat/lng/distanceM/siteId/timestamp) to attendance_worker/{id}/records/{date}.attempts on every out-of-range Time In/Out try, but grep of hr.js shows no screen anywhere reads or lists this array — the clock card itself (worker.js:196,209-211) only ever shows the single LAST invalid attempt, transiently, until the worker eventually succeeds. A worker chronically blocked by a misconfigured site radius or noisy GPS generates data nobody in HR/finance can see to diagnose the problem.

### 123. No automatic overtime flagging from self-service attendance hours
`M-impact · M-effort · Feature · hr-worker`  
The Type-B payslip generator only has manual ps-ot-rate/ps-ot-hrs inputs (hr.js:2232-2234) — nothing in worker.js's attendance records or hr.js's 'Load Kiosk Hours' prefill (hr.js:2158-2171) flags days where a worker's own geofenced timeIn/timeOut exceeded 8 hours, so HR must manually notice and hand-type overtime for a data source (self-service GPS-verified clock times) that's uniquely well-positioned to compute it automatically.

### 124. Unmapped statutory year silently falls back to ₱0 deductions instead of blocking
`M-impact · M-effort · Data · hr-worker`  
statutory-tables.js:19-49 keys window.STATUTORY by literal year (only '2026' populated); once window.bizYear() rolls to 2027 with no matching table, computeStatutory returns all-zero ee/er values with just a console.warn (line 49). hr.js:875-879 (loadPayrollTable) uses that zero as the LIVE fallback for SSS/PhilHealth/Pag-IBIG/tax whenever an employee's own stored field is 0 — meaning the 'safe' behavior for a year nobody remembered to add is to compute and display ₱0 statutory deductions for real payroll rows, rather than erroring loudly or refusing to compute, which is backwards for a government-remittance number.

### 125. Selfie-cancel heuristic can false-positive and silently discard a real photo
`M-impact · M-effort · Bug · hr-worker`  
js/screens/worker.js:150-171 (_captureSelfie) infers 'user cancelled' purely from 'window regains focus, then no change event within 500ms.' On real devices, opening the native camera (or an intermediate Camera/Gallery chooser some Android skins show) itself blurs/refocuses the window before a photo is taken, and loading a freshly-captured full-res JPEG/HEIC into input.files can exceed 500ms. Either case fires the timer, sets settled=true, and shows 'Selfie was cancelled — Time In/Out was NOT recorded' even though the worker did take the photo — the later change event becomes a silent no-op (worker.js:157-160). Widen the grace window or key off visibilitychange with a longer delay instead of a flat 500ms.

### 126. disbursePayRun's CA-deduction loop is fully sequential, one Firestore read+batch per cash-advance line
`M-impact · M-effort · Perf · finance`  
departments.js:1691-1697 awaits window.CashAdvance.deduct() one employee at a time inside a plain for-loop (not Promise.all), and CashAdvance.deduct itself (config.js:1933-1963) does a sequential `await ref.get()` per CA line item within a single employee's plan before one batch.commit(). For a payroll run where many employees carry outstanding cash advances, this serializes N×M network round-trips during the single mutating disburse step, extending the window a run sits in the 'disbursing' lock state (departments.js:1638-1658) and increasing the odds of a stuck/interrupted run needing President intervention to reopen.

### 127. computePayRun fires two Firestore round-trips per employee with no batching
`M-impact · M-effort · Perf · finance`  
departments.js:1582-1583 calls window.getAttendanceScore(emp.id) and window.CashAdvance.planFor(emp.id, month) inside the per-employee Promise.all mapper (departments.js:1571) — each of those does its own Firestore query (planFor alone issues up to 3 sequential queries per employee, config.js:1892-1911). These run concurrently across employees, but for a larger headcount this is O(N) concurrent Firestore requests fired at once every time Compute is (re-)run, with no batching/caching across employees — worth documenting the expected scale ceiling or precomputing a batch read.

### 128. computeVatSummary (js/bir.js) — the shared VAT engine behind Reports, 2550, and the Financial Statement — has no test at all
`M-impact · M-effort · Quality · finance`  
bir.js:56-68 is pure enough to unit test (rows array in, object out; only external dependency is window.ledgerKind, easily stubbed the same way tests/money.test.mjs stubs window.bizYear). Given it feeds a BIR filing worksheet, its exempt/inclusive/exclusive classification, the `vatAmount != null` legacy-fallback branch, and the 'Sales Revenue'-only category filter (see the 'Other Income' finding above) all deserve pinned regression tests the same way vatSplit/computePayLine are pinned in tests/money.test.mjs.

### 129. js/finance-ledger.js — the sole ledger-posting/dedupe/rollup chokepoint — has zero automated test coverage
`M-impact · M-effort · Quality · finance`  
The Ledger service's own header (finance-ledger.js:65-70) documents a `_selfTest()` that exercises sanitize()/_mapEntry()/vatSplit wiring, but it's a manual dev-console function, never invoked by `node --test tests/` — tests/money.test.mjs only covers js/money-core.js. Given finance-ledger.js is described as 'one transactional money API so a ledger dedupe check can never fail open' and every money post in the app routes through it, its pure pieces (_mapEntry, sanitize, _rollupDelta — all callable with zero Firestore per their own code) deserve a real tests/ledger.test.mjs using the exact same require()-a-window-global pattern money.test.mjs already established.

### 130. Break-even's manualFixed entries (e.g. rent) are stored in one global config, not scoped per period
`M-impact · M-effort · Feature · finance`  
finance_config/breakeven's `manualFixed` array (finance.js:910, edited via openBreakevenClassifyEditor:1049-1143) applies identically to every month/quarter/year the Break-even screen is ever viewed for — past or future — with no per-period amount. If rent or another manual fixed cost changes, editing it changes the figure retroactively for every historical period's break-even math too, silently misrepresenting past months' fixed-cost basis with today's number.

### 131. financeDeleteCascade + the source-doc delete are not atomic
`M-impact · M-effort · Bug · finance`  
window.financeExecuteDelete (departments.js:350-364) runs financeDeleteCascade (restores CA balances, deletes mirrored ledger rows) BEFORE deleting the source doc, as two separate un-transacted steps. If the process dies or a write throws between them (e.g. after CA balances are restored/ledger rows deleted but before `db.collection(collection).doc(docId).delete()` runs), the source doc (e.g. a salary_history record) still exists showing as if nothing happened, while its ledger mirror and CA reversal have already been applied — a retry of the same delete would then double-reverse the CA balances. Given this sits behind the President-only delete-approval gate and touches real money records, wrapping the cascade + delete in one transaction (or making the cascade idempotent/re-checkable) would remove this window.

### 132. computeVatSummary silently excludes all 'Other Income' rows from the VAT worksheet
`M-impact · M-effort · Bug · finance`  
bir.js:56-68 only scans rows with `category === 'Sales Revenue'` for Output VAT (vatableSales/exemptSales/outputVat) — COA.income also lists 'Other Income' (config.js:1325), but any row posted under that category is invisible to computeVatSummary entirely, not even bucketed as exempt. If Finance ever books a VATable transaction (e.g. scrap-material sale, rental income) under 'Other Income' instead of 'Sales Revenue', its Output VAT never appears in the 2550 worksheet, Reports, or the Financial Statement — understating VAT payable with no warning anywhere.

### 133. CashAdvance.approve()'s compound-interest total divided into equal installments can under/over-charge by design of the rounding, not just the last row
`M-impact · M-effort · Data · core-shell`  
js/config.js:1730-1734: `total = amount * (1+pct/100)^terms` (true compound interest) is divided by `terms` into an EQUAL `monthly` payment, then `totalPayable = monthly*terms` is derived FROM the rounded monthly (documented as intentional, 'no centavo drift'). This is mathematically a flat/add-on interest schedule dressed as compound interest — for terms>1 with a nonzero rate this is more expensive to the borrower every month than a true amortizing schedule would be (which front-loads interest, back-loads principal), yet the UI (openApproveModal's preview, line 1792-1799) presents it simply as '₱X/mo × N' with no schedule breakdown or amortization disclosure. Worth confirming with Neil whether this add-on-interest presentation is the intended/disclosed lending model, since CA repayments are deducted directly from employee payroll.

### 134. Force-logout listener puts a permanent onSnapshot on one shared doc for every online client
`M-impact · M-effort · Perf · core-shell`  
startForceLogoutListener (js/app.js:167-194) attaches `db.collection('settings').doc('system').onSnapshot(...)` for the full session lifetime (up to the 10-day AUTO_LOGOUT_MS window) purely to catch the rare president-triggered force-logout event. Any write to settings/system for an unrelated reason (a different feature flag, config toggle, etc.) re-delivers the full document to every concurrently signed-in client's listener. As headcount grows this is unnecessary read amplification for an event that fires maybe a few times a year; consider narrowing to a dedicated small doc/collection that's ONLY ever written for force-logout, or switching to a lighter polling interval instead of a live listener.

### 135. Boot-time login fires ~8-10 uncached Firestore reads in an uncoordinated burst
`M-impact · M-effort · Perf · core-shell`  
The success branch of onAuthStateChanged (js/app.js:95-130) fires, in short order: loadUserProfile (2 gets, 3 on first-ever login), checkPayrollDuties (1-2 gets), checkCAReminder (1 get), Notifs.checkDeadlines (2 queries), Notifs.checkAttendanceReminder (1 get), Notifs.checkLowStock/checkAECFollowups (cached but still 1 read each when cold), checkBackupHealth (2 gets, admin roles only) — none of it batched, deduped beyond dbCachedGet's per-key cache, or staggered. On a slow connection this is a visible burst of round-trips right when the user is trying to see their dashboard; worth consolidating into fewer reads (e.g. a single 'boot digest' doc) or staggering non-critical checks (backup health, CA reminder, payroll duties) behind requestIdleCallback/a short delay.

### 136. Notification badge count and in-panel 'unchecked' hint use two different truth sources
`M-impact · M-effort · Bug · core-shell`  
js/notifications.js: the header/nav badge is driven by _refreshUnreadCount (line 37-52), a dedicated `where('read','==',false).limit(100)` query — the TRUE unread count. But _renderIntoList's `unreadCount` (line 261) and the _updatePanelHint text it feeds (line 262, 'X unchecked') are computed only over `items`, the 30-item live listener window from startListener's `.limit(30)` (line 18). A user with more than 30 unread notifications sees a bell badge saying e.g. '45' while the dropdown/page header simultaneously says '12 unchecked' — a visibly inconsistent count in the same UI.

### 137. sw.js's header comment describes the intended hook behavior, not a guaranteed one
`L-impact · S-effort · Quality · infra-pwa`  
sw.js's own header comment (lines 1-9) and CLAUDE.md both describe CACHE_VER as 'derived from APP_VERSION,' but that's only true when `.githooks/pre-commit` is the active hook (see finding #1). Add a short note in the comment (or better, the CI check from finding #2) so this claim is guaranteed rather than aspirational.

### 138. manifest.json has no `id` member for stable PWA identity
`L-impact · S-effort · Quality · infra-pwa`  
The Web App Manifest `id` field (distinct from `start_url`) lets Chrome/Android treat the installed app as the same app across future `start_url`/`scope` changes. manifest.json (lines 1-79) omits it. Low risk today, but if `start_url` or `scope` ever needs to change (e.g. adding a locale prefix), existing installs could be treated as a new app and lose their home-screen placement. Add `"id": "/"` now while it's a no-op change.

### 139. ci.yml's 'money-math-tests' job name doesn't mention the geofencing test suite it also runs
`L-impact · S-effort · Quality · infra-pwa`  
ci.yml names the job 'Money-math tests (vatSplit, computeStatutory, computePayLine)' but `node --test tests/` also runs tests/geo.test.mjs (haversineMeters/siteMatch) — 10 of the suite's 38 total tests. A failure notification titled purely around money math is misleading for anyone triaging a geofencing regression, or vice versa.

### 140. Offline fallback for uncached HTML/API requests is an unstyled plain-text 503
`L-impact · S-effort · UX · infra-pwa`  
sw.js's `networkFirst()` (lines 172-187) returns `new Response('Offline — content not available', { status: 503, headers: { 'Content-Type': 'text/plain' } })` when both the network fetch and the cache lookup miss. A user navigating while genuinely offline (or an iframe like quote-builder-v2.html failing a lazy fetch) sees a bare, unbranded browser-rendered text blob instead of anything matching the app's design system. Precache a small branded offline.html and serve that instead of the plain-text Response.

### 141. Google Fonts hosts aren't in sw.js's CDN_CACHE_PATTERNS despite being preconnected in index.html
`L-impact · S-effort · Perf · infra-pwa`  
index.html preconnects to fonts.googleapis.com and fonts.gstatic.com (lines 53-54) for the Inter font loaded via @import in css/styles.css, but sw.js's CDN_CACHE_PATTERNS (lines 72-76) only covers gstatic.com/firebasejs, cdn.jsdelivr.net/npm/chart.js, and unpkg.com/lucide@ — font requests fall through to generic cross-origin network-first (sw.js:143-144) instead of the cache-first treatment given every other versioned static CDN asset. On a flaky connection this means the app can stall on a font round-trip it doesn't functionally need. Add the two font hosts to CDN_CACHE_PATTERNS.

### 142. Stale hardcoded version fallbacks in app.js and index.html
`L-impact · S-effort · Quality · infra-pwa`  
js/app.js:383 falls back to `const v = window.APP_VERSION || '9.4'` and index.html:202's static markup reads 'Operating System · v12.0.0' — both are used only if `_applyBrandVersion()` fails to run before that DOM update, but both are far behind the real current v14.0.9. If config.js ever fails to load in time (flaky connection, CSP block, etc.), a user/support screenshot would report a version number that's 2+ major versions stale, misdirecting triage.

### 143. OVERRIDES keys in monthly-backup.js are never validated against real collections by the coverage checker
`L-impact · S-effort · Quality · infra-pwa`  
check-backup-coverage.js's `extractOverrideKeys()` only feeds a console.log line (main(), line 123) — it's never cross-checked against `scanned`. A future rename or typo in an OVERRIDES key in scripts/monthly-backup.js (e.g. renaming `kpi_evals` to match a renamed collection but missing one call site) would silently stop producing that collection's readable CSV export and month-activity report with zero CI signal — the full JSON snapshot would still work (that path is independent via db.listCollections()), so the regression would be invisible until someone specifically needed the CSV.

### 144. check-backup-coverage.js's BASELINE list has stale entries that no longer map to any real collection
`L-impact · S-effort · Quality · infra-pwa`  
The BASELINE array in scripts/check-backup-coverage.js includes `finance_records` and `president_message` — neither appears as an actual `.collection('...')` call anywhere in js/ or js/screens/ today. The script only flags phantom EXCLUDE entries against `scanned` (main(), lines 126-136); it never checks BASELINE entries the same way, so these two sit indefinitely as dead/confusing context in every 'new collections' drift report with no mechanism to ever surface or prune them.

### 145. Manifest's maskable icons aren't in sw.js's PRECACHE list
`L-impact · S-effort · Quality · infra-pwa`  
manifest.json declares `icons/icon-maskable-192.png` and `icons/icon-maskable-512.png` (lines 23-34, purpose:'maskable') — both files exist on disk (icons/icon-maskable-192.png, icons/icon-maskable-512.png) — but sw.js's PRECACHE array (lines 62-66) only lists icon-192.png, icon-512.png, bi-logo.svg, favicon.svg, favicon.png. scripts/ci-invariants.sh's PRECACHE check only verifies JS/CSS referenced by index.html, never manifest-referenced assets, so this gap is invisible to CI. Add both maskable icon paths to PRECACHE.

### 146. files_*/budgets_* wildcard rules are a self-documented 'union-permit trap' with no lint/guard against it
`L-impact · S-effort · Quality · firestore.rules — {coll} wildcard matches`  
firestore.rules:1571-1580 explicitly warns that any future collection literally prefixed `files_` or `budgets_` is automatically union-granted the generic cross-department read/write rules at :1581-1615, with 'no way to opt out.' There is nothing enforcing this outside a code comment — a new collection like `files_archive` or `budgets_template` added later (by a different session/dev, per the repo's own concurrent-editing memory) would silently inherit looser access than intended, and nothing would flag it at review or deploy time.

### 147. expenses: owner can freely change `amount` after filing — only `status` is frozen
`L-impact · S-effort · Security · firestore.rules — expenses update`  
firestore.rules:698-702: `allow update: if isAuth() && (isFinanceOrAdmin() || (resource.data.createdBy == request.auth.uid && request.resource.data.status == resource.data.status));` — the submitter's own edit path locks `status` but leaves every other field, including `amount`, freely editable right up until Finance acts on it, with no diff/audit record of the change.

### 148. att-mark/att-present/att-half/att-absent status colors are pure hardcoded hex with no dark/light distinct tuning, unlike the rest of the semantic palette
`L-impact · S-effort · Quality · css-a11y`  
css/styles.css:3407-3416 hardcodes attendance-day colors (`#30d158`, `#ffaa00`, `#ff453a`) directly rather than through `--success`/`--warning`/`--danger` tokens, which DO get theme-specific AA-tuned values (e.g. Light's `--success:#1B873F` vs the raw `#30d158` used here). This mirrors the deliberate 'presence dots are real-world state, not theme-relative' rationale documented in tokens.css:64-72 — if that's the intent here too, add a one-line comment saying so (as tokens.css does for presence) so a future contributor doesn't 'fix' it into `var(--success)` and accidentally shift the color at low-opacity backgrounds on Light where the raw green sits differently than the tuned token would.

### 149. outline-offset/border-radius on the global focus ring doesn't account for pill-shaped controls
`L-impact · S-effort · UX · css-a11y`  
css/styles.css:5899-5903 sets `outline-offset: 2px; border-radius: var(--r-xs);` universally for `:focus-visible`. Pill-shaped controls like `.chip-tab`/`.badge` (`border-radius: var(--pill)`) will show a squared-off focus ring corner poking out past their own rounded corners at 2px offset — a small but easily-fixed visual polish gap once the ring is actually keyboard-tested end to end (worth checking now that item #9 above flags it may not have been visually reviewed on pill controls).

### 150. chip-count.on red badge repeats the same white-on-saturated-red contrast risk as the pink count badges
`L-impact · S-effort · A11y · css-a11y`  
css/styles.css:1893-1894 `.chip-count.on { background: var(--danger, #e5484d); color: #fff; }` at `--fs-xs` (~10-11px). `--danger` is theme-aware (#FF453A astral/root, #D92D20 light, #F0284A dark) but none of those were necessarily chosen with a small-white-text-on-top pairing in mind the way the badge-gray/blue/etc. text colors were (Phase 187 comment). Worth running the same AA check that was done for the other badges against this specific white-on-danger combination in all 3 themes.

### 151. No @media (prefers-contrast: more) support anywhere
`L-impact · S-effort · A11y · css-a11y`  
grep for `prefers-contrast` across css/styles.css returns nothing. The app already has a well-built reduced-motion query (5913-5946) and a real forced-colors gap noted above, but nothing bumps border/text contrast for users with `prefers-contrast: more` set at the OS level — a low-cost addition (e.g. thickening `--border`/`--border-strong` and raising `--text-muted` opacity under that query) given the token system already centralizes these values.

### 152. Horizontal-scroll containers hide their scrollbar entirely, removing the only visual affordance that more content exists
`L-impact · S-effort · UX · css-a11y`  
css/styles.css uses `scrollbar-width: none` + `::-webkit-scrollbar { display:none }` on `.chip-tabs` (6092/6096), `#tn-tabs` (905), and `.subtab-bar` (1852/1855) to get an iOS-style hidden scrollbar. On desktop with a mouse (no touch/swipe affordance hint), a user with more chip-tabs/subtabs than fit on screen has zero visual cue that the row scrolls — no fade edge, no arrow, nothing. Consider a subtle edge-fade mask (`mask-image: linear-gradient(...)`) instead of fully hiding the scroll affordance, at least for `@media (hover:hover) and (pointer:fine)`.

### 153. .notif-item single-line/ellipsis layout (with hover/unread/read color logic) is dead — a later unscoped block fully overrides its layout
`L-impact · S-effort · Quality · css-a11y`  
css/styles.css:992-1016 defines the original notification-row layout: horizontal flex row, `.notif-item-body { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }` (single-line truncation), plus `.notif-item.unread`/`.read` background states. A later, top-level (not media-scoped) block at 5672-5684 unconditionally sets `.notif-item { flex-direction: column; }` and `.notif-item-body { white-space: normal; }` — same specificity, later wins, so notifications actually render as stacked/wrapped text everywhere, and the truncation comment/behavior at line 1014 is fiction. The unread/read background rules (999-1006) still apply since they're not redeclared, so the block is only partially dead — worth trimming the now-false layout properties out of 992-1016 so a future reader isn't misled about how the row actually lays out.

### 154. No global ::placeholder styling for the app's primary form inputs
`L-impact · S-effort · A11y · css-a11y`  
Only one placeholder rule exists in the whole file — css/styles.css:5834 `.profile-inline-input::placeholder`. The ubiquitous `.form-group input/textarea/select` (declared at line 327) that every form in the app (quotes, payroll, cash-advance, approvals) uses has no `::placeholder` rule at all, so placeholder text falls back to each browser's UA-default gray. That color isn't guaranteed to meet contrast against the app's 3 custom themes (near-black Astral surfaces vs. pure-white Light surfaces) and isn't visually consistent across browsers. Add a token-driven `.form-group input::placeholder, .form-group textarea::placeholder { color: var(--text-muted); }` rule.

### 155. Dead .subtab-btn.active gradient-pill treatment — fully overridden across all 3 themes
`L-impact · S-effort · Quality · css-a11y`  
css/styles.css:1857-1862 gives active subtabs a `var(--grad-pk-bl)` animated gradient pill with white text and a colored shadow (plus an Astral-only animation at 1865). A later, un-themed block at 5371-5375 fully redeclares `.subtab-btn.active { background: var(--primary-soft); color: var(--primary); box-shadow:none; }`, and its own Astral override at 5376-5382 supersedes the 1865 rule too. The entire 1857-1862 gradient-pill design is dead in every theme — 12 lines of a fully-built visual treatment that never paints. Either restore it deliberately (if it was meant to survive) or delete it.

### 156. Dead duplicate .top-nav-item.active rule (pink, unthemed) — fully overridden
`L-impact · S-effort · Quality · css-a11y`  
css/styles.css:922-923 sets `.top-nav-item.active { color: var(--pink); }` with a pink drop-shadow. A later block at 5069-5077 fully redeclares `.top-nav-item.active { color: var(--primary); background: var(--primary-soft); }` (with its own Astral-only pink override at 5076), same specificity, later in source — it wins outright. Lines 922-923 never render; delete them to stop the pink-vs-primary confusion for whoever touches top-nav next.

### 157. Dead duplicate .nav-item.active rule — fully overridden, safe to delete
`L-impact · S-effort · Quality · css-a11y`  
css/styles.css:1147-1152 defines an older `.nav-item.active { color: var(--text); background: var(--s2); }` plus a `::after` right-edge gradient bar. A later same-specificity block at 5173-5179 sets `.nav-item.active::after { display:none }` and redeclares `.nav-item.active` with a completely different look (pill background, var(--primary) text). Since it's the same selector with equal specificity, the later block wins every property — lines 1147-1152 render nothing today and are pure cascade cruft that will confuse the next person editing 'the' nav-item.active rule.

### 158. renderAuditLog's entity/action filter dropdowns are derived only from the most recent 500 entries
`L-impact · S-effort · Quality · screens-misc`  
dashboards.js:237 caps the audit_log query at `.limit(500)`, and the 'All entities'/'All actions' filter option lists (dashboards.js:244-245) are built purely from that capped result set. Once the log exceeds 500 rows, older entity/action types silently disappear from the filter dropdowns even though they may still exist further back — there's no indication the list of available filters is itself truncated.

### 159. statusBadge()/statusLabel() in departments.js duplicate the TASK_STATUSES lookup that statusBadge2('task', ...) already provides
`L-impact · S-effort · Quality · screens-misc`  
departments.js:454-462 re-implements a `window.TASK_STATUSES.find(x=>x.value===s)` lookup with its own non-task fallback dict, while ui-status-meta.js:143,162 already registers the identical lookup under the 'task' domain (`task: () => window.TASK_STATUSES || []`). tasks.js's own taskCard() (tasks.js:163) still calls the old statusBadge()/statusLabel() rather than statusBadge2('task', ...)/statusLabel2('task', ...), so the canonical task-card renderer used by every task list in the app doesn't route through the shared status-meta kit it could just as easily use — functionally harmless today only because statusBadge() happens to consult the same table, but it's a second source of truth for the same data.

### 160. openTaskDetail's Submit-for-review gate doesn't exclude 'done' tasks
`L-impact · S-effort · Bug · screens-misc`  
tasks.js:488 `canSubmit = isAssignee && !['submitted','review','approved','on-hold','archived'].includes(t.status)` omits 'done' (same missing-status class as findings #10 above), so an assignee whose task is already marked Done still sees and can click the 'Submit' button, re-submitting a completed task back into the review queue.

### 161. Product Database's add/edit form escapes some fields with escHtml() and others with a raw quote-only replace()
`L-impact · S-effort · Quality · screens-misc`  
dashboards.js:342-343,375 (title, photoUrl `src`) use `.replace(/"/g,'&quot;')` to build attribute values, while the same function escapes specifications (:372) and other fields with escHtml(). The two are not equivalent (the manual replace only escapes double-quotes, not `&`/`<`/`>`), so this is an inconsistent, easy-to-miss deviation from the codebase's stated escaping convention in the one function that builds both an 'Add' and an inline 'Edit' form.

### 162. PO rejection in Approvals uses a raw browser prompt() instead of the app's styled promptDialog()
`L-impact · S-effort · UX · screens-misc`  
approvals.js:448 `const reason = prompt('Reason for rejection (shown to Purchasing):');` is the only rejection reason prompt in the whole file that isn't `promptDialog({...})` (compare the raise-reject and leave-reject handlers a few lines away, which both use promptDialog with multiline support). The native prompt() breaks the app's dark/light theming, has no multiline support, and is visually inconsistent with every other reject flow on the same page.

### 163. Quote/ROA approvals list has the same generic-statusBadge gap for non-task quote statuses
`L-impact · S-effort · Bug · screens-misc`  
approvals.js:~1136 (the 'else' branch rendering approval_requests as quote/ROA items) also calls the generic `statusBadge(item.status)`, whose fallback dict has no entries for 'filed', 'needs_revision', or 'pending_approval' — all of which ui-status-meta.js's QUOTE_STATUSES (ui-status-meta.js:31-45) already models with correct colors/labels. Quote approval items in those statuses render an unstyled gray badge with the raw status string instead of a proper 'Filed'/'Needs Revision'/'Pending Approval' pill.

### 164. Cash Advance list in Approvals renders a wrong/unstyled badge for 'paid' status
`L-impact · S-effort · Bug · screens-misc`  
approvals.js:1092 uses the generic `statusBadge(item.status)` (departments.js:454-457, whose fallback map only knows open/done/pending/draft/sent/accepted/reviewing/rejected/approved) instead of `window.statusBadgeClass('ca', item.status)`. ui-status-meta.js:121-127 already defines CA_STATUSES with 'paid' → 'Paid Off' / badge-blue specifically to unify this, but the Approvals 'Cash Advances' subtab was never migrated, so a paid CA renders as plain gray text 'paid' instead of the intended blue 'Paid Off' pill shown elsewhere in the app.

### 165. CA-deduction-for-this-run request approve/reject never notifies the requesting employee
`L-impact · S-effort · Bug · screens-misc`  
approvals.js:412-421 ('.cad-approve-btn'/'.cad-reject-btn') flips the approval_requests doc status with only a toast to the approver; no Notifs.send to the employee who filed the CA deduction request. They only find out indirectly when their next payslip does or doesn't reflect it.

### 166. Annual leave accrual uses a native confirm() instead of the app's confirmDialog
`L-impact · S-effort · Quality · people-chat`  
js/screens/people.js:2010 `if(!confirm(...)) return;` in the Run Annual Accrual handler is the one spot in this file that uses the browser's native, unstyled confirm() — every other destructive/approval action in the same file (reject leave, delete CA, delete post, leave group, etc.) uses `await confirmDialog({...})`, which matches the app's theme and doesn't block the JS thread. This one blocks rendering, ignores dark/light theme, and looks out of place.

### 167. Team directory search re-renders the whole masonry grid on every keystroke
`L-impact · S-effort · Perf · people-chat`  
js/screens/people.js:436-444 — the team-search input handler filters and calls renderTeamCards() (full grid rebuild + re-wiring every card's click handlers) on every 'input' event with no debounce, unlike Inventory's search (js/modules.js:186, 180ms debounce) or Movements' search (line 338) in the same codebase. Fine at today's team size but inconsistent with the debounce pattern already established elsewhere.

### 168. Per-conversation chat drafts in localStorage are never garbage-collected
`L-impact · S-effort · Quality · people-chat`  
js/chat.js:2196-2204 _saveDraft/_loadDraft/_clearDraft key drafts as `bi-chat-draft-{convId}`, cleared only on successful send. A draft typed into a group later left, or a dept channel the user no longer belongs to, stays in localStorage forever with no cleanup hook tied to leaving a group (_openMediaTab's Leave handler, line 3052-3062) or losing dept membership.

### 169. Inventory/Job Costing deletes skip the audit log the create/update paths use
`L-impact · S-effort · Quality · people-chat`  
js/modules.js — itemModal's delete handler (267-269) and jobModal's delete handler (419-423) call `.delete()` directly with only a toast, while their sibling save handlers on the same modals call `window.logAudit(...)` (lines 251/260/292 etc.). Deleting a priced inventory item or a job-cost record — both money-adjacent — leaves no audit trail of who removed it.

### 170. Nudge button shows "sent" success even when the notification was deduped
`L-impact · S-effort · Bug · people-chat`  
js/screens/people.js:917-933 always flips to '✅ Nudge sent!' after Notifs.send() resolves, but Notifs.send() (js/notifications.js:436-443) silently returns without writing anything if a notif with the same dedupKey already exists — and the nudge dedupKey is per-day-per-sender-target (people.js:928). A second nudge to the same person on the same day reports success to the sender while producing no actual notification.

### 171. Department-channel notifications are sent one-by-one, not in parallel
`L-impact · S-effort · Perf · people-chat`  
js/chat.js:1417-1443 _notifyRecipients() loops `for (const uid of targets) { ... await Notifs.send(...) }` sequentially. For a department channel with many members this serializes N Firestore writes; switching to Promise.all(targets.map(...)) would cut wall-clock notify latency roughly N-fold with no behavior change (each send is already independent/fire-and-forget from the caller's perspective).

### 172. Access Control 'Revoke' button stays clickable on already-revoked records
`L-impact · S-effort · Quality · production`  
govit.js:627 always renders the Revoke button for every row regardless of `r.status`, so clicking Revoke on an already-revoked record just re-writes the same `status:'revoked'` fields (harmless but pointless) instead of showing an already-revoked state or hiding the action.

### 173. Drawing status transitions notify the assignee/dept but never notify the client-facing tracker for Design-only (non-job-linked) projects
`L-impact · S-effort · Feature · production`  
changeDrawingStatus (design.js:808-874) only pushes a document/timeline update into job_projects, and thus onto the public order tracker, when `project?.jobProjectId` is set (line 860). A pure Design engagement with no linked Job Project has drawing releases visible only inside the app — fine internally, but worth confirming this is the intended behavior rather than a gap, since the release-without-link path only shows a one-time confirm warning (line 822-826) with no lasting flag on the project that it's still unlinked.

### 174. 'Post Variances' only posts variances visible under the currently-selected kind filter
`L-impact · S-effort · UX · production`  
production.js:1526-1568: the posted set is derived from `shown`, which is filtered by whatever kindFilter tab (All/Raw Materials/Finished Goods) is currently active. If a user filters to 'Raw Materials' and clicks Post, any Finished-Goods variances entered earlier (while on a different tab) are silently excluded from that click with no on-screen indication the action is scoped to the current filter.

### 175. Projects Lifecycle screen has no CSV export, unlike Production Orders and Purchase Requests
`L-impact · S-effort · Feature · production`  
production.js's renderProjectLifecycle (406-480) has no equivalent of the `prod-csv` button in renderProdOrders (line 1004-1009) or `window.exportPurchasesCSV` in renderPurchaseRequests (line 2026) — Finance/management can't export the job_projects pipeline (contract/collected/AR per project) to CSV from this screen, despite it being the one place that shows the whole project book.

### 176. openJobProjectDetail falls back to stage 'Won' instead of surfacing a corrupted/unrecognized project stage
`L-impact · S-effort · Bug · production`  
production.js:491-492: `idx = JOB_STAGES.findIndex(...)` returns -1 for a stage value that doesn't match any JOB_STAGES id; `next = JOB_STAGES[Math.min(idx+1, JOB_STAGES.length-2)]` then evaluates to `JOB_STAGES[0]` ('won'). A project with a bad/legacy stage string silently offers 'Advance → Won' instead of surfacing the data problem to an admin.

### 177. IT ticket priority is capped at low/medium/high, missing the 'urgent' tier used elsewhere
`L-impact · S-effort · UX · production`  
govit.js:293 (new-ticket priority `<select>`) and the badge ternary at line 761 only support 3 tiers, while every other priority picker in the app — production.js's prodOrderModal (line 1249) and design.js's task delegation (line 963) — has 4 tiers including 'urgent'. A genuinely urgent IT outage has no way to signal above 'high'.

### 178. Empty-state colspan hardcoded to include the edit-only action column for non-admin IT viewers
`L-impact · S-effort · Quality · production`  
govit.js:359 always renders `colspan="7"` for the Assets 'No assets recorded' row and :478 always renders `colspan="8"` for Software, even though both tables drop one `<th>` when `canEdit` is false (their own filter-change re-renders at line 450 correctly use colspan=6 for that case). Cosmetically harmless (browsers clip excess colspan) but signals the initial render wasn't updated in step with the conditional column.

### 179. loadITContent doesn't re-check itAdmin before querying it_access/it_network
`L-impact · S-effort · UX · production`  
govit.js hides the 'Access Control'/'Network' tabs for non-admins in renderIT (line 147), but loadITContent's switch (lines 601-611, 674-685) has no client-side admin gate mirroring that — unlike production.js's QC/DR stage gates, which are mirrored client-side even though rules also enforce them. A non-admin reaching this function with sub='Access Control' (e.g. a stale deep link) gets an opaque 'Couldn't load' Firestore-denial error instead of a clear 'Admin only' message.

### 180. advanceProjectStage and the Margin modal's Save lack the double-submit guard used elsewhere in the same file
`L-impact · S-effort · Quality · production`  
openProjectBillingModal, openJobBillingInvoiceModal, and recordPurchaseDisbursement all disable their Save button before the await to guard against double-click double-posting; `advanceProjectStage` (production.js:594-613) and `openProjectMarginModal`'s `pm-save` handler (573-591) do not, so a double-click can append duplicate timeline entries and fire duplicate department notifications.

### 181. Stale code comment claims window.PROD_STAGES/PURCH_STAT were never assigned to window — the same file assigns both
`L-impact · S-effort · Quality · production`  
production.js:143-154's header says 'neither name was ever assigned onto window anywhere in the codebase... so those two lookups silently return []/{} today,' but line 161 (`const PROD_STAGES = window.PROD_STAGES = [...]`) and line 1981 (`const PURCH_STAT = window.PURCH_STAT = {...}`) both do assign to window. ui-status-meta.js's `prod_stage`/`pr_stage` lookups actually resolve correctly today, contradicting the note. Update or remove the stale comment before it misleads someone into 'fixing' a non-bug.

### 182. Revision delta percentage can blow up to absurd values when the prior revision was near-zero
`L-impact · S-effort · Quality · Revision-chain UI polish`  
`quoteRevDeltaHtml` (sales.js:899-908) computes `pct = Math.round((diff/Math.abs(prev))*100)` with only a `!prev` (exactly-zero) guard. A first revision mispriced at, say, ₱1 followed by a corrected ₱50,000 R2 renders as '▲ ₱49,999 (+4999900%)' in the chain-history view instead of being treated as a data-correction special case — cosmetic today, but worth clamping/labeling for very small `prev` values so the revision-chain UI doesn't display nonsense percentages to Sales/Finance reviewers.

### 183. Discount is computed on Delivery & Installation as well as item subtotal, with no callout
`L-impact · S-effort · Data · Pricing math edge cases`  
`computeTotals()` (quote-builder-v2.html:2292-2312) builds `preDiscount = subtotal + diAdded` when delivery is marked 'included in total,' then applies the discount % to that combined base before VAT. This silently discounts freight/installation whenever a % discount is selected, which is atypical for PH B2B quoting (delivery is usually excluded from trade discounts) and isn't surfaced anywhere in `renderTotals()` — the line just reads 'Discount (X%)' against the combined figure. Worth confirming with Sales/Finance whether this is the intended math, since it silently shrinks the delivery line every time a discount is applied.

### 184. Quotes filed before editableState existed are permanently un-reopenable with no explanation
`L-impact · S-effort · UX · Revision-chain integrity / data migration`  
Every Reopen/New Revision button across sales.js is conditioned on `q.editableState` (e.g. lines 998, 931, 1060, 1675) — quotes filed before this snapshot was captured (or if a write ever failed to include it) simply have no action buttons rendered, with no tooltip or empty-state message telling the viewer why. A Sales/Finance user auditing an old quote has no way to know whether the missing buttons are a permissions gate or a data gap.

### 185. Reopen button's 'this makes a new copy' behavior is undocumented on the BK quotations list
`L-impact · S-effort · UX · UX consistency`  
The BS quotations list's Reopen button carries an explicit tooltip: 'Open this quote in the builder to edit — re-filing saves a new copy' (sales.js:930, 1674). The BK quotations list's otherwise-identical Reopen button (sales.js:998, 1060) has no `title` attribute at all. Same underlying behavior, inconsistent discoverability between the two nearly-parallel screens — a BK sales user has no in-UI hint that Reopen won't edit the original.

### 186. Reopen-handler logic is duplicated verbatim across BK and BS quotations lists
`L-impact · S-effort · Quality · Code quality`  
The 'fetch doc, check editableState, toast on failure, set _qbReopenState, navigate' block appears near-identically at sales.js:1025-1030 (bk-reopen-btn) and sales.js:1805-1816 (bs-reopen-btn) instead of one shared helper. Beyond the duplication itself, this is exactly why fix #2 (the missing rootQuoteId stamping) had to be made in two places instead of one — consolidating into a single function (ideally `window.reopenQuoteFromDoc`) fixes both the duplication and the chain-linking gap together.

### 187. postMessage bridge trusts origin but not source — no check that the message actually came from the quote-builder iframe
`L-impact · S-effort · Security · postMessage security`  
The main quote bridge listener (app.js:3264-3267) checks `e.origin === window.location.origin` but never checks `e.source` against the tracked `#qb-frame` iframe's `contentWindow`, unlike the narrower `QB_READY`/`REQUEST_STATE` handlers a few hundred lines away (app.js:1496-1497, 1516) which do. Any same-origin context able to call `window.postMessage` could forge `QUOTE_FILED`/`QUOTE_UPDATE`/`QUOTE_DRAFT` and have it processed as a real quote-builder submission. Low likelihood absent an existing same-origin XSS, but cheap defense-in-depth to add given the pattern already exists elsewhere in the same file.

### 188. Attendance selfie thumbnails are duplicated inline-style blocks across three render branches
`L-impact · S-effort · Quality · hr-worker`  
worker.js:215-216 and 225 repeat the same 52px rounded/bordered <img> inline-style markup for inSelfieUrl/outSelfieUrl across the 'done' and 'timed-in' branches of _loadClockCard. A small shared template string (e.g. `_selfieThumb(url,label)`) would remove the duplication and make a future sizing/style tweak a one-line change instead of three.

### 189. hrp-linked-uid help text and worker.js header disagree on the feature's version
`L-impact · S-effort · Quality · hr-worker`  
hr.js:1562 labels the Linked Login Account hint 'v12 WS20', while worker.js's own file header (lines 16-28) describes itself as the 'v14 Type-B self-service' landing of that same bridge. Cosmetic, but confuses anyone grepping WS/version tags to understand when this field actually became load-bearing.

### 190. Retry after a rejected Time In/Out redoes the entire GPS + sites round trip
`L-impact · S-effort · Perf · hr-worker`  
worker.js:249-338 has no short-lived memoization of the just-fetched geo_sites list or position for an immediate retry — every retry (even one taken 2 seconds after the worker steps closer to the gate) re-requests geolocation and re-queries geo_sites from scratch. Minor cost per attempt, but adds up for workers who need several tries to get inside a tight radius.

### 191. No minimum-shift-length guard or confirmation on Time Out
`L-impact · S-effort · UX · hr-worker`  
worker.js's _handleClock('out', ...) path (worker.js:249-376) has no check that the elapsed time since timeIn is sane before writing hoursWorked straight from computeDayHours; an accidental double-tap of Time Out seconds after Time In records a near-zero-hour 'shift' with no confirmation prompt, and that figure flows unchecked into the payslip generator's kiosk-hours prefill.

### 192. No boundary test for distanceM === radiusM in siteMatch
`L-impact · S-effort · Quality · hr-worker`  
geo-core.js:74 uses an inclusive `<=` for the in-range check, which is the exact edge the blocking UI depends on ('just barely inside' vs 'just barely outside'), but tests/geo.test.mjs's radius-edge tests (lines 61-78) only check ~100m (well inside) and ~400m (well outside) — never the exact boundary value itself.

### 193. geo.test.mjs never exercises the malformed-site / non-numeric-input paths it defends against
`L-impact · S-effort · Quality · hr-worker`  
geo-core.js:44 has a defensive NaN-guard in haversineMeters, and geo-core.js:70 filters out sites whose distance computes to non-finite (e.g. missing/typo'd lat/lng), but tests/geo.test.mjs has no test for either path. A HR-entered geo_sites doc with a blank or non-numeric lat/lng (exactly the kind of mistake an admin form invites) is untested even though it's the realistic failure mode this code was clearly written to survive.

### 194. Stale comment claims a working Firestore/Storage write path 'is expected to be denied'
`L-impact · S-effort · Quality · hr-worker`  
worker.js:340-342 says the record write 'is EXPECTED to be denied until those rules ship' — but storage.rules:116-121 already has a working attendance-selfies/{uid}/{fileName} rule and firestore.rules:276-284 already permits the linked-worker write. The comment is stale relative to the shipped rules and risks sending a future reader down a false debugging path or prompting them to 'fix' rules that already work.

### 195. geo_sites is re-fetched from scratch on every Time In/Out attempt (no session cache)
`L-impact · S-effort · Perf · hr-worker`  
worker.js:271-280 fetches all active geo_sites fresh on every single clock action with no use of window.dbCachedGet, unlike _workerProfileCache (worker.js:81-88) which does cache the worker's profile per-session. Every Time In, Time Out, and every invalid retry re-issues the same read. Cheap at today's site count, but inconsistent with the app's own dbCachedGet convention (js/config.js) that exists specifically to avoid refetching mostly-static collections on every action.

### 196. Work Site radius accepts non-positive values with no validation
`L-impact · S-effort · Bug · hr-worker`  
hr.js:1745 defaults the radius <input> to 150 via server-rendered `value`, but the save handler (hr.js:1780-1795) only falls back to 150 when parseFloat(...) is falsy (0/NaN) — a manually typed negative radius (e.g. '-50') parses to a real negative number and saves as-is. Since geo-core.js:74 checks `distanceM <= radiusM`, a negative radius can never match (distance is always ≥0), silently making that site permanently unusable with no error surfaced to the admin who believes they just added a working site.

### 197. computePayLine has no test for payClass:'production'
`L-impact · S-effort · Quality · finance`  
money-core.js:93 maps `emp.payClass==='production'?'production':'regular'` onto the returned line, but every test in the computePayLine describe block (money.test.mjs:163-279) passes an employee object without payClass, so only the 'regular' branch is pinned. Given computePayRun (departments.js:1555) explicitly skips 'production' payClass employees from the monthly run, this branch of computePayLine may be effectively dead or only reachable from another caller — worth confirming and adding a pinning test either way.

### 198. computeBreakeven: no test for a category appearing in both classification.fixed and classification.variable
`L-impact · S-effort · Quality · finance`  
money-core.js:172-177 checks `fixedSet.has(cat)` before `variableSet.has(cat)`, so a malformed/duplicate finance_config/breakeven doc (e.g. from a bug in openBreakevenClassifyEditor's save merge, finance.js:1118-1127) would silently make 'fixed' win with zero indication anywhere. tests/money.test.mjs has no case pinning this precedence, so it isn't documented as intentional and could regress unnoticed.

### 199. Pull-to-refresh's DEAD_ZONE/THRESHOLD retune comment suggests these were tuned once and never re-validated on real devices post-mobile-density-pass
`L-impact · S-effort · UX · core-shell`  
js/app.js:505-508: THRESHOLD/HARD_THRESH were both roughly halved in 'v14 G4 retune' (220→100, 400→200) alongside the broader mobile density pass, but nothing in this file cross-checks the new 100px soft-refresh threshold against the also-shrunk DEAD_ZONE (70→50) — a 150px total drag now triggers a full navigateTo() refresh, which is easy to hit accidentally while scrolling a long list back to the very top on a phone (a slightly-too-enthusiastic upward-then-downward correction). Worth a deliberate on-device pass to confirm 150px doesn't false-trigger during normal scroll-to-top gestures now that both constants dropped together.

### 200. Splash screen has a fixed 1600ms minimum regardless of how fast auth/profile load resolves
`L-impact · S-effort · Perf · core-shell`  
js/app.js:455-465: `_SPLASH_MIN_MS = 1600` is enforced unconditionally via hideSplash()'s wait calculation, even when auth.onAuthStateChanged + loadUserProfile resolve near-instantly (e.g. warm cache, fast network). Every login/reload pays a flat 1.6s minimum splash regardless of actual readiness — a pure branding/pacing choice, but worth flagging since it's a guaranteed 1.6s tax on cold-start perceived speed for every single session, including quick reloads/pull-to-refresh's hard-reload path.

### 201. Global keyboard shortcuts have no visible affordance beyond a one-time toast and '?' — no in-app discoverability
`L-impact · S-effort · Feature · core-shell`  
Keymap.maybeShowFirstRunHint (js/app.js:3196-3205) shows a single toast ('Tip: press ? for keyboard shortcuts') exactly once per browser (localStorage-gated) and is skipped entirely for partners/Brilliant-Steel-only users. There's no persistent UI entry point (menu item, footer link, settings toggle) to re-discover the cheat sheet later if that one toast is missed or dismissed quickly — a returning user who missed the toast has no way to learn shortcuts exist except accidentally pressing '?'.

### 202. Dashboard-root page depth can desync _navDepth after a wrong-portal login rejection
`L-impact · S-effort · Quality · core-shell`  
The login-type mismatch branch (js/app.js:71-93) calls `auth.signOut()` then manipulates the login DOM directly and returns, without ever having touched `window._navDepth` or pushed/replaced any history entry for this rejected session. This is currently harmless since nothing else ran yet, but it's a fragile ordering: if any future change moves work earlier in the success path (before this early-return gate), a wrong-portal rejection could leave stale nav-depth/session state around. Worth a defensive `window._navDepth = 0` reset alongside the signOut() call so this branch is self-contained regardless of future edits above it.

### 203. sendToDept's 'no user assigned' fallback body embeds raw department name unescaped into a notification meant for HTML-rendering readers
`L-impact · S-effort · Quality · core-shell`  
js/notifications.js:513-540 (sendToDept): the fallback body strings `[no ${department} user assigned] ...` and `[${department} recipient lookup failed] ...` interpolate `department` directly. `department` is always a hardcoded caller-supplied string in every call site found in this codebase today, so it's not currently exploitable, but notif titles/bodies are rendered via `escHtml()` at display time (notifications.js _renderIntoList, line 295-296) so this is currently safe — flagging only because if a future caller ever threads a user-controlled string through as `department`, the escaping happens at render time, not at write time, so nothing here would catch it earlier. Low priority defensive note.

### 204. friendlyError() silently swallows most Firebase Auth error codes behind a generic message
`L-impact · S-effort · UX · core-shell`  
js/app.js:918-926 maps only 5 codes (user-not-found, wrong-password, invalid-email, too-many-requests, invalid-credential). Common cases like `auth/network-request-failed` (offline attempt), `auth/user-disabled` (an admin disabled the account), or `auth/internal-error` all fall through to 'Sign-in failed.' — giving both the user and whoever supports them (HR/IT) no actionable signal to distinguish 'you're offline' from 'your account was disabled' from 'server hiccup'.

### 205. Notification bell's mobile/desktop branch uses a different breakpoint check than the rest of the shell
`L-impact · S-effort · Bug · core-shell`  
initToggle's click handler (js/notifications.js:1107-1124) branches on raw `window.innerWidth <= 768`, while every other mobile/desktop determination in the app (TOPBAR_MOBILE_MQ, isMobileSidebarMode, _qbIsMobile) uses `matchMedia('(max-width:768px)')`. innerWidth includes the scrollbar gutter on some browsers and doesn't share the same MediaQueryList instance, so at/near the breakpoint the bell can decide 'desktop dropdown panel' while the rest of the chrome (topbar/bottom-nav placement via placeTopbarActions) has already switched to mobile layout, or vice versa — the bell's behavior can disagree with the nav layout actually on screen.

### 206. Push-permission prompt card ignores the Light/Dark/Astral theme system
`L-impact · S-effort · UX · core-shell`  
_showPushPrompt's inline styles (js/notifications.js:694-739) hardcode a dark-glass look — `background:rgba(20,30,55,0.72)`, fixed `rgba(0,0,0,0.35)` scrim, `color:var(--text,#e8eaf0)` where the FALLBACK (not the var) is what actually renders in practice since these were written before/outside the WS42 token system. Every other surface in the app (modals, dialogs, drawers) follows the `--surface`/`--border`/`--text` token set that adapts across Light/Dark/Astral; this one card always looks dark-glassy even for a Light-theme user, a visible inconsistency the first time most users ever see push permission asked.

### 207. Sidebar nav-item taps don't fire haptics, unlike every other primary-nav surface
`L-impact · S-effort · UX · core-shell`  
buildSidebarNav's click handler (js/app.js:1120-1128) has no window.haptic() call, while the equivalent bottom-nav-item tap (buildBottomNav, line 1223: `window.haptic && window.haptic('light')`) and the More-sheet row tap (openMoreNavSheet, line 1189) both do. The sidebar is reachable by touch on mobile (off-canvas drawer) and on tablet-rail widths, so this is a real, fixable gap in the app's own haptics-wiring coverage, not a desktop-only surface.

### 208. 'n' (new item) keyboard shortcut targets a button id that doesn't exist anywhere in the codebase
`L-impact · S-effort · Bug · core-shell`  
js/app.js:3059-3060 (Keymap.NEW_ITEM_SELECTOR): the selector list includes `#add-expense-btn`, but grepping the whole js/ tree finds no element with that id (nor any 'Add Expense' button) in js/screens/finance.js or elsewhere — unlike its 5 siblings (add-task-btn, add-client-btn, add-ledger-btn, add-deal-btn, add-ca-for-btn), which all resolve. The cheat-sheet (buildCheatSheetHTML, line 3026) still advertises 'n — New item (context-aware)' as working everywhere; on the Finance/expense screen it silently does nothing because contextNew() (line 3062-3067) finds no matching element.

### 209. checkPayrollDuties() redundantly re-fetches users/{uid} that loadUserProfile() just fetched
`L-impact · S-effort · Perf · core-shell`  
js/app.js:384-386: `const uDoc = await db.collection('users').doc(user.uid).get(); ... const role = uDoc.data().role;` runs on every login, but `await loadUserProfile(user)` (line 59, awaited earlier in the same onAuthStateChanged handler) has already populated `window.currentRole` from the exact same doc. This is a pure duplicate read fired on every single sign-in with no caching — replace with `window.currentRole` (already global by this point in the boot sequence).

### 210. Duplicate .top-nav-strip/.top-nav-item base blocks scattered 3x across the file — same pattern likely recurs elsewhere undetected
`L-impact · M-effort · Quality · css-a11y`  
.top-nav-strip is declared as a base rule 3 separate times (css/styles.css:894, 5049, 5648) and .top-nav-item twice more beyond its base (906, 5060, 5655), each adding/overriding a few properties without any comment cross-referencing the others (unlike the well-documented .drawer/.bottom-nav merges elsewhere in the file, e.g. line 1276's '.bottom-nav base rule three-way merged into iOS-layer copy below' comment). Recommend a scripted duplicate-selector scan (`grep -oE '^\.[a-zA-Z0-9_-]+...' | sort | uniq -c`) as a follow-up hygiene pass — this audit only manually verified the nav-active-state family; other 3x-declared selectors like `.task-feed-item` and `.notif-item-body` weren't individually confirmed dead vs. additive.

### 211. 67 !important declarations remain — worth a targeted specificity audit now that Batch 2/mobile-density cleanups already removed several
`L-impact · M-effort · Quality · css-a11y`  
css/styles.css currently has 67 `!important` uses. Several are self-documented workarounds for exactly the duplicate-selector problem found above (e.g. line 6142's comment: '.sop-panel is built with inline styles in js/config.js, so its rules here need !important to win over the inline attribute', and the SEAMLESS MOBILE PASS v2 comments at 5410-5423/6064-6073 describing prior !important fights between WS43 and V14 density passes). Now that those two passes are consolidated, a follow-up pass specifically targeting the remaining !important list (grep `!important`) could likely drop a chunk of them since some were only needed to out-shout a sibling rule that's since been deleted.

### 212. Partners dept 'Deals' table hand-rolls CRUD/table logic that duplicates ui-crud-table.js's generic component
`L-impact · M-effort · Quality · screens-misc`  
partners.js:759-786 (loadPartnersDeptTab's 'deals' case) hand-builds a `.data-table.table-cards`, its own Add-Deal modal (_showAddDealModal, partners.js:957-1036), and ad-hoc `window._closeDeal`/`window._markDealPaid` global functions — the same table+add-modal+actions shape window.renderFinanceCrudTable (ui-crud-table.js) already generalizes for other collections. Partner deals aren't a 'finance' collection by name, but functionally this is the same CRUD-table pattern reimplemented from scratch rather than adopted.

### 213. ui-states.js's withLoadingAndError kit is essentially unadopted outside people.js
`L-impact · M-effort · Quality · screens-misc`  
js/ui-states.js exports window.withLoadingAndError specifically to standardize the loading→empty/error+Retry lifecycle, but it's only called from people.js:2249 and :2629. dashboards.js, approvals.js, tasks.js, and partners.js instead hand-roll the identical ~10-line 'empty-state icon+h4+message+Retry button+addEventListener' block at every async screen (e.g. partners.js alone: bscd-retry-btn :379-380, pp-retry-btn :475-476, pdash-retry-btn :667-668, pdept-retry-btn :719-720, pdeals-retry-btn :737-738; dashboards.js's renderProductDatabase :317-318, renderAuditLog :239-243). Each is a slightly different hand-copy of the same idiom the kit was built to centralize.

### 214. Team status notes never expire or show their age
`L-impact · M-effort · UX · people-chat`  
js/screens/people.js:873-880 renders u.statusNote verbatim with no timestamp and no TTL — a note set weeks ago ("In a meeting until 3pm…") stays pinned to the card indefinitely with nothing to signal it's stale, unlike the Instagram-style status the feature is modeled on (per the button's own label "Set My Note", comment line "IG-style status").

### 215. Lightbox silently wraps past the oldest loaded photo instead of loading more
`L-impact · M-effort · UX · people-chat`  
js/chat.js:2585-2596 _collectAllImages() only covers the currently loaded _earlier+_msgs window; go() (line 2672) wraps with modulo. Swiping backward from the oldest photo in a long thread with unloaded history jumps straight to the newest photo with no 'load earlier photos' prompt, silently implying that's the full set.

### 216. Attendance editor can convert leave→worked but not worked→leave
`L-impact · M-effort · Feature · people-chat`  
js/screens/people.js:1268-1327 — the attendance-day editor only offers the 'Leave' status option when the day is already a leave record (isLeaveDay gate, line 1275), and picking it is a no-op besides the note (line 1321-1323, comment confirms: "Leave selected but unchanged... no-op besides note"). There is no path for an admin to manually mark an ordinary present/absent day as leave from the calendar — that can only happen via the Leave Management approval flow.

### 217. Group chat admin can Add members but has no Remove-member control
`L-impact · M-effort · Feature · people-chat`  
js/chat.js:2794-2861 _openAddMembersPicker gives a group creator/admin a full add-members flow, but there is no corresponding remove/kick action anywhere in _openMediaTab's About section — the only way a participant leaves is voluntarily via the self-only Leave button (line 3052). An admin who added the wrong person, or needs to remove someone who left the company, has no in-app way to do it.

### 218. Design's list/dashboard reads bypass the app's shared read-cache convention
`L-impact · M-effort · Perf · production`  
design.js's renderProjects (line 94), renderProjectDrawings (line 617), and renderDrawingsDashboard (line 1016) all call `db.collection(...).get()` directly on every navigation, whereas the comparable lists in production.js (production_orders, inventory_items, job_projects) all go through `dbCachedGet(...,45000)` to avoid a full refetch on every tab switch — an inconsistency in an otherwise app-wide caching convention, and a real cost as design_drawings/projects grow (no limit/pagination either).

### 219. consumeProductionMaterials books COS at a stale cached cost even when the inventory item no longer exists
`L-impact · M-effort · Bug · production`  
production.js:1120-1139: the `if (s && s.exists)` guard correctly skips the qty decrement and stock_movements row for a deleted item, but `unitCost`/`txCos` are still computed from the picker's cached `m.unitCost` and posted to the ledger + job capital regardless — so COS is charged for a material with zero corresponding stock movement, with no warning surfaced that the line was a stock-side no-op.

### 220. openPage's back button and page-panel body scroll position aren't restored when un-hiding a stacked page
`L-impact · M-effort · Quality · core-shell`  
openPage's teardown (js/app.js:2871-2892) reveals the prior top page by clearing `visibility:hidden` (`prevTop.style.visibility=''`), but nothing captures/restores that panel's own internal scroll offset (`.page-panel-body` scrollTop) across the hide/show cycle. If a user scrolls deep into a list, opens a stacked detail page over it, then backs out, the underlying page visually reappears — but depending on how its content re-renders (some screens re-fetch on reveal, some don't), the scroll position may or may not survive; this isn't verified anywhere and there's no explicit save/restore, unlike the deliberate 'preserve scroll/form state' goal stated in the page-stack's own header comment (app.js:2793-2796).

### 221. Overlay.clearAll()'s stale-entry absorption only rewrites the topmost of N nested overlay entries
`L-impact · M-effort · Quality · core-shell`  
config.js:1189-1201: when clearAll() tears down more than one nested overlay (e.g. a confirm dialog opened from within a modal opened from a pushed page), it pops all N from the in-memory `_stack` but the comment-documented recovery (navigateTo's `absorbStale`/`_pendingRewind`, app.js:1830-1840) only replaceState's the SINGLE current-top history entry. The remaining N-1 stale `t:'overlay'` entries are left in browser history, each carrying a `base.subtab` snapshot from whenever it was originally pushed. Pressing Back repeatedly after such a 3-deep-overlay-then-direct-nav sequence can flash through superseded subtab states before settling on the real previous page. Worth a manual/automated regression pass specifically for this 3-deep-stack-plus-direct-nav scenario since the current design relies entirely on a comment's reasoning rather than a test.

### 222. Presence heartbeat only ever advances lastSeen — no explicit offline signal on tab close
`L-impact · M-effort · Feature · core-shell`  
startPresenceHeartbeat (js/app.js:141-163) pings `users/{uid}.lastSeen` every 60s while visible plus on focus/visibility events, but there is no pagehide/beforeunload write to flip an explicit 'online:false' (or similar) flag when the tab closes or the app is killed. Any presence/online-status UI built on lastSeen can only infer 'offline' from staleness, with no way to distinguish 'closed 2 seconds ago' from 'phone died mid-interval' — worth adding a `navigator.sendBeacon` write on pagehide for a snappier, more accurate presence signal.

### 223. hub_files owns 6 of ~19 total composite indexes — one per permission-check shape
`L-impact · L-effort · Perf · infra-pwa`  
firestore.indexes.json lines 92-142 dedicate 6 composite indexes entirely to covering every combination of `{scope, deleted, visibility}` / `{scope, deleted, uploadedBy}` / `{sharedUserIds CONTAINS, scope, deleted}` (plus null-scope variants), matching js/drive.js's FilesHub.loadFiles() 3-query read fan-out (lines 306-325). Each additional composite index adds write amplification — Firestore updates every matching index on every hub_files write. As Files Hub usage grows this is worth a follow-up look at whether a single denormalized `visibleTo` array-contains field could collapse several of these into one index shape.
