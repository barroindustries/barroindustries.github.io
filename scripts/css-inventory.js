#!/usr/bin/env node
/**
 * css-inventory.js — mechanical dead-CSS-selector finder (Phase 51, V13-PLAN.md).
 *
 * Extracts every class/id selector defined in css/styles.css, extracts every
 * class-string literal referenced across js/*.js and *.html (class=, classList
 * add/remove/toggle/contains, className=, querySelector[All]), diffs the two
 * sets, and prints DEFINITELY-DEAD / MAYBE (dynamic-classname false negatives)
 * / a summary count.
 *
 * Plain Node 20, no dependencies. Run: node scripts/css-inventory.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS_FILE = path.join(ROOT, 'css', 'styles.css');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function listFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...listFiles(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// --- 1. Extract selectors defined in styles.css ------------------------------

function extractSelectors(cssText) {
  // Strip comments first.
  const noComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = new Map(); // selectorText -> {type:'class'|'id', name, lines:[]}

  // Find each rule's selector block: text before each top-level '{'.
  // We track line numbers by scanning line-by-line and accumulating selector
  // text until we hit a '{' (naive but fine for a flat stylesheet with no
  // nested @rules other than @media/@keyframes, which we still want to scan
  // inside of since selectors there are still real selectors).
  const lines = noComments.split('\n');
  let buf = '';
  let bufStartLine = 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (buf === '') bufStartLine = lineNo;
    // Skip at-rule lines that aren't rule blocks with selectors we care about
    // (@media/@supports open a block with '{' but their "selector" isn't a
    // CSS selector — let it fall through harmlessly, extraction below just
    // won't find class/id tokens in e.g. "@media (max-width: 600px)").
    buf += line + '\n';
    if (line.includes('{')) {
      const selectorPart = buf.slice(0, buf.indexOf('{'));
      registerSelectors(selectorPart, bufStartLine, lineNo, selectors);
      buf = '';
    } else if (line.includes('}')) {
      // closing brace of a declaration block, or of @media itself — reset buf
      buf = '';
    }
  }
  return selectors;
}

function registerSelectors(selectorText, startLine, endLine, selectors) {
  const trimmed = selectorText.trim();
  if (!trimmed) return;
  if (trimmed.startsWith('@')) return; // @media, @keyframes, @font-face, @supports
  if (trimmed.startsWith('from') || trimmed.startsWith('to') || /^\d+%/.test(trimmed)) return; // keyframe steps

  // Split into individual comma-separated selectors.
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    // Extract every .class and #id token in this compound selector.
    const classRe = /\.(-?[_a-zA-Z][\w-]*)/g;
    const idRe = /#(-?[_a-zA-Z][\w-]*)/g;
    let m;
    while ((m = classRe.exec(part))) {
      addSelector(selectors, 'class', m[1], startLine, endLine);
    }
    while ((m = idRe.exec(part))) {
      addSelector(selectors, 'id', m[1], startLine, endLine);
    }
  }
}

function addSelector(map, type, name, startLine, endLine) {
  const key = type + ':' + name;
  if (!map.has(key)) map.set(key, { type, name, lines: [] });
  map.get(key).lines.push(startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`);
}

// --- 2. Extract class-string literals referenced in JS/HTML -------------------

function extractUsedTokens(jsHtmlText) {
  const tokens = new Set();

  // class="a b c" / class='a b c'  (HTML + template strings)
  for (const m of jsHtmlText.matchAll(/class(?:Name)?\s*=\s*["']([^"'$]*?)["']/g)) {
    for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
  }
  // class="...${expr}..." — capture the static prefix/suffix segments around
  // template interpolations too, since those are still literal substrings.
  for (const m of jsHtmlText.matchAll(/class(?:Name)?\s*=\s*[`"']([^`"']*)[`"']/g)) {
    for (const t of m[1].split(/\s+/)) {
      const cleaned = t.replace(/\$\{[^}]*\}/g, ' ').trim();
      for (const sub of cleaned.split(/\s+/)) if (sub) tokens.add(sub);
    }
  }

  // classList.add/remove/toggle/contains('x','y')
  for (const m of jsHtmlText.matchAll(/classList\.(?:add|remove|toggle|contains)\(([^)]*)\)/g)) {
    for (const strM of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
      for (const t of strM[1].split(/\s+/)) if (t) tokens.add(t);
    }
  }

  // querySelector(All)('.class' / '#id')
  for (const m of jsHtmlText.matchAll(/querySelector(?:All)?\(\s*['"`]([^'"`]+)['"`]/g)) {
    for (const t of m[1].split(/[\s,]+/)) {
      const cleaned = t.replace(/^[.#]/, '');
      if (cleaned) tokens.add(cleaned);
    }
  }

  // id="..." / getElementById('...')
  for (const m of jsHtmlText.matchAll(/\bid\s*=\s*["']([^"'$]+)["']/g)) {
    tokens.add(m[1]);
  }
  for (const m of jsHtmlText.matchAll(/getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
    tokens.add(m[1]);
  }

  // Any generic quoted string containing a class-like token (catches
  // ad-hoc string concatenation, e.g. `'badge-' + status`) — collect raw
  // string literals too, used only for substring/prefix matching, not exact.
  const rawStrings = [];
  for (const m of jsHtmlText.matchAll(/['"`]([a-zA-Z][\w-]*(?:\s+[a-zA-Z][\w-]*)*)['"`]/g)) {
    rawStrings.push(m[1]);
  }

  return { tokens, rawStrings };
}

// --- 3. Main -------------------------------------------------------------------

function main() {
  const cssText = readFile(CSS_FILE);
  const selectors = extractSelectors(cssText);

  const jsFiles = listFiles(path.join(ROOT, 'js'), ['.js']);
  const htmlFiles = listFiles(ROOT, ['.html']).filter((f) => !f.includes(path.join(ROOT, 'node_modules')));
  const allSourceFiles = [...jsFiles, ...htmlFiles];

  let combinedText = '';
  for (const f of allSourceFiles) {
    try {
      combinedText += '\n' + readFile(f);
    } catch (e) {
      // skip unreadable files
    }
  }

  const { tokens: usedTokens, rawStrings } = extractUsedTokens(combinedText);

  // Build a single haystack of raw strings + full source text for substring
  // (prefix) matching used by the MAYBE heuristic.
  const haystackStrings = rawStrings.join('\n');

  const definitelyDead = [];
  const maybe = [];
  const used = [];

  for (const [, sel] of selectors) {
    const { type, name, lines } = sel;
    if (usedTokens.has(name)) {
      used.push(sel);
      continue;
    }

    // Dynamic-classname heuristic: strip trailing "-segment" iteratively and
    // check whether the remaining prefix (with trailing '-') appears as a
    // substring anywhere in JS/HTML source (e.g. CSS class `badge-warning`
    // strip to `badge-` and look for `badge-${` or `'badge-' +` etc).
    let isMaybe = false;
    const segments = name.split('-');
    for (let cut = segments.length - 1; cut >= 1; cut--) {
      const prefix = segments.slice(0, cut).join('-') + '-';
      if (combinedText.includes(prefix)) {
        isMaybe = true;
        break;
      }
    }
    // Also check the reverse: does any raw string in JS look like it *starts*
    // with this full class name plus more (e.g. class defined as `card` but
    // JS builds `card-active` dynamically) — already covered by usedTokens
    // exact match in most cases, but add a light substring safety net.
    if (!isMaybe && type === 'class' && combinedText.includes(name)) {
      isMaybe = true;
    }

    if (isMaybe) {
      maybe.push(sel);
    } else {
      definitelyDead.push(sel);
    }
  }

  // --- Report ---
  const fmt = (sel) => `${sel.type === 'class' ? '.' : '#'}${sel.name}  (css/styles.css:${sel.lines.join(',')})`;

  console.log('='.repeat(78));
  console.log('CSS INVENTORY — css/styles.css vs js/*.js + *.html');
  console.log('='.repeat(78));
  console.log(`Selectors defined in CSS : ${selectors.size}`);
  console.log(`  used (exact match)     : ${used.length}`);
  console.log(`  MAYBE (dynamic/prefix)  : ${maybe.length}`);
  console.log(`  DEFINITELY-DEAD         : ${definitelyDead.length}`);
  console.log('');

  console.log('-'.repeat(78));
  console.log(`DEFINITELY-DEAD (${definitelyDead.length}) — no substring match anywhere in js/*.js or *.html`);
  console.log('-'.repeat(78));
  definitelyDead
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((sel) => console.log('  ' + fmt(sel)));

  console.log('');
  console.log('-'.repeat(78));
  console.log(`MAYBE (${maybe.length}) — prefix/dynamic-classname match found, review before deleting`);
  console.log('-'.repeat(78));
  maybe
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((sel) => console.log('  ' + fmt(sel)));

  console.log('');
  console.log('='.repeat(78));
  console.log('SUMMARY');
  console.log('='.repeat(78));
  console.log(`Total CSS selectors : ${selectors.size}`);
  console.log(`Used                : ${used.length}`);
  console.log(`Maybe (dynamic)     : ${maybe.length}`);
  console.log(`Definitely dead     : ${definitelyDead.length}`);
  console.log(`JS files scanned    : ${jsFiles.length}`);
  console.log(`HTML files scanned  : ${htmlFiles.length}`);
}

main();
