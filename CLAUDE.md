# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Barro Industries' internal **Operations System** — a vanilla-JS Progressive Web App (no framework, no bundler, no build step). Files are served as-is. The frontend talks directly to Firebase (Auth, Firestore, Storage, Cloud Messaging); a Cloud Function relays push notifications; GitHub Actions handle nightly Drive sync and monthly backups.

The app is an internal tool for a Philippine steel/appliance manufacturer: employees, managers, the president, and an external partner (Brilliant Steel) sign in to role- and department-scoped tabs covering tasks, finance/payroll, attendance, cash advances, sales quotes, government biddings, and more.

## Critical workflow rules

- **Bump `CACHE_VER` in [sw.js](sw.js) on every JS/CSS edit.** The service worker caches static assets aggressively (cache-first / stale-while-revalidate). If you edit a `.js`/`.css` file without bumping `CACHE_VER` (e.g. `bi-ops-v16` → `v17`), users get stale code and the change appears broken/not deployed.
- **Version is auto-bumped on commit.** A `.git/hooks/pre-commit` hook increments the patch in `window.APP_VERSION` in [js/config.js](js/config.js) and rewrites the `vX.Y.Z` strings in [index.html](index.html), then re-stages both. Do not hand-edit the version. (The comment in config.js referencing `scripts/bump-version.sh` is stale — the live hook is `.git/hooks/pre-commit`.) `CACHE_VER` in sw.js is now derived from `APP_VERSION` (`bi-ops-vX.Y.Z`) rather than bumped as an independent counter. A tracked copy of the hook lives at [.githooks/pre-commit](.githooks/pre-commit) with hardening (loud `exit 1` on grep misses, amend-safe skip guard) — run `git config core.hooksPath .githooks` once per clone to use it.
- **Script load order is load-bearing.** [index.html](index.html) loads all scripts with `defer` in a fixed order: Firebase SDK + Chart.js + Lucide → `firebase-config.js` → `config.js` → `drive.js` → `notifications.js` → `departments.js` → `app.js` → `modules.js`. Everything communicates through `window.*` globals; there are no ES module imports. A function must be defined (attached to `window`) before a later script calls it. If you add a file, add it to both index.html and the `PRECACHE` list in sw.js.

## Commands

There is no build or test suite. This is a static site.

- **Run locally:** `npx serve -p 3838 .` (serves the app) or `npx serve -p 3737 .` (quote-builder). See [.claude/launch.json](.claude/launch.json). A real server is required — `file://` breaks the service worker, Firebase auth domains, and module fetches.
- **Deploy the app:** `git push origin master`. Auto-deploys to **GitHub Pages** at `barroindustries.github.io` (remote: `https://github.com/barroindustries/barroindustries.github.io.git`). The current branch is `master`. No CI gate. **Not Netlify.**
- **Deploy Firestore rules/indexes:** `firebase deploy --only firestore` (project `barro-industries`, see [.firebaserc](.firebaserc)).
- **Deploy Cloud Functions:** `cd functions && npm run deploy` (= `firebase deploy --only functions`, Node 22).
- **Sync/backup scripts** (normally run by GitHub Actions, not locally): `cd scripts && npm run sync` / `npm run backup`. They need service-account env vars (`FIREBASE_SERVICE_ACCOUNT`, `GOOGLE_SERVICE_ACCOUNT`, `DRIVE_FOLDER_ID`, etc.).

## Architecture

### Frontend — global-function modules

All UI lives in plain `<script>` files under `js/`, each attaching render functions to `window`. There is no router library: [js/app.js](js/app.js) holds `navigateTo(page)` with a big `switch` that calls the matching `render*` function, which writes HTML into `#page-content`.

- **[js/app.js](js/app.js)** (~5600 lines) — core: auth state machine (`auth.onAuthStateChanged`), login/role-gating, nav building, the `navigateTo` router, dashboard, approvals, presence heartbeat, auto-logout, president-triggered force-logout, the quote-builder iframe host.
- **[js/departments.js](js/departments.js)** (~6500 lines) — per-department screens: `renderTasks`, `renderFinance` (payroll/payslips), `renderSales`, `renderIT`, `renderDesign`, `renderBrilliantSteel`, `renderGovBiddings`, `renderApprovals`, plus shared doc/file collection renderers.
- **[js/modules.js](js/modules.js)** — extended features: Posts feed, Team directory, Attendance (with PH holidays), Cash Advance, Company Overview.
- **[js/config.js](js/config.js)** — `APP_VERSION`, `DEPARTMENTS`, `ROLES`, the per-role `*_BOTTOM_NAV` arrays, feature-flag configs (Drive/Sheets/EmailJS/FCM), and `window.dbCachedGet(key, fetcher, ttlMs)` — a small in-memory Firestore read cache used throughout to avoid refetching collections on every navigation (invalidate with `dbCacheInvalidate`).
- **[js/firebase-config.js](js/firebase-config.js)** — initializes Firebase, exposes globals `auth`, `db`, `storage`. Sets LOCAL auth persistence (10-day sessions so background push survives) and enables Firestore IndexedDB offline persistence (feature-detected).
- **[js/notifications.js](js/notifications.js)** — `window.Notifs` IIFE: in-app notification inbox, toasts (`Notifs.showToast`), FCM push registration, deadline/attendance reminders. Writing a doc to `notifications/{uid}/items/{id}` is the cross-user "send" mechanism.
- **[js/drive.js](js/drive.js)** — `window.Drive`: uploads go to Firebase Storage immediately (no employee Google OAuth); a nightly GitHub Action mirrors them to Google Drive and rewrites Firestore links.

### Roles & departments

Roles (`president`, `manager`, `employee`, `agent`, `finance`, `partner`) and departments (Admin, Finance, Sales, Marketing, Government Biddings, IT, Design, Brilliant Steel, Partners) are defined in [js/config.js](js/config.js). Nav, bottom-nav, and page access are derived from `currentRole` + `currentDepts` (a user can belong to multiple departments). The president (`neilbarro870@gmail.com`) has full access; `canEditDept(dept)` in departments.js gates writes (admin roles, or membership in that dept). The login screen enforces a portal/role match (admin/employee/partner) — see `ROLE_TYPE_MAP` in app.js.

### Backend — Firebase

- **Firestore** is the database; the frontend reads/writes directly. Security is enforced by [firestore.rules](firestore.rules) (role lookups via `get(users/{uid}).role`, owner checks, admin/finance/president tiers). Composite indexes live in [firestore.indexes.json](firestore.indexes.json). **When you add a query that needs a composite index or change access patterns, update these files and `firebase deploy --only firestore`.**
- **Cloud Functions** ([functions/index.js](functions/index.js)) — single trigger `sendPushOnNotification`: on a new `notifications/{uid}/items/{itemId}` doc, look up the user's `fcmToken` and send an FCM web-push. Prunes invalid tokens.
- **Service worker** handles offline shell caching ([sw.js](sw.js)); [firebase-messaging-sw.js](firebase-messaging-sw.js) handles background push display.

### Standalone tools

- **[quote-builder-v2.html](quote-builder-v2.html)** — a large self-contained HTML quote calculator for Brilliant Steel / Barro Kitchen products, embedded via `<iframe>` from the Sales/Partners tabs. Product data comes from [products-database.json](products-database.json). (`quote-builder.html` is the older v1, read-only.)
- **archive/Barro_Operations_Tracker.html** — superseded June-2026 standalone dashboard (moved to `archive/`, v13 Phase 5); live equivalents are the in-app Gov Biddings screen and the `clients` collection.

### Automation (GitHub Actions, `.github/workflows/`)

- `sync-to-drive.yml` — daily Firebase Storage → Google Drive mirror.
- `monthly-backup.yml` — monthly Firestore export to Drive.
- `keepalive.yml` — monthly commit so GitHub doesn't auto-disable the scheduled workflows.

## Conventions

- **Always escape user content** before inserting into `innerHTML` — use `escHtml()` (modules.js). HTML is built with template strings throughout.
- Currency/dates are Philippine-locale (`en-PH`, PHP). Helpers `fmt()`/`fmtN()` format peso amounts; `today()` returns ISO date.
- Icons are [Lucide](https://lucide.dev) via `<i data-lucide="name">` (call `lucide.createIcons()` after injecting). Charts use Chart.js.
- New department screens follow the existing pattern: a `window.renderX` function that renders into `deptContainer()` (`#page-content`), gated by `canEditDept`, wired into the `navigateTo` switch in app.js and the nav builders.
