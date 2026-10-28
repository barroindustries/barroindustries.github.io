// tests/partner-removal-payroll.test.mjs — PARTNER-REMOVAL-SPEC §0.2 / §4 WS-D / §5.4: Brilliant Steel staff are Barro employees, so every payroll / HR /
// statutory / profile roster starts from EVERYONE on `users`. This is a MONEY change (js/money-core.js is frozen and is not touched by it).
//
// WHAT CHANGED (owner ruling 2026-10-28, superseding the 2026-08-12 one): window.isExternalPartnerUser (js/config.js) and the four roster exclusions that
// called it are DELETED, not softened. Until now a person whose ONLY department was Brilliant Steel — or whose title read "Partner" — was treated as outside
// the company and silently left off the monthly pay run, the HR payroll roster, the Gov Rates preview and the HR profiles list. A wrongly excluded employee is
// a wage nobody notices has not been paid, so the new behaviour is pinned from five sides:
//   1. js/departments.js buildPayRunLines — the code carries no department / partner test, its roster line is EXACTLY
//      `const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()}));` and `allStaff` is used for nothing but the skip loop; AND the real function (with the
//      real money-core.js maths and a fake Firestore) is run: every kind of Brilliant Steel employee lands on the pay run and is paid to the peso exactly like
//      an otherwise identical Sales employee, while removed / production / worker-linked / period-excluded people are skipped with the same reasons as anyone.
//   2. js/departments.js monthlyRunSkipReason — the double-pay guard returns the same answer whatever the person's department (a property check across every
//      state), and a Brilliant Steel employee is paid (null); removed -> 'removed', production -> 'production' are untouched.
//   3. the three other rosters that used to filter (HR payroll roster renderPayrollManagement in js/screens/hr.js, the Gov Rates statutory preview
//      renderStatutoryStatusSection + renderOfficeSplitSection in js/screens/statutory-rates.js, the HR profiles list _epLoadRoster in
//      js/screens/employee-profile.js) — no isExternalPartnerUser / _isExternalPartner / Brilliant Steel / 'partner' / isSeparate in their code, roster lines pinned.
//   4. the payroll-side files as a whole (payroll.js, payroll-weekly.js, screens/payroll.js, payroll-backfill.js, statutory-rates.js, employee-profile.js, ...)
//      carry no external-partner or Brilliant Steel test in code.
//   5. the predicates are gone: js/config.js is evaluated in a vm and `typeof window.isExternalPartnerUser === 'undefined'` AND `typeof window.isRetiredRoleUser ===
//      'undefined'`; no code anywhere under js/ names either (or _isExternalPartner).
//   PHASE 3 (WS-H, 2026-10-28): between Phase 1 and the Phase-2 purge a TEMPORARY retired-role roster guard (window.isRetiredRoleUser, role 'partner' only) kept a surviving
//   partner users doc off the five rosters. The purge deleted the only partner account (verification: all zeros), so WS-H deleted the guard and its call sites and
//   restored the original pins below: the roster line is EXACTLY `const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()}));` in buildPayRunLines and
//   renderPayrollManagement, `skip: u.payClass === 'production',` in payroll-backfill.js, and officeDocs / officeRaw carry no role or department term.
// Comments are stripped before every textual assertion (the explanatory comments legitimately say "Brilliant Steel" and "partner"), and the stripper is itself
// tested, and every stripped extract must still PARSE — a stripper that ate real code would otherwise hide a forbidden token.
//
// MUTATION-TESTED in scratch copies (/private/tmp/…/scratchpad/wsd-mut/<id>/ — a copy of js/ plus this file; the shared tree is never touched). The unmutated
// copy ran green first (control: 30 of 30), then each of the 16 mutants M01-M16 re-introduced the exclusion (or a department-dependent pay twist) in ONE place and
// every one turned the suite red. Legend of the tests that killed them:
//   [clean] the extract carries no partner / Brilliant Steel / department rung   [line] the roster line is exactly …   [use] allStaff feeds nothing but the skip loop
//   [paid] a Brilliant-Steel-only employee is PAID (null)   [reasons] removed / production / linked / excluded unchanged   [dept] the reason never depends on department
//   [run-1/2/3] the real builder run: lines + skipped / pay parity with Sales / period exclusion   [rosters] the four per-function pins in "the other rosters"
//   [files] the whole-file scan of the payroll-side files   [gone] config.js in a vm + the js/-wide scan for isExternalPartnerUser
//   M01  departments.js  roster line + `.filter(u => !(u.departments||[]).includes('Brilliant Steel'))`        [the spec's mutant 1]   KILLED by clean, line, use, run-1/2/3
//   M02  departments.js  monthlyRunSkipReason returns 'external' for a Brilliant-Steel-only user              [the spec's mutant 2]   KILLED by clean, paid, reasons, dept, run-1/2/3
//   M03  statutory-rates.js  a `_isExternalPartner` helper back in renderStatutoryStatusSection, used on officeDocs [the spec's mutant 3]  KILLED by rosters, files, gone
//   M04  statutory-rates.js  renderOfficeSplitSection's officeRaw filter regains `!window.isExternalPartnerUser(u) &&`                  KILLED by rosters, files, gone
//   M05  hr.js           renderPayrollManagement's roster regains `.filter(u=>!isExternalPartner(u))` (a Brilliant-Steel-only helper)    KILLED by rosters
//   M06  employee-profile.js  _epLoadRoster regains `.filter(u => u.role !== 'partner')`                                                 KILLED by rosters, files
//   M07  config.js       window.isExternalPartnerUser defined again                                                                      KILLED by gone (both checks)
//   M08  departments.js  the exclusion moved into the loop: `for (const u of allStaff.filter(… Brilliant Steel …))`                       KILLED by clean, use, run-1/2/3
//   M09  departments.js  roster line gets a ROLE filter (`.filter(u => u.role !== 'agent')`)                                             KILLED by line, use, run-1/2
//   M10  departments.js  monthlyRunSkipReason skips a user whose legacy string `department` is Brilliant Steel                           KILLED by clean, paid, dept, run-1/2/3
//   M11  payroll-backfill.js  the `|| u.role === 'partner'` skip put back                                                                KILLED by files (whole-file + its `skip:` line)
//   M12  departments.js  roster drops a user titled "Partner"                                                                            KILLED by clean, line, use, run-1/2
//   M13  departments.js  roster filters on the DEPARTMENTS registry (`isSeparate`) rather than a name                                    KILLED by clean, line, use
//   M14  departments.js  monthlyRunSkipReason: when an exclusion map is passed, Brilliant Steel staff are skipped                        KILLED by clean, reasons, dept, run-1/2/3
//   M15  departments.js  a Brilliant Steel employee's finalPay is zeroed after computePayLine (department-dependent pay)                 KILLED by clean, run-2
//   M16  departments.js  STEALTH: BS staff dropped inside the skip loop with no banned token and no `department` word (matches fixture ids) KILLED by run-1/2/3 and the loop-gate pin (one `continue`)
//   ── WS-H (Phase 3, 2026-10-28): the guard deleted, the original pins restored, M01-M16 RE-RUN against the restored suite (control 30 of 30 before and after, all 16
//      killed again) plus seven mutants that put the guard (or a role-partner term) back. Scratch copy: /private/tmp/…/scratchpad/wsh-mut/work-payroll (js/ + this file;
//      the shared tree is never touched). [lines] the exact roster-line pins   [gone] the predicates-are-gone describe   [files] the whole-file scan
//   W01  departments.js  buildPayRunLines: `.filter(u=>!window.isRetiredRoleUser(u))` back on the roster line (helper absent)                    KILLED by lines, use, run-1/2/3
//   W02  config.js       window.isRetiredRoleUser defined again (nothing calls it)                                                               KILLED by gone (both checks)
//   W03  hr.js           renderPayrollManagement's roster regains a role-partner filter                                                          KILLED by rosters
//   W04  statutory-rates.js  renderStatutoryStatusSection's officeDocs regains a role-partner filter                                             KILLED by rosters, files
//   W05  statutory-rates.js  renderOfficeSplitSection's officeRaw regains a role-partner term                                                    KILLED by rosters, files
//   W06  payroll-backfill.js  the back-fill skip regains a trimmed, case-insensitive role-partner term                                            KILLED by files (whole-file + its `skip:` line)
//   W07  departments.js  monthlyRunSkipReason regains a 'retired' reason for role partner                                                        KILLED by clean, reasons
//
// Fixtures are FAKE (invented names and odd-figure pesos): the repository is public.
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { stripComments } from './fixtures/strip-comments.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const piece = (src, re, what) => { const m = src.match(re); assert.ok(m, `${what} not found`); return m[0]; };
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));   // objects made inside a vm context carry that realm's prototypes
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// ── comment stripper ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE copy, shared with tests/partner-removal.test.mjs: tests/fixtures/strip-comments.mjs (it leaves the newlines of a block comment behind, so a line
// of the stripped text is still the same line of the source).

// The comment-free text of an extract — and a proof that it still parses (see the header).
function codeOf(text, what) {
  const code = stripComments(text);
  try { new vm.Script(code, { filename: what }); }
  catch (e) { assert.fail(`${what}: after stripping comments it no longer parses (${e.message}) — the extraction or the comment stripper is wrong`); }
  return code;
}

// What no roster / skip-chain code may say any more. (Comments are already gone.)
const FORBIDDEN = [
  [/isExternalPartnerUser/, 'isExternalPartnerUser'],
  [/\b_?isExternalPartner\b/, 'an isExternalPartner / _isExternalPartner helper'],
  [/Brilliant Steel/, 'a Brilliant Steel test'],
  [/(['"`])partner\1/i, "a 'partner' role / title test"],
  [/\bisSeparate\b|\bisPartnerDept\b/, 'a DEPARTMENTS external flag (isSeparate / isPartnerDept)'],
];
const forbiddenIn = (code) => FORBIDDEN.filter(([re]) => re.test(code)).map(([, label]) => label);
const assertClean = (code, what) => assert.deepEqual(forbiddenIn(code), [], `${what} still carries an external-partner / Brilliant Steel rung`);

// ── the extracts under test (every one closes with a brace ALONE on its line in column 0) ──────────────────────────────────────────────────────
const DEPT = read('js/departments.js');
const BPRL      = piece(DEPT, /^window\.buildPayRunLines = async function[\s\S]*?\n\};\n/m, 'window.buildPayRunLines in js/departments.js');
const SKIP      = piece(DEPT, /^window\.monthlyRunSkipReason = function[\s\S]*?\n\};\n/m, 'window.monthlyRunSkipReason in js/departments.js');
const PERIOD_EX = piece(DEPT, /^window\.periodExclusionsFor = async function[\s\S]*?\n\};\n/m, 'window.periodExclusionsFor in js/departments.js');
const HR_PAYROLL = piece(read('js/screens/hr.js'), /^async function renderPayrollManagement\([\s\S]*?\n\}\n/m, 'renderPayrollManagement in js/screens/hr.js');
const STAT = read('js/screens/statutory-rates.js');
const STAT_STATUS = piece(STAT, /^window\.renderStatutoryStatusSection = async function[\s\S]*?\n\};\n/m, 'window.renderStatutoryStatusSection in js/screens/statutory-rates.js');
const STAT_SPLIT  = piece(STAT, /^window\.renderOfficeSplitSection = async function[\s\S]*?\n\};\n/m, 'window.renderOfficeSplitSection in js/screens/statutory-rates.js');
const EP_ROSTER = piece(read('js/screens/employee-profile.js'), /^async function _epLoadRoster\([\s\S]*?\n\}\n/m, '_epLoadRoster in js/screens/employee-profile.js');

const lines = (code) => code.split('\n');
const linesMatching = (code, re) => lines(code).filter((l) => re.test(l));

// ═════════════════════════════════════════════ the stripper (the test's own tool) ═════════════════════════════════════════════════════════════
describe('the comment stripper the textual pins rely on', () => {
  it('removes line and block comments but keeps "//" inside strings, templates and regexes', () => {
    const src = [
      "const a = 'x//y'; // 'partner' in a comment",
      'const b = "http://example.test/p"; /* Brilliant Steel */ const c = 1;',
      'const t = `<a href="https://example.test/${ok ? `q//r` : \'s\'}">${/* inner */ 1}</a>`; // tail',
      "const r = /\\/\\/ 'partner'/.test(a); // regex with slashes and a quote",
      'const q = a / b; // division, not a regex',
    ].join('\n');
    const out = stripComments(src);
    assert.ok(out.includes("'x//y'") && out.includes('"http://example.test/p"'), 'string contents survive');
    assert.ok(out.includes('https://example.test/') && out.includes('`q//r`'), 'template contents survive');
    assert.ok(out.includes("/\\/\\/ 'partner'/.test(a)"), 'a regex literal survives');
    assert.ok(out.includes('const q = a / b;'), 'a division survives');
    assert.ok(!/in a comment|Brilliant Steel|inner|tail|division, not|regex with slashes/.test(out), 'comment text is gone:\n' + out);
    new vm.Script(out);                                       // and what is left parses
  });
  it('every extract it is used on still parses after stripping (the proof a pin cannot be hiding in eaten code)', () => {
    for (const [what, text] of [['buildPayRunLines', BPRL], ['monthlyRunSkipReason', SKIP], ['renderPayrollManagement', HR_PAYROLL],
      ['renderStatutoryStatusSection', STAT_STATUS], ['renderOfficeSplitSection', STAT_SPLIT], ['_epLoadRoster', EP_ROSTER]]) {
      const code = codeOf(text, what);
      assert.ok(code.length > 200 && code.length < text.length, `${what}: stripped to ${code.length} of ${text.length} characters`);
    }
  });
});

// ═══════════════════════════════════ 1. the pay-run roster (js/departments.js buildPayRunLines) ═════════════════════════════════════════════════
describe('buildPayRunLines — the roster is everyone on `users`; nothing decides it but monthlyRunSkipReason', () => {
  const code = codeOf(BPRL, 'window.buildPayRunLines');
  it('its code carries no external-partner / Brilliant Steel / department rung', () => {
    assertClean(code, 'buildPayRunLines');
    assert.ok(!/\bDEPARTMENTS\b/.test(code), 'buildPayRunLines consults the DEPARTMENTS registry');
    assert.ok(!/\bdepartments?\b/.test(code), 'buildPayRunLines reads a department off a person — the roster must not depend on department');
  });
  it('the roster line is EXACTLY `const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()}));` — no filter of any kind', () => {
    const roster = linesMatching(code, /^\s*const allStaff\s*=/);
    assert.equal(roster.length, 1, 'exactly one `const allStaff =` line');
    assert.equal(roster[0].trim(), 'const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()}));');
  });
  it('`allStaff` is used for nothing but the skip loop, so no filter can be slipped in after the roster line', () => {
    assert.equal((code.match(/\ballStaff\b/g) || []).length, 2, 'allStaff: the declaration and the loop, nothing else');
    assert.equal(linesMatching(code, /\bfor \(const u of allStaff\) \{/).length, 1, 'the loop is `for (const u of allStaff) {`');
    assert.ok(!/\busersSnap\b[^;]*\.filter\(/.test(code), 'usersSnap is filtered');
    assert.equal((code.match(/\busersSnap\b/g) || []).length, 2, 'usersSnap: fetched once, read once');
  });
  it('the only gate on the loop is monthlyRunSkipReason(u, linkedUids, periodExcluded)', () => {
    assert.equal(linesMatching(code, /window\.monthlyRunSkipReason\(u, linkedUids, periodExcluded\)/).length, 1);
    assert.equal(linesMatching(code, /\bcontinue\b/).length, 1, 'one `continue` — the skip-reason one');
  });
});

describe('monthlyRunSkipReason — the double-pay guard has no department rung (Brilliant Steel employees are paid)', () => {
  const skip = (() => {
    const ctx = vm.createContext({}); ctx.window = ctx;
    vm.runInContext(SKIP, ctx);
    return ctx.window.monthlyRunSkipReason;
  })();
  const none = new Set();
  const BS = ['Brilliant Steel'];
  it('its code names no department, partner or external reason', () => {
    const code = codeOf(SKIP, 'window.monthlyRunSkipReason');
    assertClean(code, 'monthlyRunSkipReason');
    assert.ok(!/department|DEPARTMENTS|external/i.test(code), 'monthlyRunSkipReason reads a department or has an external reason');
    // the reasons it can return are exactly the five the pay run reports; a sixth is either deliberate (add it here AND to tests/payrun-guard.test.mjs)
    // or somebody putting an external / department reason back
    assert.deepEqual([...new Set((code.match(/return\s+'([a-z-]+)'/g) || []).map((s) => s.replace(/return\s+'|'/g, '')))].sort(),
      ['excluded', 'linked-worker-profile', 'missing', 'production', 'removed']);
  });
  it('a Brilliant-Steel-only employee is PAID: null, whichever way their department is recorded', () => {
    for (const u of [
      { id: 'bs1', role: 'employee', departments: BS },
      { id: 'bs1', role: 'employee', departments: BS, department: 'Brilliant Steel' },
      { id: 'bs1', role: 'employee', department: 'Brilliant Steel' },
      { id: 'bs1', role: 'employee', departments: ['Brilliant Steel', 'Sales'] },
      { id: 'bs1', role: 'manager', departments: BS },
      { id: 'bs1', role: 'agent', departments: BS, title: 'Partner' },
    ]) assert.equal(skip(u, none), null, JSON.stringify(u));
  });
  it('a removed Brilliant Steel employee is "removed" and a production-class one is "production" — the other reasons are untouched', () => {
    assert.equal(skip({ id: 'bs1', role: 'employee', departments: BS, removed: true }, none), 'removed');
    assert.equal(skip({ id: 'bs1', role: 'employee', departments: BS, payClass: 'production' }, none), 'production');
    assert.equal(skip({ id: 'bs1', role: 'employee', departments: BS }, new Set(['bs1'])), 'linked-worker-profile');
    assert.equal(skip({ id: 'bs1', role: 'employee', departments: BS }, none, { bs1: 'unpaid leave' }), 'excluded: unpaid leave');
    assert.equal(skip(null, none), 'missing');
  });
  it('the answer never depends on the department: every state x every way of recording a department gives the same reason', () => {
    const states = [
      ['paid', {}, none, undefined],
      ['removed', { removed: true }, none, undefined],
      ['production', { payClass: 'production' }, none, undefined],
      ['linked', {}, new Set(['p1']), undefined],
      ['excluded', {}, none, { p1: true }],
      ['removed + excluded', { removed: true }, none, { p1: true }],
    ];
    const depts = [{}, { departments: [] }, { departments: ['Sales'] }, { departments: BS }, { departments: ['Brilliant Steel', 'Sales'] },
      { departments: ['Admin', 'Finance'] }, { department: 'Brilliant Steel' }, { department: 'Sales', departments: BS }, { departments: ['Partners'] }];
    for (const [label, over, linked, ex] of states) {
      const baseline = skip({ id: 'p1', role: 'employee', ...over }, linked, ex);
      for (const d of depts) assert.equal(skip({ id: 'p1', role: 'employee', ...over, ...d }, linked, ex), baseline, `${label}: ${JSON.stringify(d)} changes the reason`);
    }
  });
});

// ═══════════════════════ the real pay-run builder, run end to end (real money-core.js maths, fake Firestore) ═════════════════════════════════
describe('buildPayRunLines run for real — Brilliant Steel employees land on the pay run and are paid like anyone else', () => {
  function makeRunEnv({ users, workerProfiles = [], excluded = null }) {
    const quiet = { log() {}, info() {}, warn() {}, error() {} };           // computeStatutory warns on every call while the 2026 table is unverified, by design
    const ctx = vm.createContext({ console: quiet });
    ctx.window = ctx;
    ctx.window.bizYear = () => 2026;                                        // js/config.js's Manila year, pinned
    vm.runInContext(read('js/statutory-tables.js'), ctx, { filename: 'js/statutory-tables.js' });
    vm.runInContext(read('js/money-core.js'), ctx, { filename: 'js/money-core.js' });   // the REAL computePayLine / resolveStatutoryEE / computeKpiForMonth (frozen)
    const docsOf = (arr) => arr.map((d) => ({ id: d.id, data: () => { const { id, ...rest } = d; return plain(rest); } }));
    ctx.window.statutoryStatusRuleOn = async () => ({ on: false });
    ctx.window.statutoryStatusPlan = () => ({ active: false, statConfig: null, status: '', words: '', flag: null });
    ctx.fetchUsersWithPayroll = async () => ({ docs: docsOf(users), payrollDenied: false });
    ctx.dbCachedGet = (_key, fetcher) => fetcher();
    ctx.db = { collection: (name) => ({
      doc: () => ({ get: async () => (name === 'pay_runs' && excluded ? { exists: true, data: () => ({ excluded }) } : { exists: false, data: () => ({}) }) }),
      get: async () => ({ docs: name === 'worker_profiles' ? docsOf(workerProfiles) : [] }),
    }) };
    for (const src of [SKIP, PERIOD_EX, BPRL]) vm.runInContext(src, ctx);
    return ctx;
  }
  const PAY = { salary: 23750, allowance: 1250, deductions: 0, payClass: 'regular' };
  const person = (id, over) => ({ id, displayName: `Person ${id}`, email: `${id}@example.test`, role: 'employee', ...PAY, ...(over || {}) });
  const ROSTER = [
    person('bs_only', { departments: ['Brilliant Steel'], department: 'Brilliant Steel' }),
    person('bs_two',  { departments: ['Brilliant Steel', 'Sales'], department: 'Brilliant Steel' }),
    person('bs_str',  { department: 'Brilliant Steel' }),                         // legacy: a string department and no array
    person('sales_a', { departments: ['Sales'], department: 'Sales' }),
    person('agent_a', { role: 'agent', departments: ['Sales'] }),
    person('mgr_a',   { role: 'manager', departments: ['Admin'] }),
    person('fin_a',   { role: 'finance', departments: ['Finance'] }),
    person('titled',  { title: 'Partner', departments: ['Sales'] }),
    person('bs_gone', { departments: ['Brilliant Steel'], removed: true }),
    person('bs_prod', { departments: ['Brilliant Steel'], payClass: 'production' }),
    person('bs_lnk',  { departments: ['Brilliant Steel'] }),
    person('depts_p', { departments: ['Partners'], department: 'Partners' }),         // an employee filed under the retired department: still an employee, paid
  ];
  const WORKERS = [{ id: 'wp1', linkedUid: 'bs_lnk', status: 'active' }];
  const run = async (opts) => {
    const env = makeRunEnv({ users: ROSTER, workerProfiles: WORKERS, ...(opts || {}) });
    return env.window.buildPayRunLines('2026-10', { policy: 'flat', overrides: {} });
  };

  it('every Brilliant Steel employee (and every other kind of employee) has a line; removed / production / worker-linked people are skipped with their usual reasons', async () => {
    const out = await run();
    assert.deepEqual([...out.lines.map((l) => l.uid)].sort(), ['agent_a', 'bs_only', 'bs_str', 'bs_two', 'depts_p', 'fin_a', 'mgr_a', 'sales_a', 'titled']);
    assert.deepEqual(plain(out.skipped).sort((a, b) => a.uid.localeCompare(b.uid)), [
      { uid: 'bs_gone', name: 'Person bs_gone', reason: 'removed' },
      { uid: 'bs_lnk',  name: 'Person bs_lnk',  reason: 'linked-worker-profile' },
      { uid: 'bs_prod', name: 'Person bs_prod', reason: 'production' },
    ]);
  });
  it('a Brilliant Steel employee is paid exactly like an otherwise identical Sales employee (same pay record -> same line, to the centavo)', async () => {
    const out = await run();
    const line = (uid) => plain(out.lines.find((l) => l.uid === uid));
    const bare = (l) => { const { uid, name, ...rest } = l; return rest; };
    assert.equal(line('bs_only').base, 23750);
    assert.ok(Number.isFinite(line('bs_only').finalPay) && line('bs_only').finalPay > 0, 'a real, positive net pay was worked out for them');
    for (const uid of ['bs_two', 'bs_str', 'agent_a', 'titled', 'depts_p']) assert.deepEqual(bare(line(uid)), bare(line('sales_a')), `${uid} is paid differently from sales_a`);
  });
  it('a period exclusion treats a Brilliant Steel employee like anyone else — the one reason that is period-scoped', async () => {
    const out = await run({ excluded: { bs_two: 'unpaid leave', sales_a: 'unpaid leave' } });
    assert.ok(!out.lines.some((l) => l.uid === 'bs_two' || l.uid === 'sales_a'));
    const reasons = Object.fromEntries(plain(out.skipped).map((s) => [s.uid, s.reason]));
    assert.equal(reasons.bs_two, 'excluded: unpaid leave');
    assert.equal(reasons.sales_a, 'excluded: unpaid leave');
    assert.ok(out.lines.some((l) => l.uid === 'bs_only'), 'someone who is not excluded still has a line');
  });
});

// ═════════════════════════════ 3. the other rosters that used to filter (textual pins, comments stripped) ════════════════════════════════════
describe('the other rosters start from everyone on `users` too', () => {
  it('HR payroll roster (js/screens/hr.js renderPayrollManagement): clean, and its roster line is EXACTLY `usersSnap.docs.map(...)` — no filter', () => {
    const code = codeOf(HR_PAYROLL, 'renderPayrollManagement');
    assertClean(code, 'renderPayrollManagement');
    const roster = linesMatching(code, /^\s*const allStaff\s*=/);
    assert.equal(roster.length, 1);
    assert.equal(roster[0].trim(), 'const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()}));');
    assert.ok(!/\busersSnap\b[^;]*\.filter\(/.test(code), 'usersSnap is filtered');
  });
  it('Gov Rates statutory preview (renderStatutoryStatusSection): clean, and the office roster is the unfiltered users list', () => {
    const code = codeOf(STAT_STATUS, 'renderStatutoryStatusSection');
    assertClean(code, 'renderStatutoryStatusSection');
    assert.equal(linesMatching(code, /officeDocs\s*=\s*usersRes\.docs\.map/).length, 1);
    assert.ok(norm(code).includes('officeDocs = usersRes.docs.map(d => ({ id: d.id, ...d.data() }));'), 'officeDocs is `usersRes.docs.map(...)` and nothing else');
  });
  it('Gov Rates office split (renderOfficeSplitSection): clean, and the roster filter is only removed / production', () => {
    const code = codeOf(STAT_SPLIT, 'renderOfficeSplitSection');
    assertClean(code, 'renderOfficeSplitSection');
    assert.ok(norm(code).includes("const officeRaw = hardFail ? [] : usersRes.docs.map(d => ({ id: d.id, ...d.data() })) .filter(u => u.removed !== true && u.payClass !== 'production');"),
      'officeRaw is the users list filtered by removed / production only');
  });
  it('HR profiles list (js/screens/employee-profile.js _epLoadRoster): clean, and `users` is the unfiltered list', () => {
    const code = codeOf(EP_ROSTER, '_epLoadRoster');
    assertClean(code, '_epLoadRoster');
    assert.ok(norm(code).includes('const users = (usersRes.value.docs || []).map(d => ({ id: d.id, ...d.data() }));'), '`users` is `.map(...)` with no .filter');
  });
});

// ═══════════════════════════ 4. no payroll-side file as a whole carries the rung (code only) ═══════════════════════════════════════════════════
describe('the payroll-side files carry no external-partner / Brilliant Steel test in code', () => {
  const FILES = ['js/payroll.js', 'js/payroll-weekly.js', 'js/screens/payroll.js', 'js/screens/payroll-backfill.js', 'js/screens/statutory-rates.js',
    'js/screens/employee-profile.js', 'js/pay-policy.js', 'js/statutory-status.js', 'js/bir.js', 'js/money-core.js'];
  for (const rel of FILES) {
    it(rel, () => assertClean(codeOf(read(rel), rel), rel));
  }
  it("js/screens/payroll-backfill.js's roster skips only production-class staff", () => {
    const code = codeOf(read('js/screens/payroll-backfill.js'), 'js/screens/payroll-backfill.js');
    assert.equal(linesMatching(code, /\bskip:/).length, 1);
    assert.equal(linesMatching(code, /\bskip:/)[0].trim(), "skip: u.payClass === 'production',");
  });
});

// ═══════════════════════════════════ 5. the predicate is gone ═════════════════════════════════════════════════════════════════════════════════
describe('window.isExternalPartnerUser is gone, not softened — and so is the temporary window.isRetiredRoleUser', () => {
  it('js/config.js evaluates (in a vm) with neither window.isExternalPartnerUser nor window.isRetiredRoleUser', () => {
    const sandbox = {
      console: { log() {}, info() {}, warn() {}, error() {} },
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      document: new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => null)) }),
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      navigator: { userAgent: 'node' },
      location: { search: '', hash: '', href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
      addEventListener() {},
    };
    sandbox.window = sandbox; sandbox.sessionStorage = sandbox.localStorage;
    vm.createContext(sandbox);
    try { vm.runInContext(read('js/config.js'), sandbox, { filename: 'js/config.js' }); }
    catch (e) { assert.fail(`js/config.js no longer evaluates in the minimal browser stub (${e.message}) — extend the stub in this test, do not delete the check`); }
    assert.equal(typeof sandbox.window.fetchUsersWithPayroll, 'function', 'config.js ran past the place the predicate used to live');
    assert.equal(typeof sandbox.window.isExternalPartnerUser, 'undefined');
    assert.equal(typeof sandbox.window.isRetiredRoleUser, 'undefined');
  });
  it('no code under js/ names isExternalPartnerUser, _isExternalPartner or isRetiredRoleUser (comments aside)', () => {
    const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === 'vendor' ? [] : walk(`${dir}/${e.name}`)) : (e.name.endsWith('.js') ? [`${dir}/${e.name}`] : []));
    const files = walk('js');
    assert.ok(files.length > 30 && files.includes('js/config.js') && files.includes('js/screens/hr.js'), 'the walk found the app scripts');
    const hits = [];
    for (const rel of files) {
      const raw = read(rel);
      if (!/isExternalPartner|isRetiredRoleUser/.test(raw)) continue;      // cheap pre-filter; only a file that says it at all is stripped
      if (/isExternalPartnerUser|_isExternalPartner|isRetiredRoleUser/.test(codeOf(raw, rel))) hits.push(rel);
    }
    assert.deepEqual(hits, [], 'isExternalPartnerUser / _isExternalPartner / isRetiredRoleUser is back in code');
  });
});
