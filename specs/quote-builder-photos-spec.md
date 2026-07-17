# Spec: Photo attachments in Quote Builder v2

## Goal (Neil's request)
1. Attach photos to a quotation in the quote builder — reference photos (site photos, sample images, client references).
2. Photos of quoted items appear on a **separate printed page** ("Photo Reference" annex) with **numbering**, optionally linked to line-item numbers.

## Files touched
- `quote-builder-v2.html` (all UI + logic — self-contained tool)
- `storage.rules` (new match block; deployed separately with `~/.npm-global/bin/firebase deploy --only storage`)
- Nothing in js/app.js is required (payload flows through existing `QUOTE_FILED` postMessage untouched — the parent saves the whole payload).

## Data model
New top-level state in quote-builder-v2.html:

```js
let quotePhotos = []; // [{ url, path, caption, itemIndex, dataUrl }]
```

- `url` — Firebase Storage download URL (null while offline/file://).
- `path` — storage path (for delete).
- `caption` — free text, editable.
- `itemIndex` — 0-based index into `items[]` or `null` = general reference photo. Display number is derived from array position (Photo 1, Photo 2, …) at render time; never store a display number.
- `dataUrl` — ONLY for offline/file:// mode (in-memory print support). NEVER persisted to localStorage or Firestore (size).

Persistence:
- `saveToStorage()` → `localStorage.setItem('bkqb_photos', JSON.stringify(quotePhotos.map(({dataUrl,...p})=>p)))` (strip dataUrl).
- `buildQuotePayload()` → add `photos: quotePhotos.map(({dataUrl,...p})=>p)` at top level AND include the same in `editableState` so re-opening a filed quote restores them.
- `loadEditableState()` → restore `quotePhotos = state.photos || []`, then `renderQuotePhotos()`.
- `clearForm()` → `quotePhotos = []` + re-render.
- `loadFromStorage()` — the builder opens fresh per client (no draft restore), keep that behavior: do NOT restore photos except via `#quote=` hash state if present (`state.photos`).

## Upload flow
New section in the builder (see UI below). On file select (multi-file allowed):
1. Client-side compress: draw onto canvas, max dimension 1400px, `toBlob('image/jpeg', 0.82)`. Skip compression for files already < 300 KB. HEIC that the browser can't decode: fall back to uploading the raw file (rules cap 15 MB images).
2. If online + authed (`typeof storage !== 'undefined' && auth.currentUser`):
   - Path: `quote-photos/{quoteNoSafe || 'draft-'+auth.currentUser.uid}/{Date.now()}_{sanitizedName}.jpg` where `quoteNoSafe = quoteNo.replace(/[^\w.-]/g,'_')`.
   - Upload with metadata `{ customMetadata: { uploadedBy: auth.currentUser.uid } }` (needed by storage.rules isOwnerOrAdmin for later delete).
   - `getDownloadURL()` → push `{url, path, caption:'', itemIndex:null}`.
3. Offline/file:// → keep `{dataUrl, caption:'', itemIndex:null}` and show a small "not uploaded — will print only" hint.
4. Show a per-file progress/disabled state on the button; `alert`/inline error on failure (this file uses plain alerts, no Notifs).

Delete: remove from array; if `path` and online, `storage.ref(path).delete().catch(()=>{})` best-effort.

## UI — on-screen editor (no-print)
New `<div class="section no-print" id="photoSection">` placed AFTER the items table section and BEFORE the pricing controls (find `<!-- ── PRICING CONTROLS (no-print) ── -->` ~line 753; insert the new section before that block's parent `.section` boundary — read the structure first).

Content:
- Header row: `📷 Photos` title + `＋ Add Photos` button + hidden `<input type="file" id="photoInput" accept="image/*" multiple>`. (No `capture` attribute — let mobile offer camera OR library.)
- Thumbnail grid (~110px squares, CSS in the existing style block): each card = image, caption `<input>` (updates `quotePhotos[i].caption` on input + `saveToStorage()`), a `<select>` "Link to item" listing current `items` as `#1 — <name>` options plus "Reference only" (default), and a ✕ delete button.
- The item `<select>` must be re-populated by `renderQuotePhotos()` and `renderQuotePhotos()` must be called from `renderItems()` (item list changes invalidate options; keep selections by index where still valid, else reset to null).
- Empty state: one muted line "No photos attached. Photos print on a separate reference page."

Escape all user strings with the file's existing escaping helper (`attrEsc` for attributes — check it exists; there is `attrEsc` used at line 1432).

## UI — printed annex (print-only)
New `<div class="print-only" id="photoAnnex">` as the LAST content block before the print footer / signature area (must come after signatures? No — signatures should stay last on the main document; put the annex AFTER the signature `.sig-row` block so the main quote document ends normally and the annex is a trailing page).

- CSS: `@media print { #photoAnnex{ page-break-before: always; } }`, 2-column grid, each photo max-height ~85mm, `page-break-inside: avoid` per card.
- Header: company-styled title `PHOTO REFERENCE — Annex` + quote number + client name (re-use `updatePrintHeader()` data or just read the fields at render time).
- Each card: the image (`url || dataUrl`), bold label `Photo {n}` (n = position, 1-based), then caption, then `Item #{itemIndex+1} — {item name}` when linked.
- Rendered by `renderQuotePhotos()` (one function renders both the editor grid and the annex).
- If `quotePhotos` is empty the annex div stays empty → prints nothing (verify no blank trailing page: keep the div content empty and the page-break rule applied only when it has content, e.g. toggle a class).

## storage.rules addition
Add BEFORE the generic `/{department}/{subfolder}/{fileName}` match, and add `'quote-photos'` to `isReservedTop()` so the generic rule can't loosen/tighten it:

```
// ── Quote-builder photo attachments ──────────────
// Attached from quote-builder-v2 (Sales staff AND the external partner both
// file quotes), so any signed-in user may upload/read. Images only.
match /quote-photos/{quoteRef}/{fileName} {
  allow read: if isSignedIn();
  allow create: if isSignedIn() && (request.resource == null || isValidImage());
  allow update, delete: if isSignedIn() && isOwnerOrAdmin();
}
```

Note: `isOwnerOrAdmin()` is declared later in the file — Storage rules functions are file-scoped, order doesn't matter (verify by pattern match with the existing task-comments rule which already does this).

## Constraints / gotchas
- **No manual version edits** — pre-commit hook bumps APP_VERSION/CACHE_VER. Just commit.
- quote-builder-v2.html is HTML (SW: check PRECACHE — if it's precached, the auto CACHE_VER bump on commit invalidates it; nothing manual needed).
- `items` line numbering in print: items are grouped by category rows — confirm what "#" the printed table shows. If the printed table has NO visible per-row numbers, ADD a printed row number column reference is NOT required; instead the annex prints the item NAME alongside `Photo n`, which is unambiguous. (Do not restructure the items table.)
- Keep everything inside quote-builder-v2.html self-contained (its own CSS/JS); do not add app-level dependencies.
- Firestore payload grows by an array of small objects (URLs) — no doc-size risk. Do NOT put dataUrls in the payload.
- `node --check` is N/A for HTML; verify by loading http://localhost:3838/quote-builder-v2.html and exercising: add photo (needs login for upload — verify offline path headlessly: file input → dataUrl thumbnail renders, annex renders, print CSS present).

## Acceptance
1. Signed-in user adds 3 photos, captions two, links one to a line item → thumbnails render, uploads land in `quote-photos/...`, payload contains `photos:[...]` with URLs.
2. Print preview shows the quote unchanged plus a final "PHOTO REFERENCE" page with Photo 1/2/3, captions, and the linked item name.
3. Filed quote reopened via LOAD_QUOTE shows the photos again.
4. No photos → print output identical to today (no blank annex page).
5. storage.rules deployed; partner account can upload (rules allow any signed-in).
