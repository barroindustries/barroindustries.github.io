/* ═══════════════════════════════════════════════════
   PH statutory tables (v12 WS21) — SSS / PhilHealth / Pag-IBIG / TRAIN withholding
   js/statutory-tables.js  (loads AFTER config.js, BEFORE departments.js)
   ═══════════════════════════════════════════════════
   ‼️ EVERY NUMBER BELOW IS A PLACEHOLDER. Verify against the published 2026
      SSS / PhilHealth / Pag-IBIG schedules + BIR TRAIN withholding table
      BEFORE go-live. Set verified:true only once an accountant signs off.
      Until then, computeStatutory() console-warns on every call and the
      Edit Payroll pre-fill shows an "unverified rates" badge — nothing
      silently ships a wrong number into live payroll. */

// UMD-ish shim (v14 Wave 2 Batch A, spec item I5): makes `window` exist under
// plain Node so tests/money.test.mjs can require() this file directly. No-op
// in the browser, where window already exists. No logic change.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

window.STATUTORY = {
  2026: {
    verified: false,   // compute() WARNS + refuses silent use until true
    source: 'PLACEHOLDER — 2026 circulars pending verification',
    sss: {              // contribution on Monthly Salary Credit brackets
      rateEE: 0.05 /*PLACEHOLDER*/, rateER: 0.10 /*PLACEHOLDER*/,
      mscMin: 5000 /*PLACEHOLDER*/, mscMax: 35000 /*PLACEHOLDER*/, mscStep: 500 /*PLACEHOLDER*/,
      mpfThreshold: 20000 /*PLACEHOLDER — WISP/MPF above this*/,
    },
    philhealth: { rate: 0.05 /*PLACEHOLDER*/, floor: 10000 /*PLACEHOLDER*/,
                  ceiling: 100000 /*PLACEHOLDER*/, split: 0.5 /*EE half*/ },
    pagibig: { rateEE: 0.02 /*PLACEHOLDER*/, rateER: 0.02 /*PLACEHOLDER*/,
               base: 10000 /*PLACEHOLDER — cap*/, maxEE: 200 /*PLACEHOLDER*/ },
    // TRAIN monthly withholding — compensation brackets [over, base, rateOfExcess]
    withholdingMonthly: [ /*PLACEHOLDER rows*/
      { over: 0,      base: 0,      rate: 0.00 },
      { over: 20833,  base: 0,      rate: 0.15 },
      { over: 33333,  base: 1875,   rate: 0.20 },
      { over: 66667,  base: 8541.8, rate: 0.25 },
      { over: 166667, base: 33541.8,rate: 0.30 },
      { over: 666667, base: 183541.8,rate: 0.35 },
    ],
  },
};

/* ── LOADING VERIFIED RATES WITHOUT A CODE DEPLOY ──────────────────────────
   Owner, 2026-08-10: "will need to use payroll tomorrow".

   The table above is PLACEHOLDER and `verified:false`, and disbursePayRun
   blocks on exactly that (js/departments.js). The gate is correct — paying real
   wages on invented SSS/PhilHealth/Pag-IBIG rates would be far worse than not
   paying on time. But until now the ONLY way to satisfy it was to edit this
   source file and deploy, which the person who actually knows the rates (an
   accountant) cannot do. A safety gate with no route out is a dead end, and it
   has blocked the Office Team payroll all year.

   So the rates may now come from Firestore — statutory_tables/{year} — entered
   and attested in the app by the President. This function merges that doc OVER
   the placeholder above, per section, so a partially-entered year still gets
   the fields it does have. `verified` is taken ONLY from the stored doc: the
   hardcoded default can never mark itself verified.

   Called once at boot (js/app.js, after auth). Failing to load leaves the
   placeholder in place, i.e. still blocked — which is the safe direction. */
window.loadStatutoryTables = async function () {
  try {
    const snap = await db.collection('statutory_tables').get();
    snap.forEach((d) => {
      const year = String(d.id);
      const t = d.data() || {};
      const base = window.STATUTORY[year] || {};
      window.STATUTORY[year] = {
        ...base,
        ...t,
        sss:        { ...(base.sss || {}),        ...(t.sss || {}) },
        philhealth: { ...(base.philhealth || {}), ...(t.philhealth || {}) },
        pagibig:    { ...(base.pagibig || {}),    ...(t.pagibig || {}) },
        withholdingMonthly: Array.isArray(t.withholdingMonthly) && t.withholdingMonthly.length
          ? t.withholdingMonthly : base.withholdingMonthly,
        // Only a STORED table can be verified. A missing field reads false.
        verified: t.verified === true
      };
    });
    return true;
  } catch (_) {
    // Denied or offline: keep the placeholder, stay blocked. Never assume
    // verified on a failed read — that is the one direction that pays wrong.
    return false;
  }
};

function round2(n){ return Math.round((n+Number.EPSILON)*100)/100; }

// computeStatutory({grossPay, year}) -> { ee:{sss,philhealth,pagibig,tax}, er:{sss,philhealth,pagibig}, unverified }
window.computeStatutory = function({ grossPay, year }) {
  const T = (window.STATUTORY && window.STATUTORY[year]) || null;
  if (!T) { console.warn('[statutory] no table for', year); return { ee:{sss:0,philhealth:0,pagibig:0,tax:0}, er:{sss:0,philhealth:0,pagibig:0}, unverified:true }; }
  if (!T.verified && !window._STATUTORY_ACK) console.warn('[statutory] table', year, 'UNVERIFIED — placeholder rates');
  const g = Math.max(0, grossPay||0);
  // SSS: round gross to MSC bracket, clamp, apply EE/ER
  const msc = Math.min(T.sss.mscMax, Math.max(T.sss.mscMin, Math.round(g / T.sss.mscStep) * T.sss.mscStep));
  const sssEE = round2(msc * T.sss.rateEE), sssER = round2(msc * T.sss.rateER);
  // PhilHealth: rate on clamped gross, split
  const phBase = Math.min(T.philhealth.ceiling, Math.max(T.philhealth.floor, g));
  const phTotal = round2(phBase * T.philhealth.rate);
  const phEE = round2(phTotal * T.philhealth.split), phER = round2(phTotal - phEE);
  // Pag-IBIG: rate on capped base, EE cap
  const piBase = Math.min(T.pagibig.base, g);
  const piEE = Math.min(T.pagibig.maxEE, round2(piBase * T.pagibig.rateEE));
  const piER = round2(piBase * T.pagibig.rateER);
  // Withholding: taxable = gross − EE statutory (SSS/PhilHealth/Pag-IBIG are deductible)
  const taxable = Math.max(0, g - sssEE - phEE - piEE);
  const br = T.withholdingMonthly.filter(b => taxable > b.over).pop() || T.withholdingMonthly[0];
  const tax = round2(br.base + (taxable - br.over) * br.rate);
  return { ee:{sss:sssEE, philhealth:phEE, pagibig:piEE, tax}, er:{sss:sssER, philhealth:phER, pagibig:piER}, unverified: !T.verified };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STATUTORY: window.STATUTORY, computeStatutory: window.computeStatutory, round2 };
}
