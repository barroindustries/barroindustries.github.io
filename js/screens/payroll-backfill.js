/* ═══════════════════════════════════════════════════════════════════════════
   ADD PAST PAY RECORDS — window.renderPayrollBackfill(container, user, role)

   > "since this is a new design again, allow us to input the old records so
   >  everything is up to date."   — the owner, 2026-08-10

   WHY IT EXISTS. Four things in this app read HISTORY rather than the current
   period, and every one of them is wrong for anyone paid before this system
   existed: the BIR alphalist (assembled from salary_history, js/bir.js
   ~795-867), 13th-month pay (a function of the year's earnings), month- and
   year-to-date on payslips, and a worker's own payslip archive — the thing
   they actually ask HR for. This screen is where the paper payslips become
   those records.

   SCOPE — THIS TAX YEAR ONLY. January of the current year onward. That is
   exactly what the alphalist, the 13th month and year-to-date need; reaching
   further back adds typing that nothing reads.

   ── THE HAZARD THAT DECIDES HOW THIS IS BUILT ────────────────────────────
   A backfilled period must not book money that is already in the books, and
   must book money that is not. Both failures are silent, neither is visible
   from the payroll screen, and NEITHER IS INFERABLE — it depends on what was
   done outside this app. So the question is asked in plain words, per period,
   before anything is saved, and the answer is STORED on the record so whoever
   reconciles a year from now can see it rather than guess.

   ── WHAT A BACKFILLED RECORD DOES AND DOES NOT DO ────────────────────────
   • It is MARKED as backfilled, permanently: `backfill` on the run document,
     `backfill:true` on every history row, and — so it is visible without any
     other file changing — a note printed on the payslip itself.
   • It NEVER re-collects a cash advance. The repayment already happened. The
     amount taken on the paper payslip is RECORDED so the payslip reconciles,
     but no cash_advances / worker_profiles balance is touched, ever.
   • It generates payslips and sends NO notifications. Nobody wants a push
     about March.
   • It CANNOT be entered for a period that already has a run of any kind.
   • It writes the collection each half of the payroll actually reads back:
     salary_history for a MONTH (that IS the Office Team's payslip record —
     js/screens/dashboards.js reads salary_history/{uid}_{month}), payslips for
     a WEEK. Never both for one person: the alphalist builds its rows from
     salary_history AND from payslips and sums them separately, so writing both
     would report every peso twice.

   ── SPEED IS A CORRECTNESS REQUIREMENT ───────────────────────────────────
   "Backfilling a year for thirty workers is 360 records; if each takes a form
   and six clicks it will not get done, and a half-populated history is worse
   than none because it looks complete." So: one row per person, every figure
   typed in place, tab straight across, no dialog and no modal anywhere in the
   flow — including the confirmation, which is an inline panel (also because
   closeModal() is history.back() and asynchronous).

   There is deliberately NO "fill from today's rates" button. Prefilling from
   the CURRENT salary is the exact defect the audit names on the live monthly
   run (it pays June at August's rates), and a wrong figure that looks typed is
   worse than an empty box. The one carry-forward offered — "copy what was
   recorded for the previous period" — copies REAL recorded history, and only
   into rows that are still completely empty.

   ── MOBILE ───────────────────────────────────────────────────────────────
   ONE DOM, two presentations. Above 760px it is a grid; at or below, every row
   becomes a card with its own labels and every figure stays on screen. Nothing
   is truncated, nothing is behind a tap, and the page never scrolls sideways —
   the grid scrolls inside its own container on the narrow-desktop case only.

   ── PERMISSIONS, AND THE ONE ROUGH EDGE ──────────────────────────────────
   firestore.rules lets the money tier CREATE a run document only at state
   'draft'/'computed'. Reaching the terminal state is a walk:
     pay_weeks : computed -> verified -> disbursing -> disbursed  (money tier)
     pay_runs  : computed -> verified                (money tier)
                          -> disbursing -> disbursed (PRESIDENT ONLY)
   So a month can only be FINISHED by the President today. That is checked and
   said out loud BEFORE any typing, never after. See the handoff note: one
   backfill-shaped `create` branch in firestore.rules collapses the whole walk
   into a single write and removes the asymmetry.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const R2 = (n) => Math.round(((+n || 0) + Number.EPSILON) * 100) / 100;
  const esc = (v) => (window.escHtml ? window.escHtml(v == null ? '' : v) : String(v == null ? '' : v));
  const ico = (g, s) => (window.emojiIcon ? window.emojiIcon(g, s || 16) : '');
  const peso = (n) => '₱' + (window.fmtN2 ? window.fmtN2(n) : Number(n || 0).toFixed(2));
  const stamp = () => firebase.firestore.FieldValue.serverTimestamp();
  const meUid = () => (window.currentUser && window.currentUser.uid) || null;
  const meName = () => (window.userProfile && window.userProfile.displayName)
    || (window.currentUser && window.currentUser.email) || '';

  // ═══════════════════════════════════════════════════════════════════════
  //  PERIODS
  //  periodId is 'YYYY-MM' (a month) or 'YYYY-MM-DD' (a MONDAY, i.e. a week),
  //  exactly as window.Payroll defines it. Those helpers are preferred when
  //  they are loaded; the fallbacks below keep this screen working on its own.
  // ═══════════════════════════════════════════════════════════════════════

  function kindOf(periodId) {
    if (window.Payroll && typeof window.Payroll.kindOf === 'function') return window.Payroll.kindOf(periodId);
    return /^\d{4}-\d{2}-\d{2}$/.test(String(periodId || '')) ? 'week' : 'month';
  }

  function periodLabel(periodId) {
    if (window.Payroll && typeof window.Payroll.label === 'function') {
      try { return window.Payroll.label(periodId); } catch (_) { /* fall through */ }
    }
    if (kindOf(periodId) === 'week') {
      return (window.WeeklyRunCore && window.WeeklyRunCore.weekLabel)
        ? window.WeeklyRunCore.weekLabel(periodId) : String(periodId);
    }
    return window.fmtMonthLabel ? window.fmtMonthLabel(periodId) : String(periodId);
  }

  /** Manila 'today'. Never a raw toISOString() — that is UTC and moves the day. */
  function todayIso() {
    return window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10);
  }

  /** Noon-anchored +08:00 date maths, for the same reason payWeekMondayOf is. */
  function addDaysIso(iso, n) {
    const d = new Date(String(iso) + 'T12:00:00+08:00');
    if (isNaN(d.getTime())) return String(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /** The pay date a period books against — the same convention each live run
   *  already uses, so a backfilled period sits in the ledger where a real one
   *  would (disbursePayRun: `${month}-01`; WeeklyRun: the week's Sunday). */
  function payDateOf(periodId) {
    return kindOf(periodId) === 'week' ? window.payWeekDays(periodId)[6] : periodId + '-01';
  }

  /** Completed months of this tax year, newest first. The current month is
   *  excluded — it is the live payroll's job, not history's. */
  function monthOptions() {
    const cur = todayIso().slice(0, 7);
    const year = cur.slice(0, 4);
    const out = [];
    for (let m = 1; m <= 12; m++) {
      const key = year + '-' + String(m).padStart(2, '0');
      if (key < cur) out.push(key);
    }
    return out.reverse();
  }

  /** Completed pay weeks of this tax year, newest first. Starts at the Monday
   *  that OWNS 1 January (that week pays days inside this tax year even when
   *  its Monday sits in December) and stops before the week in progress. */
  function weekOptions() {
    if (typeof window.payWeekMondayOf !== 'function') return [];
    const today = todayIso();
    const year = today.slice(0, 4);
    const thisWeek = window.payWeekMondayOf(today);
    const out = [];
    let w = window.payWeekMondayOf(year + '-01-01');
    let guard = 0;
    while (w < thisWeek && guard++ < 60) { out.push(w); w = addDaysIso(w, 7); }
    return out.reverse();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  READS
  //  A denied read is NEVER allowed to look like an empty roster or like an
  //  unclaimed period. Everything here throws; every caller renders the throw.
  // ═══════════════════════════════════════════════════════════════════════

  function runCollection(kind) { return kind === 'week' ? 'pay_weeks' : 'pay_runs'; }

  /** The run document for a period, or null when there is genuinely none.
   *  THROWS on a failed read — "I could not read it" and "there is none" are
   *  the same shape and opposite meanings, and one of them ends in a period
   *  being paid twice. */
  async function readRun(periodId) {
    const snap = await db.collection(runCollection(kindOf(periodId))).doc(periodId).get();
    return snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
  }

  /**
   * What this screen may do with a period.
   *   'free'       — nothing there, records can be entered
   *   'run'        — a real payroll run exists; backfill is refused
   *   'done'       — already backfilled and finished
   *   'unfinished' — a backfill was interrupted; it can be finished
   */
  function classifyRun(run) {
    if (!run) return { status: 'free' };
    const bf = run.backfill || null;
    if (!bf) return { status: 'run', run };
    if (bf.stage === 'complete') return { status: 'done', run, backfill: bf };
    return { status: 'unfinished', run, backfill: bf };
  }

  /** Everyone who could appear on this period's paper payslips.
   *  Includes people who have since left — January's roster is not today's,
   *  and the whole point of this screen is periods that are already over. */
  async function loadRoster(kind) {
    if (kind === 'week') {
      const snap = await db.collection('worker_profiles').get();
      return snap.docs.map((d) => {
        const w = d.data() || {};
        return {
          id: d.id,
          name: w.name || d.id,
          sub: [w.jobTitle || '', w.idNumber || ''].filter(Boolean).join(' · '),
          gone: w.status === 'inactive' || w.removed === true,
          ids: { tinNum: w.tinNum || '', ssNum: w.ssNum || '', phNum: w.phNum || '', pagibigNum: w.pagibigNum || '' },
          extra: { linkedUid: w.linkedUid || null, idNumber: w.idNumber || '', jobTitle: w.jobTitle || '', department: w.department || '' }
        };
      }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }
    // MONTH — the Office Team. fetchUsersWithPayroll merges payroll/{uid}, and
    // reports payrollDenied rather than silently handing back a roster whose
    // pay half is missing by permission (the app's silent-₱0 choke point).
    const snap = await window.fetchUsersWithPayroll();
    const rows = snap.docs.map((d) => {
      const u = Object.assign({ id: d.id }, d.data());
      return {
        id: u.id,
        name: u.displayName || u.email || u.id,
        sub: [u.title || '', u.department || ''].filter(Boolean).join(' · '),
        gone: u.removed === true,
        skip: u.payClass === 'production' || u.role === 'partner',
        ids: { tinNum: u.tinNum || '', ssNum: u.ssNum || '', phNum: u.phNum || '', pagibigNum: u.pagibigNum || '' },
        extra: { employeeId: u.employeeId || '', title: u.title || '', department: u.department || '' }
      };
    }).filter((r) => !r.skip);
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    rows.payrollDenied = !!snap.payrollDenied;
    return rows;
  }

  /** What was recorded for the period BEFORE this one, keyed by person, so the
   *  typist can carry it forward instead of retyping thirty near-identical
   *  rows. Real recorded history only — never a projection from today's rates.
   *  Failure is not fatal: the button simply does not appear. */
  async function loadPrevious(periodId) {
    const kind = kindOf(periodId);
    const out = {};
    if (kind === 'week') {
      const prev = addDaysIso(periodId, -7);
      const snap = await db.collection('payslips').where('payWeekId', '==', prev).get();
      snap.docs.forEach((d) => {
        const p = d.data() || {};
        if (!p.workerId) return;
        const gov = (p.deductions && p.deductions.govt) || {};
        const oth = (p.deductions && p.deductions.other) || {};
        out[p.workerId] = {
          basic: R2((p.regular && p.regular.total) || 0) + R2((p.overtime && p.overtime.total) || 0) + R2((p.travel && p.travel.total) || 0),
          allowance: R2((p.allowances && p.allowances.total) || 0),
          sss: R2(gov.sss), philhealth: R2(gov.philhealth), pagibig: R2(gov.pagibig),
          tax: R2(oth.taxes), other: R2(oth.loans), ca: R2(oth.cashAdvance)
        };
      });
      return { periodId: prev, label: periodLabel(prev), byPerson: out };
    }
    const prev = addDaysIso(periodId + '-01', -1).slice(0, 7);
    const snap = await db.collection('salary_history').where('month', '==', prev).get();
    snap.docs.forEach((d) => {
      const r = d.data() || {};
      if (!r.userId) return;
      out[r.userId] = {
        basic: R2(r.base != null ? r.base : (r.salary || 0)),
        allowance: R2(r.allowance), sss: R2(r.sss),
        philhealth: R2(r.philhealth != null ? r.philhealth : r.philHealth),
        pagibig: R2(r.pagibig != null ? r.pagibig : r.pagIbig),
        tax: R2(r.tax), other: R2(r.deductions), ca: R2(r.caDeducted)
      };
    });
    return { periodId: prev, label: periodLabel(prev), byPerson: out };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  THE FIGURES
  //  Nine typed columns and one computed. The ninth — the cash advance the
  //  worker actually repaid that period — is recorded so the payslip adds up
  //  against the paper. IT IS NOT A COLLECTION: no balance moves, ever.
  // ═══════════════════════════════════════════════════════════════════════

  const FIELDS = [
    { key: 'basic',      label: 'Basic pay',        weekLabel: 'Wages for the week', sign: +1 },
    { key: 'allowance',  label: 'Allowance',        sign: +1 },
    { key: 'sss',        label: 'SSS',              sign: -1 },
    { key: 'philhealth', label: 'PhilHealth',       sign: -1 },
    { key: 'pagibig',    label: 'Pag-IBIG',         sign: -1 },
    { key: 'tax',        label: 'Tax',              sign: -1 },
    { key: 'other',      label: 'Other deductions', sign: -1 },
    { key: 'ca',         label: 'Cash advance repaid', sign: -1 }
  ];

  function fieldLabel(f, kind) { return (kind === 'week' && f.weekLabel) ? f.weekLabel : f.label; }

  /** null = the box is empty (this person was not paid this period).
   *  NaN  = something was typed that is not a peso amount. */
  function parseAmt(v) {
    if (v == null) return null;
    const s = String(v).replace(/[₱,\s]/g, '');
    if (!s) return null;
    if (!/^\d*\.?\d*$/.test(s)) return NaN;
    const n = parseFloat(s);
    return Number.isFinite(n) ? R2(n) : NaN;
  }

  function rowMath(vals) {
    const gross = R2((vals.basic || 0) + (vals.allowance || 0));
    const deductions = R2((vals.sss || 0) + (vals.philhealth || 0) + (vals.pagibig || 0)
      + (vals.tax || 0) + (vals.other || 0) + (vals.ca || 0));
    return { gross, deductions, net: R2(gross - deductions) };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  THE SAVE
  // ═══════════════════════════════════════════════════════════════════════

  const LEDGER_PREFIX = {
    expense: 'PAYBF', sss: 'SSSBF', philhealth: 'PHBF', pagibig: 'HDMFBF',
    tax: 'WHTBF', deductions: 'EMPDEDBF', cashAdvance: 'CABF', net: 'NETBF'
  };
  /** Deterministic per (period, person). A second press overwrites the same
   *  rows through Ledger.upsertByRef instead of booking the money again. The
   *  BF suffix keeps a backfill visibly distinct from PAY-/PAYW- in the books. */
  function ledgerRef(kind, periodId, personId) {
    const k = LEDGER_PREFIX[kind] || String(kind);
    return personId ? k + '-' + periodId + '-' + personId : k + '-' + periodId;
  }

  function noteText(periodId) {
    return 'This is a record of pay you already received for ' + periodLabel(periodId)
      + '. It was entered into the system on ' + todayIso() + ' from the paper payslip, '
      + 'so your records here are complete. No new payment was made.';
  }

  /**
   * Everything a save writes, in the order that fails safely.
   *
   *   1. GUARD      — re-read the run document. A period with a real run is
   *                   refused here, not after the history rows are written.
   *   2. CLAIM      — create the run document (state 'computed') carrying the
   *                   backfill marker, inside a transaction that refuses if
   *                   anything appeared meanwhile. This is the lock, and it is
   *                   also what stops the live payroll computing over the top.
   *   3. HISTORY    — salary_history (month) or payslips (week), deterministic
   *                   ids, so a retry overwrites rather than duplicates.
   *   4. THE BOOKS  — only if the owner said these wages were never recorded.
   *   5. FINALIZE   — walk the run to its terminal state and mark the backfill
   *                   complete.
   *
   * An interruption anywhere leaves a claimed, MARKED, non-terminal period that
   * this screen offers to finish — never a silently half-entered one.
   */
  async function saveBackfill(opts) {
    const periodId = opts.periodId;
    const kind = kindOf(periodId);
    const isMonth = kind === 'month';
    const entries = opts.entries;              // [{ person, vals }]
    const postToBooks = opts.postToBooks;
    const label = periodLabel(periodId);
    const payDate = payDateOf(periodId);
    const runRef = db.collection(runCollection(kind)).doc(periodId);

    if (!entries.length) throw new Error('Nothing was typed in, so there is nothing to save.');

    // ── 1. GUARD ────────────────────────────────────────────────────────
    const cls = classifyRun(await readRun(periodId));
    if (cls.status === 'run') {
      throw new Error(label + ' already has a payroll run in the system. Past records can only be added for a period that has none.');
    }
    if (cls.status === 'done') {
      throw new Error(label + ' has already been entered. A period can only be entered once.');
    }
    // An interrupted attempt that ALREADY added these wages to the accounts
    // cannot be finished as "already in the books": the legs it posted would be
    // left standing with nothing on this screen saying so, and the period would
    // be counted twice with both entries looking legitimate. Refused in words
    // rather than silently cleaned up, because which of the two is true is the
    // one thing this screen is not allowed to decide by itself.
    if (cls.status === 'unfinished' && cls.backfill && cls.backfill.postedToBooks && !postToBooks) {
      throw new Error('The earlier, unfinished attempt at ' + label + ' had already added these wages to the accounts. '
        + 'Finish it the same way ("No, they were never recorded"), or have the accounts corrected first — otherwise the period is left counted twice with nothing to show it.');
    }

    // A closed accounting period cannot be posted into. Only checked when we
    // are actually posting — recording history into a closed month moves no
    // money and must not be blocked.
    if (postToBooks && typeof window.assertPeriodOpen === 'function') {
      await window.assertPeriodOpen(payDate);
    }

    // ── The lines, and the arithmetic that must hold before anything is written ──
    const lines = entries.map((e) => {
      const v = e.vals, m = rowMath(v);
      const common = {
        name: e.person.name,
        base: v.basic || 0, allowance: v.allowance || 0,
        sss: v.sss || 0, philhealth: v.philhealth || 0, pagibig: v.pagibig || 0, tax: v.tax || 0,
        otherDeductions: v.other || 0,
        // ⚠ NOT `caDeducted`/`caDeduction`, which every live path treats as an
        //   instruction to collect. This is a record of a repayment that
        //   already happened.
        caBackfilled: v.ca || 0,
        gross: m.gross, net: m.net, backfill: true
      };
      return isMonth
        ? Object.assign({ uid: e.person.id, caPlanned: 0, netBeforeCA: m.net, finalPay: m.net }, common)
        : Object.assign({ workerId: e.person.id, caDeduction: 0, allowanceTotal: v.allowance || 0,
            regularPay: v.basic || 0, otherDeductionsOnly: v.other || 0,
            statutory: { sss: v.sss || 0, philhealth: v.philhealth || 0, pagibig: v.pagibig || 0,
                         tax: v.tax || 0, total: R2((v.sss || 0) + (v.philhealth || 0) + (v.pagibig || 0) + (v.tax || 0)) } }, common);
    });

    const totals = lines.reduce((t, l) => ({
      people: t.people + 1,
      gross: R2(t.gross + l.gross), net: R2(t.net + l.net),
      sss: R2(t.sss + l.sss), philhealth: R2(t.philhealth + l.philhealth),
      pagibig: R2(t.pagibig + l.pagibig), tax: R2(t.tax + l.tax),
      other: R2(t.other + l.otherDeductions), ca: R2(t.ca + l.caBackfilled)
    }), { people: 0, gross: 0, net: 0, sss: 0, philhealth: 0, pagibig: 0, tax: 0, other: 0, ca: 0 });

    // Debits must equal credits before a single leg is posted. By construction
    // net = gross − everything, so a mismatch means a rounding fault, and a
    // ledger that does not balance is worse than a period left un-entered.
    const credits = R2(totals.sss + totals.philhealth + totals.pagibig + totals.tax + totals.other + totals.ca + totals.net);
    if (Math.abs(credits - totals.gross) > 0.01) {
      throw new Error('These figures do not balance: the pay adds up to ' + peso(totals.gross)
        + ' but the deductions and take-home add up to ' + peso(credits) + '. Nothing was saved.');
    }

    const marker = {
      stage: 'writing',
      postedToBooks: !!postToBooks,
      // ── INTEROP with js/payroll.js (window.Payroll), written in parallel ──
      // Its engine reads TWO fields off this marker and nothing else:
      //   backfill.isBackfill   — suppresses cash-advance collection when it
      //                           refolds the lines
      //   backfill.postToLedger — refuses a release that would post wages
      //                           already in the books
      // The contract fixed the field NAME (`backfill`) but not its contents, so
      // the two halves named the same two facts differently. Both spellings are
      // written rather than either being renamed: dropping one silently kills a
      // money guard on the other side.
      isBackfill: true,
      postToLedger: !!postToBooks,
      booksAnswer: postToBooks
        ? 'These wages were NOT in the books — this record added them.'
        : 'These wages were ALREADY in the books — this record did not add them again.',
      source: 'paper payslips',
      enteredBy: meUid(), enteredByName: meName(), enteredOn: todayIso(),
      people: totals.people, gross: totals.gross, net: totals.net
    };

    // ── 2. CLAIM ────────────────────────────────────────────────────────
    // Resuming an interrupted attempt re-uses the existing claim rather than
    // creating a second one.
    if (cls.status !== 'unfinished') {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(runRef);
        if (snap.exists) {
          throw new Error('Somebody else started ' + label + ' while this was open. Nothing was saved — reload and check.');
        }
        const base = {
          state: 'computed', label, backfilled: true, backfill: marker,
          lines, totals,
          computedAt: stamp(), computedBy: meUid(), computedByName: meName()
        };
        if (isMonth) base.month = periodId;
        else {
          base.weekId = periodId;
          base.month = window.payWeekMonth(periodId);
          base.days = window.payWeekDays(periodId);
        }
        tx.set(runRef, base);
      });
    } else {
      await runRef.set({ lines, totals, backfill: marker }, { merge: true }).catch(() => {
        // A rules refusal here is not fatal — the claim already carries a
        // marker and the history below is addressed deterministically.
      });
    }

    // ── 3. HISTORY ──────────────────────────────────────────────────────
    const written = [];
    const note = { text: noteText(periodId), setBy: meUid(), setByName: meName(), setAt: todayIso() };

    if (isMonth) {
      // salary_history/{uid}_{month} — the Office Team's payslip record, the
      // alphalist's source, and what 13th-month is computed from.
      for (let i = 0; i < entries.length; i += 400) {
        const batch = db.batch();
        entries.slice(i, i + 400).forEach((e) => {
          const v = e.vals, m = rowMath(v);
          batch.set(db.collection('salary_history').doc(e.person.id + '_' + periodId), {
            userId: e.person.id, userName: e.person.name, month: periodId, runMonth: periodId,
            salary: v.basic || 0, allowance: v.allowance || 0,
            deductions: v.other || 0,
            deductionsWithheld: v.other || 0, deductionsUnearned: 0,
            sss: v.sss || 0, philhealth: v.philhealth || 0, pagibig: v.pagibig || 0, tax: v.tax || 0,
            philHealth: v.philhealth || 0, pagIbig: v.pagibig || 0,   // legacy mixed-case mirror
            // ZERO, always. The instalment shown on the paper payslip is kept
            // under its own name so nothing that reads `caDeducted` as a
            // collection can act on it.
            caDeducted: 0, caBackfilled: v.ca || 0,
            netPay: m.net, finalPay: m.net,
            tinNum: e.person.ids.tinNum, ssNum: e.person.ids.ssNum,
            phNum: e.person.ids.phNum, pagibigNum: e.person.ids.pagibigNum,
            employeeId: e.person.extra.employeeId || '',
            title: e.person.extra.title || '', department: e.person.extra.department || '',
            // The permanent, visible mark. hrNote is printed on the payslip
            // template and shown on the employee's own pay history today, so
            // this is visible without any other file changing.
            backfill: true, backfilledAt: stamp(), backfilledBy: meUid(), backfilledByName: meName(),
            backfillPostedToBooks: !!postToBooks, backfillSource: 'paper payslips',
            hrNote: note,
            recordedBy: meUid(), recordedAt: stamp()
          }, { merge: true });
        });
        await batch.commit();
        written.push(entries.slice(i, i + 400).length);
      }
    } else {
      // payslips/WK-{monday}-{workerId} — the same doc id and the same shape
      // WeeklyRun.disburse writes, so window.toPayslipModel(doc,'weekly')
      // renders it with nothing changed.
      const dates = window.payWeekDays(periodId);
      for (let i = 0; i < entries.length; i += 400) {
        const batch = db.batch();
        entries.slice(i, i + 400).forEach((e) => {
          const v = e.vals, m = rowMath(v);
          const gov = R2((v.sss || 0) + (v.philhealth || 0) + (v.pagibig || 0));
          const oth = R2((v.ca || 0) + (v.other || 0) + (v.tax || 0));
          batch.set(db.collection('payslips').doc('WK-' + periodId + '-' + e.person.id), {
            workerId: e.person.id, workerName: e.person.name,
            workerIdNum: e.person.extra.idNumber || '', jobTitle: e.person.extra.jobTitle || '',
            department: e.person.extra.department || '',
            tinNum: e.person.ids.tinNum, ssNum: e.person.ids.ssNum,
            phNum: e.person.ids.phNum, pagibigNum: e.person.ids.pagibigNum,
            payPeriodStart: dates[0], payPeriodEnd: dates[6],
            payPeriodMonth: window.payWeekMonth(periodId),
            payDate: dates[6], company: 'Barro Kitchens',
            // The visible mark on a weekly payslip: the printed template shows
            // "Prepared by" and has no note row. See the handoff note — the
            // template wants a proper backfilled band.
            preparedBy: meName() + ' — entered from the paper payslip',
            regular: { dailyRate: 0, ratePerHr: 0, hrsWorked: 0, total: v.basic || 0 },
            overtime: { ratePerHr: 0, hours: 0, total: 0 },
            travel: { ratePerHr: 0, hours: 0, total: 0 },
            allowances: { total: v.allowance || 0 },
            grossPay: m.gross,
            deductions: {
              govt: { sss: v.sss || 0, philhealth: v.philhealth || 0, pagibig: v.pagibig || 0, total: gov },
              // Shown so the payslip reconciles against the paper. NOTHING
              // collects against it — see collectCa, which never runs here.
              other: { cashAdvance: v.ca || 0, loans: v.other || 0, taxes: v.tax || 0, total: oth }
            },
            employerShare: null,
            totalDeductions: m.deductions, totalPay: m.net, paid: 0, netPay: m.net,
            schedule: [],
            // status 'submitted' + payWeekId + source keep isRunGeneratedPayslip
            // true, so the Submit transition (which posts its own WPAY- ledger
            // row) can never fire on top of this record.
            status: 'submitted', postedByRun: true,
            payWeekId: periodId, payWeek: periodId, source: 'payroll-backfill',
            backfill: true, backfilledAt: stamp(), backfilledBy: meUid(), backfilledByName: meName(),
            backfillPostedToBooks: !!postToBooks, backfillSource: 'paper payslips',
            backfillNote: note.text,
            createdBy: meUid(), createdAt: stamp(), updatedAt: stamp()
          }, { merge: true });
        });
        await batch.commit();
        written.push(entries.slice(i, i + 400).length);
      }
    }

    // ── 4. THE BOOKS ────────────────────────────────────────────────────
    const ledgerRefs = [];
    if (postToBooks) {
      const post = async (ref, entry) => {
        await window.Ledger.upsertByRef(ref, () => ({
          ref, date: payDate, kind: entry.kind, accountType: entry.accountType,
          account: entry.account, category: entry.category,
          description: entry.description, amount: entry.amount,
          source: 'Finance', extra: { backfill: true, backfillPeriod: periodId }
        }));
        ledgerRefs.push(ref);
      };
      for (const l of lines) {
        if (l.gross <= 0) continue;
        const pid = isMonth ? l.uid : l.workerId;
        await post(ledgerRef('expense', periodId, pid), {
          kind: 'debit', accountType: 'expense', account: 'Payroll Expense', category: 'Payroll Expense',
          description: 'Pay for ' + label + ' — ' + l.name + ' (entered from the paper record)',
          amount: l.gross
        });
      }
      const creditLegs = [
        ['sss', 'liability', 'SSS Payable', 'SSS Payable', totals.sss],
        ['philhealth', 'liability', 'PhilHealth Payable', 'PhilHealth Payable', totals.philhealth],
        ['pagibig', 'liability', 'Pag-IBIG Payable', 'Pag-IBIG Payable', totals.pagibig],
        ['tax', 'liability', 'Withholding Tax Payable', 'Withholding Tax Payable', totals.tax],
        ['deductions', 'liability', 'Employee Deductions Payable', 'Employee Deductions Payable', totals.other],
        // The repayment side of a cash advance retires the SAME receivable the
        // advance debited. No cash_advances document is touched — this is the
        // books catching up with a repayment that already happened.
        ['cashAdvance', 'asset', 'Advances to Employees', 'Cash Advance', totals.ca],
        ['net', 'asset', 'Cash', 'Payroll Expense', totals.net]
      ];
      for (const [k, accountType, account, category, amount] of creditLegs) {
        if (R2(amount) <= 0) continue;
        await post(ledgerRef(k, periodId), {
          kind: 'credit', accountType, account, category,
          description: account + ' — ' + label + ' (entered from the paper record)',
          amount: R2(amount)
        });
      }
      // ── A RESUMED SAVE MUST NOT LEAVE A STALE EXPENSE LEG ──────────────
      // If an interrupted attempt posted the books for someone whose row is
      // now blank, their Payroll Expense debit is still there and this period's
      // wages are overstated by exactly that amount. Zeroed in place through
      // the same deterministic ref — never deleted (that verb is President-only
      // on /ledger) and never reversed with a contra entry (this ledger models
      // corrections as overwrite-in-place, so a reversal would double up on a
      // second resume).
      //
      // The existence probe keeps junk out of the books: a ref that was never
      // posted is left alone rather than written as a brand-new ₱0.00 row. A
      // failed probe is treated as "nothing was posted" — leaving a stale row
      // is a visible bookkeeping error a human can correct, while aborting here
      // would stop halfway through a period that is already part-written.
      const priorLines = (cls.status === 'unfinished' && cls.run && Array.isArray(cls.run.lines)) ? cls.run.lines : [];
      if (priorLines.length) {
        const stillIn = new Set(lines.map((l) => (isMonth ? l.uid : l.workerId)));
        for (const old of priorLines) {
          const pid = isMonth ? old.uid : old.workerId;
          if (!pid || stillIn.has(pid)) continue;
          const ref = ledgerRef('expense', periodId, pid);
          const probe = await db.collection('ledger').where('refNumber', '==', ref).limit(1).get().catch(() => null);
          if (!probe || !probe.docs.length) continue;
          await post(ref, {
            kind: 'debit', accountType: 'expense', account: 'Payroll Expense', category: 'Payroll Expense',
            description: 'Pay for ' + label + ' — ' + (old.name || pid)
              + ' — ₱0.00 (removed from this record; previously posted amount cleared)',
            amount: 0
          });
        }
      }
      if (typeof window.dbCacheInvalidate === 'function') window.dbCacheInvalidate('ledger');
    }

    // ── 5. FINALIZE ─────────────────────────────────────────────────────
    // STATE-AWARE, because firestore.rules only permits the transitions that
    // MOVE. A resumed save whose first attempt already reached 'verified' would
    // be refused outright by re-issuing verified -> verified, which is not a
    // clause in either collection's rule — so the walk starts from wherever the
    // document actually is. The terminal write carries the completed marker and
    // the ledger refs in the SAME update, so a document that says 'disbursed'
    // always says 'complete' too.
    const CHAIN = ['computed', 'verified', 'disbursing', 'disbursed'];
    const done = Object.assign({}, marker, { stage: 'complete', ledgerRefs, completedOn: todayIso() });
    const stepMeta = {
      verified:   () => ({ verifiedAt: stamp(), verifiedBy: meUid(), verifiedByName: meName() }),
      disbursing: () => ({ disbursingAt: stamp(), disbursingBy: meUid(), disbursingByName: meName() }),
      disbursed:  () => ({ backfill: done, ledgerRefs, disbursedAt: stamp(), disbursedBy: meUid(), disbursedByName: meName() })
    };
    let finished = true, finishError = '';
    try {
      const now = await runRef.get();
      let at = CHAIN.indexOf((now.data() || {}).state || 'computed');
      if (at < 0) at = 0;
      for (let i = at + 1; i < CHAIN.length; i++) {
        await runRef.update(Object.assign({ state: CHAIN[i] }, stepMeta[CHAIN[i]]()));
      }
    } catch (err) {
      finished = false;
      finishError = (err && (err.message || err.code)) || 'the last step was refused.';
    }

    // NO NOTIFICATIONS. Nobody wants a push about March. Deliberate, and the
    // one place a future edit would most easily undo it.
    if (window.logAudit) {
      window.logAudit('payroll-backfill', runCollection(kind), periodId, {
        people: totals.people, gross: totals.gross, net: totals.net,
        postedToBooks: !!postToBooks, finished
      });
    }

    return { people: totals.people, gross: totals.gross, net: totals.net, ledgerRefs, finished, finishError };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  STYLES — self-contained, injected once. Nothing outside this file is
  //  touched, so the screen carries its own phone layout.
  // ═══════════════════════════════════════════════════════════════════════

  function injectStyles() {
    if (document.getElementById('pbf-styles')) return;
    const s = document.createElement('style');
    s.id = 'pbf-styles';
    s.textContent = [
      '.pbf-wrap{max-width:100%}',
      '.pbf-note{font-size:13px;color:var(--text-muted);line-height:1.5;margin:0 0 12px}',
      '.pbf-pick{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px}',
      '.pbf-pick label{display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px}',
      '.pbf-pick select{min-width:220px;max-width:100%;padding:9px 10px;font-size:15px;border:1px solid var(--border,#ddd);border-radius:8px;background:var(--surface,#fff);color:var(--text,#111)}',
      '.pbf-books{border:1px solid var(--border,#ddd);border-radius:10px;padding:12px;margin:0 0 12px}',
      '.pbf-books legend{font-size:14px;font-weight:600;padding:0 6px}',
      '.pbf-books .pbf-opt{display:flex;gap:10px;align-items:flex-start;padding:8px;border-radius:8px;cursor:pointer}',
      '.pbf-books .pbf-opt:hover{background:var(--surface2,rgba(0,0,0,.03))}',
      '.pbf-books .pbf-opt input{margin-top:3px;flex:0 0 auto;width:18px;height:18px}',
      '.pbf-books .pbf-opt span{font-size:13px;line-height:1.5}',
      '.pbf-gridwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;border:1px solid var(--border,#ddd);border-radius:10px}',
      '.pbf-grid{width:100%;border-collapse:collapse;font-size:13px}',
      '.pbf-grid th,.pbf-grid td{padding:7px 8px;text-align:left;border-bottom:1px solid var(--border,#eee);white-space:normal;overflow-wrap:anywhere}',
      '.pbf-grid thead th{position:sticky;top:0;background:var(--surface2,#f6f6f6);font-size:11px;text-transform:uppercase;letter-spacing:.03em;z-index:1}',
      '.pbf-grid tbody th{font-weight:600;min-width:150px}',
      '.pbf-sub{display:block;font-weight:400;font-size:11px;color:var(--text-muted)}',
      '.pbf-gone{display:inline-block;font-size:10px;padding:1px 6px;border-radius:99px;background:var(--surface2,#eee);color:var(--text-muted);margin-left:6px}',
      '.pbf-grid input{width:100%;min-width:88px;padding:7px 8px;font-size:15px;text-align:right;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--surface,#fff);color:var(--text,#111)}',
      '.pbf-grid input:focus{outline:2px solid var(--primary,#2f6fed);outline-offset:1px}',
      '.pbf-grid input.pbf-bad{border-color:var(--danger,#e64980);background:rgba(230,73,128,.08)}',
      // A peso amount broken across three lines is a peso amount nobody can
      // read. The take-home column has no input to hold it open, so table
      // auto-layout squeezes it to the width of one character — measured at
      // 1280px before this was added.
      '.pbf-net{font-weight:700;text-align:right;white-space:normal;min-width:112px}',
      '.pbf-grid thead th:last-child{min-width:112px}',
      '.pbf-neg{color:var(--danger,#e64980)}',
      '.pbf-grid tfoot td,.pbf-grid tfoot th{background:var(--surface2,#f6f6f6);font-weight:700;border-top:2px solid var(--border,#ddd)}',
      '.pbf-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}',
      '.pbf-confirm{border:1px solid var(--primary,#2f6fed);border-radius:10px;padding:12px;margin:12px 0;background:rgba(47,111,237,.06)}',
      '.pbf-confirm h4{margin:0 0 6px;font-size:15px}',
      '.pbf-confirm p{margin:0 0 8px;font-size:13px;line-height:1.5}',
      '.pbf-panel{border:1px solid var(--border,#ddd);border-radius:10px;padding:14px;margin:12px 0}',
      '.pbf-panel.pbf-warn{border-color:var(--danger,#e64980);background:rgba(230,73,128,.07)}',
      '.pbf-panel.pbf-ok{border-color:var(--success,#2f9e44);background:rgba(47,158,68,.09)}',
      // ── PHONE: every row becomes a card, every figure labelled, nothing
      //    hidden, nothing truncated, no sideways scroll.
      '@media (max-width:760px){',
      '.pbf-gridwrap{overflow-x:visible;border:0;border-radius:0}',
      '.pbf-grid,.pbf-grid tbody,.pbf-grid tfoot,.pbf-grid tr,.pbf-grid td,.pbf-grid th{display:block;width:auto}',
      '.pbf-grid thead{display:none}',
      '.pbf-grid tbody tr,.pbf-grid tfoot tr{border:1px solid var(--border,#ddd);border-radius:10px;padding:8px;margin-bottom:10px;background:var(--surface,#fff)}',
      '.pbf-grid tbody th{border:0;padding:2px 2px 8px;font-size:15px}',
      '.pbf-grid td{border:0;padding:4px 2px;display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '.pbf-grid td::before{content:attr(data-label);font-size:12px;color:var(--text-muted);flex:1 1 auto}',
      '.pbf-grid td input{flex:0 0 44%;min-width:0}',
      '.pbf-grid td.pbf-net{border-top:1px solid var(--border,#eee);margin-top:4px;padding-top:8px;font-size:15px;min-width:0}',
      '.pbf-grid tfoot td::before{font-weight:600}',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  THE SCREEN
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @param container  where to render (defaults to deptContainer()).
   * @param opts       { periodId } to open straight onto a period,
   *                   { onDone(periodId) } called after a successful save so the
   *                   unified payroll screen can go back to it.
   */
  window.renderPayrollBackfill = async function (container, currentUser, currentRole, opts) {
    const c = container || (typeof deptContainer === 'function' ? deptContainer() : null);
    if (!c) return;
    const o = opts || {};
    injectStyles();

    // EVERY lookup is scoped to `c`. openPage keeps a dying panel alive for
    // ~300ms and its ids are identical to this one's.
    const $ = (sel) => c.querySelector(sel);

    const canWrite = (typeof window.isMoneyPriv === 'function') ? window.isMoneyPriv()
      : ['president', 'owner', 'manager', 'finance'].includes(window.currentRole || '');
    const isPres = (typeof window.isRealPresident === 'function') ? window.isRealPresident()
      : (window.currentRole === 'president');

    const months = monthOptions();
    const weeks = weekOptions();

    let periodId = o.periodId || months[0] || weeks[0] || '';
    let booksAnswer = null;      // 'in' | 'out'

    c.innerHTML = ''
      + '<div class="pbf-wrap">'
      + '<div class="page-header"><h2>' + ico('🗂', 20) + ' Add past pay records</h2></div>'
      + '<p class="pbf-note">Pay that was handed out before this system — or outside it — typed in from the paper payslips, '
      + 'so payslip archives, year-to-date figures, 13th-month pay and the BIR alphalist are complete. '
      + 'This records what was already paid. <strong>It pays nobody and it notifies nobody.</strong></p>'
      + (canWrite ? '' : '<div class="pbf-panel pbf-warn">' + ico('🔒', 16) + ' Past pay records can only be added by Finance or the President.</div>')
      + '<div class="pbf-pick">'
      + '  <div><label for="pbf-period">Which period are you entering?</label>'
      + '  <select id="pbf-period"' + (canWrite ? '' : ' disabled') + '>'
      + (months.length ? '<optgroup label="Months — Office Team">' + months.map((m) => '<option value="' + esc(m) + '"' + (m === periodId ? ' selected' : '') + '>' + esc(periodLabel(m)) + '</option>').join('') + '</optgroup>' : '')
      + (weeks.length ? '<optgroup label="Weeks — Operations Team">' + weeks.map((w) => '<option value="' + esc(w) + '"' + (w === periodId ? ' selected' : '') + '>' + esc(periodLabel(w)) + '</option>').join('') + '</optgroup>' : '')
      + '  </select></div>'
      + '</div>'
      + '<div id="pbf-body"></div>'
      + '</div>';

    if (window.lucide) lucide.createIcons({ nodes: [c] });

    const bodyEl = $('#pbf-body');
    if (!bodyEl) return;

    // Selecting a period repaints ONLY the body — the picker keeps its place.
    const sel = $('#pbf-period');
    if (sel) sel.addEventListener('change', () => { periodId = sel.value; booksAnswer = null; drawPeriod(); });

    // ── the per-period body ────────────────────────────────────────────
    async function drawPeriod() {
      if (!periodId) {
        bodyEl.innerHTML = '<div class="pbf-panel">There are no completed periods in this tax year yet.</div>';
        return;
      }
      const kind = kindOf(periodId);
      const label = periodLabel(periodId);
      bodyEl.innerHTML = window.skeletonHtml ? window.skeletonHtml('rows') : '<p>Loading…</p>';

      let cls, roster, prev = null;
      try {
        cls = classifyRun(await readRun(periodId));
      } catch (err) {
        if (!bodyEl.isConnected) return;
        // A denied or failed read must never render as "this period is free".
        bodyEl.innerHTML = '<div class="pbf-panel pbf-warn"><strong>' + ico('⚠', 16)
          + ' ' + esc(label) + ' could not be checked.</strong><p class="pbf-note">Until the system can read whether this period already has a payroll run, nothing can be entered for it — entering a second set of records for a period that was already paid is exactly what this check exists to stop.<br>' + esc((err && err.message) || err) + '</p></div>';
        return;
      }
      if (!bodyEl.isConnected) return;

      if (cls.status === 'run') {
        bodyEl.innerHTML = '<div class="pbf-panel pbf-warn"><strong>' + ico('⛔', 16) + ' ' + esc(label)
          + ' already has a payroll run in the system.</strong>'
          + '<p class="pbf-note">Past records can only be added for a period with no run at all. If they disagreed there would be no way to tell which one is true.</p></div>';
        return;
      }
      if (cls.status === 'done') {
        const bf = cls.backfill || {};
        bodyEl.innerHTML = '<div class="pbf-panel pbf-ok"><strong>' + ico('✅', 16) + ' ' + esc(label)
          + ' was already entered.</strong>'
          + '<p class="pbf-note">' + esc(bf.people || 0) + ' ' + ((bf.people === 1) ? 'person' : 'people')
          + ', ' + esc(peso(bf.net || 0)) + ' take-home. Entered by ' + esc(bf.enteredByName || bf.enteredBy || '—')
          + (bf.enteredOn ? ' on ' + esc(bf.enteredOn) : '') + '.<br><strong>' + esc(bf.booksAnswer || '') + '</strong></p></div>';
        return;
      }

      try {
        roster = await loadRoster(kind);
      } catch (err) {
        if (!bodyEl.isConnected) return;
        bodyEl.innerHTML = '<div class="pbf-panel pbf-warn"><strong>' + ico('⚠', 16)
          + ' The list of people could not be read.</strong><p class="pbf-note">Nothing is shown rather than an empty list — an empty list here reads as "nobody worked that period".<br>'
          + esc((err && err.message) || err) + '</p></div>';
        return;
      }
      if (!bodyEl.isConnected) return;
      if (!roster.length) {
        bodyEl.innerHTML = '<div class="pbf-panel">There is nobody on the '
          + (kind === 'week' ? 'Operations Team' : 'Office Team') + ' roster to enter records for.</div>';
        return;
      }

      try { prev = await loadPrevious(periodId); } catch (_) { prev = null; }
      if (!bodyEl.isConnected) return;
      const prevCount = prev ? Object.keys(prev.byPerson).length : 0;

      // Can this person actually FINISH a save for this kind of period?
      // Asked before any typing, never after. (firestore.rules: the terminal
      // transition on pay_runs is President-only.)
      const canFinish = canWrite && (kind === 'week' || isPres);

      const cols = FIELDS.map((f) => '<th>' + esc(fieldLabel(f, kind)) + '</th>').join('');
      const rowsHtml = roster.map((p) => ''
        + '<tr data-person="' + esc(p.id) + '">'
        + '<th scope="row">' + esc(p.name)
        + (p.gone ? '<span class="pbf-gone">no longer on the roster</span>' : '')
        + (p.sub ? '<span class="pbf-sub">' + esc(p.sub) + '</span>' : '')
        + '</th>'
        + FIELDS.map((f) => '<td data-label="' + esc(fieldLabel(f, kind)) + '">'
            + '<input type="text" inputmode="decimal" autocomplete="off" data-f="' + esc(f.key) + '"'
            + ' aria-label="' + esc(fieldLabel(f, kind) + ' for ' + p.name) + '"'
            + (canWrite ? '' : ' disabled') + '></td>').join('')
        + '<td class="pbf-net" data-label="Take-home">—</td>'
        + '</tr>').join('');

      const footCols = FIELDS.map((f) => '<td class="pbf-net" data-total="' + esc(f.key) + '" data-label="' + esc(fieldLabel(f, kind)) + '">' + esc(peso(0)) + '</td>').join('');

      bodyEl.innerHTML = ''
        + (cls.status === 'unfinished'
            ? '<div class="pbf-panel pbf-warn"><strong>' + ico('⚠', 16) + ' ' + esc(label) + ' was started but not finished.</strong>'
              + '<p class="pbf-note">Type the figures again and save — every record is written to the same place, so nothing is duplicated by finishing it.</p></div>'
            : '')
        + (roster.payrollDenied
            ? '<div class="pbf-panel pbf-warn">' + ico('⚠', 16) + ' Pay details could not be read for this list, so nothing is pre-filled. Type every figure from the paper payslip.</div>'
            : '')
        + (!canFinish && canWrite
            ? '<div class="pbf-panel pbf-warn"><strong>' + ico('🔒', 16) + ' Only the President can save a month.</strong>'
              + '<p class="pbf-note">Recording a month as paid is the same step as releasing one, and the system reserves that for the President. Weeks can be saved by Finance. Rather than let you type thirty rows and refuse at the end, this is said now.</p></div>'
            : '')

        // ── THE QUESTION. Asked per period, in plain words, before anything
        //    is saved, and stored on the record.
        + '<fieldset class="pbf-books" id="pbf-books">'
        + '<legend>' + esc(label) + ' — were these wages already in the books?</legend>'
        + '<label class="pbf-opt"><input type="radio" name="pbf-books" value="in"' + (canWrite ? '' : ' disabled') + '>'
        + '<span><strong>Yes, they are already in the accounts.</strong> Somebody recorded this pay at the time — by hand, in a journal entry, or in whatever was used before. '
        + 'Saving here writes the payslips and the history <em>only</em>. It will not add the wages to the accounts a second time.</span></label>'
        + '<label class="pbf-opt"><input type="radio" name="pbf-books" value="out"' + (canWrite ? '' : ' disabled') + '>'
        + '<span><strong>No, they were never recorded.</strong> Saving here writes the payslips <em>and</em> adds these wages to the accounts, dated ' + esc(payDateOf(periodId)) + '.</span></label>'
        + '<p class="pbf-note" style="margin:6px 2px 0">Only you can answer this — it depends on what was done outside this app. Guessing is wrong in both directions: adding them twice overstates every report, and leaving them out understates wages by exactly this amount. Your answer is saved with the record so whoever checks the accounts later can see it.</p>'
        + '</fieldset>'

        + (prevCount && canWrite
            ? '<div class="pbf-actions"><button class="btn-secondary" id="pbf-copy">' + ico('📋', 14)
              + ' Copy the figures recorded for ' + esc(prev.label) + '</button>'
              + '<span class="pbf-note" style="align-self:center;margin:0">Fills only the people whose row is still completely empty. Check every figure against the paper.</span></div>'
            : '')

        + '<div class="pbf-gridwrap"><table class="pbf-grid">'
        + '<thead><tr><th>' + (kind === 'week' ? 'Worker' : 'Employee') + '</th>' + cols + '<th>Take-home</th></tr></thead>'
        + '<tbody>' + rowsHtml + '</tbody>'
        + '<tfoot><tr><th scope="row">Total — <span id="pbf-count">0</span> entered</th>' + footCols
        + '<td class="pbf-net" data-total="net" data-label="Take-home">' + esc(peso(0)) + '</td></tr></tfoot>'
        + '</table></div>'
        + '<p class="pbf-note">Leave a person\'s row completely empty if they were not paid this period — nothing is written for them. '
        + 'Tab moves across a person\'s figures; Enter moves down the same column.</p>'
        + '<div id="pbf-confirm"></div>'
        + '<div class="pbf-actions">'
        + '<button class="btn-primary" id="pbf-save"' + (canFinish ? '' : ' disabled') + '>' + ico('💾', 14) + ' Save these records</button>'
        + '</div>';

      if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });

      const tableEl = bodyEl.querySelector('.pbf-grid');
      const rosterById = {};
      roster.forEach((p) => { rosterById[p.id] = p; });

      // ── live arithmetic ───────────────────────────────────────────────
      function readRow(tr) {
        const vals = {}; let bad = false;
        FIELDS.forEach((f) => {
          const input = tr.querySelector('input[data-f="' + f.key + '"]');
          const parsed = parseAmt(input ? input.value : '');
          if (Number.isNaN(parsed)) { bad = true; input.classList.add('pbf-bad'); }
          else if (input) input.classList.remove('pbf-bad');
          vals[f.key] = Number.isNaN(parsed) ? 0 : (parsed == null ? null : parsed);
        });
        const touched = FIELDS.some((f) => vals[f.key] != null);
        const clean = {}; FIELDS.forEach((f) => { clean[f.key] = vals[f.key] || 0; });
        return { vals: clean, touched, bad };
      }

      function recalc() {
        const totals = { net: 0 }; FIELDS.forEach((f) => { totals[f.key] = 0; });
        let count = 0;
        tableEl.querySelectorAll('tbody tr').forEach((tr) => {
          const r = readRow(tr);
          const cell = tr.querySelector('.pbf-net');
          if (!r.touched) { cell.textContent = '—'; cell.classList.remove('pbf-neg'); return; }
          const m = rowMath(r.vals);
          cell.textContent = peso(m.net);
          cell.classList.toggle('pbf-neg', m.net < 0);
          count++;
          FIELDS.forEach((f) => { totals[f.key] = R2(totals[f.key] + r.vals[f.key]); });
          totals.net = R2(totals.net + m.net);
        });
        FIELDS.forEach((f) => {
          const td = tableEl.querySelector('[data-total="' + f.key + '"]');
          if (td) td.textContent = peso(totals[f.key]);
        });
        const netTd = tableEl.querySelector('[data-total="net"]');
        if (netTd) netTd.textContent = peso(totals.net);
        const cnt = bodyEl.querySelector('#pbf-count');
        if (cnt) cnt.textContent = String(count);
        return { totals, count };
      }

      tableEl.addEventListener('input', recalc);

      // Enter = the same column, one person down. Typing a column at a time is
      // how a stack of paper payslips is actually read.
      tableEl.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        const input = ev.target;
        if (!input || input.tagName !== 'INPUT') return;
        ev.preventDefault();
        const tr = input.closest('tr');
        const next = tr && tr.nextElementSibling;
        const to = next && next.querySelector('input[data-f="' + input.dataset.f + '"]');
        if (to) { to.focus(); to.select(); }
      });

      // ── carry the previous period forward ─────────────────────────────
      const copyBtn = bodyEl.querySelector('#pbf-copy');
      if (copyBtn) copyBtn.addEventListener('click', () => {
        let filled = 0;
        tableEl.querySelectorAll('tbody tr').forEach((tr) => {
          const src = prev.byPerson[tr.dataset.person];
          if (!src) return;
          if (readRow(tr).touched) return;              // never overwrite typing
          FIELDS.forEach((f) => {
            const input = tr.querySelector('input[data-f="' + f.key + '"]');
            const v = src[f.key];
            if (input && v) input.value = String(v);
          });
          filled++;
        });
        recalc();
        if (window.Notifs) Notifs.showToast(filled
          ? filled + ' ' + (filled === 1 ? 'person' : 'people') + ' filled from ' + prev.label + ' — check every figure against the paper.'
          : 'Nothing to copy — every row already has figures typed in.', filled ? 'success' : 'info');
      });

      // ── books answer ──────────────────────────────────────────────────
      bodyEl.querySelectorAll('input[name="pbf-books"]').forEach((r) => {
        r.addEventListener('change', () => { booksAnswer = r.value; bodyEl.querySelector('#pbf-confirm').innerHTML = ''; });
      });

      // ── save ──────────────────────────────────────────────────────────
      const confirmHost = bodyEl.querySelector('#pbf-confirm');
      const saveBtn = bodyEl.querySelector('#pbf-save');

      function gather() {
        const entries = []; const problems = [];
        tableEl.querySelectorAll('tbody tr').forEach((tr) => {
          const person = rosterById[tr.dataset.person];
          const r = readRow(tr);
          if (r.bad) { problems.push(person.name + ' — one of the boxes is not a peso amount.'); return; }
          if (!r.touched) return;
          const m = rowMath(r.vals);
          // Money note: never emit a zero line. A row with deductions and no
          // pay is a typo, and a ₱0 payslip in the archive is worse than none.
          if (m.gross <= 0) { problems.push(person.name + ' — there are deductions but no pay. Type the pay, or clear the row.'); return; }
          if (m.net < 0) { problems.push(person.name + ' — the deductions come to more than the pay (' + peso(m.net) + ').'); return; }
          entries.push({ person, vals: r.vals });
        });
        return { entries, problems };
      }

      saveBtn.addEventListener('click', () => {
        const { entries, problems } = gather();
        if (problems.length) {
          confirmHost.innerHTML = '<div class="pbf-panel pbf-warn"><strong>' + ico('⚠', 16) + ' Fix these first</strong><p class="pbf-note">'
            + problems.map(esc).join('<br>') + '</p></div>';
          confirmHost.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (!entries.length) {
          if (window.Notifs) Notifs.showToast('Type at least one person\'s figures first.', 'error');
          return;
        }
        if (!booksAnswer) {
          confirmHost.innerHTML = '<div class="pbf-panel pbf-warn"><strong>' + ico('⚠', 16)
            + ' Answer the question above first.</strong><p class="pbf-note">Whether these wages are already in the accounts decides what this save does, and it cannot be worked out from the figures.</p></div>';
          bodyEl.querySelector('#pbf-books').scrollIntoView({ block: 'nearest' });
          return;
        }

        // The confirmation is an INLINE panel, never a modal: closeModal() is
        // history.back() and asynchronous, and a phone keyboard plus a dialog
        // over a thirty-row grid is how a save gets abandoned half-typed.
        const t = entries.reduce((s, e) => { const m = rowMath(e.vals); return { gross: R2(s.gross + m.gross), net: R2(s.net + m.net) }; }, { gross: 0, net: 0 });
        confirmHost.innerHTML = '<div class="pbf-confirm">'
          + '<h4>' + ico('📄', 16) + ' Save ' + esc(String(entries.length)) + ' ' + (entries.length === 1 ? 'record' : 'records') + ' for ' + esc(label) + '?</h4>'
          + '<p>' + esc(peso(t.gross)) + ' in pay, ' + esc(peso(t.net)) + ' take-home. '
          + (booksAnswer === 'out'
              ? '<strong>These wages will be added to the accounts</strong>, dated ' + esc(payDateOf(periodId)) + '.'
              : '<strong>The accounts will not be touched</strong> — you said this pay is already recorded there.')
          + '</p>'
          + '<p>Payslips are written and marked as entered from paper. Nobody is paid and nobody is notified. '
          + 'No cash advance is collected — any repayment shown above is recorded on the payslip only, and nobody\'s outstanding balance changes.</p>'
          + '<div class="pbf-actions" style="margin:0">'
          + '<button class="btn-primary" id="pbf-go">' + ico('✅', 14) + ' Yes, save them</button>'
          + '<button class="btn-secondary" id="pbf-cancel">Not yet</button>'
          + '</div></div>';
        if (window.lucide) lucide.createIcons({ nodes: [confirmHost] });

        confirmHost.querySelector('#pbf-cancel').addEventListener('click', () => { confirmHost.innerHTML = ''; });
        confirmHost.querySelector('#pbf-go').addEventListener('click', (ev2) => window.busy(ev2.currentTarget, async () => {
          try {
            const res = await saveBackfill({ periodId, entries, postToBooks: booksAnswer === 'out' });
            if (!bodyEl.isConnected) return;
            if (res.finished) {
              if (window.Notifs) Notifs.success(label + ' saved — ' + res.people + ' ' + (res.people === 1 ? 'record' : 'records') + '.');
            } else {
              if (window.Notifs) Notifs.showToast('The records for ' + label + ' were saved, but the period could not be closed off: '
                + res.finishError + ' Ask the President to open this screen and save it again — nothing will be duplicated.', 'error');
            }
            if (typeof o.onDone === 'function') { try { o.onDone(periodId); } catch (_) {} }
            booksAnswer = null;
            drawPeriod();
          } catch (err) {
            if (!bodyEl.isConnected) return;
            confirmHost.innerHTML = '<div class="pbf-panel pbf-warn"><strong>' + ico('⛔', 16)
              + ' Nothing was saved.</strong><p class="pbf-note">' + esc((err && err.message) || err) + '</p></div>';
          }
        }));
      });

      recalc();
    }

    await drawPeriod();
  };

  // ═══════════════════════════════════════════════════════════════════════
  //  For the unified payroll screen. `isBackfilled(run)` is the one predicate
  //  every other payroll surface needs: a run document carrying `backfill` was
  //  typed in from paper and must never be prepared, checked or paid again.
  // ═══════════════════════════════════════════════════════════════════════
  window.PayrollBackfill = {
    render: function () { return window.renderPayrollBackfill.apply(null, arguments); },
    isBackfilled: function (run) { return !!(run && (run.backfill || run.backfilled === true)); },
    /** 'free' | 'run' | 'done' | 'unfinished'. THROWS on a failed read. */
    statusFor: async function (periodId) { return classifyRun(await readRun(periodId)); },
    kindOf: kindOf,
    label: periodLabel,
    monthOptions: monthOptions,
    weekOptions: weekOptions
  };
})();
