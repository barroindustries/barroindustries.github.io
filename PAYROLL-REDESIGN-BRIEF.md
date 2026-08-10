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
