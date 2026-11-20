// tests/payment-claims-rules.test.mjs — P5 of specs/SALES-FLOW-SPEC-2026-11-19.md (§11.1 payment_claims, §11.3 indexes).
// Sales files and resends a claim; the books tier decides; Ops users cannot read. Textual pins parsed from the real firestore.rules
// (same block() style as tests/contract-rules.test.mjs).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const RAW = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const RULES = RAW.replace(/\/\/[^\n]*/g, '');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
function block(head) {
  const at = RULES.indexOf(head);
  assert.ok(at >= 0, `block not found: ${head}`);
  const open = RULES.indexOf('{', at + head.length);
  let depth = 0;
  for (let i = open; i < RULES.length; i++) {
    if (RULES[i] === '{') depth++;
    else if (RULES[i] === '}' && --depth === 0) return RULES.slice(at, i + 1);
  }
  throw new Error('unbalanced');
}
const PC = block('match /payment_claims/{id}');
const arm = (name) => norm(PC.match(new RegExp(`allow ${name}:([\\s\\S]*?);\\s*(?:allow |\\}$)`))[1]);

describe('payment_claims block (§11.1)', () => {
  it('exists exactly once, at the END of the collections section (after company_year_review, before the closing braces)', () => {
    assert.equal((RULES.match(/match \/payment_claims\/\{id\}/g) || []).length, 1);
    assert.ok(RULES.indexOf('match /payment_claims/{id}') > RULES.indexOf('match /company_year_review/{year}'));
    // Phase 5 appends its blocks after this one (change_orders … job_money), still at the end of the section.
    assert.match(norm(block('match /payment_claims/{id}')), /allow delete: if isAuth\(\) && isPresident\(\); \}$/);
    assert.match(norm(RULES.slice(RULES.indexOf('match /job_money/{id}'))), /\} \} \}$/);
  });
  it('read: books tier, admins (the secretary through isAdmin), Sales, or the creator — and needs a profile', () => {
    const r = arm('read');
    assert.match(r, /^if isAuth\(\) && hasProfile\(\)/);
    assert.match(r, /canFinance\(\) \|\| isAdmin\(\) \|\| inDept\('Sales'\) \|\| resource\.data\.createdBy == request\.auth\.uid/);
    assert.ok(!/inDept\('Production'\)|inDept\('Design'\)/.test(r), 'Ops users cannot read');
  });
  it('create: as itself, not a secretary, pending, and undecided', () => {
    const c = arm('create');
    assert.match(c, /hasProfile\(\) && !isSecretary\(\)/);
    assert.match(c, /request\.resource\.data\.createdBy == request\.auth\.uid/);
    assert.match(c, /request\.resource\.data\.status == 'pending'/);
    assert.match(c, /request\.resource\.data\.get\('paymentConfirm', \{\}\)\.get\('decision', null\) == null/);
  });
  it('update: the books tier, OR Sales / the creator resending an unconfirmed claim with ONLY the payment fields', () => {
    const u = arm('update');
    assert.match(u, /^if isAuth\(\) && \( canFinance\(\)/);
    assert.match(u, /hasProfile\(\) && !isSecretary\(\) && \(inDept\('Sales'\) \|\| resource\.data\.createdBy == request\.auth\.uid\)/);
    assert.match(u, /resource\.data\.status != 'recorded' && request\.resource\.data\.status == 'pending'/);
    assert.match(u, /request\.resource\.data\.paymentConfirm\.get\('decision', null\) == null/);
    const keys = [...u.match(/pcDiff\(\)\.hasOnly\(\[([^\]]*)\]\)/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(keys, ['kind', 'orRef', 'paymentConfirm', 'paymentDate', 'paymentMethod', 'paymentReceived', 'receiptName', 'receiptUrl', 'status', 'updatedAt', 'vatTreatment']);
    for (const k of ['recordedAmount', 'recordedAt', 'recordedBy', 'paNumber', 'bankAccountId', 'bankAccountName', 'orderId', 'projectId', 'createdBy', 'clientName'])
      assert.ok(!u.includes(`'${k}'`), `Sales must not be able to write ${k}`);
  });
  it('delete: the President only', () => {
    assert.match(arm('delete'), /^if isAuth\(\) && isPresident\(\)$/);
  });
  it('comments inside the block are single lines (CHECK 8 keeps narrative out of the rules)', () => {
    const at = RAW.indexOf('match /payment_claims/{id}');
    const end = RAW.indexOf('\n    }\n', at);
    const lines = RAW.slice(RAW.lastIndexOf('// Payment claims', at), end).split('\n');
    assert.ok(lines.every((l) => !/^\s*\/\*/.test(l)));
    assert.ok(!/\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*allow /.test(RAW.slice(at, end)), 'no stacked comment paragraphs');
    assert.ok(Buffer.byteLength(RAW) < 262144 * 0.8, 'rules stay under the CHECK 8 warning line');
  });
});

describe('payment_claims indexes (§11.3)', () => {
  const idx = JSON.parse(fs.readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')).indexes.filter((i) => i.collectionGroup === 'payment_claims');
  const sig = (i) => i.fields.map((f) => `${f.fieldPath}:${f.order}`).join(',');
  it('payments to confirm: status ASC, createdAt DESC', () => { assert.ok(idx.some((i) => i.queryScope === 'COLLECTION' && sig(i) === 'status:ASCENDING,createdAt:DESCENDING')); });
  it("a job's payment list: orderId ASC, createdAt ASC", () => { assert.ok(idx.some((i) => i.queryScope === 'COLLECTION' && sig(i) === 'orderId:ASCENDING,createdAt:ASCENDING')); });
  it('exactly those two, no duplicates', () => { assert.equal(idx.length, 2); });
});
