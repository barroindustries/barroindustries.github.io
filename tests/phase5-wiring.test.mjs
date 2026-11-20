// tests/phase5-wiring.test.mjs — Phase 5 (site visits and change orders), the seams between the screens, the forms and the rules
// (specs/SALES-FLOW-SPEC-2026-11-19.md §5.6, §5.7, §9.2, §11.1, §13.2 Phase 5).
//
//   1. FILES     the three new lazy files are precached in order, none is an index.html script, every script they load exists and is precached; the forms never use the letterhead engine.
//   2. RULES     every doc and patch the screens write to site_visits / change_requests is checked against the key lists parsed from the REAL firestore.rules (the rules refuse a fee key on
//                a visit and a price key on a request): the code and the rules cannot drift apart without a test failing.
//   3. THE WALL  a full run of both flows with a Production login standing by: Production's notifications carry no peso and no amount; the documents Production can read hold none.
// Mutation-checked in a scratch copy (see the hand-back).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PRES, SALES, PROD, makeBaseEnv, read, ROOT } from './fixtures/sales-flow-harness.mjs';

const SW = read('sw.js'), HTML = read('index.html');
const precache = (() => { const m = SW.match(/const PRECACHE = \[([\s\S]*?)\n\];/); return [...m[1].matchAll(/^\s*'([^']+)',?\s*(?:\/\/.*)?$/gm)].map((x) => x[1]); })();

describe('1. files', () => {
  it('forms-set-5, site-visits and change-orders are precached, each on its own line, in the order the hook parses (after forms-set-2 / flow-docs)', () => {
    const at = ['/js/forms-set-2.js', '/js/forms-set-5.js', '/js/price-gate-core.js'].map((f) => precache.indexOf(f));
    assert.ok(at.every((i) => i >= 0), String(at)); assert.deepEqual([...at].sort((a, b) => a - b), at);
    const at2 = ['/js/flow-core.js', '/js/screens/flow-docs.js', '/js/screens/site-visits.js', '/js/screens/change-orders.js'].map((f) => precache.indexOf(f));
    assert.ok(at2.every((i) => i >= 0), String(at2)); assert.deepEqual([...at2].sort((a, b) => a - b), at2);
    for (const f of ['/js/forms-set-5.js', '/js/screens/site-visits.js', '/js/screens/change-orders.js']) assert.ok(SW.includes(`\n  '${f}',\n`), f);
    assert.equal(precache.length, new Set(precache).size, 'no duplicate precache entries');
  });
  it('none of the three is an index.html script (CLAUDE.md "app-kit" rule): they load through ensureScript', () => {
    for (const f of ['forms-set-5', 'site-visits', 'change-orders']) assert.doesNotMatch(HTML, new RegExp(f + '\\.js'), f);
  });
  it('every script the new files load exists on disk and is precached; the forms files never use the letterhead engine', () => {
    for (const f of ['js/screens/site-visits.js', 'js/screens/change-orders.js', 'js/forms-set-5.js']) {
      const src = read(f);
      for (const m of src.matchAll(/ensureScript\('(js\/[^']+)'\)/g)) {
        assert.ok(fs.existsSync(path.join(ROOT, m[1])), `${f} loads ${m[1]}, which does not exist`);
        assert.ok(precache.includes('/' + m[1]), `${f} loads ${m[1]}, which is not in sw.js PRECACHE`);
      }
      assert.doesNotMatch(src, /buildLetterhead\s*\(|window\.Letterhead|ensureScript\([^)]*letterhead/i, f);
    }
    for (const m of read('js/forms-core.js').matchAll(/FLOWCORE = '([^']+)'/g)) assert.ok(precache.includes('/' + m[1]));
  });
  it('the new files stay small (a screen file is under 600 lines)', () => {
    for (const f of ['js/screens/site-visits.js', 'js/screens/change-orders.js', 'js/forms-set-5.js']) assert.ok(read(f).split('\n').length < 600, f);
  });
});

// ── the REAL key lists, parsed from firestore.rules ─────────────────────────────────────────────────────────────────────────────
const RULES = read('firestore.rules').replace(/\/\/[^\n]*/g, '');
const forbidden = (coll) => {
  const at = RULES.indexOf(`match /${coll}/{id}`);
  assert.ok(at >= 0, coll);
  const m = /hasAny\(\[([^\]]*)\]\)/.exec(RULES.slice(at, at + 900));
  assert.ok(m, `${coll}: no hasAny([...]) key list in its rules`);
  return [...m[1].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]);
};
const FORBID_VISIT = forbidden('site_visits'), FORBID_REQUEST = forbidden('change_requests');

const visit = (o = {}) => ({ svNumber: 'SV-0009', clientId: 'c1', clientName: 'Mamitas', company: 'BK', area: 'near', requestedDate: '2026-11-25', visitDate: '2026-11-25', address: '12 Aurora', contactPerson: 'Maria', contactPhone: '0917 123 4567', notes: '', status: 'requested', feeClaimId: null, report: null, requestedBy: 'u-sales', requestedByName: 'Uriel', ...o });
const request = (o = {}) => ({ projectId: 'prj1', joNumber: 'JO-1', clientName: 'Acme', details: 'Client wants a shelf', itemsAdded: [{ name: 'Shelf', qty: 2, unit: 'pc' }], itemsRemoved: [], effectOnDeadlineDays: 0, photos: [], status: 'requested', coNumber: null, requestedBy: 'u-prod', requestedByName: 'Rene', ...o });
function world(who, seed) {
  const forms = { n: 0, nextNumber: async (s) => `${s}-${String(++forms.n).padStart(4, '0')}`, buttonHtml: () => '', bind() {} };
  const e = makeBaseEnv(who, { forms, seed });
  const c = e.ctx;
  c.canEditDept = (d) => who.role === 'president' || (who.depts || []).includes(d);
  c.flowForms = () => c.ensureScript('js/forms.js').then(() => c.Forms);
  c.Clients = { findByName: async () => null };
  for (const f of ['js/flow-core.js', 'js/payment-claims-core.js', 'js/payment-claims-ui.js', 'js/price-gate-core.js', 'js/contract-core.js', 'js/contract-ui.js', 'js/screens/flow-docs.js', 'js/screens/site-visits.js', 'js/screens/change-orders.js']) e.load(read(f), f);
  return e;
}
// every write to a collection: the patch / data keys, and the final doc
const writesTo = (e, coll) => e.db.log.filter((l) => l.op !== 'query' && l.path.startsWith(coll + '/'));
const check = (e, coll, bad) => {
  for (const w of writesTo(e, coll)) for (const k of Object.keys(w.data || w.patch || {})) assert.ok(!bad.includes(k), `${coll}: ${w.op} wrote the refused key "${k}"`);
  for (const [id, d] of (e.db.store[coll] || new Map())) for (const k of Object.keys(d)) assert.ok(!bad.includes(k), `${coll}/${id} holds the refused key "${k}"`);
};


describe('2. the screens write nothing the rules refuse', () => {
  it('the parsed lists are the ones the spec names (so the parse itself is trusted)', () => {
    assert.deepEqual(FORBID_VISIT.sort(), ['amount', 'fee', 'paymentReceived', 'recordedAmount']);
    assert.deepEqual(FORBID_REQUEST.sort(), ['addedDownPayment', 'amount', 'price', 'pricing', 'unitPrice']);
  });

  it('site_visits: request, fee, confirmation (booked), report, cancel — no fee / amount / paymentReceived / recordedAmount key on the doc or in any patch', async () => {
    const e = world(PRES, { site_visits: {}, payment_claims: {}, clients: { c1: { name: 'Mamitas', address: '12 Aurora', phone: '0917' } } });
    await e.ctx.SiteVisits.openRequestSheet({ client: { id: 'c1', name: 'Mamitas', address: '12 Aurora', phone: '0917 123 4567' } });
    let p = e.lastPage(); p.$('sv-area').value = 'near'; p.$('sv-date').value = '2026-11-25'; p.$('sv-address').value = '12 Aurora'; p.$('sv-person').value = 'Maria'; p.$('sv-phone').value = '0917 123 4567'; await p.$('sv-save').click();
    const id = [...e.db.store.site_visits.keys()][0];
    await e.ctx.SiteVisits.openFeeSheet({ id });
    p = e.lastPage(); p.$('svf-ref').value = 'R'; e.uploads['svf-upload'].cb({ url: 'https://r/p.pdf', name: 'p.pdf' }); await p.$('svf-save').click();
    const cid = [...e.db.store.payment_claims.keys()][0];
    await e.ctx.PaymentClaimsUI.openConfirmSheet({ id: cid }); await e.lastPage().$('pcc-confirm').click();
    assert.equal(e.db.store.site_visits.get(id).status, 'booked');
    await e.ctx.SiteVisits.openReportSheet({ id });
    p = e.lastPage(); p.$('svr-measure').value = '3 m'; await p.$('svr-save').click();
    assert.equal(e.db.store.site_visits.get(id).status, 'done');
    const e2 = world(SALES, { site_visits: { a: visit() } });
    await e2.ctx.SiteVisits.cancelVisit({ id: 'a' });
    assert.equal(e2.db.store.site_visits.get('a').status, 'cancelled');
    check(e, 'site_visits', FORBID_VISIT); check(e2, 'site_visits', FORBID_VISIT);
    assert.ok(writesTo(e, 'site_visits').length >= 4, 'the flow really wrote');
  });

  it('change_requests: record, price, sign, decline, apply — no pricing / price / unitPrice / amount / addedDownPayment key on the doc or in any patch', async () => {
    const order = { projectId: 'prj1', quoteId: 'q1', quoteNumber: 'BK-1', soNumber: 'SO-1', clientId: 'c1', clientName: 'Acme', company: 'BK', contractAmount: 100000, status: 'recorded', flowVersion: 2, createdBy: 'u-sales', createdByName: 'Uriel' };
    const project = { projectNo: 'JP-1', joNumber: 'JO-1', salesOrderId: 'so1', clientName: 'Acme', stage: 'in_production', contractAmount: 100000, amountCollected: 65000, arBalance: 35000, flowVersion: 2, items: [{ name: 'T', qty: 1 }], documents: [], timeline: [], payments: [] };
    const e = world(PRES, { sales_orders: { so1: order }, job_projects: { prj1: project }, change_requests: {}, change_orders: {}, payment_claims: {}, bk_quotes: { q1: { quoteNumber: 'BK-1', total: 100000, rootQuoteId: 'q1', approvalStatus: 'approved', approvedBy: 'u-pres', items: [] } } });
    await e.ctx.ChangeOrders.openRequestSheet({ id: 'prj1', ...project });
    let p = e.lastPage(); p.$('cr-details').value = 'Client wants a shelf'; p.$('cr-add-name-0').value = 'Shelf'; p.$('cr-add-qty-0').value = '2'; await p.$('cr-save').click();
    const id = [...e.db.store.change_requests.keys()][0];
    await e.ctx.ChangeOrders.openPriceSheet({ id });
    p = e.lastPage(); p.$('cp-price-0').value = '5000'; p.$('cp-dp').value = '0'; await p.$('cp-save').click();
    await e.ctx.ChangeOrders.openSignSheet({ id });
    p = e.lastPage(); e.uploads['cs-upload'].cb({ url: 'https://x/s.pdf', name: 's.pdf' }); p.$('cs-client').value = 'Maria'; p.$('cs-date').value = '2026-11-21'; await p.$('cs-save').click();
    await e.ctx.ContractUI.openReviseSheet({ id: 'so1' });
    p = e.lastPage(); await p.check('rv-choice', 'change_order'); p.$('rv-reason').value = 'Signed change order'; await p.$('rv-send').click();
    await e.ctx.ContractUI.applyRevision({ id: 'so1', ...e.db.store.sales_orders.get('so1') }, () => {});
    assert.equal(e.db.store.change_requests.get(id).status, 'applied');
    const e2 = world(SALES, { sales_orders: { so1: order }, job_projects: { prj1: project }, change_requests: { c2: request() }, change_orders: {} });
    e2.promptAnswer = 'The client dropped it';
    await e2.ctx.ChangeOrders.declineRequest({ id: 'c2' });
    assert.equal(e2.db.store.change_requests.get('c2').status, 'declined');
    check(e, 'change_requests', FORBID_REQUEST); check(e2, 'change_requests', FORBID_REQUEST);
    assert.ok(writesTo(e, 'change_requests').length >= 4, 'the flow really wrote');
    // and the pesos DID land where they belong: on change_orders, which Production cannot read
    assert.equal(e.db.store.change_orders.get(id).pricing.price, 10000);
  });
});

describe('3. nothing priced reaches Production', () => {
  it('through a whole site visit and a whole change order, every notification to Production and every doc it can read is free of pesos', async () => {
    const order = { projectId: 'prj1', quoteId: 'q1', quoteNumber: 'BK-1', soNumber: 'SO-1', clientId: 'c1', clientName: 'Acme', company: 'BK', contractAmount: 100000, status: 'recorded', flowVersion: 2, createdBy: 'u-sales', createdByName: 'Uriel' };
    const project = { projectNo: 'JP-1', joNumber: 'JO-1', salesOrderId: 'so1', clientName: 'Acme', stage: 'in_production', contractAmount: 100000, amountCollected: 65000, arBalance: 35000, flowVersion: 2, items: [{ name: 'T', qty: 1 }], documents: [], timeline: [], payments: [] };
    const seed = { sales_orders: { so1: order }, job_projects: { prj1: project }, change_requests: {}, change_orders: {}, payment_claims: {}, site_visits: {}, clients: { c1: { name: 'Acme', address: '1 Road', phone: '0917 123 4567' } } };
    const e = world(PRES, seed);
    // site visit
    await e.ctx.SiteVisits.openRequestSheet({ client: { id: 'c1', name: 'Acme', address: '1 Road', phone: '0917 123 4567' } });
    let p = e.lastPage(); p.$('sv-area').value = 'far'; p.$('sv-date').value = '2026-11-25'; p.$('sv-address').value = '1 Road'; p.$('sv-person').value = 'Maria'; p.$('sv-phone').value = '0917 123 4567'; await p.$('sv-save').click();
    const vid = [...e.db.store.site_visits.keys()][0];
    await e.ctx.SiteVisits.openFeeSheet({ id: vid }); p = e.lastPage(); p.$('svf-ref').value = 'R'; e.uploads['svf-upload'].cb({ url: 'https://r/p.pdf', name: 'p.pdf' }); await p.$('svf-save').click();
    const cid = [...e.db.store.payment_claims.keys()][0];
    await e.ctx.PaymentClaimsUI.openConfirmSheet({ id: cid }); await e.lastPage().$('pcc-confirm').click();
    await e.ctx.SiteVisits.openReportSheet({ id: vid }); p = e.lastPage(); p.$('svr-measure').value = '3 m'; await p.$('svr-save').click();
    // change order
    await e.ctx.ChangeOrders.openRequestSheet({ id: 'prj1', ...project });
    p = e.lastPage(); p.$('cr-details').value = 'Client wants a shelf'; p.$('cr-add-name-0').value = 'Shelf'; p.$('cr-add-qty-0').value = '2'; await p.$('cr-save').click();
    const rid = [...e.db.store.change_requests.keys()][0];
    await e.ctx.ChangeOrders.openPriceSheet({ id: rid }); p = e.lastPage(); p.$('cp-price-0').value = '12345'; p.$('cp-dp').value = '5000'; await p.$('cp-save').click();
    await e.ctx.ChangeOrders.openSignSheet({ id: rid }); p = e.lastPage(); e.uploads['cs-upload'].cb({ url: 'https://x/s.pdf', name: 's.pdf' }); p.$('cs-client').value = 'Maria'; p.$('cs-date').value = '2026-11-21'; await p.$('cs-save').click();

    const toProd = e.notifs.filter((n) => n.dept === 'Production');
    assert.ok(toProd.length >= 2, 'Production was told twice: ' + toProd.map((n) => n.title).join(' | '));
    for (const n of toProd) assert.doesNotMatch(n.title + ' ' + n.body, /₱|PHP|12,?345|5,?000|2,?500|5,?000|fee|price|amount|paid/i, n.title);
    // what Production reads: the visit, the request, the job's timeline
    for (const doc of [...e.db.store.site_visits.values(), ...e.db.store.change_requests.values(), { timeline: e.db.store.job_projects.get('prj1').timeline }]) assert.doesNotMatch(JSON.stringify(doc), /₱|12345|\b5000\b|\b2500\b|\b5000\b/);
    // and a Production login reading the block queries change_requests only
    const rene = world(PROD, { job_projects: { prj1: project }, change_requests: Object.fromEntries(e.db.store.change_requests), change_orders: Object.fromEntries(e.db.store.change_orders), payment_claims: Object.fromEntries(e.db.store.payment_claims) });
    const host = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    await rene.ctx.ChangeOrders.renderJobChanges(host, { id: 'prj1', ...project }, () => {});
    assert.ok(host.innerHTML.includes('Signed')); assert.doesNotMatch(host.innerHTML, /₱|12,?345|CO-0/);
    assert.deepEqual([...new Set(rene.db.log.filter((l) => l.op === 'query').map((l) => l.path))], ['change_requests']);
  });
});
