// tests/fixtures/forms-env.mjs — shared set-up for tests/forms-*.test.mjs (the Sales-flow forms engine, specs/SALES-FLOW-SPEC-2026-11-19.md §9).
//
// Loads the REAL files, in Node, with no build step: js/forms-core.js, js/forms-set-1.js, and the real
// job-order helpers (joDoc, jobOrderNoFor, joScopeRow, joScopeEdited, JO_STAGE_COLS) SLICED OUT of js/screens/production.js — so the tests run the code
// that ships, not a copy of it. Fixtures are plain records shaped like today's sales_orders / job_projects documents (Firestore Timestamps as
// {toDate()} objects where it matters).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const require = createRequire(import.meta.url);

// production.js is a classic script: everything between JO_STAGE_COLS and the editor's first function is the money-free job-order model.
// The source of that slice — what a test hands to its own vm context as "js/screens/production.js has loaded".
export function jobOrderHelpersSource() {
  const src = read('js/screens/production.js');
  const a = src.indexOf('const JO_STAGE_COLS = window.JO_STAGE_COLS = [');
  const b = src.indexOf('function joChecklistEditor(');
  if (a < 0 || b < a) throw new Error('production.js job-order helpers moved: update tests/fixtures/forms-env.mjs');
  return src.slice(a, b);
}
export function loadJobOrderHelpers() {
  const box = {}; box.window = box;
  vm.createContext(box);
  vm.runInContext(jobOrderHelpersSource(), box);
  for (const k of ['joDoc', 'jobOrderNoFor', 'joScopeRow', 'joScopeEdited', 'JO_STAGE_COLS']) globalThis[k] = box[k];
  return box;
}

export function setupForms() {
  globalThis.window = globalThis;
  loadJobOrderHelpers();
  const FC = require('../../js/forms-core.js');
  require('../../js/forms-set-1.js');
  return FC;
}

// ── people (Neil's list of who does what — the audience tests use these) ────────────────────────────────────
// Rene is Production ONLY (owner ruling: F6 is on hold, he is not in Design). A Production + Design employee is a separate, generic sample.
export const PEOPLE = {
  neil:      { uid: 'u-neil', role: 'president', depts: [], name: 'Neil Barro' },
  manager:   { uid: 'u-mgr', role: 'manager', depts: [], name: 'A Manager' },
  shairaRole:{ uid: 'u-sh1', role: 'finance', depts: [], name: 'Finance role' },
  shaira:    { uid: 'u-sh2', role: 'employee', depts: ['Finance'], name: 'Shaira Tecag' },
  uriel:     { uid: 'u-uri', role: 'employee', depts: ['Sales'], name: 'Uriel Sagaoinit' },
  rene:      { uid: 'u-ren', role: 'employee', depts: ['Production'], name: 'Rene Palles' },
  mcarthur:  { uid: 'u-mca', role: 'employee', depts: ['Production'], name: 'McArthur Sarabia' },
  designer:  { uid: 'u-des', role: 'employee', depts: ['Production', 'Design'], name: 'A Production + Design employee' },
  secretary: { uid: 'u-sec', role: 'secretary', depts: [], name: 'Corporate Secretary' },
  secFinance:{ uid: 'u-sef', role: 'secretary', depts: ['Finance'], name: 'Secretary listed in Finance' },
  secSales:  { uid: 'u-ses', role: 'secretary', depts: ['Sales'], name: 'Secretary listed in Sales' },
  nobody:    { uid: '', role: '', depts: [], name: '' },
};

// ── records ──────────────────────────────────────────────────────────────────────────────────────────────────
const clone = (v) => JSON.parse(JSON.stringify(v));
const ts = (iso) => ({ toDate: () => new Date(iso), seconds: Math.floor(new Date(iso).getTime() / 1000) });

export function fixtures() {
  const items = [
    { name: 'Work table with undershelf', catLabel: 'Preparation', qty: 2, unit: 'pc', unitPrice: 20000, amount: 40000, dims: '1800 x 700 x 850 mm', specStr: 'SS304 1.2mm top, hairline finish' },
    { name: 'Single-bowl sink', catLabel: 'Preparation', qty: 1, unit: 'pc', unitPrice: 35000, amount: 35000, dims: '900 x 700 x 850 mm' },
    { name: 'Canopy hood', catLabel: 'Ventilation', qty: 1, unit: 'pc', unitPrice: 75000, amount: 75000, dims: '2400 x 1000 x 500 mm', specStr: 'SS304 with grease filters' },
  ];
  const order = {
    id: 'ordAbCdEf123456', company: 'BK', clientId: 'cli1', clientName: 'Mamitas Bulaluhan', project: 'Mamitas kitchen', projectId: 'projXyz1', quoteId: 'q1',
    quoteNumber: 'BKMLFB260730-001R3', contractAmount: 150000, paymentReceived: 75000, status: 'recorded', recordedAmount: 75000, recordedBy: 'Shaira Tecag',
    recordedAt: ts('2026-11-18T08:00:00Z'), paymentMethod: 'Bank Transfer', createdByName: 'Uriel Sagaoinit', createdAt: ts('2026-11-17T05:00:00Z'),
    notes: 'Delivery on a weekday. Gate code is with the guard.', items: clone(items),
  };
  const project = {
    id: 'projXyz1', company: 'BK', clientId: 'cli1', clientName: 'Mamitas Bulaluhan', name: 'Mamitas Bulaluhan — BKMLFB260730-001R3', quoteNumber: 'BKMLFB260730-001R3',
    targetDate: '2026-12-20', contractAmount: 150000, amountCollected: 75000, arBalance: 75000, capital: 41000, dpPercent: 50,
    payments: [{ type: 'Sales Order Payment', amount: 75000, net: 66964.29, vatAmount: 8035.71, method: 'Bank Transfer', date: '2026-11-18', by: 'Shaira Tecag', ledgerId: 'SO-ordAbCdEf123456' }],
    items: clone(items), notes: 'Client prefers hairline finish', createdByName: 'Uriel Sagaoinit', createdAt: ts('2026-11-17T05:00:00Z'), salesOrderId: 'ordAbCdEf123456',
    jobOrder: { siteAddress: '12 Aurora Blvd., Quezon City', instructions: 'Use the east gate. Deliver before 3pm.', startDate: '2026-11-24', deliveryDate: '2026-12-15', revision: 2, updatedByName: 'Rene Palles', updatedAt: '2026-11-19T02:00:00Z',
      items: [
        { name: 'Work table with undershelf', catLabel: 'Preparation', qty: 2, unit: 'pc', dims: '1800 x 700 x 850 mm', specs: 'SS304 1.2mm top, hairline finish', stages: { parts: true, layout: true }, initials: 'RP', doneDate: '11/19', unitPrice: 20000, amount: 40000 },
        { name: 'Canopy hood', catLabel: 'Ventilation', qty: 1, unit: 'pc', dims: '2400 x 1000 x 500 mm', location: 'Main kitchen', unitPrice: 75000, amount: 75000 },
      ] },
  };
  const client = { id: 'cli1', name: 'Mamitas Bulaluhan', company: 'Mamitas Food Corp.', address: '12 Aurora Blvd., Quezon City', phone: '0917 123 4567', email: 'mamitas@example.com' };
  return { order, project, client, items, ts, clone };
}
