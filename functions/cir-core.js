// functions/cir-core.js — CLIENT-INFO-REQUEST-SPEC.md §2.0.
//
// Pure, zero-Firebase-dependency helpers for the five "Client Information
// Request" callables (cirStartDraft/cirUploadPhoto/cirRemovePhoto/cirSubmit/
// cirAdminDelete in functions/index.js). CommonJS, `node:crypto` +
// ./portal-core + ./cir-forms only — no firebase-admin, no firebase-functions
// — so this file can be `require()`d directly by
// tests/client-info-request.test.mjs with no emulator and no network, same
// harness as tests/client-portal.test.mjs pins portal-core.js. Every function
// that needs "now" or randomness takes it as a parameter (nowMs, randomBytes)
// so tests can be fully deterministic; callers in index.js pass Date.now() /
// crypto.randomBytes explicitly. This file NEVER edits portal-core.js or
// cir-forms.js — it only requires them.
'use strict';

const crypto = require('crypto');
const portal = require('./portal-core');
const { FORMS, PRIVACY_NOTICE, LIMITS } = require('./cir-forms');

// ──────────────────────────────────────────────────────────────────────────
//  Rate limiting config (§2.1) — per-scope buckets, all fail CLOSED via
//  portal.rateLimitDecision (reused, not reimplemented).
// ──────────────────────────────────────────────────────────────────────────
const RATE = {
  start:  { window: 3600e3,      max: 20, lock: 3600e3,      maxLock: 24 * 3600e3 },
  photo:  { window: 3600e3,      max: 80, lock: 3600e3,      maxLock: 24 * 3600e3 },
  submit: { window: 24 * 3600e3, max: 5,  lock: 24 * 3600e3, maxLock: 7 * 24 * 3600e3 },
  global: { window: 3600e3,      max: 40, lock: 1800e3,      maxLock: 6 * 3600e3 },
  // IP-independent fallbacks for the two pre-submit steps, mirroring
  // `global` above (portalClientIp trusts the first X-Forwarded-For entry,
  // which GCP's front end never overwrites, so a rotating fake XFF defeats
  // the per-IP buckets above — these two never key on IP at all).
  // globalStart: 300/hr is ~7.5x `global.max` (40/hr submits) — plenty of
  // headroom for real visitors who reload/abandon the page (many drafts per
  // completed submission) while still bounding a rotating-IP attacker to
  // 300 wasted cir_drafts docs/hr before the lockout escalates.
  globalStart: { window: 3600e3, max: 300, lock: 1800e3, maxLock: 6 * 3600e3 },
  // globalPhoto: 600/hr comfortably covers `global.max` (40) submissions/hr
  // each attaching well over its realistic average photo count, while
  // capping worst-case Storage cost at ~600 * LIMITS.maxPhotoBytes
  // (≈540MB) per hour before the same escalating lockout applies.
  globalPhoto: { window: 3600e3, max: 600, lock: 1800e3, maxLock: 6 * 3600e3 },
};

// ──────────────────────────────────────────────────────────────────────────
//  Reference numbers / ids / Storage paths
// ──────────────────────────────────────────────────────────────────────────

/** 'CIR-yymmdd-XXXXXX' — same generator body as portal.refNo, prefix changed.
 *  Date part is portal.manilaDateFrom(nowMs); suffix is 6 CODE_ALPHABET chars
 *  (no 0/O/1/I). randomBytes is injectable for deterministic tests. */
function refNo(nowMs, randomBytes = crypto.randomBytes) {
  const iso = portal.manilaDateFrom(nowMs);
  const yymmdd = iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
  const raw = randomBytes(6);
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += portal.CODE_ALPHABET[raw[i] % portal.CODE_ALPHABET.length];
  return `CIR-${yymmdd}-${suffix}`;
}

/** 'p_' + 12 lowercase hex chars. randomBytes is injectable for tests. */
function photoId(randomBytes = crypto.randomBytes) {
  return 'p_' + randomBytes(6).toString('hex');
}

function draftPath(draftHash, id) {
  return `client-info-requests/drafts/${draftHash}/${id}.jpg`;
}

function finalPath(ref, id) {
  return `client-info-requests/${ref}/${id}.jpg`;
}

// ──────────────────────────────────────────────────────────────────────────
//  Text sanitising
// ──────────────────────────────────────────────────────────────────────────

/** single-line: strip [\x00-\x1F\x7F]; multiline: strip [\x00-\x08\x0B\x0C\x0E-\x1F\x7F]
 *  (keeps \n/\t); always .trim() afterward. */
function stripText(s, opts) {
  const multiline = !!(opts && opts.multiline);
  const str = String(s == null ? '' : s);
  const cleaned = multiline
    ? str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    : str.replace(/[\x00-\x1F\x7F]/g, '');
  return cleaned.trim();
}

// ──────────────────────────────────────────────────────────────────────────
//  Form-definition helpers
// ──────────────────────────────────────────────────────────────────────────

function _allFields(formDef) {
  const out = [];
  (formDef && formDef.sections ? formDef.sections : []).forEach((sec) => {
    (sec.fields || []).forEach((f) => { if (f.type !== 'photos') out.push(f); });
  });
  return out;
}

/** Normalises a field/column's `options` array (mixed string / {v,l} entries)
 *  into [{v,l}], preserving definition order — the order chips are re-sorted
 *  into and the allowlist chips/table-selects are checked against. */
function _optionEntries(options) {
  return (options || []).map((o) => (typeof o === 'string') ? { v: o, l: o } : { v: o.v, l: (o.l != null ? o.l : o.v) });
}

function _photoGroupKeys(formDef) {
  const out = [];
  (formDef && formDef.sections ? formDef.sections : []).forEach((sec) => {
    (sec.fields || []).forEach((f) => {
      if (f.type === 'photos') (f.groups || []).forEach((g) => out.push(g.key));
    });
  });
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
//  validateAnswers — §1.4 table, implemented exactly.
// ──────────────────────────────────────────────────────────────────────────

function validateAnswers(formDef, rawAnswers) {
  const errors = [];
  const clean = {};
  const raw = (rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)) ? rawAnswers : {};
  const fields = _allFields(formDef);
  const fieldsByKey = {};
  fields.forEach((f) => { fieldsByKey[f.key] = f; });

  // Unknown-key check — every raw key must belong to a real (non-photos) field.
  Object.keys(raw).forEach((k) => {
    if (!fieldsByKey[k]) errors.push(`Unknown field "${k}"`);
  });

  fields.forEach((f) => {
    const has = Object.prototype.hasOwnProperty.call(raw, f.key);
    const v = has ? raw[f.key] : undefined;

    switch (f.type) {
      case 'text':
      case 'tel':
      case 'email':
      case 'url': {
        const s = (typeof v === 'string') ? stripText(v, { multiline: false }) : '';
        if (!s) { if (f.required) errors.push(`"${f.label}" is required`); return; }
        const max = f.max || (f.type === 'email' ? 160 : (f.type === 'url' ? 500 : 200));
        if (s.length > max) { errors.push(`"${f.label}" is too long`); return; }
        if (f.type === 'tel' && !/^[0-9+\-\s().]{6,32}$/.test(s)) { errors.push(`"${f.label}" is not a valid phone number`); return; }
        if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) { errors.push(`"${f.label}" is not a valid email`); return; }
        if (f.type === 'url' && !/^https?:\/\//i.test(s)) { errors.push(`"${f.label}" must be a web link starting with http:// or https://`); return; }
        clean[f.key] = s;
        break;
      }
      case 'textarea': {
        const s = (typeof v === 'string') ? stripText(v, { multiline: true }) : '';
        if (!s) { if (f.required) errors.push(`"${f.label}" is required`); return; }
        const max = f.max || 2000;
        if (s.length > max) { errors.push(`"${f.label}" is too long`); return; }
        clean[f.key] = s;
        break;
      }
      case 'select': {
        const s = (typeof v === 'string') ? v : '';
        if (!s) { if (f.required) errors.push(`"${f.label}" is required`); return; }
        const opts = _optionEntries(f.options).map((o) => o.v);
        if (!opts.includes(s)) { errors.push(`"${f.label}" has an invalid value`); return; }
        clean[f.key] = s;
        break;
      }
      case 'number': {
        if (!has || v == null || v === '') { if (f.required) errors.push(`"${f.label}" is required`); return; }
        if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`"${f.label}" must be a number`); return; }
        const min = (f.min != null) ? f.min : 0;
        const max = (f.max != null) ? f.max : 1e6;
        if (v < min || v > max) { errors.push(`"${f.label}" is out of range`); return; }
        if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) { errors.push(`"${f.label}" has too many decimal places`); return; }
        clean[f.key] = v;
        break;
      }
      case 'date': {
        const s = (typeof v === 'string') ? v.trim() : '';
        if (!s) { if (f.required) errors.push(`"${f.label}" is required`); return; }
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) { errors.push(`"${f.label}" is not a valid date`); return; }
        const yr = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
        if (yr < 2000 || yr > 2100) { errors.push(`"${f.label}" year is out of range`); return; }
        const d = new Date(Date.UTC(yr, mo - 1, da));
        if (d.getUTCFullYear() !== yr || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) {
          errors.push(`"${f.label}" is not a valid calendar date`); return;
        }
        clean[f.key] = s;
        break;
      }
      case 'chips': {
        const arr = Array.isArray(v) ? v : [];
        if (arr.length === 0) { if (f.required) errors.push(`"${f.label}" is required`); return; }
        const optEntries = _optionEntries(f.options);
        const optValues = optEntries.map((o) => o.v);
        const hasInvalid = arr.some((x) => !optValues.includes(x));
        if (hasInvalid) { errors.push(`"${f.label}" has an unknown option`); return; }
        if (arr.length > optValues.length) { errors.push(`"${f.label}" has too many selections`); return; }
        // Dedupe AND reorder to option order (never the client's own order).
        const set = new Set(arr);
        clean[f.key] = optValues.filter((ov) => set.has(ov));
        break;
      }
      case 'table': {
        const rows = Array.isArray(v) ? v : [];
        const cols = f.columns || [];
        const firstColKey = cols[0] && cols[0].key;
        const maxRows = f.maxRows || LIMITS.maxEquipmentRows;
        const cleanRows = [];
        let tableBad = false;
        for (const row of rows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
          const firstVal = row[firstColKey];
          // Rows lacking the first column are silently DROPPED (not an error).
          if (firstVal == null || String(firstVal).trim() === '') continue;
          const cleanRow = {};
          let rowBad = false;
          for (const col of cols) {
            const cv = row[col.key];
            if (col.type === 'number') {
              if (cv == null || cv === '') continue;
              if (typeof cv !== 'number' || !Number.isFinite(cv)) { rowBad = true; break; }
              const min = (col.min != null) ? col.min : 0;
              const max = (col.max != null) ? col.max : 1e6;
              if (cv < min || cv > max) { rowBad = true; break; }
              cleanRow[col.key] = cv;
            } else if (col.type === 'select') {
              const s = (typeof cv === 'string') ? cv : '';
              if (!s) continue;
              const optValues = _optionEntries(col.options).map((o) => o.v);
              if (!optValues.includes(s)) { rowBad = true; break; }
              cleanRow[col.key] = s;
            } else {
              let s = (typeof cv === 'string') ? stripText(cv, { multiline: false }) : '';
              if (s.length > LIMITS.maxCellChars) s = s.slice(0, LIMITS.maxCellChars);
              if (s) cleanRow[col.key] = s;
            }
          }
          if (rowBad) { tableBad = true; continue; }
          cleanRows.push(cleanRow);
        }
        if (tableBad) { errors.push(`"${f.label}" has an invalid cell value`); return; }
        if (cleanRows.length > maxRows) { errors.push(`"${f.label}" has too many rows`); return; }
        if (cleanRows.length === 0) { if (f.required) errors.push(`"${f.label}" is required`); return; }
        clean[f.key] = cleanRows;
        break;
      }
      default:
        break;
    }
  });

  return { ok: errors.length === 0, errors, clean };
}

// ──────────────────────────────────────────────────────────────────────────
//  validatePhotoList — §2.0. Ownership/group/caption checks against the
//  draft's OWN recorded photos (never trusts the client's group/caption for
//  a photoId it did not itself mint via cirUploadPhoto).
// ──────────────────────────────────────────────────────────────────────────

function validatePhotoList(formDef, rawPhotos, draftPhotos) {
  const errors = [];
  const clean = [];
  const draft = (draftPhotos && typeof draftPhotos === 'object') ? draftPhotos : {};
  const arr = Array.isArray(rawPhotos) ? rawPhotos : [];

  if (arr.length > LIMITS.maxPhotos) {
    return { ok: false, errors: [`Up to ${LIMITS.maxPhotos} photos per brief.`], clean: [] };
  }

  const groupKeys = _photoGroupKeys(formDef);
  const seen = new Set();

  arr.forEach((p) => {
    if (!p || typeof p !== 'object') { errors.push('Invalid photo entry.'); return; }
    const photoId2 = p.photoId;
    if (typeof photoId2 !== 'string' || !/^p_[0-9a-f]{12}$/.test(photoId2)) { errors.push('Invalid photo id.'); return; }
    if (seen.has(photoId2)) { errors.push(`Duplicate photo "${photoId2}".`); return; }
    seen.add(photoId2);
    const d = draft[photoId2];
    if (!d) { errors.push(`Photo "${photoId2}" was not found in your upload session.`); return; }
    const group = p.group;
    if (typeof group !== 'string' || !groupKeys.includes(group)) { errors.push(`Photo "${photoId2}" has an invalid group.`); return; }
    if (group !== d.group) { errors.push(`Photo "${photoId2}" group does not match its upload.`); return; }
    let caption = (typeof p.caption === 'string') ? stripText(p.caption, { multiline: false }) : '';
    if (caption.length > LIMITS.maxCaption) caption = caption.slice(0, LIMITS.maxCaption);
    clean.push({
      photoId: photoId2, group, caption,
      bytes: d.bytes, width: d.width, height: d.height,
      path: d.path, uploadedAt: d.uploadedAt,
    });
  });

  return { ok: errors.length === 0, errors, clean };
}

// ──────────────────────────────────────────────────────────────────────────
//  validateJpegDataUrl — magic + EOI + size, attacker bytes never trusted.
// ──────────────────────────────────────────────────────────────────────────

const JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,';

function validateJpegDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(JPEG_DATA_URL_PREFIX)) {
    return { ok: false, bytes: 0, buf: null, error: 'Photo must be a JPEG image.' };
  }
  let buf;
  try {
    buf = Buffer.from(dataUrl.slice(JPEG_DATA_URL_PREFIX.length), 'base64');
  } catch (e) {
    return { ok: false, bytes: 0, buf: null, error: 'Photo could not be read.' };
  }
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) {
    return { ok: false, bytes: buf.length, buf: null, error: 'Photo is not a valid JPEG.' };
  }
  if (buf[buf.length - 2] !== 0xFF || buf[buf.length - 1] !== 0xD9) {
    return { ok: false, bytes: buf.length, buf: null, error: 'Photo file looks incomplete.' };
  }
  if (buf.length < LIMITS.minPhotoBytes || buf.length > LIMITS.maxPhotoBytes) {
    return { ok: false, bytes: buf.length, buf: null, error: 'Photo size is out of range.' };
  }
  return { ok: true, bytes: buf.length, buf, error: null };
}

// ──────────────────────────────────────────────────────────────────────────
//  botCheck / fingerprintDay
// ──────────────────────────────────────────────────────────────────────────

function botCheck(opts) {
  const o = opts || {};
  const hp = String(o.honeypot == null ? '' : o.honeypot).trim();
  if (hp) return { bot: true, reason: 'honeypot' };
  const draftCreatedMs = Number(o.draftCreatedMs);
  const nowMs = Number(o.nowMs);
  if (!Number.isFinite(draftCreatedMs) || !Number.isFinite(nowMs) || (nowMs - draftCreatedMs) < LIMITS.minFillMs) {
    return { bot: true, reason: 'too_fast' };
  }
  return { bot: false, reason: null };
}

/** sha256(lower(trim(email)) + '|' + digitsOnly(phone)) + '|' + manilaDate —
 *  the trailing Manila-date segment is plain text (not hashed), so the
 *  duplicate-guard query (`where('fingerprintDay','==',fpDay)`) is exact and
 *  the digest alone never links two different days. */
function fingerprintDay(email, phone, manilaDateStr) {
  const e = String(email == null ? '' : email).trim().toLowerCase();
  const p = String(phone == null ? '' : phone).replace(/\D/g, '');
  const hash = crypto.createHash('sha256').update(e + '|' + p).digest('hex');
  return hash + '|' + String(manilaDateStr == null ? '' : manilaDateStr);
}

// ──────────────────────────────────────────────────────────────────────────
//  buildSummary / buildNotification
// ──────────────────────────────────────────────────────────────────────────

function buildSummary(formDef, clean, photoCount) {
  const keys = (formDef && formDef.summaryKeys) || {};
  const out = {};
  Object.keys(keys).forEach((outKey) => {
    const fieldKey = keys[outKey];
    const v = clean ? clean[fieldKey] : undefined;
    if (v == null) out[outKey] = '';
    else if (typeof v === 'number') out[outKey] = String(v);
    else if (typeof v === 'string') out[outKey] = v;
    else out[outKey] = '';
  });
  out.photoCount = Number.isFinite(photoCount) ? photoCount : 0;
  return out;
}

/** Plain emoji only (never emojiIcon()); every interpolated, attacker-supplied
 *  string is stripped of '<' and control chars so the OS push banner (which
 *  renders this text RAW, unlike the escHtml()'d in-app inbox) can never show
 *  a literal "<script>" a client typed into company/name/business type. */
function _notifSafe(s) {
  return String(s == null ? '' : s).replace(/[<\x00-\x1F\x7F]/g, '').trim();
}

function buildNotification(sub) {
  const doc = sub || {};
  const summary = doc.summary || {};
  const ref = doc.refNo || '';
  const company = _notifSafe(summary.company);
  const name = _notifSafe(summary.name);
  const bizType = _notifSafe(summary.bizType);
  const budget = _notifSafe(summary.budget);

  let title = `📥 New client brief — ${company || name || 'unnamed client'}`;
  if (title.length > 200) title = title.slice(0, 200);

  let body = `${name || 'A prospective client'} · ${bizType || 'business type not given'} · ${budget || 'budget not given'} · Ref ${ref}. Open Sales → Briefs.`;
  if (body.length > 2000) body = body.slice(0, 2000);

  return { title, body, icon: '📥', type: 'client_info_request', link: 'dept:Sales' };
}

function privacyNoticeSha256() {
  return crypto.createHash('sha256').update(JSON.stringify(PRIVACY_NOTICE.sections)).digest('hex');
}

module.exports = {
  FORMS,
  PRIVACY_NOTICE,
  LIMITS,
  RATE,
  refNo,
  photoId,
  draftPath,
  finalPath,
  stripText,
  validateAnswers,
  validatePhotoList,
  validateJpegDataUrl,
  botCheck,
  fingerprintDay,
  buildSummary,
  buildNotification,
  privacyNoticeSha256,
};
