import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('cancelled promptDialog does not act (delete requests, follow-up done)', () => {
  const sales = rd('js/screens/sales.js');
  assert.match(sales, /reasonIn == null\) return;/);
  const dep = rd('js/departments.js');
  assert.match(dep, /reasonIn == null\) return;/);
  assert.match(dep, /nextIn == null\) return;/);
  // creator branch of requestQuoteDelete bails on an empty reason
  assert.match(dep, /if \(createdBy && u\.uid === createdBy\) \{\s*const reason = [^\n]*\n\s*if \(!reason\) return;/);
});

test('drive.js: download-URL failure rejects, busy counter tracked, input reset', () => {
  const d = rd('js/drive.js');
  assert.match(d, /try \{ url = await ref\.getDownloadURL\(\); \} catch \(e\) \{ reject\(e\); return; \}/);
  assert.match(d, /container\.dataset\.busy/);
  assert.match(d, /finally \{[^}]*dataset\.busy/s);
  assert.match(d, /input\.value = ''/);
});

test('callers refuse to save while an upload is in flight', () => {
  const dep = rd('js/departments.js');
  for (const id of ['so-receipt-upload', 'fn-upload-area', 'gb-file-area', 'gd-file-area'])
    assert.ok(dep.includes(`$('${id}')?.dataset.busy`), id);
});

test('finance cash-advance shortcut uses the real route name', () => {
  const fin = rd('js/screens/finance.js');
  assert.ok(!fin.includes("navigateTo('cash-advance')"));
  assert.ok(fin.includes("navigateTo('cash-advances')"));
  assert.match(rd('js/app.js'), /case 'cash-advances':/);
});
