/**
 * BARRO INDUSTRIES — Daily Ops Digest
 * scripts/daily-digest.js
 *
 * v12 WS40 Spec 7b. Runs via GitHub Actions every day at 08:00 Asia/Manila
 * (.github/workflows/daily-digest.yml, cron '0 0 * * *' UTC — PH has no DST).
 *
 * Writes ONE notification doc per recipient into notifications/{uid}/items,
 * reusing the SAME cross-user "send" mechanism the client app already uses
 * (js/notifications.js Notifs.send / checkLowStock). The existing
 * sendPushOnNotification Cloud Function fires on that new doc and delivers
 * the FCM push — zero functions/ changes, zero Blaze billing requirement.
 * This is deliberately NOT a Firebase Scheduled Function (v12 WS40 decision 13):
 * every other automation in this repo (Drive sync, monthly backup) already runs
 * on GitHub Actions' free minutes, and writing the notification doc directly
 * IS the push — there is nothing an onSchedule function would do that this
 * script cannot.
 *
 * Recipients: president + finance roles ONLY (decision 15) — AR/collections/cash
 * content is the sensitive tier, matching WS36's canFinance()-only registry read.
 * Managers/secretary see the same conclusions live in Analytics; they do not get
 * the morning push. No email dependency (zero nodemailer/SendGrid precedent in
 * functions/package.json — correctly stays out).
 *
 * Idempotency: deterministic doc id digest_{YYYY-MM-DD} PLUS a script-side
 * exists-check skip, so a re-run/retry (incl. a manual workflow_dispatch on the
 * same day) can never double-send.
 *
 * Digest copy is COARSE by design (MTD totals + counts only) — no per-insight
 * sentences server-side in v1; those live client-side where the full metrics
 * bag (window.Insights / M, config.js) exists. All reads below are date-range-
 * bounded (WS39 discipline) — no .limit(N) collection-wide scans.
 *
 * Required GitHub Secret: FIREBASE_SERVICE_ACCOUNT (already used by sync/backup).
 */

'use strict';

const admin = require('firebase-admin');
const { requireEnv } = require('./drive-lib');

// ── Init Firebase (Firestore only — no Storage bucket needed for this script) ──
const serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ── Manila 'today' (no DST) — server-side equivalent of window.bizDate() ──
const today      = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const monthStart = today.slice(0, 8) + '01';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── 1. MTD net cash flow — classify exactly like window.ledgerKind (config.js) ──
async function getMtdCashFlow() {
  const snap = await db.collection('ledger')
    .where('date', '>=', monthStart).where('date', '<=', today).get();
  let inFlow = 0, outFlow = 0;
  snap.docs.forEach(d => {
    const r = d.data();
    const amt = +(r.amount || 0);
    // Mirrors window.ledgerKind(config.js:863-870), legacy-category map omitted:
    // MTD rows post-date WS13 and always carry accountType.
    if (r.accountType === 'income') { inFlow += amt; return; }
    if (r.accountType === 'expense') { outFlow += amt; return; }
    if (r.accountType === 'asset' || r.accountType === 'liability') return;   // WS13 leg exclusion
    if (r.type === 'credit') inFlow += amt; else outFlow += amt;
  });
  return { inFlow, outFlow, net: inFlow - outFlow };
}

// ── 2. Receivables (stored arBalance kept in sync — departments.js:12297) ──
async function getAr() {
  const snap = await db.collection('job_projects').where('arBalance', '>', 0).get();
  return { arTotal: snap.docs.reduce((s, d) => s + (+(d.data().arBalance) || 0), 0), count: snap.size };
}

// ── 3. MTD quote outcomes across all three quote collections ──
// MUST match window.isQuoteWon/isQuoteLost (config.js — 32-sales-crm.md Spec 2a):
// won = salesOrderId || status==='won' || status==='accepted'; lost = status==='rejected'.
async function getMtdQuoteOutcomes() {
  const monthStartTs = admin.firestore.Timestamp.fromDate(new Date(monthStart + 'T00:00:00+08:00'));
  const [bk, bs, legacy] = await Promise.all(
    ['bk_quotes', 'bs_quotes', 'quotes'].map(coll =>
      db.collection(coll).where('createdAt', '>=', monthStartTs).get().catch(() => ({ docs: [] })))
  );
  const all = [...bk.docs, ...bs.docs, ...legacy.docs].map(d => d.data());
  let won = 0, lost = 0;
  all.forEach(q => {
    if (q.salesOrderId || q.status === 'won' || q.status === 'accepted') won++;
    else if (q.status === 'rejected') lost++;
  });
  return { won, lost };
}

// ── 4. Recipients — president + finance only (decision 15) ──
async function getRecipients() {
  const [pres, fin] = await Promise.all([
    db.collection('users').where('role', '==', 'president').get(),
    db.collection('users').where('role', '==', 'finance').get(),
  ]);
  const seen = new Set();
  return [...pres.docs, ...fin.docs]
    .filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; })
    .map(d => d.id);
}

// ── 5. Idempotent write — deterministic doc id + exists-check (decision 13/15) ──
async function writeDigest(uid, body) {
  const ref = db.collection('notifications').doc(uid).collection('items').doc(`digest_${today}`);
  const existing = await ref.get();
  if (existing.exists) { console.log(`[digest] ${uid}: already sent for ${today}, skipping`); return false; }
  await ref.set({
    title: `📊 Daily Ops Digest — ${today}`,
    body,
    icon: '📊',
    type: 'daily_digest',
    dedupKey: `digest-${uid}-${today}`,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log(`[digest] ${uid}: sent`);
  return true;
}

async function main() {
  console.log(`[digest] Running for ${today} (Manila) — MTD window ${monthStart}..${today}`);
  const [cash, ar, quotes, recipients] = await Promise.all([
    getMtdCashFlow(), getAr(), getMtdQuoteOutcomes(), getRecipients(),
  ]);

  const body = `MTD: ₱${fmt(cash.inFlow)} in / ₱${fmt(cash.outFlow)} out (net ₱${fmt(cash.net)}). `
    + `Receivables: ₱${fmt(ar.arTotal)} across ${ar.count} project${ar.count === 1 ? '' : 's'}. `
    + `Quotes MTD: ${quotes.won}W/${quotes.lost}L.`;

  if (!recipients.length) { console.warn('[digest] No president/finance recipients found — nothing to send.'); return; }

  let sent = 0;
  for (const uid of recipients) {
    if (await writeDigest(uid, body)) sent++;
  }
  console.log(`[digest] Done. ${sent}/${recipients.length} sent (rest already had today's digest).`);

  // v13 Phase 90b: success heartbeat so the in-app System Health page can show
  // this job as healthy/stale (the workflow's if:failure step writes the error
  // marker to the same doc id).
  try {
    await db.collection('system_health').doc('daily_digest').set({
      job: 'daily_digest', lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      lastStatus: 'ok', errors: 0, sent, recipients: recipients.length,
    }, { merge: true });
  } catch (e) { console.warn(`[digest] system_health write: ${e.message}`); }
}

main().catch(err => {
  console.error('[digest] FAILED:', err);
  process.exit(1);
});
