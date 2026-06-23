/**
 * BARRO INDUSTRIES — One-time Google Drive OAuth token generator
 * scripts/get-drive-token.js
 *
 * Run this ONCE, locally, to mint the refresh token the nightly sync uses to
 * upload files to Drive AS YOU (using your own ~15 GB Drive quota — which is
 * how we sidestep the "service accounts have no storage quota" wall on a
 * personal @gmail.com account).
 *
 * Prerequisites (Google Cloud Console, project where the APIs live):
 *   1. APIs & Services → Library → enable "Google Drive API".
 *   2. APIs & Services → OAuth consent screen → External →
 *      add the Drive scope (.../auth/drive), add yourself, then PUBLISH the app
 *      ("In production"). Publishing keeps the refresh token from expiring
 *      after 7 days. (You'll see an "unverified app" warning — that's fine,
 *      click Advanced → Go to … (unsafe); it's your own app.)
 *   3. APIs & Services → Credentials → Create credentials →
 *      OAuth client ID → "Desktop app". Copy the Client ID + Client secret.
 *
 * Then run (from the scripts/ folder, after `npm install`):
 *
 *   GOOGLE_OAUTH_CLIENT_ID=xxx GOOGLE_OAUTH_CLIENT_SECRET=yyy node get-drive-token.js
 *
 * Sign in as the account that owns the Drive folder. The script prints the
 * three values to store as GitHub repo secrets:
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN
 */

'use strict';

const http  = require('http');
const { exec } = require('child_process');
const { google } = require('googleapis');

const CLIENT_ID     = (process.env.GOOGLE_OAUTH_CLIENT_ID || process.argv[2] || '').trim();
const CLIENT_SECRET = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.argv[3] || '').trim();
const PORT          = 4517;
const REDIRECT      = `http://localhost:${PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌ Missing client credentials.');
  console.error('   Usage: GOOGLE_OAUTH_CLIENT_ID=xxx GOOGLE_OAUTH_CLIENT_SECRET=yyy node get-drive-token.js');
  console.error('   (or)   node get-drive-token.js <client_id> <client_secret>\n');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',                                   // force a refresh_token every time
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/?')) { res.end('ok'); return; }
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  try {
    const { tokens } = await oauth2.getToken(code);
    res.end('✅ Authorised. You can close this tab and return to the terminal.');
    server.close();

    if (!tokens.refresh_token) {
      console.error('\n⚠️  Google did not return a refresh token. Revoke prior access at');
      console.error('   https://myaccount.google.com/permissions and run this again.\n');
      process.exit(1);
    }

    console.log('\n✅ Success! Add these three GitHub repo secrets');
    console.log('   (Settings → Secrets and variables → Actions):\n');
    console.log(`   GOOGLE_OAUTH_CLIENT_ID      = ${CLIENT_ID}`);
    console.log(`   GOOGLE_OAUTH_CLIENT_SECRET  = ${CLIENT_SECRET}`);
    console.log(`   GOOGLE_OAUTH_REFRESH_TOKEN  = ${tokens.refresh_token}\n`);
    console.log('   Then the nightly sync will upload to Drive as your account.\n');
    process.exit(0);
  } catch (e) {
    res.end('Error: ' + e.message);
    console.error('\n❌ Token exchange failed:', e.message, '\n');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('\n🔐 Opening your browser to authorise Google Drive access…');
  console.log('   If it does not open, paste this URL manually:\n');
  console.log('   ' + authUrl + '\n');
  const opener = process.platform === 'darwin' ? 'open'
               : process.platform === 'win32'  ? 'start ""'
               : 'xdg-open';
  exec(`${opener} "${authUrl}"`, () => {});
});
