# Barro Industries — Full Setup Guide
## No Terminal Required. Everything Done in the Browser.

---

## OVERVIEW

You need to set up 2 free services:
1. **Firebase** — handles login and stores all your data
2. **Netlify** — hosts your website so your team can access it

Total time: ~20 minutes
Total cost: ₱0

---

## PART 1 — FIREBASE SETUP

### Step 1 — Create Your Firebase Project

1. Go to **https://console.firebase.google.com**
2. Sign in with your Google account
3. Click **"Add project"**
4. Name it: `barro-industries` → click Continue
5. Turn OFF Google Analytics → click **Create project**
6. Wait for it to finish → click **Continue**

---

### Step 2 — Enable Login (Authentication)

1. In the left menu → click **Authentication**
2. Click **"Get started"**
3. Click **"Email/Password"**
4. Toggle the first switch to **Enable**
5. Click **Save**

---

### Step 3 — Create the Database (Firestore)

1. In the left menu → click **Firestore Database**
2. Click **"Create database"**
3. Select **"Start in production mode"** → click Next
4. For location select **asia-southeast1 (Singapore)** → click **Enable**
5. Wait for it to finish

---

### Step 4 — Set Security Rules

1. Still in Firestore → click the **"Rules"** tab at the top
2. Select all the text in the editor and delete it
3. Paste the following rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId
                   || get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'owner';
    }

    match /tasks/{docId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null &&
        (resource.data.createdBy == request.auth.uid ||
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['owner','manager']);
    }

    match /tasks/{docId}/comments/{commentId} {
      allow read, create: if request.auth != null;
      allow delete: if request.auth.uid == resource.data.authorId;
    }

    match /submissions/{docId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['owner','manager'];
      allow delete: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'owner';
    }

    match /submissions/{docId}/comments/{commentId} {
      allow read, create: if request.auth != null;
      allow delete: if request.auth.uid == resource.data.authorId;
    }

    match /quotes/{docId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth.uid == resource.data.createdBy ||
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['owner','manager'];
      allow delete: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'owner';
    }

    match /policies/{docId} {
      allow read: if request.auth != null;
      allow write: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'owner';
    }

    match /departments/{docId} {
      allow read: if request.auth != null;
      allow write: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['owner','manager'];
    }
  }
}
```

4. Click **"Publish"**

---

### Step 5 — Add Your Team Members (Login Accounts)

Do this for yourself first, then repeat for each employee.

1. In Firebase → left menu → **Authentication** → **Users** tab
2. Click **"Add user"**
3. Enter their email and a temporary password
4. Click **Add user**
5. Repeat for each team member

> After their first login, their profile is auto-created. You can then set
> their role, salary, and department from your owner dashboard.

---

### Step 6 — Set Your Own Account as Owner

When you first log in to the app, your role defaults to "employee."
To make yourself owner:

1. In Firebase → **Firestore Database** → **Data** tab
2. Click the `users` collection
3. Find your document (it appears after your first login)
4. Click on your document → find the `role` field
5. Click the edit (pencil) icon → change value to `owner` → click Update

---

## PART 2 — DEPLOY TO NETLIFY

### Step 7 — Upload Your Files to Netlify

1. Go to **https://netlify.com**
2. Click **"Sign up"** → use your Google account
3. Once logged in, you'll see a dashboard with a drag-and-drop area
   that says **"drag and drop your site folder here"**
4. Open your **OneDrive → BARRO INDUSTRIES copy → Operation Systems Development** folder
5. Drag the entire **Operation Systems Development** folder into that Netlify box
6. Wait about 30 seconds
7. Netlify gives you a live URL like: `https://amazing-name-123.netlify.app`

That URL is your live system. Share it with your team.

---

### Step 8 — Rename Your Netlify URL (Optional)

The auto-generated URL looks random. To make it cleaner:

1. In Netlify dashboard → click your site
2. Click **"Site configuration"** → **"Change site name"**
3. Type something like `barro-industries-ops`
4. Your URL becomes: `https://barro-industries-ops.netlify.app`

---

### Step 9 — Allow Netlify URL in Firebase

This is important — Firebase needs to know your Netlify URL is allowed to use it.

1. Go back to **Firebase console** → **Authentication**
2. Click the **"Settings"** tab
3. Scroll to **"Authorized domains"**
4. Click **"Add domain"**
5. Type your Netlify URL (e.g. `barro-industries-ops.netlify.app`) → click Add

---

## PART 3 — PHONE APP SHORTCUT

### Step 10 — Install on Your Phone (No App Store Needed)

**Android (Chrome):**
1. Open your Netlify URL in Chrome on your phone
2. Tap the 3-dot menu (top right)
3. Tap **"Add to Home Screen"**
4. Tap **Add** — it now appears on your home screen like an app

**iPhone (Safari):**
1. Open your Netlify URL in Safari on your phone
2. Tap the Share button (box with arrow at the bottom)
3. Tap **"Add to Home Screen"**
4. Tap **Add**

---

## DONE! ✅

Your team can now:
- Log in from any phone, tablet, or computer
- Access their dashboard, tasks, and submissions
- Sales agents can build and send quotes
- You can see everything from your owner dashboard

---

## UPDATING THE APP IN THE FUTURE

When you want to make changes to the app:
1. Edit the files in your **Operation Systems Development** folder
2. Go back to Netlify → your site → **Deploys** tab
3. Drag and drop the folder again — it updates automatically

---

## COST SUMMARY

| Service | Plan | Cost |
|---|---|---|
| Firebase (Auth + Database) | Spark (Free) | ₱0 |
| Netlify (Hosting) | Free | ₱0 |
| Custom domain (optional) | — | ~₱800/year |
| **Total** | | **₱0** |

---

## GOOGLE DRIVE SETUP (Optional — for file storage in Drive)

By default, files are saved to Firebase Storage. If you want files to go directly into a shared Google Drive folder instead, follow these steps.

### Step 11 — Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project** → **New Project**
3. Name it `Barro Industries` → click **Create**
4. Make sure the new project is selected at the top

### Step 12 — Enable the Google Drive API

1. In the left menu go to **APIs & Services** → **Library**
2. Search for **Google Drive API** → click it → click **Enable**

### Step 13 — Create OAuth Client ID

1. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
2. If prompted, click **Configure Consent Screen** first:
   - Choose **External** → fill in App Name (`Barro Industries`), your email → Save
3. Back at Create Credentials → OAuth client ID:
   - Application type: **Web application**
   - Name: `Barro Industries Web`
   - Under **Authorized JavaScript origins**, click **Add URI** and enter your Netlify URL (e.g. `https://barro-industries.netlify.app`)
   - Click **Create**
4. Copy the **Client ID** (looks like `123456789-abc.apps.googleusercontent.com`) — you'll need it in Step 16

### Step 14 — Create an API Key

1. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **API Key**
2. Copy the key
3. Click **Edit API Key** → under **API restrictions** select **Restrict key** → choose **Google Drive API** → Save

### Step 15 — Create a Shared Drive Folder

1. Go to [drive.google.com](https://drive.google.com)
2. Click **New** → **New folder** → name it `Barro Industries - Operations`
3. Right-click the folder → **Share** → add your employees' Google accounts with **Editor** access
4. Open the folder and copy the **Folder ID** from the URL:
   - URL looks like: `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWx`
   - Copy the long ID after `/folders/`

### Step 16 — Enable Drive in config.js

Open `js/config.js` in your Operation Systems Development folder and update the top section:

```javascript
window.DRIVE_CONFIG = {
  CLIENT_ID:    'PASTE_YOUR_CLIENT_ID_HERE',
  API_KEY:      'PASTE_YOUR_API_KEY_HERE',
  FOLDER_ID:    'PASTE_YOUR_FOLDER_ID_HERE',
  SCOPES:       'https://www.googleapis.com/auth/drive.file',
  DRIVE_ENABLED: true   // Change false to true
};
```

Then redeploy to Netlify (drag and drop the folder again).

Files uploaded in the app will now go into your shared Google Drive folder, organized by department automatically.
