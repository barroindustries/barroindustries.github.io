/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Storage System v2
   drive.js

   Priority:
     1. Google Drive (when DRIVE_ENABLED = true)
        → files uploaded to central BI-Operations folder
        → department subfolders auto-created
        → files made publicly viewable (shareable link)
     2. Firebase Storage fallback (always available)
        → structured as: dept/subfolder/timestamp_filename

   Setup: see GOOGLE_DRIVE_SETUP.md
═══════════════════════════════════════════════════ */

window.Drive = (() => {
  let tokenClient  = null;
  let gapiLoaded   = false;
  let gisLoaded    = false;
  let accessToken  = null;
  let rootFolderId = null; // cached ID of "BI-Operations" root folder

  const CENTRAL_FOLDER_NAME = 'BI-Operations';

  // ── Init ──────────────────────────────────────────
  function init() {
    if (!window.DRIVE_CONFIG?.DRIVE_ENABLED) return;

    // Load gapi client
    if (typeof gapi !== 'undefined') {
      gapi.load('client', async () => {
        try {
          await gapi.client.init({
            apiKey: DRIVE_CONFIG.API_KEY,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
          });
          gapiLoaded = true;
        } catch (e) {
          console.warn('gapi init error:', e);
        }
      });
    }

    // Load Google Identity Services
    if (typeof google !== 'undefined' && google.accounts) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CONFIG.CLIENT_ID,
        scope: DRIVE_CONFIG.SCOPES,
        callback: (resp) => {
          if (resp.access_token) accessToken = resp.access_token;
        }
      });
      gisLoaded = true;
    }
  }

  // ── Get OAuth Token ────────────────────────────────
  function getToken() {
    return new Promise((resolve, reject) => {
      if (accessToken) return resolve(accessToken);
      if (!gisLoaded || !tokenClient) {
        return reject(new Error('Google Drive not configured. Check DRIVE_CONFIG in config.js.'));
      }
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        accessToken = resp.access_token;
        resolve(accessToken);
      };
      // Only show consent if first time
      tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
    });
  }

  // ── Ensure Folder Exists (creates if missing) ──────
  async function ensureFolder(name, parentId) {
    const token = await getToken();
    const q = `name='${name.replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.files?.length > 0) return data.files[0].id;

    // Create it
    const create = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });
    const folder = await create.json();
    return folder.id;
  }

  // ── Get or Create Central BI-Operations Folder ─────
  async function getRootFolder() {
    if (rootFolderId) return rootFolderId;

    // Check if config specifies an explicit root folder ID
    if (DRIVE_CONFIG.FOLDER_ID && DRIVE_CONFIG.FOLDER_ID !== 'YOUR_FOLDER_ID_HERE') {
      rootFolderId = DRIVE_CONFIG.FOLDER_ID;
      return rootFolderId;
    }

    // Otherwise find/create in My Drive root
    const token = await getToken();
    const q = `name='${CENTRAL_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.files?.length > 0) {
      rootFolderId = data.files[0].id;
      return rootFolderId;
    }

    // Create it
    const create = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: CENTRAL_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const folder = await create.json();
    rootFolderId = folder.id;
    return rootFolderId;
  }

  // ── Make File Publicly Viewable ────────────────────
  async function makePublic(fileId) {
    const token = await getToken();
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
  }

  // ── Upload File to Google Drive ────────────────────
  async function uploadToDrive(file, department, subfolder) {
    const token    = await getToken();
    const rootId   = await getRootFolder();
    const deptId   = await ensureFolder(department || 'General', rootId);
    const targetId = subfolder ? await ensureFolder(subfolder, deptId) : deptId;

    const metadata = { name: file.name, parents: [targetId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    // Make publicly viewable so anyone with link can open it
    await makePublic(data.id);

    return {
      id:     data.id,
      name:   data.name,
      url:    data.webViewLink,   // "View" link (opens in Drive viewer)
      dlUrl:  data.webContentLink, // Direct download link
      source: 'gdrive',
      folder: department + (subfolder ? '/' + subfolder : '')
    };
  }

  // ── Fallback: Firebase Storage ─────────────────────
  async function uploadToFirebaseStorage(file, department, subfolder) {
    if (typeof storage === 'undefined') throw new Error('Firebase Storage not initialized');
    const path = `${department || 'general'}/${subfolder || 'files'}/${Date.now()}_${file.name}`;
    const ref  = storage.ref(path);

    // Track upload progress
    return new Promise((resolve, reject) => {
      const task = ref.put(file);
      task.on('state_changed',
        null,
        reject,
        async () => {
          const url = await ref.getDownloadURL();
          resolve({ id: path, name: file.name, url, source: 'firebase', folder: department });
        }
      );
    });
  }

  // ── Main Upload Entry Point ────────────────────────
  async function uploadFile(file, department, subfolder = null) {
    if (window.DRIVE_CONFIG?.DRIVE_ENABLED) {
      try {
        return await uploadToDrive(file, department, subfolder);
      } catch (err) {
        console.warn('Google Drive upload failed, using Firebase Storage:', err.message);
        Notifs?.showToast?.('Drive unavailable — saving to cloud storage.', 'info');
        return uploadToFirebaseStorage(file, department, subfolder);
      }
    }
    return uploadToFirebaseStorage(file, department, subfolder);
  }

  // ── Profile Photo Upload ───────────────────────────
  async function uploadProfilePhoto(file, uid) {
    // Always use Firebase Storage for profile photos (fast, CDN-served)
    const ref = storage.ref(`profile-photos/${uid}`);
    await ref.put(file);
    return ref.getDownloadURL();
  }

  // ── Delete File ────────────────────────────────────
  async function deleteFile(fileRef) {
    if (fileRef.source === 'gdrive') {
      try {
        const token = await getToken();
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileRef.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (e) { console.warn('Drive delete failed:', e); }
    } else {
      try { await storage.ref(fileRef.id).delete(); } catch (e) { console.warn('Firebase delete failed:', e); }
    }
  }

  // ── Render Upload Area ─────────────────────────────
  function renderUploadArea(containerId, onUpload, {
    accept = '*', label = 'Attach File', dept = 'General', subfolder = '', multiple = false
  } = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const driveEnabled = window.DRIVE_CONFIG?.DRIVE_ENABLED;

    container.innerHTML = `
      <label class="upload-area" id="upload-label-${containerId}">
        <div class="upload-area-inner">
          <span class="upload-icon-wrap"><i data-lucide="paperclip" style="width:22px;height:22px;stroke:var(--text-muted)"></i></span>
          <p class="upload-label-text">${label}</p>
          <p class="upload-hint">
            ${driveEnabled
              ? '<span style="color:var(--gold)">📁 Saves to Google Drive</span>'
              : '<span style="color:var(--blue-2)">☁️ Saves to Cloud Storage</span>'}
            &nbsp;·&nbsp; Click or drag &amp; drop
          </p>
        </div>
        <input type="file" id="file-input-${containerId}" accept="${accept}"
               style="display:none" ${multiple ? 'multiple' : ''}/>
      </label>
      <div id="upload-progress-${containerId}" class="upload-progress hidden">
        <div class="upload-bar-track"><div class="upload-bar-fill" id="upload-bar-${containerId}"></div></div>
        <p class="upload-status" id="upload-status-${containerId}">Uploading…</p>
      </div>
      <div id="uploaded-files-${containerId}" class="uploaded-files-list"></div>
    `;

    if (window.lucide) lucide.createIcons({ nodes: [container] });

    const input    = document.getElementById(`file-input-${containerId}`);
    const lbl      = document.getElementById(`upload-label-${containerId}`);
    const progress = document.getElementById(`upload-progress-${containerId}`);
    const bar      = document.getElementById(`upload-bar-${containerId}`);
    const status   = document.getElementById(`upload-status-${containerId}`);
    const fileList = document.getElementById(`uploaded-files-${containerId}`);

    const handleFile = async (file) => {
      progress.classList.remove('hidden');
      bar.style.width = '20%';
      status.textContent = `Uploading ${file.name}…`;
      try {
        bar.style.width = '60%';
        const result = await uploadFile(file, dept, subfolder);
        bar.style.width = '100%';
        status.textContent = `✅ ${file.name}`;

        // Render file chip with link
        const chip = document.createElement('a');
        chip.href   = result.url;
        chip.target = '_blank';
        chip.rel    = 'noopener';
        chip.className = 'file-chip';
        chip.innerHTML = `
          <i data-lucide="${_fileIcon(file.name)}" style="width:13px;height:13px;stroke:currentColor;flex-shrink:0"></i>
          <span>${file.name}</span>
          <span class="file-chip-src">${result.source === 'gdrive' ? 'Drive' : 'Cloud'}</span>
        `;
        fileList.appendChild(chip);
        if (window.lucide) lucide.createIcons({ nodes: [chip] });

        if (onUpload) onUpload(result, file);
        setTimeout(() => { progress.classList.add('hidden'); bar.style.width = '0%'; }, 2000);
      } catch (err) {
        bar.style.width = '100%';
        bar.style.background = 'var(--danger)';
        status.textContent = `❌ Upload failed: ${err.message}`;
      }
    };

    const handleFiles = (files) => { Array.from(files).forEach(handleFile); };

    input.addEventListener('change', e => handleFiles(e.target.files));
    lbl.addEventListener('dragover',  e => { e.preventDefault(); lbl.classList.add('drag-over'); });
    lbl.addEventListener('dragleave', ()  => lbl.classList.remove('drag-over'));
    lbl.addEventListener('drop', e => {
      e.preventDefault(); lbl.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files);
    });
  }

  // ── File icon helper ──────────────────────────────
  function _fileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return 'image';
    if (['pdf'].includes(ext)) return 'file-text';
    if (['xls','xlsx','csv'].includes(ext)) return 'table';
    if (['doc','docx'].includes(ext)) return 'file-text';
    if (['ppt','pptx'].includes(ext)) return 'monitor';
    if (['zip','rar','7z'].includes(ext)) return 'archive';
    if (['mp4','mov','avi'].includes(ext)) return 'video';
    return 'paperclip';
  }

  // ── Render Drive Status Card (for Settings) ────────
  function renderStorageStatus(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const enabled = window.DRIVE_CONFIG?.DRIVE_ENABLED;
    el.innerHTML = `
      <div class="storage-status-card ${enabled ? 'drive-on' : 'drive-off'}">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <div class="storage-icon-wrap">
            <i data-lucide="${enabled ? 'hard-drive' : 'cloud'}" style="width:20px;height:20px;stroke:${enabled?'var(--gold)':'var(--blue)'}"></i>
          </div>
          <div>
            <div style="font-size:14px;font-weight:700">${enabled ? 'Google Drive Active' : 'Cloud Storage Active'}</div>
            <div style="font-size:12px;color:var(--text-muted)">${enabled ? 'Files save to BI-Operations folder in Drive' : 'Files save to Firebase Cloud Storage'}</div>
          </div>
          <span class="badge ${enabled?'badge-green':'badge-blue'}" style="margin-left:auto">${enabled?'Drive':'Firebase'}</span>
        </div>
        ${enabled
          ? `<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Central folder: <strong>BI-Operations</strong> → Department → Subfolder</p>
             <a href="https://drive.google.com/drive/folders/${DRIVE_CONFIG.FOLDER_ID||''}" target="_blank" class="btn-secondary btn-sm">Open in Drive ↗</a>`
          : `<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">To enable Google Drive, add your credentials to <code>js/config.js</code> and set <code>DRIVE_ENABLED: true</code>.</p>
             <button class="btn-secondary btn-sm" onclick="navigateTo('help')">View Setup Guide</button>`}
      </div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [el] });
  }

  return { init, uploadFile, uploadProfilePhoto, deleteFile, renderUploadArea, renderStorageStatus, ensureFolder, getRootFolder };
})();

document.addEventListener('DOMContentLoaded', () => Drive.init());
