# CLIENT-INFO-REQUEST-SPEC — "Client Information Request" (public intake form → Sales › Briefs)

_Architect: Fable 5.1 · 2026-09-26 · Status: SPEC (nothing built yet)_
_Implementers: Sonnet subagents, one workstream each (see §6). Verifiers: adversarial, per workstream._

> **Read before anything else:** CLAUDE.md, STATUS.md (2026-09-26 client-portal entry), then
> `projects/chibabs/projectconfirmation/index.html`, `functions/index.js` lines 2560–3102
> (portalUnlock/portalState/portalSign/portalAdminRotateCode) and `functions/portal-core.js`.
> This feature is a **sibling of the client portal** and must reuse its idioms rather than invent
> new ones: anonymous `asia-east1` httpsCallables, Admin-SDK-only collections with **no rules
> match at all**, `rateLimitDecision()` fail-closed buckets, `CODE_ALPHABET` reference numbers,
> `manilaDateFrom()`, best-effort post-commit notifications, and the `?mock=1` QA seam.

---

## 0. Summary

**What it is.** Neil's standalone "Commissary Kitchen Project Brief" HTML form becomes a first-class
system feature: a **public, no-account intake page** that Barro sends to a prospective client, who
answers 10 short parts (his original 9 + a new **Photos** part), attaches photos, gives RA 10173
consent and receives a reference number. The submission lands inside the Operations System under
**Sales › Briefs**, where staff review it as a readable brief (answers + equipment table + photo
gallery), print it, set a status, leave internal notes, and **convert it into the existing CRM client
record** (`clients` collection — the same book the Facebook-lead webhook and the Sales › Clients tab use).

**Public URL (fixed by the owner):** `https://barroindustries.com/sales/clientinformationrequest/`
→ repo file `sales/clientinformationrequest/index.html` (standalone, own CSS, **not** in index.html,
**not** in `sw.js` PRECACHE, `noindex`).

**What a client sees.** The nameplate-styled brief exactly as Neil designed it (Archivo + IBM Plex,
"equipment rating plate" header, sticky progress bar, chip toggles, editable equipment table, draft
autosave on the device, print/save-as-PDF, dark mode), plus a Photos part with four groups (Site /
space · Existing kitchen · Equipment · Floor plan or documents), each photo shrunk in the browser
before upload, optional caption per photo. On "Send project brief" they get an on-screen receipt
`CIR-yymmdd-XXXXXX` they can print, and the draft is cleared from the device.

**What staff see.** A new **Briefs** chip tab on the Sales department page: a list (ref · received /
age · company & contact · business type · budget · target date · photos · status), a detail view
that walks the form definition generically (every section, every answer, the equipment table, the
photo gallery with preview), Print / PDF via the repo's `openPrintableDoc` + letterhead, a status
select, internal notes, **Convert to client (CRM)**, **Prefill Quote Builder**, and (President /
Manager) **Delete** — which removes the Firestore doc, its notes **and** its Storage photos through a
staff-authenticated callable. A new submission notifies every Sales-department user **plus the President**
in-app and by push through the existing `notifications/{uid}/items/{id}` mechanism (owner ruling R1).

**Security shape (non-negotiable).** The repo is PUBLIC and the link is OPEN, so: nothing about a
submission is ever publicly readable or listable in Firestore or Storage; every public write goes
through five anonymous/staff `asia-east1` callables (`cirStartDraft`, `cirUploadPhoto`,
`cirRemovePhoto`, `cirSubmit`, `cirAdminDelete`); rate limiting is per-IP + global and **fails
closed**; honeypot + server-side timing check; strict allowlist validation against a **versioned form
definition** shared byte-for-byte by page, functions and internal renderer; all submission content is
treated as **attacker-controlled** and `escHtml()`'d everywhere it is rendered (list, detail, print,
captions, filenames, notifications).

---

## Hard constraints (restated — every workstream must honour these)

1. **Vanilla JS only.** No framework, bundler, ESM, or `import`. Everything on `window.*` in classic
   scripts; `js/screens/*.js` files load lazily via `PAGE_SCRIPTS` and are called only at runtime.
   Load order is load-bearing (see CLAUDE.md).
2. **Versions are hook-owned.** Never hand-edit `APP_VERSION` (js/config.js), the `vX.Y.Z` strings in
   index.html, `CACHE_VER` in sw.js, or `precache-manifest.json`. Never `git commit --no-verify`.
3. **Never** run `git stash`, `git reset --hard`, `git checkout -- <file>`, `git clean`, `git add -A`.
   Concurrent agents edit this tree live. Stage files explicitly; `git diff --cached` before commit.
4. **Commit gate (all three, before every commit):**
   `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`
5. **Rules land BEFORE the code that needs them:** `bash scripts/release.sh rules`, then
   `bash scripts/release.sh storage`, then the selective functions deploy, then `release.sh push`.
6. **firestore.rules is 259,436 B of a 262,144 B cap (2,708 B headroom).** The additions in §3.1 must
   stay **≤ 1,400 bytes** including comments (two comment lines max). Verify `wc -c firestore.rules`
   ≤ 261,000 before deploying. If the file has grown past that meanwhile, STOP and escalate (backlog
   item 9b, comment relocation) — do not strip other people's comments.
7. Firestore rules do not cascade to subcollections and a missing-field read denies — every
   collection/subcollection is enumerated in §3.1 and every field read uses `.get(field, default)`.
8. **Cloud Functions deploy SELECTIVELY** (Meta-webhook hazard — see STATUS.md). Exact command in §7.
   Never `release.sh functions`, never `release.sh record functions`.
9. **`escHtml()` every piece of submission content** before `innerHTML` — including in the print body,
   photo captions, `alt` attributes, filenames, tooltips and notification text. URLs only via
   `safeHttpUrl()`.
10. **Manila time only.** Client app: `window.bizDate()`. Functions: `manilaDate()` /
    `portal.manilaDateFrom()`. Never raw `toISOString().slice(0,10)` for a business date.
11. **RA 10173 consent** is captured with `noticeVersion`, `noticeSha256`, server `consentedAt`;
    deletion of a submission removes its Storage photos (callable, §2.5).
12. **No client-confidential data in the repo.** The page carries no client names; the form definition
    is a blank questionnaire. Firebase web config is already public and is reused verbatim.
13. **Plain emoji, never `emojiIcon()`, in notification title/body/icon** (ci-invariants check 5).

---

## 1. Data model

### 1.1 Naming

| Thing | Value |
|---|---|
| Feature key / prefix | `cir` (Client Information Request) — functions, globals, CSS classes, localStorage keys |
| Reference number | `CIR-yymmdd-XXXXXX` — date = Manila date of submission; suffix = 6 chars of `portal.CODE_ALPHABET` (no 0/O/1/I). Same generator as the portal's `BKC-…` with a different prefix (§2.0). **Not** `BIR-` (that is the tax bureau). |
| Form id (v1) | `commissary_brief`, `formVersion: 1` |
| Public URL | `https://barroindustries.com/sales/clientinformationrequest/` |
| Public file | `sales/clientinformationrequest/index.html` |
| Shared definition | `js/cir-forms.js` (canonical) — byte-identical mirror at `functions/cir-forms.js` (ci-enforced, §6 WS-0) |
| Internal screen | `js/screens/client-info-requests.js` → `window.renderClientBriefs(container, currentUser, currentRole)` |
| Sales tab | key + label **`Briefs`**, second position (after `Clients`) |
| Region | `asia-east1` for all five callables — MANDATORY on the client: `firebase.app().functions('asia-east1')` |

### 1.2 Firestore collections (enumerated — rules in §3.1)

**`client_info_requests/{refNo}`** — one doc per submission. Doc id == `refNo`. Written ONLY by
`cirSubmit` (create) and `cirAdminDelete` (delete); staff may `update` an allowlisted field set.

```
{
  refNo:            'CIR-260926-ABCDEF',   // == doc id
  formId:           'commissary_brief',
  formVersion:      1,
  status:           'new',                 // 'new' | 'in_review' | 'contacted' | 'converted' | 'archived'
  createdAt:        <server Timestamp>,    // submission time; the ONLY list sort key (single-field index, no composite)
  submittedOnManila:'2026-09-26',          // portal.manilaDateFrom(nowMs)
  updatedAt:        <server Timestamp>,

  summary: {                               // denormalised for the list view; server-built from `answers`
    name, company, phone, email, siteAddress, bizType, budget, targetDate,   // strings ('' when blank)
    photoCount: 0
  },

  answers: { <fieldKey>: value, ... },     // ONLY keys that exist in FORMS[formId].sections[].fields[] (photos excluded)
                                           // value types by field type (see 1.4): string | number | string[] | row[]
                                           // blank answers are OMITTED (no '' / [] / null stored)

  photos: [ {                              // 0..LIMITS.maxPhotos entries, order = client order
    photoId:     'p_9f3c1a2b7e4d',         // server-minted: 'p_' + 12 hex
    group:       'site',                   // one of FORMS[formId] photo groups: 'site' | 'kitchen' | 'equipment' | 'docs'
    caption:     '',                       // ≤ LIMITS.maxCaption chars, control chars stripped
    path:        'client-info-requests/CIR-260926-ABCDEF/p_9f3c1a2b7e4d.jpg',  // Storage object path (NO URL stored)
    bytes:       412331,
    width:       1600, height: 1200,       // client-reported, clamped 1..10000, informational only
    contentType: 'image/jpeg',
    uploadedAt:  <Timestamp>
  } ],

  consent: {
    agreed:        true,
    noticeVersion: '2026-09-26.1',         // must equal PRIVACY_NOTICE.version at submit time
    noticeSha256:  '<sha256 of JSON.stringify(PRIVACY_NOTICE.sections)>',
    consentedAt:   <server Timestamp>
  },

  client: {                                // staff-only forensic block (rendered inside a collapsed <details> for president/manager)
    ip:             '203.0.113.7',        // portal.clientIpFrom(...).ip — null when untrusted, NEVER the raw XFF
    ipTrusted:      true,                  // false ⇒ no address Google itself wrote; treat ip as absent evidence
    ipHash:         '<sha256(ip)>',
    userAgent:      '<≤512 chars>',
    acceptLanguage: '<≤64 chars>',
    referer:        '<≤300 chars or ''>',
    fillMs:         184230                 // client-reported ms from first keystroke to submit; informational
  },
  fingerprintDay:   '<sha256(lower(email)|digits(phone))>|2026-09-26',  // duplicate guard (single equality query, no index)
  draftHash:        '<cir_drafts doc id this came from>',

  // ── staff-written (allowlisted in rules) ──
  statusChangedAt, statusChangedBy, statusChangedByName,
  convertedClientId, convertedAt, convertedBy
}
```

**`client_info_requests/{refNo}/notes/{noteId}`** — internal notes, create-only.
```
{ text: '<≤2000>', authorUid, authorName, at: <server Timestamp> }
```

**`cir_drafts/{sha256(draftToken)}`** — NO rules match (Admin-SDK only). One per page session.
```
{
  formId, formVersion,
  createdAt: <server Timestamp>,           // timing check reference (submit must be ≥ LIMITS.minFillMs after this)
  ipHash, uaHash,
  photoCount: 0, bytesTotal: 0,
  photos: { [photoId]: { group, bytes, width, height, path, uploadedAt } },   // path is the DRAFT path (1.3)
  submittedAt: null | <Timestamp>,
  refNo: null | 'CIR-…'
}
```

**`cir_ratelimit/{bucketId}`** — NO rules match. Bucket shape = portal-core's
`{ count, windowStart, lockedUntil, lockStreak, updatedAt }`.
`bucketId` = `sha256(scope + '|' + ip)` for per-IP buckets (scope ∈ `start|photo|submit`) and the
literal `global_submit` for the global bucket.

**`cir_abuse/{autoId}`** — NO rules match. Best-effort log: `{ at, kind, ipHash, detail }`,
`kind ∈ 'honeypot' | 'too_fast' | 'duplicate' | 'photo_reject' | 'bad_payload' | 'rate_limited'`.

**Existing collections touched:** `notifications/{uid}/items/{id}` (create, exact field shape in
§2.4), `clients` (staff convert, §5.6), `users` (recipient lookup, read), `audit_log`
(`cirAdminDelete` writes one entry; the internal screen calls `window.logAudit`).

### 1.3 Storage paths (bucket `barro-industries.firebasestorage.app`, Admin SDK writes only)

| Path | Written by | Read by |
|---|---|---|
| `client-info-requests/drafts/{draftHash}/{photoId}.jpg` | `cirUploadPhoto` | nobody via rules (4 segments → no match → deny) |
| `client-info-requests/{refNo}/{photoId}.jpg` | `cirSubmit` (server-side **move** from the drafts prefix) | signed-in non-partner staff (`storage.rules` §3.2) via `storage.ref(path).getDownloadURL()` |

Every object is saved with `contentType: 'image/jpeg'`, `cacheControl: 'private, max-age=0'`, and
custom metadata `{ firebaseStorageDownloadTokens: <crypto.randomUUID()>, group, photoId }`. The
download token is REQUIRED — without it the client SDK's `getDownloadURL()` throws
`storage/no-download-url`. A GCS `move()` preserves metadata, so the token set at upload survives
the move to the final path. **No download URL is ever stored in Firestore** — only `path`; staff
resolve URLs at view time, so a Firestore read can never leak a bearer URL.

### 1.4 Form definition scheme (`js/cir-forms.js`, mirrored at `functions/cir-forms.js`)

One file, UMD-style so all three consumers load the same bytes:

```js
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;   // functions/ + tests
  if (root) { root.CIR_FORMS = api.FORMS; root.CIR_PRIVACY_NOTICE = api.PRIVACY_NOTICE; root.CIR_LIMITS = api.LIMITS; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var LIMITS = { ... };            // 1.5
  var PRIVACY_NOTICE = { ... };    // 1.6
  var FORMS = { commissary_brief: { ... } };   // 1.7
  return { FORMS: FORMS, PRIVACY_NOTICE: PRIVACY_NOTICE, LIMITS: LIMITS };
});
```

Field types and their **stored value** shape (the internal renderer switches on `type` — nothing
else reads field keys by name except `summary` building in §2.4):

| `type` | Input | Stored `answers[key]` | Validation (server) |
|---|---|---|---|
| `text` | `<input type=text>` | string | control chars stripped, trimmed, ≤ `max` (default 200) |
| `tel` | `<input type=tel>` | string | `/^[0-9+\-\s().]{6,32}$/` |
| `email` | `<input type=email>` | string | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, ≤ 160 |
| `textarea` | `<textarea>` | string (may contain `\n`) | multiline strip (keep `\n\t`), ≤ `max` (default 2000) |
| `select` | `<select>` | string | must equal one option value; `''` = blank (omitted) |
| `number` | `<input type=number>` | number | finite, `min ≤ v ≤ max` (defaults 0..1e6), ≤ 2 decimals |
| `date` | `<input type=date>` | string `YYYY-MM-DD` | regex + calendar-valid; years 2000..2100 |
| `url` | `<input type=url>` | string | `http(s)://` only, ≤ 500; page also warns on non-http |
| `chips` | checkbox pills | string[] (option **values**, in option order, deduped) | every value must be an option value; length ≤ options.length |
| `table` | editable rows | `Array<{ [col.key]: string\|number }>` — rows lacking the first column are dropped | ≤ `maxRows` (40); each cell per its column type, ≤ `LIMITS.maxCellChars` |
| `photos` | photo groups (page-only widget) | **not** in `answers` — lives in top-level `photos[]` | see §2.2 |

Common field attributes: `key` (unique across the whole form, `^[a-z][a-z0-9_]{1,40}$`), `label`,
`type`, `required` (bool), `w: 'full'` (grid span; default half), `placeholder`, `autocomplete`,
`hint`, `max`, `rows` (textarea), `min/max/step` (number), `options` (select/chips: array of either a
string — value == label — or `{ v: 'stored value', l: 'shown label' }`), `columns` (table),
`groups` (photos). Sections: `{ key, title, hint, fields: [] }`; the section number shown on the page
is its 1-based index (never stored).

Rendering rule (page + internal renderer): iterate `fields` in order; consecutive input-type fields
(text/tel/email/textarea/select/number/date/url) are laid out inside one `.grid`; a `chips`, `table`
or `photos` field closes the current grid, renders full-width (chips use `label` as the `.sub`
heading), and a new grid opens for the next input field. This reproduces Neil's layout exactly.

**Versioning rule.** Any change to a form's fields/options bumps `formVersion`. Submissions carry
`formId` + `formVersion`; the internal renderer walks `FORMS[formId]` and renders any stored answer key
it no longer knows under an "Other answers (older form version)" block as `key: value` — never
crashes, never drops data. A second questionnaire = a new key in `FORMS` + a new folder
`sales/<slug>/index.html` with `FORM_ID` set + (nothing else: same callables, same collection, same
screen). Drafts saved under a previous `formVersion` are discarded by the page (key includes version).

### 1.5 `LIMITS` (single source for page + server)

```js
var LIMITS = {
  maxPhotos: 20,             // per submission
  maxPhotoBytes: 900000,     // per photo AFTER client downscale (server rejects above)
  minPhotoBytes: 2000,
  maxTotalPhotoBytes: 12000000,
  photoLongEdge: 1600,       // client canvas target
  photoQuality: 0.8,         // client JPEG quality (retry ladder: 0.8 → 0.6 → long edge 1200 @ 0.6)
  maxCaption: 120,
  maxEquipmentRows: 40,
  maxCellChars: 120,
  maxPayloadBytes: 200000,   // JSON.stringify(payload).length cap, checked client AND server
  minFillMs: 15000,          // submit must be ≥ 15 s after the draft was created (server clock)
  draftTtlMs: 7 * 24 * 3600e3,
  dupWindow: 'day'           // duplicate guard = same email+phone fingerprint on the same Manila date
};
```

### 1.6 `PRIVACY_NOTICE` (canonical text; version bump on any wording change)

```js
var PRIVACY_NOTICE = {
  version: '2026-09-26.1',
  consentLine: 'I agree to Barro Industries using this information and these photos to prepare my kitchen design and proposal, in line with the Data Privacy Act of 2012 (RA 10173).',
  sections: [
    { heading: 'Who is responsible for your data',
      body: 'Personal Information Controller: Barro Industries OPC (SEC-registered, Metro Manila), trading as Barro Kitchens. Contact for privacy matters: the President, 0927 683 6300, barroindustries@gmail.com.' },
    { heading: 'What we collect on this page',
      body: 'Your name, position, company, mobile number, e-mail, addresses; your answers about your business, kitchen, site, utilities, storage, permits, scope, timeline and budget; the photos you choose to attach and their captions; the date and time you send the form; and your device\'s IP address and browser identifier.' },
    { heading: 'Why',
      body: 'To plan your kitchen layout, equipment, exhaust and utilities; to prepare a design and a proposal; and to contact you to schedule a site visit and follow up on this request.' },
    { heading: 'Lawful basis',
      body: 'Republic Act 10173 section 12(b) — steps taken at your request before entering into a contract — and your consent for the photos and for the communications about this request.' },
    { heading: 'Who we share it with',
      body: 'Barro Industries staff who work on your request; Google LLC, whose Firebase/Google Cloud services host this system (servers may be outside the Philippines); and government authorities only when the law requires it. We do not sell or rent personal data.' },
    { heading: 'How long we keep it',
      body: 'If no project follows, up to twenty-four (24) months from our last contact with you, then deleted. If a project follows, for the life of the project and ten (10) years after turnover, in line with Philippine record-keeping requirements. You may ask us to delete this request and its photos at any time.' },
    { heading: 'Your rights',
      body: 'To be informed; to access; to object; to rectification; to erasure or blocking; to damages; to data portability; and to lodge a complaint with the National Privacy Commission (privacy.gov.ph). Write to the contact above; we respond within fifteen (15) working days.' },
    { heading: 'Security',
      body: 'Data is encrypted in transit; photos and answers are readable only by authorised staff. This page stores a draft of your answers and an upload key only in your own browser — no advertising cookies.' }
  ]
};
```

Server computes `noticeSha256 = sha256(JSON.stringify(PRIVACY_NOTICE.sections))` (same shape as
`portal.privacyNoticeSha256`).

### 1.7 `FORMS.commissary_brief` — the complete v1 definition (content baseline = Neil's form)

Transcribe **exactly**. Option strings are the original `value=` attributes; `{v,l}` pairs are used
where Neil's chip label differed from its value. Wording, order and placeholders are his.

```js
var FORMS = {
  commissary_brief: {
    formId: 'commissary_brief',
    formVersion: 1,
    brand: 'BARRO INDUSTRIES · Commercial Kitchen Fabrication',
    title: 'Commissary kitchen project brief',
    intro: "Tell us how your kitchen runs today and where you want it to go. We use this to plan your layout, equipment, exhaust and utilities before our site visit. Anything you're unsure of, leave blank — we'll go through it together.",
    specs: [ { b: '10 parts', t: 'in this form' }, { b: '15–25 min', t: 'to complete' }, { b: 'Auto-saved', t: 'on this device' } ],
    footer: 'Barro Industries · Valenzuela City, Metro Manila',
    submitLabel: 'Send project brief',
    doneTitle: 'Project brief sent',
    doneBody: 'Thank you. Our team will review your answers and contact you to schedule a site visit.',
    sections: [
      { key: 'client', title: 'Client details', hint: "Who we'll be working with on this project.", fields: [
        { key: 'name',         label: 'Full name',                 type: 'text',  required: true, autocomplete: 'name', max: 120 },
        { key: 'position',     label: 'Position / role',           type: 'text',  placeholder: 'e.g. Owner, Operations Manager', max: 80 },
        { key: 'company',      label: 'Company name',              type: 'text',  required: true, w: 'full', autocomplete: 'organization', max: 120 },
        { key: 'phone',        label: 'Mobile number',             type: 'tel',   required: true, placeholder: '09XX XXX XXXX', autocomplete: 'tel' },
        { key: 'email',        label: 'Email',                     type: 'email', required: true, autocomplete: 'email' },
        { key: 'address',      label: 'Office / business address', type: 'textarea', required: true, w: 'full', rows: 2, max: 500 },
        { key: 'site_address', label: 'Commissary site address',   type: 'textarea', required: true, w: 'full', rows: 2, max: 500, placeholder: 'Where the commissary will be built — include landmarks if helpful' },
        { key: 'contact_pref', label: 'Best way to reach you',     type: 'select', w: 'full', options: ['Phone call','Viber','WhatsApp','Email','Messenger'] }
      ]},
      { key: 'business', title: 'Your business', hint: 'What the commissary will produce and who it serves.', fields: [
        { key: 'biz_type', label: 'Type of business', type: 'select', w: 'full', options: ['Restaurant group / multi-branch','Fast food / QSR franchise','Cloud kitchen','Catering / events','Hotel or resort','Hospital','School / university canteen','Corporate / BPO canteen','Bakery / pastry','Food manufacturing / packaged food','Other'] },
        { key: 'branches_now',    label: 'Branches supplied today',        type: 'number', min: 0, max: 10000 },
        { key: 'branches_target', label: 'Branches in 3 years (target)',   type: 'number', min: 0, max: 10000 },
        { key: 'menu',            label: 'Cuisine and main products',      type: 'textarea', w: 'full', placeholder: 'e.g. Filipino rice meals, sauces and marinades, bread and pastries, frozen dumplings' },
        { key: 'process', label: 'What the commissary will do', type: 'chips', options: ['Raw prep / butchery','Marinating','Sauces and soups','Cook-chill','Frying','Rice cooking','Baking','Portioning and packing','Freezing','Ready-to-eat meals'] },
        { key: 'volume_now',    label: 'Current output per day',  type: 'text', placeholder: 'e.g. 800 meals or 300 kg' },
        { key: 'volume_target', label: 'Target output per day',   type: 'text', placeholder: 'e.g. 2,000 meals' },
        { key: 'hours',         label: 'Operating hours',         type: 'text', placeholder: 'e.g. 4 AM – 8 PM' },
        { key: 'shifts',        label: 'Shifts per day',          type: 'select', options: ['1','2','3 (24 hours)'] },
        { key: 'days',          label: 'Days per week',           type: 'number', min: 1, max: 7 },
        { key: 'staff',         label: 'Kitchen staff per shift', type: 'number', min: 0, max: 10000 }
      ]},
      { key: 'operations', title: 'How you operate today', hint: 'Your current setup tells us what to keep, fix, or rethink.', fields: [
        { key: 'current_setup', label: 'Current setup', type: 'select', w: 'full', options: ['Each branch cooks its own food','We have a commissary, need to expand or relocate','We have a commissary, need to renovate it','Renting kitchen space','New business, no kitchen yet'] },
        { key: 'pain', label: "Problems you're running into", type: 'chips', options: ['Not enough space',"Can't keep up with volume",'Too hot / poor exhaust','Smoke or smell complaints',{ v: 'Inconsistent product quality', l: 'Inconsistent quality' },{ v: 'Workflow crossing / bottlenecks', l: 'Workflow bottlenecks' },'Not enough cold storage','High gas or power bills','Equipment breaking down',{ v: 'Failed inspection / permit issues', l: 'Permit / inspection issues' },{ v: 'Drainage or grease problems', l: 'Drainage / grease problems' }] },
        { key: 'works_well',    label: 'What works well that we should keep?', type: 'textarea', w: 'full' },
        { key: 'biggest_issue', label: 'The one thing you most want fixed',    type: 'textarea', w: 'full' }
      ]},
      { key: 'equipment', title: 'Equipment you use now', hint: 'List the main equipment you currently have, and whether you want to reuse it in the new kitchen. Brand and model are helpful but optional.', fields: [
        { key: 'current_equipment', label: 'Current equipment', type: 'table', minRows: 3, maxRows: 40, addLabel: '+ Add equipment', columns: [
          { key: 'item',  label: 'Equipment',     type: 'text',   placeholder: 'e.g. 3-burner range', width: '28%' },
          { key: 'qty',   label: 'Qty',           type: 'number', min: 0, max: 999, width: '9%' },
          { key: 'brand', label: 'Brand / model', type: 'text',   width: '20%' },
          { key: 'power', label: 'Power',         type: 'select', options: ['LPG','Electric','Steam','None'], width: '14%' },
          { key: 'cond',  label: 'Condition',     type: 'select', options: ['Good','Fair','Poor'], width: '13%' },
          { key: 'plan',  label: 'Plan',          type: 'select', options: ['Reuse','Replace','Unsure'], width: '14%' }
        ]},
        { key: 'needed_equipment', label: 'Equipment you plan to add or need', type: 'chips', options: ['Gas ranges / burners',{ v: 'High-pressure burners / wok ranges', l: 'High-pressure / wok ranges' },'Tilting braising pan','Steam kettles / stock pots','Deep fryers','Combi ovens','Deck / convection ovens',{ v: 'Industrial rice cookers / steamers', l: 'Rice cookers / steamers' },'Blast chiller / freezer','Walk-in chiller','Walk-in freezer','Prep tables and sinks',{ v: 'Meat grinder / slicer / mixer', l: 'Grinder / slicer / mixer' },{ v: 'Vacuum sealer / packaging', l: 'Vacuum sealer / packing' },'Dishwasher / pot wash','Shelving and racks'] }
      ]},
      { key: 'site', title: 'The site', hint: 'The space shapes everything — layout, exhaust routing and utility runs.', fields: [
        { key: 'site_status', label: 'Site condition', type: 'select', w: 'full', options: ['Bare shell / empty space','Existing kitchen, to be renovated','Building under construction','Still looking for a site'] },
        { key: 'ownership',   label: 'Owned or leased?',          type: 'select', options: ['Owned','Leased','Not decided'] },
        { key: 'floor',       label: 'Floor level',               type: 'text', placeholder: 'e.g. Ground floor' },
        { key: 'area',        label: 'Kitchen floor area (sqm)',  type: 'number', min: 0, max: 100000 },
        { key: 'ceiling',     label: 'Ceiling height (m)',        type: 'number', min: 0, max: 50, step: 0.1 },
        { key: 'plans_link',  label: 'Link to floor plan, photos or videos of the site', type: 'url', w: 'full', placeholder: 'Google Drive, Dropbox or similar link' },
        { key: 'site_features', label: 'What the site already has', type: 'chips', options: ['Truck / delivery access','Loading bay','Roof access for exhaust','Can exhaust through side wall','Floor drains','Grease trap','Existing exhaust hood','Epoxy / tiled floor','Staff changing area','Neighbors close by'] },
        { key: 'building_rules', label: 'Building or landlord restrictions', type: 'textarea', w: 'full', placeholder: 'e.g. no roof penetration, work hours only 8–5, no LPG tanks inside' }
      ]},
      { key: 'photos', title: 'Photos', hint: "Photos save us a visit's worth of questions. Take them with your phone — we shrink them before they upload. Up to 20 photos.", fields: [
        { key: 'photos', type: 'photos', groups: [
          { key: 'site',      label: 'Site / space',            hint: 'The room as it is today — walls, floor, ceiling, doors, windows' },
          { key: 'kitchen',   label: 'Existing kitchen',        hint: 'Your current cooking line, hoods, sinks, storage' },
          { key: 'equipment', label: 'Equipment',               hint: 'Overall shots and nameplates of equipment you want to reuse' },
          { key: 'docs',      label: 'Floor plan or documents', hint: 'A photo or screenshot of the plan, lease rules, permits or audit findings' }
        ]}
      ]},
      { key: 'utilities', title: 'Utilities', hint: 'Gas, power and water decide what equipment can run where. "Not sure" is fine.', fields: [
        { key: 'gas',         label: 'Gas supply',                 type: 'select', options: ['LPG cylinders (50 kg)','LPG bulk tank / manifold','Existing gas pipeline','None yet','Not sure'] },
        { key: 'gas_monthly', label: 'Current LPG use per month',  type: 'text', placeholder: 'e.g. 12 × 50 kg tanks' },
        { key: 'power',       label: 'Electrical supply',          type: 'select', options: ['Single-phase 220V','Three-phase','Not sure'] },
        { key: 'power_cap',   label: 'Available load (kVA / amps)',type: 'text', placeholder: 'If known' },
        { key: 'genset',      label: 'Backup generator',           type: 'select', options: ['Yes, covers whole kitchen','Yes, partial','No','Planning to add'] },
        { key: 'water',       label: 'Water supply',               type: 'select', options: ['Maynilad / Manila Water','Local water district','Deep well','Mixed / with storage tank','Not sure'] },
        { key: 'hot_water',   label: 'Hot water',                  type: 'select', w: 'full', options: ['Have a heater system','Need hot water','Not needed'] }
      ]},
      { key: 'logistics', title: 'Storage, receiving and dispatch', hint: "How food comes in, where it's kept, and how it leaves for your branches.", fields: [
        { key: 'deliveries',  label: 'Supplier deliveries',   type: 'select', options: ['Daily','2–3 times a week','Weekly','We buy from market ourselves'] },
        { key: 'dispatch',    label: 'Dispatch to branches',  type: 'select', options: ['Once a day','Twice a day','Every other day','Weekly'] },
        { key: 'chiller_cap', label: 'Chilled storage needed',type: 'text', placeholder: 'e.g. 2 tons or 20 racks' },
        { key: 'freezer_cap', label: 'Frozen storage needed', type: 'text', placeholder: 'e.g. 3 tons' },
        { key: 'dry_storage', label: 'Dry storage and packaging materials', type: 'text', w: 'full', placeholder: 'e.g. 50 sacks of rice, boxes, containers' },
        { key: 'transport',   label: 'How food is transported', type: 'text', w: 'full', placeholder: 'e.g. 2 reefer vans, insulated boxes on L300' }
      ]},
      { key: 'compliance', title: 'Permits and standards', hint: 'So the layout meets what inspectors and certifiers will check.', fields: [
        { key: 'compliance', label: 'Permits and standards you need to meet', type: 'chips', options: ['Sanitary permit',{ v: 'FDA LTO (food manufacturer)', l: 'FDA LTO' },{ v: 'BFP fire safety (FSIC)', l: 'BFP fire safety' },'HACCP','ISO 22000 / FSSC','Halal','DENR / LLDA wastewater',{ v: 'Mall / building admin standards', l: 'Mall / building standards' },'Not sure yet'] },
        { key: 'compliance_notes', label: 'Any audit findings or requirements we should know about?', type: 'textarea', w: 'full' }
      ]},
      { key: 'scope', title: 'Scope, timeline and budget', hint: "What you'd like Barro Industries to handle.", fields: [
        { key: 'scope', label: 'Scope of work', type: 'chips', options: [{ v: 'Kitchen layout and design', l: 'Layout and design' },{ v: 'Stainless steel fabrication', l: 'Stainless fabrication' },{ v: 'Cooking equipment supply', l: 'Cooking equipment' },'Exhaust hood and ducting',{ v: 'Fresh air / make-up air', l: 'Fresh air system' },{ v: 'LPG pipeline and manifold', l: 'LPG pipeline' },{ v: 'Cold room / walk-in', l: 'Cold rooms' },{ v: 'Installation and commissioning', l: 'Installation' },{ v: 'Preventive maintenance', l: 'Maintenance' }] },
        { key: 'target_date', label: 'Target opening date',     type: 'date' },
        { key: 'budget',      label: 'Budget range',            type: 'select', options: ['Below ₱1M','₱1M – ₱3M','₱3M – ₱5M','₱5M – ₱10M','Above ₱10M','Need guidance'] },
        { key: 'decision',    label: 'Who approves the project?', type: 'text', placeholder: 'Name and role' },
        { key: 'site_visit',  label: 'Preferred site visit schedule', type: 'text', placeholder: 'e.g. weekday mornings' },
        { key: 'notes',       label: 'Anything else we should know?', type: 'textarea', w: 'full' }
      ]}
    ],
    // keys the server copies into `summary` (must all be real field keys of this form)
    summaryKeys: { name: 'name', company: 'company', phone: 'phone', email: 'email', siteAddress: 'site_address', bizType: 'biz_type', budget: 'budget', targetDate: 'target_date' }
  }
};
```

Notes for WS-0: the original chip groups had no visible heading for `compliance`/`scope` (the chips
sat directly under the section hint) — the two `label`s above ("Permits and standards you need to
meet", "Scope of work") are rendered as `.sub` headings on the page and as row labels in the internal
brief; this is the one deliberate wording addition besides the Photos part. The **consent checkbox is
not a field** — the page renders `PRIVACY_NOTICE.consentLine` + a `<details>` with the full notice at
the end of the last section, and the server requires `consent.agreed === true`.

---

## 2. The callables (functions/index.js — append after `portalAdminRotateCode`; pure logic in `functions/cir-core.js`)

### 2.0 Shared code layout

- **`functions/cir-core.js`** — pure, zero-Firebase CommonJS helpers (tested by
  `tests/client-info-request.test.mjs` with no emulator), mirroring `portal-core.js`:
  - `require('./portal-core')` for `CODE_ALPHABET`, `rateLimitDecision`, `manilaDateFrom`, `tokenHash`, `newViewerToken`.
  - `const { FORMS, PRIVACY_NOTICE, LIMITS } = require('./cir-forms')`.
  - `refNo(nowMs, randomBytes)` → `'CIR-' + yymmdd + '-' + 6×CODE_ALPHABET` (copy portal's `refNo` body with the prefix changed — do NOT edit portal-core.js).
  - `RATE = { start: {window:3600e3,max:20,lock:3600e3,maxLock:24*3600e3}, photo: {window:3600e3,max:80,lock:3600e3,maxLock:24*3600e3}, submit: {window:24*3600e3,max:5,lock:24*3600e3,maxLock:7*24*3600e3}, global: {window:3600e3,max:40,lock:1800e3,maxLock:6*3600e3} }`.
  - `stripText(s, { multiline })` — single-line: strip `[\x00-\x1F\x7F]`; multiline: strip `[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]`; always `.trim()`.
  - `validateAnswers(formDef, rawAnswers)` → `{ ok, errors: string[], clean: {…} }` implementing the §1.4 table exactly: unknown key → error `Unknown field "<key>"`; required missing → `"<label>" is required`; blanks omitted from `clean`; chips deduped and re-ordered to option order; table rows normalised.
  - `validatePhotoList(formDef, rawPhotos, draftPhotos)` → `{ ok, errors, clean }`: each `{photoId, group, caption}` must exist in `draftPhotos[photoId]`, `group` ∈ form groups (and must equal the draft's recorded group), caption stripped ≤ `LIMITS.maxCaption`; ≤ `LIMITS.maxPhotos`; no duplicate photoId.
  - `validateJpegDataUrl(dataUrl)` → `{ ok, bytes, buf, error }`: prefix `data:image/jpeg;base64,` required; base64 decode; magic `FF D8 FF`; last two bytes `FF D9` (EOI) required; `LIMITS.minPhotoBytes ≤ bytes ≤ LIMITS.maxPhotoBytes`.
  - `botCheck({ honeypot, draftCreatedMs, nowMs })` → `{ bot: bool, reason: 'honeypot' | 'too_fast' | null }` — honeypot non-empty, or `nowMs - draftCreatedMs < LIMITS.minFillMs`.
  - `fingerprintDay(email, phone, manilaDate)` → `sha256(lower(trim(email)) + '|' + digitsOnly(phone)) + '|' + manilaDate`.
  - `buildSummary(formDef, clean, photoCount)` → the §1.2 `summary` object (strings, `''` when blank; numbers stringified).
  - `buildNotification(sub)` → `{ title, body, icon, type, link }` with **plain emoji**: title `📥 New client brief — ${company || name}` (≤ 200), body `${name} · ${bizType || 'business type not given'} · ${budget || 'budget not given'} · Ref ${refNo}. Open Sales → Briefs.` (≤ 2000), `icon: '📥'`, `type: 'client_info_request'`, `link: 'dept:Sales'`. Must contain no `<` characters (test).
  - `privacyNoticeSha256()`.
  - `photoId(randomBytes)` → `'p_' + 12 lowercase hex`.
  - `draftPath(draftHash, photoId)` / `finalPath(refNo, photoId)`.
- **`functions/index.js`** — thin Admin-SDK glue. Reuse the existing `portalClientIp(context)`,
  `portalSha256Hex`, `manilaDate`, `dedupDocId`. Add `const cir = require('./cir-core');` next to the
  `portal` require at the top (one line — the only edit outside the appended block).

### 2.1 Rate limiting (every anonymous callable, first thing after shape validation)

```
async function cirRateLimit(db, buckets /* [{ref, cfg}] */, nowMs)
```
One Firestore transaction: read every bucket ref; for each compute `portal.rateLimitDecision(data, nowMs, cfg)`;
if **any** is `!allowed` → throw `HttpsError('resource-exhausted', 'Too many requests from this connection. Try again in N minutes.')`
(N = ceil(max retryAfterMs / 60000), min 1) and write nothing; else `tx.set(ref, {...decision.next, updatedAt: serverTimestamp()})`
for every bucket (every call counts as an attempt — unlike the portal, there is no "success reset"; a
window simply expires). A transaction/read error → throw `HttpsError('unavailable', …)` — **fail closed**.
Bucket refs: `db.collection('cir_ratelimit').doc(portalSha256Hex(scope + '|' + ipKey))`; global:
`db.collection('cir_ratelimit').doc('global_submit')`. Log `cir_abuse {kind:'rate_limited'}` best-effort on denial.

**`ipKey` is NOT `rawRequest.headers['x-forwarded-for'].split(',')[0]`** — Google APPENDS the address
it saw to the caller's own XFF rather than replacing it, so the first entry is attacker-controlled and
a direct caller could mint a fresh bucket per request (fixed in the portal 2026-09-26). Derive it ONLY
as `const ipInfo = portal.clientIpFrom(context.rawRequest); const ipKey = portal.rateLimitIpKey(ipInfo);`
(portal-core.js — right-most XFF entry, IPv6 bucketed per /64). **`ipKey === null` ⇒ fail closed**:
throw the same `resource-exhausted` error a locked-out caller gets, before touching Firestore. Store
`ipInfo.ip` (may be `null`) in the forensic block, never the raw header.

### 2.2 `cirStartDraft` — `region('asia-east1').https.onCall`, anonymous

Request: `{ formId: string }`.
1. `formId` must be a key of `cir.FORMS` else `invalid-argument 'Unknown form.'`.
2. Rate limit: `start|ip`.
3. Mint `{ token, tokenHash } = portal.newViewerToken()`; create `cir_drafts/{tokenHash}` =
   `{ formId, formVersion, createdAt: serverTimestamp, ipHash, uaHash, photoCount: 0, bytesTotal: 0, photos: {}, submittedAt: null, refNo: null }`.
4. Best-effort (never fails the call): purge up to 5 stale drafts — `where('submittedAt','==',null)`
   ordered by `createdAt` asc, `limit(5)`, keep only those with `createdAt < now - LIMITS.draftTtlMs`:
   delete Storage prefix `client-info-requests/drafts/{id}/` (`bucket.deleteFiles({prefix})`) then the doc.
   (Single-field query — `submittedAt` equality + `createdAt` order needs a composite index → **instead**
   query `orderBy('createdAt','asc').limit(5)` and filter `submittedAt == null && stale` in code. No index.)
   Submitted drafts older than the TTL are also deleted (their photos were moved; `deleteFiles` on an empty prefix is a no-op).
Response: `{ ok: true, draftToken: token, formVersion, serverNow: ISO }`.

### 2.3 `cirUploadPhoto` — anonymous

Request: `{ draftToken: string(43 base64url), group: string, caption: string, dataUrl: string, width?: number, height?: number }`.
1. Shape: token matches `/^[A-Za-z0-9_-]{43}$/` else `unauthenticated 'Please reload the page.'`;
   `dataUrl` string ≤ 1,300,000 chars else `invalid-argument 'Photo is too large.'`.
2. Rate limit: `photo|ip`.
3. `cir.validateJpegDataUrl(dataUrl)` → on failure `invalid-argument <error>` and `cir_abuse {kind:'photo_reject'}`.
4. Transaction on `cir_drafts/{tokenHash(draftToken)}`: must exist, `submittedAt == null`,
   `createdAt ≥ now - LIMITS.draftTtlMs` (else `failed-precondition 'Your upload session expired — reload the page.'`);
   `group` ∈ `FORMS[draft.formId]` photo groups else `invalid-argument`; caps: `photoCount + 1 ≤ LIMITS.maxPhotos`
   (`resource-exhausted 'Up to 20 photos per brief.'`), `bytesTotal + bytes ≤ LIMITS.maxTotalPhotoBytes`
   (`resource-exhausted 'Photos total is over the limit — remove one and try again.'`).
   Mint `photoId`; **write the Storage object BEFORE the Firestore update** so a failed upload never leaves a phantom record:
   `bucket.file(draftPath).save(buf, { contentType:'image/jpeg', resumable:false, metadata:{ cacheControl:'private, max-age=0', metadata:{ firebaseStorageDownloadTokens: crypto.randomUUID(), group, photoId } } })`
   — do this OUTSIDE the transaction, then run the transaction that re-checks caps and records
   `photos.{photoId} = { group, bytes, width, height, path: draftPath, uploadedAt }`, `photoCount+1`, `bytesTotal+bytes`.
   If the transaction throws after the save, delete the object (best-effort) and rethrow.
5. Caption is NOT stored on the draft (it is sent again at submit) — width/height clamped to 1..10000 ints.
Response: `{ ok: true, photoId, bytes, photoCount, bytesTotal }`.

### 2.4 `cirRemovePhoto` — anonymous

Request: `{ draftToken, photoId: /^p_[0-9a-f]{12}$/ }`. Rate limit `photo|ip`. Transaction: draft must
exist and be unsubmitted; if `photos[photoId]` missing → return `{ ok: true, removed: false }` (idempotent);
else delete the record, decrement counters, then delete the Storage object best-effort (a missing
object is fine). Response `{ ok: true, removed: true, photoCount, bytesTotal }`.

### 2.5 `cirSubmit` — anonymous

Request:
```
{ draftToken, formId, formVersion, answers: {…}, photos: [{photoId, group, caption}], 
  consent: { agreed: true, noticeVersion }, honeypot: string, fillMs: number }
```
Order of operations (each step's failure code is what the page switches on):
1. **Shape + size.** `JSON.stringify(data).length ≤ LIMITS.maxPayloadBytes` else `invalid-argument 'The form is too large to send.'`;
   token regex; `formId` known; `formVersion === FORMS[formId].formVersion` else
   `failed-precondition 'This form was updated — please reload the page. Your answers are saved on this device.'`;
   `consent.agreed === true` else `invalid-argument 'Please tick the data privacy consent.'`;
   `consent.noticeVersion === PRIVACY_NOTICE.version` else `failed-precondition 'The privacy notice was updated — please reload and review it again.'`.
2. **Rate limit** (one transaction): `submit|ip` AND `global_submit`.
3. **Validate answers**: `cir.validateAnswers(def, answers)`; on `!ok` → `invalid-argument` with
   `errors.slice(0,5).join(' ')` and `cir_abuse {kind:'bad_payload'}` when errors include an unknown key.
4. **Read draft** (plain get): must exist, `formId` matches, `submittedAt == null`, not expired →
   else `failed-precondition 'Your session expired — reload the page and send again (your answers are saved on this device).'`.
5. **Bot check**: `cir.botCheck({ honeypot: data.honeypot, draftCreatedMs: draft.createdAt.toMillis(), nowMs })`.
   If bot: write `cir_abuse {kind}` best-effort and **return a plausible fake success**
   `{ ok: true, refNo: cir.refNo(nowMs), receivedAt: ISO, fake: undefined }` — nothing else is written, no photos moved, no notification.
   (The page cannot tell; the real client never trips it — 15 s is far below any honest fill.)
6. **Validate photos**: `cir.validatePhotoList(def, data.photos, draft.photos)` → `invalid-argument`.
   Photos the draft holds but the payload omits are treated as removed (deleted from Storage best-effort after commit).
7. **Duplicate guard**: `fpDay = cir.fingerprintDay(clean.email, clean.phone, manilaDate())`;
   `client_info_requests.where('fingerprintDay','==',fpDay).limit(1)` non-empty →
   `already-exists 'We already received a brief from this e-mail and number today. Call 0927 683 6300 if you need to change something.'`
   (+ `cir_abuse {kind:'duplicate'}`).
8. **Mint refNo**: `cir.refNo(nowMs)`; if `client_info_requests/{refNo}` exists, mint once more; second collision → `internal`.
9. **Move photos** to the final prefix, sequentially: `bucket.file(draftPath).move(finalPath)`
   (metadata incl. the download token is preserved). Track `moved[]`. On any failure: move the
   `moved[]` back (best-effort), throw `unavailable 'Could not save your photos — please try again in a moment.'`.
10. **Transaction**: re-read draft (still `submittedAt == null`, else `failed-precondition` — and move photos back);
    `tx.create(client_info_requests/{refNo}, doc)` with the §1.2 shape (`photos[].path` = final path,
    `client.ip/ipHash/userAgent/acceptLanguage/referer/fillMs`, `consent`, `fingerprintDay`, `draftHash`,
    `summary = cir.buildSummary(def, clean, photos.length)`, `status:'new'`, `createdAt/updatedAt/consentedAt: serverTimestamp`,
    `submittedOnManila: manilaDate()`); `tx.update(draft, { submittedAt: serverTimestamp, refNo })`.
    On failure move photos back best-effort and throw `internal 'Could not record your brief — please try again.'`.
11. **Post-commit, best-effort, NEVER fails the call** (`try/catch` around the whole block, `console.error` inside):
    a. Delete draft photos the payload omitted.
    b. **Notify staff.** Recipients = union of `users.where('department','==','Sales')`,
       `users.where('departments','array-contains','Sales')`, and `users.where('role','==','president')`;
       dedupe by uid; drop any doc whose `role === 'partner'`. **OWNER RULING R1 (2026-09-26, amended
       same session): the Sales department AND the President — the President always gets his own copy,
       whether or not he holds the Sales department.** The three queries are independent; if any one of
       them fails, still send to whoever the others returned (log the failure) rather than dropping the
       whole notify. For each uid write
       `notifications/{uid}/items/{dedupDocId('cir_' + refNo + '_' + uid)}` via `commitInChunks` with
       `notifData = { ...cir.buildNotification(doc), dedupKey: 'cir_' + refNo + '_' + uid }` — exactly the
       allowlisted field set (`title, body, icon, type, link, read, createdAt, dedupKey`), **no `senderUid`**
       (system send, exempt from the per-sender push quota, same as `metaLeadWebhook`). If the recipient
       lookup fails or yields nobody, log it — do not throw.
    c. Stale-draft purge as in 2.2 step 4 (≤ 5).
Response: `{ ok: true, refNo, receivedAt: new Date(nowMs).toISOString(), submittedOnManila }`.

### 2.6 `cirAdminDelete` — **staff-authenticated**

Request `{ refNo: /^CIR-\d{6}-[A-Z2-9]{6}$/ }`. `context.auth` required (`unauthenticated`); role from
`users/{uid}.role` must be `president` or `manager` (`permission-denied`). Steps: read doc (`not-found`);
`bucket.deleteFiles({ prefix: 'client-info-requests/' + refNo + '/' })`; delete every doc in
`notes` subcollection (batched); delete the doc; write `audit_log` `{ ts: serverTimestamp, action:'delete',
entity:'client_info_request', entityId: refNo, actorUid: uid, actorName: users.displayName || email,
actorRole: role, details: { company: doc.summary.company, photoCount: doc.summary.photoCount } }`
(company only — no further PII in the audit trail). Response `{ ok: true }`. Any failure after the
Storage delete but before the doc delete → `internal` (the UI shows "retry"); the operation is idempotent.

### 2.7 Error codes the page must handle (union across callables)

| code | page behaviour |
|---|---|
| `resource-exhausted` | show message verbatim (it carries the minutes); keep draft; re-enable button |
| `invalid-argument` | show message; scroll/focus the first invalid field when the message names one; re-enable |
| `failed-precondition` | show message + a "Reload" button; draft kept (version/notice/session cases) |
| `already-exists` | show message; keep draft; re-enable |
| `unauthenticated` | draft token bad → clear `draftToken` from the saved draft, call `cirStartDraft` again, retry ONCE, else show generic error |
| `unavailable` / `internal` / `deadline-exceeded` / network failure | "Something went wrong on our side — your answers are saved on this device. Please try again in a moment." + Retry; offline banner if `!navigator.onLine` |
| `not-found` (delete only) | staff toast |

---

## 3. Rules additions (final text)

### 3.1 `firestore.rules` — insert immediately after the `client_portal_outbox` block (line ~799), verbatim; **≤ 1,400 bytes**

```
    // Client information requests (specs/CLIENT-INFO-REQUEST-SPEC.md) — public form is callable-only;
    // cir_drafts / cir_ratelimit / cir_abuse have NO match block (Admin SDK only). Secretary = view-only.
    function cirWriter() { return isSeniorAdmin() || (!isSecretary() && inDept('Sales')); }
    match /client_info_requests/{ref} {
      allow read: if isAuth() && !isPartner();
      allow create, delete: if false;
      allow update: if isAuth() && cirWriter()
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['status','statusChangedAt','statusChangedBy','statusChangedByName','convertedClientId','convertedAt','convertedBy','updatedAt'])
        && request.resource.data.get('status','') in ['new','in_review','contacted','converted','archived'];
    }
    match /client_info_requests/{ref}/notes/{nid} {
      allow read: if isAuth() && !isPartner();
      allow create: if isAuth() && cirWriter()
        && request.resource.data.get('authorUid','') == request.auth.uid
        && request.resource.data.get('at', null) == request.time
        && isBoundedString(request.resource.data.get('text',''), 2000);
      allow update, delete: if false;
    }
```
Deliberate: **no `events` subcollection** (staff actions are on the doc + `audit_log`); read is
"any internal staff" (same tier as `clients`/`roc_leads`); write = president/manager or a
non-secretary Sales-department member — this is deliberately **not** `canDept('Sales')`, because
`canDept` resolves through `isAdmin()`, which admits the Corporate Secretary. Client mirror in §5.2.

### 3.2 `storage.rules` — two edits

(a) In `isReservedTop(seg)` add the segment so the generic `{department}/{subfolder}/{fileName}` block
(which would otherwise MATCH the 3-segment final path and grant internal staff **create**) never applies:
```
        || seg == 'attendance-selfies' || seg == 'client-info-requests';
```
(b) Insert before the `client-portals` block:
```
    // Client information request photos (specs/CLIENT-INFO-REQUEST-SPEC.md §3.2) — written ONLY by
    // the cir* callables (Admin SDK). Staff read; partner never. The 4-segment
    // client-info-requests/drafts/{d}/{f} path matches no block at all → deny-all by construction.
    match /client-info-requests/{ref}/{fileName} {
      allow read: if isSignedIn() && !isPartnerClaim();
      allow write: if false;
    }
```

### 3.3 `firestore.indexes.json` — **no change.** Every query is single-field (`orderBy createdAt`,
`where fingerprintDay ==`, `orderBy createdAt asc` on drafts). Do not add an index.

---

## 4. The public page — `sales/clientinformationrequest/index.html`

### 4.1 Shell (static HTML, one inline `<script>`, one `<style>`)

- `<!doctype html><html lang="en">`; head: charset, viewport (`viewport-fit=cover`), `<title>Commissary Kitchen Project Brief — Barro Industries</title>`,
  `<meta name="robots" content="noindex,nofollow">`, generic OG tags (copy the portal's pattern with title/description of this page; `og:url` = the public URL; image `https://barroindustries.com/icons/barro-kitchens.png`), `<link rel="icon" href="/icons/icon-192.png">`, Google Fonts Archivo + IBM Plex Sans (as in Neil's file), theme pre-paint script reading `localStorage['barro-cir-theme']` (portal idiom, own key).
- **CSS = Neil's stylesheet, kept** (the `:root` tokens, three-state dark mode, `.plate` nameplate with rivets, `.progress`, `fieldset/legend`, `.grid/.full`, `.chip`, `.eq-scroll table`, `.btn`, `.consent`, `.done`, `.err`, print block). Additions: `.photos` group cards, `.ph-grid` tiles (`aspect-ratio:1`, `object-fit:cover`), `.ph-tile .cap` caption input, `.ph-tile .del`, `.ph-status`, `.ph-placeholder` (grey tile with 🖼 and "Uploaded — preview not available after reload"), `.theme-toggle` (portal's 38px round button, top-right of the plate), `.banner` (offline / error), `.receipt` (done panel print isolation `body.print-receipt` idiom from the portal), `.hp` honeypot stays off-screen. Mobile: ≤560px single-column grid (as his), 44px tap targets, body side padding 16px, `.eq-scroll{overflow-x:auto}` is the only horizontal scroller. `prefers-reduced-motion` respected.
- Scripts, in order: `<script src="/js/cir-forms.js"></script>` (absolute; same origin — GitHub Pages serves it; the SW treats it as a normal JS asset), then
  `https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js` and `firebase-functions-compat.js` (same version as the portal; no Firestore/Storage/Auth SDK on this page), then the inline page script.
- Firebase config block copied verbatim from `projects/chibabs/projectconfirmation/index.html` (`FIREBASE_CFG`, `REGION = 'asia-east1'`). `FORM_ID = 'commissary_brief'` constant at the top of the script; everything else comes from `window.CIR_FORMS[FORM_ID]`, `window.CIR_PRIVACY_NOTICE`, `window.CIR_LIMITS`. If `CIR_FORMS` is missing (script failed) show a full-page error card "Could not load the form — reload or call 0927 683 6300".

### 4.2 Rendering (data-driven, §1.4 rule)

- Plate header from `def.brand/title/intro/specs`. Progress bar: `% = started sections / total` where a section is "started" when any of its inputs has a value / any chip checked / any table row has an item / any photo exists in its groups; text `NN% complete · k of 10 parts started`.
- `<form id="intake" novalidate autocomplete="on">` → one `<fieldset>` per section: `<legend><span>{n}</span>{title}</legend><p class="hint">…</p>` then fields per the grid rule. Inputs carry `id`/`name` = field key, `data-key`, `required` where set, `aria-describedby` for hints. Chips: `<label class="chip"><input type=checkbox name=key value="{v}"><span>{l}</span></label>`. Table: as Neil's `row()` builder, `minRows` blank rows on first load, "+ Add equipment", `×` remove, `aria-label`s per cell. Photos: one card per group with label, hint, "Add photos" (`<input type=file accept="image/*" multiple>` — also allow `capture` via a second "Take photo" button that sets `capture="environment"` on mobile), tile grid, per-tile caption input (`maxlength=120`), remove button, status line. A global counter "n of 20 photos · x MB" under the section hint.
- Consent block at the end of the last section: checkbox + `PRIVACY_NOTICE.consentLine`, then `<details><summary>Read the full privacy notice (RA 10173)</summary>` rendering every `sections[]` heading/body, and "Notice version {version}".
- Honeypot: `<p class="hp" aria-hidden="true"><label>Fax number <input name="fax_number" tabindex="-1" autocomplete="off"></label></p>`.
- Actions: `Send project brief` (primary), `Print / save as PDF` (window.print of the form), `#savedNote`, `#errMsg role=alert aria-live=assertive`.
- Done panel (`#done role=status`): "Project brief sent", body text, **Reference number** in large mono (`CIR-…`), "Received {Manila date} · we'll be in touch to schedule a site visit", buttons `Save receipt as PDF` (body.print-receipt + `window.print()`, `afterprint` cleanup — portal idiom) and `Send another brief`. The receipt also lists a compact summary of the answers (label: value per field, chips joined by ", ", equipment rows as "item × qty | brand | power | cond | plan", photo counts per group) so the client can keep a copy — all values inserted via the page's own `esc()` (text → HTML escape) even though they typed them (defence in depth against a pasted `<script>` from their own clipboard).

### 4.3 Draft autosave (localStorage, no image bytes)

Key `barro-cir-{formId}-v{formVersion}`. Value:
```
{ answers: { key: value|value[] }, equipment: row[], photos: [{ photoId, group, caption, name, bytes }],
  draftToken, draftCreatedAtIso, startedAtMs, savedAtMs }
```
Save on every `input`/`change` (debounced 300 ms) and after every photo state change; show "Draft
saved on this device" in `#savedNote`. Load on boot: restore inputs/chips/table rows; restore photo
tiles as **placeholder tiles** (no thumbnail — the bytes are not stored and the object is not publicly
readable) showing the original filename, size, editable caption and a remove button; `draftToken` is
reused so the uploaded photos stay attached. All `localStorage` access wrapped in `try/catch` (private
mode). The draft is removed only after a successful submit; "Send another brief" also clears it.
A draft older than `LIMITS.draftTtlMs` (by `draftCreatedAtIso`) is treated as expired: answers are
restored but photos are dropped and a new draft token is requested (banner: "Your earlier photos
expired after 7 days — please add them again").

### 4.4 Photo pipeline (client)

For each picked `File`, sequentially (queue; never parallel uploads):
1. If `file.type` is set and not `image/*` → tile error "Not an image". HEIC/HEIF from iOS usually
   decodes in Safari; elsewhere decode fails → tile error "Couldn't read this photo on this device —
   try a JPEG/PNG or a screenshot of it". Never upload the original bytes.
2. Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })` → fallback plain
   `createImageBitmap` → fallback `<img>` via FileReader (exact ladder from `js/drive.js`
   `_decodeForAvatar`). Null → error tile.
3. Canvas: scale so long edge ≤ `LIMITS.photoLongEdge`, paint white, `drawImage`, `toBlob('image/jpeg', LIMITS.photoQuality)`.
   If `blob.size > LIMITS.maxPhotoBytes` retry at quality 0.6; if still over, long edge 1200 @ 0.6; if
   still over → tile error "This photo is too detailed to shrink — try a different one". Free the bitmap (`close()`).
4. Show thumbnail (`URL.createObjectURL(blob)`, revoked on remove/unload), status "Uploading…".
5. Ensure `draftToken` (call `cirStartDraft` if absent/expired). `cirUploadPhoto({ draftToken, group, caption:'', dataUrl, width, height })`
   (dataUrl via FileReader.readAsDataURL of the JPEG blob). On success record `{photoId, group, caption, name: file.name, bytes}` in the draft; status "Uploaded ✓".
   `resource-exhausted`/`invalid-argument` → tile error with the server message, tile removable;
   `unauthenticated`/`failed-precondition (session expired)` → new draft token, retry once;
   network/`unavailable` → "Upload failed — tap to retry" (tile keeps the blob in memory while the page lives).
6. Remove → `cirRemovePhoto` (fire-and-forget with one retry) + drop from draft immediately.
7. Caps enforced client-side before upload (count/total bytes) with a friendly message; the server re-checks.
8. Captions are edited locally (debounced into the draft) and sent only at submit.

### 4.5 Submit flow

1. Client validation: every `required` field non-blank (email regex, phone `≥ 10 digits` hint but server rule is the authority), consent ticked, no photo still "Uploading…" (wait or remove), no photo in error state left with a caption (errors are just dropped). On failure: `#errMsg` "Please complete the required fields: …" and focus the first.
2. Disable button → "Sending…". Ensure draft token (start one if missing). Build payload
   `{ draftToken, formId, formVersion, answers, photos:[{photoId, group, caption}], consent:{agreed:true, noticeVersion}, honeypot: fax_number value, fillMs: now - startedAtMs }`
   where `answers` contains only non-blank values, chips as value arrays, the table as rows (rows without `item` dropped), numbers as numbers.
   If `JSON.stringify(payload).length > LIMITS.maxPayloadBytes` → error "The form is too long — please shorten your longest answers".
3. `cirSubmit` → on success: clear draft, hide form + progress, show the done panel with the receipt, `scrollIntoView`, `history.replaceState` nothing (no hash routing on this page).
4. Errors per §2.7. The button is re-enabled on every failure. Double-submit guard: a module flag `submitting`.

### 4.6 Mock mode (QA seam — mirror the portal)

`?mock=1` makes `Cir.startDraft/uploadPhoto/removePhoto/submit` resolve locally (no Firebase init):
random photoIds, in-memory counters, 400–900 ms delays; `?mock=1&sim=ratelimit` rejects submit with
`resource-exhausted`, `sim=error` with `unavailable`, `sim=dup` with `already-exists`, `sim=slow`
adds 3 s. The real path is `firebase.app().functions(REGION).httpsCallable(name)` behind the same
four methods; `normalizeError(e) → {code, message}` exactly as the portal.

### 4.7 Accessibility / offline / misc

- All controls labelled; legends are real; error region `aria-live`; upload status `aria-live=polite`;
  keyboard operable chips (they are checkboxes); focus rings kept (Neil's `outline:3px`).
- `window.addEventListener('offline'/'online')` toggles a top banner "You're offline — your draft is safe on this device; sending needs a connection".
- `beforeunload` warns only while an upload is in flight.
- No analytics, no third-party scripts beyond Firebase + Google Fonts.
- Do **not** add this page to `sw.js` PRECACHE or index.html. Nothing in `sw.js` needs to change:
  a navigation to `/sales/clientinformationrequest/` is served network-first (3 s timeout) and never
  falls back to the app shell.

---

## 5. The internal Sales subtab — `Briefs`

### 5.1 Wiring edits (file-by-file, WS-C)

**`js/screens/sales.js`**
- Line 110: `const salesTabs = ['Clients','Briefs','Quotes','Analytics','Partner','Files','SOP','Budgeting','Tasks'];`
- Line 112–114 `alias`: add `'Client Briefs':'Briefs', 'Client Information Requests':'Briefs', 'Info Requests':'Briefs'`.
- `sopPanel` steps (lines 123–128): add a step after the Clients line:
  `'Briefs holds every Client Information Request sent from barroindustries.com/sales/clientinformationrequest/ — review the answers and photos, add notes, then Convert to client.'`
- `loadSalesContent` switch: add after `case 'Clients'`:
  ```js
  case 'Briefs':
    if (window.renderClientBriefs) await window.renderClientBriefs(content, currentUser, currentRole);
    else content.innerHTML = window.renderEmptyState({ icon: '⚠️', title: 'Briefs screen not loaded', hint: 'Reload the app and try again.' });
    break;
  ```
  (Guarded — same forward-reference convention every screens file documents.)

**`js/config.js`**
- `DEPARTMENTS['Sales'].subtabs` (line ~241): `['Clients', 'Briefs', 'Quotes', 'Analytics', 'Partner', 'Files', 'SOP', 'Budgeting', 'Tasks']`.
- `PAGE_SCRIPTS` (line ~1611): `'dept:Sales': ['js/screens/sales.js', 'js/screens/production.js', 'js/screens/tasks.js', 'js/cir-forms.js', 'js/screens/client-info-requests.js'],`
  and the `'bk-quotations'` entry (it calls `renderSales` too): append the same two files. Do not touch any other entry.

**`sw.js`** PRECACHE (single-quoted, one per line, after `'/js/screens/client-portals.js',`):
```
  '/js/cir-forms.js',
  '/js/screens/client-info-requests.js',
```
(ci-invariants check 2 fails without these; the pre-commit hook regenerates `precache-manifest.json`.)

**`scripts/ui-wiring-allowlist.json`** — only if `check-ui-wiring.js` warns about an id assigned
dynamically; prefer rendering literal `id=` attributes so no allowlist entry is needed. Note the
checker only scans `js/*.js` + index.html, not `js/screens/`, but follow its conventions anyway: every
inline `onclick="cirX(...)"` must be a `window.cirX` global; prefer `addEventListener` scoped to the
container for everything else.

**No NAV_REGISTRY entry, no CSS `.nav-item[data-page]` rule, no `navigateTo` case** — the tab is
reached as `#/dept/Sales/Briefs` (hash router already supports subtabs via `initialSubtab`).

### 5.2 Role gating (client mirror of §3.1 — write it once, top of the file)

```js
function cirCanWrite() {
  const role = window.currentRole || '';
  if (role === 'president' || role === 'manager' || role === 'owner') return true;
  if (role === 'secretary') return false;                     // standing boundary: view-only
  return (window.currentDepts || []).includes('Sales');       // Sales-dept staff of any other role
}
function cirCanDelete() { return ['president','manager','owner'].includes(window.currentRole || ''); }
```
Deliberately **not** `canEditDept('Sales')` (it returns true for the secretary). Every write control is
hidden when `cirCanWrite()` is false; the Delete button when `cirCanDelete()` is false. Reading is open
to whoever can open the Sales page (rules: any internal non-partner).

### 5.3 File skeleton — `js/screens/client-info-requests.js`

Header comment in the repo's house style (purpose, spec pointer, load-order contract: lazy via
`PAGE_SCRIPTS['dept:Sales']`, called only from `sales.js` at runtime, reads `window.CIR_FORMS`
loaded by the same manifest; secretary view-only). `'use strict'`. Module-local state:
`_cirView ('list'|'detail')`, `_cirRows`, `_cirCurrent`, `_cirStatusFilter`, `_cirSearch`, `_cirUrlCache = {}` (path → download URL promise).

Public globals (window.*): `renderClientBriefs(container, currentUser, currentRole)`, `cirOpen(refNo)`,
`cirBackToList()`, `cirSetStatus(refNo, status)`, `cirAddNote(refNo)`, `cirConvert(refNo)`,
`cirPrefillQuote(refNo)`, `cirPrint(refNo)`, `cirDelete(refNo)`, `cirCopyLink()`, `cirPreviewPhoto(idx)`.

Helpers (file-local): `cirFetchList()` — `dbCachedGet('cir-list', () => db.collection('client_info_requests').orderBy('createdAt','desc').limit(200).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))), 30000)`;
`cirInvalidate()` → `dbCacheInvalidate('cir-list')`; `cirFetchOne(refNo)` (direct get, no cache);
`cirFetchNotes(refNo)` (`orderBy('at','asc')`); `cirAge(ts)` → `'today' | 'yesterday' | 'N days ago'`
computed from `window.bizDate(ts.toDate())` vs `window.bizDate()` (day difference via `Date.UTC` of the
two ISO dates — never `toISOString()` on a local Date); `cirStatusPill(status)` → `.badge` with
`badge-blue` (new), `badge-orange` (in_review), `badge-purple` (contacted), `badge-green` (converted),
`badge-gray` (archived); `cirPhotoUrl(path)` → `storage.ref(path).getDownloadURL()` memoised in `_cirUrlCache`,
result passed through `safeHttpUrl()`; `cirRenderAnswers(def, sub, mode)` — the generic walker (§5.5).

### 5.4 List view

Header row: title "Client Briefs" + subtitle "Client Information Requests from barroindustries.com",
buttons `🔗 Copy public link` (`navigator.clipboard.writeText('https://barroindustries.com/sales/clientinformationrequest/')` + toast) and
`↻ Refresh` (invalidate + rerender). Filter: `chipTabs` (`cls: 'cir-status-tabs'`) All / New / In review / Contacted / Converted / Archived with counts;
search `<input>` (debounced) matching ref, company, name, email, phone (case-insensitive, on `summary`).
Table `data-table table-cards` columns: **Ref** (mono), **Received** (`submittedOnManila` + `cirAge`), **Company / Contact**
(company bold, name below, phone/email small), **Business**, **Budget**, **Target**, **Photos** (count), **Status** (pill).
Rows `data-ref`, click → `cirOpen(ref)`. Empty state via `renderEmptyState({ icon:'📥', title:'No client briefs yet', hint:'Send the public link to a prospective client — submissions land here.' })`.
Loading: `withLoadingAndError(container, cirFetchList, render, { skeleton:'table' })`.
Every cell value → `escHtml()`. A row whose `createdAt` is older than 24 months shows a small `badge-amber` "review retention" pill (RA 10173 retention prompt; no auto-purge in v1).

### 5.5 Detail view (`_cirView = 'detail'`, same container)

- Top bar: `←` back (`cirBackToList`), company (h3), contact line (name · position · `tel:` link on phone · `mailto:` link on email — both `href` built as `'tel:' + encodeURIComponent(phone)` / `'mailto:' + encodeURIComponent(email)` and the text `escHtml`'d), ref (mono), received (`submittedOnManila` · `cirAge`), status pill.
- Action bar: status `<select>` (if `cirCanWrite`) → `cirSetStatus`; `Convert to client` (hidden when `convertedClientId` set → show "Converted → client {id} on {date}" text instead); `Prefill Quote Builder`; `🖨 Print / PDF`; `Delete` (danger, `cirCanDelete`).
- Body = `cirRenderAnswers(def, sub, 'screen')`:
  - For each section in `def.sections`: card with `{n}. {title}`; fields with a stored answer rendered as label/value rows (skip blank fields; if a whole section is blank print "— nothing filled in —").
  - `text/tel/email/select/url/date/number`: value cell (`textarea` with `white-space:pre-wrap`); `url` as `<a href="${safeHttpUrl(v)}" target="_blank" rel="noopener">${escHtml(v)}</a>` or plain text when `safeHttpUrl` returns `''`; `date` shown as `DD Mon YYYY` built from the string parts (no `new Date(str)`); `number` via `Number(v).toLocaleString('en-PH')`.
  - `chips`: pills of option **labels** (value → label via the def; unknown values shown raw, escaped).
  - `table`: `<table class="data-table">` with column labels; cells escaped.
  - `photos`: per group a `<h5>` + tile grid (`repeat(auto-fill,minmax(120px,1fr))`); each tile `<button type=button class="cir-ph" data-i="${idx}">` with `<img alt="${escHtml(caption)}" loading="lazy">` (src filled asynchronously from `cirPhotoUrl`; grey placeholder while loading; on failure a "photo unavailable" tile) and caption below (escaped). Click → `cirPreviewPhoto(idx)` → `window.openFilePreview({ url, name: (caption || photoId), contentType: 'image/jpeg' })` (drive.js, eager) — this is the lightbox.
  - Unknown answer keys (older form version) → "Other answers" card, `key: JSON.stringify(value)` escaped.
- Consent card: "Data-privacy consent given {consentedAt Manila datetime} · notice v{noticeVersion}".
- Technical `<details>` (president/manager only): IP, user agent (escaped, `word-break`), accept-language, fill time (`Math.round(fillMs/1000)` s), draft id.
- Notes card: list (`authorName · at` + `text` pre-wrap, escaped) + textarea + "Add note" (`cirCanWrite`).
  `cirAddNote`: `db.collection('client_info_requests').doc(ref).collection('notes').add({ text: text.slice(0,2000), authorUid: currentUser.uid, authorName: userProfile.displayName || currentUser.email, at: serverTimestamp })` + `logAudit('create','client_info_request_note',ref,{})` + rerender notes.
- `cirSetStatus`: `update({ status, statusChangedAt: serverTimestamp, statusChangedBy: uid, statusChangedByName, updatedAt: serverTimestamp })` → toast, `cirInvalidate()`, `logAudit('update','client_info_request',ref,{status})`. Failure → `Notifs.showToast(msg,'error')`.

### 5.6 Convert to client (CRM) — collection `clients` (the Sales › Clients book; same as the Facebook-lead webhook)

`cirConvert(refNo)` (guard `cirCanWrite`; confirm dialog "Create or update a client record from this brief?"):
1. `s = sub.summary`, `a = sub.answers`. `name = s.name`, `company = s.company`.
2. `existing = await window.Clients.findByName(name)` (nameKey match on the contact name — the same
   dedupe rule `openLeadCaptureModal` and `processMetaLead` use).
3. `briefNote = 'Client brief ' + refNo + ' (' + sub.submittedOnManila + '): ' + [a.biz_type, 'site: ' + (a.site_address||''), 'budget: ' + (a.budget||'—'), 'target: ' + (a.target_date||'—'), 'scope: ' + (a.scope||[]).join(', ')].filter(Boolean).join(' · ')` (≤ 1000 chars).
4. If existing: `update({ updatedAt: FV.serverTimestamp(), brands: FV.arrayUnion('sales'), leadOrigin: existing.leadOrigin || 'inbound', source: existing.source || 'Client brief', cirRefs: FV.arrayUnion(refNo), notes: ((existing.notes ? existing.notes + '\n\n' : '') + briefNote).slice(0, 4000), ...fillEmptyOnly({ company, phone: s.phone, email: s.email, address: a.address }) })` — fill-empty-only exactly as the two precedents.
   Else `add({ name, nameKey: window.clientNameKey(name), brands: ['sales'], stage: 'lead', company, phone: s.phone, email: s.email, address: a.address || '', notes: briefNote, followUpDate: '', lastContact: '', contactLog: [], leadOrigin: 'inbound', source: 'Client brief', campaignId: null, handedOffAt: null, cirRefs: [refNo], addedBy: uid, createdBy: uid, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() })`.
5. Update the submission: `{ status: 'converted', convertedClientId, convertedAt: serverTimestamp, convertedBy: uid, statusChangedAt, statusChangedBy, statusChangedByName, updatedAt }`.
6. `dbCacheInvalidate('clients')`, `cirInvalidate()`, `logAudit('update','client_info_request',refNo,{ converted: clientId })`, toast "Client record {created|updated} — see Sales → Clients", rerender detail.

`cirPrefillQuote(refNo)`: `window._qbReopenState = { clientName: name, clientCompany: company, clientAddress: a.address || a.site_address || '', clientPhone: s.phone, clientEmail: s.email }; navigateTo('bk-quote-builder');` — the exact mechanism `crmConvertLeadToQuote` (crm.js) uses; no source/quote ids are set so the builder opens a fresh quote.

### 5.7 Print / PDF

`cirPrint(refNo)`: resolve all photo URLs first (`Promise.all` over `cirPhotoUrl`, failures → omit the
photo with a "(photo unavailable)" caption), then
```js
const lh = window.buildLetterhead ? window.buildLetterhead({ orientation:'portrait', docTitle:'CLIENT INFORMATION REQUEST', dateLabel:'Received ' + sub.submittedOnManila, extraMeta:[refNo, company], signatures:[{ label:'Reviewed by', name: userProfile.displayName || '', title:'Sales' }], footerNote: 'Barro Industries Operating System · Generated ' + new Date().toLocaleString('en-PH') + ' · Contains personal data (RA 10173) — handle accordingly.' }) : null;
window.openPrintableDoc({ title: 'Client Brief ' + refNo + ' — ' + company, barLabel: `${emojiIcon('📥',16)} Client brief ${escHtml(refNo)}`, bodyHtml, pageCss });
```
`bodyHtml` = letterhead header + `cirRenderAnswers(def, sub, 'print')` (same walker, `mode:'print'`:
no buttons, photos as `<img src>` 3-per-row with captions, tables with borders) + consent line + footer.
`pageCss`: `.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:12mm 14mm} h4{margin:10px 0 4px;font-size:12px;text-transform:uppercase;color:#1E3A5F} table{width:100%;border-collapse:collapse} td,th{font-size:10px;padding:3px 4px;border-bottom:1px solid #ddd;vertical-align:top} .cir-kv td:first-child{width:38%;color:#555} .cir-ph-print{display:grid;grid-template-columns:repeat(3,1fr);gap:6px} .cir-ph-print img{width:100%;height:150px;object-fit:cover;border:1px solid #ccc} .cir-ph-print figcaption{font-size:9px;color:#555} fieldset,section{break-inside:avoid} ${lh ? lh.printCSS : ''} @media print{.page{padding:0;width:auto;min-height:0}}`.
The browser Print → Save as PDF is the supported path. The toolbar's JPEG capture may fail on
cross-origin photos (canvas taint) — acceptable; do not attempt to proxy images.

### 5.8 Delete / retention

`cirDelete(refNo)` (`cirCanDelete`): `confirmDialog({ title:'Delete this brief?', message:'Removes the answers, notes and all photos permanently (RA 10173 erasure). This cannot be undone.', danger:true, confirmLabel:'Delete' })`
→ `firebase.app().functions('asia-east1').httpsCallable('cirAdminDelete')({ refNo })` → toast, `logAudit('delete','client_info_request',refNo,{})`, `cirInvalidate()`, back to list.
Retention policy (v1): manual. Notice says 24 months for unconverted briefs; the list flags rows older
than 24 months; no scheduled purge. Archiving (`status:'archived'`) hides nothing — it is a triage state.

---

## 6. Workstreams (partitioned BY FILE — no two workstreams touch the same file)

Workstreams do **not** commit. Each reports back; the coordinator stages explicitly and commits once
per workstream (or once for all) after the gates pass. WS-0 must finish before A/B/C start; A, B, C
then run in parallel, each paired with an adversarial verifier.

### WS-0 — Shared definitions (small, blocking; Sonnet)
Files: **`js/cir-forms.js`** (new — §1.4–1.7 verbatim), **`functions/cir-forms.js`** (`cp` of the
former, byte-identical), **`scripts/ci-invariants.sh`** (append check 7 "CIR FORMS MIRROR":
`cmp -s js/cir-forms.js functions/cir-forms.js || FAIL "functions/cir-forms.js must be byte-identical to js/cir-forms.js — edit js/cir-forms.js then: cp js/cir-forms.js functions/cir-forms.js"`; also FAIL if either file is missing; print PASS otherwise; feeds `overall_fail`).
Acceptance: `node -e "const f=require('./functions/cir-forms.js'); console.log(Object.keys(f.FORMS), f.FORMS.commissary_brief.sections.length)"` prints `[ 'commissary_brief' ] 10`;
every field key unique; every `summaryKeys` value is a real key; `node --check js/cir-forms.js`;
loading the file in a browser defines `window.CIR_FORMS/CIR_PRIVACY_NOTICE/CIR_LIMITS`; `bash scripts/ci-invariants.sh` passes.
Verifier: diff every option string against `/Users/neilbarro/Downloads/commissary-intake.html`
(value attributes and labels), confirm the 6 required fields + 10 sections + photo groups, confirm the
mirror check actually fails when one byte differs (mutate a scratch copy, not the tree).

### WS-A — Public page (Sonnet)
Files: **`sales/clientinformationrequest/index.html`** only.
Acceptance: renders from `CIR_FORMS` with Neil's look (compare side-by-side with the Downloads file);
`?mock=1` full flow works offline of Firebase (fill → photos → submit → receipt → print); draft survives
reload incl. placeholder photo tiles; expired draft handling; every §2.7 error path exercised via
`sim=`; dark mode three-state + toggle; 375px width has no horizontal scroll except the equipment
table; keyboard-only completion possible; `noindex` present; no Firestore/Storage/Auth SDK loaded;
`REGION` passed to `functions()`; honeypot off-screen and not focusable; payload keys ⊆ definition.
Verifier (adversarial): try to inject `<img onerror>` in a caption and a textarea and confirm the
receipt/summary escapes it; try a 25 MB PNG, a HEIC, a PDF renamed .jpg, 21 photos; kill the network
mid-upload; reload mid-fill; confirm no image bytes in localStorage (inspect the key); confirm nothing
is sent before consent is ticked; confirm the page does not reference any `js/` file other than
`/js/cir-forms.js`.

### WS-B — Backend (Sonnet)
Files: **`functions/cir-core.js`** (new), **`functions/index.js`** (one `require` line + appended block), **`tests/client-info-request.test.mjs`** (new), **`firestore.rules`** (§3.1 insert only), **`storage.rules`** (§3.2 two edits only).
Acceptance: `node --test tests/*.test.mjs` green incl. the new file (≥ 40 assertions: refNo shape/alphabet/Manila date; validateAnswers happy path + every rejection class; chips dedupe/reorder; table row dropping; JPEG magic/EOI/size; botCheck both reasons; fingerprintDay determinism; buildSummary; buildNotification caps + no `<` + plain emoji; validatePhotoList ownership/group/caption; mirror equality of the two cir-forms files);
`node --check functions/index.js`; rules compile: `~/.npm-global/bin/firebase deploy --only firestore:rules --dry-run` is not supported — instead use the REST test-compile path from memory (`firebase-cli-rest-access`) or `firebase emulators:exec` if available, else at minimum `wc -c firestore.rules ≤ 261000` and a careful syntax read; `git diff firestore.rules storage.rules` shows ONLY the §3 hunks.
Verifier (adversarial): read every callable line-by-line against §2 — confirm fail-closed on bucket
read error, no path where a photo is recorded without an object or vice versa left un-cleaned, move-back
on transaction failure, fake-success on bot, no `senderUid` on notifications, notification field set
⊆ the rules allowlist, `cirAdminDelete` role check reads `users/{uid}` not a claim, `deleteFiles` prefix
ends with `/` (so `CIR-260926-ABCDEF` never matches `CIR-260926-ABCDEFG`), rules bytes ≤ 1,400, the
`isReservedTop` edit present, and that `client-info-requests/drafts/x/y.jpg` matches no storage block.

### WS-C — Internal screen (Sonnet)
Files: **`js/screens/client-info-requests.js`** (new), **`js/screens/sales.js`**, **`js/config.js`** (DEPARTMENTS subtabs + two PAGE_SCRIPTS entries ONLY — never touch `APP_VERSION`), **`sw.js`** (two PRECACHE lines ONLY — never touch `CACHE_VER`), **`scripts/ui-wiring-allowlist.json`** (only if needed).
Acceptance: `bash scripts/ci-invariants.sh` + `node scripts/check-ui-wiring.js` pass; `npx serve -p 3838 .` →
sign in as president → Sales → Briefs renders (empty state), `#/dept/Sales/Briefs` deep-link works,
`bk-quotations` route then Briefs works (lazy file present); with a seeded doc (create one via the
Admin-SDK REST path from memory `firebase-cli-rest-access`, or by running the public page against prod
once WS-B is deployed) the detail renders every section, chips show labels, photos load via
`getDownloadURL`, preview opens, print panel opens with letterhead, status change persists, note
persists, convert creates/updates a `clients` doc and flips status, prefill opens the builder with the
5 client fields, delete removes doc + notes + photos; secretary sees no write controls; a Sales-dept
employee sees write controls but no Delete.
Verifier (adversarial): seed a doc whose company is `<img src=x onerror=alert(1)>`, whose caption
is `"><script>`, whose `plans_link` is `javascript:alert(1)`, whose answers include an unknown key
and a chips value not in options — confirm list, detail, print body and preview all render inert
text and the unknown key lands in "Other answers"; confirm `cirCanWrite()` is false for secretary
even when `currentDepts` includes 'Sales'; confirm no `toISOString()` in the file; confirm no
`emojiIcon` reaches a toast/notification text; confirm `git diff js/config.js sw.js` contains only
the specified lines.

### WS-D — Docs + deploy (coordinator / main session, after A–C verified)
Files: **`STATUS.md`**, **`.deploy-state`** (via release.sh). Steps in §7.

---

## 7. Deploy order and commands

Run from the repo root. Re-read `git status` and re-`git diff` the rules files immediately before each
deploy (concurrent sessions edit this tree).

1. Gates: `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`
2. Rules size guard: `wc -c firestore.rules` → must print ≤ 261000.
3. `git diff firestore.rules storage.rules` → only the §3 hunks. Then
   `bash scripts/release.sh rules` and `bash scripts/release.sh storage` (each records `.deploy-state`).
4. Functions — **selective, never blanket**:
   `cd functions && npm install --no-audit --no-fund && cd .. && ~/.npm-global/bin/firebase deploy --only functions:cirStartDraft,functions:cirUploadPhoto,functions:cirRemovePhoto,functions:cirSubmit,functions:cirAdminDelete`
   Do **not** run `release.sh functions` and do **not** `release.sh record functions` (the Meta-webhook
   commit `1eb1494` is still deliberately undeployed; recording would hide that drift — same reasoning
   as the portal deploy on 2026-09-26). Confirm in the CLI output that all five are `asia-east1`.
5. Stage explicitly (`git add js/cir-forms.js functions/cir-forms.js functions/cir-core.js functions/index.js tests/client-info-request.test.mjs firestore.rules storage.rules scripts/ci-invariants.sh sales/clientinformationrequest/index.html js/screens/client-info-requests.js js/screens/sales.js js/config.js sw.js STATUS.md specs/CLIENT-INFO-REQUEST-SPEC.md`), `git diff --cached --stat`, commit (hook bumps the version and regenerates the manifest). Suggested message: `feat: Client Information Request — public intake form + Sales › Briefs (spec: specs/CLIENT-INFO-REQUEST-SPEC.md)`.
6. `bash scripts/release.sh push` → wait 1–3 min → `bash scripts/release.sh verify`;
   `curl -sIL https://barroindustries.com/sales/clientinformationrequest/ | grep -m1 '^HTTP'` → 200;
   `curl -sL https://barroindustries.com/js/cir-forms.js | head -c 200`.
7. Live smoke (Neil's phone): open the public URL, fill the required six, attach 2 photos, submit →
   receipt shows; app inbox + push arrive for the Sales department AND the President (ruling R1); Sales → Briefs shows the row; open,
   preview photos, print panel opens; **Delete the test brief** (President) and confirm the Storage
   folder is gone (Firebase console → Storage → `client-info-requests/`).
8. STATUS.md — add at the top (dated 2026-09-26 or the ship date) a paragraph in the existing style:
   > **Client Information Request (NEW, SHIPPED vX.Y.Z).** Public intake form at `barroindustries.com/sales/clientinformationrequest/` (Neil's commissary brief + a Photos part), open link, no account; five `asia-east1` callables (`cirStartDraft/cirUploadPhoto/cirRemovePhoto/cirSubmit/cirAdminDelete`), Admin-SDK-only `cir_drafts/cir_ratelimit/cir_abuse`, `client_info_requests` staff-read; photos downscaled in-browser → Storage `client-info-requests/{ref}/` (staff read only, deleted with the brief). Internal: Sales › **Briefs** (list/detail/print/status/notes/convert-to-`clients`/prefill quote/delete). Notifies the Sales department + the President (ruling R1). Spec: `specs/CLIENT-INFO-REQUEST-SPEC.md`. Rules + storage + functions deployed (date). Form definition versioned in `js/cir-forms.js` (mirror `functions/cir-forms.js`, ci check 7) — a second questionnaire = new FORMS key + new folder.
   Also update the **Production** version cell, and add to the pending-ops register any step not yet
   done (e.g. "[ ] live smoke test + delete the test brief"). Refresh `_Last updated_`.

---

## 8. Owner rulings — CLOSED 2026-09-26 (no open questions remain)

Neil ruled on all four in session. These are binding; implement them, do not re-ask.

- **R1 — Who is notified.** **Every Sales-department user AND the President.** (Ruled "Sales only"
  first, then amended by Neil in the same session — "send me a copy too". The amended ruling is the
  binding one.) The President's copy does not depend on him holding the Sales department; it comes from
  an independent `role == 'president'` query. Implemented in §2.5 step 11b. Partners are always dropped.
- **R2 — Delete authority.** **President AND Manager** may permanently delete a brief with its photos.
  Sales staff and the Corporate Secretary may not. This is what §2.6 `cirAdminDelete` and §3.1 already
  specify — no change needed; the alternative (President-only) is rejected.
- **R3 — Retention.** **Flag only, no automatic purge in v1.** The list flags rows past the 24-month
  promise so a human deletes them; build NO scheduled purge job. §5.8 and §1.6 stand as written.
- **R4 — Naming/placement.** Tab name **`Briefs`**, second chip on the Sales page; Photos stays part 6
  of 10, right after "The site". As written — no change.
