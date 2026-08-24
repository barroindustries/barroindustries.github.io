# Type B (production) weekly payroll — build spec

Owner's requests, verbatim:
> "For type b employees use the same method in type a but its weekly and the time
> in thing"
> "I just want to see the total before submitting it"

## Owner rulings — 2026-08-08

These four answers were given directly and are the specification. Where they
conflict with what the code does today, **the ruling wins**.

### 1. The pay week is MONDAY–SUNDAY (7 days)
> "Add sunday because sometimes workers work on sunday"

Today the app contradicts itself: the payslip generator lays out **Mon–Sat**
(6 rows, paid Saturday) while the worker's own phone screen shows them a
**Mon–Sun** week. So a Sunday shift could appear in the worker's estimate and fall
outside the period actually paid. This ruling **resolves the contradiction in
favour of Mon–Sun** — the generator gains a 7th row and both screens agree.

Note this is a *period* decision, not a premium decision: Sunday hours are paid
like any other hours unless and until a rest-day premium is introduced (see §3).

### 2. No clock-in = ABSENT (unpaid), with an admin manual override
> "No clock in mean absent but allow manula override by admin"

Default stays as it is today — a day with no punch contributes **zero hours** and
therefore zero pay. (That was itself a deliberate earlier fix; the code before it
paid a full day nobody clocked.)

What is NEW is the override. An admin must be able to fill in a day the kiosk has
no record for — a forgotten punch, a field assignment, a kiosk outage — and the
override must be **recorded, not silent**:
- who overrode it, when, and a required reason
- visible on the payslip audit trail and in the weekly run
- never applied automatically

This matters more once a whole week computes for everyone at once: without an
override, a forgotten punch quietly costs a worker a day's pay and nobody sees it.

### 3. Overtime at the NORMAL rate; TRAVEL at HALF rate
> "Normal rate but for travel its half only"

- **Overtime** — paid at the plain hourly rate. This confirms the current
  behaviour (the field is already labelled "(regular rate)"), so no change.
- **Travel — a NEW pay component that does not exist anywhere today.** Travel
  hours are paid at **half** the normal hourly rate.

Implications to settle during build:
- travel hours need their own input on the time log, separate from regular and OT
- travel hours must be visible as their own line on the payslip, at their own
  rate, so the worker can check it

**How travel gets recorded — corrected 2026-08-08.** An earlier draft of this spec
said "the kiosk records clock-in/out, not purpose", and assumed an admin would type
travel hours in. The owner corrected that: **time in/out is done on each worker's
own phone**, not a shared kiosk. "Kiosk" is legacy naming in the code for
`openWorkerKioskModal` — the older path where HR enters a worker's time on HR's
device. The live path is `js/screens/worker.js`: the worker signs in on their own
phone and punches with a geofence check and a selfie.

**OWNER RULING: BOTH.** The worker taps a Travel option on their own phone, AND an
admin can add or correct travel hours on the weekly run, with a reason — the same
override mechanism as a missing punch (§2).
- The worker-side half falls out of what already exists: the self-service punch
  performs a **geofence check**, and a worker who is travelling is BY DEFINITION
  not at the site, so that check already fails them today. It reads as "you can't
  clock in" when it could read as "this is travel". A travel punch type gives that
  failure a meaning instead of a dead end. Selfie and location are still recorded.
- The admin-side half is the one that will actually get used first — see below.

Note also: self-service punching ALREADY requires the unified structure this spec
proposes — a `users` doc, `payroll/{uid}.payClass === 'production'`, and a
`worker_profiles` doc whose `linkedUid` is that uid (see the header comment in
js/screens/worker.js).

**OWNER RULING: most workers are still HR-ENTERED today; phone punching has not
rolled out widely.** That reorders the work:
- The CREATE PATH is the bigger half, not a formality. Most production workers have
  no login at all, so nothing links them to a `users` doc and the "same method as
  Type A" model does not yet apply to them. Making one create form that produces
  all three records (users + payroll + worker_profiles.doc(uid) with linkedUid) is
  what actually moves them onto the unified rails.
- The weekly run MUST read attendance identically whichever way it was recorded.
  Both paths already write the same
  `attendance_worker/{worker_profiles.id}/records/{date}` shape — the self-service
  path merely adds geofence/selfie fields on top — so the run should key off the
  worker_profiles docId and treat the extra fields as optional. Do NOT make the
  run depend on a linkedUid existing.
- Consequently the ADMIN-ENTERED travel figure is what will be used in practice on
  day one, and the worker-side Travel button is the part that matters as phone
  punching rolls out. Build the admin side first.

Still absent by choice: holiday, rest-day and night-differential premiums. The
owner has not asked for them. **Flag to the accountant before this is
systematised** — PH labour rules do prescribe premiums, and a weekly run applies
whatever it is given to everyone, every week, automatically.

### 4. ONE disburse for the whole week, then a payslip carrying the transfer receipt
> "One disburse then create payslip with the tranfer fund receipt attached in one
> page"

This is the big structural answer: Type B stops being one-payslip-at-a-time and
matches Type A's batch shape.

- **One weekly run** covering every production worker: Compute → (review the
  total) → **one Disburse**.
- After disbursing, each worker's payslip is generated **with the bank transfer
  receipt attached on the same page** — payslip and proof of payment as a single
  printable document, not two files.

Open questions for build:
- one receipt for the whole batch transfer (most likely, given "one disburse"), or
  one per worker? The wording implies a single batch transfer whose receipt is
  attached to every payslip in the run.
- the receipt is an uploaded image/PDF — it needs a home on the pay-run record and
  must render inside the existing printable-document pipeline
  (`buildLetterhead` / the print CSS used by payslips), on ONE page.

---

## What this replaces

Type B currently lives in a **separate population** (`worker_profiles`, keyed by a
random auto-id, joined to a login only via `linkedUid`). That split is the cause
of several shipped defects, including Type B workers being unable to read their own
payslips.

**Unification hinge (no migration required):** `worker_profiles` doc ids are
client-generated, so NEW Type B staff can be created as `.doc(uid)` with
`linkedUid = uid`. Every existing join already resolves through `linkedUid` rather
than the id shape, so **existing workers keep their auto-ids and are never
touched** — attendance records, payslips, worker_directory entries, ID-card tokens
and Storage selfie paths all keep resolving. New staff are single-population; old
staff keep working. **Do not re-key the existing collections.**

## Build order

Each step is independently shippable. Ordered so the owner's own request lands
first and the money machinery lands last.

1. **The totals** *(in progress)* — live Gross/Deductions/Net on the weekly
   generator; the Type A totals row surviving Compute; the peso amount in the
   Submit confirm. Display-only, no money-math change.
2. **Guard reconciliation** — make the roster's Type A/B predicate match the
   engine's, so the double-pay guard cannot disagree with what is shown.
3. **One create path** — Employee Type on the create form; Type B writes
   `users` + `payroll(payClass:'production')` + `worker_profiles.doc(uid)`.
4. **`computeWeeklyLine` into money-core** — an additive pure function with its own
   pinned tests, covering the Mon–Sun week, absent days, admin overrides, OT at
   normal rate and travel at half rate. Must land before step 5 so the run and the
   form share one expression.
5. **The weekly run** — `pay_weeks/{YYYY-Www}`, compute from attendance,
   roster + totals row, one Disburse, then payslip generation with the transfer
   receipt attached.

## Non-negotiables

- **The double-pay guard is load-bearing.** The monthly run currently skips anyone
  linked to a worker profile. Moving Type B onto the same rails makes that guard
  the only thing preventing someone being paid monthly *and* weekly. Test it.
- The number shown before submitting must come from the **same expression** that
  writes the payslip — one shared helper, never a second copy of the arithmetic.
  This repo has already been bitten by a preview/engine divergence in payroll.
- Manila-time helpers (`bizDate`/`bizHour`/`bizDow`) only; raw `toISOString()` has
  already broken attendance and payroll here. Week bracketing must derive the
  month from the period **start**, not the end — that exact defect mis-bracketed
  8 of 12 months once already.
- `js/money-core.js` is frozen and covered by pinned tests. Additive functions
  only; never edit the existing ones without a stated reason and updated pins.
