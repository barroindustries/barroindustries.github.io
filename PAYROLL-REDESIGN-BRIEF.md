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
