<!-- Design pass only — NO CODE WRITTEN. Produced 2026-08-10 from four parallel
     read-only recons (Office Team UX, Operations Team gaps, exclusion semantics,
     weekly-run inputs), then synthesised. 74 findings, every technical claim
     carrying a file:line. Awaiting the owner's answers to §5 before any build. -->

# BUILD SPEC — Operations Team payroll parity + period-scoped removal

Prepared for the President. Read-only investigation complete; no code written yet. Say yes or no before anything is built.

---

## 1. WHAT CHANGES FOR YOU

**Today**, the Operations Team tab is a worker directory, not a payroll. It lists worker profiles with a daily rate and a cash-advance balance, and you make pay one person at a time: open a worker, fill in their week, save, print (`js/screens/hr.js:2882`, `:2929-2952`, `:4082`). There is no week picker, no roster of amounts, no total, no single "pay everyone" button. The tab cannot even show you a past period — its counters are hard-wired to the current Manila month (`js/screens/hr.js:2900-2909`).

**After this work**, the Operations Team tab looks and behaves like the Office Team tab, with weeks instead of months:

1. **Pick a pay week** from a dropdown at the top left, exactly where the month picker sits on Office Team (`js/screens/hr.js:958-1002`).
2. **An "unpaid weeks" card** underneath lists every week not yet paid out, oldest first, with its status and its peso total — the weekly twin of the unpaid-months card (`js/screens/hr.js:1300-1350`). With 52 weeks a year this is what stops a missed week from disappearing.
3. **Press Compute.** The system reads every active worker's punches for that Monday–Sunday week and builds one line per worker: hours, overtime, travel, allowances, deductions, cash advance, net.
4. **A roster table** appears — one row per worker, one column per money component, **with the grand total as the first row of the table**, visible without scrolling. That totals row survives Compute; on Office Team it was added precisely because the number used to vanish at the moment you most want to check it (`js/screens/hr.js:1416-1475`).
5. **Anyone not being paid this week is shown to you**, dimmed and struck through, with the reason in words — absent all week, no rate on file, removed from the system, or removed by you for this week. Nobody is silently dropped.
6. **Days that need a human look** — a punch flagged by the server, a shift over 16 hours, a missing punch — are listed for review, not quietly paid or quietly skipped. That behaviour already exists inside the one-worker form (`js/screens/hr.js:4620-4653`); the run carries it for the whole crew.
7. **You review, then Disburse once.** One press pays the whole week: it books the expense, deducts cash advances, generates every payslip, and posts the cash movement — the same way the monthly run does today (`js/departments.js:2124-2165`, `:2480-2617`).
8. **The bank transfer receipt is uploaded once, at Disburse**, and is printed *on* each payslip page rather than sitting as a link beside it, which is all it does today (`js/screens/hr.js:5303-5310`).

The one-worker form stays. It becomes two things: the drill-in when you need to correct a single line inside a week, and the way to issue an off-cycle payslip (final pay, an advance, a partial week). Losing it would lose real capability — "amount already paid", a custom period, a per-worker company name, all of which exist only there (`js/screens/hr.js:4094-4097`, `:4169-4178`). A guard will stop the same worker being paid twice for the same week by both routes.

Worker profiles, ID cards and the kiosk clock don't go away; they move under a "Workers" sub-view of the same tab.

---

## 2. THE EXCLUSION FIX

### What is broken today

When you take someone off payroll, the system writes one flag on their pay record with **no month attached** (`js/screens/hr.js:1701-1719`). The pay run reads that flag with no month attached either (`js/departments.js:1950-1951`). So:

> **Excluded in June means excluded in July, August, and every month after — until a human clicks "put back on payroll".**

The screen itself says so out loud: *"Excluded from this and every run until put back on payroll."* (`js/screens/hr.js:1663`, verified.)

And it is silent. In July that person gets: no payroll line, no payslip, no salary history record, no ledger entry, no notification, and **their cash advance simply stops being collected** (`js/departments.js:1991-1995`, `:2126-2165`). They also drop out of the BIR alphalist, which is built from salary history (`js/bir.js:795-867`). The only trace after you press Compute is a number — "1 not on payroll" — with the names hidden in a hover tooltip that is unreachable on a phone (`js/screens/hr.js:1455-1461`, `:1492` returns before the excluded rows are ever drawn).

There is a second, sharper version of the same bug: because the flag has no month, **recomputing June today applies a decision you made in August to June's run** — and the app's own unpaid-months card invites you to do exactly that (`js/screens/hr.js:1306-1349`).

### What it becomes

Removing someone becomes **a decision about one pay period**, recorded on that period's own run document — the same place, and by the same mechanism, that per-person adjustments and notes are already stored (`js/screens/hr.js:2432`, `:2304`). Remove someone from August, and September starts clean; they are back on the roster and you decide again.

Five things keep a person out of a run today. **Only one of them becomes period-scoped** (`js/departments.js:1936-1953`, verified):

| Reason | Stays permanent? |
|---|---|
| External partner | Permanent |
| **Removed from the system** (People → Remove) | **Permanent — this is your exception, and it already exists** |
| Paid weekly (production pay class) | Permanent — this is the double-pay guard |
| Has an active worker profile | Permanent — double-pay guard |
| **You took them off payroll** | **Becomes this-period-only** |

Your sentence maps onto the existing split exactly. Nothing about the double-pay guard changes.

Two things get fixed alongside it, because they are the same problem: after Compute, excluded people will be shown as real (dimmed) rows with their reason instead of a tooltip count; and an excluded employee will stop being shown a projected salary on their own screen for a month they will not be paid (`js/screens/dashboards.js:2542`, `:2565-2570` — the flag is already in memory, nothing reads it).

**One consequence to accept up front:** after this change, recomputing June or July will bring those people *back into* those months, because those months carry no exclusion of their own. That is the correct behaviour under your ruling, but you should know it before you press Compute on an old month.

### THE MIGRATION DECISION — I need your answer

The flag went live on **2026-08-07** (commit 5463827); today is 2026-08-10. By the code's own account it is carrying roughly **four people**, all flagged in the last three days, all stamped with the date they were flagged (`js/screens/hr.js:1704`). I could not count them exactly — this was read-only with no database access.

Three options:

- **(A) Drop the old flag.** Everyone flagged comes back into the next run. **Failure mode: a wrong payment.** These are the people who produced your screenshot of four staff at −₱500.00 — base ₱0.00 with SSS and PhilHealth deducted from nothing (the reason is recorded verbatim at `js/departments.js:1945-1949`). If that runs to Disburse it books an expense, posts a ledger entry and collects a cash advance from someone who draws no salary.
- **(B) Convert each flag into an exclusion for the month it was actually set in** (derivable from the stored date), then delete the old flag. Failure mode: from next month they reappear on the roster and Finance decides again — on a screen a human reads before Verify.
- **(C) Keep the flag and block Compute behind a banner** until each person is resolved. Failure mode: payroll blocked on a day nobody is at that screen.

**My recommendation: B, plus C's banner — never A.**

Convert the flags to August-only exclusions so this month's behaviour is unchanged, *and* show a one-time banner on the Payroll screen naming each migrated person with three buttons: **exclude for this period / put back on payroll / remove from system**. B on its own is safe this month but silently changes next month. The banner is what makes the semantic change survivable — it forces the decision once, in the open. It is not polish.

**What I need from you:** for each of those people, is the intent *"off payroll permanently — remove from the system"* or *"off payroll for August only"*? The reasons on file read "owner / not yet regularised / paid outside payroll" (`js/screens/hr.js:1726`) — the first and third sound permanent, the second sounds temporary.

**One trap worth naming:** setting someone's employment status to "Resigned" or "Terminated" does **not** take them off payroll today, and the code says so explicitly (`js/config.js:448-458`). Only People → Remove does. If you expect "Resigned" to mean removed, tell me and I will make it either do that or prompt you.

---

## 3. WHAT I WILL BUILD

Eleven steps. Each ships on its own. **[MONEY]** marks steps where a mistake moves real money.

**Part One — the exclusion fix (steps 1-4). Small, live bug, ships first.**

1. **[MONEY] Firestore rules for period exclusions.** The current rule *blocks* the second exclusion in a month that has never been computed (`firestore.rules:1338-1367`, verified — an update must move the state into `computed`/`verified`, which a draft cannot do). Add a narrow money-admin clause allowing an update that touches only the `excluded` field. Deployed separately with `firebase deploy --only firestore:rules` — a push does not ship rules. **Rules go out before the code**, or the exclusion silently fails to save.
2. **[MONEY] The pay-run guard becomes period-aware.** One added argument carrying that period's exclusions; the permanent reasons stay ahead of it in the same order (`js/departments.js:1936-1953`). 13 of the 17 pinned tests stay untouched and green; 4 are rewritten; ~6 new pins added (exclusion in one period doesn't skip in another; missing argument pays; "removed" still wins).
3. **[MONEY] The exclusion UI.** Remove/put-back write to the selected period only. Excluded people become visible *after* Compute, not just before. The migration banner from §2.
4. **The employee's own screen** stops projecting a salary for a period they are excluded from.

**Part Two — the weekly run (steps 5-11).**

5. **[MONEY] `pay_weeks` rules and document shape**, cloned from the monthly run's state machine. There is no rule for this collection today, and every denied read in this app renders as an empty screen — on a pay screen that reads as *"nobody is owed anything"* (`js/config.js:822-831` calls this the silent-zero choke point by name). Rules ship before the screen.
6. **[MONEY] The engine adapters and the weekly skip guard**, with their own pinned tests. This is where money bugs would hide, so it is a step of its own: resolving a worker's rate (`hourlyRate` or `dailyRate ÷ 8`, and **refuse loudly at zero** rather than emit a ₱0.00 line); deriving hours from punch times the same way the current form does; treating a day with no punch as absent; quarantining flagged days; bracketing the Monday–Sunday week.
7. **The screen** — week picker, unpaid-weeks card, Compute→Verify→Disburse strip, roster, and the totals row summed from the exact values the rows printed.
8. **[MONEY] The per-line adjust panel.** Three inputs the current form takes by hand have nowhere to come from in a batch — rent allowance, other deductions, and this week's cash-advance instalment (`js/screens/hr.js:4147,4161,4164`). Without this step they quietly become zero for everyone. Travel hours and the recorded absence override are captured here too; neither exists in stored data anywhere today.
9. **[MONEY] Disburse.** One press: book the expense, credit cash, credit deductions, deduct cash advances **once** (with a per-week key so a second press is a no-op), generate the payslips, upload the receipt. The existing per-payslip ledger posting (`js/screens/hr.js:3852-3866`) must be retired or made inert for run-generated payslips, or the same money is booked twice.
10. **Batch payslip printing**, with the receipt rendered inside the A4 sheet and the existing page-count ceiling check — above roughly 18 sheets iOS returns a blank file with no error (`js/screens/hr.js:2645-2755`). If the Operations crew exceeds that, printing has to batch.
11. **The Workers sub-view** — profiles, ID cards, kiosk clock, raises — plus keeping the one-worker generator alive as the off-cycle issuer, with a guard against paying the same worker twice for one week.

---

## 4. WHAT I WILL NOT CHANGE

- **`js/money-core.js` stays frozen.** `computeWeeklyLine` (`js/money-core.js:462`) already encodes your four rulings and is held by 29 tests. It gets called, not edited. Anything it lacks (statutory deductions, "amount already paid") is layered on top as a separate step, never folded in silently.
- **The monthly salary maths.** Untouched.
- **The double-pay guard.** Production pay class and linked worker profiles stay permanently excluded from the monthly run. This is the thing that stops a weekly worker being paid twice; it does not become period-scoped.
- **Rates stay read-only on the worker form.** Changes keep going through the approval-gated Raise flow (`js/screens/hr.js:3163-3171`).
- **Exclusion after Verify stays impossible** without a President reopen — the rules already enforce this (`firestore.rules:1342-1345`). Verify means checked; changing who gets paid after checking should cost a President action. I am treating this as intended, not as a bug.
- **Holiday, rest-day and night-differential premiums stay absent.** They are absent today; a batch run would apply whatever it is given to everyone automatically, so this is not a place to guess.

---

## 5. DECISIONS I NEED FROM YOU

Five. Everything else I have decided and listed below.

1. **Who may release a weekly pay run?** Monthly Disburse is President-only. Weekly happens 52 times a year. President-only, or may Finance release a verified week?
2. **Statutory deductions on weekly pay.** The current one-worker form deducts SSS/PhilHealth/Pag-IBIG once a month, on the last pay week, for workers configured for it (`js/screens/hr.js:4430-4451`). The batch engine has none. Port that rule into the run now, or run week one with no statutory and add it after your accountant signs off? **This needs the accountant before the first batch disburse, not after.**
3. **The migration answer per person** — permanent removal or August-only, for each of the ~4 people currently flagged (§2).
4. **Does an exclusion carry forward as a pre-ticked suggestion into the next period** (one click to confirm, honours your ruling, keeps a safety net), **or start clean every period** (purest reading of your ruling, but someone eventually forgets to re-tick and a negative-net line appears)? I lean pre-ticked-and-confirm.
5. **One transfer receipt for the whole week's batch, printed on every payslip — or one receipt per worker?** Your wording ("one disburse... the transfer fund receipt") reads as one batch receipt; confirming it decides where the file is stored.

**Decided without you:**
- A pay week is identified by its **Monday's date**, not a week number — week numbering collides at New Year in a way that would silently merge two different weeks, and the Monday date is already the field every payslip is indexed on.
- A week belongs to the month its **Monday** falls in — this rule already exists in the code, and deriving it from the week's *end* once mis-bracketed 8 of 12 months (`js/screens/hr.js:4471-4486`).
- **Hours come from the punch times, recomputed with the existing lunch rule** — not from the stored hours field. The two disagree by exactly one hour a day for self-service punches (`js/screens/hr.js:4818-4827` deducts lunch; `functions/index.js:2181` does not, both verified). Using the stored field would overpay every self-service worker an hour per day versus what your payslips pay today.
- Every peso shown on screen is read from the frozen weekly line, never recomputed. One expression, one number.
- The one-worker generator survives as the off-cycle issuer and the per-line drill-in.
- The weekly run keeps the Compute → Verify → Disburse shape (who presses which is decision 1).

**One place the recons disagree:** whether the weekly run should honour the existing per-worker "Included / Excluded in payroll" checkbox on the worker profile. That checkbox is decorative today — verified, it is written and displayed but **read by nothing** (`js/screens/hr.js:2939`, `:3269`, `:3427`; no other reader in the repo). One recon says the weekly guard should read it; another says doing so recreates the exact permanent-flag defect you are asking me to fix. **My reading: do not wire it up.** Period-scoped exclusion is defined once and works the same on both tabs; the checkbox is retired or relabelled so it cannot mislead.

---

## 6. RISKS

| Risk | Guard |
|---|---|
| **A failed read makes the exclusion list come back empty, and everyone gets paid.** Moving the exclusion onto the run document puts it behind a read that currently swallows all failures into "nothing found" (`js/departments.js:1964`, `js/screens/hr.js:1367`). | Compute must tell "no document" apart from "read failed" and **stop** on a failure rather than compute. Pinned by a test. This one cannot be deferred to a follow-up. |
| **A denied read renders as "nobody worked this week."** Every read on both payroll tabs collapses failure into an empty list. On a directory that is annoying; on a pay run it is indistinguishable from a real result. | Deploy the rules before the screen; the run's reads must surface a real error and refuse to compute rather than produce zero-hour lines. |
| **Pressing Disburse twice pays the crew twice.** The monthly run needs three separate mechanisms to prevent this; the weekly cash-advance deduction today is a bare subtraction with no key at all (`js/config.js:3070-3085`). | A terminal state enforced in the rules, per-week deterministic references for every ledger entry, and a per-week key on the cash-advance deduction so a second pass does nothing. |
| **Workers with only a daily rate on file compute to ₱0.00.** The roster column shows the daily rate, the engine reads only the hourly rate, and the create form takes both as unlinked free text (`js/money-core.js:464`, `js/screens/hr.js:4132`, `js/screens/dashboards.js:5951-5954`). The screen looks right while the run pays nothing. | One shared rate resolver, and the run **refuses per worker** at a zero rate instead of quietly emitting a ₱0.00 line. |
| **The rent allowance, other deductions and cash-advance instalment silently become zero** the moment the batch replaces the hand-filled form — those three are stored nowhere. | Step 8 ships before the first real Disburse. If it slips, the run cannot be used for live pay. |
| **Statutory deductions quietly stop** for any worker configured for them, because the batch engine has none. | Decision 2, plus a run-level warning naming every worker whose configuration the batch is not honouring. |
| **The batch payslip PDF comes out blank and looks like it worked** above roughly 18 pages on iOS. | Carry the existing up-front page-count check; refuse with a dialog rather than produce a blank file. |
| **Fixing the guard breaks the double-pay guard**, because all five skip reasons live in one function. | The four permanent reasons stay ahead of the period lookup in the same order. The 17 existing pins stay green **unmodified** except the 4 that are about exclusion — any other test turning red is a stop-the-line signal. |
| **A recompute of June or July silently re-adds people you think are off payroll.** | Migrate each flag to the month it was actually set in, and show each month's own excluded list on screen for computed months, not just uncomputed ones. |
| **Concurrent sessions destroy work in this tree.** | One agent per shared file; `git diff --cached` before every commit; re-diff `firestore.rules` immediately before deploying; never `git stash` / `reset --hard` / `checkout --` / `clean`. |

---

**Nothing has been written. Approve the plan, answer the five decisions in §5, and I will start with steps 1-4 — the exclusion fix — since that is a live money bug and small.**