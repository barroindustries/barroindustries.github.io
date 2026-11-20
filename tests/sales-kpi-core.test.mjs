// tests/sales-kpi-core.test.mjs — the Sales Manager KPI, pure core (specs/SALES-MANAGER-KPI-SPEC-2026-11-20.md §3, §5.2, §8, §11 owner answers, §12 P5 addendum).
//
// js/sales-kpi-core.js: which payments count (President-confirmed, both sales_orders and payment_claims, VAT-inclusive recordedAmount, Manila month of
// recordedAt), who counts as having confirmed (a President uid, or Finance standing in — judged from the users roster, never from role text), what a
// rating is, and the 70/30 score. This is MONEY logic (it will drive an incentive): every rule below is mutation-tested in a scratch copy — the list
// and results are in the hand-back that came with this file (cap, weights, President / stand-in check, site_visit exclusion, month boundary, and more).
//
// Loads js/sales-kpi-core.js alone (it needs nothing else) exactly as the app-kit does after money-core.js / sales-flow-core.js.
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const K = require('../js/sales-kpi-core.js');
const SOURCE = fs.readFileSync(new URL('../js/sales-kpi-core.js', import.meta.url), 'utf8');
const CONFIG = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────
const USERS = [
  { id: 'u-pres', role: 'president' },
  { id: 'u-fin', role: 'finance', departments: ['Finance'] },
  { id: 'u-fin2', role: 'employee', department: 'Finance' },
  { id: 'u-fin3', role: 'employee', departments: ['Sales', 'Finance'] },
  { id: 'u-sec', role: 'secretary', department: 'Finance' },      // the Corporate Secretary is never finance-tier
  { id: 'u-mgr', role: 'manager' },
  { id: 'u-sales', role: 'employee', departments: ['Sales'] },
];
const ROSTER = K.rosterFromUsers(USERS);
const ts = (iso) => ({ seconds: Math.floor(Date.parse(iso) / 1000), toDate: () => new Date(iso) });   // what a Firestore Timestamp looks like
const stamp = (over = {}) => ({ decision: 'confirmed', decidedBy: 'u-pres', decidedByName: 'Neil Barro', decidedByRole: 'president', decidedAt: '2026-11-20T02:00:00.000Z', onBehalf: false, ...over });
const order = (over = {}) => ({
  id: 'o1', flowVersion: 2, status: 'recorded', company: 'BK', clientName: 'Acme Foods', quoteNumber: 'BK-1', createdBy: 'u-sales',
  paymentReceived: 65000, recordedAmount: 65000, recordedAt: ts('2026-11-20T02:00:00.000Z'), paymentConfirm: stamp(), ...over,
});
const claim = (over = {}) => ({
  id: 'c1', kind: 'balance', status: 'recorded', company: 'BK', clientName: 'Acme Foods', orderId: 'o1', projectId: 'p1', createdBy: 'u-sales',
  paymentReceived: 35000, recordedAmount: 35000, recordedAt: ts('2026-11-21T03:00:00.000Z'), paymentConfirm: stamp(), ...over,
});
const refund = (over = {}) => ({ id: 'rf1', projectId: 'p1', clientName: 'Acme Foods', company: 'BK', createdBy: 'u-sales', amount: 5000, date: '2026-11-25', ...over });
const rating = (over = {}) => ({ id: 'p1', projectId: 'p1', clientName: 'Acme Foods', company: 'BK', salesUid: 'u-sales', stars: 5, comment: 'Great job', source: 'president', heardVia: 'call', approved: true, approvedAt: ts('2026-11-22T04:00:00.000Z'), ...over });
const NOV = '2026-11';
const collect = (orders, claims = [], extra = {}) => K.confirmedCollections(orders, { month: NOV, claims, roster: ROSTER, ...extra });
const totalOf = (orders, claims, extra) => collect(orders, claims, extra).total;
const reasons = (res) => Object.fromEntries(res.skipped.map((s) => [s.id, s.reason]));
const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the module itself', () => {
  it('exposes exactly the documented members and nothing else', () => {
    assert.deepEqual(Object.keys(K).sort(), [
      'COUNTED_KINDS', 'FALLBACK_MONTHS', 'INTERNAL_COMPANIES', 'WEIGHTS', 'addMonths', 'compute', 'confirmedCollections', 'dayOf', 'isActive', 'isMonth',
      'monthLabel', 'monthOf', 'peso', 'rosterFromUsers', 'satisfaction', 'score', 'sentence', 'targetFor',
    ]);
    assert.equal(globalThis.window.SalesKpi, K);
  });
  it('keeps the file contract: shim on line 1, module.exports at the end, no DOM / Firestore / clock / raw UTC month', () => {
    assert.equal(SOURCE.split('\n')[0], "if (typeof window === 'undefined') globalThis.window = globalThis;");
    assert.ok(/if \(typeof module !== 'undefined' && module\.exports\) module\.exports = window\.SalesKpi;\s*$/.test(SOURCE));
    for (const banned of ['document.', 'firebase', 'db.collection', 'Date.now', 'localStorage', 'innerHTML', 'toISOString', 'new Date()']) {
      assert.ok(!SOURCE.includes(banned), `the core must stay pure, but mentions ${banned}`);
    }
  });
  it('does not touch payroll: it names none of the pay engine\'s functions (rollout step 6 is separate)', () => {
    for (const banned of ['buildPayRunLines', 'computePayLine', 'computeKpiForMonth', 'kpiBreakdown', 'kpi_targets', 'pay_runs']) {
      assert.ok(!SOURCE.includes(banned), `the core must not reach into payroll (${banned})`);
    }
  });
  it('the weights are the owner\'s 70 / 30 and frozen; the counted claim kinds are balance, progress, change_order (never site_visit)', () => {
    assert.deepEqual({ ...K.WEIGHTS }, { sales: 0.7, satisfaction: 0.3 });
    assert.ok(Object.isFrozen(K.WEIGHTS) && Object.isFrozen(K.COUNTED_KINDS));
    assert.deepEqual([...K.COUNTED_KINDS], ['balance', 'progress', 'change_order']);
    assert.equal(K.FALLBACK_MONTHS, 3);
  });
  it('its internal-company list is exactly the registry\'s: BK and BI (js/config.js QUOTE_COMPANIES, internal:true)', () => {
    const block = CONFIG.slice(CONFIG.indexOf('window.QUOTE_COMPANIES = {'), CONFIG.indexOf('};', CONFIG.indexOf('window.QUOTE_COMPANIES = {')));
    const internal = [...block.matchAll(/\b([A-Z]{2}):\s*\{[^}]*internal:\s*true/g)].map((m) => m[1]).sort();
    assert.deepEqual(internal, ['BI', 'BK']);
    assert.deepEqual([...K.INTERNAL_COMPANIES].sort(), internal);
  });
  it('never changes what it is given (inputs may be frozen)', () => {
    const o = deepFreeze([order(), order({ id: 'o2', paymentConfirm: stamp({ decidedBy: 'u-sales' }) })]);
    const c = deepFreeze([claim(), claim({ id: 'c2', kind: 'site_visit' })]);
    const rf = deepFreeze([refund()]);
    const rt = deepFreeze([rating(), rating({ id: 'p2', stars: 2 })]);
    const users = deepFreeze(USERS.map((u) => ({ ...u })));
    const cfg = deepFreeze({ kpiSource: 'sales', startMonth: '2027-01', defaultTarget: 100000, targets: { '2026-11': 120000 }, weights: { sales: 0.7, satisfaction: 0.3 }, scope: 'all' });
    assert.doesNotThrow(() => K.compute({ cfg, month: NOV, uid: 'u-sales', orders: o, claims: c, refunds: rf, ratings: rt, users }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('months and Manila time (the month boundary decides which month a payment counts in)', () => {
  it('monthOf: the Manila month of an instant — one millisecond before and at midnight Manila', () => {
    assert.equal(K.monthOf('2026-11-30T15:59:59.999Z'), '2026-11');   // 23:59:59.999 on 30 Nov in Manila
    assert.equal(K.monthOf('2026-11-30T16:00:00.000Z'), '2026-12');   // 00:00:00 on 1 Dec in Manila
    assert.equal(K.monthOf('2026-12-31T15:59:59.999Z'), '2026-12');
    assert.equal(K.monthOf('2026-12-31T16:00:00.000Z'), '2027-01');   // the year boundary
    assert.equal(K.monthOf('2026-10-31T16:00:00.000Z'), '2026-11');
    assert.equal(K.monthOf('2027-01-01T00:00:00.000Z'), '2027-01');   // 08:00 on 1 Jan in Manila
  });
  it('monthOf: reads a Timestamp, {seconds}, {_seconds}, a Date, epoch ms and a plain Manila date', () => {
    const iso = '2026-11-30T16:30:00.000Z';                           // 1 Dec, 00:30 in Manila
    assert.equal(K.monthOf(ts(iso)), '2026-12');
    assert.equal(K.monthOf({ seconds: Date.parse(iso) / 1000 }), '2026-12');
    assert.equal(K.monthOf({ _seconds: Date.parse(iso) / 1000, _nanoseconds: 0 }), '2026-12');
    assert.equal(K.monthOf(new Date(iso)), '2026-12');
    assert.equal(K.monthOf(Date.parse(iso)), '2026-12');
    assert.equal(K.monthOf('2026-11-30'), '2026-11');                 // a typed date is already a Manila day: no timezone shift
    assert.equal(K.monthOf('2026-12-01'), '2026-12');
  });
  it('dayOf: the Manila calendar day of an instant (what a scorecard prints as "confirmed on"); "" when unreadable', () => {
    assert.equal(K.dayOf('2026-11-30T15:59:59.999Z'), '2026-11-30');
    assert.equal(K.dayOf('2026-11-30T16:00:00.000Z'), '2026-12-01');
    assert.equal(K.dayOf(ts('2026-11-20T02:00:00.000Z')), '2026-11-20');
    assert.equal(K.dayOf('2026-11-30'), '2026-11-30');
    assert.equal(K.dayOf(undefined), '');
    assert.equal(K.dayOf('soon'), '');
  });
  it('monthOf: anything unreadable is "" (never a guess, never today)', () => {
    for (const bad of [null, undefined, '', 'soon', {}, [], NaN, '2026-13-01', '2026-00-10', { seconds: 'x' }, { toDate() { throw new Error('boom'); } }]) assert.equal(K.monthOf(bad), '', JSON.stringify(bad));
  });
  it('uses the app\'s own window.bizDate when it exists (js/config.js is THE Manila-time helper) and falls back to a fixed +8h day otherwise', () => {
    const saved = globalThis.bizDate;
    try {
      globalThis.bizDate = () => '2099-04-15';
      assert.equal(K.monthOf('2026-11-20T02:00:00.000Z'), '2099-04');
      assert.equal(K.monthOf('2026-11-30'), '2026-11', 'a typed Manila date is already a Manila day: it never goes through the time helper');
      globalThis.bizDate = () => 'not a date';                         // a broken helper never leaks through
      assert.equal(K.monthOf('2026-11-30T16:00:00.000Z'), '2026-12');
    } finally { if (saved === undefined) delete globalThis.bizDate; else globalThis.bizDate = saved; }
    assert.equal(K.monthOf('2026-11-30T16:00:00.000Z'), '2026-12');
  });
  it('addMonths: forwards, backwards, across a year; "" for a non-month', () => {
    assert.equal(K.addMonths('2027-01', -1), '2026-12');
    assert.equal(K.addMonths('2027-01', -3), '2026-10');
    assert.equal(K.addMonths('2026-12', 1), '2027-01');
    assert.equal(K.addMonths('2026-11', 0), '2026-11');
    assert.equal(K.addMonths('2026-03', -14), '2025-01');
    for (const bad of ['', '2026', '2026-13', null, undefined, 5]) assert.equal(K.addMonths(bad, 1), '');
  });
  it('isMonth and monthLabel', () => {
    assert.ok(K.isMonth('2026-11') && K.isMonth('2027-01') && !K.isMonth('2026-13') && !K.isMonth('2026-1') && !K.isMonth('2026-11-01') && !K.isMonth(202611) && !K.isMonth(null));
    assert.equal(K.monthLabel('2026-11'), 'November 2026');
    assert.equal(K.monthLabel('2027-01'), 'January 2027');
    assert.equal(K.monthLabel('nope'), '');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('isActive and targetFor (the sales_kpi/{uid} document)', () => {
  const cfg = (over = {}) => ({ kpiSource: 'sales', startMonth: '2027-01', defaultTarget: 100000, targets: {}, ...over });
  it('active only when switched on AND the month has reached startMonth', () => {
    assert.equal(K.isActive(cfg(), '2026-12'), false);   // December is the preview month
    assert.equal(K.isActive(cfg(), '2027-01'), true);    // January 2027 is the first paid month
    assert.equal(K.isActive(cfg(), '2027-02'), true);
    assert.equal(K.isActive(cfg({ kpiSource: 'tasks' }), '2027-02'), false);
    assert.equal(K.isActive(cfg({ kpiSource: undefined }), '2027-02'), false);
  });
  it('no document, a malformed startMonth or a malformed month is never active (pay must not switch by accident)', () => {
    assert.equal(K.isActive(null, '2027-01'), false);
    assert.equal(K.isActive(undefined, '2027-01'), false);
    assert.equal(K.isActive(cfg({ startMonth: undefined }), '2027-01'), false);
    assert.equal(K.isActive(cfg({ startMonth: '2027-1' }), '2027-01'), false);
    assert.equal(K.isActive(cfg(), '2027-1'), false);
    assert.equal(K.isActive(cfg(), undefined), false);
  });
  it('targetFor: a month\'s own target wins over the default', () => {
    assert.equal(K.targetFor(cfg({ targets: { '2026-12': 150000 } }), '2026-12'), 150000);
    assert.equal(K.targetFor(cfg({ targets: { '2026-12': 150000 } }), '2027-01'), 100000);
    assert.equal(K.targetFor(cfg({ targets: { '2026-12': '150000' } }), '2026-12'), 150000);
  });
  it('targetFor: an override that is not above 0 falls back to the default; no default means null — nothing is invented', () => {
    for (const bad of [0, -5, null, '', 'abc', NaN, undefined]) assert.equal(K.targetFor(cfg({ targets: { '2026-12': bad } }), '2026-12'), 100000, String(bad));
    for (const bad of [null, undefined, '', 0, -1, 'abc']) assert.equal(K.targetFor(cfg({ defaultTarget: bad }), '2026-12'), null, String(bad));
    assert.equal(K.targetFor(cfg({ defaultTarget: null, targets: { '2026-12': 90000 } }), '2026-12'), 90000);
    assert.equal(K.targetFor(cfg({ defaultTarget: null, targets: { '2026-12': 90000 } }), '2027-01'), null);
    assert.equal(K.targetFor(null, '2026-12'), null);
    assert.equal(K.targetFor({}, '2026-12'), null);
  });
  it('targetFor does not read inherited properties as overrides', () => {
    assert.equal(K.targetFor(cfg({ defaultTarget: null, targets: {} }), 'constructor'), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('rosterFromUsers (who is a President, who is finance-tier)', () => {
  it('the President is judged by the role on the users document', () => {
    assert.deepEqual(ROSTER.presidentUids, ['u-pres']);
  });
  it('finance-tier = the finance role, or a Finance department member who is not the Corporate Secretary', () => {
    assert.deepEqual([...ROSTER.financeUids].sort(), ['u-fin', 'u-fin2', 'u-fin3']);
    assert.ok(!ROSTER.financeUids.includes('u-sec'), 'the Corporate Secretary is blocked from Finance');
    assert.ok(!ROSTER.financeUids.includes('u-mgr') && !ROSTER.financeUids.includes('u-sales'));
  });
  it('accepts uid or id, ignores records with neither, and tolerates junk', () => {
    const r = K.rosterFromUsers([{ uid: 'a', role: 'president' }, { role: 'president' }, null, undefined, { id: 'b', role: 'finance' }]);
    assert.deepEqual(r, { presidentUids: ['a'], financeUids: ['b'] });
    assert.deepEqual(K.rosterFromUsers(undefined), { presidentUids: [], financeUids: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('confirmedCollections: what counts', () => {
  it('a President-confirmed first payment (sales_orders) counts its VAT-inclusive recordedAmount', () => {
    const r = collect([order()]);
    assert.equal(r.total, 65000);
    assert.equal(r.items.length, 1);
    assert.deepEqual(
      { source: r.items[0].source, id: r.items[0].id, kind: r.items[0].kind, amount: r.items[0].amount, date: r.items[0].date, clientName: r.items[0].clientName, standIn: r.items[0].standIn },
      { source: 'order', id: 'o1', kind: 'first', amount: 65000, date: '2026-11-20', clientName: 'Acme Foods', standIn: false },
    );
  });
  it('BOTH collections count: orders and claims add up', () => {
    const r = collect([order()], [claim()]);
    assert.equal(r.total, 100000);
    assert.deepEqual(r.items.map((x) => x.source).sort(), ['claim', 'order']);
    assert.equal(r.gross, 100000);
  });
  it('the amount is recordedAmount (VAT-inclusive cash), never paymentReceived (what was typed, maybe VAT-exclusive)', () => {
    assert.equal(totalOf([order({ paymentReceived: 50000, recordedAmount: 56000 })], [claim({ paymentReceived: 10000, recordedAmount: 11200 })]), 67200);
  });
  it('claims of kind balance, progress and change_order all count', () => {
    for (const kind of ['balance', 'progress', 'change_order']) assert.equal(totalOf([], [claim({ kind })]), 35000, kind);
  });
  it('items are listed oldest first, ties by id', () => {
    const r = collect([order({ id: 'o9', recordedAt: ts('2026-11-28T02:00:00.000Z') })], [claim({ id: 'cB', recordedAt: ts('2026-11-05T02:00:00.000Z') }), claim({ id: 'cA', recordedAt: ts('2026-11-05T02:00:00.000Z') })]);
    assert.deepEqual(r.items.map((x) => x.id), ['cA', 'cB', 'o9']);
  });
  it('an order with no flow-2 marker is not counted, but nothing is "counted twice" between the two collections', () => {
    const r = collect([order()], [claim({ id: 'c1', orderId: 'o1' })]);
    assert.equal(r.items.length, 2);
    assert.equal(r.total, 100000);
  });
});

describe('confirmedCollections: every exclusion', () => {
  it('not recorded (pending, rejected) is not counted', () => {
    const r = collect([order({ id: 'oa', status: 'pending' }), order({ id: 'ob', status: 'payment_rejected' }), order({ id: 'oc', status: undefined })], [claim({ id: 'ca', status: 'pending' }), claim({ id: 'cb', status: 'payment_rejected' })]);
    assert.equal(r.total, 0);
    assert.deepEqual(reasons(r), { oa: 'not-recorded', ob: 'not-recorded', oc: 'not-recorded', ca: 'not-recorded', cb: 'not-recorded' });
  });
  it('a legacy order (no flowVersion 2) is not counted — strictly the number 2', () => {
    const r = collect([order({ id: 'oa', flowVersion: undefined }), order({ id: 'ob', flowVersion: 1 }), order({ id: 'oc', flowVersion: '2' }), order({ id: 'od', flowVersion: 3 })]);
    assert.equal(r.total, 0);
    assert.deepEqual(reasons(r), { oa: 'legacy', ob: 'legacy', oc: 'legacy', od: 'legacy' });
  });
  it('recorded but the decision is not "confirmed" is not counted (rejected, empty, missing)', () => {
    const r = collect([order({ id: 'oa', paymentConfirm: stamp({ decision: 'rejected' }) }), order({ id: 'ob', paymentConfirm: stamp({ decision: null }) }), order({ id: 'oc', paymentConfirm: undefined })], [claim({ id: 'ca', paymentConfirm: stamp({ decision: 'rejected' }) })]);
    assert.equal(r.total, 0);
    assert.deepEqual(reasons(r), { oa: 'not-confirmed', ob: 'not-confirmed', oc: 'not-confirmed', ca: 'not-confirmed' });
  });
  it('confirmed by somebody who is not the President is not counted: the salesperson, a manager, an unknown uid, nobody', () => {
    const r = collect(
      [order({ id: 'oa', paymentConfirm: stamp({ decidedBy: 'u-sales' }) }), order({ id: 'ob', paymentConfirm: stamp({ decidedBy: 'u-mgr' }) }), order({ id: 'oc', paymentConfirm: stamp({ decidedBy: 'u-nobody' }) }), order({ id: 'od', paymentConfirm: stamp({ decidedBy: undefined }) })],
      [claim({ id: 'ca', paymentConfirm: stamp({ decidedBy: 'u-sales' }) }), claim({ id: 'cb', paymentConfirm: stamp({ decidedBy: 'u-mgr' }) })],
    );
    assert.equal(r.total, 0);
    assert.deepEqual(reasons(r), { oa: 'not-president', ob: 'not-president', oc: 'not-president', od: 'not-president', ca: 'not-president', cb: 'not-president' });
  });
  it('a fake role text does not count: decidedByRole "president" with a uid the roster does not know as a President is refused (the rules never check that text)', () => {
    const r = collect(
      [order({ id: 'oa', paymentConfirm: stamp({ decidedBy: 'u-sales', decidedByRole: 'president', onBehalf: false }) }), order({ id: 'ob', paymentConfirm: stamp({ decidedBy: 'u-mgr', decidedByRole: 'president' }) })],
      [claim({ id: 'ca', paymentConfirm: stamp({ decidedBy: 'u-sales', decidedByRole: 'president' }) })],
    );
    assert.equal(r.total, 0);
    assert.deepEqual(reasons(r), { oa: 'not-president', ob: 'not-president', ca: 'not-president' });
  });
  it('the real President counts whatever the role text says (the uid is what is checked)', () => {
    assert.equal(totalOf([order({ paymentConfirm: stamp({ decidedByRole: 'whatever' }) }), order({ id: 'o2', paymentConfirm: stamp({ decidedByRole: undefined }) })]), 130000);
  });
  it('the President confirming a payment he recorded himself counts', () => {
    assert.equal(totalOf([order({ createdBy: 'u-pres' })]), 65000);
  });
  it('a Finance stand-in counts: onBehalf true, a finance-tier uid, and not the payment\'s own creator (both collections)', () => {
    const standIn = (decidedBy) => stamp({ decidedBy, decidedByRole: 'finance', onBehalf: true });
    const r = collect([order({ paymentConfirm: standIn('u-fin') })], [claim({ paymentConfirm: standIn('u-fin2') }), claim({ id: 'c2', recordedAmount: 1000, paymentConfirm: standIn('u-fin3') })]);
    assert.equal(r.total, 65000 + 35000 + 1000);
    assert.ok(r.items.every((x) => x.standIn === true));
    assert.equal(collect([order()]).items[0].standIn, false, 'a President decision is not a stand-in');
  });
  it('a stand-in is refused when: onBehalf is not exactly true, the uid is not finance-tier, the Secretary stands in, or Finance confirms her own payment', () => {
    const r = collect([
      order({ id: 'oa', paymentConfirm: stamp({ decidedBy: 'u-fin', decidedByRole: 'finance', onBehalf: false }) }),
      order({ id: 'ob', paymentConfirm: stamp({ decidedBy: 'u-fin', decidedByRole: 'finance', onBehalf: undefined }) }),
      order({ id: 'oc', paymentConfirm: stamp({ decidedBy: 'u-fin', decidedByRole: 'finance', onBehalf: 'true' }) }),
      order({ id: 'oc2', paymentConfirm: stamp({ decidedBy: 'u-fin', decidedByRole: 'finance', onBehalf: 1 }) }),
      order({ id: 'od', paymentConfirm: stamp({ decidedBy: 'u-mgr', decidedByRole: 'finance', onBehalf: true }) }),
      order({ id: 'oe', paymentConfirm: stamp({ decidedBy: 'u-sec', decidedByRole: 'finance', onBehalf: true }) }),
      order({ id: 'of', createdBy: 'u-fin', paymentConfirm: stamp({ decidedBy: 'u-fin', decidedByRole: 'finance', onBehalf: true }) }),
      order({ id: 'og', paymentConfirm: stamp({ decidedBy: 'u-sales', decidedByRole: 'finance', onBehalf: true }) }),
    ], [claim({ id: 'ca', createdBy: 'u-fin2', paymentConfirm: stamp({ decidedBy: 'u-fin2', decidedByRole: 'finance', onBehalf: true }) })]);
    assert.equal(r.total, 0);
    assert.deepEqual(reasons(r), { oa: 'not-president', ob: 'not-president', oc: 'not-president', oc2: 'not-president', od: 'not-president', oe: 'not-president', of: 'not-president', og: 'not-president', ca: 'not-president' });
  });
  it('a site-visit fee is never a sale (owner ruling Q16: contracts only), nor is a claim of an unknown or missing kind', () => {
    const r = collect([], [claim({ id: 'ca', kind: 'site_visit', recordedAmount: 5000 }), claim({ id: 'cb', kind: 'deposit' }), claim({ id: 'cc', kind: undefined }), claim({ id: 'cd', kind: 'Balance' })]);
    assert.equal(r.total, 0);
    assert.deepEqual(reasons(r), { ca: 'site-visit', cb: 'kind', cc: 'kind', cd: 'kind' });
    assert.equal(totalOf([order()], [claim({ kind: 'site_visit' }), claim({ id: 'c2' })]), 100000, 'a fee beside real payments changes nothing');
  });
  it('Brilliance Steel (and any company that is not Barro Kitchens / Barro Industries) is out of scope; BK and BI both count', () => {
    const r = collect([order({ id: 'oa', company: 'BS' }), order({ id: 'ob', company: 'XX' }), order({ id: 'oc', company: '' }), order({ id: 'od', company: undefined }), order({ id: 'oe', company: 'BI', recordedAmount: 1000 }), order({ id: 'of', company: 'BK', recordedAmount: 2000 })]);
    assert.equal(r.total, 3000);
    assert.deepEqual(reasons(r), { oa: 'out-of-scope', ob: 'out-of-scope', oc: 'out-of-scope', od: 'out-of-scope' });
  });
  it('a claim with no company of its own takes its order\'s company; with neither it is unknown and out of scope', () => {
    const r = collect([order({ id: 'oBK', company: 'BK' }), order({ id: 'oBS', company: 'BS' })], [
      claim({ id: 'ca', company: '', orderId: 'oBK' }), claim({ id: 'cb', company: undefined, orderId: 'oBS' }), claim({ id: 'cc', company: '', orderId: 'gone' }), claim({ id: 'cd', company: 'BS', orderId: 'oBK' }),
    ]);
    assert.equal(r.total, 65000 + 35000);
    assert.deepEqual(reasons(r), { oBS: 'out-of-scope', cb: 'out-of-scope', cc: 'out-of-scope', cd: 'out-of-scope' });
  });
  it('scope "own": only payments the person recorded; "all" (and anything else) counts everyone\'s', () => {
    const orders = [order({ id: 'oa', createdBy: 'u-sales' }), order({ id: 'ob', createdBy: 'u-pres', recordedAmount: 1000 })];
    assert.equal(totalOf(orders, [], { scope: 'own', uid: 'u-sales' }), 65000);
    assert.equal(totalOf(orders, [], { scope: 'own', uid: 'u-pres' }), 1000);
    assert.equal(totalOf(orders, [], { scope: 'own', uid: '' }), 0, 'no uid, nothing is "own"');
    assert.equal(totalOf(orders, [], { scope: 'all', uid: 'u-sales' }), 66000);
    assert.equal(totalOf(orders, [], { uid: 'u-sales' }), 66000);
    assert.equal(totalOf(orders, [], { scope: 'weird', uid: 'u-sales' }), 66000);
    assert.equal(reasons(collect(orders, [], { scope: 'own', uid: 'u-sales' })).ob, 'out-of-scope');
  });
  it('no usable amount is not counted: 0, missing, negative, not a number — and a missing recordedAmount is NOT rescued by paymentReceived', () => {
    const r = collect([order({ id: 'oa', recordedAmount: 0 }), order({ id: 'ob', recordedAmount: undefined }), order({ id: 'oc', recordedAmount: -500 }), order({ id: 'od', recordedAmount: 'abc' }), order({ id: 'oe', recordedAmount: undefined, paymentReceived: 65000 })]);
    assert.equal(r.total, 0);
    assert.deepEqual(reasons(r), { oa: 'no-amount', ob: 'no-amount', oc: 'no-amount', od: 'no-amount', oe: 'no-amount' });
  });
  it('a payment whose time cannot be read at all is not counted (and is reported)', () => {
    const r = collect([order({ id: 'oa', recordedAt: undefined, paymentConfirm: stamp({ decidedAt: undefined }) }), order({ id: 'ob', recordedAt: {}, paymentConfirm: stamp({ decidedAt: 'soon' }) })]);
    assert.equal(r.total, 0);
    assert.deepEqual(reasons(r), { oa: 'no-date', ob: 'no-date' });
  });
  it('another month is not an error and not reported — it simply is not this month\'s', () => {
    const r = collect([order({ id: 'oa', recordedAt: ts('2026-10-15T02:00:00.000Z') }), order({ id: 'ob', recordedAt: ts('2026-12-15T02:00:00.000Z') })]);
    assert.equal(r.total, 0);
    assert.deepEqual(r.skipped, []);
    assert.equal(totalOf([order({ id: 'oa', recordedAt: ts('2026-10-15T02:00:00.000Z') })], [], { month: '2026-10' }), 65000);
  });
});

describe('confirmedCollections: the Manila month', () => {
  it('a payment recorded 23:59:59.999 on 30 Nov in Manila is November\'s; one millisecond later it is December\'s', () => {
    const lastMs = order({ id: 'oa', recordedAt: ts('2026-11-30T15:59:59.999Z') });
    const firstMs = order({ id: 'ob', recordedAt: ts('2026-11-30T16:00:00.000Z'), recordedAmount: 1000 });
    assert.equal(totalOf([lastMs, firstMs]), 65000);
    assert.equal(totalOf([lastMs, firstMs], [], { month: '2026-12' }), 1000);
  });
  it('the year boundary: 31 Dec 16:00Z is January in Manila', () => {
    const o = order({ recordedAt: ts('2026-12-31T16:00:00.000Z') });
    assert.equal(totalOf([o], [], { month: '2026-12' }), 0);
    assert.equal(totalOf([o], [], { month: '2027-01' }), 65000);
  });
  it('when recordedAt is missing or unreadable the confirmation time (paymentConfirm.decidedAt) decides the month', () => {
    const mk = (recordedAt, decidedAt) => order({ recordedAt, paymentConfirm: stamp({ decidedAt }) });
    assert.equal(totalOf([mk(undefined, '2026-11-30T16:30:00.000Z')], [], { month: '2026-12' }), 65000);
    assert.equal(totalOf([mk({}, '2026-11-10T02:00:00.000Z')]), 65000);
    assert.equal(totalOf([mk(ts('2026-11-10T02:00:00.000Z'), '2026-12-10T02:00:00.000Z')]), 65000, 'recordedAt wins over decidedAt');
  });
  it('the item\'s date is the Manila day it was confirmed', () => {
    assert.equal(collect([order({ recordedAt: ts('2026-11-30T15:00:00.000Z') })]).items[0].date, '2026-11-30');
    assert.equal(collect([], [claim({ recordedAt: ts('2026-11-29T20:00:00.000Z') })]).items[0].date, '2026-11-30');
  });
  it('a bad month throws (a programming error, never a silent zero)', () => {
    for (const bad of [undefined, '', '2026-13', '2026-1', 202611, null]) assert.throws(() => K.confirmedCollections([], { month: bad, roster: ROSTER }), /month must be YYYY-MM/);
  });
});

describe('confirmedCollections: refunds subtract in the month they are confirmed, never below 0 (owner ruling Q14)', () => {
  it('a refund in the month is subtracted from that month\'s total', () => {
    const r = collect([order()], [], { refunds: [refund()] });
    assert.equal(r.gross, 65000);
    assert.equal(r.refunded, 5000);
    assert.equal(r.total, 60000);
    assert.equal(r.refundItems.length, 1);
    assert.deepEqual({ source: r.refundItems[0].source, amount: r.refundItems[0].amount, date: r.refundItems[0].date }, { source: 'refund', amount: 5000, date: '2026-11-25' });
  });
  it('the total never goes below 0', () => {
    const r = collect([order({ recordedAmount: 3000 })], [], { refunds: [refund({ amount: 5000 })] });
    assert.equal(r.gross, 3000);
    assert.equal(r.refunded, 5000);
    assert.equal(r.total, 0);
    assert.equal(totalOf([], [], { refunds: [refund()] }), 0, 'a refund with no sales that month is 0, not negative');
  });
  it('a refund counts in ITS month: an old month is not reopened, a later month pays for it', () => {
    const rf = refund({ date: '2026-12-02' });
    assert.equal(totalOf([order()], [], { refunds: [rf] }), 65000);                          // November untouched
    assert.equal(totalOf([order({ recordedAt: ts('2026-12-10T02:00:00.000Z') })], [], { refunds: [rf], month: '2026-12' }), 60000);
  });
  it('a refund of Brilliance Steel (or an unknown company) is out of scope; a refund with no amount or date is ignored; "own" needs the creator', () => {
    const r = collect([order()], [], { refunds: [refund({ id: 'a', company: 'BS' }), refund({ id: 'b', company: '' }), refund({ id: 'c', amount: 0 }), refund({ id: 'd', date: 'soon' }), refund({ id: 'e', date: undefined })] });
    assert.equal(r.total, 65000);
    assert.deepEqual(reasons(r), { a: 'out-of-scope', b: 'out-of-scope', c: 'no-amount', d: 'no-date', e: 'no-date' });
    assert.equal(totalOf([order()], [], { refunds: [refund({ createdBy: 'someone-else' })], scope: 'own', uid: 'u-sales' }), 65000);
    assert.equal(totalOf([order()], [], { refunds: [refund({ createdBy: 'u-sales' })], scope: 'own', uid: 'u-sales' }), 60000);
  });
  it('a downward contract revision on its own subtracts nothing here (its cash effect arrives as a refund) — documented TODO for the owner', () => {
    assert.equal(totalOf([order({ revisions: [{ delta: -20000, decision: 'approved', decidedAt: '2026-11-22T02:00:00.000Z' }], contractAmount: 80000 })]), 65000);
    assert.ok(SOURCE.includes('TODO(owner, Q14)'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('satisfaction: what a rating is', () => {
  const sat = (ratings, extra = {}) => K.satisfaction(ratings, { month: NOV, ...extra });
  it('the average of the approved ratings of the month, over 5', () => {
    const r = sat([rating({ id: 'a', stars: 5 }), rating({ id: 'b', stars: 4 })]);
    assert.equal(r.source, 'month');
    assert.equal(r.n, 2);
    assert.equal(r.avg, 4.5);
    close(r.score, 0.9);
    assert.deepEqual(r.items.map((x) => x.id), ['a', 'b']);
  });
  it('an unapproved rating (approved false, missing, or a non-true value) is not counted', () => {
    const r = sat([rating({ id: 'a', approved: false }), rating({ id: 'b', approved: undefined }), rating({ id: 'c', approved: 'true' }), rating({ id: 'd', approved: 1 }), rating({ id: 'e', stars: 3 })]);
    assert.equal(r.n, 1);
    assert.equal(r.avg, 3);
  });
  it('the month is the Manila month of approvedAt (not createdAt, not the delivery)', () => {
    const lastMs = rating({ id: 'a', stars: 5, approvedAt: ts('2026-11-30T15:59:59.999Z') });
    const firstMs = rating({ id: 'b', stars: 1, approvedAt: ts('2026-11-30T16:00:00.000Z') });
    assert.deepEqual([sat([lastMs, firstMs]).n, sat([lastMs, firstMs]).avg], [1, 5]);
    assert.deepEqual([sat([lastMs, firstMs], { month: '2026-12' }).n, sat([lastMs, firstMs], { month: '2026-12' }).avg], [1, 1]);
    assert.equal(sat([rating({ approvedAt: undefined, createdAt: ts('2026-11-10T02:00:00.000Z') })]).source, 'none', 'no approvedAt, no month');
  });
  it('only whole stars 1 to 5 count', () => {
    const r = sat([rating({ id: 'a', stars: 0 }), rating({ id: 'b', stars: 6 }), rating({ id: 'c', stars: 4.5 }), rating({ id: 'd', stars: '5' }), rating({ id: 'e', stars: null }), rating({ id: 'f', stars: 2 })]);
    assert.equal(r.n, 1);
    assert.equal(r.avg, 2);
  });
  it('a Brilliance Steel (or company-less) job\'s rating is out of scope; BK and BI count', () => {
    const r = sat([rating({ id: 'a', company: 'BS', stars: 1 }), rating({ id: 'b', company: '', stars: 1 }), rating({ id: 'c', company: 'BI', stars: 4 }), rating({ id: 'd', company: 'BK', stars: 2 })]);
    assert.deepEqual([r.n, r.avg], [2, 3]);
  });
  it('scope "own": only the ratings given for this person\'s sales (salesUid)', () => {
    const rs = [rating({ id: 'a', salesUid: 'u-sales', stars: 5 }), rating({ id: 'b', salesUid: 'someone', stars: 1 })];
    assert.deepEqual([sat(rs, { scope: 'own', uid: 'u-sales' }).n, sat(rs, { scope: 'own', uid: 'u-sales' }).avg], [1, 5]);
    assert.equal(sat(rs, { scope: 'own', uid: '' }).source, 'none');
    assert.equal(sat(rs, { scope: 'all', uid: 'u-sales' }).n, 2);
  });
  it('a month with no ratings uses the pooled average of the approved ratings of the previous 3 months (Q5c)', () => {
    const rs = [
      rating({ id: 'a', stars: 5, approvedAt: ts('2026-10-10T02:00:00.000Z') }),
      rating({ id: 'b', stars: 4, approvedAt: ts('2026-09-10T02:00:00.000Z') }),
      rating({ id: 'c', stars: 3, approvedAt: ts('2026-09-20T02:00:00.000Z') }),
      rating({ id: 'd', stars: 1, approvedAt: ts('2026-07-31T02:00:00.000Z') }),    // 4 months back (July): outside the window
    ];
    const r = sat(rs);
    assert.equal(r.source, 'previous');
    assert.equal(r.n, 3);
    assert.equal(r.avg, 4);                                                           // pooled over ratings (5, 4, 3), not an average of the monthly averages (5 and 3.5 would give 4.25)
    close(r.score, 0.8);
    assert.deepEqual(r.months, ['2026-10', '2026-09', '2026-08']);
    assert.deepEqual(r.items.map((x) => x.id), ['b', 'c', 'a']);
  });
  it('the 3-month window spans a year boundary and ends at the month before', () => {
    const rs = [rating({ id: 'a', stars: 2, approvedAt: ts('2026-10-10T02:00:00.000Z') }), rating({ id: 'b', stars: 4, approvedAt: ts('2026-12-10T02:00:00.000Z') })];
    const r = sat(rs, { month: '2027-01' });
    assert.deepEqual([r.source, r.n, r.avg], ['previous', 2, 3]);
    assert.deepEqual(r.months, ['2026-12', '2026-11', '2026-10']);
    const none = sat(rs, { month: '2027-02' });                                       // Nov, Dec, Jan: only December is inside
    assert.deepEqual([none.source, none.n, none.avg], ['previous', 1, 4]);
    assert.equal(sat(rs, { month: '2027-04' }).source, 'none');                       // Jan, Feb, Mar: nothing
  });
  it('the month\'s own ratings beat the fallback; a later month\'s ratings are never borrowed', () => {
    const rs = [rating({ id: 'a', stars: 5 }), rating({ id: 'b', stars: 1, approvedAt: ts('2026-10-10T02:00:00.000Z') }), rating({ id: 'c', stars: 1, approvedAt: ts('2026-12-10T02:00:00.000Z') })];
    assert.deepEqual([sat(rs).source, sat(rs).n, sat(rs).avg], ['month', 1, 5]);
    assert.equal(sat([rating({ stars: 1, approvedAt: ts('2026-12-10T02:00:00.000Z') })]).source, 'none');
  });
  it('no ratings anywhere is "none": no average, no score', () => {
    const r = sat([]);
    assert.deepEqual([r.source, r.n, r.avg, r.score, r.items], ['none', 0, null, null, []]);
    assert.equal(sat(undefined).source, 'none');
  });
  it('carries what the scorecard shows: comment (trimmed), stars, client, how it was heard, the Manila day', () => {
    const r = sat([rating({ comment: '  Very happy with the hood.  ', heardVia: 'in_person', approvedAt: ts('2026-11-30T16:30:00.000Z') })], { month: '2026-12' });
    assert.deepEqual(
      { comment: r.items[0].comment, stars: r.items[0].stars, clientName: r.items[0].clientName, heardVia: r.items[0].heardVia, date: r.items[0].date },
      { comment: 'Very happy with the hood.', stars: 5, clientName: 'Acme Foods', heardVia: 'in_person', date: '2026-12-01' },
    );
  });
  it('a bad month throws', () => { assert.throws(() => K.satisfaction([], { month: 'x' }), /month must be YYYY-MM/); });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('score: sales score = min(1, collected ÷ target); satisfaction = stars ÷ 5; KPI = 0.7 / 0.3', () => {
  const T = 100000;                                                                 // a made-up round number: the real target is typed into the card, never kept in the repo
  it('the score table, sales only: nothing, half, exactly the target, over the target', () => {
    const s = (collected) => K.score({ collected, target: T, avgStars: null });
    assert.deepEqual([s(0).salesScore, s(0).kpiScore, s(0).mode], [0, 0, 'sales-only']);
    assert.deepEqual([s(50000).salesScore, s(50000).kpiScore], [0.5, 0.5]);
    assert.deepEqual([s(100000).salesScore, s(100000).kpiScore], [1, 1]);
    assert.deepEqual([s(150000).salesScore, s(150000).kpiScore], [1, 1]);            // capped at 100%: beating the target pays no more
    assert.deepEqual([s(400000).salesScore, s(400000).kpiScore], [1, 1]);            // four times the target: still 100%
  });
  it('the 70 / 30 blend, exactly', () => {
    const b = (collected, avgStars) => K.score({ collected, target: T, avgStars });
    assert.equal(b(50000, 4).kpiScore, 0.59);                                       // 0.7×0.5 + 0.3×0.8
    assert.equal(b(100000, 5).kpiScore, 1);
    assert.equal(b(0, 5).kpiScore, 0.3);                                            // ratings alone cap at 30%
    assert.equal(b(100000, 0).mode, 'blend');
    assert.equal(b(100000, 1).kpiScore, 0.76);                                      // 0.7 + 0.3×0.2
    assert.equal(b(80000, 4.5).kpiScore, 0.83);                                     // 0.56 + 0.27
    close(b(80000, 4.5).salesScore, 0.8);
    close(b(80000, 4.5).satScore, 0.9);
    assert.equal(b(80000, 4.5).mode, 'blend');
  });
  it('over the target with ratings is capped too: 4 stars at 150% of target is 0.7 + 0.24, not more', () => {
    assert.equal(K.score({ collected: 150000, target: T, avgStars: 4 }).kpiScore, 0.94);
    assert.equal(K.score({ collected: 150000, target: T, avgStars: 5 }).kpiScore, 1);
  });
  it('the default weights are 0.7 and 0.3 and the result reports them', () => {
    assert.deepEqual({ ...K.score({ collected: 1, target: 2, avgStars: 3 }).weights }, { sales: 0.7, satisfaction: 0.3 });
    // a sales-only month is the sales score alone, not 70% of it
    assert.equal(K.score({ collected: 80000, target: T, avgStars: null }).kpiScore, 0.8);
  });
  it('explicit weights are used when given (the owner may one day make them editable)', () => {
    assert.equal(K.score({ collected: 100000, target: T, avgStars: 3, weights: { sales: 0.5, satisfaction: 0.5 } }).kpiScore, 0.8);
  });
  it('rounded to 4 decimal places', () => {
    const r = K.score({ collected: 2, target: 3, avgStars: 4.5 });                  // 0.7×0.66666… + 0.3×0.9 = 0.736666…
    assert.equal(r.kpiScore, 0.7367);
    assert.equal(K.score({ collected: 1, target: 3, avgStars: null }).kpiScore, 0.3333);
    assert.equal(K.score({ collected: 0.00005, target: 1, avgStars: null }).kpiScore, 0.0001);
  });
  it('kept between 0 and 1: negative collected counts as 0; stars outside 1–5 are clamped', () => {
    assert.equal(K.score({ collected: -500, target: T, avgStars: null }).kpiScore, 0);
    assert.equal(K.score({ collected: T, target: T, avgStars: 9 }).kpiScore, 1);
    assert.equal(K.score({ collected: 0, target: T, avgStars: -3 }).kpiScore, 0);
    assert.equal(K.score({ collected: T, target: T, avgStars: 9 }).satScore, 1, 'the satisfaction score is printed as a percentage: never 180%');
    assert.equal(K.score({ collected: T, target: T, avgStars: -3 }).satScore, 0);
  });
  it('no target: no number is invented (mode no-target, kpiScore null) — for missing, 0, negative or non-numeric targets', () => {
    for (const target of [null, undefined, 0, -100, 'abc', NaN, '']) {
      const r = K.score({ collected: 500000, target, avgStars: 5 });
      assert.deepEqual([r.ok, r.mode, r.kpiScore, r.salesScore, r.satScore], [false, 'no-target', null, null, null], String(target));
    }
  });
  it('no ratings (null, undefined, empty, non-numeric) means sales only', () => {
    for (const avgStars of [null, undefined, '', 'abc', NaN]) assert.deepEqual([K.score({ collected: 50000, target: T, avgStars }).mode, K.score({ collected: 50000, target: T, avgStars }).kpiScore], ['sales-only', 0.5], String(avgStars));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('sentence: the plain-words lines (spec §5.4)', () => {
  const mk = (collected, target, ratings) => K.compute({
    cfg: { kpiSource: 'sales', startMonth: '2027-01', defaultTarget: target }, month: NOV, uid: 'u-sales', users: USERS,
    orders: [order({ recordedAmount: collected })], ratings: ratings || [],
  });
  it('blend: the KPI, the sales line and the rating line, with what each counts for', () => {
    const b = mk(80000, 100000, [rating({ id: 'a', stars: 5 }), rating({ id: 'b', stars: 4 })]);
    assert.equal(b.sentence.headline, 'KPI 83%');                                    // 0.7×0.8 + 0.3×0.9 (the spec's own example headline, 78%, does not equal its lines)
    assert.equal(b.sentence.sales, 'Sales: ₱80,000.00 confirmed of ₱100,000.00 target = 80% (counts 70%)');
    assert.equal(b.sentence.rating, 'Client rating: 4.5 of 5 from 2 clients = 90% (counts 30%)');
    assert.equal(b.sentence.note, '');
    assert.deepEqual(b.sentence.lines, ['KPI 83%', 'Sales: ₱80,000.00 confirmed of ₱100,000.00 target = 80% (counts 70%)', 'Client rating: 4.5 of 5 from 2 clients = 90% (counts 30%)']);
  });
  it('one client is "1 client"', () => {
    assert.equal(mk(80000, 100000, [rating({ stars: 3 })]).sentence.rating, 'Client rating: 3.0 of 5 from 1 client = 60% (counts 30%)');
  });
  it('a month with no ratings, none before: the KPI is the sales score only — in the owner\'s words', () => {
    const b = mk(80000, 100000, []);
    assert.equal(b.sentence.headline, 'KPI 80%');
    assert.equal(b.sentence.sales, 'Sales: ₱80,000.00 confirmed of ₱100,000.00 target = 80% (counts 100%)');
    assert.equal(b.sentence.rating, '');
    assert.equal(b.sentence.note, 'No client ratings this month, so the KPI is the sales score only.');
    assert.equal(b.sentence.lines.length, 3);
  });
  it('a month with no ratings but earlier ones says the last 3 months count', () => {
    const b = mk(80000, 100000, [rating({ stars: 4, approvedAt: ts('2026-10-10T02:00:00.000Z') }), rating({ id: 'q', stars: 5, approvedAt: ts('2026-09-10T02:00:00.000Z') })]);
    assert.equal(b.sentence.rating, 'Client rating: no ratings this month, so the last 3 months count: 4.5 of 5 from 2 clients = 90% (counts 30%)');
    assert.equal(b.sentence.note, '');
  });
  it('no target: "No target set for <Month>" and no number', () => {
    const b = K.compute({ cfg: { kpiSource: 'sales', startMonth: '2027-01', defaultTarget: null }, month: '2026-12', uid: 'u-sales', users: USERS, orders: [order()] });
    assert.equal(b.sentence.headline, 'No target set for December 2026');
    assert.deepEqual(b.sentence.lines, ['No target set for December 2026']);
    assert.equal(b.score.kpiScore, null);
    assert.equal(b.target, null);
    const none = K.compute({ cfg: null, month: '2026-12', uid: 'u-sales', users: USERS });
    assert.equal(none.sentence.headline, 'No target set for December 2026');
  });
  it('pesos: thousands separators and two decimals, rounded; the lines are plain text', () => {
    assert.equal(K.peso(0), '₱0.00');
    assert.equal(K.peso(1234.5), '₱1,234.50');
    assert.equal(K.peso(999999.999), '₱1,000,000.00');
    assert.equal(K.peso(12), '₱12.00');
    assert.equal(K.peso(-5.5), '-₱5.50');
    assert.equal(K.peso(undefined), '₱0.00');
    assert.ok(!/[<>&]/.test(mk(80000, 100000, [rating()]).sentence.lines.join('')));
  });
  it('percentages round the way people read them (0.285 is 29%, not 28%)', () => {
    assert.equal(K.sentence({ month: NOV, target: 100, collected: { total: 28.5 }, score: K.score({ collected: 28.5, target: 100, avgStars: null }), rating: { source: 'none' } }).headline, 'KPI 29%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('compute: the whole breakdown from raw documents', () => {
  // Made-up round numbers throughout: the real default target is typed into the card by the President and is never kept in the repo.
  const cfg = { kpiSource: 'sales', startMonth: '2027-01', weights: { sales: 0.7, satisfaction: 0.3 }, defaultTarget: 100000, targets: { '2026-12': 150000 }, scope: 'all' };
  const world = () => ({
    cfg, month: NOV, uid: 'u-sales', users: USERS,
    orders: [
      order({ id: 'o1', recordedAmount: 25000 }),                                                                         // ✓ 25,000
      order({ id: 'oBS', company: 'BS', recordedAmount: 100000 }),                                                        // ✗ Brilliance Steel
      order({ id: 'oPend', status: 'pending', recordedAmount: 50000, paymentConfirm: stamp({ decision: null }) }),       // ✗ not confirmed
      order({ id: 'oOld', flowVersion: undefined, recordedAmount: 50000 }),                                               // ✗ legacy
      order({ id: 'oFake', recordedAmount: 50000, paymentConfirm: stamp({ decidedBy: 'u-sales', decidedByRole: 'president' }) }), // ✗ fake role text
    ],
    claims: [
      claim({ id: 'c1', recordedAmount: 20000 }),                                                                         // ✓ 20,000
      claim({ id: 'cFee', kind: 'site_visit', recordedAmount: 5000 }),                                                    // ✗ fee
      claim({ id: 'cDec', recordedAmount: 20000, recordedAt: ts('2026-11-30T17:00:00.000Z') }),                           // ✗ December in Manila
      claim({ id: 'cFin', recordedAmount: 10000, paymentConfirm: stamp({ decidedBy: 'u-fin', decidedByRole: 'finance', onBehalf: true }) }), // ✓ 10,000, Finance stood in
    ],
    refunds: [refund({ amount: 5000 })],
    ratings: [rating({ id: 'a', stars: 5 }), rating({ id: 'b', stars: 4 }), rating({ id: 'c', stars: 1, approved: false }), rating({ id: 'd', stars: 1, approvedAt: ts('2026-10-01T02:00:00.000Z') })],
  });
  it('adds up exactly what counts and nothing else: (25,000 + 20,000 + 10,000) − 5,000 refund = 50,000', () => {
    const b = K.compute(world());
    assert.equal(b.collected.gross, 55000);
    assert.equal(b.collected.refunded, 5000);
    assert.equal(b.collected.total, 50000);
    assert.deepEqual(b.collected.items.map((x) => x.id), ['o1', 'c1', 'cFin']);
    assert.deepEqual(reasons(b.collected), { oBS: 'out-of-scope', oPend: 'not-recorded', oOld: 'legacy', oFake: 'not-president', cFee: 'site-visit' });
    assert.equal(b.collected.items.find((x) => x.id === 'cFin').standIn, true);
  });
  it('the target, the rating, the score and the words all come out of it', () => {
    const b = K.compute(world());
    assert.equal(b.target, 100000);
    assert.deepEqual([b.rating.source, b.rating.n, b.rating.avg], ['month', 2, 4.5]);
    assert.equal(b.score.mode, 'blend');
    close(b.score.salesScore, 0.5);
    close(b.score.satScore, 0.9);
    assert.equal(b.score.kpiScore, 0.62);                                                                              // 0.7×0.5 + 0.3×0.9
    assert.equal(b.sentence.headline, 'KPI 62%');
    assert.equal(b.sentence.sales, 'Sales: ₱50,000.00 confirmed of ₱100,000.00 target = 50% (counts 70%)');
  });
  it('a month\'s own target is used (December), and December gets only its own payments', () => {
    const w = world();
    const dec = K.compute({ ...w, month: '2026-12' });
    assert.equal(dec.target, 150000);
    assert.equal(dec.collected.total, 20000);                                                                          // only cDec lands in December
    assert.equal(dec.rating.source, 'previous');                                                                        // no December ratings: Nov (5, 4; the unapproved 1 is ignored) and Oct (1)
    assert.equal(dec.rating.n, 3);
  });
  it('reports whether the card is switched on, its start month, and whether the month is a paid one', () => {
    const b = K.compute(world());
    assert.deepEqual([b.configured, b.on, b.startMonth, b.active], [true, true, '2027-01', false]);
    const jan = K.compute({ ...world(), month: '2027-01' });
    assert.equal(jan.active, true);
    const off = K.compute({ ...world(), cfg: { ...cfg, kpiSource: 'tasks' } });
    assert.deepEqual([off.on, off.active], [false, false]);
  });
  it('"own" scope from the document narrows payments, refunds and ratings to the person', () => {
    const w = world();
    const own = K.compute({ ...w, cfg: { ...cfg, scope: 'own' }, uid: 'someone-else' });
    assert.equal(own.collected.total, 0);
    assert.equal(own.rating.source, 'none');
    assert.equal(K.compute({ ...w, cfg: { ...cfg, scope: 'own' } }).collected.total, 50000, 'u-sales recorded all of them');
    const mixed = { ...w, cfg: { ...cfg, scope: 'own' }, claims: [...w.claims, claim({ id: 'cOther', createdBy: 'u-pres', recordedAmount: 7000 })] };
    assert.equal(K.compute(mixed).collected.total, 50000, 'a payment somebody else recorded is not mine');
    assert.equal(K.compute({ ...mixed, cfg }).collected.total, 57000, 'under "all" it is');
  });
  it('takes a ready-made roster instead of users, and an injected company test', () => {
    const w = world();
    assert.equal(K.compute({ ...w, users: undefined, roster: ROSTER }).collected.total, 50000);
    assert.equal(K.compute({ ...w, isInternal: (co) => co === 'BS' }).collected.total, 100000, 'only the BS order is "internal" under this test (and its confirmation is valid)');
  });
  it('with no document at all there is nothing to score, but the payments are still listed', () => {
    const b = K.compute({ ...world(), cfg: null });
    assert.deepEqual([b.configured, b.on, b.active, b.target, b.score.mode], [false, false, false, null, 'no-target']);
    assert.equal(b.collected.total, 50000);
  });
  it('a bad month throws', () => { assert.throws(() => K.compute({ ...world(), month: '2026-1' }), /month must be YYYY-MM/); });
  it('defaults: window.isInternalQuoteCompany is used when the app has defined it', () => {
    const saved = globalThis.isInternalQuoteCompany;
    try {
      globalThis.isInternalQuoteCompany = (co) => co === 'BS';
      assert.equal(K.compute(world()).collected.total, 100000);
    } finally { if (saved === undefined) delete globalThis.isInternalQuoteCompany; else globalThis.isInternalQuoteCompany = saved; }
    assert.equal(K.compute(world()).collected.total, 50000);
  });
});
