#!/usr/bin/env node
// IndexNow ping (2026-10-29 SEO sweep): tells Bing, Yandex, Seznam and Naver that
// public pages changed, so they recrawl within minutes instead of weeks. Google
// does not use IndexNow; Search Console + sitemap.xml cover Google.
//
// Ownership is proven by the key file at the site root (/<KEY>.txt containing the
// key) — never delete or rename it, and keep KEY below in step with it.
//
// Usage:
//   node scripts/indexnow.js                 every URL in sitemap.xml
//   node scripts/indexnow.js --changed A B   only the sitemap URLs whose source
//                                            files changed between commits A and B
//   add --dry-run to print the payload without sending it.
// Run by .github/workflows/indexnow.yml after each successful Pages deploy.

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HOST = 'barroindustries.com';
const KEY = '56a23bfe1bfdd002453891cc782415f3';
const ROOT = path.join(__dirname, '..');

function sitemapUrls() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
}

// A sitemap URL's source file: "/" → index.html, "/faq/" → faq/index.html.
function fileFor(url) {
  const p = new URL(url).pathname;
  return (p.endsWith('/') ? p + 'index.html' : p).replace(/^\//, '');
}

// Files every public page inlines or loads: a change to one touches them all.
const SHARED = ['sitemap.xml', 'css/site.css', 'css/pages.css', 'css/guides.css', 'js/site.js', 'js/late-fonts.js'];

function changedUrls(from, to) {
  const out = execFileSync('git', ['diff', '--name-only', from, to], { cwd: ROOT, encoding: 'utf8' });
  const changed = new Set(out.split('\n').filter(Boolean));
  const urls = sitemapUrls();
  if (SHARED.some(f => changed.has(f))) return urls;
  return urls.filter(u => changed.has(fileFor(u)));
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const i = args.indexOf('--changed');
  const urls = i >= 0 ? changedUrls(args[i + 1], args[i + 2]) : sitemapUrls();
  if (!urls.length) { console.log('IndexNow: no public page changed — nothing to send.'); return; }

  const body = { host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls };
  console.log(`IndexNow: ${urls.length} URL(s)\n  ` + urls.join('\n  '));
  if (dry) return;

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  // 200 = accepted, 202 = accepted while the key is being validated.
  console.log(`IndexNow: HTTP ${res.status} ${res.statusText}`);
  if (res.status !== 200 && res.status !== 202) {
    console.log(await res.text());
    process.exit(1);
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { sitemapUrls, fileFor, changedUrls, KEY };
