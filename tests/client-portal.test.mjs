// tests/client-portal.test.mjs — CLIENT-PORTAL-CHIBABS-SPEC.md §7.5.
//
// Pins functions/portal-core.js: pure, zero-Firebase-dependency helpers for
// the four client-portal callables in functions/index.js. Same zero-deps
// harness as tests/geo.test.mjs (node:test + node:assert only). This file
// touches js/money-core.js NOWHERE — the portal has no money math of its
// own beyond milestoneCheck's arithmetic guard, which is pinned below.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const portal = require('../functions/portal-core.js');

// The real Chibab's milestones (CLIENT-PORTAL-CHIBABS-SPEC.md §1.1) — used
// as the canonical "known good" fixture across several test blocks.
const CHIBABS_TOTAL = 1408100;
const chibabsMilestones = () => ([
  { key: 'M1', pct: 20, amount: 281620, parts: [{ label: 'Initial payment', amount: 50000, dueOn: '2026-09-26' }, { label: 'Balance', amount: 231620, dueOn: '2026-09-28' }] },
  { key: 'M2', pct: 40, amount: 563240 },
  { key: 'M3', pct: 15, amount: 211215 },
  { key: 'M4', pct: 25, amount: 352025 },
]);

// A minimal valid 1x1 PNG (67 bytes), padded with trailing zero bytes to
// clear the 1024-byte floor — validateSignaturePng only checks the magic
// bytes + declared prefix + total length, never full PNG structure, so
// padding after a real PNG is a legitimate way to hit an arbitrary size.
const REAL_PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
function pngDataUrlOfSize(totalBytes) {
  const pad = Buffer.alloc(Math.max(0, totalBytes - REAL_PNG_1X1.length), 0);
  return 'data:image/png;base64,' + Buffer.concat([REAL_PNG_1X1, pad]).toString('base64');
}

describe('refNo', () => {
  it('matches the BKC-yymmdd-XXXXXX shape and excludes 0/O/1/I', () => {
    const re = new RegExp(`^BKC-\\d{6}-[${portal.CODE_ALPHABET}]{6}$`);
    for (let i = 0; i < 50; i++) {
      const r = portal.refNo(Date.now() - i * 3600000);
      assert.match(r, re);
      assert.ok(!/[0O1I]/.test(r.slice(-6)), `suffix must not contain 0/O/1/I: ${r}`);
    }
  });

  it('date part equals manilaDateFrom(nowMs) even when UTC is still "yesterday"', () => {
    // 2026-09-25T18:30Z + 8h = 2026-09-26T02:30 Manila -> '260926'.
    const nowMs = Date.parse('2026-09-25T18:30:00Z');
    const r = portal.refNo(nowMs, () => Buffer.from([0, 0, 0, 0, 0, 0]));
    assert.equal(portal.manilaDateFrom(nowMs), '2026-09-26');
    assert.equal(r.slice(4, 10), '260926');
  });
});

describe('milestoneCheck', () => {
  it('passes on the real Chibab\'s milestones', () => {
    const r = portal.milestoneCheck(CHIBABS_TOTAL, chibabsMilestones());
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
    const amounts = chibabsMilestones().map((m) => m.amount);
    assert.deepEqual(amounts, [281620, 563240, 211215, 352025]);
    assert.equal(281620, 50000 + 231620);
  });

  it('fails when M2 is off by one peso', () => {
    const bad = chibabsMilestones();
    bad[1].amount = 563241;
    const r = portal.milestoneCheck(CHIBABS_TOTAL, bad);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('M2')));
  });

  it('fails when pcts sum to 99', () => {
    const bad = chibabsMilestones();
    bad[1].pct = 39; // 20+39+15+25 = 99
    const r = portal.milestoneCheck(CHIBABS_TOTAL, bad);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('pct sum')));
  });

  it('fails when an M1 part is off by one peso', () => {
    const bad = chibabsMilestones();
    bad[0].parts[1].amount = 231621;
    const r = portal.milestoneCheck(CHIBABS_TOTAL, bad);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('parts sum')));
  });
});

describe('hashCode / verifyCode / normalizeCode / generateCode', () => {
  it('round-trips a correct code and rejects a wrong one', () => {
    const { saltHex, hashHex } = portal.hashCode('7F3K2QAB');
    assert.equal(portal.verifyCode('7F3K2QAB', saltHex, hashHex), true);
    assert.equal(portal.verifyCode('WRONGCOD', saltHex, hashHex), false);
  });

  it('normalizeCode uppercases and strips the hyphen', () => {
    assert.equal(portal.normalizeCode('7f3k-2qab'), '7F3K2QAB');
  });

  it('normalizeCode returns "" for codes containing 0/O/1/I', () => {
    assert.equal(portal.normalizeCode('0123-4567'), '');
    assert.equal(portal.normalizeCode('AOI1BCDE'), '');
  });

  it('generateCode matches ^[ALPHABET]{4}-[ALPHABET]{4}$ over 200 draws', () => {
    const re = new RegExp(`^[${portal.CODE_ALPHABET}]{4}-[${portal.CODE_ALPHABET}]{4}$`);
    for (let i = 0; i < 200; i++) assert.match(portal.generateCode(), re);
  });
});

describe('rateLimitDecision', () => {
  it('a null bucket is allowed', () => {
    const d = portal.rateLimitDecision(null, 1000, portal.RATE.ip);
    assert.equal(d.allowed, true);
  });

  it('4 failures allowed, the 5th sets lockedUntil = now + 15m (ip cfg)', () => {
    let bucket = null;
    const now = 1_000_000;
    for (let i = 1; i <= 4; i++) {
      const d = portal.rateLimitDecision(bucket, now, portal.RATE.ip);
      assert.equal(d.allowed, true, `attempt ${i} should be allowed`);
      assert.equal(d.next.lockedUntil, 0, `attempt ${i} should not lock yet`);
      bucket = d.next;
    }
    const fifth = portal.rateLimitDecision(bucket, now, portal.RATE.ip);
    assert.equal(fifth.allowed, true); // the 5th attempt itself still proceeds
    assert.equal(fifth.next.lockedUntil - now, portal.RATE.ip.lock);
  });

  it('a locked bucket denies with retryAfterMs', () => {
    const now = 1_000_000;
    const locked = { count: 5, windowStart: now, lockedUntil: now + 900000, lockStreak: 1 };
    const d = portal.rateLimitDecision(locked, now + 1000, portal.RATE.ip);
    assert.equal(d.allowed, false);
    assert.equal(d.retryAfterMs, 900000 - 1000);
  });

  it('window expiry resets the count', () => {
    const now = 1_000_000;
    const stale = { count: 4, windowStart: now, lockedUntil: 0, lockStreak: 0 };
    const later = now + portal.RATE.ip.window + 1;
    const d = portal.rateLimitDecision(stale, later, portal.RATE.ip);
    assert.equal(d.next.count, 1); // reset to 0, then +1 for this attempt
    assert.equal(d.next.windowStart, later);
  });

  it('a second consecutive lock doubles the lock duration (capped at maxLock)', () => {
    const now = 1_000_000;
    // Bucket already carries lockStreak:1 from a prior lock (now expired).
    const afterFirstLock = { count: 5, windowStart: now, lockedUntil: now + 1, lockStreak: 1 };
    const later = now + portal.RATE.ip.lock + 1000;
    let bucket = { count: 0, windowStart: later, lockedUntil: 0, lockStreak: 1 };
    // Drive it to its own 5th failure to trigger the second lock.
    for (let i = 1; i <= 4; i++) {
      const d = portal.rateLimitDecision(bucket, later, portal.RATE.ip);
      bucket = d.next;
    }
    const fifth = portal.rateLimitDecision(bucket, later, portal.RATE.ip);
    assert.equal(fifth.next.lockStreak, 2);
    assert.equal(fifth.next.lockedUntil - later, portal.RATE.ip.lock * 2);
  });

  it('caps the doubling at maxLock', () => {
    const now = 1_000_000;
    let bucket = { count: 4, windowStart: now, lockedUntil: 0, lockStreak: 10 }; // huge streak
    const d = portal.rateLimitDecision(bucket, now, portal.RATE.ip);
    assert.ok(d.next.lockedUntil - now <= portal.RATE.ip.maxLock);
    assert.equal(d.next.lockedUntil - now, portal.RATE.ip.maxLock);
  });

  it('a malformed bucket (count is a string) is a deny, fail-closed', () => {
    const d = portal.rateLimitDecision({ count: 'x', windowStart: 0, lockedUntil: 0 }, 1000, portal.RATE.ip);
    assert.equal(d.allowed, false);
  });

  it('bucketAfterSuccess fully resets count/lock/streak', () => {
    const b = portal.bucketAfterSuccess(5000);
    assert.deepEqual(b, { count: 0, windowStart: 5000, lockedUntil: 0, lockStreak: 0 });
  });
});

describe('sessions', () => {
  it('newViewerToken produces a 43-char base64url token and a 64-hex-char hash', () => {
    const { token, tokenHash } = portal.newViewerToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(portal.tokenHash(token), tokenHash);
  });

  it('SESSION_TTL_MS is exactly 90 days', () => {
    assert.equal(portal.SESSION_TTL_MS, 90 * 24 * 3600 * 1000);
  });

  it('sessionValid is false when expired, when generation mismatches, when portalId differs', () => {
    const nowMs = 1_000_000_000;
    const base = { portalId: 'chibabs__projectconfirmation', generation: 1, expiresAt: nowMs + 1000 };
    assert.equal(portal.sessionValid(base, { nowMs, generation: 1, portalId: 'chibabs__projectconfirmation' }), true);
    assert.equal(portal.sessionValid({ ...base, expiresAt: nowMs - 1 }, { nowMs, generation: 1, portalId: 'chibabs__projectconfirmation' }), false);
    assert.equal(portal.sessionValid(base, { nowMs, generation: 2, portalId: 'chibabs__projectconfirmation' }), false);
    assert.equal(portal.sessionValid(base, { nowMs, generation: 1, portalId: 'other__page' }), false);
  });
});

describe('validateSignaturePng', () => {
  it('rejects a JPEG-prefixed data URL', () => {
    const bad = pngDataUrlOfSize(2000).replace('image/png', 'image/jpeg');
    assert.equal(portal.validateSignaturePng(bad).ok, false);
  });

  it('rejects wrong magic bytes even with a correct prefix', () => {
    const notPng = 'data:image/png;base64,' + Buffer.alloc(2000, 0x41).toString('base64');
    assert.equal(portal.validateSignaturePng(notPng).ok, false);
  });

  it('rejects 500 bytes (too small) and 250 KB (too big)', () => {
    assert.equal(portal.validateSignaturePng(pngDataUrlOfSize(500)).ok, false);
    assert.equal(portal.validateSignaturePng(pngDataUrlOfSize(250000)).ok, false);
  });

  it('accepts a real 1x1 PNG padded to >= 1024 bytes', () => {
    const r = portal.validateSignaturePng(pngDataUrlOfSize(1024));
    assert.equal(r.ok, true);
    assert.equal(r.bytes, 1024);
  });
});

describe('publicProjection', () => {
  const portalDoc = {
    id: 'chibabs__projectconfirmation',
    status: 'live',
    codeHash: 'SECRET-HASH', codeSalt: 'SECRET-SALT', internalNotes: 'never leak me',
    sessionsGeneration: 3,
    client: { name: 'Joseph Asis', company: "Chibab's Chicken Inasal Food Corp.", contactName: 'Joseph Asis', address: 'Quezon City', email: 'joseph@example.com', phone: '0917-000-0000' },
    proposal: { number: 'BKMLVB260914-014R1', validUntil: '2099-01-01' },
    figures: { contractTotal: CHIBABS_TOTAL },
    milestones: chibabsMilestones(),
    zones: [],
    items: [{ no: 1, name: 'Range', unitPrice: 5000, cost: 100, qty: 2, subtotal: 10000 }],
    workflow: [], steps: [], terms: [], agreementsRequired: ['scope', 'price', 'terms', 'payment'],
    payments: [{ id: 'p1', milestoneKey: 'M1', amount: 50000, receivedOn: '2026-09-26', method: 'cash', note: 'internal only' }],
    progress: { currentStep: 1, steps: { 1: { state: 'current', on: '2026-09-26' } } },
  };
  const updates = [{
    id: 'u1', at: Date.now(), title: 'Kickoff', body: 'Started', visible: true,
    photos: [
      { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/y.jpg', caption: 'ok' },
      { url: 'https://evil.example.com/steal.jpg', caption: 'should be dropped' },
    ],
  }];

  it('strips every §1.9 field and keeps every §2.5 top-level key', () => {
    const state = portal.publicProjection(portalDoc, updates, { nowMs: Date.now() });
    assert.deepEqual(Object.keys(state).sort(), ['acceptance', 'portal', 'privacyNotice', 'progress', 'server'].sort());

    const json = JSON.stringify(state);
    assert.ok(!json.includes('SECRET-HASH'));
    assert.ok(!json.includes('SECRET-SALT'));
    assert.ok(!json.includes('never leak me'));
    assert.ok(!json.includes('joseph@example.com'));
    assert.ok(!json.includes('internal only'));
    assert.ok(!json.includes('evil.example.com'));

    assert.equal(state.portal.items[0].unitPrice, undefined);
    assert.equal(state.portal.items[0].cost, undefined);
    assert.equal(state.portal.items[0].qty, undefined);
    assert.equal(state.portal.items[0].subtotal, undefined);
    assert.equal(state.portal.items[0].name, 'Range'); // non-sensitive keys survive

    assert.equal(state.progress.updates[0].photos.length, 1);
    assert.equal(state.progress.updates[0].photos[0].url.startsWith('https://firebasestorage.googleapis.com/'), true);
    assert.equal(state.progress.payments[0].note, undefined);
  });

  it('strips item-level amount/total/rate/disc while milestone and payment amounts survive (regression: §1.1 vs §1.9 regex contradiction)', () => {
    // §1.1's items row is explicit: "No qty, unitPrice, amount, cost,
    // subtotal keys, ever" — 'amount' IS the per-item money on an equipment
    // line and must never reach the client. The original §1.9 regex omitted
    // it; this pins the fix (SENSITIVE_ITEM_KEY_RE now also catches amount/
    // total/rate/disc) WITHOUT letting the guard bleed into the legitimate,
    // confirmed money on milestones[]/payments[] — that pairing is what
    // stops a future fix from over-correcting in the other direction.
    const hostileDoc = {
      ...portalDoc,
      items: [{ no: 1, name: 'Range', dims: '900x800x850', zoneNo: 1, amount: 88888, total: 99999, rate: 1234, disc: '15%' }],
    };
    const state = portal.publicProjection(hostileDoc, [], { nowMs: Date.now() });

    const item = state.portal.items[0];
    assert.deepEqual(Object.keys(item).sort(), ['dims', 'name', 'no', 'zoneNo'].sort());
    assert.equal(item.amount, undefined);
    assert.equal(item.total, undefined);
    assert.equal(item.rate, undefined);
    assert.equal(item.disc, undefined);

    // Milestones — untouched, all four confirmed figures still present.
    assert.equal(state.portal.milestones[0].amount, 281620);
    assert.equal(state.portal.milestones[1].amount, 563240);
    assert.equal(state.portal.milestones[2].amount, 211215);
    assert.equal(state.portal.milestones[3].amount, 352025);

    // Payments — untouched, the (non-sensitive) amount field survives.
    assert.equal(state.progress.payments[0].amount, 50000);
  });

  it('acceptance is null when no acceptanceDoc is supplied', () => {
    const state = portal.publicProjection(portalDoc, [], { nowMs: Date.now() });
    assert.equal(state.acceptance, null);
  });

  it('flags server.expired once validUntil has passed', () => {
    const expiredDoc = { ...portalDoc, proposal: { ...portalDoc.proposal, validUntil: '2000-01-01' } };
    const state = portal.publicProjection(expiredDoc, [], { nowMs: Date.now() });
    assert.equal(state.server.expired, true);
  });
});

describe('PRIVACY_NOTICE', () => {
  it('version matches the expected pattern', () => {
    assert.match(portal.PRIVACY_NOTICE.version, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('sections include the required substrings', () => {
    const text = JSON.stringify(portal.PRIVACY_NOTICE.sections);
    for (const needle of ['Barro Industries OPC', '0927 683 6300', 'National Privacy Commission', 'portability', 'erasure']) {
      assert.ok(text.includes(needle), `expected privacy notice to mention "${needle}"`);
    }
  });

  it('privacyNoticeSha256 is a stable 64-hex-char digest of the sections', () => {
    const h1 = portal.privacyNoticeSha256();
    const h2 = portal.privacyNoticeSha256();
    assert.match(h1, /^[0-9a-f]{64}$/);
    assert.equal(h1, h2);
  });
});

describe('buildOutboxBody', () => {
  it('contains the refNo, the formatted contract total, and the portal URL', () => {
    const portalDoc = {
      id: 'chibabs__projectconfirmation',
      client: { company: "Chibab's Chicken Inasal Food Corp." },
      proposal: { number: 'BKMLVB260914-014R1', title: 'Commercial Kitchen Proposal' },
      figures: { contractTotal: CHIBABS_TOTAL },
      milestones: chibabsMilestones(),
    };
    const acceptance = { refNo: 'BKC-260926-7F3K2Q', signedOnManila: '2026-09-26', signer: { name: 'Joseph Asis' } };
    const body = portal.buildOutboxBody(portalDoc, acceptance);
    assert.ok(body.includes('BKC-260926-7F3K2Q'));
    assert.ok(body.includes('PHP 1,408,100'));
    assert.ok(body.includes('https://barroindustries.com/projects/chibabs/projectconfirmation/'));
  });
});

// ── The public page's code filter must agree with the server's alphabet ──────
//
// REGRESSION (found in production 2026-09-26, by the owner, on the very first
// real access code). The page filtered typed input with a hand-written range
// /[^A-HJ-NP-TV-Z2-9]/ that did NOT match CODE_ALPHABET: U sits between T and
// V so it fell into neither range and was silently stripped, while L was
// wrongly admitted. ~23% of generated codes contain a U, so roughly one code
// in four could not be typed into the page at all -- it ate the character and
// then rejected the result as wrong. The page now derives its filter from a
// single CODE_ALPHABET constant; these tests pin the two copies together so
// they can never drift again.
describe('public page code filter vs server alphabet', () => {
  const pageSrc = require('node:fs').readFileSync(
    new URL('../projects/chibabs/projectconfirmation/index.html', import.meta.url), 'utf8');

  const pageAlphabet = (pageSrc.match(/var CODE_ALPHABET = "([^"]+)"/) || [])[1];

  it('the page declares an alphabet identical to portal-core CODE_ALPHABET', () => {
    assert.equal(pageAlphabet, portal.CODE_ALPHABET);
  });

  it('derives the filter from the alphabet instead of hand-writing ranges', () => {
    assert.ok(/new RegExp\("\[\^" \+ CODE_ALPHABET \+ "\]"/.test(pageSrc),
      'page must build its strip regex from CODE_ALPHABET');
    assert.ok(!/replace\(\/\[\^A-HJ-NP-TV-Z2-9\]\/g/.test(pageSrc),
      'the broken hand-written range must not be live code anywhere');
  });

  it('keeps every character the server can actually mint — U included', () => {
    const strip = new RegExp('[^' + pageAlphabet + ']', 'g');
    for (const ch of portal.CODE_ALPHABET) {
      assert.equal(ch.replace(strip, ''), ch, `page filter strips '${ch}', which the server can mint`);
    }
    assert.equal('U'.replace(strip, ''), 'U');            // the exact character that broke
  });

  it('still rejects the ambiguous characters the alphabet excludes', () => {
    const strip = new RegExp('[^' + pageAlphabet + ']', 'g');
    for (const ch of ['I', 'L', 'O', '0', '1']) {
      assert.equal(ch.replace(strip, ''), '', `page filter must drop ambiguous '${ch}'`);
      assert.ok(!portal.CODE_ALPHABET.includes(ch), `server alphabet must not contain '${ch}'`);
    }
  });

  it('round-trips a real U-bearing code through the page filter unchanged', () => {
    const strip = new RegExp('[^' + pageAlphabet + ']', 'g');
    assert.equal('4UXB-7PUV'.toUpperCase().replace(strip, ''), '4UXB7PUV');
    assert.equal(portal.normalizeCode('4UXB-7PUV'), '4UXB7PUV');
  });
});
