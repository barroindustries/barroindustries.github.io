// Sales > Quotes list fixes (2026-11-20, owner "complete the whole system active for use"):
//  1. the card title prepended the company code to numbers that already carry it ("BK-BKLUFB261119-003R1");
//  2. an approved (or pending / returned / rejected) filed quote read "Filed" instead of its approval state.
// Runs the REAL helpers sliced out of js/screens/sales.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, sliceOf } from './fixtures/sales-flow-harness.mjs';

const SALES_JS = read('js/screens/sales.js');
const HELPERS = sliceOf(SALES_JS, 'window.quoteDisplayNo = function', 'const DEFAULT_SALES_SOP = {');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(HELPERS, ctx);
const { quoteDisplayNo, quoteApprovalBadge } = ctx.window;

describe('quote number on the Quotes list card', () => {
  it('does not double the company code on numbers that already carry it', () => {
    assert.equal(quoteDisplayNo({ company: 'BK', quoteNumber: 'BKLUFB261119-003R1' }), 'BKLUFB261119-003R1');
    assert.equal(quoteDisplayNo({ company: 'BK', quoteNumber: 'BK-ML-FB-260731-012-R1' }), 'BK-ML-FB-260731-012-R1');
    assert.equal(quoteDisplayNo({ company: 'BI', quoteNumber: 'BI-260101-001' }), 'BI-260101-001');
  });
  it('still prefixes a number that lacks the code, and defaults the company to BK', () => {
    assert.equal(quoteDisplayNo({ company: 'BI', quoteNumber: '260101-001' }), 'BI-260101-001');
    assert.equal(quoteDisplayNo({ quoteNumber: '2607-012' }), 'BK-2607-012');
    assert.equal(quoteDisplayNo({ company: 'BK', id: 'abcdefxyz123' }), 'BK-XYZ123');
  });
  it('the card title uses the helper (no hand-built "${qco}-${quoteNumber}" left)', () => {
    assert.ok(SALES_JS.includes('${escHtml(window.quoteDisplayNo(q))} — '));
    assert.ok(!SALES_JS.includes("${escHtml(qco)}-${escHtml(q.quoteNumber||q.id.slice(-6).toUpperCase())}"));
  });
});

describe('approval state on a filed quote', () => {
  const filed = (approvalStatus, over = {}) => ({ status: 'filed', approvalStatus, ...over });
  it('shows Approved / Pending approval / Returned / Rejected in the Approvals screen\'s words', () => {
    assert.deepEqual({ ...quoteApprovalBadge(filed('approved')) }, { cls: 'badge-green', label: 'Approved' });
    assert.equal(quoteApprovalBadge(filed('pending_review')).label, 'Pending approval');
    assert.equal(quoteApprovalBadge(filed('pending')).label, 'Pending approval');
    assert.equal(quoteApprovalBadge(filed('needs_revision')).label, 'Returned');
    assert.equal(quoteApprovalBadge(filed('rejected')).cls, 'badge-red');
  });
  it('leaves the normal badge alone: plain filed, ordered, not filed, unknown state', () => {
    assert.equal(quoteApprovalBadge(filed('filed')), null);
    assert.equal(quoteApprovalBadge(filed(undefined)), null);
    assert.equal(quoteApprovalBadge(filed('approved', { salesOrderId: 'so1' })), null);
    assert.equal(quoteApprovalBadge({ status: 'lost', approvalStatus: 'approved' }), null);
    assert.equal(quoteApprovalBadge({ status: 'draft', approvalStatus: 'pending_review' }), null);
    assert.equal(quoteApprovalBadge(null), null);
  });
  it('the card renders the approval badge before falling back to the status badge', () => {
    assert.ok(SALES_JS.includes('const ab = window.quoteApprovalBadge(q); return ab'));
  });
});
