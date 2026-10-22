/* js/project-brief.js — the public PROJECT BRIEF at /sales/clientinformationrequest/ (redesign 2026-10-22; spec §9 of
   specs/CLIENT-INFO-REQUEST-SPEC.md). A standalone page on the public website's design: no app script, no account.

   What it does: renders the form from the shared definition (js/cir-forms.js, FORMS.project_brief_v2) as a short, stepped form.
   Step 1 asks the TYPE of project (twelve cards); the steps that follow are the common parts every project answers plus ONE short
   conditional part for the chosen type (a section's `when`). A segmented bar (a timeline from 960px) shows where the visitor is.
   Each step is checked when the visitor presses Next; the last step takes notes, the privacy consent and sends the brief. The
   answers autosave on the visitor's own device (never image bytes); photos are shrunk in the browser (long edge 1600 px, JPEG) and
   uploaded one at a time through the cirUploadPhoto callable; the receipt shows the reference number (CIR-yymmdd-XXXXXX).

   Safety — the page's CSP forbids inline script and inline style, so this file builds every node with createElement + textContent
   (never innerHTML) and styles nothing by attribute: visitor-typed text, a draft read back from localStorage and every server
   message can therefore never be parsed as HTML. The draft is treated as untrusted on load (each value is re-checked against the
   definition). Nothing is sent before the visitor ticks the consent and presses Send. The browser never talks to Firestore or
   Storage: only the five asia-east1 callables, which validate everything again against the same definition. No analytics, no
   cookies, no third-party script beyond the two pinned Firebase compat scripts that carry the callables.

   QA seam: ?mock=1 resolves every call locally (no Firebase init); sim=ratelimit|expired|dup|invalid|error|slow|unauth|photobig
   exercises each failure. It never reaches a backend and is harmless in production. */
(function () {
  'use strict';

  var doc = document;
  var FORM_ID = 'project_brief_v2';
  var PHONE = '0927 683 6300';
  var MESSENGER_URL = 'https://m.me/barrokitchens';     // brand-specific: the link carries data-brand wherever it is written
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var root = doc.getElementById('brief-root');
  if (!root) return;

  function failCard(title, text) {
    root.textContent = '';
    var card = doc.createElement('div');
    card.className = 'brief-card brief-fail';
    card.setAttribute('role', 'alert');
    var h = doc.createElement('h2'); h.textContent = title;
    var p = doc.createElement('p'); p.className = 'brief-step-hint'; p.textContent = text;
    card.appendChild(h); card.appendChild(p);
    root.appendChild(card);
    root.classList.add('is-ready');
  }
  var DEFS = window.CIR_FORMS, LIMITS = window.CIR_LIMITS, NOTICE = window.CIR_PRIVACY_NOTICE;
  if (!DEFS || !Object.prototype.hasOwnProperty.call(DEFS, FORM_ID) || !LIMITS || !NOTICE) {
    failCard('Could not load the form', 'Please reload this page, or call ' + PHONE + ' and we will take your details over the phone.');
    return;
  }
  var def = DEFS[FORM_ID];

  // ── config ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Firebase config is public by design (rules are the boundary) — the same project block the other public pages carry.
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
  var DRAFT_KEY = 'barro-cir-' + FORM_ID + '-v' + def.formVersion;
  var OLD_DRAFT_KEY = 'barro-cir-commissary_brief-v1';        // the original commissary-only form's draft (retired 2026-10-22)
  var qs = new URLSearchParams(location.search);
  var MOCK = qs.get('mock') === '1';
  var SIM = MOCK ? (qs.get('sim') || '') : '';
  var GENERIC_ERR = 'Something went wrong on our side. Your answers are saved on this device. Please try again in a moment.';

  // ── tiny DOM helpers: strings become TEXT NODES — nothing here ever parses HTML ─────────────────────────────────────────
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
        else n.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function on(n, ev, fn, opts) { n.addEventListener(ev, fn, opts); return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function qsa(sel, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(sel)); }
  function delay(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  // line icons (Lucide-style, stroke 1.8), built with createElementNS so no markup is parsed
  var ICONS = {
    chat:  [['path', { d: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z' }]],
    check: [['path', { d: 'M20 6 9 17l-5-5' }]],
    image: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }], ['circle', { cx: 9, cy: 9, r: 2 }], ['path', { d: 'm21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21' }]],
    alert: [['path', { d: 'm21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z' }], ['path', { d: 'M12 9v4' }], ['path', { d: 'M12 17h.01' }]]
  };
  function icon(name, size, cls) {
    var s = doc.createElementNS(SVG_NS, 'svg');
    if (cls) s.setAttribute('class', cls);
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', String(size || 20)); s.setAttribute('height', String(size || 20));
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    (ICONS[name] || []).forEach(function (part) {
      var n = doc.createElementNS(SVG_NS, part[0]);
      Object.keys(part[1]).forEach(function (k) { n.setAttribute(k, String(part[1][k])); });
      s.appendChild(n);
    });
    return s;
  }

  function isBlank(v) {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v)) return v.length === 0;
    return String(v).trim() === '';
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // A date shown as "D Mon YYYY", built from the string's own parts — never `new Date('YYYY-MM-DD')`, which UTC-shifts.
  function fmtDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return String(s || '');
    var mo = parseInt(m[2], 10);
    if (!mo || mo < 1 || mo > 12) return String(s || '');
    return parseInt(m[3], 10) + ' ' + MONTHS[mo - 1] + ' ' + m[1];
  }
  function manilaDateFromMs(ms) {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }

  // ── the definition, indexed ──────────────────────────────────────────────────────────────────────────────────────────────
  var sections = def.sections;
  var fieldMap = Object.create(null);          // key → field (every answerable field, conditional parts included)
  var sectionOfField = Object.create(null);    // key → its section
  var photosField = null;
  sections.forEach(function (sec) {
    sec.fields.forEach(function (f) {
      if (f.type === 'photos') { photosField = f; return; }
      fieldMap[f.key] = f; sectionOfField[f.key] = sec;
    });
  });
  var typeField = fieldMap.project_type;
  var lastSection = sections[sections.length - 1];
  var PENDING = { key: '__pending', short: 'About your project', title: '', fields: [] };   // stands in for the conditional part until a type is chosen

  function optVal(o) { return typeof o === 'string' ? o : o.v; }
  function optLabel(o) { return typeof o === 'string' ? o : (o.l != null ? o.l : o.v); }
  function labelFor(f, v) {
    var opts = f.options || [];
    for (var i = 0; i < opts.length; i++) if (optVal(opts[i]) === v) return optLabel(opts[i]);
    return String(v);
  }
  function isChoice(f) { return f.type === 'select' && (f.ui === 'cards' || f.ui === 'choice'); }
  function fieldId(f) { return 'f-' + f.key; }

  // ── the integration seam: Cir.startDraft / uploadPhoto / removePhoto / submit ───────────────────────────────────────────
  // Under ?mock=1 they resolve locally with no Firebase init; otherwise they are the real asia-east1 httpsCallable functions.
  var fnStart = null, fnUpload = null, fnRemove = null, fnSubmit = null, fbReady = false;
  function ensureFirebase() {
    if (fbReady) return;
    if (typeof window.firebase === 'undefined') throw { code: 'unavailable', message: GENERIC_ERR };
    window.firebase.initializeApp(FIREBASE_CFG);
    var fns = window.firebase.app().functions(REGION);
    fnStart = fns.httpsCallable('cirStartDraft');
    fnUpload = fns.httpsCallable('cirUploadPhoto');
    fnRemove = fns.httpsCallable('cirRemovePhoto');
    fnSubmit = fns.httpsCallable('cirSubmit');
    fbReady = true;
  }
  function normalizeError(e) {
    return { code: (e && e.code) || 'internal', message: (e && e.message) || GENERIC_ERR };
  }
  function call(getFn, payload) {
    try { ensureFirebase(); } catch (e) { return Promise.reject(normalizeError(e)); }
    return getFn()(payload).then(function (r) { return r.data; }).catch(function (e) { return Promise.reject(normalizeError(e)); });
  }
  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';      // no 0/O/1/I — the server's reference alphabet
  function randFrom(alphabet, n) { var s = ''; for (var i = 0; i < n; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]; return s; }
  var mockCount = { photos: 0, bytes: 0 };
  var Cir = {
    startDraft: function () {
      if (MOCK) {
        return delay(300 + Math.random() * 300).then(function () {
          if (SIM === 'error') return Promise.reject({ code: 'unavailable', message: GENERIC_ERR });
          mockCount = { photos: 0, bytes: 0 };
          return { ok: true, draftToken: randFrom('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz0123456789-_', 43), formVersion: def.formVersion, serverNow: new Date().toISOString() };
        });
      }
      return call(function () { return fnStart; }, { formId: FORM_ID });
    },
    uploadPhoto: function (payload) {
      if (MOCK) {
        return delay(300 + Math.random() * 400 + (SIM === 'slow' ? 3000 : 0)).then(function () {
          if (SIM === 'photobig') return Promise.reject({ code: 'invalid-argument', message: 'Photo is too large.' });
          if (SIM === 'unauth') return Promise.reject({ code: 'unauthenticated', message: 'Please reload the page.' });
          if (SIM === 'error') return Promise.reject({ code: 'unavailable', message: GENERIC_ERR });
          var bytes = Math.round(String(payload.dataUrl || '').length * 0.73);
          mockCount.photos++; mockCount.bytes += bytes;
          return { ok: true, photoId: 'p_' + randFrom('0123456789abcdef', 12), bytes: bytes, photoCount: mockCount.photos, bytesTotal: mockCount.bytes };
        });
      }
      return call(function () { return fnUpload; }, payload);
    },
    removePhoto: function (payload) {
      if (MOCK) return delay(150).then(function () { mockCount.photos = Math.max(0, mockCount.photos - 1); return { ok: true, removed: true }; });
      return call(function () { return fnRemove; }, payload);
    },
    submit: function (payload) {
      if (MOCK) {
        return delay(400 + Math.random() * 400 + (SIM === 'slow' ? 3000 : 0)).then(function () {
          if (SIM === 'ratelimit') return Promise.reject({ code: 'resource-exhausted', message: 'Too many requests from this connection. Try again in 12 minutes.' });
          if (SIM === 'expired') return Promise.reject({ code: 'failed-precondition', message: 'Your session expired — reload the page and send again (your answers are saved on this device).' });
          if (SIM === 'dup') return Promise.reject({ code: 'already-exists', message: 'We already received a brief from this e-mail and number today. Call ' + PHONE + ' if you need to change something.' });
          if (SIM === 'invalid') return Promise.reject({ code: 'invalid-argument', message: '"Full name" is required.' });
          if (SIM === 'error') return Promise.reject({ code: 'unavailable', message: GENERIC_ERR });
          var now = Date.now(), iso = manilaDateFromMs(now);
          return { ok: true, refNo: 'CIR-' + iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) + '-' + randFrom(CODE_ALPHABET, 6), receivedAt: new Date(now).toISOString(), submittedOnManila: iso };
        });
      }
      return call(function () { return fnSubmit; }, payload);
    }
  };

  // ── state ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  var state = { draftToken: null, draftCreatedAtIso: null, draftStartedLocalMs: 0, startedAtMs: Date.now(), photos: {} };
  var cur = sections[0].key;        // the step on screen
  var reached = 0;                  // the furthest step index the visitor has reached (the progress bar lets them go back to any step up to it)
  var submitting = false, uploadsInFlight = 0, tileCounter = 0, queueRunning = false, photoQueue = [], lastNavMs = 0;
  var stepEls = Object.create(null);
  var form, stepsBox, navEl, countEl, nowEl, liveEl, cardEl, btnBack, btnNext, savedEl, errEl, hpEl, consentEl, consentErrEl, doneEl, layoutEl, offlineEl, expiredEl, phCountEl;

  // ── reading and writing a field's value ──────────────────────────────────────────────────────────────────────────────────
  function control(f) { return form.querySelector('[name="' + f.key + '"]'); }
  function readValue(f) {
    if (f.type === 'chips') return qsa('input[type="checkbox"][name="' + f.key + '"]:checked', form).map(function (c) { return c.value; });
    if (isChoice(f)) { var r = form.querySelector('input[type="radio"][name="' + f.key + '"]:checked'); return r ? r.value : ''; }
    var c = control(f);
    if (!c) return '';
    if (f.type === 'number') { if (c.value === '') return ''; var n = Number(c.value); return isFinite(n) ? n : ''; }
    return c.value;
  }
  // The visitor's own draft is untrusted: every value is re-checked against the definition before it touches the form.
  function writeValue(f, val) {
    if (f.type === 'chips') {
      var want = Array.isArray(val) ? val : [];
      qsa('input[type="checkbox"][name="' + f.key + '"]', form).forEach(function (c) { c.checked = want.indexOf(c.value) !== -1; });
      return;
    }
    if (isChoice(f)) {
      qsa('input[type="radio"][name="' + f.key + '"]', form).forEach(function (r) { r.checked = (r.value === val); });
      return;
    }
    var c = control(f);
    if (!c) return;
    if (f.type === 'select') {
      var ok = (f.options || []).some(function (o) { return optVal(o) === val; });
      c.value = ok ? val : '';
    } else if (f.type === 'number') {
      c.value = (typeof val === 'number' && isFinite(val)) ? String(val) : '';
    } else if (f.type === 'date') {
      c.value = (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) ? val : '';
    } else {
      c.value = typeof val === 'string' ? val.slice(0, f.max || 2000) : '';
    }
  }

  // ── which steps apply ────────────────────────────────────────────────────────────────────────────────────────────────────
  function sectionApplies(sec) {
    var w = sec.when;
    if (!w) return true;
    var f = fieldMap[w.key];
    var v = f ? readValue(f) : '';
    return typeof v === 'string' && w.in.indexOf(v) !== -1;
  }
  function stepsList() {
    var t = typeField ? readValue(typeField) : '';
    var out = [], pendingAdded = false;
    sections.forEach(function (sec) {
      if (!sec.when) { out.push(sec); return; }
      if (t) { if (sectionApplies(sec)) out.push(sec); }
      else if (!pendingAdded) { out.push(PENDING); pendingAdded = true; }
    });
    return out;
  }
  function indexOfKey(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return i;
    return -1;
  }

  // ── rendering: one field ─────────────────────────────────────────────────────────────────────────────────────────────────
  function reqMark(f) { return f.required ? el('span', { class: 'brief-req', 'aria-hidden': 'true', text: ' *' }) : null; }
  function describedBy(f) { return (f.hint ? fieldId(f) + '-hint ' : '') + fieldId(f) + '-err'; }
  function hintNode(f) { return f.hint ? el('p', { class: 'brief-hint', id: fieldId(f) + '-hint', text: f.hint }) : null; }
  function errNode(f) { return el('p', { class: 'brief-field-err', id: fieldId(f) + '-err', hidden: true }); }

  function renderField(f) {
    if (f.type === 'photos') return renderPhotosBlock(f);
    var full = f.w === 'full' ? ' is-full' : '';

    if (f.type === 'chips') {
      var chips = el('div', { class: 'brief-chips' });
      (f.options || []).forEach(function (o) {
        chips.appendChild(el('label', { class: 'brief-pill' }, el('input', { type: 'checkbox', name: f.key, value: optVal(o) }), el('span', { text: optLabel(o) })));
      });
      return el('fieldset', { class: 'brief-fieldset', 'data-field': f.key, 'aria-describedby': describedBy(f) },
        el('legend', { text: f.label }, reqMark(f)), hintNode(f), chips, errNode(f));
    }

    if (f.type === 'select' && f.ui === 'cards') {
      var cards = el('div', { class: 'brief-cards' });
      (f.options || []).forEach(function (o) {
        cards.appendChild(el('label', { class: 'brief-opt' },
          el('input', { type: 'radio', name: f.key, value: optVal(o) }),
          el('span', { class: 'brief-opt-body' }, el('span', { class: 'brief-opt-title', text: optLabel(o) }), o.d ? el('span', { class: 'brief-opt-desc', text: o.d }) : null)));
      });
      return el('fieldset', { class: 'brief-fieldset', 'data-field': f.key, 'aria-describedby': describedBy(f) },
        el('legend', { class: 'sr-only', text: f.label }), cards, errNode(f));
    }

    if (f.type === 'select' && f.ui === 'choice') {
      var pills = el('div', { class: 'brief-chips' });
      (f.options || []).forEach(function (o) {
        pills.appendChild(el('label', { class: 'brief-pill' }, el('input', { type: 'radio', name: f.key, value: optVal(o), 'data-clearable': f.required ? null : '1' }), el('span', { text: optLabel(o) })));
      });
      return el('fieldset', { class: 'brief-fieldset', 'data-field': f.key, 'aria-describedby': describedBy(f) },
        el('legend', { text: f.label }, reqMark(f)), hintNode(f), pills, errNode(f));
    }

    var common = { id: fieldId(f), name: f.key, 'aria-describedby': describedBy(f), 'aria-required': f.required ? 'true' : null };
    var ctl;
    switch (f.type) {
      case 'textarea':
        ctl = el('textarea', Object.assign({ rows: f.rows || 3, maxlength: f.max || 2000, placeholder: f.placeholder || null }, common));
        break;
      case 'select':
        ctl = el('select', common, el('option', { value: '', text: 'Select' }), (f.options || []).map(function (o) { return el('option', { value: optVal(o), text: optLabel(o) }); }));
        break;
      case 'number':
        ctl = el('input', Object.assign({ type: 'number', inputmode: (f.step && f.step < 1) ? 'decimal' : 'numeric', min: f.min != null ? f.min : null, max: f.max != null ? f.max : null, step: f.step != null ? f.step : null }, common));
        break;
      case 'date':
        ctl = el('input', Object.assign({ type: 'date' }, common));
        break;
      case 'tel':
        ctl = el('input', Object.assign({ type: 'tel', inputmode: 'tel', placeholder: f.placeholder || null, autocomplete: f.autocomplete || null }, common));
        break;
      case 'email':
        ctl = el('input', Object.assign({ type: 'email', inputmode: 'email', autocomplete: f.autocomplete || null, autocapitalize: 'none', spellcheck: 'false' }, common));
        break;
      case 'url':
        ctl = el('input', Object.assign({ type: 'url', inputmode: 'url', placeholder: f.placeholder || null }, common));
        break;
      default:
        ctl = el('input', Object.assign({ type: 'text', maxlength: f.max || 200, placeholder: f.placeholder || null, autocomplete: f.autocomplete || null }, common));
    }
    return el('div', { class: 'brief-field' + full, 'data-field': f.key },
      el('label', { class: 'brief-label', for: fieldId(f) }, f.label, reqMark(f)), ctl, hintNode(f), errNode(f));
  }

  // ── rendering: the photos part (all of the old page's behaviour: 20 photos, 900 KB each, 12 MB in all) ──────────────────
  function renderPhotosBlock(f) {
    phCountEl = el('p', { class: 'brief-ph-count', text: '0 of ' + LIMITS.maxPhotos + ' photos · 0.0 MB' });
    var wrap = el('div', { class: 'brief-photos', 'data-field': f.key }, phCountEl);
    (f.groups || []).forEach(function (g) {
      wrap.appendChild(el('div', { class: 'brief-ph-group', 'data-group': g.key },
        el('h3', { text: g.label }),
        g.hint ? el('p', { text: g.hint }) : null,
        el('div', { class: 'brief-ph-actions' },
          el('button', { type: 'button', class: 'site-btn site-btn-outline site-btn-sm brief-ph-add', 'data-group': g.key, text: 'Add photos' }),
          el('button', { type: 'button', class: 'site-btn site-btn-outline site-btn-sm brief-ph-take', 'data-group': g.key, text: 'Take photo' }),
          el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only brief-ph-in-add', 'data-group': g.key, tabindex: '-1', 'aria-hidden': 'true' }),
          el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr-only brief-ph-in-take', 'data-group': g.key, tabindex: '-1', 'aria-hidden': 'true' })),
        el('div', { class: 'brief-ph-grid', 'data-grid': g.key, 'aria-live': 'polite' })));
    });
    return wrap;
  }

  // ── rendering: the form ──────────────────────────────────────────────────────────────────────────────────────────────────
  function consentBlock() {
    consentEl = el('input', { type: 'checkbox', id: 'brief-consent', name: 'consent', 'aria-describedby': 'brief-consent-err' });
    consentErrEl = el('p', { class: 'brief-field-err brief-consent-err', id: 'brief-consent-err', hidden: true });
    var secs = (NOTICE.sections || []).map(function (s) {
      return el('div', { class: 'brief-notice-sec' }, el('h4', { text: s.heading }), el('p', { text: s.body }));
    });
    return el('div', { class: 'brief-consent-wrap' },
      el('label', { class: 'brief-consent', for: 'brief-consent' }, consentEl, el('span', { text: NOTICE.consentLine })),
      consentErrEl,
      el('details', { class: 'brief-notice' }, el('summary', { text: 'Read the full privacy notice (RA 10173)' }), secs, el('p', { class: 'brief-notice-ver', text: 'Notice version ' + NOTICE.version })));
  }

  function buildStep(sec) {
    var h = el('h2', { id: 'step-' + sec.key + '-h', tabindex: '-1', text: sec.title });
    var fieldsBox = el('div', { class: 'brief-fields' });
    sec.fields.forEach(function (f) { fieldsBox.appendChild(renderField(f)); });
    var hasRequired = sec.fields.some(function (f) { return f.required; });
    var node = el('section', { class: 'brief-step', id: 'step-' + sec.key, 'data-step': sec.key, 'aria-labelledby': h.id, hidden: true },
      el('header', { class: 'brief-step-head' }, h, sec.hint ? el('p', { class: 'brief-step-hint', text: sec.hint }) : null),
      hasRequired ? el('p', { class: 'brief-note-req' }, el('span', { class: 'brief-req', 'aria-hidden': 'true', text: '*' }), ' Required') : null,
      fieldsBox,
      sec === lastSection ? consentBlock() : null);
    stepEls[sec.key] = node;
    return node;
  }

  function ensureStep(sec) { if (sec && !stepEls[sec.key]) stepsBox.appendChild(buildStep(sec)); }
  function ensureTypeSteps() { sections.forEach(function (sec) { if (sec.when && sectionApplies(sec)) ensureStep(sec); }); }

  function buildShell() {
    clear(root);
    countEl = el('p', { class: 'brief-count', id: 'brief-count' });
    nowEl = el('p', { class: 'brief-now', id: 'brief-now' });
    navEl = el('ol', { class: 'brief-nav' });
    liveEl = el('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
    var aside = el('aside', { class: 'brief-aside' }, el('nav', { 'aria-label': 'Progress through the form' }, countEl, nowEl, navEl), liveEl);

    offlineEl = el('div', { class: 'brief-banner is-err', role: 'status', hidden: true, text: 'You are offline. Your draft is safe on this device; sending needs a connection.' });
    expiredEl = el('div', { class: 'brief-banner', role: 'status', hidden: true });
    hpEl = el('input', { name: 'fax_number', id: 'brief-hp', tabindex: '-1', autocomplete: 'off' });
    btnBack = el('button', { type: 'button', class: 'site-btn site-btn-outline brief-back', hidden: true, text: 'Back' });
    btnNext = el('button', { type: 'submit', class: 'site-btn site-btn-primary brief-next', text: 'Next' });
    savedEl = el('p', { class: 'brief-saved', 'aria-live': 'polite' });
    errEl = el('p', { class: 'brief-err', role: 'alert', 'aria-live': 'assertive' });
    stepsBox = el('div', { class: 'brief-steps' });
    // Only the parts every project answers are built now. The conditional part of a project type is built the first time that type is
    // chosen (ensureTypeSteps) and then kept, so what a visitor typed for a type is still there if they switch away and back, and the page
    // does not carry nine parts that most visitors will never open (a smaller DOM, a faster first paint).
    sections.forEach(function (sec) { if (!sec.when) stepsBox.appendChild(buildStep(sec)); });

    form = el('form', { class: 'brief-card brief-form', id: 'brief-form', novalidate: true, method: 'post', autocomplete: 'on', 'aria-label': 'Project brief' },
      el('p', { class: 'hp', 'aria-hidden': 'true' }, el('label', null, 'Fax number ', hpEl)),
      stepsBox, el('div', { class: 'brief-actions' }, btnBack, btnNext), savedEl, errEl);
    cardEl = form;
    doneEl = el('div', { class: 'brief-card brief-done', id: 'brief-done', role: 'status', hidden: true });
    layoutEl = el('div', { class: 'brief-layout' }, aside, el('div', { class: 'brief-col' }, offlineEl, expiredEl, form, doneEl));
    root.appendChild(layoutEl);

    if (MOCK) (doc.getElementById('site') || doc.body).appendChild(el('div', { class: 'brief-mock', text: 'Mock mode' + (SIM ? ' · sim=' + SIM : '') }));
  }

  // ── progress ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function renderNav() {
    var list = stepsList(), ci = indexOfKey(list, cur);
    if (reached > list.length - 1) reached = list.length - 1;
    clear(navEl);
    list.forEach(function (sec, i) {
      var st = i < ci ? 'is-done' : (i === ci ? 'is-current' : 'is-todo');
      var enabled = i <= reached && sec !== PENDING && i !== ci;
      navEl.appendChild(el('li', { class: 'brief-nav-item ' + st },
        el('button', { type: 'button', class: 'brief-nav-btn', 'data-go': sec.key, disabled: !enabled, 'aria-current': i === ci ? 'step' : null },
          el('span', { class: 'brief-nav-num', text: String(i + 1) }), el('span', { class: 'brief-nav-label', text: sec.short || sec.title }))));
    });
    countEl.textContent = 'Step ' + (ci + 1) + ' of ' + list.length;
    nowEl.textContent = (list[ci] && (list[ci].short || list[ci].title)) || '';
    return { list: list, ci: ci };
  }
  function updateActions() {
    var s = renderNav();
    btnBack.hidden = s.ci <= 0;
    btnNext.textContent = s.ci >= s.list.length - 1 ? def.submitLabel : 'Next';
    return s;
  }

  function goTo(key, opts) {
    opts = opts || {};
    var list = stepsList(), idx = indexOfKey(list, key);
    if (idx < 0 || list[idx] === PENDING) return;
    ensureStep(list[idx]);
    cur = key;
    if (idx > reached) reached = idx;
    sections.forEach(function (sec) { var n = stepEls[sec.key]; if (n) n.hidden = (sec.key !== key); });
    var s = updateActions();
    liveEl.textContent = 'Step ' + (s.ci + 1) + ' of ' + s.list.length + ': ' + (list[idx].short || list[idx].title);
    if (!opts.silent) {
      lastNavMs = Date.now();
      layoutEl.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      var h = stepEls[key].querySelector('h2');
      if (h) { try { h.focus({ preventScroll: true }); } catch (_) { h.focus(); } }
    }
    if (!opts.fromPop) { try { history[opts.replace ? 'replaceState' : 'pushState']({ briefStep: key }, ''); } catch (_) { /* a sandboxed frame: the progress bar and the buttons still work */ } }
    scheduleSave();
  }

  // ── errors ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function fieldWrap(key) { return form.querySelector('[data-field="' + key + '"]'); }
  function setFieldError(key, msg) {
    var wrap = fieldWrap(key);
    if (!wrap) return;
    var slot = wrap.querySelector('.brief-field-err');
    if (slot) { slot.textContent = msg; slot.hidden = false; }
    if (wrap.tagName === 'FIELDSET') wrap.classList.add('is-invalid');
    qsa('input,select,textarea', wrap).forEach(function (c) { c.setAttribute('aria-invalid', 'true'); });
  }
  function clearFieldError(key) {
    var wrap = fieldWrap(key);
    if (!wrap) return;
    var slot = wrap.querySelector('.brief-field-err');
    if (slot) { slot.textContent = ''; slot.hidden = true; }
    wrap.classList.remove('is-invalid');
    qsa('input,select,textarea', wrap).forEach(function (c) { c.removeAttribute('aria-invalid'); });
  }
  function clearAllErrors() {
    qsa('[data-field]', form).forEach(function (w) { clearFieldError(w.getAttribute('data-field')); });
    if (consentErrEl) { consentErrEl.textContent = ''; consentErrEl.hidden = true; }
    if (consentEl) consentEl.removeAttribute('aria-invalid');
    clear(errEl);
  }
  function setMessage(text, buttonLabel, buttonFn) {
    clear(errEl);
    errEl.appendChild(doc.createTextNode(text));
    if (buttonLabel) errEl.appendChild(on(el('button', { type: 'button', class: 'site-btn site-btn-outline site-btn-sm', text: buttonLabel }), 'click', buttonFn));
  }
  function focusField(key) {
    var wrap = fieldWrap(key);
    var c = wrap && wrap.querySelector('input:not([type="file"]),select,textarea');
    if (!c) return;
    c.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    try { c.focus({ preventScroll: true }); } catch (_) { c.focus(); }
  }

  // ── validation (the server re-checks everything; this is for the visitor's benefit) ─────────────────────────────────────
  function requiredMsg(f) {
    if (f.ui === 'cards') return 'Please choose one to continue.';
    if (isChoice(f) || f.type === 'select') return 'Please choose one.';
    if (f.type === 'chips') return 'Please choose at least one.';
    return 'Please fill this in.';
  }
  function validateSection(sec) {
    var errs = [];
    sec.fields.forEach(function (f) {
      if (f.type === 'photos') return;
      var v = readValue(f);
      if (isBlank(v)) { if (f.required) errs.push({ key: f.key, msg: requiredMsg(f) }); return; }
      if (f.type === 'tel' && !/^[0-9+\-\s().]{6,32}$/.test(v)) errs.push({ key: f.key, msg: 'Check this mobile number.' });
      else if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errs.push({ key: f.key, msg: 'Check this email address.' });
      else if (f.type === 'number') {
        var min = f.min != null ? f.min : 0, max = f.max != null ? f.max : 1e6;
        if (v < min || v > max) errs.push({ key: f.key, msg: 'Enter a number from ' + min.toLocaleString('en-PH') + ' to ' + max.toLocaleString('en-PH') + '.' });
        else if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) errs.push({ key: f.key, msg: 'Use at most two decimal places.' });
      }
    });
    (def.requireOneOf || []).forEach(function (g) {
      var here = g.keys.every(function (k) { return sectionOfField[k] === sec; });
      if (!here) return;
      if (g.keys.every(function (k) { return isBlank(readValue(fieldMap[k])); })) {
        errs.push({ key: g.keys[0], msg: g.message, also: g.keys.slice(1) });
      }
    });
    return errs;
  }
  function showErrors(errs) {
    errs.forEach(function (e) { setFieldError(e.key, e.msg); (e.also || []).forEach(function (k) { var w = fieldWrap(k); if (w) qsa('input,select,textarea', w).forEach(function (c) { c.setAttribute('aria-invalid', 'true'); }); }); });
    setMessage('Please check the highlighted fields.');
    focusField(errs[0].key);
  }

  // ── Next / Send ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  function onNext() {
    if (submitting || Date.now() - lastNavMs < 250) return;          // a double-tap on Next must not skip a step
    var list = stepsList(), ci = indexOfKey(list, cur), sec = list[ci];
    clearAllErrors();
    var errs = validateSection(sec);
    if (errs.length) { showErrors(errs); return; }
    if (ci >= list.length - 1) { onSubmit(); return; }
    goTo(list[ci + 1].key);
  }

  // ── photos: decode → shrink in the browser → upload one at a time (spec §4.4) ───────────────────────────────────────────
  function decodeViaImg(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function (e) { var img = new Image(); img.onload = function () { resolve(img); }; img.onerror = function () { resolve(null); }; img.src = e.target.result; };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(file);
    });
  }
  function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
        return createImageBitmap(file).catch(function () { return decodeViaImg(file); });
      });
    }
    return decodeViaImg(file);
  }
  function drawToBlob(src, longEdge, quality) {
    var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    var scale = Math.min(1, longEdge / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    var canvas = doc.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(src, 0, 0, cw, ch);
    return new Promise(function (resolve) {
      try { canvas.toBlob(function (blob) { resolve(blob); }, 'image/jpeg', quality); } catch (_e) { resolve(null); }
    }).then(function (blob) { return { blob: blob, width: cw, height: ch }; });
  }
  // quality 0.8 → 0.6 at the same edge → 1200 px at 0.6; null when nothing fits LIMITS.maxPhotoBytes
  function downscaleToJpeg(src) {
    var close = function () { try { if (typeof src.close === 'function') src.close(); } catch (_e) { /* an <img>, not a bitmap */ } };
    return drawToBlob(src, LIMITS.photoLongEdge, LIMITS.photoQuality).then(function (r1) {
      if (r1.blob && r1.blob.size <= LIMITS.maxPhotoBytes) { close(); return r1; }
      return drawToBlob(src, LIMITS.photoLongEdge, 0.6).then(function (r2) {
        if (r2.blob && r2.blob.size <= LIMITS.maxPhotoBytes) { close(); return r2; }
        return drawToBlob(src, 1200, 0.6).then(function (r3) { close(); return (r3.blob && r3.blob.size <= LIMITS.maxPhotoBytes) ? r3 : null; });
      });
    }).catch(function () { close(); return null; });
  }
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function allTiles() { var out = []; Object.keys(state.photos).forEach(function (g) { state.photos[g].forEach(function (t) { out.push(t); }); }); return out; }
  function countPhotos() { return allTiles().filter(function (t) { return t.status !== 'error'; }).length; }
  function bytesPhotos() { return allTiles().reduce(function (n, t) { return t.status !== 'error' ? n + (t.bytes || 0) : n; }, 0); }
  function findTile(id) { var f = null; allTiles().forEach(function (t) { if (t.tileId === id) f = t; }); return f; }
  function anyUploading() { return allTiles().some(function (t) { return t.status === 'uploading'; }); }
  function updatePhotoCounter() {
    var n = phCountEl; // held when the photos part is built (it is built lazily, so null until then)
    if (n) n.textContent = countPhotos() + ' of ' + LIMITS.maxPhotos + ' photos · ' + (bytesPhotos() / 1e6).toFixed(1) + ' MB';
  }

  function tileNode(tile) {
    var visual;
    if (tile.placeholder) visual = el('div', { class: 'brief-ph-blank', 'aria-hidden': 'true' }, icon('image', 26), el('span', { text: 'Uploaded. No preview after a reload.' }));
    else if (tile.status === 'error') visual = el('div', { class: 'brief-ph-blank', 'aria-hidden': 'true' }, icon('alert', 26));
    else if (tile.blobUrl) visual = el('img', { src: tile.blobUrl, alt: tile.caption || tile.name || '', loading: 'lazy' });
    else visual = el('div', { class: 'brief-ph-blank', 'aria-hidden': 'true' }, icon('image', 26));
    var statusText = tile.status === 'uploading' ? 'Uploading…' : (tile.status === 'uploaded' ? 'Uploaded' : (tile.errorMsg || 'Could not upload this photo.'));
    var status = (tile.status === 'error' && tile.retryable)
      ? el('button', { type: 'button', class: 'brief-ph-retry', 'data-tile': tile.tileId, text: statusText + '. Tap to retry.' })
      : el('div', { class: 'brief-ph-status' + (tile.status === 'error' ? ' is-err' : ''), text: statusText });
    return el('div', { class: 'brief-ph-tile', 'data-id': tile.tileId, 'data-status': tile.status },
      visual,
      el('input', { type: 'text', class: 'brief-ph-cap', maxlength: LIMITS.maxCaption, placeholder: 'Caption (optional)', 'aria-label': 'Photo caption', value: tile.caption || '', 'data-tile': tile.tileId }),
      status,
      el('div', { class: 'brief-ph-foot' }, el('button', { type: 'button', class: 'brief-ph-del', 'aria-label': 'Remove photo', 'data-tile': tile.tileId, text: '×' })));
  }
  function gridOf(group) { return form.querySelector('.brief-ph-grid[data-grid="' + group + '"]'); }
  // Only the tile that changed is replaced, so a caption being typed in another tile is never interrupted.
  function renderTile(tile) {
    var grid = gridOf(tile.group);
    if (!grid) return;
    var fresh = tileNode(tile);
    if (tile.node && tile.node.parentNode === grid) {
      var hadFocus = doc.activeElement && tile.node.contains(doc.activeElement) && doc.activeElement.classList.contains('brief-ph-cap');
      var pos = hadFocus ? doc.activeElement.selectionStart : 0;
      grid.replaceChild(fresh, tile.node);
      if (hadFocus) { var c = fresh.querySelector('.brief-ph-cap'); c.focus(); try { c.setSelectionRange(pos, pos); } catch (_) { /* not a text control */ } }
    } else grid.appendChild(fresh);
    tile.node = fresh;
  }
  function renderAllTiles() {
    qsa('.brief-ph-grid', form).forEach(clear);
    allTiles().forEach(function (t) { t.node = null; renderTile(t); });
    updatePhotoCounter();
  }
  function addTile(tile) {
    (state.photos[tile.group] = state.photos[tile.group] || []).push(tile);
    renderTile(tile); updatePhotoCounter(); scheduleSave();
  }
  function addErrorTile(group, name, msg) {
    addTile({ tileId: 't_' + (++tileCounter), group: group, name: name, bytes: 0, status: 'error', errorMsg: msg, retryable: false, caption: '' });
  }

  function ensureDraftToken(force) {
    if (state.draftToken && !force) return Promise.resolve(state.draftToken);
    return Cir.startDraft().then(function (res) {
      state.draftToken = res.draftToken;
      state.draftCreatedAtIso = res.serverNow || new Date().toISOString();
      state.draftStartedLocalMs = Date.now();
      scheduleSave();
      return state.draftToken;
    });
  }
  // unauthenticated (a bad or expired draft token) → clear it, request a new one, retry ONCE; a second one is a generic error
  function withTokenRetry(make) {
    return make().catch(function (err) {
      if (normalizeError(err).code !== 'unauthenticated') return Promise.reject(err);
      state.draftToken = null; scheduleSave();
      return ensureDraftToken(true).then(function () {
        return make().catch(function (err2) {
          return Promise.reject(normalizeError(err2).code === 'unauthenticated' ? { code: 'internal', message: GENERIC_ERR } : err2);
        });
      });
    });
  }
  function fireRemove(photoId) {
    if (!photoId || !state.draftToken) return;
    var attempt = function () { return Cir.removePhoto({ draftToken: state.draftToken, photoId: photoId }); };
    attempt().catch(function () { attempt().catch(function () { /* best effort: the server purges abandoned drafts */ }); });
  }
  function uploadTile(tile, dataUrl) {
    if (dataUrl && dataUrl.length > 1300000) {
      tile.status = 'error'; tile.retryable = false; tile.errorMsg = 'Photo is too large.'; renderTile(tile); updatePhotoCounter();
      return Promise.resolve();
    }
    return ensureDraftToken(false).then(function () {
      return withTokenRetry(function () { return Cir.uploadPhoto({ draftToken: state.draftToken, group: tile.group, caption: '', dataUrl: dataUrl, width: tile.width || 0, height: tile.height || 0 }); });
    }).then(function (res) {
      if (tile.cancelled) { fireRemove(res.photoId); return; }
      tile.photoId = res.photoId; tile.status = 'uploaded'; tile.retryable = false;
      renderTile(tile); updatePhotoCounter(); scheduleSave();
    }).catch(function (err) {
      var n = normalizeError(err);
      tile.status = 'error';
      if (n.code === 'resource-exhausted' || n.code === 'invalid-argument') { tile.errorMsg = n.message; tile.retryable = false; }
      else { tile.errorMsg = 'Upload failed'; tile.retryable = true; }
      renderTile(tile); updatePhotoCounter();
    });
  }
  var DECODE_MSG = 'Could not read this photo on this device. Try a JPEG or PNG, or a screenshot of it.';
  function processOneFile(file, group) {
    if (countPhotos() >= LIMITS.maxPhotos) { addErrorTile(group, file.name, 'Up to ' + LIMITS.maxPhotos + ' photos per brief.'); return Promise.resolve(); }
    if (file.type && !/^image\//.test(file.type)) { addErrorTile(group, file.name, 'Not an image.'); return Promise.resolve(); }
    return decodeImage(file).then(function (src) {
      if (!src) { addErrorTile(group, file.name, DECODE_MSG); return; }
      return downscaleToJpeg(src).then(function (r) {
        if (!r || !r.blob) { addErrorTile(group, file.name, 'This photo is too detailed to shrink. Try a different one.'); return; }
        if (bytesPhotos() + r.blob.size > LIMITS.maxTotalPhotoBytes) { addErrorTile(group, file.name, 'Photos total is over the limit. Remove one and try again.'); return; }
        var tile = { tileId: 't_' + (++tileCounter), group: group, name: file.name, bytes: r.blob.size, status: 'uploading', blobUrl: URL.createObjectURL(r.blob), blob: r.blob, width: r.width, height: r.height, caption: '', retryable: false };
        addTile(tile);
        uploadsInFlight++;
        return blobToDataUrl(r.blob).then(function (dataUrl) { return uploadTile(tile, dataUrl); }).then(function () { uploadsInFlight--; }, function () { uploadsInFlight--; });
      });
    }).catch(function () { addErrorTile(group, file.name, DECODE_MSG); });
  }
  function processQueue() {
    if (queueRunning) return;
    queueRunning = true;
    (function next() {
      var item = photoQueue.shift();
      if (!item) { queueRunning = false; return; }
      processOneFile(item.file, item.group).then(next, next);
    })();
  }
  function enqueueFiles(list, group) {
    Array.prototype.forEach.call(list || [], function (file) { photoQueue.push({ file: file, group: group }); });
    processQueue();
  }
  function revoke(tile) { if (tile.blobUrl) { try { URL.revokeObjectURL(tile.blobUrl); } catch (_) { /* already gone */ } } }
  function removeTile(id) {
    var tile = findTile(id);
    if (!tile) return;
    revoke(tile);
    var arr = state.photos[tile.group] || [], i = arr.indexOf(tile);
    if (i !== -1) arr.splice(i, 1);
    if (tile.node && tile.node.parentNode) tile.node.parentNode.removeChild(tile.node);
    updatePhotoCounter(); scheduleSave();
    if (tile.status === 'uploading') { tile.cancelled = true; return; }
    if (tile.photoId) fireRemove(tile.photoId);
  }
  function retryTile(id) {
    var tile = findTile(id);
    if (!tile || tile.status !== 'error' || !tile.retryable || !tile.blob) return;
    tile.status = 'uploading'; tile.errorMsg = '';
    renderTile(tile); updatePhotoCounter();
    uploadsInFlight++;
    blobToDataUrl(tile.blob).then(function (d) { return uploadTile(tile, d); }).then(function () { uploadsInFlight--; }, function () { uploadsInFlight--; });
  }

  // ── the draft (this device only; never image bytes) ──────────────────────────────────────────────────────────────────────
  var saveTimer = null, touched = false;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 300); }
  function saveDraft() {
    try {
      var answers = {};
      Object.keys(fieldMap).forEach(function (k) { var v = readValue(fieldMap[k]); if (!isBlank(v)) answers[k] = v; });
      // only photos that finished uploading (a real server photoId) come back after a reload — as placeholder tiles
      var photos = allTiles().filter(function (t) { return t.status === 'uploaded' && t.photoId; })
        .map(function (t) { return { photoId: t.photoId, group: t.group, caption: t.caption || '', name: t.name || '', bytes: t.bytes || 0 }; });
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        answers: answers, photos: photos, step: cur, reached: reached,
        draftToken: state.draftToken, draftCreatedAtIso: state.draftCreatedAtIso, startedAtMs: state.startedAtMs, savedAtMs: Date.now()
      }));
      if (touched) savedEl.textContent = 'Draft saved on this device.';
    } catch (_) { /* private mode or storage disabled: degrade silently */ }
  }
  function loadDraft() {
    try { var raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
  }
  function clearDraftStorage() { try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* nothing stored */ } }
  // A visitor who had started the ORIGINAL commissary form on this device keeps what still applies — the five contact details — and the
  // rest of that draft is removed (it belongs to a questionnaire that no longer exists). Only plain strings are taken, and only the
  // keys both forms share; everything then passes through the same checks as any restored draft.
  function migrateOldDraft() {
    try {
      var raw = localStorage.getItem(OLD_DRAFT_KEY);
      if (!raw) return null;
      localStorage.removeItem(OLD_DRAFT_KEY);
      var old = JSON.parse(raw), a = old && old.answers, keep = {}, n = 0;
      if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
      ['name', 'position', 'company', 'phone', 'email'].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(a, k) && typeof a[k] === 'string' && a[k].trim()) { keep[k] = a[k]; n++; }
      });
      return n ? { answers: keep, migrated: true } : null;
    } catch (_) { return null; }
  }
  var PHOTO_ID_RE = /^p_[0-9a-f]{12}$/;
  function groupExists(g) { return (photosField.groups || []).some(function (x) { return x.key === g; }); }
  function restoreDraft(data) {
    if (!data || typeof data !== 'object') return;
    var answers = (data.answers && typeof data.answers === 'object' && !Array.isArray(data.answers)) ? data.answers : {};
    if (Object.prototype.hasOwnProperty.call(answers, 'project_type')) writeValue(typeField, answers.project_type);
    ensureTypeSteps();
    Object.keys(answers).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(fieldMap, k)) return;
      ensureStep(sectionOfField[k]);                    // an answer saved for another type's part brings that part back too
      writeValue(fieldMap[k], answers[k]);
    });
    state.startedAtMs = (typeof data.startedAtMs === 'number' && isFinite(data.startedAtMs)) ? data.startedAtMs : Date.now();
    var created = typeof data.draftCreatedAtIso === 'string' ? Date.parse(data.draftCreatedAtIso) : NaN;
    var expired = !isNaN(created) && (Date.now() - created > LIMITS.draftTtlMs);
    if (expired) {
      expiredEl.textContent = 'Your earlier photos expired after 7 days. Please add them again.'; expiredEl.hidden = false;
    } else if (typeof data.draftToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(data.draftToken)) {
      state.draftToken = data.draftToken; state.draftCreatedAtIso = data.draftCreatedAtIso || null;
      (Array.isArray(data.photos) ? data.photos : []).slice(0, LIMITS.maxPhotos).forEach(function (p) {
        if (!p || typeof p.photoId !== 'string' || !PHOTO_ID_RE.test(p.photoId) || typeof p.group !== 'string' || !groupExists(p.group)) return;
        (state.photos[p.group] = state.photos[p.group] || []).push({
          tileId: 't_' + (++tileCounter), photoId: p.photoId, group: p.group,
          name: typeof p.name === 'string' ? p.name.slice(0, 200) : '', bytes: (typeof p.bytes === 'number' && isFinite(p.bytes)) ? p.bytes : 0,
          caption: typeof p.caption === 'string' ? p.caption.slice(0, LIMITS.maxCaption) : '', status: 'uploaded', placeholder: true, retryable: false
        });
      });
    }
    if (data.migrated) { expiredEl.textContent = 'We kept your contact details from the earlier form you started on this device.'; expiredEl.hidden = false; }
    renderAllTiles();
    var list = stepsList();
    var step = typeof data.step === 'string' ? data.step : '';
    reached = (typeof data.reached === 'number' && isFinite(data.reached)) ? Math.max(0, Math.min(list.length - 1, Math.floor(data.reached))) : 0;
    if (indexOfKey(list, step) > -1 && list[indexOfKey(list, step)] !== PENDING) cur = step;
    // Nothing after step 1 can be shown until a project type is chosen (the next parts depend on it): a draft without a usable one starts over there.
    if (!readValue(typeField)) { cur = sections[0].key; reached = 0; }
  }

  // ── Send ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function buildPayload() {
    var answers = {};
    stepsList().forEach(function (sec) {          // ONLY the parts that apply to the chosen type: another type's answers are never sent
      sec.fields.forEach(function (f) { if (f.type === 'photos') return; var v = readValue(f); if (!isBlank(v)) answers[f.key] = v; });
    });
    var photos = [];
    allTiles().forEach(function (t) {
      if (t.status === 'uploaded' && t.photoId) photos.push({ photoId: t.photoId, group: t.group, caption: (t.caption || '').slice(0, LIMITS.maxCaption) });
    });
    return {
      draftToken: state.draftToken, formId: FORM_ID, formVersion: def.formVersion, answers: answers, photos: photos,
      consent: { agreed: true, noticeVersion: NOTICE.version }, honeypot: hpEl.value, fillMs: Date.now() - state.startedAtMs
    };
  }
  // The server treats a brief sent within LIMITS.minFillMs of the draft being opened as a bot and quietly drops it, so a fast, honest
  // visitor (autofill, a short brief) is held for the few seconds that are left rather than losing the lead.
  function waitForMinFill() {
    var need = (LIMITS.minFillMs || 15000) + 1500, age;
    if (state.draftStartedLocalMs) age = Date.now() - state.draftStartedLocalMs;
    else { var t = Date.parse(state.draftCreatedAtIso || ''); age = isNaN(t) ? Infinity : Date.now() - t; }
    return age >= need ? Promise.resolve() : delay(need - age);
  }
  function handleSubmitError(err) {
    if (err.code === 'failed-precondition') {
      setMessage(err.message, 'Reload', function () { location.reload(); });
    } else if (err.code === 'resource-exhausted' || err.code === 'already-exists') {
      setMessage(err.message);
    } else if (err.code === 'invalid-argument') {
      setMessage(err.message);
      // a server message quotes the field's label: take the visitor to that field
      var hit = null;
      Object.keys(fieldMap).forEach(function (k) { if (!hit && err.message.indexOf('"' + fieldMap[k].label + '"') !== -1) hit = fieldMap[k]; });
      if (hit) {
        var list = stepsList(), sec = sectionOfField[hit.key];
        if (indexOfKey(list, sec.key) > -1) { goTo(sec.key, { silent: true }); focusField(hit.key); }
      }
    } else {
      setMessage(GENERIC_ERR, 'Try again', function () { onSubmit(); });
      if (!navigator.onLine) offlineEl.hidden = false;
    }
  }
  function onSubmit() {
    if (submitting) return;
    clearAllErrors();
    var list = stepsList();
    for (var i = 0; i < list.length; i++) {            // every part, in order: the first one with a problem is shown
      var sec = list[i];
      if (sec === PENDING) continue;
      var errs = validateSection(sec);
      if (errs.length) { goTo(sec.key, { silent: i === indexOfKey(list, cur) }); showErrors(errs); return; }
    }
    if (!consentEl.checked) {
      goTo(lastSection.key, { silent: true });
      consentErrEl.textContent = 'Please tick the box to give your consent.'; consentErrEl.hidden = false;
      consentEl.setAttribute('aria-invalid', 'true');
      setMessage('Please tick the data privacy consent.');
      consentEl.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); consentEl.focus({ preventScroll: true });
      return;
    }
    if (anyUploading()) { setMessage('Please wait for the photos to finish uploading, or remove them, before sending.'); return; }
    submitting = true;
    btnNext.disabled = true; btnBack.disabled = true;
    var label = btnNext.textContent;
    btnNext.textContent = 'Sending…';
    ensureDraftToken(false).then(function () {
      var probe = JSON.stringify(buildPayload());
      if (probe.length > LIMITS.maxPayloadBytes) return Promise.reject({ code: 'invalid-argument', message: 'The form is too long. Please shorten your longest answers.' });
      return waitForMinFill().then(function () { return withTokenRetry(function () { return Cir.submit(buildPayload()); }); });
    }).then(onSent).catch(function (err) { handleSubmitError(normalizeError(err)); }).then(function () {
      submitting = false; btnNext.disabled = false; btnBack.disabled = false;
      if (!form.hidden) btnNext.textContent = label;
    });
  }

  // ── the receipt ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  function displayValue(f, v) {
    if (f.type === 'chips') return v.map(function (x) { return labelFor(f, x); }).join(', ');
    if (f.type === 'select') return labelFor(f, v);
    if (f.type === 'date') return fmtDate(v);
    if (f.type === 'number') return Number(v).toLocaleString('en-PH');
    return String(v);
  }
  function summaryNode() {
    var box = el('div', { class: 'brief-sum' });
    stepsList().forEach(function (sec) {
      if (sec === PENDING) return;
      var rows = [];
      sec.fields.forEach(function (f) {
        if (f.type === 'photos') {
          (f.groups || []).forEach(function (g) {
            var n = (state.photos[g.key] || []).filter(function (t) { return t.status === 'uploaded'; }).length;
            if (n) rows.push(el('div', { class: 'brief-sum-row' }, el('dt', { text: g.label }), el('dd', { text: n + ' photo' + (n === 1 ? '' : 's') })));
          });
          return;
        }
        var v = readValue(f);
        if (isBlank(v)) return;
        rows.push(el('div', { class: 'brief-sum-row' }, el('dt', { text: f.label }), el('dd', { text: displayValue(f, v) })));
      });
      if (rows.length) box.appendChild(el('div', { class: 'brief-sum-sec' }, el('h3', { text: sec.title }), el('dl', null, rows)));
    });
    return box;
  }
  function renderDone(res) {
    clear(doneEl);
    var printBtn = on(el('button', { type: 'button', class: 'site-btn site-btn-primary', text: 'Save receipt as PDF' }), 'click', function () {
      doc.body.classList.add('print-receipt'); window.print();
    });
    var againBtn = on(el('button', { type: 'button', class: 'site-btn site-btn-outline', text: 'Send another brief' }), 'click', resetForAnother);
    doneEl.appendChild(el('div', { class: 'brief-done-mark', 'aria-hidden': 'true' }, icon('check', 24)));
    var heading = el('h2', { id: 'brief-done-h', tabindex: '-1', text: def.doneTitle });
    doneEl.appendChild(heading);
    doneEl.appendChild(el('p', { class: 'brief-done-lead', text: def.doneBody }));
    doneEl.appendChild(el('p', { class: 'brief-ref-label', text: 'Reference number' }));
    doneEl.appendChild(el('p', { class: 'brief-ref', text: res.refNo }));
    doneEl.appendChild(el('p', { class: 'brief-received', text: 'Received ' + fmtDate(res.submittedOnManila || manilaDateFromMs(Date.parse(res.receivedAt) || Date.now())) + '. Keep this number if you need to ask about your brief.' }));
    doneEl.appendChild(el('div', { class: 'brief-actions' }, printBtn, againBtn));
    // The same link the site writes everywhere (css/site.css draws .msg-ic): the chat-bubble icon, target=_blank, rel=noopener, a bare data-brand
    // because the handle is the brand's. No Meta logo, no image, no script.
    doneEl.appendChild(el('p', { class: 'brief-help' },
      el('span', { text: 'Questions? ' }),
      el('a', { class: 'brief-msgr', href: MESSENGER_URL, rel: 'noopener', target: '_blank', 'data-brand': true }, icon('chat', 16, 'msg-ic'), 'Message us on Messenger'),
      el('span', null, ' or call ', el('a', { href: 'tel:+639276836300', text: PHONE }))));
    doneEl.appendChild(summaryNode());
    // on paper the page chrome is gone, so the receipt carries who to call (hidden on screen, shown by the print rules)
    doneEl.appendChild(el('p', { class: 'brief-print-contact', text: 'Barro Industries OPC · 21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila · ' + PHONE + ' · hello@barroindustries.com' }));
    return heading; // focus lands here once the receipt is shown (the screen-reader announcement; no id lookup needed)
  }
  function onSent(res) {
    clearDraftStorage();
    var h = renderDone(res);
    form.hidden = true; layoutEl.querySelector('.brief-aside').hidden = true; offlineEl.hidden = true; expiredEl.hidden = true;
    doneEl.hidden = false;
    layoutEl.classList.add('is-done');
    doneEl.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    if (h) { try { h.focus({ preventScroll: true }); } catch (_) { h.focus(); } }
  }
  function resetForAnother() {
    form.reset();
    allTiles().forEach(revoke);
    state.photos = {}; state.draftToken = null; state.draftCreatedAtIso = null; state.draftStartedLocalMs = 0; state.startedAtMs = Date.now();
    clearDraftStorage();
    qsa('.brief-ph-grid', form).forEach(clear);
    updatePhotoCounter();
    clearAllErrors();
    doneEl.hidden = true; form.hidden = false; layoutEl.querySelector('.brief-aside').hidden = false; layoutEl.classList.remove('is-done');
    reached = 0; cur = sections[0].key;
    goTo(cur, { replace: false });
    ensureDraftToken(true).catch(function () { /* a token is minted again on the first upload or send */ });
  }

  // ── wiring ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function wire() {
    on(form, 'submit', function (e) { e.preventDefault(); onNext(); });
    on(btnBack, 'click', function () {
      if (submitting) return;
      var s = stepsList(), ci = indexOfKey(s, cur);
      if (ci > 0) goTo(s[ci - 1].key);
    });
    on(navEl, 'click', function (e) {
      var b = e.target.closest ? e.target.closest('.brief-nav-btn') : null;
      if (b && !b.disabled && !submitting) goTo(b.getAttribute('data-go'));
    });
    on(form, 'input', function (e) {
      var t = e.target;
      touched = true;
      if (t.classList && t.classList.contains('brief-ph-cap')) { var tile = findTile(t.getAttribute('data-tile')); if (tile) { tile.caption = t.value; scheduleSave(); } return; }
      var w = t.closest ? t.closest('[data-field]') : null;
      if (w) clearFieldError(w.getAttribute('data-field'));
      scheduleSave();
    });
    on(form, 'change', function (e) {
      var t = e.target;
      touched = true;
      if (t.classList && (t.classList.contains('brief-ph-in-add') || t.classList.contains('brief-ph-in-take'))) { enqueueFiles(t.files, t.getAttribute('data-group')); return; }
      if (t.name === 'consent') { consentErrEl.hidden = true; consentEl.removeAttribute('aria-invalid'); }
      var w = t.closest ? t.closest('[data-field]') : null;
      if (w) clearFieldError(w.getAttribute('data-field'));
      if (t.name === 'project_type') { ensureTypeSteps(); updateActions(); }   // the conditional part, the number of steps and its name follow the type
      scheduleSave();
    });
    // an optional single choice can be cleared by tapping the chosen pill again
    on(form, 'pointerdown', function (e) {
      var lab = e.target.closest ? e.target.closest('.brief-pill') : null;
      var r = lab && lab.querySelector('input[type="radio"][data-clearable]');
      if (r) r.setAttribute('data-was', r.checked ? '1' : '0');
    });
    on(form, 'click', function (e) {
      var t = e.target;
      if (t.type === 'radio' && t.getAttribute('data-clearable') && t.getAttribute('data-was') === '1') {
        t.checked = false; t.setAttribute('data-was', '0');
        var w = t.closest('[data-field]'); if (w) clearFieldError(w.getAttribute('data-field'));
        updateActions(); scheduleSave();
        return;
      }
      var add = t.closest ? t.closest('.brief-ph-add') : null;
      if (add) { var i1 = add.parentNode.querySelector('.brief-ph-in-add'); i1.value = ''; i1.click(); return; }
      var take = t.closest ? t.closest('.brief-ph-take') : null;
      if (take) { var i2 = take.parentNode.querySelector('.brief-ph-in-take'); i2.value = ''; i2.click(); return; }
      var del = t.closest ? t.closest('.brief-ph-del') : null;
      if (del) { removeTile(del.getAttribute('data-tile')); return; }
      var retry = t.closest ? t.closest('.brief-ph-retry') : null;
      if (retry) retryTile(retry.getAttribute('data-tile'));
    });
    on(form, 'wheel', function (e) { if (e.target.type === 'number' && doc.activeElement === e.target) e.target.blur(); }, { passive: true });
    on(window, 'popstate', function (e) {
      if (submitting || form.hidden) return;
      var key = e.state && e.state.briefStep;
      if (key && Object.prototype.hasOwnProperty.call(stepEls, key)) goTo(key, { fromPop: true });
    });
    on(window, 'afterprint', function () { doc.body.classList.remove('print-receipt'); });
    on(window, 'offline', function () { offlineEl.hidden = false; });
    on(window, 'online', function () { offlineEl.hidden = true; });
    if (navigator.onLine === false) offlineEl.hidden = false;
    on(window, 'beforeunload', function (e) { if (uploadsInFlight > 0) { e.preventDefault(); e.returnValue = ''; } });
  }

  function init() {
    buildShell();
    wire();
    restoreDraft(loadDraft() || migrateOldDraft());
    updatePhotoCounter();
    goTo(cur, { silent: true, replace: true });
    root.classList.add('is-ready');
    ensureDraftToken(false).catch(function () { /* not fatal at load: a token is minted on the first upload or send */ });
  }
  init();
})();
