// tests/phase5-rules.test.mjs — Phase 5 of specs/SALES-FLOW-SPEC-2026-11-19.md (§5.6, §5.7, §11.1, §11.3).
// Site visits and change requests are peso-free and open to staff; change orders carry pesos and Ops users cannot read them;
// job_money is books tier only. Textual pins parsed from the real firestore.rules (same block() style as payment-claims-rules).
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
const armOf = (B) => (name) => {
  const m = B.match(new RegExp(`allow ${name}:([\\s\\S]*?);\\s*(?:allow |\\}$)`));
  assert.ok(m, `arm not found: ${name}`);
  return norm(m[1]);
};

const CO = block('match /change_orders/{id}');
const CR = block('match /change_requests/{id}');
const SV = block('match /site_visits/{id}');
const JM = block('match /job_money/{id}');

describe('Phase 5 blocks exist once, after payment_claims', () => {
  for (const c of ['change_orders', 'change_requests', 'site_visits', 'job_money']) {
    it(c, () => {
      assert.equal((RULES.match(new RegExp(`match /${c}/\\{id\\}`, 'g')) || []).length, 1);
      assert.ok(RULES.indexOf(`match /${c}/{id}`) > RULES.indexOf('match /payment_claims/{id}'));
    });
  }
});

describe('change_orders (pesos)', () => {
  const arm = armOf(CO);
  it('read: books tier, admins, Sales — never Production or Design', () => {
    const r = arm('read');
    assert.match(r, /^if isAuth\(\) && hasProfile\(\) && \(canFinance\(\) \|\| isAdmin\(\) \|\| inDept\('Sales'\)\)$/);
    assert.ok(!/Production|Design|createdBy/.test(r));
  });
  it('create: Sales or books tier, not a secretary, never born applied', () => {
    const c = arm('create');
    assert.match(c, /!isSecretary\(\) && \(inDept\('Sales'\) \|\| canFinance\(\)\)/);
    assert.match(c, /request\.resource\.data\.get\('status', ''\) != 'applied'/);
  });
  it('update: Sales or books tier; an applied change order is frozen except for the books tier', () => {
    const u = arm('update');
    assert.match(u, /!isSecretary\(\) && \(inDept\('Sales'\) \|\| canFinance\(\)\)/);
    assert.match(u, /\( resource\.data\.get\('status', ''\) != 'applied' \|\| canFinance\(\) \)$/);
  });
  it('delete: President only', () => assert.equal(arm('delete'), 'if isAuth() && isPresident()'));
});

describe('change_requests (no pesos)', () => {
  const arm = armOf(CR);
  it('read: any signed-in profile (Rene follows the status)', () => assert.equal(arm('read'), 'if isAuth() && hasProfile()'));
  it('write: any non-secretary staff, and no price key can ever be written', () => {
    const w = arm('create, update');
    assert.match(w, /hasProfile\(\) && !isSecretary\(\)/);
    for (const k of ['pricing', 'price', 'unitPrice', 'amount', 'addedDownPayment']) assert.ok(w.includes(`'${k}'`), k);
    assert.match(w, /!request\.resource\.data\.keys\(\)\.hasAny\(/);
  });
  it('delete: admins', () => assert.equal(arm('delete'), 'if isAuth() && isAdmin()'));
});

describe('site_visits (no pesos)', () => {
  const arm = armOf(SV);
  it('read: any signed-in profile', () => assert.equal(arm('read'), 'if isAuth() && hasProfile()'));
  it('write: any non-secretary staff, and no fee amount can be written (it lives on the payment claim)', () => {
    const w = arm('create, update');
    assert.match(w, /hasProfile\(\) && !isSecretary\(\)/);
    for (const k of ['fee', 'amount', 'paymentReceived', 'recordedAmount']) assert.ok(w.includes(`'${k}'`), k);
    assert.match(w, /!request\.resource\.data\.keys\(\)\.hasAny\(/);
  });
  it('delete: admins', () => assert.equal(arm('delete'), 'if isAuth() && isAdmin()'));
});

describe('job_money (books tier only)', () => {
  it('read and write need canFinance()', () => assert.equal(armOf(JM)('read, write'), 'if isAuth() && canFinance()'));
});

describe('indexes (§11.3)', () => {
  const IX = JSON.parse(fs.readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')).indexes;
  const has = (c, f) => IX.some((x) => x.collectionGroup === c && JSON.stringify(x.fields) === JSON.stringify(f.map(([p, o]) => ({ fieldPath: p, order: o }))));
  it('change_orders (projectId, status)', () => assert.ok(has('change_orders', [['projectId', 'ASCENDING'], ['status', 'ASCENDING']])));
  it('change_requests (projectId, requestedAt desc)', () => assert.ok(has('change_requests', [['projectId', 'ASCENDING'], ['requestedAt', 'DESCENDING']])));
  it('site_visits (status, visitDate)', () => assert.ok(has('site_visits', [['status', 'ASCENDING'], ['visitDate', 'ASCENDING']])));
});
