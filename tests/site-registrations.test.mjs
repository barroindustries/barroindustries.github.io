// tests/site-registrations.test.mjs — the owner's three stated facts, shown as plain TEXT badges (2026-10-21):
//
//     "Barro Industries OPC is PhilGEPS registered, SEC registered and VAT registered."
//
//   · Homepage: a slim "Registrations" row directly under the proof bar; the same three pills under "Trusted by state universities"; the footer.
//   · /catalogue/: the footer.
//   · Wording is exactly "PhilGEPS-registered", "SEC-registered", "VAT-registered" (hyphenated adjectives, as the About sentence already says
//     "SEC-registered"); the About sentence is unchanged.
//   · TEXT only: no agency logo or seal (the agencies restrict them), no <img>, no external or referenced SVG — just one generic shield-and-check
//     line-icon drawn inline — and no registration number (none was given).
//   · No overclaim: nothing is "accredited", "certified" or "licensed", and no other registration (DTI, BIR …) is named.
//   · JSON-LD is unchanged: schema.org's clean fields for this (vatID, taxID, hasCredential …) need a number or a credential record we do not have,
//     so none is added.
//
// Mutation-tested (scratch copies, never the shared tree): a fourth badge, a badge reworded ("PhilGEPS registered", "PhilGEPS-accredited"), an
// <img> or <use> in a badge, a registration number, a footer row removed, the row moved away from the proof bar, a vatID in the JSON-LD,
// the pill text made too small or too pale — each must fail here.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const home = read('index.html');
const homeSite = home.slice(home.indexOf('<div id="site"'), home.indexOf('<!-- /#site -->'));
const homeHead = home.slice(0, home.indexOf('</head>'));
const cat = read('catalogue/index.html');
const catBody = cat.slice(cat.indexOf('<body'));
const siteCss = read('css/site.css');

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const stripTags = (html) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
const visibleText = (html) => decode(stripTags(html)).replace(/\s+/g, ' ').trim();
const attrText = (html) => [...html.matchAll(/\s(?:alt|aria-label|placeholder|title)="([^"]*)"|<meta[^>]*\scontent="([^"]*)"/g)].map((m) => decode(m[1] || m[2] || '')).join(' | ');

const BADGES = ['PhilGEPS-registered', 'SEC-registered', 'VAT-registered'];
const LISTS = (html) => [...html.matchAll(/<ul class="(regs(?:\s[^"]*)?)"([^>]*)>([\s\S]*?)<\/ul>/g)].map((m) => ({ cls: m[1], attrs: m[2], inner: m[3], whole: m[0] }));
const pillsOf = (list) => [...list.inner.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const textOf = (pill) => visibleText(pill);

const homeLists = LISTS(homeSite);
const catLists = LISTS(catBody);
const homeFooter = homeSite.match(/<footer id="site-footer">[\s\S]*?<\/footer>/)[0];
const catFooter = catBody.match(/<footer id="site-footer">[\s\S]*?<\/footer>/)[0];

describe('the homepage shows the three registrations where a visitor sees them without hunting', () => {
  it('has exactly three lists of badges: under the proof bar, under "Trusted by state universities", and in the footer — in that page order', () => {
    assert.deepEqual(homeLists.map((l) => l.cls), ['regs', 'regs regs-trust reveal', 'regs regs-foot']);
    const at = (needle) => homeSite.indexOf(needle);
    assert.ok(at('class="proof-bar"') < at('class="regs-row"') && at('class="regs-row"') < at('id="services"'), 'the row is not between the proof bar and the first section');
    assert.ok(at('class="trust reveal"') < at('class="regs regs-trust reveal"') && at('class="regs regs-trust reveal"') < at('id="proj-ispsc-2026"'));
    assert.ok(at('<footer id="site-footer">') < at('class="regs regs-foot"'));
  });

  it('puts the "Registrations" row directly under the proof bar card: a visible label, then the pills, in the same wrapper (above the first section)', () => {
    const proof = homeSite.match(/<div class="proof">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)[0];
    assert.match(proof, /<\/ul>\s*<div class="regs-row">\s*<p class="regs-label" id="regs-h">Registrations<\/p>\s*<ul class="regs" aria-labelledby="regs-h">/);
    assert.ok(proof.indexOf('class="proof-bar"') < proof.indexOf('class="regs-row"'));
    assert.equal((homeSite.match(/id="regs-h"/g) || []).length, 1, 'the label id must be unique');
    assert.equal(visibleText(homeLists[0].whole), BADGES.join(' '));
  });

  it('keeps the proof bar to its four facts and the "Trusted by" line exactly as the owner worded it (the badges sit beside them, not inside)', () => {
    const items = [...homeSite.match(/<ul class="proof-bar"[\s\S]*?<\/ul>/)[0].matchAll(/<li>([\s\S]*?)<\/li>/g)];
    assert.equal(items.length, 4);
    const trust = homeSite.match(/<p class="trust[^"]*">[\s\S]*?<\/p>/)[0];
    assert.equal(visibleText(trust), 'Trusted by state universities: Don Mariano Marcos Memorial State University (DMMMSU) · Ilocos Sur Polytechnic State College (ISPSC)');
    assert.ok(!/<(svg|img|ul|li)\b/.test(trust));
  });

  it('has the badges in the footer, under the address, in the brand block', () => {
    assert.match(homeFooter, /<div class="foot-brand">\s*<p class="foot-name">Barro Industries OPC<\/p>\s*<p>21 Capricorn St\.[^<]*<\/p>\s*<ul class="regs regs-foot" aria-label="Registrations">/);
    assert.equal(visibleText(homeLists[2].whole), BADGES.join(' '));
  });

  it('keeps the About sentence exactly as it was', () => {
    const about = visibleText(homeSite.match(/<section id="about"[\s\S]*?<\/section>/)[0]);
    assert.ok(about.includes('Barro Industries OPC is an SEC-registered manufacturing company built on precision, quality and a commitment to long-term growth.'));
  });
});

describe('the /catalogue/ footer carries the same three badges — and only the footer does', () => {
  it('has one list, in the footer\'s brand block, identical to the homepage footer\'s', () => {
    assert.equal(catLists.length, 1);
    assert.equal(catLists[0].cls, 'regs regs-foot');
    assert.match(catFooter, /<div class="foot-brand">\s*<p class="foot-name">Barro Industries OPC<\/p>\s*<p>21 Capricorn St\.[^<]*<\/p>\s*<ul class="regs regs-foot" aria-label="Registrations">/);
    assert.equal(catLists[0].whole, homeLists[2].whole, 'the two footers differ');
    assert.equal(visibleText(catLists[0].whole), BADGES.join(' '));
  });

  it('is inside the hand-written page, outside the generated product block (the build can never overwrite it)', () => {
    const START = '<!-- CATALOGUE:START generated by scripts/build-catalogue.js — DO NOT HAND-EDIT -->', END = '<!-- CATALOGUE:END -->';
    const generated = cat.slice(cat.indexOf(START), cat.indexOf(END));
    assert.ok(!generated.includes('regs') && !generated.includes('registered'));
    assert.ok(cat.indexOf('class="regs regs-foot"') > cat.indexOf(END));
  });
});

describe('every badge reads exactly "PhilGEPS-registered", "SEC-registered" or "VAT-registered"', () => {
  const all = [...homeLists, ...catLists];

  it('has the three badges in this order in every list, each one an <li> holding the icon and the words and nothing else', () => {
    for (const l of all) {
      const pills = pillsOf(l);
      assert.deepEqual(pills.map(textOf), BADGES, l.cls);
      for (const p of pills) assert.match(p, /^<svg class="regs-ic"[^>]*><path d="[^"]+"\/><path d="[^"]+"\/><\/svg>[A-Za-z-]+$/, 'a pill holds more than the icon and its words');
    }
  });

  it('uses the hyphenated form everywhere: no "PhilGEPS registered", no "SEC registered", no "VAT registered" (the About sentence is the model)', () => {
    for (const [label, html] of [['homepage', homeSite], ['catalogue page', catBody]]) {
      const t = visibleText(html);
      assert.ok(!/\b(PhilGEPS|SEC|VAT)[ -]?registration\b/i.test(t), `${label}: a noun form`);
      assert.ok(!/\b(PhilGEPS|VAT) registered\b|\bSEC registered\b/.test(t), `${label}: an unhyphenated form`);
    }
    assert.equal((visibleText(homeSite).match(/PhilGEPS-registered/g) || []).length, 3);
    assert.equal((visibleText(homeSite).match(/VAT-registered/g) || []).length, 3);
    assert.equal((visibleText(homeSite).match(/SEC-registered/g) || []).length, 4, 'three badges plus the About sentence');
    assert.equal((visibleText(catBody).match(/(?:PhilGEPS|SEC|VAT)-registered/g) || []).length, 3);
  });

  it('gives every list an accessible name (the visible "Registrations" label, or aria-label="Registrations")', () => {
    for (const l of all) assert.ok(/aria-labelledby="regs-h"|aria-label="Registrations"/.test(l.attrs), l.cls);
    assert.ok(homeSite.includes('<p class="regs-label" id="regs-h">Registrations</p>'));
  });
});

describe('TEXT badges only: no agency logo or seal, no image, no external or referenced SVG, no registration number', () => {
  const surfaces = { 'homepage': homeLists, 'catalogue page': catLists };

  it('holds no <img>, <picture>, <image>, <use>, <object>, <embed>, <iframe>, link or background image — only one inline, decorative shield-and-check', () => {
    for (const [label, lists] of Object.entries(surfaces)) {
      for (const l of lists) {
        assert.ok(!/<(img|picture|image|use|object|embed|iframe|a|source|link)\b/i.test(l.whole), `${label}: ${l.cls} holds a media or link element`);
        assert.ok(!/(href|src|srcset|xlink:href|data)=|url\(|https?:|\.svg|\.png|\.webp|\.jpe?g/i.test(l.whole), `${label}: ${l.cls} references a file or URL`);
        assert.ok(!/\sstyle=|\son[a-z]+=/i.test(l.whole));
        const svgs = l.whole.match(/<svg\b[^>]*>/g) || [];
        assert.equal(svgs.length, 3, 'one icon per badge');
        for (const s of svgs) assert.ok(/aria-hidden="true"/.test(s) && /stroke="currentColor"/.test(s) && /fill="none"/.test(s), `${label}: the icon is not a decorative stroke icon`);
      }
    }
  });

  it('draws the SAME generic icon on every badge (a shield with a check mark — an emblem of "registered", not any agency\'s mark)', () => {
    const icons = new Set([...homeLists, ...catLists].flatMap((l) => l.whole.match(/<svg[\s\S]*?<\/svg>/g)));
    assert.equal(icons.size, 1, 'the badges use different icons');
    const [icon] = [...icons];
    assert.equal((icon.match(/<path /g) || []).length, 2);
    assert.ok(/viewBox="0 0 24 24"/.test(icon) && /width="16" height="16"/.test(icon));
    assert.ok(!/<(circle|rect|text|g|image|use|polygon)\b/i.test(icon), 'a shape other than the two paths');
  });

  it('adds no image or file to the page for the registrations: the images of the homepage are still the project photos and the brand mark only', () => {
    const imgs = [...homeSite.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]).filter((t) => /\ssrc="/.test(t));
    assert.ok(imgs.length > 10);
    for (const t of imgs) assert.ok(/site\/img\/(projects|barro-kitchens-96)/.test(t) && !/\b(sec|dti|philgeps|bir|vat|seal|badge|logo|certificate|accreditation)\b/i.test(t.replace(/srcset="[^"]*"/, '').replace(/alt="[^"]*Barro Kitchens logo[^"]*"/, '')), t.slice(0, 80));
    const catImgs = [...catBody.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    for (const t of catImgs) assert.ok(!/\b(sec|dti|philgeps|bir|vat|seal|badge|certificate|accreditation)\b/i.test(t.replace(/srcset="[^"]*"/, '')), t.slice(0, 80));
    const dirs = fs.readdirSync(path.join(ROOT, 'site/img'));
    assert.ok(!dirs.some((n) => /sec|dti|philgeps|bir|vat|seal|logo-gov|badge/i.test(n)), 'an agency folder exists under site/img');
  });

  it('shows no registration number: the badge rows hold no digit, and no "No." / "Reg." / TIN / number pattern sits near a registration anywhere on the public pages', () => {
    for (const l of [...homeLists, ...catLists]) assert.ok(!/\d/.test(visibleText(l.whole)), `${l.cls}: a digit in the badge text`);
    const copy = `${visibleText(homeSite)} | ${attrText(homeSite)} | ${visibleText(catBody)} | ${attrText(catBody)} | ${attrText(homeHead)}`;
    assert.ok(!/\b(TIN|PhilGEPS|SEC|VAT|DTI|BIR)\b[^|]{0,24}(?:no\.?|number|reg\.? ?no|#|id)\b\s*[:.]?\s*\d/i.test(copy), 'a registration number is shown');
    assert.ok(!/\b(?:SEC|VAT|TIN|PhilGEPS)[ -]?(?:Reg(?:istration)?\.? ?)?(?:No\.?|Number|#)\s*[:.]?\s*[\dA-Z-]{5,}/i.test(copy));
    assert.ok(!/\b\d{3}-\d{3}-\d{3}(?:-\d{3,5})?\b/.test(copy), 'a TIN-shaped number is on the page');
  });
});

describe('no overclaim: registered is all the owner said', () => {
  const copy = (html) => `${visibleText(html)} | ${attrText(html)}`;

  it('never says "accredited", "certified" or "licensed" (nor accreditation / certification / licence / licence / authorised / approved by) on either public page or in their head tags', () => {
    const BAD = /\b(accredit\w*|certif\w*|licen[cs]\w*|authori[sz]ed|approved by|endorse\w*|recogni[sz]ed by|government[- ]approved|official(?:ly)?)\b/i;
    for (const [label, text] of [['homepage', copy(homeSite)], ['homepage head', attrText(homeHead)], ['catalogue page', copy(catBody)], ['catalogue head', attrText(cat.slice(0, cat.indexOf('</head>')))]]) {
      assert.ok(!BAD.test(text), `${label}: "${(text.match(BAD) || [])[0]}"`);
    }
    for (const l of [...homeLists, ...catLists]) assert.ok(!BAD.test(visibleText(l.whole)));
  });

  it('names no registration the owner did not state: no DTI, BIR, SEC accreditation, "PhilGEPS Platinum", ISO, "BIR-registered", "DTI-registered"', () => {
    for (const text of [visibleText(homeSite), visibleText(catBody)]) {
      assert.ok(!/\b(DTI|BIR|CIDG|PCAB|PEZA|BOI|Platinum)\b/.test(text), 'another registration is named');
      assert.ok(!/\bISO ?\d{3,}/i.test(text));
      assert.ok(!/\b(?!PhilGEPS|SEC|VAT)[A-Za-z]+-registered\b/.test(text), 'another "-registered" claim');
    }
    assert.ok(!/\bPhilGEPS\b(?!-registered)/.test(visibleText(homeSite)) && !/\bPhilGEPS\b(?!-registered)/.test(visibleText(catBody)));
  });
});

describe('JSON-LD is unchanged: no registration fields (schema.org\'s vatID / taxID / hasCredential need a number or a credential record we do not have)', () => {
  const ld = JSON.parse(homeHead.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

  it('keeps exactly the keys it had, and none that claims or numbers a registration', () => {
    assert.deepEqual(Object.keys(ld), ['@context', '@type', '@id', 'name', 'legalName', 'alternateName', 'url', 'logo', 'image', 'telephone', 'email', 'address', 'founder', 'brand', 'sameAs', 'knowsAbout', 'openingHoursSpecification', 'geo', 'hasMap', 'areaServed']);
    assert.equal(ld['@id'], 'https://barroindustries.com/#business', 'the content pages\' Service.provider references resolve to this id');
    for (const k of ['vatID', 'taxID', 'hasCredential', 'award', 'memberOf', 'iso6523Code', 'leiCode', 'duns', 'naics', 'isicV4', 'globalLocationNumber', 'hasOfferCatalog', 'slogan']) assert.ok(!(k in ld), `${k} was added to the JSON-LD`);
    assert.ok(!/registered|PhilGEPS|accredit|certif|licen/i.test(JSON.stringify(ld)));
  });
});

describe('the badges are premium, legible and wrap on a phone (css/site.css)', () => {
  const rule = (sel) => { const m = siteCss.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`)); assert.ok(m, `no rule for ${sel}`); return m[1]; };
  const lum = (hex) => { const c = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

  it('draws each badge as a white pill with a thin gold hairline, navy 12.5px+ semibold text and a gold-ink icon, all passing AA / AAA contrast', () => {
    const li = rule('#site .regs li');
    assert.match(li, /border:1px solid var\(--site-line-gold\)/);
    assert.match(li, /border-radius:999px/);
    assert.match(li, /background:#fff/);
    assert.match(li, /color:var\(--site-navy\)/);
    assert.match(li, /font:600 13px\//);
    assert.ok(contrast('#0B1B3F', '#FFFFFF') >= 7, 'badge text');
    assert.ok(contrast('#85690F', '#FFFFFF') >= 4.5 && contrast('#85690F', '#FAF8F4') >= 4.5, 'icon');
    assert.match(rule('#site .regs-ic'), /color:var\(--site-gold-ink\)/);
    assert.match(rule('#site .regs-foot li'), /font-size:12\.5px/);
    assert.match(rule('#site .regs-label'), /letter-spacing:\.18em;text-transform:uppercase/);
  });

  it('wraps the pills onto more lines on a narrow screen instead of scrolling sideways, and aligns the row with the proof bar text on wide ones', () => {
    assert.match(rule('#site .regs'), /display:flex;flex-wrap:wrap/);
    assert.match(rule('#site .regs-row'), /display:flex;flex-wrap:wrap/);
    assert.match(siteCss, /@media \(min-width:1024px\)\{[^@]*#site \.regs-row\{padding-left:22px\}/);
    assert.match(siteCss, /@media \(min-width:1280px\)\{[^@]*#site \.regs-row\{padding-left:28px\}/);
    // the widest pill (about 190px) fits the narrowest phone content width (320 - 32)
    assert.ok(!/#site \.regs[^{]*\{[^}]*(?:width|min-width):\s*\d{3,}px/.test(siteCss));
  });

  it('is shared by both pages through css/site.css (the catalogue page loads it), scoped under #site like every other public rule, and adds no 4-digit z-index', () => {
    assert.ok(cat.includes('<!-- PAGE-CSS:START css/site.css css/catalogue.css css/quote-request.css ') && cat.includes(siteCss.replace(/\s+$/, '')), 'the catalogue inlines css/site.css');
    for (const m of siteCss.matchAll(/(^|\})\s*(#site \.regs[^{]*)\{/g)) assert.ok(m[2].startsWith('#site '), m[2]);
    assert.ok(!/z-index:\s*\d{4}/.test(siteCss));
  });
});
