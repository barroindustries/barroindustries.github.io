#!/usr/bin/env node
/**
 * inline-site-css.js — keeps the public website's stylesheet INLINE in index.html's <head>.
 *
 *   node scripts/inline-site-css.js            rewrite the block in index.html from css/site.css
 *   node scripts/inline-site-css.js --check    exit 1 when the block is missing or stale (the commit gates run this)
 *
 * WHY. css/site.css is render-blocking, and on a phone behind a real network that one extra request (a round trip plus the
 * server's own response time) sat between the HTML and the first paint of the website. Inlining the SAME bytes removes the
 * request: the page paints as soon as the HTML has arrived. css/site.css stays the one place the rules are written and edited
 * (the standalone pages /catalogue/, /services/ ... still link it); this script copies it, verbatim, between two marker
 * comments in index.html, so the copy can never be edited by hand without CI saying so (scripts/ci-invariants.sh CHECK 11,
 * tests/site-perf-loading.test.mjs). Verbatim on purpose: no minifier, so what is inlined is exactly what the tests read.
 *
 * AFTER EDITING css/site.css, RUN THIS SCRIPT (it rewrites index.html in place). The pre-commit hook does not.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS_FILE = path.join(ROOT, 'css', 'site.css');
const HTML_FILE = path.join(ROOT, 'index.html');

const START = '<!-- SITE-CSS:START generated from css/site.css by scripts/inline-site-css.js — DO NOT HAND-EDIT: edit css/site.css, then run  node scripts/inline-site-css.js -->';
const END = '<!-- SITE-CSS:END -->';

class InlineCssError extends Error {}

// The block that goes between (and including) the markers.
function block(css) {
  if (/<\/style/i.test(css)) throw new InlineCssError('css/site.css contains "</style", which would end the inline block early');
  return `${START}\n<style id="site-css">\n${css.replace(/\s+$/, '')}\n</style>\n${END}`;
}

// Replace the marked region of an index.html string; throws when the markers are not there exactly once.
function build(html, css) {
  const s = html.indexOf(START), e = html.indexOf(END);
  if (s < 0 || e < 0) throw new InlineCssError('index.html has no SITE-CSS:START / SITE-CSS:END markers');
  if (html.indexOf(START, s + 1) >= 0 || html.indexOf(END, e + 1) >= 0) throw new InlineCssError('index.html has more than one SITE-CSS block');
  if (e < s) throw new InlineCssError('SITE-CSS:END comes before SITE-CSS:START');
  return html.slice(0, s) + block(css) + html.slice(e + END.length);
}

function main() {
  const check = process.argv.includes('--check');
  const css = fs.readFileSync(CSS_FILE, 'utf8');
  const html = fs.readFileSync(HTML_FILE, 'utf8');
  let next;
  try { next = build(html, css); } catch (err) {
    if (!(err instanceof InlineCssError)) throw err;
    console.error('FAIL: ' + err.message);
    process.exit(1);
  }
  if (check) {
    if (next !== html) {
      console.error('FAIL: the inline <style id="site-css"> block in index.html is stale — it must equal css/site.css.');
      console.error('  FIX: node scripts/inline-site-css.js   (then re-run the gates; do not edit the block by hand)');
      process.exit(1);
    }
    console.log('PASS: the inline site stylesheet in index.html equals css/site.css (' + css.length + ' bytes)');
    return;
  }
  if (next === html) { console.log('index.html is already up to date (' + css.length + ' bytes of css/site.css inlined)'); return; }
  fs.writeFileSync(HTML_FILE, next);
  console.log('index.html: inlined css/site.css (' + css.length + ' bytes)');
}

if (require.main === module) main();
module.exports = { START, END, block, build, InlineCssError };
