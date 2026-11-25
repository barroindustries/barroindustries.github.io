// tests/sales-won-per-person.test.mjs — js/screens/sales.js: the "Sales won per person" panel on the Sales → Won tab
// (owner, 2026-11-25). salesWonByPerson is lifted out of the file's own source by name (top-level function, closing brace
// in column 0) and run in a node:vm context. Fixtures are FAKE (invented names and odd pesos): the repository is public.
//
// Pinned: grouping by the quote's salesperson (then agentName, then createdByName), first-word case-insensitive folding,
// "Not recorded" for a job without a readable quote (always last), cancelled jobs never counted, the Manila-time
// month / year / all periods, and balance never going negative.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/screens/sales.js'), 'utf8');
const m = SRC.match(/^function salesWonByPerson\([\s\S]*?\n\}/m);
assert.ok(m, 'salesWonByPerson not found in js/screens/sales.js');
const ctx = vm.createContext({});
vm.runInContext(m[0] + '\nthis.salesWonByPerson = salesWonByPerson;', ctx);
const run = (...a) => JSON.parse(JSON.stringify(ctx.salesWonByPerson(...a)));

const NOW = new Date('2026-11-25T03:00:00Z');   // Nov 25, 11 AM Manila
const quotes = {
  q1: { salesperson: 'Ana Reyes' },
  q2: { salesperson: 'ANA' },
  q3: { agentName: 'Ben Cruz' },
  q4: { createdByName: 'Cora Dela Paz' },
  q5: { salesperson: '  ', agentName: 'Ben' },
};
const P = (id, quoteId, contract, collected, createdAt, stage = 'won') => ({ id, quoteId, contractAmount: contract, amountCollected: collected, createdAt, stage });
const projects = [
  P('a', 'q1', 101_111, 50_001, '2026-11-03T02:00:00Z'),
  P('b', 'q2', 20_222, 20_222, '2026-10-30T20:00:00Z'),      // Oct 31 Manila → this year, not this month
  P('c', 'q3', 33_333, 40_000, '2026-11-10T00:00:00Z'),      // over-collected → balance 0, not negative
  P('d', 'q4', 44_444, 0, '2025-12-15T00:00:00Z'),            // last year
  P('e', 'missing', 55_555, 5_555, '2026-11-01T00:00:00Z'),   // quote not readable → Not recorded
  P('f', 'q5', 66_666, 6_666, '2026-11-20T00:00:00Z'),        // blank salesperson falls back to agentName "Ben"
  P('g', 'q1', 999_999, 0, '2026-11-21T00:00:00Z', 'cancelled'),
  P('h', null, 7_777, 7_777, '2026-11-02T00:00:00Z'),         // no quote, no creator → Not recorded
  { ...P('i', null, 88_888, 8_888, '2026-11-05T00:00:00Z'), createdByName: 'ana' },   // entered straight into Projects → credited to its creator
  { ...P('j', null, 9_999, 0, '2026-11-06T00:00:00Z'), createdByName: 'Ana Reyes', salesperson: 'Ben' },   // a job's own salesperson beats its creator
];

describe('salesWonByPerson', () => {
  it('this year: groups by first name, folds case, longest spelling wins, cancelled left out, Not recorded last', () => {
    const r = run(projects, quotes, 'year', NOW);
    assert.deepEqual(r.map(x => [x.name, x.jobs, x.contract, x.collected, x.balance]), [
      ['Ana Reyes', 3, 210_221, 79_111, 131_110],
      ['Ben Cruz', 3, 109_998, 46_666, 69_999],
      ['Not recorded', 2, 63_332, 13_332, 50_000],
    ]);
  });
  it('this month uses Manila time: an Oct 31 (Manila) job is not in November', () => {
    const r = run(projects, quotes, 'month', NOW);
    const ana = r.find(x => x.name === 'Ana Reyes');
    assert.equal(ana.jobs, 2);
    assert.equal(ana.contract, 101_111 + 88_888);
  });
  it('all time includes last year', () => {
    const r = run(projects, quotes, 'all', NOW);
    assert.ok(r.find(x => x.name === 'Cora Dela Paz' && x.jobs === 1 && x.balance === 44_444));
  });
  it('a cancelled job never counts, even in all time', () => {
    const r = run(projects, quotes, 'all', NOW);
    assert.equal(r.reduce((s, x) => s + x.contract, 0), 101_111 + 20_222 + 33_333 + 44_444 + 55_555 + 66_666 + 7_777 + 88_888 + 9_999);
  });
  it('empty input gives no rows', () => {
    assert.deepEqual(run([], {}, 'year', NOW), []);
  });
});
