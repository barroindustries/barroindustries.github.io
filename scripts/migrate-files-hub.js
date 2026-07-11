/**
 * BARRO INDUSTRIES — Files Hub migration (v12 WS38)
 * scripts/migrate-files-hub.js
 *
 * One-time (but safe-to-re-run) migration of the 12+ legacy `files_<scope>`
 * collections into the new unified `hub_files` / `hub_folders` collections
 * (see fable-workplan/38-files-hub.md, Spec 8). Admin SDK only — clients
 * cannot enumerate collections (db.listCollections() is Admin-SDK-only),
 * which is exactly why this can't be a client-side migration.
 *
 * IDEMPOTENT: every migrated doc gets a deterministic id —
 *   hub_files   doc id = `${legacyCollectionName}__${legacyDocId}`
 *   hub_folders doc id = `${scope}__${slug(folderName)}`
 * — written with { merge:true }, so re-running this script never creates
 * duplicates. Safe to run any time, including while the app is live.
 *
 * NEVER deletes or edits the legacy files_<scope> docs — they stay a frozen,
 * read-only archive forever (still readable via the files_.* wildcard rule
 * in firestore.rules, still nightly-mirrored to Drive by sync-to-drive.js,
 * still covered by monthly-backup.js's generic db.listCollections()
 * discovery). budgets_<dept> collections are structurally excluded — they
 * don't match the /^files_/ prefix this script looks for.
 *
 * Required env (same as scripts/sync-to-drive.js):
 *   FIREBASE_SERVICE_ACCOUNT — Firebase Admin SDK JSON (stringified)
 *
 * Run locally:
 *   FIREBASE_SERVICE_ACCOUNT='<service-account-json>' node scripts/migrate-files-hub.js
 *   (or: npm run migrate-files-hub, from scripts/, with the env var exported)
 *
 * Per the DECIDED spec's rollout checklist (Spec 10), run this ONCE right
 * after the hub_files/hub_folders firestore.rules deploy (step 4), and ONCE
 * MORE after the JS ship deploys (step 6) — the second pass sweeps any
 * files_<scope> uploads that landed in the legacy collections during the
 * deploy window.
 *
 * This script is NOT executed automatically by any CI workflow — it is a
 * manual, one-off (x2) migration step run locally by a human with the
 * service-account credential.
 */

'use strict';

const admin = require('firebase-admin');
const { requireEnv } = require('./drive-lib');

// ── Init Firebase (Firestore only — no Storage/Drive access needed) ────────
const serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Helpers ──────────────────────────────────────────────────────────────
function slug(s) {
  return String(s || 'General').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'general';
}
function toIso(ts) {
  if (!ts) return new Date().toISOString();
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  try { return new Date(ts).toISOString(); } catch (_) { return new Date().toISOString(); }
}

// ── Migrate one legacy files_<scope> collection ─────────────────────────
async function migrateCollection(collName) {
  const scope = collName.replace(/^files_/, '');
  const snap = await db.collection(collName).get();
  let folders = 0, files = 0, skipped = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const department = d.department || 'General';
    const uploadedBy = d.uploadedBy || null;
    const uploaderName = d.uploaderName || d.uploadedByName || uploadedBy || 'Unknown';

    // (a) Folder-marker docs (the retired "📁 New Folder" sentinel pattern,
    //     departments.js's old isFolderMarker docs) → ensure a hub_folders doc.
    if (d.isFolderMarker) {
      const folderName = d.folder || 'General';
      const folderId = `${scope}__${slug(folderName)}`;
      await db.collection('hub_folders').doc(folderId).set({
        name: folderName,
        parentId: null,
        scope,
        department,
        createdBy: uploadedBy,
        createdByName: uploaderName,
        createdAt: d.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      folders++;
      continue;
    }

    // hub_files' create rule requires uploadedBy — a legacy doc missing it
    // (shouldn't happen per the old files_.* create rule, but be defensive)
    // is skipped rather than crashing the whole run.
    if (!uploadedBy) { skipped++; continue; }

    // (b) Real file/link docs → hub_files, mapped to the Spec-1 shape.
    const url = d.url || '';
    const name = d.name || (url ? url.split('/').pop() : 'File');
    const kind = (d.kind === 'link' || d.source === 'link') ? 'link' : 'file';
    const folderId = d.folder ? `${scope}__${slug(d.folder)}` : null;
    const createdIso = toIso(d.createdAt);

    await db.collection('hub_files').doc(`${collName}__${doc.id}`).set({
      name,
      description: d.description || '',
      fileType: d.fileType || 'Other',
      kind,
      scope,
      department,
      folderId,
      url,
      driveUrl: d.driveUrl || null,
      size: null, contentType: null,          // legacy docs never recorded these
      source: d.source || (kind === 'link' ? 'link' : 'firebase'),
      currentV: 1,
      versions: [{
        v: 1, url, name, size: null, contentType: null, note: 'migrated',
        by: uploadedBy, byName: uploaderName, at: createdIso,
      }],
      archived: !!d.archived,
      deleted: false, deletedAt: null, deletedBy: null,
      visibility: 'company',
      sharedUserIds: [], editorUserIds: [], shares: [],
      uploadedBy, uploaderName,
      legacyColl: collName, legacyId: doc.id,
      createdAt: d.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    files++;
  }

  return { collName, folders, files, skipped, total: snap.size };
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('── Files Hub migration (v12 WS38) ──');
  const cols = await db.listCollections();
  const targets = cols.map(c => c.id).filter(id => /^files_/.test(id));

  if (!targets.length) {
    console.log('No files_<scope> collections found. Nothing to migrate.');
    return;
  }
  console.log(`Found ${targets.length} legacy collection(s): ${targets.join(', ')}`);

  const results = [];
  for (const collName of targets) {
    const r = await migrateCollection(collName);
    results.push(r);
    console.log(`  ${collName}: ${r.files} file(s), ${r.folders} folder(s), ${r.skipped} skipped (of ${r.total} docs)`);
  }

  const totals = results.reduce((acc, r) => ({
    files: acc.files + r.files,
    folders: acc.folders + r.folders,
    skipped: acc.skipped + r.skipped,
  }), { files: 0, folders: 0, skipped: 0 });

  console.log('── Done ──');
  console.log(`Total: ${totals.files} file(s) migrated, ${totals.folders} folder(s) migrated, ${totals.skipped} skipped.`);
  console.log('Legacy files_<scope> collections were NOT modified (frozen, read-only archive — still mirrored + backed up).');
  console.log('Re-run this script any time (idempotent, deterministic doc ids) — e.g. once more after the JS deploy propagates.');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
