// tests/contact-details.test.mjs — the company contact details on letterheads, quote documents and the portal e-mail
// (QUOTE-BUILDER-CONFIGURATOR-SPEC §1 + §9, "A5" / work chunk WS-4).
//
// Owner ruling (2026-10-28, STATUS open ruling #11): the Barro Kitchens (BK) and Barro Industries (BI) documents carry the domain e-mail
// hello@barroindustries.com and the registered office address "21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila" — not the
// old Gmail address and not the bare "Metro Manila". Copies of the same strings live in four places that cannot read each other, so they are
// pinned together here:
//   · js/config.js            — BRAND.legal (+ brandEntity(), what the letterhead engine prints) and BRAND.companies.BK / .BI
//   · js/screens/sales.js     — QUOTE_BRANDS.BK / .BI (the brand strings the public /q/ quote page prints)
//   · functions/portal-core.js — the signature of the client-portal acceptance e-mail (buildOutboxBody)
//   · quote-builder-v2.html   — the builder's own CO.BK / CO.BI (an iframe, so it keeps a copy; edited by the builder chunk, WS-2)
// Brilliant Steel (BS) is a different company: its entries are pinned EXACTLY as they were and carry no e-mail at all — owner rule, nothing
// is invented for it (STATUS ruling #11 stays open for BS only).
//
// What is deliberately NOT changed (and not asserted here): the three versioned privacy notices keep their wording — "Metro Manila" in the
// controller section, and the old Gmail string inside the stored original brief notice — because a consent records the notice's version and
// the sha256 of its text. tests/privacy-notices.test.mjs pins them; this file must never need to touch them.
//
// js/config.js, js/screens/sales.js and the builder are browser files (window globals, Firebase, DOM, no module shim) so they cannot be
// require()d. The one literal under test is cut out by source and evaluated alone — the technique tests/cash-advance.test.mjs uses. If a
// literal is renamed or moved the extraction throws loudly, rather than the test passing on nothing.
//
// Also pinned: js/config.js PAGE_SCRIPTS lists js/qb-configured.js for 'dept:Sales' and 'bk-quotations' (the pages whose quote-request screens hand
// a request to the builder) and for no partner page. ci-invariants separately demands that the file exists and is in sw.js PRECACHE.
//
// Mutation-tested in a scratch copy, never the shared tree (2026-10-28): 23 mutations, 23 killed — each of BK creds / BK addr / BI contact
// "|" / BRAND.legal address, addressShort and email put back; an e-mail or the QC address given to Brilliant Steel in config.js, sales.js and the
// builder; the portal signature on Gmail / without the address line / with the short address; a Gmail string in a code line of portal-core.js and
// of the builder; CO.BI drifting from config.js; an extra field on QUOTE_BRANDS.BK; the PAGE_SCRIPTS entry removed from either page, listed
// twice, or leaked onto a partner page. Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DOMAIN = 'hello@barroindustries.com';
const GMAIL = 'barroindustries@gmail.com';
const ADDRESS = '21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila';
const PHONE = '09276836300';
// the letterhead splits `contact` on "|" into [phone, e-mail] (quote-builder-v2.html applyLetterheadHeader) — the separator is part of the format
const CONTACT = `${PHONE}  |  ${DOMAIN}`;
const CREDS = ['Barro Industries OPC', 'SEC Registered', DOMAIN, PHONE, ADDRESS].join('  •  ');

// Brilliant Steel exactly as it stood before this change. No e-mail, a Pasig address, a different phone format on the credentials line.
const BS_CREDS = 'Brilliant Steel Corporation  •  SEC / BIR Registered  •  Pasig City, Metro Manila  •  0927 683 6300';
const BS_THANKS = 'Thank you for considering Brilliant Steel Corporation. We are committed to quality steelworks delivered on time.';
const BS_SIG = { name: 'GERALD CHAN', title: 'President, Brilliant Steel Corporation' };

// ── source extraction ────────────────────────────────────────────────────────────────────────────────
function sliceBetween(src, from, to, label) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, `${label}: "${from}" was not found — if it was renamed or moved, update this test rather than deleting it`);
  const j = src.indexOf(to, i + from.length);
  assert.ok(j >= 0, `${label}: "${to}" was not found after "${from}"`);
  return src.slice(i, j + to.length);
}
// A top-level literal in these files ends at the first "\n};" after it (every nested object closes indented).
const evalWindow = (code) => new Function('window', `${code}\nreturn window;`)({});

const CONFIG_SRC = read('js/config.js');
const BRAND_CODE = sliceBetween(CONFIG_SRC, 'window.BRAND = {', '\n};', 'js/config.js');
const ENTITY_CODE = sliceBetween(CONFIG_SRC, 'window.brandEntity = function(kind){', '\n};', 'js/config.js');
const cfgWindow = evalWindow(`${BRAND_CODE}\n${ENTITY_CODE}`);
const BRAND = cfgWindow.BRAND;

const SALES_SRC = read('js/screens/sales.js');
const QUOTE_BRANDS = evalWindow(sliceBetween(SALES_SRC, 'window.QUOTE_BRANDS = {', '\n};', 'js/screens/sales.js')).QUOTE_BRANDS;

const portal = require('../functions/portal-core.js');

// The builder and PAGE_SCRIPTS are read lazily, inside the tests that need them: another chunk restructuring either fails ITS tests with the
// message above, not every test in this file.
const lazy = (fn) => { let v, done = false; return () => (done ? v : ((done = true), (v = fn()))); };
const builderCO = lazy(() => new Function(`${sliceBetween(read('quote-builder-v2.html'), 'const CO = {', '\n};', 'quote-builder-v2.html')}\nreturn CO;`)());
const pageScripts = lazy(() => evalWindow(sliceBetween(CONFIG_SRC, 'const _PERF1_PAYROLL_ENGINE', '\n};', 'js/config.js')).PAGE_SCRIPTS);

// ── "no Gmail outside comments" ──────────────────────────────────────────────────────────────────────
// Line based, and deliberately one-sided: a line whose first non-blank characters open a comment (// , /* , * , <!--) is exempt; every other
// line that says "gmail" counts — so a trailing comment on a code line is a (loud, easily fixed) false alarm, never a hidden leak.
const isCommentLine = (line) => /^\s*(\/\/|\/\*|\*|<!--)/.test(line);
const gmailOutsideComments = (src) => src.split('\n')
  .map((text, i) => ({ line: i + 1, text: text.trim().slice(0, 160) }))
  .filter(({ text }) => /gmail/i.test(text) && !isCommentLine(text));

describe('js/config.js — BRAND.legal and what the letterhead engine prints', () => {
  it('the corporate identity carries the domain e-mail and the Quezon City address (long and short), and the phone is unchanged', () => {
    const L = BRAND.legal;
    assert.equal(L.email, DOMAIN);
    assert.equal(L.address, ADDRESS);
    assert.equal(L.addressShort, ADDRESS);
    assert.equal(L.phone, PHONE);
    for (const v of Object.values(L)) assert.ok(typeof v !== 'string' || !/gmail/i.test(v), `BRAND.legal still names the Gmail address: ${v}`);
  });

  it('brandEntity("corporate") (quotes, POs, proposals) and brandEntity("bir") (payslips, invoices, BIR books) both print them', () => {
    for (const kind of ['corporate', 'bir']) {
      const e = cfgWindow.brandEntity(kind);
      assert.equal(e.email, DOMAIN, kind);
      assert.equal(e.address, ADDRESS, kind);
      assert.equal(e.phone, PHONE, kind);
    }
    // the same entity as before otherwise: the TIN stays blank until the accountant supplies it, the names are untouched
    assert.equal(cfgWindow.brandEntity('corporate').name, 'Barro Industries OPC');
    assert.equal(cfgWindow.brandEntity('bir').tin, '');
  });
});

describe('js/config.js — BRAND.companies (the builder\'s company map, mirrored here)', () => {
  for (const code of ['BK', 'BI']) {
    it(`${code}: addr, contact (phone | e-mail, pipe format kept) and creds carry the domain e-mail and the Quezon City address`, () => {
      const c = BRAND.companies[code];
      assert.equal(c.addr, ADDRESS);
      assert.equal(c.contact, CONTACT);
      assert.deepEqual(c.contact.split('|').map((s) => s.trim()), [PHONE, DOMAIN]);
      assert.equal(c.creds, CREDS);
      assert.equal(c.code, code);
      assert.equal(JSON.stringify(c).includes(GMAIL), false);
    });
  }

  it('BK and BI keep their own names, subtitles and sign-off (only the contact details moved)', () => {
    assert.equal(BRAND.companies.BK.name, 'BARRO KITCHENS');
    assert.equal(BRAND.companies.BK.sub, 'By Barro Industries OPC');
    assert.equal(BRAND.companies.BI.name, 'BARRO INDUSTRIES OPC');
    assert.equal(BRAND.companies.BI.sub, 'SEC-registered One Person Corporation');
    for (const code of ['BK', 'BI']) assert.deepEqual(BRAND.companies[code].sig, { name: 'NEIL BARRO', title: 'President, Barro Industries OPC' });
  });

  it('BS (the third company) is untouched: Pasig address, phone only, NO e-mail — none is invented (ruling #11 stays open for it)', () => {
    assert.deepEqual(BRAND.companies.BS, {
      name: 'BRILLIANT STEEL CORPORATION', sub: '', addr: 'Pasig City, Metro Manila', contact: '09276836300',
      sig: BS_SIG, code: 'BS', thanks: BS_THANKS, creds: BS_CREDS,
    });
    assert.ok(!JSON.stringify(BRAND.companies.BS).includes('@'), 'Brilliant Steel gained an e-mail address');
  });
});

describe('js/screens/sales.js — QUOTE_BRANDS (the brand strings the public quote page prints)', () => {
  for (const code of ['BK', 'BI']) {
    it(`${code}: creds carry the domain e-mail and the Quezon City address, and are the same line as js/config.js's`, () => {
      assert.equal(QUOTE_BRANDS[code].creds, CREDS);
      assert.equal(QUOTE_BRANDS[code].creds, BRAND.companies[code].creds);
      assert.equal(JSON.stringify(QUOTE_BRANDS[code]).includes(GMAIL), false);
      // the public page prints name / sub / creds / thanks and nothing else — no new field slipped in with the contact change
      assert.deepEqual(Object.keys(QUOTE_BRANDS[code]).sort(), ['creds', 'name', 'sub', 'thanks']);
    });
  }

  it('BS is untouched and has no e-mail', () => {
    assert.deepEqual(QUOTE_BRANDS.BS, { name: 'BRILLIANT STEEL CORPORATION', sub: '', creds: BS_CREDS, thanks: BS_THANKS });
    assert.ok(!JSON.stringify(QUOTE_BRANDS.BS).includes('@'), 'Brilliant Steel gained an e-mail address');
  });
});

describe('functions/portal-core.js — the signature of the portal acceptance e-mail', () => {
  const portalDoc = {
    id: 'acme__proposal',
    client: { company: 'Acme Foods Inc.' },
    proposal: { number: 'BKMLVB261028-001', title: 'Commercial Kitchen Proposal' },
    figures: { contractTotal: 1000000 },
    milestones: [],
  };
  const acceptance = { refNo: 'BKC-261028-ABC234', signedOnManila: '2026-10-28', signer: { name: 'Ana Cruz' } };
  const body = portal.buildOutboxBody(portalDoc, acceptance);

  it('ends with the President\'s block: phone · domain e-mail, then the Quezon City address', () => {
    assert.deepEqual(body.split('\n').slice(-5), [
      'Warm regards,',
      'Neil Barro',
      'President, Barro Industries OPC · Barro Kitchens',
      `0927 683 6300 · ${DOMAIN}`,
      ADDRESS,
    ]);
    assert.ok(!/gmail/i.test(body), 'the acceptance e-mail still names the Gmail address');
  });

  it('the rest of the e-mail is as it was (greeting, reference, signing date, contract price, portal URL)', () => {
    assert.ok(body.startsWith('Dear Ana Cruz,\n'));
    assert.ok(body.includes('Reference number: BKC-261028-ABC234'));
    assert.ok(body.includes('Signed on: 2026-10-28'));
    assert.ok(body.includes('Contract price: PHP 1,000,000 (VAT-exclusive)'));
    assert.ok(body.includes('https://barroindustries.com/projects/acme/proposal/'));
  });
});

describe('quote-builder-v2.html — CO.BK / CO.BI (the builder\'s own copy; edited by the builder chunk, WS-2)', () => {
  for (const code of ['BK', 'BI']) {
    it(`${code}: addr, contact and creds are the same strings as js/config.js's BRAND.companies.${code}`, () => {
      const co = builderCO()[code];
      assert.equal(co.addr, ADDRESS);
      assert.equal(co.contact, CONTACT);
      assert.equal(co.creds, CREDS);
      for (const k of ['addr', 'contact', 'creds']) assert.equal(co[k], BRAND.companies[code][k], `${code}.${k} drifted from js/config.js`);
      assert.equal(co.code, code);
    });
  }

  it('BS is untouched and has no e-mail', () => {
    const bs = builderCO().BS;
    assert.deepEqual(bs, {
      name: 'BRILLIANT STEEL CORPORATION', sub: '', logo: '', addr: 'Pasig City, Metro Manila', contact: '09276836300',
      sig: BS_SIG, nav: '<span>BRILLIANT</span> STEEL', code: 'BS', thanks: BS_THANKS, creds: BS_CREDS,
    });
    assert.ok(!JSON.stringify(bs).includes('@'), 'Brilliant Steel gained an e-mail address');
  });
});

describe('no Gmail address outside comments in the four files that print the contact details', () => {
  for (const file of ['js/config.js', 'js/screens/sales.js', 'functions/portal-core.js', 'quote-builder-v2.html']) {
    it(`${file}`, () => {
      assert.deepEqual(gmailOutsideComments(read(file)), [], `${file} still carries the Gmail address outside a comment`);
    });
  }

  it('the checker itself: comment lines are exempt, code and data lines are not', () => {
    const sample = [
      '// the old Gmail address',
      '   /* Gmail */',
      ' * barroindustries@gmail.com in a block comment',
      '<!-- gmail -->',
      "  creds: 'x  •  barroindustries@gmail.com  •  y',",
      "const a = 1; // trailing comment about Gmail",
      'plain line about GMAIL',
    ].join('\n');
    assert.deepEqual(gmailOutsideComments(sample).map((h) => h.line), [5, 6, 7]);
  });
});

describe('js/config.js PAGE_SCRIPTS — the configurator module loads on the pages that hand a request over to the builder', () => {
  for (const page of ['dept:Sales', 'bk-quotations']) {
    it(`${page}: lists js/qb-configured.js exactly once, with the quote-request screen that calls it`, () => {
      const files = pageScripts()[page];
      assert.ok(Array.isArray(files), `${page} is not a PAGE_SCRIPTS key any more`);
      assert.equal(files.filter((f) => f === 'js/qb-configured.js').length, 1);
      assert.ok(files.includes('js/screens/quote-requests.js'));
    });
  }

  it('no partner page loads it (the configurator is not available in partner sessions — spec §2.5)', () => {
    for (const page of ['dashboard:partner', 'dept:Brilliant Steel', 'bs-quotations', 'bs-clients', 'bs-files', 'dept:Partners', 'partner-projects']) {
      assert.ok(Array.isArray(pageScripts()[page]), `${page} is not a PAGE_SCRIPTS key any more`);
      assert.ok(!pageScripts()[page].includes('js/qb-configured.js'), `${page} loads the configurator module`);
    }
  });
});
