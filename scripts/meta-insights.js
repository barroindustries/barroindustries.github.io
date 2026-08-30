/**
 * BARRO INDUSTRIES — Meta (Facebook) Ads nightly insights pull
 * scripts/meta-insights.js
 *
 * specs/META-ADS-SPEC-2026-08-30.md, Builder A section A3. Runs via GitHub
 * Actions every night at 23:30 Asia/Manila (.github/workflows/meta-insights.yml,
 * cron '30 15 * * *' UTC — PH has no DST), same free-Actions-minutes precedent
 * as scripts/daily-digest.js / sync-to-drive.js / monthly-backup.js.
 *
 * Pulls the last 7 days of per-campaign Meta ad spend/impressions/clicks/leads
 * (self-heals a missed night — each day is re-upserted, not appended) and
 * writes it into the server-only `ad_insights` collection, which Marketing →
 * Insights (js/departments.js renderMktInsights) reads to show real Facebook
 * ad spend alongside the CRM's own pipeline numbers.
 *
 * REPO IS PUBLIC — no token, secret, app id, or ad-account id is ever
 * committed, logged, or embedded in a logged URL. Required secrets:
 *   FIREBASE_SERVICE_ACCOUNT — same service account every other scripts/*.js
 *                              job already uses (Firestore writes).
 *   META_SYSTEM_TOKEN        — a Meta System User access token scoped to
 *                              ads_read on the ad account below.
 *   META_AD_ACCOUNT_ID       — the numeric ad account id (with or without
 *                              the "act_" prefix — both are accepted).
 *
 * Until Neil sets the two META_* secrets, this script exits 0 (green workflow,
 * no-op) rather than failing — see the check immediately below, which runs
 * BEFORE FIREBASE_SERVICE_ACCOUNT is required so the skip needs no other env.
 */

'use strict';

const metaToken       = (process.env.META_SYSTEM_TOKEN || '').trim();
const metaAdAccountId = (process.env.META_AD_ACCOUNT_ID || '').trim();
if (!metaToken || !metaAdAccountId) {
  console.log('[meta-insights] Meta secrets not configured — skipping.');
  process.exit(0);
}

const admin = require('firebase-admin');
const { requireEnv } = require('./drive-lib');

// ── Init Firebase (Firestore only — no Storage bucket needed for this script) ──
const serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const GRAPH_VER = 'v22.0';
const actId = metaAdAccountId.startsWith('act_') ? metaAdAccountId : 'act_' + metaAdAccountId;

// ── Manila 'today' (no DST) — server-side equivalent of window.bizDate() ──
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const since = new Date(Date.now() + 8 * 3600 * 1000 - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

// First match wins — 'lead' / 'leadgen_grouped' / 'onsite_conversion.lead_grouped'
// overlap in Meta's actions taxonomy and must never be summed together.
const LEAD_ACTION_PRIORITY = ['lead', 'leadgen_grouped', 'onsite_conversion.lead_grouped'];

function leadsFromActions(actions) {
  if (!Array.isArray(actions)) return 0;
  for (const type of LEAD_ACTION_PRIORITY) {
    const hit = actions.find((a) => a && a.action_type === type);
    if (hit) return parseInt(hit.value, 10) || 0;
  }
  return 0;
}

/** GET a Graph API URL. Never logs the URL itself — every request here carries
 *  the access token as a query param — only the path and HTTP status. */
async function graphGet(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    const path = url.split('?')[0];
    console.error(`[meta-insights] Graph API request failed — ${path} -> HTTP ${resp.status}`);
    throw new Error(`Graph API HTTP ${resp.status} on ${path}`);
  }
  return resp.json();
}

async function fetchCurrency() {
  const url = `https://graph.facebook.com/${GRAPH_VER}/${actId}?fields=currency&access_token=${metaToken}`;
  const data = await graphGet(url);
  return data.currency || '';
}

/** level=campaign, daily breakdown, last 7 days — follows paging.next until absent. */
async function fetchInsights() {
  const timeRange = encodeURIComponent(JSON.stringify({ since, until: today }));
  let url = `https://graph.facebook.com/${GRAPH_VER}/${actId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,actions&time_increment=1&time_range=${timeRange}&limit=500&access_token=${metaToken}`;
  const rows = [];
  while (url) {
    const page = await graphGet(url);
    if (Array.isArray(page.data)) rows.push(...page.data);
    url = (page.paging && page.paging.next) ? page.paging.next : null;
  }
  return rows;
}

/** Upsert ad_insights/{campaignId}_{dateStart} (merge — a re-run/self-heal
 *  overwrites that day's row instead of appending a duplicate). */
async function upsertRow(row, currency) {
  const campaignId = row.campaign_id != null ? String(row.campaign_id) : '';
  const dateStart = row.date_start || '';
  if (!campaignId || !dateStart) return false;
  await db.collection('ad_insights').doc(`${campaignId}_${dateStart}`).set({
    metaCampaignId: campaignId,
    campaignName: row.campaign_name || '',
    date: dateStart,
    spend: parseFloat(row.spend) || 0,
    impressions: parseInt(row.impressions, 10) || 0,
    clicks: parseInt(row.clicks, 10) || 0,
    leads: leadsFromActions(row.actions),
    currency,
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return true;
}

async function main() {
  console.log(`[meta-insights] Pulling campaign insights for ${since}..${today} (Manila, self-healing 7-day window)`);

  const currency = await fetchCurrency();
  const rows = await fetchInsights();

  const campaignIds = new Set();
  let written = 0;
  for (const row of rows) {
    if (await upsertRow(row, currency)) written++;
    if (row.campaign_id != null) campaignIds.add(String(row.campaign_id));
  }

  console.log(`[meta-insights] Done. ${written} row(s) upserted across ${campaignIds.size} campaign(s), ${since}..${today} (currency ${currency || 'unknown'}).`);
}

main().catch((err) => {
  console.error('[meta-insights] FAILED:', err.message);
  process.exit(1);
});
