// functions/portal-core.js — CLIENT-PORTAL-CHIBABS-SPEC.md §7.2.
//
// Pure, zero-Firebase-dependency helpers for the client portal callables
// (portalUnlock/portalState/portalSign/portalAdminRotateCode in index.js).
// CommonJS, `node:crypto` only — no firebase-admin, no firebase-functions —
// so this file can be `require()`d directly by tests/client-portal.test.mjs
// with no emulator and no network. Every function that needs "now" or
// randomness takes it as a parameter (nowMs, randomBytes) so tests can be
// fully deterministic; callers in index.js pass Date.now() / crypto.randomBytes
// explicitly. Cloud Functions bundling only ships the functions/ directory
// (firebase.json), which is why this lives here rather than under js/.
'use strict';

const crypto = require('crypto');
const net = require('net');

// Excludes 0/O/1/I — visually ambiguous on a phone screen or over the phone.
// 32 chars, and 256 % 32 === 0, so mapping a random byte via `% length` below
// is exactly uniform (no modulo bias to worry about).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const SESSION_TTL_MS = 90 * 24 * 3600 * 1000; // 90 days.

// Owner ruling §3: per-IP bucket (fast, tight) + per-portal bucket (slower,
// covers distributed guessing) — both run through the same decision function.
const RATE = {
  ip:     { window: 15 * 60e3, max: 5,  lock: 15 * 60e3, maxLock: 24 * 3600e3 },
  portal: { window: 60 * 60e3, max: 20, lock: 60 * 60e3, maxLock: 60 * 60e3 },
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const FIREBASE_STORAGE_PREFIX = 'https://firebasestorage.googleapis.com/';
// Keys that must never reach a client payload on an equipment-schedule item —
// owner ruling: per-item pricing/qty is genuinely unknown and must never be
// invented, so it is never even a passenger on the wire. §1.1 is explicit
// that 'amount' is forbidden on an item (it IS the per-item money there),
// so it — plus 'total'/'rate'/'disc' as defensive synonyms for the same
// thing — is included even though the original §1.9 regex omitted it.
// SCOPED TO ITEMS ONLY: milestones[].amount and payments[].amount are
// legitimate, confirmed, client-visible figures built by their own
// projection functions below and must never run through this regex.
const SENSITIVE_ITEM_KEY_RE = /cost|margin|markup|price|subtotal|qty|quantity|amount|total|rate|disc/i;

// ──────────────────────────────────────────────────────────────────────────
//  Access code: generate / normalise / hash / verify
// ──────────────────────────────────────────────────────────────────────────

/** 'XXXX-XXXX' drawn from CODE_ALPHABET. randomBytes is injectable for tests. */
function generateCode(randomBytes = crypto.randomBytes) {
  const raw = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[raw[i] % CODE_ALPHABET.length];
  return out.slice(0, 4) + '-' + out.slice(4);
}

/**
 * Uppercase, strip everything outside CODE_ALPHABET (hyphens, spaces, and
 * the visually-ambiguous 0/O/1/I all fall out here), then require exactly 8
 * chars remain — otherwise '' (never a partial/short code). A code typed
 * with an ambiguous character normalises to '' rather than silently mapping
 * it to a real alphabet character, which would let a client "guess" via
 * OCR/keyboard confusion.
 */
function normalizeCode(s) {
  const upper = String(s == null ? '' : s).toUpperCase();
  let out = '';
  for (const ch of upper) if (CODE_ALPHABET.includes(ch)) out += ch;
  return out.length === 8 ? out : '';
}

/** scryptSync(code, salt, 32, {N:16384,r:8,p:1}). Generates a fresh 16-byte
 *  salt when saltHex is omitted (rotation); pass the stored saltHex back in
 *  to re-derive the same hash (never used that way — verifyCode is used for
 *  checking instead — but kept symmetric/testable). */
function hashCode(code, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(code), salt, 32, { N: 16384, r: 8, p: 1 });
  return { saltHex: salt.toString('hex'), hashHex: hash.toString('hex'), algo: 'scrypt-16384-8-1-32' };
}

/** Constant-time compare via crypto.timingSafeEqual — never a plain ===. */
function verifyCode(code, saltHex, hashHex) {
  try {
    const salt = Buffer.from(String(saltHex), 'hex');
    const expected = Buffer.from(String(hashHex), 'hex');
    const actual = crypto.scryptSync(String(code), salt, 32, { N: 16384, r: 8, p: 1 });
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false; // malformed salt/hash — never throw out of a security check.
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Viewer sessions
// ──────────────────────────────────────────────────────────────────────────

/** SHA-256 hex of a raw token. The doc id of client_portal_sessions/{hash} —
 *  the raw token is never itself stored, so a DB leak can't be replayed. */
function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** 32 random bytes as unpadded base64url (43 chars, matches ^[A-Za-z0-9_-]{43}$). */
function newViewerToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: tokenHash(token) };
}

/** True only when the session doc still belongs to this portal, is still on
 *  the portal's current sessionsGeneration (a generation bump instantly
 *  invalidates every existing session), and hasn't expired. `expiresAt` may
 *  be a Firestore Timestamp (production) or a plain ms number (tests). */
function sessionValid(session, opts) {
  const { nowMs, generation, portalId } = opts || {};
  if (!session || typeof session !== 'object') return false;
  if (session.portalId !== portalId) return false;
  if (session.generation !== generation) return false;
  const expiresAtMs = _toMillis(session.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

function _toMillis(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000 + Math.floor((v._nanoseconds || 0) / 1e6);
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return NaN;
}

// ──────────────────────────────────────────────────────────────────────────
//  Rate limiting — fails CLOSED (§3 / hard rule: a store error or a
//  malformed bucket is a deny, never a fall-through allow)
// ──────────────────────────────────────────────────────────────────────────

function _wellFormedBucket(b) {
  return b && typeof b === 'object'
    && Number.isFinite(b.count) && Number.isFinite(b.windowStart) && Number.isFinite(b.lockedUntil);
}

/**
 * Decides whether THIS attempt may proceed, given the bucket as read (or
 * null if none exists yet). `next` is the bucket to WRITE if this attempt
 * turns out to be a failure (the caller writes it inside the same
 * transaction that checked the code) — so only one read + one decision is
 * needed per attempt, matching the §2.1 "read once, decide, write on
 * failure" flow.
 *   - A bucket that is currently locked → allowed:false, retryAfterMs set,
 *     next unchanged (a locked caller never gets to burn another attempt).
 *   - A malformed bucket (wrong types — e.g. count:'x') → allowed:false,
 *     fail closed, and `next` re-locks it so a corrupt bucket self-heals to
 *     the safe state rather than being silently reset to "allow".
 *   - Otherwise: the window resets if `window` ms have elapsed since
 *     windowStart; hitting `max` on this attempt locks for `lock` ms,
 *     doubling (capped at `maxLock`) each consecutive lock since the last
 *     bucketAfterSuccess() reset.
 */
function rateLimitDecision(bucket, nowMs, cfg) {
  if (bucket != null && !_wellFormedBucket(bucket)) {
    const priorStreak = Number.isInteger(bucket.lockStreak) ? bucket.lockStreak : 0;
    return {
      allowed: false,
      retryAfterMs: cfg.lock,
      next: { count: cfg.max, windowStart: nowMs, lockedUntil: nowMs + cfg.lock, lockStreak: priorStreak + 1 },
    };
  }

  const cur = bucket || { count: 0, windowStart: nowMs, lockedUntil: 0, lockStreak: 0 };

  if (cur.lockedUntil && cur.lockedUntil > nowMs) {
    return { allowed: false, retryAfterMs: cur.lockedUntil - nowMs, next: cur };
  }

  const windowExpired = (nowMs - cur.windowStart) >= cfg.window;
  const windowStart = windowExpired ? nowMs : cur.windowStart;
  const newCount = (windowExpired ? 0 : cur.count) + 1;
  const priorStreak = Number.isInteger(cur.lockStreak) ? cur.lockStreak : 0;

  if (newCount >= cfg.max) {
    const lockStreak = priorStreak + 1;
    const lockDuration = Math.min(cfg.lock * Math.pow(2, lockStreak - 1), cfg.maxLock);
    return { allowed: true, retryAfterMs: 0, next: { count: newCount, windowStart, lockedUntil: nowMs + lockDuration, lockStreak } };
  }

  return { allowed: true, retryAfterMs: 0, next: { count: newCount, windowStart, lockedUntil: 0, lockStreak: priorStreak } };
}

/** The bucket to write after a SUCCESSFUL attempt — full reset, including
 *  the lock streak (only a success clears it; window expiry alone does not). */
function bucketAfterSuccess(nowMs = Date.now()) {
  return { count: 0, windowStart: nowMs, lockedUntil: 0, lockStreak: 0 };
}

// ──────────────────────────────────────────────────────────────────────────
//  Client IP derivation — anti-spoof (2026-09-26 security fix)
//
//  THE BUG THIS REPLACES: the old helper took the FIRST comma-separated
//  entry of `x-forwarded-for`. Google's front end APPENDS the address it
//  actually saw to whatever XFF the caller sent — it does not replace the
//  header — so the left-most entry is 100% attacker-controlled. Anyone
//  calling the callables directly (curl, not the web page) could send a
//  fresh fake XFF per request and land in a brand-new per-IP rate-limit
//  bucket every time, i.e. unlimited guesses at an 8-character access code.
//
//  Google's own docs, both halves of the rule:
//   * Cloud Load Balancing, "Target proxies / X-Forwarded-For": the load
//     balancer APPENDS `<client-ip>,<load-balancer-ip>` and cautions that it
//     "does not verify any IP addresses that precede" those two.
//   * Cloud Run functions, "Request headers": XFF is a header "added for
//     your use" of the form `clientIp, proxy1Ip, proxy2Ip`.
//  So the trustworthy value is counted from the RIGHT, never the left.
//
//  HOP COUNT. These callables are invoked straight at
//  `https://asia-east1-<project>.cloudfunctions.net/<name>` (firebase.json
//  declares no `hosting` block, and the portal page calls
//  firebase.app().functions('asia-east1').httpsCallable(...) directly), so
//  exactly ONE entry is appended by our own infrastructure and the LAST
//  entry is the peer. If a Google external Application Load Balancer is ever
//  put in front of these functions it appends two (`client, lb`) and this
//  constant must become 2 — hence the named constant rather than a bare -1.
//
//  `rawRequest.ip` is deliberately NOT the primary source: the Functions
//  Framework's Express app does not enable `trust proxy`, so `req.ip` is the
//  in-sandbox socket peer (a Google internal address, identical for every
//  caller — one global bucket, which would lock the whole portal out); and
//  if `trust proxy` were ever enabled, Express returns the LEFT-most XFF
//  entry, i.e. exactly the spoofable value we are removing. It is used only
//  when there is no XFF at all, where it genuinely is the client.
// ──────────────────────────────────────────────────────────────────────────

/** How many trailing XFF entries our own infrastructure writes. See above. */
const TRUSTED_PROXY_HOPS = 1;

/**
 * '203.0.113.7:51514' → '203.0.113.7', '[2001:db8::1]:443' → '2001:db8::1',
 * '::ffff:203.0.113.7' → '203.0.113.7' (same host, one canonical form).
 * Returns null for anything node:net won't accept as an IP literal, and for
 * the two unspecified addresses — '0.0.0.0' was the OLD sentinel, so
 * accepting it here would quietly recreate the shared-bucket hole.
 */
function _normalizeIp(raw) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return null;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) {
    s = bracketed[1];
  } else if (s.includes('.') && s.indexOf(':') === s.lastIndexOf(':') && s.includes(':')) {
    // Exactly one colon AND a dot ⇒ 'a.b.c.d:port'. A bare IPv6 has two or
    // more colons, so this can never truncate one.
    s = s.slice(0, s.indexOf(':'));
  }
  const mapped = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/.exec(s);
  if (mapped && net.isIP(mapped[1]) === 4) s = mapped[1];
  const family = net.isIP(s);
  if (family === 0) return null;
  if (s === '0.0.0.0' || s === '::') return null;
  return { ip: s, family };
}

/**
 * The ONLY way any callable may learn its caller's address.
 *
 *   { ip: '203.0.113.7', family: 4, trusted: true,  source: 'xff' }
 *   { ip: null,          family: 0, trusted: false, source: 'xff' }
 *
 * FAIL CLOSED: `trusted:false` means no address could be derived that Google
 * itself wrote. Callers must treat that as rate-limited/denied — never as
 * "no limit applies". Nothing in here ever throws.
 *
 * opts.trustedProxyHops overrides TRUSTED_PROXY_HOPS (tests; a future LB).
 */
function clientIpFrom(rawRequest, opts) {
  const hops = (opts && Number.isInteger(opts.trustedProxyHops) && opts.trustedProxyHops > 0)
    ? opts.trustedProxyHops
    : TRUSTED_PROXY_HOPS;
  const req = rawRequest || {};
  const headers = req.headers || {};
  const xffRaw = headers['x-forwarded-for'];
  // Node collapses duplicate XFF headers into one comma-joined string, but
  // accept an array too rather than stringifying it into garbage.
  const xff = Array.isArray(xffRaw) ? xffRaw.join(',') : xffRaw;
  const entries = String(xff == null ? '' : xff).split(',').map((s) => s.trim()).filter(Boolean);

  if (entries.length) {
    // Count from the right. Everything left of this index is caller-supplied
    // and is never read.
    if (entries.length < hops) return { ip: null, family: 0, trusted: false, source: 'xff' };
    const parsed = _normalizeIp(entries[entries.length - hops]);
    if (!parsed) return { ip: null, family: 0, trusted: false, source: 'xff' };
    return { ip: parsed.ip, family: parsed.family, trusted: true, source: 'xff' };
  }

  // No XFF at all ⇒ nothing proxied this request, so the socket peer IS the
  // client (emulator, local `node --test`, a direct container hit). Not
  // spoofable: a remote caller can neither change what our socket sees nor
  // delete the entry Google appends.
  const sock = req.socket || req.connection || {};
  const parsed = _normalizeIp(req.ip || sock.remoteAddress);
  if (!parsed) return { ip: null, family: 0, trusted: false, source: null };
  return { ip: parsed.ip, family: parsed.family, trusted: true, source: 'socket' };
}

/** '2001:db8:85a3:8d3::1' → ['2001','db8','85a3','8d3','0','0','0','1']. */
function _expandIpv6(ip) {
  let s = ip;
  const embeddedV4 = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(s);
  if (embeddedV4) {
    const o = embeddedV4[2].split('.').map(Number);
    s = embeddedV4[1] + (((o[0] << 8) | o[1]) >>> 0).toString(16) + ':' + (((o[2] << 8) | o[3]) >>> 0).toString(16);
  }
  const halves = s.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 ? (halves[1] ? halves[1].split(':') : []) : null;
  const groups = right === null
    ? left
    : left.concat(new Array(Math.max(0, 8 - left.length - right.length)).fill('0'), right);
  if (groups.length !== 8) return null;
  return groups.map((g) => (parseInt(g, 16) || 0).toString(16));
}

/**
 * The string a rate-limit bucket is keyed on — NOT the same thing as the
 * address you log.
 *
 *   IPv4 → the address itself ('203.0.113.7'), byte-identical to what the
 *          old helper produced for honest traffic, so existing
 *          client_portal_ratelimit buckets keep working across this deploy.
 *   IPv6 → the /64 prefix ('2001:db8:85a3:8d3::/64'). A residential or
 *          hosted IPv6 client is handed a whole /64 (or wider) and can pick
 *          any of 2^64 source addresses at will, so bucketing per exact
 *          address would leave the very bypass this fix closes wide open for
 *          anyone on IPv6. /64 is the smallest unit a single subscriber
 *          cannot subdivide, and it is the same trade-off IPv4 NAT already
 *          imposes (several clients may share one bucket).
 *
 * Returns null for an untrusted/absent address — callers must deny.
 */
function rateLimitIpKey(info) {
  if (!info || info.trusted !== true || !info.ip) return null;
  if (info.family === 4) return info.ip;
  const groups = _expandIpv6(info.ip);
  if (!groups) return null;
  return groups.slice(0, 4).join(':') + '::/64';
}

// ──────────────────────────────────────────────────────────────────────────
//  Dates / reference numbers (Manila time, UTC+8, no DST — never toISOString())
// ──────────────────────────────────────────────────────────────────────────

function manilaDateFrom(ms) {
  const shifted = new Date(Number(ms) + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** 'BKC-yymmdd-XXXXXX' — date part is manilaDateFrom(nowMs), suffix is 6
 *  CODE_ALPHABET chars (so a ref number can never contain 0/O/1/I either). */
function refNo(nowMs, randomBytes = crypto.randomBytes) {
  const iso = manilaDateFrom(nowMs);
  const yymmdd = iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
  const raw = randomBytes(6);
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += CODE_ALPHABET[raw[i] % CODE_ALPHABET.length];
  return `BKC-${yymmdd}-${suffix}`;
}

// ──────────────────────────────────────────────────────────────────────────
//  Milestone arithmetic guard — an import that doesn't reproduce the
//  contract total must be refused, never silently accepted (§1.1 note).
// ──────────────────────────────────────────────────────────────────────────

function milestoneCheck(total, milestones) {
  const errors = [];
  const totalNum = Number(total);
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return { ok: false, errors: ['milestones must be a non-empty array'] };
  }
  let pctSum = 0;
  let amountSum = 0;
  milestones.forEach((m, i) => {
    const label = (m && m.key) || `#${i}`;
    const pct = Number(m && m.pct);
    const amount = Number(m && m.amount);
    pctSum += pct;
    amountSum += amount;
    const expected = Math.round((totalNum * pct) / 100);
    if (amount !== expected) errors.push(`${label}: amount ${amount} != expected ${expected} (pct ${pct})`);
    if (Array.isArray(m && m.parts) && m.parts.length) {
      const partsSum = m.parts.reduce((s, p) => s + Number(p && p.amount), 0);
      if (partsSum !== amount) errors.push(`${label}: parts sum ${partsSum} != amount ${amount}`);
    }
  });
  if (pctSum !== 100) errors.push(`pct sum ${pctSum} != 100`);
  if (amountSum !== totalNum) errors.push(`amount sum ${amountSum} != total ${totalNum}`);
  return { ok: errors.length === 0, errors };
}

// ──────────────────────────────────────────────────────────────────────────
//  Signature image — PNG only, format-allowlisted, size-capped, stored as a
//  plain string field (never Firebase Storage — D4/D8: the client is
//  unauthenticated, so a Firestore field riding inside the callable response
//  avoids the unauthenticated-read problem entirely).
// ──────────────────────────────────────────────────────────────────────────

function validateSignaturePng(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return { ok: false, bytes: 0, error: 'Signature must be a PNG image.' };
  }
  let buf;
  try {
    buf = Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), 'base64');
  } catch (e) {
    return { ok: false, bytes: 0, error: 'Signature image could not be read.' };
  }
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    return { ok: false, bytes: buf.length, error: 'Signature image is not a valid PNG.' };
  }
  if (buf.length < 1024 || buf.length > 200000) {
    return { ok: false, bytes: buf.length, error: 'Signature image size is out of range.' };
  }
  return { ok: true, bytes: buf.length, error: null };
}

// ──────────────────────────────────────────────────────────────────────────
//  Privacy notice (§4) — canonical here so the version/hash recorded on the
//  acceptance can never drift from what the page actually rendered.
// ──────────────────────────────────────────────────────────────────────────

const PRIVACY_NOTICE = {
  version: '2026-09-26.1',
  sections: [
    { heading: 'Who is responsible for your data', body:
      'Personal Information Controller: Barro Industries OPC (SEC-registered, Metro Manila), trading as Barro Kitchens. ' +
      'Contact for privacy matters: the President, 0927 683 6300, barroindustries@gmail.com.' },
    { heading: 'What we collect on this page', body:
      'Your name, e-mail, mobile number, designation and company; your drawn or typed signature; the agreements you tick; ' +
      'the date and time you sign; your device\'s IP address and browser identifier; and the access code you enter ' +
      '(never stored in readable form).' },
    { heading: 'Why', body:
      'To record your acceptance of this proposal and form the contract; to contact you about this project (drawings, ' +
      'inspection, delivery, turnover, warranty); and to keep the records Philippine law requires of a business.' },
    { heading: 'Lawful basis', body:
      'Republic Act 10173 (the Data Privacy Act) section 12(b) — necessary for a contract you are party to; section 12(c) — ' +
      'a legal obligation for business records; and your consent for the signature image and for any optional communications.' },
    { heading: 'Who we share it with', body:
      'Barro Industries staff who work on your project; Google LLC, whose Firebase/Google Cloud services host this system ' +
      '(servers may be outside the Philippines); and government authorities only when the law requires it. ' +
      'We do not sell or rent personal data.' },
    { heading: 'How long we keep it', body:
      'For the life of the project and ten (10) years after turnover, in line with Philippine record-keeping requirements ' +
      'for business and tax records; then deleted or anonymised.' },
    { heading: 'Your rights', body:
      'To be informed; to access; to object; to rectification; to erasure or blocking; to damages; to data portability; ' +
      'and to lodge a complaint with the National Privacy Commission (privacy.gov.ph). Write to the contact above; ' +
      'we respond within fifteen (15) working days.' },
    { heading: 'Security', body:
      'Data is encrypted in transit and access is limited to authorised staff. This page stores only a viewer key in your ' +
      'browser — no advertising cookies.' },
  ],
};

function privacyNoticeSha256() {
  return crypto.createHash('sha256').update(JSON.stringify(PRIVACY_NOTICE.sections)).digest('hex');
}

// ──────────────────────────────────────────────────────────────────────────
//  publicProjection — the SINGLE function that builds the client payload
//  (§2.5 `state`). Callables must never hand-assemble any part of this
//  themselves. Strips every field listed in §1.9 as a matter of what it
//  simply never copies, rather than a denylist applied after the fact.
// ──────────────────────────────────────────────────────────────────────────

function _toIso(v) {
  const ms = _toMillis(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function _stripSensitiveItemKeys(item) {
  const out = {};
  Object.keys(item || {}).forEach((k) => {
    if (!SENSITIVE_ITEM_KEY_RE.test(k)) out[k] = item[k];
  });
  return out;
}

function _buildPortalProjection(portalDoc) {
  const p = portalDoc || {};
  const client = p.client || {};
  return {
    id: p.id || '',
    status: p.status || 'draft',
    client: {
      name: client.name || '',
      company: client.company || '',
      contactName: client.contactName || '',
      address: client.address || '',
      // client.email/phone deliberately omitted — Neil's own notes (§1.9).
    },
    proposal: p.proposal || {},
    figures: p.figures || {},
    milestones: Array.isArray(p.milestones) ? p.milestones : [],
    zones: Array.isArray(p.zones) ? p.zones : [],
    items: (Array.isArray(p.items) ? p.items : []).map(_stripSensitiveItemKeys),
    workflow: Array.isArray(p.workflow) ? p.workflow : [],
    steps: Array.isArray(p.steps) ? p.steps : [],
    terms: Array.isArray(p.terms) ? p.terms : [],
    agreementsRequired: Array.isArray(p.agreementsRequired) ? p.agreementsRequired : [],
  };
}

function _buildProgressProjection(portalDoc, updates) {
  const p = portalDoc || {};
  const progress = p.progress || {};
  const payments = (Array.isArray(p.payments) ? p.payments : []).map((pm) => ({
    milestoneKey: pm && pm.milestoneKey,
    partIndex: pm && pm.partIndex,
    amount: pm && pm.amount,
    receivedOn: pm && pm.receivedOn,
    method: pm && pm.method,
    // pm.note deliberately omitted — internal-only (§1.9).
  }));
  const projectedUpdates = (Array.isArray(updates) ? updates : [])
    .filter((u) => u && u.visible !== false)
    .map((u) => ({
      id: u.id || '',
      at: _toIso(u.at),
      title: u.title || '',
      body: u.body || '',
      stepNo: u.stepNo,
      photos: (Array.isArray(u.photos) ? u.photos : [])
        // Owner ruling D8 / §1.9: only tokenized Firebase Storage URLs are
        // ever handed to the anonymous client — anything else (a bad path,
        // a foreign host) is dropped rather than passed through.
        .filter((ph) => ph && typeof ph.url === 'string' && ph.url.startsWith(FIREBASE_STORAGE_PREFIX))
        .map((ph) => ({ url: ph.url, caption: ph.caption || '' })),
    }));
  return {
    currentStep: typeof progress.currentStep === 'number' ? progress.currentStep : 0,
    steps: progress.steps || {},
    payments,
    updates: projectedUpdates,
  };
}

function _buildAcceptanceProjection(acceptanceDoc) {
  if (!acceptanceDoc) return null;
  const a = acceptanceDoc;
  const signer = a.signer || {};
  const privacy = a.privacy || {};
  return {
    refNo: a.refNo,
    signedAt: _toIso(a.signedAt),
    signer: {
      name: signer.name || '',
      email: signer.email || '',
      phone: signer.phone || '',
      designation: signer.designation || '',
      company: signer.company || '',
    },
    typedName: a.typedName || '',
    signatureMode: a.signatureMode,
    signaturePng: a.signaturePng || null,
    agreements: a.agreements || {},
    privacy: { noticeVersion: privacy.noticeVersion, consentedAt: _toIso(privacy.consentedAt) },
    // a.client (ip/userAgent/acceptLanguage), sessionTokenHash, codeVersion,
    // figuresAtSigning: all deliberately omitted — staff-only (§1.9).
  };
}

/**
 * portalDoc: the client_portals/{id} data (with `.id` set on it by the
 * caller). updates: the raw updates subcollection docs (each with `.id`).
 * opts: { nowMs, acceptanceDoc } — acceptanceDoc is the full
 * acceptances/{refNo} record when status is 'signed', else omit/null.
 */
function publicProjection(portalDoc, updates, opts) {
  const o = opts || {};
  const nowMs = typeof o.nowMs === 'number' ? o.nowMs : Date.now();
  const today = manilaDateFrom(nowMs);
  const validUntil = portalDoc && portalDoc.proposal && portalDoc.proposal.validUntil;
  return {
    portal: _buildPortalProjection(portalDoc),
    acceptance: _buildAcceptanceProjection(o.acceptanceDoc),
    progress: _buildProgressProjection(portalDoc, updates),
    privacyNotice: { version: PRIVACY_NOTICE.version, sections: PRIVACY_NOTICE.sections },
    server: { now: new Date(nowMs).toISOString(), today, expired: !!(validUntil && today > validUntil) },
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Manual-send outbox body (§6.6) — built server-side so the internal
//  screen's "Open in Mail/Gmail" buttons and this file agree byte-for-byte.
// ──────────────────────────────────────────────────────────────────────────

const _MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function _formatDueDate(iso) {
  if (typeof iso !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function buildOutboxBody(portalDoc, acceptance) {
  const p = portalDoc || {};
  const client = p.client || {};
  const proposal = p.proposal || {};
  const figures = p.figures || {};
  const milestones = Array.isArray(p.milestones) ? p.milestones : [];
  const m1 = milestones.find((m) => m && m.key === 'M1');
  const signer = (acceptance && acceptance.signer) || {};
  const contractTotal = Number(figures.contractTotal) || 0;

  const [clientSlug, pageSlug] = String(p.id || '').split('__');
  const url = `https://barroindustries.com/projects/${clientSlug || ''}/${pageSlug || ''}/`;

  let m1Line = '';
  if (m1 && Array.isArray(m1.parts) && m1.parts.length === 2) {
    m1Line = `Milestone 1: PHP ${Number(m1.parts[0].amount).toLocaleString('en-PH')} on acceptance · ` +
      `PHP ${Number(m1.parts[1].amount).toLocaleString('en-PH')} on ${_formatDueDate(m1.parts[1].dueOn)}`;
  } else if (m1) {
    m1Line = `Milestone 1: PHP ${Number(m1.amount).toLocaleString('en-PH')}`;
  }

  return [
    `Dear ${signer.name || ''},`,
    '',
    `Thank you — we have received your signed acceptance of Proposal ${proposal.number || ''} (${proposal.title || ''}) for ${client.company || ''}.`,
    '',
    `Reference number: ${(acceptance && acceptance.refNo) || ''}`,
    `Signed on: ${(acceptance && acceptance.signedOnManila) || ''}`,
    `Contract price: PHP ${contractTotal.toLocaleString('en-PH')} (VAT-exclusive)`,
    m1Line,
    '',
    `Next step: shop drawings start today. You can follow the project's progress any time at`,
    `${url} using your access code.`,
    '',
    'Warm regards,',
    'Neil Barro',
    'President, Barro Industries OPC · Barro Kitchens',
    '0927 683 6300 · barroindustries@gmail.com',
  ].join('\n');
}

module.exports = {
  CODE_ALPHABET,
  SESSION_TTL_MS,
  RATE,
  generateCode,
  normalizeCode,
  hashCode,
  verifyCode,
  newViewerToken,
  tokenHash,
  sessionValid,
  rateLimitDecision,
  bucketAfterSuccess,
  TRUSTED_PROXY_HOPS,
  clientIpFrom,
  rateLimitIpKey,
  manilaDateFrom,
  refNo,
  milestoneCheck,
  validateSignaturePng,
  publicProjection,
  PRIVACY_NOTICE,
  privacyNoticeSha256,
  buildOutboxBody,
};
