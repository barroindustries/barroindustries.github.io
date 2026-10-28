#!/usr/bin/env node
/**
 * BARRO INDUSTRIES — make 1.5 mm the default "Top Gauge" on the plain products that carry that spec
 * scripts/flip-top-gauge-default.js
 *
 * QUOTE-BUILDER-CONFIGURATOR-SPEC.md §14.5 (owner ruling 2026-10-28). Made-to-order tables, sinks and stoves now have a 1.5 mm (16 ga)
 * top plate as standard, and 1.2 mm is the lighter choice. The six configurable families carry that in their definitions; this
 * script does the same for the PLAIN catalogue products that have a "Top Gauge" spec (today only BA-001, the bread table that the
 * prep_table family absorbs), so the Quote Builder's calculator opens them on 1.5 mm too. It is an Admin SDK script because no screen
 * edits a product's spec options, default or price adders.
 *
 * WHAT IT CHANGES — on every `products` doc that has a spec labelled "Top Gauge" (any case):
 *   option "1.2mm (std)"       becomes "1.2mm (lighter)"
 *   option "1.5mm heavy-duty"  becomes "1.5mm (16 ga, standard)"
 *   the spec's default         becomes "1.5mm (16 ga, standard)"
 *   any other option label is left exactly as it is, and is listed in the output so you can see it.
 * The priceAdder array is NEVER touched (so the builder's default price for the product rises by the master's own 1.5 mm adder, which the
 * select label shows), the option ORDER never changes, and nothing else on the doc is edited except `updatedAt`, which is stamped on a doc
 * that changed. The public website is unaffected (a product that a family absorbs is never a website card).
 * A spec that cannot be flipped safely (no options list, no 1.5 mm option, a rename that would duplicate a label) is left alone and
 * reported as "needs a look".
 *
 * SAFE BY DEFAULT.
 *   DRY RUN is the default: it reads, prints what it would change, and writes nothing. Add --apply to write.
 *   IDEMPOTENT: a re-run (or a run after --apply) reports "already flipped" and writes nothing.
 *   The output carries product ids and option labels ONLY — never a price adder, a base price or any other number from the doc.
 *
 * Required env (same as scripts/migrate-files-hub.js):
 *   FIREBASE_SERVICE_ACCOUNT — Firebase Admin SDK JSON (stringified)
 *
 * Run locally (spec §14.8 step 4):
 *   FIREBASE_SERVICE_ACCOUNT='<service-account-json>' node scripts/flip-top-gauge-default.js            # dry run
 *   FIREBASE_SERVICE_ACCOUNT='<service-account-json>' node scripts/flip-top-gauge-default.js --apply    # write
 *
 * NOT run by any workflow — a manual step. The pure transform (flipTopGauge) and the runner (run) are exported and covered by
 * tests/flip-top-gauge.test.mjs, which never touches Firestore.
 */

'use strict';

// ── the rule (spec §14.5) — these literals ARE the change; tests/flip-top-gauge.test.mjs pins them independently ──
const SPEC_LABEL = /^top gauge$/i;
const RENAMES = [
  ['1.2mm (std)', '1.2mm (lighter)'],
  ['1.5mm heavy-duty', '1.5mm (16 ga, standard)'],
];
const NEW_DEFAULT = '1.5mm (16 ga, standard)';

const text = (v) => (v == null ? null : String(v));   // a label as it is printed (null = absent)

// ── the pure transform ────────────────────────────────────────────────────────
// One "Top Gauge" spec -> { spec, report }. `spec` is the SAME object when nothing changes; otherwise a shallow copy with a new `options`
// and `default` (every other key, price adders included, is carried over by reference, untouched). `report` holds LABELS ONLY.
function flipSpec(sp) {
  const before = Array.isArray(sp.options) ? sp.options : null;
  const report = {
    label: String(sp.label), status: 'skipped', reason: '',
    renamed: [], untouched: [],
    optionsBefore: before ? before.map((o) => text(o)) : [], optionsAfter: before ? before.map((o) => text(o)) : [],
    defaultBefore: text(sp.default), defaultAfter: text(sp.default),
  };
  const skip = (reason) => { report.reason = reason; return { spec: sp, report }; };
  if (!before) return skip('the spec has no options list');

  const known = new Set([].concat(...RENAMES));
  report.untouched = before.filter((o) => !known.has(o)).map((o) => text(o));

  const renamed = [];
  const after = before.map((o) => {
    const hit = RENAMES.find((r) => r[0] === o);
    if (!hit) return o;
    renamed.push(hit.slice());
    return hit[1];
  });
  if (new Set(after).size !== after.length) return skip('renaming would leave two options with the same label');
  if (after.indexOf(NEW_DEFAULT) < 0) return skip('there is no 1.5 mm option to make the default');

  const changed = renamed.length > 0 || sp.default !== NEW_DEFAULT;
  report.renamed = renamed;
  report.optionsAfter = after.map((o) => text(o));
  report.defaultAfter = NEW_DEFAULT;
  report.status = changed ? 'flip' : 'already';
  return { spec: changed ? Object.assign({}, sp, { options: after, default: NEW_DEFAULT }) : sp, report };
}

// A whole product doc -> { matched, changed, specs, report[] }. Never mutates `product`. `specs` is the new specs array and is only
// meaningful (and only ever written) when `changed` is true; a spec that is not a "Top Gauge" is returned as the very same object.
function flipTopGauge(product) {
  const list = product && Array.isArray(product.specs) ? product.specs : [];
  const report = [];
  let changed = false;
  const specs = list.map((sp) => {
    if (!sp || typeof sp !== 'object' || !SPEC_LABEL.test(String(sp.label))) return sp;
    const r = flipSpec(sp);
    report.push(r.report);
    if (r.report.status === 'flip') changed = true;
    return r.spec;
  });
  return { matched: report.length, changed, specs, report };
}

// ── printing (labels and ids only) ────────────────────────────────────────────
const q = (s) => (s === null ? '(none)' : '"' + s + '"');
const list = (a) => (a.length ? a.map(q).join(', ') : '(none)');

function reportLines(id, rep, apply) {
  const head = rep.status === 'flip' ? (apply ? 'CHANGED' : 'WOULD CHANGE')
    : rep.status === 'already' ? 'already flipped - nothing to do'
    : 'SKIPPED - needs a look: ' + rep.reason;
  const out = [id + '  ' + q(rep.label) + '  ' + head];
  if (rep.status === 'flip') {
    rep.renamed.forEach((r) => out.push('    option   ' + q(r[0]) + ' -> ' + q(r[1])));
    if (rep.defaultBefore !== rep.defaultAfter) out.push('    default  ' + q(rep.defaultBefore) + ' -> ' + q(rep.defaultAfter));
  } else {
    out.push('    options  ' + list(rep.optionsBefore));
    out.push('    default  ' + q(rep.defaultBefore));
  }
  out.push('    other options, left as they are: ' + list(rep.untouched));
  return out;
}

// ── the runner ────────────────────────────────────────────────────────────────
// run(db, { apply, log, stamp }) -> { scanned, matched, changed, already, skipped, written }
//   db     a Firestore (Admin SDK) — or anything with collection('products').get() and doc.ref.update()
//   apply  must be exactly true to write; anything else is a dry run
//   stamp  returns the `updatedAt` value for a doc that changed (main passes FieldValue.serverTimestamp())
async function run(db, opts) {
  const apply = !!opts && opts.apply === true;
  const log = (opts && opts.log) || console.log;
  const stamp = (opts && opts.stamp) || (() => new Date());

  log('-- Top Gauge default flip (spec section 14.5) --');
  log(apply ? 'Mode: APPLY - changed products WILL be written.' : 'Mode: DRY RUN - nothing is written. Re-run with --apply to write.');

  const snap = await db.collection('products').get();
  const tally = { scanned: snap.size, matched: 0, changed: 0, already: 0, skipped: 0, written: 0 };
  if (!snap.size) log('WARNING: the products collection is empty - wrong project or credential?');

  for (const doc of snap.docs) {
    const r = flipTopGauge(doc.data());
    if (!r.matched) continue;
    tally.matched++;
    if (r.changed && apply) {
      await doc.ref.update({ specs: r.specs, updatedAt: stamp() });
      tally.written++;
    }
    for (const rep of r.report) {
      if (rep.status === 'flip') tally.changed++;
      else if (rep.status === 'already') tally.already++;
      else tally.skipped++;
      reportLines(doc.id, rep, apply).forEach((line) => log(line));
    }
  }

  log('');
  log('Scanned ' + tally.scanned + ' product(s); ' + tally.matched + ' with a "Top Gauge" spec.');
  log('Summary: ' + tally.changed + (apply ? ' changed, ' : ' to change, ') + tally.already + ' already flipped, ' + tally.skipped + ' skipped (need a look).');
  log(apply ? 'Wrote ' + tally.written + ' product(s).' : 'DRY RUN - nothing was written. Re-run with --apply to write.');
  log('Price adders are never touched or printed.');
  return tally;
}

// ── command line ──────────────────────────────────────────────────────────────
const USAGE = [
  'Usage: node scripts/flip-top-gauge-default.js [--apply]',
  '',
  '  (no flag)  DRY RUN: read the products, print what would change, write nothing.',
  '  --apply    write the change.',
  '  --help     this text.',
  '',
  'Needs FIREBASE_SERVICE_ACCOUNT (the Firebase Admin SDK JSON, stringified), like scripts/migrate-files-hub.js.',
].join('\n');

function parseArgs(argv) {
  const out = { apply: false, help: false, unknown: [] };
  for (const a of argv || []) {
    if (a === '--apply') out.apply = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else out.unknown.push(a);
  }
  return out;
}

// -> process exit code. Arguments are checked BEFORE anything is loaded or any credential is read, so a typo can never reach Firestore.
async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(USAGE); return 0; }
  if (args.unknown.length) {
    console.error('Unknown option(s): ' + args.unknown.join(' ') + '\n(Nothing was run. A dry run is the default; add --apply to write.)\n\n' + USAGE);
    return 1;
  }

  const admin = require('firebase-admin');
  const { requireEnv } = require('./drive-lib');
  let serviceAccount;
  try { serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT')); }
  catch (_) { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON (paste the WHOLE service-account file).'); }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log('Project: ' + (serviceAccount.project_id || '(unknown)'));

  await run(admin.firestore(), { apply: args.apply, stamp: () => admin.firestore.FieldValue.serverTimestamp() });
  return 0;
}

module.exports = { flipTopGauge, run, parseArgs };

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((e) => { console.error('flip-top-gauge-default: ' + (e && e.message ? e.message : e)); process.exit(1); });
}
