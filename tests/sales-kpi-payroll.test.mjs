// tests/sales-kpi-payroll.test.mjs — Sales Manager KPI, rollout STEP 6: THE PAYROLL SWITCH (specs/SALES-MANAGER-KPI-SPEC-2026-11-20.md §5, §8, §11–§13).
//
// THIS IS A MONEY CHANGE. From the first month paid on it, the one person whose sales_kpi/{uid} document is switched on is paid on a different KPI: 70% confirmed
// sales (payments the President confirmed, counted by js/sales-kpi-core.js) + 30% client rating, tasks not counted. buildPayRunLines (js/departments.js) asks
// window.resolveSalesKpi for that score; everyone else is paid on exactly the task KPI they always were. js/money-core.js is FROZEN and untouched: computePayLine
// still takes ctx.kpiScore, only the number handed to it changes (basekpi: kpiFactor = clamp(kpiScore, 0, 1), incentiveEarned = allowance × kpiFactor, base untouched).
//
// WHAT IS PINNED (each group mutation-tested in a scratch copy OUTSIDE the worktree — the table is in the hand-back that came with this file):
//   A  the resolver, run for real (the REAL js/departments.js function in a vm, the REAL js/sales-kpi-core.js, an in-memory Firestore that logs every read):
//        null for no document / switched off / before startMonth (one small read, nothing else touched) and the exact startMonth boundary; the exact score and the
//        numbers-only `salesKpi` working; THROWS on any failed read, a missing core, a malformed month, and — with the exact words the screen shows — a month with no
//        target; every read is FRESH (source:'server', never dbCachedGet, a changed document is seen on the next call); ratings read 'all' or 'own'; nothing is written.
//   B  buildPayRunLines run for real with the REAL money-core.js maths: a person with no document / switched off / before startMonth gets a line deep-equal to the
//        GOLDEN captured from the unmodified builder (HEAD ab30055), and so does everyone else in the same run; the Sales-KPI person's KPI is the sales score, incentive =
//        allowance × min(1, kpiScore), base untouched, beating the target pays no more, Adjust's ovr.kpiScore still wins; a missing target or a failed read REFUSES the
//        run (computePayRun writes nothing) and the task KPI is never used; the frozen `kpiBreakdown` carries kpiSource + salesKpi and no client name, no undefined.
//   C  carry-through: salesKpi survives PC.normalizeLine (and a non-sales row keeps exactly its three keys), the phone-card breakdown prints the sales lines, payBasisSentence
//        gives the right words for both sources, window.salesKpiWords is the scorecard's own sentence read off the frozen working, the salary_history mirror carries it.
//   D  the display callers prefer the Sales KPI when it is in force and say "KPI unavailable" — never the task KPI — when it cannot be read: getKpiInfo, My Finance,
//        the employee dashboard, the Employee-of-the-Month standings, the worker overview / personal analytics; a finalised month shows its frozen line.
//   E  js/money-core.js is byte-identical to HEAD (sha256 pinned) and the weekly engine never mentions the Sales KPI.
//
// MUTATION-TESTED in a scratch copy OUTSIDE the worktree (72 single-edit mutants; the control ran green first; every one turned this file red — two survived the
// first pass, the roster card and the President's Team table, and are now killed by the D2 group). The ones that matter most, and what kills them:
//   task KPI used even when the Sales KPI is in force ................ B (the line's score, kpiCalls spy, deep-equal to the engine at that score)
//   a failed read falls back to the task KPI (builder / resolver / state) ... A "failed read THROWS", A2 "never tasks", B REFUSALS, the no-catch text pin
//   a missing target treated as 0% / 100% / the engine's own answer .... A "the target" group (exact words, one read), B REFUSALS (computePayRun writes nothing)
//   the Adjust override ignored ................................................ B "Adjust" group and the golden's override line (Olga)
//   salesKpi dropped / nulled by PC.normalizeLine, or kpiSource on every row  ... C "PC.normalizeLine" (a task row keeps exactly its three keys)
//   the wrong payBasisSentence branch (inverted / always tasks / always sales) ... C "payBasisSentence", the phone-card breakdown, the payslip
//   startMonth off by one (engine and resolver), startMonth ignored ............ A "the startMonth boundary" (2026-09 / 2026-10 / 2026-11, and 2026-12 / 2027-01)
//   a cached read instead of a fresh one (dbCachedGet, a plain get(), the staff list) ... A "every read is FRESH" (source:'server' on every get, a changed document seen at once)
//   the finalised-month guard in Payroll.preview, the computePayRun state gate ... B2
//   the display callers (getKpiInfo, My Finance, the employee dashboard, the worker overview, personal analytics, the Team table, the standings, the roster card,
//   the payslip, the salary_history mirror) ...................................... C and D / D2 (each one run for real, in all three states: sales / tasks / unavailable)
// Every figure below is made up (round pesos, invented names): the repository is public and the owner's real monthly target is never in a tracked file.
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stripComments } from './fixtures/strip-comments.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));     // objects made inside a vm carry that realm's prototypes
const piece = (src, re, what) => { const m = src.match(re); assert.ok(m, `${what} not found`); return m[0]; };
// The source of a function by its signature, found by brace matching (the same helper tests/dashboard-numbers-2026-11-20.test.mjs uses).
function extract(src, sig) {
  const start = src.indexOf(sig);
  assert.ok(start >= 0, `"${sig}" is gone — update this test, don't delete it`);
  let depth = 0;
  for (let i = src.indexOf('{', src.indexOf(')', start)); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced');
}
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
// Firestore refuses an undefined field value: nothing frozen on a line may carry one, at any depth.
function undefinedPaths(v, at = '$') {
  if (v === undefined) return [at];
  if (v === null || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => undefinedPaths(x, `${at}.${k}`));
}

// ── the code under test ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DEPT = read('js/departments.js');
const BPRL = piece(DEPT, /^window\.buildPayRunLines = async function[\s\S]*?\n\};\n/m, 'window.buildPayRunLines in js/departments.js');
const SKIP = piece(DEPT, /^window\.monthlyRunSkipReason = function[\s\S]*?\n\};\n/m, 'window.monthlyRunSkipReason in js/departments.js');
const PERIOD_EX = piece(DEPT, /^window\.periodExclusionsFor = async function[\s\S]*?\n\};\n/m, 'window.periodExclusionsFor in js/departments.js');
const RESOLVE = piece(DEPT, /^window\.resolveSalesKpi = async function[\s\S]*?\n\};\n/m, 'window.resolveSalesKpi in js/departments.js');
const STATE = piece(DEPT, /^window\.salesKpiState = async function[\s\S]*?\n\};\n/m, 'window.salesKpiState in js/departments.js');
const COMPUTE = piece(DEPT, /^window\.computePayRun = async function[\s\S]*?\n\};\n/m, 'window.computePayRun in js/departments.js');
const CORE_SRC = read('js/sales-kpi-core.js');

// ── fixtures: a small made-up world ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const MONTH = '2026-10';
const ts = (iso) => ({ seconds: Math.floor(Date.parse(iso) / 1000), nanoseconds: 0 });
const confirmation = (over = {}) => ({ decision: 'confirmed', decidedBy: 'u-pres', decidedByName: 'Neil Barro', decidedByRole: 'president', decidedAt: ts('2026-10-10T02:00:00Z'), onBehalf: false, ...over });
const PRES = { uid: 'u-pres', role: 'president', depts: [] };
const FIN = { uid: 'u-fin', role: 'finance', depts: ['Finance'] };
const SECRETARY = { uid: 'u-sec', role: 'secretary', depts: ['Finance'] };
const URIEL = { uid: 'u-sales', role: 'employee', depts: ['Sales'] };

// The basekpi fixtures of tests/basekpi-pay.test.mjs: an 18,000 package = 10,000 protected base + 8,000 incentive.
const OFC = { salary: 10000, allowance: 8000, deductions: 0 };
const person = (id, name, over) => ({ id, displayName: name, email: id + '@example.test', role: 'employee', payClass: 'regular', ...OFC, ...(over || {}) });
const PAID = [
  person('u-sales', 'Uriel Sales', { departments: ['Sales'] }),
  person('u-task', 'Tess Task', { departments: ['Design'] }),
  person('u-none', 'Nico None', { departments: ['IT'], salary: 12000, allowance: 5000, deductions: 500 }),
  person('u-ovr', 'Olga Override', { departments: ['Admin'] }),
];
// Tasks: Uriel finished all four of his (a task KPI of 100%), Tess 2 of 3 (with a 60 deliverable score), nobody else has any.
const TASKS = {
  ...Object.fromEntries([1, 2, 3, 4].map((i) => ['ts' + i, { assignedTo: 'u-sales', _dm: MONTH, _cm: '' }])),
  tt1: { assignedTo: 'u-task', _dm: MONTH, _cm: '' }, tt2: { assignedTo: 'u-task', _dm: MONTH, _cm: '' }, tt3: { assignedTo: 'u-task', _dm: null, _cm: '' },
};
const KPI_TARGETS = { 'u-task': { deliverableScore: 60 } };
const OVERRIDE_OLGA = { 'u-ovr': { kpiScore: 0.5, note: 'hand-set for the test', setBy: 'u-fin', setByName: 'Shaira Finance', setAt: null, original: { kpiScore: 1 } } };

const CARD = { kpiSource: 'sales', startMonth: MONTH, weights: { sales: 0.7, satisfaction: 0.3 }, targets: {}, defaultTarget: 400000, scope: 'all' };
// October 2026: confirmed 150,000 (first payment, the President) + 100,000 (a balance, Finance standing in) − 50,000 refunded = 200,000 of the 400,000 target = 50%;
// two approved ratings (5 and 4 stars) = 4.5 of 5 = 90%;  KPI = 0.7 × 0.5 + 0.3 × 0.9 = 0.62.  Counted: o1, c1.  Not counted (each for its own reason): o2 Brilliance Steel,
// o3 not recorded, c2 a site-visit fee, c3 "confirmed" by someone who is not the President (the stamp's role TEXT says president — the uid is what is checked), r3 not approved.
const seed = (over = {}) => ({
  users: {
    'u-pres': { displayName: 'Neil Barro', role: 'president' },
    'u-fin': { displayName: 'Shaira Finance', role: 'finance', departments: ['Finance'] },
    'u-sec': { displayName: 'Cora Secretary', role: 'secretary', department: 'Finance' },
    'u-sales': { displayName: 'Uriel Sales', role: 'employee', departments: ['Sales'] },
    'u-task': { displayName: 'Tess Task', role: 'employee', departments: ['Design'] },
    'u-none': { displayName: 'Nico None', role: 'employee', departments: ['IT'] },
    'u-ovr': { displayName: 'Olga Override', role: 'employee', departments: ['Admin'] },
  },
  sales_kpi: { 'u-sales': CARD },
  sales_orders: {
    o1: { flowVersion: 2, status: 'recorded', company: 'BK', clientName: 'Acme Foods', quoteNumber: 'BK-1', createdBy: 'u-sales', recordedAmount: 150000, recordedAt: ts('2026-10-10T02:00:00Z'), paymentConfirm: confirmation() },
    o2: { flowVersion: 2, status: 'recorded', company: 'BS', clientName: 'Steel Client', quoteNumber: 'BS-1', createdBy: 'u-sales', recordedAmount: 99000, recordedAt: ts('2026-10-11T02:00:00Z'), paymentConfirm: confirmation() },
    o3: { flowVersion: 2, status: 'pending', company: 'BK', clientName: 'Waiting Co', createdBy: 'u-sales', paymentConfirm: { decision: null } },
  },
  payment_claims: {
    c1: { kind: 'balance', status: 'recorded', company: 'BK', clientName: 'Acme Foods', orderId: 'o1', projectId: 'p1', createdBy: 'u-sales', recordedAmount: 100000, recordedAt: ts('2026-10-12T02:00:00Z'), paymentConfirm: confirmation({ decidedBy: 'u-fin', decidedByRole: 'finance', onBehalf: true }) },
    c2: { kind: 'site_visit', status: 'recorded', company: 'BK', clientName: 'Fee Client', createdBy: 'u-sales', recordedAmount: 5000, recordedAt: ts('2026-10-12T02:00:00Z'), paymentConfirm: confirmation() },
    c3: { kind: 'progress', status: 'recorded', company: 'BK', clientName: 'Faked Co', createdBy: 'u-sales', recordedAmount: 70000, recordedAt: ts('2026-10-13T02:00:00Z'), paymentConfirm: confirmation({ decidedBy: 'u-sales', decidedByRole: 'president' }) },
  },
  job_projects: { p1: { company: 'BK', clientName: 'Acme Foods', quoteNumber: 'BK-1', createdBy: 'u-sales', refunds: [{ amount: 50000, date: '2026-10-15' }] } },
  client_ratings: {
    r1: { projectId: 'r1', clientName: 'Acme Foods', company: 'BK', salesUid: 'u-sales', stars: 5, comment: 'Great job', source: 'president', approved: true, approvedAt: ts('2026-10-20T04:00:00Z') },
    r2: { projectId: 'r2', clientName: 'Beta Bakery', company: 'BK', salesUid: 'u-sales', stars: 4, comment: '', source: 'president', approved: true, approvedAt: ts('2026-10-21T04:00:00Z') },
    r3: { projectId: 'r3', clientName: 'Gamma Hotel', company: 'BK', salesUid: 'u-sales', stars: 1, comment: 'Not approved', source: 'client', approved: false, approvedAt: ts('2026-10-22T04:00:00Z') },
  },
  tasks: TASKS, kpi_targets: KPI_TARGETS, pay_runs: {}, worker_profiles: {},
  ...over,
});
// What the resolver freezes for that world (and what every test below computes against).
const KPI = 0.62;
const WORKING = { target: 400000, collected: 200000, count: 2, salesScore: 0.5, avgStars: 4.5, ratingCount: 2, satScore: 0.9, weights: { sales: 0.7, satisfaction: 0.3 }, mode: 'blend' };

// ── a fake Firestore that logs every read ────────────────────────────────────────────────────────────────────────────────────────────────────
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
function makeDb(store0, { fail = () => false } = {}) {
  const store = clone(store0);
  const reads = [], writes = [];
  const denied = (what) => Object.assign(new Error('permission-denied: ' + what), { code: 'permission-denied' });
  const snap = (id, d) => ({ id, exists: d !== undefined, data: () => clone(d) });
  const query = (c, filters) => ({
    where(f, op, v) { assert.ok(op === '==' || op === 'array-contains', 'the fake supports == and array-contains only'); return query(c, filters.concat([[f, v, op]])); },
    orderBy() { return query(c, filters); },
    limit() { return query(c, filters); },
    async get(opts) {
      reads.push({ path: c, filters: filters.map(([f, v, op]) => [f, op || '==', v]), opts });
      if (fail(c, null)) throw denied(c);
      const hit = (d, [f, v, op]) => (op === 'array-contains' ? Array.isArray(d[f]) && d[f].includes(v) : d[f] === v);
      const docs = Object.entries(store[c] || {}).filter(([, d]) => filters.every((fl) => hit(d, fl))).map(([id, d]) => snap(id, d));
      return { docs, size: docs.length, empty: !docs.length };
    },
  });
  return {
    store, reads, writes,
    collection: (c) => Object.assign(query(c, []), {
      doc: (id) => ({
        id,
        async get(opts) { reads.push({ path: c + '/' + id, filters: null, opts }); if (fail(c, id)) throw denied(c + '/' + id); return snap(id, (store[c] || {})[id]); },
        async set(data, opts) { writes.push({ path: c + '/' + id, data: clone(data), opts }); store[c] = store[c] || {}; store[c][id] = opts && opts.merge ? { ...(store[c][id] || {}), ...clone(data) } : clone(data); },
      }),
    }),
  };
}

// ── the world in a vm: the real files under test + a fake Firestore ─────────────────────────────────────────────────────────────────────────
function makeEnv({ data = seed(), fail, who = PRES, core = true, pay = false, ui = false } = {}) {
  const db = makeDb(data, { fail });
  const quiet = { log() {}, info() {}, warn() {}, error() {} };                 // computeStatutory warns on every call while the 2026 table is unverified, by design
  const ctx = vm.createContext({ console: quiet });
  ctx.window = ctx;
  ctx.window.bizYear = () => 2026;
  Object.assign(ctx, { db, currentUser: { uid: who.uid }, currentRole: who.role, currentDepts: who.depts });
  ctx.window.isMoneyPriv = () => ['president', 'owner', 'manager', 'finance'].includes(ctx.window.currentRole);
  // A REAL in-memory cache (never expires within a test): a read that went through it would be stale the second time, and the test below would see it.
  const cache = new Map(), cacheKeys = [];
  ctx.dbCachedGet = (key, fetcher) => { cacheKeys.push(key); if (!cache.has(key)) cache.set(key, fetcher()); return cache.get(key); };
  const env = { ctx, w: ctx.window, db, cacheKeys, kpiCalls: [], resolveCalls: [] };
  const load = (rel) => vm.runInContext(read(rel), ctx, { filename: rel });
  if (core) load('js/sales-kpi-core.js');
  if (ui) load('js/screens/sales-kpi.js');
  vm.runInContext(RESOLVE, ctx);
  vm.runInContext(STATE, ctx);
  if (pay) {
    for (const f of ['js/statutory-tables.js', 'js/money-core.js', 'js/pay-policy.js']) load(f);      // the REAL frozen maths and the real KPI-working helper
    ctx.window.taskDoneMonth = (t) => t._dm;
    ctx.window.taskCreatedMonth = (t) => t._cm || '';
    const realKpi = ctx.window.computeKpiForMonth;
    ctx.window.computeKpiForMonth = (...a) => { env.kpiCalls.push(a); return realKpi(...a); };
    const realResolve = ctx.window.resolveSalesKpi;
    ctx.window.resolveSalesKpi = (...a) => { env.resolveCalls.push(a); return realResolve(...a); };
    ctx.window.statutoryStatusRuleOn = async () => ({ on: false });
    ctx.window.statutoryStatusPlan = () => ({ active: false, statConfig: null, status: '', words: '', flag: null });
    ctx.fetchUsersWithPayroll = async () => ({ docs: PAID.map((d) => ({ id: d.id, data: () => { const { id, ...rest } = d; return clone(rest); } })), payrollDenied: false });
    ctx.firebase = { firestore: { FieldValue: { serverTimestamp: () => ({ __ts: true }) } } };
    for (const src of [SKIP, PERIOD_EX, BPRL, COMPUTE]) vm.runInContext(src, ctx);
  }
  return env;
}
const resolve = (env, uid = 'u-sales', month = MONTH, opts) => env.w.resolveSalesKpi(uid, month, opts);
const thrown = async (p) => { try { await p; } catch (e) { return e; } assert.fail('expected a throw'); };
const build = (env, policy = 'basekpi', overrides = OVERRIDE_OLGA) => env.w.buildPayRunLines(MONTH, { policy, overrides });
const lineOf = (out, uid) => plain(out.lines.find((l) => l.uid === uid));

// ── the GOLDEN: buildPayRunLines for the four people above, captured from the UNMODIFIED builder (HEAD ab30055) before step 6 touched it ────────────────────
// Same roster, same tasks, month 2026-10, Olga carrying the Adjust override above. "Identical to today's" means deep-equal to these, key for key (kpiBreakdown has
// exactly its three keys). Regenerating them is a decision about what people are paid today, not a way to make a test pass.
const GOLDEN = {
  basekpi: {
    lines: [
      {"uid":"u-none","name":"Nico None","payClass":"regular","base":12000,"allowance":5000,"otherDeductions":500,"unearnedDeductions":0,"withheldDeductions":500,"sss":850,"philhealth":425,"pagibig":200,"tax":0,"er":{"sss":1700,"philhealth":425,"pagibig":200},"kpiScore":1,"attScore":0,"perfFactor":0.7,"policy":"basekpi","caBalance":0,"caPlanned":0,"caPlan":[],"gross":17000,"effectiveGross":17000,"statutoryTotal":1475,"netBeforeCA":15025,"finalPay":15025,"kpiFactor":1,"incentiveFull":5000,"incentiveEarned":5000,"tinNum":"","ssNum":"","phNum":"","pagibigNum":"","employmentStatus":"","statutoryBasis":"","statusFlag":null,"kpiBreakdown":{"doneInM":0,"inScopeCount":0,"deliverableScore":null}},
      {"uid":"u-ovr","name":"Olga Override","payClass":"regular","base":10000,"allowance":8000,"otherDeductions":0,"unearnedDeductions":0,"withheldDeductions":0,"sss":900,"philhealth":450,"pagibig":200,"tax":0,"er":{"sss":1800,"philhealth":450,"pagibig":200},"kpiScore":0.5,"attScore":0,"perfFactor":0.35,"policy":"basekpi","caBalance":0,"caPlanned":0,"caPlan":[],"gross":18000,"effectiveGross":14000,"statutoryTotal":1550,"netBeforeCA":12450,"finalPay":12450,"kpiFactor":0.5,"incentiveFull":8000,"incentiveEarned":4000,"overridden":true,"overrideMeta":{"fields":["kpiScore"],"note":"hand-set for the test","setBy":"u-fin","setByName":"Shaira Finance","setAt":null,"original":{"kpiScore":1}},"tinNum":"","ssNum":"","phNum":"","pagibigNum":"","employmentStatus":"","statutoryBasis":"","statusFlag":null,"kpiBreakdown":{"doneInM":0,"inScopeCount":0,"deliverableScore":null}},
      {"uid":"u-task","name":"Tess Task","payClass":"regular","base":10000,"allowance":8000,"otherDeductions":0,"unearnedDeductions":0,"withheldDeductions":0,"sss":900,"philhealth":450,"pagibig":200,"tax":0,"er":{"sss":1800,"philhealth":450,"pagibig":200},"kpiScore":0.6466666666666666,"attScore":0,"perfFactor":0.4526666666666666,"policy":"basekpi","caBalance":0,"caPlanned":0,"caPlan":[],"gross":18000,"effectiveGross":15173.33,"statutoryTotal":1550,"netBeforeCA":13623.33,"finalPay":13623.33,"kpiFactor":0.6466666666666666,"incentiveFull":8000,"incentiveEarned":5173.33,"tinNum":"","ssNum":"","phNum":"","pagibigNum":"","employmentStatus":"","statutoryBasis":"","statusFlag":null,"kpiBreakdown":{"doneInM":2,"inScopeCount":3,"deliverableScore":60}},
      {"uid":"u-sales","name":"Uriel Sales","payClass":"regular","base":10000,"allowance":8000,"otherDeductions":0,"unearnedDeductions":0,"withheldDeductions":0,"sss":900,"philhealth":450,"pagibig":200,"tax":0,"er":{"sss":1800,"philhealth":450,"pagibig":200},"kpiScore":1,"attScore":0,"perfFactor":0.7,"policy":"basekpi","caBalance":0,"caPlanned":0,"caPlan":[],"gross":18000,"effectiveGross":18000,"statutoryTotal":1550,"netBeforeCA":16450,"finalPay":16450,"kpiFactor":1,"incentiveFull":8000,"incentiveEarned":8000,"tinNum":"","ssNum":"","phNum":"","pagibigNum":"","employmentStatus":"","statutoryBasis":"","statusFlag":null,"kpiBreakdown":{"doneInM":4,"inScopeCount":4,"deliverableScore":null}},
    ],
    skipped: [], warnings: [], payPolicy: "basekpi",
  },
  flat: {
    lines: [
      {"uid":"u-none","name":"Nico None","payClass":"regular","base":12000,"allowance":5000,"otherDeductions":500,"unearnedDeductions":0,"withheldDeductions":500,"sss":850,"philhealth":425,"pagibig":200,"tax":0,"er":{"sss":1700,"philhealth":425,"pagibig":200},"kpiScore":1,"attScore":1,"perfFactor":1,"policy":"flat","caBalance":0,"caPlanned":0,"caPlan":[],"gross":17000,"effectiveGross":17000,"statutoryTotal":1475,"netBeforeCA":15025,"finalPay":15025,"tinNum":"","ssNum":"","phNum":"","pagibigNum":"","employmentStatus":"","statutoryBasis":"","statusFlag":null,"kpiBreakdown":{"doneInM":0,"inScopeCount":0,"deliverableScore":null}},
      {"uid":"u-ovr","name":"Olga Override","payClass":"regular","base":10000,"allowance":8000,"otherDeductions":0,"unearnedDeductions":0,"withheldDeductions":0,"sss":900,"philhealth":450,"pagibig":200,"tax":0,"er":{"sss":1800,"philhealth":450,"pagibig":200},"kpiScore":0.5,"attScore":1,"perfFactor":0.6499999999999999,"policy":"flat","caBalance":0,"caPlanned":0,"caPlan":[],"gross":18000,"effectiveGross":18000,"statutoryTotal":1550,"netBeforeCA":16450,"finalPay":16450,"overridden":true,"overrideMeta":{"fields":["kpiScore"],"note":"hand-set for the test","setBy":"u-fin","setByName":"Shaira Finance","setAt":null,"original":{"kpiScore":1}},"tinNum":"","ssNum":"","phNum":"","pagibigNum":"","employmentStatus":"","statutoryBasis":"","statusFlag":null,"kpiBreakdown":{"doneInM":0,"inScopeCount":0,"deliverableScore":null}},
      {"uid":"u-task","name":"Tess Task","payClass":"regular","base":10000,"allowance":8000,"otherDeductions":0,"unearnedDeductions":0,"withheldDeductions":0,"sss":900,"philhealth":450,"pagibig":200,"tax":0,"er":{"sss":1800,"philhealth":450,"pagibig":200},"kpiScore":0.6466666666666666,"attScore":1,"perfFactor":0.7526666666666666,"policy":"flat","caBalance":0,"caPlanned":0,"caPlan":[],"gross":18000,"effectiveGross":18000,"statutoryTotal":1550,"netBeforeCA":16450,"finalPay":16450,"tinNum":"","ssNum":"","phNum":"","pagibigNum":"","employmentStatus":"","statutoryBasis":"","statusFlag":null,"kpiBreakdown":{"doneInM":2,"inScopeCount":3,"deliverableScore":60}},
      {"uid":"u-sales","name":"Uriel Sales","payClass":"regular","base":10000,"allowance":8000,"otherDeductions":0,"unearnedDeductions":0,"withheldDeductions":0,"sss":900,"philhealth":450,"pagibig":200,"tax":0,"er":{"sss":1800,"philhealth":450,"pagibig":200},"kpiScore":1,"attScore":1,"perfFactor":1,"policy":"flat","caBalance":0,"caPlanned":0,"caPlan":[],"gross":18000,"effectiveGross":18000,"statutoryTotal":1550,"netBeforeCA":16450,"finalPay":16450,"tinNum":"","ssNum":"","phNum":"","pagibigNum":"","employmentStatus":"","statutoryBasis":"","statusFlag":null,"kpiBreakdown":{"doneInM":4,"inScopeCount":4,"deliverableScore":null}},
    ],
    skipped: [], warnings: [], payPolicy: "flat",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  A · window.resolveSalesKpi
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('A · window.resolveSalesKpi — is the Sales KPI this person\'s KPI this month, and what is it', () => {
  describe('not in force: null, after ONE small read and nothing else', () => {
    const cases = [
      ['no sales_kpi document', () => seed({ sales_kpi: {} })],
      ['switched off (kpiSource "tasks")', () => seed({ sales_kpi: { 'u-sales': { ...CARD, kpiSource: 'tasks' } } })],
      ['switched on, but the month is before startMonth', () => seed({ sales_kpi: { 'u-sales': { ...CARD, startMonth: '2026-11' } } })],
      ['switched on, far-future startMonth', () => seed({ sales_kpi: { 'u-sales': { ...CARD, startMonth: '2027-01' } } })],
      ['switched on, no startMonth (pay must not switch by accident)', () => { const { startMonth, ...rest } = CARD; return seed({ sales_kpi: { 'u-sales': rest } }); }],
      ['switched on, malformed startMonth', () => seed({ sales_kpi: { 'u-sales': { ...CARD, startMonth: 'soon' } } })],
      ['a document with an unknown kpiSource', () => seed({ sales_kpi: { 'u-sales': { ...CARD, kpiSource: 'commission' } } })],
    ];
    for (const [label, mk] of cases) {
      it(label, async () => {
        const env = makeEnv({ data: mk() });
        assert.equal(await resolve(env), null);
        assert.deepEqual(env.db.reads.map((r) => r.path), ['sales_kpi/u-sales'], 'nothing but the switch was read');
      });
    }
    it('a person who has no document at all, in a world where somebody else is switched on', async () => {
      const env = makeEnv();
      assert.equal(await resolve(env, 'u-task'), null);
      assert.deepEqual(env.db.reads.map((r) => r.path), ['sales_kpi/u-task']);
    });
    it('without the engine loaded the answer for "no document" is still null (it is not needed to say "not applicable")', async () => {
      const env = makeEnv({ data: seed({ sales_kpi: {} }), core: false });
      assert.equal(await resolve(env), null);
    });
  });

  describe('the startMonth boundary: the first month paid on it is in force, the month before is not', () => {
    it('month === startMonth is in force; one month earlier is not; later months are', async () => {
      const env = makeEnv();
      assert.equal(await resolve(env, 'u-sales', '2026-09'), null);
      const at = await resolve(env, 'u-sales', '2026-10');
      assert.ok(at && at.kpiScore === KPI);
      const after = await resolve(env, 'u-sales', '2026-11');
      assert.ok(after && Number.isFinite(after.kpiScore));
      assert.equal(await resolve(env, 'u-sales', '2025-12'), null, 'a year boundary too');
    });
    it('at the year boundary: startMonth 2027-01 is in force for 2027-01 and not for 2026-12', async () => {
      const env = makeEnv({ data: seed({ sales_kpi: { 'u-sales': { ...CARD, startMonth: '2027-01' } } }) });
      assert.equal(await resolve(env, 'u-sales', '2026-12'), null);
      assert.ok(await resolve(env, 'u-sales', '2027-01'));
    });
  });

  describe('in force: the exact score and the numbers-only working', () => {
    it('kpiScore, the breakdown and the frozen working for the made-up October (200,000 of 400,000 = 50%; 4.5 of 5 = 90%)', async () => {
      const env = makeEnv();
      const r = await resolve(env);
      assert.equal(r.kpiScore, KPI);
      assert.deepEqual(plain(r.salesKpi), WORKING);
      assert.equal(r.breakdown.collected.total, 200000);
      assert.deepEqual(plain(r.breakdown.collected.items.map((i) => i.id).sort()), ['c1', 'o1']);
      assert.equal(r.breakdown.score.mode, 'blend');
      assert.equal(r.breakdown.rating.n, 2);
    });
    it('what counts is the core\'s decision, not the resolver\'s: the same score as SalesKpi.compute on the same documents', async () => {
      const env = makeEnv();
      const d = seed();
      const docs = (c) => Object.entries(d[c]).map(([id, x]) => ({ id, ...x })).filter((x) => x.status === undefined || x.status === 'recorded');   // what the resolver asks Firestore for
      const want = env.w.SalesKpi.compute({
        cfg: CARD, month: MONTH, uid: 'u-sales', orders: docs('sales_orders'), claims: docs('payment_claims'),
        refunds: [{ id: 'p1:0', projectId: 'p1', clientName: 'Acme Foods', quoteNumber: 'BK-1', company: 'BK', createdBy: 'u-sales', amount: 50000, date: '2026-10-15' }],
        ratings: docs('client_ratings'), users: docs('users'),
      });
      const got = await resolve(env);
      assert.equal(got.kpiScore, want.score.kpiScore);
      assert.deepEqual(plain(got.breakdown.sentence), plain(want.sentence));
    });
    it('only numbers and labels are frozen: no client name, no id, no undefined, no extra key', async () => {
      const r = await resolve(makeEnv());
      const json = JSON.stringify(r.salesKpi);
      for (const secret of ['Acme', 'Beta', 'Gamma', 'Steel', 'Faked', 'Fee Client', 'Waiting', 'o1', 'c1', 'p1', 'r1', 'Great job']) assert.ok(!json.includes(secret), `the frozen working names "${secret}"`);
      assert.deepEqual(undefinedPaths(r.salesKpi), []);
      assert.deepEqual(Object.keys(r.salesKpi).sort(), ['avgStars', 'collected', 'count', 'mode', 'ratingCount', 'salesScore', 'satScore', 'target', 'weights']);
    });
    it('a payment claim with no company of its own takes its ORDER\'s company: a Barro Kitchens order\'s balance counts, a Brilliance Steel order\'s does not (the resolver hands the engine every recorded order, with its id)', async () => {
      const d = seed();
      d.payment_claims.c4 = { kind: 'balance', status: 'recorded', clientName: 'Acme Foods', orderId: 'o1', createdBy: 'u-sales', recordedAmount: 40000, recordedAt: ts('2026-10-16T02:00:00Z'), paymentConfirm: confirmation() };
      d.payment_claims.c5 = { kind: 'balance', status: 'recorded', clientName: 'Steel Client', orderId: 'o2', createdBy: 'u-sales', recordedAmount: 60000, recordedAt: ts('2026-10-16T02:00:00Z'), paymentConfirm: confirmation() };
      const r = await resolve(makeEnv({ data: d }));
      assert.equal(r.salesKpi.collected, 240000);
      assert.deepEqual(plain(r.breakdown.collected.items.map((i) => i.id).sort()), ['c1', 'c4', 'o1']);
    });
    it('a month with no ratings at all is the sales score alone (mode "sales-only", no rating figures, no ratingWindow key)', async () => {
      const r = await resolve(makeEnv({ data: seed({ client_ratings: {} }) }));
      assert.equal(r.kpiScore, 0.5);
      assert.deepEqual(plain(r.salesKpi), { ...WORKING, avgStars: null, ratingCount: 0, satScore: null, mode: 'sales-only' });
      assert.ok(!('ratingWindow' in r.salesKpi));
    });
    it('a month with none of its own uses the last three months\' ratings, and says so (ratingWindow "previous")', async () => {
      const aug = { projectId: 'r9', clientName: 'Old Co', company: 'BK', salesUid: 'u-sales', stars: 4, approved: true, approvedAt: ts('2026-09-15T04:00:00Z') };
      const r = await resolve(makeEnv({ data: seed({ client_ratings: { r9: aug } }) }));
      assert.deepEqual(plain(r.salesKpi), { ...WORKING, avgStars: 4, ratingCount: 1, satScore: 0.8, ratingWindow: 'previous' });
      assert.equal(r.kpiScore, r2(0.7 * 0.5 + 0.3 * 0.8));
    });
    it('beating the target is capped at 100% of the sales part: 3× the target and five-star ratings = KPI 1 exactly', async () => {
      const d = seed();
      d.sales_orders.o5 = { flowVersion: 2, status: 'recorded', company: 'BK', clientName: 'Big Co', createdBy: 'u-sales', recordedAmount: 2000000, recordedAt: ts('2026-10-14T02:00:00Z'), paymentConfirm: confirmation() };
      d.client_ratings.r1.stars = 5; d.client_ratings.r2.stars = 5;
      const r = await resolve(makeEnv({ data: d }));
      assert.equal(r.salesKpi.salesScore, 1);
      assert.equal(r.kpiScore, 1);
      assert.ok(r.salesKpi.collected > 3 * r.salesKpi.target);
    });
  });

  describe('the target: its own month first, then the default; nothing is ever invented', () => {
    it('a single-month target beats the default', async () => {
      const r = await resolve(makeEnv({ data: seed({ sales_kpi: { 'u-sales': { ...CARD, targets: { [MONTH]: 200000 } } } }) }));
      assert.equal(r.salesKpi.target, 200000);
      assert.equal(r.salesKpi.salesScore, 1);
      assert.equal(r.kpiScore, r2(0.7 + 0.27));
    });
    it('a month without its own target uses the default', async () => {
      const r = await resolve(makeEnv({ data: seed({ sales_kpi: { 'u-sales': { ...CARD, targets: { '2026-09': 1 } } } }) }));
      assert.equal(r.salesKpi.target, 400000);
    });
    it('a zero single-month target falls back to the default (it is never read as "target 0")', async () => {
      const r = await resolve(makeEnv({ data: seed({ sales_kpi: { 'u-sales': { ...CARD, targets: { [MONTH]: 0 } } } }) }));
      assert.equal(r.salesKpi.target, 400000);
    });
    const NO_TARGET = 'Set the sales target for October 2026 first (Finance › Payroll & HR › Sales KPI)';
    for (const [label, card] of [
      ['no default and no month target', { ...CARD, defaultTarget: null }],
      ['a default of 0', { ...CARD, defaultTarget: 0 }],
      ['a blank default', { ...CARD, defaultTarget: '' }],
      ['a negative default', { ...CARD, defaultTarget: -5 }],
      ['no defaultTarget key at all', (() => { const { defaultTarget, ...rest } = CARD; return rest; })()],
      ['a zero month target and no default', { ...CARD, defaultTarget: null, targets: { [MONTH]: 0 } }],
    ]) {
      it(`${label}: THROWS "${NO_TARGET}" — not 0%, not 100%, not the task KPI — and reads nothing else`, async () => {
        const env = makeEnv({ data: seed({ sales_kpi: { 'u-sales': card } }) });
        const e = await thrown(resolve(env));
        assert.equal(e.message, NO_TARGET);
        assert.deepEqual(env.db.reads.map((r) => r.path), ['sales_kpi/u-sales']);
      });
    }
    it('the month is named in plain words: December 2026', async () => {
      const env = makeEnv({ data: seed({ sales_kpi: { 'u-sales': { ...CARD, defaultTarget: null } } }) });
      const e = await thrown(resolve(env, 'u-sales', '2026-12'));
      assert.equal(e.message, 'Set the sales target for December 2026 first (Finance › Payroll & HR › Sales KPI)');
    });
  });

  describe('a failed read THROWS — it is never answered with null (which would mean "use the task KPI")', () => {
    const PATHS = ['sales_kpi/u-sales', 'sales_orders', 'payment_claims', 'job_projects', 'client_ratings', 'users'];
    for (const p of PATHS) {
      it(`${p} unreadable`, async () => {
        const env = makeEnv({ fail: (c, id) => (id ? `${c}/${id}` : c) === p });
        const e = await thrown(resolve(env));
        assert.match(e.message, /^Could not read .+ — nothing was worked out\. Try again in a moment\.$/);
      });
    }
    it('Firestore not ready at all', async () => {
      const env = makeEnv();
      env.ctx.db = null;
      const e = await thrown(resolve(env));
      assert.match(e.message, /Firestore is not ready/);
    });
    it('the engine (js/sales-kpi-core.js) missing while a document exists', async () => {
      const e = await thrown(resolve(makeEnv({ core: false })));
      assert.match(e.message, /Sales KPI engine did not load/);
    });
    it('belt and braces: if the engine ever answers without a usable score, the resolver throws instead of handing pay a number it made up', async () => {
      for (const answer of [{ score: { ok: false, mode: 'no-target', kpiScore: null } }, { score: { ok: true, kpiScore: NaN } }, { score: null }, { score: { ok: true, kpiScore: '0.5' } }]) {
        const env = makeEnv();
        env.w.SalesKpi.compute = () => answer;
        assert.match((await thrown(resolve(env))).message, /^The Sales KPI could not be worked out for October 2026 — nothing was worked out\.$/);
      }
    });
    it('a missing person or a malformed month is refused, not guessed', async () => {
      const env = makeEnv();
      for (const m of ['October', '2026-13', '2026-00', '', undefined, null, 202610]) assert.match((await thrown(env.w.resolveSalesKpi('u-sales', m))).message, /needs a month like 2027-01/);
      for (const u of ['', undefined, null]) assert.match((await thrown(env.w.resolveSalesKpi(u, MONTH))).message, /whose KPI/);
    });
  });

  describe('every read is FRESH (this decides pay)', () => {
    it('source "server" on every single get, and dbCachedGet is never used', async () => {
      const env = makeEnv();
      await resolve(env);
      assert.deepEqual(env.db.reads.map((r) => r.path).sort(), ['client_ratings', 'job_projects', 'payment_claims', 'sales_kpi/u-sales', 'sales_orders', 'users']);
      for (const r of env.db.reads) assert.deepEqual(plain(r.opts), { source: 'server' }, `${r.path} was not a server read`);
      assert.deepEqual(env.cacheKeys, [], 'dbCachedGet was used');
    });
    it('a changed document is seen on the very next call: switched off -> null; switched back on with a new target -> the new score', async () => {
      const env = makeEnv();
      assert.equal((await resolve(env)).kpiScore, KPI);
      env.db.store.sales_kpi['u-sales'].kpiSource = 'tasks';
      assert.equal(await resolve(env), null, 'a stale switch answered');
      env.db.store.sales_kpi['u-sales'].kpiSource = 'sales';
      env.db.store.sales_kpi['u-sales'].defaultTarget = 200000;
      assert.equal((await resolve(env)).salesKpi.target, 200000, 'a stale target answered');
    });
    it('a newly confirmed payment is seen on the next call', async () => {
      const env = makeEnv();
      await resolve(env);
      env.db.store.sales_orders.o9 = { flowVersion: 2, status: 'recorded', company: 'BK', clientName: 'Late Co', createdBy: 'u-sales', recordedAmount: 100000, recordedAt: ts('2026-10-30T02:00:00Z'), paymentConfirm: confirmation() };
      assert.equal((await resolve(env)).salesKpi.collected, 300000);
    });
  });

  describe('what it reads and how', () => {
    it('only recorded orders and claims are asked for; every job is read for its refunds; the ratings are read "all" by default and "own" on request', async () => {
      const env = makeEnv();
      await resolve(env);
      const q = (p) => env.db.reads.find((r) => r.path === p);
      assert.deepEqual(plain(q('sales_orders').filters), [['status', '==', 'recorded']]);
      assert.deepEqual(plain(q('payment_claims').filters), [['status', '==', 'recorded']]);
      assert.deepEqual(plain(q('client_ratings').filters), []);
      const own = makeEnv();
      const r = await resolve(own, 'u-sales', MONTH, { ratings: 'own' });
      assert.deepEqual(plain(own.db.reads.find((x) => x.path === 'client_ratings').filters), [['salesUid', '==', 'u-sales']]);
      assert.equal(r.kpiScore, KPI, 'the person\'s own scorecard and the pay run agree when the ratings name them');
    });
    it('it writes nothing', async () => {
      const env = makeEnv();
      await resolve(env);
      assert.deepEqual(env.db.writes, []);
    });
    it('refunds are read exactly as the scorecard reads them (SalesKpiUI.refundsOf) — pay and screen cannot disagree about a refund', async () => {
      const d = seed({ job_projects: {
        p1: { company: 'BK', clientName: 'Acme Foods', quoteNumber: 'BK-1', createdBy: 'u-sales', refunds: [{ amount: 50000, date: '2026-10-15' }, { amount: 'bad', date: '2026-10-16' }, null, { amount: 2500.5, date: '2026-10-31' }] },
        p2: { company: 'BK', refunds: 'nope' }, p3: { company: 'BK' },
        p4: { company: 'BS', refunds: [{ amount: 1000, date: '2026-10-02' }] },
        p5: { company: 'BK', createdBy: 'u-else', refunds: [{ amount: 700, date: '2026-09-30' }, { amount: 300, date: '2026-10-01' }] },
      } });
      const env = makeEnv({ data: d, ui: true });
      const got = await resolve(env);
      const projects = Object.entries(d.job_projects).map(([id, p]) => ({ id, ...p }));
      const docs = (c) => Object.entries(d[c]).map(([id, x]) => ({ id, ...x })).filter((x) => x.status === undefined || x.status === 'recorded');   // what the resolver asks Firestore for
      const want = env.w.SalesKpi.compute({ cfg: CARD, month: MONTH, uid: 'u-sales', orders: docs('sales_orders'), claims: docs('payment_claims'), refunds: env.w.SalesKpiUI.refundsOf(projects), ratings: docs('client_ratings'), users: docs('users') });
      assert.deepEqual(plain(got.breakdown.collected), plain(want.collected));
      assert.ok(want.collected.refunded > 0, 'the world really has refunds in the month');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  A2 · window.salesKpiState — the display face
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('A2 · window.salesKpiState — one answer a screen can switch on; a failure is "unavailable", never "tasks"', () => {
  const state = (env, uid = 'u-sales', month = MONTH, opts) => env.w.salesKpiState(uid, month, opts);
  it('"tasks" for someone it does not apply to; "sales" with the whole result when it does', async () => {
    const env = makeEnv();
    assert.deepEqual(plain(await state(env, 'u-task')), { state: 'tasks' });
    const s = await state(env);
    assert.equal(s.state, 'sales');
    assert.equal(s.kpi.kpiScore, KPI);
  });
  it('a failed read is "unavailable" (with the error) — NEVER "tasks"', async () => {
    for (const p of ['sales_kpi/u-sales', 'sales_orders', 'payment_claims', 'job_projects', 'client_ratings', 'users']) {
      const env = makeEnv({ fail: (c, id) => (id ? `${c}/${id}` : c) === p });
      const s = await state(env);
      assert.equal(s.state, 'unavailable', p);
      assert.match(s.error.message, /Could not read/);
      assert.ok(!('kpi' in s));
    }
  });
  it('no target is "unavailable" with the instruction in the error', async () => {
    const env = makeEnv({ data: seed({ sales_kpi: { 'u-sales': { ...CARD, defaultTarget: null } } }) });
    const s = await state(env);
    assert.equal(s.state, 'unavailable');
    assert.match(s.error.message, /^Set the sales target for October 2026 first/);
  });
  it('it never rejects (a screen can await it without a try/catch)', async () => {
    const env = makeEnv({ core: false });
    const s = await state(env);
    assert.equal(s.state, 'unavailable');
    assert.equal((await state(makeEnv(), 'u-sales', 'nonsense')).state, 'unavailable');
  });
  it('the person reading their OWN scorecard without the books tier asks only for the ratings that name them; the President and Finance read every rating', async () => {
    const ratingsFilter = (env) => plain(env.db.reads.find((r) => r.path === 'client_ratings').filters);
    const own = makeEnv({ who: URIEL }); await state(own);
    assert.deepEqual(ratingsFilter(own), [['salesUid', '==', 'u-sales']]);
    for (const who of [PRES, FIN]) { const e = makeEnv({ who }); await state(e); assert.deepEqual(ratingsFilter(e), [], who.role); }
    const other = makeEnv({ who: URIEL }); await state(other, 'u-task'); assert.deepEqual(other.db.reads.map((r) => r.path), ['sales_kpi/u-task']);
    const forced = makeEnv({ who: PRES }); await state(forced, 'u-sales', MONTH, { ratings: 'own' });
    assert.deepEqual(ratingsFilter(forced), [['salesUid', '==', 'u-sales']], 'an explicit choice wins');
  });
  it('the Corporate Secretary is not "the books tier": she reads her own scorecard through the ratings that name her, like any employee', async () => {
    const sec = makeEnv({ who: SECRETARY, data: seed({ sales_kpi: { 'u-sec': { ...CARD } } }) });
    await state(sec, 'u-sec');
    assert.deepEqual(plain(sec.db.reads.find((r) => r.path === 'client_ratings').filters), [['salesUid', '==', 'u-sec']]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  B · buildPayRunLines, run for real (the real money-core.js maths, a fake Firestore)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('B · buildPayRunLines — everyone else is paid exactly as before; the Sales-KPI person is paid on the Sales KPI', () => {
  const goldenOf = (policy, uid) => GOLDEN[policy].lines.find((l) => l.uid === uid);
  const sameAsGolden = (out, policy) => {
    assert.deepEqual(plain(out.lines), GOLDEN[policy].lines);
    assert.deepEqual(plain(out.skipped), GOLDEN[policy].skipped);
    assert.deepEqual(plain(out.warnings), GOLDEN[policy].warnings);
    assert.equal(out.payPolicy, GOLDEN[policy].payPolicy);
  };

  describe('no Sales KPI in force: the run is deep-equal to the golden captured from the unmodified builder', () => {
    const variants = [
      ['no sales_kpi document at all', {}],
      ['a document that is switched off', { 'u-sales': { ...CARD, kpiSource: 'tasks' } }],
      ['a document switched on, but the month is before its startMonth', { 'u-sales': { ...CARD, startMonth: '2026-11' } }],
      ['a document switched on with no startMonth', (() => { const { startMonth, ...rest } = CARD; return { 'u-sales': rest }; })()],
    ];
    for (const policy of ['basekpi', 'flat']) {
      for (const [label, sales_kpi] of variants) {
        it(`${policy} · ${label}: every line (Uriel's too), the skipped list and the warnings are the golden's`, async () => {
          const env = makeEnv({ pay: true, data: seed({ sales_kpi }) });
          sameAsGolden(await build(env, policy), policy);
          assert.ok(!env.db.reads.some((r) => /^(sales_orders|payment_claims|job_projects|client_ratings)/.test(r.path)), 'a heavy sales read happened for nobody');
        });
      }
    }
    it('Uriel\'s own line is still on the TASK KPI (all four tasks done = 100%) and is the golden\'s, key for key', async () => {
      const env = makeEnv({ pay: true, data: seed({ sales_kpi: {} }) });
      const u = lineOf(await build(env), 'u-sales');
      assert.deepEqual(u, goldenOf('basekpi', 'u-sales'));
      assert.equal(u.kpiScore, 1);
      assert.deepEqual(Object.keys(u.kpiBreakdown), ['doneInM', 'inScopeCount', 'deliverableScore'], 'no kpiSource key on a task line, not even an undefined one');
    });
  });

  describe('the Sales KPI in force: the score pay uses', () => {
    it('Uriel\'s KPI is the sales KPI; incentive = allowance × min(1, kpiScore); base untouched; tasks do not count (his 100% task KPI is not used)', async () => {
      const env = makeEnv({ pay: true });
      const out = await build(env);
      const u = lineOf(out, 'u-sales');
      assert.equal(u.kpiScore, KPI);
      assert.notEqual(u.kpiScore, 1, 'the task KPI (all four tasks done) was used');
      assert.equal(u.kpiFactor, KPI);
      assert.equal(u.incentiveFull, 8000);
      assert.equal(u.incentiveEarned, r2(8000 * Math.min(1, KPI)));
      assert.equal(u.incentiveEarned, 4960);
      assert.equal(u.base, 10000, 'the protected base is never touched');
      assert.equal(u.netBeforeCA, 10000 - 1550 + 4960);
      assert.equal(u.finalPay, 13410);
      assert.ok(!env.kpiCalls.some((a) => a[0].some((t) => t.assignedTo === 'u-sales')), 'the task KPI was computed for the Sales-KPI person');
    });
    it('the line is exactly what the frozen engine makes at that score — only the number handed to computePayLine changed', async () => {
      const env = makeEnv({ pay: true });
      const u = lineOf(await build(env), 'u-sales');
      const ref = plain(env.w.computePayLine(PAID[0], { month: MONTH, policy: 'basekpi', kpiScore: KPI, attScore: 0, caPlan: [], caBalance: undefined }));
      for (const k of Object.keys(ref)) assert.deepEqual(u[k], ref[k], `field ${k}`);
    });
    it('the frozen kpiBreakdown carries kpiSource "sales" and the numbers-only working beside the three task keys', async () => {
      const u = lineOf(await build(makeEnv({ pay: true })), 'u-sales');
      assert.deepEqual(u.kpiBreakdown, { doneInM: 4, inScopeCount: 4, deliverableScore: null, kpiSource: 'sales', salesKpi: WORKING });
      assert.deepEqual(undefinedPaths(u), [], 'Firestore refuses undefined: nothing on the line may carry one');
      assert.ok(!JSON.stringify(u).includes('Acme'), 'a client name reached the frozen line');
    });
    it('everyone else in the same run is byte-identical to the golden (the Sales KPI touches one person)', async () => {
      const out = await build(makeEnv({ pay: true }));
      for (const uid of ['u-none', 'u-ovr', 'u-task']) assert.deepEqual(lineOf(out, uid), goldenOf('basekpi', uid), uid);
      assert.deepEqual(plain(out.skipped), []);
    });
    it('the resolver is asked once per person, for (uid, month) only — the pay run reads every rating (no "own" narrowing)', async () => {
      const env = makeEnv({ pay: true });
      await build(env);
      assert.deepEqual(plain(env.resolveCalls).map((a) => a.slice(0, 2)).sort(), [['u-none', MONTH], ['u-ovr', MONTH], ['u-sales', MONTH], ['u-task', MONTH]]);
      for (const a of env.resolveCalls) assert.equal(a.length, 2, 'extra arguments were passed to the resolver');
      assert.deepEqual(plain(env.db.reads.find((r) => r.path === 'client_ratings').filters), []);
    });
    it('under the "flat" policy the KPI is shown on the line but pay is unchanged (the full package), and a missing target still refuses the run', async () => {
      const flat = lineOf(await build(makeEnv({ pay: true }), 'flat'), 'u-sales');
      assert.equal(flat.kpiScore, KPI);
      assert.equal(flat.finalPay, goldenOf('flat', 'u-sales').finalPay);
      assert.equal(flat.kpiBreakdown.kpiSource, 'sales');
      const noTarget = makeEnv({ pay: true, data: seed({ sales_kpi: { 'u-sales': { ...CARD, defaultTarget: null } } }) });
      assert.match((await thrown(build(noTarget, 'flat'))).message, /^Set the sales target for October 2026 first/);
    });
  });

  describe('Adjust (the per-line override): ovr.kpiScore still wins, whichever source the KPI came from', () => {
    const ovr = (kpiScore) => ({ ...OVERRIDE_OLGA, 'u-sales': { kpiScore, note: 'adjusted', setBy: 'u-fin', setByName: 'Shaira Finance', setAt: null, original: { kpiScore: KPI } } });
    it('an override on the Sales-KPI person: his kpiScore, kpiFactor and incentive follow the override; the computed working stays on the line', async () => {
      const u = lineOf(await build(makeEnv({ pay: true }), 'basekpi', ovr(0.2)), 'u-sales');
      assert.equal(u.kpiScore, 0.2);
      assert.equal(u.kpiFactor, 0.2);
      assert.equal(u.incentiveEarned, 1600);
      assert.equal(u.base, 10000);
      assert.equal(u.overridden, true);
      assert.deepEqual(u.kpiBreakdown.salesKpi, WORKING, 'the working is what was COMPUTED; the override is its own flagged adjustment');
    });
    it('an override of 1 (full) pays the full incentive, an override of 0 pays none — the override is not capped to the sales score', async () => {
      assert.equal(lineOf(await build(makeEnv({ pay: true }), 'basekpi', ovr(1)), 'u-sales').incentiveEarned, 8000);
      assert.equal(lineOf(await build(makeEnv({ pay: true }), 'basekpi', ovr(0)), 'u-sales').incentiveEarned, 0);
    });
    it('an override on someone else (Olga: 0.5) is the golden\'s line while Uriel is on the Sales KPI', async () => {
      assert.deepEqual(lineOf(await build(makeEnv({ pay: true })), 'u-ovr'), goldenOf('basekpi', 'u-ovr'));
    });
  });

  describe('beating the target pays no more than the full incentive', () => {
    it('collected = target and collected = 5× the target give the same line (sales score is capped at 100%)', async () => {
      const mk = (extra) => { const d = seed(); d.sales_orders.o5 = { flowVersion: 2, status: 'recorded', company: 'BK', clientName: 'Big Co', createdBy: 'u-sales', recordedAmount: extra, recordedAt: ts('2026-10-14T02:00:00Z'), paymentConfirm: confirmation() }; return d; };
      const atTarget = lineOf(await build(makeEnv({ pay: true, data: mk(200000) })), 'u-sales');         // 200,000 + 200,000 = exactly the 400,000 target
      const way = lineOf(await build(makeEnv({ pay: true, data: mk(2000000) })), 'u-sales');
      assert.equal(atTarget.kpiBreakdown.salesKpi.salesScore, 1);
      assert.equal(way.kpiBreakdown.salesKpi.salesScore, 1);
      assert.equal(atTarget.incentiveEarned, way.incentiveEarned);
      assert.equal(way.kpiScore, r2(0.7 + 0.27));
    });
    it('a perfect month (target beaten, five stars) pays exactly the full incentive — never more', async () => {
      const d = seed();
      d.sales_orders.o5 = { flowVersion: 2, status: 'recorded', company: 'BK', clientName: 'Big Co', createdBy: 'u-sales', recordedAmount: 2000000, recordedAt: ts('2026-10-14T02:00:00Z'), paymentConfirm: confirmation() };
      d.client_ratings.r1.stars = 5; d.client_ratings.r2.stars = 5;
      const u = lineOf(await build(makeEnv({ pay: true, data: d })), 'u-sales');
      assert.equal(u.kpiScore, 1);
      assert.equal(u.incentiveEarned, u.incentiveFull);
      assert.equal(u.incentiveEarned, 8000);
    });
    it('no payments at all: the sales score is 0 and the incentive is whatever the ratings alone earn (0.3 × 90% of 8,000)', async () => {
      const u = lineOf(await build(makeEnv({ pay: true, data: seed({ sales_orders: {}, payment_claims: {}, job_projects: {} }) })), 'u-sales');
      assert.equal(u.kpiBreakdown.salesKpi.salesScore, 0);
      assert.equal(u.kpiScore, r2(0.3 * 0.9));
      assert.equal(u.base, 10000);
    });
    it('a month with no ratings pays on the sales score alone', async () => {
      const u = lineOf(await build(makeEnv({ pay: true, data: seed({ client_ratings: {} }) })), 'u-sales');
      assert.equal(u.kpiScore, 0.5);
      assert.equal(u.incentiveEarned, 4000);
      assert.equal(u.kpiBreakdown.salesKpi.mode, 'sales-only');
    });
  });

  describe('REFUSALS: nothing is built, nothing is written, and the task KPI is never used', () => {
    const NO_TARGET = 'Set the sales target for October 2026 first (Finance › Payroll & HR › Sales KPI)';
    it('no target for the month: buildPayRunLines rejects with the words the screen shows, and no line comes back', async () => {
      const env = makeEnv({ pay: true, data: seed({ sales_kpi: { 'u-sales': { ...CARD, defaultTarget: null } } }) });
      assert.equal((await thrown(build(env))).message, NO_TARGET);
      assert.ok(!env.kpiCalls.some((a) => a[0].some((t) => t.assignedTo === 'u-sales')), 'the task KPI was computed for him instead');
    });
    it('no target: computePayRun (the writer) refuses too, and pay_runs is not touched', async () => {
      const env = makeEnv({ pay: true, data: seed({ sales_kpi: { 'u-sales': { ...CARD, defaultTarget: null } } }) });
      assert.equal((await thrown(env.w.computePayRun(MONTH, { policy: 'basekpi' }))).message, NO_TARGET);
      assert.deepEqual(env.db.writes, []);
    });
    it('a single-month target set for the month lifts the refusal without a default (the President\'s "single month" row)', async () => {
      const env = makeEnv({ pay: true, data: seed({ sales_kpi: { 'u-sales': { ...CARD, defaultTarget: null, targets: { [MONTH]: 400000 } } } }) });
      assert.equal(lineOf(await build(env), 'u-sales').kpiScore, KPI);
    });
    for (const p of ['sales_kpi/u-sales', 'sales_orders', 'payment_claims', 'job_projects', 'client_ratings', 'users']) {
      it(`${p} unreadable: the run is refused (a rejection), the task KPI is never used for Uriel, and computePayRun writes nothing`, async () => {
        const fail = (c, id) => (id ? `${c}/${id}` : c) === p;
        const env = makeEnv({ pay: true, fail });
        const e = await thrown(build(env));
        assert.match(e.message, /^Could not read .+ — nothing was worked out\. Try again in a moment\.$/);
        assert.ok(!env.kpiCalls.some((a) => a[0].some((t) => t.assignedTo === 'u-sales')), 'the task KPI was computed for him as a fallback');
        const env2 = makeEnv({ pay: true, fail });
        await thrown(env2.w.computePayRun(MONTH, { policy: 'basekpi' }));
        assert.deepEqual(env2.db.writes, []);
      });
    }
    it('a read that fails for someone ELSE\'s document refuses the whole run too (every person is resolved before anything is written)', async () => {
      const env = makeEnv({ pay: true, fail: (c, id) => c === 'sales_kpi' && id === 'u-none' });
      assert.match((await thrown(build(env))).message, /Could not read the Sales KPI setting/);
    });
    it('the engine missing from the page: the run is refused, not paid on tasks', async () => {
      const env = makeEnv({ pay: true });
      env.ctx.SalesKpi = undefined;
      assert.match((await thrown(build(env))).message, /Sales KPI engine did not load/);
    });
  });

  describe('computePayRun (the writer) freezes the working onto pay_runs/{month}', () => {
    it('writes state "computed" with every line, Uriel\'s carrying kpiSource + salesKpi, and not one undefined value', async () => {
      const env = makeEnv({ pay: true });
      const res = await env.w.computePayRun(MONTH, { policy: 'basekpi' });
      assert.equal(env.db.writes.length, 1);
      const w = env.db.writes[0];
      assert.equal(w.path, 'pay_runs/' + MONTH);
      assert.equal(w.data.state, 'computed');
      const frozen = w.data.lines.find((l) => l.uid === 'u-sales');
      assert.equal(frozen.kpiScore, KPI);
      assert.deepEqual(frozen.kpiBreakdown, { doneInM: 4, inScopeCount: 4, deliverableScore: null, kpiSource: 'sales', salesKpi: WORKING });
      assert.deepEqual(undefinedPaths(w.data.lines), []);
      assert.equal(res.lines.length, 4);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  B2 · a finalised or paid month shows its FROZEN line and is never recomputed (js/payroll.js Payroll.preview, js/departments.js computePayRun)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('B2 · a checked or paid month is read back frozen; a refusal from the builder can never hide it', () => {
  const NO_TARGET_CARD = { ...CARD, defaultTarget: null };
  async function engine(state, { card = NO_TARGET_CARD } = {}) {
    const lines = (await build(makeEnv({ pay: true }))).lines;                     // frozen while a target existed: Uriel on the Sales KPI
    const env = makeEnv({ pay: true, data: seed({ sales_kpi: { 'u-sales': card }, pay_runs: { [MONTH]: { month: MONTH, state, payPolicy: 'basekpi', lines: plain(lines), excluded: {} } } }) });
    vm.runInContext(read('js/payroll.js'), env.ctx, { filename: 'js/payroll.js' });
    let builderCalls = 0;
    const real = env.w.buildPayRunLines;
    env.w.buildPayRunLines = (...a) => { builderCalls++; return real(...a); };
    return { env, calls: () => builderCalls };
  }
  for (const [raw, shown] of [['verified', 'checked'], ['disbursing', 'checked'], ['disbursed', 'paid']]) {
    it(`state "${raw}" (shown as ${shown}): preview returns the stored lines, the builder is never run, and no Sales-KPI read happens — even with no sales target`, async () => {
      const { env, calls } = await engine(raw);
      const p = await env.w.Payroll.preview(MONTH);
      assert.equal(p.state, shown);
      assert.equal(calls(), 0, 'the builder (and so the resolver) was run for a finalised month');
      assert.ok(!env.db.reads.some((r) => /^sales_kpi|^sales_orders|^payment_claims|^client_ratings/.test(r.path)));
      const u = p.lines.find((l) => l.personId === 'u-sales');
      assert.equal(u.detail.kpiScore, 0.62);
      assert.equal(u.kpiBreakdown.kpiSource, 'sales');
      assert.deepEqual(plain(u.kpiBreakdown.salesKpi), WORKING);
    });
  }
  it('a month that can still be prepared ("computed") IS previewed through the builder as ever — and a missing target refuses it', async () => {
    const { env, calls } = await engine('computed');
    assert.match((await thrown(env.w.Payroll.preview(MONTH))).message, /^Set the sales target for October 2026 first/);
    assert.equal(calls(), 1);
  });
  it('a month with no run document at all is previewed through the builder too', async () => {
    const env = makeEnv({ pay: true, data: seed({ pay_runs: {} }) });
    vm.runInContext(read('js/payroll.js'), env.ctx, { filename: 'js/payroll.js' });
    const p = await env.w.Payroll.preview(MONTH);
    assert.equal(p.live, true);
    assert.equal(p.lines.find((l) => l.personId === 'u-sales').detail.kpiScore, 0.62);
  });
  for (const state of ['verified', 'disbursing', 'disbursed']) {
    it(`computePayRun refuses a "${state}" run before it reads or writes anything (the frozen line is never overwritten)`, async () => {
      const { env } = await engine(state, { card: CARD });
      const e = await thrown(env.w.computePayRun(MONTH, { policy: 'basekpi' }));
      assert.match(e.message, new RegExp(`Run is ${state} — President must Reopen first\\.`));
      assert.deepEqual(env.db.writes, []);
      assert.ok(!env.db.reads.some((r) => /^sales_/.test(r.path)));
    });
  }
  it('the guard is only for months: the weekly engine is not touched', () => {
    assert.ok(stripComments(read('js/payroll.js')).includes("if (kind !== 'week' && d && !PC.canPrepare(PC.stateOf(d.state))) return Payroll.load(periodId);"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  C · carry-through: the working survives the normalised line and reads right everywhere it is printed
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const nodeRequire = createRequire(import.meta.url);
globalThis.window = globalThis;
window.bizYear = () => 2026;
nodeRequire('../js/statutory-tables.js');
const money = nodeRequire('../js/money-core.js');
nodeRequire('../js/sales-kpi-core.js');
const payPolicy = nodeRequire('../js/pay-policy.js');
const PC = nodeRequire('../js/payroll.js');

describe('C · carry-through: PC.normalizeLine, the phone-card breakdown, payBasisSentence, salesKpiWords, the payslip', () => {
  // A frozen Office line as pay_runs holds it: computePayLine's output + the additive fields buildPayRunLines attaches.
  const frozenLine = (emp, kpiScore, kpiBreakdown, over = {}) => ({
    ...money.computePayLine(emp, { month: MONTH, policy: 'basekpi', kpiScore, attScore: 0, caPlan: [], caBalance: undefined }),
    tinNum: '', ssNum: '', phNum: '', pagibigNum: '', employmentStatus: '', statutoryBasis: '', statusFlag: null, kpiBreakdown, ...over,
  });
  const SALES_BREAKDOWN = { doneInM: 4, inScopeCount: 4, deliverableScore: null, kpiSource: 'sales', salesKpi: WORKING };
  const salesLine = (over) => frozenLine(PAID[0], KPI, SALES_BREAKDOWN, over);
  const taskLine = () => frozenLine(PAID[1], 0.6466666666666666, { doneInM: 2, inScopeCount: 3, deliverableScore: 60 });

  describe('PC.normalizeLine (js/payroll.js)', () => {
    it('a Sales-KPI line: kpiBreakdown keeps its three keys and gains kpiSource + salesKpi, intact', () => {
      const row = PC.normalizeLine(salesLine(), 'month');
      assert.deepEqual(row.kpiBreakdown, { doneInM: 4, inScopeCount: 4, deliverableScore: null, kpiSource: 'sales', salesKpi: WORKING });
      assert.equal(row.detail.kpiScore, 0.62);
      assert.equal(row.detail.incentiveEarned, 4960);
    });
    it('every other line keeps EXACTLY its three keys — no kpiSource, not even an undefined one', () => {
      for (const l of [taskLine(), ...GOLDEN.basekpi.lines.map((g) => ({ ...money.computePayLine(PAID.find((p) => p.id === g.uid), { month: MONTH, policy: 'basekpi', kpiScore: g.kpiScore, attScore: 0, caPlan: [], caBalance: undefined }), ...g }))]) {
        const row = PC.normalizeLine(l, 'month');
        assert.deepEqual(Object.keys(row.kpiBreakdown), ['doneInM', 'inScopeCount', 'deliverableScore'], l.uid);
        assert.deepEqual(row.kpiBreakdown, { doneInM: l.kpiBreakdown.doneInM, inScopeCount: l.kpiBreakdown.inScopeCount, deliverableScore: l.kpiBreakdown.deliverableScore });
      }
    });
    it('a line with no kpiBreakdown (a period prepared before it existed) is null, as before; a weekly line is null', () => {
      assert.equal(PC.normalizeLine(frozenLine(PAID[1], 1, undefined), 'month').kpiBreakdown, null);
      assert.equal(PC.normalizeLine(frozenLine(PAID[1], 1, null), 'month').kpiBreakdown, null);
    });
    it('a line marked "sales" whose working is missing is still recognised as a Sales-KPI line (salesKpi null) — never shown with task wording', () => {
      const row = PC.normalizeLine(salesLine({ kpiBreakdown: { doneInM: 1, inScopeCount: 1, deliverableScore: null, kpiSource: 'sales' } }), 'month');
      assert.deepEqual(row.kpiBreakdown, { doneInM: 1, inScopeCount: 1, deliverableScore: null, kpiSource: 'sales', salesKpi: null });
      assert.ok(!row.breakdown.some((r) => r.label === 'KPI working'), 'working lines were invented');
      assert.match(row.breakdown.find((r) => r.label === 'How this was worked out').text, /confirmed sales 70%, client rating 30%/);
    });
    it('a kpiSource other than "sales" is not copied through', () => {
      const row = PC.normalizeLine(salesLine({ kpiBreakdown: { ...SALES_BREAKDOWN, kpiSource: 'tasks' } }), 'month');
      assert.deepEqual(Object.keys(row.kpiBreakdown), ['doneInM', 'inScopeCount', 'deliverableScore']);
    });
  });

  describe('the phone card\'s breakdown (PC.breakdownOf)', () => {
    const rowsOf = (l) => PC.normalizeLine(l, 'month').breakdown;
    it('a Sales-KPI line prints the two working lines straight under the KPI score, and the sales words in the sentence', () => {
      const rows = rowsOf(salesLine());
      const at = rows.findIndex((r) => r.label === 'KPI score');
      assert.equal(rows[at].text, '62%');
      assert.deepEqual(rows.slice(at + 1, at + 3).map((r) => [r.label, r.kind, r.text]), [
        ['KPI working', 'info', 'Sales: ₱200,000.00 confirmed of ₱400,000.00 target = 50% (counts 70%)'],
        ['KPI working', 'info', 'Client rating: 4.5 of 5 from 2 clients = 90% (counts 30%)'],
      ]);
      const sentence = rows.find((r) => r.label === 'How this was worked out').text;
      assert.equal(sentence, '₱10,000.00 base paid in full; the remaining ₱8,000.00 is multiplied by this month\'s KPI score (confirmed sales 70%, client rating 30%). Attendance does not affect pay.');
      assert.ok(!/tasks 70%/.test(JSON.stringify(rows)), 'task wording on a Sales-KPI card');
    });
    it('a month with no ratings says so, in the owner\'s words', () => {
      const wk = { ...WORKING, avgStars: null, ratingCount: 0, satScore: null, mode: 'sales-only' };
      const rows = rowsOf(salesLine({ kpiScore: 0.5, kpiBreakdown: { ...SALES_BREAKDOWN, salesKpi: wk } }));
      const working = rows.filter((r) => r.label === 'KPI working').map((r) => r.text);
      assert.deepEqual(working, ['Sales: ₱200,000.00 confirmed of ₱400,000.00 target = 50% (counts 100%)', 'No client ratings this month, so the KPI is the sales score only.']);
    });
    it('the last-three-months rating says so', () => {
      const rows = rowsOf(salesLine({ kpiBreakdown: { ...SALES_BREAKDOWN, salesKpi: { ...WORKING, ratingWindow: 'previous' } } }));
      assert.match(rows.filter((r) => r.label === 'KPI working')[1].text, /^Client rating: no ratings this month, so the last 3 months count: 4\.5 of 5 from 2 clients = 90% \(counts 30%\)$/);
    });
    it('an Adjust override: the score row is the number pay used, the working lines are what was computed', () => {
      const rows = rowsOf(salesLine({ kpiScore: 0.2, kpiBreakdown: SALES_BREAKDOWN }));
      assert.equal(rows.find((r) => r.label === 'KPI score').text, '20%');
      assert.match(rows.find((r) => r.label === 'KPI working').text, /^Sales: ₱200,000\.00 confirmed of ₱400,000\.00 target = 50%/);
    });
    it('every other line\'s breakdown is untouched: no working rows, the task sentence, the same labels in the same order', () => {
      const rows = rowsOf(taskLine());
      assert.ok(!rows.some((r) => r.label === 'KPI working'));
      assert.deepEqual(rows.map((r) => r.label), ['Salary', 'Allowance', 'KPI score', 'Incentive (full)', 'Incentive earned at KPI 65%', 'How this was worked out', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding tax', 'Other deductions', 'Cash advance', 'Take-home pay']);
      assert.match(rows.find((r) => r.label === 'How this was worked out').text, /\(tasks 70%, deliverables 30%\)/);
    });
  });

  describe('window.payBasisSentence (js/pay-policy.js)', () => {
    const base = { policy: 'basekpi', base: 10000, allowance: 8000, incentiveFull: 8000, kpiFactor: 0.62, incentiveEarned: 4960 };
    const TASK_WORDS = '₱10,000.00 base paid in full; the remaining ₱8,000.00 is multiplied by this month\'s KPI score (tasks 70%, deliverables 30%). Attendance does not affect pay.';
    const SALES_WORDS = '₱10,000.00 base paid in full; the remaining ₱8,000.00 is multiplied by this month\'s KPI score (confirmed sales 70%, client rating 30%). Attendance does not affect pay.';
    it('kpiSource "sales" reads "(confirmed sales 70%, client rating 30%)"; absent, "tasks" or anything else keeps the sentence it always had', () => {
      assert.equal(payPolicy.payBasisSentence({ ...base, kpiSource: 'sales' }), SALES_WORDS);
      for (const src of [undefined, null, '', 'tasks', 'Sales', 'commission']) assert.equal(payPolicy.payBasisSentence({ ...base, kpiSource: src }), TASK_WORDS, String(src));
      assert.equal(payPolicy.payBasisSentence(base), TASK_WORDS);
    });
    it('the other policies are unchanged by kpiSource: flat and performance say nothing, taskbased keeps its own sentence', () => {
      assert.equal(payPolicy.payBasisSentence({ policy: 'flat', kpiSource: 'sales' }), '');
      assert.equal(payPolicy.payBasisSentence({ policy: 'performance', kpiSource: 'sales' }), '');
      const tb = { policy: 'taskbased', perfFactor: 0.7, kpiScore: 0.8, attScore: 0.5, preMultiplierNet: 10000, netBeforeCA: 7000 };
      assert.equal(payPolicy.payBasisSentence({ ...tb, kpiSource: 'sales' }), payPolicy.payBasisSentence(tb));
    });
  });

  describe('window.salesKpiWords (js/pay-policy.js): the scorecard\'s own sentence, read off the frozen working', () => {
    it('it is exactly what SalesKpi.sentence printed for that month — pay line and scorecard cannot describe a month two ways', async () => {
      for (const [label, data] of [
        ['blend', seed()],
        ['no ratings', seed({ client_ratings: {} })],
        ['last three months', seed({ client_ratings: { r9: { projectId: 'r9', clientName: 'Old Co', company: 'BK', salesUid: 'u-sales', stars: 4, approved: true, approvedAt: ts('2026-09-15T04:00:00Z') } } })],
        ['target beaten', (() => { const d = seed(); d.sales_orders.o5 = { flowVersion: 2, status: 'recorded', company: 'BK', clientName: 'Big', createdBy: 'u-sales', recordedAmount: 2000000, recordedAt: ts('2026-10-14T02:00:00Z'), paymentConfirm: confirmation() }; return d; })()],
      ]) {
        const r = await resolve(makeEnv({ data }));
        const words = payPolicy.salesKpiWords({ kpiSource: 'sales', salesKpi: plain(r.salesKpi) }, r.kpiScore, MONTH);
        assert.deepEqual(plain(words), plain(r.breakdown.sentence), label);
      }
    });
    it('the headline is the score pay used (an override shows), the lines stay the computed working', () => {
      const w = payPolicy.salesKpiWords({ kpiSource: 'sales', salesKpi: WORKING }, 0.2);
      assert.equal(w.headline, 'KPI 20%');
      assert.equal(w.sales, 'Sales: ₱200,000.00 confirmed of ₱400,000.00 target = 50% (counts 70%)');
    });
    it('null for a line that is not a Sales-KPI line, for a missing working, and when the engine is not loaded', () => {
      assert.equal(payPolicy.salesKpiWords(null, 0.5), null);
      assert.equal(payPolicy.salesKpiWords({ doneInM: 1 }, 0.5), null);
      assert.equal(payPolicy.salesKpiWords({ kpiSource: 'tasks', salesKpi: WORKING }, 0.5), null);
      assert.equal(payPolicy.salesKpiWords({ kpiSource: 'sales', salesKpi: null }, 0.5), null);
      const keep = window.SalesKpi; window.SalesKpi = undefined;
      try { assert.equal(payPolicy.salesKpiWords({ kpiSource: 'sales', salesKpi: WORKING }, 0.5), null); } finally { window.SalesKpi = keep; }
    });
    it('plain text only: nothing in it to escape and no client name', () => {
      const w = payPolicy.salesKpiWords({ kpiSource: 'sales', salesKpi: WORKING }, KPI);
      assert.ok(!/[<>&"]/.test(w.lines.join('')));
    });
  });

  describe('the salary_history mirror and the payslip (js/screens/hr.js)', () => {
    const HR = read('js/screens/hr.js');
    const NOT_ON_FILE = piece(HR, /^function _notOnFile\(v\) \{[\s\S]*?\n\}\n/m, '_notOnFile in js/screens/hr.js');
    const TO_MODEL = piece(HR, /^window\.toPayslipModel = function\(source, kind\) \{[\s\S]*?\n\};\n/m, 'window.toPayslipModel in js/screens/hr.js');
    const TO_HTML = piece(HR, /^window\.buildPayslipHTML = function\(model\) \{[\s\S]*?\n\};\n/m, 'window.buildPayslipHTML in js/screens/hr.js');
    const slip = (() => {
      const ctx = vm.createContext({ console: { log() {}, info() {}, warn() {}, error() {} } });
      ctx.window = ctx;
      ctx.escHtml = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      ctx.window.fmtMonthLabel = (m) => m;
      ctx.window.bizYear = () => 2026;
      for (const f of ['js/sales-kpi-core.js', 'js/pay-policy.js']) vm.runInContext(read(f), ctx, { filename: f });
      for (const src of [NOT_ON_FILE, TO_MODEL, TO_HTML]) vm.runInContext(src, ctx);
      return { model: (source) => ctx.window.toPayslipModel(source, 'monthly'), html: (m) => ctx.window.buildPayslipHTML(m) };
    })();
    // The mirror disbursePayRun writes, built by the REAL conditional spread out of departments.js (found by its text, so a rewrite of it fails here loudly).
    const SPREAD = piece(DEPT, /\.\.\.\(line\.kpiBreakdown && line\.kpiBreakdown\.kpiSource === 'sales' \? \{ kpiSource: 'sales', salesKpi: line\.kpiBreakdown\.salesKpi \} : \{\}\),/, 'the salary_history mirror\'s Sales-KPI spread in disbursePayRun');
    const mirrorOf = (line) => ({
      userId: line.uid, userName: line.name, month: MONTH, salary: line.base, allowance: line.allowance, deductions: line.otherDeductions,
      sss: line.sss, philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax, er: line.er, kpiScore: line.kpiScore, attScore: line.attScore, perfFactor: line.perfFactor,
      preMultiplierNet: line.preMultiplierNet ?? null, kpiFactor: line.kpiFactor ?? null, incentiveFull: line.incentiveFull ?? null, incentiveEarned: line.incentiveEarned ?? null,
      ...new Function('line', `return ({ ${SPREAD.replace(/,$/, '')} });`)(line),
      policy: line.policy, runMonth: MONTH, caDeducted: line.caPlanned, netPay: line.netBeforeCA, finalPay: line.finalPay,
    });
    it('the mirror of a Sales-KPI line carries kpiSource + salesKpi; the mirror of any other line gains no key at all', () => {
      const m = mirrorOf(salesLine());
      assert.equal(m.kpiSource, 'sales');
      assert.deepEqual(plain(m.salesKpi), WORKING);
      const t = mirrorOf(taskLine());
      assert.ok(!('kpiSource' in t) && !('salesKpi' in t));
      assert.ok(!('kpiSource' in mirrorOf(frozenLine(PAID[1], 1, undefined))));
    });
    it('toPayslipModel: a pay_runs line (kpiBreakdown) and a salary_history mirror (top level) give the same Sales-KPI performance block; other lines gain no key', () => {
      const fromRun = slip.model({ ...salesLine(), uid: 'u-sales', month: MONTH });
      const fromMirror = slip.model({ ...mirrorOf(salesLine()), uid: 'u-sales' });
      for (const m of [fromRun, fromMirror]) {
        assert.equal(m.performance.kpiSource, 'sales');
        assert.deepEqual(plain(m.performance.salesKpi), WORKING);
        assert.equal(m.performance.kpi, 0.62);
        assert.equal(m.performance.incentiveEarned, 4960);
      }
      const t = slip.model({ ...taskLine(), uid: 'u-task', month: MONTH });
      assert.ok(!('kpiSource' in t.performance) && !('salesKpi' in t.performance));
    });
    it('the printed payslip: the working lines and the sales words for a Sales-KPI month; the task words and no working for any other', () => {
      const html = slip.html(slip.model({ ...mirrorOf(salesLine()), uid: 'u-sales' }));
      assert.ok(html.includes('Sales: ₱200,000.00 confirmed of ₱400,000.00 target = 50% (counts 70%)'));
      assert.ok(html.includes('Client rating: 4.5 of 5 from 2 clients = 90% (counts 30%)'));
      assert.ok(html.includes('(confirmed sales 70%, client rating 30%)'));
      assert.ok(!html.includes('tasks 70%'));
      const task = slip.html(slip.model({ ...taskLine(), uid: 'u-task', month: MONTH }));
      assert.ok(task.includes('(tasks 70%, deliverables 30%)'));
      assert.ok(!task.includes('Client rating') && !task.includes('Sales:'));
    });
    it('a payslip under a non-basekpi policy (flat): the KPI row says "Sales KPI" for a Sales-KPI month and "Task KPI (70%)" for any other', () => {
      const flatSales = slip.html(slip.model({ ...mirrorOf(salesLine({ policy: 'flat' })), policy: 'flat', uid: 'u-sales' }));
      assert.ok(flatSales.includes('<td>Sales KPI</td>') && !flatSales.includes('Task KPI (70%)'));
      const flatTask = slip.html(slip.model({ ...mirrorOf(taskLine()), policy: 'flat', uid: 'u-task' }));
      assert.ok(flatTask.includes('Task KPI (70%)') && !flatTask.includes('Sales KPI'));
    });
    it('PAYSLIP-BASE-FIX: a basekpi payslip names the real base and incentive in its sentence — never "₱0.00 base" (pay_runs line and salary_history mirror alike)', () => {
      for (const [label, src] of [
        ['sales, mirror', { ...mirrorOf(salesLine()), uid: 'u-sales' }],
        ['sales, run line', { ...salesLine(), uid: 'u-sales', month: MONTH }],
        ['task, mirror', { ...mirrorOf(taskLine()), uid: 'u-task' }],
        ['task, run line', { ...taskLine(), uid: 'u-task', month: MONTH }],
      ]) {
        const html = slip.html(slip.model(src));
        assert.ok(html.includes('₱10,000.00 base paid in full; the remaining ₱8,000.00 is multiplied'), label);
        assert.ok(!html.includes('₱0.00 base paid in full'), label);
      }
    });
    it('a Sales-KPI line whose working is missing prints no invented lines and does not crash', () => {
      const html = slip.html(slip.model({ ...mirrorOf(salesLine()), salesKpi: null, uid: 'u-sales' }));
      assert.ok(!html.includes('Sales: ₱') && !html.includes('Client rating'));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  D · the display callers: one person, one KPI — the Sales KPI when it is in force, "KPI unavailable" when it cannot be read, never the task KPI
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const DASH = read('js/screens/dashboards.js');
const PEOPLE = read('js/screens/people.js');
const HRSRC = read('js/screens/hr.js');
const GET_KPI_SCORE = extract(DASH, 'async function getKpiScore(uid, preTasks, preKpiSnap)');
const GET_KPI_INFO = extract(DASH, 'async function getKpiInfo(uid, preTasks, preKpiSnap)');
const MY_FINANCE = extract(DASH, 'window.renderPersonalFinance = async function(currentUser, currentRole, opts)') + ';';
const EMP_DASH = extract(DASH, 'async function renderEmployeeDashboard()');
const WORKER_TAB = extract(DASH, 'async function renderWorkerProfileTab(uid, name, preloaded, tabName, panel)');
const ANALYTICS = extract(PEOPLE, 'window.renderPersonalAnalytics = async function(host, uid)') + ';';
const EOM_CONST = piece(PEOPLE, /^const EOM_KPI_ONLY_FROM = '[\d-]+';$/m, 'EOM_KPI_ONLY_FROM in js/screens/people.js');
const EOM_LABEL = extract(PEOPLE, 'function eomMonthLabel(ym)');
const EOM_STANDINGS = extract(PEOPLE, 'async function computeEomStandings(users, monthStr)');

const NOW = '2026-10-20';                      // "today" for the screens: the first month paid on the Sales KPI (CARD.startMonth)
const tasksFor = (uid, n, done) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`t-${uid}-${i}`, { assignedTo: [uid], status: i < done ? 'done' : 'open', _dm: i < done ? MONTH : null, _cm: '' }]));
// The made-up world for the screens: Uriel's four tasks are all done (his TASK KPI would read 100%), his Sales KPI reads 62%.
const uiSeed = (over = {}) => seed({ tasks: { ...tasksFor('u-sales', 4, 4), ...tasksFor('u-task', 3, 2) }, settings: { payrollOfficePolicy: { policy: 'basekpi' } }, salary_history: {}, cash_advances: {}, kpi_evals: {}, salary_raises: {}, ...over });
const MIRROR = { userId: 'u-sales', userName: 'Uriel Sales', month: MONTH, salary: 10000, allowance: 8000, deductions: 0, sss: 900, philhealth: 450, pagibig: 200, tax: 0, kpiScore: KPI, attScore: 0, perfFactor: 0.434, preMultiplierNet: null, kpiFactor: KPI, incentiveFull: 8000, incentiveEarned: 4960, policy: 'basekpi', runMonth: MONTH, caDeducted: 0, netPay: 13410, finalPay: 13410 };

function makeUiEnv({ data = uiSeed(), who = URIEL, fail, ui = false, noInfo = false } = {}) {
  const env = makeEnv({ data, who, fail, pay: true, ui });
  const { ctx, w } = env;
  const el = () => new Proxy({ innerHTML: '', textContent: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
    { get: (t, k) => (k in t ? t[k] : () => null), set: (t, k, v) => { t[k] = v; return true; } });
  const page = el();
  env.page = page;
  Object.assign(ctx, {
    bizDate: () => NOW, isPresident: () => ctx.currentRole === 'president', countWorkDays: (y, m, d) => d, _dashWarnOnce() {}, liveDateTime() {}, renderMiniCal() {}, DEPARTMENTS: {},
    userProfile: { displayName: who.uid === 'u-sales' ? 'Uriel Sales' : 'Someone', salary: 10000, allowance: 8000, deductions: 0, payClass: 'regular', employeeId: 'E-1' },
    formatNum: (n) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    escHtml: (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    emojiIcon: (g) => g, Notifs: { success() {}, showToast() {}, send: async () => {} }, openPage: () => el(), confirmDialog: async () => false, navigateTo() {},
    document: { getElementById: (id) => (id === 'page-content' ? page : el()), querySelectorAll: () => [], querySelector: () => null },
  });
  Object.assign(w, { bizDate: ctx.bizDate, iconTile: () => '', isLaidOff: () => false, caScope: (q) => q, skeletonHtml: () => '' });
  for (const src of [GET_KPI_SCORE, ...(noInfo ? [] : [GET_KPI_INFO]), EMP_DASH, WORKER_TAB, EOM_CONST, EOM_LABEL, EOM_STANDINGS, ANALYTICS]) vm.runInContext(src, ctx);
  vm.runInContext(MY_FINANCE, ctx);
  return env;
}
const text = (html) => String(html).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const SALES_LINE = 'Sales: ₱200,000.00 confirmed of ₱400,000.00 target = 50% (counts 70%)';
const RATING_LINE = 'Client rating: 4.5 of 5 from 2 clients = 90% (counts 30%)';
const RATINGS_DOWN = (c) => c === 'client_ratings';

describe('D · getKpiInfo (js/screens/dashboards.js) — the one place a screen asks "whose KPI is this"', () => {
  it('the Sales KPI in force: source "sales", the score pay uses, and the task KPI is NOT worked out', async () => {
    const env = makeUiEnv();
    let taskCalls = 0;
    env.ctx.getKpiScore = async () => { taskCalls++; return 1; };
    const k = await env.ctx.getKpiInfo('u-sales');
    assert.equal(k.source, 'sales');
    assert.equal(k.score, KPI);
    assert.equal(k.sales.kpiScore, KPI);
    assert.equal(taskCalls, 0);
  });
  it('not in force: source "tasks" with the task KPI exactly as getKpiScore answers', async () => {
    const env = makeUiEnv({ data: uiSeed({ sales_kpi: {} }) });
    env.ctx.getKpiScore = async (uid, tasks, snap) => ['task-kpi', uid, tasks, snap];
    const k = await env.ctx.getKpiInfo('u-sales', ['t'], 'snap');
    assert.deepEqual(plain(k), { source: 'tasks', score: ['task-kpi', 'u-sales', ['t'], 'snap'], sales: null });
  });
  it('cannot be read: source "unavailable", score null — and the task KPI is never asked for', async () => {
    const env = makeUiEnv({ fail: RATINGS_DOWN });
    let taskCalls = 0;
    env.ctx.getKpiScore = async () => { taskCalls++; return 1; };
    const k = await env.ctx.getKpiInfo('u-sales');
    assert.equal(k.source, 'unavailable');
    assert.equal(k.score, null);
    assert.match(k.error.message, /Could not read the client ratings/);
    assert.equal(taskCalls, 0, 'the task KPI was used as a fallback');
  });
  it('no display caller asks for the task KPI directly: getKpiScore is called from getKpiInfo and nowhere else', () => {
    const code = (src) => stripComments(src);
    assert.equal((code(DASH).match(/\bgetKpiScore\(/g) || []).length, 2, 'the definition + the one call in getKpiInfo');
    assert.equal((code(PEOPLE).match(/\bgetKpiScore\b/g) || []).length, 0);
  });
});

describe('D · My Finance (renderPersonalFinance) — the employee\'s own page', () => {
  const run = async (env, history = {}) => { await env.ctx.window.renderPersonalFinance({ uid: 'u-sales', email: 'u@example.test' }, 'employee', { host: env.page, selfOnly: true }); return env.page.innerHTML; };
  it('Sales KPI in force: the KPI card, the compact scorecard (KPI %, sales line, rating line), the sales words — and not one task KPI', async () => {
    const html = await run(makeUiEnv());
    const t = text(html);
    assert.ok(/Sales KPI 62%/.test(t), 'the KPI card says Sales KPI 62%');
    assert.ok(t.includes('KPI 62%') && t.includes(SALES_LINE) && t.includes(RATING_LINE), 'the compact scorecard');
    assert.ok(t.includes('Your KPI is your Sales KPI — confirmed sales 70%, client rating 30%. Tasks do not count toward it.'));
    assert.ok(t.includes('(confirmed sales 70%, client rating 30%)'), 'the pay explanation names the right parts');
    assert.ok(t.includes('KPI Factor — Sales KPI'));
    for (const banned of ['Task KPI', 'Tasks Completed', 'tasks 70%', 'task completion', '4 of 4', 'Expected Outcome', 'done this month']) assert.ok(!t.includes(banned), `the task KPI leaked into the Sales-KPI page: "${banned}"`);
    assert.ok(!html.includes('Acme') && !html.includes('Beta'), 'a client name on the employee page');
  });
  it('the compact scorecard is drawn by SalesKpiUI when it is loaded (badge "Used for pay"), and as the same plain lines when it is not', async () => {
    const withUi = text(await run(makeUiEnv({ ui: true })));
    assert.ok(withUi.includes('Used for pay') && withUi.includes(SALES_LINE) && withUi.includes(RATING_LINE));
    const without = text(await run(makeUiEnv()));
    assert.ok(!without.includes('Used for pay') && without.includes(SALES_LINE) && without.includes(RATING_LINE));
  });
  it('a month with no ratings says so on the page', async () => {
    const t = text(await run(makeUiEnv({ data: uiSeed({ client_ratings: {} }) })));
    assert.ok(t.includes('KPI 50%') && t.includes('Sales: ₱200,000.00 confirmed of ₱400,000.00 target = 50% (counts 100%)') && t.includes('No client ratings this month, so the KPI is the sales score only.'));
  });
  it('the Sales KPI cannot be read: "KPI unavailable" everywhere the KPI would be — no number, no task KPI, no projection', async () => {
    const html = await run(makeUiEnv({ fail: RATINGS_DOWN }));
    const t = text(html);
    assert.ok(t.includes('KPI unavailable'));
    assert.ok(/KPI — KPI unavailable/.test(t), 'the KPI card');
    for (const banned of ['Task KPI', 'Tasks Completed', 'tasks 70%', '62%', '100%', '4 of 4', 'done this month', 'Projected Full Month ₱']) assert.ok(!t.includes(banned), `leaked: "${banned}"`);
    assert.ok(t.includes('The projection is unavailable right now'));
  });
  it('no target set for the month: the same "KPI unavailable"', async () => {
    const t = text(await run(makeUiEnv({ data: uiSeed({ sales_kpi: { 'u-sales': { ...CARD, defaultTarget: null } } }) })));
    assert.ok(t.includes('KPI unavailable') && !t.includes('Task KPI'));
  });
  it('someone the Sales KPI does not apply to: the page is the task page, untouched', async () => {
    const html = await run(makeUiEnv({ data: uiSeed({ sales_kpi: {} }) }));
    const t = text(html);
    assert.ok(t.includes('Task KPI 100% 4/4 done this month'), 'the KPI card');
    assert.ok(t.includes('Tasks Completed 4 of 4') && t.includes('Expected Outcome Met'));
    assert.ok(t.includes('(tasks 70%, deliverables 30%)'));
    for (const banned of ['Sales KPI', 'KPI unavailable', 'client rating']) assert.ok(!t.includes(banned), `leaked: "${banned}"`);
  });
  it('a month with Uriel switched off (the card exists, kpiSource "tasks") is the task page too', async () => {
    const t = text(await run(makeUiEnv({ data: uiSeed({ sales_kpi: { 'u-sales': { ...CARD, kpiSource: 'tasks' } } }) })));
    assert.ok(t.includes('Task KPI 100%') && !t.includes('Sales KPI'));
  });
  describe('a FINALISED month shows its frozen line and never recomputes', () => {
    const frozen = (extra = {}) => uiSeed({ salary_history: { [`u-sales_${MONTH}`]: { ...MIRROR, ...extra } } });
    it('the frozen Sales KPI and its frozen working, even when the live answer would be different or unreadable', async () => {
      const mirror = { kpiSource: 'sales', salesKpi: WORKING };
      for (const [label, data, fail] of [
        ['live data unchanged', frozen(mirror), undefined],
        ['live data now different (no payments)', { ...frozen(mirror), sales_orders: {}, payment_claims: {} }, undefined],
        ['live Sales KPI unreadable', frozen(mirror), (c) => c === 'sales_orders' || c === 'client_ratings'],
      ]) {
        const t = text(await run(makeUiEnv({ data, fail })));
        assert.ok(/Sales KPI 62%/.test(t) && t.includes(SALES_LINE) && t.includes(RATING_LINE), label);
        assert.ok(t.includes('Final') && !t.includes('KPI unavailable'), label);
        assert.ok(!t.includes('Task KPI'), label);
      }
    });
    it('PAYSLIP-BASE-FIX: a finalised basekpi month names its frozen base and incentive — never ₱0.00 (sales month and task month)', async () => {
      for (const [label, data] of [['sales', frozen({ kpiSource: 'sales', salesKpi: WORKING })], ['task', frozen({ kpiScore: 0.9 })]]) {
        const t = text(await run(makeUiEnv({ data })));
        assert.ok(t.includes('₱10,000.00 base paid in full; the remaining ₱8,000.00'), label + ': the sentence');
        assert.ok(t.includes('10,000.00 of your pay is a protected base') && t.includes('The remaining ₱8,000.00 is an incentive'), label + ': how your pay is worked out');
        assert.ok(!t.includes('₱0.00 base paid in full') && !t.includes('₱0.00 of your pay is a protected base'), label);
      }
    });
    it('a finalised TASK month (no kpiSource on the mirror) stays a task month even though the Sales KPI is in force now', async () => {
      const t = text(await run(makeUiEnv({ data: frozen({ kpiScore: 0.9 }) })));
      assert.ok(t.includes('Task KPI') && !t.includes('Sales KPI') && !t.includes('Client rating'));
    });
  });
});

describe('D · the employee dashboard\'s KPI card', () => {
  const run = async (env) => { await env.ctx.renderEmployeeDashboard(); return text(env.page.innerHTML); };
  it('Sales KPI in force: 62% and what it is made of — not the task 100%', async () => {
    const t = await run(makeUiEnv());
    assert.ok(t.includes('KPI this month 62%') || /KPI this month\s*62%/.test(t), t.slice(0, 400));
    assert.ok(t.includes('Sales KPI — confirmed sales + client rating'));
    assert.ok(!t.includes('tasks this month') && !t.includes('100%'));
  });
  it('unreadable: "KPI unavailable" and a dash — never 100%', async () => {
    const t = await run(makeUiEnv({ fail: RATINGS_DOWN }));
    assert.ok(t.includes('KPI unavailable') && !t.includes('100%') && !t.includes('62%'));
  });
  it('someone it does not apply to: the task card exactly as before', async () => {
    const t = await run(makeUiEnv({ data: uiSeed({ sales_kpi: {} }) }));
    assert.ok(t.includes('4/4 tasks this month') && t.includes('100%') && !t.includes('Sales KPI') && !t.includes('KPI unavailable'));
  });
});

describe('D · the worker overview and personal analytics (both read getKpiInfo)', () => {
  const panelOf = () => { const content = { innerHTML: '' }, sub = { textContent: '' }; return { content, sub, querySelector: (s) => (s === '#wp-tab-content' ? content : sub) }; };
  const overview = async (env) => { const p = panelOf(); await env.ctx.renderWorkerProfileTab('u-sales', 'Uriel Sales', { salary: 10000, allowance: 8000, deductions: 0, mDone: 4, mTotal: 4 }, 'overview', p); return text(p.content.innerHTML); };
  it('overview: Sales KPI 62% when in force; "KPI unavailable" with no multiplier and no earned figure when not readable; the task card otherwise', async () => {
    const sales = await overview(makeUiEnv({ who: PRES }));
    assert.ok(/Sales KPI 62% confirmed sales \+ client rating/.test(sales) && !sales.includes('Task KPI'));
    const down = await overview(makeUiEnv({ who: PRES, fail: RATINGS_DOWN }));
    assert.ok(/KPI — KPI unavailable/.test(down) && down.includes('× Multiplier (—)') && /Earned So Far —/.test(down) && !down.includes('Task KPI'));
    const tasks = await overview(makeUiEnv({ who: PRES, data: uiSeed({ sales_kpi: {} }) }));
    assert.ok(/Task KPI 100% 4\/4 done/.test(tasks) && !tasks.includes('Sales KPI') && !tasks.includes('unavailable'));
  });
  const analytics = async (env) => { const host = { innerHTML: '' }; await env.ctx.window.renderPersonalAnalytics(host, 'u-sales'); return text(host.innerHTML); };
  it('analytics: the KPI Composite is the Sales KPI with its own caption, or "KPI unavailable"; the task caption otherwise', async () => {
    const sales = await analytics(makeUiEnv());
    assert.ok(/KPI Composite 62% 70% confirmed sales · 30% client rating/.test(sales));
    const down = await analytics(makeUiEnv({ fail: RATINGS_DOWN }));
    assert.ok(/KPI Composite — KPI unavailable/.test(down) && !down.includes('70% tasks'));
    const tasks = await analytics(makeUiEnv({ data: uiSeed({ sales_kpi: {} }) }));
    assert.ok(/KPI Composite 100% 70% tasks · 30% deliverables/.test(tasks));
  });
  it('analytics: if getKpiInfo were somehow not loaded it says "KPI unavailable" — it never assumes a task KPI (the old "0.5 when the function is missing" is gone)', async () => {
    const t = await analytics(makeUiEnv({ noInfo: true }));
    assert.ok(/KPI Composite — KPI unavailable/.test(t) && !t.includes('50%') && !t.includes('70% tasks'));
  });
});

describe('D · the Employee-of-the-Month standings (js/screens/people.js computeEomStandings)', () => {
  const USERS = [
    { id: 'u-sales', displayName: 'Uriel Sales', email: 'u@x.test', role: 'employee', departments: ['Sales'] },
    { id: 'u-task', displayName: 'Tess Task', email: 't@x.test', role: 'employee', departments: ['Design'] },
    { id: 'u-none', displayName: 'Nico None', email: 'n@x.test', role: 'employee', departments: ['IT'] },
  ];
  const standings = async (env) => {
    const w = env.w; w.teamTypeOf = () => 'office'; w.attRecScore = () => 1;
    return env.ctx.computeEomStandings(USERS, MONTH);
  };
  const rank = (s) => plain(s.map((r) => [r.uid, r.taskPct, r.kpiSource || 'tasks']));
  it('the person on the Sales KPI is scored on it (62%, not his 100% task KPI); everyone else on tasks; ranked together', async () => {
    const s = await standings(makeUiEnv({ who: PRES }));
    assert.deepEqual(rank(s), [['u-task', 65, 'tasks'], ['u-sales', 62, 'sales']]);
    assert.match(s[1].citation, /62% KPI \(confirmed sales 70% \/ client rating 30%\)/);
    assert.deepEqual(plain(s.unavailable), []);
  });
  it('not in force: he is ranked on his task KPI like anyone else (100%, first)', async () => {
    const s = await standings(makeUiEnv({ who: PRES, data: uiSeed({ sales_kpi: {} }) }));
    assert.deepEqual(rank(s), [['u-sales', 100, 'tasks'], ['u-task', 65, 'tasks']]);
  });
  it('unreadable: he is NOT ranked (and not scored on tasks, which would put him first) — he is named as "KPI unavailable"', async () => {
    const s = await standings(makeUiEnv({ who: PRES, fail: RATINGS_DOWN }));
    assert.deepEqual(rank(s), [['u-task', 65, 'tasks']]);
    assert.deepEqual(plain(s.unavailable), [{ uid: 'u-sales', displayName: 'Uriel Sales' }]);
  });
  it('with no confirmed payment that month he is not ranked (the analogue of "no in-scope task")', async () => {
    const s = await standings(makeUiEnv({ who: PRES, data: uiSeed({ sales_orders: {}, payment_claims: {} }) }));
    assert.deepEqual(rank(s), [['u-task', 65, 'tasks']]);
  });
});

describe('D · the hr.js "Edit Payroll" working, the Team table and the screens\' labels', () => {
  const code = stripComments(HRSRC);
  it('hr.js Edit Payroll: asks salesKpiState in the same batch as the task reads, shows the sales words / "KPI unavailable" / the unchanged task block', () => {
    assert.ok(code.includes('window.salesKpiState(uid, month)\n          ]);'));
    assert.ok(!code.includes("Promise.resolve({ state: 'tasks' })"), 'a "resolver missing -> assume tasks" fallback');
    assert.ok(code.includes("const kpiScore = kpiSrc === 'sales' ? skState.kpi.kpiScore"));
    assert.ok(code.includes("kpiSrc === 'unavailable' ? null"));
    assert.ok(code.includes('<strong>KPI unavailable</strong> — the Sales KPI could not be read just now'));
    assert.ok(code.includes('KPI score (70% task + 30% deliverable): <strong>${Math.round(kpiScore*100)}%</strong>'), 'the task block is still there for everyone else');
  });
  it('the President\'s Team table (renderPersonalFinance) asks salesKpiState per person and shows "Sales KPI" / "KPI unavailable"', () => {
    const c = stripComments(DASH);
    assert.ok(c.includes('const skSt = await window.salesKpiState(u.id, defaultMonth2);'));
    assert.ok(c.includes("skSt.state === 'sales' ? 'Sales KPI' : skSt.state === 'unavailable' ? 'KPI unavailable'"));
  });
  const SALES_UI = read('js/screens/sales-kpi.js');
  it('SalesKpiUI: a scorecard for a month in force says "Used for pay", any other month keeps "Preview — not yet used for pay"', () => {
    const env = makeEnv({ ui: true });
    const UI = env.w.SalesKpiUI, K = env.w.SalesKpi;
    const compute = (card, month) => K.compute({ cfg: card, month, uid: 'u-sales', orders: [], claims: [], refunds: [], ratings: [], users: [] });
    const html = (b, month) => UI.html.scorecard({ b, title: 'Uriel Sales — scorecard', month, isCurrent: true, open: false, president: true });
    const live = html(compute(CARD, MONTH), MONTH);
    assert.ok(live.includes('Used for pay') && !live.includes('Preview — not yet used for pay'));
    const before = html(compute({ ...CARD, startMonth: '2027-01' }, MONTH), MONTH);
    assert.ok(before.includes('Preview — not yet used for pay') && !before.includes('Used for pay'));
    assert.ok(SALES_UI.includes("const PREVIEW = 'Preview — not yet used for pay';"));
  });
  it('SalesKpiUI.html.compact: the headline, the sales line and the rating line (or the note) — nothing else, no client name', () => {
    const env = makeEnv({ ui: true });
    const UI = env.w.SalesKpiUI;
    const words = env.w.SalesKpi.sentence({ month: MONTH, target: 400000, collected: { total: 200000 }, rating: { n: 2, avg: 4.5, source: 'month' }, score: { mode: 'blend', kpiScore: KPI, salesScore: 0.5, satScore: 0.9, weights: { sales: 0.7, satisfaction: 0.3 } } });
    const t = text(UI.html.compact({ words, label: 'Used for pay' }));
    assert.equal(t, `KPI 62% Used for pay ${SALES_LINE} ${RATING_LINE}`);
    const none = text(UI.html.compact({ words: env.w.SalesKpi.sentence({ month: MONTH, target: 400000, collected: { total: 200000 }, rating: { n: 0, avg: null, source: 'none' }, score: { mode: 'sales-only', kpiScore: 0.5, salesScore: 0.5, satScore: null, weights: { sales: 0.7, satisfaction: 0.3 } } }) }));
    assert.equal(none, 'KPI 50% Sales: ₱200,000.00 confirmed of ₱400,000.00 target = 50% (counts 100%) No client ratings this month, so the KPI is the sales score only.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  E · the frozen engine, and the text pins that keep this change honest
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('E · js/money-core.js is untouched, and the wiring is exactly where it is meant to be', () => {
  it('js/money-core.js is byte-identical to HEAD ab30055 (sha256 pinned). A deliberate, additive edit to it needs its own tests and a new hash here, in the same commit', () => {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'js/money-core.js'))).digest('hex');
    assert.equal(sha, '4cbc8f49fd02aebdc132b6b0ee03a009f6f23d1cf8c67850a942e7c4db386168');
  });
  it('money-core and the weekly (Operations) engine never mention the Sales KPI: the maths still takes ctx.kpiScore and nothing else changed', () => {
    for (const f of ['js/money-core.js', 'js/payroll-weekly.js']) assert.ok(!/SalesKpi|sales_kpi|sales-kpi|salesKpi/.test(read(f)), f);
  });
  describe('buildPayRunLines (textual pins, comments stripped)', () => {
    const code = stripComments(BPRL);
    it('asks the resolver once per employee, for (emp.id, month) and nothing else, and does not catch what it throws', () => {
      assert.equal((code.match(/window\.resolveSalesKpi\(/g) || []).length, 1);
      assert.ok(code.includes('const salesKpi = await window.resolveSalesKpi(emp.id, month);'));
      const between = code.slice(code.indexOf('const salesKpi = await'), code.indexOf('const kpiBreak'));
      assert.ok(!/\b(try|catch)\b|\.catch\(/.test(between), 'the resolver\'s throw is caught between the call and the KPI');
    });
    it('the KPI is the sales score when the resolver answers, and otherwise the task call, character for character; the override still wins', () => {
      assert.ok(code.includes(`const kpiScore = salesKpi
      ? salesKpi.kpiScore
      : window.computeKpiForMonth(userTasks, month,
        kpiTargetD.deliverableScore, window.taskDoneMonth, window.taskCreatedMonth);`));
      assert.ok(code.includes('const kpiEff = ovr?.kpiScore ?? kpiScore;'));
      assert.equal((code.match(/window\.computeKpiForMonth\(/g) || []).length, 1, 'a second task-KPI call');
    });
    it('the working is added to kpiBreakdown only for a Sales-KPI line, as `...(salesKpi ? { kpiSource: \'sales\', salesKpi: salesKpi.salesKpi } : {})`', () => {
      assert.ok(code.includes("...(salesKpi ? { kpiSource: 'sales', salesKpi: salesKpi.salesKpi } : {})"));
    });
  });
  describe('the resolver (textual pins, comments stripped)', () => {
    const code = stripComments(RESOLVE);
    it('reads through the accessor `db`, never window.db.collection (firebase-config\'s top-level const is not on window), never dbCachedGet, and every get is a server read', () => {
      assert.ok(code.includes("const fdb = (typeof db !== 'undefined' && db) ? db : (window.db || null);"));
      assert.ok(!/window\.db\.collection/.test(code) && !/\bdbCachedGet\b/.test(code));
      assert.ok(code.includes("const SERVER = { source: 'server' };") && code.includes('await ref.get(SERVER)'));
      assert.equal((code.match(/\.get\(/g) || []).length, 1, 'a read that is not the server-sourced one');
      assert.ok(!/\.(set|update|delete|add)\(/.test(code), 'the resolver writes');
    });
    it('throws on a failed read and never swallows one: no catch that returns, no `return null` after the switch has been found', () => {
      assert.equal((code.match(/\bcatch\b/g) || []).length, 1, 'only the read wrapper catches (and re-throws)');
      assert.ok(code.includes("catch (err) { throw new Error('Could not read ' + what + ' — nothing was worked out. Try again in a moment.'); }"));
      assert.equal((code.match(/return null;/g) || []).length, 2, 'null is the answer for "no document" and "not in force" only');
    });
    it('the no-target refusal and its words, and no digit run that could be a target (the repo is public)', () => {
      assert.ok(code.includes("throw new Error('Set the sales target for ' + K.monthLabel(month) + ' first (Finance › Payroll & HR › Sales KPI)');"));
      for (const [name, src] of [['resolveSalesKpi', RESOLVE], ['salesKpiState', STATE]]) {
        assert.deepEqual([...src.matchAll(/\d{5,}/g)].map((m) => m[0]), [], `${name} contains a long number`);
        assert.ok(!/\d{1,3}(,\d{3})+/.test(src) && !/₱\s*\d/.test(src), `${name} contains a money figure`);
      }
    });
    it('it is self-contained (no top-level helper const: a second classic script declaring the same name would stop the whole file loading)', () => {
      assert.ok(!/^(const|let|var|function) /m.test(RESOLVE) && !/^(const|let|var|function) /m.test(STATE));
    });
  });
  it('the Sales KPI engine is an app-kit script ahead of departments.js, so window.SalesKpi exists whenever the resolver runs (pinned in sales-kpi-screens too)', () => {
    const kit = read('index.html');
    const a = kit.indexOf('js/sales-kpi-core.js?v='), b = kit.indexOf('js/departments.js?v=');
    assert.ok(a > 0 && b > a);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  D2 · the payroll roster card (js/screens/payroll.js) and the President's Team table — run for real
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D2 · the roster card prints the Sales KPI\'s working for a Sales-KPI line, the task working for every other line', () => {
  const PAYROLL_SCREEN = read('js/screens/payroll.js');
  const NESTED = ['function _pyFieldHtml(col, r, isLive)', 'function _pyWorkingHtml(r)', 'function _pyHrRecordBtn(extraStyle)', 'function _pyPersonCard(r, cols, o)'].map((sig) => extract(PAYROLL_SCREEN, sig));
  const card = (() => {
    const ctx = vm.createContext({ console: { log() {}, info() {}, warn() {}, error() {} } });
    ctx.window = ctx;
    ctx.window.escHtml = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    ctx.window.fmtN2 = (n) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    for (const f of ['js/sales-kpi-core.js', 'js/pay-policy.js']) vm.runInContext(read(f), ctx, { filename: f });
    vm.runInContext(PAYROLL_SCREEN, ctx, { filename: 'js/screens/payroll.js' });         // the file's own top-level helpers (_pyRead, _pyColsFor, ...)
    for (const src of NESTED) vm.runInContext(src, ctx);                                   // the nested card functions, with those helpers in scope
    return (normalizedRow) => {
      const r = ctx._pyRead(normalizedRow);
      const cols = ctx._pyColsFor([r]);
      return ctx._pyPersonCard(r, cols, { isLive: false, canEditRows: false, canCorrectRow: false, flagged: false });
    };
  })();
  const rowOf = (l) => PC.normalizeLine(l, 'month');
  const sales = () => frozenLineForCard(PAID[0], KPI, { doneInM: 4, inScopeCount: 4, deliverableScore: null, kpiSource: 'sales', salesKpi: WORKING });
  const task = () => frozenLineForCard(PAID[1], 0.6466666666666666, { doneInM: 2, inScopeCount: 3, deliverableScore: 60 });
  function frozenLineForCard(emp, kpiScore, kpiBreakdown) {
    return { ...money.computePayLine(emp, { month: MONTH, policy: 'basekpi', kpiScore, attScore: 0, caPlan: [], caBalance: undefined }), tinNum: '', ssNum: '', phNum: '', pagibigNum: '', employmentStatus: '', statutoryBasis: '', statusFlag: null, kpiBreakdown };
  }
  it('a Sales-KPI card: the KPI figure says what it is made of, the two working lines are printed under the figures, the sentence names the sales parts', () => {
    const t = text(card(rowOf(sales())));
    assert.ok(/KPI 62% Sales KPI — confirmed sales 70%, client rating 30%/.test(t), t);
    assert.ok(t.includes(`KPI working: ${SALES_LINE}`) && t.includes(`KPI working: ${RATING_LINE}`));
    assert.ok(t.includes('(confirmed sales 70%, client rating 30%)'));
    for (const banned of ['in-scope tasks', 'tasks 70%', '70% tasks', 'deliverables']) assert.ok(!t.includes(banned), `task wording on a Sales-KPI card: "${banned}"`);
  });
  it('every other card is unchanged: the in-scope task working, the task sentence, no "KPI working" line', () => {
    const t = text(card(rowOf(task())));
    assert.ok(t.includes('2 of 3 in-scope tasks done · deliverables 60% (70% tasks, 30% deliverables)'));
    assert.ok(t.includes('(tasks 70%, deliverables 30%)'));
    assert.ok(!t.includes('KPI working') && !t.includes('Sales KPI') && !t.includes('client rating'));
  });
  it('a Sales-KPI line whose working is missing prints the Sales KPI label and no invented lines', () => {
    const l = sales(); l.kpiBreakdown = { doneInM: 4, inScopeCount: 4, deliverableScore: null, kpiSource: 'sales' };
    const t = text(card(rowOf(l)));
    assert.ok(t.includes('Sales KPI — confirmed sales 70%, client rating 30%') && !t.includes('KPI working') && !t.includes('in-scope tasks'));
  });
});

describe('D2 · the President\'s Team table (renderPersonalFinance, President branch)', () => {
  const team = async (env) => {
    const els = {};
    env.ctx.document.getElementById = (id) => (id === 'page-content' ? env.page : (els[id] = els[id] || new Proxy({ innerHTML: '', textContent: '', style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }, { get: (t, k) => (k in t ? t[k] : () => null), set: (t, k, v) => { t[k] = v; return true; } })));
    await env.ctx.window.renderPersonalFinance({ uid: 'u-pres', email: 'p@example.test' }, 'president', { host: env.page });
    return text((els['pf-content'] || { innerHTML: '' }).innerHTML);
  };
  const row = (t, name) => { const m = new RegExp(name + ' [^]*?(?= (?:Uriel Sales|Tess Task|Nico None|Olga Override|Neil Barro|Shaira Finance|Cora Secretary) |$)').exec(t); return m ? m[0] : ''; };
  it('the person on the Sales KPI shows it (62%, "Sales KPI"); everyone else shows the task KPI as before', async () => {
    const t = await team(makeUiEnv({ who: PRES }));
    assert.ok(/Uriel Sales[^]*?62%\s+Sales KPI/.test(t), t.slice(0, 600));
    assert.ok(/Tess Task[^]*?2\/3 tasks/.test(t), 'a task person still shows her tasks');
    assert.ok(!/Uriel Sales[^]*?\b100%\s+4\/4 tasks/.test(t), 'his task KPI is shown beside his Sales KPI');
  });
  it('unreadable: "KPI unavailable" and a dash for the earned figure — never his task KPI', async () => {
    const t = await team(makeUiEnv({ who: PRES, fail: RATINGS_DOWN }));
    assert.ok(/Uriel Sales[^]*?—\s+KPI unavailable/.test(t), t.slice(0, 600));
    assert.ok(!/Uriel Sales[^]*?\b100%/.test(t));
  });
  it('not in force: the Team table shows his task KPI exactly as before', async () => {
    const t = await team(makeUiEnv({ who: PRES, data: uiSeed({ sales_kpi: {} }) }));
    assert.ok(/Uriel Sales[^]*?4\/4 tasks/.test(t) && !/Sales KPI\b[^a-z]/.test(t.replace('a person on the Sales KPI shows that instead', '')));
  });
});
