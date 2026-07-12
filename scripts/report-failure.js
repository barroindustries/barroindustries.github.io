'use strict';

/**
 * scripts/report-failure.js — Phase 90 item 2 (V13-PLAN).
 *
 * Writes a failure heartbeat to system_health/{jobId} when a scheduled
 * GitHub Actions workflow's main step exits non-zero. Normally the job
 * scripts (sync-to-drive.js, monthly-backup.js) write their own
 * system_health/{job} doc on completion via their internal reportHealth()
 * helper — but that write never happens if the process crashes/exits before
 * reaching it (e.g. a thrown error, an npm install failure upstream, or the
 * step timing out). This script is invoked from a separate `if: failure()`
 * workflow step so the failure itself becomes visible on the in-app System
 * Health page (js/app.js renderSystemHealth / SYSTEM_HEALTH_JOBS) instead of
 * just going stale silently.
 *
 * Usage:  node report-failure.js <jobId>
 * Required GitHub Secret: FIREBASE_SERVICE_ACCOUNT (same as the job scripts).
 *
 * Mirrors the firebase-admin init pattern from sync-to-drive.js /
 * monthly-backup.js / daily-digest.js exactly (JSON.parse'd service-account
 * env var → admin.credential.cert).
 */

const admin = require('firebase-admin');
const { requireEnv } = require('./drive-lib');

const jobId = process.argv[2];
if (!jobId) {
  console.error('❌ Usage: node report-failure.js <jobId>');
  process.exit(2);
}

const serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  await db.collection('system_health').doc(jobId).set({
    job: jobId,
    lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    lastStatus: 'error',
    errors: 1,
    label: 'workflow failed — see Actions log',
  }, { merge: true });
  console.log(`🫀 system_health/${jobId} marked error (workflow failure step)`);
}

main().catch((e) => {
  // Never let the failure-reporter itself fail the (already-red) job harder
  // than necessary, but do surface it loudly in the Actions log.
  console.error(`❌ report-failure.js could not write system_health/${jobId}: ${e.message}`);
  process.exit(1);
});
