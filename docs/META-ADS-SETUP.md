# Meta (Facebook) Ads Integration — Go-Live Setup

specs/META-ADS-SPEC-2026-08-30.md. Two pieces, both already built and waiting
on Meta-side configuration + secrets:

1. **Lead Ads webhook** — `metaLeadWebhook` (Cloud Function, `functions/index.js`).
   Meta calls this the moment someone submits a Facebook Lead Ad form; it
   creates/updates a `clients` lead and notifies Sales.
2. **Nightly ad-insights pull** — `scripts/meta-insights.js`, run by
   `.github/workflows/meta-insights.yml` every night at 11:30 PM Philippine
   Time. Writes per-campaign spend/impressions/clicks/leads into the
   `ad_insights` Firestore collection, which Marketing → Insights reads.

**This repo is PUBLIC.** Nothing below is a secret VALUE — every command is
shown with a `<placeholder>`. Never paste a real token, app secret, or ad
account id into this file, a commit message, or any file the app serves.

---

## 1. Create the Meta app

1. Go to [developers.facebook.com](https://developers.facebook.com/) → **My Apps** → **Create App**.
2. Choose app type **Business**.
3. Add the **Facebook Login for Business** and **Marketing API** products (the
   second is what lets a System User token read `ads_read` insights).
4. Under **App Settings → Basic**, copy the **App Secret** — this becomes
   `META_APP_SECRET` (step 3 below). Do not paste it anywhere in this repo.

## 2. Create a System User + access token

Under the Meta **Business Settings** (business.facebook.com) for the Business
that owns the Barro Industries Page and ad account:

1. **Users → System Users → Add** — create a System User (e.g. "BI Ops
   Integration"), role **Admin** is easiest but **Employee** is enough if you
   assign the specific Page/ad account below.
2. **Assign Assets** — give the System User access to:
   - the Barro Industries **Page** (the one running Lead Ads)
   - the **ad account** whose spend you want in Insights
3. **Generate New Token** for the System User, with these scopes:
   - `leads_retrieval` — read submitted lead field data (webhook path)
   - `pages_show_list`, `pages_read_engagement` — required to act on the Page
   - `ads_read` — required for the nightly insights pull
4. Set the token to **never expire** (System User tokens can be long-lived) —
   a token that silently expires is a nightly-workflow failure, not a fast-fail.
5. Copy this token once — it becomes **both** `META_PAGE_TOKEN` (function
   secret, step 3) **and** `META_SYSTEM_TOKEN` (GitHub secret, step 5). Same
   token, two different places it needs to live, because the Cloud Function
   and the GitHub Action are two separate runtimes.

## 3. Set the three Cloud Function secrets

The webhook (`metaLeadWebhook`) reads three secrets via Firebase Secret
Manager — never from a committed file. From the repo root, with the Firebase
CLI signed in to the `barro-industries` project (`firebase login` if needed):

```sh
firebase functions:secrets:set META_APP_SECRET
# paste the App Secret from step 1 when prompted

firebase functions:secrets:set META_PAGE_TOKEN
# paste the System User token from step 2 when prompted

firebase functions:secrets:set META_VERIFY_TOKEN
# paste ANY string you make up here — see step 4, this one you invent yourself
```

Each command prompts for the value interactively (or accepts it piped in) —
it is never typed on the command line where shell history would keep it.

Then deploy the function so it picks up the secrets:

```sh
cd functions && npm run deploy
```

## 4. The verify token — generate it, don't write it down here

`META_VERIFY_TOKEN` (set above) is an arbitrary string ONLY Meta and this
function need to agree on, to prove the webhook callback URL you register in
step 6 is actually under our control. Generate one yourself, e.g.:

```sh
openssl rand -hex 24
```

Use that value for `firebase functions:secrets:set META_VERIFY_TOKEN` above,
and keep a copy somewhere private (a password manager, not this repo, not a
commit, not a code comment) — you'll paste the same value into the Meta App
Dashboard's webhook subscription screen in step 6.

## 5. Set the two GitHub Action secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Value |
|---|---|
| `META_SYSTEM_TOKEN` | The same System User token from step 2 |
| `META_AD_ACCOUNT_ID` | The ad account id (with or without the `act_` prefix — the script accepts either), from Business Settings → Accounts → Ad Accounts |

Until both of these exist, `.github/workflows/meta-insights.yml` runs every
night and exits green with a "Meta secrets not configured — skipping" log
line — it will not fail the workflow, it just won't do anything yet.

## 6. Subscribe the Page to Lead Ads webhooks

1. In the Meta App Dashboard → **Webhooks** → **Page** → **Subscribe to this object**.
2. **Callback URL:**
   ```
   https://asia-east1-barro-industries.cloudfunctions.net/metaLeadWebhook
   ```
3. **Verify Token:** paste the exact value you generated in step 4.
4. Meta will immediately send a GET request to the callback URL to confirm
   it — the function answers this automatically once deployed (step 3).
5. Subscribe the **`leadgen`** field.
6. Under **Page Subscriptions**, subscribe the actual Barro Industries Page to
   the app (a Business-level webhook subscription doesn't cover a specific
   Page's Lead Ads on its own).

## 7. Link an app campaign to its Meta campaign

In the app, **Marketing → Campaigns**, open (or create) the campaign that
corresponds to a Facebook ad campaign and fill in its **"Meta campaign ID"**
field (the numeric id from Meta Ads Manager, e.g. from the campaign's URL or
the Campaigns column). This is what lets:
- an incoming Lead Ads webhook lead attribute back to the right app campaign
  (`campaigns.metaCampaignId` lookup in `metaLeadWebhook`), and
- the nightly insights pull's per-campaign spend show up on that campaign's
  row in Marketing → Insights.

A campaign with no Meta campaign ID still works exactly as before — the Meta
integration is additive, never required.

## 8. Test before going live

**Webhook (Lead Ads):**
1. Meta's [Lead Ads Testing Tool](https://developers.facebook.com/tools/lead-ads-testing)
   (in the App Dashboard, or search "Lead Ads Testing" in Meta for Developers)
   lets you submit a fake lead against a real Lead Ads form without spending
   any ad budget.
2. Submit a test lead, then check:
   - `clients` collection — a new lead doc appeared (or an existing one by
     name got updated) with `source: 'FB'`, `leadOrigin: 'marketing'`.
   - Sales department members got a "📥 New Facebook lead" notification.
   - `meta_leads/{leadgenId}` shows `status: 'done'`.
3. If something goes wrong, `meta_leads/{leadgenId}` will show `status:
   'processing'` and never advance to `'done'` — that means the entry failed
   and its claim was rolled back for Meta's automatic retry. Check the Cloud
   Functions logs (Firebase Console → Functions → metaLeadWebhook → Logs) for
   the `[metaLeadWebhook]` error line (URLs and tokens are never logged).

**Nightly insights pull:**
1. Once both GitHub secrets are set (step 5), go to the repo's **Actions**
   tab → **Meta Ads Nightly Insights** → **Run workflow** to trigger it by
   hand instead of waiting for 11:30 PM.
2. Check the run log for `[meta-insights] Done. N row(s) upserted across M
   campaign(s)...` and confirm new documents appeared in the `ad_insights`
   Firestore collection.
3. Open Marketing → Insights in the app — campaigns with a Meta campaign ID
   set (step 7) should now show a real **Ad Spend** figure instead of `—`.
