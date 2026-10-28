// tests/fixtures/strip-comments.mjs — the JS comment stripper the textual pins of the partner-removal suites rely on
// (tests/partner-removal.test.mjs, tests/partner-removal-payroll.test.mjs). Moved here verbatim from the payroll test so the two share ONE copy;
// the only change is that a block comment now leaves its newlines behind, so line N of the output is still line N of the input (the gate test reports
// real line numbers and looks a few lines UP the raw file for a marker comment).
//
// Removes // and /* */ comments while leaving strings, template literals (with nested ${ … } expressions) and regex literals untouched, so a "//" inside a
// URL string or a quote inside a regex cannot swallow real code. Heuristic regex detection (a "/" after an operator, "(" , "," or a keyword like `return`).
// Callers prove it did not eat code by checking that the stripped text still parses (new vm.Script) — see codeOf() in both suites.
export function stripComments(src) {
  let out = '', i = 0, depth = 0, last = '', lastWord = '';
  const n = src.length, tplDepth = [];
  const IDCH = /[A-Za-z0-9_$]/;
  const REGEX_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const REGEX_KW = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof', 'yield', 'await']);
  const copyTemplate = () => {                                  // i is just past a backtick, or just past the } that closed a ${ … }
    while (i < n) {
      const c = src[i];
      if (c === '\\') { out += c + (src[i + 1] || ''); i += 2; continue; }
      if (c === '`') { out += c; i++; last = '`'; lastWord = ''; return; }
      if (c === '$' && src[i + 1] === '{') { out += '${'; i += 2; tplDepth.push(depth); depth = 0; last = '{'; lastWord = ''; return; }
      out += c; i++;
    }
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2), end = e < 0 ? n : e + 2;
      out += ' ' + '\n'.repeat((src.slice(i, end).match(/\n/g) || []).length);
      i = end; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; last = c; lastWord = ''; continue;
    }
    if (c === '`') { out += c; i++; copyTemplate(); continue; }
    if (c === '/' && (last === '' || REGEX_PREV.has(last) || REGEX_KW.has(lastWord))) {
      let j = i + 1, inClass = false;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '\n') break;
        if (ch === '[') inClass = true; else if (ch === ']') inClass = false; else if (ch === '/' && !inClass) break;
        j++;
      }
      j++; while (j < n && /[a-z]/i.test(src[j])) j++;
      out += src.slice(i, j); i = j; last = '/'; lastWord = ''; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      if (tplDepth.length && depth === 0) { out += c; i++; depth = tplDepth.pop(); copyTemplate(); continue; }
      depth--;
    }
    out += c; i++;
    if (!/\s/.test(c)) { lastWord = IDCH.test(c) ? ((IDCH.test(last) ? lastWord : '') + c) : ''; last = c; }
  }
  return out;
}
