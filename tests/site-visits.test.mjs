// tests/site-visits.test.mjs — Phase 5 site visits and their fee, the screens and their hooks (specs/SALES-FLOW-SPEC-2026-11-19.md §5.6 V1–V5, §9.10, §12, §13.2 Phase 5).
//
//   1. WIRING   sw.js precaches the screen on its own line; it is not an index.html script (lazy, CLAUDE.md "app-kit" rule); the hooks on the lead card, the quote card and the
//               Production page are small, guarded and lazy; the three new notification types are in the icon registry; the screen reads Firestore through the accessor
//               and never puts a peso in a Production notification.
//   2. V1       js/screens/site-visits.js runs for real in the shared Sales harness (in-memory Firestore, recorded toasts and notifications): Sales / the President request a
//               visit from a lead or a quote -> a money-free site_visits doc, status requested, an SV- number (a fallback number when the counter is down).
//   3. V2       the fee is a payment_claims doc (kind site_visit, pending, with clientId, proof required); the amount is the tariff and only the President changes it; the visit
//               goes to fee_pending; a sent-back fee is fixed and resent; the President confirms in one more tap.
//   4. V3       the existing claims queue confirms a site-visit fee: one PAY- row (no job), the visit becomes booked, Production is told (date, address, contact — no amount).
//   5. V4       Production's list of booked visits and the report -> status done; the screen reads site_visits only (never a payment); no peso anywhere.
//   6. CARDS    each visit under its lead / quote with its status and only the buttons that apply; Production sees none.
// Mutation-checked in a scratch copy (see the hand-back).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRES, SALES, FIN, PROD, makeBaseEnv, read, same } from './fixtures/sales-flow-harness.mjs';

const SW = read('sw.js'), HTML = read('index.html'), SALESJS = read('js/screens/sales.js'), DEPT = read('js/departments.js'), PRODSRC = read('js/screens/production.js');
const SV = read('js/screens/site-visits.js'), NOTIF = read('js/notifications.js'), PCUI = read('js/payment-claims-ui.js');

describe('1. wiring', () => {
  const precache = (() => { const m = SW.match(/const PRECACHE = \[([\s\S]*?)\n\];/); return [...m[1].matchAll(/^\s*'([^']+)',?\s*(?:\/\/.*)?$/gm)].map((x) => x[1]); })();
  it('sw.js precaches site-visits, next to the other flow screens, on its own line', () => {
    const at = ['/js/flow-core.js', '/js/screens/flow-docs.js', '/js/screens/site-visits.js'].map((f) => precache.indexOf(f));
    assert.ok(at.every((i) => i >= 0), String(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    assert.ok(SW.includes("\n  '/js/screens/site-visits.js',\n"));
  });
  it('it is LAZY: not an index.html script; it loads its own core on demand', () => {
    assert.doesNotMatch(HTML, /site-visits\.js/);
    assert.match(SV, /ensureScript\('js\/flow-core\.js'\)/);
    assert.match(SV, /ensureScript\('js\/payment-claims-core\.js'\)/);
  });
  it('the lead card and the quote card hooks are gated to Sales + the President, lazy, and guarded', () => {
    assert.match(SALESJS, /const canSiteVisit = typeof canEditDept === 'function' && canEditDept\('Sales'\) && currentRole !== 'secretary';/);
    assert.match(SALESJS, /\(canSiteVisit && !superseded && !\['lost','draft'\]\.includes\(q\.status\)\)\?`<button class="btn-secondary btn-sm bk-sv-btn"/);
    assert.match(SALESJS, /ensureScript\('js\/screens\/site-visits\.js'\)\.then\(\(\)=>window\.SiteVisits\.openRequestSheet\(\{ quote:/);
    assert.match(SALESJS, /<div class="sv-slot" data-quote-id="\$\{q\.id\}" style="width:100%"><\/div>/);
    assert.match(DEPT, /const canSiteVisit = brand === 'barro' && canEditDept\('Sales'\) && currentRole !== 'secretary';/);
    assert.match(DEPT, /\(canSiteVisit && isOpen\(cl\)\)\?`<button class="btn-secondary btn-sm cl-sv-btn"/);
    assert.match(DEPT, /<div class="sv-slot" data-client-id="\$\{cl\.id\}"><\/div>/);
    assert.match(DEPT, /e\.target\.closest\('\.cl-del-btn, \.cl-delreq-btn, \.cl-edit-btn, \.cl-sv-btn, \.sv-slot'\)/);
    assert.match(DEPT, /ensureScript\('js\/screens\/site-visits\.js'\)\.then\(\(\) => window\.SiteVisits\.openRequestSheet\(\{ client: cl \}/);
  });
  it('the Production page: one host div and one guarded lazy call; the screen is reached from the Orders list', () => {
    assert.equal((PRODSRC.match(/id="prod-sitevisits"/g) || []).length, 1);
    assert.match(PRODSRC, /try \{ const _svHost = el\.querySelector\('#prod-sitevisits'\); if \(_svHost\) window\.ensureScript\('js\/screens\/site-visits\.js'\)\.then\(\(\)=>window\.SiteVisits\.renderProductionList\(_svHost\)\)\.catch\(\(\)=>\{\}\); \} catch \(_\) \{\}/);
  });
  it('after a confirmed fee the claims screen calls site-visits (the Production notification is sent from site-visits.js, never from the claims screen)', () => {
    assert.match(PCUI, /if \(o\.kind === 'site_visit' && o\.siteVisitId\) \{ await window\.ensureScript\('js\/screens\/site-visits\.js'\); await window\.SiteVisits\.afterFeeConfirmed\(o\); \}/);
    assert.doesNotMatch(PCUI, /sendToDept\('Production'/);
  });
  it('the three new notification types are in the icon registry', () => {
    for (const t of ['site_visit_booked', 'change_request', 'change_order_signed']) assert.match(NOTIF, new RegExp(t + ':\\{icon'));
  });
  it('the screen reads Firestore through the accessor, escapes every dynamic value, and the Production notification carries no amount', () => {
    assert.match(SV, /const fsDb = function \(\) \{ return \(typeof db !== 'undefined' && db\) \|\| window\.db; \};/);
    assert.doesNotMatch(SV, /window\.db\s*\./);
    assert.doesNotMatch(SV, /innerHTML\s*=\s*[^;]*\$\{/);
    assert.doesNotMatch(SV, /toast\([^)]*<[a-z]/);
    const at = SV.indexOf("sendToDept('Production'");
    const call = SV.slice(at, SV.indexOf('fallbackToOwner', at));
    assert.ok(at > 0);
    assert.doesNotMatch(call, /₱|money\(|paymentReceived|recordedAmount|fee/i);
  });
  it('the Production list never reads a payment: no payment_claims query in renderProductionList', () => {
    const fn = SV.slice(SV.indexOf('async function renderProductionList'), SV.indexOf('async function fillSlots'));
    assert.ok(fn.length > 200);
    assert.doesNotMatch(fn, /payment_claims|change_orders/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
const client = (o = {}) => ({ name: 'Mamitas Bulaluhan', company: 'Mamitas Food Corp.', address: '12 Aurora Blvd., Quezon City', phone: '0917 123 4567', stage: 'lead', ...o });
const visit = (o = {}) => ({ svNumber: 'SV-0009', clientId: 'c1', clientName: 'Mamitas Bulaluhan', company: 'BK', quoteId: null, quoteColl: null, quoteNumber: '', area: 'near', requestedDate: '2026-11-25', visitDate: '2026-11-25',
  address: '12 Aurora Blvd., Quezon City', contactPerson: 'Maria Santos', contactPhone: '0917 123 4567', notes: '', status: 'requested', feeClaimId: null, report: null, requestedBy: 'u-sales', requestedByName: 'Uriel',
  requestedAt: { seconds: 20, toDate: () => new Date(20000) }, ...o });
const fee = (o = {}) => ({ kind: 'site_visit', orderId: null, projectId: null, quoteNumber: '', clientId: 'c1', clientName: 'Mamitas Bulaluhan', company: 'BK', siteVisitId: 'sv1', changeOrderId: null, area: 'near', svNumber: 'SV-0009',
  paymentReceived: 2500, paymentMethod: 'GCash', vatTreatment: 'inclusive', orRef: 'GC-1', paymentDate: '2026-11-21', receiptUrl: 'https://r.example/p.pdf', receiptName: 'p.pdf', status: 'pending',
  paymentConfirm: { requestedAt: '2026-11-21T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', decision: null, resubmits: 0 }, createdBy: 'u-sales', createdByName: 'Uriel', createdAt: { seconds: 10, toDate: () => new Date(10000) }, ...o });

function makeForms() {
  const f = { counter: 0, numbers: [], fail: false };
  f.nextNumber = async (s) => { if (f.fail) throw new Error('counter down'); f.counter++; const n = `${s}-${String(f.counter).padStart(4, '0')}`; f.numbers.push(n); return n; };
  f.buttonHtml = (id, ref, o) => `<button type="button" data-form="${id}" data-ref='${JSON.stringify(ref)}'>${(o && o.label) || id}</button>`;
  f.bind = () => {};
  return f;
}
function env(who, { visits = {}, claims = {}, clients = { c1: client() }, seed = {}, ...opts } = {}) {
  const forms = makeForms();
  const e = makeBaseEnv(who, { seed: { site_visits: visits, payment_claims: claims, clients, ...seed }, forms, ...opts });
  const c = e.ctx;
  c.canEditDept = (d) => who.role === 'president' || (who.depts || []).includes(d);
  c.flowForms = () => c.ensureScript('js/forms.js').then(() => c.Forms);
  c.Clients = { findByName: async (n) => { for (const [id, d] of e.db.store.clients || []) if (d.name === n) return { id, ...d }; return null; } };
  for (const f of ['js/flow-core.js', 'js/payment-claims-core.js', 'js/payment-claims-ui.js', 'js/screens/flow-docs.js', 'js/screens/site-visits.js']) e.load(read(f), f);
  e.SV = c.SiteVisits;
  e.fakeForms = forms;
  e.visit = (id = 'sv1') => e.db.store.site_visits.get(id);
  e.visits = () => [...(e.db.store.site_visits || new Map()).entries()];
  e.claims = () => [...(e.db.store.payment_claims || new Map()).entries()];
  e.ledger = () => [...(e.db.store.ledger || new Map()).entries()];
  return e;
}
const fillRequest = (p, o = {}) => {
  const v = { area: 'near', date: '2026-11-25', address: '12 Aurora Blvd., Quezon City', person: 'Maria Santos', phone: '0917 123 4567', notes: '', ...o };
  p.$('sv-area').value = v.area; p.$('sv-date').value = v.date; p.$('sv-address').value = v.address; p.$('sv-person').value = v.person; p.$('sv-phone').value = v.phone; p.$('sv-notes').value = v.notes;
};
const request = async (e, arg, o) => { await e.SV.openRequestSheet(arg || { client: { id: 'c1', ...client() } }); const p = e.lastPage(); fillRequest(p, o); await p.$('sv-save').click(); return p; };

describe('2. V1 — request a visit', () => {
  it('Sales requests a visit from a lead: a money-free site_visits doc, status requested, SV- number, requestedBy / At, the client carried', async () => {
    const e = env(SALES);
    await request(e);
    assert.equal(e.visits().length, 1, e.toastMsgs().join('|'));
    const v = e.visits()[0][1];
    assert.equal(v.status, 'requested'); assert.equal(v.svNumber, 'SV-0001'); assert.equal(v.area, 'near'); assert.equal(v.requestedDate, '2026-11-25'); assert.equal(v.visitDate, '2026-11-25');
    assert.equal(v.address, '12 Aurora Blvd., Quezon City'); assert.equal(v.contactPerson, 'Maria Santos'); assert.equal(v.contactPhone, '0917 123 4567');
    assert.equal(v.clientId, 'c1'); assert.equal(v.clientName, 'Mamitas Bulaluhan'); assert.equal(v.company, 'BK'); assert.equal(v.feeClaimId, null); assert.equal(v.report, null);
    assert.equal(v.requestedBy, 'u-sales'); assert.equal(v.requestedByName, 'Uriel'); assert.ok(v.requestedAt && v.updatedAt);
    for (const k of ['fee', 'amount', 'paymentReceived', 'recordedAmount']) assert.ok(!(k in v), `no ${k} on a site visit (the rules refuse it)`);
    assert.match(JSON.stringify(v), /^((?!₱).)*$/);
    assert.equal(e.fakeForms.numbers[0], 'SV-0001');
    assert.match(e.toastMsgs().join('|'), /SV-0001 requested/);
    assert.equal(e.ledger().length, 0, 'no money');
  });
  it('the tariff is shown on every area option (₱1,000 / ₱2,500 / ₱5,000)', async () => {
    const e = env(SALES);
    await e.SV.openRequestSheet({ client: { id: 'c1', ...client() } });
    const html = e.lastPage().html;
    for (const want of ['Metro Manila — ₱1,000.00', 'Nearby provinces — ₱2,500.00', 'Far Luzon — ₱5,000.00']) assert.ok(html.includes(want), want);
  });
  it('from a quote: the quote\'s id, collection, number and client travel with the visit; the company follows the quote', async () => {
    const e = env(SALES);
    await request(e, { quote: { id: 'q1', coll: 'bk_quotes', quoteNumber: 'BKMLFB260730-001R1', clientId: 'c1', clientName: 'Mamitas Bulaluhan', company: 'BI', clientAddress: '1 Road', clientPhone: '0917 000 0000' } });
    const v = e.visits()[0][1];
    assert.equal(v.quoteId, 'q1'); assert.equal(v.quoteColl, 'bk_quotes'); assert.equal(v.quoteNumber, 'BKMLFB260730-001R1'); assert.equal(v.clientId, 'c1'); assert.equal(v.company, 'BI');
  });
  it('a quote with no client link: the client is found by name, so the fee can be credited to the job later (V5)', async () => {
    const e = env(SALES);
    await request(e, { quote: { id: 'q1', coll: 'bk_quotes', quoteNumber: 'BK-1', clientName: 'Mamitas Bulaluhan' } });
    assert.equal(e.visits()[0][1].clientId, 'c1');
  });
  it('the counter is down: the visit is still saved, with SV- + the last six characters of its id', async () => {
    const e = env(SALES); e.fakeForms.fail = true;
    await request(e);
    const [id, v] = e.visits()[0];
    assert.equal(v.svNumber, 'SV-' + id.slice(-6).toUpperCase());
  });
  it('a missing area, a past or missing date, no address, no contact, a short phone — each is refused in plain words and nothing is written', async () => {
    const e = env(SALES);
    for (const [o, re] of [[{ area: '' }, /area/], [{ date: '' }, /date/], [{ date: '2026-11-01' }, /past/], [{ address: '' }, /address/], [{ person: '' }, /contact/], [{ phone: '12' }, /phone/]]) {
      const p = await request(e, undefined, o);
      assert.match(p.$('sv-err').textContent, re);
    }
    assert.equal(e.visits().length, 0);
  });
  it('a price typed into the notes is refused (the visit is money-free)', async () => {
    const e = env(SALES);
    const p = await request(e, undefined, { notes: 'client will pay ₱5,000 on the day' });
    assert.equal(e.visits().length, 0); assert.match(p.$('sv-err').textContent, /Prices do not go in here/);
  });
  it('who may request: Sales and the President; not Production, not Finance, not a secretary', async () => {
    for (const who of [SALES, PRES]) { const e = env(who); await e.SV.openRequestSheet({ client: { id: 'c1', ...client() } }); assert.equal(e.pages.length, 1, who.name); }
    for (const who of [PROD, FIN, { role: 'secretary', depts: ['Sales'], uid: 'u-sec', name: 'Sec' }]) {
      const e = env(who); await e.SV.openRequestSheet({ client: { id: 'c1', ...client() } });
      assert.equal(e.pages.length, 0, who.name); assert.match(e.toastMsgs().join('|'), /Only Sales or the President/);
    }
  });
  it('a double tap saves one visit', async () => {
    const e = env(SALES);
    await e.SV.openRequestSheet({ client: { id: 'c1', ...client() } });
    const p = e.lastPage(); fillRequest(p);
    await Promise.all([p.$('sv-save').click(), p.$('sv-save').click()]);
    assert.equal(e.visits().length, 1);
  });
});

const tapFee = async (e, id = 'sv1', { amount, receipt = true, vat, method, ref = 'GC-1', visitDate } = {}) => {
  await e.SV.openFeeSheet({ id });
  const p = e.lastPage();
  assert.ok(p && p.$('svf-save'), 'the fee sheet opened: ' + e.toastMsgs().join('|'));
  if (amount !== undefined) p.$('svf-amount').value = String(amount);
  if (vat) p.$('svf-vat').value = vat;
  if (method) p.$('svf-method').value = method;
  if (visitDate) p.$('svf-visit').value = visitDate;
  p.$('svf-ref').value = ref;
  if (receipt) e.uploads['svf-upload'].cb({ url: 'https://r.example/proof.pdf', name: 'proof.pdf' });
  await p.$('svf-save').click();
  return p;
};

describe('3. V2 — record the fee', () => {
  it('writes a pending payment_claims doc: kind site_visit, the tariff, clientId, siteVisitId, area, proof; the visit goes to fee_pending with feeClaimId', async () => {
    const e = env(SALES, { visits: { sv1: visit() } });
    await tapFee(e);
    assert.equal(e.claims().length, 1, e.toastMsgs().join('|'));
    const [id, c] = e.claims()[0];
    assert.equal(c.kind, 'site_visit'); assert.equal(c.status, 'pending'); assert.equal(c.paymentReceived, 2500); assert.equal(c.vatTreatment, 'inclusive');
    assert.equal(c.clientId, 'c1'); assert.equal(c.clientName, 'Mamitas Bulaluhan'); assert.equal(c.siteVisitId, 'sv1'); assert.equal(c.area, 'near'); assert.equal(c.svNumber, 'SV-0009');
    assert.equal(c.orderId, null); assert.equal(c.projectId, null); assert.equal(c.changeOrderId, null);
    assert.equal(c.receiptUrl, 'https://r.example/proof.pdf'); assert.equal(c.paymentMethod, 'Bank Transfer'); assert.equal(c.orRef, 'GC-1');
    assert.equal(c.createdBy, 'u-sales'); assert.equal(c.createdByName, 'Uriel'); assert.ok(c.createdAt && c.updatedAt);
    assert.equal(c.paymentConfirm.decision, null); assert.equal(c.paymentConfirm.resubmits, 0); assert.equal(c.paymentConfirm.requestedBy, 'u-sales');
    for (const k of ['recordedAmount', 'recordedAt', 'recordedBy', 'paNumber']) assert.ok(!(k in c), `a pending claim has no ${k}`);
    const v = e.visit();
    assert.equal(v.status, 'fee_pending'); assert.equal(v.feeClaimId, id);
    for (const k of ['fee', 'amount', 'paymentReceived', 'recordedAmount']) assert.ok(!(k in v), `the visit still holds no ${k}`);
    assert.equal(e.ledger().length, 0, 'recording writes no money');
  });
  it('the President and Finance are told (QF\'s rows); Production is NOT', async () => {
    const e = env(SALES, { visits: { sv1: visit() } });
    await tapFee(e);
    const id = e.claims()[0][0];
    assert.ok(e.notifs.some((n) => n.kind === 'owner' && n.type === 'payment_confirm' && n.dedupKey === `payconf-claim-${id}-0` && /Fee to confirm/.test(n.title)), 'Neil is told');
    assert.ok(e.notifs.some((n) => n.kind === 'dept' && n.dept === 'Finance'), 'Finance gets the FYI');
    assert.ok(!e.notifs.some((n) => n.dept === 'Production'));
  });
  it('the amount is the tariff: Sales cannot type another (the field is read-only and the save refuses), the President can', async () => {
    const e = env(SALES, { visits: { sv1: visit() } });
    await e.SV.openFeeSheet({ id: 'sv1' });
    assert.match(e.lastPage().html, /id="svf-amount"[^>]*readonly/);
    assert.match(e.lastPage().html, /Only the President can change it/);
    const p = await tapFee(e, 'sv1', { amount: 1 });
    assert.equal(e.claims().length, 0); assert.match(p.$('svf-err').textContent, /fixed|Only the President/);
    const e2 = env(PRES, { visits: { sv1: visit() } });
    await e2.SV.openFeeSheet({ id: 'sv1' });
    assert.doesNotMatch(e2.lastPage().html, /id="svf-amount"[^>]*readonly/);
    await tapFee(e2, 'sv1', { amount: 2000 });
    assert.equal(e2.claims()[0][1].paymentReceived, 2000);
  });
  it('the tariff follows the area: 1,000 for Metro Manila, 5,000 for far Luzon', async () => {
    for (const [area, amt] of [['mm', 1000], ['far', 5000]]) {
      const e = env(SALES, { visits: { sv1: visit({ area }) } });
      await e.SV.openFeeSheet({ id: 'sv1' });
      assert.equal(e.lastPage().$('svf-amount').value, String(amt), area);
      await tapFee(e);
      assert.equal(e.claims()[0][1].paymentReceived, amt, area);
    }
  });
  it('proof is REQUIRED; the VAT split is shown; the visit date can be set here', async () => {
    const e = env(SALES, { visits: { sv1: visit() } });
    const p = await tapFee(e, 'sv1', { receipt: false });
    assert.equal(e.claims().length, 0); assert.match(p.$('svf-err').textContent, /receipt or proof/i);
    assert.equal(p.$('svf-rec').textContent, '₱2,500.00');
    const e2 = env(SALES, { visits: { sv1: visit() } });
    await tapFee(e2, 'sv1', { visitDate: '2026-11-27' });
    assert.equal(e2.visit().visitDate, '2026-11-27');
  });
  it('only a requested visit takes a fee: a fee already waiting, a booked, done or cancelled visit is refused with nothing written', async () => {
    for (const [status, re] of [['fee_pending', /already waiting/], ['booked', /booked/i], ['done', /done/i], ['cancelled', /cancelled/i]]) {
      const e = env(SALES, { visits: { sv1: visit({ status }) } });
      await e.SV.openFeeSheet({ id: 'sv1' });
      assert.equal(e.pages.length, 0, status); assert.match(e.toastMsgs().join('|'), re, status);
    }
  });
  it('who may record: Sales and the President; not Production', async () => {
    const e = env(PROD, { visits: { sv1: visit() } });
    await e.SV.openFeeSheet({ id: 'sv1' });
    assert.equal(e.pages.length, 0); assert.match(e.toastMsgs().join('|'), /Only Sales or the President/);
  });
  it('a sent-back fee is fixed and resent: the same claim goes back to pending with resubmits + 1, the visit stays fee_pending; nothing else is created', async () => {
    const e = env(SALES, { visits: { sv1: visit({ status: 'fee_pending', feeClaimId: 'cl1' }) }, claims: { cl1: fee({ status: 'payment_rejected', paymentConfirm: { decision: 'rejected', reason: 'the reference does not match', decidedByName: 'Neil Barro', resubmits: 0 } }) } });
    await e.SV.openFeeSheet({ id: 'sv1' });
    const p = e.lastPage();
    assert.match(p.html, /Sent back by Neil Barro: the reference does not match/); assert.match(p.title, /Fix fee/);
    p.$('svf-ref').value = 'GC-FIXED';
    await p.$('svf-save').click();
    assert.equal(e.claims().length, 1);
    const c = e.claims()[0][1];
    assert.equal(c.status, 'pending'); assert.equal(c.orRef, 'GC-FIXED'); assert.equal(c.paymentConfirm.resubmits, 1); assert.equal(c.paymentConfirm.prevReason, 'the reference does not match'); assert.equal(c.paymentConfirm.decision, null);
    assert.equal(e.visit().status, 'fee_pending');
    assert.ok(e.notifs.some((n) => n.kind === 'owner' && n.dedupKey === 'payconf-claim-cl1-1'), 'told again, with the next dedup key');
    assert.equal(c.receiptUrl, 'https://r.example/p.pdf', 'the old proof stays unless replaced');
  });
  it('the President who records the fee lands on the confirm sheet, REPLACING the record page (one more tap)', async () => {
    const e = env(PRES, { visits: { sv1: visit() } });
    await tapFee(e);
    const p = e.lastPage();
    assert.ok(p.$('pcc-confirm'), 'the confirm sheet is the last page');
    assert.equal(p.opts && p.opts.replace, true);
    assert.equal(e.ledger().length, 0, 'still nothing posted until he taps');
  });
  it('two taps at the same instant record one fee', async () => {
    const e = env(SALES, { visits: { sv1: visit() } });
    await e.SV.openFeeSheet({ id: 'sv1' });
    const p = e.lastPage(); p.$('svf-ref').value = 'X'; e.uploads['svf-upload'].cb({ url: 'https://r.example/p.pdf', name: 'p.pdf' });
    await Promise.all([p.$('svf-save').click(), p.$('svf-save').click()]);
    assert.equal(e.claims().length, 1);
  });
});

const confirmFee = async (e, id = 'cl1') => { await e.ctx.PaymentClaimsUI.openConfirmSheet({ id }); const p = e.lastPage(); assert.ok(p && p.$('pcc-confirm'), 'the confirm sheet opened: ' + e.toastMsgs().join('|')); await p.$('pcc-confirm').click(); return p; };
const pendingWorld = (o = {}) => ({ visits: { sv1: visit({ status: 'fee_pending', feeClaimId: 'cl1' }) }, claims: { cl1: fee() }, ...o });

describe('4. V3 — the existing claims queue confirms a site-visit fee', () => {
  it('the President confirms: ONE PAY- ledger row with no job, the claim recorded with a PA number, the visit BOOKED', async () => {
    const e = env(PRES, pendingWorld());
    await confirmFee(e);
    assert.equal(e.ledger().length, 1, e.toastMsgs().join('|'));
    const [id, row] = e.ledger()[0];
    assert.equal(id, 'PAY-cl1'); assert.equal(row.amount, 2500); assert.equal(row.type, 'credit'); assert.equal(row.source, 'Sales'); assert.equal(row.projectId, null);
    const c = e.db.store.payment_claims.get('cl1');
    assert.equal(c.status, 'recorded'); assert.equal(c.recordedAmount, 2500); assert.equal(c.paNumber, 'PA-0001'); assert.equal(c.paymentConfirm.decision, 'confirmed');
    const v = e.visit();
    assert.equal(v.status, 'booked'); assert.equal(v.feeClaimId, 'cl1'); assert.ok(v.bookedAt);
    assert.equal(e.db.store.job_projects, undefined, 'no job is read or written for a fee');
  });
  it('Production is told once: date, address, contact — and NO amount, no ₱, no fee word', async () => {
    const e = env(PRES, pendingWorld());
    await confirmFee(e);
    const n = e.notifs.filter((x) => x.kind === 'dept' && x.dept === 'Production');
    assert.equal(n.length, 1);
    assert.equal(n[0].type, 'site_visit_booked'); assert.equal(n[0].dedupKey, 'svbook-sv1'); assert.equal(n[0].link, 'dept:Production'); same(n[0].opts, { fallbackToOwner: true });
    assert.match(n[0].body, /^Mamitas Bulaluhan — Nov 25, 2026, 12 Aurora Blvd\., Quezon City\. Contact Maria Santos 0917 123 4567\.$/);
    assert.doesNotMatch(n[0].title + n[0].body, /₱|2,?500|fee|paid|amount/i);
  });
  it('a Finance login confirms as stand-in: the visit is booked too, and Neil is told it was a stand-in', async () => {
    const e = env(FIN, pendingWorld());
    await confirmFee(e);
    assert.equal(e.visit().status, 'booked');
    assert.ok(e.notifs.some((n) => n.kind === 'owner' && /confirmed by Shaira/.test(n.title)));
    assert.equal(e.db.store.payment_claims.get('cl1').paymentConfirm.onBehalf, true);
  });
  it('a visit cancelled in the meantime is NOT booked (the money still posts — it was received); no Production notification', async () => {
    const e = env(PRES, { visits: { sv1: visit({ status: 'cancelled', feeClaimId: 'cl1' }) }, claims: { cl1: fee() } });
    await confirmFee(e);
    assert.equal(e.ledger().length, 1);
    assert.equal(e.visit().status, 'cancelled');
    assert.ok(!e.notifs.some((n) => n.dept === 'Production'));
  });
  it('a visit already booked or done is left alone and Production is not told twice', async () => {
    for (const status of ['booked', 'done']) {
      const e = env(PRES, { visits: { sv1: visit({ status, feeClaimId: 'cl1' }) }, claims: { cl1: fee() } });
      await confirmFee(e);
      assert.equal(e.visit().status, status); assert.ok(!e.notifs.some((n) => n.dept === 'Production'), status);
    }
  });
  it('a fee that is sent back books nothing; the visit stays fee_pending and the sales person is told why', async () => {
    const e = env(PRES, pendingWorld());
    await e.ctx.PaymentClaimsUI.openConfirmSheet({ id: 'cl1' });
    await e.lastPage().$('pcc-reject').click();
    assert.equal(e.db.store.payment_claims.get('cl1').status, 'payment_rejected');
    assert.equal(e.visit().status, 'fee_pending'); assert.equal(e.ledger().length, 0);
    assert.ok(e.notifs.some((n) => n.kind === 'send' && n.to === 'u-sales' && n.type === 'payment_rejected'));
  });
  it('the decision block names a fee by its site visit number', async () => {
    const e = env(PRES, pendingWorld());
    const host = { innerHTML: '', querySelectorAll: () => [] };
    await e.ctx.PaymentClaimsUI.renderDecisionBlock(host, {});
    assert.match(host.innerHTML, /Mamitas Bulaluhan — SV-0009/); assert.match(host.innerHTML, /Site-visit fee/);
  });
  it('the fee credits the first balance claim later: its claim carries clientId and loadFees finds it (V5 interim path)', async () => {
    const e = env(SALES, { visits: { sv1: visit() } });
    await tapFee(e);
    const c = e.claims()[0][1];
    assert.equal(c.clientId, 'c1', 'loadFees(clientId) can find it once it is recorded');
  });
});

describe('5. V4 — Production: booked visits and the report', () => {
  const host = () => ({ innerHTML: '', _q: {}, querySelectorAll(sel) { const m = /^\.(sv-[a-z]+)$/.exec(sel); return m && this._btns ? this._btns : []; }, querySelector: () => null });
  it('lists booked visits only, soonest first, with the contact and address; nothing else (not requested, fee_pending, done, cancelled)', async () => {
    const e = env(PROD, { visits: { a: visit({ status: 'booked', visitDate: '2026-12-02', svNumber: 'SV-0002' }), b: visit({ status: 'booked', visitDate: '2026-11-26', svNumber: 'SV-0001' }), c: visit({ status: 'requested', svNumber: 'SV-0003' }),
      d: visit({ status: 'fee_pending', svNumber: 'SV-0004' }), f: visit({ status: 'done', svNumber: 'SV-0005' }), g: visit({ status: 'cancelled', svNumber: 'SV-0006' }) } });
    const h = host();
    await e.SV.renderProductionList(h);
    assert.ok(h.innerHTML.indexOf('SV-0001') > 0 && h.innerHTML.indexOf('SV-0001') < h.innerHTML.indexOf('SV-0002'), 'soonest first');
    for (const no of ['SV-0003', 'SV-0004', 'SV-0006']) assert.ok(!h.innerHTML.includes(no), no);
    for (const want of ['Maria Santos 0917 123 4567', '12 Aurora Blvd., Quezon City', 'Write site visit report', 'Site visits to do']) assert.ok(h.innerHTML.includes(want), want);
    const todo = h.innerHTML.slice(0, h.innerHTML.indexOf('<details'));
    assert.ok(!todo.includes('SV-0005'), 'a done visit is not "to do"');
    assert.ok(h.innerHTML.slice(h.innerHTML.indexOf('<details')).includes('SV-0005'), 'but its report is listed below, collapsed');
  });
  it('the last reports written are listed (newest first, ten at most) with the report form; a done visit has no "Write site visit report" button', async () => {
    const visits = {};
    for (let i = 1; i <= 12; i++) visits['d' + i] = visit({ status: 'done', svNumber: 'SV-' + String(i).padStart(4, '0'), visitDate: '2026-11-' + String(i).padStart(2, '0') });
    const e = env(PROD, { visits });
    const h = host();
    await e.SV.renderProductionList(h);
    assert.equal((h.innerHTML.match(/class="item-card sv-done"/g) || []).length, 10);
    assert.ok(h.innerHTML.indexOf('SV-0012') < h.innerHTML.indexOf('SV-0003'), 'newest first'); assert.ok(!h.innerHTML.includes('SV-0001<') && !h.innerHTML.includes('SV-0002'));
    assert.match(h.innerHTML, /Site visit reports written \(10\)/); assert.match(h.innerHTML, /data-form="site_visit_report"/);
    assert.doesNotMatch(h.innerHTML, /Write site visit report|Site visits to do/);
    assert.doesNotMatch(h.innerHTML, /₱|fee|amount/i);
  });
  it('shows nothing when no visit is booked, and never reads payments or change orders (a Production login cannot)', async () => {
    const e = env(PROD, { visits: { c: visit({ status: 'requested' }) } });
    const h = host(); h.innerHTML = 'stale';
    await e.SV.renderProductionList(h);
    assert.equal(h.innerHTML, '');
    const reads = e.db.log.filter((l) => l.op === 'query').map((l) => l.path);
    assert.deepEqual([...new Set(reads)], ['site_visits']);
  });
  it('no peso, no fee and no price anywhere on the Production list', async () => {
    const e = env(PROD, { visits: { a: visit({ status: 'booked', feeClaimId: 'cl1' }) }, claims: { cl1: fee({ status: 'recorded', recordedAmount: 2500 }) } });
    const h = host();
    await e.SV.renderProductionList(h);
    assert.ok(h.innerHTML.length > 100); assert.doesNotMatch(h.innerHTML, /₱|2,?500|fee|amount|paid/i);
    assert.ok(!e.db.log.some((l) => l.op === 'query' && l.path === 'payment_claims'));
  });
  const writeReport = async (e, o = {}) => {
    await e.SV.openReportSheet({ id: 'sv1' });
    const p = e.lastPage();
    assert.ok(p && p.$('svr-save'), 'the report sheet opened: ' + e.toastMsgs().join('|'));
    p.$('svr-measure').value = o.measure ?? 'Wall A 3,200 mm'; p.$('svr-constraints').value = o.constraints ?? 'Gas line on the east wall'; p.$('svr-layout').value = o.layout ?? 'Hood on wall A';
    return p;
  };
  it('Rene writes the report: measurements, constraints, layout notes, photos, files, by, byName, at — and the visit is DONE', async () => {
    const e = env(PROD, { visits: { sv1: visit({ status: 'booked' }) } });
    const p = await writeReport(e);
    e.uploads['svr-photos'].cb({ url: 'https://x.test/1.jpg', name: '1.jpg' }); e.uploads['svr-photos'].cb({ url: 'https://x.test/2.jpg', name: '2.jpg' }); e.uploads['svr-files'].cb({ url: 'https://x.test/sketch.pdf', name: 'sketch.pdf' });
    await p.$('svr-save').click();
    const v = e.visit();
    assert.equal(v.status, 'done'); assert.equal(v.report.measurements, 'Wall A 3,200 mm'); assert.equal(v.report.constraints, 'Gas line on the east wall'); assert.equal(v.report.layoutNotes, 'Hood on wall A');
    assert.deepEqual(v.report.photos.map((x) => x.name), ['1.jpg', '2.jpg']); assert.deepEqual(v.report.attachments, [{ url: 'https://x.test/sketch.pdf', name: 'sketch.pdf' }]);
    assert.equal(v.report.by, 'u-prod'); assert.equal(v.report.byName, 'Rene'); assert.ok(v.report.at);
    for (const k of ['fee', 'amount', 'paymentReceived', 'recordedAmount']) assert.ok(!(k in v), `no ${k} on the visit`);
    assert.doesNotMatch(JSON.stringify(v), /₱/);
    assert.match(e.toastMsgs().join('|'), /report saved/);
  });
  it('needs measurements, constraints or layout notes; a price in any of them is refused; nothing is written', async () => {
    const e = env(PROD, { visits: { sv1: visit({ status: 'booked' }) } });
    let p = await writeReport(e, { measure: '', constraints: '', layout: '' });
    await p.$('svr-save').click();
    assert.match(p.$('svr-err').textContent, /measurements/); assert.equal(e.visit().status, 'booked');
    p = await writeReport(e, { constraints: 'Needs a ₱5,000 permit' });
    await p.$('svr-save').click();
    assert.match(p.$('svr-err').textContent, /Prices do not go in here/); assert.equal(e.visit().status, 'booked'); assert.equal(e.visit().report, null);
  });
  it('only a booked visit takes a report; a double tap writes it once', async () => {
    for (const status of ['requested', 'fee_pending', 'done', 'cancelled']) {
      const e = env(PROD, { visits: { sv1: visit({ status }) } });
      await e.SV.openReportSheet({ id: 'sv1' });
      assert.equal(e.pages.length, 0, status);
    }
    const e = env(PROD, { visits: { sv1: visit({ status: 'booked' }) } });
    const p = await writeReport(e);
    await Promise.all([p.$('svr-save').click(), p.$('svr-save').click()]);
    assert.equal(e.db.writes('site_visits/sv1').filter((w) => w.op === 'update' && w.patch.report).length, 1);
  });
  it('the blank paper form is offered beside Save (for the site itself)', async () => {
    const e = env(PROD, { visits: { sv1: visit({ status: 'booked' }) } });
    await writeReport(e);
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(e.lastPage().html.includes('id="svr-forms"'));
  });
  it('a secretary cannot write a report', async () => {
    const e = env({ role: 'secretary', depts: ['Production'], uid: 'u-sec', name: 'Sec' }, { visits: { sv1: visit({ status: 'booked' }) } });
    await e.SV.openReportSheet({ id: 'sv1' });
    assert.equal(e.pages.length, 0);
  });
});

describe('6. cancel, and the visits on each lead / quote card', () => {
  const slotHost = (attrs) => {
    const slot = { dataset: attrs, innerHTML: '', _clicks: {}, querySelectorAll(sel) { return []; }, querySelector: () => null };
    const root = { querySelectorAll: (sel) => (sel === '.sv-slot' ? [slot] : []), slot };
    return root;
  };
  it('Sales cancels a requested or fee_pending visit after a confirmation; a booked or done one cannot be cancelled; a declined confirmation changes nothing', async () => {
    for (const status of ['requested', 'fee_pending']) {
      const e = env(SALES, { visits: { sv1: visit({ status }) } });
      assert.equal(await e.SV.cancelVisit({ id: 'sv1' }), true);
      const v = e.visit(); assert.equal(v.status, 'cancelled'); assert.equal(v.cancelledBy, 'u-sales'); assert.ok(v.cancelledAt);
      assert.equal(e.dialogs.length, 1);
      if (status === 'fee_pending') assert.match(e.dialogs[0].message, /ask the President to send that payment back/);
    }
    for (const status of ['booked', 'done', 'cancelled']) {
      const e = env(SALES, { visits: { sv1: visit({ status }) } });
      assert.equal(await e.SV.cancelVisit({ id: 'sv1' }), false);
      assert.equal(e.visit().status, status);
    }
    const no = env(SALES, { visits: { sv1: visit() }, confirmAnswer: false });
    assert.equal(await no.SV.cancelVisit({ id: 'sv1' }), false); assert.equal(no.visit().status, 'requested');
    const prod = env(PROD, { visits: { sv1: visit() } });
    assert.equal(await prod.SV.cancelVisit({ id: 'sv1' }), false); assert.equal(prod.visit().status, 'requested');
  });
  it('a lead card lists its visits with their status; the buttons follow the status (Record fee + Cancel on requested; Cancel only while the fee waits; none once booked)', async () => {
    const e = env(SALES, { visits: { a: visit({ status: 'requested', svNumber: 'SV-0001' }), b: visit({ status: 'fee_pending', svNumber: 'SV-0002', feeClaimId: 'cl1' }), c: visit({ status: 'booked', svNumber: 'SV-0003' }),
      d: visit({ status: 'done', svNumber: 'SV-0004' }), x: visit({ status: 'cancelled', svNumber: 'SV-0005' }), o: visit({ status: 'requested', svNumber: 'SV-0006', clientId: 'someone-else' }) }, claims: { cl1: fee({ siteVisitId: 'b' }) } });
    const root = slotHost({ clientId: 'c1' });
    await e.SV.fillSlots(root);
    const html = root.slot.innerHTML;
    const lineOf = (no) => { const at = html.indexOf(no); const lines = html.split('<div class="sv-line"'); return lines.find((l) => l.includes(no)) || ''; };
    assert.ok(!html.includes('SV-0005') && !html.includes('SV-0006'), 'cancelled and other clients\' visits are not shown');
    assert.match(lineOf('SV-0001'), /Requested/); assert.match(lineOf('SV-0001'), /sv-fee/); assert.match(lineOf('SV-0001'), /sv-cancel/);
    assert.match(lineOf('SV-0002'), /Fee waiting for confirmation/); assert.doesNotMatch(lineOf('SV-0002'), /sv-fee/); assert.match(lineOf('SV-0002'), /sv-cancel/);
    assert.match(lineOf('SV-0003'), /Booked/); assert.doesNotMatch(lineOf('SV-0003'), /sv-fee|sv-cancel/);
    assert.match(lineOf('SV-0004'), /Done/); assert.match(lineOf('SV-0004'), /data-form="site_visit_report"/); assert.match(lineOf('SV-0004'), /data-form="site_visit_request"/);
    assert.match(lineOf('SV-0001'), /Nearby provinces/); assert.match(lineOf('SV-0001'), /Nov 25, 2026/);
    assert.match(lineOf('SV-0001'), /data-form="site_visit_request"/); assert.match(lineOf('SV-0001'), /"docId":"a"/);
  });
  it('a quote card lists only the visits of THAT quote', async () => {
    const e = env(SALES, { visits: { a: visit({ quoteId: 'q1', svNumber: 'SV-0001' }), b: visit({ quoteId: 'q2', svNumber: 'SV-0002' }), c: visit({ quoteId: null, svNumber: 'SV-0003' }) } });
    const root = slotHost({ quoteId: 'q1' });
    await e.SV.fillSlots(root);
    assert.ok(root.slot.innerHTML.includes('SV-0001') && !root.slot.innerHTML.includes('SV-0002') && !root.slot.innerHTML.includes('SV-0003'));
  });
  it('a fee that was sent back shows its reason and a "Fix fee & resend" button', async () => {
    const e = env(SALES, { visits: { b: visit({ status: 'fee_pending', svNumber: 'SV-0002', feeClaimId: 'cl1' }) }, claims: { cl1: fee({ siteVisitId: 'b', status: 'payment_rejected', paymentConfirm: { decision: 'rejected', reason: 'wrong amount' } }) } });
    const root = slotHost({ clientId: 'c1' });
    await e.SV.fillSlots(root);
    assert.match(root.slot.innerHTML, /Fee sent back/); assert.match(root.slot.innerHTML, /wrong amount/); assert.match(root.slot.innerHTML, /Fix fee &amp; resend/);
  });
  it('a Production login sees no action button on a card (and the visit list is the same read of site_visits only)', async () => {
    const e = env(PROD, { visits: { a: visit({ status: 'requested', svNumber: 'SV-0001' }) } });
    const root = slotHost({ clientId: 'c1' });
    await e.SV.fillSlots(root);
    assert.ok(root.slot.innerHTML.includes('SV-0001')); assert.doesNotMatch(root.slot.innerHTML, /sv-fee|sv-cancel/);
  });
  it('a Production login never reads a payment, even for a visit waiting on its fee: the card shows the status, not the fee claim', async () => {
    const e = env(PROD, { visits: { b: visit({ status: 'fee_pending', svNumber: 'SV-0002', feeClaimId: 'cl1' }) }, claims: { cl1: fee({ siteVisitId: 'b', status: 'payment_rejected', paymentConfirm: { reason: 'wrong amount' } }) } });
    const root = slotHost({ clientId: 'c1' });
    await e.SV.fillSlots(root);
    assert.ok(root.slot.innerHTML.includes('SV-0002') && root.slot.innerHTML.includes('Fee waiting for confirmation'));
    assert.doesNotMatch(root.slot.innerHTML, /wrong amount|Fee sent back/);
    assert.deepEqual(e.queried ? e.queried() : [...new Set(e.db.log.filter((l) => l.op === 'query').map((l) => l.path))], ['site_visits']);
    assert.ok(!e.db.log.some((l) => l.path && l.path.startsWith('payment_claims')), 'no payment_claims read of any kind');
    const sales = env(SALES, { visits: { b: visit({ status: 'fee_pending', svNumber: 'SV-0002', feeClaimId: 'cl1' }) }, claims: { cl1: fee({ siteVisitId: 'b', status: 'payment_rejected', paymentConfirm: { reason: 'wrong amount' } }) } });
    const r2 = slotHost({ clientId: 'c1' }); await sales.SV.fillSlots(r2);
    assert.match(r2.slot.innerHTML, /Fee sent back/);
  });
  it('a failed read leaves the slot alone (silent), and a page with no slot reads nothing', async () => {
    const e = env(SALES);
    await e.SV.fillSlots({ querySelectorAll: () => [] });
    assert.equal(e.db.log.filter((l) => l.op === 'query').length, 0);
    e.ctx.db.collection = () => { throw new Error('offline'); };
    const root = slotHost({ clientId: 'c1' }); root.slot.innerHTML = 'before';
    await e.SV.fillSlots(root);
    assert.equal(root.slot.innerHTML, 'before');
  });
});

describe('7. V5 — the fee is credited on the later payment: a payments entry, no second ledger row (Phase 5 acceptance)', () => {
  const orderDoc = { projectId: 'prj1', quoteId: 'q1', quoteNumber: 'BK-1', soNumber: 'SO-0012', clientId: 'c1', clientName: 'Mamitas Bulaluhan', company: 'BK', contractAmount: 100000, paymentReceived: 65000, recordedAmount: 65000, vatTreatment: 'inclusive', status: 'recorded', flowVersion: 2, createdBy: 'u-sales', createdByName: 'Uriel' };
  const jobDoc = { projectNo: 'JP-1', salesOrderId: 'so1', clientId: 'c1', clientName: 'Mamitas Bulaluhan', stage: 'in_production', contractAmount: 100000, amountCollected: 65000, arBalance: 35000, flowVersion: 2, payments: [{ amount: 65000, date: '2026-11-18' }], documents: [], timeline: [] };
  it('request -> fee -> confirmed -> the job is won -> the balance claim: the fee comes off the balance due, is credited as a payments entry, and the ledger holds ONE row per money received (the fee once, the balance once)', async () => {
    const e = env(PRES, { visits: { sv1: visit({ area: 'mm' }) }, seed: { sales_orders: { so1: orderDoc }, job_projects: { prj1: jobDoc } } });
    // the fee, through the real sheets: recorded, then confirmed in the same sitting (the President)
    await e.SV.openFeeSheet({ id: 'sv1' });
    let p = e.lastPage(); p.$('svf-ref').value = 'GC-1'; e.uploads['svf-upload'].cb({ url: 'https://r.example/f.pdf', name: 'f.pdf' }); await p.$('svf-save').click();
    await e.lastPage().$('pcc-confirm').click();
    const feeId = e.claims()[0][0];
    assert.equal(e.db.store.payment_claims.get(feeId).status, 'recorded'); assert.equal(e.db.store.payment_claims.get(feeId).recordedAmount, 1000);
    assert.deepEqual(e.ledger().map((x) => x[0]), ['PAY-' + feeId]);
    assert.equal(e.db.store.job_projects.get('prj1').amountCollected, 65000, 'the fee is not on the job yet: it had no job');
    // later: the balance. The sheet shows what is left after the fee
    await e.ctx.PaymentClaimsUI.openRecordSheet({ orderId: 'so1' });
    p = e.lastPage();
    assert.match(p.html, /Balance due ₱34,000\.00/);
    p.$('pr-amount').value = '34000'; p.$('pr-ref').value = 'BT-9'; e.uploads['pr-upload'].cb({ url: 'https://r.example/b.pdf', name: 'b.pdf' });
    await p.$('pr-save').click();
    const balId = e.claims().map((x) => x[0]).find((id) => id !== feeId);
    await e.lastPage().$('pcc-confirm').click();
    const job = e.db.store.job_projects.get('prj1');
    assert.equal(job.amountCollected, 100000); assert.equal(job.arBalance, 0);
    const credited = job.payments.filter((x) => x.claimId === feeId);
    assert.equal(credited.length, 1); assert.equal(credited[0].type, 'Site-visit fee (credited)'); assert.equal(credited[0].amount, 1000); assert.equal(credited[0].ledgerId, 'PAY-' + feeId);
    assert.deepEqual(e.ledger().map((x) => x[0]).sort(), ['PAY-' + balId, 'PAY-' + feeId].sort(), 'no third row for the credit');
    assert.equal(e.ledger().reduce((s, x) => s + x[1].amount, 0), 35000, 'the books hold 1,000 + 34,000: the fee once');
  });
});
