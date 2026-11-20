// firebase-config.js declares `const db = firebase.firestore()` at top level: a global BINDING every classic script can read,
// but NOT a window property — so `window.db` is undefined in the real app. The vm test harnesses put `db` on their context
// object (which is also `window` there), so a `window.db.collection(...)` passes every test and fails on the first real tap.
// This happened (F3 contract-ui, P5 payment-claims-ui, flow-docs, 2026-11-20; found by the Sales KPI session). Pin it shut:
// window.db may appear only as the FALLBACK of an accessor (`... || window.db`, `... : window.db`), never dereferenced.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
  });
}
const FILES = ['js', 'qb'].filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(path.join(ROOT, d)));

describe('nobody reads Firestore through window.db (it is undefined in the browser)', () => {
  it('no window.db.<x>, no `= window.db;`, no window.db passed as a value', () => {
    const bad = [];
    for (const f of FILES) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (/window\.db\s*\./.test(code) || /=\s*window\.db\s*;/.test(code) || /\(\s*window\.db\s*[,)]/.test(code)) bad.push(path.relative(ROOT, f) + ':' + (i + 1) + '  ' + line.trim());
      });
    }
    assert.deepEqual(bad, [], 'use the bare global `db` (or an accessor: (typeof db !== "undefined" && db) || window.db):\n' + bad.join('\n'));
  });
  it('the three Sales-flow screen files use the accessor', () => {
    for (const f of ['js/contract-ui.js', 'js/payment-claims-ui.js', 'js/screens/flow-docs.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.match(src, /const fsDb = function \(\) \{ return \(typeof db !== 'undefined' && db\) \|\| window\.db; \};/, f);
      assert.ok((src.match(/fsDb\(\)/g) || []).length >= 4, f + ' reads through fsDb()');
    }
  });
});
