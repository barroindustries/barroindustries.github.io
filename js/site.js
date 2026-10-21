/* js/site.js — public website behaviour (PUBLIC-WEBSITE-SPEC.md §8.3, §9.1), shared by "/" and /catalogue/.
   Zero dependencies. On "/" it is the FIRST <script defer>, ahead of the Firebase SDK, so it must
   never read window.* at parse time — only inside handlers. Controls are bound by id or by class
   delegation (no inline handlers); everything below is a class or attribute toggle, and the only
   text it writes uses textContent (no innerHTML).
   It does five things: the footer year, the Team portal hand-off, the phone menu, the transparent-over-the-
   hero header, and the project lightbox, plus the Luzon-map pin highlight, a quiet fade-up on scroll and the start
   of the hero's logo animation. Catalogue filtering and
   search live in js/catalogue.js; every piece of this file is a no-op when its elements are absent. */
(function () {
  'use strict';
  var d = document;
  function $(id) { return d.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function up(e, sel) { var t = e.target; return t && t.closest ? t.closest(sel) : null; }
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  function init() {
    var site = $('site'), header = $('site-header');

    // Footer year (the static text is the fallback).
    var yr = $('site-year');
    if (yr) yr.textContent = String(new Date().getFullYear());

    // ── Team portal (§9.1): the discreet footer link is the ONLY way into the sign-in from the website (the header
    // carries "Get a quote" now, 2026-10-21). The direct attribute write makes the switch instant even if app.js has not
    // executed yet; openLoginFromSite() then keeps its state (title, etc.) in sync. Only on the
    // homepage: where there is no login screen in this document (the standalone /catalogue/ page)
    // the link is left alone and its href (/#login) takes the visitor to the team sign-in.
    function openLogin(e) {
      if (!$('login-screen')) return;
      e.preventDefault();
      window._wantLogin = true;
      d.documentElement.setAttribute('data-view', 'login');
      if (window.openLoginFromSite) window.openLoginFromSite();
    }
    on($('site-team-portal'), 'click', openLogin);

    // ── Phone menu: toggles #site-nav (and turns the header solid while it is open); a nav link,
    // Escape, or a wide viewport closes it.
    var mb = $('site-menu-btn'), nav = $('site-nav');
    function menu(open) {
      if (!nav || !mb) return;
      nav.classList.toggle('is-open', open);
      if (header) header.classList.toggle('is-menu-open', open);
      mb.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    on(mb, 'click', function () { menu(!(nav && nav.classList.contains('is-open'))); });
    on(nav, 'click', function (e) { if (up(e, 'a')) menu(false); });
    on(d, 'keydown', function (e) { if (e.key === 'Escape') menu(false); });
    on(window, 'resize', function () { if (window.innerWidth >= 900) menu(false); });

    // ── Header: transparent with white text while the page is at the very top (over the hero), solid
    // the moment it has scrolled a little, so it never floats over copy it cannot be read against.
    // Pages without a hero (/catalogue/) never get the transparent state: the header is solid in CSS.
    if (header && $('hero') && site && site.classList.contains('is-home')) {
      var busy = false;
      var solidify = function () { header.classList.toggle('is-solid', (window.pageYOffset || d.documentElement.scrollTop || 0) > 24); };
      on(window, 'scroll', function () {
        if (busy) return;
        busy = true;
        window.requestAnimationFrame(function () { busy = false; solidify(); });
      });
      solidify();
    }

    // ── Hero logo reveal (the <video> in #hero): muted, plays ONCE and holds its final frame; the poster IS that frame. It is started here, not by an
    // autoplay attribute: this same index.html is the installed app and the team sign-in, where <html data-view> is boot / login / app and #site is
    // display:none, and an autoplay video in a hidden page still downloads its megabyte on every launch (measured). preload="none" fetches nothing
    // until play(), and play() is called only when the hero is actually on screen (IntersectionObserver: a hidden or scrolled-away hero never starts
    // it) and never under prefers-reduced-motion. In every other case — reduced motion, a blocked play(), a failed download, no script — the poster
    // (the finished logo) is what shows. Without IntersectionObserver it starts only if the website is the current view.
    var vid = d.querySelector('#hero video');
    if (vid && !reducedMotion() && typeof vid.play === 'function') {
      var start = function () { var p = vid.play(); if (p && p.catch) p.catch(function () {}); };
      if ('IntersectionObserver' in window) {
        var seen = new IntersectionObserver(function (es) {
          for (var j = 0; j < es.length; j++) { if (es[j].isIntersecting) { seen.disconnect(); start(); return; } }
        }, { threshold: 0.3 });
        seen.observe(vid);
      } else if (d.documentElement.getAttribute('data-view') === 'site') start();
    }

    // ── Scroll reveal: a quiet fade-up on first view. Off entirely under prefers-reduced-motion, and
    // only switched on once the observer exists, so a failure leaves everything visible.
    var items = d.querySelectorAll('.reveal');
    if (site && items.length && 'IntersectionObserver' in window && !reducedMotion()) {
      var io = new IntersectionObserver(function (es) {
        for (var i = 0; i < es.length; i++) {
          if (es[i].isIntersecting) { es[i].target.classList.add('is-in'); io.unobserve(es[i].target); }
        }
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
      site.classList.add('js-reveal');
      for (var k = 0; k < items.length; k++) io.observe(items[k]);
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

    // ── Projects-across-Luzon map (section #luzon): hovering a place in the list lights its pin, leader and label on
    // the map, and hovering a pin does the reverse. Only class toggles, on every element that shares the place's
    // data-pin. The page is complete without it: the list is plain text and the map is a labelled picture.
    var lz = $('luzon');
    if (lz) {
      var lit = '';
      var light = function (id) {
        if (id === lit) return;
        var els, i;
        if (lit) { els = lz.querySelectorAll('[data-pin="' + lit + '"]'); for (i = 0; i < els.length; i++) els[i].classList.remove('is-on'); }
        if (id) { els = lz.querySelectorAll('[data-pin="' + id + '"]'); for (i = 0; i < els.length; i++) els[i].classList.add('is-on'); }
        lit = id;
      };
      var pinOf = function (e) { var t = up(e, '[data-pin]'); return t && lz.contains(t) ? t.getAttribute('data-pin') : ''; };
      on(lz, 'mouseover', function (e) { light(pinOf(e)); });
      on(lz, 'mouseout', function (e) { if (!e.relatedTarget || !lz.contains(e.relatedTarget)) light(''); });
      on(lz, 'focusin', function (e) { light(pinOf(e)); });
      on(lz, 'focusout', function () { light(''); });
    }
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})();
