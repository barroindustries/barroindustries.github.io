// tests/brief-budget.test.mjs — the project brief's optional "Approximate budget" question (2026-10-22) and the ONE narrow allowance it needs.
//
// Owner ruling (2026-10-22): the public project brief gets an OPTIONAL budget question with six client-stated bands:
// "Under ₱500,000" · "₱500,000 – ₱1,000,000" · "₱1,000,000 – ₱3,000,000" · "₱3,000,000 – ₱10,000,000" · "Over ₱10,000,000" ·
// "Prefer not to say / not sure". These are the CLIENT's budget bands, not Barro prices. Public surfaces carry no pricing
// (ci-invariants CHECK 9 and the catalogue / content-page / homepage checks ban price words and peso amounts), so the brief needs an
// allowance — and it must be as narrow as it can be. What is pinned here:
//   · the question: where it sits, its exact wording, its six bands, its stable keys, that it is optional;
//   · the server: the value is accepted ONLY from the list of keys (a label, a free amount, look-alikes are refused; a value that is not
//     even text is never stored);
//   · the allowance (scripts/brief-budget-bands.json + scripts/check-brief-copy.js): it lets EXACTLY that question through, field for field,
//     and nothing else in FORMS.project_brief_v2 — a peso amount or price word anywhere else, an extra / reworded / removed band, an extra
//     property, a second "budget" field, the question in another part are all reported (paths only; the offending text is withheld);
//     the allowance file itself can only ever hold bands;
//   · CHECK 9 runs that script, and every other price scan (the homepage, the catalogue, the 12 content pages, the quote request, the
//     brief's own page / css / js) keeps its ban — none of them can contain a band.
//
// Mutation-tested in a scratch copy, never the shared tree. Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const cir = require('../functions/cir-core.js');
const { FORMS } = require('../functions/cir-forms.js');
const guard = require('../scripts/check-brief-copy.js');
const V1 = FORMS.commissary_brief;
const V2 = FORMS.project_brief_v2;
const ALLOW = JSON.parse(read('scripts/brief-budget-bands.json'));

// The six answers the owner approved, in order — pinned here independently of the definition and of the allowance file, so neither can be
// widened (or reworded) without this list being edited on purpose.
const BANDS = [
  'Under ₱500,000',
  '₱500,000 – ₱1,000,000',
  '₱1,000,000 – ₱3,000,000',
  '₱3,000,000 – ₱10,000,000',
  'Over ₱10,000,000',
  'Prefer not to say / not sure',
];
const KEYS = ['under_500k', '500k_to_1m', '1m_to_3m', '3m_to_10m', 'over_10m', 'not_sure'];

const clone = (x) => JSON.parse(JSON.stringify(x));
const sectionOf = (def, key) => def.sections.find((s) => s.key === key);
const fieldOf = (def, key) => def.sections.flatMap((s) => s.fields).find((f) => f.key === key);
const budget = () => fieldOf(V2, 'budget');
const valid = (over) => ({ project_type: 'restaurant', name: 'Maria Santos', phone: '0917 123 4567', city: 'Quezon City', province: 'Metro Manila', scope: ['equipment'], ...(over || {}) });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('the budget question', () => {
  it('is an optional single-choice question in the common "material, timing and buying" part, right after the target date', () => {
    const sec = sectionOf(V2, 'material');
    assert.equal(sec.when, undefined, 'a common part: it is asked of every project type');
    assert.deepEqual(sec.fields.map((f) => f.key), ['material', 'finish', 'timeline', 'target_date', 'budget', 'buyer_type']);
    const q = budget();
    assert.equal(q.type, 'select');
    assert.equal(q.ui, 'choice');
    assert.ok(!q.required, 'optional');
    assert.equal(q.label, 'Approximate budget (optional)');
    assert.equal(q.hint, 'A rough range helps us suggest a scope that fits. Skip it if you prefer.');
  });

  it('offers exactly the six bands the owner approved, in order, under stable keys', () => {
    assert.deepEqual(budget().options.map((o) => o.l), BANDS);
    assert.deepEqual(budget().options.map((o) => o.v), KEYS);
    budget().options.forEach((o) => assert.match(o.v, /^[a-z0-9_]+$/));
    assert.equal(budget().options[5].v, 'not_sure', 'the opt-out is the last choice');
  });

  it('is the only question of the form that is asked of every type and names a peso band (the type picker, the parts and the notes carry none)', () => {
    const withPeso = V2.sections.flatMap((s) => s.fields).filter((f) => /₱/.test(JSON.stringify(f)));
    assert.deepEqual(withPeso.map((f) => f.key), ['budget']);
  });

  it('feeds the summary with its band LABEL (the key stays in the answers)', () => {
    assert.equal(V2.summaryKeys.budget, 'budget');
    const c = cir.validateAnswers(V2, valid({ budget: '500k_to_1m' })).clean;
    assert.equal(c.budget, '500k_to_1m');
    assert.equal(cir.buildSummary(V2, c, 0).budget, '₱500,000 – ₱1,000,000');
    assert.equal(cir.buildSummary(V2, cir.validateAnswers(V2, valid()).clean, 0).budget, '');
  });

  it('is a v2 question only: the old questionnaire keeps its own wording, untouched', () => {
    assert.equal(fieldOf(V1, 'budget').label, 'Budget range');
    assert.ok(fieldOf(V1, 'budget').options.some((o) => /₱/.test(String(o))), 'the old form still carries its own ranges (stored briefs render with it)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('the server takes the budget only from the list', () => {
  const v = (a) => cir.validateAnswers(V2, a);

  it('does not need it: a brief without a budget (or a blank one) is valid and carries no budget answer', () => {
    for (const a of [valid(), valid({ budget: '' })]) {
      const r = v(a);
      assert.equal(r.ok, true, JSON.stringify(r.errors));
      assert.ok(!('budget' in r.clean));
    }
  });

  it('accepts each of the six keys, for every project type, and keeps the key', () => {
    const types = V2.sections[0].fields[0].options.map((o) => o.v);
    assert.equal(types.length, 12);
    for (const t of types) {
      for (const k of KEYS) {
        const r = v(valid({ project_type: t, budget: k, ...(t === 'other' ? { other_description: 'A food cart.' } : {}) }));
        assert.equal(r.ok, true, `${t} / ${k}: ${JSON.stringify(r.errors)}`);
        assert.equal(r.clean.budget, k);
      }
    }
  });

  it('refuses anything that is not one of the keys: a label, a free amount, the old form\'s wording, look-alikes, prototype names', () => {
    for (const bad of [...BANDS, '2000000', '₱2M', 'Below ₱1M', '₱1M – ₱3M', 'UNDER_500K', ' under_500k', 'under_500k ', 'under-500k', 'under_500k;', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'none']) {
      const r = v(valid({ budget: bad }));
      assert.equal(r.ok, false, `"${bad}" was accepted`);
      assert.ok(r.errors.some((e) => e === '"Approximate budget (optional)" has an invalid value'), JSON.stringify(r.errors));
    }
  });

  it('never stores a value that is not even text — like every optional select, it is read as "not answered"', () => {
    for (const junk of [3, 2000000, ['under_500k'], { v: 'under_500k' }, null, true, false]) {
      const r = v(valid({ budget: junk }));
      assert.equal(r.ok, true, JSON.stringify(junk));
      assert.ok(!('budget' in r.clean), `${JSON.stringify(junk)} reached the stored answers`);
    }
  });

  it('does not let the budget through on the old questionnaire (a v2 key is not one of v1\'s own ranges)', () => {
    const r = cir.validateAnswers(V1, { name: 'J', company: 'C', phone: '0917 000 0000', email: 'j@example.com', address: 'A', site_address: 'S', budget: 'under_500k' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /"Budget range" has an invalid value/.test(e)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('the allowance is exact: it lets this one question through and nothing else', () => {
  it('lists exactly the approved bands and is itself valid', () => {
    assert.deepEqual(ALLOW.options.map((o) => o.l), BANDS);
    assert.deepEqual(ALLOW.options.map((o) => o.v), KEYS);
    assert.equal(ALLOW.label, 'Approximate budget (optional)');
    assert.deepEqual([ALLOW.partKey, ALLOW.fieldKey, ALLOW.type], ['material', 'budget', 'select']);
    assert.deepEqual(guard.validateAllowance(ALLOW), []);
    assert.equal(guard.FORM_ID, 'project_brief_v2', 'the allowance belongs to this one form');
  });

  it('the definition\'s question equals the allowance field for field', () => {
    assert.equal(guard.isAllowedQuestion(budget(), sectionOf(V2, 'material'), ALLOW), true);
  });

  it('the real definition is clean: no price word or peso amount anywhere except that question', () => {
    assert.deepEqual(guard.scanDefinition(V2, ALLOW), []);
  });

  // each mutation is applied to a copy of the real definition and must be reported — with a JSON path, never the offending text
  const MUTATIONS = [
    ['a peso amount in another question', (d) => { fieldOf(d, 'finish').label += ' (extra ₱500 for mirror)'; }, /^sections\[\d+\]\.fields\[\d+\]\.label carries pricing vocabulary/],
    ['a peso amount in an option', (d) => { fieldOf(d, 'finish').options[0].l = 'Brushed (₱300 extra)'; }, /options\[0\]\.l carries pricing vocabulary/],
    ['a price word in a hint', (d) => { fieldOf(d, 'material').hint += ' Price on request.'; }, /hint carries pricing vocabulary/],
    ['a cost word in the intro', (d) => { d.intro += ' Costs are shared.'; }, /^intro carries pricing vocabulary/],
    ['the word "budget" outside the question', (d) => { sectionOf(d, 'space').title = 'Space and budget'; }, /title carries pricing vocabulary/],
    ['a pricing field name', (d) => { fieldOf(d, 'notes').basePrice = 1; }, /basePrice \(key\) carries pricing vocabulary/],
    ['an extra band on the question', (d) => { fieldOf(d, 'budget').options.push({ v: 'over_50m', l: 'Over ₱50,000,000' }); }, /differs from scripts\/brief-budget-bands\.json/],
    ['a reworded band', (d) => { fieldOf(d, 'budget').options[0].l = 'Under ₱400,000'; }, /differs from scripts\/brief-budget-bands\.json/],
    ['a band removed', (d) => { fieldOf(d, 'budget').options.pop(); }, /differs from scripts\/brief-budget-bands\.json/],
    ['a band re-keyed', (d) => { fieldOf(d, 'budget').options[1].v = 'x_to_y'; }, /differs from scripts\/brief-budget-bands\.json/],
    ['another property on the question', (d) => { fieldOf(d, 'budget').placeholder = '₱5'; }, /differs from scripts\/brief-budget-bands\.json/],
    ['the question\'s hint changed', (d) => { fieldOf(d, 'budget').hint = 'Tell us what you will pay.'; }, /differs from scripts\/brief-budget-bands\.json/],
    ['the question\'s label changed', (d) => { fieldOf(d, 'budget').label = 'Approximate budget'; }, /differs from scripts\/brief-budget-bands\.json/],
    ['the question made required', (d) => { fieldOf(d, 'budget').required = true; }, /differs from scripts\/brief-budget-bands\.json/],
    ['the question moved to another part', (d) => { const q = fieldOf(d, 'budget'); sectionOf(d, 'material').fields = sectionOf(d, 'material').fields.filter((f) => f.key !== 'budget'); sectionOf(d, 'space').fields.push(q); }, /differs from scripts\/brief-budget-bands\.json/],
    ['a second question keyed "budget"', (d) => { sectionOf(d, 'space').fields.push({ key: 'budget', label: 'Anything else?', type: 'text' }); }, /2 fields keyed "budget"/],
    ['the summary pointer aimed at another field', (d) => { d.summaryKeys.budget = 'finish'; }, /budget \(key\) carries pricing vocabulary/],
  ];
  for (const [name, mutate, expected] of MUTATIONS) {
    it(`reports ${name}`, () => {
      const d = clone(V2);
      mutate(d);
      const problems = guard.scanDefinition(d, ALLOW);
      assert.ok(problems.length > 0, 'not reported');
      assert.ok(problems.some((p) => expected.test(p)), `no problem matched ${expected}: ${JSON.stringify(problems)}`);
      assert.ok(!problems.join('\n').includes('₱'), 'a report echoed a peso sign (the offending text must be withheld)');
    });
  }

  // the allowance file can only ever hold bands
  const BAD_ALLOWANCES = [
    ['a price list instead of bands', (a) => { a.options[0].l = '₱500 per square metre'; }],
    ['a sentence about our price', (a) => { a.options[1].l = 'Our price: ₱500,000'; }],
    ['a bare amount', (a) => { a.options[2].l = '₱500,000'; }],
    ['a band with a trailing word', (a) => { a.options[4].l = 'Over ₱10,000,000 and more'; }],
    ['a price word in the hint', (a) => { a.hint = 'Our price starts low.'; }],
    ['a price word in the label (other than "budget")', (a) => { a.label = 'Approximate price (optional)'; }],
    ['a duplicate value', (a) => { a.options[1].v = a.options[0].v; }],
    ['a value that is not a plain key', (a) => { a.options[0].v = 'Under 500k!'; }],
    ['an extra property on an option', (a) => { a.options[0].note = 'x'; }],
    ['a single option', (a) => { a.options = a.options.slice(0, 1); }],
    ['more than ten options', (a) => { a.options = Array.from({ length: 11 }, (_, i) => ({ v: `b${i}`, l: `Over ₱${i + 1},000,000` })); }],
    ['a question that is not a select', (a) => { a.type = 'text'; }],
  ];
  for (const [name, mutate] of BAD_ALLOWANCES) {
    it(`refuses an allowance that carries ${name}`, () => {
      const a = clone(ALLOW);
      mutate(a);
      assert.ok(guard.validateAllowance(a).length > 0, 'accepted');
      assert.ok(guard.scanDefinition(V2, a).some((p) => p.startsWith('allowance: ')), 'the scan did not report the bad allowance');
    });
  }

  it('is for project_brief_v2 only: the old questionnaire, with its own peso ranges, does not pass under it', () => {
    assert.ok(guard.scanDefinition(V1, ALLOW).length > 0);
  });

  it('the vocabulary it bans covers the peso sign, PHP, pesos, price, pricing, cost(s), budget and the pricing field names', () => {
    for (const t of ['₱5', 'PHP 5', 'pesos', 'price', 'Pricing', ' costs ', 'budget', 'basePrice', 'unitPrice', 'exactTotal', 'formulaType', 'listPrice', 'priceAdder', 'pricePer', 'pricing-core']) {
      assert.ok(guard.PRICE_VOCAB.test(t), t);
    }
    for (const t of ['Project brief', 'Preferred finish', 'Photos', 'Anything else we should know?', 'A quotation after the site visit']) assert.ok(!guard.PRICE_VOCAB.test(t), t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('CHECK 9 runs the scan, and the ban stays everywhere else', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-brief-copy.js'), ...args], { encoding: 'utf8' });
  const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brief-copy-'));

  it('the command passes on the real tree', () => {
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS: project_brief_v2 carries no pricing vocabulary except the client-stated budget bands/);
  });

  it('the command fails — exit 1, a path, no offending text — on a definition that carries a price anywhere else', () => {
    const dir = scratch();
    try {
      const f = path.join(dir, 'cir-forms.js');
      const src = read('js/cir-forms.js');
      assert.ok(src.includes("label: 'Preferred finish'"));
      fs.writeFileSync(f, src.replace("label: 'Preferred finish'", "label: 'Preferred finish (extra ₱500 for mirror)'"));
      const r = run(f);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout, /FAIL: sections\[\d+\]\.fields\[\d+\]\.label carries pricing vocabulary \(text withheld on purpose\)/);
      assert.ok(!r.stdout.includes('₱') && !r.stdout.includes('extra'), 'the output echoed the offending text');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('the command fails when the question is changed without the allowance file (a band reworded in the definition)', () => {
    const dir = scratch();
    try {
      const f = path.join(dir, 'cir-forms.js');
      fs.writeFileSync(f, read('js/cir-forms.js').replace("l: 'Under ₱500,000'", "l: 'Under ₱450,000'"));
      const r = run(f);
      assert.equal(r.status, 1);
      assert.match(r.stdout, /differs from scripts\/brief-budget-bands\.json/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('the command fails on an allowance file that is not a list of bands, and on a missing file', () => {
    const dir = scratch();
    try {
      const a = clone(ALLOW);
      a.options[0].l = 'Our price: ₱500,000';
      const f = path.join(dir, 'bands.json');
      fs.writeFileSync(f, JSON.stringify(a));
      const r = run(path.join(ROOT, 'js', 'cir-forms.js'), f);
      assert.equal(r.status, 1);
      assert.match(r.stdout, /FAIL: allowance: options\[0\]\.l is not a client-stated band/);
      const missing = run(path.join(ROOT, 'js', 'cir-forms.js'), path.join(dir, 'nope.json'));
      assert.equal(missing.status, 1);
      assert.match(missing.stdout, /could not be read/);
      const noForms = run(path.join(dir, 'nope.js'));
      assert.equal(noForms.status, 1);
      assert.match(noForms.stdout, /could not be loaded/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  const CI = read('scripts/ci-invariants.sh');
  const guardStart = CI.indexOf("BRIEF_PAGE='sales/clientinformationrequest/index.html'");
  const guardEnd = CI.indexOf('# Partner-brand guard over every PUBLIC surface');

  it('ci-invariants CHECK 9 runs the scan inside the project-brief guard, and fails the check when it fails or its files are gone', () => {
    assert.ok(guardStart > 0 && guardEnd > guardStart);
    const block = CI.slice(guardStart, guardEnd);
    assert.match(block, /brief_copy_out=\$\(node scripts\/check-brief-copy\.js 2>&1\) \|\| \{ echo "\$brief_copy_out"; brief_fail=1; \}/);
    assert.match(block, /if \[ ! -f scripts\/check-brief-copy\.js \] \|\| \[ ! -f scripts\/brief-budget-bands\.json \]; then\s+echo "FAIL:[^"]*is missing[^"]*"\s+brief_fail=1/);
    assert.match(block, /client-stated budget bands, not prices/, 'the allowance is explained where it is wired in');
  });

  it('the allowance is wired into that one guard only — nothing else in ci-invariants mentions it', () => {
    const outside = CI.slice(0, guardStart) + CI.slice(guardEnd);
    assert.ok(!/check-brief-copy|brief-budget-bands/.test(outside));
  });

  it('every other price scan keeps the peso sign in its vocabulary: the homepage, the catalogue, the content pages, the quote request, the brief\'s own files', () => {
    for (const name of ['CAT_TOKENS', 'CAT_TOKENS_HEAD', 'QR_VOCAB']) {
      const m = CI.match(new RegExp(`^${name}='([^']*)'`, 'm'));
      assert.ok(m, `${name} not found`);
      assert.ok(m[1].includes('₱'), `${name} no longer bans the peso sign`);
    }
    assert.match(CI, /brief_price_lines=\$\(grep -nE '₱\|PHP \?\[0-9\]\|basePrice/, 'the brief\'s own page / css / js scan');
  });

  it('no public page or script other than the definition can carry a band: none of the six labels (or any "Under ₱…" / "₱… – ₱…") appears in them', () => {
    const files = ['index.html', 'catalogue/index.html', 'faq/index.html', 'areas-we-serve/index.html', 'services/index.html', 'work/index.html',
      'css/site.css', 'css/pages.css', 'css/catalogue.css', 'css/quote-request.css', 'css/project-brief.css',
      'js/site.js', 'js/catalogue.js', 'js/quote-request.js', 'js/qr-def.js', 'js/product-families.js', 'js/qr-families.js', 'js/project-brief.js',
      'sales/clientinformationrequest/index.html'];
    for (const dir of ['services', 'work']) {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) if (e.isDirectory() && exists(`${dir}/${e.name}/index.html`)) files.push(`${dir}/${e.name}/index.html`);
    }
    const present = files.filter(exists);
    assert.ok(present.length >= 20, `only ${present.length} public files found`);
    for (const f of present) {
      const text = read(f);
      for (const b of BANDS) assert.ok(!text.includes(b), `${f} carries the band "${b}"`);
      assert.ok(!/(Under|Over) ₱\d|₱\d{1,3}(,\d{3})+ – ₱/.test(text), `${f} carries a peso band`);
    }
  });

  it('the brief\'s own page, stylesheet and script contain no peso sign at all (the labels reach the page through the definition)', () => {
    for (const f of ['sales/clientinformationrequest/index.html', 'css/project-brief.css', 'js/project-brief.js']) assert.ok(!read(f).includes('₱'), f);
    assert.ok(/js\/cir-forms\.js/.test(read('sales/clientinformationrequest/index.html')), 'the page loads the definition');
  });

  it('the definition carries the explanation where the question is defined, and the mirror is byte-identical', () => {
    assert.match(read('js/cir-forms.js'), /client-stated\s+\/\/ budget bands, not prices/);
    assert.ok(fs.readFileSync(path.join(ROOT, 'js/cir-forms.js')).equals(fs.readFileSync(path.join(ROOT, 'functions/cir-forms.js'))));
  });
});
