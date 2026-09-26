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
 * Scan scope: index.html plus js/ RECURSIVELY (js/vendor/ excluded). The recursion
 * matters — js/screens/*.js is 24 files and the bulk of the UI surface, and until
 * 2026-09-26 a non-recursive readdir meant none of it was scanned, so class (c)
 * only ever guarded js/*.js. All files are read into ONE global inventory, so a
 * handler defined in one file and called from another (21 screens call app.js's
 * closeModal() / chat.js's navigateTo()) resolves correctly.
 *
 * Usage: node scripts/check-ui-wiring.js
 * Exit code: 1 on a hard failure (class c) or if js/screens/ stops being scanned.
 * Warnings never fail the build.
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

// Directory names under js/ that are never part of the app's own UI surface.
// vendor/ is third-party (html2canvas etc.) — its onclick/id conventions are not ours.
const SKIP_JS_DIRS = new Set(['vendor', 'node_modules']);

// Recurse js/ so js/screens/*.js (the bulk of the UI surface, lazy-loaded via
// PAGE_SCRIPTS in js/config.js) is scanned too. All files are read into ONE
// inventory, so a handler defined in one screen and called from another is fine.
function listSourceFiles() {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_JS_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        files.push(full);
      }
    }
  }
  if (fs.existsSync(JS_DIR)) walk(JS_DIR);
  files.sort();
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

// '#some-id' as a bare string literal ANYWHERE. Nothing in this app writes a
// '#foo' literal except to reach the element with that id, and the lookup is very
// often not a direct querySelector call: event delegation (e.target.closest('#x')),
// or the id handed to a binder helper (bindPolicyPick('#sr-tb-pick-flat', ...),
// set('status', '#vt-f-status', ...)). Treating the literal itself as the reference
// covers all of those uniformly instead of chasing each call shape.
// Two shapes must be rejected or this floods: a CSS hex colour ('#FF6B9D' would read
// as the id "FF6B9D") and a concatenation prefix ('#chat-mediatab-' + key), which is a
// fragment, not an id. So require a letter/underscore start, no trailing '-', and
// reject pure-hex strings of colour length (3/4/6/8).
const HASH_LITERAL_RE = /['"]#([a-zA-Z_][a-zA-Z0-9_-]*)['"]/g;
const HEX_COLOR_RE = /^(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function isIdLike(v) {
  return !v.endsWith('-') && !HEX_COLOR_RE.test(v);
}

// $('x') / $p('x') / $hrp('x') / ctx.$('x') — this codebase's dominant lookup idiom.
// Every modal opens with a local `const $<suffix> = (id) => _panel.querySelector('#' + id)`
// (45 such helpers across js/ and js/screens/). Because the '#' is CONCATENATED,
// QUERY_SELECTOR_ID_RE cannot see any of it — that one blind spot accounted for ~190
// of the 204 class-(b) warnings. Two argument shapes exist under these names:
// a bare id (the '#' + id helpers) and a full selector (the `(sel) => qs(sel)` ones),
// so accept '#foo' and bare `foo`, and ignore anything else ('.cls', '[data-x]').
const DOLLAR_HELPER_RE = /\$[\w$]*\(\s*['"]([^'"]+)['"]\s*\)/g;
const BARE_ID_RE = /^[a-zA-Z0-9_-]+$/;

// Declarative id config keys. These are handed to a renderer that interpolates them
// into an id= attribute (js/ui-states.js emits id="' + esc(action.id) + '", and
// window.birToolbarHTML({csvId}) emits id="${csvId}"), then looked up by that same
// string. So each is BOTH a rendered id and a reference to it, and neither side is
// visible to the literal-attribute / literal-lookup regexes.
const DECL_ID_RE = /\b(?:csvId|saveBtnId|targetId)\s*:\s*['"]([a-zA-Z0-9_-]+)['"]/g;
const NESTED_ID_RE = /\b(?:action|filter)\s*:[^{};\n]{0,60}\{[^{}]*\bid\s*:\s*['"]([a-zA-Z0-9_-]+)['"]/g;

// onclick="fnName(...)" — first identifier immediately followed by '(' inside the value,
// skipping method calls (identifier preceded by '.').
const ONCLICK_ATTR_RE = /onclick=["']([^"']*)["']/g;
const FIRST_CALL_RE = /([A-Za-z_$][\w$]*)\s*\(/;

// onclick="window.fnName(...)" — the explicitly-namespaced form. FIRST_CALL_RE sees
// `fnName` preceded by '.' and skips it as a method call, so without this the whole
// form went unchecked. A missing window.fnName is just as dead as a bare fnName.
const WINDOW_CALL_RE = /(?:^|[^.\w$])window\.([A-Za-z_$][\w$]*)\s*\(/;

// Browser built-ins on window — real functions, never defined by this app.
const WINDOW_BUILTINS = new Set(['print', 'open', 'alert', 'confirm', 'prompt', 'close', 'scrollTo', 'focus']);

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

    HASH_LITERAL_RE.lastIndex = 0;
    while ((m = HASH_LITERAL_RE.exec(text))) { if (isIdLike(m[1])) querySelectorIdRefs.add(m[1]); }

    DOLLAR_HELPER_RE.lastIndex = 0;
    while ((m = DOLLAR_HELPER_RE.exec(text))) {
      const arg = m[1].startsWith('#') ? m[1].slice(1) : m[1];
      if (BARE_ID_RE.test(arg) && isIdLike(arg)) querySelectorIdRefs.add(arg);
    }

    // Both a definition and a reference — see DECL_ID_RE above.
    DECL_ID_RE.lastIndex = 0;
    while ((m = DECL_ID_RE.exec(text))) { definedIds.add(m[1]); querySelectorIdRefs.add(m[1]); }

    NESTED_ID_RE.lastIndex = 0;
    while ((m = NESTED_ID_RE.exec(text))) { definedIds.add(m[1]); querySelectorIdRefs.add(m[1]); }

    ONCLICK_ATTR_RE.lastIndex = 0;
    while ((m = ONCLICK_ATTR_RE.exec(text))) {
      const value = m[1];
      const callMatch = FIRST_CALL_RE.exec(value);
      if (!callMatch) continue;
      const ident = callMatch[1];
      const precedingChar = value[callMatch.index - 1];
      if (precedingChar === '.') {
        // A method call — but `window.fnName(...)` is a global call wearing a dot.
        const winMatch = WINDOW_CALL_RE.exec(value);
        if (winMatch && !WINDOW_BUILTINS.has(winMatch[1])) {
          onclickCalls.push({ file, ident: winMatch[1], snippet: value.slice(0, 60) });
        }
        continue; // e.g. this.blur(), event.stopPropagation()
      }
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

  // Relative paths, not basenames: js/payroll.js and js/screens/payroll.js are
  // different files and the basename list made that ambiguous.
  const rel = files.map((f) => path.relative(ROOT, f));
  const screenCount = rel.filter((f) => f.startsWith(`js${path.sep}screens${path.sep}`)).length;
  console.log('UI-wiring check — scanned %d files (%d under js/screens/)', files.length, screenCount);
  console.log('  %s', rel.join(', '));

  // Self-guard: js/screens/ is the bulk of the UI surface. Until 2026-09-26 this
  // script did a non-recursive readdir and silently scanned none of it, so every
  // dead onclick in a screen shipped green. If the walk ever stops reaching them
  // again, fail loudly rather than reporting a meaningless PASS.
  const screensDir = path.join(JS_DIR, 'screens');
  if (fs.existsSync(screensDir) && fs.readdirSync(screensDir).some((f) => f.endsWith('.js')) && screenCount === 0) {
    console.log('FAIL: js/screens/ contains .js files but none were scanned — listSourceFiles() has regressed.');
    process.exit(1);
  }
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
