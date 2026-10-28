// tests/site-proof-contrast.test.mjs — the "23 years" numeral of the proof bar passes WCAG AA at ANY size (2026-10-28).
//
// WHY. Lighthouse accessibility was 96 (not 100) on every public page that carries the proof bar except the homepage — /products/ and its eleven product pages,
// /services/ and its pages — because of ONE node, ul.proof-bar > li > span.proof-val > span.proof-num: "Element has insufficient color contrast of 4.06 (foreground
// color: #9a7a14, background color: #ffffff, font size: 14.4pt (19.2px), font weight: normal). Expected contrast ratio of 4.5:1" (Lighthouse 12.8 / axe-core 4.14, measured
// 2026-10-28; the homepage itself scored 100). #9A7A14 is --site-gold-big, the colour of the LARGE gold numerals, which only has to pass 3:1: on the homepage "23" is 24px, and
// 24px is exactly where axe stops asking for 4.5:1 — but css/pages.css gives the proof bar on the content pages 1.2rem (19.2px) on a phone and 1.02rem under 400px, so there it
// is ordinary text. The numeral now has a colour of its own, --site-gold-num, the same gold darkened just enough (4.56:1 on the white bar, axe asks for MORE than 4.5), so it passes
// at any size and on any page, and nothing depends on the large-text exemption any more.
//
// What is pinned: the colour the .proof-num rule resolves to beats 4.5:1 on the proof bar's own background (read from the stylesheet, not assumed); the bar's other two
// text colours do too; --site-gold-big keeps its own job (large numerals, 3:1) and is not what the numeral uses; and the stylesheet that really ships — the homepage's inline
// <style id="site-css"> and the product pages' inline <style id="page-css"> — carries the same rule, so a stale inline copy fails here as well as in CHECK 9 / CHECK 11.
//
// Mutation-tested in a scratch copy (never the shared tree): the numeral back on --site-gold-big (#9A7A14), --site-gold-num one step lighter, the token deleted, the bar's
// background changed to the paper tone, the muted caption colour lightened, the homepage's inline copy reverted, a product page's inline copy reverted — each must fail here.
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// WCAG 2.x relative luminance and contrast ratio — the formula axe-core uses; axe passes a text colour when the UNROUNDED ratio is greater than the expected one
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const AA_NORMAL = 4.5;      // the ratio for text below 24px (18pt), or below 18.66px (14pt) when bold
const AA_LARGE = 3;

const HEX6 = /^#[0-9A-Fa-f]{6}$/;
const norm = (hex) => (HEX6.test(hex) ? hex.toUpperCase() : null);
const expand = (hex) => (/^#[0-9A-Fa-f]{3}$/.test(hex) ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex);

// the declarations of the FIRST rule whose selector list is exactly `selector` (the stylesheets keep each rule on one line), and the custom properties of the #site block
const decls = (css, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[}\\n])\\s*' + esc + '\\s*\\{([^}]*)\\}'));
  if (!m) return null;
  const out = {};
  for (const d of m[1].split(';')) { const k = d.indexOf(':'); if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
  return out;
};
const token = (css, name) => { const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{3,6})\\b')); return m ? norm(expand(m[1])) : null; };
// the colour a rule's `color:` resolves to (a #hex, or var(--token) looked up in the same stylesheet)
const colourOf = (css, selector) => {
  const d = decls(css, selector);
  const v = d && d.color;
  if (!v) return null;
  const t = v.match(/^var\(--([a-z-]+)\)$/);
  return t ? token(css, t[1]) : norm(expand(v));
};
const proofGround = (css) => {                                  // the background the numerals sit on: the bar's own, or (declared on the li) the item's
  const bar = decls(css, '#site .proof-bar');
  return bar && bar.background ? norm(expand(bar.background)) : null;
};
const tokenName = (css, selector) => { const d = decls(css, selector); const t = d && d.color && d.color.match(/^var\(--([a-z-]+)\)$/); return t ? t[1] : null; };

const SITE_CSS = read('css/site.css');

describe('the proof bar numeral passes WCAG AA at any size: Lighthouse accessibility 96 -> 100 on every page that carries the bar', () => {
  it('colours .proof-num so that it beats 4.5:1 on the bar\'s own background (read from the stylesheet) — not only the 3:1 a large numeral needs', () => {
    const ground = proofGround(SITE_CSS);
    assert.equal(ground, '#FFFFFF', 'the proof bar is a white card (the contrast below is measured on its real background)');
    const fg = colourOf(SITE_CSS, '#site .proof-num');
    assert.ok(fg, '#site .proof-num has no colour that resolves to a hex value');
    const ratio = contrast(fg, ground);
    assert.ok(ratio > AA_NORMAL, `${fg} on ${ground} is ${ratio.toFixed(3)}:1, axe wants more than 4.5:1 for text under 24px`);
    assert.equal(decls(SITE_CSS, '#site .proof-bar li').background, undefined, 'an item paints its own background over the bar\'s');
  });

  it('does not lean on the large-text exemption: the numeral is not coloured with --site-gold-big (the large numerals\' 3:1 gold), which keeps its own job', () => {
    assert.notEqual(tokenName(SITE_CSS, '#site .proof-num'), 'site-gold-big', '.proof-num is back on the large-numeral gold');
    const big = token(SITE_CSS, 'site-gold-big');
    assert.ok(big, '--site-gold-big is missing');
    for (const ground of ['#FFFFFF', '#FAF8F4']) assert.ok(contrast(big, ground) > AA_LARGE, `--site-gold-big on ${ground}: ${contrast(big, ground).toFixed(2)}:1`);
    for (const sel of ['#site .luzon-stat-num', '#site .about-years-num']) assert.equal(tokenName(SITE_CSS, sel), 'site-gold-big', `${sel} (a very large numeral) keeps the large-numeral gold`);
    assert.ok(parseFloat((SITE_CSS.match(/#site \.luzon-stat-num\{[^}]*font:[^}]*?clamp\(([\d.]+)rem/) || [])[1]) >= 4, 'the Luzon numeral is no longer very large');
  });

  it('gives the numeral a gold of its own, close to the one it replaces (the same hue, a few percent darker), so the look of the proof bar does not change', () => {
    const num = token(SITE_CSS, 'site-gold-num'), big = token(SITE_CSS, 'site-gold-big');
    assert.ok(num && big, 'a token is missing');
    assert.notEqual(num, big);
    const hue = (hex) => { const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; return d === 0 ? 0 : 60 * (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4); };
    assert.ok(Math.abs(((hue(num) - hue(big) + 540) % 360) - 180) < 3, `the numeral gold is not the same hue (${hue(num).toFixed(1)} vs ${hue(big).toFixed(1)})`);
    assert.ok(lum(num) < lum(big) && lum(num) > lum('#85690F'), 'it is darker than the large-numeral gold and lighter than the gold ink: the least darkening that passes');
    assert.equal(tokenName(SITE_CSS, '#site .proof-num'), 'site-gold-num');
  });

  it('keeps the bar\'s other two text colours — the figure\'s navy and the caption\'s muted grey — above 4.5:1 too, so nothing in the bar relies on the exemption', () => {
    const ground = proofGround(SITE_CSS);
    for (const sel of ['#site .proof-val', '#site .proof-sub']) {
      const fg = colourOf(SITE_CSS, sel);
      assert.ok(fg, `${sel} has no resolvable colour`);
      assert.ok(contrast(fg, ground) > AA_NORMAL, `${sel}: ${fg} on ${ground} is ${contrast(fg, ground).toFixed(2)}:1`);
    }
  });
});

describe('the stylesheets that really ship carry the same numeral colour (a stale inline copy fails here, as in CHECK 9 and CHECK 11)', () => {
  const inline = (html, id) => (html.match(new RegExp(`<style id="${id}">([\\s\\S]*?)</style>`)) || [, null])[1];
  const check = (label, css) => {
    assert.ok(css, `${label}: no inline stylesheet`);
    const fg = colourOf(css, '#site .proof-num'), ground = proofGround(css);
    assert.ok(fg && ground, `${label}: the .proof-num rule or the bar's background is missing`);
    assert.ok(contrast(fg, ground) > AA_NORMAL, `${label}: the numeral is ${fg} on ${ground}, ${contrast(fg, ground).toFixed(2)}:1`);
    assert.equal(fg, colourOf(SITE_CSS, '#site .proof-num'), `${label}: the numeral colour differs from css/site.css`);
  };

  it('puts the colour on the homepage (its inline <style id="site-css">)', () => check('index.html', inline(read('index.html'), 'site-css')));

  it('puts the colour on /products/ and on each of the eleven product pages (their inline <style id="page-css">)', () => {
    const pages = ['products/index.html', ...fs.readdirSync(path.join(ROOT, 'products'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `products/${e.name}/index.html`)];
    assert.ok(pages.length >= 12, 'the hub and the eleven product pages');            // a later product page is checked too; the count itself is pinned in tests/seo-products.test.mjs
    for (const f of pages) { const html = read(f); assert.ok(html.includes('class="proof-num"'), `${f} has no proof bar`); check(f, inline(html, 'page-css')); }
  });
});
