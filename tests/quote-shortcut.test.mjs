// Enquiry fixes (owner 2026-11-24, "Yes, start them"):
//   · /quote/ — a typed shortcut that used to 404 — forwards to the quote form (/catalogue/?quote=1), noindex, canonical to /catalogue/,
//     and is kept out of the sitemap and the service worker's precache;
//   · the project brief (/sales/clientinformationrequest/) counts as an enquiry conversion: js/project-brief.js calls
//     bkConversion('quote') once, in the success path (onSent) only, and never for a ?mock=1 rehearsal.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('/quote/ shortcut', () => {
  const html = read('quote/index.html');
  it('forwards at once to the quote form on /catalogue/', () => {
    assert.match(html, /<meta http-equiv="refresh" content="0; url=\/catalogue\/\?quote=1">/);
    assert.match(html, /<a href="\/catalogue\/\?quote=1">/);
  });
  it('is noindex with a canonical to /catalogue/, and runs no script', () => {
    assert.match(html, /<meta name="robots" content="noindex,follow">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/barroindustries\.com\/catalogue\/">/);
    assert.ok(!/<script/i.test(html));
  });
  it('is not in the sitemap or the precache', () => {
    assert.ok(!/barroindustries\.com\/quote\//.test(read('sitemap.xml')));
    assert.ok(!/['"]\/?quote\/(index\.html)?['"]/.test(read('sw.js')));
  });
});

describe('project brief counts as an enquiry conversion', () => {
  const js = read('js/project-brief.js');
  const onSent = (js.match(/function onSent\(res\) \{[\s\S]*?\n  \}/) || [''])[0];
  it("calls bkConversion('quote') inside onSent, guarded, and never for a mock send", () => {
    assert.ok(onSent, 'onSent not found');
    assert.match(onSent, /if \(!MOCK\) \{ try \{ window\.bkConversion && window\.bkConversion\('quote'\); \} catch \(_\)/);
  });
  it('fires nowhere else in the file (the success path only)', () => {
    assert.equal((js.match(/bkConversion\(/g) || []).length, 1);
  });
});
