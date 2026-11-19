/* js/catalogue.js — behaviour of the public /catalogue/ page. Zero dependencies; the page loads no
   Firebase and no app script. Every control is bound by id or class delegation (no inline handlers),
   everything below is a class or attribute toggle, and the only text it writes uses textContent
   (the visitor's query is compared and echoed with textContent, never parsed as markup).
   What it does: live search over every product, a category filter (the sticky bar of buttons: All + one per
   category; plain anchors without script), deep links such as #cat-baking that open that category, the Configure deep link ?configure=<family> (a product page's
   "Configure" button: it presses that family card's own "Configure & add" button), and a back-to-top button. */
(function () {
  'use strict';
  var d = document;
  function $(id) { return d.getElementById(id); }
  function on(el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt); }
  function up(e, sel) { var t = e.target; return t && t.closest ? t.closest(sel) : null; }
  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function raf(fn) { var busy = false; return function () { if (busy) return; busy = true; window.requestAnimationFrame(function () { busy = false; fn(); }); }; }

  function init() {
    var layout = $('catalogue');
    if (!layout) return;
    var nav = $('cat-nav'), form = $('cat-search-form'), input = $('cat-search'), clearBtn = $('cat-search-clear');
    var status = $('cat-status'), empty = $('cat-empty'), emptyQ = $('cat-empty-q'), emptyClear = $('cat-empty-clear');
    var topBtn = $('cat-top'), header = $('site-header');
    var links = [].slice.call(layout.querySelectorAll('.cat-link'));
    var groups = [].slice.call(layout.querySelectorAll('.cat-group'));
    var cards = [].slice.call(layout.querySelectorAll('.cat-card'));
    var idle = status ? status.textContent : '', allIdle = idle, total = cards.length;

    // What a card can be found by: its name, its one-line description and its feature bullets — not the price line, not the tag
    // and not the button. A card also carries (in data-kw, never shown) its product code and, for a configurable product, the names and codes of the products it
    // replaced in data-kw (never shown), so "PW-006" or "double sink" still finds the Sink.
    var haystack = cards.map(function (c) {
      var parts = c.querySelectorAll('h3, .cat-code, .cat-lead, .cat-size, .cat-feat, .cat-options'), s = c.getAttribute('data-kw') || '';
      for (var i = 0; i < parts.length; i++) s += ' ' + parts[i].textContent;
      return s.toLowerCase().replace(/\s+/g, ' ');
    });
    var link = {}, counts = {};
    links.forEach(function (a) {
      var n = a.querySelector('.cat-link-n');
      link[a.getAttribute('data-cat')] = a;
      counts[a.getAttribute('data-cat')] = n ? n.textContent : '';
    });
    var heads = groups.map(function (g) { return g.querySelector('.cat-count'); });

    // ── Search ─────────────────────────────────────────────────────────────────
    function run() {
      var raw = input.value.replace(/\s+/g, ' ').replace(/^ | $/g, '');
      var terms = raw ? raw.toLowerCase().split(' ') : [];
      var shown = 0, per = {}, i, t;
      for (i = 0; i < cards.length; i++) {
        var hit = true;
        for (t = 0; t < terms.length; t++) { if (haystack[i].indexOf(terms[t]) < 0) { hit = false; break; } }
        cards[i].classList.toggle('is-hidden', !hit);
        if (hit) {
          shown++;
          var id = cards[i].parentNode.parentNode.getAttribute('data-cat');
          per[id] = (per[id] || 0) + 1;
        }
      }
      for (i = 0; i < groups.length; i++) {
        var cat = groups[i].getAttribute('data-cat'), n = per[cat] || 0;
        groups[i].classList.toggle('is-empty', !!raw && n === 0);
        if (heads[i]) heads[i].textContent = raw ? String(n) : counts[cat];
        if (link[cat]) {
          link[cat].classList.toggle('is-zero', !!raw && n === 0);
          var ln = link[cat].querySelector('.cat-link-n');
          if (ln) ln.textContent = raw ? String(n) : counts[cat];
        }
      }
      if (status) {
        status.textContent = !raw ? idle
          : shown === 0 ? 'No results for “' + raw + '”'
          : shown + (shown === 1 ? ' result' : ' results') + ' for “' + raw + '”';
      }
      if (empty) { empty.hidden = !(raw && shown === 0); if (emptyQ) emptyQ.textContent = raw; }
      if (clearBtn) clearBtn.hidden = !input.value;
    }
    var timer = 0;
    on(input, 'input', function () {
      if (clearBtn) clearBtn.hidden = !input.value;
      if (input.value && filterCat) { setFilter(''); try { window.history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* harmless */ } }   // a search covers every category
      clearTimeout(timer); timer = setTimeout(run, 120);
    });
    on(input, 'keydown', function (e) { if (e.key === 'Escape' && input.value) { input.value = ''; run(); } });
    on(form, 'submit', function (e) { e.preventDefault(); input.blur(); });           // Enter dismisses the phone keyboard
    function clearSearch() { input.value = ''; run(); input.focus(); }
    on(clearBtn, 'click', clearSearch);
    on(emptyClear, 'click', clearSearch);
    on(d, 'keydown', function (e) {                                                      // "/" jumps to the search box
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      e.preventDefault(); input.focus(); input.select();
    });

    // ── Category filter (owner 2026-11-19): the bar of buttons above the grid — All + one per category — shows one category at a time.
    // Without script the same links are plain anchors to #cat-… and every category stays on the page. The filter sets .is-off on the
    // other sections (never the search's .is-empty), highlights its own button and writes #cat-… into the address so a link can be shared.
    var filterCat = '', moved = false;
    function labelOf(id) { var a = link[id], s = a && a.querySelector('.cat-link-name'); return s ? s.textContent : id; }
    function keepVisible(a) {                      // scroll the bar itself (never the page) so the active button stays in view
      if (!nav || !a) return;
      if (nav.scrollWidth > nav.clientWidth + 1) {
        var left = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
        if (nav.scrollTo) nav.scrollTo({ left: left, behavior: reduced() ? 'auto' : 'smooth' }); else nav.scrollLeft = left;
      }
    }
    function setFilter(id) {
      filterCat = id && link[id] ? id : '';
      var active = null;
      groups.forEach(function (g) { g.classList.toggle('is-off', !!filterCat && g.getAttribute('data-cat') !== filterCat); });
      links.forEach(function (a) {
        var is = (a.getAttribute('data-cat') || 'all') === (filterCat || 'all');
        a.classList.toggle('is-active', is);
        if (is) { a.setAttribute('aria-current', 'true'); active = a; } else a.removeAttribute('aria-current');
      });
      keepVisible(active);
      if (!input || !input.value) {
        var n = filterCat ? Number(counts[filterCat]) || 0 : total;
        idle = filterCat ? n + (n === 1 ? ' product in ' : ' products in ') + labelOf(filterCat) : allIdle;
        if (status) status.textContent = idle;
      }
    }
    function hashCat() {
      var m = /^#cat-([A-Za-z0-9_-]+)$/.exec(location.hash || '');
      return m && link[m[1]] ? m[1] : '';
    }
    on(nav, 'click', function (e) {
      var a = up(e, '.cat-link');
      if (!a) return;
      e.preventDefault();
      var id = a.getAttribute('data-cat'); id = id === 'all' ? '' : id;
      if (input && input.value) { input.value = ''; run(); }        // a filter and a search at once would hide the very products the visitor clicked for
      setFilter(id);
      try { window.history.replaceState(null, '', location.pathname + location.search + (id ? '#cat-' + id : '')); } catch (_) { /* the address keeps its old hash, which is harmless */ }
      var top = layout.getBoundingClientRect().top + window.pageYOffset - (header ? header.getBoundingClientRect().height : 64) - 8;
      if (window.pageYOffset > top) window.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
    });
    on(window, 'hashchange', function () { moved = true; setFilter(hashCat()); });
    setFilter(hashCat());
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (ev) { on(window, ev, function () { moved = true; }, { passive: true }); });


    // ── Configure deep link. A product page's "Configure" button goes to /catalogue/?configure=<family>#cat-… . When the value names a
    // configurable family card of this page, that family's configurator opens at once: this presses the card's own "Configure & add" button,
    // so the sheet, its focus handling and its closing are js/quote-request.js's, exactly as for a visitor's own click (none of it is copied
    // here). Anything else — no value, an unknown family, a fixed product's code — does nothing, and the visitor stays on the category the
    // #cat-… names (which is also where a browser without script lands). quote-request.js is a LATER deferred script and adds the button when
    // it runs, so the button is pressed once every deferred script has run (DOMContentLoaded; "load" and an immediate try cover the rest).
    var wanted = '', asked = /[?&]configure=([^&#]*)/.exec(location.search || '');
    if (asked) { try { wanted = decodeURIComponent(asked[1]); } catch (_) { wanted = ''; } }   // a malformed escape asks for nothing
    var pressed = !wanted;
    function dropConfigure() {                       // like ?quote=1: take it out of the address, so a reload does not open the sheet again
      try {
        var rest = (location.search || '').replace(/^\?/, '').split('&').filter(function (p) { return p && p.split('=')[0] !== 'configure'; }).join('&');
        window.history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + (location.hash || ''));
      } catch (_) { /* no history API, or not allowed: the address keeps the query, which is harmless */ }
    }
    // A page opened at a #fragment has its keyboard focus CLEARED by the browser (Chrome does it at the first rendering after the parser has
    // finished, i.e. a moment after the sheet gave its first control the focus), which would leave the dialog open with the focus on <body>.
    // Before the visitor has touched anything, that control gets the focus back: as soon as the browser reports the clearing (focusout),
    // and by a check after the first frame and at load for a page that has no system focus to report it (a background tab). Never once the
    // visitor has moved on (a key, a click, a scroll, a touch), when the focus went to another control, or when the sheet has gone.
    function keepFocus(given) {
      if (!given || given === d.body) return;
      var back = function () {
        setTimeout(function () {
          if (!moved && given.isConnected && (!d.activeElement || d.activeElement === d.body)) { try { given.focus(); } catch (_) { /* nothing to do */ } }
        }, 0);
      };
      on(d, 'focusout', function (e) { if (e.target === given) back(); }, true);
      window.requestAnimationFrame(back);
      on(window, 'load', back);
    }
    function pressConfigure() {
      if (pressed) return;
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].getAttribute('data-family') !== wanted) continue;
        var btn = cards[i].querySelector('.qr-add-config');
        if (!btn) return;                            // quote-request.js has not added it yet (or did not load): try again later
        pressed = true;
        dropConfigure();
        btn.click();
        keepFocus(d.activeElement);                  // the control the sheet has just focused
        return;
      }
      pressed = true;                                // no family card of that name: nothing to wait for
    }
    pressConfigure();
    on(d, 'DOMContentLoaded', pressConfigure);
    on(window, 'load', pressConfigure);

    // ── Back to top
    if (topBtn) {
      var showTop = function () { topBtn.hidden = window.pageYOffset < 700; };
      on(window, 'scroll', raf(showTop), { passive: true });
      on(topBtn, 'click', function () { window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); });
      showTop();
    }
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})();
