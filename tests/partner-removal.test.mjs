// tests/partner-removal.test.mjs — the GATE for the retirement of the external partner feature (specs/PARTNER-REMOVAL-SPEC.md §3.3; Phase 1 by WS-G, extended by WS-H).
//
// Static, no Firestore. The partner feature (role `partner`, the Partners department, the partner portal in the quote builder, the three nav variants,
// partner_deals, the 50/50 split, ~55 guards in quote-builder-v2.html) is gone from the code, and — since Phase 3 — from the server-side surfaces too (firestore.rules,
// storage.rules, firestore.indexes.json, the backup / sync scripts, functions/index.js). This test fails loudly if any of it grows back, and if a piece the owner ruled
// to KEEP (the internal Brilliant Steel department, its pages, bs_quotes, the BS pill) gets removed with it.
//
// WHAT IT PINS
//   1. SCAN SANITY   every script under js/ (not js/vendor/), quote-builder-v2.html, index.html and css/styles.css is read with its comments STRIPPED
//                    (tests/fixtures/strip-comments.mjs for JS and the <script> blocks of the two pages; <!-- --> and /* */ for markup and CSS), and
//                    the stripped text of every script still PARSES — so the scan below cannot be hiding a token in code the stripper ate.
//   2. IDENTIFIERS   none of the retired identifiers (spec §3.3.1 + the names the workstream acceptance greps listed) appears in code. `'PT'` — the
//                    retired generic-partner company code — is allowed on exactly ONE line: the quote builder's pass-through chip label (the line carrying
//                    togglePassThrough). The §3.1 stub marker, every §3.2 / retired-role marker and isRetiredRoleUser are gone from js/ (raw text, comments included).
//   3. ROLE LITERAL  every quoted 'partner' in js/ is an AEC-contact-stage line (a CRM pipeline stage — unrelated), allowlisted by EXACT line content. A stale
//                    allowlist entry fails. There is no role test left, and no marker comment hides one (Phase 3 deleted the §3.2 allowance).
//   4. REGISTRIES    js/config.js evaluated in a vm: no partner role / team type / Partners department / genericPartner / partnerBS nav variant /
//                    partner-projects page; no isExternalPartnerUser and no isRetiredRoleUser; the bsOnly variant, the Brilliant Steel department (isSeparate),
//                    the four BS PAGE_SCRIPTS keys, QUOTE_COMPANIES.BS (internal:false) and QUOTE_COLLECTIONS are all still there; Sales' tab is "Brilliant Steel".
//   5. LOGIN SCREEN  exactly two portal cards (admin, employee); app.js's ROLE_TYPE_MAP / LOGIN_TYPE_LABELS carry no partner.
//   6. KEPT          partners.js still defines renderBrilliantSteel / loadBSContent / renderBSFiles / renderBSClientData; app.js still routes the four
//                    bs-* cases and 'Brilliant Steel'; sw.js still precaches /js/screens/partners.js; the approvals review functions keep their names.
//   7. PHASE 3 (WS-H)  the public quote brand (js/screens/sales.js resolveQuoteBrand / buildPublicQuoteDoc, RUN for real): BK / BI / BS keep their letterhead, every
//                    other code — 'PT' included — falls back to Brilliant Steel's, with no Firestore read and no synthesised brand. firestore.rules: no isPartner,
//                    partner_deals, partnerUid or quoted 'Partners' (comments included), no quoted 'partner' role, no partner_deals match block, the users-create
//                    allowlist names no partner. storage.rules: no isPartnerClaim. Both rules files are well-formed (brackets balance; every helper called is defined).
//                    firestore.indexes.json: valid, no partner_deals index. scripts/check-backup-coverage.js and scripts/sync-to-drive.js: no partner_deals. The Phase-3
//                    acceptance grep (isPartner | partner_deals | isPartnerClaim) is empty across the rules, the indexes, every scripts/*.js — scripts/partner-data-purge.js
//                    excepted BY NAME — and functions/index.js. functions/index.js: the only quoted 'partner' is the AEC stage in the daily digest, by EXACT line content;
//                    the notification recipients (resolveSalesAndPresidentUids, cirNotifyStaff, qrNotifyStaff) special-case no role.
//   8. NOTHING WIDENS  (coordinator ruling 2026-10-28). The old `!isPartner()` / `!isPartnerClaim()` terms also refused every signed-in identity with no users doc /
//                    no role claim (reading either THROWS, and a throwing rule denies), so deleting them would have opened ~110 rules to such an identity. They are
//                    now hasProfile() (a cached get() of users/{uid}, NOT exists(): exists() is not cached for a later get() and returns false where the old term
//                    errored) and hasRoleClaim() (`'role' in request.auth.token`), in the same position. Pinned: that definition; the 111 statements that carried the
//                    term (tests/fixtures/rules-profile-statements.json, regenerate with UPDATE_RULES_SNAPSHOT=1 and READ the diff); that the only bare `isAuth()` reads
//                    are the five that always were; a list of sensitive reads; the 11 storage statements; and that the only arms dropped with the partner are the three
//                    that named it ('partner' in the users-list role filter, the Partners-department posts arm, the partnerUid job_projects arm) while every other arm
//                    stays verbatim. The same facts were proved against the real rules engine (emulator differential, old vs new, 762 operations x 11 identities).
//   Money (§5.4) is tests/partner-removal-payroll.test.mjs.
//
// MUTATION-TESTED in ONE scratch copy (/private/tmp/…/scratchpad/wsh-mut/work-gate/ — js/, the pages, sw.js, css, the rules, the indexes, scripts/, functions/index.js
// and this file; the shared tree is never touched), each mutant applied alone and undone. The unmutated copy ran green first (control 45 of 45) and again after the
// last mutant; every one of the 36 mutants below re-introduced ONE thing and turned this file red (none survived). Phase 1's own run (WS-G, 28 mutants against the
// Phase-1 suite) is superseded: its mutants for the §3.2 gate and the 'PT' allowance retired with those allowances; the equivalents are G02-G05 here.
//   G01 isPartner() back in app.js                          G02 the retired-role gate back in app.js              G03 window.isRetiredRoleUser back in config.js
//   G04 resolveQuoteBrand's 'PT' fallback back              G05 buildPublicQuoteDoc's 'PT' fallback back         G06 the generic-partner brand synthesis back in resolveQuoteBrand
//   G07 isPartner() back in firestore.rules                 G08 a partner_deals rule back                        G09 a partnerUid read term in firestore.rules
//   G10 a quoted 'Partners' department key in a rule        G11 isPartnerClaim() back in storage.rules           G12 the partner_deals index back
//   G13 partner_deals back in check-backup-coverage.js      G14 partner_deals back in sync-to-drive.js           G15 the partner-drop line back in cirNotifyStaff
//   G16 the partner-drop line back in qrNotifyStaff         G17 a second 'partner' literal beside the AEC line   G18 the AEC stage line edited (the allowlist is exact)
//   G19 a quoted 'partner' role test in js/ (payroll-backfill)   G20 an extra AEC-looking stage line (not allowlisted)   G21 !isPartner() back in the users list
//   G22 resolveQuoteBrand falls back to BK                  G23 buildPublicQuoteDoc falls back to BK             G24 resolveQuoteBrand reads the creator's user doc again
//   the WIDENING mutants (the first attempt at this cleanup had exactly these — a stranger with no users doc gained 132 of 762 operations on the emulator):
//   G25 client_info_requests / quote_requests read: profile check dropped   G26 quote_costs: profile check dropped       G27 hasProfile() defined with exists()
//   G28 tasks read: profile check (and its assignedTo arm) dropped          G29 Finance/* storage read: role claim dropped   G30 department-folder storage read: role claim dropped
//   G31 hasRoleClaim() always true                          G32 'partner' back in the users-list role filter     G33 the Partners arm back in the posts read
//   G34 departments read: profile check dropped             G35 _counters write: profile check dropped           G36 hub_folders create: profile check dropped
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
  ["the retired company code 'PT'", /(['"`])PT\1/, (rel, text) => rel === 'quote-builder-v2.html' && /togglePassThrough/.test(text)],
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

// The role literal. Allowed: an exact AEC-stage line, nothing else (Phase 3 deleted the §3.2 retired-role gate and the roster guard, and with them the
// marker allowance). Exact, normalised line content — "contains AEC_STAGES" is not enough (the stage array's own line does not contain it). A CRM pipeline
// stage called 'partner' has nothing to do with the role.
const ROLE_LITERAL = /(['"`])partner\1/;
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
function scanRoleLiterals(files, only = 'js/', allow = AEC_STAGE_LINES) {
  const offenders = [], aec = [];
  for (const f of files) {
    if (!f.rel.startsWith(only)) continue;
    f.code.split('\n').forEach((text, i) => {
      if (!ROLE_LITERAL.test(text)) return;
      if ((allow[f.rel] || []).some((l) => norm(l) === norm(text))) { aec.push(`${f.rel}  ${norm(text)}`); return; }
      offenders.push(`${where(f, i)}  ${show(text)}`);
    });
  }
  return { offenders, aec };
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
  it("the scanner knows the ONE allowed 'PT' line (the quote builder's pass-through chip) and nothing else — Phase 3 deleted the two sales.js fallbacks", () => {
    const f = (rel, raw) => ({ rel, raw, code: codeFor(rel, raw) });
    assert.equal(scanForbidden([f('js/screens/sales.js', "function a() {\n  const co  = window.QUOTE_BRANDS[q.company] ? q.company : 'PT';\n}\n")]).length, 1, "the old sales.js fallback is no longer allowed");
    assert.equal(scanForbidden([f('js/screens/sales.js', "function b() {\n  const co = window.QUOTE_BRANDS[quote.company] ? quote.company : 'PT';\n}\n")]).length, 1, "the old resolveQuoteBrand fallback is no longer allowed");
    assert.equal(scanForbidden([f('js/screens/production.js', "function a() {\n  const co = 'PT';\n}\n")]).length, 1, 'the allowance is per file');
    assert.deepEqual(scanForbidden([f('quote-builder-v2.html', "<script>\nconst b = `onclick=\"togglePassThrough(1)\">⇄ ${'PT'}`;\n</script>\n")]), []);
    assert.equal(scanForbidden([f('quote-builder-v2.html', "<script>\nsetCompany('PT');\n</script>\n")]).length, 1);
  });
  it('the role-literal scanner: a bare literal is flagged — even under a copied marker comment; a literal on an exact AEC line is not; a changed AEC line is', () => {
    const f = (rel, raw) => ({ rel, raw, code: codeFor(rel, raw) });
    const inFn = (body) => `function t(role, r, stage) {\n${body}\n}\n`;
    assert.equal(scanRoleLiterals([f('js/x.js', inFn("if (role === 'partner') return;"))]).offenders.length, 1);
    assert.equal(scanRoleLiterals([f('js/x.js', inFn('if (role == "partner") return;'))]).offenders.length, 1);
    assert.equal(scanRoleLiterals([f('js/x.js', inFn("// a partner account\nconst s = 'partnership'; const t = 'Partner';"))]).offenders.length, 0, 'prose, longer words and the capitalised label are not the role literal');
    assert.equal(scanRoleLiterals([f('js/x.js', inFn("// PARTNER-REMOVAL-SPEC §3.2 gate\n\n\nif (r === 'partner') return;"))]).offenders.length, 1, 'the §3.2 marker allowance is gone: a copied marker hides nothing');
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
  it('no PARTNER-REMOVAL-SPEC §3.2 / retired-role marker and no isRetiredRoleUser is left anywhere under js/ — comments included (Phase 3 deleted the gate and the roster guard)', () => {
    const hits = REAL.filter((f) => f.rel.startsWith('js/')).flatMap((f) => f.raw.split('\n')
      .map((text, i) => (/PARTNER-REMOVAL-SPEC §3\.2|retired-role|isRetiredRoleUser/.test(text) ? `${where(f, i)}  ${show(text)}` : null)).filter(Boolean));
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
  it("every quoted 'partner' in js/ is an exact AEC contact-stage line — there is no role test left at all (Phase 3 deleted the §3.2 gate and the roster guard)", () => {
    assert.deepEqual(R.offenders, [], "a 'partner' role test is back");
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
  it('a person typed "partner" is no longer classified as a partner team type, and neither retired predicate exists', () => {
    assert.notEqual(win.teamTypeOf({ role: 'partner' }), 'partner');
    assert.equal(win.teamTypeOf({ role: 'employee', departments: ['Brilliant Steel'] }), 'office', 'a Brilliant-Steel-only employee is an office employee');
    assert.equal(typeof win.isExternalPartnerUser, 'undefined');
    assert.equal(typeof win.isRetiredRoleUser, 'undefined');
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

// ═════════════════════════════════════════ 7. Phase 3 (WS-H): rules, storage, indexes, scripts, functions ═════════════════════════════════════════════
// The partner terms in the server-side surfaces are gone: firestore.rules (isPartner(), every `!isPartner()` clause, the partner_deals rule, the Partners posts
// carve-out, the partnerUid read term), storage.rules (isPartnerClaim()), firestore.indexes.json (the partner_deals index), the backup / sync scripts and
// the two partner-drop lines in functions/index.js. scripts/partner-data-purge.js and tests/partner-data-purge.test.mjs legitimately name partner_deals and the
// partner role (they are the purge) and are excluded BY NAME below — nothing else is.
const rawHits = (rel, re) => read(rel).split('\n').map((text, i) => (re.test(text) ? `${rel}:${i + 1}  ${show(text)}` : null)).filter(Boolean);   // raw text: comments count
const RULES_STRIP = (raw, keep = false) => {                      // comments out; string literals blanked (so a bracket or a // inside a string cannot fool the checks) unless `keep`
  let out = '', i = 0;
  while (i < raw.length) {
    const c = raw[i], d = raw[i + 1];
    if (c === "'" || c === '"') { let j = i + 1; while (j < raw.length && raw[j] !== c) { if (raw[j] === '\\') j++; j++; } out += keep ? raw.slice(i, j + 1) : c + ' '.repeat(Math.max(0, j - i - 1)) + c; i = j + 1; continue; }
    if (c === '/' && d === '/') { while (i < raw.length && raw[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const j = raw.indexOf('*/', i + 2); const end = j < 0 ? raw.length : j + 2; out += raw.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
    out += c; i++;
  }
  return out;
};
const QUOTED_PARTNER = /(['"])partner\1/;
const RULES_BUILTINS = new Set(['get', 'exists', 'getAfter', 'existsAfter', 'string', 'int', 'float', 'bool', 'path', 'debug', 'duration', 'timestamp', 'latlng', 'hashing', 'math', 'in', 'is']);
function rulesProblems(raw) {                                      // a deleted helper that is still called, or an unbalanced bracket, would fail the deploy
  const code = RULES_STRIP(raw), problems = [];
  const stack = [];
  const pair = { ')': '(', ']': '[', '}': '{' };
  code.split('\n').forEach((line, ln) => {
    for (const ch of line) {
      if ('([{'.includes(ch)) stack.push([ch, ln + 1]);
      else if (pair[ch]) { const top = stack.pop(); if (!top || top[0] !== pair[ch]) { problems.push(`line ${ln + 1}: unbalanced "${ch}"`); return; } }
    }
  });
  for (const [ch, ln] of stack) problems.push(`line ${ln}: "${ch}" is never closed`);
  const defined = new Set([...code.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]));
  const called = new Map();
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_]\w*)\s*\(/g)) {
    const name = m[1];
    if (name === 'function' || name === 'match' || name === 'allow' || name === 'if' || name === 'return' || RULES_BUILTINS.has(name) || defined.has(name)) continue;
    called.set(name, code.slice(0, m.index).split('\n').length);
  }
  for (const [name, ln] of called) problems.push(`line ${ln}: ${name}() is called but never defined`);
  return problems;
}
const PHASE3_PURGE_EXEMPT = new Set(['scripts/partner-data-purge.js']);
const scriptFiles = fs.readdirSync(path.join(ROOT, 'scripts')).filter((n) => n.endsWith('.js')).map((n) => `scripts/${n}`).filter((rel) => !PHASE3_PURGE_EXEMPT.has(rel)).sort();
const FUNCTIONS_JS = (() => { const raw = read('functions/index.js'); return { rel: 'functions/index.js', raw, code: jsCode(raw, 'functions/index.js') }; })();
const FUNCTIONS_AEC_LINES = { 'functions/index.js': ["const terminal = ['partner', 'dormant'];"] };    // the AEC contact stage in the daily digest — EXACT line content, like the js/ allowlist

// Every `allow ...: if <expr>;` and every function `return` / `let` of a rules file, keyed by the chain of enclosing match paths / functions (comments gone, string literals
// kept). The expression of one statement is returned whole, however many lines it spans.
function ruleStatements(raw) {
  const text = RULES_STRIP(raw, true), out = [], stack = [], seen = new Map();
  const readExpr = (pos) => {                                       // up to the first `;` at bracket depth 0
    let depth = 0, i = pos;
    while (i < text.length) {
      const c = text[i];
      if (c === "'" || c === '"') { let j = i + 1; while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; } i = j + 1; continue; }
      if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === ';' && depth === 0) return { expr: text.slice(pos, i), end: i + 1 };
      i++;
    }
    throw new Error('unterminated rules expression');
  };
  let pos = 0, m;
  const push = (kind, expr) => {
    const key = (stack.filter((x) => x !== 'service' && !x.includes('{database}') && !x.includes('{bucket}')).join(' > ') + ' :: ' + kind).trim();
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    out.push({ key: `${key} #${n}`, expr: expr.replace(/\s+/g, ' ').trim() });
  };
  for (;;) {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (pos >= text.length) break;
    const rest = text.slice(pos, pos + 400);
    if ((m = rest.match(/^rules_version\s*=\s*'[^']*'\s*;/))) { pos += m[0].length; continue; }
    if ((m = rest.match(/^service\s+[\w.]+\s*\{/))) { stack.push('service'); pos += m[0].length; continue; }
    if ((m = rest.match(/^match\s+(\/\S*)\s*\{/))) { stack.push(m[1]); pos += m[0].length; continue; }
    if ((m = rest.match(/^function\s+(\w+)\s*\(([^)]*)\)\s*\{/))) { stack.push('fn ' + m[1]); pos += m[0].length; continue; }
    if ((m = rest.match(/^allow\s+([^:]+):\s*(?:if\s+)?/))) {
      const methods = m[1].split(',').map((x) => x.trim()).sort().join(',');
      pos += m[0].length; const r = readExpr(pos); pos = r.end; push('allow ' + methods, r.expr); continue;
    }
    if ((m = rest.match(/^return\s+/))) { pos += m[0].length; const r = readExpr(pos); pos = r.end; push('return', r.expr); continue; }
    if ((m = rest.match(/^let\s+(\w+)\s*=\s*/))) { pos += m[0].length; const r = readExpr(pos); pos = r.end; push('let ' + m[1], r.expr); continue; }
    if (text[pos] === '}') { stack.pop(); pos++; continue; }
    throw new Error('cannot parse the rules near ' + JSON.stringify(rest.slice(0, 100)));
  }
  return out;
}
const SNAP_PATH = 'tests/fixtures/rules-profile-statements.json';
const snapshotOf = (rules, storage) => ({
  firestoreProfile: ruleStatements(rules).filter((x) => /\bhasProfile\(\)/.test(x.expr) && !/fn hasProfile/.test(x.key)).map((x) => x.key).sort(),
  firestoreBare: ruleStatements(rules).filter((x) => /allow [^:]*\b(read|get|list)\b/.test(x.key) && x.expr === 'isAuth()').map((x) => x.key).sort(),
  storageRoleClaim: ruleStatements(storage).filter((x) => /\bhasRoleClaim\(\)/.test(x.expr) && !/fn hasRoleClaim/.test(x.key)).map((x) => x.key).sort(),
});

describe('Phase 3 scanners (synthetic input)', () => {
  it('rulesProblems: balanced and fully-defined rules pass; a deleted helper that is still called, or a stray bracket, is reported', () => {
    const ok = "service x { match /a/{b} { function f(u) { return get(/databases/$(database)/documents/users/$(u)).data.role == 'x'; } allow read: if isAuth() && f(1); function isAuth() { return request.auth != null; } } }";
    assert.deepEqual(rulesProblems(ok), []);
    assert.deepEqual(rulesProblems("match /a/{b} { allow read: if isAuth() && !isPartner(); function isAuth() { return true; } }").map((p) => p.replace(/^line \d+: /, '')), ['isPartner() is called but never defined']);
    assert.equal(rulesProblems("match /a/{b} { allow read: if (isAuth(; }").length > 0, true);
    assert.deepEqual(rulesProblems("// isPartner() in a comment\nmatch /a/{b} { /* isPartner() */ allow read: if request.auth != null; }"), [], 'comments are ignored');
    assert.deepEqual(rulesProblems("match /a/{b} { allow read: if request.auth.token.note == 'oops ( [ {'; }"), [], 'brackets inside a string are ignored');
  });
  it("scanRoleLiterals(only='functions/'): the exact AEC stage line is allowed, an edited one and any other quoted 'partner' is not", () => {
    const f = (raw) => ({ rel: 'functions/index.js', raw, code: jsCode(raw, 'functions/index.js') });
    const run = (raw) => scanRoleLiterals([f(raw)], 'functions/', FUNCTIONS_AEC_LINES);
    assert.deepEqual(run("function d() {\n  const terminal = ['partner', 'dormant'];\n}\n").offenders, []);
    assert.equal(run("function d() {\n  const terminal = ['partner', 'dormant', 'lost'];\n}\n").offenders.length, 1, 'an edited line is no longer the allowed one');
    assert.equal(run("function d(uid, uidRole) {\n  if (uidRole.get(uid) === 'partner') return;\n}\n").offenders.length, 1, 'the partner-drop line');
    assert.equal(run("function d(u) {\n  // 'partner' in a comment\n  return u;\n}\n").offenders.length, 0, 'comments are ignored');
  });
});

describe('Phase 3: the public quote brand has no generic-partner branch (js/screens/sales.js, run for real)', () => {
  const SALES = read('js/screens/sales.js');
  const piece = (re, what) => { const m = SALES.match(re); assert.ok(m, `${what} not found in js/screens/sales.js`); return m[0]; };
  const BRANDS = piece(/^window\.QUOTE_BRANDS = \{[\s\S]*?\n\};\n/m, 'window.QUOTE_BRANDS');
  const BUILD = piece(/^window\.buildPublicQuoteDoc = function[\s\S]*?\n\};\n/m, 'window.buildPublicQuoteDoc');
  const RESOLVE = piece(/^window\.resolveQuoteBrand = async function[\s\S]*?\n\};\n/m, 'window.resolveQuoteBrand');
  const ctx = vm.createContext({ firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } }, db: { collection() { throw new Error('resolveQuoteBrand must not read Firestore any more'); } } });
  ctx.window = ctx;
  for (const src of [BRANDS, BUILD, RESOLVE]) vm.runInContext(src, ctx);
  const brandOf = async (company) => { const r = await ctx.window.resolveQuoteBrand({ company, createdBy: 'someone' }); return { co: r.co, name: r.brand.name }; };
  const docOf = (company) => ctx.window.buildPublicQuoteDoc({ company, items: [] }, { name: 'n' }, 'bk_quotes', 'q1').co;
  it('resolveQuoteBrand is the QUOTE_BRANDS lookup and nothing else: no Firestore read of a creator, no synthesised brand', () => {
    const code = stripComments(RESOLVE);
    assert.ok(!/\bdb\b|coName|artnership|createdBy|\.doc\(/.test(code), 'resolveQuoteBrand reads a user or builds a brand of its own');
    assert.ok(/QUOTE_BRANDS\[quote\.company\]/.test(code) && /return \{ co, brand: window\.QUOTE_BRANDS\[co\] \};/.test(code));
  });
  it('BK, BI and BS keep their own letterhead', async () => {
    assert.deepEqual(await brandOf('BK'), { co: 'BK', name: 'BARRO KITCHENS' });
    assert.deepEqual(await brandOf('BI'), { co: 'BI', name: 'BARRO INDUSTRIES OPC' });
    assert.deepEqual(await brandOf('BS'), { co: 'BS', name: 'BRILLIANT STEEL CORPORATION' });
    for (const c of ['BK', 'BI', 'BS']) assert.equal(docOf(c), c);
  });
  it("any other code — the retired 'PT', a missing company, an unknown one — falls back to Brilliant Steel (and never reads Firestore for a creator's company)", async () => {
    for (const c of ['PT', undefined, null, '', 'XX', 'bk']) {
      assert.deepEqual(await brandOf(c), { co: 'BS', name: 'BRILLIANT STEEL CORPORATION' }, String(c));
      assert.equal(docOf(c), 'BS', `buildPublicQuoteDoc(${String(c)})`);
    }
  });
});

describe('Phase 3: the server-side surfaces carry no partner term', () => {
  const RULES = read('firestore.rules'), STORAGE = read('storage.rules');
  it('firestore.rules: no isPartner, no partner_deals, no partnerUid, no quoted "Partners" department, no quoted \'partner\' role — comments included for the identifiers', () => {
    assert.deepEqual(rawHits('firestore.rules', /isPartner|partner_deals|partnerUid|(['"])Partners\1/), []);
    assert.deepEqual(RULES_STRIP(RULES).split('\n').map((t, i) => (QUOTED_PARTNER.test(t) ? `firestore.rules:${i + 1}  ${show(t)}` : null)).filter(Boolean), []);
  });
  it('firestore.rules: there is no rule for the deleted partner_deals collection (no match block = deny-all), and the users-create allowlist names no partner', () => {
    assert.ok(!/match \/partner_deals\b/.test(RULES));
    const create = RULES.match(/match \/users\/\{uid\} \{[\s\S]*?allow create:[\s\S]*?\n      \);/);
    assert.ok(create, 'could not find the users create rule');
    assert.ok(!/partner/i.test(create[0]), 'the users create rule names a partner role');
  });
  it('storage.rules: no isPartnerClaim (comments included), no quoted \'partner\' role in code', () => {
    assert.deepEqual(rawHits('storage.rules', /isPartnerClaim|isPartner\b/), []);
    assert.deepEqual(RULES_STRIP(STORAGE).split('\n').map((t, i) => (QUOTED_PARTNER.test(t) ? `storage.rules:${i + 1}  ${show(t)}` : null)).filter(Boolean), []);
  });
  it('both rules files are well-formed: brackets balance and every helper that is called is still defined (a deleted helper cannot stay in use)', () => {
    assert.deepEqual(rulesProblems(RULES), [], 'firestore.rules');
    assert.deepEqual(rulesProblems(STORAGE), [], 'storage.rules');
  });
  it('firestore.indexes.json: valid JSON with no partner_deals index and no partnerUid field', () => {
    const j = JSON.parse(read('firestore.indexes.json'));
    assert.ok(Array.isArray(j.indexes) && j.indexes.length > 20, 'the indexes file lost its indexes');
    assert.deepEqual(j.indexes.filter((x) => x.collectionGroup === 'partner_deals').length, 0);
    assert.deepEqual(rawHits('firestore.indexes.json', /partner/i), []);
  });
  it('scripts/check-backup-coverage.js and scripts/sync-to-drive.js name no partner_deals', () => {
    for (const rel of ['scripts/check-backup-coverage.js', 'scripts/sync-to-drive.js']) assert.deepEqual(rawHits(rel, /partner_deals/), [], rel);
  });
  it('the Phase-3 acceptance grep is empty: no isPartner / partner_deals / isPartnerClaim in firestore.rules, storage.rules, firestore.indexes.json, any scripts/*.js (the purge script excepted BY NAME) or functions/index.js', () => {
    assert.ok(scriptFiles.length >= 8 && scriptFiles.includes('scripts/sync-to-drive.js') && !scriptFiles.includes('scripts/partner-data-purge.js'), 'the script walk is wrong');
    const files = ['firestore.rules', 'storage.rules', 'firestore.indexes.json', ...scriptFiles, 'functions/index.js'];
    assert.deepEqual(files.flatMap((rel) => rawHits(rel, /isPartner|partner_deals|isPartnerClaim/i)), []);
  });
  it("functions/index.js: no 'partner' role test — the only quoted 'partner' is the AEC contact stage in the daily digest, allowed by EXACT line content", () => {
    const R = scanRoleLiterals([FUNCTIONS_JS], 'functions/', FUNCTIONS_AEC_LINES);
    assert.deepEqual(R.offenders, [], "a 'partner' role test is back in the Cloud Functions");
    assert.deepEqual(R.aec, ["functions/index.js  const terminal = ['partner', 'dormant'];"], 'the AEC allowlist entry must match exactly one line (a renamed line makes this fail)');
  });
  it('the notification recipients are Sales + President with no role special case (cirNotifyStaff / qrNotifyStaff / resolveSalesAndPresidentUids)', () => {
    const code = FUNCTIONS_JS.code;
    for (const fn of ['resolveSalesAndPresidentUids', 'cirNotifyStaff', 'qrNotifyStaff']) {
      const i = code.indexOf(`async function ${fn}(`);
      assert.ok(i > 0, `${fn} is gone`);
      const body = code.slice(i, code.indexOf('\n}\n', i));
      assert.ok(!/partner|uidRole|\.role\b/i.test(body), `${fn} special-cases a role`);
    }
  });
});

describe('Phase 3: nothing widens — the retired partner term stands in as hasProfile() / hasRoleClaim(), in the same position', () => {
  // Removing the old `!isPartner()` / `!isPartnerClaim()` term is not free: reading the caller's users doc (or a missing `role` claim) THROWS for an identity
  // that has none, and a throwing rule denies — so the term also refused every signed-in identity with no users doc. Dropping it would have opened ~110 rules
  // to such an identity. The coordinator's ruling (2026-10-28): same position, same refusal. These pins keep it that way.
  const RULES = read('firestore.rules'), STORAGE = read('storage.rules');
  const FIX = JSON.parse(read(SNAP_PATH));
  const NOW = snapshotOf(RULES, STORAGE);
  if (process.env.UPDATE_RULES_SNAPSHOT) fs.writeFileSync(path.join(ROOT, SNAP_PATH), JSON.stringify({ _about: FIX._about, firestoreProfile: NOW.firestoreProfile, firestoreBare: NOW.firestoreBare, storageRoleClaim: NOW.storageRoleClaim }, null, 1) + '\n');
  it('hasProfile() is the CACHED get() of users/{uid}, defined once — not exists(): exists() before get() is not cached for the get (an extra billed read and access call) and returns false where the old term errored', () => {
    const defs = RULES_STRIP(RULES, true).match(/function hasProfile\(\) \{[^}]*\}/g) || [];
    assert.equal(defs.length, 1, 'hasProfile() must be defined exactly once');
    assert.equal(norm(defs[0]), 'function hasProfile() { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data != null; }');
    assert.ok(!/exists\(\s*\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)/.test(RULES_STRIP(RULES)), 'an exists() of the caller\'s own users doc is back');
  });
  it('the 111 statements that carried the retired term in HEAD still require a profile — the list is pinned (tests/fixtures/rules-profile-statements.json)', () => {
    assert.equal(FIX.firestoreProfile.length, 111);
    assert.deepEqual(NOW.firestoreProfile, FIX.firestoreProfile);
  });
  it('and no read has become a bare `isAuth()`: the five that always were are the only ones', () => {
    assert.deepEqual(FIX.firestoreBare, ['/_counters/{docId} :: allow read #1', '/productMeta/{docId} :: allow read #1', '/products/{docId} :: allow read #1', '/settings_holidays/{year} :: allow read #1', '/users/{uid} :: allow get #1']);
    assert.deepEqual(NOW.firestoreBare, FIX.firestoreBare);
  });
  it('the sensitive reads named by the review still sit behind it: client info requests and quote requests (+ their notes), clients, quote costs, approvals, gov biddings, the users list and the counters write', () => {
    const stmts = ruleStatements(RULES);
    const need = [['/client_info_requests/{ref} :: allow read #1'], ['/client_info_requests/{ref}/notes/{nid} :: allow read #1'], ['/quote_requests/{ref} :: allow read #1'], ['/quote_requests/{ref}/notes/{nid} :: allow read #1'],
      ['/clients/{docId} :: allow read #1'], ['/quote_costs/{id} :: allow read,write #1'], ['/approval_requests/{docId} :: allow read #1'], ['/gov_biddings/{docId} :: allow read #1'],
      ['/users/{uid} :: allow list #1'], ['/_counters/{docId} :: allow write #1'], ['/worker_directory/{docId} :: allow read #1'], ['/tasks/{taskId} :: allow read #1']];
    for (const [key] of need) {
      const s = stmts.find((x) => x.key === key);
      assert.ok(s, `no such statement: ${key}`);
      assert.ok(/\bhasProfile\(\)/.test(s.expr), `${key} no longer requires a profile: ${s.expr}`);
    }
  });
  it('the retired term was in 112 expressions; hasProfile() is in at least that many places (a removal fails here even if the list above was edited with it)', () => {
    assert.ok((RULES_STRIP(RULES).match(/\bhasProfile\(\)/g) || []).length >= 112 + 1, 'hasProfile() used in fewer places than the term it replaced');
  });
  it('the only arms dropped with the partner are the three that named it — the \'partner\' member of the users-list role filter, the Partners-department posts arm, the partnerUid job_projects arm — and each is unreachable now', () => {
    const stmts = ruleStatements(RULES);
    assert.match(stmts.find((x) => x.key === '/users/{uid} :: allow list #1').expr, /^isAuth\(\) && \( hasProfile\(\) \|\| resource\.data\.get\('role', ''\) in \['president', 'manager'\] \)$/);
    assert.equal(stmts.find((x) => x.key === '/posts/{postId} :: allow read #1').expr, 'isAuth() && hasProfile()');
    assert.equal(stmts.find((x) => x.key === '/job_projects/{docId} :: allow read #1').expr, 'isAuth() && (resource.data.createdBy == request.auth.uid || hasProfile())');
  });
  it('the arms that are NOT partner-named stay verbatim, so every identity gets the same decision as before: tasks (assignedTo), settings (system), order_tracking and public_quotes (own source)', () => {
    const stmts = ruleStatements(RULES), at = (key) => stmts.find((x) => x.key === key).expr;
    assert.match(at('/tasks/{taskId} :: allow read #1'), /hasProfile\(\) \|\| request\.auth\.uid in resource\.data\.get\(/);
    assert.match(at('/settings/{docId} :: allow read #1'), /hasProfile\(\) \|\| docId ==/);
    assert.match(at('/order_tracking/{token} :: allow create #1'), /hasProfile\(\)\s*\|\|\s*\(\s*request\.resource\.data\.get\([^)]*\) != ''\s*&& exists\(/);
    assert.match(at('/public_quotes/{token} :: allow update #1'), /hasProfile\(\) \|\| \(srcIsMine\(resource\.data\) && srcIsMine\(request\.resource\.data\)\)/);
  });
  it('storage.rules: hasRoleClaim() is `\'role\' in request.auth.token`, defined once, and sits in the eleven statements the retired claim term sat in', () => {
    const defs = RULES_STRIP(STORAGE, true).match(/function hasRoleClaim\(\) \{[^}]*\}/g) || [];
    assert.equal(defs.length, 1, 'hasRoleClaim() must be defined exactly once');
    assert.equal(norm(defs[0]), "function hasRoleClaim() { return 'role' in request.auth.token; }", "hasRoleClaim() must test presence with `'role' in request.auth.token` (it never throws; reading request.auth.token.role would)");
    assert.equal(FIX.storageRoleClaim.length, 15);   // 11 at the partner removal; audit 2026-10-28 H1 split read → get+list and gave HR its own block
    assert.deepEqual(NOW.storageRoleClaim, FIX.storageRoleClaim);
  });
});
