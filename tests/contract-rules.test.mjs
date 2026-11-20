// tests/contract-rules.test.mjs — WP 2B of specs/SALES-FLOW-SPEC-2026-11-19.md (§7.3, §10.1, §11.2).
// F3 "Revise contract amount": Sales may FILE / RESEND / WITHDRAW a pendingRevision and nothing else;
// the apply (contractAmount, contractRev, revisions, originalContractAmount) stays books-tier.
// Textual pins parsed from the real firestore.rules (same block() style as sales-quick-fixes-rules.test.mjs).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const RULES = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '');
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
const SO = block('match /sales_orders/{docId}');
const JP = block('match /job_projects/{docId}');
const ARM = norm(block('function soRevisionRequest()'));
const UPDATE = norm(SO.match(/allow update:([\s\S]*?);\s*allow delete/)[1]);

describe('F3 sales_orders pendingRevision arm', () => {
  it('is OR-ed into update next to the existing arms (books tier + Sales arm untouched)', () => {
    assert.match(UPDATE, /canFinance\(\)/);
    assert.match(UPDATE, /\|\| soSalesUpdate\(\) \|\| soRevisionRequest\(\) \)$/);
    assert.match(UPDATE, /^if isAuth\(\) && soDecisionOk\(\) && soSelfConfirmOk\(\) && \(/);
  });
  it('actor: not secretary (getRole needs a profile), creator or Sales dept', () => {
    assert.match(ARM, /return !isSecretary\(\) &&/);
    assert.match(ARM, /\(resource\.data\.createdBy == request\.auth\.uid \|\| inDept\('Sales'\)\)/);
  });
  it("affectedKeys hasOnly exactly ['pendingRevision','updatedAt']", () => {
    assert.match(ARM, /soDiff\(\)\.hasOnly\(\['pendingRevision','updatedAt'\]\)/);
  });
  it("only while the order's status is 'recorded'", () => {
    assert.match(ARM, /resource\.data\.get\('status',''\)\s*==\s*'recorded'/);
  });
  it('a written request has decision == null and a pending status (resend of a rejected one included)', () => {
    assert.match(ARM, /request\.resource\.data\.pendingRevision\.get\('decision', null\) == null/);
    assert.match(ARM, /request\.resource\.data\.pendingRevision\.get\('status', ''\) in \['pending_approval','pending_confirm'\]/);
  });
  it('removing the field (withdraw) is allowed', () => {
    assert.match(ARM, /!\('pendingRevision' in request\.resource\.data\) \|\|/);
  });
  it('the arm cannot write any apply field', () => {
    for (const k of ['contractAmount', 'contractRev', 'revisions', 'originalContractAmount', 'paymentConfirm'])
      assert.ok(!ARM.includes(`'${k}'`), `${k} must not appear in the arm`);
  });
});

describe('F3 job_projects money keys', () => {
  const m = norm(JP).match(/affectedKeys\(\)\.hasAny\( \[([^\]]*)\]\)/);
  it('keeps the old keys and adds clientCredit, refunds, joRev', () => {
    assert.ok(m, 'money-key hasAny list not found');
    const keys = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    for (const k of ['payments', 'amountCollected', 'arBalance', 'invoices', 'dpPercent', 'balanceSchedule', 'contractAmount', 'clientCredit', 'refunds', 'joRev'])
      assert.ok(keys.includes(k), `missing money key ${k}`);
  });
  it('budgetBadge is NOT added yet (Phase 8)', () => {
    assert.ok(!JP.includes('budgetBadge'));
  });
  it('the money keys still require canFinance()', () => {
    assert.match(norm(JP), /\|\| canFinance\(\) \)( && paidOk\(\))?;/);
  });
});
