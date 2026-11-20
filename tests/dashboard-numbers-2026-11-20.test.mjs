// tests/dashboard-numbers-2026-11-20.test.mjs — dashboard figures that disagreed with their own screens
// (2026-11-20 system review, items 5–8):
//   5  team counts and payroll totals summed EVERY users doc (removed people, production-class staff paid weekly)
//   6  the Manager's pending banner mixed company-wide quote approvals / cash advances with team-scoped sources
//   7  the President's "90+ days overdue" used project age while Finance uses the shared aging engine (invoice due)
//   8  the employee "Task KPI" (and My Finance's KPI) was completed ÷ every task ever, not the payslip's month score
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const CONFIG = read('js/config.js'), DASH = read('js/screens/dashboards.js'), CORE = read('js/money-core.js');
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
const fnBody = (name) => { const i = DASH.indexOf(`async function ${name}(`); assert.ok(i > 0, name); return DASH.slice(i, DASH.indexOf('\nasync function ', i + 10)); };

function helpers() {
  const window = { bizDate: (d) => (d || new Date('2026-11-20T12:00:00')).toISOString().slice(0, 10) };
  new Function('window', [
    extract(CONFIG, 'window.isCurrentStaff = function(u)'), extract(CONFIG, 'window.onMonthlyPayroll = function(u)'),
    extract(CONFIG, 'window.taskDoneMonth = function(t)'), extract(CONFIG, 'window.taskCreatedMonth = function(t)'),
    extract(CORE, 'window.computeKpiForMonth = function(userTasks, month, delivScore, resolveDoneMonth, resolveCreatedMonth)'),
  ].join(';\n'))(window);
  return window;
}

describe('5 · head-counts and payroll leave out removed people (and payroll leaves out production staff)', () => {
  const w = helpers();
  const users = [{ id: 'a', salary: 20000 }, { id: 'b', salary: 15000, removed: true }, { id: 'c', salary: 600, payClass: 'production' }, { id: 'd', salary: 18000, pendingPasswordSetup: true }];
  it('isCurrentStaff: everyone but the removed', () => assert.deepEqual(users.filter(w.isCurrentStaff).map((u) => u.id), ['a', 'c', 'd']));
  it('onMonthlyPayroll: the engine\'s two person-level skips (removed, production)', () => assert.deepEqual(users.filter(w.onMonthlyPayroll).map((u) => u.id), ['a', 'd']));
  it('every dashboard figure uses them', () => {
    assert.match(fnBody('renderPresidentDashboard'), /const payrollBurn = users\.filter\(window\.onMonthlyPayroll\)/);
    assert.match(fnBody('renderPresidentDashboard'), /\$\{users\.filter\(window\.isCurrentStaff\)\.length\}/);
    const fin = fnBody('renderFinanceDashboard');
    assert.match(fin, /const payStaff = users\.filter\(window\.onMonthlyPayroll\)/);
    assert.match(fin, /const payrollGross = payStaff\.reduce/);
    assert.match(fin, /const payrollDeduct = payStaff\.reduce/);
    assert.match(fnBody('renderSecretaryDashboard'), /const activeStaff = users\.filter\(window\.isCurrentStaff\)\.length/);
    assert.match(fnBody('renderManagerDashboard'), /const team = users\.filter\(u => window\.isCurrentStaff\(u\) && inDept\(u\)\)/);
    assert.match(DASH, /const payrollTotal = sum\(users\.filter\(window\.onMonthlyPayroll\)/);
  });
});

describe('6 · the Manager\'s pending banner is the team\'s, every source', () => {
  const m = fnBody('renderManagerDashboard');
  it('quote approvals and cash advances are filtered to the team, legacy CA-deduction requests excluded', () => {
    assert.match(m, /approvalsSnap\.docs\.filter\(d=>\{ const x=d\.data\(\); return x\.type!=='ca_deduct' && \(teamIds\.has\(x\.userId\)\|\|teamIds\.has\(x\.agentId\)\); \}\)/);
    assert.match(m, /const teamCAs = caSnap\.docs\.filter\(d=>teamIds\.has\(d\.data\(\)\.userId\)\)/);
    assert.match(m, /\+ teamQuoteApprovals \+ teamCAs \+/);
    assert.doesNotMatch(m, /approvalsSnap\.size|caSnap\.size/, 'a company-wide size is back in the team total');
  });
  it('and says so', () => assert.match(m, /from your team<\/span>/));
});

describe('7 · the President\'s 90+ day receivables use the one shared aging engine', () => {
  it('window.arAging(...).d90, like the Finance dashboard', () => {
    assert.match(fnBody('renderPresidentDashboard'), /const arOverdue = window\.arAging\(_openAR\)\.d90;/);
    assert.match(fnBody('renderFinanceDashboard'), /window\.arAging\(openAR\)/);
  });
});

describe('8 · the employee KPI is the payslip\'s KPI', () => {
  const w = helpers();
  const ts = (iso) => ({ seconds: Date.parse(iso) / 1000 });
  const tasks = [
    { status: 'done', completedAt: ts('2026-08-03T04:00:00Z'), createdAt: ts('2026-08-01T04:00:00Z') },   // finished in Aug: out of scope for Nov
    { status: 'done', completedAt: ts('2026-11-10T04:00:00Z'), createdAt: ts('2026-11-02T04:00:00Z') },
    { status: 'open', createdAt: ts('2026-11-05T04:00:00Z') },
  ];
  it('getKpiScore returns computeKpiForMonth for the current month (not all-time, not a 0.5 default)', async () => {
    const getKpiScore = new Function('db', 'window', 'bizDate', `return (${extract(DASH, 'async function getKpiScore(uid, preTasks, preKpiSnap)')});`)(
      {}, w, () => '2026-11-20');
    const snap = { exists: true, data: () => ({ deliverableScore: 80 }) };
    const got = await getKpiScore('u', tasks, snap);
    assert.equal(got, w.computeKpiForMonth(tasks, '2026-11', 80, w.taskDoneMonth, w.taskCreatedMonth));
    assert.equal(+got.toFixed(4), +(0.5 * 0.7 + 0.8 * 0.3).toFixed(4), '1 of 2 in-scope tasks done, deliverable 80');
    assert.equal(await getKpiScore('u', [], { exists: false }), 1, 'no work in scope is 100%, as on the payslip');
  });
  it('the employee dashboard and My Finance use the payroll\'s functions', () => {
    const e = fnBody('renderEmployeeDashboard');
    assert.match(e, /const taskScore  = Math\.round\(window\.computeKpiForMonth\(myTasks, kpiMonth, kpiTarget\.deliverableScore, window\.taskDoneMonth, window\.taskCreatedMonth\) \* 100\);/);
    assert.doesNotMatch(e, /doneTasks\.length \/ myTasks\.length/);
    assert.match(e, /<div class="kpi-label">Base pay<\/div>/);
    assert.doesNotMatch(e, /kpi-label">Net Pay</);
    assert.match(DASH, /const _kbPF    = window\.kpiMonthBreakdown \? window\.kpiMonthBreakdown\(myTasks, _bz\.slice\(0, 7\)\) : null;/);
  });
});
