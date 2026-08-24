# Payroll redesign — the owner's brief

**2026-08-10.** Recorded verbatim from the owner before any design work, so the
build reads his words rather than an interpretation of them.

> "theres so many wrong with payroll, do a complete fix"
> "these so little flexibility, and its so hard to understand"
> "fix the coordination between hr and finance"

## What loses him — he selected ALL FOUR

| | |
|---|---|
| **Compute / Verify / Disburse** | Three steps where he expects one. Never explained what each does, what is reversible, or why he cannot just pay people. Ceremony borrowed from accounting software. |
| **Two separate tabs** | Office Team and Operations Team are two screens with two rule sets, when in his head it is one job: paying his people. He must recall which kind someone is before he knows where to look. |
| **Where the numbers came from** | A figure appears and he cannot tell which hours, which rate, what was deducted — or change it without redoing everything. |
| **Finding it at all** | Payroll sits under BOTH HR and Finance; Accounts & Logins is somewhere else again. He is not sure which door is right. |

Selecting all four matters more than any one: this is not a wording problem on a
screen, it is the shape.

## What it fights him on — again ALL FOUR

- **Fix something after paying** — a wrong amount, a missed day, a payslip to reissue, *after* Disburse.
- **Pay someone off the normal cycle** — final pay, an advance, a partial week, a mid-period joiner or leaver.
- **One-off amounts** — a bonus, 13th month, a special allowance, a deduction that is not one of the fixed fields.
- **Hold or adjust one person** — pay everyone but one; change one person without touching the run.

## Two rulings

**Ownership: HR PREPARES, FINANCE PAYS.** HR owns people, hours, rates and
corrections — everything up to the numbers being right. Finance reviews and
releases the money. A real handoff, with each side told when it is their turn.
Today there is no handoff at all, only an overlap.

**Scope: REDESIGN THE FLOW PROPERLY.** Not a wording pass. He accepts that
screens he knows will move, explicitly to stop us patching the same thing every
week.

## The governing principle

> "dont make it so confusing to process payroll"

This outranks every other goal in this document. A redesign that is more correct,
more flexible and more unified but still takes a paragraph to explain has failed.

**The test.** Someone who has never seen the screen should be able to pay the
crew without anyone telling them what a step means. Not "with training" — on
sight.

**What that forbids.** Adding a step to solve a problem. Every capability the
owner asked for — corrections after payment, off-cycle pay, one-off amounts,
holding one person — must appear as something you do TO A PERSON ON THE ROSTER,
not as another mode, another screen or another button in a strip. Flexibility
that arrives as more surface area is the disease, not the cure.

**Specifically, the step count must go DOWN.** Today it is Compute -> Verify ->
Disburse, three deliberate actions with no plain-English meaning, on two separate
tabs, reachable through two departments. If the redesign does not end with fewer
things to understand than that, it is not the redesign he asked for. The three
steps exist for real reasons — a frozen line nobody can quietly edit, a review
before money moves, a lock so a double press cannot double pay — and those
reasons must survive. But they should be things the SYSTEM does, surfaced as one
obvious action and one obvious safeguard, not three chores handed to a person.

---

## The keystone ruling — UNIFY THEM

> "unify it as well, treat disbursement of office and operations the same, the
> difference is just the system of computing their pay"

This is the answer to the two-tab complaint, and it is a better model than the
one currently built. Stated precisely:

**ONE payroll. ONE roster. ONE Compute. ONE release. ONE payslip pipeline. ONE
ledger posting. `payClass` selects a COMPUTE STRATEGY for a line — and nothing
else.**

Everything downstream of the number is identical for both teams:
who is in the run, who is held out and why, the review, the release, the
payslip, the receipt, the cash-advance collection, the expense leg, the audit
trail. None of that has any business knowing whether someone is paid monthly or
weekly.

What legitimately differs is ONLY the arithmetic that produces one line:

| | Office Team | Operations Team |
|---|---|---|
| Basis | monthly salary (+ KPI) | hours from punches |
| Rate | salary / period | hourly, or daily ÷ 8 |
| Extras | allowances | overtime at plain rate, travel at half |
| Absence | leave rules | no clock-in = absent unless overridden with a reason |
| Statutory | monthly | monthly, on the last pay week of the month |

Both already exist and are frozen and tested — `computePayLine` and
`computeWeeklyLine` in `js/money-core.js`, 257 pinned tests. **The maths is not
what is wrong.** The redesign puts one screen and one release in front of the
two of them instead of two of everything.

### What this dissolves

- The two-tab split disappears. You open Payroll, you pick a period, you see
  everyone due in it.
- Two state machines (`pay_runs` and `pay_weeks`, built two days apart) collapse
  toward one shape, so a fix to release, exclusion or receipts lands once
  instead of twice — the duplication that produced today's defects, where the
  double-post guard was live on one side and dead on the other.
- The double-pay guard gets simpler to reason about: one run per period, one
  line per person, so "paid twice" becomes structurally harder rather than
  something two separate guards must agree about.
- "Which screen do I use" stops being a question.

### The one honest complication

A month and a week are different lengths, so a single run still covers ONE
period. Unified does not mean "pay everyone in one click regardless of cycle" —
it means the weekly run and the monthly run are THE SAME SCREEN doing the same
things, with the period picker choosing which period you are paying. If that is
not what was meant, it needs saying before the build starts.

---

## Mobile is a requirement, not a tier

> "make sure its mobile usable, no data gets cut or hidden"

Two separate demands, and the second is the strict one.

**Usable on a phone.** Payroll gets opened on a phone as often as a laptop. Every
action in the flow must be completable at 375px — not merely visible.

**NO DATA CUT OR HIDDEN.** This rules out three things the app currently does:

1. **Horizontal scroll that clips columns.** A roster has ~11 figures per worker
   (days, hours, OT, travel, earnings, allowances, other deductions, statutory,
   cash advance, net). They do not fit 375px in a table, and a table that scrolls
   sideways hides the net pay behind a swipe nobody discovers.
2. **The `table-cards` expand/collapse pattern.** It hides every cell marked
   `tc-detail` behind a tap. That is right for a directory and WRONG here: on a
   pay roster a hidden deduction is the definition of data hidden. The weekly
   screen built today uses exactly this pattern and therefore fails this rule.
3. **Truncation.** No ellipsis on a name or a figure. A shortened peso amount is
   a wrong peso amount to whoever is reading it.

**What that forces.** On a phone the roster cannot be a table at all. It has to
be one CARD PER WORKER showing every component at once — which is fine, because
a worker's pay is about eight short label/value pairs, and a card can hold that
comfortably at 375px without a single hidden field. The table shape returns on a
wide screen where the columns genuinely fit.

**Verification standard for this work.** "Looks fine on my machine" is not
evidence. Every payroll screen ships only after a measured check at 375px:
`document.documentElement.scrollWidth <= innerWidth` (no page-level horizontal
scroll), zero elements with `text-overflow: ellipsis` in the roster, and every
figure present in the accessibility tree without a tap. Those are the same
measurements that caught the calendar chip and the sticky payslip bar today.

---

## Backfilling history

> "since this is a new design again, allow us to input the old records so
> everything is up to date"

A payroll with no past is not much use: several things in this app read HISTORY,
not the current period, and they are all wrong today for anyone paid before the
system existed —

- the **BIR alphalist** is assembled from `salary_history` (js/bir.js ~795-867),
  so a year with gaps produces a filing with gaps;
- **13th-month pay** is a function of the year's earnings;
- **month-to-date and year-to-date** on payslips and reports;
- a worker's own **payslip archive**, which is the thing they ask HR for.

So the redesign needs a way to enter periods that were paid before, or paid
outside the system. It belongs on the same unified screen — a past period you
pick and fill in — not a separate import tool, which would be another mode and
would break the governing principle above.

### ⚠ THE HAZARD, which decides how this is built

**A backfilled period must not book money that is already in the books.**

A normal disburse posts a Payroll Expense debit, a cash credit, the deduction
legs and each cash-advance collection (js/departments.js disbursePayRun). If a
backfilled June also posts those, and June's wages were already recorded — by
the old process, by a manual journal entry, by anything — then June's expense is
counted twice, every report is overstated, and the error is invisible because
both entries look legitimate.

The inverse is equally real: if those wages were NEVER recorded, then a backfill
that skips the ledger leaves the books understating wages by exactly that
amount.

Both failures are silent and neither is recoverable by looking at the payroll
screen. **This is not a decision the system can infer** — it depends on what was
done outside it, which only the owner knows. It is therefore an explicit choice
at entry, per period, stated in plain words, and recorded on the record itself
so the reason is visible a year later to whoever is reconciling.

### Consequences to build to, whichever way that lands

- A backfilled record is **marked as backfilled**, permanently and visibly.
  Nobody reading a payslip or a report a year from now should have to guess
  whether a figure came from a live run or a hand-entered one.
- It **never re-collects a cash advance**. The repayment already happened; a
  backfill that deducts it again would take the money twice on paper and corrupt
  the outstanding balance.
- It **generates payslips** (that is much of the point) but must not send
  notifications — nobody wants a push about a payslip from March.
- It **cannot be entered for a period that already has a real run**, or the two
  disagree about the same month with no way to tell which is true.
- Entry has to be quick. Backfilling a year for thirty workers is 360 records; if
  each takes a form and six clicks it will not get done, and a half-populated
  history is worse than none because it looks complete.

---

## Constraints that do not move

These were ruled earlier and a redesign does not reopen them:

- Pay week is Monday–Sunday; Sunday is worked and paid.
- No clock-in = absent, unless an admin records an override **with a reason**.
- Overtime at plain rate; travel at half rate.
- Removing someone applies to **that period only** unless they are removed from
  the system; exclusions pre-tick into the next period.
- One receipt **per worker** at disburse.
- Finance may release a verified week without the President.
- Statutory is monthly, on the last pay week of the month.
- `js/money-core.js` is frozen and covered by 257 pinned tests. The per-worker
  maths is not what is wrong here — the way people reach it is.

## The one gate that still stands

The ported statutory rule has **not** been signed off by the accountant. Nothing
in a redesign changes that: the weekly run must not pay for real until it is.
