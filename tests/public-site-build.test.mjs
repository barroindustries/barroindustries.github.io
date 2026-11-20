// The public copy GitHub Pages serves (scripts/build-public-site.js, owner 2026-11-20).
// Pins both directions: nothing internal ships, and nothing the site or the app needs is dropped.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = require(path.join(ROOT, 'scripts/build-public-site.js'));

describe('public site build: only the public site is published', () => {
  let out, shipped;
  before(() => { out = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-site-')); shipped = new Set(B.build(ROOT, out)); });
  after(() => fs.rmSync(out, { recursive: true, force: true }));

  it('never ships the internal notes, reviews, rules, backend, scripts, tests or tooling', () => {
    for (const p of ['STATUS.md', 'ROADMAP.md', 'CLAUDE.md', 'AGENTS.md', 'ARCHITECTURE.md', 'Barro Industries - BI Ops Company Info.html',
      'firestore.rules', 'storage.rules', 'firestore.indexes.json', 'firebase.json', '.firebaserc', '.gitignore']) {
      assert.ok(!fs.existsSync(path.join(out, p)), `${p} would be published`);
    }
    for (const d of ['docs', 'specs', 'fable-workplan', 'archive', 'data', 'private', 'dev', 'functions', 'scripts', 'tests', '.github', '.githooks', '.claude']) {
      assert.ok(!fs.existsSync(path.join(out, d)), `${d}/ would be published`);
    }
    assert.deepEqual([...shipped].filter((f) => f.toLowerCase().endsWith('.md')), [], 'a Markdown note would be published');
  });

  it('keeps the app shell, the website, the custom domain, the IndexNow key and the 404 page', () => {
    for (const p of ['index.html', '404.html', 'CNAME', 'sw.js', 'firebase-messaging-sw.js', 'manifest.json', 'precache-manifest.json',
      'robots.txt', 'sitemap.xml', 'llms.txt', '56a23bfe1bfdd002453891cc782415f3.txt', 'google8a5bbf2fb80192c4.html',
      'quote-builder-v2.html', 'track.html', '.nojekyll']) {
      assert.ok(fs.existsSync(path.join(out, p)), `${p} is missing from the public site`);
    }
  });

  it('keeps every file the service worker precaches', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const list = sw.slice(sw.indexOf('const PRECACHE = ['), sw.indexOf('];', sw.indexOf('const PRECACHE = [')));
    const paths = [...list.matchAll(/'(\/[^'?]*)/g)].map((m) => m[1]).filter((p) => p !== '/');
    assert.ok(paths.length > 20);
    for (const p of paths) assert.ok(fs.existsSync(path.join(out, p)) || fs.existsSync(path.join(out, p, 'index.html')), `precached ${p} is not published`);
  });

  it('keeps every page in the sitemap', () => {
    const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    const urls = [...xml.matchAll(/<loc>https:\/\/barroindustries\.com(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
    assert.ok(urls.length > 10);
    for (const u of urls) {
      const f = u.endsWith('/') ? path.join(out, u, 'index.html') : path.join(out, u);
      assert.ok(fs.existsSync(f), `sitemap page ${u} is not published`);
    }
  });

  it('the deploy workflow publishes this build, not the branch', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8');
    assert.match(wf, /node scripts\/build-public-site\.js _site/);
    assert.match(wf, /upload-pages-artifact@v\d+\s*\n\s*with:\s*\n\s*path: _site/);
    assert.ok(!fs.existsSync(path.join(ROOT, '.github/workflows/pages-deploy-check.yml')), 'the legacy deploy check polls an API the Actions deploy does not use');
  });
});
