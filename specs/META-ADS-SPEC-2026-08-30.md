# META-ADS-SPEC — Facebook Lead Ads webhook + nightly ad-insights pull (2026-08-30)

Author: Fable (spec). Implementers: Sonnet builders A (backend) and B (frontend).
Owner context: Neil is onboarding an external FB-ads freelancer (team:'freelancer',
Marketing dept). Two integrations: (1) Meta Lead Ads → Cloud Function webhook →
`clients` lead + Sales push, (2) nightly GitHub Action pulling per-campaign Meta
spend/impressions/clicks/leads into a server-written `ad_insights` collection
rendered in Marketing → Insights.

**REPO IS PUBLIC** (GitHub Pages). No token, secret, app id, or ad-account id may
be committed anywhere — secrets live in Firebase Secret Manager (functions) and
GitHub repo secrets (Action) only.

Graph API version: declare `const GRAPH_VER = 'v22.0';` once per file (top-level
const) and interpolate — never hardcode the version inline.

Shared hard rules for BOTH builders:
- NEVER run `git stash`, `git reset`, `git checkout -- <file>`, or `git clean`.
  Do not commit or push — the main session reviews and ships.
- Do not touch sw.js, index.html, js/config.js (version stamps are hook-managed).
- `node --check` every JS file you edit before finishing.
- If the Edit tool fails twice with "modified since read" (OneDrive mtime race),
  fall back to a python exact-match replace script.
- Notification title/body/icon must use PLAIN emoji (e.g. '📥'), never
  emojiIcon() — enforced by scripts/ci-invariants.sh check 5.
- All user-originated strings inserted into innerHTML go through escHtml().

---

## Builder A — backend (functions/index.js, firestore.rules, scripts/meta-insights.js, .github/workflows/meta-insights.yml, docs/META-ADS-SETUP.md)

### A1. Cloud Function `metaLeadWebhook` (append to functions/index.js)

Match the file's existing v1 style (`functions.region(...)`). firebase-functions
^5 keeps the v1 API at the top-level import; `runWith({secrets})` is v1-supported.

```js
exports.metaLeadWebhook = functions
  .region('asia-east1')
  .runWith({ secrets: ['META_APP_SECRET', 'META_PAGE_TOKEN', 'META_VERIFY_TOKEN'] })
  .https.onRequest(async (req, res) => { ... });
```

**GET (subscription handshake):** if `req.query['hub.mode'] === 'subscribe'` and
`req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN`, respond
`res.status(200).send(req.query['hub.challenge'])`. Otherwise 403. Never log the
expected token.

**POST (leadgen delivery):**
1. Signature check: header `x-hub-signature-256` must equal
   `'sha256=' + hmacSha256Hex(req.rawBody, process.env.META_APP_SECRET)`.
   Compare with `crypto.timingSafeEqual` on equal-length Buffers (length check
   first). Missing/mismatched → `res.status(401)`, log a warning WITHOUT the
   body. `req.rawBody` is provided by the v1 https runtime.
2. Accept only `req.body.object === 'page'`. Iterate `entry[].changes[]`,
   process `change.field === 'leadgen'`; each has
   `change.value.leadgen_id` (string) and `value.page_id`.
3. **Dedupe/claim:** `db.collection('meta_leads').doc(leadgenId).create({...})`
   with `{ status:'processing', pageId, receivedAt: FieldValue.serverTimestamp() }`.
   `.create()` throws ALREADY_EXISTS if a concurrent/retried delivery already
   claimed it → skip that entry silently. On any later processing error for the
   entry: `.delete()` the claim doc and log, so Meta's retry can reprocess —
   then continue with remaining entries.
4. **Fetch the lead** (Node 22 global fetch):
   `GET https://graph.facebook.com/${GRAPH_VER}/${leadgenId}?fields=created_time,field_data,campaign_id,campaign_name,ad_id,ad_name,form_id&access_token=${process.env.META_PAGE_TOKEN}`.
   Non-OK response → treat as processing error (step 3 rollback). Never log the URL
   (it embeds the token); log status + leadgenId only.
5. **Parse field_data** (array of `{name, values:[...]}`):
   - name: `full_name`, else `first_name + ' ' + last_name` (either may be absent),
     else `'Facebook Lead ' + leadgenId`. Clamp 200 chars.
   - email: field named `email`; phone: `phone_number` (fallback `phone`). Clamp 120.
   - Every OTHER field goes into the notes text as `Label: value` lines. Clamp
     total notes 2000 chars.
   - notes prefix: `Facebook Lead Ad — form ${form_id}, ad "${ad_name||'—'}", campaign "${campaign_name||'—'}"`.
6. **Campaign mapping:** `db.collection('campaigns').where('metaCampaignId','==', String(campaign_id)).limit(1)` →
   `appCampaignId` (doc id) and app campaign name, or null. Guard campaign_id absent.
7. **Client upsert** — mirror openLeadCaptureModal (js/departments.js ~1493) server-side:
   - `nameKey = name.trim().toLowerCase().replace(/\s+/g, ' ')` (= window.clientNameKey).
   - `clients.where('nameKey','==',nameKey).limit(1)`:
   - EXISTING doc → update: `{ updatedAt: serverTimestamp, leadOrigin: existing.leadOrigin || 'marketing', source: existing.source || 'FB', brands: FieldValue.arrayUnion('sales') }`;
     `campaignId` only if existing has none (first-touch); fill-empty-only for
     company/phone/email; APPEND the notes block to existing notes
     (`existing.notes ? existing.notes + '\n\n' + newNotes : newNotes`, clamp 4000).
   - NEW doc → exact shape of the client-side create:
     `{ name, nameKey, brands:['sales'], stage:'lead', company:'', phone, email,
        address:'', notes, followUpDate:'', lastContact:'', contactLog:[],
        leadOrigin:'marketing', source:'FB', campaignId: appCampaignId || null,
        handedOffAt: null, addedBy:'meta-webhook', createdBy:'meta-webhook',
        createdAt: serverTimestamp, updatedAt: serverTimestamp }`.
8. **Notify Sales** — server-side sendToDept equivalent: query users
   `where('department','==','Sales')` AND `where('departments','array-contains','Sales')`,
   merge + dedupe by uid. For each uid write `notifications/{uid}/items` doc:
   `{ title: '📥 New Facebook lead', body: `${name}${company ? ' · '+company : ''} — Facebook Lead Ad${appCampName ? ' · '+appCampName : ''}. Open the Sales CRM to follow up.`,
      icon: '📥', type: 'lead_handoff', link: 'dept:Sales', read: false,
      createdAt: serverTimestamp, dedupKey: `meta_lead_${leadgenId}_${uid}` }`.
   NO senderUid field (system send — exempts it from the push quota by design).
   The existing sendPushOnNotification trigger turns these into device pushes.
9. Finalize claim doc: update to `{ status:'done', clientId, name, campaignId: appCampaignId||null, metaCampaignId: campaign_id||null, processedAt: serverTimestamp }`.
   Do NOT store full field_data (PII duplication) — the client doc is the record.
10. Respond `res.status(200).send('OK')` after processing all entries (Meta
    retries non-2xx; individual entry failures were rolled back in step 3 and
    will arrive again).

### A2. firestore.rules — two new literal collection blocks

Insert after the `promotions` block (~line 2633), same indentation/comment style:

```
// ── Meta Ads integration (specs/META-ADS-SPEC-2026-08-30.md) ─────────
// ad_insights: per-campaign per-day Meta spend/impressions/clicks/leads,
// written ONLY server-side (nightly GitHub Action via admin SDK, which
// bypasses rules). Readable by any signed-in non-partner — it feeds the
// Marketing → Insights table, and the external ads freelancer (a plain
// employee) legitimately needs it. write:false keeps clients out entirely.
match /ad_insights/{docId} {
  allow read: if isAuth() && !isPartner();
  allow write: if false;
}
// meta_leads: the lead-webhook's claim/audit ledger (Cloud Function only).
// Admin-readable for debugging; no client writes ever.
match /meta_leads/{docId} {
  allow read: if isAuth() && isAdmin();
  allow write: if false;
}
```

Verify helpers `isAuth()`, `isPartner()`, `isAdmin()` exist (they do). Do NOT
deploy rules — main session deploys.

### A3. scripts/meta-insights.js (new file)

Follow scripts/daily-digest.js conventions (requireEnv, admin.initializeApp with
FIREBASE_SERVICE_ACCOUNT JSON). Behavior:

1. If `process.env.META_SYSTEM_TOKEN` or `process.env.META_AD_ACCOUNT_ID` is
   missing/empty → `console.log('[meta-insights] Meta secrets not configured — skipping.')`
   and `process.exit(0)` (workflow stays green until Neil adds secrets). Do this
   BEFORE requiring FIREBASE_SERVICE_ACCOUNT so the skip needs no other env.
2. `actId = META_AD_ACCOUNT_ID.startsWith('act_') ? id : 'act_'+id`.
3. Account currency once: `GET /${GRAPH_VER}/${actId}?fields=currency&access_token=...`.
4. Insights, last 7 days (self-heals missed nights):
   `GET /${GRAPH_VER}/${actId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,actions&time_increment=1&time_range={"since":"<YYYY-MM-DD 7 days ago>","until":"<YYYY-MM-DD today>"}&limit=500&access_token=...`
   Follow `paging.next` until absent. Use global fetch (Node 22 in the workflow).
   Dates via Manila offset (+8h on UTC) to match the app's bizDate convention.
5. leads per row from `actions`: first match in priority order
   `['lead','leadgen_grouped','onsite_conversion.lead_grouped']` (first found
   wins — these overlap, never sum across types). Missing actions → 0.
6. Upsert `ad_insights/{campaign_id}_{date_start}` with merge:
   `{ metaCampaignId: String(campaign_id), campaignName, date: date_start,
      spend: parseFloat(spend)||0, impressions: parseInt||0, clicks: parseInt||0,
      leads, currency, fetchedAt: admin.firestore.FieldValue.serverTimestamp() }`.
7. Log a one-line summary (N rows, M campaigns, date span). Exit non-zero on
   API/auth errors (so the failure step fires). NEVER print the token; when
   logging failed requests, log path + status only.
8. Add `"meta-insights": "node meta-insights.js"` to scripts/package.json scripts.

### A4. .github/workflows/meta-insights.yml (new file)

Mirror sync-to-drive.yml structure: `schedule: cron '30 15 * * *'` (11:30 PM PH)
+ `workflow_dispatch`; checkout, setup-node 22, `npm install` in scripts/, run
`node meta-insights.js` (working-directory scripts) with env
`FIREBASE_SERVICE_ACCOUNT`, `META_SYSTEM_TOKEN`, `META_AD_ACCOUNT_ID` from repo
secrets; on failure run `node report-failure.js meta_insights` with
FIREBASE_SERVICE_ACCOUNT (same pattern as sync-to-drive.yml's failure step).

### A5. docs/META-ADS-SETUP.md (new file)

Neil's go-live checklist, in plain steps: create Business-type app on
developers.facebook.com; System User token scopes (leads_retrieval,
pages_show_list, pages_read_engagement, ads_read); where the three function
secrets get set (`firebase functions:secrets:set META_APP_SECRET` etc. — command
examples with placeholders only); webhook callback URL
`https://asia-east1-barro-industries.cloudfunctions.net/metaLeadWebhook` and
that the verify token is generated at deploy time and handed over privately
(NEVER written into this public repo); Page → leadgen webhook subscription;
GitHub repo secrets META_SYSTEM_TOKEN + META_AD_ACCOUNT_ID; how to test with
Meta's Lead Ads Testing tool; note that each app campaign links via its "Meta
campaign ID" field.

---

## Builder B — frontend (js/departments.js ONLY)

### B1. Campaign modal — Meta campaign ID field

In `openCampaignModal` (~line 1201): after the `Channels` form-group and before
the money-tier budget-line block, add (visible to every editor, not money-gated):

```html
<div class="form-group"><label>Meta campaign ID <span style="font-weight:400;color:var(--text-muted)">(optional — links Facebook ad spend + lead attribution)</span></label>
  <input id="mc-metaid" inputmode="numeric" placeholder="e.g. 120210000000000000" value="${escHtml(camp?.metaCampaignId||'')}"/></div>
```

In the save handler's `data` object add: `metaCampaignId: $('mc-metaid').value.trim() || null,`.

### B2. Insights tab — real Meta ad spend

In `renderMktInsights` (~line 1660):
1. Add a fourth parallel fetch: `ad_insights` via
   `dbCachedGet('ad_insights', () => db.collection('ad_insights').get().catch(()=>({docs:[]})), 60000)`
   (guard `typeof dbCachedGet === 'function'` like its siblings).
2. Per campaign row compute `adSpend` and `adLeads`: if `camp.metaCampaignId`,
   sum `spend`/`leads` over ad_insights docs with matching `metaCampaignId`
   (String compare); else both `null` (render '—', never ₱0 — same convention
   as ledger spend).
3. CPL now prefers ledger spend, falls back to Meta spend:
   `const cplBase = (spend != null) ? spend : adSpend;`
   `cpl: (cplBase != null && leads.length) ? cplBase / leads.length : null`.
4. Table: add column `Ad Spend` immediately after `Spend` (thead + row cell
   `${r.adSpend!=null?'₱'+fmt(r.adSpend):'—'}`; no lock icon — it is visible to
   all Marketing viewers by design).
5. KPI row: add a fourth card `Meta Ad Spend` = sum of non-null adSpend across
   rows; show '—' when every row is null.
6. Keep the existing 🔒 ledger-spend behavior untouched.

### B3. SOP copy

Marketing SOP lines (~1095-1098): update the Insights sentence to
'Insights shows spend vs leads vs quotes vs wins — Facebook ad spend imports
automatically overnight for campaigns with a Meta campaign ID.' Keep style/length
of neighboring lines.

---

## Acceptance (main session verifies)
- `node --check` passes: functions/index.js, scripts/meta-insights.js, js/departments.js.
- `bash scripts/ci-invariants.sh` all green.
- App boots with no console errors; Marketing → Insights renders with zero
  ad_insights docs (all '—', no NaN).
- Webhook GET handshake + signature check reviewed line-by-line.
- No secret value or ad-account id anywhere in the diff.
