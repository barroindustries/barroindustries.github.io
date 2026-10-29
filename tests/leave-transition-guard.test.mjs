// Pins the leave status-transition guards (people.js): a rejected request can't
// be approved (would debit balance) and an approved one can't be rejected
// (would leave the balance deducted). Screen-local handlers must delegate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/screens/people.js', import.meta.url), 'utf8');
const body = (name, next) => {
  const a = src.indexOf(name); assert.ok(a > -1, name);
  const b = src.indexOf(next, a + name.length); assert.ok(b > a, next);
  return src.slice(a, b);
};

test('approveLeaveRequest: idempotent on approved, throws unless pending', () => {
  const fn = body('window.approveLeaveRequest = async', 'window.rejectLeaveRequest');
  assert.match(fn, /status==='approved'\) return r/);
  assert.match(fn, /status!=='pending'\) throw new Error\('Leave request already '\+r\.status\)/);
  assert.ok(fn.indexOf("status!=='pending'") < fn.indexOf('applyLeaveApproval(r)'));
});

test('rejectLeaveRequest: throws unless pending, before any write', () => {
  const fn = body('window.rejectLeaveRequest = async', '\n})();');
  const g = fn.indexOf("status!=='pending'");
  assert.ok(g > -1 && g < fn.indexOf('.update('));
  assert.match(fn, /throw new Error\('Leave request already '\+r\.status\)/);
});

test('screen-local approve/reject delegate to the fresh-read functions', () => {
  const a = body('async function approveLeave(', 'async function rejectLeave(');
  assert.match(a, /window\.approveLeaveRequest\(r\.id\)/);
  assert.doesNotMatch(a, /applyLeaveApproval|\.update\(/);
  const r = body('async function rejectLeave(', '// Exposed so');
  assert.match(r, /window\.rejectLeaveRequest\(r\.id, reason\)/);
  assert.doesNotMatch(r, /\.update\(/);
  assert.match(a + r, /dbCacheInvalidate\('approvals-pending:leave_requests-pending'\)/);
});
