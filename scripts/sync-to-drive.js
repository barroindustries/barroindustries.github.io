/**
 * BARRO INDUSTRIES — Daily File Sync: Firebase Storage → Google Drive
 * scripts/sync-to-drive.js
 *
 * Runs via GitHub Actions every day at 12:00 AM Philippine Time (UTC+8).
 *
 * What it does:
 *   - Walks EVERY Firestore collection (and one level of subcollections),
 *     finding any Firebase Storage URL anywhere in a document — at the root,
 *     inside a field object, or inside an array (e.g. task attachments,
 *     drawing revisions, payment receipts).
 *   - Downloads each not-yet-synced file and uploads it to Google Drive,
 *     organised into one subfolder per collection:
 *
 *       BI-Operations/
 *       └── Files/
 *           ├── Tasks/          ├── Submissions/   ├── Quotes/
 *           ├── Task Messages/  ├── Posts/         ├── Memos/
 *           ├── Resources/      ├── Drawings/      ├── Receipts/
 *           ├── Payslips/       ├── Policies/      ├── Sales Orders/
 *           ├── Project Payments/  └── Dept Files/  ...
 *
 *   - Writes the Drive link back next to the original URL so it never
 *     re-syncs and the app can link straight to the Drive copy. The companion
 *     key follows the existing convention:
 *         url        → driveUrl
 *         fileUrl    → driveFileUrl
 *         imageUrl   → driveImageUrl     (etc.)
 *
 * Because it walks generically, NEW file features are covered automatically —
 * no need to hand-register every collection (which is what previously left
 * drawings, receipts, payslips and dept files un-synced).
 *
 * Required GitHub Secrets:
 *   FIREBASE_SERVICE_ACCOUNT  — Firebase Admin SDK JSON (stringified)
 *   GOOGLE_SERVICE_ACCOUNT    — Google Drive service account JSON (stringified)
 *   DRIVE_FOLDER_ID           — Google Drive root folder ID (BI-Operations)
 *   FIREBASE_STORAGE_BUCKET   — e.g. barro-industries.firebasestorage.app
 */

'use strict';

const admin   = require('firebase-admin');
const fetch   = require('node-fetch');
const {
  requireEnv, initDrive, preflight, ensureFolder, uploadBuffer,
} = require('./drive-lib');

// ── Init Firebase ────────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'));
admin.initializeApp({
  credential:    admin.credential.cert(serviceAccount),
  storageBucket: requireEnv('FIREBASE_STORAGE_BUCKET'),
});
const db = admin.firestore();

// ── Init Drive ────────────────────────────────────────────────────────────────
const { drive, authMode, ownerLabel } = initDrive();
const ROOT_FOLDER_ID = requireEnv('DRIVE_FOLDER_ID');

// ── Folder naming ──────────────────────────────────────────────────────────────
// Friendly Drive subfolder names. Anything not listed falls back sensibly.
const LABELS = {
  tasks: 'Tasks', 'task-comments': 'Task Messages',
  submissions: 'Submissions',
  quotes: 'Quotes', bk_quotes: 'Quotes', bs_quotes: 'Quotes',
  posts: 'Posts', memos: 'Memos', resources: 'Resources',
  design_drawings: 'Drawings',
  expenses: 'Receipts', payslips: 'Payslips', policies: 'Policies',
  sales_orders: 'Sales Orders', job_projects: 'Project Payments',
  job_costs: 'Project Payments', partner_deals: 'Partner Deals',
};
function titleCase(s) {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function labelFor(name) {
  if (LABELS[name]) return LABELS[name];
  if (name.startsWith('files_'))   return 'Dept Files';
  if (name.startsWith('budgets_')) return null;   // budgets hold no files
  return titleCase(name);
}

// Big / high-churn / file-less collections we never need to scan for uploads.
const EXCLUDE = new Set([
  'audit_log', 'attendance', 'notifications', 'presence', 'sessions',
  'products', 'productMeta', 'inventory_items',
]);

// ── File detection + companion-key convention ───────────────────────────────
function isFirebaseUrl(v) {
  return typeof v === 'string' && v.includes('firebasestorage.googleapis.com');
}
// url → driveUrl ;  fileUrl → driveFileUrl ;  imageUrl → driveImageUrl ; …
function companionKey(key) {
  if (key === 'url') return 'driveUrl';
  if (/url$/i.test(key)) return 'drive' + key.charAt(0).toUpperCase() + key.slice(1);
  return 'drive_' + key;
}
// Recover the original filename from a Firebase download URL (…/o/<path>?…),
// stripping the "<timestamp>_" prefix the uploader adds.
function deriveName(url) {
  try {
    const enc  = url.split('/o/')[1].split('?')[0];
    const base = decodeURIComponent(enc).split('/').pop();
    return base.replace(/^\d{10,}_/, '') || 'file';
  } catch (_) { return 'file'; }
}
function nameFor(obj, key, url) {
  const sibling = obj[key.replace(/url$/i, 'Name')] || obj[key.replace(/url$/i, 'name')];
  return sibling || obj.name || obj.fileName || deriveName(url);
}

// ── Mirror one file to Drive ────────────────────────────────────────────────
async function mirror(url, filename, folderId, stats) {
  console.log(`    ↳ ${filename}`);

  // 1) Download from Firebase Storage. A 403/404 here means the source object
  //    was deleted or its token rotated — expected drift, NOT a sync failure,
  //    so it must not turn the whole nightly run red.
  let buffer, mime;
  try {
    const res = await fetch(url, { timeout: 60000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = await res.buffer();
    mime   = res.headers.get('content-type') || 'application/octet-stream';
  } catch (err) {
    console.warn(`      ⤵ skipped — source unfetchable (${err.message})`);
    stats.unfetchable++;
    return null;
  }

  // 2) Upload to Drive. Failures here ARE real (quota / permission / config).
  try {
    const link = await uploadBuffer(drive, buffer, filename, mime, folderId);
    stats.synced++;
    console.log(`      ✓ ${link}`);
    return link;
  } catch (err) {
    console.error(`      ✗ upload failed: ${err.message}`);
    stats.errors++;
    return null;
  }
}

// ── Recursively mirror every Firebase URL inside a value (mutates in place) ──
// Returns true if anything was added.
async function walk(node, folderId, stats) {
  let changed = false;

  if (Array.isArray(node)) {
    for (const el of node) {
      if (el && typeof el === 'object') changed = await walk(el, folderId, stats) || changed;
    }
    return changed;
  }
  if (!node || typeof node !== 'object') return false;

  // 1) Mirror file URLs found directly on this object's keys.
  for (const [k, v] of Object.entries(node)) {
    if (!isFirebaseUrl(v)) continue;
    const comp = companionKey(k);
    if (node[comp]) continue;                       // already synced
    const link = await mirror(v, nameFor(node, k, v), folderId, stats);
    if (link) { node[comp] = link; changed = true; }
  }
  // 2) Recurse into nested objects / arrays.
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') changed = await walk(v, folderId, stats) || changed;
  }
  return changed;
}

// ── Process one document ─────────────────────────────────────────────────────
async function processDoc(doc, folderId, stats) {
  const data    = doc.data();
  const updates = {};

  for (const [k, v] of Object.entries(data)) {
    if (isFirebaseUrl(v)) {
      const comp = companionKey(k);
      if (data[comp]) continue;
      const link = await mirror(v, nameFor(data, k, v), folderId, stats);
      if (link) updates[comp] = link;
    } else if (v && typeof v === 'object') {
      if (await walk(v, folderId, stats)) updates[k] = v;   // rewrite whole field
    }
  }

  if (Object.keys(updates).length) await doc.ref.update(updates);
}

// ── Process a collection (and, depth permitting, its subcollections) ─────────
async function processCollection(colRef, name, parentFolderId, depth, stats) {
  const label = labelFor(name);
  if (label === null) return;                         // explicitly file-less

  const snap = await colRef.get();
  if (snap.empty) return;
  console.log(`\n📁 ${name} — ${snap.size} docs`);

  let folderId = null;   // created lazily, only when a file is actually found
  for (const doc of snap.docs) {
    if (!folderId) folderId = await ensureFolder(drive, label, parentFolderId);
    try {
      await processDoc(doc, folderId, stats);
    } catch (err) {
      console.error(`  ❌ ${name}/${doc.id}: ${err.message}`);
      stats.errors++;
    }
    if (depth > 0) {
      const subs = await doc.ref.listCollections();
      for (const sub of subs) {
        await processCollection(sub, sub.id, parentFolderId, depth - 1, stats);
      }
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const stats     = { synced: 0, errors: 0, unfetchable: 0 };
  const startedAt = Date.now();
  console.log(`\n🚀 Barro Industries — Daily File Sync`);

  // Fail loud with an exact fix if the Drive destination is misconfigured.
  await preflight(drive, ROOT_FOLDER_ID, authMode, ownerLabel);

  const filesRoot = await ensureFolder(drive, 'Files', ROOT_FOLDER_ID);

  // Discover every root collection automatically.
  const collections = await db.listCollections();
  console.log(`\n📚 ${collections.length} root collections discovered`);

  for (const col of collections) {
    if (EXCLUDE.has(col.id)) continue;
    await processCollection(col, col.id, filesRoot, 1, stats);
  }

  const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Daily file sync complete`);
  console.log(`   Synced      : ${stats.synced} files`);
  console.log(`   Unfetchable : ${stats.unfetchable} (stale/deleted source — skipped)`);
  console.log(`   Errors      : ${stats.errors} (Drive upload failures)`);
  console.log(`   Time        : ${duration}s`);
  console.log(`${'─'.repeat(50)}\n`);

  // Only real Drive failures fail the run; unfetchable sources are expected drift.
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
