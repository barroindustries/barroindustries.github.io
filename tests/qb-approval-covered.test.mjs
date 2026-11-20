// P1 (flow spec §6.6, 2026-11-20): the builder sends its own "the President's approval still covers this revision" verdict with QUOTE_FILED, KC quotes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const HTML = fs.readFileSync(new URL('../quote-builder-v2.html', import.meta.url), 'utf8');
const APP = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
test('QUOTE_FILED carries approvalCovered on the envelope, only in KC mode, from approvalCoversNow()', () => {
  const posts = HTML.match(/postMessage\([^\n]*type:'QUOTE_FILED'[^\n]*/g) || [];
  assert.equal(posts.length, 1, 'one QUOTE_FILED post');
  assert.match(posts[0], /\.\.\.\(d7On\(\) \? \{ approvalCovered: !!approvalCoversNow\(\) \} : \{\}\)/);
  assert.equal(/payload: *quotePayload[^}]*approvalCovered/.test(posts[0]) && /quotePayload\.approvalCovered/.test(HTML), false, 'never inside the payload');
});
test('the approval request and the in-place update do not carry it', () => {
  for (const t of ['QUOTE_APPROVAL_REQUESTED', 'QUOTE_UPDATE']) {
    const m = HTML.match(new RegExp("postMessage\\([^\\n]*type:'" + t + "'[^\\n]*", 'g')) || [];
    assert.ok(m.length >= 1, t);
    m.forEach((x) => assert.equal(/approvalCovered/.test(x), false, t));
  }
});
test('the bridge reads the envelope flag as a strict boolean and a false goes to the President', () => {
  assert.match(APP, /typeof e\.data\.approvalCovered === 'boolean' \? e\.data\.approvalCovered/);
  assert.match(APP, /if \(builderCovered === false\) return \{ mode: 'approve'/);
});
