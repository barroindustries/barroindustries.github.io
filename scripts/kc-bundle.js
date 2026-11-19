#!/usr/bin/env node
/* scripts/kc-bundle.js: builds qb/kc.min.js, the Barro Kitchens configurator engine, from its private sources.
   (specs/BK-LIVE-INTEGRATION-ADDENDUM-1-2026-11-19.md A9: the build logic of the configurators stays out of the public repository.)

   WHY: this repository is public and GitHub Pages serves every tracked file.  The engine sources (the 12 files below: sizes, quantities, build rules, drawings) live in
   private/kc-src/ at the root of the MAIN checkout (git-ignored, OneDrive-backed).  Only the bundle this script makes is committed: ONE minified file, no comments.
   qb/kc-rules.js (the money and approval rules) and the qb/d7 bridge stay readable and tracked.

   USE
     node scripts/kc-bundle.js                       build qb/kc.min.js from the sources
     node scripts/kc-bundle.js --check               build to memory and compare with qb/kc.min.js: exit 1 when the bundle is stale (needs the sources)
     node scripts/kc-bundle.js --src DIR --out FILE  other places (the mutation tests build in a scratch copy)
   The sources are looked for at, in order: --src, $KC_SRC, <git toplevel>/private/kc-src, then the main checkout (git rev-parse --git-common-dir)/../private/kc-src, which is
   where a linked worktree finds them.
   The minifier is esbuild@0.24.0, run through npx:  npx --yes esbuild@0.24.0 --minify --legal-comments=none   (the first run needs the network).  $KC_ESBUILD may name an
   esbuild 0.24.0 binary to run instead of npx (the same flags): the mutation harness uses it so each mutant does not start npx again.

   THE ORDER is the page loader order of the engine files (spec 4.2).  The files are classic scripts that each wrap themselves in an IIFE and talk through window.KC, so they are
   joined in that order, one statement apart, and minified as one script. */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DEFAULT = path.join(ROOT, 'qb', 'kc.min.js');
const ORDER = ['core.js', 'materials.js', 'library.js', 'draw-table.js', 'product-table.js', 'product-sink.js', 'product-hood.js', 'product-duct.js',
  'product-storage.js', 'product-cart.js', 'draw-chef.js', 'product-chef.js'];
const ESBUILD_ARGS = ['--minify', '--legal-comments=none'];

function git(args) {
  try { return cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return ''; }
}

/** the folder that holds the sources, or null */
function findSources(explicit) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  if (process.env.KC_SRC) candidates.push(path.resolve(process.env.KC_SRC));
  const top = git(['rev-parse', '--show-toplevel']);
  if (top) candidates.push(path.join(top, 'private', 'kc-src'));
  const common = git(['rev-parse', '--git-common-dir']);
  if (common) candidates.push(path.resolve(ROOT, common, '..', 'private', 'kc-src'));
  return candidates.find(d => fs.existsSync(path.join(d, ORDER[0]))) || null;
}

/** the twelve sources, in the loader order, as one script */
function concatSources(srcDir) {
  return ORDER.map(f => {
    const p = path.join(srcDir, f);
    if (!fs.existsSync(p)) throw new Error('kc-bundle: missing source ' + p);
    return fs.readFileSync(p, 'utf8');
  }).join('\n;\n');
}

/** minify one script with esbuild 0.24.0 (no comments, no legal comments) */
function minify(input) {
  const bin = process.env.KC_ESBUILD;
  const [cmd, args] = bin ? [bin, ESBUILD_ARGS] : ['npx', ['--yes', 'esbuild@0.24.0'].concat(ESBUILD_ARGS)];
  return cp.execFileSync(cmd, args, { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** the bundle text for a sources folder */
function bundleText(srcDir) { return minify(concatSources(srcDir)); }

function main(argv) {
  const opt = { check: false, src: null, out: OUT_DEFAULT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') opt.check = true;
    else if (argv[i] === '--src') opt.src = argv[++i];
    else if (argv[i] === '--out') opt.out = path.resolve(argv[++i]);
    else { console.error('kc-bundle: unknown argument ' + argv[i]); return 2; }
  }
  const src = findSources(opt.src);
  if (!src) { console.error('kc-bundle: the engine sources were not found (private/kc-src in the main checkout; or pass --src DIR).'); return 2; }
  const text = bundleText(src);
  if (opt.check) {
    const have = fs.existsSync(opt.out) ? fs.readFileSync(opt.out, 'utf8') : null;
    if (have === text) { console.log('kc-bundle: ' + path.relative(ROOT, opt.out) + ' is current (' + text.length + ' bytes, from ' + src + ')'); return 0; }
    console.error('kc-bundle: ' + path.relative(ROOT, opt.out) + ' is STALE: run  node scripts/kc-bundle.js  and commit the result.');
    return 1;
  }
  fs.mkdirSync(path.dirname(opt.out), { recursive: true });
  fs.writeFileSync(opt.out, text);
  console.log('kc-bundle: wrote ' + path.relative(ROOT, opt.out) + ' (' + text.length + ' bytes) from ' + src);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { ORDER, ROOT, OUT_DEFAULT, findSources, concatSources, minify, bundleText };
