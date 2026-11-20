// tests/sales-quick-fixes-wiring.test.mjs — WP6 of specs/SALES-QUICK-FIXES-SPEC-2026-11-19.md (§10, §14.6) plus the owner rulings that
// arrived while it was built (SF4 one-tap confirm, F6 on hold, the form-engine hooks).
//
// Textual pins on the client code: they stop the wiring from drifting back to the old flow. The BEHAVIOUR is run for real in
// tests/sales-flow-core.test.mjs, tests/sales-flow-screens.test.mjs, tests/sales-flow-quotes.test.mjs and tests/sales-flow-production.test.mjs.
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const DEPT = read('js/departments.js');
const SALES = read('js/screens/sales.js');
const PROD = read('js/screens/production.js');
const CONFIG = read('js/config.js');
const CORE = read('js/sales-flow-core.js');
const INDEX = read('index.html');
const SW = read('sw.js');
const between = (src, from, to) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `start marker not found: ${from.slice(0, 70)}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end marker not found: ${to.slice(0, 70)}`);
  return src.slice(a, b);
};
const count = (src, needle) => src.split(needle).length - 1;
const code = (src) => src.replace(/\/\/[^\n]*/g, '');   // the same source with // comments dropped: comments may name what the code must not do

const MODAL = between(DEPT, 'async function openSalesOrderModal(', '// Finance/admin view of incoming sales orders — record income to the ledger.');
const CONFIRM = between(DEPT, 'window.openPaymentConfirmSheet = async function', '// Reject a recorded payment (§5.4)');
const REJECT = between(DEPT, 'window.rejectOrderPayment = async function', '// Orders waiting for a decision, newest first');
const LIST = between(DEPT, 'window.renderPaymentConfirmList = async function', '//  GENERATE SALES ORDER & JOB ORDER (§5.5)');
const GENERATE = between(DEPT, 'window.openGenerateOrderSheet = function', '// "Not drawn yet — send to Design first" must never wait on Design staffing');
const ATTACH = between(DEPT, 'window.openAttachDrawingSheet = function', '// vatSplit moved verbatim to js/money-core.js');
const ORDERS_PAGE = between(DEPT, 'window.renderSalesOrders = async function', '//  THE PRESIDENT\'S CONFIRMATION (§5.4)');
const TO_DESIGN = between(DEPT, 'window.transferOrderToDesign = async function', '// Advance the linked project to In Production');
const TO_PROD = between(DEPT, 'async function transferOrderToProduction(o){', '// bindQuoteActions — moved verbatim');
const SALES_FLOW_REGION = between(DEPT, '//  SALES FLOW — Record payment', '// vatSplit moved verbatim to js/money-core.js');

describe('WP2 Record payment (openSalesOrderModal) never touches the ledger and carries no free-typed contract', () => {
  it('no contract input, no old DP% / target date / priority / notes / project inputs', () => {
    for (const gone of ['so-contract', 'so-dp-pct', 'so-target-date', 'so-priority', 'so-notes', 'so-project']) assert.ok(!MODAL.includes(gone), gone);
  });
  it('no ledger call at all: no Ledger.post, no Ledger.upsertByRef, no auto-record', () => {
    for (const gone of ['Ledger.upsertByRef', 'Ledger.post', 'Ledger.postMulti', 'autoPosted', 'canAutoPostLedger', 'autoRecorded', "collection('ledger')"]) assert.ok(!MODAL.includes(gone), gone);
  });
  it('the contract is the quote total, validated by the core', () => {
    assert.ok(MODAL.includes('SF.quoteTotal(quoteDoc)') && MODAL.includes('SF.validatePayment('));
  });
  it('writes flow 2 and a pending order, and passes flowVersion 2 to createJobProject', () => {
    assert.ok(/status:'pending', flowVersion:2/.test(MODAL), "status:'pending', flowVersion:2");
    assert.ok(/createJobProject\(\{ \.\.\.d, total:contract, dpPercent, items: quoteItems, targetDate:'', priority:'', notes:'', flowVersion:2 \}\)/.test(MODAL));
  });
  it('(A1) records the chain root and refuses an earlier revision that already has an order, with the spec message', () => {
    assert.ok(MODAL.includes('rootQuoteId'));
    assert.ok(MODAL.includes('An earlier revision of this quote already has a sales order. A price change after payment is handled on that order, not by recording a new one. Ask the President.'));
    assert.ok(MODAL.includes('Could not check earlier revisions — try again.'));
    assert.ok(MODAL.includes("where('rootQuoteId','==',root)"));
  });
  it('(A1) the reference field is labelled for a number Finance issued, and the app issues none (no birOrButtonHTML)', () => {
    assert.ok(MODAL.includes('Reference no. / BIR OR no. (if Finance issued one)'));
    assert.ok(!MODAL.includes('birOrButtonHTML'));
  });
  it('the project\'s "Sales Order" document row moved to Generate; the old notifications are gone, replaced by N1 / N1F via one helper', () => {
    assert.ok(!/type:'Sales Order'/.test(MODAL));
    assert.ok(!code(MODAL).includes('New Sales Order') && !code(MODAL).includes('Quote won'));
    assert.ok(MODAL.includes('tellAboutPayment'));
    assert.equal(count(DEPT, 'payconf-${'), 1);
    assert.equal(count(DEPT, 'payfyi-${'), 1);
  });
  it('the President\'s own entry opens his confirm sheet by REPLACING the modal (never closeModal()-then-open)', () => {
    assert.ok(MODAL.includes("openPaymentConfirmSheet({ id:ref.id, ...orderDoc }, rerender, { replace:true })"));
  });
  it('every field is read through the panel, never document.getElementById', () => {
    assert.ok(!/document\.getElementById/.test(code(MODAL)), 'a document-level lookup in the Record payment modal');
    for (const [name, src] of [['confirm sheet', CONFIRM], ['generate sheet', GENERATE], ['attach sheet', ATTACH]]) assert.ok(!/document\.getElementById/.test(code(src)), name);
  });
  it('exactly two `SO-${` ledger-ref templates are left (deleteSalesOrder and the legacy Record Sale); the confirmation builds its ref in the core', () => {
    assert.equal(count(DEPT, 'SO-${'), 2);
    assert.ok(CORE.includes("'SO-' + o.id"));
  });
});

describe('WP2 the hand-off helpers refuse an unconfirmed payment before writing anything', () => {
  for (const [name, body] of [['transferOrderToDesign', TO_DESIGN], ['transferOrderToProduction', TO_PROD]]) {
    it(`${name} asks SalesFlow.transferBlockReason first`, () => {
      const at = body.indexOf('transferBlockReason(o)');
      assert.ok(at > 0, 'no block-reason call');
      for (const write of ['db.collection(', 'ensureProdHandoffFields(o)', 'Notifs.sendToDept(']) {
        const w = body.indexOf(write);
        assert.ok(w < 0 || at < w, `${write} comes before the block-reason check`);
      }
    });
  }
  it('transferOrderToProduction accepts a hand-off drawing in place of the Design → Sales approval, and its notice carries no pesos', () => {
    assert.ok(TO_PROD.includes('!window.SalesFlow.hasHandoffDrawing(o)'));
    assert.ok(TO_PROD.includes("'client-supplied drawing attached'") && TO_PROD.includes("'drawing attached'") && TO_PROD.includes("'no drawings needed'") && TO_PROD.includes("'design complete'"));
    assert.ok(TO_PROD.includes('The job order is ready. Start the work order.'));
    const notice = TO_PROD.slice(TO_PROD.indexOf("title:'🏭 New job to produce'"), TO_PROD.indexOf("title:'🏭 New job to produce'") + 220);
    assert.ok(!notice.includes('₱'));
    assert.ok(TO_PROD.includes("event:'Moved to In Production'") && !TO_PROD.includes('(sale recorded)'));
  });
  it('transferOrderToDesign says "payment confirmed", not "sale recorded by Finance"', () => {
    assert.ok(TO_DESIGN.includes('payment confirmed. Prepare the drawings, then send to Production.'));
    assert.ok(TO_DESIGN.includes("'Moved to In Design (payment confirmed)'"));
    assert.ok(!TO_DESIGN.includes('sale recorded'));
  });
});

describe('WP2 the confirmation and rejection (owner rulings F2 and SF4)', () => {
  it('the confirmation runs through SalesFlow.runConfirmation and never posts to the ledger itself', () => {
    assert.ok(CONFIRM.includes('SF.runConfirmation(o.id, deps)'));
    assert.ok(!CONFIRM.includes('Ledger.post(') || /ledgerPost: \(entry\) => window\.Ledger\.post\(entry\)/.test(CONFIRM), 'a direct Ledger.post call');
    assert.equal(count(CONFIRM, 'Ledger.post('), 1, 'the only Ledger.post is the injected dependency');
    for (const bad of ['Ledger.upsertByRef', 'Ledger.postMulti', "collection('ledger').doc(", ".collection('ledger').add"]) assert.ok(!CONFIRM.replace(/ledgerAmount:[^\n]*\n/, '').includes(bad), bad);
    assert.ok(CONFIRM.includes("serverTime: () => firebase.firestore.FieldValue.serverTimestamp()"));
  });
  it('rejecting writes no ledger, project, quote or tracker', () => {
    assert.ok(!REJECT.includes('Ledger.'));
    assert.ok(!REJECT.includes('job_projects') && !REJECT.includes('order_tracking') && !REJECT.includes('syncOrderTracking') && !REJECT.includes('bk_quotes'));
  });
  it('(A1) both are gated by SalesFlow.canConfirmPayment; rejection spreads SalesFlow.decisionStamp', () => {
    assert.ok(CONFIRM.includes('SF.canConfirmPayment(o, vNow)'));
    assert.ok(REJECT.includes('SF.canConfirmPayment(o, viewer)'));
    assert.ok(REJECT.includes('...SF.decisionStamp(viewer, who, nowIso)'));
  });
  it('SF4: confirming is ONE tap for the President and for Finance standing in — no confirm dialog in the sheet, only a small inline note', () => {
    assert.ok(!CONFIRM.includes('confirmDialog'), 'the stand-in dialog is back');
    assert.ok(!/in the President.{0,6}s place\?/.test(CONFIRM));
    assert.ok(CONFIRM.includes('The President normally confirms payments. Confirm only if he cannot be reached. He will be told that you confirmed it.'));
    assert.ok(!/alert-banner/.test(CONFIRM) && !/alert-banner/.test(LIST), 'the note is small and inline, not a warning banner');
    assert.ok(!DEPT.includes('Only the President confirms payments'));
  });
  it('SF4 keeps the record: decidedByRole and onBehalf come from decisionStamp, and the President is told (N9 / N10)', () => {
    assert.ok(CORE.includes("decidedByRole: viewer.isPresident ? 'president' : 'finance'") && CORE.includes('onBehalf: !viewer.isPresident'));
    assert.ok(CONFIRM.includes('payown-${o.id}') && REJECT.includes('payrejown-${o.id}-${resubmits}'));
    assert.equal(count(DEPT, 'payown-'), 1); assert.equal(count(DEPT, 'payrejown-'), 1);
    for (const k of ['payok-${o.id}', 'payfin-${o.id}', 'payrej-${o.id}']) assert.equal(count(DEPT, k), 1, k);
  });
  it('(A1) the Sales Orders page draws Confirm / Reject only under canConfirmPayment, and says so to a Finance user who recorded the order', () => {
    assert.ok(/if \(SF\.canConfirmPayment\(o, viewer\)\) \{\s*b\.push\(`<button class="btn-success btn-sm so-confirm-btn"/.test(ORDERS_PAGE));
    assert.ok(ORDERS_PAGE.includes('class="btn-secondary btn-sm so-reject-btn"'));
    assert.ok(ORDERS_PAGE.includes('You recorded this payment, so the President confirms it.'));
    assert.ok(ORDERS_PAGE.includes('Confirmed by ${escHtml(pc.decidedByName || \'\')} (Finance)'));
  });
  it('(A1) the Payments-to-confirm list renders for the President or the finance tier only', () => {
    assert.ok(LIST.includes('isFinanceTier'));
    assert.ok(LIST.includes('SF.canConfirmPayment(o, viewer)'));
    assert.ok(LIST.includes("Payments to confirm — President\\'s stand-in"));
  });
  it('the viewer is built with the narrow finance-tier test, not isFinancePriv (which is true for every manager)', () => {
    const v = between(DEPT, 'function salesFlowViewer() {', '// FLOW-FORM-HOOK');
    assert.ok(v.includes("isFinanceTier: role === 'finance' || ((window.currentDepts || []).includes('Finance') && role !== 'secretary')"));
    assert.ok(!v.includes('isFinancePriv'));
  });
  it('a failed read is shown, never mistaken for "nothing to confirm" or "No sales orders yet"', () => {
    assert.ok(LIST.includes('Could not load the payments waiting for confirmation.') && LIST.includes('pcl-retry'));
    assert.ok(ORDERS_PAGE.includes("Couldn't load sales orders") && ORDERS_PAGE.includes('so-retry-btn'));
    assert.ok(CONFIRM.includes('Could not load the company bank accounts'));
  });
});

describe('WP2 Generate (§5.5) and the Sales "Attach drawing" action (F6 on hold: nothing assumes anyone is in Design)', () => {
  it('Generate checks canGenerate, re-reads the order, stamps the release and the Sales Order document, and logs it', () => {
    assert.ok(GENERATE.includes('SF.canGenerate(o)') && GENERATE.includes('SF.canGenerate(cur)'));
    assert.ok(GENERATE.includes("releasedAt: firebase.firestore.FieldValue.serverTimestamp(), releasedBy: currentUser.uid, releasedByName: who"));
    assert.ok(GENERATE.includes("type:'Sales Order'") && GENERATE.includes("event: 'Sales order & job order generated'"));
    assert.ok(GENERATE.includes('transferOrderToProduction(cur)') && GENERATE.includes('window.transferOrderToDesign(cur)'));
  });
  it('the radio list and its copy are the spec\'s', () => {
    for (const t of ['The client supplied the drawing', 'Our drawing is already done', 'Not drawn yet — send to Design first', 'Attach the drawing (PDF, image, DWG)', 'What to build, special instructions…']) assert.ok(GENERATE.includes(t), t);
    assert.ok(GENERATE.includes("dept:'Design', subfolder:'Drawings'"));
    assert.ok(GENERATE.includes('Design prepares the drawings; you approve them on the job; then it goes to Production.'));
  });
  it('the Attach drawing action is for Sales or the President, needs no Design membership, and only works on a confirmed flow-2 order that is with Design', () => {
    assert.ok(ORDERS_PAGE.includes("if (o.flowVersion === 2 && (isSalesActor || isPres)) b.push(`<button class=\"btn-primary btn-sm so-attach-btn\""));
    assert.ok(!/canEditDept\('Design'\)|currentDepts[^;\n]*Design|isDesign/.test(ORDERS_PAGE + ATTACH + GENERATE), 'something here depends on Design staffing');
    assert.ok(ATTACH.includes("x.flowVersion === 2 && x.status === 'recorded' && !!x.sentToDesign && !x.sentToProduction"));
    assert.ok(ATTACH.includes('transferOrderToProduction(cur)'));
    assert.ok(ATTACH.includes('productionHandoffAt: nowIso'), 'it closes the Design board\'s "awaiting design" entry');
  });
  it('the "send to Design" notification falls back to the President when nobody is in Design', () => {
    assert.ok(/Notifs\.sendToDept\('Design',[\s\S]{0,400}\{ fallbackToOwner:true \}/.test(TO_DESIGN));
  });
  it('the SOP tells Sales they can attach the drawing themselves', () => {
    assert.ok(SALES.includes('attach the drawing yourself later with **Attach drawing** on the Sales Orders row'));
  });
});

describe('the form-engine hooks (FLOW-FORM-HOOK) can never fail Generate or Confirm', () => {
  it('the engine is reached through ONE guarded loader: window.ensureScript("js/forms.js") then window.Forms', () => {
    assert.equal(count(DEPT, "ensureScript('js/forms.js')"), 1);
    assert.ok(DEPT.includes("window.flowForms = function () { return window.ensureScript('js/forms.js').then(function () { return window.Forms; }); };"));
  });
  it('every call to the loader sits inside a try whose catch swallows it', () => {
    const calls = [...SALES_FLOW_REGION.matchAll(/window\.flowForms\(\)/g)];
    assert.equal(calls.length, 4, 'one loader call each in Generate, Attach drawing, Confirm and the Job Order button');
    for (const m of calls) {
      const before = SALES_FLOW_REGION.slice(Math.max(0, m.index - 260), m.index);
      const after = SALES_FLOW_REGION.slice(m.index, m.index + 520);
      assert.ok(/try\s*\{/.test(before.slice(before.lastIndexOf('try') - 1)) || /try \{ const F/.test(before + after.slice(0, 40)), 'no try before a flowForms call: ' + before.slice(-80));
      assert.ok(/catch\s*\(/.test(after), 'no catch after a flowForms call');
    }
  });
  it('Generate numbers and offers the sales order + job order (+ pack); the design path only the sales order; Confirm numbers the Payment Acknowledgement', () => {
    assert.ok(GENERATE.includes("['sales_order', 'job_order']") && GENERATE.includes("['sales_order', 'job_order', 'handoff_pack']") && GENERATE.includes("['sales_order']"));
    assert.ok(GENERATE.includes('F.assignNumbers(kinds, { orderId: cur.id, projectId: cur.projectId })'));
    assert.ok(CONFIRM.includes("F.assignNumbers(['payment_ack'], { orderId: o.id })"));
  });
  it('the Job Order button tries the engine and falls back to the existing print', () => {
    assert.ok(ORDERS_PAGE.includes("F.open('job_order', { orderId: o.id, projectId: o.projectId || null })"));
    assert.ok(ORDERS_PAGE.includes("window.ensureScript('js/screens/production.js')") && ORDERS_PAGE.includes('window.printJobOrder('));
  });
  it('form buttons are drawn only when the engine is already loaded', () => {
    assert.ok(ORDERS_PAGE.includes("if (!F || typeof F.buttonHtml !== 'function' || o.flowVersion !== 2) return '';"));
    assert.ok(ORDERS_PAGE.includes("window.Forms.bind(c)"));
  });
  it('this batch adds no form engine of its own: no js/forms*.js, and print-docs.js / letterhead.js are untouched by name', () => {
    for (const f of ['js/forms.js', 'js/forms-core.js']) assert.ok(!fs.existsSync(new URL('../' + f, import.meta.url)) || read(f).length > 0);
    assert.ok(!SALES_FLOW_REGION.includes('openPrintableDoc') && !SALES_FLOW_REGION.includes('buildLetterhead'));
  });
});

describe('WP3 quote card, KPIs and SOP wiring (js/screens/sales.js, js/config.js)', () => {
  it('the three buttons exist and each is bound in bindCardActions', () => {
    const bind = between(SALES, 'const bindCardActions = () => {', '// Wave 7 Pass 2 — chain-aware card');
    for (const cls of ['bk-sent-btn', 'bk-lost-btn', 'bk-unlost-btn']) {
      assert.ok(SALES.includes(`class="btn-secondary btn-sm ${cls}"`), `${cls} is not drawn`);
      assert.ok(bind.includes(`'.${cls}'`), `${cls} is not bound`);
    }
    assert.ok(bind.includes("window.markQuoteSent('bk_quotes'") && bind.includes("window.openMarkQuoteLost('bk_quotes'") && bind.includes("window.reopenLostQuote('bk_quotes'"));
  });
  it('the button order is Share · Mark sent · Record payment · Lost · Reopen quote · Delete, and the label is Record payment', () => {
    const card = between(SALES, 'const quoteCard = (q) => {', 'container.innerHTML = `');
    const at = (s) => card.indexOf(s);
    assert.ok(at('bk-share-btn') < at('bk-sent-btn') && at('bk-sent-btn') < at('bk-so-btn') && at('bk-so-btn') < at('bk-lost-btn') && at('bk-lost-btn') < at('bk-unlost-btn') && at('bk-unlost-btn') < at('bk-del-btn'));
    assert.ok(card.includes('Record payment') && !card.includes('Sales Order</button>') && !card.includes('Sales Order`'));
    assert.ok(card.includes('Filed but no payment recorded yet'));
  });
  it('isQuoteLost includes "lost"', () => {
    assert.match(CONFIG, /window\.isQuoteLost = q => !!\(q && \(q\.status === 'rejected' \|\| q\.status === 'lost'\) && !window\.isQuoteWon\(q\)\);/);
  });
  it('the SOP default is version 3 and no step still says Finance verifies', () => {
    const d = between(SALES, 'const DEFAULT_SALES_SOP = {', "function sopFmt(s)");
    assert.ok(/sopVersion: 3,/.test(d));
    assert.ok(!/sopVersion: 2,/.test(d));
    assert.ok(!d.includes('Finance** verifies'));
  });
  it('the saved-SOP banner is wired: a version below 3 shows it, the President gets the load button, Save writes sopVersion only for a real version', () => {
    assert.ok(SALES.includes('const oldSopBanner = (data.sopVersion >= 3) ?'), 'the banner shows for a saved SOP below version 3');
    assert.ok(SALES.includes('id="sop-load-v2"') && SALES.includes("container.querySelector('#sop-load-v2')"));
    assert.ok(SALES.includes('...(d.sopVersion >= 2 ? { sopVersion: d.sopVersion } : {}),'));
    assert.ok(SALES.includes('This SOP is being updated to the new sales process.'));
    assert.ok(SALES.includes('The sales process was updated (Nov 2026)') && !SALES.includes('The sales flow changed on 19 Nov 2026'), 'the wording is not tied to one date');
  });
  it('the How Sales works panel names the configurators, the approval link, Download PDF, Mark sent, Lost, Record payment, Generate SO & JO, Won / Projects and Brilliance Steel', () => {
    const panel = between(SALES, "window.sopPanel('How Sales works', [", '])}');
    for (const needle of [
      'The Barro Kitchens configurators are on: pick the area tab, Configure the product, then Add to Quote.',
      'Prices come from the Standard Price List',
      "Every quote needs the President\\'s approval.",
      'Verify & File, then Send for approval (get the link)',
      'Messenger or Viber',
      'PDF ▾ → Download PDF',
      'Reopen it, Verify & File with Update the original quote in place, then PDF ▾ → Download PDF.',
      'On each quote: Mark sent when it goes out, Lost (with a reason) when the client says no, New Revision for any change.',
      'When the client pays, tap Record payment on the quote.',
      'tap Generate SO & JO to hand the job to Production.',
      'Won / Projects lists every won job from the moment its payment is recorded',
      'Brilliance Steel is a read-only window',
    ]) assert.ok(panel.includes(needle), `How Sales works: ${needle}`);
    assert.ok(!panel.includes('Brilliant'), 'Brilliance Steel, never Brilliant, in the words people read');
    assert.ok(!panel.includes('₱'), 'no peso figure in a tracked file');
  });
  it('the Sales tab chip reads Brilliance Steel while its key (deep links, nav, tests) stays Brilliant Steel', () => {
    assert.ok(SALES.includes("const salesTabs = ['Clients','Briefs','Quote requests','Quotes','Won','Analytics','Brilliant Steel','Files','SOP','Budgeting','Tasks'];"));
    assert.ok(SALES.includes("label: s==='Won' ? 'Won / Projects' : s==='Brilliant Steel' ? 'Brilliance Steel' : s"));
    assert.ok(SALES.includes("case 'Brilliant Steel':"));
    const bs = between(SALES, "case 'Brilliant Steel':", "case 'Files':");
    assert.ok(bs.includes('Brilliance Steel — quotes &amp; files shared with Sales for coordination.</div>'));
    assert.ok(!bs.includes('Brilliant Steel —'), 'the banner no longer uses the old spelling');
  });
  it('the per-tab intros match the process: Quotes (configurators, approval, Records), Won / Projects, Quick Estimate (rough check only)', () => {
    const quotes = between(SALES, "case 'Quotes': {", "case 'Brilliant Steel':");
    assert.ok(quotes.includes('the Barro Kitchens configurators are on, and the President approves each quote before it goes out.'));
    assert.ok(quotes.includes('(Mark sent · Record payment · Lost · New Revision)') && quotes.includes('<strong>Quick Estimate</strong> is only a rough price check.'));
    assert.ok(SALES.includes("from the moment its payment is recorded: the same records as the Projects page. Tap <strong>Open</strong> for the full project folder."));
    assert.ok(SALES.includes("A job appears here as soon as a client\\'s payment is recorded on a quote."));
    assert.ok(SALES.includes('<strong>Quick Estimate</strong> — a rough price check from the live product database.'));
    assert.ok(SALES.includes('The quote itself is built in the Quote Builder, where the Barro Kitchens configurators and the Standard Price List set the price.'));
    assert.ok(!SALES.includes('One-stop kitchen design'), 'no hype line in the header');
  });
});

describe('WP4 Production (js/screens/production.js)', () => {
  it('the Incoming and Job Orders filters keep a flow-2 job at "won" away from Production', () => {
    assert.equal(count(PROD, "!(p.flowVersion === 2 && p.stage === 'won')"), 4, 'Incoming (P3), Job Orders (P4), the Job Order button and the Advance button (P5)');
  });
  it('visDocs hides payment documents from Production-only viewers', () => {
    assert.ok(/const visDocs = .*payment\|acknowledg\|statement/.test(PROD));
  });
  it('SF19: delivery closes a fully prepaid job through one guarded helper, called from both delivery paths', () => {
    assert.ok(PROD.includes('async function closePrepaidJobIfDelivered(projectId, who){'));
    assert.ok(PROD.includes('await closePrepaidJobIfDelivered(p.id, who)'));
    assert.ok(PROD.includes("await closePrepaidJobIfDelivered(projectId, userProfile?.displayName||currentUser.email)"));
  });
  it('F11: confirming a payment never closes the job — no stage anywhere in the confirmation path', () => {
    assert.ok(!/stage/.test(CORE.slice(CORE.indexOf('function planConfirmation'), CORE.indexOf('window.SalesFlow = {'))) || !/stage\s*[:=]/.test(CORE.slice(CORE.indexOf('function planConfirmation'), CORE.indexOf('window.SalesFlow = {'))));
    assert.ok(!/stage/.test(CONFIRM.replace(/\/\/[^\n]*/g, '')));
  });
});

describe('WP5 the President surfaces', () => {
  it('Approvals: a host between the banners and the chips, filled through a typeof-guarded call, not threaded through the queue tuple', () => {
    const A = read('js/screens/approvals.js');
    assert.ok(A.indexOf('<div id="approvals-payconfirm"></div>') < A.indexOf("${window.chipTabs(approvalChips, 'all')}"));
    assert.ok(A.includes("if (typeof window.renderPaymentConfirmList === 'function') window.renderPaymentConfirmList(c.querySelector('#approvals-payconfirm'), { onDone: () => renderApprovals(currentUser) });"));
  });
  it('the President dashboard: a banner host right after the pending banner and a guarded fill', () => {
    const D = read('js/screens/dashboards.js');
    assert.ok(D.includes('<div id="dash-payconfirm"></div>'));
    assert.ok(D.includes('window.pendingPaymentConfirmations?.().then(list => {'));
    assert.ok(D.includes('waiting for your confirmation'));
  });
});

describe('WP1 registration', () => {
  it('index.html app-kit and sw.js PRECACHE list js/sales-flow-core.js after money-core.js and before departments.js', () => {
    const kit = INDEX.slice(INDEX.indexOf('<template id="app-kit">'), INDEX.indexOf('</template>'));
    const at = (f) => kit.indexOf(`src="js/${f}.js?v=`);
    assert.ok(at('money-core') > 0 && at('money-core') < at('sales-flow-core') && at('sales-flow-core') < at('departments'));
    const pre = SW.slice(SW.indexOf('const PRECACHE = ['), SW.indexOf('\n];', SW.indexOf('const PRECACHE = [')));
    const pat = (f) => pre.indexOf(`'/js/${f}.js?v=`);
    assert.ok(pat('money-core') > 0 && pat('money-core') < pat('sales-flow-core') && pat('sales-flow-core') < pat('departments'));
    assert.ok(pat('sales-flow-core') < pre.indexOf("'/js/pdf-lite.js'"), 'the new line stays clear of the pdf-lite entry');
  });
  it('the notification icon registry knows the four new types', () => {
    const N = read('js/notifications.js');
    for (const t of ['payment_confirm', 'payment_confirmed', 'payment_rejected', 'quote_lost']) assert.ok(new RegExp(`${t}:\\{icon:`).test(N), t);
  });
  it('the core never names a BIR receipt or an invoice, and the status label says Awaiting confirmation', () => {
    assert.ok(!CORE.includes('Official Receipt') && !CORE.includes('Sales Invoice'));
    assert.ok(CORE.includes("label: 'Awaiting confirmation'"));
  });
});

describe('plain English on screen (owner quality bar): no code names in what the new screens show', () => {
  it('none of the new customer-facing strings contains an identifier-looking token', () => {
    const shown = [...SALES_FLOW_REGION.matchAll(/(?:Notifs\.(?:showToast|success)\(|fail\(|textContent = |title:\s*)'([^']{6,})'/g)].map((m) => m[1]);
    assert.ok(shown.length > 20, 'the scan found the strings');
    for (const s of shown) {
      assert.ok(!/\b[a-z]+_[a-z_]+\b/.test(s), `a code name on screen: ${s}`);
      assert.ok(!/\b[a-z]+[A-Z][a-zA-Z]+\b/.test(s.replace(/\$\{[^}]*\}/g, '')), `a camelCase identifier on screen: ${s}`);
    }
  });
});
