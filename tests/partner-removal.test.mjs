// tests/partner-removal.test.mjs — the GATE for the retirement of the external partner feature (specs/PARTNER-REMOVAL-SPEC.md §3.3, Phase 1; WS-G).
//
// Static, no Firestore. The partner feature (role `partner`, the Partners department, the partner portal in the quote builder, the three nav variants,
// partner_deals, the 50/50 split, ~55 guards in quote-builder-v2.html) is gone from the code; this test fails loudly if any of it grows back, and if a
// piece the owner ruled to KEEP (the internal Brilliant Steel department, its pages, bs_quotes, the BS pill) gets removed with it.
//
// WHAT IT PINS
//   1. SCAN SANITY   every script under js/ (not js/vendor/), quote-builder-v2.html, index.html and css/styles.css is read with its comments STRIPPED
//                    (tests/fixtures/strip-comments.mjs for JS and the <script> blocks of the two pages; <!-- --> and /* */ for markup and CSS), and
//                    the stripped text of every script still PARSES — so the scan below cannot be hiding a token in code the stripper ate.
//   2. IDENTIFIERS   none of the retired identifiers (spec §3.3.1 + the names the workstream acceptance greps listed) appears in code. `'PT'` — the
//                    retired generic-partner company code — is allowed on exactly three lines: the quote builder's pass-through chip label
//                    (the line carrying togglePassThrough) and the two Phase-3 fallbacks in js/screens/sales.js (buildPublicQuoteDoc,
//                    resolveQuoteBrand — WS-H deletes them). The §3.1 stub marker comment must be gone too (raw text, comments included).
//   3. ROLE LITERAL  every quoted 'partner' in js/ is on an allowlisted line: the §3.2 retired-role gate in js/app.js, the temporary roster guard
//                    window.isRetiredRoleUser in js/config.js (both marked `PARTNER-REMOVAL-SPEC §3.2` within six lines above), or one of the
//                    AEC-contact-stage lines (a CRM pipeline stage — unrelated), allowlisted by EXACT line content. A stale allowlist entry fails.
//   4. REGISTRIES    js/config.js evaluated in a vm: no partner role / team type / Partners department / genericPartner / partnerBS nav variant /
//                    partner-projects page; the bsOnly variant, the Brilliant Steel department (isSeparate), the four BS PAGE_SCRIPTS keys,
//                    QUOTE_COMPANIES.BS (internal:false) and QUOTE_COLLECTIONS are all still there; Sales' tab is "Brilliant Steel".
//   5. LOGIN SCREEN exactly two portal cards (admin, employee); app.js's ROLE_TYPE_MAP / LOGIN_TYPE_LABELS carry no partner.
//   6. KEPT          partners.js still defines renderBrilliantSteel / loadBSContent / renderBSFiles / renderBSClientData; app.js still routes the four
//                    bs-* cases and 'Brilliant Steel'; sw.js still precaches /js/screens/partners.js; the approvals review functions keep their names.
//   7. THE §3.2 GATE the retired-role gate in js/app.js's onAuthStateChanged is lifted out of the real source and RUN: a role "partner" (any case,
//                    padded) is shown the removed-account screen and signed out — even on a token refresh for an already bootstrapped uid — while
//                    employees, managers, agents, accountants and a Brilliant-Steel-only employee pass it. It sits after the `removed` gate and
//                    before the idempotency guard and the login-type gate.
//   Money (§5.4) is tests/partner-removal-payroll.test.mjs. Phase 3 (WS-H) extends this file with the rules/storage/indexes/scripts/functions checks
//   (§3.3.8), and deletes: the §3.2 gate and the isRetiredRoleUser entries of the role-literal allowlist, the 'PT' allowance for sales.js, and test 7.
//
// MUTATION-TESTED in ONE scratch copy (/private/tmp/…/scratchpad/wsg-mut/work/ — js/, the pages, sw.js, css, tests; the shared tree is never touched), each
// mutant applied alone and undone. The unmutated copy ran green first (control), then each of the 28 gate mutants below re-introduced ONE thing and every one
// turned this file red (none survived). The other 33 mutants of the same run (61 in all) are in the headers of the payroll and quote suites.
//   G01 isPartner() stub back in app.js                      G02 window.isExternalPartnerUser back in config.js        G03 a 'Partners' DEPARTMENTS entry back
//   G04 ROLES.partner back                                    G05 a third (partner) login card in index.html            G06 PARTNER_MODE back in the quote builder
//   G07 a rogue role === 'partner' in people.js               G08 the same hidden under a COPIED §3.2 marker comment    G09 the §3.2 gate deleted from app.js
//   G10 the gate moved after the idempotency guard            G11 gate case-sensitive                                    G12 gate does not trim
//   G13 gate also locks out Brilliant-Steel-only employees    G14 partner-projects back in the bsOnly bottom bar        G15 dashboard:bsOnly renamed back to dashboard:partner
//   G16 renderBrilliantSteel renamed away                     G17 sw.js PRECACHE drops partners.js                       G18 a 'PT' company code set again in production.js
//   G19 a partner_deals read back in dashboards.js            G21 an AEC allowlist line edited (the allowlist is exact)  G22 CO.PT referenced in the quote builder
//   G23 QUOTE_COMPANIES.BS made internal                      G24 Sales tab 'Partner' again                              G25 the §3.1 stub marker comment back
//   G26 code after a /* */ comment on one line (the scan still sees it)   G27 ROLE_TYPE_MAP gets a partner portal       G28 a Brilliant Steel page dropped from bsOnly
//   G29 partnerUid spreads to a third file
//
// Fixtures are synthetic. Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { stripComments } from './fixtures/strip-comments.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const newlinesOf = (m) => ' ' + '\n'.repeat((m.match(/\n/g) || []).length);        // a removed comment keeps its newlines: line N stays line N

// ── what is scanned ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === 'vendor' ? [] : walk(`${dir}/${e.name}`)) : (e.name.endsWith('.js') ? [`${dir}/${e.name}`] : []));
const JS_FILES = walk('js').sort();
const SURFACES = [...JS_FILES, 'quote-builder-v2.html', 'index.html', 'css/styles.css'];

// ── comment-free code of a file (and the proof that it still parses) ───────────────────────────────────────────────────────────────────────────
function jsCode(raw, what) {
  const code = stripComments(raw);
  try { new vm.Script(code, { filename: what }); }
  catch (e) { assert.fail(`${what}: after stripping comments it no longer parses (${e.message}) — the comment stripper ate real code, so the scan below would be blind`); }
  return code;
}
function htmlCode(raw, what) {
  let out = raw.replace(/<!--[\s\S]*?-->/g, newlinesOf);
  out = out.replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi, (m, open, attrs, body, close) => {
    if (/\bsrc\s*=/i.test(attrs)) return m;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || '';
    if (type && !/^(text|application)\/javascript$|^module$/i.test(type)) return m;       // JSON-LD data, templates
    return open + jsCode(body, `${what} <script>`) + close;
  });
  return out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, open, body, close) => open + body.replace(/\/\*[\s\S]*?\*\//g, newlinesOf) + close);
}
const cssCode = (raw) => raw.replace(/\/\*[\s\S]*?\*\//g, newlinesOf);
function codeFor(rel, raw) { return rel.endsWith('.js') ? jsCode(raw, rel) : rel.endsWith('.html') ? htmlCode(raw, rel) : cssCode(raw); }

const REAL = SURFACES.map((rel) => { const raw = read(rel); return { rel, raw, code: codeFor(rel, raw) }; });
const real = (rel) => REAL.find((f) => f.rel === rel);
const where = (f, i) => `${f.rel}:${i + 1}`;
const show = (text) => text.trim().replace(/\s+/g, ' ').slice(0, 150);

// ═══════════════════════════════════════ the scanners (pure on {rel, raw, code}, so they are tested on synthetic files below) ═══════════════════
const lit = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const PT_ALLOWED_SALES = new Set([                                    // Phase 3 (WS-H) deletes these two fallbacks and this set
  "const co = window.QUOTE_BRANDS[q.company] ? q.company : 'PT';",      // buildPublicQuoteDoc
  "const co = window.QUOTE_BRANDS[quote.company] ? quote.company : 'PT';",   // resolveQuoteBrand
]);
const FORBIDDEN = [
  // the predicates and registries (spec §3.3.1)
  ['isPartner', /\bisPartner\b/], ['isGenericPartner', /\bisGenericPartner\b/], ['isBrilliantPartner', /\bisBrilliantPartner\b/],
  ['partnerCompanyName', /\bpartnerCompanyName\b/], ['isExternalPartnerUser', lit('isExternalPartnerUser')], ['PARTNER_VISIBLE_ROLES', lit('PARTNER_VISIBLE_ROLES')],
  ['isPartnerDept', lit('isPartnerDept')],
  // the quote builder's partner mode
  ['PARTNER_MODE', lit('PARTNER_MODE')], ['GENERIC_PARTNER', lit('GENERIC_PARTNER')], ['PARTNER_CO_NAME', lit('PARTNER_CO_NAME')],
  ['PARTNER_BLOCKED_COS', lit('PARTNER_BLOCKED_COS')], ['applyPartnerMode', lit('applyPartnerMode')], ['portal=partner', lit('portal=partner')],
  ['pcoName', lit('pcoName')], ['CO.PT', /\bCO\.PT\b/], ['_qbPartner', lit('_qbPartner')],
  // the partner screens, pages and data
  ['partner-projects', lit('partner-projects')], ['partner_deal (partner_deals)', lit('partner_deal')], ['renderPartnerProjects', lit('renderPartnerProjects')],
  ['renderPartnerDashboard', lit('renderPartnerDashboard')], ['renderPartnersDept', lit('renderPartnersDept')], ['loadPartnersDeptTab', lit('loadPartnersDeptTab')],
  ['_showAddDealModal', lit('_showAddDealModal')], ['PARTNER_STAGE', lit('PARTNER_STAGE')], ['renderHelpPartner', lit('renderHelpPartner')],
  ['renderSalesPartnerQuotes', lit('renderSalesPartnerQuotes')], ['dashboard:partner', lit('dashboard:partner')], ['dept:Partners', lit('dept:Partners')],
  ["the 'Partners' department key", /(['"`])Partners\1/], ['genericPartner', lit('genericPartner')], ['partnerBS', lit('partnerBS')],
  ['data-type="partner" (the login card)', lit('data-type="partner"')],
  // chat's partner containment, the split modal, the invite form's company field, the per-WS leftovers the acceptance greps named
  ['_partnerBlockReason', lit('_partnerBlockReason')], ['_roleIsPartner', lit('_roleIsPartner')], ['viewerIsPartner / _viewerIsPartner', lit('viewerIsPartner')],
  ['viewingAsPartner', lit('viewingAsPartner')], ['isPartnerRole', lit('isPartnerRole')], ['isPartnerU', lit('isPartnerU')], ['isPtnr', lit('isPtnr')],
  ['isAnyPartner', lit('isAnyPartner')], ['extPartner', lit('extPartner')], ['inv-company', lit('inv-company')], ['syncCompany', lit('syncCompany')],
  ['partnerPct (the 50/50 split)', lit('partnerPct')], ['pm-pct / pm-share (the split modal)', /\bpm-(pct|share)\b/],
  // 'PT' — the retired generic-partner company code (not the word "PT" in prose: only the quoted code)
  ["the retired company code 'PT'", /(['"`])PT\1/, (rel, text) =>
    (rel === 'quote-builder-v2.html' && /togglePassThrough/.test(text)) || (rel === 'js/screens/sales.js' && PT_ALLOWED_SALES.has(norm(text)))],
].map(([name, re, allow]) => ({ name, re, allow }));

function scanForbidden(files) {
  const out = [];
  for (const f of files) {
    f.code.split('\n').forEach((text, i) => {
      for (const { name, re, allow } of FORBIDDEN) if (re.test(text) && !(allow && allow(f.rel, text))) out.push(`${where(f, i)}  [${name}]  ${show(text)}`);
    });
  }
  return out;
}

// The role literal. Allowed: the §3.2 gate / roster guard (marker within six lines above), or an exact AEC-stage line. Exact, normalised line content —
// "contains AEC_STAGES" is not enough (the stage array's own line does not contain it). A CRM pipeline stage called 'partner' has nothing to do with the role.
const ROLE_LITERAL = /(['"`])partner\1/;
const GATE_MARKER = /PARTNER-REMOVAL-SPEC §3\.2/;
const AEC_STAGE_LINES = {
  'js/screens/sales.js': [
    "{ key:'partner', label:'Partner', color:'var(--success,#30D158)', icon:'🤝' },",
    "window.AEC_TERMINAL = ['partner','dormant'];",
    "function aecProspected(c){ return ['prospect','partner'].includes(aecStageOf(c)); }",
  ],
  'js/screens/crm.js': ["if (stage === 'partner') return 'Won';", "const aecTerminal = window.AEC_TERMINAL || ['partner', 'dormant'];"],
  'js/notifications.js': ["const terminal = window.AEC_TERMINAL || ['partner','dormant'];"],
  'js/migrations.js': ["const STATUS_TO_AEC_STAGE = { 'New':'new', 'Contacted':'contacted', 'Meeting Set':'prospect', 'Quotation':'prospect', 'Won':'partner', 'Lost':'dormant' };"],
};
function scanRoleLiterals(files) {
  const offenders = [], gate = [], aec = [];
  for (const f of files) {
    if (!f.rel.startsWith('js/')) continue;
    const rawLines = f.raw.split('\n');
    f.code.split('\n').forEach((text, i) => {
      if (!ROLE_LITERAL.test(text)) return;
      if (GATE_MARKER.test(rawLines.slice(Math.max(0, i - 6), i + 1).join('\n'))) { gate.push(where(f, i)); return; }
      if ((AEC_STAGE_LINES[f.rel] || []).some((l) => norm(l) === norm(text))) { aec.push(`${f.rel}  ${norm(text)}`); return; }
      offenders.push(`${where(f, i)}  ${show(text)}`);
    });
  }
  return { offenders, gate, aec };
}

// ═════════════════════════════════════════ 1. the scan itself can be trusted ═════════════════════════════════════════════════════════════════════
describe('the scan: what it reads, and that it reads it faithfully', () => {
  it('covers every app script (js/ and js/screens/, not js/vendor/) plus the builder, the shell and the stylesheet', () => {
    assert.ok(JS_FILES.length >= 60, `only ${JS_FILES.length} scripts found under js/`);
    for (const rel of ['js/app.js', 'js/config.js', 'js/departments.js', 'js/chat.js', 'js/screens/partners.js', 'js/screens/people.js', 'js/screens/sales.js', 'js/screens/hr.js']) {
      assert.ok(JS_FILES.includes(rel), `${rel} is not scanned`);
    }
    assert.ok(!JS_FILES.some((r) => r.startsWith('js/vendor/')), 'js/vendor/ must not be scanned');
    assert.deepEqual(SURFACES.slice(-3), ['quote-builder-v2.html', 'index.html', 'css/styles.css']);
  });
  it('every file keeps its line numbering after the comments are stripped (so a report points at the real line)', () => {
    for (const f of REAL) assert.equal(f.code.split('\n').length, f.raw.split('\n').length, `${f.rel}: line numbers shifted`);
  });
  it('strips comments but not code: a marker in a // or /* */ comment is invisible, the same text in a string is not', () => {
    const f = (rel, raw) => ({ rel, raw, code: codeFor(rel, raw) });
    assert.deepEqual(scanForbidden([f('js/x.js', "// isPartner()\n/* PARTNER_MODE\n   portal=partner */\nconst a = 1; // genericPartner\n")]), []);
    assert.equal(scanForbidden([f('js/x.js', "const s = 'isPartner'; const t = 'http://x.test/portal=partner';\n")]).length, 2);
    assert.deepEqual(scanForbidden([f('index.html', '<!-- data-type="partner" -->\n<style>/* partnerBS */</style>\n<script>// PARTNER_MODE\n</script>\n')]), []);
    assert.equal(scanForbidden([f('index.html', '<button data-type="partner"></button>\n<script>var x = "genericPartner";</script>\n')]).length, 2);
    assert.equal(scanForbidden([f('css/styles.css', '/* partner-projects */\n.nav-item[data-page="partner-projects"] { color: red; }\n')]).length, 1);
  });
  it('the scanner knows the three allowed \'PT\' lines and nothing else', () => {
    const f = (rel, raw) => ({ rel, raw, code: codeFor(rel, raw) });
    assert.deepEqual(scanForbidden([f('js/screens/sales.js', "function a() {\n  const co  = window.QUOTE_BRANDS[q.company] ? q.company : 'PT';\n}\nfunction b() {\n  const co = window.QUOTE_BRANDS[quote.company] ? quote.company : 'PT';\n}\n")]), []);
    assert.equal(scanForbidden([f('js/screens/sales.js', "function a() {\n  const co = window.QUOTE_BRANDS[q.company] ? q.company : 'PT'; run();\n}\n")]).length, 1, 'a changed line is no longer the allowed one');
    assert.equal(scanForbidden([f('js/screens/production.js', "function a() {\n  const co = window.QUOTE_BRANDS[q.company] ? q.company : 'PT';\n}\n")]).length, 1, 'the allowance is per file');
    assert.deepEqual(scanForbidden([f('quote-builder-v2.html', "<script>\nconst b = `onclick=\"togglePassThrough(1)\">⇄ ${'PT'}`;\n</script>\n")]), []);
    assert.equal(scanForbidden([f('quote-builder-v2.html', "<script>\nsetCompany('PT');\n</script>\n")]).length, 1);
  });
  it('the role-literal scanner: a bare literal is flagged; a literal under a §3.2 marker (≤6 lines) or on an exact AEC line is not; a changed AEC line is', () => {
    const f = (rel, raw) => ({ rel, raw, code: codeFor(rel, raw) });
    const inFn = (body) => `function t(role, r, stage) {\n${body}\n}\n`;
    assert.equal(scanRoleLiterals([f('js/x.js', inFn("if (role === 'partner') return;"))]).offenders.length, 1);
    assert.equal(scanRoleLiterals([f('js/x.js', inFn('if (role == "partner") return;'))]).offenders.length, 1);
    assert.equal(scanRoleLiterals([f('js/x.js', inFn("// a partner account\nconst s = 'partnership'; const t = 'Partner';"))]).offenders.length, 0, 'prose, longer words and the capitalised label are not the role literal');
    assert.deepEqual(scanRoleLiterals([f('js/x.js', inFn("// PARTNER-REMOVAL-SPEC §3.2 gate\n\n\nif (r === 'partner') return;"))]).offenders, []);
    assert.equal(scanRoleLiterals([f('js/x.js', inFn("// PARTNER-REMOVAL-SPEC §3.2 gate\n\n\n\n\n\n\n\nif (r === 'partner') return;"))]).offenders.length, 1, 'a marker seven lines up is too far');
    assert.deepEqual(scanRoleLiterals([f('js/screens/crm.js', inFn("  if (stage === 'partner')   return 'Won';"))]).offenders, []);
    assert.equal(scanRoleLiterals([f('js/screens/crm.js', inFn("  if (stage === 'partner' || role === 'partner') return 'Won';"))]).offenders.length, 1);
    assert.equal(scanRoleLiterals([f('js/screens/people.js', inFn("if (stage === 'partner') return 'Won';"))]).offenders.length, 1, 'the allowance is per file');
    assert.equal(scanRoleLiterals([f('quote-builder-v2.html', "<script>const r = 'partner';</script>\n")]).offenders.length, 0, 'the role literal scan is js/ only');
  });
});

// ═════════════════════════════════════════ 2. nothing retired is left in code ═════════════════════════════════════════════════════════════════════
describe('no retired partner identifier is left in code (comments excluded)', () => {
  it('none of the retired functions, flags, registries, pages, collections or ids appears in js/, quote-builder-v2.html, index.html or css/styles.css', () => {
    assert.deepEqual(scanForbidden(REAL), [], 'a retired partner identifier is back in code');
  });
  it('the PARTNER-REMOVAL-SPEC §3.1 stub marker comment is gone (the four temporary stubs were deleted)', () => {
    const hits = REAL.flatMap((f) => f.raw.split('\n').map((text, i) => (/PARTNER-REMOVAL-SPEC §3\.1/.test(text) ? `${where(f, i)}  ${show(text)}` : null)).filter(Boolean));
    assert.deepEqual(hits, []);
  });
  it('the four stubbed predicates are not defined or guarded anywhere, as a function, a window property or a typeof test', () => {
    for (const name of ['isPartner', 'isBrilliantPartner', 'isGenericPartner', 'partnerCompanyName']) {
      const re = new RegExp(`\\b${name}\\b`);
      assert.deepEqual(REAL.filter((f) => re.test(f.code)).map((f) => f.rel), [], `${name} is still named in code`);
    }
  });
  it('partnerUid survives in exactly the two files that keep the review-context key (spec §1.2: approvals.js sets it, app.js saveReviewedPartnerQuote reads it)', () => {
    assert.deepEqual(REAL.filter((f) => /\bpartnerUid\b/.test(f.code)).map((f) => f.rel).sort(), ['js/app.js', 'js/screens/approvals.js']);
  });
});

// ═════════════════════════════════════════ 3. the role literal ════════════════════════════════════════════════════════════════════════════════════
describe("the role literal 'partner' appears only where it is allowed", () => {
  const R = scanRoleLiterals(REAL);
  it("every quoted 'partner' in js/ is the §3.2 gate, the retired-role roster guard or an AEC contact-stage line", () => {
    assert.deepEqual(R.offenders, [], "a 'partner' role test is back");
  });
  it('the §3.2 allowance is used by exactly two lines — the retired-role gate in js/app.js and window.isRetiredRoleUser in js/config.js — nothing else hides under a marker', () => {
    assert.deepEqual(R.gate.map((s) => s.split(':')[0]).sort(), ['js/app.js', 'js/config.js']);
  });
  it('every AEC allowlist entry matches a line (a renamed or deleted AEC line makes this fail, so the allowlist cannot go stale)', () => {
    const want = Object.entries(AEC_STAGE_LINES).flatMap(([rel, ls]) => ls.map((l) => `${rel}  ${norm(l)}`)).sort();
    assert.deepEqual([...R.aec].sort(), want);
  });
});

// ═════════════════════════════════════════ 4. registries (js/config.js evaluated in a vm) ════════════════════════════════════════════════════════
describe('js/config.js registries', () => {
  const win = (() => {
    const sandbox = {
      console: { log() {}, info() {}, warn() {}, error() {} },
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      document: new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => null)) }),
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      navigator: { userAgent: 'node' },
      location: { search: '', hash: '', href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
      addEventListener() {},
    };
    sandbox.window = sandbox; sandbox.sessionStorage = sandbox.localStorage;
    vm.createContext(sandbox);
    try { vm.runInContext(read('js/config.js'), sandbox, { filename: 'js/config.js' }); }
    catch (e) { assert.fail(`js/config.js no longer evaluates in the minimal browser stub (${e.message}) — extend the stub in this test, do not delete the check`); }
    return sandbox.window;
  })();
  const keys = (o) => Object.keys(o);

  it('ROLES, TEAM_TYPES and DEPARTMENTS have no partner role, team type or Partners department; Brilliant Steel is still a separate department', () => {
    assert.deepEqual(keys(win.ROLES), ['president', 'manager', 'secretary', 'employee', 'agent', 'finance']);
    assert.ok(!('partner' in win.TEAM_TYPES), 'TEAM_TYPES.partner is back');
    assert.deepEqual(keys(win.TEAM_TYPES), ['office', 'operations', 'agent', 'freelancer']);
    assert.ok(!('Partners' in win.DEPARTMENTS), 'DEPARTMENTS.Partners is back');
    assert.ok(!keys(win.DEPARTMENTS).some((d) => win.DEPARTMENTS[d].isPartnerDept), 'a DEPARTMENTS entry carries isPartnerDept');
    assert.equal(win.DEPARTMENTS['Brilliant Steel'].isSeparate, true);
    assert.deepEqual([...win.DEPARTMENTS['Brilliant Steel'].subtabs], ['Quote Builder', 'Quotations Summary', 'Client Data', 'Files']);
  });
  it('a person typed "partner" is no longer classified as a partner team type, and the retired-role guard is the one new global', () => {
    assert.notEqual(win.teamTypeOf({ role: 'partner' }), 'partner');
    assert.equal(win.teamTypeOf({ role: 'employee', departments: ['Brilliant Steel'] }), 'office', 'a Brilliant-Steel-only employee is an office employee');
    assert.equal(typeof win.isExternalPartnerUser, 'undefined');
    assert.equal(typeof win.isRetiredRoleUser, 'function');
  });
  it('NAV_REGISTRY: no genericPartner / partnerBS variant (sidebar or bottom), no partner-projects entry; bsOnly is still there in both', () => {
    const N = win.NAV_REGISTRY;
    for (const which of ['sidebar', 'bottom']) {
      assert.ok(!('genericPartner' in N[which]) && !('partnerBS' in N[which]), `${which}: a partner variant is back`);
      assert.ok(Array.isArray(N[which].bsOnly) && N[which].bsOnly.length >= 4, `${which}.bsOnly is gone`);
      assert.ok(!JSON.stringify(N[which]).includes('partner-projects'), `${which}: partner-projects is back`);
    }
    const pages = (arr) => arr.map((e) => e.page);
    assert.ok(['bs-quote-builder', 'bs-quotations', 'bs-clients'].every((p) => pages(N.sidebar.bsOnly).includes(p)), 'the bsOnly sidebar lost a Brilliant Steel page');
    assert.ok(['bs-quote-builder', 'bs-quotations'].every((p) => pages(N.bottom.bsOnly).includes(p)), 'the bsOnly bottom bar lost a Brilliant Steel page');
    assert.ok(N.bottom.bsOnly.length <= 7, 'bsOnly bottom nav shrank by Projects, it must not grow');
  });
  it('PAGE_SCRIPTS: dashboard:bsOnly and the four Brilliant Steel keys load partners.js; dashboard:partner / dept:Partners / partner-projects are gone', () => {
    const P = win.PAGE_SCRIPTS;
    for (const k of ['dashboard:bsOnly', 'dept:Brilliant Steel', 'bs-quotations', 'bs-clients', 'bs-files']) {
      assert.ok(Array.isArray(P[k]) && P[k].includes('js/screens/partners.js'), `${k} does not load js/screens/partners.js`);
    }
    for (const k of ['dashboard:partner', 'dept:Partners', 'partner-projects']) assert.ok(!(k in P), `${k} is a PAGE_SCRIPTS key again`);
    for (const [k, files] of Object.entries(P)) for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), `PAGE_SCRIPTS['${k}'] lists ${f}, which does not exist`);
  });
  it('the Brilliant Steel quote company, the quote collections and the Sales tab are intact', () => {
    assert.equal(win.QUOTE_COMPANIES.BS.internal, false);
    assert.equal(win.QUOTE_COMPANIES.BS.coll, 'bs_quotes');
    assert.equal(win.QUOTE_COMPANIES.BS.page, 'bs-quote-builder');
    assert.deepEqual(keys(win.QUOTE_COMPANIES), ['BK', 'BI', 'BS']);
    assert.deepEqual([...win.QUOTE_COLLECTIONS], ['bk_quotes', 'bs_quotes']);
    const salesTabs = win.DEPARTMENTS.Sales.subtabs;
    assert.ok(salesTabs.includes('Brilliant Steel') && !salesTabs.includes('Partner'), `Sales subtabs: ${salesTabs.join(', ')}`);
  });
});

// ═════════════════════════════════════════ 5. login screen and the portal map ═════════════════════════════════════════════════════════════════════
describe('login screen', () => {
  it('index.html has exactly two portal cards: admin and employee', () => {
    const cards = [...real('index.html').code.matchAll(/<button\b[^>]*\blogin-role-card\b[^>]*>/g)].map((m) => (m[0].match(/data-type="([^"]*)"/) || [])[1]);
    assert.deepEqual(cards, ['admin', 'employee']);
  });
  it("app.js's ROLE_TYPE_MAP and LOGIN_TYPE_LABELS name no partner portal", () => {
    const APP = real('js/app.js').code;
    const map = APP.match(/const ROLE_TYPE_MAP = \{[\s\S]*?\};/)[0];
    const labels = APP.match(/const LOGIN_TYPE_LABELS = \{[^}]*\};/)[0];
    const roleType = new Function(`${map}\nreturn ROLE_TYPE_MAP;`)();
    assert.deepEqual(Object.keys(roleType).sort(), ['agent', 'employee', 'finance', 'manager', 'owner', 'president', 'secretary']);
    assert.deepEqual([...new Set(Object.values(roleType))].sort(), ['admin', 'employee']);
    assert.deepEqual(new Function(`${labels}\nreturn LOGIN_TYPE_LABELS;`)(), { admin: 'Admin', employee: 'Employee' });
  });
});

// ═════════════════════════════════════════ 6. what the owner ruled to KEEP ═════════════════════════════════════════════════════════════════════════
describe('the internal Brilliant Steel department is intact', () => {
  const PARTNERS_JS = real('js/screens/partners.js').code;
  const APP = real('js/app.js').code;
  it('partners.js (the file keeps its name) still defines the Brilliant Steel screens', () => {
    assert.match(PARTNERS_JS, /window\.renderBrilliantSteel\s*=\s*async function/);
    for (const fn of ['loadBSContent', 'renderBSFiles', 'renderBSClientData']) assert.match(PARTNERS_JS, new RegExp(`function ${fn}\\(`), `${fn} is gone`);
  });
  it("app.js still routes the bs-* pages, the 'Brilliant Steel' department and the BS-only chrome", () => {
    for (const c of ["case 'bs-quotations':", "case 'bs-clients':", "case 'bs-files':", "case 'bs-quote-builder':", "case 'Brilliant Steel':"]) assert.ok(APP.includes(c), `${c} is gone from the router`);
    assert.match(APP, /function isBrilliantOnly\(\)\s*\{\s*return currentDepts\.length === 1 && currentDepts\[0\] === 'Brilliant Steel';\s*\}/);
  });
  it('sw.js still precaches /js/screens/partners.js (the file stays)', () => {
    const sw = read('sw.js');
    const precache = sw.match(/const PRECACHE = \[[\s\S]*?\n\];/);
    assert.ok(precache, 'could not find the PRECACHE list in sw.js');
    assert.ok(precache[0].includes("'/js/screens/partners.js'"));
  });
  it('the approvals review flow keeps the function names the tests pin, and Sales renders its Brilliant Steel tab through renderSalesBSQuotes', () => {
    assert.match(real('js/screens/approvals.js').code, /async function returnQuoteToPartner\(/);
    assert.match(APP, /async function saveReviewedPartnerQuote\(/);
    const sales = real('js/screens/sales.js').code;
    assert.match(sales, /async function renderSalesBSQuotes\(/);
    assert.match(sales, /case 'Brilliant Steel':/);
    assert.match(sales, /'Partner':'Brilliant Steel', 'Partner Quotes':'Brilliant Steel', 'Partner Files':'Brilliant Steel'/, 'the old Sales deep-link keys no longer resolve to the Brilliant Steel tab');
  });
});

// ═════════════════════════════════════════ 7. the §3.2 retired-role gate, run for real ════════════════════════════════════════════════════════════
describe('the retired-role gate in js/app.js onAuthStateChanged (PARTNER-REMOVAL-SPEC §3.2; WS-H deletes it)', () => {
  const APP = read('js/app.js');
  const CB = APP.indexOf('auth.onAuthStateChanged(async user => {');
  const FROM = APP.indexOf('    if (user) {', CB);
  const GUARD = 'if (_bootstrappedUid === user.uid) {\n        return;\n      }';
  const TO = APP.indexOf(GUARD, FROM);
  it('the gate sits after the `removed` gate and before the idempotency guard and the login-type gate', () => {
    assert.ok(CB > 0 && FROM > CB && TO > FROM, 'could not lift the start of the onAuthStateChanged callback out of js/app.js');
    const slice = APP.slice(FROM, TO + GUARD.length);
    const at = (needle) => { const i = slice.indexOf(needle); assert.ok(i >= 0, `"${needle}" is not in the lifted callback`); return i; };
    const removed = at('userProfile.removed === true'), gate = at('PARTNER-REMOVAL-SPEC §3.2'), role = at(".trim().toLowerCase() === 'partner'"), guard = at('_bootstrappedUid === user.uid');
    assert.ok(removed < gate && gate < role && role < guard, 'order must be: removed gate, retired-role gate, idempotency guard');
    assert.ok(APP.indexOf('if (selectedLoginType) {', TO) > TO, 'the login-type gate must come after the idempotency guard');
    assert.match(slice.slice(role, guard), /showRemovedUserScreen\(\);\s*auth\.signOut\(\)\.catch\(\(\) ?=> ?\{\}\);\s*return;/, 'the gate must show the removed screen, sign out and return');
  });

  // run the real lifted code: loadUserProfile is stubbed to set the role, everything else the gate touches is recorded
  const run = async (profile, { bootstrapped = false } = {}) => {
    const calls = [];
    const ctx = vm.createContext({
      currentUser: null, userProfile: null, currentRole: null, _bootstrappedUid: bootstrapped ? 'u1' : null,
      loadUserProfile: async () => { ctx.userProfile = profile; ctx.currentRole = profile.role; },
      showRemovedUserScreen: () => calls.push('removed-screen'),
      auth: { signOut: () => { calls.push('sign-out'); return Promise.resolve(); } },
    });
    const slice = APP.slice(FROM, TO + GUARD.length);
    vm.runInContext(`async function __gate(user) {\n${slice}\n      return 'proceeded';\n    }\n  }`, ctx);
    const result = await ctx.__gate({ uid: 'u1' });
    return { result, calls };
  };
  it('a role "partner" — any case, padded — is shown the removed-account screen and signed out, and never proceeds', async () => {
    for (const role of ['partner', 'Partner', 'PARTNER', ' partner ', '\tPartner\n']) {
      const r = await run({ role, departments: ['Brilliant Steel'] });
      assert.deepEqual(r, { result: undefined, calls: ['removed-screen', 'sign-out'] }, JSON.stringify(role));
    }
  });
  it('...even on a token refresh for a uid that is already bootstrapped (the gate runs ahead of the idempotency guard)', async () => {
    const r = await run({ role: 'partner' }, { bootstrapped: true });
    assert.deepEqual(r, { result: undefined, calls: ['removed-screen', 'sign-out'] });
  });
  it('every real role passes it — a Brilliant-Steel-only employee included — and an already bootstrapped session is simply left alone', async () => {
    for (const profile of [{ role: 'employee', departments: ['Brilliant Steel'] }, { role: 'employee' }, { role: 'manager' }, { role: 'president' }, { role: 'secretary' },
      { role: 'agent' }, { role: 'finance' }, { role: undefined }, { role: 'partners' }, { role: 'partnership' }, { role: 'employee', title: 'Partner', departments: ['Partners'] }]) {
      assert.deepEqual(await run(profile), { result: 'proceeded', calls: [] }, JSON.stringify(profile));
    }
    assert.deepEqual(await run({ role: 'employee' }, { bootstrapped: true }), { result: undefined, calls: [] }, 'the idempotency guard returns quietly');
  });
  it('the removed-user gate beside it still works for every role', async () => {
    for (const role of ['employee', 'manager', 'agent']) assert.deepEqual(await run({ role, removed: true }), { result: undefined, calls: ['removed-screen', 'sign-out'] }, role);
  });
});
