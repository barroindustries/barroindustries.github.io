// tests/quote-request-callables.test.mjs — PUBLIC-QUOTE-REQUEST-SPEC.md §5 (WS-B): the REAL callables in
// functions/index.js (qrStartSession / qrEstimate / qrSubmit / qrAdminDelete) run end to end against a strict in-memory
// Firestore stand-in (tests/fixtures/fake-firestore.cjs) — no emulator, no network. tests/quote-request.test.mjs pins the
// pure logic in qr-core; THIS file pins the glue that wires it to Firestore: rate-limit buckets, the session counter, the
// products cache, transactions that return verdicts, the stored document, the notifications, the response shapes.
//
// Seed data is FAKE: real product ids (they are public — they are on the public catalogue page) with made-up round-ish
// pesos, so the real published-id allowlist (functions/qr-published.json) is exercised without any real price.
//
// It needs the functions' own node_modules (firebase-functions). CI runs `node --test tests/*.test.mjs` without
// installing functions/, so the whole file skips itself when that package is absent.
//
// Mutation-tested (scratch copies): dropping the published filter in qrLoadProducts, adding `exactTotal` to a response,
// throwing inside a transaction callback, a notification carrying senderUid, the per-session cap removed, the bot check
// removed, the well-formed-body guard removed from any of the three public callables, gate-denied calls logged one by one,
// the qr_abuse purge never running, the client-reported figure no longer compared with the server's — each must fail here.
//
// Run with: node --test tests/*.test.mjs

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HAVE_DEPS = fs.existsSync(path.join(ROOT, 'functions', 'node_modules', 'firebase-functions', 'package.json'));
const SKIP = HAVE_DEPS ? false : 'functions/node_modules is not installed (firebase-functions missing)';

const { createFake, FakeTimestamp } = require('./fixtures/fake-firestore.cjs');
const QR = require('../functions/qr-def.js');
const Q = require('../functions/qr-core.js');
const portal = require('../functions/portal-core.js');
const CIR = require('../functions/cir-forms.js');
const ALLOW = JSON.parse(fs.readFileSync(path.join(ROOT, 'functions/qr-published.json'), 'utf8'));
const PUB = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/public-categories.json'), 'utf8'));

const T0 = Date.UTC(2026, 9, 21, 2, 0, 0);                 // 2026-10-21 10:00 Manila
const fake = createFake();

function loadFunctions() {
  const idx = require.resolve('../functions/index.js');
  delete require.cache[idx];                               // cold module state (products cache, LRU, counters) per test
  const orig = Module._load;
  Module._load = function (request) { if (request === 'firebase-admin') return fake.admin; return orig.apply(this, arguments); };
  try { return require(idx); } finally { Module._load = orig; }
}

// The REAL request decoder of the installed firebase-functions (loaded by file path: the package's "exports" map hides it from
// bare specifiers). A callable body goes through it before the handler runs, so the hostile-shape tests use it, not a guess.
const decodeWire = HAVE_DEPS ? require(path.join(ROOT, 'functions', 'node_modules', 'firebase-functions', 'lib', 'common', 'providers', 'https.js')).decode : null;

let fns;
const ctx = (ip, extra) => ({ rawRequest: { headers: { 'x-forwarded-for': ip || '198.51.100.7', 'user-agent': 'qr-test-agent', 'accept-language': 'en-PH', referer: 'https://barroindustries.com/catalogue/' } }, ...(extra || {}) });
const tick = (ms) => mock.timers.tick(ms);
const rejectsWith = async (p, code, msgRe) => {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`); if (msgRe) assert.match(e.message, msgRe); return true; });
};

// ── fake master: REAL published ids, FAKE figures ───────────────────────────
// FIXED products only: the SKUs a configurable family absorbed (e.g. CE-001, PW-001, BA-001) are no longer quotable as plain lines.
const P_LEN = 'CE-009', P_FIX = 'RF-003', P_NOD = 'CE-031', P_ZERO = 'CE-024', P_SPEC = 'BA-011';
function seedMaster(over) {
  const base = (data) => ({ unit: 'pc', formula: {}, specs: [], measurement: {}, ...data });
  fake.seed(`products/${P_LEN}`, base({ title: 'Fake Stove', category: 'cooking_line', basePrice: 7770, formulaType: 'per_length', measurement: { W: 1200, D: 600, H: 800 }, formula: { baseLengthMm: 1200, pricePerExtraMm: 3.3, rateW100: 50, rateD100: 31, rateH100: 0 } }));
  fake.seed(`products/${P_FIX}`, base({ title: 'Fake Table', category: 'prep_washing', basePrice: 4217, formulaType: 'fixed', measurement: { W: 900, D: 700, H: 850 } }));
  fake.seed(`products/${P_NOD}`, base({ title: 'Fake Gadget', category: 'miscellaneous', basePrice: 1111, formulaType: 'fixed' }));
  fake.seed(`products/${P_ZERO}`, base({ title: 'Fake Unpriced', category: 'cooking_line', basePrice: 0, formulaType: 'fixed', measurement: { W: 1000 } }));
  fake.seed(`products/${P_SPEC}`, base({ title: 'Fake Bench', category: 'baking', basePrice: 3000, formulaType: 'fixed', measurement: { W: 1500, D: 700 }, specs: [{ label: 'Undershelf', options: ['None', 'Fixed', 'Adjustable'], default: 'Fixed', priceAdder: [-200, 0, 350] }] }));
  // UNPUBLISHED products that DO exist in Firestore with a perfectly good fake price:
  for (const id of ['EX-001', 'FA-001', 'GL-001', 'FS-001', Object.keys(PUB.excludedProducts)[0]]) fake.seed(`products/${id}`, base({ title: `Hidden ${id}`, category: 'exhaust_system', basePrice: 999, formulaType: 'fixed' }));
  fake.seed('products/legacy-placeholder', { name: 'Steel Fabrication', baseRate: 5000, code: 'LEG' });
  fake.seed('productMeta/config', { categories: [], laborRoles: [], constants: { materialPriceIndexMultiplier: 1 }, ...(over || {}) });
}
function seedUsers() {
  fake.seed('users/u_pres', { role: 'president', displayName: 'Pres', email: 'p@x.com' });
  fake.seed('users/u_mgr', { role: 'manager', displayName: 'Mgr', departments: ['Admin'] });
  fake.seed('users/u_sales1', { role: 'employee', department: 'Sales', displayName: 'Sales One' });
  fake.seed('users/u_sales2', { role: 'employee', departments: ['Design', 'Sales'], displayName: 'Sales Two' });
  fake.seed('users/u_partner', { role: 'partner', departments: ['Sales'], displayName: 'Partner' });
  fake.seed('users/u_sec', { role: 'secretary', departments: ['Admin'], displayName: 'Sec' });
  fake.seed('users/u_it', { role: 'employee', department: 'IT', displayName: 'IT' });
}

let counter = 0;
async function newSession(ip) {
  const r = await fns.qrStartSession.run({ defVersion: QR.VERSION }, ctx(ip));
  return r.sessionToken;
}
const ITEMS = () => [{ id: P_LEN, qty: 1, size: null, runs: null, specs: [], note: '' }, { id: P_FIX, qty: 2, size: { W: 1000 }, runs: null, specs: [], note: 'for the kitchen' }];
const submitPayload = (token, over) => {
  counter++;
  return {
    sessionToken: token, defVersion: QR.VERSION,
    intake: { need: 'equipment', useFor: 'restaurant_cafe', entityType: 'private', targetDate: '2026-12-01', address: '12 Rizal St, Tandang Sora, Quezon City' },
    contact: { name: 'Juan Dela Cruz', mobile: '0917 123 4567', email: `juan${counter}@example.com`, company: 'JDC Foods' },
    items: ITEMS(), consent: { agreed: true, noticeVersion: QR.PRIVACY_NOTICE.version }, honeypot: '', fillMs: 91000, lastEstimate: null,
    ...(over || {}),
  };
};
const estimatePayload = (token, over) => ({ sessionToken: token, defVersion: QR.VERSION, entityType: 'private', items: ITEMS(), ...(over || {}) });

const RESPONSE_KEYS = ['basketHash', 'currency', 'customSizeCount', 'deliveryIncluded', 'estimateVersion', 'high', 'low', 'notes', 'ok', 'pricedCount', 'reason', 'reviewCount', 'serverNow', 'shown', 'step', 'vatBasis'];

describe('qr callables — against the in-memory Firestore', { skip: SKIP }, () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['Date'], now: T0 });
    fake.reset();
    seedMaster();
    seedUsers();
    counter = 0;
    fns = loadFunctions();
  });
  afterEach(() => { mock.timers.reset(); });

  it('the fake master really uses published ids (and the hidden ones really are not)', () => {
    for (const id of [P_LEN, P_FIX, P_NOD, P_ZERO, P_SPEC]) assert.ok(ALLOW.ids.includes(id), id);
    for (const id of ['EX-001', 'FA-001', 'GL-001', 'FS-001', Object.keys(PUB.excludedProducts)[0]]) assert.ok(!ALLOW.ids.includes(id), id);
  });

  describe('qrStartSession', () => {
    it('creates a session: token is 43 base64url chars, the doc is keyed by its hash and holds NO raw token', async () => {
      const r = await fns.qrStartSession.run({ defVersion: QR.VERSION }, ctx());
      assert.equal(r.ok, true);
      assert.match(r.sessionToken, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(r.serverNow, new Date(T0).toISOString());
      assert.deepEqual(Object.keys(r).sort(), ['ok', 'serverNow', 'sessionToken']);
      const doc = fake.read(`qr_sessions/${portal.tokenHash(r.sessionToken)}`);
      assert.deepEqual(Object.keys(doc).sort(), ['createdAt', 'estimateCount', 'ipHash', 'lastBasketHash', 'lastEstimateAt', 'refNo', 'submittedAt', 'uaHash']);
      assert.equal(doc.estimateCount, 0);
      assert.equal(doc.submittedAt, null);
      assert.equal(doc.createdAt.toMillis(), T0);
      assert.ok(!JSON.stringify(doc).includes(r.sessionToken));
      assert.ok(!JSON.stringify(doc).includes('198.51.100.7'), 'a raw IP is stored');
    });
    it('refuses a stale page (defVersion mismatch)', async () => {
      assert.equal(QR.VERSION, 3, 'the definition version moved with the 2026-10-22 notice change');
      await rejectsWith(fns.qrStartSession.run({ defVersion: QR.VERSION - 1 }, ctx()), 'failed-precondition', /updated/);   // a page loaded before the notice change
      await rejectsWith(fns.qrStartSession.run({ defVersion: 999 }, ctx()), 'failed-precondition', /updated/);
      await rejectsWith(fns.qrStartSession.run({}, ctx()), 'failed-precondition');
      await rejectsWith(fns.qrStartSession.run(undefined, ctx()), 'failed-precondition');
    });
    it('FAILS CLOSED when there is no trustworthy client IP (a spoofed / absent header is a denial, never "unlimited")', async () => {
      await rejectsWith(fns.qrStartSession.run({ defVersion: QR.VERSION }, { rawRequest: { headers: {} } }), 'resource-exhausted', /Too many requests/);
      await rejectsWith(fns.qrStartSession.run({ defVersion: QR.VERSION }, { rawRequest: { headers: { 'x-forwarded-for': 'not-an-ip' } } }), 'resource-exhausted');
      assert.equal(fake.list('qr_sessions').length, 0);
    });
    it('rate limits: 20 starts / hour / IP — the 21st from the same address is denied, another address is not', async () => {
      for (let i = 0; i < 20; i++) await newSession('203.0.113.50');
      await rejectsWith(newSession('203.0.113.50'), 'resource-exhausted', /minute/);
      await newSession('203.0.113.51');
      const bucketIds = fake.list('qr_ratelimit').map((b) => b.id);
      assert.ok(bucketIds.includes('global_start'));
      assert.ok(bucketIds.every((id) => id === 'global_start' || /^[0-9a-f]{64}$/.test(id)), 'a bucket id is not a hash');
    });
    it('the per-IP bucket keys on the RIGHT-most X-Forwarded-For entry: a caller cannot mint a fresh bucket with a forged leftmost value', async () => {
      for (let i = 0; i < 20; i++) await newSession(`10.${i}.0.1, 203.0.113.60`);      // forged left, real (Google-appended) right
      await rejectsWith(newSession('10.99.0.1, 203.0.113.60'), 'resource-exhausted');
    });
    it('stale sessions are purged best-effort (older than 7 days), fresh ones are kept', async () => {
      fake.seed('qr_sessions/old1', { createdAt: new FakeTimestamp(T0 - 8 * 24 * 3600e3), submittedAt: null });
      fake.seed('qr_sessions/fresh1', { createdAt: new FakeTimestamp(T0 - 1000), submittedAt: null });
      await newSession();
      assert.equal(fake.has('qr_sessions/old1'), false);
      assert.equal(fake.has('qr_sessions/fresh1'), true);
    });
  });

  describe('qr_abuse retention', () => {
    it('records older than 30 days are swept out best-effort (oldest first, a few per call); recent ones are kept', async () => {
      for (let i = 0; i < 7; i++) fake.seed(`qr_abuse/old${i}`, { at: new FakeTimestamp(T0 - (31 + i) * 24 * 3600e3), kind: 'honeypot', ipHash: 'h', detail: {} });
      fake.seed('qr_abuse/fresh1', { at: new FakeTimestamp(T0 - 3600e3), kind: 'honeypot', ipHash: 'h', detail: {} });
      await newSession();                                                            // qrStartSession purges up to 5
      assert.equal(fake.list('qr_abuse').filter((a) => a.id.startsWith('old')).length, 2, '5 of the 7 stale records are gone after one call');
      assert.equal(fake.has('qr_abuse/fresh1'), true);
      await newSession();
      assert.equal(fake.list('qr_abuse').filter((a) => a.id.startsWith('old')).length, 0);
      assert.equal(fake.has('qr_abuse/fresh1'), true);
    });
    it('a failing purge (the qr_abuse query throws) never fails qrStartSession or qrSubmit', async () => {
      const origCollection = fake.db.collection;
      fake.db.collection = (name) => (name === 'qr_abuse' ? { orderBy: () => ({ limit: () => ({ get: async () => { throw new Error('abuse log down'); } }) }), add: async () => ({}) } : origCollection(name));
      try {
        const token = await newSession();
        assert.match(token, /^[A-Za-z0-9_-]{43}$/);
        tick(21000);
        const res = await fns.qrSubmit.run(submitPayload(token), ctx());
        assert.ok(fake.read(`quote_requests/${res.refNo}`));
      } finally { fake.db.collection = origCollection; }
    });
  });

  describe('qrEstimate', () => {
    it('two priced products -> the rounded range, with EXACTLY the spec key set', async () => {
      const token = await newSession();
      const r = await fns.qrEstimate.run(estimatePayload(token), ctx());
      assert.deepEqual(Object.keys(r).sort(), RESPONSE_KEYS);
      assert.equal(r.ok, true);
      assert.equal(r.shown, true);
      assert.equal(r.reason, null);
      // 7770 + 2 x 4217 = 16,204 -> 0.90 x = 14,583.6 (floor to the 5,000 step: 10,000) · 1.15 x = 18,634.6 (ceil: 20,000)
      assert.deepEqual([r.low, r.high, r.step], [10000, 20000, 5000]);
      assert.equal(r.currency, 'PHP');
      assert.equal(r.vatBasis, 'exclusive');
      assert.equal(r.deliveryIncluded, false);
      assert.equal(r.pricedCount, 2);
      assert.equal(r.reviewCount, 0);
      assert.equal(r.customSizeCount, 1);
      assert.ok(r.notes.includes(QR.COPY.vatExclusive) && r.notes.includes(QR.COPY.deliveryExcluded) && r.notes.includes(QR.COPY.customSizeNote));
      assert.match(r.basketHash, /^[0-9a-f]{64}$/);
    });
    it('NO price reaches the response: no exact total, no unit price, no line figure anywhere in it', async () => {
      const token = await newSession();
      const r = await fns.qrEstimate.run(estimatePayload(token), ctx());
      const json = JSON.stringify(r);
      assert.ok(!/exact|unitPrice|lineTotal|basePrice|priceAdder|formula|lines/i.test(json), json);
      const nums = new Set();
      JSON.stringify(r, (k, v) => { if (typeof v === 'number') nums.add(v); return v; });
      for (const secret of [16204, 7770, 4217, 8434, 4217 * 2]) assert.ok(!nums.has(secret), `${secret} leaked`);
    });
    it('a single cheap item is GATED: no figure at all (shown false, low/high/step null) — the differencing mitigation', async () => {
      const token = await newSession();
      const r = await fns.qrEstimate.run(estimatePayload(token, { items: [{ id: P_NOD, qty: 1, size: null, runs: null, specs: [], note: '' }] }), ctx());
      assert.equal(r.shown, false);
      assert.equal(r.reason, 'gate');
      assert.deepEqual([r.low, r.high, r.step], [null, null, null]);
      assert.deepEqual(Object.keys(r).sort(), RESPONSE_KEYS);
      // a single gate-denied call is NOT logged individually (that would let a caller grow qr_abuse at will) ...
      assert.equal(fake.list('qr_abuse').length, 0);
    });
    it('gate-denied probes are SAMPLED 1-in-20 into qr_abuse as estimate_gate — bounded growth, no price in the record', async () => {
      const token = await newSession();
      const probe = { items: [{ id: P_NOD, qty: 1, size: null, runs: null, specs: [], note: '' }] };
      for (let i = 0; i < 100; i++) await fns.qrEstimate.run(estimatePayload(token, probe), ctx(`10.7.${Math.floor(i / 50)}.${(i % 50) + 1}`));
      await new Promise((r) => setImmediate(r));
      const abuse = fake.list('qr_abuse');
      assert.equal(abuse.length, 5, '100 gate-denied calls -> 5 sampled records, not 100');
      assert.ok(abuse.every((a) => a.data.kind === 'estimate_gate'));
      assert.ok(!/\d{4,}/.test(JSON.stringify(abuse[0].data.detail).replace(/[0-9a-f]{64}/, '')), 'a figure sits in the abuse log');
    });
    it('a single item at >= 50,000 is shown; unpriced lines are excluded and counted for review', async () => {
      const token = await newSession();
      const r = await fns.qrEstimate.run(estimatePayload(token, { items: [{ id: P_LEN, qty: 20, size: null, runs: null, specs: [], note: '' }, { id: P_ZERO, qty: 1, size: null, runs: null, specs: [], note: '' }] }), ctx());
      assert.equal(r.shown, true);                                                 // 20 x 7770 = 155,400
      assert.equal(r.reviewCount, 1);
      assert.ok(r.notes.includes(QR.COPY.reviewCount(1)));
    });
    it('government entity: same figures plus the procurement note', async () => {
      const token = await newSession();
      const priv = await fns.qrEstimate.run(estimatePayload(token), ctx());
      const gov = await fns.qrEstimate.run(estimatePayload(token, { entityType: 'government' }), ctx());
      assert.deepEqual([gov.low, gov.high], [priv.low, priv.high]);
      assert.ok(gov.notes.includes(QR.COPY.governmentNote));
      assert.ok(!priv.notes.includes(QR.COPY.governmentNote));
    });
    it('UNPUBLISHED products are refused with the same message as an unknown id — even though they exist in Firestore with a price', async () => {
      const token = await newSession();
      for (const id of ['EX-001', 'FA-001', 'GL-001', 'FS-001', Object.keys(PUB.excludedProducts)[0], 'legacy-placeholder', 'NOT-THERE']) {
        await assert.rejects(fns.qrEstimate.run(estimatePayload(token, { items: [{ id: P_FIX, qty: 1, size: null, runs: null, specs: [], note: '' }, { id, qty: 1, size: null, runs: null, specs: [], note: '' }] }), ctx()),
          (e) => { assert.equal(e.code, 'invalid-argument'); assert.equal(e.message, Q.GONE_MSG); assert.deepEqual(e.details, { itemIds: [id] }); return true; });
      }
    });
    it('item validation is the server\'s: an oversize, a bad step, a bad spec, a family/config key and a stored price are all refused', async () => {
      const token = await newSession();
      const bad = [
        { id: P_FIX, qty: 999 }, { id: P_FIX, qty: 1, size: { W: 99999 } }, { id: P_FIX, qty: 1, size: { W: 1005 } },
        { id: P_SPEC, qty: 1, specs: [{ label: 'Undershelf', value: 'Gold' }] }, { id: P_FIX, qty: 1, family: 'sink' }, { id: P_FIX, qty: 1, config: {} },
        { id: P_FIX, qty: 1, unitPrice: 1 }, { id: P_FIX, qty: 1, runs: 3 },
      ];
      for (const it of bad) await rejectsWith(fns.qrEstimate.run(estimatePayload(token, { items: [it] }), ctx()), 'invalid-argument');
    });
    it('shape / session errors: a bad token, a stale page, a missing entity, an empty basket, an oversized payload, an unknown session', async () => {
      const token = await newSession();
      await rejectsWith(fns.qrEstimate.run(estimatePayload('short'), ctx()), 'unauthenticated');
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token, { defVersion: 0 }), ctx()), 'failed-precondition', /updated/);
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token, { entityType: 'alien' }), ctx()), 'invalid-argument');
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token, { items: [] }), ctx()), 'invalid-argument');
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token, { items: Array.from({ length: 41 }, () => ({ id: P_FIX, qty: 1 })) }), ctx()), 'invalid-argument');
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token, { pad: 'x'.repeat(61000) }), ctx()), 'invalid-argument', /too large/);
      await rejectsWith(fns.qrEstimate.run(estimatePayload('A'.repeat(43)), ctx()), 'failed-precondition', /session expired/);
    });
    it('an expired (> 7 days) or already-submitted session is refused', async () => {
      const token = await newSession();
      tick(7 * 24 * 3600e3 + 1000);
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token), ctx()), 'failed-precondition', /session expired/);
    });
    it('the products master is read ONCE per 10 minutes per instance, then served from cache (and re-read after)', async () => {
      const token = await newSession();
      await fns.qrEstimate.run(estimatePayload(token), ctx());
      await fns.qrEstimate.run(estimatePayload(token, { items: [{ id: P_FIX, qty: 3, size: null, runs: null, specs: [], note: '' }, { id: P_NOD, qty: 1, size: null, runs: null, specs: [], note: '' }] }), ctx());
      assert.equal(fake.stats.collectionGets['products'], 1);
      assert.equal(fake.stats.docGets['productMeta/config'], 1);
      tick(10 * 60 * 1000 + 1);
      await fns.qrEstimate.run(estimatePayload(token), ctx());
      assert.equal(fake.stats.collectionGets['products'], 2);
    });
    it('a master EDIT is picked up within the cache TTL (the estimate follows the live price)', async () => {
      const token = await newSession();
      const before = await fns.qrEstimate.run(estimatePayload(token), ctx());
      fake.seed(`products/${P_LEN}`, { ...fake.read(`products/${P_LEN}`), basePrice: 77770 });
      tick(10 * 60 * 1000 + 1);
      const after = await fns.qrEstimate.run(estimatePayload(token), ctx());
      assert.ok(after.low > before.low && after.high > before.high);
    });
    it('the kill-switch (O7): productMeta/config.quoteRequest.estimateEnabled=false -> shown false / "disabled", no pricing done', async () => {
      fake.seed('productMeta/config', { constants: {}, quoteRequest: { estimateEnabled: false } });
      const token = await newSession();
      const r = await fns.qrEstimate.run(estimatePayload(token), ctx());
      assert.equal(r.shown, false);
      assert.equal(r.reason, 'disabled');
      assert.deepEqual([r.low, r.high, r.step, r.basketHash], [null, null, null, null]);
      assert.deepEqual(Object.keys(r).sort(), RESPONSE_KEYS);
    });
    it('the material-price-index multiplier from productMeta/config is applied', async () => {
      const token = await newSession();
      const a = await fns.qrEstimate.run(estimatePayload(token), ctx());
      fake.seed('productMeta/config', { constants: { materialPriceIndexMultiplier: 2 } });
      tick(10 * 60 * 1000 + 1);
      const b = await fns.qrEstimate.run(estimatePayload(token), ctx());
      assert.ok(b.low > a.high, 'doubling the index did not move the range');
    });
    it('FAILS CLOSED when the master cannot be read and there is no cache (no price is ever invented)', async () => {
      fake.reset();                                         // no products at all
      seedUsers();
      fns = loadFunctions();
      const token = await newSession();
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token), ctx()), 'unavailable');
    });
    it('a refresh that fails is covered by a cache < 24 h old, and NOT by an older one', async () => {
      const token = await newSession();
      await fns.qrEstimate.run(estimatePayload(token), ctx());                 // loads the cache at T0
      const origCollection = fake.db.collection;
      fake.db.collection = (name) => (name === 'products' ? { limit: () => ({ get: async () => { throw new Error('boom'); } }) } : origCollection(name));
      try {
        tick(11 * 60 * 1000);                                                   // stale (> 10 min) but < 24 h: the cache covers the failed refresh
        const r = await fns.qrEstimate.run(estimatePayload(token), ctx());
        assert.equal(r.shown, true);
        tick(24 * 3600e3);                                                      // now > 24 h old: never priced from it
        await rejectsWith(fns.qrEstimate.run(estimatePayload(token), ctx()), 'unavailable');
      } finally { fake.db.collection = origCollection; }
    });
    it('rate limit: 60 estimates / hour / IP — the 61st is denied, a different address is not', async () => {
      const token = await newSession();
      for (let i = 0; i < 60; i++) await fns.qrEstimate.run(estimatePayload(token), ctx('203.0.113.70'));
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token), ctx('203.0.113.70')), 'resource-exhausted', /minute/);
      await fns.qrEstimate.run(estimatePayload(token), ctx('203.0.113.71'));
    });
    it('per-SESSION cap: 150 estimates / day however many addresses are used (IP rotation does not help) — then "paused", with no write', async () => {
      const token = await newSession();
      for (let i = 0; i < 150; i++) await fns.qrEstimate.run(estimatePayload(token), ctx(`10.7.${Math.floor(i / 250)}.${(i % 250) + 1}`));
      const sess = fake.read(`qr_sessions/${portal.tokenHash(token)}`);
      assert.equal(sess.estimateCount, 150);
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token), ctx('10.8.0.1')), 'resource-exhausted', /paused/);
      assert.equal(fake.read(`qr_sessions/${portal.tokenHash(token)}`).estimateCount, 150, 'a blocked call must not write');
      tick(24 * 3600e3 + 1000);                             // a quiet day later the window reopens (the session is still inside its 7 days)
      const r = await fns.qrEstimate.run(estimatePayload(token), ctx('10.8.0.2'));
      assert.equal(r.shown, true);
      assert.equal(fake.read(`qr_sessions/${portal.tokenHash(token)}`).estimateCount, 1);
    });
    it('GLOBAL cap (IP-independent): 2,000 estimates / hour in total — the 2,001st from a never-seen address and a fresh session is denied', async () => {
      // 20 sessions x 100 estimates, every call from a distinct address, so neither the per-IP bucket nor the per-session cap can be what stops it
      let n = 0;
      for (let s = 0; s < 20; s++) {
        const token = await newSession(`172.16.${s}.1`);
        for (let i = 0; i < 100; i++) { n++; await fns.qrEstimate.run(estimatePayload(token), ctx(`10.${20 + Math.floor(n / 60000)}.${Math.floor(n / 250) % 240}.${(n % 250) + 1}`)); }
      }
      assert.equal(n, 2000);
      const t = await newSession('172.17.0.1');
      await rejectsWith(fns.qrEstimate.run(estimatePayload(t), ctx('10.99.99.99')), 'resource-exhausted', /minute/);
      assert.ok(fake.read('qr_ratelimit/global_estimate').lockedUntil > T0);
    });
    it('every call counts on the session: estimateCount, lastEstimateAt and a (non-price) lastBasketHash are stamped', async () => {
      const token = await newSession();
      await fns.qrEstimate.run(estimatePayload(token), ctx());
      tick(1000);
      await fns.qrEstimate.run(estimatePayload(token), ctx());
      const sess = fake.read(`qr_sessions/${portal.tokenHash(token)}`);
      assert.equal(sess.estimateCount, 2);
      assert.equal(sess.lastEstimateAt.toMillis(), T0 + 1000);
      assert.match(sess.lastBasketHash, /^[0-9a-f]{64}$/);
    });
    it('every 20th estimate per instance is sampled to qr_abuse (forensics), without any figure', async () => {
      const token = await newSession();
      for (let i = 0; i < 20; i++) await fns.qrEstimate.run(estimatePayload(token), ctx(`10.9.0.${i + 1}`));
      await new Promise((r) => setImmediate(r));
      const samples = fake.list('qr_abuse').filter((a) => a.data.kind === 'estimate_sample');
      assert.equal(samples.length, 1);
      assert.deepEqual(Object.keys(samples[0].data.detail).sort(), ['basketHash', 'lines', 'shown']);
    });
  });

  describe('qrEstimate / qrSubmit — hostile request shapes', () => {
    const line = (id, qty) => ({ id, qty, size: null, runs: null, specs: [], note: '' });
    it('ONE PRODUCT, ONE MULTIPLIER over the wire: 40 lines x qty 20 of one product (an 800-unit exact-price oracle) is refused by both callables', async () => {
      const token = await newSession();
      const flood = Array.from({ length: 40 }, () => line(P_FIX, 20));
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token, { items: flood }), ctx()), 'invalid-argument', /at most 20 of one product/);
      const t2 = await newSession(); tick(21000);
      await rejectsWith(fns.qrSubmit.run(submitPayload(t2, { items: flood }), ctx()), 'invalid-argument', /at most 20 of one product/);
      assert.equal(fake.list('quote_requests').length, 0);
      // the largest single-product figure a caller can still obtain is 20 units
      const ok = await fns.qrEstimate.run(estimatePayload(token, { items: [line(P_FIX, 20)] }), ctx());
      assert.equal(ok.shown, true);                                                  // 20 x 4,217 = 84,340 >= 50,000
    });
    it('a body whose fields hide on a smuggled __proto__ (invisible to JSON.stringify and to every Object.keys allowlist) is refused before anything is consumed', async () => {
      const token = await newSession();
      const inner = estimatePayload(token);
      const smuggleWire = (o) => JSON.parse('{"__proto__":' + JSON.stringify(o) + '}');   // (an object LITERAL with that key would set a prototype; JSON.parse keeps an OWN key, as on the wire)
      const wire = smuggleWire(inner);
      const decoded = decodeWire(wire);
      assert.deepEqual(Object.keys(decoded), [], 'precondition: the real decoder moves every field onto the prototype');
      assert.equal(JSON.stringify(decoded).length, 2, 'precondition: the size guard would read 2 bytes');
      assert.equal(decoded.defVersion, QR.VERSION, 'precondition: yet the handler could still read the fields');
      const before = fake.list('qr_ratelimit').length;
      await rejectsWith(fns.qrEstimate.run(decoded, ctx()), 'invalid-argument', /not in the expected format/);
      await rejectsWith(fns.qrSubmit.run(decodeWire(smuggleWire(submitPayload(token))), ctx()), 'invalid-argument', /not in the expected format/);
      await rejectsWith(fns.qrStartSession.run(decodeWire(JSON.parse('{"__proto__":{"defVersion":1}}')), ctx()), 'invalid-argument', /not in the expected format/);
      assert.equal(fake.list('qr_ratelimit').length, before, 'a refused body must not consume a rate-limit bucket');
    });
    it('the strict item-key allowlist cannot be bypassed by smuggling family / config (or an extra qty) through an item\'s prototype', async () => {
      const token = await newSession();
      const smuggledItem = decodeWire(JSON.parse('{"id":"' + P_FIX + '","__proto__":{"qty":3,"family":"sink","config":{"x":1}}}'));
      assert.equal(smuggledItem.family, 'sink', 'precondition: inherited, so Object.keys cannot see it');
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token, { items: [smuggledItem, line(P_LEN, 1)] }), ctx()), 'invalid-argument', /not in the expected format/);
    });
    it('a legitimately decoded request still passes the same guard (the real decoder output is plain data)', async () => {
      const token = await newSession();
      const decoded = decodeWire(JSON.parse(JSON.stringify(estimatePayload(token))));
      const r = await fns.qrEstimate.run(decoded, ctx());
      assert.equal(r.ok, true);
      assert.equal(r.shown, true);
    });
    it('an oversized raw request body is refused up front when the runtime exposes it (bounded cost per request)', async () => {
      const token = await newSession();
      const big = (n) => ctx('198.51.100.7', { rawRequest: { headers: { 'x-forwarded-for': '198.51.100.7' }, rawBody: Buffer.alloc(n) } });
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token), big(300000)), 'invalid-argument', /too large/);
      const r = await fns.qrEstimate.run(estimatePayload(token), big(5000));
      assert.equal(r.ok, true);
    });
  });

  describe('qrSubmit', () => {
    async function readySession(ip) { const t = await newSession(ip); tick(21000); return t; }

    it('happy path: a request is stored, the session is sealed, the receipt is the rounded range only', async () => {
      const token = await readySession();
      const est = await fns.qrEstimate.run(estimatePayload(token), ctx());
      const res = await fns.qrSubmit.run(submitPayload(token, { lastEstimate: { low: est.low, high: est.high, basketHash: est.basketHash } }), ctx());
      assert.deepEqual(Object.keys(res).sort(), ['estimate', 'ok', 'receivedAt', 'refNo', 'submittedOnManila']);
      assert.match(res.refNo, /^QR-261021-[A-HJKMNP-Z2-9]{6}$/);
      assert.equal(res.submittedOnManila, '2026-10-21');
      assert.deepEqual(res.estimate, { low: est.low, high: est.high });
      assert.ok(!/exact|unitPrice|internal|lines/i.test(JSON.stringify(res)));

      const doc = fake.read(`quote_requests/${res.refNo}`);
      assert.ok(doc, 'the request was not stored');
      assert.equal(doc.refNo, res.refNo);
      assert.equal(doc.status, 'new');
      assert.equal(doc.defVersion, QR.VERSION);
      assert.equal(doc.estimateVersion, QR.ESTIMATE.version);
      assert.equal(doc.submittedOnManila, '2026-10-21');
      assert.equal(doc.contact.mobile, '09171234567');
      assert.deepEqual(doc.intake, { need: 'equipment', useFor: 'restaurant_cafe', entityType: 'private', targetDate: '2026-12-01', targetFlexible: false, address: '12 Rizal St, Tandang Sora, Quezon City' });
      assert.equal(doc.items.length, 2);
      assert.deepEqual(doc.items[1], { n: 2, id: P_FIX, name: 'Fake Table', cat: 'prep_washing', unit: 'pc', qty: 2, runs: null, size: { W: 1000, D: 700, H: 850 }, sizeCustom: true, specs: [], note: 'for the kitchen' });
      assert.equal(doc.summary.itemCount, 2);
      assert.equal(doc.summary.estimateShown, true);
      assert.deepEqual([doc.summary.estimateLow, doc.summary.estimateHigh], [est.low, est.high]);
      assert.equal(doc.estimate.shown, true);
      assert.equal(doc.estimateMismatch, false);
      assert.deepEqual(doc.lastEstimate, { low: est.low, high: est.high, basketHash: est.basketHash });
      // the staff-only figures: exact total + per-line list prices, priced AT SUBMIT from the live master
      assert.equal(doc.internal.exactTotal, 7770 + 2 * 4217);
      assert.deepEqual(doc.internal.lines.map((l) => [l.id, l.unitPrice, l.lineTotal, l.priced]), [[P_LEN, 7770, 7770, true], [P_FIX, 4217, 8434, true]]);
      assert.equal(doc.internal.pricingSource, 'firestore:products');
      assert.equal(doc.internal.materialPriceIndexMultiplier, 1);
      assert.equal(doc.consent.agreed, true);
      assert.equal(doc.consent.noticeSha256, Q.privacyNoticeSha256());
      assert.equal(doc.consent.noticeVersion, '2026-10-22.1', 'the consent records the version of the wording it was given against');
      assert.equal(doc.client.ipHash.length, 64);
      assert.equal(doc.client.ip, '198.51.100.7');
      assert.equal(doc.client.fillMs, 91000);
      assert.equal(doc.client.estimateCalls, 1);
      assert.match(doc.fingerprintDay, /^[0-9a-f]{64}\|2026-10-21$/);
      assert.equal(doc.sessionHash, portal.tokenHash(token));
      // the session is sealed
      const sess = fake.read(`qr_sessions/${portal.tokenHash(token)}`);
      assert.ok(sess.submittedAt);
      assert.equal(sess.refNo, res.refNo);
    });
    it('the stored estimate (what the client saw) and the receipt come from a RE-PRICE at submit time, not from anything the page reported', async () => {
      const token = await readySession();
      const res = await fns.qrSubmit.run(submitPayload(token, { lastEstimate: { low: 1, high: 2, basketHash: 'a'.repeat(64) } }), ctx());
      const doc = fake.read(`quote_requests/${res.refNo}`);
      assert.deepEqual([doc.estimate.low, doc.estimate.high], [10000, 20000]);
      assert.equal(doc.estimateMismatch, true);                                       // the client's last view had a different basket hash
      assert.deepEqual(res.estimate, { low: 10000, high: 20000 });
    });
    it('estimateMismatch also compares the client-reported {low, high} with the SERVER\'s range: a hostile page cannot pair the right hash with a made-up figure', async () => {
      const mk = async (lastEstimate, items) => {
        const ip = `10.5.${Math.floor(++counter / 200)}.${(counter % 200) + 1}`;                // submits are limited to 5 / IP / day
        const token = await readySession(ip);
        const est = await fns.qrEstimate.run(estimatePayload(token), ctx(ip));
        const res = await fns.qrSubmit.run(submitPayload(token, { lastEstimate: lastEstimate(est), ...(items ? { items } : {}) }), ctx(ip));
        return fake.read(`quote_requests/${res.refNo}`);
      };
      assert.equal((await mk((e) => ({ low: e.low, high: e.high, basketHash: e.basketHash }))).estimateMismatch, false, 'the honest page');
      assert.equal((await mk((e) => ({ low: 1, high: 2, basketHash: e.basketHash }))).estimateMismatch, true, 'right hash, made-up figure');
      assert.equal((await mk((e) => ({ low: e.low, high: e.high + 5000, basketHash: e.basketHash }))).estimateMismatch, true, 'one step off');
      assert.equal((await mk((e) => ({ low: e.low, high: e.high, basketHash: null }))).estimateMismatch, false, 'a figure with no hash still matches the server range');
      assert.equal((await mk((e) => ({ low: null, high: null, basketHash: e.basketHash }))).estimateMismatch, false, 'a page that showed no figure');
      // a figure for a basket the server would not show one for (gated now) is a mismatch
      const gated = await mk((e) => ({ low: e.low, high: e.high, basketHash: e.basketHash }), [{ id: P_NOD, qty: 1, size: null, runs: null, specs: [], note: '' }]);
      assert.equal(gated.estimateMismatch, true);
    });
    it('no figure shown (gate): the receipt estimate is null, the summary has nulls, the internal total is still recorded for staff', async () => {
      const token = await readySession();
      const res = await fns.qrSubmit.run(submitPayload(token, { items: [{ id: P_NOD, qty: 1, size: null, runs: null, specs: [], note: '' }] }), ctx());
      assert.equal(res.estimate, null);
      const doc = fake.read(`quote_requests/${res.refNo}`);
      assert.equal(doc.estimate.shown, false);
      assert.equal(doc.estimate.reason, 'gate');
      assert.equal(doc.summary.estimateLow, null);
      assert.equal(doc.internal.exactTotal, 1111);
    });
    it('the kill-switch hides the figure from the receipt but staff still get the exact internal total', async () => {
      fake.seed('productMeta/config', { constants: {}, quoteRequest: { estimateEnabled: false } });
      const token = await readySession();
      const res = await fns.qrSubmit.run(submitPayload(token), ctx());
      assert.equal(res.estimate, null);
      const doc = fake.read(`quote_requests/${res.refNo}`);
      assert.equal(doc.estimate.reason, 'disabled');
      assert.equal(doc.internal.exactTotal, 7770 + 2 * 4217);
    });
    it('notifies the Sales department (legacy string AND array field) + the President; drops the partner; never the secretary or other departments', async () => {
      const token = await readySession();
      const res = await fns.qrSubmit.run(submitPayload(token), ctx());
      const uids = fake.paths('notifications/').map((p) => p.split('/')[1]);
      assert.deepEqual([...new Set(uids)].sort(), ['u_pres', 'u_sales1', 'u_sales2']);
      for (const p of fake.paths('notifications/')) {
        const n = fake.read(p);
        assert.deepEqual(Object.keys(n).sort(), ['body', 'createdAt', 'dedupKey', 'icon', 'link', 'read', 'title', 'type'], 'the rules allowlist for a notification doc');
        assert.ok(!('senderUid' in n), 'a system send must not carry senderUid');
        assert.equal(n.type, 'quote_request');
        assert.equal(n.link, 'dept:Sales');
        assert.equal(n.read, false);
        assert.ok(n.title.startsWith('🧾 New quote request — JDC Foods'));
        assert.ok(n.body.includes(res.refNo));
        assert.ok(!/<|16204|16,204|7770|4217/.test(n.title + n.body), 'markup or the exact figure in a notification');
        assert.ok(n.dedupKey.startsWith(`qr_${res.refNo}_`));
      }
      assert.equal(fake.paths('notifications/').length, 3);
    });
    it('a president who is ALSO in no department still gets his copy (an independent role query)', async () => {
      const token = await readySession();
      await fns.qrSubmit.run(submitPayload(token), ctx());
      assert.ok(fake.paths('notifications/u_pres/').length === 1);
    });
    it('a failing recipient lookup never fails the submit (the request is already committed)', async () => {
      const token = await readySession();
      const origCollection = fake.db.collection;
      fake.db.collection = (name) => (name === 'users' ? { where: () => ({ get: async () => { throw new Error('users down'); } }) } : origCollection(name));
      try {
        const res = await fns.qrSubmit.run(submitPayload(token), ctx());
        assert.ok(fake.read(`quote_requests/${res.refNo}`));
      } finally { fake.db.collection = origCollection; }
    });
    it('government intake keeps the procurement note in the stored estimate', async () => {
      const token = await readySession();
      const res = await fns.qrSubmit.run(submitPayload(token, { intake: { need: 'equipment', useFor: 'government', entityType: 'government', targetFlexible: true, targetDate: null, address: 'City Hall, Quezon City' } }), ctx());
      const doc = fake.read(`quote_requests/${res.refNo}`);
      assert.ok(doc.estimate.notes.includes(QR.COPY.governmentNote));
      assert.equal(doc.intake.targetDate, null);
      assert.equal(doc.intake.targetFlexible, true);
    });
    it('BOT: a honeypot or a submit < 20 s after the session was created gets a plausible fake success and writes NOTHING (no doc, no notification)', async () => {
      const t1 = await newSession(); tick(5000);
      const fast = await fns.qrSubmit.run(submitPayload(t1), ctx());
      assert.match(fast.refNo, /^QR-\d{6}-/);
      assert.equal(fake.has(`quote_requests/${fast.refNo}`), false);
      assert.equal(fake.paths('notifications/').length, 0);
      assert.equal(fake.read(`qr_sessions/${portal.tokenHash(t1)}`).submittedAt, null, 'a bot must not seal the session');

      const t2 = await readySession('198.51.100.8');
      const hp = await fns.qrSubmit.run(submitPayload(t2, { honeypot: 'http://spam.example' }), ctx('198.51.100.8'));
      assert.match(hp.refNo, /^QR-/);
      assert.equal(fake.list('quote_requests').length, 0);
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(fake.list('qr_abuse').map((a) => a.data.kind).sort(), ['honeypot', 'too_fast']);
    });
    it('a never-created session token (well-formed) and a session older than 7 days are refused at submit — not crashed on, not accepted', async () => {
      await rejectsWith(fns.qrSubmit.run(submitPayload('Z'.repeat(43)), ctx()), 'failed-precondition', /session expired/);
      const t = await newSession(); tick(7 * 24 * 3600e3 + 1000);
      await rejectsWith(fns.qrSubmit.run(submitPayload(t, { intake: { need: 'equipment', useFor: 'home', entityType: 'private', targetFlexible: true, targetDate: null, address: '12 Rizal St, QC' } }), ctx()), 'failed-precondition', /session expired/);
      assert.equal(fake.list('quote_requests').length, 0);
    });
    it('exactly 20 s after the session was created is an honest submit', async () => {
      const t = await newSession(); tick(20000);
      const res = await fns.qrSubmit.run(submitPayload(t), ctx());
      assert.ok(fake.has(`quote_requests/${res.refNo}`));
    });
    it('DUPLICATE: the same e-mail + mobile on the same Manila day (a new session) is refused with a phone number', async () => {
      const t1 = await readySession();
      const p1 = submitPayload(t1);
      await fns.qrSubmit.run(p1, ctx());
      const t2 = await readySession('198.51.100.9');
      await rejectsWith(fns.qrSubmit.run(submitPayload(t2, { contact: { ...p1.contact, mobile: '+63 917 123 4567' } }), ctx('198.51.100.9')), 'already-exists', /0927 683 6300/);
      assert.equal(fake.list('quote_requests').length, 1);
      tick(24 * 3600e3);                                          // the next Manila day is a different fingerprint
      const t3 = await readySession('198.51.100.10');
      await fns.qrSubmit.run(submitPayload(t3, { contact: { ...p1.contact } }), ctx('198.51.100.10'));
      assert.equal(fake.list('quote_requests').length, 2);
    });
    it('a session can be used ONCE: a second submit on a sealed session is refused', async () => {
      const t = await readySession();
      await fns.qrSubmit.run(submitPayload(t), ctx());
      await rejectsWith(fns.qrSubmit.run(submitPayload(t), ctx()), 'failed-precondition', /session expired/);
      assert.equal(fake.list('quote_requests').length, 1);
    });
    it('consent: missing -> invalid-argument; a stale notice version -> failed-precondition (nothing stored, nothing rate-limited yet)', async () => {
      const t = await readySession();
      await rejectsWith(fns.qrSubmit.run(submitPayload(t, { consent: { agreed: false, noticeVersion: QR.PRIVACY_NOTICE.version } }), ctx()), 'invalid-argument', /consent/);
      await rejectsWith(fns.qrSubmit.run(submitPayload(t, { consent: { agreed: true, noticeVersion: 'old' } }), ctx()), 'failed-precondition', /privacy notice/);
      // the wording that was live until 2026-10-22 (it named the Gmail address) is no longer accepted: the page is asked to show the new one
      await rejectsWith(fns.qrSubmit.run(submitPayload(t, { consent: { agreed: true, noticeVersion: '2026-10-21.1' } }), ctx()), 'failed-precondition', /The privacy notice was updated — please reload and review it again/);
      await rejectsWith(fns.qrSubmit.run(submitPayload(t, { consent: undefined }), ctx()), 'invalid-argument');
      assert.equal(fake.list('quote_requests').length, 0);
    });
    it('field validation is the server\'s: a bad mobile, e-mail, date, intake and an unknown key are refused with the message', async () => {
      const t = await readySession();
      const ok = submitPayload(t);
      await rejectsWith(fns.qrSubmit.run({ ...ok, contact: { ...ok.contact, mobile: '12345' } }, ctx()), 'invalid-argument', /mobile/i);
      await rejectsWith(fns.qrSubmit.run({ ...ok, contact: { ...ok.contact, email: 'nope' } }, ctx()), 'invalid-argument', /e-mail/i);
      await rejectsWith(fns.qrSubmit.run({ ...ok, intake: { ...ok.intake, targetDate: '2020-01-01' } }, ctx()), 'invalid-argument', /past/);
      await rejectsWith(fns.qrSubmit.run({ ...ok, intake: { ...ok.intake, need: 'bogus' } }, ctx()), 'invalid-argument');
      await rejectsWith(fns.qrSubmit.run({ ...ok, intake: { ...ok.intake, role: 'admin' } }, ctx()), 'invalid-argument', /Unknown field/);
      await new Promise((r) => setImmediate(r));
      assert.ok(fake.list('qr_abuse').some((a) => a.data.kind === 'bad_payload'));
      assert.equal(fake.list('quote_requests').length, 0);
    });
    it('items: an unpublished or unknown product, a stored price, family/config are refused; the session is NOT burned', async () => {
      const t = await readySession();
      for (const it of [{ id: 'EX-001', qty: 1 }, { id: 'nope', qty: 1 }, { id: P_FIX, qty: 1, unitPrice: 5 }, { id: P_FIX, qty: 1, family: 'x' }]) {
        await assert.rejects(fns.qrSubmit.run(submitPayload(t, { items: [it] }), ctx()), (e) => e.code === 'invalid-argument');
      }
      assert.equal(fake.read(`qr_sessions/${portal.tokenHash(t)}`).submittedAt, null);
      assert.equal(fake.list('quote_requests').length, 0);
      const res = await fns.qrSubmit.run(submitPayload(t), ctx());
      assert.ok(fake.has(`quote_requests/${res.refNo}`));
    });
    it('an oversized payload (> 60 KB) and a missing token are refused before anything else', async () => {
      const t = await readySession();
      await rejectsWith(fns.qrSubmit.run(submitPayload(t, { pad: 'x'.repeat(61000) }), ctx()), 'invalid-argument', /too large/);
      await rejectsWith(fns.qrSubmit.run(submitPayload('x'), ctx()), 'unauthenticated');
      await rejectsWith(fns.qrSubmit.run(submitPayload(t, { defVersion: 5 }), ctx()), 'failed-precondition');
    });
    it('rate limit: 5 submits / day / IP — the 6th from the same address is denied', async () => {
      for (let i = 0; i < 5; i++) { const t = await readySession(`203.0.113.${100 + i}`); await fns.qrSubmit.run(submitPayload(t), ctx('203.0.113.99')); }
      const t6 = await readySession('203.0.113.120');
      await rejectsWith(fns.qrSubmit.run(submitPayload(t6), ctx('203.0.113.99')), 'resource-exhausted', /minute/);
      const t7 = await readySession('203.0.113.121');
      const ok = await fns.qrSubmit.run(submitPayload(t7), ctx('203.0.113.130'));
      assert.ok(fake.has(`quote_requests/${ok.refNo}`));
    });
    it('two parallel submits on ONE session create exactly one request (the loser re-reads the sealed session inside its transaction)', async () => {
      const t = await readySession();
      const results = await Promise.allSettled([
        fns.qrSubmit.run(submitPayload(t), ctx('198.51.100.20')),
        fns.qrSubmit.run(submitPayload(t), ctx('198.51.100.21')),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(results.map((r) => r.status)));
      const lost = results.find((r) => r.status === 'rejected');
      assert.equal(lost.reason.code, 'failed-precondition');
      assert.equal(fake.list('quote_requests').length, 1);
      assert.ok(fake.stats.txRetries >= 1, 'the fake did not exercise a transaction retry');
    });
    it('a transaction that cannot create the request leaves the session UNSEALED (a retry is possible), and says so', async () => {
      const t = await readySession();
      const origRun = fake.db.runTransaction;
      // fail ONLY the transaction that creates the request (the rate-limit transaction must keep working)
      fake.db.runTransaction = (fn) => origRun((tx) => fn(Object.assign(Object.create(tx), {
        create: (ref, data) => { if (ref.path.startsWith('quote_requests/')) throw new Error('commit failed'); return tx.create(ref, data); },
      })));
      try { await rejectsWith(fns.qrSubmit.run(submitPayload(t), ctx()), 'internal', /Could not record/); }
      finally { fake.db.runTransaction = origRun; }
      assert.equal(fake.read(`qr_sessions/${portal.tokenHash(t)}`).submittedAt, null);
      assert.equal(fake.list('quote_requests').length, 0);
      const res = await fns.qrSubmit.run(submitPayload(t), ctx());
      assert.ok(fake.has(`quote_requests/${res.refNo}`));
    });
    it('the rate limiter FAILS CLOSED: if its transaction errors, nothing proceeds (unavailable) and nothing is written', async () => {
      const t = await readySession();
      const origRun = fake.db.runTransaction;
      fake.db.runTransaction = async () => { throw new Error('firestore down'); };
      try {
        await rejectsWith(fns.qrSubmit.run(submitPayload(t), ctx()), 'unavailable');
        await rejectsWith(fns.qrEstimate.run(estimatePayload(t), ctx()), 'unavailable');
        await rejectsWith(fns.qrStartSession.run({ defVersion: QR.VERSION }, ctx()), 'unavailable');
      } finally { fake.db.runTransaction = origRun; }
      assert.equal(fake.list('quote_requests').length, 0);
      assert.equal(fake.paths('notifications/').length, 0);
    });
  });

  describe('qrAdminDelete', () => {
    async function seedRequest() {
      const token = await newSession(); tick(21000);
      const res = await fns.qrSubmit.run(submitPayload(token), ctx());
      fake.seed(`quote_requests/${res.refNo}/notes/n1`, { text: 'called', authorUid: 'u_sales1', authorName: 'S', at: new FakeTimestamp(T0) });
      fake.seed(`quote_requests/${res.refNo}/notes/n2`, { text: 'quoted', authorUid: 'u_sales1', authorName: 'S', at: new FakeTimestamp(T0) });
      return res.refNo;
    }
    it('requires sign-in', async () => {
      await rejectsWith(fns.qrAdminDelete.run({ refNo: 'QR-261021-ABCDEF' }, {}), 'unauthenticated');
    });
    it('only a president or manager (read from users/{uid}.role): a Sales employee, the secretary and a forged claim are denied', async () => {
      const ref = await seedRequest();
      for (const uid of ['u_sales1', 'u_sec', 'u_partner', 'u_it', 'nobody']) await rejectsWith(fns.qrAdminDelete.run({ refNo: ref }, { auth: { uid } }), 'permission-denied');
      await rejectsWith(fns.qrAdminDelete.run({ refNo: ref }, { auth: { uid: 'u_sales1', token: { role: 'president' } } }), 'permission-denied');
      assert.ok(fake.has(`quote_requests/${ref}`));
    });
    it('a president or manager deletes the request, its notes, and leaves an audit entry with no PII beyond the company', async () => {
      const ref = await seedRequest();
      assert.deepEqual(await fns.qrAdminDelete.run({ refNo: ref }, { auth: { uid: 'u_pres' } }), { ok: true });
      assert.equal(fake.has(`quote_requests/${ref}`), false);
      assert.deepEqual(fake.paths(`quote_requests/${ref}/`), []);
      const audit = fake.list('audit_log');
      assert.equal(audit.length, 1);
      const a = audit[0].data;
      assert.deepEqual([a.action, a.entity, a.entityId, a.actorUid, a.actorRole], ['delete', 'quote_request', ref, 'u_pres', 'president']);
      assert.deepEqual(a.details, { company: 'JDC Foods', items: 2 });
      assert.ok(!/juan|0917|Rizal/i.test(JSON.stringify(a)));
      const ref2 = await seedRequest();
      assert.deepEqual(await fns.qrAdminDelete.run({ refNo: ref2 }, { auth: { uid: 'u_mgr' } }), { ok: true });
    });
    it('is idempotent and validates the reference', async () => {
      assert.deepEqual(await fns.qrAdminDelete.run({ refNo: 'QR-261021-ABCDEF' }, { auth: { uid: 'u_pres' } }), { ok: true });
      for (const bad of ['', 'QR-261021-ABCD0F', 'CIR-261021-ABCDEF', '../x', 'QR-261021-ABCDEFG', undefined, 5]) await rejectsWith(fns.qrAdminDelete.run({ refNo: bad }, { auth: { uid: 'u_pres' } }), 'invalid-argument');
    });
  });

  describe('Client Information Request notifications still behave (resolveSalesAndPresidentUids was extracted from cirNotifyStaff)', () => {
    it('cirSubmit notifies Sales (both department fields) + the President, drops the partner, dedupes — byte-identical recipients and shape', async () => {
      const token = 'B'.repeat(43);
      fake.seed(`cir_drafts/${portal.tokenHash(token)}`, { formId: 'commissary_brief', formVersion: 1, createdAt: new FakeTimestamp(T0 - 60000), ipHash: 'x', uaHash: 'y', photoCount: 0, bytesTotal: 0, photos: {}, submittedAt: null, refNo: null });
      const res = await fns.cirSubmit.run({
        draftToken: token, formId: 'commissary_brief', formVersion: CIR.FORMS.commissary_brief.formVersion,
        answers: { name: 'Pat Client', company: 'Acme Foods', phone: '09171234567', email: 'pat@example.com', address: 'Somewhere 1', site_address: 'Site 2' },
        photos: [], consent: { agreed: true, noticeVersion: CIR.PRIVACY_NOTICE.version }, honeypot: '', fillMs: 120000,
      }, ctx('198.51.100.40'));
      assert.match(res.refNo, /^CIR-261021-/);
      const uids = fake.paths('notifications/').map((p) => p.split('/')[1]);
      assert.deepEqual([...new Set(uids)].sort(), ['u_pres', 'u_sales1', 'u_sales2']);
      const n = fake.read(fake.paths('notifications/u_pres/')[0]);
      assert.equal(n.type, 'client_info_request');
      assert.equal(n.link, 'dept:Sales');
      assert.ok(n.dedupKey.startsWith(`cir_${res.refNo}_`));
      assert.ok(!('senderUid' in n));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIGURABLE FAMILIES (owner ruling 2026-10-21) through the REAL callables, against the in-memory Firestore.
//  A configured line { familyId, config, dims, qty, note } is validated STRICTLY, priced from the family's primary SKU + the PRIVATE sheet
//  product_pricing/{family} (Admin read, same cache), and "priced after review" (left out of the figure, counted) when the sheet is not
//  approved, was approved against another schema, is absent, or has a BLANK cell for an option that was chosen. FAKE, deliberately odd
//  figures (so a leak into a response or a notification cannot hide behind a round number).
// ═══════════════════════════════════════════════════════════════════════════
describe('qr callables — the configurable product families', { skip: SKIP }, () => {
  const FAMS = require('../functions/qr-families.js');
  const PFX = require('../functions/product-families.js');
  const seedFamilies = () => {
    const base = (data) => ({ unit: 'pc', formula: {}, specs: [], measurement: {}, ...data });
    fake.seed('products/PW-001', base({ title: 'SS Preparation Table (1 Layer)', category: 'prep_washing', basePrice: 10007, formulaType: 'per_length', measurement: { W: 900, D: 600, H: 850 }, formula: { baseLengthMm: 900, pricePerExtraMm: 10, rateD100: 500, rateH100: 500 } }));
    fake.seed('products/PW-004', base({ title: 'SS Wash Sink (Single)', category: 'prep_washing', basePrice: 20011, formulaType: 'per_length', measurement: { W: 500, D: 500, H: 850 }, formula: { baseLengthMm: 500, pricePerExtraMm: 12, rateD100: 400, rateH100: 0 } }));
    fake.seed('products/CE-001', base({ title: 'SS Open Top Stove (1 Burner)', category: 'cooking_line', basePrice: 18013, formulaType: 'per_length', measurement: { W: 600, D: 700, H: 850 }, formula: { baseLengthMm: 600, pricePerExtraMm: 8, rateD100: 600, rateH100: 0 } }));
    fake.seed('products/PW-015', base({ title: 'SS Storage Cabinet', category: 'prep_washing', basePrice: 40019, formulaType: 'per_length', measurement: { W: 600, D: 500, H: 1800 }, formula: { baseLengthMm: 600, pricePerExtraMm: 15, rateD100: 500, rateH100: 300 } }));
    fake.seed('products/PW-023', base({ title: 'SS Wall Shelf', category: 'prep_washing', basePrice: 14503, formulaType: 'fixed', measurement: { W: 2908, D: 480, H: 38 } }));
    fake.seed('products/PW-010', base({ title: 'SS Dish Rack', category: 'prep_washing', basePrice: 16703, formulaType: 'per_length', measurement: { W: 600, D: 500, H: 1600 }, formula: { baseLengthMm: 600, pricePerExtraMm: 8, rateD100: 400, rateH100: 300 } }));
    const c = (flat, perW100) => ({ flat, perW100: perW100 == null ? null : perW100 });
    fake.seed('product_pricing/prep_table', { familyId: 'prep_table', schemaVersion: FAMS.version, approved: true, approvedBy: 'u_pres', options: { layers: { 2: c(8111, 101), 3: c(16231, 207) }, upper: { 1: c(3077, null), 2: c(null, null) } }, size: { perW100: null } });
    fake.seed('product_pricing/sink', { familyId: 'sink', schemaVersion: FAMS.version, approved: true, approvedBy: 'u_pres', options: { basins: { 2: c(6173, null), 3: c(null, null), 4: c(null, null) }, alignment: { left: c(0, null), right: c(0, null) }, undershelf: { true: c(2503, null) }, upper: { true: c(3011, null) }, faucet: { prerinse: c(4519, null) } }, size: { perW100: null } });
    fake.seed('product_pricing/stove', { familyId: 'stove', schemaVersion: FAMS.version, approved: true, approvedBy: 'u_pres', options: { positions: { wok: c(29111, null), hp_small: c(null, null), hp_large: c(37123, null), lp_small: c(16057, null), lp_large: c(null, null), soup: c(null, null) }, addons: { griller: c(null, null), griddle: c(15091, null), oven: c(22093, null), fryer: c(null, null) } }, size: { perW100: null } });
    fake.seed('product_pricing/cabinet', { familyId: 'cabinet', schemaVersion: FAMS.version, approved: false, options: { type: { wall: c(5003, null) }, doors: { sliding: c(2003, null) }, shelves: { 1: c(-3001, null), 2: c(-1501, null) } }, size: { perW100: null } });
    fake.seed('product_pricing/rack', { familyId: 'rack', schemaVersion: 99, approved: true, approvedBy: 'u_pres', options: { tiers: { 3: c(-1009, null), 5: c(1009, null), 6: c(2009, null) }, wheels: { false: c(-907, null) } }, size: { perW100: null } });
    // wall_shelf: NO sheet at all
  };
  beforeEach(() => {
    mock.timers.enable({ apis: ['Date'], now: T0 });
    fake.reset();
    seedMaster();
    seedUsers();
    seedFamilies();
    counter = 0;
    fns = loadFunctions();
  });
  afterEach(() => { mock.timers.reset(); });

  const sinkCfg = (over) => ({ basins: 2, alignment: 'center', undershelf: false, upper: false, faucet: 'prerinse', ...(over || {}) });
  const famLine = (familyId, config, dims, qty, note) => ({ familyId, config, dims: dims || {}, qty: qty || 1, ...(note ? { note } : {}) });
  const fixedLine = () => ({ id: P_FIX, qty: 1, size: null, runs: null, specs: [], note: '' });
  const estimate = async (items, over) => { const token = await newSession(); return fns.qrEstimate.run(estimatePayload(token, { items, ...(over || {}) }), ctx()); };
  const readyToken = async () => { const t = await newSession(); tick(21000); return t; };
  const submit = async (items) => { const token = await readyToken(); const res = await fns.qrSubmit.run(submitPayload(token, { items }), ctx()); return { res, doc: fake.read(`quote_requests/${res.refNo}`) }; };

  it('the six families the server knows ARE the ones the page ships (same generated file), and every primary is seeded as a loadable, non-quotable product', () => {
    assert.deepEqual(FAMS.order, ['prep_table', 'sink', 'stove', 'cabinet', 'wall_shelf', 'rack']);
    for (const f of FAMS.order) assert.ok(!ALLOW.ids.includes(FAMS.families[f].primary), `${f}'s primary must not be quotable as a plain line`);
  });

  describe('estimates', () => {
    it('a CONFIGURED SINK (2 sinks, pre-rinse, 1000 mm) + a fixed item: priced from the primary + the sheet, shown as the rounded range', async () => {
      const r = await estimate([famLine('sink', sinkCfg(), { W: 1000, D: 500, H: 850 }), fixedLine()]);
      // exact = PW-004 at 1000 mm (20,011 + 500 x 12) + 6,173 + 4,519 = 36,703; + the fixed item 4,217 = 40,920 -> 0.90 / 1.15 -> 35,000 .. 50,000
      assert.equal(r.shown, true);
      assert.deepEqual([r.low, r.high, r.step], [35000, 50000, 5000]);
      assert.equal(r.pricedCount, 2);
      assert.equal(r.reviewCount, 0);
      assert.equal(r.customSizeCount, 0, '1000 mm IS the usual length for two sinks: not a custom size');
      assert.deepEqual(Object.keys(r).sort(), RESPONSE_KEYS, 'the response key set is exactly the spec\'s');
      const longer = await estimate([famLine('sink', sinkCfg(), { W: 1200, D: 500, H: 850 }), fixedLine()]);
      assert.equal(longer.customSizeCount, 1, '1200 mm for two sinks IS custom');
      const tall = await estimate([famLine('sink', sinkCfg(), { W: 1000, D: 500, H: 900 }), fixedLine()]);
      assert.equal(tall.customSizeCount, 1, 'a different height is custom');
    });
    it('a CONFIGURED STOVE (wok + HP large + LP small, 1400 mm): the default position nets out, so only the wok and the HP burner are added', async () => {
      const r = await estimate([famLine('stove', { positions: ['wok', 'hp_large', 'lp_small'], addons: [] }, { W: 1400, D: 700, H: 850 })]);
      // CE-001 at 1400 mm: 18,013 + 800 x 8 = 24,413; + wok 29,111 + HP large 37,123 = 90,647 -> shown on its own (>= 50,000)
      assert.equal(r.shown, true);
      assert.deepEqual([r.low, r.high], [80000, 105000]);                                  // 0.90 x = 81,582 -> 80,000 · 1.15 x = 104,244 -> 105,000
      assert.equal(r.pricedCount, 1);
    });
    it('a CONFIGURED PREPARATION TABLE (3 layers, 1 upper shelf, 1800 mm): the layer amount scales with the length beyond the standard', async () => {
      const r = await estimate([famLine('prep_table', { layers: 3, upper: 1 }, { W: 1800, D: 600, H: 850 }), fixedLine()]);
      // PW-001 at 1800: 10,007 + 900 x 10 = 19,007; layers 3: 16,231 + 207 x 9 = 18,094; upper 1: 3,077 -> 40,178; + 4,217 = 44,395 -> 35,000 .. 55,000
      assert.deepEqual([r.low, r.high], [35000, 55000]);
      assert.equal(r.pricedCount, 2);
    });
    it('the default configuration at the default size prices as the primary SKU alone (no sheet figure is added)', async () => {
      const r = await estimate([famLine('prep_table', { layers: 1, upper: 0 }, { W: 900, D: 600, H: 850 }, 5)]);
      // 5 x 10,007 = 50,035 -> shown (>= 50,000): 45,000 .. 60,000
      assert.equal(r.shown, true);
      assert.deepEqual([r.low, r.high], [45000, 60000]);
    });
    it('an UNAPPROVED family is "priced after review": the line is left out of the figure and counted, and a fixed item still estimates', async () => {
      const r = await estimate([famLine('cabinet', { type: 'floor', doors: 'swing', shelves: 3 }, {}), fixedLine(), { id: P_LEN, qty: 1, size: null, runs: null, specs: [], note: '' }]);
      assert.equal(r.pricedCount, 2);                                                       // the two fixed items
      assert.equal(r.reviewCount, 1);                                                       // the cabinet
      assert.ok(r.notes.includes(QR.COPY.reviewCount(1)));
      assert.equal(r.shown, true);
      assert.deepEqual([r.low, r.high], [10000, 15000]);                                    // 7,770 + 4,217 = 11,987 -> 0.90 x = 10,788 -> 10,000 · 1.15 x = 13,785 -> 15,000
    });
    it('a family whose sheet was approved against ANOTHER schema version, and a family with NO sheet, are priced after review too', async () => {
      const r = await estimate([famLine('rack', { tiers: 4, wheels: true }, {}), famLine('wall_shelf', { tiers: 1, surface: 'solid' }, {}), fixedLine(), famLine('prep_table', { layers: 1, upper: 0 }, {}, 3)]);
      assert.equal(r.reviewCount, 2);
      assert.equal(r.pricedCount, 2);
    });
    it('a BLANK cell for a chosen option unprices the whole line (no partial figure); the other options of the same family still price', async () => {
      const blank = await estimate([famLine('sink', sinkCfg({ basins: 3 }), { W: 1500, D: 500, H: 850 }), fixedLine()]);
      assert.equal(blank.reviewCount, 1);                                                   // 3 sinks: the cell is blank
      assert.equal(blank.pricedCount, 1);
      const fine = await estimate([famLine('sink', sinkCfg({ basins: 2 }), { W: 1000, D: 500, H: 850 }), fixedLine()]);
      assert.equal(fine.reviewCount, 0);
      const noWok = await estimate([famLine('stove', { positions: ['soup', 'lp_small'], addons: [] }, { W: 1000, D: 700, H: 850 }), fixedLine()]);
      assert.equal(noWok.reviewCount, 1, 'the soup burner has no amount yet');
    });
    it('a blank cell is NEVER read as zero: the estimate with the blank option is not the estimate of the same basket without it', async () => {
      const a = await estimate([famLine('sink', sinkCfg({ basins: 3 }), { W: 1500, D: 500, H: 850 }), { id: P_LEN, qty: 5, size: null, runs: null, specs: [], note: '' }]);
      const b = await estimate([{ id: P_LEN, qty: 5, size: null, runs: null, specs: [], note: '' }, fixedLine()]);
      assert.equal(a.pricedCount, 1);
      assert.equal(a.reviewCount, 1);
      assert.equal(b.reviewCount, 0);
    });
    it('NO sheet figure and no per-line price reaches any response: no cell amount, no base, no delta, no missing-option name', async () => {
      const token = await newSession();
      const r = await fns.qrEstimate.run(estimatePayload(token, { items: [famLine('sink', sinkCfg(), { W: 1000, D: 500, H: 850 }), famLine('stove', { positions: ['soup'], addons: [] }, {}), fixedLine()] }), ctx());
      const json = JSON.stringify(r);
      assert.ok(!/exact|unitPrice|lineTotal|basePrice|priceAdder|formula|lines|deltas|missing|perW100|flat|base/i.test(json), json);
      const nums = new Set();
      JSON.stringify(r, (k, v) => { if (typeof v === 'number') nums.add(v); return v; });
      for (const secret of [6173, 4519, 36703, 26011, 20011, 29111, 37123, 16057, 4217, 40920]) assert.ok(!nums.has(secret), `${secret} leaked`);
      assert.ok(!/Pre-rinse|soup|Soup|Burner/i.test(json), 'an option name leaked');
    });
    it('government intake: the same estimate plus the procurement note (families change nothing there)', async () => {
      const token = await newSession();
      const items = [famLine('sink', sinkCfg(), { W: 1000, D: 500, H: 850 }), fixedLine()];
      const priv = await fns.qrEstimate.run(estimatePayload(token, { items }), ctx());
      const gov = await fns.qrEstimate.run(estimatePayload(token, { items, entityType: 'government' }), ctx());
      assert.deepEqual([gov.low, gov.high], [priv.low, priv.high]);
      assert.ok(gov.notes.includes(QR.COPY.governmentNote));
    });
    it('the sheet is read ONCE per cache window with the products; approving a family is picked up after the 10-minute TTL (never sooner, never stale beyond it)', async () => {
      const items = [famLine('cabinet', { type: 'floor', doors: 'swing', shelves: 3 }, { W: 600, D: 500, H: 1800 }, 2)];
      const token = await newSession();
      const before = await fns.qrEstimate.run(estimatePayload(token, { items }), ctx());
      assert.equal(before.shown, false);                                                    // unpriced: 0 priced lines -> the gate
      assert.equal(before.reviewCount, 1);
      fake.seed('product_pricing/cabinet', { ...fake.read('product_pricing/cabinet'), approved: true, approvedBy: 'u_pres' });
      assert.equal((await fns.qrEstimate.run(estimatePayload(token, { items }), ctx())).reviewCount, 1, 'still cached');
      tick(600001);
      const after = await fns.qrEstimate.run(estimatePayload(token, { items }), ctx());
      assert.equal(after.reviewCount, 0);
      assert.equal(after.pricedCount, 1);                                                   // 2 x 40,019 = 80,038 -> shown
      assert.equal(after.shown, true);
    });
    it('if the sheets cannot be read, every family line is priced after review — and the fixed items still estimate (the safe direction)', async () => {
      const orig = fake.db.collection;
      fake.db.collection = (name) => (name === 'product_pricing' ? { doc: () => ({ get: async () => { throw new Error('pricing down'); } }), limit: () => ({ get: async () => { throw new Error('pricing down'); } }) } : orig(name));
      try {
        const r = await estimate([famLine('sink', sinkCfg(), { W: 1000, D: 500, H: 850 }), fixedLine(), { id: P_LEN, qty: 1, size: null, runs: null, specs: [], note: '' }]);
        assert.equal(r.reviewCount, 1);
        assert.equal(r.pricedCount, 2);
        assert.equal(r.shown, true);
      } finally { fake.db.collection = orig; }
    });
    it('ONE unreadable sheet only unprices ITS family (each sheet is its own read); the others keep pricing', async () => {
      const orig = fake.db.collection;
      fake.db.collection = (name) => {
        if (name !== 'product_pricing') return orig(name);
        const c = orig(name);
        return { doc: (id) => (id === 'sink' ? { get: async () => { throw new Error('one doc down'); } } : c.doc(id)), limit: c.limit };
      };
      try {
        const r = await estimate([famLine('sink', sinkCfg(), { W: 1000, D: 500, H: 850 }), famLine('stove', { positions: ['wok'], addons: [] }, { W: 1000, D: 700, H: 850 }), fixedLine()]);
        assert.equal(r.reviewCount, 1, 'only the sink');
        assert.equal(r.pricedCount, 2, 'the stove and the fixed item');
      } finally { fake.db.collection = orig; }
    });
    it('STRAY documents in product_pricing can never crowd a real sheet out: the sheets are read BY ID, not by a collection scan', async () => {
      for (let i = 0; i < 80; i++) fake.seed(`product_pricing/aaa_junk_${String(i).padStart(3, '0')}`, { approved: true, approvedBy: 'u_pres', junk: i, options: {} });
      const r = await estimate([famLine('sink', sinkCfg(), { W: 1000, D: 500, H: 850 }), fixedLine()]);
      assert.equal(r.reviewCount, 0);
      assert.equal(r.pricedCount, 2);
    });
    it('a refresh that FAILS keeps serving the cached PRODUCT LIST but never the cached option SHEETS: a sheet un-approved meanwhile must not keep pricing (fails closed), and the fixed items still estimate', async () => {
      const items = [famLine('stove', { positions: ['wok'], addons: [] }, { W: 1400, D: 700, H: 850 }), fixedLine()];
      const token = await newSession();
      const before = await fns.qrEstimate.run(estimatePayload(token, { items }), ctx());
      assert.deepEqual([before.pricedCount, before.reviewCount], [2, 0], 'priced while the sheet is approved');
      fake.seed('product_pricing/stove', { ...fake.read('product_pricing/stove'), approved: false, approvedBy: null });       // someone un-approves it
      const orig = fake.db.collection;
      fake.db.collection = (name) => (name === 'products' ? { limit: () => ({ get: async () => { throw new Error('boom'); } }) } : orig(name));
      try {
        tick(11 * 60 * 1000);                                                                                            // stale: the cached products cover the failed refresh
        const during = await fns.qrEstimate.run(estimatePayload(token, { items }), ctx());
        assert.deepEqual([during.pricedCount, during.reviewCount], [1, 1], 'the stove is left out: the cached sheets are NOT served');
        tick(8 * 3600e3);                                                                                                // still within 24 h, still failing: still withheld
        const later = await fns.qrEstimate.run(estimatePayload(token, { items }), ctx());
        assert.deepEqual([later.pricedCount, later.reviewCount], [1, 1]);
      } finally { fake.db.collection = orig; }
    });
    it('a SOFT width rule (the stove) never prices a body shorter than its burners need: six woks asked at 600 mm are priced at the usual length and the staff line says so', async () => {
      const six = { positions: ['wok', 'wok', 'wok', 'wok', 'wok', 'wok'], addons: [] };
      const asked = await submit([famLine('stove', six, { W: 600, D: 700, H: 850 })]);
      const usual = await submit([famLine('stove', six, { W: 1600, D: 700, H: 850 })]);
      const a = asked.doc.internal.lines[0], u = usual.doc.internal.lines[0];
      // CE-001 at 1600 mm (400 + 6 x 200): 18,013 + 1,000 x 8 = 26,013; six woks (+6 x 29,111) minus the standard LP burner (16,057) = 184,622
      assert.equal(a.priced, true);
      assert.equal(a.unitPrice, 26013 + 6 * 29111 - 16057);
      assert.equal(a.unitPrice, u.unitPrice, 'the same figure as the usual length');
      assert.ok(a.warnings.length === 1 && /Asked for 600 mm; priced at the usual 1600 mm length for these burners/.test(a.warnings[0]), JSON.stringify(a.warnings));
      assert.deepEqual(u.warnings, [], 'no warning when the length is already the usual one');
      assert.equal(asked.doc.items[0].size.W, 600, 'the visitor\'s request is stored as asked');
    });
    it('a custom width or height the primary has NO RATE for makes the configured line priced after review (it is never priced as if the size were free)', async () => {
      const prep = fake.read('products/PW-001');
      fake.seed('products/PW-001', { ...prep, formula: { baseLengthMm: 900, pricePerExtraMm: 10 } });                        // the width / height rates are gone
      const r = await estimate([famLine('prep_table', { layers: 1, upper: 0 }, { W: 900, D: 700, H: 850 }), fixedLine()]);
      assert.equal(r.reviewCount, 1);
      const std = await estimate([famLine('prep_table', { layers: 1, upper: 0 }, { W: 900, D: 600, H: 850 }, 5)]);
      assert.equal(std.reviewCount, 0, 'the standard size needs no rate');
    });
    it('a wall-shelf depth other than the standard has no price in the sheet, so it is priced after review; the standard depth and any length are priced', async () => {
      fake.seed('product_pricing/wall_shelf', { familyId: 'wall_shelf', schemaVersion: FAMS.version, approved: true, approvedBy: 'u_pres', options: { tiers: { 2: { flat: 3001, perW100: null }, 3: { flat: 6007, perW100: null } }, surface: { slotted: { flat: 1009, perW100: null } } }, size: { perW100: 479 } });
      const fine = await estimate([famLine('wall_shelf', { tiers: 2, surface: 'solid' }, { W: 1800, D: 450 }, 4), fixedLine()]);
      assert.equal(fine.reviewCount, 0);
      const deeper = await estimate([famLine('wall_shelf', { tiers: 2, surface: 'solid' }, { W: 1800, D: 600 }, 4), fixedLine()]);
      assert.equal(deeper.reviewCount, 1, 'depth is not priced by the sheet');
    });
    it('FIXED items still estimate exactly as before (the plain-line path is unchanged): two priced products -> the same range as the pre-family test', async () => {
      const r = await estimate([{ id: P_LEN, qty: 1, size: null, runs: null, specs: [], note: '' }, { id: P_FIX, qty: 2, size: { W: 1000 }, runs: null, specs: [], note: '' }]);
      assert.deepEqual([r.low, r.high, r.step], [10000, 20000, 5000]);
      assert.equal(r.pricedCount, 2);
    });
  });

  describe('INVALID configurations are rejected (strict allowlist; nothing unknown is ignored)', () => {
    const bad = async (item, re) => {
      const token = await newSession();
      await assert.rejects(fns.qrEstimate.run(estimatePayload(token, { items: [fixedLine(), item] }), ctx()), (e) => { assert.equal(e.code, 'invalid-argument', e.message); if (re) assert.match(e.message, re); return true; });
    };
    it('an unknown family id collapses to the SAME message an unknown product gets, and names the id so the page can remove the line', async () => {
      const token = await newSession();
      await assert.rejects(fns.qrEstimate.run(estimatePayload(token, { items: [fixedLine(), famLine('toaster', {}, {})] }), ctx()), (e) => { assert.equal(e.message, Q.GONE_MSG); assert.deepEqual(e.details, { itemIds: ['toaster'] }); return true; });
      for (const fid of ['__proto__', 'constructor', 'hasOwnProperty', '', 'SINK', 'sink ']) await bad(famLine(fid, {}, {}), /no longer in the catalogue/);
    });
    it('an unknown option key, an unknown option value, a wrong type, a missing config: all refused with a clear message', async () => {
      await bad(famLine('sink', { ...sinkCfg(), wheels: true }, {}), /not an option of this product/);
      await bad(famLine('sink', sinkCfg({ faucet: 'bidet' }), {}), /Choose one of the available options for "Faucet"/);
      await bad(famLine('sink', sinkCfg({ basins: '2' }), {}), /Choose one of the available options for "Sinks"/);
      await bad(famLine('sink', sinkCfg({ undershelf: 'true' }), {}), /Undershelf/);
      await bad(famLine('sink', sinkCfg({ basins: 9 }), {}), /Sinks/);
      await bad({ familyId: 'sink', dims: {}, qty: 1 }, /must be a set of choices/);
      await bad({ familyId: 'sink', config: 'x', dims: {}, qty: 1 }, /must be a set of choices/);
      await bad({ familyId: 'sink', config: [], dims: {}, qty: 1 }, /must be a set of choices/);
      await bad(famLine('stove', { positions: [], addons: [] }, {}), /Burner positions/);
      await bad(famLine('stove', { positions: Array(7).fill('wok'), addons: [] }, {}), /Burner positions/);
      await bad(famLine('stove', { positions: ['wok', 'laser'], addons: [] }, {}), /Burner positions/);
      await bad(famLine('stove', { positions: ['wok'], addons: ['oven', 'oven'] }, {}), /Add-ons/);
    });
    it('sizes: out of range, off the step, not a number, an axis the family does not have, the sink\'s hard length rule, the oven\'s minimums', async () => {
      await bad(famLine('sink', sinkCfg(), { W: 99999 }), /Length must be a whole number/);
      await bad(famLine('sink', sinkCfg(), { W: 1005 }), /Length must be a whole number/);
      await bad(famLine('sink', sinkCfg(), { W: 'wide' }), /Length must be a whole number/);
      await bad(famLine('sink', sinkCfg(), { W: 1000, Q: 5 }), /no "Q" size/);
      await bad(famLine('wall_shelf', { tiers: 1, surface: 'solid' }, { H: 38 }), /no "H" size/);
      await bad(famLine('sink', sinkCfg({ basins: 2 }), { W: 900, D: 500, H: 850 }), /at least 1000 mm for these sinks/);
      await bad(famLine('stove', { positions: ['wok'], addons: ['oven'] }, { W: 1000, D: 600, H: 850 }), /width must be at least 700 mm/);
      await bad({ familyId: 'sink', config: sinkCfg(), dims: 7, qty: 1 }, /length \/ width \/ height/);
    });
    it('a line is EITHER a product OR a family: id with familyId, size with dims, specs on a family line, unknown keys, a stored price — all refused', async () => {
      await bad({ id: P_FIX, familyId: 'sink', config: sinkCfg(), qty: 1 }, /unknown field "id"/);
      await bad({ familyId: 'sink', config: sinkCfg(), size: { W: 1000 }, qty: 1 }, /unknown field "size"/);
      await bad({ familyId: 'sink', config: sinkCfg(), specs: [], qty: 1 }, /unknown field "specs"/);
      await bad({ familyId: 'sink', config: sinkCfg(), unitPrice: 5, qty: 1 }, /unknown field "unitPrice"/);
      await bad({ familyId: 'sink', config: sinkCfg(), name: 'Free sink', qty: 1 }, /unknown field "name"/);
      await bad({ familyId: 'sink', config: sinkCfg(), dims: {}, qty: 1, family: 'x' }, /unknown field/);
      await bad({ id: P_FIX, qty: 1, family: 'sink', config: sinkCfg() }, /unknown field/);
    });
    it('quantity and note: 1..20 whole units, a note of at most 240 characters of text', async () => {
      for (const q of [0, -1, 21, 1.5, '2', null]) await bad({ familyId: 'sink', config: sinkCfg(), dims: { W: 1000 }, qty: q }, /quantity must be a whole number/);
      await bad({ familyId: 'sink', config: sinkCfg(), dims: { W: 1000 }, qty: 1, note: 'x'.repeat(241) }, /note is too long/);
      await bad({ familyId: 'sink', config: sinkCfg(), dims: { W: 1000 }, qty: 1, note: 5 }, /note must be text/);
    });
    it('ONE FAMILY, ONE MULTIPLIER: 20 units of a family across ALL its lines (any options, any size) is the ceiling — 21 is refused, 40 lines x 20 is refused', async () => {
      const L = (q, w) => famLine('sink', sinkCfg({ basins: 1 }), { W: w, D: 500, H: 850 }, q);
      const token = await newSession();
      const ok = await fns.qrEstimate.run(estimatePayload(token, { items: [L(10, 500), L(10, 600)] }), ctx());
      assert.equal(ok.ok, true);
      await assert.rejects(fns.qrEstimate.run(estimatePayload(token, { items: [L(10, 500), L(10, 600), L(1, 700)] }), ctx()), (e) => { assert.equal(e.code, 'invalid-argument'); assert.match(e.message, /at most 20 of one product.*your list has 21/); return true; });
      await assert.rejects(fns.qrEstimate.run(estimatePayload(token, { items: Array.from({ length: 40 }, () => L(20, 500)) }), ctx()), (e) => e.code === 'invalid-argument');
      // a different family has its own allowance
      const two = await fns.qrEstimate.run(estimatePayload(token, { items: [L(20, 500), famLine('prep_table', { layers: 1, upper: 0 }, {}, 20)] }), ctx());
      assert.equal(two.ok, true);
    });
    it('a body whose fields hide on a smuggled __proto__ (the decoder quirk) is refused before it can dodge the allowlists — a family line included', async () => {
      if (!decodeWire) return;
      const token = await newSession();
      const smuggled = decodeWire(JSON.parse('{"familyId":"sink","__proto__":{"config":{"basins":2},"dims":{"W":1000},"qty":3}}'));
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token, { items: [fixedLine(), smuggled] }), ctx()), 'invalid-argument', /not in the expected format/);
      const smuggledCfg = decodeWire(JSON.parse('{"familyId":"sink","qty":1,"dims":{},"config":{"__proto__":{"basins":2},"basins":1}}'));
      await rejectsWith(fns.qrEstimate.run(estimatePayload(token, { items: [fixedLine(), smuggledCfg] }), ctx()), 'invalid-argument', /not in the expected format/);
    });
    it('a plain SKU line for a SKU a family absorbed is refused like any unknown product (a stale page cannot use it): PW-001, CE-001, PW-004 …', async () => {
      for (const id of ['PW-001', 'CE-001', 'PW-004', 'BA-001', 'PW-015', 'PW-023', 'PW-010', 'CE-017']) await bad({ id, qty: 1, size: null, runs: null, specs: [], note: '' }, /no longer in the catalogue/);
    });
    it('a refused request never burns anything it should not: the response to a bad line is an error, the session stays usable', async () => {
      const token = await newSession();
      await assert.rejects(fns.qrEstimate.run(estimatePayload(token, { items: [famLine('sink', sinkCfg({ faucet: 'x' }), {})] }), ctx()));
      const ok = await fns.qrEstimate.run(estimatePayload(token, { items: [famLine('sink', sinkCfg(), { W: 1000, D: 500, H: 850 }), fixedLine()] }), ctx());
      assert.equal(ok.ok, true);
    });
  });

  describe('qrSubmit stores the configured lines (price-free for the client, exact for staff) and returns only the receipt', () => {
    it('the stored items carry the family, the validated configuration, the size and the plain-words options; the internal lines show how each figure was built', async () => {
      const { res, doc } = await submit([famLine('sink', sinkCfg(), { W: 1000, D: 500, H: 850 }, 1, 'near the window'), fixedLine()]);
      assert.deepEqual(Object.keys(res).sort(), ['estimate', 'ok', 'receivedAt', 'refNo', 'submittedOnManila']);
      assert.deepEqual(doc.items[0], {
        n: 1, kind: 'family', id: 'PW-004', familyId: 'sink', name: 'Sink', cat: 'washing', unit: 'pc', qty: 1, runs: null,
        size: { W: 1000, D: 500, H: 850 }, sizeCustom: false, config: { ...sinkCfg(), top: 1.5 },           // 1000 mm is the usual length for two sinks; the staff-only top plate is stored at its standard 1.5 mm
        specs: [{ label: 'Sinks', value: '2' }, { label: 'Sink position', value: 'Centre' }, { label: 'Undershelf', value: 'Without' }, { label: 'Upper shelf', value: 'Without' }, { label: 'Faucet', value: 'Pre-rinse spray' },
          { label: 'Construction', value: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet' }],
        note: 'near the window',
      });
      assert.equal(doc.items[1].id, P_FIX);                                                 // the fixed item keeps its shape
      assert.ok(!('kind' in doc.items[1]));
      assert.equal(doc.internal.exactTotal, 36703 + 4217);
      assert.deepEqual(doc.internal.lines[0], { n: 1, id: 'PW-004', kind: 'family', familyId: 'sink', formulaType: 'per_length', unitPrice: 36703, lineTotal: 36703, priced: true, sizeAdjusted: true, warnings: [], base: 26011, deltas: [{ key: 'basins:2', amount: 6173 }, { key: 'faucet:prerinse', amount: 4519 }], missing: [], reason: null });
      assert.deepEqual(doc.internal.lines[1].unitPrice, 4217);
      assert.equal(doc.summary.itemCount, 2);
      assert.equal(doc.estimate.pricedCount, 2);
    });
    it('an unpriced configured line is stored with WHY (the staff screen shows it): an unapproved sheet, a blank cell, a stale schema, no sheet', async () => {
      const { doc } = await submit([famLine('cabinet', { type: 'floor', doors: 'swing', shelves: 3 }, {}), famLine('sink', sinkCfg({ basins: 3 }), { W: 1500, D: 500, H: 850 }), famLine('rack', { tiers: 4, wheels: true }, {}), famLine('wall_shelf', { tiers: 1, surface: 'solid' }, {}), fixedLine()]);
      const byFam = Object.fromEntries(doc.internal.lines.filter((l) => l.kind === 'family').map((l) => [l.familyId, l]));
      assert.equal(byFam.cabinet.reason, 'not_approved');
      assert.equal(byFam.sink.reason, 'missing_input');
      assert.deepEqual(byFam.sink.missing, ['Sinks: 3']);
      assert.equal(byFam.rack.reason, 'not_approved');
      assert.equal(byFam.wall_shelf.reason, 'not_approved');
      for (const l of Object.values(byFam)) { assert.equal(l.priced, false); assert.equal(l.unitPrice, 0); }
      assert.equal(doc.internal.exactTotal, 4217);
      assert.equal(doc.estimate.reviewCount, 4);
    });
    it('what the CLIENT is shown is the rounded range only; the notification (lock screens!) carries no figure and no option names', async () => {
      const { res } = await submit([famLine('stove', { positions: ['wok', 'hp_large', 'lp_small'], addons: [] }, { W: 1400, D: 700, H: 850 })]);
      assert.deepEqual(res.estimate, { low: 80000, high: 105000 });
      assert.ok(!/90647|29111|37123|exact|internal/i.test(JSON.stringify(res)));
      const notes = fake.paths('notifications/').map((p) => fake.read(p));
      assert.ok(notes.length >= 2);
      for (const n of notes) assert.ok(!/90,?647|29,?111|37,?123|wok|Wok/.test(`${n.title} ${n.body}`), 'a figure or an option name reached a notification');
    });
    it('the stored configuration is the VALIDATED one: add-ons are put in the family\'s order, defaults are filled in, and a client-supplied extra never survives', async () => {
      const { doc } = await submit([famLine('stove', { addons: ['fryer', 'griddle'], positions: ['lp_small', 'wok'] }, { W: 1300, D: 700, H: 850 }), fixedLine()]);
      assert.deepEqual(doc.items[0].config, { positions: ['lp_small', 'wok'], addons: ['griddle', 'fryer'], top: 1.5 });
      assert.equal(doc.items[0].specs[0].value, '1. Low-pressure burner, small, 2. Wok burner');
      assert.equal(doc.items[0].specs[1].value, 'Griddle, Fryer');
    });
    it('a re-price at submit uses the sheet AS IT IS THEN (an edit between the estimate and the submit is honoured), never what the page reported', async () => {
      const token = await readyToken();
      const items = [famLine('sink', sinkCfg(), { W: 1000, D: 500, H: 850 }), fixedLine()];
      const est = await fns.qrEstimate.run(estimatePayload(token, { items }), ctx());
      fake.seed('product_pricing/sink', { ...fake.read('product_pricing/sink'), approved: false });
      tick(600001);                                                                          // the master + sheets are re-read after the TTL
      const res = await fns.qrSubmit.run(submitPayload(token, { items, lastEstimate: { low: est.low, high: est.high, basketHash: est.basketHash } }), ctx());
      const doc = fake.read(`quote_requests/${res.refNo}`);
      assert.equal(doc.estimate.reviewCount, 1, 'the sheet was un-approved: the sink is now priced after review');
      assert.equal(doc.internal.exactTotal, 4217);
      assert.equal(doc.estimateMismatch, true, 'the figure the page saw no longer matches');
    });
    it('the stored request has no field the rules allowlist could not hold and nothing undefined (the strict fake rejects undefined) — a mixed basket round-trips', async () => {
      const { doc } = await submit([famLine('prep_table', { layers: 2, upper: 1 }, { W: 1200, D: 600, H: 850 }, 2), famLine('rack', { tiers: 6, wheels: false }, { W: 800, D: 500, H: 1600 }), fixedLine()]);
      assert.equal(doc.items.length, 3);
      assert.equal(doc.items[2].id, P_FIX);
      assert.deepEqual(doc.items.map((i) => i.n), [1, 2, 3]);
    });
  });

  it('the server and the page validate with the SAME helper (the functions/ mirror is byte-identical) — a configuration the helper accepts, the callable prices', async () => {
    const cfg = PFX.validateConfiguration(FAMS.families.sink, { basins: 2, faucet: 'prerinse' }).config;
    const r = await estimate([famLine('sink', cfg, { W: 1000, D: 500, H: 850 }), fixedLine()]);
    assert.equal(r.reviewCount, 0);
    assert.equal(fs.readFileSync(path.join(ROOT, 'functions/product-families.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'js/product-families.js'), 'utf8'));
  });
});
