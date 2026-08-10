/* ═══════════════════════════════════════════════════════════════════════
   BARRO INDUSTRIES — MEETINGS & IN-SYSTEM CALENDAR
   Owner request: "Can we make meeting appointments as well on chat with
   reminders / Send meeting appointments that sync with calendar / Send
   reminders and follow ups" — then, on the sync half: "but its supposed to
   be the in system calendar / but we can do the first one too".

   So the calendar IS this screen. The phone's calendar is reached by handing
   the user a .ics file (§5 of MEETINGS-CALENDAR-SPEC.md) — there is no browser
   Google OAuth anywhere in this app (js/drive.js:11 states the intent
   outright: "No Google OAuth required from employees"), so a Calendar API sync
   is not buildable on anything that exists today.

   WHAT LIVES HERE
     window.Meetings            data layer — load / save / rsvp / cancel / ics
     window.renderCalendarPage  the month grid + day agenda (primary surface)

   TIME HANDLING — the part this repo has been burned by twice.
   Every calendar day, every bucket, every "today" goes through the Manila
   helpers (window.bizDate / bizDow, js/config.js). A raw toISOString() is a
   UTC date and lands on the WRONG DAY for the first 8 hours of every Manila
   day; that exact bug corrupted attendance and payroll once already. Building
   a Date from form inputs uses the house idiom with an EXPLICIT offset:
       new Date(`${dateStr}T${timeHM}:00+08:00`)
   never `new Date(d + ' ' + t)`, which is parsed in the DEVICE's timezone.

   LOAD ORDER — after js/notifications.js, before js/departments.js. Everything
   here touches other globals at RUN time only (never at parse time), the same
   forward-reference convention every other file in this app uses.
   ═══════════════════════════════════════════════════════════════════════ */

window.Meetings = (function () {
  'use strict';

  const COLL = 'meetings';
  const MAX_TITLE = 140, MAX_TEXT = 4000, MAX_INVITEES = 200;

  const esc = (s) => (window.escHtml ? window.escHtml(s == null ? '' : s) : String(s == null ? '' : s));
  const ico = (g, sz) => (window.emojiIcon ? window.emojiIcon(g, sz || 16) : '');
  const uid = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '';
  // The oversight tier — mirrors firestore.rules' isAdmin(). These roles see the
  // whole company's calendar; everyone else sees only what they are invited to.
  const isAdminTier = () => ['president', 'manager', 'secretary'].includes(window.currentRole || '');

  /* ── Manila-anchored date maths ────────────────────────────────────────
     All of these take/return the 'YYYY-MM-DD' string form, which is the only
     representation that survives a timezone change unharmed. A Date is built
     ONLY at the boundary, always with an explicit +08:00. */
  function ymd(d) { return window.bizDate ? window.bizDate(d) : new Date(d).toISOString().slice(0, 10); }
  function today() { return ymd(); }
  // Noon-anchored so a DST-free but offset-shifted parse can never roll the day.
  function dayDate(iso) { return new Date(iso.slice(0, 10) + 'T12:00:00+08:00'); }
  function atTime(iso, hm) { return new Date(iso.slice(0, 10) + 'T' + (hm || '00:00') + ':00+08:00'); }
  function addDays(iso, n) {
    const d = dayDate(iso); d.setDate(d.getDate() + n); return ymd(d);
  }
  function monthKey(iso) { return iso.slice(0, 7); }
  function monthStartIso(mk) { return mk + '-01'; }
  function monthEndIso(mk) {
    const [y, m] = mk.split('-').map(Number);
    return ymd(new Date(Date.UTC(y, m, 0, 4)));   // day 0 of next month = last of this
  }
  function monthLabel(mk) {
    const d = dayDate(mk + '-01');
    return d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'long', year: 'numeric' });
  }
  // Mon-first column index (PH convention). bizDow is 0=Sun.
  function monCol(iso) { const w = window.bizDow ? window.bizDow(iso) : dayDate(iso).getDay(); return (w + 6) % 7; }
  function hhmm(ts) {
    try {
      const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(d)) return '';
      return d.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (_) { return ''; }
  }
  function dayOf(ts) {
    try { const d = ts && ts.toDate ? ts.toDate() : new Date(ts); return isNaN(d) ? '' : ymd(d); }
    catch (_) { return ''; }
  }

  /* ── Load ──────────────────────────────────────────────────────────────
     Always a BOUNDED month window, never the whole collection. Two shapes:
     the oversight tier queries by startAt alone; everyone else adds the
     array-contains leg, which is what the composite index is for. */
  async function loadMonth(mk) {
    const from = atTime(monthStartIso(mk), '00:00');
    const to   = atTime(addDays(monthEndIso(mk), 1), '00:00');
    let q = db.collection(COLL).where('startAt', '>=', from).where('startAt', '<', to);
    if (!isAdminTier()) q = q.where('invitees', 'array-contains', uid());
    const snap = await q.get();
    const out = [];
    snap.forEach(d => out.push(Object.assign({ id: d.id }, d.data())));
    out.sort((a, b) => {
      const av = a.startAt && a.startAt.toMillis ? a.startAt.toMillis() : 0;
      const bv = b.startAt && b.startAt.toMillis ? b.startAt.toMillis() : 0;
      return av - bv;
    });
    return out;
  }

  async function get(id) {
    const d = await db.collection(COLL).doc(id).get();
    return d.exists ? Object.assign({ id: d.id }, d.data()) : null;
  }

  /* ── Save ──────────────────────────────────────────────────────────────
     `remindersSent` is deliberately never written here: the rules reject it
     from a client write, because a client that could stamp it could silence
     its own reminder. The daily digest owns that field. */
  async function save(m) {
    const me = uid();
    if (!me) throw new Error('not signed in');
    const invitees = Array.from(new Set((m.invitees || []).concat([me]))).filter(Boolean).slice(0, MAX_INVITEES);
    const names = {};
    invitees.forEach(u => { if (m.inviteeNames && m.inviteeNames[u]) names[u] = String(m.inviteeNames[u]).slice(0, 120); });

    const body = {
      title:    String(m.title || '').trim().slice(0, MAX_TITLE),
      agenda:   String(m.agenda || '').slice(0, MAX_TEXT),
      location: String(m.location || '').slice(0, 300),
      startAt:  m.startAt,
      endAt:    m.endAt,
      invitees, inviteeNames: names,
      convId:   m.convId || null,
      status:   m.status || 'scheduled',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (m.notes != null)      body.notes = String(m.notes).slice(0, MAX_TEXT);
    if (m.followUpAt != null) body.followUpAt = m.followUpAt;

    if (m.id) {
      await db.collection(COLL).doc(m.id).set(body, { merge: true });
      return m.id;
    }
    body.organizerUid  = me;
    body.organizerName = (window.userProfile && userProfile.displayName)
      || (typeof currentUser !== 'undefined' && currentUser && currentUser.email) || '';
    body.rsvp          = { [me]: 'yes' };   // organising IS accepting
    body.createdAt     = firebase.firestore.FieldValue.serverTimestamp();
    const ref = await db.collection(COLL).add(body);
    notifyInvited(Object.assign({ id: ref.id }, body), invitees.filter(u => u !== me));
    return ref.id;
  }

  /* Invites go through Notifs.send DIRECTLY, never _notifyRecipients — that
     path applies a 60-second throttle and a per-conversation mute, either of
     which would silently swallow a meeting invite. */
  function notifyInvited(m, targets) {
    if (!window.Notifs || typeof Notifs.send !== 'function') return;
    const when = hhmm(m.startAt), day = dayOf(m.startAt);
    targets.forEach(t => {
      try {
        Notifs.send(t, {
          // PLAIN EMOJI — this is a text sink. emojiIcon() returns <i data-lucide>
          // markup, which has shipped as literal visible code four times.
          title: '📅 Meeting invite',
          body:  `${m.title} — ${day} ${when}`,
          icon:  '📅',
          type:  'meeting_invite',
          meetingId: m.id,
          dedupKey: `meet-invite-${m.id}-${t}`
        });
      } catch (_) {}
    });
  }

  // An invitee may write ONLY their own rsvp key — enforced in the rules, and
  // shaped here to match so a legitimate answer is never rejected wholesale.
  async function rsvp(id, answer) {
    const me = uid();
    if (!me) return;
    await db.collection(COLL).doc(id).update({ ['rsvp.' + me]: answer });
  }

  async function cancel(id) {
    await db.collection(COLL).doc(id).set({
      status: 'cancelled',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  /* ── .ics export (RFC 5545) ────────────────────────────────────────────
     The ONLY route to the phone's own calendar that needs no new OAuth. */
  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
  // RFC 5545 §3.1: fold at 75 OCTETS, not characters — a ₱ or an accented
  // name is multi-byte, so counting characters would produce an over-long line
  // that strict parsers reject.
  function icsFold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = '', curLen = 0, first = true;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      const cap = first ? 75 : 74;         // continuation lines carry a leading space
      if (curLen + n > cap) { out.push(cur); cur = ''; curLen = 0; first = false; }
      cur += ch; curLen += n;
    }
    if (cur) out.push(cur);
    return out.map((l, i) => (i === 0 ? l : ' ' + l)).join('\r\n');
  }
  function icsStamp(v) {
    const d = v && v.toDate ? v.toDate() : new Date(v);
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function buildIcs(m) {
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barro Industries//Operations System//EN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      // Stable UID = the meeting id, so re-issuing the file UPDATES the phone's
      // copy instead of adding a second one.
      'UID:' + m.id + '@barroindustries',
      'DTSTAMP:' + icsStamp(new Date()),
      'DTSTART:' + icsStamp(m.startAt),
      'DTEND:'   + icsStamp(m.endAt || m.startAt),
      'SUMMARY:' + icsEscape(m.title),
      m.location ? 'LOCATION:' + icsEscape(m.location) : null,
      m.agenda   ? 'DESCRIPTION:' + icsEscape(m.agenda) : null,
      'STATUS:' + (m.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'),
      'END:VEVENT', 'END:VCALENDAR'
    ].filter(Boolean);
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }
  // Download ladder copied from _downloadDocJPEG (js/print-docs.js): on iOS a
  // plain anchor download is unreliable inside a standalone PWA, so try the
  // share sheet first and treat AbortError as "user cancelled", not a failure.
  async function downloadIcs(m) {
    const name = (String(m.title || 'meeting').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'meeting') + '.ics';
    const blob = new Blob([buildIcs(m)], { type: 'text/calendar;charset=utf-8' });
    try {
      const file = new File([blob], name, { type: 'text/calendar' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: m.title || 'Meeting' }); return; }
        catch (e) { if (!e || e.name !== 'AbortError') throw e; return; }
      }
    } catch (_) { /* fall through to the anchor */ }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { Notifs.showToast('Calendar file saved — open it to add the meeting.'); } catch (_) {}
  }

  return {
    loadMonth, get, save, rsvp, cancel, buildIcs, downloadIcs,
    // exported for the calendar screen and the chat card
    _h: { esc, ico, uid, isAdminTier, ymd, today, addDays, atTime, monthKey, monthStartIso,
          monthEndIso, monthLabel, monCol, hhmm, dayOf, dayDate }
  };
})();


/* ═══════════════════════════════════════════════════════════════════════
   CALENDAR SCREEN — window.renderCalendarPage
   Month grid (Mon-first) + a day agenda opened as its own window.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const H = () => window.Meetings._h;

  let _mk = null;          // month being viewed, 'YYYY-MM'
  let _cache = [];         // meetings loaded for _mk

  function statusOf(m, me) {
    const r = (m.rsvp || {})[me];
    return r === 'yes' ? 'Going' : r === 'no' ? 'Declined' : r === 'maybe' ? 'Maybe' : 'No reply';
  }

  window.renderCalendarPage = async function () {
    const h = H(), c = document.getElementById('page-content');
    if (!c) return;
    if (!_mk) _mk = h.monthKey(h.today());

    c.innerHTML = `
      <div class="page-header"><h2>${h.ico('📅', 20)} Calendar</h2></div>
      ${window.sopPanel ? window.sopPanel('How the calendar works', [
        'Meetings you organise or are invited to appear here — the President, a Manager and the Corporate Secretary see the whole company.',
        'Tap a day to see that day in full, RSVP, or open a meeting.',
        'Add to phone calendar hands you a calendar file — open it and your phone adds the meeting to its own calendar app.',
        'Everyone invited gets an invite notification now and a reminder on the morning of the meeting.',
        'After a meeting ends the organiser can add notes and set a follow-up date, which lands back on this calendar.'
      ]) : ''}
      <div id="cal-host">${window.skeletonHtml ? window.skeletonHtml('rows') : '<p>Loading…</p>'}</div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    await paint(c);
  };

  async function paint(root) {
    const h = H(), host = root.querySelector('#cal-host');
    if (!host) return;
    let err = null;
    try { _cache = await window.Meetings.loadMonth(_mk); }
    catch (e) { err = e; _cache = []; }
    if (!host.isConnected) return;

    // Bucket by Manila day ONCE, so the grid never re-derives a day from a
    // Timestamp inside the render loop.
    const byDay = {};
    _cache.forEach(m => {
      if (m.status === 'cancelled') return;
      const d = h.dayOf(m.startAt); if (!d) return;
      (byDay[d] = byDay[d] || []).push(m);
      // A follow-up date is a second, distinct chip on its own day.
      if (m.followUpAt) {
        const f = h.dayOf(m.followUpAt);
        if (f) (byDay[f] = byDay[f] || []).push(Object.assign({}, m, { _followUp: true }));
      }
    });

    const first = h.monthStartIso(_mk), last = h.monthEndIso(_mk);
    const lead = h.monCol(first);
    const days = Number(last.slice(8, 10));
    const todayIso = h.today();

    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell cal-pad"></div>');
    for (let d = 1; d <= days; d++) {
      const iso = _mk + '-' + String(d).padStart(2, '0');
      const items = byDay[iso] || [];
      const shown = items.slice(0, 3);
      cells.push(`
        <button type="button" class="cal-cell${iso === todayIso ? ' cal-today' : ''}${items.length ? ' cal-has' : ''}"
                data-day="${iso}" aria-label="${h.esc(iso)}${items.length ? ', ' + items.length + ' meeting' + (items.length > 1 ? 's' : '') : ''}">
          <span class="cal-num">${d}</span>
          ${shown.map(m => `<span class="cal-chip${m._followUp ? ' cal-chip-fu' : ''}" title="${h.esc((m._followUp ? 'Follow-up — ' : h.hhmm(m.startAt) + ' ') + (m.title || ''))}"><span class="cal-chip-t">${m._followUp ? '↩' : h.esc(h.hhmm(m.startAt))}</span><span class="cal-chip-n">&nbsp;${h.esc(String(m.title || '').slice(0, 24))}</span></span>`).join('')}
          ${items.length > 3 ? `<span class="cal-more">+${items.length - 3} more</span>` : ''}
        </button>`);
    }

    const total = Object.keys(byDay).reduce((n, k) => n + byDay[k].length, 0);
    host.innerHTML = `
      ${err ? `<div class="alert-banner" style="cursor:default;margin-bottom:12px"><span>${h.ico('⚠', 16)} The calendar could not be read${err && err.code === 'permission-denied' ? ' — your role may not open it' : ''}. Nothing is shown rather than an empty month, which would look like "no meetings".</span></div>` : ''}
      <div class="cal-bar">
        <button class="btn-secondary" id="cal-prev" aria-label="Previous month">‹</button>
        <div class="cal-title">${h.esc(h.monthLabel(_mk))}</div>
        <button class="btn-secondary" id="cal-next" aria-label="Next month">›</button>
        <button class="btn-secondary" id="cal-today">Today</button>
        <button class="btn-primary" id="cal-new">${h.ico('➕', 14)} New meeting</button>
      </div>
      <div class="cal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      ${!err && !total ? `<div class="empty-state" style="margin-top:14px"><div class="empty-icon">${h.ico('📅', 40)}</div>
        <h4>No meetings this month</h4>
        <p style="color:var(--text-muted);font-size:13px;max-width:34ch;margin:6px auto 0">
          Meetings you organise or are invited to show up here, with an invite notification, a reminder on the morning, and a calendar file for your phone.</p></div>` : ''}`;

    // Panel-scoped lookups only. An unscoped document.getElementById is this
    // app's single largest defect class — a dying page still holds the same id
    // for ~300ms after openPage tears it down, and it wins.
    host.querySelector('#cal-prev') ?.addEventListener('click', () => { _mk = shiftMonth(_mk, -1); paint(root); });
    host.querySelector('#cal-next') ?.addEventListener('click', () => { _mk = shiftMonth(_mk,  1); paint(root); });
    host.querySelector('#cal-today')?.addEventListener('click', () => { _mk = H().monthKey(H().today()); paint(root); });
    host.querySelector('#cal-new')  ?.addEventListener('click', () => openMeetingEditor(null, { day: todayIso }, () => paint(root)));
    host.querySelectorAll('.cal-cell[data-day]').forEach(el =>
      el.addEventListener('click', () => openDayAgenda(el.getAttribute('data-day'), byDay[el.getAttribute('data-day')] || [], () => paint(root))));
    if (window.lucide) lucide.createIcons({ nodes: [host] });
  }

  function shiftMonth(mk, n) {
    const [y, m] = mk.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1, 4));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  /* ── Day agenda — its own window (the mobile window model) ───────────── */
  function openDayAgenda(iso, items, onChange) {
    const h = H(), me = h.uid();
    const label = h.dayDate(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', day: 'numeric', month: 'long' });
    const panel = window.openPage(`${h.ico('📅', 16)} ${h.esc(label)}`,
      items.length ? items.map(m => `
        <div class="card" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
            <div style="flex:1;min-width:0">
              <div style="font-weight:800">${m._followUp ? '↩ Follow-up — ' : ''}${h.esc(m.title)}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                ${m._followUp ? '' : h.esc(h.hhmm(m.startAt)) + (m.endAt ? '–' + h.esc(h.hhmm(m.endAt)) : '')}
                ${m.location ? ' · ' + h.esc(m.location) : ''}
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Organised by ${h.esc(m.organizerName || '—')} · ${h.esc(String((m.invitees || []).length))} invited</div>
            </div>
            <span class="badge ${rsvpBadge(m, me)}">${h.esc(statusOf(m, me))}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
            <button class="btn-secondary" data-open="${h.esc(m.id)}">Open</button>
          </div>
        </div>`).join('')
        : `<div class="empty-state"><div class="empty-icon">${h.ico('📅', 36)}</div><h4>Nothing scheduled</h4></div>`,
      `<button class="btn-primary" id="day-new">${h.ico('➕', 14)} New meeting</button><button class="btn-secondary" onclick="closeModal()">Close</button>`);

    panel.querySelector('#day-new')?.addEventListener('click', () => openMeetingEditor(null, { day: iso }, onChange));
    panel.querySelectorAll('[data-open]').forEach(b =>
      b.addEventListener('click', () => openMeetingView(b.getAttribute('data-open'), onChange)));
    if (window.lucide) lucide.createIcons({ nodes: [panel] });
  }

  function rsvpBadge(m, me) {
    const r = (m.rsvp || {})[me];
    return r === 'yes' ? 'badge-green' : r === 'no' ? 'badge-red' : r === 'maybe' ? 'badge-orange' : 'badge-gray';
  }

  /* ── One meeting ─────────────────────────────────────────────────────── */
  window.openMeetingView = async function (id, onChange) {
    const h = H();
    const panel = window.openPage(`${h.ico('📅', 16)} Meeting`,
      window.skeletonHtml ? window.skeletonHtml('rows') : '<p>Loading…</p>',
      `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    const body = panel.querySelector('.page-panel-body');
    let m = null, denied = false;
    try { m = await window.Meetings.get(id); } catch (_) { denied = true; }
    if (!panel.isConnected) return;
    if (!m) {
      body.innerHTML = `<div class="empty-state"><div class="empty-icon">${h.ico(denied ? '🔒' : '❓', 36)}</div>
        <h4>${denied ? 'You are not on this meeting' : 'Meeting not found'}</h4>
        <p style="color:var(--text-muted);font-size:13px">${denied ? 'Only the people invited — and the President, a Manager or the Corporate Secretary — can open it.' : 'It may have been deleted.'}</p></div>`;
      return;
    }

    const me = h.uid();
    const mine = m.organizerUid === me;
    const ended = (() => { try { const e = m.endAt && m.endAt.toDate ? m.endAt.toDate() : null; return e && e.getTime() < Date.now(); } catch (_) { return false; } })();
    const counts = { yes: 0, no: 0, maybe: 0 };
    Object.values(m.rsvp || {}).forEach(v => { if (counts[v] != null) counts[v]++; });

    // ORGANISER-ONLY WRITE, ON PURPOSE — `mine` gates Edit, "Notes & follow-up"
    // and "Cancel meeting" below, and must keep gating them.
    // The whole-company READ is a different question and a settled one: the
    // oversight tier (isAdminTier — President, Manager, Corporate Secretary; see
    // loadMonth) opens every meeting on purpose, and narrowing that is a schema
    // change, not a gate change, because a meeting carries no department field.
    // WRITE was never granted alongside it. firestore.rules narrows meeting
    // update/cancel/delete to the organiser or a SENIOR admin — which excludes
    // the Corporate Secretary — so rendering any of these three on a meeting
    // somebody else organised would be a control whose tap is refused, this
    // app's most common defect class. A "cancel on the President's behalf"
    // power, if ever wanted, needs the rule widened first, not this gate.
    body.innerHTML = `
      ${m.status === 'cancelled' ? `<div class="alert-banner" style="cursor:default;margin-bottom:12px"><span>${h.ico('⚠', 16)} This meeting was cancelled.</span></div>` : ''}
      <div class="card">
        <div style="font-size:17px;font-weight:800">${h.esc(m.title)}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:4px">
          ${h.esc(h.dayOf(m.startAt))} · ${h.esc(h.hhmm(m.startAt))}${m.endAt ? '–' + h.esc(h.hhmm(m.endAt)) : ''}
        </div>
        ${m.location ? `<div style="font-size:13px;margin-top:6px">${h.ico('📍', 13)} ${h.esc(m.location)}</div>` : ''}
        ${m.agenda ? `<div style="margin-top:10px;white-space:pre-wrap;font-size:13px">${h.esc(m.agenda)}</div>` : ''}
        <div style="font-size:12px;color:var(--text-muted);margin-top:10px">
          Organised by ${h.esc(m.organizerName || '—')} · ${h.esc(String((m.invitees || []).length))} invited
          · ${counts.yes} going, ${counts.maybe} maybe, ${counts.no} declined
        </div>
      </div>

      ${m.status === 'cancelled' ? '' : `
      <div class="card" style="margin-top:10px">
        <div class="card-header"><h3>Your reply</h3></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${[['yes', 'Going'], ['maybe', 'Maybe'], ['no', 'Cannot make it']].map(([k, lbl]) =>
            `<button class="btn-${(m.rsvp || {})[me] === k ? 'primary' : 'secondary'}" data-rsvp="${k}">${h.esc(lbl)}</button>`).join('')}
        </div>
      </div>`}

      ${m.notes || m.followUpAt ? `
      <div class="card" style="margin-top:10px">
        <div class="card-header"><h3>Follow-up</h3></div>
        ${m.notes ? `<div style="white-space:pre-wrap;font-size:13px">${h.esc(m.notes)}</div>` : ''}
        ${m.followUpAt ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px">Follow up on ${h.esc(h.dayOf(m.followUpAt))}</div>` : ''}
      </div>` : ''}

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
        <button class="btn-secondary" id="mt-ics">${h.ico('📲', 14)} Add to phone calendar</button>
        ${mine ? `<button class="btn-secondary" id="mt-edit">${h.ico('✎', 14)} Edit</button>` : ''}
        ${mine && ended ? `<button class="btn-secondary" id="mt-follow">${h.ico('📝', 14)} Notes &amp; follow-up</button>` : ''}
        ${mine && m.status !== 'cancelled' ? `<button class="btn-danger" id="mt-cancel">Cancel meeting</button>` : ''}
      </div>`;

    body.querySelectorAll('[data-rsvp]').forEach(b => b.addEventListener('click', async () => {
      const v = b.getAttribute('data-rsvp');
      b.disabled = true;
      try { await window.Meetings.rsvp(m.id, v); Notifs.showToast('Reply saved.'); onChange && onChange(); window.openMeetingView(m.id, onChange); }
      catch (e) { b.disabled = false; Notifs.showToast('Could not save your reply.', 'error'); }
    }));
    body.querySelector('#mt-ics')?.addEventListener('click', () => window.Meetings.downloadIcs(m));
    body.querySelector('#mt-edit')?.addEventListener('click', () => openMeetingEditor(m, null, () => { onChange && onChange(); window.openMeetingView(m.id, onChange); }));
    body.querySelector('#mt-follow')?.addEventListener('click', () => openFollowUp(m, () => { onChange && onChange(); window.openMeetingView(m.id, onChange); }));
    body.querySelector('#mt-cancel')?.addEventListener('click', async () => {
      const ok = window.confirmDialog ? await window.confirmDialog({
        title: 'Cancel this meeting?',
        message: 'Everyone invited keeps the entry on their calendar, marked cancelled.',
        confirmLabel: 'Cancel meeting', cancelLabel: 'Keep it'
      }) : confirm('Cancel this meeting?');
      if (!ok) return;
      try { await window.Meetings.cancel(m.id); Notifs.showToast('Meeting cancelled.'); onChange && onChange(); window.closeModal && closeModal(); }
      catch (_) { Notifs.showToast('Could not cancel the meeting.', 'error'); }
    });
    if (window.lucide) lucide.createIcons({ nodes: [panel] });
  };

  /* ── Create / edit ───────────────────────────────────────────────────── */
  window.openMeetingEditor = async function (existing, opts, onSaved) {
    const h = H(); opts = opts || {};
    const m = existing || {};
    const day   = m.startAt ? h.dayOf(m.startAt) : (opts.day || h.today());
    const start = m.startAt ? h.hhmm(m.startAt) : '09:00';
    const end   = m.endAt   ? h.hhmm(m.endAt)   : '10:00';

    // Invitee list. A denial here must not silently produce a meeting with one
    // attendee — say so instead.
    let people = [], peopleDenied = false;
    try {
      const snap = await db.collection('users').get();
      snap.forEach(d => {
        const u = d.data();
        if (u.removed === true || u.role === 'partner') return;
        people.push({ uid: d.id, name: u.displayName || u.email || d.id });
      });
      people.sort((a, b) => a.name.localeCompare(b.name));
    } catch (_) { peopleDenied = true; }

    const pre = new Set(opts.invitees || m.invitees || []);
    const panel = window.openPage(`${h.ico(existing ? '✎' : '➕', 16)} ${existing ? 'Edit meeting' : 'New meeting'}`, `
      <div class="form-group"><label for="mt-title">Title</label>
        <input id="mt-title" maxlength="140" value="${h.esc(m.title || '')}" placeholder="e.g. Weekly production review"/></div>
      <div class="form-group"><label for="mt-day">Date</label>
        <input id="mt-day" type="date" value="${h.esc(day)}"/></div>
      <div style="display:flex;gap:10px">
        <div class="form-group" style="flex:1"><label for="mt-start">Start</label>
          <input id="mt-start" type="time" value="${h.esc(start)}"/></div>
        <div class="form-group" style="flex:1"><label for="mt-end">End</label>
          <input id="mt-end" type="time" value="${h.esc(end)}"/></div>
      </div>
      <div class="form-group"><label for="mt-loc">Location or link</label>
        <input id="mt-loc" maxlength="300" value="${h.esc(m.location || '')}" placeholder="Office, site, or a meeting link"/></div>
      <div class="form-group"><label for="mt-agenda">Agenda</label>
        <textarea id="mt-agenda" rows="4" maxlength="4000" placeholder="What this meeting is for">${h.esc(m.agenda || '')}</textarea></div>
      <div class="form-group">
        <label>Invite</label>
        ${peopleDenied
          ? `<p style="font-size:12px;color:var(--warning)">The staff list could not be read, so nobody can be added here. The meeting will be yours only.</p>`
          : `<div id="mt-people" style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
              ${/* The tick itself is now the native control — css/styles.css carves
                    checkbox/radio out of the .form-group text-field rule, so DO NOT
                    add width/height back here (that is what produced three different
                    checkbox sizes across the app). Three things still had to be said
                    inline, because this row sits inside a .form-group and inherits
                    `.form-group label` (uppercase, letter-spaced, muted, 600):
                    1. the text reset — these are PEOPLE'S NAMES, not a field caption,
                       and they were rendering as "JUAN DELA CRUZ" in muted grey;
                    2. align-items:flex-start + the 4px nudge on the box — a long name
                       wraps to 2-3 lines and `center` floated the tick into the middle
                       of the block instead of beside the first line;
                    3. padding:10px — the row was a 23px tap target on a phone, and
                       mis-ticking here invites the wrong person. ~41px matches the
                       intent of the 44px `label.check-row` convention in styles.css
                       without adopting its 18px box. */''}
              ${people.map(p => `<label class="check-row check-row-top">
                <input type="checkbox" value="${h.esc(p.uid)}"${pre.has(p.uid) ? ' checked' : ''}/>
                <span>${h.esc(p.name)}</span></label>`).join('')}
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:4px">You are always included. Everyone ticked gets an invite notification now and a reminder on the morning.</p>`}
      </div>`,
      `<button class="btn-primary" id="mt-save">${existing ? 'Save' : 'Create meeting'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    const saveBtn = panel.querySelector('#mt-save');
    saveBtn.addEventListener('click', async () => {
      const title = panel.querySelector('#mt-title').value.trim();
      const d  = panel.querySelector('#mt-day').value;
      const s  = panel.querySelector('#mt-start').value;
      const e  = panel.querySelector('#mt-end').value;
      if (!title) { Notifs.showToast('Give the meeting a title.', 'error'); return; }
      if (!d || !s) { Notifs.showToast('Pick a date and a start time.', 'error'); return; }
      // EXPLICIT +08:00 — never `new Date(d + ' ' + t)`, which parses in the
      // device's timezone and puts a Manila meeting on the wrong day abroad.
      const startAt = h.atTime(d, s);
      const endAt   = h.atTime(d, e || s);
      if (endAt.getTime() < startAt.getTime()) { Notifs.showToast('The end time is before the start time.', 'error'); return; }

      const picked = Array.from(panel.querySelectorAll('#mt-people input:checked')).map(i => i.value);
      const names = {};
      people.forEach(p => { if (picked.includes(p.uid)) names[p.uid] = p.name; });

      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        const id = await window.Meetings.save({
          id: m.id, title,
          agenda: panel.querySelector('#mt-agenda').value,
          location: panel.querySelector('#mt-loc').value,
          startAt, endAt,
          invitees: picked, inviteeNames: names,
          convId: opts.convId || m.convId || null,
          status: m.status || 'scheduled'
        });
        Notifs.showToast(existing ? 'Meeting updated.' : 'Meeting created — invites sent.');
        window.closeModal && closeModal();
        onSaved && onSaved(id);
      } catch (err) {
        saveBtn.disabled = false; saveBtn.textContent = existing ? 'Save' : 'Create meeting';
        Notifs.showToast((err && err.code === 'permission-denied')
          ? 'You are not allowed to save this meeting.' : 'Could not save the meeting.', 'error');
      }
    });
    if (window.lucide) lucide.createIcons({ nodes: [panel] });
  };

  /* ── Notes + follow-up date ──────────────────────────────────────────── */
  function openFollowUp(m, onSaved) {
    const h = H();
    const panel = window.openPage(`${h.ico('📝', 16)} Notes &amp; follow-up`, `
      <div class="form-group"><label for="fu-notes">What was decided</label>
        <textarea id="fu-notes" rows="6" maxlength="4000">${h.esc(m.notes || '')}</textarea></div>
      <div class="form-group"><label for="fu-date">Follow up on (optional)</label>
        <input id="fu-date" type="date" value="${h.esc(m.followUpAt ? h.dayOf(m.followUpAt) : '')}"/>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px">A follow-up date shows on the calendar as its own entry and is included in that morning's reminder.</p></div>`,
      `<button class="btn-primary" id="fu-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    panel.querySelector('#fu-save').addEventListener('click', async () => {
      const d = panel.querySelector('#fu-date').value;
      try {
        await window.Meetings.save({
          id: m.id, title: m.title, agenda: m.agenda, location: m.location,
          startAt: m.startAt, endAt: m.endAt, invitees: m.invitees, inviteeNames: m.inviteeNames,
          convId: m.convId, status: m.status,
          notes: panel.querySelector('#fu-notes').value,
          followUpAt: d ? h.atTime(d, '09:00') : null
        });
        Notifs.showToast('Saved.');
        window.closeModal && closeModal();
        onSaved && onSaved();
      } catch (_) { Notifs.showToast('Could not save.', 'error'); }
    });
  }
})();
