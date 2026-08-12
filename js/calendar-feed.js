/* ═══════════════════════════════════════════════════════════════════════
   BARRO INDUSTRIES — UNIFIED CALENDAR FEED (window.CalendarFeed)
   COMPANY-AND-CALENDAR-SPEC-2026-08-12 §2.

   The defect this file fixes: the dashboard mini calendar (renderMiniCal,
   js/screens/dashboards.js) used to read ONLY the viewer's own tasks, and the
   drawer Calendar page (renderCalendarPage, js/meetings.js) used to read
   ONLY window.Meetings.loadMonth. A meeting had no dot on the dashboard; a
   task deadline appeared nowhere on the drawer grid. Both surfaces now read
   from THIS one function instead, so they can never disagree again.

   SCOPING MUST NOT WIDEN (§2.4, must-hold). This file adds no read either
   surface could not already perform on its own:
     - meetings: unchanged — delegates straight to window.Meetings.loadMonth,
       which already applies the oversight-tier / invitee scoping mirrored
       from firestore.rules' match /meetings/{meetingId}.
     - tasks: own-assigned only (narrower than the read rule allows).
     - leave: own docs only (narrower than the read rule allows).
     - biddings / deliveries: reads already permitted to all internal staff
       by firestore.rules; this file only narrows the AUDIENCE further,
       client-side, before ever issuing the read.
   Partners get no calendar nav entry; a deep-link's meetings leg is denied by
   the rule exactly as before, and every other source here soft-fails closed.

   LOAD ORDER — immediately after js/meetings.js (index.html), so
   window.Meetings._h (the Manila date helpers) is guaranteed defined before
   this file's top-level IIFE runs. Every OTHER global this file touches
   (getPHHolidays, leaveType, isAdminPriv, DEPARTMENTS, dbCachedGet, db,
   currentUser…) is a RUNTIME reference inside async function bodies, never
   read at parse time — the same forward-reference convention every other
   file in this app uses, so load order relative to people.js/departments.js/
   production.js (all of which load AFTER this file) does not matter.
   ═══════════════════════════════════════════════════════════════════════ */

window.CalendarFeed = (function () {
  'use strict';

  function H() { return window.Meetings && window.Meetings._h; }

  // Route every read through dbCachedGet when it's available (it always is,
  // js/config.js loads first) — falls back to a bare fetch only so this file
  // never hard-depends on load order it doesn't otherwise need.
  function cget(key, fetcher, ttlMs) {
    return (typeof window.dbCachedGet === 'function')
      ? window.dbCachedGet(key, fetcher, ttlMs)
      : fetcher();
  }

  function monthYear(mk) { return parseInt(mk.slice(0, 4), 10); }

  /* ── Source 1: PH holidays — in-memory table, ~0 cost ─────────────────
     getPHHolidays(year) (js/screens/people.js) already merges the admin
     overrides prefetched into window._holidayOverrides at boot
     (window.loadHolidayOverrides) — reuse it as-is, no second fetcher. */
  function holidayEntries(mk) {
    try {
      if (typeof window.getPHHolidays !== 'function') return [];
      const table = window.getPHHolidays(monthYear(mk));
      const out = [];
      Object.keys(table || {}).forEach(function (date) {
        if (date.slice(0, 7) !== mk) return;
        const h = table[date] || {};
        out.push({
          kind: 'holiday', date: date,
          title: String(h.name || 'Holiday') + (h.type === 'special' ? ' (special)' : ''),
          time: null, id: null, raw: null
        });
      });
      return out;
    } catch (_) { return []; }
  }

  /* ── Source 2: own task deadlines — THE EXACT query + cache key
     renderMiniCal already ran, so the read is shared, not duplicated. */
  async function taskEntries(mk, uid) {
    const fetcher = () => db.collection('tasks').where('assignedTo', 'array-contains', uid).get()
      .catch(() => db.collection('tasks').where('assignedTo', '==', uid).get());
    const snap = await cget('tasks-cal-' + uid, fetcher, 30000);
    const out = [];
    (snap.docs || []).forEach(function (d) {
      const t = d.data();
      if (!t.dueDate) return;
      if (['done', 'approved', 'archived'].includes(t.status)) return;
      if (String(t.dueDate).slice(0, 7) !== mk) return;
      out.push({
        kind: 'task', date: String(t.dueDate).slice(0, 10),
        title: String(t.title || 'Task'), time: null, id: d.id, raw: t
      });
    });
    return out;
  }

  /* ── Source 3: meetings + follow-ups — delegates to window.Meetings ───
     Scoping is INHERITED, unchanged, from Meetings.loadMonth (oversight tier
     vs invitee-only) — this file adds no read on top of it. */
  async function meetingEntries(mk, uid) {
    const list = await cget('cal-meetings-' + uid + '-' + mk, () => window.Meetings.loadMonth(mk), 60000);
    const h = H();
    const out = [];
    (list || []).forEach(function (m) {
      if (m.status === 'cancelled') return;
      const d = h.dayOf(m.startAt);
      if (d) out.push({
        kind: 'meeting', date: d, title: String(m.title || 'Meeting'),
        time: h.hhmm(m.startAt) || null, id: m.id, raw: m
      });
      if (m.followUpAt) {
        const f = h.dayOf(m.followUpAt);
        if (f) out.push({
          kind: 'followup', date: f, title: '↩ ' + String(m.title || 'Meeting'),
          time: null, id: m.id, raw: m
        });
      }
    });
    return out;
  }

  /* ── Source 4: own approved leave — OWN ONLY for everyone (D6: default
     OUT for "show colleagues' leave too"). Equality-only query, no composite
     index needed.
     ⚠ SPEC DEVIATION (documented, not silent): the spec's copy formula was
     `(type label) + ' leave'`. window.leaveType()'s labels (js/screens/
     people.js LEAVE_TYPES) are already "Vacation Leave" / "Sick Leave" /
     "Emergency Leave" / "Unpaid Leave" — appending another " leave" would
     read as "Vacation Leave leave". The label alone already says it; this
     file renders it as-is instead of double-suffixing. */
  async function leaveEntries(mk, uid) {
    const fetcher = () => db.collection('leave_requests')
      .where('userId', '==', uid).where('status', '==', 'approved').get();
    const snap = await cget('cal-leave-' + uid, fetcher, 300000);
    const h = H();
    const out = [];
    (snap.docs || []).forEach(function (d) {
      const r = d.data();
      if (!r.startDate || !r.endDate) return;
      const lt = (typeof window.leaveType === 'function') ? window.leaveType(r.type) : null;
      const label = lt ? String(lt.label) : 'Leave';
      let cur = r.startDate, guard = 0;
      while (cur <= r.endDate && guard++ < 400) {
        if (cur.slice(0, 7) === mk) {
          out.push({ kind: 'leave', date: cur, title: label, time: null, id: d.id, raw: r });
        }
        cur = h.addDays(cur, 1);
      }
    });
    return out;
  }

  /* ── Source 5: government bidding deadlines ────────────────────────────
     ⚠ SPEC DEVIATION (documented, not silent): the spec names a single
     `gov_biddings` collection. No such collection exists in this codebase —
     Government Biddings is physically THREE collections (window.GOV_BUCKETS,
     js/screens/govit.js): gov_philgeps, gov_active_bids, gov_archive, each
     with the identical rule the spec quoted
     (`allow read: if isAuth() && !isPartner()`). Reads all three under the
     ONE cache key the spec specifies, combines them, and excludes terminal
     statuses (won/lost/cancelled/archived) exactly as instructed. */
  async function biddingEntries(mk) {
    const inGovDept = (window.currentDepts || []).includes('Government Biddings');
    const isAdmin = (typeof window.isAdminPriv === 'function') && window.isAdminPriv();
    if (!inGovDept && !isAdmin) return [];   // D7 audience gate — never even reads otherwise
    const TERMINAL = ['won', 'lost', 'cancelled', 'archived'];
    const fetcher = () => Promise.all([
      db.collection('gov_philgeps').get(),
      db.collection('gov_active_bids').get(),
      db.collection('gov_archive').get()
    ]).then(function (snaps) {
      const docs = [];
      snaps.forEach(function (s) { (s.docs || []).forEach(function (d) { docs.push(d); }); });
      return { docs: docs };
    });
    const snap = await cget('gov_biddings-cal', fetcher, 300000);
    const out = [];
    (snap.docs || []).forEach(function (d) {
      const b = d.data();
      if (!b.deadline) return;
      if (TERMINAL.includes(b.status)) return;
      if (String(b.deadline).slice(0, 7) !== mk) return;
      out.push({
        kind: 'bidding', date: String(b.deadline).slice(0, 10),
        title: String(b.title || b.name || 'Bidding'), time: null, id: d.id, raw: b
      });
    });
    return out;
  }

  /* ── Source 6: delivery target dates ───────────────────────────────────
     Audience (D8): Production/Sales/Design depts + president/manager/
     secretary. SHARES the 'job_projects' cache key with the Company page
     (Part 1) — free within the TTL. NEVER money fields. */
  async function deliveryEntries(mk) {
    const inDept = (window.currentDepts || []).some(function (d) {
      return ['Production', 'Sales', 'Design'].includes(d);
    });
    const isAdmin = (typeof window.isAdminPriv === 'function') && window.isAdminPriv();
    if (!inDept && !isAdmin) return [];
    const ACTIVE_EXCLUDE = ['completed', 'paid', 'cancelled'];
    const fetcher = () => db.collection('job_projects').get();
    const snap = await cget('job_projects', fetcher, 300000);
    const out = [];
    (snap.docs || []).forEach(function (d) {
      const p = d.data();
      if (ACTIVE_EXCLUDE.includes(p.stage)) return;
      if (!p.targetDate) return;
      if (String(p.targetDate).slice(0, 7) !== mk) return;
      out.push({
        kind: 'delivery', date: String(p.targetDate).slice(0, 10),
        title: 'Delivery — ' + String(p.name || 'Project'), time: null, id: d.id, raw: p
      });
    });
    return out;
  }

  const KIND_ORDER = { holiday: 0, meeting: 1, followup: 1, task: 2, leave: 3, bidding: 4, delivery: 5 };

  async function loadMonth(mk) {
    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '';
    const denied = { meetings: false, tasks: false, leave: false, biddings: false, deliveries: false };
    const days = {};
    function push(list) {
      (list || []).forEach(function (e) { (days[e.date] = days[e.date] || []).push(e); });
    }

    const results = await Promise.allSettled([
      Promise.resolve().then(function () { return holidayEntries(mk); }),
      uid ? taskEntries(mk, uid)    : Promise.resolve([]),
      uid ? meetingEntries(mk, uid) : Promise.resolve([]),
      uid ? leaveEntries(mk, uid)   : Promise.resolve([]),
      biddingEntries(mk),
      deliveryEntries(mk)
    ]);
    const [holR, taskR, meetR, leaveR, bidR, delR] = results;
    push(holR.status === 'fulfilled' ? holR.value : []);
    if (taskR.status  === 'fulfilled') push(taskR.value);  else denied.tasks      = true;
    if (meetR.status  === 'fulfilled') push(meetR.value);  else denied.meetings   = true;
    if (leaveR.status === 'fulfilled') push(leaveR.value); else denied.leave      = true;
    if (bidR.status   === 'fulfilled') push(bidR.value);   else denied.biddings   = true;
    if (delR.status   === 'fulfilled') push(delR.value);   else denied.deliveries = true;

    Object.keys(days).forEach(function (d) {
      days[d].sort(function (a, b) {
        const ka = KIND_ORDER[a.kind] != null ? KIND_ORDER[a.kind] : 9;
        const kb = KIND_ORDER[b.kind] != null ? KIND_ORDER[b.kind] : 9;
        if (ka !== kb) return ka - kb;
        if (a.time && b.time) return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0);
        if (a.time) return -1;
        if (b.time) return 1;
        return 0;
      });
    });

    return { monthKey: mk, days: days, denied: denied };
  }

  function invalidate(kind) {
    if (typeof window.dbCacheInvalidate !== 'function') return;
    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '';
    if (!kind || kind === 'meetings') window.dbCacheInvalidate('cal-meetings');   // clears every cal-meetings-* via the config.js _alias map
    if ((!kind || kind === 'tasks') && uid) window.dbCacheInvalidate('tasks-cal-' + uid);
    if ((!kind || kind === 'leave') && uid) window.dbCacheInvalidate('cal-leave-' + uid);
    if (!kind) {
      window.dbCacheInvalidate('job_projects');
      window.dbCacheInvalidate('gov_biddings-cal');
    }
  }

  return { loadMonth: loadMonth, invalidate: invalidate };
})();
