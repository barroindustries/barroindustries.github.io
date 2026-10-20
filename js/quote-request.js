/* js/quote-request.js — the public "Get a quote" flow on /catalogue/ (PUBLIC-QUOTE-REQUEST-SPEC.md §3, §7.3).

   What it does: every "Get a quote" call to action opens a 3-step intake; each catalogue card gets an "Add to quote"
   button (custom W x D x H in mm defaulting to the product's own default, quantity, the product's built-in options,
   a note); a tray shows the item count and an ESTIMATE RANGE; a review sheet shows the list, the range and the
   disclaimers; Submit sends the request and shows a receipt (QR-yymmdd-XXXXXX). Staff work it in Sales › Quote requests.

   THE RULE (owner ruling R1): the browser NEVER holds a price. There is no price, rate, formula or per-item figure in
   this file, in the data island it reads (#qr-catalogue: id, name, unit, default size, option labels), in the draft it
   keeps on the visitor's own device, or in any response it receives. The only figure that ever arrives is the whole
   basket's rounded {low, high}, computed by the server (qrEstimate), after a minimum-basket gate. It is printed with a
   local formatter and never stored. CHECK 9 in scripts/ci-invariants.sh fails the build if this file ever carries a
   price field name, a formula field name, a peso amount, or a reference to the pricing engine.

   Safety: the page's CSP forbids inline script and inline style, so this file builds every node with createElement +
   textContent (never innerHTML) and styles nothing by attribute — all looks are classes in css/quote-request.css.
   Visitor-typed text and island text can therefore never be parsed as HTML. The draft in localStorage
   (barro-qr-draft-v1) is treated as untrusted on load: every line is re-validated against the island and re-derived
   (names/units come from the island, never from storage). No analytics, no cookies, no third-party script beyond the
   two pinned Firebase compat scripts that carry the callables.

   QA seam: ?mock=1 resolves every call locally (no Firebase init); sim=gate|disabled|ratelimit|error|dup|slow|stale|
   expired|unauth exercises each state. It never reaches a backend and is harmless in production.

   Coexists with js/catalogue.js: it only ADDS a button inside each .cat-card[data-id] and a data-qr-count attribute;
   it never changes a card's classes, text, or the search's .is-hidden handling. */
(function () {
  'use strict';

  var doc = document;
  var D = window.QR_DEF;
  var root = doc.getElementById('qr-root');
  var islandEl = doc.getElementById('qr-catalogue');
  if (!D || !D.LIMITS || !root || !islandEl) {
    try { console.error('[quote-request] disabled: missing definition, mount point or catalogue data'); } catch (_) { /* nothing to do */ }
    return;
  }
  var LIMITS = D.LIMITS, COPY = D.COPY, INTAKE = D.INTAKE;

  // ── the catalogue data island (price-free by construction) ───────────────
  var island;
  try { island = JSON.parse(islandEl.textContent); } catch (e) { island = null; }
  if (!island || !Array.isArray(island.products)) {
    try { console.error('[quote-request] disabled: the catalogue data island is unreadable'); } catch (_) { /* nothing to do */ }
    return;
  }
  var byId = Object.create(null);
  island.products.forEach(function (p) {
    if (p && typeof p.id === 'string' && typeof p.name === 'string') byId[p.id] = p;
  });

  // ── config ────────────────────────────────────────────────────────────────
  // Firebase config is public by design (rules are the boundary) — copied verbatim from sales/clientinformationrequest/.
  // REGION is mandatory: without it the SDK targets us-central1, where these functions do not exist.
  var FIREBASE_CFG = {
    apiKey: 'AIzaSyA1-fDeMCxTsUm29O49l954Ez5BqbyHijk',
    authDomain: 'barro-industries.firebaseapp.com',
    projectId: 'barro-industries',
    storageBucket: 'barro-industries.firebasestorage.app',
    messagingSenderId: '700081895848',
    appId: '1:700081895848:web:265511313b4ff74575459d'
  };
  var REGION = 'asia-east1';
  var DRAFT_KEY = 'barro-qr-draft-v1';
  var qs = new URLSearchParams(location.search);
  var MOCK = qs.get('mock') === '1';
  var SIM = MOCK ? (qs.get('sim') || '') : '';
  var PHONE = '0927 683 6300';

  // ── tiny helpers ──────────────────────────────────────────────────────────
  var DIMS = ['W', 'D', 'H'];
  var DIM_NAME = { W: 'Length', D: 'Width', H: 'Height' };
  var DIM_LABEL = { W: 'L', D: 'W', H: 'H' };            // the Quote Builder's own L / W / H labelling of W / D / H
  var idSeq = 0;
  function nid(prefix) { idSeq++; return 'qr-' + prefix + idSeq; }
  function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function delay(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  // Build a node. Strings become TEXT NODES — nothing here ever parses HTML.
  function add(n, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(n, k); }); return; }
    n.appendChild(typeof kid === 'object' ? kid : doc.createTextNode(String(kid)));
  }
  function el(tag, attrs) {
    var n = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = String(v);
        else if (k === 'value') n.value = v;
        else if (k === 'checked') n.checked = !!v;
        else if (k === 'selected') n.selected = !!v;
        else n.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function on(n, ev, fn) { n.addEventListener(ev, fn); return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  // The one place a peso sign is written: the server's rounded figures, never stored, never computed.
  function peso(n) { return '₱' + Number(n).toLocaleString('en-PH'); }
  function manilaToday() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }
  function addYearsIso(iso, n) {
    var d = new Date(Date.UTC(Number(iso.slice(0, 4)) + n, Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
    return d.toISOString().slice(0, 10);
  }
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m[2], 10) - 1] || '';
    return parseInt(m[3], 10) + ' ' + mon + ' ' + m[1];
  }
  function normaliseMobile(s) {
    if (typeof s !== 'string') return null;
    var t = s.replace(/[\s\-.()]/g, '');
    if (/^09\d{9}$/.test(t)) return t;
    var m = /^(?:\+?63)(9\d{9})$/.exec(t);
    return m ? '0' + m[1] : null;
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function optLabel(field, v) {
    var o = INTAKE[field].options.filter(function (x) { return x.v === v; })[0];
    return o ? o.l : '';
  }

  // ── product kinds, decided from the island alone ──────────────────────────
  function dimKeys(p) { return DIMS.filter(function (k) { return p.dims && typeof p.dims[k] === 'number' && isFinite(p.dims[k]) && p.dims[k] > 0; }); }
  function isRunProduct(p) { return !dimKeys(p).length && p.unit === 'run'; }
  // Mirrors the server's rule: the largest custom size is min(default x factor, max(abs cap, default)) — a default above the cap can only
  // shrink — and a dimension whose maximum is under the minimum size is FIXED (a 30 mm standard height has no valid custom value).
  function maxDim(p, k) { var def = p.dims[k]; return Math.min(def * LIMITS.maxDimFactor, Math.max(LIMITS.maxDimAbsMm[k], def)); }
  function isFixedDim(p, k) { return maxDim(p, k) < LIMITS.minDimMm; }
  function specDefault(sp) { return sp.options.indexOf(sp.default) >= 0 ? sp.default : sp.options[0]; }
  function defaultSize(p) { var ks = dimKeys(p); if (!ks.length) return null; var o = {}; ks.forEach(function (k) { o[k] = p.dims[k]; }); return o; }
  function defaultSpecs(p) { return (p.specs || []).map(function (sp) { return { label: sp.label, value: specDefault(sp) }; }); }
  function sizeText(it) {
    if (it.runs != null) return it.runs + ' run' + (it.runs === 1 ? '' : 's');
    if (!it.size) return 'Standard size';
    var parts = [];
    DIMS.forEach(function (k) { if (it.size[k] != null) parts.push(DIM_LABEL[k] + it.size[k]); });
    return parts.join(' × ') + ' mm';
  }
  function isCustom(p, it) {
    if (!it.size) return false;
    return dimKeys(p).some(function (k) { return it.size[k] !== p.dims[k]; });
  }
  function lineKey(it) { return JSON.stringify([it.id, it.size, it.runs, it.specs]); }
  // One product, ONE multiplier: the units of a product (qty x runs) across ALL of its lines are capped at LIMITS.maxQtyPerProduct
  // — the server refuses more, because many lines of one product would turn the rounded range into an exact-price oracle.
  function unitsOf(it) { return it.runs != null ? it.qty * it.runs : it.qty; }
  function productUnits(id, exceptUid) {
    return draft.items.reduce(function (n, it) { return it.id === id && it.uid !== exceptUid ? n + unitsOf(it) : n; }, 0);
  }
  function capUnits(items) {
    var used = Object.create(null), out = [], dropped = 0;
    items.forEach(function (it) {
      var left = LIMITS.maxQtyPerProduct - (used[it.id] || 0);
      if (it.runs != null) {
        if (left < 1) { dropped++; return; }
        if (it.runs > left) { it.runs = left; dropped++; }
        used[it.id] = (used[it.id] || 0) + it.runs; out.push(it); return;
      }
      if (left < 1) { dropped++; return; }
      if (it.qty > left) { it.qty = left; dropped++; }
      used[it.id] = (used[it.id] || 0) + it.qty; out.push(it);
    });
    return { items: out, dropped: dropped };
  }

  // ═══════════════════════════ DRAFT (localStorage; never a price) ═══════════════════════════
  var draft = freshDraft();
  function freshDraft() {
    return { v: 1, intake: null, intakeDone: false, contact: null, consent: null, items: [], sessionToken: null, sessionCreatedAtIso: null, sessionLocalAtMs: null, startedAtMs: Date.now(), savedAtMs: 0 };
  }
  function ls(fn) { try { return fn(window.localStorage); } catch (_) { return undefined; } }

  // The stored draft is untrusted (the visitor, or an extension, can edit it): rebuild every line from the island.
  function sanitizeItem(raw) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !byId[raw.id]) return null;
    var p = byId[raw.id];
    var qty = Number(raw.qty);
    if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 1 || qty > LIMITS.maxQtyPerLine) qty = 1;
    var out = { uid: typeof raw.uid === 'string' ? raw.uid.slice(0, 40) : uid(), id: p.id, name: p.name, cat: p.cat || '', unit: p.unit || 'pc', size: null, runs: null, specs: defaultSpecs(p), qty: qty, note: '' };
    var ks = dimKeys(p);
    if (ks.length) {
      out.size = defaultSize(p);
      if (isObj(raw.size)) ks.forEach(function (k) {
        var v = raw.size[k];
        if (v === p.dims[k]) return;
        if (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v % LIMITS.dimStepMm === 0 && v >= LIMITS.minDimMm && v <= maxDim(p, k)) out.size[k] = v;
      });
    } else if (isRunProduct(p)) {
      var r = Number(raw.runs);
      out.runs = (isFinite(r) && Math.floor(r) === r && r >= 1 && r <= LIMITS.maxRuns) ? r : 1;
      out.qty = 1;
    }
    if (Array.isArray(raw.specs)) {
      (p.specs || []).forEach(function (sp, i) {
        var hit = raw.specs.filter(function (s) { return isObj(s) && s.label === sp.label && typeof s.value === 'string' && sp.options.indexOf(s.value) >= 0; })[0];
        if (hit) out.specs[i] = { label: sp.label, value: hit.value };
      });
    }
    if (typeof raw.note === 'string') out.note = raw.note.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, LIMITS.maxNote);
    return out;
  }
  function sanitizeText(v, max) { return typeof v === 'string' ? v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, max) : ''; }
  function loadDraft() {
    var raw = ls(function (s) { return s.getItem(DRAFT_KEY); });
    if (!raw) return;
    var d;
    try { d = JSON.parse(raw); } catch (_) { return; }
    if (!isObj(d) || d.v !== 1) return;
    var out = freshDraft();
    var dropped = 0;
    if (Array.isArray(d.items)) d.items.slice(0, LIMITS.maxItems).forEach(function (x) { var it = sanitizeItem(x); if (it) out.items.push(it); else dropped++; });
    var capped = capUnits(out.items); out.items = capped.items;
    if (isObj(d.intake)) {
      var i = d.intake;
      out.intake = { need: sanitizeText(i.need, 40), needOther: sanitizeText(i.needOther, 120), useFor: sanitizeText(i.useFor, 40), useForOther: sanitizeText(i.useForOther, 120), entityType: sanitizeText(i.entityType, 20), targetDate: sanitizeText(i.targetDate, 10), targetFlexible: i.targetFlexible === true, address: sanitizeText(i.address, INTAKE.address.max), notes: sanitizeText(i.notes, INTAKE.notes.max) };
    }
    if (isObj(d.contact)) {
      var c = d.contact;
      out.contact = { name: sanitizeText(c.name, INTAKE.name.max), mobile: sanitizeText(c.mobile, 40), email: sanitizeText(c.email, INTAKE.email.max), company: sanitizeText(c.company, INTAKE.company.max) };
    }
    out.intakeDone = d.intakeDone === true && !!out.intake && !!out.contact;
    if (isObj(d.consent) && d.consent.agreed === true && d.consent.noticeVersion === D.PRIVACY_NOTICE.version) out.consent = { agreed: true, noticeVersion: d.consent.noticeVersion };
    if (typeof d.sessionToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(d.sessionToken) && typeof d.sessionCreatedAtIso === 'string') {
      var age = Date.now() - Date.parse(d.sessionCreatedAtIso);
      if (isFinite(age) && age < LIMITS.sessionTtlMs - 3600e3) {
        out.sessionToken = d.sessionToken; out.sessionCreatedAtIso = d.sessionCreatedAtIso;
        // the stored local clock is only believed when it is a real moment in the past (a clock corrected backwards, or a tampered
        // draft, must not leave "Sending…" waiting for an hour)
        var localAt = d.sessionLocalAtMs;
        out.sessionLocalAtMs = (typeof localAt === 'number' && isFinite(localAt) && localAt <= Date.now() && localAt >= Date.now() - LIMITS.sessionTtlMs) ? localAt : Date.now() - Math.max(0, age);
      }
    }
    if (typeof d.startedAtMs === 'number' && isFinite(d.startedAtMs)) out.startedAtMs = Math.min(d.startedAtMs, Date.now());
    draft = out;
    if (dropped) pendingToast = 'Some items in your saved quote are no longer in the catalogue and were removed.';
    else if (capped.dropped) pendingToast = 'Some quantities in your saved quote were reduced to the limit of ' + LIMITS.maxQtyPerProduct + ' per product.';
  }
  var saveTimer = 0;
  function saveDraftNow() {
    clearTimeout(saveTimer);
    draft.savedAtMs = Date.now();
    ls(function (s) {
      // items are stored as the visitor chose them; name/cat/unit are re-derived on load. No prices, no estimate, no range.
      s.setItem(DRAFT_KEY, JSON.stringify(draft));
    });
  }
  function saveDraft() { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraftNow, 300); }
  function clearDraft() { clearTimeout(saveTimer); ls(function (s) { s.removeItem(DRAFT_KEY); }); }
  var pendingToast = '';

  // ═══════════════════════════ BACKEND SEAM (real callables, or ?mock=1) ═══════════════════════════
  var fbReady = false, fns = {};
  function ensureFirebase() {
    if (fbReady) return true;
    if (!window.firebase || !window.firebase.initializeApp) return false;
    try {
      window.firebase.initializeApp(FIREBASE_CFG);
      var f = window.firebase.app().functions(REGION);
      ['qrStartSession', 'qrEstimate', 'qrSubmit'].forEach(function (n) { fns[n] = f.httpsCallable(n); });
      fbReady = true;
    } catch (e) { return false; }
    return true;
  }
  // The SDK may or may not prefix the code ('functions/resource-exhausted'); the page switches on the bare code.
  function normalizeError(e) {
    var code = String((e && e.code) || 'internal').replace(/^functions\//, '');
    var details = e && e.details && isObj(e.details) ? e.details : null;
    return { code: code, message: (e && e.message) || 'Something went wrong. Please try again.', details: details };
  }
  function call(name, payload) {
    if (!ensureFirebase()) return Promise.reject({ code: 'unavailable', message: 'The quote service could not be reached.' });
    return fns[name](payload).then(function (r) { return r.data; }).catch(function (e) { return Promise.reject(normalizeError(e)); });
  }
  function fakeHash(s) {
    var h = 0, out = '';
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    for (var j = 0; j < 8; j++) { h = (h * 1103515245 + 12345) | 0; out += ('00000000' + (h >>> 0).toString(16)).slice(-8); }
    return out;
  }
  function mockToken() { var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz0123456789-_', s = ''; for (var i = 0; i < 43; i++) s += abc[Math.floor(Math.random() * abc.length)]; return s; }
  var mockSubmitTries = 0, mockSessionNo = 0;
  var Qr = {
    startSession: function () {
      if (MOCK) {
        return delay(300 + Math.random() * 400).then(function () {
          if (SIM === 'error') return Promise.reject({ code: 'unavailable', message: 'Something went wrong on our side — your list is saved on this device. Please try again in a moment.' });
          if (SIM === 'ratelimit') return Promise.reject({ code: 'resource-exhausted', message: 'Too many requests from this connection. Try again in 12 minutes.' });
          mockSessionNo++;
          return { ok: true, sessionToken: mockToken(), serverNow: new Date().toISOString() };
        });
      }
      return call('qrStartSession', { defVersion: D.VERSION });
    },
    estimate: function (payload) {
      if (MOCK) {
        return delay(350 + Math.random() * 350 + (SIM === 'slow' ? 3000 : 0)).then(function () {
          if (SIM === 'ratelimit') return Promise.reject({ code: 'resource-exhausted', message: 'Estimate paused for today — you can still submit your list.' });
          if (SIM === 'error') return Promise.reject({ code: 'unavailable', message: 'x' });
          var items = payload.items || [];
          var custom = items.filter(function (it) { var p = byId[it.id]; return p && it.size && dimKeys(p).some(function (k) { return it.size[k] !== p.dims[k]; }); }).length;
          var shown = SIM === 'gate' ? false : (SIM === 'disabled' ? false : items.length >= 2);
          var notes = [COPY.vatExclusive, COPY.deliveryExcluded];
          if (payload.entityType === 'government') notes.push(COPY.governmentNote);
          if (custom) notes.push(COPY.customSizeNote);
          return {
            ok: true, shown: shown, reason: shown ? null : (SIM === 'disabled' ? 'disabled' : 'gate'),
            low: shown ? 95000 : null, high: shown ? 125000 : null, step: shown ? 5000 : null,
            currency: 'PHP', vatBasis: 'exclusive', deliveryIncluded: false,
            pricedCount: items.length, reviewCount: 0, customSizeCount: custom, notes: notes,
            basketHash: fakeHash(JSON.stringify(items)), estimateVersion: D.ESTIMATE.version, serverNow: new Date().toISOString()
          };
        });
      }
      return call('qrEstimate', payload);
    },
    submit: function (payload) {
      if (MOCK) {
        return delay(400 + Math.random() * 500 + (SIM === 'slow' ? 3000 : 0)).then(function () {
          mockSubmitTries++;
          if (SIM === 'ratelimit') return Promise.reject({ code: 'resource-exhausted', message: 'Too many requests from this connection. Try again in 12 minutes.' });
          if (SIM === 'dup') return Promise.reject({ code: 'already-exists', message: 'We already received a quote request from this e-mail and number today. Call ' + PHONE + ' to add to it.' });
          if (SIM === 'error') return Promise.reject({ code: 'unavailable', message: 'x' });
          if (SIM === 'expired' && mockSubmitTries === 1) return Promise.reject({ code: 'failed-precondition', message: 'Your session expired — reload the page (your list is saved on this device).' });
          if (SIM === 'unauth' && mockSubmitTries === 1) return Promise.reject({ code: 'unauthenticated', message: 'Please reload the page.' });
          if (SIM === 'stale') return Promise.reject({ code: 'invalid-argument', message: 'An item in your list is no longer in the catalogue — remove it and try again.', details: { itemIds: [payload.items[0].id] } });
          var now = Date.now();
          var iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
          var abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', suf = '';
          for (var i = 0; i < 6; i++) suf += abc[Math.floor(Math.random() * abc.length)];
          var shown = payload.items.length >= 2 && SIM !== 'gate' && SIM !== 'disabled';
          return { ok: true, refNo: 'QR-' + iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) + '-' + suf, receivedAt: new Date(now).toISOString(), submittedOnManila: iso, estimate: shown ? { low: 95000, high: 125000 } : null };
        });
      }
      return call('qrSubmit', payload);
    }
  };

  // ── sessions: created lazily the first time one is needed; the token lives in the draft ──
  var sessionPromise = null;
  function sessionFresh() { return !!draft.sessionToken; }
  function ensureSession() {
    if (draft.sessionToken) return Promise.resolve(draft.sessionToken);
    if (sessionPromise) return sessionPromise;
    sessionPromise = Qr.startSession().then(function (r) {
      draft.sessionToken = r.sessionToken;
      draft.sessionCreatedAtIso = r.serverNow;
      draft.sessionLocalAtMs = Date.now();             // measured on THIS clock, from the moment the server answered
      saveDraftNow();
      sessionPromise = null;
      return r.sessionToken;
    }, function (e) { sessionPromise = null; return Promise.reject(e); });
    return sessionPromise;
  }
  function dropSession() { draft.sessionToken = null; draft.sessionCreatedAtIso = null; draft.sessionLocalAtMs = null; saveDraftNow(); }
  function isSessionError(e) { return e && (e.code === 'unauthenticated' || (e.code === 'failed-precondition' && /session expired/i.test(e.message || ''))); }
  // one retry with a fresh session, exactly as the spec's error table says
  function withSession(fn) {
    return ensureSession().then(fn).catch(function (e) {
      if (isSessionError(e)) { dropSession(); return ensureSession().then(fn); }
      return Promise.reject(e);
    });
  }

  // ═══════════════════════════ ESTIMATE (server only; in memory only) ═══════════════════════════
  var est = { status: 'idle', data: null };          // idle | pending | ok | error | paused | reload
  var estTimer = 0, estSeq = 0;
  var estCache = Object.create(null);                // basketKey -> response; memory only, never localStorage
  var lastShown = null;                              // { low, high, basketHash } of the last figure the page DISPLAYED (sent at submit)
  function entityNow() { return draft.intake && draft.intake.entityType === 'government' ? 'government' : 'private'; }
  function basketKey() {
    var rows = draft.items.map(function (it) { return JSON.stringify([it.id, it.size, it.runs, it.specs, it.qty]); }).sort();
    return entityNow() + '|' + rows.join('~');
  }
  function itemPayload(it) { return { id: it.id, qty: it.qty, size: it.size, runs: it.runs, specs: it.specs, note: it.note }; }
  // An estimate does not need the free-text note (it never changes a price), and nothing is sent before the visitor agrees to send.
  function estimateItemPayload(it) { return { id: it.id, qty: it.qty, size: it.size, runs: it.runs, specs: it.specs }; }
  function setEst(status, data) { est = { status: status, data: data || null }; renderTray(); if (sheet.kind === 'review' && sheet.refresh) sheet.refresh(); }
  function scheduleEstimate() {
    clearTimeout(estTimer);
    estSeq++;
    if (!draft.items.length) { lastShown = null; setEst('idle'); return; }
    var key = basketKey();
    if (estCache[key]) { applyEstimate(estCache[key]); return; }
    setEst('pending');
    var mySeq = estSeq;
    estTimer = setTimeout(function () { runEstimate(mySeq, key); }, LIMITS.estimateDebounceMs);
  }
  function applyEstimate(r) {
    lastShown = r.shown ? { low: r.low, high: r.high, basketHash: r.basketHash } : null;
    setEst('ok', r);
  }
  function runEstimate(mySeq, key) {
    var payloadItems = draft.items.map(estimateItemPayload);
    var entity = entityNow();
    withSession(function (token) { return Qr.estimate({ sessionToken: token, defVersion: D.VERSION, entityType: entity, items: payloadItems }); })
      .then(function (r) {
        if (mySeq !== estSeq) return;                 // the basket changed while this was in flight
        estCache[key] = r;
        applyEstimate(r);
      })
      .catch(function (e) {
        if (mySeq !== estSeq) return;
        if (e && e.code === 'resource-exhausted') { setEst('paused'); return; }
        if (e && e.code === 'invalid-argument' && e.details && Array.isArray(e.details.itemIds) && e.details.itemIds.length) { markGone(e.details.itemIds); setEst('error'); return; }
        if (e && e.code === 'failed-precondition' && /updated|reload/i.test(e.message || '') && !isSessionError(e)) { setEst('reload'); return; }
        setEst('error');
      });
  }
  // lines the server says are no longer in the catalogue: flagged in the review sheet and left for the visitor to remove
  function markGone(ids) {
    draft.items.forEach(function (it) { it.gone = ids.indexOf(it.id) >= 0; });
    if (sheet.kind === 'review' && sheet.refreshItems) sheet.refreshItems();
  }

  // The text the tray and the review sheet show for the current estimate state — every string from QR_DEF.COPY or the server.
  function estView() {
    var d = est.data;
    if (est.status === 'idle') return { kind: 'none' };
    if (est.status === 'pending') return { kind: 'msg', text: 'Estimating…' };
    if (est.status === 'paused') return { kind: 'msg', text: 'Estimate paused for a while — you can still submit.' };
    if (est.status === 'reload') return { kind: 'msg', text: 'This page was updated — please reload to see an estimate. You can still submit.' };
    if (est.status === 'error') return { kind: 'msg', text: 'Estimate unavailable right now — you can still submit.' };
    if (d && d.shown) return { kind: 'fig', text: peso(d.low) + ' – ' + peso(d.high), notes: Array.isArray(d.notes) ? d.notes : [] };
    if (d && d.reason === 'disabled') return { kind: 'msg', text: COPY.disabledMessage, notes: Array.isArray(d.notes) ? d.notes.filter(function (n) { return n !== COPY.vatExclusive && n !== COPY.vatInclusive && n !== COPY.deliveryExcluded; }) : [] };
    return { kind: 'msg', text: COPY.gateMessage, notes: Array.isArray(d && d.notes) ? d.notes.filter(function (n) { return n !== COPY.vatExclusive && n !== COPY.vatInclusive && n !== COPY.deliveryExcluded; }) : [] };
  }

  // ═══════════════════════════ PAGE FURNITURE: tray, toast, badges, offline banner ═══════════════════════════
  var trayEl = el('div', { class: 'qr-tray', hidden: true, role: 'region', 'aria-label': 'Your quote' });
  var trayCount = el('div', { class: 'qr-tray-count' });
  var trayEst = el('div', { class: 'qr-tray-est', 'aria-live': 'polite' });
  var trayNote = el('div', { class: 'qr-tray-note' });
  var trayBtn = on(el('button', { type: 'button', class: 'qr-btn qr-btn-primary', text: 'View quote' }), 'click', function () { openReview(trayBtn); });
  trayEl.appendChild(el('div', { class: 'qr-tray-in' }, el('div', { class: 'qr-tray-main' }, trayCount, trayEst, trayNote), trayBtn));
  var toastEl = el('div', { class: 'qr-toast', role: 'status', hidden: true });
  var offlineEl = el('div', { class: 'qr-offline', role: 'status', hidden: true, text: 'You’re offline — your list is safe on this device; sending needs a connection.' });
  var backdrop = el('div', { class: 'qr-backdrop', hidden: true });
  var sheetEl = el('div', { class: 'qr-sheet', hidden: true, role: 'dialog', 'aria-modal': 'true' });
  root.appendChild(trayEl); root.appendChild(toastEl); root.appendChild(offlineEl); root.appendChild(backdrop); root.appendChild(sheetEl);
  if (MOCK) root.appendChild(el('div', { class: 'qr-mock', text: 'MOCK MODE' + (SIM ? ' · ' + SIM : '') }));

  function itemCount() { return draft.items.reduce(function (n, it) { return n + (it.runs != null ? 1 : it.qty); }, 0); }
  function renderTray() {
    var n = draft.items.length;
    var has = n > 0;
    trayEl.hidden = !has;
    doc.documentElement.classList.toggle('qr-has-tray', has);
    if (!has) return;
    var lines = n + ' line' + (n === 1 ? '' : 's') + ' · ' + itemCount() + ' item' + (itemCount() === 1 ? '' : 's');
    trayCount.textContent = lines;
    var v = estView();
    trayEst.className = 'qr-tray-est' + (v.kind === 'fig' ? '' : ' is-msg');
    trayEst.textContent = v.kind === 'fig' ? 'Est. ' + v.text : (v.kind === 'msg' ? v.text : 'Add more items, or view your quote.');
    var note = '';
    if (v.kind === 'fig') {
      var vat = (v.notes || []).filter(function (x) { return x === COPY.vatExclusive || x === COPY.vatInclusive; })[0];
      var extra = [];
      if (entityNow() === 'government') extra.push(COPY.governmentNote);                                  // R7: government = same estimate + procurement note
      var unpriced = est.data && est.data.reviewCount > 0 ? est.data.reviewCount : 0;
      if (unpriced) extra.push(COPY.reviewCount(unpriced));                                              // O6: "N items priced after review."
      note = (vat ? vat + ' ' : '') + COPY.estimateDisclaimer + (extra.length ? ' ' + extra.join(' ') : '');
    }
    trayNote.textContent = note;
    trayNote.hidden = !note;
    var h = trayEl.getBoundingClientRect().height;
    if (h) doc.documentElement.style.setProperty('--qr-tray-h', Math.ceil(h) + 'px');
  }
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3800);
  }
  var cards = [];
  function injectAddButtons() {
    [].slice.call(doc.querySelectorAll('.cat-card[data-id]')).forEach(function (card) {
      var id = card.getAttribute('data-id');
      var p = byId[id];
      if (!p || card.querySelector('.qr-add')) return;
      card.appendChild(el('button', { type: 'button', class: 'qr-add', 'data-id': id, 'aria-label': 'Add to quote: ' + p.name, text: 'Add to quote' }));
      cards.push({ card: card, id: id });
    });
  }
  function renderBadges() {
    var counts = Object.create(null);
    draft.items.forEach(function (it) { counts[it.id] = (counts[it.id] || 0) + (it.runs != null ? 1 : it.qty); });
    cards.forEach(function (c) {
      if (counts[c.id]) c.card.setAttribute('data-qr-count', String(counts[c.id])); else c.card.removeAttribute('data-qr-count');
    });
  }
  function refreshAll() { renderTray(); renderBadges(); }
  var resizeTimer = 0;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderTray, 120); });   // the tray height feeds --qr-tray-h
  function syncOffline() { offlineEl.hidden = !!navigator.onLine; }
  window.addEventListener('online', function () {
    syncOffline();
    if (est.status === 'error' && draft.items.length && !submitting) scheduleEstimate();        // an estimate that failed while offline is retried on reconnect
  });
  window.addEventListener('offline', syncOffline);

  // ═══════════════════════════ SHEETS: focus, scroll lock, inert background ═══════════════════════════
  var sheet = { kind: null, trigger: null, refresh: null, refreshItems: null, onClose: null, closable: true };
  var INERT_SEL = '#site-header, #site-main, #site-footer, .cat-top';
  function setInert(on) {
    // everything inside #site except the mount point, so not even the skip link is reachable behind a dialog
    var site = doc.getElementById('site');
    var targets = site ? [].slice.call(site.children).filter(function (n) { return n !== root && !n.contains(root); }) : [].slice.call(doc.querySelectorAll(INERT_SEL));
    targets.forEach(function (n) { if (on) n.setAttribute('inert', ''); else n.removeAttribute('inert'); });
    if (on) trayEl.setAttribute('inert', ''); else trayEl.removeAttribute('inert');
  }
  // On iOS the on-screen keyboard overlays a fixed bottom sheet instead of resizing it; mirror its height into --qr-kb so the footer
  // buttons stay visible above it (zoomed-in pages are ignored: their visual viewport is smaller for another reason).
  if (window.visualViewport) {
    var vv = window.visualViewport;
    var syncKeyboard = function () {
      var inset = vv.scale && vv.scale > 1.01 ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      doc.documentElement.style.setProperty('--qr-kb', inset + 'px');
    };
    vv.addEventListener('resize', syncKeyboard); vv.addEventListener('scroll', syncKeyboard); syncKeyboard();
  }
  function focusables() {
    return [].slice.call(sheetEl.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])'))
      .filter(function (n) { return ((!n.hidden && n.offsetParent !== null) || n === doc.activeElement) && !n.closest('[inert]'); });
  }
  function openSheet(kind, trigger, opts) {
    var opening = !sheet.kind;
    sheet.kind = kind;
    sheet.refresh = null; sheet.refreshItems = null;
    sheet.onClose = (opts && opts.onClose) || null;
    sheet.closable = !(opts && opts.closable === false);
    if (opening) sheet.trigger = trigger || doc.activeElement;
    backdrop.hidden = false; sheetEl.hidden = false;
    doc.documentElement.classList.add('qr-lock');
    setInert(true);
    sheetEl.setAttribute('data-kind', kind);
  }
  function closeSheet(restoreFocus) {
    if (!sheet.kind) return;
    var cb = sheet.onClose, trig = sheet.trigger;
    sheet.kind = null; sheet.refresh = null; sheet.refreshItems = null; sheet.onClose = null;
    backdrop.hidden = true; sheetEl.hidden = true; clear(sheetEl);
    doc.documentElement.classList.remove('qr-lock');
    setInert(false);
    doc.body.classList.remove('qr-print-receipt');
    if (restoreFocus !== false && trig && doc.contains(trig) && typeof trig.focus === 'function') { try { trig.focus(); } catch (_) { /* nothing to do */ } }
    sheet.trigger = null;
    if (cb) cb();
  }
  on(backdrop, 'click', function () { if (sheet.closable) closeSheet(); });
  doc.addEventListener('keydown', function (e) {
    if (!sheet.kind) return;
    if (e.key === 'Escape' && sheet.closable) { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    var f = focusables();
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1];
    if (!sheetEl.contains(doc.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  function frame(titleText, sub, step) {
    var titleId = nid('t');
    sheetEl.setAttribute('aria-labelledby', titleId);
    clear(sheetEl);
    var closeBtn = sheet.closable ? on(el('button', { type: 'button', class: 'qr-x', 'aria-label': 'Close', text: '\u00D7' }), 'click', function () { closeSheet(); }) : null;
    var h2 = el('h2', { id: titleId, text: titleText, tabindex: '-1' });
    var titleBox = el('div', { class: 'qr-sheet-titlebox' }, step ? el('p', { class: 'qr-step', text: step }) : null, h2, sub ? el('p', { class: 'qr-sheet-sub', text: sub }) : null);
    var head = el('div', { class: 'qr-sheet-head' }, titleBox, closeBtn);
    var body = el('div', { class: 'qr-sheet-body' });
    var foot = el('div', { class: 'qr-sheet-foot' });
    sheetEl.appendChild(head); sheetEl.appendChild(body); sheetEl.appendChild(foot);
    return { head: head, h2: h2, body: body, foot: foot };
  }
  function focusFirst(f, preferred) {
    var t = preferred || f.body.querySelector('input:not([type="hidden"]),select,textarea,button') || f.h2;
    try { t.focus(); } catch (_) { /* nothing to do */ }
  }

  // ═══════════════════════════ FORM HELPERS ═══════════════════════════
  // A labelled control. The <label> wraps ONLY the caption and the control (so its accessible name is just the caption);
  // the hint and the error sit beside it and are tied to the control with aria-describedby.
  function field(labelNode, control, extra) {
    var wrap = el('div', { class: 'qr-field' });
    wrap.appendChild(el('label', null, el('span', { class: 'qr-label' }, labelNode), control));
    var errEl = el('p', { class: 'qr-err', role: 'alert', hidden: true });
    var hintId, errId = nid('e');
    errEl.setAttribute('id', errId);
    if (extra && extra.hint) { hintId = nid('h'); wrap.appendChild(el('p', { class: 'qr-hint', id: hintId, text: extra.hint })); control.setAttribute('aria-describedby', hintId + ' ' + errId); } else { control.setAttribute('aria-describedby', errId); }
    wrap.appendChild(errEl);
    wrap._err = errEl; wrap._control = control;
    return wrap;
  }
  function setErr(wrap, msg) {
    wrap._err.textContent = msg || ''; wrap._err.hidden = !msg;
    if (msg) wrap._control.setAttribute('aria-invalid', 'true'); else wrap._control.removeAttribute('aria-invalid');
  }
  function selectOf(options, value, placeholder) {
    var s = el('select', { class: 'qr-select' });
    s.appendChild(el('option', { value: '', text: placeholder || 'Choose…' }));
    options.forEach(function (o) { s.appendChild(el('option', { value: o.v, text: o.l, selected: o.v === value })); });
    s.value = value || '';
    return s;
  }

  // ═══════════════════════════ INTAKE (3 steps) ═══════════════════════════
  function openIntake(trigger, then) {
    var v = Object.assign({ need: '', needOther: '', useFor: '', useForOther: '', entityType: '', targetDate: '', targetFlexible: false, address: '', notes: '' }, clone(draft.intake) || {});
    var c = Object.assign({ name: '', mobile: '', email: '', company: '' }, clone(draft.contact) || {});
    var consent = !!(draft.consent && draft.consent.agreed);
    var step = 1;
    // the draft already holds every keystroke; closing by Esc / × / backdrop must still re-estimate, because the entity (government vs
    // private) may have changed and it is part of the estimate
    openSheet('intake', trigger, { onClose: function () { if (draft.items.length) scheduleEstimate(); } });
    function persist() { draft.intake = clone(v); draft.contact = clone(c); draft.consent = consent ? { agreed: true, noticeVersion: D.PRIVACY_NOTICE.version } : null; saveDraft(); }

    function render() {
      var f = frame('Tell us about your project', 'Takes a minute. Then pick items from the catalogue — we’ll show you an estimated range.', 'Step ' + step + ' of 3');
      var fields = [];
      if (step === 1) {
        var need = selectOf(INTAKE.need.options, v.need);
        var needOther = el('input', { class: 'qr-input', type: 'text', maxlength: 120, autocomplete: 'off', value: v.needOther });
        var fNeed = field(INTAKE.need.label, need); var fNeedOther = field('Tell us more', needOther);
        var use = selectOf(INTAKE.useFor.options, v.useFor);
        var useOther = el('input', { class: 'qr-input', type: 'text', maxlength: 120, autocomplete: 'off', value: v.useForOther });
        var fUse = field(INTAKE.useFor.label, use); var fUseOther = field('Tell us more', useOther);
        fNeedOther.hidden = v.need !== 'other'; fUseOther.hidden = v.useFor !== 'other';
        on(need, 'change', function () { v.need = need.value; fNeedOther.hidden = v.need !== 'other'; setErr(fNeed, ''); persist(); });
        on(needOther, 'input', function () { v.needOther = needOther.value; setErr(fNeedOther, ''); persist(); });
        on(use, 'change', function () { v.useFor = use.value; fUseOther.hidden = v.useFor !== 'other'; setErr(fUse, ''); persist(); });
        on(useOther, 'input', function () { v.useForOther = useOther.value; setErr(fUseOther, ''); persist(); });
        var group = el('fieldset', { class: 'qr-fs' }, el('legend', { text: INTAKE.entityType.label }));
        var choices = el('div', { class: 'qr-choices' });
        var entErr = el('p', { class: 'qr-err', role: 'alert', hidden: true });
        INTAKE.entityType.options.forEach(function (o) {
          var radio = el('input', { type: 'radio', name: 'qr-entity', value: o.v, checked: v.entityType === o.v });
          var lab = el('label', { class: 'qr-choice' + (v.entityType === o.v ? ' is-on' : '') }, radio, el('span', { text: o.l }));
          on(radio, 'change', function () {
            v.entityType = o.v; entErr.hidden = true;
            [].slice.call(choices.children).forEach(function (ch) { ch.classList.toggle('is-on', ch === lab); });
            persist();
          });
          choices.appendChild(lab);
        });
        group.appendChild(choices); group.appendChild(entErr);
        f.body.appendChild(fNeed); f.body.appendChild(fNeedOther); f.body.appendChild(fUse); f.body.appendChild(fUseOther); f.body.appendChild(group);
        fields = { need: fNeed, needOther: fNeedOther, useFor: fUse, useForOther: fUseOther, entityType: { _err: entErr, _control: choices } };
        fields.firstFocus = need;
      } else if (step === 2) {
        var today = manilaToday();
        var date = el('input', { class: 'qr-input', type: 'date', min: today, max: addYearsIso(today, 3), value: v.targetDate, disabled: v.targetFlexible });
        var fDate = field(INTAKE.targetDate.label, date);
        var flex = el('input', { type: 'checkbox', checked: v.targetFlexible });
        var flexLab = el('label', { class: 'qr-check' }, flex, el('span', { text: INTAKE.targetDate.flexibleLabel }));
        on(date, 'input', function () { v.targetDate = date.value; setErr(fDate, ''); persist(); });
        on(flex, 'change', function () { v.targetFlexible = flex.checked; date.disabled = flex.checked; if (flex.checked) { v.targetDate = ''; date.value = ''; } setErr(fDate, ''); persist(); });
        var addr = el('textarea', { class: 'qr-textarea', rows: 2, maxlength: INTAKE.address.max, autocomplete: 'street-address' });
        addr.value = v.address;
        var fAddr = field(INTAKE.address.label, addr, { hint: 'Where the equipment will be delivered.' });
        on(addr, 'input', function () { v.address = addr.value; setErr(fAddr, ''); persist(); });
        f.body.appendChild(fDate); f.body.appendChild(flexLab); f.body.appendChild(fAddr);
        fields = { targetDate: fDate, address: fAddr, firstFocus: date.disabled ? flex : date };
      } else {
        var name = el('input', { class: 'qr-input', type: 'text', maxlength: INTAKE.name.max, autocomplete: INTAKE.name.autocomplete, value: c.name });
        var mobile = el('input', { class: 'qr-input', type: 'tel', inputmode: 'tel', autocomplete: INTAKE.mobile.autocomplete, placeholder: INTAKE.mobile.placeholder, value: c.mobile });
        var email = el('input', { class: 'qr-input', type: 'email', inputmode: 'email', maxlength: INTAKE.email.max, autocomplete: INTAKE.email.autocomplete, value: c.email });
        var company = el('input', { class: 'qr-input', type: 'text', maxlength: INTAKE.company.max, autocomplete: INTAKE.company.autocomplete, value: c.company });
        var notes = el('textarea', { class: 'qr-textarea', rows: INTAKE.notes.rows, maxlength: INTAKE.notes.max });
        notes.value = v.notes;
        var fName = field(INTAKE.name.label, name), fMobile = field(INTAKE.mobile.label, mobile), fEmail = field(INTAKE.email.label, email), fCompany = field(INTAKE.company.label, company), fNotes = field(INTAKE.notes.label, notes);
        on(name, 'input', function () { c.name = name.value; setErr(fName, ''); persist(); });
        on(mobile, 'input', function () { c.mobile = mobile.value; setErr(fMobile, ''); persist(); });
        on(email, 'input', function () { c.email = email.value; setErr(fEmail, ''); persist(); });
        on(company, 'input', function () { c.company = company.value; setErr(fCompany, ''); persist(); });
        on(notes, 'input', function () { v.notes = notes.value; setErr(fNotes, ''); persist(); });
        var consentBox = el('input', { type: 'checkbox', checked: consent });
        var consentErr = el('p', { class: 'qr-err', role: 'alert', hidden: true });
        on(consentBox, 'change', function () { consent = consentBox.checked; consentErr.hidden = true; persist(); });
        var notice = el('details', null, el('summary', { text: 'Read the full privacy notice (RA 10173)' }),
          el('div', { class: 'qr-notice' }, D.PRIVACY_NOTICE.sections.map(function (s) { return [el('h4', { text: s.heading }), el('p', { text: s.body })]; }), el('p', { text: 'Notice version ' + D.PRIVACY_NOTICE.version })));
        f.body.appendChild(el('div', { class: 'qr-grid2' }, fName, fMobile));
        f.body.appendChild(el('div', { class: 'qr-grid2' }, fEmail, fCompany));
        f.body.appendChild(fNotes);
        f.body.appendChild(el('label', { class: 'qr-check' }, consentBox, el('span', { text: D.PRIVACY_NOTICE.consentLine })));
        f.body.appendChild(consentErr);
        f.body.appendChild(notice);
        fields = { name: fName, mobile: fMobile, email: fEmail, company: fCompany, notes: fNotes, consent: { _err: consentErr, _control: consentBox }, firstFocus: name };
      }

      // footer
      var back = step > 1 ? on(el('button', { type: 'button', class: 'qr-btn qr-btn-outline', text: 'Back' }), 'click', function () { step--; render(); }) : on(el('button', { type: 'button', class: 'qr-btn qr-btn-outline', text: 'Close' }), 'click', function () { closeSheet(); });
      var next = on(el('button', { type: 'button', class: 'qr-btn qr-btn-primary', text: step < 3 ? 'Next' : 'Save details' }), 'click', function () {
        var errs = validate(step, fields);
        if (errs.length) { var first = errs[0]; try { first.control.focus(); } catch (_) { /* nothing to do */ } return; }
        persist();
        if (step < 3) { step++; render(); return; }
        draft.intakeDone = true; draft.intake = clone(v); draft.contact = clone(c);
        draft.consent = { agreed: true, noticeVersion: D.PRIVACY_NOTICE.version };
        saveDraftNow();
        scheduleEstimate();
        closeSheet(false);
        if (then === 'review') { openReview(trigger); return; }
        toast(draft.items.length ? 'Details saved.' : 'Details saved — now add items from the catalogue.');
        scrollToCatalogue();
      });
      f.foot.appendChild(back); f.foot.appendChild(next);
      focusFirst(f, fields.firstFocus);
    }

    function validate(s, fl) {
      var errs = [];
      function bad(key, msg, control) { var holder = fl[key]; if (holder) { if (holder.nodeType) setErr(holder, msg); else { holder._err.textContent = msg; holder._err.hidden = false; } } errs.push({ control: control || (holder && holder._control) }); }
      if (s === 1) {
        if (!v.need) bad('need', 'Please choose what best describes what you need.');
        else if (v.need === 'other' && !v.needOther.trim()) bad('needOther', 'Please tell us a little more.');
        if (!v.useFor) bad('useFor', 'Please choose what you will use this for.');
        else if (v.useFor === 'other' && !v.useForOther.trim()) bad('useForOther', 'Please tell us a little more.');
        if (!v.entityType) bad('entityType', 'Please choose government or private.', fl.entityType._control.querySelector('input'));
      } else if (s === 2) {
        var today = manilaToday();
        if (!v.targetFlexible) {
          if (!v.targetDate) bad('targetDate', 'Pick a target date, or tick “' + INTAKE.targetDate.flexibleLabel + '”.');
          else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.targetDate) || v.targetDate < today) bad('targetDate', 'The target date cannot be in the past.');
          else if (v.targetDate > addYearsIso(today, 3)) bad('targetDate', 'Please pick a date within the next three years.');
        }
        var a = v.address.trim();
        if (a.length < 5) bad('address', 'Please enter the delivery address.');
        else if (a.length > INTAKE.address.max) bad('address', 'That address is too long.');
      } else {
        if (c.name.trim().length < 2) bad('name', 'Please enter your name.');
        if (!normaliseMobile(c.mobile.trim())) bad('mobile', 'Enter a Philippine mobile number (09XX XXX XXXX).');
        if (!EMAIL_RE.test(c.email.trim()) || c.email.trim().length > INTAKE.email.max) bad('email', 'Enter a valid e-mail address.');
        if (!consent) bad('consent', 'Please tick the data privacy consent.');
      }
      return errs;
    }
    render();
  }

  // ═══════════════════════════ ITEM SHEET ═══════════════════════════
  function openItem(productId, trigger, editUid, retReview) {
    var p = byId[productId];
    if (!p) return;
    var existing = editUid ? draft.items.filter(function (i) { return i.uid === editUid; })[0] : null;
    var ks = dimKeys(p);
    var run = isRunProduct(p);
    var others = productUnits(p.id, existing ? existing.uid : null);               // units of this product already on OTHER lines
    var room = LIMITS.maxQtyPerProduct - others;                                    // what this line may still take (one product, one multiplier)
    var unitsMsg = function () { return 'You can request up to ' + LIMITS.maxQtyPerProduct + ' of one product in a quote — your list already has ' + others + (room > 0 ? ', which leaves ' + room + '.' : '.'); };
    var f0 = {
      size: existing ? clone(existing.size) : defaultSize(p),
      runs: run ? (existing && existing.runs != null ? existing.runs : 1) : null,
      specs: existing ? clone(existing.specs) : defaultSpecs(p),
      qty: existing ? existing.qty : 1,
      note: existing ? existing.note : ''
    };
    openSheet('item', trigger);
    var f = frame(existing ? 'Edit item' : 'Add to your quote', null, null);
    f.body.appendChild(el('div', { class: 'qr-itemhead' }, el('p', { class: 'qr-item-name', text: p.name }), el('p', { class: 'qr-item-code', text: p.id })));

    var dimFields = {}, customTag = el('span', { class: 'qr-custom', hidden: true, text: 'Custom size' });
    var noteMsg = el('p', { class: 'qr-hint', hidden: true, text: COPY.customSizeNote });
    function updateCustom() {
      var custom = ks.some(function (k) { return f0.size && f0.size[k] !== p.dims[k]; });
      customTag.hidden = !custom; noteMsg.hidden = !custom;
    }
    if (ks.length) {
      var fs = el('fieldset', { class: 'qr-fs' }, el('legend', null, 'Size (mm)', customTag));
      var grid = el('div', { class: 'qr-dims' });
      ks.forEach(function (k) {
        if (isFixedDim(p, k)) {                                    // no custom value can exist for this dimension: show the standard size as text
          grid.appendChild(el('div', { class: 'qr-field qr-fixed' }, el('span', { class: 'qr-label', text: DIM_NAME[k] }), el('p', { class: 'qr-fixed-val', text: p.dims[k] + ' mm — standard' })));
          dimFields[k] = { fixed: true };
          return;
        }
        var input = el('input', { class: 'qr-input', type: 'number', inputmode: 'numeric', step: LIMITS.dimStepMm, min: LIMITS.minDimMm, max: maxDim(p, k), value: f0.size[k] });
        var fld = field(DIM_NAME[k], input);
        on(input, 'input', function () {
          var n = input.value === '' ? NaN : Number(input.value);
          setErr(fld, '');
          if (isFinite(n)) f0.size[k] = n;
          updateCustom();
        });
        dimFields[k] = { fld: fld, input: input };
        grid.appendChild(fld);
      });
      fs.appendChild(grid);
      var defTxt = ks.map(function (k) { return DIM_NAME[k] + ' ' + p.dims[k]; }).join(' · ');
      fs.appendChild(el('p', { class: 'qr-hint', text: 'Standard size: ' + defTxt + ' mm.' }));
      fs.appendChild(noteMsg);
      if (ks.some(function (k) { return !isFixedDim(p, k); })) fs.appendChild(on(el('button', { type: 'button', class: 'qr-btn qr-btn-quiet', text: 'Reset to default size' }), 'click', function () {
        ks.forEach(function (k) { f0.size[k] = p.dims[k]; if (dimFields[k].input) { dimFields[k].input.value = p.dims[k]; setErr(dimFields[k].fld, ''); } });
        updateCustom();
      }));
      f.body.appendChild(fs);
      updateCustom();
    } else if (!run) {
      f.body.appendChild(el('p', { class: 'qr-hint', text: 'Standard size.' }));
    }
    var runInput = null, runFld = null;
    if (run) {
      var runMax = Math.max(1, Math.min(LIMITS.maxRuns, room));
      runInput = el('input', { class: 'qr-input', type: 'number', inputmode: 'numeric', step: 1, min: 1, max: runMax, value: f0.runs });
      runFld = field('Number of runs', runInput, { hint: 'Between 1 and ' + runMax + '.' });
      on(runInput, 'input', function () { var n = Number(runInput.value); setErr(runFld, ''); f0.runs = isFinite(n) ? n : NaN; });
      f.body.appendChild(runFld);
    }
    (p.specs || []).forEach(function (sp, i) {
      var sel = el('select', { class: 'qr-select' });
      sp.options.forEach(function (o) { sel.appendChild(el('option', { value: o, text: o, selected: o === f0.specs[i].value })); });
      sel.value = f0.specs[i].value;
      on(sel, 'change', function () { f0.specs[i] = { label: sp.label, value: sel.value }; });
      f.body.appendChild(field(sp.label, sel));
    });
    var qtyInput = null, qtyFld = null;
    if (!run) {
      var qtyMax = Math.max(1, Math.min(LIMITS.maxQtyPerLine, room));
      qtyInput = el('input', { class: 'qr-input', type: 'number', inputmode: 'numeric', step: 1, min: 1, max: qtyMax, value: Math.min(f0.qty, qtyMax), 'aria-label': 'Quantity' });
      f0.qty = Math.min(f0.qty, qtyMax);
      var minus = on(el('button', { type: 'button', 'aria-label': 'Decrease quantity', text: '−' }), 'click', function () { f0.qty = Math.max(1, (Number(qtyInput.value) || 1) - 1); qtyInput.value = f0.qty; });
      var plus = on(el('button', { type: 'button', 'aria-label': 'Increase quantity', text: '+' }), 'click', function () { f0.qty = Math.min(qtyMax, (Number(qtyInput.value) || 1) + 1); qtyInput.value = f0.qty; });
      on(qtyInput, 'input', function () { var n = Number(qtyInput.value); if (isFinite(n)) f0.qty = n; setErr(qtyFld, ''); });
      qtyFld = el('div', { class: 'qr-field' }, el('span', { class: 'qr-label', text: 'Quantity' }), el('div', { class: 'qr-stepper' }, minus, qtyInput, plus));
      qtyFld._err = el('p', { class: 'qr-err', role: 'alert', hidden: true }); qtyFld._control = qtyInput; qtyFld.appendChild(qtyFld._err);
      if (others > 0) qtyFld.appendChild(el('p', { class: 'qr-hint', text: unitsMsg() }));
      f.body.appendChild(qtyFld);
    }
    var note = el('input', { class: 'qr-input', type: 'text', maxlength: LIMITS.maxNote, autocomplete: 'off', value: f0.note });
    var noteFld = field([ 'Note ', el('span', { class: 'qr-opt', text: '(optional)' }) ], note, { hint: 'Anything we should know about this item.' });
    on(note, 'input', function () { f0.note = note.value; });
    f.body.appendChild(noteFld);
    var dupeBox = el('div', { class: 'qr-dupe', hidden: true });
    f.body.appendChild(dupeBox);

    function build() {
      // validate, mirroring the server (the server is still the authority)
      var ok = true, firstBad = null;
      function bad(fld, msg, control) { setErr(fld, msg); ok = false; if (!firstBad) firstBad = control; }
      var size = null;
      if (ks.length) {
        size = {};
        ks.forEach(function (k) {
          if (dimFields[k].fixed) { size[k] = p.dims[k]; return; }
          var n = f0.size[k], inp = dimFields[k].input;
          if (inp.value === '' || !isFinite(Number(inp.value))) { bad(dimFields[k].fld, DIM_NAME[k] + ' is required.', inp); return; }
          n = Number(inp.value);
          if (n === p.dims[k]) { size[k] = n; return; }
          var mx = maxDim(p, k);
          if (Math.floor(n) !== n || n % LIMITS.dimStepMm !== 0 || n < LIMITS.minDimMm || n > mx) { bad(dimFields[k].fld, DIM_NAME[k] + ' must be a whole number of mm between ' + LIMITS.minDimMm + ' and ' + mx + ', in steps of ' + LIMITS.dimStepMm + '.', inp); return; }
          size[k] = n;
        });
      }
      var runs = null;
      if (run) {
        runs = Number(runInput.value);
        if (!isFinite(runs) || Math.floor(runs) !== runs || runs < 1 || runs > LIMITS.maxRuns) bad(runFld, 'Enter a whole number of runs from 1 to ' + LIMITS.maxRuns + '.', runInput);
        else if (runs + others > LIMITS.maxQtyPerProduct) bad(runFld, unitsMsg(), runInput);
      }
      var qty = 1;
      if (!run) {
        qty = Number(qtyInput.value);
        if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 1 || qty > LIMITS.maxQtyPerLine) bad(qtyFld, 'Quantity must be a whole number from 1 to ' + LIMITS.maxQtyPerLine + '.', qtyInput);
        else if (qty + others > LIMITS.maxQtyPerProduct) bad(qtyFld, unitsMsg(), qtyInput);
      }
      if (!ok) { try { firstBad.focus(); } catch (_) { /* nothing to do */ } return null; }
      return { uid: existing ? existing.uid : uid(), id: p.id, name: p.name, cat: p.cat || '', unit: p.unit || 'pc', size: size, runs: runs, specs: clone(f0.specs), qty: qty, note: note.value.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, LIMITS.maxNote) };
    }
    function commit(it, mode) {
      var tgt = mode === 'merge' ? draft.items.filter(function (x) { return lineKey(x) === lineKey(it) && x.uid !== it.uid; })[0] : null;
      if (mode === 'merge' && tgt) {
        tgt.qty = Math.min(LIMITS.maxQtyPerLine, tgt.qty + it.qty);                      // the unit cap was checked in build(), which counted that line
      } else if (existing) {
        draft.items[draft.items.indexOf(existing)] = it;
      } else if (draft.items.length >= LIMITS.maxItems) {
        toast('A quote can have up to ' + LIMITS.maxItems + ' lines — remove one first.'); return;
      } else {
        draft.items.push(it);
      }
      saveDraftNow(); refreshAll(); scheduleEstimate();
      closeSheet(!retReview);
      toast(existing ? 'Item updated.' : 'Added to your quote.');
      if (retReview) openReview(trigger);
    }
    var addBtn = on(el('button', { type: 'button', class: 'qr-btn qr-btn-primary', text: existing ? 'Save changes' : 'Add to quote' }), 'click', function () {
      var it = build();
      if (!it) return;
      var same = !existing && draft.items.filter(function (x) { return lineKey(x) === lineKey(it); })[0];
      if (same && !run) {
        clear(dupeBox);
        dupeBox.hidden = false;
        dupeBox.appendChild(el('p', { text: 'This exact item is already in your quote (×' + same.qty + ').' }));
        // the form stays editable behind this prompt, so the item is READ AGAIN at the click (never the stale one built above)
        var finish = function (mode) { var again = build(); if (again) commit(again, mode); };
        var row = el('div', { class: 'qr-row-actions' },
          on(el('button', { type: 'button', class: 'qr-btn qr-btn-primary qr-btn-sm', text: 'Add to that line' }), 'click', function () { finish('merge'); }),
          on(el('button', { type: 'button', class: 'qr-btn qr-btn-outline qr-btn-sm', text: 'Add as a new line' }), 'click', function () { finish('new'); }));
        dupeBox.appendChild(row);
        try { row.firstChild.focus(); } catch (_) { /* nothing to do */ }
        return;
      }
      commit(it, 'new');
    });
    if (room < 1 && !existing) {
      addBtn.disabled = true;
      f.body.insertBefore(el('p', { class: 'qr-banner qr-banner-err', role: 'alert', text: 'Your quote already holds the most we can take online for this item (' + LIMITS.maxQtyPerProduct + '). Edit that line instead, or call ' + PHONE + ' for a larger order.' }), f.body.firstChild);
    }
    f.foot.appendChild(on(el('button', { type: 'button', class: 'qr-btn qr-btn-outline', text: 'Cancel' }), 'click', function () { closeSheet(!retReview); if (retReview) openReview(trigger); }));
    f.foot.appendChild(addBtn);
    var firstEditable = ks.filter(function (k) { return !dimFields[k].fixed; })[0];
    focusFirst(f, firstEditable ? dimFields[firstEditable].input : (run ? runInput : f.body.querySelector('select,input')));
  }

  // ═══════════════════════════ REVIEW ═══════════════════════════
  var submitting = false;
  function openReview(trigger) {
    if (!draft.items.length) { toast('Add at least one item to your quote first.'); return; }
    if (!draft.intakeDone) { openIntake(trigger, 'review'); return; }
    var consentOn = !!(draft.consent && draft.consent.agreed);
    var errBanner = el('div', { class: 'qr-banner qr-banner-err', role: 'alert', hidden: true });
    openSheet('review', trigger);
    var f = frame('Your quote', 'Check the list, then send it. We review it and reply with a quotation.', null);
    var itemsBox = el('div'), intakeBox = el('div'), estBox = el('div', { 'aria-live': 'polite' });   // the live region PERSISTS; its children are replaced
    var hpInput = el('input', { class: 'qr-input', type: 'text', name: 'website_url', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    var hp = el('div', { class: 'qr-hp', 'aria-hidden': 'true' }, el('label', null, 'Leave this empty', hpInput));
    var consentBox = el('input', { type: 'checkbox', checked: consentOn });
    var consentLab = el('label', { class: 'qr-check' }, consentBox, el('span', { text: D.PRIVACY_NOTICE.consentLine }));
    var submitBtn;

    function renderItems() {
      clear(itemsBox);
      var ul = el('ul', { class: 'qr-items' });
      draft.items.forEach(function (it) {
        var p = byId[it.id];
        var meta = [];
        meta.push(el('span', { text: sizeText(it) }));
        if (p && isCustom(p, it)) meta.push(el('span', { class: 'qr-custom', text: 'custom' }));
        var specs = it.specs.map(function (s) { return s.label + ': ' + s.value; }).join(' · ');
        var li = el('li', { class: 'qr-item' + (it.gone ? ' is-gone' : '') },
          el('p', { class: 'qr-item-name', text: it.name }),
          el('p', { class: 'qr-item-code', text: it.id }),
          el('p', { class: 'qr-item-meta' }, meta, specs ? [el('br'), specs] : null, it.runs == null ? [el('br'), 'Quantity: ' + it.qty] : null, it.note ? [el('br'), 'Note: ' + it.note] : null),
          it.gone ? el('p', { class: 'qr-err', role: 'alert', text: 'No longer in the catalogue — please remove it.' }) : null,
          el('div', { class: 'qr-item-acts' },
            on(el('button', { type: 'button', class: 'qr-btn qr-btn-quiet qr-btn-sm', 'aria-label': 'Edit ' + it.name, text: 'Edit' }), 'click', function () { closeSheet(false); openItem(it.id, trigger, it.uid, true); }),
            on(el('button', { type: 'button', class: 'qr-btn qr-btn-quiet qr-btn-sm', 'aria-label': 'Remove ' + it.name, text: 'Remove' }), 'click', function () {
              draft.items = draft.items.filter(function (x) { return x.uid !== it.uid; });
              saveDraftNow(); refreshAll(); scheduleEstimate();
              if (!draft.items.length) { closeSheet(); toast('Your quote is empty.'); return; }
              renderItems();
            })));
        ul.appendChild(li);
      });
      itemsBox.appendChild(ul);
    }
    function renderIntake() {
      clear(intakeBox);
      var it = draft.intake || {}, c = draft.contact || {};
      var rows = [
        ['Need', optLabel('need', it.need) + (it.needOther ? ' — ' + it.needOther : '')],
        ['Use', optLabel('useFor', it.useFor) + (it.useForOther ? ' — ' + it.useForOther : '')],
        ['Entity', optLabel('entityType', it.entityType)],
        ['Target date', it.targetFlexible ? 'Not sure yet' : fmtDate(it.targetDate)],
        ['Deliver to', it.address || ''],
        ['Contact', [c.name, c.mobile, c.email, c.company].filter(Boolean).join(' · ')]
      ];
      var dl = el('dl', { class: 'qr-kv' });
      rows.forEach(function (r) { dl.appendChild(el('div', null, el('dt', { text: r[0] }), el('dd', { text: r[1] }))); });
      intakeBox.appendChild(el('div', { class: 'qr-box' }, el('h3', { text: 'Your details' }), dl,
        on(el('button', { type: 'button', class: 'qr-btn qr-btn-quiet qr-btn-sm', text: 'Edit details' }), 'click', function () { closeSheet(false); openIntake(trigger, 'review'); })));
    }
    function renderEst() {
      clear(estBox);
      var v = estView();
      var box = el('div', { class: 'qr-est' });
      if (v.kind === 'fig') {
        box.appendChild(el('p', { class: 'qr-est-fig', text: v.text }));
        if (v.notes && v.notes.length) box.appendChild(el('ul', null, v.notes.map(function (n) { return el('li', { text: n }); })));
        box.appendChild(el('p', { class: 'qr-disc', text: COPY.estimateDisclaimer }));
      } else if (v.kind === 'msg') {
        box.appendChild(el('p', { class: 'qr-est-msg', text: v.text }));
        if (v.notes && v.notes.length) box.appendChild(el('ul', null, v.notes.map(function (n) { return el('li', { text: n }); })));
      } else { return; }
      estBox.appendChild(box);
    }
    function refresh() { renderItems(); renderIntake(); renderEst(); }
    sheet.refresh = renderEst; sheet.refreshItems = renderItems;
    on(consentBox, 'change', function () {
      draft.consent = consentBox.checked ? { agreed: true, noticeVersion: D.PRIVACY_NOTICE.version } : null; saveDraft();
    });

    f.body.appendChild(errBanner);
    f.body.appendChild(itemsBox);
    f.body.appendChild(estBox);
    f.body.appendChild(intakeBox);
    f.body.appendChild(consentLab);
    f.body.appendChild(el('details', null, el('summary', { text: 'Read the full privacy notice (RA 10173)' }),
      el('div', { class: 'qr-notice' }, D.PRIVACY_NOTICE.sections.map(function (s) { return [el('h4', { text: s.heading }), el('p', { text: s.body })]; }), el('p', { text: 'Notice version ' + D.PRIVACY_NOTICE.version }))));
    f.body.appendChild(hp);
    var clearBtn;
    clearBtn = on(el('button', { type: 'button', class: 'qr-btn qr-btn-quiet', text: 'Clear quote' }), 'click', function () {
      if (clearBtn.getAttribute('data-sure') !== '1') { clearBtn.setAttribute('data-sure', '1'); clearBtn.textContent = 'Really clear everything?'; return; }
      draft.items = []; draft.intakeDone = draft.intakeDone; saveDraftNow(); refreshAll(); scheduleEstimate(); closeSheet(); toast('Quote cleared.');
    });
    f.body.appendChild(el('p', null, clearBtn));
    refresh();

    submitBtn = on(el('button', { type: 'button', class: 'qr-btn qr-btn-primary', text: 'Send quote request' }), 'click', function () {
      errBanner.hidden = true;
      if (submitting) return;
      if (draft.items.some(function (i) { return i.gone; })) { showErr('Please remove the item marked “No longer in the catalogue”, then send again.'); return; }
      if (!consentBox.checked) { showErr('Please tick the data privacy consent.'); try { consentBox.focus(); } catch (_) { /* nothing to do */ } return; }
      doSubmit(hpInput.value);
    });
    function showErr(msg, withReload) {
      clear(errBanner); errBanner.hidden = false;
      errBanner.appendChild(el('span', { text: msg }));
      if (withReload) { errBanner.appendChild(document.createTextNode(' ')); errBanner.appendChild(on(el('button', { type: 'button', class: 'qr-btn qr-btn-outline qr-btn-sm', text: 'Reload' }), 'click', function () { location.reload(); })); }
      try { errBanner.scrollIntoView({ block: 'nearest' }); } catch (_) { /* nothing to do */ }
    }
    f.foot.appendChild(on(el('button', { type: 'button', class: 'qr-btn qr-btn-outline', text: 'Add more items' }), 'click', function () { closeSheet(); scrollToCatalogue(); }));
    f.foot.appendChild(submitBtn);
    focusFirst(f, f.h2);

    function setBusy(b) {
      // While a request is in flight NOTHING in the review may change: the receipt shows exactly what was sent, and a failure must
      // land in a banner that is still on screen. The send button stays focusable (aria-disabled) so focus is not thrown away.
      submitting = b; sheet.closable = !b;
      if (b) submitBtn.setAttribute('aria-disabled', 'true'); else submitBtn.removeAttribute('aria-disabled');
      submitBtn.textContent = b ? 'Sending…' : 'Send quote request';
      [f.head, f.body].forEach(function (n) { if (b) n.setAttribute('inert', ''); else n.removeAttribute('inert'); });
      [].slice.call(f.foot.querySelectorAll('button')).forEach(function (n) { if (n !== submitBtn) n.disabled = b; });
      sheetEl.setAttribute('aria-busy', b ? 'true' : 'false');
    }
    function doSubmit(honeypot) {
      if (!navigator.onLine) { showErr('You’re offline — your list is saved on this device. Reconnect and try again.'); return; }
      var snap = { items: clone(draft.items), intake: clone(draft.intake), contact: clone(draft.contact), entity: entityNow(), basketKey: basketKey() };   // what is being SENT
      var payloadBase = {
        defVersion: D.VERSION,
        intake: intakePayload(), contact: contactPayload(), items: snap.items.map(itemPayload),
        consent: { agreed: true, noticeVersion: D.PRIVACY_NOTICE.version }, honeypot: honeypot || '',
        fillMs: Math.max(0, Date.now() - draft.startedAtMs),
        lastEstimate: lastShown ? { low: lastShown.low, high: lastShown.high, basketHash: lastShown.basketHash } : null
      };
      var probe = JSON.stringify(Object.assign({ sessionToken: 'x'.repeat(43) }, payloadBase));
      if (probe.length > LIMITS.maxPayloadBytes) { showErr('Your quote is too large to send — please shorten your notes or remove a few lines.'); return; }
      setBusy(true);
      // The honest page never trips the server's "too fast" bot check: it waits out the floor, measured on its own clock from
      // the moment the session was created (a restored older session needs no wait).
      var attempt = function () {
        return ensureSession().then(function (token) {
          // the wait is measured for THIS session and bounded (a clock corrected backwards can never leave "Sending…" hanging)
          var floor = LIMITS.minFillMs + 1500;
          var wait = MOCK ? 0 : Math.min(floor, floor - (Date.now() - (draft.sessionLocalAtMs || 0)));
          return (wait > 0 ? delay(wait) : Promise.resolve()).then(function () {
            return Qr.submit(Object.assign({ sessionToken: token }, payloadBase));
          });
        });
      };
      attempt().catch(function (e) {
        if (isSessionError(e)) { dropSession(); return attempt(); }
        return Promise.reject(e);
      }).then(function (res) {
        setBusy(false);
        onSubmitted(res, snap);
      }, function (e) {
        setBusy(false);
        handleSubmitError(e, showErr);
      });
    }
  }
  function intakePayload() {
    var v = draft.intake || {};
    var out = { need: v.need, useFor: v.useFor, entityType: v.entityType, address: v.address.trim(), targetFlexible: !!v.targetFlexible, targetDate: v.targetFlexible ? null : v.targetDate };
    if (v.need === 'other') out.needOther = v.needOther.trim();
    if (v.useFor === 'other') out.useForOther = v.useForOther.trim();
    if (v.notes && v.notes.trim()) out.notes = v.notes.trim();
    return out;
  }
  function contactPayload() {
    var c = draft.contact || {};
    var out = { name: c.name.trim(), mobile: normaliseMobile(c.mobile.trim()) || c.mobile.trim(), email: c.email.trim() };
    if (c.company && c.company.trim()) out.company = c.company.trim();
    return out;
  }
  // §5.6 — what the page does with each failure
  function handleSubmitError(e, showErr) {
    var code = e && e.code, msg = (e && e.message) || '';
    if (code === 'resource-exhausted' || code === 'already-exists') { showErr(msg); return; }
    if (code === 'invalid-argument') {
      if (e.details && Array.isArray(e.details.itemIds) && e.details.itemIds.length) { markGone(e.details.itemIds); showErr(msg); return; }
      showErr(msg); return;
    }
    if (code === 'failed-precondition') { showErr(msg + ' Your list is saved on this device.', true); return; }
    if (!navigator.onLine) { showErr('You’re offline — your list is saved on this device. Reconnect and try again.'); return; }
    showErr('Something went wrong on our side — your list is saved on this device. Please try again in a moment, or call ' + PHONE + '.');
  }

  // ═══════════════════════════ RECEIPT ═══════════════════════════
  var receipt = null;
  // The notes printed beside the receipt's range, built from what was SENT (the same lines, in the same order, as the server's own
  // notes) — never from whatever estimate happened to be on screen last.
  function receiptNotes(snap) {
    var notes = [D.ESTIMATE.vatBasis === 'inclusive' ? COPY.vatInclusive : COPY.vatExclusive];
    if (!D.ESTIMATE.deliveryIncluded) notes.push(COPY.deliveryExcluded);
    if (snap.entity === 'government') notes.push(COPY.governmentNote);
    if (snap.items.some(function (it) { var p = byId[it.id]; return p && isCustom(p, it); })) notes.push(COPY.customSizeNote);
    if (est.status === 'ok' && est.data && est.data.reviewCount > 0 && basketKey() === snap.basketKey) notes.push(COPY.reviewCount(est.data.reviewCount));
    return notes;
  }
  function onSubmitted(res, snap) {
    var rcpt = { refNo: res.refNo, submittedOnManila: res.submittedOnManila, estimate: res.estimate || null, items: snap.items, intake: snap.intake, contact: snap.contact, entity: snap.entity, notes: res.estimate ? receiptNotes(snap) : null };
    receipt = rcpt;
    clearTimeout(estTimer); estSeq++;                        // a pending or in-flight estimate must not outlive the quote it belonged to
    clearDraft();
    draft = freshDraft();
    estCache = Object.create(null); lastShown = null; est = { status: 'idle', data: null };
    refreshAll();
    closeSheet(false);
    openReceipt(rcpt);
  }
  // A quote sent or cleared in ANOTHER tab empties the shared draft; this tab must not bring it back the next time it saves.
  window.addEventListener('storage', function (e) {
    if (!((e.key === DRAFT_KEY && e.newValue === null) || e.key === null) || submitting) return;
    clearTimeout(saveTimer); clearTimeout(estTimer); estSeq++;
    draft = freshDraft(); estCache = Object.create(null); lastShown = null; est = { status: 'idle', data: null };
    if (sheet.kind && sheet.kind !== 'receipt') closeSheet(false);
    refreshAll();
    toast('Your quote was sent or cleared in another tab.');
  });
  function openReceipt(r) {
    openSheet('receipt', null, { closable: false });
    var f = frame(COPY.receiptTitle, COPY.receiptBody, null);
    f.body.appendChild(el('p', { class: 'qr-item-code', text: 'Reference number' }));
    f.body.appendChild(el('p', { class: 'qr-ref', text: r.refNo }));
    f.body.appendChild(el('p', { class: 'qr-hint', text: 'Received ' + fmtDate(r.submittedOnManila) + ' (Manila time). We’ll be in touch by phone or e-mail.' }));
    if (r.estimate) {
      var box = el('div', { class: 'qr-est' }, el('p', { class: 'qr-est-fig', text: peso(r.estimate.low) + ' – ' + peso(r.estimate.high) }));
      var notes = r.notes || [];
      box.appendChild(el('ul', null, notes.map(function (n) { return el('li', { text: n }); })));
      box.appendChild(el('p', { class: 'qr-disc', text: COPY.estimateDisclaimer }));
      f.body.appendChild(box);
    }
    var ul = el('ul', { class: 'qr-items' });
    r.items.forEach(function (it) {
      var p = byId[it.id];
      var specs = it.specs.map(function (s) { return s.label + ': ' + s.value; }).join(' · ');
      ul.appendChild(el('li', { class: 'qr-item' }, el('p', { class: 'qr-item-name', text: it.name }), el('p', { class: 'qr-item-code', text: it.id }),
        el('p', { class: 'qr-item-meta' }, sizeText(it) + (p && isCustom(p, it) ? ' (custom)' : ''), specs ? [el('br'), specs] : null, it.runs == null ? [el('br'), 'Quantity: ' + it.qty] : null, it.note ? [el('br'), 'Note: ' + it.note] : null)));
    });
    f.body.appendChild(ul);
    var it = r.intake || {}, c = r.contact || {};
    var dl = el('dl', { class: 'qr-kv' });
    [['Need', optLabel('need', it.need) + (it.needOther ? ' — ' + it.needOther : '')], ['Use', optLabel('useFor', it.useFor) + (it.useForOther ? ' — ' + it.useForOther : '')], ['Entity', optLabel('entityType', it.entityType)],
      ['Target date', it.targetFlexible ? 'Not sure yet' : fmtDate(it.targetDate)], ['Deliver to', it.address || ''], ['Contact', [c.name, c.mobile, c.email, c.company].filter(Boolean).join(' · ')]]
      .forEach(function (row) { dl.appendChild(el('div', null, el('dt', { text: row[0] }), el('dd', { text: row[1] }))); });
    f.body.appendChild(el('div', { class: 'qr-box' }, el('h3', { text: 'Your details' }), dl));
    f.body.appendChild(el('p', { class: 'qr-hint', text: COPY.privacyLine }));
    f.foot.className = 'qr-sheet-foot qr-noprint';
    f.foot.appendChild(on(el('button', { type: 'button', class: 'qr-btn qr-btn-outline', text: 'Save receipt as PDF' }), 'click', function () { doc.body.classList.add('qr-print-receipt'); window.print(); }));
    f.foot.appendChild(on(el('button', { type: 'button', class: 'qr-btn qr-btn-primary', text: 'Start another quote' }), 'click', function () { receipt = null; closeSheet(); toast('Ready for a new quote.'); }));
    focusFirst(f, f.h2);
  }
  window.addEventListener('afterprint', function () { doc.body.classList.remove('qr-print-receipt'); });

  // ═══════════════════════════ FLOW ═══════════════════════════
  function scrollToCatalogue() {
    var t = doc.getElementById('catalogue');
    if (!t || !t.scrollIntoView) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); } catch (_) { t.scrollIntoView(); }
  }
  // Every "Get a quote" call to action: the intake first; a returning visitor with their details already in goes
  // straight to their quote (or back to the catalogue when it is still empty).
  function startFlow(trigger) {
    if (sheet.kind) return;
    if (draft.intakeDone) {
      if (draft.items.length) { openReview(trigger); return; }
      toast('Your details are saved — add items from the catalogue.');
      scrollToCatalogue();
      return;
    }
    openIntake(trigger);
  }
  doc.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var add = t.closest('.qr-add');
    if (add) { e.preventDefault(); openItem(add.getAttribute('data-id'), add); return; }
    var cta = t.closest('[data-qr-start]');
    if (cta) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;     // let a new-tab click through
      e.preventDefault();
      startFlow(cta);
    }
  });

  // ═══════════════════════════ BOOT ═══════════════════════════
  loadDraft();
  injectAddButtons();
  refreshAll();
  syncOffline();
  if (pendingToast) { toast(pendingToast); pendingToast = ''; }
  if (draft.items.length) scheduleEstimate();
  var hashIsQuote = location.hash.slice(1) === 'quote';            // a bare #quote anchor asks for the intake too
  var wantStart = qs.get('quote') === '1' || hashIsQuote;
  if (wantStart) {
    try {
      qs.delete('quote');
      var rest = qs.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + (hashIsQuote ? '' : location.hash));
    } catch (_) { /* nothing to do */ }
    setTimeout(function () { startFlow(null); }, 0);
  }
})();
