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
