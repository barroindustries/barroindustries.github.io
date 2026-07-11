# Workstream 31 — Quotation builder v3 (Quick Quote mode + repair the quote→approval→order chain + dead-code cleanup + product photos)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

**0) `quote-builder.html` (v1) does not exist on this branch — CLAUDE.md's description of
it as "the older, read-only predecessor" is stale.** `git log --diff-filter=D -- quote-builder.html`
shows it was deleted in commit `0376c29` ("v10: Launch — timezone fixes, partner deals, SOPs,
Firestore rules hardening", 2026-06-17), whose diff stat reads `quote-builder.html | 1253
---------------------------------------------------` under the explicit changelog line "Delete
obsolete quote-builder.html (v1, superseded by v2)." `git ls-files | grep quote-builder` today
returns only `quote-builder-v2.html` (2,785 lines). The only other copy in the working tree is a
stale leftover worktree (`.claude/worktrees/wf_783ec1d0-56d-1/quote-builder-v2.html`, itself a v2
copy, not v1) — not on this branch, not reachable from the app. **There is no v1 file left to
audit or delete; any "dead code" reduction for this workstream is entirely code living inside
the still-live `quote-builder-v2.html` and inside `js/departments.js`.**

**1) Architecture today.** `quote-builder-v2.html` is a fully self-contained standalone HTML
document (own `<style>`, one big inline `<script>`) loaded in an `<iframe>` by
`renderQuoteBuilderIframe()` (js/app.js:1152-1231); the `<iframe src="...">` is set at
`js/app.js:1163: let qbSrc = 'quote-builder-v2.html' + (partnerMode ? '?portal=partner' : '');`
with a generic-partner branch (app.js:1164-1173) appending `pcoName`/`pcoContact`/`pcoSig` query
params. **It only loads two external scripts of its own** (quote-builder-v2.html:930-935):
Firebase compat SDK + `js/firebase-config.js` — it does **not** load `js/config.js`,
`js/letterhead.js`, `js/departments.js`, or `js/app.js`, so none of the host app's globals
(`window.BRAND`, `window.escHtml`, `window.buildLetterhead`, `canEditDept`, etc.) exist inside
it; everything it needs (branding, pricing constants, product formulas) is either hardcoded in
its own `<script>` or fetched from Firestore directly via its own `db` handle from
`firebase-config.js`. A company toggle picks the active brand — `<button id="coBK"
onclick="setCompany('BK')">🍳 Barro Kitchens</button>` / `<button id="coBS"
onclick="setCompany('BS')">⚙ Brilliant Steel</button>` (quote-builder-v2.html:398-399) — plus a
runtime-synthesized third option, `CO.PT`, for a "generic partner" (non-Brilliant-Steel partner
company), built by `applyPartnerMode()` (1135-1164) which relabels the BS pill to the partner's
own company name and hides the BK pill entirely in Brilliant-Steel-only partner mode
(1143-1144). "Full builder" = everything visible to an internal Sales/BS employee: category
tabs + live product search/dropdown (`filteredProducts`/`renderDropdown`, 1392-1433), a
dimension-driven price calculator per product (`buildCalcPanel`/`computePrice`, 1473-1620), a
line-items table with inline-editable qty/price/specs (`renderItems`, 1714-1761), payment-
schedule/down-payment/VAT/discount/commission math (`computeTotals`/`renderPaymentSchedule`,
1762-1880), an internal-only labor-cost/margin panel gated behind the "🔒 Internal" view pill
(`buildLaborTable`/`computeMarginSummary`, 1981-2078, only rendered `if(currentView==='internal')`
at 1759/1799), and an "⚙ Admin" view (removed entirely in partner mode, app removes
`#btnAdmin` at 1147) for live-editing the product database in place
(`saveAdminProduct`/`persistProductToDB`, 2147-2220) plus DB import/export and a pricing-
coefficients editor (`buildCoefTable`/`saveConstants`, 2246-2293). There is no "guided /
3-step" mode of any kind today — every field (client info, items, terms, payment) is on one
long scrolling form; a new user gets the exact same full builder a power user does.

**2) Filing mechanism — the iframe never writes to Firestore for quotes itself; it posts a
message to the parent.** `fileQuotation()` (quote-builder-v2.html:2506-2542) builds
`buildQuotePayload()` (2544-2619, includes a full `editableState` re-openable snapshot,
2556-2568) and does `window.parent.postMessage({ type:'QUOTE_FILED', payload: quotePayload },
'*')` (2534) for a normal file, or, if the "Send to president for review first" checkbox is
checked (rendered at 2483-2486, `id="reqApprovalCheck"`), `window.parent.postMessage({
type:'QUOTE_APPROVAL_REQUESTED', payload: quotePayload }, '*')` (2516) instead — quoted verbatim
from the file:
```js
function fileQuotation(){
  if(!canFile()) return;
  const reqApproval = document.getElementById('reqApprovalCheck')?.checked || false;
  const quotePayload = buildQuotePayload();
  if(reqApproval){
    quoteStatus='pending_approval';
    ...
    window.parent.postMessage({ type:'QUOTE_APPROVAL_REQUESTED', payload: quotePayload }, '*');
    ...
    return;
  }
  quoteStatus='filed'; filedAt=new Date().toISOString(); ...
  window.parent.postMessage({ type:'QUOTE_FILED', payload: quotePayload }, '*');
  ...
}
```
The host app's bridge — `window.addEventListener('message', ...)` at **js/app.js:8132-8254** —
is the only place a quote doc is actually written. It only trusts same-origin messages
(`if (e.origin !== window.location.origin) return;`, 8133) and only reacts to the two types
above (8136).

**3) THE "BK quotes stranded in bs_quotes" BUG — confirmed, exact code cited.** The two branches
of the bridge route to *different, inconsistent* collections. The `QUOTE_FILED` branch
correctly respects `data.company`:
```js
// app.js:8181-8183
// Route by company so Barro Kitchens quotes land in bk_quotes (visible in the
// Sales → Quotations summary) and Brilliant Steel quotes in bs_quotes.
const coll = (data.company === 'BK') ? 'bk_quotes' : 'bs_quotes';
```
But the `QUOTE_APPROVAL_REQUESTED` branch **ignores `data.company` entirely** and hardcodes
`bs_quotes`, with the comment explaining this is deliberate:
```js
// app.js:8224-8231
} else {
  // QUOTE_APPROVAL_REQUESTED — the president's approve/reject handler reads
  // bs_quotes by id, so the approval round-trip always lives in bs_quotes
  // (regardless of company) to keep that flow working unchanged.
  data.status = 'pending_approval';
  data.approvalStatus = 'pending_review';
  data.reviewRequestedAt = firebase.firestore.FieldValue.serverTimestamp();
  const docRef = await db.collection('bs_quotes').add(data);
  ...
}
```
So: a Barro Kitchens agent who ticks "Send to president for review first" on a `company:'BK'`
quote gets that quote written into `bs_quotes` (not `bk_quotes`), with `data.company` still
recorded as `'BK'` inside the doc. It **stays** in `bs_quotes` permanently, because every
approval-side function that later touches it also hardcodes the collection —
`approveQuoteApproval` (departments.js:11003-11012), `returnQuoteToPartner` (11014-11025),
`openQuoteApprovalReview`'s approve/return handlers (11049-11068), and
`saveReviewedPartnerQuote` (app.js:1278) all do `db.collection('bs_quotes').doc(quoteId)
.update(...)` — none branch on `.company`. Meanwhile `renderBKQuotationsSummary`
(departments.js:6554 on) — the actual "Sales → Quotations" screen a Barro Kitchens agent looks
at — queries **only** `bk_quotes` (`db.collection('bk_quotes').orderBy('createdAt','desc')` /
`.where('createdBy','==',currentUser.uid)`, departments.js:6559-6560). The stranded quote is
therefore invisible on the BK side forever; it only surfaces in the Approvals queue
(`approval_requests` + `bs_quotes`) or in Brilliant Steel's own "Quotations Summary" tab
(`renderBSQuotationsSummary`, departments.js:9109 on) — a screen a Barro Kitchens sales agent has
no nav route to and no reason to check.

**4) "Approvals approving without filing" — confirmed, and it's worse than one bug: two
structurally different approve implementations coexist in the same `renderApprovals` function
and disagree.** `window.renderApprovals` (departments.js:10036) builds a chip bar including
`{ key:'roa', label:'Quote / ROA', count: pendingQApprovals }` (departments.js:10134) alongside
an aggregated `{ key:'all', label:'All Requests', ... }` chip (10127). Both chips draw from the
same `approval_requests` collection, but through two independent code paths inside
`loadApprovalsSub(sub)`:
- **`sub === 'all'`** (10158-10488, returns at 10487): quote-approval items render with
  `qa-approve-btn`/`qa-review-btn` (10245-10247), wired to
  `approveQuoteApproval(...)`/`openQuoteApprovalReview(...)` (10418-10429), which correctly do
  `db.collection('bs_quotes').doc(quoteId).update({ status:'filed', approvalStatus:'approved',
  ... })` (departments.js:11006) **and** resolve the matching `approval_requests` doc.
- **`sub === 'roa'`** does not match any of the preceding `if (sub === …) { … return; }` blocks
  (`all` 10158/10487, `grading` 10490, `finance-requests` 10582, `leave` 10673, `review-tasks`
  10714, `signups` 10762, `attendance` 10853, `ca` 10906) and falls through to the **terminal
  `else`** branch at **departments.js:10953-10993**, headed by the comment `// Quote / ROA
  approvals` (10954). Its handlers are trivial and quoted verbatim:
```js
// departments.js:10977-10984
wrap.querySelectorAll('.approve-approval').forEach(btn => {
  btn.addEventListener('click', async e => {
    const { id, agent: agentId, client } = e.currentTarget.dataset;
    await db.collection('approval_requests').doc(id).update({ status: 'approved' });
    await Notifs.send(agentId, { title:'Quote Approved', body:`Your quote for ${client} was approved.`, icon:'✅', type:'approval_result' });
    Notifs.showToast('Quote approved!'); loadApprovalsSub('roa');
  });
});
```
This handler **never touches the `bs_quotes` document at all** — no `status`, no
`approvalStatus`, no `approvedAt`/`approvedBy`. A President who clicks Approve from the "Quote /
ROA" chip (rather than the "All Requests" chip) flips the `approval_requests` doc to
`'approved'` and tells the agent "Your quote ... was approved" — while the quote itself sits
frozen in `renderBSQuotationsSummary`'s `forApproval` bucket forever (`q.approvalStatus===
'pending_review'||q.status==='sent'`, departments.js:9122), never becomes `status:'filed'`, and
is never eligible to be marked "won"/converted to a sales order (see point 6). **This is a
literal, verifiable instance of "approving without filing."** Both chips are visible to the same
President/Manager session at the same time (10126-10137); which one they happen to click
determines whether the quote actually files or silently stalls.

**5) "Finance's empty list" — Finance has no Quotes tab; the most plausible read is the "Sales
Orders" tab, and it is structurally starved by points 3–4.** Finance's tab list is
`['Overview','Reports','Sales Orders','Ledger','Cash Receipts','Cash Disbursements','Purchases',
'Inventory','Records','Taxes','SSS / Gov','Tasks']` (departments.js:1996, `renderFinance`) —
there is no "Quotes"/"Quotations" case anywhere in `loadFinanceContent`'s switch
(departments.js:2022-2052); `renderRecordsTab`'s "Records" tab (4055) is an unrelated manual
receipt/voucher journal (`finance_records`), not quotes. The one Finance screen genuinely
downstream of quotes is `window.renderSalesOrders` (departments.js:9387-9423), which queries
`db.collection('sales_orders').orderBy('createdAt','desc')` (9394) and, when empty, literally
says: `<h4>No sales orders yet</h4><p>They appear here when a won quote is converted to a sales
order.</p>` (9408). A `sales_orders` doc is only created by a **manual** "Sales Order" button
click on an already-`status:'won'` quote inside `renderBKQuotationsSummary`
(`.bk-so-btn`, departments.js:6620) or `renderBSQuotationsSummary` (departments.js:9650), both
calling `openSalesOrderModal` (9306-9384), which on success stamps
`salesOrderId`/`projectId`/`status:'won'` back onto the quote (`db.collection(qc).doc(d.id)
.update(...)`, departments.js:9345). Because a stranded BK quote (point 3) never appears in
`renderBKQuotationsSummary`, and a quote wrongly "approved" via the `roa`-chip bug (point 4)
never leaves its `pending_review`/`sent` bucket in either summary screen, **deals can close in
reality while `sales_orders` — and therefore Finance's Sales Orders list — never receives a row
for them.** This reads as the exact mechanism behind the mandate's "Finance's empty list" phrase:
not a wrong query, but an upstream chain (approve → mark won → click "Sales Order") that quietly
drops quotes before they reach `sales_orders`, several steps upstream of Finance's screen.

**6) Quote→order chain, fully traced.** Filed quote (`bk_quotes`/`bs_quotes`, `status:'filed'`)
→ manual "Sales Order" button (only shown/actionable once filed) → `openSalesOrderModal`
(departments.js:9306-9384) writes `sales_orders/{id}` (`projectId, quoteId, quoteNumber,
clientName, company, contractAmount, paymentReceived, status:'pending'→'recorded', ...`) **and**
a parallel `job_projects/{id}` doc (`createJobProject`, per fable-workplan/32-sales-crm.md point
4) → Finance's "Record Sale" button on `renderSalesOrders` (`.so-record-btn` → `openRecordSaleModal`,
departments.js:9433-9434) posts the ledger row and flips `sales_orders.status:'recorded'` →
"To Production" button (`.so-prod-btn`) hands off to production. **Every step from "filed" to
"sales_orders" is a manual button click by a human who has to be looking at the right screen at
the right time** — there is no automatic transition anywhere in this chain, and no reconciliation
job that would surface a quote that's been sitting `status:'filed'` (or worse, silently stuck
`pending_review` per point 4) for weeks without ever getting its "Sales Order" click.

**7) Dead code — a reproducible zero-caller check finds ≈1,190 of the mandate's claimed "~1,800
lines," concentrated in six functions; the rest is not accounted for by this pass.** Method: for
every top-level `function name(...)` in a file, count occurrences of `name(` across the whole
file; a count of 1 means the only occurrence is the definition itself (zero call sites,
anywhere, including from other dead code). Run against `js/departments.js` (173 top-level
functions) and `quote-builder-v2.html` (108 functions):
- **`renderBSQuoteBuilder` (departments.js:8560-9108, 549 lines)** — a complete second,
  hand-rolled, in-page Brilliant Steel quote builder: its own `<style>` block (`.bs-qb`,
  `.bs-section`, `.bs-items-table`, etc., 8562-8609), its own line-items array (`bsLines`), its
  own pricing (`recalcBS()`), a "Save Draft" button that writes a `bs_quotes` doc with
  `status:'draft'` (departments.js:9040-9051) and a "Request for Approval" button that
  independently writes **both** a `bs_quotes` doc (`status:'sent', approvalStatus:
  'pending_review'`, 9064-9080) **and** an `approval_requests` doc (`type:'bs_quote'`,
  9082-9093) — a third, in-app-native path into the exact same collections the iframe's bridge
  also writes to, fully duplicating that logic. It is completely superseded:
  `loadBSContent`'s switch (departments.js:8381-8389) routes `case 'Quote Builder':` to
  `navigateTo('bs-quote-builder')` — the iframe — never to this function, and grep confirms the
  string `renderBSQuoteBuilder` appears exactly once in the entire repo (its own definition).
- **`renderBSDashboard` (departments.js:8507-8559, 53 lines)** — immediately precedes the dead
  builder above; also zero callers (not wired into `loadBSContent`'s switch, which has no
  `'Dashboard'` case).
- **`renderBKQuoteList` (departments.js:6199-6553, 355 lines)** — a duplicate Barro Kitchens
  quotes-listing screen, fully superseded by `renderBKQuotationsSummary`
  (departments.js:6554-6749, the one actually called from `loadSalesContent`'s `case 'Quotes'`
  at departments.js:5540 and from `openSalesOrderModal`'s post-save refresh at 9376). Zero
  callers.
- **`renderBKPackages` (departments.js:6750-6804, 55 lines)** — zero callers anywhere.
- **`renderQuoteList` → `openQuoteEditor` → `printQuote` (departments.js:9870-10031, 162
  lines)** — a generic, brand-parametrized quote editor against the **legacy `quotes`**
  collection (predates the `bk_quotes`/`bs_quotes` split noted in fable-workplan/32-sales-crm.md's
  Data model section). `openQuoteEditor`'s only two call sites (departments.js:9904, 9910) are
  both inside `renderQuoteList` itself; `printQuote`'s only call site (10012) is inside
  `openQuoteEditor`. The entire three-function chain is unreachable from any live nav path —
  `renderQuoteList` itself has zero external callers.
- Two small zero-caller unit-conversion helpers inside `quote-builder-v2.html` itself,
  `mmToFeetStr`/`feetStrToMm` (~15 combined lines) — superseded by the current
  `dispVal`/`valToMm`/`MEASURE_UNITS` measurement-unit system.

Sum: 549+53+355+55+162 = **1,174 verified dead lines in `js/departments.js`**, +~15 in
`quote-builder-v2.html` ⇒ **≈1,190 lines independently confirmed dead via a reproducible
zero-caller grep**, concentrated in exactly 6 named functions/chains. **This is roughly two-
thirds of the mandate's "~1,800" estimate; the remaining ~600 lines are not identified by this
pass** — plausible additional candidates Fable should have Sonnet re-check before finalizing a
deletion list: CSS rules inside `js/departments.js`'s inline `<style>` blocks that exist only to
style the now-dead `.bs-qb`/`.bs-section`/`.bs-items-table`/etc. classes (not counted above,
since the grep only measured JS function bodies), and any admin-only/legacy branches inside
still-*called* functions that this line-level check cannot detect (e.g. dead `if` branches
inside a live function). Do not assume 1,800 is exact; treat ~1,190 as a confirmed floor.

**8) Product catalog / photo infrastructure — zero photo fields exist anywhere; there are three
layered data sources, and the live one is Firestore, not the JSON file.** `loadDatabase()`
(quote-builder-v2.html:1033-1104) tries, in order: (a) Firestore `products` (limit 1000) +
`productMeta/config` **first** (1044-1082, comment: "Primary source: Firestore 'products'
collection — synced live with the President's Product Database page"); (b) on failure, `fetch
('products-database.json?v='+Date.now())` (1087-1102); (c) on `location.protocol==='file:'` or
total failure, an embedded-in-JS fallback (`getEmbeddedDB()`). **`products-database.json` (3,998
lines, 165 products under `d.products`) is a shipped fallback snapshot, not the live source of
truth.** The live source is maintained by a completely separate, president-only, full-page
screen inside the main app — `renderProductDatabase` (js/app.js:1573-1920+, nav entry
`{icon:'package', label:'Product Database', page:'product-database'}` at app.js:943, gated
`isPresident()` at the router, app.js:2026) — which reads/writes the same `products`/
`productMeta` Firestore collections quote-builder-v2.html reads, via `collectAndSaveProduct`
(app.js:1773-1778, quoted): `title, category, unit, basePrice, capitalMaterials, capitalLabor,
measurement, specifications, formulaType, formula, bom: bom||[]`. The static JSON's per-product
shape (verified by reading `products-database.json` directly) is `{id, category, name,
shortName, formulaType, basePrice, defaultDimensions:{W,D,H}, formula:{...}, specs:[],
laborHours:{fabrication,installation,teamSize}, leadTime, notes, unit}` — e.g. product
`CE-001`, "SS Open Top Low Pressure Stove (1 Burner)". **Grepping "photo"/"image"/"img" across
both `products-database.json` and `quote-builder-v2.html` returns zero hits** on any product
field (the only `<img>` tags in the file are the two static company-logo elements, `#phLogo` and
the print-header logo). There is also no `firestore.rules` change needed to add a photo field —
`match /products/{docId} { allow read: if isAuth(); allow write: if isAuth() && isAdmin(); }`
(firestore.rules:633-636) already covers any new field on the same doc. A reusable upload
mechanism already exists and is used elsewhere in the app for exactly this kind of field:
`Drive.renderUploadArea(containerId, onUpload, {accept, label, dept, subfolder, multiple,
allowLinks})` (js/drive.js:101 on) — uploads straight to Firebase Storage per the app's
architecture (no product-photo call site exists yet; it's currently used for Finance Records,
department file collections, etc.).

**9) No existing "Quick Quote" / guided-wizard precedent exists to reuse.** Grepping for
wizard/stepper/multi-step-input patterns across every `.js`/`.html` file finds exactly one
stepper-shaped UI, and it is **read-only display, not an input wizard**: a horizontal chip strip
showing current production-stage progress among `JOB_STAGES` (departments.js:12116-12119,
`const stepper = JOB_STAGES.filter(...).map(s=>{...cur?'highlighted':dn?'done':'pending'...})`)
— useful only as a visual precedent for a step-progress indicator, not for step-gated form
validation, a "Next"/"Back" flow, or per-step data collection. The app's `chipTabs`/
`bindChipTabs` helper (the reusable declutter-tabs pattern referenced in the
ui-chip-tabs-and-sop-helpers memory) is the closest generic reusable UI primitive, but it's a
free-switch tab bar, not a sequential/validated wizard. **A "client → pick products from a photo
catalog → review/send" 3-step Quick Quote mode has no scaffolding to build on inside this app
today** — Fable's spec should treat the step-flow shell itself as new infrastructure, not a
reuse of an existing component.

**10) WS14 letterhead engine has NOT been adopted for quotes — verified, not assumed.**
`window.buildLetterhead` (js/letterhead.js, header comment: "loads AFTER config.js so
window.BRAND exists") is used by four documents inside `js/departments.js` (grep hits at lines
5293, 7659, 12913, 13656 — purchase orders, an invoice, and two others per WS30's brief) but
**zero times** inside `quote-builder-v2.html`. Since quote-builder-v2.html only loads the
Firebase SDK + `firebase-config.js` (point 1 above) and never loads `js/letterhead.js` or `js/
config.js`, `window.BRAND` and `window.buildLetterhead` simply do not exist inside that document
— its print path (`doPrint()`/`doPrintAgent()`, quote-builder-v2.html:2681-2707) is plain
`window.print()` against its own hardcoded `<style>`/header markup and its own `CO` branding
object (~940-950). Adopting the shared letterhead engine for the printed quote is real,
unstarted work for this workstream, not a checkbox already ticked by WS14 — it would require
either porting `letterhead.js` + `window.BRAND` + `escHtml` into the iframe document, or moving
printed-quote HTML construction into the parent app (which already has all three loaded).

**11) `quote-builder-v2.html` is not in `sw.js`'s `PRECACHE` list at all**, nor is
`products-database.json` — confirmed by grepping `sw.js` for both filenames (zero hits). The
`PRECACHE` array (sw.js:15-33) lists only `index.html`, `track.html`, `css/styles.css`, and the
core `js/*.js` files loaded by `index.html`'s fixed script chain; HTML files outside that list
fall under the service worker's general "HTML → network-first" strategy (sw.js top comment),
so edits to `quote-builder-v2.html` take effect on next load without needing a `CACHE_VER` bump
— but any *new* `.js`/`.css` file this workstream splits out of the monolithic HTML (e.g., if
Fable's spec factors the builder into separate script files) would need both an `index.html`/
iframe-`<script src>` reference and a new `PRECACHE` entry per CLAUDE.md's file-addition rule.

**12) Client-# auto (excluded from this brief per the task's instruction not to re-investigate)**
— worth one pointer for whoever reads this next to avoid re-litigating fable-workplan/32-sales-
crm.md's footnote on the same claim: the only "auto sequence" code actually found while reading
quote-builder-v2.html is `autoClientSeq()`/`autoComputeCustRev()` (1247-1265, ~1315+), which
auto-increments the **3-digit sequence segment of the quote number** (`qnoSeq`, part of the
`CO-LOC-METHOD-YYMMDD-SEQ-Rn` pattern built by `buildQuoteNo()`, 1267-1280) — i.e. "the Nth
quote today," not a persistent client identifier field on a client document. This is consistent
with 32-sales-crm.md's own finding that `clientNumber`/`clientNo` greps return zero hits
app-wide.

## Data model

`bk_quotes/{id}`, `bs_quotes/{id}` — written only by the `js/app.js:8132-8254` bridge (or, for
the dead in-page BS builder, departments.js:9040-9105 — see point 7) with the shape built by
`buildQuotePayload()` (quote-builder-v2.html:2544-2619) and re-mapped field-by-field on the
bridge side (app.js:8140-8179): `quoteNumber, company ('BK'|'BS'|'PT'), clientName,
clientCompany, clientAddress, clientPhone, clientEmail, salesperson, purpose, subject, location,
leadSource, quoteDate, items:[{...,name,specEdit,qty,unit,unitPrice,amount,leadTime,notes}],
subtotal, total, grandTotal, vatIncluded, vatAmount, discountPct, discountAmount, netAmount,
deliveryInstall:{amount,includedInTotal,free,method,notes}, timeline:{startDate,leadDays,
completionDate}, remarks, bankDetails, validUntil, commissionPct, commissionAmount,
payment:{downPaymentMode,downPayment,balance,...}, editableState (full re-openable form
snapshot, see quote-builder-v2.html:2556-2568), source:'quote-builder-v2', agentName, createdBy,
createdByName, createdByRole, createdAt, version (int, re-filing versioning, app.js:8187-8193),
fileName, status ('filed'|'pending_approval'|'needs_revision'|'rejected'|'won' — no single
enum owns this, both `status` and `approvalStatus` are set redundantly and can drift, see point
4), approvalStatus ('filed'|'pending_review'|'approved'|'needs_revision'|'rejected'),
salesOrderId + projectId (set once won, departments.js:9345), deleteRequested/deleteReason/
deleteRequestedBy/deleteRequestedAt (soft-delete flow, requestQuoteDelete, departments.js:248).
**No `clientId` field** — join is by `clientName` string only, per fable-workplan/32-sales-crm.md
point 3 (do not re-derive; reuse that brief's Data model section for the client-side of this
join).

`approval_requests/{id}` (type `'bs_quote'`, shared collection also used for `ca_deduct` per WS22
— filter `d.data().type!=='ca_deduct'` at departments.js:10191 to isolate quote-approval rows):
`type:'bs_quote', quoteId, quoteNumber, clientName, total, filename, agentName, agentId,
status:'pending'|'approved'|'rejected'|'returned', createdAt`. Two independent write paths create
this doc with the same shape: app.js:8233-8243 (from the iframe bridge) and
departments.js:9082-9093 (from the dead in-page `renderBSQuoteBuilder`, point 7).

`products/{id}` (Firestore, live source) — `title, category, unit, basePrice,
capitalMaterials, capitalLabor, measurement:{W,D,H}, specifications, formulaType, formula:{...},
bom:[{itemId,name,unit,unitCost,qty}], updatedAt` (app.js:1773-1778) — **no photo/image field**.
`productMeta/config` (single doc) — `categories:[{id,label,code,color,icon}], laborRoles:[...],
constants:{markup:{retail,commercial,government}, vat, materialPriceIndexMultiplier,
workHoursPerDay, travelDayRate}` (coefficient names cross-referenced against
`COEF_DEFS`, quote-builder-v2.html:2248-2256).

`products-database.json` (static file, fallback only) — top-level `{_meta, categories, products,
laborRoles, constants}`; each product `{id, category, name, shortName, formulaType, basePrice,
defaultDimensions:{W,D,H}, formula:{baseLengthMm,pricePerExtraMm,rateW100,rateD100,rateH100},
specs:[], laborHours:{fabrication,installation,teamSize}, leadTime, notes, unit}` — **no
photo/image field**; kept in sync with the live Firestore DB only by manual export
(`exportDatabase()`, quote-builder-v2.html:2222-2229) — there is no automated sync job.

`sales_orders/{id}`, `job_projects/{id}` — already fully documented in fable-workplan/32-sales-
crm.md's Data model section (fields relevant to this workstream: `sales_orders.quoteId`,
`.quoteNumber`, `.clientName`, `.status`; `job_projects` is created alongside by
`openSalesOrderModal`, departments.js:9306-9384) — not re-derived here; that brief is the
source of truth for those two collections.

## Constraints — must respect

- `quote-builder-v2.html` is a separate document with its own script-loading rules — it is NOT
  part of the fixed `config.js → drive.js → notifications.js → departments.js → app.js →
  modules.js` load order CLAUDE.md documents for the main SPA. Any shared helper Fable wants
  BOTH the iframe and the main app to use (e.g. `buildLetterhead`, `escHtml`, a shared pricing
  formula) must either be duplicated inside the iframe's own `<script>`, loaded as an additional
  `<script src>` inside `quote-builder-v2.html`'s own `<head>` (which then needs its OWN
  `PRECACHE`/cache-busting consideration, point 11), or the responsibility must move to the
  parent app (which already has everything loaded).
- `escHtml()` discipline — the iframe interpolates client-controlled fields (name, company,
  address, notes) directly into `innerHTML` in many places (e.g. `renderItems()`,
  `buildQuotePayload()`'s consumers); it does NOT have `window.escHtml` available (point 1) and
  appears to rely on `attrEsc()` (quote-builder-v2.html:1019, attribute-only escaping) plus
  manual `.replace(/"/g,'&quot;')` calls in a few spots — any new photo-catalog markup Fable adds
  inside the iframe must follow whatever escaping convention already exists there, not assume
  `escHtml` is available.
- Firestore rules coverage does not cascade (firestore-rules-collection-coverage memory) — a new
  photo field on `products` needs no new rule (existing `isAuth()`/`isAdmin()` write gate already
  covers it, point 8), but any brand-new collection this workstream might introduce (e.g. a
  Quick-Quote-specific draft collection, or a "quote revision request" log) needs its own
  explicit `match` block.
- Rules must use `.get(field, default)` for any optional/new field (firestore-rules-missing-
  field-throws memory) — directly relevant if Fable adds an `approvalStatus`-based rule
  tightening to fix point 4, since every existing `bs_quotes`/`bk_quotes` doc predates any fix
  and has inconsistent `status`/`approvalStatus` combinations already (point 4's finding that the
  two fields can disagree today).
- `CACHE_VER` in `sw.js` is auto-bumped by the pre-commit hook for `APP_VERSION`/`index.html`
  version strings, but **`CACHE_VER` itself is a separate constant the hook does not touch**
  (sw_cache_bump_required memory) — must be hand-bumped on any edit to a file the service worker
  actually caches. Per point 11, `quote-builder-v2.html` currently is NOT precached, so edits to
  it alone don't strictly require a `CACHE_VER` bump under the current strategy — but any edit to
  `js/app.js` (the bridge) or `js/departments.js` (Approvals/BK/BS quote screens) absolutely does,
  since both are in `PRECACHE`.
- `dbCachedGet`/`dbCacheInvalidate` discipline — `getAllQuotes()` (app.js:2048-2060, merges
  `bk_quotes`+`bs_quotes`+legacy `quotes`, cache key `'all-quotes'`, 30s TTL) already exists and
  is used by dashboards/Analytics; `openClientQuotesModal` and the two Quotations-summary
  screens currently bypass it with raw `.get()` calls (per fable-workplan/32-sales-crm.md point
  10) — any rework of quote-listing screens for this workstream should decide deliberately
  whether to route through `getAllQuotes()`/its cache key rather than adding yet another
  uncached read path.
- The soft client-delete-request flow, the quote soft-delete-request flow
  (`requestQuoteDelete`, departments.js:248), and the Approvals-queue delete-approval tier
  (`delete-quote` in `APPROVAL_CAPS`, president-only per departments.js:10064) are all existing,
  working machinery that must keep working through any quote-collection restructuring —
  `delQSnap2`/`delBKQSnap2` (departments.js:10173-10174) query `bs_quotes`/`bk_quotes` by
  `deleteRequested==true` directly; unifying or renaming collections must update these queries in
  lockstep or delete-requests silently stop appearing in Approvals.
- Partner data isolation: `firestore.rules:563-587` scope `bs_quotes` reads to
  `createdBy==uid || !isPartner()` and `bk_quotes` reads to `!isPartner() && (createdBy==uid ||
  isAdmin())` — i.e. **a partner can never read `bk_quotes` at all**, by design. Any unification
  of the two collections (open decision below) must preserve this exact partner/internal
  visibility split or it becomes a data-leak regression, not just a UX cleanup.
- WS14's `buildLetterhead` expects `window.BRAND`/`window.brandEntity` from `js/config.js` and
  `window.escHtml` (js/letterhead.js:12,24-25) — adopting it inside the iframe is not a drop-in
  one-line call; it requires those globals to exist in that execution context first (point 10).
- The two dead-code chains identified in point 7 above (`renderBSQuoteBuilder`/`renderBSDashboard`,
  `renderBKQuoteList`/`renderBKPackages`, `renderQuoteList`/`openQuoteEditor`/`printQuote`) write
  to the SAME collections (`bs_quotes`, `bk_quotes`, `approval_requests`, legacy `quotes`) that
  the live iframe bridge also writes to — deleting them is a pure code-removal (zero live callers
  confirmed), but Fable's spec should have Sonnet re-run the same zero-caller grep methodology
  immediately before deleting, since a concurrent session could add a new caller in the interim
  (per the deploy-recheck-full-file-diff memory's general caution about concurrent edits to this
  repo).

## Open decisions

- [ ] **BK/bs_quotes stranding fix — mechanism.** Fix `app.js:8231`'s hardcoded
  `db.collection('bs_quotes')` to branch on `data.company` like the `QUOTE_FILED` branch already
  does (`const coll = data.company==='BK' ? 'bk_quotes' : 'bs_quotes'`), and then make every
  downstream approval function (`approveQuoteApproval`, `returnQuoteToPartner`,
  `openQuoteApprovalReview`, `saveReviewedPartnerQuote`) accept/branch on a collection parameter
  too (they'd need `approval_requests` to record which collection the quote lives in, since
  today's `approval_requests` doc shape has no such field) — or keep the "approval round-trip
  always lives in bs_quotes" design deliberately (per the existing comment) and instead make
  `renderBKQuotationsSummary` ALSO query `bs_quotes` rows where `company==='BK'` so a stranded
  quote is at least visible on the BK side? The former is a real fix; the latter papers over it
  without changing where data lives.
- [ ] **Migration for already-stranded quotes.** Are there live `bs_quotes` docs today with
  `company:'BK'` that need a one-time migration (move doc to `bk_quotes`, or backfill a flag so
  the BK summary screen picks them up)? This needs a live Firestore read to quantify before
  Fable finalizes a migration script — not established by this static-code grounding pass.
- [ ] **"Approving without filing" fix — which of the two approve implementations wins?**
  Retire the naive `roa`-chip approve/reject handlers (departments.js:10977-10992) entirely and
  route the `'roa'` chip through the same `approveQuoteApproval`/`openQuoteApprovalReview` calls
  the `'all'` chip already uses (straightforward — the correct logic already exists, just needs
  to be the ONLY logic), or keep two chips with genuinely different scopes and make the naive one
  call the correct functions too? Given `approveQuoteApproval` already exists and works, this
  reads as a low-risk "route the second button through the first button's function" fix — but
  Fable should confirm no other caller depends on the naive handler's narrower side effects
  (it does NOT send the "approved and filed" wording, notify with a different message, etc.).
- [ ] **Should `status` and `approvalStatus` be collapsed into one field?** Point 4's bug is
  partly enabled by the two fields existing in parallel and being settable independently — does
  the fix also canonicalize on one status field (matching one of WS32's "three disagreeing
  win/won definitions" concerns) or keep both for backward compatibility with existing docs?
- [ ] **Quick Quote 3-step mode — exact data flow.** Step 1 (client) → Step 2 (pick products
  from photo catalog) → Step 3 (review/send) — does this live as a NEW mode inside
  `quote-builder-v2.html` (reusing its existing `items`/`buildQuotePayload`/`fileQuotation`
  machinery, gated behind a new `currentView==='quick'` or a separate boolean), a wholly separate
  lightweight HTML/iframe entry point, or a guided overlay built in the MAIN app (js/app.js/
  departments.js) that only hands off to the iframe at the final "review/send" step? Given point
  9 (zero wizard infrastructure exists anywhere), this is a from-scratch UI build regardless of
  where it lives — the placement decision mainly affects how much of the existing pricing/
  filing code it can call directly versus via postMessage.
- [ ] **Product photo storage + upload UI.** Add an `imageUrl`/`photoUrl` field to the
  Firestore `products/{id}` doc (point 8) and wire `Drive.renderUploadArea` into
  `renderProductDatabase`'s add/edit form (js/app.js:1573-1920, the live product-editing
  screen) — single photo per product, or allow multiple? Does `products-database.json` (the
  offline fallback) also need the field added/backfilled via `exportDatabase()`, given it's
  currently hand-synced and could silently regress to photo-less if re-exported without it?
- [ ] **Product photo display surfaces.** Photo shows in: the Quick Quote step-2 grid (mandate
  explicit), the full-builder product search dropdown (`renderDropdown`, quote-builder-v2.html:
  1409-1432 — currently text-only), the items table once added to a quote (`renderItems`,
  1714-1761 — currently text-only), and/or the printed quote (mandate explicit, "product photos
  in ... printed quote") — all four, or a subset? Printing photos raises print-CSS/page-break and
  file-size questions (`@media print` rules, quote-builder-v2.html:2601-2607) not addressed by
  today's code at all.
- [ ] **Photo source for the 165 existing products.** Bulk-upload workflow for backfilling
  photos onto the 165 already-catalogued products (batch upload UI, or one-by-one via the
  existing edit form) — is this in Sonnet's implementation scope, or a manual data-entry task
  for Neil/staff to do after the feature ships?
- [ ] **Letterhead adoption for the printed quote (point 10).** Port `js/letterhead.js` +
  `window.BRAND`/`brandEntity` + `window.escHtml` into `quote-builder-v2.html`'s own `<script>`
  (keeps the iframe self-contained, duplicates ~100-200 lines), or move printed-quote HTML
  generation into the parent app (`js/app.js`/`js/departments.js`, which already has
  `buildLetterhead` loaded) and have the iframe hand off print data via `postMessage` instead of
  calling `window.print()` on itself? The former preserves the iframe's current
  fully-standalone architecture; the latter is more consistent with WS14's stated intent of one
  shared letterhead engine but is a bigger structural change to how printing works today.
- [ ] **Dead-code deletion boundary (point 7).** Delete all six identified zero-caller
  functions/chains in one pass (`renderBSQuoteBuilder`, `renderBSDashboard`, `renderBKQuoteList`,
  `renderBKPackages`, `renderQuoteList`+`openQuoteEditor`+`printQuote`, plus
  `mmToFeetStr`/`feetStrToMm` in the iframe) — ~1,190 lines — or does Fable want a wider audit
  pass first (dead CSS tied only to these functions' markup, per the Constraints note) before
  committing to an exact deletion list matching the mandate's "~1,800" figure?
- [ ] **`quotes` legacy collection — retire alongside its dead reader?** `renderQuoteList`
  (the dead function reading the legacy `quotes` collection, point 7) is gone either way once
  deleted, but the `quotes` collection itself is still read by `getAllQuotes()`
  (app.js:2048-2060, merged into dashboards/Analytics) and has its own `firestore.rules` block
  (554-557, `allow read: if isAuth() && !isPartner(); allow write: if isAuth() && isAdmin();`).
  Does any live `quotes` doc data still matter (needs a one-time migration into `bk_quotes`/
  `bs_quotes`), or is it confirmed empty/abandoned and safe to leave read-only exactly as is?
- [ ] **Unify `bk_quotes`/`bs_quotes` into one collection with a `company` field**, matching
  how `products-database.json`'s pricing already treats BK/BS/PT as one product catalog with a
  brand toggle — or keep them separate (simpler rules, matches the deliberate partner-isolation
  split in Constraints)? This is the same fork WS32 raises independently for the three CLIENT
  collections (`sales_clients`/`design_clients`/`bs_clients`) — a decision here should be made
  jointly with that brief's decision 1, not independently, since both hinge on the same
  brand-taxonomy question.
- [ ] **Generic-partner (`CO.PT`) quotes — which collection?** `buildQuotePayload()` sets
  `company: currentCo` which can be `'PT'` for a generic (non-Brilliant-Steel) partner
  (point 1, `applyPartnerMode`); the bridge's ternary (`data.company==='BK' ? 'bk_quotes' :
  'bs_quotes'`) currently routes ANY non-BK company — including `'PT'` — into `bs_quotes`. Is
  that intended (bs_quotes becomes the catch-all "non-BK" bucket), or should generic-partner
  quotes get their own collection/flag so they're not mixed with actual Brilliant Steel data?
- [ ] **Reconciliation/staleness surfacing.** Given point 6's finding that every step of
  filed→won→sales-order is a manual click with no automatic transition or nudge, should this
  workstream add a "quotes filed >N days with no Sales Order yet" surfacing (a new Analytics
  card, a notification, or a filter on the Quotations summary screens), or is that explicitly
  out of scope / better suited to fable-workplan/32-sales-crm.md's per-client timeline (which
  would surface exactly this kind of staleness once built)?
- [ ] **Approval-request schema addition for the collection fix.** If Fable decides
  `approval_requests` needs a `quoteCollection`/`company` field to support routing approvals
  correctly per open-decision 1, is that a required field on all new docs going forward with
  existing pending docs treated as `'bs_quotes'` (today's implicit default), or does it need a
  backfill pass across any currently-pending `approval_requests` docs?

## Risks / cross-workstream interactions

- Direct overlap with **fable-workplan/32-sales-crm.md**: that brief's point 9 explicitly flags
  this exact mandate text and could not verify the stranding bug from its own grep pass ("Current
  code at app.js:8183 does correctly route company==='BK' quotes to bk_quotes... Fable should
  re-verify"). This brief supplies that re-verification with the exact missing piece (the
  `QUOTE_APPROVAL_REQUESTED` branch at app.js:8231) — Fable should treat this brief as the
  authoritative source for the stranding/approval bugs and 32-sales-crm.md as authoritative for
  the client↔quote join/timeline questions, not re-derive either independently.
- 32-sales-crm.md's decision 1 (unify `sales_clients`/`design_clients`/`bs_clients`?) and this
  brief's open decision on unifying `bk_quotes`/`bs_quotes` are the same underlying "is BK/BS/PT
  one brand-tagged system or three parallel systems" question, asked from two different angles
  (clients vs. quotes). If ground independently without cross-referencing, the two workstreams
  could land on opposite answers (e.g. unified clients but still-separate quote collections),
  producing an awkward half-unified data model. Whichever brief Fable specs first should note the
  decision explicitly so the other can match it.
- 32-sales-crm.md's point 9 also flags the client-# auto claim as unverifiable/possibly stale —
  this brief's point 12 corroborates that independently (found only a quote-number sequence
  digit, not a client identifier) without spending further budget re-litigating it, per this
  brief's explicit instruction not to re-investigate that part of the mandate.
- The dead-code deletion (point 7) touches `js/departments.js` in the same broad region
  (departments.js:6199-10031) that fable-workplan/32-sales-crm.md's own "Files likely touched"
  list also names for its client/quote-timeline work (`renderClientProfiles`,
  `openClientQuotesModal`, `renderBSClientData` at 11071-11298 and 9750-9865 are adjacent to but
  distinct from the dead functions identified here) — sequence the dead-code deletion pass early
  and get it merged before 32's timeline work lands, so line numbers in that brief's own citations
  don't shift out from under a concurrent PR.
- Fixing the stranding bug (open decision 1) changes which collection newly-approved BK quotes
  live in — if 32-sales-crm.md's per-client timeline work has already shipped against "read
  bs_quotes for non-BK, bk_quotes for BK" as a hard assumption, a later stranding fix could
  silently break that timeline's queries for quotes filed during the stranded-bug window
  (needs a migration, per open decision 2, not just a forward-only code fix).
- `renderProductDatabase` (app.js:1573-1920+) is president-gated only (`isPresident()` at
  app.js:2026) — adding a photo-upload UI there is consistent with the existing single-owner
  product-database editing model, but if Fable's spec wants Sales/BS staff to also be able to
  attach photos (e.g. from a jobsite), that needs either a role-gate change on that page or a
  new, separate lighter-weight photo-only upload surface — not assumed by this brief.
- Any change to the `bs_quotes`/`bk_quotes` `firestore.rules` blocks (563-587) to support a
  unified collection or a new `quoteCollection` field on `approval_requests` must preserve the
  partner-isolation read rule exactly (Constraints above) — this is the same class of accidental-
  widening risk fable-workplan/32-sales-crm.md flags for `bs_clients`' already-loose partner read
  rule; don't let a `bk_quotes`/`bs_quotes` unification accidentally hand partners read access to
  internal Barro Kitchens quotes.
- The two dead in-page builders (`renderBSQuoteBuilder`, and by extension the abandoned
  `renderBKQuoteList`/`renderQuoteList` chain) independently duplicate the SAME "Request
  Approval" / "file a quote" logic the live iframe bridge implements — if Sonnet deletes them
  without first confirming zero callers via a fresh grep (Constraints above), and something
  reintroduces a caller during a concurrent edit, deleting them could break a nav path that
  silently started depending on one mid-review. Low risk given the current zero-caller
  confirmation, but worth the one-line re-check the Constraints section already calls for.

## Files likely touched

`quote-builder-v2.html` (the entire file — Quick Quote mode as new UI, product-photo grid/
picker, letterhead adoption if chosen, `mmToFeetStr`/`feetStrToMm` removal); `js/app.js`
(`renderQuoteBuilderIframe` ~1152-1231 for Quick-Quote iframe params/mode; the message bridge
~8132-8254 for the stranding fix; `renderProductDatabase` + `collectAndSaveProduct` ~1573-1920
for the photo field/upload UI; `reopenQuoteFromDoc`/`newRevisionFromDoc` ~1298-1345 if collection
routing changes; `getAllQuotes` ~2048-2060 if the `quotes`/`bk_quotes`/`bs_quotes` merge changes);
`js/departments.js` (delete `renderBSQuoteBuilder`+`renderBSDashboard` ~8507-9108,
`renderBKQuoteList`+`renderBKPackages` ~6199-6804, `renderQuoteList`+`openQuoteEditor`+
`printQuote` ~9870-10031; fix the Approvals `'roa'`-chip handlers ~10951-10993 to route through
`approveQuoteApproval`/`openQuoteApprovalReview` ~11003-11069; `renderBKQuotationsSummary`
~6554-6749 and `renderBSQuotationsSummary` ~9109-9250ish if stranded-quote visibility is
patched; `loadBSContent`'s switch ~8381-8389 stays as-is unless the dead builder's removal
requires updating the case list — it already doesn't call it); `firestore.rules`
(`bk_quotes`/`bs_quotes` ~563-587 if unified or if `approval_requests` gains a
`quoteCollection` field; `products`/`productMeta` ~633-640, read-only unless the photo field
needs its own validation clause; the legacy `quotes` block ~554-557 if retired); `products-
database.json` (photo field addition + re-export if the offline fallback needs to carry photos
too); `sw.js` (`CACHE_VER` bump for any `js/app.js`/`js/departments.js` edit per Constraints;
new `PRECACHE` entries only if the iframe is split into separate `.js`/`.css` files).

## Expected deliverable format

A numbered build spec Sonnet can execute without further judgment calls: (1) the exact fix for
the stranding bug — the precise before/after code for `app.js:8224-8231`'s hardcoded
`bs_quotes` write and every downstream function that also hardcodes it
(`approveQuoteApproval`/`returnQuoteToPartner`/`openQuoteApprovalReview`/
`saveReviewedPartnerQuote`), plus the migration approach for already-stranded live docs; (2) the
exact fix for the "approving without filing" bug — before/after code for the `'roa'`-chip
handlers at departments.js:10977-10992, routing them through the same
`approveQuoteApproval`/`openQuoteApprovalReview` calls the `'all'`-chip already uses; (3) the
exact deletion list for dead code — file, start line, end line, and function name for each of
the six confirmed zero-caller chains (total ~1,190 lines), with an explicit note that Sonnet must
re-run the zero-caller grep check immediately before deleting each one; (4) the exact Quick Quote
3-step data flow — what state each step collects, how it hands off to `buildQuotePayload()`/
`fileQuotation()` (or its own new filing path), and exact markup/CSS for the product photo grid,
following the before/after code-block convention used in prior briefs' Spec sections; (5) the
exact `products`/`productMeta` (and `products-database.json`) field addition for photos, plus
the exact `Drive.renderUploadArea` wiring into `renderProductDatabase`'s add/edit form
(app.js:1573-1920), including whether/how the photo also flows into `quote-builder-v2.html`'s
`loadDatabase()` product shape (quote-builder-v2.html:1054-1075, which explicitly hand-maps every
field today and would silently drop an unmapped photo field); (6) the letterhead-adoption
decision for printed quotes, with exact before/after code for wherever `doPrint()`
(quote-builder-v2.html:2681-2707) or its replacement lives; (7) an explicit sequencing note
against fable-workplan/32-sales-crm.md covering the shared BK/BS-unification question and the
adjacent-file-region dead-code-deletion-before-32-lands point, so Sonnet does not implement one
workstream's fix in a way that invalidates the other's line-number citations or data-shape
assumptions.

## DECIDED — architecture spec (Fable, 2026-07-11)

> **READ FIRST — dependency contract:** WS32 (32-sales-crm.md, DECIDED 2026-07-10) has already
> landed by the time this workstream is implemented. WS31 inherits and MUST preserve: (1) the
> unified `clients` collection + `clientId` FK stamped by the bridge (`upsertClient = () =>
> window.Clients.upsertFromQuote(data)`, upsert-BEFORE-add, WS32 Spec 5a) — every before/after
> block below is written against the POST-WS32 bridge, not today's checkout; (2) the canonical
> `window.isQuoteWon/isQuoteLost/isQuoteOpen` helpers in config.js — any status-vocabulary work
> here updates those three helpers ONLY, never per-screen; (3) `openClientHub`'s `_coll`-aware
> Reopen/New-Revision (WS32 Spec 4a) — collection routing changes here must keep that working.
> WS32's Spec 11 contract explicitly assigns the `QUOTE_APPROVAL_REQUESTED`-always-into-
> `bs_quotes` stranding fix to THIS workstream. Sequencing: WS32 ships + its client migration
> runs FIRST; then WS31 in the order given in Spec 11 below.

### Resolved decisions (numbered to match the open-decisions list above)

1. **Stranding fix → the REAL fix: route `QUOTE_APPROVAL_REQUESTED` by `data.company` (reuse the
   `coll` ternary already computed at app.js:8183) and thread the collection through every
   downstream approval function via a new `quoteColl` field on `approval_requests`.** The
   paper-over option (make the BK summary also read `bs_quotes`) was rejected: it leaves BK data
   permanently in the wrong collection, silently breaks the partner-isolation intent of the
   split (BK quotes would live in the collection partners can query their own rows of), and
   every future reader (WS40 analytics, WS32 timelines) would have to know about the exception
   forever. The downstream functions (`approveQuoteApproval`, `returnQuoteToPartner`,
   `openQuoteApprovalReview`, `saveReviewedPartnerQuote`) gain a collection parameter defaulting
   to `'bs_quotes'` — which makes every legacy pending `approval_requests` doc (no `quoteColl`
   field) behave exactly as today, so no backfill is needed (decision 14).
2. **Migration for already-stranded docs → one-click idempotent `window.migrateStrandedBKQuotes()`
   that MOVES each `bs_quotes` doc with `company=='BK'` to `bk_quotes` PRESERVING THE DOC ID**
   (`bk_quotes.doc(sameId).set(data)` then delete the original). Preserving the id means
   `sales_orders.quoteId`, `approval_requests.quoteId`, and WS32's `clients`-side joins all stay
   valid with zero reference rewrites; only `approval_requests.quoteColl` is stamped during the
   move. `company=='PT'` docs are explicitly NOT moved (decision 12). Live count is unknown from
   the static pass — the repair button reports it (‼️ FLAG FOR NEIL below). Requires one rules
   clause so an admin can create the migrated doc (Spec 8).
3. **"Approving without filing" → the naive `roa`-chip handlers (departments.js:10977-10992) are
   RETIRED; the `'roa'` chip renders the SAME three actions as the `'all'` chip (📝 Open & Edit /
   ✓ Approve / ↩ Return) wired to the SAME shared functions** (`openQuoteApprovalReview` /
   `approveQuoteApproval` / `returnQuoteToPartner`). The bare "Reject" (which never touched the
   quote) is replaced by "Return to Partner" — matching the `'all'` chip, which is the behavior
   the notification copy already promises ("approved **and filed**"). One guarded fallback: an
   `approval_requests` row with NO `quoteId` (malformed/legacy) renders resolve-only buttons that
   update just the request doc, clearly labeled "(no linked quote)" — so old junk rows can still
   be cleared without pretending a quote was filed. The `'roa'` list also gains the
   `type!=='ca_deduct'` filter the `'all'` chip already applies (today a CA-deduction row in the
   roa chip would render as a "Quote" — same-class bug, fixed in passing).
4. **`status` vs `approvalStatus` → KEEP BOTH FIELDS (reader compatibility), but canonicalize
   writes through one `window.quoteStateFields(state)` table in config.js** used by every write
   site this workstream touches (bridge, the three approval functions,
   `saveReviewedPartnerQuote`). Collapsing to one field was rejected: dozens of existing docs and
   several readers (`statusBadge` maps at departments.js:11242/9829, `renderBSQuotationsSummary`'s
   `forApproval` bucket at 9122, WS32's `openClientHub` badge) read both, and WS32 already
   canonicalized the read side via `isQuoteWon/isQuoteLost/isQuoteOpen` — the remaining bug
   surface is write-site drift, which the shared table closes. No migration of existing docs;
   readers stay tolerant.
5. **Quick Quote 3-step mode → lives INSIDE `quote-builder-v2.html` as a new `quickMode`
   overlay**, reusing 100% of the existing pricing (`buildCalcPanel`/`computePrice`), items
   (`renderItems`), totals (`computeTotals`), and filing (`doVerifyAndFile`/`fileQuotation`/
   `buildQuotePayload`) machinery — the wizard is UI shell only, zero new pricing/filing logic.
   A separate iframe or a parent-app overlay was rejected: both would need postMessage round-trips
   into the pricing engine for every line item, duplicating exactly the logic this file owns.
   Entered via a `⚡ Quick Quote` toggle in the builder's top bar or `?mode=quick`. Step 1 also
   delivers WS32's contract item: a client picker reading the unified `clients` collection that
   stamps `payload.clientId` (Spec 5e), closing the typo-duplicate-client path.
6. **Product photos → ONE `photoUrl` string field on `products/{id}`** (single photo per product
   — multiple photos is catalog-management scope creep with no consumer; revisit if Neil asks),
   uploaded via `Drive.renderUploadArea` wired into `renderProductDatabase`'s existing
   `formRow`/`collectAndSaveProduct` (mirroring the `pdbBom` per-prefix pattern).
   `products-database.json` is NOT backfilled — it is a hand-synced offline fallback; all
   photo-rendering surfaces MUST placeholder gracefully when `photoUrl` is absent, which also
   covers the fallback path automatically. Re-exports via `exportDatabase()` carry the field for
   free (it exports the in-memory `DB`, which now maps it). Backfilling photos onto the 165
   existing products is a MANUAL data-entry task for Neil/staff via the edit form (not Sonnet
   scope); a 📷 missing indicator in the Product Database list makes progress visible.
7. **Photo display surfaces → Quick Quote step-2 grid (mandate) + full-builder search dropdown
   (36px thumb). NOT the items table, NOT the printed quote.** The items table is a dense
   9-column editable grid where thumbnails destroy row height for no decision value; printed
   photos raise page-break/file-size/print-CSS work with real regression risk to a
   client-facing document — deferred, ‼️ FLAG FOR NEIL (the mandate's "printed quote" phrase is
   deliberately not shipped in v1; see Flags).
8. **Letterhead → load `js/letterhead.js` into the iframe and pass the iframe's own `CO`
   branding as `opts.entity`.** Verified against js/letterhead.js:12-16 and 24-26: the engine has
   its OWN `escHtml` fallback and accepts `opts.entity`, bypassing `window.BRAND` entirely — so
   NO port of config.js/escHtml into the iframe is needed (the brief's "duplicate ~100-200
   lines" premise is avoidable). Moving printing to the parent app was rejected as a large
   structural change to a working print path for the same visual result. The legacy
   `#printHeader` markup stays as a graceful fallback for `file://`/offline (where the extra
   script may not load). Footer (`thanks`/`creds` block) stays as-is — header unification only.
9. **Dead code → delete ALL six confirmed zero-caller chains (~1,190 lines) in ONE dedicated
   first commit, plus the orphaned CSS those chains' markup classes own** (`.bs-qb*`,
   `.bs-section`, `.bs-items-table` etc. — Sonnet greps each class name across the repo before
   deleting its rule). Do NOT chase the mandate's "~1,800" figure — 1,190 is the verified floor;
   dead branches inside live functions are out of scope (too risky for a grep-driven pass).
   Sonnet MUST re-run the zero-caller check (`grep -c 'name(' file` == 1) immediately before
   deleting each function, per the concurrent-sessions constraint.
10. **Legacy `quotes` collection → LEFT AS-IS (read-only rules, still merged by
    `getAllQuotes()`).** Its dead reader chain (`renderQuoteList`+`openQuoteEditor`+`printQuote`)
    is deleted, but the collection keeps feeding dashboards/Analytics historical rows and WS32's
    `isQuoteWon` explicitly handles its `accepted` status. No migration (needs a live-data
    audit nobody has done; records-forever directive applies) — ‼️ FLAG FOR NEIL as an eventual
    archive candidate only.
11. **`bk_quotes`/`bs_quotes` unification → NO — keep the two collections.** Aligned with WS32,
    whose entire DECIDED spec assumes the split persists (its `_coll` field, `getAllQuotes`
    merge, and partner-isolation reasoning are all built on it), and whose client-side answer to
    the brand-taxonomy fork was "one collection with a brands[] tag" only because clients have no
    partner-visibility split. Quotes DO: `bs_quotes` reads are partner-scoped
    (`createdBy==uid || !isPartner()`), `bk_quotes` is partner-invisible — one merged collection
    would force per-doc read rules keyed on `company`, a strictly worse rules surface for zero
    UX gain (readers already merge via `getAllQuotes`). The stranding fix (decision 1) removes
    the only actual pain the split causes.
12. **`CO.PT` (generic-partner) quotes → stay in `bs_quotes`, deliberately.** This matches WS32's
    shipped mapping (`company!=='BK'` → brand `'bs'` in `Clients.upsertFromQuote`) and the
    partner rules already scope every partner to `createdBy==uid` regardless of company. A third
    collection would need its own rules block, summary screen, delete-queue query, and
    `getAllQuotes` merge for a handful of docs. The `company:'PT'` field on the doc remains the
    discriminator for any future per-partner-company reporting.
13. **Staleness surfacing → a lightweight render-time badge on the two Quotations summary
    screens ONLY** (`⚠ filed Nd — no Sales Order` on quotes that are `isQuoteWon()===false`,
    `status==='filed'`, no `salesOrderId`, and >14 days old, plus a header count chip). Pure
    client-side logic over data those screens already fetch — zero new reads, no notifications,
    no new collections. A cross-dept staleness Analytics card belongs to WS40; per-client
    staleness is already visible in WS32's timeline. `window.QUOTE_STALE_DAYS = 14` in config.js
    so the threshold is one constant.
14. **`approval_requests.quoteColl` → required on all NEW docs (written by the bridge), absent
    docs default to `'bs_quotes'` at read time (`item.quoteColl||'bs_quotes'`) — NO backfill.**
    The default is exactly correct for every legacy doc, because before this fix every
    approval-round-trip quote WAS written to `bs_quotes`; the stranded-quote migration (Spec 4)
    re-stamps the moved ones to `'bk_quotes'`. No rules change (the `approval_requests` block
    does no shape validation).

---

### Spec 1 — config.js additions (canonical write-side status table + staleness constant)

Place next to the WS32 helpers (`isQuoteWon` etc.); config.js loads before every caller.

```js
// ── Canonical quote status/approvalStatus WRITE pairs (v12 WS31) ─────────
// Both fields are kept for reader compatibility; every write site sets them
// TOGETHER via this table so they can never drift again (the roa-chip bug was
// enabled by independent, partial writes). Read-side truth stays
// isQuoteWon/isQuoteLost/isQuoteOpen (WS32) — do not branch on raw strings.
window.quoteStateFields = function (state) {
  return ({
    filed:            { status:'filed',            approvalStatus:'filed'          },
    pending_approval: { status:'pending_approval', approvalStatus:'pending_review' },
    approved:         { status:'filed',            approvalStatus:'approved'       },
    needs_revision:   { status:'needs_revision',   approvalStatus:'needs_revision' },
    rejected:         { status:'rejected',         approvalStatus:'rejected'       },
  })[state] || { status: state, approvalStatus: state };
};
window.QUOTE_STALE_DAYS = 14;   // "filed but no Sales Order" badge threshold (decision 13)
```

### Spec 2 — Bridge fix (js/app.js, the `QUOTE_APPROVAL_REQUESTED` branch)

Written against the POST-WS32 bridge (upsert-before-add, `data.clientId` stamped). The `coll`
ternary at app.js:8183 (`const coll = (data.company === 'BK') ? 'bk_quotes' : 'bs_quotes';`) and
the whole `QUOTE_FILED` branch are UNCHANGED.

```js
// BEFORE (the else branch — comment cites the old hardcoded round-trip design)
    } else {
      // QUOTE_APPROVAL_REQUESTED — the president's approve/reject handler reads
      // bs_quotes by id, so the approval round-trip always lives in bs_quotes
      // (regardless of company) to keep that flow working unchanged.
      data.status = 'pending_approval';
      data.approvalStatus = 'pending_review';
      data.reviewRequestedAt = firebase.firestore.FieldValue.serverTimestamp();
      data.clientId = await upsertClient();
      const docRef = await db.collection('bs_quotes').add(data);
      await db.collection('approval_requests').add({
        type: 'bs_quote',
        quoteId: docRef.id,
        ...
```
```js
// AFTER — route by company like QUOTE_FILED (v12 WS31: fixes "BK quotes stranded
// in bs_quotes"); the approval_requests doc records WHICH collection the quote
// lives in so the approve/return handlers update the right doc.
    } else {
      Object.assign(data, window.quoteStateFields('pending_approval'));
      data.reviewRequestedAt = firebase.firestore.FieldValue.serverTimestamp();
      data.clientId = await upsertClient();
      const docRef = await db.collection(coll).add(data);
      await db.collection('approval_requests').add({
        type: 'bs_quote',            // legacy type value kept — readers filter on it
        quoteId: docRef.id,
        quoteColl: coll,             // NEW (decision 14) — 'bk_quotes' | 'bs_quotes'
        quoteNumber: payload.quoteNumber,
        clientName: payload.clientName,
        total: payload.total || 0,
        agentName,
        agentId: currentUser.uid,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      ...   // sendToOwner + toast unchanged
    }
```
Also in the `QUOTE_FILED` branch, replace the two manual lines `data.status='filed';
data.approvalStatus='filed';` with `Object.assign(data, window.quoteStateFields('filed'));`
(behavior-identical; adopts the canonical table).

**WS32-contract patch — `Clients.upsertFromQuote` (departments.js, inside `window.Clients`)
learns to trust a builder-supplied `clientId`** (Quick Quote's picker, Spec 5e). Insert at the
top of `upsertFromQuote(q)`, before the `nameKey` query:
```js
    // A builder-picked clientId is authoritative — update that doc directly and
    // skip the nameKey lookup (closes the typo-duplicate path, WS32 Spec 11).
    if (q.clientId) {
      try {
        await db.collection('clients').doc(q.clientId).set({
          lastQuoteNumber: q.quoteNumber || '', lastQuoteTotal: q.total || 0,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
        return q.clientId;
      } catch (_) { /* fall through to nameKey path */ }
    }
```
And in the bridge, `data.clientId = await upsertClient();` needs no change — `data.clientId` is
set from `payload.clientId` during the field-mapping block (add `clientId: payload.clientId ||
null,` to the `data = {...}` literal near `company:`), and `upsertFromQuote` reads `q.clientId`
from `data`, returning it back.

### Spec 3 — Approval-side collection threading (departments.js + app.js)

**3a — new signatures (default keeps legacy behavior):**
```js
async function approveQuoteApproval(quoteId, agentId, qno, name, coll)         // coll default 'bs_quotes'
async function returnQuoteToPartner(quoteId, agentId, qno, name, notes, coll)  // coll default 'bs_quotes'
async function openQuoteApprovalReview(ctx, onDone)   // ctx gains quoteColl ('bs_quotes' default)
async function saveReviewedPartnerQuote(ctx, action)  // reads ctx.quoteColl||'bs_quotes'
```

**3b — `approveQuoteApproval` (departments.js:11003-11012) body changes:** first line becomes
`coll = coll || 'bs_quotes';`; the update becomes
```js
    await db.collection(coll).doc(quoteId).update({
      ...window.quoteStateFields('approved'),
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(), approvedBy: currentUser.uid });
```
plus `dbCacheInvalidate && dbCacheInvalidate('all-quotes');` after the approval_requests
resolution (the WS32 hub reads through that cache). Same two changes (`coll` param +
`quoteStateFields('needs_revision')` + cache invalidate) in `returnQuoteToPartner` (11014-11025).

**3c — `openQuoteApprovalReview` (11027-11069):** add `const QC = ctx.quoteColl || 'bs_quotes';`
at the top; ALL THREE `db.collection('bs_quotes')` sites inside it (the initial `.get()`, the
approve handler's `.update()`, the return handler's `.update()`) become `db.collection(QC)`;
the two handlers adopt `...window.quoteStateFields('approved')` / `('needs_revision')`; the
Open-in-Builder handler becomes collection- and brand-aware:
```js
    window._qbReviewContext = { quoteId, partnerUid: agentId, quoteNumber: quoteNumber||q.quoteNumber,
      clientName: q.clientName||clientName, quoteColl: QC };
    closeModal();
    window.reopenQuoteFromDoc(QC, quoteId, q.company === 'BK' ? 'bk-quote-builder' : 'bs-quote-builder');
```

**3d — `saveReviewedPartnerQuote` (js/app.js:1247-1295):**
`db.collection('bs_quotes').doc(ctx.quoteId)` → `db.collection(ctx.quoteColl || 'bs_quotes')
.doc(ctx.quoteId)`; the status assignments in both action branches adopt
`Object.assign(update, window.quoteStateFields(action === 'approve' ? 'approved' : 'needs_revision'));`
(the `approvedAt/approvedBy/returnedAt/returnedBy/presidentNotes` lines stay).

**3e — `'all'`-chip call sites (departments.js:10245-10247 templates, 10418-10429 wiring):** the
three `qa-*` button templates each gain `data-coll="${item.quoteColl||'bs_quotes'}"`; the wiring
passes it: `openQuoteApprovalReview({ ..., quoteColl: btn.dataset.coll }, ...)`,
`approveQuoteApproval(btn.dataset.quote, btn.dataset.by, btn.dataset.qno, btn.dataset.name,
btn.dataset.coll)`, `returnQuoteToPartner(..., notes, btn.dataset.coll)`.

### Spec 4 — The `'roa'` chip fix (departments.js:10953-10993, the terminal `else`)

Replace the item mapping + handlers. BEFORE: renders `.approve-approval`/`.reject-approval`
buttons whose handlers update ONLY `approval_requests` (quoted in Current-state point 4 —
the literal "approving without filing" bug). AFTER:

```js
    } else {
      // Quote / ROA approvals — same shared handlers as the 'all' chip (v12 WS31:
      // the old inline approve/reject here never touched the quote doc at all).
      const snap = await db.collection('approval_requests').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
      const items = snap.docs.map(d => ({id:d.id,...d.data()})).filter(i => i.type !== 'ca_deduct');
      if (!items.length) { wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">✔️</div><h4>No quote approvals</h4></div>'; return; }
      wrap.innerHTML = `<div class="item-list">${items.map(item => `
        <div class="item-card" data-id="${item.id}">
          <div class="item-top">
            <div class="item-title">${item.type==='bs_quote'?'Quote Approval':'Quote'} — ${escHtml(item.clientName||'')}</div>
            <span class="badge ${statusBadge(item.status)}">${item.status||'pending'}</span>
          </div>
          <div class="item-meta">
            <span>${escHtml(item.agentName||'—')}</span>
            <span>₱${fmt(item.total)}</span>
            ${item.quoteNumber?`<span style="font-family:monospace">${escHtml(item.quoteNumber)}</span>`:''}
            ${item.createdAt?`<span>${new Date(item.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
          </div>
          ${(item.status==='pending'&&canActOn('quote-approval')) ? (item.quoteId ? `
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn-primary btn-sm qa-review-btn" data-id="${item.id}" data-quote="${item.quoteId}" data-coll="${item.quoteColl||'bs_quotes'}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">📝 Open &amp; Edit</button>
            <button class="btn-success btn-sm qa-approve-btn" data-id="${item.id}" data-quote="${item.quoteId}" data-coll="${item.quoteColl||'bs_quotes'}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">✓ Approve</button>
            <button class="btn-danger btn-sm qa-return-btn" data-id="${item.id}" data-quote="${item.quoteId}" data-coll="${item.quoteColl||'bs_quotes'}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">↩ Return to Partner</button>
          </div>` : `
          <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
            <span style="font-size:11px;color:var(--text-muted)">(no linked quote)</span>
            <button class="btn-secondary btn-sm roa-resolve-btn" data-id="${item.id}" data-agent="${item.agentId||''}" data-status="approved">Mark Approved</button>
            <button class="btn-secondary btn-sm roa-resolve-btn" data-id="${item.id}" data-agent="${item.agentId||''}" data-status="rejected">Mark Rejected</button>
          </div>`) : ''}
        </div>`).join('')}</div>`;
      wrap.querySelectorAll('.qa-review-btn').forEach(btn => btn.addEventListener('click', () =>
        openQuoteApprovalReview({ quoteId:btn.dataset.quote, agentId:btn.dataset.by, quoteNumber:btn.dataset.qno,
          clientName:btn.dataset.name, quoteColl:btn.dataset.coll }, () => loadApprovalsSub('roa'))));
      wrap.querySelectorAll('.qa-approve-btn').forEach(btn => btn.addEventListener('click', async () => {
        await approveQuoteApproval(btn.dataset.quote, btn.dataset.by, btn.dataset.qno, btn.dataset.name, btn.dataset.coll);
        loadApprovalsSub('roa');
      }));
      wrap.querySelectorAll('.qa-return-btn').forEach(btn => btn.addEventListener('click', async () => {
        const notes = (await promptDialog({message:'Notes for the partner (what to revise)?', multiline:true}))||'';
        await returnQuoteToPartner(btn.dataset.quote, btn.dataset.by, btn.dataset.qno, btn.dataset.name, notes, btn.dataset.coll);
        loadApprovalsSub('roa');
      }));
      wrap.querySelectorAll('.roa-resolve-btn').forEach(btn => btn.addEventListener('click', async () => {
        await db.collection('approval_requests').doc(btn.dataset.id).update({ status: btn.dataset.status });
        Notifs.showToast('Request resolved (no quote doc was linked).'); loadApprovalsSub('roa');
      }));
    }
```
Note: `approveQuoteApproval` sends the "approved and filed" notification itself — the naive
handler's own `Notifs.send` disappears with it (no double-notify). No other caller depends on
the deleted `.approve-approval`/`.reject-approval` classes (grep before deleting to confirm).

### Spec 5 — Quick Quote 3-step mode (quote-builder-v2.html)

**5a — state + entry.**
```js
let quickMode=false, qqStep=1, qqSelectedClientId=null, qqClients=null; // near the other state lets (~962)
```
Top bar gains a toggle button next to the view pills: `<button class="btn" id="btnQuick"
onclick="toggleQuickMode()">⚡ Quick Quote</button>`. `toggleQuickMode()` flips `quickMode`,
toggles `document.body.classList.toggle('body-quick', quickMode)`, and calls `qqRender()`.
Startup: in the init path that already parses `?portal=partner`, also read
`new URLSearchParams(location.search).get('mode')==='quick'` → enable quickMode after `initUI()`.
`applyPartnerMode()` leaves the toggle visible (partners may use Quick mode; it files through the
same `fileQuotation()` gate). The Admin pill stays hidden in quick mode via CSS.

**5b — shell markup** (static, inserted once after the top bar in the HTML body):
```html
<div id="qqWizard" style="display:none">
  <div class="qq-steps">
    <span class="qq-step" data-s="1">1 · Client</span>
    <span class="qq-step" data-s="2">2 · Products</span>
    <span class="qq-step" data-s="3">3 · Review &amp; Send</span>
  </div>
  <div id="qqBody"></div>
  <div class="qq-nav">
    <button class="btn" id="qqBack" onclick="qqGo(-1)">‹ Back</button>
    <button class="btn btn-green" id="qqNext" onclick="qqGo(1)">Next ›</button>
  </div>
</div>
```
```css
/* Quick Quote wizard (v12 WS31) */
.body-quick .section, .body-quick #btnAdmin { display:none!important; }
.body-quick #qqWizard { display:block!important; }
.qq-steps{display:flex;gap:8px;margin:10px 0 14px}
.qq-step{padding:6px 14px;border-radius:20px;background:var(--gray-light,#eee);font-size:13px;font-weight:700;opacity:.55}
.qq-step.on{background:#F0A500;color:#fff;opacity:1}
.qq-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.qq-card{border:1.5px solid var(--gray,#ccc);border-radius:12px;overflow:hidden;cursor:pointer;background:#fff;text-align:left}
.qq-card:active{transform:scale(.98)}
.qq-photo{width:100%;height:100px;object-fit:cover;display:block;background:var(--gray-light,#f2f2f2)}
.qq-photo-ph{width:100%;height:100px;display:flex;align-items:center;justify-content:center;font-size:34px;background:var(--gray-light,#f2f2f2)}
.qq-card-name{font-size:12.5px;font-weight:700;padding:7px 9px 2px;line-height:1.25}
.qq-card-price{font-size:12px;color:var(--gray-dark,#777);padding:0 9px 8px}
.qq-nav{display:flex;justify-content:space-between;margin-top:16px}
.qq-badge{position:sticky;bottom:8px;text-align:center;font-size:13px;font-weight:700;color:#F0A500}
@media print { #qqWizard{display:none!important} }
```

**5c — `qqRender()` step panels.** All markup interpolating client-derived text uses `attrEsc()`
for attributes and a local `txtEsc(s)` (`attrEsc` + `<`/`>` replacement — add it next to
`attrEsc` at line 1019) for text nodes — `escHtml` does NOT exist in this document.
- **Step 1 — Client:** inputs `qq-name/qq-company/qq-phone/qq-email/qq-addr`, prefilled FROM the
  main form's client fields (Sonnet: reuse the exact element ids `buildQuotePayload()` reads —
  grep `clientName` in the payload builder for the id list). Above them, a client picker:
  `<input list="qqClientList" id="qq-pick" placeholder="Search existing clients…">` +
  `<datalist id="qqClientList">`. Populate lazily once:
  ```js
  async function qqLoadClients(){
    if (qqClients) return qqClients;
    try { const s = await db.collection('clients').limit(500).get();       // partner sessions: rules deny → catch
      qqClients = s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    } catch(_) { qqClients = []; }
    return qqClients;
  }
  ```
  On picker match (exact name), set `qqSelectedClientId = c.id` and prefill the five fields from
  the client doc; any manual edit to `qq-name` clears `qqSelectedClientId` (a typed-over name is
  a different client). "Next" from step 1 requires non-empty `qq-name`, then copies the five
  values into the main form's client inputs (single source of truth stays the main form —
  `buildQuotePayload()` is untouched except 5e).
- **Step 2 — Products:** category chip row (from `DB.categories`, reusing `currentCatFilter`) +
  `.qq-grid` of `filteredProducts('')`:
  ```js
  html += prods.map(p=>`<button class="qq-card" onclick="qqPick('${attrEsc(p.id)}')">
      ${p.photoUrl ? `<img class="qq-photo" loading="lazy" src="${attrEsc(p.photoUrl)}" onerror="this.outerHTML='<div class=&quot;qq-photo-ph&quot;>🍳</div>'">`
                   : `<div class="qq-photo-ph">🍳</div>`}
      <div class="qq-card-name">${txtEsc(p.name)}</div>
      <div class="qq-card-price">${p.formulaType==='fixed'?'':'from '}${formatPeso(p.basePrice)}</div>
    </button>`).join('');
  ```
  `qqPick(id)` calls the EXISTING `selectProduct(id)` so the real calc panel (dimensions, qty,
  computePrice) opens exactly as in the full builder — no forked pricing; after the existing
  "Add to quote" handler runs, quick mode re-renders step 2 with a sticky
  `<div class="qq-badge">🧺 ${items.length} item(s) · ${formatPeso(computeTotals().grand)}</div>`.
  (Sonnet: hook the existing add-item completion point — the same function that calls
  `renderItems()` — with `if(quickMode) qqRender();`.)
- **Step 3 — Review:** re-show the existing items table + totals sections inside the wizard
  (`body-quick` CSS unhides `#itemsSection` and the totals block via an added
  `.body-quick.qq-s3 #itemsSection{display:block!important}` pair — Sonnet greps the actual
  section ids), plus the `reqApprovalCheck` checkbox row, plus one primary button `📁 Verify &
  File` wired to the EXISTING `doVerifyAndFile()` — the existing verify modal and
  `fileQuotation()` (including the approval-request path) run unchanged.

**5d — `qqGo(delta)`**: bounds 1..3, validates step 1's name, toggles `.qq-step.on` and a
`qq-s{n}` body class, `qqRender()`.

**5e — payload FK.** In `buildQuotePayload()` (2544-2619) add one field to the returned object:
`clientId: qqSelectedClientId || null,`. Bridge mapping + upsert trust: Spec 2. Full-builder
filings simply carry `clientId:null` and keep today's nameKey upsert — unchanged behavior.

### Spec 6 — Product photos

**6a — write side (js/app.js, `renderProductDatabase`).** `formRow` (app.js:1602-1633) gains,
after the Specifications group:
```js
    <div class="form-group" style="grid-column:1/-1"><label>Product Photo</label>
      <div style="display:flex;gap:10px;align-items:center">
        <img id="${prefix}-photo-prev" src="${(p.photoUrl||'').replace(/"/g,'&quot;')}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);${p.photoUrl?'':'display:none'}">
        <div id="${prefix}-photo-up" style="flex:1"></div>
      </div>
    </div>
```
`wireForm(prefix)` (app.js:1704-1710) adds:
```js
    if (window.Drive?.renderUploadArea) Drive.renderUploadArea(`${prefix}-photo-up`, r => {
      pdbPhoto[prefix] = r.url;                                  // r = {url, name} per drive.js contract
      const img = document.getElementById(`${prefix}-photo-prev`);
      if (img) { img.src = r.url; img.style.display = ''; }
    }, { accept:'image/*', label:'Upload photo (JPG/PNG)', dept:'Sales', subfolder:'Product Photos' });
```
`const pdbPhoto = {};` declared next to `const pdbBom = {}` (app.js:1740). In
`collectAndSaveProduct` (1742-1783), add to the `.set()` payload:
`photoUrl: pdbPhoto[prefix] !== undefined ? pdbPhoto[prefix] : (existingId ? (undefined) : null),`
— implemented as: build the payload object first, then
`if (pdbPhoto[prefix] !== undefined) payload.photoUrl = pdbPhoto[prefix];` so an edit that never
touched the photo doesn't overwrite it (merge:true keeps the old value). Product list cards show
`📷` when `!p.photoUrl` (one-line addition to the existing card template). Rules: NO change —
`products` write is already `isAuth() && isAdmin()` (firestore.rules:633-636).

**6b — read side.** `loadDatabase()`'s Firestore field map (quote-builder-v2.html:1054-1075) adds
`photoUrl: p.photoUrl || null,` (the brief's warning: this map hand-copies every field — an
unmapped field silently drops). `renderDropdown` (1409-1432) prepends a 36px thumb inside
`.sd-item` before `.sd-item-info`:
```js
      html+=`<div class="sd-item" data-id="${p.id}" onclick="selectProduct('${p.id}')">
        ${p.photoUrl?`<img src="${attrEsc(p.photoUrl)}" loading="lazy" style="width:36px;height:36px;object-fit:cover;border-radius:6px;margin-right:8px;flex-shrink:0">`:''}
        <div class="sd-item-info">...
```
`products-database.json`: untouched (decision 6). Items table + print: untouched (decision 7).

### Spec 7 — Letterhead adoption for the printed quote (quote-builder-v2.html)

Add `<script defer src="js/letterhead.js"></script>` immediately after the
`js/firebase-config.js` tag (~line 935). letterhead.js is self-contained (own esc fallback,
js/letterhead.js:12-16; accepts `opts.entity`, line 26) and is already in sw.js PRECACHE — no
new precache entry, no config.js port. New function, called at the end of `setCompany()`,
`applyPartnerMode()`, and at the top of `doPrint()` (so the doc number is current):
```js
function applyLetterheadHeader(){
  if (typeof window.buildLetterhead !== 'function') return;   // offline/file:// → legacy header stays
  const c = CO[currentCo] || CO.BK;
  const bits = (c.contact||'').split('|').map(s=>s.trim());
  const lh = buildLetterhead({
    entity: { name:c.name, registration:c.sub||'', address:c.addr||'', phone:bits[0]||'', email:bits[1]||'' },
    docTitle: 'QUOTATION',
    docNumber: buildQuoteNo(),
    dateLabel: new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}),
    accent: currentCo==='BS' ? '#37474F' : '#1E3A5F',
    logo: (document.getElementById('phLogo')?.src) || undefined,   // reuse the per-company logo the legacy header already resolves
  });
  const ph = document.getElementById('printHeader');
  if (ph) ph.innerHTML = lh.headerHTML;
  let st = document.getElementById('lhPrintCss');
  if (!st) { st = document.createElement('style'); st.id = 'lhPrintCss'; document.head.appendChild(st); }
  st.textContent = lh.printCSS;
}
```
The legacy `#printHeader` static markup and its CSS remain in the file as the no-letterhead
fallback; the existing print footer (`thanks`/`creds`) is untouched. `doPrintAgent()` inherits
the header automatically (same `#printHeader`). Sonnet must verify one BK and one BS print
preview against the current output before shipping (client-facing document).

### Spec 8 — Migration for stranded quotes + firestore.rules diff

**8a — the ONLY rules change this workstream needs** (everything else is additive fields on
collections whose rules don't shape-validate; no new collections; no firestore.indexes.json
change — `where('company','==','BK')` and `where('quoteId','==',…)` are single-field):
```
// BEFORE (bk_quotes create clause, firestore.rules ~583)
      allow create: if isAuth() && !isPartner() && request.resource.data.createdBy == request.auth.uid;
```
```
// AFTER — admins may also create with a DIFFERENT createdBy: required by the v12
// WS31 stranded-quote migration, which moves misfiled BK docs out of bs_quotes
// preserving the ORIGINAL creator for the audit trail. Partner isolation is
// unchanged (partners still can never touch bk_quotes at all).
      allow create: if isAuth() && !isPartner() &&
        (request.resource.data.createdBy == request.auth.uid || isAdmin());
```
Deploy via `firebase deploy --only firestore:rules` (re-diff live first — concurrent-edits
memory). Partner-isolation read rules for both collections: UNCHANGED.

**8b — `window.migrateStrandedBKQuotes()`** (js/app.js, next to the bridge; president session):
```js
// One-click, idempotent: moves bs_quotes docs misfiled with company:'BK' (the old
// QUOTE_APPROVAL_REQUESTED hardcode) into bk_quotes, PRESERVING each doc id so
// sales_orders.quoteId / approval_requests.quoteId / clients joins stay valid.
// company:'PT' rows are deliberately NOT moved (bs_quotes is the non-BK bucket).
window.migrateStrandedBKQuotes = async function () {
  const FV = firebase.firestore.FieldValue;
  const out = { moved: 0, reqsPatched: 0 };
  const snap = await db.collection('bs_quotes').where('company', '==', 'BK').get();
  for (const d of snap.docs) {
    await db.collection('bk_quotes').doc(d.id).set({ ...d.data(),
      migratedFrom: 'bs_quotes', migratedAt: FV.serverTimestamp() });
    const reqs = await db.collection('approval_requests').where('quoteId', '==', d.id).get().catch(() => ({ docs: [] }));
    for (const r of reqs.docs) { await r.ref.update({ quoteColl: 'bk_quotes' }); out.reqsPatched++; }
    await db.collection('bs_quotes').doc(d.id).delete();   // copy-first ordering: a crash mid-loop leaves a duplicate (re-run cleans it), never a loss
    out.moved++;
  }
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('all-quotes');
  return out;
};
```
**Trigger UI:** in `renderBKQuotationsSummary` (departments.js:6554 on), president-only, after the
list renders, run the count query (`bs_quotes where company=='BK'`, `.get()` in a try/catch);
if `>0`, show a warning banner `🧭 N Barro Kitchens quote(s) are stranded in the Brilliant Steel
collection — [Repair now]` whose button runs the migration, toasts
`Moved N quote(s), patched M approval request(s)`, logs `window.logAudit('migrate','bk_quotes',
null,out)`, and re-renders. Idempotent: after the move the count query returns 0 and the banner
disappears. Re-run after a mid-loop crash: already-moved ids simply `set()` identical data again
(merge-free set of the same payload) and delete the leftover original.

### Spec 9 — Dead-code deletion list (ONE dedicated commit, FIRST)

For each row: re-run the zero-caller check immediately before deleting
(`grep -o 'name(' js/departments.js | wc -l` == 1, and `grep -rn 'name' --include='*.js'
--include='*.html' .` shows only the definition). Line numbers are as-of the grounding pass —
re-locate by function name, not line.

| # | File | Function/chain | ~Lines |
|---|------|----------------|--------|
| 1 | js/departments.js | `renderBSDashboard` (8507-8559) | 53 |
| 2 | js/departments.js | `renderBSQuoteBuilder` (8560-9108) — incl. its inline `<style>` block | 549 |
| 3 | js/departments.js | `renderBKQuoteList` (6199-6553) | 355 |
| 4 | js/departments.js | `renderBKPackages` (6750-6804) | 55 |
| 5 | js/departments.js | `renderQuoteList` + `openQuoteEditor` + `printQuote` (9870-10031) | 162 |
| 6 | quote-builder-v2.html | `mmToFeetStr` + `feetStrToMm` | ~15 |
| 7 | (CSS sweep) | any rule whose ONLY selectors are classes emitted by #1-#5's markup (`.bs-qb*`, `.bs-section`, `.bs-items-table`, …) — grep each class name repo-wide first | TBD |

Explicitly NOT deleted: the legacy `quotes` collection + its rules block (decision 10);
`renderBKQuotationsSummary`/`renderBSQuotationsSummary` (live); `loadBSContent`'s switch
(already never calls the dead builder — no case-list edit needed). After deletion,
`node --check js/departments.js` must pass. This commit lands BEFORE the Spec 2-8 work so later
diffs aren't tangled with a 1,200-line deletion, and its line-shifts are absorbed before any
WS32-cited regions are touched again.

### Spec 10 — Staleness badge (decision 13)

In BOTH `renderBKQuotationsSummary` (departments.js:6554 on) and `renderBSQuotationsSummary`
(9109 on), inside the per-quote card template:
```js
    const staleDays = (q.status==='filed' && !q.salesOrderId && q.createdAt)
      ? Math.floor((Date.now() - (q.createdAt.seconds||0)*1000) / 86400000) : 0;
    // in the card meta row:
    ${staleDays > window.QUOTE_STALE_DAYS ? `<span class="badge badge-amber" style="font-size:9px" title="Filed but no Sales Order yet">⚠ ${staleDays}d no SO</span>` : ''}
```
plus a header count chip `⚠ N stale` next to the screens' existing bucket counts when N>0.
Uses only rows the screens already fetched — zero new reads. (`badge-amber` exists in the app's
badge palette; if not present in styles.css, reuse `badge-warn`.)

### Spec 11 — Rollout order + cross-workstream contract (deliverable item 7)

1. **WS32 first, fully** (its own Spec 9c order, including `migrateClientBooks()`), before any
   WS31 commit — WS31's bridge edits are written against the post-WS32 bridge.
2. **Commit A — dead-code deletion** (Spec 9). `node --check`; verify the pre-commit hook bumped
   `APP_VERSION` AND `CACHE_VER` in the diff (sw.js must show a new `bi-ops-v*`).
3. **Deploy rules** (Spec 8a) — the migration needs the admin-create clause live first.
4. **Commit B — chain repair**: config.js (Spec 1), app.js (Spec 2 bridge + Spec 3d + Spec 8b),
   departments.js (Spec 3a-3c/3e, Spec 4, Spec 10, the `upsertFromQuote` clientId patch from
   Spec 2). Same hook checks.
5. **Run `migrateStrandedBKQuotes`** via the banner in Sales → Quotations (president). Verify
   toast counts; re-open the tab — banner gone (idempotency); spot-check one moved quote renders
   in the BK summary and its approval request row still opens/approves correctly.
6. **Commit C — Quick Quote + photos + letterhead**: quote-builder-v2.html (Spec 5, 6b, 7),
   app.js (Spec 6a). quote-builder-v2.html is NOT precached (network-first) — no manual bump
   needed for it, but the app.js edit triggers the hook anyway.
7. **Contract for later workstreams:** WS36 — `sales_orders`/payment shapes untouched here; the
   staleness badge reads `salesOrderId` only. WS38 — no file-linkage work done here (unchanged).
   WS40 — quote analytics must use `isQuoteWon/isQuoteLost/isQuoteOpen` + `getAllQuotes` and may
   rely on `approval_requests.quoteColl` existing on post-WS31 docs only. Anyone adding a quote
   write site MUST set status via `window.quoteStateFields` and route the collection by
   `data.company === 'BK' ? 'bk_quotes' : 'bs_quotes'` — no new hardcodes.

### Spec 12 — Manual test checklist (no automated suite)

1. **Stranding fixed forward:** internal Sales user files a BK quote with "Send to president for
   review first" → doc lands in `bk_quotes` with `status:'pending_approval'`/
   `approvalStatus:'pending_review'`; `approval_requests` row carries `quoteColl:'bk_quotes'`.
2. **Approve round-trip (BK):** president approves it from the "All Requests" chip → the
   `bk_quotes` doc flips to `filed`/`approved`, the request resolves, the agent gets the
   notification, and the quote shows ✓ in Sales → Quotations with a working "Sales Order" button.
3. **roa chip = all chip:** the SAME pending request approved from the "Quote / ROA" chip
   produces the identical quote-doc update (spot-check `approvedAt`/`approvedBy` present) — the
   old approve-without-filing path is gone. Return-to-Partner from the roa chip marks
   `needs_revision` on the quote doc and `returned` on the request.
4. **Legacy pending request (no `quoteColl`):** an approval_requests doc created before Commit B
   still approves correctly (defaults to `bs_quotes`).
5. **Open & Edit threading:** "📝 Open & Edit" on a BK request opens the BK builder;
   `saveReviewedPartnerQuote` writes back to `bk_quotes` (check `_qbReviewContext.quoteColl`).
6. **Migration:** with ≥1 stranded doc, the BK summary shows the repair banner; run → doc now in
   `bk_quotes` under the SAME id, gone from `bs_quotes`, request row patched, sales_orders (if
   any) still resolve by `quoteId`; banner gone on re-render; PT quotes untouched in `bs_quotes`.
7. **Partner isolation unchanged:** partner console — `bk_quotes` read DENIED, own `bs_quotes`
   read allowed, foreign `bs_quotes` doc DENIED; partner create with own uid allowed.
8. **Quick Quote:** toggle ⚡ → step 1 picker lists existing clients, picking one prefills +
   stamps `clientId` on the filed doc (check Firestore); typing a new name files with
   `clientId:null` and the WS32 nameKey upsert still creates/updates the `clients` doc; step 2
   grid shows photos (placeholder when absent), tapping opens the real calc panel, added items
   accumulate in the badge; step 3 files via the normal verify modal (both plain-file and
   send-for-approval paths); switching to the full builder mid-flow keeps all entered data.
9. **Photos:** president uploads a photo in Product Database → `products/{id}.photoUrl` set;
   quote-builder dropdown + quick grid show it after reload; editing the product WITHOUT
   touching the photo preserves `photoUrl`; a product with no photo renders the 🍳 placeholder
   everywhere (including the JSON-fallback offline path).
10. **Letterhead:** BK and BS print previews show the shared letterhead header (correct entity
    per company, live quote number); agent-copy print keeps the commission box; `file://` open
    still prints with the legacy header (no JS error).
11. **Dead code:** after Commit A, full app smoke test — Sales/BS/Design tabs, Approvals, quote
    filing, Quotations summaries — zero console errors referencing deleted names
    (`renderBSQuoteBuilder`, `renderBKQuoteList`, `renderQuoteList`, …).
12. **Staleness:** a quote `filed` >14 days without `salesOrderId` shows `⚠ Nd no SO` in both
    summaries; a won quote never does.

### Flags for Neil

- ‼️ **FLAG FOR NEIL — stranded-quote count unknown.** The static pass could not read live data;
  the repair banner (Spec 8b) will report exactly how many BK quotes are sitting in `bs_quotes`.
  If the count is large or any have live sales orders attached, eyeball a couple after the move.
- ‼️ **FLAG FOR NEIL — product photos on the PRINTED quote are deliberately NOT in v1**
  (decision 7): photos ship in the Quick Quote grid + builder search only. If you want them on
  the client-facing printed document, that's a follow-up with real print-CSS/page-break work.
- ‼️ **FLAG FOR NEIL — photo backfill is manual:** the 165 existing products get photos one-by-one
  via the Product Database edit form (the 📷 indicator tracks progress). No bulk-upload tool is
  being built unless you ask for one.
- ‼️ **FLAG FOR NEIL — legacy `quotes` collection** stays read-only and still feeds dashboard
  history. Confirm at some later point whether its rows should be archived/migrated; nothing in
  v12 depends on deciding now.

## RE-GROUNDED (Fable, 2026-07-11)

Verification pass against the ACTUAL WS32 implementation (commit 31ced19) plus today's
WS28/29/33/36/38 landings — this spec was originally written against WS32's *plan*, so every
referenced function/shape was re-checked against live code. **Result: no structural drift.**
Confirmed byte-for-byte or shape-for-shape: the post-WS32 bridge (Spec 2's BEFORE block matches
js/app.js exactly, incl. `data.clientId = await upsertClient()` and the still-hardcoded
`db.collection('bs_quotes').add(data)` in the `QUOTE_APPROVAL_REQUESTED` branch); the `coll`
ternary; `window.Clients.upsertFromQuote(q)` (no `clientId` handling yet — Spec 2's patch still
applies verbatim; `nameKey` query, `lastQuoteNumber`/`lastQuoteTotal` fields, and
`dbCacheInvalidate('clients')` all as assumed); `isQuoteWon/isQuoteLost/isQuoteOpen`
(config.js:396-398, `accepted` handled) + `clientNameKey` (400); `CRM_STAGES`/`crmStageOf`/
`crmStageMeta` (departments.js:12070-12078); `openClientHub` (departments.js:12266 — the spec's
DECIDED section already uses the real name, and its `.clq-reopen`/`.clq-rev` buttons are
`_coll`-aware as the header contract requires; `openClientQuotesModal` appears only in the
historical grounding text, which is fine); `clientId` stamped by the bridge on `bk_quotes`/
`bs_quotes` and by `openSalesOrderModal` on `sales_orders`/`job_projects`; the four approval
functions still hardcode `bs_quotes` with unchanged signatures (`approveQuoteApproval(quoteId,
agentId, qno, name)`, `returnQuoteToPartner(..., notes)`, `openQuoteApprovalReview(ctx, onDone)`
with exactly THREE `db.collection('bs_quotes')` sites, `saveReviewedPartnerQuote(ctx, action)`);
the naive `'roa'` terminal-else handlers are still the quoted approve-without-filing code with no
`ca_deduct` filter; `reopenQuoteFromDoc(collection, id, navTarget, opts)` matches Spec 3c's call;
all six dead-code chains re-verified zero-caller today (`renderQuoteList` count 1; `openQuoteEditor`'s
3 / `printQuote`'s 2 occurrences are all internal to the dead chain); letterhead.js has its own
esc fallback + `opts.entity` and is in PRECACHE; `formRow`/`wireForm`/`pdbBom`/
`collectAndSaveProduct` and `Drive.renderUploadArea` (result carries `.url` and `.name`;
opts `{accept,label,dept,subfolder}`) as assumed; `quoteStateFields`/`QUOTE_STALE_DAYS` don't
exist yet (no collision); the `bk_quotes` create clause matches Spec 8a's BEFORE verbatim; the
new `clients` rules deny partner reads (Spec 5c's catch-to-empty is correct); every
quote-builder-v2.html anchor (`buildQuotePayload` 2544, `fileQuotation` 2506, `doVerifyAndFile`
2452, `attrEsc` 1019, `mmToFeetStr`/`feetStrToMm` 988/998, `loadDatabase` map, `applyPartnerMode`
1135, `initUI` 1187, `setCompany` 1195, `doPrint` 2681, `#printHeader` 420, `CO` object fields
`name/sub/addr/contact`, `phLogo`) exists as cited, and no `quickMode`/`qqWizard` code exists yet.

### Spec corrections

Three mechanical corrections Sonnet MUST apply (everything else in DECIDED stands as written):

1. **Spec 10 badge class — `badge-amber` and `badge-warn` do NOT exist in css/styles.css.**
   The available badge palette is `badge-blue/green/orange/red/gray/purple/teal/gold`
   (styles.css:298-304,664). Use **`badge-orange`** for the staleness badge:
   `<span class="badge badge-orange" style="font-size:9px" title="Filed but no Sales Order yet">⚠ ${staleDays}d no SO</span>`.
   Do not invent a new class.
2. **Approval-button wiring now uses `onClickSafe(btn, fn)`** (departments.js:31 — wraps the
   handler in try/catch + error toast; added after this spec's grounding pass). The `'all'`-chip
   `qa-*` wiring (departments.js:11039-11048) is already `wrap.querySelectorAll('.qa-review-btn')
   .forEach(btn => onClickSafe(btn, () => {...}))` — Spec 3e's edits must PRESERVE that wrapper
   (only add the `quoteColl`/`data-coll` threading). Spec 4's AFTER block must be adapted the
   same way: replace each `btn.addEventListener('click', async () => {...})` /
   `btn.addEventListener('click', () => ...)` with `onClickSafe(btn, async () => {...})` /
   `onClickSafe(btn, () => ...)` for all four handler groups (`qa-review-btn`, `qa-approve-btn`,
   `qa-return-btn`, `roa-resolve-btn`). Behavior otherwise identical to the printed AFTER.
3. **Spec 3b cache invalidation — invalidate BOTH `'all-quotes'` AND `'approvals-pending'`** in
   `approveQuoteApproval` and `returnQuoteToPartner` (after the `approval_requests` resolution):
   `dbCacheInvalidate && dbCacheInvalidate('all-quotes'); dbCacheInvalidate && dbCacheInvalidate('approvals-pending');`
   Rationale: `saveReviewedPartnerQuote` (app.js:1293-1294) already invalidates both, and the
   pending-approvals badge counts are served from the cached `'approvals-pending'` key
   (app.js:2391, 2603) — invalidating only `'all-quotes'` would leave a stale badge count for up
   to 30s after an approve/return from the chips.

Line-anchor refresh (informational — Spec 9's "re-locate by function name, not line" rule
governs; these are the current positions after WS26-38 landed): bridge `else` branch
app.js:8248-8274 (hardcoded add at 8256), `coll` ternary app.js:8215, `data={...}` literal
app.js:8172-8211 (`company:` at 8174), `upsertClient` app.js:8230-8233 (note: it carries a
partner guard returning null — consistent with decision on partners never writing the CRM),
`upsertFromQuote` departments.js:173-193, `approveQuoteApproval` 11626, `returnQuoteToPartner`
11637, `openQuoteApprovalReview` 11650 (bs_quotes sites 11653/11675/11685),
`saveReviewedPartnerQuote` app.js:1258-1304 (bs_quotes at 1289), `roa` terminal else
departments.js:11576-11616 (NOTE: it now sits after a new `else if (sub === 'quote-files')`
branch at 11574 from WS38 — Spec 4 replaces ONLY the terminal `else`, leave `quote-files`
untouched), `'all'`-chip qa templates 10866-10868 / wiring 11039-11048, APPROVAL_CAPS
`'quote-approval'` 10682, dead code: `renderBKQuoteList` 6752, `renderBKQuotationsSummary` 7107
(live), `renderBKPackages` 7303, `renderBSDashboard` 9092, `renderBSQuoteBuilder` 9145,
`renderBSQuotationsSummary` 9694 (live), `renderQuoteList` 10491 / `openQuoteEditor` 10534 /
`printQuote` 10636, `formRow` app.js:1613, `wireForm` 1715, `pdbBom` 1751,
`collectAndSaveProduct` 1753, `getAllQuotes` app.js:2065, `bk_quotes` rules block
firestore.rules:668-677, `clients` rules block firestore.rules:1278.
