# PAYSLIP OVERHAUL — Design Spec

**Status:** SPEC ONLY — no code changed. Authored 2026-08-04 (Fable). Implementation tier: Sonnet subagents, one workstream per section, following this spec exactly; escalate ambiguities, never improvise on money paths.

**Scope:** the five owner asks from the live payslip screenshots, plus the statutory-0 data bug. Grounded in code as of `master` @ 6c3a899 (v14.0.61).

---

## 0. Current architecture (what exists, verified)

| Piece | Where | Role |
|---|---|---|
| `toPayslipModel(source, kind)` | js/screens/hr.js:3253 | Normalizes a frozen `pay_runs` line / `salary_history` doc (`'monthly'`) or a `payslips/{id}` doc (`'weekly'`) into ONE PayslipModel |
| `buildPayslipHTML(model)` | js/screens/hr.js:3400 | The one branded template; calls `buildLetterhead` with `brandEntity('bir')` |
| `renderPayslipPage(model, backFn)` | js/screens/hr.js:3513 | In-app host via `openPage` (js/app.js:3091); Print + Save-as-JPEG buttons in `headerRightHTML` |
| `downloadPayslipJPEG(model)` | js/screens/hr.js:3559 | Loads html2canvas from **cdnjs** at hr.js:3563, captures `.payslip-print`, anchors a data-URL download |
| `buildLetterhead(opts)` | js/letterhead.js:22 | header/footer/printCSS; `@page A4` at letterhead.js:98; `docNumber` renders at letterhead.js:46 (`.lh-docno`) |
| `disbursePayRun(month)` | js/departments.js:1853 | THE money step: salary_history freeze (1917-1952), CA deduct, ledger legs, notify (2153-2156), state flip (2159) |
| Employee self-view | js/screens/dashboards.js:2728 (`my-payslip-btn` in `renderPersonalFinance`) | Current-month only: reads own `salary_history/{uid}_{month}`, else projection via `computePayLine` |
| Payslip print CSS | css/styles.css:5969-6006 (base + `.payslip-print` blocks) | `@page size:A4` print-only; **no on-screen A4 layout exists** |
| salary_history rules | firestore.rules:814-820 | **Already owner-readable**: `resource.data.userId == request.auth.uid \|\| isFinanceOrAdmin()` |
| pay_runs rules | firestore.rules:881-909 | Disbursed state is rules-immutable — no clause permits updating a disbursed run |

Callers of `renderPayslipPage`: hr.js:1744 (payroll roster, single), hr.js:1774 (Print All), hr.js:2584/3015/3069 (weekly worker generator/history), dashboards.js:2745 (personal finance), dashboards.js:3064 (worker-profile panel).

---

## 1. ASK 1 — Edit all fields on the payslip

### Root cause of "blank fields"
Gov-ID cells (TIN/SSS#/PhilHealth#/Pag-IBIG#) render `''` when the IDs were never entered on `payroll/{uid}` (Edit Payroll modal, hr.js:1258-1266 → write at hr.js:1329-1332) or `worker_profiles/{id}` (hr.js:2124/2250). Frozen runs snapshot the IDs at Compute (departments.js:1836-1837) and Disburse (departments.js:1932) — so any run computed while IDs were blank stays blank forever, even after HR backfills the master record. There is **no edit affordance anywhere on the payslip page itself**.

### Design decision — the payslip is a RENDERING, not a second editor for money
Money already has exactly three sanctioned editors, all pre-disburse: Edit Payroll modal (live settings → `payroll/{uid}`), the Adjust modal (`pay_runs.overrides`, survives recompute per departments.js:1741-1756), and Give Raise (approval-routed base salary). We do **not** add a fourth money-write path on the payslip; we add an **"✎ Edit details"** button on `renderPayslipPage` that (a) edits identity/gov-ID fields in place, and (b) deep-links money fields to the correct existing editor for the run's state. `buildPayslipHTML` stays pure (model in → HTML out).

### Editable-fields matrix

| Field | Editable? | Who | Persists where | When disbursed (official=true) |
|---|---|---|---|---|
| Name, Department, Job Title | Yes | finance/president (isMoneyAdmin) | `users/{uid}` (displayName/department/title); weekly → `worker_profiles/{id}` | Editable; ALSO patch `salary_history.userName` (display copy) — never money fields |
| TIN / SSS# / PhilHealth# / Pag-IBIG# | Yes | finance/president | `payroll/{uid}.tinNum/ssNum/phNum/pagibigNum` (monthly); `worker_profiles/{id}` (weekly) | Editable; ALSO patch the same four `*Num` fields on `salary_history/{uid}_{month}` (factual backfill, not money — rules already allow isMoneyAdmin update, firestore.rules:818) |
| Employee ID | Yes | finance/president | `users/{uid}.employeeId` / `worker_profiles` | Same backfill treatment |
| Base salary | NO (route) | — | Give Raise flow only (hr.js:1241-1243 already blocks direct edit) | LOCKED |
| Allowance / Other Deductions | Route | finance/president | Projection → Edit Payroll modal (`payroll/{uid}`); Computed run → Adjust modal (`pay_runs.overrides`) | LOCKED |
| SSS/PhilHealth/Pag-IBIG/Tax amounts | Route | finance/president | Same two routes as above (hand-typed value wins per money-core.js:76-79) | LOCKED |
| CA installment | Route | finance/president | Edit Payroll modal CA section / `payroll_ca_overrides` (hr.js:1352-1360) | LOCKED |
| Net pay / gross / YTD | Never | — | Always computed | LOCKED |
| Note to employee (hrNote) | Yes | finance/president | Pre-disburse: `pay_runs.employeeNotes[uid]`; post-disburse: `salary_history.hrNote` — existing `openEmployeeNoteModal` (hr.js:1389-1443) decides | Editable (existing behavior, keep) |
| Pay date label | Yes (display) | finance/president | Derived from `disbursedAt` (hr.js:1735); allow a display override stored NOWHERE (session-only) — or skip; recommend skip | n/a |

**Hard rules (money-sensitivity):**
- NEVER write `salary`, `allowance`, `deductions`, `sss`, `philhealth`, `pagibig`, `tax`, `caDeducted`, `netPay`, `finalPay` on a `salary_history` doc from any edit UI. The identity patch whitelist is exactly: `userName, tinNum, ssNum, phNum, pagibigNum` (+ existing `hrNote` via its own modal).
- NEVER touch `js/money-core.js` (`computePayLine` is frozen, tested math).
- A disbursed month's figures are historical truth. If genuinely wrong, the path is the existing president-approved delete (`financeDelete` → `finance_delete_requests`, per memory/rules:1395) — never in-place mutation.
- Every identity backfill logs `window.logAudit('payslip-id-backfill','salary_history', docId, {fields})`.

### Implementation shape
- `renderPayslipPage` gains `headerRightHTML` button `✎ Edit details`, shown only when `window.canFinance`-equivalent (`isMoneyAdmin` client mirror: role in president/finance or Finance dept — reuse the same gate the payroll screen uses, hr.js's `canFinance`). Employees viewing their own payslip never see it.
- Button opens a stacked `openPage` (replace:false) with: Section A "Employee & Government IDs" (always live inputs, prefilled from the model + a fresh `payroll/{uid}` read so stale model data isn't re-saved); Section B "Pay figures" — not inputs; a state-aware explainer with one deep-link button: "Edit live pay settings" (projection) / "Adjust this computed line" (computed) / "🔒 Disbursed — figures locked" (official).
- On save: write master record(s); if `model.official` also patch the mirror's five identity fields; then re-run the model build + re-render the payslip page (replace:true) so the fix is visible immediately.
- Weekly payslips: same panel; identity writes go to `worker_profiles/{id}`; a **saved** `payslips` doc (draft or submitted) gets the same five-field identity patch (`tinNum/ssNum/phNum/pagibigNum/workerName`), money locked once status is `submitted` (ledger posted at submit per hr.js:3064 comment).

**Files touched:** js/screens/hr.js (renderPayslipPage + new `openPayslipEditPanel`), js/screens/dashboards.js (none — employee view has no edit), firestore.rules (none — payroll/users/worker_profiles/salary_history writes already gated isMoneyAdmin).

**Edge cases:** concurrent Edit Payroll modal open elsewhere (last-write-wins on `payroll/{uid}` — acceptable, set-merge with only the five fields); user doc missing (worker with no login) → skip users write; ID formats free-text (existing convention, no validation beyond trim — matches hr.js:1329-1332).

---

## 2. ASK 2 — Garbled doc number + header formatting

### Root causes (exact)
1. **The garbled token IS a raw Firestore id.** Weekly: hr.js:3302 `docNumber: source.id || ''` — a `payslips` auto-id like `sIA8AHYbLWXvDJ4…`. Monthly: hr.js:3269 `` docNumber:`PS-${month}-${uid}` `` — embeds the 28-char Firebase Auth uid. Both render top-right via letterhead.js:46 (`.lh-docno`, 11pt bold) AND again in the footer (`footerNote`, hr.js:3411) — printed twice.
2. **Cramped header wrap:** `.lh-name` is 16pt/900 (letterhead.js:85) and the BIR entity name is the long `BARRO KITCHENS — By Barro Industries OPC` (config.js:1609); plus `brandEntity('bir')` injects the placeholder id-line `"BIR registration pending accountant confirmation (D6)"` (config.js:1657) — an internal to-do string printing on an employee-facing document. On a phone-width panel the two flex columns (`.lh-header`, letterhead.js:82) collide and wrap.
3. **Empty cells:** blank TIN/SSS/etc. render as empty `<td>`s (hr.js:3437-3440), reading as broken.

### Fix design
- **Human payslip number.** In `toPayslipModel`:
  - Monthly: `PS-{YYYYMM}-{employeeId}` (e.g. `PS-202607-BI-012`) using `source.employeeId`; fallback when absent: `PS-{YYYYMM}-{last 4 chars of uid, uppercased}`. Month digits only (strip the dash) so it reads as a serial, not a date fragment.
  - Weekly: `PS-W-{YYYYMMDD of payPeriodStart}-{workerIdNum}` (workers have `BI-W-###` ids via `nextWorkerIdNumber`, hr.js:1782); fallback last-4 of the doc id. Do NOT retro-write anything to saved docs — the number is derived at render time, deterministic and stable.
  - Add `model.sourceRef = raw doc id/uid` (never printed; kept for debugging/audit panels).
  - Footer: `footerNote` keeps the new number once — drop the duplicated periodLabel (already shown top-right via `dateLabel`).
- **Header cleanup** (letterhead is shared — payslip-scoped changes only where possible):
  - In `buildPayslipHTML`, pass a payslip-specific entity object: clone `brandEntity('bir')` and **drop `registration` when it equals the placeholder** (or more robustly: `buildLetterhead` gains opt `suppressRegistration:true` used by the payslip only — other BIR docs keep their banner treatment). The blank `tin` already self-suppresses (letterhead.js:39).
  - Responsive header for the on-screen host (see §3 CSS): inside `.a4-sheet` the header keeps its two-column A4 layout because the sheet has a fixed 794px layout width — the phone squeeze disappears entirely once §3 lands. No letterhead print CSS changes needed.
- **Empty-cell placeholders:** in `buildPayslipHTML` employee table, render `— not on file` (muted, 10px) for blank TIN/SSS#/PhilHealth#/Pag-IBIG#/ID cells. Pairs with §1's edit affordance.

**Files touched:** js/screens/hr.js (toPayslipModel ×2 branches, buildPayslipHTML, footerNote), js/letterhead.js (optional `suppressRegistration` opt — additive, default false).

**Edge cases:** two employees sharing an employeeId (shouldn't happen — `_counters/employees` atomic, app.js:498) — the number is display-only, `sourceRef` disambiguates; legacy salary_history docs with no employeeId → uid-last-4 fallback; docNumber flows into the JPEG filename (hr.js:3568) — new format is filesystem-safe (`[A-Z0-9-]`).

---

## 3. ASK 3 — Proper A4 on-screen preview

### Root cause
`buildPayslipHTML` output is injected as a plain flow column into the `openPage` panel body (hr.js:3548). All A4-ness lives in `@media print` only (styles.css:5997/6005, letterhead.js:98). On a phone the "document" is just a cramped mobile list; it looks nothing like the printed page.

### Fix design — fixed-layout sheet + scale-to-fit
New CSS component in css/styles.css:

```
.a4-stage      — the scroll/centering container inside the panel body
.a4-sheet      — width:794px (210mm @96dpi); min-height:1123px; background:#fff;
                 padding:42px 38px 26px (≈11mm 10mm 7mm, matches @page);
                 box-shadow + 1px border; color-scheme:light;
                 forced-light token overrides so dark/Astral themes can't bleed in:
                 --surface:#fff; --surface2:#f4f4f4; --border:#ddd;
                 --text:#222; --text-muted:#666  (hrNote box at hr.js:3473 uses these)
```

Scaling: CSS `transform:scale(var(--a4-scale))`, `transform-origin: top left`. Because transforms don't affect layout, `.a4-stage` gets explicit `height: calc(1123px * var(--a4-scale))` and `width: calc(794px * var(--a4-scale))`, centered with margin auto. A small helper `window.fitA4Sheet(panel)` in hr.js computes `--a4-scale = min(1, (bodyWidth - 16) / 794)` on render, `resize`, and `orientationchange` (listener removed in the panel's teardown via `onClose` chain). No horizontal scroll ever; on iPhone the full page is visible and pinch-zoomable inside the panel scroll.

Print integration: add to the existing `.payslip-print` print block (styles.css:5999-6006):
```
@media print { .a4-stage,{transform:none!important;height:auto!important;width:auto!important}
               .a4-sheet{transform:none!important;width:100%!important;min-height:0;
                         padding:0!important;box-shadow:none;border:none} }
```
(padding zeroed because `@page` margins take over — avoids double margins.)

Apply the wrapper in ALL THREE hosts: `renderPayslipPage` (hr.js:3548 — `<div class="a4-stage"><div class="a4-sheet payslip-print">…`), the Print-All flow (hr.js:1774 — each payslip gets its own stage/sheet, `page-break-after:always` stays on the print class), and nothing else (BIR prints keep their own pattern).

**Files touched:** css/styles.css (new block — commit auto-bumps CACHE_VER via hook), js/screens/hr.js (wrapper + fitA4Sheet).

**Edge cases:** JPEG capture must target `.a4-sheet` and neutralize the transform during capture (html2canvas honors transforms inconsistently) — capture a **clone** appended off-viewport at scale 1 (standard html2canvas idiom), or temporarily set `--a4-scale:1` on the source; spec: clone-capture, it's deterministic. Two-page payslips (long timeLog): sheet grows beyond 1123px naturally (min-height, not height); print pagination unchanged.

---

## 4. ASK 4 — Print / Save PDF + Save as JPEG that actually work on iPhone standalone

### Root causes (exact, two independent failures)
1. **Save as JPEG is CSP-blocked.** index.html:12 `script-src 'self' https://www.gstatic.com https://unpkg.com https://cdn.jsdelivr.net 'unsafe-inline'` — `cdnjs.cloudflare.com` is NOT allowlisted, so the dynamic loader at hr.js:3563 fails on every device (not just iOS). The service worker never even sees it. Compounding bug: hr.js:3559-3571 has **no try/catch** — the button is left stuck disabled saying "Generating…", which is exactly the "not working" symptom.
2. **Print / Save PDF:** `window.print()` (hr.js:3515) is a no-op or silently unreliable inside the iOS Add-to-Home-Screen standalone webview across many iOS versions (no browser chrome to host the print sheet). Additionally, the JPEG fallback path's `link.click()` on a `data:` URL (hr.js:3567-3570) is itself unreliable in standalone mode (download manager behavior differs; large data-URLs can navigate the document).

### Chosen approach (and why it works on iOS standalone)
**Vendor html2canvas locally + capture to a Blob + hand the file to the native share sheet (Web Share API Level 2), with a tiny same-repo JPEG→PDF wrapper for the PDF path. Desktop keeps `window.print()`.** No pop-ups, no new window, no cross-origin script — fully same-document, honoring the standing directive.

1. **Vendor the library.** Add `js/vendor/html2canvas.min.js` (1.4.1, the exact version currently referenced). Load lazily on first use via same-origin `<script>` injection (CSP `'self'` allows it; keeps boot cost zero). Add the path to `PRECACHE` in sw.js (list at sw.js:25-80) so it works offline. Do NOT add to index.html's static script list.
2. **One capture pipeline** `capturePayslipCanvas()`: clone `.a4-sheet` (scale 1, off-viewport), `html2canvas(clone,{scale:2,backgroundColor:'#fff'})`, remove clone → canvas.
3. **Save as JPEG:** `canvas.toBlob('image/jpeg',0.92)` → `new File([blob],'{docNumber}.jpg')` →
   - if `navigator.canShare && navigator.canShare({files:[file]})` → `navigator.share({files:[file], title:'Payslip …'})`. On iOS standalone (iOS 15+; fleet is current) this opens the native sheet: **Save Image, Save to Files, AirDrop, Messages, Print** — the reliable path, and it's user-visible success.
   - else (desktop/Android fallback) → anchor download with `URL.createObjectURL` + `revokeObjectURL` (never data-URLs).
4. **Print / Save PDF:**
   - **iOS standalone** (detect: `navigator.standalone === true` or `matchMedia('(display-mode: standalone)')` + iOS UA): capture → JPEG bytes → wrap in a single-page A4 PDF via a new ~80-line dependency-free helper `window.jpegToPdf(jpegArrayBuffer, pxW, pxH)` in `js/pdf-lite.js` (a JPEG is embedded in PDF as a DCTDecode XObject verbatim — no encoding work; page 595.28×841.89pt, image fitted inside 28pt margins) → `File('{docNumber}.pdf','application/pdf')` → share sheet (user picks Save to Files / Print / Mail). Multi-page: one canvas slice per 1123px-equivalent → one PDF page each.
   - **Everything else:** keep `window.print()` — the existing confidentiality-scoped print CSS (hr.js:3542-3547) and styles.css print blocks already work in desktop browsers.
   - If share is unavailable AND standalone (old iOS): last-resort `window.print()` attempt + a toast telling the user to use Save as JPEG.
5. **Robustness fixes:** wrap both handlers in try/catch/finally — always restore button label/disabled; surface failures via `Notifs.showToast(...,'error')` (plain text, per the emojiIcon-sink rule).

**Why not the alternatives:** a clean print document via `window.open()` violates the no-pop-ups directive and is equally broken in standalone; printing via a hidden iframe (`iframe.contentWindow.print()`) still routes through the same broken standalone print path; adding cdnjs to CSP fixes only failure #1 and leaves offline + supply-chain exposure; jsPDF is ~350KB vendored for what 80 deterministic lines do.

**Files touched:** js/vendor/html2canvas.min.js (new), js/pdf-lite.js (new — add to index.html script list before hr.js loads OR lazy-load same as html2canvas; spec: lazy-load both), sw.js PRECACHE (+2 entries), js/screens/hr.js (renderPayslipPage buttons + downloadPayslipJPEG rewrite + new sharePayslipPDF), index.html (only if scripts/ci-invariants.sh's PRECACHE check requires listing — verify; lazy-load means index.html likely untouched).

**Edge cases:** share cancelled by user → `AbortError`, swallow silently; `canvas.toBlob` null on huge canvases → cap scale to 2 and fall back to scale 1 with a toast; Print-All (hr.js:1774) keeps `window.print()` on desktop and gets a "Share each payslip individually on iPhone" hint (batch-PDF is a follow-up, not in scope); logo is same-origin (`icons/barro-kitchens.png`, config.js:1627) so no CORS taint.

---

## 5. ASK 5 — Disburse → notify employee + give them their payslip

### What exists (important — less is missing than assumed)
- `disbursePayRun` already freezes the owner-readable mirror `salary_history/{uid}_{month}` (departments.js:1917-1952) **including** statutory IDs (1932) and hrNote (1948), and already sends a `type:'payroll'` notification (departments.js:2153-2156) which `_navigateFromNotif` already routes to `personal-finance` (js/notifications.js:156).
- **firestore.rules change: NONE REQUIRED for self-read.** firestore.rules:814-817 already grants read when `resource.data.userId == request.auth.uid`. The owner-filtered list query (`where('userId','==',uid)`) used by `payslipYtdMonthly` (hr.js:3377) is provably constrained and passes; the composite index exists (firestore.indexes.json:45-51, userId ASC + month DESC). `userId` is always written by the freeze (departments.js:1922), so the missing-field-throw footgun doesn't apply.
- Employee already has a payslip button — but current-month only (dashboards.js:2728-2746).

### What's actually missing → design
1. **"My Payslips" list (personal-finance area).** In `renderPersonalFinance`'s existing salary-history table (dashboards.js:2570, `.sal-hist-row`), add a per-row **"View payslip"** button (every row IS a disbursed month). Handler: `toPayslipModel({...row, uid, month:row.month},'monthly')`, `official=true`, fill `employee.name/idNumber/department` from userProfile as the my-payslip-btn handler does (dashboards.js:2743), `ytd = payslipYtdMonthly(uid, year-of-row)`, then `renderPayslipPage(model, ()=>navigateTo('personal-finance'))`. Rename `my-payslip-btn` label to "Current Month Payslip". Employees get NO edit button (§1 gate) and the share/save buttons of §4 work for them identically.
2. **Notification deep-link to the month.** Upgrade the disburse notification (departments.js:2153-2156):
   - body: `Your {monthLabel} pay of ₱{finalPay} has been disbursed. Tap to view your payslip.` — keep `dedupKey: payroll-disbursed-{uid}-{month}` (idempotent resume-safe, matches the disbursing-resume path).
   - add `link:'personal-finance'` and a new payload field `month: month`.
   - `Notifs.send` (js/notifications.js:488): accept + persist `month`.
   - `_navigateFromNotif` (js/notifications.js:133): for `type==='payroll'` with a `month`, call `navigateTo('personal-finance')` then (after render) auto-open that month's payslip — implement via `window.renderPersonalFinance(currentUser, currentRole, { openPayslipMonth: month })`; the function already takes `opts`.
   - **firestore.rules diff (the ONE rules change in this overhaul)** — the notifications create allowlist (firestore.rules:307) must admit the new field or every disburse-notify write is denied:
     ```diff
     -        && request.resource.data.keys().hasOnly(['title','body','icon','type','link','read','createdAt','dedupKey','taskId','chatId','senderUid'])
     +        && request.resource.data.keys().hasOnly(['title','body','icon','type','link','read','createdAt','dedupKey','taskId','chatId','senderUid','month'])
     ...
     +        && isBoundedString(request.resource.data.get('month', ''), 7)
     ```
     Deploy via `~/.npm-global/bin/firebase deploy --only firestore:rules` (git push does NOT ship rules). Re-`git diff firestore.rules` immediately before deploying (concurrent-session rule).
     **Ordering constraint:** ship the rules change BEFORE the js change goes live, or the disburse notify loop throws (it's inside `Promise.all` at departments.js:2153 — a rules denial there would surface as a disburse error AFTER money moved; also wrap that notify block in try/catch as hardening so notifications can never fail a disbursement post-money).
3. **Read-only rendering from the frozen doc** — already correct: `toPayslipModel` monthly branch reads the exact salary_history field set (hr.js:3256-3295); `official=true` suppresses the PROJECTION badge. Verify `finalPay` precedence (hr.js:3282 `source.finalPay ?? …`) — mirror writes `finalPay` (departments.js:1928), so the frozen number always wins over recomputation. Good.

**Files touched:** js/screens/dashboards.js (row button + openPayslipMonth opt), js/departments.js (notification payload + try/catch), js/notifications.js (send field + nav routing), firestore.rules (allowlist), firestore.indexes.json (none — index exists).

**Edge cases:** months disbursed before this ships have no `month` on their notification — the plain `personal-finance` route still works; employees with zero salary_history (new hires) see the existing projection path unchanged; weekly workers (`worker_profiles`, mostly no login) are out of scope — flag as follow-up: `payslips` collection owner-read for `linkedUid` workers.

---

## 6. The statutory-0 data bug (root cause + fix)

**Symptom:** payroll list shows SSS 600 / PhilHealth 300 / Pag-IBIG 200; the payslip shows 0.00 for all three.

**Root cause — the projection payslip path bypasses the pay engine entirely.**
- The roster's live-preview branch (no computed run yet) displays `u.sss || computeStatutory(...).ee.sss` — hand-typed value or the statutory-table **suggestion** (hr.js:1081-1085). The 600/300/200 the owner sees are those suggestions (nothing hand-typed on `payroll/{uid}`).
- The roster's payslip button, in the same no-run case, builds the model from the **raw merged user+payroll doc**: hr.js:1736-1741 `toPayslipModel({ ...emp, uid:emp.id, month, base:emp.salary },'monthly')`. `toPayslipModel` only reads stored fields (`g(source,'sss')`, hr.js:3259) and never calls `computeStatutory`/`computePayLine` → absent hand-typed values come through as **0**, and `net` (hr.js:3282) is silently overstated by the whole statutory total. Same-class bug at dashboards.js:3056 (worker-profile monthly fallback builds a bare object).
- The "PROJECTION" badge (`official=false`, hr.js:3404) is display-only — not involved. The "(D6)" string in the header is the unrelated `brandEntity('bir').registration` placeholder (§2). Frozen runs computed after WS21 carry correct statutory (money-core.js:73-80), and the D10 gate (departments.js:1870-1879) blocks disbursing on unverified tables — so **disbursed** payslips with zeros can only be pre-WS21 history (leave as historical truth; never retro-edit).

**Fix:** route every monthly projection through the ONE engine, exactly as dashboards.js:2737-2741 already does:
`const line = window.computePayLine(emp, { month, policy:'flat' }); model = toPayslipModel({...line, uid:emp.id, month}, 'monthly');`
at hr.js:1738-1741 and dashboards.js:3056. Optionally pass `caPlan` from the roster's prefetched `_planByUser` so the CA section matches the roster too. This changes NO stored money — projections are display-only previews; the frozen Compute path already used `computePayLine`.

**Files touched:** js/screens/hr.js:1736-1742, js/screens/dashboards.js:3053-3058.

---

## 7. Consolidated files-touched summary

| File | Sections |
|---|---|
| js/screens/hr.js | §1 edit panel, §2 docNumber/placeholders, §3 sheet wrapper + fitA4Sheet, §4 capture/share rewrite, §6 projection fix |
| js/screens/dashboards.js | §5 My Payslips row button + openPayslipMonth, §6 worker-profile projection fix |
| js/departments.js | §5 disburse notification payload + notify try/catch |
| js/notifications.js | §5 `month` field + nav routing |
| js/letterhead.js | §2 `suppressRegistration` opt (additive) |
| css/styles.css | §3 `.a4-stage`/`.a4-sheet` + print resets |
| js/vendor/html2canvas.min.js, js/pdf-lite.js | §4 (new) |
| sw.js | §4 PRECACHE +2 (CACHE_VER auto-bumps on commit — do not hand-edit) |
| firestore.rules | §5 notifications allowlist ONLY (deploy separately, re-diff first) |
| index.html | likely none (lazy-load both new scripts); verify scripts/ci-invariants.sh expectations |

Suggested implementation order (each independently shippable): §6 → §2 → §3 → §4 → §5 → §1.

---

## 8. Money-sensitivity flags (implementer MUST re-read before each section)

1. `js/money-core.js` is untouchable. All fixes are render-side or route-to-existing-editor.
2. No edit UI may write money fields to `salary_history` or any `pay_runs` line — identity whitelist only (§1). pay_runs disbursed-immutability is already rules-enforced (firestore.rules:881-909); do not weaken it.
3. §6 changes projection DISPLAY only; verify with a before/after that a computed run's payslip is byte-identical.
4. §5's rules deploy must precede the JS deploy; wrap the disburse notify loop in try/catch so a notification failure can never abort/poison a disbursement that already moved money.
5. The confidentiality print scope (hr.js:3542-3547) must survive the §3/§4 refactor — printing ONE payslip must never leak the underlying roster.
6. `git stash`/reset are forbidden in this tree; verify in a scratch copy.

---

## 9. Verification checklist

- [ ] **Statutory:** live-preview month → open payslip → SSS/PhilHealth/Pag-IBIG/Tax match the roster row exactly; net matches roster net; computed-run payslip unchanged vs before.
- [ ] **DocNumber:** monthly shows `PS-YYYYMM-<empId>`; weekly shows `PS-W-YYYYMMDD-<BI-W-###>`; no raw uid/doc-id anywhere on the document; JPEG/PDF filenames clean.
- [ ] **Header:** no "(D6)" placeholder line; long entity name doesn't collide with the doc block at 794px; blank IDs show "— not on file".
- [ ] **A4:** iPhone (375px, standalone) shows a centered scaled white sheet, no horizontal scroll; rotate → rescales; dark + Astral themes → sheet stays light; desktop shows full-size sheet.
- [ ] **Print/Save:** iPhone standalone: Save as JPEG → share sheet → Save Image works; Print/Save PDF → share sheet → Save to Files produces a valid 1-page A4 PDF (opens in Files/Acrobat); AirPrint from the sheet works. Desktop Chrome/Safari: Print → only the payslip in preview (confidentiality check: open from roster, verify roster is NOT in the print). Error path: kill network mid-capture → button restores, error toast, no stuck "Generating…". Offline (SW): vendored script loads from cache.
- [ ] **Disburse flow (staging month):** disburse → each employee gets the notification; tapping it lands on personal-finance and auto-opens that month's payslip; employee's My Payslips lists all disbursed months; employee sees no Edit button; a second employee's payslip is NOT readable (rules: try fetching another uid's salary_history doc → denied).
- [ ] **Edit panel:** finance edits TIN on a disbursed month → payroll/{uid} AND salary_history both updated, payslip re-renders with the TIN, money fields byte-identical; money section shows the correct route per state; secretary sees view-only.
- [ ] **Rules:** emulator or targeted prod test of the notifications create with `month` present AND absent (old clients must still pass). `node --check` every edited JS file; console clean on boot.

---

## 10. Biggest risks

1. **Rules/JS deploy ordering (§5)** — wrong order breaks disburse-time notifications inside the money path; mitigated by try/catch + deploy sequence.
2. **html2canvas fidelity** on the letterhead (flex + borders) — validate the clone-capture early; if output is poor, fallback plan is drawing the sheet via the print pipeline only and shipping share-PDF from a server-less canvas render of a simplified template (decision point, escalate).
3. **iOS Web Share quirks** — `canShare({files})` false on very old iOS; the fallback chain must be exercised on a real device before push (Neil's iPhone is the acceptance environment).
4. **Shared letterhead regression** — `suppressRegistration` must default off; quote/BIR docs must render byte-identical.
5. **Concurrent-session tree** — multiple agents edit live; one agent per file per §7, `git diff --cached` before commit (version-hook re-stage footgun).
