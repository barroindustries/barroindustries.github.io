/* js/ads-tag.js — Google Ads conversion tracking for the PUBLIC pages of barroindustries.com (owner-approved 2026-11-22).
   Self-hosted so the pages' strict CSP (script-src 'self' + https://www.googletagmanager.com) needs no inline script.
   It is a SITE asset: every public page loads it with <script src="/js/ads-tag.js" defer> (scripts/add-ads-tag.js keeps that and the CSP in
   step), and the website view of index.html gets it from js/site.js. It is NEVER in index.html's app-kit — the staff app does not load it.
   - Waits until after window 'load', then requestIdleCallback (or a 1500 ms timeout), so it never competes with first paint.
   - gtag('config', ...) with no extra parameters; no cookies of our own, no personal data in any event (a conversion carries only send_to).
   - window.bkConversion(kind): 'quote' | 'phone' | 'messenger'. A call made before the library has loaded is queued on dataLayer and is not lost.
   - One delegated capture-phase click listener: tel: links -> phone; Messenger links (m.me / messenger.com / facebook.com/messages) -> messenger.
   - Meta pixel (dataset "Barro Kitchens website", 1178407724523928; owner asked 2026-11-22): PageView on load, Lead on a sent quote request,
     Contact on a phone or Messenger tap. Loaded the same deferred way from https://connect.facebook.net; no personal data is passed.
   - Does nothing on localhost, 127.0.0.1, [::1] or file:. */
(function () {
  'use strict';
  if (window.__bkAdsTag) return;
  window.__bkAdsTag = true;

  var TAG = 'AW-17909483388';
  var LABELS = {
    quote: 'AW-17909483388/IA0JCOG6lL0dEPyO9NtC',
    phone: 'AW-17909483388/ahv3COS6lL0dEPyO9NtC',
    messenger: 'AW-17909483388/NlCpCNL5lb0dEPyO9NtC'
  };

  var META_PIXEL = '1178407724523928';
  var META_EVENTS = { quote: 'Lead', phone: 'Contact', messenger: 'Contact' };

  var host = (location && location.hostname) || '';
  if (location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || /\.localhost$/.test(host)) {
    window.bkConversion = function () {};
    return;
  }

  window.dataLayer = window.dataLayer || [];
  // gtag must push the `arguments` object itself (not an array): that is what the loaded library recognises.
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  // Meta pixel queue stub (the standard fbq shape): calls made before fbevents.js loads are queued and replayed by it.
  if (!window.fbq) {
    var fbq = window.fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
    if (!window._fbq) window._fbq = fbq;
    fbq.push = fbq; fbq.loaded = true; fbq.version = '2.0'; fbq.queue = [];
  }

  var sent = Object.create(null);
  function conversion(kind) {
    var to = LABELS[kind];
    if (!to) return;
    window.gtag('event', 'conversion', { send_to: to });
    window.fbq('track', META_EVENTS[kind]);
  }
  window.bkConversion = conversion;

  function isMessenger(href) {
    return /^https?:\/\/(www\.)?(m\.me|messenger\.com)\//i.test(href) || /^https?:\/\/(www\.|m\.)?facebook\.com\/messages(\/|\?|$)/i.test(href);
  }
  document.addEventListener('click', function (e) {
    var t = e.target, a = t && t.closest ? t.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^tel:/i.test(href)) conversion('phone');
    else if (isMessenger(href)) conversion('messenger');
  }, true);

  function start() {
    if (sent.loaded) return;
    sent.loaded = true;
    window.gtag('js', new Date());
    window.gtag('config', TAG);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + TAG;
    document.head.appendChild(s);
    window.fbq('init', META_PIXEL);
    window.fbq('track', 'PageView');
    var m = document.createElement('script');
    m.async = true;
    m.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(m);
  }
  function afterLoad() {
    if (window.requestIdleCallback) window.requestIdleCallback(start, { timeout: 1500 });
    else setTimeout(start, 1500);
  }
  if (document.readyState === 'complete') afterLoad();
  else window.addEventListener('load', afterLoad);
})();
