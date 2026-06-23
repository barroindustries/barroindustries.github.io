/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Extended Modules v1
   modules.js — Posts, Team, Finance Expansion,
                Cash Advance, Attendance, Company
═══════════════════════════════════════════════════ */
'use strict';

// ── HTML escape — prevents XSS when inserting user content into innerHTML ──
function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── URL allow-list — only return http(s) URLs, else '' ──
// Blocks javascript:, data:, and other breakout vectors before a user-supplied
// URL is used as a src/href or opened in a new tab.
function safeHttpUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(String(url), window.location.origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch { return ''; }
}

// ── PRESIDENT UID (Neil Barro) ────────────────────
// This controls whose photo/name shows in the president
// message card in Company Overview.
const PRESIDENT_UID = 'neilbarro870@gmail.com'; // fallback: match by email

// Role-based president check — the role itself is the authority; an email match
// is no longer required (roles are assigned/enforced by Firestore rules).
function isRealPresident() {
  return currentRole === 'president';
}

// ══════════════════════════════════════════════════
//  POSTS
// ══════════════════════════════════════════════════

window.renderPosts = async function() {
  const c = document.getElementById('page-content');
  const partner = typeof isPartner === 'function' && isPartner();
  const canPost  = isRealPresident();
  const canApprove = isRealPresident() || currentRole === 'manager';

  if (partner) {
    c.innerHTML = `
      <div class="page-header"><h2>📣 Posts</h2></div>
      <div class="subtab-bar" id="posts-tabs">
        <button class="subtab-btn active" data-sub="Partners">Partners</button>
      </div>
      <div id="posts-content"></div>
    `;
    loadPosts('Partners');
    return;
  }

  c.innerHTML = `
    <div class="page-header">
      <h2>📣 Posts</h2>
      <button class="btn-primary btn-sm" id="new-post-btn">+ ${canPost ? 'New Post' : 'Submit Post'}</button>
    </div>
    <div class="subtab-bar" id="posts-tabs">
      <button class="subtab-btn active" data-sub="General">General</button>
      ${currentDepts.map(d => `<button class="subtab-btn" data-sub="${d}">${d}</button>`).join('')}
      ${canApprove ? '<button class="subtab-btn" data-sub="Pending">Pending Approval</button>' : ''}
    </div>
    <div id="posts-content"></div>
  `;
  loadPosts('General');
  c.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadPosts(btn.dataset.sub);
    });
  });
  document.getElementById('new-post-btn').addEventListener('click', () => openNewPostModal(canPost));
};

async function loadPosts(dept) {
  const container = document.getElementById('posts-content');
  container.innerHTML = '<div class="loading-placeholder">Loading posts…</div>';
  try {
    let q = db.collection('posts').orderBy('createdAt','desc');
    if (dept === 'Pending') {
      q = db.collection('posts').where('status','==','pending').orderBy('createdAt','desc');
    } else if (dept === 'General') {
      q = db.collection('posts').where('dept','==','General').where('status','==','published').orderBy('createdAt','desc');
    } else {
      q = db.collection('posts').where('dept','==',dept).where('status','==','published').orderBy('createdAt','desc');
    }
    const snap = await q.limit(30).get();
    const posts = snap.docs.map(d => ({id:d.id,...d.data()}));
    if (!posts.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><h4>No posts yet</h4></div>';
      return;
    }
    const canApprove = isRealPresident() || currentRole === 'manager';
    // Store post data by id so edit button can retrieve it without fragile data-* encoding
    const postMap = new Map(posts.map(p => [p.id, p]));
    container.innerHTML = posts.map(p => {
      const ts = p.createdAt?.toDate ? p.createdAt.toDate().toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
      const isOwn = p.authorId === currentUser.uid;
      const hearts = p.hearts || [];
      const hearted = hearts.includes(currentUser.uid);
      // Memo mirror cards: internal announcements surfaced into the General feed.
      // They open the memo (with conforme) instead of behaving like a normal post.
      // Partners never load the General tab, so these stay internal-only.
      if (p.kind === 'memo' && p.memoId) {
        return `
        <div class="post-card post-memo-card" data-id="${p.id}" data-memo-id="${escHtml(p.memoId)}" style="cursor:pointer;border-left:3px solid var(--primary,#0A84FF)">
          <div class="post-header">
            <div class="post-avatar" style="background:rgba(10,132,255,0.12)">📋</div>
            <div class="post-meta">
              <div class="post-author">${escHtml(p.authorName||'Management')}</div>
              <div class="post-time">${escHtml(ts)} · Memo</div>
            </div>
            ${p.pinned ? '<span class="badge badge-blue">📌 Pinned</span>' : ''}
            <span class="badge badge-blue">📋 Memo</span>
          </div>
          ${p.title ? `<div class="post-title">${escHtml(p.title)}</div>` : ''}
          <div class="post-body">${escHtml((p.content||'').slice(0,200))}${(p.content||'').length>200?'…':''}</div>
          <div class="post-actions">
            <button class="btn-primary btn-sm post-memo-open" data-memo-id="${escHtml(p.memoId)}">📋 Read &amp; Conforme</button>
            <div style="display:flex;gap:6px;margin-left:auto">
              ${(canApprove || isOwn) ? `<button class="btn-secondary btn-sm post-delete-btn" data-id="${p.id}" style="color:var(--danger)">Delete</button>` : ''}
              ${canApprove ? `<button class="btn-secondary btn-sm post-pin-btn" data-id="${p.id}">${p.pinned?'Unpin':'📌 Pin'}</button>` : ''}
            </div>
          </div>
        </div>`;
      }
      return `
      <div class="post-card" data-id="${p.id}">
        <div class="post-header">
          <div class="post-avatar">${p.authorPhoto ? `<img src="${escHtml(p.authorPhoto)}"/>` : escHtml((p.authorName||'?')[0])}</div>
          <div class="post-meta">
            <div class="post-author">${escHtml(p.authorName||'Unknown')}</div>
            <div class="post-time">${escHtml(ts)}${p.dept&&p.dept!=='General'?` · ${escHtml(p.dept)}`:''}</div>
          </div>
          ${p.pinned ? '<span class="badge badge-blue">📌 Pinned</span>' : ''}
          ${p.status==='pending' ? '<span class="badge badge-orange">Pending</span>' : ''}
        </div>
        ${p.title ? `<div class="post-title">${escHtml(p.title)}</div>` : ''}
        <div class="post-body">${escHtml(p.content||'')}</div>
        ${safeHttpUrl(p.imageUrl) ? `<img src="${escHtml(p.imageUrl)}" class="post-image" data-img="${escHtml(p.imageUrl)}" style="cursor:zoom-in"/>` : ''}
        ${safeHttpUrl(p.fileUrl) ? `<a href="${escHtml(p.fileUrl)}" target="_blank" rel="noopener noreferrer" class="post-attachment">📎 ${escHtml(p.fileName||'Attachment')}</a>` : ''}
        <div class="post-actions">
          ${p.status==='published' ? `
            <button class="post-heart-btn${hearted?' hearted':''}" data-id="${p.id}" title="${hearted?'Unlike':'Like'}">
              <svg class="heart-svg" viewBox="0 0 24 24" fill="${hearted?'#FF6B2B':'none'}" stroke="${hearted?'#FF6B2B':'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              ${hearts.length ? `<span class="heart-count">${hearts.length}</span>` : '<span class="heart-count" style="display:none">0</span>'}
            </button>
            ${hearts.length ? `<button class="post-likers-btn btn-link" data-id="${p.id}" data-hearts='${JSON.stringify(hearts)}' style="font-size:12px;color:var(--text-muted);padding:0 4px;background:none;border:none;cursor:pointer"></button>` : ''}
          ` : ''}
          ${canApprove && p.status==='pending' ? `
            <button class="btn-primary btn-sm post-approve-btn" data-id="${p.id}">✓ Approve</button>
            <button class="btn-secondary btn-sm post-reject-btn" data-id="${p.id}">✗ Reject</button>
          ` : ''}
          <div style="display:flex;gap:6px;margin-left:auto">
            ${isOwn ? `<button class="btn-secondary btn-sm post-edit-btn" data-id="${p.id}">✎ Edit</button>` : ''}
            ${(canApprove || isOwn) ? `<button class="btn-secondary btn-sm post-delete-btn" data-id="${p.id}" style="color:var(--danger)">Delete</button>` : ''}
            ${canApprove && p.status==='published' ? `<button class="btn-secondary btn-sm post-pin-btn" data-id="${p.id}">${p.pinned?'Unpin':'📌 Pin'}</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons({nodes:[container]});

    // Open post image in a new tab — URL validated to http(s) only, wired via
    // addEventListener so the raw URL never lands in an inline onclick string.
    container.querySelectorAll('.post-image[data-img]').forEach(img => img.addEventListener('click', () => {
      const safe = safeHttpUrl(img.dataset.img);
      if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
    }));

    container.querySelectorAll('.post-approve-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;
      const postSnap = await db.collection('posts').doc(id).get();
      if (!postSnap.exists) { Notifs.showToast('Post no longer exists.', 'error'); loadPosts(dept); return; }
      const post = postSnap.data();
      await db.collection('posts').doc(id).update({status:'published'});
      await Notifs.send(post.authorId, {title:'Post Approved', body:`Your post "${post.title||post.content?.slice(0,30)}" was approved!`, icon:'✅', type:'post'});
      Notifs.showToast('Post approved!');
      loadPosts(dept);
    }));
    container.querySelectorAll('.post-reject-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;
      await db.collection('posts').doc(id).update({status:'rejected'});
      Notifs.showToast('Post rejected.');
      loadPosts(dept);
    }));
    container.querySelectorAll('.post-delete-btn').forEach(btn => btn.addEventListener('click', async e => {
      if (!confirm('Delete this post?')) return;
      await db.collection('posts').doc(e.target.dataset.id).delete();
      Notifs.showToast('Deleted.');
      loadPosts(dept);
    }));
    container.querySelectorAll('.post-pin-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;
      const snap = await db.collection('posts').doc(id).get();
      await db.collection('posts').doc(id).update({pinned: !snap.data().pinned});
      loadPosts(dept);
    }));
    container.querySelectorAll('.post-heart-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id = btn.dataset.id;
      const isHearted = btn.classList.contains('hearted');
      const countEl = btn.querySelector('.heart-count');
      const svg = btn.querySelector('.heart-svg');

      // Optimistic UI update — instant feedback
      btn.classList.toggle('hearted', !isHearted);
      const currentCount = parseInt(countEl?.textContent || '0') || 0;
      const newCount = isHearted ? Math.max(0, currentCount - 1) : currentCount + 1;
      if (countEl) { countEl.textContent = newCount; countEl.style.display = newCount > 0 ? '' : 'none'; }
      if (svg) {
        svg.setAttribute('fill', !isHearted ? '#FF6B2B' : 'none');
        svg.setAttribute('stroke', !isHearted ? '#FF6B2B' : 'currentColor');
      }
      // Bounce animation
      btn.classList.add('heart-pop');
      btn.addEventListener('animationend', () => btn.classList.remove('heart-pop'), { once: true });

      // Persist to Firestore
      const uid = currentUser.uid;
      const op = isHearted
        ? firebase.firestore.FieldValue.arrayRemove(uid)
        : firebase.firestore.FieldValue.arrayUnion(uid);
      await db.collection('posts').doc(id).update({ hearts: op });
    }));

    // Show likers list
    container.querySelectorAll('.post-likers-btn').forEach(btn => btn.addEventListener('click', async () => {
      let uids = [];
      try { uids = JSON.parse(btn.dataset.hearts); } catch{}
      if (!uids.length) return;
      openModal('❤️ Liked by', '<div class="loading-placeholder">Loading…</div>');
      const names = await Promise.all(uids.map(uid =>
        db.collection('users').doc(uid).get().then(s => s.exists ? (s.data().displayName || s.data().email) : uid).catch(()=>uid)
      ));
      document.getElementById('modal-body').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${names.map(n=>`<div style="display:flex;align-items:center;gap:8px;font-size:14px"><span style="font-size:20px">❤️</span>${escHtml(n)}</div>`).join('')}
        </div>`;
    }));

    // Edit post
    container.querySelectorAll('.post-edit-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id      = btn.dataset.id;
      const post    = postMap.get(id) || {};
      const oldTitle   = post.title || '';
      const oldContent = post.content || '';
      openModal('✎ Edit Post', `
        <div class="form-group"><label>Title (optional)</label><input id="edit-post-title" placeholder="Post title…"/></div>
        <div class="form-group"><label>Content</label><textarea id="edit-post-content" rows="5" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical"></textarea></div>
      `, `<button class="btn-primary" id="save-post-edit-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('edit-post-title').value   = oldTitle;
      document.getElementById('edit-post-content').value = oldContent;
      document.getElementById('save-post-edit-btn').addEventListener('click', async () => {
        const title   = document.getElementById('edit-post-title').value.trim();
        const content = document.getElementById('edit-post-content').value.trim();
        if (!content) { Notifs.showToast('Content required','error'); return; }
        await db.collection('posts').doc(id).update({
          title, content,
          editedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal();
        Notifs.showToast('Post updated!');
        loadPosts(dept);
      });
    }));

    // Memo mirror cards → open the memo detail (conforme is given there). Reload
    // the feed afterward so a fresh conforme/delete is reflected.
    const reloadFeed = () => loadPosts(dept);
    container.querySelectorAll('.post-memo-open').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      window.openMemoById?.(btn.dataset.memoId, reloadFeed);
    }));
    container.querySelectorAll('.post-memo-card').forEach(card => card.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('a')) return;
      window.openMemoById?.(card.dataset.memoId, reloadFeed);
    }));
  } catch(err) {
    container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}

function openNewPostModal(publishDirectly) {
  openModal(publishDirectly ? 'New Post' : 'Submit Post for Approval', `
    <div class="form-group"><label>Title (optional)</label><input id="post-title" placeholder="Post title…"/></div>
    <div class="form-group"><label>Content</label><textarea id="post-content" rows="5" placeholder="Write your message…" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);color:var(--text);resize:vertical"></textarea></div>
    <div class="form-group"><label>Department</label>
      <select id="post-dept" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="General">General (All Staff)</option>
        ${Object.keys(window.DEPARTMENTS||{}).map(d=>`<option value="${d}">${d}</option>`).join('')}
      </select>
    </div>
    <div id="post-file-area"></div>
  `, `<button class="btn-primary" id="save-post-btn">${publishDirectly ? 'Publish' : 'Submit for Approval'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  let uploadedFile = null;
  Drive.renderUploadArea('post-file-area', r => { uploadedFile = r; }, { label: 'Attach image or file', dept: 'posts', subfolder: 'attachments' });

  document.getElementById('save-post-btn').addEventListener('click', async () => {
    const content = document.getElementById('post-content').value.trim();
    if (!content) { Notifs.showToast('Write something first.', 'error'); return; }
    const dept = document.getElementById('post-dept').value;
    const status = publishDirectly ? 'published' : 'pending';
    await db.collection('posts').add({
      title:       document.getElementById('post-title').value.trim(),
      content,
      dept,
      status,
      authorId:    currentUser.uid,
      authorName:  userProfile.displayName || currentUser.email,
      authorPhoto: userProfile.photoUrl || null,
      pinned:      false,
      imageUrl:    uploadedFile && /\.(jpe?g|png|gif|webp|svg)$/i.test(uploadedFile.name) ? uploadedFile.url : null,
      fileName:    uploadedFile?.name || null,
      fileUrl:     uploadedFile && !/\.(jpe?g|png|gif|webp|svg)$/i.test(uploadedFile.name) ? uploadedFile.url : null,
      createdAt:   firebase.firestore.FieldValue.serverTimestamp()
    });
    if (status === 'published') {
      await Notifs.sendToAll({title:`📣 New Post`, body:`${userProfile.displayName||'Someone'} posted: ${document.getElementById('post-title').value.trim()||content.slice(0,40)}`, icon:'📣', type:'post'});
    } else {
      await Notifs.sendToOwner({title:'New Post Awaiting Approval', body:`${userProfile.displayName} submitted a post for review.`, icon:'📋', type:'post_approval'});
    }
    closeModal();
    Notifs.showToast(status==='published' ? 'Post published!' : 'Submitted for approval!');
    window.renderPosts();
  });
}

// ══════════════════════════════════════════════════
//  TEAM TAB — Aesthetic redesign with notes + calling cards
// ══════════════════════════════════════════════════

window.renderTeamTab = async function() {
  const c = document.getElementById('page-content');
  const pres = currentRole === 'president' || currentRole === 'manager' || currentRole === 'finance';
  const viewingAsPartner = typeof isPartner === 'function' && isPartner();
  // Employee of the Month is a Barro Industries-only recognition: hidden from the
  // external partner (Brilliant Steel) view, and only the President can set it.
  const canManageEom = currentRole === 'president' && !viewingAsPartner;
  c.innerHTML = `
    <div class="page-header">
      <h2>👥 Team</h2>
      ${pres && !viewingAsPartner ? '<button class="btn-primary btn-sm" id="invite-user-btn">+ Invite Member</button>' : ''}
    </div>
    ${!viewingAsPartner ? '<div id="eom-banner"></div>' : ''}
    <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">
      <input id="team-search" placeholder="Search name, role or department…" class="ms-input" style="max-width:320px"/>
      <button class="btn-secondary btn-sm" id="set-note-btn" style="white-space:nowrap">✏️ Set My Note</button>
    </div>
    <div id="team-grid"></div>
  `;

  const snap = typeof dbCachedGet === 'function'
    ? await dbCachedGet('users', () => db.collection('users').get(), 60000)
    : await db.collection('users').get();
  const users = snap.docs.map(d=>({id:d.id,...d.data()}))
    .filter(u => {
      if (viewingAsPartner) {
        // Partners only see other partners
        return u.role === 'partner';
      }
      // Admin/employees see the full team (including partners)
      // Hide Brilliant Steel-only staff (internal operational filter)
      if (Array.isArray(u.departments) && u.departments.length===1 && u.departments[0]==='Brilliant Steel') return false;
      return true;
    })
    .sort((a,b) => {
      const order = {president:0,manager:1,finance:2,employee:3,agent:4,partner:5};
      return (order[a.role]??6) - (order[b.role]??6);
    });

  renderTeamCards(users, currentUser);

  if (!viewingAsPartner) renderEomBanner(users, canManageEom);

  document.getElementById('team-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = q ? users.filter(u =>
      (u.displayName||'').toLowerCase().includes(q) ||
      (u.role||'').toLowerCase().includes(q) ||
      (Array.isArray(u.departments)?u.departments:u.department?[u.department]:[]).join(' ').toLowerCase().includes(q)
    ) : users;
    renderTeamCards(filtered, currentUser);
  });

  // Set Note (IG-style status)
  document.getElementById('set-note-btn').addEventListener('click', () => {
    const me = users.find(u => u.id === currentUser.uid);
    const current = me?.statusNote || '';
    openModal('✏️ Set Your Note', `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Share a quick status — what you're working on, your mood, or a quick update. Visible to everyone.</p>
      <div class="form-group">
        <input id="note-input" maxlength="60" placeholder="e.g. In a meeting until 3pm…" value="${escHtml(current)}"/>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;text-align:right"><span id="note-count">${current.length}</span>/60</div>
      </div>
    `, `<button class="btn-primary" id="save-note-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Clear Note</button>`);
    document.getElementById('note-input').addEventListener('input', e => {
      document.getElementById('note-count').textContent = e.target.value.length;
    });
    document.getElementById('save-note-btn').addEventListener('click', async () => {
      const note = document.getElementById('note-input').value.trim();
      await db.collection('users').doc(currentUser.uid).update({ statusNote: note });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('users');
      closeModal(); Notifs.showToast('Note updated!');
      window.renderTeamTab();
    });
    // "Clear Note" = close and clear
    document.querySelector('#modal-footer .btn-secondary').onclick = async () => {
      await db.collection('users').doc(currentUser.uid).update({ statusNote: '' });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('users');
      closeModal(); Notifs.showToast('Note cleared');
      window.renderTeamTab();
    };
  });

  if (pres) {
    document.getElementById('invite-user-btn')?.addEventListener('click', () => {
      openModal('Invite Team Member', `
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">They'll receive a password reset email to set their own password.</p>
        <div class="form-group"><label>Email</label><input id="inv-email" type="email" placeholder="employee@barroindustries.com"/></div>
        <div class="form-group"><label>Display Name</label><input id="inv-name" placeholder="Full name"/></div>
        <div class="form-group"><label>Phone</label><input id="inv-phone" type="tel" placeholder="+63 9XX XXX XXXX"/></div>
        <div class="form-group"><label>Role</label>
          <select id="inv-role" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            ${Object.entries(window.ROLES||{}).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Department(s)</label>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:4px">
            ${Object.keys(window.DEPARTMENTS||{}).map(d=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" class="inv-dept-cb" value="${d}"/>${d}</label>`).join('')}
          </div>
        </div>
      `, `<button class="btn-primary" id="save-inv-btn">Send Invite</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-inv-btn').addEventListener('click', async () => {
        const email = document.getElementById('inv-email').value.trim();
        if (!email) { Notifs.showToast('Enter an email.','error'); return; }
        const depts = [...document.querySelectorAll('.inv-dept-cb:checked')].map(cb=>cb.value);
        try {
          // Use a secondary app instance so the admin session is not replaced
          const secondaryApp = firebase.initializeApp(window.firebaseConfig, `invite-${Date.now()}`);
          const tempPass = Array.from(crypto.getRandomValues(new Uint8Array(12)))
            .map(b => b.toString(36)).join('').slice(0, 10);
          const cred = await secondaryApp.auth().createUserWithEmailAndPassword(email, tempPass);
          const uid = cred.user.uid;
          await secondaryApp.delete();
          // Atomic counter so concurrent invites never collide on the same employee ID
          const counterRef = db.collection('_counters').doc('employees');
          const empId = await db.runTransaction(async t => {
            const snap = await t.get(counterRef);
            const next = (snap.exists ? snap.data().count : 0) + 1;
            t.set(counterRef, { count: next }, { merge: true });
            return `BI-${window.bizYear()}-${String(next).padStart(3,'0')}`;
          });
          await db.collection('users').doc(uid).set({
            uid, email,
            displayName: document.getElementById('inv-name').value.trim() || email.split('@')[0],
            phone: document.getElementById('inv-phone').value.trim(),
            role:        document.getElementById('inv-role').value,
            departments: depts, department: depts[0]||'',
            employeeId:  empId,
            photoUrl:'', startDate: window.bizDate(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          await auth.sendPasswordResetEmail(email);
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('users');
          closeModal();
          Notifs.showToast(`Invite sent to ${email}!`);
          window.renderTeamTab();
        } catch(err) { Notifs.showToast('Error: '+err.message,'error'); }
      });
    });
  }
};

// ── Employee of the Month (Barro Industries only) ─────────────────────
// Stored as a single doc settings/employeeOfMonth (rules: read=any auth,
// write/delete=President only). Snapshots name/photo/role at award time so it
// survives profile changes, but prefers live user data when still on the team.
function eomMonthLabel(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

async function renderEomBanner(users, canManage) {
  const host = document.getElementById('eom-banner');
  if (!host) return;
  let eom = null;
  try {
    const doc = await db.collection('settings').doc('employeeOfMonth').get();
    eom = doc.exists ? doc.data() : null;
  } catch (e) { /* read failure → render nothing (or the empty prompt for President) */ }

  if (!eom || !eom.uid) {
    host.innerHTML = canManage ? `
      <div class="eom-banner eom-banner--empty">
        <div class="eom-empty-icon">🏆</div>
        <div class="eom-empty-text">
          <strong>Employee of the Month</strong>
          <span>Recognise a standout Barro Industries team member.</span>
        </div>
        <button class="btn-primary btn-sm" id="eom-set-btn">Set Awardee</button>
      </div>` : '';
    document.getElementById('eom-set-btn')?.addEventListener('click', () => openEomModal(users, eom));
    return;
  }

  // Prefer live profile (fresher photo/name) but fall back to the stored snapshot.
  const live = users.find(u => u.id === eom.uid);
  const name = live?.displayName || eom.displayName || eom.email || 'Team member';
  const photoUrl = live?.photoUrl || eom.photoUrl || '';
  const role = live?.role || eom.role;
  const roleLabel = window.ROLES?.[role]?.label || role || 'Employee';
  const deptsArr = live
    ? (Array.isArray(live.departments) && live.departments.length ? live.departments : (live.department ? [live.department] : []))
    : (eom.departments || []);
  const depts = deptsArr.join(' · ') || 'Barro Industries';
  const initials = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  host.innerHTML = `
    <div class="eom-banner">
      <div class="eom-ribbon">🏆 Employee of the Month${eom.month ? ` · ${escHtml(eomMonthLabel(eom.month))}` : ''}</div>
      <div class="eom-body">
        <div class="eom-avatar">
          ${photoUrl ? `<img src="${escHtml(photoUrl)}" alt="${escHtml(name)}"/>` : `<span>${escHtml(initials)}</span>`}
        </div>
        <div class="eom-info">
          <div class="eom-name">${escHtml(name)}</div>
          <div class="eom-role">${escHtml(roleLabel)} · ${escHtml(depts)}</div>
          ${eom.reason ? `<div class="eom-reason">“${escHtml(eom.reason)}”</div>` : ''}
        </div>
        ${canManage ? `<button class="eom-edit-btn" id="eom-set-btn" title="Change awardee">✏️</button>` : ''}
      </div>
    </div>`;
  document.getElementById('eom-set-btn')?.addEventListener('click', () => openEomModal(users, eom));
}

function openEomModal(users, current) {
  // Candidates: internal Barro Industries staff only — exclude external partners
  // and Brilliant Steel-only members (the award is Barro Industries-specific).
  const candidates = users
    .filter(u => u.role !== 'partner'
      && !(Array.isArray(u.departments) && u.departments.length === 1 && u.departments[0] === 'Brilliant Steel'))
    .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''));

  const curUid = current?.uid || '';
  const curReason = current?.reason || '';
  openModal('🏆 Employee of the Month', `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Recognise an outstanding Barro Industries team member. Shown to everyone on the Team page.</p>
    <div class="form-group">
      <label>Awardee</label>
      <select id="eom-user" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="">— Select a team member —</option>
        ${candidates.map(u => `<option value="${u.id}" ${u.id === curUid ? 'selected' : ''}>${escHtml(u.displayName || u.email)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Citation <span style="color:var(--text-muted);font-weight:400">(optional)</span></label>
      <textarea id="eom-reason" maxlength="160" rows="2" placeholder="e.g. Outstanding dedication on the Q2 production rollout." style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);resize:vertical;font-family:inherit">${escHtml(curReason)}</textarea>
    </div>
  `, `<button class="btn-primary" id="eom-save-btn">Save</button>${curUid ? '<button class="btn-secondary" id="eom-clear-btn">Clear Award</button>' : '<button class="btn-secondary" onclick="closeModal()">Cancel</button>'}`);

  document.getElementById('eom-save-btn').addEventListener('click', async () => {
    const uid = document.getElementById('eom-user').value;
    if (!uid) { Notifs.showToast('Select a team member.', 'error'); return; }
    const u = users.find(x => x.id === uid);
    if (!u) { Notifs.showToast('User not found.', 'error'); return; }
    const reason = document.getElementById('eom-reason').value.trim();
    const month = window.bizDate().slice(0, 7);
    try {
      await db.collection('settings').doc('employeeOfMonth').set({
        uid,
        displayName: u.displayName || u.email || '',
        email: u.email || '',
        photoUrl: u.photoUrl || '',
        role: u.role || 'employee',
        departments: Array.isArray(u.departments) && u.departments.length ? u.departments : (u.department ? [u.department] : []),
        reason,
        month,
        setBy: currentUser.uid,
        setByName: window.userProfile?.displayName || currentUser?.displayName || '',
        setAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal();
      Notifs.showToast(`${u.displayName || u.email} is Employee of the Month! 🏆`);
      // Congratulate the awardee (skip if the President named themselves).
      if (uid !== currentUser.uid && Notifs?.send) {
        Notifs.send(uid, {
          title: '🏆 Employee of the Month!',
          body: `Congratulations! You've been named Barro Industries Employee of the Month for ${eomMonthLabel(month)}.`,
          icon: '🏆', type: 'award',
          dedupKey: `eom-${uid}-${month}`
        });
      }
      window.renderTeamTab();
    } catch (err) { Notifs.showToast('Error: ' + err.message, 'error'); }
  });

  document.getElementById('eom-clear-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear the current Employee of the Month?')) return;
    try {
      await db.collection('settings').doc('employeeOfMonth').delete();
      closeModal();
      Notifs.showToast('Award cleared.');
      window.renderTeamTab();
    } catch (err) { Notifs.showToast('Error: ' + err.message, 'error'); }
  });
}

function showCallingCard(u) {
  const roleLabel = window.ROLES?.[u.role]?.label || u.role || 'Employee';
  const depts = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(' · ') || 'Unassigned';
  const initials = (u.displayName||u.email||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  openModal(`📇 ${u.displayName||u.email}`, `
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px;padding:28px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px">
      ${u.photoUrl
        ? `<img src="${escHtml(u.photoUrl)}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.3);margin-bottom:4px" alt=""/>`
        : `<div style="width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:#fff;margin-bottom:4px">${escHtml(initials)}</div>`}
      <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:.5px">${escHtml(u.displayName||u.email)}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.7);font-weight:600;text-transform:uppercase;letter-spacing:.08em">${roleLabel}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5)">${escHtml(depts)}</div>
      <div style="width:100%;height:1px;background:rgba(255,255,255,0.15);margin:8px 0"></div>
      ${u.email?`<div style="font-size:13px;color:rgba(255,255,255,0.8)">✉️ ${escHtml(u.email)}</div>`:''}
      ${u.phone?`<div style="font-size:13px;color:rgba(255,255,255,0.8)">📞 ${escHtml(u.phone)}</div>`:''}
      ${u.employeeId?`<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;letter-spacing:.1em">${u.employeeId}</div>`:''}
      <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:6px;letter-spacing:.15em">BARRO INDUSTRIES</div>
    </div>
  `);
}

function renderTeamCards(users, currentUser) {
  const grid = document.getElementById('team-grid');
  if (!grid) return;
  if (!users.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><h4>No team members found</h4></div>';
    return;
  }
  const now = Date.now();

  grid.innerHTML = `<div class="team-masonry">${users.map(u => {
    const depts = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(' · ') || 'Unassigned';
    const initial = (u.displayName||u.email||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const roleLabel = window.ROLES?.[u.role]?.label || u.role || 'Employee';
    const badgeColor = {president:'#9BA8FF',manager:'#30D158',finance:'#FFD60A',employee:'#0A84FF',agent:'#FF9F0A',partner:'#FF6B6B'}[u.role] || '#8E8E93';
    const isMe = u.id === currentUser?.uid;

    const lastSeenMs = u.lastSeen?.toMillis?.() || (u.lastSeen?.seconds ? u.lastSeen.seconds*1000 : 0);
    const diffMin = lastSeenMs ? Math.floor((now - lastSeenMs)/60000) : null;
    const isOnline = diffMin !== null && diffMin < 5;
    const lastActiveStr = diffMin === null ? 'Never' :
      diffMin < 1 ? 'Just now' :
      diffMin < 60 ? `${diffMin}m ago` :
      diffMin < 1440 ? `${Math.floor(diffMin/60)}h ago` :
      `${Math.floor(diffMin/1440)}d ago`;

    const statusNote = u.statusNote?.trim();

    return `
    <div class="team-member-card" data-uid="${u.id}">
      ${statusNote ? `
        <div class="team-note-bubble">
          <span>${escHtml(statusNote)}</span>
        </div>` : ''}
      <div class="team-member-avatar-wrap">
        <div class="team-member-avatar">
          ${u.photoUrl
            ? `<img src="${escHtml(u.photoUrl)}" alt="${escHtml(u.displayName||'')}"/>`
            : `<span>${escHtml(initial)}</span>`}
        </div>
        <span class="team-online-dot ${isOnline?'team-online-dot--on':'team-online-dot--off'}" title="${isOnline?'Online':'Last active: '+lastActiveStr}"></span>
      </div>
      <div class="team-member-name">${escHtml(u.displayName||u.email)}</div>
      <div class="team-member-role" style="color:${badgeColor}">${roleLabel}${isMe?' · You':''}</div>
      <div class="team-member-dept">${escHtml(depts)}</div>
      ${isOnline
        ? `<div class="team-status-pill team-status-pill--on">● Online</div>`
        : lastSeenMs ? `<div class="team-status-pill">${lastActiveStr}</div>` : ''}
      <div class="team-card-actions">
        <button class="team-card-btn view-card-btn" data-uid="${u.id}" title="View calling card">📇</button>
        ${!isMe ? `<button class="team-card-btn nudge-btn" data-uid="${u.id}" data-name="${(u.displayName||u.email).replace(/"/g,'&quot;')}" title="Nudge ${escHtml(u.displayName||u.email)}">👋</button>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;

  // Wire up calling card buttons
  grid.querySelectorAll('.view-card-btn').forEach(btn => {
    const u = users.find(x => x.id === btn.dataset.uid);
    if (u) btn.addEventListener('click', e => { e.stopPropagation(); showCallingCard(u); });
  });

  // Nudge buttons
  grid.querySelectorAll('.nudge-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { uid, name } = btn.dataset;
      if (!confirm(`Send a nudge to ${name}?`)) return;
      btn.disabled = true; btn.textContent = '⏳';
      const senderName = window.userProfile?.displayName || currentUser?.displayName || 'Someone';
      await Notifs.send(uid, {
        title: `👋 You've been nudged!`,
        body: `${senderName} is trying to get your attention. Check in when you can.`,
        icon: '👋', type: 'nudge',
        dedupKey: `nudge-${uid}-${window.bizDate()}-${currentUser?.uid}`
      });
      btn.textContent = '✅'; btn.title = 'Nudge sent!';
      Notifs.showToast(`Nudge sent to ${name}!`);
      setTimeout(() => { btn.disabled = false; btn.textContent = '👋'; btn.title = `Nudge ${name}`; }, 3000);
    });
  });

  // Whole card click also opens calling card
  grid.querySelectorAll('.team-member-card').forEach(card => {
    card.addEventListener('click', () => {
      const u = users.find(x => x.id === card.dataset.uid);
      if (u) showCallingCard(u);
    });
  });
}

// ══════════════════════════════════════════════════
//  PHILIPPINE HOLIDAY LIST
// ══════════════════════════════════════════════════
function getPHHolidays(year) {
  // Static holidays + computed ones
  const holidays = {
    // ── Regular Holidays ──
    [`${year}-01-01`]: { name:'New Year\'s Day', type:'regular' },
    [`${year}-04-09`]: { name:'Araw ng Kagitingan', type:'regular' },
    [`${year}-05-01`]: { name:'Labor Day', type:'regular' },
    [`${year}-06-12`]: { name:'Independence Day', type:'regular' },
    [`${year}-11-30`]: { name:'Bonifacio Day', type:'regular' },
    [`${year}-12-25`]: { name:'Christmas Day', type:'regular' },
    [`${year}-12-30`]: { name:'Rizal Day', type:'regular' },
    // ── Special Non-Working Holidays ──
    [`${year}-02-25`]: { name:'EDSA People Power Revolution', type:'special' },
    [`${year}-08-21`]: { name:'Ninoy Aquino Day', type:'special' },
    [`${year}-11-01`]: { name:'All Saints\' Day', type:'special' },
    [`${year}-11-02`]: { name:'All Souls\' Day', type:'special' },
    [`${year}-12-08`]: { name:'Feast of the Immaculate Conception', type:'special' },
    [`${year}-12-24`]: { name:'Christmas Eve', type:'special' },
    [`${year}-12-31`]: { name:'New Year\'s Eve', type:'special' },
  };
  // National Heroes Day (last Monday of August)
  const aug = new Date(year, 7, 31);
  while (aug.getDay() !== 1) aug.setDate(aug.getDate()-1);
  // Format from local components — toISOString() would shift the day in +offset TZ.
  const augStr = `${aug.getFullYear()}-${String(aug.getMonth()+1).padStart(2,'0')}-${String(aug.getDate()).padStart(2,'0')}`;
  holidays[augStr] = { name:'National Heroes Day', type:'regular' };

  // Holy Week — Maundy Thursday (special), Good Friday (regular), Black Saturday (special)
  const holyWeek = {
    2024: { thu:'2024-03-28', fri:'2024-03-29', sat:'2024-03-30' },
    2025: { thu:'2025-04-17', fri:'2025-04-18', sat:'2025-04-19' },
    2026: { thu:'2026-04-02', fri:'2026-04-03', sat:'2026-04-04' },
    2027: { thu:'2027-03-25', fri:'2027-03-26', sat:'2027-03-27' },
    2028: { thu:'2028-04-13', fri:'2028-04-14', sat:'2028-04-15' },
  };
  if (holyWeek[year]) {
    holidays[holyWeek[year].thu] = { name:'Maundy Thursday', type:'special' };
    holidays[holyWeek[year].fri] = { name:'Good Friday', type:'regular' };
    holidays[holyWeek[year].sat] = { name:'Black Saturday', type:'special' };
  }

  // Chinese New Year (first day of the lunar new year — fixed known dates)
  const chineseNY = {
    2024:'2024-02-10', 2025:'2025-01-29', 2026:'2026-02-17',
    2027:'2027-02-06', 2028:'2028-01-26',
  };
  if (chineseNY[year]) {
    holidays[chineseNY[year]] = { name:'Chinese New Year', type:'special' };
  }

  // Eid ul-Fitr (end of Ramadan — approximate, subject to moon sighting proclamation)
  const eidAlFitr = {
    2024:'2024-04-10', 2025:'2025-03-31', 2026:'2026-03-20',
    2027:'2027-03-09', 2028:'2028-02-26',
  };
  if (eidAlFitr[year]) {
    holidays[eidAlFitr[year]] = { name:'Eid\'l Fitr (End of Ramadan)', type:'regular' };
  }

  // Eid ul-Adha (Feast of Sacrifice — approximate, subject to proclamation)
  const eidAlAdha = {
    2024:'2024-06-17', 2025:'2025-06-07', 2026:'2026-05-27',
    2027:'2027-05-17', 2028:'2028-05-05',
  };
  if (eidAlAdha[year]) {
    holidays[eidAlAdha[year]] = { name:'Eid\'l Adha (Feast of Sacrifice)', type:'regular' };
  }

  return holidays;
}

// ══════════════════════════════════════════════════
//  ATTENDANCE CALENDAR (full-page)
// ══════════════════════════════════════════════════

window.renderAttendancePage = async function() {
  const c = document.getElementById('page-content');
  const pres = currentRole === 'president' || currentRole === 'manager' || currentRole === 'finance';

  c.innerHTML = `
    <div class="page-header">
      <h2>📅 Attendance</h2>
      ${pres ? `<select id="att-emp-select" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px"><option value="">Loading…</option></select>` : ''}
    </div>
    ${pres ? `<div id="att-ext-requests" style="margin-bottom:14px"></div>` : ''}
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <button class="btn-secondary btn-sm" id="att-prev-month">‹</button>
      <span id="att-month-label" style="font-weight:700;font-size:15px;min-width:140px;text-align:center"></span>
      <button class="btn-secondary btn-sm" id="att-next-month">›</button>
    </div>
    <div id="att-legend" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;font-size:12px">
      <span><span class="att-dot att-present"></span> Present (100%)</span>
      <span><span class="att-dot att-half"></span> Half Day (50%)</span>
      <span><span class="att-dot att-absent"></span> Absent</span>
      <span><span class="att-dot att-holiday" style="background:rgba(255,214,0,0.6)"></span> Holiday (no work)</span>
      <span><span class="att-dot" style="background:var(--surface2);border:1px solid var(--border)"></span> Sunday (no work)</span>
      <span style="color:var(--text-muted);font-style:italic">Saturdays are work days</span>
    </div>
    <div id="att-calendar"></div>
    <div id="att-summary" class="card" style="margin-top:16px"></div>
  `;

  let targetUid = currentUser.uid;
  let targetName = userProfile.displayName || currentUser.email;
  // Anchor the default view month to Manila's current calendar month, not the
  // device's — otherwise opening the page near midnight abroad shows the wrong month.
  const bizToday = window.bizDate(); // "YYYY-MM-DD" in Manila
  let viewYear  = parseInt(bizToday.slice(0,4), 10);
  let viewMonth = parseInt(bizToday.slice(5,7), 10) - 1;

  if (pres) {
    const usersSnap = typeof dbCachedGet === 'function'
      ? await dbCachedGet('users', () => db.collection('users').get(), 60000)
      : await db.collection('users').get();
    const empList = usersSnap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(u => u.role !== 'partner');
    const sel = document.getElementById('att-emp-select');
    sel.innerHTML = empList.map(u=>`<option value="${u.id}">${escHtml(u.displayName||u.email)}</option>`).join('');
    sel.value = currentUser.uid;
    sel.addEventListener('change', () => {
      const picked = empList.find(u=>u.id===sel.value);
      targetUid  = sel.value;
      targetName = picked?.displayName || picked?.email || '';
      renderAttMonth();
    });
  }

  // ── Extension requests (president/manager only) ──
  async function loadExtensionRequests() {
    const extEl = document.getElementById('att-ext-requests');
    if (!extEl) return;
    // Approving/denying mutates attendance_extensions — keep the dashboard's
    // cached pending count fresh.
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('att-ext-pending');
    const todayStr = window.bizDate();
    const snap = await db.collection('attendance_extensions')
      .where('date','==',todayStr).where('status','==','pending').get().catch(()=>({docs:[]}));
    if (snap.docs.length === 0) { extEl.innerHTML = ''; return; }
    const requests = snap.docs.map(d=>({id:d.id,...d.data()}));
    extEl.innerHTML = `
      <div class="card" style="border:1.5px solid rgba(255,159,10,.35);background:rgba(255,159,10,.05)">
        <div class="card-header"><h3 style="color:rgba(255,159,10,.9)">⏰ Pending Extension Requests (${requests.length})</h3></div>
        <div class="card-body" style="padding:0">
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Employee</th><th>Date</th><th>Requested</th><th></th></tr></thead>
            <tbody>${requests.map(r=>`<tr>
              <td><strong>${escHtml(r.userName||'—')}</strong></td>
              <td>${r.date||'—'}</td>
              <td>${r.requestedAt ? new Date(r.requestedAt.toDate()).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
              <td style="white-space:nowrap">
                <button class="btn-primary btn-sm ext-approve-btn" data-id="${r.id}" data-uid="${r.uid}" data-name="${escHtml(r.userName||'')}">✓ Approve</button>
                <button class="btn-danger btn-sm ext-deny-btn" data-id="${r.id}" data-uid="${r.uid}" style="margin-left:4px">✕ Deny</button>
              </td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>`;

    extEl.querySelectorAll('.ext-approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Approving…';
        const approvedAt = new Date();
        const expiresAt  = new Date(approvedAt.getTime() + 6 * 60 * 60 * 1000); // +6 hrs
        await db.collection('attendance_extensions').doc(btn.dataset.id).update({
          status:     'approved',
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
          expiresAt:  firebase.firestore.Timestamp.fromDate(expiresAt),
          approvedBy: currentUser.uid
        });
        await Notifs.send(btn.dataset.uid, {
          title: '✅ Attendance Extension Approved',
          body:  `Your Time In extension is approved. You have until ${expiresAt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',timeZone:window.BIZ_TZ})} to time in and complete notifications.`,
          icon: '✅', type: 'att_extension_approved'
        });
        Notifs.showToast(`Extension approved for ${btn.dataset.name||'employee'}`);
        loadExtensionRequests();
      });
    });

    extEl.querySelectorAll('.ext-deny-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Deny this extension request?')) return;
        btn.disabled = true;
        await db.collection('attendance_extensions').doc(btn.dataset.id).update({
          status: 'denied', deniedBy: currentUser.uid,
          deniedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await Notifs.send(btn.dataset.uid, {
          title: '❌ Attendance Extension Denied',
          body:  `Your extension request for ${new Date().toLocaleDateString('en-PH',{month:'short',day:'numeric',timeZone:window.BIZ_TZ})} was not approved.`,
          icon: '❌', type: 'att_extension_denied'
        });
        Notifs.showToast('Extension denied');
        loadExtensionRequests();
      });
    });
  }

  if (pres) loadExtensionRequests();

  async function renderAttMonth() {
    const calEl  = document.getElementById('att-calendar');
    const sumEl  = document.getElementById('att-summary');
    calEl.innerHTML = '<div class="loading-placeholder">Loading…</div>';
    const label = new Date(viewYear, viewMonth).toLocaleString('en-PH',{month:'long',year:'numeric'});
    document.getElementById('att-month-label').textContent = label;

    const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
    const mm = String(viewMonth+1).padStart(2,'0');
    const monthStart = `${viewYear}-${mm}-01`;
    // Build the last-day string directly — toISOString() on a local midnight Date
    // shifts back a day in +offset timezones (Manila +8) and broke the range query.
    const monthEnd   = `${viewYear}-${mm}-${String(daysInMonth).padStart(2,'0')}`;
    const snap = await db.collection('attendance').doc(targetUid).collection('records')
      .where(firebase.firestore.FieldPath.documentId(),'>=',monthStart)
      .where(firebase.firestore.FieldPath.documentId(),'<=',monthEnd).get();
    const records = {};
    snap.docs.forEach(d => { records[d.id] = d.data(); });

    const firstDay    = window.bizDow(new Date(`${monthStart}T12:00:00`));
    const todayStr    = window.bizDate();
    const canEdit     = pres;
    const phHolidays  = getPHHolidays(viewYear);

    const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let html = `<div class="att-cal-grid">
      ${dayLabels.map(d=>`<div class="att-cal-hdr">${d}</div>`).join('')}
      ${Array(firstDay).fill('<div></div>').join('')}`;

    let fullCount=0, halfCount=0, absentCount=0, workDays=0;

    for (let day=1; day<=daysInMonth; day++) {
      const dateStr  = `${viewYear}-${mm}-${String(day).padStart(2,'0')}`;
      // Anchor to noon Manila so the weekday is correct regardless of device TZ
      // (new Date('YYYY-MM-DD') parses as UTC and shifted the day-of-week).
      const dow      = window.bizDow(new Date(`${dateStr}T12:00:00`));
      const isSunday  = dow===0;
      const holiday   = phHolidays[dateStr];
      const isNoWork  = isSunday || !!holiday;
      const isPast    = dateStr <= todayStr;
      const rec       = records[dateStr];
      let status = '';
      if (!isNoWork && isPast) {
        // An explicit soft-archived "absent" record (admin marked absent) counts as
        // absent even for today — the record is preserved instead of being deleted.
        if (rec?.status === 'absent')      { status='absent';  absentCount++; workDays++; }
        else if (rec?.fullTime || (typeof rec?.attendanceScore==='number' && rec?.attendanceScore>=1))
                                           { status='present'; fullCount++; workDays++; }
        else if (rec?.loginTime || (typeof rec?.attendanceScore==='number' && rec?.attendanceScore>0))
                                           { status='half';    halfCount++; workDays++; }
        else if (dateStr < todayStr)       { status='absent';  absentCount++; workDays++; }
      }
      const cls = isSunday?'att-weekend':holiday?'att-holiday':status?`att-${status}`:'att-future';
      const isToday = dateStr===todayStr;
      const holidayTitle = holiday ? ` title="${holiday.name}"` : '';
      html += `<div class="att-cal-day ${cls} ${isToday?'att-today':''}" data-date="${dateStr}" data-status="${status}"${holidayTitle}>
        <span class="att-day-num">${day}</span>
        ${holiday?`<span class="att-mark" style="font-size:9px;color:rgba(180,140,0,1)">🎌</span>`:
          status==='present'?'<span class="att-mark">✓</span>':
          status==='half'?'<span class="att-mark">½</span>':
          status==='absent'?'<span class="att-mark">✗</span>':''}
        ${canEdit&&!isNoWork?`<button class="att-edit-btn att-edit-visible" data-date="${dateStr}" title="Edit">✎</button>`:''}
      </div>`;
    }
    html += '</div>';
    calEl.innerHTML = html;
    if (window.lucide) lucide.createIcons({nodes:[calEl]});

    const pct = workDays > 0 ? Math.round(((fullCount + halfCount*0.5)/workDays)*100) : 0;
    sumEl.innerHTML = `
      <div class="card-header"><h3>Summary — ${label} · ${escHtml(targetName)}</h3></div>
      <div class="card-body">
        <div class="kpi-row" style="margin:0">
          <div class="kpi-card green"><div class="kpi-label">Present</div><div class="kpi-value">${fullCount}</div></div>
          <div class="kpi-card warn"><div class="kpi-label">Half Day</div><div class="kpi-value">${halfCount}</div></div>
          <div class="kpi-card red"><div class="kpi-label">Absent</div><div class="kpi-value">${absentCount}</div></div>
          <div class="kpi-card accent"><div class="kpi-label">Rate</div><div class="kpi-value">${pct}%</div></div>
        </div>
      </div>`;

    if (canEdit) {
      calEl.querySelectorAll('.att-edit-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const date = btn.dataset.date;
          const cur  = records[date];
          const curStatus = cur?.fullTime ? 'present' : cur?.loginTime ? 'half' : 'absent';
          openModal(`✎ Attendance — ${date}`, `
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Employee: <strong>${escHtml(targetName)}</strong></p>
            <div class="form-group"><label>Status</label>
              <div style="display:flex;gap:8px;margin-top:4px">
                <button class="att-status-opt ${curStatus==='present'?'att-opt-active':''}" data-val="present" style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${curStatus==='present'?'#30d158':'var(--border)'};background:${curStatus==='present'?'rgba(48,209,88,.15)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer">✓ Present</button>
                <button class="att-status-opt ${curStatus==='half'?'att-opt-active':''}" data-val="half" style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${curStatus==='half'?'#ffaa00':'var(--border)'};background:${curStatus==='half'?'rgba(255,170,0,.15)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer">½ Half Day</button>
                <button class="att-status-opt ${curStatus==='absent'?'att-opt-active':''}" data-val="absent" style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${curStatus==='absent'?'#ff453a':'var(--border)'};background:${curStatus==='absent'?'rgba(255,69,58,.12)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer">✗ Absent</button>
              </div>
              <input type="hidden" id="att-status-sel" value="${curStatus}"/>
            </div>
            <div class="form-group" style="margin-top:12px"><label>Note (optional)</label><input id="att-note" value="${escHtml(cur?.note||'')}" placeholder="e.g. sick leave, official business"/></div>
            ${cur?.editedBy?`<p style="font-size:11px;color:var(--text-muted);margin-top:8px">Last edited by admin</p>`:''}
          `, `<button class="btn-primary" id="save-att-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

          // Option button toggle
          document.querySelectorAll('.att-status-opt').forEach(optBtn => {
            optBtn.addEventListener('click', () => {
              document.getElementById('att-status-sel').value = optBtn.dataset.val;
              document.querySelectorAll('.att-status-opt').forEach(b => {
                b.style.borderColor = 'var(--border)';
                b.style.background = 'var(--surface)';
              });
              const colors = {present:'#30d158',half:'#ffaa00',absent:'#ff453a'};
              const bgs    = {present:'rgba(48,209,88,.15)',half:'rgba(255,170,0,.15)',absent:'rgba(255,69,58,.12)'};
              optBtn.style.borderColor = colors[optBtn.dataset.val];
              optBtn.style.background  = bgs[optBtn.dataset.val];
            });
          });

          document.getElementById('save-att-btn').addEventListener('click', async () => {
            const status = document.getElementById('att-status-sel').value;
            const note   = document.getElementById('att-note').value.trim();
            const ref = db.collection('attendance').doc(targetUid).collection('records').doc(date);
            const FV  = firebase.firestore.FieldValue;
            if (status==='present')
              await ref.set({date,uid:targetUid,loginTime:firebase.firestore.Timestamp.fromDate(new Date()),fullTime:true,status:'present',note,editedBy:currentUser.uid,editedAt:FV.serverTimestamp()},{merge:true});
            else if (status==='half')
              await ref.set({date,uid:targetUid,loginTime:firebase.firestore.Timestamp.fromDate(new Date()),fullTime:false,status:'half',note,editedBy:currentUser.uid,editedAt:FV.serverTimestamp()},{merge:true});
            else
              // Soft-archive instead of deleting: preserve the audit trail payroll
              // depends on. Clear time markers so downstream reads classify as absent.
              await ref.set({date,uid:targetUid,status:'absent',fullTime:false,loginTime:FV.delete(),note,editedBy:currentUser.uid,editedAt:FV.serverTimestamp()},{merge:true});
            // Refresh in-memory copy so the calendar re-renders with the new state
            renderAttMonth();
            closeModal();
            Notifs.showToast('Attendance updated!');
          });
        });
      });
    }
  }

  document.getElementById('att-prev-month').addEventListener('click', () => {
    viewMonth--; if(viewMonth<0){viewMonth=11;viewYear--;} renderAttMonth();
  });
  document.getElementById('att-next-month').addEventListener('click', () => {
    viewMonth++; if(viewMonth>11){viewMonth=0;viewYear++;} renderAttMonth();
  });

  renderAttMonth();
};

// ══════════════════════════════════════════════════
//  CASH ADVANCE — installment / credit-card style
// ══════════════════════════════════════════════════

window.renderCashAdvancePage = async function() {
  const c = document.getElementById('page-content');
  // Approve/reject/payment/delete below mutate cash_advances — invalidate the
  // dashboard's cached pending CA count so it doesn't show stale items.
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ca-pending');
  const pres = currentRole === 'president' || currentRole === 'manager' || currentRole === 'finance';

  if (pres) {
    await renderCashAdvanceAdmin(c);
  } else {
    await renderCashAdvanceEmployee(c);
  }
};

async function renderCashAdvanceEmployee(c) {
  const snap = await db.collection('cash_advances').where('userId','==',currentUser.uid).get().catch(()=>({docs:[]}));
  const advances = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
    const ta = a.createdAt?.toMillis?.() || 0;
    const tb = b.createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  const active   = advances.filter(a=>a.status==='approved'&&(a.balance||0)>0);
  const pending  = advances.filter(a=>a.status==='pending');
  const totalBalance = active.reduce((s,a)=>s+(a.balance||0),0);
  const totalMonthly = active.reduce((s,a)=>s+(a.monthlyPayment||0),0);

  c.innerHTML = `
    <div class="page-header">
      <h2>💸 Cash Advance</h2>
      <button class="btn-primary btn-sm" id="new-ca-btn">+ Request</button>
    </div>
    ${totalBalance>0?`
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card red"><div class="kpi-label">Outstanding Balance</div><div class="kpi-value" style="font-size:15px">&#8369;${fmtN(totalBalance)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Monthly Due</div><div class="kpi-value" style="font-size:15px">&#8369;${fmtN(totalMonthly)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Active CA's</div><div class="kpi-value">${active.length}</div></div>
    </div>`:''}
    ${pending.length?`<div class="alert-banner alert-warn" style="margin-bottom:12px"><span>&#x23F3; You have <strong>${pending.length}</strong> pending request${pending.length>1?'s':''} awaiting approval.</span></div>`:''}
    <div class="subtab-bar" id="ca-tabs" style="margin-bottom:14px">
      <button class="subtab-btn active" data-sub="active">Active Loans / CA's</button>
      <button class="subtab-btn" data-sub="all">All Records</button>
    </div>
    <div id="ca-list"></div>
  `;

  const renderTab = (sub) => {
    const list = sub === 'active'
      ? advances.filter(a => (a.status === 'approved' && (a.balance||0) > 0) || a.status === 'pending')
      : advances;
    renderCAEmployeeCards(list, document.getElementById('ca-list'));
  };

  renderTab('active');
  document.getElementById('new-ca-btn').addEventListener('click', () => openCashAdvanceModal());
  c.querySelectorAll('#ca-tabs .subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      c.querySelectorAll('#ca-tabs .subtab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderTab(btn.dataset.sub);
    });
  });
}

function renderCAEmployeeCards(advances, container) {
  if (!advances.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#x1F4B8;</div><h4>No records here</h4><p style="color:var(--text-muted);font-size:13px">Active loans will appear here once approved.</p></div>';
    return;
  }
  container.innerHTML = advances.map(a => {
    const balance  = typeof a.balance !== 'undefined' ? a.balance : a.amount;
    const totalPay = a.totalPayable || a.amount || 0;
    const paidAmt  = Math.max(0, totalPay - (balance||0));
    const pct      = totalPay ? Math.min(100, Math.round((paidAmt/totalPay)*100)) : 0;
    const statusColor = a.status==='approved'?'var(--success)':a.status==='paid'?'var(--primary-light)':a.status==='rejected'?'var(--danger)':'var(--warning)';
    const statusLabel = a.status==='approved'&&(balance||0)>0?'Active':a.status==='paid'?'Paid Off':a.status==='pending'?'Pending Approval':'Rejected';
    const payments = a.payments || [];
    const payRows = payments.map((p,i)=>`
      <tr>
        <td style="padding:6px 8px;font-size:12px;color:var(--text-muted)">#${i+1}</td>
        <td style="padding:6px 8px;font-size:12px">${p.date||'&#x2014;'}</td>
        <td style="padding:6px 8px;font-size:13px;font-weight:700;color:var(--success)">&#8369;${fmtN(p.amount)}</td>
      </tr>`).join('');
    return `
    <div class="ca-card" style="margin-bottom:14px">
      <div class="ca-card-header">
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="font-size:18px;font-weight:800;color:var(--text)">&#8369;${fmtN(a.amount)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${a.date||''} &middot; ${a.terms||1}-month plan</div>
        </div>
        <span style="background:${statusColor}1a;color:${statusColor};border:1px solid ${statusColor}44;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap">${statusLabel}</span>
      </div>
      <div class="ca-card-body">
        <div class="ca-detail"><span>Reason</span><span>${a.reason?escHtml(a.reason):'&#x2014;'}</span></div>
        <div class="ca-detail"><span>Terms</span><span>${a.terms||1} month${(a.terms||1)>1?'s':''} &middot; ${a.interest||0}% interest/mo</span></div>
        <div class="ca-detail"><span>Monthly Payment</span><strong style="color:var(--primary-light)">&#8369;${fmtN(a.monthlyPayment)}</strong></div>
        <div class="ca-detail"><span>Total Payable</span><span>&#8369;${fmtN(totalPay)}</span></div>
        ${a.status==='approved'||a.status==='paid'?`
        <div style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;color:var(--text-muted)">
            <span>Paid: <strong style="color:var(--success)">&#8369;${fmtN(paidAmt)}</strong></span>
            <span>Balance: <strong style="color:${(balance||0)>0?'var(--danger)':'var(--success)'}">&#8369;${fmtN(balance||0)}</strong></span>
          </div>
          <div class="kpi-bar-track" style="height:8px;border-radius:4px">
            <div class="kpi-bar-fill" style="width:${pct}%;background:${pct>=100?'var(--success)':'var(--primary-light)'};border-radius:4px;transition:width 0.4s"></div>
          </div>
          <div style="text-align:right;font-size:11px;color:var(--text-muted);margin-top:3px">${pct}% paid</div>
        </div>`:''}
        ${payments.length?`
        <div style="margin-top:14px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:8px">Payment History</div>
          <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
              <thead><tr style="background:var(--s2)">
                <th style="padding:6px 8px;font-size:11px;color:var(--text-muted);text-align:left;font-weight:600">#</th>
                <th style="padding:6px 8px;font-size:11px;color:var(--text-muted);text-align:left;font-weight:600">Date</th>
                <th style="padding:6px 8px;font-size:11px;color:var(--text-muted);text-align:left;font-weight:600">Amount Paid</th>
              </tr></thead>
              <tbody>${payRows}</tbody>
            </table>
          </div>
          <div style="font-size:11px;color:var(--text-muted);text-align:right;margin-top:4px">${payments.length} payment${payments.length>1?'s':''} recorded</div>
        </div>`:''}
        ${a.status==='pending'?`<div style="margin-top:10px;font-size:12px;color:var(--text-muted);text-align:center;padding:8px;background:var(--s2);border-radius:6px">&#x23F3; Waiting for president approval</div>`:''}
        ${a.status==='rejected'?`<div style="margin-top:10px;font-size:12px;color:var(--danger);text-align:center;padding:8px;background:rgba(255,69,58,0.06);border-radius:6px">&#x2715; This request was not approved</div>`:''}
      </div>
    </div>`;
  }).join('');
}

async function renderCashAdvanceAdmin(c) {
  const [snap, usersSnap] = await Promise.all([
    db.collection('cash_advances').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]})),
    typeof dbCachedGet === 'function'
      ? dbCachedGet('users', () => db.collection('users').get(), 60000)
      : db.collection('users').get()
  ]);
  const allAdvances = snap.docs.map(d=>({id:d.id,...d.data()}));
  const users = usersSnap.docs.map(d=>({id:d.id,...d.data()}));

  // Managers cannot see private records — only president and finance can
  const canSeePrivate = currentRole === 'president' || currentRole === 'finance';
  const advances = allAdvances.filter(a => {
    if (!a.private) return true;
    return canSeePrivate;
  });

  const pending  = advances.filter(a=>a.status==='pending');
  const totalOut = advances.filter(a=>a.status==='approved').reduce((s,a)=>s+(a.balance||a.amount||0),0);

  c.innerHTML = `
    <div class="page-header">
      <h2>💸 Cash Advances</h2>
      ${currentRole==='president'?`<button class="btn-primary btn-sm" id="add-ca-for-btn">+ Add Record</button>`:''}
    </div>
    <div class="kpi-row">
      <div class="kpi-card warn"><div class="kpi-label">Pending</div><div class="kpi-value">${pending.length}</div></div>
      <div class="kpi-card red"><div class="kpi-label">Outstanding</div><div class="kpi-value" style="font-size:14px">₱${fmtN(totalOut)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Records</div><div class="kpi-value">${advances.length}</div></div>
    </div>
    <div id="ca-list"></div>
  `;
  renderCAList(advances, document.getElementById('ca-list'), true);

  document.getElementById('add-ca-for-btn')?.addEventListener('click', () => openPresidentCashAdvanceModal(users));
}

function renderCAList(advances, container, isAdmin) {
  if (!advances.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">💸</div><h4>No cash advances yet</h4></div>';
    return;
  }
  container.innerHTML = advances.map(a => {
    const interest  = a.interest || 0;
    const terms     = a.terms || 1;
    const monthly   = a.monthlyPayment || 0;
    const balance   = typeof a.balance !== 'undefined' ? a.balance : a.amount;
    const paidAmt   = (a.amount||0) - (balance||0);
    const pct       = a.amount ? Math.round((paidAmt/(a.amount||1))*100) : 0;
    const statusBadgeClass = a.status==='approved'?'badge-green':a.status==='rejected'?'badge-red':a.status==='paid'?'badge-blue':'badge-orange';
    return `
    <div class="ca-card">
      <div class="ca-card-header">
        ${isAdmin?`<div class="ca-card-name">${escHtml(a.userName||'Employee')} <span style="font-size:11px;color:var(--text-muted)">${a.employeeId||''}</span>${a.private?'<span class="badge badge-red" style="font-size:10px;margin-left:4px">🔒 Private</span>':''}</div>`:''}
        <div class="ca-amount">₱${fmtN(a.amount)}</div>
        <span class="badge ${statusBadgeClass}">${a.status||'pending'}</span>
      </div>
      <div class="ca-card-body">
        <div class="ca-detail"><span>Reason</span><span>${a.reason?escHtml(a.reason):'—'}</span></div>
        <div class="ca-detail"><span>Terms</span><span>${terms} month${terms>1?'s':''}${interest?` · ${interest}% interest/mo`:''}</span></div>
        <div class="ca-detail"><span>Monthly Payment</span><span style="font-weight:700">₱${fmtN(monthly)}</span></div>
        <div class="ca-detail"><span>Total Payable</span><span>₱${fmtN(monthly*terms)}</span></div>
        ${a.status==='approved'&&a.amount?`
        <div style="margin-top:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
            <span>Paid ₱${fmtN(paidAmt)}</span><span>Balance ₱${fmtN(balance||0)}</span>
          </div>
          <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${pct}%;background:var(--success)"></div></div>
        </div>
        `:''}
        ${a.date?`<div class="ca-detail" style="margin-top:6px"><span>Date</span><span>${a.date}</span></div>`:''}
      </div>
      ${isAdmin&&a.status==='pending'?`
      <div class="ca-card-actions">
        <button class="btn-primary btn-sm ca-approve-btn" data-id="${a.id}">✓ Approve</button>
        <button class="btn-secondary btn-sm ca-reject-btn" data-id="${a.id}" style="color:var(--danger)">✗ Reject</button>
        ${isRealPresident()?`<button class="btn-secondary btn-sm ca-delete-btn" data-id="${a.id}" style="color:var(--danger);margin-left:auto">🗑 Delete</button>`:''}
      </div>`:''}
      ${isAdmin&&a.status==='approved'&&(a.balance||0)>0?`
      <div class="ca-card-actions">
        <button class="btn-secondary btn-sm ca-payment-btn" data-id="${a.id}">Record Payment</button>
        ${isRealPresident()?`<button class="btn-secondary btn-sm ca-delete-btn" data-id="${a.id}" style="color:var(--danger);margin-left:auto">🗑 Delete</button>`:''}
      </div>`:''}
      ${isAdmin&&(a.status==='rejected'||a.status==='paid')&&isRealPresident()?`
      <div class="ca-card-actions" style="justify-content:flex-end">
        <button class="btn-secondary btn-sm ca-delete-btn" data-id="${a.id}" style="color:var(--danger)">🗑 Delete</button>
      </div>`:''}
    </div>`;
  }).join('');

  container.querySelectorAll('.ca-approve-btn').forEach(btn => btn.addEventListener('click', async e => {
    const id = e.target.dataset.id;
    const ref = db.collection('cash_advances').doc(id);
    const peek = await ref.get();
    if (!peek.exists) { Notifs.showToast('Record no longer exists.','error'); window.renderCashAdvancePage(); return; }
    const peekData = peek.data();
    if (!confirm(`Approve this cash advance of ₱${fmtN(peekData.amount)} for ${peekData.userName||'this employee'}?`)) return;
    btn.disabled = true;
    let approvedData = null;
    try {
      // Transaction: re-read and assert still pending so a double-tap or a second
      // admin cannot approve twice and corrupt the balance.
      await db.runTransaction(async t => {
        const fresh = await t.get(ref);
        if (!fresh.exists) throw new Error('Record no longer exists.');
        const a = fresh.data();
        if (a.status !== 'pending') throw new Error('This request is no longer pending (already actioned).');
        t.update(ref, {
          status: 'approved',
          approvedBy: currentUser.uid,
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
          balance: a.amount
        });
        approvedData = a;
      });
    } catch (err) {
      btn.disabled = false;
      Notifs.showToast(err.message || 'Could not approve.', 'error');
      window.renderCashAdvancePage();
      return;
    }
    await Notifs.send(approvedData.userId, {title:'Cash Advance Approved', body:`Your ₱${fmtN(approvedData.amount)} cash advance request was approved!`, icon:'✅', type:'cash_advance', dedupKey:`ca-approved-${id}`});
    Notifs.showToast('Approved!');
    window.renderCashAdvancePage();
  }));

  container.querySelectorAll('.ca-reject-btn').forEach(btn => btn.addEventListener('click', async e => {
    const id = e.target.dataset.id;
    const snap = await db.collection('cash_advances').doc(id).get();
    await db.collection('cash_advances').doc(id).update({status:'rejected'});
    await Notifs.send(snap.data().userId, {title:'Cash Advance Rejected', body:'Your cash advance request was not approved.', icon:'❌', type:'cash_advance', dedupKey:`ca-rejected-${id}`});
    Notifs.showToast('Rejected.');
    window.renderCashAdvancePage();
  }));

  container.querySelectorAll('.ca-payment-btn').forEach(btn => btn.addEventListener('click', async e => {
    const id = e.target.dataset.id;
    const snap = await db.collection('cash_advances').doc(id).get();
    const a = snap.data();
    openModal('Record Payment', `
      <div class="ca-detail" style="margin-bottom:14px"><span>Balance:</span><strong>₱${fmtN(a.balance||0)}</strong></div>
      <div class="ca-detail" style="margin-bottom:14px"><span>Monthly due:</span><strong>₱${fmtN(a.monthlyPayment||0)}</strong></div>
      <div class="form-group"><label>Amount Paid</label><input id="pay-amount" type="number" inputmode="decimal" value="${a.monthlyPayment||0}" min="0" max="${a.balance||0}"/></div>
      <div class="form-group"><label>Date</label><input id="pay-date" type="date" value="${window.bizDate()}"/></div>
    `, `<button class="btn-primary" id="save-payment-btn">Record</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-payment-btn').addEventListener('click', async () => {
      const saveBtn = document.getElementById('save-payment-btn');
      try {
        const paid = parseFloat(document.getElementById('pay-amount').value)||0;
        const payDate = document.getElementById('pay-date').value;
        if (paid <= 0) { Notifs.showToast('Enter a payment amount greater than ₱0.','error'); return; }
        if (!confirm(`Record a payment of ₱${fmtN(paid)} against this cash advance?`)) return;
        saveBtn.disabled = true;
        const ref = db.collection('cash_advances').doc(id);
        // Transaction: re-read balance/status so two admins or a double-tap can't
        // record the same payment twice or overpay a stale balance.
        const result = await db.runTransaction(async t => {
          const fresh = await t.get(ref);
          if (!fresh.exists) throw new Error('Record no longer exists.');
          const cur = fresh.data();
          if (cur.status !== 'approved' || (cur.balance||0) <= 0)
            throw new Error('This cash advance has no outstanding balance (already paid or not approved).');
          const newBal = Math.max(0, (cur.balance||0) - paid);
          const payments = [...(cur.payments||[]), {amount:paid, date:payDate, recordedBy:currentUser.uid}];
          t.update(ref, {
            balance: newBal, payments,
            status: newBal <= 0 ? 'paid' : 'approved'
          });
          return { newBal, userId: cur.userId };
        });
        // Notify the employee
        const statusMsg = result.newBal <= 0 ? 'fully paid off 🎉' : `balance remaining: ₱${fmtN(result.newBal)}`;
        await Notifs.send(result.userId, {
          title: '💳 Cash Advance Payment Recorded',
          body: `₱${fmtN(paid)} payment was recorded on your cash advance. ${statusMsg.charAt(0).toUpperCase()+statusMsg.slice(1)}.`,
          icon: '💳', type: 'cash_advance'
        });
        closeModal(); Notifs.showToast('Payment recorded!');
        await window.renderCashAdvancePage();
        // Stay on Active Loans/CA's tab after payment
        const activeBtn = document.querySelector('#ca-tabs [data-sub="active"]');
        if (activeBtn) activeBtn.click();
      } catch(err) {
        if (saveBtn) saveBtn.disabled = false;
        Notifs.showToast('Error recording payment: ' + err.message, 'error');
      }
    });
  }));

  container.querySelectorAll('.ca-delete-btn').forEach(btn => btn.addEventListener('click', async e => {
    const id = e.currentTarget.dataset.id;
    if (!confirm('Permanently delete this cash advance record? This cannot be undone.')) return;
    await db.collection('cash_advances').doc(id).delete();
    Notifs.showToast('Record deleted.');
    window.renderCashAdvancePage();
  }));
}

function openCashAdvanceModal() {
  const RATE = 2; // 2% per month interest
  openModal('Request Cash Advance', `
    <div class="form-group"><label>Amount (max ₱50,000)</label>
      <input id="ca-amt" type="number" inputmode="decimal" min="100" max="50000" step="100" placeholder="0.00" oninput="updateCACalc()"/>
    </div>
    <div class="form-group"><label>Repayment Terms</label>
      <select id="ca-terms" onchange="updateCACalc()" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="1">1 month (lump sum)</option>
        <option value="2">2 months</option>
        <option value="3" selected>3 months</option>
        <option value="6">6 months</option>
        <option value="12">12 months</option>
      </select>
    </div>
    <div id="ca-calc" class="ca-calc-box" style="display:none"></div>
    <div class="form-group"><label>Date Needed</label><input id="ca-date" type="date" value="${window.bizDate()}"/></div>
    <div class="form-group"><label>Reason / Purpose</label>
      <textarea id="ca-reason" rows="3" placeholder="e.g., Medical emergency, school fees…" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical"></textarea>
    </div>
  `, `<button class="btn-primary" id="submit-ca-btn">Submit Request</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  window.updateCACalc = () => {
    const amt   = parseFloat(document.getElementById('ca-amt')?.value)||0;
    const terms = parseInt(document.getElementById('ca-terms')?.value)||1;
    const calc  = document.getElementById('ca-calc');
    if (!calc) return;
    if (!amt) { calc.style.display='none'; return; }
    const total   = amt * Math.pow(1 + RATE/100, terms);
    const monthly = total / terms;
    const interest= total - amt;
    calc.style.display = 'block';
    calc.innerHTML = `
      <div class="ca-detail"><span>Principal</span><span>₱${fmtN(amt)}</span></div>
      <div class="ca-detail"><span>Interest (${RATE}%/mo × ${terms}mo)</span><span style="color:var(--danger)">+₱${fmtN(interest)}</span></div>
      <div class="ca-detail"><span>Total Payable</span><span style="font-weight:700">₱${fmtN(total)}</span></div>
      <div class="ca-detail" style="border-top:1.5px solid var(--border);padding-top:8px;margin-top:4px">
        <span>Monthly Payment</span><span style="font-weight:800;font-size:16px;color:var(--primary-light)">₱${fmtN(monthly)}</span>
      </div>`;
  };

  document.getElementById('submit-ca-btn').addEventListener('click', async () => {
    const amt  = parseFloat(document.getElementById('ca-amt').value)||0;
    if (!amt||amt<100) { Notifs.showToast('Enter a valid amount (min ₱100).','error'); return; }
    if (amt>50000)     { Notifs.showToast('Maximum cash advance is ₱50,000.','error'); return; }
    const terms   = parseInt(document.getElementById('ca-terms').value)||1;
    const total   = amt * Math.pow(1 + RATE/100, terms);
    const monthly = total / terms;
    const name    = userProfile.displayName || currentUser.email;
    await db.collection('cash_advances').add({
      userId:         currentUser.uid,
      userName:       name,
      employeeId:     userProfile.employeeId || currentUser.uid,
      amount:         amt,
      terms,
      interest:       RATE,
      totalPayable:   Math.round(total*100)/100,
      monthlyPayment: Math.round(monthly*100)/100,
      balance:        0,
      date:           document.getElementById('ca-date').value,
      reason:         document.getElementById('ca-reason').value.trim(),
      status:         'pending',
      payments:       [],
      createdAt:      firebase.firestore.FieldValue.serverTimestamp()
    });
    await Notifs.sendToOwner({title:'Cash Advance Request', body:`${name} requests ₱${fmtN(amt)} (${terms}-month plan).`, icon:'💸', type:'cash_advance'});
    closeModal();
    Notifs.showToast('Request submitted! Waiting for approval.');
    window.renderCashAdvancePage();
  });
}

function fmtN(n) {
  return Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
}

// President-only: record a cash advance for any employee (pre-approved)
function openPresidentCashAdvanceModal(users) {
  const employees = users.filter(u => u.role !== 'partner' && u.uid !== currentUser.uid);
  const empOptions = employees.map(u =>
    `<option value="${u.id}">${escHtml(u.displayName||u.email)} (${u.role||'employee'})</option>`
  ).join('');

  openModal('Record Cash Advance for Employee', `
    <div class="form-group">
      <label>Employee</label>
      <select id="pca-uid" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="">— Select employee —</option>
        ${empOptions}
      </select>
    </div>
    <div class="form-group"><label>Loan Amount (₱)</label>
      <input id="pca-amount" type="number" inputmode="decimal" min="1" step="0.01" placeholder="e.g. 65225"/>
    </div>
    <div class="form-group"><label>Monthly Payment (₱)</label>
      <input id="pca-monthly" type="number" inputmode="decimal" min="1" step="0.01" placeholder="e.g. 5025"/>
    </div>
    <div class="form-group"><label>Terms (months)</label>
      <input id="pca-terms" type="number" inputmode="numeric" min="1" max="60" value="9"/>
    </div>
    <div class="form-group"><label>Date</label>
      <input id="pca-date" type="date" value="${window.bizDate()}"/>
    </div>
    <div class="form-group"><label>Purpose / Notes</label>
      <textarea id="pca-reason" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical"></textarea>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:6px;cursor:pointer">
      <input type="checkbox" id="pca-private" checked/>
      <span style="font-size:13px">🔒 Private — visible only to this employee, president &amp; finance</span>
    </label>
  `, `<button class="btn-primary" id="save-pca-btn">Save Record</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  document.getElementById('save-pca-btn').addEventListener('click', async () => {
    const uid     = document.getElementById('pca-uid').value;
    const amount  = parseFloat(document.getElementById('pca-amount').value)||0;
    const monthly = parseFloat(document.getElementById('pca-monthly').value)||0;
    const terms   = parseInt(document.getElementById('pca-terms').value)||1;
    const date    = document.getElementById('pca-date').value;
    const reason  = document.getElementById('pca-reason').value.trim();
    const isPriv  = document.getElementById('pca-private').checked;

    if (!uid)    { Notifs.showToast('Please select an employee.','error'); return; }
    if (!amount) { Notifs.showToast('Enter a valid amount.','error'); return; }

    const emp = employees.find(u => u.id === uid);
    await db.collection('cash_advances').add({
      userId:         uid,
      userName:       emp?.displayName || emp?.email || uid,
      employeeId:     emp?.employeeId  || uid,
      amount,
      terms,
      interest:       0,
      monthlyPayment: monthly,
      totalPayable:   monthly * terms,
      balance:        amount,
      date,
      reason,
      status:         'approved',
      private:        isPriv,
      addedBy:        currentUser.uid,
      payments:       [],
      createdAt:      firebase.firestore.FieldValue.serverTimestamp()
    });
    await Notifs.send(uid, {
      title: '💸 Cash Advance Recorded',
      body:  `A cash advance of ₱${fmtN(amount)} has been recorded for you — ${terms}-month plan at ₱${fmtN(monthly)}/mo. Check your Cash Advance tab to view details.`,
      icon:  '💸',
      type:  'cash_advance'
    });
    closeModal();
    Notifs.showToast('Cash advance recorded!');
    window.renderCashAdvancePage();
  });
}

// ══════════════════════════════════════════════════
//  COMPANY TAB — About Barro Industries OPC
// ══════════════════════════════════════════════════

window.renderCompanyOverviewNew = function(ct, canAdd) {
  ct.innerHTML = `
    <div class="company-hero">
      <div class="company-logo-wrap">
        <img src="icons/icon-192.png" alt="Barro Industries" class="company-hero-logo" onerror="this.style.display='none'"/>
      </div>
      <h1 class="company-hero-name">Barro Industries OPC</h1>
      <p class="company-hero-tagline">One Person Corporation · SEC Registered</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px">
        <span class="badge badge-blue">Manufacturing</span>
        <span class="badge badge-purple">Design & Build</span>
        <span class="badge badge-green">R&D (Coming Soon)</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>🏢 About the Company</h3></div>
      <div class="card-body">
        <p style="font-size:14px;line-height:1.7;color:var(--text)">
          <strong>Barro Industries OPC</strong> is a SEC-registered One Person Corporation in the Philippines. The company's current active trademark is <strong>Barro Kitchens</strong> — a one-stop shop for kitchen design and build, covering the manufacturing industry from fabrication to full installation.
        </p>
        <p style="font-size:14px;line-height:1.7;color:var(--text);margin-top:10px">
          Barro Kitchens will soon expand into research and development. Barro Industries OPC continues to grow its trademark portfolio, with more brands coming in the future.
        </p>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>™ Trademarks & Brands</h3></div>
      <div class="card-body">
        <div class="trademark-card">
          <div class="trademark-icon">🍳</div>
          <div>
            <div class="trademark-name">Barro Kitchens</div>
            <div class="trademark-desc">One-stop shop for kitchen design and build · Manufacturing industry · Full fabrication and installation services. R&D coming soon.</div>
            <span class="badge badge-green" style="margin-top:6px;display:inline-block">Active — Only Current Trademark</span>
          </div>
        </div>
        <div class="trademark-card" style="opacity:0.6;margin-top:10px">
          <div class="trademark-icon">🔬</div>
          <div>
            <div class="trademark-name">More trademarks coming soon</div>
            <div class="trademark-desc">Barro Industries OPC is SEC registered and will expand its brand portfolio under different trademarks.</div>
            <span class="badge badge-gray" style="margin-top:6px;display:inline-block">Upcoming</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px" id="president-message-card"></div>
  `;
  renderPresidentMessageCard();
};

async function renderPresidentMessageCard() {
  const card = document.getElementById('president-message-card');
  if (!card) return;
  // Only show to employees and admin — not partners
  if (typeof isBrilliantOnly === 'function' && isBrilliantOnly()) { card.style.display='none'; return; }
  try {
    const snap = await db.collection('users').where('role','==','president').limit(1).get();
    if (snap.empty) { card.style.display='none'; return; }
    const pres = snap.docs[0].data();
    // The president-role query above is the authority; show the card for whoever
    // holds the president role (no hardcoded email gate).
    const msg = await db.collection('president_message').doc('current').get();
    const msgText = msg.exists ? msg.data().message : 'Welcome to Barro Industries. Together, we build something great.';
    const presName = pres.displayName || 'Neil Barro';
    card.innerHTML = `
      <div class="card-header">
        <h3>Message from the President</h3>
        ${isRealPresident() ? '<button class="btn-secondary btn-sm" id="edit-msg-btn">Edit</button>' : ''}
      </div>
      <div class="card-body">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
          <div style="width:54px;height:54px;border-radius:50%;overflow:hidden;background:var(--primary-light);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff">
            ${pres.photoUrl?`<img src="${escHtml(pres.photoUrl)}" style="width:100%;height:100%;object-fit:cover"/>`:escHtml(presName[0]||'')}
          </div>
          <div>
            <div style="font-weight:700;font-size:15px">${escHtml(presName)}</div>
            <div style="font-size:12px;color:var(--text-muted)">President, Barro Industries OPC</div>
          </div>
        </div>
        <blockquote style="font-size:14px;line-height:1.8;color:var(--text);border-left:3px solid var(--primary-light);padding-left:14px;margin:0;font-style:italic">${escHtml(msgText)}</blockquote>
      </div>`;
    document.getElementById('edit-msg-btn')?.addEventListener('click', () => {
      openModal('Edit President Message', `
        <div class="form-group"><label>Message</label>
          <textarea id="pres-msg-input" rows="6" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);color:var(--text);resize:vertical">${escHtml(msgText)}</textarea>
        </div>
      `, `<button class="btn-primary" id="save-pres-msg">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-pres-msg').addEventListener('click', async () => {
        await db.collection('president_message').doc('current').set({
          message: document.getElementById('pres-msg-input').value.trim(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal(); Notifs.showToast('Message updated!');
        renderPresidentMessageCard();
      });
    });
  } catch(e) { card.style.display='none'; }
}

// ══════════════════════════════════════════════════
//  INVENTORY — raw materials, finished goods, stock log, job costing
// ══════════════════════════════════════════════════
(function(){
  const peso = n => '₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const num  = n => Number(n||0).toLocaleString('en-PH');
  const canEditInv = () => currentRole !== 'partner';
  const isFinAdmin = () => ['president','manager','finance'].includes(currentRole);

  window.renderInventory = async function(container, sub='Stock'){
    // container may be an element (embedded as a dept subtab) or omitted (full page).
    const c = (container && container.nodeType) ? container
            : (typeof container === 'string' ? document.getElementById(container)
            : document.getElementById('page-content'));
    const tabs = ['Stock','Movements'];
    if (isFinAdmin()) tabs.push('Job Costing');
    c.innerHTML = `
      <div class="page-header"><h2>📦 Inventory</h2></div>
      <div class="subtab-bar" style="flex-wrap:wrap;margin-bottom:12px">
        ${tabs.map(s=>`<button class="subtab-btn ${s===sub?'active':''}" data-sub="${s}">${s}</button>`).join('')}
      </div>
      <div id="inv-content"><div class="loading-placeholder">Loading…</div></div>`;
    loadInv(sub);
    c.querySelectorAll('.subtab-btn').forEach(b=>b.addEventListener('click',()=>{
      c.querySelectorAll('.subtab-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); loadInv(b.dataset.sub);
    }));
  };

  function loadInv(sub){
    const el = document.getElementById('inv-content');
    if (sub==='Movements')   return renderMovements(el);
    if (sub==='Job Costing') return renderJobs(el);
    return renderStock(el);
  }

  async function renderStock(el, kindFilter='all'){
    el.innerHTML = '<div class="loading-placeholder">Loading stock…</div>';
    const snap = await db.collection('inventory_items').orderBy('name').get().catch(()=>({docs:[]}));
    const items = snap.docs.map(d=>({id:d.id,...d.data()}));
    const shown = items.filter(i=> kindFilter==='all' || (i.kind||'material')===kindFilter);
    const low = items.filter(i=>(i.reorderLevel||0)>0 && (i.qty||0) <= (i.reorderLevel||0));
    const totalValue = items.reduce((s,i)=>s+((i.qty||0)*(i.unitCost||0)),0);
    const ce = canEditInv();
    el.innerHTML = `
      <div class="kpi-row" style="margin-bottom:12px">
        <div class="kpi-card"><div class="kpi-label">Items</div><div class="kpi-value">${items.length}</div></div>
        <div class="kpi-card ${low.length?'red':''}"><div class="kpi-label">Low Stock</div><div class="kpi-value">${low.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Stock Value</div><div class="kpi-value">${peso(totalValue)}</div></div>
      </div>
      ${low.length?`<div class="alert-banner alert-warn"><span>⚠️ <strong>${low.length} item${low.length>1?'s':''}</strong> at or below reorder level</span></div>`:''}
      <div class="subtab-bar" style="margin-bottom:10px">
        ${[['all','All'],['material','Raw Materials'],['product','Finished Goods']].map(([k,l])=>`<button class="subtab-btn inv-kind-chip ${kindFilter===k?'active':''}" data-kind="${k}">${l}</button>`).join('')}
        <button class="btn-secondary btn-sm" id="inv-csv" style="margin-left:auto">⬇ CSV</button>
        ${ce?'<button class="btn-primary btn-sm" id="inv-add-btn">＋ Add Item</button>':''}
      </div>
      <div class="card"><div class="card-body" style="padding:0">
        ${!shown.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">📦</div><h4>No items yet</h4></div>':
        `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Item</th><th>Type</th><th>On Hand</th><th>Reorder</th><th>Unit Cost</th><th>Value</th><th>Supplier</th>${ce?'<th></th>':''}</tr></thead>
          <tbody>${shown.map(i=>{
            const lowItem=(i.reorderLevel||0)>0 && (i.qty||0)<=(i.reorderLevel||0);
            return `<tr>
              <td style="font-weight:600">${escHtml(i.name||'—')}${i.category?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(i.category)}</div>`:''}</td>
              <td><span class="badge ${(i.kind||'material')==='product'?'badge-blue':'badge-gray'}">${(i.kind||'material')==='product'?'Finished':'Material'}</span></td>
              <td style="font-weight:700;color:${lowItem?'var(--danger)':'inherit'}">${num(i.qty||0)} ${escHtml(i.unit||'')}${lowItem?' ⚠️':''}</td>
              <td style="font-size:12px;color:var(--text-muted)">${num(i.reorderLevel||0)}</td>
              <td>${peso(i.unitCost||0)}</td>
              <td>${peso((i.qty||0)*(i.unitCost||0))}</td>
              <td style="font-size:12px">${escHtml(i.supplier||'—')}</td>
              ${ce?`<td style="white-space:nowrap">
                <button class="btn-success btn-sm inv-in-btn" data-id="${i.id}" title="Stock In">＋</button>
                <button class="btn-secondary btn-sm inv-out-btn" data-id="${i.id}" title="Stock Out">−</button>
                <button class="btn-secondary btn-sm inv-edit-btn" data-id="${i.id}" title="Edit">✎</button>
              </td>`:''}
            </tr>`;}).join('')}</tbody>
        </table></div>`}
      </div></div>`;
    el.querySelectorAll('.inv-kind-chip').forEach(b=>b.addEventListener('click',()=>renderStock(el,b.dataset.kind)));
    document.getElementById('inv-csv')?.addEventListener('click',()=>window.exportCSV('inventory', shown, [
      {key:'name',label:'Item'},{key:'kind',label:'Type',get:i=>(i.kind||'material')},{key:'category',label:'Category'},
      {key:'qty',label:'On Hand',get:i=>i.qty||0},{key:'unit',label:'Unit'},{key:'reorderLevel',label:'Reorder',get:i=>i.reorderLevel||0},
      {key:'unitCost',label:'Unit Cost',get:i=>i.unitCost||0},{key:'value',label:'Stock Value',get:i=>(i.qty||0)*(i.unitCost||0)},{key:'supplier',label:'Supplier'}]));
    if(ce){
      document.getElementById('inv-add-btn')?.addEventListener('click',()=>itemModal(null,()=>renderStock(el,kindFilter)));
      el.querySelectorAll('.inv-edit-btn').forEach(b=>b.addEventListener('click',()=>itemModal(items.find(i=>i.id===b.dataset.id),()=>renderStock(el,kindFilter))));
      el.querySelectorAll('.inv-in-btn').forEach(b=>b.addEventListener('click',()=>moveModal(items.find(i=>i.id===b.dataset.id),'in',()=>renderStock(el,kindFilter))));
      el.querySelectorAll('.inv-out-btn').forEach(b=>b.addEventListener('click',()=>moveModal(items.find(i=>i.id===b.dataset.id),'out',()=>renderStock(el,kindFilter))));
    }
  }

  function itemModal(item, onSaved){
    const e=item||{};
    openModal(item?'Edit Item':'Add Inventory Item', `
      <div class="form-group"><label>Name</label><input id="iv-name" value="${escHtml(e.name||'')}" placeholder="e.g. Stainless Sheet 4x8 ga.16"/></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="iv-kind"><option value="material" ${e.kind!=='product'?'selected':''}>Raw Material</option><option value="product" ${e.kind==='product'?'selected':''}>Finished Good</option></select></div>
        <div class="form-group"><label>Unit</label><input id="iv-unit" value="${escHtml(e.unit||'')}" placeholder="sheet / m / kg / pc"/></div>
      </div>
      <div class="form-group"><label>Category</label><input id="iv-cat" value="${escHtml(e.category||'')}" placeholder="e.g. Stainless, Fasteners, Cooking Equipment"/></div>
      <div class="form-row">
        <div class="form-group"><label>On-hand Qty</label><input id="iv-qty" type="number" inputmode="decimal" step="0.01" value="${e.qty||0}"/></div>
        <div class="form-group"><label>Reorder Level</label><input id="iv-reorder" type="number" inputmode="decimal" step="0.01" value="${e.reorderLevel||0}"/></div>
      </div>
      <div class="form-group"><label>Unit Cost (₱)</label><input id="iv-cost" type="number" inputmode="decimal" step="0.01" value="${e.unitCost||0}"/></div>
      <div class="form-row">
        <div class="form-group"><label>Supplier</label><input id="iv-supplier" value="${escHtml(e.supplier||'')}"/></div>
        <div class="form-group"><label>Supplier Contact</label><input id="iv-supcontact" value="${escHtml(e.supplierContact||'')}"/></div>
      </div>
      <div id="iv-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="iv-save">Save</button>${item?'<button class="btn-danger" id="iv-del">Delete</button>':''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('iv-save').addEventListener('click', async ()=>{
      const name=document.getElementById('iv-name').value.trim();
      const err=document.getElementById('iv-err');
      if(!name){ err.textContent='Name is required.'; err.classList.remove('hidden'); return; }
      const data={ name, kind:document.getElementById('iv-kind').value,
        unit:document.getElementById('iv-unit').value.trim(), category:document.getElementById('iv-cat').value.trim(),
        qty:parseFloat(document.getElementById('iv-qty').value)||0, reorderLevel:parseFloat(document.getElementById('iv-reorder').value)||0,
        unitCost:parseFloat(document.getElementById('iv-cost').value)||0,
        supplier:document.getElementById('iv-supplier').value.trim(), supplierContact:document.getElementById('iv-supcontact').value.trim(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp() };
      try{
        if(item){ await db.collection('inventory_items').doc(item.id).update(data); window.logAudit&&window.logAudit('update','inventory_item',item.id,{name,qty:data.qty}); }
        else { data.createdAt=firebase.firestore.FieldValue.serverTimestamp(); const _r=await db.collection('inventory_items').add(data); window.logAudit&&window.logAudit('create','inventory_item',_r.id,{name,qty:data.qty}); }
        closeModal(); Notifs.showToast('Item saved'); onSaved&&onSaved();
      }catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
    });
    document.getElementById('iv-del')?.addEventListener('click', async ()=>{
      if(!confirm('Delete this item?')) return;
      try{ await db.collection('inventory_items').doc(item.id).delete(); window.logAudit&&window.logAudit('delete','inventory_item',item.id,{name:item.name||''}); closeModal(); Notifs.showToast('Item deleted'); onSaved&&onSaved(); }
      catch(ex){ Notifs.showToast('Delete failed','error'); }
    });
  }

  function moveModal(item, type, onSaved){
    if(!item) return;
    openModal((type==='in'?'➕ Stock In — ':'➖ Stock Out — ')+(item.name||''), `
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Current on-hand: <strong>${num(item.qty||0)} ${escHtml(item.unit||'')}</strong></div>
      <div class="form-group"><label>Quantity to ${type==='in'?'add':'remove'}</label><input id="mv-qty" type="number" inputmode="decimal" step="0.01" min="0"/></div>
      ${type==='out'?`<div class="form-group"><label>Project / Job (optional)</label><input id="mv-project" placeholder="e.g. Gerry's Grill — Bulacan"/></div>`:''}
      <div class="form-group"><label>Note (optional)</label><input id="mv-note" placeholder="PO #, reason, etc."/></div>
      <div id="mv-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="mv-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('mv-save').addEventListener('click', async ()=>{
      const qty=parseFloat(document.getElementById('mv-qty').value)||0;
      const err=document.getElementById('mv-err');
      if(qty<=0){ err.textContent='Enter a quantity greater than 0.'; err.classList.remove('hidden'); return; }
      const delta = type==='in'? qty : -qty;
      try{
        await db.collection('inventory_items').doc(item.id).update({ qty: firebase.firestore.FieldValue.increment(delta), updatedAt:firebase.firestore.FieldValue.serverTimestamp() });
        await db.collection('stock_movements').add({ itemId:item.id, itemName:item.name||'', type, qty,
          project: type==='out'?(document.getElementById('mv-project')?.value.trim()||''):'',
          note:document.getElementById('mv-note').value.trim(),
          by:currentUser.uid, byName:userProfile?.displayName||currentUser.email,
          date:bizDate(), createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        window.logAudit&&window.logAudit('create','stock_movement',item.id,{itemName:item.name||'',type,qty,delta});
        closeModal(); Notifs.showToast('Stock updated'); onSaved&&onSaved();
      }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
    });
  }

  async function renderMovements(el){
    el.innerHTML='<div class="loading-placeholder">Loading movements…</div>';
    const snap=await db.collection('stock_movements').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
    const mv=snap.docs.map(d=>d.data());
    el.innerHTML=`<div class="card"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center"><h3>📋 Stock Movement Log</h3>${mv.length?'<button class="btn-secondary btn-sm" id="mv-csv">⬇ CSV</button>':''}</div>
      <div class="card-body" style="padding:0">
      ${!mv.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">📋</div><h4>No movements yet</h4></div>':
      `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Item</th><th>In/Out</th><th>Qty</th><th>Project</th><th>Note</th><th>By</th></tr></thead>
        <tbody>${mv.map(m=>`<tr>
          <td>${escHtml(m.date||'—')}</td>
          <td style="font-weight:600">${escHtml(m.itemName||'—')}</td>
          <td><span class="badge ${m.type==='in'?'badge-green':'badge-orange'}">${m.type==='in'?'IN':'OUT'}</span></td>
          <td>${num(m.qty||0)}</td>
          <td style="font-size:12px">${escHtml(m.project||'—')}</td>
          <td style="font-size:12px">${escHtml(m.note||'—')}</td>
          <td style="font-size:11px">${escHtml(m.byName||'—')}</td>
        </tr>`).join('')}</tbody></table></div>`}
      </div></div>`;
    document.getElementById('mv-csv')?.addEventListener('click',()=>window.exportCSV('stock-movements', mv, [
      {key:'date',label:'Date'},{key:'itemName',label:'Item'},{key:'type',label:'In/Out',get:m=>m.type==='in'?'IN':'OUT'},
      {key:'qty',label:'Qty',get:m=>m.qty||0},{key:'project',label:'Project'},{key:'note',label:'Note'},{key:'byName',label:'By'}]));
  }

  async function renderJobs(el){
    el.innerHTML='<div class="loading-placeholder">Loading job costs…</div>';
    const snap=await db.collection('job_costs').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
    const jobs=snap.docs.map(d=>({id:d.id,...d.data()}));
    const ce=isFinAdmin();
    el.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
        <div style="font-size:12px;color:var(--text-muted);flex:1">Materials + labor vs revenue = margin per project</div>
        ${jobs.length?'<button class="btn-secondary btn-sm" id="jobs-csv">⬇ CSV</button>':''}
        ${ce?'<button class="btn-primary btn-sm" id="job-add-btn">＋ New Job</button>':''}
      </div>
      <div class="card"><div class="card-body" style="padding:0">
      ${!jobs.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">🧮</div><h4>No job costs yet</h4></div>':
      `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Project</th><th>Revenue</th><th>Materials</th><th>Labor</th><th>Other</th><th>Cost</th><th>Margin</th>${ce?'<th></th>':''}</tr></thead>
        <tbody>${jobs.map(j=>{const cost=(j.materialsCost||0)+(j.laborCost||0)+(j.otherCost||0);const margin=(j.revenue||0)-cost;const pct=j.revenue?Math.round(margin/j.revenue*100):0;return `<tr>
          <td style="font-weight:600">${escHtml(j.project||'—')}${j.quoteRef?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(j.quoteRef)}</div>`:''}</td>
          <td>${peso(j.revenue||0)}</td><td>${peso(j.materialsCost||0)}</td><td>${peso(j.laborCost||0)}</td><td>${peso(j.otherCost||0)}</td>
          <td>${peso(cost)}</td>
          <td style="font-weight:700;color:${margin>=0?'var(--success)':'var(--danger)'}">${peso(margin)}<div style="font-size:11px">${pct}%</div></td>
          ${ce?`<td><button class="btn-secondary btn-sm job-edit-btn" data-id="${j.id}" title="Edit">✎</button></td>`:''}
        </tr>`;}).join('')}</tbody></table></div>`}
      </div></div>`;
    document.getElementById('jobs-csv')?.addEventListener('click',()=>window.exportCSV('job-costing', jobs, [
      {key:'project',label:'Project'},{key:'quoteRef',label:'Quote Ref'},{key:'revenue',label:'Revenue',get:j=>j.revenue||0},
      {key:'materialsCost',label:'Materials',get:j=>j.materialsCost||0},{key:'laborCost',label:'Labor',get:j=>j.laborCost||0},{key:'otherCost',label:'Other',get:j=>j.otherCost||0},
      {key:'cost',label:'Total Cost',get:j=>(j.materialsCost||0)+(j.laborCost||0)+(j.otherCost||0)},
      {key:'margin',label:'Margin',get:j=>(j.revenue||0)-((j.materialsCost||0)+(j.laborCost||0)+(j.otherCost||0))}]));
    if(ce){
      document.getElementById('job-add-btn')?.addEventListener('click',()=>jobModal(null,()=>renderJobs(el)));
      el.querySelectorAll('.job-edit-btn').forEach(b=>b.addEventListener('click',()=>jobModal(jobs.find(j=>j.id===b.dataset.id),()=>renderJobs(el))));
    }
  }

  function jobModal(job, onSaved){
    const e=job||{};
    openModal(job?'Edit Job Cost':'New Job Cost', `
      <div class="form-group"><label>Project / Client</label><input id="jb-project" value="${escHtml(e.project||'')}" placeholder="e.g. Gerry's Grill — Bulacan"/></div>
      <div class="form-group"><label>Quote Ref (optional)</label><input id="jb-quote" value="${escHtml(e.quoteRef||'')}" placeholder="BK-LU-FB-..."/></div>
      <div class="form-row">
        <div class="form-group"><label>Revenue (₱)</label><input id="jb-rev" type="number" inputmode="decimal" step="0.01" value="${e.revenue||0}"/></div>
        <div class="form-group"><label>Materials Cost (₱)</label><input id="jb-mat" type="number" inputmode="decimal" step="0.01" value="${e.materialsCost||0}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Labor Cost (₱)</label><input id="jb-lab" type="number" inputmode="decimal" step="0.01" value="${e.laborCost||0}"/></div>
        <div class="form-group"><label>Other Cost (₱)</label><input id="jb-oth" type="number" inputmode="decimal" step="0.01" value="${e.otherCost||0}"/></div>
      </div>
      <div id="jb-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="jb-save">Save</button>${job?'<button class="btn-danger" id="jb-del">Delete</button>':''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('jb-save').addEventListener('click', async ()=>{
      const project=document.getElementById('jb-project').value.trim();
      const err=document.getElementById('jb-err');
      if(!project){ err.textContent='Project name is required.'; err.classList.remove('hidden'); return; }
      const data={ project, quoteRef:document.getElementById('jb-quote').value.trim(),
        revenue:parseFloat(document.getElementById('jb-rev').value)||0, materialsCost:parseFloat(document.getElementById('jb-mat').value)||0,
        laborCost:parseFloat(document.getElementById('jb-lab').value)||0, otherCost:parseFloat(document.getElementById('jb-oth').value)||0,
        updatedAt:firebase.firestore.FieldValue.serverTimestamp() };
      try{
        if(job) await db.collection('job_costs').doc(job.id).update(data);
        else { data.createdAt=firebase.firestore.FieldValue.serverTimestamp(); await db.collection('job_costs').add(data); }
        closeModal(); Notifs.showToast('Job cost saved'); onSaved&&onSaved();
      }catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
    });
    document.getElementById('jb-del')?.addEventListener('click', async ()=>{
      if(!confirm('Delete this job cost?')) return;
      try{ await db.collection('job_costs').doc(job.id).delete(); closeModal(); Notifs.showToast('Deleted'); onSaved&&onSaved(); }
      catch(ex){ Notifs.showToast('Delete failed','error'); }
    });
  }
})();

// ═══════════════════════════════════════════════════
//  LEAVE MANAGEMENT — requests, approval, balances
//  leave_requests collection + leave_balances/{uid}. Modeled on cash advances:
//  employees file their own pending request; finance/admin approve and the
//  approval decrements the vacation/sick balance + notifies the requester.
// ═══════════════════════════════════════════════════
(function(){
  const LEAVE_TYPES = [
    { id:'vacation',  label:'Vacation Leave',  icon:'🌴', drawsBalance:true  },
    { id:'sick',      label:'Sick Leave',      icon:'🤒', drawsBalance:true  },
    { id:'emergency', label:'Emergency Leave', icon:'🚨', drawsBalance:false },
    { id:'unpaid',    label:'Unpaid Leave',    icon:'📅', drawsBalance:false },
  ];
  const leaveType = id => LEAVE_TYPES.find(t=>t.id===id) || LEAVE_TYPES[0];
  const lvBadge = s => s==='approved'?'badge-green':s==='rejected'?'badge-red':'badge-orange';
  const esc = s => (window.escHtml ? window.escHtml(s) : (s==null?'':String(s)));

  // Inclusive working-day count, excluding Sundays (Manila "Sunday = no work").
  function workingDays(start, end){
    if(!start||!end) return 0;
    const s=new Date(start+'T00:00:00'), e=new Date(end+'T00:00:00');
    if(isNaN(s)||isNaN(e)||e<s) return 0;
    let n=0; const d=new Date(s);
    while(d<=e){ if(d.getDay()!==0) n++; d.setDate(d.getDate()+1); if(n>366) break; }
    return n;
  }
  async function getBalance(uid){
    try{ const d=await db.collection('leave_balances').doc(uid).get(); return d.exists?d.data():{vacation:0,sick:0}; }
    catch(_){ return {vacation:0,sick:0}; }
  }
  function leaveRow(r, showWho){
    const t=leaveType(r.type);
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">
      <span style="font-size:20px">${t.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${t.label} · ${r.days||0} day${(r.days||0)!==1?'s':''}${showWho?` — ${esc(r.userName||'')}`:''}</div>
        <div style="font-size:11px;color:var(--text-muted)">${esc(r.startDate||'')} → ${esc(r.endDate||'')}${r.reason?` · ${esc(r.reason)}`:''}</div>
      </div>
      <span class="badge ${lvBadge(r.status)}">${esc(r.status||'pending')}</span>
    </div>`;
  }

  window.renderLeavePage = async function(container){
    const c = container || document.getElementById('page-content');
    if(!c) return;
    const isAdmin = currentRole==='president'||currentRole==='manager'||currentRole==='finance';
    return isAdmin ? renderLeaveAdmin(c) : renderLeaveEmployee(c);
  };

  async function renderLeaveEmployee(c){
    c.innerHTML = '<div class="loading-placeholder">Loading leave…</div>';
    const [snap, bal] = await Promise.all([
      db.collection('leave_requests').where('userId','==',currentUser.uid).get().catch(()=>({docs:[]})),
      getBalance(currentUser.uid),
    ]);
    const reqs = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const pending = reqs.filter(r=>r.status==='pending').length;
    c.innerHTML = `
      <div class="page-header"><h2>🌴 My Leave</h2><button class="btn-primary btn-sm" id="new-leave-btn">+ Request Leave</button></div>
      <div class="kpi-row" style="margin-bottom:14px">
        <div class="kpi-card green"><div class="kpi-label">Vacation left</div><div class="kpi-value">${bal.vacation||0}<span style="font-size:12px;font-weight:500"> days</span></div></div>
        <div class="kpi-card"><div class="kpi-label">Sick left</div><div class="kpi-value">${bal.sick||0}<span style="font-size:12px;font-weight:500"> days</span></div></div>
        <div class="kpi-card ${pending?'accent':''}"><div class="kpi-label">Pending</div><div class="kpi-value">${pending}</div></div>
      </div>
      <div class="card"><div class="card-header"><h3>My Requests</h3></div><div class="card-body" style="padding:0">
        ${!reqs.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">🌴</div><h4>No leave requests yet</h4><p>Tap "Request Leave" to file one.</p></div>':
          reqs.map(r=>leaveRow(r,false)).join('')}
      </div></div>`;
    document.getElementById('new-leave-btn').onclick = ()=>openLeaveModal(bal, c);
  }

  async function renderLeaveAdmin(c){
    c.innerHTML = '<div class="loading-placeholder">Loading leave…</div>';
    const snap = await db.collection('leave_requests').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
    const reqs = snap.docs.map(d=>({id:d.id,...d.data()}));
    const pending = reqs.filter(r=>r.status==='pending');
    const approved = reqs.filter(r=>r.status==='approved').length;
    c.innerHTML = `
      <div class="page-header"><h2>🌴 Leave Management</h2><div style="display:flex;gap:8px"><button class="btn-secondary btn-sm" id="leave-csv">⬇ CSV</button><button class="btn-secondary btn-sm" id="my-leave-btn">My Leave</button></div></div>
      <div class="kpi-row" style="margin-bottom:14px">
        <div class="kpi-card ${pending.length?'accent':''}"><div class="kpi-label">Pending</div><div class="kpi-value">${pending.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Approved</div><div class="kpi-value">${approved}</div></div>
        <div class="kpi-card"><div class="kpi-label">Total Requests</div><div class="kpi-value">${reqs.length}</div></div>
      </div>
      ${pending.length?`<div class="card" style="margin-bottom:14px;border:1.5px solid var(--warning)"><div class="card-header"><h3>⏳ Pending Approval</h3></div><div class="card-body" style="padding:0">
        ${pending.map(r=>`<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap">
          <span style="font-size:20px">${leaveType(r.type).icon}</span>
          <div style="flex:1;min-width:160px">
            <div style="font-size:13px;font-weight:600">${esc(r.userName||'Employee')} — ${leaveType(r.type).label} · ${r.days||0}d</div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(r.startDate||'')} → ${esc(r.endDate||'')}${r.reason?` · ${esc(r.reason)}`:''}</div>
          </div>
          <button class="btn-success btn-sm lv-approve" data-id="${r.id}">Approve</button>
          <button class="btn-secondary btn-sm lv-reject" data-id="${r.id}">Reject</button>
        </div>`).join('')}
      </div></div>`:''}
      <div class="card"><div class="card-header"><h3>All Requests</h3></div><div class="card-body" style="padding:0">
        ${!reqs.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">🌴</div><h4>No leave requests</h4></div>':
          reqs.map(r=>leaveRow(r,true)).join('')}
      </div></div>`;
    document.getElementById('my-leave-btn').onclick = ()=>renderLeaveEmployee(c);
    document.getElementById('leave-csv')?.addEventListener('click',()=>window.exportCSV('leave-requests', reqs, [
      {key:'userName',label:'Employee'},{key:'type',label:'Type',get:r=>leaveType(r.type).label},{key:'days',label:'Days'},
      {key:'startDate',label:'Start'},{key:'endDate',label:'End'},{key:'status',label:'Status'},{key:'reason',label:'Reason'}]));
    c.querySelectorAll('.lv-approve').forEach(b=>b.addEventListener('click',()=>approveLeave(reqs.find(r=>r.id===b.dataset.id),c)));
    c.querySelectorAll('.lv-reject').forEach(b=>b.addEventListener('click',()=>rejectLeave(reqs.find(r=>r.id===b.dataset.id),c)));
  }

  function openLeaveModal(bal, c){
    const today = window.bizDate?window.bizDate():new Date().toISOString().slice(0,10);
    openModal('🌴 Request Leave', `
      <div class="form-group"><label>Leave Type</label>
        <select id="lv-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          ${LEAVE_TYPES.map(t=>`<option value="${t.id}">${t.icon} ${t.label}${t.drawsBalance?` (${bal[t.id]||0} left)`:''}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Start Date</label><input id="lv-start" type="date" value="${today}"/></div>
        <div class="form-group"><label>End Date</label><input id="lv-end" type="date" value="${today}"/></div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px" id="lv-days-hint">1 working day (excl. Sundays)</div>
      <div class="form-group"><label>Reason</label><textarea id="lv-reason" rows="2" placeholder="Brief reason"></textarea></div>
      <div id="lv-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="lv-save">Submit Request</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    const upd = ()=>{ const d=workingDays(document.getElementById('lv-start').value, document.getElementById('lv-end').value); document.getElementById('lv-days-hint').textContent=`${d} working day${d!==1?'s':''} (excl. Sundays)`; };
    document.getElementById('lv-start').addEventListener('change',upd);
    document.getElementById('lv-end').addEventListener('change',upd);
    document.getElementById('lv-save').addEventListener('click', async ()=>{
      const type=document.getElementById('lv-type').value;
      const startDate=document.getElementById('lv-start').value, endDate=document.getElementById('lv-end').value;
      const reason=document.getElementById('lv-reason').value.trim();
      const err=document.getElementById('lv-err');
      const days=workingDays(startDate,endDate);
      if(!startDate||!endDate||days<=0){ err.textContent='Pick a valid date range.'; err.classList.remove('hidden'); return; }
      const lt=leaveType(type);
      if(lt.drawsBalance && days > (bal[type]||0)){ err.textContent=`Not enough ${lt.label.toLowerCase()} — ${bal[type]||0} day(s) left, ${days} requested.`; err.classList.remove('hidden'); return; }
      try{
        await db.collection('leave_requests').add({
          userId:currentUser.uid, userName:userProfile?.displayName||currentUser.email,
          type, startDate, endDate, days, reason, status:'pending',
          createdAt:firebase.firestore.FieldValue.serverTimestamp(),
        });
        window.logAudit && window.logAudit('create','leave',null,{ user:userProfile?.displayName||currentUser.email, type, days });
        try{ await Notifs.sendToOwner({ title:'🌴 Leave Request', body:`${userProfile?.displayName||currentUser.email} requests ${days}-day ${lt.label} (${startDate}→${endDate}).`, icon:'🌴', type:'leave' }); }catch(_){}
        closeModal(); Notifs.showToast('Leave request submitted!'); window.renderLeavePage(c);
      }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
    });
  }

  async function approveLeave(r, c){
    if(!r) return;
    try{
      await db.collection('leave_requests').doc(r.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
      const lt=leaveType(r.type);
      if(lt.drawsBalance){
        const bal=await getBalance(r.userId);
        const newBal=Math.max(0,(bal[r.type]||0)-(r.days||0));
        await db.collection('leave_balances').doc(r.userId).set({ [r.type]:newBal, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
      }
      window.logAudit && window.logAudit('approve','leave',r.id,{ user:r.userName, type:r.type, days:r.days });
      try{ Notifs.send(r.userId, { title:'Leave Approved ✅', body:`Your ${r.days}-day ${lt.label} (${r.startDate}→${r.endDate}) was approved.`, icon:'✅', type:'leave', dedupKey:`leave-ok-${r.id}` }); }catch(_){}
      Notifs.showToast('Leave approved'); window.renderLeavePage(c);
    }catch(ex){ Notifs.showToast('Approve failed: '+(ex.message||ex.code),'error'); }
  }

  async function rejectLeave(r, c){
    if(!r) return;
    const reason = prompt('Reason for rejection (optional):')||'';
    try{
      await db.collection('leave_requests').doc(r.id).update({ status:'rejected', approvedBy:currentUser.uid, rejectedReason:reason, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
      window.logAudit && window.logAudit('reject','leave',r.id,{ user:r.userName, type:r.type });
      try{ Notifs.send(r.userId, { title:'Leave Rejected', body:`Your ${leaveType(r.type).label} request was not approved.${reason?' Reason: '+reason:''}`, icon:'❌', type:'leave', dedupKey:`leave-no-${r.id}` }); }catch(_){}
      Notifs.showToast('Leave rejected'); window.renderLeavePage(c);
    }catch(ex){ Notifs.showToast('Reject failed','error'); }
  }

  // Exposed so the President's Approvals page (renderApprovals in departments.js) can
  // action leave from the unified queue, reusing the same balance-debit + notify logic
  // as the Leave Management screen. They do the DB work and return; the caller refreshes.
  window.approveLeaveRequest = async function(id){
    const s = await db.collection('leave_requests').doc(id).get();
    if(!s.exists) throw new Error('Leave request not found');
    const r = { id:s.id, ...s.data() };
    await db.collection('leave_requests').doc(r.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
    const lt = leaveType(r.type);
    if(lt.drawsBalance){
      const bal = await getBalance(r.userId);
      const newBal = Math.max(0,(bal[r.type]||0)-(r.days||0));
      await db.collection('leave_balances').doc(r.userId).set({ [r.type]:newBal, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
    }
    window.logAudit && window.logAudit('approve','leave',r.id,{ user:r.userName, type:r.type, days:r.days });
    try{ Notifs.send(r.userId, { title:'Leave Approved ✅', body:`Your ${r.days}-day ${lt.label} (${r.startDate}→${r.endDate}) was approved.`, icon:'✅', type:'leave', dedupKey:`leave-ok-${r.id}` }); }catch(_){}
    return r;
  };
  window.rejectLeaveRequest = async function(id, reason){
    const s = await db.collection('leave_requests').doc(id).get();
    if(!s.exists) throw new Error('Leave request not found');
    const r = { id:s.id, ...s.data() };
    await db.collection('leave_requests').doc(r.id).update({ status:'rejected', approvedBy:currentUser.uid, rejectedReason:reason||'', approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
    window.logAudit && window.logAudit('reject','leave',r.id,{ user:r.userName, type:r.type });
    try{ Notifs.send(r.userId, { title:'Leave Rejected', body:`Your ${leaveType(r.type).label} request was not approved.${reason?' Reason: '+reason:''}`, icon:'❌', type:'leave', dedupKey:`leave-no-${r.id}` }); }catch(_){}
    return r;
  };
})();


// ═══════════════════════════════════════════════════
//  GLOBAL SEARCH — across tasks, clients, inventory, products, quotes
//  Internal staff only. Partners / Brilliant-Steel-only are gated out (some of
//  these collections are partner-readable at the rules level, so the UI must
//  explicitly exclude them — never rely on rules alone here).
// ═══════════════════════════════════════════════════
(function(){
  const esc = s => (window.escHtml ? window.escHtml(s) : (s==null?'':String(s)));
  const hit = (q, ...fields) => fields.some(f => (f||'').toString().toLowerCase().includes(q));

  window.renderGlobalSearch = async function(initialQuery){
    const c = document.getElementById('page-content');
    if(!c) return;
    const blocked = (typeof isPartner==='function' && isPartner()) || (typeof isBrilliantOnly==='function' && isBrilliantOnly());
    if(blocked){ c.innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><h4>Search is not available for this account</h4></div>'; return; }

    c.innerHTML = `
      <div class="page-header"><h2>🔎 Search</h2></div>
      <input id="gsearch-input" placeholder="Search tasks, clients, inventory, products, quotes…" value="${(initialQuery||'').replace(/"/g,'&quot;')}"
        style="width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-size:15px;margin-bottom:14px"/>
      <div id="gsearch-results"><div class="empty-state" style="padding:30px"><div class="empty-icon">🔎</div><p>Type to search across the company.</p></div></div>`;
    const input = document.getElementById('gsearch-input');
    const out = document.getElementById('gsearch-results');

    let sources = null;
    async function load(){
      if(sources) return sources;
      const toArr = s => s.docs.map(d=>({id:d.id,...d.data()}));
      const safe = p => p.then(toArr).catch(()=>[]);
      const [tasks, quotes, sc, dc, bsc, inv, prod] = await Promise.all([
        (typeof dbCachedGet==='function'?dbCachedGet('tasks-all',()=>db.collection('tasks').get(),30000):db.collection('tasks').get()).then(toArr).catch(()=>[]),
        (typeof getAllQuotes==='function'?getAllQuotes():db.collection('bk_quotes').get()).then(toArr).catch(()=>[]),
        safe(db.collection('sales_clients').get()),
        safe(db.collection('design_clients').get()),
        safe(db.collection('bs_clients').get()),
        safe(db.collection('inventory_items').get()),
        safe(db.collection('products').limit(1000).get()),
      ]);
      sources = { tasks, quotes,
        clients: [...sc.map(x=>({...x,_brand:'sales'})), ...dc.map(x=>({...x,_brand:'design'})), ...bsc.map(x=>({...x,_brand:'bs'}))],
        inv, prod };
      return sources;
    }

    const rowItem = (icon,title,sub,onclick)=>`<div class="item-card" style="cursor:pointer;display:flex;align-items:center;gap:10px" onclick="${onclick}"><span style="font-size:18px">${icon}</span><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${esc(title)}</div><div style="font-size:11px;color:var(--text-muted)">${esc(sub)}</div></div></div>`;
    const groupHtml = (icon,title,rows,render)=> !rows.length ? '' :
      `<div class="card" style="margin-bottom:12px"><div class="card-header"><h3>${icon} ${title} (${rows.length})</h3></div><div class="card-body" style="padding:0">${rows.slice(0,8).map(render).join('')}</div></div>`;

    async function runSearch(qRaw){
      const q = (qRaw||'').trim().toLowerCase();
      if(!q){ out.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">🔎</div><p>Type to search across the company.</p></div>'; return; }
      out.innerHTML = '<div class="loading-placeholder">Searching…</div>';
      const S = await load();
      const tasks   = S.tasks.filter(t=>hit(q,t.title,t.description,t.department));
      const clients = S.clients.filter(x=>hit(q,x.name,x.company,x.email,x.phone));
      const inv     = S.inv.filter(i=>hit(q,i.name,i.category,i.supplier));
      const prod    = S.prod.filter(p=>hit(q,p.title,p.name,p.shortName,p.id,p.category));
      const quotes  = S.quotes.filter(qt=>hit(q,qt.quoteNumber,qt.clientName,qt.status));
      const total = tasks.length+clients.length+inv.length+prod.length+quotes.length;
      if(!total){ out.innerHTML = `<div class="empty-state" style="padding:30px"><div class="empty-icon">🤷</div><h4>No results for "${esc(qRaw)}"</h4></div>`; return; }
      out.innerHTML =
        groupHtml('✅','Tasks',tasks,t=>rowItem('📋',t.title||'(untitled)',(t.department||'')+(t.status?' · '+t.status:''),`window.openTaskDetail&&window.openTaskDetail('${t.id}',window.currentUser,window.currentRole)`)) +
        groupHtml('👤','Clients',clients,x=>rowItem('👤',x.name||x.company||'Client',(x.company||'')+(x.phone?' · '+x.phone:''),`navigateTo('${x._brand==='design'?'dept:Design':x._brand==='bs'?'bs-clients':'dept:Sales'}')`)) +
        groupHtml('📦','Inventory',inv,i=>rowItem('📦',i.name||'(item)',(i.category||'')+' · '+(i.qty||0)+' '+(i.unit||''),`navigateTo('inventory')`)) +
        groupHtml('🛒','Products',prod,p=>rowItem('🛒',p.title||p.name||p.id,(p.id||'')+(p.category?' · '+p.category:''),`navigateTo('product-database')`)) +
        groupHtml('📄','Quotes',quotes,qt=>rowItem('📄',(qt.quoteNumber||'Quote')+(qt.clientName?' — '+qt.clientName:''),(qt.status||'draft'),`navigateTo('${(qt.quoteNumber||'').toString().toUpperCase().startsWith('BS')?'bs-quotations':'dept:Sales'}')`));
    }

    let _t; input.addEventListener('input',()=>{ clearTimeout(_t); _t=setTimeout(()=>runSearch(input.value),220); });
    input.focus();
    if(initialQuery) runSearch(initialQuery);
  };
})();
