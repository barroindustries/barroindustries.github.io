// tests/rules-tighten-2026-11-20.test.mjs — data-access tightening from the 2026-11-20 system review.
//   it_software: licence keys were readable by every profile (hasProfile()); now IT tier only (canIt()),
//   the same as it_access / it_network. Textual pins (no emulator), cross-checked against the client reads.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const RULES = read('firestore.rules').replace(/\/\/[^\n]*/g, '');
function block(head) {
  const at = RULES.indexOf(head);
  assert.ok(at >= 0, `block not found: ${head}`);
  let depth = 0;
  for (let i = RULES.indexOf('{', at + head.length); i < RULES.length; i++) {
    if (RULES[i] === '{') depth++;
    else if (RULES[i] === '}' && --depth === 0) return RULES.slice(at, i + 1);
  }
  throw new Error('unbalanced');
}
const readRule = (blk) => (blk.match(/allow read:([\s\S]*?);/) || [])[1].replace(/\s+/g, ' ').trim();

function jsFiles(dir = 'js', out = []) {
  for (const e of fs.readdirSync(new URL('../' + dir, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== 'vendor') jsFiles(`${dir}/${e.name}`, out); }
    else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
  }
  return out;
}

describe('it_software (licence keys): IT tier only', () => {
  it('reads need canIt(), like it_access and it_network', () => {
    assert.equal(readRule(block('match /it_software/{docId}')), 'if isAuth() && canIt()');
    assert.equal(readRule(block('match /it_access/{docId}')), 'if isAuth() && canIt()');
  });
  it('the only client reader is the IT screen (which is canIt-gated)', () => {
    const readers = jsFiles().filter((f) => /collection\('it_software'\)[^;]*\.(get|onSnapshot)\(/.test(read(f)));
    assert.deepEqual(readers, ['js/screens/govit.js']);
  });
});
