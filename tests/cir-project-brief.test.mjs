// tests/cir-project-brief.test.mjs — the general PROJECT BRIEF (FORMS.project_brief_v2, 2026-10-22).
//
// Owner brief: the commissary-only intake was "too specific to commissary"; there are many kinds of project
// (restaurant, café, commissary, hospital, school, ...). The redesign adds a NEW form definition beside the old one
// (spec §1.4: "a second questionnaire is a new FORMS key — no migration"), so every submission already stored under
// `commissary_brief` still renders with its original definition in Sales › Briefs.
//
// What is pinned here:
//   · the v2 definition: the twelve project types, one conditional part per type, the owner's required fields (and
//     only those), the common parts, the photo groups and every photo/size limit the old form had;
//   · the v1 definition and the original privacy notice are BYTE-FOR-BYTE what they were (a stored hash);
//   · cir-core: a conditional answer is accepted ONLY for the project type it belongs to (a mismatched answer is
//     rejected, never dropped), a conditional `required` bites only when its part applies, unknown keys are rejected —
//     including names that exist on Object.prototype — and "a mobile number OR an email" is enforced;
//   · the summary / notification the list and the push use (labels, not keys; the client's optional budget band is in the summary, never in the push);
//   · the REAL callables (functions/index.js) against the in-memory Firestore: v2 start → photos → submit → stored doc,
//     the moved photos, the notifications; v1 still works (the legacy notice version is still accepted and recorded
//     against ITS text); every rejection writes nothing and moves nothing.
//
// Mutation-tested in a scratch copy, never the shared tree.
// Run with: node --test tests/*.test.mjs

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const cir = require('../functions/cir-core.js');
const portal = require('../functions/portal-core.js');
const { FORMS, NOTICES, PRIVACY_NOTICE, LIMITS } = require('../functions/cir-forms.js');

const V1 = FORMS.commissary_brief;
const V2 = FORMS.project_brief_v2;
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');

// ── helpers over a definition ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const fieldsOf = (sec) => sec.fields.filter((f) => f.type !== 'photos');
const allFields = (def) => def.sections.flatMap(fieldsOf);
const byKey = (def, key) => allFields(def).find((f) => f.key === key);
const optValues = (f) => f.options.map((o) => (typeof o === 'string' ? o : o.v));
const optLabel = (f, v) => { const o = f.options.find((x) => (typeof x === 'string' ? x : x.v) === v); return typeof o === 'string' ? o : o.l; };
const TYPES = optValues(byKey(V2, 'project_type'));
const condSections = V2.sections.filter((s) => s.when);
const sectionFor = (type) => condSections.find((s) => s.when.in.includes(type));

// ── a valid answer set per conditional PART (keyed by section key; "food" serves restaurant / café / bakery / catering) ─────────────
const BASE = () => ({
  project_type: 'restaurant', name: 'Maria Santos', position: 'Owner', company: 'Santos Foods',
  phone: '0917 123 4567', email: 'maria@example.com', city: 'Quezon City', province: 'Metro Manila',
  site_address: 'Near the Tandang Sora flyover', site_status: 'renovation', scope: ['equipment', 'full_kitchen'],
});
const COND = {
  food: { cuisine: 'Filipino grill', seats: 60, meals_per_day: 400, service_style: ['takeaway', 'dine_in'], cooking_methods: ['grill_fry', 'wok'] },
  commissary: { outlets_now: 8, outlets_target: 20, volume_day: '800 meals', menu_categories: ['rice_meals', 'sauces'], process: ['cook_chill', 'packing'] },
  hotel: { hotel_kitchens: 3, hotel_rooms: 120, banquet_capacity: 300, hotel_services: ['breakfast', 'banquets'] },
  hospital: { hosp_meals: 900, hosp_patients: 150, hosp_staff: 200, hosp_diets: ['diabetic', 'tray_line'], hosp_infection: ['separate_areas', 'hands_free'] },
  school: { school_for: ['kitchen', 'laboratory'], school_meals: 1200, school_lab_type: 'chemistry', school_stations: 24, school_lab_services: ['sinks', 'gas'] },
  laboratory: { lab_type: 'biology', lab_stations: 12, lab_chemicals: 'yes', lab_services: ['sinks', 'exhaust'] },
  government: { gov_purpose: 'feeding', gov_served: 500, gov_mode: 'public_bidding', gov_ref: 'ITB-2026-014' },
  home: { home_kitchen: 'outdoor', home_building: 'condo', home_items: ['sink', 'stove'] },
  other: { other_description: 'A stainless steel cart for our food truck.' },
};
const condKeyFor = (type) => (sectionFor(type) || {}).key;
const answersFor = (type, over) => Object.assign(BASE(), { project_type: type }, COND[condKeyFor(type)] || {}, over || {});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the old questionnaire and the original privacy notice are untouched', () => {
  it('FORMS holds the old definition verbatim next to the new one', () => {
    assert.deepEqual(Object.keys(FORMS), ['commissary_brief', 'project_brief_v2']);
    // sha256 of JSON.stringify(FORMS.commissary_brief) as it was at HEAD before the redesign — never edit it (stored briefs render with it)
    assert.equal(sha(JSON.stringify(V1)), '4cf601da054ab193f57e35d40d82fb704da8967f909ae078249cff15fc455060');
    assert.equal(V1.formVersion, 1);
    assert.equal(V1.sections.length, 10);
  });

  it('the original notice (2026-09-26.1) is kept verbatim, the current one is newer, and both are known', () => {
    assert.deepEqual(Object.keys(NOTICES), ['2026-09-26.1', '2026-10-22.1']);
    assert.equal(PRIVACY_NOTICE.version, '2026-10-22.1');
    assert.equal(NOTICES['2026-10-22.1'], PRIVACY_NOTICE);
    assert.equal(sha(JSON.stringify(NOTICES['2026-09-26.1'].sections)), '94b36eaf177e7a5e8653c9227ffe9c30f11c18dcb903e3a4b92340439fa9c990');
    assert.match(NOTICES['2026-09-26.1'].consentLine, /my kitchen design and proposal/);
  });

  it('the current notice differs from the original in the consent line, the privacy contact and the two sections that named a kitchen', () => {
    const old = NOTICES['2026-09-26.1'], cur = PRIVACY_NOTICE;
    assert.equal(cur.sections.length, old.sections.length);
    const changed = cur.sections.map((s, i) => [s.heading, s.body !== old.sections[i].body]).filter((x) => x[1]).map((x) => x[0]);
    assert.deepEqual(changed, ['Who is responsible for your data', 'What we collect on this page', 'Why']);
    cur.sections.forEach((s, i) => assert.equal(s.heading, old.sections[i].heading));
    assert.notEqual(cur.consentLine, old.consentLine);
    assert.match(cur.consentLine, /plan and quote my project/);
    // the controller section differs by ONE thing: the privacy contact is the domain address, not the Gmail one (2026-10-22, owner)
    assert.equal(cur.sections[0].body, old.sections[0].body.replace('barroindustries@gmail.com', 'hello@barroindustries.com'));
    // the other sections js/qr-def.js mirrors byte-for-byte (tests/quote-request.test.mjs) are among the untouched ones
    for (const h of ['Lawful basis', 'Who we share it with', 'Your rights']) {
      assert.equal(cur.sections.find((s) => s.heading === h).body, old.sections.find((s) => s.heading === h).body, h);
    }
    // nothing the new wording describes is commissary- or kitchen-only; it does say the budget range is collected (the question is optional)
    assert.ok(!/kitchen|storage|permits/i.test(cur.sections[1].body + cur.sections[2].body + cur.consentLine));
    assert.match(cur.sections[1].body, /the budget range you choose to share/);
    assert.ok(!/budget/i.test(cur.sections[2].body + cur.consentLine));
  });

  it('the privacy contact is the domain address in the current notice; the Gmail address survives only in the original text it was shown in', () => {
    assert.match(PRIVACY_NOTICE.sections[0].body, /0927 683 6300, hello@barroindustries\.com\.$/);
    assert.ok(!/gmail/i.test(JSON.stringify(PRIVACY_NOTICE)), 'the current notice still names the Gmail address');
    assert.match(NOTICES['2026-09-26.1'].sections[0].body, /barroindustries@gmail\.com\.$/, 'the original text is history: stored consents were given against it');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('FORMS.project_brief_v2 — the definition', () => {
  it('is its own form: formId, version 1, the wording the owner gave', () => {
    assert.equal(V2.formId, 'project_brief_v2');
    assert.equal(V2.formVersion, 1);
    assert.equal(V2.title, 'Tell us about your project');
    assert.match(V2.intro, /^Share the details of your kitchen, laboratory or fabrication project/);
    assert.equal(V2.submitLabel, 'Send project brief');
  });

  it('every field key is unique across the WHOLE form (all conditional parts included)', () => {
    const keys = allFields(V2).map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, 'duplicate field key');
    keys.forEach((k) => assert.match(k, /^[a-z][a-z0-9_]{1,40}$/, k));
    assert.equal(new Set(V2.sections.map((s) => s.key)).size, V2.sections.length, 'duplicate section key');
  });

  it('step 1 is "What type of project is this?" with the twelve choices, in the owner\'s order', () => {
    assert.equal(V2.sections[0].key, 'type');
    assert.equal(V2.sections[0].title, 'What type of project is this?');
    const f = V2.sections[0].fields[0];
    assert.deepEqual([f.key, f.type, f.required, f.ui], ['project_type', 'select', true, 'cards']);
    assert.deepEqual(f.options.map((o) => o.l), [
      'Restaurant', 'Café', 'Bakery', 'Commissary / central kitchen', 'Hotel or resort', 'Catering',
      'Hospital or clinic', 'School or university', 'Laboratory', 'Government office or LGU', 'Home or residential', 'Other (specify)',
    ]);
    assert.deepEqual(TYPES, ['restaurant', 'cafe', 'bakery', 'commissary', 'hotel', 'catering', 'hospital', 'school', 'laboratory', 'government', 'home', 'other']);
    f.options.forEach((o) => assert.ok(o.d && o.d.length < 60, `${o.v}: one short descriptor for its card`));
  });

  it('the required fields are the owner\'s minimal list and nothing else (type, name, location, scope; mobile OR email; a description for "Other")', () => {
    const required = V2.sections.flatMap((s) => fieldsOf(s).filter((f) => f.required).map((f) => [s.when ? s.key : 'common', f.key])).sort();
    assert.deepEqual(required, [['common', 'city'], ['common', 'name'], ['common', 'project_type'], ['common', 'province'], ['common', 'scope'], ['other', 'other_description']]);
    assert.deepEqual(V2.requireOneOf.map((g) => g.keys), [['phone', 'email']]);
    assert.equal(byKey(V2, 'phone').required, undefined);
    assert.equal(byKey(V2, 'email').required, undefined);
  });

  it('every type has exactly ONE conditional part, shared only where the owner grouped them', () => {
    for (const t of TYPES) assert.equal(condSections.filter((s) => s.when.in.includes(t)).length, 1, `${t} must be in exactly one conditional part`);
    assert.deepEqual(sectionFor('restaurant').when.in, ['restaurant', 'cafe', 'bakery', 'catering']);
    for (const t of ['commissary', 'hotel', 'hospital', 'school', 'laboratory', 'government', 'home', 'other']) assert.deepEqual(sectionFor(t).when.in, [t]);
    for (const s of condSections) {
      assert.equal(s.when.key, 'project_type');
      s.when.in.forEach((v) => assert.ok(TYPES.includes(v), `${s.key}: "${v}" is not a project type`));
    }
  });

  it('the conditional parts are short: 3–6 questions each (the one-box "Other" part aside)', () => {
    for (const s of condSections) {
      const n = s.fields.length;
      assert.ok(n >= 1 && n <= 6, `${s.key} has ${n} questions`);
      if (s.key !== 'other') assert.ok(n >= 3, `${s.key} has only ${n} questions`);
    }
  });

  it('the conditional questions are the ones the owner listed, per type', () => {
    const keys = (k) => condSections.find((s) => s.key === k).fields.map((f) => f.key);
    const labels = (k) => condSections.find((s) => s.key === k).fields.map((f) => f.label);
    assert.deepEqual(labels('food'), ['Cuisine or menu style', 'Seats or covers', 'Meals or orders per day', 'Service style', 'Main cooking methods']);
    assert.deepEqual(labels('commissary').slice(0, 3), ['Outlets you supply', 'Outlets planned in three years', 'Production volume per day']);
    assert.ok(keys('commissary').includes('menu_categories'));
    assert.deepEqual(labels('hotel').slice(0, 3), ['Kitchens or food outlets', 'Number of rooms', 'Banquet or function capacity']);
    assert.deepEqual(keys('hospital'), ['hosp_meals', 'hosp_patients', 'hosp_staff', 'hosp_diets', 'hosp_infection']);
    assert.ok(optValues(byKey(V2, 'hosp_diets')).includes('tray_line'), 'tray-line needs');
    assert.deepEqual(keys('school'), ['school_for', 'school_meals', 'school_lab_type', 'school_stations', 'school_lab_services']);
    assert.deepEqual(optValues(byKey(V2, 'school_for')), ['kitchen', 'laboratory']);
    assert.deepEqual(keys('laboratory'), ['lab_type', 'lab_stations', 'lab_chemicals', 'lab_services']);
    assert.deepEqual(optValues(byKey(V2, 'lab_chemicals')), ['yes', 'no', 'not_sure']);
    assert.deepEqual(keys('government'), ['gov_purpose', 'gov_served', 'gov_mode', 'gov_ref']);
    assert.deepEqual(optValues(byKey(V2, 'gov_purpose')), ['canteen', 'feeding', 'other']);
    assert.deepEqual(optValues(byKey(V2, 'home_kitchen')), ['outdoor', 'dirty', 'full', 'not_sure']);
    assert.deepEqual(keys('home'), ['home_kitchen', 'home_building', 'home_items']);
    assert.deepEqual(optValues(byKey(V2, 'home_building')), ['house', 'townhouse', 'condo', 'other']);
    assert.deepEqual(keys('other'), ['other_description']);
    // the SS316 note for school and laboratory work
    for (const k of ['school', 'laboratory']) assert.match(condSections.find((s) => s.key === k).hint, /SS316 laboratory-grade/);
  });

  it('the common parts every project answers are all there, with the owner\'s options', () => {
    const common = V2.sections.filter((s) => !s.when).map((s) => s.key);
    assert.deepEqual(common, ['type', 'contact', 'location', 'scope', 'space', 'material', 'photos', 'final']);
    assert.deepEqual(V2.sections.map((s) => s.key).filter((k) => !common.includes(k)), condSections.map((s) => s.key));
    assert.deepEqual(fieldsOf(V2.sections.find((s) => s.key === 'contact')).map((f) => f.key), ['name', 'position', 'company', 'phone', 'email']);
    assert.deepEqual(fieldsOf(V2.sections.find((s) => s.key === 'location')).map((f) => f.key), ['city', 'province', 'site_address', 'site_status']);
    assert.deepEqual(optValues(byKey(V2, 'site_status')), ['new_build', 'renovation', 'replacement']);
    assert.deepEqual(byKey(V2, 'scope').options.map((o) => o.l), ['Full kitchen design and build', 'Individual equipment', 'Custom fabrication', 'Exhaust and fresh air', 'LPG gas line', 'Fire suppression', 'Repair or maintenance']);
    assert.deepEqual(['area_sqm', 'dimensions', 'floor_plan', 'utilities'], fieldsOf(V2.sections.find((s) => s.key === 'space')).map((f) => f.key));
    assert.deepEqual(optValues(byKey(V2, 'floor_plan')), ['yes', 'no']);
    for (const v of ['lpg', 'natural_gas', 'electricity', 'water', 'drainage', 'exhaust']) assert.ok(optValues(byKey(V2, 'utilities')).includes(v), `utilities: ${v}`);
    assert.deepEqual(optValues(byKey(V2, 'material')), ['ss304', 'ss316', 'not_sure']);
    assert.deepEqual(byKey(V2, 'material').options.map((o) => o.l), ['SS304 food grade (our standard)', 'SS316 laboratory grade', 'Not sure yet']);
    assert.deepEqual(optValues(byKey(V2, 'finish')), ['brushed', 'mirror', 'satin', 'not_sure']);
    assert.equal(byKey(V2, 'target_date').type, 'date');
    assert.ok(optValues(byKey(V2, 'timeline')).includes('not_sure'), 'timeline: "not sure yet"');
    assert.deepEqual(optValues(byKey(V2, 'buyer_type')), ['private', 'government']);
    assert.match(byKey(V2, 'buyer_type').hint, /Government purchases follow procurement rules/, 'the note for government buyers');
    assert.equal(byKey(V2, 'notes').type, 'textarea');
  });

  it('select / chips option values are unique within a field, and every summaryKeys entry names a real field', () => {
    for (const f of allFields(V2).filter((x) => x.options)) {
      const v = optValues(f);
      assert.equal(new Set(v).size, v.length, `${f.key}: duplicate option value`);
      assert.ok(v.length >= 2, f.key);
    }
    const real = new Set(allFields(V2).map((f) => f.key));
    for (const [out, spec] of Object.entries(V2.summaryKeys)) {
      const list = typeof spec === 'string' ? [spec] : (spec.join || spec.first);
      assert.ok(Array.isArray(list) && list.length, out);
      list.forEach((k) => assert.ok(real.has(k), `summaryKeys.${out} → unknown field ${k}`));
    }
    assert.equal(V2.summaryKeys.budget, 'budget', 'the summary carries the client-stated budget band (its label)');
  });

  it('keeps the whole Photos part: same groups, same limits (all the security and size behaviour is in LIMITS and the callables)', () => {
    const ph = V2.sections.find((s) => s.key === 'photos').fields[0];
    assert.equal(ph.type, 'photos');
    assert.deepEqual(ph.groups.map((g) => g.key), ['site', 'kitchen', 'equipment', 'docs']);
    assert.deepEqual(ph.groups.map((g) => g.key), V1.sections.find((s) => s.key === 'photos').fields[0].groups.map((g) => g.key));
    assert.equal(ph.groups.find((g) => g.key === 'kitchen').label, 'Existing kitchen or laboratory');
    assert.deepEqual({ ...LIMITS }, {
      maxPhotos: 20, maxPhotoBytes: 900000, minPhotoBytes: 2000, maxTotalPhotoBytes: 12000000, photoLongEdge: 1600, photoQuality: 0.8,
      maxCaption: 120, maxEquipmentRows: 40, maxCellChars: 120, maxPayloadBytes: 200000, minFillMs: 15000, draftTtlMs: 7 * 24 * 3600e3, dupWindow: 'day',
    });
  });

  it('the public copy keeps the owner\'s content rules: no prices, no partner brand, no gmail, no "Operating System", nothing commissary-only outside the commissary type', () => {
    // everything a visitor reads, except the commissary type's own option and part
    const strip = JSON.parse(JSON.stringify(V2));
    strip.sections = strip.sections.filter((s) => s.key !== 'commissary');
    strip.sections[0].fields[0].options = strip.sections[0].fields[0].options.filter((o) => o.v !== 'commissary');
    const text = JSON.stringify(strip);
    // no price word and no peso amount ANYWHERE except the client's optional budget question (client-stated bands, not prices): the shared
    // checker (scripts/check-brief-copy.js, ci-invariants CHECK 9) lets exactly that question through — tests/brief-budget.test.mjs pins it
    assert.deepEqual(require('../scripts/check-brief-copy.js').scanDefinition(V2, JSON.parse(read('scripts/brief-budget-bands.json'))), [], 'a price word or a peso amount outside the budget question');
    assert.ok(!/brilliant\s*steel/i.test(JSON.stringify(V2)));
    assert.ok(!/gmail|0960|san fernando|valenzuela|operating system/i.test(JSON.stringify(V2)));
    assert.ok(!/commissar/i.test(text), 'a commissary-specific word outside the commissary type');
    assert.ok(!/\d+\s*\+?\s*projects/i.test(JSON.stringify(V2)), 'a project-count claim');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('validateAnswers — the project brief', () => {
  const v = (a) => cir.validateAnswers(V2, a);
  const bad = (r, re) => { assert.equal(r.ok, false, 'expected a rejection'); assert.ok(r.errors.some((e) => re.test(e)), `no error matched ${re}: ${JSON.stringify(r.errors)}`); };

  it('accepts a complete restaurant brief and keeps the conditional answers', () => {
    const r = v(answersFor('restaurant'));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.clean.project_type, 'restaurant');
    assert.equal(r.clean.seats, 60);
    assert.deepEqual(r.clean.service_style, ['dine_in', 'takeaway'], 'chips are re-ordered into option order');
    assert.deepEqual(r.clean.scope, ['full_kitchen', 'equipment']);
  });

  it('accepts the MINIMAL brief: type, name, one of mobile/email, city, province and one scope item — nothing else', () => {
    const min = { project_type: 'home', name: 'Ana', email: 'ana@example.com', city: 'Pasig', province: 'Metro Manila', scope: ['fabrication'] };
    const r = v(min);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(Object.keys(r.clean).sort(), Object.keys(min).sort());
  });

  it('each of the five common required fields is required', () => {
    for (const [key, label] of [['project_type', 'Project type'], ['name', 'Full name'], ['city', 'City or municipality'], ['province', 'Province or region'], ['scope', 'Scope of work']]) {
      const a = answersFor('restaurant'); delete a[key];
      bad(v(a), new RegExp(`"${label}" is required`));
    }
  });

  it('needs a mobile number OR an email — either one alone is enough, neither is not', () => {
    const a = answersFor('hospital');
    const noPhone = { ...a }; delete noPhone.phone;
    const noEmail = { ...a }; delete noEmail.email;
    const neither = { ...noPhone }; delete neither.email;
    assert.equal(v(noPhone).ok, true);
    assert.equal(v(noEmail).ok, true);
    const r = v(neither);
    bad(r, /^Please give a mobile number or an email address so we can reach you\.$/);
    assert.equal(r.errors.length, 1);
    bad(v({ ...neither, phone: '   ', email: '' }), /mobile number or an email address/);
  });

  it('a malformed phone or email is still rejected on its own', () => {
    bad(v({ ...answersFor('cafe'), phone: 'call me' }), /"Mobile number" is not a valid phone number/);
    bad(v({ ...answersFor('cafe'), email: 'not-an-email' }), /"Email" is not a valid email/);
  });

  it('"Other" must be described; the description is rejected for any other type', () => {
    const a = answersFor('other'); delete a.other_description;
    bad(v(a), /"Describe your project" is required/);
    assert.equal(v(answersFor('other')).ok, true);
    bad(v({ ...answersFor('restaurant'), other_description: 'sneaky' }), /"Describe your project" does not apply to this project type/);
  });

  it('every one of the twelve types validates with its own conditional answers', () => {
    for (const t of TYPES) {
      const r = v(answersFor(t));
      assert.equal(r.ok, true, `${t}: ${JSON.stringify(r.errors)}`);
      assert.equal(r.clean.project_type, t);
      // the conditional answers of ITS part are kept
      for (const f of fieldsOf(sectionFor(t))) assert.ok(f.key in r.clean, `${t}: ${f.key} was dropped`);
    }
  });

  it('a conditional answer is accepted ONLY for the type it belongs to — every other type rejects it, never drops it', () => {
    let checked = 0;
    for (const t of TYPES) {
      for (const other of condSections) {
        if (other.when.in.includes(t)) continue;                       // its own part (or the shared food part) — covered above
        const a = { ...BASE(), project_type: t, ...COND[other.key] };
        // a required field of the part we are NOT in must not be demanded either (the part does not apply)
        const own = sectionFor(t);
        if (own.fields.some((f) => f.required)) Object.assign(a, COND[own.key]);
        const r = v(a);
        assert.equal(r.ok, false, `${t} accepted ${other.key}'s answers`);
        assert.ok(r.errors.every((e) => / does not apply to this project type$/.test(e)), `${t}/${other.key}: ${JSON.stringify(r.errors)}`);
        assert.equal(r.errors.length, fieldsOf(other).length, `${t}/${other.key}: one error per mismatched answer`);
        for (const f of fieldsOf(other)) assert.ok(!(f.key in r.clean), `${t}: ${f.key} leaked into clean`);
        checked++;
      }
    }
    assert.ok(checked >= 12 * 7, `only ${checked} mismatches exercised`);
  });

  it('the shared part (restaurant / café / bakery / catering) serves all four of its types', () => {
    for (const t of ['restaurant', 'cafe', 'bakery', 'catering']) assert.equal(v({ ...BASE(), project_type: t, ...COND.food }).ok, true, t);
  });

  it('even a BLANK answer for another type\'s question is refused (the page never sends one)', () => {
    for (const blank of ['', [], null, 0]) bad(v({ ...answersFor('hospital'), seats: blank }), /"Seats or covers" does not apply to this project type/);
  });

  it('a mismatch is caught whichever way round the type was chosen: no type at all means no conditional part applies', () => {
    const a = answersFor('hospital'); delete a.project_type;
    const r = v(a);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('"Project type" is required'));
    assert.ok(r.errors.some((e) => /"Meals prepared per day" does not apply/.test(e)));
    bad(v({ ...answersFor('hospital'), project_type: 'spaceship' }), /"Project type" has an invalid value/);
  });

  it('rejects unknown keys — including names that exist on Object.prototype', () => {
    bad(v({ ...answersFor('hotel'), totally_bogus: 'x' }), /^Unknown field "totally_bogus"$/);
    for (const k of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__']) {
      bad(v({ ...answersFor('hotel'), [k]: 'x' }), new RegExp(`^Unknown field "${k}"$`));
    }
    const proto = JSON.parse('{"__proto__": {"polluted": true}, "project_type": "hotel", "name": "A", "email": "a@b.co", "city": "C", "province": "P", "scope": ["lpg"]}');
    bad(v(proto), /^Unknown field "__proto__"$/);
    assert.equal({}.polluted, undefined);
    // a key of the OLD form is unknown here
    bad(v({ ...answersFor('hotel'), biz_type: 'Hotel or resort' }), /^Unknown field "biz_type"$/);
  });

  it('a photo "answer" is never accepted (photos travel in their own list)', () => {
    bad(v({ ...answersFor('hotel'), photos: [] }), /^Unknown field "photos"$/);
  });

  it('applies the usual per-type rules inside a conditional part: numbers, selects, chips', () => {
    bad(v({ ...answersFor('restaurant'), seats: -1 }), /"Seats or covers" is out of range/);
    bad(v({ ...answersFor('restaurant'), seats: '60' }), /"Seats or covers" must be a number/);
    bad(v({ ...answersFor('restaurant'), seats: 12.345 }), /too many decimal places/);
    bad(v({ ...answersFor('school'), school_lab_type: 'astrology' }), /"Laboratory type" has an invalid value/);
    bad(v({ ...answersFor('home'), home_items: ['sink', 'jacuzzi'] }), /"What would you like\?" has an unknown option/);
    bad(v({ ...answersFor('home'), home_building: 'castle' }), /"Type of home" has an invalid value/);
    bad(v({ ...answersFor('laboratory'), lab_chemicals: 'maybe' }), /has an invalid value/);
    bad(v({ ...answersFor('restaurant'), cuisine: 'x'.repeat(121) }), /"Cuisine or menu style" is too long/);
  });

  it('applies the usual rules to the common fields: the date, the choices, the lengths', () => {
    bad(v({ ...answersFor('restaurant'), target_date: '2026-02-30' }), /not a valid calendar date/);
    assert.equal(v({ ...answersFor('restaurant'), target_date: '2026-12-01', timeline: 'months_3_6' }).ok, true);
    bad(v({ ...answersFor('restaurant'), site_status: 'dreaming' }), /"Is the project a new build/);
    bad(v({ ...answersFor('restaurant'), material: 'ss202' }), /"Preferred material" has an invalid value/);
    bad(v({ ...answersFor('restaurant'), scope: [] }), /"Scope of work" is required/);
    bad(v({ ...answersFor('restaurant'), scope: ['unobtainium'] }), /"Scope of work" has an unknown option/);
    bad(v({ ...answersFor('restaurant'), city: 'C'.repeat(81) }), /"City or municipality" is too long/);
    bad(v({ ...answersFor('restaurant'), notes: 'n'.repeat(2001) }), /"Notes" is too long/);
  });

  it('strips control characters and trims, and never stores a blank', () => {
    const r = v({ ...answersFor('restaurant'), name: '  Maria\u0000 Santos\u0007  ', company: '   ', notes: 'line one\nline two\u0000' });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.clean.name, 'Maria Santos');
    assert.ok(!('company' in r.clean));
    assert.equal(r.clean.notes, 'line one\nline two');
  });

  it('is not fooled by a non-object body', () => {
    for (const body of [undefined, null, 'x', 5, [], [1]]) assert.equal(v(body).ok, false);
  });

  it('the old form still validates exactly as before (no conditional parts, no requireOneOf)', () => {
    assert.equal(V1.requireOneOf, undefined);
    assert.ok(V1.sections.every((s) => !s.when));
    const r = cir.validateAnswers(V1, { name: 'J', company: 'C', phone: '0917 000 0000', email: 'j@example.com', address: 'A', site_address: 'S' });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    // the same prototype-name hardening applies to it
    assert.ok(cir.validateAnswers(V1, { name: 'J', company: 'C', phone: '0917 000 0000', email: 'j@example.com', address: 'A', site_address: 'S', constructor: 1 }).errors.includes('Unknown field "constructor"'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('sectionApplies / getForm / noticeFor', () => {
  it('sectionApplies follows `when` and nothing else', () => {
    const hospital = sectionFor('hospital'), food = sectionFor('cafe');
    assert.equal(cir.sectionApplies({ fields: [] }, {}), true, 'no `when` always applies');
    assert.equal(cir.sectionApplies(hospital, { project_type: 'hospital' }), true);
    assert.equal(cir.sectionApplies(hospital, { project_type: 'hotel' }), false);
    assert.equal(cir.sectionApplies(hospital, {}), false);
    assert.equal(cir.sectionApplies(hospital, { project_type: ['hospital'] }), false, 'a non-string controlling answer never matches');
    assert.equal(cir.sectionApplies(food, { project_type: 'bakery' }), true);
    assert.equal(cir.sectionApplies(food, undefined), false);
  });

  it('getForm returns own keys only — never an inherited Object.prototype member', () => {
    assert.equal(cir.getForm('project_brief_v2'), V2);
    assert.equal(cir.getForm('commissary_brief'), V1);
    for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', '', 'nope', undefined, null, 5, {}, ['project_brief_v2']]) assert.equal(cir.getForm(bad), null, String(bad));
  });

  it('noticeFor knows the current and the original notice, records the hash of THAT text, and nothing else', () => {
    const cur = cir.noticeFor(PRIVACY_NOTICE.version);
    assert.deepEqual(cur, { version: '2026-10-22.1', sha256: cir.privacyNoticeSha256() });
    assert.equal(cur.sha256, sha(JSON.stringify(PRIVACY_NOTICE.sections)));
    const old = cir.noticeFor('2026-09-26.1');
    assert.equal(old.sha256, sha(JSON.stringify(NOTICES['2026-09-26.1'].sections)));
    assert.notEqual(old.sha256, cur.sha256);
    for (const bad of ['2026-09-26', '2026-10-22.2', '', 'constructor', '__proto__', 'toString', undefined, null, 7, {}]) assert.equal(cir.noticeFor(bad), null, String(bad));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('buildSummary / buildNotification — the list and the push', () => {
  const clean = () => cir.validateAnswers(V2, answersFor('hospital', { target_date: '2026-12-01', timeline: 'months_3_6' })).clean;

  it('stores LABELS for a select (not its key), joins the location, prefers the exact date', () => {
    const s = cir.buildSummary(V2, clean(), 3);
    assert.deepEqual(s, {
      name: 'Maria Santos', company: 'Santos Foods', phone: '0917 123 4567', email: 'maria@example.com',
      bizType: 'Hospital or clinic', siteAddress: 'Near the Tandang Sora flyover', location: 'Quezon City, Metro Manila', targetDate: '2026-12-01', budget: '', photoCount: 3,
    });
    assert.equal(s.budget, '', 'no budget answered: an empty label, not a missing key');
  });

  it('falls back to the timeline label when there is no exact date, and to \'\' when there is neither', () => {
    const c = clean(); delete c.target_date;
    assert.equal(cir.buildSummary(V2, c, 0).targetDate, '3 to 6 months');
    delete c.timeline;
    assert.equal(cir.buildSummary(V2, c, 0).targetDate, '');
  });

  it('joins only the parts that are there; an unknown spec becomes \'\' (never undefined / [object Object])', () => {
    assert.equal(cir.buildSummary(V2, { city: 'Cebu City' }, 0).location, 'Cebu City');
    assert.equal(cir.buildSummary(V2, { province: 'Cebu' }, 0).location, 'Cebu');
    assert.equal(cir.buildSummary(V2, {}, 0).location, '');
    assert.equal(cir.buildSummary({ summaryKeys: { x: { nonsense: true }, y: 'missing' } }, { missing: undefined }, 0).x, '');
    assert.equal(cir.buildSummary({ summaryKeys: { y: 'missing' } }, {}, 0).y, '');
  });

  it('renders a chips value as its labels when asked for one', () => {
    const def = { sections: [{ fields: [{ key: 'scope', type: 'chips', options: [{ v: 'a', l: 'Alpha' }, { v: 'b', l: 'Beta' }] }] }], summaryKeys: { what: 'scope' } };
    assert.equal(cir.buildSummary(def, { scope: ['a', 'b'] }, 0).what, 'Alpha, Beta');
  });

  it('the push names the project type and the location — never a price, never markup', () => {
    const doc = { refNo: 'CIR-261022-ABCDEF', summary: cir.buildSummary(V2, clean(), 2) };
    const n = cir.buildNotification(doc);
    assert.equal(n.title, '📥 New client brief — Santos Foods');
    assert.equal(n.body, 'Maria Santos · Hospital or clinic · Quezon City, Metro Manila · Ref CIR-261022-ABCDEF. Open Sales → Briefs.');
    assert.deepEqual([n.icon, n.type, n.link], ['📥', 'client_info_request', 'dept:Sales']);
  });

  it('an answered budget band is in the summary as its LABEL — and the push still names the location, never the budget', () => {
    const c = cir.validateAnswers(V2, answersFor('hospital', { budget: '1m_to_3m' })).clean;
    const s = cir.buildSummary(V2, c, 0);
    assert.equal(s.budget, '₱1,000,000 – ₱3,000,000');
    const n = cir.buildNotification({ refNo: 'CIR-261022-ABCDEF', summary: s });
    assert.equal(n.body, 'Maria Santos · Hospital or clinic · Quezon City, Metro Manila · Ref CIR-261022-ABCDEF. Open Sales → Briefs.');
    assert.ok(!/₱|budget/i.test(n.title + n.body), 'a lock-screen push must not carry the client\'s budget');
  });

  it('a hostile company, name or place cannot put markup into the push', () => {
    const c = clean(); c.company = '<script>alert(1)</script>'; c.name = '<img src=x onerror=alert(1)>'; c.city = '<b>x</b>';
    const n = cir.buildNotification({ refNo: 'CIR-261022-ABCDEF', summary: cir.buildSummary(V2, c, 0) });
    assert.ok(!n.title.includes('<') && !n.body.includes('<'));
  });

  it('a v1 brief (no location) still shows its budget, so the push for an old page is unchanged', () => {
    const c = cir.validateAnswers(V1, { name: 'J', company: 'C', phone: '0917 000 0000', email: 'j@example.com', address: 'A', site_address: 'S', biz_type: 'Hotel or resort', budget: 'Below ₱1M' }).clean;
    const n = cir.buildNotification({ refNo: 'CIR-261022-ABCDEF', summary: cir.buildSummary(V1, c, 0) });
    assert.equal(n.body, 'J · Hotel or resort · Below ₱1M · Ref CIR-261022-ABCDEF. Open Sales → Briefs.');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('functions/index.js — only own-key lookups reach the form and notice tables', () => {
  const src = read('functions/index.js');
  const start = src.indexOf("exports.cirStartDraft");
  const end = src.indexOf("exports.cirAdminDelete");
  const block = src.slice(start, end);

  it('no callable indexes cir.FORMS directly (an id like "constructor" would resolve to Object.prototype\'s member)', () => {
    assert.ok(start > 0 && end > start);
    assert.ok(!/cir\.FORMS\s*\[/.test(block), 'cir.FORMS[...] in a callable — use cir.getForm()');
    assert.equal((block.match(/cir\.getForm\(/g) || []).length, 4, 'start, submit, and the two draft re-reads in upload');
  });

  it('cirSubmit records the consent against the notice version it was given for', () => {
    assert.match(block, /const notice = cir\.noticeFor\(consent\.noticeVersion\)/);
    assert.match(block, /noticeVersion: notice\.version,\s*\n\s*noticeSha256: notice\.sha256,/);
    assert.ok(!/cir\.PRIVACY_NOTICE\.version/.test(block), 'the notice check must not compare against the current version only');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  The REAL callables against the in-memory Firestore and an in-memory Storage bucket (no emulator, no network).
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const HAVE_DEPS = fs.existsSync(path.join(ROOT, 'functions', 'node_modules', 'firebase-functions', 'package.json'));
const SKIP = HAVE_DEPS ? false : 'functions/node_modules is not installed (firebase-functions missing)';
const { createFake } = require('./fixtures/fake-firestore.cjs');
const fake = createFake();
const T0 = Date.UTC(2026, 9, 22, 2, 0, 0);          // 2026-10-22 10:00 Manila

function makeBucket() {
  const files = new Map();
  return {
    files,
    file(p) {
      return {
        async save(buf, opts) { files.set(p, { buf: Buffer.from(buf), opts }); },
        async move(to) { if (!files.has(p)) throw new Error(`No such object: ${p}`); files.set(to, files.get(p)); files.delete(p); },
        async delete() { files.delete(p); },
      };
    },
    async deleteFiles({ prefix }) { for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k); },
  };
}
function loadFunctions() {
  const idx = require.resolve('../functions/index.js');
  delete require.cache[idx];
  const orig = Module._load;
  Module._load = function (request) { if (request === 'firebase-admin') return fake.admin; return orig.apply(this, arguments); };
  try { return require(idx); } finally { Module._load = orig; }
}
const ctx = (ip) => ({ rawRequest: { headers: { 'x-forwarded-for': ip || '198.51.100.7', 'user-agent': 'brief-test-agent', 'accept-language': 'en-PH', referer: 'https://barroindustries.com/sales/clientinformationrequest/' } } });
const rejectsWith = async (p, code, re) => {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`); if (re) assert.match(e.message, re); return true; });
};
function jpegDataUrl(n, fill) {
  const buf = Buffer.alloc(n, fill || 0x11);
  buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF; buf[n - 2] = 0xFF; buf[n - 1] = 0xD9;
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

describe('the real callables accept the project brief', { skip: SKIP }, () => {
  let fns, bucket;
  const tick = (ms) => mock.timers.tick(ms);
  const FILL = 20000;                                       // past LIMITS.minFillMs (15 s)

  beforeEach(() => {
    mock.timers.enable({ apis: ['Date'], now: T0 });
    fake.reset();
    bucket = makeBucket();
    fake.admin.storage = () => ({ bucket: () => bucket });
    fake.seed('users/u_pres', { role: 'president', displayName: 'Pres' });
    fake.seed('users/u_sales1', { role: 'employee', department: 'Sales', displayName: 'Sales One' });
    fake.seed('users/u_partner', { role: 'partner', departments: ['Sales'], displayName: 'Partner' });
    fns = loadFunctions();
  });
  afterEach(() => { mock.timers.reset(); });

  const start = async (ip, formId) => (await fns.cirStartDraft.run({ formId: formId || 'project_brief_v2' }, ctx(ip))).draftToken;
  const upload = (token, ip, group, bytes) => fns.cirUploadPhoto.run({ draftToken: token, group: group || 'site', caption: '', dataUrl: jpegDataUrl(bytes || 5000), width: 1600, height: 1200 }, ctx(ip));
  const payload = (token, over) => ({
    draftToken: token, formId: 'project_brief_v2', formVersion: 1, answers: answersFor('restaurant'), photos: [],
    consent: { agreed: true, noticeVersion: PRIVACY_NOTICE.version }, honeypot: '', fillMs: 90000, ...(over || {}),
  });
  const docs = () => fake.list('client_info_requests');

  it('cirStartDraft starts a draft for each form it knows — and for no other id', async () => {
    const t2 = await start('198.51.100.1', 'project_brief_v2');
    const t1 = await start('198.51.100.1', 'commissary_brief');
    assert.match(t2, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(fake.read(`cir_drafts/${portal.tokenHash(t2)}`).formId, 'project_brief_v2');
    assert.equal(fake.read(`cir_drafts/${portal.tokenHash(t1)}`).formId, 'commissary_brief');
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'nope', '', undefined, 5]) {
      await rejectsWith(fns.cirStartDraft.run({ formId: id }, ctx('198.51.100.2')), 'invalid-argument', /Unknown form/);
    }
    assert.equal(fake.list('cir_drafts').length, 2, 'a refused id must not create a draft');
  });

  it('a restaurant brief with two photos: stored under its own formId, labelled summary, photos moved, Sales + the President told', async () => {
    const ip = '198.51.100.10';
    const token = await start(ip);
    const a = await upload(token, ip, 'site'), b = await upload(token, ip, 'kitchen');
    assert.deepEqual([a.photoCount, b.photoCount], [1, 2]);
    tick(FILL);
    const res = await fns.cirSubmit.run(payload(token, { answers: answersFor('restaurant', { target_date: '2026-12-01' }), photos: [{ photoId: a.photoId, group: 'site', caption: 'Front of the shop' }, { photoId: b.photoId, group: 'kitchen', caption: '' }] }), ctx(ip));
    assert.match(res.refNo, /^CIR-261022-[A-Z2-9]{6}$/);
    assert.equal(res.submittedOnManila, '2026-10-22');
    const d = fake.read(`client_info_requests/${res.refNo}`);
    assert.deepEqual([d.formId, d.formVersion, d.status], ['project_brief_v2', 1, 'new']);
    assert.equal(d.answers.project_type, 'restaurant');
    assert.equal(d.answers.seats, 60);
    assert.deepEqual(d.summary, {
      name: 'Maria Santos', company: 'Santos Foods', phone: '0917 123 4567', email: 'maria@example.com', bizType: 'Restaurant',
      siteAddress: 'Near the Tandang Sora flyover', location: 'Quezon City, Metro Manila', targetDate: '2026-12-01', budget: '', photoCount: 2,
    });
    assert.deepEqual(d.consent.agreed, true);
    assert.equal(d.consent.noticeVersion, '2026-10-22.1');
    assert.equal(d.consent.noticeSha256, cir.privacyNoticeSha256());
    // photos: moved out of the draft prefix into the brief's own folder, caption kept, no URL stored
    assert.deepEqual(d.photos.map((p) => [p.group, p.caption, p.path.startsWith(`client-info-requests/${res.refNo}/`)]), [['site', 'Front of the shop', true], ['kitchen', '', true]]);
    assert.ok(d.photos.every((p) => !JSON.stringify(p).includes('http')));
    assert.deepEqual([...bucket.files.keys()].sort(), d.photos.map((p) => p.path).sort());
    // notifications: Sales + President, partner dropped, no senderUid, plain-text
    const uids = fake.paths('notifications/').map((p) => p.split('/')[1]);
    assert.deepEqual([...new Set(uids)].sort(), ['u_pres', 'u_sales1']);
    const n = fake.read(fake.paths('notifications/u_pres/')[0]);
    assert.equal(n.body, `Maria Santos · Restaurant · Quezon City, Metro Manila · Ref ${res.refNo}. Open Sales → Briefs.`);
    assert.ok(!('senderUid' in n));
  });

  it('a hospital brief and a school-with-laboratory brief are stored with their own conditional answers', async () => {
    for (const [i, type] of [[11, 'hospital'], [12, 'school'], [13, 'laboratory'], [14, 'government'], [15, 'home'], [16, 'other']]) {
      const ip = `198.51.100.${i}`;
      const token = await start(ip);
      tick(FILL);
      const res = await fns.cirSubmit.run(payload(token, { answers: answersFor(type, { email: `p${i}@example.com` }) }), ctx(ip));
      const d = fake.read(`client_info_requests/${res.refNo}`);
      assert.equal(d.answers.project_type, type);
      for (const f of fieldsOf(sectionFor(type))) assert.ok(f.key in d.answers, `${type}: ${f.key}`);
      assert.equal(d.summary.bizType, optLabel(byKey(V2, 'project_type'), type));
    }
    assert.equal(docs().length, 6);
  });

  it('a brief with a budget band stores the band KEY as the answer and its LABEL in the summary; the push never carries it; a value off the list is refused', async () => {
    const ip = '198.51.100.17';
    const token = await start(ip);
    tick(FILL);
    const res = await fns.cirSubmit.run(payload(token, { answers: answersFor('restaurant', { budget: '1m_to_3m' }) }), ctx(ip));
    const d = fake.read(`client_info_requests/${res.refNo}`);
    assert.equal(d.answers.budget, '1m_to_3m');
    assert.equal(d.summary.budget, '₱1,000,000 – ₱3,000,000');
    const n = fake.read(fake.paths('notifications/u_pres/')[0]);
    assert.ok(!/₱|budget/i.test(n.title + n.body), 'a lock-screen push must not carry the client\'s budget');
    // the server takes the budget ONLY from its list of keys: a label, a free amount, another form's wording and anything that merely
    // looks like a key are refused (nothing stored, nothing moved)
    let i = 40;
    for (const bad of ['₱1,000,000 – ₱3,000,000', '2000000', 'Below ₱1M', 'UNDER_500K', ' under_500k', 'constructor', '__proto__']) {
      const ip2 = `198.51.100.${i++}`;
      const t2 = await start(ip2);
      tick(FILL);
      await rejectsWith(fns.cirSubmit.run(payload(t2, { answers: answersFor('restaurant', { budget: bad, email: `b${i}@example.com` }) }), ctx(ip2)), 'invalid-argument', /"Approximate budget \(optional\)" has an invalid value/);
    }
    assert.equal(docs().length, 1, 'a refused budget must write nothing');
  });

  it('a budget that is not even text (a number, a list, an object) is never stored: like every optional select it is read as "not answered"', async () => {
    let i = 60;
    for (const junk of [3, ['under_500k'], { v: 'under_500k' }, null, true]) {
      const ip = `198.51.100.${i++}`;
      const t = await start(ip);
      tick(FILL);
      const res = await fns.cirSubmit.run(payload(t, { answers: answersFor('restaurant', { budget: junk, email: `j${i}@example.com` }) }), ctx(ip));
      const d = fake.read(`client_info_requests/${res.refNo}`);
      assert.ok(!('budget' in d.answers), `a ${typeof junk} budget reached the stored answers`);
      assert.equal(d.summary.budget, '');
    }
  });

  it('rejects a conditional answer for the wrong type, an unknown key, a missing scope and no contact — and writes / moves / notifies nothing', async () => {
    const ip = '198.51.100.20';
    const token = await start(ip);
    const up = await upload(token, ip);
    tick(FILL);
    const photos = [{ photoId: up.photoId, group: 'site', caption: '' }];
    const before = [...bucket.files.keys()];
    const cases = [
      [{ ...answersFor('hospital'), seats: 40 }, /"Seats or covers" does not apply to this project type/],
      [{ ...answersFor('restaurant'), totally_bogus: 1 }, /Unknown field "totally_bogus"/],
      [{ ...answersFor('restaurant'), constructor: 'x' }, /Unknown field "constructor"/],
      [{ ...answersFor('restaurant'), scope: [] }, /"Scope of work" is required/],
      [(() => { const a = answersFor('restaurant'); delete a.phone; delete a.email; return a; })(), /mobile number or an email address/],
      [(() => { const a = answersFor('other'); delete a.other_description; return a; })(), /"Describe your project" is required/],
    ];
    // every submit call counts against its IP's bucket (5 a day, by design), so each attempt comes from its own address
    for (const [i, [answers, re]] of cases.entries()) await rejectsWith(fns.cirSubmit.run(payload(token, { answers, photos }), ctx(`198.51.100.${100 + i}`)), 'invalid-argument', re);
    assert.deepEqual(docs(), [], 'a rejected brief must not be stored');
    assert.deepEqual(fake.paths('notifications/'), []);
    assert.deepEqual([...bucket.files.keys()], before, 'the draft photo must stay where it was');
    assert.equal(fake.read(`cir_drafts/${portal.tokenHash(token)}`).submittedAt, null, 'the draft must stay open so the visitor can fix the form');
    // a mismatch and an unknown key are logged (the page never sends either); a plain "required" is not
    const kinds = fake.list('cir_abuse').map((x) => x.data.kind);
    assert.equal(kinds.filter((k) => k === 'bad_payload').length, 3);
    // …and the draft is still good: the same session submits once the form is right
    const ok = await fns.cirSubmit.run(payload(token, { photos }), ctx(ip));
    assert.match(ok.refNo, /^CIR-/);
  });

  it('refuses a draft opened for one form being used to submit the other', async () => {
    const ip = '198.51.100.21';
    const token = await start(ip, 'project_brief_v2');
    tick(FILL);
    await rejectsWith(fns.cirSubmit.run({ ...payload(token), formId: 'commissary_brief', formVersion: 1, answers: { name: 'J', company: 'C', phone: '0917 000 0000', email: 'j@example.com', address: 'A', site_address: 'S' } }, ctx(ip)), 'failed-precondition', /session expired/);
    assert.deepEqual(docs(), []);
  });

  it('checks the form version, the consent, and an unknown notice version', async () => {
    const ip = '198.51.100.22';
    const token = await start(ip);
    tick(FILL);
    await rejectsWith(fns.cirSubmit.run(payload(token, { formVersion: 2 }), ctx(ip)), 'failed-precondition', /form was updated/);
    await rejectsWith(fns.cirSubmit.run(payload(token, { consent: { agreed: false, noticeVersion: PRIVACY_NOTICE.version } }), ctx(ip)), 'invalid-argument', /consent/);
    for (const v of ['2025-01-01.1', 'constructor', '', undefined]) {
      await rejectsWith(fns.cirSubmit.run(payload(token, { consent: { agreed: true, noticeVersion: v } }), ctx(ip)), 'failed-precondition', /privacy notice was updated/);
    }
    assert.deepEqual(docs(), []);
  });

  it('too fast (the 15 s floor) or a filled honeypot gets a plausible fake success and nothing is stored', async () => {
    const ip = '198.51.100.23';
    const token = await start(ip);
    tick(5000);
    const fast = await fns.cirSubmit.run(payload(token), ctx(ip));
    assert.match(fast.refNo, /^CIR-261022-/);
    assert.deepEqual(docs(), []);
    assert.deepEqual(fake.paths('notifications/'), []);
    const t2 = await start('198.51.100.24');
    tick(FILL);
    const trap = await fns.cirSubmit.run(payload(t2, { honeypot: 'http://spam.example' }), ctx('198.51.100.24'));
    assert.match(trap.refNo, /^CIR-261022-/);
    assert.deepEqual(docs(), []);
  });

  it('the duplicate guard still holds on a brief with only an email (no phone)', async () => {
    const mk = async (ip) => { const t = await start(ip); tick(FILL); return t; };
    const a = answersFor('cafe'); delete a.phone;
    const t1 = await mk('198.51.100.25');
    await fns.cirSubmit.run(payload(t1, { answers: a }), ctx('198.51.100.25'));
    const t2 = await mk('198.51.100.26');
    await rejectsWith(fns.cirSubmit.run(payload(t2, { answers: a }), ctx('198.51.100.26')), 'already-exists', /already received/);
    assert.equal(docs().length, 1);
  });

  it('the Photos part behaves as before: group is checked against the form, size caps hold, a removed photo is deleted', async () => {
    const ip = '198.51.100.27';
    const token = await start(ip);
    await rejectsWith(upload(token, ip, 'basement'), 'invalid-argument', /Invalid photo group/);
    for (const g of ['site', 'kitchen', 'equipment', 'docs']) await upload(token, ip, g);
    await rejectsWith(fns.cirUploadPhoto.run({ draftToken: token, group: 'site', caption: '', dataUrl: jpegDataUrl(LIMITS.maxPhotoBytes + 10), width: 1, height: 1 }, ctx(ip)), 'invalid-argument');
    await rejectsWith(fns.cirUploadPhoto.run({ draftToken: token, group: 'site', caption: '', dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 }, ctx(ip)), 'invalid-argument');
    const d0 = fake.read(`cir_drafts/${portal.tokenHash(token)}`);
    assert.equal(d0.photoCount, 4);
    const [first] = Object.keys(d0.photos);
    const rem = await fns.cirRemovePhoto.run({ draftToken: token, photoId: first }, ctx(ip));
    assert.deepEqual([rem.removed, rem.photoCount], [true, 3]);
    assert.equal(bucket.files.size, 3);
    assert.equal((await fns.cirRemovePhoto.run({ draftToken: token, photoId: first }, ctx(ip))).removed, false, 'idempotent');
  });

  it('a photo the draft never held cannot be attached, and a photo from another session cannot be claimed', async () => {
    const ipA = '198.51.100.28', ipB = '198.51.100.29';
    const tA = await start(ipA), tB = await start(ipB);
    const pA = await upload(tA, ipA);
    tick(FILL);
    await rejectsWith(fns.cirSubmit.run(payload(tB, { photos: [{ photoId: pA.photoId, group: 'site', caption: '' }] }), ctx(ipB)), 'invalid-argument', /not found in your upload session/);
    await rejectsWith(fns.cirSubmit.run(payload(tA, { photos: [{ photoId: pA.photoId, group: 'docs', caption: '' }] }), ctx(ipA)), 'invalid-argument', /group does not match/);
    assert.deepEqual(docs(), []);
  });

  it('the ORIGINAL form still submits — with the original notice version AND with the current one — each recorded against its own text', async () => {
    const v1Answers = { name: 'Joseph Asis', company: 'Chibab Foods', phone: '0917 000 0000', email: 'j@example.com', address: '1 Main St', site_address: '2 Site Rd', biz_type: 'Hotel or resort', budget: '₱1M – ₱3M', target_date: '2026-12-01', scope: ['Exhaust hood and ducting'] };
    const submit = async (ip, noticeVersion, email) => {
      const t = await start(ip, 'commissary_brief');
      tick(FILL);
      return fns.cirSubmit.run({ draftToken: t, formId: 'commissary_brief', formVersion: 1, answers: { ...v1Answers, email }, photos: [], consent: { agreed: true, noticeVersion }, honeypot: '', fillMs: 1 }, ctx(ip));
    };
    const old = await submit('198.51.100.30', '2026-09-26.1', 'old@example.com');
    const cur = await submit('198.51.100.31', PRIVACY_NOTICE.version, 'cur@example.com');
    const dOld = fake.read(`client_info_requests/${old.refNo}`), dCur = fake.read(`client_info_requests/${cur.refNo}`);
    assert.deepEqual([dOld.formId, dOld.consent.noticeVersion, dOld.consent.noticeSha256], ['commissary_brief', '2026-09-26.1', cir.noticeFor('2026-09-26.1').sha256]);
    assert.deepEqual([dCur.formId, dCur.consent.noticeVersion, dCur.consent.noticeSha256], ['commissary_brief', '2026-10-22.1', cir.privacyNoticeSha256()]);
    assert.equal(dOld.summary.bizType, 'Hotel or resort');
    assert.equal(dOld.summary.budget, '₱1M – ₱3M');
    assert.ok(!('location' in dOld.summary), 'a v1 summary has no location');
    // and the v1 push still carries its budget
    const n = fake.read(fake.paths('notifications/u_pres/')[0]);
    assert.match(n.body, /Hotel or resort · ₱1M – ₱3M · Ref CIR-/);
  });

  it('the old form does not accept a project-brief answer, and the new form does not accept an old key', async () => {
    const ip = '198.51.100.32';
    const t1 = await start(ip, 'commissary_brief');
    tick(FILL);
    await rejectsWith(fns.cirSubmit.run({ draftToken: t1, formId: 'commissary_brief', formVersion: 1, answers: { name: 'J', company: 'C', phone: '0917 000 0000', email: 'j@example.com', address: 'A', site_address: 'S', project_type: 'hotel' }, photos: [], consent: { agreed: true, noticeVersion: PRIVACY_NOTICE.version }, honeypot: '', fillMs: 1 }, ctx(ip)), 'invalid-argument', /Unknown field "project_type"/);
    const t2 = await start('198.51.100.33');
    tick(FILL);
    await rejectsWith(fns.cirSubmit.run(payload(t2, { answers: { ...answersFor('hotel'), biz_type: 'Hotel or resort' } }), ctx('198.51.100.33')), 'invalid-argument', /Unknown field "biz_type"/);
  });
});
