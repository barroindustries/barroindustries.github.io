// js/qr-def.js — PUBLIC-QUOTE-REQUEST-SPEC.md §4 (WS-0).
//
// Canonical, versioned definition for the public "Get a quote" request
// (catalogue intake -> Add to quote -> server-side estimate -> Sales › Quote
// requests). Byte-identical mirror lives at functions/qr-def.js (ci-invariants
// CHECK 10 enforces this — edit THIS file, then
// `cp js/qr-def.js functions/qr-def.js`, never the reverse).
//
// One file, three consumers, same bytes:
//   - the public /catalogue/ page (js/quote-request.js) reads INTAKE / LIMITS /
//     COPY / PRIVACY_NOTICE and mirrors the server's validation for UX only;
//   - the Cloud Functions (functions/qr-core.js) are the AUTHORITY: they
//     validate every field against these tables and compute the estimate with
//     ESTIMATE;
//   - the internal Sales › Quote requests screen resolves option labels
//     (QR_DEF.INTAKE.need etc.) and prints the same disclaimer copy.
//
// UMD-ish shim, same as js/cir-forms.js:
//   - browser <script> (classic, non-module): defines window.QR_DEF
//   - Node CommonJS require() (functions/, tests/): exports the same object.
//
// Zero dependencies. Must not reference any browser global at load time other
// than a guarded `typeof window`. NO prices, rates or formula fields live here
// (this file ships to the public page): ESTIMATE holds only the ruled range
// factors / steps / gate, never a product figure.
//
// VERSION: bump on ANY change to INTAKE / LIMITS / ESTIMATE / PRIVACY_NOTICE /
// COPY. The page sends it with every callable; a stale page is refused with
// "This page was updated — please reload."
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;   // functions/ + tests
  if (root) root.QR_DEF = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var VERSION = 1;

  // ── 4.1 INTAKE — option VALUES are stored; LABELS are shown ─────────────
  var INTAKE = {
    need: { label: 'What best describes what you need?', required: true, options: [
      { v: 'full_kitchen', l: 'Full kitchen design & build package' },
      { v: 'equipment',    l: 'Individual kitchen equipment' },
      { v: 'fabrication',  l: 'Custom stainless or metal fabrication' },
      { v: 'exhaust',      l: 'Exhaust hood, ducting & fresh-air system' },
      { v: 'gas_line',     l: 'LPG gas line & manifold' },
      { v: 'fire',         l: 'Fire suppression system' },
      { v: 'service',      l: 'Repair or maintenance of existing equipment' },
      { v: 'other',        l: 'Something else' }                      // reveals needOther (text <=120, required when chosen)
    ]},
    useFor: { label: 'What will you use this for?', required: true, options: [
      { v: 'restaurant_cafe', l: 'Restaurant / café' },
      { v: 'hotel_resort',    l: 'Hotel / resort' },
      { v: 'commissary',      l: 'Commissary / central kitchen' },
      { v: 'catering',        l: 'Catering / events' },
      { v: 'school',          l: 'School / university' },
      { v: 'hospital',        l: 'Hospital / clinic' },
      { v: 'government',      l: 'Government office / LGU' },
      { v: 'home',            l: 'Home / residential' },
      { v: 'other',           l: 'Other' }                            // reveals useForOther (text <=120, required when chosen)
    ]},
    entityType: { label: 'Are you a government or private entity?', required: true, options: [
      { v: 'private',    l: 'Private business or individual' },
      { v: 'government', l: 'Government agency / LGU / state school' }
    ]},
    targetDate: { label: 'Target date', required: true, flexibleLabel: 'Not sure yet' },   // O5
    name:        { label: 'Your name',                   required: true,  max: 120, autocomplete: 'name' },
    mobile:      { label: 'Mobile number',               required: true,  placeholder: '09XX XXX XXXX', autocomplete: 'tel' },
    email:       { label: 'E-mail',                      required: true,  max: 160, autocomplete: 'email' },
    company:     { label: 'Company / agency (optional)', required: false, max: 120, autocomplete: 'organization' },
    address:     { label: 'Delivery address',            required: true,  max: 500, rows: 2, autocomplete: 'street-address' },
    notes:       { label: 'Anything else we should know? (optional)', required: false, max: 1000, rows: 3 }
  };

  // ── 4.2 LIMITS — single source for page + server ────────────────────────
  var LIMITS = {
    maxItems: 40,              // lines per request
    maxQtyPerLine: 20,         // qty (or runs) per line
    maxQtyPerProduct: 20,      // units of ONE product across ALL its lines (qty x runs, summed). A basket of 40 identical lines would otherwise
                               // multiply one product's list price 800-fold and turn the rounded range into an exact-price oracle.
    maxNote: 240,              // per-item note
    minDimMm: 100, dimStepMm: 10,                        // sizes are integers, multiples of 10, >= 100
    maxDimFactor: 3, maxDimAbsMm: { W: 6000, D: 3000, H: 3000 },   // per dimension: <= min(default x 3, max(abs cap, default)) — a default above the cap can only shrink; if that
                                                                  // maximum is below minDimMm the dimension is fixed; a product with no default for that dim is not customisable in it
    maxRuns: 20,
    maxPayloadBytes: 60000,    // JSON.stringify(payload).length, checked client AND server
    minFillMs: 20000,          // submit must be >= 20 s after the session was created (server clock)
    sessionTtlMs: 7 * 24 * 3600e3,
    estimateDebounceMs: 1200,
    dupWindow: 'day'           // same email+mobile fingerprint on the same Manila date
  };

  // ── 4.4 ESTIMATE — the ruled values, in one place ───────────────────────
  var ESTIMATE = {
    version: 1,                       // stamped on every stored estimate; bump when any number below changes
    lowFactor: 0.90, highFactor: 1.15,                                   // R2
    steps: [ { below: 500000, step: 5000 }, { below: 5000000, step: 10000 }, { below: Infinity, step: 50000 } ],   // R2
    minDistinct: 2, minExact: 50000,  // O3 gate: shown iff distinctPriced >= 2 OR exact >= 50000
    vatBasis: 'exclusive',            // O1: 'exclusive' | 'inclusive'
    deliveryIncluded: false,          // O2
    currency: 'PHP'
  };

  // ── 4.5 PRIVACY_NOTICE — canonical text; version bump on any wording change ──
  // The eight headings are CIR's (js/cir-forms.js); the three the spec
  // substitutes ("What we collect", "Why", "How long we keep it", plus the
  // Security sentence about the draft) are rewritten for a quote request.
  // Everything else is byte-for-byte CIR's: controller, lawful basis, sharing,
  // rights.
  var PRIVACY_NOTICE = {
    version: '2026-10-21.1',
    consentLine: 'I agree to Barro Industries using these details and my item list to prepare an estimate and a quotation, in line with the Data Privacy Act of 2012 (RA 10173).',
    sections: [
      { heading: 'Who is responsible for your data',
        body: 'Personal Information Controller: Barro Industries OPC (SEC-registered, Metro Manila), trading as Barro Kitchens. Contact for privacy matters: the President, 0927 683 6300, barroindustries@gmail.com.' },
      { heading: 'What we collect on this page',
        body: 'Your name, company or agency, mobile number, e-mail, delivery address, your answers about what you need and what it is for, the items, sizes and notes you add to your quote, the date and time you send it, and your device\'s IP address and browser identifier.' },
      { heading: 'Why',
        body: 'To estimate and prepare a quotation for the items you selected and to contact you about it.' },
      { heading: 'Lawful basis',
        body: 'Republic Act 10173 section 12(b) — steps taken at your request before entering into a contract — and your consent for the photos and for the communications about this request.' },
      { heading: 'Who we share it with',
        body: 'Barro Industries staff who work on your request; Google LLC, whose Firebase/Google Cloud services host this system (servers may be outside the Philippines); and government authorities only when the law requires it. We do not sell or rent personal data.' },
      { heading: 'How long we keep it',
        body: 'If no project follows, up to twenty-four (24) months from our last contact with you, then deleted. If a project follows, for the life of the project and ten (10) years after turnover. You may ask us to delete this request at any time.' },
      { heading: 'Your rights',
        body: 'To be informed; to access; to object; to rectification; to erasure or blocking; to damages; to data portability; and to lodge a complaint with the National Privacy Commission (privacy.gov.ph). Write to the contact above; we respond within fifteen (15) working days.' },
      { heading: 'Security',
        body: 'Data is encrypted in transit; your request is readable only by authorised staff. This page stores a draft of your list and your details only in your own browser — never prices — and no advertising cookies.' }
    ]
  };

  // ── 4.6 COPY — every user-facing string the server or page needs to agree on ──
  var COPY = {
    estimateDisclaimer: 'Estimate only — your final quotation is prepared after our team reviews your list, sizes and site.',   // R3
    vatExclusive: 'Excludes 12 % VAT.', vatInclusive: 'Includes 12 % VAT.',
    deliveryExcluded: 'Delivery and installation are quoted separately once we know the site.',
    governmentNote: 'Government purchases follow procurement rules — the estimate is for budget planning only; pricing is finalised in the bid documents.',   // R7
    gateMessage: 'Add more items to see an estimate — or submit now for a full quotation.',
    disabledMessage: 'Submit your list and we will send a quotation.',
    reviewCount: function (n) { return n + ' item' + (n === 1 ? '' : 's') + ' priced after review.'; },
    customSizeNote: 'Custom sizes are confirmed in the quotation.',
    receiptTitle: 'Quote request sent', receiptBody: 'Thank you. Our team will review your list and send a quotation. Keep your reference number.',
    privacyLine: 'We use these details only to prepare your quotation (RA 10173).'
  };

  return { VERSION: VERSION, INTAKE: INTAKE, LIMITS: LIMITS, ESTIMATE: ESTIMATE, PRIVACY_NOTICE: PRIVACY_NOTICE, COPY: COPY };
});
