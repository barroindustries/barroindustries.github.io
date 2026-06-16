/**
 * BARRO INDUSTRIES — Daily File Sync: Firebase Storage → Google Drive
 * scripts/sync-to-drive.js
 *
 * Runs via GitHub Actions every day at 12:00 AM Philippine Time (UTC+8).
 *
 * What it does:
 *   - Scans all Firestore collections for Firebase Storage file URLs
 *   - Downloads each new file and uploads it to Google Drive
 *   - Stores files in organized subfolders:
 *
 *   BI-Operations/
 *   └── Files/
 *       ├── Tasks/
 *       ├── Task Messages/
 *       ├── Posts/
 *       ├── Submissions/
 *       ├── Resources/
 *       ├── Memos/
 *       └── Quotes/
 *
 *   - Updates each Firestore doc with driveUrl so it won't re-sync
 *
 * Required GitHub Secrets:
 *   FIREBASE_SERVICE_ACCOUNT  — Firebase Admin SDK JSON (stringified)
 *   GOOGLE_SERVICE_ACCOUNT    — Google Drive service account JSON (stringified)
 *   DRIVE_FOLDER_ID           — Google Drive root folder ID (BI-Operations)
 *   FIREBASE_PROJECT_ID       — e.g. barro-industries
 *   FIREBASE_STORAGE_BUCKET   — e.g. barro-industries.firebasestorage.app
 */

'use strict';

const admin       = require('firebase-admin');
const { google }  = require('googleapis');
const { Readable } = require('stream');
const fetch       = require('node-fetch');

// ── Init Firebase ──────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential:    admin.credential.cert(serviceAccount),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const db     = admin.firestore();
const bucket = admin.storage().bucket();

// ── Init Google Drive ──────────────────────────────────────────────────────
const driveAuth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/drive'],
});
const drive = google.drive({ version: 'v3', auth: driveAuth });

const ROOT_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

// Cache folder IDs to avoid repeated Drive API lookups
const folderCache = {};

// ── Helpers ────────────────────────────────────────────────────────────────

async function ensureFolder(name, parentId) {
  const key = `${parentId}::${name}`;
  if (folderCache[key]) return folderCache[key];

  const res = await drive.files.list({
    q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id)',
  });
  if (res.data.files.length > 0) {
    folderCache[key] = res.data.files[0].id;
    return folderCache[key];
  }
  const folder = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  folderCache[key] = folder.data.id;
  return folderCache[key];
}

async function makePublic(fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  } catch (_) { /* non-fatal */ }
}

async function downloadFile(url) {
  const res = await fetch(url, { timeout: 30000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const buffer = await res.buffer();
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return { buffer, contentType };
}

function isFirebaseUrl(url) {
  return url && typeof url === 'string' && url.includes('firebasestorage.googleapis.com');
}

async function uploadFile(buffer, filename, mimeType, subfolderId) {
  const stream = Readable.from(buffer);
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [subfolderId] },
    media:       { mimeType: mimeType || 'application/octet-stream', body: stream },
    fields:      'id,webViewLink',
  });
  await makePublic(res.data.id);
  return res.data.webViewLink;
}

// ── Ensure top-level "Files" folder exists ─────────────────────────────────
let FILES_FOLDER_ID = null;
async function getFilesFolder() {
  if (!FILES_FOLDER_ID) {
    FILES_FOLDER_ID = await ensureFolder('Files', ROOT_FOLDER_ID);
  }
  return FILES_FOLDER_ID;
}

async function getFolderForCollection(collectionLabel) {
  const parent = await getFilesFolder();
  return ensureFolder(collectionLabel, parent);
}

// ── Sync a single file object ──────────────────────────────────────────────
async function syncFileObject(fileObj, collectionLabel, stats) {
  if (!fileObj || !isFirebaseUrl(fileObj.url) || fileObj.driveUrl) return null;

  const filename = fileObj.name || 'file';
  console.log(`    ↳ Syncing: ${filename}`);

  try {
    const { buffer, contentType } = await downloadFile(fileObj.url);
    const folderId = await getFolderForCollection(collectionLabel);
    const driveUrl = await uploadFile(buffer, filename, contentType, folderId);
    stats.synced++;
    console.log(`      ✓ ${driveUrl}`);
    return driveUrl;
  } catch (err) {
    console.error(`      ✗ Failed: ${err.message}`);
    stats.errors++;
    return null;
  }
}

// ── Collection definitions ─────────────────────────────────────────────────
//
//  type: 'doc'        — whole document is a file record (url field on root)
//  type: 'field'      — single file object at data[fileField]
//  type: 'array'      — array of file objects at data[fileField]
//  type: 'subcol'     — must scan subcollections (task-comments)

const COLLECTIONS = [
  {
    name:   'resources',
    label:  'Resources',
    type:   'doc',        // whole doc: has .url, .name fields
  },
  {
    name:      'memos',
    label:     'Memos',
    type:      'field',
    fileField: 'attachment',
  },
  {
    name:      'tasks',
    label:     'Tasks',
    type:      'array',
    fileField: 'attachments',
  },
  {
    name:      'submissions',
    label:     'Submissions',
    type:      'array',
    fileField: 'attachments',
  },
  {
    name:      'quotes',
    label:     'Quotes',
    type:      'array',
    fileField: 'attachments',
  },
  {
    name:      'posts',
    label:     'Posts',
    type:      'post',    // posts have imageUrl + fileUrl directly
  },
];

// ── Sync posts (imageUrl / fileUrl directly on doc) ────────────────────────
async function syncPostDoc(doc, stats) {
  const data    = doc.data();
  const updates = {};

  if (isFirebaseUrl(data.imageUrl) && !data.driveImageUrl) {
    const fObj = { url: data.imageUrl, name: `post-${doc.id}-image` };
    const driveUrl = await syncFileObject(fObj, 'Posts', stats);
    if (driveUrl) updates.driveImageUrl = driveUrl;
  }
  if (isFirebaseUrl(data.fileUrl) && !data.driveFileUrl) {
    const fObj = { url: data.fileUrl, name: data.fileName || `post-${doc.id}-file` };
    const driveUrl = await syncFileObject(fObj, 'Posts', stats);
    if (driveUrl) updates.driveFileUrl = driveUrl;
  }
  if (Object.keys(updates).length) await doc.ref.update(updates);
}

// ── Sync task-comments subcollection ──────────────────────────────────────
// Fetches all task subcollections in parallel instead of sequentially.
async function syncTaskComments(stats) {
  console.log('\n📁 Scanning subcollection: task-comments');
  const tasksSnap = await db.collection('tasks').get();
  console.log(`   ${tasksSnap.size} tasks to scan`);

  await Promise.all(tasksSnap.docs.map(async taskDoc => {
    const commentsSnap = await taskDoc.ref.collection('task-comments').get();
    await Promise.all(commentsSnap.docs.map(async commentDoc => {
      const data = commentDoc.data();
      if (isFirebaseUrl(data.fileUrl) && !data.driveFileUrl) {
        const fObj = { url: data.fileUrl, name: data.fileName || `comment-${commentDoc.id}` };
        const driveUrl = await syncFileObject(fObj, 'Task Messages', stats);
        if (driveUrl) await commentDoc.ref.update({ driveFileUrl: driveUrl });
      }
    }));
  }));
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const stats = { synced: 0, errors: 0, skipped: 0 };
  const startedAt = new Date().toISOString();
  console.log(`\n🚀 Barro Industries — Daily File Sync`);
  console.log(`   Started: ${startedAt}\n`);

  // Process top-level collections
  for (const col of COLLECTIONS) {
    console.log(`\n📁 Scanning: ${col.name}`);
    const snapshot = await db.collection(col.name).get();
    console.log(`   ${snapshot.size} documents`);

    for (const doc of snapshot.docs) {
      const data = doc.data();

      try {
        if (col.type === 'doc') {
          // Whole document is a file record
          if (isFirebaseUrl(data.url) && !data.driveUrl) {
            const fObj = { url: data.url, name: data.name || doc.id };
            const driveUrl = await syncFileObject(fObj, col.label, stats);
            if (driveUrl) await doc.ref.update({ driveUrl });
          } else stats.skipped++;

        } else if (col.type === 'field') {
          // Single file object field
          const fileObj = data[col.fileField];
          if (fileObj && isFirebaseUrl(fileObj.url) && !fileObj.driveUrl) {
            const driveUrl = await syncFileObject(fileObj, col.label, stats);
            if (driveUrl) {
              await doc.ref.update({ [col.fileField]: { ...fileObj, driveUrl } });
            }
          } else stats.skipped++;

        } else if (col.type === 'array') {
          // Array of file objects
          const arr = data[col.fileField];
          if (!Array.isArray(arr)) { stats.skipped++; continue; }
          const updated = [...arr];
          let changed = false;
          for (let i = 0; i < updated.length; i++) {
            const f = updated[i];
            if (isFirebaseUrl(f.url) && !f.driveUrl) {
              const driveUrl = await syncFileObject(f, col.label, stats);
              if (driveUrl) { updated[i] = { ...f, driveUrl }; changed = true; }
            } else stats.skipped++;
          }
          if (changed) await doc.ref.update({ [col.fileField]: updated });

        } else if (col.type === 'post') {
          await syncPostDoc(doc, stats);
        }

      } catch (err) {
        console.error(`  ❌ ${col.name}/${doc.id}: ${err.message}`);
        stats.errors++;
      }
    }
  }

  // Sync task-comments subcollection
  await syncTaskComments(stats);

  const duration = ((Date.now() - new Date(startedAt).getTime()) / 1000).toFixed(1);
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Daily file sync complete`);
  console.log(`   Synced : ${stats.synced} files`);
  console.log(`   Skipped: ${stats.skipped} (already synced)`);
  console.log(`   Errors : ${stats.errors}`);
  console.log(`   Time   : ${duration}s`);
  console.log(`${'─'.repeat(50)}\n`);

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
