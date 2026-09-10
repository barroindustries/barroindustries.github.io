# QB-DRAFTS-MULTI-FIX-SPEC-2026-09-11 — stop cross-client draft clobbering

Owner report (Neil, 2026-09-11, after v14.0.256): "allow more than just one draft — my
previous drafts for different clients are getting deleted."

## Root cause (confirmed in code)
Multiple drafts ARE supported, but `savedDraftDocId` (quote-builder-v2.html) sticks to the
last-saved draft doc for the whole session. Starting a different client's quote by typing
over the form (without 🗑 New / `clearForm()`) leaves it pointing at the OLD client's doc,
so the 5s autosave (`sendQuoteDraft`, posts `draftDocId`) and the next 💾 Save draft
OVERWRITE that client's draft. Overwrite = the "deleted" drafts.

## Fix — draft identity guard + explicit "save as new"

All in `quote-builder-v2.html` unless marked app.js. Anchors are grep strings.

### 1. Identity key + centralized setter
Near `let savedDraftDocId=null;` add:
```js
let savedDraftClientKey='';   // client identity the named draft was last saved under
function draftClientKey(){
  const norm = id => (document.getElementById(id)?.value||'').trim().replace(/\s+/g,' ').toLowerCase();
  const k = norm('clientName')+'|'+norm('clientCompany');
  return k==='|' ? '' : k;
}
// A DIFFERENT client only when both sides are non-empty and disagree — an
// empty→named (filling the form in) or named→empty (clearing a field)
// transition is the SAME working draft, never a fork.
function draftClientChanged(){
  const cur = draftClientKey();
  return !!(savedDraftClientKey && cur && cur !== savedDraftClientKey);
}
function setSavedDraft(id, key){
  savedDraftDocId = id||null;
  savedDraftClientKey = id ? (key||'') : '';
  try{
    if(id){ localStorage.setItem('bkqb_draft_docid', id); localStorage.setItem('bkqb_draft_key', savedDraftClientKey); }
    else { localStorage.removeItem('bkqb_draft_docid'); localStorage.removeItem('bkqb_draft_key'); }
  }catch(e){}
}
```
Replace EVERY existing write to `savedDraftDocId` with `setSavedDraft(...)`:
- `clearForm()` (`savedDraftDocId=null;` at the 🗑 New reset) → `setSavedDraft(null)`.
- both filing clears (`savedDraftDocId=null; // QB-DRAFTS-SPEC…` ×2) → `setSavedDraft(null)`.
- `loadEditableState` (`savedDraftDocId=state.draftDocId||null;`) →
  `setSavedDraft(state.draftDocId||null, ((state.clientName||'').trim().replace(/\s+/g,' ').toLowerCase())+'|'+((state.clientCompany||'').trim().replace(/\s+/g,' ').toLowerCase()));`
  (normalize identically; compute '' when both empty — reuse a tiny helper if cleaner).
- ack handler (`savedDraftDocId=d.docId||null;`) → `setSavedDraft(d.docId||null, _pendingDraftKey)`
  where `let _pendingDraftKey='';` is captured at post time (see §3).
Persistence restore: in the boot path right after `loadFromStorage()` runs (anchor: the
`checkDraftResume()` call site), add
```js
try{ const _id=localStorage.getItem('bkqb_draft_docid'); if(_id){ savedDraftDocId=_id; savedDraftClientKey=localStorage.getItem('bkqb_draft_key')||''; } }catch(e){}
```
so reopening the builder keeps updating the same draft instead of minting duplicates —
but ONLY when no LOAD_QUOTE/resume is about to load different state (loadEditableState
overwrites via setSavedDraft anyway, so plain restore-then-load stays correct).

### 2. Autosave guard (`sendQuoteDraft`)
Post `draftDocId: (savedDraftDocId && !draftClientChanged()) ? savedDraftDocId : null`.
A different client's session autosaves to the crash-recovery slot only — it can never
rewrite a named draft.

### 3. Explicit save (`saveQuoteDraftNow`)
- Signature becomes `saveQuoteDraftNow(asNew)`.
- After the existing guards: `if(asNew || draftClientChanged()) setSavedDraft(null);`
  and when the fork happened because of `draftClientChanged()` (not asNew), toast
  `💾 Saving as a NEW draft — the client changed, so the previous client's draft is kept.`
- Before posting: `_pendingDraftKey = draftClientKey();` then post as today with the
  (possibly nulled) `savedDraftDocId`.
- Ack toast (QUOTE_DRAFT_SAVED_OK): say "Draft updated" when it updated an existing doc
  (the posted draftDocId was non-null) vs "Draft saved" when new — track which via a
  small flag captured at post time.

### 4. "Save as new draft" button
In the Verify modal footer (anchor: `id="saveDraftBtn"`), add after it:
`<button class="btn btn-outline no-print" id="saveDraftNewBtn" onclick="saveQuoteDraftNow(true)" style="display:none;background:var(--dark-blue);">🆕 Save as new draft</button>`
In `buildVerifyModal()` (or wherever the modal is (re)shown — find the function that
prepares `#fileBtn`/`#saveTemplateBtn` state) set:
```js
const hasNamed = !!savedDraftDocId;
saveDraftBtn.textContent = hasNamed ? '💾 Update draft' : '💾 Save draft';
saveDraftNewBtn.style.display = hasNamed ? '' : 'none';
```
This gives multiple drafts for the SAME client too (Option A / Option B).

### 5. Bridge hardening (js/app.js, `QUOTE_DRAFT` branch)
The named-doc autosave currently does `draftRef.set({...})`, which would RESURRECT a
draft the user deleted from Quotes → Drafts while the builder still holds its id. Change
the named path to `update({...})` and, on failure (doc gone / rules), fall back to the
`draft_{uid}` slot `set()` exactly as the null path — wrap so the existing silent-fail
posture and `QUOTE_DRAFT_SAVED` ack are preserved. `QUOTE_SAVE_DRAFT` already re-checks
existence/status — unchanged.

### 6. Tutorial contract
- `TUTORIAL_VERSION` 33 → **34**.
- Prepend WHATS_NEW: `{ ver:34, date:'2026-09-11', items:[
    'Drafts are truly per client now — starting a different client\'s quote can no longer overwrite the previous client\'s saved draft (it saves as its own new draft automatically), and 🆕 Save as new draft beside 💾 Update draft lets one client keep several drafts (e.g. Option A / Option B).',
  ]}`.
- Update the Verify & File help/tour sentence that mentions 💾 Save draft to mention
  per-client separation + 🆕 Save as new draft. Re-grep TOUR_STEPS targets.

## Out of scope
- No rules/app-screen changes (Drafts tab already lists many drafts).
- Overwritten drafts from before this fix are not recoverable (no versioning) — do not
  attempt server-side recovery.

## Verification
1. The three commit gates.
2. `node --check` app.js + extracted builder script.
3. Headless browser drive (port 3737, standalone): simulate save-ack by calling the
   message handler path or setting state directly — assert: (a) `draftClientChanged()`
   truth table incl. empty-key transitions; (b) `sendQuoteDraft` posts null draftDocId
   after a client change (spy on postMessage); (c) `saveQuoteDraftNow()` forks + toasts on
   client change; (d) buildVerifyModal toggles the 🆕 button/label; (e) localStorage
   persistence round-trip; (f) clearForm/filing clears both keys.
4. Honestly report what needs a logged-in session (bridge writes).
