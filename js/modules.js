/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Extended Modules v1
   modules.js — Posts, Team, Finance Expansion,
                Cash Advance, Attendance, Company
═══════════════════════════════════════════════════ */
'use strict';

// ── PRESIDENT UID (Neil Barro) ────────────────────
// This controls whose photo/name shows in the president
// message card in Company Overview.
const PRESIDENT_UID = 'neilbarro870@gmail.com'; // fallback: match by email

function isRealPresident() {
  return currentRole === 'president' &&
    (userProfile?.email === 'neilbarro870@gmail.com' ||
     userProfile?.uid   === PRESIDENT_UID);
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
    container.innerHTML = posts.map(p => {
      const ts = p.createdAt?.toDate ? p.createdAt.toDate().toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
      const isOwn = p.authorId === currentUser.uid;
      const hearts = p.hearts || [];
      const hearted = hearts.includes(currentUser.uid);
      return `
      <div class="post-card" data-id="${p.id}">
        <div class="post-header">
          <div class="post-avatar">${p.authorPhoto ? `<img src="${p.authorPhoto}"/>` : (p.authorName||'?')[0]}</div>
          <div class="post-meta">
            <div class="post-author">${p.authorName||'Unknown'}</div>
            <div class="post-time">${ts}${p.dept&&p.dept!=='General'?` · ${p.dept}`:''}</div>
          </div>
          ${p.pinned ? '<span class="badge badge-blue">📌 Pinned</span>' : ''}
          ${p.status==='pending' ? '<span class="badge badge-orange">Pending</span>' : ''}
        </div>
        ${p.title ? `<div class="post-title">${p.title}</div>` : ''}
        <div class="post-body">${p.content||''}</div>
        ${p.imageUrl ? `<img src="${p.imageUrl}" class="post-image" onclick="window.open('${p.imageUrl}','_blank')"/>` : ''}
        ${p.fileUrl ? `<a href="${p.fileUrl}" target="_blank" class="post-attachment">📎 ${p.fileName||'Attachment'}</a>` : ''}
        <div class="post-actions">
          ${p.status==='published' ? `
            <button class="post-heart-btn${hearted?' hearted':''}" data-id="${p.id}" title="${hearted?'Unlike':'Like'}">
              <svg viewBox="0 0 24 24" fill="${hearted?'#FF6B2B':'none'}" stroke="${hearted?'#FF6B2B':'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>
            ${hearts.length ? `<button class="post-likers-btn btn-link" data-id="${p.id}" data-hearts='${JSON.stringify(hearts)}' style="font-size:12px;color:var(--text-muted);padding:0 4px;background:none;border:none;cursor:pointer">${hearts.length} ❤️</button>` : ''}
          ` : ''}
          ${canApprove && p.status==='pending' ? `
            <button class="btn-primary btn-sm post-approve-btn" data-id="${p.id}">✓ Approve</button>
            <button class="btn-secondary btn-sm post-reject-btn" data-id="${p.id}">✗ Reject</button>
          ` : ''}
          <div style="display:flex;gap:6px;margin-left:auto">
            ${isOwn ? `<button class="btn-secondary btn-sm post-edit-btn" data-id="${p.id}" data-title="${(p.title||'').replace(/"/g,'&quot;')}" data-content="${(p.content||'').replace(/"/g,'&quot;')}">✎ Edit</button>` : ''}
            ${(canApprove || isOwn) ? `<button class="btn-secondary btn-sm post-delete-btn" data-id="${p.id}" style="color:var(--danger)">Delete</button>` : ''}
            ${canApprove && p.status==='published' ? `<button class="btn-secondary btn-sm post-pin-btn" data-id="${p.id}">${p.pinned?'Unpin':'📌 Pin'}</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons({nodes:[container]});

    container.querySelectorAll('.post-approve-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;
      const postSnap = await db.collection('posts').doc(id).get();
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
      const snap = await db.collection('posts').doc(id).get();
      const hearts = snap.data().hearts || [];
      const uid = currentUser.uid;
      const newHearts = hearts.includes(uid)
        ? firebase.firestore.FieldValue.arrayRemove(uid)
        : firebase.firestore.FieldValue.arrayUnion(uid);
      await db.collection('posts').doc(id).update({hearts: newHearts});
      loadPosts(dept);
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
          ${names.map(n=>`<div style="display:flex;align-items:center;gap:8px;font-size:14px"><span style="font-size:20px">❤️</span>${n}</div>`).join('')}
        </div>`;
    }));

    // Edit post
    container.querySelectorAll('.post-edit-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id      = btn.dataset.id;
      const oldTitle   = btn.dataset.title || '';
      const oldContent = btn.dataset.content || '';
      openModal('✎ Edit Post', `
        <div class="form-group"><label>Title (optional)</label><input id="edit-post-title" value="${oldTitle.replace(/&quot;/g,'"')}" placeholder="Post title…"/></div>
        <div class="form-group"><label>Content</label><textarea id="edit-post-content" rows="5" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical">${oldContent.replace(/&quot;/g,'"')}</textarea></div>
      `, `<button class="btn-primary" id="save-post-edit-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
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
      imageUrl:    uploadedFile?.url || null,
      fileName:    uploadedFile?.name || null,
      fileUrl:     uploadedFile?.url || null,
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
  c.innerHTML = `
    <div class="page-header">
      <h2>👥 Team</h2>
      ${pres && !viewingAsPartner ? '<button class="btn-primary btn-sm" id="invite-user-btn">+ Invite Member</button>' : ''}
    </div>
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
        <input id="note-input" maxlength="60" placeholder="e.g. In a meeting until 3pm…" value="${current}"/>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;text-align:right"><span id="note-count">${current.length}</span>/60</div>
      </div>
    `, `<button class="btn-primary" id="save-note-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Clear Note</button>`);
    document.getElementById('note-input').addEventListener('input', e => {
      document.getElementById('note-count').textContent = e.target.value.length;
    });
    document.getElementById('save-note-btn').addEventListener('click', async () => {
      const note = document.getElementById('note-input').value.trim();
      await db.collection('users').doc(currentUser.uid).update({ statusNote: note });
      closeModal(); Notifs.showToast('Note updated!');
      window.renderTeamTab();
    });
    // "Clear Note" = close and clear
    document.querySelector('#modal-footer .btn-secondary').onclick = async () => {
      await db.collection('users').doc(currentUser.uid).update({ statusNote: '' });
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
          const cred = await auth.createUserWithEmailAndPassword(email, Math.random().toString(36).slice(-10));
          const uid = cred.user.uid;
          const empCount = (await db.collection('users').get()).size;
          const empId = `BI-${new Date().getFullYear()}-${String(empCount).padStart(3,'0')}`;
          await db.collection('users').doc(uid).set({
            uid, email,
            displayName: document.getElementById('inv-name').value.trim() || email.split('@')[0],
            phone: document.getElementById('inv-phone').value.trim(),
            role:        document.getElementById('inv-role').value,
            departments: depts, department: depts[0]||'',
            employeeId:  empId, salary:0, allowance:0, deductions:0,
            photoUrl:'', startDate: new Date().toISOString().slice(0,10),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          await auth.sendPasswordResetEmail(email);
          closeModal();
          Notifs.showToast(`Invite sent to ${email}!`);
          window.renderTeamTab();
        } catch(err) { Notifs.showToast('Error: '+err.message,'error'); }
      });
    });
  }
};

function showCallingCard(u) {
  const roleLabel = window.ROLES?.[u.role]?.label || u.role || 'Employee';
  const depts = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(' · ') || 'Unassigned';
  const initials = (u.displayName||u.email||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  openModal(`📇 ${u.displayName||u.email}`, `
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px;padding:28px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px">
      ${u.photoUrl
        ? `<img src="${u.photoUrl}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.3);margin-bottom:4px" alt=""/>`
        : `<div style="width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:#fff;margin-bottom:4px">${initials}</div>`}
      <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:.5px">${u.displayName||u.email}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.7);font-weight:600;text-transform:uppercase;letter-spacing:.08em">${roleLabel}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5)">${depts}</div>
      <div style="width:100%;height:1px;background:rgba(255,255,255,0.15);margin:8px 0"></div>
      ${u.email?`<div style="font-size:13px;color:rgba(255,255,255,0.8)">✉️ ${u.email}</div>`:''}
      ${u.phone?`<div style="font-size:13px;color:rgba(255,255,255,0.8)">📞 ${u.phone}</div>`:''}
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
          <span>${statusNote}</span>
        </div>` : ''}
      <div class="team-member-avatar-wrap">
        <div class="team-member-avatar">
          ${u.photoUrl
            ? `<img src="${u.photoUrl}" alt="${u.displayName||''}"/>`
            : `<span>${initial}</span>`}
        </div>
        <span class="team-online-dot ${isOnline?'team-online-dot--on':'team-online-dot--off'}" title="${isOnline?'Online':'Last active: '+lastActiveStr}"></span>
      </div>
      <div class="team-member-name">${u.displayName||u.email}</div>
      <div class="team-member-role" style="color:${badgeColor}">${roleLabel}${isMe?' · You':''}</div>
      <div class="team-member-dept">${depts}</div>
      ${isOnline
        ? `<div class="team-status-pill team-status-pill--on">● Online</div>`
        : lastSeenMs ? `<div class="team-status-pill">${lastActiveStr}</div>` : ''}
      <div class="team-card-actions">
        <button class="team-card-btn view-card-btn" data-uid="${u.id}" title="View calling card">📇</button>
      </div>
    </div>`;
  }).join('')}</div>`;

  // Wire up calling card buttons
  grid.querySelectorAll('.view-card-btn').forEach(btn => {
    const u = users.find(x => x.id === btn.dataset.uid);
    if (u) btn.addEventListener('click', e => { e.stopPropagation(); showCallingCard(u); });
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
    [`${year}-01-01`]: { name:'New Year\'s Day', type:'regular' },
    [`${year}-04-09`]: { name:'Araw ng Kagitingan', type:'regular' },
    [`${year}-05-01`]: { name:'Labor Day', type:'regular' },
    [`${year}-06-12`]: { name:'Independence Day', type:'regular' },
    [`${year}-11-30`]: { name:'Bonifacio Day', type:'regular' },
    [`${year}-12-25`]: { name:'Christmas Day', type:'regular' },
    [`${year}-12-30`]: { name:'Rizal Day', type:'regular' },
    [`${year}-02-25`]: { name:'EDSA People Power', type:'special' },
    [`${year}-08-21`]: { name:'Ninoy Aquino Day', type:'special' },
    [`${year}-11-01`]: { name:'All Saints\' Day', type:'special' },
    [`${year}-12-08`]: { name:'Immaculate Conception', type:'special' },
    [`${year}-12-31`]: { name:'New Year\'s Eve', type:'special' },
  };
  // National Heroes Day (last Monday of August)
  const aug = new Date(year, 7, 31);
  while (aug.getDay() !== 1) aug.setDate(aug.getDate()-1);
  holidays[aug.toISOString().slice(0,10)] = { name:'National Heroes Day', type:'regular' };
  // Holy Week (approx — these are fixed known dates)
  const holyWeek = {
    2024: { thu:'2024-03-28', fri:'2024-03-29' },
    2025: { thu:'2025-04-17', fri:'2025-04-18' },
    2026: { thu:'2026-04-02', fri:'2026-04-03' },
    2027: { thu:'2027-03-25', fri:'2027-03-26' },
  };
  if (holyWeek[year]) {
    holidays[holyWeek[year].thu] = { name:'Maundy Thursday', type:'special' };
    holidays[holyWeek[year].fri] = { name:'Good Friday', type:'regular' };
  }
  return holidays;
}

// ══════════════════════════════════════════════════
//  ATTENDANCE CALENDAR (full-page)
// ══════════════════════════════════════════════════

window.renderAttendancePage = async function() {
  const c = document.getElementById('page-content');
  const pres = currentRole === 'president' || currentRole === 'manager' || currentRole === 'finance';
  const now  = new Date();

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
  let viewYear  = now.getFullYear();
  let viewMonth = now.getMonth();

  if (pres) {
    const usersSnap = typeof dbCachedGet === 'function'
      ? await dbCachedGet('users', () => db.collection('users').get(), 60000)
      : await db.collection('users').get();
    const empList = usersSnap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(u => u.role !== 'partner');
    const sel = document.getElementById('att-emp-select');
    sel.innerHTML = empList.map(u=>`<option value="${u.id}">${u.displayName||u.email}</option>`).join('');
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
    const todayStr = new Date().toISOString().slice(0,10);
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
              <td><strong>${r.userName||'—'}</strong></td>
              <td>${r.date||'—'}</td>
              <td>${r.requestedAt ? new Date(r.requestedAt.toDate()).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
              <td style="white-space:nowrap">
                <button class="btn-primary btn-sm ext-approve-btn" data-id="${r.id}" data-uid="${r.uid}" data-name="${r.userName||''}">✓ Approve</button>
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
          body:  `Your Time In extension is approved. You have until ${expiresAt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})} to time in and complete notifications.`,
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
          body:  `Your extension request for ${new Date().toLocaleDateString('en-PH',{month:'short',day:'numeric'})} was not approved.`,
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

    const monthStart = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-01`;
    const monthEnd   = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-31`;
    const snap = await db.collection('attendance').doc(targetUid).collection('records')
      .where(firebase.firestore.FieldPath.documentId(),'>=',monthStart)
      .where(firebase.firestore.FieldPath.documentId(),'<=',monthEnd).get();
    const records = {};
    snap.docs.forEach(d => { records[d.id] = d.data(); });

    const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
    const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
    const todayStr    = new Date().toISOString().slice(0,10);
    const canEdit     = pres;
    const phHolidays  = getPHHolidays(viewYear);

    const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let html = `<div class="att-cal-grid">
      ${dayLabels.map(d=>`<div class="att-cal-hdr">${d}</div>`).join('')}
      ${Array(firstDay).fill('<div></div>').join('')}`;

    let fullCount=0, halfCount=0, absentCount=0, workDays=0;

    for (let day=1; day<=daysInMonth; day++) {
      const dateStr  = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const dow      = new Date(dateStr).getDay();
      const isSunday  = dow===0;
      const holiday   = phHolidays[dateStr];
      const isNoWork  = isSunday || !!holiday;
      const isPast    = dateStr <= todayStr;
      const rec       = records[dateStr];
      let status = '';
      if (!isNoWork && isPast) {
        if (rec?.fullTime || (typeof rec?.attendanceScore==='number' && rec?.attendanceScore>=1))
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
      <div class="card-header"><h3>Summary — ${label} · ${targetName}</h3></div>
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
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Employee: <strong>${targetName}</strong></p>
            <div class="form-group"><label>Status</label>
              <div style="display:flex;gap:8px;margin-top:4px">
                <button class="att-status-opt ${curStatus==='present'?'att-opt-active':''}" data-val="present" style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${curStatus==='present'?'#30d158':'var(--border)'};background:${curStatus==='present'?'rgba(48,209,88,.15)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer">✓ Present</button>
                <button class="att-status-opt ${curStatus==='half'?'att-opt-active':''}" data-val="half" style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${curStatus==='half'?'#ffaa00':'var(--border)'};background:${curStatus==='half'?'rgba(255,170,0,.15)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer">½ Half Day</button>
                <button class="att-status-opt ${curStatus==='absent'?'att-opt-active':''}" data-val="absent" style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${curStatus==='absent'?'#ff453a':'var(--border)'};background:${curStatus==='absent'?'rgba(255,69,58,.12)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer">✗ Absent</button>
              </div>
              <input type="hidden" id="att-status-sel" value="${curStatus}"/>
            </div>
            <div class="form-group" style="margin-top:12px"><label>Note (optional)</label><input id="att-note" value="${cur?.note||''}" placeholder="e.g. sick leave, official business"/></div>
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
            if (status==='present')
              await ref.set({date,uid:targetUid,loginTime:new Date(),fullTime:true,note,editedBy:currentUser.uid,editedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
            else if (status==='half')
              await ref.set({date,uid:targetUid,loginTime:new Date(),fullTime:false,note,editedBy:currentUser.uid,editedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
            else
              await ref.delete();
            closeModal();
            Notifs.showToast('Attendance updated!');
            renderAttMonth();
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
        <div class="ca-detail"><span>Reason</span><span>${a.reason||'&#x2014;'}</span></div>
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
    db.collection('cash_advances').orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
    dbCachedGet('users', () => db.collection('users').get(), 60000)
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
        ${isAdmin?`<div class="ca-card-name">${a.userName||'Employee'} <span style="font-size:11px;color:var(--text-muted)">${a.employeeId||''}</span>${a.private?'<span class="badge badge-red" style="font-size:10px;margin-left:4px">🔒 Private</span>':''}</div>`:''}
        <div class="ca-amount">₱${fmtN(a.amount)}</div>
        <span class="badge ${statusBadgeClass}">${a.status||'pending'}</span>
      </div>
      <div class="ca-card-body">
        <div class="ca-detail"><span>Reason</span><span>${a.reason||'—'}</span></div>
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
    const snap = await db.collection('cash_advances').doc(id).get();
    const a = snap.data();
    await db.collection('cash_advances').doc(id).update({
      status: 'approved',
      approvedBy: currentUser.uid,
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      balance: a.amount
    });
    await Notifs.send(a.userId, {title:'Cash Advance Approved', body:`Your ₱${fmtN(a.amount)} cash advance request was approved!`, icon:'✅', type:'cash_advance'});
    Notifs.showToast('Approved!');
    window.renderCashAdvancePage();
  }));

  container.querySelectorAll('.ca-reject-btn').forEach(btn => btn.addEventListener('click', async e => {
    const id = e.target.dataset.id;
    const snap = await db.collection('cash_advances').doc(id).get();
    await db.collection('cash_advances').doc(id).update({status:'rejected'});
    await Notifs.send(snap.data().userId, {title:'Cash Advance Rejected', body:'Your cash advance request was not approved.', icon:'❌', type:'cash_advance'});
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
      <div class="form-group"><label>Amount Paid</label><input id="pay-amount" type="number" value="${a.monthlyPayment||0}" min="0" max="${a.balance||0}"/></div>
      <div class="form-group"><label>Date</label><input id="pay-date" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
    `, `<button class="btn-primary" id="save-payment-btn">Record</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-payment-btn').addEventListener('click', async () => {
      const paid = parseFloat(document.getElementById('pay-amount').value)||0;
      const newBal = Math.max(0, (a.balance||0) - paid);
      const payments = [...(a.payments||[]), {amount:paid, date:document.getElementById('pay-date').value, recordedBy:currentUser.uid}];
      await db.collection('cash_advances').doc(id).update({
        balance: newBal, payments,
        status: newBal <= 0 ? 'paid' : 'approved'
      });
      // Notify the employee
      const statusMsg = newBal <= 0 ? 'fully paid off 🎉' : `balance remaining: ₱${fmtN(newBal)}`;
      await Notifs.send(a.userId, {
        title: '💳 Cash Advance Payment Recorded',
        body: `₱${fmtN(paid)} payment was recorded on your cash advance. ${statusMsg.charAt(0).toUpperCase()+statusMsg.slice(1)}.`,
        icon: '💳', type: 'cash_advance'
      });
      closeModal(); Notifs.showToast('Payment recorded!');
      await window.renderCashAdvancePage();
      // Stay on Active Loans/CA's tab after payment
      const activeBtn = document.querySelector('#ca-tabs [data-sub="active"]');
      if (activeBtn) activeBtn.click();
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
      <input id="ca-amt" type="number" min="100" max="50000" step="100" placeholder="0.00" oninput="updateCACalc()"/>
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
    <div class="form-group"><label>Date Needed</label><input id="ca-date" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
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
    `<option value="${u.id}">${u.displayName||u.email} (${u.role||'employee'})</option>`
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
      <input id="pca-amount" type="number" min="1" step="0.01" placeholder="e.g. 65225"/>
    </div>
    <div class="form-group"><label>Monthly Payment (₱)</label>
      <input id="pca-monthly" type="number" min="1" step="0.01" placeholder="e.g. 5025"/>
    </div>
    <div class="form-group"><label>Terms (months)</label>
      <input id="pca-terms" type="number" min="1" max="60" value="9"/>
    </div>
    <div class="form-group"><label>Date</label>
      <input id="pca-date" type="date" value="${new Date().toISOString().slice(0,10)}"/>
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
    // Only show if this is the actual Neil Barro account
    if (pres.email !== 'neilbarro870@gmail.com') { card.style.display='none'; return; }
    const msg = await db.collection('president_message').doc('current').get();
    const msgText = msg.exists ? msg.data().message : 'Welcome to Barro Industries. Together, we build something great.';
    const presName = 'Neil Barro'; // Always show as Neil Barro
    card.innerHTML = `
      <div class="card-header">
        <h3>Message from the President</h3>
        ${isRealPresident() ? '<button class="btn-secondary btn-sm" id="edit-msg-btn">Edit</button>' : ''}
      </div>
      <div class="card-body">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
          <div style="width:54px;height:54px;border-radius:50%;overflow:hidden;background:var(--primary-light);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff">
            ${pres.photoUrl?`<img src="${pres.photoUrl}" style="width:100%;height:100%;object-fit:cover"/>`:presName[0]}
          </div>
          <div>
            <div style="font-weight:700;font-size:15px">${presName}</div>
            <div style="font-size:12px;color:var(--text-muted)">President, Barro Industries OPC</div>
          </div>
        </div>
        <blockquote style="font-size:14px;line-height:1.8;color:var(--text);border-left:3px solid var(--primary-light);padding-left:14px;margin:0;font-style:italic">${msgText}</blockquote>
      </div>`;
    document.getElementById('edit-msg-btn')?.addEventListener('click', () => {
      openModal('Edit President Message', `
        <div class="form-group"><label>Message</label>
          <textarea id="pres-msg-input" rows="6" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);color:var(--text);resize:vertical">${msgText}</textarea>
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
//  NOTIFICATIONS HELPERS (sendToAll, send)
// ══════════════════════════════════════════════════
// Extend Notifs with missing methods if not present
document.addEventListener('DOMContentLoaded', () => {
  if (window.Notifs && !window.Notifs.send) {
    window.Notifs.send = async function(toUid, payload) {
      try {
        await db.collection('notifications').doc(toUid).collection('items').add({
          ...payload, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch(e) { console.warn('Notif send error:', e); }
    };
  }
  if (window.Notifs && !window.Notifs.sendToAll) {
    window.Notifs.sendToAll = async function(payload) {
      try {
        const snap = await db.collection('users').get();
        const batch = db.batch();
        snap.docs.forEach(doc => {
          const ref = db.collection('notifications').doc(doc.id).collection('items').doc();
          batch.set(ref, {...payload, read:false, createdAt:firebase.firestore.FieldValue.serverTimestamp()});
        });
        await batch.commit();
      } catch(e) { console.warn('sendToAll error:', e); }
    };
  }
});
