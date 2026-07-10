/**
 * BARRO INDUSTRIES — Restore Firestore from a monthly Drive backup
 * scripts/restore-from-backup.js
 *
 * DISPATCH-ONLY. Dry-run by default — writes NOTHING unless RESTORE_COMMIT=1.
 * Reads BI-Operations/Monthly Backups/<month>/_manifest.json to learn which
 * JSON file maps to which collection (no hand-maintained list → no drift),
 * downloads the JSON, and batch-writes each doc back with merge:true.
 *
 * Inputs (env):
 *   RESTORE_MONTH       required, e.g. 2026-06
 *   RESTORE_COLLECTION  optional; restore only this collection (else all)
 *   RESTORE_COMMIT      '1' to actually write; anything else = dry run
 * Secrets: same as monthly-backup (FIREBASE_SERVICE_ACCOUNT, DRIVE_FOLDER_ID,
 *   FIREBASE_STORAGE_BUCKET, GOOGLE_OAUTH_*).
 */
'use strict';

const admin = require('firebase-admin');
const fetch = require('node-fetch');
const { requireEnv, initDrive, preflight, SHARED_LIST } = require('./drive-lib');

const serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'));
admin.initializeApp({
  credential:    admin.credential.cert(serviceAccount),
  storageBucket: requireEnv('FIREBASE_STORAGE_BUCKET'),
});
const db = admin.firestore();

const { drive, authMode, ownerLabel } = initDrive();
const ROOT_FOLDER_ID = requireEnv('DRIVE_FOLDER_ID');
const MONTH   = requireEnv('RESTORE_MONTH');
const ONLY    = (process.env.RESTORE_COLLECTION || '').trim();
const COMMIT  = (process.env.RESTORE_COMMIT || '').trim() === '1';

if (!/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error(`\n❌ RESTORE_MONTH must look like 2026-06 (got "${MONTH}").`);
  process.exit(2);
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function revive(v) {
  if (typeof v === 'string' && ISO.test(v)) return admin.firestore.Timestamp.fromDate(new Date(v));
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = revive(x); return o; }
  return v;
}

async function findFolder(name, parentId) {
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id,name)', ...SHARED_LIST,
  });
  return res.data.files[0] || null;
}
async function listJson(folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and mimeType='application/json'`,
    fields: 'files(id,name)', pageSize: 1000, ...SHARED_LIST,
  });
  return res.data.files || [];
}
async function download(fileId) {
  const res = await drive.files.get({ fileId, alt: 'media', ...SHARED_LIST }, { responseType: 'text' });
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

async function restoreCollection(name, docs) {
  // _counters: never blind-overwrite a sequence — bump to max(current, restored).
  if (name === '_counters') {
    for (const d of docs) {
      const id = d.id; const restored = Number(d.count) || 0;
      const cur = await db.collection('_counters').doc(id).get();
      const current = cur.exists ? (Number(cur.data().count) || 0) : 0;
      const next = Math.max(current, restored);
      console.log(`   _counters/${id}: current=${current} restored=${restored} → ${next}`);
      if (COMMIT) await db.collection('_counters').doc(id).set({ count: next }, { merge: true });
    }
    return docs.length;
  }
  let batch = db.batch(), n = 0, written = 0;
  for (const d of docs) {
    const { id, ...rest } = d;
    if (COMMIT) { batch.set(db.collection(name).doc(id), revive(rest), { merge: true }); n++; }
    written++;
    if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (COMMIT && n) await batch.commit();
  return written;
}

async function main() {
  console.log(`\n♻️  Barro Industries — Restore from backup`);
  console.log(`   Month     : ${MONTH}`);
  console.log(`   Collection: ${ONLY || '(ALL)'}`);
  console.log(`   Mode      : ${COMMIT ? '🔴 COMMIT (writes Firestore)' : '🟢 DRY RUN (no writes)'}`);
  await preflight(drive, ROOT_FOLDER_ID, authMode, ownerLabel);

  const backups = await findFolder('Monthly Backups', ROOT_FOLDER_ID);
  if (!backups) { console.error(`\n❌ No "Monthly Backups" folder under DRIVE_FOLDER_ID.`); process.exit(2); }
  const monthFolder = await findFolder(MONTH, backups.id);
  if (!monthFolder) { console.error(`\n❌ No backup folder "${MONTH}".`); process.exit(2); }

  const files = await listJson(monthFolder.id);
  const manifestFile = files.find(f => f.name === '_manifest.json');
  let map; // filename(no .json) → collection
  if (manifestFile) {
    map = {};
    for (const m of JSON.parse(await download(manifestFile.id))) map[m.filename] = m.collection;
  } else {
    console.warn(`   ⚠️  no _manifest.json (pre-manifest backup) — assuming filename === collection`);
    map = null;
  }

  let total = 0, cols = 0;
  for (const f of files) {
    if (f.name === '_manifest.json' || f.name === 'task_messages.json') continue; // subcollection: manual
    const basename = f.name.replace(/\.json$/, '');
    const collection = map ? (map[basename] || basename) : basename;
    if (collection.includes('/')) continue;         // subcollection entries — skip
    if (ONLY && collection !== ONLY) continue;
    if (collection === 'attendance') { console.log(`\n⏭️  attendance (subcollection) — restore manually`); continue; }
    const docs = JSON.parse(await download(f.id));
    console.log(`\n📄 ${collection}: ${docs.length} docs`);
    const written = await restoreCollection(collection, docs);
    total += written; cols++;
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${COMMIT ? '✅ Restore complete' : '✅ Dry run complete (nothing written)'}`);
  console.log(`   Collections: ${cols}   Docs: ${total}`);
  console.log(`${'─'.repeat(50)}\n`);
  process.exit(0);
}
main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
