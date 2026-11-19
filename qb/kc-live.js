/* ==============================================================================================================
   qb/kc-live.js: window.KCLive.   The bridge between the configurators (window.KC, window.D7) and the live system: Firestore reads and writes, the user's role, the office switch, the approval carry, the cost
   sidecar summary, the one-time price import.   Specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md sections 2.2, 3.1 to 3.6, 4.3, 5 packet C.
   It is the LAST script the builder loads (spec 4.2) and its final statement is `D7.live = true`, made only when everything it needs is present; a missing or broken file leaves the whole feature off.
   No price is written here: every price is read at run time from Firestore (kc_materials, kc_config/list_prices, kc_config/settings) and lives in memory only.

   READS  KCLive.load()   called by the page once per loadDatabase() success, awaited before initUI().  Five reads, each in its own try / catch, in one Promise.all:
            users/{uid} (the role) · settings/quote_builder (the switch and the flags) · kc_config/settings (KC.SET, KC.FLOOR_MODE) · kc_config/list_prices (KC.LISTP) · kc_materials (KC.P)
          It never throws and never waits for more than 6 seconds (then the state is 'offline').  On file: or with no `db` it resolves at once as 'offline'.
          KCLive.state     'idle' (load() has not run) | 'loading' | 'live' | 'denied' | 'offline'      KCLive.ready  state === 'live'
          READ-ONLY UNTIL READY (spec 2.2): while KCLive.ready is false no kc function changes a stored unitPrice, amount, needsPrice or reviewed (the adapter, the pricing file and the host check it).
          Stricter than the spec on purpose: the state is not 'live' when ANY of the three price reads (settings, list prices, materials) failed, not only the materials one; a missing document is not a failure.
          THE CORNER CHARGE lives twice: kc_config/settings.corner (KC.SET.corner: the L / U stations ask whether it is set) and the price-list row kc_materials/cornerc (KC.P.cornerc.p: the price the engine
          multiplies by the number of corners).  They are kept in step: at load the price-list row wins when it has a number, else the settings' number, and the other follows in memory; saveSettings({ corner })
          also writes the row, and saveMaterial('cornerc', ...) also writes the settings' number when the President does it (Purchasing changes the row only).
   ROLE   KCLive.roleOf(profile)   president | purchasing | manager (Operations) | sales (also Finance and any profile that could not be read)
   SWITCH KCLive.allowsNew()       may a BLANK quote start on the configurators for this person: settings/quote_builder.kcMode ('off' default | 'president' | 'on') x role, with the per-device override in
                                   localStorage.bkqb_kc_force ('1' = on for this device, '0' = off).  Never true before the prices are ready.
          KCLive.flags             { kcMode, approveAll, approvalBelowStandard, catalogueCostPricing }  (defaults: 'off', false, 'force', false)
   APPROVAL  KCLive.afterLoad(state)   after every LOAD_QUOTE / LOAD_TEMPLATE: for a state that came from a filed quote it reads that quote and its cost sidecar, builds the approval carry (spec 3.4), grafts the typed
                                   costs back into the lines' cfg (in memory only), then reprices and redraws.   KCLive.carry() / setCarry(c)   the carry the page keeps in its pricing fields.
   SIDECAR   KCLive.sidecarExtras()   { kcSummary, approval } for quote_costs/<coll>_<docId> (spec 3.4): exactly those keys, never undefined.
   WRITES (all stamp updatedAt / updatedBy / updatedByName, and update KC.* in memory when they succeed; the CALLER then runs D7.pricing.repriceAll() and renderItems()):
          KCLive.importSeed(json)             President only: the whole seed (spec 3.6) in batches of at most 400.  Idempotent: a second run adds no history entry.
          KCLive.saveMaterial(key, patch)     President, Purchasing.  patch: any of p, source, hp, cfm, sp, fam, ratingNote and (a row added from the screen) l, u, cat, grade, size.  A changed price appends one
                                              history entry { d, p, by } (newest last, at most 20); a changed rating appends { d, note:'rating changed', rating: ratingNote, by }.
          KCLive.saveSettings(patch)          President.  patch: nested numbers shaped like KC.SET (br, misc, markup, corner, hood, duct), and floorMode 'list' | 'formula'.
          KCLive.saveListPrices(rows, eff?)   President.  rows: { code: price }; a price above 0 is set, null removes the code.
          KCLive.saveSwitch(patch)            President.  patch: any of kcMode, approveAll, approvalBelowStandard, catalogueCostPricing.
   ============================================================================================================== */
(function () {
  'use strict';
  var D7 = window.D7 = window.D7 || {};
  var KCLive = window.KCLive = window.KCLive || {};
  var LOAD_TIMEOUT_MS = 6000;

  /* ---------- small helpers ---------- */
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
  function str(x) { return typeof x === 'string' ? x : (x == null ? '' : String(x)); }
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function warn(msg, err) { try { console.warn('[kc-live] ' + msg, err || ''); } catch (e) { /* no console */ } }
  function today() { try { if (window.KC && KC.today) return KC.today(); } catch (e) { /* fall through */ } return new Date().toISOString().slice(0, 10); }
  function dbReady() { try { return typeof db !== 'undefined' && !!db && typeof db.collection === 'function'; } catch (e) { return false; } }       // `db` and `auth` are top-level consts of js/firebase-config.js: bare names only
  function currentUser() { try { return (typeof auth !== 'undefined' && auth && auth.currentUser) || null; } catch (e) { return null; } }
  function onFile() { try { return location.protocol === 'file:'; } catch (e) { return false; } }
  function stamp() {
    try { if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) return firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { /* fall through */ }
    return new Date().toISOString();
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function isoOf(ts) {                                              // a Firestore Timestamp, {seconds}, a string or a number -> an ISO string, or null
    try {
      if (!ts) return null;
      if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
      if (isNum(ts.seconds)) return new Date(ts.seconds * 1000).toISOString();
      if (typeof ts === 'string') return ts;
      if (isNum(ts)) return new Date(ts).toISOString();
    } catch (e) { /* fall through */ }
    return null;
  }

  /* ---------- the state ---------- */
  var DEFAULT_FLAGS = Object.freeze({ kcMode: 'off', approveAll: false, approvalBelowStandard: 'force', catalogueCostPricing: false });
  var addedKeys = {};                                               // kc_materials rows that are not in qb/kc/materials.js (added from the screen): they are put away before every load
  var carry = null;                                                 // the approval carry of the quote open now (spec 3.4)
  var loading = null;

  /* the engine file starts every session as the President (it is the prototype's default): until KCLive.load has read the user's own profile, nobody is. */
  try { if (window.KC && KC.S) KC.S.role = 'sales'; } catch (e) { /* ignore */ }
  try { if (document.body) document.body.dataset.role = 'sales'; } catch (e) { /* ignore */ }

  KCLive.state = 'idle';
  KCLive.ready = false;
  KCLive.role = 'sales';
  KCLive.userName = '';
  KCLive.detail = '';
  KCLive.flags = Object.assign({}, DEFAULT_FLAGS);
  KCLive.TIMEOUT_MS = LOAD_TIMEOUT_MS;

  function setState(st, why) {
    KCLive.state = st; KCLive.ready = (st === 'live'); KCLive.detail = why || '';
  }

  /* ============================== the role (spec 3.2) ============================== */
  function listOf(v) {
    var out = [];
    (Array.isArray(v) ? v : (typeof v === 'string' ? [v] : [])).forEach(function (x) { var s = str(x).trim().toLowerCase(); if (s) out.push(s); });
    return out;
  }
  /* president -> president; a Purchasing department -> purchasing; role manager or a Production department -> manager (Operations); anything else, and a profile that could not be read -> sales */
  KCLive.roleOf = function (profile) {
    if (!isObj(profile)) return 'sales';
    if (str(profile.role).trim().toLowerCase() === 'president') return 'president';
    var depts = listOf(profile.departments).concat(listOf(profile.department));
    if (depts.indexOf('purchasing') >= 0) return 'purchasing';
    if (str(profile.role).trim().toLowerCase() === 'manager' || depts.indexOf('production') >= 0) return 'manager';
    return 'sales';
  };
  function nameOf(profile) {
    var u = currentUser();
    return str((isObj(profile) && (profile.name || profile.displayName || profile.fullName)) || (u && u.displayName) || '').trim();
  }

  /* ============================== the switch (spec 2.2) ============================== */
  function flagsOf(d) {
    var f = Object.assign({}, DEFAULT_FLAGS);
    if (!isObj(d)) return f;
    if (d.kcMode === 'president' || d.kcMode === 'on' || d.kcMode === 'off') f.kcMode = d.kcMode;
    if (d.approveAll === true) f.approveAll = true;
    if (d.approvalBelowStandard === 'tick') f.approvalBelowStandard = 'tick';
    if (d.catalogueCostPricing === true) f.catalogueCostPricing = true;
    return f;
  }
  /* the per-device override: '1' = treat the switch as 'on' on this device, '0' = treat it as 'off'; anything else follows the office setting */
  KCLive.force = function () { var v = lsGet('bkqb_kc_force'); return v === '1' ? '1' : (v === '0' ? '0' : null); };
  KCLive.allowsNew = function () {
    if (!KCLive.ready) return false;                                // no prices, no new configured quote
    var f = KCLive.force();
    if (f === '0') return false;
    if (f === '1') return true;
    var m = KCLive.flags.kcMode;
    if (m === 'on') return true;
    if (m === 'president') return KCLive.role === 'president';
    return false;
  };

  /* ============================== the reads (spec 4.3) ============================== */
  function getDoc(coll, id) {
    try {
      return db.collection(coll).doc(id).get().then(function (s) { return { ok: true, exists: !!s.exists, data: s.exists ? (s.data() || {}) : null }; },
        function (err) { return { ok: false, err: err }; });
    } catch (err) { return Promise.resolve({ ok: false, err: err }); }
  }
  /* the user's own profile.  Inside the ops app the builder runs in an iframe, and there a direct get() of users/<uid> can hang (the app's presence heartbeat writes that
     document all the time; on v15.0.2 the President loaded as Sales because the read never answered).  A query by document id answers at once, so after PROFILE_WAIT_MS
     the read asks that way instead, and last the local cache.  Whichever answers first wins; an error falls through to the next way. */
  var PROFILE_WAIT_MS = 2500;
  function getProfile(uid) {
    var WAIT = {};
    function viaQuery() {
      try {
        var fp = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldPath) ? firebase.firestore.FieldPath.documentId() : null;
        if (!fp) return Promise.resolve({ ok: false, err: { code: 'no-fieldpath' } });
        return db.collection('users').where(fp, '==', uid).limit(1).get().then(function (s) {
          var d = s && s.docs && s.docs[0]; return { ok: true, exists: !!d, data: d ? (d.data() || {}) : null };
        }, function (err) { return { ok: false, err: err }; });
      } catch (err) { return Promise.resolve({ ok: false, err: err }); }
    }
    function viaCache() {
      try {
        return db.collection('users').doc(uid).get({ source: 'cache' }).then(function (s) { return { ok: true, exists: !!s.exists, data: s.exists ? (s.data() || {}) : null }; },
          function (err) { return { ok: false, err: err }; });
      } catch (err) { return Promise.resolve({ ok: false, err: err }); }
    }
    var direct = getDoc('users', uid);
    var wait = new Promise(function (res) { setTimeout(function () { res(WAIT); }, PROFILE_WAIT_MS); });
    return Promise.race([direct, wait]).then(function (r) {
      if (r !== WAIT && r.ok) return r;
      return viaQuery().then(function (q) { return q.ok ? q : viaCache().then(function (c) { return c.ok ? c : (r !== WAIT ? r : q); }); });
    });
  }
  function getAll(coll) {
    try {
      return db.collection(coll).get().then(function (s) {
        var rows = []; (s.docs || []).forEach(function (d) { rows.push({ id: d.id, data: d.data() || {} }); });
        return { ok: true, rows: rows };
      }, function (err) { return { ok: false, err: err }; });
    } catch (err) { return Promise.resolve({ ok: false, err: err }); }
  }
  var deniedErr = function (r) { return !!(r && !r.ok && r.err && r.err.code === 'permission-denied'); };

  /* kc_config/settings -> KC.SET, key by key: a number that is allowed for its key; anything else keeps the default.  The shape is KC.SET's own, so there is no mapping. */
  function okSetting(key, v, top) {
    if (!isNum(v) || v < 0) return false;
    if (top && key === 'markup') return v >= 1 && v <= 10;
    return true;
  }
  function overlay(target, src, top) {
    if (!isObj(target) || !isObj(src)) return;
    Object.keys(src).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(target, k)) return;
      var t = target[k], v = src[k];
      if (isObj(t)) { if (isObj(v)) overlay(t, v, false); }
      else if (okSetting(k, v, top)) target[k] = v;
    });
  }
  function applySettings(r) {
    if (!window.KC) return;
    if (r.exists) overlay(KC.SET, r.data, true);
    KC.FLOOR_MODE = (r.exists && r.data.floorMode === 'formula') ? 'formula' : 'list';
  }
  /* a row of kc_config/list_prices (Addendum 1 A1): { code, price, perMetre | null, status, label, std } (status is one of Data, Smoothed, Estimate, After review, Supplier price, Approved: staff only, never printed), or a
     bare number (a document of the first format).  A row with no price above 0 is no row: that code has no list price and the formula price is used. */
  function listRowOf(v, code) {
    if (isNum(v)) return v > 0 ? v : null;
    if (!isObj(v) || !(isNum(v.price) && v.price > 0)) return null;
    return { code: str(v.code) || code, price: v.price, perMetre: isNum(v.perMetre) && v.perMetre > 0 ? v.perMetre : null, status: str(v.status), label: str(v.label), std: str(v.std) };
  }
  /* kc_config/list_prices -> KC.LISTP (filled in place: the product files keep their reference).  The engine reads a number or a row there (KC.listRow), so each code keeps what the document holds. */
  function applyListPrices(r) {
    if (!window.KC) return;
    if (!isObj(KC.LISTP)) KC.LISTP = {};
    Object.keys(KC.LISTP).forEach(function (k) { delete KC.LISTP[k]; });
    var rows = r.exists && isObj(r.data.rows) ? r.data.rows : {};
    Object.keys(rows).forEach(function (code) { var row = listRowOf(rows[code], code); if (row != null) KC.LISTP[code] = row; });
  }
  function priceOf(p) { return isNum(p) && p >= 0 ? p : null; }
  function histOf(h) {
    var out = [];
    (Array.isArray(h) ? h : []).forEach(function (e) {
      if (!isObj(e)) return;
      var o = { d: str(e.d), by: str(e.by) };
      if (e.p != null) o.p = isNum(e.p) ? e.p : null;
      if (e.note != null) o.note = str(e.note);
      if (e.rating != null) o.rating = str(e.rating);
      out.push(o);
    });
    return out.slice(-20);
  }
  var BLOWERS = 'Blowers & fans';
  function ratingText(key) { try { return window.KC && KC.LIB && KC.LIB.blowerText ? KC.LIB.blowerText(key) : ''; } catch (e) { return ''; } }
  /* kc_materials -> KC.P: .p, .hist and .source from the docs, hp / cfm / sp when present, and a new KC.P[key] for a doc whose key is not in the file.  A key in the file with no doc keeps p null. */
  function applyMaterials(rows) {
    if (!window.KC || !isObj(KC.P)) return;
    Object.keys(KC.P).forEach(function (k) {                          // every load starts from "no price": a doc that has gone is a price that has gone
      if (addedKeys[k]) { delete KC.P[k]; if (KC.PL_INFO) delete KC.PL_INFO[k]; return; }
      var v = KC.P[k]; v.p = null; v.hist = []; delete v.source;
    });
    addedKeys = {};
    rows.forEach(function (r) {
      var key = r.id, d = r.data, v = KC.P[key];
      if (!v) {
        if (!d.l || !d.u) return;                                     // a doc for a material nobody knows and that has no label or unit: nothing to show
        v = KC.P[key] = { l: str(d.l), u: str(d.u), p: null, hist: [] };
        if (!KC.PL_INFO) KC.PL_INFO = {};
        KC.PL_INFO[key] = [str(d.cat) || 'Other', str(d.grade) || '—', str(d.size) || '—'];
        addedKeys[key] = true;
      }
      v.p = priceOf(d.p); v.hist = histOf(d.hist);
      if (typeof d.source === 'string' && d.source) v.source = d.source;
      var rated = false;
      ['hp', 'cfm', 'sp'].forEach(function (f) { if (isNum(d[f]) && d[f] >= 0) { v[f] = d[f]; rated = true; } });
      if (typeof d.fam === 'string' && d.fam) v.fam = d.fam;
      if (rated && KC.PL_INFO && KC.PL_INFO[key] && KC.PL_INFO[key][0] === BLOWERS) KC.PL_INFO[key][2] = ratingText(key);
    });
  }

  /* the corner charge, kept in step (see the header): at load the price-list row wins when it has a number (it is the price the engine uses), else the settings' number; the other follows */
  function syncCorner() {
    if (!window.KC || !KC.P || !KC.P.cornerc || !KC.SET) return;
    var row = KC.P.cornerc;
    if (isNum(row.p) && row.p >= 0) KC.SET.corner = row.p;
    else if (isNum(KC.SET.corner) && KC.SET.corner >= 0) row.p = KC.SET.corner;
  }
  function finish(st, why) {
    setState(st, why);
    try { if (window.KC && KC.S) KC.S.role = KCLive.role; } catch (e) { /* ignore */ }
    try { if (document.body) document.body.dataset.role = KCLive.role; } catch (e) { /* ignore */ }
    try { D7.h('flow.syncButtons'); } catch (e) { /* ignore */ }
    return KCLive;
  }

  function apply(r) {
    var prof = r[0], sw = r[1], st = r[2], lp = r[3], mat = r[4];
    KCLive.role = prof.ok && prof.exists ? KCLive.roleOf(prof.data) : 'sales';          // a profile that could not be read is the least privileged role
    KCLive.userName = nameOf(prof.ok && prof.exists ? prof.data : null);
    KCLive.flags = flagsOf(sw.ok && sw.exists ? sw.data : null);                          // a failed read is 'off'
    if (st.ok) applySettings(st);
    if (lp.ok) applyListPrices(lp);
    if (mat.ok) applyMaterials(mat.rows);
    syncCorner();
    var denied = deniedErr(st) || deniedErr(lp) || deniedErr(mat);
    if (!st.ok || !lp.ok || !mat.ok) return finish(denied ? 'denied' : 'offline', denied ? 'The price list is not open to this account.' : 'The price list could not be read.');
    if (!mat.rows.length) return finish('offline', 'No prices have been imported yet.');
    return finish('live', '');
  }

  KCLive.load = function () {
    if (loading) return loading;
    setState('loading', '');                                          // at once, not a tick later: a caller that looks right after calling load() sees it
    loading = Promise.resolve().then(doLoad).then(function (v) { loading = null; return v; }, function (err) {
      loading = null; warn('load failed', err);
      try { return finish('offline', 'The price list could not be read.'); } catch (e) { return KCLive; }
    });
    return loading;
  };
  /* the signed-in user, once Firebase has restored the session.  The builder calls load() at boot, before auth has read its saved sign-in, so auth.currentUser is still null
     then and the profile read would make everybody Sales (the President lost his two buttons on the first live day, v15.0.1).  onAuthStateChanged fires once the restore is
     done (with the user, or null when nobody is signed in); a page without auth, or one that never answers, goes on after AUTH_WAIT_MS with whatever is there. */
  var AUTH_WAIT_MS = 5000;
  function authReady() {
    var u0 = currentUser();
    if (u0) return Promise.resolve(u0);
    var a = null; try { a = typeof auth !== 'undefined' ? auth : null; } catch (e) { a = null; }
    if (!a || typeof a.onAuthStateChanged !== 'function') return Promise.resolve(null);
    return new Promise(function (res) {
      var done = false, off = null;
      function end(u) { if (done) return; done = true; try { if (typeof off === 'function') off(); } catch (e) { /* ignore */ } res(u || currentUser()); }
      setTimeout(function () { end(null); }, AUTH_WAIT_MS);
      try { off = a.onAuthStateChanged(function (u) { end(u); }); } catch (e) { end(null); }
      if (done && typeof off === 'function') { try { off(); } catch (e) { /* ignore */ } }
    });
  }
  function doLoad() {
    setState('loading', '');
    if (onFile() || !dbReady()) return finish('offline', 'No database in this session.');
    return authReady().then(readAll);
  }
  function readAll(u) {
    var reads = Promise.all([
      u && u.uid ? getProfile(u.uid) : Promise.resolve({ ok: false, err: { code: 'unauthenticated' } }),
      getDoc('settings', 'quote_builder'), getDoc('kc_config', 'settings'), getDoc('kc_config', 'list_prices'), getAll('kc_materials')
    ]);
    var TIMEOUT = {}, timer = null;
    var timeout = new Promise(function (res) { timer = setTimeout(function () { res(TIMEOUT); }, LOAD_TIMEOUT_MS); });
    return Promise.race([reads, timeout]).then(function (r) {
      clearTimeout(timer);
      if (r === TIMEOUT) return finish('offline', 'The price list did not answer in time.');
      return apply(r);
    });
  }

  /* ============================== the approval carry and the typed costs (spec 3.4) ============================== */
  function cleanCarry(c) {
    if (!isObj(c) || !isNum(c.lastApprovedNet)) return null;
    return { lastApprovedNet: c.lastApprovedNet, lastApprovedGrand: isNum(c.lastApprovedGrand) ? c.lastApprovedGrand : 0, approvedAt: c.approvedAt ? str(c.approvedAt) : null,
      approvedBy: str(c.approvedBy), approvedByName: str(c.approvedByName), sourceColl: str(c.sourceColl), sourceDocId: str(c.sourceDocId) };
  }
  KCLive.carry = function () { return carry ? Object.assign({}, carry) : null; };
  KCLive.setCarry = function (c) { carry = cleanCarry(c); return KCLive.carry(); };

  function carryFromDoc(d, coll, id) {
    var net = isNum(d.netAmount) ? d.netAmount : (isNum(d.grandTotal) ? d.grandTotal - num(d.vatAmount) : NaN);
    if (!isNum(net)) return null;
    var u = currentUser();
    return cleanCarry({ lastApprovedNet: net, lastApprovedGrand: isNum(d.grandTotal) ? d.grandTotal : 0, approvedAt: isoOf(d.approvedAt), approvedBy: str(d.approvedBy),
      approvedByName: str(d.approvedByName) || (u && d.approvedBy && u.uid === d.approvedBy ? KCLive.userName : ''), sourceColl: coll, sourceDocId: id });
  }
  function carryFromSidecar(a, coll, id) {
    return cleanCarry({ lastApprovedNet: a.lastApprovedNet, lastApprovedGrand: a.lastApprovedGrand, approvedAt: a.approvedAt, approvedBy: a.approvedBy, approvedByName: a.approvedByName,
      sourceColl: a.sourceColl || coll, sourceDocId: a.sourceDocId || id });
  }
  /* The approver's name (QA D7): js/screens/approvals.js writes approvedBy (a uid) and no name, so the carry has none of its own unless the approver is the person signed in.  It is filled from the approver's
     user record: one document get of users/<uid>, which any signed-in profile may do (firestore.rules: `allow get: if isAuth()`), so no rules change.  A record that cannot be read, or has no name, leaves the
     name blank, as before; the carry is set first and never waits for the lookup or is refused for it. */
  function profileName(p) { return isObj(p) ? str(p.name || p.displayName || p.fullName).trim() : ''; }
  function withApproverName(c) {
    if (!c || c.approvedByName || !c.approvedBy) return Promise.resolve(c);
    return getDoc('users', c.approvedBy).then(function (r) {
      var n = r.ok && r.exists ? profileName(r.data) : '';
      return n ? Object.assign({}, c, { approvedByName: n }) : c;
    }, function () { return c; });
  }
  /* the typed costs of the sidecar go back into the lines' cfg, in memory only.  A row matches by kcId; with no kcId it matches by index; either way the NAME must still be the line's, so a stale row never lands on the
     wrong line (the same rule js/app.js graftQuoteCosts keeps).  Returns how many lines were grafted. */
  function graftTyped(sc) {
    if (typeof items === 'undefined' || !Array.isArray(items) || !isObj(sc) || !Array.isArray(sc.items)) return 0;
    var n = 0;
    sc.items.forEach(function (r) {
      if (!r || !r.kc || !r.kc.typed) return;
      var target = null;
      if (r.kc.kcId) target = items.filter(function (it) { return it && it.kcKind && it.kcId === r.kc.kcId; })[0] || null;
      else if (isNum(r.i) && items[r.i] && items[r.i].kcKind) target = items[r.i];
      if (!target) return;
      if (str(target.name).slice(0, 120) !== str(r.n)) return;
      if (D7.adapter && D7.adapter.graft) { D7.adapter.graft(target, r.kc); n++; }
    });
    return n;
  }
  function repriceAndDraw() {
    try { if (D7.has('pricing.repriceAll')) D7.h('pricing.repriceAll'); else D7.h('adapter.repriceAll'); } catch (e) { warn('reprice failed', e); }
    try { if (typeof renderItems === 'function') renderItems(); } catch (e) { warn('redraw failed', e); }
  }
  KCLive.afterLoad = function (st) {
    try {
      var d = isObj(st) ? st : {};
      if (!d.sourceDocId || !d.sourceCollection) return Promise.resolve(false);                  // not a reopen: the pricing fields already brought the carry (or none)
      var coll = str(d.sourceCollection), id = str(d.sourceDocId);
      return Promise.all([getDoc(coll, id), getDoc('quote_costs', coll + '_' + id)]).then(function (r) {
        var qd = r[0], sc = r[1], c = null;
        if (qd.ok && qd.exists && qd.data.approvalStatus === 'approved') c = carryFromDoc(qd.data, coll, id);
        else if (sc.ok && sc.exists && isObj(sc.data.approval)) c = carryFromSidecar(sc.data.approval, coll, id);
        carry = c;                                                                                // a failed read leaves it null (the stricter rules of spec 1.3 item 1 then apply)
        var grafted = (sc.ok && sc.exists) ? graftTyped(sc.data) : 0;
        repriceAndDraw();                                                                         // the typed costs are in (or not): price the lines again and draw (spec 3.4)
        void grafted;
        return withApproverName(c).then(function (named) {                                        // QA D7: the carry is in place already; the approver's name joins it when the one lookup answers (unless another load replaced the carry meanwhile)
          if (named !== c && carry === c) carry = named;
          return true;
        });
      }).catch(function (err) { warn('afterLoad failed', err); return false; });
    } catch (err) { warn('afterLoad failed', err); return Promise.resolve(false); }
  };

  /* ============================== the cost sidecar summary (spec 3.4) ============================== */
  KCLive.sidecarExtras = function () {
    var info = D7.pricing && D7.pricing.standardInfo ? D7.pricing.standardInfo() : {};
    return {
      kcSummary: { v: 1, engine: 'kc1', at: new Date().toISOString(), net: round2(info.net), grandTotal: round2(info.grand), projectCost: round2(info.projectCost), floorTotal: round2(info.floorTotal),
        costTimesMarkup: round2(info.costTimesMarkup), standardTotal: round2(info.standardTotal), costKnown: info.costKnown === true, markup: num(info.markup), floorMode: info.floorMode === 'formula' ? 'formula' : 'list' },
      approval: carry ? Object.assign({}, carry) : null
    };
  };

  /* ============================== the writes ============================== */
  function who(role) {
    var u = currentUser(), r = KCLive.role;
    if (!u || !u.uid) throw new Error('You are not signed in.');
    if (role.indexOf(r) < 0) throw new Error('Only ' + (role.indexOf('purchasing') >= 0 ? 'the President and Purchasing' : 'the President') + ' can change this.');
    if (!dbReady()) throw new Error('There is no database in this session.');
    return { uid: u.uid, name: KCLive.userName || (window.KC && KC.ROLES && KC.ROLES[r] && KC.ROLES[r].name) || r };
  }
  function stampOf(me) { return { updatedAt: stamp(), updatedBy: me.uid, updatedByName: me.name }; }
  var KEY_RE = /^[a-z0-9_]{1,40}$/;

  /* ---- one-time import of the seed (spec 3.6) ---- */
  KCLive.importSeed = function (json) {
    return Promise.resolve().then(function () {
      var me = who(['president']);
      var seed = typeof json === 'string' ? JSON.parse(json) : json;
      if (!isObj(seed) || seed.v !== 1) throw new Error('This is not a price file (expected version 1).');
      var settings = isObj(seed.settings) ? seed.settings : null, materials = isObj(seed.materials) ? seed.materials : null, lp = isObj(seed.listPrices) ? seed.listPrices : null;
      var products = Array.isArray(seed.products) ? seed.products : [];
      if (!settings || !materials || !lp || !isObj(lp.rows)) throw new Error('The price file is missing its settings, materials or list prices.');
      if (!(isNum(settings.markup) && settings.markup >= 1 && settings.markup <= 10)) throw new Error('The price file has no usable markup.');
      var day = today(), summary = { settings: 1, materials: 0, listPrices: 0, products: 0, historyAdded: 0, written: 0 };
      return getAll('kc_materials').then(function (cur) {
        if (!cur.ok) throw cur.err || new Error('The current price list could not be read.');
        var have = {}; cur.rows.forEach(function (r) { have[r.id] = r.data; });
        var ops = [];
        ops.push({ ref: db.collection('kc_config').doc('settings'), data: Object.assign({}, settings, { v: 1, floorMode: settings.floorMode === 'formula' ? 'formula' : 'list' }, stampOf(me)) });
        var rows = {}; Object.keys(lp.rows).forEach(function (code) { var row = listRowOf(lp.rows[code], code); if (row != null) { rows[code] = row; summary.listPrices++; } });
        ops.push({ ref: db.collection('kc_config').doc('list_prices'), data: Object.assign({ v: 1, effective: str(lp.effective) || day, rows: rows }, stampOf(me)) });
        Object.keys(materials).forEach(function (key) {
          if (!KEY_RE.test(key)) throw new Error('"' + key + '" is not a valid material key.');
          var m = materials[key]; if (!isObj(m)) return;
          var p = priceOf(m.p), prev = have[key], prevP = prev ? priceOf(prev.p) : null;
          var hist = prev && Array.isArray(prev.hist) ? prev.hist.slice() : [];
          if (p != null && p !== prevP) { hist.push({ d: day, p: p, by: me.name }); summary.historyAdded++; }        // a new history entry only when the price changed
          var data = Object.assign({ v: 1, key: key, p: p, source: str(m.source) || 'Manual', hist: hist.slice(-20) }, stampOf(me));
          ['l', 'u', 'cat', 'grade', 'size', 'fam'].forEach(function (f) { if (m[f] != null && m[f] !== '') data[f] = str(m[f]); });
          ['hp', 'cfm', 'sp'].forEach(function (f) { if (isNum(m[f])) data[f] = m[f]; });
          ops.push({ ref: db.collection('kc_materials').doc(key), data: data }); summary.materials++;
        });
        products.forEach(function (p) {
          if (!isObj(p) || !str(p.sku) || !str(p.title) || !isNum(p.basePrice)) throw new Error('A product of the price file has no sku, title or price.');
          var data = { title: str(p.title), category: str(p.category) || 'cooking_line', formulaType: 'fixed', basePrice: p.basePrice, specifications: str(p.specifications), unit: 'pc' };
          if (isObj(p.measurement)) data.measurement = p.measurement;
          ops.push({ ref: db.collection('products').doc(str(p.sku)), data: data }); summary.products++;      // never a cost field
        });
        var chain = Promise.resolve();
        for (var i = 0; i < ops.length; i += 400) {
          (function (chunk) {
            chain = chain.then(function () {
              var b = db.batch();
              chunk.forEach(function (o) { b.set(o.ref, o.data, { merge: true }); });                       // merge: a field the seed does not carry (an edited rating, a code added later) survives
              return b.commit().then(function () { summary.written += chunk.length; });
            });
          })(ops.slice(i, i + 400));
        }
        return chain;
      }).then(function () {
        return KCLive.load();                                          // the new prices are in memory now; the caller reprices and redraws
      }).then(function () {
        try { if (window.KC && KC.renderChips) KC.renderChips(true); } catch (e) { /* ignore */ }
        return summary;
      });
    });
  };

  /* ---- one material row ---- */
  /* the document of the corner-charge row (kc_materials/cornerc) when the corner charge changes from the Pricing settings: the price, one history entry when it moved */
  function cornerRowData(cur, p, me, day) {
    var local = window.KC && KC.P ? KC.P.cornerc : null;
    var prevP = cur ? priceOf(cur.p) : (local ? priceOf(local.p) : null);
    var hist = cur && Array.isArray(cur.hist) ? histOf(cur.hist) : (local ? histOf(local.hist) : []);
    if (p != null && p !== prevP) hist.push({ d: day, p: p, by: me.name });
    return Object.assign({ v: 1, key: 'cornerc', p: p, source: 'Manual', hist: hist.slice(-20) }, stampOf(me));
  }
  KCLive.saveMaterial = function (key, patch) {
    return Promise.resolve().then(function () {
      var me = who(['president', 'purchasing']);
      key = str(key); patch = isObj(patch) ? patch : {};
      if (!KEY_RE.test(key)) throw new Error('"' + key + '" is not a valid material key.');
      if ('p' in patch && patch.p != null && !(isNum(Number(patch.p)) && Number(patch.p) >= 0)) throw new Error('A price must be a number of 0 or more, or blank.');
      var day = today(), ref = db.collection('kc_materials').doc(key), out = {}, settingsOut = null;
      var withCorner = key === 'cornerc' && 'p' in patch && KCLive.role === 'president';        // the corner charge is also a Pricing setting: the President changes both at once
      var sref = db.collection('kc_config').doc('settings');
      return db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          return (withCorner ? tx.get(sref) : Promise.resolve(null)).then(function (ssnap) {
            var cur = snap.exists ? (snap.data() || {}) : null, local = window.KC && KC.P ? KC.P[key] : null;
            var prevP = cur ? priceOf(cur.p) : (local ? priceOf(local.p) : null);
            var hist = cur && Array.isArray(cur.hist) ? histOf(cur.hist) : (local ? histOf(local.hist) : []);
            var data = Object.assign({ v: 1, key: key }, stampOf(me));
            if ('p' in patch) {
              var p = patch.p == null || patch.p === '' ? null : Math.round(Number(patch.p) * 100) / 100;
              data.p = p; data.source = str(patch.source) || 'Manual';
              if (p != null && p !== prevP) hist.push({ d: day, p: p, by: me.name });
            } else if (!cur) { data.p = prevP; }
            var rated = false;
            ['hp', 'cfm', 'sp'].forEach(function (f) {
              if (!(f in patch)) return;
              var v = patch[f] == null || patch[f] === '' ? null : Number(patch[f]);
              if (v != null && !(isNum(v) && v >= 0)) throw new Error('A rating must be a number of 0 or more, or blank.');
              if (v !== (cur && isNum(cur[f]) ? cur[f] : (local && isNum(local[f]) ? local[f] : null))) rated = true;
              data[f] = v;
            });
            if (rated) hist.push({ d: day, note: 'rating changed', rating: str(patch.ratingNote), by: me.name });
            ['l', 'u', 'cat', 'grade', 'size', 'fam'].forEach(function (f) { if (f in patch && patch[f] != null) data[f] = str(patch[f]); });
            data.hist = hist.slice(-20);
            tx.set(ref, data, { merge: true });
            out = data;
            if (withCorner) {                                          // every read is done: now the writes
              settingsOut = ssnap && ssnap.exists ? Object.assign({ corner: data.p, v: 1 }, stampOf(me)) : Object.assign(snapshotOfSet(), { corner: data.p, v: 1 }, stampOf(me));
              tx.set(sref, settingsOut, { merge: true });
            }
          });
        });
      }).then(function () {
        applyOne(key, out);
        return { key: key, p: 'p' in out ? out.p : (window.KC && KC.P && KC.P[key] ? KC.P[key].p : null), hist: out.hist };
      });
    });
  };
  function applyOne(key, d) {                                          // the row as it is now, in memory
    if (!window.KC || !isObj(KC.P)) return;
    var v = KC.P[key];
    if (!v) {
      if (!d.l || !d.u) return;
      v = KC.P[key] = { l: str(d.l), u: str(d.u), p: null, hist: [] };
      if (!KC.PL_INFO) KC.PL_INFO = {};
      KC.PL_INFO[key] = [str(d.cat) || 'Other', str(d.grade) || '—', str(d.size) || '—']; addedKeys[key] = true;
    }
    if ('p' in d) { v.p = priceOf(d.p); if (d.source) v.source = d.source; }
    if (Array.isArray(d.hist)) v.hist = histOf(d.hist);
    ['hp', 'cfm', 'sp'].forEach(function (f) { if (f in d) v[f] = d[f]; });
    if (typeof d.fam === 'string') v.fam = d.fam;
    if (('hp' in d || 'cfm' in d || 'sp' in d) && KC.PL_INFO && KC.PL_INFO[key] && KC.PL_INFO[key][0] === BLOWERS) KC.PL_INFO[key][2] = ratingText(key);
    if (key === 'cornerc' && 'p' in d && KC.SET) KC.SET.corner = priceOf(d.p);                 // the corner charge, in step
  }

  /* ---- the pricing settings ---- */
  function snapshotOfSet() {
    var s = JSON.parse(JSON.stringify({ br: KC.SET.br, misc: KC.SET.misc, markup: KC.SET.markup, corner: KC.SET.corner == null ? null : KC.SET.corner, hood: KC.SET.hood, duct: KC.SET.duct }));
    s.floorMode = KC.FLOOR_MODE === 'formula' ? 'formula' : 'list';
    return s;
  }
  function mergeSettings(base, patch, shape, top, path) {              // numbers only, and only keys KC.SET has: anything else is refused, never silently dropped
    Object.keys(patch).forEach(function (k) {
      var here = (path ? path + '.' : '') + k, v = patch[k];
      if (top && k === 'floorMode') { if (v !== 'list' && v !== 'formula') throw new Error('The floor mode must be list or formula.'); base.floorMode = v; return; }
      if (!Object.prototype.hasOwnProperty.call(shape, k)) throw new Error('"' + here + '" is not a pricing setting.');
      if (isObj(shape[k])) {
        if (!isObj(v)) throw new Error('"' + here + '" must be a group of numbers.');
        if (!isObj(base[k])) base[k] = JSON.parse(JSON.stringify(shape[k]));
        mergeSettings(base[k], v, shape[k], false, here); return;
      }
      if (!okSetting(k, v, top)) throw new Error('"' + here + '" must be a number' + (top && k === 'markup' ? ' from 1 to 10' : ' of 0 or more') + '.');
      base[k] = v;
    });
    return base;
  }
  KCLive.saveSettings = function (patch) {
    return Promise.resolve().then(function () {
      var me = who(['president']);
      if (!isObj(patch)) throw new Error('Nothing to save.');
      var day = today(), ref = db.collection('kc_config').doc('settings'), cref = db.collection('kc_materials').doc('cornerc'), out = null, cornerOut = null;
      return db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          return ('corner' in patch ? tx.get(cref) : Promise.resolve(null)).then(function (csnap) {
            var base = snap.exists ? (snap.data() || {}) : snapshotOfSet();
            var next = mergeSettings(JSON.parse(JSON.stringify(base)), patch, KC.SET, true, '');
            if (!(isNum(next.markup) && next.markup >= 1 && next.markup <= 10)) next.markup = snapshotOfSet().markup;
            next.v = 1; next.floorMode = next.floorMode === 'formula' ? 'formula' : 'list';
            Object.assign(next, stampOf(me));
            if (csnap) { cornerOut = cornerRowData(csnap.exists ? (csnap.data() || {}) : null, next.corner, me, day); tx.set(cref, cornerOut, { merge: true }); }     // the corner charge is also a price-list row
            tx.set(ref, next); out = next;
          });
        });
      }).then(function () {
        overlay(KC.SET, out, true); KC.FLOOR_MODE = out.floorMode;
        if (cornerOut) applyOne('cornerc', cornerOut);
        return { markup: KC.SET.markup, floorMode: KC.FLOOR_MODE };
      });
    });
  };

  /* ---- the Standard Price List ---- */
  KCLive.saveListPrices = function (rows, effective) {
    return Promise.resolve().then(function () {
      var me = who(['president']);
      if (!isObj(rows)) throw new Error('Nothing to save.');
      Object.keys(rows).forEach(function (code) {
        var v = rows[code];
        if (!code || /[\/.]/.test(code)) throw new Error('"' + code + '" is not a valid code.');
        if (v != null && !(isNum(v) && v > 0)) throw new Error('The list price of ' + code + ' must be above 0, or blank to remove it.');
      });
      var ref = db.collection('kc_config').doc('list_prices'), out = null;
      return db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          var cur = snap.exists ? (snap.data() || {}) : {}, merged = {};
          var base = isObj(cur.rows) ? cur.rows : (window.KC && KC.LISTP ? KC.LISTP : {});
          Object.keys(base).forEach(function (c) { var row = listRowOf(base[c], c); if (row != null) merged[c] = row; });
          Object.keys(rows).forEach(function (c) {
            if (rows[c] == null) delete merged[c];
            else merged[c] = isObj(merged[c]) ? Object.assign({}, merged[c], { price: rows[c] }) : rows[c];     // a price change keeps the row's per-metre rate, status, label and size; a new code is a bare number
          });
          out = Object.assign({ v: 1, effective: str(effective) || str(cur.effective) || today(), rows: merged }, stampOf(me));
          tx.set(ref, out);
        });
      }).then(function () {
        applyListPrices({ exists: true, data: out });
        return { rows: out.rows };
      });
    });
  };

  /* ---- the office switch ---- */
  KCLive.saveSwitch = function (patch) {
    return Promise.resolve().then(function () {
      var me = who(['president']);
      if (!isObj(patch)) throw new Error('Nothing to save.');
      var data = {};
      if ('kcMode' in patch) { if (['off', 'president', 'on'].indexOf(patch.kcMode) < 0) throw new Error('The switch must be off, president or on.'); data.kcMode = patch.kcMode; }
      if ('approveAll' in patch) { if (typeof patch.approveAll !== 'boolean') throw new Error('approveAll must be true or false.'); data.approveAll = patch.approveAll; }
      if ('approvalBelowStandard' in patch) { if (['force', 'tick'].indexOf(patch.approvalBelowStandard) < 0) throw new Error('approvalBelowStandard must be force or tick.'); data.approvalBelowStandard = patch.approvalBelowStandard; }
      if ('catalogueCostPricing' in patch) { if (typeof patch.catalogueCostPricing !== 'boolean') throw new Error('catalogueCostPricing must be true or false.'); data.catalogueCostPricing = patch.catalogueCostPricing; }
      if (!Object.keys(data).length) throw new Error('Nothing to save.');
      data.updatedAt = stamp(); data.updatedByName = me.name;
      return db.collection('settings').doc('quote_builder').set(data, { merge: true }).then(function () {
        KCLive.flags = flagsOf(Object.assign({}, KCLive.flags, data));
        try { D7.h('flow.syncButtons'); } catch (e) { /* ignore */ }
        return Object.assign({}, KCLive.flags);
      });
    });
  };

  /* ============================== go live: the last statement of the last script (spec 4.2) ============================== */
  var missing = [];
  if (!window.KC) missing.push('KC');
  else if (!KC.products || !Object.keys(KC.products).length) missing.push('KC.products');
  if (!(D7.adapter && typeof D7.adapter.commit === 'function')) missing.push('D7.adapter.commit');
  if (!(D7.pricing && typeof D7.pricing.trueCost === 'function')) missing.push('D7.pricing.trueCost');
  if (!(D7.doc && typeof D7.doc.printBlock === 'function')) missing.push('D7.doc.printBlock');
  if (!window.KCRules) missing.push('KCRules');
  if (!missing.length) D7.live = true;
  else warn('the configurators stay off: missing ' + missing.join(', '));
})();
