#!/usr/bin/env node
/**
 * scripts/check-brief-copy.js — the public project brief's DEFINITION carries no price vocabulary, with ONE narrow allowance.
 *
 * Why it exists: the public project brief (/sales/clientinformationrequest/) is a public surface, and public surfaces carry no
 * pricing (CHECK 9: no price words, no peso amounts, no pricing fields). The page's own files (the HTML, css/project-brief.css and
 * js/project-brief.js) are scanned by CHECK 9 directly; what the page *renders* comes from FORMS.project_brief_v2 in js/cir-forms.js,
 * so this script holds that definition to the same rule.
 *
 * The allowance (and the only one): the brief's optional "Approximate budget" question. Its answers are peso BANDS the CLIENT picks
 * to tell Barro what they expect to spend — client-stated budget bands, not prices (Barro quotes nothing on this page). Exactly that
 * question — its label, its hint and its six option labels, as listed in scripts/brief-budget-bands.json — is let through, together
 * with the summaryKeys pointer that names it. Everything else in the definition, keys and values alike, is scanned, and:
 *   - the question must equal the allowance field for field (an added band, a reworded band, an extra property or a second
 *     "budget" field is NOT allowed through and is reported);
 *   - every allowed option label must have the shape of a band ("Under ₱500,000", "₱500,000 – ₱1,000,000", "Over ₱10,000,000") or
 *     be the opt-out, so the allowance cannot be used to carry a price list;
 *   - the allowance covers this form only. The v1 questionnaire (kept verbatim for stored briefs), the catalogue, the content pages
 *     and the homepage are not touched by it and keep their ban (CHECK 9's other scans; tests/brief-budget.test.mjs pins that).
 *
 * Usage:   node scripts/check-brief-copy.js [path/to/cir-forms.js] [path/to/brief-budget-bands.json]
 * Exit:    1 when the definition breaks the rule (FAIL lines carry JSON paths only — the offending text is withheld on purpose,
 *          like CHECK 9's other output), 0 otherwise.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALLOWANCE_FILE = path.join(__dirname, 'brief-budget-bands.json');
const DEFAULT_FORMS = path.join(ROOT, 'js', 'cir-forms.js');
const FORM_ID = 'project_brief_v2';

// What the public brief may not say anywhere (a superset of the words CHECK 9 bans in the page's own files).
const PRICE_VOCAB = /₱|\bPHP\b|\bpesos?\b|pric(e|es|ing)\b|[^a-z]costs?[^a-z]|\bbudget\b|\bquot(e|ation) (is|are) free\b|basePrice|priceAdder|pricePer|formulaType|unitPrice|exactTotal|listPrice|pricing-core/i;

// The only shapes an allowed option label may take: a client-stated band, or the opt-out.
const BAND_SHAPES = [
  /^Under ₱\d{1,3}(,\d{3})+$/,
  /^₱\d{1,3}(,\d{3})+ – ₱\d{1,3}(,\d{3})+$/,
  /^Over ₱\d{1,3}(,\d{3})+$/,
  /^Prefer not to say \/ not sure$/
];
const VALUE_SHAPE = /^[a-z0-9_]{1,40}$/;
const FIELD_PROPS = ['key', 'label', 'type', 'ui', 'w', 'hint', 'options'];     // the properties the allowed question may carry

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** The allowance file itself must be narrow: one select, a plain label and hint, and nothing but bands. */
function validateAllowance(a) {
  const p = [];
  if (!isObj(a)) return ['the allowance is not an object'];
  if (typeof a.partKey !== 'string' || !/^[a-z_]+$/.test(a.partKey)) p.push('partKey is not a plain key');
  if (typeof a.fieldKey !== 'string' || !/^[a-z_]+$/.test(a.fieldKey)) p.push('fieldKey is not a plain key');
  if (a.type !== 'select') p.push('the allowed question must be a select');
  if (typeof a.label !== 'string' || !a.label || PRICE_VOCAB.test(a.label.replace(/\bbudget\b/i, ''))) p.push('the label may carry no price word other than "budget"');
  if (typeof a.hint !== 'string' || PRICE_VOCAB.test(a.hint)) p.push('the hint may carry no price word');
  if (!Array.isArray(a.options) || a.options.length < 2 || a.options.length > 10) p.push('the options must be a list of 2 to 10 bands');
  else {
    const seen = new Set();
    a.options.forEach((o, i) => {
      if (!isObj(o) || Object.keys(o).sort().join() !== 'l,v') { p.push(`options[${i}] must be exactly { v, l }`); return; }
      if (!VALUE_SHAPE.test(o.v) || seen.has(o.v)) p.push(`options[${i}].v is not a unique plain key`);
      seen.add(o.v);
      if (typeof o.l !== 'string' || !BAND_SHAPES.some((re) => re.test(o.l))) p.push(`options[${i}].l is not a client-stated band`);
    });
  }
  return p;
}

/** True when the question in the definition equals the allowance, and carries nothing else. */
function isAllowedQuestion(field, section, a) {
  if (!isObj(field) || !isObj(section) || section.key !== a.partKey) return false;
  if (Object.keys(field).some((k) => FIELD_PROPS.indexOf(k) === -1)) return false;
  if (field.key !== a.fieldKey || field.type !== a.type || field.label !== a.label || field.hint !== a.hint) return false;
  if (!Array.isArray(field.options) || field.options.length !== a.options.length) return false;
  return field.options.every((o, i) => isObj(o) && Object.keys(o).sort().join() === 'l,v' && o.v === a.options[i].v && o.l === a.options[i].l);
}

/** Visit every key and every string value of a JSON-like tree. */
function walk(node, at, visit) {
  if (typeof node === 'string') { visit(at, node); return; }
  if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${at}[${i}]`, visit)); return; }
  if (isObj(node)) {
    Object.keys(node).forEach((k) => {
      const here = at ? `${at}.${k}` : k;
      visit(here + ' (key)', k);
      walk(node[k], here, visit);
    });
  }
}

/**
 * Scan FORMS.project_brief_v2. Returns a list of problems (strings carrying JSON paths, never the offending text); empty = clean.
 */
function scanDefinition(def, allowance) {
  const problems = validateAllowance(allowance).map((x) => 'allowance: ' + x);
  if (!isObj(def) || !Array.isArray(def.sections)) return problems.concat('the project brief definition has no sections');
  const clone = JSON.parse(JSON.stringify(def));
  let exempt = null, seen = 0;
  clone.sections.forEach((sec, si) => ((sec && sec.fields) || []).forEach((f, fi) => {
    if (!isObj(f) || f.key !== allowance.fieldKey) return;
    seen++;
    if (isAllowedQuestion(f, sec, allowance)) exempt = [si, fi];
    else problems.push(`sections[${si}].fields[${fi}] ("${allowance.fieldKey}") differs from scripts/brief-budget-bands.json — only the allowed budget question may carry peso bands`);
  }));
  if (seen > 1) problems.push(`the definition has ${seen} fields keyed "${allowance.fieldKey}"; the allowance covers exactly one`);
  if (exempt && seen === 1) {
    clone.sections[exempt[0]].fields.splice(exempt[1], 1);
    if (isObj(clone.summaryKeys) && clone.summaryKeys[allowance.fieldKey] === allowance.fieldKey) delete clone.summaryKeys[allowance.fieldKey];
  }
  walk(clone, '', (at, text) => { if (PRICE_VOCAB.test(text)) problems.push(`${at} carries pricing vocabulary (text withheld on purpose)`); });
  return problems;
}

function main(argv) {
  const formsPath = argv[2] ? path.resolve(argv[2]) : DEFAULT_FORMS;
  const allowancePath = argv[3] ? path.resolve(argv[3]) : ALLOWANCE_FILE;
  const rel = (p) => { const r = path.relative(ROOT, p); return (r && r.indexOf('..') !== 0) ? r : p; };
  let def, allowance;
  try { const forms = require(formsPath); def = forms && forms.FORMS && forms.FORMS[FORM_ID]; } catch (e) {
    console.log(`FAIL: ${rel(formsPath)} could not be loaded (${e.message}).`);
    return 1;
  }
  try { allowance = JSON.parse(fs.readFileSync(allowancePath, 'utf8')); } catch (e) {
    console.log(`FAIL: ${rel(allowancePath)} could not be read (${e.message}).`);
    return 1;
  }
  if (!def) { console.log(`FAIL: ${rel(formsPath)} has no ${FORM_ID} definition.`); return 1; }
  const problems = scanDefinition(def, allowance);
  if (problems.length) {
    problems.forEach((x) => console.log('FAIL: ' + x));
    console.log(`FAIL: the public project brief definition (${rel(formsPath)}, ${FORM_ID}) breaks the no-pricing rule. The only price-like text allowed is the client-stated budget question listed in ${rel(allowancePath)}. Offending text withheld on purpose.`);
    return 1;
  }
  console.log(`PASS: ${FORM_ID} carries no pricing vocabulary except the client-stated budget bands (${rel(allowancePath)}), which it matches exactly`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { scanDefinition, validateAllowance, isAllowedQuestion, PRICE_VOCAB, BAND_SHAPES, ALLOWANCE_FILE, DEFAULT_FORMS, FORM_ID };
