// tests/flip-top-gauge.test.mjs — scripts/flip-top-gauge-default.js: make 1.5 mm the DEFAULT "Top Gauge" on the plain products that carry one
// (QUOTE-BUILDER-CONFIGURATOR-SPEC.md §14.5, owner ruling 2026-10-28).
//
// What must hold:
//   * The two known option labels are renamed ("1.2mm (std)" -> "1.2mm (lighter)", "1.5mm heavy-duty" -> "1.5mm (16 ga, standard)"), in
//     place and in order, and the spec's default becomes the 1.5 option. Nothing else about the spec changes: the priceAdder array is the
//     very same array, any other option label is left alone AND reported, other specs and other products are not touched.
//   * IDEMPOTENT: a second pass over its own output changes nothing and says "already flipped"; a half-flipped spec is repaired.
//   * A spec that cannot be flipped safely (no options list, no 1.5 option, a rename that would duplicate a label) is left exactly as it
//     was and reported with a reason — never half-changed.
//   * DRY RUN is the default: the runner writes nothing unless apply === true, then writes only the products that changed (specs +
//     updatedAt, nothing else), writes nothing on a second apply, and prints ids and option LABELS only — never a price.
//   * The command line checks its arguments before it loads firebase or reads a credential, so a typo can never reach Firestore.
//
// Every fixture is an obviously FAKE odd figure (this repository is public; no real price is committed). No Firestore, no network:
// `run` is handed an in-memory fake that records (and applies) the writes it is asked to make.
//
// Mutation-tested in scratch copies of the script (never in the shared tree): 36 textual mutants, all killed —
//   transform: either new label spelled wrong, the 1.5 label never renamed, default not flipped / flipped to the 1.2 option, always "changed"
//     (not idempotent), a default-only repair ignored, price adders reversed / dropped, other options dropped / not reported / rewritten,
//     option order reversed, label regex unanchored (start, end) or case-sensitive, each of the three "cannot flip safely" guards removed,
//     the input mutated in place, an already-flipped or a skipped spec counted as a change, code that names the price adders.
//   runner: a dry run that writes, --apply that never writes, unchanged products written, the whole doc written back, updatedAt missing,
//     apply as the default, the write not awaited, the rewritten specs printed (prices in the log), "CHANGED" claimed in a dry run, the
//     empty-collection warning gone.
//   command line: unknown options ignored, --apply not recognised, the credential read before the arguments are checked.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'flip-top-gauge-default.js');
const { flipTopGauge, run, parseArgs } = require('../scripts/flip-top-gauge-default.js');

// ── fixtures: FAKE odd figures, so a leak is recognisable ───────────────────
const FAKE = { topGauge: [1357, 8642], undershelf: [24680, 97531, 11223], base: 55667, extra: 40404 };
const FAKE_FIGURES = [...FAKE.topGauge, ...FAKE.undershelf, FAKE.base, FAKE.extra].map(String);

// the literals of the ruling, written out here independently of the script's constants
const OLD_LIGHT = '1.2mm (std)', OLD_STD = '1.5mm heavy-duty';
const NEW_LIGHT = '1.2mm (lighter)', NEW_STD = '1.5mm (16 ga, standard)';

const topGauge = (over) => Object.assign({ label: 'Top Gauge', options: [OLD_LIGHT, OLD_STD], default: OLD_LIGHT, priceAdder: FAKE.topGauge.slice() }, over || {});
const undershelf = () => ({ label: 'Undershelf', options: ['None', '1 undershelf', '2 undershelves'], default: '1 undershelf', priceAdder: FAKE.undershelf.slice() });
const product = (specs) => ({ title: 'Synthetic bread table', basePrice: FAKE.base, specs });
const clone = (v) => structuredClone(v);
const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };

// ═════════════════════════════════════════════════════════════════════════════
describe('flipTopGauge — the pure transform (spec §14.5)', () => {
  it('renames the two known option labels, in place and in order', () => {
    const r = flipTopGauge(product([topGauge()]));
    assert.equal(r.matched, 1);
    assert.equal(r.changed, true);
    assert.deepEqual(r.specs[0].options, [NEW_LIGHT, NEW_STD]);
    assert.equal(r.report[0].status, 'flip');
    assert.deepEqual(r.report[0].renamed, [[OLD_LIGHT, NEW_LIGHT], [OLD_STD, NEW_STD]]);
    assert.deepEqual(r.report[0].untouched, []);
  });

  it('makes the 1.5 mm option the default (and the default is a real option)', () => {
    const r = flipTopGauge(product([topGauge()]));
    assert.equal(r.specs[0].default, NEW_STD);
    assert.equal(r.specs[0].options.indexOf(r.specs[0].default), 1);
    assert.equal(r.report[0].defaultBefore, OLD_LIGHT);
    assert.equal(r.report[0].defaultAfter, NEW_STD);
  });

  it('leaves the price adders exactly as they were — the same array, same values, same order, still aligned to the options', () => {
    const input = product([topGauge(), undershelf()]);
    const adders = input.specs[0].priceAdder;
    const r = flipTopGauge(input);
    assert.equal(r.specs[0].priceAdder, adders);                                   // the very same array, not a copy
    assert.deepEqual(r.specs[0].priceAdder, FAKE.topGauge);
    assert.equal(r.specs[0].priceAdder.length, r.specs[0].options.length);
    assert.equal(r.specs[1], input.specs[1]);                                      // another spec: the very same object
    assert.equal(r.specs[0].label, 'Top Gauge');
    assert.deepEqual(Object.keys(r.specs[0]).sort(), ['default', 'label', 'options', 'priceAdder']);   // no key added or dropped
  });

  it('is idempotent: a second pass over its own output changes nothing and says "already flipped"', () => {
    const first = flipTopGauge(product([topGauge(), undershelf()]));
    const again = flipTopGauge(product(first.specs));
    assert.equal(again.matched, 1);
    assert.equal(again.changed, false);
    assert.equal(again.report[0].status, 'already');
    assert.deepEqual(again.report[0].renamed, []);
    assert.deepEqual(again.specs, first.specs);
    assert.equal(again.specs[0], first.specs[0]);                                  // not even a new object
  });

  it('lists every OTHER option label in the report and leaves it exactly where it was', () => {
    const sp = topGauge({ options: [OLD_LIGHT, OLD_STD, '2.0mm extra-heavy', '3.0mm plate'], priceAdder: [1357, 8642, 24680, 97531] });
    const r = flipTopGauge(product([sp]));
    assert.deepEqual(r.specs[0].options, [NEW_LIGHT, NEW_STD, '2.0mm extra-heavy', '3.0mm plate']);
    assert.deepEqual(r.report[0].untouched, ['2.0mm extra-heavy', '3.0mm plate']);
    assert.equal(r.specs[0].default, NEW_STD);
    assert.deepEqual(r.specs[0].priceAdder, [1357, 8642, 24680, 97531]);
  });

  it('repairs a half-flipped spec: labels already renamed but the default still the old one', () => {
    const r = flipTopGauge(product([topGauge({ options: [NEW_LIGHT, NEW_STD], default: NEW_LIGHT })]));
    assert.equal(r.changed, true);
    assert.equal(r.report[0].status, 'flip');
    assert.deepEqual(r.report[0].renamed, []);
    assert.deepEqual(r.specs[0].options, [NEW_LIGHT, NEW_STD]);
    assert.equal(r.specs[0].default, NEW_STD);
  });

  it('repairs the other half-flip too: only one of the two labels renamed so far', () => {
    const r = flipTopGauge(product([topGauge({ options: [OLD_LIGHT, NEW_STD], default: NEW_STD })]));
    assert.equal(r.changed, true);
    assert.deepEqual(r.report[0].renamed, [[OLD_LIGHT, NEW_LIGHT]]);
    assert.deepEqual(r.specs[0].options, [NEW_LIGHT, NEW_STD]);
    assert.equal(r.specs[0].default, NEW_STD);
  });

  it('touches only a spec labelled exactly "Top Gauge" (any case, nothing around it)', () => {
    const decoys = [topGauge({ label: 'Rear Top Gauge' }), topGauge({ label: 'Top Gauge Cap' }), topGauge({ label: 'Gauge' }), undershelf()];
    const r = flipTopGauge(product(decoys));
    assert.equal(r.matched, 0);
    assert.equal(r.changed, false);
    r.specs.forEach((s, i) => assert.equal(s, decoys[i], 'decoy ' + i + ' was replaced'));
    for (const label of ['Top Gauge', 'top gauge', 'TOP GAUGE', 'Top gauge']) {
      assert.equal(flipTopGauge(product([topGauge({ label })])).changed, true, label);
    }
  });

  it('a product with no specs (or no doc at all) is a no-op, and junk entries do not throw', () => {
    for (const p of [null, undefined, {}, { specs: null }, { specs: [] }, { specs: 'nope' }]) {
      const r = flipTopGauge(p);
      assert.equal(r.matched, 0);
      assert.equal(r.changed, false);
      assert.deepEqual(r.report, []);
    }
    const r = flipTopGauge({ specs: [null, 7, 'x', undefined, topGauge()] });
    assert.equal(r.matched, 1);
    assert.equal(r.changed, true);
  });

  it('leaves a spec that cannot be flipped safely exactly as it was, with a reason — never half-changed', () => {
    const cases = {
      'there is no 1.5 mm option': topGauge({ options: [OLD_LIGHT, '2.0mm extra-heavy'] }),
      'a rename would duplicate a label': topGauge({ options: [OLD_LIGHT, OLD_STD, NEW_STD], priceAdder: [1357, 8642, 24680] }),
      'the spec has no options list': { label: 'Top Gauge', default: OLD_LIGHT, priceAdder: FAKE.topGauge.slice() },
      'options is not a list': topGauge({ options: OLD_LIGHT }),
    };
    for (const [why, sp] of Object.entries(cases)) {
      const input = product([sp]);
      const before = clone(input);
      const r = flipTopGauge(input);
      assert.equal(r.changed, false, why);
      assert.equal(r.report[0].status, 'skipped', why);
      assert.ok(r.report[0].reason.length > 5, why + ': no reason given');
      assert.deepEqual(r.report[0].renamed, [], why);
      assert.equal(r.specs[0], sp, why + ': the spec was replaced');
      assert.deepEqual(input, before, why + ': the input changed');
    }
  });

  it('judges each Top Gauge spec on its own', () => {
    const bad = topGauge({ options: [OLD_LIGHT, '2.0mm extra-heavy'] });
    const r = flipTopGauge(product([topGauge(), bad]));
    assert.equal(r.matched, 2);
    assert.equal(r.changed, true);
    assert.deepEqual(r.report.map((x) => x.status), ['flip', 'skipped']);
    assert.equal(r.specs[1], bad);
  });

  it('never mutates its input (a deep-frozen doc goes in, the same doc comes out of the comparison)', () => {
    const input = deepFreeze(product([topGauge({ options: [OLD_LIGHT, OLD_STD, '2.0mm extra-heavy'], priceAdder: [1357, 8642, 24680] }), undershelf()]));
    const before = clone(input);
    assert.doesNotThrow(() => flipTopGauge(input));
    assert.deepEqual(input, before);
  });

  it('the report carries labels only: no figure from the doc appears anywhere in it', () => {
    const r = flipTopGauge(product([topGauge({ options: [OLD_LIGHT, OLD_STD, '2.0mm extra-heavy'], priceAdder: [1357, 8642, 24680] }), undershelf()]));
    const dump = JSON.stringify(r.report);
    for (const n of FAKE_FIGURES) assert.ok(!dump.includes(n), n + ' leaked into the report');
    for (const rep of r.report) for (const k of ['optionsBefore', 'optionsAfter', 'untouched']) rep[k].forEach((s) => assert.equal(typeof s, 'string'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A fake Firestore: just collection('products').get() and doc.ref.update(patch). It APPLIES the patches, so a second run sees the first,
// and it lands a write a whole macrotask late — so a runner that forgot to await its writes (and would exit before they flushed) fails.
function fakeDb(docs) {
  const store = new Map(Object.entries(docs).map(([id, d]) => [id, clone(d)]));
  const writes = [];
  const reads = [];
  return {
    store, writes, reads,
    collection(name) {
      reads.push(name);
      return {
        async get() {
          const ids = [...store.keys()];
          return {
            size: ids.length,
            docs: ids.map((id) => ({
              id,
              data: () => clone(store.get(id)),
              ref: {
                async update(patch) {
                  await new Promise((resolve) => setImmediate(resolve));
                  writes.push({ id, patch: clone(patch) });
                  store.set(id, Object.assign({}, store.get(id), clone(patch)));
                },
              },
            })),
          };
        },
      };
    },
  };
}
const catalogue = () => ({
  'BA-001': product([topGauge(), undershelf()]),                                                   // the one to flip
  'XX-002': product([undershelf()]),                                                               // no Top Gauge at all
  'XX-003': product([topGauge({ options: [NEW_LIGHT, NEW_STD], default: NEW_STD })]),              // already flipped
  'XX-004': { title: 'Synthetic - no specs field', basePrice: FAKE.base },
});
const capture = () => { const lines = []; return { lines, log: (l) => lines.push(String(l)) }; };
const STAMP = () => 'STAMP';

describe('run — dry run by default, --apply writes (in-memory fake Firestore, no network)', () => {
  it('a dry run (no options, or apply false) reads the products, writes NOTHING, and says what it would change', async () => {
    for (const opts of [undefined, {}, { apply: false }]) {
      const db = fakeDb(catalogue());
      const out = capture();
      const t = await run(db, Object.assign({ log: out.log, stamp: STAMP }, opts));
      assert.deepEqual(db.writes, [], JSON.stringify(opts));
      assert.deepEqual(db.reads, ['products']);
      assert.deepEqual(t, { scanned: 4, matched: 2, changed: 1, already: 1, skipped: 0, written: 0 });
      const text = out.lines.join('\n');
      assert.match(text, /DRY RUN/);
      assert.match(text, /BA-001 .*WOULD CHANGE/);
      assert.ok(text.includes('"1.2mm (std)" -> "1.2mm (lighter)"'));
      assert.ok(text.includes('"1.5mm heavy-duty" -> "1.5mm (16 ga, standard)"'));
      assert.ok(text.includes('default  "1.2mm (std)" -> "1.5mm (16 ga, standard)"'));
      assert.match(text, /XX-003 .*already flipped/);
      assert.ok(!/XX-002|XX-004/.test(text), 'a product without a Top Gauge spec is not mentioned');
    }
  });

  it('--apply writes only the product that changes, and only specs + updatedAt, with the price adders intact', async () => {
    const db = fakeDb(catalogue());
    const out = capture();
    const t = await run(db, { apply: true, log: out.log, stamp: STAMP });
    assert.equal(db.writes.length, 1);
    const w = db.writes[0];
    assert.equal(w.id, 'BA-001');
    assert.deepEqual(Object.keys(w.patch).sort(), ['specs', 'updatedAt']);
    assert.equal(w.patch.updatedAt, 'STAMP');
    assert.deepEqual(w.patch.specs[0].options, [NEW_LIGHT, NEW_STD]);
    assert.equal(w.patch.specs[0].default, NEW_STD);
    assert.deepEqual(w.patch.specs[0].priceAdder, FAKE.topGauge);
    assert.deepEqual(w.patch.specs[1], undershelf());
    assert.equal(db.store.get('BA-001').basePrice, FAKE.base);
    for (const id of ['XX-002', 'XX-003', 'XX-004']) assert.deepEqual(db.store.get(id), catalogue()[id], id + ' was touched');
    assert.deepEqual(t, { scanned: 4, matched: 2, changed: 1, already: 1, skipped: 0, written: 1 });
    const text = out.lines.join('\n');
    assert.match(text, /APPLY/);
    assert.match(text, /BA-001 .*CHANGED/);
  });

  it('a second --apply finds nothing to do and writes nothing (idempotent end to end)', async () => {
    const db = fakeDb(catalogue());
    await run(db, { apply: true, log: () => {}, stamp: STAMP });
    assert.equal(db.writes.length, 1);
    const out = capture();
    const t = await run(db, { apply: true, log: out.log, stamp: STAMP });
    assert.equal(db.writes.length, 1);
    assert.deepEqual(t, { scanned: 4, matched: 2, changed: 0, already: 2, skipped: 0, written: 0 });
    assert.match(out.lines.join('\n'), /BA-001 .*already flipped/);
  });

  it('a spec that needs a look is reported, never written — even with --apply', async () => {
    const db = fakeDb(Object.assign(catalogue(), { 'XX-005': product([topGauge({ options: [OLD_LIGHT, '2.0mm extra-heavy'] })]) }));
    const out = capture();
    const t = await run(db, { apply: true, log: out.log, stamp: STAMP });
    assert.deepEqual(db.writes.map((w) => w.id), ['BA-001']);
    assert.equal(t.skipped, 1);
    assert.match(out.lines.join('\n'), /XX-005 .*SKIPPED - needs a look: there is no 1\.5 mm option/);
    assert.deepEqual(db.store.get('XX-005'), product([topGauge({ options: [OLD_LIGHT, '2.0mm extra-heavy'] })]));
  });

  it('never prints a price: ids and option labels only, in a dry run, an apply and a re-run', async () => {
    const db = fakeDb(Object.assign(catalogue(), {
      'XX-005': Object.assign(product([topGauge({ options: [OLD_LIGHT, '2.0mm extra-heavy'], priceAdder: [FAKE.extra, FAKE.extra] })]), { basePrice: FAKE.extra }),
    }));
    const out = capture();
    const results = [await run(db, { log: out.log }), await run(db, { apply: true, log: out.log, stamp: STAMP }), await run(db, { apply: true, log: out.log, stamp: STAMP })];
    const everything = out.lines.join('\n') + JSON.stringify(results);
    for (const n of FAKE_FIGURES) assert.ok(!everything.includes(n), n + ' leaked into the output');
    assert.ok(!/priceAdder|basePrice/i.test(everything), 'a price field name appears in the output');
  });

  it('warns when the collection is empty (wrong project or credential) and still writes nothing', async () => {
    const db = fakeDb({});
    const out = capture();
    const t = await run(db, { apply: true, log: out.log, stamp: STAMP });
    assert.equal(db.writes.length, 0);
    assert.equal(t.scanned, 0);
    assert.match(out.lines.join('\n'), /WARNING: the products collection is empty/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('command line — nothing reaches Firestore on a typo', () => {
  it('parseArgs: a dry run unless --apply; anything unrecognised is reported, not ignored', () => {
    assert.deepEqual(parseArgs([]), { apply: false, help: false, unknown: [] });
    assert.deepEqual(parseArgs(['--apply']), { apply: true, help: false, unknown: [] });
    assert.deepEqual(parseArgs(['--help']), { apply: false, help: true, unknown: [] });
    assert.deepEqual(parseArgs(['--aply']), { apply: false, help: false, unknown: ['--aply'] });
    assert.deepEqual(parseArgs(['--apply', '--nope']), { apply: true, help: false, unknown: ['--nope'] });
  });

  // spawned WITHOUT FIREBASE_SERVICE_ACCOUNT: if the script reached its credential check it would exit 2 ("CONFIG ERROR"), not 0 / 1
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });

  it('--help prints the usage and exits 0 without loading firebase or reading a credential', () => {
    const r = cli('--help');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--apply/);
    assert.match(r.stdout, /DRY RUN/);
  });

  it('an unknown option exits 1 before anything else runs', () => {
    const r = cli('--aply');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--aply/);
    assert.match(r.stderr, /Nothing was run/);
    assert.ok(!/CONFIG ERROR/.test(r.stderr), 'the credential check ran before the arguments were validated');
  });

  it('the executable code never names the price adders — they can only be carried over, never changed or printed', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const offenders = src.split('\n').filter((l) => /priceAdder/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
    assert.deepEqual(offenders, [], 'priceAdder appears outside a comment line');
  });
});
