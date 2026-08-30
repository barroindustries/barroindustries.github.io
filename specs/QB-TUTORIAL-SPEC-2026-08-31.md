# QB-TUTORIAL-SPEC — 2026-08-31
## In-app Help + guided demo tour for quote-builder-v2.html, plus a self-updating maintenance skill

**Goal (Neil's request):** a tutorial at the top of the quote builder — a **❓ Help** button, a
"**New to the quote builder?**" first-run banner, and a **guided demo** (spotlight tour) that walks
the real UI. Plus a repo skill so that every future redesign/update of the quote builder also
updates this tutorial ("What's new" + tour steps).

Everything lives inside `quote-builder-v2.html` (self-contained file, no build step, no external
libs — CSP and offline constraints). Two small new files: the skill and one CLAUDE.md line.

---

## 0. Deliverables

1. `quote-builder-v2.html` — Help button (desktop topbar + mobile sheet), first-run/update banner,
   Help modal, spotlight tour engine + authored content, `TUTORIAL_VERSION` + `WHATS_NEW` data.
2. `.claude/skills/quote-builder-tutorial/SKILL.md` — the maintenance skill (full content in §8).
3. `CLAUDE.md` (project) — one bullet under **Conventions** (§9).
4. STATUS.md session log entry (the main session handles this after review — implementer skips it).

---

## 1. Facts about the current file you must respect

- Default view is **Client** (`currentView='client'`, `<body class="body-client-view">`): the
  read-only document preview `#qbDocSheet` is shown and the editing workspace
  `#internalWorkspace` is `display:none`. Internal/Admin views show the workspace.
- `GENERIC_PARTNER` sessions: `#internalWorkspace` is always visible, the Internal/Admin pills are
  removed, and `setView('client')` must NEVER be called for them (documented trap inside
  `setView()` — it would permanently hide their workspace).
- BS-partner lock mode hides the whole company toggle-pills wrapper; Admin button may not exist.
  **Every tour step must therefore skip gracefully when its target is missing or hidden.**
- z-index map: topbar 300, `.modal-overlay` 1000, mobile sheet 2000. Tour overlay/card use
  2400/2450; Help modal overlay 2600 (opens above an active tour).
- The Client Information section `<div class="section no-print">` (around line 1180) has **no id**
  — add `id="clientInfoSection"` to it (additive, nothing else references it).
- All new UI is `no-print`. No user content is interpolated into the new HTML (all copy is
  static), so no escaping concerns — but keep it that way: never interpolate quote data into
  tutorial markup.
- OneDrive mtime race: if the Edit tool fails "modified since read" more than twice, fall back to
  a python exact-match replace script or desktop-commander `edit_block` (see memory).
- Do NOT hand-edit `APP_VERSION`/`CACHE_VER` — the pre-commit hook owns them. Do not commit;
  the main session commits after review.

---

## 2. Insertion points (marker-based, not line numbers — the file evolves)

| What | Where |
|---|---|
| CSS block | immediately before `</style>` (line ~889), fenced by marker comments |
| Help button | first child of `<div class="topbar-right">`, before `#draftSaveChip` |
| Mobile sheet row | inside `#mtbSheet`, directly after the `#mtbQuick` row |
| Banner | immediately after the opening `<div class="main">`, before the INTERNAL WORKSPACE comment (outside `#internalWorkspace`, so it shows in every view) |
| Help modal + tour DOM | immediately after the VERIFY & FILE MODAL block (after its closing `</div>`) |
| JS block | at the END of the main `<script>`, just before `</script>`, fenced by marker comments |

Marker comments (the skill greps for these — keep them verbatim):

- CSS: `/* ── HELP & TUTORIAL (QB-TUTORIAL-SPEC-2026-08-31 · .claude/skills/quote-builder-tutorial) ── */`
- HTML: `<!-- ── HELP & TUTORIAL UI (QB-TUTORIAL-SPEC-2026-08-31) ── -->`
- JS: `// ══ HELP & TUTORIAL — TUTORIAL_VERSION / WHATS_NEW / TOUR_STEPS (update via .claude/skills/quote-builder-tutorial) ══`

---

## 3. Topbar + mobile entry points

Desktop (first in `.topbar-right`):

```html
<button class="btn btn-outline no-print" id="btnHelp" onclick="openHelpModal()" title="Help & guided demo">❓ Help<span class="help-dot" id="helpDot"></span></button>
```

`.help-dot`: 8px gold (`var(--accent)`) circle, `display:none` by default, absolute top-right of
the button (button gets `position:relative`), shown when there are unseen What's-new entries.

Mobile sheet row (after `#mtbQuick`):

```html
<button class="mtb-row" id="mtbHelp" onclick="mtbRun('openHelpModal')">❓ Help &amp; demo</button>
```

`mtbRun` already closes the sheet then calls the named global — no extra wiring needed.

---

## 4. Banner — "New to the quote builder?"

```html
<!-- ── HELP & TUTORIAL UI (QB-TUTORIAL-SPEC-2026-08-31) ── -->
<div class="no-print qb-tut-banner" id="qbTutBanner" style="display:none;">
  <div class="qb-tut-text" id="qbTutBannerText"></div>
  <div class="qb-tut-actions">
    <button class="btn btn-outline" id="qbTutBannerNo" style="padding:6px 14px;font-size:12px;"></button>
    <button class="btn btn-accent" id="qbTutBannerYes" style="padding:6px 14px;font-size:12px;"></button>
  </div>
</div>
```

Style it like `.draft-resume-banner` (same visual family: white card, accent left border 4px,
flex row, wraps on mobile). Two variants, chosen by `initTutorial()`:

- **First-run** (never opened Help, banner not dismissed):
  text `👋 <strong>New to the quote builder?</strong> Take a 2-minute guided demo of how a quote gets built, priced and filed.`
  — Yes = `▶ Start the demo` → `startTour()` (also marks seen + hides banner). No = `Maybe later` → dismiss.
- **Updated** (has seen an older version, `TUTORIAL_VERSION` is newer, not dismissed at this version):
  text `✨ <strong>The quote builder was updated.</strong> See what changed since you last looked.`
  — Yes = `What's new` → `openHelpModal('whatsnew')`. No = `Dismiss` → dismiss.

Dismiss stores the version it was dismissed at, so the next `TUTORIAL_VERSION` bump re-shows the
"Updated" variant exactly once per version.

### localStorage (wrap every read/write in try/catch; never rename these keys)
- `qbTutSeenVer` — highest `TUTORIAL_VERSION` whose Help modal the user has opened (or tour taken).
- `qbTutDismissedVer` — version at which the banner was last dismissed.

---

## 5. Help modal

Reuse the existing modal classes (`.modal-overlay/.modal-box/.modal-hdr/.modal-body/.modal-footer`):

```html
<div class="modal-overlay no-print" id="helpModal" style="display:none;z-index:2600;" onclick="if(event.target===this)closeHelpModal()">
  <div class="modal-box" style="max-width:640px;" onclick="event.stopPropagation()">
    <div class="modal-hdr"><h3>❓ Quote Builder — Help</h3><button class="modal-x" onclick="closeHelpModal()">✕</button></div>
    <div class="modal-body" id="helpBody"> …static content below… </div>
    <div class="modal-footer">
      <button class="btn btn-outline" style="background:var(--dark-blue);" onclick="closeHelpModal()">Close</button>
      <button class="btn btn-green" onclick="closeHelpModal();startTour();">▶ Start guided demo</button>
    </div>
  </div>
</div>
```

`openHelpModal(section?)` — shows the modal, records `qbTutSeenVer = TUTORIAL_VERSION`, hides the
help-dot and banner; if `section==='whatsnew'`, scrolls `#helpWhatsNew` into view. Esc closes
(add to the existing keydown listener pattern; don't break the mobile-sheet Esc handling).

### Help body content (static HTML — author exactly this copy)

**How a quote gets made** (ordered list):
1. **Pick the company** — Barro Kitchens / Barro Industries / Brilliant Steel. Letterhead, quote number and payment details follow it.
2. **Quote number** — Auto builds the official number; Manual is only for re-issuing.
3. **Client information** — type the name; existing clients autocomplete.
4. **Add items** — filter by category or search; a calculator opens per product (dimensions, unit, qty → live price). ➕ Custom item for non-catalog work, ＋ Section for Option A / Option B quotes.
5. **Pricing** — VAT 12%, discount (percent or ₱), agent commission, Options mode.
6. **Details** — delivery & installation, timeline, payment schedule, remarks, terms.
7. **Verify & File** — completeness checklist; filing makes the quote official.
8. **Print / Share** — Print/PDF for the client, Agent Copy (confidential, with commission), Share link (filed quotes only).

**The three views** (short paragraphs): *Client* = the finished document exactly as the customer
sees it. *Internal* = the editing workspace plus labor, cost & margin and break-even. *Admin* =
the product database and price coefficients. Some views may be hidden depending on your account.

**Good to know** (bullets):
- ⚡ **Quick Quote** — a 3-step wizard (client → products → review) that fills the builder for you.
- 📝 Your work **auto-saves as a draft**; an unfiled quote offers to resume next time.
- 🧾 **Agent Copy** is confidential — never send it to the client.
- 🔗 **Share** requires the quote to be filed first — it will prompt you.

**What's new** — `<div id="helpWhatsNew"></div>`, rendered by JS from `WHATS_NEW` (version, date,
bullet list; newest first).

---

## 6. Data: TUTORIAL_VERSION + WHATS_NEW (JS block, at the markers)

```js
const TUTORIAL_VERSION = 1;   // integer; bump on every user-visible quote-builder change
const WHATS_NEW = [           // newest first; plain user language, no dev jargon
  { ver:1, date:'2026-08-31', items:[
    '❓ Help & guided demo — this guide, the Help button, and the welcome banner.',
  ]},
  { ver:0, date:'2026-08-26', items:[
    'Custom items now carry a real bill of materials — pricelist materials, crew-day labor and auto-generated specs.',
    'Internal view: true-cost panel and break-even v2 on every quote.',
    'Client view is now a live preview of the exact printed document.',
  ]},
];
```

---

## 7. Guided demo — spotlight tour

### DOM (next to the Help modal)

```html
<div class="no-print" id="qbTourHighlight" style="display:none;"></div>
<div class="no-print" id="qbTourCard" style="display:none;" role="dialog" aria-label="Guided demo">
  <div class="qb-tour-step" id="qbTourStepNo"></div>
  <div class="qb-tour-title" id="qbTourTitle"></div>
  <div class="qb-tour-body" id="qbTourBody"></div>
  <div class="qb-tour-btns">
    <button class="btn btn-outline" id="qbTourBack" onclick="tourGo(-1)">‹ Back</button>
    <button class="btn btn-green" id="qbTourNext" onclick="tourGo(1)">Next ›</button>
    <button class="qb-tour-skip" onclick="endTour()">Skip demo ✕</button>
  </div>
</div>
```

### CSS
- `#qbTourHighlight`: `position:fixed; z-index:2400; pointer-events:none; border-radius:10px;
  box-shadow:0 0 0 9999px rgba(15,23,42,.55), 0 0 0 3px var(--accent); transition:all .25s ease;`
- `#qbTourCard`: `position:fixed; z-index:2450; background:white; border-radius:12px; padding:16px 18px;
  max-width:340px; box-shadow:0 8px 30px rgba(0,0,0,.35);` — title bold 14px dark-blue, body 13px,
  step counter 11px gray. On ≤520px viewports: full-width bottom sheet
  (`left:8px;right:8px;bottom:8px;max-width:none;`).
- Centered variant (steps with no target): highlight hidden, card centered via
  `left:50%;top:50%;transform:translate(-50%,-50%);` plus a plain dim backdrop —
  reuse the highlight div with `box-shadow:0 0 0 9999px rgba(15,23,42,.55)` and zero size at center.

### Engine (`startTour` / `tourGo(delta)` / `endTour` / `positionTour`)
- State: `tourActive`, `tourIdx`, `tourSavedView`, `tourChangedView` (bool).
- `startTour()`: if already active return; hide banner; close Help modal + mobile sheet if open;
  record `tourSavedView = currentView`; mark seen (`qbTutSeenVer`); show step 0.
- Step resolution: `showTourStep(i, dir)` — `dir` is +1/−1; if `i` out of range → `endTour()`.
  - If step has `needsWorkspace` and `#internalWorkspace` is hidden
    (`offsetParent===null`): if `#btnInternal` exists and is visible, call `setView('internal')`
    once and set `tourChangedView=true`; if the workspace is still hidden, **skip** in direction
    `dir` (recurse to `i+dir`).
  - Resolve `target` via `querySelector`; if step has `closest`, expand to
    `el.closest(step.closest)||el`. If element missing, `offsetParent===null`, or rect is 0×0 →
    skip in direction `dir`.
  - Steps without `target` render the centered card.
- Positioning: `el.scrollIntoView({block:'center',behavior:'smooth'})`, then `setTimeout(positionTour,350)`.
  `positionTour()` uses `getBoundingClientRect()` + 6px padding for the highlight; card goes below
  the rect when it fits, else above, clamped 8px inside the viewport. Reposition on `resize` and
  on `scroll` (capture, passive, rAF-throttled) while active.
- Keys while active: `Escape` → `endTour()`, `ArrowRight`/`ArrowLeft` → `tourGo(±1)`. Add/remove
  the listener in `startTour`/`endTour` (a dedicated listener; don't touch the existing one).
- Buttons: Back hidden on first step; Next reads `Finish ✓` on the last; counter `“3 / 13”`.
- `endTour()`: hide DOM, remove listeners, and if `tourChangedView` restore the saved view —
  `setView(tourSavedView)` — **only when** the pill for that view still exists AND NOT
  (`GENERIC_PARTNER` && `tourSavedView==='client'`). (For GENERIC_PARTNER the workspace was
  already visible, so `tourChangedView` never gets set — this guard is belt-and-braces.)
- The tour is read-only: it must never modify quote state, drafts, or call any filing/printing
  function.

### TOUR_STEPS — author exactly this content

```js
const TOUR_STEPS = [
 { title:'Welcome to the Quote Builder 👋',
   body:'This is where Barro Kitchens, Barro Industries and Brilliant Steel quotes are built, priced, filed and shared. This demo takes about 2 minutes and changes nothing in your quote.' },
 { target:'#coBK', closest:'.toggle-pills', title:'Pick the company',
   body:'Each quote belongs to one company. The logo, letterhead, quote number and payment details all follow this choice.' },
 { target:'#btnClient', closest:'.toggle-pills', title:'Three views',
   body:'Client shows the finished document exactly as the customer will see it. Internal is the editing workspace with costs and margins. Admin manages the product database. Some views may be hidden for your account.' },
 { target:'#btnQuick', title:'Quick Quote',
   body:'In a hurry? Quick Quote is a 3-step wizard — client → products → review — that fills the full builder for you. Everything it creates can still be fine-tuned afterwards.' },
 { target:'.qno-builder-section', needsWorkspace:true, title:'Quote number',
   body:'Auto mode builds the official number from company, location and date. Switch to Manual only when re-issuing an existing number.' },
 { target:'#clientInfoSection', needsWorkspace:true, title:'Who is this quote for',
   body:'Type the client\'s name — existing clients autocomplete from your records. Name, address and contact details flow straight onto the printed document.' },
 { target:'#addItemsSection', needsWorkspace:true, title:'Add items',
   body:'Filter by category or just search. Picking a product opens a calculator — set dimensions, unit and quantity, and the price computes live. ➕ Custom item prices non-catalog work, and ＋ Section splits the quote into Option A / Option B.' },
 { target:'#itemsSection', needsWorkspace:true, title:'Items, discounts & totals',
   body:'Every line lands here. Below the table: VAT (12%), discounts (percent or peso), agent commission, and Options mode — pricing each section separately with no grand total.' },
 { target:'#diSection', needsWorkspace:true, title:'Delivery, timeline & payments',
   body:'Below the items: delivery & installation details, the project timeline, the payment schedule, and the bank / e-wallet details that print on the quote.' },
 { target:'#termsSection', needsWorkspace:true, title:'Terms & conditions',
   body:'Standard terms are pre-loaded per company. Adjust them for this quote — they print at the end of the document with the signature blocks.' },
 { target:'#internalPanel', needsWorkspace:true, title:'Costs & margin (Internal only)',
   body:'Internal view adds labor & timeline planning plus the cost & margin panel — true cost, break-even and margin for this quote. Clients never see any of this.' },
 { target:'#btnVerify', title:'Verify & File',
   body:'When the quote is ready, Verify & File runs a completeness checklist (waive anything genuinely N/A) and files the quote — that is what makes it official and shareable.' },
 { target:'#btnShare', title:'Print, Agent Copy & Share',
   body:'Print/PDF produces the client document. Agent Copy prints a confidential internal version with commission details. Share creates a client link — the quote must be filed first.' },
 { title:'That\'s the whole flow 🎉',
   body:'Your work auto-saves as a draft while you type — an unfiled quote offers to resume next time you open the builder. Tap ❓ Help any time for the written guide and What\'s New.' },
];
```

(`#btnVerify`/`#btnShare` are hidden on ≤768px mobile — the skip rule handles it; the mobile
sheet rows cover those actions.)

### initTutorial()
Runs once at boot (append the call wherever the file runs its other init calls at script end —
after the DOM exists). Reads the two localStorage keys, then: sets banner variant + shows it
(§4 rules), toggles `#helpDot` (`seenVer < TUTORIAL_VERSION`), renders `#helpWhatsNew` from
`WHATS_NEW`. Must be defensive: every DOM lookup null-guarded, localStorage in try/catch —
this must never break boot.

---

## 8. The skill — `.claude/skills/quote-builder-tutorial/SKILL.md` (create verbatim)

```markdown
---
name: quote-builder-tutorial
description: Keep the quote builder's built-in Help & guided demo in sync. Use whenever quote-builder-v2.html is edited, redesigned, restructured, or gains/loses a feature — any change a user would notice (new section, renamed button, new pricing control, changed flow, new view). Also use when Neil asks to update the quote-builder tutorial, Help content, What's New, or the demo tour.
---

# Quote Builder tutorial — maintenance contract

`quote-builder-v2.html` contains a built-in Help modal, a first-run/update banner, and a spotlight
demo tour (spec: `specs/QB-TUTORIAL-SPEC-2026-08-31.md`). **Any user-visible change to the quote
builder is not done until the tutorial reflects it.** Pure refactors/bugfixes with zero visible
change need no update.

Find the three fenced blocks by grepping for:
- `HELP & TUTORIAL (QB-TUTORIAL-SPEC-2026-08-31` (CSS)
- `HELP & TUTORIAL UI (QB-TUTORIAL-SPEC-2026-08-31)` (HTML)
- `HELP & TUTORIAL — TUTORIAL_VERSION` (JS: `TUTORIAL_VERSION`, `WHATS_NEW`, `TOUR_STEPS`, help body copy)

## On every user-visible quote-builder change
1. **Bump `TUTORIAL_VERSION`** (+1). This re-arms the gold dot on ❓ Help and the "updated" banner
   for every user, exactly once.
2. **Prepend a `WHATS_NEW` entry** — `{ver:<new>, date:'<today Manila>', items:[…]}`. Plain user
   language ("Discounts can now be a peso amount"), never dev language ("refactored renderTotals").
   One bullet per change; merge trivia.
3. **Update the affected copy** — the "How a quote gets made" list and view descriptions in
   `#helpBody`, and the matching `TOUR_STEPS` entries. New major section/flow ⇒ add a tour step
   (target its container id, `needsWorkspace:true` if it lives inside `#internalWorkspace`);
   removed/renamed ⇒ fix or delete the step.
4. **Re-verify selectors**: every `TOUR_STEPS` target and `closest` must still resolve
   (`grep` the ids; renamed ids are the #1 way the tour rots).
5. **Test**: serve locally, open the builder, run the full demo (it must skip hidden steps
   cleanly, restore the starting view), open Help, confirm the What's New entry renders and the
   gold dot clears after opening.

## Never
- Rename/clear localStorage keys `qbTutSeenVer` / `qbTutDismissedVer`.
- Interpolate quote/user data into tutorial markup.
- Let the tour mutate quote state (it is read-only by contract).
- Bump the version for invisible refactors — that spams every user with a false "updated" banner.
```

## 9. CLAUDE.md line (project CLAUDE.md, under **Conventions**, append as last bullet)

> - **Quote-builder changes must update its built-in tutorial** — bump `TUTORIAL_VERSION`, add a `WHATS_NEW` entry, and sync the Help/tour copy in [quote-builder-v2.html](quote-builder-v2.html). Contract: [.claude/skills/quote-builder-tutorial/SKILL.md](.claude/skills/quote-builder-tutorial/SKILL.md).

---

## 10. Verification (implementer runs before reporting done)

1. `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js` — all green.
2. Serve (`npx serve -p 3737 .`) → open `/quote-builder-v2.html` in the Browser pane:
   - zero console errors at boot;
   - banner shows (fresh localStorage), `▶ Start the demo` runs the tour end-to-end: switches to
     Internal for workspace steps, restores Client view at the end, Esc exits cleanly;
   - ❓ Help opens, What's New renders both entries, gold dot gone after open, banner gone;
   - reload → banner stays hidden; in DevTools set `qbTutSeenVer` to 0 → dot + "updated" banner return;
   - mobile width (375px): burger sheet shows "❓ Help & demo"; tour card is a bottom sheet; topbar
     steps that are hidden get skipped.
3. Print preview: none of the new UI appears (`no-print` everywhere).
4. Report honestly what was and wasn't exercised (login-gated behavior can't be: none of this is).
