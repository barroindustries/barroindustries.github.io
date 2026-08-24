# QUOTE-TEMPLATES-SPEC — reusable quote templates

**Goal:** let Sales save the current quote's product/pricing/terms configuration as a named, reusable **template**, and load a template to start a new quote fast (client details left blank). High-value for repeat product bundles.

**Files:** `quote-builder-v2.html` (iframe, two buttons + 2 handlers), `js/app.js` (the QB↔Firestore bridge + a native template picker), `firestore.rules` (new `quote_templates` collection). No money-core, no payroll, no existing-flow changes.

## Architecture recap (verified — build on this, don't reinvent)
- The builder is an **iframe** hosted by app.js (`#qb-frame`, ~app.js:1649). It talks to the app ONLY via `postMessage` (same-origin checked).
- The builder already builds `editableState` inside `buildQuotePayload()` (quote-builder-v2.html ~line 4233) and already restores it via `loadEditableState(state, {asRevision})` (~line 4361).
- The app-side **bridge** (`window.addEventListener('message', …)` at app.js ~3567) already handles `QUOTE_FILED` / `QUOTE_UPDATE` / `QUOTE_DRAFT` / `QUOTE_APPROVAL_REQUESTED`.
- `reopenQuoteFromDoc` (app.js ~1752) is the MODEL for pushing a saved `editableState` INTO the iframe after `QB_READY` — mirror exactly how it posts the state message to `#qb-frame`.

## `editableState` — what a TEMPLATE keeps vs strips
The template payload is a **copy of `editableState`** (quote-builder-v2.html:4233-4248) with the client/identity fields blanked:
- **KEEP** (the reusable config): `items`, `termsContent`, `termsEnabled`, `currentCo`, `pricing`, `photos`, `laborState`, `waiveFlags`, `salesperson`, `purpose`, `subject`.
- **STRIP to ''** (client/identity — never baked into a template): `clientName`, `clientCompany`, `clientAddress`, `clientPhone`, `clientEmail`, `quoteNo`, `quoteDate`, `filedAt`. Also drop any `sourceDocId`/`sourceCollection`/`rootQuoteId`/`asRevision` a template must never carry.

## New postMessage protocol (add to BOTH sides; same-origin check like existing handlers)
- Builder → app: `{ type:'QUOTE_SAVE_TEMPLATE', payload:{ name, co, state } }` where `state` = the client-stripped editableState (build it in the builder).
- Builder → app: `{ type:'QUOTE_REQUEST_TEMPLATES' }` — asks the app to show its picker.
- App → builder: `{ type:'LOAD_TEMPLATE', payload:{ state } }` — builder calls `loadEditableState(state, {asRevision:false})`. Because client fields are '' and there's no quoteNo, `loadEditableState`'s existing `if(state.quoteNo){…}` guards already leave the quote fresh (no revision bump). Verify that path.
- App → builder (optional ack): `{ type:'QUOTE_TEMPLATE_SAVED', name }` → builder shows a "Template saved" toast.

## 1. Builder (`quote-builder-v2.html`)
- Add two buttons next to `#fileBtn` (~line 1340): **💾 Save as Template** and **📋 Templates**. Match existing `.btn` styling; keep them enabled whenever there's ≥1 line item (reuse whatever enables `#fileBtn`).
- **Save as Template**: `prompt()` (or a small inline field) for a template name (required, trim, ≤80 chars). Build the stripped state (copy editableState, blank the strip-list), then `window.parent.postMessage({type:'QUOTE_SAVE_TEMPLATE', payload:{name, co:currentCo, state}}, window.location.origin)`. On `QUOTE_TEMPLATE_SAVED`, toast.
- **Templates**: `window.parent.postMessage({type:'QUOTE_REQUEST_TEMPLATES'}, window.location.origin)`.
- Add a `message` handler branch for `LOAD_TEMPLATE` → `loadEditableState(e.data.payload.state, {asRevision:false})` (guard origin). Follow the same origin/shape checks the builder's existing REQUEST_STATE / load handlers use (~line 4361-4366).

## 2. App host (`js/app.js`)
In the QB bridge (~3567), add:
- `QUOTE_SAVE_TEMPLATE`: validate name (string, trim, 1-80) + state (object) + co; write `db.collection('quote_templates').add({ name, co, editableState: state, itemCount: (state.items||[]).length, createdBy: currentUser.uid, createdByName: userProfile?.displayName||currentUser.email||'', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })`. Post `{type:'QUOTE_TEMPLATE_SAVED', name}` back to `e.source`. Wrap in try/catch; on failure, a toast (do not crash the builder).
- `QUOTE_REQUEST_TEMPLATES`: fetch `quote_templates` (dbCachedGet, `.catch(()=>({docs:[]}))`), render a native picker via `openPage`/list (reuse existing list styling): each row shows name, co badge, itemCount, createdByName, relative date, and a **Use** action + a **Delete** action (delete only own template unless admin). On **Use**: `document.getElementById('qb-frame')?.contentWindow?.postMessage({type:'LOAD_TEMPLATE', payload:{state: t.editableState}}, window.location.origin)` then `closeModal()`. Empty state: "No templates yet — build a quote and tap 💾 Save as Template."
- Escape every rendered string with `escHtml`.

## 3. `firestore.rules`
Add next to the other Sales collections:
```
match /quote_templates/{id} {
  allow read:   if isAuth() && !isPartner();               // internal Sales library
  allow create: if isAuth() && !isPartner()
                && request.resource.data.get('createdBy','') == request.auth.uid;
  allow update, delete: if isAuth() && !isPartner()
                && (resource.data.get('createdBy','') == request.auth.uid || isAdmin());
}
```
(Uses `.get(field, default)` so a missing field denies, per house rule. Partners excluded — templates are an internal library.)

## 4. Deploy + verify
- `node --check js/app.js`. quote-builder-v2.html: extract the inline `<script>` and syntax-check it (vm.Script) — it can't `node --check` directly.
- Bump handled by the pre-commit hook (do NOT hand-edit versions). Add nothing to sw.js PRECACHE (no new file).
- Rules deploy is SEPARATE: `~/.npm-global/bin/firebase deploy --only firestore:rules` (git push does NOT deploy rules). Re-diff the rules file right before deploying.
- Manual verify (note it needs a login, which the lead can't do): Save a quote as template → reopen builder → Templates → Use → confirm items/terms/pricing load and client fields are blank and no revision bump; delete a template; confirm a partner cannot read `quote_templates`.

**Report:** every change per file, the exact strip-list applied, the rules block, node/vm syntax-check results, and any place `loadEditableState` needed care to avoid a revision bump. Do NOT commit, bump versions, or deploy — the lead reviews the data-strip + rules, then commits/deploys.
