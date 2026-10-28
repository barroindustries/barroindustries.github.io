#!/usr/bin/env node
/**
 * BARRO INDUSTRIES — purge the data of the retired external-partner feature
 * scripts/partner-data-purge.js
 *
 * specs/PARTNER-REMOVAL-SPEC.md WS-F, with the OWNER ANSWERS of section 8 (2026-10-28), which override the section 7 defaults:
 *   Q1  HARD-DELETE the partner Auth users and their users/{uid} docs, plus the per-uid docs they own (payroll/{uid}, notifications/{uid}/items, ...).
 *   Q3  "There are no BS staff": the dry run also COUNTS (never deletes) accounts whose only department is Brilliant Steel but whose role is not partner.
 *   Q4  DELETE the mixed staff-partner conversations too (with their messages), not just the wholly-partner ones.
 *   Q5  delete the partner-made approval requests and the quotes they point to; the JSON backup is the record.
 * Nothing here can be undone except from the JSON backup, so the order of work is fixed: read -> select -> report -> BACKUP (written, read back and
 * checksummed) -> only then delete.
 *
 * WHO IS A PARTNER (select(), pure and exported). A users doc is a partner when ANY of these is true, each compared trimmed and case-insensitively
 * (production carries 'Partner' drift): role is 'partner'; team is 'partner'; title is 'partner'; departments (or the legacy department string)
 * includes 'Partners'. GUARD: an account whose role is president / owner / admin / manager / secretary / finance is never taken on a team/title/
 * department marker alone - it is listed under "needs a look" and kept. Auth accounts whose custom claim says role 'partner' but that have no users
 * doc at all are also partner accounts (they are included, and reported separately); an Auth claim of 'partner' on an account whose users doc says
 * otherwise is "needs a look" and is not touched.
 *
 * WHAT GOES (all of it id-keyed; select() never mutates its input):
 *   bs_quotes          createdByRole 'partner', OR createdBy / draftBy a partner uid, OR company 'PT', OR the draft slot draft_<partner uid>.
 *                      Staff-made Brilliant Steel quotes stay. A doc whose createdByRole says partner but whose creator is a known staff account
 *                      (the old 'createdByRole: currentRole || partner' fallback) is "needs a look" and stays.
 *   partner_deals      every doc.
 *   sops               the SOP the retired feature seeded into Firestore: "Partner Deal Process (50/50)" (js/screens/dashboards.js DEFAULT_SOPS,
 *                      written with an auto id, so the TITLE is the only handle). Matched as /\bpartner[\s\-_]*deals?\b/i - the seed title and
 *                      an edited "Partner Deals ..." form, but not an unrelated SOP such as "Partner Dealer Onboarding".
 *   approval_requests  agentId a partner uid, OR quoteId one of the deleted quotes.
 *   posts              dept 'Partners', OR authorId a partner uid.
 *   conversations      DELETED: wholly-partner conversations, direct staff-partner threads (exactly ONE non-partner member, owner Q4) and the Partners
 *                      department channel (dept_Partners), each with its sub-collections (messages, readers, typing, anything listCollections() finds).
 *                      KEPT: a mixed GROUP chat (two or more non-partner members; coordinator change 2026-10-28). The partner is taken out of it:
 *                      their uid leaves `participants` and the per-member maps (participantNames, reads, pinnedBy, mutedBy, archivedBy), the messages
 *                      THEY wrote (authorId) and their readers/typing marks are deleted, and a last-message preview that was their words is blanked.
 *                      Nothing else on the doc changes. This is the only write besides deletes (an update with
 *                      FieldValue.arrayRemove / delete); the original docs are in the backup. Every other department channel is never touched: their
 *                      participants list is empty by rule, so they cannot be matched by membership.
 *   per-uid docs       notifications/{uid} + its items, payroll/{uid}, kpi_evals/{uid}, kpi_targets/{uid}, leave_balances/{uid},
 *                      attendance/{uid} + records, personal_todos/{uid} + items, and the usernames/{name} docs of those accounts (matched by uid or
 *                      by the account's email - that doc maps a username to an email and is publicly readable).
 *   sub-collections    Firestore does NOT delete a doc's sub-collections with the doc, so for every selected document listCollections() is asked and
 *                      whatever hangs under it is backed up and deleted first (none exists in the app today outside the ones named above).
 *   Auth users         admin.auth().deleteUser (user-not-found is tolerated).
 *   users/{uid}        deleted LAST, so a run that dies half way can be repeated: the users docs are how the next run finds the partner uids.
 * ORDER: children before parents (a partner's messages in a kept group chat go BEFORE the partner leaves its member list, so a repeat run still finds
 * them), then the group chats are edited, then the Auth accounts (the step that cannot be undone), then the users docs.
 * REPORTED ONLY, never changed: job_projects tagged with a partner uid (partnerUid) or created by one (they are real Barro projects; they keep
 * their legacy fields), accounts that need a look, Brilliant-Steel-only non-partner accounts.
 * NOT covered: Firebase Storage objects and any other collection that merely mentions a partner uid (tasks, audit_log, meetings, ...); a partner's
 * reaction on a staff message; pins of a deleted partner message in a kept group chat; messages a partner wrote in a conversation they had
 * ALREADY left. Per Q1 an old record may show an unknown author; the app must tolerate a missing users doc.
 *
 * SAFE BY DEFAULT.
 *   DRY RUN is the default: it reads, prints COUNTS ONLY, and writes nothing. It never prints a price, a total, an item, a client or person name,
 *   an email, a phone number or a message. Partner uids are printed only behind --show-uids.
 *   --backup <dir> additionally writes the export (see below); --apply deletes, and REFUSES unless --backup <dir> is in the same command and the
 *   export was written, read back and checksummed in this run. --apply also refuses if the selection would remove every account or the last
 *   president/owner account. A kept group chat's doc is only touched through FieldValue.arrayRemove / delete, never rewritten.
 *   After --apply a verification pass re-reads Firestore and Auth; anything partner-made that is still there makes the exit code 2.
 *   The backup directory must be OUTSIDE this repository (it holds personal data and the repository is public).
 *
 * BACKUP (<dir>): one JSON file per bucket, each an array of { id, ...fields } with Timestamps as ISO-8601 strings - the same format as
 * scripts/monthly-backup.js writes and scripts/restore-from-backup.js revives. Subcollection files are named <parent>__<sub>.json with ids
 * "parentId/subId" (e.g. conversations__messages.json). auth-users.json holds Auth metadata ONLY (uid, email, name, phone, disabled, claims,
 * providers, sign-in times) - never a password hash. manifest.json is written LAST (counts only, plus a sha256 per file) and means "complete".
 * Refuses a directory that already holds a manifest.json.
 *
 * Required env (same as scripts/migrate-files-hub.js and flip-top-gauge-default.js):
 *   FIREBASE_SERVICE_ACCOUNT - Firebase Admin SDK JSON (stringified)
 *
 * Run locally (PARTNER-REMOVAL-SPEC phase 2):
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/partner-data-purge.js                                  # dry run: counts only
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/partner-data-purge.js --backup <dir>                   # dry run + export
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/partner-data-purge.js --backup <dir> --apply           # delete
 *
 * NOT run by any workflow - a manual step the owner approves after seeing the dry-run counts. The selection (select), the report, the backup
 * serialisation and the runner (run) are exported and covered by tests/partner-data-purge.test.mjs, which never touches Firebase.
 */

'use strict';

const crypto = require('crypto');
const nodeFs = require('fs');
const nodePath = require('path');

const TOOL = 'scripts/partner-data-purge.js';
const REPO_ROOT = nodePath.resolve(__dirname, '..');
const SELECTION_VERSION = 1;
const BATCH = 400;                          // Firestore allows 500 operations per batch; the spec asks for at most 400

// The ONLY roles that are never taken on a team / title / department marker alone (the guard against disabling an admin by accident).
const PRIVILEGED_ROLES = new Set(['president', 'owner', 'admin', 'manager', 'secretary', 'finance']);
// Roles one of which must survive the purge.
const KEEP_ROLES = ['president', 'owner'];

// Per-uid docs: [root collection (doc id = the uid), the subcollections known to hang off it]. listCollections() adds any others found.
const PER_UID = [
  ['notifications', ['items']],
  ['payroll', []],
  ['kpi_evals', []],
  ['kpi_targets', []],
  ['leave_balances', []],
  ['attendance', ['records']],
  ['personal_todos', ['items']],
];
const PER_UID_KEYS = [].concat(...PER_UID.map(([c, subs]) => [c].concat(subs.map((s) => c + '/' + s))));
const PER_UID_ROOTS = PER_UID.map(([c]) => c);
const CONVERSATION_SUBS = ['messages', 'readers', 'typing'];
// The per-member maps on a conversation doc, keyed by uid (js/chat.js, firestore.rules): display names, read marks, pin / mute / archive flags.
const GROUP_UID_MAPS = ['participantNames', 'reads', 'pinnedBy', 'mutedBy', 'archivedBy'];
const UID_FIELD_RE = /^[A-Za-z0-9_-]{1,128}$/;       // a uid is only ever put in a dotted field path ("reads.<uid>") when it is this plain
const READ_COLLECTIONS = ['users', 'bs_quotes', 'partner_deals', 'approval_requests', 'posts', 'conversations', 'job_projects', 'usernames', 'sops'];
// The seeded "Partner Deal Process (50/50)" SOP (see the header). Word-bounded on purpose: the bare /partner deal/i would also take "Partner Dealer ...".
const PARTNER_SOP_RE = /\bpartner[\s\-_]*deals?\b/i;

// The export holds personal data (emails, phone numbers, messages) and this repository is PUBLIC, every file of it served verbatim by GitHub
// Pages - a backup written inside it could be committed and published by accident. Compared case-insensitively (the file systems are).
function insideRepo(dir, root) {
  const d = nodePath.resolve(dir).toLowerCase();
  const r = nodePath.resolve(root || REPO_ROOT).toLowerCase();
  return d === r || d.indexOf(r + nodePath.sep) === 0;
}
const insideMessage = (dir) => 'the backup directory (' + dir + ') is inside this repository. The export holds personal data and the repository is public - choose a folder OUTSIDE it.';

// ── small pure helpers ───────────────────────────────────────────────────────
const norm = (v) => (v == null ? '' : String(v)).trim().toLowerCase();
const arr = (v) => (Array.isArray(v) ? v : []);
const dataOf = (rec) => (rec && rec.data && typeof rec.data === 'object' ? rec.data : {});
const recs = (v) => arr(v).filter((r) => r && typeof r.id === 'string' && r.id !== '');   // a record is { id, data }: the REAL doc id and the doc's fields
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const fileFor = (key) => key.replace('/', '__') + '.json';

// Departments the way the partner arm sees them: every spelling, either field.
function allDepts(d) {
  const out = arr(d.departments).slice();
  if (d.department != null) out.push(d.department);
  return out.map(norm).filter(Boolean);
}
// Departments the way the app sees them (js/app.js loadUserProfile -> currentDepts): the array when it has entries, else the legacy string.
function appDepts(d) {
  const list = arr(d.departments);
  if (list.length) return list;
  return d.department ? [d.department] : [];
}
function isBsOnly(d) {
  const set = new Set(appDepts(d).map(norm).filter(Boolean));
  return set.size === 1 && set.has('brilliant steel');
}
function evidenceOf(d) {
  return {
    role: norm(d.role) === 'partner',
    team: norm(d.team) === 'partner',
    title: norm(d.title) === 'partner',
    dept: allDepts(d).includes('partners'),
  };
}

// ── the selection ────────────────────────────────────────────────────────────
// select(snapshots) -> what the purge would touch. Every input is an array of records { id, data } (id = the real doc id, data = the doc's
// fields; the id is never read from the fields, so a data field called "id" cannot redirect a delete). Inputs: users, bs_quotes, partner_deals, sops,
// approval_requests, posts, conversations, job_projects, usernames, authUsers (plain { uid, email, customClaims }), notificationsByUid
// ({ uid: [record] }), perUid ({ 'collection' | 'collection/sub': [record] }; sub-docs carry the id "uid/subId"), knownPartnerUids (uids to treat as
// partners even though no users doc is left - the post-apply verification passes the purged uids), groupChildren ({ 'conversations/messages' | 'conversations/readers' |
// 'conversations/typing': [record with id "convId/childId"] } - the children of the kept group chats). Missing inputs are empty. Never mutates.
function select(input) {
  const inp = input || {};
  const users = recs(inp.users);
  const authUsers = arr(inp.authUsers);
  const needsLook = { users: [], auth: [], bsQuotes: [] };

  // 1. accounts
  const partnerUsers = [];
  const userEvidence = {};
  for (const r of users) {
    const d = dataOf(r);
    const ev = evidenceOf(d);
    if (!(ev.role || ev.team || ev.title || ev.dept)) continue;
    if (!ev.role && PRIVILEGED_ROLES.has(norm(d.role))) { needsLook.users.push(r.id); continue; }   // never an admin on a marker alone
    partnerUsers.push(r);
    userEvidence[r.id] = ev;
  }
  const userIds = new Set(users.map((r) => r.id));
  const fromProfiles = new Set(partnerUsers.map((r) => r.id));
  const authOnly = [];
  for (const a of authUsers) {
    if (!a || typeof a.uid !== 'string') continue;
    if (norm(a.customClaims && a.customClaims.role) !== 'partner') continue;
    if (!userIds.has(a.uid)) authOnly.push(a.uid);                       // a partner account with no profile at all
    else if (!fromProfiles.has(a.uid)) needsLook.auth.push(a.uid);       // the claim says partner, the profile does not
  }
  const known = arr(inp.knownPartnerUids).filter((u) => typeof u === 'string' && u);
  const partnerUids = Array.from(new Set(partnerUsers.map((r) => r.id).concat(authOnly, known))).sort();
  const P = new Set(partnerUids);
  const staff = new Set(users.filter((r) => !P.has(r.id)).map((r) => r.id));   // accounts that exist and are NOT being removed

  // Q3: Brilliant-Steel-only accounts that are not partners - reported, never selected
  const bsOnlyNonPartner = users
    .filter((r) => !P.has(r.id) && norm(dataOf(r).role) !== 'partner' && isBsOnly(dataOf(r)))
    .map((r) => r.id).sort();

  // 2. bs_quotes: the staff-vs-partner split
  const bsQuotes = [];
  let bsQuotesKept = 0;
  let bsQuotesViaRoleOnly = 0;
  for (const r of recs(inp.bs_quotes)) {
    const d = dataOf(r);
    const draftOwner = r.id.indexOf('draft_') === 0 ? r.id.slice('draft_'.length) : null;
    const byUid = P.has(d.createdBy) || P.has(d.draftBy) || (draftOwner !== null && P.has(draftOwner));
    const byCompany = norm(d.company) === 'pt';
    const byRole = norm(d.createdByRole) === 'partner';
    if (byUid || byCompany) bsQuotes.push(r);
    else if (byRole) {
      if (typeof d.createdBy === 'string' && staff.has(d.createdBy)) needsLook.bsQuotes.push(r.id);   // tagged partner, made by a staff account
      else { bsQuotes.push(r); bsQuotesViaRoleOnly++; }
    } else bsQuotesKept++;
  }
  const quoteIds = new Set(bsQuotes.map((r) => r.id));

  // 3. the other Firestore buckets
  const partnerDeals = recs(inp.partner_deals);
  const partnerSops = recs(inp.sops).filter((r) => PARTNER_SOP_RE.test(dataOf(r).title == null ? '' : String(dataOf(r).title)));
  const approvalRequests = recs(inp.approval_requests).filter((r) => P.has(dataOf(r).agentId) || quoteIds.has(dataOf(r).quoteId));
  const posts = recs(inp.posts).filter((r) => norm(dataOf(r).dept) === 'partners' || P.has(dataOf(r).authorId));

  // 4. conversations. Real schema (js/chat.js): type dm | group | announcement | dept; `participants` is the uid array; a dept channel is
  //    dept_<Department> with participants [] (the rules forbid anything else) so it can only be matched by its department.
  //    By who is left once the partners are taken out:  nobody -> wholly partner (DELETED);  exactly one staff member -> a DIRECT staff-partner thread
  //    (DELETED, owner Q4);  two or more staff members -> a GROUP chat (KEPT: the partner is taken out and only the partner's own messages go).
  const conversationsWhollyPartner = [];
  const conversationsMixed = [];
  const conversationsGroups = [];
  const staffAffected = new Set();
  let mixedDirectMessages = 0;
  for (const r of recs(inp.conversations)) {
    const d = dataOf(r);
    if (norm(d.type) === 'dept' || norm(r.id).indexOf('dept_') === 0) {
      if (norm(d.department) === 'partners' || norm(d.dept) === 'partners' || norm(r.id) === 'dept_partners') conversationsWhollyPartner.push(r);
      continue;                                                          // every other department channel is left alone
    }
    if (!Array.isArray(d.participants)) continue;                        // unverifiable -> not touched
    const parts = Array.from(new Set(d.participants.filter((x) => typeof x === 'string')));
    if (!parts.some((x) => P.has(x))) continue;
    const others = parts.filter((x) => !P.has(x));
    if (!others.length) conversationsWhollyPartner.push(r);
    else if (others.length >= 2) conversationsGroups.push(r);
    else {
      conversationsMixed.push(r);
      if (norm(d.type) === 'dm') mixedDirectMessages++;
      others.forEach((x) => staffAffected.add(x));
    }
  }

  // 4b. what is taken out of the kept group chats: the partner's own messages and read / typing marks, then the partner from the member lists
  const groupIds = new Set(conversationsGroups.map((r) => r.id));
  const gone = groupPartnerChildren(inp.groupChildren, groupIds, P);
  const groupEdits = conversationsGroups.map((r) => groupEditFor(r, P)).filter(Boolean);

  // 5. reported only
  const projects = recs(inp.job_projects);
  const jobProjectsTagged = projects.filter((r) => P.has(dataOf(r).partnerUid));
  const jobProjectsCreatedByPartner = projects.filter((r) => P.has(dataOf(r).createdBy));

  // 6. usernames/{name} = { email, uid }
  const partnerEmails = new Set();
  partnerUsers.forEach((r) => { const e = norm(dataOf(r).email); if (e) partnerEmails.add(e); });
  authUsers.forEach((a) => { if (a && P.has(a.uid) && norm(a.email)) partnerEmails.add(norm(a.email)); });
  const usernames = recs(inp.usernames).filter((r) => {
    const d = dataOf(r);
    return P.has(d.uid) || (norm(d.email) !== '' && partnerEmails.has(norm(d.email)));
  });

  // 7. per-uid docs - filtered by owner here too, so a loader that returned too much still cannot widen the selection
  const perUid = {};
  const bucket = (k) => (perUid[k] = perUid[k] || []);
  PER_UID_KEYS.forEach(bucket);
  const raw = inp.perUid && typeof inp.perUid === 'object' ? inp.perUid : {};
  for (const key of Object.keys(raw)) {
    for (const r of recs(raw[key])) {
      const owner = key.indexOf('/') >= 0 ? r.id.split('/')[0] : r.id;
      if (P.has(owner)) bucket(key).push(r);
    }
  }
  const notes = inp.notificationsByUid && typeof inp.notificationsByUid === 'object' ? inp.notificationsByUid : {};
  for (const uid of Object.keys(notes)) {
    if (!P.has(uid)) continue;
    for (const r of recs(notes[uid])) bucket('notifications/items').push({ id: uid + '/' + r.id, data: r.data });
  }

  return {
    version: SELECTION_VERSION,
    partnerUids,
    users: partnerUsers,
    userEvidence,
    authOnlyUids: authOnly.slice().sort(),
    needsLook,
    bsOnlyNonPartner,
    bsQuotes, bsQuotesKept, bsQuotesViaRoleOnly,
    partnerDeals, partnerSops, approvalRequests, posts,
    conversationsWhollyPartner, conversationsMixed, conversationsGroups,
    groupEdits, groupMessages: gone.messages, groupReaders: gone.readers, groupTyping: gone.typing,
    mixedDirectMessages, mixedStaffAffected: Array.from(staffAffected).sort(),
    jobProjectsTagged, jobProjectsCreatedByPartner,
    usernames,
    notifications: perUid['notifications/items'],
    perUid,
  };
}

// Ids of sub-collection records are "parentId/childId" (doc ids never contain a slash).
const parentOf = (id) => id.slice(0, id.indexOf('/'));
const childOf = (id) => id.slice(id.indexOf('/') + 1);

// Among the children of the given GROUP chats, the ones that belong to a partner: messages they wrote (authorId) and their read / typing marks
// (docs keyed by their uid). Staff messages and marks are never returned. Shared by select() and the post-apply verification.
function groupPartnerChildren(kids, groupIds, P) {
  const k = kids && typeof kids === 'object' ? kids : {};
  const inGroup = (r) => r.id.indexOf('/') > 0 && groupIds.has(parentOf(r.id));
  return {
    messages: recs(k['conversations/messages']).filter((r) => inGroup(r) && P.has(dataOf(r).authorId)),
    readers: recs(k['conversations/readers']).filter((r) => inGroup(r) && P.has(childOf(r.id))),
    typing: recs(k['conversations/typing']).filter((r) => inGroup(r) && P.has(childOf(r.id))),
  };
}

// What has to change on one kept group chat's doc, or null when nothing mentions a partner: the partner uids in `participants`, their keys in the
// per-member maps, and a last-message preview that is the partner's own words (text + sender name blanked). Pins of a deleted message are left:
// the chat shows them as "Message not loaded".
function groupEditFor(rec, P) {
  const d = dataOf(rec);
  const partnerUids = Array.from(new Set(arr(d.participants).filter((x) => typeof x === 'string' && P.has(x)))).sort();
  const mapKeys = {};
  GROUP_UID_MAPS.forEach((m) => {
    const v = d[m];
    const present = v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).filter((u) => P.has(u)).sort() : [];
    if (present.length) mapKeys[m] = present;
  });
  const clearLast = P.has(d.lastMessageBy) && (d.lastMessageText != null || d.lastMessageByName != null);
  if (!partnerUids.length && !Object.keys(mapKeys).length && !clearLast) return null;
  return { id: rec.id, record: rec, partnerUids, mapKeys, clearLast };
}

// The ONE write this script makes besides deletes. FV is the FieldValue class (arrayRemove / delete), so every change is atomic on the server and
// leaves everything else on the doc exactly as it is. A uid is only used in a dotted field path when it is plain, else the run refuses.
function buildGroupPatch(edit, FV) {
  const patch = {};
  if (edit.partnerUids.length) patch.participants = FV.arrayRemove.apply(FV, edit.partnerUids);
  GROUP_UID_MAPS.forEach((m) => (edit.mapKeys[m] || []).forEach((uid) => {
    if (!UID_FIELD_RE.test(uid)) throw new Error('conversations/' + edit.id + ': the uid "' + uid + '" cannot be used in a field path');
    patch[m + '.' + uid] = FV.delete();
  }));
  if (edit.clearLast) { patch.lastMessageText = null; patch.lastMessageByName = null; }
  return patch;
}

// Safety refusals (apply refuses on any; a dry run prints them as a warning). `input` is the same snapshots select() was given.
function safetyProblems(sel, input) {
  const users = recs(input && input.users);
  if (!users.length) return ['the users collection is empty (wrong project or credential?)'];
  const gone = new Set(sel.users.map((r) => r.id));
  const remaining = users.filter((r) => !gone.has(r.id));
  const out = [];
  if (!remaining.length) out.push('the selection would remove every account');
  if (!remaining.some((r) => KEEP_ROLES.indexOf(norm(dataOf(r).role)) >= 0)) out.push('no president/owner account would remain');
  return out;
}

// ── buckets: the one list the report, the backup and the deletion all walk ───
// -> [{ key, records }] in DELETION order (children before parents). `key` is a root collection ("bs_quotes") or "parent/sub" for the docs of a
// subcollection, whose record ids are "parentId/subId". The users docs are always last: they are how a repeat run finds the partner uids.
function bucketsOf(sel, children) {
  const out = [];
  const kids = Object.assign({}, children);
  const fromGroups = { 'conversations/messages': sel.groupMessages, 'conversations/readers': sel.groupReaders, 'conversations/typing': sel.groupTyping };
  Object.keys(fromGroups).forEach((k) => { if (arr(fromGroups[k]).length) kids[k] = arr(kids[k]).concat(fromGroups[k]); });
  Object.keys(kids).sort().forEach((k) => out.push({ key: k, records: kids[k] }));
  out.push({ key: 'conversations', records: sel.conversationsWhollyPartner.concat(sel.conversationsMixed) });
  const keys = Object.keys(sel.perUid);
  keys.filter((k) => k.indexOf('/') >= 0).sort().forEach((k) => out.push({ key: k, records: sel.perUid[k] }));
  keys.filter((k) => k.indexOf('/') < 0).sort().forEach((k) => out.push({ key: k, records: sel.perUid[k] }));
  out.push({ key: 'usernames', records: sel.usernames });
  out.push({ key: 'sops', records: sel.partnerSops });
  out.push({ key: 'posts', records: sel.posts });
  out.push({ key: 'approval_requests', records: sel.approvalRequests });
  out.push({ key: 'bs_quotes', records: sel.bsQuotes });
  out.push({ key: 'partner_deals', records: sel.partnerDeals });
  out.push({ key: 'users', records: sel.users });
  return out;
}

// BACKUP ONLY (nothing is deleted from it): the group chats' docs exactly as they were before the partner was taken out.
function editedOriginals(sel) {
  return { key: 'conversations-group-before-edit', records: sel.groupEdits.map((e) => e.record), manifest: { collection: 'conversations', kind: 'edited-originals' } };
}

// bucket key + record id -> the Firestore path. Never guesses: a malformed id throws instead of pointing somewhere else.
function pathFor(key, id) {
  if (typeof id !== 'string' || id === '') throw new Error('empty document id in ' + key);
  if (key.indexOf('/') < 0) {
    if (id.indexOf('/') >= 0) throw new Error('document id "' + id + '" in ' + key + ' contains a slash');
    return key + '/' + id;
  }
  const parts = key.split('/');
  const cut = id.indexOf('/');
  if (cut < 1 || cut === id.length - 1) throw new Error('sub-document id "' + id + '" in ' + key + ' is not parentId/subId');
  return parts[0] + '/' + id.slice(0, cut) + '/' + parts[1] + '/' + id.slice(cut + 1);
}

// ── the report: counts only ──────────────────────────────────────────────────
function summarize(sel, ctx) {
  const c = ctx || {};
  const buckets = bucketsOf(sel, c.children).map((b) => ({ key: b.key, count: b.records.length }));
  const viaRole = sel.users.filter((r) => sel.userEvidence[r.id] && sel.userEvidence[r.id].role).length;
  const authFound = new Set((c.authUids || []));
  return {
    accounts: {
      total: sel.partnerUids.length,
      withProfile: sel.users.length,
      viaRole,
      viaMarkerOnly: sel.users.length - viaRole,
      authOnly: sel.authOnlyUids.length,
      authFound: sel.partnerUids.filter((u) => authFound.has(u)).length,
    },
    needsLook: { users: sel.needsLook.users.length, auth: sel.needsLook.auth.length, bsQuotes: sel.needsLook.bsQuotes.length },
    bsOnlyNonPartner: sel.bsOnlyNonPartner.length,
    bsQuotes: { selected: sel.bsQuotes.length, viaRoleOnly: sel.bsQuotesViaRoleOnly, keptStaff: sel.bsQuotesKept },
    conversations: {
      whollyPartner: sel.conversationsWhollyPartner.length,
      direct: sel.conversationsMixed.length,
      directMessages: sel.mixedDirectMessages,
      staffAffected: sel.mixedStaffAffected.length,
    },
    groups: {
      partnerRemoved: sel.conversationsGroups.length,
      partnerMessagesDeleted: sel.groupMessages.length,
      partnerMarksDeleted: sel.groupReaders.length + sel.groupTyping.length,
    },
    jobProjects: { tagged: sel.jobProjectsTagged.length, createdByPartner: sel.jobProjectsCreatedByPartner.length },
    buckets,
    totalDocs: buckets.reduce((n, b) => n + b.count, 0),
    read: c.read || {},
  };
}

// Why an account was taken, for --show-uids: the owner can judge the marker-only ones (title / team / department without role partner) by eye.
function armsOf(sel, uid) {
  const ev = sel.userEvidence[uid];
  if (!ev) return sel.authOnlyUids.indexOf(uid) >= 0 ? 'auth claim only' : 'known uid';
  return ['role', 'team', 'title', 'dept'].filter((k) => ev[k]).join(', ');
}

function formatReport(rep, sel, opts) {
  const showUids = !!(opts && opts.showUids);
  const L = [];
  const a = rep.accounts;
  const readKeys = Object.keys(rep.read);
  if (readKeys.length) L.push('Read: ' + readKeys.map((k) => k + ' ' + rep.read[k]).join(', '));
  L.push('');
  L.push('Partner accounts to delete: ' + a.total + '   (users docs ' + a.withProfile + ': ' + a.viaRole + ' by role partner, ' + a.viaMarkerOnly + ' by a team/title/department marker only; Auth-only ' + a.authOnly + ')');
  L.push('  Auth accounts found for them: ' + a.authFound + ' of ' + a.total);
  L.push('Needs a look - NOT deleted:');
  L.push('  accounts with an admin role and a partner marker: ' + rep.needsLook.users);
  L.push('  Auth accounts whose claim says partner but whose profile does not: ' + rep.needsLook.auth);
  L.push('  bs_quotes tagged partner but created by a staff account: ' + rep.needsLook.bsQuotes);
  L.push('Brilliant-Steel-only accounts whose role is not partner (Q3, reported only, NOT deleted): ' + rep.bsOnlyNonPartner);
  L.push('Documents to delete: ' + rep.totalDocs + ' in total');
  rep.buckets.forEach((b) => {
    let extra = '';
    if (b.key === 'sops') extra = '   (the seeded "Partner Deal Process (50/50)" SOP, matched by title)';
    if (b.key === 'bs_quotes') extra = '   (' + rep.bsQuotes.keptStaff + ' staff-made kept; ' + rep.bsQuotes.viaRoleOnly + ' chosen by createdByRole alone, creator unknown)';
    if (b.key === 'conversations') extra = '   (' + rep.conversations.whollyPartner + ' wholly partner, ' + rep.conversations.direct + ' direct staff-partner threads; ' + rep.conversations.staffAffected + ' staff accounts lose a conversation)';
    if (b.key === 'conversations/messages') extra = '   (' + rep.groups.partnerMessagesDeleted + ' of them partner messages in the kept group chats)';
    L.push('  ' + b.key + ': ' + b.count + extra);
  });
  L.push('Group chats with 2+ staff members are KEPT; the partner is taken out of them:');
  L.push('  group chats - partner removed: ' + rep.groups.partnerRemoved);
  L.push('  partner messages deleted in group chats: ' + rep.groups.partnerMessagesDeleted + ' (plus ' + rep.groups.partnerMarksDeleted + ' partner read / typing marks)');
  L.push('Reported only, kept as they are:');
  L.push('  job_projects tagged with a partner uid: ' + rep.jobProjects.tagged + '; created by a partner account: ' + rep.jobProjects.createdByPartner);
  if (showUids && sel) {
    L.push('');
    L.push('Uids (--show-uids):');
    L.push('  partner accounts: ' + (sel.partnerUids.map((u) => u + ' [' + armsOf(sel, u) + ']').join(', ') || '(none)'));
    L.push('  needs a look (accounts): ' + (sel.needsLook.users.join(', ') || '(none)'));
    L.push('  needs a look (Auth claim): ' + (sel.needsLook.auth.join(', ') || '(none)'));
    L.push('  Brilliant-Steel-only, not partner: ' + (sel.bsOnlyNonPartner.join(', ') || '(none)'));
  }
  return L;
}

// ── backup serialisation (the monthly-backup.js format) ──────────────────────
// Timestamps -> ISO-8601 strings, DocumentReferences -> { __ref: path }, everything else as it is.
function toBackupValue(v) {
  if (v === null || typeof v !== 'object') return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(toBackupValue);
  if (typeof v.path === 'string' && typeof v.id === 'string' && typeof v.collection === 'function') return { __ref: v.path };
  const out = {};
  for (const k of Object.keys(v)) out[k] = toBackupValue(v[k]);
  return out;
}
// { id, data } -> the flat { id, ...fields } record restore-from-backup.js expects. The doc id always wins; a field that was itself called "id"
// is kept as __idField rather than lost.
function toBackupRecord(rec) {
  const data = toBackupValue(dataOf(rec));
  const out = Object.assign({ id: rec.id }, data, { id: rec.id });
  if (Object.prototype.hasOwnProperty.call(data, 'id') && data.id !== rec.id) out.__idField = data.id;
  return out;
}
// Auth metadata only. A UserRecord also carries passwordHash / passwordSalt - those are credentials and are deliberately not copied.
function toAuthRecord(u) {
  const meta = (u && u.metadata) || {};
  return {
    uid: u.uid,
    email: u.email || null,
    displayName: u.displayName || null,
    phoneNumber: u.phoneNumber || null,
    disabled: !!u.disabled,
    emailVerified: !!u.emailVerified,
    customClaims: u.customClaims || null,
    providerIds: arr(u.providerData).map((p) => p && p.providerId).filter(Boolean),
    creationTime: meta.creationTime || null,
    lastSignInTime: meta.lastSignInTime || null,
  };
}

// ── files: write, fsync, read back ───────────────────────────────────────────
function makeFileIo(fs) {
  return {
    exists: (p) => fs.existsSync(p),
    mkdirp: (p) => { fs.mkdirSync(p, { recursive: true }); },
    write: (p, text) => {
      const fd = fs.openSync(p, 'w');
      try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    },
    read: (p) => fs.readFileSync(p, 'utf8'),
    syncDir: (p) => { try { const fd = fs.openSync(p, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch (_) { /* not every platform can fsync a directory */ } },
  };
}

// Writes every bucket + auth-users.json, reads each file back and checks its record count and sha256, and ONLY THEN writes manifest.json (the
// "complete" marker). Throws on any mismatch - the caller must not delete anything after a throw.
function writeBackup(io, dir, buckets, authRecords, meta) {
  const manifestPath = nodePath.join(dir, 'manifest.json');
  io.mkdirp(dir);
  if (io.exists(manifestPath)) throw new Error('the backup directory already holds a manifest.json (' + dir + ') - use a new, empty directory.');
  const files = [];
  const put = (file, records, extra) => {
    const text = JSON.stringify(records, null, 2) + '\n';
    io.write(nodePath.join(dir, file), text);
    files.push(Object.assign({ file, records: records.length, sha256: sha256(text) }, extra));
  };
  buckets.forEach((b) => {
    const sub = b.key.indexOf('/') >= 0;
    put(fileFor(b.key), b.records.map(toBackupRecord), b.manifest ? b.manifest : sub
      ? { parentCollection: b.key.split('/')[0], subcollection: b.key.split('/')[1] }
      : { collection: b.key });
  });
  put('auth-users.json', authRecords, { kind: 'auth' });
  files.forEach((f) => {                                   // read back what is ON DISK, not what we meant to write
    let text;
    try { text = io.read(nodePath.join(dir, f.file)); } catch (e) { throw new Error('backup check failed: cannot read back ' + f.file); }
    if (sha256(text) !== f.sha256) throw new Error('backup check failed: ' + f.file + ' does not match what was written');
    let n; try { n = JSON.parse(text).length; } catch (e) { n = -1; }
    if (n !== f.records) throw new Error('backup check failed: ' + f.file + ' holds ' + n + ' records, expected ' + f.records);
  });
  const manifest = {
    tool: TOOL,
    selectionVersion: SELECTION_VERSION,
    createdAt: meta.createdAt,
    projectId: meta.projectId || null,
    complete: true,
    mode: meta.apply ? 'apply' : 'backup-only',
    counts: meta.report,
    format: 'Each <bucket>.json is an array of {id, ...fields}; Timestamps are ISO-8601 strings (as scripts/monthly-backup.js writes and scripts/restore-from-backup.js revives). '
      + 'Sub-collection files are <parent>__<sub>.json with ids "parentId/subId". conversations-group-before-edit.json holds the group chats that were KEPT, exactly as they were '
      + 'before the partner was taken out of them (restore by setting those fields back). auth-users.json is Auth metadata only (no password hashes): a deleted Auth user can be '
      + 're-created with the same uid and email, and must then set a new password.',
    files,
  };
  io.write(manifestPath, JSON.stringify(manifest, null, 2) + '\n');     // LAST
  io.syncDir && io.syncDir(dir);
  let back;
  try { back = JSON.parse(io.read(manifestPath)); } catch (e) { back = null; }
  if (!back || back.complete !== true || !Array.isArray(back.files) || back.files.length !== files.length) throw new Error('backup check failed: manifest.json is not readable back');
  return { dir, complete: true, manifestPath, files };
}

// ── reading ──────────────────────────────────────────────────────────────────
async function readCollection(db, name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}
async function listAllAuthUsers(auth) {
  const out = [];
  let token;
  do {
    const page = await auth.listUsers(1000, token);
    arr(page && page.users).forEach((u) => out.push(toAuthRecord(u)));
    token = page && page.pageToken;
  } while (token);
  return out;
}
async function readSnapshots(db, auth) {
  const snaps = {};
  for (const name of READ_COLLECTIONS) snaps[name] = await readCollection(db, name);
  snaps.authUsers = await listAllAuthUsers(auth);
  return snaps;
}
async function subcollectionNames(ref, known) {
  const names = new Set(known);
  if (typeof ref.listCollections === 'function') (await ref.listCollections()).forEach((c) => names.add(c.id));
  return Array.from(names).sort();
}
// The per-uid docs of the given uids -> { notificationsByUid, perUid } in the shape select() takes.
async function readPerUid(db, uids) {
  const perUid = {};
  const notificationsByUid = {};
  const add = (k, r) => { (perUid[k] = perUid[k] || []).push(r); };
  for (const [coll, subs] of PER_UID) {
    for (const uid of uids) {
      const ref = db.collection(coll).doc(uid);
      const snap = await ref.get();
      if (snap.exists) add(coll, { id: uid, data: snap.data() });
      for (const sub of await subcollectionNames(ref, subs)) {
        const s = await ref.collection(sub).get();
        s.docs.forEach((d) => {
          if (coll === 'notifications' && sub === 'items') (notificationsByUid[uid] = notificationsByUid[uid] || []).push({ id: d.id, data: d.data() });
          else add(coll + '/' + sub, { id: uid + '/' + d.id, data: d.data() });
        });
      }
    }
  }
  return { perUid, notificationsByUid };
}
// Firestore does NOT delete a doc's sub-collections with the doc, so every selected root doc is asked for its sub-collections (listCollections)
// and their documents are backed up and deleted first - none is left orphaned. -> { 'parent/sub': [{ id: 'parentId/subId', data }] }.
// The three conversation ones are always present. (The per-uid docs' sub-collections come from readPerUid.)
async function readChildren(db, sel) {
  const out = {};
  CONVERSATION_SUBS.forEach((s) => { out['conversations/' + s] = []; });
  for (const b of bucketsOf(sel, {})) {
    if (b.key.indexOf('/') >= 0 || PER_UID_ROOTS.indexOf(b.key) >= 0) continue;
    for (const r of b.records) {
      const ref = db.collection(b.key).doc(r.id);
      for (const sub of await subcollectionNames(ref, b.key === 'conversations' ? CONVERSATION_SUBS : [])) {
        const s = await ref.collection(sub).get();
        const key = b.key + '/' + sub;
        out[key] = out[key] || [];
        s.docs.forEach((d) => out[key].push({ id: r.id + '/' + d.id, data: d.data() }));
      }
    }
  }
  return out;
}

// What a partner left in the kept GROUP chats, read the cheap way: their messages by a query on authorId (at most 10 values per `in`), their read /
// typing marks by uid. Nobody else's message is ever read. -> { 'conversations/messages' | '/readers' | '/typing': [{ id: 'convId/childId', data }] }
async function readGroupChildren(db, groups, partnerUids) {
  const out = {};
  CONVERSATION_SUBS.forEach((s) => { out['conversations/' + s] = []; });
  for (const r of groups) {
    const ref = db.collection('conversations').doc(r.id);
    for (const part of chunk(partnerUids, 10)) {
      const snap = await ref.collection('messages').where('authorId', 'in', part).get();
      snap.docs.forEach((d) => out['conversations/messages'].push({ id: r.id + '/' + d.id, data: d.data() }));
    }
    for (const uid of partnerUids) {
      for (const sub of ['readers', 'typing']) {
        const snap = await ref.collection(sub).doc(uid).get();
        if (snap.exists) out['conversations/' + sub].push({ id: r.id + '/' + uid, data: snap.data() });
      }
    }
  }
  return out;
}

// ── deleting ─────────────────────────────────────────────────────────────────
// The one write that is not a delete: take the partner out of the kept group chats (batched, atomic per doc via FieldValue).
async function applyGroupEdits(db, patches) {
  let n = 0;
  for (const part of chunk(patches, BATCH)) {
    const batch = db.batch();
    part.forEach((p) => batch.update(db.doc(pathFor('conversations', p.id)), p.patch));
    await batch.commit();
    n += part.length;
  }
  return n;
}
async function deleteBucket(db, bucket) {
  const refs = bucket.records.map((r) => db.doc(pathFor(bucket.key, r.id)));    // every path is built (and validated) before the first delete
  let n = 0;
  for (const part of chunk(refs, BATCH)) {
    const batch = db.batch();
    part.forEach((ref) => batch.delete(ref));
    await batch.commit();
    n += part.length;
  }
  return n;
}
async function deleteAuthUsers(auth, uids) {
  const out = { deleted: 0, missing: 0 };
  for (const uid of uids) {
    try { await auth.deleteUser(uid); out.deleted++; }
    catch (e) { if (e && e.code === 'auth/user-not-found') out.missing++; else throw e; }
  }
  return out;
}

// ── the runner ───────────────────────────────────────────────────────────────
// run(deps, opts) -> { apply, report, selection, backup, deleted, verification, exitCode }
//   deps  { db, auth, io?, now? }  db: Firestore (Admin SDK) or anything with collection().get(), doc(), batch(); auth: admin.auth()-like
//   opts  { apply, backupDir, showUids, log, projectId }
//   apply must be exactly true to delete, and needs backupDir. exitCode 0 = fine, 2 = the post-apply verification found something left.
async function run(deps, opts) {
  const o = opts || {};
  const apply = o.apply === true;
  const backupDir = typeof o.backupDir === 'string' && o.backupDir !== '' ? o.backupDir : null;
  const log = o.log || console.log;
  if (apply && !backupDir) throw new Error('--apply needs --backup <dir> in the same command - nothing was read or written.');
  const db = deps.db;
  const auth = deps.auth;
  const io = deps.io || makeFileIo(nodeFs);
  const now = deps.now || (() => new Date());
  if (backupDir && insideRepo(backupDir, deps.repoRoot)) throw new Error(insideMessage(backupDir));
  if (backupDir && io.exists(nodePath.join(backupDir, 'manifest.json'))) throw new Error('the backup directory already holds a manifest.json (' + backupDir + ') - use a new, empty directory.');

  log('-- Partner data purge (PARTNER-REMOVAL-SPEC WS-F; owner answers 2026-10-28) --');
  log(apply
    ? 'Mode: APPLY - the selected documents and Auth accounts WILL be deleted, after the backup below is written and verified.'
    : 'Mode: DRY RUN - nothing is deleted. ' + (backupDir ? 'The export is written to the backup directory.' : 'Add --backup <dir> to export, then --backup <dir> --apply to delete.'));

  // 1. read, select (three passes: the partner uids; then their per-uid docs; then what they left in the group chats that are kept)
  const snaps = await readSnapshots(db, auth);
  const first = select(snaps);
  const per = await readPerUid(db, first.partnerUids);
  const withPer = Object.assign({}, snaps, per);
  const second = select(withPer);
  const groupChildren = await readGroupChildren(db, second.conversationsGroups, second.partnerUids);
  const sel = select(Object.assign({}, withPer, { groupChildren }));
  const children = await readChildren(db, sel);
  const buckets = bucketsOf(sel, children);

  // 2. the report (counts only)
  const read = {};
  READ_COLLECTIONS.forEach((k) => { read[k] = snaps[k].length; });
  read['Auth accounts'] = snaps.authUsers.length;
  const report = summarize(sel, { children, read, authUids: snaps.authUsers.map((u) => u.uid) });
  formatReport(report, sel, { showUids: o.showUids === true }).forEach((l) => log(l));
  const problems = safetyProblems(sel, snaps);
  problems.forEach((p) => log('SAFETY: ' + p));
  if (apply && problems.length) throw new Error('refusing to apply: ' + problems.join('; ') + '.');
  if (!snaps.users.length) log('WARNING: the users collection is empty - wrong project or credential?');
  const FV = deps.FieldValue;
  if (apply && sel.groupEdits.length && !(FV && typeof FV.arrayRemove === 'function' && typeof FV.delete === 'function')) {
    throw new Error('the group chats need deps.FieldValue (arrayRemove, delete) to take the partner out - nothing was written or deleted.');
  }
  const patches = apply ? sel.groupEdits.map((e) => ({ id: e.id, patch: buildGroupPatch(e, FV) })) : [];   // built (and validated) before anything is touched

  // 3. the backup - nothing below this line may run unless it completed
  let backup = null;
  if (backupDir) {
    const authRecords = sel.partnerUids.map((uid) => snaps.authUsers.find((u) => u.uid === uid) || { uid, found: false });
    backup = writeBackup(io, backupDir, buckets.concat(editedOriginals(sel)), authRecords, { createdAt: now().toISOString(), projectId: o.projectId, apply, report });
    log('Backup written and verified: ' + backup.files.length + ' files in ' + backupDir + ' (manifest.json last; complete).');
  }
  if (!apply) {
    log('DRY RUN - nothing was deleted.' + (backup ? '' : ' (No backup was written; --apply needs --backup <dir>.)'));
    return { apply: false, report, selection: sel, backup, deleted: null, verification: null, exitCode: 0 };
  }
  if (!backup || backup.complete !== true) throw new Error('internal: apply reached the delete step without a complete backup');

  // 4. delete: Firestore children and data first (the partner's messages in a kept group chat BEFORE the partner leaves its member list, so a repeat run
  //    still finds them), then the group chats are edited, then the Auth accounts (the step that cannot be restored), the users docs LAST
  const deleted = {};
  try {
    for (const b of buckets) {
      if (b.key === 'users') continue;
      deleted[b.key] = await deleteBucket(db, b);
      log('  deleted ' + b.key + ': ' + deleted[b.key]);
    }
    if (patches.length) {
      deleted['group chats - partner removed'] = await applyGroupEdits(db, patches);
      log('  group chats - partner removed: ' + deleted['group chats - partner removed']);
    }
    const authResult = await deleteAuthUsers(auth, sel.partnerUids);
    deleted['Auth accounts'] = authResult.deleted;
    log('  deleted Auth accounts: ' + authResult.deleted + (authResult.missing ? ' (' + authResult.missing + ' had no Auth account)' : ''));
    const usersBucket = buckets.find((b) => b.key === 'users');
    deleted.users = await deleteBucket(db, usersBucket);
    log('  deleted users: ' + deleted.users);
  } catch (e) {
    log('APPLY FAILED part way: ' + (e && e.message ? e.message : e));
    log('The users docs are deleted last, so the partner accounts can still be found: fix the cause and run again with a NEW --backup directory. The backup at ' + backupDir + ' is complete and is kept.');
    throw e;
  }

  // 5. verification: re-read everything and look for what should be gone
  const verification = await verify(db, auth, sel, log, o.showUids === true);
  log('Done. The backup is in ' + backupDir + ' - record that path in STATUS.md.');
  return { apply: true, report, selection: sel, backup, deleted, verification, exitCode: verification.ok ? 0 : 2 };
}

// Fresh reads; the purged uids are passed in explicitly because their users docs no longer exist to identify them.
async function verify(db, auth, before, log, showUids) {
  const purged = before.partnerUids;
  const snaps = await readSnapshots(db, auth);
  const per = await readPerUid(db, purged);
  const sel = select(Object.assign({}, snaps, per, { knownPartnerUids: purged }));
  const leftoverConvs = [];
  for (const c of before.conversationsWhollyPartner.concat(before.conversationsMixed)) {
    const snap = await db.collection('conversations').doc(c.id).get();
    if (snap.exists) leftoverConvs.push(c.id);
  }
  const kids = await readChildren(db, before);
  const leftoverKids = Object.keys(kids).reduce((n, k) => n + kids[k].length, 0);
  const groupIds = new Set(before.conversationsGroups.map((r) => r.id));
  const purgedSet = new Set(purged);
  const groupsStillNaming = snaps.conversations.filter((r) => groupIds.has(r.id) && groupEditFor(r, purgedSet)).length;
  const groupLeft = groupPartnerChildren(await readGroupChildren(db, before.conversationsGroups, purged), groupIds, purgedSet);
  const claim = (a) => norm(a.customClaims && a.customClaims.role) === 'partner';
  const gone = new Set(purged);
  const markerIds = new Set(sel.users.map((r) => r.id));
  const lines = [
    ['users with role partner', snaps.users.filter((r) => norm(dataOf(r).role) === 'partner').length],
    ['users docs of purged uids or still matching a partner marker', snaps.users.filter((r) => gone.has(r.id) || markerIds.has(r.id)).length],
    ['partner_deals', snaps.partner_deals.length],
    ['sops titled Partner Deal Process', sel.partnerSops.length],
    ['bs_quotes partner-made', sel.bsQuotes.length],
    ['approval_requests partner-made', sel.approvalRequests.length],
    ['posts partner-made', sel.posts.length],
    ['conversations with a partner', new Set(sel.conversationsWhollyPartner.concat(sel.conversationsMixed).map((r) => r.id).concat(leftoverConvs)).size],
    ['sub-collection documents under the deleted documents', leftoverKids],
    ['group chats still naming a partner (member list, per-member map or preview)', groupsStillNaming],
    ['partner messages left in group chats', groupLeft.messages.length],
    ['partner read / typing marks left in group chats', groupLeft.readers.length + groupLeft.typing.length],
    ['notification items', sel.notifications.length],
    ['per-uid docs (payroll, kpi, leave, attendance, to-dos, ...)', Object.keys(sel.perUid).filter((k) => k !== 'notifications/items').reduce((n, k) => n + sel.perUid[k].length, 0)],
    ['usernames docs', sel.usernames.length],
    ['Auth accounts enabled with claim role partner', snaps.authUsers.filter((a) => claim(a) && !a.disabled).length],
    ['Auth accounts (any state) with claim role partner', snaps.authUsers.filter(claim).length],
    ['Auth accounts still existing for the purged uids', snaps.authUsers.filter((a) => gone.has(a.uid)).length],
  ];
  log('Verification (fresh reads):');
  lines.forEach(([label, n]) => log('  ' + label + ': ' + n));
  const failures = lines.filter(([, n]) => n !== 0).map(([label, n]) => label + ': ' + n);
  if (failures.length) {
    log('VERIFICATION FAILED - not everything is gone:');
    failures.forEach((f) => log('  ' + f));
    log(showUids ? 'Purged partner uids to look for: ' + (purged.join(', ') || '(none)') : 'Run again with --show-uids to list the purged partner uids.');
  } else log('Verification passed: every count above is 0.');
  return { ok: failures.length === 0, lines: lines.map(([label, n]) => ({ label, count: n })), failures };
}

// ── command line ─────────────────────────────────────────────────────────────
const USAGE = [
  'Usage: node scripts/partner-data-purge.js [--backup <dir>] [--apply] [--show-uids]',
  '',
  '  (no flag)         DRY RUN: read, print COUNTS ONLY, write nothing.',
  '  --backup <dir>    also write the JSON export of every document it would touch (a new, empty directory).',
  '  --apply           DELETE. Needs --backup <dir> in the same command; the export is written and verified first.',
  '  --show-uids       also print the partner uids in the report (never names or emails).',
  '  --help            this text.',
  '',
  'Needs FIREBASE_SERVICE_ACCOUNT (the Firebase Admin SDK JSON, stringified), like scripts/migrate-files-hub.js.',
  'Exit codes: 0 ok, 1 refused / bad arguments / failed part way, 2 verification found partner data still there.',
].join('\n');

function parseArgs(argv) {
  const out = { apply: false, backupDir: null, backupMissing: false, showUids: false, help: false, unknown: [] };
  const list = argv || [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--show-uids') out.showUids = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--backup') {
      const next = list[i + 1];
      if (next === undefined || next === '' || String(next).indexOf('--') === 0) out.backupMissing = true;
      else { out.backupDir = next; i++; }
    } else if (a.indexOf('--backup=') === 0) {
      if (a.length > '--backup='.length) out.backupDir = a.slice('--backup='.length); else out.backupMissing = true;
    } else out.unknown.push(a);
  }
  return out;
}

// -> process exit code. Arguments are checked BEFORE anything is loaded or any credential is read, so a typo can never reach Firebase.
async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(USAGE); return 0; }
  const bad = [];
  if (args.unknown.length) bad.push('Unknown option(s): ' + args.unknown.join(' '));
  if (args.backupMissing) bad.push('--backup needs a directory: --backup <dir>');
  if (bad.length) {
    console.error(bad.join('\n') + '\n(Nothing was run. A dry run is the default.)\n\n' + USAGE);
    return 1;
  }
  if (args.apply && !args.backupDir) {
    console.error('--apply needs --backup <dir> in the same command: the export of everything it deletes must be written first.\n(Nothing was run: no credential was read and nothing was deleted.)\n\n' + USAGE);
    return 1;
  }
  const dir = args.backupDir ? nodePath.resolve(args.backupDir) : null;
  if (dir && insideRepo(dir)) {
    console.error(insideMessage(dir) + '\n(Nothing was run.)');
    return 1;
  }
  if (dir && nodeFs.existsSync(nodePath.join(dir, 'manifest.json'))) {
    console.error('The backup directory already holds a manifest.json (' + dir + ').\nUse a new, empty directory so an earlier export is never overwritten. (Nothing was run.)');
    return 1;
  }

  const admin = require('firebase-admin');
  const { requireEnv } = require('./drive-lib');
  let serviceAccount;
  try { serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT')); }
  catch (_) { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON (paste the WHOLE service-account file).'); }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log('Project: ' + (serviceAccount.project_id || '(unknown)'));

  const result = await run(
    { db: admin.firestore(), auth: admin.auth(), FieldValue: admin.firestore.FieldValue },
    { apply: args.apply, backupDir: dir, showUids: args.showUids, projectId: serviceAccount.project_id }
  );
  return result.exitCode;
}

module.exports = {
  select, safetyProblems, bucketsOf, editedOriginals, pathFor, summarize, formatReport,
  groupPartnerChildren, groupEditFor, buildGroupPatch,
  toBackupValue, toBackupRecord, toAuthRecord, makeFileIo, writeBackup,
  run, parseArgs, main, insideRepo,
  SELECTION_VERSION, PER_UID_KEYS,
};

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((e) => { console.error('partner-data-purge: ' + (e && e.message ? e.message : e)); process.exit(1); });
}
