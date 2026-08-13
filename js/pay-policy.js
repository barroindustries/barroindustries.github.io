// ═══════════════════════════════════════════════════════════
//  js/pay-policy.js — task-based pay support (TASK-BASED-PAY-SPEC-2026-08-12)
//
//  Pure helpers ABOVE js/money-core.js (frozen, not edited by this file except
//  for the one additive branch documented there). No DOM, no Firestore, no
//  wall-clock — same contract as money-core.js's own header.
//
//  Contains:
//    window.PAY_POLICY_VALUES — the whitelist §6.1's readers validate a
//      stored settings/payrollOfficePolicy.policy value against. ONE place,
//      so a misspelt value is caught at the boundary where new configuration
//      enters rather than silently paid 'flat' by computePayLine's own
//      (deliberately unchanged) legacy fallthrough.
//    window.wageFloorCheck(line, floorMonthly) — §8.3, the minimum-wage gate.
//    window.payBasisSentence(line) — §9.1, the ONE sentence that explains a
//      task-based month's figure everywhere it appears (payroll screen,
//      Personal Finance, the payslip) so the three surfaces can never phrase
//      the same month three different ways.
//
//  Classic script, `window.*` globals, no build step, no ES modules (see
//  CLAUDE.md — script load order is load-bearing; loads immediately after
//  js/money-core.js, before js/payroll.js/js/departments.js/js/screens/*).
//  `var`/`function` at file scope only, NEVER top-level `const`/`let` — a
//  duplicated <script> tag or a stale service-worker copy re-evaluates this
//  file, and a top-level `const` throws on the second evaluation and kills
//  the whole file (same precedent js/statutory-status.js's header documents).
// ═══════════════════════════════════════════════════════════

// UMD-ish shim, same one every other js/*.js in this app uses, so `require()`
// works under plain Node with zero test-only global stubbing. No-op in the
// browser, where `window` already exists.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

// §6.1 — the whitelist. A stored settings/payrollOfficePolicy.policy value
// outside this list means the boundary-read THROWS rather than guessing —
// see js/departments.js's buildPayRunLines and js/screens/dashboards.js's
// Personal Finance renderer, the two readers of that settings doc.
window.PAY_POLICY_VALUES = ['flat', 'taskbased'];

// §8.3 — the pure minimum-wage check. NEVER invents the floor: an
// absent/non-positive floorMonthly means the check is INERT (checked:false),
// which is the whole point — the owner has to enter the number himself
// (§8.1), and until he does, this function says so rather than blocking on a
// number nobody confirmed.
//
// The compared figure is effectiveGross — the month's earned compensation
// under whichever policy actually ran (take-home + government deductions +
// withheld deductions; allowance included) — so a 'flat' salary below the
// floor is caught too, not only a task-based one that got scaled down.
window.wageFloorCheck = function (line, floorMonthly) {
  const l = line || {};
  const floor = Number(floorMonthly);
  if (!Number.isFinite(floor) || floor <= 0) {
    return { checked: false, ok: true, earned: Number(l.effectiveGross) || 0, short: 0 };
  }
  const earned = Number(l.effectiveGross) || 0;
  const ok = earned >= floor;
  return { checked: true, ok, earned, short: ok ? 0 : _ppRound2(floor - earned) };
};

// Private rounding helper, scoped to this file — same shape as money-core.js's
// own _round2 and statutory-tables.js's round2, deliberately NOT imported/
// shared (these are independent files by design; see money-core.js's own
// comment on this point).
function _ppRound2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Self-contained peso formatter matching window.fmtPeso's OUTPUT exactly
// (js/config.js: '₱' + en-PH grouped, 2dp) without depending on config.js
// being loaded — the pinned tests (tests/taskbased-pay.test.mjs) require only
// statutory-tables.js/money-core.js/pay-policy.js, the same minimal harness
// tests/money.test.mjs already uses, and config.js is never in that list.
// Prefers the real window.fmtPeso when it IS present (the browser, where
// config.js loads before this file) so there is exactly one code path in
// production and this is only a fallback for the test harness / any other
// caller that hasn't loaded config.js yet.
function _ppPeso(n) {
  if (typeof window.fmtPeso === 'function') return window.fmtPeso(n);
  return '₱' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// §9.1 — the one sentence. Returns '' unless line.policy === 'taskbased' (the
// only policy this ever describes — a 'flat' or 'performance' line gets no
// sentence, same as today). Every input is already FROZEN on the line at the
// moment the figures were worked out (kpiScore, attScore, perfFactor, policy,
// preMultiplierNet, netBeforeCA) — this function only formats, it never
// re-derives a score, so the words always describe what the math actually
// did, even years later (§9.3).
window.payBasisSentence = function (line) {
  const l = line || {};
  if (l.policy !== 'taskbased') return '';
  const F = Math.round((Number(l.perfFactor) || 0) * 100);
  const K = Math.round((Number(l.kpiScore) || 0) * 100);
  const A = Math.round((Number(l.attScore) || 0) * 100);
  if (l.preMultiplierNet == null) {
    // A frozen line from before this change ever carried 'taskbased' —
    // shouldn't happen (the policy didn't exist yet), but never render a
    // blank peso rather than guard against it.
    return 'Pay this month was multiplied by ' + F + '% — task results (' + K +
      '%) counted at 70% and on-time morning check-ins (' + A + '%) counted at 30%.';
  }
  return 'Pay this month is the usual take-home ' + _ppPeso(l.preMultiplierNet) + ' × ' + F + '% = ' +
    _ppPeso(l.netBeforeCA) + '. The ' + F + '% comes from task results (' + K +
    '%) counted at 70% and on-time morning check-ins (' + A +
    '%) counted at 30%. Check-ins count as on time when every notification is read before 9:00 AM.';
};

// PAYROLL-SYNC-FIX-2026-08-13 — the ONE explanation for "nobody has set this
// person's pay up yet", said the same way wherever it appears. Before this,
// the payroll screen already refused to pay ₱0.00 against a missing rate and
// said so in words (js/screens/payroll.js's _pyNotPaidWords, reason
// 'no-rate' — production/weekly workers with no hourly or daily rate on their
// worker profile); the employee's own Personal Finance screen had no such
// guard at all and instead ran gross-minus-statutory into a negative (base
// ₱0.00 minus a placeholder statutory deduction prints "Earned So Far
// -₱229.17" — a wage nobody was ever owed). This is the office-monthly analog
// of that same diagnosis — a missing salary, not a missing hourly/daily rate
// — so it is a sibling of 'no-rate', not the identical reason code (the two
// engines gate on different fields), but the SENTENCE is shared so both
// surfaces say the same thing about "nothing is set up yet".
//
// `audience` swaps only the actionable half of the sentence — who does
// something about it differs by surface — the diagnostic half never changes.
//   'employee' (default) — the person looking at their own pay; they cannot
//                           edit their own salary, so the action is to ask HR.
//   'hr'                  — Finance/HR looking at someone else's line; they
//                           can open the profile and fix it directly.
window.noPayRateWords = function (audience) {
  var forHr = audience === 'hr';
  return {
    short: 'No pay record set up yet',
    note: 'No monthly salary is on file yet — rather than show ₱0.00 (or a negative number after deductions), nothing is projected. ' +
      (forHr ? 'Set a salary on their profile, then open this again.' : 'Ask HR to set up your pay record.')
  };
};

// ═══════════════════════════════════════════════════════════
// PAYROLL-ROSTER-ACCRUAL-2026-08-13 — the owner's live ruling, verbatim:
// "take home so far should show the true value of standing on the day of
// that month. it cant be full already becayse that month is not yet done".
//
// THIS REVERSES PAYROLL-LIVE-SPEC-2026-08-11's F3, which chose full-month-
// with-KPI over a day-counted fraction for the Office ("so far") figure.
// That choice is now overruled by the owner's later, explicit instruction.
// Do NOT restore F3's "shows in full — does not build up day by day"
// behaviour from the spec; this ruling supersedes it.
//
// window.accruedTakeHomeSoFar is the ONE expression for "how much of a
// still-running month's pay has actually accrued", called from BOTH
// js/screens/payroll.js (the roster card) and js/screens/dashboards.js
// (renderPersonalFinance) so the two surfaces can never show two different
// numbers for the same person on the same day. It matches the fraction
// dashboards.js's Personal Finance screen already used before this pass
// (elapsed WORKDAYS ÷ this month's total workdays, via the shared
// window.countWorkDays — Sundays and PH holidays excluded, same denominator
// item 1's attendance count uses) — this pass gives that expression a name
// and a second caller instead of inventing a different fraction.
//
// DISPLAY ONLY. Never called by computePayLine, computePayRun or any write
// path — the frozen/paid figure a period freezes at prepare()/disburse is
// untouched by this function and by every caller of it. See the flag on the
// period-end gap this creates, in this same header block below.
//
// KNOWN GAP (report to the owner, do not silently fix): at period end the
// FROZEN payable is NOT day-proportioned — money-core.js's computePayLine
// pays the full nominal salary regardless of how many days were actually
// present (base wage is deliberately never docked — see computePayLine's
// own "BASE WAGE is never docked (PH labor-safe)" comment). So a person
// absent most of a month will be paid MORE at period end than their
// "so far" trajectory implied all month. This function does not and must
// not change that — pro-rating the FROZEN payable would be a pay policy
// change, not a display fix, and is the owner's call to make.
window.accruedTakeHomeSoFar = function (fullTakeHome, elapsedWorkDays, totalWorkDaysInMonth) {
  var total = Number(totalWorkDaysInMonth) || 0;
  var full = Number(fullTakeHome) || 0;
  if (!(total > 0)) {
    // No denominator to prorate against (e.g. a malformed period) — show the
    // full figure rather than divide by zero or invent a fraction.
    return { accrued: full, fraction: 1, elapsedWorkDays: Number(elapsedWorkDays) || 0, totalWorkDays: total };
  }
  var elapsed = Math.max(0, Math.min(Number(elapsedWorkDays) || 0, total));
  var fraction = elapsed / total;
  return { accrued: _ppRound2(full * fraction), fraction: fraction, elapsedWorkDays: elapsed, totalWorkDays: total };
};

// window.workDaysForMonth('YYYY-MM', todayIso) — the ONE place both surfaces
// get "workdays elapsed" / "workdays this month" from, so the accrual
// fraction above and item 1's attendance count are always measured against
// the identical denominator. Thin wrapper over window.monthBounds
// (money-core.js, pure) and window.countWorkDays (js/screens/dashboards.js
// — a plain top-level `function`, so it is a window global at call time
// despite loading after this file; every caller here runs long after all
// deferred scripts have parsed, same as every other cross-file window.*
// call in this app). Returns null if either dependency hasn't loaded yet,
// so a caller can fall back rather than throw.
window.workDaysForMonth = function (month, todayIso) {
  if (typeof window.monthBounds !== 'function' || typeof window.countWorkDays !== 'function') return null;
  var m = String(month || '');
  var b = window.monthBounds(m, todayIso);
  var y = parseInt(m.slice(0, 4), 10);
  var mIdx = parseInt(m.slice(5, 7), 10) - 1;
  if (!Number.isFinite(y) || !Number.isFinite(mIdx)) return null;
  return {
    elapsedWorkDays: window.countWorkDays(y, mIdx, b.upToDay),
    totalWorkDays:   window.countWorkDays(y, mIdx, b.daysInMonth),
    upToDay: b.upToDay, daysInMonth: b.daysInMonth, isCurrent: b.isCurrent, isFuture: b.isFuture
  };
};

// window.presentDaysFromScore(attScoreFraction, elapsedWorkDays) — item 1,
// "attendance as a count, not just a rate". getAttendanceScore
// (dashboards.js) computes attScore = min(1, presentSum/elapsedWorkDays) and
// discards presentSum; this inverts that SAME definition (presentSum =
// attScore × elapsedWorkDays) rather than re-querying attendance records a
// second time per roster card. Not a second measurement — it decomposes the
// one score already frozen on the line into the numerator/denominator that
// produced it. May be fractional (a half-day paid-leave record scores 0.5),
// which is correct and shown as-is, e.g. "2.5 / 22 days".
window.presentDaysFromScore = function (attScoreFraction, elapsedWorkDays) {
  if (typeof attScoreFraction !== 'number' || !isFinite(attScoreFraction)) return null;
  var elapsed = Math.max(0, Number(elapsedWorkDays) || 0);
  return _ppRound2(Math.max(0, attScoreFraction) * elapsed);
};

// window.kpiMonthBreakdown(userTasks, month) — item 2, "KPI with its working
// shown". window.computeKpiForMonth (money-core.js, FROZEN) returns only the
// final blended score (taskScore×0.7 + delivScore×0.3) and discards the raw
// "X of Y tasks" numerator/denominator. This is a byte-identical MIRROR of
// its in/out-of-scope loop (same t.assignedTo / taskDoneMonth /
// taskCreatedMonth rules — see money-core.js's own header comment for the
// scope table), kept only so the breakdown can be DISPLAYED. It is never
// called by any pay computation and can never drift the kpiScore that
// actually reaches computePayLine — that number is always
// computeKpiForMonth's own return value, untouched.
//
// Originally written as a private copy inside js/screens/hr.js's Edit
// Payroll screen (_kpiMonthBreakdown, 2026-08-12); promoted here so the
// Payroll roster and Personal Finance can share the identical breakdown
// instead of a third hand-copied loop.
window.kpiMonthBreakdown = function (userTasks, month) {
  var tasks = Array.isArray(userTasks) ? userTasks : [];
  var doneInM = 0, inScopeCount = 0;
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    var dm = window.taskDoneMonth ? window.taskDoneMonth(t) : null;
    var cm = (window.taskCreatedMonth ? window.taskCreatedMonth(t) : '') || '';
    if (cm > month) continue; // didn't exist yet -> out of scope entirely
    if (dm === month || dm === '') { inScopeCount++; doneInM++; }
    else if (dm === null) { inScopeCount++; }
    else if (dm > month) { inScopeCount++; }
    // else: dm !== null && dm < month -> finished before M -> out of scope
  }
  return { doneInM: doneInM, inScopeCount: inScopeCount };
};

// ═══════════════════════════════════════════════════════════
// PAYROLL-CARD-WORKING-SPEC-2026-08-13 — the owner's report on July 2026:
// "wheres the ca deduction" / "computation as well how it came to that final
// take home" / "the formula". His roster showed BOTH deduction columns at
// ₱0.00 while take-home sat thousands of pesos below earnings — real money
// moving with nothing on the card explaining it.
//
// ROOT CAUSE (confirmed by reading the code, not guessed): js/screens/
// payroll.js's _pyRead was written against computePayLine's RAW field names
// (caPlanned, caBalanceBefore, preMultiplierNet, allowance…) from before the
// "unified payroll" pass introduced PC.normalizeLine (js/payroll.js). That
// pass renamed/relocated several of those fields on the shape _pyRead
// actually receives (period.lines is ALWAYS PC.normalizeLine's output —
// see js/payroll.js's Payroll.load) — caPlanned -> cashAdvance,
// caBalanceBefore -> detail.cashAdvanceBefore, preMultiplierNet ->
// detail.preMultiplierNet, allowance -> allowances (plural) — but _pyRead's
// pick-lists were only partly updated (kpiScore/attScore/perfFactor/policy
// got a detail.* fallback; cashAdv/preMultiplierNet/allowances/caPlan/
// overridden did not). The CA and the performance-multiplier are both REAL
// steps computePayLine already applies (money-core.js's finalPay =
// netBeforeCA - caPlanned, and netBeforeCA itself scaled by perfFactor under
// 'taskbased') — the money moved correctly; only the CARD'S EXPLANATION of it
// went missing. _pyRead has been fixed to read the actual shape (see that
// file). This function is the second half of the fix: showing the working
// out loud, line by line, with a guard that can never again let a take-home
// print without the steps beneath it accounting for every peso of it.
//
// window.payDerivationSteps(input) — pure; no DOM, no Firestore. Takes a
// small canonical shape (NOT a raw engine line and NOT a PC.normalizeLine
// row directly — each of the two call sites maps its own already-existing
// data into this, which is the one place that mapping has to happen):
//   { earnings, allowances, oneOffNet, statutoryTotal, otherDeductions,
//     policy, perfFactor, cashAdvance, overridden, overrideNote, takeHome }
// Every field is optional except `takeHome`; a missing number reads as 0.
//
// ORDER IS THE ENGINE'S OWN, not a friendlier rearrangement (money-core.js's
// computePayLine header + the TASK-BASED-PAY-SPEC's §3 truth table):
//   1. Earnings, Allowances, one-off amounts added in
//   2. Government deductions, then Other deductions taken off
//      (netBeforeCA = gross - statutoryTotal - otherDeductions)
//   3. ONLY under 'taskbased' — the WHOLE remainder × the performance factor
//      (never government deductions, never a withheld deduction — see
//      money-core.js's own comment on why the multiplier only ever touches
//      the employee's take-home remainder)
//   4. Cash advance instalment taken off (finalPay = netBeforeCA - caPlanned)
//   5. A manual override, IF ONE EXISTS — see the guard below
//   6. Take-home pay
//
// THE GUARD (the part that matters most). `running` is the sum of every step
// printed above; `takeHome` is the figure actually shown as this person's
// pay. When a genuine per-line override moved finalPay, money-core.js's
// applyPayLineOverride shifts finalPay/netBeforeCA/effectiveGross by ONE
// coherent delta — so a real override closes this exact gap, and is shown as
// its own labelled "Manual adjustment" line (with its reason, or a plain
// statement that no reason was recorded — an adjustment nobody can see is
// indistinguishable from a bug, so it is never left unlabelled). If nothing
// on the line explains a gap, `reconciled` comes back false and the caller
// MUST show the residue in red — a card whose own numbers cannot account for
// its take-home is exactly how a deduction disappears without anyone noticing.
window.payDerivationSteps = function (input) {
  var d = input || {};
  var n = function (v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; };
  var earnings        = n(d.earnings);
  var allowances       = n(d.allowances);
  var oneOffNet        = n(d.oneOffNet);
  var statutoryTotal   = n(d.statutoryTotal);
  var otherDeductions  = n(d.otherDeductions);
  var policy           = d.policy || 'flat';
  var perfFactor       = (typeof d.perfFactor === 'number' && isFinite(d.perfFactor)) ? d.perfFactor : null;
  var cashAdvance      = n(d.cashAdvance);
  var overridden       = !!d.overridden;
  var overrideNote     = d.overrideNote || '';
  var takeHome         = n(d.takeHome);

  var steps = [];
  var running = earnings;
  steps.push({ label: 'Earnings', amount: _ppRound2(earnings), sign: '+', kind: 'earning' });

  if (allowances) {
    running += allowances;
    steps.push({ label: 'Allowances', amount: _ppRound2(allowances), sign: '+', kind: 'earning' });
  }
  if (oneOffNet) {
    running += oneOffNet;
    steps.push({
      label: 'One-off amounts', amount: _ppRound2(Math.abs(oneOffNet)),
      sign: oneOffNet >= 0 ? '+' : '-', kind: oneOffNet >= 0 ? 'earning' : 'deduction'
    });
  }

  running -= statutoryTotal;
  steps.push({ label: 'Government deductions', amount: _ppRound2(statutoryTotal), sign: '-', kind: 'deduction' });

  running -= otherDeductions;
  steps.push({ label: 'Other deductions', amount: _ppRound2(otherDeductions), sign: '-', kind: 'deduction' });

  running = _ppRound2(running);

  // Only 'taskbased' scales the whole after-deduction remainder (money-core.js
  // ≈169). 'performance' scales the allowance alone by a different expression
  // and is documented there as unreachable in production today; 'flat' scales
  // nothing. Neither gets a multiply step here — any gap either would leave is
  // caught by the guard below rather than guessed at.
  if (policy === 'taskbased' && perfFactor != null) {
    var beforeFactor = running;
    running = _ppRound2(running * perfFactor);
    steps.push({
      label: 'Performance factor × ' + Math.round(perfFactor * 100) + '%',
      amount: null, sign: '×', kind: 'factor',
      note: _ppPeso(beforeFactor) + ' × ' + Math.round(perfFactor * 100) + '% = ' + _ppPeso(running)
    });
  }

  if (cashAdvance) {
    running = _ppRound2(running - cashAdvance);
    steps.push({ label: 'Cash advance instalment', amount: _ppRound2(cashAdvance), sign: '-', kind: 'deduction' });
  }

  var residue = _ppRound2(takeHome - running);
  var reconciled = Math.abs(residue) < 0.005;

  if (!reconciled && overridden) {
    steps.push({
      label: 'Manual adjustment', amount: _ppRound2(Math.abs(residue)),
      sign: residue >= 0 ? '+' : '-', kind: 'override',
      note: overrideNote ? overrideNote : 'No reason was recorded for this adjustment.'
    });
    running = _ppRound2(running + residue);
    residue = _ppRound2(takeHome - running);
    reconciled = Math.abs(residue) < 0.005;
  }

  steps.push({ label: 'Take-home pay', amount: _ppRound2(takeHome), sign: '=', kind: 'total' });

  return {
    steps: steps,
    computed: running,
    takeHome: _ppRound2(takeHome),
    residue: residue,
    reconciled: reconciled
  };
};

// ═══════════════════════════════════════════════════════════
// PAY-EXPLANATION-LEGAL-BASIS-2026-08-13 — the owner asked to "cite a law".
// THIS FILE INVENTS NOTHING: no Philippine statute, article number, DOLE
// issuance or case is ever asserted here or anywhere else in this app. The
// citation is a stored, OWNER-ENTERED field — settings/payrollLegalBasis,
// written only by the President from js/screens/statutory-rates.js's
// renderPayLegalBasisSection (same President-write/staff-read pattern as
// settings/payrollWageFloor) — never guessed, paraphrased or defaulted by
// code. A wrong or misremembered citation shown to staff as justification for
// a pay figure is worse than no citation at all, and it is the employer's
// legal position to state, not the software's.
//
// Stored PER TEAM (office / ops), not one citation for both — the Office
// Team's task-based-pay basis and the Operations Team's hours/overtime basis
// are not necessarily the same law, and conflating them would be an assertion
// this app has no authority to make. See js/screens/dashboards.js's
// renderPersonalFinance for the read side: no citation of any kind renders
// for an employee until their team's entry exists.
//
// window.payLegalBasisLine(entry) — pure formatter, no DOM, no escaping (the
// caller runs escHtml() on the result — this is free text an admin typed and
// every employee reads, so it is treated as an XSS sink at every render site,
// never here). `entry` is ONE team's stored object:
//   { citation, source, enteredByName, enteredAtLabel }
// Returns '' when there is no citation text to show, so a caller can render
// conditionally (or show its own "not entered yet" note) without a second
// blank-check.
window.payLegalBasisLine = function (entry) {
  var e = entry || {};
  var citation = String(e.citation || '').trim();
  if (!citation) return '';
  var source = String(e.source || '').trim();
  var who = String(e.enteredByName || '').trim();
  var when = String(e.enteredAtLabel || '').trim();
  var line = citation;
  if (source) line += ' — ' + source;
  var attest = [];
  if (who) attest.push('entered by ' + who);
  if (when) attest.push('on ' + when);
  if (attest.length) line += ' (' + attest.join(' ') + ')';
  return line;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    wageFloorCheck: window.wageFloorCheck,
    payBasisSentence: window.payBasisSentence,
    noPayRateWords: window.noPayRateWords,
    PAY_POLICY_VALUES: window.PAY_POLICY_VALUES,
    accruedTakeHomeSoFar: window.accruedTakeHomeSoFar,
    workDaysForMonth: window.workDaysForMonth,
    presentDaysFromScore: window.presentDaysFromScore,
    kpiMonthBreakdown: window.kpiMonthBreakdown,
    payDerivationSteps: window.payDerivationSteps,
    payLegalBasisLine: window.payLegalBasisLine
  };
}
