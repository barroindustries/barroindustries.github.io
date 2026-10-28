// tests/cir-staff-briefs.test.mjs — Sales › Briefs (js/screens/client-info-requests.js) with the TWO form versions (2026-10-22).
//
// The staff screen walks the form definition a brief was submitted under (`sub.formId`), generically. With the project brief
// (project_brief_v2) a brief has ONE conditional part for its project type, so the walker must show only the parts that apply, number
// them in order, show the PROJECT TYPE prominently (in the list and in the detail), and keep Convert-to-client and Prefill Quote Builder
// working for both versions — while every brief already stored under the old commissary form renders exactly as it did.
//
// The real screen file runs here inside a node:vm context with the app's real escHtml / safeHttpUrl (extracted from js/modules.js) and
// small stand-ins for Firestore, Storage and the app's helpers — no browser, no network. Every value on a brief is attacker-controlled
// (an open public form), so the hostile cases assert that nothing a visitor typed ever becomes markup.
//
// Mutation-tested in a scratch copy, never the shared tree.
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const cir = require('../functions/cir-core.js');
const { FORMS, NOTICES, PRIVACY_NOTICE } = cir;
const V1 = FORMS.commissary_brief, V2 = FORMS.project_brief_v2;

// JavaScript with its comments removed (string-aware). Arrays and objects made inside a vm context have that realm's prototypes, so
// results are compared through a JSON round trip.
function stripJsComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += d || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '\'' || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; out += ' '; continue; }
    out += c; i++;
  }
  return out;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

// ── the real helpers the screen depends on, lifted from js/modules.js ────────────────────────────────────────────────────────────────
const modules = read('js/modules.js');
const lift = (name) => modules.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`))[0];

function load({ role = 'president', depts = ['Sales'] } = {}) {
  const log = [];
  const ctx = vm.createContext({ console, Intl, Date, JSON, Object, Array, Promise, URL, encodeURIComponent, Number, String, Math, isFinite, parseInt });
  ctx.window = ctx;
  ctx.document = { getElementById: () => null, querySelectorAll: () => [] };
  ctx.window.currentRole = role; ctx.window.currentDepts = depts;
  ctx.window.currentUser = { uid: 'u1', email: 'staff@example.test' }; ctx.window.userProfile = { displayName: 'Staff One' };
  ctx.window.location = { origin: 'https://barroindustries.com' };
  vm.runInContext(lift('escHtml') + '\n' + lift('safeHttpUrl') + '\nwindow.escHtml = escHtml; window.safeHttpUrl = safeHttpUrl;', ctx);
  ctx.window.bizDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  ctx.window.emojiIcon = (g) => `[${g}]`;
  ctx.emojiIcon = ctx.window.emojiIcon;
  ctx.window.renderEmptyState = (o) => `<div class="empty">${o.title}</div>`;
  ctx.window.skeletonHtml = () => '<div class="skeleton"></div>';
  ctx.window.Notifs = { showToast: (m, t) => log.push(['toast', t, m]) }; ctx.Notifs = ctx.window.Notifs;
  ctx.window.logAudit = (...a) => log.push(['audit', ...a]);
  ctx.window.dbCacheInvalidate = (k) => log.push(['invalidate', k]); ctx.dbCacheInvalidate = ctx.window.dbCacheInvalidate;
  ctx.window.confirmDialog = async () => true;
  ctx.window.clientNameKey = (n) => String(n).toLowerCase();
  ctx.window.Clients = { findByName: async () => null };
  ctx.window.navigateTo = (p) => log.push(['navigateTo', p]); ctx.navigateTo = ctx.window.navigateTo;
  ctx.window.buildLetterhead = (o) => { log.push(['letterhead', o]); return { headerHTML: '<hdr/>', footerHTML: '<ftr/>', printCSS: '' }; };
  ctx.window.openPrintableDoc = (o) => log.push(['print', o]);
  ctx.window.openFilePreview = (f) => log.push(['preview', f]);
  ctx.storage = { ref: (p) => ({ getDownloadURL: async () => 'https://storage.example.test/' + encodeURIComponent(p) }) };
  const writes = { added: [], updated: [] };
  ctx.db = { collection: (name) => ({
    add: async (d) => { writes.added.push([name, d]); return { id: 'client_new' }; },
    doc: (id) => ({ update: async (u) => { writes.updated.push([name, id, u]); }, get: async () => ({ exists: false }), collection: () => ({ get: async () => ({ docs: [] }), orderBy: () => ({ get: async () => ({ docs: [] }) }) }) }),
  }) };
  ctx.firebase = { firestore: { FieldValue: { serverTimestamp: () => '<ts>', arrayUnion: (...a) => ({ arrayUnion: a }) } }, app: () => ({ functions: () => ({ httpsCallable: (n) => async (d) => { log.push(['callable', n, d]); return { data: { ok: true } }; } }) }) };
  vm.runInContext(read('js/cir-forms.js'), ctx, { filename: 'js/cir-forms.js' });
  vm.runInContext(read('js/screens/client-info-requests.js'), ctx, { filename: 'js/screens/client-info-requests.js' });
  const run = (code) => vm.runInContext(code, ctx);
  return { ctx, log, writes, run, call: (name, ...args) => { ctx.__args = args; return vm.runInContext(`${name}(...__args)`, ctx); } };
}

// ── fixtures: a brief exactly as the server stores it ────────────────────────────────────────────────────────────────────────────────
const NOW = { toDate: () => new Date('2026-10-22T02:00:00Z'), toMillis: () => Date.parse('2026-10-22T02:00:00Z') };
const BASE = { project_type: 'hospital', name: 'Dr. Ana Reyes', position: 'Administrator', company: 'Reyes Medical Centre', phone: '0917 555 0101', email: 'ana@example.test',
  city: 'Cebu City', province: 'Cebu', site_address: 'Near the old market', site_status: 'renovation', scope: ['full_kitchen', 'exhaust'],
  hosp_meals: 900, hosp_patients: 150, hosp_diets: ['diabetic', 'tray_line'], timeline: 'months_6_12', notes: 'Public hospital.\nBidding.' };
// (an override of `undefined` REMOVES that answer: a present-but-blank key for another type's part would be rejected by the server)
const merged = (base, over) => { const m = Object.assign({}, base, over); Object.keys(m).forEach((k) => { if (m[k] === undefined) delete m[k]; }); return m; };
function v2Brief(over = {}, summaryOver = {}) {
  const v = cir.validateAnswers(V2, merged(BASE, over));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return { id: 'CIR-261022-ABCDEF', refNo: 'CIR-261022-ABCDEF', formId: 'project_brief_v2', formVersion: 1, status: 'new', createdAt: NOW, submittedOnManila: '2026-10-22',
    summary: Object.assign(cir.buildSummary(V2, v.clean, 2), summaryOver), answers: v.clean,
    photos: [{ photoId: 'p_aaaaaaaaaaaa', group: 'site', caption: 'Front', path: 'client-info-requests/CIR-261022-ABCDEF/p_aaaaaaaaaaaa.jpg', bytes: 5000, width: 800, height: 600 }],
    consent: { agreed: true, noticeVersion: PRIVACY_NOTICE.version, consentedAt: NOW }, client: { ip: '203.0.113.9', userAgent: 'x' } };
}
function v1Brief(over = {}) {
  const answers = Object.assign({ name: 'Joseph Asis', position: 'Owner', company: 'Chibab Foods', phone: '0917 000 0000', email: 'j@example.test', address: '1 Main St, Quezon City', site_address: '2 Site Rd, Valenzuela City',
    biz_type: 'Hotel or resort', budget: '₱1M – ₱3M', target_date: '2026-12-01', scope: ['Exhaust hood and ducting', 'Installation and commissioning'] }, over);
  const v = cir.validateAnswers(V1, merged({}, answers));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return { id: 'CIR-260927-ZZZZZZ', refNo: 'CIR-260927-ZZZZZZ', formId: 'commissary_brief', formVersion: 1, status: 'new', createdAt: NOW, submittedOnManila: '2026-09-27',
    summary: cir.buildSummary(V1, v.clean, 0), answers: v.clean, photos: [], consent: { agreed: true, noticeVersion: '2026-09-26.1', consentedAt: NOW }, client: {} };
}
const titles = (html) => [...html.matchAll(/<h4[^>]*>([^<]*)<\/h4>/g)].map((m) => m[1]);
const TYPES = V2.sections[0].fields[0].options.map((o) => o.v);
const condSections = V2.sections.filter((s) => s.when);

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Sales › Briefs — the project brief renders its own parts, numbered, with the type first', () => {
  const S = load();

  it('applies a section by the SAME rule the server validated it with (a differential check over every type and every part)', () => {
    for (const t of TYPES) {
      for (const sec of V2.sections) {
        const a = { project_type: t };
        assert.equal(S.call('_cirSectionApplies', sec, a), cir.sectionApplies(sec, a), `${t} / ${sec.key}`);
      }
    }
    assert.equal(S.call('_cirSectionApplies', condSections[0], undefined), cir.sectionApplies(condSections[0], undefined));
    assert.equal(S.call('_cirSectionApplies', condSections[0], { project_type: ['restaurant'] }), false);
  });

  it('shows ONLY the part for the brief\'s own type — one conditional part of nine — and numbers the parts 1…9 in order', () => {
    for (const t of TYPES) {
      const own = condSections.find((s) => s.when.in.includes(t));
      const cond = { restaurant: { cuisine: 'Grill' }, commissary: { outlets_now: 3 }, hotel: { hotel_rooms: 80 }, hospital: { hosp_meals: 900 }, school: { school_meals: 500 }, laboratory: { lab_stations: 8 }, government: { gov_served: 300 }, home: { home_kitchen: 'outdoor' }, other: { other_description: 'A food cart' } }[own.key === 'food' ? 'restaurant' : own.key];
      const sub = v2Brief(Object.assign({ project_type: t, hosp_meals: undefined, hosp_patients: undefined, hosp_diets: undefined }, cond));
      const html = S.call('cirRenderAnswers', S.ctx.CIR_FORMS.project_brief_v2, sub, 'screen');
      const ts = titles(html);
      assert.equal(ts.length, 9, `${t}: ${ts.length} parts`);
      ts.forEach((x, i) => assert.ok(x.startsWith(`${i + 1}. `), `${t}: part ${i + 1} is "${x}"`));
      assert.ok(ts.includes(`4. ${own.title}`), `${t}: the 4th part must be "${own.title}", got ${ts[3]}`);
      for (const other of condSections.filter((s) => s !== own)) assert.ok(!ts.some((x) => x.endsWith(other.title)), `${t}: shows the "${other.title}" part of another type`);
      assert.ok(html.includes(`>${V2.sections[0].fields[0].options.find((o) => o.v === t).l}<`), `${t}: the type label is shown`);
    }
  });

  it('renders every answer as its LABEL (a select, a chip, a choice), numbers with separators, a date as D Mon YYYY, notes with their line breaks', () => {
    const html = S.call('cirRenderAnswers', V2, v2Brief({ target_date: '2026-12-01', area_sqm: 1234.5 }), 'screen');
    for (const label of ['Hospital or clinic', 'Renovation', 'Full kitchen design and build', 'Exhaust and fresh air', 'Diabetic or low-sugar meals', 'Tray line for patient meals', '6 to 12 months', '1 Dec 2026', '1,234.5', 'Cebu City', 'Reyes Medical Centre']) assert.ok(html.includes(label), label);
    for (const key of ['full_kitchen', 'tray_line', 'months_6_12', 'renovation']) assert.ok(!new RegExp(`>${key}<`).test(html), `the raw key ${key} is shown`);
    assert.ok(/white-space:pre-wrap">Public hospital\.\nBidding\.</.test(html), 'notes keep their line break');
  });

  it('puts the PROJECT TYPE first in the detail: a pill in the header, a prominent cell in the at-a-glance card, then the location, timing and what is wanted', () => {
    const sub = v2Brief({ target_date: '2026-12-01' });
    S.run('_cirCurrent = null');
    const facts = S.call('_cirFacts', sub, V2);
    assert.deepEqual({ ...facts, scope: [...facts.scope] }, { type: 'Hospital or clinic', location: 'Cebu City, Cebu', street: 'Near the old market', target: '2026-12-01', budget: '', scope: ['Full kitchen design and build', 'Exhaust and fresh air'] });
    const glance = S.call('_cirGlanceHtml', facts);
    assert.ok(glance.indexOf('Project type') < glance.indexOf('Location') && glance.indexOf('Location') < glance.indexOf('Timing') && glance.indexOf('Timing') < glance.indexOf('Wants'));
    assert.ok(/font-size:17px;font-weight:700">Hospital or clinic</.test(glance));
    assert.ok(glance.includes('Near the old market') && glance.includes('1 Dec 2026') && !glance.includes('Budget'));
    assert.equal((glance.match(/badge badge-gray/g) || []).length, 2, 'one pill per thing wanted');
  });

  it('shows the budget band the CLIENT chose in the at-a-glance card, after the timing and before what is wanted', () => {
    const sub = v2Brief({ target_date: '2026-12-01', budget: '1m_to_3m' });
    S.run('_cirCurrent = null');
    const facts = S.call('_cirFacts', sub, V2);
    assert.equal(facts.budget, '₱1,000,000 – ₱3,000,000', 'the band\'s label, not its key');
    const glance = S.call('_cirGlanceHtml', facts);
    assert.ok(glance.indexOf('Timing') < glance.indexOf('Budget') && glance.indexOf('Budget') < glance.indexOf('Wants'));
    assert.ok(glance.includes('₱1,000,000 – ₱3,000,000') && !glance.includes('1m_to_3m'));
  });

  it('a brief that skipped the budget question (or chose "prefer not to say") has no invented figure: nothing, or the client\'s own words', () => {
    const skipped = S.call('_cirFacts', v2Brief(), V2);
    assert.equal(skipped.budget, '');
    assert.ok(!S.call('_cirGlanceHtml', skipped).includes('Budget'));
    const declined = S.call('_cirFacts', v2Brief({ budget: 'not_sure' }), V2);
    assert.equal(declined.budget, 'Prefer not to say / not sure');
  });

  it('resolves the band through the definition when a brief has no usable summary (an unknown key is shown as it is, never hidden)', () => {
    const sub = v2Brief({ budget: 'over_10m' });
    sub.summary = { name: 'x' };
    assert.equal(S.call('_cirFacts', sub, V2).budget, 'Over ₱10,000,000');
    sub.answers.budget = 'mystery_band';
    assert.equal(S.call('_cirFacts', sub, V2).budget, 'mystery_band');
    // a v1 brief keeps reading its own (string) answer
    const old = v1Brief(); old.summary = { name: 'x' };
    assert.equal(S.call('_cirFacts', old, V1).budget, '₱1M – ₱3M');
  });

  it('lists the band under the project type, as the old list did for its budget', () => {
    const html = S.call('_cirTableHtml', [v2Brief({ budget: 'under_500k' })]);
    assert.match(html, /<span class="badge badge-blue"[^>]*>Hospital or clinic<\/span><div[^>]*>Budget Under ₱500,000<\/div>/);
    assert.ok(!S.call('_cirTableHtml', [v2Brief()]).includes('Budget '), 'no budget answered: no line under the type');
  });

  it('falls back to the answers when a brief has no usable summary (the type from project_type, through the definition)', () => {
    const sub = v2Brief({}, { bizType: '', location: '', siteAddress: '' });
    sub.summary = { name: 'x' };
    const f = S.call('_cirFacts', sub, V2);
    assert.equal(f.type, 'Hospital or clinic');
    assert.deepEqual([...f.scope], ['Full kitchen design and build', 'Exhaust and fresh air']);
  });

  it('lists the project type prominently and the location in the list: columns Project type + Location, a type pill, the target, the photos, the status', () => {
    const html = S.call('_cirTableHtml', [v2Brief()]);
    assert.ok(html.includes('<th>Project type</th><th>Location</th><th>Target</th>'));
    assert.ok(!html.includes('<th>Business</th>') && !html.includes('<th>Budget</th>'));
    assert.match(html, /data-label="Project type"><span class="badge badge-blue"[^>]*>Hospital or clinic<\/span><\/td>/);
    assert.match(html, /data-label="Location">Cebu City, Cebu<\/td>/);
    assert.match(html, /data-label="Target">6 to 12 months<\/td>/);
    assert.match(html, /<strong>Reyes Medical Centre<\/strong><div[^>]*>Dr\. Ana Reyes · 0917 555 0101 · ana@example\.test<\/div>/);
    assert.match(html, /data-label="Photos">2<\/td>/);
    assert.ok(html.includes(`cirOpen('CIR-261022-ABCDEF')`));
  });

  it('lists a brief with no organisation by the person\'s name, never an empty bold line', () => {
    const sub = v2Brief({ company: undefined });
    delete sub.answers.company; sub.summary.company = '';
    const html = S.call('_cirTableHtml', [sub]);
    assert.match(html, /<strong>Dr\. Ana Reyes<\/strong><div[^>]*>0917 555 0101 · ana@example\.test<\/div>/);
  });

  it('searches the project type and the place as well as the ref, company, name, e-mail and phone', () => {
    const src = read('js/screens/client-info-requests.js');
    assert.match(src, /\[r\.id, s\.company, s\.name, s\.email, s\.phone, s\.bizType, s\.location\]/);
    assert.match(src, /placeholder="Search ref, company, name, project type, place…"/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Sales › Briefs — a brief stored under the OLD commissary form renders exactly as it did', () => {
  const S = load();

  it('shows all ten parts of the old questionnaire, numbered 1…10, with the original labels', () => {
    const html = S.call('cirRenderAnswers', S.ctx.CIR_FORMS.commissary_brief, v1Brief(), 'screen');
    const ts = titles(html);
    assert.deepEqual(ts, V1.sections.map((s, i) => `${i + 1}. ${s.title}`));
    assert.ok(html.includes('Hotel or resort') && html.includes('1 Dec 2026') && html.includes('Exhaust hood and ducting') && html.includes('₱1M – ₱3M'));
  });

  it('lists a v1 brief with its business type as the pill, its site address as the location, and its budget under the type', () => {
    const html = S.call('_cirTableHtml', [v1Brief()]);
    assert.match(html, /<span class="badge badge-blue"[^>]*>Hotel or resort<\/span><div[^>]*>Budget ₱1M – ₱3M<\/div>/);
    assert.match(html, /data-label="Location">2 Site Rd, Valenzuela City<\/td>/);
    assert.match(html, /data-label="Target">1 Dec 2026<\/td>/);
  });

  it('reads a v1 brief\'s facts through the same helpers (the budget is shown; the location is the site address)', () => {
    const f = S.call('_cirFacts', v1Brief(), V1);
    assert.deepEqual({ ...f, scope: [...f.scope] }, { type: 'Hotel or resort', location: '2 Site Rd, Valenzuela City', street: '', target: '2026-12-01', budget: '₱1M – ₱3M', scope: ['Exhaust hood and ducting', 'Installation'] });
    assert.ok(S.call('_cirGlanceHtml', f).includes('Budget'));
  });

  it('an answer key the definition does not know (an older or newer version) is listed under "Other answers", escaped — never dropped', () => {
    const sub = v1Brief(); sub.answers.legacy_key = { a: '<b>x</b>' };
    const html = S.call('cirRenderAnswers', V1, sub, 'screen');
    assert.ok(html.includes('Other answers (older form version)') && html.includes('legacy_key') && html.includes('&lt;b&gt;x&lt;/b&gt;') && !html.includes('<b>x</b>'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Sales › Briefs — everything a visitor typed is inert text', () => {
  const S = load();
  const PAYLOADS = ['<img src=x onerror=window.__pwn=1>', '"><script>window.__pwn=1</script>', "');alert(1);//", '<svg/onload=alert(1)>', 'javascript:alert(1)'];

  it('escapes hostile text in every field of a brief — the answers, the summary, the captions — in the list, the detail and the at-a-glance card', () => {
    for (const evil of PAYLOADS) {
      const sub = v2Brief({ name: evil, company: evil, position: evil, city: evil, province: evil, site_address: evil, notes: evil, cuisine: undefined, hosp_meals: 1 });
      sub.photos[0].caption = evil;
      const detail = S.call('cirRenderAnswers', V2, sub, 'screen');
      const list = S.call('_cirTableHtml', [sub]);
      const glance = S.call('_cirGlanceHtml', S.call('_cirFacts', sub, V2));
      for (const [name, out] of [['detail', detail], ['list', list], ['glance', glance]]) {
        // no tag the visitor typed survives: every "<" in the output opens one of the screen's own elements
        const tags = [...out.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());
        for (const t of tags) assert.ok(['div', 'p', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'span', 'strong', 'h4', 'img', 'button', 'section'].includes(t), `${name}: a <${t}> from "${evil}"`);
        // escaped text has no "<" or ">", so every <…> in the output is the screen's own markup: none may carry a handler or a script URL
        // (attribute VALUES are blanked first: a payload inside alt="…" is escaped text, it cannot become an attribute)
        for (const tag of out.match(/<[^>]*>/g) || []) {
          const shape = tag.replace(/"[^"]*"/g, '""');
          assert.ok(!/\son[a-z]+\s*=/i.test(shape.replace(/\sonclick=""/g, '')), `${name}: ${tag.slice(0, 120)} (from "${evil}")`);
          assert.ok(!/(href|src)\s*=\s*"\s*javascript:/i.test(tag), `${name}: a script URL in ${tag.slice(0, 120)}`);
        }
        assert.ok(!/<script|<svg|<img src=x/i.test(out.replace(/<img data-cir-path="[^"]*" alt="[^"]*" loading="lazy"/g, '')), `${name} leaks "${evil}"`);
      }
      assert.ok(detail.includes(evil.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')), `the text is shown, as text: ${evil}`);
    }
  });

  it('escapes the SUMMARY fields too (the project type, the location, the target, the budget, the scope) — a hand-edited or legacy document cannot inject through them', () => {
    for (const evil of PAYLOADS) {
      const sub = v2Brief();
      Object.assign(sub.summary, { bizType: evil, location: evil, siteAddress: evil, targetDate: evil, budget: evil, company: evil, name: evil, phone: evil, email: evil });
      sub.answers.scope = [evil, 'full_kitchen'];
      const esc = evil.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const list = S.call('_cirTableHtml', [sub]);
      const glance = S.call('_cirGlanceHtml', S.call('_cirFacts', sub, V2));
      for (const [name, out] of [['list', list], ['glance', glance]]) {
        for (const tag of out.match(/<[^>]*>/g) || []) {
          assert.ok(!/\son[a-z]+\s*=/i.test(tag.replace(/"[^"]*"/g, '""').replace(/\sonclick=""/g, '')), `${name}: ${tag.slice(0, 100)} (from "${evil}")`);
        }
        assert.ok(!/<script|<svg|<img src=x/i.test(out), `${name} leaks "${evil}"`);
      }
      assert.ok(glance.includes(esc), `the type and place are shown, as text: ${evil}`);
      assert.ok(list.includes(esc), 'the list shows the typed text as text');
    }
  });

  it('a chips value the definition does not list is shown raw but escaped; a non-array "chips" answer cannot blank the whole detail', () => {
    const sub = v2Brief();
    sub.answers.scope = ['full_kitchen', '<img src=x onerror=1>'];
    sub.answers.hosp_diets = 'not-an-array';
    const html = S.call('cirRenderAnswers', V2, sub, 'screen');
    assert.ok(html.includes('Full kitchen design and build') && html.includes('&lt;img src=x onerror=1&gt;') && !html.includes('<img src=x'));
    assert.ok(titles(html).length === 9, 'every part is still there');
  });

  it('an answer that belongs to ANOTHER type\'s part (the server never lets one in) is not hidden: it is listed under "Other answers", escaped', () => {
    const sub = v2Brief();
    sub.answers.seats = 40; sub.answers.cuisine = '<script>1</script>';
    const html = S.call('cirRenderAnswers', V2, sub, 'screen');
    const ts = titles(html);
    assert.equal(ts[ts.length - 1], 'Other answers (older form version)');
    assert.ok(html.includes('seats') && html.includes('cuisine') && html.includes('&lt;script&gt;1&lt;/script&gt;') && !html.includes('<script>1'));
    assert.ok(!ts.some((x) => x.endsWith('Your menu and service')), 'the other type\'s part is not shown as if it applied');
  });

  it('a formId that is not a form (e.g. "constructor") finds no definition — never an inherited member of the table', () => {
    for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', undefined, 5, null]) assert.equal(S.call('_cirDef', bad), null, String(bad));
    assert.ok(S.call('_cirDef', 'project_brief_v2') && S.call('_cirDef', 'commissary_brief'));
  });

  it('prints with escaped values too (print mode), including the photo captions', () => {
    const sub = v2Brief({ name: '<img src=x onerror=1>' });
    sub.photos[0].caption = '<script>1</script>';
    const html = S.call('cirRenderAnswers', V2, sub, 'print', { [sub.photos[0].path]: 'https://storage.example.test/a.jpg' });
    assert.ok(!/<script>1|<img src=x onerror/.test(html));
    assert.ok(html.includes('&lt;script&gt;1&lt;/script&gt;'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Sales › Briefs — Convert to client, Prefill Quote Builder and Print keep working for both versions', () => {
  it('Convert (project brief): creates the client with the person, the organisation and a note naming the type, the site, the timing and what was asked for', async () => {
    const S = load();
    const sub = v2Brief({ target_date: '2026-12-01' });
    S.run('_cirCurrent = null'); S.ctx.__sub = sub; S.run('_cirCurrent = __sub');
    S.ctx.cirFetchOne = undefined;
    // after converting, the screen re-reads the brief: stand in for that read
    S.run('cirFetchOne = async () => __sub');
    await S.call('window.cirConvert', sub.id);
    assert.equal(S.writes.added.length, 1);
    const [coll, doc] = S.writes.added[0];
    assert.equal(coll, 'clients');
    assert.deepEqual([doc.name, doc.company, doc.phone, doc.email, doc.address, doc.stage, doc.source, doc.leadOrigin], ['Dr. Ana Reyes', 'Reyes Medical Centre', '0917 555 0101', 'ana@example.test', '', 'lead', 'Client brief', 'inbound']);
    assert.equal(doc.notes, 'Client brief CIR-261022-ABCDEF (2026-10-22): Hospital or clinic · site: Cebu City, Cebu · target: 1 Dec 2026 · scope: Full kitchen design and build, Exhaust and fresh air');
    assert.deepEqual(plain(doc.cirRefs), [sub.id]);
    const upd = S.writes.updated.find((u) => u[0] === 'client_info_requests');
    assert.deepEqual([upd[1], upd[2].status, upd[2].convertedClientId, upd[2].convertedBy], [sub.id, 'converted', 'client_new', 'u1']);
    assert.ok(S.log.some((l) => l[0] === 'toast' && l[1] === 'success' && /Client record created/.test(l[2])));
    assert.ok(S.log.some((l) => l[0] === 'audit' && l[1] === 'update' && l[2] === 'client_info_request'));
  });

  it('Convert (project brief with a budget): the note carries the client\'s band, between the site and the timing', async () => {
    const S = load();
    const sub = v2Brief({ target_date: '2026-12-01', budget: '3m_to_10m' });
    S.ctx.__sub = sub; S.run('_cirCurrent = __sub; cirFetchOne = async () => __sub');
    await S.call('window.cirConvert', sub.id);
    assert.equal(S.writes.added[0][1].notes, 'Client brief CIR-261022-ABCDEF (2026-10-22): Hospital or clinic · site: Cebu City, Cebu · budget: ₱3,000,000 – ₱10,000,000 · target: 1 Dec 2026 · scope: Full kitchen design and build, Exhaust and fresh air');
  });

  it('Convert (old form): the same note as before for a v1 brief, with its budget', async () => {
    const S = load();
    const sub = v1Brief();
    S.ctx.__sub = sub; S.run('_cirCurrent = __sub; cirFetchOne = async () => __sub');
    await S.call('window.cirConvert', sub.id);
    const doc = S.writes.added[0][1];
    assert.equal(doc.address, '1 Main St, Quezon City', 'a v1 brief carries the client\'s own office address');
    assert.equal(doc.notes, 'Client brief CIR-260927-ZZZZZZ (2026-09-27): Hotel or resort · site: 2 Site Rd, Valenzuela City · budget: ₱1M – ₱3M · target: 1 Dec 2026 · scope: Exhaust hood and ducting, Installation');
  });

  it('Convert into an existing client fills only what is empty and appends the note', async () => {
    const S = load();
    const sub = v2Brief();
    S.ctx.__sub = sub; S.run('_cirCurrent = __sub; cirFetchOne = async () => __sub');
    S.ctx.Clients.findByName = async () => ({ id: 'client_7', name: 'Dr. Ana Reyes', company: 'Existing Co', phone: '', email: '', notes: 'Earlier note', leadOrigin: 'facebook', source: 'Meta' });
    await S.call('window.cirConvert', sub.id);
    assert.equal(S.writes.added.length, 0);
    const u = S.writes.updated.find((x) => x[0] === 'clients');
    assert.equal(u[1], 'client_7');
    assert.deepEqual([u[2].company, u[2].phone, u[2].email, u[2].leadOrigin, u[2].source], [undefined, '0917 555 0101', 'ana@example.test', 'facebook', 'Meta']);
    assert.ok(u[2].notes.startsWith('Earlier note\n\nClient brief CIR-261022-ABCDEF'));
  });

  // QUOTE-BUILDER-CONFIGURATOR-SPEC §6.2 (2026-10-28): Prefill Quote Builder is a hand-off now — client fields as before PLUS Barro Kitchens (BK), the
  // Website lead source (WB), the location code and purpose derived by QBConfigured (pure; its tables are pinned in tests/qb-configured.test.mjs),
  // the sourceRef naming the brief, and handoff:true. A brief has no item list, so the state carries no items. QBConfigured is a lazy script of the
  // Sales page (js/config.js PAGE_SCRIPTS), loaded into the same context here.
  describe('Prefill Quote Builder — the hand-off state', () => {
    const withHelpers = (S) => { vm.runInContext(read('js/qb-configured.js'), S.ctx); return S; };
    const prefill = (sub, opts) => { const S = withHelpers(load(opts)); S.ctx.__sub = sub; S.run('_cirCurrent = __sub'); S.call('window.cirPrefillQuote', sub.id); return S; };

    it('project brief (v2): the client fields, the project address, BK + WB, the location code from "City, Province", the purpose from the project type, the sourceRef and handoff:true — no items', () => {
      const S = prefill(v2Brief());
      assert.deepEqual(plain(S.ctx._qbReopenState), {
        clientName: 'Dr. Ana Reyes', clientCompany: 'Reyes Medical Centre', clientAddress: 'Near the old market, Cebu City, Cebu', clientPhone: '0917 555 0101', clientEmail: 'ana@example.test',
        currentCo: 'BK', qnoMethod: 'WB', qnoLoc: 'CB', purpose: 'Hospital / Institutional', handoff: true,
        sourceRef: { kind: 'cir', ref: 'CIR-261022-ABCDEF', projectType: 'Hospital or clinic', budget: '', targetDate: '6 to 12 months', photosCount: 2, estimate: null },
      });
      assert.ok(!('items' in S.ctx._qbReopenState), 'a brief has no item list');
      assert.equal(S.ctx._qbReopenAsRevision, false);
      assert.deepEqual(S.log.filter((l) => l[0] === 'navigateTo'), [['navigateTo', 'bk-quote-builder']]);
      assert.ok(S.log.some((l) => l[0] === 'toast' && l[1] === 'success'));
    });

    it('old commissary brief (v1): the client\'s OWN office address, the site address for the location code, the business type for the purpose, the budget the client chose', () => {
      const S = prefill(v1Brief());
      assert.deepEqual(plain(S.ctx._qbReopenState), {
        clientName: 'Joseph Asis', clientCompany: 'Chibab Foods', clientAddress: '1 Main St, Quezon City', clientPhone: '0917 000 0000', clientEmail: 'j@example.test',
        currentCo: 'BK', qnoMethod: 'WB', qnoLoc: 'ML', purpose: 'Hotel Restaurant', handoff: true,
        sourceRef: { kind: 'cir', ref: 'CIR-260927-ZZZZZZ', projectType: 'Hotel or resort', budget: '₱1M – ₱3M', targetDate: '2026-12-01', photosCount: 0, estimate: null },
      });
      assert.equal(S.ctx._qbReopenState.clientAddress, '1 Main St, Quezon City');
    });

    it('a hospital brief opens as "Hospital / Institutional"; every project type lands on the pinned purpose (bakery has no builder equivalent -> Other)', () => {
      const WANT = { restaurant: 'Restaurant', cafe: 'Cafe / Coffee Shop', bakery: 'Other', commissary: 'Catering / Food Service', hotel: 'Hotel Restaurant', catering: 'Catering / Food Service',
        hospital: 'Hospital / Institutional', school: 'Hospital / Institutional', laboratory: 'Hospital / Institutional', government: 'Government / Bidding', home: 'Residential', other: 'Other' };
      assert.deepEqual(Object.keys(WANT).sort(), TYPES.slice().sort(), 'the table must cover exactly the project types the form offers');
      for (const [type, purpose] of Object.entries(WANT)) {
        const sub = v2Brief(); sub.answers.project_type = type;     // the screen reads the stored answer; the part-validation is the server\'s job
        assert.equal(prefill(sub).ctx._qbReopenState.purpose, purpose, type);
      }
      assert.equal(prefill(v2Brief()).ctx._qbReopenState.purpose, 'Hospital / Institutional');
    });

    it('the old form\'s free-text business type is keyword-scanned; an unknown one is "Other"', () => {
      const t = (biz) => { const sub = v1Brief(); sub.summary.bizType = biz; sub.answers.biz_type = biz; return prefill(sub).ctx._qbReopenState.purpose; };
      assert.equal(t('Hotel or resort'), 'Hotel Restaurant');
      assert.equal(t('Cafe / coffee shop'), 'Cafe / Coffee Shop');
      assert.equal(t('Fast food chain'), 'Restaurant');
      assert.equal(t('Private hospital'), 'Hospital / Institutional');
      assert.equal(t('LGU kitchen'), 'Government / Bidding');
      assert.equal(t('Central commissary'), 'Catering / Food Service');
      assert.equal(t('Something unusual'), 'Other');
      assert.equal(t(''), 'Other');
      const thin = v1Brief(); thin.summary.bizType = '';                       // a thin summary falls back to the stored answer, like the rest of the screen
      assert.equal(prefill(thin).ctx._qbReopenState.purpose, 'Hotel Restaurant');
    });

    it('the location code follows the project place (and falls back to OT); the address handed over is unchanged', () => {
      const t = (over) => { const sub = v2Brief(); Object.assign(sub.summary, over); return prefill(sub).ctx._qbReopenState.qnoLoc; };
      assert.equal(t({ location: 'Quezon City, Metro Manila' }), 'ML');
      assert.equal(t({ location: 'San Fernando, La Union' }), 'LU');
      assert.equal(t({ location: 'Baguio City, Benguet' }), 'BG');
      assert.equal(t({ location: 'Nowhere Town, Elsewhere' }), 'OT');
      assert.equal(t({ location: '', siteAddress: 'Subic Bay Freeport' }), 'SB');
    });

    it('a reference that is not a real one gets no sourceRef (the hand-off still opens); the secretary, a non-open brief or a missing helper open nothing', () => {
      const bad = v2Brief(); bad.id = 'CIR-1-X';
      const S = prefill(bad); assert.ok(!('sourceRef' in S.ctx._qbReopenState)); assert.equal(S.ctx._qbReopenState.handoff, true);
      const sec = prefill(v2Brief(), { role: 'secretary', depts: ['Sales'] }); assert.equal(sec.ctx._qbReopenState, undefined);
      assert.deepEqual(sec.log.filter((l) => l[0] === 'navigateTo'), []);
      const other = withHelpers(load()); other.ctx.__sub = v2Brief(); other.run('_cirCurrent = __sub'); other.call('window.cirPrefillQuote', 'CIR-261022-ZZZZZZ');
      assert.equal(other.ctx._qbReopenState, undefined);
      const nohelp = load(); nohelp.ctx.__sub = v2Brief(); nohelp.run('_cirCurrent = __sub'); nohelp.call('window.cirPrefillQuote', 'CIR-261022-ABCDEF');
      assert.equal(nohelp.ctx._qbReopenState, undefined, 'without the helpers the location code and purpose cannot be derived');
      assert.deepEqual(nohelp.log.filter((l) => l[0] === 'navigateTo'), []);
      assert.ok(nohelp.log.some((l) => l[0] === 'toast' && l[1] === 'error' && /reload/.test(l[2])));
    });
  });

  it('Print: "PROJECT BRIEF" with the type in the letterhead for a v2 brief, "CLIENT INFORMATION REQUEST" for a v1 brief, each with the consent line of the notice it ticked', async () => {
    const S = load();
    const v2 = v2Brief();
    S.ctx.__sub = v2; S.run('_cirCurrent = __sub');
    await S.call('window.cirPrint', v2.id);
    const lh2 = S.log.find((l) => l[0] === 'letterhead')[1];
    assert.equal(lh2.docTitle, 'PROJECT BRIEF');
    assert.deepEqual(plain(lh2.extraMeta), ['CIR-261022-ABCDEF', 'Reyes Medical Centre', 'Hospital or clinic']);
    const p2 = S.log.find((l) => l[0] === 'print')[1];
    assert.ok(p2.bodyHtml.includes(PRIVACY_NOTICE.consentLine) && p2.bodyHtml.includes('Notice v2026-10-22.1'));
    assert.ok(p2.bodyHtml.includes('Hospital or clinic'));

    const S1 = load();
    const v1 = v1Brief();
    S1.ctx.__sub = v1; S1.run('_cirCurrent = __sub');
    await S1.call('window.cirPrint', v1.id);
    assert.equal(S1.log.find((l) => l[0] === 'letterhead')[1].docTitle, 'CLIENT INFORMATION REQUEST');
    const p1 = S1.log.find((l) => l[0] === 'print')[1];
    assert.ok(p1.bodyHtml.includes(NOTICES['2026-09-26.1'].consentLine) && p1.bodyHtml.includes('Notice v2026-09-26.1'), 'a v1 brief shows the original consent wording');
    assert.ok(!p1.bodyHtml.includes(PRIVACY_NOTICE.consentLine));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Sales › Briefs — who may do what (unchanged by the redesign)', () => {
  it('the Corporate Secretary stays view-only even in the Sales department; Sales staff write but cannot delete; president and manager delete', () => {
    const t = (role, depts) => { const S = load({ role, depts }); return [S.call('cirCanWrite'), S.call('cirCanDelete')]; };
    assert.deepEqual(t('secretary', ['Sales', 'Admin']), [false, false]);
    assert.deepEqual(t('employee', ['Sales']), [true, false]);
    assert.deepEqual(t('employee', ['Design']), [false, false]);
    assert.deepEqual(t('manager', []), [true, true]);
    assert.deepEqual(t('president', []), [true, true]);
  });

  it('the screen holds no toISOString() and no formId literal: it follows whatever definition the brief carries', () => {
    const src = read('js/screens/client-info-requests.js');
    const code = stripJsComments(src);
    assert.ok(!/toISOString\(\)/.test(code));
    assert.ok(!/commissary_brief|project_brief_v2/.test(code), 'a hard-coded form id');
  });
});
