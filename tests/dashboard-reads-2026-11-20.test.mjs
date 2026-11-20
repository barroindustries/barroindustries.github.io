// tests/dashboard-reads-2026-11-20.test.mjs — dashboard read cost (2026-11-20 system review, item 14).
//   - President / Manager / Secretary dashboards read the WHOLE submissions collection to count the pending ones;
//     they now share the Approvals page's pending-only query (and cache key).
//   - the calendar feed read the whole gov_archive (won / closed bids) only to skip every doc; it no longer reads it.
//   - Projects.listAll read job_projects and projects one after the other; now in parallel.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const DASH = read('js/screens/dashboards.js');
const fnBody = (name) => { const i = DASH.indexOf(`async function ${name}(`); assert.ok(i > 0, name); return DASH.slice(i, DASH.indexOf('\nasync function ', i + 10)); };
const PENDING = "dbCachedGet('approvals-pending:submissions-pending', () => db.collection('submissions').where('status','==','pending').get(), 30000)";

describe('dashboard reads', () => {
  for (const name of ['renderPresidentDashboard', 'renderManagerDashboard', 'renderSecretaryDashboard']) {
    it(`${name}: pending submissions only, on the Approvals page's cache key`, () => {
      const b = fnBody(name);
      assert.ok(b.includes(PENDING), 'not the pending-only query');
      assert.doesNotMatch(b, /db\.collection\('submissions'\)\.get\(\)/, 'the whole submissions collection is read again');
    });
  }
  it('the Approvals page uses that same query and key', () => assert.ok(read('js/screens/approvals.js').includes("dbCachedGet('approvals-pending:submissions-pending', () => db.collection('submissions').where('status','==','pending').get()")));
  it('the calendar feed never reads gov_archive', () => {
    const cal = read('js/calendar-feed.js').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(cal, /collection\('gov_archive'\)/);
    assert.match(cal, /collection\('gov_philgeps'\)/);
    assert.match(cal, /collection\('gov_active_bids'\)/);
  });
  it('Projects.listAll reads its two collections in parallel', () => {
    assert.match(read('js/departments.js'), /const \[jobSnap, desSnap\] = await Promise\.all\(\[\s*db\.collection\('job_projects'\)\.get\(\)[^\n]*\n\s*db\.collection\('projects'\)\.get\(\)/);
  });
});
