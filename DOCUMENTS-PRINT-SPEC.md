# DOCUMENTS-PRINT-SPEC.md — In-app document host for openPrintableDoc (+ ID cards)

**Status:** SPEC — ready for implementation. Author: Fable (design session, 2026-08-04).
**Problem:** every legacy printable document (`js/print-docs.js` → `window.openPrintableDoc`) renders
via `window.open('', '_blank')` + `document.write`. In the iOS Add-to-Home-Screen standalone PWA,
`window.open` is blocked or breaks out to Safari, so these docs don't open, don't print, and don't
save on iPhone. One caller (the billing invoice) additionally lazy-loads html2canvas from
**cdnjs.cloudflare.com**, which index.html's CSP `script-src` does **not** allow
(`'self' gstatic unpkg jsdelivr` only) — so "Save as JPEG" fails on *every* device.
The payslip (`js/screens/hr.js`, PAYSLIP-OVERHAUL-SPEC.md) already solved all of this with an
in-app openPage host + local html2canvas + pdf-lite + Web Share. This spec generalizes that
proven pattern into `openPrintableDoc` itself, fixing all seven callers at once, plus the ID-card
printer (`window.printIDCards`, js/app.js:2486).

**Money-sensitivity:** these are *renderings* of financial documents (invoice, PO, receiving
report, delivery receipt). Nothing here reads, writes, or recomputes any amount — callers keep
building their own `bodyHtml` with amounts already formatted. No Firestore writes, no rules
changes, no money math. Display/print plumbing only.

---

## 0. Decision: in-app everywhere (no desktop `window.open` branch)

**Recommendation (adopt): the new host renders in-app on ALL platforms.** Reasons:

1. Owner directive: "no pop-ups" (already the stated rationale for the payslip and BIR hosts —
   see the comments at hr.js `renderPayslipPage` and styles.css `.bir-print`).
2. One code path = one thing to test. A `standalone ? inApp : popup` fork doubles the QA matrix
   and keeps the popup scaffold alive forever.
3. Desktop loses nothing: `window.print()` from the in-app host prints exactly the same sheet
   (the payslip proves the print-isolation CSS works on desktop), and popup blockers/toasts
   disappear as a failure mode entirely.

`window.print()` remains the actual print mechanism on desktop / Android / regular mobile Safari.
iOS standalone gets the capture → PDF → Web Share path (§4), same as the payslip.

---

## 1. The new host — `openPrintableDoc` rebuilt on `window.openPage`

### 1.1 File & load order

All new code lives in **`js/print-docs.js`** (already in index.html at line ~379 and in sw.js
`PRECACHE`). It loads before `js/app.js`, but `openPage` is only *called* at click time, when all
deferred scripts have long executed — same runtime-only dependency every screens/ file already
has. No index.html or sw.js PRECACHE changes needed. **Do not touch js/screens/hr.js** — the
payslip host stays as-is (it works in production; de-duping it onto the shared helpers is an
optional follow-up, not part of this change).

### 1.2 New rendering flow (replaces lines ~100–107 of print-docs.js)

`window.openPrintableDoc(opts)` keeps its name, its single-options-object signature, and every
existing option key. New body:

1. Build the panel body HTML:

   ```
   <style> [scoped base CSS §1.4] [opts.pageCss verbatim] [host print-isolation CSS §2] </style>
   <div class="pd-stage">
     <div class="page pd-print" id="${esc(pageId)}">
       ${watermark ? '<div class="wm">…</div>' : ''}
       ${bodyHtml}
     </div>
   </div>
   ```

   Notes:
   - The sheet div keeps class **`.page`** and the caller's `pageId` — caller `pageCss`
     (`.page{width:210mm…}` etc.) applies untouched. It additionally gets **`.pd-print`**, the
     print-isolation hook (mirrors `.payslip-print`).
   - The `<style>` tag rides inside the panel DOM. `<style>` in body applies document-wide, which
     is exactly what the payslip/BIR hosts already do with letterhead `printCSS`; it is removed
     automatically when the panel is torn down, so `@page` landscape rules etc. cannot leak into
     later prints. (Accepted, pre-existing pattern: bare `th/td/table` selectors in caller
     pageCss briefly restyle tables in *hidden* screens beneath the full-screen panel — invisible,
     reverted on close. §6 audits this per caller.)

2. Open the panel:

   ```js
   const panel = window.openPage(o.barLabel || esc(o.title || 'Document'), bodyHTML, '', {
     headerRightHTML,           // §3/§4 buttons + o.extraButtons verbatim
     onClose: () => { if (fitCleanup) fitCleanup(); }
   });
   panel.classList.add('pd-host');
   ```

   `openPage`'s `_setPanelTitle` already strips `emojiIcon` spans / lucide tags to safe text, so
   passing `barLabel` (HTML with an emoji icon + escHtml'd doc number) as the title renders as
   "🧾 Purchase Order — PR-123" — the payslip passes titles the same way.

3. `lucide.createIcons({ nodes: [panel] })`, then run the scale-to-fit measurement (§5) and wire
   the header buttons (§3/§4).

4. `autoPrint`: no current caller passes it, but the converted ID-card path (§5A) will. Semantics
   in the new host: after fit + icons settle (`setTimeout` ~400 ms), if **not** iOS-standalone,
   call `window.print()`. On iOS standalone do nothing automatic — `navigator.share` requires a
   user gesture, so the user taps the header button instead (optionally show one toast:
   "Use Print / Save PDF above").

5. **Return value:** return the panel element (truthy). The old contract returned `Window | null`;
   all seven callers invoke it as a bare statement (verified — no `= openPrintableDoc(` anywhere),
   so nothing depends on the Window. The popup-blocked toast and `null` branch are deleted.

### 1.3 Options contract — old vs new

| opt            | old meaning                              | new meaning |
|----------------|------------------------------------------|-------------|
| `title`        | popup `<title>`                          | fallback panel title + **save filename stem** (§4) |
| `bodyHtml`     | doc content                              | unchanged |
| `pageId`       | id on `.page`                            | unchanged |
| `barLabel`     | toolbar label HTML                       | panel header title (sanitized by `_setPanelTitle`) |
| `extraButtons` | extra toolbar HTML                       | appended verbatim into `headerRightHTML` (see §6 invoice — its only user is being removed) |
| `extraScript`  | raw JS `<script>` in popup               | **REMOVED.** CSP has no `unsafe-eval`, so `new Function` is blocked; there is no way to execute caller-supplied JS text in-app. Sole user (invoice cdnjs JPEG) is deleted in §6.1. If passed: `console.warn('openPrintableDoc: extraScript is no longer supported')` and ignore. |
| `accent`       | toolbar/accent color                     | kept: set `--pd-accent` on `.pd-stage` (still consumed by any caller CSS referencing it; header buttons use app theme) |
| `bgColor`      | popup body bg                            | accepted + ignored (panel body provides the backdrop, like the payslip). Document in the header comment. |
| `pageCss`      | per-doc CSS                              | unchanged, injected verbatim after scoped base CSS |
| `watermark`    | watermark text                           | unchanged (`.wm` rendering — §1.4 position fix) |
| `winFeatures`  | window.open features                     | accepted + ignored |
| `autoPrint`    | print on popup load                      | see §1.2 step 4 |

Callers therefore need **zero changes** — except deleting the invoice's dead `extraScript`/
`extraButtons` (§6.1) and the ID-card conversion (§5A).

### 1.4 Scoped base CSS (rewrite of `BASE_CSS`)

The popup's BASE_CSS used bare `body`/`*`/`table` selectors — those must not leak into the app.
Rewrite with identical *declarations*, scoped selectors:

- `*{box-sizing…}`             → `.pd-stage,.pd-stage *{box-sizing:border-box;margin:0;padding:0}`
- `body{font…}`                → `.pd-stage{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000}`
- `table / th,td / td.c / td.r / td.b / tr.blank td` → each prefixed `.pd-stage ` (declarations byte-identical — callers rely on these defaults)
- `.bar / .bar button / .pd-close / .barpad` → **deleted** (header buttons replace the toolbar)
- `.wm` → `.pd-stage .wm{position:absolute;…same decls…}` **plus** `.pd-stage .page{position:relative}`
  (old `.wm` was `position:fixed`, which inside an in-app panel would pin to the viewport, not the
  sheet). Under `@media print`, restore `position:fixed` so the watermark repeats on every printed
  page exactly as before (§2 block).
- old `@media print{@page{size:A4 portrait;…}}` fallback → keep, but note it now lives in the same
  document as letterhead `printCSS`; caller CSS is injected *after* it, so a caller/letterhead
  `@page` (e.g. landscape) still wins by cascade order — same ordering guarantee as before.

---

## 2. Print — only the document, never the app

Reuse the payslip's proven two-layer isolation, shipped as the third chunk of the panel's
`<style>` (after caller pageCss so it wins):

```css
@media print{
  /* (a) confidentiality: beat styles.css's `#page-content,#page-content *{visibility:visible}`
     (v13 Phase 56) — otherwise the invoice would print the underlying Finance screen too,
     the exact leak the payslip fixed. Same !important trick as hr.js _psPrintCss. */
  #page-content,#page-content *{visibility:hidden!important}
  .pd-print,.pd-print *{visibility:visible!important}

  /* (b) multi-page un-clipping — NEW vs the payslip (which is always 1 page).
     .page-panel is position:fixed with an overflow-y:auto body (styles.css ~2191/2203);
     browsers clip printed content inside scrolling fixed containers to one page.
     Release the geometry for the doc panel only: */
  .pd-host.page-panel{position:static!important;inset:auto!important;height:auto!important;overflow:visible!important;transform:none!important}
  .pd-host .page-panel-body{overflow:visible!important;height:auto!important}
  .pd-host .page-panel-head,.pd-host .page-panel-foot{display:none!important}

  /* (c) sheet placement + un-scale (payslip §3 pattern) */
  .pd-stage{transform:none!important;width:auto!important;height:auto!important;padding:0!important}
  .pd-host .page{position:absolute;left:0;top:0;width:100%;margin:0}
  .pd-host .wm{position:fixed}   /* restore legacy repeat-on-every-page watermark */
}
```

Interactions verified against css/styles.css:
- The global `body *{visibility:hidden}` reset (v13 Phase 56) hides all app chrome; `(a)` shows
  the sheet subtree. Stacked page panels beneath already carry inline `visibility:hidden`
  (`page-under`), so they can't print either.
- The base print block hides `.btn-*` and the sidebar/topbar/navs — panel header buttons vanish
  in print even before `(b)` display:none's the whole head.
- Caller `@media print{.page{width:auto;padding:0;min-height:0}}` rules still apply (they're in
  the same `<style>`, earlier chunk — no conflict with (c), which sets position, not width).

`autoPrint` uses this same path (§1.2 step 4).

---

## 3. Built-in toolbar → openPage `headerRightHTML`

```js
const headerRightHTML = `
  <button class="btn-primary btn-sm" id="pd-print-btn">${emojiIcon('🖨',16)} Print / Save PDF</button>
  <button class="btn-secondary btn-sm" id="pd-jpeg-btn">${emojiIcon('📷',16)} Save as JPEG</button>
  ${o.extraButtons || ''}`;
```

Wired after `openPage` returns (payslip pattern — listeners on the returned panel, no inline
onclick):
- `#pd-print-btn` → `_handleDocPrintOrPdf(o, panel, btn)`: **not** iOS-standalone → `window.print()`;
  iOS-standalone → capture → PDF → Web Share (§4), with the payslip's exact error ladder
  (AbortError = silent; `SHARE_UNAVAILABLE` = toast + best-effort `window.print()`; else toast).
  Button disabled + "Generating…" during work, always restored in `finally`.
- `#pd-jpeg-btn` → `_downloadDocJPEG(o, panel, btn)` (§4): Web Share when `canShare({files})`,
  else Blob-URL anchor download (never a data: URL). Same toast/finally discipline.

Every caller thus gets Save for free — no more hand-rolled `downloadJPEG`.

---

## 4. Save (PDF / JPEG) — local vendored pipeline, zero CDN

Add to print-docs.js (private, copied from the proven hr.js §4 implementations — hr.js itself is
NOT modified):

- `_ensureHtml2Canvas()` — lazy `<script src="js/vendor/html2canvas.min.js">` (same-origin, CSP
  `'self'`, already in sw.js PRECACHE; both this loader and hr.js's guard on `window.html2canvas`,
  so no double-load).
- `_ensurePdfLite()` — lazy `js/pdf-lite.js` (guards on `window.jpegToPdf`).
- `_isIOSStandalone()` — byte-identical logic to hr.js.
- `_captureDocCanvas(panel, o, {scale})` — **capture target: the `.page` sheet**
  (`panel.querySelector('#'+CSS.escape(pageId))`, falling back to `panel.querySelector('.pd-print')`).
  Clone-capture exactly like `capturePayslipCanvas`: clone the sheet, `transform:'none'`,
  off-viewport fixed wrapper with `background:#fff`, `html2canvas(clone,{scale:2,useCORS:true,
  backgroundColor:'#fff',logging:false})`, remove wrapper in `finally`. The letterhead logo is a
  same-origin absolute URL (`absLogo`, letterhead.js) — captures cleanly.
- Huge-canvas fallback: on `toBlob` failure retry once at `scale:1` (payslip edge case — matters
  more here: a multi-page landscape lead sheet at scale 2 can exceed iOS's ~16.7 MP canvas cap).
- `_canvasToJpegBlob(canvas)` — `image/jpeg`, 0.92.

**PDF path (`_shareDocPDF`)** — payslip's `sharePayslipPDF` generalized for length + orientation:

1. Detect orientation from the *unscaled* sheet layout width: `sheet.offsetWidth > 950px` ⇒
   landscape (portrait sheets are ~794 px, landscape ~1123 px; offsetWidth ignores transforms).
2. Page-slice long documents: page height in canvas px = `sheetWidthPx × (841.89/595.28)` for
   portrait, `× (595.28/841.89)` for landscape, times the capture scale. Slice the captured
   canvas into per-page canvases (last slice = remainder) and pass the **array form** of
   `window.jpegToPdf([{bytes,pxW,pxH},…])` — pdf-lite already supports multi-page (its header
   documents exactly this "one slice per page" use). A one-page doc degenerates to the single
   `jpegToPdf(buf,w,h)` call, identical to the payslip.
3. **pdf-lite additive change (required for landscape quality):** `js/pdf-lite.js` hardcodes
   portrait A4 (`PAGE_W 595.28 / PAGE_H 841.89`). Add an optional trailing `opts`/per-page
   `landscape:true` flag that swaps page W/H for that page. Strictly additive — existing calls
   (payslip, always portrait) are byte-identical in behavior. If the implementer finds pdf-lite's
   fit math already letterboxes landscape images acceptably, this may be deferred, but the flag is
   the recommended, low-risk route.
4. Filename: `sanitize(o.title)` → `[^a-zA-Z0-9-]` stripped, `.pdf`/`.jpg` (payslip pattern);
   share `title` = `o.title`.

**JPEG path** shares steps 1's capture (no slicing — one tall JPEG is fine for an image).

Remove/centralize the cdnjs load: after §6.1 deletes the invoice's `extraScript`, `git grep cdnjs`
must return nothing under `js/` (verification §7).

---

## 5. A4 (and landscape A4) on a phone — generalized scale-to-fit

The payslip's `fitA4Sheet` hardcodes 794 px. Docs here are 210 mm (~794 px) *or* 297 mm
(~1123 px) wide, with content-driven heights, so print-docs.js gets its own generalized fitter
(hr.js untouched):

```
_fitDocSheet(panel) — returns cleanup fn (chained into onClose, like fitA4Sheet):
  recalc():
    sheet  = panel.querySelector('.pd-print'); stage = panel.querySelector('.pd-stage')
    w      = sheet.offsetWidth, h = sheet.offsetHeight        // layout px, transform-independent
    avail  = (sheet.closest('.page-panel-body') || panel).clientWidth
    scale  = min(1, (avail - 16) / w)
    stage.style.width  = (w*scale)+'px'; stage.style.height = (h*scale)+'px'
    sheet.style.transform = 'scale('+scale+')'; sheet.style.transformOrigin = 'top left'
  run once + on resize/orientationchange (live listener, removed by cleanup)
```

Differences from `.a4-stage` (deliberate): dimensions are *measured*, not fixed, so 297 mm
landscape sheets and tall multi-page sheets get a correct stage box (the payslip's fixed
`height:calc(1123px*scale)` would clip/overlap them). `@media print` neutralizes the transform
(§2c). Desktop (`avail ≥ w`) ⇒ scale 1, sheet renders exactly as the old popup did, centered by
`.pd-stage{margin:0 auto}`. Capture (§4) clones with `transform:none`, so saves are always 1×
layout regardless of on-screen scale.

Minimum CSS additions (in the scoped base CSS, §1.4): `.pd-stage{margin:0 auto;padding:16px 8px}`
and forced-light tokens on the sheet mirroring `.a4-sheet`'s
(`background:#fff;color-scheme:light` + the `--surface/--border/--text…` re-pins) so dark/Astral
themes never bleed into the paper — callers already set `background:#fff` on `.page`, this just
hardens tokens any letterhead/body markup consumes.

## 5A. ID cards (`window.printIDCards`, js/app.js:2486)

Same disease (`window.open` + document.write + auto `window.print()` at app.js:2522), same cure —
convert it into an **openPrintableDoc caller** rather than a second bespoke host. One
self-contained edit inside `printIDCards` (its signature `(data, tokens)` is unchanged, so all
three call sites — app.js employee self-card ×2 and hr.js worker single/batch IDs at 1879/1889 —
work untouched):

- `bodyHtml` = the existing `cardFront/cardBack` HTML, unchanged.
- `pageCss` = the existing CR80 CSS with its `body{…}` rule moved onto the sheet:
  `.page{width:210mm;margin:0 auto;background:#fff;padding:12px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}`
  plus the existing `.cr80…` rules and `@media print{.page{background:#fff;padding:0;gap:4mm}
  .cr80{box-shadow:none;page-break-inside:avoid}}`. Keep `@page{size:auto;margin:6mm}`.
- Call: `openPrintableDoc({ title:'ID Cards — Barro Industries', barLabel:'🪪 ID Cards',
  bodyHtml, pageCss, autoPrint:true })`.
- Behavior delta (accepted): desktop still pops the print dialog immediately (`autoPrint`); iOS
  standalone now *shows* the cards in-app with working Print/Save-PDF/JPEG buttons instead of
  failing silently — the whole point. The QR SVGs and same-origin logo capture fine via
  html2canvas. Delete the `alert('Please allow pop-ups…')`.

---

## 6. Per-caller compatibility walkthrough (all verified against current source)

| # | Caller | Doc | Sheet | Watermark | autoPrint | Survives? / touch needed |
|---|--------|-----|-------|-----------|-----------|--------------------------|
| 1 | `js/departments.js:2404` (`buildBillingInvoiceHTML` via `openBillingInvoice`) | Billing Invoice | 210 mm portrait, letterhead `printCSS` concatenated into pageCss | — | — | **Only caller needing an edit** — §6.1 |
| 2 | `js/screens/crm.js:498` (`openROCPrintSheet`) | ROC Restaurant Lead Sheet | **297 mm landscape** (letterhead `orientation:'landscape'` owns `@page`) | — | — | Zero changes. Multi-page capable → exercises §2(b) un-clipping + §4 slicing |
| 3 | `js/screens/sales.js:1684` (`openAECPrintSheet`) | AEC Partner Contact Sheet | 297 mm landscape | — | — | Zero changes (same shape as #2). *(Task brief called this "quote/SO doc" — it is actually the AEC contact sheet.)* |
| 4 | `js/screens/production.js:348` (`printDeliveryReceipt`) | Delivery Receipt | 210 mm portrait, letterhead | — | — | Zero changes |
| 5 | `js/screens/production.js:1832` (`openInventoryCountForm` print path) | Inventory Count Form | 297 mm landscape, letterhead, passes `accent` | — | — | Zero changes (`accent` still honored via `--pd-accent`) |
| 6 | `js/screens/production.js:2934` (`printPurchaseOrder`) | Purchase Order | 210 mm portrait, letterhead | `'PENDING APPROVAL'` when unapproved | — | Zero changes — `.wm` renders inside the sheet on screen (§1.4) and repeats per printed page (§2). Verify watermark also appears in the captured JPEG/PDF (it's in-subtree, so it will) |
| 7 | `js/screens/production.js:2977` (`printReceivingReport`) | Receiving Report | 210 mm portrait, letterhead | — | — | Zero changes |
| A | `js/app.js:2522` (`printIDCards`) | CR80 ID cards | flex sheet of 85.6×54 mm cards | — | effectively yes (old auto-print) | Converted per §5A |

Common properties verified: every caller's `pageCss` uses only `.page`-scoped or bare-element
selectors (safe under §1.1's leak assessment — nothing targets app chrome); every letterhead
consumer concatenates `_lh.printCSS` *inside its own pageCss string*, so the cascade-order
contract ("caller CSS after base CSS") is preserved verbatim; the letterhead logo URL is absolute
same-origin (letterhead.js `absLogo` — works in-app and in html2canvas; its comment about
window.open can gain a "also fine in the in-app host" note, no code change). No caller reads the
return value; none passes `autoPrint`; only #1 passes `extraButtons`/`extraScript`.

### 6.1 The one caller edit — billing invoice (js/departments.js ~2388–2414)

Delete the `extraScript` const (the cdnjs `downloadJPEG` — lines ~2388–2402) and the
`extraButtons`/`extraScript` keys from the `openPrintableDoc` call. The built-in
`#pd-jpeg-btn` replaces it with the local-vendor pipeline (and actually works, which the cdnjs
version never did under CSP). Keep `pageId:'invoice-page'` (harmless, still the capture target id).

---

## 7. Verification

For **each** of docs #1–#7 + A (test data exists in dev for all — an invoice from any project's
Billing tab, ROC/AEC print buttons, a DR/PO/RR from Production, Inventory count form, My ID card):

1. **Opens in-app** — tapping the doc button pushes an openPage panel (back arrow returns to the
   originating screen, which is preserved underneath — the page-stack contract). No popup, no
   toast about pop-ups, on: desktop Chrome, desktop Safari, iPhone Safari (tab), **iPhone
   standalone PWA** (the target).
2. **Sheet fidelity** — letterhead header/logo/footer/signatures render; landscape sheets (#2,
   #3, #5) show full width scaled to the phone with no horizontal body scroll; PO pending state
   shows the diagonal watermark over the sheet only.
3. **Print (desktop + Android/regular Safari)** — Print / Save PDF → print preview contains ONLY
   the document: no app chrome, no header buttons, and critically **not the underlying screen**
   (open the invoice from the Finance projects screen and confirm no project/finance rows appear —
   the §2(a) confidentiality check). Multi-page check: an AEC/ROC sheet with 30+ rows previews
   as N landscape pages, headers repeating (`thead{display:table-header-group}` from letterhead
   printCSS), not one clipped page — this is the §2(b) regression gate.
4. **Save on iOS standalone** — Print/Save PDF → share sheet with a correctly-oriented,
   multi-page-when-long PDF (Save to Files, then open to inspect); Save as JPEG → share sheet →
   Save Image. Cancel (AbortError) leaves no error toast; buttons always recover from
   "Generating…".
5. **Save on desktop** — both buttons download `.pdf`/`.jpg` files named from the doc title.
6. **No CDN left:** `grep -rn "cdnjs" js/ index.html` → zero hits. `grep -rn "window.open(" js/`
   → no remaining document-rendering uses (allowed leftovers: unrelated link-outs like
   `target="_blank"` anchors / proofUrl links only).
7. **Payslip unaffected:** open a payslip, Print/Save PDF + JPEG still work (shared loaders
   coexist; pdf-lite portrait path byte-identical) — and Print-All payroll still prints.
8. **Plain Ctrl+P regression:** on an ordinary screen (no doc panel open), Ctrl+P still prints
   the screen (v13 Phase 147 behavior) — the §2 overrides ship *inside* doc panels only, so they
   are absent from the document once the panel closes.
9. **Housekeeping:** `CACHE_VER` derives from `APP_VERSION` via the pre-commit hook — commit
   normally, do not hand-edit; verify the bumped SW picks up print-docs.js/pdf-lite.js. Confirm
   `git diff` shows **no changes** to any amount computation (the diff should touch only
   js/print-docs.js, js/pdf-lite.js (additive flag), js/departments.js (deletion), js/app.js
   (printIDCards internals), and optionally css/styles.css if any shared rule is promoted there).

---

## 8. Risks (ranked) & mitigations

1. **Multi-page print clipping** (§2b) — the payslip never exercised >1 page inside the
   fixed/overflow panel; the geometry-release overrides are new. Gate on verification step 3's
   30-row landscape test in Chrome *and* Safari before shipping.
2. **Caller-CSS bleed while a panel is open** — bare `th/td/table` rules restyle hidden screens
   beneath; invisible in practice (full-screen opaque panel) and self-cleaning on close, but if a
   future overlay renders *above* a doc panel it inherits doc table styling. Accepted (existing
   payslip/BIR precedent); revisit only if observed.
3. **iOS canvas limits on long sheets** — scale-2 capture of a many-page sheet can exceed ~16.7 MP;
   the scale-1 retry is the mitigation, and PDF slicing keeps output readable. Test with a 50-row
   sheet on a real iPhone.
4. **pdf-lite landscape flag** — additive but touches a payroll-adjacent file; keep the change to
   the page-dimension constants selection only, and re-run verification step 7.
5. **`extraScript` removal** — safe today (one dead user), but any uncommitted concurrent work
   adding a new `extraScript` caller would silently lose it; the console.warn makes that loud.
   Re-`git diff` before commit (repo rule) to catch new callers added mid-flight.

**Non-goals:** no hr.js refactor, no change to BIR print host, no Firestore/rules/storage changes,
no change to any peso amount, tax figure, or totals math anywhere.
