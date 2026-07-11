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
      if (!(await confirmDialog({ message: 'Delete this post?', danger: true }))) return;
      await db.collection('posts').doc(e.target.dataset.id).delete();
      Notifs.showToast('Deleted.');
      loadPosts(dept);
    }));
    container.querySelectorAll('.post-pin-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id = e.currentTarget.dataset.id;
      const snap = await db.collection('posts').doc(id).get().catch(()=>null);
      if (!snap || !snap.exists) { Notifs.showToast('Post no longer exists.','error'); loadPosts(dept); return; }
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

      // Persist to Firestore (revert the optimistic UI if the write fails)
      const uid = currentUser.uid;
      const op = isHearted
        ? firebase.firestore.FieldValue.arrayRemove(uid)
        : firebase.firestore.FieldValue.arrayUnion(uid);
      try {
        await db.collection('posts').doc(id).update({ hearts: op });
      } catch (err) {
        btn.classList.toggle('hearted', isHearted);
        if (countEl) { countEl.textContent = currentCount; countEl.style.display = currentCount > 0 ? '' : 'none'; }
        if (svg) { svg.setAttribute('fill', isHearted ? '#FF6B2B' : 'none'); svg.setAttribute('stroke', isHearted ? '#FF6B2B' : 'currentColor'); }
        Notifs.showToast('Could not save your like.', 'error');
      }
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
      openPage('✎ Edit Post', `
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
  openPage(publishDirectly ? 'New Post' : 'Submit Post for Approval', `
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
      openPage('Invite Team Member', `
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">They'll receive a password reset email to set their own password.</p>
        <div class="form-group"><label>Email</label><input id="inv-email" type="email" placeholder="employee@barroindustries.com"/></div>
        <div class="form-group"><label>Display Name</label><input id="inv-name" placeholder="Full name"/></div>
        <div class="form-group"><label>Phone</label><input id="inv-phone" type="tel" placeholder="+63 9XX XXX XXXX"/></div>
        <div class="form-group"><label>Role</label>
          <select id="inv-role" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            ${Object.entries(window.ROLES||{}).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" id="inv-company-group" style="display:none"><label>Company <span style="font-weight:400;color:var(--text-muted)">(partner's own company)</span></label>
          <input id="inv-company" placeholder="e.g. Brilliant Steel Corporation"/>
        </div>
        <div class="form-group"><label>Department(s)</label>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:4px">
            ${Object.keys(window.DEPARTMENTS||{}).map(d=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" class="inv-dept-cb" value="${d}"/>${d}</label>`).join('')}
          </div>
        </div>
      `, `<button class="btn-primary" id="save-inv-btn">Send Invite</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      // Company field is only relevant for the Partner role — reveal it when picked.
      const invRole = document.getElementById('inv-role');
      const syncCompany = () => {
        const g = document.getElementById('inv-company-group');
        if (g) g.style.display = (invRole.value === 'partner') ? 'block' : 'none';
      };
      invRole?.addEventListener('change', syncCompany); syncCompany();
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
            company:     document.getElementById('inv-company')?.value.trim() || '',
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

// The award is now SYSTEM-CHOSEN, not manually picked: each eligible team member
// is scored from task KPI (50%), attendance (40%) and performance grade (10%),
// and the top scorer is the Employee of the Month.
//
// Why the President's session does the computing: per firestore.rules, regular
// employees can't read other people's attendance (isOwner || isFinanceOrAdmin),
// and only the President can write settings/*. So the President's Team page
// computes the live standings and persists the winner to settings/employeeOfMonth;
// everyone else just reads that one doc (cheap, and consistent for all viewers).
// Shift a "YYYY-MM" string by `delta` months (handles year rollover).
function ymShift(ym, delta) {
  let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + delta;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

async function renderEomBanner(users, canManage) {
  const host = document.getElementById('eom-banner');
  if (!host) return;
  // Employee of the Month is finalised & revealed on the 5th of each month
  // (matches the payroll "finalise by the 5th" cutoff, by which KPI + attendance
  // + grades have settled). From the 5th we show LAST month's winner; before the
  // 5th that month isn't settled yet, so we show the month before it. The award is
  // always a COMPLETED month — never a live mid-month running total.
  const _today = window.bizDate();
  const month = ymShift(_today.slice(0, 7), (+_today.slice(8, 10) >= 5) ? -1 : -2);
  const monthLbl = eomMonthLabel(month) || month;

  // ── President: compute live standings and persist the winner ──
  if (canManage) {
    let standings = [];
    try { standings = await computeEomStandings(users, month); } catch (e) { standings = []; }
    const winner = standings[0] || null;

    if (!winner) {
      host.innerHTML = `
        <div class="eom-banner eom-banner--empty">
          <div class="eom-empty-icon">🏆</div>
          <div class="eom-empty-text">
            <strong>Employee of the Month · ${escHtml(monthLbl)}</strong>
            <span>Auto-selected from KPI &amp; attendance, finalised and revealed on the 5th. No eligible activity recorded for ${escHtml(monthLbl)}.</span>
          </div>
          <button class="btn-secondary btn-sm" id="eom-standings-btn">📊 Standings</button>
        </div>`;
      document.getElementById('eom-standings-btn')?.addEventListener('click', () => openEomStandingsModal(standings, month));
      return;
    }

    // Persist the computed winner (only when it actually changed) so non-admins
    // read a fresh, identical result. Preserve announcedMonth within the same
    // month; reset it when the month rolls over (a new month isn't announced yet).
    try {
      const ref = db.collection('settings').doc('employeeOfMonth');
      const curSnap = await ref.get();
      const cur = curSnap.exists ? curSnap.data() : {};
      const sameMonth = cur.month === month;
      const changed = cur.uid !== winner.uid || !sameMonth
        || Math.round((cur.score || 0) * 1000) !== Math.round(winner.score * 1000);
      winner.announcedMonth = sameMonth ? (cur.announcedMonth || null) : null;
      if (changed) {
        await ref.set({
          uid: winner.uid,
          displayName: winner.displayName, email: winner.email,
          photoUrl: winner.photoUrl, role: winner.role, departments: winner.departments,
          reason: winner.citation, month,
          auto: true, score: winner.score, kpiPct: winner.taskPct, attPct: winner.attPct,
          grade: winner.grade ?? null,
          announcedMonth: winner.announcedMonth,
          computedBy: currentUser.uid,
          computedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    } catch (e) { /* persist failure is non-fatal — still render the live result */ }

    renderEomCard(host, winner, users, true, standings, month);
    return;
  }

  // ── Everyone else: read the persisted winner (1 doc) ──
  let eom = null;
  try {
    const doc = await db.collection('settings').doc('employeeOfMonth').get();
    eom = doc.exists ? doc.data() : null;
  } catch (e) { /* read failure → render nothing */ }
  if (!eom || !eom.uid) { host.innerHTML = ''; return; }
  renderEomCard(host, eom, users, false, null, eom.month);
}

// Render the gold winner card. `data` is either a freshly computed standing or
// the persisted settings doc — both carry uid/name/photo/role/departments plus
// the metric percentages used for the auto-citation.
function renderEomCard(host, data, users, canManage, standings, month) {
  const live = users.find(u => u.id === data.uid);
  const name = live?.displayName || data.displayName || data.email || 'Team member';
  const photoUrl = live?.photoUrl || data.photoUrl || '';
  const role = live?.role || data.role;
  const roleLabel = window.ROLES?.[role]?.label || role || 'Employee';
  const deptsArr = live
    ? (Array.isArray(live.departments) && live.departments.length ? live.departments : (live.department ? [live.department] : []))
    : (data.departments || []);
  const depts = deptsArr.join(' · ') || 'Barro Industries';
  const initials = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const attPct = data.attPct, kpiPct = data.kpiPct ?? data.taskPct;
  const metrics = (attPct != null && kpiPct != null) ? ` · ${attPct}% att · ${kpiPct}% KPI` : '';

  host.innerHTML = `
    <div class="eom-banner">
      <div class="eom-ribbon">🏆 Employee of the Month${data.month ? ` · ${escHtml(eomMonthLabel(data.month))}` : ''}</div>
      <div class="eom-body">
        <div class="eom-avatar">
          ${photoUrl ? `<img src="${escHtml(photoUrl)}" alt="${escHtml(name)}"/>` : `<span>${escHtml(initials)}</span>`}
        </div>
        <div class="eom-info">
          <div class="eom-name">${escHtml(name)}</div>
          <div class="eom-role">${escHtml(roleLabel)} · ${escHtml(depts)}</div>
          ${data.reason ? `<div class="eom-reason">${escHtml(data.reason)}</div>` : ''}
          <div class="eom-auto-tag">⚙️ Auto-selected by performance${metrics}</div>
        </div>
        ${canManage ? `<button class="eom-edit-btn" id="eom-standings-btn" title="View standings">${emojiIcon('bar-chart-3',16)}</button>` : ''}
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [host] });
  if (canManage) document.getElementById('eom-standings-btn')?.addEventListener('click', () => openEomStandingsModal(standings, month));
}

// Score every eligible team member for the current month and return them ranked
// (highest first). Eligible = internal Barro Industries staff who have logged at
// least one attendance day this month — excludes the President (who runs the
// award), external partners, and Brilliant Steel-only members.
//
// score = 0.50·taskKPI + 0.40·attendance + 0.10·grade  (each component 0–1)
//   taskKPI    = completed / assigned tasks  (neutral 0.5 when none assigned)
//   attendance = attendance points / workdays elapsed this month
//   grade      = President grade /10  (neutral 0.5 when ungraded)
async function computeEomStandings(users, monthStr) {
  const todayStr = window.bizDate();
  const month = monthStr || todayStr.slice(0, 7);
  const isPastMonth = month < todayStr.slice(0, 7);
  const y = +month.slice(0, 4), m = +month.slice(5, 7) - 1;
  const monthStart = `${month}-01`;
  // For a completed month, score the WHOLE month; for the (rare) current-month
  // fallback, score through today.
  const lastDom = isPastMonth ? new Date(y, m + 1, 0).getDate() : +todayStr.slice(8, 10);
  const rangeEndStr = isPastMonth ? `${month}-${String(lastDom).padStart(2, '0')}` : todayStr;
  const workDaysElapsed = (typeof countWorkDays === 'function') ? countWorkDays(y, m, lastDom) : Math.max(1, lastDom);

  const candidates = users.filter(u =>
    u.role !== 'partner' && u.role !== 'president'
    && !(Array.isArray(u.departments) && u.departments.length === 1 && u.departments[0] === 'Brilliant Steel'));
  if (!candidates.length) return [];

  // Load all tasks + grades once (shared across candidates), then read each
  // candidate's attendance in parallel.
  const tasksGet = (typeof dbCachedGet === 'function')
    ? dbCachedGet('tasks-all', () => db.collection('tasks').get(), 60000)
    : db.collection('tasks').get();
  const evalsGet = (typeof dbCachedGet === 'function')
    ? dbCachedGet('kpi-evals', () => db.collection('kpi_evals').get(), 60000)
    : db.collection('kpi_evals').get();
  const [taskSnap, evalSnap] = await Promise.all([
    tasksGet.catch(() => ({ docs: [] })),
    evalsGet.catch(() => ({ docs: [] }))
  ]);
  const allTasks = taskSnap.docs.map(t => t.data());
  const evals = {}; evalSnap.docs.forEach(e => { evals[e.id] = e.data(); });
  const DONE = ['done', 'approved', 'archived'];
  const isAssigned = (t, uid) => Array.isArray(t.assignedTo) ? t.assignedTo.includes(uid) : t.assignedTo === uid;
  const recScore = r => window.attRecScore(r);

  const rows = await Promise.all(candidates.map(async u => {
    const uid = u.id;
    let attScore = 0, attDays = 0;
    try {
      const snap = await db.collection('attendance').doc(uid).collection('records')
        .where(firebase.firestore.FieldPath.documentId(), '>=', monthStart)
        .where(firebase.firestore.FieldPath.documentId(), '<=', rangeEndStr).get();
      attDays = snap.size;
      const total = snap.docs.reduce((s, doc) => s + recScore(doc.data()), 0);
      attScore = Math.min(1, total / workDaysElapsed);
    } catch (e) { attScore = 0; attDays = 0; }

    const mine = allTasks.filter(t => isAssigned(t, uid));
    const doneTasks = mine.filter(t => DONE.includes(t.status)).length;
    const taskScore = mine.length ? Math.min(1, doneTasks / mine.length) : 0.5;

    const ev = evals[uid] || {};
    const grade = (typeof ev.presidentGrade === 'number') ? ev.presidentGrade
      : (typeof ev.presidentGradeFromTasks === 'number') ? ev.presidentGradeFromTasks : null;
    const gradeNorm = grade != null ? Math.min(1, grade / 10) : 0.5;

    const score = 0.5 * taskScore + 0.4 * attScore + 0.1 * gradeNorm;
    return {
      uid, displayName: u.displayName || u.email || '', email: u.email || '',
      photoUrl: u.photoUrl || '', role: u.role || 'employee',
      departments: Array.isArray(u.departments) && u.departments.length ? u.departments : (u.department ? [u.department] : []),
      attScore, attDays, attPct: Math.round(attScore * 100),
      taskScore, doneTasks, totalTasks: mine.length, taskPct: Math.round(taskScore * 100),
      grade, score, citation: ''
    };
  }));

  const eligible = rows.filter(r => r.attDays >= 1);
  eligible.sort((a, b) =>
    b.score - a.score || b.attScore - a.attScore || b.taskScore - a.taskScore
    || (a.displayName || '').localeCompare(b.displayName || ''));
  const monthLbl = eomMonthLabel(month) || month;
  eligible.forEach(r => {
    r.citation = `Top performer for ${monthLbl} — ${r.attPct}% attendance · ${r.taskPct}% task KPI`
      + (r.doneTasks > 0 ? ` · ${r.doneTasks} task${r.doneTasks !== 1 ? 's' : ''} done` : '') + '.';
  });
  return eligible;
}

// President-only: show the ranked leaderboard behind the auto-selection, with an
// option to announce (notify) the current winner. The system chooses the person;
// announcing is an explicit, one-tap action so the congrats fires when intended.
function openEomStandingsModal(standings, month) {
  if (!standings || !standings.length) {
    openModal('📊 Employee of the Month — Standings',
      `<div class="empty-state" style="padding:30px"><div class="empty-icon">📊</div><p>No eligible team members have logged attendance yet this month.</p></div>`,
      `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    return;
  }
  const winner = standings[0];
  const rows = standings.map((s, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const initials = (s.displayName || s.email || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;background:${i === 0 ? 'rgba(255,196,0,0.1)' : 'var(--surface2,rgba(255,255,255,0.04))'};margin-bottom:8px;border:1px solid ${i === 0 ? 'rgba(255,196,0,0.35)' : 'transparent'}">
      <div style="font-size:18px;width:28px;text-align:center;flex:0 0 auto">${medal}</div>
      <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-light));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;flex:0 0 auto;overflow:hidden">${s.photoUrl ? `<img src="${escHtml(s.photoUrl)}" style="width:100%;height:100%;object-fit:cover" alt=""/>` : escHtml(initials)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.displayName || s.email)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${s.attPct}% att · ${s.taskPct}% KPI${s.grade != null ? ` · grade ${s.grade}/10` : ''}</div>
      </div>
      <div style="text-align:right;flex:0 0 auto">
        <div style="font-size:16px;font-weight:800;color:${i === 0 ? '#FFB800' : 'var(--text)'}">${Math.round(s.score * 100)}</div>
        <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">score</div>
      </div>
    </div>`;
  }).join('');

  const alreadyAnnounced = winner.announcedMonth === month;
  const firstName = (winner.displayName || winner.email || 'Winner').split(' ')[0];
  const footer = alreadyAnnounced
    ? `<button class="btn-secondary" disabled style="opacity:.6">✓ Announced</button><button class="btn-secondary" onclick="closeModal()">Close</button>`
    : `<button class="btn-primary" id="eom-announce-btn">📣 Announce ${escHtml(firstName)}</button><button class="btn-secondary" onclick="closeModal()">Close</button>`;

  openModal('📊 Employee of the Month — Standings', `
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Final standings for <strong>${escHtml(eomMonthLabel(month) || 'last month')}</strong> — ranked by task KPI (50%), attendance (40%) and performance grade (10%). Revealed &amp; awarded on the 5th.</p>
    <div>${rows}</div>
  `, footer, {size:'wide'});

  document.getElementById('eom-announce-btn')?.addEventListener('click', async () => {
    try {
      await db.collection('settings').doc('employeeOfMonth').set({ announcedMonth: month }, { merge: true });
      if (winner.uid !== currentUser.uid && Notifs?.send) {
        Notifs.send(winner.uid, {
          title: '🏆 Employee of the Month!',
          body: `Congratulations! You've been named Barro Industries Employee of the Month for ${eomMonthLabel(month)}.`,
          icon: '🏆', type: 'award',
          dedupKey: `eom-${winner.uid}-${month}`
        });
      }
      closeModal();
      Notifs.showToast(`Announced ${winner.displayName || winner.email} to the team! 🏆`);
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
        ${!isMe && (!(typeof isPartner==='function'&&isPartner()) || u.role==='partner'&&(u.company||'').trim()===(window.userProfile?.company||'').trim())
          ? `<button class="team-card-btn chat-dm-btn" data-uid="${u.id}" title="Message ${escHtml(u.displayName||u.email)}">💬</button>` : ''}
        ${!isMe ? `<button class="team-card-btn nudge-btn" data-uid="${u.id}" data-name="${(u.displayName||u.email).replace(/"/g,'&quot;')}" title="Nudge ${escHtml(u.displayName||u.email)}">👋</button>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;

  // Wire up calling card buttons
  grid.querySelectorAll('.view-card-btn').forEach(btn => {
    const u = users.find(x => x.id === btn.dataset.uid);
    if (u) btn.addEventListener('click', e => { e.stopPropagation(); showCallingCard(u); });
  });

  // Chat DM buttons
  grid.querySelectorAll('.chat-dm-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); window.Chat?.openDM?.(btn.dataset.uid); });
  });

  // Nudge buttons
  grid.querySelectorAll('.nudge-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { uid, name } = btn.dataset;
      if (!(await confirmDialog({ message: `Send a nudge to ${escHtml(name)}?`, html: true }))) return;
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

  // ── Admin overrides (prefetched into _holidayOverrides at boot) ──
  const ov = window._holidayOverrides && window._holidayOverrides[year];
  if (ov) {
    for (const date in ov) {
      if (ov[date] === null) delete holidays[date];   // admin removed a base holiday
      else holidays[date] = ov[date];                 // admin added/edited
    }
  }
  return holidays;
}

window.loadHolidayOverrides = async function(years) {
  years = years || [window.bizYear()-1, window.bizYear(), window.bizYear()+1];
  await Promise.all(years.map(async y => {
    try {
      const snap = await db.collection('settings_holidays').doc(String(y)).get();
      window._holidayOverrides[y] = (snap.exists && snap.data().overrides) ? snap.data().overrides : {};
    } catch { window._holidayOverrides[y] = {}; }
  }));
};

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
                <button class="btn-danger btn-sm ext-deny-btn" data-id="${r.id}" data-uid="${r.uid}" data-name="${escHtml(r.userName||'')}" style="margin-left:4px">✕ Deny</button>
              </td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>`;

    extEl.querySelectorAll('.ext-approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Approving…';
        await window.approveAttendanceExtension(btn.dataset.id, btn.dataset.uid, btn.dataset.name);
        Notifs.showToast(`Extension approved for ${btn.dataset.name||'employee'}`);
        loadExtensionRequests();
      });
    });

    extEl.querySelectorAll('.ext-deny-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await confirmDialog({ message: 'Deny this extension request?' }))) return;
        btn.disabled = true;
        await window.denyAttendanceExtension(btn.dataset.id, btn.dataset.uid, btn.dataset.name);
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

    let fullCount=0, halfCount=0, absentCount=0, leaveCount=0, workDays=0;

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
      const kind = window.attRecKind(rec);
      if (!isNoWork && isPast) {
        // Leave takes priority: an approved leave day carries its own status and
        // must not fall through to the present/half/absent classification below.
        if (kind === 'leave')              { status='leave';        leaveCount++;  workDays++; }
        else if (kind === 'unpaid-leave')  { status='unpaid-leave'; absentCount++; workDays++; }
        // An explicit soft-archived "absent" record (admin marked absent) counts as
        // absent even for today — the record is preserved instead of being deleted.
        else if (rec?.status === 'absent')      { status='absent';  absentCount++; workDays++; }
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
          status==='present'?`<span class="att-mark">${emojiIcon('check',14)}</span>`:
          status==='half'?'<span class="att-mark">½</span>':
          status==='absent'?`<span class="att-mark">${emojiIcon('x',14)}</span>`:
          status==='leave'?`<span class="att-mark" style="color:${window.attKindBadge('leave').c}">${window.attKindBadge('leave').m}</span>`:
          status==='unpaid-leave'?`<span class="att-mark" style="color:${window.attKindBadge('unpaid-leave').c}">${window.attKindBadge('unpaid-leave').m}</span>`:''}
        ${canEdit&&!isNoWork?`<button class="att-edit-btn att-edit-visible" data-date="${dateStr}" title="Edit">✎</button>`:''}
      </div>`;
    }
    html += '</div>';
    calEl.innerHTML = html;
    if (window.lucide) lucide.createIcons({nodes:[calEl]});

    const pct = workDays > 0 ? Math.round(((fullCount+leaveCount + halfCount*0.5)/workDays)*100) : 0;
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
            // Always write attendanceScore too: payroll and EOM read it FIRST (before
            // the fullTime/loginTime fallbacks), so an edit that leaves an old score
            // behind silently never reaches pay.
            if (status==='present')
              await ref.set({date,uid:targetUid,loginTime:firebase.firestore.Timestamp.fromDate(new Date()),fullTime:true,status:'present',attendanceScore:1.0,note,editedBy:currentUser.uid,editedAt:FV.serverTimestamp()},{merge:true});
            else if (status==='half')
              await ref.set({date,uid:targetUid,loginTime:firebase.firestore.Timestamp.fromDate(new Date()),fullTime:false,status:'half',attendanceScore:0.5,note,editedBy:currentUser.uid,editedAt:FV.serverTimestamp()},{merge:true});
            else
              // Soft-archive instead of deleting: preserve the audit trail payroll
              // depends on. Clear time markers so downstream reads classify as absent.
              await ref.set({date,uid:targetUid,status:'absent',fullTime:false,loginTime:FV.delete(),attendanceScore:0,note,editedBy:currentUser.uid,editedAt:FV.serverTimestamp()},{merge:true});
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
//  HOLIDAYS ADMIN — settings_holidays/{year} overrides
//  (finance/admin only — merges on top of getPHHolidays' base table)
//  NOTE: not yet wired into navigateTo's switch / a nav entry — that's
//  app.js's job (routing/nav is out of scope for this file per WS26 split).
// ══════════════════════════════════════════════════
window.renderHolidaysAdmin = async function(container) {
  const c = container || document.getElementById('page-content');
  if (!c) return;
  const canEdit = ['president','manager','secretary','finance'].includes(currentRole);
  if (!canEdit) {
    c.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-icon">🔒</div><h4>Not available</h4><p>Holidays admin is finance/admin only.</p></div>`;
    return;
  }

  let year = window._holidaysAdminYear || window.bizYear();

  async function renderYear(y) {
    year = y;
    window._holidaysAdminYear = y;
    c.innerHTML = '<div class="loading-placeholder">Loading holidays…</div>';
    if (typeof window.loadHolidayOverrides === 'function') {
      await window.loadHolidayOverrides([y]);
    }
    const merged    = typeof getPHHolidays === 'function' ? getPHHolidays(y) : {};
    const overrides = (window._holidayOverrides && window._holidayOverrides[y]) || {};
    const dates     = Object.keys(merged).sort();

    c.innerHTML = `
      <div class="page-header">
        <h2>📅 Holidays Admin</h2>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn-secondary btn-sm" id="hol-prev-year">‹</button>
          <strong style="min-width:48px;text-align:center;display:inline-block">${y}</strong>
          <button class="btn-secondary btn-sm" id="hol-next-year">›</button>
          <button class="btn-primary btn-sm" id="hol-add-btn" style="margin-left:8px">＋ Add / Edit</button>
        </div>
      </div>
      <div class="card"><div class="card-header"><h3>Holidays — ${y}</h3></div>
        <div class="card-body" style="padding:0">
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Source</th><th></th></tr></thead>
            <tbody>
              ${dates.length ? dates.map(d => {
                const h = merged[d];
                const isOverride = Object.prototype.hasOwnProperty.call(overrides, d);
                return `<tr>
                  <td>${escHtml(d)}</td>
                  <td>${escHtml(h.name||'')}</td>
                  <td><span class="badge ${h.type==='regular'?'badge-green':'badge-orange'}">${escHtml(h.type||'')}</span></td>
                  <td>${isOverride ? '<span class="badge badge-purple">override</span>' : '<span class="badge badge-gray">base</span>'}</td>
                  <td style="white-space:nowrap">
                    <button class="btn-secondary btn-sm hol-edit-btn" data-date="${escHtml(d)}">Edit</button>
                    <button class="btn-danger btn-sm hol-remove-btn" data-date="${escHtml(d)}" style="margin-left:4px">Remove</button>
                  </td>
                </tr>`;
              }).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No holidays for ${y}.</td></tr>`}
            </tbody>
          </table></div>
        </div>
      </div>`;

    document.getElementById('hol-prev-year').addEventListener('click', () => renderYear(y-1));
    document.getElementById('hol-next-year').addEventListener('click', () => renderYear(y+1));
    document.getElementById('hol-add-btn').addEventListener('click', () => openHolidayModal(null, null));
    c.querySelectorAll('.hol-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openHolidayModal(btn.dataset.date, merged[btn.dataset.date]));
    });
    c.querySelectorAll('.hol-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = merged[btn.dataset.date]?.name || btn.dataset.date;
        if (!(await confirmDialog({ message: `Remove "${name}" from ${year}? (base holidays only disappear for ${year} — other years are unaffected)` }))) return;
        await saveOverride(btn.dataset.date, null);
      });
    });
  }

  async function saveOverride(date, value) {
    const overridesMap = { ...((window._holidayOverrides && window._holidayOverrides[year]) || {}) };
    overridesMap[date] = value;   // null removes a base holiday; object adds/edits
    try {
      await db.collection('settings_holidays').doc(String(year)).set({
        year,
        overrides: overridesMap,
        updatedBy: currentUser.uid,
        updatedByName: userProfile.displayName || currentUser.email,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      await window.loadHolidayOverrides([year]);
      Notifs.showToast(value === null ? 'Holiday removed for '+year : 'Holiday saved for '+year);
      renderYear(year);
    } catch (ex) {
      Notifs.showToast('Save failed: '+(ex.message||ex.code), 'error');
    }
  }

  function openHolidayModal(date, existing) {
    openModal(date ? '✏️ Edit Holiday' : '＋ Add Holiday', `
      <div class="form-group"><label>Date</label><input id="hol-date" type="date" value="${escHtml(date||`${year}-01-01`)}" ${date?'disabled':''}/></div>
      <div class="form-group"><label>Name</label><input id="hol-name" type="text" value="${escHtml(existing?.name||'')}" placeholder="e.g. Maundy Thursday"/></div>
      <div class="form-group"><label>Type</label>
        <select id="hol-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="regular" ${existing?.type==='regular'?'selected':''}>Regular</option>
          <option value="special" ${existing?.type!=='regular'?'selected':''}>Special (non-working)</option>
        </select>
      </div>
      <div id="hol-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="hol-save-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('hol-save-btn').addEventListener('click', async () => {
      const d = document.getElementById('hol-date').value || date;
      const name = document.getElementById('hol-name').value.trim();
      const type = document.getElementById('hol-type').value;
      const err = document.getElementById('hol-err');
      if (!d || !name) { err.textContent = 'Date and name are required.'; err.classList.remove('hidden'); return; }
      closeModal();
      await saveOverride(d, { name, type });
    });
  }

  await renderYear(year);
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
  document.getElementById('new-ca-btn').addEventListener('click', () => window.CashAdvance.openRequestForm());
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
          <div class="table-wrap" style="border:1px solid var(--border);border-radius:8px">
            <table style="width:100%;border-collapse:collapse;min-width:280px">
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

  // v12 WS22 — all three route through the one shared CashAdvance service
  // (this page already had the safest transaction-guarded versions; now every
  // other CA surface in the app matches this same safety level).
  container.querySelectorAll('.ca-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => window.CashAdvance.openApproveModal(btn.dataset.id, () => window.renderCashAdvancePage()));
  });

  container.querySelectorAll('.ca-reject-btn').forEach(btn => btn.addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    try { await window.CashAdvance.reject(e.currentTarget.dataset.id); Notifs.showToast('Rejected.'); }
    catch (err) { Notifs.showToast(err.message||'Could not reject.','error'); }
    window.renderCashAdvancePage();
  }));

  container.querySelectorAll('.ca-payment-btn').forEach(btn => btn.addEventListener('click', e => {
    window.CashAdvance.openPaymentModal(e.currentTarget.dataset.id, async () => {
      await window.renderCashAdvancePage();
      // Stay on Active Loans/CA's tab after payment
      const activeBtn = document.querySelector('#ca-tabs [data-sub="active"]');
      if (activeBtn) activeBtn.click();
    });
  }));

  container.querySelectorAll('.ca-delete-btn').forEach(btn => btn.addEventListener('click', async e => {
    const id = e.currentTarget.dataset.id;
    if (!(await confirmDialog({ message: 'Permanently delete this cash advance record? This cannot be undone.', danger: true }))) return;
    await db.collection('cash_advances').doc(id).delete();
    Notifs.showToast('Record deleted.');
    window.renderCashAdvancePage();
  }));
}

// openCashAdvanceModal() retired (v12 WS22) — its form + write now live as the
// ONE shared window.CashAdvance.openRequestForm()/request() in js/config.js.
// The employee-facing interest checkbox is gone too: interest is now an
// approval-time decision, never an employee choice (WS22 decision 3).

function fmtN(n) {
  return Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
}

// President-only: record a cash advance for any employee (pre-approved)
function openPresidentCashAdvanceModal(users) {
  const employees = users.filter(u => u.role !== 'partner' && u.uid !== currentUser.uid);
  const empOptions = employees.map(u =>
    `<option value="${u.id}">${escHtml(u.displayName||u.email)} (${u.role||'employee'})</option>`
  ).join('');

  openPage('Record Cash Advance for Employee', `
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
    // Total to repay = monthly × terms (President sets these directly, so any
    // interest is baked into the monthly figure). Balance starts at the full
    // payable so the whole plan is collected — falls back to principal if no
    // monthly was entered.
    const totalPay = monthly > 0 ? Math.round(monthly * terms * 100) / 100 : amount;
    await db.collection('cash_advances').add({
      userId:         uid,
      userName:       emp?.displayName || emp?.email || uid,
      employeeId:     emp?.employeeId  || uid,
      amount,
      terms,
      interest:       0,
      monthlyPayment: monthly,
      totalPayable:   totalPay,
      balance:        totalPay,
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
      ${window.chipTabs(tabs.map(s=>({key:s,label:s})), sub, {cls:'inv-tabs'})}
      <div id="inv-content"><div class="loading-placeholder">Loading…</div></div>`;
    loadInv(sub);
    window.bindChipTabs(c.querySelector('.inv-tabs'), (key)=>loadInv(key));
  };

  function loadInv(sub){
    const el = document.getElementById('inv-content');
    if (sub==='Movements')   return renderMovements(el);
    if (sub==='Job Costing') return renderJobs(el);
    return renderStock(el);
  }

  async function renderStock(el){
    el.innerHTML = '<div class="loading-placeholder">Loading stock…</div>';
    const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
    const items = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    const ce = canEditInv();
    const low = items.filter(i=>(i.reorderLevel||0)>0 && (i.qty||0) <= (i.reorderLevel||0));
    const totalValue = items.reduce((s,i)=>s+((i.qty||0)*(i.unitCost||0)),0);
    const matValue  = items.filter(i=>(i.kind||'material')!=='product').reduce((s,i)=>s+((i.qty||0)*(i.unitCost||0)),0);
    const prodValue = totalValue - matValue;
    const cats = Array.from(new Set(items.map(i=>(i.category||'').trim()).filter(Boolean))).sort();
    let kindFilter='all', catFilter='all', search='';

    el.innerHTML = `
      <div class="kpi-row" style="margin-bottom:12px">
        <div class="kpi-card"><div class="kpi-label">Items</div><div class="kpi-value">${items.length}</div></div>
        <div class="kpi-card ${low.length?'red':''}"><div class="kpi-label">Low Stock</div><div class="kpi-value">${low.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Stock Value</div><div class="kpi-value">${peso(totalValue)}</div></div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin:0 2px 10px">Materials ${peso(matValue)} · Finished goods ${peso(prodValue)}</div>
      ${low.length?`<div class="alert-banner alert-warn" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>⚠️ <strong>${low.length} item${low.length>1?'s':''}</strong> at or below reorder level</span>${ce?`<button class="btn-secondary btn-sm" id="inv-reorder-btn" title="Open Purchasing to raise an RFQ for low-stock materials">📉 Reorder via RFQ</button>`:''}</div>`:''}
      ${window.chipTabs([{key:'all',label:'All'},{key:'material',label:'Raw Materials'},{key:'product',label:'Finished Goods'}],'all',{cls:'inv-kind'})}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <input id="inv-search" placeholder="🔎 Search item, supplier, category…" style="flex:1;min-width:160px;padding:8px 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px"/>
        ${cats.length?`<select id="inv-cat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px"><option value="all">All categories</option>${cats.map(c=>`<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}</select>`:''}
        <button class="btn-secondary btn-sm" id="inv-csv">⬇ CSV</button>
        ${ce?'<button class="btn-primary btn-sm" id="inv-add-btn">＋ Add Item</button>':''}
      </div>
      <div class="card"><div class="card-body" style="padding:0"><div id="inv-table"></div></div></div>`;

    const filtered = () => items.filter(i=>{
      if (kindFilter!=='all' && (i.kind||'material')!==kindFilter) return false;
      if (catFilter!=='all' && (i.category||'').trim()!==catFilter) return false;
      if (search){ const s=search.toLowerCase(); if(!((i.name||'').toLowerCase().includes(s)||(i.supplier||'').toLowerCase().includes(s)||(i.category||'').toLowerCase().includes(s))) return false; }
      return true;
    });

    const renderTable = () => {
      const shown = filtered();
      const shownValue = shown.reduce((s,i)=>s+((i.qty||0)*(i.unitCost||0)),0);
      const tbl = document.getElementById('inv-table');
      if (!tbl) return;
      tbl.innerHTML = !shown.length ? '<div class="empty-state" style="padding:24px"><div class="empty-icon">📦</div><h4>No items match</h4></div>' :
        `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Item</th><th>Type</th><th>On Hand</th><th>Reorder</th><th>Unit Cost</th><th>Value</th><th>Supplier</th><th></th></tr></thead>
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
              <td style="white-space:nowrap">
                <button class="btn-secondary btn-sm inv-hist-btn" data-id="${i.id}" title="Movement history">📜</button>
                ${ce?`<button class="btn-success btn-sm inv-in-btn" data-id="${i.id}" title="Stock In">＋</button>
                <button class="btn-secondary btn-sm inv-out-btn" data-id="${i.id}" title="Stock Out">−</button>
                <button class="btn-secondary btn-sm inv-edit-btn" data-id="${i.id}" title="Edit">✎</button>`:''}
              </td>
            </tr>`;}).join('')}</tbody>
          <tfoot><tr><td colspan="5" style="text-align:right;font-weight:700;color:var(--text-muted)">Shown value</td><td style="font-weight:700">${peso(shownValue)}</td><td colspan="2"></td></tr></tfoot>
        </table></div>`;
      // Row actions
      tbl.querySelectorAll('.inv-hist-btn').forEach(b=>b.addEventListener('click',()=>itemHistoryModal(items.find(i=>i.id===b.dataset.id))));
      if(ce){
        tbl.querySelectorAll('.inv-edit-btn').forEach(b=>b.addEventListener('click',()=>itemModal(items.find(i=>i.id===b.dataset.id),()=>renderStock(el))));
        tbl.querySelectorAll('.inv-in-btn').forEach(b=>b.addEventListener('click',()=>moveModal(items.find(i=>i.id===b.dataset.id),'in',()=>renderStock(el))));
        tbl.querySelectorAll('.inv-out-btn').forEach(b=>b.addEventListener('click',()=>moveModal(items.find(i=>i.id===b.dataset.id),'out',()=>renderStock(el))));
      }
    };

    window.bindChipTabs(el.querySelector('.inv-kind'), (key)=>{ kindFilter=key; renderTable(); });
    let _t; document.getElementById('inv-search')?.addEventListener('input', e=>{ clearTimeout(_t); const v=e.target.value; _t=setTimeout(()=>{ search=v.trim(); renderTable(); },180); });
    document.getElementById('inv-cat')?.addEventListener('change', e=>{ catFilter=e.target.value; renderTable(); });
    document.getElementById('inv-reorder-btn')?.addEventListener('click', ()=>{ try{ Notifs.showToast('Opening Purchasing — use “From low stock” to raise an RFQ.'); }catch(_){} navigateTo('dept:Purchasing'); });
    document.getElementById('inv-csv')?.addEventListener('click',()=>window.exportCSV('inventory', filtered(), [
      {key:'name',label:'Item'},{key:'kind',label:'Type',get:i=>(i.kind||'material')},{key:'category',label:'Category'},
      {key:'qty',label:'On Hand',get:i=>i.qty||0},{key:'unit',label:'Unit'},{key:'reorderLevel',label:'Reorder',get:i=>i.reorderLevel||0},
      {key:'unitCost',label:'Unit Cost',get:i=>i.unitCost||0},{key:'value',label:'Stock Value',get:i=>(i.qty||0)*(i.unitCost||0)},{key:'supplier',label:'Supplier'}]));
    if(ce) document.getElementById('inv-add-btn')?.addEventListener('click',()=>itemModal(null,()=>renderStock(el)));
    renderTable();
  }

  // Per-item movement history — equality query (no composite index), sorted client-side.
  async function itemHistoryModal(item){
    if(!item) return;
    openModal('📜 '+(item.name||'Item')+' — Movement History', '<div class="loading-placeholder">Loading…</div>',
      `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    const snap = await db.collection('stock_movements').where('itemId','==',item.id).get().catch(()=>({docs:[]}));
    const mv = snap.docs.map(d=>d.data()).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const body = document.getElementById('modal-body');
    const html = !mv.length ? '<div class="empty-state" style="padding:18px"><div class="empty-icon">📋</div><h4>No movements recorded</h4></div>' :
      `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">On-hand now: <strong>${num(item.qty||0)} ${escHtml(item.unit||'')}</strong></div>
       <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Project / Note</th><th>By</th></tr></thead>
       <tbody>${mv.map(m=>`<tr>
         <td style="font-size:12px">${escHtml(m.date||'—')}</td>
         <td><span class="badge ${m.type==='in'?'badge-green':m.type==='adjust'?'badge-blue':'badge-orange'}">${m.type==='in'?'IN':m.type==='adjust'?'ADJ':'OUT'}</span></td>
         <td>${num(m.qty||0)}</td>
         <td style="font-size:12px">${m.refNumber?`<span class="badge badge-gray" style="margin-right:4px">${escHtml(m.refNumber)}</span>`:''}${escHtml(m.project||m.note||'—')}</td>
         <td style="font-size:11px">${escHtml(m.byName||'—')}</td>
       </tr>`).join('')}</tbody></table></div>`;
    if (body) body.innerHTML = html;
  }

  function itemModal(item, onSaved){
    const e=item||{};
    openPage(item?'Edit Item':'Add Inventory Item', `
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
        if(item){
          const oldQty = item.qty||0;
          await db.collection('inventory_items').doc(item.id).update(data);
          window.logAudit&&window.logAudit('update','inventory_item',item.id,{name,qty:data.qty});
          // A manual on-hand edit changes stock without a Stock In/Out — log an
          // 'adjust' movement so the history reflects every quantity change.
          if (Math.abs((data.qty||0) - oldQty) > 1e-9) {
            await window.postStockMovement({ itemId:item.id, itemName:name, type:'adjust',
              qty:Math.abs((data.qty||0)-oldQty), note:`Manual edit ${num(oldQty)} → ${num(data.qty||0)}`,
              source:'manual', unitCost:data.unitCost||null, qtyAfter:data.qty||0 }).catch(()=>{});
          }
        }
        else { data.createdAt=firebase.firestore.FieldValue.serverTimestamp(); const _r=await db.collection('inventory_items').add(data); window.logAudit&&window.logAudit('create','inventory_item',_r.id,{name,qty:data.qty}); }
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('inventory_items');
        closeModal(); Notifs.showToast('Item saved'); onSaved&&onSaved();
      }catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
    });
    document.getElementById('iv-del')?.addEventListener('click', async ()=>{
      if(!(await confirmDialog({ message: 'Delete this item?', danger: true }))) return;
      try{ await db.collection('inventory_items').doc(item.id).delete(); window.logAudit&&window.logAudit('delete','inventory_item',item.id,{name:item.name||''}); if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('inventory_items'); closeModal(); Notifs.showToast('Item deleted'); onSaved&&onSaved(); }
      catch(ex){ Notifs.showToast('Delete failed','error'); }
    });
  }

  function moveModal(item, type, onSaved){
    if(!item) return;
    openPage((type==='in'?'➕ Stock In — ':'➖ Stock Out — ')+(item.name||''), `
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
        await window.postStockMovement({ itemId:item.id, itemName:item.name||'', type, qty,
          project: type==='out'?(document.getElementById('mv-project')?.value.trim()||''):'',
          note:document.getElementById('mv-note').value.trim(),
          source:'manual', unitCost:item.unitCost||null, qtyAfter:(item.qty||0)+delta });
        window.logAudit&&window.logAudit('create','stock_movement',item.id,{itemName:item.name||'',type,qty,delta});
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('inventory_items');
        closeModal(); Notifs.showToast('Stock updated'); onSaved&&onSaved();
      }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
    });
  }

  async function renderMovements(el){
    el.innerHTML='<div class="loading-placeholder">Loading movements…</div>';
    const snap=await db.collection('stock_movements').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
    const mv=snap.docs.map(d=>d.data());
    const typeBadge = t => t==='in'?'<span class="badge badge-green">IN</span>':t==='adjust'?'<span class="badge badge-blue">ADJ</span>':'<span class="badge badge-orange">OUT</span>';
    let typeFilter='all', search='';
    el.innerHTML=`<div class="card"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center"><h3>📋 Stock Movement Log</h3>${mv.length?'<button class="btn-secondary btn-sm" id="mv-csv">⬇ CSV</button>':''}</div>
      <div class="card-body">
      ${!mv.length?'<div class="empty-state" style="padding:24px"><div class="empty-icon">📋</div><h4>No movements yet</h4></div>':`
      ${window.chipTabs([{key:'all',label:'All'},{key:'in',label:'In'},{key:'out',label:'Out'},{key:'adjust',label:'Adjust'}],'all',{cls:'mv-type'})}
      <input id="mv-search" placeholder="🔎 Search item, project, note…" style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px;margin-bottom:10px"/>
      <div id="mv-table"></div>`}
      </div></div>`;
    const filtered = () => mv.filter(m=>{
      if (typeFilter!=='all' && (m.type||'out')!==typeFilter) return false;
      if (search){ const s=search.toLowerCase(); if(!((m.itemName||'').toLowerCase().includes(s)||(m.project||'').toLowerCase().includes(s)||(m.note||'').toLowerCase().includes(s)||(m.refNumber||'').toLowerCase().includes(s))) return false; }
      return true;
    });
    const renderRows = () => {
      const rows = filtered(); const tbl=document.getElementById('mv-table'); if(!tbl) return;
      tbl.innerHTML = !rows.length ? '<div class="empty-state" style="padding:18px"><div class="empty-icon">🔎</div><h4>No movements match</h4></div>' :
        `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Source</th><th>Qty</th><th>Project</th><th>Note</th><th>By</th></tr></thead>
          <tbody>${rows.map(m=>`<tr>
            <td style="font-size:12px">${escHtml(m.date||'—')}</td>
            <td style="font-weight:600">${escHtml(m.itemName||'—')}</td>
            <td>${typeBadge(m.type)}</td>
            <td style="font-size:11px;color:var(--text-muted)">${escHtml(m.source||'manual')}${m.refNumber?`<div>${escHtml(m.refNumber)}</div>`:''}</td>
            <td>${num(m.qty||0)}</td>
            <td style="font-size:12px">${escHtml(m.project||'—')}</td>
            <td style="font-size:12px">${escHtml(m.note||'—')}</td>
            <td style="font-size:11px">${escHtml(m.byName||'—')}</td>
          </tr>`).join('')}</tbody></table></div>`;
    };
    if (mv.length){
      window.bindChipTabs(el.querySelector('.mv-type'), (key)=>{ typeFilter=key; renderRows(); });
      let _t; document.getElementById('mv-search')?.addEventListener('input', e=>{ clearTimeout(_t); const v=e.target.value; _t=setTimeout(()=>{ search=v.trim(); renderRows(); },180); });
      renderRows();
    }
    document.getElementById('mv-csv')?.addEventListener('click',()=>window.exportCSV('stock-movements', filtered(), [
      {key:'date',label:'Date'},{key:'itemName',label:'Item'},{key:'type',label:'Type',get:m=>m.type==='in'?'IN':m.type==='adjust'?'ADJ':'OUT'},
      {key:'source',label:'Source',get:m=>m.source||'manual'},{key:'refNumber',label:'Ref',get:m=>m.refNumber||''},
      {key:'unitCost',label:'Unit Cost',get:m=>m.unitCost==null?'':m.unitCost},
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
    openPage(job?'Edit Job Cost':'New Job Cost', `
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
      if(!(await confirmDialog({ message: 'Delete this job cost?', danger: true }))) return;
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
    { id:'vacation',  label:'Vacation Leave',  icon:'🌴', drawsBalance:true,  paid:true  },
    { id:'sick',      label:'Sick Leave',      icon:'🤒', drawsBalance:true,  paid:true  },
    { id:'emergency', label:'Emergency Leave', icon:'🚨', drawsBalance:false, paid:true  },
    { id:'unpaid',    label:'Unpaid Leave',    icon:'📅', drawsBalance:false, paid:false },
  ];
  const leaveType = id => LEAVE_TYPES.find(t=>t.id===id) || LEAVE_TYPES[0];
  const lvBadge = s => s==='approved'?'badge-green':s==='rejected'?'badge-red':'badge-orange';
  const esc = s => (window.escHtml ? window.escHtml(s) : (s==null?'':String(s)));

  // Inclusive working-day count, excluding Sundays (Manila "Sunday = no work").
  // Superseded by leaveWorkingDays below (which also excludes PH holidays, matching
  // payroll's countWorkDays); left in place, no other caller references it.
  function workingDays(start, end){
    if(!start||!end) return 0;
    const s=new Date(start+'T00:00:00'), e=new Date(end+'T00:00:00');
    if(isNaN(s)||isNaN(e)||e<s) return 0;
    let n=0; const d=new Date(s);
    while(d<=e){ if(d.getDay()!==0) n++; d.setDate(d.getDate()+1); if(n>366) break; }
    return n;
  }
  // Inclusive working-day count, excluding Sundays AND PH holidays — matches
  // payroll's countWorkDays so a leave range never charges a day payroll ignores.
  function leaveWorkingDays(start, end){
    if(!start||!end) return 0;
    const s=new Date(start+'T12:00:00'), e=new Date(end+'T12:00:00');
    if(isNaN(s)||isNaN(e)||e<s) return 0;
    const hol = (typeof getPHHolidays==='function') ? getPHHolidays(s.getFullYear()) : {};
    const holNext = (s.getFullYear()!==e.getFullYear() && typeof getPHHolidays==='function') ? getPHHolidays(e.getFullYear()) : {};
    let n=0; const d=new Date(s);
    while(d<=e){
      const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if(window.bizDow(new Date(ds+'T12:00:00'))!==0 && !hol[ds] && !holNext[ds]) n++;
      d.setDate(d.getDate()+1); if(n>366) break;
    }
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
    // Grant/accrual utilities are gated client-side to president/manager/finance —
    // NOT secretary (secretary keeps balance WRITE access for the approve-decrement
    // path per rules, but the direct grant/accrual buttons stay finance/admin-only).
    const canGrant = ['president','manager','finance'].includes(currentRole);
    c.innerHTML = `
      <div class="page-header"><h2>🌴 Leave Management</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${canGrant?`<button class="btn-secondary btn-sm" id="lv-accrue">↻ Run Annual Accrual</button><button class="btn-secondary btn-sm" id="lv-grant">＋ Adjust Balance</button>`:''}<button class="btn-secondary btn-sm" id="leave-csv">⬇ CSV</button><button class="btn-secondary btn-sm" id="my-leave-btn">My Leave</button></div></div>
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
    if(canGrant){
      document.getElementById('lv-accrue')?.addEventListener('click', async ()=>{
        const yr = window.LeaveAccrual.policyYear();
        if(!confirm(`Grant / reset ${yr} leave balances for all employees?\nAlready-accrued employees are skipped (idempotent). Vacation ${window.LEAVE_POLICY.grants.vacation} / Sick ${window.LEAVE_POLICY.grants.sick} days.`)) return;
        Notifs.showToast('Running annual accrual…');
        try{ const res=await window.LeaveAccrual.runAnnualAccrual();
          window.logAudit && window.logAudit('accrue','leave',yr,res);
          Notifs.showToast(`Accrual ${yr}: ${res.seeded} granted, ${res.skipped} skipped.`);
          renderLeaveAdmin(c);
        }catch(ex){ Notifs.showToast('Accrual failed: '+(ex.message||ex.code),'error'); }
      });
      document.getElementById('lv-grant')?.addEventListener('click', ()=> openGrantModal(c));
    }
  }

  // Small admin utility: grant/adjust one employee's leave balance directly.
  // Numbers are clamped non-negative client-side (matches the rules shape guard).
  async function openGrantModal(c){
    const snap = typeof dbCachedGet === 'function'
      ? await dbCachedGet('users', () => db.collection('users').get(), 60000)
      : await db.collection('users').get();
    const users = snap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(u => u.role !== 'partner')
      .sort((a,b) => (a.displayName||a.email||'').localeCompare(b.displayName||b.email||''));
    openModal('＋ Adjust Balance', `
      <div class="form-group"><label>Employee</label>
        <select id="lv-grant-uid" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          ${users.map(u=>`<option value="${u.id}">${esc(u.displayName||u.email||u.id)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Vacation days</label><input id="lv-grant-vac" type="number" min="0" step="0.5" value="0"/></div>
        <div class="form-group"><label>Sick days</label><input id="lv-grant-sick" type="number" min="0" step="0.5" value="0"/></div>
      </div>
      <div id="lv-grant-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="lv-grant-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('lv-grant-save').addEventListener('click', async ()=>{
      const uid = document.getElementById('lv-grant-uid').value;
      const vacation = Math.max(0, Number(document.getElementById('lv-grant-vac').value)||0);
      const sick = Math.max(0, Number(document.getElementById('lv-grant-sick').value)||0);
      const err = document.getElementById('lv-grant-err');
      if(!uid){ err.textContent='Pick an employee.'; err.classList.remove('hidden'); return; }
      try{
        await db.collection('leave_balances').doc(uid).set(
          { vacation, sick, year:window.LeaveAccrual.policyYear(), updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
        window.logAudit && window.logAudit('grant','leave',uid,{ vacation, sick });
        closeModal(); Notifs.showToast('Balance updated!'); renderLeaveAdmin(c);
      }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
    });
  }

  function openLeaveModal(bal, c){
    const today = window.bizDate?window.bizDate():new Date().toISOString().slice(0,10);
    openPage('🌴 Request Leave', `
      <div class="form-group"><label>Leave Type</label>
        <select id="lv-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          ${LEAVE_TYPES.map(t=>`<option value="${t.id}">${t.icon} ${t.label}${t.drawsBalance?` (${bal[t.id]||0} left)`:''}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Start Date</label><input id="lv-start" type="date" value="${today}"/></div>
        <div class="form-group"><label>End Date</label><input id="lv-end" type="date" value="${today}"/></div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px" id="lv-days-hint">1 working day (excl. Sundays &amp; holidays)</div>
      <div class="form-group"><label>Reason</label><textarea id="lv-reason" rows="2" placeholder="Brief reason"></textarea></div>
      <div id="lv-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="lv-save">Submit Request</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    const upd = ()=>{ const d=leaveWorkingDays(document.getElementById('lv-start').value, document.getElementById('lv-end').value); document.getElementById('lv-days-hint').textContent=`${d} working day${d!==1?'s':''} (excl. Sundays & holidays)`; };
    document.getElementById('lv-start').addEventListener('change',upd);
    document.getElementById('lv-end').addEventListener('change',upd);
    document.getElementById('lv-save').addEventListener('click', async ()=>{
      const type=document.getElementById('lv-type').value;
      const startDate=document.getElementById('lv-start').value, endDate=document.getElementById('lv-end').value;
      const reason=document.getElementById('lv-reason').value.trim();
      const err=document.getElementById('lv-err');
      const days=leaveWorkingDays(startDate,endDate);
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

  // Writes a paid/unpaid attendance record for every WORK day in the leave range,
  // skipping Sundays & PH holidays, non-destructively (merge). Runs as the approver
  // (finance/admin/secretary) → passes the attendance finance/admin write path.
  async function writeLeaveAttendance(r, lt){
    if(!r.startDate || !r.endDate) return;
    const FV = firebase.firestore.FieldValue;
    const paid = lt.paid !== false;
    const s=new Date(r.startDate+'T12:00:00'), e=new Date(r.endDate+'T12:00:00');
    if(isNaN(s)||isNaN(e)||e<s) return;
    const d=new Date(s); let guard=0;
    while(d<=e && guard++<366){
      const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const hol=(typeof getPHHolidays==='function')?getPHHolidays(d.getFullYear()):{};
      if(window.bizDow(new Date(ds+'T12:00:00'))!==0 && !hol[ds]){
        await db.collection('attendance').doc(r.userId).collection('records').doc(ds).set(
          paid
            ? { date:ds, uid:r.userId, attendanceScore:1.0, fullTime:true,  status:'leave',        leaveType:r.type, leaveReqId:r.id, editedBy:currentUser.uid, editedAt:FV.serverTimestamp() }
            : { date:ds, uid:r.userId, attendanceScore:0,   fullTime:false, status:'unpaid_leave', leaveType:r.type, leaveReqId:r.id, editedBy:currentUser.uid, editedAt:FV.serverTimestamp() },
          {merge:true});
      }
      d.setDate(d.getDate()+1);
    }
  }
  // Shared balance-decrement + attendance-write. BOTH approval paths call this.
  async function applyLeaveApproval(r){
    const lt = leaveType(r.type);
    if(lt.drawsBalance){
      const bal = await getBalance(r.userId);
      const newBal = Math.max(0,(bal[r.type]||0)-(r.days||0));
      await db.collection('leave_balances').doc(r.userId).set(
        { [r.type]:newBal, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
    }
    await writeLeaveAttendance(r, lt);
  }

  async function approveLeave(r, c){
    if(!r) return;
    try{
      await db.collection('leave_requests').doc(r.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
      const lt=leaveType(r.type);
      await applyLeaveApproval(r);   // decrement + write attendance (single source)
      window.logAudit && window.logAudit('approve','leave',r.id,{ user:r.userName, type:r.type, days:r.days });
      try{ Notifs.send(r.userId, { title:'Leave Approved ✅', body:`Your ${r.days}-day ${lt.label} (${r.startDate}→${r.endDate}) was approved.`, icon:'✅', type:'leave', dedupKey:`leave-ok-${r.id}` }); }catch(_){}
      Notifs.showToast('Leave approved'); window.renderLeavePage(c);
    }catch(ex){ Notifs.showToast('Approve failed: '+(ex.message||ex.code),'error'); }
  }

  async function rejectLeave(r, c){
    if(!r) return;
    const reason = (await promptDialog({ message: 'Reason for rejection (optional):', multiline: true }))||'';
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
    await applyLeaveApproval(r);    // decrement + write attendance (single source)
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
  // v12 WS38 — Files Hub result lookup (inline onclick can't hold a whole file
  // object, so stash the last-rendered matches by id, same convention other
  // groups use of passing an id string into a global opener function).
  let _gsFilesStash = {};
  window.__gsOpenFile = function(id){ const f = _gsFilesStash[id]; if (f && window.openFilePreview) window.openFilePreview(f); };

  window.renderGlobalSearch = async function(initialQuery){
    const c = document.getElementById('page-content');
    if(!c) return;
    const blocked = (typeof isPartner==='function' && isPartner()) || (typeof isBrilliantOnly==='function' && isBrilliantOnly());
    if(blocked){ c.innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><h4>Search is not available for this account</h4></div>'; return; }

    c.innerHTML = `
      <div class="page-header"><h2>🔎 Search</h2></div>
      <input id="gsearch-input" placeholder="Search tasks, clients, inventory, products, quotes, files…" value="${(initialQuery||'').replace(/"/g,'&quot;')}"
        style="width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-size:15px;margin-bottom:14px"/>
      <div id="gsearch-results"><div class="empty-state" style="padding:30px"><div class="empty-icon">🔎</div><p>Type to search across the company.</p></div></div>`;
    const input = document.getElementById('gsearch-input');
    const out = document.getElementById('gsearch-results');

    let sources = null;
    async function load(){
      if(sources) return sources;
      const toArr = s => s.docs.map(d=>({id:d.id,...d.data()}));
      const safe = p => p.then(toArr).catch(()=>[]);
      const [tasks, quotes, cl, inv, prod, files] = await Promise.all([
        (typeof dbCachedGet==='function'?dbCachedGet('tasks-all',()=>db.collection('tasks').get(),30000):db.collection('tasks').get()).then(toArr).catch(()=>[]),
        (typeof getAllQuotes==='function'?getAllQuotes():db.collection('bk_quotes').get()).then(toArr).catch(()=>[]),
        window.Clients.listAll().catch(()=>[]),
        dbCachedGet('inventory_items',  () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000).then(toArr).catch(()=>[]),
        safe(db.collection('products').limit(1000).get()),
        // hub_files ONLY (v12 WS38 decision 8) — legacy files_<scope> collections are
        // frozen/unenumerable and NOT searched. Company-visible + mine + shared-with-me,
        // via FilesHub's rules-provable 3-query fan-out, capped at 1000 like Products.
        (typeof FilesHub!=='undefined' ? FilesHub.loadFiles(null).then(a=>a.slice(0,1000)) : Promise.resolve([])).catch(()=>[]),
      ]);
      sources = { tasks, quotes,
        clients: cl.map(x=>({...x, _brand:(x.brands&&x.brands[0])==='design'?'design':(x.brands&&x.brands.includes('bs'))?'bs':'sales'})),
        inv, prod, files };
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
      const files   = S.files.filter(f=>hit(q,f.name,f.description,f.scope));
      const total = tasks.length+clients.length+inv.length+prod.length+quotes.length+files.length;
      if(!total){ out.innerHTML = `<div class="empty-state" style="padding:30px"><div class="empty-icon">🤷</div><h4>No results for "${esc(qRaw)}"</h4></div>`; return; }
      _gsFilesStash = {}; files.forEach(f=>{ _gsFilesStash[f.id]=f; });
      out.innerHTML =
        groupHtml('✅','Tasks',tasks,t=>rowItem('📋',t.title||'(untitled)',(t.department||'')+(t.status?' · '+t.status:''),`window.openTaskDetail&&window.openTaskDetail('${t.id}',window.currentUser,window.currentRole)`)) +
        groupHtml('👤','Clients',clients,x=>rowItem('👤',x.name||x.company||'Client',(x.company||'')+(x.phone?' · '+x.phone:''),`navigateTo('${x._brand==='design'?'dept:Design':x._brand==='bs'?'bs-clients':'dept:Sales'}')`)) +
        groupHtml('📦','Inventory',inv,i=>rowItem('📦',i.name||'(item)',(i.category||'')+' · '+(i.qty||0)+' '+(i.unit||''),`navigateTo('inventory')`)) +
        groupHtml('🛒','Products',prod,p=>rowItem('🛒',p.title||p.name||p.id,(p.id||'')+(p.category?' · '+p.category:''),`navigateTo('product-database')`)) +
        groupHtml('📄','Quotes',quotes,qt=>rowItem('📄',(qt.quoteNumber||'Quote')+(qt.clientName?' — '+qt.clientName:''),(qt.status||'draft'),`navigateTo('${(qt.quoteNumber||'').toString().toUpperCase().startsWith('BS')?'bs-quotations':'dept:Sales'}')`)) +
        groupHtml('📁','Files',files,f=>rowItem(f.kind==='link'?'🔗':'📄',f.name||'File',(f.scope||'')+(f.department?' · '+f.department:''),`window.__gsOpenFile('${f.id}')`));
    }

    let _t; input.addEventListener('input',()=>{ clearTimeout(_t); _t=setTimeout(()=>runSearch(input.value),220); });
    input.focus();
    if(initialQuery) runSearch(initialQuery);
  };
})();

// ═══════════════════════════════════════════════════
//  FILES HUB (v12 WS38) — top-level "Files" page, all scopes
//  Reuses window.renderFileCollection / window.bindFileCollection (js/departments.js,
//  rewritten in WS38 to read/write hub_files) per selected scope, so this page adds
//  zero new file-listing logic of its own — it's a scope switcher + admin all-scopes view.
// ═══════════════════════════════════════════════════
window.renderFilesHub = function(){
  const c = document.getElementById('page-content');
  if(!c) return;
  const blocked = (typeof isPartner==='function' && isPartner()) || (typeof isBrilliantOnly==='function' && isBrilliantOnly());
  if(blocked){ c.innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><h4>Files Hub is not available for this account</h4></div>'; return; }
  const isAdminRole = ['president','manager','owner','secretary'].includes(window.currentRole);

  // Seed list of the 12 known pre-WS38 scopes (Spec 9) — Brilliant Steel's
  // per-subtab scopes are dynamic (data-driven by its own subtab list) and stay
  // reachable through the Brilliant Steel department's own Files tab, unchanged.
  const SEED_SCOPES = [
    { key:'personal',        label:'Personal',          dept:'General'    },
    { key:'shared',          label:'Department',        dept:'General'    },
    { key:'all',             label:'All Company',       dept:'General'    },
    { key:'advertising',     label:'Advertising',       dept:'Marketing'  },
    { key:'designs',         label:'Marketing Designs', dept:'Marketing'  },
    { key:'sss',             label:'SSS & Gov Docs',    dept:'Finance'    },
    { key:'accounting',      label:'Accounting',        dept:'Finance'    },
    { key:'proposals',       label:'Sales Proposals',   dept:'Sales'      },
    { key:'product_designs', label:'Product Designs',   dept:'Design'     },
    { key:'references',      label:'References',        dept:'Design'     },
    { key:'files',           label:'Production',        dept:'Production' }
  ];
  const scopeByKey = {}; SEED_SCOPES.forEach(s=>{ scopeByKey[s.key]=s; });
  const chips = [
    ...(isAdminRole ? [{ key:'__all__', label:'🌐 All Scopes' }] : []),
    ...SEED_SCOPES.map(s=>({ key:s.key, label:s.label }))
  ];
  const defaultKey = isAdminRole ? '__all__' : SEED_SCOPES[0].key;

  c.innerHTML = `
    <div class="page-header"><h2>📁 Files Hub</h2></div>
    <input id="fh-hub-search" placeholder="Search my files…" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px;margin-bottom:12px"/>
    ${window.chipTabs(chips, defaultKey, {cls:'fh-hub-scope-tabs'})}
    <div id="fh-hub-content"></div>
  `;

  let allScopeFiles = [];
  let _gsFilesStashHub = {};
  const hit = (q, ...fields) => fields.some(f => (f||'').toString().toLowerCase().includes(q));
  const loadScope = (key) => {
    const fc = document.getElementById('fh-hub-content');
    if (key === '__all__') {
      fc.innerHTML = '<div class="loading-placeholder">Loading all files…</div>';
      FilesHub.loadFiles(null).then(files => {
        allScopeFiles = files;
        renderAllScope();
      });
      return;
    }
    const seed = scopeByKey[key] || { label:key, dept:'General' };
    fc.innerHTML = window.renderFileCollection(seed.label, `fh-hub-${key}`, window.currentRole);
    window.bindFileCollection(`fh-hub-${key}`, window.currentUser, seed.dept, seed.key);
  };

  const renderAllScope = () => {
    const fc = document.getElementById('fh-hub-content');
    const q = (document.getElementById('fh-hub-search')?.value||'').trim().toLowerCase();
    const showing = q ? allScopeFiles.filter(f=>hit(q,f.name,f.description,f.scope,f.department)) : allScopeFiles;
    if (!showing.length) { fc.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-icon">📁</div><h4>No files found</h4></div>'; return; }
    _gsFilesStashHub = {}; showing.forEach(f=>{ _gsFilesStashHub[f.id]=f; });
    fc.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Name</th><th>Scope</th><th>Dept</th><th>Uploader</th><th>Date</th><th></th></tr></thead>
      <tbody>${showing.map(f=>`<tr>
        <td><a href="#" class="fh-hub-open" data-id="${f.id}" style="color:var(--primary);font-weight:600">${f.kind==='link'?'🔗 ':'📄 '}${escHtml(f.name||'File')}</a></td>
        <td><span class="badge badge-gray">${escHtml(f.scope||'—')}</span></td>
        <td style="font-size:12px">${escHtml(f.department||'—')}</td>
        <td style="font-size:12px">${escHtml(f.uploaderName||'—')}</td>
        <td style="font-size:11px;color:var(--text-muted)">${f.createdAt?new Date(f.createdAt.toDate()).toLocaleDateString('en-PH'):''}</td>
        <td><a href="${safeHttpUrl(f.url)}" target="_blank" class="btn-secondary btn-sm">⬇</a></td>
      </tr>`).join('')}</tbody></table></div>`;
    fc.querySelectorAll('.fh-hub-open').forEach(el=>el.addEventListener('click', e=>{
      e.preventDefault(); const f = _gsFilesStashHub[el.dataset.id]; if (f) window.openFilePreview(f);
    }));
  };

  loadScope(defaultKey);
  window.bindChipTabs(c.querySelector('.fh-hub-scope-tabs'), key => loadScope(key));
  document.getElementById('fh-hub-search').addEventListener('input', () => {
    const active = c.querySelector('.fh-hub-scope-tabs .chip-tab.active');
    if (active && active.dataset.chip === '__all__') renderAllScope();
  });
};
