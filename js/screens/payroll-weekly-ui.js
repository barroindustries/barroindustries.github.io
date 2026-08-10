// ═══════════════════════════════════════════════════════════
//  js/screens/payroll-weekly-ui.js — the OPERATIONS TEAM (weekly) pay screen
//  OPS-PAYROLL-PARITY-SPEC step 7 + step 8 (the adjust panel).
//
//  THE OWNER ASKED FOR ONE THING: "make the ui/ux same with the office team
//  payroll". So this file is a deliberate, element-for-element mirror of the
//  MONTHLY screen (renderPayrollManagement, js/screens/hr.js ~884-2620) with
//  weeks where it has months:
//     period picker top-left (+ a Today affordance)      hr.js ~1019-1030
//     unpaid-periods card, oldest first, with its total  hr.js ~1306-1356
//     Compute → Verify → Disburse strip, state-driven    hr.js ~2514-2608
//     roster table with the GRAND TOTAL AS ROW ONE       hr.js ~1437-1487
//     the skipped list — dimmed, reason in words         hr.js ~1704-1723
//     KPI tiles above the table                          hr.js ~2967-2972
//  Where the wording differs from the monthly screen it is because the ruling
//  differs (a week is Mon–Sun, Finance may release, one receipt PER WORKER);
//  every such place says so on the line.
//
//  THIS FILE TOUCHES NO FIRESTORE AND DOES NO MONEY MATHS. Every peso it
//  prints is read from the STORED line on pay_weeks/{monday}; the only
//  arithmetic here is the grand-total row, which sums the very values the rows
//  printed (same rule the monthly totals row follows, hr.js ~1673-1676) so the
//  total can never disagree with the column above it. This repo has already
//  been bitten by a preview/engine divergence in payroll — there is exactly one
//  expression for a worker's pay and it lives in js/money-core.js.
//
//  DATA COMES FROM window.WeeklyRun AND NOTHING ELSE (js/payroll-weekly.js).
//  load/compute/setExcluded/setAdjustment/verify/disburse/weekLabel/recentWeeks
//  is the whole contract; the engine touches no DOM and this file opens no
//  collection of its own.
// ═══════════════════════════════════════════════════════════

'use strict';

// `var`, not `const`, for every FILE-SCOPE binding below (function scopes use
// const throughout). A top-level `const` in a classic script creates a global
// LEXICAL binding, and a second evaluation of the same file — a duplicated
// <script> tag, a stale service-worker copy served alongside the fresh one —
// throws "Identifier has already been declared" and takes the WHOLE file with
// it, i.e. the pay screen disappears. `var` re-evaluates harmlessly. Names are
// all WP_/_wp-prefixed and verified unique across js/ and js/screens/.

// How many weeks the picker and the unpaid card cover. 52 weeks a year is how
// a missed week hides, so the window is deliberately wider than "the last
// couple" — but it is also one document read per week, so it is not the year.
// Four months back is the same reach the monthly screen gives itself
// (hr.js ~997, _prMonthsAgo(thisMonth, 3) plus the current month).
var WP_WEEK_WINDOW = 17;

// The pipeline the badge row draws, in order. 'disbursing' is deliberately NOT
// in it: it is a transient lock BETWEEN verified and disbursed and is drawn as
// its own amber badge, exactly as the monthly strip does (hr.js ~2518-2521).
var WP_STATES = ['draft', 'computed', 'verified', 'disbursed'];
var WP_LABEL  = { draft: 'Draft', computed: 'Computed', verified: 'Verified', disbursed: 'Disbursed' };

// ── Local formatting/escaping shims ────────────────────────────────────────
// Resolved at CALL time, never at parse time: this file is a plain <script>
// like every other js/*.js and its position in index.html's fixed load order
// must not become load-bearing for a currency format.
var _wpEsc = (s) => (window.escHtml ? window.escHtml(s) : String(s == null ? '' : s));
var _wpN   = (n) => (window.fmtN2 ? window.fmtN2(n) : (Number(n) || 0).toFixed(2));
// "-₱500.00", never "₱-500.00" — the sign belongs outside the symbol. A week
// with a cash advance still on the books can genuinely go negative and the
// owner has to be able to read it at a glance (same helper as the payslip
// generator's live total, hr.js ~4308).
var _wpPeso = (n) => ((Number(n) || 0) < 0 ? '-₱' : '₱') + _wpN(Math.abs(Number(n) || 0));
var _wpHrs  = (n) => (Number(n) || 0).toFixed(2);
var _wpIcon = (g, s) => (window.emojiIcon ? window.emojiIcon(g, s) : '');

// The engine's own line/skip records carry the worker id under one of a few
// names depending on where the record was built (the weekly guard works on
// worker_profiles docs, the monthly one on user docs). Resolve defensively
// rather than assume: a line whose id we cannot read must still RENDER — it
// just cannot be adjusted, and the row says so — because dropping it would be
// the one failure this screen exists to prevent.
var _wpId   = (o) => (o && (o.workerId || o.uid || o.id || '')) || '';
var _wpName = (o) => (o && (o.name || o.workerName || o.displayName || '')) || '';

// weeklyRunSkipReason's vocabulary, in words. NOBODY IS SILENTLY DROPPED: every
// person the run does not pay appears on the roster, dimmed, with this sentence
// under their name (the monthly precedent, hr.js ~1704-1723).
function _wpSkipWords(reason) {
  const r = String(reason || '');
  if (r === 'removed')      return { short: 'Removed from the system', note: 'Off the worker roster — reinstate the worker profile before they can be paid.', undoable: false };
  if (r === 'paid-monthly') return { short: 'Paid on the monthly run',  note: 'Already paid on the Office Team monthly run — kept out of this week so nobody is paid twice.', undoable: false };
  if (r === 'no-rate')      return { short: 'No pay rate on file',      note: 'No hourly or daily rate on this worker\'s profile. The run refuses rather than pay ₱0.00 — set a rate, then Compute again.', undoable: false };
  if (r === 'missing')      return { short: 'Worker record missing',    note: 'The worker profile could not be read for this week.', undoable: false };
  if (r === 'not-in-payroll') return { short: 'Not included in payroll', note: 'Their worker profile is set to “Excluded” from payroll. That flag belongs to the PERSON, not to this week — change it on the Workers screen if they should be paid.', undoable: false };
  // A READ FAILURE, not a decision. It is the one skip reason that means "we do
  // not know", so it is coloured like a fault: paying zero on an unread week is
  // exactly the silent-zero this whole design exists to prevent.
  if (r === 'attendance-unreadable') return { short: 'Attendance could not be read', danger: true, note: 'Their punches for this week could not be read, so the run refused to pay them rather than pay zero. Retry Compute before releasing this week — do not disburse around this.', undoable: false };
  if (r.startsWith('excluded')) {
    const why = r.slice('excluded'.length).replace(/^:\s*/, '');
    return {
      short: 'Removed from THIS week' + (why ? ' — ' + why : ''),
      // Said out loud because it is the opposite of what the old flag did, and
      // the difference is money: removal is period-scoped now (owner ruling
      // 2026-08-10), so next week starts with them back on the roster.
      note: 'Removed from this week only. Next week they are back on the roster and you decide again.',
      undoable: true
    };
  }
  return { short: r || 'Not paid this week', note: 'The run did not pay this worker this week.', undoable: false };
}

// Error state with a Retry — byte-identical in shape to _hrPanelError
// (hr.js ~126) and withLoadingAndError's own error block, so a failed weekly
// read looks like every other failed read in the app.
// A DENIED READ MUST NEVER RENDER AS AN EMPTY ROSTER: on a pay screen "no rows"
// and "you may not see the rows" are indistinguishable, and one of them reads
// as "nobody is owed anything".
function _wpError(el, err, retry, headline) {
  if (!el) return;
  const msg = (err && err.message) ? err.message : String(err);
  el.innerHTML =
    '<div class="empty-state">' +
      '<div class="empty-icon">' + _wpIcon('⚠️', 44) + '</div>' +
      '<h4>' + _wpEsc(headline || 'This week could not be read') + '</h4>' +
      '<p>' + _wpEsc(msg) + '</p>' +
      '<p style="font-size:12px;color:var(--text-muted);margin-top:6px">Nothing is shown rather than an empty roster — an empty roster here would read as “nobody is owed anything”.</p>' +
      (retry ? '<button type="button" class="btn-secondary btn-sm uistate-retry-btn" style="margin-top:14px">Retry</button>' : '') +
    '</div>';
  if (retry) el.querySelector('.uistate-retry-btn')?.addEventListener('click', retry);
  if (window.lucide && el.querySelector('[data-lucide]:not(svg)')) lucide.createIcons({ nodes: [el] });
}

// Sum of the STORED components of a line, for the KPI tiles and the totals row.
// Never a recomputation of pay — it only ever adds up numbers the row itself
// printed (hr.js ~1437-1448 does the same on the monthly frozen branch).
function _wpTotals(lines) {
  return (lines || []).reduce((a, l) => ({
    workers:   a.workers + 1,
    regHours:  a.regHours  + (+l.regHours    || 0),
    otHours:   a.otHours   + (+l.otHours     || 0),
    travHours: a.travHours + (+l.travelHours || 0),
    daysWorked:a.daysWorked+ (+l.daysWorked  || 0),
    daysAbsent:a.daysAbsent+ (+l.daysAbsent  || 0),
    // Sums the SAME basis the rows print, or the total contradicts the column
    // above it — which is the one thing a totals row must never do.
    gross:     a.gross     + _wpEarnings(l),
    allow:     a.allow     + (+l.allowanceTotal || 0),
    otherDed:  a.otherDed  + (+l.otherDeductionsOnly || 0),
    statutory: a.statutory + _wpStatOf(l),
    ca:        a.ca        + (+l.caDeduction || 0),
    net:       a.net       + (+l.net         || 0)
  }), { workers:0, regHours:0, otHours:0, travHours:0, daysWorked:0, daysAbsent:0,
        gross:0, allow:0, otherDed:0, statutory:0, ca:0, net:0 });
}

// Earnings = what the hours earned, BEFORE allowances. computeWeeklyLine's
// `gross` already includes allowanceTotal, so a roster that shows gross AND an
// allowances column has counted allowances twice to the reader. Summed from the
// frozen line's own components — never recomputed from rates or hours.
function _wpEarnings(l) {
  return (+l.regularPay || 0) + (+l.otPay || 0) + (+l.travelPay || 0);
}

// Statutory on a weekly line, READ not computed. The owner's ruling is that the
// existing rule is ported verbatim — SSS/PhilHealth/Pag-IBIG once a month, on
// the month's LAST pay week, only for workers configured for it (hr.js
// ~4430-4451/~4585-4595). Whether a given line carries it is the ENGINE's
// decision; this screen only shows what the line says. The column hides itself
// entirely when no line in the week carries any, so an unconfigured crew (every
// worker on record today) sees the same table it saw before.
function _wpStatOf(l) {
  if (!l) return 0;
  // The engine freezes it as line.statutory = {sss, philhealth, pagibig, total,…}
  // (js/payroll-weekly.js ~670). The two fallbacks below cost nothing and keep
  // this readable against an older frozen line that stored it flat.
  if (l.statutory && typeof l.statutory.total === 'number') return l.statutory.total;
  if (typeof l.statutoryTotal === 'number') return l.statutoryTotal;
  return (+l.sss || 0) + (+l.philhealth || 0) + (+l.pagibig || 0) + (+l.tax || 0);
}

// ═══════════════════════════════════════════════════════════
//  THE SCREEN
// ═══════════════════════════════════════════════════════════
window.renderWeeklyPayrollTab = async function (container, currentUser, currentRole) {
  const host = container || (typeof deptContainer === 'function' ? deptContainer() : null);
  if (!host) return;

  // The engine is a separate file (js/payroll-weekly.js) loaded before this one.
  // If it is absent, SAY SO. Rendering a bare "no weeks" screen would be the
  // silent-zero failure in its purest form.
  if (!window.WeeklyRun || typeof window.WeeklyRun.load !== 'function') {
    _wpError(host, new Error('The weekly pay engine (window.WeeklyRun) did not load. Reload the app; if it persists, the payroll-weekly script is missing from index.html.'),
      () => window.renderWeeklyPayrollTab(host, currentUser, currentRole), 'Weekly payroll is unavailable');
    return;
  }

  // ── RE-ENTRY GUARD — this is a MONEY bug if it is missing ────────────────
  // Same reasoning as renderPayrollHub's (hr.js ~802-822): this renderer awaits
  // several reads and only then binds listeners. Entering twice while the first
  // load is in flight leaves the first render's handlers bound to the second
  // render's DOM — measured on the monthly screen as ONE tap running Compute
  // TWICE. Mount once per host and route every later entry through the same
  // latest-wins loader.
  if (typeof host._weeklyRunLoad === 'function' && host.querySelector('#wp-root')) {
    return host._weeklyRunLoad();
  }

  const canPay = (typeof window.isMoneyPriv === 'function') ? window.isMoneyPriv()
               : (typeof window.isFinancePriv === 'function' ? window.isFinancePriv() : false);

  // Manila, via the app's own helper — a raw toISOString() is UTC and picks the
  // WRONG WEEK for the first eight hours of every Manila day, which would open
  // the screen on last week's roster every morning. The `new Date()` arm is the
  // same last-resort fallback the monthly screen carries (hr.js ~965) for a boot
  // where config.js has not attached yet; it is never the live path.
  const todayIso   = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10);
  const thisWeekId = window.payWeekMondayOf ? window.payWeekMondayOf(todayIso) : todayIso;

  host.innerHTML = '<div id="wp-root">' + window.skeletonHtml('rows') + '</div>';
  const root = host.querySelector('#wp-root');

  // Warnings are returned by compute() and are NOT part of the stored document,
  // so they are held here until the next Compute rather than lost on the reload
  // that follows it. Keyed by week so switching weeks never shows another
  // week's warnings.
  const warningsByWeek = {};

  let selected = thisWeekId;
  let busy = false, pending = null;

  // Latest-wins serialisation, the monthly hub's shape (hr.js ~850-874). A load
  // requested while one is in flight is REMEMBERED, not started, so two renders
  // can never own #wp-root at once.
  const load = async (weekId) => {
    const want = weekId || selected;
    if (busy) { pending = want; return; }
    busy = true;
    try {
      await paint(want);
    } catch (e) {
      // THROWN = a failed READ (the engine's contract: null means "no run
      // document yet", an exception means the read failed). Never an empty
      // roster.
      _wpError(root, e, () => load(want));
    } finally {
      busy = false;
      if (pending !== null) { const next = pending; pending = null; await load(next); }
    }
  };
  host._weeklyRunLoad = load;

  // ═════════════════════════════════════════════════════════
  //  PAINT — one function, whole screen, always from stored data
  // ═════════════════════════════════════════════════════════
  async function paint(weekId) {
    root.innerHTML = window.skeletonHtml('rows');

    // The picker window, newest first (the engine guarantees Mondays only).
    let weeks = (typeof window.WeeklyRun.recentWeeks === 'function')
      ? (window.WeeklyRun.recentWeeks(WP_WEEK_WINDOW) || []).slice()
      : [];
    // A week reached from a link/Open outside the window must still be
    // selectable — otherwise the picker would silently snap to another week and
    // the roster underneath would be a DIFFERENT week's money.
    if (weekId && weeks.indexOf(weekId) === -1) weeks.push(weekId);
    weeks.sort().reverse();
    selected = weekId;

    // ONE read per week in the window. Promise.all so a single denial rejects
    // the whole paint and lands in the error state above — a half-read unpaid
    // card would under-report the weeks still owing, which is the exact thing
    // the card exists to prevent.
    const runs = await Promise.all(weeks.map(w => window.WeeklyRun.load(w)));
    const runByWeek = {};
    weeks.forEach((w, i) => { runByWeek[w] = runs[i] || null; });

    const run   = runByWeek[selected] || null;
    const state = _wpStateOf(run);
    const lines = (run && Array.isArray(run.lines)) ? run.lines : [];
    const skipped = (run && Array.isArray(run.skipped)) ? run.skipped : [];
    const tot   = _wpTotals(lines);
    // Show the statutory column only when the week actually carries statutory
    // (see _wpStatOf). Zero-width honesty: an unconfigured crew sees no column
    // rather than a column of ₱0.00 that asserts "nothing is due".
    const showStat = lines.some(l => _wpStatOf(l) > 0);

    const label = _wpWeekLabel(selected);
    const canCompute  = canPay && (state === 'draft' || state === 'computed');
    const canVerify   = canPay && state === 'computed';
    // OWNER RULING 2026-08-10 (decision 1): FINANCE MAY RELEASE A VERIFIED WEEK.
    // This is the one place the weekly strip deliberately differs from the
    // monthly one, where Disburse is President-only — 52 President-only releases
    // a year would make payday wait on one person, and production workers are
    // least able to absorb a late payday.
    const canDisburse = canPay && state === 'verified';
    // Adjust/remove only while the run is still open. firestore.rules fences an
    // exclusion write to excluded/excludedUpdatedAt/excludedUpdatedBy WITH THE
    // STATE UNCHANGED, so it is legal on a draft (uncomputed) week too — which
    // is the normal case for "this person is not working this week".
    const canEditWeek = canPay && (state === 'draft' || state === 'computed');

    const weekOptions = weeks.map(w => {
      const r  = runByWeek[w];
      const st = _wpStateOf(r);
      const suffix = (w === thisWeekId) ? ' (This week)'
                   : (st !== 'disbursed' ? ' — ⚠ not paid' : '');
      return `<option value="${_wpEsc(w)}"${w === selected ? ' selected' : ''}>${_wpEsc(_wpWeekLabel(w))}${suffix}</option>`;
    }).join('');

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0">
          <select id="wp-week-sel" aria-label="Pay week" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);max-width:100%">
            ${weekOptions}
          </select>
          <button class="btn-secondary btn-sm" id="wp-today-btn" title="Jump to the week that contains today">Today</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          ${canPay ? `<button class="btn-primary btn-sm" id="wp-compute-btn"${canCompute ? '' : ' disabled title="This week is locked — it has been verified or paid."'}>${state === 'computed' ? 'Recompute Week' : 'Compute Week'}</button>` : ''}
        </div>
      </div>

      <div id="wp-carry-card"></div>
      <div id="wp-unpaid-card" style="margin-bottom:14px"></div>
      <div id="wp-strip" style="margin-bottom:14px"></div>
      <div id="wp-warnings"></div>

      <div class="kpi-row">
        <div class="kpi-card"><div class="kpi-label">Workers paid</div><div class="kpi-value">${lines.length || '—'}</div></div>
        <div class="kpi-card"><div class="kpi-label">Hours (reg + OT + travel)</div><div class="kpi-value" style="font-size:16px">${lines.length ? _wpHrs(tot.regHours + tot.otHours + tot.travHours) : '—'}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Gross</div><div class="kpi-value" style="font-size:16px">${lines.length ? _wpPeso(tot.gross) : '—'}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Net — ${_wpEsc(label)}</div><div class="kpi-value" style="font-size:16px">${lines.length ? _wpPeso(tot.net) : '—'}</div></div>
        <div class="kpi-card ${skipped.length ? 'warn' : ''}"><div class="kpi-label">Not paid this week</div><div class="kpi-value">${skipped.length}</div></div>
      </div>

      <div class="card">
        <div class="card-body" style="padding:0">
          <div id="wp-caption" style="padding:8px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)"></div>
          <div class="table-wrap">
            <!-- .table-cards NO-TOGGLE, deliberately. A plain .table-cards hides
                 the header row at ≤700px and only reveals the breakdown on tap;
                 without the tap the pesos render as unlabelled numbers. That
                 shipped once already. no-toggle makes every cell a permanent
                 label:value line, so each <td> below MUST carry data-label. -->
            <table class="data-table table-cards no-toggle" id="wp-roster">
              <thead><tr>
                <th>Worker</th><th>Days</th><th>Hours</th><th>OT</th><th>Travel</th>
                <th>Earnings</th><th>Allowances</th><th>Other Ded</th>
                ${showStat ? '<th>Statutory</th>' : ''}
                <th>Cash Adv</th><th>Net Pay</th><th></th>
              </tr></thead>
              <tbody id="wp-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    _wpPaintCaption(root.querySelector('#wp-caption'), run, state);
    _wpPaintStrip(root.querySelector('#wp-strip'), run, state, { canVerify, canDisburse, label });
    _wpPaintUnpaid(root.querySelector('#wp-unpaid-card'), weeks, runByWeek);
    // Not awaited: the carry-forward suggestion fills its own card and must
    // never delay the roster. Its failure is swallowed on purpose — it is an
    // advisory that changes no figure, and it is the ONE thing on this screen
    // whose absence is safe (a missed suggestion means Finance decides fresh,
    // which is the ruling's default anyway).
    _wpPaintCarry(root.querySelector('#wp-carry-card'), weeks, runByWeek, canEditWeek).catch(() => {});
    // Fresh warnings from the Compute that just ran win; otherwise the ones
    // frozen on the stored run (the engine writes them onto the document, so
    // they survive a reload and a different device).
    _wpPaintWarnings(root.querySelector('#wp-warnings'),
      warningsByWeek[selected] || (run && run.warnings), (run && run.failures) || []);
    _wpPaintRoster(root.querySelector('#wp-tbody'), { run, state, lines, skipped, tot, showStat, canEditWeek });

    if (window.lucide) lucide.createIcons({ nodes: [root] });
    _wpBind({ run, state, lines, label, canCompute, canVerify, canDisburse, canEditWeek });
  }

  function _wpStateOf(run) {
    const s = run && run.state;
    if (s === 'disbursing') return 'disbursing';
    return WP_STATES.includes(s) ? s : 'draft';
  }

  function _wpWeekLabel(w) {
    try {
      if (typeof window.WeeklyRun.weekLabel === 'function') {
        const l = window.WeeklyRun.weekLabel(w);
        if (l) return l;
      }
    } catch (_) { /* fall through to the raw id — never blank a picker option */ }
    return String(w || '');
  }

  // ── Caption — what am I looking at? (monthly: hr.js ~1384-1385/1506) ──────
  function _wpPaintCaption(el, run, state) {
    if (!el) return;
    if (!run) {
      el.innerHTML = canPay
        ? `Nothing computed for this week yet — press <strong>Compute Week</strong> to read the punches and build the roster.`
        : `Nothing computed for this week yet.`;
      return;
    }
    const at = (run.computedAt && typeof run.computedAt.toDate === 'function') ? window.fmtManila(run.computedAt)
             : (run.computedAt ? window.fmtManila(run.computedAt) : '');
    const by = run.computedByName || run.computedBy || '';
    el.innerHTML =
      `Showing the computed run (state: <strong>${_wpEsc(WP_LABEL[state] || state)}</strong>`
      + (by ? `, computed by ${_wpEsc(by)}` : '')
      + (at ? ` at ${_wpEsc(at)}` : '')
      + `). Every figure below is read from this stored run — nothing on this screen is recomputed for display.`;
  }

  // ── Compute → Verify → Disburse strip (monthly: hr.js ~2528-2543) ─────────
  function _wpPaintStrip(el, run, state, o) {
    if (!el) return;
    const pipeIdx = WP_STATES.indexOf(state === 'disbursing' ? 'verified' : state);
    const data = run || {};
    const net  = (data.totals && typeof data.totals.net === 'number') ? data.totals.net : null;
    const cnt  = (Array.isArray(data.lines) ? data.lines.length : 0);
    el.innerHTML = `
      <div class="card"><div class="card-body" style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${WP_STATES.map((s, i) => `<span class="badge ${i < pipeIdx ? 'badge-blue' : i === pipeIdx ? 'badge-green' : 'badge-gray'}" style="font-size:11px">${i <= pipeIdx ? `${_wpIcon('✓', 14)} ` : ''}${WP_LABEL[s]}</span>${i < WP_STATES.length - 1 ? '<span style="color:var(--text-muted)">→</span>' : ''}`).join('')}
          <span style="flex:1"></span>
          ${net != null ? `<span style="font-size:12px;color:var(--text-muted)">Net ${_wpPeso(net)} · ${cnt} worker${cnt === 1 ? '' : 's'}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${o.canVerify ? `<button class="btn-secondary btn-sm" id="wp-verify-btn">${_wpIcon('✓', 16)} Mark Verified</button>` : ''}
          ${o.canDisburse ? `<button class="btn-primary btn-sm" id="wp-disburse-btn">${_wpIcon('💵', 16)} Disburse week</button>` : ''}
          ${state === 'draft' ? `<span style="font-size:12px;color:var(--text-muted)">Use <strong>Compute Week</strong> to start this week's run.</span>` : ''}
          ${state === 'verified' && !o.canDisburse ? `<span style="font-size:12px;color:var(--text-muted)">Verified — Finance or the President releases this week.</span>` : ''}
          ${state === 'disbursing' ? `<span class="badge badge-amber" style="font-size:11px">${_wpIcon('🔒', 12)} Disbursing… (locked)</span><span style="font-size:12px;color:var(--text-muted)">A release is in progress. If it stays locked, the President reopens it from the monthly tooling — this screen deliberately offers no unlock.</span>` : ''}
          ${state === 'disbursed' ? `<span style="font-size:12px;color:var(--success)">${_wpIcon('💵', 12)} Paid${run && run.disbursedAt ? ` — ${_wpEsc(window.fmtManila(run.disbursedAt))}` : ''}. This week is closed; the figures below are the ones that were paid.</span>` : ''}
        </div>
      </div></div>`;
  }

  // ── Unpaid weeks, oldest first (monthly: hr.js ~1312-1347) ───────────────
  // 52 weeks a year is how a missed week hides. Every week in the window that
  // is not 'disbursed' is listed with its own total, so a week nobody computed
  // is as visible as one that was computed and never released.
  function _wpPaintUnpaid(el, weeks, runByWeek) {
    if (!el) return;
    // WHICH weeks count as "owing". The picker's window reaches ~4 months back,
    // and listing every never-computed week in it would bury a real missed week
    // under a dozen weeks that pre-date the system. So: always the recent tail
    // (a week that slipped last month must still shout), plus ANY older week
    // that actually has a run document and has not been released — a computed
    // or verified week that never got paid is exactly the thing that hides.
    // Same shape as the monthly screen's PAYROLL_EPOCH (hr.js ~991-1000): a
    // floor of a few periods, extended backwards by real data.
    const RECENT_TAIL = 5;                       // this week + the four before it
    const floorWeek = weeks[Math.min(RECENT_TAIL - 1, weeks.length - 1)] || weeks[weeks.length - 1];
    const unpaid = weeks
      .filter(w => (w >= floorWeek) || runByWeek[w])
      .filter(w => _wpStateOf(runByWeek[w]) !== 'disbursed')
      .sort();                                   // oldest first
    if (!unpaid.length) {
      el.innerHTML = `<div class="info-banner">${_wpIcon('✓', 16)} No week is waiting to be paid — every computed week back to ${_wpEsc(_wpWeekLabel(weeks[weeks.length - 1] || ''))} has been released.</div>`;
      return;
    }
    const BADGE = {
      draft:      ['Never computed', 'badge-gray'],
      computed:   ['Computed',       'badge-blue'],
      verified:   ['Verified',       'badge-green'],
      disbursing: ['Disbursing (locked)', 'badge-amber']
    };
    const rows = unpaid.map(w => {
      const r  = runByWeek[w];
      const st = _wpStateOf(r);
      const [txt, cls] = BADGE[st] || ['Unknown', 'badge-gray'];
      const t = r ? _wpTotals(Array.isArray(r.lines) ? r.lines : []) : null;
      const sub = (t && t.workers)
        ? `<div style="font-size:11px;color:var(--text-muted)">${t.workers} worker${t.workers === 1 ? '' : 's'} · ${_wpPeso(t.net)}</div>`
        : `<div style="font-size:11px;color:var(--text-muted)">no roster yet</div>`;
      const cur = (w === thisWeekId) ? ` <span style="font-size:11px;color:var(--text-muted)">(current week — still running)</span>` : '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <strong>${_wpEsc(_wpWeekLabel(w))}</strong>
          <span class="badge ${cls}" style="font-size:10px;margin-left:6px">${txt}</span>${cur}
          ${sub}
        </div>
        <button class="btn-secondary btn-sm wp-unpaid-open" data-week="${_wpEsc(w)}">Open</button>
      </div>`;
    }).join('');
    el.innerHTML = `<div class="card"><div class="card-header"><h3>${unpaid.length} week(s) not yet paid</h3></div><div class="card-body">${rows}</div></div>`;
    el.querySelectorAll('.wp-unpaid-open').forEach(b => {
      b.addEventListener('click', () => load(b.dataset.week));
    });
  }

  // ── Exclusion carry-forward (owner ruling 2026-08-10, decision 3) ─────────
  // "Pre-tick and confirm": the next week opens with a previously-removed
  // person still suggested, and Finance confirms with ONE CLICK. This honours
  // the period-scoped ruling (a fresh decision every week) while making it
  // impossible to forget — the failure mode of a clean start is the negative-net
  // line the owner already screenshotted. Nothing here writes on its own; the
  // suggestion is inert until someone presses the button.
  async function _wpPaintCarry(el, weeks, runByWeek, canEditWeek) {
    if (!el) return;
    el.innerHTML = '';
    if (!canEditWeek) return;
    const cur = runByWeek[selected];
    const curExcl = (cur && cur.excluded) || {};
    if (Object.keys(curExcl).length) return;            // this week already has its own decision
    const idx = weeks.indexOf(selected);
    const prev = (idx >= 0 && idx + 1 < weeks.length) ? weeks[idx + 1] : null;   // weeks is newest-first
    let prevRun  = prev ? runByWeek[prev] : null;
    let prevExcl = (prevRun && prevRun.excluded) || {};
    // The previous week is normally already in the loaded window (recentWeeks is
    // contiguous), so no extra read. It ISN'T when the selected week is the
    // oldest one loaded — and a carry-forward suggestion that silently vanishes
    // at the edge of the window is the forgetting this card exists to stop. Ask
    // the engine directly in that one case.
    if (!prev && typeof window.WeeklyRun.suggestedExclusions === 'function') {
      try { prevExcl = (await window.WeeklyRun.suggestedExclusions(selected)) || {}; } catch (_) { return; }
    }
    const ids = Object.keys(prevExcl);
    if (!ids.length) return;
    // Name the people, don't print raw ids at them. The previous week's own
    // skipped[]/lines[] already carry the names the run used, so no extra read.
    const nameById = {};
    [].concat((prevRun && prevRun.skipped) || [], (prevRun && prevRun.lines) || []).forEach(r => {
      const id = _wpId(r); if (id && _wpName(r)) nameById[id] = _wpName(r);
    });
    const names = ids.map(id => {
      const why = prevExcl[id];
      return _wpEsc(nameById[id] || id) + (typeof why === 'string' && why ? ` (${_wpEsc(why)})` : '');
    }).join(', ');
    el.innerHTML = `<div class="info-banner" style="margin-bottom:14px">
      ${_wpIcon('↩', 16)} <strong>${ids.length}</strong> worker${ids.length === 1 ? ' was' : 's were'} removed from <strong>${_wpEsc(prev ? _wpWeekLabel(prev) : 'the previous week')}</strong>: ${names}.
      Removal applies to one week only, so this week starts clean.
      <button class="btn-secondary btn-sm" id="wp-carry-btn" style="margin-left:6px">Keep them out of this week too</button>
    </div>`;
    el.querySelector('#wp-carry-btn')?.addEventListener('click', (ev) => window.busy(ev.currentTarget, async () => {
      for (const id of ids) {
        const why = (typeof prevExcl[id] === 'string' && prevExcl[id]) ? prevExcl[id] : 'carried forward from the previous week';
        await window.WeeklyRun.setExcluded(selected, id, why);
      }
      Notifs.success(`${ids.length} carried forward — recompute the week to apply it.`);
      load(selected);
    }));
  }

  // ── Warnings returned by compute() ───────────────────────────────────────
  // Named, never swallowed. A worker the run could not pay, a configuration the
  // batch is not honouring, a flagged punch — all of it belongs on screen.
  function _wpPaintWarnings(el, warnings, failures) {
    if (!el) return;
    const list = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
    const fails = Array.isArray(failures) ? failures.filter(Boolean) : [];
    if (!list.length && !fails.length) { el.innerHTML = ''; return; }
    // FAILURES FIRST, and in danger colour. A partial release leaves the week in
    // 'disbursing' with a per-worker record of what did NOT go out (the engine
    // writes `failures` naming the worker and the peso amount). That is somebody
    // not being paid — it can never be a line item under "warnings".
    const failBlock = fails.length ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--danger)">
      <div class="card-body">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:var(--danger)">${_wpIcon('⛔', 16)} ${fails.length} thing${fails.length === 1 ? '' : 's'} did not complete when this week was released</div>
        <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.7">
          ${fails.map(f => `<li>${_wpEsc((f.name ? f.name + ' — ' : '') + (f.message || f.kind || 'failed') + (f.amount != null ? ` (${_wpPeso(f.amount)})` : ''))}</li>`).join('')}
        </ul>
        <div style="font-size:11px;color:var(--text-muted);margin-top:8px">Each item above did NOT go out. The week stays locked until the President reopens it; the release is safe to run again afterwards — anyone already paid is not paid twice.</div>
      </div></div>` : '';
    const warnBlock = list.length ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--warning)">
      <div class="card-body">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px">${_wpIcon('⚠️', 16)} ${list.length} thing${list.length === 1 ? '' : 's'} to look at before you pay this week</div>
        <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--text-2);line-height:1.7">
          ${list.map(w => `<li>${_wpEsc(typeof w === 'string' ? w : (w && (w.message || w.text)) || '')}</li>`).join('')}
        </ul>
      </div></div>` : '';
    el.innerHTML = failBlock + warnBlock;
  }

  // ── The roster (monthly: hr.js ~1387-1487 frozen branch) ─────────────────
  function _wpPaintRoster(tbody, ctx) {
    if (!tbody) return;
    const { run, state, lines, skipped, tot, showStat, canEditWeek } = ctx;

    if (!run) {
      tbody.innerHTML = `<tr><td colspan="${showStat ? 12 : 11}" data-label="Status" style="padding:26px 16px;text-align:center;color:var(--text-muted)">
        This week has not been computed. Nothing has been read, nothing is owed on screen — press Compute Week.
      </td></tr>`;
      return;
    }
    if (!lines.length && !skipped.length) {
      tbody.innerHTML = `<tr><td colspan="${showStat ? 12 : 11}" data-label="Status" style="padding:26px 16px;text-align:center;color:var(--text-muted)">
        The run computed no lines and skipped nobody. That normally means the worker roster was empty — check Workers before paying.
      </td></tr>`;
      return;
    }

    // TOTALS AS THE FIRST ROW. On the monthly screen this exists because the
    // figure used to vanish exactly when you wanted to check it — it lived only
    // on the live-preview branch and disappeared the moment Compute froze the
    // run (hr.js ~1428-1436). Here it is rendered on every paint from the stored
    // lines, so it survives a recompute by construction.
    const rows = [];
    if (lines.length) {
      // If the engine's own stored total and the sum of the printed lines
      // disagree, SAY SO rather than pick one. They are the same money by two
      // routes; a divergence is a defect, not a rounding taste.
      const storedNet = (run.totals && typeof run.totals.net === 'number') ? run.totals.net : null;
      const drift = (storedNet != null && Math.abs(storedNet - tot.net) > 0.005)
        ? ` · <span style="color:var(--danger)">stored total ${_wpPeso(storedNet)} disagrees with the rows — do not disburse, recompute</span>` : '';
      rows.push(`<tr class="wp-total-row" style="background:var(--s1);font-weight:700">
        <!-- .tc-name carries NO data-label, by the same rule the Bank Accounts
             table follows (styles.css §5c-i): it is the card's TITLE, not a
             label:value line, and the ::before label would collide with the
             name at ≤700px. -->
        <td class="tc-name"><strong>Total — ${lines.length} worker${lines.length === 1 ? '' : 's'}</strong>
          <div style="font-size:11px;color:var(--text-muted);font-weight:500">this is what disburses${skipped.length ? ` · ${skipped.length} not paid this week` : ''}${drift}</div></td>
        <td data-label="Days"><span>${tot.daysWorked} worked</span></td>
        <td data-label="Hours">${_wpHrs(tot.regHours)}</td>
        <td data-label="OT">${_wpHrs(tot.otHours)}</td>
        <td data-label="Travel">${_wpHrs(tot.travHours)}</td>
        <td data-label="Gross">${_wpPeso(tot.gross)}</td>
        <td data-label="Allowances" style="color:var(--success)">+${_wpPeso(tot.allow)}</td>
        <td data-label="Other Ded" style="color:var(--danger)">${tot.otherDed ? '-' + _wpPeso(tot.otherDed) : '—'}</td>
        ${showStat ? `<td data-label="Statutory" style="color:var(--danger)">${tot.statutory ? '-' + _wpPeso(tot.statutory) : '—'}</td>` : ''}
        <td data-label="Cash Adv" style="color:var(--danger)">${tot.ca ? '-' + _wpPeso(tot.ca) : '—'}</td>
        <td class="tc-net" data-label="Net Pay"><strong style="color:${tot.net >= 0 ? 'var(--success)' : 'var(--danger)'}">${_wpPeso(tot.net)}</strong></td>
        <td class="tc-actions"></td>
      </tr>`);
    }

    lines.forEach(l => {
      const id   = _wpId(l);
      const name = _wpName(l) || id || 'Unnamed worker';
      const stat = _wpStatOf(l);
      // The rate and where it came from. A worker set up with only a daily rate
      // resolves through resolveWorkerHourlyRate (dailyRate/8) — showing the
      // source is what makes "why is this person's pay what it is" answerable
      // without opening their profile.
      const rateNote = `${_wpPeso(l.rate)}/hr${l.rateSource ? ` · ${_wpEsc(l.rateSource)}` : ''}`;
      const ovrBadge = (+l.daysOverridden || 0) > 0
        ? ` <span class="badge badge-orange" style="font-size:10px" title="Days paid on a recorded admin override">${l.daysOverridden} override${l.daysOverridden === 1 ? '' : 's'}</span>` : '';
      // A cash advance clamped by the engine (net can never go negative) is a
      // fact the person collecting it needs to see — the shortfall rolls on.
      const caCell = (+l.caDeduction || 0) > 0
        ? `<div><div style="color:var(--danger);white-space:nowrap">-${_wpPeso(l.caDeduction)}</div>`
          + (l.caBalanceBefore != null ? `<div style="font-size:10px;color:var(--text-muted)">bal ${_wpPeso(l.caBalanceBefore)} → ${_wpPeso(l.caBalanceAfter != null ? l.caBalanceAfter : (l.caBalanceBefore - l.caDeduction))}</div>` : '')
          + ((+l.caShortfall || 0) > 0 ? `<div style="font-size:10px;color:var(--warning)">${_wpPeso(l.caShortfall)} could not be collected this week — it stays on the balance</div>` : '')
          + `</div>`
        : '<span style="color:var(--text-muted)">—</span>';
      rows.push(`<tr class="wp-line-row">
        <td class="tc-name"><strong>${_wpEsc(name)}</strong>${ovrBadge}
          <div style="font-size:11px;color:var(--text-muted)">${_wpEsc(rateNote)}</div></td>
        <td data-label="Days"><span>${(+l.daysWorked || 0)} worked${(+l.daysAbsent || 0) ? ` · <span style="color:var(--text-muted)">${l.daysAbsent} absent</span>` : ''}</span></td>
        <td data-label="Hours">${_wpHrs(l.regHours)}</td>
        <td data-label="OT">${_wpHrs(l.otHours)}</td>
        <td data-label="Travel"><span>${_wpHrs(l.travelHours)}${(+l.travelHours || 0) > 0 ? ` <span style="font-size:10px;color:var(--text-muted)">@ half rate</span>` : ''}</span></td>
        <!-- ⚠ EARNINGS, not gross. computeWeeklyLine's gross ALREADY contains
             allowanceTotal, so printing it beside a "+Allowances" column read as
             though allowances were added on top and double-counted them to the
             eye. Net was always right — it comes from the frozen line — but the
             row did not add up, which on a pay roster is its own defect.
             Earnings + Allowances now reconciles to gross exactly. Read from the
             line's own components; nothing is recomputed. -->
        <td data-label="Earnings">${_wpPeso(_wpEarnings(l))}</td>
        <td data-label="Allowances" style="color:var(--success)">${(+l.allowanceTotal || 0) ? '+' + _wpPeso(l.allowanceTotal) : '—'}</td>
        <!-- otherDeductionsOnly, NOT otherDeductions: the engine folds statutory
             INTO otherDeductions before the clamp (js/payroll-weekly.js:360) and
             keeps the split whole on the line for exactly this reason. Printing
             the combined figure beside a "Statutory" column counted statutory
             twice on screen. -->
        <td data-label="Other Ded" style="color:var(--danger)">${(+l.otherDeductionsOnly || 0) ? '-' + _wpPeso(l.otherDeductionsOnly) : '—'}</td>
        ${showStat ? `<td data-label="Statutory" style="color:var(--danger)">${stat ? '-' + _wpPeso(stat) : '—'}</td>` : ''}
        <td data-label="Cash Adv">${caCell}</td>
        <td class="tc-net" data-label="Net Pay"><strong style="color:${(+l.net || 0) >= 0 ? 'var(--success)' : 'var(--danger)'}">${_wpPeso(l.net)}</strong></td>
        <td class="tc-actions">
          ${(canEditWeek && id) ? `<button class="btn-secondary btn-sm wp-adjust-btn" data-worker="${_wpEsc(id)}" title="Adjust this line" aria-label="Adjust this line">${_wpIcon('✎', 16)}</button>` : ''}
          ${(canEditWeek && id) ? `<button class="btn-secondary btn-sm wp-exclude-btn" data-worker="${_wpEsc(id)}" data-name="${_wpEsc(name)}" title="Remove from this week" aria-label="Remove from this week">${_wpIcon('user-minus', 14)}</button>` : ''}
        </td>
      </tr>`);
    });

    // SKIPPED — everyone NOT being paid, dimmed, with the reason in words.
    // Rendered in the same table as the paid rows on purpose (the monthly
    // precedent): a separate collapsed list is how somebody gets forgotten.
    skipped.forEach(s => {
      const id = _wpId(s);
      const name = _wpName(s) || id || 'Unnamed worker';
      const w = _wpSkipWords(s && (s.reason || s.why));
      rows.push(`<tr class="wp-skip-row" style="opacity:${w.danger ? '1' : '.6'}${w.danger ? ';border-left:3px solid var(--danger)' : ''}">
        <td class="tc-name"><strong style="${w.danger ? '' : 'text-decoration:line-through'}">${_wpEsc(name)}</strong>
          <div style="font-size:11px;color:${w.danger ? 'var(--danger)' : 'var(--text-muted)'}">${_wpEsc(w.short)}</div></td>
        <td colspan="${showStat ? 9 : 8}" data-label="Why not paid" style="color:${w.danger ? 'var(--danger)' : 'var(--text-muted)'}">${_wpEsc(w.note)}</td>
        <td class="tc-net" data-label="Net Pay"><span style="color:var(--text-muted)">—</span></td>
        <td class="tc-actions">
          ${(canEditWeek && w.undoable && id) ? `<button class="btn-secondary btn-sm wp-include-btn" data-worker="${_wpEsc(id)}" data-name="${_wpEsc(name)}" title="Put back in this week" aria-label="Put back in this week">${_wpIcon('user-plus', 14)}</button>` : ''}
        </td>
      </tr>`);
    });

    tbody.innerHTML = rows.join('');
  }

  // ═════════════════════════════════════════════════════════
  //  BINDINGS — every lookup scoped to `root`, never document
  //  openPage keeps a dying panel in the DOM for ~300ms, so a document-wide
  //  getElementById can land on a screen nobody can see. 811 lookups were
  //  fixed for exactly this last week.
  // ═════════════════════════════════════════════════════════
  function _wpBind(ctx) {
    const { run, state, lines, label, canCompute, canEditWeek } = ctx;

    root.querySelector('#wp-week-sel')?.addEventListener('change', (e) => load(e.target.value));
    root.querySelector('#wp-today-btn')?.addEventListener('click', () => load(thisWeekId));

    // ── Compute ────────────────────────────────────────────────────────────
    root.querySelector('#wp-compute-btn')?.addEventListener('click', (ev) => window.busy(ev.currentTarget, async () => {
      if (!canCompute) return;
      if (state === 'computed') {
        // A recompute rebuilds every line from the punches and the stored
        // adjustments. Say what it costs before it is pressed.
        const ok = await confirmDialog({
          title: 'Recompute this week?',
          message: `This rebuilds every line for ${label} from the punch records and the saved adjustments. Anything typed into the adjust panel is kept; anything not saved there is not.`,
          confirmLabel: 'Recompute'
        });
        if (!ok) return;
      }
      try {
        const res = await window.WeeklyRun.compute(selected);
        warningsByWeek[selected] = (res && res.warnings) || [];
        const n = (res && Array.isArray(res.lines)) ? res.lines.length : 0;
        const sk = (res && Array.isArray(res.skipped)) ? res.skipped.length : 0;
        // Plain-text sink — no emojiIcon() here, it returns markup.
        Notifs.success(`Week computed — ${n} worker${n === 1 ? '' : 's'} to pay${sk ? `, ${sk} not paid` : ''}.`);
      } catch (e) {
        Notifs.showToast(e && e.message ? e.message : 'Could not compute this week.', 'error');
      }
      load(selected);
    }));

    // ── Verify ─────────────────────────────────────────────────────────────
    root.querySelector('#wp-verify-btn')?.addEventListener('click', (ev) => window.busy(ev.currentTarget, async () => {
      const t = _wpTotals(lines);
      const ok = await confirmDialog({
        title: 'Mark this week verified?',
        message: `${label}: ${lines.length} worker${lines.length === 1 ? '' : 's'}, ${_wpPeso(t.net)} net. Verify confirms the amounts have been checked. After this, who gets paid can only be changed by reopening the week.`,
        confirmLabel: 'Mark Verified'
      });
      if (!ok) return;
      try { await window.WeeklyRun.verify(selected); Notifs.success('Week marked verified.'); }
      catch (e) { Notifs.showToast(e && e.message ? e.message : 'Could not verify this week.', 'error'); }
      load(selected);
    }));

    // ── Disburse ───────────────────────────────────────────────────────────
    // busy() around the OPEN too: it reads the bank-account list first, and a
    // button that looks inert invites a second press.
    root.querySelector('#wp-disburse-btn')?.addEventListener('click', (ev) => window.busy(ev.currentTarget, async () => {
      try { await openDisbursePanel(run, lines, label); }
      catch (e) { Notifs.showToast(e && e.message ? e.message : 'Could not open the disburse form.', 'error'); }
    }));

    // ── Adjust / remove / put back ─────────────────────────────────────────
    if (canEditWeek) {
      root.querySelectorAll('.wp-adjust-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.worker;
          openAdjustPanel(run, lines.find(l => _wpId(l) === id), id, label);
        });
      });
      root.querySelectorAll('.wp-exclude-btn').forEach(btn => {
        btn.addEventListener('click', () => window.busy(btn, async () => {
          const name = btn.dataset.name || 'this worker';
          // A reason is the point of the record — the same requirement the
          // monthly screen enforces (hr.js ~1779-1787).
          const reason = await window.promptDialog({
            title: 'Remove from this week',
            message: `Why is ${name} not being paid for ${label}? This is recorded on this week's run — and on this week only. Next week they are back on the roster.`,
            placeholder: 'e.g. did not work this week / paid off-cycle / on leave',
            confirmLabel: 'Remove from this week',
            required: true
          });
          if (reason === null) return;
          if (!String(reason).trim()) { Notifs.showToast('A reason is required.', 'error'); return; }
          try {
            await window.WeeklyRun.setExcluded(selected, btn.dataset.worker, String(reason).trim());
            Notifs.success(`${name} removed from this week. Recompute to apply it.`);
          } catch (e) { Notifs.showToast(e && e.message ? e.message : 'Could not save the removal.', 'error'); }
          load(selected);
        }));
      });
      root.querySelectorAll('.wp-include-btn').forEach(btn => {
        btn.addEventListener('click', () => window.busy(btn, async () => {
          const name = btn.dataset.name || 'this worker';
          if (!(await confirmDialog({ message: `Put ${name} back into ${label}? They are included from the next Compute.` }))) return;
          try {
            await window.WeeklyRun.setExcluded(selected, btn.dataset.worker, null);
            Notifs.success(`${name} is back in this week. Recompute to apply it.`);
          } catch (e) { Notifs.showToast(e && e.message ? e.message : 'Could not undo the removal.', 'error'); }
          load(selected);
        }));
      });
    }
  }

  // ═════════════════════════════════════════════════════════
  //  THE ADJUST PANEL — NOT OPTIONAL (spec step 8)
  //  Rent allowance, other deductions and the cash-advance instalment are
  //  typed by hand in the one-worker payslip form today (hr.js ~4214, ~4231,
  //  ~4228) and are stored NOWHERE. A batch that does not capture them
  //  silently zeroes all three for everyone, every week. That is the whole
  //  reason this panel exists — travel hours and the per-day absence override
  //  (which MUST carry a reason) have the same problem and are captured here
  //  too.
  // ═════════════════════════════════════════════════════════
  function openAdjustPanel(run, line, workerId, label) {
    if (!workerId) { Notifs.showToast('This line carries no worker id — it cannot be adjusted.', 'error'); return; }
    const name = _wpName(line) || workerId;
    const adj  = ((run && run.adjustments) || {})[workerId] || {};
    const savedOvr = adj.overrides || {};
    const days = (typeof window.payWeekDays === 'function') ? window.payWeekDays(selected) : [];
    const dayNames = window.WEEK_DAYS || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    // The punched figures come off the STORED line's own per-day rows — the
    // same rows the payslip prints. They are shown read-only beside the
    // override so the person adjusting can see what they are overriding.
    const lineRows = (line && Array.isArray(line.rows)) ? line.rows : [];

    const dayRowsHtml = days.map((iso, i) => {
      const r  = lineRows[i] || {};
      const o  = savedOvr[iso] || {};
      const punched = _wpHrs(r.hours) + ' hrs' + ((+r.otHours || 0) ? ` + ${_wpHrs(r.otHours)} OT` : '');
      const absent = r.absent === true;
      return `<tr>
        <td data-label="Day" style="white-space:nowrap"><strong>${_wpEsc(dayNames[i] || '')}</strong> <span style="font-size:11px;color:var(--text-muted)">${_wpEsc(iso)}</span></td>
        <td data-label="Punched" style="font-size:12px;color:${absent ? 'var(--danger)' : 'var(--text-muted)'}">${absent ? 'no punch — absent' : _wpEsc(punched)}</td>
        <td data-label="Override hours"><input id="wpa-h-${i}" type="number" step="0.25" min="0" inputmode="decimal" value="${o.hours != null ? _wpEsc(o.hours) : ''}" placeholder="—" style="width:100%;min-width:0"/></td>
        <td data-label="Override OT"><input id="wpa-ot-${i}" type="number" step="0.25" min="0" inputmode="decimal" value="${o.otHours != null ? _wpEsc(o.otHours) : ''}" placeholder="—" style="width:100%;min-width:0"/></td>
        <td data-label="Reason (required)"><input id="wpa-r-${i}" type="text" value="${_wpEsc(o.reason || '')}" placeholder="Why is this day being paid?" style="width:100%;min-width:0"/></td>
      </tr>`;
    }).join('');

    const panel = openPage(`Adjust — ${_wpEsc(name)} (${_wpEsc(label)})`, `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        These apply to <strong>${_wpEsc(label)}</strong> only and take effect on the next <strong>Compute</strong> of this week.
        Rent allowance, other deductions and the cash-advance instalment are typed by hand on the one-worker payslip and are stored nowhere else —
        if they are not entered here, the batch pays them as ₱0.00.
      </div>

      <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">This week's amounts</div>
        <div class="form-row">
          <div class="form-group"><label>Rent Allowance (₱)</label><input id="wpa-rent" type="number" step="0.01" min="0" inputmode="decimal" value="${adj.rentAllowance != null ? _wpEsc(adj.rentAllowance) : ''}" placeholder="0.00"/></div>
          <div class="form-group"><label>Other Deductions (₱)</label><input id="wpa-other" type="number" step="0.01" min="0" inputmode="decimal" value="${adj.otherDeductions != null ? _wpEsc(adj.otherDeductions) : ''}" placeholder="0.00"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Cash-Advance Instalment (₱)</label>
            <input id="wpa-ca" type="number" step="0.01" min="0" inputmode="decimal" value="${adj.caDeduction != null ? _wpEsc(adj.caDeduction) : ''}" placeholder="0.00"/>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px">Clamped by the engine so net pay can never go negative; anything uncollected stays on the balance.</div>
          </div>
          <div class="form-group"><label>Travel Hours (this week)</label>
            <input id="wpa-travel" type="number" step="0.25" min="0" inputmode="decimal" value="${adj.travelHours != null ? _wpEsc(adj.travelHours) : ''}" placeholder="0.00"/>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px">Paid at HALF the hourly rate (owner ruling).</div>
          </div>
        </div>
      </div>

      <div style="background:var(--surface2);border-radius:10px;padding:12px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Day overrides</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          No clock-in means absent and unpaid. An override pays the day anyway — and it is only accepted <strong>with a reason</strong>, because an override without a record is money moving with nobody accountable for it.
        </div>
        <div class="table-wrap">
          <table class="data-table table-cards no-toggle">
            <thead><tr><th>Day</th><th>Punched</th><th>Override hours</th><th>Override OT</th><th>Reason (required)</th></tr></thead>
            <tbody>${dayRowsHtml}</tbody>
          </table>
        </div>
      </div>
    `, `<button class="btn-primary" id="wpa-save">Save adjustments</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    // ⚠ SCOPED TO THIS PANEL, NOT document. Two adjust panels can carry the same
    // ids at once inside openPage's ~300ms teardown; a document-wide lookup
    // reads the PREVIOUS worker's fields and writes them onto THIS worker.
    const $ = (id) => panel.querySelector('#' + id);
    const numOrUndef = (id) => {
      const v = $(id)?.value;
      // v == null means the FIELD IS NOT IN THIS FORM — leave the stored value
      // alone. An empty STRING means the user cleared it, which is an explicit
      // zero and must be sent as one (see below).
      if (v == null) return undefined;
      const n = parseFloat(v);
      if (Number.isFinite(n)) return n;
      // ⚠ A CLEARED FIELD MUST SEND 0, NOT undefined.
      // WeeklyRun.mergeAdjustment keeps the PREVIOUS value for any key that
      // arrives undefined (js/payroll-weekly.js ~233) — which is right for a
      // field the panel never showed, and wrong for one the user has just
      // emptied. Returning undefined for a blank box meant a rent allowance or
      // a cash-advance instalment could be typed in but never taken back out:
      // the next Compute silently kept charging it. Caught in review.
      // An empty box is an explicit zero; only a field that is ABSENT from the
      // form stays undefined.
      return (String(v).trim() === '') ? 0 : undefined;
    };

    $('wpa-save')?.addEventListener('click', () => window.busy($('wpa-save'), async () => {
      const overrides = {};
      for (let i = 0; i < days.length; i++) {
        const h  = numOrUndef(`wpa-h-${i}`);
        const ot = numOrUndef(`wpa-ot-${i}`);
        const rs = ($(`wpa-r-${i}`)?.value || '').trim();
        if (h == null && ot == null && !rs) continue;
        if ((h == null && ot == null) && rs) continue;   // a reason with no hours changes nothing
        if (!rs) {
          // computeWeeklyLine REFUSES a reason-less override (money-core.js
          // ~482) — it treats the day as absent instead of quietly paying it.
          // Collecting the reason here is what makes the override work at all.
          Notifs.showToast(`${dayNames[i] || days[i]} needs a reason before it can be overridden.`, 'error');
          return;
        }
        overrides[days[i]] = { hours: h || 0, otHours: ot || 0, reason: rs };
      }
      const patch = {
        rentAllowance:   numOrUndef('wpa-rent'),
        otherDeductions: numOrUndef('wpa-other'),
        caDeduction:     numOrUndef('wpa-ca'),
        travelHours:     numOrUndef('wpa-travel'),
        overrides
      };
      // Drop the keys the user left blank rather than sending undefined —
      // "left blank" is not "set to zero", and the engine must be able to tell.
      Object.keys(patch).forEach(k => { if (patch[k] === undefined) delete patch[k]; });
      try {
        await window.WeeklyRun.setAdjustment(selected, workerId, patch);
        // Recompute so the roster shows the adjusted line immediately — the
        // monthly adjust modal does the same (hr.js ~2488-2489). Without it the
        // saved figures sit invisible until someone thinks to press Compute.
        try { await window.WeeklyRun.compute(selected); } catch (_) { /* saved either way; the roster will say the run is stale */ }
        closeModal();
        Notifs.success('Adjustments saved — week recomputed.');
        load(selected);
      } catch (e) {
        Notifs.showToast(e && e.message ? e.message : 'Could not save the adjustments.', 'error');
      }
    }));
  }

  // ═════════════════════════════════════════════════════════
  //  DISBURSE — ONE PRESS PAYS THE WEEK, ONE RECEIPT PER WORKER
  //  Owner ruling 2026-08-10 (decision 4), which OVERRODE the earlier reading
  //  of "one transfer receipt for the batch": each worker's payslip carries its
  //  own proof of payment, so Disburse collects a file per worker.
  // ═════════════════════════════════════════════════════════
  async function openDisbursePanel(run, lines, label) {
    const t = _wpTotals(lines);
    const receipts = {};   // { workerId: {url, name} }
    // WHO ACTUALLY NEEDS A RECEIPT. The engine refuses the whole release unless
    // every worker with net > 0 has one (js/payroll-weekly.js ~861) — a zero-net
    // line has no transfer to evidence. Counting the same population here is
    // what keeps the button's own gate identical to the engine's, instead of
    // letting someone press Disburse and meet a refusal.
    const needReceipt = lines.filter(l => (+l.net || 0) > 0);
    // Which company account pays. The monthly disburse asks the same question
    // (hr.js ~2564-2575) and the engine tags the Cash leg with it for bank rec.
    let bankOpts = '';
    try { bankOpts = window.BankAccounts ? await window.BankAccounts.optionsHTML() : ''; } catch (_) { bankOpts = ''; }

    const rowsHtml = lines.map((l, i) => {
      const id = _wpId(l);
      const nm = _wpName(l) || id || 'Unnamed worker';
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap">
          <strong style="min-width:0">${_wpEsc(nm)}</strong>
          <strong style="color:var(--success)">${_wpPeso(l.net)}</strong>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin:4px 0 8px">${_wpHrs(l.regHours)} hrs${(+l.otHours || 0) ? ` · ${_wpHrs(l.otHours)} OT` : ''}${(+l.caDeduction || 0) ? ` · CA -${_wpPeso(l.caDeduction)}` : ''}</div>
        <div id="wp-rcpt-${i}"></div>
      </div>`;
    }).join('');

    const panel = openPage(`Disburse ${_wpEsc(label)}`, `
      <p style="font-size:13px;margin-bottom:12px">
        <strong>${_wpPeso(t.net)}</strong> to ${lines.length} worker${lines.length === 1 ? '' : 's'}.
        One press books the expense, deducts the cash advances, writes each payslip and posts the cash movement.
        <strong>This cannot be undone.</strong>
      </p>
      ${bankOpts ? `<div class="form-group"><label>Paid from (company account)</label>
        <select id="wp-bankacct" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>` : ''}
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        Attach each worker's own transfer receipt below — one per worker, printed on that worker's payslip (owner ruling, not one receipt for the batch).
        Every worker with pay going out needs one; the release is refused without it.
      </div>
      <div id="wp-rcpt-count" style="font-size:12px;font-weight:700;margin-bottom:10px">0 of ${needReceipt.length} receipts attached</div>
      ${rowsHtml}
    `, `<button class="btn-danger" id="wp-disburse-go">Disburse week</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    const $ = (id) => panel.querySelector('#' + id);
    const refreshCount = () => {
      const el = $('wp-rcpt-count');
      const n = needReceipt.filter(l => receipts[_wpId(l)] && receipts[_wpId(l)].url).length;
      if (el) {
        el.textContent = `${n} of ${needReceipt.length} receipts attached`;
        el.style.color = (n >= needReceipt.length) ? 'var(--success)' : 'var(--warning)';
      }
    };
    refreshCount();

    // Drive.renderUploadArea takes an id STRING and resolves it through
    // window.liveEl, which skips a dying panel — so the chooser mounts into the
    // visible form. Ids are indexed rather than built from the worker id, which
    // can contain characters that are not valid in a selector.
    lines.forEach((l, i) => {
      const id = _wpId(l);
      if (!window.Drive || !window.Drive.renderUploadArea) return;
      window.Drive.renderUploadArea(`wp-rcpt-${i}`, (r) => {
        const url = (window.Drive.resolveUrl ? window.Drive.resolveUrl(r) : (r && (r.url || r.link))) || '';
        receipts[id] = { url, name: (r && r.name) || 'receipt' };
        refreshCount();
      }, { label: 'Attach transfer receipt', dept: 'Finance', subfolder: 'payslips', accept: 'image/*,application/pdf' });
    });

    $('wp-disburse-go')?.addEventListener('click', () => window.busy($('wp-disburse-go'), async () => {
      // THE SAME GATE THE ENGINE ENFORCES, checked here so the refusal names the
      // people while the upload boxes are still on screen. Deliberately NOT an
      // "attach later / disburse anyway" — the engine would refuse the release
      // anyway, and a confirm that leads to a refusal teaches people to click
      // through confirms.
      const missing = needReceipt.filter(l => !(receipts[_wpId(l)] && receipts[_wpId(l)].url));
      if (missing.length) {
        await confirmDialog({
          title: 'A receipt is missing',
          message: `${missing.length} worker${missing.length === 1 ? '' : 's'} still ${missing.length === 1 ? 'has' : 'have'} no transfer receipt: ${missing.map(l => _wpName(l) || _wpId(l)).join(', ')}. Each payslip carries its own proof of payment, so the week cannot be released until every one is attached.`,
          confirmLabel: 'OK', cancelLabel: 'Close'
        });
        return;
      }
      const acct = (window.BankAccounts && $('wp-bankacct'))
        ? await window.BankAccounts.pick($('wp-bankacct').value).catch(() => null)
        : null;
      try {
        const res = await window.WeeklyRun.disburse(selected, receipts, acct ? { bankAccount: acct } : undefined);
        closeModal();
        const paid = (res && res.paid != null) ? res.paid : lines.length;
        Notifs.success(`Week disbursed — ${paid} worker${paid === 1 ? '' : 's'} paid.`);
      } catch (e) {
        Notifs.showToast(e && e.message ? e.message : 'Could not disburse this week.', 'error');
      }
      load(selected);
    }));
  }

  await load(thisWeekId);
};
