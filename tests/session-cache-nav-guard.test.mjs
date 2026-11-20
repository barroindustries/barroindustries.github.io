// 2026-11-20 system review, items D1 + D2:
//  D1 — the in-memory read cache outlived the session: Sign Out does not reload, so the next user of the tab
//       was served the previous user's cached reads ('users' with payroll, 'ca-pending', ledger…). And a read
//       still in flight when the cache was cleared wrote its result back afterwards.
//  D2 — a slow role dashboard painted over the page the user had already navigated to.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CONFIG = read('js/config.js');
const APP = read('js/app.js');
const DASH = read('js/screens/dashboards.js');

// The cache IIFE from config.js, run against a fake window.
function loadCache() {
  const start = CONFIG.indexOf('// ── Firestore In-Memory Cache');
  const iife = CONFIG.indexOf(';(function() {', start);
  const end = CONFIG.indexOf('\n})();', iife) + '\n})();'.length;
  assert.ok(start > 0 && iife > start && end > iife, 'cache block not found in js/config.js');
  const window = {};
  new Function('window', CONFIG.slice(iife, end))(window);
  return window;
}
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

describe('D1 · the read cache never carries one session\'s data into the next', () => {
  it('caches normally (one fetch for two reads inside the TTL)', async () => {
    const w = loadCache(); let n = 0;
    const f = async () => ({ v: ++n });
    assert.deepEqual(await w.dbCachedGet('k', f, 60000), { v: 1 });
    assert.deepEqual(await w.dbCachedGet('k', f, 60000), { v: 1 });
    assert.equal(n, 1);
  });

  it('a read in flight when the WHOLE cache is cleared (sign-out) answers its caller but is not cached', async () => {
    const w = loadCache(); const d = deferred(); let n = 0;
    const first = w.dbCachedGet('users', () => { n++; return d.p; }, 60000);
    w.dbCacheInvalidate();                    // sign-out while the President's read is still running
    d.resolve({ salaries: 'president-only' });
    assert.deepEqual(await first, { salaries: 'president-only' });
    const next = await w.dbCachedGet('users', async () => { n++; return { salaries: 'next user' }; }, 60000);
    assert.deepEqual(next, { salaries: 'next user' }, 'the next user was served the previous user\'s read');
    assert.equal(n, 2);
  });

  it('a read in flight when ITS key is invalidated (a write) does not re-cache the pre-write snapshot', async () => {
    const w = loadCache(); const d = deferred();
    const first = w.dbCachedGet('tasks-all', () => d.p, 60000);
    w.dbCacheInvalidate('tasks-all');
    d.resolve(['old']);
    await first;
    assert.deepEqual(await w.dbCachedGet('tasks-all', async () => ['old', 'new'], 60000), ['old', 'new']);
  });

  it('a voided read never leaves a stuck pending entry, and a voided failure is not negative-cached', async () => {
    const w = loadCache(); const d = deferred();
    const first = w.dbCachedGet('k', () => d.p, 60000);
    w.dbCacheInvalidate();
    d.reject(new Error('network'));
    await assert.rejects(first, /network/);
    assert.equal(await w.dbCachedGet('k', async () => 'fresh', 60000), 'fresh');
  });

  it('the sign-out branch of onAuthStateChanged clears the cache and voids pending renders', () => {
    const i = APP.indexOf('_bootstrappedUid = null;\n      // Session boundary');
    assert.ok(i > 0, 'session-boundary block not found');
    const branch = APP.slice(i, APP.indexOf('showSignedOut();', i));
    assert.match(branch, /window\.dbCacheInvalidate\(\)/);
    assert.match(branch, /window\._navSeq = \(window\._navSeq \|\| 0\) \+ 1/);
  });
});

describe('D2 · a dashboard still loading never paints over the page the user moved to', () => {
  it('navToken / navStale: a token goes stale on the next navigation', () => {
    const block = APP.slice(APP.indexOf('window._navSeq = window._navSeq || 0;'), APP.indexOf('async function navigateTo('));
    const window = {};
    new Function('window', block)(window);
    const t = window.navToken();
    assert.equal(window.navStale(t), false);
    window._navSeq++;
    assert.equal(window.navStale(t), true);
  });

  it('navigateTo bumps the token when it switches page', () => {
    const fn = APP.slice(APP.indexOf('async function navigateTo('));
    const set = fn.indexOf('window.currentPage = page;');
    assert.ok(set > 0 && /^\s*window\._navSeq\+\+;/.test(fn.slice(set + 'window.currentPage = page;'.length)), 'navigateTo must bump _navSeq right after setting currentPage');
  });

  for (const name of ['renderPresidentDashboard', 'renderManagerDashboard', 'renderSecretaryDashboard', 'renderFinanceDashboard', 'renderEmployeeDashboard']) {
    it(`${name}: takes a token before its reads and checks it before every paint that follows them`, () => {
      const i = DASH.indexOf(`async function ${name}() {`);
      assert.ok(i > 0);
      const body = DASH.slice(i, DASH.indexOf('\nasync function ', i + 10));
      const tok = body.indexOf('const _nav = window.navToken');
      const firstAwait = body.indexOf('await ');
      assert.ok(tok > 0 && tok < firstAwait, 'token must be taken before the first await');
      const paint = body.indexOf('\n    c.innerHTML = `');
      const before = body.slice(firstAwait, paint);
      assert.match(before.slice(before.lastIndexOf('\n', before.length - 2)), /navStale\(_nav\)\) return;/, 'the main paint is not guarded');
      const c = body.indexOf('} catch(err) {');
      assert.match(body.slice(c, body.indexOf('innerHTML', c)), /navStale\(_nav\)\) return;/, 'the error paint is not guarded');
    });
  }

  it('dashboard error messages are escaped', () => {
    assert.ok(!/<h4>\$\{err\.message\}|<p[^>]*>\$\{err\.message\}/.test(DASH));
  });
});
