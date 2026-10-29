// tests/rules-pay-integrity.test.mjs — system audit 2026-10-28, findings C2, C3 and H1.
//
//   C2  cash_advances: the borrower could rewrite monthlyPayment (→ never deducted), append a fake {source:'payroll', month}
//       to payments[] (→ deduction skipped as "already posted") or re-point userId at a co-worker (→ the co-worker repays).
//       Owner update is now reason/date only, only while pending; a self-filed create carries exactly CashAdvance.request()'s shape.
//   C3  tasks: an assignee could set status 'approved' + completedAt (KPI → pay) or drop themselves from assignedTo. Non-admins
//       now stay inside the employee statuses, cannot stamp completedAt, and touch only the fields the employee screens write.
//   H1  storage: Finance/* (Taxes, Ledger, Records, SSS, Accounting) and HR/* (layoff papers) were get-AND-list for every role
//       claim. Finance tier / HR members now; everyone else only their own upload (Drive's getDownloadURL after put()).
//
// No Java on the dev machine → no rules emulator, so these are textual pins of firestore.rules / storage.rules, cross-checked
// against the client code they must agree with (the shape CashAdvance.request() writes, tasks.js EMP_STATUSES, drive.js's
// uploadedBy stamp). The rules themselves were compile-checked with `firebase deploy --only firestore:rules,storage --dry-run`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Rules files: drop // comments (rule paths use single slashes, and no string here holds a //).
const rulesCode = (rel) => read(rel).replace(/\/\/[^\n]*/g, '');

// The body of the block that starts at `head` (a `match …` or `function …` line), braces balanced.
function block(src, head) {
  const at = src.indexOf(head);
  assert.ok(at >= 0, `block not found: ${head}`);
  const open = src.indexOf('{', at + head.length);   // past the head, whose path wildcards are braces too
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced block: ${head}`);
}
// One `allow <verbs>: …;` statement of a block.
function allow(blk, verbs) {
  const m = blk.match(new RegExp(`allow ${verbs}:([\\s\\S]*?);`));
  assert.ok(m, `no "allow ${verbs}" in block`);
  return m[1];
}
const quoted = (s) => [...s.matchAll(/'([^']+)'/g)].map(m => m[1]);
const sorted = (a) => [...new Set(a)].sort();

const FS = rulesCode('firestore.rules');
const ST = rulesCode('storage.rules');

describe('C2 — cash_advances: the borrower cannot touch what payroll trusts', () => {
  const ca = block(FS, 'match /cash_advances/{docId}');

  it('owner update is reason/date only, and only while the request is still pending', () => {
    const upd = allow(ca, 'update');
    // Money tier, minus self-approval (sweep 2026-10-29, tests/rules-sweep-2026-10-29.test.mjs R4).
    assert.match(upd, /\(isMoneyAdmin\(\) && \(isPresident\(\)[\s\S]*?\)\)\s*\|\|/);
    const owner = upd.slice(upd.indexOf('resource.data.userId == request.auth.uid'));
    assert.match(owner, /resource\.data\.status == 'pending'/);
    const keys = owner.match(/affectedKeys\(\)\.hasOnly\((\[[^\]]*\])\)/);
    assert.ok(keys, 'owner arm must pin affectedKeys().hasOnly([...])');
    assert.deepEqual(sorted(quoted(keys[1])), ['date', 'reason']);
    for (const f of ['monthlyPayment', 'payments', 'userId', 'balance', 'status', 'amount', 'terms', 'interest'])
      assert.ok(!quoted(keys[1]).includes(f), `owner may not change ${f}`);
  });

  it('a self-filed create must pass caOwnCreateShapeOk()', () => {
    const create = allow(ca, 'create');
    const ownerArm = create.slice(create.indexOf('request.resource.data.userId == request.auth.uid'));
    assert.match(ownerArm, /request\.resource\.data\.status == 'pending'/);
    assert.match(ownerArm, /request\.resource\.data\.balance == 0/);
    assert.match(ownerArm, /caOwnCreateShapeOk\(\)/);
  });

  it('the create shape is exactly what CashAdvance.request() writes (private:false only, no pre-seeded schedule)', () => {
    const fn = block(ca, 'function caOwnCreateShapeOk()');
    const ruleKeys = sorted(quoted(fn.match(/keys\(\)\.hasOnly\((\[[\s\S]*?\])\)/)[1]));
    const cfg = read('js/config.js');
    const req = cfg.slice(cfg.indexOf('async request({ amount, terms'));
    const lit = req.slice(req.indexOf('const docData = {'), req.indexOf('};', req.indexOf('const docData = {')));
    const clientKeys = sorted([...lit.matchAll(/(?:^|[{,\s])([A-Za-z]+)\s*:/g)].map(m => m[1]));
    // Owner ruling 2026-10-29: every advance carries a boolean `private` (managers/secretary query
    // where('private','==',false)), so a self-request writes private:false — and only false.
    const noPriv = (ks) => ks.filter((k) => k !== 'private');
    assert.deepEqual(noPriv(ruleKeys), noPriv(clientKeys), 'rules key list drifted from CashAdvance.request() docData');
    assert.ok(ruleKeys.includes('private'), 'a self-request must be allowed to carry private:false');
    assert.match(fn, /d\.get\('private', false\) == false/, 'a self-request may never mark itself private');
    assert.match(fn, /d\.get\('payments', \[\]\)\.size\(\) == 0/);
    assert.match(fn, /d\.get\('monthlyPayment', null\) == null/);
    assert.match(fn, /d\.get\('totalPayable', null\) == null/);
    assert.match(fn, /d\.get\('interest', 0\) == 0/);
    assert.match(fn, /d\.get\('amount', 0\) <= 50000/);
    assert.deepEqual(quoted(fn.match(/d\.get\('terms', 1\) in (\[[^\]]*\])/)?.[1] || '').length, 0, 'terms list is numeric');
    const terms = fn.match(/d\.get\('terms', 1\) in \[([^\]]*)\]/)[1].split(',').map(s => Number(s.trim()));
    const formTerms = [...cfg.matchAll(/<option value="(\d+)"[^>]*>\d+ months?/g)].map(m => Number(m[1]));
    assert.deepEqual(terms, formTerms, 'terms whitelist matches the request form options');
  });
});

describe('C3 — tasks: an assignee cannot approve, score, stamp completion or reassign', () => {
  const tasks = block(FS, 'match /tasks/{taskId}');
  const tjs = read('js/screens/tasks.js');

  it('the employee status list is tasks.js EMP_STATUSES plus the Submit button\'s review', () => {
    const fn = tasks.match(/function taskEmpStatus\(s\) \{ return s in (\[[^\]]*\]); \}/);
    assert.ok(fn, 'taskEmpStatus() missing');
    const emp = quoted(tjs.match(/const EMP_STATUSES\s*=\s*(\[[^\]]*\])/)[1]);
    assert.deepEqual(sorted(quoted(fn[1])), sorted([...emp, 'review']));
    const done = quoted(tjs.match(/const DONE_STATUSES\s*=\s*(\[[^\]]*\])/)[1]);
    for (const s of [...done, 'returned', 'on-hold']) assert.ok(!quoted(fn[1]).includes(s), `${s} is not an employee status`);
  });

  it('update: ops tier, or an assignee whose change passes taskAssigneeUpdateOk()', () => {
    const upd = allow(tasks, 'update');
    assert.match(upd, /isOpsAdmin\(\)\s*\|\|\s*\(\(request\.auth\.uid in resource\.data\.get\('assignedTo', \[\]\)\) && taskAssigneeUpdateOk\(\)\)/);
  });

  it('the assignee field allowlist excludes every approval / score / assignment field', () => {
    const fn = block(tasks, 'function taskAssigneeUpdateOk()');
    const keys = quoted(fn.match(/affectedKeys\(\)\.hasOnly\((\[[\s\S]*?\])\)/)[1]);
    assert.deepEqual(sorted(keys), sorted(['status', 'title', 'description', 'priority', 'dueDate', 'department',
      'currentStanding', 'submittedBy', 'submittedByName', 'submittedAt', 'followUps', 'openFollowUpCount', 'completedAt',
      'lastModifiedBy', 'lastModifiedByName', 'lastModifiedAt']));
    for (const f of ['assignedTo', 'assignedToNames', 'approvedBy', 'approvedAt', 'presidentScore', 'createdBy', 'sentBackAt', 'sentBackBy'])
      assert.ok(!keys.includes(f), `assignee may not change ${f}`);
    assert.match(fn, /taskEmpStatus\(request\.resource\.data\.status\)/);
    assert.match(fn, /!diff\.addedKeys\(\)\.hasAny\(\['completedAt'\]\)/, 'completedAt may be cleared, never stamped');
    assert.match(fn, /!diff\.changedKeys\(\)\.hasAny\(\['completedAt'\]\)/);
  });

  it('every non-admin create arm passes taskNonAdminCreateOk()', () => {
    const create = allow(tasks, 'create');
    const arms = create.split(/\|\|\s*\(/).slice(1);
    assert.equal(arms.length, 2, 'two non-admin create arms (Design dept, own/dept task)');
    for (const a of arms) assert.match(a, /taskNonAdminCreateOk\(\)/);
    const fn = block(tasks, 'function taskNonAdminCreateOk()');
    assert.match(fn, /taskEmpStatus\(d\.get\('status', 'backlog'\)\)/);
    assert.deepEqual(sorted(quoted(fn.match(/hasAny\((\[[^\]]*\])\)/)[1])), ['approvedAt', 'approvedBy', 'completedAt', 'presidentScore']);
  });

  it('the New Task form only offers non-admins the statuses the rule accepts', () => {
    const sel = tjs.slice(tjs.indexOf('<select id="t-status">'), tjs.indexOf('</select>', tjs.indexOf('<select id="t-status">')));
    assert.match(sel, /window\.isAdminPriv\s*&&\s*window\.isAdminPriv\(\)\s*\?\s*selectableTaskStatuses\(TASK_STATUSES\)\s*:\s*TASK_STATUSES\.filter\(s=>EMP_STATUSES\.includes\(s\.value\)\)/);
  });
});

describe('H1 — storage: Finance and HR files are not open to every staffer', () => {
  it('drive.js stamps uploadedBy on put() — the uploader exception depends on it', () => {
    assert.match(read('js/drive.js'), /ref\.put\(file, \{ customMetadata: \{ uploadedBy:/);
    const fn = block(ST, 'function isUploader()');
    assert.match(fn, /resource\.metadata\.uploadedBy == request\.auth\.uid/);
  });

  it('Finance/*: get is Finance tier, operational subfolders or own upload; list is Finance tier only', () => {
    const fin = block(ST, 'match /Finance/{subfolder}/{fileName}');
    assert.doesNotMatch(fin, /allow read:/, 'a bare read would grant list again');
    assert.match(allow(fin, 'get'), /\(isFinanceClaim\(\) \|\| financeOperationalSubfolder\(subfolder\) \|\| isUploader\(\)\)/);
    const list = allow(fin, 'list');
    assert.match(list, /isFinanceClaim\(\)/);
    assert.doesNotMatch(list, /hasRoleClaim\(\)|financeOperationalSubfolder|isUploader/);
  });

  it('HR is reserved out of the generic block and has its own members-only block', () => {
    assert.match(block(ST, 'function isReservedTop(seg)'), /seg == 'HR'/);
    const hr = block(ST, 'match /HR/{subfolder}/{fileName}');
    assert.doesNotMatch(hr, /allow read:/);
    assert.match(allow(hr, 'get'), /\(claimRole\(\) != 'secretary' && isMemberOf\('HR'\)\) \|\| isUploader\(\)/);
    const list = allow(hr, 'list');
    assert.match(list, /claimRole\(\) != 'secretary' && isMemberOf\('HR'\)/);
    assert.doesNotMatch(list, /isUploader/);
  });

  it('the generic department block no longer lets any staffer list a folder', () => {
    const gen = block(ST, 'match /{department}/{subfolder}/{fileName}');
    assert.doesNotMatch(gen, /allow read:/);
    const list = allow(gen, 'list');
    assert.match(list, /isMemberOf\(department\)/);
    assert.doesNotMatch(list, /hasRoleClaim\(\)/);
  });
});
