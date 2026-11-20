// Owner 2026-11-20: every won job marks its client card Won, whichever screen created it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../js/screens/production.js', import.meta.url), 'utf8');
const start = src.indexOf('async function createJobProject(d)');
const end = src.indexOf('\nwindow.renderProjectLifecycle', start);
const fn = src.slice(start, end);
test('createJobProject marks the client Won after adding the job', () => {
  assert.ok(start > 0 && end > start, 'createJobProject found');
  const add = fn.indexOf("collection('job_projects').add(");
  const won = fn.indexOf("collection('clients').doc(cid).update({ stage:'won'");
  assert.ok(add > 0, 'job add present');
  assert.ok(won > add, 'client is marked won after the job is created');
  assert.match(fn, /let cid = d\.clientId \|\| null;/);
  assert.match(fn, /Clients\.findByName\(d\.client\)/);
});
test('marking Won is best-effort and never blocks the job', () => {
  const won = fn.indexOf("stage:'won', updatedAt");
  const tryAt = fn.lastIndexOf('try {', won);
  const catchAt = fn.indexOf('catch(_)', won);
  const ret = fn.indexOf('return { id:ref.id, projectNo };');
  assert.ok(tryAt > 0 && catchAt > won && ret > catchAt, 'wrapped in try/catch before the return');
});
