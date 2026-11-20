if (typeof window === 'undefined') globalThis.window = globalThis;
// ═══════════════════════════════════════════════════════════════════════════
//  js/sales-kpi-core.js — the Sales Manager KPI: confirmed sales (70%) + client rating (30%).
//  specs/SALES-MANAGER-KPI-SPEC-2026-11-20.md §3, §5.2, §11 (owner answers) and §12 (P5 addendum). Pure logic.
//
//  No DOM, no Firestore, no clock, no imports. Same file contract as js/sales-flow-core.js and js/payment-claims-core.js: the line above makes
//  `window` exist under plain Node so tests can require() this file; in the browser it is a no-op. It needs no other core: in the app-kit
//  (index.html) it sits after js/money-core.js / js/sales-flow-core.js and before js/departments.js, and sw.js precaches it. At CALL time it
//  reads window.bizDate (js/config.js: the one Manila-time helper) and window.isInternalQuoteCompany (the company registry) when they exist,
//  and falls back to a fixed UTC+8 day and the BK / BI list so the file runs standalone under Node.
//
//  THE KPI (owner rulings, 2026-11-20)
//    kpiScore = 0.7 × salesScore + 0.3 × satScore, rounded to 4 dp and kept between 0 and 1. Tasks do not count. Nothing here can pay more than
//    the full incentive: salesScore is capped at 1 (min(1, collected ÷ target)) and satScore is at most 5 ÷ 5.
//    salesScore = min(1, collected ÷ target), no floor. satScore = average stars ÷ 5.
//
//  WHAT COUNTS AS A SALE
//    Money the client paid that the PRESIDENT confirmed in the app, from BOTH collections:
//      • sales_orders  — the first payment of a flow-2 order (flowVersion === 2, status 'recorded');
//      • payment_claims — kind balance / progress / change_order (kind 'site_visit' is a fee, never counted; owner ruling Q16).
//    Both need paymentConfirm.decision === 'confirmed' and the VAT-inclusive recordedAmount, in the Manila month of recordedAt (fallback
//    paymentConfirm.decidedAt). WHO CONFIRMED is judged from the users roster, never from the decidedByRole text (a stamp anyone could have
//    typed): decidedBy must be a President uid, OR onBehalf === true and decidedBy a finance-tier uid that is not the payment's own createdBy
//    (Finance stands in only when the President cannot be reached, and never for a payment she recorded herself).
//    Scope 'all' (default): every Barro Kitchens / Barro Industries payment; Brilliance Steel (and any company that is not BK / BI) never counts.
//    Scope 'own': only payments the person recorded (createdBy === uid).
//    A refund (job_projects.refunds[], the cash paid back to a client) subtracts in the Manila month of its date, and a month's total never goes
//    below 0.
//    TODO(owner, Q14): a DOWNWARD REVISION is not subtracted here. js/contract-core.js planApply leaves payments untouched, so a revision moves
//    no cash; its cash effect is client credit, which is paid back as a refund (counted above). Subtracting the revision as well would count
//    the same pesos twice. Left for the owner to say whether a revision that creates unrefunded credit should also reduce the month.
//
//  WHAT COUNTS AS A RATING
//    A client_ratings doc with approved === true and 1–5 stars, in the Manila month of approvedAt. A month with no ratings uses the pooled
//    average of the approved ratings of the previous 3 months; with none there either, the KPI is the sales score only ('sales-only').
//
//  Functions: isActive, targetFor, rosterFromUsers, monthOf, dayOf, addMonths, monthLabel, confirmedCollections, satisfaction, score, peso, sentence, compute.
//  Every rule has a test, mutation-checked in tests/sales-kpi-core.test.mjs.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const WEIGHTS = Object.freeze({ sales: 0.7, satisfaction: 0.3 });
  const COUNTED_KINDS = Object.freeze(['balance', 'progress', 'change_order']);
  const KIND_LABELS = Object.freeze({ first: 'First payment', balance: 'Balance', progress: 'Progress payment', change_order: 'Change-order down payment' });
  const FALLBACK_MONTHS = 3;
  // The internal (Barro-owned) company codes — a mirror of window.QUOTE_COMPANIES' `internal` flags (js/config.js); tests pin the two together.
  const INTERNAL_COMPANIES = Object.freeze(['BK', 'BI']);
  const MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

  const num = function (n) { const x = Number(n); return isFinite(x) ? x : 0; };
  const r2 = function (n) { return Math.round((n + Number.EPSILON) * 100) / 100; };
  const r4 = function (n) { return Math.round((n + Number.EPSILON) * 10000) / 10000; };
  const clamp01 = function (n) { return n < 0 ? 0 : n > 1 ? 1 : n; };
  const has = function (list, v) { return Array.isArray(list) && list.indexOf(v) >= 0; };
  const pad = function (n, w) { return String(n).padStart(w, '0'); };
  const str = function (v) { return v == null ? '' : String(v); };

  // ── months and Manila time ─────────────────────────────────────────────────────────────────────────────────────
  const isMonth = function (m) { return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m); };
  // 'YYYY-MM' + n months ('' when the input is not a month).
  function addMonths(m, n) {
    if (!isMonth(m)) return '';
    const idx = Number(m.slice(0, 4)) * 12 + (Number(m.slice(5, 7)) - 1) + n;
    const y = Math.floor(idx / 12);
    return pad(y, 4) + '-' + pad(idx - y * 12 + 1, 2);
  }
  function monthLabel(m) { return isMonth(m) ? MONTH_NAMES[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4) : ''; }

  // A Firestore Timestamp, a plain {seconds}/{_seconds} (cached reads serialise a Timestamp down to that), a Date, epoch ms or an ISO string -> Date | null.
  function toDate(ts) {
    if (ts == null || ts === '') return null;
    let d = null;
    if (typeof ts === 'number' || typeof ts === 'string') d = new Date(ts);
    else if (typeof ts === 'object') {
      if (Object.prototype.toString.call(ts) === '[object Date]') d = ts;
      else if (typeof ts.toDate === 'function') { try { d = ts.toDate(); } catch (_) { return null; } }
      else if (typeof ts.seconds === 'number' || typeof ts._seconds === 'number') {
        const s = typeof ts.seconds === 'number' ? ts.seconds : ts._seconds;
        const ns = num(typeof ts.nanoseconds === 'number' ? ts.nanoseconds : ts._nanoseconds);
        d = new Date(s * 1000 + Math.floor(ns / 1e6));
      }
    }
    return d && isFinite(d.getTime()) ? d : null;
  }
  // The Manila calendar day of an instant, 'YYYY-MM-DD'. window.bizDate is THE app helper (js/config.js); the fixed +8h day is the standalone
  // fallback (the Philippines has no daylight saving).
  function manilaDay(d) {
    if (typeof window.bizDate === 'function') {
      const s = str(window.bizDate(d));
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    }
    const t = new Date(d.getTime() + 8 * 3600 * 1000);
    return pad(t.getUTCFullYear(), 4) + '-' + pad(t.getUTCMonth() + 1, 2) + '-' + pad(t.getUTCDate(), 2);
  }
  // A plain 'YYYY-MM-DD' (a refund's typed date) is already a Manila calendar day; anything else is an instant.
  function manilaDate(ts) {
    if (typeof ts === 'string') {
      const m = /^(\d{4}-\d{2}-\d{2})$/.exec(ts.trim());
      if (m) return isMonth(m[1].slice(0, 7)) ? m[1] : '';
    }
    const d = toDate(ts);
    return d ? manilaDay(d) : '';
  }
  function monthOf(ts) { const m = manilaDate(ts).slice(0, 7); return isMonth(m) ? m : ''; }
  const dayOf = manilaDate;   // 'YYYY-MM-DD' of an instant in Manila ('' when unreadable): what a scorecard prints as "confirmed on"

  // ── the switch and the target ──────────────────────────────────────────────────────────────────────────────────
  // sales_kpi/{uid} = { kpiSource:'sales', startMonth:'YYYY-MM', weights, targets:{'YYYY-MM': pesos}, defaultTarget: pesos|null, scope:'all'|'own', ... }
  // Active only when switched on AND the month has reached startMonth. No (or a malformed) startMonth is never active: pay must not switch by accident.
  function isActive(cfg, month) {
    return !!cfg && cfg.kpiSource === 'sales' && isMonth(cfg.startMonth) && isMonth(month) && month >= cfg.startMonth;
  }
  // The month's own target if it is above 0, else the default if that is above 0, else null (nothing is invented).
  function targetFor(cfg, month) {
    if (!cfg) return null;
    const own = cfg.targets && Object.prototype.hasOwnProperty.call(cfg.targets, month) ? Number(cfg.targets[month]) : NaN;
    if (isFinite(own) && own > 0) return own;
    const def = cfg.defaultTarget == null || cfg.defaultTarget === '' ? NaN : Number(cfg.defaultTarget);
    return isFinite(def) && def > 0 ? def : null;
  }

  // ── the users roster: who is a President, who is finance-tier ──────────────────────────────────────────────────
  // users = [{ id|uid, role, department, departments }]. Finance-tier mirrors the app's isFinanceTier (js/departments.js): the finance role, or a
  // member of the Finance department who is not the Corporate Secretary. Removed people stay: what they confirmed while employed still stands.
  function rosterFromUsers(users) {
    const presidentUids = [], financeUids = [];
    (Array.isArray(users) ? users : []).forEach(function (u) {
      const uid = u && (u.id || u.uid);
      if (!uid) return;
      const role = str(u.role);
      if (role === 'president') presidentUids.push(uid);
      const depts = [].concat(u.department || [], Array.isArray(u.departments) ? u.departments : []);
      if (role === 'finance' || (role !== 'secretary' && has(depts, 'Finance'))) financeUids.push(uid);
    });
    return { presidentUids: presidentUids, financeUids: financeUids };
  }

  // Who confirmed this payment? { ok:true, via:'president'|'stand-in' } or { ok:false, reason }. The uid is checked against the roster; decidedByRole is ignored.
  function confirmer(doc, roster) {
    const pc = (doc && doc.paymentConfirm) || {};
    const by = pc.decidedBy;
    if (!by || typeof by !== 'string') return { ok: false, reason: 'not-president' };
    if (has(roster && roster.presidentUids, by)) return { ok: true, via: 'president' };
    if (pc.onBehalf === true && has(roster && roster.financeUids, by) && by !== doc.createdBy) return { ok: true, via: 'stand-in' };
    return { ok: false, reason: 'not-president' };
  }

  // ── scope ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const defaultIsInternal = function (co) { return INTERNAL_COMPANIES.indexOf(co) >= 0; };
  function internalFn(opts) {
    if (opts && typeof opts.isInternal === 'function') return opts.isInternal;
    if (typeof window.isInternalQuoteCompany === 'function') return window.isInternalQuoteCompany;
    return defaultIsInternal;
  }
  // The company a record belongs to: its own `company`, else (a payment claim) the company of the order it belongs to, else '' (unknown, never internal).
  function companyOf(doc, ordersById) {
    const own = str(doc && doc.company);
    if (own) return own;
    const o = doc && doc.orderId && ordersById ? ordersById[doc.orderId] : null;
    return o ? str(o.company) : '';
  }
  // Brilliance Steel (and anything that is not a Barro Kitchens / Barro Industries record) never counts. 'own' additionally needs the person's own record.
  function inScope(doc, ctx) {
    if (!ctx.isInternal(companyOf(doc, ctx.ordersById))) return false;
    if (ctx.scope === 'own') return !!ctx.uid && doc.createdBy === ctx.uid;
    return true;
  }

  // ── confirmed collections ──────────────────────────────────────────────────────────────────────────────────────
  const no = function (reason) { return { ok: false, reason: reason }; };

  // One payment doc against the rules. source = 'order' | 'claim'. The first failing rule names the reason.
  function evaluatePayment(doc, source, ctx) {
    doc = doc || {};
    if (source === 'order') {
      if (doc.flowVersion !== 2) return no('legacy');
    } else {
      if (doc.kind === 'site_visit') return no('site-visit');
      if (COUNTED_KINDS.indexOf(doc.kind) < 0) return no('kind');
    }
    if (doc.status !== 'recorded') return no('not-recorded');
    const pc = doc.paymentConfirm || {};
    if (pc.decision !== 'confirmed') return no('not-confirmed');
    const who = confirmer(doc, ctx.roster);
    if (!who.ok) return no(who.reason);
    const amount = r2(num(doc.recordedAmount));
    if (!(amount > 0)) return no('no-amount');
    if (!inScope(doc, ctx)) return no('out-of-scope');
    const date = manilaDate(doc.recordedAt) || manilaDate(pc.decidedAt);
    if (!date) return no('no-date');
    if (date.slice(0, 7) !== ctx.month) return no('other-month');
    const kind = source === 'order' ? 'first' : doc.kind;
    return {
      ok: true,
      item: {
        source: source, id: str(doc.id), orderId: str(source === 'order' ? doc.id : doc.orderId), projectId: str(doc.projectId),
        clientName: str(doc.clientName), quoteNumber: str(doc.quoteNumber), kind: kind, kindLabel: KIND_LABELS[kind],
        amount: amount, date: date, month: date.slice(0, 7), standIn: who.via === 'stand-in', company: companyOf(doc, ctx.ordersById),
      },
    };
  }

  // A refund = cash paid back to a client, { id, projectId, clientName, quoteNumber, company, createdBy, amount, date }.
  function evaluateRefund(rf, ctx) {
    rf = rf || {};
    const amount = r2(num(rf.amount));
    if (!(amount > 0)) return no('no-amount');
    if (!inScope(rf, ctx)) return no('out-of-scope');
    const date = manilaDate(rf.date);
    if (!date) return no('no-date');
    if (date.slice(0, 7) !== ctx.month) return no('other-month');
    return {
      ok: true,
      item: { source: 'refund', id: str(rf.id), projectId: str(rf.projectId), clientName: str(rf.clientName), quoteNumber: str(rf.quoteNumber), kind: 'refund', kindLabel: 'Refund', amount: amount, date: date, month: date.slice(0, 7), standIn: false, company: companyOf(rf, ctx.ordersById) },
    };
  }

  // opts = { month, claims, refunds, roster | presidentUids + financeUids, scope, uid, isInternal }
  // → { month, scope, gross, refunded, total, items, refundItems, skipped }. `total` = max(0, gross − refunded). `skipped` lists every doc that failed a rule
  // other than "another month" ({ source, id, reason }) so a screen can say why a payment is not counted.
  function confirmedCollections(orders, opts) {
    opts = opts || {};
    if (!isMonth(opts.month)) throw new Error('confirmedCollections: month must be YYYY-MM');
    const orderList = Array.isArray(orders) ? orders : [];
    const ordersById = {};
    orderList.forEach(function (o) { if (o && o.id) ordersById[o.id] = o; });
    const ctx = {
      month: opts.month,
      roster: opts.roster || { presidentUids: opts.presidentUids || [], financeUids: opts.financeUids || [] },
      scope: opts.scope === 'own' ? 'own' : 'all', uid: str(opts.uid), isInternal: internalFn(opts), ordersById: ordersById,
    };
    const items = [], refundItems = [], skipped = [];
    const take = function (list, source, evaluate, into) {
      (Array.isArray(list) ? list : []).forEach(function (doc) {
        const res = evaluate(doc, source, ctx);
        if (res.ok) into.push(res.item);
        else if (res.reason !== 'other-month') skipped.push({ source: source, id: str(doc && doc.id), reason: res.reason });
      });
    };
    take(orderList, 'order', evaluatePayment, items);
    take(opts.claims, 'claim', evaluatePayment, items);
    take(opts.refunds, 'refund', function (doc) { return evaluateRefund(doc, ctx); }, refundItems);
    const byDate = function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; };
    items.sort(byDate); refundItems.sort(byDate);
    const gross = r2(items.reduce(function (s, x) { return s + x.amount; }, 0));
    const refunded = r2(refundItems.reduce(function (s, x) { return s + x.amount; }, 0));
    return { month: opts.month, scope: ctx.scope, gross: gross, refunded: refunded, total: Math.max(0, r2(gross - refunded)), items: items, refundItems: refundItems, skipped: skipped };
  }

  // ── client satisfaction ────────────────────────────────────────────────────────────────────────────────────────
  // ratings = client_ratings docs { id|projectId, clientName, quoteNumber, company, salesUid, stars, comment, source, heardVia, approved, approvedAt }.
  // opts = { month, scope, uid, isInternal }. A rating counts when approved === true, stars is a whole number 1–5, it is in scope and approvedAt has a Manila month.
  // → { month, source:'month'|'previous'|'none', n, avg, score, months, items }. `score` = avg ÷ 5; items are the ratings that count, oldest first.
  function satisfaction(ratings, opts) {
    opts = opts || {};
    if (!isMonth(opts.month)) throw new Error('satisfaction: month must be YYYY-MM');
    const ctx = { scope: opts.scope === 'own' ? 'own' : 'all', uid: str(opts.uid), isInternal: internalFn(opts), ordersById: null };
    const pool = [];
    (Array.isArray(ratings) ? ratings : []).forEach(function (r) {
      if (!r || r.approved !== true) return;
      const stars = r.stars;
      if (typeof stars !== 'number' || stars % 1 !== 0 || stars < 1 || stars > 5) return;
      // 'own' means "the ratings given for this person's sales": the rating carries the person as salesUid.
      if (!ctx.isInternal(str(r.company))) return;
      if (ctx.scope === 'own' && (!ctx.uid || r.salesUid !== ctx.uid)) return;
      const date = manilaDate(r.approvedAt);
      if (!date) return;
      pool.push({
        id: str(r.id || r.projectId), clientName: str(r.clientName), quoteNumber: str(r.quoteNumber), stars: stars, comment: str(r.comment).trim(),
        heardVia: str(r.heardVia), source: str(r.source), date: date, month: date.slice(0, 7),
      });
    });
    pool.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    const build = function (source, list, months) {
      const avg = list.reduce(function (s, x) { return s + x.stars; }, 0) / list.length;
      return { month: opts.month, source: source, n: list.length, avg: avg, score: avg / 5, months: months, items: list };
    };
    const inMonth = pool.filter(function (x) { return x.month === opts.month; });
    if (inMonth.length) return build('month', inMonth, [opts.month]);
    const previous = [];
    for (let i = 1; i <= FALLBACK_MONTHS; i++) previous.push(addMonths(opts.month, -i));
    const earlier = pool.filter(function (x) { return previous.indexOf(x.month) >= 0; });
    if (earlier.length) return build('previous', earlier, previous);
    return { month: opts.month, source: 'none', n: 0, avg: null, score: null, months: previous, items: [] };
  }

  // ── the score ──────────────────────────────────────────────────────────────────────────────────────────────────
  // a = { collected, target, avgStars (null = no ratings), weights? }. Without a target nothing is invented: { ok:false, mode:'no-target' }.
  // Without ratings the KPI is the sales score alone ('sales-only'); otherwise 'blend'.
  function score(a) {
    a = a || {};
    const w = a.weights && isFinite(Number(a.weights.sales)) && isFinite(Number(a.weights.satisfaction))
      ? { sales: Number(a.weights.sales), satisfaction: Number(a.weights.satisfaction) }
      : { sales: WEIGHTS.sales, satisfaction: WEIGHTS.satisfaction };
    const target = Number(a.target);
    if (!(target > 0)) return { ok: false, mode: 'no-target', kpiScore: null, salesScore: null, satScore: null, weights: w };
    const collected = Math.max(0, num(a.collected));
    const salesScore = Math.min(1, collected / target);
    const stars = a.avgStars == null || a.avgStars === '' ? NaN : Number(a.avgStars);
    if (!isFinite(stars)) return { ok: true, mode: 'sales-only', kpiScore: r4(clamp01(salesScore)), salesScore: salesScore, satScore: null, weights: w };
    const satScore = clamp01(stars / 5);
    return { ok: true, mode: 'blend', kpiScore: r4(clamp01(w.sales * salesScore + w.satisfaction * satScore)), salesScore: salesScore, satScore: satScore, weights: w };
  }

  // ── plain words (spec §5.4) ────────────────────────────────────────────────────────────────────────────────────
  const pct = function (x) { return Math.round(Number((x * 100).toFixed(6))) + '%'; };
  function peso(n) {
    const v = r2(num(n));
    const parts = Math.abs(v).toFixed(2).split('.');
    return (v < 0 ? '-' : '') + '₱' + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
  }
  // b = the breakdown compute() returns. → { headline, sales, rating, note, lines } — plain text, nothing to escape here (the screen escapes).
  function sentence(b) {
    b = b || {};
    const sc = b.score || {};
    const label = monthLabel(b.month);
    if (sc.mode === 'no-target' || !b.score) {
      const t = 'No target set for ' + label;
      return { headline: t, sales: '', rating: '', note: '', lines: [t] };
    }
    const blend = sc.mode === 'blend';
    const w = sc.weights || WEIGHTS;
    const collected = b.collected ? b.collected.total : 0;
    const headline = 'KPI ' + pct(sc.kpiScore);
    const sales = 'Sales: ' + peso(collected) + ' confirmed of ' + peso(b.target) + ' target = ' + pct(sc.salesScore) + ' (counts ' + (blend ? pct(w.sales) : '100%') + ')';
    let rating = '', note = '';
    const r = b.rating || {};
    if (blend) {
      const clients = r.n + (r.n === 1 ? ' client' : ' clients');
      const stars = Number(r.avg).toFixed(1) + ' of 5 from ' + clients + ' = ' + pct(sc.satScore) + ' (counts ' + pct(w.satisfaction) + ')';
      rating = r.source === 'previous'
        ? 'Client rating: no ratings this month, so the last 3 months count: ' + stars
        : 'Client rating: ' + stars;
    } else {
      note = 'No client ratings this month, so the KPI is the sales score only.';
    }
    return { headline: headline, sales: sales, rating: rating, note: note, lines: [headline, sales].concat(rating ? [rating] : [], note ? [note] : []) };
  }

  // ── everything at once ─────────────────────────────────────────────────────────────────────────────────────────
  // a = { cfg, month, uid, orders, claims, refunds, ratings, users | roster, isInternal? } → the full breakdown a scorecard shows. Nothing is read or written here.
  function compute(a) {
    a = a || {};
    if (!isMonth(a.month)) throw new Error('compute: month must be YYYY-MM');
    const cfg = a.cfg || null;
    const roster = a.roster || rosterFromUsers(a.users);
    const scope = cfg && cfg.scope === 'own' ? 'own' : 'all';
    const collected = confirmedCollections(a.orders, { month: a.month, claims: a.claims, refunds: a.refunds, roster: roster, scope: scope, uid: a.uid, isInternal: a.isInternal });
    const rating = satisfaction(a.ratings, { month: a.month, scope: scope, uid: a.uid, isInternal: a.isInternal });
    const target = targetFor(cfg, a.month);
    const sc = score({ collected: collected.total, target: target, avgStars: rating.source === 'none' ? null : rating.avg });
    const b = {
      month: a.month, configured: !!cfg, on: !!cfg && cfg.kpiSource === 'sales', startMonth: cfg && isMonth(cfg.startMonth) ? cfg.startMonth : '',
      active: isActive(cfg, a.month), target: target, collected: collected, rating: rating, score: sc,
    };
    b.sentence = sentence(b);
    return b;
  }

  window.SalesKpi = {
    WEIGHTS: WEIGHTS,
    COUNTED_KINDS: COUNTED_KINDS,
    FALLBACK_MONTHS: FALLBACK_MONTHS,
    INTERNAL_COMPANIES: INTERNAL_COMPANIES,
    isMonth: isMonth,
    addMonths: addMonths,
    monthLabel: monthLabel,
    monthOf: monthOf,
    dayOf: dayOf,
    isActive: isActive,
    targetFor: targetFor,
    rosterFromUsers: rosterFromUsers,
    confirmedCollections: confirmedCollections,
    satisfaction: satisfaction,
    score: score,
    peso: peso,
    sentence: sentence,
    compute: compute,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.SalesKpi;
