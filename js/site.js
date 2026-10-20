/* js/site.js — public website behaviour (PUBLIC-WEBSITE-SPEC.md §7.4, §8.3, §9.1).
   Zero dependencies. It is the FIRST <script defer> in index.html, ahead of the Firebase
   SDK, so it must never read window.* at parse time — only inside handlers. Controls are
   bound by id or by class delegation (no inline handlers); everything below is a class or
   attribute toggle, and the only text it writes uses textContent (no innerHTML, and the
   search query is compared, never rendered as markup). */
(function () {
  'use strict';
  var d = document;
  function $(id) { return d.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function up(e, sel) { var t = e.target; return t && t.closest ? t.closest(sel) : null; }

  function init() {
    // Footer year (the static text is the fallback).
    var yr = $('site-year');
    if (yr) yr.textContent = String(new Date().getFullYear());

    // ── Login (§9.1): the direct attribute write makes the switch instant even if app.js
    // has not executed yet; openLoginFromSite() then keeps its state (title, etc.) in sync.
    function openLogin(e) {
      e.preventDefault();
      window._wantLogin = true;
      d.documentElement.setAttribute('data-view', 'login');
      if (window.openLoginFromSite) window.openLoginFromSite();
    }
    on($('site-login-btn'), 'click', openLogin);
    on($('site-footer-login'), 'click', openLogin);

    // ── Phone menu: toggles #site-nav; a nav link closes it.
    var mb = $('site-menu-btn'), nav = $('site-nav');
    function menu(open) {
      if (!nav || !mb) return;
      nav.classList.toggle('is-open', open);
      mb.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    on(mb, 'click', function () { menu(!(nav && nav.classList.contains('is-open'))); });
    on(nav, 'click', function (e) { if (up(e, 'a')) menu(false); });

    // ── Catalogue (§7.4): chips set #catalogue[data-filter]; search toggles .is-hidden.
    var cat = $('catalogue'), chips = $('cat-chips'), search = $('cat-search'), empty = $('cat-empty');
    if (cat && chips) {
      var setFilter = function (key, btn, quiet) {
        cat.setAttribute('data-filter', key);
        var all = chips.querySelectorAll('.cat-chip');
        for (var k = 0; k < all.length; k++) {
          var act = all[k] === btn;
          all[k].classList.toggle('is-active', act);
          all[k].setAttribute('aria-pressed', act ? 'true' : 'false');
        }
        if (quiet || !btn) return;
        if (btn.scrollIntoView) btn.scrollIntoView({ inline: 'nearest', block: 'nearest' });
        if (cat.getBoundingClientRect().top < 0) cat.scrollIntoView();   // only when the user is below it
      };
      on(chips, 'click', function (e) {
        var b = up(e, '.cat-chip');
        if (b) setFilter(b.getAttribute('data-cat') || 'all', b);
      });
      // "Show all N" / "Show fewer" — toggles .is-open on the group.
      on(cat, 'click', function (e) {
        var m = up(e, '.cat-more');
        if (!m) return;
        var g = m.closest('.cat-group'), open = g.classList.toggle('is-open'), n = g.querySelector('.cat-count');
        m.setAttribute('aria-expanded', open ? 'true' : 'false');
        m.textContent = open ? 'Show fewer' : 'Show all ' + (n ? n.textContent : '');
      });

      var timer = 0;
      var runSearch = function () {
        var raw = search.value.trim(), q = raw.toLowerCase();
        // Searching ignores the chip filter: it resets the chip to All and un-folds every group.
        if (q && cat.getAttribute('data-filter') !== 'all') setFilter('all', chips.querySelector('.cat-chip'), true);
        if (q) cat.setAttribute('data-searching', '1'); else cat.removeAttribute('data-searching');
        var cards = cat.querySelectorAll('.cat-card'), c;
        for (c = 0; c < cards.length; c++) {
          cards[c].classList.toggle('is-hidden', !!q && (cards[c].getAttribute('data-name') || '').indexOf(q) < 0);
        }
        var groups = cat.querySelectorAll('.cat-group'), shown = 0;
        for (c = 0; c < groups.length; c++) {
          var any = !!groups[c].querySelector('.cat-card:not(.is-hidden)');
          groups[c].classList.toggle('is-empty', !any);
          if (any) shown++;
        }
        if (empty) {
          empty.hidden = !(q && !shown);
          if (q && !shown) empty.textContent = 'No products match "' + raw + '".';
        }
      };
      on(search, 'input', function () { clearTimeout(timer); timer = setTimeout(runSearch, 120); });
    }

    // ── Project photo lightbox (§8.3). Without <dialog> support the anchor just opens the image.
    var dlg = $('site-lightbox'), img = $('site-lightbox-img');
    if (dlg && img && typeof dlg.showModal === 'function') {
      on($('projects'), 'click', function (e) {
        var a = up(e, 'a[data-lightbox]');
        if (!a) return;
        e.preventDefault();
        var th = a.querySelector('img');
        img.src = a.getAttribute('href');
        img.alt = th ? th.getAttribute('alt') || '' : '';
        dlg.showModal();
      });
      on($('site-lightbox-close'), 'click', function () { dlg.close(); });
      on(dlg, 'click', function (e) { if (e.target === dlg) dlg.close(); });   // backdrop click
      on(dlg, 'close', function () { img.removeAttribute('src'); });
    }
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})();
