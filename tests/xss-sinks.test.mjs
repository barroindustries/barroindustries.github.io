// tests/xss-sinks.test.mjs — system audit 2026-10-28, finding C4: four places wrote attacker-controlled text into innerHTML.
// index.html's CSP allows 'unsafe-inline' scripts, so an onerror/onclick payload ran with the viewer's Firebase session.
//
//   1. #/dept/<payload>   parseHash() decodes the hash; navigateTo → renderGenericDept wrote it raw (one click on a link).
//   2. chat reactions     the reaction VALUE (any conversation member may write any string) was rendered raw in the chip label.
//   3. photoUrl           users/{uid}.photoUrl (owner-writable) and task-comment photoUrl went into <img src="…"> unescaped.
//   4. comment fileUrl    safeHttpUrl() does not encode ' ( ) ; so a URL broke out of onclick="window.open('…')".
//
// Where the code can be lifted out on its own, it is RUN in a vm against real payloads with the real escHtml/safeHttpUrl from
// js/modules.js; the repo-wide scans stop the same pattern reappearing at another call site.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('js/app.js'), CHAT = read('js/chat.js'), DEPTS = read('js/departments.js'), MODS = read('js/modules.js');

// Source of `function name(...) { … }` (braces balanced from the first { after the signature).
function fnSource(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} not found`);
  let depth = 0;
  for (let i = src.indexOf('{', src.indexOf(')', at)); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
// The real escaping helpers, in a sandbox with a browser-ish window.
function sandbox(extra = {}) {
  const ctx = vm.createContext({ URL, window: { location: { origin: 'https://barroindustries.com' } }, ...extra });
  vm.runInContext(fnSource(MODS, 'escHtml') + '\n' + fnSource(MODS, 'safeHttpUrl'), ctx);
  return ctx;
}
const PAYLOAD = '<img src=x onerror=alert(1)>';
// No live tag / handler survived: the output carries no raw '<img' and no unquoted onerror=.
const assertInert = (html) => {
  assert.ok(!/<img src=x/i.test(html), `raw tag survived: ${html}`);
  assert.ok(!/\sonerror=/i.test(html.replace(/&lt;[^]*?&gt;/g, '')), `handler survived: ${html}`);
};

describe('1. #/dept/<payload> — the router refuses unknown departments, the generic page escapes', () => {
  // The dept: branch of navigateTo, lifted out and run.
  const start = APP.indexOf("if (page.startsWith('dept:')) {");
  let depth = 0, end = start;
  for (let i = APP.indexOf('{', start); i < APP.length; i++) { if (APP[i] === '{') depth++; else if (APP[i] === '}' && --depth === 0) { end = i + 1; break; } }
  const branch = APP.slice(start, end);
  const runBranch = (page) => {
    const calls = [];
    const ctx = sandbox({ c: { innerHTML: '' }, renderDeptModule: (d) => calls.push(d), emojiIcon: () => '', _devCheckIconIntegrity() {}, lucide: null });
    ctx.window.DEPARTMENTS = { Finance: {}, 'Government Biddings': {} };
    vm.runInContext(`(function(page){ ${branch} })(${JSON.stringify(page)})`, ctx);
    return { calls, html: ctx.c.innerHTML };
  };

  it('a crafted department never reaches renderDeptModule and is not echoed', () => {
    const r = runBranch('dept:' + PAYLOAD);
    assert.deepEqual(r.calls, []);
    assert.ok(!r.html.includes(PAYLOAD) && /Page not found/.test(r.html));
  });
  it('prototype keys are not departments either', () => {
    for (const k of ['constructor', '__proto__', 'toString']) assert.deepEqual(runBranch('dept:' + k).calls, []);
  });
  it('real departments, including ones with spaces, still route', () => {
    assert.deepEqual(runBranch('dept:Finance').calls, ['Finance']);
    assert.deepEqual(runBranch('dept:Government Biddings').calls, ['Government Biddings']);
  });
  it('renderGenericDept escapes the name even if called directly', () => {
    const page = { innerHTML: '' };
    const ctx = sandbox({ document: { getElementById: () => page }, DEPARTMENTS: {}, lucide: null });
    ctx.window.deptIconTile = () => '';
    vm.runInContext(fnSource(APP, 'renderGenericDept') + `\nrenderGenericDept(${JSON.stringify(PAYLOAD)});`, ctx);
    assertInert(page.innerHTML);
    assert.ok(page.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });
  it("the secretary's access-denied fallback escapes too", () => {
    assert.match(fnSource(APP, 'renderDeptModule'), /<h3>\$\{escHtml\(dept\)\}<\/h3>/);
  });
});

describe('2. chat reaction chips escape the reaction value', () => {
  const s = CHAT.indexOf('const reactions = m.reactions || {};');
  const e = CHAT.indexOf(": '';", s) + 5;
  const snippet = CHAT.slice(s, e);
  const render = (reactions) => {
    const ctx = sandbox({ m: { id: 'm1', reactions }, currentUser: { uid: 'me' } });
    return vm.runInContext(`(function(){ ${snippet}; return reactionsHtml; })()`, ctx);
  };
  it('a planted payload renders as text, in the label and the data attribute', () => {
    const html = render({ attacker: PAYLOAD, me: '👍' });
    assertInert(html);
    assert.equal((html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length, 2);
  });
  it('real emoji still render as themselves', () => {
    const html = render({ a: '👍', b: '👍', me: '❤️' });
    assert.match(html, />👍 2<\/button>/);
    assert.match(html, />❤️ 1<\/button>/);
  });
});

describe('3. photoUrl image sources are escaped and http(s)-only, app-wide', () => {
  it('no <img src="${…photo…}"> is interpolated raw anywhere under js/', () => {
    const files = [];
    const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach(f => {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (f.name !== 'vendor') walk(p); } else if (p.endsWith('.js')) files.push(p);
    });
    walk('js');
    const raw = [];
    for (const f of files) read(f).split('\n').forEach((l, i) => {
      for (const m of l.matchAll(/src="\$\{([^}]*[pP]hoto[A-Za-z]*)\}"/g)) raw.push(`${f}:${i + 1} ${m[1]}`);
    });
    assert.deepEqual(raw, [], 'raw photo src interpolations:\n' + raw.join('\n'));
  });
  it('the six fixed sites use escHtml(safeHttpUrl(…))', () => {
    const want = [['js/app.js', 'userProfile.photoUrl', 2], ['js/departments.js', 'c.photoUrl', 1], ['js/departments.js', 'userProfile.photoUrl', 1], ['js/screens/hr.js', 'u.photoUrl', 2]];
    for (const [f, expr, n] of want) {
      const hits = read(f).split(`src="\${escHtml(safeHttpUrl(${expr}))}"`).length - 1;
      assert.ok(hits >= n, `${f}: ${expr} expected ${n}, found ${hits}`);
    }
  });
  it('the attribute-breakout and javascript: payloads come out inert', () => {
    const ctx = sandbox();
    const out = (v) => vm.runInContext(`escHtml(safeHttpUrl(${JSON.stringify(v)}))`, ctx);
    assert.ok(!out('x" onerror="alert(1)').includes('"'));
    assert.equal(out('javascript:alert(1)'), '');
    assert.equal(out('https://firebasestorage.googleapis.com/v0/b/x/o/p.jpg?alt=media&token=t'),
      'https://firebasestorage.googleapis.com/v0/b/x/o/p.jpg?alt=media&amp;token=t');
  });
});

describe('4. comment image attachments open through a link, not an inline onclick', () => {
  it('no onclick="window.open(\'${…}\')" remains anywhere under js/', () => {
    for (const f of ['js/app.js', 'js/departments.js', 'js/chat.js', 'js/modules.js'])
      assert.doesNotMatch(read(f), /onclick="window\.open\('\$\{/, f);
  });
  it("a URL carrying ');alert(1);// renders with no script context to break out of", () => {
    const line = DEPTS.split('\n').find(l => l.includes('isImage(c.fileUrl)'));
    const i = DEPTS.indexOf(line);
    const tern = DEPTS.slice(i, DEPTS.indexOf("Attachment')}</span></a>`", i) + 26);
    const expr = tern.slice(tern.indexOf('c.fileSource'));
    const ctx = sandbox({ isImage: (u) => /\.(png|jpe?g|gif|webp)$/i.test(u), emojiIcon: () => '' });
    const html = vm.runInContext(`(function(c){ return ${expr}; })(${JSON.stringify({ text: '', fileSource: null, fileName: 'a.png', fileUrl: "https://x.com/a');alert(1);//.png" })})`, ctx);
    assert.doesNotMatch(html, /onclick/i);
    assert.match(html, /^<div[^>]*><a href="https:\/\/x\.com\/a&#39;\);alert\(1\);\/\/\.png" target="_blank" rel="noopener"><img /);
  });
});
