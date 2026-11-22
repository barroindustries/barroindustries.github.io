// Google Ads conversion tracking on the PUBLIC pages (owner-approved 2026-11-22): js/ads-tag.js, scripts/add-ads-tag.js, the per-page <script> and CSP.
//   · js/ads-tag.js carries the tag id and the three conversion labels, waits for load + idle, queues early calls on dataLayer, skips dev hosts,
//     listens (one delegated capture click listener) for tel: and Messenger links, and sets no cookie;
//   · every public page loads /js/ads-tag.js exactly once, deferred, and its CSP lets Google's hosts through (and nothing inline);
//   · index.html (website + staff app): the tag is NOT in <template id="app-kit"> and not a static script — js/site.js adds it for the website view only;
//   · the quote request fires bkConversion('quote') once, in the success path only;
//   · scripts/add-ads-tag.js is idempotent and CHECK-able.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { GTM, ADS_IMG, ADS_CONNECT, ADS_FRAME } from './helpers/ads-csp.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const require = createRequire(import.meta.url);
const GEN = require('../scripts/add-ads-tag.js');
const js = read('js/ads-tag.js');
const CSP_RE = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?>/;
const dirOf = (csp) => Object.fromEntries(csp.split(';').map((x) => x.trim()).filter(Boolean).map((x) => [x.split(/\s+/)[0], x.split(/\s+/).slice(1)]));
const PAGES = GEN.pageList();

describe('js/ads-tag.js', () => {
  it('carries the tag id and the three conversion labels, and loads Google\'s tag library', () => {
    assert.ok(js.includes("'AW-17909483388'"));
    assert.ok(js.includes("quote: 'AW-17909483388/IA0JCOG6lL0dEPyO9NtC'"));
    assert.ok(js.includes("phone: 'AW-17909483388/ahv3COS6lL0dEPyO9NtC'"));
    assert.ok(js.includes("messenger: 'AW-17909483388/NlCpCNL5lb0dEPyO9NtC'"));
    assert.ok(js.includes("https://www.googletagmanager.com/gtag/js?id="));
  });
  it('waits for window load, then idle (1500 ms cap), and sets no cookie and no storage', () => {
    assert.ok(/addEventListener\('load'/.test(js) && /requestIdleCallback\(start, \{ timeout: 1500 \}\)/.test(js) && /setTimeout\(start, 1500\)/.test(js));
    assert.ok(!/document\.cookie|localStorage|sessionStorage|indexedDB/.test(js.replace(/\/\*[\s\S]*?\*\//g, '')));
  });
  it('has ONE delegated capture-phase click listener: tel: -> phone, Messenger (m.me, messenger.com, facebook.com/messages) -> messenger', () => {
    assert.equal((js.match(/addEventListener\('click'/g) || []).length, 1);
    assert.ok(/addEventListener\('click', function \(e\) \{[\s\S]*?\}, true\);/.test(js), 'not a capture listener');
    assert.ok(/\^tel:/.test(js) && /m\\\.me\|messenger\\\.com/.test(js) && /facebook\\\.com\\\/messages/.test(js));
  });

  // run it in a fake browser
  const run = (host, protocol = 'https:') => {
    const log = { scripts: [], listeners: {}, idle: [], timers: [] };
    const doc = {
      readyState: 'loading', head: { appendChild: (s) => log.scripts.push(s.src) },
      createElement: () => ({}), addEventListener: (t, fn, cap) => { log.listeners[t] = { fn, cap }; },
    };
    const win = { dataLayer: undefined, addEventListener: (t, fn) => { log.listeners['win:' + t] = fn; }, requestIdleCallback: (fn) => log.idle.push(fn) };
    const ctx = { window: win, document: doc, location: { hostname: host, protocol }, setTimeout: (fn) => log.timers.push(fn), Object, Date };
    win.window = win; ctx.window = win;
    vm.runInNewContext(js, ctx);
    return { win, doc, log };
  };
  it('queues a conversion fired before the library loads on dataLayer, then injects the library after load + idle', () => {
    const { win, log } = run('barroindustries.com');
    win.bkConversion('quote');
    assert.equal(win.dataLayer.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(Array.from(win.dataLayer[0]))), ['event', 'conversion', { send_to: 'AW-17909483388/IA0JCOG6lL0dEPyO9NtC' }]);
    assert.deepEqual(log.scripts, [], 'nothing is loaded before the window load event');
    log.listeners['win:load']();
    log.idle[0]();
    assert.deepEqual(log.scripts, ['https://www.googletagmanager.com/gtag/js?id=AW-17909483388', 'https://connect.facebook.net/en_US/fbevents.js']);   // + the Meta pixel (owner, 2026-11-22)
    assert.deepEqual(Array.from(win.dataLayer, (a) => a[0]), ['event', 'js', 'config']);
    assert.equal(win.dataLayer[2][1], 'AW-17909483388');
    assert.ok(!('bkConversion' in {}) && win.bkConversion('nope') === undefined && win.dataLayer.length === 3, 'an unknown kind sends nothing');
  });
  it('the click listener sends phone for tel: links and messenger for Messenger links, and nothing for other links', () => {
    const { win, log } = run('barroindustries.com');
    assert.equal(log.listeners.click.cap, true);
    const click = (href) => log.listeners.click.fn({ target: { closest: () => ({ getAttribute: () => href }) } });
    click('tel:+639171234567'); click('https://m.me/barrokitchens'); click('https://www.messenger.com/t/x'); click('https://facebook.com/messages/t/x');
    click('https://facebook.com/barrokitchens'); click('/catalogue/'); click('mailto:a@b.c');
    assert.deepEqual(Array.from(win.dataLayer, (a) => a[2].send_to.split('/')[1]), ['ahv3COS6lL0dEPyO9NtC', 'NlCpCNL5lb0dEPyO9NtC', 'NlCpCNL5lb0dEPyO9NtC', 'NlCpCNL5lb0dEPyO9NtC']);
  });
  it('does nothing on localhost, 127.0.0.1 and file:', () => {
    for (const [h, p] of [['localhost', 'http:'], ['127.0.0.1', 'http:'], ['', 'file:']]) {
      const { win, log } = run(h, p);
      assert.equal(win.dataLayer, undefined, h || p);
      assert.deepEqual(Object.keys(log.listeners), []);
      assert.doesNotThrow(() => win.bkConversion('quote'));
    }
  });
});

describe('every public page loads the tag once and allows Google in its CSP', () => {
  it('covers the products, services, work, areas, faq, guides, catalogue, the project brief and the 404 page', () => {
    assert.ok(PAGES.length >= 130, 'found ' + PAGES.length + ' pages');
    for (const d of ['products/', 'services/', 'work/', 'areas-we-serve/', 'faq/', 'guides/', 'catalogue/', 'sales/clientinformationrequest/']) assert.ok(PAGES.some((f) => f.startsWith(d)), d);
    assert.ok(PAGES.includes('404.html'));
  });
  it('each page: one deferred <script src="/js/ads-tag.js">, after js/site.js, in the body; CSP allows the Google hosts and stays free of unsafe-*', () => {
    for (const f of PAGES) {
      const h = read(f);
      assert.equal((h.match(/<script[^>]*\/js\/ads-tag\.js/g) || []).length, 1, `${f}: ads-tag.js must load exactly once`);
      assert.ok(h.includes('<script src="/js/ads-tag.js" defer></script>'), `${f}: the tag line`);
      assert.ok(h.indexOf('/js/ads-tag.js') > h.indexOf('<body'), `${f}: the tag is in the body, deferred`);
      const csp = h.match(CSP_RE)[1], dir = dirOf(csp);
      assert.ok(dir['script-src'].includes(GTM), `${f}: script-src must allow ${GTM}`);
      for (const t of ADS_CONNECT) assert.ok(dir['connect-src'].includes(t), `${f}: connect-src ${t}`);
      assert.ok(dir['connect-src'].includes("'self'"), `${f}: connect-src keeps 'self'`);
      for (const t of ADS_IMG) assert.ok(dir['img-src'].includes(t) || dir['img-src'].includes('https:'), `${f}: img-src ${t}`);
      for (const t of ADS_FRAME) assert.ok(dir['frame-src'].includes(t), `${f}: frame-src ${t}`);
      assert.ok(!dir['frame-src'].includes("'none'"), `${f}: frame-src must not keep 'none' beside hosts`);
      assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), `${f}: unsafe-*`);
      assert.equal((h.match(/<script(?![^>]*\ssrc=)(?![^>]*type="application\/(ld\+)?json")[^>]*>/g) || []).length, 0, `${f}: an inline script`);
    }
  });
  it('index.html: CSP allows Google; the tag is NOT a static script and NOT in the app kit; js/site.js adds it for the website view only', () => {
    const h = read('index.html');
    const dir = dirOf(h.match(CSP_RE)[1]);
    assert.ok(dir['script-src'].includes(GTM));
    for (const t of ADS_CONNECT) assert.ok(dir['connect-src'].includes(t));
    for (const t of ADS_FRAME) assert.ok(dir['frame-src'].includes(t));
    assert.ok(!/ads-tag/.test(h), 'index.html must not name the tag at all (static or in the kit)');
    const kit = h.match(/<template id="app-kit">[\s\S]*?<\/template>/)[0];
    assert.ok(!/ads-tag/.test(kit));
    const site = read('js/site.js');
    assert.ok(/getAttribute\('data-view'\) === 'site'[\s\S]{0,400}ads-tag\.js/.test(site), 'site.js adds the tag only in the website view');
    for (const f of ['js/app.js', 'js/config.js', 'sw.js']) assert.ok(!/ads-tag/.test(read(f)), `${f} must not know the tag`);
    assert.ok(!/ads-tag/.test(read('precache-manifest.json')), 'a site asset is never precached');
  });
});

describe('the quote request', () => {
  const qr = read('js/quote-request.js');
  it('fires bkConversion(\'quote\') once, as the first thing onSubmitted does (the success path only)', () => {
    assert.equal((qr.match(/bkConversion\('quote'\)/g) || []).length, 1);
    const body = qr.slice(qr.indexOf('function onSubmitted('));
    assert.ok(body.slice(0, 400).includes("window.bkConversion && window.bkConversion('quote')"));
    assert.equal((qr.match(/onSubmitted\(res, snap\);/g) || []).length, 1, 'onSubmitted is called from one place');
    const call = qr.indexOf('onSubmitted(res, snap);');
    assert.ok(qr.slice(call - 120, call).includes('setBusy(false)') && qr.slice(call, call + 80).includes('}, function (e) {'), 'the call sits in the fulfilled branch, not the error handler');
  });
  it('sends no personal data: the conversion helper only ever sends send_to', () => {
    assert.equal((js.match(/gtag\('event'/g) || []).length, 1);
    assert.ok(js.includes("{ send_to: to }"));
  });
});

describe('scripts/add-ads-tag.js', () => {
  it('is idempotent and its --check passes on the committed pages', () => {
    for (const f of ['guides/index.html', 'catalogue/index.html', '404.html']) assert.equal(GEN.fix(read(f), false), read(f), f);
    assert.equal(GEN.fix(read('index.html'), true), read('index.html'));
  });
  it('adds the tag and the CSP entries to a page that has neither, and a second pass changes nothing', () => {
    const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'none'; object-src 'none'";
    const page = `<html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>\n<script defer src="/js/site.js"></script>\n</body></html>`;
    const once = GEN.fix(page, false);
    assert.ok(once.includes('<script defer src="/js/site.js"></script>\n<script src="/js/ads-tag.js" defer></script>\n'));
    const d = dirOf(once.match(CSP_RE)[1]);
    assert.deepEqual(d['connect-src'], ["'self'", ...ADS_CONNECT]);
    assert.deepEqual(d['frame-src'], ADS_FRAME);
    assert.equal(GEN.fix(once, false), once);
  });
});

describe('Meta pixel in js/ads-tag.js (owner, 2026-11-22)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/ads-tag.js'), 'utf8');
  it('initialises the Barro Kitchens website dataset and loads fbevents.js from connect.facebook.net', () => {
    assert.ok(src.includes("META_PIXEL = '1178407724523928'"));
    assert.ok(src.includes("'https://connect.facebook.net/en_US/fbevents.js'"));
    assert.ok(src.includes("window.fbq('track', 'PageView')"));
  });
  it('maps a sent quote to Lead and phone/Messenger taps to Contact', () => {
    assert.ok(src.includes("{ quote: 'Lead', phone: 'Contact', messenger: 'Contact' }"));
    assert.ok(src.includes("window.fbq('track', META_EVENTS[kind])"));
  });
});
