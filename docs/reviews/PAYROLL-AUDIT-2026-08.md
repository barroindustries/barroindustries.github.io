<!-- Design pass only, NO CODE WRITTEN. Four read-only walkthroughs of the
     live payroll (monthly flow, weekly flow, HR/Finance boundary, flexibility),
     then one proposal. 80 findings, every technical claim carrying a
     file:line. Produced 2026-08-10 BEFORE the owner rulings in
     PAYROLL-REDESIGN-BRIEF.md were available — read that brief first; where the
     two differ, the brief wins. -->

# Payroll: what is wrong, and what I would build

**Before anything else — the office payroll has never been payable.** Compute, Verify, then Disburse, and you get a box titled "Disbursement blocked" whose two buttons both say "Understood" (`js/departments.js:2144-2151`). The cause is a single line in a source file: `verified: false` on the 2026 government rate tables (`js/statutory-tables.js:20-21`). Nothing in the app can flip it — every other reference to it only reads it. The weekly run escapes because its identical gate only bites when a week actually deducts government contributions (`js/payroll-weekly.js:900-907`). So Operations pays and Office cannot, and has not all year. If "payroll is wrong" partly means "the office half doesn't work", that is why.

---

## 1. What is actually wrong

**One. Payroll has no home, and HR has no side of the handoff.**
Payroll is the third level inside Finance: Finance page → "Payroll & HR" chip → "Payroll" chip → "Office Team" tab (`js/screens/finance.js:244, 399`; `js/screens/hr.js:845`). And HR's own Payroll card is literally a redirect into Finance — `go:()=>window.renderFinance(currentUser, currentRole, 'Payroll')` (`js/screens/hr.js:404`) — which repaints the header as "Finance & HR" and adds two rows of Finance chips above your payroll. There is no HR payroll screen. There is Finance payroll with an HR-shaped door on it.

It goes deeper. HR is a *department*, but every HR screen is gated on *role*: `if (!['president','manager','secretary','finance'].includes(role))` → padlock (`js/screens/hr.js:382`). Every other department in the app honours department membership (`js/departments.js:39-53`); HR is the one that doesn't. So a real person you put in HR cannot open HR — while the Accountant is the only role in the app with a direct HR link in the sidebar (`js/config.js:712`). You cannot fix coordination between two parties when the system only recognises one of them.

**Two. The screen is organised around the software's internal states, not around the job.**
Draft → Computed → Verified → Disbursed, with buttons called Compute, Verify, Disburse, Adjust, Override, Reset to computed, Reconciliation, Delta (`js/screens/hr.js:2576, 2600-2604, 2484-2496`). You cannot describe your own payday using the words on your own screen. Worse, the steps don't explain what they cost: "Mark Verified" says only "This confirms the computed amounts have been checked" (`hr.js:2616`), and then silently refuses re-compute (`js/departments.js:2020`), removes every ✎ Adjust button (`hr.js:1449`) and blocks even the note window (`hr.js:2382`) — and only the President can undo it. On the weekly side it is worse still: the screen tells you the President reopens it "from the monthly tooling", and that is not true — `window.reopenPayRun` is hardcoded to `db.collection('pay_runs')` (`js/departments.js:2736`) and has never been able to touch a pay week. There is no way out of a verified week at all.

**Three. Payroll is a data-entry form pretending to be an engine, because everything it needs lives somewhere it can't reach.**
- You cannot fix a production worker's attendance for any day except today. The Clock form hardcodes `bizDate()` (`js/screens/hr.js:3644, 3661, 3690`); the Attendance calendar with the month navigator reads a different collection entirely and lists only people with logins (`js/screens/people.js:1507, 1414-1418`). The only repair is a *pay* override, which fixes the money and leaves the attendance record still saying he was absent.
- Approved leave never reaches either run. `leave_requests` appears in no pay file. Neither do Philippine holidays — `getPHHolidays` (`people.js:1261`) is read by calendars and never by a pay engine.
- Rent allowance, other deductions and the cash-advance instalment are ₱0.00 for all 30 workers unless someone opens 30 pencil icons and types them, every week, for ever — none of the three is stored on the worker (`js/payroll-weekly.js:32-37, 228`).
- The monthly run reads today's salary, whatever month you compute (`js/money-core.js:85`; raises overwrite the salary in place, `js/departments.js:1802`). Run June in August and June is paid at August's rates, silently.
- Nobody is prorated. A person hired on the 25th is paid a full month; a leaver is paid nothing (`money-core.js:85`; `departments.js:1971`).

**Four. The two teams disagree about everything, so there is no "how payroll works here".**
Finance may release a week and the screen says so (`payroll-weekly-ui.js:290, 427`); on the monthly tab the Disburse button simply isn't rendered for Finance with no explanation at all (`hr.js:2601` — there is no else-branch). The weekly run demands one receipt per worker before releasing (`payroll-weekly.js:877-880`); the monthly run demands no proof of anything (`hr.js:2628-2646`). The weekly roster shows every figure permanently labelled on a phone (`payroll-weekly-ui.js:335-340`); the monthly one hides fourteen columns behind tap-to-expand (`hr.js:1103-1108, 1794-1799`). The weekly run re-checks exclusions right before paying, twice (`payroll-weekly.js:856-872, 936-944`); the monthly run pays the frozen lines and never re-reads `excluded` at all — I checked every line of `disbursePayRun` and the word does not appear.

---

## 2. What it should feel like

**The week.** Monday morning the phone says: *"Last week is ready to check — 28 workers, ₱182,400."* You open it. One list, one row per worker, everything visible: days worked, hours, allowances, deductions, take-home. Rows the system is unsure about sit at the top, in words: *"Ramon — no punch Tuesday"*, *"Junior — advance of ₱2,000 outstanding, nothing collected this week."* You fix Tuesday from that row; it corrects the attendance record, not just the pay. Recurring amounts are already filled in from last week — you change what changed. Nothing needs recomputing by hand; the total at the top is always current.

When it looks right you press **Checked**. That is one button and it says what it costs: the figures lock, and you or the President can unlock it. Finance gets a message: *"Last week is checked and waiting to be paid."* Finance opens it, attaches each transfer receipt as they go — saved as they go, so a dropped call costs nothing — and presses **Pay everyone**. Then: *"Paid. Print all 28 payslips."*

**The month.** Same shape, same words, same screen furniture. Open August; it says *"August is not paid. Pay date 5 September. ₱412,000 for 9 people."* People hired or leaving mid-month show a line that says so — *"22 of 26 days"* — and are paid for what they worked. Anyone you take out of this month stays out until you put them back, before or after you press Checked. When you come back tomorrow it says *"6 of 9 checked"* and opens on the month you were working on, not on today's.

Two teams, one screen, one vocabulary. Nowhere in either does the word "compute", "disburse" or "delta" appear.

---

## 3. HR and Finance — the clean split

**HR owns the facts about people and hours.** Who is employed, from when to when. Rates and profiles. Attendance and its corrections — for both teams, any date. Leave. Holidays. Who is off payroll this period and why.

**Finance owns the money.** Checking the figures. Releasing payment. The bank account, the receipts, the ledger, the government filings, cash advances as approved loans.

**The handoff is one object with two owners and two signals.** HR closes the period: *"the hours are right"* — one button, sends Finance a notification. Finance checks and pays. Each side sees the whole run; only their own half is editable. Nothing else changes hands verbally.

Today none of that exists: the only payroll notifications in the entire app fire *after* money has already moved (`js/payroll-weekly.js:1054, 1067`; `js/departments.js:2693, 2713`). Fifty-two handoffs a year and not one signal.

Three things make the split real:
1. HR gets its own screen and its own gate — `isOpsPriv()` or membership of the HR department, replacing the role list at `hr.js:382`, plus an HR entry in the admin drawer (`js/config.js:628-655` has none).
2. HR gets read-only sight of the pay run. The rules currently make `pay_weeks` money-tier only (`firestore.rules:1356`), so the Corporate Secretary — the person the system already trusts to edit attendance and approve leave — cannot see the run their work produced.
3. Attendance corrections move to HR and out of payroll. Today the "trouble timing in" queue sits on a Finance screen where the Accountant can see it but not approve it, and the Secretary who can approve it cannot open the screen (`hr.js:3180-3200`; `js/app.js:3168`).

---

## 4. The flexibility it needs, most-often first

1. **Fix a punch on a past day** — the single most common event, and today impossible outside a pay override (`hr.js:3644`).
2. **Recurring weekly amounts that carry themselves forward** — rent allowance, standing deductions, advance instalments. Only exclusions carry forward today (`payroll-weekly.js:497-500`).
3. **A cash advance for a production worker that behaves like the office one** — request, approval, schedule, automatic collection. Today it is a number typed into a box (`hr.js:3381`) with no approval and no ledger entry, while its repayment *does* post to the books (`payroll-weekly.js:1013`). That asset account only ever goes down.
4. **Pay someone off-cycle** — final pay, a partial period, a correction. Exists for production workers only; the generator is worker-profile-only and its sole caller is the Workers roster (`hr.js:4369, 3161`). Office staff have no off-cycle path at all.
5. **A named one-off line** — a ₱3,000 bonus, a ₱500 penalty. Today the only route is typing an inflated "Final Pay" with a reason, producing a payslip whose lines no longer add up (`hr.js:2475-2481`).
6. **Proration for joiners and leavers** (`money-core.js:85`).
7. **Correct a salary without calling it a raise, and have the effective date mean the day** — today only "Give Raise" exists, and only the month is used (`hr.js:2024-2027`; `departments.js:1757, 1777`).
8. **Approved leave and holidays paid automatically.**
9. **Take one person out of a month after computing** — the button only renders before Compute (`hr.js:1730` vs `1483-1487`), and monthly Disburse would ignore the exclusion anyway.
10. **Undo a payment.** Weekly: no exit from `disbursed` at all. Monthly: only row-by-row, in a way the code itself flags as leaving the books wrong (`departments.js:600-606`).
11. **Cash for some, transfer for others** — one account for the whole batch today (`hr.js:2630`; `payroll-weekly-ui.js:978`).
12. **Reach further back** — three months monthly (`hr.js:1059-1063`), 17 weeks weekly (`payroll-weekly-ui.js:48`).
13. **13th-month pay** — printed as an estimate on payslips (`hr.js:5580`), reported as zero on the BIR alphalist (`js/bir.js:838`), paid by nothing.

---

## 5. What I would build, in order

Each step is shippable on its own and makes the thing better on its own.

1. **Unblock office payroll.** ⚠ MONEY — Make the monthly gate conditional exactly like the weekly one (block only when the run actually deducts government contributions), and move the rate tables and their sign-off into a Firestore document with a President-only screen. Today, unblocking payroll requires a developer.
2. **Reopen for the weekly run.** ⚠ MONEY — A real `reopenPayWeek` and a button, so a checked week is not a one-way door. Also delete the sentence that promises a route that does not exist (`payroll-weekly-ui.js:428, 559, 738`).
3. **Fix attendance on any day.** Add a date to the worker Clock form and put production workers in the Attendance calendar's picker. The database rules already allow it (`firestore.rules:698-700`).
4. **One vocabulary, one shape.** Rename every button and badge to the words you use: Work out the pay → Checked → Pay everyone. Put the consequence inside the Checked confirmation. Give the monthly tab the weekly tab's phone layout. State on the strip why a button is missing.
5. **Stop losing your place.** Keep the selected month/week and re-render only the table. Nine call sites currently rebuild the whole screen back on today (`hr.js:2706, 2645, 2662, 1267, 1286, 1315, 1345, 1363`).
6. **Standing amounts on the worker, carried into every week.** ⚠ MONEY — Removes the thirty-pencil ritual, which is where most weekly errors will come from.
7. **The handoff signals.** HR closes the hours → Finance is notified. Finance checks → whoever pays is notified. Monday morning, if last week is unpaid, everyone hears about it. Plus an unpaid-weeks tile on the dashboard.
8. **HR its own screen and its own gate**, and read-only sight of the run for the ops tier.
9. **One cash-advance system for both teams.** ⚠ MONEY — Request, approve, post the debit, schedule the collection.
10. **Off-cycle payment for anybody.** ⚠ MONEY — One action: a person, a date range, a reason, free-form earnings and deductions, one payslip, one balanced posting. This is the missing primitive that half of section 4 is a workaround for.
11. **Proration and dated rates.** ⚠ MONEY — Hire and separation dates read by the engine; rates stored as dated records so an old month is paid at the rate in force then.
12. **Named earnings and deductions**, replacing the five fixed slots — and while there, put the travel row on the payslip. Travel is computed and paid but never printed, so on any week with travel the worker's payslip does not add up (`payroll-weekly.js:1156-1160`; no `travel` anywhere in `hr.js`'s payslip builder).
13. **Leave and holidays into the run.**
14. **Reverse a run.** ⚠ MONEY — A mirror posting against the same references, payslips marked void rather than deleted. And fix the correction path that currently syncs ledger reference `WPAY-{id}` while the run posted `PAYW-{week}-{worker}` (`hr.js:4194` vs `payroll-weekly.js:963`) — the edit lands, the books do not move.
15. **13th month as a real run.**

---

## 6. What I would not change

- **The per-worker arithmetic.** `js/money-core.js` is frozen behind 257 pinned tests. Everything above changes what reaches it and what is shown; nothing changes how a peso is calculated.
- **The three steps themselves.** Work out → check → pay is correct and it is why nobody can pay themselves. Only the words and the one-way doors change.
- **The frozen line.** A run pays exactly what was checked. That is the whole point of checking.
- **The double-pay guard.** Nobody can be on both the monthly and weekly run in the same period (`money-core.js:585-588`; `departments.js:1966-1994`). Do not weaken it — give it a sanctioned path instead (step 10), recorded on both periods.
- **The weekly run's exclusion re-check at both gates** (`payroll-weekly.js:856-872, 936-944`) — this was caught in review before it shipped. Copy it to monthly; never remove it.
- **One receipt per worker** before a week is released (`payroll-weekly.js:877-880`). Extend it to monthly.
- **A reason required on every attendance override**, and the transaction lock and closed-period check on disburse (`departments.js:2155-2185`).
- **The refusal to decide the overtime convention.** A 10-hour day currently pays twelve hours, and the engine says plainly it will not change that on its own (`payroll-weekly.js:90-103`). It is right. It just needs somewhere for your answer to live.

---

## 7. Questions only you can answer

1. **Which day is payday for the crew, and when does the office get paid?** The weekly run books everything to **Sunday** (`payroll-weekly.js:851`); the off-cycle tool it replaced defaults to **Saturday** and a six-day week (`hr.js:4369-4376`). If the crew is paid Saturday, then every week is being paid before Sunday has happened — and Sunday, which you ruled is worked and paid, is quietly unpaid every week, in a run that can never be reopened. For the office, the screen only ever nags "finalize by the 5th" (`hr.js:2586-2590`) and never records a pay date. Proration, cut-offs and every reminder depend on both answers.

2. **Who is HR — a real person in the HR department, or you and a manager between other jobs?** If nobody sits in HR, the honest build is one payroll screen with two locks and no handoff ceremony. If somebody does, HR needs its own screen, its own permission, and the two signals. The work is genuinely different.

3. **Has the 2026 government rate table been signed off by your accountant, and who is allowed to say so in the app?** Right now it is `verified: false` in a source file (`statutory-tables.js:21`) and only a developer can change it. I would put it behind a President-only screen — but I need to know whether it should be you alone, or the Accountant as well.

4. **Is a public holiday paid to the weekly crew when nobody works it, and at what rate — and who pays the 13th month, when?** The pay engine has never read the holiday table, and 13th month is shown as an estimate in two places, reported as zero in a third, and paid by nothing. Both are legal obligations with no owner in the system.