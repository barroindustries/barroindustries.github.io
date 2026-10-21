/* js/site.js — public website behaviour (PUBLIC-WEBSITE-SPEC.md §8.3, §9.1), shared by "/" and /catalogue/.
   Zero dependencies. On "/" it is the FIRST <script defer>, ahead of the Firebase SDK, so it must
   never read window.* at parse time — only inside handlers. Controls are bound by id or by class
   delegation (no inline handlers); everything below is a class or attribute toggle, and the only
   text it writes uses textContent (no innerHTML).
   It does five things: the footer year, the Team portal hand-off, the phone menu, the transparent-over-the-
   hero header, and the project lightbox, plus the Luzon-map pin highlight, a quiet fade-up on scroll and the
   hero's logo intro (a translucent clip behind the headline that flies to the header logo). Catalogue filtering and
   search live in js/catalogue.js; every piece of this file is a no-op when its elements are absent. */
(function () {
  'use strict';
  var d = document;
  function $(id) { return d.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function up(e, sel) { var t = e.target; return t && t.closest ? t.closest(sel) : null; }
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  // a visitor who turned on data saving does not download a megabyte of decoration
  function dataSaver() { var c = typeof navigator !== 'undefined' && (navigator.connection || navigator.mozConnection || navigator.webkitConnection); return !!(c && c.saveData); }

  // ── Hero logo intro (see init() and the note in index.html). Timings in ms: the fade-in is the overlay's CSS transition (.7 s); the clip then runs until
  // max (its finished logo is on screen from about 5.8 s of the 10 s clip) and the overlay FLIES to the header logo for fly ms, lighting that logo with a
  // pulse of the same kind; quick is the fade used whenever there is no fly; wait is how long a clip may take to start before the intro gives up; top is the
  // scroll offset in px past which the header turns solid (the same 24 as solidify() in init) and the intro ends.
  var INTRO = { max: 6500, fly: 850, pulse: 400, quick: 240, wait: 5000, top: 24 };

  function heroIntro(ghost, vid) {
    var hero = d.getElementById('hero') || ghost.parentNode, root = d.documentElement;
    var phase = 'idle';              // idle -> wait (play() called) -> show (the clip is playing) -> fly | fade -> gone
    var timers = [], watching = false, flight = null, io = null, over = false;
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function clear() { while (timers.length) clearTimeout(timers.pop()); }
    function atY() { return window.pageYOffset || (root && root.scrollTop) || 0; }
    function watch(onOff) {
      if (watching === onOff) return;
      watching = onOff;
      var f = onOff ? 'addEventListener' : 'removeEventListener';
      window[f]('scroll', onScroll, { passive: true });
      d[f]('visibilitychange', onVisibility);
      var evs = ['playing', 'ended', 'pause', 'error'], fns = [onPlaying, onEnded, onPause, onError];
      for (var i = 0; i < evs.length; i++) vid[f](evs[i], fns[i]);
    }
    // nothing of the intro stays in the page: the listeners, the timers, the download (the sources go) and the element itself
    function end() {
      if (over) return;
      over = true; phase = 'gone';
      clear(); watch(false);
      if (io) { io.disconnect(); io = null; }
      if (flight) { var a = flight; flight = null; try { a.cancel(); } catch (e) {} }
      try { vid.pause(); } catch (e) {}
      while (vid.firstChild) vid.removeChild(vid.firstChild);
      try { vid.removeAttribute('src'); vid.load(); } catch (e) {}
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    }
    // no fly (scrolled away, nothing to fly to, no Web Animations, the clip stalled or was paused): a quick fade, then gone
    function fade() {
      if (phase === 'fade' || phase === 'gone') return;
      var shown = phase === 'show';
      phase = 'fade'; clear(); watch(false);
      if (!shown) { end(); return; }
      ghost.classList.add('is-off');
      later(end, INTRO.quick + 60);
    }
    // FLIP: the first and last rectangles are measured NOW (the header and the fonts have settled by this time), then only transform and opacity move
    function fly() {
      if (phase !== 'show') return;
      var logo = d.querySelector('#site-brand img');
      if (!logo || typeof ghost.animate !== 'function' || atY() > INTRO.top) { fade(); return; }
      var from = ghost.getBoundingClientRect(), to = logo.getBoundingClientRect(), box = hero.getBoundingClientRect();
      if (!(from.width > 0) || !(to.width > 0) || to.left < box.left || to.top < box.top || to.right > box.right || to.bottom > box.bottom) { fade(); return; }
      phase = 'fly'; clear();
      var s = to.width / from.width;
      var dx = (to.left + to.width / 2) - (from.left + from.width / 2);
      var dy = (to.top + to.height / 2) - (from.top + from.height / 2);
      var op = parseFloat(window.getComputedStyle(ghost).opacity);
      if (!(op > 0)) op = 0.3;
      flight = ghost.animate([
        { transform: 'translate(0px, 0px) scale(1)', opacity: op, offset: 0 },
        { opacity: op * 0.85, offset: 0.6 },
        { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + s + ')', opacity: 0, offset: 1 }
      ], { duration: INTRO.fly, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' });
      flight.onfinish = end;
      later(end, INTRO.fly + 250);
      // a short glow on the header logo as the overlay arrives (scale and box-shadow, 40 px of paint)
      if (typeof logo.animate === 'function') {
        logo.animate([
          { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(226, 199, 102, 0)' },
          { transform: 'scale(1.14)', boxShadow: '0 0 0 2px rgba(226, 199, 102, .75), 0 0 22px 6px rgba(226, 199, 102, .5)', offset: 0.45 },
          { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(226, 199, 102, 0)' }
        ], { duration: INTRO.pulse, delay: Math.round(INTRO.fly * 0.6), easing: 'ease-in-out' });
      }
    }
    function onPlaying() {
      if (phase !== 'wait') return;
      phase = 'show'; clear();
      ghost.classList.add('is-on');
      later(fly, INTRO.max);
    }
    function onEnded() { if (phase === 'show') { clear(); fly(); } }
    function onPause() { if (phase === 'show' && !vid.ended) fade(); }   // the browser paused it (power saving, an interruption)
    function onError() { fade(); }
    function onScroll() { if (atY() > INTRO.top) fade(); }   // in 'show': a quick fade; while flying (its target would have moved) or waiting: gone at once, inside fade()
    function onVisibility() { if (d.visibilityState === 'hidden') end(); }

    // the page has loaded and the hero is on screen: start, if everything still allows it
    function begin() {
      if (phase !== 'idle') return;
      if (root.getAttribute('data-view') !== 'site' || d.visibilityState === 'hidden' || atY() > INTRO.top) { end(); return; }
      phase = 'wait';
      watch(true);
      ghost.hidden = false;
      var p;
      try { p = vid.play(); } catch (e) { end(); return; }
      if (p && typeof p.catch === 'function') p.catch(end);   // refused (autoplay policy, low-power mode) or interrupted: skip the intro
      later(function () { if (phase === 'wait') end(); }, INTRO.wait);
    }
    // The clip is 0.8-1.3 MB: it must not compete with the page's own load, whose largest paint is the hero photo. So play() waits for the load event (at
    // once when the page has already loaded) and for the hero to be on screen (IntersectionObserver: a hidden or scrolled-away hero never starts it).
    // Without IntersectionObserver it starts only if the website is the current view.
    function loaded(fn) { if (d.readyState === 'complete') fn(); else window.addEventListener('load', fn, { once: true }); }
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) {
        for (var j = 0; j < es.length; j++) { if (es[j].isIntersecting) { io.disconnect(); io = null; loaded(begin); return; } }
      }, { threshold: 0.3 });
      io.observe(hero);
    } else if (root.getAttribute('data-view') === 'site') loaded(begin);
  }

  function init() {
    var site = $('site'), header = $('site-header');

    // Footer year (the static text is the fallback).
    var yr = $('site-year');
    if (yr) yr.textContent = String(new Date().getFullYear());

    // ── Team portal (§9.1): the discreet footer link is the ONLY way into the sign-in from the website (the header
    // carries "Get a quote" now, 2026-10-21). Only on the homepage: where there is no login screen in this document
    // (the standalone /catalogue/ page) the link is left alone and its href (/#login) takes the visitor to the team sign-in.
    // Two cases on the homepage:
    //  - the app is already in this page (a staff member pressed "Back to website" from the sign-in): switch the view
    //    in place, exactly as before — the direct attribute write is instant, openLoginFromSite() keeps its state (title, etc.) in sync.
    //  - the website view, which DOES NOT LOAD THE APP (index.html's PERF note: no Firebase SDK, no app stylesheet, no app script
    //    for a visitor who only reads the site): hand over by reloading into /#login. The head script then picks the "login"
    //    view and writes the app kit, so this is the same path as typing that address — the one boot path, no second loader to
    //    keep in step with it. replace(), not assign(): no extra history entry, as before (the click never touched the URL).
    function openLogin(e) {
      if (!$('login-screen')) return;
      e.preventDefault();
      if (window.openLoginFromSite) {
        window._wantLogin = true;
        d.documentElement.setAttribute('data-view', 'login');
        window.openLoginFromSite();
        return;
      }
      try { var to = new URL(window.location.href); to.hash = 'login'; window.location.replace(to.href); } catch (_) {}
      window.location.reload();
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

    // ── Hero logo intro (the overlay #hero .hero-ghost; the note in index.html has the whole sequence): a muted clip of the brand's logo animation plays
    // ONCE, large and translucent behind the headline, then flies onto the header logo (#site-brand img) and is removed. It is started here, not by an
    // autoplay attribute: this same index.html is the installed app and the team sign-in, where <html data-view> is boot / login / app and #site is
    // display:none, and an autoplay video in a hidden page still downloads its megabyte on every launch (measured). preload="none" fetches nothing
    // until play(). Without script the overlay's hidden attribute keeps it out of the page; under prefers-reduced-motion (or a data-saver request) it is
    // never started and is removed. The intro is decoration: whatever goes wrong, it ends without a trace and the page is untouched.
    var ghost = d.querySelector('#hero .hero-ghost'), gvid = ghost && ghost.querySelector('video');
    if (ghost && gvid && typeof gvid.play === 'function') {
      try {
        if (reducedMotion() || dataSaver()) { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); } else heroIntro(ghost, gvid);
      } catch (e) { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }
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
