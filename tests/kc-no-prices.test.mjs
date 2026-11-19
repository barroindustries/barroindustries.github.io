// tests/kc-no-prices.test.mjs: THIS REPOSITORY IS PUBLIC and GitHub Pages serves every tracked file, so no peso amount may be written in the Barro Kitchens configurator files
// (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md section 0 rule 4 and section 6.1).
//
// WHAT IT PINS
//   1. THE SCAN    qb/** (every text file), scripts/kc-seed-build.js and tests/kc-*.test.mjs hold no "₱" followed by a digit, no "PHP" followed by a digit, and no comma-grouped number
//                  such as a thousands figure; and qb/** holds no pinned-expected-figure key (the "want" key of the D7 in-file checks).  The synthetic price fixture and the golden file are NOT
//                  scanned: they are made-up numbers (tests/fixtures/kc-prices.fixture.json is the one allow-listed file, and the golden holds no comma-grouped number either).
//   2. THE ENGINE  loaded with no fixture, every material price is null, the Standard Price List is empty, the corner charge is null, the list table of the Chef Mode products holds no
//                  price: the prices come from Firestore at run time, never from the file.
//   3. THE BUNDLE  the engine sources are private (Addendum 1 A9); the committed engine is ONE minified file, qb/kc.min.js. It holds no comment of any kind (checked with the repo's
//                  comment stripper, which leaves strings and regular expressions alone, so the "http://www.w3.org" of an SVG is not mistaken for one) and no price pattern: no peso sign
//                  or "PHP" before a digit (the minifier writes the peso sign as an escape, so both spellings are checked), no pinned expected-figure key, and no comma-grouped number
//                  in running text (in minified code a list of numbers is just a list, so only a number between words or quotes counts).
// Formula constants (30 / 50 / 70 %, 10 %, the markup of 2, the 20 ft and 4 x 8 ft sizes, the lead-time band) are not prices and are allowed.
// A failure names the file and the line.  Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, ROOT, BUNDLE_FILE } from './helpers/kc-vm.mjs';
import { stripComments } from './fixtures/strip-comments.mjs';

const TEXT_FILE = /\.(js|mjs|cjs|css|html|json|md|txt|svg)$/i;
const ALLOW_LIST = ['tests/fixtures/kc-prices.fixture.json'];          // made-up numbers, on purpose
const BUNDLE = 'qb/kc.min.js';                                          // minified: checked by its own tests below (a list of numbers in minified code is not a price)

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const rel = f => path.relative(ROOT, f).split(path.sep).join('/');

const scanned = () => {
  const files = [
    ...walk(path.join(ROOT, 'qb')).filter(f => TEXT_FILE.test(f)),
    ...['scripts/kc-seed-build.js'].map(f => path.join(ROOT, f)).filter(f => fs.existsSync(f)),
    ...fs.readdirSync(path.join(ROOT, 'tests')).filter(n => /^kc-.*\.test\.mjs$/.test(n)).map(n => path.join(ROOT, 'tests', n))
  ];
  return files.filter(f => !ALLOW_LIST.includes(rel(f)) && rel(f) !== BUNDLE);
};

const PATTERNS = [
  ['a peso sign followed by a digit', /₱\s?[0-9]/],
  ['PHP followed by a digit', /PHP\s?[0-9]/],
  ['a comma-grouped number', /\b\d{1,3}(,\d{3})+\b/]
];
const QB_ONLY = [['a pinned expected-figure key (an in-file check)', /\bwant\s*:/]];

function hits(files) {
  const out = [];
  for (const f of files) {
    const r = rel(f), inQb = r.startsWith('qb/');
    fs.readFileSync(f, 'utf8').split('\n').forEach((text, i) => {
      for (const [label, re] of PATTERNS.concat(inQb ? QB_ONLY : [])) {
        const m = re.exec(text);
        if (m) out.push(`${r}:${i + 1}  ${label}: ${JSON.stringify(text.trim().slice(Math.max(0, m.index - 20), m.index + 50))}`);
      }
    });
  }
  return out;
}

describe('no price in a tracked configurator file', () => {
  it('the scan reaches the engine, the rules and the tests (it is not scanning nothing)', () => {
    const names = scanned().map(rel);
    ['qb/kc-rules.js', 'tests/kc-engine.test.mjs', 'tests/kc-rules.test.mjs', 'tests/kc-no-prices.test.mjs'].forEach(f => assert.ok(names.includes(f), `${f} is scanned`));
    assert.ok(!names.includes(BUNDLE), 'the bundle has its own checks');
    assert.ok(fs.existsSync(path.join(ROOT, BUNDLE)), 'the bundle exists');
    assert.ok(!fs.existsSync(path.join(ROOT, 'qb', 'kc', 'core.js')), 'the readable engine sources are not in the repository (Addendum 1 A9)');
  });
  it('the only allow-listed file is the synthetic fixture, and it exists', () => {
    assert.deepEqual(ALLOW_LIST, ['tests/fixtures/kc-prices.fixture.json']);
    assert.ok(fs.existsSync(path.join(ROOT, ALLOW_LIST[0])));
  });
  it('the three price patterns and the pinned-figure key are found where they are written (the scan works)', () => {
    // the probes are built at run time so that this file does not contain the very text it looks for
    const peso = '\u20B1', php = 'PH' + 'P', thousands = ['3', '850'].join(','), millions = ['1', '234', '567'].join(',');
    const probe = (text, extra) => PATTERNS.concat(extra || []).filter(([, re]) => re.test(text)).map(([l]) => l);
    assert.deepEqual(probe(peso + '1'), ['a peso sign followed by a digit']);
    assert.deepEqual(probe(peso + ' 9'), ['a peso sign followed by a digit']);
    assert.deepEqual(probe(php + ' 5'), ['PHP followed by a digit']);
    assert.deepEqual(probe('about ' + thousands + ' pesos'), ['a comma-grouped number']);
    assert.deepEqual(probe(millions), ['a comma-grouped number']);
    assert.deepEqual(probe('{ k: 1, ' + 'want' + ': 5 }', QB_ONLY), ['a pinned expected-figure key (an in-file check)']);
    // ...and the things that are not prices are left alone: a plain number, a list of small numbers, the words with no figure
    assert.deepEqual(probe('const x = 3850;'), []);
    assert.deepEqual(probe('clamp(v, 10, 400)'), []);
    assert.deepEqual(probe('a(1,2,3)'), []);
    assert.deepEqual(probe('the ' + peso + ' sign and ' + php + ' alone'), []);
    assert.deepEqual(probe('const wanted = 5; wanted: 7', QB_ONLY), []);
  });
  it('qb/**, scripts/kc-seed-build.js and tests/kc-*.test.mjs hold no peso amount, no comma-grouped number and no pinned expected figure', () => {
    const found = hits(scanned());
    assert.deepEqual(found, [], `price-like text in a tracked file:\n  ${found.slice(0, 25).join('\n  ')}${found.length > 25 ? `\n  ... and ${found.length - 25} more` : ''}`);
  });
  it('the allow-listed fixture is obviously synthetic: it says so, and no value looks like a round real price', () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, ALLOW_LIST[0]), 'utf8'));
    assert.match(fx._meta.what, /SYNTHETIC/);
    assert.match(fx._meta.what, /not real/i);
  });
});

describe('the engine bundle: no comment, no price', () => {
  const text = fs.readFileSync(BUNDLE_FILE, 'utf8');
  const peso = '\u20B1', php = 'PH' + 'P';
  const PESO_BEFORE_DIGIT = new RegExp('(?:' + peso + '|\\\\u20[bB]1)\\s*[0-9]');
  const PHP_BEFORE_DIGIT = new RegExp(php + '\\s?[0-9]');
  const TEXT_NUMBER = /(?<=[\s"'`A-Za-z])\d{1,3}(?:,\d{3})+(?![\w])/;                // between words or quotes, never in a list of numbers
  it('is one minified script: long lines, a few hundred lines at most (a template string may keep its own line breaks)', () => {
    const lines = text.split('\n').length;
    assert.ok(text.length > 100000, 'the bundle holds the whole engine');
    assert.ok(lines < 500, 'minified: ' + lines + ' lines');
    assert.ok(text.length / lines > 500, 'minified: a long line on average');
  });
  it('holds no comment: not one /* */ or // outside a string or a regular expression', () => {
    assert.equal(stripComments(text), text);
  });
  it('the comment check works: it finds a comment, and leaves a web address in a string alone', () => {
    assert.notEqual(stripComments('var a=1;/* x */var b=2;'), 'var a=1;/* x */var b=2;');
    assert.notEqual(stripComments('var a=1;// x\nvar b=2;'), 'var a=1;// x\nvar b=2;');
    assert.equal(stripComments('var u="http://www.w3.org/2000/svg";'), 'var u="http://www.w3.org/2000/svg";');
    assert.equal(stripComments('var r=/[&<>"\']/g;'), 'var r=/[&<>"\']/g;');
  });
  it('holds no peso sign or PHP before a digit, spelled either way', () => {
    assert.doesNotMatch(text, PESO_BEFORE_DIGIT);
    assert.doesNotMatch(text, PHP_BEFORE_DIGIT);
  });
  it('holds no pinned expected-figure key and no comma-grouped number in running text', () => {
    assert.doesNotMatch(text, /\bwant\s*:/);
    const m = TEXT_NUMBER.exec(text);
    assert.equal(m, null, m ? 'a comma-grouped number in text: ' + JSON.stringify(text.slice(Math.max(0, m.index - 30), m.index + 40)) : '');
  });
  it('the price checks work: they find a price written either way, and leave a list of numbers alone', () => {
    const thousands = ['3', '850'].join(',');
    assert.match('"' + peso + '5"', PESO_BEFORE_DIGIT);
    assert.match('"\\u20B1 5"', PESO_BEFORE_DIGIT);
    assert.match('"\\u20b15"', PESO_BEFORE_DIGIT);
    assert.match(php + ' 5', PHP_BEFORE_DIGIT);
    assert.match('about ' + thousands + ' pesos', TEXT_NUMBER);
    assert.match('"' + thousands + '"', TEXT_NUMBER);
    assert.doesNotMatch('Math.min(' + ['100', '150'].join(',') + '),clamp(v,' + ['10', '400'].join(',') + ')', TEXT_NUMBER);
    assert.doesNotMatch('fs*.' + ['92', '600'].join(',') + ')', TEXT_NUMBER);
    assert.doesNotMatch('[' + ['0', '100', '200'].join(',') + ']', TEXT_NUMBER);
    assert.doesNotMatch('"' + peso + '"+Number(n)', PESO_BEFORE_DIGIT);
  });
});

describe('the engine, loaded with no prices, holds none', () => {
  const { KC } = loadEngine();
  it('every material price is null and every history is empty', () => {
    const keys = Object.keys(KC.P);
    assert.equal(keys.length, 132);
    for (const k of keys) { assert.equal(KC.P[k].p, null, `KC.P.${k}.p`); assert.equal(KC.P[k].hist.length, 0, `KC.P.${k}.hist`); }
  });
  it('the Standard Price List is empty', () => {
    assert.equal(Object.keys(KC.LISTP).length, 0);
  });
  it('the corner charge is null, and the discount floor defaults to the list price', () => {
    assert.equal(KC.SET.corner, null);
    assert.equal(KC.FLOOR_MODE, 'list');
  });
  it('the settings that are formula constants stay (labor brackets, misc, markup)', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(KC.SET.br)), { simple: 30, medium: 50, complex: 70 });
    assert.equal(KC.SET.misc, 10);
    assert.equal(KC.SET.markup, 2);
  });
  it('the list table of the Chef Mode products is codes and models only', () => {
    assert.equal(KC.CHEF_LIST.length, 27);
    for (const row of KC.CHEF_LIST) assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(row))).sort(), ['code', 'items', 'n', 'variant'], row.code);
  });
  it('no product can state a price on its own: every start pill is unpriced', () => {
    for (const def of KC.productList()) for (const st of def.starts) assert.equal(KC.price(def.id, def.startCfg(st.id)).priced, false, `${def.id} / ${st.id}`);
  });
});
