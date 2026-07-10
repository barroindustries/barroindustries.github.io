/**
 * BARRO INDUSTRIES — Shared Google Drive helpers
 * scripts/drive-lib.js
 *
 * Used by sync-to-drive.js and monthly-backup.js.
 *
 * Two things this module guarantees that the old inline code did not:
 *   1. supportsAllDrives / includeItemsFromAllDrives on EVERY Drive call,
 *      so a Shared Drive (Team Drive) folder works. A Shared Drive is the
 *      correct destination because a service account has NO personal
 *      "My Drive" storage quota — uploads into My Drive fail with
 *      "Service Accounts do not have storage quota." Shared Drives pool
 *      storage and let the service account own files.
 *   2. A startup preflight() that fails LOUD with the exact fix, instead of
 *      the cryptic "File not found: ." you get when the folder reference is
 *      empty / wrong / not shared with the service account.
 */

'use strict';

const { google }   = require('googleapis');
const { Readable } = require('stream');

// Flags that make every call work for BOTH My Drive and Shared Drives.
const SHARED      = { supportsAllDrives: true };
const SHARED_LIST = { supportsAllDrives: true, includeItemsFromAllDrives: true };

// ── Env validation ──────────────────────────────────────────────────────────
function requireEnv(name) {
  const v = (process.env[name] || '').trim();
  if (!v) {
    console.error(`\n❌ CONFIG ERROR: GitHub secret "${name}" is missing or empty.`);
    console.error(`   Set it under: repo → Settings → Secrets and variables → Actions → New repository secret.`);
    process.exit(2);
  }
  return v;
}

// ── Init Drive — two supported auth modes ────────────────────────────────────
//
//  OAuth user credentials (preferred for a personal @gmail.com):
//    set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN.
//    Files are owned by the real user, using their ~15 GB Drive quota — so a
//    plain My-Drive folder works and there is no service-account quota wall.
//    (Generate the refresh token once with: node scripts/get-drive-token.js)
//
//  Service account (only works with a Shared Drive — needs Google Workspace):
//    set GOOGLE_SERVICE_ACCOUNT. A service account has no My-Drive quota, so
//    the destination MUST be inside a Shared Drive the SA can write to.
//
//  OAuth wins if a refresh token is present; otherwise we fall back to the SA.
function initDrive() {
  const refreshToken = (process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();

  if (refreshToken) {
    const clientId     = requireEnv('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = requireEnv('GOOGLE_OAUTH_CLIENT_SECRET');
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return {
      drive: google.drive({ version: 'v3', auth: oauth2 }),
      authMode: 'oauth',
      ownerLabel: 'OAuth user account (uses that user\'s Drive quota)',
    };
  }

  const raw = requireEnv('GOOGLE_SERVICE_ACCOUNT');
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    console.error(`\n❌ CONFIG ERROR: GOOGLE_SERVICE_ACCOUNT is not valid JSON (${e.message}).`);
    console.error(`   Paste the WHOLE service-account JSON file as the secret value.`);
    process.exit(2);
  }
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return {
    drive: google.drive({ version: 'v3', auth }),
    authMode: 'service_account',
    ownerLabel: creds.client_email || '(unknown — check the JSON)',
  };
}

// ── Preflight: prove we can actually write to the root folder ────────────────
// Exits the process (code 2) with a precise fix if anything is wrong.
async function preflight(drive, rootFolderId, authMode, ownerLabel) {
  const isOAuth = authMode === 'oauth';
  console.log(`\n🔧 Drive preflight`);
  console.log(`   Auth mode       : ${isOAuth ? 'OAuth user credentials ✅' : 'service account'}`);
  console.log(`   Uploading as    : ${ownerLabel}`);
  console.log(`   DRIVE_FOLDER_ID : ${rootFolderId}`);

  // A bare folder ID has no slash/scheme/space. A pasted URL or quoted value is the usual mistake.
  if (/https?:\/\/|drive\.google\.com|[\/?#\s'"]/.test(rootFolderId)) {
    console.error(`\n❌ CONFIG ERROR: DRIVE_FOLDER_ID looks like a URL or has stray characters.`);
    console.error(`   Use ONLY the bare id — the part after /folders/ in the Drive URL.`);
    console.error(`   e.g. for  https://drive.google.com/drive/folders/1AbC...XyZ`);
    console.error(`        set   DRIVE_FOLDER_ID = 1AbC...XyZ   (no quotes, no spaces)`);
    process.exit(2);
  }

  try {
    const res = await drive.files.get({
      fileId: rootFolderId,
      fields: 'id,name,mimeType,driveId,trashed,capabilities(canAddChildren)',
      ...SHARED,
    });
    const f = res.data;

    if (f.mimeType !== 'application/vnd.google-apps.folder') {
      console.error(`\n❌ DRIVE_FOLDER_ID points at "${f.name}", which is not a folder.`);
      process.exit(2);
    }
    if (f.trashed) {
      console.error(`\n❌ The folder "${f.name}" is in the Trash. Restore it (or use a live folder).`);
      process.exit(2);
    }

    const isShared = !!f.driveId;
    console.log(`   ✓ Folder reachable: "${f.name}" ${isShared ? '(Shared Drive ✅)' : '(personal My Drive ⚠️)'}`);

    if (f.capabilities && f.capabilities.canAddChildren === false) {
      console.error(`\n❌ Can SEE "${f.name}" but cannot ADD files to it.`);
      if (isOAuth) {
        console.error(`   → Sign in for the refresh token as a user who can edit this folder.`);
      } else {
        console.error(`   → Share the folder with ${ownerLabel}`);
        console.error(`     and set its access to "Editor" (My Drive) / "Content manager" (Shared Drive).`);
      }
      process.exit(2);
    }

    // The My-Drive quota wall only applies to service accounts. OAuth uploads
    // as a real user, so a personal My-Drive folder is perfectly fine.
    if (!isShared && !isOAuth) {
      console.warn(`\n⚠️  "${f.name}" is in a personal My Drive, not a Shared Drive.`);
      console.warn(`   Service accounts have NO My-Drive storage quota, so file uploads may fail with`);
      console.warn(`   "Service Accounts do not have storage quota." If you see that below, either:`);
      console.warn(`     • switch to OAuth (set GOOGLE_OAUTH_* secrets — works on a personal Gmail), or`);
      console.warn(`     • move the folder into a Shared Drive (needs Google Workspace) and add`);
      console.warn(`       ${ownerLabel} as a "Content manager".`);
    }

    return { isShared, name: f.name };
  } catch (e) {
    const code = e.code || (e.response && e.response.status) || '?';
    console.error(`\n❌ Drive cannot open folder id "${rootFolderId}" (HTTP ${code}): ${e.message}`);
    if (isOAuth) {
      console.error(`   → Check DRIVE_FOLDER_ID is the bare id (after /folders/) and that the`);
      console.error(`     account you authorised can open that folder.`);
    } else {
      console.error(`   The usual causes:`);
      console.error(`   1) Not shared with the service account → Drive → Share → add ${ownerLabel}.`);
      console.error(`   2) Wrong id → DRIVE_FOLDER_ID must be the bare id after /folders/ in the URL.`);
      console.error(`   3) Shared Drive but the SA isn't a member → add ${ownerLabel} to the Shared Drive.`);
    }
    process.exit(2);
  }
}

// ── Folder management (cached) ───────────────────────────────────────────────
const folderCache = {};
function escQ(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

async function ensureFolder(drive, name, parentId) {
  const key = `${parentId}::${name}`;
  if (folderCache[key]) return folderCache[key];

  const res = await drive.files.list({
    q: `name='${escQ(name)}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id)',
    ...SHARED_LIST,
  });
  if (res.data.files.length > 0) {
    folderCache[key] = res.data.files[0].id;
    return folderCache[key];
  }

  const folder = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    ...SHARED,
  });
  folderCache[key] = folder.data.id;
  return folderCache[key];
}

async function makePublic(drive, fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      ...SHARED,
    });
  } catch (_) { /* non-fatal — Shared Drive admins may disable link sharing */ }
}

// Upload a Buffer; returns the webViewLink. Files are PRIVATE by default
// (Drive = cold archive). Pass { public:true } only for deliberately
// low-sensitivity, shareable content — nothing in this repo does today.
async function uploadBuffer(drive, buffer, filename, mimeType, folderId, { public: isPublic = false } = {}) {
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media:       { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
    fields:      'id,webViewLink',
    ...SHARED,
  });
  if (isPublic) await makePublic(drive, res.data.id);
  return res.data.webViewLink;
}

module.exports = {
  SHARED, SHARED_LIST,
  requireEnv, initDrive, preflight, ensureFolder, makePublic, uploadBuffer,
};
