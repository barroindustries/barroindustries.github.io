// tests/kc-bundle.test.mjs: the committed engine bundle qb/kc.min.js against its private sources (Addendum 1 A9).
//
// The configurator build logic is not allowed in the public repository, so the engine sources live in private/kc-src (git-ignored, in the MAIN checkout) and only the minified
// bundle that scripts/kc-bundle.js makes from them is committed. CI never sees the sources, so every other test loads the bundle.
//
// WHAT IT PINS
//   1. THE STALE-BUNDLE GUARD (local only)  where the sources are present, re-bundling them gives a byte-identical qb/kc.min.js. Someone who edits a source and forgets to run
//                  `node scripts/kc-bundle.js` is told here, before a commit ships a bundle that no longer matches. SKIPPED when the sources are absent (CI) or when esbuild cannot be
//                  run (it is fetched with npx the first time: offline, the check cannot run).
//   2. THE BUNDLER  the file order is the page loader order of the engine files (spec 4.2); the sources are looked for in the main checkout when the tree is a linked worktree; the
//                  command it runs is the one the addendum names.
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('../scripts/kc-bundle.js');

describe('the bundler', () => {
  it('joins the twelve engine files in the page loader order', () => {
    assert.deepEqual(B.ORDER, ['core.js', 'materials.js', 'library.js', 'draw-table.js', 'product-table.js', 'product-sink.js', 'product-hood.js', 'product-duct.js',
      'product-storage.js', 'product-cart.js', 'draw-chef.js', 'product-chef.js']);
  });
  it('finds sources given explicitly, and says nothing is found rather than guessing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-src-'));
    try {
      assert.equal(B.findSources(path.join(dir, 'nowhere')) === path.join(dir, 'nowhere'), false);
      fs.writeFileSync(path.join(dir, B.ORDER[0]), '// a source\n');
      assert.equal(B.findSources(dir), dir);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('joins the files in order, one statement apart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-src-'));
    try {
      B.ORDER.forEach((f, i) => fs.writeFileSync(path.join(dir, f), `(function(){ window.order = (window.order || '') + ${i}; })();`));
      const text = B.concatSources(dir);
      const at = B.ORDER.map((f, i) => text.indexOf(`+ ${i};`));
      assert.deepEqual(at, [...at].sort((a, b) => a - b), 'in order');
      assert.ok(at.every(n => n > 0));
      assert.ok(text.split('\n;\n').length === B.ORDER.length, 'one statement apart');
      fs.rmSync(path.join(dir, B.ORDER[5]));
      assert.throws(() => B.concatSources(dir), /missing source/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the stale-bundle guard (local: it needs the private sources)', () => {
  const src = B.findSources();
  it('re-bundling the private sources gives a byte-identical qb/kc.min.js', { skip: src ? false : 'the private engine sources are not here (CI): the guard runs only where they are' }, (t) => {
    let fresh;
    try { fresh = B.bundleText(src); } catch (e) { t.skip('esbuild@0.24.0 could not be run here (offline?): ' + String(e.message).split('\n')[0]); return; }
    const have = fs.readFileSync(B.OUT_DEFAULT, 'utf8');
    assert.equal(fresh === have, true, 'qb/kc.min.js is STALE: it no longer matches private/kc-src. Run  node scripts/kc-bundle.js  and commit the result.');
  });
});
