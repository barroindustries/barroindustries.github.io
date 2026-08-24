# V14 — "ONE WINDOW" FULL SYSTEM OVERHAUL

_Authored 2026-08-03 from a 6-agent full-code audit (UI shell/modals, finance, documents, quote builder, all screens, mobile). Baseline: prod v12.0.144. This is the successor program to V13 (see V13-STATUS.md for what already shipped)._

**Neil's mandate:** modern minimalist UI · zero wasted space · perfect icons/text · great on phone · **no popups / no window-behind-window** (Apple-app navigation: pushed pages + sheets) · finance made best · every document clean A4 · quote builder with editing + autosave · changes in every department, every design, every function.

**Ground rules (unchanged):** deploys/pushes gated on Neil. Firestore rules deploy separately from code push. Salary math untouched without explicit approval. `bizDate()` for all day logic. `escHtml()` on all user content. One agent per shared file; `diff --cached` before commit (version-hook re-stage footgun).

---

## AUDIT VERDICT (what the code review found)

The foundation is stronger than the surface: a real History-backed `Overlay` stack, a designed `--z-*` scale, three complete themes, a full token system, `openPage` already used 82× vs `openModal` 48×, and a mature mobile shell (bottom nav, edge swipe-back, bottom sheets, safe areas, PTR). The overhaul is therefore mostly **consolidation + completion**, not reinvention. The concrete rot:

1. **Four rogue full-screen panels hardcode `z-index:4000`** (task detail `departments.js:898`, chat thread `chat.js:342`, worker profile `app.js:5519`) + push-prompt at `z:9100` (`notifications.js:692`, not even Overlay-registered). These sit ABOVE modals/pages, so anything opened from inside them renders **behind** — the exact window-behind-window Neil sees in Messages. The code fights it with manual `closeTaskPanel()`-before-open choreography at 6+ sites.
2. **~2,800 inline `style=` attributes** (incl. 328 hardcoded hex colors) bypass the token system — the root cause of inconsistent look and wasted space.
3. **17 document types across 3 print architectures**; payslips, all BIR worksheets, the quotation, and financial reports are **not pinned to A4** (browser-default paper); inventory count form force-rotated to portrait (overflows); invoice clips right edge; two competing brand navies (#1E3A5F vs #1a237e); divergent legacy address headers; financial reports print with no letterhead.
4. **Quote builder**: drafts are write-only (localStorage saved but never restored — refresh loses everything), no autosave to Firestore, every staff edit forces a new copy instead of updating, reopen relies on a 450 ms race, revision "history" is filename-suffix string parsing. Two pricing defects: retail/commercial/government markup coefficients exist but are never applied; DB depth-scaling fields (`rateD100`/`baseD_mm`) ignored.
5. **Finance**: 18 chip-tabs on one screen; 14-column payroll table; stacked money modals (approve expense → second "paid from?" modal); statutory tables all placeholders (`verified:false`); 13th-month formula wrong for mid-year hires; full-ledger collection scan on every Overview load; Balance Sheet / Cash Flow don't exist.
6. **Navigation debt**: `DEPARTMENTS.subtabs` config is dead/stale for 4 depts; 4 screens still hand-roll the old `.subtab-bar`; Payroll reachable 3+ ways; partners have 3 quote entry points; sidebar and bottom-nav arrays drift independently; 7-item bottom navs (Apple caps at 5); emoji glyphs still mixed into chips.
7. **Mobile**: skeletons exist in CSS but unwired (screens show "Loading…" text); haptics used once app-wide; dense tables side-scroll instead of card-reflow at phone width; manifest theme-color mismatch; no manifest shortcuts/maskable icon.

---

## WORKSTREAM A — THE WINDOW SYSTEM (no popup ever again)

The core UX mandate. Target model = Apple navigation: **drill-down/edit = full-window pushed page** (Back chevron, swipe-back), **transient choice = bottom sheet**, **tiny confirm = dialog**. Nothing else. Nothing ever renders behind anything.

- **A1.** Rebuild the three z-4000 panels (task detail, chat thread, worker profile) as `openPage` pages. Delete their bespoke CSS/headers.
- **A2.** Register the push-prompt with `Overlay`; move it onto the `--z-*` scale.
- **A3.** Convert the ~44 remaining `openModal` call sites to `openPage` (detail/edit/history/reconciliation flows) or `confirmDialog` (true confirms). `openModal` survives only as an alias for small sheets.
- **A4.** Formalize single-surface navigation in `openPage`: pushing a new surface *replaces* the current within one navigation frame (Apple push), never overlays a peer. Fix the replace-but-double-push asymmetry (one history entry per surface, always).
- **A5.** Delete every manual `closeTaskPanel()`-before-open guard once A1/A4 land.
- **A6.** One shared slim panel header (reuse `_setPanelTitle`, `--topbar-h` height): title + Back + at most 2 actions. Kills the per-panel 14px-padded bespoke headers.
- **A7.** Full-surface interactive swipe-back on `.page-panel` (extend `gestures.js` beyond the 24px edge strip).
- **A8.** Stacking lint: dev-mode assertion that any `position:fixed` element with a z-index not drawn from `--z-*` console-errors. Prevents regression forever.

## WORKSTREAM B — MINIMALIST DESIGN SYSTEM (zero wasted space)

- **B1.** Extend `--space-*` tokens to desktop (currently mobile-only) and add a density layer (`compact`/`comfortable` driving row heights + padding) — biggest wins in finance/CRUD tables.
- **B2.** The Great Inline-Style Sweep: ~2,800 `style=` sites → tokens + a tiny utility class set (`.card .stack .hstack .form-row`…). Start with the 328 hardcoded hex colors. (Mechanical; runs as parallel Sonnet/Haiku batches, one agent per file.)
- **B3.** Collapse redundant headers: detail pages currently stack topbar + tab strip + panel header + section header → cut to page header + content; context moves to a subtitle line.
- **B4.** Icon unification: every remaining raw-emoji chip/subtab/badge → Lucide via the existing icon map; a11y labels on all icon-only buttons. Dev icon-check already exists — make it fail loudly.
- **B5.** Migrate the 4 hand-rolled `.subtab-bar` screens (Tasks, Brilliant Steel, Design project detail, legacy Cash) to `chipTabs`.
- **B6.** Wire skeletons: `withLoadingAndError` emits `.skl-row`/`.skl-card` instead of "Loading…" text, adopted on every async list. `renderEmptyState` mandatory — no more silent stuck "Loading…" screens (add an error state to every optional-chained `window.render*?.()` route).
- **B7.** CSS hygiene: consolidate the two overlapping modal media queries, the 4 `.drawer` redefinitions, and prune the `!important` fights.

## WORKSTREAM C — NAVIGATION & INFORMATION ARCHITECTURE

- **C1.** One nav registry: sidebar, bottom nav, and dept subtabs all derive from a single source in config.js (today they drift — Chat/CA went missing from desktop this way). Fix navOrder collisions.
- **C2.** `DEPARTMENTS.subtabs` becomes real (render functions read it, like Marketing already does) or is deleted — no more lying config.
- **C3.** Bottom nav capped at 5 (President & Brilliant 7→5; overflow into a "More" sheet).
- **C4.** One destination per feature: Payroll lives in ONE place (HR), quote-building has ONE entry per role; the others become links, not duplicate screens. Dead aliases ('BK Quotes', 'Quick Estimate', `bk-quotations`) removed.
- **C5.** Shared `accessDenied()` helper; router default-case covers every silent no-op route.
- **C6.** `sopPanel` ("How this works") rolled out to the depts missing it (Design, IT, Purchasing, Sales).

## WORKSTREAM D — FINANCE, MADE BEST

Unblocked builds:
- **D1.** IA: 18 chips → ~7 (Overview · Money In/Out [Ledger+CRJ+CDJ merged view] · Reports · Payroll/HR · Purchases+Inventory · Taxes/BIR · Records). President maintenance buttons move off Reports into a "Finance Tools" page.
- **D2.** `finance_rollup/{yyyymm}` aggregate maintained inside `Ledger.post` + rebuild tool → Overview/all-time totals stop scanning the whole ledger.
- **D3.** Interactive Reports: drill category → underlying rows, sortable IS, period compare.
- **D4.** Payroll reconciliation report built behind the existing button (ledger PAY- vs pay_runs vs salary_history; double-pay fingerprint).
- **D5.** 13th-month fixed to months-actually-worked (+ estimate banner on Alphalist).
- **D6.** Single-modal expense approval (fold "paid from which account?" into the approve sheet).
- **D7.** Payroll table card-reflow on phone (14 columns → priority columns + expandable card).
- **D8.** Legacy ledger-id backfill run (President console, one-time) → retires the per-post legacy query.
- **D9.** Balance Sheet + Cash Flow + bank reconciliation (L; BS accounts wired into COA).
- **D10.** Hard-block payroll Disburse while statutory tables are `verified:false` (today it's just a badge).

Gated on Neil/accountant (schedule the accountant call FIRST — longest lead):
- **D11.** Statutory tables verified (old D2) → flip `verified:true`.
- **D12.** VAT registration confirmed (old D7): fix the `amt−amt/1.12` legacy fallback overstating output VAT; build 2551Q if Non-VAT.
- **D13.** Payslip legal entity/TIN (old D6) · **D14.** OR/SI ATP series (old D8).

## WORKSTREAM E — DOCUMENTS: ONE A4 ENGINE

Every printable routes through ONE engine: `buildLetterhead(orientation)` owns the single `@page` authority; `print-docs.js` gets a default A4 `@page`; per-caller duplicates deleted.

- **E1.** `orientation` param in `buildLetterhead`; emit `@page{size:A4 ${orientation}}` — fixes the inventory count form (landscape) immediately.
- **E2.** `size:A4` pinned on ALL same-document prints: payslip, all BIR books/worksheets, financial report, quotation.
- **E3.** Invoice `.page` width reset at print (kills right-edge clipping).
- **E4.** One brand accent token (`--brand-navy`, canonical #1E3A5F) — retire #1a237e.
- **E5.** Delete the 3 divergent legacy hardcoded headers (invoice/PO/inventory) — letterhead is the only source of company identity.
- **E6.** Letterhead injected into the two branding-less prints (Financial Report, Payroll Reconciliation).
- **E7.** ID cards + quote-builder folded onto the shared engine (ID cards via `size:'card'`).
- **E8.** A4 pagination polish everywhere: repeat `thead`, `break-inside:avoid` rows, keep-together totals+signature blocks, orphan/widow control.

## WORKSTREAM F — QUOTE BUILDER v3 (edit + autosave)

- **F1.** Draft recovery: `loadFromStorage` actually restores ("Resume draft for <client>?") — the data is already being written every keystroke.
- **F2.** Debounced Firestore draft doc (`status:'draft'`) + "Saved ✓ 2s ago" indicator → drafts survive device loss. (Needs rules for the drafts path.)
- **F3.** True in-place edit: "Reopen & Edit" saves back to the SAME doc (reuse the president `.update()` path); "New Revision" stays the versioned-copy path. User chooses.
- **F4.** Fix the reopen race: builder→parent READY handshake replaces the 450 ms timeout.
- **F5.** Round-trip the full state (laborState, waive flags, custom lead) in `editableState`.
- **F6.** Linked revisions: `rootQuoteId`/`parentQuoteId` on every doc; revision timeline + price-delta diff view in the Quotations list (kills the clientName+regex sibling discovery).
- **F7.** Faster picking: recently-used + favorites rail; one-tap add for fixed-price items; inline qty stepper; merge Quick-Quote and full-builder pickers into one.
- **F8.** Mobile: items table card-reflow (kill the 700px min-width side-scroll), visible per-row save affirmation.
- **F9.** A4: `@page size:A4` + single letterhead path (delete the legacy `#printHeader` branch) + keep-together totals (with E7/E8).
- **F10.** Pricing correctness — **needs Neil ruling**: (a) markup.retail/commercial/government coefficients — apply or delete? (b) depth-based `rateD100`/`baseD_mm` scaling in the product DB is ignored by `computePrice` — activate or strip from data?

## WORKSTREAM G — MOBILE / APPLE POLISH

- **G1.** Skeletons everywhere (= B6). **G2.** `window.haptic()` helper fired on nav tap, sheet-dismiss, PTR trigger, destructive confirms.
- **G3.** Table→card reflow pattern (`data-label`/`td::before`) for ALL dense tables ≤480px (payroll, ledger, journals, CRUD tables).
- **G4.** PTR retuned to native feel (soft ~90px / hard ~180px).
- **G5.** Dynamic `theme-color` per theme; manifest aligned; add `shortcuts` (Tasks/Chat/New Quote), true maskable icon, screenshots; landscape allowed on tablet.
- **G6.** Sweep inline `font-size` off inputs (trust the 16px coarse-pointer rule — kills iOS zoom-on-focus fragility).

## WORKSTREAM H — EVERY-SCREEN PASS (every department touched)

With A–G primitives in place, each screen gets the same 8-point pass:
chipTabs · openPage-only surfaces · skeleton/empty/error states · card-reflow tables · Lucide-only icons · header collapse · token-only styling · sopPanel where missing.

Order (grouped so each batch is one Sonnet agent, one file region):
1. Tasks + Submissions + Approvals  2. Finance (with WS-D)  3. HR/Payroll/Attendance/Leave/CA  4. Sales + AEC + Quotations lists  5. Design + project detail  6. Production + Purchasing + Inventory + Projects  7. Gov Biddings + IT  8. Brilliant Steel + Partners portal (all 3 variants — audit each variant's nav for missing screens)  9. Posts + Team + Chat + Profile + Files  10. Dashboards (all 6 role variants) + Company + Analytics + Memos/SOPs/Help.

## WORKSTREAM I — ARCHITECTURE MODERNIZATION

The structural change V13 planned (phases 32–34, 41–50) but deferred. V14 executes it. The app stays a no-bundler static PWA (that constraint has served well), but the internals stop being three monoliths.

- **I1.** **ES-module split.** `departments.js` (15.6k lines), `app.js` (9.3k), `modules.js` (3.1k) → ~40 focused files under `js/screens/` (one file per department/screen area), `js/services/`, `js/ui/`, `js/print/`. Native browser ES modules + import map — no build step introduced. `window.*` globals survive only as a thin compatibility shim during migration, then die. Kills the load-order-is-load-bearing fragility.
- **I2.** **Service layer completed.** UI code never calls Firestore directly. `Ledger`, `Approvals`, `CashAdvance`, `Notifs` already exist — add `TasksSvc`, `QuotesSvc`, `HRSvc`, `DocsSvc` so every collection has exactly one read/write owner (mirrors the "single writer" pattern that already fixed CA and payroll).
- **I3.** **One render kit.** `page/sheet/dialog` primitives (WS-A), `renderCrudTable` generalized beyond finance, forms kit, `STATUS_META` badges — every screen composes these instead of hand-rolling HTML.
- **I4.** **CSS split with `@layer`**: `tokens.css` / `base.css` / `components.css` / `screens.css` / `print.css` — cascade order explicit, theme tokens in one file.
- **I5.** **Money-math unit tests in CI.** `vatSplit`, `computePayLine`, `computePrice`, `computeTotals`, `computeStatutory` extracted as pure functions and tested via `node --test` in the existing CI workflow. First real tests in the repo; the finance-correctness ratchet.
- **I6.** **Dev invariants standing guard**: z-index lint (A8), icon check, nav-wiring CI, backup-coverage CI (last two already exist) — regressions fail loudly in dev/CI, not in prod.
- **I7.** **Performance architecture**: `finance_rollup` aggregates (D2), paginated ledger/lists, lazy per-subtab loading everywhere (started in v13 Ph 86), skeletons for perceived speed.

Migration is incremental and shippable per-batch: extract one screen file at a time, `node --check` + boot-verify each, never a big-bang rewrite. Rollback = git revert of one extraction commit.

## WORKSTREAM J — MESSAGING PLATFORM v2 (Messenger/Viber parity)

Grounded in a full read of js/chat.js (1,226 lines). Already shipped and kept: DMs/groups/dept channels, typing indicators, seen receipts (avatars) + sent check, 6-emoji reactions + Viber quick-heart (tap ❤️ / long-press picker), consecutive-message grouping, Manila day separators, edit/delete with notif cleanup, presence dots + last-seen header, wallpapers, phone full-screen mode, keyboard viewport handling, load-earlier pagination with cap, keyed-patch rendering, send double-fire guard. The gap to Messenger/Viber:

**J1 — Surfaces (with WS-A).** Thread panel is a z-4000 offender → becomes an `openPage` push (phone) and, on ≥1024px, wire the already-scaffolded **two-pane layout** (inbox left, live thread right — Messenger web style; the CSS container exists at `renderChatPage`, right column never wired). Kills chat's window-behind-window for good. The image "viewer" is literally `window.open` (`chat.js:893`) — replace with an in-app lightbox (swipe between images, pinch-zoom, save) so no popup ever.

**J2 — Sending feel.** Optimistic send: bubble appears instantly with a pending clock, flips to ✓ on server ack (today the composer waits on the round-trip). Delivery states: pending → sent ✓ → seen (avatars, kept). Per-conversation **composer drafts** persisted (localStorage) — closing a thread no longer loses typed text.

**J3 — Message actions.** **Reply-to/quote** (swipe-right-to-reply on mobile like Viber, hover action on desktop; quoted snippet renders above the bubble, tap scrolls to original). **Forward** to another conversation. **Copy text.** Delete becomes Messenger-style **unsend tombstone** ("message removed") instead of hard doc delete — thread history stays coherent. Message data adds `replyTo{mid,author,snippet}`, `forwardedFrom`, `deleted` flag.

**J4 — Media.** Client-side image compression before upload (reuse the quote-builder `compressPhoto` pipeline — today chat uploads originals). Multi-photo select → Messenger-style grid bubble. `capture` camera hint on mobile. Paste-image and drag-drop on desktop. Video files playable inline. Per-conversation **Shared Media / Files / Links** tab (from existing message data — no new writes).

**J5 — Voice messages.** MediaRecorder → Storage → playback bubble with duration + progress bar (Viber's signature). Mic button appears when composer is empty, hold-to-record with slide-to-cancel.

**J6 — Composer.** Emoji picker (reactions have one; the composer doesn't). **@mentions** in groups/channels: typeahead, highlighted in bubble, mention bypasses the 60s notif throttle (an @ always notifies). Link messages get a simple rich card (domain + title where fetchable; full unfurl via Cloud Function is optional later).

**J7 — Conversation management.** **Pin** conversations (pinned rail on top), **mute** (per-conv, respected by both in-app notifs and the push Cloud Function), **archive**; swipe actions on inbox rows (mobile) + hover actions (desktop). Group admin: add members, rename, group photo (today only Leave exists). Real **unread counts** (numbers, not just a dot) per conversation + total on the Chat tab + PWA app-icon badge (`navigator.setAppBadge`). "New messages" divider line on open + scroll-to-bottom FAB with new-count.

**J8 — Search.** In-conversation message search (client-side over loaded window + paged fetch), plus the existing inbox title search kept.

**J9 — Cost/perf architecture.** Today every inbox refresh does one reader-doc read per conversation (N reads per snapshot, debounced). Denormalize: `conversations/{id}.reads{uid:ts}` map maintained on send/read → inbox unread state computed from the doc it already has. Typing indicator tightened (4s beacon gap → ~1.5s with same TTL). Presence stays on the shared heartbeat cache.

**J10 — Rules/infra.** firestore.rules: new fields (`replyTo`, `forwardedFrom`, `deleted`, `mentions`, `reads`, `pinnedBy`, `mutedBy`, `photoUrl`, audio/media paths under chat-files), tombstone update path (author-only), mute map honored in `sendPushOnNotification`. storage.rules: audio + multi-image paths. Backup EXPORTS already cover conversations subcollections (v13) — verify audio/media inclusion.

Out of scope (deliberate): stickers/GIF packs, E2E encryption, message translation — revisit post-v14 if wanted.

## DECISIONS — RULED 2026-08-03 (N5 pending)

- **N1 RULED:** Neil books the accountant session. Until it happens: placeholder rates stay labeled, payroll disburse stays hard-blocked on unverified rates (D10 ships). D11–D14 build after the session.
- **N2 RULED:** Delete both dormant pricing mechanisms — markup coefficients removed from the coefficient editor/DB, depth-scaling fields stripped from products-database.json. Quotes keep today's prices exactly. (F10 → deletion, not activation.)
- **N3 RULED:** Auto layout — first 4 tabs in today's order + a "More" sheet as tab 5, for President and Brilliant Steel portals. (C3 unblocked.)
- **N4 RULED:** 7-group finance layout approved as proposed. (D1 unblocked.)
- **N5 STILL PENDING:** president-console one-time runs (Phase-9 buttons + ledger-id migrate) — requires Neil logged in as president.

## DECISIONS NEEDED FROM NEIL (blocking only what's listed)

| # | Decision | Blocks |
|---|---|---|
| N1 | Accountant session: statutory tables, VAT registration, entity/TIN, ATP | D11–D14 (schedule first — longest lead) |
| N2 | Quote pricing: markup coefficients apply-or-delete; depth-scaling activate-or-strip | F10 |
| N3 | Bottom-nav 5-item picks for President & Brilliant (what goes to "More") | C3 |
| N4 | Finance tab grouping sign-off (proposed 7 groups in D1) | D1 |
| N5 | One-time president-console runs (Phase-9 buttons + ledger-id migrate) | D8 + V13 leftovers |

## EXECUTION PLAN (waves; each = spec → Sonnet build → review → Neil approves push)

- **Wave 1 — Foundation:** A1–A8, B1, B7, C1–C2, I3 primitives, I4 CSS split. (Everything else builds on the window system + nav registry.)
- **Wave 2 — Architecture split:** I1–I2 screen/service extraction (batched, shippable per-batch), I5 money-math tests, I6 invariants.
- **Wave 3 — Documents + Quote Builder:** E1–E8, F1–F10 (F10 parts pending N2).
- **Wave 4 — Finance:** D1–D10, I7 rollups/pagination (D11–D14 when N1 lands).
- **Wave 5 — Messaging v2:** J1–J10 (J1 rides on Wave 1's window system; rules + push-function changes deploy with it).
- **Wave 6 — Design-system sweep + Mobile:** B2–B6, G1–G6.
- **Wave 7 — Every-screen passes:** H batches 1–10 (each batch lands in its extracted module file).
- **Wave 8 — Verification:** phone/tablet/desktop × role matrix, print QA of all 17 documents on real A4, zero-console-error boot, then version cut v14.0.0.

Model routing per the standing policy: Fable specs (this file + per-wave specs), Sonnet max-effort implements, Haiku for mechanical sweeps (B2 batches), Opus coordinates/reviews. Rules/index changes deploy via `firebase deploy --only firestore` separately from each push.
