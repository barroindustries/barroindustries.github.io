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
    // Extra random token (not just Date.now()) so two same-named files picked
    // in the same millisecond don't collide and silently overwrite each other.
    const path = `${department || 'general'}/${subfolder || 'files'}/${Date.now()}_${Math.random().toString(36).slice(2,8)}_${file.name}`;
    const ref  = storage.ref(path);

    return new Promise((resolve, reject) => {
      const task = ref.put(file, { customMetadata: { uploadedBy: (window.currentUser && currentUser.uid) || '' } });
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

  // ── Worker ID Photo Upload (HR-uploaded; role-gated path, not uid-owned) ──
  async function uploadWorkerPhoto(file, profileId) {
    const ref = storage.ref(`worker-id-photos/${profileId}/${Date.now()}_${file.name}`);
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
  // v12 WS38: reads the system_health/daily_sync heartbeat WS15's sync job writes
  // (finance/admin-only per firestore.rules — non-admin viewers just keep the
  // static "Active" badge via the try/catch below, no crash).
  async function renderStorageStatus(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    let health = null;
    try {
      const snap = await db.collection('system_health').doc('daily_sync').get();
      if (snap.exists) health = snap.data();
    } catch (_) { /* non-admin viewer, or offline — fall back to static card */ }
    const ok = !!health && health.lastStatus === 'ok';
    const badgeCls = health ? (ok ? 'badge-green' : 'badge-red') : 'badge-blue';
    const badgeLabel = health ? (ok ? 'Synced' : 'Sync issue') : 'Active';
    const lastRun = health && health.lastRunAt && health.lastRunAt.toDate
      ? health.lastRunAt.toDate().toLocaleString('en-PH') : '—';
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
          <span class="badge ${badgeCls}" style="margin-left:auto">${badgeLabel}</span>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
          Employees upload directly — no Google login required.<br>
          Links automatically update to Google Drive after the nightly sync.
        </p>
        ${health ? `<p style="font-size:11px;color:var(--text-muted)">Last sync: ${_esc(lastRun)} · ${health.filesWritten||0} file${health.filesWritten===1?'':'s'} mirrored${health.errors?` · <span style="color:var(--danger)">${health.errors} error${health.errors===1?'':'s'}</span>`:''}</p>` : ''}
      </div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [el] });
  }

  return { uploadFile, uploadProfilePhoto, uploadWorkerPhoto, deleteFile, renderUploadArea, renderStorageStatus, resolveUrl, sourceLabel, sourceIcon };
})();

/* ═══════════════════════════════════════════════════
   FILES HUB (WS38) — window.FilesHub service
   Unified file-metadata service for the `hub_files` / `hub_folders`
   collections. Lives here (not departments.js) because drive.js loads
   before departments.js/app.js/modules.js in index.html's fixed script
   order, so FilesHub is available to every caller.
   Contract for WS34/WS35 — see fable-workplan/38-files-hub.md.
═══════════════════════════════════════════════════ */
window.FilesHub = {
  // ── Read fan-out. Rules cannot be satisfied by one unfiltered query for
  // non-admins, so merge 3 provable queries (admins: 1 broad query).
  async loadFiles(scope /* string|null = all scopes */, { includeDeleted=false } = {}) {
    const uid = currentUser.uid;
    const base = () => {
      let q = db.collection('hub_files');
      if (scope) q = q.where('scope','==',scope);
      return q.where('deleted','==', includeDeleted);
    };
    const isAdminRole = ['president','manager','owner'].includes(window.currentRole);
    const snaps = await Promise.all(
      isAdminRole
        ? [ base().get().catch(()=>({docs:[]})) ]
        : [ base().where('visibility','==','company').get().catch(()=>({docs:[]})),
            base().where('uploadedBy','==',uid).get().catch(()=>({docs:[]})),
            base().where('sharedUserIds','array-contains',uid).get().catch(()=>({docs:[]})) ]);
    const seen = {}; const out = [];
    snaps.forEach(s => s.docs.forEach(d => { if (!seen[d.id]) { seen[d.id]=1; out.push({id:d.id,...d.data()}); } }));
    return out.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  },
  async loadFolders(scope) {
    const snap = await db.collection('hub_folders').where('scope','==',scope).get().catch(()=>({docs:[]}));
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  },
  folderPath(folderId, foldersById) {          // client-side path resolution (decision 2)
    const parts = []; let f = foldersById[folderId]; let guard = 0;
    while (f && guard++ < 20) { parts.unshift(f.name); f = foldersById[f.parentId]; }
    return parts.join(' / ');
  },
  canEdit(f) {
    return ['president','manager','owner'].includes(window.currentRole)
      || f.uploadedBy === currentUser.uid
      || (f.editorUserIds||[]).includes(currentUser.uid);
  },
  // ── Mutations (all set/update with merge-mindset; updatedAt always stamped)
  moveToFolder: (id, folderId) => db.collection('hub_files').doc(id)
    .update({ folderId: folderId || null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }),
  async uploadNewVersion(f, result /* Drive.renderUploadArea result */, file, note) {
    const FV = firebase.firestore.FieldValue;
    const entry = { v:(f.currentV||1)+1, url:result.url, name:file?.name||result.name,
      size:file?.size||null, contentType:file?.type||null, note:note||'',
      by:currentUser.uid, byName:(window.userProfile?.displayName||currentUser.email),
      at:new Date().toISOString() };                     // ISO — arrayUnion can't hold serverTimestamp
    await db.collection('hub_files').doc(f.id).update({
      versions: FV.arrayUnion(entry),
      url:entry.url, size:entry.size, contentType:entry.contentType,
      currentV:entry.v, driveUrl:null,                    // new blob → re-mirrored by nightly sync
      updatedAt: FV.serverTimestamp() });
  },
  softDelete: (id) => db.collection('hub_files').doc(id).update({
    deleted:true, deletedAt:firebase.firestore.FieldValue.serverTimestamp(),
    deletedBy:currentUser.uid, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }),
  restore: (id) => db.collection('hub_files').doc(id).update({
    deleted:false, deletedAt:null, deletedBy:null,
    updatedAt:firebase.firestore.FieldValue.serverTimestamp() }),
  async purge(f) {                                        // PRESIDENT ONLY (rules-enforced)
    // First-ever real Drive.deleteFile caller — blob deletes are best-effort:
    // link docs have no Storage object, legacy-migrated docs may 404, and the
    // Drive-mirror copies are deliberately NOT deleted (cold archive,
    // records-forever directive). Deletes EVERY version's blob, then the doc.
    const urlToPath = u => { try { return decodeURIComponent(new URL(u).pathname.split('/o/')[1]||''); } catch { return ''; } };
    if (f.source === 'firebase') {
      const urls = [...new Set([f.url, ...(f.versions||[]).map(v=>v.url)].filter(Boolean))];
      for (const u of urls) {
        const p = urlToPath(u);
        if (p) { try { await Drive.deleteFile({ id: p }); } catch(e) { console.warn('blob delete skipped:', e.message||e); } }
      }
    }
    await db.collection('hub_files').doc(f.id).delete();
  },
  // ── Sharing. target = {type:'user'|'dept'|'role', id, label}; perm 'view'|'edit'.
  // Dept/role targets are EXPANDED to uids NOW (decision 5); partners are excluded
  // from dept/role expansion — a partner can only be shared to as an explicit user.
  async share(f, target, perm) {
    const FV = firebase.firestore.FieldValue;
    let uids = [];
    if (target.type === 'user') uids = [target.id];
    else {
      const us = await db.collection('users').get();
      us.docs.forEach(d => { const u = d.data();
        if (u.role === 'partner') return;                  // WS19 guard, by construction
        if (target.type === 'dept' && (u.departments||[]).includes(target.id)) uids.push(d.id);
        if (target.type === 'role' && u.role === target.id) uids.push(d.id); });
    }
    if (!uids.length) throw new Error('No matching users for this share target');
    const upd = { sharedUserIds: FV.arrayUnion(...uids),
      shares: FV.arrayUnion({ ...target, perm, by:currentUser.uid,
        byName:(window.userProfile?.displayName||currentUser.email), at:new Date().toISOString() }),
      updatedAt: FV.serverTimestamp() };
    if (perm === 'edit') upd.editorUserIds = FV.arrayUnion(...uids);  // editors ⊆ shared invariant
    await db.collection('hub_files').doc(f.id).update(upd);
  }
};

// ── Preview lightbox (wholly new — zero existing component, Current state §9) ──
window.openFilePreview = function(f) {
  const url = f.url || '';
  const isImg = /^image\//.test(f.contentType||'') || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url);
  const isPdf = /pdf/.test(f.contentType||'') || /\.pdf(\?|$)/i.test(url);
  const safe = (typeof safeHttpUrl==='function') ? safeHttpUrl(url) : url;
  const esc = (typeof escHtml==='function') ? escHtml : (s => String(s==null?'':s));
  const body = isImg ? `<img src="${safe}" style="max-width:100%;max-height:70vh;border-radius:8px" alt="">`
    : isPdf ? `<iframe src="${safe}" style="width:100%;height:70vh;border:0;border-radius:8px"></iframe>`
    : `<div class="empty-state" style="padding:30px"><div class="empty-icon">📄</div>
         <p>No inline preview for this file type.</p></div>`;
  openModal(`${f.kind==='link'?'🔗':'📄'} ${esc(f.name||'File')}`,
    body + `<div style="text-align:right;margin-top:10px">
      <a href="${safe}" target="_blank" class="btn-primary btn-sm">Open in new tab ↗</a></div>`, '');
};
