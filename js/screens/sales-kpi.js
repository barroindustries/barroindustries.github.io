/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Sales Manager KPI screens (SALES-MANAGER-KPI-SPEC-2026-11-20, rollout steps 3, 4 and 5)
   js/screens/sales-kpi.js — LAZY: loaded through window.ensureScript('js/screens/sales-kpi.js') by the three places that show it; never an app-kit
   script. It is in sw.js PRECACHE (bare path). The pure rules are js/sales-kpi-core.js (window.SalesKpi, an eager app-kit script); this file is the
   screens around them. It does no money arithmetic and decides nothing about who counts: SalesKpi.compute does.

   WHERE IT SHOWS (the hooks that load it)
     • Finance › Payroll & HR › "Sales KPI"      (js/screens/finance.js, loadFinanceContent)  window.renderSalesKpi — the President's card, the scorecard, the
       "Jobs waiting for a rating" list. Finance (and a manager) sees the scorecard and a read-only summary of the card, no controls.
     • Sales (department page), top of the page    (js/screens/sales.js, renderSales)           SalesKpiUI.renderMyScorecard — "My scorecard" for the one
       person whose own sales_kpi document is switched on. Nothing at all for anyone else.
     • A delivered-or-later job, President only    (js/screens/production.js, openJobProjectDetail)  SalesKpiUI.renderJobRating — the "Client rating" row.

   DISPLAY ONLY. A month that has not reached the card's startMonth is labelled "Preview — not yet used for pay"; from startMonth on (rollout step 6,
   js/departments.js resolveSalesKpi — the pay switch lives THERE, not here) the badge says "Used for pay". Nothing here touches payroll, pay runs,
   kpi_targets or the task KPI. The only collections this file WRITES are sales_kpi/{uid} (the card) and client_ratings/{projectId} (a rating), both President-only in
   firestore.rules (plus the shared audit trail window.logAudit writes); everything else it reads (sales_orders, payment_claims, job_projects, users) it only
   reads. tests/sales-kpi-screens.test.mjs pins that.

   NO TARGET FIGURE LIVES HERE. The default monthly target is typed into the card by the President; the field starts blank and is never prefilled.
   `db` is firebase-config.js's top-level const, NOT window.db (js/errlog.js and js/forms.js document the trap), so every read goes through getDb().
   ═══════════════════════════════════════════════════ */
'use strict';
(function () {

  // ── small helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
  const str = (v) => (v == null ? '' : String(v));
  const esc = (s) => (typeof window.escHtml === 'function'
    ? window.escHtml(s)
    : str(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const K = () => window.SalesKpi;
  const toast = (m, t) => { try { window.Notifs.showToast(m, t || 'info'); } catch (_) {} };
  const getDb = () => ((typeof db !== 'undefined' && db) ? db : (window.db || null));
  const FV = () => window.firebase.firestore.FieldValue;
  const me = () => (window.currentUser && window.currentUser.uid) || '';
  const whoName = () => (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || '';
  const isPres = () => (typeof window.isRealPresident === 'function' ? !!window.isRealPresident() : window.currentRole === 'president');
  // The money tier the rules call canFinance(): president, manager, finance — or a Finance-department member who is not the Corporate Secretary.
  const canReadAll = () => {
    const role = window.currentRole || '';
    return isPres() || role === 'manager' || role === 'finance' || ((window.currentDepts || []).indexOf('Finance') >= 0 && role !== 'secretary');
  };
  const FIELD = 'padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text);min-height:44px;font-family:inherit';
  const BTN = 'min-height:44px';
  const HINT = 'font-size:11px;color:var(--text-muted);margin-top:3px';
  const GOLD = '#f59f00';
  const starTone = (on) => 'color:' + (on ? GOLD : 'var(--text-muted)') + ';opacity:' + (on ? '1' : '.4');

  const PREVIEW = 'Preview — not yet used for pay';
  const USED = 'Used for pay';                              // step 6: a month on or after the first month paid on the Sales KPI is the one payroll uses (SalesKpi.compute's `active`)
  const DEFAULT_START = '2027-01';                         // owner answer Q12: December 2026 is the preview month, January 2027 the first paid month
  const DONE_STAGES = ['delivered', 'completed', 'paid'];  // "delivered or later" (JOB_STAGES, js/screens/production.js; cancelled is not later)
  const STAGE_LABEL = { delivered: 'Delivered', completed: 'Completed', paid: 'Paid / Closed' };
  const HEARD = [['call', 'Call'], ['message', 'Message'], ['in_person', 'In person']];
  const HEARD_LABEL = { call: 'Call', message: 'Message', in_person: 'In person' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // 'YYYY-MM-DD' (a Manila day) -> 'Nov 20, 2026'; '' when it is not one.
  function fmtDay(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(ymd));
    return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? MON[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : '';
  }
  function tsMs(t) {
    if (t == null || t === '') return 0;
    if (typeof t === 'number') return isFinite(t) ? t : 0;
    if (typeof t === 'object') {
      if (typeof t.toMillis === 'function') { try { return t.toMillis(); } catch (_) { return 0; } }
      if (typeof t.toDate === 'function') { try { return t.toDate().getTime(); } catch (_) { return 0; } }
      if (typeof t.seconds === 'number') return t.seconds * 1000;
    }
    const ms = new Date(t).getTime();
    return isFinite(ms) ? ms : 0;
  }
  function curMonth() {
    const d = typeof window.bizDate === 'function' ? str(window.bizDate()) : '';
    return K().isMonth(d.slice(0, 7)) ? d.slice(0, 7) : K().monthOf(Date.now());
  }
  const isInternal = (co) => (typeof window.isInternalQuoteCompany === 'function' ? !!window.isInternalQuoteCompany(co) : K().INTERNAL_COMPANIES.indexOf(co) >= 0);
  // openPage writes its title with textContent (js/app.js _setPanelTitle): a name goes in as plain text, so escaping it would print "&amp;" for an "&" or "&#39;"
  // for an apostrophe. Angle brackets are dropped so that no tag can ever reach a title, whatever that sink becomes.
  const titleText = (s) => str(s).replace(/[<>]/g, '');
  const icons = (host) => { try { if (window.lucide && host) window.lucide.createIcons({ nodes: [host] }); } catch (_) {} };
  const docs = (snap) => snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  // js/sales-kpi-core.js is an app-kit script, so it is normally there already; a stale cached shell may not list it yet — load it then, or say so.
  async function ensureCore() {
    if (window.SalesKpi) return;
    if (typeof window.ensureScript === 'function') await window.ensureScript('js/sales-kpi-core.js');
    if (!window.SalesKpi) throw new Error('The Sales KPI engine did not load');
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  PURE HALF — plain data in, markup or data out (no Firestore, no DOM). tests/sales-kpi-screens.test.mjs runs these against the real file.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

  // Five Lucide stars, `n` of them gold. Lucide icons only: <i data-lucide="star"> (the SVG gets filled through currentColor).
  function starsHtml(n, size) {
    const s = size || 14;
    let out = '';
    for (let i = 1; i <= 5; i++) out += '<i data-lucide="star" style="width:' + s + 'px;height:' + s + 'px;fill:currentColor;' + starTone(i <= n) + '"></i>';
    return '<span role="img" aria-label="' + esc(String(n)) + ' out of 5 stars" style="display:inline-flex;gap:1px;vertical-align:middle">' + out + '</span>';
  }

  // The refunds of every job as the flat list the core expects ({id, projectId, clientName, quoteNumber, company, createdBy, amount, date}).
  function refundsOf(projects) {
    const out = [];
    (Array.isArray(projects) ? projects : []).forEach((p) => {
      (Array.isArray(p && p.refunds) ? p.refunds : []).forEach((r, i) => {
        out.push({ id: p.id + ':' + i, projectId: p.id, clientName: str(p.clientName), quoteNumber: str(p.quoteNumber), company: str(p.company), createdBy: str(p.createdBy), amount: r && r.amount, date: r && r.date });
      });
    });
    return out;
  }

  // ── the President's card ─────────────────────────────────────────────────────────────────────────────────────────────
  // sales_kpi/{uid} (or null) -> the form's draft. A person with no document yet starts ON, with the planned start month and a BLANK target.
  function draftOf(cfg) {
    const c = cfg || {};
    const targets = c.targets && typeof c.targets === 'object' ? c.targets : {};
    return {
      on: cfg ? c.kpiSource === 'sales' : true,
      startMonth: K().isMonth(c.startMonth) ? c.startMonth : DEFAULT_START,
      defaultTarget: c.defaultTarget == null ? '' : String(c.defaultTarget),
      overrides: Object.keys(targets).filter(K().isMonth).sort().map((m) => ({ month: m, amount: String(targets[m]) })),
    };
  }
  // The form -> the document, or the first mistake in plain words. Off is kpiSource 'tasks' (the task KPI stays the source). Weights and scope are fixed:
  // 70 / 30 (owner answer Q2) and 'all' (Q4a) — the card shows them read-only.
  function buildKpiDoc(f) {
    f = f || {};
    const fail = (error) => ({ ok: false, error: error });
    if (!K().isMonth(f.startMonth)) return fail('Pick the first month paid on the Sales KPI.');
    let def = null;
    const rawDef = str(f.defaultTarget).replace(/,/g, '').trim();
    if (rawDef !== '') {
      const n = Number(rawDef);
      if (!isFinite(n) || !(n > 0)) return fail('Enter a default target above ₱0, or leave it blank.');
      def = Math.round(n * 100) / 100;
    }
    const targets = {};
    const rows = Array.isArray(f.overrides) ? f.overrides : [];
    for (let i = 0; i < rows.length; i++) {
      const month = rows[i].month;
      const n = Number(str(rows[i].amount).replace(/,/g, '').trim());
      if (!K().isMonth(month)) return fail('One of the single-month targets has no valid month.');
      if (!isFinite(n) || !(n > 0)) return fail('The target for ' + K().monthLabel(month) + ' must be above ₱0.');
      targets[month] = Math.round(n * 100) / 100;
    }
    return {
      ok: true,
      doc: { kpiSource: f.on ? 'sales' : 'tasks', startMonth: f.startMonth, weights: { sales: K().WEIGHTS.sales, satisfaction: K().WEIGHTS.satisfaction }, targets: targets, defaultTarget: def, scope: 'all' },
    };
  }

  // The people the President can switch the Sales KPI on for: everyone with a name who has not left and is not an HR-managed worker login.
  function staffOptions(users, kpiDocs) {
    kpiDocs = kpiDocs || {};
    return (Array.isArray(users) ? users : [])
      .filter((u) => u && u.id && str(u.displayName).trim() && !u.removed && u.hrManagedAccount !== true)
      .sort((a, b) => str(a.displayName).localeCompare(str(b.displayName)))
      .map((u) => ({
        uid: u.id, name: str(u.displayName).trim(),
        detail: str(u.title || u.jobTitle || (Array.isArray(u.departments) && u.departments[0]) || u.department || ''),
        on: !!(kpiDocs[u.id] && kpiDocs[u.id].kpiSource === 'sales'), configured: !!kpiDocs[u.id],
      }));
  }
  // Who the picker starts on: the one person whose card is on, else the one "Sales Manager" by title, else nobody (the President chooses).
  function preselect(users, staff) {
    const on = staff.filter((s) => s.on);
    if (on.length === 1) return on[0].uid;
    const byId = {};
    (users || []).forEach((u) => { byId[u.id] = u; });
    const mgr = staff.filter((s) => /sales manager/i.test(str(byId[s.uid] && (byId[s.uid].title || byId[s.uid].jobTitle))));
    return mgr.length === 1 ? mgr[0].uid : '';
  }
  function staffPickerHtml(staff, sel, president) {
    const list = president ? staff : staff.filter((s) => s.configured);
    if (!list.length) {
      return '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' + (president ? 'No staff found.' : 'No one has a Sales KPI set up yet. The President sets it up here.') + '</div>';
    }
    return '<div class="form-group" style="max-width:440px;margin-bottom:12px"><label for="sk-staff">Employee</label><select id="sk-staff" style="' + FIELD + '">' +
      '<option value=""' + (sel ? '' : ' selected') + '>Choose an employee…</option>' +
      list.map((s) => '<option value="' + esc(s.uid) + '"' + (s.uid === sel ? ' selected' : '') + '>' + esc(s.name + (s.detail ? ' — ' + s.detail : '')) + '</option>').join('') +
      '</select></div>';
  }

  const WEIGHTS_LINE = 'Confirmed sales 70% · Client rating 30%';
  const SCOPE_LINE = 'Counts payments the President confirmed (or Finance for him) on Barro Kitchens and Barro Industries jobs. Brilliance Steel is not counted.';

  function configHtml(m) {
    const d = m.draft, name = esc(m.name);
    if (!m.canEdit) {
      const cfg = m.cfg;
      if (!cfg) return '<div class="card" style="margin-bottom:12px"><div class="card-body" style="font-size:13px">The Sales KPI is not set up for ' + name + ' yet. The President sets it up here.</div></div>';
      return '<div class="card" style="margin-bottom:12px"><div class="card-header"><h3 style="margin:0;display:flex;align-items:center;gap:6px"><i data-lucide="sliders-horizontal" style="width:16px;height:16px"></i> Sales KPI settings — ' + name + '</h3></div><div class="card-body" style="font-size:13px;line-height:1.7">' +
        '<div>' + (d.on ? 'Switched on' : 'Switched off') + ' · first month paid on it: <strong>' + esc(K().monthLabel(d.startMonth)) + '</strong></div>' +
        '<div>Default monthly target: <strong>' + (d.defaultTarget === '' ? 'not set' : esc(K().peso(Number(d.defaultTarget)))) + '</strong></div>' +
        (d.overrides.length ? '<div>Single months: ' + d.overrides.map((o) => esc(K().monthLabel(o.month) + ' ' + K().peso(Number(o.amount)))).join(' · ') + '</div>' : '') +
        '<div style="' + HINT + '">' + esc(WEIGHTS_LINE) + '. ' + esc(SCOPE_LINE) + '</div></div></div>';
    }
    const ovr = d.overrides.length
      ? d.overrides.map((o, i) => '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span>' + esc(K().monthLabel(o.month)) + ' — <strong>' + esc(K().peso(Number(o.amount))) + '</strong></span><button type="button" class="btn-secondary btn-sm sk-ovr-rm" data-i="' + i + '" aria-label="Remove the target for ' + esc(K().monthLabel(o.month)) + '" style="' + BTN + '"><i data-lucide="trash-2" style="width:14px;height:14px"></i> Remove</button></div>').join('')
      : '<div style="' + HINT + ';margin:0 0 6px">None. A month with no target of its own uses the default.</div>';
    return '<div class="card" style="margin-bottom:12px"><div class="card-header"><h3 style="margin:0;display:flex;align-items:center;gap:6px"><i data-lucide="sliders-horizontal" style="width:16px;height:16px"></i> Sales KPI settings — ' + name + '</h3></div><div class="card-body">' +
      '<label style="display:flex;align-items:center;gap:10px;min-height:44px;font-size:14px;margin-bottom:6px"><input type="checkbox" id="sk-on"' + (d.on ? ' checked' : '') + ' style="width:20px;height:20px"/><span>Use the Sales KPI for ' + name + '</span></label>' +
      '<div class="form-row">' +
        '<div class="form-group"><label for="sk-start">First month paid on the Sales KPI</label><input id="sk-start" type="month" placeholder="YYYY-MM" value="' + esc(d.startMonth) + '" style="' + FIELD + '"/><div style="' + HINT + '">Until then pay still uses the task KPI. A future month keeps this a preview.</div></div>' +
        '<div class="form-group"><label for="sk-default">Default monthly target (₱)</label><input id="sk-default" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Not set yet" value="' + esc(d.defaultTarget) + '" style="' + FIELD + '"/><div style="' + HINT + '">Leave it blank until you have the figure: the scorecard then says "No target set".</div></div>' +
      '</div>' +
      '<div class="form-group"><label>Targets for single months (optional)</label>' + ovr +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><input id="sk-ovr-month" type="month" placeholder="YYYY-MM" aria-label="Month" style="' + FIELD + ';flex:1 1 150px;width:auto"/><input id="sk-ovr-amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="₱ target" aria-label="Target for that month" style="' + FIELD + ';flex:1 1 150px;width:auto"/><button type="button" class="btn-secondary" id="sk-ovr-add" style="' + BTN + '">Add month</button></div></div>' +
      '<div style="' + HINT + ';margin:0 0 10px">Weights are fixed: ' + esc(WEIGHTS_LINE) + '. ' + esc(SCOPE_LINE) + '</div>' +
      '<div id="sk-err" class="error-msg hidden" role="alert"></div>' +
      '<button type="button" class="btn-primary" id="sk-save" style="' + BTN + '">Save</button>' +
      '</div></div>';
  }

  // ── the scorecard ────────────────────────────────────────────────────────────────────────────────────────────────────
  function paymentRowHtml(it) {
    const refund = it.source === 'refund';
    const how = refund ? 'Refund · ' + fmtDay(it.date) : it.kindLabel + ' · confirmed ' + fmtDay(it.date) + (it.standIn ? ' · by Finance, for the President' : '');
    return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">' +
      '<div style="min-width:0"><div style="font-weight:600;overflow-wrap:anywhere">' + esc(it.clientName || '—') + '</div><div style="font-size:11px;color:var(--text-muted);overflow-wrap:anywhere">' + esc(how) + (it.quoteNumber ? ' · ' + esc(it.quoteNumber) : '') + '</div></div>' +
      '<div style="font-weight:700;white-space:nowrap;' + (refund ? 'color:var(--danger)' : '') + '">' + (refund ? '−' : '') + esc(K().peso(it.amount)) + '</div></div>';
  }
  function commentRowHtml(r) {
    return '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><strong style="overflow-wrap:anywhere">' + esc(r.clientName || '—') + '</strong>' + starsHtml(r.stars) + '</div>' +
      (r.comment ? '<div style="margin-top:3px;overflow-wrap:anywhere">“' + esc(r.comment) + '”</div>' : '') +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + esc((HEARD_LABEL[r.heardVia] ? 'Heard by ' + HEARD_LABEL[r.heardVia].toLowerCase() + ' · ' : '') + fmtDay(r.date)) + '</div></div>';
  }
  // m = { b: SalesKpi.compute(...), title, month, isCurrent, open, president }
  function scorecardHtml(m) {
    const b = m.b, sn = b.sentence, noTarget = b.score.mode === 'no-target';
    const label = K().monthLabel(m.month);
    const lines = noTarget
      ? '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">' + (m.president ? 'Set the default target (or this month\'s target) in the settings above.' : 'The President sets the monthly target.') + ' Confirmed so far: ' + esc(K().peso(b.collected.total)) + '.</div>'
      : '<div style="font-size:13px;margin-top:8px;line-height:1.55"><div id="sk-line-sales">' + esc(sn.sales) + '</div>' +
        (sn.rating ? '<div id="sk-line-rating">' + esc(sn.rating) + '</div>' : '') +
        (sn.note ? '<div id="sk-line-note" style="color:var(--text-muted)">' + esc(sn.note) + '</div>' : '') + '</div>';
    const c = b.collected, r = b.rating;
    const pay = c.items.map(paymentRowHtml).join('') + c.refundItems.map(paymentRowHtml).join('');
    const details =
      '<div id="sk-details" class="' + (m.open ? '' : 'hidden') + '" style="margin-top:12px">' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:0 0 4px">Payments counted in ' + esc(label) + ' (' + c.items.length + ')</div>' +
        (pay || '<div style="padding:8px 0;font-size:12px;color:var(--text-muted)">No confirmed payments in ' + esc(label) + ' yet.</div>') +
        (c.refunded > 0 ? '<div style="padding:6px 0;font-size:12px;color:var(--text-muted)">Confirmed ' + esc(K().peso(c.gross)) + ' − refunds ' + esc(K().peso(c.refunded)) + ' = ' + esc(K().peso(c.total)) + ' counted.</div>' : '') +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:12px 0 4px">Client comments</div>' +
        (r.source === 'previous' ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">No ratings in ' + esc(label) + ': these are from the last 3 months.</div>' : '') +
        (r.items.length ? r.items.map(commentRowHtml).join('') : '<div style="padding:8px 0;font-size:12px;color:var(--text-muted)">No client ratings yet.</div>') +
      '</div>';
    return '<div class="card" id="sk-card" style="margin-bottom:12px">' +
      '<div class="card-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><h3 style="margin:0;display:flex;align-items:center;gap:6px"><i data-lucide="target" style="width:16px;height:16px"></i> ' + esc(m.title) + ' — ' + esc(label) + '</h3>' + (b.active ? '<span class="badge badge-green" style="font-size:10px">' + esc(USED) + '</span>' : '<span class="badge badge-orange" style="font-size:10px">' + esc(PREVIEW) + '</span>') + '</div>' +
      '<div class="card-body"><div id="sk-headline" style="' + (noTarget ? 'font-size:17px;font-weight:700;color:var(--warning)' : 'font-size:30px;font-weight:700;line-height:1.1') + '">' + esc(sn.headline) + '</div>' + lines + details +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
        '<button type="button" class="btn-secondary btn-sm" id="sk-prev" style="' + BTN + '"><i data-lucide="chevron-left" style="width:14px;height:14px"></i> Earlier month</button>' +
        '<button type="button" class="btn-secondary btn-sm" id="sk-next" style="' + BTN + '"' + (m.isCurrent ? ' disabled' : '') + '>Later month <i data-lucide="chevron-right" style="width:14px;height:14px"></i></button>' +
        '<button type="button" class="btn-secondary btn-sm" id="sk-more" style="' + BTN + '" aria-expanded="' + (m.open ? 'true' : 'false') + '">' + (m.open ? 'Hide payments and comments' : 'Show payments and comments') + '</button>' +
      '</div></div></div>';
  }
  // The compact scorecard, for a page that already has its own card around it (My Finance, js/screens/dashboards.js): the headline, the sales line and the
  // rating line (or the no-ratings note) in the one set of words. m = { words: { headline, sales, rating, note } (SalesKpi.sentence / js/pay-policy.js
  // salesKpiWords), label?: a small badge such as 'Used for pay' }. No client name, no payment list, no controls.
  function compactHtml(m) {
    const w = (m && m.words) || {};
    return '<div id="skc">' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap"><div id="skc-headline" style="font-size:28px;font-weight:700;line-height:1.1">' + esc(w.headline) + '</div>' +
      (m && m.label ? '<span class="badge badge-green" style="font-size:10px">' + esc(m.label) + '</span>' : '') + '</div>' +
      '<div style="font-size:13px;margin-top:8px;line-height:1.55"><div id="skc-sales">' + esc(w.sales) + '</div>' +
      (w.rating ? '<div id="skc-rating">' + esc(w.rating) + '</div>' : '') +
      (w.note ? '<div id="skc-note" style="color:var(--text-muted)">' + esc(w.note) + '</div>' : '') + '</div></div>';
  }
  const loadingCardHtml = (title) => '<div class="card" style="margin-bottom:12px"><div class="card-header"><h3 style="margin:0">' + esc(title) + '</h3></div><div class="card-body" style="font-size:12px;color:var(--text-muted)">Loading the scorecard…</div></div>';
  const errorCardHtml = (title, ex) => '<div class="card" style="margin-bottom:12px"><div class="card-header"><h3 style="margin:0">' + esc(title) + '</h3></div><div class="card-body" style="font-size:13px"><div style="color:var(--danger);margin-bottom:8px">Could not load the scorecard' + (ex && (ex.code || ex.message) ? ' (' + esc(ex.code || ex.message) + ')' : '') + '. Check your connection and try again.</div><button type="button" class="btn-secondary btn-sm" id="sk-retry" style="' + BTN + '">Try again</button></div></div>';

  // ── the "Client rating" row of a job, and the "waiting" list ───────────────────────────────────────────────────────────
  function ratingRowHtml(project, rating) {
    const head = '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px"><i data-lucide="star" style="width:14px;height:14px;vertical-align:-2px"></i> Client rating</div>';
    const internal = isInternal(project.company);
    const note = internal ? '' : '<div style="font-size:11px;color:var(--text-muted);margin-top:6px">Brilliance Steel jobs do not count toward the Sales KPI.</div>';
    if (!rating) {
      return head + '<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:12px;color:var(--text-muted)">Not rated yet. Ask the client how we did, then record it here.</span><button type="button" class="btn-primary btn-sm" id="sk-rate-btn" style="' + BTN + '">Rate this job</button></div>' + note + '</div></div>';
    }
    const when = fmtDay(K().dayOf(rating.approvedAt));
    return head + '<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div style="min-width:0">' + starsHtml(Number(rating.stars) || 0, 18) +
      (rating.comment ? '<div style="font-size:13px;margin-top:4px;overflow-wrap:anywhere">“' + esc(rating.comment) + '”</div>' : '') +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + esc((HEARD_LABEL[rating.heardVia] ? 'Heard by ' + HEARD_LABEL[rating.heardVia].toLowerCase() : 'Recorded by the President') + (when ? ' · counts in ' + K().monthLabel(K().monthOf(rating.approvedAt)) + ' (' + when + ')' : '')) + '</div></div>' +
      '<button type="button" class="btn-secondary btn-sm" id="sk-rate-btn" style="' + BTN + '">Edit</button></div>' + note + '</div></div>';
  }
  // Delivered-or-later jobs of the Barro companies with no rating yet, newest activity first.
  function waitingRows(projects, ratings) {
    const rated = {};
    (ratings || []).forEach((r) => { rated[r.id || r.projectId] = true; });
    return (projects || [])
      .filter((p) => p && p.id && DONE_STAGES.indexOf(p.stage) >= 0 && isInternal(p.company) && !rated[p.id])
      .sort((a, b) => (tsMs(b.updatedAt) || tsMs(b.createdAt)) - (tsMs(a.updatedAt) || tsMs(a.createdAt)));
  }
  function waitingHtml(rows) {
    const body = rows.length
      ? rows.map((p, i) => '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)"><div style="min-width:0"><div style="font-weight:600;overflow-wrap:anywhere">' + esc(p.clientName || p.name || 'Job') + '</div><div style="font-size:11px;color:var(--text-muted);overflow-wrap:anywhere">' + esc([p.projectNo, p.quoteNumber, STAGE_LABEL[p.stage]].filter(Boolean).join(' · ')) + '</div></div><button type="button" class="btn-primary btn-sm sk-rate" data-i="' + i + '" aria-label="Rate ' + esc(p.clientName || 'this job') + '" style="' + BTN + ';white-space:nowrap">Rate</button></div>').join('')
      : '<div style="padding:12px 0;font-size:12px;color:var(--text-muted)">Every delivered job has a rating. Nothing is waiting.</div>';
    return '<div class="card" style="margin-bottom:12px"><div class="card-header"><h3 style="margin:0;display:flex;align-items:center;gap:6px"><i data-lucide="star" style="width:16px;height:16px"></i> Jobs waiting for a rating (' + rows.length + ')</h3></div><div class="card-body" style="padding-top:4px">' + body +
      '<div style="' + HINT + ';margin-top:8px">A rating counts in the month you enter it. Brilliance Steel jobs are not listed: they do not count toward this KPI.</div></div></div>';
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  DATA + DOM HALF
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

  // Everything the scorecard needs, read fresh. Any failed read throws: the screen says so with a Try again button; nothing is guessed. `all` = the viewer
  // may read every rating (President / books tier); anyone else asks only for the ratings that name them (the rule that lets them read at all).
  async function loadData(uid, all) {
    const fdb = getDb();
    if (!fdb) throw new Error('Firestore is not ready');
    const ratingsQ = all ? fdb.collection('client_ratings') : fdb.collection('client_ratings').where('salesUid', '==', uid);
    const [cfgSnap, orders, claims, projects, ratings, users] = await Promise.all([
      fdb.collection('sales_kpi').doc(uid).get(),
      fdb.collection('sales_orders').where('status', '==', 'recorded').get(),
      fdb.collection('payment_claims').where('status', '==', 'recorded').get(),
      fdb.collection('job_projects').get(),
      ratingsQ.get(),
      fdb.collection('users').get(),
    ]);
    return { cfg: cfgSnap.exists ? cfgSnap.data() : null, orders: docs(orders), claims: docs(claims), refunds: refundsOf(docs(projects)), ratings: docs(ratings), users: docs(users) };
  }

  // Paints one scorecard into `host` and keeps it (month buttons, details toggle, retry). o = { uid, title, all, month? }. Returns { refresh }.
  function mountScorecard(host, o) {
    let data = null, month = o.month || curMonth(), open = false, seq = 0;
    const $ = (id) => host.querySelector('#' + id);
    const draw = () => {
      if (!data || host.isConnected === false) return;
      let b;
      try {
        b = K().compute({ cfg: data.cfg, month: month, uid: o.uid, orders: data.orders, claims: data.claims, refunds: data.refunds, ratings: data.ratings, users: data.users });
      } catch (ex) { host.innerHTML = errorCardHtml(o.title, ex); bindRetry(); return; }
      host.innerHTML = scorecardHtml({ b: b, title: o.title, month: month, isCurrent: month >= curMonth(), open: open, president: isPres() });
      icons(host);
      const on = (el, fn) => { if (el) el.addEventListener('click', fn); };
      on($('sk-prev'), () => { month = K().addMonths(month, -1); draw(); });
      on($('sk-next'), () => { if (month < curMonth()) { month = K().addMonths(month, 1); draw(); } });
      on($('sk-more'), () => { open = !open; draw(); });
    };
    const bindRetry = () => { const r = $('sk-retry'); if (r) r.addEventListener('click', load); };
    async function load() {
      const mine = ++seq;
      host.innerHTML = loadingCardHtml(o.title);
      try {
        const d = await loadData(o.uid, !!o.all);
        if (mine !== seq || host.isConnected === false) return;
        data = d; draw();
      } catch (ex) {
        if (mine !== seq || host.isConnected === false) return;
        host.innerHTML = errorCardHtml(o.title, ex); bindRetry();
      }
    }
    load();
    return { refresh: load };
  }

  // "My scorecard" at the top of the Sales page: only for the person whose OWN sales_kpi document is switched on. The first read is the gate: for anyone
  // else (or if it cannot be read) the host stays empty — no card, no error.
  async function renderMyScorecard(host) {
    if (!host) return;
    const uid = me();
    if (!uid) return;
    let snap;
    try { await ensureCore(); snap = await getDb().collection('sales_kpi').doc(uid).get(); } catch (_) { return; }
    if (host.isConnected === false || !snap.exists || snap.data().kpiSource !== 'sales') { host.innerHTML = ''; return; }
    mountScorecard(host, { uid: uid, title: 'My scorecard', all: false });
  }

  // ── Finance › Payroll & HR › Sales KPI ─────────────────────────────────────────────────────────────────────────────────
  async function renderScreen(container) {
    if (!container) return;
    const president = isPres();
    const S = { users: [], kpiDocs: {}, staff: [], sel: '', draft: null, card: null };
    const retryHtml = (ex) => '<div class="card"><div class="card-body" style="font-size:13px"><div style="color:var(--danger);margin-bottom:8px">Could not open the Sales KPI' + (ex && (ex.code || ex.message) ? ' (' + esc(ex.code || ex.message) + ')' : '') + '. Check your connection and try again.</div><button type="button" class="btn-secondary btn-sm" id="sk-retry" style="' + BTN + '">Try again</button></div></div>';
    container.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--text-muted)">Loading…</div>';
    try {
      await ensureCore();
      const fdb = getDb();
      if (!fdb) throw new Error('Firestore is not ready');
      const [us, ks] = await Promise.all([fdb.collection('users').get(), fdb.collection('sales_kpi').get()]);
      S.users = docs(us);
      ks.docs.forEach((d) => { S.kpiDocs[d.id] = d.data(); });
    } catch (ex) {
      container.innerHTML = retryHtml(ex);
      const r = container.querySelector('#sk-retry'); if (r) r.addEventListener('click', () => renderScreen(container));
      return;
    }
    if (container.isConnected === false) return;
    S.staff = staffOptions(S.users, S.kpiDocs);
    S.sel = preselect(S.users, S.staff.filter((s) => president || s.configured));
    if (!president && !S.sel) { const first = S.staff.filter((s) => s.configured); if (first.length === 1) S.sel = first[0].uid; }

    container.innerHTML =
      '<div style="margin-bottom:12px"><h3 style="margin:0;display:flex;align-items:center;gap:6px"><i data-lucide="target" style="width:18px;height:18px"></i> Sales KPI</h3>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">KPI = 70% confirmed sales + 30% client rating. Payroll uses it from the first month paid on it (set below); until then payroll still uses the task KPI and a month\'s scorecard says <strong>' + esc(PREVIEW) + '</strong>.</div></div>' +
      '<div id="sk-staff-wrap"></div><div id="sk-config"></div><div id="sk-scorecard"></div>' + (president ? '<div id="sk-waiting"></div>' : '');
    icons(container);
    const $ = (id) => container.querySelector('#' + id);
    const nameOf = (uid) => { const s = S.staff.find((x) => x.uid === uid); return s ? s.name : ''; };

    const paintPicker = () => {
      $('sk-staff-wrap').innerHTML = staffPickerHtml(S.staff, S.sel, president);
      const sel = $('sk-staff');
      if (sel) sel.addEventListener('change', () => { S.sel = sel.value; pick(); });
    };
    const paintScore = () => {
      const host = $('sk-scorecard');
      if (!S.sel) { host.innerHTML = ''; S.card = null; return; }
      S.card = mountScorecard(host, { uid: S.sel, title: nameOf(S.sel) + ' — scorecard', all: canReadAll() });
    };
    const readDraft = () => {                    // what is typed right now (kept when a month row is added or removed)
      const g = (id) => $(id);
      if (!g('sk-on')) return;
      S.draft.on = !!g('sk-on').checked;
      S.draft.startMonth = g('sk-start').value;
      S.draft.defaultTarget = g('sk-default').value;
    };
    const paintConfig = () => {
      const host = $('sk-config');
      if (!S.sel) { host.innerHTML = ''; return; }
      host.innerHTML = configHtml({ name: nameOf(S.sel), uid: S.sel, cfg: S.kpiDocs[S.sel] || null, draft: S.draft, canEdit: president });
      icons(host);
      if (!president) return;
      const fail = (m) => { const e = $('sk-err'); if (e) { e.textContent = m; e.classList.remove('hidden'); } };
      host.querySelectorAll('.sk-ovr-rm').forEach((rm) => rm.addEventListener('click', () => { readDraft(); S.draft.overrides.splice(Number(rm.dataset.i), 1); paintConfig(); }));
      const add = $('sk-ovr-add');
      if (add) add.addEventListener('click', () => {
        const mo = $('sk-ovr-month').value, amt = $('sk-ovr-amt').value;
        if (!K().isMonth(mo)) { fail('Pick the month for that target.'); return; }
        if (!(Number(str(amt).replace(/,/g, '')) > 0)) { fail('Enter a target above ₱0 for ' + K().monthLabel(mo) + '.'); return; }
        readDraft();
        S.draft.overrides = S.draft.overrides.filter((o) => o.month !== mo).concat([{ month: mo, amount: str(amt).replace(/,/g, '') }]).sort((a, b) => (a.month < b.month ? -1 : 1));
        paintConfig();
      });
      const save = $('sk-save');
      if (save) save.addEventListener('click', () => window.busy(save, async () => {
        const e = $('sk-err'); if (e) e.classList.add('hidden');
        readDraft();
        const built = buildKpiDoc(S.draft);
        if (!built.ok) { fail(built.error); return; }
        if (!isPres()) { fail('Only the President changes the Sales KPI.'); return; }
        const uid = S.sel, fdb = getDb();
        try {
          await fdb.collection('sales_kpi').doc(uid).set(Object.assign({}, built.doc, { updatedAt: FV().serverTimestamp(), updatedBy: me() }));
          const fresh = await fdb.collection('sales_kpi').doc(uid).get();
          S.kpiDocs[uid] = fresh.exists ? fresh.data() : built.doc;
        } catch (ex) { fail('Could not save: ' + (ex.message || ex.code || 'try again')); return; }
        try { if (window.logAudit) window.logAudit('update', 'sales_kpi', uid, { on: built.doc.kpiSource === 'sales', startMonth: built.doc.startMonth }); } catch (_) {}
        S.staff = staffOptions(S.users, S.kpiDocs);
        toast('Sales KPI saved for ' + nameOf(uid) + '.', 'success');
        S.draft = draftOf(S.kpiDocs[uid]);
        paintPicker(); paintConfig();
        if (S.card) S.card.refresh(); else paintScore();
      }));
    };
    const pick = () => { S.draft = S.sel ? draftOf(S.kpiDocs[S.sel]) : null; paintConfig(); paintScore(); };

    // The President's list of delivered jobs nobody has rated yet.
    const paintWaiting = async () => {
      const host = $('sk-waiting');
      if (!host) return;
      host.innerHTML = '<div class="card" style="margin-bottom:12px"><div class="card-body" style="font-size:12px;color:var(--text-muted)">Loading jobs…</div></div>';
      let rows;
      try {
        const fdb = getDb();
        const [pj, rt] = await Promise.all([fdb.collection('job_projects').get(), fdb.collection('client_ratings').get()]);
        rows = waitingRows(docs(pj), docs(rt));
      } catch (ex) {
        host.innerHTML = '<div class="card" style="margin-bottom:12px"><div class="card-body" style="font-size:13px"><div style="color:var(--danger);margin-bottom:8px">Could not load the jobs waiting for a rating' + (ex && (ex.code || ex.message) ? ' (' + esc(ex.code || ex.message) + ')' : '') + '.</div><button type="button" class="btn-secondary btn-sm" id="sk-wretry" style="' + BTN + '">Try again</button></div></div>';
        const r = host.querySelector('#sk-wretry'); if (r) r.addEventListener('click', paintWaiting);
        return;
      }
      if (host.isConnected === false) return;
      host.innerHTML = waitingHtml(rows);
      icons(host);
      host.querySelectorAll('.sk-rate').forEach((b) => b.addEventListener('click', () => openRatingSheet(rows[Number(b.dataset.i)], () => { paintWaiting(); if (S.card) S.card.refresh(); })));
    };

    paintPicker();
    pick();
    paintWaiting();
  }

  // ── Client rating (Phase A: the President enters it) ───────────────────────────────────────────────────────────────────
  // Whose sale is this rating for? The user whose sales_kpi is on, when exactly one is (Uriel today); otherwise the person who recorded the sale (the
  // order's creator, else the job's). Reads throw on a failure: a rating is never filed against a guess.
  async function resolveSalesUid(project) {
    const fdb = getDb();
    const ks = await fdb.collection('sales_kpi').get();
    const on = ks.docs.filter((d) => d.data().kpiSource === 'sales').map((d) => d.id);
    if (on.length === 1) return on[0];
    let order = null;
    if (project.salesOrderId) { const os = await fdb.collection('sales_orders').doc(project.salesOrderId).get(); order = os.exists ? os.data() : null; }
    return str((order && order.createdBy) || project.createdBy);
  }

  async function openRatingSheet(project, onDone) {
    if (!isPres()) { toast('Only the President records a client rating.', 'error'); return; }
    if (!project || !project.id) { toast('This job could not be found.', 'error'); return; }
    if (DONE_STAGES.indexOf(project.stage) < 0) { toast('A job can be rated once it is delivered.', 'error'); return; }
    const fdb = getDb();
    let prev = null;
    try { await ensureCore(); const s = await fdb.collection('client_ratings').doc(project.id).get(); prev = s.exists ? s.data() : null; }
    catch (ex) { toast('Could not open the rating: ' + (ex.message || ex.code), 'error'); return; }
    let stars = prev && Number(prev.stars) >= 1 && Number(prev.stars) <= 5 ? Number(prev.stars) : 0;
    const via0 = prev && HEARD_LABEL[prev.heardVia] ? prev.heardVia : 'call';
    const starBtn = (n) => '<button type="button" class="rt-star" data-n="' + n + '" aria-label="' + n + (n === 1 ? ' star' : ' stars') + '" aria-pressed="' + (n <= stars ? 'true' : 'false') + '" style="min-width:44px;min-height:44px;background:none;border:none;cursor:pointer;padding:0;' + starTone(n <= stars) + '"><i data-lucide="star" style="width:30px;height:30px;fill:currentColor"></i></button>';
    const body =
      '<div style="font-size:12px;margin-bottom:10px;overflow-wrap:anywhere"><strong>' + esc(project.clientName || '') + '</strong>' + (project.projectNo ? ' · ' + esc(project.projectNo) : '') + (project.quoteNumber ? ' · ' + esc(project.quoteNumber) : '') + '</div>' +
      (isInternal(project.company) ? '' : '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Brilliance Steel jobs do not count toward the Sales KPI.</div>') +
      '<div class="form-group"><label>How did the client rate us?</label><div role="group" aria-label="Stars" style="display:flex;gap:2px;flex-wrap:wrap">' + [1, 2, 3, 4, 5].map(starBtn).join('') + '</div><div id="rt-stars-label" style="' + HINT + '">' + (stars ? stars + ' of 5' : 'Tap a star') + '</div></div>' +
      '<div class="form-group"><label for="rt-note">What the client said (optional)</label><textarea id="rt-note" rows="3" maxlength="1000" style="' + FIELD + '">' + esc(prev && prev.comment) + '</textarea></div>' +
      '<div class="form-group"><label for="rt-via">How did you hear it?</label><select id="rt-via" style="' + FIELD + '">' + HEARD.map((h) => '<option value="' + h[0] + '"' + (h[0] === via0 ? ' selected' : '') + '>' + h[1] + '</option>').join('') + '</select></div>' +
      '<div id="rt-err" class="error-msg hidden" role="alert"></div>';
    const panel = window.openPage('Client rating — ' + titleText(project.clientName || 'Job'), body,
      '<button type="button" class="btn-primary" id="rt-save" style="' + BTN + '">Save rating</button><button type="button" class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Cancel</button>');
    const $ = (id) => panel.querySelector('#' + id);
    const starEls = Array.prototype.slice.call(panel.querySelectorAll('.rt-star'));
    const paintStars = () => {
      starEls.forEach((b) => {
        const n = Number(b.dataset.n);
        b.style.color = n <= stars ? GOLD : 'var(--text-muted)';
        b.style.opacity = n <= stars ? '1' : '.4';
        b.setAttribute('aria-pressed', n <= stars ? 'true' : 'false');
      });
      const l = $('rt-stars-label'); if (l) l.textContent = stars ? stars + ' of 5' : 'Tap a star';
    };
    starEls.forEach((b) => b.addEventListener('click', () => { stars = Number(b.dataset.n); paintStars(); }));
    const save = $('rt-save');
    if (save) save.addEventListener('click', () => window.busy(save, async () => {
      const err = $('rt-err');
      const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
      err.classList.add('hidden');
      if (!(Number.isInteger(stars) && stars >= 1 && stars <= 5)) { fail('Pick 1 to 5 stars.'); return; }
      const comment = str($('rt-note').value).trim();
      if (comment.length > 1000) { fail('Keep the note under 1000 characters.'); return; }
      const via = HEARD_LABEL[$('rt-via').value] ? $('rt-via').value : 'call';
      if (!isPres()) { fail('Only the President records a client rating.'); return; }
      try {
        const ref = fdb.collection('client_ratings').doc(project.id);
        const cur = await ref.get();                                    // fresh: another tab may have rated it meanwhile
        const was = cur.exists ? cur.data() : null;
        const salesUid = was && was.salesUid ? was.salesUid : await resolveSalesUid(project);
        const ts = FV().serverTimestamp();
        if (was) {
          // An edit keeps its month (approvedAt) and its owner; a rating that was waiting for approval is approved by this save.
          const patch = { stars: stars, comment: comment, heardVia: via, updatedAt: ts, updatedBy: me() };
          if (!was.salesUid && salesUid) patch.salesUid = salesUid;
          if (was.approved !== true) Object.assign(patch, { approved: true, approvedBy: me(), approvedByName: whoName(), approvedAt: ts });
          await ref.update(patch);
        } else {
          await ref.set({
            projectId: project.id, orderId: str(project.salesOrderId), clientName: str(project.clientName), quoteNumber: str(project.quoteNumber), company: str(project.company),
            salesUid: salesUid, stars: stars, comment: comment, source: 'president', heardVia: via,
            approved: true, approvedBy: me(), approvedByName: whoName(), approvedAt: ts, createdAt: ts, updatedAt: ts,
          });
        }
      } catch (ex) { fail('Could not save the rating: ' + (ex.message || ex.code || 'try again')); return; }
      try { if (window.logAudit) window.logAudit('update', 'client_rating', project.id, { stars: stars }); } catch (_) {}
      toast('Rating saved.', 'success');
      if (typeof window.closeModal === 'function') window.closeModal();
      if (typeof onDone === 'function') onDone();
    }));
  }

  // The "Client rating" row in a delivered-or-later job (President only). `onChange` runs after a rating is saved.
  async function renderJobRating(host, project, onChange) {
    if (!host || !project || !isPres()) return;
    if (DONE_STAGES.indexOf(project.stage) < 0) { host.innerHTML = ''; return; }
    let rating = null;
    try { await ensureCore(); const s = await getDb().collection('client_ratings').doc(project.id).get(); rating = s.exists ? Object.assign({ id: s.id }, s.data()) : null; }
    catch (ex) {
      host.innerHTML = '<div style="font-size:12px;color:var(--text-muted);margin:8px 0">The client rating could not load' + (ex && (ex.code || ex.message) ? ' (' + esc(ex.code || ex.message) + ')' : '') + '. <button type="button" class="btn-secondary btn-sm" id="sk-rretry" style="' + BTN + '">Try again</button></div>';
      const r = host.querySelector('#sk-rretry'); if (r) r.addEventListener('click', () => renderJobRating(host, project, onChange));
      return;
    }
    if (host.isConnected === false) return;
    host.innerHTML = ratingRowHtml(project, rating);
    icons(host);
    const b = host.querySelector('#sk-rate-btn');
    if (b) b.addEventListener('click', () => openRatingSheet(project, () => { renderJobRating(host, project, onChange); if (typeof onChange === 'function') onChange(); }));
  }

  window.SalesKpiUI = {
    PREVIEW: PREVIEW,
    renderScreen: renderScreen, renderMyScorecard: renderMyScorecard, renderJobRating: renderJobRating, openRatingSheet: openRatingSheet,
    loadData: loadData, resolveSalesUid: resolveSalesUid,
    html: { scorecard: scorecardHtml, compact: compactHtml, config: configHtml, ratingRow: ratingRowHtml, waiting: waitingHtml, stars: starsHtml, staffPicker: staffPickerHtml },
    draftOf: draftOf, buildKpiDoc: buildKpiDoc, refundsOf: refundsOf, staffOptions: staffOptions, preselect: preselect, waitingRows: waitingRows,
  };
  window.renderSalesKpi = renderScreen;
})();
