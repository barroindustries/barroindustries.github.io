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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    wageFloorCheck: window.wageFloorCheck,
    payBasisSentence: window.payBasisSentence,
    noPayRateWords: window.noPayRateWords,
    PAY_POLICY_VALUES: window.PAY_POLICY_VALUES
  };
}
