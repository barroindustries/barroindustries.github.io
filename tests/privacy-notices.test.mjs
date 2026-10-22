// tests/privacy-notices.test.mjs — the three public privacy notices change TOGETHER (2026-10-22).
//
// Owner ruling (2026-10-22): the privacy contact in the notices is the domain address hello@barroindustries.com, not the Gmail one. Three
// notices carry it, and they share their controller section word for word:
//   · the project brief's    — js/cir-forms.js (mirrored at functions/cir-forms.js)      — new version 2026-10-22.1   (live: 2026-09-26.1)
//   · the public quote request's — js/qr-def.js (mirrored at functions/qr-def.js)         — new version 2026-10-22.1   (live: 2026-10-21.1)
//   · the client portal's    — functions/portal-core.js (the page renders the server's)  — new version 2026-10-22.1   (live: 2026-09-26.1)
// The version is what a consent records (with the sha256 of the text), so a consent given against the new wording says so, and a consent
// already stored keeps pointing at the text it was given against.
//
// What is pinned here: the three controller sections are identical and name the domain address; no current notice names the Gmail
// address; each version moved and each recorded hash follows its text; the original brief notice is kept verbatim (a page open before
// the deploy still submits against it); the quote request and the portal still accept ONLY the current version (a stale page is asked to
// reload — the design they were built with); a saved quote-request draft drops a consent given under an older notice; the portal page's
// demo copy of its notice is in step with the server's.
//
// Mutation-tested in a scratch copy, never the shared tree. Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');

const CIR = require('../functions/cir-forms.js');
const cir = require('../functions/cir-core.js');
const QR = require('../js/qr-def.js');
const qrCore = require('../functions/qr-core.js');
const portal = require('../functions/portal-core.js');

const GMAIL = 'barroindustries@gmail.com';
const DOMAIN = 'hello@barroindustries.com';
const CONTROLLER = 'Who is responsible for your data';
const controller = (notice) => notice.sections.find((s) => s.heading === CONTROLLER);

// the three notices as they are now
const NOTICES = [
  ['project brief', CIR.PRIVACY_NOTICE, '2026-10-22.1'],
  ['public quote request', QR.PRIVACY_NOTICE, '2026-10-22.1'],
  ['client portal', portal.PRIVACY_NOTICE, '2026-10-22.1'],
];

describe('the three public privacy notices name the domain address', () => {
  it('share ONE controller section, word for word, with the domain address as the privacy contact', () => {
    const bodies = NOTICES.map(([, n]) => controller(n).body);
    assert.equal(new Set(bodies).size, 1, 'the controller sections drifted apart');
    assert.equal(bodies[0], `Personal Information Controller: Barro Industries OPC (SEC-registered, Metro Manila), trading as Barro Kitchens. Contact for privacy matters: the President, 0927 683 6300, ${DOMAIN}.`);
  });

  for (const [name, notice] of NOTICES) {
    it(`${name}: no section names the Gmail address, and the domain address appears once`, () => {
      const text = JSON.stringify(notice);
      assert.ok(!text.includes(GMAIL) && !/gmail/i.test(text), 'the Gmail address is still in the notice');
      assert.equal(text.split(DOMAIN).length - 1, 1);
    });
  }

  it('the version of each notice moved to the day of the change (the consent records it)', () => {
    for (const [name, notice, version] of NOTICES) assert.equal(notice.version, version, name);
    assert.deepEqual(NOTICES.map(([, n]) => n.version), ['2026-10-22.1', '2026-10-22.1', '2026-10-22.1']);
    for (const [, notice] of NOTICES) assert.match(notice.version, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('every recorded hash is the hash of ITS OWN text, and differs from the hash of the wording it replaced', () => {
    const was = (notice) => ({ ...notice, sections: notice.sections.map((s) => (s.heading === CONTROLLER ? { ...s, body: s.body.replace(DOMAIN, GMAIL) } : s)) });
    assert.equal(cir.noticeFor(CIR.PRIVACY_NOTICE.version).sha256, sha(JSON.stringify(CIR.PRIVACY_NOTICE.sections)));
    assert.equal(qrCore.privacyNoticeSha256(), sha(JSON.stringify(QR.PRIVACY_NOTICE.sections)));
    assert.equal(portal.privacyNoticeSha256(), sha(JSON.stringify(portal.PRIVACY_NOTICE.sections)));
    assert.notEqual(qrCore.privacyNoticeSha256(), sha(JSON.stringify(was(QR.PRIVACY_NOTICE).sections)));
    assert.notEqual(portal.privacyNoticeSha256(), sha(JSON.stringify(was(portal.PRIVACY_NOTICE).sections)));
    // the project brief's previous text is still on the books: its hash is what a consent already stored under it points at
    assert.equal(cir.noticeFor('2026-09-26.1').sha256, sha(JSON.stringify(CIR.NOTICES['2026-09-26.1'].sections)));
    assert.notEqual(cir.noticeFor('2026-09-26.1').sha256, cir.noticeFor('2026-10-22.1').sha256);
  });
});

describe('what the project brief keeps, so that a page open before the deploy still submits', () => {
  it('knows both versions: the original text (Gmail address and all — it is what stored briefs were shown) and the current one', () => {
    assert.deepEqual(Object.keys(CIR.NOTICES), ['2026-09-26.1', '2026-10-22.1']);
    assert.ok(controller(CIR.NOTICES['2026-09-26.1']).body.endsWith(`${GMAIL}.`));
    assert.ok(controller(CIR.NOTICES['2026-10-22.1']).body.endsWith(`${DOMAIN}.`));
    // the original is byte-for-byte what it was before the redesign (a stored hash), so a consent recorded against it can still be proved
    assert.equal(sha(JSON.stringify(CIR.NOTICES['2026-09-26.1'].sections)), '94b36eaf177e7a5e8653c9227ffe9c30f11c18dcb903e3a4b92340439fa9c990');
  });

  it('accepts either version and nothing else; an unknown or look-alike version is refused', () => {
    assert.ok(cir.noticeFor('2026-09-26.1') && cir.noticeFor('2026-10-22.1'));
    for (const bad of ['2026-10-22.2', '2026-10-21.1', '2026-10-22', '', 'constructor', '__proto__', undefined, null, 7]) assert.equal(cir.noticeFor(bad), null, String(bad));
  });
});

describe('what the quote request and the client portal do with an older version', () => {
  const index = read('functions/index.js');

  it('the quote request accepts only the CURRENT notice and the current page version: a stale page is asked to reload', () => {
    assert.match(index, /if \(consent\.noticeVersion !== qr\.QR_DEF\.PRIVACY_NOTICE\.version\) \{\s*throw new functions\.https\.HttpsError\('failed-precondition', 'The privacy notice was updated — please reload and review it again\.'\);/);
    assert.match(index, /if \(d\.defVersion !== qr\.QR_DEF\.VERSION\) \{\s*throw new functions\.https\.HttpsError\('failed-precondition', 'This page was updated — please reload\.'\);/);
    assert.equal(QR.VERSION, 3, 'the definition version moves with a notice change (a page still on 2 is refused)');
    assert.match(read('js/qr-def.js'), /\/\/ VERSION: bump on ANY change to INTAKE \/ LIMITS \/ ESTIMATE \/ PRIVACY_NOTICE/);
  });

  it('the portal accepts only the CURRENT notice when a contract is signed: a page that showed the old one is asked to reload and review', () => {
    assert.match(index, /if \(rawPrivacy\.noticeVersion !== portal\.PRIVACY_NOTICE\.version\) \{\s*throw new functions\.https\.HttpsError\('failed-precondition', 'The privacy notice was updated — please reload and review it again\.'\);/);
    assert.match(index, /noticeVersion: rawPrivacy\.noticeVersion, noticeSha256: portal\.privacyNoticeSha256\(\)/, 'the acceptance records the version AND the hash of the text shown');
  });

  it('a saved quote-request draft keeps its items and details but drops a consent given under an older notice', () => {
    const src = read('js/quote-request.js');
    assert.match(src, /if \(isObj\(d\.consent\) && d\.consent\.agreed === true && d\.consent\.noticeVersion === D\.PRIVACY_NOTICE\.version\) out\.consent = \{ agreed: true, noticeVersion: d\.consent\.noticeVersion \};/);
    assert.match(src, /consent: \{ agreed: true, noticeVersion: D\.PRIVACY_NOTICE\.version \}/, 'a new submit sends the version it actually showed');
  });
});

describe('the portal page\'s own demo copy of its notice is in step with the server\'s', () => {
  const page = read('projects/chibabs/projectconfirmation/index.html');
  const block = page.slice(page.indexOf('privacyNotice: {'), page.indexOf('function mockDeepClone'));

  it('carries the same version and the domain address, and never the Gmail one', () => {
    assert.ok(block.length > 500, 'the mock notice block was not found');
    assert.ok(block.includes(`version: "${portal.PRIVACY_NOTICE.version}"`));
    assert.ok(block.includes(`Contact for privacy matters: the President, 0927 683 6300, ${DOMAIN}.`));
    assert.ok(!/gmail/i.test(block));
  });
});
