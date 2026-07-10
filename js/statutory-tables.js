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
