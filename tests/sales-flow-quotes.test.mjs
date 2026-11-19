// tests/sales-flow-quotes.test.mjs — the quote card, Mark sent / Lost / Reopen, and the Sales SOP, run for real
// (specs/SALES-QUICK-FIXES-SPEC-2026-11-19.md §3.1, §5.1, §6, §14.7).
//
// Runs the REAL js/screens/sales.js code (the SOP block, latestQuoteRevisions, the three handlers and
// renderBKQuotationsSummary) and the REAL quote-state helpers of js/config.js inside the shared fake world
// (tests/fixtures/sales-flow-harness.mjs): an in-memory Firestore, a fake panel, recorded toasts and notifications.
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRES, SALES, FIN, makeBaseEnv, read, same, sliceOf } from './fixtures/sales-flow-harness.mjs';

const SALES_JS = read('js/screens/sales.js');
const CONFIG = read('js/config.js');
const STATUS_META = read('js/ui-status-meta.js');
// SOP + latestQuoteRevisions + the chain helpers + the three handlers + renderBKQuotationsSummary, up to the Brilliant Steel list
const REGION = sliceOf(SALES_JS, "const SALES_SOP_ORANGE = '#e65100';", '// ── Brilliant Steel Quotes (read-only window into Brilliant Steel quotes) ──');
// isQuoteWon / isQuoteLost / isQuoteOpen / quoteStateFields — the canonical quote-state helpers
const QUOTE_STATE = sliceOf(CONFIG, 'window.isQuoteWon  = q =>', 'window.QUOTE_STALE_DAYS = 14;');

function makeEnv(who, opts) {
  const env = makeBaseEnv(who, opts);
  const ctx = env.ctx;
  ctx.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  ctx.isPresident = () => ctx.window.currentRole === 'president';
  ctx.chipTabs = () => '';
  ctx.bindChipTabs = () => {};
  ctx.renderEmptyState = (o) => `<empty>${o.title}</empty>`;
  ctx.quoteShareChipHtml = () => '';
  ctx.QUOTE_STALE_DAYS = 14;
  ctx.QUOTE_SHAREABLE_STATUSES = ['filed', 'approved', 'accepted'];
  ctx.sopPanel = () => '';
  env.load(STATUS_META, 'js/ui-status-meta.js');
  env.load(QUOTE_STATE, 'js/config.js (quote state)');
  env.load("'use strict';\n" + REGION, 'js/screens/sales.js (SOP + quotes)');
  return env;
}

const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
const q = (over = {}) => ({ quoteNumber: 'BK-260101-001', clientName: 'Acme Foods', company: 'BK', total: 100000, status: 'filed', approvalStatus: 'approved', createdBy: 'u-sales', agentName: 'Uriel', editableState: { a: 1 }, createdAt: { seconds: nowS() - DAY, toDate: () => new Date() }, ...over });
function bkContainer() {
  const body = { innerHTML: '' };
  return { innerHTML: '', _body: body, querySelector: (sel) => (sel === '#bkq-body' ? body : sel === '.bkq-view' ? {} : null), querySelectorAll: () => [] };
}
async function renderBK(env, role = 'employee') {
  const c = bkContainer();
  await env.ctx.renderBKQuotationsSummary(c, env.ctx.currentUser, role);
  return { c, body: c._body.innerHTML, kpi: c.innerHTML };
}
const cards = (body) => body.split('<div class="item-card"').slice(1);
const cardOf = (body, qno) => cards(body).find((x) => x.includes(qno)) || '';
const stats = (kpi) => [...kpi.matchAll(/<div class="stat-num">(.*?)<\/div><div class="stat-label">(.*?)(?: <span|<\/div>)/g)].map((m) => [m[2], m[1]]);

const SEED = {
  filed: q({ quoteNumber: 'BK-F', clientName: 'Filed Co' }),
  sentStamp: q({ quoteNumber: 'BK-S', clientName: 'Sent Co', sentAt: { seconds: 1 }, sentDate: '2026-11-18' }),
  legacySent: q({ quoteNumber: 'BK-L', clientName: 'Legacy Co', status: 'sent', approvalStatus: 'sent' }),
  lost: q({ quoteNumber: 'BK-X', clientName: 'Lost Co', total: 50000, status: 'lost', approvalStatus: 'lost', lostReason: 'competitor', lostReasonLabel: 'Went with a competitor', lostNote: 'cheaper bid <b>x</b>', lostPrevStatus: 'filed', lostPrevApprovalStatus: 'approved' }),
  rejected: q({ quoteNumber: 'BK-R', clientName: 'Rejected Co', total: 30000, status: 'rejected', approvalStatus: 'rejected' }),
  ordered: q({ quoteNumber: 'BK-O', clientName: 'Ordered Co', status: 'won', salesOrderId: 'so1' }),
  r1: q({ quoteNumber: 'BK-V-R1', clientName: 'Rev Co', rootQuoteId: 'rootV', createdAt: { seconds: nowS() - 3 * DAY } }),
  r2: q({ quoteNumber: 'BK-V-R2', clientName: 'Rev Co', rootQuoteId: 'rootV', createdAt: { seconds: nowS() - DAY } }),
  stale: q({ quoteNumber: 'BK-T', clientName: 'Stale Co', createdAt: { seconds: nowS() - 20 * DAY } }),
  approved: q({ quoteNumber: 'BK-A', clientName: 'Approved Co', status: 'filed', approvalStatus: 'approved' }),
  draft: q({ quoteNumber: 'BK-D', clientName: 'Draft Co', status: 'draft' }),
};

describe('the BK quote card (§5.1)', () => {
  const run = async (who = SALES, role = 'employee') => renderBK(makeEnv(who, { seed: { bk_quotes: SEED } }), role);

  it('a filed quote offers Mark sent, Record payment (not "Sales Order") and Lost — in that order, after Share', async () => {
    const { body } = await run();
    const c = cardOf(body, 'BK-F');
    assert.ok(c.includes('bk-share-btn') && c.includes('bk-sent-btn') && c.includes('bk-so-btn') && c.includes('bk-lost-btn'));
    assert.ok(c.indexOf('bk-share-btn') < c.indexOf('bk-sent-btn') && c.indexOf('bk-sent-btn') < c.indexOf('bk-so-btn') && c.indexOf('bk-so-btn') < c.indexOf('bk-lost-btn') && c.indexOf('bk-lost-btn') < c.indexOf('bk-del-btn'));
    assert.ok(c.includes('Mark sent') && c.includes('Record payment') && c.includes('>Lost<'));
    assert.ok(!c.includes('Sales Order'), 'the old button label is gone');
    assert.ok(!c.includes('bk-unlost-btn'));
    assert.ok(c.includes('style="color:var(--danger)"'), 'Lost is styled as a danger action');
  });
  it('Record payment keeps the class and every data-* the modal reads', async () => {
    const { body } = await run();
    const c = cardOf(body, 'BK-F');
    for (const attr of ['data-id=', 'data-qno="BK-F"', 'data-client="Filed Co"', 'data-client-id=', 'data-total="100000"', 'data-co="BK"']) assert.ok(c.includes(attr), attr);
  });
  it('a quote that was marked sent shows the Sent badge with its date, keeps its status, and cannot be marked sent twice — but can still be lost', async () => {
    const { body } = await run();
    const c = cardOf(body, 'BK-S');
    assert.ok(c.includes('badge badge-blue') && c.includes('Sent · 2026-11-18'));
    assert.ok(!c.includes('bk-sent-btn'));
    assert.ok(c.includes('bk-lost-btn') && c.includes('bk-share-btn') && c.includes('bk-so-btn'), 'Sent is a stamp: Share, Record payment and Lost all still apply');
    assert.ok(c.includes('Filed'), 'the status badge still says Filed');
  });
  it('a legacy status:"sent" quote shows Sent and can be lost, but cannot be marked sent or paid from here', async () => {
    const { body } = await run();
    const c = cardOf(body, 'BK-L');
    assert.ok(c.includes('Sent'));
    assert.ok(c.includes('bk-lost-btn') && !c.includes('bk-sent-btn') && !c.includes('bk-so-btn'));
  });
  it('a lost quote: dimmed, its reason (escaped) and note under the badge, Reopen quote — and none of Mark sent / Record payment / Lost', async () => {
    const { body } = await run();
    const c = cardOf(body, 'BK-X');
    assert.ok(c.includes('opacity:.7'));
    assert.ok(c.includes('Went with a competitor — cheaper bid &lt;b&gt;x&lt;/b&gt;'), 'reason and note render, escaped');
    assert.ok(c.includes('bk-unlost-btn') && c.includes('Reopen quote'));
    for (const gone of ['bk-sent-btn', 'bk-so-btn', 'bk-lost-btn']) assert.ok(!c.includes(gone), gone);
    assert.ok(c.includes('>Lost</span>'), 'the status badge says Lost');
  });
  it('a rejected quote stays as it was: no Reopen quote (that is for lost quotes only)', async () => {
    const { body } = await run();
    assert.ok(!cardOf(body, 'BK-R').includes('bk-unlost-btn'));
  });
  it('an ordered quote shows the disabled "✓ Ordered" button and no Mark sent / Lost', async () => {
    const { body } = await run();
    const c = cardOf(body, 'BK-O');
    assert.ok(c.includes('Ordered') && /bk-so-btn[^>]*disabled/.test(c));
    assert.ok(!c.includes('bk-sent-btn') && !c.includes('bk-lost-btn'));
  });
  it('a superseded revision offers neither Mark sent nor Lost (only the latest revision is acted on)', async () => {
    const { body } = await run();
    const primary = cards(body).find((x) => x.includes('BK-V-R2')) || '';
    assert.ok(primary.includes('bk-sent-btn') && primary.includes('bk-lost-btn'), 'the latest revision does');
    assert.ok(body.slice(body.indexOf('BK-V-R2')).includes('v2 · history'));
    assert.equal(cards(body).find((x) => x.includes('BK-V-R1')), undefined, 'R1 is only in the history list (no card with action buttons)');
  });
  it('the stale badge says "Filed but no payment recorded yet"', async () => {
    const { body } = await run();
    const c = cardOf(body, 'BK-T');
    assert.ok(c.includes('title="Filed but no payment recorded yet"') && c.includes('20d no SO'));
    assert.ok(!body.includes('Filed but no Sales Order yet'));
  });
  it('the buttons are shown to whoever sees the card, president included', async () => {
    const { body } = await run(PRES, 'president');
    assert.ok(cardOf(body, 'BK-F').includes('bk-sent-btn') && cardOf(body, 'BK-F').includes('bk-lost-btn'));
    const fin = await run(FIN, 'finance');
    assert.ok(cardOf(fin.body, 'BK-F').includes('bk-sent-btn'));
  });
  it('the KPI row: Quote Value leaves out lost and rejected quotes, Sent counts the stamp and legacy sent, Lost is the seventh card after Sent', async () => {
    const { kpi } = await run();
    const s = stats(kpi);
    same(s.map((x) => x[0]), ['Total Quotes', 'Quote Value', 'Accepted', 'Accepted Value', 'Sent', 'Lost', 'Drafts']);
    const by = Object.fromEntries(s);
    // latest revisions only: filed 100k + sentStamp 100k + legacySent 100k + ordered 100k + R2 100k + stale 100k + approved 100k = 700k (lost 50k and rejected 30k excluded)
    assert.equal(by['Quote Value'], '₱700,000.00');
    assert.equal(by.Sent, '2', 'the stamped quote and the legacy status:sent one');
    assert.equal(by.Lost, '1');
    assert.equal(by.Drafts, '1');
  });
});

describe('window.markQuoteSent (§5.1)', () => {
  it('stamps sentAt / sentDate / sentBy / sentByName and nothing else — the status is left alone — then re-renders', async () => {
    const env = makeEnv(SALES, { seed: { bk_quotes: { q1: q() } } });
    let done = 0;
    await env.ctx.window.markQuoteSent('bk_quotes', 'q1', () => { done++; });
    const d = env.db.store.bk_quotes.get('q1');
    assert.ok(d.sentAt); assert.equal(d.sentDate, '2026-11-19'); assert.equal(d.sentBy, 'u-sales'); assert.equal(d.sentByName, 'Uriel');
    assert.equal(d.status, 'filed'); assert.equal(d.approvalStatus, 'approved');
    const w = env.db.log.filter((l) => l.op === 'update');
    assert.equal(w.length, 1);
    same(Object.keys(w[0].patch).sort(), ['sentAt', 'sentBy', 'sentByName', 'sentDate']);
    assert.ok(env.toastMsgs().includes('Marked as sent'));
    assert.ok(env.audits.some((a) => a[0] === 'update' && a[1] === 'quote' && a[2] === 'q1' && a[3].sent === true));
    assert.equal(done, 1);
    assert.equal(env.dialogs.length, 0, 'one tap, no dialog');
  });
  it('invalidates the Brilliant Steel quotes cache for a bs_quotes quote', async () => {
    const env = makeEnv(SALES, { seed: { bs_quotes: { q1: q() } } });
    const inv = [];
    env.ctx.invalidateBsQuotesCache = (uid) => inv.push(uid);
    await env.ctx.window.markQuoteSent('bs_quotes', 'q1', () => {});
    same(inv, ['u-sales']);
    const env2 = makeEnv(SALES, { seed: { bk_quotes: { q1: q() } } });
    const inv2 = []; env2.ctx.invalidateBsQuotesCache = (uid) => inv2.push(uid);
    await env2.ctx.window.markQuoteSent('bk_quotes', 'q1', () => {});
    same(inv2, []);
  });
  it('a failed write shows an error toast and does not re-render', async () => {
    const env = makeEnv(SALES, { seed: {} });   // no such quote → update throws
    let done = 0;
    await env.ctx.window.markQuoteSent('bk_quotes', 'nope', () => { done++; });
    assert.ok(env.toasts.some((t) => t.type === 'error' && t.msg.startsWith('Could not mark as sent')));
    assert.equal(done, 0);
  });
});

describe('window.openMarkQuoteLost (§5.1, §3.4, §7 N6)', () => {
  async function open(who = SALES, quote = q(), coll = 'bk_quotes') {
    const env = makeEnv(who, { seed: { [coll]: { q1: quote } } });
    let done = 0;
    env.ctx.window.openMarkQuoteLost(coll, { id: 'q1', ...quote }, () => { done++; });
    return { env, p: env.lastPage(), done: () => done };
  }
  it('lists the seven reasons in order as radio rows, a 300-character note and an error line', async () => {
    const { p } = await open();
    assert.equal(p.title, 'Mark quote as lost');
    same(p.radios.map((r) => r.value), ['price', 'timing', 'competitor', 'no_response', 'cancelled', 'budget', 'other']);
    for (const l of ['Price', 'Timing', 'Went with a competitor', 'No response', 'Project cancelled', 'Budget not approved', 'Other (note required)']) assert.ok(p.html.includes(l), l);
    assert.equal((p.html.match(/class="check-row"/g) || []).length, 7);
    assert.ok(p.html.includes('maxlength="300"') && p.html.includes('placeholder="Note (required for Other)"'));
    assert.ok(p.html.includes('<strong>BK-260101-001</strong> — Acme Foods'));
    assert.ok(p.html.includes('Mark as lost') && p.html.includes('class="btn-danger"'));
  });
  it('refuses no reason, "Other" with no note, and an over-long note — writing nothing', async () => {
    const { env, p } = await open();
    await p.$('lost-save').click();
    assert.equal(p.$('lost-err').textContent, 'Choose a reason.');
    await p.check('lost-reason', 'other'); p.$('lost-note').value = '   ';
    await p.$('lost-save').click();
    assert.equal(p.$('lost-err').textContent, 'Add a note for "Other".');
    await p.check('lost-reason', 'price'); p.$('lost-note').value = 'x'.repeat(301);
    await p.$('lost-save').click();
    assert.equal(p.$('lost-err').textContent, 'Keep the note under 300 characters.');
    assert.equal(env.db.log.filter((l) => l.op !== 'query').length, 0);
    assert.equal(env.closes, 0);
  });
  it('marks it lost: status and approvalStatus both "lost", the reason, its label, the note, who and when, and what to restore on Reopen', async () => {
    const { env, p, done } = await open();
    await p.check('lost-reason', 'competitor'); p.$('lost-note').value = '  went with Kitchenworks  ';
    await p.$('lost-save').click();
    const d = env.db.store.bk_quotes.get('q1');
    same([d.status, d.approvalStatus], ['lost', 'lost']);
    same([d.lostReason, d.lostReasonLabel, d.lostNote], ['competitor', 'Went with a competitor', 'went with Kitchenworks']);
    same([d.lostBy, d.lostByName], ['u-sales', 'Uriel']);
    assert.ok(d.lostAt);
    same([d.lostPrevStatus, d.lostPrevApprovalStatus], ['filed', 'approved']);
    assert.ok(env.toastMsgs().includes('Quote marked as lost'));
    assert.equal(env.closes, 1); assert.equal(done(), 1);
    assert.ok(env.audits.some((a) => a[2] === 'q1' && a[3].lost === 'competitor'));
  });
  it('a reason that needs no note is saved with an empty note; "Other" with a note is accepted', async () => {
    const a = await open(); await a.p.check('lost-reason', 'price'); await a.p.$('lost-save').click();
    assert.equal(a.env.db.store.bk_quotes.get('q1').lostNote, '');
    const b = await open(); await b.p.check('lost-reason', 'other'); b.p.$('lost-note').value = 'client emigrated'; await b.p.$('lost-save').click();
    assert.equal(b.env.db.store.bk_quotes.get('q1').lostReason, 'other');
  });
  it('tells the President (N6) unless he marked it himself', async () => {
    const { env, p } = await open(SALES);
    await p.check('lost-reason', 'budget'); p.$('lost-note').value = 'not approved yet';
    await p.$('lost-save').click();
    const n = env.notifs.find((x) => x.kind === 'owner');
    same([n.title, n.type, n.link], ['✖️ Quote lost', 'quote_lost', 'bk-quotations']);
    assert.equal(n.body, 'Uriel: BK-260101-001 — Acme Foods. Reason: Budget not approved — not approved yet');
    const pres = await open(PRES);
    await pres.p.check('lost-reason', 'price'); await pres.p.$('lost-save').click();
    assert.equal(pres.env.notifs.length, 0, 'no notification to himself');
    const bs = await open(SALES, q(), 'bs_quotes');
    await bs.p.check('lost-reason', 'price'); await bs.p.$('lost-save').click();
    assert.equal(bs.env.notifs.find((x) => x.kind === 'owner').link, 'bs-quotations');
  });
  it('a failed write shows the error on the panel and leaves it open', async () => {
    const env = makeEnv(SALES, { seed: {} });
    env.ctx.window.openMarkQuoteLost('bk_quotes', { id: 'gone', ...q() }, () => {});
    const p = env.lastPage();
    await p.check('lost-reason', 'price'); await p.$('lost-save').click();
    assert.ok(p.$('lost-err').textContent.startsWith('Failed:'));
    assert.equal(env.closes, 0);
  });
  it('falls back to the last six characters of the id for an unnumbered quote', async () => {
    const env = makeEnv(SALES, { seed: { bk_quotes: { abcdef123456: q({ quoteNumber: '' }) } } });
    env.ctx.window.openMarkQuoteLost('bk_quotes', { id: 'abcdef123456', ...q({ quoteNumber: '' }) }, () => {});
    assert.ok(env.lastPage().html.includes('<strong>123456</strong>'));
  });
});

describe('window.reopenLostQuote (§5.1, §14.7 P4)', () => {
  const lostQuote = () => q({ status: 'lost', approvalStatus: 'lost', lostReason: 'timing', lostReasonLabel: 'Timing', lostNote: 'later', lostAt: { seconds: 5 }, lostBy: 'u-sales', lostByName: 'Uriel', lostPrevStatus: 'filed', lostPrevApprovalStatus: 'approved' });
  it('asks first, naming where the quote goes back to', async () => {
    const env = makeEnv(SALES, { seed: { bk_quotes: { q1: lostQuote() } } });
    await env.ctx.window.reopenLostQuote('bk_quotes', { id: 'q1', ...lostQuote() }, () => {});
    assert.equal(env.dialogs[0].message, 'Reopen this quote? It goes back to "Filed".');
  });
  it('restores the saved status pair and removes every lost* field; leaves an audit row; re-renders', async () => {
    const env = makeEnv(SALES, { seed: { bk_quotes: { q1: lostQuote() } } });
    let done = 0;
    await env.ctx.window.reopenLostQuote('bk_quotes', { id: 'q1', ...lostQuote() }, () => { done++; });
    const d = env.db.store.bk_quotes.get('q1');
    same([d.status, d.approvalStatus], ['filed', 'approved']);
    for (const k of ['lostReason', 'lostReasonLabel', 'lostNote', 'lostAt', 'lostBy', 'lostByName', 'lostPrevStatus', 'lostPrevApprovalStatus']) assert.ok(!(k in d), `${k} was not removed`);
    assert.ok(env.toastMsgs().includes('Quote reopened'));
    assert.equal(done, 1);
    assert.ok(env.audits.some((a) => a[0] === 'update' && a[1] === 'quote' && a[2] === 'q1' && a[3].reopened === true && a[3].from === 'timing'), 'a reopened loss leaves a trace (P4)');
  });
  it('defaults to filed / filed when nothing was saved, and a cancelled dialog changes nothing', async () => {
    const bare = { ...lostQuote() }; delete bare.lostPrevStatus; delete bare.lostPrevApprovalStatus;
    const env = makeEnv(SALES, { seed: { bk_quotes: { q1: bare } } });
    await env.ctx.window.reopenLostQuote('bk_quotes', { id: 'q1', ...bare }, () => {});
    same([env.db.store.bk_quotes.get('q1').status, env.db.store.bk_quotes.get('q1').approvalStatus], ['filed', 'filed']);
    const no = makeEnv(SALES, { seed: { bk_quotes: { q1: lostQuote() } }, confirmAnswer: false });
    await no.ctx.window.reopenLostQuote('bk_quotes', { id: 'q1', ...lostQuote() }, () => {});
    assert.equal(no.db.store.bk_quotes.get('q1').status, 'lost');
    assert.equal(no.db.log.filter((l) => l.op !== 'query').length, 0);
  });
});

describe('quote-state helpers (js/config.js)', () => {
  it('isQuoteLost counts "lost" as well as "rejected", and still never a quote that has an order', () => {
    const env = makeEnv(SALES, {});
    const w = env.ctx.window;
    assert.equal(w.isQuoteLost({ status: 'lost' }), true);
    assert.equal(w.isQuoteLost({ status: 'rejected' }), true);
    assert.equal(w.isQuoteLost({ status: 'filed' }), false);
    assert.equal(w.isQuoteLost({ status: 'lost', salesOrderId: 'so1' }), false, 'won beats lost');
    assert.equal(w.isQuoteOpen({ status: 'lost' }), false);
    assert.equal(w.isQuoteOpen({ status: 'filed' }), true);
  });
  it('quoteStateFields("lost") writes the two fields together', () => {
    const env = makeEnv(SALES, {});
    same(env.ctx.window.quoteStateFields('lost'), { status: 'lost', approvalStatus: 'lost' });
  });
});

describe('the Sales SOP (§6)', () => {
  const sop = (env) => env.load('DEFAULT_SALES_SOP', 'x');
  const old = { intro: 'old intro', steps: [{ short: 'Confirm', title: 'Client Confirmation & Down Payment', owner: 'Sales + Finance', tab: 'Quotes', desc: 'x', actions: ['**Finance** verifies the payment before the order is created.'], out: 'x' }], rules: ['r'], updatedBy: 'x' };
  async function view(who, saved) {
    const env = makeEnv(who, { seed: saved === undefined ? {} : { settings: { sales_sop: saved } } });
    const c = { innerHTML: '', _handlers: {}, querySelector(sel) { return sel === '#sop-load-v2' ? { addEventListener: (t, fn) => { c._handlers.load = fn; } } : null; }, querySelectorAll: () => [] };
    await env.ctx.renderSalesSOP(c);
    return { env, c };
  }

  it('the default is version 2 with the new ten steps, in order', () => {
    const d = sop(makeEnv(SALES, {}));
    assert.equal(d.sopVersion, 2);
    same(d.steps.map((s) => s.short), ['Inquiry', 'Qualify', 'Site Visit', 'Quote', 'Approve', 'Send', 'Follow-up', 'Design', 'Payment', 'Generate']);
  });
  it('the replaced steps say what the spec says: Mark sent, Lost with a reason, Record payment, the President confirms, Generate SO & JO', () => {
    const d = sop(makeEnv(SALES, {}));
    const step = (s) => d.steps.find((x) => x.short === s);
    assert.equal(step('Approve').owner, 'President');
    assert.ok(step('Send').actions.includes('Tap **Mark sent** on the quote the same day.'));
    assert.ok(step('Follow-up').actions.includes('If the client says no, tap **Lost** and choose the reason. Every lost quote needs a reason.'));
    assert.equal(step('Follow-up').out, 'A clear client decision: paying, or Lost with a reason.');
    assert.equal(step('Payment').title, 'Record the Payment');
    assert.ok(step('Payment').actions.some((a) => a.includes('Finance may confirm in his place')));
    assert.ok(step('Payment').actions.includes('The contract amount is the quote total and cannot be typed. To change it, revise the quote.'));
    assert.equal(step('Generate').desc, 'Hand the job to Production yourself. No Finance step.');
    assert.ok(step('Generate').actions.includes('In **Sales Orders**, tap **Generate SO & JO** on the confirmed order.'));
  });
  it('nothing in the default still describes the old Finance-verifies flow', () => {
    const d = JSON.stringify(sop(makeEnv(SALES, {})));
    assert.ok(!d.includes('Finance** verifies'));
    assert.ok(!d.includes('Create the Sales Order') && !d.includes('Handoff to Production / Fulfillment') && !d.includes('Client Confirmation & Down Payment'));
    assert.ok(!d.includes('(Step 8)'), 'the golden rule no longer points at a step that moved');
  });
  it('the Generate step says what to do when nobody can draw it (F6 on hold)', () => {
    const d = sop(makeEnv(SALES, {}));
    assert.ok(d.steps.find((s) => s.short === 'Generate').actions.some((a) => a.includes('attach the drawing yourself later from the Sales Orders row')));
  });
  it('a SAVED old SOP shows the President the banner with the load button, and everyone else a one-line note', async () => {
    const p = await view(PRES, old);
    assert.ok(p.c.innerHTML.includes('The sales flow changed on 19 Nov 2026 (payment confirmed in the app by the President, or by Finance in his place; Sales generates the sales order and job order). This saved SOP is the older version.'));
    assert.ok(p.c.innerHTML.includes('id="sop-load-v2"') && p.c.innerHTML.includes('Load the new default'));
    const s = await view(SALES, old);
    assert.ok(s.c.innerHTML.includes('This SOP is being updated to the new sales flow.'));
    assert.ok(!s.c.innerHTML.includes('sop-load-v2') && !s.c.innerHTML.includes('Load the new default'));
  });
  it('no banner for a saved v2 SOP, for the shipped default (no saved doc), or when the saved doc could not be read', async () => {
    for (const saved of [{ ...old, sopVersion: 2 }, undefined]) {
      const r = await view(PRES, saved);
      assert.ok(!r.c.innerHTML.includes('This saved SOP is the older version') && !r.c.innerHTML.includes('being updated'), JSON.stringify(saved && saved.sopVersion));
    }
    const env = makeEnv(PRES, {});
    env.db.collection = () => ({ doc: () => ({ get: async () => { throw new Error('denied'); } }) });
    const c = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    await env.ctx.renderSalesSOP(c);
    assert.ok(!c.innerHTML.includes('This saved SOP is the older version'), 'the fallback default is version 2');
  });
  it('"Load the new default" opens the editor with the default, and Save writes it — sopVersion 2 included', async () => {
    const { env, c } = await view(PRES, old);
    c._handlers.load();
    assert.ok(c.innerHTML.includes('Editing Sales SOP') && c.innerHTML.includes('Record the Payment'), 'the editor is prefilled with the new default');
    await env.ctx.salesSopSave(c);
    const saved = env.db.store.settings.get('sales_sop');
    assert.equal(saved.sopVersion, 2);
    assert.equal(saved.steps.length, 10);
    assert.ok(!JSON.stringify(saved).includes('Finance** verifies'));
    const again = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    await env.ctx.renderSalesSOP(again);
    assert.ok(!again.innerHTML.includes('This saved SOP is the older version'), 'and now the banner is gone');
  });
  it('editing the OLD SOP and saving does not mark it as new: the banner stays until the default is loaded', async () => {
    const { env, c } = await view(PRES, old);
    await env.ctx.renderSalesSOPEditor(c, old);
    await env.ctx.salesSopSave(c);
    const saved = env.db.store.settings.get('sales_sop');
    assert.ok(!(saved.sopVersion >= 2));
    const again = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    await env.ctx.renderSalesSOP(again);
    assert.ok(again.innerHTML.includes('This saved SOP is the older version'));
  });
});
