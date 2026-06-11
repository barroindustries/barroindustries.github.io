# Google Drive Sync Setup
## One-time setup — takes about 15 minutes

---

## How It Works

1. Employees upload files → instantly saved to Firebase Cloud Storage
2. Every night at **12:00 AM (Philippine Time)**, a GitHub Action runs automatically
3. It downloads all unsynced files from Firebase and uploads them to your Google Drive
4. Links in the app update to Google Drive links

---

## Step 1 — Create a Firebase Service Account

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → your `barro-industries` project
2. Click the gear icon ⚙️ → **Project Settings** → **Service Accounts** tab
3. Click **Generate new private key** → **Generate Key**
4. A JSON file downloads — keep it safe, don't share it

---

## Step 2 — Create a Google Drive Service Account

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Select the same project (`barro-industries`) or create a new one
3. Go to **APIs & Services** → **Library** → search **Google Drive API** → Enable it
4. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **Service Account**
   - Name: `bi-drive-sync`
   - Click **Create and Continue** → **Done**
5. Click on the new service account → **Keys** tab → **Add Key** → **Create new key** → JSON
6. A JSON file downloads

---

## Step 3 — Share Your Google Drive Folder With the Service Account

1. Create a folder in your Google Drive called **BI-Operations**
2. Right-click the folder → **Share**
3. Paste the service account email (looks like `bi-drive-sync@your-project.iam.gserviceaccount.com`)
4. Set permission to **Editor** → Share
5. Copy the folder ID from the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART_IS_THE_FOLDER_ID`**

---

## Step 4 — Add GitHub Secrets

1. Go to [github.com/barroindustries/barroindustries.github.io](https://github.com/barroindustries/barroindustries.github.io)
2. Click **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these 5 secrets:

| Secret Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Paste the entire contents of the Firebase JSON key file |
| `GOOGLE_SERVICE_ACCOUNT` | Paste the entire contents of the Google Drive JSON key file |
| `DRIVE_FOLDER_ID` | The folder ID from Step 3 |
| `FIREBASE_PROJECT_ID` | `barro-industries` |
| `FIREBASE_STORAGE_BUCKET` | `barro-industries.appspot.com` |

---

## Step 5 — Test It

1. Go to [github.com/barroindustries/barroindustries.github.io/actions](https://github.com/barroindustries/barroindustries.github.io/actions)
2. Click **Nightly Firebase → Google Drive Sync**
3. Click **Run workflow** → **Run workflow**
4. Watch the logs — it should show files being synced

After it runs, check your Google Drive **BI-Operations** folder — files should appear there organized by department.

---

## Schedule

The sync runs automatically every night at **12:00 AM Philippine Time**.
You can also trigger it manually anytime from the GitHub Actions tab.

---

## What Happens to Links

- **Before sync**: File link points to Firebase Cloud Storage (cloud icon ☁️)
- **After sync**: File link updates to Google Drive (drive icon 📁)
- Employees always see the correct link — it updates automatically in the app
