// Owner ruling 2026-11-24: hood filters are washed DAILY on a line that grills, woks or
// fries, and AT LEAST WEEKLY on lighter cooking (ASHRAE 2019 ch. 34: "Hood filters should
// be cleaned at least daily"). No guide may tell a busy line to wash filters weekly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const text = (p) => readFileSync(p, 'utf8')
  .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const RULE = /daily on a line that (grills, woks or (deep )?fries|fries, grills or uses a wok), and at least weekly on lighter cooking/;

test('the four filter guides state the daily-on-busy-lines rule', () => {
  for (const g of ['kitchen-exhaust-cleaning-schedule', 'commercial-kitchen-exhaust-hood-guide', 'baffle-filter-vs-mesh-filter']) {
    assert.match(text(`guides/${g}/index.html`), RULE, g);
  }
  const fryer = text('guides/commercial-deep-fryer-guide/index.html');
  assert.match(fryer, /End of each day [^.]*wash the baffle filters/, 'fryer: filters washed at the end of each day');
  const sched = readFileSync('guides/kitchen-exhaust-cleaning-schedule/index.html', 'utf8');
  assert.match(sched, /<th scope="row">Baffle filters<\/th><td data-label="Heavy cooking">Daily<\/td>/);
});

test('no guide tells a kitchen to wash filters weekly as the default, or every few days on a heavy line', () => {
  const bad = [
    /Wash weekly, or more often/i,
    /daily to every few days/i,
    /Many kitchens wash them weekly/i,
    /Every week Wash the baffle filters/i,
    /Wash the baffle filters ,? or more often on a heavy line/i,
  ];
  for (const slug of readdirSync('guides')) {
    const p = `guides/${slug}/index.html`;
    if (!existsSync(p)) continue;
    const t = text(p);
    for (const re of bad) assert.ok(!re.test(t), `${slug}: ${re}`);
  }
});

test('the hood guide cites ASHRAE for the filter rule, in the text, the references and the JSON-LD', () => {
  const h = readFileSync('guides/commercial-kitchen-exhaust-hood-guide/index.html', 'utf8');
  assert.match(h, /lighter cooking \(American Society of Heating, Refrigerating and Air-Conditioning Engineers \[ASHRAE\], 2019\)/);
  assert.match(h, /<li>American Society of Heating, Refrigerating and Air-Conditioning Engineers\. \(2019\)\. Kitchen ventilation\./);
  assert.match(h, /"name": "American Society of Heating, Refrigerating and Air-Conditioning Engineers"/);
});
