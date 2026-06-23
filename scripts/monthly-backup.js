/**
 * BARRO INDUSTRIES — Monthly Firestore Data Backup → Google Drive
 * scripts/monthly-backup.js
 *
 * Runs via GitHub Actions on the 1st of every month at 12:01 AM PH Time.
 * Exports the PREVIOUS month's Firestore data as JSON + CSV.
 *
 * Google Drive folder structure created:
 *
 *   BI-Operations/
 *   └── Monthly Backups/
 *       └── YYYY-MM/                  ← e.g. 2026-05
 *           ├── attendance.json
 *           ├── attendance.csv
 *           ├── tasks.json
 *           ├── tasks.csv
 *           ├── task_messages.json
 *           ├── cash_advances.json
 *           ├── cash_advances.csv
 *           ├── users.json
 *           ├── users.csv
 *           ├── salary_history.json
 *           ├── salary_history.csv
 *           ├── kpi_evaluations.json
 *           ├── kpi_evaluations.csv
 *           ├── posts.json
 *           ├── payroll_overrides.json
 *           ├── attendance_extensions.json
 *           ├── suggestions.json
 *           └── _summary.txt
 *
 * Required GitHub Secrets (same as sync-to-drive):
 *   FIREBASE_SERVICE_ACCOUNT  GOOGLE_SERVICE_ACCOUNT
 *   DRIVE_FOLDER_ID           FIREBASE_PROJECT_ID
 *   FIREBASE_STORAGE_BUCKET
 */

'use strict';

const admin = require('firebase-admin');
const {
  requireEnv, initDrive, preflight, ensureFolder: ensureFolderRaw, uploadBuffer,
} = require('./drive-lib');

// ── Init Firebase ──────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'));
admin.initializeApp({
  credential:    admin.credential.cert(serviceAccount),
  storageBucket: requireEnv('FIREBASE_STORAGE_BUCKET'),
});
const db = admin.firestore();

// ── Init Google Drive (OAuth- or Shared-Drive-aware; see drive-lib.js) ───────
const { drive, authMode, ownerLabel } = initDrive();
const ROOT_FOLDER_ID = requireEnv('DRIVE_FOLDER_ID');

// ── Drive helpers (thin wrappers around the shared, Shared-Drive-safe lib) ───
const ensureFolder = (name, parentId) => ensureFolderRaw(drive, name, parentId);

async function uploadText(content, filename, mimeType, folderId) {
  return uploadBuffer(drive, Buffer.from(content, 'utf-8'), filename, mimeType || 'text/plain', folderId);
}

// ── Data helpers ──────────────────────────────────────────────────────────

// Serialize Firestore Timestamps to ISO strings, recursively clean objects
function serialize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj && typeof obj.toDate === 'function') return obj.toDate().toISOString();
  if (Array.isArray(obj)) return obj.map(serialize);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = serialize(v);
    return out;
  }
  return obj;
}

// Simple JSON → CSV (flattens one level, skips nested objects/arrays)
function toCSV(rows) {
  if (!rows.length) return 'No records\n';
  // Collect all keys across all rows
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const header = keys.map(k => `"${k}"`).join(',');
  const lines = rows.map(row =>
    keys.map(k => {
      const v = row[k];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(',')
  );
  return [header, ...lines].join('\n');
}

// Date range for the PREVIOUS month
function getPrevMonthRange() {
  const now    = new Date();
  const year   = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month  = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-indexed
  const start  = new Date(year, month - 1, 1, 0, 0, 0);
  const end    = new Date(year, month,     1, 0, 0, 0); // exclusive
  const label  = `${year}-${String(month).padStart(2, '0')}`;
  return { start, end, label };
}

// ── Collection export definitions ─────────────────────────────────────────
//
//  dateField   — Firestore field used to filter by prev month (null = export all)
//  csvFields   — keys to include in the CSV (undefined = all scalar fields)

const EXPORTS = [
  {
    name:         'attendance',
    filename:     'attendance',
    type:         'subcollection', // attendance/{uid}/records/{date} — not a flat collection
    csvFields:    ['userId','date','loginTime','timeOut','fullTime','attendanceScore','note','editedBy'],
  },
  {
    name:       'tasks',
    filename:   'tasks',
    dateField:  'createdAt',
    csvFields:  ['id','title','status','priority','dept','assignedToNames','createdAt','dueDate','presidentScore'],
    includeSubcol: true,         // also export task-comments
  },
  {
    name:       'cash_advances',
    filename:   'cash_advances',
    dateField:  'createdAt',
    csvFields:  ['id','userName','amount','terms','interest','totalPayable','monthlyPayment','balance','status','date','reason'],
  },
  {
    name:       'salary_history',
    filename:   'salary_history',
    dateField:  'generatedAt',
    csvFields:  ['id','userId','userName','month','baseSalary','allowance','deductions','netPay','multiplier','finalPay'],
  },
  {
    name:       'kpi_evals',
    filename:   'kpi_evaluations',
    dateField:  null,            // export all (small collection)
    csvFields:  ['id','selfGrade','selfNotes','presidentGrade','presidentGradeFromTasks','presidentNotes','selfAssessMonth'],
  },
  {
    name:       'users',
    filename:   'users',
    dateField:  null,
    csvFields:  ['id','displayName','email','username','role','dept','employeeId','salary','allowance','deductions'],
  },
  {
    name:       'posts',
    filename:   'posts',
    dateField:  'createdAt',
    csvFields:  ['id','authorName','dept','title','status','pinned','createdAt'],
  },
  {
    name:       'payroll_ca_overrides',
    filename:   'payroll_overrides',
    dateField:  null,
    csvFields:  ['id','userId','month','customDeduction'],
  },
  {
    name:       'attendance_extensions',
    filename:   'attendance_extensions',
    dateField:  'requestedAt',
    csvFields:  ['id','userId','date','status','reason','approvedAt','expiresAt'],
  },
  {
    name:       'suggestions',
    filename:   'suggestions',
    dateField:  'createdAt',
    csvFields:  ['id','category','text','createdAt'],
  },
];

// ── Fetch attendance subcollections: attendance/{uid}/records/{date} ────────
// The root 'attendance' collection holds one doc per user (uid as doc ID).
// Actual records live in the 'records' subcollection keyed by 'YYYY-MM-DD'.
async function fetchAttendanceSubcollection({ start, end }) {
  const startStr = start.toISOString().slice(0, 10);
  const endStr   = end.toISOString().slice(0, 10); // exclusive
  const usersSnap = await db.collection('attendance').get();
  const results = [];

  // Fetch each user's records subcollection in parallel
  await Promise.all(usersSnap.docs.map(async userDoc => {
    const uid = userDoc.id;
    const recsSnap = await userDoc.ref.collection('records')
      .where(admin.firestore.FieldPath.documentId(), '>=', startStr)
      .where(admin.firestore.FieldPath.documentId(), '<',  endStr)
      .get();
    for (const rec of recsSnap.docs) {
      results.push(serialize({ id: rec.id, userId: uid, ...rec.data() }));
    }
  }));

  // Sort by userId then date for readable output
  results.sort((a, b) => a.userId.localeCompare(b.userId) || a.date?.localeCompare(b.date ?? ''));
  return results;
}

// ── Fetch and filter a collection ──────────────────────────────────────────
async function fetchCollection(col, { start, end }) {
  // Attendance is a subcollection — handled separately
  if (col.type === 'subcollection') {
    return fetchAttendanceSubcollection({ start, end });
  }

  let snap;
  if (!col.dateField) {
    snap = await db.collection(col.name).get();
  } else if (col.dateIsStr) {
    const startStr = start.toISOString().slice(0, 10);
    const endStr   = end.toISOString().slice(0, 10);
    snap = await db.collection(col.name)
      .where(col.dateField, '>=', startStr)
      .where(col.dateField, '<',  endStr)
      .get();
  } else {
    snap = await db.collection(col.name)
      .where(col.dateField, '>=', admin.firestore.Timestamp.fromDate(start))
      .where(col.dateField, '<',  admin.firestore.Timestamp.fromDate(end))
      .get();
  }

  return snap.docs.map(d => serialize({ id: d.id, ...d.data() }));
}

// ── Export task comments as a separate JSON ────────────────────────────────
async function fetchTaskComments() {
  const tasksSnap = await db.collection('tasks').get();
  const nested = await Promise.all(
    tasksSnap.docs.map(async taskDoc => {
      const commentsSnap = await taskDoc.ref.collection('task-comments').get();
      return commentsSnap.docs.map(c =>
        serialize({ id: c.id, taskId: taskDoc.id, ...c.data() })
      );
    })
  );
  return nested.flat();
}

// ── Upload a single export (JSON + optional CSV) ───────────────────────────
async function exportCollection(col, docs, folderId, stats) {
  console.log(`   Exporting ${docs.length} records → ${col.filename}`);

  // JSON
  const jsonContent = JSON.stringify(docs, null, 2);
  await uploadText(jsonContent, `${col.filename}.json`, 'application/json', folderId);
  stats.files++;

  // CSV (only for collections with csvFields defined)
  if (col.csvFields) {
    const csvRows = docs.map(d => {
      const row = {};
      col.csvFields.forEach(k => { row[k] = d[k] ?? ''; });
      return row;
    });
    const csvContent = toCSV(csvRows);
    await uploadText(csvContent, `${col.filename}.csv`, 'text/csv', folderId);
    stats.files++;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const stats      = { exported: 0, files: 0, errors: 0 };
  const startedAt  = new Date();
  const { start, end, label } = getPrevMonthRange();

  console.log(`\n🗄️  Barro Industries — Monthly Backup`);
  console.log(`   Backing up: ${label}`);
  console.log(`   Range    : ${start.toISOString()} → ${end.toISOString()}\n`);

  // Fail loud with an exact fix if the Drive destination is misconfigured.
  await preflight(drive, ROOT_FOLDER_ID, authMode, ownerLabel);

  // Ensure folder structure: BI-Operations / Monthly Backups / YYYY-MM
  const backupRoot  = await ensureFolder('Monthly Backups', ROOT_FOLDER_ID);
  const monthFolder = await ensureFolder(label, backupRoot);

  const summaryLines = [
    `Barro Industries — Monthly Data Backup`,
    `Month  : ${label}`,
    `Created: ${startedAt.toISOString()}`,
    ``,
    `Collections exported:`,
  ];

  // Export each collection
  for (const col of EXPORTS) {
    try {
      console.log(`\n📋 ${col.name}`);
      const docs = await fetchCollection(col, { start, end });
      await exportCollection(col, docs, monthFolder, stats);
      stats.exported += docs.length;
      summaryLines.push(`  ${col.filename}: ${docs.length} records`);

      // Task comments as extra JSON under tasks
      if (col.includeSubcol) {
        console.log(`   + task-comments (subcollection)`);
        const comments = await fetchTaskComments();
        await uploadText(
          JSON.stringify(comments, null, 2),
          'task_messages.json',
          'application/json',
          monthFolder
        );
        stats.files++;
        summaryLines.push(`  task_messages: ${comments.length} messages`);
      }
    } catch (err) {
      console.error(`  ❌ ${col.name}: ${err.message}`);
      stats.errors++;
      summaryLines.push(`  ${col.filename}: ERROR — ${err.message}`);
    }
  }

  // Upload summary file
  const duration = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  summaryLines.push('');
  summaryLines.push(`Total records : ${stats.exported}`);
  summaryLines.push(`Total files   : ${stats.files}`);
  summaryLines.push(`Errors        : ${stats.errors}`);
  summaryLines.push(`Duration      : ${duration}s`);

  await uploadText(summaryLines.join('\n'), '_summary.txt', 'text/plain', monthFolder);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Monthly backup complete — ${label}`);
  console.log(`   Records exported: ${stats.exported}`);
  console.log(`   Files created   : ${stats.files}`);
  console.log(`   Errors          : ${stats.errors}`);
  console.log(`   Duration        : ${duration}s`);
  console.log(`${'─'.repeat(50)}\n`);

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
