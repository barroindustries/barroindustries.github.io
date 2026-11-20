#!/usr/bin/env node
/* Build the PUBLIC copy of the site that GitHub Pages serves (owner, 2026-11-20).
 *
 * Until now Pages published the whole master branch as-is, so barroindustries.com/STATUS.md, /docs/reviews/*,
 * /firestore.rules, /functions/index.js, /scripts/release.sh and the agent notes were all one URL away. The
 * deploy workflow (.github/workflows/pages.yml) now runs this script and uploads ONLY its output.
 *
 *   node scripts/build-public-site.js [outDir=_site]
 *
 * It copies every TRACKED file (git ls-files, so untracked or ignored files can never ship) except the
 * internal ones in DENY. The app, the website, the quote builder, the client portals (/q /t /v /sales
 * /projects), the PDFs and the SEO files all stay. tests/public-site-build.test.mjs pins both directions:
 * nothing internal ships, and every file the service worker precaches or the sitemap lists still does.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Internal: never published. A directory entry ends with '/'.
const DENY = [
  // agent / owner notes and plans
  'STATUS.md', 'ROADMAP.md', 'CLAUDE.md', 'AGENTS.md', 'ARCHITECTURE.md',
  'Barro Industries - BI Ops Company Info.html',
  'docs/', 'specs/', 'fable-workplan/', 'archive/', 'data/', 'private/', 'dev/',
  // backend source and deploy config (rules are enforced server-side; the source need not be public)
  'firestore.rules', 'storage.rules', 'firestore.indexes.json', 'firebase.json', '.firebaserc',
  'functions/', 'scripts/', 'tests/',
  // tooling
  '.github/', '.githooks/', '.claude/', '.gitignore', '.deploy-state',
];
// Any Markdown file anywhere is a note, not a page (the site serves none).
const DENY_EXT = ['.md'];

function isDenied(rel) {
  if (DENY_EXT.includes(path.extname(rel).toLowerCase())) return true;
  return DENY.some((d) => (d.endsWith('/') ? rel.startsWith(d) : rel === d));
}

function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

function build(root, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const shipped = [];
  for (const rel of trackedFiles(root)) {
    if (isDenied(rel)) continue;
    const src = path.join(root, rel);
    let st;
    try { st = fs.lstatSync(src); } catch { continue; }   // tracked but deleted in the working tree
    if (!st.isFile()) continue;                           // no symlinks / submodules
    const dst = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    shipped.push(rel);
  }
  // Pages must not run Jekyll over the artifact either.
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
  return shipped;
}

module.exports = { DENY, DENY_EXT, isDenied, build };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const outDir = path.resolve(root, process.argv[2] || '_site');
  const shipped = build(root, outDir);
  console.log(`public site: ${shipped.length} files -> ${path.relative(root, outDir) || outDir}`);
}
