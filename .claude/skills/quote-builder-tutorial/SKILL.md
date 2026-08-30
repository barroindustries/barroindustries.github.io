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

## Standing owner rulings
- **2026-08-31 (Neil):** the first Inventory-department change that touches the quote builder
  (e.g. items/materials/stock wired into quoting) is pre-ruled tutorial-worthy — bump
  `TUTORIAL_VERSION` to **2** (or the next integer if another QB change landed first) and give it
  its own `WHATS_NEW` entry. Delete this ruling once done.

## Never
- Rename/clear localStorage keys `qbTutSeenVer` / `qbTutDismissedVer`.
- Interpolate quote/user data into tutorial markup.
- Let the tour mutate quote state (it is read-only by contract).
- Bump the version for invisible refactors — that spams every user with a false "updated" banner.
