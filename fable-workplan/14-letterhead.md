# Workstream 14 — Shared Document Letterhead Engine

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

SCOPE (V12-PLAN.md, repo root). Workstream 14 itself: "Shared document letterhead engine — one branded header/footer component (logo, registered name, address, TIN, serial, date, signature blocks) + print stylesheet; ALL printables adopt it. Per-department printable library listed below." The printable library table (V12-PLAN.md, section "Per-department printable documents ... workstream 14") lists ~9 departments x 3-6 doc types each (Official Receipt, Sales Invoice, Downpayment Billing Invoice, SOA, Financial Statements, Books of account, Payslips, Remittance reports, Check voucher, Quotation, Sales Order confirmation, Delivery Receipt, RFQ letter, PO, Receiving report, Work Order traveler, QC report, COE, Employment contract, ID cards, 2316, Leave form, Project brief, Drawing transmittal, Campaign brief, Bid checklist, AEC contact sheet, etc.) — almost none of these exist as print generators yet. Only a handful of real print flows exist today; audited below with exact line numbers re-grepped just now (repo currently on branch v12, files already shifted once by Phase-1 commits).

Workstream 9 (BRAND module) is NOT started — `grep -rn "window.BRAND" js/*.js index.html` returns nothing. V12-PLAN.md states workstream 9 as: "BRAND module + full rename sweep — one window.BRAND drives title, splash, login, sidebar, manifest.json, sw, track.html, quote builder, all print headers." That line explicitly names "all print headers" as something workstream 9's BRAND object drives — so 14 has no canonical brand/company-info source yet; the plan itself implies 9 and 14 overlap.

=== THE BEST CURRENT PRINTABLE: quote-builder-v2.html ===
This is the only print flow with a real print-grade header AND the print-CSS fixes that actually work at scale (confirmed by recent git log: `aab024a Quote print: stop long quotes leaving page 1 blank`, `dc0fafe Auto-fit also covers .stat-num cards`).

Header markup (quote-builder-v2.html:420-438):
```
<div class="print-header" id="printHeader">
  <div style="display:flex;align-items:flex-start;gap:12px;">
    <img id="phLogo" style="height:56px;display:none;flex-shrink:0;margin-top:1px;">
    <div id="phDetails">
      <div id="phName" style="font-size:16pt;font-weight:900;color:#1E3A5F;letter-spacing:.4px;line-height:1.1;"></div>
      <div id="phSub" style="font-size:9pt;color:#555;margin-top:2px;"></div>
      <div id="phAddr" style="font-size:9pt;color:#555;margin-top:1px;"></div>
      <div id="phContact" style="font-size:9pt;color:#555;margin-top:1px;"></div>
    </div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:14pt;font-weight:900;color:#1E3A5F;letter-spacing:1px;">PRICE QUOTATION</div>
    <div id="phQuoteNo" style="font-size:11pt;font-weight:700;color:#333;margin-top:4px;"></div>
    <div id="phDate" style="font-size:9.5pt;color:#555;margin-top:2px;"></div>
    <div id="phValid" style="font-size:9.5pt;color:#555;margin-top:1px;"></div>
    <div id="phSalesperson" style="font-size:9.5pt;color:#555;margin-top:1px;"></div>
    <div id="phAgentTag" class="agent-tag" style="display:none;">AGENT COPY — CONFIDENTIAL</div>
  </div>
</div>
```
Note: `#phLogo` exists in markup but is NEVER given a `src` anywhere in the file (`grep -n phLogo quote-builder-v2.html` returns only this one declaration line) and stays `display:none` forever — a dead placeholder, no logo actually renders on the "best" printable.

Company data populated at runtime from a local `CO` object (quote-builder-v2.html:939-949):
```
const CO = {
  BK:{name:'BARRO KITCHENS',sub:'Commercial Kitchen One-Stop-Shop  •  Design · Fabricate · Install  •  by Barro Industries OPC',
    addr:'La Union  |  Baguio City  |  Manila',contact:'09276836300  |  hello@barroindustries.com',
    sig:{name:'NEIL BARRO',title:'President, Barro Industries OPC'},nav:'BARRO <span>KITCHENS</span>',code:'BK',
    thanks:'Thank you for considering Barro Kitchens...',
    creds:'Barro Industries OPC  •  DTI / BIR Registered  •  hello@barroindustries.com  •  0927 683 6300  •  La Union | Baguio | Manila'},
  BS:{name:'BRILLIANT STEEL CORPORATION',sub:'',addr:'Pasig City, Metro Manila',contact:'09276836300',
    sig:{name:'GERALD CHAN',title:'President, Brilliant Steel Corporation'},nav:'<span>BRILLIANT</span> STEEL',code:'BS',
    thanks:'Thank you for considering Brilliant Steel Corporation...',
    creds:'Brilliant Steel Corporation  •  SEC / BIR Registered  •  Pasig City, Metro Manila  •  0927 683 6300'},
};
```
Note there is NO TIN field anywhere in this object for either company. A third company key `CO.PT` is injected at runtime only for generic partner portals (quote-builder-v2.html:1120-1129), built from URL query params (`pcoName`, `pcoContact`, `pcoSig`) — no address/TIN either.

Doc-serial number is built client-side (quote-builder-v2.html: function `buildQuoteNo`, line 1263-1276): `` `${co}-${loc}-${mth}-${dt}-${seq}-R${rev}` `` e.g. `BK-XX-XX-260709-001-R1`. `seq` and `rev` come from `autoComputeCustRev()` (line 1311-1328), which counts the current user's OWN previously-filed quotes for that client via a client-side Firestore query (`db.collection(coll).where('createdBy','==',auth.currentUser.uid).get()`) — i.e. NOT a globally atomic sequence; two salespeople quoting the same day get independent, potentially colliding sequences.

Signature block (quote-builder-v2.html:887-901) — a 2-column grid: "Conforme — Accepted by Client" (blank signature line + client name placeholder) vs "Reviewed & Approved by" (populated from `CO[co].sig.name` / `.title`). Footer (quote-builder-v2.html:907-911): `print-footer` div with `#pfThanks` (marketing thank-you line) and `#pfCreds` (compact company credentials line), both sourced from the same `CO` object's `thanks`/`creds` strings.

Print CSS — the hard-won part (quote-builder-v2.html:329-386), inside `@media print`:
```
  /* Sections must FLOW across pages — a tall section (the items table) with
     page-break-inside:avoid was pushed whole to page 2, leaving page 1 blank
     except the header. Rows/category groups keep their own avoid (below), so the
     table stays readable while flowing continuously at any print scale. */
  .section{...page-break-inside:auto;break-inside:auto;}
  ...
  .print-header{display:flex!important;justify-content:space-between;align-items:flex-start;
    margin-bottom:8px;padding-bottom:7px;border-bottom:2.5px solid #1E3A5F;}
  th{padding:3px 6px;font-size:8pt;background:#1E3A5F!important;color:#fff!important;}
  ...
  /* repeat column headers on every printed page; keep rows + category groups intact */
  thead{display:table-header-group;}
  tr,.cat-row,.subtotal-row{page-break-inside:avoid;break-inside:avoid;}
  ...
  .sig-row{margin-top:20px;page-break-inside:avoid;}
  ...
  @page{margin:11mm 10mm 7mm;}
```
This is a deliberate two-tier page-break strategy: the outer `.section` wrapper is explicitly `auto` (allowed to split across a page boundary) while `thead` repeats via `display:table-header-group` and individual `tr`/`.cat-row`/`.subtotal-row`/`.sig-row` are `avoid` (kept whole). The comment documents the exact bug this fixes (a tall table with a blanket `page-break-inside:avoid` on its container pushed the whole thing to page 2, leaving page 1 blank). This pattern is NOT duplicated anywhere else in the codebase.

Delivery mechanism for this print: it's an in-page CSS toggle. `.print-header{display:none;}` normally, `@media print{.print-header{display:flex!important;}.no-print{display:none!important;}}` (quote-builder-v2.html:387-388), triggered by a plain `window.print()` on the SAME document (via `doPrint()`/`doPrintAgent()`, quote-builder-v2.html:2686/2697). No new window is opened.

=== CONTRAST 1: Payslip print — buildPayslipHTML (js/departments.js:4256-4340+) ===
This is a wholly separate, self-contained HTML document opened in a NEW window via `window.open()` + `document.write()` — a different technical pattern entirely from quote-builder-v2's in-page toggle.
Header (js/departments.js:4304-4316):
```
  <div class="header-top">
    <img src="icons/barro-industries.png" class="company-logo" onerror="this.style.display='none'" alt=""/>
    <div>
      <div class="company-name">${escHtml(co.toUpperCase())}</div>
      <div class="company-sub">
        NEILBARRO STEEL & METAL FABRICATION SERVICES<br/>
        PUROK 6, CARLATAN, 2500, CITY OF SAN FERNANDO, LA UNION, PHILIPPINES<br/>
        CONTACT: NEIL BARRO, 0927-683-6300<br/>
        TIN: 951-145-613-000
      </div>
    </div>
  </div>
```
Contrast with quote-builder-v2: (1) DOES include a TIN (951-145-613-000) and a full postal address — quote-builder-v2 has neither. (2) The registered/legal name shown is "NEILBARRO STEEL & METAL FABRICATION SERVICES" (a DTI sole-proprietorship trade name), not "Barro Industries OPC" (the SEC OPC entity used in quote-builder-v2 and the app's own Company-info tab, js/modules.js:1770 "Barro Industries OPC is a SEC-registered One Person Corporation"). Three different legal-entity identities now appear across just two documents. (3) The `<img>` DOES get a real `src` (`icons/barro-industries.png`) with an `onerror` fallback to hide — logo actually attempts to render here, unlike quote-builder-v2's dead `#phLogo`. (4) No doc-serial/reference number of any kind for the payslip itself — only Pay Period + Pay Date (js/departments.js:4343-4351). (5) Color scheme is `#1a237e` (different navy than quote-builder-v2's `#1E3A5F`). (6) Signature block is only implicit — no explicit `sig`-block markup was found matching quote-builder-v2's 2-box Conforme/Approved pattern in this generator (worth Fable re-checking the tail of the function past line ~4600 for a signature section). (7) Print CSS is 5 lines (js/departments.js:4288-4293), just hides the on-screen export toolbar — no page-break-inside/thead-repeat handling at all, so a multi-page payslip (long earnings table) is exposed to the exact "blank page 1" bug the quote print just fixed.

=== CONTRAST 2: Purchase Order print — printPurchaseOrder (js/departments.js:12651-12766) ===
Header (js/departments.js:12716-12728):
```
  <div class="htop">
    <img src="${logoUrl}" class="logo" onerror="this.style.display='none'" alt=""/>
    <div>
      <div class="cname">BARRO INDUSTRIES</div>
      <div class="csub">Barro Industries OPC · DTI / BIR Registered<br>hello@barroindustries.com · 0927 683 6300 · La Union | Baguio | Manila</div>
    </div>
    <div class="title">
      <div class="t">Purchase Order</div>
      <div class="no">${e(p.prNo || p.rfqNo || '')}</div>
      <div class="dt">Date: ${e(issuedStr)}${p.neededBy ? `<br>Needed by: ${e(p.neededBy)}` : ''}</div>
    </div>
  </div>
```
Contrast: (1) Legal name shown is "BARRO INDUSTRIES" / "Barro Industries OPC · DTI / BIR Registered" — NO TIN number at all (payslip has one, quote has none, this has the DTI/BIR label but no actual TIN digits). Three documents, three different completeness levels for the same fact. (2) Uses `p.prNo || p.rfqNo` as the doc number — reuses whatever RFQ/PR id already exists on the purchasing doc rather than a dedicated serial scheme (no `-R` revision suffix like quotes, no counter). (3) Color: hardcodes `#1E3A5F` — coincidentally the same hex as quote-builder-v2's `--dark-blue` CSS var, but as a literal, not shared. (4) Logo `src` is computed via `location.origin + location.pathname.replace(...) + 'icons/barro-industries.png'` (js/departments.js:12657) — a THIRD way of referencing the same logo file (payslip uses a bare relative path, quote-builder never sets one). (5) Signature block (js/departments.js:12755-12758) is 2-column "Prepared by — Purchasing" / "Approved by — President, Barro Industries OPC" — different labels/roles than the quote's "Conforme/Reviewed" pair. (6) Footer (js/departments.js:12759): `"Barro Industries Operations System · Generated {timestamp}"` — a plain system-audit footer, not the marketing thank-you+creds footer quotes use. (7) No page-break-inside/thead-repeat CSS at all — same multi-page risk as the payslip.

=== CONTRAST 3: Billing Invoice — buildBillingInvoiceHTML (js/departments.js:6749-6844ish) ===
Header is a near copy-paste of the payslip's (js/departments.js:6795-6806): same "BARRO INDUSTRIES" / "NEILBARRO STEEL & METAL FABRICATION SERVICES ... TIN: 951-145-613-000" block, same `icons/barro-industries.png` `onerror` pattern, same `#1a237e` navy — but it is a hand-duplicated copy, not a shared call, so any future TIN/address correction has to be made in at least two places already (and a third at app.js, see below). Doc number here is generated as `'INV-'+today().replace(/-/g,'')+'-'+String(seq).padStart(3,'0')` (js/departments.js in `openJobBillingInvoiceModal`, seq = `(p.invoices||[]).length+1`) — a FOURTH distinct serial scheme (vs quote's `CO-LOC-MTH-date-seq-Rn` and PO's bare `prNo`), scoped to the array length of one `job_projects` doc's `invoices` field (fine for that one project, but not a global sequence).

=== CONTRAST 4 (bonus — legacy duplicates found while grepping `window.print(`) ===
- `js/app.js:4666-4685` `printPayslip()` and `js/app.js:4970-5004` `printWorkerPayslip(uid,name,preloaded)` are two near-identical, separate payslip generators (self-service "my payslip" and manager "view worker payslip") that compute net pay from the `users` doc's `salary/allowance/deductions` fields via an old KPI x Attendance performance-multiplier model — NOT from `payroll/{uid}` (the documented single source of truth per project memory) and NOT from `pay_runs`. Both use yet another company header: `<div class="company">BARRO INDUSTRIES</div><div class="company-sub">Employee Payslip</div>` (app.js:4673 / 4992) with NO logo, NO TIN, NO address, and a 3-column signature row "Prepared by: Finance / Noted by: HR / Approved by: President" (app.js:4680, 4999) — a THIRD signature-block shape (2-col Conforme/Approved in quotes, 2-col Prepared/Approved in POs, 3-col here).
- `js/departments.js:5550-5628` `printBKQuote(lines,q)` and `js/departments.js:9096-9112` `printQuote(lines,q)` are two more standalone quote-print generators (quick "print from list" actions, separate from quote-builder-v2.html and from each other). `printBKQuote` uses a gold/tan palette (`#c8a45a`) totally unlike the dark-blue scheme everywhere else, has NO logo, NO TIN, NO signature block, and interpolates `q.quoteNumber` (line 5592), `q.date` (line 5593) and `q.validUntil` (line 5594) into the HTML WITHOUT `escHtml()` (only `q.scope` at line 5595 is escaped) — an escHtml-discipline gap in a live print generator. `printQuote` is even barer: no logo, no TIN, no serial number, no signature block at all, just "Quote for: {name}, Date: {date}" (js/departments.js:9105, `q?.date` also unescaped).
- `js/departments.js:7642-7710ish` `renderBSQuoteBuilder(...)` embeds a THIRD full quote-builder UI directly inside departments.js (distinct from the quote-builder-v2.html iframe), with its own `.bs-print-header` (js/departments.js:7693-7704) using yet another color (`#37474f`) and its own copy of `icons/barro-industries.png`. This strongly overlaps with V12-PLAN workstream 31's note "delete ~1,800 lines of dead builder code" — Fable should treat this as probably-legacy code workstream 31 will remove, not a fourth letterhead target to build for.

=== A REAL, REUSABLE SERIAL-NUMBER PRECEDENT ALREADY EXISTS ===
`js/app.js:440-446` (`loadUserProfile`) generates `employeeId` via an atomic Firestore transaction against a dedicated counter doc:
```
const counterRef = db.collection('_counters').doc('employees');
const empId = await db.runTransaction(async t => {
  const c = await t.get(counterRef);
  const next = (c.exists ? c.data().count : 0) + 1;
  t.set(counterRef, { count: next }, { merge: true });
  return `BI-${bizYear()}-${String(next).padStart(3,'0')}`;
});
```
`firestore.rules:112-115` already has a rule for this collection: `match /_counters/{docId} { allow read, write: if isAuth() && isAdmin(); }`. This is the ONLY race-safe, globally-atomic numbering scheme in the whole app; every doc-serial scheme surveyed above (quotes, invoices, POs) is instead either a client-side count-my-own-docs query or an array-length lookup, neither of which is safe under concurrent writers.

=== NO SHARED PRINT CSS EXISTS TODAY ===
`grep -n "@media print\|page-break\|break-inside\|@page" css/styles.css` returns nothing — the app's one shared stylesheet has zero print rules. Every one of the ~7 generators above embeds its own full `<style>` block (or, for quote-builder-v2, its own `@media print` section inside the main stylesheet). This matters architecturally: the new-window generators (`window.open('','_blank')` + `document.write()`) never load `css/styles.css` or any app `<link>` at all, so a shared letterhead CANNOT simply be "a class added to styles.css" for roughly half of today's print call sites — it has to be inlinable HTML+CSS a JS function can hand back as a string.

## Data model

No new collections exist yet for workstream 14 itself — this is grounding on what data the letterhead will need to pull FROM, based on real code read just now:

- `users/{uid}` — has `employeeId` (format `BI-{bizYear}-{seq}`, generated via `_counters/employees` transaction, js/app.js:440-446), `displayName`, `role`, `departments[]`. No TIN/SSS/PhilHealth/PagIbig fields live here (those are on `worker_profiles`, see below), and no company/entity assignment field.
- `worker_profiles/{id}` (HR module) — read by `collectPayslipData()` (js/departments.js:4165-4238): has `idNumber`, `jobTitle`, `department`, `tinNum`, `ssNum`, `phNum`, `pagibigNum`, `caBalance`. This is the ONLY place a per-employee TIN is actually stored/used, and it feeds the ONE payslip generator (`buildPayslipHTML`) that prints a company TIN.
- `payroll/{uid}` — per project memory ("Payroll collection architecture: pay lives in payroll/{uid} not users docs") this is the documented source of truth for pay, but NONE of the 3 payslip-print code paths surveyed (`buildPayslipHTML`/`collectPayslipData`, `printPayslip`, `printWorkerPayslip`) actually reads from it — `collectPayslipData` pulls values typed into an HR form, `printPayslip`/`printWorkerPayslip` read `users/{uid}.salary/allowance/deductions`. This is a real gap workstream 24 (not 14) needs to close, but 14's shared component must not assume a single clean data source exists yet.
- `pay_runs` — per project memory (Compute→Verify→Disburse), not currently wired into any print function found by grep (`grep -n "pay_runs" js/departments.js | grep -i "print\|payslip"` returns nothing).
- `job_projects/{id}.invoices[]` — array field, each entry shaped `{no, date, due, billTo, desc, amount, notes, contractAmount, paidToDate, balanceBefore, projectName, projectNo, issuedBy, createdAt}` (js/departments.js `openJobBillingInvoiceModal`, ~line 11375-11392), appended via `db.runTransaction` for atomicity; `no` is `'INV-'+today().replace(/-/g,'')+'-'+seq` where `seq = (p.invoices||[]).length+1`. Also mirrors into `job_projects/{id}.documents[]` (`{type:'Billing Invoice', ref:inv.no, at, by}`) and `.timeline[]`.
- `bk_quotes` / `bs_quotes` collections — queried client-side in `autoComputeCustRev()` (quote-builder-v2.html:1311-1328) via `.where('createdBy','==',auth.currentUser.uid).get()`, used only to derive the next `qnoSeq`/revision — not used to look up a global next-serial.
- Purchasing docs (shape used by `printPurchaseOrder`, js/departments.js:12651-12766): `{prNo, rfqNo, items:[{desc,qty,unit,unitPrice}], total, convertedAt, convertedByName, createdByName, supplier, title, deliverTo, requestingDept, notes, neededBy}`. No dedicated serial/counter — `prNo`/`rfqNo` is whatever purchasing already assigned upstream.
- `_counters/{docId}` — generic atomic-increment collection, currently only used for `_counters/employees` (`{count: n}`). Already covered by firestore.rules:112-115 (admin-only read/write). This is the one existing pattern a new doc-serial scheme could extend (e.g. `_counters/quote_BK`, `_counters/invoice`, `_counters/po`) instead of inventing a fifth ad hoc scheme.

## Constraints — must respect

- Script load order is load-bearing (CLAUDE.md): index.html loads Firebase/Chart.js/Lucide -> firebase-config.js -> config.js -> drive.js -> notifications.js -> departments.js -> app.js -> modules.js, all with `defer`. escHtml() is defined in js/modules.js:9 yet is called throughout departments.js and app.js (e.g. buildPayslipHTML at departments.js:4264) — this works today only because those calls happen inside functions invoked later at runtime (click handlers), never at top-level parse time. A new shared letterhead module must either slot into this same chain (add to index.html script list AND sw.js PRECACHE per CLAUDE.md) or live as functions attached to window from an existing file — it cannot be an ES import, there are no modules.
- Roughly half of today's print call sites (payslip, PO, billing invoice, BK/BS quick-quotes, inventory count form) use `window.open('','_blank')` + `document.write(fullHtmlString)` to build an entirely separate document — this new document loads NONE of the app's <link>/<script> tags, including css/styles.css. Any shared letterhead therefore cannot be delivered purely as CSS classes in styles.css; it must be produced as a JS function returning an inlinable HTML+<style> string usable inside a document.write() call, in addition to (or instead of) working as DOM/CSS for quote-builder-v2's in-page toggle pattern.
- The page-break-inside/break-inside/thead-repeat print-CSS pattern in quote-builder-v2.html:329-386 (especially lines 337-352) is a real, recently-landed bug fix (git log: aab024a 'Quote print: stop long quotes leaving page 1 blank') and is the ONLY place in the codebase with this protection — `grep -n "page-break\|break-inside" js/departments.js js/app.js` finds only one unrelated hit (departments.js:4481). Any shared print stylesheet MUST preserve this exact two-tier strategy (outer .section = page-break-inside:auto so it flows; thead repeats via display:table-header-group; individual tr/.cat-row/.subtotal-row/.sig-row = avoid) rather than re-introduce the blanket avoid that caused the original bug.
- escHtml() discipline (CLAUDE.md, defined js/modules.js:9): all user content must be escaped before insertion into innerHTML/document.write strings. A live generator already violates this — printBKQuote (js/departments.js:5592-5594) interpolates q.quoteNumber, q.date, q.validUntil unescaped (only q.scope at line 5595 is escaped), and printQuote (js/departments.js:9105) interpolates q?.date unescaped. A shared letterhead template is a chance to close this but the escaping must be applied explicitly per field by whoever calls the template — the template itself can't infer which inputs are user-controlled.
- Manila-time discipline (project memory: manila_time_helpers): use window.bizDate()/bizHour()/bizDow(), never raw toISOString(), for any date stamped onto a printed document. departments.js:11 already wraps this correctly (`function today() { return (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10)); }`) and billing-invoice serials rely on it; quote-builder-v2.html's buildQuoteNo (line 1268) falls back to `new Date().toISOString()` only when the date-picker field is empty, not bizDate() — worth flagging as a pre-existing (minor) inconsistency the letterhead work will touch.
- Idempotent/deterministic-ref discipline used elsewhere in the ledger (project memory: ledger is finance's single source of truth via deterministic refs SO-/EXP-/CRJ-/CDJ-/POCOS-/PAY-, comments at departments.js:1412, ~6179, ~11610, ~11632) is a precedent for how doc-serials 'should' behave, and a genuinely atomic, already-rules-covered counter mechanism exists at `_counters/{docId}` (js/app.js:440-446, firestore.rules:112-115) — any new serial scheme this workstream designs should be evaluated against that existing pattern rather than inventing a sixth ad hoc one.
- Firestore rules coverage (project memory: firestore-rules-collection-coverage): rules don't cascade or prefix-match; if this workstream introduces any new collection or subcollection (e.g. new `_counters/*` keys, or a `letterhead_config` doc), it needs an explicit `match` block in firestore.rules and a `firebase deploy --only firestore:rules` (git push alone does NOT deploy rules — firebase-deploy-rules memory).
- CACHE_VER in sw.js must be bumped on any .js/.css edit (CLAUDE.md) — auto-handled by the pre-commit hook per current setup, but if a NEW file (e.g. js/letterhead.js) is added it must also be added to index.html's script list AND sw.js's PRECACHE array by hand.
- Version stamps are auto-bumped by .git/hooks/pre-commit (CLAUDE.md) — do not hand-edit window.APP_VERSION or the vX.Y.Z strings.

## Open decisions — Fable resolves these

- [ ] Sequencing vs workstream 9 (BRAND): V12-PLAN.md states window.BRAND (workstream 9, not started) 'drives ... all print headers.' Does workstream 14's letterhead engine consume window.BRAND as a hard dependency (build 9 first, or build both together), or does 14 ship with its own interim company-info object now (duplicating quote-builder-v2's local `CO` map) that gets swapped for window.BRAND later? Tradeoff: building 14 first risks a second throwaway config object (there are already at least 4: quote-builder-v2's CO, the payslip's hardcoded strings, the PO's hardcoded strings, the billing invoice's hardcoded strings); waiting for 9 blocks 14 entirely.
- [ ] Which registered legal entity + TIN prints on which document type? Real strings found in the live code: 'Barro Industries OPC' (SEC-registered OPC, per js/modules.js:1770, used as the entity on quotes/PO/company-info tab), 'NEILBARRO STEEL & METAL FABRICATION SERVICES' with TIN 951-145-613-000 (a DTI sole-prop trade name, appears ONLY on payslips and billing invoices, js/departments.js:4310-4313 and :6800-6803), 'Barro Kitchens' (trademark/sub-brand under Barro Industries OPC), and 'Brilliant Steel Corporation' (a wholly separate partner entity, signed by Gerald Chan). This is a real BIR/compliance question, not a styling one — is the correct behavior one canonical entity+TIN per doc TYPE (e.g. all BIR-facing docs use the DTI trade name+TIN, all client-facing marketing docs use the OPC/trademark name), one per COMPANY/department, or does Fable need to surface this back to Neil as an open business question rather than silently picking one?
- [ ] Doc-serial-number scheme: four different, mutually incompatible schemes exist today — quotes use client-computed `CO-LOC-METHOD-YYMMDD-SEQ-Rn` (quote-builder-v2.html:1263-1276, seq/rev derived from a client-side query of the current user's own docs, racy under concurrent salespeople); billing invoices use `INV-YYYYMMDD-SEQ` scoped to one project's `invoices` array length (departments.js ~line 11376); POs reuse whatever `prNo`/`rfqNo` purchasing already assigned (no dedicated serial); payslips have no serial at all. Meanwhile a genuinely atomic, rules-covered counter pattern already exists (`_counters/{docId}` + `runTransaction`, js/app.js:440-446, used today only for employeeId). Should the letterhead engine standardize all doc types on `_counters`-backed atomic sequences (one counter doc per doc-type, e.g. `_counters/quote_BK`), keep each generator's existing scheme as-is (accept the collision risk), or something in between (e.g. atomic counters only for BIR-facing docs where a gap/duplicate number is a compliance problem)?
- [ ] Two incompatible technical delivery patterns for 'print' coexist: quote-builder-v2's in-page CSS-toggle (`.print-header`/`.no-print` classes + `window.print()` on the current document) vs. every other generator's new-window `document.write()` pattern. Should the shared letterhead be built as (a) a JS function that returns an HTML+`<style>` string, callable from both patterns (new-window callers document.write() it directly; the in-page caller injects it into a hidden container), (b) a pure DOM/CSS component requiring every generator to migrate to the in-page toggle pattern (a bigger rewrite), or (c) the reverse — migrate quote-builder-v2 to the new-window pattern for consistency with everything else? This is an architecture call, not a styling one.
- [ ] Logo handling: quote-builder-v2's `#phLogo` `<img>` exists in markup but is never given a `src` and stays `display:none` (dead code) — the 'best' current printable renders NO logo at all. Every other generator references `icons/barro-industries.png` with an `onerror` hide-fallback via three slightly different path constructions (bare relative path in payslip/invoice; `location.origin + location.pathname.replace(...)` in the PO). Should the shared letterhead always attempt the logo, and what should the fallback be when the image 404s or hasn't loaded yet at print time (icons/ path may not resolve the same way inside a `window.open('','_blank')` document, since it has no base href context) — blank space, a text monogram, or omit the logo slot entirely for now until workstream 9 supplies a real asset?
- [ ] Signature-block shape varies across today's generators: quote-builder-v2 uses a 2-column 'Conforme — Accepted by Client' / 'Reviewed & Approved by' grid (lines 887-901); the PO uses a 2-column 'Prepared by — Purchasing' / 'Approved by — President' grid (departments.js:12755-12758); the legacy app.js payslip generators use a 3-column 'Prepared by: Finance / Noted by: HR / Approved by: President' row (app.js:4680, 4999). Should the shared component support a variable count (2 or 3) of labeled signature slots per doc-type, or should Fable standardize on one fixed shape and require every doc type to fit it?
- [ ] Which of the >=3 duplicate payslip generators (departments.js buildPayslipHTML tied to worker_profiles manual HR entry; app.js printPayslip and printWorkerPayslip, both tied to the legacy users-doc KPI x Attendance performance-multiplier model, NOT payroll/{uid}) does the letterhead-engine call site target? Is picking/retiring the canonical payslip generator in scope for workstream 14 (which only owns the header/footer chrome), or strictly workstream 24's job ('ONE branded template') — and if 24's, should 14 simply wrap all three for now, accepting that two of them will likely be deleted shortly after?
- [ ] Which of the >=4 quote-print code paths (quote-builder-v2.html canonical; printBKQuote; printQuote; renderBSQuoteBuilder's inline bs-print-header, all in js/departments.js) should actually receive the shared letterhead? printBKQuote/printQuote/renderBSQuoteBuilder look like legacy 'quick print from list' duplicates that heavily overlap with V12-PLAN workstream 31's explicit note to 'delete ~1,800 lines of dead builder code' — should workstream 14 retrofit them anyway (in case they survive), skip them and let 31 delete them first, or is determining which is dead code itself blocked on 31's audit (i.e. sequencing: does 31 need to run before 14 touches any quote print path)?

## Risks / cross-workstream interactions

- ⚠️ Delivering the shared letterhead as CSS-only (added to css/styles.css) will silently fail to reach roughly half of today's print call sites, because those open a brand-new `window.open('','_blank')` document via `document.write()` that never loads the app's stylesheet — this would look like it works (quote print improves) while payslip/PO/invoice prints stay exactly as inconsistent as today.
- ⚠️ The page-break-inside/thead-repeat fix that JUST landed for quotes (git log: aab024a) is absent from every other generator (grep confirms). If workstream 14 ships a 'shared' letterhead that doesn't carry this fix into payslip/PO/invoice/inventory-count prints, the very first long payslip or long PO someone prints will reproduce the identical 'blank page 1' bug that was just fixed for quotes — a visible regression exactly where this workstream is supposed to be improving things.
- ⚠️ Heavy overlap with workstream 9 (BRAND module, not started): both are described in V12-PLAN.md as owning print-header company data. Building 14 without coordinating with 9 risks a second, later-discarded company-info config (there are already at least 4 hardcoded copies of company info across the files audited: quote-builder-v2's CO map, payslip's hardcoded block, PO's hardcoded block, billing invoice's hardcoded block).
- ⚠️ Heavy overlap with workstream 24 ('The payslip — ONE branded template ... monthly print buttons fixed (currently dead)') — that workstream is explicitly about consolidating the very payslip duplicates documented above (buildPayslipHTML vs printPayslip vs printWorkerPayslip) onto the letterhead engine. Building 14 in isolation risks Fable/Sonnet reshaping functions that 24 is about to substantially rewrite or delete.
- ⚠️ Heavy overlap with workstream 31 (quotation builder v3, 'delete ~1,800 lines of dead builder code') — printBKQuote/printQuote/renderBSQuoteBuilder are strong candidates for that deletion; retrofitting them with a shared letterhead now could be wasted work if 31 removes them shortly after, or could conflict if both workstreams touch departments.js's quote-print functions in the same window.
- ⚠️ Workstream 36 ('downpayment billing invoice document... letterhead, payment details/bank instructions') and workstream 33 ('AEC contact sheet... printable on letterhead') and workstream 39 (BIR suite: books of account, Financial Statement prints) all explicitly assume workstream 14 already exists and will be consumed by them — 14 is a genuine upstream dependency for at least 3 later Phase-4/5 workstreams' printable tables, so its output shape (function signature, parameters) needs to be generic enough for documents that don't exist yet (books of account, remittance reports, ID cards) not just the ones surveyed here.
- ⚠️ Compliance risk, not just code quality: three different legal-entity names and only one of them (the DTI trade name on payslips/invoices) carries an actual TIN. If the shared letterhead engine picks the wrong entity/TIN combination for a BIR-facing document type (e.g. an eventual Official Receipt or Sales Invoice, workstream 39), that's a real regulatory problem, not a cosmetic one — this should be flagged to Neil rather than silently resolved by whichever model builds this.
- ⚠️ escHtml gaps already exist in a live, shipped generator (printBKQuote, departments.js:5592-5594) — if the shared letterhead component doesn't enforce escaping at the template layer (or the call-site conversion doesn't add it), the rebuild could carry the existing XSS-shaped gap forward under a new, more 'official-looking' component.
- ⚠️ OneDrive concurrent-edit hazard (project memory: edit-tool-onedrive-mtime-race) — departments.js (~12.7k lines) and app.js (~7.8k lines) are both hot files for this workstream and are being edited live in this same OneDrive-synced folder; whoever implements Fable's spec should expect Edit-tool staleness failures on these two files specifically and plan for batched/atomic edits.
- ⚠️ If Fable's spec introduces a new `_counters/*` key or any other new collection for atomic doc-serials, it needs an explicit firestore.rules match (rules don't cascade/prefix-match, project memory) and a separate `firebase deploy --only firestore:rules` — easy to forget since `git push origin master` deploys the app but not rules.

## Files likely touched

`js/departments.js (buildPayslipHTML, buildBillingInvoiceHTML, printPurchaseOrder, printBKQuote, printQuote, renderBSQuoteBuilder, openInventoryCountForm — all current print/header code)`, `js/app.js (printPayslip, printWorkerPayslip — legacy payslip duplicates; possibly retired or redirected to the shared template)`, `quote-builder-v2.html (print-header markup/CSS lines ~329-438, 939-949, 1263-1338 — the reference implementation this workstream generalizes)`, `js/config.js (likely home for a shared company/letterhead config object, alongside DEPARTMENTS/ROLES, if not deferred entirely to workstream 9's window.BRAND)`, `css/styles.css (currently has zero @media print rules — any letterhead CSS meant for in-page-toggle call sites lives here; new-window call sites still need it inlined separately)`, `A plausible new file, e.g. js/letterhead.js (per the project's global-function-module convention) — if added, must be inserted into index.html's script list AND sw.js's PRECACHE array, per CLAUDE.md's script-load-order rule`, `sw.js (CACHE_VER bump — required on any .js/.css touch; PRECACHE update if a new file is added)`, `index.html (new <script defer> tag if a new letterhead.js file is introduced; version strings are auto-bumped, do not hand-edit)`, `firestore.rules (only if a new counters/sequence or config collection is introduced for doc-serial numbering)`

## Expected deliverable format

> Fable's output for this workstream should let Sonnet implement it mechanically with no further judgment calls. Concretely, ask for:
> 
> 1. A resolved company/entity data model FIRST (the open decision on which legal name + TIN prints on which doc type) — either an explicit mapping table (doc-type -> entity/TIN/address) or an explicit note that this ships as a placeholder pending workstream 9 / Neil's confirmation, with the exact interim values to use so nothing is left ambiguous.
> 2. Exact function signature(s) for the shared letterhead, e.g. something like `buildLetterheadHTML({ docType, docTitle, docNumber, dateLabel, companyKey, subBrand, signatures: [{label, name, title}], footerNote }) -> { headerHTML, footerHTML, printCSS }` (or whatever shape Fable decides) — with the full implementation body, not a stub, since Sonnet should not have to invent the internals.
> 3. A verbatim, copy-pasteable print-CSS block that explicitly preserves the page-break-inside:auto (section) / thead:table-header-group / tr,.cat-row,.subtotal-row,.sig-row:page-break-inside:avoid pattern from quote-builder-v2.html:337-386, generalized so it isn't quote-specific class names.
> 4. Per-call-site before/after code blocks (exact old code quoted, exact new code to paste) for at minimum: quote-builder-v2.html's print-header, buildPayslipHTML, buildBillingInvoiceHTML, printPurchaseOrder — plus an explicit disposition (migrate / delete / leave alone, with reasoning) for printBKQuote, printQuote, renderBSQuoteBuilder, printPayslip, and printWorkerPayslip so Sonnet isn't left guessing whether to touch legacy code.
> 5. A decision + migration snippet for doc-serial numbering (adopt `_counters` transactions vs. keep ad hoc schemes), including the exact `firestore.rules` diff if any new counter keys or collections are introduced.
> 6. A numbered migration checklist in execution order (e.g. 1. add shared module/file, 2. wire index.html + sw.js PRECACHE + CACHE_VER, 3. convert quote-builder-v2, 4. convert payslip, 5. convert PO, 6. convert billing invoice, 7. verify multi-page print via the /verify or /run skill), each step scoped small enough that Sonnet can do it as one Edit without re-deriving architecture.
> 7. An explicit statement of what is OUT of scope for workstream 14 (e.g. "does not touch payroll data-source correctness — that's workstream 24" / "does not decide which quote builder survives — that's workstream 31") so Sonnet doesn't scope-creep into adjacent workstreams while implementing this one.
