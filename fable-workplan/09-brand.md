# Workstream 09 — window.BRAND source of truth + full rename sweep

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

No `window.BRAND` (or any brand module) exists anywhere in the repo — `grep -rn "window.BRAND\|const BRAND"` returns nothing except quote-builder-v2.html's unrelated `CO` object. Branding is scattered as raw literal strings across ~10 files in several incompatible technical contexts (plain pre-JS HTML head, JS-rendered chrome, a browser-parsed manifest.json, two Worker-scope service workers with no `window`). Phase 1 (already committed on branch `v12`) renamed SOME of index.html's live chrome from "Operations System"/"BI Ops" to "Barro Industries"/"Operating System" but left manifest.json, sw.js's header comment, and several print-footer strings on the old phrasing — the rename is inconsistent today, not merely incomplete.

1) index.html (re-verified live):
- L6 `<title>Barro Industries Operating System</title>`; L7 meta description same phrase.
- L11 `<meta name="apple-mobile-web-app-title" content="BI Ops"/>` — NOT touched by Phase 1, still old short form.
- L15 `<link rel="manifest" href="manifest.json"/>`.
- L44-45 splash: `<span class="splash-word-main">Barro Industries</span><span class="splash-word-sub">Operating System</span>`.
- L61-62 login: `<h1 class="login-title">Barro Industries</h1><p class="login-sub">Operating System</p>`.
- L157 `<div class="login-version" id="login-version-str">v12.0.0 · Barro Industries</div>`.
- L177-178 topbar: `<span class="topbar-brand-main">Barro Industries</span><span class="topbar-brand-sub" id="topbar-version-str">Operating System · v12.0.0</span>`.
- L296-306 and L310-317: TWO separate inline `<script>` blocks (one `defer` right after config.js, one on `window.addEventListener('load', …)`) each independently rebuild the SAME text via string concatenation: `_lvEl.textContent = 'v' + _v + ' · Barro Industries'` and `_tbEl.textContent = 'Operating System · v' + _v` (fallback `_v = window.APP_VERSION || '9.4'`). Two call sites doing the identical concatenation is itself a duplication smell.

2) manifest.json — NOT updated by Phase 1: `"name": "Barro Industries Operations"`, `"short_name": "BI Ops"`, `"description": "Barro Industries Internal Operations System"`. Still says "Operations", contradicts the vision doc's "Operating System" rename. This file is fetched and parsed by the browser directly — it cannot execute JS or read `window.BRAND`.

3) sw.js: header comment (L2) "Barro Industries — Service Worker v16" (stale — CACHE_VER is actually v162, comment drifted). L11 `const CACHE_VER = 'bi-ops-v162';` (STATIC/RUNTIME derive from it) — the "bi-ops" prefix is the old short name baked into the cache-bucket key; functionally harmless (just a string key) but semantically stale. L16-34 `PRECACHE` array lists file paths only, no brand text — but per CLAUDE.md, any new brand file must be added here + bump CACHE_VER. sw.js runs in a Service Worker global scope (`self`), not `window` — it cannot read `window.BRAND` even if config.js is loaded on the page.

4) firebase-messaging-sw.js (separate SW, also worker-scope, no `window`): L2 header comment "Barro Industries — Firebase Cloud Messaging Service Worker"; L38 `const notifTitle = data.title || 'Barro Industries';` (push-notification title fallback); L60 `badge: '/icons/barro-logo.png'` — yet another distinct logo file from the ones used elsewhere.

5) functions/index.js L48: `title: title.trim() || 'Barro Industries',` — the SAME push-title fallback as firebase-messaging-sw.js L38, in a totally separate deploy pipeline (`cd functions && npm run deploy`, not `git push`). These two fallbacks must be kept in sync manually today.

6) track.html (36 lines total): L6 `<title>Track Your Order — Barro Industries</title>`; L13-23 full Open Graph/Twitter card block: `og:site_name` "Barro Industries", `og:title`/`twitter:title` "Track Your Order — Barro Industries", `og:image`/`twitter:image` and `og:url` all hardcode the absolute custom domain `https://barroindustries-operatingsystem.ravenmails.com/...` THREE times in one file. That domain also lives in the repo-root `CNAME` file (`barroindustries-operatingsystem.ravenmails.com`) as a fourth, independent copy.

7) quote-builder-v2.html — the closest thing to an existing "brand config" pattern:
- L6 `<title>Quote Builder v2 — Barro Kitchens</title>` — static regardless of which company (`currentCo`) is actually selected in the UI.
- L940-948: the `CO` object — `CO.BK` (name, sub, addr, contact, sig{name,title}, nav, code, thanks, creds) and `CO.BS` (same shape) with hardcoded legal/marketing copy ("Barro Industries OPC", "DTI/BIR Registered", "hello@barroindustries.com", "0927 683 6300", full address, president/rep signature blocks).
- L1113-1128: at runtime, if `?portal=partner&pcoName=…` is present, a THIRD entry `CO.PT` is synthesized from URL query params (company name, contact, signatory) — this is a dynamic, non-static "brand" entry that doesn't come from any config file at all (see generic-partner-portal memory note).
- L1130-1140 `applyPartnerMode()` re-labels the `#coBS` DOM button to `CO.PT.name` for generic partners, or hides the BK option entirely for true Brilliant Steel partners.
- This CO object is entirely local to quote-builder-v2.html, which is loaded via `<iframe>` from Sales/Partners tabs with zero dependency on the parent app's `js/config.js` today.

8) js/departments.js — at least FIVE independently hand-rolled print/letterhead templates, each hardcoding company identity differently (major overlap with workstream 14):
- HR payslip (~L4290-4340): logo `<img src="icons/barro-industries.png">`, `<div class="company-name">${escHtml(co.toUpperCase())}</div>`, then a literal address/contact/TIN block: L4310-4313 `NEILBARRO STEEL & METAL FABRICATION SERVICES<br/>PUROK 6, CARLATAN, 2500, CITY OF SAN FERNANDO, LA UNION, PHILIPPINES<br/>CONTACT: NEIL BARRO, 0927-683-6300<br/>TIN: 951-145-613-000`.
- Billing Invoice (~L6795-6804): identical logo + identical address/contact/TIN block verbatim duplicated (`grep -n "CARLATAN"` hits exactly these two lines, 4311 and 6801), but `company-name` hardcoded literally `BARRO INDUSTRIES` (not templated even by the local `co` var like the payslip is).
- Purchase Order print (~L12716-12759): a DIFFERENT CSS/markup shape (`.htop/.cname/.csub/.title`), logo via a computed absolute `logoUrl = location.origin + location.pathname.replace(...) + 'icons/barro-industries.png'` (L12657) rather than a bare relative `src`, `<div class="cname">BARRO INDUSTRIES</div><div class="csub">Barro Industries OPC · DTI / BIR Registered<br>hello@barroindustries.com · 0927 683 6300 · La Union | Baguio | Manila</div>`, signature line "NEIL BARRO … President, Barro Industries OPC", and footer L12759 `Barro Industries Operations System · Generated …` — STILL says "Operations System", not renamed.
- Physical Inventory Count Form (~L11939-12023): shares the same `.htop`/computed-`logoUrl` pattern as the PO (L11939 near-identical duplicate of the PO's logoUrl line), `<div class="cname">BARRO INDUSTRIES</div>`, and footer L12023 `Barro Industries Operations System · Generated … · Physical count supersedes system quantity upon approval.` — again the old "Operations System" phrase.
- BK quote print (`printQuote`-equivalent for Barro Kitchens quotes, ~L5560-5627): a THIRD, completely separate CSS theme (gold `#c8a45a` accent), `<div class="brand">🍽️ Barro Kitchens</div><div class="brand-sub">A Trademark of Barro Industries OPC</div>`, footer L5626 `Barro Kitchens · Barro Industries OPC · This quotation is valid until …`. Does not read `CO` from quote-builder-v2.html at all (fully independent, hand-typed).
- BS quote print header (~L7693-7710): a FOURTH separate template (`.bs-print-header`), logo `icons/barro-industries.png`, hardcoded `<div>BRILLIANT STEEL</div><div>Steel Fabrication & Design</div>` — also does not reference `CO.BS`; independently drifted from quote-builder-v2.html's BS config.
- A legacy generic `printQuote()` (~L9096-9111, likely dead/superseded per workstream 31's "delete ~1,800 lines of dead builder code"): title `Quote — Barro Industries`, `<div class="logo">Barro Industries</div>`, tagline "Professional Kitchen, Steel & Engineering Solutions".
- Other scattered department-name literals: L3683 company picklist `['Barro Kitchens','Barro Industries','Brilliant Steel','Finance','HR','Operations','General']`; L5167 SOP header "Barro Industries · Sales Department · Standard Operating Procedure"; L12254 placeholder text "e.g. Barro Industries — La Union Plant, Brgy. …"; L12737 default `Deliver To` value `'Barro Industries OPC'`.

9) js/app.js:
- TWO more independent payslip print templates, near-duplicates of each other: `printPayslip()` (L4666-4685, self-serve employee payslip) and `printWorkerPayslip()` (L4970-5004, admin-generated worker payslip) — both hardcode `<div class="company">BARRO INDUSTRIES</div>` and footer `System-generated payslip · Barro Industries · ${now...}` (L4681 and L5000, identical string in both files' copies).
- Live "Company" page (`renderCompany`, L5211-5238): a chip-tab bar including a tab literally labelled `'BI Ops System'` (L5223) that calls `renderCompanyBiOps()` (L5241-5313) — hero text "BI OPS SYSTEM" / "Business Intelligence Operations Platform" (L5249-5251, L5259), footer badge L5308 `BARRO INDUSTRIES · BI OPS · 2026`. This copy describes the app as a narrow BI/analytics tool, which directly contradicts the v12 vision ("combination of all apps needed for a business") — this is not just a stale name, the whole tab's positioning copy is now false.
- The DEFAULT tab, `renderCompanyOverview()` (L5316 onward): separate hero L5333-5336 `<img ... alt="Barro Industries">`, `<h1 class="co-hero-title">BARRO INDUSTRIES</h1><p class="co-hero-tagline">Building the Future, Brick by Brick.</p>`, About-copy paragraphs L5344-5352 naming "Barro Industries OPC" repeatedly, and a "Trademark"/brand card section beneath it.
- ID card generation (L3207): `<img src="icons/barro-industries.png" alt="Barro Industries" class="id-card-logo">`.
- Numerous inline narrative-prose mentions of "Barro Industries" in onboarding/help/handbook copy (L510, 530, 3735-3738, 3827, 5960, 7449-7636 Partner Guide text, etc.) — these read as ordinary sentences referencing the company name, not identity chrome.

10) js/modules.js:
- L1748-1803 `renderCompanyOverviewNew()` — a DEAD function (grep confirms zero call sites anywhere in the codebase; only `renderCompanyOverview` in app.js is wired into the live "Company" page). Has yet ANOTHER, third variant of the About-page copy/tagline ("One Person Corporation · SEC Registered") and its own Trademarks card list.
- L347 (notifications.js, not modules.js) `{ to_email: email, subject, message: body, company: 'Barro Industries' }` — EmailJS template param.
- L435/444/611/658/768/1817/1831 — Employee-of-the-Month and invite-modal copy naming "Barro Industries"/"employee@barroindustries.com" as placeholder/prose.

11) js/config.js: no BRAND object; has the precedent structures `window.APP_VERSION` (L8, auto-bumped by the pre-commit hook — do not hand-edit), `window.DEPARTMENTS` (L95-121, a keyed object with `{key, icon, color, subtabs, navOrder, isSeparate/isPartnerDept}` per department — a real structural precedent for how a per-company BRAND sub-table could be shaped), `window.ROLES`, `window.DRIVE_CONFIG`/`window.SHEETS_CONFIG` (flat config-object precedent for external integration settings).

12) Logo asset sprawl in /icons: at least 5 distinct files are referenced as "the Barro Industries logo" across different screens — `icons/bi-logo.svg` (index.html splash/login/topbar), `icons/barro-industries.png` (department print headers, ID cards, Company tab), `icons/barro-logo.png` (firebase-messaging-sw.js push badge only), `icons/icon-192.png`/`icon-512.png` (PWA manifest icons, also reused ad hoc in modules.js dead code), `icons/barrokit.png` (Barro Kitchens sub-brand). Additional files with no confirmed call site in the current tree: `icon_192.png`/`icon_512.png` (underscore duplicates of the hyphenated ones actually used), `logo biops.png` (space in filename, referenced only from a standalone repo-root file `Barro Industries - BI Ops Company Info.html` which is not loaded by index.html/sw.js), `barrobuild.png` (no referencing call site found via grep).

13) Existing Firestore precedent for a possible "admin-editable" BRAND: `settings/{docId}` collection already exists and is used for unrelated admin config (`settings/system`, `settings/employeeOfMonth`, `settings/sales_sop` — see js/app.js L135/5485/6554, js/modules.js L563/592/764, js/departments.js L5096/5284). firestore.rules L258-261: `match /settings/{docId} { allow read: if isAuth(); allow write: if isAuth() && isPresident(); }` — read requires an authenticated session, which the splash screen, login screen, track.html (public), and manifest.json/sw.js (no Firestore access at all in their execution context) do NOT have.

14) A stray `.claude/worktrees/wf_783ec1d0-56d-1/` directory in the repo contains an older, out-of-date copy of sw.js/functions/index.js/firebase-messaging-sw.js from a prior session's worktree — not part of the checked-out `v12` branch content; ignore it, do not let it contaminate a repo-wide grep sweep.

## Data model

This workstream has almost no Firestore data model of its own — BRAND is fundamentally static configuration, not user data — but the real-world VALUES it must encode, harvested from actual code, are:

Company/system identity: legal-ish display name "Barro Industries"; system/product name suffix "Operating System" (full title "Barro Industries Operating System"); short form "BI Ops" (used today as the PWA `apple-mobile-web-app-title` and `manifest.json` short_name — still literally present, not yet decided if it survives the rename); at least three DIFFERENT taglines currently in use for the same company with no reconciliation: "Building the Future, Brick by Brick." (app.js L5336, live), "One Person Corporation · SEC Registered" (modules.js L1758, dead code), "Business Intelligence Operations Platform" (app.js L5251, live but now false positioning).

Legal/document fields (verbatim, duplicated 2-4x per field across departments.js print templates): legal entity "Barro Industries OPC"; registration descriptor "SEC-registered One Person Corporation" / "DTI / BIR Registered" (inconsistent which registration type is cited where); TIN "951-145-613-000" (departments.js L4313, L6803); registered address "NEILBARRO STEEL & METAL FABRICATION SERVICES / PUROK 6, CARLATAN, 2500, CITY OF SAN FERNANDO, LA UNION, PHILIPPINES" (verbatim duplicate at L4310-4311 and L6800-6801) vs. the shorter marketing address "La Union | Baguio City | Manila" used elsewhere (index.html splash area doesn't have this, but quote-builder CO.BK.addr and departments.js PO header do); contact phone in TWO different formats for the identical number — "0927-683-6300" (dashed, departments.js L4312/L6802) vs "0927 683 6300" (spaced, departments.js L12721, quote-builder-v2.html L944/L948); contact email "hello@barroindustries.com"; signatory "NEIL BARRO, President, Barro Industries OPC" appears as a hardcoded literal signature line in at least 3 print templates.

Per-company sub-brand table (mirrors quote-builder-v2.html's existing `CO` object, quoted verbatim): `CO.BK` = {name:'BARRO KITCHENS', sub: one-line descriptor, addr, contact, sig:{name,title}, nav (HTML label with `<span>`), code:'BK', thanks (closing message), creds (footer credit line)}; `CO.BS` = same shape for 'BRILLIANT STEEL CORPORATION' with a different signatory (GERALD CHAN); a THIRD, runtime-only entry `CO.PT` synthesized from URL query params for "generic" (non-Brilliant-Steel) partner companies — name/contact/signatory come from `?pcoName=`/`?pcoContact=`/`?pcoSig=`, not from any static config, so any unified BRAND.companies structure needs to accommodate a dynamically-injected entry, not just static ones.

External/infra identifiers that are brand-adjacent and currently hardcoded in multiple places: the custom tracking domain `barroindustries-operatingsystem.ravenmails.com` (track.html L17/20/23 three times, CNAME file once — 4 independent copies of the same string); the Firebase project id `barro-industries` (firebase-messaging-sw.js L18-19, unrelated to display branding, do not touch).

Existing Firestore precedent, if Fable chooses a partly-dynamic BRAND: `settings/{docId}` documents (e.g. `settings/system`) with `allow read: if isAuth(); allow write: if isAuth() && isPresident();` (firestore.rules L258-261) — this rule shape would need a public-read carve-out (or a dedicated `settings/brand` doc with a relaxed rule) to serve the pre-auth splash/login screens or the fully-public track.html.

## Constraints — must respect

- Script load order is load-bearing (CLAUDE.md): index.html loads Firebase SDK+Chart.js+Lucide → firebase-config.js → config.js → drive.js → notifications.js → departments.js → app.js → modules.js, all deferred. Anything BRAND must be defined and attached to `window` no later than config.js (index.html's own inline version-string script at L296-306 already runs immediately after config.js and depends on `window.APP_VERSION` existing by then — a BRAND object must follow the same contract).
- Any new JS file (e.g. a dedicated js/brand.js) must be added to BOTH index.html's script list (in the correct order) AND sw.js's PRECACHE array (sw.js L16-34), and CACHE_VER (sw.js L11) must be bumped — per CLAUDE.md this is enforced by convention, not tooling; forgetting one produces stale-code symptoms for users.
- sw.js and firebase-messaging-sw.js execute in a Service Worker / separate global scope (`self`), with no `window` object — they physically cannot read `window.BRAND`. Any design must account for this rather than assuming a single JS object reaches every consumer.
- manifest.json is fetched and parsed directly by the browser before any app JS runs — it cannot consume a JS variable at all, static or dynamic (no build step exists in this repo to templating it in).
- Every Firestore collection needs an explicit rules match — no cascade/prefix matching (per CLAUDE.md and the firestore-rules-collection-coverage memory). If BRAND (or any override of it) is stored in Firestore, its collection/doc path needs its own explicit rule, and the existing `settings/{docId}` rule (`allow read: if isAuth()`) does NOT cover pre-auth surfaces (splash, login) or the fully public track.html — a public-read exception would be new rules-surface, not free.
- escHtml() discipline: any BRAND field that gets interpolated into innerHTML (as opposed to being a static compile-time string) must be run through escHtml() per repo convention, especially if any field ever becomes admin-editable.
- Version/cache auto-bump: `window.APP_VERSION` in js/config.js is auto-incremented by `.git/hooks/pre-commit`, which also rewrites `vX.Y.Z` strings in index.html and re-stages both files — do not hand-edit APP_VERSION, and be aware any BRAND field placed too close to that hook's string-matching logic could interact with it.
- Deploy discipline: `git push origin master` deploys the static site (GitHub Pages) but NOT firestore.rules (needs `firebase deploy --only firestore:rules` separately) and NOT Cloud Functions (needs `cd functions && npm run deploy`). functions/index.js's brand fallback string (L48) is on a different deploy path than everything else touched by this workstream.
- Concurrent-edit risk (user memory: deploy-recheck-full-file-diff): this repo is edited live across sessions/OneDrive sync; a wide rename sweep across departments.js/app.js/index.html should re-diff immediately before any deploy step to avoid clobbering unrelated concurrent edits.

## DECIDED — architecture spec (Fable, 2026-07-10)

### Resolved decisions (one-line rulings)

1. **Where BRAND lives → `window.BRAND` object appended to `js/config.js`** (after `ROLES`, before nothing load-bearing). No new file. config.js already loads before index.html's inline version scripts (L298) and before departments/app/modules, so every JS consumer sees it. Rationale: a new `js/brand.js` would force the 3-things-in-lockstep dance (index.html slot + sw PRECACHE + CACHE_VER) for a plain data object, and `importScripts`/`globalThis` still can't reach manifest.json — so a shared worker file buys almost nothing.
2. **Non-JS / worker-scope consumers → permanent literal mirrors + a sync-checklist comment (option a).** manifest.json (browser-parsed), sw.js and firebase-messaging-sw.js (worker `self`, no `window`), and functions/index.js (separate deploy) physically cannot read `window.BRAND`. They keep hardcoded strings; each gets a `// BRAND MIRROR — keep in sync with window.BRAND in js/config.js` comment. A migration-checklist item enumerates all five. This is the honest, low-risk design.
3. **Firestore-backed BRAND → NO. Static-only.** The existing `settings/{docId}` rule requires `isAuth()` to read; splash/login (pre-auth) and public `track.html` cannot satisfy it, and a public-read carve-out is new attack surface for near-zero benefit. President-editable tagline/president-message is deferred (a later, non-mechanical workstream) — noted as out of scope, not built here.
4. **Chrome vs prose → BRAND replaces STRUCTURAL CHROME ONLY (~20 sites). Narrative prose stays literal text.** No `brandName()` helper threaded through sentences. Rationale: keeps the sweep mechanical and small (title/meta/manifest/splash/login/topbar/version/nav/Company-tab hero/print-footer credit lines), and avoids injecting BRAND fields into dozens of prose interpolation points (each an escHtml surface).
5. **Sub-brand data → fold `CO.BK`/`CO.BS` into `window.BRAND.companies.{BK,BS}` in config.js AS THE PARENT-APP SOURCE OF TRUTH; quote-builder-v2.html keeps its OWN local `CO` object (iframe isolation preserved).** The two are declared structurally identical (same field names) with cross-reference comments. `CO.PT` stays runtime-synthesized inside the iframe from URL params — BRAND.companies documents it as "BK/BS static; PT is iframe-runtime-only, not mirrored here." WS14 consumes `BRAND.companies` for departments.js print headers. We do NOT break iframe isolation (no postMessage/query wiring) in this workstream.
6. **Canonical logos per context:** favicon/PWA = `icons/icon-192.png`+`icons/icon-512.png`+`favicon.svg/png` (unchanged); in-app wordmark = `icons/bi-logo.svg`; print-document logo = `icons/barro-industries.png`; push badge = `icons/icon-192.png` (retire the one-off `icons/barro-logo.png` reference). Orphan files (`icon_192.png`/`icon_512.png` underscore dupes, `logo biops.png`, `barrobuild.png`) → DEFER deletion to a separate cleanup task; do NOT delete in this sweep.
7. **Contact formatting → BRAND stores ONE canonical string per field.** Phone canonical = `'0927 683 6300'` (spaced form, matches quote-builder + PO). The dashed `'0927-683-6300'` on payslip/invoice becomes the spaced form when WS14 rewires those headers. No formatter function.
8. **'BI Ops System' Company-tab → minimal chrome swap now, substantive copy rewrite FLAGGED/deferred.** Rename the tab label `'BI Ops System'` → `'The System'` and swap the hero wordmark literal to `BRAND.fullName`; leave the false-positioning body prose ("Business Intelligence Operations Platform") as a `‼️ FLAG FOR NEIL` content item (needs new prose, not a string swap).
9. **Tracking domain → NOT in BRAND.** It is infra/DNS config (CNAME + worker-context track.html, which can't read BRAND). Stays literal. track.html already reads "Barro Industries" (no "Operations System"), so it needs **no change** in this sweep.
10. **Print-header bodies (overlap w/ WS14) → MIDDLE PATH (c): extract the company/address/TIN/contact/signatory literals into `BRAND.legal`/`BRAND.companies` NOW so WS14 has a data source; do NOT restructure the five templates' markup/CSS in WS09.** WS09 only swaps title/meta/manifest/nav/version/Company-tab chrome plus the `"Operations System"`→`"Operating System"` footer strings. WS14 owns rewiring the print headers to consume `BRAND`.

### The BRAND object (exact — append to `js/config.js` after the `ROLES` block)

```js
// ── Brand / Company Identity ─────────────────────
// Canonical source of truth for company/system identity used by all JS-rendered
// chrome (title, splash, login, topbar, version strings, Company tab, nav) AND
// consumed by the WS14 letterhead engine for print-document headers/footers.
//
// NON-JS MIRRORS (cannot read window.BRAND — keep in sync BY HAND):
//   • manifest.json  name/short_name/description   (browser-parsed, pre-JS)
//   • sw.js  header comment + CACHE_VER prefix       (worker scope, no window)
//   • firebase-messaging-sw.js  L38 title fallback    (worker scope)
//   • functions/index.js  L48 title fallback          (separate deploy pipeline)
window.BRAND = {
  name:       'Barro Industries',            // display company name (chrome)
  systemName: 'Operating System',            // product/system suffix
  fullName:   'Barro Industries Operating System',
  shortName:  'Barro Ops',                   // replaces the retired 'BI Ops'
  tagline:    'Building the Future, Brick by Brick.',  // the one live tagline we keep

  legal: {
    // Corporate entity (SEC OPC) — client-facing / marketing documents
    opcName:         'Barro Industries OPC',
    opcRegistration: 'SEC-registered One Person Corporation',
    opcTin:          '',   // ‼️ FLAG FOR NEIL — OPC TIN not present anywhere in code
    // DTI sole-proprietorship trade name — the registered BIR taxpayer today
    // (currently printed on payslips + billing invoices)
    dtiName:         'NEILBARRO STEEL & METAL FABRICATION SERVICES',
    dtiTin:          '951-145-613-000',
    address:         'PUROK 6, CARLATAN, 2500, CITY OF SAN FERNANDO, LA UNION, PHILIPPINES',
    addressShort:    'La Union | Baguio City | Manila',
    phone:           '0927 683 6300',        // canonical spaced form
    email:           'hello@barroindustries.com',
    signatory:       { name: 'NEIL BARRO', title: 'President, Barro Industries OPC' }
  },

  logo: {
    wordmark:  'icons/bi-logo.svg',          // in-app splash/login/topbar
    print:     'icons/barro-industries.png', // print-document header logo (WS14)
    pwaIcon:   'icons/icon-192.png',         // PWA/apple-touch
    pushBadge: 'icons/icon-192.png'          // FCM badge (retires icons/barro-logo.png)
  },

  // Per-company sub-brands. Field shape is IDENTICAL to quote-builder-v2.html's
  // local CO object (that iframe keeps its OWN copy for isolation — see comment there).
  // CO.PT (generic partner) is runtime-synthesized inside the iframe from URL params
  // and is NOT mirrored here.
  companies: {
    BK: { name:'BARRO KITCHENS',
      sub:'Commercial Kitchen One-Stop-Shop  •  Design · Fabricate · Install  •  by Barro Industries OPC',
      addr:'La Union  |  Baguio City  |  Manila', contact:'09276836300  |  hello@barroindustries.com',
      sig:{name:'NEIL BARRO',title:'President, Barro Industries OPC'}, code:'BK',
      thanks:'Thank you for considering Barro Kitchens. We look forward to building a kitchen you can rely on for years.',
      creds:'Barro Industries OPC  •  DTI / BIR Registered  •  hello@barroindustries.com  •  0927 683 6300  •  La Union | Baguio | Manila' },
    BS: { name:'BRILLIANT STEEL CORPORATION', sub:'', addr:'Pasig City, Metro Manila', contact:'09276836300',
      sig:{name:'GERALD CHAN',title:'President, Brilliant Steel Corporation'}, code:'BS',
      thanks:'Thank you for considering Brilliant Steel Corporation. We are committed to quality steelworks delivered on time.',
      creds:'Brilliant Steel Corporation  •  SEC / BIR Registered  •  Pasig City, Metro Manila  •  0927 683 6300' }
  }
};

// Convenience: pick the correct legal entity for a document type.
//   brandEntity('bir')       → DTI trade name + real TIN (payslips, invoices, BIR docs)
//   brandEntity('corporate') → OPC name (quotes, POs, proposals, marketing)
// Consumed by the WS14 letterhead engine. See ‼️ FLAG on entity/TIN below.
window.brandEntity = function(kind){
  const L = window.BRAND.legal;
  if (kind === 'bir') return {
    name: L.dtiName, registration: 'DTI-registered · BIR-registered',
    tin: L.dtiTin, address: L.address, phone: L.phone, email: L.email };
  return {  // 'corporate' (default)
    name: L.opcName, registration: L.opcRegistration,
    tin: L.opcTin, address: L.addressShort, phone: L.phone, email: L.email };
};
```

### Call-site migration table (every site from the brief, bucketed)

| # | File:anchor | Current literal | Action | New value |
|---|---|---|---|---|
| A1 | index.html L6 `<title>` | `Barro Industries Operating System` | SKIP (already correct) | — |
| A2 | index.html L7 meta description | correct | SKIP | — |
| A3 | index.html L11 `apple-mobile-web-app-title` | `BI Ops` | SWAP-STATIC | `Barro Ops` |
| A4 | index.html L44-45 splash spans | correct | SKIP | — |
| A5 | index.html L61-62 login title/sub | correct | SKIP | — |
| A6 | index.html L157 login-version | rebuilt by script | SKIP (script owns it) | — |
| A7 | index.html L177-178 topbar | correct | SKIP | — |
| A8 | index.html L298-305 inline version script | `'v'+_v+' · Barro Industries'` / `'Operating System · v'+_v` | SWAP → `window.BRAND` | see block (b) |
| A9 | index.html L311-319 load-event version script | duplicate concat | SWAP → `window.BRAND` | see block (b) |
| M1 | manifest.json L2 `name` | `Barro Industries Operations` | SWAP-STATIC | `Barro Industries Operating System` |
| M2 | manifest.json L3 `short_name` | `BI Ops` | SWAP-STATIC | `Barro Ops` |
| M3 | manifest.json L4 `description` | `...Internal Operations System` | SWAP-STATIC | `Barro Industries Operating System — the company's central system` |
| S1 | sw.js L2 header comment | `Service Worker v16` | SWAP-STATIC (cosmetic) | `Barro Industries Operating System — Service Worker` |
| S2 | sw.js L11 `CACHE_VER` prefix `bi-ops-` | — | LEAVE (auto-bumped by hook; changing prefix busts all users' caches for zero benefit) | — |
| F1 | firebase-messaging-sw.js L2 comment | correct-ish | SKIP | — |
| F2 | firebase-messaging-sw.js L38 title fallback | `'Barro Industries'` | SWAP-STATIC + MIRROR comment | keep `'Barro Industries'` (already = BRAND.name; add mirror comment) |
| F3 | firebase-messaging-sw.js L60 `badge` | `'/icons/barro-logo.png'` | SWAP-STATIC | `'/icons/icon-192.png'` |
| FN1 | functions/index.js L48 title fallback | `'Barro Industries'` | SWAP-STATIC + MIRROR comment (separate deploy) | keep `'Barro Industries'` (add mirror comment) |
| T1 | track.html (all) | already "Barro Industries" | SKIP | — |
| Q1 | quote-builder-v2.html L6 `<title>` | `Quote Builder v2 — Barro Kitchens` | SWAP-STATIC | `Quote Builder — Barro Industries` |
| Q2 | quote-builder-v2.html L939-949 `CO` | — | LEAVE + add cross-ref comment (`// Mirror of window.BRAND.companies in js/config.js — keep in sync; PT is synthesized below`) | — |
| C1 | app.js L5223 chip label `'BI Ops System'` | — | SWAP | `'The System'` |
| C2 | app.js L5249-5259 hero `BI OPS SYSTEM` / `Business Intelligence Operations Platform` | — | SWAP wordmark to `BRAND.fullName`; FLAG body prose | `‼️ FLAG FOR NEIL` (positioning copy rewrite) |
| C3 | app.js L5308 footer badge `BARRO INDUSTRIES · BI OPS · 2026` | — | SWAP | `Barro Industries · Operating System · 2026` |
| C4 | app.js L5333-5336 renderCompanyOverview hero | correct name, live tagline | SKIP (already `BRAND.tagline` value) | — |
| P1 | departments.js L4290-4340 HR payslip header | address/TIN/contact literals | DEFER-TO-WS14 | — |
| P2 | departments.js L6795-6804 billing invoice header | same literals | DEFER-TO-WS14 | — |
| P3 | departments.js L12716-12759 PO header + footer `Operations System` | — | DEFER-TO-WS14 (header); the footer `Operations System`→`Operating System` string is fixed by WS14's shared footer | — |
| P4 | departments.js L11939-12023 inventory count header + footer `Operations System` | — | DEFER-TO-WS14 | — |
| P5 | departments.js L5560-5627 printBKQuote header | — | DEFER-TO-WS31 (likely dead) | — |
| P6 | departments.js L7693-7710 BS quote header | — | DEFER-TO-WS31 (likely dead) | — |
| P7 | departments.js L9096-9111 legacy printQuote | — | DEFER-TO-WS31 (dead) | — |
| P8 | app.js L4666-4685 printPayslip / L4970-5004 printWorkerPayslip footers `Barro Industries` | — | DEFER-TO-WS24 (legacy payslip consolidation) | — |
| D1 | modules.js L1748-1803 renderCompanyOverviewNew | — | SKIP-DEAD (zero call sites) | — |
| PR1 | app.js L510/530/3735-3738/3827/5960/7449-7636 prose | "Barro Industries" in sentences | SKIP-PROSE | — |
| PR2 | modules.js L435/444/611/658/768/1817/1831 EotM/invite copy | prose/placeholder | SKIP-PROSE | — |
| PR3 | notifications.js L347 EmailJS `company:'Barro Industries'` | template param | SKIP-PROSE (matches BRAND.name; leave literal) | — |
| PR4 | departments.js L3683 company picklist, L5167 SOP header, L12254 placeholder, L12737 deliverTo default | prose/data | SKIP-PROSE | — |

### Before/after code blocks

**(a) index.html L11 — apple title (static swap)**
```html
<!-- before -->
  <meta name="apple-mobile-web-app-title" content="BI Ops"/>
<!-- after -->
  <meta name="apple-mobile-web-app-title" content="Barro Ops"/>
```

**(b) index.html L298-320 — dedupe both version scripts against BRAND**
```html
<!-- before: two blocks concatenating '· Barro Industries' / 'Operating System ·' literally -->
<script defer>
  const _v = window.APP_VERSION || '9.4';
  const _lvEl = document.getElementById('login-version-str');
  if (_lvEl) _lvEl.textContent = 'v' + _v + ' · Barro Industries';
  const _tbEl = document.getElementById('topbar-version-str');
  if (_tbEl) _tbEl.textContent = 'Operating System · v' + _v;
</script>
...
<script>
  window.addEventListener('load', () => {
    if (window.APP_VERSION) {
      const el = document.getElementById('login-version-str');
      if (el) el.textContent = 'v' + window.APP_VERSION + ' · Barro Industries';
      const tb = document.getElementById('topbar-version-str');
      if (tb) tb.textContent = 'Operating System · v' + window.APP_VERSION;
    }
  });
</script>
```
```html
<!-- after: single shared updater, both call sites source BRAND (defined in config.js above) -->
<script defer>
  /* runs immediately after config.js (defer preserves order). BRAND + APP_VERSION exist by now. */
  window._applyBrandVersion = function () {
    const v = window.APP_VERSION || '9.4';
    const B = window.BRAND || { name: 'Barro Industries', systemName: 'Operating System' };
    const lv = document.getElementById('login-version-str');
    if (lv) lv.textContent = 'v' + v + ' · ' + B.name;
    const tb = document.getElementById('topbar-version-str');
    if (tb) tb.textContent = B.systemName + ' · v' + v;
  };
  window._applyBrandVersion();
</script>
...
<script>
  window.addEventListener('load', () => { if (window._applyBrandVersion) window._applyBrandVersion(); });
</script>
```

**(c) manifest.json L1-4 (static)**
```json
{
  "name": "Barro Industries Operating System",
  "short_name": "Barro Ops",
  "description": "Barro Industries Operating System — the company's central system",
```

**(d) sw.js L2 comment + firebase-messaging-sw.js / functions/index.js mirrors**
```js
// sw.js L2 — before: //  Barro Industries — Service Worker v16
//           after:  //  Barro Industries Operating System — Service Worker
```
```js
// firebase-messaging-sw.js — before (L38) / after (L38 + L60):
//   before: const notifTitle = data.title || 'Barro Industries';
//   after:  // BRAND MIRROR — window.BRAND.name in js/config.js
//           const notifTitle = data.title || 'Barro Industries';
//   L60 before: badge: '/icons/barro-logo.png',
//   L60 after:  badge: '/icons/icon-192.png',
```
```js
// functions/index.js L48 — SEPARATE DEPLOY (cd functions && npm run deploy):
//   before: title: title.trim() || 'Barro Industries',
//   after:  // BRAND MIRROR — window.BRAND.name in js/config.js (keep in sync)
//           title: title.trim() || 'Barro Industries',
```

**(e) track.html + CNAME → NO CHANGE.** Already brand-correct; domain is infra, not BRAND.

**(f) quote-builder-v2.html** — title swap (Q1) + a cross-reference comment above `CO` (L939). The `CO` object itself is LEFT unchanged (iframe isolation).
```js
// quote-builder-v2.html L938 — add above `const CO = {`:
//  Local mirror of window.BRAND.companies (js/config.js). This file loads via <iframe>
//  with no access to the parent app's config.js — keep BK/BS in sync by hand.
//  CO.PT is synthesized at runtime from ?pcoName/?pcoContact/?pcoSig for generic partners.
```

**(g) departments.js print headers → LEAVE UNCHANGED. WS14 owns these** (it rewires them to `buildLetterhead({ entity: brandEntity('bir'|'corporate'), ... })`). WS09 only supplies `BRAND.legal`/`brandEntity()` as the data source.

**(h) Company tab (app.js L5223, L5249-5259, L5308)**
```js
// L5223 before:  { key:'biops', label:'BI Ops System', ... }
// L5223 after:   { key:'biops', label:'The System', ... }
// L5249/5259 hero wordmark before: 'BI OPS SYSTEM'  →  after: (window.BRAND?.fullName || 'Barro Industries Operating System')
// L5308 before: BARRO INDUSTRIES · BI OPS · 2026
// L5308 after:  Barro Industries · Operating System · 2026
// Body prose 'Business Intelligence Operations Platform' (L5251) → ‼️ FLAG FOR NEIL (content rewrite, deferred)
```

### `‼️ FLAG FOR NEIL`

1. **OPC TIN unknown.** `BRAND.legal.opcTin` ships empty — no OPC TIN exists anywhere in the code. Needed before any client-facing doc claims the OPC as taxpayer. Recommendation: leave empty; BIR-facing docs use the DTI TIN via `brandEntity('bir')` (current behavior). See WS14 flag #1.
2. **Company-tab positioning copy** ("Business Intelligence Operations Platform", app.js L5251 + surrounding paragraph): substantively wrong per the v12 vision. Needs new prose, not a string swap. Recommendation: assign to a short content pass; WS09 only renames the tab label + wordmark.

### Migration checklist (execution order)

1. **config.js** — append the `window.BRAND` object + `window.brandEntity` helper (after `ROLES`). (Consumed by WS14 too.)
2. **index.html** — apply (a) L11 apple title; apply (b) dedupe both version scripts.
3. **manifest.json** — apply (c) name/short_name/description.
4. **sw.js** — apply (d) L2 comment only. Do NOT touch `CACHE_VER` prefix (hook auto-bumps the number).
5. **firebase-messaging-sw.js** — apply (d) L38 mirror comment + L60 badge path.
6. **quote-builder-v2.html** — Q1 title + (f) cross-ref comment. Leave `CO` body unchanged.
7. **app.js** — apply (h) Company-tab label/wordmark/footer. Leave prose + payslip footers (WS24).
8. **functions/index.js** — apply (d) L48 mirror comment. ⚠️ **Requires `cd functions && npm run deploy`** — NOT covered by `git push`.
9. **Commit** app-code files (hook auto-bumps APP_VERSION + CACHE_VER + index.html vX.Y.Z). Re-`git diff` first (OneDrive concurrent-edit).
10. **Deploy**: `git push origin master` (static). No firestore.rules change in this workstream (static-only BRAND). Cloud Functions deployed separately per step 8.

### Verify (grep must return ZERO over in-scope files, excluding SKIP-PROSE/SKIP-DEAD/DEFER + `.claude/worktrees/`)

```bash
cd "<repo root>"
# Retired short-name / old positioning in CHROME (not prose/deferred):
grep -rn --exclude-dir='.claude' "BI Ops\|BI OPS\|Business Intelligence Operations" \
  index.html manifest.json js/app.js
# Old 'Operations' system name in manifest (title/name fields only):
grep -n "Operations" manifest.json
# Retired push badge:
grep -n "barro-logo.png" firebase-messaging-sw.js
# EXPECT: only C2's flagged prose line (app.js L5251) may remain, and nothing else.
```
Manual: load app → splash, login-footer, topbar-subtitle, Company tab (label 'The System', hero wordmark) all read "Barro Industries Operating System"; install PWA → home-screen name "Barro Ops"; trigger a push → title "Barro Industries", badge renders.

## ‼️ SEAM NOTE (Fable orchestrator, post-merge 2026-07-10)
WS27 (IDs) consumes `window.BRAND` and needs an ID-verify base URL. Add one field to the BRAND object
above: `verifyBase: '/v/',` (the public ID-verify route prefix — a token-based public page like
order_tracking, built in WS27). No other change; WS27 defers entirely to this canonical BRAND (its
own 'interim BRAND' is dropped).

## Risks / cross-workstream interactions

- ⚠️ Direct overlap with workstream 14 (shared letterhead engine): departments.js alone has 5+ independently hand-rolled print-header implementations (HR payslip L4290-4340, billing invoice L6795-6810, purchase order L12716-12759, inventory count form L11939-12023, BK quote print L5560-5627, BS quote print L7693-7710) plus 2 more in app.js (printPayslip L4666-4685, printWorkerPayslip L4970-5004) — all duplicating company name/address/TIN/logo/signatory text with subtle drift between copies (different CSS class names, different logo-path techniques: computed absolute `logoUrl` vs bare relative `src`, different registration-type wording). Doing a naive full string-swap on all of them risks being immediately superseded/rewritten when WS14 lands; not stating the sequencing decision explicitly will cause duplicate or wasted work between the two workstreams.
- ⚠️ functions/index.js L48 and firebase-messaging-sw.js L38 both hardcode the identical fallback string `'Barro Industries'` for a push-notification title, on TWO DIFFERENT deploy pipelines (`npm run deploy` under functions/ vs the static-site `git push`). A rename that updates one but not the other will make notification titles silently disagree depending on which code path renders them.
- ⚠️ manifest.json and the two service workers cannot execute JS or read `window.BRAND` at all — a spec that assumes 'one JS object drives everything' will strand Sonnet trying to `fetch`/`import` a value into contexts that structurally cannot receive it; this must be called out explicitly in the deliverable, not discovered mid-implementation.
- ⚠️ index.html's version-string logic is duplicated in two separate inline `<script>` blocks (L296-306 and L310-317) that both independently reconstruct the same '· Barro Industries' / 'Operating System ·' text around `window.APP_VERSION` — editing one without the other will make the login footer and topbar subtitle disagree after a partial edit.
- ⚠️ Dead-code contamination: js/modules.js's `renderCompanyOverviewNew()` (L1751-1803) has zero call sites in the live app (only `renderCompanyOverview` in app.js is wired into the actual Company page) — a blind repo-wide grep-and-replace would spend effort re-branding copy that never renders; it should be explicitly skipped (or flagged for deletion under a different workstream) rather than silently rebranded.
- ⚠️ Introducing any new shared brand file requires touching THREE things in lockstep per CLAUDE.md's documented failure mode: index.html's script tag list (correct load-order slot), sw.js's PRECACHE array, and CACHE_VER — a partial edit (e.g. bumping CACHE_VER but forgetting PRECACHE) reproduces the exact stale-code symptom CLAUDE.md warns about.
- ⚠️ quote-builder-v2.html's `CO.PT` entry is synthesized at runtime from URL query parameters (`?pcoName=&pcoContact=&pcoSig=`), not from any static config file — if BRAND absorbs company sub-brand data, this dynamic, request-scoped entry needs an explicit compatible shape/exception documented, or the generic-partner-portal feature (see generic-partner-portal memory) will silently break.
- ⚠️ This repo is being edited live/concurrently (OneDrive + multiple sessions, per user memory deploy-recheck-full-file-diff) — a wide sweep across departments.js (~12.7k lines) and app.js (~7.8k lines) is exactly the kind of large diff that memory warns needs a fresh `git diff` right before any deploy step to avoid clobbering unrelated concurrent edits.
- ⚠️ A stray `.claude/worktrees/wf_783ec1d0-56d-1/` directory holds an older, divergent copy of sw.js/functions/index.js/firebase-messaging-sw.js from a prior session — a repo-wide grep for brand strings will surface these as false positives; they are not part of the checked-out v12 branch and must be excluded from the rename sweep's scope.

## Files likely touched

`index.html`, `manifest.json`, `sw.js`, `firebase-messaging-sw.js`, `track.html`, `quote-builder-v2.html`, `js/config.js (likely new home for window.BRAND, or a new js/brand.js added to index.html + sw.js PRECACHE)`, `js/app.js (printPayslip, printWorkerPayslip, renderCompany/renderCompanyOverview/renderCompanyBiOps, ID card block, ~L510/3735/5960/7449-7636 prose — scope-dependent per open decision 3)`, `js/departments.js (5+ print-header implementations, sales SOP header, company picklists, deliverTo defaults — scope-dependent per open decision 9)`, `js/modules.js (dead renderCompanyOverviewNew, Employee-of-the-Month copy, invite-modal placeholder)`, `js/notifications.js (EmailJS company param, L347)`, `functions/index.js (push-title fallback, L48 — separate deploy path)`, `firestore.rules (only if the Firestore-backed-BRAND option in open decision 2 is chosen)`, `CNAME (only if the custom-domain-in-BRAND option in open decision 8 is chosen)`

## Expected deliverable format

> Fable's output should let Sonnet implement mechanically with zero further judgment calls. Concretely, ask for:
> 
> 1. A resolved answer to each of the 8 openDecisions above, stated as a decision (not a menu) — especially where BRAND physically lives and how manifest.json/sw.js/firebase-messaging-sw.js stay in sync with it, and whether/how much of departments.js's print-header bodies are in scope now vs. deferred to workstream 14.
> 2. The exact BRAND object/module shape as a real code block (field names, nesting, e.g. `BRAND.name`, `BRAND.systemName`, `BRAND.shortName`, `BRAND.tagline`, `BRAND.legal.{entityName,registration,tin,address,phone,email}`, `BRAND.logo.{wordmark,print,pwaIcon,pushBadge}`, `BRAND.companies.{BK,BS,...}` if unified, etc.) plus, if non-JS consumers need a mirror, the exact mechanism (e.g. a `globalThis`-safe file and its `importScripts` usage) spelled out in code.
> 3. A file:line-keyed call-site migration table (not "grep for Barro Industries") that explicitly buckets every location found in this brief into one of: SWAP (must become `BRAND.field`), SKIP-DEAD (e.g. modules.js renderCompanyOverviewNew — don't touch), SKIP-PROSE (narrative sentences left as literal text), or DEFER-TO-WS14/24/31 (print-header bodies, if that decision goes that way) — so Sonnet has a checklist, not a search-and-replace mandate.
> 4. Exact before/after code snippets for each distinct pattern class identified above: (a) index.html title/meta/splash/login/topbar/version-script block, (b) manifest.json fields, (c) sw.js CACHE_VER/PRECACHE/comment, (d) firebase-messaging-sw.js + functions/index.js fallback title (shown together since they must move in lockstep), (e) track.html OG/Twitter block + CNAME, (f) quote-builder-v2.html title tag + CO object touch-up, (g) one representative departments.js print-header (or an explicit "leave unchanged, WS14 owns this" note if deferred), (h) the Company-tab rename/content decision for 'BI Ops System'.
> 5. A numbered, sequential migration checklist: which files change in what order, where the CACHE_VER bump happens relative to the file list edits (per CLAUDE.md's 3-things-in-lockstep rule), where a separate Cloud Functions deploy step is required (functions/index.js), and a final "verify" step (an exact grep command over the in-scope file set that should return zero hits for the retired literal strings once done, explicitly excluding SKIP-PROSE/SKIP-DEAD/DEFER items and the stray .claude/worktrees directory).
> 6. If the Firestore-backed option is chosen for any field: the exact firestore.rules diff (new match block or amendment to the existing `settings/{docId}` block) and which specific BRAND fields are dynamic vs. which stay static-only.
