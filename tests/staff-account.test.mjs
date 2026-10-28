// tests/staff-account.test.mjs — STATUS.md Open ruling #13: close Firebase Auth self-sign-up.
//
// Staff/worker logins used to be minted in the browser (createUserWithEmailAndPassword on a secondary app), which needs Auth sign-up
// left ENABLED for the public web apiKey; any stranger could then mint an Auth account and self-create users/{uid} as an 'employee'
// through the isOwner(uid) arm of the users create rule. Now the createStaffAccount callable (functions/index.js + the pure
// functions/staff-core.js) creates the login and the profile with the Admin SDK, the isOwner arm is gone, and loadUserProfile no
// longer self-creates a profile.
//
// WHAT IT PINS
//   1. MATRIX       authorizeStaffCreate(): which caller may mint which role, with or without a privileged department — an explicit
//                   table (no caller profile / offboarded / employee / agent / finance / secretary / manager / president / the
//                   accountAdmin flag on an employee and on a finance user).
//   2. DRIFT        staff-core's role lists and privileged departments equal the ones the users create rule and
//                   noPrivilegedDeptOnCreate() spell out in firestore.rules (and PLACEHOLDER_PRIVILEGED_DEPTS in functions/index.js).
//   3. SHAPE        parseStaffRequest() rejects bad input; buildStaffUserDoc() writes an explicit field list (never accountAdmin, never a
//                   client-sent uid / removed / payroll field); claimsFor() is syncUserClaims' { role, departments } shape.
//   4. RULES        the users create statement has exactly four arms — isPresident, isSeniorAdmin, isAdmin, isAccountAdminFlag — and no
//                   isOwner arm: an identity with no admin-tier profile cannot create ANY users doc, its own included.
//   5. CLIENT       no createUserWithEmailAndPassword anywhere in js/; both account forms call createStaffAccount; loadUserProfile
//                   writes no users doc.
//   6. CALLABLE     (needs functions/node_modules; skips otherwise) the REAL createStaffAccount against tests/fixtures/fake-firestore.cjs
//                   and a stub Auth: denials write nothing and create no login; a success writes the doc first, creates the login on
//                   the SAME uid, sets claims, allocates the employee id, writes usernames/{u}; a failed login create rolls the docs back.
//
// MUTATION-TESTED in a scratch copy (the shared tree is never touched), each mutant alone; every one turned this file red:
//   M1 the isOwner(uid) self-create arm back in firestore.rules         M2 manager may mint 'president' in staff-core
//   M3 secretary/accountAdmin may use a privileged department           M4 the accountAdmin flag check dropped (flag-only callers denied)
//   M5 the offboarded-caller check dropped                              M6 buildStaffUserDoc spreads the request (accountAdmin leaks)
//   M7 loadUserProfile self-creates its profile again                   M8 people.js back on createUserWithEmailAndPassword
//   M9 the callable authorizes AFTER creating the login                 M10 no rollback when the Auth create fails
//   M11 'Ventures' dropped from PRIVILEGED_DEPTS                        M12 claims not set by the callable
//
// Fixtures are synthetic. Run with: node --test tests/*.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './fixtures/strip-comments.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const S = require('../functions/staff-core.js');

const CALLERS = {
  none: null,
  offboardedPresident: { role: 'president', removed: true },
  employee: { role: 'employee' },
  agent: { role: 'agent' },
  finance: { role: 'finance' },
  secretary: { role: 'secretary' },
  manager: { role: 'manager' },
  president: { role: 'president' },
  flagEmployee: { role: 'employee', accountAdmin: true },
  flagFinance: { role: 'finance', accountAdmin: true },
};
const ALL = S.KNOWN_ROLES.flatMap((r) => [`${r}/plain`, `${r}/privileged`]);
const BASIC = ['employee/plain', 'agent/plain'];
const EXPECTED = {
  none: [], offboardedPresident: [], employee: [], agent: [], finance: [],
  secretary: BASIC,
  manager: ['manager', 'secretary', 'employee', 'agent', 'finance'].flatMap((r) => [`${r}/plain`, `${r}/privileged`]),
  president: ALL,
  flagEmployee: BASIC,
  flagFinance: BASIC,
};

describe('1. authorization matrix', () => {
  for (const [who, caller] of Object.entries(CALLERS)) {
    it(`${who} may mint exactly ${EXPECTED[who].length ? EXPECTED[who].join(', ') : 'nothing'}`, () => {
      const got = [];
      for (const role of S.KNOWN_ROLES) {
        for (const kind of ['plain', 'privileged']) {
          const departments = kind === 'privileged' ? ['Sales', 'Finance'] : ['Sales'];
          if (S.authorizeStaffCreate(caller, { role, departments }) === null) got.push(`${role}/${kind}`);
        }
      }
      assert.deepEqual(got.sort(), [...EXPECTED[who]].sort());
    });
  }
  it('each privileged department is refused to the basic tier, one at a time', () => {
    for (const d of ['Finance', 'Design', 'Ventures', 'IT']) {
      assert.notEqual(S.authorizeStaffCreate(CALLERS.secretary, { role: 'employee', departments: [d] }), null, d);
      assert.notEqual(S.authorizeStaffCreate(CALLERS.flagEmployee, { role: 'agent', departments: [d] }), null, d);
    }
  });
});

describe('2. no drift from firestore.rules', () => {
  const rules = read('firestore.rules');
  const arr = (s) => JSON.parse(s.replace(/'/g, '"'));
  it('isSeniorAdmin arm role list', () => {
    const m = rules.match(/isSeniorAdmin\(\)\s*&& noAccountAdminOnCreate\(\)[\s\S]*?in\s*(\[[^\]]*\])/);
    assert.ok(m); assert.deepEqual(arr(m[1]), S.SENIOR_MINTABLE_ROLES);
  });
  it('isAdmin and isAccountAdminFlag arm role lists', () => {
    for (const head of ['isAdmin', 'isAccountAdminFlag']) {
      const m = rules.match(new RegExp(head + '\\(\\)\\s*&& noAccountAdminOnCreate\\(\\)\\s*&& request\\.resource\\.data\\.get\\(\'role\', \'employee\'\\) in (\\[[^\\]]*\\])'));
      assert.ok(m, head); assert.deepEqual(arr(m[1]), S.BASIC_MINTABLE_ROLES, head);
    }
  });
  it('noPrivilegedDeptOnCreate list (and functions/index.js PLACEHOLDER_PRIVILEGED_DEPTS)', () => {
    const fnBody = rules.slice(rules.indexOf('function noPrivilegedDeptOnCreate()'), rules.indexOf('function noAccountAdminOnCreate()'));
    const m = fnBody.match(/departments', \[\]\)\.hasAny\((\[[^\]]*\])\)/);
    for (const d of S.PRIVILEGED_DEPTS) assert.match(fnBody, new RegExp(`get\\('department', ''\\) != '${d}'`), d);
    assert.ok(m); assert.deepEqual(arr(m[1]), S.PRIVILEGED_DEPTS);
    const p = read('functions/index.js').match(/PLACEHOLDER_PRIVILEGED_DEPTS = (\[[^\]]*\])/);
    assert.ok(p); assert.deepEqual(arr(p[1]), S.PRIVILEGED_DEPTS);
  });
});

describe('3. request parsing and the written doc', () => {
  const ok = (d) => { const r = S.parseStaffRequest(d); assert.equal(r.error, undefined, r.error); return r.req; };
  const bad = (d) => assert.ok(S.parseStaffRequest(d).error, JSON.stringify(d));
  it('rejects bad input', () => {
    bad(null); bad({ kind: 'admin', role: 'employee' });
    bad({ kind: 'invite', role: 'boss', email: 'a@b.co' });
    bad({ kind: 'invite', role: 'employee', email: 'not-an-email' });
    bad({ kind: 'invite', role: 'employee', email: 'x@bi.barroindustries' });
    bad({ kind: 'invite', role: 'agent', email: 'a@b.co', freelancer: true });
    bad({ kind: 'invite', role: 'employee', email: 'a@b.co', departments: [''] });
    bad({ kind: 'invite', role: 'employee', email: 'a@b.co', departments: Array.from({ length: 21 }, (_, i) => 'D' + i) });
    const w = { kind: 'worker', role: 'employee', username: 'jdc', password: 'secret1', displayName: 'Juan' };
    ok(w);
    bad({ ...w, username: 'J D' }); bad({ ...w, username: 'a' }); bad({ ...w, password: '12345' });
    bad({ ...w, displayName: '' }); bad({ ...w, departments: ['Sales', 'HR'] }); bad({ ...w, startDate: '28/10/2026' });
  });
  it('invite doc: explicit fields only, freelancer stamp, nothing the client smuggles', () => {
    const req = ok({ kind: 'invite', role: 'employee', email: 'New@Example.com', displayName: 'N', phone: '1', freelancer: true,
      departments: ['Sales'], accountAdmin: true, uid: 'evil', removed: false, salary: 99, hrManagedAccount: true });
    const FV = { serverTimestamp: () => 'TS' };
    const doc = S.buildStaffUserDoc(req, 'U1', 'C1', 'BI-2026-007', '2026-10-28', FV);
    assert.deepEqual(Object.keys(doc).sort(), ['createdAt', 'createdBy', 'createdVia', 'department', 'departments', 'displayName', 'email',
      'employeeId', 'employmentType', 'phone', 'photoUrl', 'role', 'startDate', 'team', 'uid'].sort());
    assert.equal(doc.uid, 'U1'); assert.equal(doc.email, 'new@example.com'); assert.equal(doc.team, 'freelancer');
    assert.equal(doc.employmentType, 'Project-based'); assert.equal(doc.createdBy, 'C1');
    assert.deepEqual(S.claimsFor(doc), { role: 'employee', departments: ['Sales'] });
  });
  it('worker doc: hrManagedAccount, synthetic email, team from payClass', () => {
    const req = ok({ kind: 'worker', role: 'employee', username: 'jdc', password: 'secret1', displayName: 'Juan',
      departments: ['Production'], payClass: 'production', employeeId: 'BI-1', accountAdmin: true });
    const doc = S.buildStaffUserDoc(req, 'U2', 'C1', req.employeeId, '2026-10-28', { serverTimestamp: () => 'TS' });
    assert.equal(doc.email, 'jdc@bi.barroindustries'); assert.equal(doc.authEmail, doc.email);
    assert.equal(doc.username, 'jdc'); assert.equal(doc.hrManagedAccount, true); assert.equal(doc.team, 'operations');
    assert.equal(doc.startDate, '2026-10-28'); assert.equal('accountAdmin' in doc, false); assert.equal('password' in doc, false);
  });
});

describe('4. firestore.rules — no self-create', () => {
  const rules = stripComments(read('firestore.rules'));
  const users = rules.slice(rules.indexOf('match /users/{uid}'));
  const stmt = users.slice(users.indexOf('allow create:'), users.indexOf('allow update:'));
  it('the users create statement has exactly the four admin-tier arms', () => {
    const flat = stmt.replace(/\s+/g, ' ');
    assert.match(flat, /^allow create: if isAuth\(\) && \( isPresident\(\) \|\| \( isSeniorAdmin\(\) .*\) \|\| \( isAdmin\(\) .*\) \|\| \( isAccountAdminFlag\(\) .*\) \);/);
    assert.equal((flat.match(/\) \|\| \(/g) || []).length, 3);
  });
  it('no isOwner term in it', () => assert.equal(/isOwner\s*\(/.test(stmt), false));
});

describe('5. client', () => {
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'vendor' ? [] : walk(`${dir}/${e.name}`)) : (e.name.endsWith('.js') ? [`${dir}/${e.name}`] : []));
  it('no createUserWithEmailAndPassword anywhere in js/', () => {
    for (const f of walk('js')) assert.equal(/createUserWithEmailAndPassword/.test(stripComments(read(f))), false, f);
  });
  it('both account forms call createStaffAccount', () => {
    for (const f of ['js/screens/people.js', 'js/screens/dashboards.js']) {
      assert.match(stripComments(read(f)), /httpsCallable\('createStaffAccount'\)/, f);
    }
  });
  it('loadUserProfile writes no users doc', () => {
    const app = stripComments(read('js/app.js'));
    const start = app.indexOf('async function loadUserProfile(');
    const body = app.slice(start, app.indexOf('\nfunction applyUserUI', start));
    assert.ok(start > 0 && body.length > 200);
    assert.equal(/\.set\(|\.add\(|runTransaction|_counters/.test(body), false);
  });
});

// ── 6. the real callable ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const HAVE_DEPS = fs.existsSync(path.join(ROOT, 'functions', 'node_modules', 'firebase-functions', 'package.json'));
describe('6. createStaffAccount end to end', { skip: HAVE_DEPS ? false : 'functions/node_modules is not installed (firebase-functions missing)' }, () => {
  const { createFake } = HAVE_DEPS ? require('./fixtures/fake-firestore.cjs') : {};
  let fake, authUsers, claims, fn, failCreate;
  const authStub = () => ({
    async getUserByEmail(email) {
      for (const u of authUsers.values()) if (u.email === email) return u;
      throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
    },
    async createUser(p) {
      if (failCreate) throw Object.assign(new Error('boom'), { code: failCreate });
      if (!fake.has('users/' + p.uid)) throw new Error('profile must exist before the login');   // ordering guard
      authUsers.set(p.uid, { ...p }); return p;
    },
    async setCustomUserClaims(uid, c) { claims.set(uid, c); },
  });
  beforeEach(() => {
    fake = createFake(); authUsers = new Map(); claims = new Map(); failCreate = null;
    fake.admin.auth = authStub;
    for (const [k, v] of Object.entries(CALLERS)) if (v) fake.seed('users/' + k, v);
    const idx = require.resolve('../functions/index.js');
    delete require.cache[idx];
    const orig = Module._load;
    Module._load = function (request) { if (request === 'firebase-admin') return fake.admin; return orig.apply(this, arguments); };
    try { fn = require(idx).createStaffAccount; } finally { Module._load = orig; }
  });
  const call = (who, data) => fn.run(data, { auth: who ? { uid: who } : undefined });
  const rejects = async (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, e.message); return true; });
  const invite = (extra) => ({ kind: 'invite', role: 'employee', email: 'new.hire@example.com', displayName: 'New Hire', departments: ['Sales'], ...extra });
  const worker = (extra) => ({ kind: 'worker', role: 'employee', username: 'jdc', password: 'secret1', displayName: 'Juan', departments: ['Production'], ...extra });
  const userDocs = () => fake.list('users').length;

  it('unauthenticated, no-profile and employee callers are refused and nothing is written', async () => {
    const before = userDocs();
    await rejects(call(null, invite()), 'unauthenticated');
    await rejects(call('stranger', invite()), 'permission-denied');
    await rejects(call('employee', invite()), 'permission-denied');
    await rejects(call('finance', worker()), 'permission-denied');
    assert.equal(userDocs(), before); assert.equal(authUsers.size, 0); assert.equal(fake.has('usernames/jdc'), false);
  });
  it('secretary invite: doc first, login on the same uid, claims, employee id, audit', async () => {
    const r = await call('secretary', invite({ accountAdmin: true }));
    const doc = fake.read('users/' + r.uid);
    assert.equal(doc.role, 'employee'); assert.equal(doc.accountAdmin, undefined); assert.equal(doc.createdBy, 'secretary');
    assert.match(doc.employeeId, /^BI-\d{4}-001$/); assert.equal(fake.read('_counters/employees').count, 1);
    assert.equal(authUsers.get(r.uid).email, 'new.hire@example.com');
    assert.ok(authUsers.get(r.uid).password.length >= 20);
    assert.deepEqual(claims.get(r.uid), { role: 'employee', departments: ['Sales'] });
    assert.equal(fake.list('audit_log').length, 1);
  });
  it('tier limits hold in the callable', async () => {
    await rejects(call('secretary', invite({ departments: ['Finance'] })), 'permission-denied');
    await rejects(call('flagEmployee', invite({ role: 'finance' })), 'permission-denied');
    await rejects(call('manager', invite({ role: 'president' })), 'permission-denied');
    await rejects(call('offboardedPresident', invite()), 'permission-denied');
    assert.equal(authUsers.size, 0);
    const m = await call('manager', invite({ role: 'manager', departments: ['IT'] }));
    assert.equal(fake.read('users/' + m.uid).role, 'manager');
  });
  it('account-admin worker: usernames map + hrManagedAccount; a taken username creates nothing', async () => {
    const r = await call('flagEmployee', worker({ employeeId: 'BI-2026-050' }));
    assert.deepEqual(fake.read('usernames/jdc'), { email: 'jdc@bi.barroindustries', uid: r.uid });
    const doc = fake.read('users/' + r.uid);
    assert.equal(doc.hrManagedAccount, true); assert.equal(doc.employeeId, 'BI-2026-050');
    assert.equal(fake.has('_counters/employees'), false);
    const n = userDocs();
    await rejects(call('president', worker()), 'already-exists');
    assert.equal(userDocs(), n); assert.equal(authUsers.size, 1);
  });
  it('an existing email is refused before any write', async () => {
    authUsers.set('x', { uid: 'x', email: 'new.hire@example.com' });
    const n = userDocs();
    await rejects(call('president', invite()), 'already-exists');
    assert.equal(userDocs(), n); assert.equal(fake.has('_counters/employees'), false);
  });
  it('a failed login create rolls back the users and usernames docs', async () => {
    const n = userDocs();
    failCreate = 'auth/email-already-exists';
    await rejects(call('president', worker()), 'already-exists');
    failCreate = 'auth/internal-error';
    await rejects(call('president', invite()), 'internal');
    assert.equal(userDocs(), n); assert.equal(fake.has('usernames/jdc'), false); assert.equal(authUsers.size, 0);
  });
});
