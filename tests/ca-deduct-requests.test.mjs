// tests/ca-deduct-requests.test.mjs — owner ruling 2026-11-20: a CA deduction request is visible only to the
// employee who filed it, the President and Finance. They live in their own collection (ca_deduct_requests)
// because a per-document rule cannot hide them inside approval_requests without breaking office staff's
// status-only list queries. Textual rule/client pins + a behavioural test of CashAdvance.planFor's merge.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const RULES = read('firestore.rules').replace(/\/\/[^\n]*/g, '');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
function block(head) {
  const at = RULES.indexOf(head);
  assert.ok(at >= 0, `block not found: ${head}`);
  let depth = 0;
  for (let i = RULES.indexOf('{', at + head.length); i < RULES.length; i++) {
    if (RULES[i] === '{') depth++;
    else if (RULES[i] === '}' && --depth === 0) return RULES.slice(at, i + 1);
  }
  throw new Error('unbalanced');
}
const rule = (blk, kind) => norm((blk.match(new RegExp(`allow ${kind}:([\\s\\S]*?);`)) || [])[1] || '');
function jsFiles(dir = 'js', out = []) {
  for (const e of fs.readdirSync(new URL('../' + dir, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== 'vendor') jsFiles(`${dir}/${e.name}`, out); }
    else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
  }
  return out;
}

describe('ca_deduct_requests rules', () => {
  const B = block('match /ca_deduct_requests/{docId}');
  it('read: the filing employee, the President or Finance — exactly', () => {
    assert.equal(rule(B, 'read'), 'if isAuth() && (resource.data.userId == request.auth.uid || cadReader())');
  });
  it('cadReader() is President or Finance and names neither manager nor secretary', () => {
    const def = norm((B.match(/function cadReader\(\) \{[\s\S]*?\}/) || [''])[0]);
    assert.equal(def, "function cadReader() { return isPresident() || getRole() == 'finance'; }");
    assert.ok(!/manager|secretary/.test(def));
  });
  it('create: own pending request with the exact key set, or the President (migration arm) — parenthesised', () => {
    const c = rule(B, 'create');
    assert.match(c, /^if isAuth\(\) && \( \(hasProfile\(\)/);
    assert.match(c, /\|\| isPresident\(\)\)$/);
    assert.match(c, /request\.resource\.data\.get\('userId', ''\) == request\.auth\.uid/);
    assert.match(c, /request\.resource\.data\.get\('status', ''\) == 'pending'/);
    assert.match(c, /keys\(\)\.hasOnly\(\['userId','userName','month','amount','reason','status','createdAt'\]\)/);
    assert.match(c, /isBoundedString\(request\.resource\.data\.get\('reason', ''\), 1000\)/);
  });
  it('update: President/Finance only, pending -> approved|rejected, resolution fields only', () => {
    const u = rule(B, 'update');
    assert.match(u, /^if isAuth\(\) && cadReader\(\)/);
    assert.match(u, /resource\.data\.get\('status', ''\) == 'pending'/);
    assert.match(u, /request\.resource\.data\.get\('status', ''\) in \['approved', 'rejected'\]/);
    assert.match(u, /affectedKeys\(\)\.hasOnly\(\['status','approvedBy','approvedAt','rejectedBy','rejectedAt'\]\)/);
  });
  it('delete: President only', () => {
    assert.equal(rule(B, 'delete'), 'if isAuth() && isPresident()');
  });
  it('approval_requests no longer accepts a ca_deduct create, and its read is untouched', () => {
    const A = block('match /approval_requests/{docId}');
    assert.ok(!/ca_deduct/.test(A));
    assert.match(rule(A, 'create'), /request\.resource\.data\.get\('type', ''\) in \['bs_quote'\]/);
    assert.equal(rule(A, 'read'), 'if isAuth() && hasProfile() && isOfficeStaff()');
  });
});

describe('ca deduction request client wiring', () => {
  const ALL = jsFiles().map((f) => [f, read(f)]);
  it('nothing in js/ still adds a ca_deduct doc to approval_requests', () => {
    for (const [f, src] of ALL) {
      assert.ok(!/collection\('approval_requests'\)\s*\.add\(\s*\{[^}]*type:\s*'ca_deduct'/.test(src), `${f} still files ca_deduct into approval_requests`);
    }
  });
  it('the employee form writes to ca_deduct_requests with exactly the allowed keys', () => {
    const src = read('js/screens/dashboards.js');
    const m = src.match(/collection\('ca_deduct_requests'\)\.add\(\{([\s\S]*?)\}\);/);
    assert.ok(m, 'no ca_deduct_requests .add found');
    const names = new Set(m[1].replace(/\/\/[^\n]*/g, '').match(/\b(userId|userName|month|amount|reason|status|createdAt|type)\b(?=\s*[:,])/g));
    assert.deepEqual([...names].sort(), ['amount', 'createdAt', 'month', 'reason', 'status', 'userId', 'userName']);
  });
  it('APPROVAL_CAPS.ca_deduct is President + Finance', () => {
    assert.match(read('js/screens/approvals.js'), /'ca_deduct':\s*\['president','finance'\]/);
  });
  it('the Manager and Secretary dashboards never touch ca_deduct_requests', () => {
    const DASH = read('js/screens/dashboards.js');
    for (const name of ['renderManagerDashboard', 'renderSecretaryDashboard']) {
      const i = DASH.indexOf(`async function ${name}() {`);
      assert.ok(i > 0);
      const body = DASH.slice(i, DASH.indexOf('\nasync function ', i + 10));
      assert.ok(!/ca_deduct_requests/.test(body), `${name} reads ca_deduct_requests`);
    }
    const P = DASH.slice(DASH.indexOf('async function renderPresidentDashboard() {'), DASH.indexOf('async function renderManagerDashboard() {'));
    assert.match(P, /collection\('ca_deduct_requests'\)/);
  });
  it('the approvals screen only queries ca_deduct_requests behind a President/Finance gate', () => {
    const src = read('js/screens/approvals.js');
    assert.match(src, /const _cadRole = \(_role === 'president' \|\| _role === 'finance'\)/);
    for (const m of src.matchAll(/^.*collection\('ca_deduct_requests'\)(?!\.doc).*$/gm)) {
      const at = src.indexOf(m[0]);
      assert.match(src.slice(Math.max(0, at - 260), at + m[0].length), /_cadRole \?/, `ungated read: ${m[0].trim().slice(0, 80)}`);
    }
  });
});

// ── CashAdvance.planFor: an approved request in EITHER collection is the custom amount, never double-counted ──
describe('CashAdvance.planFor merges both collections', () => {
  const SRC = read('js/config.js');
  function extract(sig, openAfter = ')') {
    const start = SRC.indexOf(sig);
    assert.ok(start >= 0, `js/config.js no longer has "${sig}"`);
    let depth = 0;
    for (let i = SRC.indexOf('{', SRC.indexOf(openAfter, start)); i < SRC.length; i++) {
      if (SRC[i] === '{') depth++;
      else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
    }
    throw new Error('unbalanced braces');
  }
  function makeDb({ ca = [], cad = [], legacy = [], overrides = {} }) {
    const colls = { ca_deduct_requests: cad, approval_requests: legacy, cash_advances: ca };
    const q = (name) => {
      const filters = [];
      const o = {
        where(f, op, v) { filters.push([f, v]); return o; },
        async get() {
          const docs = colls[name].filter((d) => filters.every(([f, v]) => d[f] === v))
            .map((d) => ({ id: d.id, data: () => { const { id, ...r } = d; return r; } }));
          return { docs, size: docs.length };
        },
      };
      return o;
    };
    return {
      collection: (name) => name === 'payroll_ca_overrides'
        ? { doc: (id) => ({ get: async () => ({ exists: id in overrides, data: () => overrides[id] }) }) }
        : q(name),
    };
  }
  const merged = [];   // what planFor's request read resolved to (the cache layer's value)
  function load(db) {
    merged.length = 0;
    const body = `const _caRound2 = ${'(n)=>Math.round((n+Number.EPSILON)*100)/100'};
      ${extract('function _caInstallmentNo(a)')}
      ${extract('function _caSplit(cas, total)')}
      return { ${extract('async planFor(uid, month)')} };`;
    return new Function('db', 'window', 'dbCachedGet', body)(db, { caScope: (q) => q }, (key, fetcher) => (key.startsWith('ca-deduct-requests-') ? fetcher().then((v) => { merged.push(v); return v; }) : fetcher()));
  }
  const CA = [{ id: 'ca1', userId: 'u1', status: 'approved', balance: 10000, monthlyPayment: 1000, terms: 10 }];
  const req = (id, amount, extra = {}) => ({ id, userId: 'u1', month: '2026-11', amount, status: 'approved', ...extra });

  it('uses an approved request from ca_deduct_requests', async () => {
    const r = await load(makeDb({ ca: CA, cad: [req('r1', 3000)] })).planFor('u1', '2026-11');
    assert.equal(r.source, 'custom-request'); assert.equal(r.caPlanned, 3000);
  });
  it('uses an approved request still in the legacy approval_requests (type ca_deduct)', async () => {
    const r = await load(makeDb({ ca: CA, legacy: [req('r2', 2500, { type: 'ca_deduct' })] })).planFor('u1', '2026-11');
    assert.equal(r.source, 'custom-request'); assert.equal(r.caPlanned, 2500);
  });
  it('a legacy doc that is not a ca_deduct (a quote approval) is ignored', async () => {
    const r = await load(makeDb({ ca: CA, legacy: [req('q1', 9999, { type: 'bs_quote' })] })).planFor('u1', '2026-11');
    assert.equal(r.source, 'installment'); assert.equal(r.caPlanned, 1000);
  });
  it('the same request id in both collections (half-migrated) is counted once', async () => {
    const r = await load(makeDb({ ca: CA, cad: [req('dup', 3000)], legacy: [req('dup', 3000, { type: 'ca_deduct' })] })).planFor('u1', '2026-11');
    assert.equal(r.caPlanned, 3000);
    assert.equal(r.plan.length, 1);
    assert.equal(merged[0].docs.length, 1, 'the merged request list must hold the shared doc once');
  });
  it('another employee\'s or another month\'s request is not used', async () => {
    const r = await load(makeDb({ ca: CA, cad: [req('x1', 4000, { userId: 'u2' }), req('x2', 4000, { month: '2026-10' })] })).planFor('u1', '2026-11');
    assert.equal(r.source, 'installment');
  });
});
