// tests/forms-core.test.mjs — the Sales-flow forms engine core (js/forms-core.js + the bodies of js/forms-set-1.js), specs/SALES-FLOW-SPEC-2026-11-19.md
// §9.11, in the quote builder's document format and the owner's final header/numbering rulings (2026-11-19).
//
// WHAT IT PINS
//   1. NUMBERS      "SO-0012", the quote's R revision convention WITH a space ("SO-0012 R1", never "Rev. 1" — header and file name), the quotation
//                   reference in the quote-number style, one SERIAL for the sales order and the job order (SO-0012 / JO-0012), Manila dates, pesos.
//   2. HEADER       the horizontal Barro Industries logo + the company line exactly, Barro Kitchens documents lead with the BK mark + BARRO KITCHENS / By Barro Industries OPC (owner 2026-11-20), Brilliant Steel orders
//                   on the Barro Industries header; the company table is still the quote builder's own `const CO`; navy #1F3A5F.
//   3. PESO WALL    an 'ops' entry cannot register a money field; build() copies only declared fields; assertNoPesos throws on a price in a key or in
//                   ANY string (free text included) — a job order with "₱5,000" typed in its instructions is refused with a plain message.
//   4. AUDIENCE     ops / sales / finance × twelve sample people. Rene is Production only; a Production + Design employee is a separate sample: ops
//                   forms open for Production members with or without Design.
//   5. PREPARE      refusals (unconfirmed payment, no access), stored vs pair vs fallback numbers, revisions, workforce copy (# / DESCRIPTION / QTY /
//                   UNIT only), the prototype's sections, escaping.
//   6. ASSIGN       serials stored in ONE transaction with their counter, one counter for the SO/JO pair, only where today's rules allow, never throwing.
// Mutation-checked by hand (scratch copy, one break at a time): see the commit report.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, read, setupForms, fixtures, PEOPLE } from './fixtures/forms-env.mjs';

const require = createRequire(import.meta.url);
const FC = setupForms();
const { createFake } = require('./fixtures/fake-firestore.cjs');

// text between two markers of a source file (same helper the contact-details test uses)
const sliceBetween = (src, from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error('marker not found: ' + from); return src.slice(a, b + to.length); };
const ctxOf = (extra, viewer) => Object.assign({ viewer: viewer || PEOPLE.neil, today: '2026-11-19' }, extra);
const stripTags = (html) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');

describe('1. numbers, names, dates', () => {
  it('fmtNumber pads to four digits and never truncates', () => {
    assert.equal(FC.fmtNumber('SO', 12), 'SO-0012');
    assert.equal(FC.fmtNumber('JO', 7), 'JO-0007');
    assert.equal(FC.fmtNumber('PA', 31), 'PA-0031');
    assert.equal(FC.fmtNumber('SO', 12345), 'SO-12345');
    assert.equal(FC.fmtNumber('SO', 'x'), 'SO-0000');
  });
  it('withRev is the quote\'s R convention with a space — "SO-0012 R1", "JO-0012 R2" — never "Rev."', () => {
    assert.equal(FC.withRev('SO-0012', 1), 'SO-0012 R1');
    assert.equal(FC.withRev('JO-0012', 3), 'JO-0012 R3');
    for (const none of [0, undefined, null, -1, NaN, 'x']) assert.equal(FC.withRev('SO-0012', none), 'SO-0012', String(none));
    assert.equal(FC.withRev('', 2), '');
    assert.ok(!/rev\./i.test(FC.withRev('SO-0012', 2)));
  });
  it('fileName: the three examples (R1 revision, hyphens kept, letters/digits/hyphens only) — no "Rev" in a file name either', () => {
    assert.equal(FC.fileName('sales_order', 'SO-0012', 1), 'SO-0012-R1.pdf');
    assert.equal(FC.fileName('job_order', 'JO-0007', 0), 'JO-0007.pdf');
    assert.equal(FC.fileName('quotation', 'BK-ML-FB-261119-001-R3', 0), 'Quotation-BK-ML-FB-261119-001-R3.pdf');
    assert.equal(FC.fileName('job_order', 'JO-0012', 2), 'JO-0012-R2.pdf');
    assert.equal(FC.fileName('sales_order', 'SO 0012/x.y', 2), 'SO-0012-x-y-R2.pdf');
    assert.match(FC.fileName('payment_ack', 'PA-0031', 0), /^[A-Za-z0-9-]+\.pdf$/);
    assert.ok(!/rev/i.test(FC.fileName('sales_order', 'SO-0012', 4)));
    assert.equal(FC.fileName('payment_ack', '', 0), 'document.pdf');
  });
  it('jobRef drops the revision suffix, dash optional (…001-R3 and the v14 compact …001R3 both exist)', () => {
    assert.equal(FC.jobRef('BK-ML-FB-261119-001-R3'), 'BK-ML-FB-261119-001');
    assert.equal(FC.jobRef('BKMLFB261119-001R3'), 'BKMLFB261119-001');
    assert.equal(FC.jobRef('BK-ML-FB-261119-001'), 'BK-ML-FB-261119-001');
    assert.equal(FC.jobRef('  BKMLFB261119-001r12  '), 'BKMLFB261119-001');
    assert.equal(FC.jobRef(null), '');
    assert.equal(FC.jobRef(undefined), '');
  });
  it('the sales order and the job order share ONE serial: serialOf reads either prefix, counterName maps JO to the SO counter', () => {
    assert.equal(FC.serialOf('SO-0012'), '0012'); assert.equal(FC.serialOf('JO-0012'), '0012'); assert.equal(FC.serialOf('JO-12345'), '12345');
    for (const odd of ['', null, 'PA-0012', 'JO-ML-FB-260730-001', 'SO-12', 'so-0012']) assert.equal(FC.serialOf(odd), '', String(odd));
    assert.equal(FC.counterName('SO'), 'form_SO'); assert.equal(FC.counterName('JO'), 'form_SO'); assert.equal(FC.counterName('PA'), 'form_PA');
  });
  it('dates are Manila dates in the quote\'s en-PH long format', () => {
    assert.equal(FC.longDate('2026-11-19'), 'November 19, 2026');
    assert.equal(FC.longDate('nonsense'), '');
    assert.equal(FC.toIsoDate('2026-11-19'), '2026-11-19');
    assert.equal(FC.toIsoDate('2026-11-18T20:00:00Z'), '2026-11-19', 'an instant after 16:00 UTC is already tomorrow in Manila');
    assert.equal(FC.toIsoDate({ toDate: () => new Date('2026-11-18T20:00:00Z') }), '2026-11-19');
    assert.equal(FC.toIsoDate({ seconds: Math.floor(Date.parse('2026-11-18T03:00:00Z') / 1000) }), '2026-11-18');
    assert.equal(FC.toIsoDate(new Date('2026-11-19T01:00:00Z')), '2026-11-19');
    for (const bad of [null, undefined, '', 'x', {}, 5]) assert.equal(FC.toIsoDate(bad), '', String(bad));
  });
  it('peso() is the quote\'s formatPeso — whole pesos — and shows centavos only when there are some (a payment is never rounded on paper)', () => {
    assert.equal(FC.peso(5000), '₱5,000'); assert.equal(FC.peso(138000), '₱138,000'); assert.equal(FC.peso(0), '₱0'); assert.equal(FC.peso(null), '₱0');
    assert.equal(FC.peso(1234.5), '₱1,234.50'); assert.equal(FC.peso(66964.29), '₱66,964.29'); assert.equal(FC.peso(75000.004), '₱75,000');
    assert.equal(FC.peso(-15000), '−₱15,000');
  });
});

describe('2. header, companies, logo', () => {
  const builderCO = new Function(`${sliceBetween(read('quote-builder-v2.html'), 'const CO = {', '\n};')}\nreturn CO;`)();
  const configCompanies = (() => { const w = {}; new Function('window', sliceBetween(read('js/config.js'), 'window.BRAND = {', '\n};'))(w); return w.BRAND.companies; })();
  const headerOf = (company, ctxExtra) => {
    const fx = fixtures(); fx.order.company = company; fx.project.company = company;
    const p = FC.prepare('sales_order', ctxOf({ order: fx.order, project: fx.project, ...(ctxExtra || {}) }, PEOPLE.uriel));
    assert.equal(p.ok, true, p.error);
    return { p, html: FC.compose(p, FC.renderSections(p)).bodyHtml };
  };

  it('LOGO: the horizontal Barro Industries logo and the Barro Kitchens mark exist on disk; the old -logo-horizontal path does not', () => {
    assert.equal(FC.HEADER_LOGO, 'icons/barro-industries-horizontal.png');
    assert.ok(fs.existsSync(path.join(ROOT, FC.HEADER_LOGO)), `${FC.HEADER_LOGO} is missing`);
    assert.equal(FC.BRAND.BK.mark, 'icons/barro-kitchens.png');
    assert.ok(fs.existsSync(path.join(ROOT, FC.BRAND.BK.mark)), `${FC.BRAND.BK.mark} is missing`);
    assert.deepEqual(Object.keys(FC.BRAND), ['BK'], 'only Barro Kitchens has a brand header');
    assert.ok(!fs.existsSync(path.join(ROOT, 'icons/barro-industries-logo-horizontal.png')), 'the superseded file name came back');
    const { size } = fs.statSync(path.join(ROOT, FC.HEADER_LOGO));
    assert.ok(size > 10_000 && size < 200_000, `logo is ${size} bytes`);
  });
  const leftOf = (html) => { const h = html.slice(html.indexOf('<div class="fh-header">'), html.indexOf('<div class="fh-doc">')); return { raw: h, text: stripTags(h.replace(/<\/div>/g, ' ')).replace(/\s+/g, ' ').trim() }; };
  it('BRAND (owner 2026-11-20): a Barro Kitchens document leads with the Barro Kitchens mark and BARRO KITCHENS, "By Barro Industries OPC" under it, then address, phone, both emails — and no Barro Industries logo', () => {
    const { raw, text } = leftOf(headerOf('BK').html);
    assert.match(raw, /^<div class="fh-header"><div class="fh-id"><div class="fh-brand"><img class="fh-mark" src="icons\/barro-kitchens\.png"[^>]*><div><div class="fh-name">BARRO KITCHENS<\/div><div class="fh-legal">By Barro Industries OPC<\/div>/);
    assert.equal(text, 'BARRO KITCHENS By Barro Industries OPC 21 Capricorn St., Tandang Sora, Quezon City · 0927 683 6300 · hello@barroindustries.com · barroindustries@gmail.com');
    assert.ok(!headerOf('BK').html.includes('barro-industries-horizontal'), 'no horizontal BI logo on a Barro Kitchens document');
  });
  it('Barro Industries documents (and Brilliant Steel orders, whose form company is BI) keep the horizontal logo and the owner\'s company line, with no Barro Kitchens mark', () => {
    assert.equal(FC.HEADER_LINE, 'Barro Industries OPC · 21 Capricorn St., Tandang Sora, Quezon City · hello@barroindustries.com · barroindustries@gmail.com · 0927 683 6300');
    for (const co of ['BI', 'BS', 'ZZ']) {
      const { html } = headerOf(co); const { raw, text } = leftOf(html);
      assert.match(raw, /src="icons\/barro-industries-horizontal\.png"/, co);
      assert.equal(text, FC.HEADER_LINE, co);
      assert.ok(!html.includes('barro-kitchens.png') && !html.includes('fh-brand') && !html.includes('BARRO KITCHENS'), `${co} carries the Barro Kitchens brand`);
    }
  });
  it('the right column starts with the title on every form; legal lines keep Barro Industries OPC; nothing of Brilliant Steel on a form', () => {
    const bk = headerOf('BK').html, bi = headerOf('BI').html, bs = headerOf('BS').html;
    for (const html of [bk, bi, bs]) {
      assert.match(html, /<div class="fh-doc"><div class="fh-title">SALES ORDER<\/div>/);
      assert.ok(!html.includes('fh-tile'), 'the old BK tile is gone');
      assert.ok(!html.includes('BRILLIANT STEEL') && !html.includes('Pasig'), 'nothing of Brilliant Steel on a form'); assert.ok(!html.includes('37474F'));
    }
    assert.match(bs, /Thank you for considering Barro Industries\./);
    assert.match(bk, /Thank you for considering Barro Kitchens\./);
    assert.match(bk, /Barro Industries OPC  •  SEC Registered/, 'the creds footer keeps the legal company');
    assert.equal(FC.COMPANIES.BK.sig.title, 'President, Barro Industries OPC', 'signatures keep the legal company');
  });
  it('title, number, date and the reference lines are in the right column, in that order', () => {
    const { html } = headerOf('BK');
    const doc = html.slice(html.indexOf('<div class="fh-doc">'), html.indexOf('<div class="bill-strip"'));
    assert.deepEqual([...doc.matchAll(/class="fh-(title|no|date|meta)">([^<]*)</g)].map((m) => [m[1], m[2]]),
      [['title', 'SALES ORDER'], ['no', 'SO-123456'], ['date', 'November 17, 2026'], ['meta', 'Quotation ref: BKMLFB260730-001R3']]);
  });
  it('the sheet uses the owner\'s navy #1F3A5F everywhere (and no #1E3A5F)', () => {
    assert.equal(FC.NAVY, '#1F3A5F'); assert.equal(FC.accentFor('BK'), '#1F3A5F');
    assert.ok(FC.CSS.includes('#1F3A5F') && !/1E3A5F/i.test(FC.CSS));
    assert.match(FC.CSS, /\.sec-title\{[^}]*color:#1F3A5F;border-bottom:1\.5px solid #1F3A5F/);
    assert.match(FC.CSS, /\.fh-header\{[^}]*border-bottom:2\.5px solid #1F3A5F/);
    assert.match(FC.CSS, /\.fh-mark\{[^}]*width:48px;height:48px/);
    assert.ok(!FC.CSS.includes('.fh-tile'));
    assert.match(FC.CSS, /@page\{size:A4 portrait;margin:11mm 10mm 7mm;\}/, 'letterhead\'s print geometry: A4, 11mm 10mm 7mm');
  });
  it('the header stays compact: logo 56 px, one reference line on a Sales Order, no Subject / Original line — what lets a six-line order fit ONE A4 page', () => {
    // Page fit itself needs a layout engine: measured in a real browser (BK six-line order: 1120 of 1123 px, Barro Industries 33 px to spare; a seventh line
    // overflows) and noted in the commit report. What Node can pin is every term of the header's height.
    assert.match(FC.CSS, /\.fh-logo\{[^}]*height:56px;[^}]*margin:-10\.64px 0 -10\.64px -14\.45px/);
    assert.match(FC.CSS, /\.fh-header\{[^}]*margin-bottom:8px;padding-bottom:7px/);
    assert.match(FC.CSS, /\.fh-title\{font-size:14pt/); assert.match(FC.CSS, /\.fh-co\{margin-top:1\.5mm;font-size:8pt;line-height:1\.45/);
    const { p, html } = headerOf('BK', { quote: { subject: 'Prep tables, sink, hood' } });
    assert.deepEqual(p.extraMeta, ['Quotation ref: BKMLFB260730-001R3']);
    assert.ok(!html.includes('Subject:') && !html.includes('Original:'));
    assert.equal((html.match(/class="fh-meta"/g) || []).length, 1);
    assert.match(html, /class="f-proj">Project: Prep tables, sink, hood</, 'the subject is the bill-to strip\'s third line');
  });
  it('FormsCore.COMPANIES is the quote builder\'s own table, string for string (BK, BI, BS) — it feeds the thanks line, creds line and signer', () => {
    for (const code of ['BK', 'BI', 'BS']) {
      const mine = FC.COMPANIES[code], theirs = builderCO[code];
      for (const k of ['name', 'sub', 'addr', 'contact', 'thanks', 'creds', 'code', 'logo']) assert.equal(mine[k], theirs[k], `${code}.${k} drifted from quote-builder-v2.html`);
      assert.deepEqual({ ...mine.sig }, { ...theirs.sig }, `${code}.sig`);
      for (const k of ['name', 'sub', 'addr', 'contact', 'thanks', 'creds', 'code']) assert.equal(mine[k], configCompanies[code][k], `${code}.${k} drifted from js/config.js`);
    }
  });
  it('companyOf follows the order / quote (unknown → BI); formCompany turns Brilliant Steel into BI for a FORM', () => {
    assert.equal(FC.companyOf({ company: 'BK' }), 'BK'); assert.equal(FC.companyOf({ company: 'bs' }), 'BS'); assert.equal(FC.companyOf({ company: ' BI ' }), 'BI');
    assert.equal(FC.companyOf({ company: 'BK' }, { company: 'BS' }), 'BK', 'the order wins over the project');
    assert.equal(FC.companyOf(null, { company: 'BS' }), 'BS', 'then the next record');
    assert.equal(FC.companyOf({ company: 'XX' }, { company: 'BS' }), 'BS', 'an unknown code is skipped, not trusted');
    for (const odd of [undefined, null, {}, { company: '' }, { company: 'PT' }, { company: 'constructor' }, { company: '__proto__' }, { company: 'toString' }]) assert.equal(FC.companyOf(odd), 'BI', JSON.stringify(odd));
    assert.equal(FC.formCompany('BK'), 'BK'); assert.equal(FC.formCompany('BI'), 'BI'); assert.equal(FC.formCompany('BS'), 'BI'); assert.equal(FC.formCompany(undefined), 'BI');
    assert.equal(headerOf('BS').p.company, 'BI'); assert.equal(headerOf('BK').p.company, 'BK');
  });
});

describe('3. the peso wall (§9.7)', () => {
  const { project } = fixtures();
  it('the four Phase 1 entries are registered with the spec\'s titles and audiences', () => {
    const got = Object.fromEntries(FC.list().map((e) => [e.id, [e.title, e.audience]]));
    assert.deepEqual(got, { sales_order: ['SALES ORDER', 'sales'], payment_ack: ['PAYMENT ACKNOWLEDGEMENT', 'sales'], job_order: ['JOB ORDER', 'ops'], handoff_pack: ['HANDOFF PACK', 'ops'] });
    for (const e of FC.list()) { assert.equal(e.bodySet, 'js/forms-set-1.js'); assert.equal(e.orientation, 'portrait'); }
    for (const id of ['job_order', 'handoff_pack']) assert.deepEqual(FC.get(id).needs, ['js/screens/production.js']);
  });
  it('registering an ops entry with a money:true field throws, and registers nothing', () => {
    const bad = { id: 't_ops_money', title: 'TEST OPS', audience: 'ops', fields: [{ key: 'ok', from: 'a' }, { key: 'contract', money: true, from: 'b' }] };
    assert.throws(() => FC.register(bad), (e) => e.code === 'ops-money-field' && /cannot register a money field/.test(e.message));
    assert.equal(FC.get('t_ops_money'), null);
  });
  it('a sales entry may carry money fields; a duplicate id and a bad audience are refused', () => {
    FC.register({ id: 't_sales_money', title: 'TEST SALES', audience: 'sales', fields: [{ key: 'contract', money: true, from: 'x' }] });
    assert.ok(FC.get('t_sales_money'));
    assert.throws(() => FC.register({ id: 't_sales_money', title: 'TEST SALES', audience: 'sales', fields: [] }), (e) => e.code === 'duplicate');
    FC._unregister('t_sales_money');
    assert.throws(() => FC.register({ id: 't_x', title: 'T', audience: 'everyone', fields: [] }), (e) => e.code === 'bad-entry');
  });
  it('build() copies ONLY declared fields: a record full of prices produces a job_order without them', () => {
    const data = FC.build(FC.get('job_order'), ctxOf({ project }));
    assert.deepEqual(Object.keys(data).sort(), FC.get('job_order').fields.map((f) => f.key).sort());
    const json = JSON.stringify(data);
    for (const leak of ['unitPrice', 'amount', 'contractAmount', 'amountCollected', 'arBalance', 'capital', 'payments', 'dpPercent', '150000', '75000', '41000', '20000', '35000']) assert.ok(!json.includes(leak), `job_order data carries "${leak}"`);
    assert.equal(data.lines.length, 2);
    assert.deepEqual(Object.keys(data.lines[0]).sort(), ['adjustment', 'catLabel', 'code', 'dims', 'location', 'name', 'notes', 'qty', 'specs', 'unit'], 'the workforce copy takes only what it prints (code is the money-free model code)');
  });
  it('…and the same for the handoff pack', () => {
    const data = FC.build(FC.get('handoff_pack'), ctxOf({ project }, PEOPLE.rene));
    const json = JSON.stringify(data);
    for (const leak of ['unitPrice', 'amount', 'contractAmount', 'amountCollected', 'arBalance', 'capital', 'payments', '150000', '75000', '41000']) assert.ok(!json.includes(leak), `handoff_pack data carries "${leak}"`);
  });
  it('assertNoPesos throws on a ₱ in instructions, on PHP / Php, on a priced key, at any depth — and passes a clean job order', () => {
    assert.throws(() => FC.assertNoPesos({ instructions: 'Collect ₱5,000 on delivery' }), (e) => e.code === 'peso-in-text' && e.message === 'This form has a price in its notes. Remove it, then try again.');
    assert.throws(() => FC.assertNoPesos({ a: { b: [{ note: 'PHP 5000' }] } }), (e) => e.code === 'peso-in-text');
    assert.throws(() => FC.assertNoPesos({ salesNotes: 'balance Php 12,000' }), (e) => e.code === 'peso-in-text');
    for (const key of ['unitPrice', 'amount', 'total', 'cost', 'peso', 'contractAmount', 'paid', 'collected', 'balance', 'budget', 'margin', 'markup', 'vatAmount', 'discount', 'fee', 'credit', 'refund']) {
      assert.throws(() => FC.assertNoPesos({ lines: [{ name: 'x', [key]: 1 }] }), (e) => e.code === 'peso-key', key);
    }
    assert.equal(FC.assertNoPesos(FC.build(FC.get('job_order'), ctxOf({ project }))), true);
  });
  it('a job order with "₱5,000" typed in its instructions is refused with the plain message — never printed', () => {
    const bad = fixtures().project; bad.jobOrder.instructions = 'Balance of ₱5,000 is collected on delivery';
    const prep = FC.prepare('job_order', ctxOf({ project: bad }, PEOPLE.rene));
    assert.equal(prep.ok, false);
    assert.equal(prep.code, 'peso-in-text');
    assert.equal(prep.error, 'This form has a price in its notes. Remove it, then try again.');
  });
  it('…also in the notes from Sales, in the quote\'s subject, in a scope line\'s note, and in the handoff pack', () => {
    const a = fixtures().project; a.notes = 'quoted ₱20,000 per unit';
    assert.equal(FC.prepare('job_order', ctxOf({ project: a }, PEOPLE.rene)).code, 'peso-in-text');
    assert.equal(FC.prepare('handoff_pack', ctxOf({ project: a }, PEOPLE.rene)).code, 'peso-in-text');
    const b = fixtures().project; b.jobOrder.items[0].notes = 'PHP 500 extra';
    assert.equal(FC.prepare('job_order', ctxOf({ project: b }, PEOPLE.rene)).code, 'peso-in-text');
    assert.equal(FC.prepare('job_order', ctxOf({ project: fixtures().project, quote: { subject: 'Kitchen for ₱1M' } }, PEOPLE.rene)).code, 'peso-in-text');
  });
  it('the body helper h.peso() throws on an Operations form and formats on a Sales form', () => {
    assert.throws(() => FC.makeHelpers(FC.get('job_order')).peso(5), (e) => e.code === 'peso-on-ops');
    assert.throws(() => FC.makeHelpers(FC.get('handoff_pack')).peso(5), (e) => e.code === 'peso-on-ops');
    assert.equal(FC.makeHelpers(FC.get('sales_order')).peso(1234.5), '₱1,234.50');
  });
  it('an Operations form is identical for every viewer: the built page does not depend on who is looking', () => {
    const build = (v) => { const p = FC.prepare('job_order', ctxOf({ project: fixtures().project }, v)); return FC.compose(p, FC.renderSections(p)).bodyHtml; };
    assert.equal(build(PEOPLE.rene), build(PEOPLE.neil));
    assert.equal(build(PEOPLE.rene), build(PEOPLE.shaira));
    assert.equal(build(PEOPLE.rene), build(PEOPLE.designer));
  });
});

describe('4. who may open what (audience table)', () => {
  const who = Object.keys(PEOPLE);
  const expected = {                       // [ops, sales, finance]
    neil: [1, 1, 1], manager: [1, 1, 1], shairaRole: [1, 1, 1], shaira: [1, 1, 1],
    uriel: [1, 1, 0], rene: [1, 0, 0], mcarthur: [1, 0, 0], designer: [1, 0, 0],
    secretary: [1, 0, 0], secFinance: [1, 0, 0], secSales: [1, 1, 0], nobody: [0, 0, 0],
  };
  for (const person of who) {
    it(`${person}: ops / sales / finance = ${expected[person].join('/')}`, () => {
      const got = ['ops', 'sales', 'finance'].map((a) => (FC.canOpenAudience(a, PEOPLE[person]) ? 1 : 0));
      assert.deepEqual(got, expected[person]);
    });
  }
  it('every ops form opens for Production members — with or without Design (Rene is Production only today; Design may be added)', () => {
    for (const id of ['job_order', 'handoff_pack']) for (const p of ['rene', 'mcarthur', 'designer']) assert.equal(FC.canOpen(id, PEOPLE[p]), true, `${id} / ${p}`);
    assert.equal(FC.canOpen('job_order', { role: 'employee', depts: ['Production', 'Design'] }), true);
    assert.equal(FC.canOpen('job_order', { role: 'employee', depts: ['Production'] }), true);
    assert.equal(FC.canOpen('sales_order', PEOPLE.rene), false);
    assert.equal(FC.canOpen('payment_ack', PEOPLE.rene), false);
  });
  it('alsoDepts widens a sales/finance entry (used by the purchasing forms later)', () => {
    assert.equal(FC.canOpenAudience('sales', PEOPLE.rene, ['Production']), true);
    assert.equal(FC.canOpenAudience('finance', PEOPLE.uriel, ['Sales']), true);
    assert.equal(FC.canOpenAudience('finance', PEOPLE.secFinance, ['Finance']), false, 'the secretary is never a Finance member');
  });
  it('a viewer object may name departments as `departments` or a single `department` (the profile shapes)', () => {
    assert.equal(FC.canOpenAudience('sales', { role: 'employee', departments: ['Sales'] }), true);
    assert.equal(FC.canOpenAudience('sales', { role: 'employee', department: 'Sales' }), true);
    assert.equal(FC.canOpenAudience('sales', { role: 'employee', department: 'Production' }), false);
  });
  it('prepare() refuses what the viewer may not open', () => {
    const { order, project } = fixtures();
    const r = FC.prepare('sales_order', ctxOf({ order, project }, PEOPLE.rene));
    assert.equal(r.ok, false); assert.equal(r.code, 'not-allowed');
    assert.equal(FC.prepare('sales_order', ctxOf({ order, project }, PEOPLE.uriel)).ok, true);
  });
});

describe('5. prepare / compose', () => {
  let fx;
  beforeEach(() => { fx = fixtures(); });
  const page = (id, ctx, viewer, opts) => { const p = FC.prepare(id, ctxOf(ctx, viewer), opts); assert.equal(p.ok, true, p.error); return { p, c: FC.compose(p, FC.renderSections(p)) }; };
  const quote = { subject: 'Prep tables, sink, hood', subtotal: 150000, discountAmount: 0, vatIncluded: false, total: 150000, payment: { balanceMode: 'lump' }, timeline: { startDate: '2026-11-18', leadDays: 35, completionDate: '2026-12-23' } };

  it('payment_ack refuses any record whose status is not "recorded"', () => {
    for (const status of ['pending', 'payment_rejected', undefined, '']) {
      fx.order.status = status;
      const r = FC.prepare('payment_ack', ctxOf({ order: fx.order, project: fx.project }, PEOPLE.shaira));
      assert.equal(r.ok, false, String(status)); assert.equal(r.code, 'refused');
      assert.match(r.error, /has not been confirmed yet/);
    }
    fx.order.status = 'recorded';
    assert.equal(FC.prepare('payment_ack', ctxOf({ order: fx.order, project: fx.project }, PEOPLE.shaira)).ok, true);
    assert.equal(FC.prepare('payment_ack', ctxOf({ claim: { id: 'c1', orderId: fx.order.id, status: 'pending' }, order: fx.order }, PEOPLE.shaira)).ok, false, 'a pending claim');
    assert.equal(FC.prepare('payment_ack', ctxOf({ claim: { id: 'c1', orderId: fx.order.id, status: 'recorded', recordedAmount: 10 }, order: fx.order }, PEOPLE.shaira)).ok, true);
  });

  it('numbers: a stored serial wins, then the PAIR\'s serial, then the §9.5 fallbacks (SO / PA = last 6 of the id, JO = the old derived number)', () => {
    let { p } = page('sales_order', { order: fx.order, project: fx.project }, PEOPLE.uriel);
    assert.equal(p.number, 'SO-123456'); assert.equal(p.numberSource, 'fallback');
    fx.project.joNumber = 'JO-0012';
    ({ p } = page('sales_order', { order: fx.order, project: fx.project }, PEOPLE.uriel));
    assert.equal(p.number, 'SO-0012', 'the job carries the serial: the sales order reads it'); assert.equal(p.numberSource, 'pair');
    fx.order.soNumber = 'SO-0012'; delete fx.project.joNumber;
    ({ p } = page('job_order', { project: fx.project, order: fx.order }, PEOPLE.rene));
    assert.equal(p.number, 'JO-0012', 'the order carries the serial: the job order reads it'); assert.equal(p.numberSource, 'pair'); assert.equal(p.fileName, 'JO-0012.pdf');
    fx.project.joNumber = 'JO-0012'; fx.order.soNumber = 'SO-0012';
    assert.equal(page('sales_order', { order: fx.order, project: fx.project }, PEOPLE.uriel).p.numberSource, 'stored');
    assert.equal(page('job_order', { project: fx.project, order: fx.order }, PEOPLE.rene).p.numberSource, 'stored');
    ({ p } = page('payment_ack', { order: fx.order, project: fx.project }, PEOPLE.shaira));
    assert.equal(p.number, 'PA-123456');
    fx.order.paNumber = 'PA-0031';
    ({ p } = page('payment_ack', { order: fx.order, project: fx.project }, PEOPLE.shaira));
    assert.equal(p.number, 'PA-0031'); assert.equal(p.fileName, 'PA-0031.pdf');
    // a LEGACY job keeps its old number: derived from the quote number exactly as production.js always did
    const legacy = fixtures(); legacy.project.quoteNumber = 'BK-ML-FB-260730-001-R3';
    ({ p } = page('job_order', { project: legacy.project }, PEOPLE.rene));
    assert.equal(p.number, 'JO-ML-FB-260730-001'); assert.equal(p.number, globalThis.jobOrderNoFor(legacy.project)); assert.equal(p.numberSource, 'fallback');
  });

  it('revisions print as the quote does — "SO-0012 R2", "JO-0012 R1" — in the header, the title and the file name; never "Rev."; the revision date alone', () => {
    fx.order.soNumber = 'SO-0012'; fx.order.contractRev = 2;
    fx.order.revisions = [{ revNo: 1, toAmount: 120000, fromAmount: 100000, decidedAt: '2026-11-18T09:00:00Z', arAfter: 55000, reason: 'Client added a pot rack', delta: 20000 }, { revNo: 2, toAmount: 150000, decidedAt: '2026-11-19T09:00:00Z', reason: 'More shelves', delta: 30000 }];
    fx.order.releasedAt = fx.ts('2026-11-17T09:00:00Z');
    const so = page('sales_order', { order: fx.order, project: fx.project }, PEOPLE.uriel);
    assert.equal(so.p.numberText, 'SO-0012 R2'); assert.equal(so.c.fileName, 'SO-0012-R2.pdf'); assert.equal(so.c.title, 'Sales Order — SO-0012 R2');
    assert.ok(so.c.bodyHtml.includes('<div class="fh-no">SO-0012 R2</div>'));
    assert.ok(!/Rev\./.test(so.c.bodyHtml) && !/Rev\b/.test(stripTags(so.c.bodyHtml).replace(/\(Rev [A-Z]\)/g, '')), 'no "Rev" label anywhere on the page');
    assert.equal(so.p.dateIso, '2026-11-19', 'a revised form carries the revision date');
    assert.ok(!so.p.extraMeta.some((m) => /^Original/.test(m)), 'and nothing else about dates (the reviewed prototype shows none)');
    assert.ok(stripTags(so.c.bodyHtml).includes('Total Contract Price (revised, R2)') && stripTags(so.c.bodyHtml).includes('Balance (recalculated after R2)'));
    fx.project.joNumber = 'JO-0012'; fx.project.joRev = 1; fx.project.joRevAt = '2026-11-19T01:00:00Z';
    const jo = page('job_order', { project: fx.project, order: fx.order }, PEOPLE.rene);
    assert.equal(jo.p.numberText, 'JO-0012 R1'); assert.equal(jo.c.fileName, 'JO-0012-R1.pdf'); assert.equal(jo.c.title, 'Job Order — JO-0012 R1');
    assert.ok(jo.c.bodyHtml.includes('<div class="fh-no">JO-0012 R1</div>'));
    assert.deepEqual(jo.p.extraMeta, ['WORKFORCE COPY — NO PRICES', 'Quotation ref: BKMLFB260730-001R3', 'Sales order ref: SO-0012 R2'], 'the job order names its sales order WITH the sales order\'s own R (they revise on their own clocks)');
    assert.ok(!/Rev\./.test(jo.c.bodyHtml));
  });
  it('an EARLIER revision prints where the order kept it (watermarked SUPERSEDED) and is refused where it did not', () => {
    fx.order.soNumber = 'SO-0012'; fx.order.contractRev = 2; fx.order.originalContractAmount = 100000;
    fx.order.revisions = [{ revNo: 1, toAmount: 120000, fromAmount: 100000, decidedAt: '2026-11-18T09:00:00Z', arAfter: 55000 }, { revNo: 2, toAmount: 150000, decidedAt: '2026-11-19T09:00:00Z', arAfter: 75000 }];
    const r1 = FC.prepare('sales_order', ctxOf({ order: fx.order, project: fx.project }, PEOPLE.uriel), { rev: 1 });
    assert.equal(r1.ok, true); assert.equal(r1.numberText, 'SO-0012 R1'); assert.equal(r1.watermark, 'SUPERSEDED');
    assert.equal(r1.data.contract, 120000); assert.equal(r1.data.balance, 55000);
    const r0 = FC.prepare('sales_order', ctxOf({ order: fx.order, project: fx.project }, PEOPLE.uriel), { rev: 0 });
    assert.equal(r0.ok, true); assert.equal(r0.numberText, 'SO-0012'); assert.equal(r0.data.contract, 100000);
    assert.equal(FC.prepare('sales_order', ctxOf({ order: fx.order, project: fx.project }, PEOPLE.uriel), { rev: 7 }).code, 'no-such-revision');
    assert.equal(FC.prepare('sales_order', ctxOf({ order: fx.order, project: fx.project }, PEOPLE.uriel), { rev: 2 }).watermark, '', 'the current revision is not superseded');
    fx.project.joNumber = 'JO-0012'; fx.project.joRev = 2;
    assert.equal(FC.prepare('job_order', ctxOf({ project: fx.project }, PEOPLE.rene), { rev: 1 }).code, 'no-such-revision', 'a job order keeps no per-revision snapshot');
    assert.equal(FC.prepare('payment_ack', ctxOf({ order: fx.order }, PEOPLE.shaira), { rev: 1 }).code, 'no-such-revision');
  });

  it('the Sales Order follows the prototype: bill-to strip with the grey Project line, Order Items, Subtotal / GRAND TOTAL, Payment, Project Timeline, six grey terms cards, then the dividers', () => {
    fx.order.soNumber = 'SO-0012'; fx.order.paNumber = 'PA-0366'; fx.order.dpPercent = 65; fx.project.dpPercent = 65;
    const { c } = page('sales_order', { order: fx.order, project: fx.project, client: fx.client, quote }, PEOPLE.uriel);
    const text = stripTags(c.bodyHtml);
    for (const needle of ['class="bill-strip"', 'class="f-proj">Project: Prep tables, sink, hood<', 'class="items-table"', 'class="cat-row"', 'class="subtotal-row"', 'class="totals-tbl"', 'class="pay-tbl"', 'class="pay-head"',
      'class="terms-grid"', 'class="sig-row"', 'class="print-footer"']) assert.ok(c.bodyHtml.includes(needle), `missing ${needle}`);
    assert.ok(!c.bodyHtml.includes('Subject:'), 'the subject is folded into the strip, not a line of its own');
    for (const w of ['BILL TO:', 'Order Items', 'GRAND TOTAL', 'Total Contract Price', 'Down Payment (65%) — received November 18, 2026 · PA-0366', 'Balance — payable in full upon completion',
      'Start Date (basis)', 'Overall Lead Time', '35 calendar days', 'Estimated Completion', 'Completion', 'Payment Terms', 'Warranty', 'Scope of Work', 'Site Requirements', 'Acceptance',
      'Barro Kitchens is not liable for delays due to unprepared site conditions.', 'All amounts in Philippine Peso (₱), VAT exclusive.']) assert.ok(text.includes(w), `missing "${w}"`);
    assert.deepEqual([...c.bodyHtml.matchAll(/<div class="terms-block[^"]*"[^>]*><h4>([^<]*)</g)].map((m) => m[1]), ['Completion', 'Payment Terms', 'Warranty', 'Scope of Work', 'Site Requirements', 'Acceptance']);
    // the dividers are INSIDE the terms section, as in the quote, and exactly one set
    assert.equal((c.bodyHtml.match(/class="sig-row/g) || []).length, 1);
    assert.ok(c.bodyHtml.indexOf('class="sig-row') > c.bodyHtml.indexOf('Acceptance'));
    assert.deepEqual([...c.bodyHtml.matchAll(/class="sig-role">([^<]*)</g)].map((m) => m[1]), ['Prepared by', 'Reviewed &amp; Approved by', 'Conforme — Accepted by Client']);
    assert.ok(c.bodyHtml.includes('class="sig-name">NEIL BARRO<') && c.bodyHtml.includes('President, Barro Industries OPC'));
    assert.match(FC.CSS, /\.sig-name\{[^}]*text-transform:uppercase/, 'names are upper-cased by the sheet CSS');
  });
  it('for a Barro Industries order the terms name Barro Industries OPC; Brilliant Steel orders are treated as Barro Industries', () => {
    for (const co of ['BI', 'BS']) { fx.order.company = co; fx.project.company = co; assert.ok(stripTags(page('sales_order', { order: fx.order, project: fx.project }, PEOPLE.uriel).c.bodyHtml).includes('Barro Industries OPC is not liable for delays')); }
  });

  it('the workforce copy: JO and Handoff pack carry the tag in the header and ±5mm; Sales Order and Payment Acknowledgement do not', () => {
    const jo = page('job_order', { project: fx.project }, PEOPLE.rene).c.bodyHtml;
    const hp = page('handoff_pack', { project: fx.project }, PEOPLE.rene).c.bodyHtml;
    for (const html of [jo, hp]) { assert.match(html, /class="fh-meta">WORKFORCE COPY — NO PRICES</); assert.match(html, /±5mm measurement tolerance/); }
    const so = page('sales_order', { order: fx.order, project: fx.project }, PEOPLE.uriel).c.bodyHtml;
    const pa = page('payment_ack', { order: fx.order, project: fx.project }, PEOPLE.shaira).c.bodyHtml;
    for (const html of [so, pa]) assert.ok(!html.includes('WORKFORCE COPY'));
  });
  it('JO and Handoff pack: item columns are # / DESCRIPTION / QTY / UNIT only — no price column, no total, no peso — for any viewer', () => {
    for (const v of [PEOPLE.rene, PEOPLE.neil, PEOPLE.uriel]) for (const id of ['job_order', 'handoff_pack']) {
      const html = page(id, { project: fx.project }, v).c.bodyHtml;
      assert.doesNotMatch(html, /₱|PHP|Php/, `${id}/${v.name}`);
      assert.doesNotMatch(html, /150,?000|75,?000|41,?000|20,?000|35,?000|40,?000|66,?964|Unit Price|GRAND TOTAL|Balance|Subtotal/i, `${id}/${v.name}`);
      const itemsTable = html.slice(html.indexOf('<table class="items-table">'), html.indexOf('</table>', html.indexOf('<table class="items-table">')));
      assert.deepEqual([...itemsTable.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]), ['#', 'Description', 'Qty', 'Unit'], `${id} columns`);
    }
  });
  it('the job order: timeline, special requests, revision history, three solo dividers (prepared / reviewed & approved / received)', () => {
    fx.project.joNumber = 'JO-0012'; fx.project.joRev = 1; fx.project.joRevAt = '2026-11-19T01:00:00Z';
    const { c } = page('job_order', { project: fx.project, workOrders: [{ orderNo: 'WO-0007' }], drawings: [{ title: 'LAYOUT.pdf', status: 'released', currentRev: 'B' }, { title: 'draft.pdf', status: 'draft' }] }, PEOPLE.rene);
    const text = stripTags(c.bodyHtml);
    for (const w of ['Job Order Items', 'Project Timeline & Completion', 'Start Date (basis)', 'November 24, 2026', 'Deadline', 'December 20, 2026', 'Delivery & Installation Site', 'Work Orders', 'WO-0007', 'Drawings', 'LAYOUT.pdf (Rev B)',
      'Special Requests', 'Use the east gate. Deliver before 3pm.', 'Revision History', 'R1', 'Contract revised by Sales. Items and dimensions are unchanged unless a change order is listed above.']) assert.ok(text.includes(w), `missing "${w}"`);
    assert.ok(!text.includes('draft.pdf'), 'only released drawings');
    assert.ok(c.bodyHtml.includes('class="sig-row solo"'));
    assert.deepEqual([...c.bodyHtml.matchAll(/class="sig-role">([^<]*)</g)].map((m) => m[1]), ['Prepared by', 'Reviewed &amp; Approved by', 'Received by']);
    assert.ok(!c.bodyHtml.includes('class="terms-grid"'), 'a workforce copy has no terms cards');
  });

  it('every dynamic string is escaped', () => {
    fx.order.clientName = '<script>alert(1)</script>'; fx.order.items[0].name = '<img src=x onerror=alert(1)>';
    const html = page('sales_order', { order: fx.order, project: fx.project, quote: { subject: 'a "quoted" <b>subject</b>' } }, PEOPLE.uriel).c.bodyHtml;
    assert.ok(!html.includes('<script>') && !html.includes('<img src=x') && !html.includes('<b>subject</b>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && html.includes('&lt;b&gt;subject&lt;/b&gt;'));
    fx.project.jobOrder.instructions = '<svg onload=alert(1)>'; fx.project.name = '"><script>x</script>';
    const jo = page('job_order', { project: fx.project }, PEOPLE.rene).c.bodyHtml;
    assert.ok(!jo.includes('<svg onload') && !jo.includes('<script>x'));
  });

  it('the Sales Order\'s Subtotal / Discount / VAT ladder prints only when it reconciles with the contract amount', () => {
    fx.order.contractAmount = 201600;
    const q = { subtotal: 200000, discountPct: 10, discountAmount: 20000, vatIncluded: true, vatAmount: 21600, total: 201600 };
    let d = page('sales_order', { order: fx.order, project: fx.project, quote: q }, PEOPLE.uriel);
    assert.deepEqual(d.p.data.ladder.map((r) => r.label), ['Subtotal', 'Discount (10%)', 'VAT (12%)']);
    assert.ok(d.c.bodyHtml.includes('Discount (10%)') && d.c.bodyHtml.includes('VAT (12%)'));
    assert.ok(stripTags(d.c.bodyHtml).includes('VAT included'));
    d = page('sales_order', { order: fx.order, project: fx.project, quote: { ...q, total: 190000 } }, PEOPLE.uriel);
    assert.equal(d.p.data.ladder, null, 'a quote that no longer matches the contract');
    d = page('sales_order', { order: fx.order, project: fx.project, quote: { ...q, subtotal: 150000 } }, PEOPLE.uriel);
    assert.equal(d.p.data.ladder, null, 'a ladder that does not add up');
    assert.ok(d.c.bodyHtml.includes('GRAND TOTAL'), 'the GRAND TOTAL row is always there');
  });

  it('the Payment Acknowledgement follows the prototype: Payment Received, Account Summary, Acknowledgement / Payment Terms / Note cards, Received · Confirmed · Client copy', () => {
    fx.order.paNumber = 'PA-0031'; fx.order.soNumber = 'SO-0012'; fx.order.dpPercent = 50; fx.order.orRef = 'UB-2610-4417'; fx.order.paymentDate = '2026-11-18';
    fx.order.paymentConfirm = { requestedByName: 'Uriel Sagaoinit', decidedByName: 'Shaira Tecag', decidedByRole: 'finance', onBehalf: true, decidedAt: '2026-11-18T08:00:00Z' };
    const { p, c } = page('payment_ack', { order: fx.order, project: fx.project, client: fx.client, quote }, PEOPLE.shaira);
    const text = stripTags(c.bodyHtml);
    for (const w of ['RECEIVED FROM:', 'Payment Received', 'Amount Received', '₱75,000', 'Payment Method', 'Bank Transfer', 'Reference No.', 'UB-2610-4417', 'Date Received', 'November 18, 2026', 'Payment For', 'Down Payment (50%) — SO-0012',
      'Account Summary', 'Total Contract Price', '₱150,000', 'Total Paid to Date', 'Balance Due', 'Acknowledgement', 'received by Barro Kitchens', 'Payment Terms', 'Note']) assert.ok(text.includes(w), `missing "${w}"`);
    assert.deepEqual(p.extraMeta, ['Sales order ref: SO-0012', 'Quotation ref: BKMLFB260730-001R3']);
    assert.deepEqual(p.signatures.map((s) => [s.role, s.name, s.lines[0], s.lines[1]]), [['Received by', 'Uriel Sagaoinit', 'Sales', undefined], ['Confirmed by', 'Shaira Tecag', 'Finance, for the President', 'Confirmed November 18, 2026'],
      ['Client copy — Acknowledged by', 'Mamitas Bulaluhan', 'Signature over printed name', 'Date: ___________________']]);
    assert.equal(p.dateIso, '2026-11-18');
    fx.order.paymentConfirm.onBehalf = false; fx.order.paymentConfirm.decidedByRole = 'president'; fx.order.paymentConfirm.decidedByName = 'Neil Barro';
    assert.equal(page('payment_ack', { order: fx.order, project: fx.project }, PEOPLE.shaira).p.signatures[1].lines[0], 'President');
  });
  it('the PA notice is "This is not an official receipt. The BIR official receipt is issued separately by Finance." — body text, allowed — and prints once', () => {
    assert.equal(FC.NOT_RECEIPT_NOTE, 'This is not an official receipt. The BIR official receipt is issued separately by Finance.');
    const c = page('payment_ack', { order: fx.order, project: fx.project }, PEOPLE.shaira).c;
    assert.equal(c.bodyHtml.split(FC.NOT_RECEIPT_NOTE).length - 1, 1);
    assert.ok(c.bodyHtml.includes('<div class="terms-block full" data-pdf-cut><h4>Note</h4><p>' + FC.NOT_RECEIPT_NOTE + '</p></div>'));
    assert.equal(FC.get('payment_ack').title, 'PAYMENT ACKNOWLEDGEMENT');
  });

  it('dates come from the record, in Manila time', () => {
    fx.order.releasedAt = fx.ts('2026-11-18T20:00:00Z');
    assert.equal(page('sales_order', { order: fx.order, project: fx.project }, PEOPLE.uriel).p.dateLabel, 'November 19, 2026');
    delete fx.order.releasedAt;
    assert.equal(page('sales_order', { order: fx.order, project: fx.project }, PEOPLE.uriel).p.dateLabel, 'November 17, 2026');
    delete fx.order.createdAt; delete fx.project.createdAt;
    assert.equal(page('sales_order', { order: fx.order, project: fx.project }, PEOPLE.uriel).p.dateLabel, 'November 19, 2026', 'falls back to today');
  });

  it('the preparer\'s job title comes off their profile; without one the box says Sales', () => {
    assert.deepEqual(page('sales_order', { order: fx.order, project: fx.project, preparer: { name: 'Uriel Sagaoinit', title: 'Sales Manager' } }, PEOPLE.uriel).p.signatures[0], { role: 'Prepared by', name: 'Uriel Sagaoinit', lines: ['Sales Manager'] });
    assert.deepEqual(page('sales_order', { order: fx.order, project: fx.project }, PEOPLE.uriel).p.signatures[0].lines, ['Sales']);
  });

  it('the handoff pack\'s number is derived from the job order\'s, it names the job order with its R, and it lists only RELEASED drawings', () => {
    fx.project.joNumber = 'JO-0012'; fx.project.joRev = 1;
    const { p, c } = page('handoff_pack', { project: fx.project, drawings: [{ title: 'Layout', status: 'released', currentRev: 'B' }, { title: 'Hood section', status: 'draft' }] }, PEOPLE.rene);
    assert.equal(p.number, 'HP-JO-0012'); assert.equal(p.numberText, 'HP-JO-0012'); assert.equal(p.fileName, 'HP-JO-0012.pdf');
    assert.ok(p.extraMeta.includes('Job order ref: JO-0012 R1'));
    assert.ok(c.bodyHtml.includes('Layout') && !c.bodyHtml.includes('Hood section'));
    assert.ok(c.bodyHtml.includes('1 more drawing(s) are not released yet'));
  });
});

describe('6. assigning serials (fake Firestore, never throws)', () => {
  let fake, fx;
  const seedOrder = (extra, pExtra) => { fake.seed('sales_orders/ordAbCdEf123456', { ...JSON.parse(JSON.stringify(fx.order)), ...(extra || {}) }); fake.seed('job_projects/projXyz1', { ...JSON.parse(JSON.stringify(fx.project)), ...(pExtra || {}) }); };
  beforeEach(() => { fake = createFake(); fx = fixtures(); FC.RULES.salesMayWriteSoNumber = false; });
  const ref = { orderId: 'ordAbCdEf123456', projectId: 'projXyz1' };

  it('SO and JO are ONE serial: SO-0001 and JO-0001, one counter (form_SO), none for the job order; calling twice changes nothing', async () => {
    seedOrder();
    const a = await FC.assignWith(fake.db, ['sales_order', 'job_order'], ref, PEOPLE.shaira);
    assert.deepEqual(a, { sales_order: 'SO-0001', job_order: 'JO-0001' });
    assert.equal(fake.read('sales_orders/ordAbCdEf123456').soNumber, 'SO-0001');
    assert.equal(fake.read('job_projects/projXyz1').joNumber, 'JO-0001');
    assert.equal(fake.read('_counters/form_SO').count, 1, 'ONE number was taken for the pair'); assert.equal(fake.has('_counters/form_JO'), false);
    const writes = fake.stats.writes;
    assert.deepEqual(await FC.assignWith(fake.db, ['sales_order', 'job_order'], ref, PEOPLE.shaira), a);
    assert.equal(fake.stats.writes, writes, 'a second call writes nothing'); assert.equal(fake.read('_counters/form_SO').count, 1, 'and burns no number');
  });
  it('the order of the request does not matter, and a half already numbered hands its serial to the other (no counter touched)', async () => {
    seedOrder({ soNumber: 'SO-0012' });
    assert.equal((await FC.assignWith(fake.db, ['job_order'], ref, PEOPLE.rene)).job_order, 'JO-0012');
    assert.equal(fake.read('job_projects/projXyz1').joNumber, 'JO-0012'); assert.equal(fake.has('_counters/form_SO'), false);
    fake.reset(); seedOrder({}, { joNumber: 'JO-0044' });
    assert.equal((await FC.assignWith(fake.db, ['sales_order'], ref, PEOPLE.neil)).sales_order, 'SO-0044');
    assert.equal(fake.read('sales_orders/ordAbCdEf123456').soNumber, 'SO-0044'); assert.equal(fake.has('_counters/form_SO'), false);
    fake.reset(); seedOrder();
    const both = await FC.assignWith(fake.db, ['sales_order', 'job_order'], ref, PEOPLE.neil);
    assert.equal(both.sales_order.slice(3), both.job_order.slice(3), 'same digits');
  });
  it('a Sales login (cannot write soNumber yet) still gets ONE consistent pair: the job takes the serial, the sales order reads it off', async () => {
    seedOrder();
    const a = await FC.assignWith(fake.db, ['sales_order', 'job_order'], ref, PEOPLE.uriel);
    assert.deepEqual(a, { sales_order: 'SO-0001', job_order: 'JO-0001' }, 'not a fallback SO number next to a real JO number');
    assert.equal(fake.read('job_projects/projXyz1').joNumber, 'JO-0001'); assert.equal(fake.read('sales_orders/ordAbCdEf123456').soNumber, undefined, 'and nothing the rules would refuse was written');
    assert.equal(fake.read('_counters/form_SO').count, 1);
  });
  it('serials continue from the counter: the next order gets SO-0012 / JO-0012', async () => {
    seedOrder(); fake.seed('_counters/form_SO', { count: 11 });
    assert.deepEqual(await FC.assignWith(fake.db, ['sales_order', 'job_order'], ref, PEOPLE.neil), { sales_order: 'SO-0012', job_order: 'JO-0012' });
  });
  it('writes ONLY the serial field — nothing else on the order or the job changes', async () => {
    seedOrder(); const before = fake.read('sales_orders/ordAbCdEf123456'), pBefore = fake.read('job_projects/projXyz1');
    await FC.assignWith(fake.db, ['sales_order', 'job_order'], ref, PEOPLE.neil);
    assert.deepEqual({ ...fake.read('sales_orders/ordAbCdEf123456'), soNumber: undefined }, { ...before, soNumber: undefined });
    assert.deepEqual({ ...fake.read('job_projects/projXyz1'), joNumber: undefined }, { ...pBefore, joNumber: undefined });
  });
  it('only where today\'s rules allow: a Sales login cannot store soNumber / paNumber (no write); Production CAN store joNumber', async () => {
    seedOrder();
    const a = await FC.assignWith(fake.db, ['sales_order'], ref, PEOPLE.uriel);
    assert.equal(a.sales_order, 'SO-123456');
    assert.equal(fake.read('sales_orders/ordAbCdEf123456').soNumber, undefined); assert.equal(fake.has('_counters/form_SO'), false); assert.equal(fake.stats.writes, 0);
    const b = await FC.assignWith(fake.db, ['job_order'], ref, PEOPLE.rene);
    assert.equal(b.job_order, 'JO-0001'); assert.equal(fake.read('job_projects/projXyz1').joNumber, 'JO-0001');
    assert.equal((await FC.assignWith(fake.db, ['payment_ack'], ref, PEOPLE.uriel)).payment_ack, 'PA-123456');
    assert.equal((await FC.assignWith(fake.db, ['payment_ack'], ref, PEOPLE.shaira)).payment_ack, 'PA-0001');
    assert.equal(fake.read('sales_orders/ordAbCdEf123456').paNumber, 'PA-0001'); assert.equal(fake.read('_counters/form_PA').count, 1);
  });
  it('FormsCore.RULES.salesMayWriteSoNumber (flipped with QF\'s rules change C4) lets Sales store soNumber', async () => {
    seedOrder(); FC.RULES.salesMayWriteSoNumber = true;
    try { assert.equal((await FC.assignWith(fake.db, ['sales_order'], ref, PEOPLE.uriel)).sales_order, 'SO-0001'); }
    finally { FC.RULES.salesMayWriteSoNumber = false; }
    assert.equal(FC.canStoreNumber('sales_orders', 'soNumber', PEOPLE.rene), false);
    assert.equal(FC.canStoreNumber('job_projects', 'contractAmount', PEOPLE.neil), false, 'never a field the rules treat as money');
    assert.equal(FC.canStoreNumber('job_projects', 'joNumber', PEOPLE.nobody), false);
  });
  it('a refused write burns no number: when the transaction fails, the counter is untouched and the fallback comes back', async () => {
    seedOrder(); fake.seed('_counters/form_SO', { count: 4 });
    const failing = { collection: fake.db.collection, runTransaction: async (fn) => fake.db.runTransaction(async (t) => { await fn(t); throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); }) };
    const a = await FC.assignWith(failing, ['sales_order'], ref, PEOPLE.neil);
    assert.equal(a.sales_order, 'SO-123456');
    assert.equal(fake.read('_counters/form_SO').count, 4); assert.equal(fake.read('sales_orders/ordAbCdEf123456').soNumber, undefined);
  });
  it('never throws: a missing order, a db that errors on every call, and no db at all all come back as fallbacks', async () => {
    assert.deepEqual(await FC.assignWith(fake.db, ['sales_order'], { orderId: 'ordMissing999' }, PEOPLE.neil), { sales_order: 'SO-ING999' });
    const broken = { collection: () => { throw new Error('offline'); }, runTransaction: async () => { throw new Error('offline'); } };
    const out = await FC.assignWith(broken, ['sales_order', 'job_order', 'payment_ack', 'handoff_pack', 'no_such_form'], ref, PEOPLE.neil);
    assert.equal(out.sales_order, 'SO-123456'); assert.equal(out.payment_ack, 'PA-123456'); assert.equal(out.no_such_form, '');
    assert.equal(typeof out.job_order, 'string');
    for (const db of [null, undefined]) assert.equal(typeof (await FC.assignWith(db, ['sales_order'], ref, PEOPLE.neil)).sales_order, 'string');
    assert.deepEqual(await FC.assignWith(fake.db, undefined, ref, PEOPLE.neil), {});
  });
  it('two taps at once hand out ONE serial (the counter and the field commit together)', async () => {
    seedOrder();
    const [a, b] = await Promise.all([FC.assignWith(fake.db, ['sales_order'], ref, PEOPLE.neil), FC.assignWith(fake.db, ['sales_order'], ref, PEOPLE.neil)]);
    assert.equal(a.sales_order, 'SO-0001'); assert.equal(b.sales_order, 'SO-0001');
    assert.equal(fake.read('_counters/form_SO').count, 1);
  });
  it('a payment claim\'s acknowledgement number is stored on the claim, not on the order', async () => {
    seedOrder(); fake.seed('payment_claims/claim1', { orderId: 'ordAbCdEf123456', projectId: 'projXyz1', status: 'recorded', kind: 'balance', recordedAmount: 1 });
    const out = await FC.assignWith(fake.db, ['payment_ack'], { claimId: 'claim1', orderId: 'ordAbCdEf123456' }, PEOPLE.shaira);
    assert.equal(out.payment_ack, 'PA-0001');
    assert.equal(fake.read('payment_claims/claim1').paNumber, 'PA-0001'); assert.equal(fake.read('sales_orders/ordAbCdEf123456').paNumber, undefined);
  });
  it('the handoff pack has no counter: its number is derived (HP- + the job order number)', async () => {
    seedOrder();
    assert.equal((await FC.assignWith(fake.db, ['handoff_pack'], ref, PEOPLE.rene)).handoff_pack, 'HP-' + globalThis.jobOrderNoFor(fx.project));
    assert.equal(fake.stats.writes, 0);
  });
  it('loadRecords reads fresh (order → projectId → job), uses preloaded docs without a read, and says not-found plainly', async () => {
    seedOrder();
    const r = await FC.loadRecords(fake.db, FC.get('sales_order'), ref);
    assert.equal(r.order.id, 'ordAbCdEf123456'); assert.equal(r.project.id, 'projXyz1');
    const viaOrder = await FC.loadRecords(fake.db, FC.get('job_order'), { orderId: 'ordAbCdEf123456' });
    assert.equal(viaOrder.project.id, 'projXyz1', 'a job order given only an order id'); assert.equal(viaOrder.order.id, 'ordAbCdEf123456', 'its order is read too (for the serial pair and the revisions)');
    const reads = Object.keys(fake.stats.docGets).length;
    const pre = await FC.loadRecords(null, FC.get('sales_order'), { record: fx.order, project: fx.project });
    assert.equal(pre.order.id, fx.order.id); assert.equal(Object.keys(fake.stats.docGets).length, reads);
    await assert.rejects(FC.loadRecords(fake.db, FC.get('sales_order'), { orderId: 'nope' }), (e) => e.code === 'not-found');
    await assert.rejects(FC.loadRecords(fake.db, FC.get('job_order'), { projectId: 'nope' }), (e) => e.code === 'not-found');
  });
});

// ── kc1 quotes (the Barro Kitchens configurators, live 2026-11-20 at v15.0.6) ───────────────────────────────────────────────────────────
// A kc1 line (qb/d7/d7-adapter.js newItem + describe) carries `category` (the tab id), name / dims / specEdit, doc { code, material, use … },
// priceBasis 'configured', qty, unit, unitPrice, amount — and NO catLabel. The forms must name its section, print its code, keep its quantity,
// and (on the workforce copies) drop every price.
describe('kc1 lines: section names, codes and quantities on every form', () => {
  const FC = setupForms();
  // codes print (owner yes 2026-11-20; FC.SHOW_ITEM_CODES ships true) — every test restores the switch in case one turns it off
  beforeEach(() => { FC.SHOW_ITEM_CODES = true; });
  afterEach(() => { FC.SHOW_ITEM_CODES = true; });
  const kcItems = () => [
    { id: 'KC', kcKind: 'table', kcId: 'kc1', category: 'prep', name: 'Work table with undershelf', dims: '1800 x 700 x 850 mm', specEdit: 'SS304 1.2 mm top', specStr: '', qty: 2, unit: 'pc', unitPrice: 21000, amount: 42000, priceBasis: 'configured',
      doc: { code: 'WT-1800', material: 'SS304', use: 'commercial', title: 'Work table with undershelf', specs: 'SS304 1.2 mm top' } },
    { id: 'KC', kcKind: 'range', kcId: 'kc2', category: 'cook', name: 'Two-burner range', dims: '900 x 800 x 850 mm', specEdit: '', qty: 1, unit: 'pc', unitPrice: 48000, amount: 48000, priceBasis: 'configured',
      doc: { code: 'GR-2B', material: 'SS304', use: 'commercial' } },
    { id: 'KC', kcKind: 'sink', kcId: 'kc3', category: 'prep', name: 'Single-bowl sink', dims: '900 x 700 x 850 mm', qty: 3, unit: 'pc', unitPrice: 30000, amount: 90000, priceBasis: 'configured',
      doc: { code: 'SK-1B', material: 'SS304', use: 'commercial' } },
    { id: 'CUSTOM', kcKind: 'custom', kcId: 'kc4', category: 'exhaust_system', name: 'Custom duct run', qty: 1, unit: 'lot', unitPrice: 15000, amount: 15000, priceBasis: 'manual', doc: { code: '' } },
  ];
  it('sectionLabel: catLabel first, then the category id in the quote builder\'s words, unknown ids spelled out, nothing for no category', () => {
    assert.equal(FC.sectionLabel({ catLabel: 'Bar area', category: 'prep' }), 'Bar area');
    assert.equal(FC.sectionLabel({ category: 'prep' }), 'Prep and storage');
    assert.equal(FC.sectionLabel({ category: 'cook' }), 'Cooking');
    assert.equal(FC.sectionLabel({ category: 'cooking_line' }), 'Cooking Line');
    assert.equal(FC.sectionLabel({ category: 'dish_return_area' }), 'Dish Return Area');
    assert.equal(FC.sectionLabel({}), '');
    assert.equal(FC.itemCode({ doc: { code: 'WT-1800' } }), 'WT-1800');
    assert.equal(FC.itemCode({ doc: null }), ''); assert.equal(FC.itemCode({}), '');
  });
  it('Sales Order from a kc1 order: sections grouped as the quote groups them, codes before the names, quantities and amounts kept', () => {
    const fx = fixtures(); const order = { ...fx.order, items: kcItems(), contractAmount: 195000 };
    const p = FC.prepare('sales_order', ctxOf({ order, project: { ...fx.project, items: kcItems() }, client: fx.client }));
    assert.equal(p.ok, true, p.error);
    const html = FC.compose(p, FC.renderSections(p)).bodyHtml;
    const bands = [...html.matchAll(/class="cat-row"[^>]*>(?:<td[^>]*>)?([^<]+)/g)].map((m) => m[1].trim());
    assert.deepEqual(bands, ['Prep and storage', 'Cooking', 'Exhaust System'], 'one band per section, in first-appearance order');
    for (const code of ['WT-1800', 'GR-2B', 'SK-1B']) assert.match(html, new RegExp(`<span class="cd">${code}</span>`));
    const prep = html.slice(html.indexOf('Prep and storage'), html.indexOf('Cooking'));
    assert.ok(prep.includes('Work table with undershelf') && prep.includes('Single-bowl sink'), 'the sink joins the work table under Prep and storage');
    assert.match(html, /₱42,000/); assert.match(html, /₱90,000/);
  });
  it('Job Order and Handoff pack from a kc1 job: same sections, codes and quantities — and still no price anywhere', () => {
    const fx = fixtures(); const project = { ...fx.project, items: kcItems(), jobOrder: { ...fx.project.jobOrder, items: undefined } };
    for (const id of ['job_order', 'handoff_pack']) {
      const p = FC.prepare(id, ctxOf({ project, order: { ...fx.order, items: kcItems() } }, PEOPLE.rene));
      assert.equal(p.ok, true, p.error);
      const html = FC.compose(p, FC.renderSections(p)).bodyHtml;
      for (const code of ['WT-1800', 'GR-2B', 'SK-1B']) assert.match(html, new RegExp(`<span class="cd">${code}</span>`), id);
      assert.ok(html.includes('Prep and storage') && html.includes('Cooking') && html.includes('Exhaust System'), id);
      assert.ok(!/₱|PHP|21,000|48,000|30,000|15,000|42000|90000/.test(html), `${id} carries a price`);
      const qty = [...html.matchAll(/<div class="nm">(?:<span class="cd">[^<]*<\/span>)?([^<]+)<\/div>[\s\S]*?<\/td><td[^>]*>(\d+)<\/td>/g)].map((m) => [m[1], m[2]]);
      assert.deepEqual(qty.find((r) => r[0] === 'Single-bowl sink'), ['Single-bowl sink', '3'], id);
    }
  });
  it('an EDITED job order (saved rows have no category) still finds each line\'s section and code from the quote line of the same name', () => {
    const fx = fixtures(); const items = kcItems();
    const saved = items.map((it) => ({ name: it.name, dims: it.dims, qty: it.qty, unit: it.unit, specs: '' }));
    const project = { ...fx.project, items, jobOrder: { ...fx.project.jobOrder, items: saved } };
    const p = FC.prepare('job_order', ctxOf({ project }, PEOPLE.rene));
    assert.equal(p.ok, true, p.error);
    assert.deepEqual(p.data.lines.map((l) => [l.catLabel, l.code]), [['Prep and storage', 'WT-1800'], ['Cooking', 'GR-2B'], ['Prep and storage', 'SK-1B'], ['Exhaust System', '']]);
  });
  it('SHIPS WITH CODES ON (owner 2026-11-20); a plain `code` is the fallback; switching it off removes every code and keeps the sections', () => {
    assert.match(read('js/forms-core.js'), /FC\.SHOW_ITEM_CODES = true;/);
    assert.equal(FC.itemCode({ doc: { code: 'PS-PT-1200' } }), 'PS-PT-1200');
    assert.equal(FC.itemCode({ code: 'LEG-01' }), 'LEG-01', 'a legacy line with a top-level code');
    assert.equal(FC.itemCode({ doc: { code: 'A' }, code: 'B' }), 'A', 'doc.code wins');
    FC.SHOW_ITEM_CODES = false;
    assert.equal(FC.itemCode({ doc: { code: 'WT-1800' } }), '');
    const fx = fixtures(); const project = { ...fx.project, items: kcItems(), jobOrder: { ...fx.project.jobOrder, items: undefined } };
    for (const id of ['sales_order', 'job_order', 'handoff_pack']) {
      const p = FC.prepare(id, ctxOf({ project, order: { ...fx.order, items: kcItems() }, client: fx.client }));
      const html = FC.compose(p, FC.renderSections(p)).bodyHtml;
      assert.ok(!html.includes('class="cd"') && !html.includes('WT-1800'), id);
      assert.ok(html.includes('Prep and storage'), id);
    }
  });
});

// ── F3 (flow spec §7): what the REAL ContractCore writes is what the forms read ───────────────────────────────────
describe('F3 apply → forms: the revision ContractCore writes prints on the Sales Order and Job Order', () => {
  const req = createRequire(import.meta.url);
  req('../js/money-core.js'); req('../js/sales-flow-core.js'); req('../js/price-gate-core.js');
  const CC = req('../js/contract-core.js');
  it('SO-0012 R1 / JO-0012 R1, the proposer\'s reason in the history, the new contract and balance; no "Rev." anywhere', () => {
    const fx = fixtures();
    fx.order.soNumber = 'SO-0012'; fx.project.joNumber = 'JO-0012';
    fx.order.pendingRevision = { revNo: 1, kind: 'manual', fromAmount: 150000, toAmount: 170000, delta: 20000, changeReason: 'Client added a pot rack',
      gate: { approval: 'none' }, status: 'pending_confirm', requestedAt: '2026-11-19T01:00:00.000Z', requestedBy: 'u-uri', requestedByName: 'Uriel Sagaoinit', decision: null };
    const viewer = { uid: 'u-neil', isPresident: true, isFinanceTier: false };
    const plan = CC.planApply(fx.order, fx.project, { today: '2026-11-20', nowIso: '2026-11-20T02:00:00.000Z', who: 'Neil Barro', viewer,
      union: (...xs) => xs, serverTime: () => '2026-11-20T02:00:00.000Z', deleteField: () => undefined });
    assert.equal(plan.ok, true, plan.code);
    for (const s of [JSON.stringify(plan.projectFields.timeline), JSON.stringify(plan.projectFields.documents), plan.ledgerEntry.description]) assert.ok(!/Rev\./.test(s), 'owner SF23: "R1", never "Rev."');
    const order = { ...fx.order, contractAmount: plan.orderPatch.contractAmount, contractRev: plan.orderPatch.contractRev, originalContractAmount: plan.orderPatch.originalContractAmount, revisions: [plan.revision] };
    delete order.pendingRevision;
    const project = { ...fx.project, contractAmount: plan.projectFields.contractAmount, arBalance: plan.projectFields.arBalance, joRev: plan.projectFields.joRev, joRevAt: plan.projectFields.joRevAt, joRevNote: plan.projectFields.joRevNote };
    const so = FC.prepare('sales_order', ctxOf({ order, project }, PEOPLE.uriel));
    assert.equal(so.ok, true, so.error); assert.equal(so.numberText, 'SO-0012 R1');
    assert.equal(so.data.contract, 170000); assert.equal(so.data.balance, 95000);
    assert.equal(so.data.revisions[0].reason, 'Client added a pot rack', 'the history reads changeReason (the name the core writes)');
    const html = FC.compose(so, FC.renderSections(so)).bodyHtml;
    assert.ok(html.includes('Client added a pot rack')); assert.ok(!/Rev\./.test(html));
    const jo = FC.prepare('job_order', ctxOf({ project, order }, PEOPLE.rene));
    assert.equal(jo.ok, true, jo.error); assert.equal(jo.numberText, 'JO-0012 R1');
    const joHtml = FC.compose(jo, FC.renderSections(jo)).bodyHtml;
    assert.ok(!/₱|Client added a pot rack/.test(joHtml), 'the job order carries no amount and no Sales reason');
  });
});
