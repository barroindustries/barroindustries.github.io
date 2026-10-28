// tests/backup-walk.test.mjs — system audit 2026-10-28, finding H4: the monthly backup never contained one attendance record.
//
// The app writes attendance/{uid}/records/{date} and never attendance/{uid} itself, so in Firestore those parents are
// "missing" documents. scripts/monthly-backup.js started from db.collection('attendance').get(), which returns only documents
// that exist: zero users, attendance.json = [], and the subcollection walker (which walked the same get() results) never
// reached a record. Confirmed 2026-10-29: live Firestore holds 0 real / 6 missing attendance parents and 0 / 1 for
// attendance_worker, and every Drive backup from June 2026 on reads "attendance: 0 records" with no attendance__records file.
//
// The fake Firestore (tests/fixtures/fake-firestore.cjs) models exactly that: get() skips missing parents, listDocuments()
// does not. The last block runs the REAL monthly-backup.js against it with Drive stubbed out and reads what it uploaded.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createFake } = require(path.join(ROOT, 'tests/fixtures/fake-firestore.cjs'));
const { parentRefs, fetchAttendanceRecords } = require(path.join(ROOT, 'scripts/backup-walk.js'));

// The backup runs on a UTC GitHub runner; its month window is built in local time, so pin the same here.
process.env.TZ = 'UTC';
function prevMonth() {               // mirrors monthly-backup.js getPrevMonthRange()
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}
const PM = prevMonth();
const BEFORE = (() => { const [y, m] = PM.split('-').map(Number); return m === 1 ? `${y - 1}-12-28` : `${y}-${String(m - 1).padStart(2, '0')}-28`; })();

function seedLikeProduction(fake) {
  // Only the records exist — exactly what js/screens/worker.js and the attendance screens write.
  fake.seed(`attendance/u1/records/${BEFORE}`, { date: BEFORE, loginTime: '08:01', attendanceScore: 1 });
  fake.seed(`attendance/u1/records/${PM}-03`, { date: `${PM}-03`, loginTime: '08:05', attendanceScore: 1 });
  fake.seed(`attendance/u1/records/${PM}-04`, { date: `${PM}-04`, loginTime: '09:40', attendanceScore: 0.5 });
  fake.seed(`attendance/u2/records/${PM}-03`, { date: `${PM}-03`, loginTime: '07:58', attendanceScore: 1 });
  fake.seed(`attendance_worker/w1/records/${PM}-05`, { date: `${PM}-05`, timeIn: '07:30' });
  // A normal collection whose parents DO exist, so the change provably keeps them.
  fake.seed('clients/c1', { name: 'Chibabs' });
  fake.seed('clients/c1/comments/k1', { text: 'site visit done' });
}

describe('H4 — the Firestore behaviour behind the bug', () => {
  it('a collection get() does not see parents that only hold subcollections (the old backup saw 0 users)', async () => {
    const fake = createFake(); seedLikeProduction(fake);
    assert.equal((await fake.db.collection('attendance').get()).size, 0);
    assert.equal((await fake.db.collection('attendance_worker').get()).size, 0);
  });
  it('parentRefs() finds every one of them, and still finds real documents', async () => {
    const fake = createFake(); seedLikeProduction(fake);
    assert.deepEqual((await parentRefs(fake.db.collection('attendance'))).map((r) => r.id).sort(), ['u1', 'u2']);
    assert.deepEqual((await parentRefs(fake.db.collection('attendance_worker'))).map((r) => r.id), ['w1']);
    assert.deepEqual((await parentRefs(fake.db.collection('clients'))).map((r) => r.id), ['c1']);
  });
});

describe("H4 — fetchAttendanceRecords: the month's records, flattened", () => {
  it('returns every user\'s records inside the window, with the user id, sorted', async () => {
    const fake = createFake(); seedLikeProduction(fake);
    const [y, m] = PM.split('-').map(Number);
    const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const rows = await fetchAttendanceRecords(fake.db, { startStr: `${PM}-01`, endStr: end });
    assert.deepEqual(rows.map((r) => `${r.userId}/${r.id}`), [`u1/${PM}-03`, `u1/${PM}-04`, `u2/${PM}-03`]);
    assert.equal(rows[1].attendanceScore, 0.5);
  });
});

describe('H4 — the real monthly-backup.js now backs attendance up', () => {
  const uploads = new Map();
  let exitCode = null;

  before(async () => {
    const fake = createFake(); seedLikeProduction(fake);
    const driveStub = {
      requireEnv: (n) => (n === 'FIREBASE_SERVICE_ACCOUNT' ? '{}' : 'test-' + n),
      initDrive: () => ({ drive: {}, authMode: 'test', ownerLabel: 'test' }),
      preflight: async () => {},
      ensureFolder: async (drive, name) => 'folder:' + name,
      uploadBuffer: async (drive, buf, name) => { uploads.set(name, buf.toString('utf-8')); return { id: name }; },
    };
    const done = new Promise((resolve) => {
      const realExit = process.exit, origLoad = Module._load, log = console.log, warn = console.warn;
      console.log = () => {}; console.warn = () => {};
      process.exit = (code) => {
        exitCode = code; process.exit = realExit; console.log = log; console.warn = warn; resolve();
      };
      Module._load = function (request) {
        if (request === 'firebase-admin') return fake.admin;
        if (request === './drive-lib') return driveStub;
        return origLoad.apply(this, arguments);
      };
      try { require(path.join(ROOT, 'scripts/monthly-backup.js')); } finally { Module._load = origLoad; }
    });
    await done;
  });

  it('finishes with no errors', () => assert.equal(exitCode, 0));

  it('attendance__records.json holds EVERY attendance record, keyed parentId/recordId for restore', () => {
    const recs = JSON.parse(uploads.get('attendance__records.json'));
    assert.deepEqual(recs.map((r) => r.id).sort(), [`u1/${BEFORE}`, `u1/${PM}-03`, `u1/${PM}-04`, `u2/${PM}-03`]);
  });

  it('attendance_worker records are backed up too', () => {
    assert.deepEqual(JSON.parse(uploads.get('attendance_worker__records.json')).map((r) => r.id), [`w1/${PM}-05`]);
  });

  it('attendance.json is the month\'s records, no longer []', () => {
    assert.deepEqual(JSON.parse(uploads.get('attendance.json')).map((r) => `${r.userId}/${r.id}`), [`u1/${PM}-03`, `u1/${PM}-04`, `u2/${PM}-03`]);
  });

  it('the manifest routes both through restore-from-backup.js\'s subcollection path', () => {
    const man = JSON.parse(uploads.get('_manifest.json'));
    for (const parent of ['attendance', 'attendance_worker']) {
      const e = man.find((x) => x.parentCollection === parent && x.subcollection === 'records');
      assert.ok(e, `no manifest entry for ${parent}/*/records`);
      assert.equal(e.filename, `${parent}__records`);
    }
  });

  it('real documents and their subcollections are still exported', () => {
    assert.deepEqual(JSON.parse(uploads.get('clients.json')).map((d) => d.id), ['c1']);
    assert.deepEqual(JSON.parse(uploads.get('clients__comments.json')).map((d) => d.id), ['c1/k1']);
  });
});
