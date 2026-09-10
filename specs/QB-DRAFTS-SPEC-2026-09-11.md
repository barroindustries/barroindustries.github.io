# QB-DRAFTS-SPEC-2026-09-11 — explicit "Save draft" + Quotes → Drafts

Owner request (Neil, 2026-09-11): in the quote builder, allow saving as a **draft even when
there are no amounts**, and let drafts **be found under Quotes → Drafts**.

## What exists today (do not rebuild)
- Autosave cloud draft (Wave 3 Q6): builder debounces `QUOTE_DRAFT` → app.js bridge writes ONE
  slot doc `draft_{uid}` per user into `bk_quotes`/`bs_quotes` (`status:'draft'`, `draftBy`,
  `draftAt`, merge). Slot docs carry **no `createdAt`**, so the `orderBy('createdAt')` list
  queries never show them. Slot is deleted on file (`deleteDraftSlot`).
- `buildQuotePayload()` is the single outbound funnel; it **strips cost fields**
  (costMat/costHrs/bom/costLaborDays/priceManual) from `editableState` — drafts inherit that,
  same as reopen. Do not change the strip.
- Reopen: `window.reopenQuoteFromDoc` stamps `sourceDocId/sourceCollection/rootQuoteId` →
  builder `loadEditableState` sets reopen lineage (revision-chain semantics). Drafts must NOT
  reuse those stamps.
- Lists: `renderBKQuotationsSummary` (js/screens/sales.js, `bk_quotes`, chipTabs List/By
  Customer, drafts mixed into the flat list + a Drafts stat card);
  `renderBSQuotationsSummary` (same file, `bs_quotes`) already buckets
  `drafts = all.filter(q=>!q.status||q.status==='draft')` but its rows only offer
  Reopen/Revision for filed/approved.
- Rules (firestore.rules `bk_quotes`/`bs_quotes`): create/update allowed for
  `createdBy == uid` (+ the `draft_{uid}` id clause); **delete is admin-or-slot only** — a
  non-admin creator cannot delete an explicit draft doc today.

## Design
Explicit drafts are ordinary docs in the same quote collections with `status:'draft'`,
`createdBy: uid`, `createdAt` (so the existing queries pick them up), full `payload` fields
(so the list cards render), and `editableState` (so they resume). Multiple drafts per user.
The one-slot autosave stays for crash recovery; once a quote is a named draft, autosave
updates the named doc instead of the slot.

### A. Builder side (quote-builder-v2.html)
1. Module state: `let savedDraftDocId=null;` next to the `reopenSourceDocId` declarations
   (anchor: `let reopenSourceDocId=null`).
2. **Button** beside File (anchor: `id="fileBtn"`): before it insert
   `<button class="btn btn-outline no-print" id="saveDraftBtn" onclick="saveQuoteDraftNow()">💾 Save draft</button>`
   — always enabled (no verify gates, no amount checks).
3. `function saveQuoteDraftNow()`:
   - `if(quoteStatus==='filed'||quoteStatus==='pending_approval')` → toast "This quote is
     already filed — use Reopen/New Revision instead." and return (same condition as
     `scheduleDraftSave`).
   - If `!items.length` AND no clientName/clientCompany text → toast "Nothing to save yet —
     add an item or a client first." and return (mirrors `sendQuoteDraft`'s guard; zero
     AMOUNTS are explicitly fine).
   - `if(window.parent===window)` → toast "Draft saving needs the app — open the builder from
     the Sales tab. (Your work is still kept on this device.)" and return.
   - Else post `{type:'QUOTE_SAVE_DRAFT', payload:buildQuotePayload(), draftDocId:savedDraftDocId}`
     (same origin-pinned postMessage pattern as QUOTE_DRAFT).
4. Ack handler (in the existing `window.addEventListener('message', …)` block, anchor
   `QUOTE_DRAFT_SAVED`): on `{type:'QUOTE_DRAFT_SAVED_OK', docId}` → `savedDraftDocId=docId`,
   `showDraftSavedChip()`, toast `💾 Draft saved — find it under Quotes → Drafts.`
   On `{type:'QUOTE_DRAFT_SAVE_FAILED'}` → error toast.
5. Autosave routing: in `sendQuoteDraft()` add `draftDocId:savedDraftDocId` to the posted
   message (slot behavior unchanged when null).
6. Lineage:
   - `loadEditableState`: alongside the reopen-lineage resets (anchor:
     `reopenSourceDocId=state.sourceDocId||null`) add
     `savedDraftDocId=state.draftDocId||null;` (unconditional — reset every load).
   - The new-quote reset (anchor: `reopenSourceDocId=null; reopenSourceCollection=null; reopenRootQuoteId=null; reopenAsRevisionFlag=false; fileMode='revision';`)
     also sets `savedDraftDocId=null;`.
7. Filing cleanup: in `fileQuotation()`, add `draftDocId:savedDraftDocId` to the
   QUOTE_FILED, QUOTE_APPROVAL_REQUESTED and QUOTE_UPDATE messages (top-level key beside
   `payload`, like `docId` on QUOTE_UPDATE); set `savedDraftDocId=null` after a successful
   post. PARTNER sessions included — partners may draft too.

### B. App bridge (js/app.js)
1. In the QB bridge listener, next to the existing `QUOTE_DRAFT` branch:
   - Extend `QUOTE_DRAFT`: read `const namedId = e.data.draftDocId;` — when present, write to
     `db.collection(coll).doc(namedId)` (merge, `status:'draft'`, `draftAt` serverTimestamp;
     no createdAt touch) instead of the `draft_{uid}` slot; keep the same
     `QUOTE_DRAFT_SAVED` ack + silent-fail posture.
   - New `QUOTE_SAVE_DRAFT` branch (place beside QUOTE_DRAFT, before the
     `type !== 'QUOTE_FILED' …` early return):
     ```js
     const coll = window.quoteCollectionFor(payload.company);
     const base = { ...payload, status:'draft',
       agentName, createdByName: agentName,
       draftAt: firebase.firestore.FieldValue.serverTimestamp() };
     let id = e.data.draftDocId || null;
     if (id) { // refuse to clobber a doc that was filed meanwhile (other tab)
       const cur = await db.collection(coll).doc(id).get().catch(()=>null);
       if (!cur || !cur.exists || (cur.data().status||'draft') !== 'draft') id = null;
     }
     if (id) await db.collection(coll).doc(id).set(base, { merge:true });
     else {
       const ref = await db.collection(coll).add({ ...base,
         createdBy: currentUser.uid,
         createdAt: firebase.firestore.FieldValue.serverTimestamp() });
       id = ref.id;
     }
     dbCacheInvalidate && dbCacheInvalidate('all-quotes');
     ack {type:'QUOTE_DRAFT_SAVED_OK', docId:id}; on catch ack QUOTE_DRAFT_SAVE_FAILED + toast.
     ```
     `agentName` = `userProfile?.displayName || currentUser.email` (same as the filed path).
     NO client CRM upsert, NO owner notification, NO version/fileName stamping for drafts.
2. Filed cleanup: beside `deleteDraftSlot` add
   `const deleteNamedDraft = async () => { const id0 = e.data.draftDocId; if (id0) try { await db.collection(coll).doc(id0).delete(); } catch(_){} };`
   and call it right after each `deleteDraftSlot()` call (QUOTE_FILED + QUOTE_APPROVAL_REQUESTED
   branches) and in the QUOTE_UPDATE handler's success path.
3. New `window.resumeDraftFromDoc = async function(collection, id)` next to
   `window.reopenQuoteFromDoc`: get the doc; if no `editableState` → error toast; else
   `window._qbReopenState = { ...q.editableState, draftDocId:id };` (NO sourceDocId /
   sourceCollection / rootQuoteId — a draft has no revision chain),
   `window._qbReopenAsRevision = false;`
   `navigateTo(collection==='bk_quotes' ? 'bk-quote-builder' : 'bs-quote-builder')`.
4. Cosmetic: in `renderQuoteBuilderIframe`'s `reopenStrip`, when the state carries
   `draftDocId` (and no `sourceDocId`) label it `resuming a saved draft` instead of
   `editing a copy`.

### C. Quotes → Drafts lists (js/screens/sales.js)
1. **BK (`renderBKQuotationsSummary`)**:
   - Split after fetch: `const draftDocs = quotes.filter(q=>(q.status||'draft')==='draft');`
     `quotes` used everywhere else (KPIs, latestQuoteRevisions, lists) becomes the non-draft
     remainder — drafts leave the flat list/KPIs; the existing "Drafts" stat card now counts
     `draftDocs.length`.
   - Additionally fetch the user's own autosave slot directly
     (`db.collection('bk_quotes').doc('draft_'+currentUser.uid).get().catch(()=>null)`) —
     it has no createdAt so the orderBy query misses it; if it exists and isn't already in
     `draftDocs`, prepend it flagged `_autosave:true`.
   - chipTabs gains a third view: `{key:'drafts', label:'📝 Drafts'}`. The drafts pane lists
     cards sorted by `draftAt`/`createdAt` desc: client name (or "Untitled draft"), company
     tag, ₱ value when > 0, "Auto-saved" badge for `_autosave`, saved-when date, and actions:
     **↻ Resume** (`window.resumeDraftFromDoc('bk_quotes', id)`; requires `editableState`,
     else "no snapshot" note) and **🗑 Delete** (confirm dialog → direct
     `db.collection('bk_quotes').doc(id).delete()` → toast + re-render +
     `dbCacheInvalidate('all-quotes')`). Non-privileged users see only their own drafts
     already (creator-scoped query).
2. **BS (`renderBSQuotationsSummary`)**: the drafts bucket exists. In `renderList` rows add,
   for `status==='draft'`:
   `q.editableState ? Resume button (resumeDraftFromDoc('bs_quotes', id)) : 'no snapshot'`,
   plus Delete for the creator (`q.createdBy===currentUser.uid`) even when not privileged
   (rules change below); keep the existing privileged delete as-is.
3. Empty state for the BK Drafts pane: "No drafts. 💾 Save draft in the quote builder parks
   an unfinished quote here — no amounts needed."

### D. firestore.rules (deploy BEFORE the code push — `release.sh rules`)
Let a creator delete their OWN draft-status doc (needed for the Delete button and the
file-time cleanup by non-admin staff/partners). Use `.get()` defaults (absent-field reads
deny). Keep comments terse (256KB cap).
- `bk_quotes` delete becomes:
  `allow delete: if isAuth() && (isAdmin() || (!isPartner() && docId == 'draft_' + request.auth.uid) || (!isPartner() && resource.data.get('status','') == 'draft' && resource.data.get('createdBy','') == request.auth.uid));`
- `bs_quotes` delete becomes:
  `allow delete: if isAuth() && (isAdmin() || docId == 'draft_' + request.auth.uid || (resource.data.get('status','') == 'draft' && resource.data.get('createdBy','') == request.auth.uid));`
No create/update/read changes. No new composite index (drafts render from already-fetched
rows + one direct doc get). No new collection → monthly-backup EXPORTS untouched.

### E. Tutorial contract (quote-builder-v2.html)
- `TUTORIAL_VERSION` → **33** (the import feature just took 32).
- Prepend WHATS_NEW: `{ ver:33, date:'2026-09-11', items:[
    '💾 Save draft — park an unfinished quote any time, even with no prices or amounts. Drafts live in the app under Quotes → Drafts (📝), where you can resume or delete them; filing the quote later cleans its draft up automatically.',
  ]}`.
- Help body: in the filing/verify copy (anchor: `Verify & File`), add one sentence about
  💾 Save draft; update the matching `TOUR_STEPS` step body. No new tour step. Re-grep all
  TOUR_STEPS targets still resolve.

## Explicitly out of scope / unchanged
- `buildQuotePayload()` cost-field strip (drafts, like reopens, do not round-trip per-line
  BOM/cost entries — known, deliberate).
- Global dashboards/analytics (`getAllQuotes` consumers): BS drafts already flow through
  them; BK drafts now do too. Any exclusion is a later owner ruling, not this change.
- The legacy `quotes` collection, approval flow, revision chains, templates.

## Verification (after both this and the import spec are merged)
1. `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`.
2. Builder standalone (port 3737): console-clean; `saveQuoteDraftNow` with parent===window
   shows the info toast.
3. In-app checks are login-gated — verify headlessly what's possible (globals defined,
   bridge branch reachable, sales.js parses) and say honestly what wasn't exercised.
4. Rules: deploy via `release.sh rules` BEFORE `git push`; re-`git diff firestore.rules`
   immediately before deploying (concurrent-session guard).
