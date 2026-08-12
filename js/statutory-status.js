// ═══════════════════════════════════════════════════════════
//  js/statutory-status.js — statutory contributions follow employment status
//  (STATUTORY-BY-STATUS-SPEC-2026-08-12)
//
//  The owner's ruling, verbatim: "When the employee is registered as regular
//  thats when statutory is considered." This file is a PURE DERIVATION LAYER
//  above js/money-core.js (which is frozen — 257 pinned tests — and is NOT
//  edited by this file). It turns (employmentStatus, existing statConfig,
//  legacy typed amounts) into an EFFECTIVE statConfig that the frozen
//  resolvers (window.resolveStatutoryEE for the monthly engine,
//  WRC.resolveStatutoryWeekly for the weekly engine) already know how to
//  read — 'exempt' zeroes both EE and ER, an audited path, not a second
//  zeroing mechanism.
//
//  THE SAFETY PROPERTY THIS FILE EXISTS TO PROTECT:
//  `employmentStatus` is unset on every legacy record. Unset/unknown/
//  regular/resigned/terminated must all preserve TODAY's behaviour
//  byte-for-byte — the rule can only ever EXEMPT an explicitly training or
//  probationary person, it never enrols anyone and never increases a
//  deduction. See spec §2-§4 for the full truth table and rationale.
//
//  Classic script, `window.*` globals, no build step, no ES modules (see
//  CLAUDE.md — script load order is load-bearing). File-scope bindings use
//  `var`/`function`, NEVER top-level `const`/`let`: a duplicated <script> tag
//  or a stale service-worker copy re-evaluates this file, and a top-level
//  `const` throws on the second evaluation and kills the whole file (see
//  js/screens/payroll.js's header for the precedent this avoids).
// ═══════════════════════════════════════════════════════════

// UMD-ish shim (same one js/money-core.js uses) so `require()` works under
// plain Node with zero test-only global stubbing. No-op in the browser.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

// ── 5.1 The rule data ────────────────────────────────────────────────────
// Which statuses the rule acts on, and how. Keyed HERE, not off
// window.EMPLOYMENT_STATUSES, on purpose: config.js is data-driven so HR can
// add a NEW stage without a code change — and a brand-new stage must NOT
// silently inherit an exemption nobody decided on. An unknown status is
// flagged, not acted on (see the 'status-unknown' branch below).
window.STATUTORY_STATUS_RULE = {
  training:     'exempt',   // owner ruling: statutory is considered when regular
  probationary: 'exempt',   //   — so an explicit non-regular working status is not
  regular:      'none',     // already correct: office legacy path deducts; ops is explicit
  resigned:     'none',     // final pay — unchanged until the owner rules (spec §10 Q1)
  terminated:   'none'
};

// The three contributions the ruling covers. `tax` rides along on rungs 1/2/4
// only — the rule NEVER derives a mode for tax (spec §3.3: the owner was
// asked about SSS/PhilHealth/Pag-IBIG only; withholding tax follows different
// law and is out of scope for this rule).
var _SS_STAT_KEYS = ['sss', 'philhealth', 'pagibig'];
var _SS_ALL_KEYS  = _SS_STAT_KEYS.concat(['tax']);
var _SS_MODES     = ['auto', 'fixed', 'exempt'];
// Fallback when window.EMPLOYMENT_STATUSES is absent (e.g. a Node test that
// requires this file without config.js) — the five stages known today.
var _SS_KNOWN_STATUSES_FALLBACK = ['training', 'probationary', 'regular', 'resigned', 'terminated'];

function _ssKnownStatuses() {
  var es = window.EMPLOYMENT_STATUSES;
  if (es && typeof es === 'object') return Object.keys(es);
  return _SS_KNOWN_STATUSES_FALLBACK.slice();
}

// ── 5.2 window.statutoryStatusPlan(person, enabled, opts) — pure ─────────
// No DOM, no Firestore, no clock. Reads nothing from `window` besides its own
// STATUTORY_STATUS_RULE and window.EMPLOYMENT_STATUSES (if present).
//
// Precedence per key k ∈ {sss, philhealth, pagibig} (spec §3.4), highest first:
//   1. Explicit mode   — person.statConfig[k] is a valid mode -> kept as-is ('person').
//   2. Legacy typed     — no mode, but person[k] is truthy (SAME truthiness the
//                         legacy `typed || table` expression uses) -> kept
//                         on the legacy path ('typed'), flagged when the
//                         status is non-regular.
//   3. Status rule      — no mode, no typed amount, status is explicitly
//                         'training' or 'probationary' -> derive 'exempt'
//                         ('status'). Only reached when `enabled === true`.
//   4. Legacy fallthrough — everything else -> key stays absent ('legacy');
//                         the frozen resolver reproduces today's behaviour.
// `tax` walks rungs 1/2/4 only; rung 3 never applies to it.
window.statutoryStatusPlan = function (person, enabled, opts) {
  var p = person || {};
  var o = opts || {};
  var engine = (o.engine === 'week') ? 'week' : 'month';
  var rawStatus = (typeof p.employmentStatus === 'string') ? p.employmentStatus : '';
  // Same normalization as window.employmentStatusMeta: trim + lowercase.
  var status = rawStatus.trim().toLowerCase();
  var cfg = (p.statConfig && typeof p.statConfig === 'object') ? p.statConfig : {};
  var known = _ssKnownStatuses();
  var isNonRegularRuleStatus = (status === 'training' || status === 'probationary');

  // ---- perKey, rungs 1/2/4 always; rung 3 only when the caller says the
  // rule is enabled. This walk happens regardless of `enabled` so that an
  // OFF caller still gets an accurate 'person'/'typed'/'legacy' read — it
  // simply never produces 'status' when off, so `active` can never be true
  // and the caller's byte-identical-legacy guarantee holds.
  var perKey = {};
  var anyTypedOnNonRegular = false;
  _SS_ALL_KEYS.forEach(function (k) {
    var isTax = (k === 'tax');
    var mode = cfg[k];
    if (_SS_MODES.indexOf(mode) !== -1) {
      perKey[k] = 'person';
      if (!isTax && isNonRegularRuleStatus && mode !== 'exempt') anyTypedOnNonRegular = true;
      return;
    }
    if (p[k]) { // truthy typed amount — identical test to the legacy `typed || table` fallthrough
      perKey[k] = 'typed';
      if (!isTax && isNonRegularRuleStatus) anyTypedOnNonRegular = true;
      return;
    }
    if (!isTax && enabled === true && isNonRegularRuleStatus &&
        window.STATUTORY_STATUS_RULE && window.STATUTORY_STATUS_RULE[status] === 'exempt') {
      perKey[k] = 'status';
      return;
    }
    perKey[k] = 'legacy';
  });

  var active = (enabled === true) && _SS_STAT_KEYS.some(function (k) { return perKey[k] === 'status'; });

  var statConfigOut = null;
  if (active) {
    statConfigOut = {};
    // Explicit modes preserved verbatim (tax included only if explicitly set).
    _SS_ALL_KEYS.forEach(function (k) {
      if (perKey[k] === 'person') statConfigOut[k] = cfg[k];
    });
    // Derived exemptions filled into the gaps. Keys on rungs 2/4 are left
    // ABSENT so the frozen resolver's legacy path handles them unchanged.
    _SS_STAT_KEYS.forEach(function (k) {
      if (perKey[k] === 'status') statConfigOut[k] = 'exempt';
    });
  }

  // The rule is OFF for this call -> flags and words are suppressed so the
  // roster never nags about a rule the owner has not adopted. The report
  // (js/screens/statutory-rates.js) calls with enabled:true regardless of
  // the stored switch — that is what makes it a preview.
  if (enabled !== true) {
    return { active: false, statConfig: null, status: status, perKey: perKey, words: '', flag: null };
  }

  var meta = window.employmentStatusMeta ? window.employmentStatusMeta(rawStatus) : null;
  var label = meta ? meta.label : (status ? rawStatus.trim() : 'Not set');

  var words = active
    ? ('No SSS, PhilHealth or Pag-IBIG — employment status is ' + label + '. Status is set on their HR record.')
    : '';

  // Single most important issue, in this order (spec §5.2):
  //   status-unset -> status-unknown -> status-ended -> typed-on-nonregular
  //   -> regular-unconfigured (weekly only) -> null
  var flag = null;
  if (!status) {
    flag = { kind: 'status-unset', words: 'Employment status is not set on their HR record. Government deductions are unchanged until it is set.' };
  } else if (known.indexOf(status) === -1) {
    flag = { kind: 'status-unknown', words: "Employment status '" + rawStatus.trim() + "' is not one the system knows. Government deductions are unchanged." };
  } else if (status === 'resigned' || status === 'terminated') {
    flag = { kind: 'status-ended', words: 'Employment status is ' + label + ' — this looks like a final pay. Government deductions are unchanged.' };
  } else if (anyTypedOnNonRegular) {
    flag = { kind: 'typed-on-nonregular', words: 'Status is ' + label + ', but SSS / PhilHealth / Pag-IBIG amounts are set by hand on their record — hand-set amounts win. Clear them on their HR record if nothing should be taken.' };
  } else if (engine === 'week' && status === 'regular' &&
             !_SS_STAT_KEYS.some(function (k) { return _SS_MODES.indexOf(cfg[k]) !== -1; })) {
    // Raised only for the weekly engine: the office legacy path already
    // deducts for a regular person with no statConfig, so this flag there
    // would be false noise.
    flag = { kind: 'regular-unconfigured', words: 'Status is Regular, but no government deductions are set up on their record — nothing is being taken. Set them up on their HR record if they should contribute.' };
  }

  return { active: active, statConfig: statConfigOut, status: status, perKey: perKey, words: words, flag: flag };
};

// ── 5.3 window.statutoryStatusRuleOn() — the switch reader (async, browser) ─
// Reads settings/payrollStatutoryStatus FRESH — no dbCachedGet. A
// payroll-deciding switch must never be answered from a stale cache. Doc
// absent, or enabled !== true, reads as OFF (missing-field-safe by
// construction: this is a plain JS read, not a rules read). A FAILED read
// throws with plain words — refusing beats guessing in either direction:
// guessing "off" would silently restore deductions for exempted trainees;
// guessing "on" would apply a rule nobody confirmed. Same refusal stance as
// window.periodExclusionsFor beside it in js/departments.js.
window.statutoryStatusRuleOn = async function () {
  var snap;
  try {
    snap = await db.collection('settings').doc('payrollStatutoryStatus').get();
  } catch (err) {
    throw new Error('Could not read the employment-status payroll setting — nothing was worked out. Try again in a moment.');
  }
  if (!snap || !snap.exists) return { on: false, meta: null };
  var d = snap.data() || {};
  return { on: d.enabled === true, meta: d };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATUTORY_STATUS_RULE: window.STATUTORY_STATUS_RULE,
    statutoryStatusPlan: window.statutoryStatusPlan
  };
}
