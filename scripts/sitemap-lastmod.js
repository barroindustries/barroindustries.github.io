#!/usr/bin/env node
// Keeps every <lastmod> in sitemap.xml equal to the date its page's source file last changed (2026-10-29 SEO sweep;
// the audit found pages edited on 10-28 still dated 10-22, which teaches search engines to ignore lastmod).
// A page's date is its last commit date, or today when the file has uncommitted changes. Run it just before
// committing page changes (after scripts/inline-page-css.js, which rewrites the pages too).
//
//   node scripts/sitemap-lastmod.js          rewrite sitemap.xml in place
//   node scripts/sitemap-lastmod.js --check  exit 1 (and list them) if any date is stale

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { fileFor } = require('./indexnow');

const ROOT = path.join(__dirname, '..');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

function today() {
  // Philippine date, like the rest of the site.
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

function dateOf(file) {
  if (git('status', '--porcelain', '--', file)) return today();
  return git('log', '-1', '--format=%cs', '--', file) || today();
}

function main() {
  const check = process.argv.includes('--check');
  const xml = fs.readFileSync(SITEMAP, 'utf8');
  const stale = [];
  const out = xml.replace(/<loc>([^<]+)<\/loc>(\s*)<lastmod>([^<]*)<\/lastmod>/g, (m, loc, ws, old) => {
    const want = dateOf(fileFor(loc.trim()));
    if (want !== old) stale.push(`${loc}: ${old} -> ${want}`);
    return `<loc>${loc}</loc>${ws}<lastmod>${want}</lastmod>`;
  });
  if (stale.length) console.log(stale.join('\n'));
  if (check) process.exit(stale.length ? 1 : 0);
  if (out !== xml) fs.writeFileSync(SITEMAP, out);
  console.log(`sitemap.xml: ${stale.length} lastmod date(s) updated`);
}

main();
