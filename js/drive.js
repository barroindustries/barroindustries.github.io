/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Google Drive Integration
   drive.js
═══════════════════════════════════════════════════ */

window.Drive = (() => {
  let tokenClient = null;
  let gapiLoaded  = false;
  let gisLoaded   = false;
  let accessToken = null;

  // ── Init ──────────────────────────────────────
  function init() {
    if (!window.DRIVE_CONFIG.DRIVE_ENABLED) return;
    if (typeof gapi === 'undefined') return;

    gapi.load('client', async () => {
      await gapi.client.init({ apiKey: DRIVE_CONFIG.API_KEY, discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'] });
      gapiLoaded = true;
    });

    if (typeof google !== 'undefined' && google.accounts) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CONFIG.CLIENT_ID,
        scope:     DRIVE_CONFIG.SCOPES,
        callback:  (resp) => { if (resp.access_token) accessToken = resp.access_token; }
      });
      gisLoaded = true;
    }
  }

  // ── Get Token ─────────────────────────────────
  function getToken() {
    return new Promise((resolve, reject) => {
      if (accessToken) return resolve(accessToken);
      if (!gisLoaded || !tokenClient) return reject(new Error('Google Drive not configured'));
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        accessToken = resp.access_token;
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  // ── Ensure Subfolder Exists ───────────────────
  async function ensureFolder(name, parentId) {
    const token = await getToken();
    // Search for existing
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${name}'+and+mimeType='application/vnd.google-apps.folder'+and+'${parentId}'+in+parents+and+trashed=false&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;

    // Create folder
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    const folder = await createRes.json();
    return folder.id;
  }

  // ── Upload File ───────────────────────────────
  async function uploadFile(file, department, subfolder = null) {
    if (!DRIVE_CONFIG.DRIVE_ENABLED) {
      return uploadToFirebaseStorage(file, department, subfolder);
    }

    try {
      const token = await getToken();
      const rootFolderId = DRIVE_CONFIG.FOLDER_ID;

      // Create dept folder
      const deptFolderId = await ensureFolder(department, rootFolderId);
      let targetFolderId = deptFolderId;

      if (subfolder) {
        targetFolderId = await ensureFolder(subfolder, deptFolderId);
      }

      // Upload
      const metadata = { name: file.name, parents: [targetFolderId] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', file);

      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const data = await res.json();
      return { id: data.id, name: data.name, url: data.webViewLink, source: 'gdrive' };
    } catch (err) {
      console.warn('Google Drive upload failed, falling back to Firebase Storage:', err);
      return uploadToFirebaseStorage(file, department, subfolder);
    }
  }

  // ── Fallback: Firebase Storage ─────────────────
  async function uploadToFirebaseStorage(file, department, subfolder) {
    const path = `${department}/${subfolder || 'general'}/${Date.now()}_${file.name}`;
    const ref = storage.ref(path);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    return { id: path, name: file.name, url, source: 'firebase' };
  }

  // ── Upload Profile Photo ──────────────────────
  async function uploadProfilePhoto(file, uid) {
    // Profile photos always go to Firebase Storage for speed
    const ref = storage.ref(`profile-photos/${uid}`);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    return url;
  }

  // ── Render Upload Area ────────────────────────
  function renderUploadArea(containerId, onUpload, { accept = '*', label = 'Upload File', dept = '', subfolder = '' } = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <label class="upload-area" id="upload-label-${containerId}">
        <div class="upload-icon">📎</div>
        <p>${label}</p>
        <p class="text-muted" style="font-size:11px;margin-top:4px">Click or drag file here</p>
        <input type="file" id="file-input-${containerId}" accept="${accept}" style="display:none"/>
      </label>
      <div id="upload-progress-${containerId}" style="display:none;margin-top:10px">
        <div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden">
          <div id="upload-bar-${containerId}" style="height:100%;background:var(--primary-light);width:0%;transition:width 0.3s"></div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:6px" id="upload-status-${containerId}">Uploading…</p>
      </div>
    `;

    const input = document.getElementById(`file-input-${containerId}`);
    const label = document.getElementById(`upload-label-${containerId}`);
    const progress = document.getElementById(`upload-progress-${containerId}`);
    const bar = document.getElementById(`upload-bar-${containerId}`);
    const status = document.getElementById(`upload-status-${containerId}`);

    const handleFile = async (file) => {
      progress.style.display = 'block';
      bar.style.width = '30%';
      status.textContent = 'Uploading…';
      try {
        const result = await uploadFile(file, dept || 'General', subfolder);
        bar.style.width = '100%';
        status.textContent = `✅ Uploaded: ${file.name}`;
        if (onUpload) onUpload(result, file);
      } catch (err) {
        status.textContent = `❌ Upload failed: ${err.message}`;
      }
    };

    input.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
    label.addEventListener('dragover', e => { e.preventDefault(); label.style.borderColor = 'var(--primary-light)'; });
    label.addEventListener('dragleave', () => { label.style.borderColor = ''; });
    label.addEventListener('drop', e => { e.preventDefault(); label.style.borderColor = ''; if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  }

  return { init, uploadFile, uploadProfilePhoto, renderUploadArea };
})();

// Auto-init when scripts load
document.addEventListener('DOMContentLoaded', () => Drive.init());
