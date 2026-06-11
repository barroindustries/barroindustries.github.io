# Barro Industries — Publishing Guide
## Hosting: Netlify (Recommended) or GitHub Pages

---

## 🚀 Netlify Setup (Faster CDN + Auto-Optimized)

Netlify is faster than GitHub Pages for this app due to its global CDN, Brotli compression, and proper cache headers. The `netlify.toml` file in this repo is already configured.

### Connect to Netlify (one-time, 5 minutes)

1. Go to **https://app.netlify.com** → Sign up / log in with GitHub
2. Click **"Add new site"** → **"Import an existing project"**
3. Choose **GitHub** → Authorize → Select `neilbarro/Operation-Systems-Development`
4. Settings:
   - **Branch**: `main`
   - **Build command**: *(leave blank)*
   - **Publish directory**: `.` *(dot = repo root)*
5. Click **Deploy site**
6. Netlify will give you a URL like `https://barro-ops.netlify.app`
7. Go to **Domain settings** → add a custom domain if desired

### Auto-deploy on push

Every `git push` to `main` automatically deploys. No action needed.

### Performance features enabled by `netlify.toml`:
- JS & CSS automatically minified
- Images compressed
- 1-year cache on all static assets
- Brotli compression on all text files
- SPA routing (no broken URLs when refreshing)

---

## GitHub Pages (Legacy)

## Why Firebase?

| Feature | Firebase Free (Spark) |
|---|---|
| Authentication (login) | Unlimited users |
| Database (Firestore) | 1 GB storage, 50K reads/day |
| File Hosting | 10 GB, 360 MB/day bandwidth |
| Custom Domain | ✅ Free |
| SSL/HTTPS | ✅ Auto |
| Monthly Cost | **₱0** |

Firebase is Google-owned, reliable, and free for teams of your size.

---

## Step 1 — Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **"Add project"** → Name it `barro-industries-ops`
3. Disable Google Analytics (not needed) → **Create project**
4. In the left menu → **Authentication** → **Get started**
   - Enable **Email/Password** provider
5. In the left menu → **Firestore Database** → **Create database**
   - Choose **"Start in production mode"**
   - Pick a region (e.g., `asia-southeast1` for Philippines)
6. In the left menu → **Hosting** → **Get started** (follow the CLI steps below)

---

## Step 2 — Get Your Firebase Config

1. In Firebase console → **Project Settings** (gear icon ⚙️)
2. Scroll to **"Your apps"** → Click **"Add app"** → Web (`</>`)
3. Register app name: `BI Ops Web`
4. Copy the config object shown — it looks like:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "barro-industries-ops.firebaseapp.com",
  projectId: "barro-industries-ops",
  storageBucket: "barro-industries-ops.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

5. Open `js/firebase-config.js` in your code and **replace** the placeholder values with your real config.

---

## Step 3 — Set Firestore Security Rules

In Firebase console → Firestore → **Rules**, paste this:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can read/write their own profile
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId
                   || get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'owner';
    }

    // Owners and managers can do everything; others can read + create
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

    // Owners only for policies and departments
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

---

## Step 4 — Deploy to Firebase Hosting

### Install Firebase CLI
```bash
npm install -g firebase-tools
```

### Login and init
```bash
firebase login
firebase init hosting
```

When prompted:
- **Project**: Select `barro-industries-ops`
- **Public directory**: type `.` (current folder)
- **Single-page app**: No
- **Overwrite index.html**: No

### Deploy
```bash
firebase deploy
```

Your app will be live at:
`https://barro-industries-ops.web.app`

---

## Step 5 — Add Your Team Members

In Firebase console → **Authentication** → **Users** → **Add user**:
- Enter email + temporary password for each employee
- They can reset their password on first login

After they log in for the first time, their profile is auto-created in Firestore.
You (as owner) can then edit their salary, role, and department from the Dashboard.

---

## Step 6 — Custom Domain (Optional but Professional)

If you want `ops.barroindustries.com` instead of the Firebase subdomain:

1. Firebase Hosting → **Add custom domain**
2. Enter your domain
3. Firebase gives you DNS records to add to your domain registrar (GoDaddy, Namecheap, etc.)
4. SSL is automatic and free

---

## Step 7 — Phone App Shortcut (PWA)

The app is already set up as a **Progressive Web App**. No app store needed.

**On Android (Chrome):**
1. Open the app URL in Chrome
2. Tap the 3-dot menu → **"Add to Home Screen"**
3. It installs like an app with your BI icon

**On iPhone (Safari):**
1. Open the URL in Safari
2. Tap the Share button → **"Add to Home Screen"**
3. Tap **Add**

It will appear on your home screen and open fullscreen like a native app.

---

## Step 8 — GitHub Private Repo (Version Control + Security)

Keep your code safe and backed up:

```bash
# In the "Operation Systems Development" folder:
git init
git add .
git commit -m "Initial: Barro Industries Ops System"

# Create a PRIVATE repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/bi-ops.git
git push -u origin main
```

> ⚠️ **IMPORTANT:** Never commit real Firebase API keys to a public repo.
> Your repo should be **Private**. The Firebase API key is safe to include
> in client-side code for a private app — Firebase Security Rules protect
> your data, not the API key itself.

---

## Ongoing: Auto-Deploy with GitHub Actions (Optional)

Connect GitHub to Firebase for automatic deploys on every push:

```bash
firebase init hosting:github
```

Follow the prompts. After setup, every `git push` to `main` automatically
deploys your latest code. Free with Firebase + GitHub.

---

## Cost Summary

| Service | Cost |
|---|---|
| Firebase Hosting | Free |
| Firebase Auth | Free |
| Firestore Database | Free |
| GitHub Private Repo | Free |
| Custom Domain (if bought) | ~$10-15/year |
| **Total** | **₱0 – ₱850/year** |

---

## App Icons

Replace the placeholder icons in the `/icons/` folder:
- `icon-192.png` — 192×192 px PNG
- `icon-512.png` — 512×512 px PNG

Use a BI logo with dark blue background for best results on phones.
You can generate these free at: https://realfavicongenerator.net
