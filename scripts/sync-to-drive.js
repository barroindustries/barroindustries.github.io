/**
 * BARRO INDUSTRIES — Firebase Storage → Google Drive Nightly Sync
 * scripts/sync-to-drive.js
 *
 * Runs via GitHub Actions every day at 12:00 AM (midnight).
 *
 * What it does:
 *   1. Scans Firestore collections for files with Firebase Storage URLs
 *   2. Downloads each file from Firebase Storage
 *   3. Uploads it to Google Drive (BI-Operations folder, organized by dept)
 *   4. Updates the Firestore document with driveUrl → Drive link
 *
 * Required GitHub Secrets:
 *   FIREBASE_SERVICE_ACCOUNT  — Firebase Admin SDK JSON key (stringified)
 *   GOOGLE_SERVICE_ACCOUNT    — Google Drive service account JSON key (stringified)
 *   DRIVE_FOLDER_ID           — Google Drive folder ID for BI-Operations
 *   FIREBASE_PROJECT_ID       — e.g. barro-industries
 *   FIREBASE_STORAGE_BUCKET   — e.g. barro-industries.appspot.com
 */

const admin       = require('firebase-admin');
const { google }  = require('googleapis');
const { Readable } = require('stream');
const fetch       = require('node-fetch');

// ── Init Firebase ──────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential:    admin.credential.cert(serviceAccount),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const db      = admin.firestore();
const bucket  = admin.storage().bucket();

// ── Init Google Drive ──────────────────────────────────
const driveAuth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/drive'],
});
const drive = google.drive({ version: 'v3', auth: driveAuth });

const ROOT_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

// ── Collections to sync and their file URL fields ─────
// Format: { collection, fileFields: [array of dot-paths to file objects] }
const COLLECTIONS = [
  { name: 'resources',    fileField: null,           docField: true  }, // whole doc is a file
  { name: 'memos',        fileField: 'attachment',   docField: false },
  { name: 'tasks',        fileField: 'attachments',  docField: false, isArray: true },
  { name: 'submissions',  fileField: 'attachments',  docField: false, isArray: true },
  { name: 'quotes',       fileField: 'attachments',  docField: false, isArray: true },
];

// ── Ensure a folder exists in Drive ───────────────────
async function ensureDriveFolder(name, parentId) {
  const res = await drive.files.list({
    q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id)',
  });
  if (res.data.files.length > 0) return res.data.files[0].id;

  const folder = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return folder.data.id;
}

// ── Make a Drive file publicly viewable ───────────────
async function makePublic(fileId) {
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });
}

// ── Upload a file buffer to Google Drive ──────────────
async function uploadToDrive(buffer, filename, mimeType, dept, subfolder) {
  const deptFolderId = await ensureDriveFolder(dept || 'General', ROOT_FOLDER_ID);
  const targetId     = subfolder
    ? await ensureDriveFolder(subfolder, deptFolderId)
    : deptFolderId;

  const stream = Readable.from(buffer);
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [targetId] },
    media:       { mimeType: mimeType || 'application/octet-stream', body: stream },
    fields:      'id,webViewLink',
  });

  await makePublic(res.data.id);
  return res.data.webViewLink;
}

// ── Download from Firebase Storage URL ────────────────
async function downloadFromFirebase(firebaseUrl) {
  const res = await fetch(firebaseUrl);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  const buffer = await res.buffer();
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return { buffer, contentType };
}

// ── Check if URL is a Firebase Storage URL ────────────
function isFirebaseUrl(url) {
  return url && url.includes('firebasestorage.googleapis.com');
}

// ── Sync a single file object ─────────────────────────
async function syncFile(fileObj, dept) {
  if (!fileObj?.url || !isFirebaseUrl(fileObj.url) || fileObj.driveUrl) {
    return null; // already synced or not a Firebase URL
  }

  console.log(`  Syncing: ${fileObj.name || fileObj.url}`);
  const { buffer, contentType } = await downloadFromFirebase(fileObj.url);
  const driveUrl = await uploadToDrive(
    buffer,
    fileObj.name || 'file',
    contentType,
    dept || fileObj.folder?.split('/')[0] || 'General',
    fileObj.folder?.split('/')[1] || null
  );

  console.log(`  → Drive: ${driveUrl}`);
  return driveUrl;
}

// ── Main sync ──────────────────────────────────────────
async function main() {
  let synced = 0;
  let errors = 0;

  for (const col of COLLECTIONS) {
    console.log(`\n📁 Scanning collection: ${col.name}`);
    const snapshot = await db.collection(col.name).get();

    for (const doc of snapshot.docs) {
      const data = doc.data();

      try {
        // Case 1: whole document is a file record (resources)
        if (col.docField && isFirebaseUrl(data.url) && !data.driveUrl) {
          const driveUrl = await syncFile(data, data.folder?.split('/')[0]);
          if (driveUrl) {
            await doc.ref.update({ driveUrl, url: driveUrl, source: 'gdrive' });
            synced++;
          }
        }

        // Case 2: single attachment field (memos)
        else if (col.fileField && !col.isArray && data[col.fileField]) {
          const fileObj = data[col.fileField];
          if (isFirebaseUrl(fileObj.url) && !fileObj.driveUrl) {
            const driveUrl = await syncFile(fileObj, data.dept || 'General');
            if (driveUrl) {
              await doc.ref.update({
                [col.fileField]: { ...fileObj, driveUrl, url: driveUrl, source: 'gdrive' }
              });
              synced++;
            }
          }
        }

        // Case 3: array of attachments (tasks, submissions, quotes)
        else if (col.fileField && col.isArray && Array.isArray(data[col.fileField])) {
          const updated = [...data[col.fileField]];
          let changed = false;
          for (let i = 0; i < updated.length; i++) {
            const fileObj = updated[i];
            if (isFirebaseUrl(fileObj.url) && !fileObj.driveUrl) {
              const driveUrl = await syncFile(fileObj, data.dept || 'General');
              if (driveUrl) {
                updated[i] = { ...fileObj, driveUrl, url: driveUrl, source: 'gdrive' };
                changed = true;
                synced++;
              }
            }
          }
          if (changed) await doc.ref.update({ [col.fileField]: updated });
        }

      } catch (err) {
        console.error(`  ❌ Error on ${col.name}/${doc.id}:`, err.message);
        errors++;
      }
    }
  }

  console.log(`\n✅ Sync complete. Synced: ${synced} files. Errors: ${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
