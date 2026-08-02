// ═══════════════════════════════════════════════════════════
//  js/money-core.js — pure money-math (v14 Wave 2 Batch A, spec item I5)
//  No DOM, no Firebase, no side effects. Verbatim-moved from js/departments.js
//  so the math is independently testable (tests/money.test.mjs, node:test)
//  without booting the whole app. Browser callers are unaffected — these still
//  attach to window.vatSplit / window.computePayLine exactly as before; this
//  file just now DEFINES them (loaded BEFORE departments.js in index.html, so
//  departments.js's callers resolve the same window globals as always).
//
//  Moved verbatim (byte-identical function bodies — see Wave 2 report):
//    window.vatSplit       — was departments.js ≈9875 (sale/project VAT split)
//    window.computePayLine — was departments.js ≈3194 (v12 WS20 payroll engine,
//                             per-employee math half of the "ONE PAYROLL ENGINE"
//                             trio). computePayRun/disbursePayRun stayed in
//                             departments.js — they read/write Firestore and
//                             are not pure functions, so out of scope for this
//                             batch's extraction.
// ═══════════════════════════════════════════════════════════

// UMD-ish shim: this file is written in the same "window globals" convention
// as every other js/*.js in this app (no ES modules yet — see Wave 2 spec).
// This one line just makes `window` exist under plain Node so tests can
// `require()` this file directly, with zero build step and zero test-only
// global stubbing. In the browser, window already exists, so this is a no-op.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

// ---- moved verbatim from js/departments.js ≈9868-9886 ----
// Split an entered amount into {recorded, net, vat} for a given VAT treatment.
// `recorded` is what hits the ledger + project balance (the cash figure); `net`
// is revenue net of VAT; `vat` is the output VAT. Used by the sale + project
// billing flows so each sale's VAT is stored per-entry (it varies by quote).
//   inclusive → the amount already contains 12% VAT
//   exclusive → 12% is added on top of the amount
//   exempt    → zero-rated / VAT-exempt, no VAT
window.vatSplit = function(entered, treatment) {
  const a = +entered || 0;
  if (treatment === 'exclusive') {
    const vat = +(a * 0.12).toFixed(2);
    return { recorded: +(a + vat).toFixed(2), net: +a.toFixed(2), vat };
  }
  if (treatment === 'exempt') {
    return { recorded: +a.toFixed(2), net: +a.toFixed(2), vat: 0 };
  }
  const net = +(a / 1.12).toFixed(2); // inclusive (default)
  return { recorded: +a.toFixed(2), net, vat: +(a - net).toFixed(2) };
};

// ---- moved verbatim from js/departments.js ≈3194-3243 ----
window.computePayLine = function(emp, ctx) {
  const policy = ctx.policy || 'flat';
  const base   = emp.salary || 0;
  const allowance = emp.allowance || 0;
  const otherDeductions = emp.deductions || 0;
  const gross = base + allowance; // nominal — statutory brackets key off THIS, not the performance-adjusted figure

  // Statutory: a hand-typed non-zero value on payroll/{uid} always wins over the
  // WS21 table suggestion (Finance can override real edge cases); er (employer
  // share) is never hand-typed — always computed and frozen.
  const stat = window.computeStatutory
    ? window.computeStatutory({ grossPay: gross, year: window.bizYear ? window.bizYear() : new Date().getFullYear() })
    : null;
  const sss        = emp.sss        || (stat ? stat.ee.sss : 0);
  const philhealth = emp.philhealth || (stat ? stat.ee.philhealth : 0);
  const pagibig    = emp.pagibig    || (stat ? stat.ee.pagibig : 0);
  const tax        = emp.tax        || (stat ? stat.ee.tax : 0);
  const er         = stat ? stat.er : { sss:0, philhealth:0, pagibig:0 };
  const statutoryTotal = sss + philhealth + pagibig + tax;

  const kpiScore   = ctx.kpiScore != null ? ctx.kpiScore : 1;
  const attScore   = ctx.attScore != null ? ctx.attScore : 1;
  const perfFactor = Math.min(1, Math.max(0, kpiScore*0.7 + attScore*0.3));

  const caPlan    = ctx.caPlan || [];
  const caPlanned = caPlan.reduce((s,p)=>s+(p.amount||0), 0);
  const caBalance = ctx.caBalance != null ? ctx.caBalance : caPlanned;

  // policy 'flat'        = exactly Path A today (unification changes no one's pay).
  // policy 'performance' = allowance scales by perfFactor; BASE WAGE is never
  // docked (PH labor-safe) — inert until the President flips payPolicy on a run.
  const netBeforeCA = policy === 'performance'
    ? (base - statutoryTotal - otherDeductions + allowance*perfFactor)
    : (gross - statutoryTotal - otherDeductions);
  const finalPay = netBeforeCA - caPlanned;
  // The TRUE economic cost of this line (what disbursePayRun's ledger debit
  // legs must balance against) — equals nominal `gross` under 'flat', but
  // correctly reflects a performance-scaled allowance under 'performance'
  // (an unearned allowance withholding is not a real company expense).
  const effectiveGross = netBeforeCA + statutoryTotal + otherDeductions;

  return {
    uid: emp.id, name: emp.displayName||emp.email, payClass: emp.payClass==='production'?'production':'regular',
    base, allowance, otherDeductions,
    sss, philhealth, pagibig, tax, er,
    kpiScore, attScore, perfFactor, policy,
    caBalance, caPlanned, caPlan,
    gross, effectiveGross, statutoryTotal, netBeforeCA, finalPay
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { vatSplit: window.vatSplit, computePayLine: window.computePayLine };
}
