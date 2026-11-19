'use strict';
// scripts/check-catalogue-cards.js — ci-invariants CHECK 9 helper (owner ruling 2026-11-19): every catalogue card is text plus at most its captioned product photo (no drawing or tile) and carries
// EXACTLY ONE price line, which is the generator's exact form and agrees with scripts/public-from-prices.json. Prints one problem per line (never an amount); no output = pass.
// Since owner ruling 2026-11-19 (later) it also pins /products/ and its eleven product pages to the catalogue: each page carries ONE starting-price line and each hub card ONE, every one
// equal to scripts/public-from-prices.json (so equal to the catalogue card); the hub lists the eleven in the catalogue's order, tagged with the catalogue's own group heading.
// Usage: node scripts/check-catalogue-cards.js [repo root]   (default: the current directory; the tests run it on a scratch copy to prove it fails).
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || '.';
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const out = [];
const FAMILY_PAGE = { prep_table: 'stainless-steel-work-tables', sink: 'stainless-steel-sinks', dish_table: 'stainless-steel-dish-tables', hood: 'stainless-steel-range-hoods', stove: 'commercial-gas-stoves', wok_range: 'commercial-wok-ranges',
  cooking_line: 'commercial-griddles-grillers-and-fryers', cabinet: 'stainless-steel-cabinets', wall_shelf: 'stainless-steel-shelving', rack: 'stainless-steel-racks' };
const wantLine = (e) => e.perProject ? '<p class="cat-from cat-from-ask">Priced per project</p>'
  : '<p class="cat-from">From <data value="' + e.from + '">\u20B1' + String(e.from).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '</data> <span class="cat-vat">+ VAT</span></p>';
try {
  const page = rd('catalogue/index.html');
  const a = page.indexOf('<!-- CATALOGUE:START'), b = page.indexOf('<!-- CATALOGUE:END -->');
  const block = page.slice(a, b);
  // the product photo is back (owner 2026-11-19 later): only the exact captioned figure, first in its card; never a tile or a drawing
  const bare = block.replace(/<figure class="cat-photo"><img src="\/site\/img\/products\/[a-z0-9-]+-thumb\.webp" [^>]*><figcaption>Representative image<\/figcaption><\/figure>/g, '');
  if (/<img\b|<figure\b|class="cat-(photo|tile)"/.test(bare)) out.push('the catalogue block carries an image, figure or tile other than the captioned product photo');
  const prices = JSON.parse(rd('scripts/public-from-prices.json')).prices;
  const cards = block.split('<li class="cat-card').slice(1);
  const seen = new Set();
  cards.forEach((c, i) => {
    const key = (c.match(/data-(?:family|id|ask)="([^"]+)"/) || [])[1];
    const lines = c.match(/<p class="cat-from[ "][^>]*>/g) || [];
    if (!key) { out.push('card #' + (i + 1) + ' has no data-family / data-id / data-ask'); return; }
    seen.add(key);
    if (lines.length !== 1) { out.push(key + ': ' + lines.length + ' price lines (exactly one is required)'); return; }
    const e = prices[key];
    if (!e) { out.push(key + ': no entry in scripts/public-from-prices.json'); return; }
    const want = wantLine(e);
    if (!c.includes(want)) out.push(key + ': its price line is not the one in scripts/public-from-prices.json');
  });
  Object.keys(prices).forEach(k => { if (!seen.has(k)) out.push(k + ': in scripts/public-from-prices.json but not a card of the page'); });

  // ── the eleven product pages (/products/<name>/): the same starting price as the catalogue card ──
  // (the /products/ hub is retired, owner ruling 2026-11-19: it is a noindex forward to /catalogue/ and carries no price line at all)
  const famOrder = [];
  for (const m of block.matchAll(/<li class="cat-card cat-card-family[^"]*" data-family="([a-z_]+)"/g)) famOrder.push(m[1]);
  if (famOrder.length !== 10 || famOrder.some(f => !FAMILY_PAGE[f] || f === 'deck_oven')) out.push('the catalogue does not show the ten product families (the gas deck oven has no card: owner 2026-11-19)');
  // the gas deck oven has no catalogue card and its old page is a forward (it carries no price line): see the check on it below
  for (const fam of famOrder) {
    const slug = FAMILY_PAGE[fam], e = prices[fam];
    if (!e) { out.push(fam + ': no entry in scripts/public-from-prices.json'); continue; }
    const want = wantLine(e);
    let pg = '';
    try { pg = rd('products/' + slug + '/index.html'); } catch (_) { out.push('products/' + slug + '/index.html is missing'); continue; }
    const pgLines = pg.match(/<p class="cat-from[ "][^>]*>/g) || [];
    if (pgLines.length !== 1 || !pg.includes(want)) out.push('products/' + slug + '/index.html: its price line is not the catalogue card\'s (' + pgLines.length + ' price line(s))');
  }
  // the four later product pages (2026-11-20): each carries ONE starting-price line equal to its catalogue card's (the hood page shares the range hood card's price)
  const LATER = { 'pugon-pandesal-oven': 'pugon', 'teppanyaki-grill': 'teppanyaki', 'inasal-charcoal-grill': 'inasal', 'rear-pitch-range-hood': 'hood' };
  for (const slug of Object.keys(LATER)) {
    const e = prices[LATER[slug]];
    if (!e) { out.push(LATER[slug] + ': no entry in scripts/public-from-prices.json'); continue; }
    let pg = '';
    try { pg = rd('products/' + slug + '/index.html'); } catch (_) { out.push('products/' + slug + '/index.html is missing'); continue; }
    const pgLines = pg.match(/<p class="cat-from[ "][^>]*>/g) || [];
    if (pgLines.length !== 1 || !pg.includes(wantLine(e))) out.push('products/' + slug + '/index.html: its price line is not the catalogue card\'s (' + pgLines.length + ' price line(s))');
  }
  try { const ov = rd('products/gas-deck-ovens/index.html'); if (/<p class="cat-from/.test(ov) || !/<meta http-equiv="refresh" content="0; url=\/catalogue\/#cat-cooking">/.test(ov) || !/<meta name="robots" content="noindex, follow">/.test(ov)) out.push('products/gas-deck-ovens/index.html: it must be the noindex forward to /catalogue/#cat-cooking with no price line'); } catch (_) { out.push('products/gas-deck-ovens/index.html (the forward) is missing'); }
  let hubHtml = '';
  try { hubHtml = rd('products/index.html'); } catch (_) { out.push('products/index.html (the forward to the catalogue) is missing'); }
  if (hubHtml && (/<p class="cat-from/.test(hubHtml) || !/<meta http-equiv="refresh" content="0; url=\/catalogue\/">/.test(hubHtml) || !/<meta name="robots" content="noindex, follow">/.test(hubHtml))) out.push('products/index.html: it must be the noindex forward to /catalogue/ with no price line');
} catch (e) { out.push('catalogue card check error: ' + e.message); }
out.forEach(x => console.log(x));
