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
```
BI-Operations/
└── Monthly Backups/
    └── YYYY-MM/           ← e.g. 2026-05
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
        └── suggestions.json
```

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
