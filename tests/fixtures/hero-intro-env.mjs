// tests/fixtures/hero-intro-env.mjs — a small fake browser for the hero logo intro in js/site.js (the repo has no DOM library, and no dependency may be added).
//
// js/site.js is run, unmodified, in a vm context whose `document` and `window` are scriptable fakes: the page, the overlay (#hero .hero-ghost), its clip, the header logo
// (#site-brand img), the hero box, the IntersectionObserver, timers on a VIRTUAL clock and every event the intro listens to (load, scroll, visibilitychange, and the
// clip's playing / ended / pause / error). A test can therefore play the whole sequence — load, hero on screen, play(), the clip running for six and a half seconds,
// the fly, the landing — in microseconds, and read back exactly what the intro did: which calls it made, which classes it put on the overlay, the keyframes it
// handed to Element.animate, whether anything is still listening, whether the overlay is gone.
//
//   const env = makeEnv(siteJs, { view: 'site', readyState: 'complete', reduced: false, ... });
//   env.intersect(true);            // the hero scrolls into view (the page has loaded, so play() is called now)
//   env.fire('video', 'playing');   // the clip is really playing: the overlay fades in
//   env.tick(6500);                 // six and a half seconds later: the fly starts
//
// Not a test file (no .test.mjs): `node --test tests/*.test.mjs` does not run it.
import vm from 'node:vm';

const rect = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height });

// "translate(-975px, -351px) scale(0.074)" -> { dx, dy, s }
export function parseTransform(t) {
  const m = /^translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\((-?[\d.e+-]+)\)$/.exec(String(t));
  if (!m) throw new Error('not a translate + scale transform: ' + t);
  return { dx: Number(m[1]), dy: Number(m[2]), s: Number(m[3]) };
}

export function makeEnv(siteJs, o = {}) {
  const opt = {
    reduced: false,            // prefers-reduced-motion: reduce
    saveData: undefined,       // navigator.connection.saveData (undefined: no navigator.connection at all)
    io: true,                  // IntersectionObserver exists
    view: 'site',              // <html data-view>
    readyState: 'complete',    // document.readyState when the script runs ('interactive' = parsed, not yet loaded)
    visibility: 'visible',     // document.visibilityState
    y: 0,                      // window.pageYOffset
    play: 'resolve',           // what video.play() does: 'resolve' | 'reject' (autoplay refused) | 'throw'
    animate: true,             // Element.prototype.animate exists
    logo: true,                // #site-brand img exists
    opacity: 0.35,             // the overlay's computed opacity at the moment the fly starts
    ghostRect: { left: 896, top: 144, width: 486, height: 486 },
    logoRect: { left: 146, top: 18, width: 36, height: 36 },
    heroRect: { left: 0, top: 0, width: 1440, height: 774 },
    ...o,
  };
  const log = [];
  const listeners = { window: [], document: [], video: [] };
  const add = (who) => (ev, fn, options) => { listeners[who].push({ ev, fn, once: !!(options && options.once) }); };
  const remove = (who) => (ev, fn) => { const i = listeners[who].findIndex((l) => l.ev === ev && l.fn === fn); if (i >= 0) listeners[who].splice(i, 1); };
  const fire = (who, ev, evt = {}) => { for (const l of listeners[who].filter((x) => x.ev === ev)) { if (l.once) remove(who)(ev, l.fn); l.fn(evt); } };

  // ── timers, on a virtual clock ───────────────────────────────────────────────────────────────────────────────
  let now = 0, seq = 0;
  const timers = new Map();
  const fakeSetTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; };
  const fakeClearTimeout = (id) => { timers.delete(id); };
  const tick = (ms) => {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      timers.delete(next.id); now = next.t.at; next.t.fn();
    }
    now = end;
  };

  // ── the page ─────────────────────────────────────────────────────────────────────────────────────────────────
  const classes = new Set();
  const animations = [];
  const video = {
    ended: false,
    children: [{ tag: 'source', src: 'site/img/brand/brand-reveal-480.mp4' }, { tag: 'source', src: 'site/img/brand/brand-reveal-720.mp4' }],
    get firstChild() { return this.children[0] || null; },
    removeChild(n) { this.children.splice(this.children.indexOf(n), 1); log.push('video source removed'); },
    play() { log.push('play()'); if (opt.play === 'throw') throw new Error('NotSupportedError'); return opt.play === 'reject' ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(); },
    pause() { log.push('pause()'); },
    load() { log.push('load()'); },
    removeAttribute(a) { log.push('removeAttribute ' + a); },
    addEventListener: add('video'),
    removeEventListener: remove('video'),
  };
  const hero = {
    getBoundingClientRect: () => rect(opt.heroRect),
    removeChild(n) { if (n === ghost) { ghost.parentNode = null; log.push('ghost removed'); } },
  };
  const ghost = {
    hidden: true,
    parentNode: hero,
    classList: { add: (c) => { classes.add(c); log.push('+' + c); }, remove: (c) => { classes.delete(c); log.push('-' + c); }, contains: (c) => classes.has(c) },
    querySelector: (s) => (s === 'video' ? video : null),
    getBoundingClientRect: () => rect(opt.ghostRect),
  };
  if (opt.animate) {
    ghost.animate = (keyframes, options) => {
      const a = { target: 'ghost', keyframes, options, cancelled: false, onfinish: null, cancel() { this.cancelled = true; log.push('flight cancelled'); }, finish() { if (this.onfinish) this.onfinish(); } };
      animations.push(a); log.push('animate ghost'); return a;
    };
  }
  const logo = { getBoundingClientRect: () => rect(opt.logoRect) };
  if (opt.animate) logo.animate = (keyframes, options) => { animations.push({ target: 'logo', keyframes, options }); log.push('animate logo'); return {}; };

  const doc = {
    readyState: opt.readyState,
    visibilityState: opt.visibility,
    documentElement: { scrollTop: opt.y, getAttribute: (k) => (k === 'data-view' ? env.view : null) },
    getElementById: (id) => (id === 'hero' ? hero : null),
    querySelector: (sel) => { log.push('qs ' + sel); return sel === '#hero .hero-ghost' ? ghost : sel === '#site-brand img' ? (opt.logo ? logo : null) : null; },
    querySelectorAll: () => [],
    addEventListener: add('document'),
    removeEventListener: remove('document'),
  };
  let observer = null;
  class FakeIO {
    constructor(cb) { this.cb = cb; observer = this; log.push('observer'); }
    observe(el) { log.push('observe ' + (el === hero ? 'hero' : el === ghost ? 'ghost' : el === video ? 'video' : '?')); }
    disconnect() { this.dead = true; log.push('disconnect'); }
  }
  const win = {
    pageYOffset: opt.y,
    innerWidth: 1440,
    matchMedia: (q) => ({ matches: !!opt.reduced && /prefers-reduced-motion: reduce/.test(q) }),
    addEventListener: add('window'),
    removeEventListener: remove('window'),
    getComputedStyle: () => ({ opacity: String(opt.opacity) }),
  };
  const sandbox = { document: doc, window: win, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout };
  if (opt.io) { win.IntersectionObserver = FakeIO; sandbox.IntersectionObserver = FakeIO; }
  if (opt.saveData !== undefined) sandbox.navigator = { connection: { saveData: opt.saveData } };

  const env = {
    view: opt.view,
    log, ghost, video, hero, logo, animations, classes, doc, win, tick, fire,
    plays: () => log.filter((l) => l === 'play()').length,
    removed: () => ghost.parentNode === null,
    // the listeners the intro registers (the other things site.js binds — resize, keydown — are not the intro's)
    listening: () => Object.values(listeners).flat().filter((l) => ['scroll', 'visibilitychange', 'playing', 'ended', 'pause', 'error'].includes(l.ev)).length,
    waitingForLoad: () => listeners.window.filter((l) => l.ev === 'load').length,
    intersect: (isIntersecting = true) => { if (observer && !observer.dead) observer.cb([{ isIntersecting: false, target: hero }, { isIntersecting, target: hero }]); },
    load: () => { doc.readyState = 'complete'; fire('window', 'load'); },
    scrollTo: (y) => { win.pageYOffset = y; doc.documentElement.scrollTop = y; fire('window', 'scroll'); },
    hide: () => { doc.visibilityState = 'hidden'; fire('document', 'visibilitychange'); },
    flush: () => new Promise((r) => setImmediate(r)),
    flights: () => animations.filter((a) => a.target === 'ghost'),
    pulses: () => animations.filter((a) => a.target === 'logo'),
  };
  vm.runInNewContext(siteJs, sandbox);
  return env;
}
