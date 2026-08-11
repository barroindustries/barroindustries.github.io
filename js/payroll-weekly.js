// ═══════════════════════════════════════════════════════════
//  js/payroll-weekly.js — window.WeeklyRun, the Operations Team's WEEKLY run.
//
//  THE ENGINE ONLY. No DOM, ever. The screen (js/screens/*) calls the eight
//  methods on window.WeeklyRun and reads every peso off the STORED line — it
//  never recomputes. That is the whole point: this repo has already been bitten
//  by a preview/engine divergence in payroll, and a weekly run applies whatever
//  it is given to a whole crew in one click.
//
//  SHAPE. pay_weeks/{weekId}, weekId = the week's MONDAY as 'YYYY-MM-DD'
//  (window.payWeekMondayOf). Never an ISO week number — those collide at a year
//  boundary. State machine: draft -> computed -> verified -> disbursing ->
//  disbursed, enforced in firestore.rules as well as here.
//
//  WHAT IT REUSES AND MUST NOT REBUILD (js/money-core.js, FROZEN, 197 pinned
//  tests): computeWeeklyLine, resolveWorkerHourlyRate, weeklyRunSkipReason,
//  payWeekMondayOf / payWeekDays / payWeekMonth. Everything money-shaped in
//  here either calls one of those or is a pure helper on window.WeeklyRunCore
//  below, pinned by tests/weekly-engine.test.mjs.
//
//  ── THE FOUR THINGS THAT WOULD SILENTLY COST MONEY ──────────────────────
//  1. HOURS COME FROM THE PUNCH TIMES, recomputed here with the SAME lunch rule
//     the one-worker payslip generator uses (js/screens/hr.js's computeDayHours
//     — an hour comes off any shift spanning 12:00-13:00). The stored
//     attendance_worker record ALSO carries `hoursWorked`, written by the
//     self-service punch path (functions/index.js), which does NOT deduct that
//     hour. The two therefore disagree by exactly one hour a day for every
//     phone-punching worker, and trusting the stored field would pay an hour a
//     day more than the payslips this run replaces. WeeklyRunCore.dayHours is a
//     verbatim port; `hoursWorked` is read for ONE purpose only — the >16h
//     implausibility flag, which pays nothing either way.
//  2. RENT ALLOWANCE, OTHER DEDUCTIONS and the CASH-ADVANCE INSTALMENT are typed
//     by hand into the one-worker form and stored NOWHERE on the profile. A
//     batch that does not capture them silently zeroes all three for everyone,
//     which is why `adjustments` is a first-class part of the run document and
//     is folded in BEFORE computeWeeklyLine — so the frozen line already
//     contains them and nothing downstream has to remember to add them back.
//  3. A worker with only a dailyRate computes to ₱0.00 unless resolved through
//     resolveWorkerHourlyRate (the roster column shows the DAILY rate while the
//     engine reads the HOURLY one — the screen looks right and the run pays
//     nothing). Refused PER WORKER, named in `skipped`; a zero line is never
//     emitted.
//  4. The existing per-payslip ledger post fires on the payslip's Submit
//     transition (js/screens/hr.js's openPayslipHistory, ref `WPAY-{id}`).
//     Run-generated payslips are written straight to status 'submitted' — the
//     Submit button only renders for a payslip with a NEXT stage — and carry
//     `postedByRun: true` + the run's own ledger refs, so Disburse cannot book
//     the same money twice. See the handoff note at writeWeekPayslip.
// ═══════════════════════════════════════════════════════════

// UMD-ish shim, same convention as js/money-core.js: makes `window` exist under
// plain Node so tests can require() the pure half of this file with no build
// step and no global stubbing. No-op in the browser.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

(function () {
  'use strict';

  const _r2 = (n) => Math.round(((+n || 0) + Number.EPSILON) * 100) / 100;

  // ═════════════════════════════════════════════════════════
  //  PURE CORE — window.WeeklyRunCore
  //  Zero Firestore, zero DOM, zero wall-clock (except where named). Every
  //  decision that can cost money and can be decided without the database
  //  lives here so tests/weekly-engine.test.mjs can pin it.
  // ═════════════════════════════════════════════════════════
  const WRC = {};

  /**
   * Hours between two "HH:MM" punch strings, minus a flat 1hr lunch when the
   * shift overlaps 12:00-13:00. VERBATIM PORT of js/screens/hr.js's
   * computeDayHours (~4885) — money note 1. If that function ever changes, this
   * one changes with it in the same commit, or the batch and the one-worker
   * payslip start paying different amounts for the same punch.
   */
  WRC.dayHours = function (timeIn, timeOut) {
    if (!timeIn || !timeOut) return 0;
    const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
    let inM = toMin(timeIn), outM = toMin(timeOut);
    if (!Number.isFinite(inM) || !Number.isFinite(outM)) return 0;
    if (outM <= inM) outM += 24 * 60;          // overnight shift
    let mins = outM - inM;
    const lunchStart = 12 * 60, lunchEnd = 13 * 60;
    if (inM < lunchEnd && outM > lunchStart) mins -= 60;   // shift spans 12-1PM lunch
    return Math.max(0, mins / 60);
  };

  /**
   * How one day's clocked hours split into regular and overtime.
   *
   * PARITY, NOT A REDESIGN — read this before "fixing" it. The one-worker
   * generator sets Hours Worked to the FULL day total AND OT Hours to the
   * excess over 8 (js/screens/hr.js's recomputeHours), and computeWeeklyLine
   * pays `hours * rate + otHours * rate`. So a 10-hour day pays TWELVE hours
   * today: ten in the regular column and two again in the OT column, both at
   * the plain rate. Emitting {hours:8, otHours:2} instead would be defensible
   * arithmetic and would quietly cut every long day's pay by the overtime,
   * which is not a change an engine gets to make on its own. The run reproduces
   * what the payslips pay and NAMES it in `warnings` (code 'ot-double-count')
   * whenever any day exceeds 8h, so the owner decides in daylight.
   */
  WRC.OT_THRESHOLD_HOURS = 8;
  WRC.splitDayHours = function (h) {
    const hours = Math.max(0, Number(h) || 0);
    return { hours: _r2(hours), otHours: hours > WRC.OT_THRESHOLD_HOURS ? _r2(hours - WRC.OT_THRESHOLD_HOURS) : 0 };
  };

  /** Any day this run refuses to auto-pay without a recorded override. */
  WRC.IMPLAUSIBLE_HOURS = 16;
  WRC.dayIsFlagged = function (rec) {
    if (!rec) return false;
    // Worker-side contract (js/screens/worker.js): needsReview is set when a
    // forgotten clock-out was closed the next day, or the shift blew past the
    // maximum. hoursWorked > 16 catches the phantom ~22-24h shift an unclosed
    // punch produces. Either way the day is EXCLUDED from the silent auto-sum
    // and has to be confirmed by a human — the same rule the one-worker
    // generator's "Needs review before paying" list enforces.
    if (rec.needsReview === true) return true;
    if (typeof rec.hoursWorked === 'number' && rec.hoursWorked > WRC.IMPLAUSIBLE_HOURS) return true;
    return WRC.dayHours(rec.timeIn, rec.timeOut) > WRC.IMPLAUSIBLE_HOURS;
  };

  /**
   * THE DAY ARRAY computeWeeklyLine expects, built from punches + this week's
   * adjustments. Returns { days, flags } — `days` goes straight into the frozen
   * function, `flags` is what the screen shows so a refusal is never invisible.
   *
   * @param dates   the seven ISO dates, Monday first (window.payWeekDays)
   * @param records { [isoDate]: attendance_worker record }
   * @param adj     this worker's adjustment entry (see mergeAdjustment)
   */
  WRC.buildWeekDays = function (dates, records, adj) {
    const recs = records || {};
    const a = adj || {};
    const overrides = a.overrides || {};
    const days = [];
    const flags = [];

    for (let i = 0; i < 7; i++) {
      const date = (dates && dates[i]) || '';
      const rec = recs[date] || null;
      const ovr = overrides[date] || null;
      const f = { date, source: 'none', flagged: false, punchedHours: 0, overrideMissingReason: false };

      let hours = 0, otHours = 0;

      if (rec) {
        f.punchedHours = _r2(WRC.dayHours(rec.timeIn, rec.timeOut));
        if (WRC.dayIsFlagged(rec)) {
          // Money note 1's sibling: a flagged day pays NOTHING until a human
          // records an override. Paying it silently is how a phantom 22-hour
          // shift reaches a bank transfer.
          f.flagged = true;
          f.source = 'flagged';
        } else if (f.punchedHours > 0) {
          const split = WRC.splitDayHours(f.punchedHours);
          hours = split.hours; otHours = split.otHours;
          f.source = 'punch';
        }
      }

      // An override REPLACES the punch-derived figures outright — it is the
      // admin stating what this day really was.
      //
      // A REASON-LESS OVERRIDE IS REFUSED HERE, and it has to be here. Owner
      // ruling 2 says money never moves without a record, and computeWeeklyLine
      // only enforces HALF of that: it drops the override off the row (nothing
      // to audit) but still PAYS the hours it was handed, because its `worked`
      // test is simply hours+ot+travel > 0. Pass it {hours:8, reason:''} and it
      // pays eight hours with the audit trail blank — precisely the case the
      // ruling forbids. The frozen function cannot be changed, so the refusal
      // lives in the caller that builds its argument: an unrecorded override is
      // IGNORED and the day falls back to whatever the punches say. Falling
      // back rather than zeroing is deliberate — the punch is itself a record,
      // and refusing an unaudited edit must not also destroy the audited fact
      // underneath it.
      if (ovr && ovr.reason) {
        hours = Math.max(0, Number(ovr.hours) || 0);
        otHours = Math.max(0, Number(ovr.otHours) || 0);
        f.source = 'override';
      } else if (ovr) {
        f.overrideMissingReason = true;
        f.ignoredOverride = { hours: Math.max(0, Number(ovr.hours) || 0), otHours: Math.max(0, Number(ovr.otHours) || 0) };
      }

      const day = { date, hours, otHours, travelHours: 0 };
      if (ovr && ovr.reason) day.override = { by: ovr.by || '', at: ovr.at || '', reason: String(ovr.reason) };
      days.push(day);
      flags.push(f);
    }

    // TRAVEL is a WEEK figure on the adjustment (the contract's `travelHours`),
    // not a punch — nobody clocks in for a trip. computeWeeklyLine reads it
    // per day, so it is parked on the first day the worker actually worked:
    // travelPay is a sum either way, and parking it there cannot flip an absent
    // day into a worked one and so cannot move daysWorked/daysAbsent. A
    // travel-only week has no worked day to park it on, so it lands on Monday —
    // and money-core's own pinned test says a travel-only day IS worked.
    const travel = Math.max(0, Number(a.travelHours) || 0);
    if (travel > 0) {
      let idx = days.findIndex((d) => (d.hours + d.otHours) > 0);
      if (idx < 0) idx = 0;
      days[idx].travelHours = travel;
      flags[idx].travelParked = travel;
    }

    return { days, flags };
  };

  /**
   * The FOOD ALLOWANCE rule, ported from the one-worker generator: the
   * profile's per-day rate times the number of days exceeding four hours
   * (js/screens/hr.js's recomputeHours). Counted on the day's WHOLE clocked
   * total (regular + overtime), which is the figure that function tests.
   */
  WRC.foodAllowanceFor = function (profile, days) {
    const rate = Math.max(0, Number(profile && profile.foodAllowance) || 0);
    if (!rate) return 0;
    const daysOver4 = (days || []).filter((d) => ((+d.hours || 0) + (+d.otHours || 0)) > 4).length;
    return _r2(rate * daysOver4);
  };

  /** A normalised, complete adjustment entry. Absent keys keep their previous
   *  value — a patch is a patch, not a replacement, or editing the rent
   *  allowance would wipe the cash-advance instalment. */
  WRC.EMPTY_ADJUSTMENT = { rentAllowance: 0, otherDeductions: 0, caDeduction: 0, travelHours: 0, overrides: {} };
  WRC.mergeAdjustment = function (prev, patch) {
    const p = prev || {};
    const q = patch || {};
    const num = (k) => {
      const v = (q[k] !== undefined) ? q[k] : p[k];
      const n = Math.max(0, Number(v) || 0);
      return _r2(n);
    };
    const out = {
      rentAllowance: num('rentAllowance'),
      otherDeductions: num('otherDeductions'),
      caDeduction: num('caDeduction'),
      travelHours: num('travelHours'),
      overrides: Object.assign({}, p.overrides || {})
    };
    if (q.overrides && typeof q.overrides === 'object') {
      Object.keys(q.overrides).forEach((date) => {
        const e = q.overrides[date];
        // An explicit null/false clears that day's override — the only way to
        // take one back without hand-editing Firestore.
        if (!e) { delete out.overrides[date]; return; }
        out.overrides[date] = {
          hours: Math.max(0, Number(e.hours) || 0),
          otHours: Math.max(0, Number(e.otHours) || 0),
          reason: e.reason ? String(e.reason) : '',
          by: e.by || (p.overrides && p.overrides[date] && p.overrides[date].by) || '',
          at: e.at || (p.overrides && p.overrides[date] && p.overrides[date].at) || ''
        };
      });
    }
    return out;
  };

  // ── week arithmetic ──────────────────────────────────────────────────────
  // Noon-anchored with an explicit +08:00, exactly as payWeekMondayOf does and
  // for the same reason: a bare 'YYYY-MM-DD' parses as UTC midnight, which is
  // the PREVIOUS day for any negative offset, and a week boundary that moves by
  // a day pays the wrong seven days.
  WRC.shiftIso = function (iso, deltaDays) {
    const d = new Date(String(iso).slice(0, 10) + 'T12:00:00+08:00');
    if (isNaN(d)) return '';
    d.setUTCDate(d.getUTCDate() + (deltaDays | 0));
    return d.toISOString().slice(0, 10);
  };
  WRC.nextMonday = function (mondayIso) { return WRC.shiftIso(mondayIso, 7); };
  WRC.prevMonday = function (mondayIso) { return WRC.shiftIso(mondayIso, -7); };

  /**
   * Is this the LAST pay week of its month? Ported from js/screens/hr.js
   * (~4552): `addDays(start,7).slice(0,7) !== start.slice(0,7)`. Decided from
   * the week's MONDAY on both sides — a week whose Monday is in August belongs
   * to August even when it ends in September. Deriving it from the END mixed
   * two date spaces and mis-bracketed 8 of 12 months of 2026, losing whole
   * weeks out of the month-to-date gross. Since Mondays step by exactly seven
   * days, every month has exactly one.
   */
  WRC.isLastPayWeekOfMonth = function (mondayIso) {
    const monthOf = window.payWeekMonth || ((m) => String(m).slice(0, 7));
    return monthOf(WRC.nextMonday(mondayIso)) !== monthOf(mondayIso);
  };

  /**
   * The monthly statutory rule for ONE worker, ported verbatim in behaviour
   * from js/screens/hr.js ~4552-4598 (the weekly generator's own prefill).
   *
   *   • UNCONFIGURED WORKER -> nothing, ever. Production staff are not
   *     regularised, so SSS/PhilHealth/Pag-IBIG/tax are genuinely not due and
   *     the zeros are CORRECT. No statConfig, or a statConfig holding only
   *     unrecognised values, takes this path and touches nothing.
   *   • Deducted ONCE A MONTH, on the month's LAST pay week, because the
   *     brackets are monthly. Every other week of the month is zero.
   *   • auto -> the table amount for the month's gross; fixed -> the flat
   *     amount on the profile; exempt -> a real zero.
   *   • The EMPLOYER share is table-computed for auto AND fixed (never
   *     hand-typed), zero for exempt, and carries no `tax` leg. It is display
   *     + BIR 1601-C only — the weekly ledger books no employer expense
   *     (v12 WS24 decision 3, unchanged).
   *
   * @param ctx { isLastPayWeek, table }  `table` is a computeStatutory result
   *            keyed on the MONTH's gross-to-date, or null.
   */
  WRC.STAT_KEYS = ['sss', 'philhealth', 'pagibig', 'tax'];
  WRC.resolveStatutoryWeekly = function (profile, ctx) {
    const c = ctx || {};
    const out = { sss: 0, philhealth: 0, pagibig: 0, tax: 0, total: 0, er: null, configured: false, applied: false };
    const cfg = profile && profile.statConfig;
    const MODES = ['auto', 'fixed', 'exempt'];
    if (!cfg || typeof cfg !== 'object') return out;
    if (!WRC.STAT_KEYS.some((k) => MODES.includes(cfg[k]))) return out;
    out.configured = true;
    if (!c.isLastPayWeek) return out;         // monthly obligation, monthly bracket
    out.applied = true;

    const sug = c.table || null;
    const er = { sss: 0, philhealth: 0, pagibig: 0 };
    WRC.STAT_KEYS.forEach((k) => {
      const mode = cfg[k];
      if (mode === 'auto') out[k] = sug ? (sug.ee[k] || 0) : 0;
      else if (mode === 'fixed') out[k] = parseFloat(profile[k]) || 0;
      else out[k] = 0;                        // exempt, or a key with no mode set
      if ((mode === 'auto' || mode === 'fixed') && k !== 'tax' && sug) er[k] = sug.er[k] || 0;
    });
    out.total = _r2(out.sss + out.philhealth + out.pagibig + out.tax);
    out.er = er;
    return out;
  };

  /**
   * The `w` argument computeWeeklyLine takes, with every hand-typed figure from
   * the adjust panel already folded in (money note 2).
   *
   * STATUTORY RIDES IN `deductions`, DELIBERATELY. computeWeeklyLine is frozen
   * and has no statutory input, and folding the total into "other deductions"
   * is the only way to keep BOTH the net AND the cash-advance clamp correct —
   * the clamp is `min(caRequested, gross - otherDeductions)`, so statutory is
   * collected ahead of the advance, which is the right order. The split is kept
   * whole on the line (`statutory` / `otherDeductionsOnly`) so the payslip and
   * the ledger can still tell the two apart.
   */
  WRC.workerPayInputs = function (profile, adj, days, statutory) {
    const p = profile || {};
    const a = adj || WRC.EMPTY_ADJUSTMENT;
    const st = statutory || { total: 0 };
    const rate = window.resolveWorkerHourlyRate(p);
    return {
      hourlyRate: rate.rate,
      allowances: {
        meal: WRC.foodAllowanceFor(p, days),
        transport: Math.max(0, Number(p.allowances && p.allowances.transport) || 0),
        rent: Math.max(0, Number(a.rentAllowance) || 0)   // hand-typed, stored nowhere else
      },
      deductions: _r2(Math.max(0, Number(a.otherDeductions) || 0) + (st.total || 0)),
      caDeduction: Math.max(0, Number(a.caDeduction) || 0)
    };
  };

  // ── deterministic identifiers ────────────────────────────────────────────
  // Everything a Disburse writes is addressed by a ref derived ONLY from the
  // week (and the worker), so a second press overwrites the same rows instead
  // of booking the money again. The suffix W keeps the weekly legs distinct
  // from the monthly run's PAY-/SSSPAY-/NETPAY- family, which is keyed on
  // 'YYYY-MM' — without it a month-shaped id and a Monday-shaped id could never
  // collide, but a human reading the ledger could not tell which run posted a
  // row either.
  WRC.LEDGER_KINDS = {
    expense: 'PAYW', sss: 'SSSPAYW', philhealth: 'PHPAYW', pagibig: 'HDMFPAYW',
    tax: 'WHTPAYW', deductions: 'EMPDEDW', cashAdvance: 'CADEDUCTW', net: 'NETPAYW'
  };
  WRC.ledgerRef = function (kind, weekId, workerId) {
    const k = WRC.LEDGER_KINDS[kind] || String(kind);
    return workerId ? `${k}-${weekId}-${workerId}` : `${k}-${weekId}`;
  };
  /** The payslip doc id. Deterministic per (week, worker) so a resumed disburse
   *  updates the same payslip instead of issuing a second one for the same
   *  seven days. */
  WRC.payslipId = function (weekId, workerId) { return `WK-${weekId}-${workerId}`; };

  // ── labels ───────────────────────────────────────────────────────────────
  WRC.MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /**
   * "11–17 Aug 2026". Pure string maths on the seven dates — no Intl, no
   * locale, no Date parsing of a bare date string. Collapses the repeated parts
   * so a same-month week reads as one span, and spells both ends out when the
   * week crosses a month or a year.
   */
  WRC.weekLabel = function (weekId) {
    // payWeekDays throws a RangeError on anything it cannot parse (toISOString
    // on an Invalid Date). A label is decoration — it must never be the thing
    // that takes a pay screen down, so a bad id renders as itself.
    let days = [];
    try { days = window.payWeekDays ? window.payWeekDays(weekId) : []; } catch (_) { days = []; }
    if (!days.length || !days[0] || !days[6]) return String(weekId || '');
    const part = (iso) => ({
      d: String(parseInt(iso.slice(8, 10), 10)),
      m: WRC.MONTHS[parseInt(iso.slice(5, 7), 10) - 1] || '',
      y: iso.slice(0, 4)
    });
    const a = part(days[0]), b = part(days[6]);
    if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
    if (a.m !== b.m) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
    return `${a.d}–${b.d} ${a.m} ${a.y}`;
  };

  window.WeeklyRunCore = WRC;

  // ═════════════════════════════════════════════════════════
  //  THE RUN — window.WeeklyRun
  //  Everything below touches Firestore. Nothing below touches the DOM.
  // ═════════════════════════════════════════════════════════

  // ── HOW THIS FILE REACHES THE FIREBASE GLOBALS ───────────────────────────
  // js/firebase-config.js declares `const db = firebase.firestore()` at the top
  // level of a CLASSIC SCRIPT. Top-level let/const live in the global LEXICAL
  // environment — shared by every classic script on the page, but NOT reachable
  // as `window.db`, which is plain undefined. (departments.js's disbursePayRun
  // reads `window.currentUser` for exactly this reason and silently gets
  // undefined; a pre-existing bug, flagged, not inherited here.) These two
  // accessors resolve the bare bindings LAZILY, at call time, which also keeps
  // the file require()-able under Node for tests — nothing dereferences a
  // database until a run method is actually invoked.
  const _db = () => (typeof db !== 'undefined' ? db : window.db);
  const _fb = () => (typeof firebase !== 'undefined' ? firebase : window.firebase);

  const RUNS = () => _db().collection('pay_weeks');
  const stamp = () => _fb().firestore.FieldValue.serverTimestamp();
  const me = () => (typeof currentUser !== 'undefined' ? currentUser : null) || window.currentUser || null;
  const myName = () => (window.userProfile && window.userProfile.displayName) || (me() && me().email) || null;

  /** A machine-readable warning. The screen renders these; nothing here throws
   *  for something a human should merely SEE. */
  const warn = (code, message, extra) => Object.assign({ code, message }, extra || {});

  /**
   * This week's exclusion map. Returns null — NOT {} — when the run document
   * could not be READ, so the caller can tell "nobody is excluded" apart from
   * "I do not know who is excluded". Those are the same shape and opposite
   * meanings, and computing through a denial pays someone the week says to
   * skip. Same contract as window.periodExclusionsFor for the monthly run.
   */
  async function readRunDoc(weekId) {
    const snap = await RUNS().doc(weekId).get();
    return snap.exists ? (snap.data() || {}) : null;
  }

  const WeeklyRun = {

    // ── read ───────────────────────────────────────────────────────────────
    /**
     * The stored week, or null when nobody has computed it yet.
     * THROWS on a failed read. A denial must never arrive at a pay screen
     * dressed as an empty week — that is how a crew silently reads as "nobody
     * to pay".
     */
    async load(weekId) {
      const d = await readRunDoc(weekId);      // throws on denial, by design
      if (!d) return null;
      return {
        weekId: d.weekId || weekId,
        state: d.state || 'draft',
        lines: d.lines || [],
        skipped: d.skipped || [],
        totals: d.totals || null,
        excluded: d.excluded || {},
        adjustments: d.adjustments || {},
        receipts: d.receipts || {},
        warnings: d.warnings || [],
        computedAt: d.computedAt || null,
        computedBy: d.computedBy || null,
        computedByName: d.computedByName || null,
        verifiedAt: d.verifiedAt || null,
        verifiedBy: d.verifiedBy || null,
        disbursingAt: d.disbursingAt || null,
        disbursingBy: d.disbursingBy || null,
        disbursingByName: d.disbursingByName || null,
        disbursedAt: d.disbursedAt || null,
        disbursedBy: d.disbursedBy || null,
        failures: d.failures || []
      };
    },

    /**
     * LAST week's exclusions, so the screen can PRE-TICK them and Finance
     * confirms with one click (owner ruling 2026-08-10: an exclusion is scoped
     * to a period, never to the person). Deliberately a SUGGESTION and never
     * applied by compute() — pre-ticking is a default a human accepts, and an
     * engine that carried exclusions forward on its own would quietly rebuild
     * the permanent flag the ruling exists to kill.
     */
    async suggestedExclusions(weekId) {
      const prev = await readRunDoc(WRC.prevMonday(weekId));
      return (prev && prev.excluded) || {};
    },

    // ── build (read-only half, D2) ──────────────────────────────────────────
    /**
     * READ-ONLY line builder for a week. Reads worker_profiles, seven days of
     * attendance_worker per worker, this week's stored adjustments+exclusions,
     * and the monthly-paid guard; calls computeWeeklyLine once per worker.
     * WRITES NOTHING — compute() below calls this and then writes; the live
     * view (window.Payroll.preview) calls this and writes nothing at all
     * (PAYROLL-LIVE-SPEC §4.5, D1/D2).
     *
     * Week-id validation (Monday check) is duplicated in both this and
     * compute() deliberately — a projection is legal in any state, so the
     * STATE GATE stays in compute() only.
     *
     * @param weekId
     * @param prevDoc  optional PRE-READ run document (compute() passes its own
     *                 read to avoid a second one); when omitted, this reads it
     *                 itself — which is how preview() calls it bare.
     */
    async buildLines(weekId, prevDoc) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekId || ''))) throw new Error('A pay week is identified by its Monday, as YYYY-MM-DD.');
      if (window.payWeekMondayOf(weekId) !== weekId) throw new Error(`${weekId} is not a Monday — a pay week runs Monday to Sunday.`);

      let prev = prevDoc;
      if (prev === undefined) {
        try {
          prev = await readRunDoc(weekId);
        } catch (err) {
          throw new Error('Could not read this week\'s payroll exclusions — nothing was computed. ' + (err && err.message ? err.message : ''));
        }
      }
      const excluded = (prev && prev.excluded) || {};
      const adjustments = (prev && prev.adjustments) || {};

      const dates = window.payWeekDays(weekId);
      const month = window.payWeekMonth(weekId);
      const isLastPayWeek = WRC.isLastPayWeekOfMonth(weekId);
      const warnings = [];

      // Worker roster. A failed read aborts — an empty roster would read as
      // "nobody works here this week" and produce a ₱0 run that looks finished.
      const wpSnap = await _db().collection('worker_profiles').get();
      const profiles = wpSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

      // THE DOUBLE-PAY GUARD, from the weekly side. weeklyRunSkipReason skips
      // anyone the MONTHLY run actually paid for this week's month; the monthly
      // guard skips anyone with a linked worker profile. Both directions are
      // needed — a person can be mis-configured into either run and only one of
      // the two guards catches each case. A failed read aborts for the same
      // reason the exclusion read does: not knowing is not the same as nobody.
      const monthlyPaidUids = new Set();
      const runSnap = await _db().collection('pay_runs').doc(month).get();
      if (runSnap.exists) {
        const r = runSnap.data() || {};
        if (['verified', 'disbursing', 'disbursed'].includes(r.state)) {
          (r.lines || []).forEach((l) => { if (l && l.uid) monthlyPaidUids.add(l.uid); });
        }
      }

      const skipped = [];
      const payable = [];
      for (const p of profiles) {
        // The HR profile's own "include in payroll" switch. Not part of
        // weeklyRunSkipReason (that function is money-core's and pinned); an
        // explicit false is a human saying "not this person", and honouring it
        // here keeps the roster and the run agreeing about who is on payroll.
        if (p.includeInPayroll === false) { skipped.push({ workerId: p.id, name: p.name || p.id, reason: 'not-in-payroll' }); continue; }
        const reason = window.weeklyRunSkipReason(p, excluded, { monthlyPaidUids });
        if (reason) {
          skipped.push({ workerId: p.id, name: p.name || p.id, reason });
          // Money note 3 — a missing rate is not an administrative detail. Name
          // it loudly: the roster shows the DAILY rate, so the profile looks
          // correctly set up while the engine reads a rate of zero.
          if (reason === 'no-rate') {
            warnings.push(warn('no-rate', `${p.name || p.id} has no usable pay rate — set an hourly or daily rate on the profile, then recompute. They are NOT in this week's totals.`, { workerId: p.id }));
          }
          continue;
        }
        payable.push(p);
      }
      payable.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

      // Seven days of attendance per worker, concurrently. A per-worker read
      // failure does NOT abort the crew's pay — it removes that ONE worker from
      // the run with a named reason, because an unreadable week rendered as
      // zero hours is an unpaid week nobody would notice.
      const attendance = await Promise.all(payable.map(async (p) => {
        try {
          const snap = await _db().collection('attendance_worker').doc(p.id).collection('records')
            .where(_fb().firestore.FieldPath.documentId(), '>=', dates[0])
            .where(_fb().firestore.FieldPath.documentId(), '<=', dates[6])
            .get();
          const byDate = {};
          snap.docs.forEach((d) => { byDate[d.id] = Object.assign({ date: d.id }, d.data()); });
          return { ok: true, byDate };
        } catch (err) {
          return { ok: false, error: (err && err.message) || 'read failed' };
        }
      }));

      const lines = [];
      let otDoubleCountDays = 0;

      for (let i = 0; i < payable.length; i++) {
        const p = payable[i];
        const att = attendance[i];
        if (!att.ok) {
          skipped.push({ workerId: p.id, name: p.name || p.id, reason: 'attendance-unreadable' });
          warnings.push(warn('attendance-unreadable', `Could not read ${p.name || p.id}'s attendance for this week (${att.error}). They are NOT in this week's totals — retry before disbursing rather than paying them zero.`, { workerId: p.id }));
          continue;
        }

        const adj = WRC.mergeAdjustment(WRC.EMPTY_ADJUSTMENT, adjustments[p.id] || {});
        const built = WRC.buildWeekDays(dates, att.byDate, adj);

        built.flags.forEach((f) => {
          // `source !== 'override'` rather than "an override exists": a
          // reason-less one is refused by buildWeekDays, so a flagged day
          // carrying one is still unpaid and must still be surfaced.
          if (f.flagged && f.source !== 'override') {
            warnings.push(warn('needs-review', `${p.name || p.id} — ${f.date} is flagged (forgotten clock-out or an implausible shift) and is paid as ABSENT. Confirm the real hours and record an override with a reason if it should be paid.`, { workerId: p.id, date: f.date }));
          }
          if (f.overrideMissingReason) {
            warnings.push(warn('override-no-reason', `${p.name || p.id} — the override on ${f.date} has no reason, so it pays NOTHING. An override without a record is exactly what the ruling forbids; add a reason and recompute.`, { workerId: p.id, date: f.date }));
          }
          if (f.source === 'punch' && f.punchedHours > WRC.OT_THRESHOLD_HOURS) otDoubleCountDays++;
        });

        // STATUTORY — monthly obligation, collected on the month's last pay
        // week only, and only for a configured worker. The month's gross has to
        // include the weeks already paid, so the bracket is keyed on the real
        // monthly figure rather than on one week's pay.
        let statutory = WRC.resolveStatutoryWeekly(p, { isLastPayWeek, table: null });
        if (statutory.configured && isLastPayWeek) {
          const mtd = await weeklyMtdGross(p.id, weekId).catch((err) => ({ gross: 0, count: 0, failed: (err && err.message) || 'read failed' }));
          if (mtd.failed) {
            warnings.push(warn('statutory-mtd-unreadable', `${p.name || p.id} — could not read this month's earlier payslips, so the statutory bracket was keyed on THIS WEEK's pay alone and is probably too low. Verify before disbursing.`, { workerId: p.id }));
          }
          // Two passes: the bracket depends on the month's gross, which depends
          // on this week's gross, which does not depend on statutory (statutory
          // is a deduction). So compute the line once with no statutory to learn
          // the gross, then once more for real.
          const dry = window.computeWeeklyLine(WRC.workerPayInputs(p, adj, built.days, null), built.days);
          const monthGross = _r2((mtd.gross || 0) + dry.gross);
          const year = parseInt(String(weekId).slice(0, 4), 10);
          const table = window.computeStatutory ? window.computeStatutory({ grossPay: monthGross, year }) : null;
          statutory = WRC.resolveStatutoryWeekly(p, { isLastPayWeek, table });
          statutory.monthGross = monthGross;
          statutory.mtdGross = mtd.gross || 0;
          if (table && table.unverified) {
            warnings.push(warn('statutory-unverified', `The ${year} statutory table is UNVERIFIED placeholder rates — ${p.name || p.id}'s SSS/PhilHealth/Pag-IBIG amounts cannot be relied on until the accountant signs them off.`, { workerId: p.id }));
          }
        } else if (statutory.configured && !isLastPayWeek) {
          // Say so rather than leave a configured worker's zeros looking like a
          // bug: the brief asks the run to name anyone whose statutory setup it
          // is not honouring this week.
          warnings.push(warn('statutory-deferred', `${p.name || p.id} is configured for statutory deductions, which are collected once a month on the month's LAST pay week — nothing is deducted this week.`, { workerId: p.id }));
        }

        const w = WRC.workerPayInputs(p, adj, built.days, statutory);
        const line = window.computeWeeklyLine(w, built.days);

        // Additive fields on the frozen line. Every peso the screen shows is
        // read from HERE, never recomputed — so anything the screen needs that
        // computeWeeklyLine does not return has to be frozen alongside it.
        line.workerId = p.id;
        line.name = p.name || p.id;
        line.linkedUid = p.linkedUid || null;
        line.idNumber = p.idNumber || '';
        line.jobTitle = p.jobTitle || '';
        line.department = p.department || '';
        line.dailyRate = +p.dailyRate || 0;
        line.rateSource = window.resolveWorkerHourlyRate(p).source;
        line.statutory = statutory;
        // `otherDeductions` on the frozen line is the COMBINED figure the maths
        // used (see workerPayInputs). Keep the hand-typed half separately so the
        // payslip and the ledger can split "SSS" from "canteen".
        line.otherDeductionsOnly = _r2(Math.max(0, Number(adj.otherDeductions) || 0));
        line.caBalanceBefore = _r2(Math.max(0, Number(p.caBalance) || 0));
        line.caBalanceAfter = _r2(Math.max(0, line.caBalanceBefore - line.caDeduction));
        line.adjustment = adj;
        line.flags = built.flags;
        line.tinNum = p.tinNum || ''; line.ssNum = p.ssNum || '';
        line.phNum = p.phNum || ''; line.pagibigNum = p.pagibigNum || '';

        if (line.caShortfall > 0.01) {
          warnings.push(warn('ca-clamped', `${line.name}'s cash-advance instalment was clamped by ₱${line.caShortfall.toFixed(2)} so the week could not pay a negative net. The balance comes down by what was actually collected.`, { workerId: p.id }));
        }
        lines.push(line);
      }

      if (otDoubleCountDays > 0) {
        warnings.push(warn('ot-double-count', `${otDoubleCountDays} day(s) ran past ${WRC.OT_THRESHOLD_HOURS}h. Overtime is paid ON TOP of the full day's hours — a 10-hour day pays 12 hours — which is exactly what the one-worker payslip does today. Confirm with the owner before this becomes the weekly default for the whole crew.`));
      }

      return { lines, skipped, warnings };
    },

    // ── compute ────────────────────────────────────────────────────────────
    /**
     * Build the week and WRITE it. Reads worker_profiles + seven days of
     * attendance per worker, applies weeklyRunSkipReason, resolves every rate
     * through resolveWorkerHourlyRate, folds this week's adjustments in, and
     * calls computeWeeklyLine once per worker — all of that now lives in
     * buildLines() above (D2, PAYROLL-LIVE-SPEC §4.5); this method adds the
     * state gate and the write. Writes pay_weeks/{weekId} at state 'computed'.
     * Money-safe to re-run: it moves nothing.
     */
    async compute(weekId) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekId || ''))) throw new Error('A pay week is identified by its Monday, as YYYY-MM-DD.');
      if (window.payWeekMondayOf(weekId) !== weekId) throw new Error(`${weekId} is not a Monday — a pay week runs Monday to Sunday.`);

      // ONE read serves three jobs: the state gate, this week's exclusions, and
      // this week's adjustments. It is NOT wrapped in a catch — a failure here
      // must abort, because "I could not read who is excluded" is not the same
      // fact as "nobody is excluded" even though both are falsy. Passed on to
      // buildLines() below so it does not read the same document twice.
      let prev;
      try {
        prev = await readRunDoc(weekId);
      } catch (err) {
        throw new Error('Could not read this week\'s payroll exclusions — nothing was computed. ' + (err && err.message ? err.message : ''));
      }
      const state = (prev && prev.state) || 'draft';
      if (['verified', 'disbursing', 'disbursed'].includes(state)) {
        throw new Error(`This week is ${state} — the President must reopen it before it can be computed again.`);
      }

      const built = await this.buildLines(weekId, prev);
      const { lines, skipped, warnings } = built;

      const totals = {
        workerCount: lines.length,
        gross: _r2(lines.reduce((s, l) => s + l.gross, 0)),
        net: _r2(lines.reduce((s, l) => s + l.net, 0)),
        statutory: _r2(lines.reduce((s, l) => s + (l.statutory ? l.statutory.total : 0), 0)),
        otherDeductions: _r2(lines.reduce((s, l) => s + l.otherDeductionsOnly, 0)),
        cashAdvance: _r2(lines.reduce((s, l) => s + l.caDeduction, 0)),
        allowances: _r2(lines.reduce((s, l) => s + l.allowanceTotal, 0)),
        regHours: _r2(lines.reduce((s, l) => s + l.regHours, 0)),
        otHours: _r2(lines.reduce((s, l) => s + l.otHours, 0)),
        travelHours: _r2(lines.reduce((s, l) => s + l.travelHours, 0))
      };

      await RUNS().doc(weekId).set({
        weekId, state: 'computed', month: window.payWeekMonth(weekId), label: WRC.weekLabel(weekId),
        days: window.payWeekDays(weekId), isLastPayWeekOfMonth: WRC.isLastPayWeekOfMonth(weekId),
        lines, skipped, totals, warnings,
        computedAt: stamp(), computedBy: me() && me().uid, computedByName: myName()
      }, { merge: true });

      window.logAudit && window.logAudit('compute-payweek', 'pay_weeks', weekId, { workerCount: lines.length, net: totals.net });
      return { lines, skipped, totals, warnings };
    },

    // ── exclusion (PERIOD-SCOPED, never permanent) ──────────────────────────
    /**
     * Take someone off THIS WEEK's payroll, or put them back (reason = null).
     * Owner ruling 2026-08-10: "removing of certain members on payroll is
     * strictly applied on that payroll period only unless said member is
     * removed from system." The write touches ONLY excluded / excludedUpdatedAt
     * / excludedUpdatedBy and leaves the state alone — firestore.rules enforces
     * exactly that, so anything wider here is denied rather than half-applied.
     */
    async setExcluded(weekId, workerId, reasonOrNull) {
      if (!weekId || !workerId) throw new Error('setExcluded needs a week and a worker.');
      const FV = _fb().firestore.FieldValue;
      const value = reasonOrNull ? String(reasonOrNull) : FV.delete();
      const patch = {};
      patch[`excluded.${workerId}`] = value;
      patch.excludedUpdatedAt = stamp();
      patch.excludedUpdatedBy = (me() && me().uid) || null;

      const exists = await RUNS().doc(weekId).get().then((s) => s.exists);
      if (!exists) {
        // No run document yet. Rules allow a CREATE at 'draft', which is how an
        // exclusion can be pre-ticked for a week nobody has computed — the
        // ruling's "pre-tick into the next week" needs to work before Compute.
        // A delete on a doc that never existed is a no-op, so only a real
        // exclusion creates anything.
        if (!reasonOrNull) return;
        await RUNS().doc(weekId).set({
          weekId, state: 'draft', month: window.payWeekMonth(weekId),
          excluded: { [workerId]: String(reasonOrNull) },
          excludedUpdatedAt: stamp(), excludedUpdatedBy: (me() && me().uid) || null
        });
      } else {
        await RUNS().doc(weekId).update(patch);
      }
      window.logAudit && window.logAudit('payweek-exclusion', 'pay_weeks', weekId, { workerId, reason: reasonOrNull || null });
    },

    // ── adjustments (money note 2) ──────────────────────────────────────────
    /**
     * The three figures that exist NOWHERE else — rent allowance, other
     * deductions, the cash-advance instalment — plus travel hours and the
     * per-day overrides. A patch, merged onto whatever is already stored, so
     * editing one field cannot silently zero the other four.
     *
     * REQUIRES A COMPUTED WEEK. firestore.rules has no draft->draft path for
     * this (an adjustment write goes down the compute branch, which requires
     * the resulting state to be 'computed' or 'verified'), and semantically an
     * adjustment attaches to a line that does not exist until Compute has run.
     * Recompute afterwards — the adjustment is folded in BEFORE
     * computeWeeklyLine, so the frozen line carries it.
     */
    async setAdjustment(weekId, workerId, patch) {
      if (!weekId || !workerId) throw new Error('setAdjustment needs a week and a worker.');
      const d = await readRunDoc(weekId);
      if (!d) throw new Error('Compute this week first — an adjustment attaches to a computed line.');
      if (d.state !== 'computed') {
        throw new Error(d.state === 'draft'
          ? 'Compute this week first — an adjustment attaches to a computed line.'
          : `This week is ${d.state} — adjustments are only editable while it is computed.`);
      }
      const prevAdj = (d.adjustments || {})[workerId] || WRC.EMPTY_ADJUSTMENT;
      // Stamp WHO and WHEN onto every override this patch introduces. Owner
      // ruling 2: an override is only an override when it is recorded, and
      // computeWeeklyLine refuses a reason-less one outright — so the reason
      // comes from the screen and the identity comes from here, where it cannot
      // be typed in wrong.
      //
      // `at` is an INSTANT, not a business date: bizDate() answers "which Manila
      // day is it", which is not the question an audit stamp asks. A nested
      // serverTimestamp inside a map is avoided so the merge below stays a plain
      // value comparison.
      const now = new Date().toISOString();
      const p = Object.assign({}, patch || {});
      if (p.overrides && typeof p.overrides === 'object') {
        const stamped = {};
        Object.keys(p.overrides).forEach((date) => {
          const e = p.overrides[date];
          stamped[date] = e ? Object.assign({}, e, { by: (me() && me().uid) || '', at: now }) : e;
        });
        p.overrides = stamped;
      }
      const merged = WRC.mergeAdjustment(prevAdj, p);

      const write = { state: 'computed', adjustmentsUpdatedAt: stamp(), adjustmentsUpdatedBy: (me() && me().uid) || null };
      write[`adjustments.${workerId}`] = merged;
      await RUNS().doc(weekId).update(write);
      window.logAudit && window.logAudit('payweek-adjustment', 'pay_weeks', weekId, { workerId, patch: p });
      return merged;
    },

    // ── verify ─────────────────────────────────────────────────────────────
    /**
     * @param extra  optional plain object of ADDITIONAL fields merged into the
     *   SAME computed -> verified write (e.g. `earlyReleaseOverride` — the
     *   owner's Finance-approved exception to the period-end gate,
     *   js/payroll.js's markHoursCorrect). Defaults to nothing, so every
     *   existing caller is unaffected. Rides in this SAME write deliberately:
     *   firestore.rules admits arbitrary extra fields on the computed->verified
     *   transition and nothing wider — a second write after the doc already
     *   reads 'verified' would be denied.
     */
    async verify(weekId, extra) {
      const d = await readRunDoc(weekId);
      if (!d) throw new Error('There is nothing to verify — compute this week first.');
      if (d.state !== 'computed') throw new Error(`Only a computed week can be verified (this one is ${d.state || 'draft'}).`);
      if (!(d.lines || []).length) throw new Error('This week has no computed lines — there is nothing to verify.');
      const patch = Object.assign({
        state: 'verified', verifiedAt: stamp(),
        verifiedBy: (me() && me().uid) || null, verifiedByName: myName()
      }, extra || {});
      await RUNS().doc(weekId).update(patch);
      window.logAudit && window.logAudit('verify-payweek', 'pay_weeks', weekId, { workerCount: (d.lines || []).length });
    },

    // ── disburse ───────────────────────────────────────────────────────────
    /**
     * ONE PRESS PAYS THE WEEK. Modelled on window.disbursePayRun, with the same
     * shape and the same reasoning:
     *
     *   1. A transactional lock verified -> disbursing. The transaction IS the
     *      lock: a second press re-reads inside its own transaction, sees
     *      'disbursing' and stops before any money write. Finance may release a
     *      verified week (owner ruling) — the President need not be present.
     *   2. Every write below is addressed by a DETERMINISTIC per-week ref, so
     *      resuming a half-finished disburse overwrites the same rows instead of
     *      booking the money twice.
     *   3. Each cash advance is collected ONCE, guarded by a per-week key held
     *      in the SAME transaction that decrements the balance (see collectCa).
     *   4. ONE RECEIPT PER WORKER (owner ruling 2026-08-10) — refused up front,
     *      before a single write, when any paid worker has none.
     *   5. Anything that throws leaves the week in 'disbursing' with a
     *      `failures` list naming the worker and the peso amount. A human can
     *      see it and press again; the deterministic refs make the retry a
     *      no-op for everything that already landed. Never a half-paid week
     *      with no record.
     *
     * @param receiptsByWorkerId { [workerId]: {url, name} }
     * @param opts { bankAccount }  optional — tags the Cash leg for bank rec.
     */
    async disburse(weekId, receiptsByWorkerId, opts) {
      const receipts = receiptsByWorkerId || {};
      const o = opts || {};
      const bankAcct = o.bankAccount || { bankAccountId: null, bankAccountName: null };
      const runRef = RUNS().doc(weekId);
      const label = WRC.weekLabel(weekId);
      const dates = window.payWeekDays(weekId);
      const payDate = dates[6];

      // ── PRE-FLIGHT, all of it before any write ──────────────────────────
      const pre = await readRunDoc(weekId);
      if (!pre) throw new Error('There is no run for this week.');
      // ⚠ RE-FILTER AGAINST THIS WEEK'S EXCLUSIONS, at both gates.
      // The lines were FROZEN at Compute. firestore.rules deliberately permits
      // an exclusion write while the week is 'verified' (the exclusion branch
      // admits draft/computed/verified), so this sequence is legal and was
      // silently wrong:
      //     Compute -> Verify -> setExcluded(worker) -> disburse
      // The worker had a frozen line, so they got a payslip, their cash advance
      // was collected, their expense leg posted and their receipt demanded —
      // the removal the owner ruling exists to honour ignored entirely, because
      // nothing between Compute and payment ever re-read `excluded`.
      // Caught in review before this shipped.
      const _excl = (pre && pre.excluded) || {};
      const _isExcluded = (id) => {
        const e = (typeof _excl.get === 'function') ? _excl.get(id) : _excl[id];
        return !!e;
      };
      const preLines = (pre.lines || []).filter((l) => l && l.workerId && !_isExcluded(l.workerId));
      if (!preLines.length) throw new Error('This week has no computed lines — there is nothing to disburse.');

      // ONE RECEIPT PER WORKER, not one for the batch. Refused here rather than
      // half-way through, so nobody is paid before the refusal is discovered.
      const missing = preLines.filter((l) => l.net > 0 && !(receipts[l.workerId] && receipts[l.workerId].url));
      if (missing.length) {
        throw new Error(`Every paid worker needs their own transfer receipt before this week can be released. Missing: ${missing.map((l) => l.name).join(', ')}.`);
      }

      // The PREDICTABLE cash-advance shortfall, caught before any write. The
      // instalment is clamped at Compute against the week's PAY (money-core's
      // own clamp), never against the worker's outstanding BALANCE — so a
      // ₱2,000 instalment against a ₱500 balance passes Compute happily and
      // then takes ₱2,000 out of a worker's pay to retire a ₱500 debt. Both
      // figures are frozen on the line, so this is decidable here, before
      // anyone is paid. (The residual case — the balance moving between Compute
      // and Disburse — is caught mid-release by collectCa and needs a human.)
      const overCollect = preLines.filter((l) => (l.caDeduction || 0) > (l.caBalanceBefore || 0) + 0.01);
      if (overCollect.length) {
        throw new Error(`These cash-advance instalments are larger than the worker's outstanding balance, so this week would collect more than is owed: ${overCollect.map((l) => `${l.name} (₱${(l.caDeduction || 0).toFixed(2)} vs ₱${(l.caBalanceBefore || 0).toFixed(2)} owed)`).join(', ')}. Fix the instalment in Adjust, recompute, then release.`);
      }

      // The statutory gate, ported from disbursePayRun's D10 — but conditional,
      // because production staff are overwhelmingly unconfigured and a blanket
      // block would stop every ordinary week over rates nobody is using. It
      // bites exactly when the run actually carries a statutory amount computed
      // off a placeholder table, which is when a wrong figure would be remitted.
      const statTotal = preLines.reduce((s, l) => s + ((l.statutory && l.statutory.total) || 0), 0);
      if (statTotal > 0) {
        const year = String(weekId).slice(0, 4);
        const table = window.STATUTORY && window.STATUTORY[year];
        if (!table || table.verified !== true) {
          throw new Error(`This week deducts ₱${statTotal.toFixed(2)} of SSS/PhilHealth/Pag-IBIG, but the ${year} statutory tables are unverified placeholder rates. Load the accountant-verified tables before disbursing.`);
        }
      }

      // A closed accounting period cannot be disbursed into (v12 WS12).
      if (typeof window.assertPeriodOpen === 'function') await window.assertPeriodOpen(payDate);

      // ── 1. THE LOCK ─────────────────────────────────────────────────────
      const uid = (me() && me().uid) || null;
      const run = await _db().runTransaction(async (tx) => {
        const snap = await tx.get(runRef);
        if (!snap.exists) throw new Error('There is no run for this week.');
        const d = snap.data();
        if (d.state === 'verified') {
          tx.update(runRef, {
            state: 'disbursing', disbursingAt: stamp(),
            disbursingBy: uid, disbursingByName: myName()
          });
          return d;
        }
        if (d.state === 'disbursing') {
          // Resumable by whoever locked it, or by the President. The
          // deterministic refs below make the resume idempotent.
          const isLocker = d.disbursingBy === uid;
          const isPres = typeof window.isRealPresident === 'function' && window.isRealPresident();
          if (isLocker || isPres) return d;
          throw new Error(`This week is locked mid-release (started by ${d.disbursingByName || d.disbursingBy || 'another session'}). Ask the President to reopen it after checking what landed.`);
        }
        throw new Error(`This week is not verified (currently: ${d.state || 'draft'}).`);
      });

      // Re-read from the LOCKED document, not from `pre` — an exclusion written
      // between the pre-flight and the lock must still be honoured, and this is
      // the copy the transaction actually committed against.
      const _lockExcl = (run && run.excluded) || {};
      const _lockExcluded = (id) => {
        const e = (typeof _lockExcl.get === 'function') ? _lockExcl.get(id) : _lockExcl[id];
        return !!e;
      };
      const lines = (run.lines || []).filter((l) => l && l.workerId && !_lockExcluded(l.workerId));
      const failures = [];
      const ledgerRefs = [];
      const paid = [];

      // ── 2. PER WORKER: payslip, cash advance, expense leg, receipt ───────
      for (const line of lines) {
        try {
          const receipt = receipts[line.workerId] || null;
          await writeWeekPayslip(weekId, line, { label, payDate, dates, receipt });
          const collected = await collectCa(weekId, line);
          if (collected.shortfall > 0.01) {
            failures.push({ workerId: line.workerId, name: line.name, kind: 'ca-shortfall', amount: collected.shortfall,
              message: `${line.name}'s cash-advance balance moved between Compute and Release: only ₱${collected.collected.toFixed(2)} of the ₱${line.caDeduction.toFixed(2)} taken out of their pay could be applied to the debt, leaving ₱${collected.shortfall.toFixed(2)} unaccounted for. The President can reopen this week; fix the instalment in Adjust, recompute, and release again.` });
          }
          // A worker who was absent all week has a ₱0 line. Record the payslip
          // (they are entitled to see the zero and why) but post no ledger row —
          // an all-absent crew must not accrue junk ₱0.00 debits forever.
          if (_r2(line.gross) > 0) {
            const ref = WRC.ledgerRef('expense', weekId, line.workerId);
            await postLeg(ref, {
              date: payDate, kind: 'debit', accountType: 'expense', account: 'Payroll Expense',
              category: 'Payroll Expense', description: `Weekly pay — ${line.name} (${label})`,
              amount: line.gross
            });
            ledgerRefs.push(ref);
          }
          paid.push({ workerId: line.workerId, name: line.name, net: line.net, receiptUrl: (receipt && receipt.url) || '' });
        } catch (err) {
          // Named, kept, and NOT swallowed — the week stays in 'disbursing' at
          // the end of this function so a human sees exactly who did not land.
          failures.push({ workerId: line.workerId, name: line.name, kind: 'worker', amount: line.net,
            message: `${line.name} (₱${line.net.toFixed(2)}): ${(err && err.message) || 'failed'}` });
        }
      }

      // ── 3. THE BALANCING LEGS ───────────────────────────────────────────
      // Debits == credits, per the same identity the monthly run keeps:
      //   Σ gross  ==  Σ statutory + Σ other deductions + Σ CA + Σ net cash
      // (net is gross minus all three by construction — see workerPayInputs for
      // why statutory rides inside `deductions` in the frozen line.)
      //
      // The employer share is deliberately NOT booked: the weekly ledger posts
      // no employer expense (v12 WS24 decision 3, unchanged). It is carried on
      // the payslip for BIR 1601-C and nothing else.
      const agg = { sss: 0, philhealth: 0, pagibig: 0, tax: 0, other: 0, ca: 0, net: 0 };
      lines.forEach((l) => {
        const st = l.statutory || {};
        agg.sss += st.sss || 0; agg.philhealth += st.philhealth || 0;
        agg.pagibig += st.pagibig || 0; agg.tax += st.tax || 0;
        agg.other += l.otherDeductionsOnly || 0;
        agg.ca += l.caDeduction || 0;
        agg.net += l.net || 0;
      });

      const credits = [
        ['sss', 'liability', 'SSS Payable', 'SSS Payable', agg.sss],
        ['philhealth', 'liability', 'PhilHealth Payable', 'PhilHealth Payable', agg.philhealth],
        ['pagibig', 'liability', 'Pag-IBIG Payable', 'Pag-IBIG Payable', agg.pagibig],
        ['tax', 'liability', 'Withholding Tax Payable', 'Withholding Tax Payable', agg.tax],
        // Withheld employee money (cash bond, canteen, uniform) is a LIABILITY,
        // not a bank movement — the cash is still in the account until it is
        // handed on, which is why this leg carries no bank tag.
        ['deductions', 'liability', 'Employee Deductions Payable', 'Employee Deductions Payable', agg.other],
        // Credits the SAME asset account a cash advance debits on release, or
        // the receivable never comes back down and Total Assets grows forever
        // by every advance ever given. worker_profiles advances carry no
        // interest model (a plain caBalance, not a cash_advances doc), so the
        // whole instalment is principal — nothing to split off as income.
        ['cashAdvance', 'asset', 'Advances to Employees', 'Cash Advance', agg.ca]
      ];
      for (const [kind, accountType, account, category, amount] of credits) {
        if (_r2(amount) <= 0) continue;      // never post a brand-new ₱0.00 row
        const ref = WRC.ledgerRef(kind, weekId);
        try {
          await postLeg(ref, { date: payDate, kind: 'credit', accountType, account, category,
            description: `${account} — ${label} weekly payroll`, amount: _r2(amount) });
          ledgerRefs.push(ref);
        } catch (err) {
          failures.push({ kind: 'ledger', ref, amount: _r2(amount), message: `Ledger leg ${ref} failed: ${(err && err.message) || 'failed'}` });
        }
      }
      if (_r2(agg.net) > 0) {
        const ref = WRC.ledgerRef('net', weekId);
        try {
          await postLeg(ref, { date: payDate, kind: 'credit', accountType: 'asset', account: 'Cash',
            category: 'Payroll Expense', description: `Net weekly payroll cash — ${label}`,
            amount: _r2(agg.net), extra: (window.BankAccounts ? window.BankAccounts.tag(bankAcct, 'out') : {}) });
          ledgerRefs.push(ref);
        } catch (err) {
          failures.push({ kind: 'ledger', ref, amount: _r2(agg.net), message: `Ledger leg ${ref} failed: ${(err && err.message) || 'failed'}` });
        }
      }
      if (typeof window.dbCacheInvalidate === 'function') window.dbCacheInvalidate('ledger');

      // ── 4. STOP HERE IF ANYTHING FAILED ─────────────────────────────────
      // The week stays 'disbursing' with the failures recorded on it. That is a
      // state a human can SEE and retry — the alternative (flip to 'disbursed'
      // anyway) is a week the system believes is finished while somebody was
      // never paid.
      if (failures.length) {
        // THREE PLACES, because the first one can legitimately be refused.
        // firestore.rules only lets a pay_weeks update through when the state
        // MOVES (or when it touches the exclusion keys alone), so writing
        // progress onto the run document while it sits at 'disbursing' is
        // denied — see the handoff note. The audit log and the Finance
        // notification are not, and between them the failure is never invisible.
        await runRef.update({ failures, failedAt: stamp() }).catch(() => {});
        window.logAudit && window.logAudit('payweek-partial-release', 'pay_weeks', weekId, { failures });
        try {
          await window.Notifs.sendToDept('Finance', {
            title: 'Weekly payroll only part-released',
            body: `${label}: ${failures.length} problem(s) — ${failures.map((f) => f.message).join(' | ')}`,
            icon: '⚠️', type: 'payroll'
          }, { fallbackToOwner: true });
        } catch (_) { /* best-effort — the throw below is the primary signal */ }
        throw new Error(`This week is only part-released — ${failures.length} problem(s), and nothing has been marked disbursed. ${failures.map((f) => f.message).join(' | ')}`);
      }

      // ── 5. NOTIFY (best-effort — money has already moved) ────────────────
      // Plain text only: emojiIcon() returns MARKUP and a notification title is
      // a plain-text sink; putting markup in one shows the user raw code.
      try {
        await Promise.all(lines.filter((l) => l.linkedUid).map((l) => window.Notifs.send(l.linkedUid, {
          title: '💰 Weekly pay released',
          body: `Your pay for ${label} — ₱${_r2(l.net).toFixed(2)} — has been released. Tap to view your payslip.`,
          icon: '💰', type: 'payroll', link: 'personal-finance',
          dedupKey: `payweek-disbursed-${l.workerId}-${weekId}`
        })));
      } catch (notifyErr) {
        console.error('WeeklyRun.disburse: worker notify failed (money already moved, release continues)', notifyErr);
      }

      // ── 6. TERMINAL ─────────────────────────────────────────────────────
      const FV = _fb().firestore.FieldValue;
      await runRef.update({
        state: 'disbursed', disbursedAt: stamp(), disbursedBy: uid, disbursedByName: myName(),
        disbursedFrom: bankAcct.bankAccountId || null, disbursedFromName: bankAcct.bankAccountName || null,
        receipts, ledgerRefs, failures: [],
        disbursingAt: FV.delete(), disbursingBy: FV.delete(), disbursingByName: FV.delete()
      });
      window.logAudit && window.logAudit('disburse-payweek', 'pay_weeks', weekId, { workerCount: lines.length, net: _r2(agg.net) });
      return { paid, ledgerRefs };
    },

    // ── labels & navigation ────────────────────────────────────────────────
    weekLabel(weekId) { return WRC.weekLabel(weekId); },

    /** The last `n` pay weeks, newest first, Mondays only. Anchored on the
     *  Manila business date — a raw toISOString() is UTC and lands on the wrong
     *  day for the first eight hours of every Manila day. */
    recentWeeks(n) {
      const today = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10);
      let m = window.payWeekMondayOf(today);
      const out = [];
      const count = Math.max(1, Math.min(104, parseInt(n, 10) || 1));
      for (let i = 0; i < count; i++) { out.push(m); m = WRC.prevMonday(m); }
      return out;
    }
  };

  // ═════════════════════════════════════════════════════════
  //  private helpers — Firestore-touching, used only by the run above
  // ═════════════════════════════════════════════════════════

  /**
   * This worker's already-paid gross for the MONTH the week belongs to.
   * Bounded in payPeriodStart space on BOTH ends, the same field the query
   * filters on — mixing start-space and end-space lost whole weeks out of 8 of
   * the 12 months of 2026 (js/screens/hr.js's loadMtd carries the full proof).
   * The upper bound is this week's Monday and is EXCLUSIVE, so re-running a
   * week that was already paid cannot count its own gross twice and jump a
   * bracket.
   */
  async function weeklyMtdGross(workerId, weekId) {
    const monthStart = window.payWeekMonth(weekId) + '-01';
    const snap = await _db().collection('payslips')
      .where('workerId', '==', workerId)
      .where('payPeriodStart', '>=', monthStart)
      .where('payPeriodStart', '<', weekId)
      .get();
    return { gross: _r2(snap.docs.reduce((s, d) => s + ((d.data() || {}).grossPay || 0), 0)), count: snap.docs.length };
  }

  /**
   * The worker's payslip for this week, in the SAME shape the one-worker
   * generator writes (js/screens/hr.js's collectPayslipData) so
   * window.toPayslipModel(doc, 'weekly') renders it unchanged.
   *
   * MONEY NOTE 4 — WHY status IS 'submitted' ON ARRIVAL. The weekly payslip's
   * own ledger post fires on the Submit transition in openPayslipHistory
   * (ref `WPAY-{id}`, amount netPay). Disburse has already booked this week
   * properly, per worker, against PAYW-{week}-{worker}; letting Submit fire as
   * well would book the same money twice. The Submit button only renders for a
   * payslip that HAS a next stage, and 'submitted' is the last one — so it
   * cannot be pressed. `postedByRun` + `ledgerRef` say so explicitly for
   * anything that reads the doc later.
   */
  async function writeWeekPayslip(weekId, line, ctx) {
    const st = line.statutory || { sss: 0, philhealth: 0, pagibig: 0, tax: 0, total: 0, er: null };
    const govTotal = _r2((st.sss || 0) + (st.philhealth || 0) + (st.pagibig || 0));
    const otherTotal = _r2((line.caDeduction || 0) + (line.otherDeductionsOnly || 0) + (st.tax || 0));
    const doc = {
      workerId: line.workerId, workerName: line.name,
      workerIdNum: line.idNumber || '', jobTitle: line.jobTitle || '', department: line.department || '',
      tinNum: line.tinNum || '', ssNum: line.ssNum || '', phNum: line.phNum || '', pagibigNum: line.pagibigNum || '',
      payPeriodStart: ctx.dates[0], payPeriodEnd: ctx.dates[6],
      payPeriodMonth: window.payWeekMonth(weekId),
      payDate: ctx.payDate, company: 'Barro Kitchens',
      preparedBy: myName() || '',
      regular: { dailyRate: line.dailyRate || 0, ratePerHr: line.rate, hrsWorked: line.regHours, total: line.regularPay },
      overtime: { ratePerHr: line.rate, hours: line.otHours, total: line.otPay },
      // Travel is a weekly-run component the one-worker form has no field for.
      // Carried here so the figure is never lost; see the handoff note — the
      // printed template needs a row for it or gross will not visibly reconcile
      // on a week with travel.
      travel: { ratePerHr: line.travelRate, hours: line.travelHours, total: line.travelPay },
      allowances: Object.assign({}, line.allowances, { total: line.allowanceTotal }),
      grossPay: line.gross,
      deductions: {
        govt: { sss: st.sss || 0, philhealth: st.philhealth || 0, pagibig: st.pagibig || 0, total: govTotal },
        other: { cashAdvance: line.caDeduction, loans: line.otherDeductionsOnly, taxes: st.tax || 0, total: otherTotal }
      },
      employerShare: st.er || null,
      caBalanceBefore: line.caBalanceBefore, caBalanceAfter: line.caBalanceAfter,
      totalDeductions: line.deductionTotal, totalPay: line.net, paid: 0, netPay: line.net,
      schedule: (line.rows || []).map((r) => ({ day: r.day, date: r.date, hours: r.hours, otHours: r.otHours, travelHours: r.travelHours, absent: r.absent, override: r.override, source: 'weekly-run' })),
      proofUrl: (ctx.receipt && ctx.receipt.url) || '',
      proofName: (ctx.receipt && ctx.receipt.name) || '',
      // Provenance — the fields that keep money note 4 shut.
      // ⚠ payWeekId IS THE MARKER OF RECORD. window.isRunGeneratedPayslip
      // (js/screens/hr.js) reads payWeekId / weekId / payRunId / source /
      // generatedBy — and NOTHING else. This doc previously stamped only
      // `payWeek` and `postedByRun`, neither of which that predicate looks at,
      // so the guard returned false for every payslip this run produced and was
      // dead code. Consequence, caught in review before shipping: an admin who
      // set a run payslip back to 'filed' got the Submit button again, and
      // submitting posted a SECOND Payroll Expense under WPAY-WK-… on top of
      // this run's PAYW-… . Different refs, so upsertByRef's idempotence cannot
      // catch it — the same wage lands in the books twice.
      // `payWeek` is kept alongside for anything already reading it.
      status: 'submitted', postedByRun: true, payWeekId: weekId, payWeek: weekId,
      source: 'weekly-run',
      ledgerRef: WRC.ledgerRef('expense', weekId, line.workerId),
      createdBy: (me() && me().uid) || null,
      updatedAt: stamp()
    };
    const ref = _db().collection('payslips').doc(WRC.payslipId(weekId, line.workerId));
    const existing = await ref.get();
    if (!existing.exists) doc.createdAt = stamp();
    await ref.set(doc, { merge: true });
    return ref.id;
  }

  /**
   * Collect this week's cash-advance instalment — EXACTLY ONCE.
   *
   * WHY THIS DOES NOT CALL CashAdvance.deductWorker. That helper is a bare
   * transactional decrement with no idempotency key of its own, so a resumed
   * disburse would decrement a second time and wipe part of a worker's debt
   * that was never repaid. This does the identical clamped decrement, but reads
   * the per-week marker on the PAYSLIP and writes the marker and the new
   * balance in ONE transaction across the two documents — so the collection and
   * the record of it can never disagree, in either direction. The audit event
   * is the same one deductWorker files, so the audit trail is unbroken.
   *
   * The payslip is the marker's home on purpose: firestore.rules only lets a
   * pay_weeks update through when the state MOVES (or when it touches the
   * exclusion keys alone), so progress cannot be written onto the run document
   * mid-release, and rules do not cascade to subcollections.
   */
  async function collectCa(weekId, line) {
    const amount = _r2(line.caDeduction || 0);
    if (amount <= 0) return { collected: 0, shortfall: 0, skipped: true };
    const psRef = _db().collection('payslips').doc(WRC.payslipId(weekId, line.workerId));
    const wpRef = _db().collection('worker_profiles').doc(line.workerId);
    let result = { collected: 0, shortfall: 0, alreadyCollected: false };

    await _db().runTransaction(async (tx) => {
      const [ps, wp] = await Promise.all([tx.get(psRef), tx.get(wpRef)]);
      const psd = ps.exists ? (ps.data() || {}) : {};
      if (psd.caCollectedWeek === weekId) {
        // Already collected on an earlier pass over this same week. Report what
        // was collected then — never collect it again.
        result = { collected: psd.caCollected || 0, shortfall: _r2(amount - (psd.caCollected || 0)), alreadyCollected: true };
        return;
      }
      if (!wp.exists) throw new Error('Worker profile not found — cash advance not collected.');
      const before = _r2((wp.data() || {}).caBalance || 0);
      const collected = _r2(Math.min(before, amount));   // never drive a balance negative
      const after = _r2(before - collected);
      tx.update(wpRef, { caBalance: after });
      tx.set(psRef, {
        caCollectedWeek: weekId, caCollected: collected,
        caBalanceBefore: before, caBalanceAfter: after, caCollectedAt: stamp()
      }, { merge: true });
      result = { collected, shortfall: _r2(amount - collected), alreadyCollected: false };
    });

    if (!result.alreadyCollected) {
      window.logAudit && window.logAudit('worker-ca-deduct', 'worker_profiles', line.workerId,
        { amount: result.collected, reason: 'weekly-run', weekId });
    }
    return result;
  }

  /** One ledger leg, through the single idempotent poster. Ledger.upsertByRef
   *  is a transactional read-modify-write on a deterministic id, so re-posting
   *  the same ref updates the row rather than adding a second one. */
  async function postLeg(ref, entry) {
    await window.Ledger.upsertByRef(ref, () => ({
      ref, date: entry.date, kind: entry.kind, accountType: entry.accountType,
      account: entry.account, category: entry.category, description: entry.description,
      amount: entry.amount, source: 'Finance', extra: entry.extra || {}
    }));
  }

  window.WeeklyRun = WeeklyRun;

  // Node-only export of the PURE half, for tests/weekly-engine.test.mjs. The
  // Firestore-touching half is deliberately not exported: it cannot run without
  // a database and pretending otherwise would test a mock, not this code.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign({}, WRC, {
      WeeklyRunCore: WRC,
      weekLabel: WRC.weekLabel
    });
  }
})();
