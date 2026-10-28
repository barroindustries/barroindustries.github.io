/* js/late-fonts.js — the web fonts of the standalone public pages that opt in (every page with a PAGE-CSS block, see scripts/inline-page-css.js: the product pages, /services/ and
   its service pages, /work/ and its project pages, /areas-we-serve/, /faq/ and the guides), requested AFTER the page has loaded.
   The homepage does the same with an inline script (see the note beside it in index.html). These pages keep a strict CSP with no inline script, so the same
   few lines live here, in a file of their own, and every opted-in page loads it with the other deferred script.
   Why late: a Google Fonts <link> in the head is a third-party stylesheet behind a connection of its own, and it blocks the first paint; worse, the font files
   it brings (about 115 KB) land at about the moment of that paint, so whether a phone's first paint waits for them is a race. Measured with Lighthouse mobile
   on the calibrated stand-in for the live host (HTTP/2, 250 ms server response): first paint 2.0 s or 3.4 s from run to run with the <link> in the head, 1.3 s
   every time with the fonts requested here. The page paints in the fallback stack (font-display is swap), and Fraunces and Inter swap in when they arrive
   (the layout shift measured on the sinks page: 0.01).
   Without JavaScript the page's own <noscript> carries the same <link>. The URL below and the one in each page's <noscript> must be identical (tests/seo-products.test.mjs
   pins it). Zero dependencies; reads no global; writes no text. Never precached (not part of the app shell). */
(function () {
  'use strict';
  var URL = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..600&family=Inter:wght@400;500;600&display=swap';
  function add() {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = URL;
    document.head.appendChild(l);
  }
  function later() { setTimeout(add, 300); }
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later);
})();
