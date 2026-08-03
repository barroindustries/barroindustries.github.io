# V14 WAVE 8 — VERIFICATION LEDGER & OWNER CHECKLIST

_2026-08-03. The v14 "One Window" program's closing document. Automated verification is DONE (below). The remaining items need Neil's login, devices, printer, or accountant — check them off here._

## ✅ Verified automatically (every push, re-run at cut time)
- Syntax: all 33 JS files pass `node --check`
- Money tests: 20/20 (`node --test tests/`) — VAT split, statutory shape, payroll lines pinned
- CI invariants: zero off-scale z-indexes in js/; index.html↔PRECACHE complete
- Boot: zero console errors (login screen, all scripts 200)
- Live-site integrity: all assets 200, version coherent
- Nav registry: sidebar/bottom outputs equivalence-proven across 126 role/dept combos (Wave 1)
- Print @page authority: every doc traced to exactly one A4 rule (Wave 3 inventory table)
- Conversation rule shapes: every chat write audited against deployed disjuncts (Wave 5)
- Touch-path decision table: scroll/diagonal/reply/edge/long-press each single-winner (gesture fix)

## 🧑‍💼 Neil — logged-in QA matrix (per role, ~10 min each: president · employee · finance · partner-BS · generic partner)
- [ ] Dashboard loads, KPIs real (not ₱0-on-error — failures now warn in console)
- [ ] One full task flow: open → edit → Back (state kept) → Save (lands on refreshed board)
- [ ] Approvals: approve one item of each pending type; History chip
- [ ] Finance (finance/president): 7 groups all reachable, Reports drill-down + Compare, BS/CF/Bank Rec render, payslip page Back returns correctly
- [ ] Chat: send (instant bubble), double-tap heart, long-press menu (Copy/Forward/Edit/Delete), reply-swipe deliberate-only, photo grid + lightbox, pin/mute/archive swipes, group About page
- [ ] Quote builder (phone): fullscreen + hamburger sheet, draft resume banner, Update-original vs New-revision, revision chain in the quote list
- [ ] Every bottom-nav variant: 4+More correct, More sheet items navigate FIRST TAP (the fixed race)
- [ ] Print preview: PO, invoice, payslip, count form (landscape!), financial report (letterheaded)

## 📱 Real-device feel (iPhone + one Android if available)
- [ ] Notch band: nothing scrolls through; top bar controls clear of the clock
- [ ] Density: pages feel tight but not cramped (v12.0.185)
- [ ] Swiping: scroll never hijacked; edge-back; drawer-swipe on base pages; chat reply-swipe deliberate
- [ ] Haptics (Android only — iOS has no vibrate API), PTR feel, More sheet, QB fullscreen exit pill
- [ ] PWA: home-screen shortcuts work; app-icon unread badge; landscape on tablet

## 🖨 Real-paper A4 QA (one print each, check margins/letterhead/no-clip)
- [ ] Billing invoice · PO · Receiving report · Delivery receipt · Inventory count form (LANDSCAPE) · AEC sheet (LANDSCAPE) · Payslip · BIR book (any) · VAT worksheet · Financial statement · Financial report · Payroll reconciliation · Quotation (client + agent copy) · ID card (card stock)

## 👑 President console one-time runs (N5 — in this order)
1. Finance → Reports header tools moved to: Overview → 🔧 Finance Tools
2. [ ] 🔄 Sync to ledger · 🔖 Tag · 🏷 Tag account types → 🧾 Restate material costs · 🔧 Security backfill
3. [ ] console: `remapDesignProjectClients()`
4. [ ] 🧭 Migrate ledger ids (dry-run → Apply if collisions=0)
5. [ ] 🔁 Rebuild rollups (seeds finance_rollup — Overview banner disappears)

## 🧾 Accountant session (N1 — schedule; longest lead)
- [ ] Verify statutory tables → flip `verified:true` (unblocks payroll disburse + removes DRAFT watermarks)
- [ ] VAT registration status (D7) · legal entity/TIN for payslips (D6) · OR/SI ATP series (D8)

## 📌 Post-v14 follow-up ledger (deliberate deferrals)
Voice messages (chat) · maskable app icon asset (needs image editing) · chat presence-token dedupe · stage-array icon shared helper · ESM + @layer conversion (architecture Stage B) · remaining inline-style spacing sweep (continues opportunistically) · dashboards.js table reflow + empty-state adoption · bsOnly partner Earnings-dashboard gap (product call) · partnerBS Client-Data bottom-nav slot (product call) · `Ledger.remove` unused service API (kept, documented) · `isBrilliantPartner()` unused predicate (kept, flagged)
