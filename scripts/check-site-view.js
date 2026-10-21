#!/usr/bin/env node
/**
 * check-site-view.js — CI guard (scripts/ci-invariants.sh CHECK 11): the website view of index.html loads no app asset.
 *
 * index.html is both the public website and the app shell. A visitor on the website must not download or run the app (a mobile Lighthouse run of the
 * old page fetched 49 files / 3.6 MB for it: Performance 61). The app's stylesheets, hints and the whole ordered script list therefore live in an
 * inert <template id="app-kit"> in the <head>, which a head script writes only for the app views (boot / login / app) — see the PERF note in
 * index.html. This script fails when anything outside that template would put the app back on the website:
 *   - an external script other than js/site.js, any stylesheet <link> (the website stylesheet is inline: scripts/inline-site-css.js),
 *     a preload / dns-prefetch / modulepreload hint, a preconnect to anything but the two font hosts,
 *   - any reference to a Firebase / icon-library / app-stylesheet / app-script URL.
 * "Outside" = outside the template, comments, <noscript>, the inline stylesheet and the JSON-LD data blocks.
 * A new app script or stylesheet goes INTO app-kit (and into sw.js PRECACHE, CHECK 2) — not into <body>.
 *
 * Usage: node scripts/check-site-view.js      (exit 1 and one FAIL line per problem)
 */
'use strict';

const fs = require('fs');
const path = require('path');

function problems(html) {
  const out = [];
  if (!/<template id="app-kit">[\s\S]*?<\/template>/.test(html)) {
    out.push('index.html has no <template id="app-kit"> — the scripts and stylesheets of the app must live in it, not in <body>');
  }
  // comments FIRST: several of them mention <template>, and stripping the template first would leave a comment unclosed
  const outside = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<template\b[\s\S]*?<\/template>/g, '')
    .replace(/<noscript>[\s\S]*?<\/noscript>/g, '')
    .replace(/<style id="site-css">[\s\S]*?<\/style>/, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"')); return m ? m[1] : null; };
  for (const m of outside.matchAll(/<script\b[^>]*>/g)) {
    const src = attr(m[0], 'src');
    if (src && src !== 'js/site.js') out.push('the website view loads the script ' + src + ' — put it inside <template id="app-kit">, not outside it');
  }
  for (const m of outside.matchAll(/<link\b[^>]*>/g)) {
    const rel = attr(m[0], 'rel'), href = attr(m[0], 'href') || '';
    if (rel === 'stylesheet') out.push('the website view blocks its first paint on the stylesheet ' + href + ' — the website stylesheet is inline (scripts/inline-site-css.js); app stylesheets belong in app-kit');
    if (rel === 'preload' || rel === 'dns-prefetch' || rel === 'modulepreload') out.push('the website view carries <link rel="' + rel + '" href="' + href + '"> — hints for the app belong in app-kit');
    if (rel === 'preconnect' && !/^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(href)) out.push('the website view preconnects to ' + href + ' — only the two font hosts belong outside app-kit');
  }
  for (const m of outside.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
    if (/gstatic\.com\/firebasejs|unpkg\.com|cdn\.jsdelivr\.net|(^|\/)css\/(tokens|styles)\.css|(^|\/)js\/(app|config|chat|departments|modules)\.js/.test(m[1])) {
      out.push('the website view references the app asset ' + m[1]);
    }
  }
  return out;
}

if (require.main === module) {
  let found;
  try { found = problems(fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8')); } catch (e) { found = ['site-view check error: ' + e.message]; }
  found.forEach((x) => console.log('FAIL: ' + x));
  process.exit(found.length ? 1 : 0);
}
module.exports = { problems };
