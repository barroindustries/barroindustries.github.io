/**
 * scripts/backup-walk.js — which documents the monthly backup walks (audit 2026-10-28 H4).
 *
 * THE BUG THIS FIXES. Firestore lets a document exist under a parent that does not: the app writes
 * attendance/{uid}/records/{date} and never attendance/{uid} itself. A collection get() returns only
 * documents that EXIST, so monthly-backup.js's
 *     db.collection('attendance').get()  →  0 documents  →  0 users  →  attendance.json = []
 * and the generic subcollection walker, which walked those same get() results, never reached a single
 * record. Every backup from June 2026 on reads "attendance: 0 records" (and the same for
 * attendance_worker) — payroll-relevant data with no copy anywhere. listDocuments() returns every ref
 * in a collection, "missing" parents included, which is what both walks need.
 *
 * Kept out of monthly-backup.js because that script connects to Firebase and Drive as it loads; this
 * file takes the db as an argument so tests/backup-walk.test.mjs can run it against the in-memory fake.
 */
'use strict';

// Every document ref in a collection, INCLUDING parents that only have subcollections.
async function parentRefs(collectionRef) {
  return collectionRef.listDocuments();
}

// attendance/{uid}/records/{YYYY-MM-DD} for start <= date < end (both 'YYYY-MM-DD'), flattened to
// { id, userId, ...record } rows sorted by user then date — the attendance.json / .csv month export.
async function fetchAttendanceRecords(db, { startStr, endStr }) {
  const users = await parentRefs(db.collection('attendance'));
  const rows = [];
  await Promise.all(users.map(async (userRef) => {
    const snap = await userRef.collection('records').get();
    for (const rec of snap.docs) {
      if (rec.id >= startStr && rec.id < endStr) rows.push({ id: rec.id, userId: userRef.id, ...rec.data() });
    }
  }));
  rows.sort((a, b) => a.userId.localeCompare(b.userId) || String(a.date || a.id).localeCompare(String(b.date || b.id)));
  return rows;
}

module.exports = { parentRefs, fetchAttendanceRecords };
