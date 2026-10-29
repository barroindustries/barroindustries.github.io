// tests/ca-private-visibility.test.mjs — owner ruling 2026-10-29: a PRIVATE cash advance is seen only by
// its employee, the President and Finance (role). Managers and the Corporate Secretary must not see it,
// and — because a pay run's CA deductions come from cash_advances — only the President and Finance run
// payroll (a manager-run payroll would silently skip the private deductions).
//
// Rules are textual pins (no Java → no emulator); the client half is checked against the source:
// rules are not filters, so every manager/secretary list query must carry where('private','==',false).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const RULES = read('firestore.rules').replace(/\/\/[^\n]*/g, '');
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
const allow = (blk, verb) => {
  const m = blk.match(new RegExp(`allow ${verb}:([\\s\\S]*?);`));
  assert.ok(m, `no "allow ${verb}"`);
  return m[1].replace(/\s+/g, ' ');
};
const jsFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(new URL('../' + dir, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(`${dir}/${e.name}`); }
      else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
    }
  };
  walk('js');
  return out;
};

describe('cash_advances rules: private is employee + President + Finance only', () => {
  const ca = block('match /cash_advances/{docId}');
  it('the private readers are the President and the finance role — not isMoneyAdmin (which includes managers)', () => {
    assert.match(ca, /function caPrivateReader\(\) \{ return isPresident\(\) \|\| getRole\(\) == 'finance'; \}/);
  });
  it('read: owner, private readers, or a manager/secretary on a doc explicitly marked private:false', () => {
    const r = allow(ca, 'read');
    assert.match(r, /resource\.data\.userId == request\.auth\.uid \|\| caPrivateReader\(\)/);
    assert.match(r, /getRole\(\) in \['manager', 'secretary'\] && resource\.data\.get\('private', true\) == false/);
    assert.ok(!/isMoneyAdmin\(\)|isSecretary\(\)/.test(r), `a role-wide read is back: ${r}`);
  });
  it('a doc with no private key counts as private (default true) — only the backfill opens it to managers', () => {
    assert.ok(!/get\('private', false\)/.test(allow(ca, 'read')), 'a missing key reads as not-private again');
    assert.match(allow(ca, 'read'), /get\('private', true\)/);
  });
  it('create: a manager may only file private:false', () => {
    assert.match(allow(ca, 'create'), /\(caPrivateReader\(\) \|\| request\.resource\.data\.get\('private', true\) == false\)/);
  });
  it('update: a manager may only touch a private:false doc and must leave it private:false', () => {
    assert.match(allow(ca, 'update'), /caPrivateReader\(\) \|\| \(resource\.data\.get\('private', true\) == false && request\.resource\.data\.get\('private', true\) == false\)/);
  });
  it("an employee's own request may carry private:false, never true", () => {
    const fn = ca.match(/function caOwnCreateShapeOk\(\) \{[\s\S]*?\n {6}\}/)[0];
    assert.match(fn, /'private'\]\)/);
    assert.match(fn, /d\.get\('private', false\) == false/);
  });
  it('the (private, createdAt desc) index exists for the scoped orderBy lists', () => {
    const idx = JSON.parse(read('firestore.indexes.json')).indexes;
    assert.ok(idx.some((i) => i.collectionGroup === 'cash_advances'
      && JSON.stringify(i.fields) === JSON.stringify([{ fieldPath: 'private', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }])));
  });
});

describe('pay_runs rules: only the President and Finance run payroll', () => {
  const pr = block('match /pay_runs/{month}');
  it('payRunner() is the President or the finance role', () => {
    assert.match(pr, /function payRunner\(\) \{ return isPresident\(\) \|\| getRole\(\) == 'finance'; \}/);
  });
  it('create and every update arm require payRunner(); managers keep read', () => {
    assert.match(allow(pr, 'create'), /payRunner\(\)/);
    const u = pr.slice(pr.indexOf('allow update:'), pr.indexOf('allow delete:'));
    assert.ok(!/isMoneyAdmin\(\)/.test(u), 'an update arm still lets any money-admin (managers) write a run');
    assert.ok((u.match(/payRunner\(\)/g) || []).length >= 7, 'fewer payRunner() arms than before');
    assert.match(allow(pr, 'read'), /isMoneyAdmin\(\)/);
  });
});

describe('client: manager/secretary queries carry the private filter', () => {
  const cfg = read('js/config.js');
  it('caScope adds where(private == false) unless the viewer may see private advances', () => {
    assert.match(cfg, /window\.canSeePrivateCA = \(\) => \['president', ?'finance'\]\.includes\(window\.currentRole\)/);
    assert.match(cfg, /window\.caScope = [\s\S]{0,120}where\('private', ?'==', ?false\)/);
  });
  it('payroll is run only by the President or Finance in the client too', () => {
    assert.match(cfg, /window\.canRunPayroll = \(\) => \['president', ?'finance'\]\.includes\(window\.currentRole\)/);
  });
  it('CashAdvance.request always writes a boolean private', () => {
    const req = cfg.slice(cfg.indexOf('async request({ amount, terms'), cfg.indexOf('return ref.id;', cfg.indexOf('async request({ amount, terms')));
    assert.ok(/private:\s*false|\.private\s*=\s*!!isPrivate|\.private\s*=\s*(isPrivate\s*===\s*true|Boolean\(isPrivate\))/.test(req), 'request() may leave private unset');
    assert.ok(!/if \(typeof isPrivate !== 'undefined'\) docData\.private = isPrivate;/.test(req), 'the old optional private is back');
  });
  it('every cash_advances list query is either the viewer\'s own (userId == currentUser.uid) or wrapped in caScope', () => {
    const bad = [];
    for (const f of jsFiles()) {
      const src = read(f);
      for (const m of src.matchAll(/db\.collection\('cash_advances'\)(?!\.doc\(|\.add\()([^;\n]*)/g)) {
        const tail = m[1];
        const before = src.slice(Math.max(0, m.index - 40), m.index);
        if (/caScope\(\s*$/.test(before)) continue;
        if (/where\('userId', ?'==', ?(currentUser|window\.currentUser)\.uid\)/.test(tail)) continue;
        if (/^\s*;?\s*$/.test(tail) && /const caQ = $/.test(before)) continue; // a base ref scoped where it is used
        bad.push(`${f}: ${('db.collection(\'cash_advances\')' + tail).slice(0, 110)}`);
      }
    }
    assert.deepEqual(bad.filter((b) => !b.startsWith('js/migrations.js')), [], 'unscoped manager-visible query');
  });
});
