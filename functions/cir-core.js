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
const { FORMS, PRIVACY_NOTICE, NOTICES, LIMITS } = require('./cir-forms');

// ──────────────────────────────────────────────────────────────────────────
//  Form and notice lookups — OWN keys only. `FORMS[formId]` on a plain object
//  also resolves 'constructor', 'toString', '__proto__' … to a truthy
//  Object.prototype member, which every `if (!formDef)` guard would then
//  accept as a form. A caller-supplied id is only ever looked up through here.
// ──────────────────────────────────────────────────────────────────────────
const _hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The form definition for `formId`, or null (never an inherited member). */
function getForm(formId) {
  return (typeof formId === 'string' && _hasOwn(FORMS, formId)) ? FORMS[formId] : null;
}

/** The privacy notice a consent was given against — `version` must be one the
 *  server knows (the current notice or a kept legacy one) — as
 *  { version, sha256 } where sha256 is of THAT notice's sections, so the stored
 *  consent record matches the text the visitor was actually shown. null when
 *  the version is unknown (a stale or forged page → "reload"). */
function noticeFor(version) {
  if (typeof version !== 'string' || !_hasOwn(NOTICES, version)) return null;
  return { version, sha256: crypto.createHash('sha256').update(JSON.stringify(NOTICES[version].sections)).digest('hex') };
}

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

/** The answerable (non-photo) fields of one section. */
function _sectionFields(sec) {
  return (sec && sec.fields ? sec.fields : []).filter((f) => f.type !== 'photos');
}

/** Does this section apply, given the answers collected so far? A section with
 *  no `when` always applies; one with `when: { key, in: [...] }` applies only
 *  when the (already validated) controlling answer is one of the listed values.
 *  Exported: the staff screen's walker applies the SAME rule to a stored brief. */
function sectionApplies(sec, answers) {
  const w = sec && sec.when;
  if (!w) return true;
  const v = answers ? answers[w.key] : undefined;
  return typeof v === 'string' && Array.isArray(w.in) && w.in.indexOf(v) !== -1;
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
  const fieldsByKey = Object.create(null);   // no inherited 'constructor' / '__proto__' / 'toString' "fields"
  fields.forEach((f) => { fieldsByKey[f.key] = f; });

  // Unknown-key check — every raw key must belong to a real (non-photos) field
  // of the WHOLE form (all conditional sections included).
  Object.keys(raw).forEach((k) => {
    if (!fieldsByKey[k]) errors.push(`Unknown field "${k}"`);
  });

  const validateField = (f) => {
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
  };

  // Pass 1 — the sections that apply to every project (no `when`), in definition order.
  const sections = (formDef && formDef.sections) ? formDef.sections : [];
  sections.forEach((sec) => { if (!sec.when) _sectionFields(sec).forEach(validateField); });

  // Pass 2 — the conditional sections. One that applies to the submitted type is
  // validated like any other (its `required` fields are required NOW); one that
  // does not is rejected if the payload carries ANY of its keys — a conditional
  // answer is accepted only for the project type it belongs to, and is never
  // silently dropped (the page never sends one, so only a stale/forged payload can).
  sections.forEach((sec) => {
    if (!sec.when) return;
    if (sectionApplies(sec, clean)) { _sectionFields(sec).forEach(validateField); return; }
    _sectionFields(sec).forEach((f) => {
      if (Object.prototype.hasOwnProperty.call(raw, f.key)) errors.push(`"${f.label}" does not apply to this project type`);
    });
  });

  // Form-level "at least one of these" rules (e.g. a mobile number OR an email).
  (formDef && Array.isArray(formDef.requireOneOf) ? formDef.requireOneOf : []).forEach((g) => {
    const keys = g && Array.isArray(g.keys) ? g.keys : [];
    if (keys.length && !keys.some((k) => Object.prototype.hasOwnProperty.call(clean, k))) {
      errors.push(g.message || `One of ${keys.join(', ')} is required`);
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

/** One field's value as summary text: a number as its digits, a string as is — except a `select`, whose
 *  OPTION LABEL is stored (the list should read "Hospital or clinic", not a key) — and a `chips` field as its
 *  labels joined by ", ". Anything else (or a blank) is ''. For a form whose option values equal their labels
 *  (v1) this is the old behaviour exactly. */
function _summaryText(formDef, clean, fieldKey) {
  const v = clean ? clean[fieldKey] : undefined;
  if (v == null) return '';
  const f = _allFields(formDef).find((x) => x.key === fieldKey);
  const label = (val) => {
    const hit = f ? _optionEntries(f.options).find((o) => o.v === val) : null;
    return hit ? hit.l : val;
  };
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return (f && f.type === 'select') ? label(v) : v;
  if (Array.isArray(v) && f && f.type === 'chips') return v.map(label).join(', ');
  return '';
}

/** summaryKeys: { outKey: 'field_key' | { join: [keys] } | { first: [keys] } } — see js/cir-forms.js. */
function buildSummary(formDef, clean, photoCount) {
  const keys = (formDef && formDef.summaryKeys) || {};
  const out = {};
  Object.keys(keys).forEach((outKey) => {
    const spec = keys[outKey];
    if (typeof spec === 'string') { out[outKey] = _summaryText(formDef, clean, spec); return; }
    const list = spec && Array.isArray(spec.join) ? spec.join : (spec && Array.isArray(spec.first) ? spec.first : null);
    if (!list) { out[outKey] = ''; return; }
    const parts = list.map((k) => _summaryText(formDef, clean, k)).filter((t) => t !== '');
    out[outKey] = spec.join ? parts.join(', ') : (parts[0] || '');
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
  const projectType = _notifSafe(summary.bizType);    // v2: "Hospital or clinic"; v1: "Bakery / pastry"
  const where = _notifSafe(summary.location) || _notifSafe(summary.budget);   // v2: "Quezon City, Metro Manila"; v1 has no location, so its budget

  let title = `📥 New client brief — ${company || name || 'unnamed client'}`;
  if (title.length > 200) title = title.slice(0, 200);

  let body = `${name || 'A prospective client'} · ${projectType || 'project type not given'} · ${where || 'location not given'} · Ref ${ref}. Open Sales → Briefs.`;
  if (body.length > 2000) body = body.slice(0, 2000);

  return { title, body, icon: '📥', type: 'client_info_request', link: 'dept:Sales' };
}

function privacyNoticeSha256() {
  return crypto.createHash('sha256').update(JSON.stringify(PRIVACY_NOTICE.sections)).digest('hex');
}

module.exports = {
  FORMS,
  PRIVACY_NOTICE,
  NOTICES,
  LIMITS,
  RATE,
  getForm,
  noticeFor,
  sectionApplies,
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
