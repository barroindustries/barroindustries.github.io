/* js/catalogue.js — behaviour of the public /catalogue/ page. Zero dependencies; the page loads no
   Firebase and no app script. Every control is bound by id or class delegation (no inline handlers),
   everything below is a class or attribute toggle, and the only text it writes uses textContent
   (the visitor's query is compared and echoed with textContent, never parsed as markup).
   What it does: live search over every product, a scroll-spy that highlights the current category
   (a sticky sidebar from 1024px, a sticky chip bar on phones), deep links such as #cat-baking
   that land under the sticky header, and a back-to-top button. */
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
    var idle = status ? status.textContent : '';

    // What a card can be found by: its code, name, size line, notes and spec rows (not the photo caption). A configurable product's card also
    // carries the names and codes of the products it replaced in data-kw (never shown), so "PW-006" or "double sink" still finds the Sink.
    var haystack = cards.map(function (c) {
      var parts = c.querySelectorAll('.cat-code, h3, .cat-meta, .cat-notes, .cat-specs'), s = c.getAttribute('data-kw') || '';
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
      setActive(idOf(pick()));
    }
    var timer = 0;
    on(input, 'input', function () {
      if (clearBtn) clearBtn.hidden = !input.value;
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

    // ── Scroll-spy: the current category is the last section whose top has passed the line under the
    // sticky chrome. An IntersectionObserver on a 2px band at that line tells us when to recompute.
    var activeId = '', lockUntil = 0, io = null;
    function barHeight() {
      return nav && window.innerWidth < 1024 && window.getComputedStyle(nav).position === 'sticky' ? nav.getBoundingClientRect().height : 0;
    }
    // The line sits just below where a deep link places a section (scroll-margin-top: header + 24px on the desktop,
    // header + chip bar + 12px on a phone), so the section you were sent to is the one that reads as current.
    function lineY() { var bar = barHeight(); return Math.round((header ? header.getBoundingClientRect().height : 64) + bar + (bar ? 16 : 28)); }
    function pick() {
      var y = lineY(), best = null;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].classList.contains('is-empty')) continue;
        if (groups[i].getBoundingClientRect().top <= y + 2) best = groups[i]; else break;
      }
      return best;
    }
    function idOf(g) { return g ? g.getAttribute('data-cat') : ''; }
    function keepVisible(a) {                      // scroll the nav itself (never the page) so the active link stays in view
      if (!nav) return;
      if (nav.scrollWidth > nav.clientWidth + 1) {
        var left = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
        if (nav.scrollTo) nav.scrollTo({ left: left, behavior: reduced() ? 'auto' : 'smooth' }); else nav.scrollLeft = left;
      } else if (nav.scrollHeight > nav.clientHeight + 1) {
        nav.scrollTop = a.offsetTop - (nav.clientHeight - a.offsetHeight) / 2;
      }
    }
    function setActive(id) {
      if (id === activeId) return;
      activeId = id;
      links.forEach(function (a) {
        var is = a.getAttribute('data-cat') === id;
        a.classList.toggle('is-active', is);
        if (is) { a.setAttribute('aria-current', 'true'); keepVisible(a); } else a.removeAttribute('aria-current');
      });
    }
    function observe() {
      if (io) io.disconnect();
      if (!('IntersectionObserver' in window)) return;
      var y = lineY();
      io = new IntersectionObserver(function () { if (Date.now() >= lockUntil) setActive(idOf(pick())); },
        { rootMargin: '-' + y + 'px 0px -' + Math.max(0, window.innerHeight - y - 2) + 'px 0px', threshold: [0, 1] });
      groups.forEach(function (g) { io.observe(g); });
    }
    // A click on a category: highlight it at once and ignore the observer until the scroll has settled.
    on(nav, 'click', function (e) {
      var a = up(e, '.cat-link');
      if (!a) return;
      lockUntil = Date.now() + 1500;
      setActive(a.getAttribute('data-cat'));
      window.setTimeout(function () { lockUntil = 0; setActive(idOf(pick())); }, 1550);
    });
    var resizeTimer = 0;
    on(window, 'resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { observe(); setActive(idOf(pick())); }, 150); });
    if (!('IntersectionObserver' in window)) on(window, 'scroll', raf(function () { setActive(idOf(pick())); }), { passive: true });
    observe();
    setActive(idOf(pick()));

    // ── Deep links: the browser scrolls to #cat-… itself (scroll-margin-top clears the sticky chrome). Fonts arriving
    // and late layout can move the target a few pixels afterwards, so for the first few seconds we check that the
    // section still sits where the scroll margin puts it and re-align when it does not — unless the visitor has
    // already scrolled, in which case we never fight them.
    var moved = false;
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (ev) { on(window, ev, function () { moved = true; }, { passive: true }); });
    function deepTarget() {
      if (!/^#cat-/.test(location.hash)) return null;
      try { return d.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (_) { return null; }   // a malformed escape leaves the browser's own scroll
    }
    function realign() {
      var el = deepTarget();
      if (moved || !el || !el.scrollIntoView) return;
      var want = parseFloat(window.getComputedStyle(el).scrollMarginTop) || 0;
      if (Math.abs(el.getBoundingClientRect().top - want) > 2) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      setActive(idOf(pick()));
    }
    if (deepTarget()) {
      on(window, 'load', realign);
      if (d.fonts) {
        if (d.fonts.ready) d.fonts.ready.then(realign);
        if (d.fonts.addEventListener) d.fonts.addEventListener('loadingdone', realign);
      }
      var polls = 0, poll = window.setInterval(function () { realign(); if (++polls >= 14 || moved) window.clearInterval(poll); }, 250);
    }
    on(window, 'hashchange', function () { moved = true; setActive(idOf(pick())); });

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
