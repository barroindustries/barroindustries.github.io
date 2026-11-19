/* ==============================================================================================================
   qb/d7/d7-core.js: window.D7.   The small, shared plumbing of the configurators in the live quote builder
   (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md sections 2.2, 4.1, 5 packet C).   Loaded before qb/kc/core.js.
   Ported from the D7 prototype's d7/d7-core.js.  LEFT OUT on purpose (prototype tooling): the local parent (its message bus and its replies), the role switcher, the prototype bar, the Offline chip, the role line
   of D7.boot.  The live page talks to the real app through window.parent.postMessage, and the role is the user's own (qb/kc-live.js).

   HOOKS     D7.h('chunk.name', ...args)    calls D7[chunk][name].apply(D7[chunk], args).  A missing hook returns ''.  A hook that throws returns '' and logs ONCE.
             D7.has('chunk.name')           true when the hook exists.
             A hook that returns undefined / null is turned into '' so `${D7.h(...)}` never prints "undefined".
   LIVE      D7.live                        FALSE until qb/kc-live.js has checked that everything it needs is present (it is the LAST script and does `D7.live = true`);
                                            truthy afterwards, and then it IS the KCLive object, so the page's D7.h('live.carry'), D7.h('live.afterLoad', state) ... reach it.
                                            The page's d7On() asks `!!D7.live`: a missing or broken file leaves the whole feature off (spec 2.2, 4.2).
   ROLE      D7.role()                      KC.S.role: president | manager (Operations) | purchasing | sales   (KCLive.load sets it from the user's own profile)
   TABS      D7.TABS  D7.tabOfProduct(p)  D7.sectionFor(p)       the seven tabs (spec 1.2 M1)
   MARKUP    D7.markupOvr()  D7.markup()    the President's one-per-quote override (KC.S.markupOvr, >= 1) or null / the standard KC.SET.markup
   MISC      D7.toast(text, kind)  D7.on() (= the page's d7On())  D7.boot()  D7.ready  D7.core {sync, ready}
   ============================================================================================================== */
(function () {
  'use strict';
  var D7 = window.D7 = window.D7 || {};
  D7.ready = false; D7.booted = false;

  /* ---------- D7.live: falsy until kc-live.js says so; then the KCLive object (the namespace of the live hooks) ---------- */
  (function () {
    var flag = false;
    try {
      Object.defineProperty(D7, 'live', {
        configurable: true, enumerable: true,
        get: function () { return flag ? (window.KCLive || true) : false; },
        set: function (v) { flag = !!v; }
      });
    } catch (err) { D7.live = false; }
  })();

  /* ---------- hooks ---------- */
  var warned = Object.create(null);
  function hookOf(name) {
    var s = String(name), i = s.indexOf('.');
    if (i < 1) return null;
    var ns = D7[s.slice(0, i)], fn = ns && ns[s.slice(i + 1)];
    return typeof fn === 'function' ? { ns: ns, fn: fn } : null;
  }
  D7.has = function (name) { return !!hookOf(name); };
  D7.h = function (name) {
    var hook = hookOf(name);
    if (!hook) return '';
    try {
      var r = hook.fn.apply(hook.ns, Array.prototype.slice.call(arguments, 1));
      return r == null ? '' : r;
    } catch (err) {
      if (!warned[name]) { warned[name] = 1; try { console.error('D7: the hook "' + name + '" threw', err); } catch (e) { /* no console */ } }
      return '';
    }
  };
  D7.adapter = D7.adapter || {}; D7.pricing = D7.pricing || {}; D7.doc = D7.doc || {}; D7.flow = D7.flow || {}; D7.core = D7.core || {};

  D7.on = function () { return typeof d7On === 'function' && d7On(); };
  D7.toast = function (text, kind) { try { if (typeof showToast === 'function') showToast(text, kind); } catch (e) { /* a toast must never break a flow */ } };

  /* ---------- the role: the user's own (KCLive.load fills KC.S.role); the least privileged one until it is known ---------- */
  D7.role = function () { return (window.KC && KC.S && KC.S.role) || 'sales'; };

  /* ---------- the seven tabs (spec 1.2 M1) ---------- */
  D7.TABS = [{ id: 'prep', label: 'Prep and storage' }, { id: 'wash', label: 'Washing' }, { id: 'cook', label: 'Cooking' }, { id: 'vent', label: 'Ventilation' },
    { id: 'cold', label: 'Refrigeration' }, { id: 'multi', label: 'Multi-purpose' }, { id: 'mech', label: 'Mechanical Systems' }];
  var TAB_IDS = D7.TABS.map(function (t) { return t.id; });
  var WASH = {};
  ['PW-004', 'PW-005', 'PW-006', 'PW-007', 'PW-008', 'PW-009', 'PW-010', 'PW-012', 'PW-018', 'PW-022', 'PW-024', 'PW-025', 'PW-029', 'PW-030', 'PW-035', 'PW-036', 'PW-037', 'PW-051', 'PW-052', 'PW-053']
    .forEach(function (id) { WASH[id] = 1; });
  var CAT2TAB = { cooking_line: 'cook', baking: 'cook', refrigeration: 'cold', exhaust_system: 'vent', fresh_air_system: 'vent', gas_line: 'mech', fire_suppression: 'mech' };
  /* the tab of a catalogue product ('' = none: Miscellaneous is in no tab).  A category that is already a tab id (a kc product, a line that was sectioned) is its own tab. */
  D7.tabOfProduct = function (p) {
    if (!p) return '';
    var c = String(p.category == null ? '' : p.category);
    if (TAB_IDS.indexOf(c) >= 0) return c;
    if (c === 'prep_washing') return WASH[String(p.id)] ? 'wash' : 'prep';
    return CAT2TAB[c] || '';
  };
  /* the section a new line lands in: its tab; Miscellaneous (and anything unknown) -> 'miscellaneous' */
  D7.sectionFor = function (p) { return D7.tabOfProduct(p) || 'miscellaneous'; };

  /* ---------- the markup: one number per quote, President only, >= 1; KC.S.markupOvr is where the kc code reads it ---------- */
  D7.markupOvr = function () { var o = window.KC && KC.S ? KC.S.markupOvr : null; return (o != null && isFinite(+o) && +o >= 1) ? +o : null; };
  D7.markup = function () { var o = D7.markupOvr(); return o != null ? o : ((window.KC && KC.SET && KC.SET.markup) || 2); };

  /* ---------- core.sync / core.ready ---------- */
  D7.core.sync = function () {
    if (typeof d7SyncMode === 'function') d7SyncMode();
    D7.h('flow.syncButtons');                                       // the two screen buttons follow the mode (and the role, once it is known)
  };
  D7.core.ready = function () {                                    // initUI() ends here; it runs again on every "Reload DB"
    D7.ready = true;
    try { if (typeof kcAdoptEngineIfBlank === 'function') kcAdoptEngineIfBlank(); }     // a blank quote takes the engine the office switch allows (page, L3)
    catch (e) { console.error('D7: core.ready could not adopt the engine of a blank quote', e); }
    if (typeof d7SyncMode === 'function') d7SyncMode(true);        // the catalogue has just (re)loaded: draw the tab row, the cards and the catalogue list again
    try {
      if (typeof d7On === 'function' && d7On() && typeof items !== 'undefined' && items.some(function (i) { return i && i.kcKind; })) {
        if (D7.has('pricing.repriceAll')) D7.h('pricing.repriceAll'); else D7.h('adapter.repriceAll');
        if (typeof renderItems === 'function') renderItems();
      }
    } catch (e) { console.error('D7: core.ready could not reprice the configured lines', e); }
    D7.h('flow.syncButtons');
  };

  /* ---------- boot: idempotent.  A fallback below calls it once the page has loaded (the scripts are deferred: they have all run by then) ---------- */
  D7.boot = function () {
    if (D7.booted) return;
    D7.booted = true;
    D7.h('flow.boot');                                              // the two screen buttons of the top bar, the click wiring
  };
  (function () {
    function later() { setTimeout(function () { if (!D7.booted) D7.boot(); }, 0); }
    if (document.readyState === 'complete') later(); else document.addEventListener('DOMContentLoaded', later);
  })();
})();
