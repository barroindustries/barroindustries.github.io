// Enquiry steps 2–3 for the Google Ads test (owner 2026-11-24: "Yes, steps 1–3"; "Yes, within 1 hour"; Call = 0920 801 8475, sales).
//   · js/site.js builds a phone contact bar (#site-cbar) inside #site on every public page: Message us (m.me) · Call (the sales line) ·
//     Get a quote (a copy of the header button), with the line "We reply within 1 hour, Mon–Sat"; never on the project-brief form;
//   · css/site.css draws it below 768px only, hides it while the catalogue's quote tray is up, and keeps the footer and the back-to-top
//     button clear of it; the inlined copies are regenerated (CHECK 9/11 compare them);
//   · the design & build, exhaust and fabrication service pages send the hero's and the closing band's "Get a quote" to the project brief and
//     offer Message us beside each (the shared header and footer stay identical on every page); the bar's Get a quote follows the hero's.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const js = read('js/site.js');
const css = read('css/site.css');

describe('phone contact bar — js/site.js', () => {
  const fn = (js.match(/function contactBar\(site\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  it('is called from init and builds the bar inside #site', () => {
    assert.ok(fn, 'contactBar not found');
    assert.match(js, /\n    contactBar\(site\);\n/);
    assert.match(fn, /site\.appendChild\(bar\)/);
    assert.match(fn, /classList\.add\('has-cbar'\)/);
  });
  it('carries Messenger, the sales line and the owner-approved reply line', () => {
    assert.match(js, /messenger: 'https:\/\/m\.me\/barrokitchens'/);
    assert.match(js, /tel: 'tel:\+639208018475'/);
    assert.match(js, /note: 'We reply within 1 hour, Mon–Sat'/);
    assert.match(fn, /btn\('Message us', CBAR\.messenger/);
    assert.match(fn, /btn\('Call', CBAR\.tel/);
    assert.match(fn, /btn\('Get a quote', \(head && head\.getAttribute\('href'\)\)/);
    assert.match(fn, /d\.querySelector\('#site \.pg-hero-cta a\.site-btn-primary'\) \|\| d\.querySelector\('#site-header \.site-head-cta'\)/);
  });
  it('is not drawn on the project-brief form and writes no HTML strings', () => {
    assert.match(fn, /\\\/sales\\\/clientinformationrequest/);
    assert.ok(!/innerHTML|insertAdjacentHTML|\.style\./.test(fn));
  });
});

describe('phone contact bar — css/site.css', () => {
  const block = (css.match(/#site-cbar\{display:none\}\n@media \(max-width:767px\)\{[\s\S]*?\n\}\n/) || [''])[0];
  it('shows only below 768px and is hidden by default', () => {
    assert.ok(block, 'phone-only block not found');
    assert.match(block, /html\.has-cbar #site-cbar\{position:fixed;left:0;right:0;bottom:0;z-index:3;display:block/);
  });
  it('steps aside for the quote tray and keeps the footer and back-to-top button clear', () => {
    assert.match(block, /html\.has-cbar\.qr-has-tray #site-cbar\{display:none\}/);
    assert.match(block, /html\.has-cbar #site-footer\{padding-bottom:/);
    assert.match(block, /html\.has-cbar #site \.cat-top\{bottom:/);
  });
  it('the homepage and the public pages carry the current site.css', () => {
    const rule = 'html.has-cbar.qr-has-tray #site-cbar{display:none}';
    for (const f of ['index.html', 'services/commercial-kitchen-fit-out/index.html', 'catalogue/index.html', 'guides/index.html']) assert.ok(read(f).includes(rule), f);
  });
});

describe('service pages: Get a quote → project brief, Message us beside it', () => {
  for (const p of ['commercial-kitchen-fit-out', 'exhaust-and-fresh-air-systems', 'stainless-steel-fabrication']) {
    const html = read(`services/${p}/index.html`);
    it(`${p}: the hero and closing "Get a quote" go to the brief (the shared header and footer are unchanged)`, () => {
      assert.match(html, /site-head-cta" href="\/catalogue\/\?quote=1">Get a quote</);
      assert.match(html, /<p class="pg-hero-cta"><a class="site-btn site-btn-primary" href="\/sales\/clientinformationrequest\/">Get a quote<\/a><a class="site-btn site-btn-outline" href="https:\/\/m\.me\/barrokitchens" rel="noopener" target="_blank" data-brand>/);
      assert.match(html, /<div class="pg-cta-actions">\s*<a class="site-btn site-btn-primary" href="\/sales\/clientinformationrequest\/">Get a quote<\/a>\s*<a class="site-btn site-btn-outline" href="https:\/\/m\.me\/barrokitchens"/);
    });
  }
});

describe('design & build landing page (owner 2026-11-24, step 4: the design & build ad lands here)', () => {
  const html = read('services/commercial-kitchen-fit-out/index.html');
  const order = ['class="pg-hero"', 'id="site-visit"', 'id="projects"', 'id="included"'].map((k) => html.indexOf(k));
  it('puts the site-visit offer and the project photographs straight after the hero, before what a fit-out includes', () => {
    assert.ok(order.every((i) => i > 0), String(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });
  it('the site-visit band books through the project brief, offers Messenger and the sales line, and promises only what the owner approved', () => {
    const band = (html.match(/<section class="pg-cta" id="site-visit"[\s\S]*?<\/section>/) || [''])[0];
    assert.match(band, /<h2 id="visit-h">Book a site visit<\/h2>/);
    assert.match(band, /href="\/sales\/clientinformationrequest\/">Book a site visit<\/a>/);
    assert.match(band, /href="https:\/\/m\.me\/barrokitchens" rel="noopener" target="_blank" data-brand>/);
    assert.match(band, /We reply within 1 hour, Mon–Sat\./);
    assert.match(band, /href="tel:\+639208018475">0920 801 8475<\/a>/);
    assert.ok(!/free|guarantee|best|leading|premium/i.test(band.replace(/<[^>]+>/g, ' ')), 'no unapproved promise or hype word');
  });
  it('keeps one projects section and one closing call to action', () => {
    assert.equal((html.match(/<section id="projects"/g) || []).length, 1);
    assert.equal((html.match(/id="get-a-quote"/g) || []).length, 1);
  });
});

describe('trust line (owner 2026-11-24, step 5): the three approved proof points under the main buttons', () => {
  const TRUST = '<ul class="trust-line" aria-label="Why Barro Kitchens"><li>12-month warranty on workmanship</li><li>Built by our own team</li><li>Serving Luzon</li></ul>';
  for (const p of ['commercial-kitchen-fit-out', 'exhaust-and-fresh-air-systems', 'stainless-steel-fabrication']) {
    it(`${p}: right under the hero buttons`, () => {
      const html = read(`services/${p}/index.html`);
      assert.ok(/<p class="pg-hero-cta">[^\n]*<\/p>\n      <ul class="trust-line"/.test(html));
      assert.equal(html.split(TRUST).length - 1, 1);
    });
  }
  it('the catalogue: under the opening sentence, in the page AND in its generator (scripts/build-catalogue.js)', () => {
    const html = read('catalogue/index.html');
    assert.ok(html.includes('the size and options you choose.</p>\n' + TRUST + '\n'));
    assert.ok(read('scripts/build-catalogue.js').includes("lines.push('" + TRUST + "');"));
  });
  it('says only what the owner approved: 12 months (never 6), no price, no hype', () => {
    assert.ok(!/6-month|six-month|premium|best|leading|free|₱/i.test(TRUST));
    assert.match(css, /#site \.trust-line\{display:flex;flex-wrap:wrap;/);
  });
});
