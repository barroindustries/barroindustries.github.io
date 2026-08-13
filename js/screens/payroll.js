// ═══════════════════════════════════════════════════════════
//  js/screens/payroll.js — THE payroll screen. One screen, both teams.
//
//  Built to PAYROLL-REDESIGN-BRIEF.md (the owner's rulings, verbatim) and the
//  proposal in PAYROLL-AUDIT-2026-08.md §2. Where they differ, the brief wins.
//
//  WHAT THIS REPLACES. Two screens with two vocabularies: the monthly tab
//  (renderPayrollManagement, js/screens/hr.js) and the weekly tab
//  (renderWeeklyPayrollTab, js/screens/payroll-weekly-ui.js). The owner's
//  keystone ruling is that there is ONE payroll; payClass picks the arithmetic
//  for one line and nothing else differs. So there is ONE screen, ONE process,
//  reached through TWO TEAM TABS — Office Team (month periods) and Operations
//  Team (week periods) — with one roster, one release pipeline, one payslip/
//  ledger/receipt path and one set of row actions underneath both. A tab and
//  the period it can pick are the ONLY things payClass/period-kind changes;
//  everything downstream of the number is identical (PAYROLL-LIVE-SPEC-
//  2026-08-11 §1, superseding this header's earlier "NO team tabs anywhere" —
//  and ONLY that line — from the brief).
//
//  LIVE vs FROZEN (PAYROLL-LIVE-SPEC §2, D1/D3). A period that has not ENDED
//  yet (today <= its last calendar day) shows a READ-ONLY PROJECTION —
//  window.Payroll.preview(periodId), built through the same frozen maths as a
//  real prepare and WRITING NOTHING. A period that HAS ended shows the STORED
//  FROZEN LINES — window.Payroll.load(periodId), exactly as before this build.
//  Nothing payable is EVER read off a projection: what gets paid is always the
//  stored frozen line, and the screen only opens the pay panel in closed mode.
//
//  THE SHAPE OF THE SCREEN, in the order the eye meets it:
//     1. what is waiting, in one sentence, with the money in it
//     2. every period THIS TEAM still owes, oldest first (a missed period
//        cannot hide) — the OTHER team's own unpaid periods get one quiet
//        line, never mixed into this list (clutter/segregation fix,
//        2026-08-12: "not segregated for office and operations" outranks the
//        earlier "cross-team so a missed period cannot hide" reasoning; see
//        _pyPaintWaiting)
//     3. the problems, in sentences, each with the person's name and a Fix —
//        several people sharing the identical problem collapse into ONE
//        sentence naming all of them, not one row apiece (_pyGroupProblems)
//     4. the roster — one card per person, every figure visible, including
//        "Who else should be here?" in its own header (folded in, not a
//        floating block)
//     5. ONE button, named for what it does, saying what it costs in ONE
//        short sentence — after the roster, not before it (2026-08-12; this
//        used to sit above the roster so it stayed reachable without
//        scrolling past thirty cards, but the owner's decluttering ruling
//        ("cluttered messy unorganized") outranks that convenience)
//
//  TWO BUTTONS IN THE WHOLE FLOW, and you only ever see one of them:
//     HR      "Hours are correct - send to Finance"   (state 'prepared')
//     Finance "Pay everyone"                          (state 'checked')
//  The first step — building the lines — is not a button at all. Opening a
//  period that has not been started prepares it FOR you (see _pyMaybePrepare).
//  The owner's rule was that the step count must go DOWN and that adding a step
//  to solve a problem is forbidden; the reasons the old three steps existed (a
//  frozen line, a review before money moves, a lock against a double press) all
//  survive — they are things the system does, not chores handed to a person.
//
//  DATA COMES FROM window.Payroll AND NOTHING ELSE. This file opens no
//  Firestore collection, and it does NO money arithmetic: every peso it prints
//  is read off the frozen line. The only sums it performs are the roster
//  totals, and those add up the very numbers the rows above them printed — the
//  same rule the weekly screen follows — so a total can never contradict its
//  own column. There is exactly one expression for a person's pay and it lives
//  in js/money-core.js.
//
//  MOBILE IS A HARD REQUIREMENT, NOT A TIER (brief §"Mobile is a requirement").
//  At 375px the roster is ONE CARD PER PERSON with every figure permanently
//  visible. Not a <table>. Not .table-cards (that hides every .tc-detail cell
//  behind a tap, and a hidden deduction IS hidden data). No ellipsis anywhere —
//  a shortened peso amount is a wrong peso amount to whoever reads it. No
//  horizontal scroll: nothing in this file's CSS declares overflow at all.
//  (That last point is load-bearing beyond layout: js/app.js's memoised scroll
//  walk documents that NO js file injects a <style> rule with an overflow
//  declaration, and its scroller lint is built on that. Keep it true.)
//
//  VOCABULARY. The words compute, verify, disburse, delta, reconciliation,
//  draft, run, Type A and Type B do not appear in one user-visible string in
//  this file. The four states are shown verbatim as:
//     'notstarted' -> "Not started"      'prepared' -> "Ready to check"
//     'checked'    -> "Checked - waiting for payment"     'paid' -> "Paid"
// ═══════════════════════════════════════════════════════════

'use strict';

// `var`, not `const`, for every FILE-SCOPE binding. A top-level `const` in a
// classic script creates a global LEXICAL binding, and a second evaluation of
// the same file — a duplicated <script> tag, a stale service-worker copy served
// beside the fresh one — throws "Identifier has already been declared" and
// takes the WHOLE file with it, i.e. the pay screen disappears. `var`
// re-evaluates harmlessly. Every name here is PY_/_py-prefixed and was checked
// unique across js/ and js/screens/.

// How far back the picker reaches. Months and weeks are both in ONE list, so
// the two windows are chosen to cover roughly the same stretch of calendar:
// ~4 months of weeks, ~6 months of months (a missed month hides for longer than
// a missed week does, because nobody is standing at the gate asking about it).
var PY_WEEK_WINDOW  = 17;
var PY_MONTH_WINDOW = 6;

// The four states, in order, and the ONLY words the screen is allowed to show
// for them. Copied verbatim from the contract — do not paraphrase these.
var PY_STATES = ['notstarted', 'prepared', 'checked', 'paid'];
var PY_STATE_WORDS = {
  notstarted: 'Not started',
  prepared:   'Ready to check',
  checked:    'Checked - waiting for payment',
  paid:       'Paid'
};

// Where the screen was left. Module-scope on purpose: the owner's complaint was
// that every action bounced him back to today ("Stop losing your place",
// audit §5). Re-entering payroll returns to the TAB and that tab's period you
// were working on (D8) — each team remembers its own place independently.
var PY_LAST_TEAM = null;
var PY_LAST_PERIOD_BY_TEAM = { office: null, operations: null };
var PY_TEAM_LABEL = { office: 'Office Team', operations: 'Operations Team' };

var PY_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ── Local formatting/escaping shims ────────────────────────────────────────
// Resolved at CALL time, never at parse time: this file is a plain <script>
// like every other js/*.js and its position in index.html's fixed load order
// must not become load-bearing for a currency format.
var _pyEsc  = (s) => (window.escHtml ? window.escHtml(s) : String(s == null ? '' : s));
var _pyN    = (n) => (window.fmtN2 ? window.fmtN2(n) : (Number(n) || 0).toFixed(2));
// "-₱500.00", never "₱-500.00" — the sign belongs outside the symbol. A period
// with an advance still on the books can genuinely go negative and that has to
// be readable at a glance.
var _pyPeso = (n) => ((Number(n) || 0) < 0 ? '-₱' : '₱') + _pyN(Math.abs(Number(n) || 0));
var _pyHrs  = (n) => (Number(n) || 0).toFixed(2);
var _pyIcon = (g, s) => (window.emojiIcon ? window.emojiIcon(g, s) : '');

// A line's person id / name can arrive under several names depending on which
// engine froze it (the weekly guard works on worker_profiles docs, the monthly
// one on user docs). Resolve defensively rather than assume: a line whose id
// cannot be read must still RENDER — it simply cannot be acted on, and the card
// says so — because dropping a person off a pay roster is the one failure this
// screen exists to prevent.
var _pyId   = (o) => (o && (o.personId || o.workerId || o.uid || o.id || '')) || '';
var _pyName = (o) => (o && (o.name || o.workerName || o.displayName || o.email || '')) || '';

// First finite number among the candidates, else null. `null` means "this line
// has no such figure", which is different from zero and is printed as "—".
function _pyPick() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (typeof v === 'number' && isFinite(v)) return v;
  }
  return null;
}
function _pySum() {
  let any = false, t = 0;
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (typeof v === 'number' && isFinite(v)) { any = true; t += v; }
  }
  return any ? t : null;
}

// ═══════════════════════════════════════════════════════════
//  READING A FROZEN LINE — NEVER RECOMPUTING ONE
//  computePayLine (monthly) and computeWeeklyLine (weekly) freeze different
//  field names for the same ideas, because they were written eighteen months
//  apart. The owner's ruling is that payClass changes the ARITHMETIC and
//  nothing downstream — so the difference is resolved HERE, once, into one
//  display shape, and the rest of the screen never asks which team a person is
//  on. Every branch below is a READ or a sum of already-frozen components; not
//  one of them multiplies a rate by an hour.
// ═══════════════════════════════════════════════════════════
function _pyRead(l) {
  l = l || {};
  const stat = _pyPick(
    (l.statutory && typeof l.statutory.total === 'number') ? l.statutory.total : undefined,
    l.statutoryTotal,
    _pySum(l.sss, l.philhealth, l.pagibig, l.tax)
  );
  // Earnings = what the work earned, BEFORE allowances. computeWeeklyLine's
  // `gross` ALREADY contains allowanceTotal, so printing gross beside an
  // allowances column double-counts allowances to the eye (the weekly screen
  // was corrected for exactly this). Summed from the line's own frozen
  // components; `base` is the monthly engine's equivalent.
  const earnings = _pyPick(
    l.earnings,
    _pySum(l.regularPay, l.otPay, l.travelPay),
    l.base
  );
  const oneOffs = Array.isArray(l.oneOffs) ? l.oneOffs : [];
  const oneOffNet = oneOffs.length
    ? oneOffs.reduce((a, o) => a + ((o && o.kind === 'deduction') ? -(+o.amount || 0) : (+o.amount || 0)), 0)
    : null;
  return {
    id:   _pyId(l),
    name: _pyName(l) || _pyId(l) || 'Unnamed person',
    // The rate and where it came from. A person set up with only a daily rate
    // resolves through resolveWorkerHourlyRate (dailyRate ÷ 8) — showing the
    // source is what makes "why is this figure what it is" answerable without
    // opening anyone's profile.
    rate:       _pyPick(l.rate, l.hourlyRate),
    rateSource: l.rateSource || '',
    monthlySalary: _pyPick(l.salary, (l.payClass === 'production' ? undefined : l.base)),
    daysWorked: _pyPick(l.daysWorked),
    daysAbsent: _pyPick(l.daysAbsent),
    daysOverridden: _pyPick(l.daysOverridden) || 0,
    regHours:   _pyPick(l.regHours),
    otHours:    _pyPick(l.otHours),
    travelHours:_pyPick(l.travelHours),
    earnings,
    allowances: _pyPick(l.allowanceTotal, l.allowance),
    oneOffNet,
    oneOffs,
    // otherDeductionsOnly, NOT otherDeductions: the weekly engine folds
    // statutory INTO otherDeductions before the clamp and keeps the split whole
    // on the line for exactly this reason. Printing the combined figure beside
    // a government-deductions column counts statutory twice on screen.
    otherDed:   _pyPick(l.otherDeductionsOnly, l.otherDeductions, l.deductions),
    statutory:  stat,
    cashAdv:    _pyPick(l.caDeduction, l.caPlanned),
    caBalanceBefore: _pyPick(l.caBalanceBefore, l.caBalance),
    caBalanceAfter:  _pyPick(l.caBalanceAfter),
    caShortfall:     _pyPick(l.caShortfall),
    takeHome:   _pyPick(l.takeHome, l.net, l.finalPay),
    rows:       Array.isArray(l.rows) ? l.rows : [],
    backfill:   l.backfill === true,
    // "Where did the number come from" (§6.4) — Office Team only; these are
    // already frozen onto the line by computePayLine, never recomputed here.
    kpiScore:   _pyPick(l.detail && l.detail.kpiScore, l.kpiScore),
    attScore:   _pyPick(l.detail && l.detail.attendanceScore, l.attScore),
    policy:     (l.detail && l.detail.policy) || l.policy || 'flat',
    perfFactor: _pyPick(l.perfFactor, l.detail && l.detail.perfFactor),
    // STATUTORY-BY-STATUS-SPEC-2026-08-12 — passed through from the
    // normalised line untouched; nothing here is recomputed.
    employmentStatus: (l.detail && l.detail.employmentStatus) || l.employmentStatus || '',
    statutoryBasis:   (l.detail && l.detail.statutoryBasis) || l.statutoryBasis || '',
    statusFlag: l.statusFlag || null,
    raw: l
  };
}

// The rate-source codes computePayLine/resolveWorkerHourlyRate freeze onto a
// line, mapped to the plain words the owner's "where did this come from"
// question needs (§6.4) — never the raw code, which is engine vocabulary.
var PY_RATE_SOURCE_WORDS = {
  hourlyRate: 'their hourly rate',
  dailyRate:  'daily rate ÷ 8'
};
function _pyRateSourceWords(src) {
  return PY_RATE_SOURCE_WORDS[src] || String(src || '');
}

// The columns, in order. A column is shown when ANY person in the period has a
// figure for it, and then it is shown on EVERY card (as "—" where a person has
// none) so the figures line up across cards on a wide screen. Take-home and
// earnings are always shown: a roster that can omit the take-home column is not
// a roster.
var PY_COLS = [
  { key: 'days',        label: 'Days',                 always: false },
  { key: 'regHours',    label: 'Hours',                always: false },
  { key: 'otHours',     label: 'Overtime',             always: false },
  { key: 'travelHours', label: 'Travel hours',         always: false },
  // Office Team, "where did the number come from" (§6.4) — present only when
  // the line carries a score, so an Operations card never shows an empty
  // Attendance/KPI pair. Percentages, not money — kept OUT of the totals sum
  // below; averaging a percentage across a roster asserts a figure nobody
  // asked for.
  { key: 'attScore',    label: 'Attendance',           always: false },
  { key: 'kpiScore',    label: 'KPI',                  always: false },
  { key: 'earnings',    label: 'Earnings',             always: true  },
  { key: 'allowances',  label: 'Allowances',           always: false },
  { key: 'oneOffNet',   label: 'One-off amounts',      always: false },
  { key: 'otherDed',    label: 'Other deductions',     always: false },
  { key: 'statutory',   label: 'Government deductions',always: false },
  { key: 'cashAdv',     label: 'Cash advance',         always: false },
  { key: 'takeHome',    label: 'Take-home pay',        always: true  }
];

// Column keys that are MONEY, HOURS or COUNTS — the ones a totals row can
// honestly sum. attScore/kpiScore are percentages and never appear here.
var PY_SUMMABLE_KEYS = ['regHours', 'otHours', 'travelHours', 'earnings', 'allowances',
  'oneOffNet', 'otherDed', 'statutory', 'cashAdv', 'takeHome'];

// Which columns this period actually needs. Deliberately NOT "every column
// always": an office month has no travel hours, and a column of "—" asserts
// something. But once a column is in, it is on every card — alignment is what
// makes 30 cards readable, and a missing cell would slide the next figure into
// the wrong column, which on a pay roster is a lie.
function _pyColsFor(reads) {
  const has = {};
  reads.forEach(r => {
    if (r.daysWorked != null || r.daysAbsent != null) has.days = true;
    PY_SUMMABLE_KEYS.concat(['attScore', 'kpiScore']).forEach(k => {
      if (r[k] != null && !(k === 'oneOffNet' && !r.oneOffs.length)) has[k] = true;
    });
    // Findability fix (2026-08-12 — "cant find where to apply ca deduction"):
    // an outstanding cash advance must be VISIBLE even for a person whose
    // instalment this period is still 0/unset. Otherwise the column only
    // reliably reads as "in use" once somebody has already typed a non-zero
    // number into it, which is exactly backwards — the whole point is to show
    // there IS a balance to collect, so the field gets found and used.
    if (r.caBalanceBefore != null && r.caBalanceBefore > 0) has.cashAdv = true;
  });
  return PY_COLS.filter(c => c.always || has[c.key]);
}

// Sum of the printed components, for the totals card. Never a recomputation of
// pay — it only ever adds up numbers the cards themselves printed.
function _pyTotals(reads) {
  const t = { people: reads.length };
  PY_COLS.forEach(c => { t[c.key] = 0; });
  t.daysWorked = 0; t.daysAbsent = 0;
  reads.forEach(r => {
    t.daysWorked += (+r.daysWorked || 0);
    t.daysAbsent += (+r.daysAbsent || 0);
    PY_SUMMABLE_KEYS.forEach(k => { t[k] += (+r[k] || 0); });
  });
  return t;
}

// The reasons a person is not being paid, in words. NOBODY IS SILENTLY
// DROPPED: every person the period does not pay appears on the roster, with
// this sentence under their name. `danger` marks the ones that mean "we do not
// know" rather than "we decided" — paying zero on an unread period is exactly
// the silent-zero this design exists to prevent.
function _pyNotPaidWords(reason) {
  const r = String(reason || '');
  if (r === 'removed')        return { short: 'Removed from the system',      note: 'Off the roster — put their profile back before they can be paid.', undoable: false };
  if (r === 'paid-monthly')   return { short: 'Paid on the monthly cycle',    note: 'Already paid for this month on the monthly cycle — kept out of this period so nobody is paid twice.', undoable: false };
  if (r === 'paid-weekly')    return { short: 'Paid on the weekly cycle',     note: 'Already paid for these days on the weekly cycle — kept out of this period so nobody is paid twice.', undoable: false };
  if (r === 'no-rate')        return { short: 'No pay rate on file',          danger: true, note: 'No monthly salary, hourly or daily rate on this person\'s profile. Rather than pay ₱0.00, they are left out — put a rate on their profile and open this period again.', undoable: false };
  if (r === 'missing')        return { short: 'Their record could not be read', danger: true, note: 'This person\'s profile could not be read for this period.', undoable: false };
  if (r === 'not-in-payroll') return { short: 'Not included in payroll',      note: 'Their profile is set to be left out of payroll. That belongs to the PERSON, not to this period — change it on their profile if they should be paid.', undoable: false };
  if (r === 'attendance-unreadable') return { short: 'Attendance could not be read', danger: true, note: 'Their punches for this period could not be read, so they were left out rather than paid zero. Open this period again before paying — do not pay around this.', undoable: false };
  if (r.startsWith('held') || r.startsWith('excluded')) {
    const why = r.replace(/^(held|excluded)/, '').replace(/^[:\s-]*/, '');
    return {
      short: 'On hold for this period' + (why ? ' — ' + why : ''),
      // Said out loud because it is the opposite of what the old flag did, and
      // the difference is money: a hold is period-scoped (owner ruling), so the
      // next period starts with them back on the roster.
      note: 'Held for this period only. Next period they are back on the roster and you decide again.',
      undoable: true
    };
  }
  return { short: r || 'Not paid this period', note: 'This person was not paid for this period.', undoable: !!r };
}

// Error state with a Retry. A DENIED READ MUST NEVER RENDER AS AN EMPTY
// ROSTER: on a pay screen "no rows" and "you may not see the rows" look
// identical, and one of them reads as "nobody is owed anything".
function _pyError(el, err, retry, headline) {
  if (!el) return;
  const msg = (err && err.message) ? err.message : String(err);
  el.innerHTML =
    '<div class="empty-state">' +
      '<div class="empty-icon">' + _pyIcon('⚠️', 44) + '</div>' +
      '<h4>' + _pyEsc(headline || 'This period could not be read') + '</h4>' +
      '<p>' + _pyEsc(msg) + '</p>' +
      '<p style="font-size:12px;color:var(--text-muted);margin-top:6px">Nothing is shown rather than an empty roster — an empty roster here would read as “nobody is owed anything”.</p>' +
      (retry ? '<button type="button" class="btn-secondary btn-sm py-retry-btn" style="margin-top:14px">Retry</button>' : '') +
    '</div>';
  if (retry) el.querySelector('.py-retry-btn')?.addEventListener('click', retry);
  if (window.lucide && el.querySelector('[data-lucide]:not(svg)')) lucide.createIcons({ nodes: [el] });
}

// ── The stylesheet ─────────────────────────────────────────────────────────
// Shipped inline with the screen rather than added to css/styles.css because
// this file owns it and nothing else uses it. Two rules matter:
//   • NOT ONE overflow DECLARATION. No horizontal scroll is a requirement, and
//     js/app.js's scroll walk documents that no JS file injects one.
//   • NOT ONE text-overflow/ellipsis DECLARATION, and `overflow-wrap:anywhere`
//     on every value, so a long name or a big peso figure WRAPS instead of
//     being cut. A shortened amount is a wrong amount.
// The field grid is `repeat(auto-fit, minmax(126px, 1fr))`: at 375px that is
// two columns of ~150px (a label and a peso figure fit with room), and on a
// laptop it opens out to the full column count so figures line up across cards
// — the table shape returns where the columns genuinely fit, without a <table>
// and without a single hidden cell at any width in between.
var PY_CSS = `
/* EVERY card reserves the same 3px left border and only the COLOUR changes.
   A flagged card that widened its own border by 2px would shift its figures
   2px out of line with the card above it — and the whole reason this is a grid
   of identical fields is so that thirty people's take-home pay reads down one
   straight column. */
#pay-root .py-card{border:1px solid var(--border);border-left:3px solid transparent;border-radius:12px;background:var(--surface);padding:12px 14px;margin-bottom:10px}
#pay-root .py-card.py-flagged{border-left-color:var(--warning)}
#pay-root .py-card.py-danger{border-left-color:var(--danger)}
#pay-root .py-card.py-onhold{opacity:.72;border-style:dashed}
/* Colour only — NOT border-width. Widening this card's border moved its
   figures a pixel out of line with every person below it, which is the one
   thing a totals row must never do. */
#pay-root .py-card.py-totals{background:var(--s1);border-color:var(--text-muted)}
#pay-root .py-who{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;margin-bottom:2px}
#pay-root .py-who strong{font-size:15px;line-height:1.25;overflow-wrap:anywhere;min-width:0}
#pay-root .py-sub{font-size:11px;color:var(--text-muted);line-height:1.5;overflow-wrap:anywhere;margin-bottom:10px}
#pay-root .py-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(126px,1fr));gap:9px 12px}
/* On a laptop the tracks narrow so all eleven figures sit on ONE line — the
   table shape returning where the columns genuinely fit, without a <table> and
   without a cell that hides. 104px still holds "₱38,596.50" at 14px with room;
   anything longer wraps inside its own cell rather than being cut. */
@media (min-width:1024px){#pay-root .py-fields{grid-template-columns:repeat(auto-fit,minmax(104px,1fr))}}
#pay-root .py-f{min-width:0}
#pay-root .py-f-label{display:block;font-size:10px;line-height:1.4;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted);overflow-wrap:anywhere}
#pay-root .py-f-val{display:block;font-size:14px;line-height:1.4;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
#pay-root .py-f-note{display:block;font-size:10px;line-height:1.4;color:var(--text-muted);overflow-wrap:anywhere}
#pay-root .py-f-net .py-f-val{font-weight:700;font-size:16px}
#pay-root .py-plus{color:var(--success)}
#pay-root .py-minus{color:var(--danger)}
#pay-root .py-nil{color:var(--text-muted)}
#pay-root .py-rowacts{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}
#pay-root .py-rowacts button{flex:0 1 auto}
#pay-root .py-problem{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)}
#pay-root .py-problem:last-child{border-bottom:0}
#pay-root .py-problem .py-ptext{flex:1 1 220px;min-width:0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
#pay-root .py-actbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
#pay-root .py-actbar .py-cost{flex:1 1 240px;min-width:0;font-size:12px;color:var(--text-muted);line-height:1.55;overflow-wrap:anywhere}
#pay-root .py-bigbtn{font-size:15px;padding:12px 18px;min-height:48px}
#pay-root .py-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
#pay-root .py-head select{flex:1 1 100%;min-width:0;max-width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:14px}
@media (min-width:700px){#pay-root .py-head select{flex:0 1 480px}}
/* The team tabs take the whole first line of the head row, so the picker and
   the buttons always wrap onto a clean line below them rather than fighting
   for space beside them at 375px. */
#pay-root .py-team-tabs{flex:1 1 100%}
#pay-root .py-live-banner{border-left:3px solid var(--info,var(--accent,#3b82f6))}
#pay-root .py-headline{font-size:16px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}
#pay-root .py-waiting-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)}
#pay-root .py-waiting-row:last-child{border-bottom:0}
#pay-root .py-waiting-row .py-wlabel{flex:1 1 190px;min-width:0;overflow-wrap:anywhere}
#pay-root .py-oneoff{font-size:11px;color:var(--text-muted);line-height:1.5;overflow-wrap:anywhere;margin-top:6px}
`;

// ═══════════════════════════════════════════════════════════
//  THE SCREEN
// ═══════════════════════════════════════════════════════════
window.renderPayrollPage = async function (container, currentUser, currentRole) {
  const host = container || (typeof deptContainer === 'function' ? deptContainer() : null);
  if (!host) return;

  // The engine is a separate file loaded before this one. If it is absent, SAY
  // SO. Painting a bare "nothing here" screen would be the silent-zero failure
  // in its purest form.
  if (!window.Payroll || typeof window.Payroll.load !== 'function') {
    _pyError(host, new Error('The payroll engine (window.Payroll) did not load. Reload the app; if it keeps happening, the payroll script is missing from index.html.'),
      () => window.renderPayrollPage(host, currentUser, currentRole), 'Payroll is unavailable');
    return;
  }

  // ── RE-ENTRY GUARD — this is a MONEY bug if it is missing ────────────────
  // This renderer awaits several reads and only then binds listeners. Entering
  // twice while the first load is in flight leaves the first paint's handlers
  // bound to the second paint's DOM — measured on the old monthly screen as ONE
  // tap running the same money action TWICE. Mount once per host and route
  // every later entry through the same latest-wins loader.
  if (typeof host._payrollLoad === 'function' && host.querySelector('#pay-root')) {
    return host._payrollLoad();
  }

  const role = currentRole || window.currentRole || '';
  // WHO DOES WHAT (the owner's second ruling: HR prepares, Finance pays).
  //   canPrepare — the oversight tier, which is where HR sits (isOpsPriv
  //     mirrors firestore.rules' isOpsAdmin: president/manager/secretary/
  //     finance). These are the people who own hours, rates and corrections.
  //   canPay — the MONEY tier only (isMoneyPriv mirrors isMoneyAdmin:
  //     president/manager/finance). Deliberately narrower: the rules will not
  //     let a secretary write pay, and a button whose write is refused is worse
  //     than no button.
  const canPrepare = (typeof window.isOpsPriv === 'function') ? window.isOpsPriv()
                   : ['president', 'owner', 'manager', 'secretary', 'finance'].includes(role);
  const canPay     = (typeof window.isMoneyPriv === 'function') ? window.isMoneyPriv()
                   : ['president', 'owner', 'manager', 'finance'].includes(role);

  // Manila, via the app's own helper — a raw toISOString() is UTC and picks the
  // WRONG week for the first eight hours of every Manila day, which would open
  // the screen on last period's roster every morning.
  const todayIso   = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10);
  const thisWeekId = window.payWeekMondayOf ? window.payWeekMondayOf(todayIso) : todayIso;
  const thisMonth  = todayIso.slice(0, 7);

  host.innerHTML = '<style>' + PY_CSS + '</style><div id="pay-root">' + window.skeletonHtml('rows') + '</div>';
  const root = host.querySelector('#pay-root');

  // Warnings come back from prepare() and are not necessarily part of the
  // stored record, so they are held here until the next prepare rather than
  // lost on the reload that follows it. Keyed by period so switching periods
  // never shows another period's warnings.
  const warningsByPeriod = {};
  // One automatic prepare attempt per period per visit. Without this a period
  // that legitimately produces nothing (an empty roster, a refused read) would
  // be prepared again on every paint, forever.
  const prepareTried = {};

  let selected = null;
  let busy = false, pending = null;

  // Latest-wins serialisation. A load requested while one is in flight is
  // REMEMBERED, not started, so two paints can never own #pay-root at once.
  const load = async (periodId) => {
    const want = periodId || selected;
    if (busy) { pending = want; return; }
    busy = true;
    try {
      await paint(want);
    } catch (e) {
      // THROWN = a failed READ (the engine's contract: null means "not started",
      // an exception means the read failed). Never an empty roster.
      _pyError(root, e, () => load(want));
    } finally {
      busy = false;
      if (pending !== null) { const next = pending; pending = null; await load(next); }
    }
  };
  host._payrollLoad = load;

  // ═════════════════════════════════════════════════════════
  //  THE PERIOD LIST — months and weeks in ONE list, newest first
  //  A month is "2026-08"; a week is the Monday, "2026-08-11". They sort
  //  together on the day the period STARTS, so August 2026 sits just above the
  //  week of 3 Aug and just below the week of 11 Aug — which is the order
  //  somebody scanning for "what have I not paid" actually wants.
  // ═════════════════════════════════════════════════════════
  function _pyKind(periodId) {
    if (typeof window.Payroll.kindOf === 'function') {
      try { const k = window.Payroll.kindOf(periodId); if (k) return k; } catch (_) { /* shape fallback below */ }
    }
    return String(periodId || '').length > 7 ? 'week' : 'month';
  }
  function _pyLabel(periodId) {
    if (typeof window.Payroll.label === 'function') {
      try { const l = window.Payroll.label(periodId); if (l) return l; } catch (_) { /* never blank a picker option */ }
    }
    return String(periodId || '');
  }
  // 'office' for a month period, 'operations' for a week — D8: a period's kind
  // already decides which team it belongs to structurally (a month period only
  // ever contains Office people; a week only Operations). One mapping, reached
  // through the engine's own PC.teamOf where available, with the same
  // never-blank fallback discipline as _pyKind/_pyLabel above.
  function _pyTeam(periodId) {
    if (window.Payroll.core && typeof window.Payroll.core.teamOf === 'function') {
      try { const t = window.Payroll.core.teamOf(periodId); if (t) return t; } catch (_) { /* fallback below */ }
    }
    return _pyKind(periodId) === 'week' ? 'operations' : 'office';
  }
  // A month sorts as its first day; a week already IS its first day. On a tie
  // (the 1st falling on a Monday) the month comes first — it is the longer
  // period and reads as the heading of the two.
  function _pySortKey(periodId) {
    return (_pyKind(periodId) === 'month' ? periodId + '-01' + '#0' : periodId + '#1');
  }
  // Team tabs (D8): the picker for a tab lists ONLY that team's kind of
  // period — office sees months, operations sees weeks. `extra` is expected to
  // already be filtered to the active team by the caller.
  function _pyPeriodList(team, extra) {
    const set = {};
    const add = (p) => { if (p && !set[p]) set[p] = true; };
    if (team === 'operations') {
      try { (window.Payroll.recentPeriods('week', PY_WEEK_WINDOW) || []).forEach(add); } catch (_) {}
      add(thisWeekId);
    } else {
      try { (window.Payroll.recentPeriods('month', PY_MONTH_WINDOW) || []).forEach(add); } catch (_) {}
      add(thisMonth);
    }
    (extra || []).forEach(add);
    return Object.keys(set).sort((a, b) => (_pySortKey(a) < _pySortKey(b) ? 1 : -1));
  }

  // The default period to open for a team when nothing more specific was
  // asked for — a team tab click, or "This week"/"This month".
  function _pyDefaultForTeam(team) {
    return PY_LAST_PERIOD_BY_TEAM[team] || (team === 'operations' ? thisWeekId : thisMonth);
  }

  // ═════════════════════════════════════════════════════════
  //  PAINT — one function, whole screen, always from stored data (or, for a
  //  period that has not ended yet, from the live projection — D3)
  // ═════════════════════════════════════════════════════════
  async function paint(periodId) {
    root.innerHTML = window.skeletonHtml('rows');

    // What is still owing, straight from the engine, UNFILTERED across both
    // teams (D8) — this card stays cross-team on both tabs so a period owing
    // on the OTHER tab can never hide. Also how a period outside the picker's
    // window stays reachable: a February week nobody paid must be selectable.
    let owing = [];
    let owingError = null;
    if (typeof window.Payroll.unpaidPeriods === 'function') {
      try { owing = (await window.Payroll.unpaidPeriods()) || []; }
      catch (e) { owingError = e; owing = []; }
    }
    const owingIds = owing.map(o => (o && (o.periodId || o.id)) || '').filter(Boolean);

    // WHICH PERIOD ARE WE LOOKING AT, and which TAB does that put us on
    // (D8). In order of what the owner actually wants when he opens the
    // screen:
    //   1. the period he asked for (a picker change, a team-tab click, an
    //      Open from the waiting card, a re-entry)
    //   2. the OLDEST period with work waiting on somebody, over the
    //      UNFILTERED owing list — the chosen period's team decides the tab
    //   3. otherwise the current week (Operations)
    let want = periodId || (PY_LAST_TEAM ? PY_LAST_PERIOD_BY_TEAM[PY_LAST_TEAM] : null);
    if (!want) {
      const waiting = owing
        .filter(o => o && (o.state === 'prepared' || o.state === 'checked'))
        .map(o => o.periodId || o.id)
        .filter(Boolean)
        .sort((a, b) => (_pySortKey(a) < _pySortKey(b) ? -1 : 1));
      want = waiting[0] || thisWeekId;
    }
    selected = want;
    const activeTeam = _pyTeam(selected);
    PY_LAST_TEAM = activeTeam;
    PY_LAST_PERIOD_BY_TEAM[activeTeam] = selected;

    // Every extra id offered to the picker is filtered to THIS team — an
    // Office tab lists only months, an Operations tab only weeks (D8).
    const sameTeamExtra = owingIds.concat([want]).filter(p => _pyTeam(p) === activeTeam);
    const periods = _pyPeriodList(activeTeam, sameTeamExtra);

    // IS THIS PERIOD STILL GOING, OR HAS IT ENDED (D3/D4/D5)? A live period
    // shows the read-only projection (window.Payroll.preview) — never a
    // stored line, and never a write. An ended period shows the stored
    // frozen line (window.Payroll.load), exactly as before this build.
    let isLive = !!(window.Payroll.core && typeof window.Payroll.core.periodEnded === 'function'
      && !window.Payroll.core.periodEnded(selected, todayIso));
    const periodEnd = (window.Payroll.core && typeof window.Payroll.core.periodEnd === 'function')
      ? window.Payroll.core.periodEnd(selected) : '';

    // THE SELECTED PERIOD is read on its own and is allowed to fail loudly —
    // its failure is the error state with a Retry. Both preview() and load()
    // share that same throw-on-denial contract.
    let period = isLive ? await window.Payroll.preview(selected) : await window.Payroll.load(selected);

    // ⚠ THE FINANCE-APPROVED EARLY RELEASE (F1, owner ruling 2026-08-11) can
    // move a still-calendar-live period to 'checked' or 'paid' before its
    // last day. Once that has happened the screen must show the STORED
    // FROZEN LINE, never a projection — what gets paid is always the frozen
    // line (§9.5) — so re-derive from load() and drop out of live-mode
    // display. preview() already returns the STORED state even while live,
    // which is what makes this detectable without a second date check.
    if (isLive && period && (period.state === 'checked' || period.state === 'paid')) {
      isLive = false;
      period = await window.Payroll.load(selected);
    }

    // If it has not been started and this person may start it, START IT —
    // but ONLY for a period that has ENDED (D4). A period that has not ended
    // has nothing worth freezing yet; looking at it must never write. This is
    // the step that used to be a button called Compute, for the periods it
    // still applies to. Nobody has to know it exists: you open an ended
    // period and the figures are there.
    if (!isLive && canPrepare && !prepareTried[selected] && (!period || (period.state || 'notstarted') === 'notstarted')) {
      prepareTried[selected] = true;
      root.innerHTML = `<div class="empty-state"><div class="empty-icon">${_pyIcon('⏳', 40)}</div>
        <h4>Working out the pay for ${_pyEsc(_pyLabel(selected))}…</h4>
        <p>Reading the punches, the rates and the amounts on file.</p></div>`;
      try {
        const res = await window.Payroll.prepare(selected);
        warningsByPeriod[selected] = (res && res.warnings) || [];
        period = await window.Payroll.load(selected);
      } catch (e) {
        // NOT the error state: a period that cannot be built is a different
        // thing from a period that cannot be READ, and the roster below still
        // has something honest to say (usually "nobody is on the roster").
        warningsByPeriod[selected] = [(e && e.message) ? e.message : String(e)];
        try { period = await window.Payroll.load(selected); } catch (_) { period = null; }
      }
    }

    // The rest of the picker's periods are read with allSettled, NOT all: one
    // unreadable old period must not brick the whole screen, but it must not be
    // silently dropped from "what is still owing" either — the ones that failed
    // are named in a banner of their own. These stay on window.Payroll.load —
    // they are secondary reference (the picker's suffix, the waiting card's
    // totals), never the figures on screen for the selected period.
    const others = periods.filter(p => p !== selected);
    const settled = await Promise.allSettled(others.map(p => window.Payroll.load(p)));
    const byPeriod = {}; const unreadable = [];
    byPeriod[selected] = period;
    others.forEach((p, i) => {
      if (settled[i].status === 'fulfilled') byPeriod[p] = settled[i].value || null;
      else { byPeriod[p] = undefined; unreadable.push(p); }
    });

    const state   = _pyStateOf(period);
    const lines   = (period && Array.isArray(period.lines)) ? period.lines : [];
    const reads   = lines.map(_pyRead);
    const cols    = _pyColsFor(reads);
    const tot     = _pyTotals(reads);
    const notPaid = _pyNotPaidList(period);
    const kind    = _pyKind(selected);
    let periodDates = [];
    if (kind === 'week' && typeof window.payWeekDays === 'function') {
      try { periodDates = window.payWeekDays(selected) || []; } catch (_) { periodDates = []; }
    }
    // D10(b) — in live mode the card's "Days" field reads "{worked} of
    // {elapsed} so far" rather than "{worked} of 7", since the days that
    // have not happened yet are not "absent" to omit them from. Attached
    // directly onto each read row (rather than threaded through every
    // function signature down to _pyFieldHtml) — the same pattern the reads
    // already use for backfill/rateSource/etc.
    if (isLive && kind === 'week' && periodDates.length) {
      const elapsed = periodDates.filter(d => d <= todayIso).length;
      reads.forEach(r => { r._elapsedTotal = elapsed; });
    }
    // TASK-BASED-PAY-SPEC-2026-08-12 §8.4 — the minimum-wage floor, fetched
    // once per paint (not per line, not per card) and only for month periods
    // — the Operations Team is hourly and has no floor gate (§8.4/§14 Q3).
    let wageFloorMonthly = null, wageFloorReadFailed = false;
    if (kind !== 'week') {
      try {
        const _wfSnap = await db.collection('settings').doc('payrollWageFloor').get();
        wageFloorMonthly = (_wfSnap && _wfSnap.exists) ? (_wfSnap.data() || {}).monthlyFloor : null;
      } catch (_) { wageFloorReadFailed = true; }
    }
    const problems = _pyProblems(period, reads, notPaid, selected, { isLive, todayIso, periodDates, wageFloorMonthly, wageFloorReadFailed });
    const label   = _pyLabel(selected);

    // Row actions live on the ROSTER ROW, never in a menu somewhere else — that
    // is the owner's rule about flexibility not arriving as more surface area.
    // Which ones are live depends on the state AND on whether the period is
    // still live (D6 — mid-period edits are allowed and are INPUTS, not money):
    //   live (in progress)     — hold, adjust, add a one-off; no check/pay
    //                            action anywhere (D5)
    //   'notstarted'/'prepared'— hold, adjust, add a one-off
    //   'checked'               — nothing (the figures are locked; that is what
    //                             "checked" means, and unlocking is a deliberate
    //                             act with its own control)
    //   'paid'                  — correct this person, and nothing else
    const canEditRows   = canPrepare && (isLive || state === 'notstarted' || state === 'prepared');
    const canCorrectRow = canPay && !isLive && state === 'paid';

    root.innerHTML = `
      <div class="py-head">
        ${window.chipTabs([
          { key: 'office', label: 'Office Team' },
          { key: 'operations', label: 'Operations Team' }
        ], activeTeam, { cls: 'py-team-tabs' })}
        <select id="py-period" aria-label="Pay period">${_pyPeriodOptions(periods, byPeriod, owing)}</select>
        <!-- The title REPEATS the visible label. A title that only carries the
             explanation becomes the button's accessible name and a screen
             reader then announces something the sighted label does not say. -->
        <button class="btn-secondary btn-sm" id="py-thisweek" title="${activeTeam === 'operations' ? 'This week' : 'This month'} — jump to the ${activeTeam === 'operations' ? 'week' : 'month'} that contains today">${activeTeam === 'operations' ? 'This week' : 'This month'}</button>
        ${isLive ? '<button class="btn-secondary btn-sm" id="py-refresh-figures" title="Re-read the punches, attendance and records as they stand right now">Refresh figures</button>' : ''}
        <!-- THE STUCK-AT-ZERO TRAP (owner, 2026-08-13: July showed "Ready to
             check — 0 people, ₱0.00" and asked why). An ENDED period is worked
             out ONCE, automatically, on the first open — but that auto-step
             only fires while the state is still 'notstarted'. If the roster
             was wrong at that moment (nobody had a rate yet, nobody was marked
             as paid monthly), the period froze at nobody, and there was no
             control anywhere to work it out again: "Refresh figures" is
             painted only for a period that is still running. So a period could
             sit at zero for ever while the records underneath it were fixed —
             and the only enabled button was the one that sends that zero to
             Finance. The ENGINE always allowed this (PC.canPrepare admits
             'prepared'); the door was simply missing. -->
        ${(!isLive && canPrepare && state === 'prepared')
          ? '<button class="btn-secondary btn-sm" id="py-rework" title="Read the rates, records and punches again as they stand now, and rebuild this period from them">Work these out again</button>' : ''}
      </div>

      <div id="py-headline"></div>
      <div id="py-unreadable"></div>
      <div id="py-waiting" style="margin-bottom:14px"></div>
      <!-- ORDER (clutter fix, 2026-08-12 — owner: "cluttered messy unorganized").
           What is waiting -> problems, if any -> the roster -> the one action.
           The button used to sit ABOVE the roster so it stayed reachable
           without scrolling past thirty people; the owner's decluttering
           ruling outranks that convenience, so it now sits after the roster,
           where the eye actually finishes. "Who else should be here?" no
           longer gets its own floating block — it lives in the roster's own
           header (see _pyTotalsCard) so it reads as part of the roster,
           not an island between cards. -->
      <div id="py-problems" style="margin-bottom:14px"></div>
      <div id="py-roster"></div>
      <div id="py-action" style="margin-top:14px"></div>
    `;

    // "Who else should be here?" (D11) folded into the roster's own header
    // (_pyTotalsCard) instead of a standalone floating block — same visibility
    // rule _pyPaintWhoElse always used (canPrepare, a period exists, not paid).
    const whoElseHtml = (canPrepare && period && state !== 'paid')
      ? '<button type="button" class="btn-secondary btn-sm" id="py-whoelse-btn">Who else should be here?</button>' : '';

    _pyPaintHeadline(root.querySelector('#py-headline'), period, state, label, tot, reads, notPaid, { isLive, todayIso, periodEnd, kind });
    _pyPaintUnreadable(root.querySelector('#py-unreadable'), unreadable, owingError);
    _pyPaintWaiting(root.querySelector('#py-waiting'), owing, byPeriod, activeTeam);
    _pyPaintProblems(root.querySelector('#py-problems'), problems);
    _pyPaintRoster(root.querySelector('#py-roster'), { period, state, reads, cols, tot, notPaid, canEditRows, canCorrectRow, label, isLive, periodDates, todayIso, whoElseHtml });
    _pyPaintAction(root.querySelector('#py-action'), { period, state, label, tot, reads, notPaid, isLive, periodEnd, kind });

    if (window.lucide) lucide.createIcons({ nodes: [root] });
    _pyBind({ period, state, label, reads, notPaid, tot, canEditRows, canCorrectRow, isLive, periodEnd, kind, activeTeam });
    _pyBindHrRecordBtns(root);
  }

  function _pyStateOf(period) {
    const s = period && period.state;
    return PY_STATES.includes(s) ? s : 'notstarted';
  }

  // ── The picker ───────────────────────────────────────────────────────────
  // Every option carries its own state and total, so the answer to "what have I
  // not paid" is in the list itself and not behind a click. A period that could
  // not be read says so rather than silently reading as empty.
  function _pyPeriodOptions(periods, byPeriod, owing) {
    const owingBy = {};
    (owing || []).forEach(o => { const id = o && (o.periodId || o.id); if (id) owingBy[id] = o; });
    return periods.map(p => {
      const rec = byPeriod[p];
      let suffix;
      if (rec === undefined) {
        suffix = ' · could not be read';
      } else {
        // The state word is shown VERBATIM, never abbreviated, so an option is
        // already near the width a select can display at 375px. The TOTAL is
        // therefore not put inside the option — it lives in full immediately
        // below, in the headline for the period on screen and in the
        // "not yet paid" card for every period still owing. Measured, not
        // guessed: a native select clips its own closed label with no way to
        // opt out, and a clipped peso figure is a wrong peso figure.
        suffix = ` · ${PY_STATE_WORDS[_pyStateOf(rec)]}`;
      }
      return `<option value="${_pyEsc(p)}"${p === selected ? ' selected' : ''}>${_pyEsc(_pyLabel(p))}${_pyEsc(suffix)}</option>`;
    }).join('');
  }

  // ── One sentence: what is waiting, with the money in it ──────────────────
  function _pyPaintHeadline(el, period, state, label, tot, reads, notPaid, live) {
    if (!el) return;
    const liveOpts = live || {};
    const isLive = !!liveOpts.isLive;
    const n = reads.length;
    const people = `${n} ${n === 1 ? 'person' : 'people'}`;
    const money  = _pyPeso(tot.takeHome);
    const held   = notPaid.length ? ` ${notPaid.length} ${notPaid.length === 1 ? 'person is' : 'people are'} not being paid this period — the reasons are on the roster.` : '';
    const backfilled = (period && period.backfill)
      ? `<div class="py-sub" style="margin-top:6px">${_pyIcon('🗂', 14)} <strong>Entered by hand for a past period.</strong> These figures were typed in from records kept outside the app, not produced by a live payday.</div>` : '';

    // The owner's Finance-approved early release (F1) — WHO approved it and
    // WHY, permanently visible on the run once it exists. Never a silent
    // loosening: this is the one place the exception is recorded, and it is
    // shown whether the period is still live or has since moved on.
    const override = period && period.earlyReleaseOverride;
    const overrideNote = override
      ? `<div class="py-sub" style="margin-top:6px">${_pyIcon('⚠️', 14)} <strong>Checked early</strong>, before ${_pyEsc(override.periodEndWas || '')
          } — approved by ${_pyEsc(override.approvedByName || override.approvedBy || 'Finance')}: “${_pyEsc(override.reason || '')}”.</div>`
      : '';

    if (isLive) {
      // D3/D9/D10 — the live banner, exact copy from the spec. Badge always
      // reads "In progress" while live, even if a mid-period edit (D6) left a
      // stored state underneath that would otherwise say "Ready to check".
      const asOf = (period && period.asOf) || liveOpts.todayIso || '';
      const kindWord = (liveOpts.kind === 'week') ? 'week' : 'month';
      const officeSub = (liveOpts.kind !== 'week')
        ? `<div class="py-sub" style="margin-top:6px">The monthly salary shows in full — it does not build up day by day. Attendance and KPI are measured up to today.</div>`
        : '';
      el.innerHTML = `<div class="card py-live-banner" style="margin-bottom:14px"><div class="card-body">
          <div class="py-headline">${_pyEsc(label)} is still going — figures so far, as of ${_pyEsc(asOf)}.</div>
          <div class="py-sub" style="margin-top:6px">These follow the punches, attendance and records as they come in. Nothing here is final, and nothing can be paid until the ${kindWord} ends on ${_pyEsc(liveOpts.periodEnd || '')}.</div>
          <div class="py-sub" style="margin-top:6px;margin-bottom:0"><span class="badge badge-blue" style="font-size:10px">In progress</span>${held ? _pyEsc(held) : ''}</div>
          ${officeSub}
          ${overrideNote}
        </div></div>`;
      return;
    }

    let text;
    if (!period || state === 'notstarted') {
      text = canPrepare
        ? `${_pyEsc(label)} has not been started yet.`
        : `${_pyEsc(label)} has not been started yet. HR starts it.`;
    } else if (state === 'prepared') {
      text = `${_pyEsc(label)} is ready to check — ${_pyEsc(people)}, ${_pyEsc(money)}.`;
    } else if (state === 'checked') {
      const by = (period.checkedByName || period.checkedBy || '');
      text = `${_pyEsc(label)} is checked and waiting for payment — ${_pyEsc(people)}, ${_pyEsc(money)}.`
           + (by ? ` <span style="font-weight:400;color:var(--text-muted)">Checked by ${_pyEsc(by)}.</span>` : '');
    } else {
      const at = period.paidAt ? (window.fmtManila ? window.fmtManila(period.paidAt) : '') : '';
      const by = (period.paidByName || period.paidBy || '');
      text = `${_pyEsc(label)} is paid — ${_pyEsc(people)}, ${_pyEsc(money)}.`
           + `<span style="font-weight:400;color:var(--text-muted)">${at ? ' ' + _pyEsc(at) + '.' : ''}${by ? ' Paid by ' + _pyEsc(by) + '.' : ''}</span>`;
    }
    el.innerHTML = `<div class="card" style="margin-bottom:14px"><div class="card-body">
        <div class="py-headline">${text}</div>
        <div class="py-sub" style="margin-top:6px;margin-bottom:0">
          <span class="badge ${state === 'paid' ? 'badge-green' : state === 'checked' ? 'badge-blue' : state === 'prepared' ? 'badge-amber' : 'badge-gray'}" style="font-size:10px">${_pyEsc(PY_STATE_WORDS[state])}</span>
          ${held ? _pyEsc(held) : ''}
        </div>
        ${backfilled}
        ${overrideNote}
      </div></div>`;
  }

  // A period in the list whose read FAILED. Named, never swallowed — the whole
  // point of the list is that a missed period cannot hide, and "it would not
  // load" is not the same as "there is nothing there".
  function _pyPaintUnreadable(el, unreadable, owingError) {
    if (!el) return;
    if (!unreadable.length && !owingError) { el.innerHTML = ''; return; }
    const bits = [];
    if (owingError) bits.push('The list of periods still owing could not be read, so the card below may be incomplete.');
    if (unreadable.length) bits.push(`${unreadable.length} period${unreadable.length === 1 ? '' : 's'} could not be read: ${unreadable.map(_pyLabel).join(', ')}. Their state and totals are unknown — they are not shown as paid.`);
    el.innerHTML = `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--danger)"><div class="card-body">
      <div style="font-weight:700;font-size:13px;color:var(--danger);margin-bottom:4px">${_pyIcon('⚠️', 16)} Some periods could not be read</div>
      <div style="font-size:12px;line-height:1.6">${_pyEsc(bits.join(' '))}</div>
    </div></div>`;
  }

  // ── Everything still owing FOR THIS TEAM, oldest first, WITH ITS MONEY ───
  // Fifty-two weeks and twelve months a year is how an unpaid period hides —
  // that reason survives — but the owner's segregation ruling (2026-08-12:
  // "cluttered messy unorganized not segregated for office and operations")
  // outranks it: Office months and Operations weeks must never interleave in
  // one list. So this card is now filtered to the ACTIVE TAB's team, via the
  // same PC.teamOf/_pyTeam this screen already uses to sort periods into
  // tabs. A period on the OTHER team can still not silently hide — instead of
  // mixing into the list, it gets one quiet line ("Operations Team also has N
  // periods not yet paid") that switches tabs, so a missed period is still
  // reachable without ever showing two teams' rows side by side.
  //
  // This card is also where the period picker's totals live: the select above
  // cannot carry a peso figure at 375px without the browser clipping it, so
  // every period still owing states its own total here instead, wrapping, in
  // full. The period on screen is in the list too — marked, not hidden — so
  // this is one honest list of what is outstanding for THIS team rather than
  // a list with a hole in it exactly where you happen to be standing.
  function _pyPaintWaiting(el, owing, byPeriod, activeTeam) {
    if (!el) return;
    const all = (owing || [])
      .map(o => ({ id: (o && (o.periodId || o.id)) || '', state: (o && o.state) || 'notstarted', total: (o && typeof o.total === 'number') ? o.total : null }))
      .filter(o => o.id);
    const rows = all
      .filter(o => _pyTeam(o.id) === activeTeam)
      .sort((a, b) => (_pySortKey(a.id) < _pySortKey(b.id) ? -1 : 1));

    // The other team's count, named but never listed here — one line, not a
    // list, and it is the ONLY place the other team is mentioned on this tab.
    const otherTeam = activeTeam === 'operations' ? 'office' : 'operations';
    const otherCount = all.filter(o => _pyTeam(o.id) === otherTeam).length;
    const otherLink = otherCount
      ? `<button type="button" class="btn-link btn-sm py-otherteam-link" style="margin-top:8px">${_pyEsc(PY_TEAM_LABEL[otherTeam])} also has ${otherCount} period${otherCount === 1 ? '' : 's'} not yet paid</button>`
      : '';

    if (!rows.length) {
      el.innerHTML = `<div class="info-banner">${_pyIcon('✓', 16)} Nothing else is waiting to be paid for ${_pyEsc(PY_TEAM_LABEL[activeTeam])}.</div>${otherLink}`;
      return;
    }
    const html = rows.map(o => {
      const rec = byPeriod[o.id];
      const t = (rec && Array.isArray(rec.lines)) ? _pyTotals(rec.lines.map(_pyRead)) : null;
      const money = t && t.people ? `${t.people} ${t.people === 1 ? 'person' : 'people'} · ${_pyPeso(t.takeHome)}`
                  : (o.total != null ? _pyPeso(o.total) : 'no roster yet');
      const here = (o.id === selected);
      // No team prefix here — the list is already filtered to ONE team, and
      // the tab above already says which. Repeating it on every row is
      // exactly the redundant clutter the owner flagged.
      return `<div class="py-waiting-row">
        <div class="py-wlabel">
          <strong>${_pyEsc(_pyLabel(o.id))}</strong>
          <span class="badge ${o.state === 'checked' ? 'badge-blue' : o.state === 'prepared' ? 'badge-amber' : 'badge-gray'}" style="font-size:10px;margin-left:6px">${_pyEsc(PY_STATE_WORDS[o.state] || o.state)}</span>
          <div class="py-sub" style="margin-bottom:0">${_pyEsc(money)}${here ? ' · on screen now' : ''}</div>
        </div>
        ${here ? '' : `<button class="btn-secondary btn-sm py-open" data-period="${_pyEsc(o.id)}">Open</button>`}
      </div>`;
    }).join('');
    el.innerHTML = `<div class="card"><div class="card-header"><h3>${rows.length} period${rows.length === 1 ? '' : 's'} not yet paid</h3></div><div class="card-body">${html}${otherLink}</div></div>`;
  }

  // ═════════════════════════════════════════════════════════
  //  "WHO ELSE SHOULD BE HERE?" (D11) — the owner's "add and remove employees
  //  who are not part of the payroll period". Remove is the existing
  //  period-scoped Hold on a roster row; add-back is "Put back" here for a
  //  hold, and a door to HR for anything about the PERSON (no rate, not on
  //  payroll, removed) — never an in-place edit, because the payroll screen
  //  does not touch a person's record (owner: "these records cannot be
  //  edited in the payroll tab already").
  //
  //  The button itself is no longer painted as its own floating block — the
  //  owner's clutter ruling (2026-08-12) folded it into the roster's own
  //  header, built in paint() as `whoElseHtml` and rendered inside
  //  _pyTotalsCard (or the roster's empty-state, when there are no paid
  //  lines). The visibility rule is unchanged: canPrepare, a period exists,
  //  not yet paid. The panel it opens (_pyOpenWhoElsePanel, below) is bound
  //  in _pyBind alongside every other roster-level control.
  // ═════════════════════════════════════════════════════════

  function _pyOpenWhoElsePanel(period, label) {
    const list = _pyNotPaidList(period);
    const hrBtn = _pyHrRecordBtn();
    const rowsHtml = list.length ? list.map(p => `<div class="py-waiting-row">
        <div class="py-wlabel">
          <strong>${_pyEsc(p.name)}</strong>
          <span class="badge ${p.words.danger ? 'badge-red' : 'badge-gray'}" style="font-size:10px;margin-left:6px">${_pyEsc(p.words.short)}</span>
          <div class="py-sub" style="margin-bottom:0${p.words.danger ? ';color:var(--danger)' : ''}">${_pyEsc(p.words.note)}</div>
        </div>
        ${(p.words.undoable && p.id)
          ? `<button class="btn-secondary btn-sm py-we-putback" data-person="${_pyEsc(p.id)}" data-name="${_pyEsc(p.name)}">Put back in this period</button>`
          : (hrBtn || '')}
      </div>`).join('')
      : `<div class="info-banner">${_pyIcon('✓', 16)} Everyone found for ${_pyEsc(label)} is being paid.</div>`;

    const panel = openPage(`Who else should be here? — ${_pyEsc(label)}`, `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        Everyone found for ${_pyEsc(label)} who is not being paid, and why. Holds are for this period only.
        Anything about the person themselves — their rate, whether they are on payroll at all — is fixed on
        their HR record, not here.
      </div>
      ${rowsHtml}
    `, `<button class="btn-secondary" onclick="closeModal()">Close</button>`);

    if (window.lucide) lucide.createIcons({ nodes: [panel] });
    panel.querySelectorAll('.py-we-putback').forEach(b => b.addEventListener('click', () => window.busy(b, async () => {
      const name = b.dataset.name || 'this person';
      try {
        await window.Payroll.setHeld(selected, b.dataset.person, null);
        await _pyRefreshFigures();
        Notifs.success(`${name} is back in ${label}.`);
        closeModal();
        load(selected);
      } catch (e) { Notifs.showToast(e && e.message ? e.message : 'The hold could not be lifted.', 'error'); }
    })));
    _pyBindHrRecordBtns(panel);
  }

  // A grouped problem's single "Fix this" (clutter fix, 2026-08-12): several
  // people share the exact same problem sentence, so the collapsed row shows
  // ONE button rather than one per person. It opens each person's own figures
  // individually — the fix itself is still per-person (an unpunched day, a
  // shortfall, a zero) and nothing here changes that; only the doorway to it
  // is shared. Selecting a name here stacks openAdjustPanel on top, exactly
  // the same panel a lone "Fix this" opens directly.
  function _pyOpenGroupFixPanel(period, readById, ids, label) {
    const rowsHtml = ids.map(id => {
      const r = readById[id];
      const name = (r && r.name) || id;
      return `<div class="py-waiting-row">
        <div class="py-wlabel"><strong>${_pyEsc(name)}</strong></div>
        <button class="btn-secondary btn-sm py-groupfix-open" data-person="${_pyEsc(id)}">Fix this</button>
      </div>`;
    }).join('');
    const panel = openPage(`Fix — ${_pyEsc(label)}`, `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        Everyone with this same problem for ${_pyEsc(label)}. Fix each one on their own — the others are untouched.
      </div>
      ${rowsHtml}
    `, `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    panel.querySelectorAll('.py-groupfix-open').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.person;
      openAdjustPanel(period, readById[id], id, label);
    }));
  }

  // ═════════════════════════════════════════════════════════
  //  THE ONE BUTTON
  //  Two exist in the whole flow and you only ever see one. Each is named for
  //  what it does and says what it costs BEFORE the press — the cost sentence
  //  sits beside the button, not inside a confirmation nobody reads.
  // ═════════════════════════════════════════════════════════
  function _pyPaintAction(el, o) {
    if (!el) return;
    const { period, state, label, tot, reads, notPaid, isLive, periodEnd, kind } = o;
    const n = reads.length;
    const people = `${n} ${n === 1 ? 'person' : 'people'}`;
    let body = '';

    // ── D5 — no action buttons in an in-progress period ─────────────────────
    // A period that has not ended cannot be checked or paid at all — the
    // engine refuses (Payroll.markHoursCorrect). Instead of a button, the cost
    // sentence names the end date, so the refusal is never a surprise.
    // Finance (canPay) alone gets a subtle, separate escape hatch for a
    // special request — never the default action, and it demands a typed
    // reason (owner ruling 2026-08-11: approved by FINANCE, recorded on the
    // run, never a silent loosening).
    if (isLive) {
      const kindWord = (kind === 'week') ? 'week' : 'month';
      const overrideBtn = canPay
        ? `<button class="btn-secondary btn-sm" id="py-early-btn">Release early (Finance approval)</button>`
        : '';
      body = `<div class="py-cost">${_pyEsc(label)} runs to ${_pyEsc(periodEnd || '')}. When it ends, the figures freeze here for HR to check, and Finance pays after that.</div>${overrideBtn}`;
      el.innerHTML = `<div class="card"><div class="card-body"><div class="py-actbar">${body}</div></div></div>`;
      return;
    }

    // Cost sentences cut to ONE short line each (clutter fix, 2026-08-12 —
    // owner: "cluttered messy unorganized"). The money and the counts stay;
    // the lecture about who else can unlock it, or exactly which steps happen
    // in what order, does not — the row actions and the panel it opens still
    // say all of that at the point it actually matters.
    if (state === 'notstarted') {
      body = canPrepare
        ? `<div class="py-cost">${_pyEsc(label)} has not been started — opening it builds the roster automatically.</div>`
        : `<div class="py-cost">${_pyEsc(label)} has not been started. HR starts it.</div>`;
    } else if (state === 'prepared') {
      if (canPrepare) {
        body = `<button class="btn-primary py-bigbtn" id="py-check-btn">Hours are correct - send to Finance</button>
          <div class="py-cost">${_pyEsc(people)}, ${_pyEsc(_pyPeso(tot.takeHome))}${notPaid.length ? `, ${notPaid.length} not being paid` : ''}. Locks the figures and sends them to Finance.</div>`;
      } else {
        body = `<div class="py-cost">HR is still checking ${_pyEsc(label)}.</div>`;
      }
    } else if (state === 'checked') {
      if (canPay) {
        body = `<button class="btn-primary py-bigbtn" id="py-pay-btn">Pay everyone</button>
          <div class="py-cost">${_pyEsc(people)}, ${_pyEsc(_pyPeso(tot.takeHome))}. <strong>Cannot be undone</strong> — attach receipts on the next screen.</div>
          <button class="btn-secondary btn-sm" id="py-reopen-btn">Send back to HR for changes</button>`;
      } else {
        body = `<div class="py-cost">${_pyEsc(label)} is checked, waiting for Finance. ${_pyEsc(people)}, ${_pyEsc(_pyPeso(tot.takeHome))}.</div>`;
      }
    } else {
      body = `<div class="py-cost">${_pyEsc(label)} is paid and closed. Use <strong>Correct this person</strong> on a row to fix one person.</div>`;
    }

    el.innerHTML = `<div class="card"><div class="card-body"><div class="py-actbar">${body}</div></div></div>`;
  }

  // ═════════════════════════════════════════════════════════
  //  PROBLEMS FIRST, IN SENTENCES
  //  "Ramon - no punch Tuesday", not a red dot on a cell. Every one of these is
  //  read off the frozen line; not one of them recalculates a peso. Each row
  //  carries the person's name and a Fix that opens THEIR figures.
  // ═════════════════════════════════════════════════════════
  function _pyProblems(period, reads, notPaid, periodId, live) {
    const out = [];
    const liveOpts = live || {};
    const kind = _pyKind(periodId);
    let days = [];
    if (kind === 'week' && typeof window.payWeekDays === 'function') {
      try { days = window.payWeekDays(periodId) || []; } catch (_) { days = []; }
    }
    const todayIso = liveOpts.todayIso || '';

    // The people the system refused to pay because it does not KNOW something.
    notPaid.forEach(p => {
      if (p.words.danger) out.push({ severity: 'danger', id: p.id, name: p.name, text: `${p.name} - ${p.words.short.toLowerCase()}. ${p.words.note}` });
    });

    reads.forEach(r => {
      // A day with no punch. This is the single most common event and the one
      // the owner named: absent-unless-punched is the ruling, so an unpunched
      // day is unpaid until somebody records a reason for it.
      //
      // D10 — a FUTURE day is "not yet", never "absent": computeWeeklyLine
      // marks a day with no punches absent, and mid-week that would name
      // Thursday-Sunday as "no clock-in", which is alarming and false. Pure
      // string comparison on the period's own dates vs today (Manila) — zero
      // money impact, an absent day already pays 0.
      const missing = [];
      r.rows.forEach((row, i) => {
        if (days[i] && todayIso && days[i] > todayIso) return; // not yet — excluded entirely
        if (row && row.absent === true && !(row.override || row.overridden)) {
          missing.push(days[i] ? PY_DAY_NAMES[i] || days[i] : (PY_DAY_NAMES[i] || `day ${i + 1}`));
        }
      });
      if (missing.length) {
        out.push({
          severity: 'warn', id: r.id, name: r.name,
          text: `${r.name} - no punch ${missing.join(', ')}. ${missing.length === 1 ? 'That day is' : 'Those days are'} unpaid unless you record why ${missing.length === 1 ? 'it' : 'they'} should be paid.`
        });
      } else if (r.daysAbsent != null && r.daysAbsent > 0 && !r.rows.length) {
        out.push({ severity: 'warn', id: r.id, name: r.name, text: `${r.name} - ${r.daysAbsent} day${r.daysAbsent === 1 ? '' : 's'} absent. ${r.daysAbsent === 1 ? 'It is' : 'They are'} unpaid unless you record why ${r.daysAbsent === 1 ? 'it' : 'they'} should be paid.` });
      }
      // Nothing to pay. Always worth a sentence — but WHICH sentence depends on
      // WHY, and the two causes are not the same fix (2026-08-12 diagnosis: the
      // old wording named "deductions" for everyone, but weeklyRunSkipReason
      // already refuses anyone with no rate on file (returns 'no-rate' and they
      // never appear as a zero line) — so a zero here is never a rate problem.
      // In practice it is almost always a week with no clock-ins at all: every
      // day reads absent, gross is 0, and "check the figures" sends someone
      // looking at deductions that were never the cause.
      //   - r.rows present and every day of it unworked  -> the hours are
      //     missing, not the deductions. Point at recording the days/an
      //     override, because that is the actual fix.
      //   - real earnings this period (gross > 0) but still net <= 0 -> the
      //     deductions genuinely consumed it; the original wording is correct.
      //   - neither is knowable from this line (e.g. a monthly/office line,
      //     which carries no per-day rows) -> say what IS known instead of
      //     guessing: the earnings and deduction totals, verbatim.
      if (r.takeHome != null && r.takeHome <= 0) {
        const hasRows = Array.isArray(r.rows) && r.rows.length > 0;
        const noPunches = hasRows && (r.daysWorked || 0) === 0 && (r.daysAbsent || 0) > 0;
        const grossKnown = _pySum(r.earnings, r.allowances);
        if (noPunches) {
          out.push({ severity: 'danger', id: r.id, name: r.name, text: `${r.name} - no clock-ins for this period, so there is nothing to pay (${_pyPeso(r.takeHome)}). Record the days worked, or override a day with a reason, before this period is paid.` });
        } else if (grossKnown != null && grossKnown > 0) {
          out.push({ severity: 'danger', id: r.id, name: r.name, text: `${r.name} - nothing to pay after deductions (${_pyPeso(r.takeHome)}). Check the figures before this period is paid.` });
        } else {
          const dedKnown = _pySum(r.otherDed, r.statutory, r.cashAdv);
          out.push({ severity: 'danger', id: r.id, name: r.name, text: `${r.name} - nothing to pay (${_pyPeso(r.takeHome)}). Earnings ${grossKnown != null ? _pyPeso(grossKnown) : 'unknown'}, deductions ${dedKnown != null ? _pyPeso(dedKnown) : 'unknown'} — check before this period is paid.` });
        }
      }
      // A cash advance on the books with nothing coming off it this period.
      if (r.caBalanceBefore != null && r.caBalanceBefore > 0 && !(r.cashAdv > 0)) {
        out.push({ severity: 'warn', id: r.id, name: r.name, text: `${r.name} - cash advance of ${_pyPeso(r.caBalanceBefore)} outstanding, nothing collected this period.` });
      }
      if (r.caShortfall != null && r.caShortfall > 0) {
        out.push({ severity: 'warn', id: r.id, name: r.name, text: `${r.name} - ${_pyPeso(r.caShortfall)} of their cash advance could not be collected this period; it stays on their balance.` });
      }
      if (!r.id) {
        out.push({ severity: 'danger', id: '', name: r.name, text: `${r.name} - their record carries no id, so their figures cannot be changed from here.` });
      }
      // STATUTORY-BY-STATUS-SPEC-2026-08-12 §7.3 — read straight off the
      // frozen line (never recomputed), so this shows on a stored/paid
      // period exactly as it does on a live one. Only present when the
      // switch is on (§5.2 suppresses flags while it is off), which is why
      // this never appears on the pre-adoption report itself.
      // A colon (not " - ") deliberately keeps this OUT of the name-grouping
      // above: unlike "Adjust figures", each person's Fix here must open
      // THEIR OWN HR record, never a shared multi-person panel.
      if (r.statusFlag) {
        out.push({
          severity: 'warn', id: r.id, name: r.name,
          text: `${r.name}: ${r.statusFlag.words}`,
          fixable: false,
          hrFix: { uid: kind === 'week' ? '' : r.id, workerId: kind === 'week' ? r.id : '', name: r.name }
        });
      }
      // TASK-BASED-PAY-SPEC-2026-08-12 §8.4 — the minimum-wage floor, warned
      // here (release itself is blocked in window.disbursePayRun). Month
      // periods only — Operations is hourly and has no floor gate (§8.4/§14
      // Q3). r.raw is the frozen computePayLine line (_pyRead keeps it).
      if (kind !== 'week' && liveOpts.wageFloorMonthly != null && r.raw && typeof window.wageFloorCheck === 'function') {
        const _chk = window.wageFloorCheck(r.raw, liveOpts.wageFloorMonthly);
        if (_chk.checked && !_chk.ok) {
          out.push({
            severity: 'danger', id: r.id, name: r.name,
            text: `${r.name}'s pay this month works out below the saved minimum wage (${_pyPeso(_chk.earned)} against ${_pyPeso(liveOpts.wageFloorMonthly)}). It cannot be released until this is looked at.`
          });
        }
      }
      // TASK-BASED-PAY-SPEC-2026-08-12 §9.4 — the double-penalty tripwire.
      // Absence must be penalised by the multiplier ONLY (§0 — no day-count
      // absence deduction anywhere); this names the hazard so a human
      // decides, it never blocks. Withheld deductions (bonds, canteen) are
      // unrelated and stay silent — only unearnedDeductions counts.
      if (kind !== 'week' && r.raw && r.raw.policy === 'taskbased' && (+r.raw.unearnedDeductions || 0) > 0) {
        out.push({
          severity: 'warn', id: r.id, name: r.name,
          text: `${r.name} has ${_pyPeso(r.raw.unearnedDeductions)} of pay marked as not earned (absence or tardiness) while task-based pay already follows their results — check the same days are not being deducted twice.`
        });
      }
    });

    // TASK-BASED-PAY-SPEC-2026-08-12 §8.4 — one note per paint, not per
    // person: either the floor could not be read at all, or it is on but no
    // floor is saved yet while task-based pay is actually running.
    if (kind !== 'week') {
      if (liveOpts.wageFloorReadFailed) {
        out.push({ severity: 'warn', id: '', text: 'Could not check pay against the saved minimum wage — try again in a moment.' });
      } else if (liveOpts.wageFloorMonthly == null && reads.some(r => r.raw && r.raw.policy === 'taskbased')) {
        out.push({ severity: 'warn', id: '', text: 'Task-based pay is on, but no minimum wage amount is saved — add it on the Gov Rates screen so pay can be checked against it.' });
      }
    }

    // Whatever the engine itself flagged, verbatim. No `name` field — these
    // come as free-form strings the engine already wrote, not the
    // `${name} - ...` shape the grouping below relies on, so each stays its
    // own row rather than being mis-grouped against unrelated text.
    const w = warningsByPeriod[periodId] || (period && period.warnings) || [];
    (Array.isArray(w) ? w : []).forEach(x => {
      const text = (typeof x === 'string') ? x : (x && (x.message || x.text)) || '';
      if (text) out.push({ severity: (x && x.severity === 'danger') ? 'danger' : 'warn', id: (x && x.personId) || '', text });
    });

    // Anything that did NOT complete when the money moved is a person who was
    // not paid. It can never be a line item under "things to look at".
    const fails = (period && Array.isArray(period.failures)) ? period.failures : [];
    fails.forEach(f => {
      const fname = _pyName(f) || 'Someone';
      out.push({ severity: 'danger', id: _pyId(f), name: fname, text: `${fname} - ${(f && (f.message || f.kind)) || 'this did not complete'}${(f && f.amount != null) ? ` (${_pyPeso(f.amount)})` : ''}. This did NOT go out.` });
    });

    // "Fix this" is only offered where there is something to fix FROM HERE —
    // i.e. the person has a line in this period. Somebody with no rate on file
    // is fixed on their profile, and a button that opens an empty form and
    // changes nothing is worse than no button: it reads as "handled".
    const onRoster = {}; reads.forEach(r => { if (r.id) onRoster[r.id] = true; });
    out.forEach(p => { p.fixable = !!(p.id && onRoster[p.id]); });

    return out.sort((a, b) => (a.severity === b.severity) ? 0 : (a.severity === 'danger' ? -1 : 1));
  }

  // "Ramon and three others" not "Ramon", then "Dina", then "Boy", then
  // "Elena" said four times. Every problem here was built as `${name} -
  // ${rest}`; when two or more people share the EXACT same `rest` (same
  // severity, same sentence after the name), the owner's clutter ruling
  // (2026-08-12) says once with all the names, not once per person. A row
  // that cannot be reduced to that shape — an engine warning string with no
  // `name` field, say — stays exactly as it was, standing alone.
  function _pyGroupProblems(problems) {
    const groups = [];
    const bySuffix = {};
    problems.forEach(p => {
      const prefix = p.name ? p.name + ' - ' : null;
      const rest = (prefix && p.text.indexOf(prefix) === 0) ? p.text.slice(prefix.length) : null;
      if (rest == null) { groups.push({ severity: p.severity, single: p }); return; }
      const key = p.severity + '|' + rest;
      let g = bySuffix[key];
      if (!g) { g = { severity: p.severity, rest, names: [], fixableIds: [] }; bySuffix[key] = g; groups.push(g); }
      g.names.push(p.name);
      if (p.fixable && p.id) g.fixableIds.push(p.id);
    });
    return groups;
  }

  // "A", "A and B", "A, B and C" — plain-text names only; the caller escapes
  // the assembled sentence once, the same way every other sentence in this
  // file is built (raw string, then one _pyEsc at the point it is printed).
  function _pyJoinNames(names) {
    if (names.length <= 1) return names[0] || '';
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function _pyPaintProblems(el, problems) {
    if (!el) return;
    if (!problems.length) { el.innerHTML = ''; return; }
    const groups = _pyGroupProblems(problems);
    const dangers = groups.filter(g => g.severity === 'danger').length;
    const rows = groups.map(g => {
      if (g.single) {
        // STATUTORY-BY-STATUS-SPEC-2026-08-12 §7.4 — a status flag's Fix
        // opens the person's HR record (openEmployeeProfile), NEVER the
        // Adjust-figures panel: employment status is edited in HR only.
        // Checked BEFORE g.single.fixable — the generic `out.forEach` below
        // sets fixable purely off roster membership, so an hrFix entry would
        // otherwise also read as fixable and get the wrong button.
        const fixBtnHtml = g.single.hrFix
          ? `<button class="btn-secondary btn-sm py-fix-hr" data-uid="${_pyEsc(g.single.hrFix.uid)}" data-workerid="${_pyEsc(g.single.hrFix.workerId)}" data-name="${_pyEsc(g.single.hrFix.name)}">Fix this</button>`
          : (g.single.fixable ? `<button class="btn-secondary btn-sm py-fix" data-person="${_pyEsc(g.single.id)}">Fix this</button>` : '');
        return `<div class="py-problem">
          <div class="py-ptext" style="${g.severity === 'danger' ? 'color:var(--danger)' : ''}">${_pyEsc(g.single.text)}</div>
          ${fixBtnHtml}
        </div>`;
      }
      const text = `${_pyJoinNames(g.names)} - ${g.rest}`;
      let fixBtn = '';
      if (g.fixableIds.length === 1) {
        fixBtn = `<button class="btn-secondary btn-sm py-fix" data-person="${_pyEsc(g.fixableIds[0])}">Fix this</button>`;
      } else if (g.fixableIds.length > 1) {
        fixBtn = `<button class="btn-secondary btn-sm py-fix-group" data-persons="${_pyEsc(g.fixableIds.join(','))}">Fix this</button>`;
      }
      return `<div class="py-problem">
        <div class="py-ptext" style="${g.severity === 'danger' ? 'color:var(--danger)' : ''}">${_pyEsc(text)}</div>
        ${fixBtn}
      </div>`;
    }).join('');
    el.innerHTML = `<div class="card" style="border-left:3px solid ${dangers ? 'var(--danger)' : 'var(--warning)'}">
      <div class="card-header"><h3>${groups.length} thing${groups.length === 1 ? '' : 's'} to look at first</h3></div>
      <div class="card-body">${rows}</div></div>`;
  }

  // Everyone the period is not paying, from wherever the engine recorded them.
  // Held people and refused people are the same list on screen on purpose: a
  // separate collapsed list is how somebody gets forgotten.
  function _pyNotPaidList(period) {
    if (!period) return [];
    const seen = {}; const out = [];
    const push = (id, name, reason) => {
      const key = id || ('name:' + name);
      if (seen[key]) return; seen[key] = true;
      // A person on hold is not in `lines`, so their name may not be anywhere
      // on the record. Show the id rather than nothing — but SAY that it is an
      // id, because a row that looks like a name and is not one is how the
      // wrong person gets put back into a period.
      out.push({ id: id || '', name: name || id || 'Unnamed person', nameUnknown: !name && !!id, reason: reason || '', words: _pyNotPaidWords(reason) });
    };
    // Names come from whatever the period already carries, so nobody is shown a
    // raw document id.
    const nameById = {};
    [].concat(period.lines || [], period.skipped || [], period.notPaid || []).forEach(r => {
      const id = _pyId(r); if (id && _pyName(r)) nameById[id] = _pyName(r);
    });
    const held = period.held;
    if (Array.isArray(held)) held.forEach(h => push(_pyId(h), _pyName(h) || nameById[_pyId(h)], 'held:' + ((h && (h.reason || h.why)) || '')));
    else if (held && typeof held === 'object') Object.keys(held).forEach(k => {
      const v = held[k];
      if (v === null || v === false || v === undefined) return;
      const why = (typeof v === 'string') ? v : ((v && (v.reason || v.why)) || '');
      push(k, nameById[k], 'held:' + why);
    });
    [].concat(period.skipped || [], period.notPaid || []).forEach(s => push(_pyId(s), _pyName(s), (s && (s.reason || s.why)) || ''));
    return out;
  }

  // ═════════════════════════════════════════════════════════
  //  THE ROSTER — one card per person, every figure visible
  //  Not a table. Not .table-cards. Nothing behind a tap. The cards carry an
  //  identical set of fields in an identical order, so on a wide screen the
  //  figures line up into columns on their own, and at 375px the same card
  //  simply stacks into two columns of label/value with nothing removed.
  //  Order: the people with something to look at, then everyone else, then the
  //  people who are not being paid — with the reason in words, and a way back.
  // ═════════════════════════════════════════════════════════
  function _pyPaintRoster(el, ctx) {
    if (!el) return;
    const { period, state, reads, cols, tot, notPaid, canEditRows, canCorrectRow, label, isLive, periodDates, todayIso, whoElseHtml } = ctx;

    if (!period || (!reads.length && !notPaid.length)) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-icon">${_pyIcon('👥', 40)}</div>
        <h4>Nobody is on the roster for ${_pyEsc(label)}</h4>
        <p>${canPrepare
          ? 'No one was found to pay for this period. Check that people have a rate and are marked as being paid, then open this period again.'
          : 'No one has been worked out for this period yet.'}</p>
        ${whoElseHtml ? `<div style="margin-top:10px">${whoElseHtml}</div>` : ''}
      </div>`;
      return;
    }

    // Flagged first — the owner's rule that rows the system is unsure about sit
    // at the top. Flagged means: nothing to pay, an unpunched day, or an
    // advance that did not collect. Same tests as the sentences above; the two
    // must never disagree. D10 — a day that has not happened yet (live mode
    // only) is never a reason to flag someone; it excludes exactly the same
    // dates _pyProblems does, by the same plain string comparison.
    const hasFutureDays = isLive && Array.isArray(periodDates) && periodDates.length && todayIso;
    const flagged = (r) => (r.takeHome != null && r.takeHome <= 0)
      || r.rows.some((row, i) => {
        if (hasFutureDays && periodDates[i] && periodDates[i] > todayIso) return false;
        return row && row.absent === true && !(row.override || row.overridden);
      })
      || (r.caBalanceBefore != null && r.caBalanceBefore > 0 && !(r.cashAdv > 0))
      || !r.id;
    const ordered = reads.slice().sort((a, b) => {
      const fa = flagged(a) ? 0 : 1, fb = flagged(b) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return String(a.name).localeCompare(String(b.name));
    });

    const cards = ordered.map(r => _pyPersonCard(r, cols, { canEditRows, canCorrectRow, flagged: flagged(r), isLive })).join('');
    // "Who else should be here?" lives in the roster's OWN header now
    // (clutter fix, 2026-08-12) — inside the totals card when there is one,
    // or its own thin header bar when every line is held/skipped and there is
    // no totals card to carry it (reads.length === 0 but notPaid.length > 0).
    const totalsCard = reads.length ? _pyTotalsCard(tot, cols, reads.length, notPaid.length, period, isLive, whoElseHtml) : '';
    const noTotalsHeader = (!reads.length && whoElseHtml) ? `<div class="py-waiting-row" style="border-bottom:0">${whoElseHtml}</div>` : '';
    const notPaidCards = notPaid.map(p => _pyNotPaidCard(p, canEditRows)).join('');

    el.innerHTML = noTotalsHeader + totalsCard + cards + (notPaid.length
      ? `<div style="font-size:12px;color:var(--text-muted);margin:16px 0 8px">${notPaid.length} not being paid for ${_pyEsc(label)}</div>` + notPaidCards
      : '');
  }

  function _pyFieldHtml(col, r, isLive) {
    const nil = '<span class="py-nil">—</span>';
    let val = nil, note = '', cls = '';
    // Live mode: "Take-home so far" — closed mode keeps "Take-home pay"
    // (§6.3). Never mutate `col` itself: it is a SHARED reference (from
    // PY_COLS via _pyColsFor's filter), and mutating it here would leak the
    // live label into every later, non-live paint.
    const fieldLabel = (col.key === 'takeHome' && isLive) ? 'Take-home so far' : col.label;
    if (col.key === 'days') {
      if (r.daysWorked != null || r.daysAbsent != null) {
        // D10(b) — live mode: "so far", against the days that have actually
        // happened yet, never against all 7 while the week is still running.
        val = (r._elapsedTotal != null)
          ? `${(+r.daysWorked || 0)} of ${r._elapsedTotal} so far`
          : `${(+r.daysWorked || 0)} worked`;
        if (r.daysAbsent) note = `${r.daysAbsent} absent`;
      }
    } else if (col.key === 'regHours' || col.key === 'otHours' || col.key === 'travelHours') {
      if (r[col.key] != null) val = _pyHrs(r[col.key]);
      if (col.key === 'travelHours' && (+r.travelHours || 0) > 0) note = 'paid at half rate';
      // Provenance (§6.4) — always-visible text, never behind a tap.
      if (col.key === 'regHours' && r[col.key] != null) note = note ? note : 'from the punch clock';
    } else if (col.key === 'attScore' || col.key === 'kpiScore') {
      if (r[col.key] != null) {
        val = Math.round((+r[col.key] || 0) * 100) + '%';
        note = (col.key === 'attScore')
          ? 'days present ÷ workdays so far, from the Attendance screen'
          : 'tasks finished this period + deliverables score';
      }
    } else if (col.key === 'takeHome') {
      if (r.takeHome != null) { val = _pyPeso(r.takeHome); cls = (r.takeHome > 0) ? 'py-plus' : 'py-minus'; }
    } else if (col.key === 'allowances') {
      if (r.allowances != null) { val = (r.allowances ? '+' : '') + _pyPeso(r.allowances); cls = r.allowances ? 'py-plus' : ''; }
    } else if (col.key === 'oneOffNet') {
      if (r.oneOffNet != null) { val = (r.oneOffNet > 0 ? '+' : '') + _pyPeso(r.oneOffNet); cls = r.oneOffNet >= 0 ? 'py-plus' : 'py-minus'; }
    } else if (col.key === 'otherDed' || col.key === 'statutory' || col.key === 'cashAdv') {
      // Findability fix (2026-08-12): a person with an outstanding cash
      // advance but nothing meaningfully collected THIS period must still
      // show that plainly, not "₱0.00" with no note. computeWeeklyLine/
      // computePayLine always freeze caDeduction/caPlanned as a NUMBER
      // (0 when nothing was set — never null), so the "is anything being
      // collected" test has to be the same one _pyProblems already uses
      // (!(r.cashAdv > 0)), not a null check — a null check here would never
      // fire against a real frozen line and silently miss every case.
      if (col.key === 'cashAdv' && r.caBalanceBefore != null && r.caBalanceBefore > 0 && !(r.cashAdv > 0)) {
        val = _pyPeso(0);
        note = `owes ${_pyPeso(r.caBalanceBefore)} — nothing collected yet. Set it under "Adjust figures".`;
      } else if (r[col.key] != null) {
        val = (r[col.key] ? '-' : '') + _pyPeso(r[col.key]); cls = r[col.key] ? 'py-minus' : '';
        if (col.key === 'cashAdv' && r.caBalanceBefore != null && (+r.cashAdv || 0) > 0) {
          note = `balance ${_pyPeso(r.caBalanceBefore)} → ${_pyPeso(r.caBalanceAfter != null ? r.caBalanceAfter : (r.caBalanceBefore - r.cashAdv))}`;
        }
      }
    } else if (r[col.key] != null) {
      val = _pyPeso(r[col.key]);
    }
    return `<div class="py-f${col.key === 'takeHome' ? ' py-f-net' : ''}">
      <span class="py-f-label">${_pyEsc(fieldLabel)}</span>
      <span class="py-f-val ${cls}">${val}</span>
      ${note ? `<span class="py-f-note">${_pyEsc(note)}</span>` : ''}
    </div>`;
  }

  // The edit door (D12/§6.5) — the payroll screen never edits a person's
  // standing pay ("records cannot be edited in the payroll tab already",
  // owner). Guarded on the function actually being loaded, per house rule.
  function _pyHrRecordBtn(extraStyle) {
    if (typeof window.renderEmployeeProfiles !== 'function') return '';
    return `<button type="button" class="btn-secondary btn-sm py-hr-link"${extraStyle ? ` style="${extraStyle}"` : ''}>Open HR record</button>`;
  }
  function _pyBindHrRecordBtns(scope) {
    scope.querySelectorAll('.py-hr-link').forEach(b => b.addEventListener('click', () => {
      try { window.renderEmployeeProfiles(); } catch (_) { Notifs.showToast('The HR records screen could not be opened.', 'error'); }
    }));
  }

  function _pyPersonCard(r, cols, o) {
    const sub = [];
    if (r.rate != null) sub.push(`${_pyPeso(r.rate)}/hr${r.rateSource ? ' · ' + _pyRateSourceWords(r.rateSource) : ''}`);
    else if (r.monthlySalary != null) sub.push(`${_pyPeso(r.monthlySalary)} a month`);
    if (r.daysOverridden) sub.push(`${r.daysOverridden} day${r.daysOverridden === 1 ? '' : 's'} paid on a recorded reason`);
    if (!r.id) sub.push('no id on this record — it cannot be changed from here');
    const oneOffLines = r.oneOffs.length
      ? `<div class="py-oneoff">${r.oneOffs.map(x => `${_pyEsc(x.label || 'One-off')}: ${x.kind === 'deduction' ? '-' : '+'}${_pyEsc(_pyPeso(x.amount))}`).join(' · ')}</div>`
      : '';
    // The owner's "where did this come from", for a performance-scaled
    // allowance only — a flat policy says nothing, since the allowance is not
    // scaled and a note here would be noise (§6.4).
    const perfLine = (r.policy === 'performance' && r.perfFactor != null)
      ? `<div class="py-oneoff">Allowance scaled to ${Math.round(r.perfFactor * 100)}%: KPI ${r.kpiScore != null ? Math.round(r.kpiScore * 100) : '—'}% × 0.7 + attendance ${r.attScore != null ? Math.round(r.attScore * 100) : '—'}% × 0.3.</div>`
      : '';
    // TASK-BASED-PAY-SPEC-2026-08-12 §9.2 — the ONE traceability sentence,
    // read straight off the frozen line (r.raw), never recomputed here. No
    // new button — this is additive text only, same house rule perfLine
    // above already follows.
    const taskBasedLine = (r.raw && typeof window.payBasisSentence === 'function' && (() => {
      const s = window.payBasisSentence(r.raw);
      return s ? `<div class="py-oneoff">${_pyEsc(s)}</div>` : '';
    })()) || '';
    // "Pay records are kept in HR" (§6.5) — permanently visible text, never
    // behind a tap, plus the one door out. Read-only here on purpose: the
    // payroll screen writes only period-scoped inputs, never standing pay.
    const hrBtn = _pyHrRecordBtn();
    const hrLine = '<div class="py-oneoff">Pay records are kept in HR.</div>';
    // STATUTORY-BY-STATUS-SPEC-2026-08-12 §7.3 — the reason government
    // deductions were or weren't taken, read straight off the frozen line.
    // No new button: the HR link (hrBtn) already sits right below this.
    const statusLine = r.statutoryBasis ? `<div class="py-oneoff">${_pyEsc(r.statutoryBasis)}</div>` : '';
    const acts = [];
    if (o.canEditRows && r.id) {
      acts.push(`<button class="btn-secondary btn-sm py-adjust" data-person="${_pyEsc(r.id)}">Adjust figures</button>`);
      acts.push(`<button class="btn-secondary btn-sm py-oneoff-btn" data-person="${_pyEsc(r.id)}">Add a one-off amount</button>`);
      acts.push(`<button class="btn-secondary btn-sm py-hold" data-person="${_pyEsc(r.id)}" data-name="${_pyEsc(r.name)}">Hold this period</button>`);
    }
    if (o.canCorrectRow && r.id) {
      acts.push(`<button class="btn-secondary btn-sm py-correct" data-person="${_pyEsc(r.id)}" data-name="${_pyEsc(r.name)}">Correct this person</button>`);
    }
    if (hrBtn) acts.push(hrBtn);
    return `<article class="py-card${o.flagged ? ' py-flagged' : ''}${(r.takeHome != null && r.takeHome <= 0) ? ' py-danger' : ''}">
      <div class="py-who"><strong>${_pyEsc(r.name)}</strong>${r.backfill ? '<span class="badge badge-gray" style="font-size:10px">entered by hand</span>' : ''}</div>
      ${sub.length ? `<div class="py-sub">${_pyEsc(sub.join(' · '))}</div>` : '<div class="py-sub"></div>'}
      <div class="py-fields">${cols.map(c => _pyFieldHtml(c, r, o.isLive)).join('')}</div>
      ${oneOffLines}
      ${perfLine}
      ${taskBasedLine}
      ${statusLine}
      ${hrLine}
      ${acts.length ? `<div class="py-rowacts">${acts.join('')}</div>` : ''}
    </article>`;
  }

  // The total, as the FIRST card. On the old monthly screen this figure lived
  // only on a preview and vanished the moment the figures were frozen — exactly
  // when somebody wanted to check it. Here it is drawn on every paint from the
  // cards' own numbers, so it survives by construction and can never contradict
  // the column above it.
  function _pyTotalsCard(tot, cols, people, notPaidCount, period, isLive, whoElseHtml) {
    const stored = _pyPick(
      period && period.totals && period.totals.takeHome,
      period && period.totals && period.totals.net,
      period && period.totals && period.totals.total
    );
    // If the stored total and the sum of the printed cards disagree, SAY SO
    // rather than pick one. They are the same money by two routes; a divergence
    // is a defect, not a rounding taste.
    const drift = (stored != null && Math.abs(stored - tot.takeHome) > 0.005)
      ? `<div class="py-sub" style="color:var(--danger);margin:8px 0 0">The saved total (${_pyEsc(_pyPeso(stored))}) does not match the people above (${_pyEsc(_pyPeso(tot.takeHome))}). Do not pay this period until it does.</div>` : '';
    const fake = {
      id: '', name: '', rows: [], oneOffs: [],
      daysWorked: tot.daysWorked, daysAbsent: tot.daysAbsent,
      regHours: tot.regHours, otHours: tot.otHours, travelHours: tot.travelHours,
      earnings: tot.earnings, allowances: tot.allowances, oneOffNet: tot.oneOffNet,
      otherDed: tot.otherDed, statutory: tot.statutory, cashAdv: tot.cashAdv,
      caBalanceBefore: null, caBalanceAfter: null, takeHome: tot.takeHome,
      // Percentages do not aggregate into a roster total — showing a sum or a
      // silent average here would assert a figure nobody asked for, so the
      // totals row states plainly that there is none.
      attScore: null, kpiScore: null
    };
    // Live mode: "so far — not what will be paid" (closed mode keeps
    // "this is what goes out") — §6.3, the same distinction the live banner
    // makes, restated at the point the eye actually lands on a peso figure.
    const totalsSub = isLive ? 'so far — not what will be paid' : 'this is what goes out';
    // "Who else should be here?" (D11) sits in THIS card's header, not as its
    // own floating block (clutter fix, 2026-08-12) — this is the roster's
    // first card, so its header reads as the roster's own header.
    return `<article class="py-card py-totals">
      <div class="py-who" style="justify-content:space-between">
        <strong>Everyone — ${people} ${people === 1 ? 'person' : 'people'}</strong>
        ${whoElseHtml || ''}
      </div>
      <div class="py-sub">${totalsSub}${notPaidCount ? ` · ${notPaidCount} not being paid` : ''}</div>
      <div class="py-fields">${cols.map(c => _pyFieldHtml(c, fake, isLive)).join('')}</div>
      ${drift}
    </article>`;
  }

  function _pyNotPaidCard(p, canEditRows) {
    return `<article class="py-card py-onhold${p.words.danger ? ' py-danger' : ''}">
      <div class="py-who"><strong>${_pyEsc(p.name)}</strong>
        <span class="badge ${p.words.danger ? 'badge-red' : 'badge-gray'}" style="font-size:10px">${_pyEsc(p.words.short)}</span></div>
      <div class="py-sub" style="margin-bottom:0${p.words.danger ? ';color:var(--danger)' : ''}">${_pyEsc(p.words.note)}${p.nameUnknown ? ' Their name is not on this period’s record — what is shown above is their reference.' : ''}</div>
      ${(canEditRows && p.words.undoable && p.id) ? `<div class="py-rowacts"><button class="btn-secondary btn-sm py-unhold" data-person="${_pyEsc(p.id)}" data-name="${_pyEsc(p.name)}">Put back in this period</button></div>` : ''}
    </article>`;
  }

  // ═════════════════════════════════════════════════════════
  //  BINDINGS — every lookup scoped to `root`, never document.
  //  openPage keeps a dying panel in the DOM for ~300ms, so a document-wide
  //  getElementById can land on a screen nobody can see and write this
  //  person's figures onto that one.
  // ═════════════════════════════════════════════════════════
  function _pyBind(ctx) {
    const { period, state, label, reads, tot, isLive, periodEnd, kind, activeTeam } = ctx;
    const readById = {}; reads.forEach(r => { if (r.id) readById[r.id] = r; });

    root.querySelector('#py-period')?.addEventListener('change', (e) => load(e.target.value));
    // "This week" on Operations, "This month" on Office (D8) — the button's
    // own label already says which, painted per-tab in paint().
    root.querySelector('#py-thisweek')?.addEventListener('click', () => load(activeTeam === 'operations' ? thisWeekId : thisMonth));
    root.querySelectorAll('.py-open').forEach(b => b.addEventListener('click', () => load(b.dataset.period)));

    // ── Team tabs (D8) — house chip-tab helper, never a hand-rolled bar. A
    // click with no more specific period jumps to that team's own last-open
    // (or default) period; re-entry restores both the tab and its period.
    const tabsRow = root.querySelector('.py-team-tabs');
    if (tabsRow) window.bindChipTabs(tabsRow, (key) => load(_pyDefaultForTeam(key)));

    // ── The other team's quiet cross-tab link (segregation fix, 2026-08-12) —
    // "Operations Team also has N periods not yet paid" switches straight to
    // that team's own last-open (or default) period, same as a tab click.
    root.querySelector('.py-otherteam-link')?.addEventListener('click', () => {
      const otherTeam = activeTeam === 'operations' ? 'office' : 'operations';
      load(_pyDefaultForTeam(otherTeam));
    });

    // ── "Who else should be here?" (D11) — now folded into the roster's own
    // header instead of a floating block of its own (clutter fix, 2026-08-12).
    root.querySelector('#py-whoelse-btn')?.addEventListener('click', () => _pyOpenWhoElsePanel(period, label));

    // ── Refresh figures (live mode only) — every row action already ends in
    // load(selected), which in live mode re-projects; this is the same thing
    // as a plain, named button for someone who just wants the latest numbers
    // without changing anything.
    root.querySelector('#py-refresh-figures')?.addEventListener('click', (ev) => window.busy(ev.currentTarget, async () => {
      load(selected);
    }));

    // Rebuild an ENDED period from the records as they stand now — the way out
    // of the stuck-at-zero trap described at the button. Safe to press at any
    // time before the hours are sent to Finance: Payroll.prepare moves nothing
    // and pays nobody, and its own state gate refuses once the period has been
    // checked or paid. Held-back people and one-off amounts survive, because
    // both live on the PERIOD rather than on the rebuilt lines.
    root.querySelector('#py-rework')?.addEventListener('click', (ev) => window.busy(ev.currentTarget, async () => {
      try {
        const res = await window.Payroll.prepare(selected);
        warningsByPeriod[selected] = (res && res.warnings) || [];
        Notifs.success('Worked out again from the records as they stand now.');
      } catch (e) {
        Notifs.showToast(e.message || String(e), 'error');
      }
      load(selected);
    }));

    // ── The Finance-approved early release (F1, owner ruling 2026-08-11) ────
    // Never the default action — it sits beside the refusal sentence, is only
    // ever painted for Finance-tier viewers (canPay), and demands a typed
    // reason. The gate itself lives in the engine (Payroll.markHoursCorrect);
    // this is only the door to it.
    root.querySelector('#py-early-btn')?.addEventListener('click', (ev) => window.busy(ev.currentTarget, async () => {
      const reason = await window.promptDialog({
        title: 'Release early — Finance approval',
        message: `${label} has not ended yet — it does not close until ${periodEnd}. This is a special-request exception, approved by Finance, and the reason stays visible on this period for anyone reading it later.`,
        placeholder: 'e.g. worker leaving before the period ends, urgent request approved by the owner',
        confirmLabel: 'Approve and check early',
        required: true
      });
      if (reason === null) return;
      if (!String(reason).trim()) { Notifs.showToast('A reason is needed.', 'error'); return; }
      try {
        await window.Payroll.markHoursCorrect(selected, { earlyOverride: { reason: String(reason).trim() } });
        Notifs.success('Approved for early release — Finance has been told.');
      } catch (e) {
        Notifs.showToast(e && e.message ? e.message : 'This could not be released early.', 'error');
      }
      load(selected);
    }));

    // ── HR's half of the handoff ───────────────────────────────────────────
    root.querySelector('#py-check-btn')?.addEventListener('click', (ev) => window.busy(ev.currentTarget, async () => {
      const ok = await confirmDialog({
        title: 'Send to Finance?',
        message: `${label}: ${reads.length} ${reads.length === 1 ? 'person' : 'people'}, ${_pyPeso(tot.takeHome)}. Finance is told straight away, and the figures lock so nobody can change an amount underneath them. You or the President can unlock it again.`,
        confirmLabel: 'Send to Finance'
      });
      if (!ok) return;
      try {
        await window.Payroll.markHoursCorrect(selected);
        Notifs.success('Sent to Finance — they have been told.');
      } catch (e) {
        Notifs.showToast(e && e.message ? e.message : 'This could not be sent to Finance.', 'error');
      }
      load(selected);
    }));

    // ── Finance's half ─────────────────────────────────────────────────────
    // busy() wraps the OPEN too: it reads the company account list first, and a
    // button that looks inert invites a second press.
    root.querySelector('#py-pay-btn')?.addEventListener('click', (ev) => window.busy(ev.currentTarget, async () => {
      try { await openPayPanel(period, reads, tot, label); }
      catch (e) { Notifs.showToast(e && e.message ? e.message : 'The payment screen could not be opened.', 'error'); }
    }));

    root.querySelector('#py-reopen-btn')?.addEventListener('click', (ev) => window.busy(ev.currentTarget, async () => {
      const ok = await confirmDialog({
        title: 'Send back to HR?',
        message: `${label} goes back to HR so the figures can be changed. Nothing has been paid, and nothing is lost — HR sends it back to you when it is right.`,
        confirmLabel: 'Send back to HR'
      });
      if (!ok) return;
      try { await window.Payroll.reopen(selected); Notifs.success('Sent back to HR.'); }
      catch (e) { Notifs.showToast(e && e.message ? e.message : 'This could not be sent back.', 'error'); }
      load(selected);
    }));

    // ── The four things the owner asked for, each ON A ROW ─────────────────
    root.querySelectorAll('.py-adjust').forEach(b => b.addEventListener('click', () =>
      openAdjustPanel(period, readById[b.dataset.person], b.dataset.person, label)));

    root.querySelectorAll('.py-fix').forEach(b => b.addEventListener('click', () =>
      openAdjustPanel(period, readById[b.dataset.person], b.dataset.person, label)));

    // STATUTORY-BY-STATUS-SPEC-2026-08-12 §7.4 — a status flag's Fix opens
    // the person's HR record, never a payroll editor (employment status is
    // HR-owned; the payroll screen only ever links out to it).
    root.querySelectorAll('.py-fix-hr').forEach(b => b.addEventListener('click', () => {
      if (typeof window.openEmployeeProfile !== 'function') { Notifs.showToast('The HR records screen could not be opened.', 'error'); return; }
      window.openEmployeeProfile({ uid: b.dataset.uid || undefined, workerId: b.dataset.workerid || undefined, name: b.dataset.name });
    }));

    // A collapsed problem shared by several people (clutter fix, 2026-08-12) —
    // one button, opens a list so each of them can still be fixed on their
    // own. See _pyOpenGroupFixPanel above.
    root.querySelectorAll('.py-fix-group').forEach(b => b.addEventListener('click', () => {
      const ids = (b.dataset.persons || '').split(',').filter(Boolean);
      _pyOpenGroupFixPanel(period, readById, ids, label);
    }));

    root.querySelectorAll('.py-oneoff-btn').forEach(b => b.addEventListener('click', () =>
      openOneOffPanel(readById[b.dataset.person], b.dataset.person, label)));

    root.querySelectorAll('.py-correct').forEach(b => b.addEventListener('click', () =>
      openCorrectPanel(period, readById[b.dataset.person], b.dataset.person, label)));

    root.querySelectorAll('.py-hold').forEach(b => b.addEventListener('click', () => window.busy(b, async () => {
      const name = b.dataset.name || 'this person';
      // A reason is the whole point of the record.
      const reason = await window.promptDialog({
        title: 'Hold this period',
        message: `Why is ${name} not being paid for ${label}? This is recorded, and it applies to ${label} ONLY — next period they are back on the roster and you decide again.`,
        placeholder: 'e.g. did not work / already paid separately / on unpaid leave',
        confirmLabel: 'Hold for this period',
        required: true
      });
      if (reason === null) return;
      if (!String(reason).trim()) { Notifs.showToast('A reason is needed.', 'error'); return; }
      try {
        await window.Payroll.setHeld(selected, b.dataset.person, String(reason).trim());
        await _pyRefreshFigures();
        Notifs.success(`${name} is on hold for ${label}.`);
      } catch (e) { Notifs.showToast(e && e.message ? e.message : 'The hold could not be saved.', 'error'); }
      load(selected);
    })));

    root.querySelectorAll('.py-unhold').forEach(b => b.addEventListener('click', () => window.busy(b, async () => {
      const name = b.dataset.name || 'this person';
      if (!(await confirmDialog({ message: `Put ${name} back into ${label}?` }))) return;
      try {
        await window.Payroll.setHeld(selected, b.dataset.person, null);
        await _pyRefreshFigures();
        Notifs.success(`${name} is back in ${label}.`);
      } catch (e) { Notifs.showToast(e && e.message ? e.message : 'The hold could not be lifted.', 'error'); }
      load(selected);
    })));
  }

  // After anything that changes an input, the figures are rebuilt for you.
  // This is deliberately NOT a button: the owner's rule is that the step count
  // goes down, and "now press the other button to make your change count" is
  // exactly the ceremony the old screens had. Only ever runs while the period
  // is still open — a checked or paid period is frozen on purpose.
  //
  // D4/D1 — MUST NOT call prepare() for a period that has not ended: an
  // in-progress period is never worth freezing, and the live view reads
  // Payroll.preview() (which writes nothing) on the very next load() anyway,
  // so calling prepare() here would be a write with no display benefit —
  // exactly the "looking must not write" rule this build exists to enforce.
  async function _pyRefreshFigures() {
    try {
      const nowIso = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10);
      const isLiveNow = !!(window.Payroll.core && typeof window.Payroll.core.periodEnded === 'function'
        && !window.Payroll.core.periodEnded(selected, nowIso));
      if (isLiveNow) return;
      const p = await window.Payroll.load(selected);
      const st = _pyStateOf(p);
      if (st === 'notstarted' || st === 'prepared') {
        const res = await window.Payroll.prepare(selected);
        warningsByPeriod[selected] = (res && res.warnings) || [];
      }
    } catch (_) {
      // Saved either way. The next paint reads the stored figures and the
      // problems list says whatever is still wrong — swallowing this is safe
      // precisely because nothing here is the source of a number.
    }
  }

  // ═════════════════════════════════════════════════════════
  //  ADJUST ONE PERSON'S FIGURES
  //  The owner's "change one person without touching everyone else". Amounts
  //  that live nowhere but here — the allowance, the standing deduction, the
  //  cash advance instalment — plus, on a weekly period, the per-day reason
  //  that turns an unpunched day into a paid one.
  //
  //  Findability fix (2026-08-12 — "cant find where to apply ca deduction").
  //  The field existed all along but was labelled "Advance instalment", never
  //  the words the owner actually used ("CA deduction"/"cash advance"), and
  //  it carried no hint that a balance was even outstanding. Renamed to say
  //  "cash advance" plainly, and — the bigger half of the fix — the roster
  //  ROW now shows the outstanding balance and this period's collection
  //  without opening this panel at all (see _pyFieldHtml's cashAdv branch and
  //  _pyColsFor). This panel is where you SET the instalment; it should no
  //  longer be the only place you learn one is owed.
  // ═════════════════════════════════════════════════════════
  function openAdjustPanel(period, r, personId, label) {
    if (!personId) { Notifs.showToast('This record carries no id, so its figures cannot be changed from here.', 'error'); return; }
    const name = (r && r.name) || personId;
    const kind = _pyKind(selected);
    const adj  = ((period && period.adjustments) || {})[personId] || {};
    const savedOvr = adj.overrides || {};
    let days = [];
    if (kind === 'week' && typeof window.payWeekDays === 'function') {
      try { days = window.payWeekDays(selected) || []; } catch (_) { days = []; }
    }
    const lineRows = (r && r.rows) || [];

    // D10(c) — a day that has not happened yet reads "not yet" (muted), never
    // the alarming/false "no punch — not paid"; its inputs stay enabled,
    // because pre-recording a known future absence override is legitimate
    // (e.g. an approved leave day later in the week).
    const dayRowsHtml = days.map((iso, i) => {
      const row = lineRows[i] || {};
      const o   = savedOvr[iso] || {};
      const punched = _pyHrs(row.hours) + ' hrs' + ((+row.otHours || 0) ? ` + ${_pyHrs(row.otHours)} overtime` : '');
      const absent  = row.absent === true;
      const notYet  = !!(todayIso && iso > todayIso);
      const statusLine = notYet
        ? `<div style="font-size:11px;margin-bottom:8px;color:var(--text-muted)">not yet</div>`
        : `<div style="font-size:11px;margin-bottom:8px;color:${absent ? 'var(--danger)' : 'var(--text-muted)'}">${absent ? 'no punch — not paid' : _pyEsc(punched)}</div>`;
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px">
        <div style="font-size:13px;font-weight:600;margin-bottom:2px">${_pyEsc(PY_DAY_NAMES[i] || '')} <span style="font-weight:400;color:var(--text-muted);font-size:11px">${_pyEsc(iso)}</span></div>
        ${statusLine}
        <div class="form-row">
          <div class="form-group"><label>Hours to pay</label><input id="pya-h-${i}" type="number" step="0.25" min="0" inputmode="decimal" value="${o.hours != null ? _pyEsc(o.hours) : ''}" placeholder="—"/></div>
          <div class="form-group"><label>Overtime hours</label><input id="pya-ot-${i}" type="number" step="0.25" min="0" inputmode="decimal" value="${o.otHours != null ? _pyEsc(o.otHours) : ''}" placeholder="—"/></div>
        </div>
        <div class="form-group"><label>Why is this day being paid? (needed)</label><input id="pya-r-${i}" type="text" value="${_pyEsc(o.reason || '')}" placeholder="e.g. worked, phone died / on site, no gate"/></div>
      </div>`;
    }).join('');

    // The keys sent to setAdjustment are the ones the underlying engines
    // already store, per period kind. They are listed in ONE place so a rename
    // is one edit, and they are named in the handoff notes for this build.
    // The label names the thing the owner actually calls it — "cash advance"
    // — while still saying plainly that this box is THIS PERIOD's instalment,
    // never the whole balance (that balance is shown separately, below).
    const caLabel = 'Cash advance — this period\'s instalment (₱)';
    const moneyFields = (kind === 'week')
      ? [['rentAllowance',   'Allowance (₱)',          adj.rentAllowance],
         ['otherDeductions', 'Other deductions (₱)',   adj.otherDeductions],
         ['caDeduction',     caLabel,                  adj.caDeduction],
         ['travelHours',     'Travel hours',           adj.travelHours]]
      : [['allowance',       'Allowance (₱)',          adj.allowance],
         ['otherDeductions', 'Other deductions (₱)',   adj.otherDeductions],
         ['caPlanned',       caLabel,                  adj.caPlanned]];

    const hrBtn = _pyHrRecordBtn('margin-top:6px');
    const panel = openPage(`${_pyEsc(name)} — ${_pyEsc(label)}`, `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        These apply to <strong>${_pyEsc(label)}</strong> only, and to ${_pyEsc(name)} only. Everyone else is untouched.
        The figures are worked out again as soon as you save.
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;padding:10px;border:1px solid var(--border);border-radius:10px">
        ${_pyEsc(name)}'s standing pay — the salary/rate, regular allowance and standing deductions — lives on their
        HR record and is not edited here. The boxes below apply to ${_pyEsc(label)} only.
        ${hrBtn}
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Amounts for this period</div>
        ${(r && r.caBalanceBefore != null && r.caBalanceBefore > 0)
          ? `<div style="font-size:12px;margin-bottom:10px">${_pyEsc(name)} owes <strong>${_pyEsc(_pyPeso(r.caBalanceBefore))}</strong> in cash advances. Set what to collect this period below.</div>`
          : ''}
        <div class="form-row">
          ${moneyFields.map(([k, lab, v]) => `<div class="form-group"><label>${_pyEsc(lab)}</label>
            <input id="pya-${_pyEsc(k)}" type="number" step="0.01" min="0" inputmode="decimal" value="${v != null ? _pyEsc(v) : ''}" placeholder="0.00"/></div>`).join('')}
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:6px">
          A cash advance instalment is capped so take-home pay can never go below zero; anything not collected stays on the balance.
          ${kind === 'week' ? 'Travel hours are paid at half the hourly rate.' : ''}
        </div>
      </div>
      ${days.length ? `<div style="background:var(--surface2);border-radius:10px;padding:12px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Days</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          No clock-in means the day is not paid. You can pay it anyway — but only with a reason written down, because money moving with nobody accountable for it is how this goes wrong.
        </div>
        ${dayRowsHtml}
      </div>` : ''}
    `, `<button class="btn-primary" id="pya-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    // ⚠ SCOPED TO THIS PANEL, NOT document. Two panels can carry the same ids
    // at once inside openPage's ~300ms teardown; a document-wide lookup reads
    // the PREVIOUS person's fields and writes them onto THIS person.
    const $ = (id) => panel.querySelector('#' + id);
    _pyBindHrRecordBtns(panel);
    // ⚠ AN UNTOUCHED BOX IS NEVER SENT — this is a MONEY rule, not tidiness.
    // Some of these amounts can also come from the person's own profile rather
    // than from this period. If a blank box were sent as an explicit 0, opening
    // somebody's figures and pressing Save without typing anything would write
    // a zero over their standing allowance and quietly cut their pay. So a key
    // is sent only when the box was TOUCHED, or when this period already held a
    // value for it — in which case clearing the box IS meant as zero, and has
    // to be sent as one, or an amount could be typed in and never taken back
    // out. Both halves of that are money bugs; this is the one rule that avoids
    // both.
    const initial = {};
    moneyFields.forEach(([k, , v]) => { initial[k] = (v != null) ? String(v) : ''; });
    const readMoney = (k, hadStored) => {
      const cur = $('pya-' + k)?.value;
      if (cur == null) return undefined;                       // not in this form
      if (String(cur) === initial[k] && !hadStored) return undefined;  // untouched and never set
      const n = parseFloat(cur);
      return Number.isFinite(n) ? n : (String(cur).trim() === '' ? 0 : undefined);
    };
    // ⚠ THE DAY GRID READS DIFFERENTLY FROM THE MONEY BOXES, and the difference
    // is not cosmetic. For an amount, an emptied box means "make it zero". For
    // a DAY, an empty box means "I am not touching this day" — there is no such
    // thing as paying a day zero hours, that is just the day being absent.
    // Reading a blank day as an explicit 0 made every one
    // of the seven days look like an override of zero hours, so saving anything
    // at all was refused with "Monday needs a reason" — caught by measurement,
    // not by reading. Blank here means null, and null means untouched.
    const dayNum = (id) => {
      const v = $(id)?.value;
      if (v == null || String(v).trim() === '') return null;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };

    $('pya-save')?.addEventListener('click', () => window.busy($('pya-save'), async () => {
      const overrides = {};
      for (let i = 0; i < days.length; i++) {
        const h  = dayNum(`pya-h-${i}`);
        const ot = dayNum(`pya-ot-${i}`);
        const rs = ($(`pya-r-${i}`)?.value || '').trim();
        if (h === null && ot === null) continue;       // this day was not touched
        if (!rs) {
          // The engine refuses a reason-less override and treats the day as
          // unpaid instead of quietly paying it. Collecting the reason here is
          // what makes paying the day work at all.
          Notifs.showToast(`${PY_DAY_NAMES[i] || days[i]} needs a reason before it can be paid.`, 'error');
          return;
        }
        overrides[days[i]] = { hours: h || 0, otHours: ot || 0, reason: rs };
      }
      const patch = {};
      moneyFields.forEach(([k, , stored]) => { const v = readMoney(k, stored != null); if (v !== undefined) patch[k] = v; });
      if (days.length) patch.overrides = overrides;
      try {
        await window.Payroll.setAdjustment(selected, personId, patch);
        await _pyRefreshFigures();
        closeModal();
        Notifs.success('Saved — the figures have been worked out again.');
        load(selected);
      } catch (e) {
        Notifs.showToast(e && e.message ? e.message : 'This could not be saved.', 'error');
      }
    }));
  }

  // ═════════════════════════════════════════════════════════
  //  A ONE-OFF AMOUNT
  //  A bonus, 13th month, a penalty, a special allowance. Named, on the
  //  payslip, and it never becomes part of anybody's standing figures. Today's
  //  only route is inflating another field with a note, which produces a
  //  payslip whose lines do not add up.
  // ═════════════════════════════════════════════════════════
  function openOneOffPanel(r, personId, label) {
    if (!personId) { Notifs.showToast('This record carries no id, so nothing can be added to it from here.', 'error'); return; }
    const name = (r && r.name) || personId;
    const existing = (r && r.oneOffs) || [];
    const panel = openPage(`One-off amount — ${_pyEsc(name)}`, `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        A single named amount for <strong>${_pyEsc(label)}</strong> only. It shows on ${_pyEsc(name)}'s payslip under the name you give it, and it does not carry into any other period.
      </div>
      ${existing.length ? `<div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Already added this period</div>
        ${existing.map(x => `<div style="font-size:13px;line-height:1.7">${_pyEsc(x.label || 'One-off')} — <strong class="${x.kind === 'deduction' ? 'py-minus' : 'py-plus'}">${x.kind === 'deduction' ? '-' : '+'}${_pyEsc(_pyPeso(x.amount))}</strong></div>`).join('')}
      </div>` : ''}
      <div class="form-group"><label>What is it?</label>
        <input id="pyo-label" type="text" placeholder="e.g. 13th month, performance bonus, lost tool"/></div>
      <div class="form-row">
        <div class="form-group"><label>Amount (₱)</label>
          <input id="pyo-amount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00"/></div>
        <div class="form-group"><label>Added or taken off?</label>
          <select id="pyo-kind" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);width:100%">
            <option value="earning">Added to their pay</option>
            <option value="deduction">Taken off their pay</option>
          </select></div>
      </div>
    `, `<button class="btn-primary" id="pyo-save">Add it</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    const $ = (id) => panel.querySelector('#' + id);
    $('pyo-save')?.addEventListener('click', () => window.busy($('pyo-save'), async () => {
      const lbl = ($('pyo-label')?.value || '').trim();
      const amt = parseFloat($('pyo-amount')?.value);
      const knd = $('pyo-kind')?.value === 'deduction' ? 'deduction' : 'earning';
      if (!lbl) { Notifs.showToast('Give it a name so it can be read on the payslip.', 'error'); return; }
      if (!Number.isFinite(amt) || amt <= 0) { Notifs.showToast('Enter an amount above zero.', 'error'); return; }
      try {
        await window.Payroll.addOneOff(selected, personId, { label: lbl, amount: amt, kind: knd });
        await _pyRefreshFigures();
        closeModal();
        Notifs.success(`${lbl} added for ${name}.`);
        load(selected);
      } catch (e) {
        Notifs.showToast(e && e.message ? e.message : 'This could not be added.', 'error');
      }
    }));
  }

  // ═════════════════════════════════════════════════════════
  //  CORRECT ONE PERSON AFTER THEY HAVE BEEN PAID
  //  The owner's "fix something after paying". It reverses that person's part
  //  of the books, reissues that person's payslip, and leaves everyone else
  //  exactly as they were. A reason is required because a correction after the
  //  money moved is the one thing somebody will be asked about a year later.
  // ═════════════════════════════════════════════════════════
  function openCorrectPanel(period, r, personId, label) {
    if (!personId) { Notifs.showToast('This record carries no id, so it cannot be corrected from here.', 'error'); return; }
    const name = (r && r.name) || personId;
    const kind = _pyKind(selected);
    const caLabel = 'Cash advance — this period\'s instalment (₱)';
    const fields = (kind === 'week')
      ? [['rentAllowance',   'Allowance (₱)',          r && r.allowances],
         ['otherDeductions', 'Other deductions (₱)',   r && r.otherDed],
         ['caDeduction',     caLabel,                  r && r.cashAdv],
         ['travelHours',     'Travel hours',           r && r.travelHours]]
      : [['allowance',       'Allowance (₱)',          r && r.allowances],
         ['otherDeductions', 'Other deductions (₱)',   r && r.otherDed],
         ['caPlanned',       caLabel,                  r && r.cashAdv]];

    const panel = openPage(`Correct ${_pyEsc(name)} — ${_pyEsc(label)}`, `
      <div class="info-banner" style="margin-bottom:12px">
        ${_pyEsc(name)} was paid ${_pyEsc(_pyPeso(r && r.takeHome))} for ${_pyEsc(label)}.
        Saving a correction undoes that person's entry in the books, puts the new one in its place and reissues their payslip. <strong>Nobody else is touched.</strong>
      </div>
      <div class="form-row">
        ${fields.map(([k, lab, v]) => `<div class="form-group"><label>${_pyEsc(lab)}</label>
          <input id="pyc-${_pyEsc(k)}" type="number" step="0.01" min="0" inputmode="decimal" value="${v != null ? _pyEsc(v) : ''}" placeholder="0.00"/></div>`).join('')}
      </div>
      <div class="form-group"><label>Why is this being corrected? (needed)</label>
        <input id="pyc-reason" type="text" placeholder="e.g. Tuesday was worked, missed on the first payment"/></div>
      <div style="font-size:11px;color:var(--text-muted)">
        The difference between what was paid and what is right is settled with ${_pyEsc(name)} outside the app — this fixes the record, the books and the payslip.
      </div>
    `, `<button class="btn-danger" id="pyc-save">Save the correction</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    const $ = (id) => panel.querySelector('#' + id);
    $('pyc-save')?.addEventListener('click', () => window.busy($('pyc-save'), async () => {
      const reason = ($('pyc-reason')?.value || '').trim();
      if (!reason) { Notifs.showToast('A reason is needed for a change made after payment.', 'error'); return; }
      // Only what actually CHANGED is sent. A correction that restated every
      // figure would rewrite fields nobody touched, and after payment that is
      // the difference between fixing one number and re-cutting the whole
      // payslip from a form somebody skimmed.
      const patch = { reason };
      let changed = 0;
      fields.forEach(([k, , was]) => {
        const v = $('pyc-' + k)?.value;
        if (v == null) return;
        if (String(v) === (was != null ? String(was) : '')) return;
        const n = parseFloat(v);
        if (Number.isFinite(n)) { patch[k] = n; changed++; }
        else if (String(v).trim() === '') { patch[k] = 0; changed++; }
      });
      if (!changed) { Notifs.showToast('Nothing has been changed yet — change a figure before saving.', 'error'); return; }
      const ok = await confirmDialog({
        title: 'Correct this person?',
        message: `${name} only. Their entry in the books is undone and replaced, and their payslip is reissued. Everyone else on ${label} stays exactly as they are.`,
        confirmLabel: 'Correct this person', danger: true
      });
      if (!ok) return;
      try {
        await window.Payroll.correctAfterPay(selected, personId, patch);
        closeModal();
        Notifs.success(`${name} corrected — their payslip has been reissued.`);
        load(selected);
      } catch (e) {
        Notifs.showToast(e && e.message ? e.message : 'The correction could not be saved.', 'error');
      }
    }));
  }

  // ═════════════════════════════════════════════════════════
  //  PAY EVERYONE — one press, one receipt PER PERSON
  //  The receipts are collected here rather than after the fact because each
  //  person's payslip carries their own proof of payment (owner ruling). The
  //  same test the engine enforces is applied here too, so the refusal names
  //  the people while the upload boxes are still on screen.
  // ═════════════════════════════════════════════════════════
  async function openPayPanel(period, reads, tot, label) {
    const receipts = {};                       // { personId: {url, name} }
    const needReceipt = reads.filter(r => (+r.takeHome || 0) > 0 && r.id);
    const noId = reads.filter(r => !r.id);
    let bankOpts = '';
    try { bankOpts = window.BankAccounts ? await window.BankAccounts.optionsHTML() : ''; } catch (_) { bankOpts = ''; }

    const rowsHtml = reads.map((r, i) => `<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap">
          <strong style="min-width:0;overflow-wrap:anywhere">${_pyEsc(r.name)}</strong>
          <strong class="py-plus">${_pyEsc(_pyPeso(r.takeHome))}</strong>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin:4px 0 8px;overflow-wrap:anywhere">${
          [r.regHours != null ? _pyHrs(r.regHours) + ' hrs' : null,
           (+r.otHours || 0) ? _pyHrs(r.otHours) + ' overtime' : null,
           (+r.cashAdv || 0) ? 'cash advance -' + _pyPeso(r.cashAdv) : null].filter(Boolean).map(_pyEsc).join(' · ')
        }</div>
        <div id="py-rcpt-${i}"></div>
      </div>`).join('');

    const panel = openPage(`Pay ${_pyEsc(label)}`, `
      <p style="font-size:13px;margin-bottom:12px">
        <strong>${_pyEsc(_pyPeso(tot.takeHome))}</strong> to ${reads.length} ${reads.length === 1 ? 'person' : 'people'}.
        One press books it, takes each cash advance instalment, writes every payslip and records the money leaving. <strong>This cannot be undone.</strong>
      </p>
      ${noId.length ? `<div class="info-banner" style="margin-bottom:12px;border-left:3px solid var(--danger)">${noId.length} record${noId.length === 1 ? '' : 's'} carry no id and cannot be given a receipt here: ${_pyEsc(noId.map(r => r.name).join(', '))}.</div>` : ''}
      ${bankOpts ? `<div class="form-group"><label>Paid from (company account)</label>
        <select id="py-bankacct" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>` : ''}
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        Attach each person's own transfer receipt below — one each, printed on that person's payslip. Everyone with money going out needs one.
      </div>
      <div id="py-rcpt-count" style="font-size:12px;font-weight:700;margin-bottom:10px">0 of ${needReceipt.length} receipts attached</div>
      ${rowsHtml}
    `, `<button class="btn-danger" id="py-pay-go">Pay everyone</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    const $ = (id) => panel.querySelector('#' + id);
    const refreshCount = () => {
      const el = $('py-rcpt-count');
      if (!el) return;
      const n = needReceipt.filter(r => receipts[r.id] && receipts[r.id].url).length;
      el.textContent = `${n} of ${needReceipt.length} receipts attached`;
      el.style.color = (n >= needReceipt.length) ? 'var(--success)' : 'var(--warning)';
    };
    refreshCount();

    // Drive.renderUploadArea takes an id STRING and resolves it through
    // window.liveEl, which skips a dying panel — so the chooser mounts into the
    // visible form. The ids are indexed rather than built from a person id,
    // which can contain characters that are not valid in a selector.
    reads.forEach((r, i) => {
      if (!r.id || !window.Drive || !window.Drive.renderUploadArea) return;
      window.Drive.renderUploadArea(`py-rcpt-${i}`, (res) => {
        const url = (window.Drive.resolveUrl ? window.Drive.resolveUrl(res) : (res && (res.url || res.link))) || '';
        receipts[r.id] = { url, name: (res && res.name) || 'receipt' };
        refreshCount();
      }, { label: 'Attach transfer receipt', dept: 'Finance', subfolder: 'payslips', accept: 'image/*,application/pdf' });
    });

    $('py-pay-go')?.addEventListener('click', () => window.busy($('py-pay-go'), async () => {
      const missing = needReceipt.filter(r => !(receipts[r.id] && receipts[r.id].url));
      if (missing.length) {
        // Deliberately NOT an "attach later / pay anyway": the engine refuses
        // the payment regardless, and a confirmation that leads to a refusal
        // teaches people to click through confirmations.
        await confirmDialog({
          title: 'A receipt is missing',
          message: `${missing.length} ${missing.length === 1 ? 'person has' : 'people have'} no transfer receipt yet: ${missing.map(r => r.name).join(', ')}. Each payslip carries its own proof of payment, so this cannot go out until every one is attached.`,
          confirmLabel: 'OK', cancelLabel: 'Close'
        });
        return;
      }
      const ok = await confirmDialog({
        title: 'Pay everyone?',
        message: `${label}: ${reads.length} ${reads.length === 1 ? 'person' : 'people'}, ${_pyPeso(tot.takeHome)}. This cannot be undone. Afterwards a mistake is fixed one person at a time from their row.`,
        confirmLabel: 'Pay everyone', danger: true
      });
      if (!ok) return;
      const acct = (window.BankAccounts && $('py-bankacct'))
        ? await window.BankAccounts.pick($('py-bankacct').value).catch(() => null)
        : null;
      try {
        const res = await window.Payroll.pay(selected, receipts, acct ? { bankAccount: acct } : undefined);
        closeModal();
        const paid = (res && res.paid != null) ? res.paid : reads.length;
        Notifs.success(`Paid — ${paid} ${paid === 1 ? 'person' : 'people'}.`);
      } catch (e) {
        Notifs.showToast(e && e.message ? e.message : 'The payment did not go through.', 'error');
      }
      load(selected);
    }));
  }

  await load(null);
};
