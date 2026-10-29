// tests/rules-audit-deferred-2026-10-29.test.mjs — the rules-audit items the 2026-10-29 sweep deferred.
//
//   D1  quote_costs: any profile read/wrote every quote's cost basis — a commission Sales Agent
//       could read the internal costing of every quote. Agents now reach only their own sidecars.
//   D2  public_quotes: any profile could rewrite a client link and reset a recorded acceptance to
//       'pending'. Now only the quote's creator or an admin manages the link, and an update leaves
//       clientResponse/status/src exactly as they were (qrRespond is the one response writer).
//   D3  finance_rollup: a Production-department account could overwrite any open month's totals.
//       Finance tier only; Production's sync never worked anyway (its transaction reads first).
//   D4  storage Finance/*: any staffer could create objects in Taxes/Ledger/Records. Outside the
//       finance tier a new object lands only in SalesOrders/Collections/BudgetProofs.
//   D5  storage worker-id-photos: readable (and listable) by any signed-in identity, profile or not.
//
// Textual pins (no Java → no emulator), cross-checked against the client code they must agree with.
// Compile-checked with `firebase deploy --only firestore:rules,storage --dry-run`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const strip = (src) => src.replace(/\/\/[^\n]*/g, '');
const RULES = strip(read('firestore.rules'));
const STORAGE = strip(read('storage.rules'));
function block(src, head) {
  const at = src.indexOf(head);
  assert.ok(at >= 0, `block not found: ${head}`);
  const open = src.indexOf('{', at + head.length);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced');
}
const allow = (blk, verbs) => {
  const m = blk.match(new RegExp(`allow ${verbs}:([\\s\\S]*?);`));
  assert.ok(m, `no "allow ${verbs}" statement`);
  return m[1].replace(/\s+/g, ' ');
};
const jsFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(new URL('../' + dir, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(`${dir}/${e.name}`); }
      else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
    }
  };
  walk('js');
  return out;
};

describe('D1 quote_costs: a Sales Agent reaches only their own cost sidecars', () => {
  const blk = block(RULES, 'match /quote_costs/{id}');
  it('there is no blanket read/write statement any more', () => {
    assert.ok(!/allow read, write:/.test(blk), 'the any-profile read,write statement is back');
  });
  it('read and delete: an agent only where createdBy is them', () => {
    assert.match(allow(blk, 'read, delete'), /getRole\(\) != 'agent' \|\| resource\.data\.get\('createdBy', ''\) == request\.auth\.uid/);
  });
  it('create: an agent must stamp themselves as createdBy', () => {
    assert.match(allow(blk, 'create'), /getRole\(\) != 'agent' \|\| request\.resource\.data\.get\('createdBy', ''\) == request\.auth\.uid/);
  });
  it('update: an agent may neither take over nor give away a sidecar', () => {
    const u = allow(blk, 'update');
    assert.match(u, /resource\.data\.get\('createdBy', ''\) == request\.auth\.uid && request\.resource\.data\.get\('createdBy', ''\) == request\.auth\.uid/);
  });
  it('every profile arm still requires a profile', () => {
    for (const v of ['read, delete', 'create', 'update']) assert.match(allow(blk, v), /hasProfile\(\)/);
  });
  it('the QB bridge stamps createdBy: currentUser.uid on every sidecar it saves', () => {
    const app = read('js/app.js');
    const at = app.indexOf("collection('quote_costs').doc(coll + '_' + id).set(");
    assert.ok(at > 0, 'the sidecar save moved — update this test');
    assert.match(app.slice(at, at + 300), /createdBy: currentUser\.uid/);
  });
});

describe('D2 public_quotes: only the creator or an admin manages a client link; a response is never rewritten', () => {
  const blk = block(RULES, 'match /public_quotes/{token}');
  it('the "reset to pending" arm is gone: an update leaves clientResponse and status as recorded', () => {
    assert.ok(!/responseUntouchedOrReset/.test(blk), 'the reset arm is back');
    assert.match(blk, /function responseUntouched\(\) \{[\s\S]*?request\.resource\.data\.get\('clientResponse', \{\}\) == resource\.data\.get\('clientResponse', \{\}\)[\s\S]*?request\.resource\.data\.get\('status', ''\) == resource\.data\.get\('status', ''\)/);
    assert.match(allow(blk, 'update'), /responseUntouched\(\)/);
  });
  it('an update never re-points src', () => {
    assert.match(allow(blk, 'update'), /request\.resource\.data\.get\('src', \{\}\) == resource\.data\.get\('src', \{\}\)/);
  });
  it('create, update and delete: an admin or the source quote\'s creator — not any profile', () => {
    for (const v of ['create', 'update', 'delete']) {
      const e = allow(blk, v);
      assert.match(e, /\(hasProfile\(\) && isAdmin\(\)\) \|\| srcIsMine\(/, `${v}: ${e}`);
      assert.ok(!/\(hasProfile\(\) \|\|/.test(e), `${v} has an any-profile arm again: ${e}`);
    }
  });
  it('create still starts the response pending; the public get stays open and list closed', () => {
    assert.match(allow(blk, 'create'), /get\('clientResponse', \{\}\)\.get\('status', ''\) == 'pending'/);
    assert.match(blk, /allow get:\s+if true;/);
    assert.match(blk, /allow list:\s+if false;/);
  });
  it('the client agrees: resync preserves clientResponse, status and (via buildPublicQuoteDoc) src', () => {
    const sales = read('js/screens/sales.js');
    const at = sales.indexOf('window.resyncPublicQuoteMirror = async function');
    const body = sales.slice(at, sales.indexOf('\n};', at));
    assert.match(body, /fresh\.clientResponse = old\.clientResponse/);
    assert.match(body, /fresh\.status = old\.status/);
    assert.match(sales, /src: \{ coll: coll \|\| '', id: docId \|\| '' \}/);
  });
  it('no screen writes a public_quotes doc except share (create), resync (update) and revoke (delete)', () => {
    const writers = [];
    for (const f of jsFiles()) {
      const src = read(f);
      for (const m of src.matchAll(/collection\('public_quotes'\)\.doc\([^)]*\)\.(set|update|delete)\(/g)) writers.push(`${f}:${m[1]}`);
      for (const m of src.matchAll(/ref\.set\(fresh/g)) writers.push(`${f}:resync`);
    }
    assert.deepEqual(writers.sort(), ['js/screens/sales.js:delete', 'js/screens/sales.js:resync', 'js/screens/sales.js:set'].sort());
  });
});

describe('D3 finance_rollup: finance tier only', () => {
  const blk = block(RULES, 'match /finance_rollup/{docId}');
  it('create/update no longer has a Production arm', () => {
    const e = allow(blk, 'create, update');
    assert.match(e, /^\s*if isAuth\(\) && canFinance\(\) &&/);
    assert.ok(!/isProductionDept\(\)/.test(e), `the Production arm is back: ${e}`);
  });
  it('read stays finance tier (which is why Production\'s read-first sync could never commit)', () => {
    assert.match(allow(blk, 'read'), /isAuth\(\) && canFinance\(\)/);
    const ledger = read('js/finance-ledger.js');
    const at = ledger.indexOf('async function _syncRollup');
    assert.match(ledger.slice(at, at + 800), /tx\.get\(docRef\)/, '_syncRollup no longer reads first — re-check whether Production needs the write arm');
  });
});

describe('D4 storage Finance/*: outside the finance tier, new objects only in the operational subfolders', () => {
  const blk = block(STORAGE, 'match /Finance/{subfolder}/{fileName}');
  it('write requires the finance tier or an operational subfolder', () => {
    assert.match(allow(blk, 'write'), /\(isFinanceClaim\(\) \|\| financeOperationalSubfolder\(subfolder\)\)/);
  });
  it('the operational subfolders are exactly SalesOrders, Collections and BudgetProofs', () => {
    const fn = STORAGE.match(/function financeOperationalSubfolder\(sub\) \{([\s\S]*?)\}/)[1].replace(/\s+/g, ' ');
    assert.equal(fn.trim(), "return sub == 'SalesOrders' || sub == 'Collections' || sub == 'BudgetProofs';");
  });
  it('every upload into Finance/ from a screen outside Finance uses one of them', () => {
    // Finance's own screens (finance.js, payroll.js, the HR payslip proof) run as the finance tier.
    const FINANCE_SCREENS = new Set(['js/screens/finance.js', 'js/screens/payroll.js', 'js/screens/hr.js', 'js/screens/people.js']);
    const found = [];
    for (const f of jsFiles()) {
      if (FINANCE_SCREENS.has(f)) continue;
      const src = read(f);
      for (const m of src.matchAll(/dept: *'Finance', *subfolder: *'([A-Za-z]+)'/g)) found.push(m[1]);
      for (const m of src.matchAll(/uploadFile\([^,]+, *'Finance', *'([A-Za-z]+)'\)/g)) found.push(m[1]);
    }
    assert.ok(found.length >= 3, 'scan found too little — update the pattern');
    for (const sub of found) assert.ok(['SalesOrders', 'Collections', 'BudgetProofs'].includes(sub), `a non-Finance screen uploads to Finance/${sub}`);
  });
});

describe('D5 storage worker-id-photos: staff only, and only Finance lists', () => {
  const blk = block(STORAGE, 'match /worker-id-photos/{profileId}/{allPaths=**}');
  it('no bare signed-in read', () => {
    assert.ok(!/allow read:/.test(blk), 'a combined read (get+list) statement is back');
  });
  it('get needs a role claim; list needs the finance tier', () => {
    assert.match(allow(blk, 'get'), /isSignedIn\(\) && hasRoleClaim\(\)/);
    assert.match(allow(blk, 'list'), /hasRoleClaim\(\) && isFinanceClaim\(\)/);
  });
  it('nothing in the app lists the folder', () => {
    for (const f of jsFiles()) assert.ok(!/worker-id-photos[^\n]*\.(listAll|list)\(/.test(read(f)), `${f} lists worker-id-photos`);
  });
});
