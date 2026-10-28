// tests/payroll-release-guards.test.mjs — system audit 2026-10-28, findings H2 and H3.
//
//   H2  A run's government deductions are FROZEN onto its lines at prepare, from whatever rate table is in memory then,
//       but the release gate checked only TODAY's table. Open January before the year's rates exist → every line freezes
//       ₱0 SSS/PhilHealth/Pag-IBIG/tax → confirm the rates → Pay passed and paid the zeros. The weekly gate was skipped
//       outright when the frozen total was ₱0 — exactly the no-table case. Now prepare stamps the table (statutoryStamp)
//       and both releases refuse when the stamp is missing or is not the confirmed table in force.
//   H3  correctAfterPay committed the corrected payslip first and posted the two ledger legs after. When the legs failed
//       (a closed period for Finance, a dropped connection), a second press measured against the already-corrected
//       payslip, saw a zero difference and posted nothing — the books lost the correction for good.
//
// H2's rule is pure and run here directly; its wiring into the four call sites is pinned on the source. H3 runs the REAL
// Payroll.correctAfterPay against tests/fixtures/fake-firestore.cjs (strict: atomic transactions, no undefined) with a
// ledger that can be told to refuse.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const money = require(path.join(ROOT, 'js/money-core.js'));
const ST = require(path.join(ROOT, 'js/statutory-tables.js'));
const WRC = require(path.join(ROOT, 'js/payroll-weekly.js'));
const PC = require(path.join(ROOT, 'js/payroll.js'));
const { createFake } = require(path.join(ROOT, 'tests/fixtures/fake-firestore.cjs'));
const W = globalThis;   // the files' window shim: window === globalThis under Node

const PLACEHOLDER_2026 = JSON.parse(JSON.stringify(W.STATUTORY['2026']));
const confirmed = (over) => Object.assign(JSON.parse(JSON.stringify(PLACEHOLDER_2026)), { verified: true, source: 'Accountant, Oct 2026' }, over || {});
function withTables(tables, fn) {
  const saved = W.STATUTORY;
  W.STATUTORY = tables;
  try { return fn(); } finally { W.STATUTORY = saved; }
}

describe('H2 — statutoryStamp fingerprints the rates a run was worked out with', () => {
  it('a year with no table at all is "none" and unconfirmed', () => {
    withTables({}, () => assert.deepEqual(ST.statutoryStamp(2027), { year: '2027', verified: false, fingerprint: 'none' }));
  });
  it('is stable for the same table, whatever order its keys arrive in', () => {
    const a = confirmed();
    const b = JSON.parse(JSON.stringify(a));
    b.sss = Object.fromEntries(Object.entries(b.sss).reverse());
    const fa = withTables({ 2026: a }, () => ST.statutoryStamp('2026').fingerprint);
    const fb = withTables({ 2026: b }, () => ST.statutoryStamp('2026').fingerprint);
    assert.equal(fa, fb);
    assert.match(fa, /^V-[0-9a-f]{8}$/);
  });
  it('changes when a rate changes, a bracket changes, or the table is confirmed', () => {
    const base = withTables({ 2026: confirmed() }, () => ST.statutoryStamp('2026').fingerprint);
    const rate = withTables({ 2026: confirmed({ sss: Object.assign({}, PLACEHOLDER_2026.sss, { rateEE: 0.045 }) }) }, () => ST.statutoryStamp('2026').fingerprint);
    const rows = PLACEHOLDER_2026.withholdingMonthly.map((r) => Object.assign({}, r));
    rows[1].rate = 0.16;
    const bracket = withTables({ 2026: confirmed({ withholdingMonthly: rows }) }, () => ST.statutoryStamp('2026').fingerprint);
    const unconfirmed = withTables({ 2026: PLACEHOLDER_2026 }, () => ST.statutoryStamp('2026').fingerprint);
    assert.equal(new Set([base, rate, bracket, unconfirmed]).size, 4);
    assert.match(unconfirmed, /^U-/);
  });
  it('ignores attestation details, so re-attesting the same rates does not force a re-prepare', () => {
    const a = withTables({ 2026: confirmed() }, () => ST.statutoryStamp('2026').fingerprint);
    const b = withTables({ 2026: confirmed({ source: 'Re-attested', attestedBy: 'pres', attestedAt: '2026-11-02' }) }, () => ST.statutoryStamp('2026').fingerprint);
    assert.equal(a, b);
  });
});

describe('H2 — statutoryReleaseBlock: pay only what was worked out with the confirmed table in force', () => {
  it('THE AUDIT CASE: January prepared before the rates existed, rates confirmed, Pay pressed → refused', () => {
    const frozen = withTables({}, () => ST.statutoryStamp('2027'));          // prepare: no 2027 table → ₱0 lines
    // the ₱0 really is what such a line carries:
    const line = withTables({}, () => money.computePayLine({ id: 'u1', salary: 30000 }, { month: '2027-01' }));
    assert.equal(line.statutoryTotal, 0);
    const block = withTables({ 2027: confirmed() }, () => ST.statutoryReleaseBlock(frozen, '2027'));
    assert.equal(block && block.code, 'changed');
  });
  it('prepared on placeholders, paid after the placeholders were confirmed or replaced → refused', () => {
    const frozen = withTables({ 2026: PLACEHOLDER_2026 }, () => ST.statutoryStamp('2026'));
    assert.equal(withTables({ 2026: confirmed() }, () => ST.statutoryReleaseBlock(frozen, '2026')).code, 'changed');
  });
  it('a run with no stamp (prepared before this change) must be prepared again', () => {
    assert.equal(withTables({ 2026: confirmed() }, () => ST.statutoryReleaseBlock(undefined, '2026')).code, 'unstamped');
    assert.equal(withTables({ 2026: confirmed() }, () => ST.statutoryReleaseBlock({}, '2026')).code, 'unstamped');
  });
  it('an unconfirmed table in force is still refused first', () => {
    const frozen = withTables({ 2026: PLACEHOLDER_2026 }, () => ST.statutoryStamp('2026'));
    assert.equal(withTables({ 2026: PLACEHOLDER_2026 }, () => ST.statutoryReleaseBlock(frozen, '2026')).code, 'unverified');
    assert.equal(withTables({}, () => ST.statutoryReleaseBlock(frozen, '2026')).code, 'unverified');
  });
  it('a stamp from another year never matches', () => {
    const t = { 2026: confirmed(), 2027: confirmed() };
    const frozen = withTables(t, () => ST.statutoryStamp('2026'));
    assert.equal(withTables(t, () => ST.statutoryReleaseBlock(frozen, '2027')).code, 'changed');
  });
  it('prepared with the confirmed table that is still in force → may be paid', () => {
    const t = { 2026: confirmed() };
    assert.equal(withTables(t, () => ST.statutoryReleaseBlock(ST.statutoryStamp('2026'), '2026')), null);
  });
});

describe('H2 — the weekly run knows when its deductions depend on the table', () => {
  const table = { ee: { sss: 500, philhealth: 250, pagibig: 100, tax: 0 }, er: { sss: 1000, philhealth: 250, pagibig: 100 } };
  it("an 'auto' worker relies on the table — even when it came out ₱0 for want of one", () => {
    const r = WRC.resolveStatutoryWeekly({ statConfig: { sss: 'auto', philhealth: 'fixed' }, philhealth: 200 }, { isLastPayWeek: true, table: null });
    assert.equal(r.applied, true);
    assert.equal(r.usesTable, true);
    assert.equal(r.sss, 0);
  });
  it('fixed and exempt workers do not', () => {
    const r = WRC.resolveStatutoryWeekly({ statConfig: { sss: 'fixed', tax: 'exempt' }, sss: 300 }, { isLastPayWeek: true, table });
    assert.equal(r.usesTable, false);
  });
  it('the unconfigured shape is unchanged (statutory-status suite pins it with deepEqual)', () => {
    assert.equal('usesTable' in WRC.resolveStatutoryWeekly({}, { isLastPayWeek: true, table }), false);
  });
});

describe('H2 — wiring: both prepares stamp, both releases check before the lock', () => {
  const depts = read('js/departments.js'), weekly = read('js/payroll-weekly.js');
  const slice = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
  it('computePayRun stamps the run it writes', () => {
    assert.match(slice(depts, 'window.computePayRun = async function', 'window.disbursePayRun'),
      /statutoryStamp: window\.statutoryStamp\(String\(month\)\.slice\(0,4\)\)/);
  });
  it('disbursePayRun refuses a mismatched stamp before the lock, and again inside it', () => {
    const fn = slice(depts, 'window.disbursePayRun = async function', 'const bankSplit');
    const lock = fn.indexOf('db.runTransaction');
    const pre = fn.indexOf("window.statutoryReleaseBlock(_pre.statutoryStamp, _payYear)");
    assert.ok(pre > 0 && pre < lock, 'pre-flight check must come before the lock');
    assert.match(fn.slice(pre, lock), /if \(_pre\.state === 'verified' && _statBlock && _statBlock\.code !== 'unverified'\) \{[\s\S]*?return;/);
    assert.match(fn.slice(lock), /if \(d\.state === 'verified'\) \{\s*\/\/[^\n]*\n\s*if \(window\.statutoryReleaseBlock\(d\.statutoryStamp, _payYear\)\) \{\s*throw/);
  });
  it('WeeklyRun.compute stamps the week it writes', () => {
    assert.match(weekly, /lines, skipped, totals, warnings,\s*\/\/[^\n]*\n\s*statutoryStamp: window\.statutoryStamp\(String\(weekId\)\.slice\(0, 4\)\),/);
  });
  it('WeeklyRun.disburse gates on table reliance, not on a non-zero total, and checks the stamp before the lock', () => {
    const fn = slice(weekly, 'async disburse(weekId, receiptsByWorkerId, opts)', '── 1. THE LOCK');
    assert.match(fn, /const reliesOnTable = statTotal > 0\s*\|\| preLines\.some\(\(l\) => l\.statutory && l\.statutory\.applied && l\.statutory\.usesTable\);/);
    assert.match(fn, /if \(reliesOnTable\) \{[\s\S]*?table\.verified !== true[\s\S]*?pre\.state === 'verified' && window\.statutoryReleaseBlock\(pre\.statutoryStamp, year\)/);
    assert.doesNotMatch(fn, /if \(statTotal > 0\) \{/);
  });
});

// ── H3: the real correctAfterPay against a strict in-memory Firestore ─────────────────────────────
describe('H3 — a pay correction always reaches the books, and never twice', () => {
  const MONTH = '2026-08', UID = 'u1', PS = `salary_history/${UID}_${MONTH}`;
  const EXP = `PAYFIX-${MONTH}-${UID}-1-EXP`, CASH = `PAYFIX-${MONTH}-${UID}-1-CASH`;
  let fake, ledger, refuse, sent;

  beforeEach(() => {
    fake = createFake();
    ledger = new Map(); refuse = new Set(); sent = [];
    const line = money.computePayLine({ id: UID, displayName: 'Marisol Cruz', salary: 30000, sss: 675, philhealth: 450, pagibig: 100, tax: 250 }, { month: MONTH, policy: 'flat' });
    fake.seed(`pay_runs/${MONTH}`, { state: 'disbursed', lines: [line] });
    fake.seed(PS, { userId: UID, month: MONTH, finalPay: line.finalPay });
    W.db = fake.db;
    W.firebase = { firestore: { FieldValue: Object.assign({}, fake.admin.firestore.FieldValue, { arrayUnion: (...els) => ({ arrayUnion: els }) }) } };
    W.currentUser = { uid: 'fin1', email: 'fin@x' };
    W.userProfile = { displayName: 'Finance' };
    W.logAudit = () => {};
    W.Notifs = { send: async (uid, n) => { sent.push(n.dedupKey); }, sendToDept: async () => {} };
    // A ledger that refuses on demand — a closed period for Finance, a dropped connection.
    W.Ledger = { upsertByRef: async (ref, build) => {
      if (refuse.has(ref)) throw new Error('This accounting period is closed.');
      ledger.set(ref, build(ledger.get(ref) || null));
    } };
    W.__line = line;
  });
  const correct = (net) => W.Payroll.correctAfterPay(MONTH, UID, { net, reason: 'Missed OT on 14 Aug' });
  const entries = () => fake.read(PS).corrections || [];

  it('happy path: one press, both legs, marked posted', async () => {
    const was = W.__line.finalPay;
    const r = await correct(was + 500);
    assert.deepEqual([...ledger.keys()].sort(), [CASH, EXP]);
    assert.equal(ledger.get(EXP).amount, 500);
    assert.equal(ledger.get(EXP).kind, 'debit');
    assert.equal(ledger.get(CASH).kind, 'credit');
    assert.equal(entries()[0].ledgerPosted, true);
    assert.deepEqual(r.ledgerRefs, [EXP, CASH]);
  });

  it('THE AUDIT CASE: the ledger refuses, the press fails loudly, and pressing again records it', async () => {
    const was = W.__line.finalPay;
    refuse.add(EXP); refuse.add(CASH);
    await assert.rejects(correct(was + 500), /now shows the corrected pay[\s\S]*Nothing is lost/);
    assert.equal(fake.read(PS).finalPay, was + 500, 'the payslip IS corrected');
    assert.equal(entries()[0].ledgerPosted, false, 'and says its legs are still owed');
    assert.equal(ledger.size, 0);
    assert.deepEqual(sent, [], 'nobody is told before the books have it');

    refuse.clear();
    const r = await correct(was + 500);                               // same figures, pressed again
    assert.equal(r.duplicate, true);
    assert.deepEqual([...ledger.keys()].sort(), [CASH, EXP]);
    assert.equal(ledger.get(EXP).amount, 500);
    assert.equal(ledger.get(CASH).amount, 500);
    assert.equal(entries().length, 1, 'still ONE correction');
    assert.equal(entries()[0].ledgerPosted, true);
    assert.deepEqual(sent, [`payroll-correction-${MONTH}-${UID}-1`], 'the person is told once, now');
    const runRec = fake.read(`pay_runs/${MONTH}`).corrections.arrayUnion[0];
    assert.equal(runRec.difference, 500, "the period records the correction's figures, not the repeat's 0");
  });

  it('half-posted (expense landed, cash refused): a repeat completes the pair and never doubles it', async () => {
    const was = W.__line.finalPay;
    refuse.add(CASH);
    await assert.rejects(correct(was + 250));
    assert.deepEqual([...ledger.keys()], [EXP]);
    refuse.clear();
    await correct(was + 250);
    assert.deepEqual([...ledger.keys()].sort(), [CASH, EXP]);
    assert.equal(ledger.get(EXP).amount, 250);
  });

  it('once posted, further repeats post nothing new', async () => {
    const was = W.__line.finalPay;
    await correct(was + 500);
    const before = JSON.stringify([...ledger.entries()]);
    await correct(was + 500);
    await correct(was + 500);
    assert.equal(JSON.stringify([...ledger.entries()]), before);
    assert.equal(entries().length, 1);
  });

  it('a genuine second correction books its own difference under its own number', async () => {
    const was = W.__line.finalPay;
    await correct(was + 500);
    await correct(was + 300);                                          // overpaid by 200 against the corrected pay
    const exp2 = ledger.get(`PAYFIX-${MONTH}-${UID}-2-EXP`);
    assert.equal(exp2.amount, 200);
    assert.equal(exp2.kind, 'credit');
    assert.equal(ledger.get(EXP).amount, 500, 'the first is untouched');
  });

  it('correctionLedgerOwed: a legacy entry (no flag) is owed — safe, the refs overwrite', () => {
    assert.deepEqual(PC.correctionLedgerOwed({ seq: 3, difference: -120, reason: 'x', was: 1000, now: 880 }),
      { seq: 3, amount: 120, owedMore: false, reason: 'x', was: 1000, now: 880, difference: -120 });
    assert.equal(PC.correctionLedgerOwed({ seq: 3, difference: 120, ledgerPosted: true }), null);
    assert.equal(PC.correctionLedgerOwed({ seq: 3, difference: 0 }), null);
    assert.equal(PC.correctionLedgerOwed(null), null);
  });
});
