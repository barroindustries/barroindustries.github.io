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
 *           ├── tasks__comments.json     ← subcollection walker (see below)
 *           ├── conversations__messages.json
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
 *           ├── {root}__{subcollection}.json  ← ANY subcollection of an exported
 *           │                                    root doc (comments, messages, …),
 *           │                                    entries keyed "{docId}/{subDocId}"
 *           │                                    (v13 Phase 2+3 — generic walker)
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
  // Manila 'now' on a UTC runner (UTC+8), so the label/window are PH-correct.
  const now    = new Date(Date.now() + 8 * 3600 * 1000);
  const year   = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month  = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-indexed
  const start  = new Date(year, month - 1, 1, 0, 0, 0);
  const end    = new Date(year, month,     1, 0, 0, 0); // exclusive
  const label  = `${year}-${String(month).padStart(2, '0')}`;
  return { start, end, label };
}

// ── Per-collection overrides (specials only) ───────────────────────────────
//  Any root collection NOT listed here is auto-discovered (db.listCollections)
//  and exported as a COMPLETE full-document JSON snapshot — no hand-registration,
//  so new collections (pay_runs, it_*, aec_contacts, files_*, budgets_*, …) are
//  covered automatically and this file never drifts again.
//    dateField  — v13 Phase 89: NO LONGER gates full-vs-filtered for the main
//                 export (every collection below is now a FULL snapshot, same
//                 as everything else, so restore reflects current state —
//                 H12). When present, dateField instead drives an ADDITIONAL
//                 "*_created_{month}.csv" MONTH-ACTIVITY REPORT (docs created
//                 in the backed-up month, frozen at that moment) — a report,
//                 not a restore source. See exportMonthReport() + restore's
//                 mimeType-json-only file filter, which already skips CSVs.
//    dateIsStr  — dateField is a 'YYYY-MM-DD' string, not a Timestamp
//    csvFields  — also emit a CSV with these columns (JSON is always complete)
//    filename   — output basename if different from the collection name
//    type       — 'subcollection' routes to fetchAttendanceSubcollection
const OVERRIDES = {
  attendance: {
    filename: 'attendance', type: 'subcollection',
    csvFields: ['userId','date','loginTime','timeOut','fullTime','attendanceScore','note','editedBy'],
  },
  tasks: {
    dateField: 'createdAt',
    csvFields: ['id','title','status','priority','dept','assignedToNames','createdAt','dueDate','presidentScore'],
  },
  cash_advances: {
    dateField: 'createdAt',
    csvFields: ['id','userName','amount','terms','interest','totalPayable','monthlyPayment','balance','status','date','reason'],
  },
  salary_history: {
    dateField: 'generatedAt',
    csvFields: ['id','userId','userName','month','baseSalary','allowance','deductions','netPay','multiplier','finalPay'],
  },
  kpi_evals: {
    filename: 'kpi_evaluations',
    csvFields: ['id','selfGrade','selfNotes','presidentGrade','presidentGradeFromTasks','presidentNotes','selfAssessMonth'],
  },
  users: {
    csvFields: ['id','displayName','email','username','role','dept','employeeId','salary','allowance','deductions'],
  },
  posts: {
    dateField: 'createdAt',
    csvFields: ['id','authorName','dept','title','status','pinned','createdAt'],
  },
  payroll_ca_overrides: {
    filename: 'payroll_overrides',
    csvFields: ['id','userId','month','customDeduction'],
  },
  attendance_extensions: {
    dateField: 'requestedAt',
    csvFields: ['id','userId','date','status','reason','approvedAt','expiresAt'],
  },
  suggestions: {
    dateField: 'createdAt',
    csvFields: ['id','category','text','createdAt'],
  },
  aec_contacts: {
    csvFields: ['id','itemNo','type','company','contactPerson','phone','email','region',
                'address','stage','quoteSent','quoteSentDate','quoteRef','potential',
                'followUpDate','lastContact'],
  },
};

// Size guard (v13 Phase 89): any single collection's FULL export exceeding
// this doc count gets a loud console warning + a system_health warning entry
// so unbounded growth becomes visible before it becomes a Drive/runtime
// problem. Not a hard cap — nothing is truncated, just flagged.
const COLLECTION_SIZE_WARN_THRESHOLD = 50000;

// Ephemeral / huge / per-user-subcollection roots we never snapshot to JSON.
// (audit_log is intentionally NOT here — its off-site copy is the whole point.)
// v13 Phase 2/3 cleanup: 'presence' and 'sessions' removed — neither is a real
// Firestore root collection (phantom entries; presence lives on user docs,
// there is no 'sessions' collection at all), so they never excluded anything.
const EXCLUDE = new Set(['notifications']);

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
// Returns { docs, refs }: `docs` is the serialized export payload (unchanged
// shape/behavior); `refs` is the matching array of DocumentReferences for the
// SAME doc set, used by exportSubcollections() below to walk each doc's
// subcollections (comments, messages, …) without a second, possibly-stale
// query. For the attendance special case (already flattened into per-record
// rows, not per-user docs) refs is empty — see exportSubcollections' doc
// comment for why that's also how attendance/{uid}/records avoids double
// export.
async function fetchCollection(col, { start, end }) {
  // Attendance is a subcollection — handled separately
  if (col.type === 'subcollection') {
    return { docs: await fetchAttendanceSubcollection({ start, end }), refs: [] };
  }

  // v13 Phase 89: FULL snapshot for every collection, always — no dateField
  // filtering here anymore (that used to silently freeze docs at their
  // creation-month state and made restore revert later edits — H12). The
  // dateField, if present, is used ONLY by fetchMonthReport() below to build
  // an additional, clearly-named month-activity report file.
  const snap = await db.collection(col.name).get();

  return {
    docs: snap.docs.map(d => serialize({ id: d.id, ...d.data() })),
    refs: snap.docs.map(d => d.ref),
  };
}

// ── Month-activity report (v13 Phase 89) ───────────────────────────────────
// For collections with a dateField, ALSO fetch the docs created in the
// backed-up month specifically, and export them as an ADDITIONAL
// "{filename}_created_{month}.csv" report file. This is a point-in-time
// "what got created this month" report, NOT a restore source — the main
// {filename}.json/.csv above is always the full current-state snapshot that
// restore-from-backup.js reads. Emitted as CSV only (not JSON) so Drive's
// mimeType='application/json' listing in restore-from-backup.js naturally
// never sees it; the _manifest.json entry is also tagged report:true as a
// second, explicit line of defense.
async function fetchMonthReport(col, { start, end }) {
  if (!col.dateField) return null;
  let snap;
  if (col.dateIsStr) {
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

// ── Generic subcollection walker (v13 Phase 2 + 3) ─────────────────────────
// One implementation covers every subcollection of every already-exported
// root doc — task/submission comment threads (C1) AND chat messages (C2) —
// instead of a hand-registered exporter per feature that silently drifts
// (the old fetchTaskComments() read a subcollection name, 'task-comments',
// that never actually existed; real threads live at {parent}/{docId}/comments).
//
// Ephemeral subcollections we deliberately never archive:
//   'typing'  — chat typing beacons (conversations/{id}/typing); TTL ~6s,
//               rewritten every keystroke, zero restore value.
//   'readers' — read-receipt docs (tasks/{id}/readers, conversations/{id}/readers);
//               overwritten on every view, last-read timestamps aren't data
//               worth restoring and would double every doc count for nothing.
const SUBCOLLECTION_SKIP = new Set(['typing', 'readers']);

// Names we already know about — used only to annotate the console/summary
// output ("(new)" tag on anything unexpected) so a human notices drift.
// NOT a filter: unrecognized subcollection names are still exported.
const KNOWN_SUBCOLLECTIONS = ['comments', 'messages', 'records'];

// Loud, not silent: per (root, subcollection) pair across the whole run.
const SUBCOLLECTION_DOC_CAP = 50000;

async function exportSubcollections(rootName, refs, folderId, stats, manifest, summaryLines) {
  if (!refs.length) return;

  const bySub     = new Map(); // subName -> array of exported records
  const truncated = new Map(); // subName -> count of docs dropped by the cap

  for (const ref of refs) {
    let subs;
    try {
      subs = await ref.listCollections();
    } catch (err) {
      console.warn(`   ⚠️  ${rootName}/${ref.id}: could not list subcollections — ${err.message}`);
      continue;
    }
    for (const sub of subs) {
      if (SUBCOLLECTION_SKIP.has(sub.id)) continue;

      let snap;
      try {
        snap = await sub.get();
      } catch (err) {
        console.warn(`   ⚠️  ${rootName}/${ref.id}/${sub.id}: fetch failed — ${err.message}`);
        continue;
      }

      const arr  = bySub.get(sub.id) || [];
      bySub.set(sub.id, arr);
      const room = SUBCOLLECTION_DOC_CAP - arr.length;
      if (room <= 0) {
        truncated.set(sub.id, (truncated.get(sub.id) || 0) + snap.docs.length);
        continue;
      }
      const keep = snap.docs.slice(0, room);
      if (keep.length < snap.docs.length) {
        truncated.set(sub.id, (truncated.get(sub.id) || 0) + (snap.docs.length - keep.length));
      }
      for (const d of keep) {
        arr.push(serialize({ id: `${ref.id}/${d.id}`, ...d.data() }));
      }
    }
  }

  for (const [subName, records] of bySub.entries()) {
    const filename = `${rootName}__${subName}`;
    const tag = KNOWN_SUBCOLLECTIONS.includes(subName) ? '' : ' (new)';
    console.log(`   + ${rootName}/*/${subName}${tag} — ${records.length} records`);
    await uploadText(JSON.stringify(records, null, 2), `${filename}.json`, 'application/json', folderId);
    stats.files++;
    stats.exported += records.length;
    // parentCollection/subcollection let restore-from-backup.js reconstruct
    // the write path (parentCollection/{docId}/subcollection/{subDocId})
    // without re-deriving it from the filename.
    manifest.push({
      collection: `${rootName}/*/${subName}`,
      filename,
      records: records.length,
      parentCollection: rootName,
      subcollection: subName,
    });
    summaryLines.push(`  ${filename}: ${records.length} records (subcollection of ${rootName})`);

    const dropped = truncated.get(subName) || 0;
    if (dropped > 0) {
      const msg = `${filename}: TRUNCATED at ${SUBCOLLECTION_DOC_CAP} docs — ${dropped} more record(s) dropped this run`;
      console.warn(`   🚨 ${msg}`);
      summaryLines.push(`  ⚠️  ${msg}`);
    }
  }
}

// ── Upload a single export (JSON + optional CSV) ───────────────────────────
// Returns the byte size of the JSON payload (used for the size guard/summary).
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

  return Buffer.byteLength(jsonContent, 'utf-8');
}

// ── Upload the additional month-activity report (CSV only, v13 Phase 89) ───
async function exportMonthReport(col, docs, label, folderId, stats) {
  if (!docs || !col.csvFields) return null;
  const reportFilename = `${col.filename}_created_${label}`;
  console.log(`   Exporting ${docs.length} records → ${reportFilename}.csv (month-activity report, NOT a restore source)`);
  const csvRows = docs.map(d => {
    const row = {};
    col.csvFields.forEach(k => { row[k] = d[k] ?? ''; });
    return row;
  });
  const csvContent = toCSV(csvRows);
  await uploadText(csvContent, `${reportFilename}.csv`, 'text/csv', folderId);
  stats.files++;
  return reportFilename;
}

// ── Heartbeat: write a status doc the app watches (see §F) ──────────────────
async function reportHealth(job, stats, label, durationSec) {
  try {
    await db.collection('system_health').doc(job).set({
      job,
      lastRunAt:       admin.firestore.FieldValue.serverTimestamp(),
      lastStatus:      stats.errors > 0 ? 'error' : 'ok',
      errors:          stats.errors || 0,
      filesWritten:    stats.files || 0,
      recordsExported: stats.exported || 0,
      unfetchable:     stats.unfetchable || 0,
      warnings:        stats.warnings || 0,
      durationSec:     Number(durationSec) || 0,
      label:           label || '',
    }, { merge: true });
    console.log(`   🫀 system_health/${job} updated (${stats.errors > 0 ? 'error' : 'ok'})`);
  } catch (e) {
    console.warn(`   ⚠️  could not write system_health/${job}: ${e.message}`);
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
    `File semantics (v13 Phase 89):`,
    `  {name}.json / {name}.csv           — FULL current-state snapshot, every root collection.`,
    `                                        This is what restore-from-backup.js reads back.`,
    `  {name}_created_{month}.csv         — MONTH-ACTIVITY REPORT: docs created in ${label} only,`,
    `                                        frozen at that moment. NOT a restore source — CSV-only`,
    `                                        (restore only looks at mimeType=json files) and flagged`,
    `                                        report:true in _manifest.json as a second guard.`,
    `  {root}__{subcollection}.json       — every subcollection doc under an exported root doc`,
    `                                        (comments, messages, attendance records, …), full snapshot.`,
    ``,
    `Collections exported:`,
  ];

  // Export every discovered root collection (drift-proof — see OVERRIDES/EXCLUDE above)
  const manifest = [];
  const discovered = await db.listCollections();
  console.log(`\n📚 ${discovered.length} root collections discovered`);

  stats.warnings = 0;
  const sizeWarnings = [];

  for (const ref of discovered) {
    const name = ref.id;
    if (EXCLUDE.has(name)) { console.log(`\n⏭️  ${name} (excluded)`); continue; }
    const ov  = OVERRIDES[name] || {};
    const col = { name, filename: ov.filename || name, dateField: ov.dateField ?? null,
                  dateIsStr: ov.dateIsStr, csvFields: ov.csvFields,
                  type: ov.type };
    try {
      console.log(`\n📋 ${name}`);
      // v13 Phase 89: main export is ALWAYS a full current-state snapshot
      // now (fetchCollection no longer date-filters), so restore reflects
      // edits made after a doc's creation month (H12).
      const { docs, refs } = await fetchCollection(col, { start, end });
      const bytes = await exportCollection(col, docs, monthFolder, stats);
      stats.exported += docs.length;
      manifest.push({ collection: name, filename: col.filename, records: docs.length });

      const kb = bytes ? (bytes / 1024).toFixed(1) : '0.0';
      let sizeNote = '';
      if (docs.length > COLLECTION_SIZE_WARN_THRESHOLD) {
        stats.warnings++;
        sizeNote = `  ⚠️ EXCEEDS ${COLLECTION_SIZE_WARN_THRESHOLD.toLocaleString()}-doc size-guard threshold`;
        sizeWarnings.push(`${col.filename}: ${docs.length} docs (${kb} KB)`);
        console.warn(`   🚨 ${col.filename}: ${docs.length} docs exceeds size-guard threshold of ${COLLECTION_SIZE_WARN_THRESHOLD}`);
      }
      summaryLines.push(`  ${col.filename}: ${docs.length} records, ${kb} KB [full snapshot — restore source]${sizeNote}`);

      // Additional, clearly-named month-activity report (v13 Phase 89) —
      // ONLY for collections with a dateField. Report, not restore input;
      // restore-from-backup.js skips it (CSV mimeType + manifest report:true).
      if (col.dateField) {
        const reportDocs = await fetchMonthReport(col, { start, end });
        const reportFilename = await exportMonthReport(col, reportDocs, label, monthFolder, stats);
        if (reportFilename) {
          manifest.push({
            collection: name, filename: reportFilename, records: reportDocs.length,
            report: true, reportOf: col.filename, reportMonth: label,
          });
          summaryLines.push(`  ${reportFilename}.csv: ${reportDocs.length} records [month-activity report of ${col.filename}, created in ${label} — NOT a restore source]`);
        }
      }

      // Generic subcollection walker — comments/messages/etc. under this
      // root's docs (v13 Phase 2+3). No-op when refs is empty (attendance).
      await exportSubcollections(name, refs, monthFolder, stats, manifest, summaryLines);
    } catch (err) {
      console.error(`  ❌ ${name}: ${err.message}`);
      stats.errors++;
      summaryLines.push(`  ${col.filename}: ERROR — ${err.message}`);
    }
  }

  // Self-describing manifest → drives drift-proof restore (see restore-from-backup.js)
  await uploadText(JSON.stringify(manifest, null, 2), '_manifest.json', 'application/json', monthFolder);
  stats.files++;

  // Upload summary file
  const duration = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  summaryLines.push('');
  if (sizeWarnings.length) {
    summaryLines.push(`⚠️  SIZE-GUARD WARNINGS (> ${COLLECTION_SIZE_WARN_THRESHOLD.toLocaleString()} docs):`);
    sizeWarnings.forEach(w => summaryLines.push(`  - ${w}`));
    summaryLines.push('');
  }
  summaryLines.push(`Total records : ${stats.exported}`);
  summaryLines.push(`Total files   : ${stats.files}`);
  summaryLines.push(`Errors        : ${stats.errors}`);
  summaryLines.push(`Warnings      : ${stats.warnings}`);
  summaryLines.push(`Duration      : ${duration}s`);

  await uploadText(summaryLines.join('\n'), '_summary.txt', 'text/plain', monthFolder);

  // Size-guard → system_health, so unbounded growth is visible in-app, not
  // just buried in a log file (v13 Phase 89).
  if (sizeWarnings.length) {
    try {
      await db.collection('system_health').doc('monthly_backup_size_guard').set({
        job: 'monthly_backup_size_guard',
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        lastStatus: 'warning',
        label,
        thresholdDocs: COLLECTION_SIZE_WARN_THRESHOLD,
        collections: sizeWarnings,
      }, { merge: true });
      console.warn(`   🫀 system_health/monthly_backup_size_guard warning written (${sizeWarnings.length} collection(s) over threshold)`);
    } catch (e) {
      console.warn(`   ⚠️  could not write system_health/monthly_backup_size_guard: ${e.message}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Monthly backup complete — ${label}`);
  console.log(`   Records exported: ${stats.exported}`);
  console.log(`   Files created   : ${stats.files}`);
  console.log(`   Errors          : ${stats.errors}`);
  console.log(`   Warnings        : ${stats.warnings}`);
  console.log(`   Duration        : ${duration}s`);
  console.log(`${'─'.repeat(50)}\n`);

  await reportHealth('monthly_backup', stats, label, duration);
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
