# Workstream 15 — Records Durability (backup coverage, restore, Drive privacy, sync reliability)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

Three independent scripts under scripts/, no shared registry of "what is a business collection": monthly-backup.js (static hand-maintained EXPORTS array), sync-to-drive.js (dynamic — walks db.listCollections() at runtime, so file-discovery needs no hand-registration), drive-lib.js (shared auth/upload helpers used by both). Both run via GitHub Actions cron (.github/workflows/monthly-backup.yml: `0 17 1 * *` = 1AM PH on the 1st; .github/workflows/sync-to-drive.yml: `0 16 * * *` = 12AM PH daily), both also workflow_dispatch-triggerable manually. Per ROADMAP.md:102, the monthly export previously covered "only 9 of 35+ collections" and was expanded in a prior session — but drift has resumed: collections added since that fix (pay_runs, IT dept, approval workflow) are missing again. This is a recurring-drift problem, not a one-time gap.

1) BACKUP COVERAGE GAP. Enumerated every db.collection('X') literal (plus renderDocCollection(_, 'X', ...) wrapper calls, which internally do db.collection(name) — see js/departments.js:10359) across js/app.js, js/departments.js, js/modules.js, and diffed against the EXPORTS array at monthly-backup.js:112-227. CONFIRMED MISSING (each has a live firestore.rules `match` block — i.e. real, secured, actively-written data, not dead code):

- `pay_runs` — departments.js:2573-2762, rules firestore.rules:321-325. The new Compute→Verify→Disburse payroll governance doc (memory `payroll-pay-run-workflow`); arguably the single highest-value gap — it's the authoritative "was this month's payroll actually disbursed" record. Doc id = YYYY-MM. Shape (read from the live `.set()` calls, departments.js:2596, 2602, 2761-2763): `{ month, state:'draft'|'computed'|'verified'|'disbursed', employeeCount, totalNet, computedBy, computedByName, computedAt, verifiedBy, verifiedByName, verifiedAt, disbursedBy, disbursedByName, disbursedAt }`.
- `approval_requests` — app.js:1203, 2245, 2460, 2571, 7745; rules firestore.rules:408. Routes ALL approvals per memory `corporate-secretary-and-approval-authority`.
- `payroll_delete_requests` — app.js:2577; departments.js:2132, 2321; rules firestore.rules:312-316. The finance-delete-approval trail (memory `finance-delete-approval`) — losing it loses the audit chain for who authorized deleting a payroll record.
- `it_access`, `it_assets`, `it_network`, `it_software`, `it_tickets` — departments.js:6909-7364 (five collections, whole IT department); rules firestore.rules:523-544. None of the IT department's data is backed up at all.
- `kpi_targets` — app.js:2826, 3968, 4116; rules firestore.rules:252. (`kpi_evals` IS in EXPORTS at monthly-backup.js:139-143; the paired `kpi_targets` collection is not.)
- `sales_orders` — departments.js:8381, 8416, 8447; rules firestore.rules:769. This is the collection `sync-to-drive.js` itself labels 'Sales Orders' (LABELS map, sync-to-drive.js:70) and it carries `trackingToken`, the field the public `track.html` client-tracking page reads from `order_tracking/{token}` — a customer-facing document trail with zero JSON/CSV backup.
- `memos`, `policies`, `sops`, `handbook`, `resources`, `departments`, `settings`, `signup_requests`, `president_message`, `_counters` — all app.js, various lines (see grep citations below); all missing.
- `products` — app.js:1320-1347 — the live Firestore product/pricing master (distinct from the static `products-database.json` seed file and from `productMeta`, which IS in EXPORTS-adjacent territory but `products` itself is not backed up).
- `quotes` — app.js:1927, inside `getAllQuotes()` (app.js:1916-1929). Code comment there explicitly calls it "the legacy `quotes` collection" — read-only, never written (confirmed: no `.add`/`.set`/`.update` call anywhere). Lower priority than the others but still un-backed-up live data.
- `gov_biddings` — app.js:6105 only, inside an analytics aggregation (`an_gov`). This is DISTINCT from `gov_philgeps`/`gov_active_bids`/`gov_archive` (departments.js:10906-10908), which ARE in EXPORTS and which the actual Government Biddings department screens read/write. `gov_biddings` looks like a legacy/orphaned collection an analytics widget still points at — flag as a possible existing bug for Fable to notice, not something to silently paper over in the backup fix.

STRUCTURALLY WORSE: two dynamic per-scope collection families are invisible to a hardcoded EXPORTS array by construction, no matter how well maintained: `files_${id.replace(/-/g,'_')}` (departments.js:10449, 10749) and `budgets_${dept.toLowerCase().replace(/\\s+/g,'_')}` (departments.js:10529) — one collection PER department/scope, name computed at runtime. firestore.rules covers them by regex (`coll.matches('files_.*')` firestore.rules:849-852, `coll.matches('budgets_.*')` firestore.rules:858) but monthly-backup.js has no equivalent prefix-scan; sync-to-drive.js's file-mirroring already handles them fine because it calls `db.listCollections()` (sync-to-drive.js:271) rather than a static list.

2) DRIVE FILE VISIBILITY — the exact code that makes every synced file public-by-link today. drive-lib.js:191-199:
```
async function makePublic(drive, fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      ...SHARED,
    });
  } catch (_) { /* non-fatal — Shared Drive admins may disable link sharing */ }
}
```
Called unconditionally inside `uploadBuffer()` (drive-lib.js:202-211) — i.e. every single file synced by sync-to-drive.js AND every JSON/CSV export written by monthly-backup.js (both call `uploadBuffer`/`uploadText`→`uploadBuffer`) gets `type:'anyone', role:'reader'` applied with no per-collection or per-sensitivity distinction. Payslip proofs, drawing revisions, memo attachments, and the monthly backup's own payroll/ledger JSON dumps all get the same "anyone with the link" grant.

The resulting `webViewLink` (renamed `driveUrl`/`driveFileUrl`/etc. per the companionKey convention, sync-to-drive.js:94-98) is then surfaced directly as a clickable in-app `<a href>` in multiple places: js/departments.js:765 (task attachments), :6486 and :6504 (design drawing revisions, current + historical). So today's model is: Drive link = bearer-token-equivalent security (anyone who has the URL, in or out of the org, can open the file, forever, no re-auth). Folder-ACL-based sharing would replace `type:'anyone'` with `type:'user'` (specific Google-account emails) or `type:'domain'` — but `type:'domain'` requires a Google Workspace domain, which this org does NOT have (see below), so that specific option is foreclosed, not merely "worth considering."

3) DRIVE AUTH SETUP (how it authenticates today) — drive-lib.js:52-85, `initDrive()`. Two supported modes, OAuth wins if present:
   - OAuth user-credential mode (currently in use, confirmed by scripts/get-drive-token.js): a personal @gmail.com account authorizes once via `scripts/get-drive-token.js` (a local, interactive, one-time script that opens a browser consent screen and prints a refresh token), and the resulting `GOOGLE_OAUTH_REFRESH_TOKEN`/`_CLIENT_ID`/`_CLIENT_SECRET` are stored as GitHub Actions secrets. All uploads land in that one human's personal ~15GB My Drive quota (comment at get-drive-token.js:6-8, drive-lib.js:41-45).
   - Service-account mode (fallback if no refresh token env var): requires a Shared Drive (Team Drive) because a bare service account has zero My-Drive storage quota (drive-lib.js:9-13, 47-49) — and Shared Drives are a Google Workspace feature, confirmed absent here (get-drive-token.js explicitly targets "a personal @gmail.com account").
   This means: the org has NO Google Workspace domain today. Any folder-ACL design that assumes `type:'domain'` sharing, or that assumes a Shared Drive for multi-owner file custody, requires either (a) buying a Workspace subscription — which conflicts with the plan's explicit "storage stays free... no new paid services required" decision (V12-PLAN.md:192-193, :199) — or (b) sharing to a list of individual `type:'user'` Google-account emails (every employee needs a Google account address on file), or (c) keeping Drive as a pure backup mirror that is NEVER linked to directly from the app (the app always serves from Firebase Storage + Storage rules/custom claims instead, and Drive becomes archive-only). preflight() (drive-lib.js:89-162) already warns explicitly when a folder is "in a personal My Drive, not a Shared Drive" and explains the service-account quota wall — so this constraint is already known/documented in-code, just not resolved.

4) RESTORE — confirmed NONE EXISTS. Repo-wide search for "restore" (excluding node_modules) turns up zero restore scripts or restore documentation. The only two hits are unrelated: ROADMAP.md:246 references a Files-tab "archive/restore" UI feature (soft-delete/undelete of individual files in the app, not a backup-restore mechanism), and ROADMAP.md:298 lists "document restore" as an explicit still-open item under "Nice-to-have / hardening" (item 17, alongside "verify the monthly backup GitHub Action actually runs"). DRIVE_SYNC_SETUP.md — the one piece of setup documentation that exists — is itself stale: its "Drive folder structure created" listing under Monthly Data Backup (lines ~35-50) shows only ~9 files (attendance/tasks/cash_advances/salary_history/kpi_evaluations/users/posts/payroll_overrides/attendance_extensions/suggestions), i.e. it still describes the OLD, pre-expansion EXPORTS list, not the current ~48-entry one at monthly-backup.js:112-227. Any restore design or doc this workstream produces should replace/update this file rather than leave two contradictory descriptions of the backup shape.

5) NO SYNC/BACKUP HEARTBEAT OR FAILURE ALERTING EXISTS TODAY. Grepped both scripts and all js/*.js for any status/heartbeat/health writeback (sync_status, backup_status, heartbeat, lastSync, lastBackup, health) — zero hits. Both GitHub Actions jobs `process.exit(stats.errors > 0 ? 1 : 0)` (monthly-backup.js:390, sync-to-drive.js:289) — i.e. failure is visible ONLY as a red X in the GitHub Actions tab, which nobody in the app ever sees. There is, however, an existing in-app pattern this could plug into: `settings/system` is already a live singleton doc the client listens to in real time via `onSnapshot` for an unrelated feature (force-logout) — see app.js:135 `db.collection('settings').doc('system').onSnapshot(...)`, and written at app.js:5485 and :6554. That's the closest existing precedent for "a small doc GitHub Actions writes to and the app already has a real-time listener pattern for," though whether to reuse `settings/system` vs. a dedicated new collection is an open decision (see below), not something already decided in code.

6) NODE VERSION GOTCHA (from ROADMAP.md:102, already fixed, but load-bearing for any script changes here): "Node 22 breaks Google's OAuth token exchange (ERR_STREAM_PREMATURE_CLOSE)." Both workflow YAMLs are pinned to `node-version: '20'` (monthly-backup.yml, sync-to-drive.yml). Any new restore/export tooling added to scripts/ must keep this pin or re-verify compatibility — do not bump Node without retesting the OAuth token exchange.

Collections confirmed present in the app but absent from EXPORTS were located via: `grep -oE "db\\.collection\\(['\\\"][a-zA-Z0-9_]+['\\\"]" js/*.js` unioned with indirect wrapper calls (`renderDocCollection`), then individually re-grepped (`grep -n "collection('X')" js/*.js`) for exact line citations, and cross-checked against firestore.rules `match` blocks to confirm each is a real, secured, in-use collection rather than dead code.

## Data model

Collections this workstream must reason about (fields as read from live code, not guessed):

- `pay_runs/{YYYY-MM}` (doc id = month string) — `{ month, state: 'draft'|'computed'|'verified'|'disbursed', employeeCount: number, totalNet: number, computedBy: uid, computedByName: string, computedAt: serverTimestamp, verifiedBy, verifiedByName, verifiedAt, disbursedBy, disbursedByName, disbursedAt }`. Rules: finance/admin read+create+update, President-only delete (firestore.rules:321-325).

- `audit_log/{autoId}` — append-only, fire-and-forget writer at js/config.js:246-261 (`window.logAudit`): `{ ts: serverTimestamp, action, entity, entityId, details: object, actorUid, actorName, actorRole }`. Rules require `actorUid==auth.uid`, `actorRole==getRole()`, `ts==request.time` on create (firestore.rules:729-734ish), admin-only read. Explicitly EXCLUDED from sync-to-drive.js's file walk (`EXCLUDE` set, sync-to-drive.js:84-87 includes 'audit_log') AND absent from monthly-backup.js's EXPORTS — i.e. the one collection whose entire purpose is "who changed what" has zero off-site copy today.

- `approval_requests/{autoId}` — read at app.js:1203 (filtered by quoteId), 2245/2460 (status=='pending', cached via `dbCachedGet`), written at app.js:7745. Exact field shape not fully enumerated in this pass (would need to read the `.add({...})` payload at app.js:7745 in full) but confirmed it's the funnel for ALL approval types per memory `corporate-secretary-and-approval-authority`.

- `_counters/{docId}` e.g. `_counters/employees` — `{ count: number }`, incremented inside a `db.runTransaction` (app.js:439-445) to mint sequential `BI-{bizYear()}-{seq}` employee IDs. Admin-only read/write (firestore.rules:113-115). A restore that recreates `users` docs without also restoring/reconciling `_counters` risks duplicate or out-of-sequence employee IDs on the next signup after a restore.

- `settings/system` (singleton doc) — already `onSnapshot`-listened by the client (app.js:135) for force-logout; written at app.js:5485, 6554. The one clear existing precedent in this codebase for "small doc GitHub Actions could write to, that the app already knows how to watch live."

- Dynamic per-scope collections NOT enumerable by a static list: `files_${scope}` (departments.js:10449, 10749) and `budgets_${dept}` (departments.js:10529) — one collection per department/scope, name built at runtime by string interpolation. firestore.rules matches these by regex (`.matches('files_.*')`, `.matches('budgets_.*')`, firestore.rules:849-858); no equivalent exists in monthly-backup.js.

- The full current EXPORTS list (monthly-backup.js:112-227) for reference — 48 entries across: attendance (subcollection, special-cased), tasks(+task-comments), cash_advances, salary_history, kpi_evals, users, posts, payroll_ca_overrides, attendance_extensions, suggestions; ledger, general_journal, cash_receipt_journal, cash_disbursement_journal, finance_records, tax_records, expenses, finance_delete_requests; payroll, payslips, worker_profiles, salary_raises, leave_balances, leave_requests; bk_quotes, bs_quotes, sales_clients, work_plans, submissions; job_projects, projects, order_tracking; purchase_requisitions, purchase_orders; production_orders, inventory_items, stock_movements, job_costs; design_clients, design_drawings, gov_philgeps, gov_active_bids, gov_archive, marketing_plans, marketing_proposals; partner_deals, bs_clients.

- Drive upload return shape: `uploadBuffer()` returns a bare `webViewLink` string (drive-lib.js:201-211) — no fileId, no permission-id, no folder-path is persisted back into Firestore beyond that one URL string under the companion key (e.g. `driveUrl`). If folder-ACL sharing replaces `type:'anyone'`, there is currently nowhere to record WHICH principals a given file was shared with, or to later revoke/change that grant — that bookkeeping does not exist yet.

## Constraints — must respect

- Firestore rules require an explicit `match` block per collection — no cascade to subcollections, no prefix matching except where regex is hand-written (`files_.*`, `budgets_.*`). Any new collection this workstream introduces (e.g. a backup-heartbeat doc, a restore-audit log) needs its own rules block or it is silently DENIED (blank screen / failed write) per memory `firestore-rules-collection-coverage` and ROADMAP.md:306-309.
- Reading an absent field in security rules DENIES the rule rather than treating it as falsy — use `.get(field, default)`, not bare field access (memory `firestore-rules-missing-field-throws`). Relevant if a heartbeat/status doc's rule checks fields that may not exist on first write.
- GitHub Actions workflows are pinned to `node-version: '20'` in both monthly-backup.yml and sync-to-drive.yml because Node 22 breaks the Google OAuth token exchange with `ERR_STREAM_PREMATURE_CLOSE` (documented at ROADMAP.md:102). Do not bump Node without re-verifying this.
- Drive calls must always pass `supportsAllDrives`/`includeItemsFromAllDrives` (the `SHARED`/`SHARED_LIST` constants, drive-lib.js:24-26) — every new Drive API call this workstream adds (e.g. changing permission type, adding folder-scoped shares) must spread these flags in or it silently breaks for Shared Drive destinations.
- `preflight()` (drive-lib.js:89-162) is the existing fail-loud pattern: it inspects the destination folder before any work starts and exits(2) with a precise human-readable fix instead of letting a cryptic 404 surface later. Any new backup/restore entry point should follow this same fail-loud-with-exact-fix convention rather than let partial work happen silently.
- There is no Google Workspace domain — Drive auth today is a personal @gmail.com account via OAuth refresh token (preferred, in use) with service-account+Shared-Drive as an untested fallback path (drive-lib.js:39-85). `type:'domain'` Drive permissions and Team/Shared Drives are Workspace-only features and are NOT available as designed today.
- Owner's stated 'storage stays free' decision (V12-PLAN.md:192-193, 199): 'Firestore live DB (free tier)... Drive = backup/archive mirror (free 15GB)... No new paid services required.' A native `gcloud firestore export` writes to a GCS bucket, which is a billable GCP resource distinct from the Firebase Storage free tier — this directly collides with that standing decision and must be reconciled, not silently assumed away.
- Manila-time discipline: any date-range logic this workstream touches (e.g. monthly-backup.js's `getPrevMonthRange()`, currently built on raw `new Date()`/`getMonth()`, NOT `window.bizDate()`) runs in Node/GitHub Actions, not the browser, so `window.bizDate()` isn't available there — but note the existing script already computes month boundaries with plain server-local `Date` math (monthly-backup.js:97-105), which is a discrepancy already baked into the shipped script (GitHub Actions runners are UTC) worth flagging, not silently inheriting.
- `makePublic()` (drive-lib.js:191-199) is called unconditionally inside the one shared `uploadBuffer()` helper used by BOTH scripts — any change to file-visibility policy is a one-function edit point, but it applies identically to daily file-sync uploads AND monthly JSON/CSV backup uploads today; a design that wants different visibility for 'archived business file' vs 'raw backup export of payroll data' must branch inside or around this shared call, not assume today's single code path already distinguishes them.
- Escaping/XSS convention (`escHtml()`) and the append-only, catch-swallowing `window.logAudit()` fire-and-forget pattern (js/config.js:246-261) are the established idioms for anything this workstream surfaces back into the UI (e.g. a backup-status banner) or logs (e.g. 'restore performed by X at time Y').

## DECIDED — architecture spec (Fable, 2026-07-10)

**Decided architecture (one paragraph).** The recurring backup-coverage drift is closed permanently by switching `monthly-backup.js` from a hand-maintained static `EXPORTS` array to the same **dynamic `db.listCollections()` discovery** already proven in `sync-to-drive.js` (sync-to-drive.js:271), plus a small keyed `OVERRIDES` map that supplies date-filtering / CSV / subcollection handling only for the ~10 collections that need it. Every other collection — including the currently-missing `pay_runs`, `approval_requests`, `payroll_delete_requests`, the five `it_*`, `kpi_targets`, `sales_orders`, `audit_log`, `_counters`, `products`, and the runtime-computed `files_*` / `budgets_*` families (all of which are **root** collections, confirmed departments.js:10449/10529/10749) — gets a complete full-document JSON snapshot with **zero** future code change, and a future workstream's new collection (e.g. WS33 `aec_contacts`) is covered automatically. The native `gcloud firestore export` path is **rejected** (it needs a billable GCS bucket, colliding with the standing 'storage stays free' decision V12-PLAN.md:192-199, and produces opaque non-browsable LevelDB) — kept only as a flagged optional DR layer. Drive uploads become **private-by-default** (Drive = cold archive, never a live-serving surface); the app keeps opening files via their existing Firebase-Storage URLs. A dedicated `system_health/{jobId}` heartbeat doc (written by both GitHub Actions jobs via the Admin SDK, which bypasses rules) drives an in-app failure/staleness banner + President/Finance notification. A new drift-proof `scripts/restore-from-backup.js` (dispatch-only, dry-run by default, `_counters`-reconciling) reads the monthly JSON back into Firestore, deriving its collection list from a `_manifest.json` the backup writes — so restore never reintroduces the hand-maintained-list drift this workstream exists to kill. The write-time sync queue is **deliberately deferred** (the nightly generic walk stays authoritative).

### Resolved decisions

1. **EXPORTS strategy → dynamic `db.listCollections()` discovery + thin `OVERRIDES` map (drift-proof hybrid).** JSON snapshot of every discovered collection; `OVERRIDES` only carries date-filter/CSV/subcollection specials. Rationale: kills the proven recurring drift while preserving per-collection date/CSV control and the owner's human-browsable JSON+CSV Drive layout. Native export rejected (billing + opaque format).
2. **Native-export bucket question → moot (native export not chosen).** ‼️ FLAG FOR NEIL (optional): if you later want type-faithful point-in-time DR, add a scheduled `gcloud firestore export gs://barro-industries-dr` on Blaze — this is a paid GCS resource and is out of scope for the free-tier plan; recommend deferring unless a Blaze upgrade happens for another reason.
3. **Drive visibility → all uploads PRIVATE (Drive is a cold archive, never live-served).** `uploadBuffer` gains an opt-in `{ public }` flag defaulting to `false`; neither script passes `true`. Kills the most severe exposure (aggregate payroll/finance JSON dumps were public-by-link) at zero UX cost. Honest security delta stated in §D.
4. **In-app `driveUrl` links → flip precedence to the Firebase-Storage URL** (`a.url||a.driveUrl` etc.) at the 3 call sites, so files keep opening exactly as before via the app's existing Storage path once the Drive copy is private. **No** new authenticated Cloud-Function proxy is built (avoids new paid backend surface). ‼️ FLAG FOR NEIL: this shifts file-download bandwidth from Drive back onto Firebase Storage free-tier egress — see §D note.
5. **Heartbeat location → dedicated `system_health/{jobId}` collection** (docs `daily_sync`, `monthly_backup`), NOT `settings/system`. Rationale: keeps operational monitoring decoupled from the force-logout feature; write-permission isn't the deciding factor because GitHub Actions writes via Admin SDK (bypasses rules). It is auto-covered by the new dynamic backup (no recursion gap).
6. **Alert triggers → BOTH (a) ran-with-`errors>0` and (b) missed-run staleness; audience = `isFinanceOrAdmin()`, with a notification pushed to the President.** Staleness is elapsed-ms (timezone-agnostic): daily sync stale >30h, monthly backup stale >34 days. Banner is dismissible; notification is deduped so it fires once per problem.
7. **Write-time sync queue → DEFERRED; nightly generic walk stays authoritative.** A per-write Cloud Function is a new failure surface that itself needs monitoring and multiplies invocations for no correctness gain (the nightly walk is already generic, idempotent via the companion-key guard, and drift-proof). If real-time mirroring is ever wanted, add it as a fast-path *alongside* the nightly walk, never replacing it.
8. **Restore → build `scripts/restore-from-backup.js` (bespoke, dispatch-only, dry-run default).** Reads monthly JSON back via batched `set(...,{merge:true})`, derives its collection list from a `_manifest.json` the backup writes (no hand-list → no drift), reconciles `_counters` by bump-to-max (never blind overwrite), revives ISO-8601 strings back to Timestamps.
9. **Selective restore → YES (both selective collection+month and full month).** The per-month/per-collection JSON layout makes this trivial; the script takes `RESTORE_COLLECTION` (optional) + `RESTORE_MONTH` inputs.

---

### A. Backup coverage — `scripts/monthly-backup.js`

**A1. Replace the static `EXPORTS` array (monthly-backup.js:112-227) with a keyed `OVERRIDES` map + `EXCLUDE` set.** Only collections needing date-filtering, CSV, a custom filename, or subcollection handling appear here; everything else is auto-discovered as full JSON.

```js
// ── Per-collection overrides (specials only) ───────────────────────────────
//  Any root collection NOT listed here is auto-discovered (db.listCollections)
//  and exported as a COMPLETE full-document JSON snapshot — no hand-registration,
//  so new collections (pay_runs, it_*, aec_contacts, files_*, budgets_*, …) are
//  covered automatically and this file never drifts again.
//    dateField  — field to filter by prev month (absent/null = full snapshot)
//    dateIsStr  — dateField is a 'YYYY-MM-DD' string, not a Timestamp
//    csvFields  — also emit a CSV with these columns (JSON is always complete)
//    filename   — output basename if different from the collection name
//    type       — 'subcollection' routes to fetchAttendanceSubcollection
const OVERRIDES = {
  attendance: {
    filename: 'attendance', type: 'subcollection',
    csvFields: ['userId','date','loginTime','timeOut','fullTime','attendanceScore','note','editedBy'],
  },
  tasks: {
    dateField: 'createdAt', includeSubcol: true,
    csvFields: ['id','title','status','priority','dept','assignedToNames','createdAt','dueDate','presidentScore'],
  },
  cash_advances: {
    dateField: 'createdAt',
    csvFields: ['id','userName','amount','terms','interest','totalPayable','monthlyPayment','balance','status','date','reason'],
  },
  salary_history: {
    dateField: 'generatedAt',
    csvFields: ['id','userId','userName','month','baseSalary','allowance','deductions','netPay','multiplier','finalPay'],
  },
  kpi_evals: {
    filename: 'kpi_evaluations',
    csvFields: ['id','selfGrade','selfNotes','presidentGrade','presidentGradeFromTasks','presidentNotes','selfAssessMonth'],
  },
  users: {
    csvFields: ['id','displayName','email','username','role','dept','employeeId','salary','allowance','deductions'],
  },
  posts: {
    dateField: 'createdAt',
    csvFields: ['id','authorName','dept','title','status','pinned','createdAt'],
  },
  payroll_ca_overrides: {
    filename: 'payroll_overrides',
    csvFields: ['id','userId','month','customDeduction'],
  },
  attendance_extensions: {
    dateField: 'requestedAt',
    csvFields: ['id','userId','date','status','reason','approvedAt','expiresAt'],
  },
  suggestions: {
    dateField: 'createdAt',
    csvFields: ['id','category','text','createdAt'],
  },
};

// Ephemeral / huge / per-user-subcollection roots we never snapshot to JSON.
// (audit_log is intentionally NOT here — its off-site copy is the whole point.)
const EXCLUDE = new Set(['presence', 'sessions', 'notifications']);
```

**A2. Rewrite the export loop in `main()` (monthly-backup.js:343-370, the `for (const col of EXPORTS)` block) to iterate discovered collections and add a `_manifest.json`.** Before → after of the loop body plus the surrounding lines (keep everything above line 343 and below line 370 as-is except where noted):

```js
// BEFORE (monthly-backup.js:343-370):
//   for (const col of EXPORTS) {
//     try {
//       console.log(`\n📋 ${col.name}`);
//       const docs = await fetchCollection(col, { start, end });
//       ...
//     } catch (err) { ... }
//   }

// AFTER:
  const manifest = [];
  const discovered = await db.listCollections();
  console.log(`\n📚 ${discovered.length} root collections discovered`);

  for (const ref of discovered) {
    const name = ref.id;
    if (EXCLUDE.has(name)) { console.log(`\n⏭️  ${name} (excluded)`); continue; }
    const ov  = OVERRIDES[name] || {};
    const col = { name, filename: ov.filename || name, dateField: ov.dateField ?? null,
                  dateIsStr: ov.dateIsStr, csvFields: ov.csvFields,
                  type: ov.type, includeSubcol: ov.includeSubcol };
    try {
      console.log(`\n📋 ${name}`);
      const docs = await fetchCollection(col, { start, end });
      await exportCollection(col, docs, monthFolder, stats);
      stats.exported += docs.length;
      manifest.push({ collection: name, filename: col.filename, records: docs.length });
      summaryLines.push(`  ${col.filename}: ${docs.length} records`);

      if (col.includeSubcol) {
        console.log(`   + task-comments (subcollection)`);
        const comments = await fetchTaskComments();
        await uploadText(JSON.stringify(comments, null, 2), 'task_messages.json', 'application/json', monthFolder);
        stats.files++;
        manifest.push({ collection: 'tasks/task-comments', filename: 'task_messages', records: comments.length });
        summaryLines.push(`  task_messages: ${comments.length} messages`);
      }
    } catch (err) {
      console.error(`  ❌ ${name}: ${err.message}`);
      stats.errors++;
      summaryLines.push(`  ${col.filename}: ERROR — ${err.message}`);
    }
  }

  // Self-describing manifest → drives drift-proof restore (see restore-from-backup.js)
  await uploadText(JSON.stringify(manifest, null, 2), '_manifest.json', 'application/json', monthFolder);
  stats.files++;
```

No change is needed to `fetchCollection` (monthly-backup.js:256-280) — it already routes `type:'subcollection'` and handles `dateField` null/string/Timestamp. `attendance` is discovered by `listCollections()`, its OVERRIDE marks it `type:'subcollection'`, and `fetchCollection` routes it to `fetchAttendanceSubcollection` — parent-doc dumping is thereby avoided.

**A3. Health write — add at the very end of `main()`, just before `process.exit` (monthly-backup.js:390).** Insert:

```js
  await reportHealth('monthly_backup', stats, label, duration);
  process.exit(stats.errors > 0 ? 1 : 0);
```

and add this helper near the other helpers (fire-and-forget, never fails the run):

```js
// ── Heartbeat: write a status doc the app watches (see §F) ──────────────────
async function reportHealth(job, stats, label, durationSec) {
  try {
    await db.collection('system_health').doc(job).set({
      job,
      lastRunAt:       admin.firestore.FieldValue.serverTimestamp(),
      lastStatus:      stats.errors > 0 ? 'error' : 'ok',
      errors:          stats.errors || 0,
      filesWritten:    stats.files || 0,
      recordsExported: stats.exported || 0,
      unfetchable:     stats.unfetchable || 0,
      durationSec:     Number(durationSec) || 0,
      label:           label || '',
    }, { merge: true });
    console.log(`   🫀 system_health/${job} updated (${stats.errors > 0 ? 'error' : 'ok'})`);
  } catch (e) {
    console.warn(`   ⚠️  could not write system_health/${job}: ${e.message}`);
  }
}
```

### B. `files_*` / `budgets_*` dynamic families

No special prefix-scan is required. Both are **root** collections (confirmed: departments.js:10449 `files_${id...}`, :10749 `files_${scope...}`, :10529 `budgets_${dept...}` all passed straight to `db.collection(...)`), so `db.listCollections()` in the A2 loop enumerates each one and JSON-snapshots it automatically — this is precisely the drift class the switch to dynamic discovery eliminates. They carry no `OVERRIDES` entry, so they export as complete JSON with filename === collection name (e.g. `files_it.json`, `budgets_finance.json`). `budgets_*` docs are budget data (worth keeping); `files_*` docs are file-metadata records (worth keeping). No `EXCLUDE` entry — leave them in.

### C. Manila-time hardening for the month window (minor, monthly-backup.js:97-105)

The existing `getPrevMonthRange()` uses server-local `Date` on a UTC runner. The job fires 17:00 UTC on the 1st = 01:00 Manila on the 1st, so the month never mis-rolls in practice, but for correctness under the Manila-time discipline, offset to UTC+8 before extracting Y/M:

```js
// BEFORE: const now = new Date();
// AFTER:  Manila 'now' on a UTC runner (UTC+8), so the label/window are PH-correct.
const now = new Date(Date.now() + 8 * 3600 * 1000);
```
(Leave the rest of the function unchanged — the `new Date(year, month-1, 1)` boundaries are only used for date-filtered OVERRIDE collections; the day-boundary `.toISOString().slice(0,10)` in `fetchAttendanceSubcollection` remains as-is.) This is a low-risk hardening, not a behavior change.

### D. Drive visibility — `scripts/drive-lib.js` (191-211)

Thread an opt-in `public` flag; **default private**. `makePublic` is now only called when explicitly requested.

```js
// BEFORE (drive-lib.js:201-211):
// async function uploadBuffer(drive, buffer, filename, mimeType, folderId) {
//   const res = await drive.files.create({ ... fields: 'id,webViewLink', ...SHARED });
//   await makePublic(drive, res.data.id);
//   return res.data.webViewLink;
// }

// AFTER:
// Upload a Buffer; returns the webViewLink. Files are PRIVATE by default
// (Drive = cold archive). Pass { public:true } only for deliberately
// low-sensitivity, shareable content — nothing in this repo does today.
async function uploadBuffer(drive, buffer, filename, mimeType, folderId, { public: isPublic = false } = {}) {
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media:       { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
    fields:      'id,webViewLink',
    ...SHARED,
  });
  if (isPublic) await makePublic(drive, res.data.id);
  return res.data.webViewLink;
}
```

`makePublic` (drive-lib.js:191-199) is **unchanged** (kept for future opt-in). No call site passes `{ public:true }`, so **both** the daily file mirror and the monthly JSON/CSV exports become private. `monthly-backup.js`'s `uploadText` wrapper (monthly-backup.js:60-62) needs no change — it calls `uploadBuffer(...)` with the default, which is now private. `sync-to-drive.js`'s `mirror()` call (sync-to-drive.js:173) needs no change either — same default.

**Security delta (state honestly, do not oversell):** this removes the *second, permanent, org-external* public surface (the Drive `type:'anyone'` link). The original Firebase Storage `?token=` download URL is itself a bearer token, so files are not becoming 'fully private' — they return to the single, app-controlled, token-revocable Storage surface the app already used. The concretely-eliminated exposures are (1) the aggregate payroll/finance JSON backup dumps that were publicly linkable, and (2) permanent anyone-with-link Drive copies of payslip proofs / drawings / memo attachments that outlived any in-app access control.

‼️ **FLAG FOR NEIL — bandwidth:** with Drive private, the app serves files from Firebase Storage egress (free-tier metered). If download volume is high this could approach the free quota. Recommendation: ship private-by-default now (the security win is clear); monitor Storage egress in the Firebase console; if it becomes a problem, that's a Blaze-tier decision for you, not a reason to keep files public.

### E. In-app `driveUrl` link sites — `js/departments.js`

Flip precedence to the Storage URL at all three sites so files keep opening once the Drive copy is private. (JS edit ⇒ the pre-commit hook auto-bumps `APP_VERSION` and `sw.js` `CACHE_VER`; do not hand-edit.)

1. **Task attachments (departments.js:765)** — inside `t.attachments.map(...)`:
```js
// BEFORE: const url=a&&(a.driveUrl||a.url)||'';
// AFTER:  prefer the app's Storage URL; driveUrl is now a private archive copy
const url=a&&(a.url||a.driveUrl)||'';
```
2. **Drawing current file (departments.js:6486)**:
```js
// BEFORE: ? `<a href="${escHtml(d.driveUrl||d.fileUrl)}" target="_blank" ...`
// AFTER:
? `<a href="${escHtml(d.fileUrl||d.driveUrl)}" target="_blank" class="btn-secondary btn-sm">⬇ ${escHtml(d.fileName||'Open file')}</a>`
```
3. **Drawing revision history (departments.js:6504)** — inside `revs.map(...)`:
```js
// BEFORE: <td>${r.fileUrl?`<a href="${escHtml(r.driveUrl||r.fileUrl)}" target="_blank">⬇</a>`:'—'}</td>
// AFTER:
<td>${r.fileUrl?`<a href="${escHtml(r.fileUrl||r.driveUrl)}" target="_blank">⬇</a>`:'—'}</td>
```
(`driveUrl`/`fileUrl` companions always coexist because `driveUrl` is written next to the original `url`/`fileUrl` — sync-to-drive.js:198-204 — so the fallback is harmless; the flip simply stops preferring the now-private Drive copy.)

### F. Heartbeat rules + in-app alerting

**F1. `firestore.rules` — add a new block** (place next to the other operational blocks, e.g. after the `settings` block at firestore.rules:261; deploy separately with `firebase deploy --only firestore:rules`). Admin SDK writes bypass rules, so client write is denied:

```
    // ── System health (backup/sync heartbeat) ──────────
    // Written ONLY by the GitHub Actions backup/sync jobs via the Admin SDK
    // (which bypasses these rules). No client ever writes it.
    match /system_health/{jobId} {
      allow read:  if isAuth() && isFinanceOrAdmin();
      allow write: if false;
    }
```
(No missing-field-throw risk: the block reads no `resource.data` fields.)

**F2. Client check — add to `js/app.js`.** Call once after the user profile is loaded, for finance/admin roles only (near the post-auth nav build; safe to place right after `startForceLogoutListener(uid)` is wired, app.js:135 region). It is a cheap one-shot `get` (not a live listener), staleness is elapsed-ms (timezone-agnostic, so `bizDate()` is not needed here):

```js
// ── Backup/sync health banner (finance/admin only) ───────────────────────
async function checkBackupHealth() {
  try {
    if (!['president','manager','secretary','finance'].includes(window.currentRole)) return;
    const now = Date.now();
    const CHECKS = [
      { id: 'daily_sync',     label: 'Daily file sync',  staleMs: 30 * 3600 * 1000 },
      { id: 'monthly_backup', label: 'Monthly backup',   staleMs: 34 * 24 * 3600 * 1000 },
    ];
    const problems = [];
    for (const c of CHECKS) {
      const snap = await db.collection('system_health').doc(c.id).get().catch(() => null);
      const d = snap && snap.exists ? snap.data() : null;
      const last = d?.lastRunAt?.toDate?.()?.getTime?.() || 0;
      if (!last || (now - last) > c.staleMs) {
        problems.push(`${c.label} has not reported in — last run ${last ? new Date(last).toLocaleString('en-PH') : 'never'}.`);
      } else if (d.lastStatus === 'error') {
        problems.push(`${c.label} last run had ${d.errors} error(s) (${d.label||''}).`);
      }
    }
    if (!problems.length) return;
    renderBackupHealthBanner(problems);
    // Notify the President once per distinct problem (deduped).
    if (window.Notifs?.send) {
      const PREZ_UID = window.PRESIDENT_UID; // if unavailable, skip the push — banner still shows
      if (PREZ_UID) {
        window.Notifs.send(PREZ_UID, {
          title: '⚠️ Backup/sync needs attention',
          body: problems.join(' '),
          icon: '🗄️', type: 'system',
          dedupKey: 'backup-health-' + problems.join('|').slice(0, 80),
        }).catch(() => {});
      }
    }
  } catch (_) { /* monitoring must never break the app */ }
}

function renderBackupHealthBanner(problems) {
  if (document.getElementById('backup-health-banner')) return;
  const div = document.createElement('div');
  div.id = 'backup-health-banner';
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b91c1c;color:#fff;padding:10px 44px 10px 14px;font-size:13px;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  div.innerHTML = `🗄️ <strong>Records durability alert.</strong> ${problems.map(p => escHtml(p)).join(' ')}`
    + `<button aria-label="Dismiss" style="position:absolute;right:10px;top:8px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer">×</button>`;
  div.querySelector('button').onclick = () => div.remove();
  document.body.appendChild(div);
}
```

Wire the call where the app finishes bootstrapping a signed-in finance/admin user (e.g. at the end of the profile-loaded branch of `onAuthStateChanged`): `checkBackupHealth();` (fire-and-forget). `window.PRESIDENT_UID` — if the codebase has no president-uid constant, resolve it from the known president email (`neilbarro870@gmail.com`) the same way other President gating does, or omit the push (the banner alone satisfies the requirement); do not block the banner on it.

### G. Restore — `scripts/restore-from-backup.js` (new) + `.github/workflows/restore.yml` (new)

Drift-proof (reads `_manifest.json`), dry-run by default, `_counters`-reconciling, ISO→Timestamp reviving. Node stays pinned to 20 (OAuth token-exchange constraint). Full Sonnet-ready script:

```js
/**
 * BARRO INDUSTRIES — Restore Firestore from a monthly Drive backup
 * scripts/restore-from-backup.js
 *
 * DISPATCH-ONLY. Dry-run by default — writes NOTHING unless RESTORE_COMMIT=1.
 * Reads BI-Operations/Monthly Backups/<month>/_manifest.json to learn which
 * JSON file maps to which collection (no hand-maintained list → no drift),
 * downloads the JSON, and batch-writes each doc back with merge:true.
 *
 * Inputs (env):
 *   RESTORE_MONTH       required, e.g. 2026-06
 *   RESTORE_COLLECTION  optional; restore only this collection (else all)
 *   RESTORE_COMMIT      '1' to actually write; anything else = dry run
 * Secrets: same as monthly-backup (FIREBASE_SERVICE_ACCOUNT, DRIVE_FOLDER_ID,
 *   FIREBASE_STORAGE_BUCKET, GOOGLE_OAUTH_*).
 */
'use strict';

const admin = require('firebase-admin');
const fetch = require('node-fetch');
const { requireEnv, initDrive, preflight, SHARED_LIST } = require('./drive-lib');

const serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'));
admin.initializeApp({
  credential:    admin.credential.cert(serviceAccount),
  storageBucket: requireEnv('FIREBASE_STORAGE_BUCKET'),
});
const db = admin.firestore();

const { drive, authMode, ownerLabel } = initDrive();
const ROOT_FOLDER_ID = requireEnv('DRIVE_FOLDER_ID');
const MONTH   = requireEnv('RESTORE_MONTH');
const ONLY    = (process.env.RESTORE_COLLECTION || '').trim();
const COMMIT  = (process.env.RESTORE_COMMIT || '').trim() === '1';

if (!/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error(`\n❌ RESTORE_MONTH must look like 2026-06 (got "${MONTH}").`);
  process.exit(2);
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function revive(v) {
  if (typeof v === 'string' && ISO.test(v)) return admin.firestore.Timestamp.fromDate(new Date(v));
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = revive(x); return o; }
  return v;
}

async function findFolder(name, parentId) {
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id,name)', ...SHARED_LIST,
  });
  return res.data.files[0] || null;
}
async function listJson(folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and mimeType='application/json'`,
    fields: 'files(id,name)', pageSize: 1000, ...SHARED_LIST,
  });
  return res.data.files || [];
}
async function download(fileId) {
  const res = await drive.files.get({ fileId, alt: 'media', ...SHARED_LIST }, { responseType: 'text' });
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

async function restoreCollection(name, docs) {
  // _counters: never blind-overwrite a sequence — bump to max(current, restored).
  if (name === '_counters') {
    for (const d of docs) {
      const id = d.id; const restored = Number(d.count) || 0;
      const cur = await db.collection('_counters').doc(id).get();
      const current = cur.exists ? (Number(cur.data().count) || 0) : 0;
      const next = Math.max(current, restored);
      console.log(`   _counters/${id}: current=${current} restored=${restored} → ${next}`);
      if (COMMIT) await db.collection('_counters').doc(id).set({ count: next }, { merge: true });
    }
    return docs.length;
  }
  let batch = db.batch(), n = 0, written = 0;
  for (const d of docs) {
    const { id, ...rest } = d;
    if (COMMIT) { batch.set(db.collection(name).doc(id), revive(rest), { merge: true }); n++; }
    written++;
    if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (COMMIT && n) await batch.commit();
  return written;
}

async function main() {
  console.log(`\n♻️  Barro Industries — Restore from backup`);
  console.log(`   Month     : ${MONTH}`);
  console.log(`   Collection: ${ONLY || '(ALL)'}`);
  console.log(`   Mode      : ${COMMIT ? '🔴 COMMIT (writes Firestore)' : '🟢 DRY RUN (no writes)'}`);
  await preflight(drive, ROOT_FOLDER_ID, authMode, ownerLabel);

  const backups = await findFolder('Monthly Backups', ROOT_FOLDER_ID);
  if (!backups) { console.error(`\n❌ No "Monthly Backups" folder under DRIVE_FOLDER_ID.`); process.exit(2); }
  const monthFolder = await findFolder(MONTH, backups.id);
  if (!monthFolder) { console.error(`\n❌ No backup folder "${MONTH}".`); process.exit(2); }

  const files = await listJson(monthFolder.id);
  const manifestFile = files.find(f => f.name === '_manifest.json');
  let map; // filename(no .json) → collection
  if (manifestFile) {
    map = {};
    for (const m of JSON.parse(await download(manifestFile.id))) map[m.filename] = m.collection;
  } else {
    console.warn(`   ⚠️  no _manifest.json (pre-manifest backup) — assuming filename === collection`);
    map = null;
  }

  let total = 0, cols = 0;
  for (const f of files) {
    if (f.name === '_manifest.json' || f.name === 'task_messages.json') continue; // subcollection: manual
    const basename = f.name.replace(/\.json$/, '');
    const collection = map ? (map[basename] || basename) : basename;
    if (collection.includes('/')) continue;         // subcollection entries — skip
    if (ONLY && collection !== ONLY) continue;
    if (collection === 'attendance') { console.log(`\n⏭️  attendance (subcollection) — restore manually`); continue; }
    const docs = JSON.parse(await download(f.id));
    console.log(`\n📄 ${collection}: ${docs.length} docs`);
    const written = await restoreCollection(collection, docs);
    total += written; cols++;
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${COMMIT ? '✅ Restore complete' : '✅ Dry run complete (nothing written)'}`);
  console.log(`   Collections: ${cols}   Docs: ${total}`);
  console.log(`${'─'.repeat(50)}\n`);
  process.exit(0);
}
main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
```

**`.github/workflows/restore.yml` (new — dispatch-only, Node 20):**
```yaml
name: Restore Firestore from Backup
on:
  workflow_dispatch:
    inputs:
      month:      { description: 'Backup month (YYYY-MM)', required: true }
      collection: { description: 'Single collection (blank = all)', required: false }
      commit:     { description: 'Type EXACTLY "1" to write; anything else = dry run', required: true, default: '0' }
jobs:
  restore:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install
        working-directory: scripts
      - run: node restore-from-backup.js
        working-directory: scripts
        env:
          FIREBASE_SERVICE_ACCOUNT:   ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          DRIVE_FOLDER_ID:            ${{ secrets.DRIVE_FOLDER_ID }}
          FIREBASE_STORAGE_BUCKET:    ${{ secrets.FIREBASE_STORAGE_BUCKET }}
          GOOGLE_OAUTH_CLIENT_ID:     ${{ secrets.GOOGLE_OAUTH_CLIENT_ID }}
          GOOGLE_OAUTH_CLIENT_SECRET: ${{ secrets.GOOGLE_OAUTH_CLIENT_SECRET }}
          GOOGLE_OAUTH_REFRESH_TOKEN: ${{ secrets.GOOGLE_OAUTH_REFRESH_TOKEN }}
          RESTORE_MONTH:      ${{ inputs.month }}
          RESTORE_COLLECTION: ${{ inputs.collection }}
          RESTORE_COMMIT:     ${{ inputs.commit }}
```
Add `scripts/package.json` script (optional convenience): `"restore": "node restore-from-backup.js"`. No new npm deps (`firebase-admin`, `googleapis`, `node-fetch` already present). **Restore caveat to document:** `attendance` (subcollection) and `tasks/task-comments` (`task_messages.json`) are not auto-restored by this script — restore them manually from the JSON if ever needed; they are the only two non-flat shapes.

### H. Sync heartbeat in `sync-to-drive.js`

Mirror §A3 in `sync-to-drive.js`. Add the same `reportHealth` helper (adjust the stat names) and call it before `process.exit` (sync-to-drive.js:289):
```js
  await reportHealth('daily_sync', stats, '', duration);
  process.exit(stats.errors > 0 ? 1 : 0);
```
with:
```js
async function reportHealth(job, stats, label, durationSec) {
  try {
    await db.collection('system_health').doc(job).set({
      job, lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      lastStatus: stats.errors > 0 ? 'error' : 'ok',
      errors: stats.errors || 0, filesWritten: stats.synced || 0,
      unfetchable: stats.unfetchable || 0, durationSec: Number(durationSec) || 0, label: label || '',
    }, { merge: true });
  } catch (e) { console.warn(`   ⚠️  system_health/${job}: ${e.message}`); }
}
```

### I. Docs to update

- **`DRIVE_SYNC_SETUP.md`** — replace the stale ~9-file 'Drive folder structure created' listing with: 'Every non-ephemeral Firestore collection is snapshotted to JSON automatically via `db.listCollections()`; `_manifest.json` records the file→collection map; specific collections additionally get a CSV (see `OVERRIDES` in monthly-backup.js).' Document Drive-private-by-default, the `system_health` heartbeat, and the restore workflow (dispatch, dry-run default, `commit=1` to write).
- **`ROADMAP.md`** — close item 17 ('verify the monthly backup GitHub Action actually runs; document restore'): coverage is now dynamic-discovery-driven (drift-proof), a restore workflow exists, and a `system_health` heartbeat surfaces missed/failed runs in-app.
- Add a discoverability comment at the two dynamic-collection definition sites (departments.js:10449, 10529) noting that root collections are auto-backed-up — so a future author knows new collections need no backup registration.

### Migration / rollout checklist

1. Edit `scripts/drive-lib.js` (§D), `scripts/monthly-backup.js` (§A1-A3, §C), `scripts/sync-to-drive.js` (§H), and add `scripts/restore-from-backup.js` (§G). No new GitHub Secrets — all reuse the existing backup secret set.
2. Add `.github/workflows/restore.yml` (§G).
3. Edit `js/departments.js` (§E, 3 sites) and `js/app.js` (§F2). Commit — the pre-commit hook auto-bumps `APP_VERSION` + `sw.js` `CACHE_VER` (do not hand-edit).
4. Add the `system_health` block to `firestore.rules` (§F1). Deploy rules separately: `firebase deploy --only firestore:rules` (rules do NOT ship via git push).
5. `git push origin v12` (per branch) — deploys app + scripts to GitHub Pages; the GitHub Actions workflows pick up the new script versions on their next run.
6. Manually `workflow_dispatch` **Monthly Firestore → Google Drive Backup** once. Verify in Drive: `Monthly Backups/<month>/` now contains `_manifest.json`, `pay_runs.json`, `approval_requests.json`, `payroll_delete_requests.json`, `it_access.json`…`it_tickets.json`, `kpi_targets.json`, `sales_orders.json`, `audit_log.json`, `_counters.json`, `products.json`, and any `files_*`/`budgets_*`; and that `_summary.txt` shows `Errors: 0`.
7. Confirm every file uploaded in step 6 is **Private** in Drive (no 'Anyone with the link' badge).
8. Manually `workflow_dispatch` **Daily File Sync** once; verify newly-mirrored files are Private and that `system_health/daily_sync` exists (Firestore console).
9. Sign in as President/Finance; confirm no health banner when both `system_health` docs are fresh. Temporarily edit one `system_health` doc's `lastRunAt` to a past date (or `lastStatus:'error'`) in the console and reload — confirm the banner + President notification fire, then revert.
10. Dry-run restore: run **Restore Firestore from Backup** with `month=<recent>`, `commit=0`; confirm it lists collections/doc counts and writes nothing.
11. Update `DRIVE_SYNC_SETUP.md` and `ROADMAP.md` (§I); commit + push.

### Manual test checklist (no automated suite)

- [ ] Backup dispatch: `_manifest.json` present and lists every non-ephemeral collection; each entry has a matching `<filename>.json`.
- [ ] Previously-missing collections all have JSON: `pay_runs`, `approval_requests`, `payroll_delete_requests`, `it_*` (×5), `kpi_targets`, `sales_orders`, `audit_log`, `_counters`, `products`, `quotes`, `memos`, `policies`, `sops`, `settings`, `signup_requests`, `president_message`, `files_*`, `budgets_*`.
- [ ] `attendance.json` still populated (subcollection path still works via OVERRIDE).
- [ ] Every Drive file (backup exports AND daily-mirror files) shows Private, not 'Anyone with link'.
- [ ] Task attachment, drawing current-file, and drawing-revision download links still open in-app (served from Storage `url`).
- [ ] `system_health/daily_sync` and `system_health/monthly_backup` update after each job with `lastStatus`, `lastRunAt`, `errors`.
- [ ] Finance/admin sees the red durability banner when a heartbeat is stale/error; non-finance roles never see it; banner dismiss works; President gets one deduped notification.
- [ ] Restore dry-run writes nothing; restore `commit=1` on a single collection into a scratch/staging project writes docs and reconciles `_counters` to max (verify `_counters/employees` is not lowered).
- [ ] ISO timestamps in restored docs come back as Firestore Timestamps, not strings.

### Deferred / cross-workstream flags

- **WS20/22 (payroll/CashAdvance) field-shape coupling — RESOLVED, no coordination needed.** Because auto-discovered collections (including `pay_runs`, `payroll_delete_requests`) are snapshotted as **whole-document JSON** with no hand-picked `csvFields`, any Phase-3 schema change is captured completely and automatically. The CSV-truncation risk only ever applied to collections with an explicit `csvFields` OVERRIDE (JSON is always complete) — and none of the payroll-governance collections have one. Do not add `csvFields` for `pay_runs`/`approval_requests`.
- **`gov_biddings` orphan (app.js:6105) — pre-existing analytics bug, NOT this workstream's fix.** The `an_gov` widget reads a legacy/empty `gov_biddings` collection distinct from the live `gov_philgeps`/`gov_active_bids`/`gov_archive`. If it holds no docs, `listCollections()` simply won't surface it (nothing to back up); if it holds stale docs, they'll be backed up automatically. Repointing the widget belongs to whichever workstream owns analytics — flag, don't paper over.
- **Write-time sync queue — DEFERRED (decision 7).** Do not build a per-write Cloud Function; the nightly generic walk remains authoritative.
- **Native `gcloud firestore export` DR layer — FLAGGED, not built (decision 2).** Owner call; needs Blaze/GCS billing.
- **`sync-to-drive.js` subcollection depth cap = 1 (sync-to-drive.js:250-254)** — flagged for WS28: if `job_projects/{id}/stages/{stageId}/photos` (two levels deep) ships, those files will be silently missed by the file mirror. Out of scope here; call it out so WS28 raises the depth cap or mirrors those explicitly.
- **Drive→Storage bandwidth shift (decision 4)** — ‼️ FLAG FOR NEIL; monitor Firebase Storage egress, Blaze is the escape hatch if needed.

## Risks / cross-workstream interactions

- ⚠️ Interaction with the Finance/Payroll rebuild workstreams (13, 20-24): `pay_runs` and `payroll_delete_requests` are two of the collections identified as missing from backup, and they are also actively being redesigned in Phase 3 (workstream 20 'kill the second compute path', 22 CashAdvance unification). If this workstream's EXPORTS fix ships before Phase 3's schema changes, the field list captured (`state`, `employeeCount`, `totalNet`, etc.) may already be stale by the time Phase 3 lands — coordinate field-shape assumptions with whichever workstream builds 20-24, or design the export to snapshot whole documents generically rather than hand-picking CSV fields (the current EXPORTS pattern of a hardcoded `csvFields` array per collection, e.g. monthly-backup.js:130 for cash_advances, silently drops any field not listed — meaning even collections that ARE in EXPORTS today can have incomplete CSVs if their schema grew after the csvFields array was written; JSON output is always complete, only CSV truncates).
- ⚠️ Interaction with workstream 33 (AEC Partner Directory): the plan explicitly calls out 'New `aec_contacts` collection + rules + backup' (V12-PLAN.md:138) as part of that OTHER workstream's own scope — meaning whichever collection-registry mechanism this workstream (15) builds must be easy for a future, unrelated workstream to plug a brand-new collection into without re-triggering this same audit. If the fix is 'update the static EXPORTS array', that instruction needs to be loud and discoverable (e.g. a code comment at the collection-definition site, or a lint/CI check), not just tribal knowledge in a memory file — the existing memory `drive-sync-config` already says 'remember to add new collections to the backup EXPORTS list', and that reminder alone evidently wasn't sufficient to prevent the current drift.
- ⚠️ Recursion/self-reference risk: if the chosen heartbeat/status mechanism lives in its own new Firestore collection, that collection itself needs (a) a firestore.rules entry and (b) to be added to the backup EXPORTS (or whatever supersedes it) — otherwise workstream 15 ships a monitoring system that isn't itself monitored/backed-up, which is a bit absurd for a workstream literally about closing backup gaps.
- ⚠️ `_counters/employees` (a transactional sequence counter, app.js:439-445) is NOT itself timestamped or in EXPORTS; if a full-Firestore restore is ever performed from an older backup snapshot after `_counters` has advanced further in production, restoring the OLDER counter value risks minting a duplicate `BI-{year}-{seq}` employee ID on the next new-hire signup post-restore. Any restore design needs an explicit reconciliation step for counters (bump to max-of-restored-vs-current, not blind overwrite).
- ⚠️ `fetchAttendanceSubcollection()` (monthly-backup.js:232-253) and the generic file-walk in sync-to-drive.js both assume specific shapes (`attendance/{uid}/records/{date}` for the former; arbitrary one-level-deep subcollections via `doc.ref.listCollections()` for the latter, sync-to-drive.js:250-254, capped at `depth=1`). If any future workstream nests subcollections two levels deep (e.g. `job_projects/{id}/stages/{stageId}/photos/{id}` for the production-flow workstream 28's stageHistory), today's sync-to-drive.js depth cap of 1 would silently miss those files — worth flagging since workstream 28 is explicitly planned to add `stageHistory` per-stage data.
- ⚠️ Stale documentation actively contradicts the shipped code: DRIVE_SYNC_SETUP.md's 'Drive folder structure created' section for the monthly backup lists only ~9 files, while monthly-backup.js's real EXPORTS array has ~48 entries. Whatever this workstream builds should update/replace this doc as part of the change, or a future session will re-read it, believe backup coverage is worse (or differently shaped) than it actually is, and duplicate discovery work.
- ⚠️ Because `makePublic()` is inside the ONE shared `uploadBuffer()` helper (drive-lib.js:201-211) called by both scripts, any redesign that changes default visibility touches monthly-backup.js's own exports too (the payroll/ledger/finance JSON dumps currently ALSO get `type:'anyone'` — meaning the raw finance/payroll backup data itself is public-by-link today, arguably a more severe exposure than individual payslip-proof files, since it's the aggregate of everyone's numbers in one JSON). This should be weighed at least as heavily as the payslip-proof case the workstream description calls out by name.
- ⚠️ GitHub Actions cron jobs are known to be silently skipped/delayed by GitHub during high load or if the repo has been inactive (this is why `.github/workflows/keepalive.yml` exists — 'monthly commit so GitHub doesn't auto-disable the scheduled workflows', per CLAUDE.md). A heartbeat-based alerting design needs to treat 'the workflow didn't fire at all' as a first-class failure mode, not just 'the workflow fired and threw errors' — these are different signals requiring different code (the former needs an external, time-based check like 'has settings/system.lastBackupAt updated within N days', the latter is just reading the job's own exit code/stats).

## Files likely touched

`scripts/monthly-backup.js`, `scripts/sync-to-drive.js`, `scripts/drive-lib.js`, `scripts/package.json (possible new deps: @google-cloud/firestore for native export/import, or none if staying JSON-based)`, `scripts/restore-from-backup.js (new, if a bespoke restore script is the chosen design)`, `scripts/get-drive-token.js (only if auth mode changes)`, `.github/workflows/monthly-backup.yml`, `.github/workflows/sync-to-drive.yml`, `.github/workflows/restore.yml (new, if a manual-dispatch restore workflow is wanted)`, `firestore.rules (new match blocks for any new heartbeat/status collection, and/or for aec_contacts if this workstream's collection-registry mechanism is built generically enough that workstream 33 reuses it)`, `js/app.js (if an in-app failure-alert banner/notification reads a new heartbeat doc — likely near the existing settings/system onSnapshot listener at app.js:135, or the notifications/toast system in js/notifications.js)`, `js/notifications.js (if backup-failure alerts are delivered via the existing Notifs/toast/FCM inbox rather than a bespoke banner)`, `DRIVE_SYNC_SETUP.md (stale; needs rewrite to match the real EXPORTS list and any new restore/heartbeat mechanism)`, `ROADMAP.md (close out item 17 'verify the monthly backup GitHub Action actually runs; document restore' once addressed)`

## Expected deliverable format

> Fable's output for this workstream should let Sonnet implement mechanically with zero further judgment calls. Concretely:
> 
> 1. A decided architecture (one paragraph) stating which of the openDecisions above was chosen and why, referencing the specific tradeoff it resolves — e.g. "static EXPORTS stays but gains a lint-checked completeness test" vs "switch to native export" vs "hybrid."
> 
> 2. For the backup-coverage fix: the EXACT new/changed entries to add to monthly-backup.js's `EXPORTS` array (copy-pasteable object literals in the same shape as the existing entries at monthly-backup.js:112-227, including `name`/`filename`/`dateField`/`csvFields` per the established convention), plus, if a genericized/dynamic-discovery approach is chosen instead, the exact replacement function signature and control flow (before/after code block against the real current `main()` at monthly-backup.js:319-391).
> 
> 3. For the dynamic `files_*`/`budgets_*` families: an exact code block showing how monthly-backup.js should discover and export them (e.g. via `db.listCollections()` + a prefix filter, mirroring the pattern already proven in sync-to-drive.js:270-277), since no such mechanism exists in monthly-backup.js today.
> 
> 4. The exact `firestore.rules` diff (unified-diff or before/after block) for any new collection this workstream introduces (heartbeat/status doc, restore-audit log, etc.) — following the existing rule-block style seen at firestore.rules:311-325 (comment header, `allow read/create/update/delete` split by role helper).
> 
> 5. For Drive visibility: the exact before/after of `makePublic()` / `uploadBuffer()` in drive-lib.js (drive-lib.js:191-211), stating precisely which permission `type` replaces `'anyone'` and under what condition (e.g. a new parameter threaded through from each call site, since today it's unconditional) — plus the exact call-site changes needed in monthly-backup.js and sync-to-drive.js to pass that new parameter/policy through.
> 
> 6. If any in-app `<a href>` to `driveUrl` (departments.js:765, 6486, 6504) needs to change behavior once files stop being public-by-link, the exact before/after HTML-template diff for each of those three call sites.
> 
> 7. A numbered migration/rollout checklist (the kind ROADMAP.md already uses for past sessions — e.g. "1. Add GitHub secret X. 2. Run `firebase deploy --only firestore:rules`. 3. Manually trigger workflow_dispatch once to backfill. 4. Verify _summary.txt shows 0 errors and N collections.") including exactly which GitHub Secrets are new/changed, and the exact `firebase deploy --only ...` / `git push` sequence per this repo's established deploy-discipline (CLAUDE.md, ROADMAP.md:72).
> 
> 8. If a restore script/runbook is in scope: either the full script (Sonnet-ready, following the existing scripts/ code style — `'use strict'`, requireEnv, preflight-style fail-loud errors) or, if restore is scoped as documentation-only, the exact runbook steps a human follows (gcloud commands or Console click-path), stated precisely enough that no interpretation is needed.
> 
> 9. Explicit call-outs of anything intentionally deferred to another workstream (e.g. "pay_runs field-shape assumptions here are provisional pending workstream 20") so Sonnet doesn't accidentally over-build against a schema Phase 3 is about to change.
