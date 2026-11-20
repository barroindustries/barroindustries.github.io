// tests/sales-quick-fixes-rules.test.mjs — WP0 of specs/SALES-QUICK-FIXES-SPEC-2026-11-19.md
// (§8 rules, §14.4 amended block, §14.6 test list). Sales may record and fix a payment and hand the job
// off, but can never write a money total, confirm a payment, or hand off before the President confirms.
//
//   • sales_orders create must start 'pending'.
//   • soSalesUpdate(): payment fields until confirmed, hand-off fields after — never money totals; the only
//     status move it allows is payment_rejected -> pending (a resubmit); it cannot write a decision.
//     Coordinator add-on (2026-11-19): the form numbers soNumber / paNumber are hand-off keys (the form engine
//     numbers a document from a Sales session at Generate), so they need status == 'recorded' like the rest.
//   • soDecisionOk() / soSelfConfirmOk() (owner ruling F2): a decision carries the decider's own uid, and
//     only the President confirms a flow-2 order he or she created. Both sit in FRONT of every update arm.
//   • job_projects: contractAmount joins the finance-tier money keys (nothing client-side updates it).
//
// Textual pins (no Java -> no emulator), same block() helper as tests/rules-sweep-2026-10-29.test.mjs.
// Compile-checked with `firebase deploy --only firestore:rules --dry-run` by the coordinator before `release.sh rules`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const RULES = read('firestore.rules').replace(/\/\/[^\n]*/g, '');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
function block(head) {
  const at = RULES.indexOf(head);
  assert.ok(at >= 0, `block not found: ${head}`);
  const open = RULES.indexOf('{', at + head.length);
  let depth = 0;
  for (let i = open; i < RULES.length; i++) {
    if (RULES[i] === '{') depth++;
    else if (RULES[i] === '}' && --depth === 0) return RULES.slice(at, i + 1);
  }
  throw new Error('unbalanced');
}
const keysIn = (s) => [...s.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);

const SO = block('match /sales_orders/{docId}');
const JP = block('match /job_projects/{docId}');
const fn = (name) => block(`function ${name}()`);
// the text between a function's outer braces (starts at `return`)
const body = (name) => { const t = fn(name); return norm(t.slice(t.indexOf('{') + 1, t.lastIndexOf('}'))); };
const SALES = fn('soSalesUpdate');
const UPDATE = SO.match(/allow update:([\s\S]*?);\s*allow delete/)[1];

// The full Sales allow-list: soPayKeys() + soHandoffKeys() + the literal list concatenated in soSalesUpdate().
function salesAllowList() {
  const hasOnly = SALES.slice(SALES.indexOf('.hasOnly('));
  const clause = hasOnly.slice(0, hasOnly.indexOf('&&'));
  assert.match(norm(clause), /soPayKeys\(\)\.concat\(soHandoffKeys\(\)\)\s*\.concat\(\[/, 'the Sales allow-list must be built from soPayKeys + soHandoffKeys + a literal list');
  return new Set([...keysIn(fn('soPayKeys')), ...keysIn(fn('soHandoffKeys')), ...keysIn(clause)]);
}

describe('WP0 sales_orders create', () => {
  it('create requires createdBy == the caller AND a pending status', () => {
    const create = norm(SO.match(/allow create:([\s\S]*?);/)[1]);
    assert.match(create, /^if isAuth\(\) && request\.resource\.data\.createdBy == request\.auth\.uid && request\.resource\.data\.get\('status', 'pending'\) == 'pending'$/);
  });
  it('read and delete are unchanged (any staff with a profile reads; only the President deletes)', () => {
    assert.match(norm(SO), /allow read: if isAuth\(\) && \( resource\.data\.createdBy == request\.auth\.uid \|\| hasProfile\(\) \);/);
    assert.match(norm(SO), /allow delete: if isAuth\(\) && isPresident\(\);/);
  });
});

describe('WP0 sales_orders update arms', () => {
  it('soSalesUpdate exists and is OR-ed into the update rule', () => {
    assert.match(norm(UPDATE), /\|\| soSalesUpdate\(\) (\|\| soRevisionRequest\(\) )?\)$/); // F3 (flow spec §11.2) OR-s its revision-request arm after it
  });
  it('the decision and self-confirm guards are AND-ed in front of all three arms', () => {
    assert.ok(norm(UPDATE).startsWith('if isAuth() && soDecisionOk() && soSelfConfirmOk() && ('), 'pin text: soDecisionOk() && soSelfConfirmOk() && (');
  });
  it('canFinance() is still the first update arm', () => {
    assert.ok(norm(UPDATE).startsWith('if isAuth() && soDecisionOk() && soSelfConfirmOk() && ( canFinance() ||'));
  });
  it('the Design branch still lists exactly its nine keys', () => {
    const design = UPDATE.slice(UPDATE.indexOf('canDesign()'), UPDATE.indexOf('soSalesUpdate()'));
    const keys = keysIn(design.slice(design.indexOf('.hasOnly(')));
    assert.deepEqual(keys.slice().sort(), ['designDoneAt', 'designDoneBy', 'noDrawingsNeeded', 'notes', 'priority', 'sentToProduction', 'sentToProductionAt', 'targetDate', 'updatedAt'].sort());
    assert.equal(keys.length, 9);
  });
  it('arms appear in the documented order: Finance, Design, Sales', () => {
    const t = norm(UPDATE);
    assert.ok(t.indexOf('canFinance()') < t.indexOf('canDesign()') && t.indexOf('canDesign()') < t.indexOf('soSalesUpdate()'));
  });
});

describe('WP0 the Sales branch (soSalesUpdate)', () => {
  const MONEY_AND_IDENTITY = ['contractAmount', 'recordedAmount', 'recordedAt', 'recordedBy', 'bankAccountId', 'bankAccountName',
    'items', 'createdBy', 'createdByName', 'createdAt', 'flowVersion', 'projectId', 'quoteId', 'quoteNumber', 'clientName', 'clientId', 'company',
    'rootQuoteId', 'autoRecorded', 'noDrawingsNeeded'];
  it('its allow-list contains no money total, no recorded* field and no identity field', () => {
    const allow = salesAllowList();
    for (const k of MONEY_AND_IDENTITY) assert.ok(!allow.has(k), `Sales could write ${k}`);
  });
  it('its allow-list is exactly the payment fields, the hand-off fields and six order fields', () => {
    assert.deepEqual([...salesAllowList()].sort(), [
      'designDoneAt', 'designDoneBy', 'designProjectId', 'handoffDrawing', 'notes', 'orRef', 'paymentConfirm', 'paymentDate',
      'paymentMethod', 'paymentReceived', 'priority', 'receiptName', 'receiptUrl', 'releasedAt', 'releasedBy', 'releasedByName',
      'paNumber', 'sentToDesign', 'sentToDesignAt', 'sentToProduction', 'sentToProductionAt', 'soNumber', 'status', 'targetDate', 'trackingToken', 'updatedAt', 'vatTreatment',
    ].sort());
  });
  it('reserved flow-spec names are not writable by Sales (§14.3.1) — except the two form numbers the coordinator opened', () => {
    const allow = salesAllowList();
    for (const k of ['contractRev', 'originalContractAmount', 'pendingRevision', 'revisions', 'joNumber']) {
      assert.ok(!allow.has(k), `reserved name ${k} is writable by Sales`);
    }
  });
  it('soNumber and paNumber are hand-off keys, so Sales can write them only after the payment is confirmed', () => {
    const handoff = keysIn(fn('soHandoffKeys'));
    assert.ok(handoff.includes('soNumber') && handoff.includes('paNumber'));
    const payKeys = keysIn(fn('soPayKeys'));
    assert.ok(!payKeys.includes('soNumber') && !payKeys.includes('paNumber'), 'a form number must not ride the payment keys (those freeze at confirmation)');
  });
  it('the only status move it allows is payment_rejected -> pending (or no change)', () => {
    assert.ok(norm(SALES).includes("( request.resource.data.get('status','') == resource.data.get('status','') || (resource.data.get('status','') == 'payment_rejected' && request.resource.data.get('status','') == 'pending') )"));
    // no other status literal is ever compared against the NEW status
    const newStatusLiterals = [...norm(SALES).matchAll(/request\.resource\.data\.get\('status',''\) == '([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(newStatusLiterals, ['pending']);
  });
  it('Sales can never write a payment decision (paymentConfirm.decision must stay null)', () => {
    assert.ok(norm(SALES).includes("( !soDiff().hasAny(['paymentConfirm']) || request.resource.data.paymentConfirm.get('decision', null) == null )"));
  });
  it('payment fields freeze once the order is recorded', () => {
    assert.ok(norm(SALES).includes("( !soDiff().hasAny(soPayKeys()) || resource.data.get('status','') != 'recorded' )"));
  });
  it('hand-off fields need resource.status == recorded', () => {
    assert.ok(norm(SALES).includes("( !soDiff().hasAny(soHandoffKeys()) || resource.data.get('status','') == 'recorded' )"));
  });
  it('limited to the creator or a Sales-department member, never the Corporate Secretary', () => {
    assert.ok(body('soSalesUpdate').startsWith('return hasProfile() && !isSecretary() && (resource.data.createdBy == request.auth.uid || inDept(\'Sales\'))'));
  });
  it('payment fields and hand-off fields are the documented sets', () => {
    assert.deepEqual(keysIn(fn('soPayKeys')).sort(), ['orRef', 'paymentConfirm', 'paymentDate', 'paymentMethod', 'paymentReceived', 'receiptName', 'receiptUrl', 'vatTreatment']);
    assert.deepEqual(keysIn(fn('soHandoffKeys')).sort(), ['designDoneAt', 'designDoneBy', 'designProjectId', 'handoffDrawing', 'paNumber', 'releasedAt', 'releasedBy', 'releasedByName', 'sentToDesign', 'sentToDesignAt', 'sentToProduction', 'sentToProductionAt', 'soNumber']);
  });
});

describe('WP0 owner ruling F2 — who may decide', () => {
  it('soDecisionOk and soSelfConfirmOk exist', () => {
    assert.ok(fn('soDecisionOk') && fn('soSelfConfirmOk'));
  });
  it('soDecisionOk: a decision carries the caller\'s own uid in decidedBy', () => {
    const t = norm(fn('soDecisionOk'));
    assert.match(t, /request\.resource\.data\.paymentConfirm\.get\('decidedBy', ''\) == request\.auth\.uid/);
    assert.match(t, /!soDiff\(\)\.hasAny\(\['paymentConfirm'\]\)/);
    assert.match(t, /request\.resource\.data\.paymentConfirm\.get\('decision', null\) == null/);
  });
  it('soSelfConfirmOk: only the President confirms a flow-2 order he or she created', () => {
    const t = norm(fn('soSelfConfirmOk'));
    assert.match(t, /resource\.data\.get\('flowVersion', 0\) == 2/);
    assert.match(t, /resource\.data\.get\('status',''\) != 'recorded'/);
    assert.match(t, /request\.resource\.data\.get\('status',''\) == 'recorded'/);
    assert.match(t, /isPresident\(\)/);
    assert.match(t, /resource\.data\.createdBy != request\.auth\.uid/);
  });
  it('a pre-flow-2 order (no flowVersion) is never blocked by the self-confirm guard', () => {
    // the whole "recorded transition" conjunction starts with flowVersion == 2, and is negated
    assert.match(body('soSelfConfirmOk'), /^return !\( resource\.data\.get\('flowVersion', 0\) == 2 &&/);
  });
});

describe('WP0 job_projects money keys', () => {
  it('contractAmount joins the finance-tier money keys', () => {
    const upd = JP.match(/allow update:([\s\S]*?);/)[1];
    const keys = keysIn(upd.slice(upd.indexOf('hasAny(')));
    for (const k of ['payments', 'amountCollected', 'arBalance', 'invoices', 'dpPercent', 'balanceSchedule', 'contractAmount']) {
      assert.ok(keys.includes(k), `${k} missing from the job_projects money list`);
    }
    assert.match(norm(upd), /\|\| canFinance\(\) \)( && paidOk\(\))?$/);
  });
  it('the other job_projects rules are untouched (read, create, delete)', () => {
    const t = norm(JP);
    assert.match(t, /allow read: if isAuth\(\) && \(resource\.data\.createdBy == request\.auth\.uid \|\| hasProfile\(\)\);/);
    assert.match(t, /allow create: if isAuth\(\) && request\.resource\.data\.createdBy == request\.auth\.uid;/);
    assert.match(t, /allow delete: if isAuth\(\) && isAdmin\(\);/);
  });
  it('no client code updates job_projects.contractAmount (the rule would deny a non-finance writer)', () => {
    // every `.update({ ... contractAmount ...})` against job_projects must be absent from the client; creates are fine
    const files = ['js/departments.js', 'js/screens/production.js', 'js/screens/sales.js', 'js/screens/design.js', 'js/screens/dashboards.js', 'js/app.js'];
    for (const f of files) {
      const src = read(f);
      const hits = [...src.matchAll(/collection\('job_projects'\)\.doc\([^)]*\)\.update\(\{([^}]*)\}/g)].filter((m) => /\bcontractAmount\b/.test(m[1]));
      assert.equal(hits.length, 0, `${f} updates job_projects.contractAmount`);
    }
  });
});
