/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Storage System v3
   drive.js

   Flow:
     1. Employee uploads → Firebase Storage (instant, no login needed)
     2. Every night at 12am, GitHub Actions syncs all Firebase files
        to Google Drive and updates Firestore links to Drive URLs.
     3. App displays Drive link + icon once synced, Cloud icon until then.

   No Google OAuth required from employees.
═══════════════════════════════════════════════════ */

window.Drive = (() => {

  // ── Upload to Firebase Storage ─────────────────────
  async function uploadToFirebaseStorage(file, department, subfolder) {
    if (typeof storage === 'undefined') throw new Error('Firebase Storage not initialized');
    const path = `${department || 'general'}/${subfolder || 'files'}/${Date.now()}_${file.name}`;
    const ref  = storage.ref(path);

    return new Promise((resolve, reject) => {
      const task = ref.put(file);
      task.on('state_changed',
        null,
        reject,
        async () => {
          const url = await ref.getDownloadURL();
          resolve({
            id:         path,
            name:       file.name,
            url,
            driveUrl:   null,   // filled in after nightly sync
            source:     'firebase',
            folder:     `${department || 'general'}${subfolder ? '/' + subfolder : ''}`
          });
        }
      );
    });
  }

  // ── Main Upload Entry Point ────────────────────────
  async function uploadFile(file, department, subfolder = null) {
    return uploadToFirebaseStorage(file, department, subfolder);
  }

  // ── Profile Photo Upload ───────────────────────────
  async function uploadProfilePhoto(file, uid) {
    const ref = storage.ref(`profile-photos/${uid}`);
    await ref.put(file);
    return ref.getDownloadURL();
  }

  // ── Delete File ────────────────────────────────────
  async function deleteFile(fileRef) {
    try { await storage.ref(fileRef.id).delete(); }
    catch (e) {
      console.warn('Firebase delete failed:', e);
      throw e; // let callers handle and surface the failure
    }
  }

  // ── Resolve best URL (Drive if synced, else Firebase) ──
  function resolveUrl(fileObj) {
    if (!fileObj) return null;
    return fileObj.driveUrl || fileObj.url || null;
  }

  // ── Is this attachment a link (vs an uploaded file)? ──
  function _isLink(fileObj) {
    return !!fileObj && (fileObj.source === 'link' || fileObj.kind === 'link');
  }

  // ── HTML escape (link labels are user-typed) ──────
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ── Source label ───────────────────────────────────
  function sourceLabel(fileObj) {
    if (!fileObj) return 'Cloud';
    if (_isLink(fileObj)) return 'Link';
    return fileObj.driveUrl ? 'Drive' : 'Cloud';
  }

  // ── Source icon ────────────────────────────────────
  function sourceIcon(fileObj) {
    if (_isLink(fileObj)) return 'link-2';
    return fileObj?.driveUrl ? 'hard-drive' : 'cloud';
  }

  // ── Render Upload Area ─────────────────────────────
  function renderUploadArea(containerId, onUpload, {
    accept = '*', label = 'Attach File', dept = 'General', subfolder = '', multiple = false, allowLinks = true
  } = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <label class="upload-area" id="upload-label-${containerId}">
        <div class="upload-area-inner">
          <span class="upload-icon-wrap">
            <i data-lucide="upload-cloud" style="width:22px;height:22px;stroke:var(--text-muted)"></i>
          </span>
          <p class="upload-label-text">${label}</p>
          <p class="upload-hint">
            <span style="color:var(--blue-2)">☁️ Saves to Cloud · Syncs to Drive at midnight</span>
            &nbsp;·&nbsp; Click or drag &amp; drop
          </p>
        </div>
        <input type="file" id="file-input-${containerId}" accept="${accept}"
               style="display:none" ${multiple ? 'multiple' : ''}/>
      </label>
      ${allowLinks ? `
      <div class="upload-link-bar" style="margin-top:8px">
        <button type="button" class="btn-secondary btn-sm" id="addlink-toggle-${containerId}"
                style="display:inline-flex;align-items:center;gap:6px">🔗 Attach a link instead</button>
        <div id="addlink-form-${containerId}" class="hidden"
             style="margin-top:8px;display:flex;flex-direction:column;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px">
          <input id="addlink-url-${containerId}" type="url" placeholder="https://…  (Drive, Sheets, Figma, YouTube…)"
                 style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)"/>
          <input id="addlink-name-${containerId}" placeholder="Label (optional, e.g. Spec sheet)"
                 style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)"/>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn-primary btn-sm" id="addlink-save-${containerId}">Add link</button>
            <button type="button" class="btn-secondary btn-sm" id="addlink-cancel-${containerId}">Cancel</button>
          </div>
        </div>
      </div>` : ''}
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

    // Append a chip for a successfully attached file or link
    const addChip = (result) => {
      const link = _isLink(result);
      const chip = document.createElement('a');
      chip.href      = resolveUrl(result) || '#';
      chip.target    = '_blank';
      chip.rel       = 'noopener';
      chip.className = 'file-chip';
      chip.innerHTML = `
        <i data-lucide="${link ? 'link-2' : _fileIcon(result.name || '')}" style="width:13px;height:13px;stroke:currentColor;flex-shrink:0"></i>
        <span>${_esc(result.name || (link ? 'Link' : 'File'))}</span>
        <span class="file-chip-src">${sourceLabel(result)}</span>
      `;
      fileList.appendChild(chip);
      if (window.lucide) lucide.createIcons({ nodes: [chip] });
    };

    const handleFile = async (file) => {
      progress.classList.remove('hidden');
      bar.style.width = '20%';
      status.textContent = `Uploading ${file.name}…`;
      try {
        bar.style.width = '60%';
        const result = await uploadFile(file, dept, subfolder);
        bar.style.width = '100%';
        status.textContent = `✅ ${file.name} uploaded`;
        addChip(result);
        if (onUpload) onUpload(result, file);
        setTimeout(() => { progress.classList.add('hidden'); bar.style.width = '0%'; }, 2000);
      } catch (err) {
        bar.style.width = '100%';
        bar.style.background = 'var(--danger)';
        status.textContent = `❌ Upload failed: ${err.message}`;
        setTimeout(() => {
          progress.classList.add('hidden');
          bar.style.width = '0%';
          bar.style.background = '';
        }, 3000);
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

    // ── Link attachment ──────────────────────────────
    if (allowLinks) {
      const toggle   = document.getElementById(`addlink-toggle-${containerId}`);
      const form     = document.getElementById(`addlink-form-${containerId}`);
      const urlIn    = document.getElementById(`addlink-url-${containerId}`);
      const nameIn   = document.getElementById(`addlink-name-${containerId}`);
      const saveBtn  = document.getElementById(`addlink-save-${containerId}`);
      const cancelBtn= document.getElementById(`addlink-cancel-${containerId}`);

      toggle?.addEventListener('click', () => {
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) urlIn.focus();
      });
      cancelBtn?.addEventListener('click', () => {
        form.classList.add('hidden'); urlIn.value = ''; nameIn.value = '';
      });

      const saveLink = () => {
        let url = (urlIn.value || '').trim();
        if (!url) { urlIn.focus(); return; }
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;   // tolerate bare domains
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
        const name = (nameIn.value || '').trim() || host || url;
        const result = { id: null, name, url, driveUrl: null, source: 'link', kind: 'link', folder: null };
        addChip(result);
        if (onUpload) onUpload(result, null);
        urlIn.value = ''; nameIn.value = ''; form.classList.add('hidden');
      };
      saveBtn?.addEventListener('click', saveLink);
      [urlIn, nameIn].forEach(el => el?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); saveLink(); }
      }));
    }
  }

  // ── File icon helper ──────────────────────────────
  function _fileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return 'image';
    if (['pdf'].includes(ext))                                  return 'file-text';
    if (['xls','xlsx','csv'].includes(ext))                     return 'table';
    if (['doc','docx'].includes(ext))                           return 'file-text';
    if (['ppt','pptx'].includes(ext))                           return 'monitor';
    if (['zip','rar','7z'].includes(ext))                       return 'archive';
    if (['mp4','mov','avi'].includes(ext))                      return 'video';
    return 'paperclip';
  }

  // ── Render Storage Status Card (Settings) ─────────
  function renderStorageStatus(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <div class="storage-status-card drive-on">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <div class="storage-icon-wrap">
            <i data-lucide="cloud" style="width:20px;height:20px;stroke:var(--blue)"></i>
          </div>
          <div>
            <div style="font-size:14px;font-weight:700">Cloud Storage + Google Drive Sync</div>
            <div style="font-size:12px;color:var(--text-muted)">Uploads save instantly to Cloud · Auto-synced to Google Drive at midnight</div>
          </div>
          <span class="badge badge-blue" style="margin-left:auto">Active</span>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
          Employees upload directly — no Google login required.<br>
          Links automatically update to Google Drive after the nightly sync.
        </p>
      </div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [el] });
  }

  return { uploadFile, uploadProfilePhoto, deleteFile, renderUploadArea, renderStorageStatus, resolveUrl, sourceLabel, sourceIcon };
})();
