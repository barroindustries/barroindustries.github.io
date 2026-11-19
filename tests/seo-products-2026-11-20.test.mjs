// tests/seo-products-2026-11-20.test.mjs — the four product pages the owner approved on 19 Nov 2026 (SEO — Owner Answers, Q4):
//   /products/pugon-pandesal-oven/   /products/teppanyaki-grill/   /products/inasal-charcoal-grill/   /products/rear-pitch-range-hood/
// Pinned: the head (title ≤ 65 with the site suffix, description, canonical, a social image that exists), one <h1>, valid JSON-LD,
// the "From ₱X + VAT" line equal to scripts/public-from-prices.json (prices change only when the owner says so), the proof bar,
// every internal link resolves, and the owner's wording rules (no hype words, "built by our own team", no shop claim, warranty on
// workmanship, no gas deck oven offered, never the partner company).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PRICES = JSON.parse(read('scripts/public-from-prices.json'));
const flat = JSON.stringify(PRICES);

const PAGES = [
  { slug: 'pugon-pandesal-oven', price: 53000, keyword: /pugon/i },
  { slug: 'teppanyaki-grill', price: 62000, keyword: /teppanyaki grill/i },
  { slug: 'inasal-charcoal-grill', price: 50000, keyword: /inasal/i },
  { slug: 'rear-pitch-range-hood', price: 32000, keyword: /rear pitch range hood/i },
];

const resolvable = (href) => {
  const p = href.split('#')[0].split('?')[0];
  if (!p || p === '/') return true;
  const f = p.endsWith('/') ? `${p.slice(1)}index.html` : p.slice(1);
  return fs.existsSync(path.join(ROOT, f));
};

describe('the four product pages of 2026-11-20', () => {
  for (const { slug, price, keyword } of PAGES) {
    const file = `products/${slug}/index.html`;
    it(`${slug}: exists, with its head, one h1 and JSON-LD that parses`, () => {
      const html = read(file);
      const title = html.match(/<title>([^<]*)<\/title>/)[1];
      assert.ok(title.endsWith('| Barro Industries') && title.length <= 65, title);
      assert.match(title, keyword);
      assert.ok(!/Barro Kitchens/.test(title));
      assert.match(html, /<meta name="description" content="[^"]{60,170}"/);
      assert.ok(html.includes(`<link rel="canonical" href="https://barroindustries.com/products/${slug}/">`));
      const og = html.match(/<meta property="og:image" content="https:\/\/barroindustries\.com\/([^"]+)"/)[1];
      assert.ok(fs.existsSync(path.join(ROOT, og)), `${slug}: og image ${og}`);
      assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
      assert.ok(html.includes('class="proof-num"'), `${slug}: proof bar`);
    });

    it(`${slug}: the From line is the owner's price, ex-VAT`, () => {
      const html = read(file);
      assert.ok(flat.includes(String(price)), `${price} is not in scripts/public-from-prices.json`);
      const shown = `From <data value="${price}">₱${price.toLocaleString('en-PH')}</data> <span class="cat-vat">+ VAT</span>`;
      assert.ok(html.includes(shown), `${slug}: ${shown}`);
      assert.ok(html.includes('Prices depend on size and options.'));
    });

    it(`${slug}: every internal link resolves`, () => {
      const html = read(file);
      for (const m of html.matchAll(/href="(\/[^"]*)"/g)) assert.ok(resolvable(m[1]), `${slug}: ${m[1]}`);
    });

    it(`${slug}: keeps the owner's wording rules`, () => {
      const text = read(file).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
      assert.ok(!/\b(premium|world-class|high-quality|high quality|top-quality|best-in-class|finest|best|leading)\b/i.test(text), `${slug}: hype word`);
      assert.ok(!/\b(our|own) (work)?shop\b|made in our|in-house/i.test(text), `${slug}: shop claim`);
      assert.ok(!/gas deck oven/i.test(text), `${slug}: offers a gas deck oven`);
      assert.ok(!/Brilliant Steel|Brilliance Steel/i.test(text));
      assert.ok(!/service warranty on our equipment and work/.test(text));
      assert.ok(!/across the Philippines|nationwide/i.test(text));
    });
  }
});
