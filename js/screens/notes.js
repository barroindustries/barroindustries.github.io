/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Notes
   js/screens/notes.js

   NEW 2026-08-12 (NOTES-AND-DRAWER-SPEC-2026-08-12.md §5). Personal notes,
   private by default, shareable to named co-workers at a per-recipient
   level (view / comment / edit).

   ── THE PROPERTY THAT MATTERS MOST — note privacy ──────────────────────
   OWNER RULING (2026-08-12, asked directly whether the president may read
   employees' private notes): "No — private means private." A note nobody
   has been shared with is readable by its AUTHOR ALONE. That is enforced
   in firestore.rules (match /notes/{noteId}) — this screen's job is only
   to not leak anything the rules wouldn't already deny, never to be the
   thing standing between a private note and the wrong reader. There is
   deliberately no admin/president/secretary special case anywhere in this
   file, and none belongs here: people write honestly in a notepad they
   trust, and one they suspect is readable is worthless — they'd use their
   phone's notes app instead, which is strictly worse for the company.
   Oversight of what the business actually runs on (tasks, announcements,
   files, chat) is unaffected by this feature.

   Sharing ("named people, owner decided if they may edit or view only or
   comment" — same ruling): the OWNER alone assigns each named recipient
   view | comment | edit. The two Firestore fields that carry this
   (sharedUids scalar array = the access gate; sharedLevels map = the
   per-uid level, read only AFTER sharedUids admits the uid, degrading to
   the WEAKEST level 'view' on a missing entry) are always rewritten
   TOGETHER from freshly recomputed in-memory state — never arrayUnion/
   arrayRemove on one alone — because a stale entry in one field can never
   be allowed to out-grant the other. See openShare() below and
   firestore.rules' toSet() equality check, which is the real boundary.

   ── XSS ─────────────────────────────────────────────────────────────────
   Notes and comments are free text one employee writes and another
   employee's browser renders via innerHTML — the single highest-XSS-risk
   surface in this app. Every interpolation of title/body/ownerName/
   authorName/comment text/a picked user's name goes through esc()
   (a thin wrapper over escHtml(), js/modules.js) with no exceptions.
   Newlines: escape FIRST, then replace \n with <br> — never the other way
   round. Notification titles/bodies are plain text (no emojiIcon() output,
   no markup) — the inbox itself escHtml()s them at render time
   (js/notifications.js), matching every other Notifs.send call site in
   the app; this file does not escape a second time when WRITING those
   fields, only when RENDERING html.

   ── File conventions ────────────────────────────────────────────────────
   Classic script, 'use strict', ONE IIFE, exactly one global export:
   window.renderNotesPage. var/function throughout (no top-level const/let
   anywhere in this file — every helper below lives inside the IIFE, so no
   other global name is minted). Loads after js/screens/people.js (see
   index.html / sw.js PRECACHE) — by the time any handler in here actually
   RUNS, config.js/app.js/modules.js have long since defined escHtml,
   emojiIcon, openPage, busy, confirmDialog, chipTabs/bindChipTabs,
   skeletonHtml, Notifs, dbCachedGet, and the bare currentUser/userProfile/
   currentRole globals every other js/screens/*.js file already reaches
   for the same way.

   Panel-scoped DOM lookups only (panel.querySelector, never
   document.getElementById) — an openPage panel that's mid-close lingers
   in the DOM for ~300ms with the SAME element ids as whatever replaced it,
   and a document-wide lookup during that window silently binds to the
   dying panel (a real, previously-reported bug class in this app).
═══════════════════════════════════════════════════ */
'use strict';

(function () {

  function esc(s) { return window.escHtml ? window.escHtml(s) : String(s == null ? '' : s); }

  var LEVEL_LABEL = { view: 'View only', comment: 'Can comment', edit: 'Can edit' };

  function fmtStamp(ts) {
    return (ts && typeof ts.toDate === 'function')
      ? ts.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
  }

  // Mirrors the rules' own fail-safe direction (firestore.rules noteLevel()):
  // a shared uid with no entry in sharedLevels degrades to 'view', never to
  // anything stronger. This is UI convenience only — the rules are the real
  // boundary regardless of what this function ever returns.
  function myLevel(n) {
    if (!n) return 'view';
    if (n.ownerUid === (window.currentUser && currentUser.uid)) return 'owner';
    return (n.sharedLevels && n.sharedLevels[currentUser.uid]) || 'view';
  }

  // Directory lookup for names in the share panel / "Shared with" rows.
  // dbCachedGet('users', ...) is the same cached directory read the Team tab
  // and every other people-picker in the app already uses.
  function fetchUserDirectory() {
    return window.dbCachedGet('users', function () { return db.collection('users').get(); }, 30000)
      .then(function (snap) {
        var map = {};
        (snap.docs || []).forEach(function (d) {
          var u = d.data();
          map[d.id] = { name: u.displayName || u.email || 'Unknown', role: u.role || '' };
        });
        return map;
      })
      .catch(function () { return {}; });
  }

  var _currentTab = 'mine';

  window.renderNotesPage = async function () {
    var c = document.getElementById('page-content');
    c.innerHTML =
      '<div class="page-header">' +
        '<h2>' + emojiIcon('🗒️', 20) + ' Notes</h2>' +
        '<button class="btn-primary btn-sm" id="nts-new-btn">+ New Note</button>' +
      '</div>' +
      window.chipTabs([{ key: 'mine', label: 'My Notes' }, { key: 'shared', label: 'Shared with Me' }], 'mine', { cls: 'nts-tabs' }) +
      '<div id="nts-list"></div>';
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    window.bindChipTabs(c.querySelector('.nts-tabs'), function (key) { loadList(key); });
    var newBtn = c.querySelector('#nts-new-btn');
    if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
    loadList('mine');
  };

  // Fresh query every time — NOT dbCachedGet. This is private data, the
  // query is cheap, and a stale cache after a save/share would be worse
  // than the extra read.
  async function loadList(tab) {
    _currentTab = tab;
    var list = document.getElementById('nts-list');
    if (!list) return;
    list.innerHTML = window.skeletonHtml('rows');
    var snap;
    try {
      snap = (tab === 'shared')
        ? await db.collection('notes').where('sharedUids', 'array-contains', currentUser.uid).orderBy('updatedAt', 'desc').limit(100).get()
        : await db.collection('notes').where('ownerUid', '==', currentUser.uid).orderBy('updatedAt', 'desc').limit(100).get();
    } catch (err) {
      // Panel may have moved on (chip re-clicked) while this was in flight.
      list = document.getElementById('nts-list');
      if (!list) return;
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">' + emojiIcon('⚠️', 44) + '</div><h4>Something went wrong</h4><p>' + esc(err && err.message ? err.message : String(err)) + '</p></div>';
      if (window.lucide) lucide.createIcons({ nodes: [list] });
      return;
    }
    list = document.getElementById('nts-list');
    if (!list) return;
    var notes = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    if (!notes.length) {
      list.innerHTML = (tab === 'shared')
        ? '<div class="empty-state"><div class="empty-icon">' + emojiIcon('🤝', 44) + '</div><h4>Nothing shared with you yet</h4><p>Notes co-workers share with you will appear here.</p></div>'
        : '<div class="empty-state"><div class="empty-icon">' + emojiIcon('🗒️', 44) + '</div><h4>No notes yet</h4><p>Your notes are private until you share them.</p></div>';
      if (window.lucide) lucide.createIcons({ nodes: [list] });
      return;
    }
    list.innerHTML = notes.map(function (n) { return noteCardHtml(n, tab); }).join('');
    if (window.lucide) lucide.createIcons({ nodes: [list] });
    list.querySelectorAll('[data-note-id]').forEach(function (card) {
      card.addEventListener('click', function () { openNote(card.dataset.noteId, tab); });
    });
  }

  function noteCardHtml(n, tab) {
    var stamp = fmtStamp(n.updatedAt);
    var bodySrc = n.body || '';
    var snippetSrc = bodySrc.slice(0, 120);
    var snippet = esc(snippetSrc) + (bodySrc.length > 120 ? '…' : '');
    var metaLine = 'Updated ' + esc(stamp) + (n.updatedByName ? ' by ' + esc(n.updatedByName) : '');
    var sharedCount = Array.isArray(n.sharedUids) ? n.sharedUids.length : 0;
    var badge = '';
    if (tab === 'shared') {
      var lvl = (n.sharedLevels && n.sharedLevels[currentUser.uid]) || 'view';
      badge = '<div style="margin-top:6px;font-size:12px;color:var(--text-muted)">Shared by ' + esc(n.ownerName || '') + ' · ' + esc(LEVEL_LABEL[lvl] || LEVEL_LABEL.view) + '</div>';
    } else if (sharedCount > 0) {
      badge = '<span class="badge badge-gray" style="margin-top:8px;display:inline-flex;align-items:center;gap:4px"><i data-lucide="users" style="width:12px;height:12px"></i> Shared · ' + sharedCount + '</span>';
    }
    return '<div class="card" data-note-id="' + esc(n.id) + '" style="cursor:pointer">' +
      '<div class="card-body">' +
        '<div style="font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(n.title || 'Untitled') + '</div>' +
        (snippetSrc ? '<div style="margin-top:4px;color:var(--text-muted);font-size:13px">' + snippet + '</div>' : '') +
        '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">' + metaLine + '</div>' +
        badge +
      '</div>' +
    '</div>';
  }

  // ── Comments (panel-scoped: always re-queried against the panel actually
  // on screen, never a stale document-wide id). ────────────────────────────
  async function loadComments(panel, note) {
    var host = panel.querySelector('#nts-comments-list');
    if (!host) return;
    host.innerHTML = window.skeletonHtml('rows', 3);
    var snap;
    try {
      snap = await db.collection('notes').doc(note.id).collection('comments').orderBy('createdAt', 'asc').get();
    } catch (err) {
      host = panel.querySelector('#nts-comments-list');
      if (!host) return;
      host.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Could not load comments.</p>';
      return;
    }
    host = panel.querySelector('#nts-comments-list');
    if (!host) return;
    var comments = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    var isOwnerNow = (note.ownerUid === currentUser.uid);
    if (!comments.length) {
      host.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No comments yet.</p>';
      if (window.lucide) lucide.createIcons({ nodes: [host] });
      return;
    }
    host.innerHTML = comments.map(function (cm) {
      var canDelete = (cm.authorUid === currentUser.uid) || isOwnerNow;
      var cStamp = fmtStamp(cm.createdAt);
      var body = esc(cm.text || '').replace(/\n/g, '<br>');
      return '<div class="card" data-comment-id="' + esc(cm.id) + '" style="margin-bottom:8px">' +
        '<div class="card-body" style="padding:10px 14px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
            '<div><strong>' + esc(cm.authorName || 'Unknown') + '</strong> <span style="color:var(--text-muted);font-size:11px">' + esc(cStamp) + '</span></div>' +
            (canDelete ? '<button class="btn-secondary btn-sm nts-comment-del" data-id="' + esc(cm.id) + '" aria-label="Delete comment" style="padding:2px 8px">✕</button>' : '') +
          '</div>' +
          '<div style="margin-top:4px;font-size:13px;white-space:normal">' + body + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    if (window.lucide) lucide.createIcons({ nodes: [host] });
    host.querySelectorAll('.nts-comment-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.busy(btn, async function () {
          var ok = await confirmDialog({ title: 'Delete comment?', danger: true });
          if (!ok) return;
          try {
            await db.collection('notes').doc(note.id).collection('comments').doc(btn.dataset.id).delete();
          } catch (err) {
            Notifs.showToast('Could not delete comment.', 'error');
          }
          loadComments(panel, note);
        });
      });
    });
  }

  async function openNote(id, tab) {
    var snap;
    try {
      snap = await db.collection('notes').doc(id).get();
    } catch (err) {
      Notifs.showToast('This note is no longer shared with you.', 'error');
      loadList(tab);
      return;
    }
    if (!snap.exists) {
      Notifs.showToast('This note is no longer shared with you.', 'error');
      loadList(tab);
      return;
    }
    var n = Object.assign({ id: snap.id }, snap.data());
    var level = myLevel(n);
    var isOwner = (level === 'owner');
    var dir = isOwner ? await fetchUserDirectory() : {};

    var stamp = fmtStamp(n.updatedAt);
    var metaLine = 'Updated ' + esc(stamp) + (n.updatedByName ? ' by ' + esc(n.updatedByName) : '');
    var sharedByBlock = !isOwner
      ? '<div style="margin-bottom:10px"><span style="color:var(--text-muted);font-size:13px">Shared by ' + esc(n.ownerName || '') + '</span> <span class="badge badge-gray">' + esc(LEVEL_LABEL[level] || LEVEL_LABEL.view) + '</span></div>'
      : '';

    var recipients = Array.isArray(n.sharedUids) ? n.sharedUids : [];
    var sharedWithBlock = isOwner
      ? '<div style="margin:14px 0"><div style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:6px">Shared with</div>' +
          (recipients.length
            ? '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
                recipients.map(function (uid) {
                  var lvl = (n.sharedLevels && n.sharedLevels[uid]) || 'view';
                  var name = (dir[uid] && dir[uid].name) || 'Unknown';
                  return '<span class="badge badge-gray nts-shared-chip" style="cursor:pointer">' + esc(name) + ' · ' + esc(LEVEL_LABEL[lvl] || LEVEL_LABEL.view) + '</span>';
                }).join('') +
              '</div>'
            : '<p style="font-size:13px;color:var(--text-muted)">Not shared with anyone yet.</p>')
        + '</div>'
      : '';

    var canComment = (level === 'owner' || level === 'comment' || level === 'edit');
    var commentsBlock =
      '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">' +
        '<div style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:8px">Comments</div>' +
        '<div id="nts-comments-list"></div>' +
        (canComment
          ? '<div style="display:flex;gap:8px;margin-top:10px">' +
              '<input id="nts-comment-input" placeholder="Write a comment…" maxlength="2000" style="flex:1;min-width:0;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);color:var(--text)"/>' +
              '<button class="btn-primary btn-sm" id="nts-comment-post-btn">Post</button>' +
            '</div>'
          : '') +
      '</div>';

    var bodyHtml =
      sharedByBlock +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' + metaLine + '</div>' +
      '<div style="line-height:1.6;font-size:14px">' + esc(n.body || '').replace(/\n/g, '<br>') + '</div>' +
      sharedWithBlock +
      commentsBlock;

    var footerHtml = isOwner
      ? '<button class="btn-primary" id="nts-edit-btn">Edit</button>' +
        '<button class="btn-secondary" id="nts-share-btn">Share</button>' +
        '<button class="btn-danger" id="nts-delete-btn">Delete</button>'
      : (level === 'edit' ? '<button class="btn-primary" id="nts-edit-btn">Edit</button>' : '');

    // Title rendered via escHtml() to match the established convention every
    // other dynamic openPage() title in this app already follows (hr.js,
    // production.js, crm.js, …) — _setPanelTitle() assigns via textContent,
    // so this is belt-and-suspenders, not a second escaping bug; kept for
    // consistency with the rest of the codebase and with this spec.
    var panel = window.openPage(esc(n.title || 'Note'), bodyHtml, footerHtml);
    if (window.lucide) lucide.createIcons({ nodes: [panel] });

    loadComments(panel, n);

    var editBtn = panel.querySelector('#nts-edit-btn');
    if (editBtn) editBtn.addEventListener('click', function () { openEditor(n); });

    var shareBtn = panel.querySelector('#nts-share-btn');
    if (shareBtn) shareBtn.addEventListener('click', function () { openShare(n); });

    panel.querySelectorAll('.nts-shared-chip').forEach(function (chip) {
      chip.addEventListener('click', function () { openShare(n); });
    });

    var deleteBtn = panel.querySelector('#nts-delete-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', function () {
      window.busy(deleteBtn, async function () {
        var ok = await confirmDialog({
          title: 'Delete note?',
          message: '"' + esc(n.title || '') + '" will be deleted permanently. Anyone it was shared with loses access.',
          html: true,
          danger: true
        });
        if (!ok) return;
        // Best-effort delete of the comments subcollection this client can
        // list — done BEFORE the parent note delete, while parentNote()
        // (firestore.rules) can still resolve the owner check for each
        // comment delete. Any stragglers left behind afterward are
        // unreachable anyway: every comment verb re-reads the parent note,
        // and once the parent is gone that get() throws → denied. No Cloud
        // Function needed for this.
        try {
          var cSnap = await db.collection('notes').doc(n.id).collection('comments').get();
          if (cSnap.docs.length) {
            var batch = db.batch();
            cSnap.docs.forEach(function (d) { batch.delete(d.ref); });
            await batch.commit();
          }
        } catch (_) { /* best-effort */ }
        await db.collection('notes').doc(n.id).delete();
        Notifs.success('Note deleted');
        window.Overlay.dismissTop();
        loadList(tab);
      });
    });

    var postBtn = panel.querySelector('#nts-comment-post-btn');
    if (postBtn) postBtn.addEventListener('click', function () {
      window.busy(postBtn, async function () {
        var input = panel.querySelector('#nts-comment-input');
        if (!input) return;
        var text = (input.value || '').trim().slice(0, 2000);
        if (!text) return;
        var authorName = (window.userProfile && userProfile.displayName) || (currentUser && currentUser.email) || 'Unknown';
        await db.collection('notes').doc(n.id).collection('comments').add({
          authorUid: currentUser.uid,
          authorName: authorName,
          text: text,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        input.value = '';
        if (n.ownerUid !== currentUser.uid) {
          // Plain text — the inbox itself escHtml()s title/body at render
          // time (js/notifications.js), matching every other Notifs.send
          // call site in this app.
          await Notifs.send(n.ownerUid, {
            title: 'New comment on your note',
            body: authorName + ' commented on "' + (n.title || '') + '"',
            icon: '💬',
            type: 'note_comment',
            link: 'notes'
          });
        }
        loadComments(panel, n);
      });
    });
  }

  function openEditor(existing) {
    var isNew = !existing;
    var noteId = existing ? existing.id : null;
    var openedAtMillis = (!isNew && existing.updatedAt && typeof existing.updatedAt.toMillis === 'function')
      ? existing.updatedAt.toMillis() : 0;

    var panel = window.openPage(isNew ? 'New Note' : 'Edit Note',
      '<div class="form-group"><input id="nts-title" class="form-input" maxlength="200" placeholder="Title" value="' + esc(existing ? (existing.title || '') : '') + '"/></div>' +
      '<div class="form-group"><textarea id="nts-body" class="form-input" rows="12" maxlength="20000" placeholder="Write your note…" style="resize:vertical">' + esc(existing ? (existing.body || '') : '') + '</textarea></div>',
      '<button class="btn-primary" id="nts-save-btn">Save</button>'
    );
    if (window.lucide) lucide.createIcons({ nodes: [panel] });

    var saveBtn = panel.querySelector('#nts-save-btn');
    saveBtn.addEventListener('click', function () {
      window.busy(saveBtn, async function () {
        var title = panel.querySelector('#nts-title').value.trim();
        var body = panel.querySelector('#nts-body').value.trim();
        if (!title) { Notifs.showToast('Give the note a title.', 'error'); return; }
        var nowName = (window.userProfile && userProfile.displayName) || (currentUser && currentUser.email) || 'Unknown';

        if (isNew) {
          await db.collection('notes').add({
            ownerUid: currentUser.uid,
            ownerName: nowName,
            title: title,
            body: body,
            sharedUids: [],
            sharedLevels: {},
            updatedByName: nowName,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } else {
          // CONCURRENT-EDIT GUARD — honest last-write-wins. Two 'edit'
          // recipients (or the owner and an edit recipient) will eventually
          // collide; this admits it instead of silently losing a write.
          var freshSnap;
          try {
            freshSnap = await db.collection('notes').doc(noteId).get();
          } catch (err) {
            Notifs.showToast('This note is no longer shared with you.', 'error');
            window.Overlay.dismissTop();
            loadList(_currentTab);
            return;
          }
          if (!freshSnap.exists) {
            Notifs.showToast('This note is no longer shared with you.', 'error');
            window.Overlay.dismissTop();
            loadList(_currentTab);
            return;
          }
          var fresh = freshSnap.data();
          var freshMillis = (fresh.updatedAt && typeof fresh.updatedAt.toMillis === 'function') ? fresh.updatedAt.toMillis() : 0;
          if (freshMillis > openedAtMillis) {
            var stampHHMM = (fresh.updatedAt && typeof fresh.updatedAt.toDate === 'function')
              ? fresh.updatedAt.toDate().toLocaleString('en-PH', { hour: '2-digit', minute: '2-digit' })
              : '';
            var proceed = await confirmDialog({
              title: 'Overwrite newer changes?',
              message: esc(fresh.updatedByName || 'Someone') + ' saved this note at ' + esc(stampHHMM) + ' while you were editing. Saving now will replace their version.',
              html: true,
              confirmLabel: 'Save anyway',
              danger: true
            });
            if (!proceed) return; // keep the editor open, text intact
          }
          // Same update for owner and edit-recipient on purpose — it touches
          // exactly the four keys the rules' editor tier allows, and the
          // owner tier allows a strict superset. Never let this path touch
          // sharedUids/sharedLevels/ownerUid.
          await db.collection('notes').doc(noteId).update({
            title: title,
            body: body,
            updatedByName: nowName,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
        Notifs.success('Note saved');
        window.Overlay.dismissTop();
        loadList(_currentTab);
      });
    });
  }

  // OWNER ONLY (the [Share] footer button is only rendered for the owner in
  // openNote — firestore.rules is the real boundary regardless).
  async function openShare(note) {
    var uids = Array.isArray(note.sharedUids) ? note.sharedUids.slice() : [];
    var levels = Object.assign({}, note.sharedLevels || {});
    var dir = await fetchUserDirectory();

    var shareHtml =
      '<div style="margin-bottom:18px">' +
        '<div style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:8px">Current recipients</div>' +
        '<div id="nts-share-recipients"></div>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:8px">Add people</div>' +
        '<div class="form-group"><input id="nts-share-search" class="form-input" placeholder="Search by name…"/></div>' +
        '<div id="nts-share-picker"></div>' +
      '</div>';

    var panel = window.openPage('Share Note', shareHtml, '');
    if (window.lucide) lucide.createIcons({ nodes: [panel] });

    function currentFilter() {
      var input = panel.querySelector('#nts-share-search');
      return input ? input.value : '';
    }

    function renderRecipients() {
      var host = panel.querySelector('#nts-share-recipients');
      if (!host) return;
      if (!uids.length) {
        host.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Not shared with anyone yet.</p>';
        return;
      }
      host.innerHTML = uids.map(function (uid) {
        var lvl = levels[uid] || 'view';
        var name = (dir[uid] && dir[uid].name) || 'Unknown';
        return '<div class="card" style="margin-bottom:8px"><div class="card-body" style="padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:100px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(name) + '</div>' +
          '<select class="nts-share-level" data-uid="' + esc(uid) + '" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-size:13px">' +
            ['view', 'comment', 'edit'].map(function (l) {
              return '<option value="' + l + '"' + (l === lvl ? ' selected' : '') + '>' + esc(LEVEL_LABEL[l]) + '</option>';
            }).join('') +
          '</select>' +
          '<button class="btn-secondary btn-sm nts-share-remove" data-uid="' + esc(uid) + '" aria-label="Remove ' + esc(name) + '">✕</button>' +
        '</div></div>';
      }).join('');
      if (window.lucide) lucide.createIcons({ nodes: [host] });

      host.querySelectorAll('.nts-share-level').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var uid = sel.dataset.uid;
          var prev = levels[uid];
          levels[uid] = sel.value;
          persist().catch(function () {
            levels[uid] = prev;
            sel.value = prev;
            Notifs.showToast('Could not update sharing.', 'error');
          });
        });
      });
      host.querySelectorAll('.nts-share-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var uid = btn.dataset.uid;
          var idx = uids.indexOf(uid);
          var removedLevel = levels[uid];
          if (idx !== -1) uids.splice(idx, 1);
          delete levels[uid];
          persist().then(function () {
            renderRecipients();
            renderPicker(currentFilter());
          }).catch(function () {
            if (idx !== -1) uids.splice(idx, 0, uid);
            levels[uid] = removedLevel;
            Notifs.showToast('Could not update sharing.', 'error');
          });
        });
      });
    }

    function renderPicker(filterText) {
      var host = panel.querySelector('#nts-share-picker');
      if (!host) return;
      var f = (filterText || '').trim().toLowerCase();
      var candidates = Object.keys(dir).filter(function (uid) {
        if (uid === currentUser.uid) return false;
        if (uids.indexOf(uid) !== -1) return false;
        if (dir[uid].role === 'partner') return false;
        if (f && dir[uid].name.toLowerCase().indexOf(f) === -1) return false;
        return true;
      }).sort(function (a, b) { return dir[a].name.localeCompare(dir[b].name); });

      if (!candidates.length) {
        host.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No matches.</p>';
        return;
      }
      host.innerHTML = candidates.slice(0, 50).map(function (uid) {
        return '<div class="card nts-share-pick" data-uid="' + esc(uid) + '" style="margin-bottom:6px;cursor:pointer"><div class="card-body" style="padding:8px 14px">' + esc(dir[uid].name) + '</div></div>';
      }).join('');
      host.querySelectorAll('.nts-share-pick').forEach(function (row) {
        row.addEventListener('click', function () {
          var uid = row.dataset.uid;
          uids.push(uid);
          levels[uid] = 'view';
          persist().then(function () {
            renderRecipients();
            renderPicker(currentFilter());
            // Notify on ADD only — level changes and removals are quiet
            // corrections (spec §5.4). Plain text, no markup.
            return Notifs.send(uid, {
              title: 'Note shared with you',
              body: (note.ownerName || 'Someone') + ' shared "' + (note.title || '') + '" — ' + LEVEL_LABEL.view,
              icon: '🤝',
              type: 'note_shared',
              link: 'notes'
            });
          }).catch(function () {
            var idx = uids.indexOf(uid);
            if (idx !== -1) uids.splice(idx, 1);
            delete levels[uid];
            Notifs.showToast('Could not share the note.', 'error');
            renderRecipients();
            renderPicker(currentFilter());
          });
        });
      });
    }

    // EVERY share mutation (add / remove / level change) is ONE update()
    // that recomputes BOTH sharedUids and sharedLevels from this panel's
    // in-memory state — never arrayUnion/arrayRemove on sharedUids alone.
    // firestore.rules' toSet() equality re-proves the two match on every
    // owner write; a half-write is exactly the stale-entry privacy hole
    // this whole design exists to prevent.
    function persist() {
      return db.collection('notes').doc(note.id).update({
        sharedUids: uids.slice(),
        sharedLevels: Object.assign({}, levels),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    renderRecipients();
    renderPicker('');

    var searchInput = panel.querySelector('#nts-share-search');
    if (searchInput) searchInput.addEventListener('input', function () { renderPicker(searchInput.value); });
  }

})();
