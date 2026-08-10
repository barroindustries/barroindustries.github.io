/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — People screens
   js/screens/people.js

   Wave 7 Pass 7 — split verbatim out of js/modules.js, 2026-08-03,
   following the Wave 2 (design.js) / Wave 7 Pass 1-6 extraction
   protocol. Still plain `window.*`-attached globals, no ESM, no
   bundler — this file is a physical split only, not a module. Loads
   after js/modules.js: every screen below calls modules.js's shared
   helpers (escHtml, safeHttpUrl, isRealPresident, emojiIcon, etc.) by
   bare-global/window.* name at runtime only, never at parse time —
   same convention as every other Wave 7 pass. app.js's navigateTo
   switch, the bottom-nav route tables (config.js), and notifications
   deep-links reach forward into this file's window.render* entry
   points the same way (see the pass report's caller table).

   Contents (screen order matches original modules.js top-to-bottom):
   - Posts feed: renderPosts, loadPosts, openNewPostModal.
   - Team directory: renderTeamTab, End-of-Month standings
     (eomMonthLabel/ymShift/renderEomBanner/renderEomCard/
     computeEomStandings/openEomStandingsModal), showCallingCard,
     renderTeamCards.
   - Attendance: getPHHolidays, loadHolidayOverrides,
     renderAttendancePage, renderHolidaysAdmin (admin holiday
     overrides).
   - Cash Advance UI: renderCashAdvancePage, renderCashAdvanceEmployee,
     renderCAEmployeeCards, renderCashAdvanceAdmin, renderCAList,
     openPresidentCashAdvanceModal. (The CashAdvance SERVICE — the
     Firestore read/write layer these call into — lives in config.js
     and stays there; only the screen/render layer moved.)
   - Company Overview: renderCompanyOverviewNew, renderPresidentMessageCard —
     DELETED in Wave 7 Pass 10 (Cleanup), 2026-08-03. Had no live caller
     anywhere in the app — the 'company' nav case in app.js's navigateTo
     routes to a DIFFERENT, same-purpose function (js/screens/dashboards.js's
     renderCompany/renderCompanyOverview). See the deletion-site comment
     further down this file for the full grep evidence.
   - Leave: the LEAVE MANAGEMENT IIFE (requests, approval, balances —
     leave_requests + leave_balances/{uid}).
   - Global Search: the GLOBAL SEARCH IIFE (tasks/clients/inventory/
     products/quotes/files, internal-staff-only).
   - Files Hub: renderFilesHub (top-level "Files" page, all scopes).
   - My Profile: renderMyProfile, loadMyProfileTab, renderPersonalAnalytics,
     renderMyProfileTasksList, _mpTsMillis, _mpTimeAgo, renderRecentActivity.

   NOT moved — Inventory (window.renderInventory/renderStock/
   renderMovements, the raw-materials/finished-goods/stock-log/job-
   costing IIFE) stays behind in js/modules.js, in its original
   position between Company Overview and Leave. It sat physically
   inside this pass's line range but isn't a "people" screen — it's
   called from Finance (js/departments.js's loadFinanceContent, the
   'Inventory' subtab) and Production (js/screens/production.js's
   loadProductionContent) via `window.renderInventory` only; renderStock
   and renderMovements are IIFE-private, never referenced outside it.
   Verified every external caller already resolves through
   `window.renderInventory` at runtime (departments.js, app.js's
   dashboard 'inventory' shortcut, production.js all match), so the
   block COULD move without breaking anything — but this pass's file
   allowlist doesn't include production.js (its natural home), and
   dropping a finance/production screen into people.js would be a
   worse split than leaving it where it is. Left in place; a future
   pass that touches production.js should relocate it there.

   Shared helpers used across the whole app (escHtml, safeHttpUrl,
   PRESIDENT_UID, isRealPresident) stay in js/modules.js — grepped
   their callers first (100+ escHtml call sites alone, across app.js,
   departments.js, chat.js, and every js/screens/*.js file) and moving
   them was never in scope.
═══════════════════════════════════════════════════ */
'use strict';

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
      <div class="page-header"><h2>${emojiIcon('📣',20)} Posts</h2></div>
      ${window.chipTabs([{key:'Partners', label:'Partners'}], 'Partners', {cls:'posts-tabs'})}
      <div id="posts-content"></div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    window.bindChipTabs(c.querySelector('.posts-tabs'), key => loadPosts(key));
    loadPosts('Partners');
    return;
  }

  // Department tabs. The dropdown in openNewPostModal offers EVERY department
  // (Object.keys(DEPARTMENTS)), but this list used to be currentDepts alone — so
  // an oversight role, whose company-wide reach comes from their ROLE and not
  // from a department assignment, could file a post into a feed it then had no
  // tab for. Write-only department feeds. For the isAdmin() tier (president /
  // manager / Corporate Secretary) build the list from the departments they can
  // actually reach; the posts read rule already permits every one of them.
  // The Corporate Secretary's two closed departments are subtracted here the
  // same way the Departments grid (js/screens/dashboards.js) and the chat
  // channel list (js/chat.js) subtract them — this list is presentation only,
  // firestore.rules is the boundary.
  const _blockedDepts = (window.currentRole === 'secretary')
    ? (window.SECRETARY_BLOCKED_DEPTS || ['Finance', 'IT'])
    : [];
  const _reachableDepts = ((typeof window.isAdminPriv === 'function' && window.isAdminPriv())
      ? Object.keys(window.DEPARTMENTS || {})
      : (currentDepts || []))
    .filter(d => !_blockedDepts.includes(d));
  const postTabs = [
    {key:'General', label:'General'},
    // Set, not a plain-object seen-map: a department name that collides with an
    // Object.prototype key would silently drop its own tab.
    ...[...new Set(_reachableDepts)].map(d => ({key:d, label:d})),
    ...(canApprove ? [{key:'Pending', label:'Pending Approval'}] : [])
  ];
  c.innerHTML = `
    <div class="page-header">
      <h2>${emojiIcon('📣',20)} Posts</h2>
      <button class="btn-primary btn-sm" id="new-post-btn">+ ${canPost ? 'New Post' : 'Submit Post'}</button>
    </div>
    ${window.chipTabs(postTabs, 'General', {cls:'posts-tabs'})}
    <div id="posts-content"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadPosts('General');
  window.bindChipTabs(c.querySelector('.posts-tabs'), key => loadPosts(key));
  document.getElementById('new-post-btn').addEventListener('click', () => openNewPostModal(canPost));
};

// ── Post card markup — ONE source of truth ────────────────────────────────
// Extracted verbatim from loadPosts's own posts.map(...) template (2026-08,
// "share posts to chat" batch) so the feed and the single-post detail view
// (openPostById, below) can never drift apart. Both branches — the memo mirror
// card and the normal post card — are byte-identical to what the feed rendered
// before, with ONE addition: an optional Share button (opts.share).
//
// opts:
//   canApprove  — viewer may APPROVE/REJECT a pending post (president/manager).
//                 This is the ONE post verb the owner's ruling withheld from the
//                 Corporate Secretary, and firestore.rules agrees: an update that
//                 touches `status` requires isSeniorAdmin(), which excludes them.
//   canModerate — viewer may PIN/UNPIN, or delete someone else's post. A SEPARATE
//                 flag on purpose. The rules split these three verbs deliberately:
//                 a non-`status` update (pinning writes `pinned`) is allowed to
//                 isAdmin(), and delete is allowed to author-or-isAdmin() — and
//                 isAdmin() includes 'secretary'. Riding pin+delete on canApprove
//                 hid two capabilities the boundary grants the oversight role, so
//                 they could neither pin a company announcement nor take down an
//                 inappropriate post. Defaults to canApprove so the read-only
//                 detail view (openPostById, which passes canApprove:false)
//                 stays button-less exactly as before.
//   isOwn       — viewer authored this post (Edit/Delete)
//   share       — render the "Share" button (feed only; never in the detail view,
//                 and never for an external partner — see loadPosts)
window.postCardHtml = function(p, opts) {
  opts = opts || {};
  const canApprove  = !!opts.canApprove;
  const canModerate = ('canModerate' in opts) ? !!opts.canModerate : canApprove;
  const isOwn       = !!opts.isOwn;
  const ts = p.createdAt?.toDate ? p.createdAt.toDate().toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
  const hearts = p.hearts || [];
  const hearted = hearts.includes(currentUser.uid);
  // escHtml on the id (the surrounding template interpolates it raw) — a no-op
  // for a real Firestore id, so `.post-share-btn[data-id]` lookups are unchanged.
  const shareBtn = opts.share
    ? `<button class="btn-secondary btn-sm post-share-btn" data-id="${escHtml(p.id)}">${emojiIcon('share-2',16)} Share</button>`
    : '';
  // Memo mirror cards: internal announcements surfaced into the General feed.
  // They open the memo (with conforme) instead of behaving like a normal post.
  // Partners never load the General tab, so these stay internal-only.
  if (p.kind === 'memo' && p.memoId) {
    return `
    <div class="post-card post-memo-card" data-id="${p.id}" data-memo-id="${escHtml(p.memoId)}" style="cursor:pointer;border-left:3px solid var(--primary,#0A84FF)">
      <div class="post-header">
        <div class="post-avatar" style="background:var(--info-soft)">${emojiIcon('📋',16)}</div>
        <div class="post-meta">
          <div class="post-author">${escHtml(p.authorName||'Management')}</div>
          <div class="post-time">${escHtml(ts)} · Memo</div>
        </div>
        ${p.pinned ? `<span class="badge badge-blue">${emojiIcon('📌',16)} Pinned</span>` : ''}
        <span class="badge badge-blue">${emojiIcon('📋',16)} Memo</span>
      </div>
      ${p.title ? `<div class="post-title">${escHtml(p.title)}</div>` : ''}
      <div class="post-body">${escHtml((p.content||'').slice(0,200))}${(p.content||'').length>200?'…':''}</div>
      <div class="post-actions">
        <button class="btn-primary btn-sm post-memo-open" data-memo-id="${escHtml(p.memoId)}">${emojiIcon('📋',16)} Read &amp; Conforme</button>
        ${shareBtn}
        <div style="display:flex;gap:6px;margin-left:auto">
          ${(canModerate || isOwn) ? `<button class="btn-secondary btn-sm post-delete-btn" data-id="${p.id}" style="color:var(--danger)">Delete</button>` : ''}
          ${canModerate ? `<button class="btn-secondary btn-sm post-pin-btn" data-id="${p.id}">${p.pinned?'Unpin':`${emojiIcon('📌',16)} Pin`}</button>` : ''}
        </div>
      </div>
    </div>`;
  }
  return `
  <div class="post-card" data-id="${p.id}">
    <div class="post-header">
      <div class="post-avatar">${safeHttpUrl(p.authorPhoto) ? `<img src="${escHtml(p.authorPhoto)}"/>` : escHtml((p.authorName||'?')[0])}</div>
      <div class="post-meta">
        <div class="post-author">${escHtml(p.authorName||'Unknown')}</div>
        <div class="post-time">${escHtml(ts)}${p.dept&&p.dept!=='General'?` · ${escHtml(p.dept)}`:''}</div>
      </div>
      ${p.pinned ? `<span class="badge badge-blue">${emojiIcon('📌',16)} Pinned</span>` : ''}
      ${p.status==='pending' ? '<span class="badge badge-orange">Pending</span>' : ''}
    </div>
    ${p.title ? `<div class="post-title">${escHtml(p.title)}</div>` : ''}
    <div class="post-body">${escHtml(p.content||'')}</div>
    ${safeHttpUrl(p.imageUrl) ? `<img src="${escHtml(p.imageUrl)}" class="post-image" data-img="${escHtml(p.imageUrl)}" style="cursor:zoom-in"/>` : ''}
    ${safeHttpUrl(p.fileUrl) ? `<a href="${escHtml(p.fileUrl)}" target="_blank" rel="noopener noreferrer" class="post-attachment">${emojiIcon('📎',16)} ${escHtml(p.fileName||'Attachment')}</a>` : ''}
    <div class="post-actions">
      ${p.status==='published' ? `
        <button class="post-heart-btn${hearted?' hearted':''}" data-id="${p.id}" title="${hearted?'Unlike':'Like'}">
          <svg class="heart-svg" viewBox="0 0 24 24" fill="${hearted?'#FF6B2B':'none'}" stroke="${hearted?'#FF6B2B':'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          ${hearts.length ? `<span class="heart-count">${hearts.length}</span>` : '<span class="heart-count" style="display:none">0</span>'}
        </button>
        ${hearts.length ? `<button class="post-likers-btn btn-link" data-id="${p.id}" data-hearts='${JSON.stringify(hearts)}' style="font-size:12px;color:var(--text-muted);padding:0 4px;background:none;border:none;cursor:pointer"></button>` : ''}
      ` : ''}
      ${canApprove && p.status==='pending' ? `
        <button class="btn-primary btn-sm post-approve-btn" data-id="${p.id}">${emojiIcon('✓',16)} Approve</button>
        <button class="btn-secondary btn-sm post-reject-btn" data-id="${p.id}">${emojiIcon('✗',16)} Reject</button>
      ` : ''}
      ${shareBtn}
      <div style="display:flex;gap:6px;margin-left:auto">
        ${isOwn ? `<button class="btn-secondary btn-sm post-edit-btn" data-id="${p.id}">${emojiIcon('✎',16)} Edit</button>` : ''}
        ${(canModerate || isOwn) ? `<button class="btn-secondary btn-sm post-delete-btn" data-id="${p.id}" style="color:var(--danger)">Delete</button>` : ''}
        ${canModerate && p.status==='published' ? `<button class="btn-secondary btn-sm post-pin-btn" data-id="${p.id}">${p.pinned?'Unpin':`${emojiIcon('📌',16)} Pin`}</button>` : ''}
      </div>
    </div>
  </div>`;
};

// The post-card interactions that need NO feed reload — image tap, heart
// toggle, likers list. Moved verbatim out of loadPosts so the single-post
// detail view gets exactly the same behaviour from the same code. (Approve /
// reject / delete / pin / edit all end in `loadPosts(dept)` and therefore stay
// feed-only — see openPostById's own note.)
// `container` is always the caller's own scoped element, never a document lookup.
window.wirePostCardCommon = function(container) {
  if (!container) return;
  // Open post image in a new tab — URL validated to http(s) only, wired via
  // addEventListener so the raw URL never lands in an inline onclick string.
  container.querySelectorAll('.post-image[data-img]').forEach(img => img.addEventListener('click', () => {
    const safe = safeHttpUrl(img.dataset.img);
    if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
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
    openModal('❤️ Liked by', window.skeletonHtml('rows'));
    const names = await Promise.all(uids.map(uid =>
      db.collection('users').doc(uid).get().then(s => s.exists ? (s.data().displayName || s.data().email) : uid).catch(()=>uid)
    ));
    document.getElementById('modal-body').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${names.map(n=>`<div style="display:flex;align-items:center;gap:8px;font-size:14px"><span style="font-size:20px">❤️</span>${escHtml(n)}</div>`).join('')}
      </div>`;
  }));
};

// ── Open ONE post by id ───────────────────────────────────────────────────
// Entry point for the chat record-link chip (js/chat.js `_openRefChip`, kind
// 'post'). The Posts feed itself CANNOT serve as that opener: loadPosts always
// starts on the General tab with .limit(30), so a shared department post — or
// any post older than the most recent 30 — is simply not on screen. Modelled on
// window.openMemoById (js/screens/dashboards.js): fetch the single doc, render
// one card into an openPage panel.
//
// Every failure mode dead-ends in a toast, never a thrown/unhandled rejection:
//   • a partner tapping a chip for an internal post  → rules-DENIED (throws)
//   • a post deleted after the chip was sent         → !snap.exists
//   • offline / transient                            → throws
window.openPostById = async function(postId) {
  if (!postId) { Notifs.showToast('That post is no longer available', 'error'); return; }
  let snap = null;
  try {
    snap = await db.collection('posts').doc(postId).get();
  } catch (_) {
    Notifs.showToast('That post is no longer available', 'error');
    return;
  }
  if (!snap || !snap.exists) { Notifs.showToast('That post is no longer available', 'error'); return; }
  const p = { id: snap.id, ...snap.data() };
  // Read-only detail view. canApprove/isOwn are deliberately false: every
  // button they would add (Approve/Reject/Edit/Delete/Pin) ends in a
  // `loadPosts(dept)` feed re-render that has no meaning here. share is false
  // too — you reached this card FROM a share.
  const panel = window.openPage('Post', `<div id="post-detail-body">${window.postCardHtml(p, { canApprove: false, isOwn: false, share: false })}</div>`);
  if (!panel) return;
  const host = panel.querySelector('#post-detail-body');
  if (!host) return;
  if (window.lucide) lucide.createIcons({ nodes: [host] });
  window.wirePostCardCommon(host);
  // Memo mirror card → open the memo (conforme is given there). No onChange
  // callback: there is no feed behind this panel to refresh.
  host.querySelectorAll('.post-memo-open').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    window.openMemoById?.(btn.dataset.memoId);
  }));
  host.querySelectorAll('.post-memo-card').forEach(card => card.addEventListener('click', e => {
    if (e.target.closest('button') || e.target.closest('a')) return;
    window.openMemoById?.(card.dataset.memoId);
  }));
};

// The one-line label a shared post carries into chat. sendMessage()'s persist
// block already caps ref.label at 140 chars; the cap is repeated here only so
// the value this function returns is the value that gets stored. The real work
// is collapsing whitespace, so a multi-line post body becomes one clean chip
// line instead of a ragged block.
function postShareLabel(p) {
  return String(p.title || p.content || 'Post').replace(/\s+/g, ' ').trim().slice(0, 140) || 'Post';
}

// Re-audit 2026-08-03: this always queried .limit(30) with no cursor/"load more" —
// anything older than the most recent 30 posts in a tab was permanently
// unreachable from this screen. `pageSize` grows via the "Load older posts"
// button below instead of a real cursor, to keep every existing call site
// (loadPosts(dept) after delete/approve/pin/heart, etc.) working unchanged —
// it's a full re-render each time, so there's no risk of double-wiring
// listeners on already-rendered cards the way an append-only page would have.
async function loadPosts(dept, pageSize) {
  pageSize = pageSize || 30;
  const container = document.getElementById('posts-content');
  container.innerHTML = window.skeletonHtml('rows');
  try {
    let q = db.collection('posts').orderBy('createdAt','desc');
    if (dept === 'Pending') {
      q = db.collection('posts').where('status','==','pending').orderBy('createdAt','desc');
    } else if (dept === 'General') {
      q = db.collection('posts').where('dept','==','General').where('status','==','published').orderBy('createdAt','desc');
    } else {
      q = db.collection('posts').where('dept','==',dept).where('status','==','published').orderBy('createdAt','desc');
    }
    const snap = await q.limit(pageSize + 1).get();
    const hasMore = snap.docs.length > pageSize;
    const posts = snap.docs.slice(0, pageSize).map(d => ({id:d.id,...d.data()}));
    if (!posts.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('📭',44)}</div><h4>No posts yet</h4></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [container] });
      return;
    }
    const canApprove = isRealPresident() || currentRole === 'manager';
    // Pin/unpin and moderator-delete are the isAdmin() tier, NOT the approval
    // tier — see window.postCardHtml's opts comment. isAdminPriv()
    // (js/departments.js) is the client mirror of firestore.rules' isAdmin(),
    // so president/manager/Corporate Secretary; it deliberately excludes
    // finance, which the rules exclude too.
    const canModerate = (typeof window.isAdminPriv === 'function') ? window.isAdminPriv() : canApprove;
    // Sharing a post into chat copies up to 140 chars of its title/body VERBATIM
    // into the chat message doc (ref.label), and from there into the target
    // conversation's inbox preview and every recipient's push body. An external
    // partner must never be handed that, so the button is not offered to a
    // partner viewer at all (js/chat.js's shareToChat re-asserts this, and
    // additionally blocks every conversation a partner is IN).
    const viewerIsPartner = typeof isPartner === 'function' && isPartner();
    // Store post data by id so edit button can retrieve it without fragile data-* encoding
    const postMap = new Map(posts.map(p => [p.id, p]));
    container.innerHTML = posts.map(p => window.postCardHtml(p, {
      canApprove,
      canModerate,
      isOwn: p.authorId === currentUser.uid,
      // Only a PUBLISHED post is shareable — a pending/rejected draft must not
      // be broadcast into chat before it clears approval.
      share: !viewerIsPartner && p.status === 'published'
    })).join('') + (hasMore ? `<div style="text-align:center;padding:14px"><button class="btn-secondary btn-sm" id="posts-load-more-btn">${emojiIcon('⬇',16)} Load older posts</button></div>` : '');
    if (window.lucide) lucide.createIcons({nodes:[container]});
    document.getElementById('posts-load-more-btn')?.addEventListener('click', () => loadPosts(dept, pageSize + 30));

    // Image tap / heart / likers — shared with the single-post detail view
    // (window.wirePostCardCommon, above); none of them reload the feed.
    window.wirePostCardCommon(container);

    // Share this post into a chat conversation. The picker + the partner block
    // both live in js/chat.js (Chat.shareToChat) — this only supplies the
    // {kind,id,label} payload.
    container.querySelectorAll('.post-share-btn').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const p = postMap.get(btn.dataset.id);
      if (!p) return;
      if (!window.Chat || typeof window.Chat.shareToChat !== 'function') {
        Notifs.showToast('Chat is unavailable right now.', 'error');
        return;
      }
      window.Chat.shareToChat({ kind: 'post', id: p.id, label: postShareLabel(p) });
    }));

    container.querySelectorAll('.post-approve-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;
      const postSnap = await db.collection('posts').doc(id).get();
      if (!postSnap.exists) { Notifs.showToast('Post no longer exists.', 'error'); loadPosts(dept); return; }
      const post = postSnap.data();
      await db.collection('posts').doc(id).update({status:'published'});
      await Notifs.send(post.authorId, {title:'Post Approved', body:`Your post "${post.title||post.content?.slice(0,30)}" was approved!`, icon:'✅', type:'post'});
      Notifs.success('Post approved!');
      loadPosts(dept);
    }));
    container.querySelectorAll('.post-reject-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;
      await db.collection('posts').doc(id).update({status:'rejected'});
      Notifs.error('Post rejected.');
      loadPosts(dept);
    }));
    container.querySelectorAll('.post-delete-btn').forEach(btn => btn.addEventListener('click', async e => {
      if (!(await confirmDialog({ message: 'Delete this post?', danger: true }))) return;
      await db.collection('posts').doc(e.target.dataset.id).delete();
      Notifs.success('Deleted.');
      loadPosts(dept);
    }));
    container.querySelectorAll('.post-pin-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id = e.currentTarget.dataset.id;
      const snap = await db.collection('posts').doc(id).get().catch(()=>null);
      if (!snap || !snap.exists) { Notifs.showToast('Post no longer exists.','error'); loadPosts(dept); return; }
      await db.collection('posts').doc(id).update({pinned: !snap.data().pinned});
      loadPosts(dept);
    }));
    // Edit post
    container.querySelectorAll('.post-edit-btn').forEach(btn => btn.addEventListener('click', async e => {
      const id      = btn.dataset.id;
      const post    = postMap.get(id) || {};
      const oldTitle   = post.title || '';
      const oldContent = post.content || '';
      const _panel = openPage(`${emojiIcon('✎',16)} Edit Post`, `
        <div class="form-group"><label>Title (optional)</label><input id="edit-post-title" placeholder="Post title…"/></div>
        <div class="form-group"><label>Content</label><textarea id="edit-post-content" rows="5" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical"></textarea></div>
      `, `<button class="btn-primary" id="save-post-edit-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      // ⚠ SCOPED TO THIS PANEL, NOT document.
      // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
      // inside that window and two panels carry the same ids at once —
      // document.getElementById() returns the FIRST in document order, which is
      // the DYING one, so the handler binds to a button nobody can see and the
      // visible button does nothing (and a save can read the PREVIOUS record's
      // field values). Reported by the Corporate Secretary 2026-08-10.
      _panel.querySelector('#edit-post-title').value   = oldTitle;
      _panel.querySelector('#edit-post-content').value = oldContent;
      _panel.querySelector('#save-post-edit-btn').addEventListener('click', async () => {
        const title   = _panel.querySelector('#edit-post-title').value.trim();
        const content = _panel.querySelector('#edit-post-content').value.trim();
        if (!content) { Notifs.showToast('Content required','error'); return; }
        await db.collection('posts').doc(id).update({
          title, content,
          editedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal();
        Notifs.success('Post updated!');
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
  // Same subtraction as the tab list above: the Corporate Secretary must not be
  // offered Finance or IT as a destination for a post. Presentation only —
  // firestore.rules is what actually refuses the write.
  const _postDeptBlocked = (window.currentRole === 'secretary')
    ? (window.SECRETARY_BLOCKED_DEPTS || ['Finance', 'IT'])
    : [];
  const _postDepts = Object.keys(window.DEPARTMENTS || {}).filter(d => !_postDeptBlocked.includes(d));
  const _panel = openPage(publishDirectly ? 'New Post' : 'Submit Post for Approval', `
    <div class="form-group"><label>Title (optional)</label><input id="post-title" placeholder="Post title…"/></div>
    <div class="form-group"><label>Content</label><textarea id="post-content" rows="5" placeholder="Write your message…" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);color:var(--text);resize:vertical"></textarea></div>
    <div class="form-group"><label>Department</label>
      <select id="post-dept" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="General">General (All Staff)</option>
        ${_postDepts.map(d=>`<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('')}
      </select>
    </div>
    <div id="post-file-area"></div>
  `, `<button class="btn-primary" id="save-post-btn">${publishDirectly ? 'Publish' : 'Submit for Approval'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  let uploadedFile = null;
  Drive.renderUploadArea('post-file-area', r => { uploadedFile = r; }, { label: 'Attach image or file', dept: 'posts', subfolder: 'attachments' });

  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
  // inside that window and two panels carry the same ids at once —
  // document.getElementById() returns the FIRST in document order, which is
  // the DYING one, so the handler binds to a button nobody can see and the
  // visible button does nothing (and a save can read the PREVIOUS record's
  // field values). Reported by the Corporate Secretary 2026-08-10.
  _panel.querySelector('#save-post-btn').addEventListener('click', async () => {
    const content = _panel.querySelector('#post-content').value.trim();
    if (!content) { Notifs.showToast('Write something first.', 'error'); return; }
    const dept = _panel.querySelector('#post-dept').value;
    const status = publishDirectly ? 'published' : 'pending';
    await db.collection('posts').add({
      title:       _panel.querySelector('#post-title').value.trim(),
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
      await Notifs.sendToAll({title:`📣 New Post`, body:`${userProfile.displayName||'Someone'} posted: ${_panel.querySelector('#post-title').value.trim()||content.slice(0,40)}`, icon:'📣', type:'post'});
    } else {
      await Notifs.sendToOwner({title:'New Post Awaiting Approval', body:`${userProfile.displayName} submitted a post for review.`, icon:'📋', type:'post_approval'});
    }
    closeModal();
    Notifs.success(status==='published' ? 'Post published!' : 'Submitted for approval!');
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
      <h2>${emojiIcon('👥',20)} Team</h2>
      ${pres && !viewingAsPartner ? '<button class="btn-primary btn-sm" id="invite-user-btn">+ Invite Member</button>' : ''}
    </div>
    ${!viewingAsPartner ? '<div id="eom-banner"></div>' : ''}
    <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">
      <input id="team-search" placeholder="Search name, role or department…" class="ms-input" style="max-width:320px"/>
      <button class="btn-secondary btn-sm" id="set-note-btn" style="white-space:nowrap">${emojiIcon('✏️',16)} Set My Note</button>
    </div>
    <div id="team-grid"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  const teamGrid = document.getElementById('team-grid');
  teamGrid.innerHTML = window.skeletonHtml('cards');

  let snap;
  try {
    snap = typeof dbCachedGet === 'function'
      ? await dbCachedGet('users', () => db.collection('users').get(), 60000)
      : await db.collection('users').get();
  } catch (err) {
    teamGrid.innerHTML =
      '<div class="empty-state"><div class="empty-icon">' + (emojiIcon ? emojiIcon('⚠️',44) : '') + '</div>' +
      '<h4>Something went wrong</h4><p>' + escHtml(err && err.message ? err.message : String(err)) + '</p>' +
      '<button type="button" class="btn-secondary btn-sm" id="team-retry-btn" style="margin-top:14px">Retry</button></div>';
    if (window.lucide) lucide.createIcons({ nodes: [teamGrid] });
    document.getElementById('team-retry-btn')?.addEventListener('click', () => window.renderTeamTab());
    return;
  }
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

  // Debounced to match the pattern already used elsewhere (Inventory/Movements
  // search, js/modules.js) — a full masonry-grid rebuild + card re-wiring on
  // every keystroke is wasted work once the team list grows.
  let _teamSearchT;
  document.getElementById('team-search').addEventListener('input', e => {
    clearTimeout(_teamSearchT);
    const v = e.target.value;
    _teamSearchT = setTimeout(() => {
      const q = v.toLowerCase();
      const filtered = q ? users.filter(u =>
        (u.displayName||'').toLowerCase().includes(q) ||
        (u.role||'').toLowerCase().includes(q) ||
        (Array.isArray(u.departments)?u.departments:u.department?[u.department]:[]).join(' ').toLowerCase().includes(q)
      ) : users;
      renderTeamCards(filtered, currentUser);
    }, 180);
  });

  // Set Note (IG-style status)
  document.getElementById('set-note-btn').addEventListener('click', () => {
    const me = users.find(u => u.id === currentUser.uid);
    const current = me?.statusNote || '';
    openModal(`${emojiIcon('✏️',16)} Set Your Note`, `
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
      // Re-audit 2026-08-03: statusNote never carried a timestamp, so a note set
      // weeks ago stayed pinned to the card forever with nothing signalling it's
      // stale. Stamp it so the card can show its age and auto-expire it.
      await db.collection('users').doc(currentUser.uid).update({ statusNote: note, statusNoteAt: firebase.firestore.FieldValue.serverTimestamp() });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('users');
      closeModal(); Notifs.success('Note updated!');
      window.renderTeamTab();
    });
    // "Clear Note" = close and clear
    document.querySelector('#modal-footer .btn-secondary').onclick = async () => {
      await db.collection('users').doc(currentUser.uid).update({ statusNote: '' });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('users');
      closeModal(); Notifs.success('Note cleared');
      window.renderTeamTab();
    };
  });

  if (pres) {
    document.getElementById('invite-user-btn')?.addEventListener('click', () => {
      const _panel = openPage('Invite Team Member', `
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">They'll receive a password reset email to set their own password.</p>
        <div class="form-group"><label>Email</label><input id="inv-email" type="email" placeholder="employee@barroindustries.com"/></div>
        <div class="form-group"><label>Display Name</label><input id="inv-name" placeholder="Full name"/></div>
        <div class="form-group"><label>Phone</label><input id="inv-phone" type="tel" placeholder="+63 9XX XXX XXXX"/></div>
        <div class="form-group"><label>Role</label>
          <select id="inv-role" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            ${(window.assignableRoles ? window.assignableRoles() : Object.entries(window.ROLES||{})).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" id="inv-company-group" style="display:none"><label>Company <span style="font-weight:400;color:var(--text-muted)">(partner's own company)</span></label>
          <input id="inv-company" placeholder="e.g. Brilliant Steel Corporation"/>
        </div>
        <div class="form-group"><label>Department(s)</label>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:4px">
            ${Object.keys(window.DEPARTMENTS||{}).map(d=>`<label class="check-row"><input type="checkbox" class="inv-dept-cb" value="${d}"/>${d}</label>`).join('')}
          </div>
        </div>
      `, `<button class="btn-primary" id="save-inv-btn">Send Invite</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      // Company field is only relevant for the Partner role — reveal it when picked.
      // ⚠ SCOPED TO THIS PANEL, NOT document.
      // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
      // inside that window and two panels carry the same ids at once —
      // document.getElementById() returns the FIRST in document order, which is
      // the DYING one, so the handler binds to a button nobody can see and the
      // visible button does nothing (and a save can read the PREVIOUS record's
      // field values). Reported by the Corporate Secretary 2026-08-10.
      const invRole = _panel.querySelector('#inv-role');
      const syncCompany = () => {
        const g = _panel.querySelector('#inv-company-group');
        if (g) g.style.display = (invRole.value === 'partner') ? 'block' : 'none';
      };
      invRole?.addEventListener('change', syncCompany); syncCompany();
      _panel.querySelector('#save-inv-btn').addEventListener('click', async () => {
        const email = _panel.querySelector('#inv-email').value.trim();
        if (!email) { Notifs.showToast('Enter an email.','error'); return; }
        const depts = [..._panel.querySelectorAll('.inv-dept-cb:checked')].map(cb=>cb.value);
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
            displayName: _panel.querySelector('#inv-name').value.trim() || email.split('@')[0],
            phone: _panel.querySelector('#inv-phone').value.trim(),
            role:        _panel.querySelector('#inv-role').value,
            company:     _panel.querySelector('#inv-company')?.value.trim() || '',
            departments: depts, department: depts[0]||'',
            employeeId:  empId,
            photoUrl:'', startDate: window.bizDate(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('users');
          closeModal();
          // Re-audit 2026-08-03: the auth account + Firestore profile are already
          // committed above — a reset-email failure here (rate limit, transient
          // network) must NOT dead-end into an orphaned, unusable account with no
          // recovery path. Report it distinctly so the admin knows to resend
          // rather than assume the whole invite failed (re-running Invite for the
          // same email would just 400 with auth/email-already-in-use).
          try {
            await auth.sendPasswordResetEmail(email);
            Notifs.success(`Invite sent to ${email}!`);
          } catch (resetErr) {
            Notifs.showToast(`Account created for ${email}, but the reset email failed to send (${resetErr.message}). Use "Resend Reset Email" on their Team card to retry — do not re-invite this address.`, 'error');
          }
          window.renderTeamTab();
        } catch(err) {
          if (err && err.code === 'auth/email-already-in-use') {
            // The account may be a previously-orphaned invite (auth user + profile
            // created, but the reset email never went out or was never used) —
            // give the admin a recovery path instead of a dead-end error.
            const resend = await confirmDialog({
              title: 'Account already exists',
              message: `${email} already has an account — likely from a previous invite whose reset email failed to send. Resend the password-reset email instead of creating a new account?`,
              confirmLabel: 'Resend Reset Email', cancelLabel: 'Cancel'
            });
            if (resend) {
              try {
                await auth.sendPasswordResetEmail(email);
                Notifs.success(`Reset email re-sent to ${email}.`);
                closeModal();
              } catch (resendErr) {
                Notifs.showToast('Resend failed: ' + resendErr.message, 'error');
              }
            }
            return;
          }
          Notifs.showToast('Error: '+err.message,'error');
        }
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
          <div class="eom-empty-icon">${emojiIcon('🏆',16)}</div>
          <div class="eom-empty-text">
            <strong>Employee of the Month · ${escHtml(monthLbl)}</strong>
            <span>Auto-selected from KPI &amp; attendance, finalised and revealed on the 5th. No eligible activity recorded for ${escHtml(monthLbl)}.</span>
          </div>
          <button class="btn-secondary btn-sm" id="eom-standings-btn">${emojiIcon('📊',16)} Standings</button>
        </div>`;
      if (window.lucide) lucide.createIcons({ nodes: [host] });
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
      <div class="eom-ribbon">${emojiIcon('🏆',16)} Employee of the Month${data.month ? ` · ${escHtml(eomMonthLabel(data.month))}` : ''}</div>
      <div class="eom-body">
        <div class="eom-avatar">
          ${safeHttpUrl(photoUrl) ? `<img src="${escHtml(photoUrl)}" alt="${escHtml(name)}"/>` : `<span>${escHtml(initials)}</span>`}
        </div>
        <div class="eom-info">
          <div class="eom-name">${escHtml(name)}</div>
          <div class="eom-role">${escHtml(roleLabel)} · ${escHtml(depts)}</div>
          ${data.reason ? `<div class="eom-reason">${escHtml(data.reason)}</div>` : ''}
          <div class="eom-auto-tag">${emojiIcon('⚙️',16)} Auto-selected by performance${metrics}</div>
        </div>
        ${canManage ? `<button class="eom-edit-btn" id="eom-standings-btn" title="View standings" aria-label="View standings">${emojiIcon('bar-chart-3',16)}</button>` : ''}
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
    openPage(`${emojiIcon('📊',16)} Employee of the Month — Standings`,
      `<div class="empty-state" style="padding:30px"><div class="empty-icon">${emojiIcon('📊',44)}</div><p>No eligible team members have logged attendance yet this month.</p></div>`,
      `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    return;
  }
  const winner = standings[0];
  const rows = standings.map((s, i) => {
    const medal = i === 0 ? `${emojiIcon('🥇',16)}` : i === 1 ? `${emojiIcon('🥈',16)}` : i === 2 ? `${emojiIcon('🥉',16)}` : `${i + 1}.`;
    const initials = (s.displayName || s.email || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;background:${i === 0 ? 'rgba(255,196,0,0.1)' : 'var(--surface2,rgba(255,255,255,0.04))'};margin-bottom:8px;border:1px solid ${i === 0 ? 'rgba(255,196,0,0.35)' : 'transparent'}">
      <div style="font-size:18px;width:28px;text-align:center;flex:0 0 auto">${medal}</div>
      <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-light));display:flex;align-items:center;justify-content:center;color:var(--on-primary);font-weight:800;font-size:14px;flex:0 0 auto;overflow:hidden">${safeHttpUrl(s.photoUrl) ? `<img src="${escHtml(s.photoUrl)}" style="width:100%;height:100%;object-fit:cover" alt=""/>` : escHtml(initials)}</div>
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
    ? `<button class="btn-secondary" disabled style="opacity:.6">${emojiIcon('✓',16)} Announced</button><button class="btn-secondary" onclick="closeModal()">Close</button>`
    : `<button class="btn-primary" id="eom-announce-btn">${emojiIcon('📣',16)} Announce ${escHtml(firstName)}</button><button class="btn-secondary" onclick="closeModal()">Close</button>`;

  const _panel = openPage(`${emojiIcon('📊',16)} Employee of the Month — Standings`, `
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Final standings for <strong>${escHtml(eomMonthLabel(month) || 'last month')}</strong> — ranked by task KPI (50%), attendance (40%) and performance grade (10%). Revealed &amp; awarded on the 5th.</p>
    <div>${rows}</div>
  `, footer);

  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
  // inside that window and two panels carry the same ids at once —
  // document.getElementById() returns the FIRST in document order, which is
  // the DYING one, so the handler binds to a button nobody can see and the
  // visible button does nothing (and a save can read the PREVIOUS record's
  // field values). Reported by the Corporate Secretary 2026-08-10.
  _panel.querySelector('#eom-announce-btn')?.addEventListener('click', async () => {
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
      Notifs.success(`Announced ${winner.displayName || winner.email} to the team! 🏆`);
    } catch (err) { Notifs.showToast('Error: ' + err.message, 'error'); }
  });
}

function showCallingCard(u) {
  const roleLabel = window.ROLES?.[u.role]?.label || u.role || 'Employee';
  const depts = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(' · ') || 'Unassigned';
  const initials = (u.displayName||u.email||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  openModal(`${emojiIcon('📇',16)} ${u.displayName||u.email}`, `
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px;padding:28px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px">
      ${safeHttpUrl(u.photoUrl)
        ? `<img src="${escHtml(u.photoUrl)}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.3);margin-bottom:4px" alt=""/>`
        : `<div style="width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:var(--on-primary);margin-bottom:4px">${escHtml(initials)}</div>`}
      <div style="font-size:20px;font-weight:800;color:var(--on-primary);letter-spacing:.5px">${escHtml(u.displayName||u.email)}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.7);font-weight:600;text-transform:uppercase;letter-spacing:.08em">${roleLabel}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5)">${escHtml(depts)}</div>
      <div style="width:100%;height:1px;background:rgba(255,255,255,0.15);margin:8px 0"></div>
      ${u.email?`<div style="font-size:13px;color:rgba(255,255,255,0.8)">${emojiIcon('✉️',13)} ${escHtml(u.email)}</div>`:''}
      ${u.phone?`<div style="font-size:13px;color:rgba(255,255,255,0.8)">${emojiIcon('📞',13)} ${escHtml(u.phone)}</div>`:''}
      ${u.employeeId?`<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;letter-spacing:.1em">${u.employeeId}</div>`:''}
      <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:6px;letter-spacing:.15em">BARRO INDUSTRIES</div>
    </div>
  `);
}

function renderTeamCards(users, currentUser) {
  const grid = document.getElementById('team-grid');
  if (!grid) return;
  if (!users.length) {
    grid.innerHTML = window.renderEmptyState({icon:'👥', title:'No team members found', hint:'Try clearing filters, or check back once accounts are added.'});
    if (window.lucide) lucide.createIcons({ nodes: [grid] });
    return;
  }
  const now = Date.now();
  // Offboarding (owner feature) — "guarded to president/manager/HR": the two
  // senior-admin roles, OR membership in the HR department specifically (NOT
  // canEditDept()'s broader secretary/finance-department admin grants — this
  // is a per-person account action, kept narrower on purpose).
  const canManageAccounts = ['president','manager'].includes(currentRole) ||
    (Array.isArray(currentDepts) && currentDepts.includes('HR'));

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

    // Re-audit 2026-08-03: statusNote had no TTL/age display — a note set weeks
    // ago stayed pinned indefinitely with nothing signalling it's stale, unlike
    // the IG-style status it's modeled on. Auto-hide past a 24h TTL and show its
    // age otherwise. Legacy notes with no statusNoteAt (set before this field
    // existed) fall back to "no age known" and are shown without a TTL cutoff,
    // rather than being silently hidden by a timestamp they never had.
    const noteAtMs = u.statusNoteAt?.toMillis?.() || (u.statusNoteAt?.seconds ? u.statusNoteAt.seconds*1000 : 0);
    const noteAgeMin = noteAtMs ? Math.floor((now - noteAtMs)/60000) : null;
    const NOTE_TTL_MIN = 24*60;
    const statusNote = (noteAgeMin !== null && noteAgeMin >= NOTE_TTL_MIN) ? '' : (u.statusNote?.trim() || '');
    const noteAgeStr = noteAgeMin === null ? '' : noteAgeMin < 1 ? 'now' : noteAgeMin < 60 ? `${noteAgeMin}m` : `${Math.floor(noteAgeMin/60)}h`;

    return `
    <div class="team-member-card" data-uid="${u.id}">
      ${statusNote ? `
        <div class="team-note-bubble">
          <span>${escHtml(statusNote)}</span>${noteAgeStr?`<span style="font-size:10px;opacity:.6;margin-left:6px">${noteAgeStr}</span>`:''}
        </div>` : ''}
      <div class="team-member-avatar-wrap">
        <div class="team-member-avatar">
          ${safeHttpUrl(u.photoUrl)
            ? `<img src="${escHtml(u.photoUrl)}" alt="${escHtml(u.displayName||'')}"/>`
            : `<span>${escHtml(initial)}</span>`}
        </div>
        <span class="team-online-dot ${isOnline?'team-online-dot--on':'team-online-dot--off'}" title="${isOnline?'Online':'Last active: '+lastActiveStr}"></span>
      </div>
      <div class="team-member-name">${escHtml(u.displayName||u.email)}</div>
      <div class="team-member-role" style="color:${badgeColor}">${roleLabel}${isMe?' · You':''}</div>
      <div class="team-member-dept">${escHtml(depts)}</div>
      ${u.removed
        ? `<div class="team-status-pill" style="background:var(--danger,#ff4444);color:#fff">Removed</div>`
        : isOnline
          ? `<div class="team-status-pill team-status-pill--on">● Online</div>`
          : lastSeenMs ? `<div class="team-status-pill">${lastActiveStr}</div>` : ''}
      <div class="team-card-actions">
        <button class="team-card-btn view-card-btn" data-uid="${u.id}" title="View calling card" aria-label="View calling card">${emojiIcon('📇',16)}</button>
        ${!isMe && (!(typeof isPartner==='function'&&isPartner()) || (u.role==='partner'&&(u.company||'').trim()===(window.userProfile?.company||'').trim()) || ['president','manager'].includes(u.role))
          ? `<button class="team-card-btn chat-dm-btn" data-uid="${u.id}" title="Message ${escHtml(u.displayName||u.email)}" aria-label="Message ${escHtml(u.displayName||u.email)}">${emojiIcon('💬',16)}</button>` : ''}
        ${!isMe ? `<button class="team-card-btn nudge-btn" data-uid="${u.id}" data-name="${(u.displayName||u.email).replace(/"/g,'&quot;')}" title="Nudge ${escHtml(u.displayName||u.email)}" aria-label="Nudge ${escHtml(u.displayName||u.email)}">${emojiIcon('👋',16)}</button>` : ''}
        ${canManageAccounts && !isMe && u.role!=='president'
          ? `<button class="team-card-btn remove-user-btn" data-uid="${u.id}" data-name="${(u.displayName||u.email||'').replace(/"/g,'&quot;')}" data-removed="${u.removed?'1':'0'}" title="${u.removed?'Reinstate account':'Remove from system'}" aria-label="${u.removed?'Reinstate':'Remove'} ${escHtml(u.displayName||u.email||'')}">${u.removed?emojiIcon('user-check',16):emojiIcon('user-x',16)}</button>`
          : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
  if (window.lucide) lucide.createIcons({ nodes: [grid] });

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
      Notifs.success(`Nudge sent to ${name}!`);
      setTimeout(() => { btn.disabled = false; btn.textContent = '👋'; btn.title = `Nudge ${name}`; }, 3000);
    });
  });

  // Remove / Reinstate from system (owner feature — offboarding). Sets
  // users/{uid}.removed:true (+removedAt/removedBy), which js/app.js's
  // auth.onAuthStateChanged checks right after loadUserProfile() and blocks
  // them into a full-screen "you no longer work here" screen before any
  // nav/routing runs (see js/app.js's showRemovedUserScreen). This button
  // only flips the flag — it never deletes the user doc or any of their
  // data, and un-removing (Reinstate) is the same action in reverse.
  grid.querySelectorAll('.remove-user-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { uid, name } = btn.dataset;
      const isRemoved = btn.dataset.removed === '1';
      const ok = await confirmDialog({
        title: isRemoved ? 'Reinstate account' : 'Remove from system',
        message: isRemoved
          ? `Reinstate ${escHtml(name)}? They will be able to sign in again immediately.`
          : `Remove ${escHtml(name)} from the system? They will be signed out and blocked from signing back in — the app will tell them they no longer work with Barro Industries. This does NOT delete their account or any of their data, and can be undone from this same card at any time (Reinstate).`,
        html: true,
        confirmLabel: isRemoved ? 'Reinstate' : 'Remove',
        danger: !isRemoved
      });
      if (!ok) return;
      btn.disabled = true;
      try {
        // Route through the setUserDisabled Cloud Function (admin SDK) rather
        // than a direct users-doc write: it AUTHORITATIVELY disables/enables the
        // Firebase Auth account (+ revokes refresh tokens on remove) so a removed
        // employee's still-valid 10-day session can't bypass the client gate,
        // AND sets the removed flag server-side in the same action. The old
        // direct flag write only did the (bypassable) client half.
        const res = await firebase.functions().httpsCallable('setUserDisabled')({
          targetUid: uid, disabled: !isRemoved
        });
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('users');
        const noAuth = res && res.data && res.data.authNote === 'no-auth-account';
        Notifs.success(isRemoved
          ? `${name} reinstated${noAuth ? '' : ' — they can sign in again'}.`
          : `${name} removed and signed out${noAuth ? ' (no linked sign-in account)' : ''}.`);
        window.renderTeamTab();
      } catch (err) {
        btn.disabled = false;
        Notifs.showToast('Error: ' + (err.message || err), 'error');
      }
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
  // TWO tiers, not one. The old single `pres` predicate
  // (president|manager|finance) was wrong in both directions:
  //   • it EXCLUDED the Corporate Secretary, whom firestore.rules explicitly
  //     allows to read/write any attendance record (isOpsAdmin) and to approve
  //     extensions (isAdmin) — so the one oversight role saw only their own
  //     calendar, silently, with no error to report.
  //   • it INCLUDED finance on the extension Approve/Deny buttons, which
  //     `attendance_extensions` update = isAdmin() denies — a dead control the
  //     handler below never surfaced, because it has no error branch.
  // canSeeAll  → mirrors isOpsAdmin(): employee picker + day-edit pencil.
  // canApprove → mirrors isAdmin():    the extension approve/deny queue.
  const canSeeAll  = (typeof window.isOpsPriv   === 'function') ? window.isOpsPriv()   : (currentRole === 'president' || currentRole === 'manager' || currentRole === 'finance');
  const canApprove = (typeof window.isAdminPriv === 'function') ? window.isAdminPriv() : (currentRole === 'president' || currentRole === 'manager');

  c.innerHTML = `
    <div class="page-header">
      <h2>${emojiIcon('📅',20)} Attendance</h2>
      ${canSeeAll ? `<select id="att-emp-select" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px"><option value="">Loading…</option></select>` : ''}
    </div>
    ${window.sopPanel('How Attendance works', [
      'Time In happens on your Dashboard, 7:00–9:00 AM only — this calendar just shows the recorded history.',
      'Green = Present (100%), half-circle = Half Day (50%), red = Absent. Tap the pencil on a day to correct it (admins only).',
      'Missed the window? Request a Time In extension from your Dashboard; admins approve pending extensions from the banner above.'
    ], {open:false})}
    ${canApprove ? `<div id="att-ext-requests" style="margin-bottom:14px"></div>` : ''}
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <button class="btn-secondary btn-sm" id="att-prev-month" aria-label="Previous month">‹</button>
      <span id="att-month-label" style="font-weight:700;font-size:15px;min-width:140px;text-align:center"></span>
      <button class="btn-secondary btn-sm" id="att-next-month" aria-label="Next month">›</button>
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
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  let targetUid = currentUser.uid;
  let targetName = userProfile.displayName || currentUser.email;
  // Anchor the default view month to Manila's current calendar month, not the
  // device's — otherwise opening the page near midnight abroad shows the wrong month.
  const bizToday = window.bizDate(); // "YYYY-MM-DD" in Manila
  let viewYear  = parseInt(bizToday.slice(0,4), 10);
  let viewMonth = parseInt(bizToday.slice(5,7), 10) - 1;

  let empList = [];
  if (canSeeAll) {
    const sel = document.getElementById('att-emp-select');
    try {
      const usersSnap = typeof dbCachedGet === 'function'
        ? await dbCachedGet('users', () => db.collection('users').get(), 60000)
        : await db.collection('users').get();
      empList = usersSnap.docs.map(d=>({id:d.id,...d.data()}))
        .filter(u => u.role !== 'partner');
      sel.innerHTML = empList.map(u=>`<option value="${u.id}">${escHtml(u.displayName||u.email)}</option>`).join('');
      sel.value = currentUser.uid;
      sel.addEventListener('change', () => {
        const picked = empList.find(u=>u.id===sel.value);
        targetUid  = sel.value;
        targetName = picked?.displayName || picked?.email || '';
        renderAttMonth();
      });
    } catch (err) {
      sel.innerHTML = '<option value="">Failed to load employees</option>';
      Notifs.showToast('Could not load employee list: ' + (err.message||err), 'error');
    }
  }

  // ── Extension requests (isAdmin tier: president/manager/secretary) ──
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
        <div class="card-header"><h3 style="color:rgba(255,159,10,.9)">${emojiIcon('⏰',20)} Pending Extension Requests (${requests.length})</h3></div>
        <div class="card-body" style="padding:0">
          <div class="table-wrap"><table class="data-table table-cards">
            <thead><tr><th>Employee</th><th>Date</th><th>Requested</th><th></th></tr></thead>
            <tbody>${requests.map(r=>`<tr>
              <td class="tc-name"><strong>${escHtml(r.userName||'—')}</strong></td>
              <td class="tc-detail" data-label="Date">${r.date||'—'}</td>
              <td class="tc-detail" data-label="Requested">${r.requestedAt ? new Date(r.requestedAt.toDate()).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
              <td class="tc-actions" style="white-space:nowrap">
                <button class="btn-primary btn-sm ext-approve-btn" data-id="${r.id}" data-uid="${r.uid}" data-name="${escHtml(r.userName||'')}">${emojiIcon('✓',16)} Approve</button>
                <button class="btn-danger btn-sm ext-deny-btn" data-id="${r.id}" data-uid="${r.uid}" data-name="${escHtml(r.userName||'')}" style="margin-left:4px">${emojiIcon('✕',16)} Deny</button>
              </td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>`;
    if (window.lucide) lucide.createIcons({ nodes: [extEl] });

    extEl.querySelectorAll('.ext-approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Approving…';
        await window.approveAttendanceExtension(btn.dataset.id, btn.dataset.uid, btn.dataset.name);
        Notifs.success(`Extension approved for ${btn.dataset.name||'employee'}`);
        loadExtensionRequests();
      });
    });

    extEl.querySelectorAll('.ext-deny-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await confirmDialog({ message: 'Deny this extension request?' }))) return;
        btn.disabled = true;
        await window.denyAttendanceExtension(btn.dataset.id, btn.dataset.uid, btn.dataset.name);
        Notifs.error('Extension denied');
        loadExtensionRequests();
      });
    });
  }

  if (canApprove) loadExtensionRequests();

  async function renderAttMonth() {
    const calEl  = document.getElementById('att-calendar');
    const sumEl  = document.getElementById('att-summary');
    calEl.innerHTML = window.skeletonHtml('rows');
    const label = new Date(viewYear, viewMonth).toLocaleString('en-PH',{month:'long',year:'numeric'});
    document.getElementById('att-month-label').textContent = label;

    const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
    const mm = String(viewMonth+1).padStart(2,'0');
    const monthStart = `${viewYear}-${mm}-01`;
    // Build the last-day string directly — toISOString() on a local midnight Date
    // shifts back a day in +offset timezones (Manila +8) and broke the range query.
    const monthEnd   = `${viewYear}-${mm}-${String(daysInMonth).padStart(2,'0')}`;
    let snap;
    try {
      snap = await db.collection('attendance').doc(targetUid).collection('records')
        .where(firebase.firestore.FieldPath.documentId(),'>=',monthStart)
        .where(firebase.firestore.FieldPath.documentId(),'<=',monthEnd).get();
    } catch (err) {
      calEl.innerHTML =
        '<div class="empty-state"><div class="empty-icon">' + emojiIcon('⚠️',44) + '</div>' +
        '<h4>Something went wrong</h4><p>' + escHtml(err && err.message ? err.message : String(err)) + '</p>' +
        '<button type="button" class="btn-secondary btn-sm" id="att-retry-btn" style="margin-top:14px">Retry</button></div>';
      if (window.lucide) lucide.createIcons({ nodes: [calEl] });
      document.getElementById('att-retry-btn')?.addEventListener('click', () => renderAttMonth());
      return;
    }
    const records = {};
    snap.docs.forEach(d => { records[d.id] = d.data(); });

    const firstDay    = window.bizDow(monthStart);
    const todayStr    = window.bizDate();
    const canEdit     = canSeeAll;
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
      const dow      = window.bizDow(dateStr);
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
        ${holiday?`<span class="att-mark" style="font-size:9px;color:rgba(180,140,0,1)">${emojiIcon('🎌',9)}</span>`:
          status==='present'?`<span class="att-mark">${emojiIcon('check',14)}</span>`:
          status==='half'?'<span class="att-mark">½</span>':
          status==='absent'?`<span class="att-mark">${emojiIcon('x',14)}</span>`:
          status==='leave'?`<span class="att-mark" style="color:${window.attKindBadge('leave').c}">${window.attKindBadge('leave').m}</span>`:
          status==='unpaid-leave'?`<span class="att-mark" style="color:${window.attKindBadge('unpaid-leave').c}">${window.attKindBadge('unpaid-leave').m}</span>`:''}
        ${canEdit&&!isNoWork?`<button class="att-edit-btn att-edit-visible" data-date="${dateStr}" title="Edit" aria-label="Edit ${dateStr} attendance">${emojiIcon('✎',16)}</button>`:''}
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
          // v13 Phase 17 — pre-fill via attRecKind so a leave/unpaid-leave day shows
          // as 'leave' rather than silently pre-selecting 'present'/'absent'.
          const recKind = window.attRecKind ? window.attRecKind(cur) : null;
          const isLeaveDay = recKind === 'leave' || recKind === 'unpaid-leave';
          const curStatus = isLeaveDay ? 'leave' : (cur?.fullTime ? 'present' : cur?.loginTime ? 'half' : 'absent');
          const _panel = openPage(`${emojiIcon('✎',16)} Attendance — ${date}`, `
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Employee: <strong>${escHtml(targetName)}</strong></p>
            <div class="form-group"><label>Status</label>
              <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
                <button class="att-status-opt ${curStatus==='present'?'att-opt-active':''}" data-val="present" style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${curStatus==='present'?'#30d158':'var(--border)'};background:${curStatus==='present'?'rgba(48,209,88,.15)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer">${emojiIcon('✓',13)} Present</button>
                <button class="att-status-opt ${curStatus==='half'?'att-opt-active':''}" data-val="half" style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${curStatus==='half'?'#ffaa00':'var(--border)'};background:${curStatus==='half'?'rgba(255,170,0,.15)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer">½ Half Day</button>
                <button class="att-status-opt ${curStatus==='absent'?'att-opt-active':''}" data-val="absent" style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${curStatus==='absent'?'#ff453a':'var(--border)'};background:${curStatus==='absent'?'rgba(255,69,58,.12)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer">${emojiIcon('✗',13)} Absent</button>
                ${isLeaveDay?`<button class="att-status-opt ${curStatus==='leave'?'att-opt-active':''}" data-val="leave" style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${curStatus==='leave'?'#af52de':'var(--border)'};background:${curStatus==='leave'?'rgba(175,82,222,.15)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer">${emojiIcon('calendar',13)} Leave</button>`:''}
              </div>
              <input type="hidden" id="att-status-sel" value="${curStatus}"/>
              ${isLeaveDay?`<p style="font-size:11px;color:var(--text-muted);margin-top:6px">This is an approved leave day. Switching to Present/Half/Absent will convert it and clear the leave link.</p>`:''}
            </div>
            <div class="form-group" style="margin-top:12px"><label>Note (optional)</label><input id="att-note" value="${escHtml(cur?.note||'')}" placeholder="e.g. sick leave, official business"/></div>
            ${cur?.editedBy?`<p style="font-size:11px;color:var(--text-muted);margin-top:8px">Last edited by admin</p>`:''}
          `, `<button class="btn-primary" id="save-att-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
          if (window.lucide) lucide.createIcons();

          // Option button toggle
          const colors = {present:'#30d158',half:'#ffaa00',absent:'#ff453a',leave:'#af52de'};
          const bgs    = {present:'rgba(48,209,88,.15)',half:'rgba(255,170,0,.15)',absent:'rgba(255,69,58,.12)',leave:'rgba(175,82,222,.15)'};
          // ⚠ SCOPED TO THIS PANEL, NOT document.
          // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
          // inside that window and two panels carry the same ids at once —
          // document.getElementById() returns the FIRST in document order, which is
          // the DYING one, so the handler binds to a button nobody can see and the
          // visible button does nothing (and a save can read the PREVIOUS record's
          // field values). Reported by the Corporate Secretary 2026-08-10.
          _panel.querySelectorAll('.att-status-opt').forEach(optBtn => {
            optBtn.addEventListener('click', () => {
              _panel.querySelector('#att-status-sel').value = optBtn.dataset.val;
              _panel.querySelectorAll('.att-status-opt').forEach(b => {
                b.style.borderColor = 'var(--border)';
                b.style.background = 'var(--surface)';
              });
              optBtn.style.borderColor = colors[optBtn.dataset.val];
              optBtn.style.background  = bgs[optBtn.dataset.val];
            });
          });

          _panel.querySelector('#save-att-btn').addEventListener('click', async () => {
            const status = _panel.querySelector('#att-status-sel').value;
            const note   = _panel.querySelector('#att-note').value.trim();
            const ref = db.collection('attendance').doc(targetUid).collection('records').doc(date);
            const FV  = firebase.firestore.FieldValue;
            // Guard: converting an approved leave day into a worked/absent day needs
            // explicit confirmation, since it silently drops the leave link otherwise.
            let clearLeaveFields = false;
            if (isLeaveDay && status !== 'leave') {
              const ok = await window.confirmDialog({ message: 'This day is an approved leave. Convert it to a worked/absent day? This clears the leave link.' });
              if (!ok) return;
              clearLeaveFields = true;
            }
            // Always write attendanceScore too: payroll and EOM read it FIRST (before
            // the fullTime/loginTime fallbacks), so an edit that leaves an old score
            // behind silently never reaches pay.
            const leaveClear = clearLeaveFields ? { leaveType: FV.delete(), leaveReqId: FV.delete() } : {};
            if (status==='present')
              await ref.set({date,uid:targetUid,loginTime:firebase.firestore.Timestamp.fromDate(new Date()),fullTime:true,status:'present',attendanceScore:1.0,note,editedBy:currentUser.uid,editedAt:FV.serverTimestamp(),...leaveClear},{merge:true});
            else if (status==='half')
              await ref.set({date,uid:targetUid,loginTime:firebase.firestore.Timestamp.fromDate(new Date()),fullTime:false,status:'half',attendanceScore:0.5,note,editedBy:currentUser.uid,editedAt:FV.serverTimestamp(),...leaveClear},{merge:true});
            else if (status==='leave')
              // Leave selected but unchanged (option only shown when already a leave day) — no-op besides note.
              await ref.set({date,uid:targetUid,note,editedBy:currentUser.uid,editedAt:FV.serverTimestamp()},{merge:true});
            else
              // Soft-archive instead of deleting: preserve the audit trail payroll
              // depends on. Clear time markers so downstream reads classify as absent.
              await ref.set({date,uid:targetUid,status:'absent',fullTime:false,loginTime:FV.delete(),attendanceScore:0,note,editedBy:currentUser.uid,editedAt:FV.serverTimestamp(),...leaveClear},{merge:true});
            // Refresh in-memory copy so the calendar re-renders with the new state
            renderAttMonth();
            closeModal();
            Notifs.success('Attendance updated!');
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
    c.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('🔒',44)}</div><h4>Not available</h4><p>Holidays admin is finance/admin only.</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    return;
  }

  let year = window._holidaysAdminYear || window.bizYear();

  async function renderYear(y) {
    year = y;
    window._holidaysAdminYear = y;
    c.innerHTML = window.skeletonHtml('rows');
    if (typeof window.loadHolidayOverrides === 'function') {
      await window.loadHolidayOverrides([y]);
    }
    const merged    = typeof getPHHolidays === 'function' ? getPHHolidays(y) : {};
    const overrides = (window._holidayOverrides && window._holidayOverrides[y]) || {};
    const dates     = Object.keys(merged).sort();

    c.innerHTML = `
      <div class="page-header">
        <h2>${emojiIcon('📅',20)} Holidays Admin</h2>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn-secondary btn-sm" id="hol-prev-year" aria-label="Previous year">‹</button>
          <strong style="min-width:48px;text-align:center;display:inline-block">${y}</strong>
          <button class="btn-secondary btn-sm" id="hol-next-year" aria-label="Next year">›</button>
          <button class="btn-primary btn-sm" id="hol-add-btn" style="margin-left:8px">＋ Add / Edit</button>
        </div>
      </div>
      <div class="card"><div class="card-header"><h3>Holidays — ${y}</h3></div>
        <div class="card-body" style="padding:0">
          <div class="table-wrap"><table class="data-table table-cards">
            <thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Source</th><th></th></tr></thead>
            <tbody>
              ${dates.length ? dates.map(d => {
                const h = merged[d];
                const isOverride = Object.prototype.hasOwnProperty.call(overrides, d);
                return `<tr>
                  <td class="tc-name">${escHtml(d)}</td>
                  <td class="tc-detail" data-label="Name">${escHtml(h.name||'')}</td>
                  <td class="tc-detail" data-label="Type"><span class="badge ${h.type==='regular'?'badge-green':'badge-orange'}">${escHtml(h.type||'')}</span></td>
                  <td class="tc-detail" data-label="Source">${isOverride ? '<span class="badge badge-purple">override</span>' : '<span class="badge badge-gray">base</span>'}</td>
                  <td class="tc-actions" style="white-space:nowrap">
                    <button class="btn-secondary btn-sm hol-edit-btn" data-date="${escHtml(d)}">Edit</button>
                    <button class="btn-danger btn-sm hol-remove-btn" data-date="${escHtml(d)}" style="margin-left:4px">Remove</button>
                  </td>
                </tr>`;
              }).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No holidays for ${y}.</td></tr>`}
            </tbody>
          </table></div>
        </div>
      </div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });

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
      Notifs.success(value === null ? 'Holiday removed for '+year : 'Holiday saved for '+year);
      renderYear(year);
    } catch (ex) {
      Notifs.showToast('Save failed: '+(ex.message||ex.code), 'error');
    }
  }

  function openHolidayModal(date, existing) {
    const _panel = openPage(date ? `${emojiIcon('✏️',16)} Edit Holiday` : '＋ Add Holiday', `
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
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
    // inside that window and two panels carry the same ids at once —
    // document.getElementById() returns the FIRST in document order, which is
    // the DYING one, so the handler binds to a button nobody can see and the
    // visible button does nothing (and a save can read the PREVIOUS record's
    // field values). Reported by the Corporate Secretary 2026-08-10.
    _panel.querySelector('#hol-save-btn').addEventListener('click', async () => {
      const d = _panel.querySelector('#hol-date').value || date;
      const name = _panel.querySelector('#hol-name').value.trim();
      const type = _panel.querySelector('#hol-type').value;
      const err = _panel.querySelector('#hol-err');
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
  c.innerHTML = window.skeletonHtml('rows');

  try {
    if (pres) {
      await renderCashAdvanceAdmin(c);
    } else {
      await renderCashAdvanceEmployee(c);
    }
  } catch (err) {
    c.innerHTML =
      '<div class="empty-state"><div class="empty-icon">' + emojiIcon('⚠️',44) + '</div>' +
      '<h4>Something went wrong</h4><p>' + escHtml(err && err.message ? err.message : String(err)) + '</p>' +
      '<button type="button" class="btn-secondary btn-sm" id="ca-retry-btn" style="margin-top:14px">Retry</button></div>';
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    document.getElementById('ca-retry-btn')?.addEventListener('click', () => window.renderCashAdvancePage());
  }
};

async function renderCashAdvanceEmployee(c) {
  // 8-point #3 (Wave 7 Pass 7) — this fetch used to swallow errors into
  // {docs:[]}, so a permission/network failure rendered identically to "no
  // cash advances yet" instead of reaching renderCashAdvancePage's existing
  // try/catch (which already has a proper "Something went wrong — Retry"
  // block below). Letting it throw is the fix — no swallow.
  const snap = await db.collection('cash_advances').where('userId','==',currentUser.uid).get();
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
      <h2>${emojiIcon('💸',20)} Cash Advance</h2>
      <button class="btn-primary btn-sm" id="new-ca-btn">+ Request</button>
    </div>
    ${totalBalance>0?`
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card red"><div class="kpi-label">Outstanding Balance</div><div class="kpi-value" style="font-size:15px">&#8369;${fmtN(totalBalance)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Monthly Due</div><div class="kpi-value" style="font-size:15px">&#8369;${fmtN(totalMonthly)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Active CA's</div><div class="kpi-value">${active.length}</div></div>
    </div>`:''}
    ${pending.length?`<div class="alert-banner alert-warn" style="margin-bottom:12px"><span>&#x23F3; You have <strong>${pending.length}</strong> pending request${pending.length>1?'s':''} awaiting approval.</span></div>`:''}
    ${window.chipTabs([
      {key:'active', label:"Active Loans / CA's"},
      {key:'all',    label:'All Records'}
    ], 'active', {cls:'ca-tabs'})}
    <div id="ca-list" style="margin-top:14px"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  const renderTab = (sub) => {
    const list = sub === 'active'
      ? advances.filter(a => (a.status === 'approved' && (a.balance||0) > 0) || a.status === 'pending')
      : advances;
    renderCAEmployeeCards(list, document.getElementById('ca-list'));
  };

  renderTab('active');
  document.getElementById('new-ca-btn').addEventListener('click', () => window.CashAdvance.openRequestForm());
  window.bindChipTabs(c.querySelector('.ca-tabs'), key => renderTab(key));
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
    // Phase 116: unify onto the shared 'ca' vocab (js/ui-status-meta.js) —
    // same branch order as the old statusColor/statusLabel ternaries, so a
    // record hits the same bucket (and effectively the same color) as
    // before: approved+balance>0 → 'active', paid → 'paid', pending →
    // 'pending', anything else → 'rejected'.
    // M11 fix: approved+balance<=0 (fully paid but status never flipped to
    // 'paid') now also buckets to 'paid' instead of falling through to 'rejected'.
    const caId = a.status==='approved'&&(balance||0)>0 ? 'active' : (a.status==='paid'||(a.status==='approved'&&(balance||0)<=0)) ? 'paid' : a.status==='pending' ? 'pending' : 'rejected';
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
        ${window.statusBadge2('ca', caId, {fontSize:'11px'})}
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
  // 8-point #3 (Wave 7 Pass 7) — same fix as renderCashAdvanceEmployee above:
  // don't swallow the primary fetch's errors into {docs:[]}; let them reach
  // renderCashAdvancePage's try/catch + Retry.
  const [snap, usersSnap] = await Promise.all([
    db.collection('cash_advances').orderBy('createdAt','desc').limit(200).get(),
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
      <h2>${emojiIcon('💸',20)} Cash Advances</h2>
      ${currentRole==='president'?`<button class="btn-primary btn-sm" id="add-ca-for-btn">+ Add Record</button>`:''}
    </div>
    <div class="kpi-row">
      <div class="kpi-card warn"><div class="kpi-label">Pending</div><div class="kpi-value">${pending.length}</div></div>
      <div class="kpi-card red"><div class="kpi-label">Outstanding</div><div class="kpi-value" style="font-size:14px">₱${fmtN(totalOut)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Records</div><div class="kpi-value">${advances.length}</div></div>
    </div>
    <div id="ca-list"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  renderCAList(advances, document.getElementById('ca-list'), true);

  document.getElementById('add-ca-for-btn')?.addEventListener('click', () => openPresidentCashAdvanceModal(users));
}

function renderCAList(advances, container, isAdmin) {
  if (!advances.length) {
    container.innerHTML = window.renderEmptyState({icon:'💸', title:'No cash advances yet', hint:'Requests you file, or your team files, will show up here for tracking.'});
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    return;
  }
  container.innerHTML = advances.map(a => {
    const interest  = a.interest || 0;
    const terms     = a.terms || 1;
    const monthly   = a.monthlyPayment || 0;
    const balance   = typeof a.balance !== 'undefined' ? a.balance : a.amount;
    const totalPay  = a.totalPayable || a.amount || 0;
    const paidAmt   = Math.max(0, totalPay - (balance||0));
    const pct       = totalPay ? Math.min(100, Math.round((paidAmt/totalPay)*100)) : 0;
    return `
    <div class="ca-card">
      <div class="ca-card-header">
        ${isAdmin?`<div class="ca-card-name">${escHtml(a.userName||'Employee')} <span style="font-size:11px;color:var(--text-muted)">${a.employeeId||''}</span>${a.private?`<span class="badge badge-red" style="font-size:10px;margin-left:4px">${emojiIcon('🔒',10)} Private</span>`:''}</div>`:''}
        <div class="ca-amount">₱${fmtN(a.amount)}</div>
        ${window.statusBadge2('ca', a.status||'pending')}
      </div>
      <div class="ca-card-body">
        <div class="ca-detail"><span>Reason</span><span>${a.reason?escHtml(a.reason):'—'}</span></div>
        <div class="ca-detail"><span>Terms</span><span>${terms} month${terms>1?'s':''}${interest?` · ${interest}% interest/mo`:''}</span></div>
        <div class="ca-detail"><span>Monthly Payment</span><span style="font-weight:700">₱${fmtN(monthly)}</span></div>
        <div class="ca-detail"><span>Total Payable</span><span>₱${fmtN(a.totalPayable || a.amount || 0)}</span></div>
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
        <button class="btn-primary btn-sm ca-approve-btn" data-id="${a.id}">${emojiIcon('✓',16)} Approve</button>
        <button class="btn-secondary btn-sm ca-reject-btn" data-id="${a.id}" style="color:var(--danger)">${emojiIcon('✗',16)} Reject</button>
        ${isRealPresident()?`<button class="btn-secondary btn-sm ca-delete-btn" data-id="${a.id}" style="color:var(--danger);margin-left:auto">${emojiIcon('🗑',16)} Delete</button>`:''}
      </div>`:''}
      ${isAdmin&&a.status==='approved'&&(a.balance||0)>0?`
      <div class="ca-card-actions">
        <button class="btn-secondary btn-sm ca-payment-btn" data-id="${a.id}">Record Payment</button>
        ${isRealPresident()?`<button class="btn-secondary btn-sm ca-delete-btn" data-id="${a.id}" style="color:var(--danger);margin-left:auto">${emojiIcon('🗑',16)} Delete</button>`:''}
      </div>`:''}
      ${isAdmin&&(a.status==='rejected'||a.status==='paid')&&isRealPresident()?`
      <div class="ca-card-actions" style="justify-content:flex-end">
        <button class="btn-secondary btn-sm ca-delete-btn" data-id="${a.id}" style="color:var(--danger)">${emojiIcon('🗑',16)} Delete</button>
      </div>`:''}
    </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  // v12 WS22 — all three route through the one shared CashAdvance service
  // (this page already had the safest transaction-guarded versions; now every
  // other CA surface in the app matches this same safety level).
  container.querySelectorAll('.ca-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => window.CashAdvance.openApproveModal(btn.dataset.id, () => window.renderCashAdvancePage()));
  });

  container.querySelectorAll('.ca-reject-btn').forEach(btn => btn.addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    try { await window.CashAdvance.reject(e.currentTarget.dataset.id); Notifs.error('Rejected.'); }
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
    Notifs.success('Record deleted.');
    window.renderCashAdvancePage();
  }));
}

// openCashAdvanceModal() retired (v12 WS22) — its form + write now live as the
// ONE shared window.CashAdvance.openRequestForm()/request() in js/config.js.
// The employee-facing interest checkbox is gone too: interest is now an
// approval-time decision, never an employee choice (WS22 decision 3).

// Canonical: delegates to window.fmtN2 (js/config.js). Same contract, unchanged output.
const fmtN = window.fmtN2;

// President-only: record a cash advance for any employee (pre-approved)
// `users` is optional — the Finance CA tab (departments.js) calls this with no
// args, so fetch the directory ourselves when it's missing (same cached source
// renderCashAdvanceAdmin uses).
async function openPresidentCashAdvanceModal(users) {
  if (!users) {
    const usersSnap = typeof dbCachedGet === 'function'
      ? await dbCachedGet('users', () => db.collection('users').get(), 60000)
      : await db.collection('users').get().catch(() => ({ docs: [] }));
    users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  const employees = users.filter(u => u.role !== 'partner' && u.id !== currentUser.uid && u.uid !== currentUser.uid);
  const empOptions = employees.map(u =>
    `<option value="${u.id}">${escHtml(u.displayName||u.email)} (${u.role||'employee'})</option>`
  ).join('');

  const _panel = openPage('Record Cash Advance for Employee', `
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
    <label class="check-row" style="display:flex;align-items:flex-start;margin-top:6px">
      <input type="checkbox" id="pca-private" checked/>
      <span style="font-size:13px">${emojiIcon('🔒',13)} Private — visible only to this employee, president &amp; finance</span>
    </label>
  `, `<button class="btn-primary" id="save-pca-btn">Save Record</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
  // inside that window and two panels carry the same ids at once —
  // document.getElementById() returns the FIRST in document order, which is
  // the DYING one, so the handler binds to a button nobody can see and the
  // visible button does nothing (and a save can read the PREVIOUS record's
  // field values). Reported by the Corporate Secretary 2026-08-10.
  _panel.querySelector('#save-pca-btn').addEventListener('click', () => window.busy(_panel.querySelector('#save-pca-btn'), async () => {
    const uid     = _panel.querySelector('#pca-uid').value;
    const amount  = parseFloat(_panel.querySelector('#pca-amount').value)||0;
    const monthly = parseFloat(_panel.querySelector('#pca-monthly').value)||0;
    const terms   = parseInt(_panel.querySelector('#pca-terms').value)||1;
    const date    = _panel.querySelector('#pca-date').value;
    const reason  = _panel.querySelector('#pca-reason').value.trim();
    const isPriv  = _panel.querySelector('#pca-private').checked;

    if (!uid)    { Notifs.showToast('Please select an employee.','error'); return; }
    if (!amount) { Notifs.showToast('Enter a valid amount.','error'); return; }

    const emp = employees.find(u => u.id === uid);
    // Route through the single CA service (window.CashAdvance) instead of a
    // hand-rolled write: request() creates the pending doc, approve() finalizes
    // it (rounds monthly first, derives totalPayable from the rounded monthly —
    // no centavo drift). The President's "Monthly Payment" field is preserved by
    // reverse-deriving the interest rate that reproduces monthly×terms as the total.
    const desiredTotal = monthly > 0 ? monthly * terms : amount;
    let interestPct = 0;
    if (desiredTotal > amount && amount > 0 && terms > 0) {
      interestPct = (Math.pow(desiredTotal / amount, 1 / terms) - 1) * 100;
    }
    try {
      const id = await window.CashAdvance.request({
        amount, terms, reason, dateNeeded: date,
        userId: uid, userName: emp?.displayName || emp?.email || uid,
        employeeId: emp?.employeeId || uid, private: isPriv
      });
      await window.CashAdvance.approve(id, { interestPct });
    } catch (err) {
      Notifs.showToast(err.message || 'Could not record cash advance.', 'error');
      return;
    }
    closeModal();
    Notifs.success('Cash advance recorded!');
    window.renderCashAdvancePage();
  }));
}

// Company Overview screens — renderCompanyOverviewNew/renderPresidentMessageCard
// DELETED, Wave 7 Pass 10 cleanup (2026-08-03). Verified zero callers (grepped
// clean across the whole tree): the 'company' nav case in app.js's navigateTo
// routes to a DIFFERENT, same-purpose live screen (js/screens/dashboards.js's
// renderCompany/renderCompanyOverview). This pair was already flagged dead by
// this file's own header (Wave 7 Pass 7) and by modules.js's header before
// that — confirmed still dead, both before and after those moves.


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
  // 8-point #8 (Wave 7 Pass 7) — one sopPanel step list, shown on both
  // renderLeaveEmployee and renderLeaveAdmin (same pattern tasks.js uses for
  // its two chip-tab sub-renders: one shared array, rendered wherever the
  // page-header is).
  const LEAVE_SOP_STEPS = [
    'Tap "+ Request Leave", pick a type — Vacation and Sick draw down your balance; Emergency and Unpaid don\'t — and file it.',
    'Finance/admin approve or reject. An approval automatically decrements your balance and notifies you either way.',
    'Vacation and Sick balances accrue annually; admins run Annual Accrual or make a one-off adjustment from Leave Management.'
  ];
  // Leave status badges go through the unified status registry (Phase 116):
  // call window.statusBadge2('leave', status) / window.statusBadgeClass('leave', status)
  // directly. The old local lvBadge() shim was deleted (Wave 8 cleanup, 2026-08-05)
  // — it had zero callers tree-wide, in this file or any other.
  const esc = s => (window.escHtml ? window.escHtml(s) : (s==null?'':String(s)));

  // The Sundays-only workingDays() helper was deleted here (Wave 8 cleanup,
  // 2026-08-05): leaveWorkingDays below fully supersedes it (same signature,
  // also excludes PH holidays to match payroll's countWorkDays) and it had
  // zero callers tree-wide.
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
      if(window.bizDow(ds)!==0 && !hol[ds] && !holNext[ds]) n++;
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
      <span style="font-size:20px">${emojiIcon(t.icon,20)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${t.label} · ${r.days||0} day${(r.days||0)!==1?'s':''}${showWho?` — ${esc(r.userName||'')}`:''}</div>
        <div style="font-size:11px;color:var(--text-muted)">${esc(r.startDate||'')} → ${esc(r.endDate||'')}${r.reason?` · ${esc(r.reason)}`:''}</div>
      </div>
      ${window.statusBadge2('leave', r.status||'pending')}
    </div>`;
  }

  window.renderLeavePage = async function(container){
    const c = container || document.getElementById('page-content');
    if(!c) return;
    // isOpsPriv() mirrors firestore.rules' isOpsAdmin() — president, manager,
    // Corporate Secretary and finance. The old inline list omitted the
    // secretary, so the HR hub's "Leave — requests, approvals & balances" card
    // silently dropped them onto their OWN leave page, even though the rules
    // (leave_requests update = isOpsAdmin) and APPROVAL_CAPS both authorise
    // them to approve. Same lost-capability shape as the Attendance page.
    const isAdmin = (typeof window.isOpsPriv === 'function')
      ? window.isOpsPriv()
      : (currentRole==='president'||currentRole==='manager'||currentRole==='finance');
    // 8-point #3 (Wave 7 Pass 7) — this page had no error boundary at all:
    // renderLeaveEmployee/renderLeaveAdmin's primary fetch swallowed errors
    // into {docs:[]}, so a permission/network failure rendered identically
    // to "no leave requests" with no way to retry. Same try/catch + Retry
    // idiom as renderCashAdvancePage right above it in this file.
    try {
      return isAdmin ? await renderLeaveAdmin(c) : await renderLeaveEmployee(c);
    } catch (err) {
      c.innerHTML =
        '<div class="empty-state"><div class="empty-icon">' + emojiIcon('⚠️',44) + '</div>' +
        '<h4>Something went wrong</h4><p>' + esc(err && err.message ? err.message : String(err)) + '</p>' +
        '<button type="button" class="btn-secondary btn-sm" id="lv-retry-btn" style="margin-top:14px">Retry</button></div>';
      if (window.lucide) lucide.createIcons({ nodes: [c] });
      document.getElementById('lv-retry-btn')?.addEventListener('click', () => window.renderLeavePage(container));
    }
  };

  async function renderLeaveEmployee(c){
    c.innerHTML = window.skeletonHtml('rows');
    const [snap, bal] = await Promise.all([
      db.collection('leave_requests').where('userId','==',currentUser.uid).get(),
      getBalance(currentUser.uid),
    ]);
    const reqs = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const pending = reqs.filter(r=>r.status==='pending').length;
    c.innerHTML = `
      <div class="page-header"><h2>${emojiIcon('🌴',20)} My Leave</h2><button class="btn-primary btn-sm" id="new-leave-btn">+ Request Leave</button></div>
      ${window.sopPanel('How Leave works', LEAVE_SOP_STEPS, {open:false})}
      <div class="kpi-row" style="margin-bottom:14px">
        <div class="kpi-card green"><div class="kpi-label">Vacation left</div><div class="kpi-value">${bal.vacation||0}<span style="font-size:12px;font-weight:500"> days</span></div></div>
        <div class="kpi-card"><div class="kpi-label">Sick left</div><div class="kpi-value">${bal.sick||0}<span style="font-size:12px;font-weight:500"> days</span></div></div>
        <div class="kpi-card ${pending?'accent':''}"><div class="kpi-label">Pending</div><div class="kpi-value">${pending}</div></div>
      </div>
      <div class="card"><div class="card-header"><h3>My Requests</h3></div><div class="card-body" style="padding:0">
        ${!reqs.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('🌴',44)}</div><h4>No leave requests yet</h4><p>Tap "Request Leave" to file one.</p></div>`:
          reqs.map(r=>leaveRow(r,false)).join('')}
      </div></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    document.getElementById('new-leave-btn').onclick = ()=>openLeaveModal(bal, c);
  }

  async function renderLeaveAdmin(c){
    c.innerHTML = window.skeletonHtml('rows');
    const snap = await db.collection('leave_requests').orderBy('createdAt','desc').limit(200).get();
    const reqs = snap.docs.map(d=>({id:d.id,...d.data()}));
    const pending = reqs.filter(r=>r.status==='pending');
    const approved = reqs.filter(r=>r.status==='approved').length;
    // Grant / accrual / holidays utilities. This used to be a hardcoded
    // president|manager|finance list that excluded the Corporate Secretary, on the
    // theory that only the approve-decrement path needed balance writes. Re-checked
    // against the boundary and the exclusion was wrong on all three buttons:
    //   • Adjust Balance      → leave_balances write   = isOpsAdmin()  (includes them)
    //   • Run Annual Accrual  → leave_accruals create/update + leave_balances write
    //                                                  = isOpsAdmin()  (includes them)
    //   • Manage Holidays     → settings_holidays write = isOpsAdmin() (includes them)
    // and firestore.rules' own isOpsAdmin() comment names leave and holidays as
    // "the Corporate Secretary's actual job". Manage Holidays was doubly wrong:
    // renderHolidaysAdmin (this file) and the Holidays Admin sidebar entry
    // (js/app.js) BOTH already admit them, so the button was hiding a page they
    // could reach one click away. isOpsPriv() is the client mirror of
    // isOpsAdmin(); using it keeps this in step with the rest of the HR /
    // attendance / leave surface instead of drifting again.
    // NOTE: this widens nothing on the MONEY tier — leave days are not pay, and
    // the money queues (cash advance, raises, payroll deletes) stay read-only for
    // them on their own screens.
    const canGrant = (typeof window.isOpsPriv === 'function')
      ? window.isOpsPriv()
      : ['president','manager','finance'].includes(currentRole);
    c.innerHTML = `
      <div class="page-header"><h2>${emojiIcon('🌴',20)} Leave Management</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${canGrant?`<button class="btn-secondary btn-sm" id="lv-accrue">↻ Run Annual Accrual</button><button class="btn-secondary btn-sm" id="lv-grant">＋ Adjust Balance</button><button class="btn-secondary btn-sm" id="lv-holidays">${emojiIcon('📅',16)} Manage Holidays</button>`:''}<button class="btn-secondary btn-sm" id="leave-csv">${emojiIcon('⬇',16)} CSV</button><button class="btn-secondary btn-sm" id="my-leave-btn">My Leave</button></div></div>
      ${window.sopPanel('How Leave works', LEAVE_SOP_STEPS, {open:false})}
      <div class="kpi-row" style="margin-bottom:14px">
        <div class="kpi-card ${pending.length?'accent':''}"><div class="kpi-label">Pending</div><div class="kpi-value">${pending.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Approved</div><div class="kpi-value">${approved}</div></div>
        <div class="kpi-card"><div class="kpi-label">Total Requests</div><div class="kpi-value">${reqs.length}</div></div>
      </div>
      ${pending.length?`<div class="card" style="margin-bottom:14px;border:1.5px solid var(--warning)"><div class="card-header"><h3>${emojiIcon('⏳',20)} Pending Approval</h3></div><div class="card-body" style="padding:0">
        ${pending.map(r=>`<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap">
          <span style="font-size:20px">${emojiIcon(leaveType(r.type).icon,20)}</span>
          <div style="flex:1;min-width:160px">
            <div style="font-size:13px;font-weight:600">${esc(r.userName||'Employee')} — ${leaveType(r.type).label} · ${r.days||0}d</div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(r.startDate||'')} → ${esc(r.endDate||'')}${r.reason?` · ${esc(r.reason)}`:''}</div>
          </div>
          <button class="btn-success btn-sm lv-approve" data-id="${r.id}">Approve</button>
          <button class="btn-secondary btn-sm lv-reject" data-id="${r.id}">Reject</button>
        </div>`).join('')}
      </div></div>`:''}
      <div class="card"><div class="card-header"><h3>All Requests</h3></div><div class="card-body" style="padding:0">
        ${!reqs.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('🌴',44)}</div><h4>No leave requests</h4></div>`:
          reqs.map(r=>leaveRow(r,true)).join('')}
      </div></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    document.getElementById('my-leave-btn').onclick = ()=>renderLeaveEmployee(c);
    document.getElementById('leave-csv')?.addEventListener('click',()=>window.exportCSV('leave-requests', reqs, [
      {key:'userName',label:'Employee'},{key:'type',label:'Type',get:r=>leaveType(r.type).label},{key:'days',label:'Days'},
      {key:'startDate',label:'Start'},{key:'endDate',label:'End'},{key:'status',label:'Status'},{key:'reason',label:'Reason'}]));
    c.querySelectorAll('.lv-approve').forEach(b=>b.addEventListener('click',()=>approveLeave(reqs.find(r=>r.id===b.dataset.id),c)));
    c.querySelectorAll('.lv-reject').forEach(b=>b.addEventListener('click',()=>rejectLeave(reqs.find(r=>r.id===b.dataset.id),c)));
    if(canGrant){
      // Re-audit 2026-08-03: renderHolidaysAdmin was fully built (add/edit/remove
      // PH holiday overrides per year, feeding getPHHolidays across attendance/
      // leave/payroll) but had no nav entry anywhere — app.js's navigateTo already
      // has a 'holidays' case, it just had nothing pointing at it. This is the
      // entry point.
      document.getElementById('lv-holidays')?.addEventListener('click', () => navigateTo('holidays'));
      document.getElementById('lv-accrue')?.addEventListener('click', async ()=>{
        const yr = window.LeaveAccrual.policyYear();
        if(!(await confirmDialog({ title:'Run Annual Accrual', message:`Grant / reset ${yr} leave balances for all employees?<br>Already-accrued employees are skipped (idempotent). Vacation ${window.LEAVE_POLICY.grants.vacation} / Sick ${window.LEAVE_POLICY.grants.sick} days.`, html:true }))) return;
        Notifs.info('Running annual accrual…');
        try{ const res=await window.LeaveAccrual.runAnnualAccrual();
          window.logAudit && window.logAudit('accrue','leave',yr,res);
          Notifs.success(`Accrual ${yr}: ${res.seeded} granted, ${res.skipped} skipped.`);
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
    const _panel = openPage('＋ Adjust Balance', `
      <div class="form-group"><label>Employee</label>
        <select id="lv-grant-uid" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          ${users.map(u=>`<option value="${u.id}">${esc(u.displayName||u.email||u.id)}</option>`).join('')}
        </select>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin:-4px 0 10px" id="lv-grant-current">Loading current balance…</div>
      <div class="form-row">
        <div class="form-group"><label>Vacation days (new total)</label><input id="lv-grant-vac" type="number" inputmode="decimal" min="0" step="0.5" value="0"/></div>
        <div class="form-group"><label>Sick days (new total)</label><input id="lv-grant-sick" type="number" inputmode="decimal" min="0" step="0.5" value="0"/></div>
      </div>
      <div id="lv-grant-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="lv-grant-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    // Re-audit 2026-08-03: the inputs used to always default to 0, and the save
    // handler does an absolute .set() (not an increment) — an admin who meant
    // "grant 2 more vacation days" and typed 2 would silently wipe any existing
    // unused balance down to 2. Prefill with the employee's CURRENT balance (so
    // an unedited save is a true no-op) and label the fields "new total" so the
    // overwrite semantics are visible instead of a silent trap. The write itself
    // (.set with merge:true) is UNCHANGED — this only fixes what the admin sees
    // before they commit it.
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
    // inside that window and two panels carry the same ids at once —
    // document.getElementById() returns the FIRST in document order, which is
    // the DYING one, so the handler binds to a button nobody can see and the
    // visible button does nothing (and a save can read the PREVIOUS record's
    // field values). Reported by the Corporate Secretary 2026-08-10.
    const uidSel = _panel.querySelector('#lv-grant-uid');
    const loadCurrent = async () => {
      const uid = uidSel.value;
      const hint = _panel.querySelector('#lv-grant-current');
      const vacInput = _panel.querySelector('#lv-grant-vac'), sickInput = _panel.querySelector('#lv-grant-sick');
      if (!uid) { hint.textContent = ''; return; }
      hint.textContent = 'Loading current balance…';
      try {
        const snap2 = await db.collection('leave_balances').doc(uid).get();
        const d = snap2.exists ? snap2.data() : {};
        const curVac = d.vacation || 0, curSick = d.sick || 0;
        hint.textContent = `Current balance: ${curVac} vacation, ${curSick} sick`;
        vacInput.value = curVac; sickInput.value = curSick;
      } catch (_) { hint.textContent = ''; }
    };
    uidSel.addEventListener('change', loadCurrent);
    loadCurrent();
    _panel.querySelector('#lv-grant-save').addEventListener('click', async ()=>{
      const uid = _panel.querySelector('#lv-grant-uid').value;
      const vacation = Math.max(0, Number(_panel.querySelector('#lv-grant-vac').value)||0);
      const sick = Math.max(0, Number(_panel.querySelector('#lv-grant-sick').value)||0);
      const err = _panel.querySelector('#lv-grant-err');
      if(!uid){ err.textContent='Pick an employee.'; err.classList.remove('hidden'); return; }
      try{
        await db.collection('leave_balances').doc(uid).set(
          { vacation, sick, year:window.LeaveAccrual.policyYear(), updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
        window.logAudit && window.logAudit('grant','leave',uid,{ vacation, sick });
        closeModal(); Notifs.success('Balance updated!'); renderLeaveAdmin(c);
      }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
    });
  }

  function openLeaveModal(bal, c){
    const today = window.bizDate?window.bizDate():new Date().toISOString().slice(0,10);
    const _panel = openPage(`${emojiIcon('🌴',16)} Request Leave`, `
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
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
    // inside that window and two panels carry the same ids at once —
    // document.getElementById() returns the FIRST in document order, which is
    // the DYING one, so the handler binds to a button nobody can see and the
    // visible button does nothing (and a save can read the PREVIOUS record's
    // field values). Reported by the Corporate Secretary 2026-08-10.
    const upd = ()=>{ const d=leaveWorkingDays(_panel.querySelector('#lv-start').value, _panel.querySelector('#lv-end').value); _panel.querySelector('#lv-days-hint').textContent=`${d} working day${d!==1?'s':''} (excl. Sundays & holidays)`; };
    _panel.querySelector('#lv-start').addEventListener('change',upd);
    _panel.querySelector('#lv-end').addEventListener('change',upd);
    _panel.querySelector('#lv-save').addEventListener('click', async ()=>{
      const type=_panel.querySelector('#lv-type').value;
      const startDate=_panel.querySelector('#lv-start').value, endDate=_panel.querySelector('#lv-end').value;
      const reason=_panel.querySelector('#lv-reason').value.trim();
      const err=_panel.querySelector('#lv-err');
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
        try{ await Notifs.sendToOwner({ title:'🌴 Leave Request', body:`${userProfile?.displayName||currentUser.email} requests ${days}-day ${lt.label} (${startDate}→${endDate}).`, icon:'🌴', type:'leave', link:'approvals' }); }catch(_){}
        closeModal(); Notifs.success('Leave request submitted!'); window.renderLeavePage(c);
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
      if(window.bizDow(ds)!==0 && !hol[ds]){
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
    if(r.status==='approved') return;   // idempotency guard — already applied; a retry must not re-decrement the balance
    try{
      const lt=leaveType(r.type);
      await applyLeaveApproval(r);   // decrement + write attendance FIRST (single source) — status flips only after this succeeds
      await db.collection('leave_requests').doc(r.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
      window.logAudit && window.logAudit('approve','leave',r.id,{ user:r.userName, type:r.type, days:r.days });
      try{ Notifs.send(r.userId, { title:'Leave Approved ✅', body:`Your ${r.days}-day ${lt.label} (${r.startDate}→${r.endDate}) was approved.`, icon:'✅', type:'leave', link:'leave', dedupKey:`leave-ok-${r.id}` }); }catch(_){}
      Notifs.success('Leave approved'); window.renderLeavePage(c);
    }catch(ex){ Notifs.showToast('Approve failed: '+(ex.message||ex.code),'error'); }
  }

  async function rejectLeave(r, c){
    if(!r) return;
    const reason = (await promptDialog({ message: 'Reason for rejection (optional):', multiline: true }))||'';
    try{
      await db.collection('leave_requests').doc(r.id).update({ status:'rejected', approvedBy:currentUser.uid, rejectedReason:reason, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
      window.logAudit && window.logAudit('reject','leave',r.id,{ user:r.userName, type:r.type });
      try{ Notifs.send(r.userId, { title:'Leave Rejected', body:`Your ${leaveType(r.type).label} request was not approved.${reason?' Reason: '+reason:''}`, icon:'❌', type:'leave', link:'leave', dedupKey:`leave-no-${r.id}` }); }catch(_){}
      Notifs.error('Leave rejected'); window.renderLeavePage(c);
    }catch(ex){ Notifs.showToast('Reject failed','error'); }
  }

  // Exposed so the President's Approvals page (renderApprovals in departments.js) can
  // action leave from the unified queue, reusing the same balance-debit + notify logic
  // as the Leave Management screen. They do the DB work and return; the caller refreshes.
  window.approveLeaveRequest = async function(id){
    const s = await db.collection('leave_requests').doc(id).get();
    if(!s.exists) throw new Error('Leave request not found');
    const r = { id:s.id, ...s.data() };
    if(r.status==='approved') return r;   // idempotency guard — already applied; a retry must not re-decrement the balance
    const lt = leaveType(r.type);
    await applyLeaveApproval(r);    // decrement + write attendance FIRST (single source) — status flips only after this succeeds
    await db.collection('leave_requests').doc(r.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
    window.logAudit && window.logAudit('approve','leave',r.id,{ user:r.userName, type:r.type, days:r.days });
    try{ Notifs.send(r.userId, { title:'Leave Approved ✅', body:`Your ${r.days}-day ${lt.label} (${r.startDate}→${r.endDate}) was approved.`, icon:'✅', type:'leave', link:'leave', dedupKey:`leave-ok-${r.id}` }); }catch(_){}
    return r;
  };
  window.rejectLeaveRequest = async function(id, reason){
    const s = await db.collection('leave_requests').doc(id).get();
    if(!s.exists) throw new Error('Leave request not found');
    const r = { id:s.id, ...s.data() };
    await db.collection('leave_requests').doc(r.id).update({ status:'rejected', approvedBy:currentUser.uid, rejectedReason:reason||'', approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
    window.logAudit && window.logAudit('reject','leave',r.id,{ user:r.userName, type:r.type });
    try{ Notifs.send(r.userId, { title:'Leave Rejected', body:`Your ${leaveType(r.type).label} request was not approved.${reason?' Reason: '+reason:''}`, icon:'❌', type:'leave', link:'leave', dedupKey:`leave-no-${r.id}` }); }catch(_){}
    return r;
  };
})();


// ═══════════════════════════════════════════════════
//  GLOBAL SEARCH — across tasks, clients, CRM leads (AEC + ROC), ventures,
//  inventory, products, quotes and files
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
    if(blocked){ c.innerHTML = window.renderEmptyState({icon:'🔒', title:'Search is not available for this account'}); return; }
    if (window.lucide) lucide.createIcons({ nodes: [c] });

    c.innerHTML = `
      <div class="page-header"><h2>${emojiIcon('🔎',20)} Search</h2></div>
      <input id="gsearch-input" placeholder="Search tasks, clients, CRM leads, ventures, inventory, products, quotes, files…" value="${(initialQuery||'').replace(/"/g,'&quot;')}"
        style="width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-size:15px;margin-bottom:14px"/>
      <div id="gsearch-results">${window.renderEmptyState({icon:'🔎', title:'Type to search across the company.'})}</div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    const input = document.getElementById('gsearch-input');
    const out = document.getElementById('gsearch-results');

    let sources = null;
    async function load(){
      if(sources) return sources;
      const toArr = s => s.docs.map(d=>({id:d.id,...d.data()}));
      const safe = p => p.then(toArr).catch(()=>[]);
      // CRM + Ventures were added to this list 2026-08-10. Without them there was
      // no way to FIND a duplicate contact by name across the two lead
      // directories — "organize the CRM" meant eyeballing a ~330-row table — and
      // a venture brief could only be reached by scrolling the Portfolio grid.
      // Both reads are already permitted (aec_contacts/roc_leads: any non-partner;
      // ventures: canDept('Ventures')), so this needs no rules change; a viewer
      // the rules refuse just gets [] from the .catch and no group renders.
      // Who searches the CRM: the departments that own it, plus the admin tier.
      // canEditDept already resolves the Corporate Secretary correctly (CRM is
      // not in SECRETARY_BLOCKED_DEPTS), so this needs no role literal.
      const _gsCanCrm = (typeof canEditDept === 'function')
        && (canEditDept('CRM') || canEditDept('Sales'));
      const [tasks, quotes, cl, inv, prod, files, aec, roc, ventures] = await Promise.all([
        (typeof dbCachedGet==='function'?dbCachedGet('tasks-all',()=>db.collection('tasks').get(),30000):db.collection('tasks').get()).then(toArr).catch(()=>[]),
        (typeof getAllQuotes==='function'?getAllQuotes():db.collection('bk_quotes').get()).then(toArr).catch(()=>[]),
        window.Clients.listAll().catch(()=>[]),
        dbCachedGet('inventory_items',  () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000).then(toArr).catch(()=>[]),
        safe(db.collection('products').limit(1000).get()),
        // hub_files ONLY (v12 WS38 decision 8) — legacy files_<scope> collections are
        // frozen/unenumerable and NOT searched. Company-visible + mine + shared-with-me,
        // via FilesHub's rules-provable 3-query fan-out, capped at 1000 like Products.
        (typeof FilesHub!=='undefined' ? FilesHub.loadFiles(null).then(a=>a.slice(0,1000)) : Promise.resolve([])).catch(()=>[]),
        // CRM leads carry customer contact details — company, contact person,
        // phone, email. The rules admit every non-partner to read them, so
        // putting them in GLOBAL search would surface that book to every
        // employee who types a name, which is a wider change than the defect
        // asked for (the defect was that the Corporate Secretary could not find
        // duplicates while organising the CRM). Scope the source to the people
        // who actually work the CRM; everyone else searches as before.
        (_gsCanCrm ? safe(db.collection('aec_contacts').limit(1000).get()) : Promise.resolve([])),
        (_gsCanCrm ? safe(db.collection('roc_leads').limit(1000).get())    : Promise.resolve([])),
        safe(db.collection('ventures').limit(500).get()),
      ]);
      sources = { tasks, quotes,
        clients: cl.map(x=>({...x, _brand:(x.brands&&x.brands[0])==='design'?'design':(x.brands&&x.brands.includes('bs'))?'bs':'sales'})),
        inv, prod, files,
        // One CRM group, both directories — a duplicate that exists once as an
        // AEC contact and once as an ROC lead is the case this is for, so
        // splitting them into two cards would hide exactly what it should show.
        crm: [...aec.map(x=>({...x, _crm:'AEC'})), ...roc.map(x=>({...x, _crm:'ROC'}))],
        ventures };
      return sources;
    }

    const rowItem = (icon,title,sub,onclick)=>`<div class="item-card" style="cursor:pointer;display:flex;align-items:center;gap:10px" onclick="${onclick}"><span style="font-size:18px">${icon}</span><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${esc(title)}</div><div style="font-size:11px;color:var(--text-muted)">${esc(sub)}</div></div></div>`;
    const groupHtml = (icon,title,rows,render)=> !rows.length ? '' :
      `<div class="card" style="margin-bottom:12px"><div class="card-header"><h3>${icon} ${title} (${rows.length})</h3></div><div class="card-body" style="padding:0">${rows.slice(0,8).map(render).join('')}</div></div>`;

    async function runSearch(qRaw){
      const q = (qRaw||'').trim().toLowerCase();
      if(!q){ out.innerHTML = window.renderEmptyState({icon:'🔎', title:'Type to search across the company.'}); if (window.lucide) lucide.createIcons({ nodes: [out] }); return; }
      // v13 WS-H Phase 122 adoption — the fetch+filter step (load() + per-source
      // filtering) is the fetcher; the grouped result cards are the renderer.
      // withLoadingAndError (js/ui-states.js) owns the "Searching…" placeholder,
      // the no-results empty state, and error+Retry if load() ever rejects.
      await window.withLoadingAndError(out, async () => {
        const S = await load();
        return {
          tasks:   S.tasks.filter(t=>hit(q,t.title,t.description,t.department)),
          clients: S.clients.filter(x=>hit(q,x.name,x.company,x.email,x.phone)),
          inv:     S.inv.filter(i=>hit(q,i.name,i.category,i.supplier)),
          prod:    S.prod.filter(p=>hit(q,p.title,p.name,p.shortName,p.id,p.category)),
          quotes:  S.quotes.filter(qt=>hit(q,qt.quoteNumber,qt.clientName,qt.status)),
          files:   S.files.filter(f=>hit(q,f.name,f.description,f.scope)),
          // AEC (company) and ROC (restaurantName) name their subject
          // differently — match both, or half the directory is unsearchable.
          crm:     S.crm.filter(x=>hit(q,x.company,x.restaurantName,x.contactPerson,x.email,x.phone)),
          ventures:S.ventures.filter(v=>hit(q,v.name,v.tagline,v.summary,v.stage)),
        };
      }, (r) => {
        _gsFilesStash = {}; r.files.forEach(f=>{ _gsFilesStash[f.id]=f; });
        out.innerHTML =
          groupHtml(`${emojiIcon('✅',16)}`,'Tasks',r.tasks,t=>rowItem(`${emojiIcon('📋',16)}`,t.title||'(untitled)',(t.department||'')+(t.status?' · '+t.status:''),`window.openTaskDetail&&window.openTaskDetail('${t.id}',window.currentUser,window.currentRole)`)) +
          groupHtml(`${emojiIcon('👤',16)}`,'Clients',r.clients,x=>rowItem(`${emojiIcon('👤',16)}`,x.name||x.company||'Client',(x.company||'')+(x.phone?' · '+x.phone:''),`navigateTo('${x._brand==='design'?'dept:Design':x._brand==='bs'?'bs-clients':'dept:Sales'}')`)) +
          groupHtml(`${emojiIcon('📦',16)}`,'Inventory',r.inv,i=>rowItem(`${emojiIcon('📦',16)}`,i.name||'(item)',(i.category||'')+' · '+(i.qty||0)+' '+(i.unit||''),`navigateTo('inventory')`)) +
          groupHtml(`${emojiIcon('🛒',16)}`,'Products',r.prod,p=>rowItem(`${emojiIcon('🛒',16)}`,p.title||p.name||p.id,(p.id||'')+(p.category?' · '+p.category:''),`navigateTo('product-database')`)) +
          groupHtml(`${emojiIcon('📄',16)}`,'Quotes',r.quotes,qt=>rowItem(`${emojiIcon('📄',16)}`,(qt.quoteNumber||'Quote')+(qt.clientName?' — '+qt.clientName:''),(qt.status||'draft'),`navigateTo('${(qt.quoteNumber||'').toString().toUpperCase().startsWith('BS')?'bs-quotations':'dept:Sales'}')`)) +
          groupHtml(`${emojiIcon('📁',16)}`,'Files',r.files,f=>rowItem(f.kind==='link'?`${emojiIcon('🔗',16)}`:`${emojiIcon('📄',16)}`,f.name||'File',(f.scope||'')+(f.department?' · '+f.department:''),`window.__gsOpenFile('${f.id}')`)) +
          // Both CRM directories live behind the CRM department's own tabs, so
          // the row lands on the department; the _crm tag ('AEC'/'ROC') tells the
          // reader which tab to open, and is what makes a cross-directory
          // duplicate visible at a glance.
          groupHtml(`${emojiIcon('🏢',16)}`,'CRM Leads',r.crm,x=>rowItem(`${emojiIcon('🏢',16)}`,x.company||x.restaurantName||'Lead',(x._crm||'')+(x.contactPerson?' · '+x.contactPerson:'')+(x.phone?' · '+x.phone:''),`navigateTo('dept:CRM')`)) +
          // v.icon is OWNER-AUTHORED text and must never reach the raw icon slot
          // (see the ventures doc-shape note) — a fixed emoji is used instead.
          groupHtml(`${emojiIcon('🚀',16)}`,'Ventures',r.ventures,v=>rowItem(`${emojiIcon('🚀',16)}`,v.name||'Venture',(v.status||'')+(v.tagline?' · '+v.tagline:''),`navigateTo('dept:Ventures')`));
      }, {
        loadingText: 'Searching…',
        emptyCheck: r => (r.tasks.length+r.clients.length+r.inv.length+r.prod.length+r.quotes.length+r.files.length+r.crm.length+r.ventures.length)===0,
        emptyState: { icon: '🤷', title: `No results for "${qRaw}"`, hint: 'Try a different keyword, or check spelling.' }
      });
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
  if(blocked){ c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔒',44)}</div><h4>Files Hub is not available for this account</h4></div>`; return; }
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  // Who gets the aggregate "everything" chip. Unchanged audience — but see
  // hasBroadRead below: this flag no longer decides what the chip is CALLED.
  const isAdminRole = ['president','manager','owner','secretary'].includes(window.currentRole);
  // Does the viewer's Firestore read actually return every file, or the
  // 3-query fan-out (company-visibility + own + shared-with-me)? FilesHub owns
  // that answer (js/drive.js) and now exports it, because this screen and the
  // data layer used to keep TWO different admin lists: this file counted the
  // Corporate Secretary as an admin, drive.js did not, so a view labelled "All
  // Scopes" silently omitted every private and unshared file in the company and
  // told the one role whose job is oversight that it was looking at everything.
  // One list, one source, no drift.
  const hasBroadRead = (window.FilesHub && typeof FilesHub.hasBroadRead === 'function')
    ? FilesHub.hasBroadRead() : false;

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
  // ⚠ SCOPE PICKER = A DEPARTMENT SURFACE. Every seed scope carries the
  // department that owns it, and two of them ('SSS & Gov Docs', 'Accounting')
  // are Finance's — the exact folders js/screens/finance.js uploads SSS/BIR
  // filings and the accounting archive into. This list had NO role filter, so
  // the sidebar's "Files" tab offered the Corporate Secretary two chips
  // literally labelled with Finance's document archive, and every row in them
  // carries a working download anchor on `url` (a token-bearing Storage link —
  // the metadata IS the file). Subtract their closed departments here, the same
  // way the Departments grid (js/screens/dashboards.js) and the chat channel
  // list (js/chat.js) already do. Presentation only: firestore.rules and
  // storage.rules are the boundary, and the data layer subtracts the same
  // departments again in FilesHub.loadFiles (js/drive.js) so the aggregate view
  // and global search cannot re-open the same door.
  const _blockedDepts = (window.currentRole === 'secretary')
    ? (window.SECRETARY_BLOCKED_DEPTS || ['Finance', 'IT'])
    : [];
  const SCOPES = SEED_SCOPES.filter(s => !_blockedDepts.includes(s.dept));
  const scopeByKey = {}; SCOPES.forEach(s=>{ scopeByKey[s.key]=s; });
  // Honest label. "All Scopes" is only true for the roles whose single broad
  // query really does return everything; for the fan-out roles the same view is
  // "everything I am allowed to see", and saying so is the whole point. Computed
  // once because the disabled-search hint below quotes the chip by name.
  const allScopeLabel = hasBroadRead ? 'All Scopes' : 'Everything I Can See';
  const chips = [
    ...(isAdminRole ? [{ key:'__all__', label: allScopeLabel, icon:emojiIcon('🌐',16) }] : []),
    ...SCOPES.map(s=>({ key:s.key, label:s.label }))
  ];
  const defaultKey = isAdminRole ? '__all__' : SCOPES[0].key;

  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('📁',20)} Files Hub</h2></div>
    <input id="fh-hub-search" placeholder="Search my files…" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px;margin-bottom:12px"/>
    ${window.chipTabs(chips, defaultKey, {cls:'fh-hub-scope-tabs'})}
    <div id="fh-hub-content"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  let allScopeFiles = [];
  let _gsFilesStashHub = {};
  const hit = (q, ...fields) => fields.some(f => (f||'').toString().toLowerCase().includes(q));
  const loadScope = (key) => {
    const fc = document.getElementById('fh-hub-content');
    // Re-audit 2026-08-03: the search box above only ever filtered the
    // '__all__' scope — every other scope's file list (window.renderFileCollection/
    // bindFileCollection, js/departments.js) has no search hook of its own, so
    // typing into the still-enabled box on any other scope silently did nothing.
    // Cross-file fix would be adding a filter hook to bindFileCollection
    // (js/departments.js) itself — out of scope here — so in the meantime this
    // disables the box with an honest hint instead of leaving it a silent trap.
    const searchBox = document.getElementById('fh-hub-search');
    if (key === '__all__') {
      if (searchBox) { searchBox.disabled = false; searchBox.placeholder = 'Search files…'; }
      fc.innerHTML = window.skeletonHtml('rows');
      FilesHub.loadFiles(null).then(files => {
        allScopeFiles = files;
        renderAllScope();
      }).catch(err => {
        // Without this the skeleton sat there forever and read as "still
        // loading" — an empty-looking file list is exactly the kind of denied
        // read this role must never be shown as "nothing here".
        fc.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load your files</h4><p>${escHtml(err && err.message ? err.message : String(err))}</p><button type="button" class="btn-secondary btn-sm" id="fh-hub-retry">Retry</button></div>`;
        if (window.lucide) lucide.createIcons({ nodes: [fc] });
        fc.querySelector('#fh-hub-retry')?.addEventListener('click', () => loadScope('__all__'));
      });
      return;
    }
    // Quote the aggregate chip by its REAL label — and only when the viewer
    // actually has that chip, or the hint points at a control they cannot see.
    if (searchBox) {
      searchBox.disabled = true;
      searchBox.placeholder = isAdminRole ? `Search only works in "${allScopeLabel}"` : 'Search is not available in this scope';
      searchBox.value = '';
    }
    // Unknown key = a scope this viewer's department filter removed, or a stale
    // chip from a cached build. The old fallback ({label:key, dept:'General'})
    // had no `key` of its own, so bindFileCollection received scope===undefined
    // and threw on scope.toLowerCase() — and for a filtered-out scope it would
    // have re-opened the very list the filter above closed. Refuse both.
    const seed = scopeByKey[key];
    if (!seed) {
      fc.innerHTML = window.renderEmptyState({icon:'🔒', title:'That file scope is not available for your account'});
      if (window.lucide) lucide.createIcons({ nodes: [fc] });
      return;
    }
    fc.innerHTML = window.renderFileCollection(seed.label, `fh-hub-${key}`, window.currentRole);
    window.bindFileCollection(`fh-hub-${key}`, window.currentUser, seed.dept, seed.key);
  };

  const renderAllScope = () => {
    const fc = document.getElementById('fh-hub-content');
    const q = (document.getElementById('fh-hub-search')?.value||'').trim().toLowerCase();
    const showing = q ? allScopeFiles.filter(f=>hit(q,f.name,f.description,f.scope,f.department)) : allScopeFiles;
    // Say what this list is, when it is not everything. The fan-out roles get
    // company-visibility files plus their own plus what has been shared with
    // them — a private, unshared file simply is not here, and an oversight role
    // that assumes otherwise draws the wrong conclusion from an empty result.
    //
    // Computed BEFORE the empty-result return, because empty is the case where
    // the note does the most work: "no files" and "no files you can see" look
    // identical, and only one of them means the folder is actually empty.
    const scopeNote = hasBroadRead ? '' :
      `<p style="font-size:11px;color:var(--text-muted);margin:0 0 8px">Showing company-visible files, your own uploads, and files shared with you. Files kept private by their owner are not listed.</p>`;
    if (!showing.length) {
      fc.innerHTML = scopeNote + window.renderEmptyState({icon:'📁', title:'No files found', hint: hasBroadRead ? 'Try a different scope, or upload the first file here.' : 'Nothing here that you can see — a private file would not be listed. Try a different scope, or upload the first file here.'});
      if (window.lucide) lucide.createIcons({ nodes: [fc] });
      return;
    }
    _gsFilesStashHub = {}; showing.forEach(f=>{ _gsFilesStashHub[f.id]=f; });
    fc.innerHTML = scopeNote + `<div class="table-wrap"><table class="data-table table-cards">
      <thead><tr><th>Name</th><th>Scope</th><th>Dept</th><th>Uploader</th><th>Date</th><th></th></tr></thead>
      <tbody>${showing.map(f=>`<tr>
        <td class="tc-name"><a href="#" class="fh-hub-open" data-id="${f.id}" style="color:var(--primary);font-weight:600">${f.kind==='link'?`${emojiIcon('🔗',16)} `:`${emojiIcon('📄',16)} `}${escHtml(f.name||'File')}</a></td>
        <td class="tc-detail" data-label="Scope"><span class="badge badge-gray">${escHtml(f.scope||'—')}</span></td>
        <td class="tc-detail" data-label="Dept" style="font-size:12px">${escHtml(f.department||'—')}</td>
        <td class="tc-detail" data-label="Uploader" style="font-size:12px">${escHtml(f.uploaderName||'—')}</td>
        <td class="tc-net" style="font-size:11px;color:var(--text-muted)">${f.createdAt?new Date(f.createdAt.toDate()).toLocaleDateString('en-PH'):''}</td>
        <td class="tc-actions"><a href="${safeHttpUrl(f.url)}" target="_blank" class="btn-secondary btn-sm">${emojiIcon('⬇',16)}</a></td>
      </tr>`).join('')}</tbody></table></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [fc] });
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

/* ═══════════════════════════════════════════════════
   v12 WS41 — MY PROFILE (5 sub-tabs; partners get 3)
═══════════════════════════════════════════════════ */
window.renderMyProfile = async function() {
  const c = document.getElementById('page-content'); if (!c) return;
  const u = window.userProfile || {};
  const partner = (typeof isPartner === 'function' && isPartner()) ||
                  (typeof isBrilliantOnly === 'function' && isBrilliantOnly());
  const tabs = partner
    ? [ {key:'account',   label:'Account',              icon:emojiIcon('👤',16)},
        {key:'tasks',     label:'Tasks',                icon:emojiIcon('✅',16)},
        {key:'activity',  label:'Recent Activity',      icon:emojiIcon('🕘',16)} ]
    : [ {key:'id',        label:'ID',                   icon:emojiIcon('🪪',16)},
        {key:'finance',   label:'Finance & Performance',icon:emojiIcon('💳',16)},
        {key:'analytics', label:'My Analytics',         icon:emojiIcon('📊',16)},
        {key:'tasks',     label:'Tasks',                icon:emojiIcon('✅',16)},
        {key:'activity',  label:'Recent Activity',      icon:emojiIcon('🕘',16)} ];
  const initial = window.initialSubtab(partner ? 'account' : 'id');
  const depts = (Array.isArray(u.departments) && u.departments.length ? u.departments
                 : u.department ? [u.department] : []).join(', ');
  c.innerHTML = `
    <div class="profile-hero" style="margin-bottom:14px">
      <div class="profile-avatar-wrap" style="cursor:default">
        ${safeHttpUrl(u.photoUrl) ? `<img src="${escHtml(u.photoUrl)}" class="profile-avatar-img"/>`
                     : `<span class="profile-avatar-initials">${escHtml((u.displayName||'?')[0].toUpperCase())}</span>`}
      </div>
      <div class="profile-hero-name">${escHtml(u.displayName || u.email || 'User')}</div>
      <div class="profile-hero-role">${escHtml(ROLES[u.role]?.label || u.role || '')}${depts ? ' · ' + escHtml(depts) : ''}</div>
      ${u.employeeId ? `<div class="profile-hero-id">${escHtml(u.employeeId)}</div>` : ''}
    </div>
    ${window.chipTabs(tabs, initial, { cls: 'mp-tabs' })}
    <div id="mp-tab-host"></div>`;
  window.bindChipTabs(c.querySelector('.mp-tabs'), key => { window.setSubroute(key); loadMyProfileTab(key); });
  loadMyProfileTab(tabs.some(t => t.key === initial) ? initial : tabs[0].key);
  if (window.lucide) lucide.createIcons({ nodes: [c] });
};

async function loadMyProfileTab(key) {
  const host = document.getElementById('mp-tab-host'); if (!host) return;
  // Destroy any Chart.js instance from the previous sub-tab (e.g. Analytics'
  // pay-trend chart) before wiping the DOM — same convention as renderAnalytics'
  // subtab switch (app.js) and navigateTo's page-level Chart cleanup.
  if (window.Chart) host.querySelectorAll('canvas').forEach(cv => { const ex = Chart.getChart(cv); if (ex) ex.destroy(); });
  host.innerHTML = window.skeletonHtml('rows');
  const uid = currentUser.uid;
  if (key === 'id') {
    host.innerHTML = `<div id="mp-id-card-wrap" style="max-width:420px;margin:0 auto"></div>`;
    if (typeof renderIDCard === 'function') renderIDCard('mp-id-card-wrap', window.userProfile);   // WS27, verbatim
  } else if (key === 'finance') {
    host.innerHTML = '';
    await window.renderPersonalFinance(currentUser, currentRole, { host, selfOnly: true });
    if (['president','manager'].includes(currentRole)) {
      host.insertAdjacentHTML('afterbegin',
        `<div style="text-align:right;margin-bottom:8px"><button class="btn-secondary btn-sm"
           onclick="navigateTo('personal-finance')">Team view →</button></div>`);
    }
  } else if (key === 'analytics')  { await window.renderPersonalAnalytics(host, uid); }
  else if (key === 'tasks')        { await window.renderMyProfileTasksList(host, uid); }
  else if (key === 'activity')     { await window.renderRecentActivity(host, uid); }
  else if (key === 'account') {    // partners only — read-only info card
    const u = window.userProfile || {};
    host.innerHTML = `<div class="card"><div class="card-body">
      <div class="profile-info-row"><span class="pir-label">Email</span><span class="pir-value">${escHtml(u.email||'—')}</span></div>
      <div class="profile-info-row"><span class="pir-label">Company</span><span class="pir-value">${escHtml((typeof partnerCompanyName==='function'&&partnerCompanyName())||'—')}</span></div>
      <div class="profile-info-row no-border"><span class="pir-label">Role</span><span class="pir-value">${escHtml(ROLES[u.role]?.label||u.role||'—')}</span></div>
    </div></div>`;
  }
}

// ── Personal Analytics (Decision 7) — "analytics about me", composed from
// existing per-user helpers (getKpiScore/getAttendanceScore/own tasks/
// salary_history). No new aggregation infrastructure, no writes.
window.renderPersonalAnalytics = async function(host, uid) {
  const month = window.bizDate().slice(0, 7);
  let kpi, att, taskSnap, histSnap, evalSnap;
  try {
    [kpi, att, taskSnap, histSnap, evalSnap] = await Promise.all([
      (typeof getKpiScore === 'function')        ? getKpiScore(uid)        : 0.5,
      (typeof getAttendanceScore === 'function') ? getAttendanceScore(uid) : 0,
      db.collection('tasks').where('assignedTo', 'array-contains', uid).get().catch(() => ({ docs: [] })),
      db.collection('salary_history').where('userId', '==', uid).orderBy('month', 'desc').limit(6).get().catch(() => ({ docs: [] })),
      db.collection('kpi_evals').doc(uid).get().catch(() => null)
    ]);
  } catch (err) {
    host.innerHTML =
      '<div class="empty-state"><div class="empty-icon">' + emojiIcon('⚠️',44) + '</div>' +
      '<h4>Something went wrong</h4><p>' + escHtml(err && err.message ? err.message : String(err)) + '</p>' +
      '<button type="button" class="btn-secondary btn-sm" id="mp-analytics-retry-btn" style="margin-top:14px">Retry</button></div>';
    if (window.lucide) lucide.createIcons({ nodes: [host] });
    document.getElementById('mp-analytics-retry-btn')?.addEventListener('click', () => window.renderPersonalAnalytics(host, uid));
    return;
  }

  // Same DONE set as getKpiScore / renderPersonalFinance (app.js).
  const DONE = ['done', 'approved', 'archived'];
  const todayStr = window.bizDate();
  const tasks = taskSnap.docs.map(d => d.data());
  const doneTasks = tasks.filter(t => DONE.includes(t.status));
  const overdueTasks = tasks.filter(t => !DONE.includes(t.status) && t.dueDate && t.dueDate < todayStr);
  const taskPct = tasks.length ? Math.round(doneTasks.length / tasks.length * 100) : 0;
  const attPct = Math.round((att || 0) * 100);
  const kpiPct = Math.round((kpi || 0) * 100);
  const monthLabel = new Date(month + '-01T12:00:00').toLocaleString('en-PH', { month: 'long', year: 'numeric' });

  const hist = histSnap.docs.map(d => d.data()).slice().reverse();   // oldest → newest
  const evalData = (evalSnap && evalSnap.exists) ? evalSnap.data() : {};
  // President grade: employees see only the averaged grade, and only on the
  // 1st of the (Manila) month — same rule as renderPersonalFinance (app.js).
  const isFirstOfMonth = window.bizDate().slice(8, 10) === '01';
  const presGrade = isFirstOfMonth ? (evalData.presidentGradeFromTasks ?? null) : null;

  host.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card${attPct >= 90 ? ' green' : attPct < 60 ? ' warn' : ''}">
        <div class="kpi-label">Attendance</div>
        <div class="kpi-value">${attPct}%</div>
        <div class="kpi-sub">${escHtml(monthLabel)}</div>
      </div>
      <div class="kpi-card${taskPct >= 80 ? ' green' : ''}">
        <div class="kpi-label">Task Completion</div>
        <div class="kpi-value">${doneTasks.length}/${tasks.length}</div>
        <div class="kpi-sub">${taskPct}% done</div>
      </div>
      <div class="kpi-card accent">
        <div class="kpi-label">KPI Composite</div>
        <div class="kpi-value">${kpiPct}%</div>
        <div class="kpi-sub">70% tasks · 30% deliverables</div>
      </div>
      <div class="kpi-card${overdueTasks.length ? ' warn' : ''}">
        <div class="kpi-label">Overdue Now</div>
        <div class="kpi-value">${overdueTasks.length}</div>
        <div class="kpi-sub">${overdueTasks.length ? 'Needs attention' : 'All clear'}</div>
      </div>
    </div>
    ${hist.length === 0 ? '' : `
    <div class="card" style="margin-top:14px">
      <div class="card-header"><h3>${emojiIcon('💵',20)} Net Pay — last ${hist.length} month${hist.length === 1 ? '' : 's'}</h3></div>
      <div class="card-body"><div class="chart-wrap"><canvas id="mp-pay-trend"></canvas></div></div>
    </div>`}
    <div class="card" style="margin-top:14px">
      <div class="card-header"><h3>${emojiIcon('📝',20)} Performance Evaluation</h3></div>
      <div class="card-body">
        <div class="profile-info-row${(presGrade == null && !evalData.presidentImprovements) ? ' no-border' : ''}">
          <span class="pir-label">Self Grade</span>
          <span class="pir-value">${evalData.selfGrade != null ? escHtml(String(evalData.selfGrade)) + '/10' : '—'}</span>
        </div>
        ${presGrade != null ? `<div class="profile-info-row${!evalData.presidentImprovements ? ' no-border' : ''}">
          <span class="pir-label">President Grade</span>
          <span class="pir-value">${escHtml(String(presGrade))}/10</span>
        </div>` : ''}
        ${evalData.presidentImprovements ? `<div class="profile-info-row no-border" style="flex-direction:column;align-items:stretch;gap:6px">
          <span class="pir-label">Improvement Areas</span>
          <span class="pir-value" style="white-space:normal">${escHtml(evalData.presidentImprovements)}</span>
        </div>` : ''}
      </div>
    </div>
  `;

  if (hist.length > 0) {
    if (!window.Chart) { await window.ensureChart(); }
    const CT = window.chartTheme();
    const labels = hist.map(h => (h.month || '').slice(0, 7));
    const data = hist.map(h => h.netPay ?? h.finalPay ?? 0);
    new Chart(document.getElementById('mp-pay-trend'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Net Pay', data, borderColor: CT.good, backgroundColor: CT.goodA, fill: true, tension: 0.4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: cx => ` ₱${fmt(cx.parsed.y)}` } } },
        scales: { y: { ticks: { color: CT.text }, grid: { color: CT.grid } }, x: { ticks: { color: CT.text }, grid: { display: false } } }
      }
    });
  }
  if (window.lucide) lucide.createIcons({ nodes: [host] });
  if (typeof window.fitKpiValues === 'function') window.fitKpiValues(host);
};

// ── Tasks sub-tab (Decision 8) — compact read-only "assigned to me" list.
// ONE Tasks implementation stays canonical (departments.js renderTasks); this
// is a preview + a jump-off, never a second CRUD surface.
window.renderMyProfileTasksList = async function(host, uid) {
  const snap = await db.collection('tasks').where('assignedTo', 'array-contains', uid)
    .get().catch(() => ({ docs: [] }));
  const DONE = ['done', 'approved', 'archived'];
  const todayStr = window.bizDate();
  const STATUS_EMOJI = {
    backlog: `${emojiIcon('📥',16)}`, brainstorm: `${emojiIcon('💭',16)}`, 'in-progress': `${emojiIcon('🔧',16)}`, submitted: `${emojiIcon('📤',16)}`, review: `${emojiIcon('👀',16)}`,
    returned: `↩️`, approved: `${emojiIcon('✅',16)}`, done: `${emojiIcon('✅',16)}`, 'on-hold': `${emojiIcon('⏸️',16)}`, archived: `${emojiIcon('🗄️',16)}`
  };
  const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const aOpen = !DONE.includes(a.status), bOpen = !DONE.includes(b.status);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;             // open tasks first
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;                                // nulls last
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
    })
    .slice(0, 25);

  host.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>${emojiIcon('✅',20)} My Tasks</h3>
        <button class="btn-primary btn-sm" onclick="navigateTo('tasks')">Open full Tasks →</button>
      </div>
      <div class="card-body" style="padding:0">
        ${!tasks.length
          ? `<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('✅',44)}</div><p>No tasks assigned</p></div>`
          : tasks.map(t => {
              const isOverdue = t.dueDate && t.dueDate < todayStr && !DONE.includes(t.status);
              return `<div class="task-feed-item mp-task-row ${isOverdue ? 'task-overdue' : ''}" data-id="${escHtml(t.id)}">
                <span style="font-size:16px;flex-shrink:0">${STATUS_EMOJI[t.status] || `${emojiIcon('📌',16)}`}</span>
                <div style="flex:1;min-width:0">
                  <div class="task-feed-title">${escHtml(t.title || 'Untitled')}</div>
                  ${t.dueDate ? `<div class="task-feed-meta" style="color:${isOverdue ? 'var(--danger)' : 'var(--text-muted)'}">${isOverdue ? 'Overdue' : 'Due'} ${escHtml(t.dueDate)}</div>` : ''}
                </div>
                ${t.department ? `<span class="badge badge-gray">${escHtml(t.department)}</span>` : ''}
              </div>`;
            }).join('')}
      </div>
    </div>
  `;
  // Read-only: clicking a row just navigates to the real Tasks page (Decision 8).
  host.querySelectorAll('.mp-task-row').forEach(row => row.addEventListener('click', () => navigateTo('tasks')));
  if (window.lucide) lucide.createIcons({ nodes: [host] });
};

// ── millis helper for Firestore Timestamp | Date | null, shared by the feed below.
function _mpTsMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  return 0;
}
function _mpTimeAgo(ms) {
  if (!ms) return '';
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60)      return 'Just now';
  if (diff < 3600)    return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400)   return Math.floor(diff / 3600) + 'h ago';
  if (diff < 2592000) return Math.floor(diff / 86400) + 'd ago';
  return new Date(ms).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Recent Activities (Decision 9) — composed feed, zero new collection,
// zero new writer. Every source is already owner-readable (G11); the
// audit_log source additionally needs Spec 7's rules+index (degrades to
// silently-empty via .catch until that's deployed).
window.renderRecentActivity = async function(host, uid) {
  // v13 WS-H Phase 122 adoption — fetch + build stays a pure fetcher (returns
  // the sorted feed array), rendering stays a pure renderer; withLoadingAndError
  // (js/ui-states.js) owns the loading placeholder, the empty state, and the
  // error+Retry block so this screen can no longer get stuck or fail silently.
  await window.withLoadingAndError(host, async () => {
    const partner = (typeof isPartner === 'function' && isPartner());
    const none = Promise.resolve({ docs: [] });
    const [notif, tasks, leave, ca, att, posts, audit] = await Promise.all([
      db.collection('notifications').doc(uid).collection('items')
        .orderBy('createdAt', 'desc').limit(30).get().catch(() => ({ docs: [] })),
      db.collection('tasks').where('assignedTo', 'array-contains', uid).get().catch(() => ({ docs: [] })),
      partner ? none : db.collection('leave_requests').where('userId', '==', uid).get().catch(() => ({ docs: [] })),
      partner ? none : db.collection('cash_advances').where('userId', '==', uid).get().catch(() => ({ docs: [] })),
      partner ? none : db.collection('attendance').doc(uid).collection('records')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(14).get().catch(() => ({ docs: [] })),
      partner ? none : db.collection('posts').where('authorId', '==', uid).get().catch(() => ({ docs: [] })),
      db.collection('audit_log').where('actorUid', '==', uid)
        .orderBy('ts', 'desc').limit(50).get().catch(() => ({ docs: [] }))   // needs Spec 7 rules+index; degrades silently until deployed
    ]);

    const DONE = ['done', 'approved', 'archived'];
    const events = [];

    notif.docs.forEach(d => {
      const n = d.data();
      events.push({ ts: _mpTsMillis(n.createdAt), icon: '🔔', html: escHtml(n.title || 'Notification') });
    });

    tasks.docs.forEach(d => {
      const t = d.data();
      if (DONE.includes(t.status)) {
        // completedAt never existed in this schema; lastModifiedAt is the real
        // generic "task last touched" timestamp set on every status transition
        // (departments.js) — the closest live equivalent to a "completed at".
        const doneTs = t.completedAt || t.lastModifiedAt;
        if (doneTs) events.push({ ts: _mpTsMillis(doneTs), icon: '✅', html: `Completed “${escHtml(t.title || 'task')}”` });
      }
      if (t.createdAt) events.push({ ts: _mpTsMillis(t.createdAt), icon: '📋', html: `Assigned “${escHtml(t.title || 'task')}”` });
    });

    leave.docs.forEach(d => {
      const l = d.data();
      events.push({ ts: _mpTsMillis(l.createdAt), icon: '🌴', html: `${escHtml(l.type || 'Leave')} leave ${escHtml(l.status || 'pending')}` });
    });

    ca.docs.forEach(d => {
      const a = d.data();
      events.push({ ts: _mpTsMillis(a.createdAt), icon: '💸', html: `Cash advance ₱${fmt(a.amount || 0)} ${escHtml(a.status || 'pending')}` });
    });

    att.docs.forEach(d => {
      const r = d.data();
      if (!r.loginTime) return;   // admin-marked-absent shape (WS26) — no timed-in event
      events.push({ ts: _mpTsMillis(r.loginTime), icon: '📅', html: `Timed in${r.status === 'leave' ? ' (leave)' : ''}` });
    });

    posts.docs.forEach(d => {
      const p = d.data();
      events.push({ ts: _mpTsMillis(p.createdAt), icon: '📢', html: `Posted “${escHtml(p.title || 'update')}”` });
    });

    audit.docs.forEach(d => {
      const a = d.data();
      events.push({ ts: _mpTsMillis(a.ts), icon: '🛠', html: `${escHtml(a.action || 'update')} ${escHtml(a.entity || '')}` });
    });

    return events.filter(e => e.ts > 0).sort((a, b) => b.ts - a.ts).slice(0, 60);
  }, (feed) => {
    host.innerHTML = `<div class="card"><div class="card-body" style="padding:0">
        ${feed.map(e => `
          <div class="notif-item" style="cursor:default">
            <div class="notif-item-main">
              <div class="notif-item-emoji">${window.emojiIcon ? window.emojiIcon(e.icon, 20) : e.icon}</div>
              <div class="notif-item-text">
                <div class="notif-item-title">${e.html}</div>
                <div class="notif-item-time">${_mpTimeAgo(e.ts)}</div>
              </div>
            </div>
          </div>`).join('')}
      </div></div>`;
  }, {
    loadingText: 'Loading recent activity…',
    emptyCheck: feed => !feed.length,
    emptyState: { icon: '🕘', title: 'No recent activity yet', hint: 'Actions you take across the app — tasks, posts, leave, attendance — will show up here.' }
  });
};
