'use strict';
// scripts/check-catalogue-cards.js — ci-invariants CHECK 9 helper (owner ruling 2026-11-19): every catalogue card is plain text (no image, figure or tile) and carries
// EXACTLY ONE price line, which is the generator's exact form and agrees with scripts/public-from-prices.json. Prints one problem per line (never an amount); no output = pass.
const fs = require('fs');
const out = [];
try {
  const page = fs.readFileSync('catalogue/index.html', 'utf8');
  const a = page.indexOf('<!-- CATALOGUE:START'), b = page.indexOf('<!-- CATALOGUE:END -->');
  const block = page.slice(a, b);
  if (/<img\b|<figure\b|class="cat-(photo|tile)"/.test(block)) out.push('the catalogue block carries an image, figure or tile: cards are plain text');
  const prices = JSON.parse(fs.readFileSync('scripts/public-from-prices.json', 'utf8')).prices;
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
    const want = e.perProject ? '<p class="cat-from cat-from-ask">Priced per project</p>'
      : '<p class="cat-from">From <data value="' + e.from + '">\u20B1' + String(e.from).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '</data> <span class="cat-vat">+ VAT</span></p>';
    if (!c.includes(want)) out.push(key + ': its price line is not the one in scripts/public-from-prices.json');
  });
  Object.keys(prices).forEach(k => { if (!seen.has(k)) out.push(k + ': in scripts/public-from-prices.json but not a card of the page'); });
} catch (e) { out.push('catalogue card check error: ' + e.message); }
out.forEach(x => console.log(x));
