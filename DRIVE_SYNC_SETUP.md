# Google Drive Sync Setup — Barro Industries

Two automated jobs keep Google Drive in sync with Firebase:

---

## 1. Daily File Sync (12:00 AM every night)

**Workflow:** `.github/workflows/sync-to-drive.yml`
**Script:** `scripts/sync-to-drive.js`

Scans all Firestore collections for Firebase Storage file URLs and uploads any
new files to Google Drive. Already-synced files are skipped (no duplicates).

### Drive folder structure created:
```
BI-Operations/
└── Files/
    ├── Tasks/             ← task attachments
    ├── Task Messages/     ← file attachments in task comment threads
    ├── Posts/             ← post images and file attachments
    ├── Submissions/       ← submission attachments
    ├── Resources/         ← resource files
    ├── Memos/             ← memo attachments
    └── Quotes/            ← quote attachments
```

---

## 2. Monthly Data Backup (12:01 AM on the 1st of each month)

**Workflow:** `.github/workflows/monthly-backup.yml`
**Script:** `scripts/monthly-backup.js`

Exports ALL Firestore data from the previous month as JSON + CSV files
to Google Drive. This is your permanent record of all operations data.

### Drive folder structure created:

Every non-ephemeral Firestore collection is snapshotted to JSON automatically
via `db.listCollections()` — there is no hand-maintained list, so a brand new
collection added anywhere in the app (e.g. a future `pay_runs`, `it_tickets`,
or `aec_contacts`) is backed up the very next run with zero code change.
`_manifest.json` records the file → collection map (this is also what
`restore-from-backup.js` reads to know what each JSON file is). A small set of
collections — the ones with a `createdAt`/date field worth filtering by
previous-month, or that also want a flattened CSV — get extra handling via the
`OVERRIDES` map in `scripts/monthly-backup.js`; everything else exports as a
complete full-document JSON with no CSV. `EXCLUDE` in the same file lists the
few ephemeral/huge collections (`presence`, `sessions`, `notifications`) that
are deliberately never snapshotted.

```
BI-Operations/
└── Monthly Backups/
    └── YYYY-MM/           ← e.g. 2026-05
        ├── _manifest.json         ← file → collection map (drives restore)
        ├── _summary.txt           ← record counts + run info
        ├── attendance.json/.csv
        ├── tasks.json/.csv
        ├── task_messages.json     ← all task thread messages
        ├── cash_advances.json/.csv
        ├── salary_history.json/.csv
        ├── kpi_evaluations.json/.csv
        ├── users.json/.csv
        ├── posts.json/.csv
        ├── payroll_overrides.json
        ├── attendance_extensions.json
        ├── suggestions.json
        └── <every other collection>.json   ← pay_runs, approval_requests,
                                                it_*, kpi_targets, sales_orders,
                                                audit_log, _counters, products,
                                                files_*, budgets_*, …
```

---

## 3. Restore from Backup (manual, dispatch-only)

**Workflow:** `.github/workflows/restore.yml`
**Script:** `scripts/restore-from-backup.js`

Reads a monthly backup's `_manifest.json` back out of Drive and writes the
documents back into Firestore with `merge:true`. Never runs on a schedule —
only via **Actions → "Restore Firestore from Backup" → Run workflow**, with
three inputs:

| Input | Meaning |
|---|---|
| `month` | Which backup to restore from, e.g. `2026-06` |
| `collection` | Optional — restore only this one collection; blank = every collection in that month's backup |
| `commit` | Must be typed exactly `1` to actually write. Anything else (including blank/default `0`) is a **dry run** — it lists what it would do and writes nothing |

Notes:
- `_counters` (e.g. `_counters/employees`) is never blind-overwritten — it is
  reconciled to `max(current value, restored value)` so a restore can never
  wind an employee-ID sequence backwards and mint a duplicate ID later.
- ISO-8601 date strings in the JSON are revived back into real Firestore
  Timestamps on write.
- `attendance` (a subcollection) and `tasks/task-comments`
  (`task_messages.json`) are NOT flat collections and are skipped by this
  script — restore those two by hand from their JSON if ever needed.
- Always dry-run first (`commit` left as `0`) and read the console output
  before re-running with `commit=1`.

---

## Required GitHub Secrets

All 5 secrets must be set at: **GitHub repo → Settings → Secrets → Actions**

| Secret | What it is |
|--------|------------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK JSON key (stringified, from Firebase Console → Project Settings → Service accounts) |
| `GOOGLE_SERVICE_ACCOUNT` | Google Drive service account JSON key (stringified, from Google Cloud Console) |
| `DRIVE_FOLDER_ID` | The ID of your `BI-Operations` folder in Google Drive (from the URL: `drive.google.com/drive/folders/THIS_PART`) |
| `FIREBASE_PROJECT_ID` | `barro-industries` |
| `FIREBASE_STORAGE_BUCKET` | `barro-industries.firebasestorage.app` |

---

## Drive files are private by default

Every file uploaded by either job — daily-synced attachments AND the monthly
JSON/CSV backup dumps — is uploaded **private** (no "Anyone with the link"
sharing). Drive is a cold archive/off-site mirror only; the app never links
directly to a Drive URL for in-app downloads (task attachments, drawing
files, etc. — see `js/departments.js`) — it always opens the original
Firebase Storage URL, which was the app's serving path even before this
change. `uploadBuffer()` in `scripts/drive-lib.js` takes an opt-in
`{ public: true }` option for the rare case something should be public-by-link
in the future, but nothing in this repo passes it today.

---

## Backup/sync health monitoring

Both jobs write a heartbeat doc to Firestore after every run:
`system_health/daily_sync` and `system_health/monthly_backup`
(`{ job, lastRunAt, lastStatus: 'ok'|'error', errors, filesWritten, durationSec, ... }`).
Finance/admin roles (President, manager, secretary, finance) see a dismissible
in-app red banner if a job hasn't reported in (daily sync stale after 30h,
monthly backup stale after 34 days) or its last run had errors — see
`checkBackupHealth()` in `js/app.js`. `firestore.rules` locks writes to the
Admin SDK only (`allow write: if false`); GitHub Actions bypasses rules via
the service-account credential, so the client never writes this collection.

---

## Why files aren't showing in Drive yet

The GitHub Actions workflows run on schedule, but they won't work until all 5 secrets above are added to the repo. Once secrets are set:

1. Go to **GitHub repo → Actions → "Daily File Sync"** → click **Run workflow** to test immediately
2. Go to **Actions → "Monthly Firestore → Google Drive Backup"** → click **Run workflow** to run the first backup immediately

Both workflows can always be triggered manually — you don't have to wait for the schedule.

---

## Manual test (local)

```bash
cd scripts
npm install

# File sync
FIREBASE_SERVICE_ACCOUNT='...' GOOGLE_SERVICE_ACCOUNT='...' DRIVE_FOLDER_ID='...' \
FIREBASE_PROJECT_ID='barro-industries' FIREBASE_STORAGE_BUCKET='barro-industries.firebasestorage.app' \
npm run sync

# Monthly backup
FIREBASE_SERVICE_ACCOUNT='...' GOOGLE_SERVICE_ACCOUNT='...' DRIVE_FOLDER_ID='...' \
FIREBASE_PROJECT_ID='barro-industries' FIREBASE_STORAGE_BUCKET='barro-industries.firebasestorage.app' \
npm run backup
```
