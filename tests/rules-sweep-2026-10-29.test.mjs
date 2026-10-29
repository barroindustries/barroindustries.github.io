// tests/rules-sweep-2026-10-29.test.mjs — system sweep 2026-10-29, rules findings.
//
//   R1  users: an employee could write statConfig {sss:'exempt',…} / sss / tax / payClass onto their OWN profile;
//       fetchUsersWithPayroll merges {...users, ...payroll}, so any key absent from payroll/{uid} came from there and
//       zeroed their statutory deductions on the next Compute. Owners also could not be trusted with employmentStatus
//       (statutory rule) or title/jobTitle/status (self-minted ID card).
//   R2  posts: the author branch had no field limit — an author could publish their own pending post.
//   R3  notifications: senderUid was optional; omitting it skipped the push quota (keyed on it).
//   R4  cash_advances: a money-admin could approve (or create approved) their own advance.
//
// Textual pins (no Java → no emulator), cross-checked against the client code they must agree with.
// Compile-checked with `firebase deploy --only firestore:rules --dry-run`.
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
const frozen = (blk, key) => new RegExp(`n\\.get\\('${key}', null\\)\\s*==\\s*o\\.get\\('${key}', null\\)`).test(blk);

describe('R1 users: pay inputs and job identity are not self-editable', () => {
  const shared = block('function userPrivilegedFieldsUnchanged()');
  const owner = block('function ownerProfileFieldsUnchanged()');
  for (const k of ['statConfig', 'sss', 'philhealth', 'pagibig', 'tax', 'deductionsUnearned', 'payClass']) {
    it(`${k} is privileged (owner and secretary branches)`, () => assert.ok(frozen(shared, k)));
  }
  for (const k of ['employmentStatus', 'startDate', 'title', 'jobTitle', 'status']) {
    it(`${k} is frozen for the owner`, () => assert.ok(frozen(owner, k)));
  }
  it('the owner branch applies both helpers', () => {
    assert.match(RULES, /isOwner\(uid\) && userPrivilegedFieldsUnchanged\(\) && ownerProfileFieldsUnchanged\(\)/);
  });
  it('employmentStatus/startDate stay out of the shared helper (the secretary edits them)', () => {
    assert.ok(!frozen(shared, 'employmentStatus') && !frozen(shared, 'startDate'));
  });
  it('no self-edit screen writes a frozen key', () => {
    const app = read('js/app.js') + read('js/screens/people.js');
    const selfWrites = [...app.matchAll(/collection\('users'\)\.doc\(currentUser\.uid\)\.update\(\{([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(selfWrites.length >= 4, 'self-write scan found too little — update the pattern');
    for (const w of selfWrites) {
      for (const k of ['statConfig', 'sss', 'tax', 'payClass', 'employmentStatus', 'startDate', 'jobTitle', 'title:']) {
        assert.ok(!w.includes(k), `a self-edit writes ${k}: ${w}`);
      }
    }
  });
});

describe('R2 posts: the author cannot change status', () => {
  it('the author branch excludes status and authorId', () => {
    const upd = block('match /posts/{postId}').match(/allow update:([\s\S]*?);/)[1];
    assert.match(upd, /resource\.data\.authorId == request\.auth\.uid\s*&& !request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['status', 'authorId'\]\)/);
  });
});

describe('R3 notifications: senderUid is required and truthful', () => {
  const create = block('match /notifications/{uid}/{document=**}').match(/allow create:([\s\S]*?);/)[1];
  it('the create rule requires senderUid == auth.uid with no "absent" escape', () => {
    assert.match(create, /request\.resource\.data\.get\('senderUid', ''\) == request\.auth\.uid/);
    assert.ok(!/hasAny\(\['senderUid'\]\)/.test(create), 'the optional-senderUid branch is back');
  });
  it('every client fan-out stamps senderUid', () => {
    const n = read('js/notifications.js');
    assert.ok((n.match(/senderUid: window\.currentUser\.uid/g) || []).length >= 4);
  });
});

describe('R4 cash_advances: no self-approval below the President', () => {
  const blk = block('match /cash_advances/{docId}');
  it('create: a money-admin\'s own advance must be pending', () => {
    const c = blk.match(/allow create:([\s\S]*?);/)[1];
    assert.match(c, /isMoneyAdmin\(\) && \(isPresident\(\)[\s\S]*?!= request\.auth\.uid[\s\S]*?== 'pending'\)/);
  });
  it('update: a money-admin cannot move their own advance out of pending', () => {
    const u = blk.match(/allow update:([\s\S]*?);/)[1];
    assert.match(u, /isMoneyAdmin\(\) && \(isPresident\(\)[\s\S]*?resource\.data\.get\('status', ''\) != 'pending'/);
    assert.ok(!/\(\s*isMoneyAdmin\(\) \|\|/.test(u), 'an unconditional isMoneyAdmin() branch is back');
  });
  it('the client approve() refuses the same thing', () => {
    assert.match(read('js/config.js'), /cannot approve your own cash advance/);
  });
});
