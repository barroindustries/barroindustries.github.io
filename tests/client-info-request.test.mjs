// tests/client-info-request.test.mjs — CLIENT-INFO-REQUEST-SPEC.md §6 WS-B.
//
// Pins functions/cir-core.js: pure, zero-Firebase-dependency helpers for the
// five Client Information Request callables in functions/index.js. Same
// zero-deps harness as tests/client-portal.test.mjs / tests/geo.test.mjs
// (node:test + node:assert only, no emulator, no network). This file also
// pins the WS-0 mirror invariant (js/cir-forms.js == functions/cir-forms.js)
// as a functional regression test, independent of ci-invariants check 7.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cir = require('../functions/cir-core.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const FORM = cir.FORMS.commissary_brief;

// A minimal, well-formed JPEG buffer of an exact total size: real magic (FF D8
// FF) + real EOI (FF D9), padded in between — validateJpegDataUrl only checks
// magic/EOI/size, never full JPEG structure, so padding to an arbitrary size
// between them is a legitimate way to hit any byte count for the tests below.
function jpegDataUrlOfSize(totalBytes) {
  const buf = Buffer.alloc(totalBytes, 0x00);
  buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF;
  buf[totalBytes - 2] = 0xFF; buf[totalBytes - 1] = 0xD9;
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

// A complete, valid answer set for FORM's six required fields plus a handful
// of optional ones — the "happy path" fixture reused across several blocks.
function happyAnswers(overrides) {
  const base = {
    name: 'Joseph Asis',
    position: 'Owner',
    company: "Chibab's Chicken Inasal Food Corp.",
    phone: '0917-000-0000',
    email: 'joseph@example.com',
    address: '123 Commonwealth Ave, Quezon City',
    site_address: '456 Industrial Rd, Valenzuela City',
    contact_pref: 'Viber',
    biz_type: 'Restaurant group / multi-branch',
    branches_now: 5,
    process: ['Baking', 'Frying', 'Baking'], // deliberately unordered + duplicated
    current_equipment: [
      { item: '3-burner range', qty: 2, brand: 'Foster', power: 'LPG', cond: 'Good', plan: 'Reuse' },
      { item: '', qty: 9, brand: 'should be dropped (no item)' },
      { item: 'Prep table', qty: 3 },
    ],
    target_date: '2026-12-01',
    budget: '₱1M – ₱3M',
  };
  return Object.assign(base, overrides || {});
}

describe('refNo', () => {
  it('matches CIR-yymmdd-XXXXXX and excludes 0/O/1/I', () => {
    const alphaRe = /^CIR-\d{6}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
    for (let i = 0; i < 50; i++) {
      const r = cir.refNo(Date.now() - i * 3600000);
      assert.match(r, alphaRe);
      assert.ok(!/[0O1I]/.test(r.slice(-6)), `suffix must not contain 0/O/1/I: ${r}`);
    }
  });

  it('date part is the Manila date of nowMs, even across a UTC day boundary', () => {
    // 2026-09-25T18:30Z + 8h = 2026-09-26T02:30 Manila -> '260926'.
    const nowMs = Date.parse('2026-09-25T18:30:00Z');
    const r = cir.refNo(nowMs, () => Buffer.from([0, 0, 0, 0, 0, 0]));
    assert.equal(r.slice(4, 10), '260926');
    assert.equal(r.slice(0, 4), 'CIR-');
  });

  it('is deterministic given the same randomBytes function', () => {
    const fixed = () => Buffer.from([1, 2, 3, 4, 5, 6]);
    const a = cir.refNo(1_800_000_000_000, fixed);
    const b = cir.refNo(1_800_000_000_000, fixed);
    assert.equal(a, b);
  });
});

describe('photoId / draftPath / finalPath', () => {
  it('photoId matches p_ + 12 lowercase hex', () => {
    for (let i = 0; i < 20; i++) assert.match(cir.photoId(), /^p_[0-9a-f]{12}$/);
  });

  it('draftPath and finalPath build the exact §1.3 Storage paths', () => {
    assert.equal(cir.draftPath('abc123', 'p_deadbeef0000'), 'client-info-requests/drafts/abc123/p_deadbeef0000.jpg');
    assert.equal(cir.finalPath('CIR-260926-ABCDEF', 'p_deadbeef0000'), 'client-info-requests/CIR-260926-ABCDEF/p_deadbeef0000.jpg');
  });
});

describe('validateAnswers — happy path', () => {
  const r = cir.validateAnswers(FORM, happyAnswers());

  it('accepts a fully-valid submission with no errors', () => {
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.errors, []);
  });

  it('trims/keeps required text fields as-is', () => {
    assert.equal(r.clean.name, 'Joseph Asis');
    assert.equal(r.clean.company, "Chibab's Chicken Inasal Food Corp.");
  });

  it('blank optional fields are omitted from clean (never "" / null)', () => {
    assert.ok(!('menu' in r.clean), '"menu" was left blank and must not appear in clean');
    assert.ok(!('gas_monthly' in r.clean));
  });

  it('number field survives with the correct numeric type', () => {
    assert.equal(r.clean.branches_now, 5);
    assert.equal(typeof r.clean.branches_now, 'number');
  });

  it('date field is kept as the YYYY-MM-DD string', () => {
    assert.equal(r.clean.target_date, '2026-12-01');
  });
});

describe('validateAnswers — chips dedupe/reorder', () => {
  it('deduplicates and re-orders chip values into option order, ignoring client order', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ process: ['Baking', 'Frying', 'Baking'] }));
    assert.equal(r.ok, true);
    // Option order: … 'Cook-chill','Frying','Rice cooking','Baking' … so Frying precedes Baking.
    assert.deepEqual(r.clean.process, ['Frying', 'Baking']);
  });

  it('rejects a chips value that is not one of the field\'s options', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ process: ['Not a real option'] }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /"What the commissary will do"/.test(e) && /unknown option/.test(e)));
  });
});

describe('validateAnswers — table row dropping', () => {
  it('drops rows lacking the first column value, without an error, and keeps the valid rows', () => {
    const r = cir.validateAnswers(FORM, happyAnswers());
    assert.equal(r.ok, true);
    assert.equal(r.clean.current_equipment.length, 2); // the no-`item` row is silently dropped
    assert.equal(r.clean.current_equipment[0].item, '3-burner range');
    assert.equal(r.clean.current_equipment[0].power, 'LPG');
    assert.equal(r.clean.current_equipment[1].item, 'Prep table');
  });

  it('truncates an over-length cell to LIMITS.maxCellChars', () => {
    const longBrand = 'B'.repeat(cir.LIMITS.maxCellChars + 50);
    const r = cir.validateAnswers(FORM, happyAnswers({
      current_equipment: [{ item: 'Range', brand: longBrand }],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.clean.current_equipment[0].brand.length, cir.LIMITS.maxCellChars);
  });

  it('rejects a table with more than maxRows valid rows', () => {
    const rows = [];
    for (let i = 0; i < 41; i++) rows.push({ item: `Item ${i}` });
    const r = cir.validateAnswers(FORM, happyAnswers({ current_equipment: rows }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /too many rows/.test(e)));
  });

  it('rejects an invalid select cell value inside a row', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({
      current_equipment: [{ item: 'Range', power: 'Nuclear' }],
    }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /invalid cell value/.test(e)));
  });
});

describe('validateAnswers — every rejection class', () => {
  it('unknown field key', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ totally_bogus_key: 'x' }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('Unknown field "totally_bogus_key"'));
  });

  it('required field missing', () => {
    const a = happyAnswers();
    delete a.company;
    const r = cir.validateAnswers(FORM, a);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('"Company name" is required'));
  });

  it('invalid phone number', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ phone: 'call me maybe' }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /"Mobile number"/.test(e)));
  });

  it('invalid email address', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ email: 'not-an-email' }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /"Email"/.test(e)));
  });

  it('invalid url (missing http/https)', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ plans_link: 'javascript:alert(1)' }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /"Link to floor plan/.test(e)));
  });

  it('number below the field minimum', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ branches_now: -5 }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /out of range/.test(e)));
  });

  it('number with more than 2 decimal places', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ area: 100.12345 }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /decimal places/.test(e)));
  });

  it('number sent as a string is rejected, not coerced', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ branches_now: '5' }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /must be a number/.test(e)));
  });

  it('malformed date string', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ target_date: '2026/12/01' }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /not a valid date/.test(e)));
  });

  it('calendar-invalid date (Feb 30)', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ target_date: '2026-02-30' }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /not a valid calendar date/.test(e)));
  });

  it('date year outside 2000-2100', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ target_date: '1999-01-01' }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /year is out of range/.test(e)));
  });

  it('select value not one of the field\'s options', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ biz_type: 'Time travel agency' }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /"Type of business"/.test(e)));
  });

  it('over-length text field', () => {
    const r = cir.validateAnswers(FORM, happyAnswers({ name: 'N'.repeat(200) }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /too long/.test(e)));
  });
});

describe('validateJpegDataUrl', () => {
  it('accepts a well-formed JPEG within the size range', () => {
    const r = cir.validateJpegDataUrl(jpegDataUrlOfSize(5000));
    assert.equal(r.ok, true);
    assert.equal(r.bytes, 5000);
    assert.ok(Buffer.isBuffer(r.buf));
  });

  it('rejects wrong magic bytes', () => {
    const buf = Buffer.alloc(5000, 0x41);
    const dataUrl = 'data:image/jpeg;base64,' + buf.toString('base64');
    const r = cir.validateJpegDataUrl(dataUrl);
    assert.equal(r.ok, false);
    assert.match(r.error, /not a valid JPEG/);
  });

  it('rejects a missing EOI marker', () => {
    const buf = Buffer.alloc(5000, 0x00);
    buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF; // magic ok
    buf[4998] = 0x00; buf[4999] = 0x00; // EOI corrupted
    const dataUrl = 'data:image/jpeg;base64,' + buf.toString('base64');
    const r = cir.validateJpegDataUrl(dataUrl);
    assert.equal(r.ok, false);
    assert.match(r.error, /incomplete/);
  });

  it('rejects a PNG-prefixed data URL (wrong declared type)', () => {
    const r = cir.validateJpegDataUrl(jpegDataUrlOfSize(5000).replace('image/jpeg', 'image/png'));
    assert.equal(r.ok, false);
  });

  it('rejects below LIMITS.minPhotoBytes', () => {
    const r = cir.validateJpegDataUrl(jpegDataUrlOfSize(cir.LIMITS.minPhotoBytes - 10));
    assert.equal(r.ok, false);
    assert.match(r.error, /size is out of range/);
  });

  it('rejects above LIMITS.maxPhotoBytes', () => {
    const r = cir.validateJpegDataUrl(jpegDataUrlOfSize(cir.LIMITS.maxPhotoBytes + 10));
    assert.equal(r.ok, false);
    assert.match(r.error, /size is out of range/);
  });

  it('accepts exactly at the min/max boundaries', () => {
    assert.equal(cir.validateJpegDataUrl(jpegDataUrlOfSize(cir.LIMITS.minPhotoBytes)).ok, true);
    assert.equal(cir.validateJpegDataUrl(jpegDataUrlOfSize(cir.LIMITS.maxPhotoBytes)).ok, true);
  });
});

describe('botCheck', () => {
  it('honeypot filled -> bot, reason honeypot (checked BEFORE timing)', () => {
    const r = cir.botCheck({ honeypot: 'i am a bot', draftCreatedMs: 1000, nowMs: 1000 + cir.LIMITS.minFillMs + 5000 });
    assert.equal(r.bot, true);
    assert.equal(r.reason, 'honeypot');
  });

  it('submitted faster than LIMITS.minFillMs -> bot, reason too_fast', () => {
    const r = cir.botCheck({ honeypot: '', draftCreatedMs: 1000, nowMs: 1000 + cir.LIMITS.minFillMs - 1 });
    assert.equal(r.bot, true);
    assert.equal(r.reason, 'too_fast');
  });

  it('a normal, unhurried, non-honeypot submission is not a bot', () => {
    const r = cir.botCheck({ honeypot: '', draftCreatedMs: 1000, nowMs: 1000 + cir.LIMITS.minFillMs + 20000 });
    assert.equal(r.bot, false);
    assert.equal(r.reason, null);
  });

  it('a whitespace-only honeypot trims to empty and is NOT treated as filled', () => {
    const r = cir.botCheck({ honeypot: '   ', draftCreatedMs: 1000, nowMs: 1000 + cir.LIMITS.minFillMs + 5000 });
    assert.equal(r.bot, false);
    assert.equal(r.reason, null);
  });
});

describe('fingerprintDay', () => {
  it('is deterministic for the same normalized inputs', () => {
    const a = cir.fingerprintDay('Joseph@Example.com', '0917-000-0000', '2026-09-26');
    const b = cir.fingerprintDay('joseph@example.com', '09170000000', '2026-09-26');
    assert.equal(a, b, 'case-insensitive email + digits-only phone must fingerprint identically');
  });

  it('is a 64-hex-char digest followed by |<manilaDate>', () => {
    const fp = cir.fingerprintDay('a@b.com', '0917 000 0000', '2026-09-26');
    assert.match(fp, /^[0-9a-f]{64}\|2026-09-26$/);
  });

  it('differs when the phone digits differ', () => {
    const a = cir.fingerprintDay('a@b.com', '0917 000 0000', '2026-09-26');
    const b = cir.fingerprintDay('a@b.com', '0917 000 0001', '2026-09-26');
    assert.notEqual(a, b);
  });

  it('differs across Manila dates (not folded into the hashed portion)', () => {
    const a = cir.fingerprintDay('a@b.com', '0917 000 0000', '2026-09-26');
    const b = cir.fingerprintDay('a@b.com', '0917 000 0000', '2026-09-27');
    assert.notEqual(a, b);
    assert.equal(a.split('|')[0], b.split('|')[0], 'the hashed portion itself is unchanged — only the date suffix differs');
  });
});

describe('buildSummary', () => {
  it('projects exactly the summaryKeys fields, stringifying numbers, defaulting blanks to \'\'', () => {
    const av = cir.validateAnswers(FORM, happyAnswers());
    assert.equal(av.ok, true);
    const summary = cir.buildSummary(FORM, av.clean, 3);
    assert.equal(summary.name, 'Joseph Asis');
    assert.equal(summary.company, "Chibab's Chicken Inasal Food Corp.");
    assert.equal(summary.phone, '0917-000-0000');
    assert.equal(summary.bizType, 'Restaurant group / multi-branch');
    assert.equal(summary.budget, '₱1M – ₱3M');
    assert.equal(summary.targetDate, '2026-12-01');
    assert.equal(summary.photoCount, 3);
  });

  it('blank/omitted answer keys become \'\' in the summary, never undefined', () => {
    const a = happyAnswers();
    delete a.budget; // optional field, legitimately blank
    const av = cir.validateAnswers(FORM, a);
    const summary = cir.buildSummary(FORM, av.clean, 0);
    assert.equal(summary.budget, '');
  });
});

describe('buildNotification', () => {
  it('uses plain emoji (not emojiIcon markup) and the exact type/link', () => {
    const doc = { refNo: 'CIR-260926-ABCDEF', summary: { name: 'Joseph Asis', company: 'Acme Corp', bizType: 'Bakery / pastry', budget: '₱1M – ₱3M' } };
    const n = cir.buildNotification(doc);
    assert.equal(n.icon, '📥');
    assert.equal(n.type, 'client_info_request');
    assert.equal(n.link, 'dept:Sales');
    assert.ok(n.title.startsWith('📥 New client brief — Acme Corp'));
    assert.ok(n.body.includes('Ref CIR-260926-ABCDEF'));
    assert.ok(!/<[a-z]/i.test(n.icon), 'icon must not be emojiIcon() markup like <i data-lucide=…>');
  });

  it('never contains a "<" character even when company/name are hostile', () => {
    const doc = {
      refNo: 'CIR-260926-ABCDEF',
      summary: { name: '<img src=x onerror=alert(1)>', company: '<script>alert(1)</script>', bizType: 'Other', budget: 'Below ₱1M' },
    };
    const n = cir.buildNotification(doc);
    assert.ok(!n.title.includes('<'), `title leaked a "<": ${n.title}`);
    assert.ok(!n.body.includes('<'), `body leaked a "<": ${n.body}`);
  });

  it('caps title at 200 chars and body at 2000 chars', () => {
    const doc = {
      refNo: 'CIR-260926-ABCDEF',
      summary: { name: 'N'.repeat(500), company: 'C'.repeat(500), bizType: 'B'.repeat(500), budget: 'D'.repeat(500) },
    };
    const n = cir.buildNotification(doc);
    assert.ok(n.title.length <= 200);
    assert.ok(n.body.length <= 2000);
  });

  it('falls back to sensible placeholders when bizType/budget are blank', () => {
    const doc = { refNo: 'CIR-260926-ABCDEF', summary: { name: 'Joseph', company: '' } };
    const n = cir.buildNotification(doc);
    assert.ok(n.body.includes('business type not given'));
    assert.ok(n.body.includes('budget not given'));
    assert.ok(n.title.includes('Joseph')); // falls back to name when company is blank
  });
});

describe('validatePhotoList', () => {
  function draftPhotosFixture() {
    return {
      p_aaaaaaaaaaaa: { group: 'site', bytes: 5000, width: 800, height: 600, path: 'client-info-requests/drafts/x/p_aaaaaaaaaaaa.jpg', uploadedAt: 1 },
      p_bbbbbbbbbbbb: { group: 'kitchen', bytes: 6000, width: 800, height: 600, path: 'client-info-requests/drafts/x/p_bbbbbbbbbbbb.jpg', uploadedAt: 2 },
    };
  }

  it('accepts a valid list matching the draft\'s own recorded group', () => {
    const r = cir.validatePhotoList(FORM, [
      { photoId: 'p_aaaaaaaaaaaa', group: 'site', caption: 'Front entrance' },
      { photoId: 'p_bbbbbbbbbbbb', group: 'kitchen', caption: '' },
    ], draftPhotosFixture());
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.clean.length, 2);
    assert.equal(r.clean[0].caption, 'Front entrance');
    assert.equal(r.clean[0].bytes, 5000);
  });

  it('rejects a photoId the draft never recorded (ownership check)', () => {
    const r = cir.validatePhotoList(FORM, [
      { photoId: 'p_cccccccccccc', group: 'site', caption: '' },
    ], draftPhotosFixture());
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /not found in your upload session/.test(e)));
  });

  it('rejects a group that does not match the draft\'s recorded group for that photo', () => {
    const r = cir.validatePhotoList(FORM, [
      { photoId: 'p_aaaaaaaaaaaa', group: 'docs', caption: '' }, // draft recorded 'site'
    ], draftPhotosFixture());
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /group does not match/.test(e)));
  });

  it('rejects a group that is not one of the form\'s own photo groups', () => {
    const r = cir.validatePhotoList(FORM, [
      { photoId: 'p_aaaaaaaaaaaa', group: 'not-a-real-group', caption: '' },
    ], draftPhotosFixture());
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /invalid group/.test(e)));
  });

  it('truncates an over-length caption to LIMITS.maxCaption instead of erroring', () => {
    const longCaption = 'x'.repeat(cir.LIMITS.maxCaption + 40);
    const r = cir.validatePhotoList(FORM, [
      { photoId: 'p_aaaaaaaaaaaa', group: 'site', caption: longCaption },
    ], draftPhotosFixture());
    assert.equal(r.ok, true);
    assert.equal(r.clean[0].caption.length, cir.LIMITS.maxCaption);
  });

  it('rejects a duplicate photoId in the same submission', () => {
    const r = cir.validatePhotoList(FORM, [
      { photoId: 'p_aaaaaaaaaaaa', group: 'site', caption: '' },
      { photoId: 'p_aaaaaaaaaaaa', group: 'site', caption: '' },
    ], draftPhotosFixture());
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Duplicate photo/.test(e)));
  });

  it('rejects a list longer than LIMITS.maxPhotos', () => {
    const many = [];
    for (let i = 0; i < cir.LIMITS.maxPhotos + 1; i++) many.push({ photoId: `p_${String(i).padStart(12, '0')}`, group: 'site', caption: '' });
    const r = cir.validatePhotoList(FORM, many, draftPhotosFixture());
    assert.equal(r.ok, false);
  });
});

describe('WS-0 mirror invariant (functional regression, independent of ci-invariants check 7)', () => {
  it('functions/cir-forms.js is byte-identical to js/cir-forms.js', () => {
    const a = fs.readFileSync(path.join(REPO_ROOT, 'js', 'cir-forms.js'));
    const b = fs.readFileSync(path.join(REPO_ROOT, 'functions', 'cir-forms.js'));
    assert.ok(a.equals(b), 'functions/cir-forms.js has drifted from js/cir-forms.js — cp js/cir-forms.js functions/cir-forms.js');
  });

  it('every field key is unique across the whole commissary_brief form', () => {
    const keys = [];
    FORM.sections.forEach((sec) => sec.fields.forEach((f) => keys.push(f.key)));
    // 'photos' (the field key) intentionally shares its name with the
    // 'photos' section key — sections and fields are different namespaces —
    // so dedupe only within the fields array itself.
    assert.equal(new Set(keys).size, keys.length, 'duplicate field key found in FORMS.commissary_brief');
  });

  it('every summaryKeys value points at a real field key', () => {
    const fieldKeys = new Set();
    FORM.sections.forEach((sec) => sec.fields.forEach((f) => fieldKeys.add(f.key)));
    Object.values(FORM.summaryKeys).forEach((fk) => assert.ok(fieldKeys.has(fk), `summaryKeys references unknown field "${fk}"`));
  });

  it('RATE config matches the §2.0 spec literally', () => {
    assert.deepEqual(cir.RATE.start, { window: 3600e3, max: 20, lock: 3600e3, maxLock: 24 * 3600e3 });
    assert.deepEqual(cir.RATE.photo, { window: 3600e3, max: 80, lock: 3600e3, maxLock: 24 * 3600e3 });
    assert.deepEqual(cir.RATE.submit, { window: 24 * 3600e3, max: 5, lock: 24 * 3600e3, maxLock: 7 * 24 * 3600e3 });
    assert.deepEqual(cir.RATE.global, { window: 3600e3, max: 40, lock: 1800e3, maxLock: 6 * 3600e3 });
  });
});

describe('privacyNoticeSha256', () => {
  it('is a stable 64-hex-char digest', () => {
    const h1 = cir.privacyNoticeSha256();
    const h2 = cir.privacyNoticeSha256();
    assert.match(h1, /^[0-9a-f]{64}$/);
    assert.equal(h1, h2);
  });
});
