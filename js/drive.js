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
  // AVATAR NORMALISATION (2026-08-08 lockout fix). This was a bare
  // `ref.put(file)` with no metadata, which failed on iPhone — the way this app
  // is actually used — and, because the mandatory-photo gate has no dismiss
  // control, locked the user out of the whole app. Three failure modes, all
  // removed by normalising the image client-side before it reaches Storage:
  //
  //   1. EMPTY MIME. iOS pickers (Files-app providers, iCloud photos not yet
  //      downloaded, some HEIC/Live Photo paths) hand back a File whose .type
  //      is ''. The Storage compat SDK then falls back to
  //      'application/octet-stream', which fails storage.rules' isValidImage()
  //      (`contentType.matches('image/.*')`) → storage/unauthorized, on every
  //      retry, deterministically. js/screens/worker.js:991 already carries
  //      this exact fix for attendance selfies; this path never got it.
  //   2. SIZE. isValidImage() also caps uploads at 15MB, and a modern iPhone
  //      capture (never mind ProRAW) can clear that — denied identically, and
  //      indistinguishably, from case 1.
  //   3. HEIC. Passes the rules, but is unviewable in most non-Apple browsers,
  //      so the avatar would silently render blank for half the company.
  //
  // Re-encoding to JPEG kills all three at once, and makes the upload far
  // faster on mobile data (a ~4MB capture lands at ~100–200KB).
  const AVATAR_MAX_DIM   = 1024;              // ample for an avatar AND the printed company ID
  const AVATAR_QUALITY   = 0.85;
  const AVATAR_MAX_BYTES = 15 * 1024 * 1024;  // mirrors storage.rules isValidImage()

  function _avatarErr(code, message) {
    return Object.assign(new Error(message), { code });
  }

  // Decode to something drawable, honouring EXIF orientation. iOS photos are
  // very commonly rotated (a portrait shot carries Orientation 6), and a canvas
  // re-encode BAKES the pixels as drawn — so without this every other avatar
  // comes out sideways. createImageBitmap's imageOrientation:'from-image' is
  // the explicit control; the <img> fallback covers engines that lack
  // createImageBitmap or reject the blob, and there modern browsers apply EXIF
  // to drawImage themselves (CSS image-orientation defaults to from-image).
  // Resolves null when nothing can decode the bytes.
  async function _decodeForAvatar(file) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (_) { /* option unsupported, or undecodable — try the plain form */ }
      try { return await createImageBitmap(file); }
      catch (_) { /* fall through to the <img> path */ }
    }
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  // Draw → downscale → JPEG. Returns null when the bytes can't be decoded, so
  // the caller decides what to do rather than this silently shipping something
  // Storage or the browser will choke on. Same canvas/toBlob approach as
  // js/chat.js _compressImage and js/screens/worker.js _compressSelfie, with an
  // avatar's own params.
  async function _normaliseAvatar(file) {
    const src = await _decodeForAvatar(file);
    if (!src) return null;
    let width  = src.width  || src.naturalWidth;
    let height = src.height || src.naturalHeight;
    const close = () => { try { if (typeof src.close === 'function') src.close(); } catch (_) {} };
    if (!width || !height) { close(); return null; }
    if (width > AVATAR_MAX_DIM || height > AVATAR_MAX_DIM) {
      const scale = AVATAR_MAX_DIM / Math.max(width, height);
      width = Math.round(width * scale); height = Math.round(height * scale);
    }
    let canvas;
    try {
      canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const _ctx = canvas.getContext('2d');
      // JPEG has no alpha channel, so a transparent PNG (a cropped logo, a
      // screenshot cut-out) would export with a BLACK background. Paint white
      // first so transparency flattens the way a person expects.
      _ctx.fillStyle = '#fff';
      _ctx.fillRect(0, 0, canvas.width, canvas.height);
      _ctx.drawImage(src, 0, 0, width, height);
    } catch (e) {
      console.warn('[profile-photo] canvas re-encode failed', e);
      close(); return null;
    }
    close();   // an ImageBitmap holds decoded pixels — free them, phones are tight
    return new Promise(resolve => {
      try { canvas.toBlob(blob => resolve(blob || null), 'image/jpeg', AVATAR_QUALITY); }
      catch (_) { resolve(null); }
    });
  }

  async function uploadProfilePhoto(file, uid) {
    if (typeof storage === 'undefined') throw _avatarErr('avatar/no-storage', 'Storage is not available right now. Reload the app and try again.');
    if (!file) throw _avatarErr('avatar/no-file', 'No photo was selected.');
    if (!uid)  throw _avatarErr('avatar/unauthenticated', 'Your session ended. Please sign in again and retry.');
    // Storage's own isSignedIn() would reject this anyway, but as
    // storage/unauthorized — indistinguishable from a rejected file. Check here
    // so the user is told the one thing that actually helps.
    let signedIn = false;
    try { signedIn = !!(auth && auth.currentUser); } catch (_) { signedIn = false; }
    if (!signedIn) throw _avatarErr('avatar/unauthenticated', 'Your session ended. Please sign in again and retry.');

    // Wrong-file-type, called out explicitly: an accept="image/*" picker still
    // lets an iPhone user browse into the Files app, so a PDF or a .zip really
    // can arrive here. An EMPTY type is deliberately NOT rejected — that is the
    // iOS case this whole function exists for, and the decode below settles it.
    if (file.type && !/^image\//i.test(file.type)) {
      throw _avatarErr('avatar/not-an-image', 'That file is not an image. Please pick a photo (JPEG or PNG).');
    }

    let blob = await _normaliseAvatar(file);
    let contentType = 'image/jpeg';
    if (!blob) {
      // Undecodable. Keep the original ONLY if it is honestly an image and fits
      // the rules' ceiling — never re-label unknown bytes as image/jpeg just to
      // slip past isValidImage(), because that stores an avatar nothing can
      // render, which is a worse outcome than an honest error.
      if (!/^image\//i.test(file.type || '')) {
        throw _avatarErr('avatar/undecodable', "That photo couldn't be read on this device. Please pick a different one (JPEG or PNG).");
      }
      if (file.size > AVATAR_MAX_BYTES) {
        throw _avatarErr('avatar/too-large', 'That photo is too large (15MB maximum). Please pick a smaller one.');
      }
      blob = file; contentType = file.type;
    }

    const ref = storage.ref(`profile-photos/${uid}`);
    // The explicit contentType is the entire fix — without it the SDK sends
    // blob.type || 'application/octet-stream'. customMetadata.uploadedBy
    // matches what the other upload paths already record.
    await ref.put(blob, { contentType, customMetadata: { uploadedBy: uid } });
    return ref.getDownloadURL();
  }

  // ── Human-readable upload failure ──────────────────
  // Both profile-photo callers (the mandatory gate and the profile drawer) used
  // to show a bare "Upload failed" and discard the error object, which is
  // exactly what made this bug undiagnosable. Map the codes that actually occur
  // to something the user can act on; anything unmapped still surfaces its raw
  // code, so the next report arrives with evidence attached.
  //
  // `kind` — 'photo' (the default, so the two existing profile-photo callers in
  // js/app.js keep their wording byte-for-byte) or 'file'. Only the
  // storage/unauthorized branch differs, and it has to: for an avatar that code
  // really does mean "wrong format or too big", but for a document upload it
  // overwhelmingly means the folder is not open to this account, and telling
  // someone their contract PDF "must be an image under 15MB" sends them off
  // chasing a problem they do not have.
  function uploadErrorMessage(err, kind) {
    // String(): a DOMException carries a NUMERIC legacy .code (InvalidStateError
    // = 11, NotFoundError = 8, AbortError = 20, QuotaExceededError = 22), and
    // those DO occur on iOS when a File's backing blob has gone away or a
    // FileReader is busy. Without the coercion `code.indexOf` is not a function,
    // so this THROWS out of the very catch block that exists to recover — and in
    // the mandatory-photo gate the throw lands before revealEscape(), leaving the
    // overlay frozen on "Uploading…" with no message and no way out. That is the
    // exact lockout this whole change set was written to remove.
    // Even the property READ is guarded. This function's entire contract is
    // "never throw" — every caller is inside a catch block that is the user's
    // last line of defence — so it must not assume `err` is a well-behaved
    // object. A throwing accessor is exotic, but the cost of tolerating it is
    // one try/catch and the cost of not doing is a user stranded on a
    // full-screen overlay with no way out.
    let code = '', message = '';
    try { code = String((err && err.code) || ''); } catch (_) {}
    // 2026-08-10: this read `String(message || '')` — message reading ITSELF,
    // which is always '' at that point. Every avatar/* branch below therefore
    // fell through to the generic "Upload failed." and the specific, actionable
    // text those errors were written to carry ("That photo is too large (15MB
    // maximum)", "…couldn't be read on this device") never reached anyone. Read
    // the ERROR's message, still guarded — this function's contract is that it
    // never throws, because every caller is inside the catch block that is the
    // user's last line of defence.
    try { message = String((err && err.message) || ''); } catch (_) {}
    if (code.indexOf('avatar/') === 0) return message || 'Upload failed.';
    switch (code) {
      case 'storage/unauthenticated':
        return 'Your session ended. Please sign in again and retry.';
      case 'storage/unauthorized':
        return kind === 'file'
          ? "You don't have permission to upload into this folder — nothing was saved. Please tell an administrator."
          : 'That photo was rejected — it must be an image under 15MB. Please try a different one.';
      case 'storage/quota-exceeded':
        return 'Company file storage is full. Please tell an administrator.';
      case 'storage/retry-limit-exceeded':
        return 'The upload timed out. Check your connection and try again.';
      case 'storage/canceled':
        return 'Upload cancelled.';
      case 'permission-denied':
        return "You don't have permission to save this. Please tell an administrator.";
      case 'unavailable':
        return 'Could not reach the server. Check your connection and try again.';
    }
    try { if (navigator && navigator.onLine === false) return 'You appear to be offline. Reconnect and try again.'; } catch (_) {}
    return `Upload failed (${code || message || 'unknown error'}). Please try again.`;
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
    // liveEl, not getElementById: this helper is handed an id STRING, so the
    // caller cannot scope it. Inside openPage's ~300ms teardown the upload
    // widget was being mounted into the DYING panel and the visible form showed
    // no file chooser at all. See window.liveEl (js/config.js).
    const container = (window.liveEl ? window.liveEl(containerId) : document.getElementById(containerId));
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
      // Clear a previous failure's red bar — the error state is now persistent
      // (see the catch below), so the NEXT attempt has to reset it explicitly
      // or a successful retry would still be painted as a failure.
      bar.style.background = '';
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
        // A failed attachment is SILENT unless we say so loudly. This used to
        // print the raw Firebase message ("Firebase Storage: User does not have
        // permission…") into a progress bar that hid itself after 3 seconds, and
        // raised nothing else — so a denied upload looked like a slow one, the
        // caller's onUpload never fired, and the surrounding form then saved
        // happily with fileUrl:null and a green "saved" toast. The document was
        // gone and the person was told it worked.
        //
        // Two changes: translate the code through uploadErrorMessage() — which
        // exists for exactly this and was never wired to this path — and raise a
        // toast, which survives the bar. The bar itself now stays put; there is
        // nothing useful about hiding the only record of the failure.
        const msg = uploadErrorMessage(err, 'file');
        bar.style.width = '100%';
        bar.style.background = 'var(--danger)';
        status.textContent = `❌ ${file.name} — ${msg}`;
        // Plain text sink: never emojiIcon() here (it returns markup).
        try { window.Notifs && Notifs.showToast(`Upload failed — ${msg}`, 'error'); } catch (_) {}
        console.warn('[drive] upload failed', err);
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

  return { uploadFile, uploadProfilePhoto, uploadWorkerPhoto, uploadErrorMessage, deleteFile, renderUploadArea, renderStorageStatus, resolveUrl, sourceLabel, sourceIcon };
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
  // ── Who reads EVERY hub_files doc in one unfiltered query, and who takes the
  // 3-query fan-out. This used to be an anonymous literal repeated inside
  // loadFiles and canEdit, and a THIRD, DIFFERENT literal lived in
  // renderFilesHub (js/screens/people.js) which also counted 'secretary' as an
  // admin. The screen therefore labelled its default view "All Scopes" while
  // this layer quietly gave the Corporate Secretary the fan-out — a view that
  // omits every private and unshared file, presented to the one role whose job
  // is oversight as if it were everything. One exported predicate, so the
  // screen can ask instead of guessing. ('owner' is the legacy alias for
  // president, matching the role lists elsewhere in the app.)
  BROAD_READ_ROLES: ['president','manager','owner'],
  hasBroadRead() { return this.BROAD_READ_ROLES.includes(window.currentRole); },

  // ── Departments whose files a role may not see, as a doc-level predicate.
  // Owner ruling: the Corporate Secretary reaches every department EXCEPT
  // Finance and IT. hub_files carries the owning `department` on every doc
  // (window.bindFileCollection stamps it, js/departments.js), so the wall can be
  // enforced on the DATA rather than on each screen that happens to list files
  // — which matters because the aggregate Files Hub view and Global Search both
  // come through loadFiles, and filtering only the scope chips would have left
  // both of those doors open. `scope` is checked too as a legacy safety net:
  // pre-WS38 migrated docs can be missing `department`, and 'sss'/'accounting'
  // are Finance's own scopes by construction (js/screens/finance.js).
  // This is the AFFORDANCE half only — firestore.rules is the boundary.
  _FINANCE_SCOPE_KEYS: ['sss','accounting'],
  _hiddenFor(f) {
    if (window.currentRole !== 'secretary') return false;
    const blocked = window.SECRETARY_BLOCKED_DEPTS || ['Finance','IT'];
    if (blocked.includes(f.department)) return true;
    return blocked.includes('Finance') && this._FINANCE_SCOPE_KEYS.includes(f.scope);
  },

  // ── Read fan-out. Rules cannot be satisfied by one unfiltered query for
  // non-admins, so merge 3 provable queries (admins: 1 broad query).
  async loadFiles(scope /* string|null = all scopes */, { includeDeleted=false } = {}) {
    const uid = currentUser.uid;
    const base = () => {
      let q = db.collection('hub_files');
      if (scope) q = q.where('scope','==',scope);
      return q.where('deleted','==', includeDeleted);
    };
    const snaps = await Promise.all(
      this.hasBroadRead()
        ? [ base().get().catch(()=>({docs:[]})) ]
        : [ base().where('visibility','==','company').get().catch(()=>({docs:[]})),
            base().where('uploadedBy','==',uid).get().catch(()=>({docs:[]})),
            base().where('sharedUserIds','array-contains',uid).get().catch(()=>({docs:[]})) ]);
    const seen = {}; const out = [];
    snaps.forEach(s => s.docs.forEach(d => { if (!seen[d.id]) { seen[d.id]=1; out.push({id:d.id,...d.data()}); } }));
    return out.filter(f => !this._hiddenFor(f))
              .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
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
    // A file the viewer is not allowed to SEE is never editable, whatever the
    // ACL says — a stale share or an editorUserIds entry left behind by a
    // department move must not become a way back into a closed department.
    if (this._hiddenFor(f)) return false;
    return this.hasBroadRead()
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
