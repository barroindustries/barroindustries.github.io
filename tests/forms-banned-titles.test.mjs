// tests/forms-banned-titles.test.mjs — the title guard (specs/SALES-FLOW-SPEC-2026-11-19.md §9.8): the system must never produce a document TITLED
// "Official Receipt" or "Sales Invoice" — the BIR official receipt is issued separately, by Finance, on the BIR-accredited receipt (RR 18-2012 / 2-2024 /
// the CAS rules). The Payment Acknowledgement is the document Sales hands out, and it says so.
//
// SCOPE (coordinator ruling 2026-11-19): the guard covers TITLES and HEADINGS — the registry title, the document title (the panel bar, the browser tab),
// the h1/h2/section headings and column heads on the page, the signature-box roles, and the file name — case-insensitive and whitespace-insensitive.
// BODY TEXT is out of scope: the Payment Acknowledgement carries "This is not an official receipt. The BIR official receipt is issued separately by
// Finance." and MUST. Hence three directions are pinned here: the disclaimer is allowed, a form TITLED "Official Receipt" / "Sales Invoice" is refused,
// and nothing the engine generates puts those phrases in a title or heading.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, setupForms, fixtures, PEOPLE } from './fixtures/forms-env.mjs';

const FC = setupForms();
const BANNED = /official\s+receipt|sales\s+invoice/i;            // the test's own matcher — deliberately independent of the guard's implementation
const stripTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// every title and heading-like string of a built document: registry + document title + file name + page headings
function titlesAndHeadings(prep, composed) {
  const html = composed.bodyHtml;
  const byClass = [...html.matchAll(/class="(?:[^"]*\s)?(?:fh-title|fh-no|fh-meta|fh-date|sec-title|sig-role|f-label)(?:\s[^"]*)?"[^>]*>([^<]*)</g)].map((m) => m[1]);
  const tags = [...html.matchAll(/<(?:h[1-6]|th)\b[^>]*>([^<]*)</g)].map((m) => m[1]);
  return {
    titles: [prep.entry.title, prep.title, composed.title, composed.barLabelText, composed.fileName],
    headings: [...byClass, ...tags],
  };
}
const samples = () => {
  const fx = fixtures(); fx.order.soNumber = 'SO-0012'; fx.order.paNumber = 'PA-0031'; fx.project.joNumber = 'JO-0012'; fx.project.joRev = 1;
  fx.order.contractRev = 1; fx.order.originalContractAmount = 120000; fx.order.revisions = [{ revNo: 1, toAmount: 150000, fromAmount: 120000, decidedAt: '2026-11-18T09:00:00Z', arAfter: 75000, reason: 'Added shelves' }];
  const ctx = (extra, viewer) => Object.assign({ viewer, today: '2026-11-19', order: fx.order, project: fx.project, client: fx.client }, extra);
  const out = [];
  for (const company of ['BK', 'BI', 'BS']) {
    const f = fixtures(); f.order.company = company; f.project.company = company;
    for (const [id, viewer] of [['sales_order', PEOPLE.uriel], ['payment_ack', PEOPLE.shaira], ['job_order', PEOPLE.rene], ['handoff_pack', PEOPLE.rene]]) {
      const prep = FC.prepare(id, { viewer, today: '2026-11-19', order: f.order, project: f.project, client: f.client });
      assert.equal(prep.ok, true, `${id}/${company}: ${prep.error}`);
      out.push({ id, company, prep, composed: FC.compose(prep, FC.renderSections(prep)) });
    }
  }
  const revised = FC.prepare('sales_order', ctx({}, PEOPLE.uriel), { rev: 0 });
  assert.equal(revised.ok, true);
  out.push({ id: 'sales_order', company: 'BK', prep: revised, composed: FC.compose(revised, FC.renderSections(revised)) });
  return out;
};

describe('the title guard', () => {
  it('every registered form title passes the guard, and the four Phase 1 titles are the spec\'s', () => {
    assert.ok(FC.list().length >= 4);
    for (const e of FC.list()) { assert.equal(FC.assertTitleAllowed(e.title), true, e.title); assert.ok(!BANNED.test(e.title), e.title); }
    const phase1 = ['HANDOFF PACK', 'JOB ORDER', 'PAYMENT ACKNOWLEDGEMENT', 'SALES ORDER'];   // later work packages add entries (4B: the five Operations forms)
    assert.deepEqual(FC.list().map((e) => e.title).filter((t) => phase1.includes(t)).sort(), phase1);
  });

  it('a form TITLED "Official Receipt" or "Sales Invoice" is refused at registration — any case, any spacing, any position — and registers nothing', () => {
    const bad = ['OFFICIAL RECEIPT', 'Official Receipt', 'official receipt', 'Official  Receipt', 'OFFICIAL\tRECEIPT', 'Official\nReceipt', 'Official Receipt', 'Customer Official Receipt',
      'Official Receipt — Copy', 'SALES INVOICE', 'Sales Invoice', 'sales  invoice', 'Sales Invoice', 'My Sales Invoice (Draft)', 'Official Receipts'];
    bad.forEach((title, i) => {
      const id = 't_banned_' + i;
      assert.throws(() => FC.register({ id, title, audience: 'sales', fields: [] }), (e) => e.code === 'banned-title' && /not an allowed document title/.test(e.message), JSON.stringify(title));
      assert.equal(FC.get(id), null, 'nothing was registered for ' + JSON.stringify(title));
    });
    for (const audience of ['ops', 'finance']) assert.throws(() => FC.register({ id: 't_banned_aud', title: 'Official Receipt', audience, fields: [] }), (e) => e.code === 'banned-title', audience);
  });

  it('…and a hand-made entry is refused by build() too (the guard sits at both doors)', () => {
    for (const title of ['Official Receipt', 'SALES INVOICE']) assert.throws(() => FC.build({ id: 't_x', title, audience: 'sales', fields: [] }, {}), (e) => e.code === 'banned-title', title);
    assert.deepEqual(FC.build({ id: 't_ok', title: 'PAYMENT ACKNOWLEDGEMENT', audience: 'sales', fields: [] }, {}), {});
  });

  it('allowed neighbours: Payment Acknowledgement, Billing Statement, and the words alone (a Delivery Receipt, a Billing Invoice, an official letter) are not refused', () => {
    for (const title of ['PAYMENT ACKNOWLEDGEMENT', 'Billing Statement', 'DELIVERY RECEIPT', 'BILLING INVOICE', 'DOWNPAYMENT INVOICE', 'Receipt', 'Invoice', 'Official Letter', 'Sales Order', 'Sale Invoice', 'Officially Received']) {
      assert.equal(FC.assertTitleAllowed(title), true, title);
    }
    assert.equal(FC.assertTitleAllowed(''), true); assert.equal(FC.assertTitleAllowed(undefined), true);
  });

  it('the disclaimer is body text and is ALLOWED: the exact sentence prints in the Payment Acknowledgement; the guard is not applied to it (it would refuse it)', () => {
    assert.equal(FC.NOT_RECEIPT_NOTE, 'This is not an official receipt. The BIR official receipt is issued separately by Finance.');
    assert.throws(() => FC.assertTitleAllowed(FC.NOT_RECEIPT_NOTE), (e) => e.code === 'banned-title', 'as a TITLE the sentence would be refused — which is why the guard is for titles only');
    const fx = fixtures();
    const prep = FC.prepare('payment_ack', { viewer: PEOPLE.shaira, today: '2026-11-19', order: fx.order, project: fx.project });
    assert.equal(prep.ok, true, prep.error);
    assert.equal(prep.data.notice, FC.NOT_RECEIPT_NOTE);
    const c = FC.compose(prep, FC.renderSections(prep));
    assert.equal(stripTags(c.bodyHtml).split(FC.NOT_RECEIPT_NOTE).length - 1, 1, 'printed exactly once');
    assert.equal(c.title, 'Payment Acknowledgement — PA-123456');
    assert.equal(FC.prepare('payment_ack', { viewer: PEOPLE.shaira, today: '2026-11-19', order: { ...fx.order, status: 'pending' }, project: fx.project }).ok, false, 'and an unconfirmed payment still gets no document at all');
  });

  it('nothing the engine generates puts the phrases in a title or heading: registry, document title, bar label, file name, h1–h6, column heads, section titles, signature roles, header block — 4 forms × BK/BI/BS and a revision', () => {
    const all = samples();
    assert.equal(all.length, 13);
    for (const { id, company, prep, composed } of all) {
      const { titles, headings } = titlesAndHeadings(prep, composed);
      assert.ok(headings.length >= 6, `${id}/${company}: the scan found only ${headings.length} headings — the matcher is vacuous`);
      for (const t of [...titles, ...headings]) assert.ok(!BANNED.test(t), `${id}/${company}: "${t}"`);
      assert.match(composed.fileName, /^[A-Za-z0-9-]+\.pdf$/);
    }
  });

  it('only the Payment Acknowledgement\'s BODY says "official receipt" (the disclaimer); the Sales Order, Job Order and Handoff pack never do, in any text', () => {
    for (const { id, composed } of samples()) {
      const text = stripTags(composed.bodyHtml);
      if (id === 'payment_ack') { assert.ok(BANNED.test(text), 'the PA must carry the disclaimer'); assert.ok(!BANNED.test(text.split(FC.NOT_RECEIPT_NOTE).join(' ')), 'and nothing beyond it'); }
      else assert.ok(!BANNED.test(text), `${id} mentions the phrase`);
      assert.ok(!BANNED.test(composed.pageCss));
    }
  });

  it('no printed document anywhere in the app carries one of the phrases as its docTitle (the letterhead\'s document title) — a scan of js/', () => {
    const files = [];
    (function walk(dir) { for (const name of fs.readdirSync(dir)) { const p = path.join(dir, name); if (fs.statSync(p).isDirectory()) { if (name !== 'vendor') walk(p); } else if (/\.js$/.test(name)) files.push(p); } })(path.join(ROOT, 'js'));
    let seen = 0; const hits = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/docTitle\s*:\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) { seen++; if (BANNED.test(m[2])) hits.push(`${path.relative(ROOT, f)}: ${m[2]}`); }
    }
    assert.ok(seen >= 15, `only ${seen} docTitle literals found — the scan is vacuous`);
    assert.deepEqual(hits, []);
  });

  it('REPORT ONLY (never fails): payment records that tag a document as type "Official Receipt" are data labels for the BIR receipt Finance records, not printed titles', (t) => {
    const tagged = [];
    (function walk(dir) { for (const name of fs.readdirSync(dir)) { const p = path.join(dir, name); if (fs.statSync(p).isDirectory()) { if (name !== 'vendor') walk(p); } else if (/\.js$/.test(name)) { const n = (fs.readFileSync(p, 'utf8').match(/type\s*:\s*['"]Official Receipt['"]/g) || []).length; if (n) tagged.push(`${path.relative(ROOT, p)} x${n}`); } } })(path.join(ROOT, 'js'));
    t.diagnostic(`document tags with type 'Official Receipt' (left as they are — the forms engine does not produce them): ${tagged.join(', ') || 'none'}`);
    assert.ok(Array.isArray(tagged));
  });
});
