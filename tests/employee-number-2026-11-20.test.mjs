// Employee numbers (2026-11-20, owner "Yes, fix it"): the _counters/employees count fell behind numbers already in use
// (count 7 while BI-2026-009 and -010 existed) and createStaffAccount re-issued BI-2026-008 to a third person.
// staff-core.nextEmployeeNumber takes one past the HIGHER of the counter and the highest BI-YYYY-NNN in use, and both
// allocation paths in functions/index.js (Invite / createStaffAccount and createUserDocOnAuthCreate path B) use it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { nextEmployeeNumber } = require(path.join(ROOT, 'functions/staff-core.js'));
const INDEX = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');

describe('nextEmployeeNumber', () => {
  it('never re-issues a number already in use when the counter is behind (the 2026-11-20 case)', () => {
    const inUse = ['BI-2026-001', 'BI-2026-008', 'BI-2026-009', 'BI-2026-010', '', null];
    assert.deepEqual({ ...nextEmployeeNumber(7, inUse, '2026') }, { next: 11, employeeId: 'BI-2026-011' });
  });
  it('follows the counter when it is ahead of every number in use', () => {
    assert.equal(nextEmployeeNumber(12, ['BI-2026-011', 'BI-2026-012'], '2026').employeeId, 'BI-2026-013');
    assert.equal(nextEmployeeNumber(20, ['BI-2026-003'], '2026').next, 21);
  });
  it('counts numbers from any year (one sequence), and ignores anything not in the BI-YYYY-NNN form', () => {
    assert.equal(nextEmployeeNumber(0, ['BI-2025-015', 'X-2026-099', 'BI-2026-abc', ' BI-2026-004 '], '2026').employeeId, 'BI-2026-016');
  });
  it('starts at 001 with no counter and nobody numbered, and survives junk input', () => {
    assert.equal(nextEmployeeNumber(undefined, [], '2026').employeeId, 'BI-2026-001');
    assert.equal(nextEmployeeNumber('x', undefined, '2026').employeeId, 'BI-2026-001');
    assert.equal(nextEmployeeNumber(-5, null, 2027).employeeId, 'BI-2027-001');
  });
  it('pads to three digits and keeps growing past 999', () => {
    assert.equal(nextEmployeeNumber(98, [], '2026').employeeId, 'BI-2026-099');
    assert.equal(nextEmployeeNumber(999, [], '2026').employeeId, 'BI-2026-1000');
  });
});

describe('both allocation paths use it', () => {
  it('no raw "count + 1" employee allocation is left in functions/index.js', () => {
    assert.ok(!/const next = \((?:c|counter)\.exists \? (?:c|counter)\.data\(\)\.count : 0\) \+ 1;/.test(INDEX));
    assert.equal((INDEX.match(/staff\.nextEmployeeNumber\(/g) || []).length, 2);
    assert.equal((INDEX.match(/t\.get\(db\.collection\('users'\)\.select\('employeeId'\)\)/g) || []).length, 2);
  });
});
