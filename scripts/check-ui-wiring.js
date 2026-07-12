#!/usr/bin/env node
/**
 * check-ui-wiring.js — CI guard for the "UI-wiring" defect class (Phase 110, V13-PLAN.md).
 *
 * This app has no framework/bundler: every screen is a template string injected via
 * innerHTML, and every interaction wire-up is either an inline onclick="fnName(...)"
 * attribute pointing at a window.* global, or JS calling getElementById/querySelector
 * against an id that must actually appear in some rendered template.
 *
 * That means two classes of defect are possible and neither is caught by node --check:
 *   (c) onclick="fnName(...)" where fnName is never defined as a window global — a dead
 *       button. This is a HARD FAIL: the Part G audit found zero legitimate cases, so any
 *       new occurrence is a real break.
 *   (a) getElementById/querySelector('#id') targets that never appear as a rendered id=
 *       anywhere — a dead lookup (returns null, likely silently swallowed).
 *   (b) rendered <button>/<select> elements with an id= that nothing ever binds to (no
 *       getElementById/querySelector reference AND no inline onclick on the same tag) —
 *       a dead control.
 * (a) and (b) are WARN-only: some ids are assigned dynamically via `el.id = '...'`
 * (createElement pattern) rather than ever appearing as a literal id="..." in a template,
 * and some rendered fields are intentionally read-only (no binding needed). Both are
 * covered by scripts/ui-wiring-allowlist.json.
 *
 * Usage: node scripts/check-ui-wiring.js
 * Exit code: 1 only on a hard failure (class c). Warnings never fail the build.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');
const ALLOWLIST_PATH = path.join(__dirname, 'ui-wiring-allowlist.json');

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return { getElementById: {}, unboundControls: {} };
  }
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  return {
    getElementById: raw.getElementById || {},
    unboundControls: raw.unboundControls || {},
  };
}

function listSourceFiles() {
  const files = [];
  if (fs.existsSync(JS_DIR)) {
    for (const name of fs.readdirSync(JS_DIR)) {
      if (name.endsWith('.js')) files.push(path.join(JS_DIR, name));
    }
  }
  const indexHtml = path.join(ROOT, 'index.html');
  if (fs.existsSync(indexHtml)) files.push(indexHtml);
  return files;
}

function readSources(files) {
  return files.map((f) => ({ file: path.relative(ROOT, f), text: fs.readFileSync(f, 'utf8') }));
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

// (?<![\w-])id=["']([a-zA-Z0-9_-]+)["'] — literal id="..." attributes rendered anywhere
// (template strings + raw HTML), avoiding false matches on attrs like "data-grid-id=".
const ID_ATTR_RE = /(?<![\w-])id=["']([a-zA-Z0-9_-]+)["']/g;

// el.id = 'x'  /  el.id="x"  — dynamically assigned ids (createElement pattern).
const ID_ASSIGN_RE = /\.id\s*=\s*['"]([a-zA-Z0-9_-]+)['"]/g;

// document.getElementById('x')
const GET_BY_ID_RE = /getElementById\(\s*['"]([a-zA-Z0-9_-]+)['"]\s*\)/g;

// document.querySelector('#x')  (id-only selectors; compound selectors like '#x .y' are
// intentionally excluded from ID extraction below via a boundary check)
const QUERY_SELECTOR_ID_RE = /querySelector(?:All)?\(\s*['"]#([a-zA-Z0-9_-]+)['"]\s*\)/g;

// onclick="fnName(...)" — first identifier immediately followed by '(' inside the value,
// skipping method calls (identifier preceded by '.').
const ONCLICK_ATTR_RE = /onclick=["']([^"']*)["']/g;
const FIRST_CALL_RE = /([A-Za-z_$][\w$]*)\s*\(/;

// window.X = ...
const WINDOW_ASSIGN_RE = /window\.([A-Za-z_$][\w$]*)\s*=/g;
// top-level function declarations (incl. async)
const TOP_FN_RE = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
// top-level const/let/var NAME = (arrow or function expr), at line start (allow leading
// whitespace for files that indent top-level under an IIFE — still catches the common case)
const TOP_CONST_FN_RE = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/gm;

// Rendered <button ...> / <select ...> tags, single-line-ish capture of the opening tag.
const BUTTON_OR_SELECT_TAG_RE = /<(button|select)\b([^>]*)>/gi;

const SKIP_ONCLICK_IDENTS = new Set(['this', 'event']);

function extractAll(sources) {
  const definedIds = new Set(); // literal id="..." rendered anywhere
  const assignedIds = new Set(); // el.id = '...'
  const getByIdRefs = new Set();
  const querySelectorIdRefs = new Set();
  const onclickCalls = []; // {file, ident, snippet}
  const globalInventory = new Set();
  const tagOccurrences = []; // {file, tag, id, hasOnclick}

  for (const { file, text } of sources) {
    let m;

    ID_ATTR_RE.lastIndex = 0;
    while ((m = ID_ATTR_RE.exec(text))) definedIds.add(m[1]);

    ID_ASSIGN_RE.lastIndex = 0;
    while ((m = ID_ASSIGN_RE.exec(text))) assignedIds.add(m[1]);

    GET_BY_ID_RE.lastIndex = 0;
    while ((m = GET_BY_ID_RE.exec(text))) getByIdRefs.add(m[1]);

    QUERY_SELECTOR_ID_RE.lastIndex = 0;
    while ((m = QUERY_SELECTOR_ID_RE.exec(text))) querySelectorIdRefs.add(m[1]);

    ONCLICK_ATTR_RE.lastIndex = 0;
    while ((m = ONCLICK_ATTR_RE.exec(text))) {
      const value = m[1];
      const callMatch = FIRST_CALL_RE.exec(value);
      if (!callMatch) continue;
      const ident = callMatch[1];
      const precedingChar = value[callMatch.index - 1];
      if (precedingChar === '.') continue; // method call, e.g. this.blur()
      if (SKIP_ONCLICK_IDENTS.has(ident)) continue;
      onclickCalls.push({ file, ident, snippet: value.slice(0, 60) });
    }

    WINDOW_ASSIGN_RE.lastIndex = 0;
    while ((m = WINDOW_ASSIGN_RE.exec(text))) globalInventory.add(m[1]);

    TOP_FN_RE.lastIndex = 0;
    while ((m = TOP_FN_RE.exec(text))) globalInventory.add(m[1]);

    TOP_CONST_FN_RE.lastIndex = 0;
    while ((m = TOP_CONST_FN_RE.exec(text))) globalInventory.add(m[1]);

    BUTTON_OR_SELECT_TAG_RE.lastIndex = 0;
    while ((m = BUTTON_OR_SELECT_TAG_RE.exec(text))) {
      const tag = m[1].toLowerCase();
      const attrs = m[2];
      const idMatch = /(?<![\w-])id=["']([a-zA-Z0-9_-]+)["']/.exec(attrs);
      if (!idMatch) continue; // no id, nothing for getElementById/querySelector to target
      const hasOnclick = /onclick=/.test(attrs);
      tagOccurrences.push({ file, tag, id: idMatch[1], hasOnclick });
    }
  }

  return {
    definedIds,
    assignedIds,
    getByIdRefs,
    querySelectorIdRefs,
    onclickCalls,
    globalInventory,
    tagOccurrences,
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function runChecks(extracted, allowlist) {
  const { definedIds, assignedIds, getByIdRefs, querySelectorIdRefs, onclickCalls, globalInventory, tagOccurrences } =
    extracted;

  const knownIds = new Set([...definedIds, ...assignedIds]);
  const referencedIds = new Set([...getByIdRefs, ...querySelectorIdRefs]);

  // (c) HARD FAIL — onclick handler with no matching window global.
  const hardFailures = onclickCalls.filter(
    (c) => !globalInventory.has(c.ident) && !allowlist.unboundControls[`onclick:${c.ident}`]
  );

  // (a) WARN — getElementById/querySelector('#id') target never rendered.
  const danglingLookups = [...referencedIds]
    .filter((id) => !knownIds.has(id))
    .filter((id) => !allowlist.getElementById[id]);

  // (b) WARN — rendered button/select with an id, no onclick, no getElementById/querySelector ref.
  const unboundControls = tagOccurrences
    .filter((t) => !t.hasOnclick && !referencedIds.has(t.id))
    .filter((t) => !allowlist.unboundControls[t.id])
    // de-dupe by id (a control template can render many times, e.g. list rows)
    .filter((t, idx, arr) => arr.findIndex((o) => o.id === t.id) === idx);

  return { hardFailures, danglingLookups, unboundControls, knownIds, referencedIds, globalInventory };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const allowlist = readAllowlist();
  const files = listSourceFiles();
  const sources = readSources(files);
  const extracted = extractAll(sources);
  const { hardFailures, danglingLookups, unboundControls, knownIds, referencedIds, globalInventory } = runChecks(
    extracted,
    allowlist
  );

  console.log('UI-wiring check — scanned %d files (%s)', files.length, files.map((f) => path.basename(f)).join(', '));
  console.log('');
  console.log('| Class                                   | Count |');
  console.log('|------------------------------------------|-------|');
  console.log(`| onclick -> missing window global (HARD)   | ${String(hardFailures.length).padStart(5)} |`);
  console.log(`| getElementById/# target never rendered    | ${String(danglingLookups.length).padStart(5)} |`);
  console.log(`| rendered button/select id with no binding | ${String(unboundControls.length).padStart(5)} |`);
  console.log(`| (info) rendered ids                       | ${String(knownIds.size).padStart(5)} |`);
  console.log(`| (info) getElementById/# lookups            | ${String(referencedIds.size).padStart(5)} |`);
  console.log(`| (info) window-global inventory            | ${String(globalInventory.size).padStart(5)} |`);
  console.log('');

  if (hardFailures.length) {
    console.log('HARD FAILURES — onclick handler with no matching window global:');
    for (const f of hardFailures) {
      console.log(`  ::error file=${f.file}::onclick="${f.snippet}" calls "${f.ident}()" which is not a window global`);
    }
    console.log('');
  }

  if (danglingLookups.length) {
    console.log('WARN — getElementById/querySelector(\'#id\') target never rendered as id=:');
    for (const id of danglingLookups) {
      console.log(`  ::warning::getElementById/querySelector target "#${id}" never appears as a rendered id= (add to scripts/ui-wiring-allowlist.json getElementById if this is assigned via .id= dynamically, or is intentional)`);
    }
    console.log('');
  }

  if (unboundControls.length) {
    console.log('WARN — rendered <button>/<select> with an id, no onclick, and no getElementById/querySelector reference:');
    for (const t of unboundControls) {
      console.log(`  ::warning file=${t.file}::<${t.tag} id="${t.id}"> has no inline onclick and is never looked up (add to scripts/ui-wiring-allowlist.json unboundControls if this is intentionally read-only or bound via addEventListener/delegation)`);
    }
    console.log('');
  }

  if (!hardFailures.length && !danglingLookups.length && !unboundControls.length) {
    console.log('No wiring defects found.');
  }

  if (hardFailures.length) {
    console.log(`FAIL: ${hardFailures.length} onclick handler(s) reference a missing window global.`);
    process.exit(1);
  }

  console.log('PASS (warnings do not fail the build).');
  process.exit(0);
}

main();
