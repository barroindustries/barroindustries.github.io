// Client contact placeholders (2026-11-20): ~120 live clients carry "N/A" ("N/a", "000") in company / email / phone /
// address, and the client card + client profile showed them as real details. window.realContact() reads a
// placeholder as blank; display only — the stored values are untouched. Runs the REAL helper from js/departments.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, sliceOf } from './fixtures/sales-flow-harness.mjs';

const DEPTS = read('js/departments.js');
const HELPER = sliceOf(DEPTS, 'window.realContact = function', 'function crmStageOf(cl){');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(HELPER, ctx);
const { realContact } = ctx.window;

describe('realContact', () => {
  it('reads the placeholders found in the live client book as blank', () => {
    for (const v of ['N/A', 'N/a', 'n/a', 'NA', 'na', '000', '0', 'None', 'nil', '-', '---', '.', '  N/A  ', '', null, undefined]) {
      assert.equal(realContact(v), '', JSON.stringify(v));
    }
  });
  it('keeps real values (trimmed), including short ones', () => {
    assert.equal(realContact('MPDC'), 'MPDC');
    assert.equal(realContact(' juan@example.com '), 'juan@example.com');
    assert.equal(realContact('0917 123 4567'), '0917 123 4567');
    assert.equal(realContact('Naga City'), 'Naga City');
    assert.equal(realContact('NAIA Terminal 3'), 'NAIA Terminal 3');
  });
});

describe('the client card and client profile use it', () => {
  it('every company / email / phone / address chip goes through realContact', () => {
    for (const f of ['company', 'email', 'phone', 'address']) {
      assert.ok(!new RegExp('\\$\\{cl\\.' + f + '\\?`<span').test(DEPTS), f + ' chip still tests the raw value');
    }
    assert.equal((DEPTS.match(/window\.realContact\(cl\.(company|email|phone|address)\)\?`<span/g) || []).length, 7);
  });
});
