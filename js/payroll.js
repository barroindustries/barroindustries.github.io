// ═══════════════════════════════════════════════════════════
//  js/payroll.js — window.Payroll, THE ONE PAYROLL.
//
//  THE ENGINE ONLY. No DOM, ever. The screen calls the methods on
//  window.Payroll and reads every peso off the STORED, normalised line — it
//  never recomputes and it never asks which team a person is on.
//
//  ── WHAT THIS IS ──────────────────────────────────────────────────────────
//  A UNIFYING LAYER, not a rewrite. The owner's keystone ruling
//  (PAYROLL-REDESIGN-BRIEF.md):
//
//     "unify it as well, treat disbursement of office and operations the same,
//      the difference is just the system of computing their pay"
//
//  So: ONE run concept, ONE roster, ONE release, ONE payslip pipeline, ONE
//  ledger posting. `payClass` selects a COMPUTE STRATEGY for a line and nothing
//  else. Everything below the number is identical for both teams.
//
//  A period is a MONTH ('YYYY-MM') or a WEEK ('YYYY-MM-DD', always a Monday).
//  Storage is UNCHANGED — pay_runs/{month} and pay_weeks/{monday} — because a
//  migration of live pay records is a money event nobody asked for. This file
//  reads and writes those two documents and normalises them into the one shape
//  the contract declares.
//
//  ── WHAT IT REUSES AND MUST NOT REBUILD ───────────────────────────────────
//  js/money-core.js is FROZEN (257 pinned tests): computePayLine,
//  computeWeeklyLine, resolveWorkerHourlyRate, weeklyRunSkipReason,
//  monthlyRunSkipReason, payWeekMondayOf / payWeekDays / payWeekMonth.
//  THE MATHS IS NOT WHAT IS WRONG. Nothing here recomputes a peso from source
//  data; it delegates:
//     month  ->  window.computePayRun / window.disbursePayRun (departments.js)
//     week   ->  window.WeeklyRun.compute / .disburse         (payroll-weekly.js)
//  and then folds the two results into one shape.
//
//  ── THE FIVE THINGS IN HERE THAT ARE GENUINELY NEW ────────────────────────
//  1. ONE NORMALISED LINE (PayrollCore.normalizeLine). Same keys, same order,
//     same `breakdown` array for both teams, so a phone card can print every
//     figure without a single branch on payClass. The brief forbids hiding a
//     deduction behind a tap; a card can only avoid that if the data arrives
//     flat and complete.
//  2. ONE-OFF AMOUNTS (addOneOff / PayrollCore.applyOneOffs). A named extra
//     earning or deduction on ONE line for ONE period, folded into the line
//     BEFORE it is frozen so the ledger, the payslip and the totals all carry
//     it without anything downstream remembering to add it back. The fold keeps
//     the debits==credits identity of BOTH engines — see applyOneOffs.
//  3. CORRECT AFTER PAYING (correctAfterPay). An OFFSETTING ledger entry for
//     ONE person, never a delete, modelled on the cash-advance repayment
//     pattern in js/config.js. Everyone else's line is untouched.
//  4. REOPEN THAT WORKS FOR BOTH KINDS. window.reopenPayRun is hardcoded to
//     db.collection('pay_runs'), so a checked WEEK has never been reopenable —
//     while the weekly screen told people the President could do it from "the
//     monthly tooling". That sentence was false. reopen() below is the truth.
//  5. THE HANDOFF SIGNALS. markHoursCorrect notifies Finance; pay notifies HR.
//     Today the only payroll notifications in the app fire AFTER money has
//     already moved: fifty-two handoffs a year and not one signal before one.
//
//  ── THE HOUSE HAZARDS THIS FILE IS WRITTEN AGAINST ────────────────────────
//  • A DENIED READ MUST NEVER RENDER AS AN EMPTY ROSTER. load() THROWS on a
//    failed read and returns null ONLY for "nobody has started this period".
//    Those are the same shape and opposite meanings, and on a pay run an empty
//    list is indistinguishable from "nobody is owed anything".
//  • RE-READ THE PERIOD'S HOLDS AT PAY TIME. Lines are frozen at prepare and do
//    not know about someone held back afterwards. Both underlying engines now
//    re-filter; pay() re-reads as well, before the receipt check, so a held
//    person is never asked for a receipt and never paid.
//  • DETERMINISTIC REFS. Every ledger leg this file posts is addressed by a ref
//    derived only from (period, person, correction number), through
//    Ledger.upsertByRef — a transactional read-modify-write on a deterministic
//    id. A second press overwrites the same row instead of paying twice.
//  • PLAIN EMOJI IN EVERY TEXT SINK. emojiIcon() returns MARKUP; a notification
//    title/body is plain text, and markup in one shows the user raw code.
//  • NEVER EMIT A ZERO OR NEGATIVE LINE SILENTLY. prepare() warns, pay()
//    refuses. A silent zero inside a batch of thirty is invisible.
//
//  ── VOCABULARY (owner ruling) ─────────────────────────────────────────────
//  The words compute, verify, disburse, delta and reconciliation MUST NOT
//  appear in any user-visible string this file produces. They survive only as
//  the names of the OLD functions being called and the OLD state strings stored
//  in Firestore, neither of which a person ever sees. The four states a person
//  sees are exactly:
//     'notstarted' -> "Not started"
//     'prepared'   -> "Ready to check"
//     'checked'    -> "Checked - waiting for payment"
//     'paid'       -> "Paid"
// ═══════════════════════════════════════════════════════════

// UMD-ish shim, same convention as js/money-core.js and js/payroll-weekly.js:
// makes `window` exist under plain Node so tests can require() the pure half of
// this file with no build step and no global stubbing. No-op in the browser.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

(function () {
  'use strict';

  const r2 = (n) => Math.round(((+n || 0) + Number.EPSILON) * 100) / 100;

  // ═════════════════════════════════════════════════════════
  //  PURE CORE — window.PayrollCore
  //  Zero Firestore, zero DOM, zero wall-clock. Every decision that can cost
  //  money and can be decided without the database lives here, so
  //  tests/payroll-unified.test.mjs can pin it.
  // ═════════════════════════════════════════════════════════
  const PC = {};

  PC.MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  PC.MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * Peso text. Deliberately hand-rolled rather than Intl/toLocaleString: this
   * file's pure half must give the same answer on every machine and in every
   * test runner, and Intl's grouping and currency symbol are locale-dependent.
   * Same reasoning money-core.js gives for never building a Date in pure code.
   */
  function peso(n) {
    const v = r2(+n || 0);
    const neg = v < 0;
    const s = Math.abs(v).toFixed(2);
    const dot = s.indexOf('.');
    const whole = s.slice(0, dot).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + '₱' + whole + s.slice(dot);
  }
  PC.peso = peso;

  // ── the period ───────────────────────────────────────────────────────────

  /**
   * 'YYYY-MM' is a month; 'YYYY-MM-DD' is a week, identified by its MONDAY.
   * THROWS on anything else — a pay period the system cannot name is a pay
   * period it must not act on.
   */
  PC.kindOf = function (periodId) {
    const s = String(periodId == null ? '' : periodId);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return 'month';
    if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return 'week';
    throw new Error('"' + s + '" is not a pay period. A month is written 2026-08; a week is written as its Monday, 2026-08-10.');
  };

  /** "August 2026" for a month; "11-17 Aug" for a week. */
  PC.label = function (periodId) {
    const kind = PC.kindOf(periodId);
    const s = String(periodId);
    if (kind === 'month') {
      return PC.MONTHS_LONG[parseInt(s.slice(5, 7), 10) - 1] + ' ' + s.slice(0, 4);
    }
    // payWeekDays throws a RangeError on anything it cannot parse (toISOString
    // on an Invalid Date). A label is decoration — it must never be the thing
    // that takes a pay screen down, so a bad id renders as itself.
    let days = [];
    try { days = (typeof window.payWeekDays === 'function') ? window.payWeekDays(s) : []; } catch (_) { days = []; }
    if (days.length !== 7 || !days[0] || !days[6]) return s;
    const part = (iso) => ({
      d: String(parseInt(iso.slice(8, 10), 10)),
      m: PC.MONTHS_SHORT[parseInt(iso.slice(5, 7), 10) - 1] || '',
      y: iso.slice(0, 4)
    });
    const a = part(days[0]), b = part(days[6]);
    if (a.y !== b.y) return a.d + ' ' + a.m + ' ' + a.y + ' - ' + b.d + ' ' + b.m + ' ' + b.y;
    if (a.m !== b.m) return a.d + ' ' + a.m + ' - ' + b.d + ' ' + b.m;
    return a.d + '-' + b.d + ' ' + a.m;
  };

  /** The month before this one. Pure string/integer maths, never a Date. */
  PC.prevMonth = function (ym) {
    const y = parseInt(String(ym).slice(0, 4), 10);
    const m = parseInt(String(ym).slice(5, 7), 10);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return String(py) + '-' + String(pm).padStart(2, '0');
  };

  /** `n` months ending at `ym`, newest first. */
  PC.monthsBack = function (ym, n) {
    const out = [];
    let m = String(ym).slice(0, 7);
    const count = Math.max(1, Math.min(120, parseInt(n, 10) || 1));
    for (let i = 0; i < count; i++) { out.push(m); m = PC.prevMonth(m); }
    return out;
  };

  /** The first day of a period, as an ISO date — the ONE comparable key that
   *  orders months and weeks against each other on a mixed list. */
  PC.periodStart = function (periodId) {
    return PC.kindOf(periodId) === 'month' ? String(periodId) + '-01' : String(periodId);
  };

  /**
   * The LAST calendar day of a period, ISO. A month's last day comes from
   * window.monthBounds (pure, money-core — CALLED, never modified); a week's
   * last day is its Sunday, payWeekDays(periodId)[6]. Falls back to
   * PC.periodStart on any helper failure — a label/deciding function must
   * never take the pay screen down (PAYROLL-LIVE-SPEC §4.1).
   */
  PC.periodEnd = function (periodId) {
    const s = String(periodId == null ? '' : periodId);
    try {
      if (PC.kindOf(s) === 'month') {
        const b = (typeof window.monthBounds === 'function') ? window.monthBounds(s, s + '-28') : null;
        const days = b && b.daysInMonth;
        if (days) return s + '-' + String(days).padStart(2, '0');
        return s;
      }
      const days = (typeof window.payWeekDays === 'function') ? window.payWeekDays(s) : null;
      if (days && days[6]) return days[6];
      return s;
    } catch (_) {
      // Anything — including a periodId so malformed that kindOf itself
      // throws — falls back to the string itself, never to a helper that
      // could throw a second time. A label/deciding function must never take
      // the pay screen down.
      return s;
    }
  };

  /**
   * Has the period finished? `todayIso` is REQUIRED (callers pass
   * window.bizDate()) so this stays wall-clock-free and testable: true iff
   * todayIso > PC.periodEnd(periodId), a plain string compare.
   */
  PC.periodEnded = function (periodId, todayIso) {
    return String(todayIso == null ? '' : todayIso) > PC.periodEnd(periodId);
  };

  /** 'office' for a month, 'operations' for a week. One mapping, one place. */
  PC.teamOf = function (periodId) {
    return PC.kindOf(periodId) === 'month' ? 'office' : 'operations';
  };

  // ── the state machine, in the owner's words ──────────────────────────────
  // Stored state strings are UNCHANGED (pay_runs and pay_weeks both run
  // draft -> computed -> verified -> disbursing -> disbursed, and firestore.
  // rules enforce those transitions by name). This is the translation to the
  // four words a person sees, and it is the only place the mapping exists.
  //
  // 'disbursing' maps to 'checked' rather than a fifth state: the money is
  // mid-flight, nothing is paid yet, and the contract declares four states.
  // load() carries `inFlight: true` alongside it so the screen can say
  // "payment in progress" without inventing a state name.
  PC.RAW_TO_STATE = {
    draft: 'notstarted',
    computed: 'prepared',
    verified: 'checked',
    disbursing: 'checked',
    disbursed: 'paid'
  };
  PC.STATE_LABEL = {
    notstarted: 'Not started',
    prepared: 'Ready to check',
    checked: 'Checked - waiting for payment',
    paid: 'Paid'
  };
  PC.STATES = ['notstarted', 'prepared', 'checked', 'paid'];
  PC.stateOf = function (rawState) {
    return PC.RAW_TO_STATE[String(rawState || 'draft')] || 'notstarted';
  };
  PC.stateLabel = function (state) {
    return PC.STATE_LABEL[state] || PC.STATE_LABEL.notstarted;
  };

  // What each action is allowed to do, in one place, so the screen's enabled
  // state and the engine's refusal can never disagree.
  PC.canPrepare = (state) => state === 'notstarted' || state === 'prepared';
  PC.canEdit    = (state) => state === 'notstarted' || state === 'prepared';
  PC.canCheck   = (state) => state === 'prepared';
  PC.canPay     = (state) => state === 'checked';
  PC.canReopen  = (state) => state === 'checked';
  PC.canCorrect = (state) => state === 'paid';

  // ── one-off amounts ──────────────────────────────────────────────────────

  PC.ONEOFF_KINDS = ['earning', 'deduction'];

  PC.normalizeOneOff = function (o) {
    const src = o || {};
    return {
      id: String(src.id || ''),
      label: String(src.label == null ? '' : src.label).trim(),
      amount: Math.max(0, r2(src.amount)),
      kind: src.kind === 'deduction' ? 'deduction' : 'earning',
      addedBy: src.addedBy || null,
      addedByName: src.addedByName || null,
      addedAt: src.addedAt || null
    };
  };

  /** Only a labelled, positive one-off is money. Anything else is noise and is
   *  dropped by the fold rather than quietly moving a peso. */
  PC.usableOneOffs = function (list) {
    return (Array.isArray(list) ? list : []).map(PC.normalizeOneOff)
      .filter((o) => o.amount > 0 && o.label !== '');
  };

  PC.oneOffTotals = function (list) {
    let earning = 0, deduction = 0;
    PC.usableOneOffs(list).forEach((o) => {
      if (o.kind === 'deduction') deduction += o.amount; else earning += o.amount;
    });
    return { earning: r2(earning), deduction: r2(deduction) };
  };

  /**
   * Take a line back to what the frozen engine produced, undoing whatever
   * one-offs were folded into it. Exact, because the line carries the list it
   * was folded with. Makes applyOneOffs IDEMPOTENT — re-folding a line that was
   * already folded produces the same numbers, which is what lets addOneOff run
   * without re-reading the whole roster.
   */
  PC.stripOneOffs = function (line, kind) {
    const out = Object.assign({}, line || {});
    const t = PC.oneOffTotals(out.oneOffs);
    out.oneOffs = [];
    out.oneOffEarnings = 0;
    out.oneOffDeductions = 0;
    if (!t.earning && !t.deduction) return out;
    if (kind === 'week') {
      out.gross = r2((+out.gross || 0) - t.earning);
      out.otherDeductions = r2((+out.otherDeductions || 0) - t.deduction);
      out.otherDeductionsOnly = r2((+out.otherDeductionsOnly || 0) - t.deduction);
      out.deductionTotal = r2((+out.deductionTotal || 0) - t.deduction);
      out.net = r2((+out.net || 0) - t.earning + t.deduction);
    } else {
      const withheld = (out.withheldDeductions != null) ? +out.withheldDeductions : (+out.otherDeductions || 0);
      out.otherDeductions = r2((+out.otherDeductions || 0) - t.deduction);
      out.withheldDeductions = r2(withheld - t.deduction);
      out.gross = r2((+out.gross || 0) - t.earning);
      out.netBeforeCA = r2((+out.netBeforeCA || 0) - t.earning + t.deduction);
      out.finalPay = r2((+out.finalPay || 0) - t.earning + t.deduction);
      out.effectiveGross = r2((+out.effectiveGross || 0) - t.earning);
    }
    return out;
  };

  /**
   * Fold this period's one-offs into ONE frozen line, keeping BOTH engines'
   * balancing identities intact. This is the money-critical part of the
   * feature: the ledger legs downstream are derived from these very fields, so
   * a fold that shifts one without the other silently unbalances the books.
   *
   * MONTHLY (js/departments.js disbursePayRun) posts, per line:
   *    debit  effectiveGross
   *    credit statutory + actualCa + (netBeforeCA - actualCa) + withheldDeductions
   *   A one-off EARNING of E is a real company expense:
   *      effectiveGross +E, netBeforeCA +E, finalPay +E, gross +E
   *      -> debit +E, credit +E                                     balances
   *   A one-off DEDUCTION of D is money withheld and owed onward, NOT a change
   *   in what the work cost, so the expense must not move:
   *      otherDeductions +D, withheldDeductions +D, netBeforeCA -D, finalPay -D
   *      effectiveGross = netBeforeCA + statutory + otherDeductions - unearned
   *                     = (-D) + 0 + (+D) + 0 = UNCHANGED
   *      -> debit +0, credit (netBeforeCA -D) + (withheld +D) = +0    balances
   *
   * WEEKLY (js/payroll-weekly.js disburse) posts, in aggregate:
   *    Sum gross == Sum statutory + Sum otherDeductionsOnly + Sum ca + Sum net
   *   earning E:   gross +E, net +E                                  balances
   *   deduction D: otherDeductionsOnly +D, net -D, gross unchanged    balances
   *   (`otherDeductions` on a weekly line is the COMBINED figure the frozen
   *    maths used — statutory rides inside it, see WeeklyRunCore.workerPayInputs
   *    — so it is moved by the same D to keep the two in step.)
   *
   * NEVER CLAMPS. A one-off deduction larger than the pay produces a negative
   * net and says so (`negativeNet`), because clamping would silently forgive a
   * debt the person still owes and nobody would see it happen. prepare() warns
   * on it and pay() refuses to release it.
   */
  PC.applyOneOffs = function (line, kind, list) {
    const base = PC.stripOneOffs(line, kind);
    const items = PC.usableOneOffs(list);
    const t = PC.oneOffTotals(items);
    const out = Object.assign({}, base);
    out.oneOffs = items;
    out.oneOffEarnings = t.earning;
    out.oneOffDeductions = t.deduction;
    if (!t.earning && !t.deduction) {
      out.negativeNet = (kind === 'week' ? (+out.net || 0) : (+out.finalPay || 0)) < 0;
      return out;
    }
    if (kind === 'week') {
      out.gross = r2((+base.gross || 0) + t.earning);
      out.otherDeductions = r2((+base.otherDeductions || 0) + t.deduction);
      out.otherDeductionsOnly = r2((+base.otherDeductionsOnly || 0) + t.deduction);
      out.deductionTotal = r2((+base.deductionTotal || 0) + t.deduction);
      out.net = r2((+base.net || 0) + t.earning - t.deduction);
      out.negativeNet = out.net < 0;
    } else {
      const withheld = (base.withheldDeductions != null) ? +base.withheldDeductions : (+base.otherDeductions || 0);
      out.otherDeductions = r2((+base.otherDeductions || 0) + t.deduction);
      out.withheldDeductions = r2(withheld + t.deduction);
      out.gross = r2((+base.gross || 0) + t.earning);
      out.netBeforeCA = r2((+base.netBeforeCA || 0) + t.earning - t.deduction);
      out.finalPay = r2((+base.finalPay || 0) + t.earning - t.deduction);
      out.effectiveGross = r2((+base.effectiveGross || 0) + t.earning);
      out.negativeNet = out.finalPay < 0;
    }
    return out;
  };

  /**
   * A BACKFILLED period never re-collects a cash advance — the repayment
   * already happened outside the system, and deducting it again would take the
   * money twice on paper and corrupt the outstanding balance
   * (PAYROLL-REDESIGN-BRIEF.md, "Consequences to build to").
   *
   * Done by zeroing the cash-advance fields on the FROZEN line rather than by
   * forking either disburse engine: with an empty plan / a zero instalment,
   * CashAdvance.deduct and collectCa both have nothing to do and post nothing.
   */
  PC.clearCashAdvance = function (line, kind) {
    const out = Object.assign({}, line || {});
    if (kind === 'week') {
      const ca = +out.caDeduction || 0;
      if (!ca) { out.caDeduction = 0; return out; }
      out.caDeduction = 0;
      out.caShortfall = 0;
      out.deductionTotal = r2((+out.deductionTotal || 0) - ca);
      out.net = r2((+out.net || 0) + ca);
      out.caBalanceAfter = +out.caBalanceBefore || 0;
    } else {
      const ca = +out.caPlanned || 0;
      out.caPlan = [];
      out.caPlanned = 0;
      if (ca) out.finalPay = r2((+out.finalPay || 0) + ca);
    }
    out.cashAdvanceSuppressed = true;
    return out;
  };

  // ── THE ONE NORMALISED LINE ──────────────────────────────────────────────

  /**
   * The words that say where the number came from — the owner's third
   * complaint ("a figure appears and I cannot tell which hours, which rate").
   * Plain English, no engine vocabulary, and it must read the same for both
   * teams' cards.
   */
  PC.basisText = function (line, kind) {
    const l = line || {};
    if (kind === 'week') {
      const parts = [];
      const days = +l.daysWorked || 0;
      parts.push(days + (days === 1 ? ' day worked' : ' days worked'));
      parts.push((+l.regHours || 0) + ' hrs at ' + peso(l.rate) + '/hr');
      if (+l.otHours > 0) parts.push((+l.otHours) + ' hrs overtime at the same rate');
      if (+l.travelHours > 0) parts.push((+l.travelHours) + ' hrs travel at half rate (' + peso(l.travelRate) + '/hr)');
      if (+l.daysAbsent > 0) parts.push((+l.daysAbsent) + (+l.daysAbsent === 1 ? ' day with no clock-in' : ' days with no clock-in'));
      if (+l.daysOverridden > 0) parts.push((+l.daysOverridden) + ' day(s) entered by hand with a reason');
      return parts.join(', ');
    }
    const parts = ['Monthly salary ' + peso(l.base)];
    if (+l.allowance > 0) parts.push('plus ' + peso(l.allowance) + ' allowance');
    if (l.policy === 'performance' && +l.perfFactor < 1) {
      parts.push('allowance scaled to ' + Math.round((+l.perfFactor || 0) * 100) + '% on KPI and attendance');
    }
    return parts.join(', ');
  };

  /**
   * ONE shape, both teams. The screen never asks which team a person is on.
   *
   * `breakdown` is the phone card's whole data source: an ordered, flat list of
   * every figure, each already labelled. The brief forbids horizontal scroll,
   * truncation and the table-cards expand pattern ("a hidden deduction is the
   * definition of data hidden"), and the only way a card can honour that is if
   * the data reaches it flat and complete — no nesting for the renderer to
   * decide about, no per-team branch, nothing optional.
   *
   * The money identity every card can be checked against:
   *     gross - statutory.total - deductions - oneOffDeductions
   *           - cashAdvance  ==  net
   * with gross == earnings + allowances + oneOffEarnings.
   */
  PC.normalizeLine = function (line, kind, opts) {
    const l = line || {};
    const o = opts || {};
    const oneOffs = PC.usableOneOffs(l.oneOffs);
    const t = PC.oneOffTotals(oneOffs);
    const heldReason = o.heldReason || null;

    let row;
    if (kind === 'week') {
      const st = l.statutory || {};
      const statutory = {
        sss: r2(st.sss), philhealth: r2(st.philhealth),
        pagibig: r2(st.pagibig), tax: r2(st.tax), total: r2(st.total)
      };
      row = {
        personId: String(l.workerId || ''),
        name: String(l.name || l.workerId || ''),
        team: 'Operations Team',
        payClass: 'production',
        basis: PC.basisText(l, 'week'),
        earnings: r2((+l.regularPay || 0) + (+l.otPay || 0) + (+l.travelPay || 0)),
        allowances: r2(l.allowanceTotal),
        oneOffs: oneOffs,
        oneOffEarnings: t.earning,
        oneOffDeductions: t.deduction,
        // The hand-typed half only. One-offs are their own rows so a card never
        // shows the same peso twice.
        deductions: Math.max(0, r2((+l.otherDeductionsOnly || 0) - t.deduction)),
        statutory: statutory,
        cashAdvance: r2(l.caDeduction),
        gross: r2(l.gross),
        net: r2(l.net),
        // Everything the "where did this come from" card needs, kept flat.
        detail: {
          daysWorked: +l.daysWorked || 0,
          daysAbsent: +l.daysAbsent || 0,
          daysOverridden: +l.daysOverridden || 0,
          hours: r2(l.regHours), otHours: r2(l.otHours), travelHours: r2(l.travelHours),
          rate: r2(l.rate), travelRate: r2(l.travelRate),
          rateSource: l.rateSource || '',
          regularPay: r2(l.regularPay), otPay: r2(l.otPay), travelPay: r2(l.travelPay),
          allowanceParts: Object.assign({ meal: 0, transport: 0, rent: 0 }, l.allowances || {}),
          cashAdvanceBefore: r2(l.caBalanceBefore), cashAdvanceAfter: r2(l.caBalanceAfter),
          statutoryApplied: !!(st && st.applied), statutoryConfigured: !!(st && st.configured),
          days: Array.isArray(l.rows) ? l.rows : [],
          jobTitle: l.jobTitle || '', department: l.department || '',
          linkedUid: l.linkedUid || null,
          // STATUTORY-BY-STATUS-SPEC-2026-08-12 §7.3 — frozen onto the line
          // by WRC.buildLines; passed through untouched, never recomputed.
          employmentStatus: l.employmentStatus || '',
          statutoryBasis: l.statutoryBasis || ''
        }
      };
      row.statusFlag = l.statusFlag || null;
    } else {
      const statutory = {
        sss: r2(l.sss), philhealth: r2(l.philhealth),
        pagibig: r2(l.pagibig), tax: r2(l.tax), total: r2(l.statutoryTotal)
      };
      row = {
        personId: String(l.uid || ''),
        name: String(l.name || l.uid || ''),
        team: 'Office Team',
        payClass: l.payClass === 'production' ? 'production' : 'regular',
        basis: PC.basisText(l, 'month'),
        earnings: r2(l.base),
        allowances: r2(l.allowance),
        oneOffs: oneOffs,
        oneOffEarnings: t.earning,
        oneOffDeductions: t.deduction,
        deductions: Math.max(0, r2((+l.otherDeductions || 0) - t.deduction)),
        statutory: statutory,
        cashAdvance: r2(l.caPlanned),
        gross: r2(l.gross),
        net: r2(l.finalPay),
        detail: {
          kpiScore: l.kpiScore == null ? null : r2(l.kpiScore),
          attendanceScore: l.attScore == null ? null : r2(l.attScore),
          policy: l.policy || 'flat',
          // Frozen straight off computePayLine's own raw output (money-core.js
          // — CALLED, never edited): the owner's "where did the number come
          // from" for a performance-policy allowance (PAYROLL-LIVE-SPEC §6.4).
          perfFactor: l.perfFactor == null ? null : r2(l.perfFactor),
          withheldDeductions: r2(l.withheldDeductions != null ? l.withheldDeductions : l.otherDeductions),
          unearnedDeductions: r2(l.unearnedDeductions),
          employerShare: l.er || null,
          cashAdvanceBefore: r2(l.caBalance),
          overridden: !!l.overridden,
          overrideNote: (l.overrideMeta && l.overrideMeta.note) || '',
          linkedUid: String(l.uid || ''),
          // STATUTORY-BY-STATUS-SPEC-2026-08-12 §7.3 — frozen onto the line
          // by buildPayRunLines; passed through untouched, never recomputed.
          employmentStatus: l.employmentStatus || '',
          statutoryBasis: l.statutoryBasis || ''
        }
      };
      row.statusFlag = l.statusFlag || null;
    }

    row.held = !!heldReason;
    row.heldReason = heldReason;
    row.negativeNet = row.net < 0;
    row.zeroNet = row.net === 0;
    row.breakdown = PC.breakdownOf(row, kind);
    return row;
  };

  /**
   * Every figure on the line, in card order, already labelled. `kind` is
   * 'info' (a fact, `text`), 'earning' / 'deduction' (money) or 'total'.
   * NOTHING is optional-by-tap and nothing is summarised — a zero shows as a
   * zero rather than disappearing, because a deduction that vanishes when it is
   * zero teaches people the row can vanish.
   */
  PC.breakdownOf = function (row, kind) {
    const info = (label, text) => ({ label: label, kind: 'info', amount: null, text: String(text) });
    const money = (label, kind2, amount) => ({ label: label, kind: kind2, amount: r2(amount), text: null });
    const out = [];
    if (kind === 'week') {
      const d = row.detail;
      out.push(info('Days worked', d.daysWorked + ' of 7'));
      if (d.daysAbsent) out.push(info('Days with no clock-in', String(d.daysAbsent)));
      out.push(info('Hours', String(d.hours)));
      out.push(info('Overtime hours', String(d.otHours)));
      out.push(info('Travel hours', String(d.travelHours)));
      out.push(info('Rate', peso(d.rate) + ' per hour'));
      out.push(money('Basic pay', 'earning', d.regularPay));
      out.push(money('Overtime pay', 'earning', d.otPay));
      out.push(money('Travel pay', 'earning', d.travelPay));
      out.push(money('Allowances', 'earning', row.allowances));
    } else {
      const d = row.detail;
      out.push(money('Salary', 'earning', row.earnings));
      out.push(money('Allowance', 'earning', row.allowances));
      if (d.kpiScore != null) out.push(info('KPI score', String(Math.round(d.kpiScore * 100)) + '%'));
      if (d.attendanceScore != null) out.push(info('Attendance score', String(Math.round(d.attendanceScore * 100)) + '%'));
    }
    row.oneOffs.forEach((o) => out.push(money(o.label, o.kind, o.amount)));
    out.push(money('SSS', 'deduction', row.statutory.sss));
    out.push(money('PhilHealth', 'deduction', row.statutory.philhealth));
    out.push(money('Pag-IBIG', 'deduction', row.statutory.pagibig));
    out.push(money('Withholding tax', 'deduction', row.statutory.tax));
    // STATUTORY-BY-STATUS-SPEC-2026-08-12 §7.3 — the reason beside the
    // numbers, automatically, on the phone card that already shows them.
    if (row.detail.statutoryBasis) out.push(info('Government deductions', row.detail.statutoryBasis));
    out.push(money('Other deductions', 'deduction', row.deductions));
    out.push(money('Cash advance', 'deduction', row.cashAdvance));
    out.push(money('Take-home pay', 'total', row.net));
    return out;
  };

  /** The run's totals, summed from the normalised lines so the screen's header
   *  and its rows can never disagree. HELD lines are excluded from every money
   *  figure — a held person is not being paid — but counted, so the screen can
   *  say so out loud instead of a total that quietly does not add up. */
  PC.totalsOf = function (lines) {
    const all = Array.isArray(lines) ? lines : [];
    const payable = all.filter((l) => !l.held);
    const sum = (f) => r2(payable.reduce((s, l) => s + (+f(l) || 0), 0));
    return {
      people: payable.length,
      heldPeople: all.length - payable.length,
      earnings: sum((l) => l.earnings),
      allowances: sum((l) => l.allowances),
      oneOffEarnings: sum((l) => l.oneOffEarnings),
      oneOffDeductions: sum((l) => l.oneOffDeductions),
      deductions: sum((l) => l.deductions),
      statutory: sum((l) => l.statutory.total),
      cashAdvance: sum((l) => l.cashAdvance),
      gross: sum((l) => l.gross),
      net: sum((l) => l.net)
    };
  };

  /** The person id on a RAW stored line, whichever engine produced it. */
  PC.personIdOf = function (line, kind) {
    const l = line || {};
    return String((kind === 'week' ? l.workerId : l.uid) || '');
  };

  /** The take-home on a RAW stored line, whichever engine produced it. */
  PC.netOf = function (line, kind) {
    const l = line || {};
    return r2(kind === 'week' ? l.net : l.finalPay);
  };

  /* ── correctionBaseline — the money rule behind correctAfterPay ─────────
     Extracted and exported PURELY so it can be pinned by a test. It decides
     what a person was LAST paid, which is the figure a correction is measured
     against.

     THE BUG THIS ENCODES AGAINST: the first version measured against the run's
     FROZEN LINE, which is immutable and therefore never reflects a correction
     already applied. Re-running the same correction recomputed the SAME
     difference and posted it a second time, overstating the books. A 60-second
     duplicate window caught an accidental double-press and nothing else — not a
     genuine repeat an hour later by someone who thought it had not saved.

     @param payslip   the payslip doc as it stands NOW ({} on the first fix)
     @param frozenNet the run line's original net
     @param kind      'week' | 'month'  (the two store net in different fields)
     @returns { wasNet, hasPrior } */
  PC.correctionBaseline = function (payslip, frozenNet, kind) {
    const cur = payslip || {};
    const prior = Array.isArray(cur.corrections) ? cur.corrections : [];
    const paid = (kind === 'week')
      ? (cur.netPay != null ? Number(cur.netPay) : (cur.totalPay != null ? Number(cur.totalPay) : NaN))
      : (cur.finalPay != null ? Number(cur.finalPay) : NaN);
    return {
      wasNet: Number.isFinite(paid) ? r2(paid) : r2(Number(frozenNet) || 0),
      hasPrior: prior.length > 0
    };
  };

  /* Should this correction post anything? A repeat that changes nothing must
     post NOTHING — not a zero-value pair of ledger legs, and not a second copy
     of a difference already booked. */
  PC.correctionPosts = function (nowNet, wasNet, hasPrior) {
    const difference = r2(Number(nowNet) - Number(wasNet));
    if (Math.abs(difference) < 0.01) return { posts: false, difference: 0 };
    return { posts: true, difference: difference };
  };

  window.PayrollCore = PC;

  // ═════════════════════════════════════════════════════════
  //  THE RUN — window.Payroll
  //  Everything below touches Firestore. Nothing below touches the DOM.
  // ═════════════════════════════════════════════════════════

  // js/firebase-config.js declares `const db = firebase.firestore()` at the top
  // level of a CLASSIC SCRIPT. Top-level let/const live in the global LEXICAL
  // environment — shared by every classic script on the page, but NOT reachable
  // as `window.db`, which is plain undefined. These accessors resolve the bare
  // bindings LAZILY, at call time, which also keeps this file require()-able
  // under Node for tests: nothing dereferences a database until a method runs.
  const _db = () => (typeof db !== 'undefined' ? db : window.db);
  const _fb = () => (typeof firebase !== 'undefined' ? firebase : window.firebase);

  const COL = (kind) => _db().collection(kind === 'week' ? 'pay_weeks' : 'pay_runs');
  const DOC = (periodId, kind) => COL(kind).doc(periodId);
  const stamp = () => _fb().firestore.FieldValue.serverTimestamp();
  const me = () => (typeof currentUser !== 'undefined' ? currentUser : null) || window.currentUser || null;
  const myUid = () => (me() && me().uid) || null;
  const myName = () => (window.userProfile && window.userProfile.displayName) || (me() && me().email) || null;
  const isPresident = () => typeof window.isRealPresident === 'function' && window.isRealPresident();
  const warn = (code, message, extra) => Object.assign({ code: code, message: message }, extra || {});

  /** Read the stored run. THROWS on a failed read (a denial must never arrive
   *  at a pay screen dressed as an empty period); null means no document. */
  async function readRun(periodId, kind) {
    const snap = await DOC(periodId, kind).get();
    return snap.exists ? (snap.data() || {}) : null;
  }

  /** `excluded` -> the contract's `held`. Any truthy entry is a hold; a string
   *  entry is its reason. A stale `false` left behind by a put-back is not a
   *  hold, which is why this filters rather than copying the map. */
  function heldMapOf(excluded) {
    const src = excluded || {};
    const out = {};
    const keys = (typeof src.get === 'function' && typeof src.keys === 'function')
      ? Array.from(src.keys()) : Object.keys(src);
    keys.forEach((k) => {
      const v = (typeof src.get === 'function') ? src.get(k) : src[k];
      if (!v) return;
      out[k] = (typeof v === 'string' && v) ? v : 'Held for this period';
    });
    return out;
  }

  /** Totals in the shape each collection ALREADY stores, so the screens that
   *  predate this file keep reading the right numbers after a re-fold. */
  function storageTotals(rawLines, kind) {
    if (kind === 'week') {
      const s = (f) => r2(rawLines.reduce((a, l) => a + (+f(l) || 0), 0));
      return {
        totals: {
          workerCount: rawLines.length,
          gross: s((l) => l.gross), net: s((l) => l.net),
          statutory: s((l) => (l.statutory ? l.statutory.total : 0)),
          otherDeductions: s((l) => l.otherDeductionsOnly),
          cashAdvance: s((l) => l.caDeduction),
          allowances: s((l) => l.allowanceTotal),
          regHours: s((l) => l.regHours), otHours: s((l) => l.otHours),
          travelHours: s((l) => l.travelHours)
        }
      };
    }
    return {
      employeeCount: rawLines.length,
      totalNet: r2(rawLines.reduce((a, l) => a + (+l.finalPay || 0), 0))
    };
  }

  /**
   * Fold stored inputs onto RAW engine lines and normalise. PURE — no reads, no
   * writes. `doc` may be null (no run document yet, e.g. a preview() before
   * anyone has touched the period). Extracted out of refold() so preview() and
   * refold() share the exact same fold logic and can never drift (D2,
   * PAYROLL-LIVE-SPEC §4.2).
   *
   * @param rawLines  the lines the underlying engine just froze (or built,
   *                  read-only, for a preview)
   * @param kind       'week' | 'month'
   * @param doc        the stored run document, or null
   */
  function foldAndNormalize(rawLines, kind, doc) {
    const d = doc || {};
    const raw = Array.isArray(rawLines) ? rawLines : [];
    const oneOffs = d.oneOffs || {};
    const backfill = d.backfill || null;
    const suppressCa = !!(backfill && backfill.isBackfill);
    const warnings = Array.isArray(d.warnings) ? d.warnings.slice() : [];

    const folded = raw.map((l) => {
      const pid = PC.personIdOf(l, kind);
      let out = PC.applyOneOffs(l, kind, oneOffs[pid] || []);
      if (suppressCa) out = PC.clearCashAdvance(out, kind);
      return out;
    });

    const held = heldMapOf(d.excluded);
    const lines = folded.map((l) => PC.normalizeLine(l, kind, { heldReason: held[PC.personIdOf(l, kind)] || null }));

    lines.forEach((l) => {
      if (l.held) return;
      if (l.negativeNet) {
        warnings.push(warn('negative-net', l.name + ' works out to ' + PC.peso(l.net) + ' — the deductions are larger than the pay. Nothing will be released until that is fixed; take an amount off, or hold them for this period.', { personId: l.personId }));
      } else if (l.zeroNet) {
        warnings.push(warn('zero-net', l.name + ' works out to nothing this period. Check the hours and the rate before this goes out — a zero inside a batch is easy to miss.', { personId: l.personId }));
      }
    });
    if (suppressCa) {
      warnings.push(warn('backfill-no-cash-advance', 'This is a past period being entered after the fact, so no cash advance is collected from it — the repayment already happened. Collecting it again would take the money twice on paper.'));
    }
    (d.skipped || []).forEach((s) => {
      if (!s) return;
      warnings.push(warn('not-on-this-run', (s.name || s.workerId || s.uid || 'Someone') + ' is not on this period: ' + String(s.reason || 'no reason recorded') + '.', { personId: s.workerId || s.uid || '' }));
    });

    return { lines: lines, held: held, totals: PC.totalsOf(lines), warnings: warnings, folded: folded };
  }
  // Exported PURELY so tests/payroll-live.test.mjs can pin it against fixtures
  // without a database (§5 item 5) — never called from anywhere but refold()
  // and preview() in production.
  PC._foldForTest = foldAndNormalize;

  /**
   * Fold this period's one-offs (and the backfill cash-advance suppression)
   * onto the lines the underlying engine just froze, and write them back.
   *
   * WHY A SECOND PASS RATHER THAN A CHANGE TO EITHER ENGINE: computePayRun and
   * WeeklyRun.compute are the tested, live money paths, and the maths inside
   * them is frozen. Folding on top of their output — with the identity proof in
   * PayrollCore.applyOneOffs — adds the owner's one-off amounts without a
   * single edit to either. It is idempotent (stripOneOffs undoes exactly what
   * applyOneOffs did), so it can run after every prepare, every one-off and
   * every hand edit without drifting.
   *
   * The write sets state 'computed' deliberately: firestore.rules only admits a
   * pay_runs / pay_weeks update down the compute branch, which requires the
   * resulting state to be 'computed' or 'verified'. Re-asserting the state it
   * is already in is what makes an otherwise ordinary field write legal.
   *
   * Behavioural change from before this file's foldAndNormalize extraction:
   * NONE. The `needsFold` skip (a period with no one-offs and no backfill is
   * left exactly as its own engine wrote it) still gates the WRITE; the
   * RETURN VALUE now comes from foldAndNormalize either way, which produces
   * byte-identical output to the inline logic this replaced.
   */
  async function refold(periodId, kind) {
    const d = await readRun(periodId, kind);
    if (!d) throw new Error('There is nothing to work with for ' + PC.label(periodId) + ' yet.');
    const raw = Array.isArray(d.lines) ? d.lines : [];
    const oneOffs = d.oneOffs || {};
    const backfill = d.backfill || null;
    const suppressCa = !!(backfill && backfill.isBackfill);

    // Fold only when there is something to fold, so a period with no one-offs
    // and no backfill is left EXACTLY as its own engine wrote it — one fewer
    // write, and one fewer chance to disturb a frozen line.
    //
    // `wasFolded` is the half that is easy to miss: if the stored lines already
    // carry a fold and every one-off has since been taken back off, the fold
    // still has to be re-run to UNDO it. Without this, deleting the last
    // one-off would leave its money on the line for ever.
    const wasFolded = raw.some((l) => PC.usableOneOffs(l && l.oneOffs).length || (l && l.cashAdvanceSuppressed));
    const hasOneOffs = Object.keys(oneOffs).some((k) => PC.usableOneOffs(oneOffs[k]).length);
    const needsFold = wasFolded || hasOneOffs || suppressCa;

    const result = foldAndNormalize(raw, kind, d);

    if (needsFold) {
      const patch = Object.assign(
        { state: 'computed', lines: result.folded, unifiedAt: stamp(), unifiedBy: myUid() },
        storageTotals(result.folded, kind)
      );
      await DOC(periodId, kind).set(patch, { merge: true });
    }

    return { lines: result.lines, held: result.held, totals: result.totals, warnings: result.warnings };
  }

  // ── the ledger, for corrections only ─────────────────────────────────────
  // Corrections are the ONLY ledger legs this file posts itself; everything
  // else is posted by the two engines it delegates to. Routed through the same
  // single idempotent poster they use: Ledger.upsertByRef is a transactional
  // read-modify-write on a deterministic id, so re-posting the same ref updates
  // the row rather than adding a second one.
  async function postLeg(ref, entry) {
    if (!window.Ledger || typeof window.Ledger.upsertByRef !== 'function') {
      throw new Error('The accounts ledger is not available, so this correction was not recorded. Nothing was changed.');
    }
    await window.Ledger.upsertByRef(ref, () => ({
      ref: ref, date: entry.date, kind: entry.kind, accountType: entry.accountType,
      account: entry.account, category: entry.category, description: entry.description,
      amount: entry.amount, source: 'Finance', extra: entry.extra || {}
    }));
  }

  /** The date a correction books on: the period's own pay date, never today —
   *  a fix to August belongs in August or every report moves. */
  function periodPostDate(periodId, kind) {
    if (kind === 'month') return String(periodId) + '-01';
    try {
      const days = window.payWeekDays(periodId);
      return days[6];
    } catch (_) { return String(periodId); }
  }

  /** Where a person's payslip for this period lives. Two collections because
   *  the two teams' payslips already live in two places; the CALLER never has
   *  to know which — that is the whole point of this layer. */
  function payslipRef(periodId, kind, personId) {
    return kind === 'week'
      ? _db().collection('payslips').doc('WK-' + periodId + '-' + personId)
      : _db().collection('salary_history').doc(personId + '_' + periodId);
  }

  const Payroll = {

    // Exposed so the screen's labels and this engine's refusals cannot drift.
    STATES: PC.STATES,
    STATE_LABEL: PC.STATE_LABEL,
    stateLabel: PC.stateLabel,
    core: PC,

    kindOf(periodId) { return PC.kindOf(periodId); },
    label(periodId) { return PC.label(periodId); },

    // ── read ───────────────────────────────────────────────────────────────
    /**
     * The whole period in ONE shape, for either team.
     *
     * Returns null when NOTHING exists for this period. THROWS on a failed
     * read. Those two are not the same fact, and this app collapses denials
     * into empty results nearly everywhere else — on a pay roster that reads as
     * "nobody is owed anything", which is the failure this whole design exists
     * to stop.
     */
    async load(periodId) {
      const kind = PC.kindOf(periodId);
      const d = await readRun(periodId, kind);      // throws on denial, by design
      if (!d) return null;

      const rawState = d.state || 'draft';
      const state = PC.stateOf(rawState);
      const held = heldMapOf(d.excluded);
      const raw = Array.isArray(d.lines) ? d.lines : [];
      const lines = raw.map((l) => PC.normalizeLine(l, kind, { heldReason: held[PC.personIdOf(l, kind)] || null }));

      return {
        periodId: periodId,
        kind: kind,
        label: PC.label(periodId),
        state: state,
        stateLabel: PC.stateLabel(state),
        // The money is mid-flight: checked, locked, not yet paid. Kept separate
        // from `state` so nobody has to invent a fifth word for it.
        inFlight: rawState === 'disbursing',
        lines: lines,
        held: held,
        totals: PC.totalsOf(lines),
        adjustments: (kind === 'week' ? d.adjustments : d.overrides) || {},
        oneOffs: d.oneOffs || {},
        receipts: d.receipts || {},
        skipped: d.skipped || [],
        warnings: d.warnings || [],
        corrections: d.corrections || [],
        notPaidYet: (d.failures || []),
        preparedAt: d.computedAt || null,
        preparedBy: d.computedByName || d.computedBy || null,
        checkedAt: d.verifiedAt || null,
        checkedBy: d.verifiedByName || d.verifiedBy || null,
        paidAt: d.disbursedAt || null,
        paidBy: d.disbursedByName || d.disbursedBy || null,
        backfill: d.backfill || null,
        // WHO approved checking this period early, and WHY — the owner's
        // Finance-approved override to the period-end gate (D5, and the
        // owner's 2026-08-11 ruling: Finance, not the President, approves a
        // special-request early release). Visible on the run for as long as it
        // exists; never silent.
        earlyReleaseOverride: d.earlyReleaseOverride || null
      };
    },

    /**
     * The period AS IT STANDS RIGHT NOW, built from the live inputs through the
     * SAME frozen maths the real pipeline uses — and WRITES NOTHING. This is
     * the only legitimate source for an in-progress period's figures (D1).
     * THROWS on any failed read (a denial must never render as an empty
     * roster). Never called for money that will move: what gets paid is always
     * the stored frozen line, never this projection.
     *
     * @returns same shape as load(), PLUS:
     *   live: true
     *   asOf: 'YYYY-MM-DD HH:mm'   Manila, via bizDate()/bizHour()
     *   state: the STORED state if a run doc exists, else 'notstarted'
     */
    async preview(periodId) {
      const kind = PC.kindOf(periodId);
      const d = await readRun(periodId, kind);      // throws on denial, by design

      let built;
      if (kind === 'week') {
        if (!window.WeeklyRun || typeof window.WeeklyRun.buildLines !== 'function') {
          throw new Error('The weekly pay engine has not loaded — reload the page and try again.');
        }
        built = await window.WeeklyRun.buildLines(periodId);
      } else {
        if (typeof window.buildPayRunLines !== 'function') {
          throw new Error('The monthly pay engine has not loaded — reload the page and try again.');
        }
        built = await window.buildPayRunLines(periodId, {});
      }

      const result = foldAndNormalize(built.lines, kind, d);
      const rawState = (d && d.state) || 'draft';
      const state = d ? PC.stateOf(rawState) : 'notstarted';
      const todayIso = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10);
      const nowHour = window.bizHour ? String(window.bizHour()).padStart(2, '0') + ':00' : '';

      return {
        periodId: periodId,
        kind: kind,
        label: PC.label(periodId),
        state: state,
        stateLabel: PC.stateLabel(state),
        inFlight: rawState === 'disbursing',
        live: true,
        asOf: todayIso + (nowHour ? ' ' + nowHour : ''),
        lines: result.lines,
        held: result.held,
        totals: result.totals,
        adjustments: (kind === 'week' ? (d && d.adjustments) : (d && d.overrides)) || {},
        oneOffs: (d && d.oneOffs) || {},
        receipts: (d && d.receipts) || {},
        skipped: built.skipped || [],
        warnings: (built.warnings || []).concat(result.warnings),
        corrections: (d && d.corrections) || [],
        notPaidYet: (d && d.failures) || [],
        preparedAt: (d && d.computedAt) || null,
        preparedBy: (d && (d.computedByName || d.computedBy)) || null,
        checkedAt: (d && d.verifiedAt) || null,
        checkedBy: (d && (d.verifiedByName || d.verifiedBy)) || null,
        paidAt: (d && d.disbursedAt) || null,
        paidBy: (d && (d.disbursedByName || d.disbursedBy)) || null,
        backfill: (d && d.backfill) || null,
        earlyReleaseOverride: (d && d.earlyReleaseOverride) || null
      };
    },

    // ── prepare (was "Compute") ────────────────────────────────────────────
    /**
     * Build every line for the period. Monthly lines come from computePayLine
     * through computePayRun; weekly lines from computeWeeklyLine through
     * WeeklyRun.compute. payClass picks the strategy and NOTHING ELSE differs —
     * both land in the same normalised shape here, and everything downstream is
     * identical.
     *
     * Moves nothing and pays nobody: safe to run again at any time before the
     * hours are marked correct.
     */
    async prepare(periodId) {
      const kind = PC.kindOf(periodId);
      const existing = await readRun(periodId, kind);
      const state = PC.stateOf(existing && existing.state);
      if (!PC.canPrepare(state)) {
        throw new Error(PC.label(periodId) + ' is already "' + PC.stateLabel(state) + '". Reopen it before working the figures out again.');
      }
      if (kind === 'week') {
        if (!window.WeeklyRun || typeof window.WeeklyRun.compute !== 'function') {
          throw new Error('The weekly pay engine has not loaded — reload the page and try again.');
        }
        await window.WeeklyRun.compute(periodId);
      } else {
        if (typeof window.computePayRun !== 'function') {
          throw new Error('The monthly pay engine has not loaded — reload the page and try again.');
        }
        await window.computePayRun(periodId);
      }
      const out = await refold(periodId, kind);
      window.logAudit && window.logAudit('payroll-prepare', kind === 'week' ? 'pay_weeks' : 'pay_runs', periodId,
        { people: out.totals.people, net: out.totals.net });
      return out;
    },

    // ── hold one person, for THIS period only ──────────────────────────────
    /**
     * Owner ruling: "removing of certain members on payroll is strictly applied
     * on that payroll period only unless said member is removed from system."
     * So a hold lives on the PERIOD, never on the person, and `reasonOrNull`
     * of null puts them back.
     *
     * An action on a roster row, not another screen — and it works before or
     * after the hours are marked correct, because both release paths re-read
     * the holds at pay time rather than trusting the frozen lines.
     */
    async setHeld(periodId, personId, reasonOrNull) {
      const kind = PC.kindOf(periodId);
      if (!personId) throw new Error('Holding someone back needs to know who.');
      if (kind === 'week') {
        if (!window.WeeklyRun || typeof window.WeeklyRun.setExcluded !== 'function') {
          throw new Error('The weekly pay engine has not loaded — reload the page and try again.');
        }
        await window.WeeklyRun.setExcluded(periodId, personId, reasonOrNull);
        return;
      }

      const FV = _fb().firestore.FieldValue;
      const ref = DOC(periodId, kind);
      const exists = await ref.get().then((s) => s.exists);
      if (!exists) {
        // No run document yet. Rules allow a CREATE at 'draft', which is how a
        // hold can be set for a period nobody has worked out yet — holds
        // pre-tick into the next period and that has to work before prepare.
        // Removing a hold that was never set is a no-op, so only a real hold
        // creates anything.
        if (!reasonOrNull) return;
        await ref.set({
          month: periodId, state: 'draft',
          excluded: Object.fromEntries([[personId, String(reasonOrNull)]]),
          excludedUpdatedAt: stamp(), excludedUpdatedBy: myUid()
        });
      } else {
        // Fenced to the exclusion keys ONLY and the state must not move —
        // firestore.rules admits exactly this write and nothing wider, so a
        // stray extra field here is denied rather than half-applied.
        const patch = {};
        patch['excluded.' + personId] = reasonOrNull ? String(reasonOrNull) : FV.delete();
        patch.excludedUpdatedAt = stamp();
        patch.excludedUpdatedBy = myUid();
        await ref.update(patch);
      }
      window.logAudit && window.logAudit('payroll-hold', 'pay_runs', periodId, { personId: personId, reason: reasonOrNull || null });
    },

    // ── adjust ONE person's line ───────────────────────────────────────────
    /**
     * The owner's "change one person without touching the run", as an action on
     * a roster row.
     *
     * `patch` is whatever that team's engine understands, plus one field this
     * layer adds for both:
     *   OPERATIONS: { rentAllowance, otherDeductions, caDeduction, travelHours,
     *                 overrides: { 'YYYY-MM-DD': {hours, otHours, reason} } }
     *   OFFICE:     { kpiScore, attScore, allowance, otherDeductions, finalPay,
     *                 note }
     *   BOTH:       { oneOffs: [ {label, amount, kind} ] } — replaces this
     *               person's one-off list wholesale, which is how a mistyped
     *               one-off is taken back off.
     *
     * The figures are re-derived afterwards, because an adjustment only means
     * anything once it is folded into a frozen line.
     */
    async setAdjustment(periodId, personId, patch) {
      const kind = PC.kindOf(periodId);
      if (!personId) throw new Error('Changing a line needs to know whose.');
      const d = await readRun(periodId, kind);
      const state = PC.stateOf(d && d.state);
      if (!PC.canEdit(state)) {
        throw new Error(PC.label(periodId) + ' is "' + PC.stateLabel(state) + '" — reopen it before changing anyone\'s figures.');
      }
      const p = Object.assign({}, patch || {});

      // The one field this layer owns on both teams.
      if (Object.prototype.hasOwnProperty.call(p, 'oneOffs')) {
        const list = PC.usableOneOffs(p.oneOffs).map((o, i) => Object.assign({}, o, {
          id: o.id || ('oo-' + personId + '-' + i + '-' + Date.now()),
          addedBy: o.addedBy || myUid(), addedByName: o.addedByName || myName(),
          addedAt: o.addedAt || new Date().toISOString()
        }));
        const w = { state: 'computed', oneOffsUpdatedAt: stamp(), oneOffsUpdatedBy: myUid() };
        w['oneOffs.' + personId] = list;
        await DOC(periodId, kind).set(w, { merge: true });
        delete p.oneOffs;
      }

      if (Object.keys(p).length) {
        if (kind === 'week') {
          if (!window.WeeklyRun || typeof window.WeeklyRun.setAdjustment !== 'function') {
            throw new Error('The weekly pay engine has not loaded — reload the page and try again.');
          }
          await window.WeeklyRun.setAdjustment(periodId, personId, p);
        } else {
          // The monthly engine applies these INSIDE computePayLine (allowance
          // and other deductions are inputs, finalPay is an output override —
          // see money-core.js's applyPayLineOverride), so the entry is stored
          // and the figures are worked out again below. Merged onto whatever is
          // already there: a patch is a patch, or editing the allowance would
          // wipe the note.
          const prevOvr = ((d && d.overrides) || {})[personId] || {};
          const entry = Object.assign({}, prevOvr, p, {
            setBy: myUid(), setByName: myName(), setAt: new Date().toISOString()
          });
          const w = { state: 'computed' };
          w['overrides.' + personId] = entry;
          await DOC(periodId, kind).set(w, { merge: true });
        }
      }

      window.logAudit && window.logAudit('payroll-adjust', kind === 'week' ? 'pay_weeks' : 'pay_runs', periodId,
        { personId: personId, patch: patch || {} });

      // An office adjustment is an INPUT to the frozen maths, so the whole
      // period has to be worked out again; a weekly adjustment is folded in
      // before computeWeeklyLine, so the same is true there. One path, both
      // teams — the caller never has to know which.
      return await this.prepare(periodId);
    },

    // ── a one-off amount on ONE line ───────────────────────────────────────
    /**
     * The owner's "a bonus, 13th month, a special allowance, a deduction that
     * is not one of the fixed fields" — as an action on a roster row.
     *
     * Folded into that person's line BEFORE it is frozen (see
     * PayrollCore.applyOneOffs for the proof that it keeps both engines'
     * debits==credits identity), so it reaches the payslip, the ledger and the
     * totals without anything downstream remembering to add it back. Today the
     * only route is typing an inflated "Final Pay" with a reason, which
     * produces a payslip whose lines no longer add up.
     *
     * @param one { label, amount, kind: 'earning' | 'deduction' }
     */
    async addOneOff(periodId, personId, one) {
      const kind = PC.kindOf(periodId);
      const o = one || {};
      const label = String(o.label == null ? '' : o.label).trim();
      const amount = r2(o.amount);
      const oneKind = o.kind === 'deduction' ? 'deduction' : 'earning';
      if (!personId) throw new Error('A one-off amount needs to know whose line it goes on.');
      if (!label) throw new Error('Give the amount a name — it prints on the payslip as its own line, and an unnamed one is unexplainable a year from now.');
      if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
      if (PC.ONEOFF_KINDS.indexOf(oneKind) < 0) throw new Error('A one-off amount is either something extra paid or something taken off.');

      const d = await readRun(periodId, kind);
      const state = PC.stateOf(d && d.state);
      if (state === 'notstarted' || !d || !Array.isArray(d.lines) || !d.lines.length) {
        throw new Error('Work out ' + PC.label(periodId) + ' first — a one-off amount attaches to a line that exists.');
      }
      if (!PC.canEdit(state)) {
        throw new Error(PC.label(periodId) + ' is "' + PC.stateLabel(state) + '" — reopen it before adding an amount.');
      }
      if (!d.lines.some((l) => PC.personIdOf(l, kind) === String(personId))) {
        throw new Error('That person is not on ' + PC.label(periodId) + ', so there is no line to put this on.');
      }

      const prev = PC.usableOneOffs((d.oneOffs || {})[personId]);
      const entry = {
        id: 'oo-' + personId + '-' + Date.now(),
        label: label, amount: amount, kind: oneKind,
        addedBy: myUid(), addedByName: myName(), addedAt: new Date().toISOString()
      };
      const list = prev.concat([entry]);
      const w = { state: 'computed', oneOffsUpdatedAt: stamp(), oneOffsUpdatedBy: myUid() };
      w['oneOffs.' + personId] = list;
      await DOC(periodId, kind).set(w, { merge: true });

      window.logAudit && window.logAudit('payroll-one-off', kind === 'week' ? 'pay_weeks' : 'pay_runs', periodId,
        { personId: personId, label: label, amount: amount, kind: oneKind });

      // Folded straight onto the stored lines — no need to read the whole
      // roster again, because applyOneOffs is exact and idempotent.
      const out = await refold(periodId, kind);
      out.oneOffs = list;
      return out;
    },

    // ── HR's half of the handoff ───────────────────────────────────────────
    /**
     * "The hours are right." ONE button, and it is the whole of HR's side.
     *
     * The figures lock (nobody can quietly edit a line afterwards) and FINANCE
     * IS TOLD. That signal IS the handoff the owner asked for: today there are
     * fifty-two of these a year and not one notification before money moves —
     * the only payroll notifications in the app fire after it already has.
     */
    /**
     * @param opts.earlyOverride { reason }  A FINANCE-APPROVED exception to the
     *   period-end gate below (owner ruling, 2026-08-11 — not in the original
     *   spec text, which speculated a President-tier override; the owner said
     *   Finance). Requires BOTH a non-empty typed reason AND that the caller is
     *   Finance-tier (isMoneyPriv — the same tier the rest of this file already
     *   calls "Finance" for the release itself). Recorded on the run document
     *   as `earlyReleaseOverride` — who approved it, why, and against what end
     *   date — so it stays visible on the run afterwards, never a silent
     *   loosening. The default refusal (no override, or no Finance approval)
     *   always names the period's end date.
     */
    async markHoursCorrect(periodId, opts) {
      const kind = PC.kindOf(periodId);
      const o = opts || {};

      // ── D5 — a period that has not ended cannot be checked/paid ──────────
      // (PAYROLL-LIVE-SPEC §4.6). Checked FIRST, ahead of the state read below:
      // a mid-period Adjust/one-off can leave the stored state reading
      // 'computed' (-> 'prepared') for a period that is still live (D6), and
      // that state alone must never be enough to let it be checked.
      const todayIso = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10);
      let earlyOverride = null;
      if (!PC.periodEnded(periodId, todayIso)) {
        const reason = String((o.earlyOverride && o.earlyOverride.reason) || '').trim();
        const mayOverride = (typeof window.isMoneyPriv === 'function') && window.isMoneyPriv();
        if (!mayOverride || !reason) {
          throw new Error(PC.label(periodId) + ' runs to ' + PC.periodEnd(periodId)
            + ' and is not finished. The figures are still adding up — they can be checked and paid once the '
            + (kind === 'week' ? 'week' : 'month') + ' ends.'
            + (mayOverride
              ? ' Say why this needs to go early — a reason is required.'
              : ' For a special request, Finance can approve checking it early; the reason stays visible on this period afterwards.'));
        }
        earlyOverride = {
          reason: reason,
          approvedBy: myUid(),
          approvedByName: myName(),
          approvedAt: stamp(),
          periodEndWas: PC.periodEnd(periodId)
        };
      }

      const d = await readRun(periodId, kind);
      if (!d) throw new Error('There is nothing to check for ' + PC.label(periodId) + ' yet.');
      const state = PC.stateOf(d.state);
      if (!PC.canCheck(state)) {
        throw new Error(state === 'checked'
          ? PC.label(periodId) + ' has already been checked and is waiting for payment.'
          : PC.label(periodId) + ' is "' + PC.stateLabel(state) + '" — the figures have to be worked out before they can be checked.');
      }
      const raw = Array.isArray(d.lines) ? d.lines : [];
      if (!raw.length) throw new Error(PC.label(periodId) + ' has nobody on it — there is nothing to check.');

      const held = heldMapOf(d.excluded);
      const payable = raw.filter((l) => !held[PC.personIdOf(l, kind)]);
      if (!payable.length) throw new Error('Everyone on ' + PC.label(periodId) + ' is being held back, so there is nothing to pay.');
      const negative = payable.filter((l) => PC.netOf(l, kind) < 0);
      if (negative.length) {
        throw new Error('These come out below zero, so they cannot be checked yet: '
          + negative.map((l) => (l.name || PC.personIdOf(l, kind)) + ' (' + PC.peso(PC.netOf(l, kind)) + ')').join(', ')
          + '. Take an amount off, or hold them for this period.');
      }

      if (kind === 'week') {
        if (!window.WeeklyRun || typeof window.WeeklyRun.verify !== 'function') {
          throw new Error('The weekly pay engine has not loaded — reload the page and try again.');
        }
        // The override rides in the SAME write that moves computed -> verified
        // (WeeklyRun.verify's optional second arg), because firestore.rules
        // admits arbitrary extra fields on THAT transition and nothing wider —
        // a separate merge afterwards, once the doc already reads 'verified',
        // would be denied (no clause covers verified -> verified with a new
        // field).
        await window.WeeklyRun.verify(periodId, earlyOverride ? { earlyReleaseOverride: earlyOverride } : undefined);
      } else {
        const patch = {
          state: 'verified', verifiedAt: stamp(),
          verifiedBy: myUid(), verifiedByName: myName()
        };
        if (earlyOverride) patch.earlyReleaseOverride = earlyOverride;
        await DOC(periodId, kind).set(patch, { merge: true });
      }

      const total = r2(payable.reduce((s, l) => s + PC.netOf(l, kind), 0));
      window.logAudit && window.logAudit('payroll-checked', kind === 'week' ? 'pay_weeks' : 'pay_runs', periodId,
        { people: payable.length, net: total });

      // THE SIGNAL. Best-effort: a notification that fails must never leave the
      // period unchecked, because the state write above has already landed and
      // a silent rollback would be worse than a missing message. Plain emoji
      // only — emojiIcon() returns markup and a notification title is a plain
      // text sink, so markup in one shows the user raw code.
      try {
        if (window.Notifs && typeof window.Notifs.sendToDept === 'function') {
          await window.Notifs.sendToDept('Finance', {
            title: 'Payroll checked - ready to pay',
            body: PC.label(periodId) + ' has been checked: ' + payable.length + ' people, ' + PC.peso(total)
              + '. It is waiting for payment.',
            icon: '💰', type: 'payroll', link: 'payroll',
            dedupKey: 'payroll-checked-' + periodId
          }, { fallbackToOwner: true });
        }
      } catch (err) {
        console.error('Payroll.markHoursCorrect: could not tell Finance (the period IS checked)', err);
      }

      return { periodId: periodId, kind: kind, state: 'checked', people: payable.length, total: total };
    },

    // ── Finance's half of the handoff ──────────────────────────────────────
    /**
     * Pay the period. ONE press, both teams.
     *
     * Everything genuinely irreversible stays exactly where it already is: the
     * transactional lock, the deterministic per-period ledger refs, the keyed
     * cash-advance collection, the closed-period check and the statutory
     * sign-off gate all live inside the two engines this delegates to, and none
     * of it is reimplemented here. What this adds is the part that was missing
     * from BOTH: one receipt per person enforced for the office team too, the
     * holds re-read at pay time before anyone is asked for a receipt, and HR
     * told when it is done.
     *
     * @param receiptsByPersonId { [personId]: {url, name} }
     */
    async pay(periodId, receiptsByPersonId, opts) {
      const kind = PC.kindOf(periodId);
      const receipts = receiptsByPersonId || {};
      const o = opts || {};
      const d = await readRun(periodId, kind);
      if (!d) throw new Error('There is nothing to pay for ' + PC.label(periodId) + '.');
      const rawState = d.state || 'draft';
      const state = PC.stateOf(rawState);
      if (!PC.canPay(state)) {
        throw new Error(state === 'paid'
          ? PC.label(periodId) + ' has already been paid.'
          : PC.label(periodId) + ' is "' + PC.stateLabel(state) + '" — it has to be checked before it can be paid.');
      }

      // ⚠ THE BACKFILL HAZARD (PAYROLL-REDESIGN-BRIEF.md). A past period that
      // was already recorded in the books must NOT post its wages a second
      // time: June's expense would be counted twice and both entries would look
      // legitimate. Whether it was recorded is not something the system can
      // infer — it depends on what was done outside it. Until the release path
      // can be told to skip the ledger, refusing is the only safe answer, and a
      // refusal is visible where a double posting is not.
      const backfill = d.backfill || null;
      if (backfill && backfill.isBackfill && backfill.postToLedger === false) {
        throw new Error(PC.label(periodId) + ' was entered as a past period whose wages are already in the books, so releasing it here would record them twice. Its payslips can be produced, but the money side must stay out of the accounts — that route is not wired up yet.');
      }

      // ⚠ RE-READ THE HOLDS AT PAY TIME. The lines were frozen when the figures
      // were worked out, and a hold written afterwards is legal (the rules
      // deliberately permit it while a period is checked). Both engines now
      // re-filter as well; this happens FIRST so a held person is never asked
      // for a receipt they should not need.
      const held = heldMapOf(d.excluded);
      const raw = Array.isArray(d.lines) ? d.lines : [];
      const payable = raw.filter((l) => PC.personIdOf(l, kind) && !held[PC.personIdOf(l, kind)]);
      if (!payable.length) throw new Error(PC.label(periodId) + ' has nobody left to pay — everyone on it is held back.');

      const negative = payable.filter((l) => PC.netOf(l, kind) < 0);
      if (negative.length) {
        throw new Error('These come out below zero and will not be released: '
          + negative.map((l) => (l.name || PC.personIdOf(l, kind))).join(', ')
          + '. Reopen the period, fix the amounts, and check it again.');
      }

      // ONE RECEIPT PER PERSON — the owner's ruling, now enforced for BOTH
      // teams. The weekly run already demanded it; the monthly run demanded no
      // proof of anything. Refused up front, before a single write, so nobody
      // is paid before the refusal is discovered.
      const missing = payable.filter((l) => PC.netOf(l, kind) > 0
        && !(receipts[PC.personIdOf(l, kind)] && receipts[PC.personIdOf(l, kind)].url));
      if (missing.length) {
        throw new Error('Everyone being paid needs their own transfer receipt attached first. Still missing: '
          + missing.map((l) => l.name || PC.personIdOf(l, kind)).join(', ') + '.');
      }

      let result;
      if (kind === 'week') {
        if (!window.WeeklyRun || typeof window.WeeklyRun.disburse !== 'function') {
          throw new Error('The weekly pay engine has not loaded — reload the page and try again.');
        }
        result = await window.WeeklyRun.disburse(periodId, receipts, { bankAccount: o.bankAccount });
      } else {
        if (typeof window.disbursePayRun !== 'function') {
          throw new Error('The monthly pay engine has not loaded — reload the page and try again.');
        }
        // disbursePayRun refuses by showing a message and RETURNING, not by
        // throwing (a wrong role, the government rates not yet confirmed, no
        // lines). An engine cannot report success on a function that answers
        // "nothing happened" the same way it answers "done", so the stored
        // state is the only honest confirmation.
        await window.disbursePayRun(periodId, { bankAccount: o.bankAccount });
        const after = await readRun(periodId, kind);
        if (!after || after.state !== 'disbursed') {
          throw new Error(PC.label(periodId) + ' was not paid — the release stopped before it finished. Nothing has been marked paid; read the message it showed, put that right, and press Pay again.');
        }
        result = {
          paid: payable.map((l) => ({
            personId: l.uid, name: l.name, net: r2(l.finalPay),
            receiptUrl: (receipts[l.uid] && receipts[l.uid].url) || ''
          })),
          // Deterministic, so they can be quoted, resynced or reversed without
          // reading the ledger back. Mirrors disbursePayRun's own refs.
          ledgerRefs: payable.map((l) => 'PAY-' + periodId + '-' + l.uid)
        };

        // The receipts. The monthly release has nowhere on its own document to
        // put them — once a period is paid its run document is frozen by the
        // rules, and that is correct. They go on the person's own pay record
        // instead, which is where the weekly team's already are (the payslip's
        // proofUrl) and where whoever asks for one will look.
        await Promise.all(payable.map(async (l) => {
          const rec = receipts[l.uid];
          if (!rec || !rec.url) return;
          await payslipRef(periodId, kind, l.uid).set({
            proofUrl: rec.url, proofName: rec.name || '', proofAddedAt: stamp(), proofAddedBy: myUid()
          }, { merge: true }).catch((err) => {
            console.error('Payroll.pay: receipt not attached for', l.uid, '(the money HAS moved)', err);
          });
        }));
      }

      const total = r2(payable.reduce((s, l) => s + PC.netOf(l, kind), 0));
      window.logAudit && window.logAudit('payroll-paid', kind === 'week' ? 'pay_weeks' : 'pay_runs', periodId,
        { people: payable.length, net: total });

      // THE RETURN SIGNAL. HR prepared it; HR is told it is done. Best-effort —
      // the money has already moved and a failed notification must never be
      // reported as a failed payment.
      try {
        if (window.Notifs && typeof window.Notifs.sendToDept === 'function') {
          await window.Notifs.sendToDept('HR', {
            title: 'Payroll paid',
            body: PC.label(periodId) + ' has been paid: ' + payable.length + ' people, ' + PC.peso(total) + '.',
            icon: '✅', type: 'payroll', link: 'payroll',
            dedupKey: 'payroll-paid-' + periodId
          }, { fallbackToOwner: true });
        }
      } catch (err) {
        console.error('Payroll.pay: could not tell HR (the money HAS moved)', err);
      }

      return { paid: result.paid || [], ledgerRefs: result.ledgerRefs || [] };
    },

    // ── reopen, for BOTH kinds ─────────────────────────────────────────────
    /**
     * Undo "checked" so the figures can be worked out again.
     *
     * THIS IS WHY IT EXISTS: window.reopenPayRun is hardcoded to
     * db.collection('pay_runs'), so a checked WEEK has never been reopenable —
     * while the weekly screen told people the President could do it "from the
     * monthly tooling", which was simply not true. Fifty-two one-way doors a
     * year. The monthly path still delegates to the existing function so its
     * behaviour is unchanged; the weekly path is the same two transitions the
     * rules already allow on pay_weeks.
     *
     * A PAID period is not reopened. That is deliberate and it is the safeguard
     * the brief keeps: once money has moved, who was on that payroll is
     * history. Fixing one person after payment is correctAfterPay, which
     * touches that person and leaves everyone else alone.
     */
    async reopen(periodId) {
      const kind = PC.kindOf(periodId);
      const d = await readRun(periodId, kind);
      if (!d) throw new Error('There is nothing to reopen for ' + PC.label(periodId) + '.');
      const rawState = d.state || 'draft';
      const state = PC.stateOf(rawState);
      if (state === 'paid') {
        throw new Error(PC.label(periodId) + ' has already been paid, so it is not reopened. Fix the one person who is wrong instead — that leaves everybody else exactly as they were.');
      }
      if (!PC.canReopen(state)) {
        throw new Error(PC.label(periodId) + ' is "' + PC.stateLabel(state) + '" — there is nothing to undo.');
      }
      // Unsticking a release that stopped half-way is the President's call on
      // both kinds: it is the one path that can un-say something about money
      // that may already have moved. firestore.rules says the same, so asking
      // here turns a raw permission error into a sentence.
      if (rawState === 'disbursing' && !isPresident()) {
        throw new Error(PC.label(periodId) + ' stopped part-way through payment. Only the President can unlock it, after checking what actually went out.');
      }

      if (kind === 'month') {
        if (typeof window.reopenPayRun !== 'function') {
          throw new Error('The monthly pay engine has not loaded — reload the page and try again.');
        }
        await window.reopenPayRun(periodId);
        const after = await readRun(periodId, kind);
        if (!after || after.state !== 'computed') {
          throw new Error(PC.label(periodId) + ' was not reopened. It is still "' + PC.stateLabel(PC.stateOf(after && after.state)) + '".');
        }
      } else {
        // The rules put BOTH weekly reopen transitions (checked -> ready to
        // check, and unsticking a part-finished release) behind the President,
        // so this is a President action either way. Said out loud rather than
        // surfaced as a permission error.
        if (!isPresident()) {
          throw new Error('Only the President can reopen a checked week.');
        }
        const FV = _fb().firestore.FieldValue;
        await DOC(periodId, kind).update({
          state: 'computed',
          reopenedAt: stamp(), reopenedBy: myUid(), reopenedByName: myName(),
          disbursingAt: FV.delete(), disbursingBy: FV.delete(), disbursingByName: FV.delete()
        });
      }

      window.logAudit && window.logAudit('payroll-reopen', kind === 'week' ? 'pay_weeks' : 'pay_runs', periodId, { from: rawState });
      return { periodId: periodId, kind: kind, state: 'prepared' };
    },

    // ── fix something after paying ─────────────────────────────────────────
    /**
     * The owner's "a wrong amount, a missed day, a payslip to reissue, AFTER
     * the money went out" — for ONE person, leaving every other line untouched.
     *
     * HOW THE MONEY IS PUT RIGHT. Never by deleting or editing what was posted:
     * an entry that disappears is an entry nobody can audit, and this ledger
     * models corrections the way the cash-advance repayment in js/config.js
     * does — a NEW, offsetting pair of legs against the same accounts, on the
     * period's own date so no report moves month.
     *
     *    owed more  -> debit  Payroll Expense, credit Cash   (money goes out)
     *    overpaid   -> credit Payroll Expense, debit  Cash   (money comes back)
     *
     * Both legs carry a deterministic ref — PAYFIX-{period}-{person}-{n} — so a
     * second press updates the same two rows instead of paying the difference
     * twice, which is the same guard the two release paths use.
     *
     * WHERE IT IS RECORDED. On the person's own pay record (salary_history for
     * the office team, the payslip for operations), which is both the payslip
     * being reissued and the only document that is still writable — a paid
     * period's run document is frozen by the rules, correctly. The correction
     * number is minted inside a transaction on that same document, so two
     * presses cannot claim the same number and a repeat of the SAME correction
     * within a minute is recognised and not applied twice.
     *
     * @param patch { net, reason, oneOffs }  `reason` is REQUIRED — money that
     *        moves after payday without a recorded reason is exactly what the
     *        audit trail exists to prevent.
     */
    async correctAfterPay(periodId, personId, patch) {
      const kind = PC.kindOf(periodId);
      const p = patch || {};
      const reason = String(p.reason == null ? '' : p.reason).trim();
      if (!personId) throw new Error('A correction needs to know whose pay it is.');
      if (!reason) throw new Error('Say what is being put right. A payment that changes after payday without a recorded reason cannot be explained later.');

      const d = await readRun(periodId, kind);
      if (!d) throw new Error('There is no payroll for ' + PC.label(periodId) + '.');
      const state = PC.stateOf(d.state);
      if (!PC.canCorrect(state)) {
        throw new Error(PC.label(periodId) + ' is "' + PC.stateLabel(state) + '", not paid yet — change the figures on the roster instead, no correction needed.');
      }

      const raw = Array.isArray(d.lines) ? d.lines : [];
      const line = raw.find((l) => PC.personIdOf(l, kind) === String(personId));
      if (!line) throw new Error('That person is not on ' + PC.label(periodId) + '.');
      const held = heldMapOf(d.excluded);
      if (held[String(personId)]) {
        throw new Error((line.name || personId) + ' was held back from ' + PC.label(periodId) + ' and was never paid, so there is nothing to correct.');
      }

      // ⚠ wasNet is derived INSIDE the transaction below, from the payslip's
      // CURRENT value — not from this frozen line. The frozen line is immutable
      // for ever, so it never reflects a correction already applied: re-running
      // the same correction would recompute the SAME difference and post it a
      // second time, overstating the books. The 60-second duplicate window only
      // caught an accidental double-press, not a genuine repeat an hour later
      // by someone who thought it had not saved.
      const frozenNet = PC.netOf(line, kind);
      let corrected = line;
      if (Object.prototype.hasOwnProperty.call(p, 'oneOffs')) {
        corrected = PC.applyOneOffs(line, kind, p.oneOffs);
      }
      let nowNet = PC.netOf(corrected, kind);
      if (p.net != null && Number.isFinite(+p.net)) nowNet = r2(p.net);
      if (nowNet < 0) throw new Error('A corrected pay cannot be below zero.');

      const name = line.name || String(personId);
      const postDate = periodPostDate(periodId, kind);
      const psRef = payslipRef(periodId, kind, personId);
      const nowIso = new Date().toISOString();

      // ── mint the correction number, and catch a double press ────────────
      // In ONE transaction on the document that is actually writable, so the
      // number and the record of it can never disagree in either direction.
      let seq = 0, duplicate = false, wasNet = frozenNet, difference = 0;
      await _db().runTransaction(async (tx) => {
        const snap = await tx.get(psRef);
        const cur = snap.exists ? (snap.data() || {}) : {};
        const prior = Array.isArray(cur.corrections) ? cur.corrections : [];
        const last = prior[prior.length - 1];
        // THE BASELINE IS WHAT THE PERSON WAS LAST PAID, read here so it is
        // inside the same transaction that writes the new figure. Falls back to
        // the frozen line only on the FIRST correction, when the payslip still
        // carries the original amount.
        const paidNow = (kind === 'week')
          ? (cur.netPay != null ? Number(cur.netPay) : (cur.totalPay != null ? Number(cur.totalPay) : NaN))
          : (cur.finalPay != null ? Number(cur.finalPay) : NaN);
        wasNet = Number.isFinite(paidNow) ? r2(paidNow) : frozenNet;
        difference = r2(nowNet - wasNet);
        // Nothing changed — a repeat of a correction already applied. Post
        // nothing rather than a zero-value pair of ledger legs.
        if (Math.abs(difference) < 0.01 && prior.length) {
          seq = last ? last.seq : prior.length; duplicate = true; return;
        }
        // Same reason, same money, moments ago: this is the same press arriving
        // twice, not a second correction. The deterministic refs below would
        // make the ledger idempotent anyway, but a duplicate ENTRY on the
        // payslip is its own kind of wrong.
        if (last && last.reason === reason && r2(last.difference) === difference
            && last.at && (Date.parse(nowIso) - Date.parse(last.at)) < 60000) {
          seq = last.seq; duplicate = true; return;
        }
        seq = prior.length + 1;
        const entry = {
          seq: seq, reason: reason, was: wasNet, now: nowNet, difference: difference,
          at: nowIso, by: myUid(), byName: myName(), periodId: periodId
        };
        const write = {
          corrections: prior.concat([entry]),
          corrected: true, correctedAt: stamp(), correctedBy: myUid(),
          correctionNote: reason
        };
        // Reissue the payslip — the same figure in whichever field that team's
        // payslip reads, so the reprint and the money agree.
        if (kind === 'week') {
          write.netPay = nowNet; write.totalPay = nowNet;
        } else {
          write.finalPay = nowNet;
        }
        // ⚠ THE COMPONENTS NO LONGER SUM TO THE TOTAL, and that must be said on
        // the payslip rather than left for the reader to discover. Only the net
        // is rewritten here — gross, the deduction rows and the hours breakdown
        // still hold their pre-correction values, so a reissued payslip shows
        // rows adding to the OLD figure beside a NEW total. Restating every
        // component would mean re-running the whole line, which is what the
        // frozen-line rule exists to prevent.
        // So: an explicit, printable line stating what changed and why. The
        // payslip renderer prints correctionNote when present.
        write.correctionSummary =
          'Corrected after payment: ' + (nowNet >= wasNet ? 'additional ' : 'reduced by ') +
          (window.fmt ? window.fmt(Math.abs(r2(nowNet - wasNet))) : Math.abs(r2(nowNet - wasNet))) +
          '. The breakdown above shows the original figures; the total is the corrected amount.';
        tx.set(psRef, write, { merge: true });
      });

      const refExp = 'PAYFIX-' + periodId + '-' + personId + '-' + seq + '-EXP';
      const refCash = 'PAYFIX-' + periodId + '-' + personId + '-' + seq + '-CASH';
      const ledgerRefs = [];

      if (Math.abs(difference) >= 0.01) {
        const amount = r2(Math.abs(difference));
        const owedMore = difference > 0;
        const what = owedMore ? 'underpaid' : 'overpaid';
        const note = 'Pay correction (' + what + ') - ' + name + ' (' + PC.label(periodId) + '): ' + reason;
        // The expense side. An overpayment CREDITS Payroll Expense, which backs
        // the original debit down by exactly the difference; it never erases it.
        await postLeg(refExp, {
          date: postDate, kind: owedMore ? 'debit' : 'credit', accountType: 'expense',
          account: 'Payroll Expense', category: 'Payroll Expense', description: note, amount: amount
        });
        ledgerRefs.push(refExp);
        // The cash side, equal and opposite, so the books stay balanced whether
        // money went out or came back.
        await postLeg(refCash, {
          date: postDate, kind: owedMore ? 'credit' : 'debit', accountType: 'asset',
          account: 'Cash', category: 'Payroll Expense', description: note, amount: amount,
          extra: (window.BankAccounts && typeof window.BankAccounts.tag === 'function')
            ? window.BankAccounts.tag(p.bankAccount || null, owedMore ? 'out' : 'in') : {}
        });
        ledgerRefs.push(refCash);
        if (typeof window.dbCacheInvalidate === 'function') window.dbCacheInvalidate('ledger');
      }

      // Mark it on the period as well, so a correction is visible from the run
      // and not only from the person's payslip.
      //
      // ⚠ correctedAt and correctedBy ARE REQUIRED. firestore.rules admits this
      // write only when the touched keys are exactly
      // [corrections, correctionRefs, correctedAt, correctedBy, state] AND
      // correctedBy == the caller's uid (rules ~1565, ~1678). Writing
      // `corrections` alone made correctedBy read as '' and the rule denied it
      // EVERY time — silently, because of the .catch below. The comment that
      // stood here claimed a paid period was immutable and the refusal was
      // expected; that was wrong, and the catch turned a real denial into
      // invisible data loss. Still best-effort: the correction is already
      // permanent on the payslip and in the audit log.
      await DOC(periodId, kind).set({
        correctedAt: stamp(),
        correctedBy: myUid(),
        corrections: _fb().firestore.FieldValue.arrayUnion({
          personId: String(personId), name: name, seq: seq, reason: reason,
          was: wasNet, now: nowNet, difference: difference, at: nowIso, by: myUid()
        })
      }, { merge: true }).catch(() => { /* frozen period — recorded on the payslip instead */ });

      window.logAudit && window.logAudit('payroll-correction', kind === 'week' ? 'pay_weeks' : 'pay_runs', periodId,
        { personId: personId, seq: seq, was: wasNet, now: nowNet, difference: difference, reason: reason, duplicate: duplicate });

      // Tell the person and tell Finance. Best-effort, after the money.
      const theirUid = kind === 'week' ? (line.linkedUid || null) : String(personId);
      try {
        if (window.Notifs && theirUid && typeof window.Notifs.send === 'function' && Math.abs(difference) >= 0.01) {
          await window.Notifs.send(theirUid, {
            title: '💰 Your pay was corrected',
            body: 'Your pay for ' + PC.label(periodId) + ' was corrected to ' + PC.peso(nowNet) + ' (' + reason + ').',
            icon: '💰', type: 'payroll', link: 'personal-finance',
            dedupKey: 'payroll-correction-' + periodId + '-' + personId + '-' + seq
          });
        }
        if (window.Notifs && typeof window.Notifs.sendToDept === 'function') {
          await window.Notifs.sendToDept('Finance', {
            title: 'Pay correction recorded',
            body: name + ' - ' + PC.label(periodId) + ': ' + PC.peso(wasNet) + ' corrected to ' + PC.peso(nowNet)
              + '. Reason: ' + reason,
            icon: '📝', type: 'payroll', link: 'payroll',
            dedupKey: 'payroll-correction-fin-' + periodId + '-' + personId + '-' + seq
          }, { fallbackToOwner: true });
        }
      } catch (err) {
        console.error('Payroll.correctAfterPay: notifications failed (the correction IS recorded)', err);
      }

      return {
        periodId: periodId, personId: String(personId), seq: seq, duplicate: duplicate,
        was: wasNet, now: nowNet, difference: difference, ledgerRefs: ledgerRefs
      };
    },

    // ── navigation ─────────────────────────────────────────────────────────
    /**
     * The last `n` periods of one kind, newest first. Anchored on the Manila
     * business date — a raw toISOString() is UTC and lands on the wrong day for
     * the first eight hours of every Manila day, which on a weekly payroll is
     * the wrong seven days.
     */
    recentPeriods(kind, n) {
      const count = Math.max(1, Math.min(120, parseInt(n, 10) || 1));
      const today = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10);
      if (kind === 'week') {
        if (window.WeeklyRun && typeof window.WeeklyRun.recentWeeks === 'function') {
          return window.WeeklyRun.recentWeeks(count);
        }
        // Noon-anchored with an explicit +08:00, exactly as payWeekMondayOf
        // does and for the same reason: a bare 'YYYY-MM-DD' parses as UTC
        // midnight, which is the PREVIOUS day for any negative offset, and a
        // week boundary that moves by a day pays the wrong seven days.
        const out = [];
        let m = window.payWeekMondayOf(today);
        for (let i = 0; i < count; i++) {
          out.push(m);
          const d = new Date(m + 'T12:00:00+08:00');
          d.setUTCDate(d.getUTCDate() - 7);
          m = d.toISOString().slice(0, 10);
        }
        return out;
      }
      return PC.monthsBack(today.slice(0, 7), count);
    },

    /** How far back the opening list looks. Deliberately small: a payroll
     *  screen opens on what is OWED, and a longer window is a slower open for
     *  periods nobody is chasing. */
    UNPAID_MONTHS_BACK: 6,
    UNPAID_WEEKS_BACK: 8,

    /**
     * Everything not yet paid, both kinds, newest first — what the screen opens
     * on, and the answer to "which door is right": there is one list and both
     * teams are in it.
     *
     * THROWS if any period cannot be read. A period that silently disappears
     * off this list is a payday nobody is reminded about.
     */
    async unpaidPeriods() {
      const months = this.recentPeriods('month', this.UNPAID_MONTHS_BACK);
      const weeks = this.recentPeriods('week', this.UNPAID_WEEKS_BACK);
      const ids = months.map((m) => ({ periodId: m, kind: 'month' }))
        .concat(weeks.map((w) => ({ periodId: w, kind: 'week' })));

      const docs = await Promise.all(ids.map((x) => readRun(x.periodId, x.kind)));

      const out = [];
      ids.forEach((x, i) => {
        const d = docs[i];
        const state = PC.stateOf(d && d.state);
        if (state === 'paid') return;
        const raw = (d && Array.isArray(d.lines)) ? d.lines : [];
        const held = heldMapOf(d && d.excluded);
        const payable = raw.filter((l) => !held[PC.personIdOf(l, x.kind)]);
        out.push({
          periodId: x.periodId,
          kind: x.kind,
          label: PC.label(x.periodId),
          state: state,
          stateLabel: PC.stateLabel(state),
          people: payable.length,
          total: r2(payable.reduce((s, l) => s + PC.netOf(l, x.kind), 0))
        });
      });

      // Newest first, on a key that orders months and weeks against each other.
      out.sort((a, b) => {
        const sa = PC.periodStart(a.periodId), sb = PC.periodStart(b.periodId);
        if (sa === sb) return a.kind === 'month' ? -1 : 1;
        return sa < sb ? 1 : -1;
      });
      return out;
    }
  };

  window.Payroll = Payroll;

  // Node-only export of the PURE half, for tests/payroll-unified.test.mjs. The
  // Firestore-touching half is deliberately not exported: it cannot run without
  // a database, and pretending otherwise would test a mock rather than this
  // code.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign({}, PC, { PayrollCore: PC });
  }
})();
