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

// Owner ruling 2026-11-20: client and quote data is for OFFICE STAFF only — not commission sales agents, not
// HR-managed worker logins. Sales orders / job orders are untouched (production needs them).
describe('client and quote data: office staff only', () => {
  const RAW = read('firestore.rules');
  it('isOfficeStaff() excludes agents and worker logins, reusing the cached users get()', () => {
    const def = RULES.match(/function isOfficeStaff\(\) \{[\s\S]*?\n    \}/);
    assert.ok(def, 'isOfficeStaff() is not defined');
    const body = def[0].replace(/\s+/g, ' ');
    assert.match(body, /let u = get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)\.data;/);
    assert.match(body, /u\.get\('role', ''\) != 'agent'/);
    assert.match(body, /u\.get\('hrManagedAccount', false\) != true/);
  });
  for (const head of ['match /clients/{docId}', 'match /client_info_requests/{ref}', 'match /client_info_requests/{ref}/notes/{nid}',
    'match /quote_requests/{ref}', 'match /quote_requests/{ref}/notes/{nid}', 'match /approval_requests/{docId}']) {
    it(`${head}: read is office staff only`, () => {
      assert.equal(readRule(block(head + ' {')), 'if isAuth() && hasProfile() && isOfficeStaff()');
    });
  }
  it('bs_quotes: an agent still reads their OWN quotes (createdBy arm), everyone else\'s only as office staff', () => {
    assert.equal(readRule(block('match /bs_quotes/{docId} {')),
      "if isAuth() && ( resource.data.createdBy == request.auth.uid || (hasProfile() && isOfficeStaff()) || docId == 'draft_' + request.auth.uid )");
  });
  it('the non-privileged bs_quotes lists query by createdBy, so the own-quotes arm can satisfy them', () => {
    assert.match(read('js/screens/sales.js'), /db\.collection\('bs_quotes'\)\.where\('createdBy','==',currentUser\.uid\)/);
    assert.match(read('js/departments.js'), /db\.collection\('bs_quotes'\)\.where\('createdBy','==',currentUser\.uid\)/);
  });
  it('sales orders and job orders are untouched (production needs them)', () => {
    assert.doesNotMatch(block('match /sales_orders/{docId} {'), /isOfficeStaff/);
    assert.doesNotMatch(block('match /job_projects/{docId} {'), /isOfficeStaff/);
    assert.ok(RAW.includes('function isOfficeStaff()'));
  });
});
